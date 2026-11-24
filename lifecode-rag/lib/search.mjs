/**
 * Recuperación v0.2 (M1): híbrida configurable con diagnóstico.
 *
 * - Léxica: FTS5/BM25 (siempre disponible, sin red).
 * - Semántica: vectores del proveedor configurado (local determinista o remoto aprobado). El motor no
 *   decide si el proveedor es semántico: lo declara el proveedor (`kind`).
 * - Fusión: Reciprocal Rank Fusion **ponderada** (`peso / (k + rango)`), porque BM25 y coseno no son
 *   comparables; los pesos permiten priorizar una vía sin calibrar escalas.
 *
 * Degradación (UX-2.2 · P0-1): si el proveedor de embeddings falla por una causa **recuperable**
 * (`embedding-failed`), la búsqueda sirve lo que el canal léxico tenga y lo declara en
 * `mode='lexical-fallback'` y `diagnostics.degraded`. Nunca se degrada ante cancelaciones,
 * denegaciones de autorización o egreso, corrupción del almacén ni errores internos: esos se propagan
 * tal cual, porque presentarlos como una búsqueda «vacía» sería mentir sobre el estado del sistema.
 *
 * La consulta vectorial está acotada (`search.maxVectorScan`) y lo declara. `minScore` se aplica sobre la
 * puntuación normalizada 0..1 de la lista fusionada; `maxPerSource` limita cuántos fragmentos aporta una
 * misma fuente. Ambas cosas se documentan como parte del resultado (`diagnostics`).
 */

import { RagError } from './errors.mjs';
import { normalizeTags } from './tags.mjs';
import { blobToVector, cosine } from './embed.mjs';
import { createEmbedder } from './embedders.mjs';
import { latencyBucket, recordMetrics } from './metrics.mjs';

export const RRF_K = 60;
export const SNIPPET_CHARS = 240;

/**
 * Códigos que justifican degradar a léxico. Es una lista **cerrada** a propósito: ampliarla sin criterio
 * convertiría el fallback en una forma de ocultar fallos que deben llegar a quien llama.
 */
export const RECOVERABLE_EMBEDDING_CODES = Object.freeze(['embedding-failed']);

function isRecoverableEmbeddingFailure(error) {
  return error instanceof RagError && RECOVERABLE_EMBEDDING_CODES.includes(error.code);
}

/** Tokens de consulta; vacío es un error de argumento, no «devuelve todo». */
export function queryTokens(query) {
  const tokens = String(query ?? '').normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) throw new RagError('invalid-argument', 'la consulta no contiene términos');
  return tokens;
}

/**
 * Expresión MATCH segura: cada token va entrecomillado (sin operadores del usuario) y con prefijo.
 * Primero AND (precisión); el llamador puede pedir OR si AND no devuelve nada.
 */
export function buildFtsQuery(query, { operator = 'AND' } = {}) {
  return queryTokens(query).map((token) => `"${token.replace(/"/g, '""')}"*`).join(` ${operator} `);
}

function filterSql({ collection, tags, tagMode }, params, alias = 's') {
  let sql = '';
  if (collection !== undefined && collection !== null) {
    sql += ` AND ${alias}.collection = ?`;
    params.push(collection);
  }
  if (Array.isArray(tags) && tags.length > 0) {
    if (tagMode === 'all') {
      for (const tag of tags) {
        sql += ` AND EXISTS (SELECT 1 FROM source_tags t WHERE t.source_id = ${alias}.id AND t.tag = ?)`;
        params.push(tag);
      }
    } else {
      sql += ` AND EXISTS (SELECT 1 FROM source_tags t WHERE t.source_id = ${alias}.id AND t.tag IN (${tags.map(() => '?').join(',')}))`;
      params.push(...tags);
    }
  }
  return sql;
}

