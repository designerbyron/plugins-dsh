/**
 * Exportación derivada de la auditoría (AC10/AC18).
 *
 * La tabla `audit` es la fuente de verdad. El fichero JSONL se escribe a un temporal, se sincroniza a disco
 * y se renombra: un corte deja o el fichero anterior o el nuevo, nunca un híbrido. `meta.audit_exported_seq`
 * registra hasta dónde llega la exportación, de modo que una caída entre el rename y la marca se resuelve
 * regenerando (la exportación es idempotente).
 */

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { auditLine, verifyAuditChain } from './audit.mjs';
import { writeMeta } from './db.mjs';

const COLUMNS = 'seq, at, actor, session_id, call_id, tool, action, target, outcome, details, prev_hash, hash';

/** Escribe (o regenera) el JSONL completo desde la tabla. */
export function exportAuditJsonl(db, { path, tmpPath = `${path}.tmp` }) {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM audit ORDER BY seq ASC`).all();
  const body = rows.map(auditLine).join('\n') + (rows.length > 0 ? '\n' : '');
  writeFileSync(tmpPath, body, 'utf8');
  const fd = openSync(tmpPath, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, path);
  const lastSeq = rows.length > 0 ? rows[rows.length - 1].seq : 0;
  writeMeta(db, 'audit_exported_seq', String(lastSeq));
  return { entries: rows.length, lastSeq, bytes: Buffer.byteLength(body, 'utf8') };
}

/**
 * Compara el fichero con la base: detecta truncación, líneas extra, ediciones y corrupción.
 * @returns {{ok:boolean, reason?:string, entries?:number, missing?:number[], seq?:number, line?:number}}
 */
export function verifyAuditExport(db, { path }) {
  if (!existsSync(path)) return { ok: false, reason: 'missing' };
  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '');
  const rows = db.prepare(`SELECT ${COLUMNS} FROM audit ORDER BY seq ASC`).all();
  const expected = new Map(rows.map((row) => [row.seq, auditLine(row)]));
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    let parsed;
    try {
      parsed = JSON.parse(lines[index]);
    } catch {
      return { ok: false, reason: 'invalid-line', line: index + 1 };
    }
    if (!Number.isInteger(parsed.seq) || !expected.has(parsed.seq)) {
      return { ok: false, reason: 'extra', seq: parsed.seq, line: index + 1 };
    }
    if (seen.has(parsed.seq)) return { ok: false, reason: 'duplicate', seq: parsed.seq, line: index + 1 };
    if (expected.get(parsed.seq) !== lines[index]) return { ok: false, reason: 'mismatch', seq: parsed.seq, line: index + 1 };
    seen.add(parsed.seq);
  }
  const missing = rows.filter((row) => !seen.has(row.seq)).map((row) => row.seq);
  if (missing.length > 0) return { ok: false, reason: 'truncated', missing: missing.slice(0, 5), missingCount: missing.length };
  return { ok: true, entries: lines.length };
}

/** Estado conjunto: cadena de la base + coherencia del fichero. */
export function auditState(db, { path }) {
  const chain = verifyAuditChain(db);
  if (!chain.ok) return { ok: false, where: 'database', ...chain };
  const file = verifyAuditExport(db, { path });
  if (!file.ok) return { ok: false, where: 'file', ...file };
  return { ok: true, entries: chain.count };
}
