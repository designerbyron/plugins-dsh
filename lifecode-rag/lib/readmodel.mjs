/**
 * Modelo de lectura del Workspace: un snapshot agregado para la pestaña nativa.
 *
 * Regla de privacidad: aquí sólo hay recuentos, latencias agregadas y metadatos de fuentes.
 * Nunca se devuelven prompts, respuestas ni texto de chunks. El texto se pide explícitamente
 * por `/sources/:id/chunks/:ordinal` y se limita en tamaño.
 */

import { statSync } from 'node:fs';

import { verifyAuditChain } from './audit.mjs';
import { assertAuditHead, closeDatabase, ftsIntegrityCheck, openDatabase, quickCheck } from './db.mjs';
import { summary as metricsSummary } from './metrics.mjs';
import { loadConfig, storePaths } from './paths.mjs';
import { RagError } from './errors.mjs';

const DAY = 86_400_000;

function safeBytes(path) {
  try { return statSync(path).size; } catch { return 0; }
}

/** Abre en sólo lectura lógica; nunca crea el almacén desde el panel. */
export function withReadOnly(root, work) {
  let opened;
  try {
    opened = openDatabase({ root, create: false });
  } catch (error) {
    if (error instanceof RagError && error.code === 'store-not-initialized') return null;
    throw error;
  }
  try {
    return work(opened);
  } finally {
    closeDatabase(opened.db);
  }
}

export function buildSnapshot({ root = undefined, now = Date.now() } = {}) {
  const { config } = loadConfig(root);
  const paths = storePaths(root);
  const snapshot = {
    generatedAt: now,
    store: {
      path: paths.database,
      initialized: false,
      schemaVersion: null,
      databaseBytes: safeBytes(paths.database),
      auditBytes: safeBytes(paths.audit),
    },
    counts: { sources: 0, chunks: 0, vectors: 0, tags: 0, collections: 0 },
    activity: { last: null, recent: [] },
    metrics: [],
    config: {
      strategy: config.search.strategy,
      limit: config.search.limit,
      embedding: { provider: config.embedding.provider, dim: config.embedding.dim, kind: config.embedding.provider === 'local-hash-v1' ? 'lexical' : 'semantic' },
      automation: { enabled: config.automation.enabled, intervalMs: config.automation.intervalMs, watchRoots: config.automation.watchRoots.length },
      metrics: { enabled: config.metrics.enabled, retentionDays: config.metrics.retentionDays },
      roots: config.roots.extra.length,
    },
    health: { ok: true, checks: [] },
  };

  const store = withReadOnly(root, ({ db }) => {
    const version = db.prepare('PRAGMA user_version').get();
    const counts = {
      sources: db.prepare('SELECT COUNT(*) AS n FROM sources').get().n,
      chunks: db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n,
      vectors: db.prepare('SELECT COUNT(*) AS n FROM vectors').get().n,
      tags: db.prepare('SELECT COUNT(*) AS n FROM source_tags').get().n,
      collections: db.prepare('SELECT COUNT(DISTINCT collection) AS n FROM sources').get().n,
    };
    const recent = db.prepare('SELECT seq, at, tool, action, target, outcome FROM audit ORDER BY seq DESC LIMIT 20').all();
    const last = recent[0]
      ? { at: recent[0].at, tool: recent[0].tool, action: recent[0].action, outcome: recent[0].outcome }
      : null;
    let metrics = [];
    try { metrics = metricsSummary(db, { days: 7, now }).metrics; } catch { /* métricas opcionales */ }
    return { version: version.user_version, counts, recent, last, metrics };
  });

  if (!store) {
    snapshot.health = { ok: true, checks: [{ name: 'almacen', status: 'warn', detail: 'sin inicializar' }] };
    return snapshot;
  }

  snapshot.store.initialized = true;
  snapshot.store.schemaVersion = store.version;
  snapshot.counts = store.counts;
  snapshot.activity = { last: store.last, recent: store.recent };
  snapshot.metrics = store.metrics;

  const checks = [];
  const opened = openDatabase({ root, create: false });
  try {
    try {
      quickCheck(opened.db);
      checks.push({ name: 'sqlite', status: 'ok', detail: 'PRAGMA quick_check' });
    } catch (error) {
      checks.push({ name: 'sqlite', status: 'fail', detail: error.message });
    }
    try {
      ftsIntegrityCheck(opened.db);
      checks.push({ name: 'fts', status: 'ok', detail: 'integridad FTS5' });
    } catch (error) {
      checks.push({ name: 'fts', status: 'fail', detail: error.message });
    }
    try {
      assertAuditHead(opened.db);
      const chain = verifyAuditChain(opened.db);
      checks.push({ name: 'auditoria', status: chain.ok ? 'ok' : 'fail', detail: chain.ok ? `${chain.count} entradas` : `rota en ${chain.brokenAt ?? '?'}` });
    } catch (error) {
      checks.push({ name: 'auditoria', status: 'fail', detail: error.message });
    }
  } finally {
    closeDatabase(opened.db);
  }
  snapshot.health = { ok: checks.every((check) => check.status !== 'fail'), checks };
  return snapshot;
}

/** Lista de fuentes con recuento de chunks, sin texto. */
export function listSourceRows(db, { collection = null, tag = null, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (collection) { where.push('s.collection = ?'); params.push(collection); }
  if (tag) { where.push('EXISTS (SELECT 1 FROM source_tags t WHERE t.source_id = s.id AND t.tag = ?)'); params.push(tag); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM sources s ${clause}`).get(...params).n;
  const rows = db.prepare(`SELECT s.id, s.uri, s.title, s.collection, s.bytes, s.indexed_at,
      (SELECT COUNT(*) FROM chunks c WHERE c.source_id = s.id) AS chunks
    FROM sources s ${clause} ORDER BY s.indexed_at DESC, s.id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset)
    .map((row) => ({
      id: row.id,
      uri: row.uri,
      title: row.title,
      collection: row.collection,
      bytes: row.bytes,
      chunks: row.chunks,
      updatedAt: row.indexed_at,
    }));
  return { total, rows, limit, offset };
}

export function activityFeed(db, { limit = 40 } = {}) {
  const rows = db.prepare('SELECT seq, at, actor, tool, action, target, outcome FROM audit ORDER BY seq DESC LIMIT ?').all(limit);
  return rows.map((row) => ({
    seq: row.seq,
    at: row.at,
    actor: row.actor,
    tool: row.tool,
    action: row.action,
    target: row.target,
    outcome: row.outcome,
  }));
}

export { DAY };
