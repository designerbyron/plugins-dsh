/**
 * Mantenimiento (M3/M5): `forget` y `reindex` con alcance exacto, transacciones y auditoría.
 *
 * `forget` borra la fuente y todo lo que cuelga de ella (chunks, vectores, etiquetas, FTS por cascada).
 * `reindex` reconstruye lo que se pide: `fts` global en una transacción, `vectors` por fuente.
 * Ambas operaciones son sensibles: la herramienta exige aprobación humana **antes** de llamar aquí.
 */

import { appendAudit } from './audit.mjs';
import { ftsIntegrityCheck, ftsRebuild, withTransaction } from './db.mjs';
import { embedText, vectorToBlob } from './embed.mjs';
import { RagError } from './errors.mjs';
import { getSource } from './search.mjs';

function bumpRevision(db) {
  db.prepare("UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'index_revision'").run();
}

/** Borra una fuente por id o URI. Devuelve lo borrado. */
export function forgetSource(db, { ref, now = Date.now(), actor = 'model', sessionId = null, callId = null } = {}) {
  const source = getSource(db, ref);
  return withTransaction(db, () => {
    const chunks = db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE source_id = ?').get(source.id).n;
    db.prepare('DELETE FROM sources WHERE id = ?').run(source.id);
    bumpRevision(db);
    appendAudit(db, {
      at: now,
      actor,
      sessionId,
      callId,
      tool: 'lifecode_rag_forget',
      action: 'forget',
      target: source.id,
      outcome: 'ok',
      details: { uri: source.uri, chunks },
    });
    return { deleted: true, sourceId: source.id, uri: source.uri, chunks };
  });
}

/** Reconstruye la FTS completa desde `chunks` y verifica el resultado dentro de la misma transacción. */
export function reindexFts(db, { now = Date.now(), actor = 'model', sessionId = null, callId = null } = {}) {
  return withTransaction(db, () => {
    ftsRebuild(db);
    ftsIntegrityCheck(db);
    bumpRevision(db);
    const chunks = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
    appendAudit(db, {
      at: now, actor, sessionId, callId, tool: 'lifecode_rag_reindex', action: 'reindex.fts',
      target: null, outcome: 'ok', details: { chunks },
    });
    return { rebuiltChunks: chunks };
  });
}

/**
 * Recalcula los vectores de todas las fuentes, una transacción por fuente.
 * `signal` se comprueba entre fuentes: la cancelación no deja una fuente a medio reindexar.
 */
export function reindexVectors(db, {
  config, now = Date.now(), actor = 'model', sessionId = null, callId = null, signal = null,
} = {}) {
  const sources = db.prepare('SELECT id FROM sources ORDER BY id ASC').all();
  const model = config.embedding.provider;
  const dim = config.embedding.dim;
  let chunks = 0;
  let done = 0;

  for (const source of sources) {
    if (signal?.aborted) throw new RagError('cancelled', 'reindex de vectores cancelado', { details: { done, total: sources.length } });
    const rows = db.prepare('SELECT chunk_key, text FROM chunks WHERE source_id = ? ORDER BY ordinal ASC').all(source.id);
    const prepared = rows.map((row) => ({ ...row, vector: embedText(row.text, config.embedding) }));
    withTransaction(db, () => {
      db.prepare('DELETE FROM vectors WHERE chunk_key IN (SELECT chunk_key FROM chunks WHERE source_id = ?)').run(source.id);
      const insert = db.prepare('INSERT INTO vectors (chunk_key, model, dim, vec) VALUES (?, ?, ?, ?)');
      for (const row of prepared) insert.run(row.chunk_key, model, dim, vectorToBlob(row.vector));
      bumpRevision(db);
      appendAudit(db, {
        at: now, actor, sessionId, callId, tool: 'lifecode_rag_reindex', action: 'reindex.vectors', target: source.id,
        outcome: 'ok', details: { chunks: prepared.length, model, dim },
      });
    });
    chunks += prepared.length;
    done += 1;
  }

  // I4: los vectores del modelo activo cubren exactamente los chunks. Si quedó un vector de otro
  // modelo (o falta alguno), se dice con conteos en vez de mezclar en silencio.
  const chunkCount = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
  const vectorCount = db.prepare('SELECT COUNT(*) AS n FROM vectors WHERE model = ?').get(model).n;
  if (chunkCount !== vectorCount) {
    throw new RagError('vector-index-incomplete', 'el índice de vectores no cubre todos los chunks', {
      details: { chunks: chunkCount, vectors: vectorCount, model, dim },
    });
  }
  return { sources: done, chunks, model, dim };
}

/**
 * Reindexado por operación, en el orden que fija la resolución v2.1: `fta` primero, luego vectores.
 * @param {'fts'|'vectors'|'all'} operation
 */
export function reindex(db, { operation, config, now = Date.now(), actor = 'model', sessionId = null, callId = null, signal = null } = {}) {
  if (!['fts', 'vectors', 'all'].includes(operation)) {
    throw new RagError('invalid-argument', `operación de reindex no válida: ${operation}`);
  }
  const result = { operation, fts: null, vectors: null };
  if (operation === 'fts' || operation === 'all') result.fts = reindexFts(db, { now, actor, sessionId, callId });
  if (operation === 'vectors' || operation === 'all') {
    result.vectors = reindexVectors(db, { config, now, actor, sessionId, callId, signal });
  }
  return result;
}
