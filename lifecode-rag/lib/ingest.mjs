/**
 * Ingesta (M2): preparar todo antes de tocar el almacén y sustituir por fichero en una sola transacción.
 *
 * Fases explícitas, tal como exige el contrato del proyecto:
 *   lectura → digest → extracción → normalización → chunking → embeddings  (sin escrituras)
 *   transacción: fuente + chunks + vectores + etiquetas + auditoría        (todo o nada)
 *
 * Una fuente fallida **no deja fila** en `sources`: el fallo se reporta en el resultado y en la
 * auditoría. Reingerir un fichero sin cambios no reescribe nada (`skipped`).
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { appendAudit } from './audit.mjs';
import { chunkText } from './chunk.mjs';
import { normalizeTags } from './tags.mjs';
import { vectorToBlob } from './embed.mjs';
import { createEmbedder } from './embedders.mjs';
import { RagError } from './errors.mjs';
import { extractText } from './extract.mjs';
import { contentDigest, sha256Hex } from './hash.mjs';
import { openDatabase, storeFailure, withTransaction } from './db.mjs';
import { recordMetrics } from './metrics.mjs';

/**
 * Id estable y legible derivado de la URI canónica. La identidad **incluye la colección** porque el
 * esquema declara `UNIQUE (collection, uri)`: el mismo fichero puede vivir en dos colecciones del mismo
 * proyecto sin colisionar. Para la colección por defecto el identificador es el histórico, de modo que
 * los datos existentes no cambian.
 */
export function sourceIdFor(uri, collection = 'default') {
  const key = String(collection) === 'default' ? String(uri) : `${collection}\u0000${uri}`;
  return `src_${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16)}`;
}

/**
 * Patrones de **alta confianza** de material sensible. No son un control de seguridad: son una
 * advertencia para quien ingiere. Bloquear por heurística débil rompería documentación legítima, así
 * que el resultado se acompaña de `warnings` y la ingesta continúa.
 */
