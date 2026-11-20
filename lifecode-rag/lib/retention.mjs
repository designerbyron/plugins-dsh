/**
 * Retención y archivado de metadatos (PA4-G, observación O-PA0-3).
 *
 * Regla de PA4: este módulo **no borra nada**. Planifica y archiva; ejecutar una retención destructiva
 * exige una política humana aprobada que todavía no existe (propuesta en el informe PA4). Por eso no
 * hay `applyRetention()` ni `DELETE`: si en el futuro se autoriza, tendrá que entrar aquí y pasar por
 * revisión, no colarse desde otro módulo.
 *
 * Qué es retenible y qué no:
 * - `session_scope` expiradas o invalidadas: metadatos operativos, sin valor probatorio propio; su
 *   rastro histórico ya vive en `audit_registry` (`session.terminate`, `session.invalidate`).
 * - `operations`/`operation_steps` terminadas: si se archivan, se archivan juntas (los pasos van con
 *   su operación) y nunca una fila `started`: esa es una operación interrumpida y se reconcilia, no
 *   se borra.
 * - `audit_registry` y la `audit` de cada almacén: **no se borran ni se compactan**. Son la cadena de
 *   integridad; archivarlas es copiar, no sustituir. `exportRegistryAuditSlice` copia un rango
 *   verificando la cadena antes de escribir.
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { RagError } from './errors.mjs';
import { canonicalJson } from './audit.mjs';
import { appendRegistryAudit, registryAuditHash } from './registry.mjs';

/** Días de conservación propuestos. No son política aprobada: son la propuesta del informe PA4. */
export const RETENTION_PROPOSAL = Object.freeze({
  sessionScopeDays: 90,
  finishedOperationsDays: 180,
  dailyMetricsDays: 400,
});

const DAY_MS = 86_400_000;

/** Día UTC `YYYY-MM-DD` de un instante, que es el formato de `metrics_daily.day`. */
export function dayOf(instant) {
  return new Date(instant).toISOString().slice(0, 10);
}

/**
 * Calcula qué se podría archivar y cuánto ocupa, sin tocar nada. Devuelve también lo que la política
 * **nunca** tocaría, para que la decisión humana se tome con el número completo delante.
 */
export function planRetention(registryDb, { now = Date.now(), policy = RETENTION_PROPOSAL } = {}) {
  const sessionCutoff = new Date(now - policy.sessionScopeDays * DAY_MS).toISOString();
  const metricsCutoff = dayOf(now - policy.dailyMetricsDays * DAY_MS);
  const count = (sql, ...params) => Number(registryDb.prepare(sql).get(...params)?.n ?? 0);

  const expiredSessions = count(
    `SELECT COUNT(*) AS n FROM session_scope
      WHERE state IN ('expired','invalidated') AND updated_at < ?`, sessionCutoff,
  );
  const activeSessions = count(`SELECT COUNT(*) AS n FROM session_scope WHERE state = 'active'`);
  const unfinishedOperations = count(`SELECT COUNT(*) AS n FROM operations WHERE state = 'started'`);
  const finishedOperations = count(
    `SELECT COUNT(*) AS n FROM operations WHERE state <> 'started'`, 
  );
  const auditEntries = count('SELECT COUNT(*) AS n FROM audit_registry');
  const auditHeadHash = registryDb.prepare(`SELECT value FROM meta WHERE key='audit_head_hash'`).get()?.value ?? null;

  return {
    policy: { ...policy, approved: false, destructive: false },
    asOf: new Date(now).toISOString(),
    candidates: {
      expiredSessions,
      finishedOperations,
      metricsBefore: metricsCutoff,
    },
    protected: {
      activeSessions,
      unfinishedOperations,
      auditRegistryEntries: auditEntries,
      auditHeadHash,
      note: 'la auditoría no se borra ni se compacta; sólo se copia',
    },
    note: 'plan de sólo lectura: PA4 no elimina ni compacta metadatos sin política humana aprobada',
  };
}

/**
 * Copia un rango de la auditoría del registro a JSONL verificando la cadena antes de escribir.
 * No modifica la base. La cabecera del fichero declara el rango y el hash de cabeza para que la copia
 * sea comprobable por sí misma.
 */
export function exportRegistryAuditSlice(registryDb, { fromSeq = 1, toSeq = null, path, now = Date.now() } = {}) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new RagError('invalid-argument', 'la exportación necesita una ruta de destino');
  }
  const rows = registryDb.prepare(
    `SELECT seq, at, actor, session_id, action, target, outcome, detail, prev_hash, hash
       FROM audit_registry WHERE seq >= ? AND seq <= COALESCE(?, seq) ORDER BY seq ASC`,
  ).all(Number(fromSeq), toSeq === null ? null : Number(toSeq));

  let previous = fromSeq > 1
    ? (registryDb.prepare('SELECT hash FROM audit_registry WHERE seq = ?').get(Number(fromSeq) - 1)?.hash ?? null)
    : '0'.repeat(64);
  if (previous === null) {
    throw new RagError('registry-corrupt', 'el rango de auditoría no continúa una cadena conocida', {
      details: { fromSeq },
    });
  }
  const seedHash = previous;
  for (const row of rows) {
    const expected = registryAuditHash(previous, {
      at: row.at, actor: row.actor, sessionId: row.session_id, action: row.action,
      target: row.target, outcome: row.outcome, detail: row.detail,
    });
    if (expected !== row.hash) {
      throw new RagError('registry-corrupt', 'la cadena de auditoría del registro no verifica en el rango exportado', {
        details: { seq: row.seq, expected, actual: row.hash },
      });
    }
    previous = row.hash;
  }

  const header = canonicalJson({
    kind: 'lifecode-rag/registry-audit-slice',
    exportedAt: new Date(now).toISOString(),
    fromSeq: Number(fromSeq),
    toSeq: rows.length > 0 ? rows.at(-1).seq : Number(fromSeq) - 1,
    previousHash: fromSeq > 1 ? seedHash : null,
    headHash: rows.length > 0 ? rows.at(-1).hash : previous,
  });
  const lines = [header, ...rows.map((row) => canonicalJson(row))];
  const body = `${lines.join('\n')}\n`;
  writeFileSync(path, body, 'utf8');
  const seal = createHash('sha256').update(body, 'utf8').digest('hex');
  writeFileSync(`${path}.sha256`, `${seal}  ${path.split(/[\\/]/).pop()}\n`, 'utf8');

  // La exportación es una acción auditable, pero no destructiva: se deja rastro en el registro.
  appendRegistryAudit(registryDb, {
    at: now,
    actor: 'human',
    sessionId: null,
    action: 'audit.export',
    target: String(fromSeq),
    outcome: 'ok',
    detail: { entries: rows.length, path, seal },
  });

  return { entries: rows.length, bytes: Buffer.byteLength(body, 'utf8'), sha256: seal, path, fromSeq: Number(fromSeq) };
}
