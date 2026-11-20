/**
 * Auditoría transaccional (M5, adelantada porque la ingesta la necesita).
 *
 * La tabla `audit` es la fuente de verdad; `audit.jsonl` es una **exportación derivada** que se puede
 * regenerar. Cada fila encadena `prev_hash` y `hash`, y `meta.audit_head_seq` fija la cabeza: si la
 * cabeza declarada no coincide con la última fila, el almacén se considera corrupto y no se abre.
 *
 * Límite conocido (A9): sin un ancla externa, truncar las últimas filas *junto con* `audit_head_seq`
 * es indistinguible de un estado legítimo anterior. La cadena detecta ediciones y borrados internos,
 * no una reescritura completa y coherente del fichero.
 */

import { createHash } from 'node:crypto';

import { RagError } from './errors.mjs';
import { readMeta, writeMeta } from './db.mjs';

export const GENESIS_HASH = '0'.repeat(64);

/** JSON canónico: claves ordenadas, sin espacios, para que el hash no dependa del orden de inserción. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(',')}}`;
}

/** Campos que entran en el hash; `details` es texto canónico, no un objeto suelto. */
function auditPayload(entry) {
  return {
    at: Number(entry.at),
    actor: entry.actor ?? 'model',
    sessionId: entry.sessionId ?? null,
    callId: entry.callId ?? null,
    tool: entry.tool,
    action: entry.action,
    target: entry.target ?? null,
    outcome: entry.outcome,
    details: entry.details ?? null,
  };
}

/** Hash de una entrada encadenada a la anterior. */
export function auditHash(prevHash, entry) {
  return createHash('sha256').update(`${prevHash}\n${canonicalJson(auditPayload(entry))}`, 'utf8').digest('hex');
}

/**
 * Añade una entrada a la cadena. Debe llamarse **dentro** de la transacción de la mutación que audita.
 * @returns {{seq:number, hash:string}}
 */
export function appendAudit(db, entry) {
  const head = Number(readMeta(db, 'audit_head_seq') ?? '0');
  let prevHash = GENESIS_HASH;
  if (head > 0) {
    const row = db.prepare('SELECT hash FROM audit WHERE seq = ?').get(head);
    if (!row) throw new RagError('store-corrupt', `falta la entrada de auditoría ${head}`);
    prevHash = row.hash;
  }
  if (typeof entry.tool !== 'string' || entry.tool === '') throw new RagError('internal', 'auditoría sin herramienta');
  if (typeof entry.action !== 'string' || entry.action === '') throw new RagError('internal', 'auditoría sin acción');
  if (!['ok', 'failed', 'denied', 'skipped'].includes(entry.outcome)) {
    throw new RagError('internal', `resultado de auditoría inválido: ${entry.outcome}`);
  }
  const payload = auditPayload(entry);
  const hash = auditHash(prevHash, payload);
  const info = db.prepare(`INSERT INTO audit (at, actor, session_id, call_id, tool, action, target, outcome, details, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    payload.at, payload.actor, payload.sessionId, payload.callId, payload.tool, payload.action,
    payload.target, payload.outcome, canonicalJson(payload.details), prevHash, hash,
  );
  const seq = Number(info.lastInsertRowid);
  writeMeta(db, 'audit_head_seq', String(seq));
  writeMeta(db, 'audit_head_hash', hash);
  return { seq, hash };
}

/** Recorre la cadena y devuelve el primer punto roto, si lo hay. */
export function verifyAuditChain(db) {
  const rows = db.prepare(`SELECT seq, at, actor, session_id, call_id, tool, action, target, outcome, details, prev_hash, hash
    FROM audit ORDER BY seq ASC`).all();
  let prevHash = GENESIS_HASH;
  for (const row of rows) {
    if (row.prev_hash !== prevHash) return { ok: false, brokenAt: row.seq, reason: 'prev-hash' };
    const expected = auditHash(prevHash, {
      at: row.at,
      actor: row.actor,
      sessionId: row.session_id ?? null,
      callId: row.call_id ?? null,
      tool: row.tool,
      action: row.action,
      target: row.target ?? null,
      outcome: row.outcome,
      details: row.details === null ? null : JSON.parse(row.details),
    });
    if (expected !== row.hash) return { ok: false, brokenAt: row.seq, reason: 'hash' };
    prevHash = row.hash;
  }
  const head = Number(readMeta(db, 'audit_head_seq') ?? '0');
  if (head !== rows.length) return { ok: false, brokenAt: head, reason: 'head' };
  return { ok: true, count: rows.length };
}

/** Entrada de auditoría legible para la exportación JSONL (una línea por fila). */
export function auditLine(row) {
  return JSON.stringify({
    seq: row.seq,
    at: row.at,
    actor: row.actor,
    sessionId: row.session_id ?? null,
    callId: row.call_id ?? null,
    tool: row.tool,
    action: row.action,
    target: row.target ?? null,
    outcome: row.outcome,
    details: row.details === null ? null : JSON.parse(row.details),
    prevHash: row.prev_hash,
    hash: row.hash,
  });
}