/** Búsqueda FTS. Devuelve filas con `rank` 1..n y la puntuación bm25 (más negativa = mejor). */
export function ftsSearch(db, { query, limit, collection, tags, tagMode, operator = 'AND' }) {
  const params = [];
  const match = buildFtsQuery(query, { operator });
  const where = filterSql({ collection, tags, tagMode }, params);
  const sql = `SELECT c.chunk_key, c.source_id, c.ordinal, c.title, c.heading, c.text, c.char_start, c.char_end,
      s.uri, s.collection, s.title AS source_title,
      bm25(chunks_fts) AS bm25,
      snippet(chunks_fts, 0, '[', ']', ' … ', 12) AS snippet
    FROM chunks_fts
    JOIN chunks c ON c.id = chunks_fts.rowid
    JOIN sources s ON s.id = c.source_id
    WHERE chunks_fts MATCH ?${where}
    ORDER BY bm25(chunks_fts) ASC, c.chunk_key ASC
    LIMIT ?`;
  const rows = db.prepare(sql).all(match, ...params, limit);
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

/** Escaneo de vectores con un vector de consulta ya calculado. */
export function vectorSearch(db, { queryVector, limit, collection, tags, tagMode, model, dim, config }) {
  const params = [model];
  const where = filterSql({ collection, tags, tagMode }, params);
  const cap = config.search.maxVectorScan;
  const sql = `SELECT v.chunk_key, v.vec, c.source_id, c.ordinal, c.title, c.heading, c.text, c.char_start, c.char_end, s.uri, s.collection, s.title AS source_title
    FROM vectors v
    JOIN chunks c ON c.chunk_key = v.chunk_key
    JOIN sources s ON s.id = c.source_id
    WHERE v.model = ?${where}
    LIMIT ?`;
  const rows = db.prepare(sql).all(...params, cap + 1);
  const truncated = rows.length > cap;
  const scored = [];
  for (const row of rows.slice(0, cap)) {
    const vector = blobToVector(row.vec, { dim });
    scored.push({ ...row, score: cosine(queryVector, vector) });
  }
  scored.sort((a, b) => b.score - a.score || a.chunk_key.localeCompare(b.chunk_key));
  return {
    truncated,
    scanned: Math.min(rows.length, cap),
    rows: scored.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 })),
  };
}

/**
 * Fusión RRF ponderada. `weights` sólo escala la contribución de cada lista; no mezcla escalas.
 * @returns {Array<object>} resultados ordenados por puntuación descendente
 */
export function fuseRrf(ftsRows, vectorRows, { k = RRF_K, limit, weights = { lexical: 1, semantic: 1 } } = {}) {
  const byKey = new Map();
  const add = (row, source) => {
    const entry = byKey.get(row.chunk_key) ?? {
      chunkKey: row.chunk_key,
      sourceId: row.source_id,
      uri: row.uri,
      collection: row.collection,
      title: row.title,
      sourceTitle: row.source_title,
      heading: row.heading ?? null,
      ordinal: row.ordinal,
      text: row.text,
      charStart: row.char_start,
      charEnd: row.char_end,
      snippet: row.snippet ?? null,
      rrf: 0,
      bm25: null,
      cosine: null,
      rankFts: null,
      rankVector: null,
      via: [],
    };
    const weight = source === 'fts' ? weights.lexical : weights.semantic;
    entry.rrf += weight / (k + row.rank);
    entry.via.push(source);
    if (source === 'fts') { entry.rankFts = row.rank; entry.bm25 = row.bm25; entry.snippet = row.snippet ?? entry.snippet; }
    else { entry.rankVector = row.rank; entry.cosine = row.score; }
    byKey.set(row.chunk_key, entry);
  };
  for (const row of ftsRows) add(row, 'fts');
  for (const row of vectorRows) add(row, 'vector');
  const rows = [...byKey.values()].sort((a, b) => b.rrf - a.rrf || a.chunkKey.localeCompare(b.chunkKey));
  const max = rows[0]?.rrf || Number.EPSILON;
  for (const row of rows) row.score = Math.max(0, Math.min(1, row.rrf / max));
  return { rows: rows.slice(0, limit), all: rows };
}

/**
 * Aplica corte por relevancia y límite de fragmentos por fuente. Se hace después de fusionar para que el
 * corte no dependa de qué vía encontró cada fragmento.
 */