const SECRET_PATTERNS = Object.freeze([
  [/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/, 'private-key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'aws-access-key'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'api-key'],
  [/\bghp_[A-Za-z0-9]{36}\b/, 'github-token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'slack-token'],
]);

/** Advertencias de secretos encontradas en el texto, sin duplicar el mismo tipo. */
export function scanForSecrets(text) {
  const found = new Map();
  for (const [pattern, kind] of SECRET_PATTERNS) {
    if (pattern.test(text) && !found.has(kind)) found.set(kind, { code: 'possible-secret', kind });
  }
  return [...found.values()];
}

/** Título legible: primer encabezado Markdown o `<title>` HTML; si no, el nombre del fichero. */
export function titleOf(text, filePath, mime) {
  if (mime === 'text/html') {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
    if (match?.[1]?.trim()) return match[1].trim().slice(0, 200);
  }
  const heading = /^#{1,6}[ \t]+(.+)$/m.exec(text);
  if (heading?.[1]?.trim()) return heading[1].trim().slice(0, 200);
  return basename(filePath);
}

/**
 * Fase de preparación: lee y calcula sin escribir nada.
 * @returns {{path:string, uri:string, title:string, mime:string, bytes:number, sha256:string, text:string,
 *   chunks:Array<{ordinal:number,text:string,heading:string|null,charStart:number,charEnd:number,tokenEst:number}>,
 *   vectors:Float32Array[]}}
 */
export async function prepareDocument(filePath, { config, uri = undefined, embedder = undefined } = {}) {
  const absolutePath = resolve(filePath);
  let stats;
  try {
    stats = statSync(absolutePath);
  } catch (cause) {
    throw new RagError('source-unreadable', 'no se puede leer el fichero', { cause, details: { path: absolutePath } });
  }
  if (!stats.isFile()) {
    throw new RagError('path-unsupported', 'no es un fichero regular', { details: { path: absolutePath } });
  }
  if (stats.size === 0) throw new RagError('source-unreadable', 'el fichero está vacío', { details: { path: absolutePath } });
  if (stats.size > config.maxFileBytes) {
    throw new RagError('too-large', `el fichero supera ${config.maxFileBytes} bytes`, {
      details: { path: absolutePath, bytes: stats.size },
    });
  }

  let bytes;
  try {
    bytes = readFileSync(absolutePath);
  } catch (cause) {
    throw new RagError('source-unreadable', 'fallo de lectura', { cause, details: { path: absolutePath } });
  }
  const extractStarted = process.hrtime.bigint();
  const { text, mime } = extractText(bytes, { path: absolutePath });
  const extractMs = Number(process.hrtime.bigint() - extractStarted) / 1e6;
  const chunkStarted = process.hrtime.bigint();
  const chunks = chunkText(text, config.chunk);
  const chunkMs = Number(process.hrtime.bigint() - chunkStarted) / 1e6;
  if (chunks.length === 0) throw new RagError('source-unreadable', 'el texto no produjo chunks', { details: { path: absolutePath } });
  const title = titleOf(text, absolutePath, mime);

  // Los vectores se calculan aquí, antes de abrir transacción: un fallo de embedding no toca el almacén.
  const provider = embedder ?? createEmbedder(config);
  const embedStarted = process.hrtime.bigint();
  const vectors = await provider.embed(chunks.map((chunk) => chunk.text));
  const embedMs = Number(process.hrtime.bigint() - embedStarted) / 1e6;

  return {
    path: absolutePath,
    uri: uri ?? absolutePath,
    title,
    mime,
    bytes: bytes.length,
    sha256: sha256Hex(bytes),
    digest: contentDigest(text),
    text,
    chunks,
    vectors,
    embeddingModel: provider.model,
    embeddingKind: provider.kind,
    timings: { extract: extractMs, chunk: chunkMs, embed: embedMs },
    warnings: scanForSecrets(text),
  };
}

/**
 * Escribe un documento preparado. Devuelve `{id, uri, chunks, skipped}`.
 * El llamador debe estar dentro de una transacción o usar `upsertDocument`.
 */
export function writeDocument(db, prepared, { collection = 'default', tags = [], now = Date.now(), force = false, config } = {}) {
  const existing = db.prepare('SELECT id, sha256, collection FROM sources WHERE collection = ? AND uri = ?')
    .get(collection, prepared.uri);
  if (existing && existing.sha256 === prepared.sha256 && !force) {
    // AC16: cambiar sólo las etiquetas no re-trocea, no toca FTS/vectores y no sube index_revision.
    const current = db.prepare('SELECT tag FROM source_tags WHERE source_id = ? ORDER BY tag').all(existing.id).map((row) => row.tag);
    const next = [...tags].sort();
    if (current.join('\u0000') !== next.join('\u0000')) {
      db.prepare('DELETE FROM source_tags WHERE source_id = ?').run(existing.id);
      const insertTag = db.prepare('INSERT INTO source_tags (source_id, tag) VALUES (?, ?)');
      for (const tag of next) insertTag.run(existing.id, tag);
      db.prepare('UPDATE sources SET updated_at = ? WHERE id = ?').run(now, existing.id);
      return { id: existing.id, uri: prepared.uri, chunks: 0, skipped: false, tagsUpdated: true, replacedChunks: 0, reason: 'tags-updated' };
    }
    return { id: existing.id, uri: prepared.uri, chunks: 0, skipped: true, tagsUpdated: false, reason: 'unchanged' };
  }
  const id = existing?.id ?? sourceIdFor(prepared.uri, collection);

  const previous = existing ? db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE source_id = ?').get(id).n : 0;
  if (existing) db.prepare('DELETE FROM chunks WHERE source_id = ?').run(id);

  if (existing) {
    db.prepare(`UPDATE sources SET collection = ?, title = ?, mime = ?, sha256 = ?, bytes = ?, char_count = ?,
      metadata = ?, updated_at = ?, indexed_at = ? WHERE id = ?`)
      .run(collection, prepared.title, prepared.mime, prepared.sha256, prepared.bytes, prepared.text.length,
        '{}', now, now, id);
  } else {
    const created = now;
    db.prepare(`INSERT INTO sources (id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`)
      .run(id, collection, prepared.uri, prepared.title, prepared.mime, prepared.sha256, prepared.bytes,
        prepared.text.length, created, now, now);
  }

  const insertChunk = db.prepare(`INSERT INTO chunks (chunk_key, source_id, ordinal, title, heading, text, char_start, char_end, token_est)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertVector = db.prepare('INSERT INTO vectors (chunk_key, model, dim, vec) VALUES (?, ?, ?, ?)');
  const model = prepared.embeddingModel ?? config.embedding.provider;
  prepared.chunks.forEach((chunk, index) => {
    const chunkKey = `${id}#${chunk.ordinal}`;
    insertChunk.run(chunkKey, id, chunk.ordinal, prepared.title, chunk.heading, chunk.text,
      chunk.charStart, chunk.charEnd, chunk.tokenEst);
    const vector = prepared.vectors[index];
    insertVector.run(chunkKey, model, vector.length, vectorToBlob(vector));
  });

  db.prepare('DELETE FROM source_tags WHERE source_id = ?').run(id);
  const insertTag = db.prepare('INSERT INTO source_tags (source_id, tag) VALUES (?, ?)');
  for (const tag of tags) insertTag.run(id, tag);

  db.prepare("UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'index_revision'").run();
  return { id, uri: prepared.uri, chunks: prepared.chunks.length, skipped: false, replacedChunks: previous };
}

/**
 * Ingesta de una lista de ficheros. Cada fichero es atómico por separado; un fallo no revierte los demás.
 * @returns {{ingested:Array, skipped:Array, errors:Array<{path:string, code:string, message:string}>}}
 */
export async function ingestFiles({
  root, db = undefined, files, collection = 'default', tags = [], now = Date.now(), force = false, config, embedder = undefined, actor = 'model',
  authorize = null,
}) {
  const normalizedTags = normalizeTags(tags);
  const provider = embedder ?? createEmbedder(config);
  // PA3: la herramienta ya abrió el almacén del ámbito autorizado; en ese caso la conexión es
  // prestada y no se cierra aquí. El uso directo (CLI, pruebas) sigue abriendo por su cuenta.
  const opened = db ? { db } : openDatabase({ root, create: true, now });
  const ingested = [];
  const skipped = [];
  const errors = [];
  const stageMs = { extract: 0, chunk: 0, embed: 0, write: 0 };
  let preparedCount = 0;
  const started = Date.now();
  try {
    for (const file of files) {
      // PA4-B: la autorización se comprueba entre fichero y fichero. Cada fichero es su propia
      // transacción, así que abortar aquí no deja escritura a medias: lo confirmado queda confirmado.
      if (authorize) await authorize(file);
      try {
        const prepared = await prepareDocument(file, { config, embedder: provider });
        const writeStarted = process.hrtime.bigint();
        const result = withTransaction(opened.db, () => {
          const written = writeDocument(opened.db, prepared, { collection, tags: normalizedTags, now, force, config });
          appendAudit(opened.db, {
            at: now,
            actor,
            tool: 'lifecode_rag_ingest',
            action: written.skipped ? 'ingest.skip' : written.tagsUpdated ? 'ingest.tags' : 'ingest',
            target: prepared.uri,
            outcome: written.skipped ? 'skipped' : 'ok',
            details: { sourceId: written.id, chunks: written.chunks, bytes: prepared.bytes, replace: Boolean(written.replacedChunks), embedding: prepared.embeddingModel },
          });
          const entries = written.skipped
            ? [{ metric: 'ingest.skipped', value: 1, dim: collection, at: now }]
            : [
              { metric: 'ingest.documents', value: 1, dim: collection, at: now },
              { metric: 'ingest.chunks', value: written.chunks, dim: collection, at: now },
            ];
          recordMetrics(opened.db, entries);
          return written;
        });
        preparedCount += 1;
        stageMs.write += Number(process.hrtime.bigint() - writeStarted) / 1e6;
        stageMs.extract += prepared.timings?.extract ?? 0;
        stageMs.chunk += prepared.timings?.chunk ?? 0;
        stageMs.embed += prepared.timings?.embed ?? 0;
        (result.skipped ? skipped : ingested).push({
          id: result.id, uri: result.uri, chunks: result.chunks, title: prepared.title,
          tagsUpdated: result.tagsUpdated === true, reason: result.reason ?? null,
          warnings: prepared.warnings ?? [],
        });
      } catch (error) {
        // Un fallo de SQLite o de disco no puede tumbar la ingesta de los demás ficheros; se normaliza
        // al contrato de errores para que el resultado sea uniforme y auditable. La contención se
        // traduce a `store-busy` (reintentable) en vez de dejar escapar el `database is locked` crudo.
        const failure = error instanceof RagError
          ? error
          : storeFailure(error, { path: file })
            ?? new RagError('internal', error?.message ?? 'fallo desconocido al ingerir', { cause: error });
        errors.push({
          path: file,
          code: failure.code,
          message: failure.message,
          ...(failure.details?.retryable === true ? { retryable: true } : {}),
        });
        try {
          withTransaction(opened.db, () => {
            appendAudit(opened.db, {
              at: now,
              actor,
              tool: 'lifecode_rag_ingest',
              action: 'ingest',
              target: String(file),
              outcome: 'failed',
              details: { code: failure.code, message: failure.message },
            });
            recordMetrics(opened.db, [{ metric: 'errors', value: 1, dim: failure.code, at: now }]);
          });
        } catch { /* la auditoría del fallo no debe ocultar el fallo original */ }
      }
    }
    try {
      withTransaction(opened.db, () => recordMetrics(opened.db, [
        { metric: 'ingest.ms', value: Math.max(1, Date.now() - started), dim: collection, at: now },
        // Desglose por etapa (UX-2.2 · P1-5): permite responder «¿dónde se fue el tiempo?» sin
        // instrumentar de nuevo. Valores en milisegundos, acumulados del lote.
        // Sin ningún fichero preparado no hay etapas que medir: no se escriben ceros.
        ...(preparedCount > 0
          ? Object.entries(stageMs).map(([stage, value]) => ({
            metric: 'ingest.stage_ms', value: Math.max(0, Math.round(value * 100) / 100), dim: stage, at: now,
          }))
          : []),
      ]));
    } catch { /* la métrica no puede convertir una ingesta correcta en un fallo */ }
    return { ingested, skipped, errors };
  } finally {
    if (!db) opened.db.close();
  }
}