export function constrainResults(rows, { minScore = 0, maxPerSource = 0 } = {}) {
  const filtered = rows.filter((row) => row.score >= minScore);
  if (maxPerSource <= 0) return filtered;
  const perSource = new Map();
  const kept = [];
  for (const row of filtered) {
    const count = perSource.get(row.sourceId) ?? 0;
    if (count >= maxPerSource) continue;
    perSource.set(row.sourceId, count + 1);
    kept.push(row);
  }
  return kept;
}

/**
 * Selección documental sobre resultados ya ordenados por el ranking actual (RAG-RANKING-04).
 *
 * Primera vuelta: la primera fila de cada `sourceId`, en el orden recibido; esa primera aparición
 * cuenta para `maxPerSource`. Segunda vuelta: rellena las posiciones restantes con los candidatos
 * sobrantes, respetando el tope por fuente. No recalcula puntuaciones, no muta las filas y es
 * determinista e idempotente. `maxPerSource = 0` significa sin tope.
 */
export function selectBySource(rows, { limit, maxPerSource = 0 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const cap = maxPerSource > 0 ? maxPerSource : Number.POSITIVE_INFINITY;
  const max = Number.isInteger(limit) && limit > 0 ? limit : list.length;
  const counts = new Map();
  const first = [];
  const taken = new Set();
  for (let index = 0; index < list.length && first.length < max; index += 1) {
    const row = list[index];
    const key = row.sourceId ?? row.source_id;
    if (counts.has(key)) continue;
    counts.set(key, 1);
    first.push(row);
    taken.add(index);
  }
  const out = [...first];
  for (let index = 0; index < list.length && out.length < max; index += 1) {
    if (taken.has(index)) continue;
    const row = list[index];
    const key = row.sourceId ?? row.source_id;
    const count = counts.get(key) ?? 0;
    if (count >= cap) continue;
    counts.set(key, count + 1);
    out.push(row);
  }
  return out.slice(0, max);
}

function recordQuery(db, { elapsedMs, count, strategy, mode, degraded = false, now }) {
  try {
    recordMetrics(db, [
      { metric: 'query.count', value: 1, dim: strategy, at: now },
      { metric: 'query.ms', value: Math.max(0, elapsedMs), dim: strategy, at: now },
      { metric: 'query.ms_bucket', value: 1, dim: latencyBucket(elapsedMs), at: now },
      ...(count === 0 ? [{ metric: 'query.empty', value: 1, dim: strategy, at: now }] : []),
      // Un canal caído no se mide como «consulta vacía»: se cuenta aparte para que el operador lo vea.
      ...(degraded ? [{ metric: 'query.fallback', value: 1, dim: strategy, at: now }] : []),
    ]);
  } catch (error) {
    if (error instanceof RagError && error.code === 'store-busy') return;
    // Una métrica nunca puede convertir una consulta correcta en un fallo.
  }
}

/**
 * Búsqueda completa.
 * @returns {{results:Array, vectors:{scanned:number, truncated:boolean}, diagnostics:object, elapsedMs:number, mode:string}}
 */
export async function search(db, {
  query,
  limit = undefined,
  collection = undefined,
  tags = undefined,
  tagMode = 'any',
  strategy = undefined,
  diversity = 'fragment',
  config,
  embedder = undefined,
  record = true,
  now = Date.now(),
} = {}) {
  const started = process.hrtime.bigint();
  const cap = Math.min(limit ?? config.search.limit, config.search.maxLimit);
  if (!Number.isInteger(cap) || cap < 1) throw new RagError('invalid-argument', 'límite de búsqueda inválido');
  const chosen = strategy ?? config.search.strategy;
  if (!['hybrid', 'fts', 'vector'].includes(chosen)) throw new RagError('invalid-argument', `estrategia desconocida: ${chosen}`);
  const normalizedTags = normalizeTags(tags ?? undefined);
  const weights = config.search.weights;

  const ftsStarted = process.hrtime.bigint();
  let fts = [];
  let mode = 'none';
  if (chosen !== 'vector') {
    fts = ftsSearch(db, { query, limit: cap * 3, collection, tags: normalizedTags, tagMode, operator: 'AND' });
    mode = 'and';
    if (fts.length === 0) {
      fts = ftsSearch(db, { query, limit: cap * 3, collection, tags: normalizedTags, tagMode, operator: 'OR' });
      mode = fts.length === 0 ? 'none' : 'or';
    }
  }
  const ftsMs = Number(process.hrtime.bigint() - ftsStarted) / 1e6;
  // Modo léxico real (`and`/`or`/`none`), separado del modo global: cuando se degrada, el valor de
  // `mode` pasa a `lexical-fallback` y el diagnóstico no debe perder qué hizo el canal léxico.
  const lexicalMode = mode;

  let vectorResult = { rows: [], truncated: false, scanned: 0 };
  let vectorMs = 0;
  let semanticError = null;
  if (chosen !== 'fts') {
    const vectorStarted = process.hrtime.bigint();
    try {
      const provider = embedder ?? createEmbedder(config);
      const [queryVector] = await provider.embed([String(query)]);
      vectorResult = vectorSearch(db, {
        queryVector,
        limit: cap * 3,
        collection,
        tags: normalizedTags,
        tagMode,
        model: provider.model,
        dim: provider.dim,
        config,
      });
    } catch (error) {
      // Sólo el fallo recuperable del proveedor degrada a léxico. Cancelación, autorización,
      // aislamiento, integridad y errores internos suben sin tocar.
      if (!isRecoverableEmbeddingFailure(error)) throw error;
      semanticError = error;
    }
    vectorMs = Number(process.hrtime.bigint() - vectorStarted) / 1e6;
  }

  let results;
  let fusion = null;
  const degraded = semanticError !== null;
  if (chosen === 'fts' || degraded) {
    // Si el canal que falló era el único que podía traer algo (vectorial puro), o el léxico tampoco
    // encontró nada, no hay búsqueda que servir: se propaga la causa real en vez de un «vacío» falso.
    if (degraded && fts.length === 0) throw semanticError;
    const ftsPool = fts.map((row, index) => ({
      chunkKey: row.chunk_key,
      sourceId: row.source_id,
      uri: row.uri,
      collection: row.collection,
      title: row.title,
      sourceTitle: row.source_title,
      heading: row.heading ?? null,
      ordinal: row.ordinal,
      text: row.text,
      charStart: row.char_start,
      charEnd: row.char_end,
      snippet: row.snippet ?? null,
      rrf: 1 / (RRF_K + index + 1),
      score: 1,
      rankFts: index + 1,
      rankVector: null,
      bm25: row.bm25,
      cosine: null,
      via: ['fts'],
    }));
    results = (diversity === 'source'
      ? selectBySource(ftsPool, { limit: cap, maxPerSource: config.search.maxPerSource })
      : ftsPool).slice(0, cap);
  } else {
    fusion = fuseRrf(fts, vectorResult.rows, { k: config.search.rrfK, limit: cap * 3, weights });
    // En `source` el tope por fuente lo aplica la selección documental, que además rellena posiciones.
    const pool = constrainResults(fusion.all, {
      minScore: config.search.minScore,
      maxPerSource: diversity === 'source' ? 0 : config.search.maxPerSource,
    });
    const selected = diversity === 'source'
      ? selectBySource(pool, { limit: cap, maxPerSource: config.search.maxPerSource })
      : pool;
    results = selected.slice(0, cap).map((row) => ({ ...row, score: Math.round(row.score * 1000) / 1000 }));
  }

  if (degraded) mode = 'lexical-fallback';
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (record) recordQuery(db, { elapsedMs, count: results.length, strategy: chosen, mode, degraded, now });

  return {
    results,
    vectors: { scanned: vectorResult.scanned, truncated: vectorResult.truncated },
    diagnostics: {
      strategy: chosen,
      degraded,
      lexical: { hits: fts.length, ms: Math.round(ftsMs * 100) / 100, mode: lexicalMode },
      semantic: {
        hits: vectorResult.scanned,
        ms: Math.round(vectorMs * 100) / 100,
        truncated: vectorResult.truncated,
        error: degraded ? semanticError.code : null,
      },
      fusion: { k: config.search.rrfK, weights, minScore: config.search.minScore, maxPerSource: config.search.maxPerSource },
    },
    elapsedMs,
    mode,
  };
}

/**
 * Fuente por id, `chunkKey`, URI o título.
 *
 * El `id` se resuelve primero porque está indexado por la clave primaria: es la ruta que usan las
 * herramientas cuando el modelo reutiliza un `sourceId`. Después, la forma de `chunkKey`
 * (`<sourceId>#<ordinal>`) —extensión ADITIVA, contrato v0.1.0 intacto, ver
 * `docs/CONTRATO-EXTENSIONES-1.4.md`—: `lifecode_rag_search` devuelve ese identificador en cada
 * resultado, así que `get` tiene que poder consumirlo en vez de obligar al modelo a traducirlo a un
 * `sourceId` que no ha pedido. El orden importa y está probado: un id nunca contiene `#`, y sólo si
 * la forma de `chunkKey` no casa se sigue con la URI, de modo que un fichero cuya ruta contenga `#`
 * no se confunde con un fragmento. En la búsqueda por `uri` se exige que sea **inequívoca**: con la
 * identidad por colección, el mismo `uri` puede existir dos veces en el mismo almacén y elegir una en
 * silencio devolvería el origen equivocado.
 */
const CHUNK_KEY_RE = /^(src_[A-Za-z0-9_-]+)#(\d+)$/;

export function getSource(db, ref) {
  const text = String(ref);
  const byId = db.prepare('SELECT * FROM sources WHERE id = ?').get(text);
  if (byId) return byId;
  const asChunk = CHUNK_KEY_RE.exec(text);
  if (asChunk) {
    const owner = db.prepare('SELECT * FROM sources WHERE id = ?').get(asChunk[1]);
    if (owner) {
      const ordinal = Number(asChunk[2]);
      const chunk = db.prepare('SELECT 1 FROM chunks WHERE source_id = ? AND ordinal = ?').get(owner.id, ordinal);
      if (!chunk) {
        throw new RagError('source-not-found', `la fuente ${owner.id} no tiene el fragmento ${ordinal}`, {
          details: { ref: text, sourceId: owner.id, ordinal, reason: 'chunk-not-found' },
        });
      }
      // El fragmento pedido viaja con la fuente: quien preguntó por él no tiene que volver a buscarlo.
      return { ...owner, matchedChunkOrdinal: ordinal };
    }
    // El prefijo no es una fuente de este almacén: se sigue con la resolución normal (URI/título),
    // para no convertir una referencia ajena en un error distinto del contractual.
  }
  const byUri = db.prepare('SELECT * FROM sources WHERE uri = ? LIMIT 2').all(text);
  if (byUri.length === 0) throw new RagError('source-not-found', `no existe la fuente: ${text}`, { details: { ref: text } });
  if (byUri.length > 1) {
    throw new RagError('invalid-argument', 'la referencia existe en más de una colección y no es inequívoca', {
      details: { ref, reason: 'ambiguous-ref', collections: byUri.map((row) => row.collection) },
    });
  }
  return byUri[0];
}

/** Lista de fuentes con filtros y paginación acotada. */
export function listSources(db, { collection = undefined, tag = undefined, limit = 50, offset = 0 } = {}) {
  const params = [];
  let where = 'WHERE 1 = 1';
  if (collection !== undefined) { where += ' AND s.collection = ?'; params.push(collection); }
  if (tag !== undefined) { where += ' AND EXISTS (SELECT 1 FROM source_tags t WHERE t.source_id = s.id AND t.tag = ?)'; params.push(tag); }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM sources s ${where}`).get(...params).n;
  // Un agregado por JOIN en vez de una subconsulta correlacionada por fila (N+1): el plan deja de
  // ejecutar el recuento una vez por fuente y se mantiene el mismo resultado.
  const rows = db.prepare(`SELECT s.*, COALESCE(c.n, 0) AS chunks
    FROM sources s
    LEFT JOIN (SELECT source_id, COUNT(*) AS n FROM chunks GROUP BY source_id) c ON c.source_id = s.id
    ${where} ORDER BY s.updated_at DESC, s.id ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, rows };
}