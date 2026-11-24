/**
 * API HTTP local del Workspace de LifeCode RAG.
 *
 * - Sin dependencias: un handler de Node (`http`) que el host monta con `ctx.webServer.register`.
 * - S?lo loopback: se comprueba `Host` para dificultar DNS rebinding; las escrituras exigen adem?s
 *   la cabecera `x-lifecode-rag: 1` y `content-type: application/json` (CSRF). **No es autenticaci?n**:
 *   un proceso local puede falsificar ambas. Se documenta as? en `WORKSPACE-API.md`.
 * - Toda mutaci?n destructiva exige `confirm: true` en el cuerpo: el bot?n del panel lo pone, una
 *   petici?n suelta no lo adivina.
 * - El actor de auditor?a es `ui` para acciones del panel; las herramientas siguen siendo `model`.
 */

import { appendAudit } from './audit.mjs';
import { assembleContextAsync } from './context.mjs';
import { closeDatabase, openDatabase } from './db.mjs';
import { createEmbedder } from './embedders.mjs';
import { RagError, httpStatusFor } from './errors.mjs';
import { expandInputs } from './inputs.mjs';
import { ingestFiles } from './ingest.mjs';
import { readFileSync } from 'node:fs';

import { forgetSource, reindex } from './maintenance.mjs';
import { purgeMetrics, retentionCutoff, series as metricSeries, summary as metricsSummary } from './metrics.mjs';
import { loadConfig, ragRoot, storePaths, writeConfig } from './paths.mjs';
import { activityFeed, buildSnapshot, listSourceRows } from './readmodel.mjs';
import { getSource, listSources, search } from './search.mjs';

export const API_PREFIX = '/lifecode-rag/api';
// La versión se lee del manifiesto del paquete: una copia literal se desincroniza en cuanto se sube
// la versión (lo detectó `tests/server.test.mjs` al preparar la 1.1.0). El `package.json` viaja en
// el tarball, así que la ruta existe también instalado.
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const BODY_LIMIT = 1_000_000;

// El status de cada código vive en `lib/errors.mjs` (`httpStatusFor`). Esta API mantiene las
// diferencias documentadas de su contrato v0.1 mediante `LEGACY_HTTP_OVERRIDES`, no con una tabla propia.

export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function ok(res, data) {
  send(res, 200, { ok: true, data });
}

function fail(res, status, code, message, details) {
  send(res, status, { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } });
}

function hostOf(req) {
  const header = String(req.headers.host ?? '');
  const host = header.startsWith('[') ? header.slice(0, header.indexOf(']') + 1) : header.split(':')[0];
  return host.toLowerCase();
}

function assertLoopback(req) {
  const host = hostOf(req);
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
    throw new ApiError(403, 'forbidden-host', `Host no permitido: ${host || '(vac?o)'}`);
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new ApiError(403, 'forbidden-origin', 'Origin inv?lido'); }
    const allowed = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
      && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
    if (!allowed) throw new ApiError(403, 'forbidden-origin', `Origen no permitido: ${origin}`);
  }
}

function assertWrite(req) {
  if (req.headers['x-lifecode-rag'] !== '1') {
    throw new ApiError(403, 'missing-client-header', 'Falta x-lifecode-rag: 1');
  }
  const type = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('application/json')) {
    throw new ApiError(415, 'unsupported-media-type', 'Se espera application/json');
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new ApiError(413, 'body-too-large', `El cuerpo supera ${BODY_LIMIT} bytes`);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
    throw new ApiError(400, 'invalid-json', 'El cuerpo no es JSON v?lido');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'invalid-json', 'El cuerpo debe ser un objeto JSON');
  }
  return parsed;
}

function numberArg(value, { fallback = undefined, min = 0, max = 10_000, label = 'valor' } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new ApiError(400, 'invalid-argument', `${label} fuera de rango [${min}, ${max}]`);
  }
  return number;
}

function textArg(value, { fallback = undefined, max = 4_000, label = 'texto' } = {}) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > max) {
    throw new ApiError(400, 'invalid-argument', `${label} inv?lido`);
  }
  return value;
}

function arrayArg(value, { fallback = undefined, max = 200, label = 'lista' } = {}) {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string')) {
    throw new ApiError(400, 'invalid-argument', `${label} inv?lido`);
  }
  return value;
}

function auditUi(db, { action, target = '', outcome = 'ok', details = undefined, at = Date.now(), tool = 'lifecode_rag_ui' }) {
  appendAudit(db, { at, actor: 'ui', tool, action, target, outcome, details });
}

function withStore(root, work, { create = false } = {}) {
  const opened = openDatabase({ root, create });
  try { return work(opened.db); } finally { closeDatabase(opened.db); }
}

export function createApiHandler({ root = ragRoot(), env = process.env, now = () => Date.now() } = {}) {
  const paths = storePaths(root);

  return async function handler(req, res) {
    try {
      assertLoopback(req);
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith(API_PREFIX)) {
        return fail(res, 404, 'not-found', `Ruta fuera de ${API_PREFIX}`);
      }
      const segments = url.pathname.slice(API_PREFIX.length).split('/').filter(Boolean);
      const method = req.method ?? 'GET';
      const { config } = loadConfig(root);
      const moment = now();

      // GET -----------------------------------------------------------------------------------
      if (method === 'GET') {
        if (segments.length === 0 || (segments.length === 1 && segments[0] === 'health')) {
          return ok(res, { ok: true, version: VERSION, store: { path: paths.database }, api: API_PREFIX });
        }
        if (segments.length === 1 && segments[0] === 'capabilities') {
          return ok(res, {
            version: VERSION,
            strategies: ['hybrid', 'fts', 'vector'],
            embedding: { providers: ['local-hash-v1', 'remote'], active: config.embedding.provider, dim: config.embedding.dim },
            automation: { supported: true, defaults: config.automation },
            formats: ['md', 'txt', 'html', 'json', 'jsonl', 'csv', 'tsv', 'yaml', 'xml', 'logs', 'code'],
            toolsFrozen: ['lifecode_rag_ingest', 'lifecode_rag_search', 'lifecode_rag_context', 'lifecode_rag_get', 'lifecode_rag_list', 'lifecode_rag_forget', 'lifecode_rag_reindex'],
          });
        }
        if (segments.length === 1 && segments[0] === 'snapshot') {
          return ok(res, buildSnapshot({ root, now: moment }));
        }
        if (segments.length === 1 && segments[0] === 'config') {
          return ok(res, { config });
        }
        if (segments.length === 1 && segments[0] === 'activity') {
          const limit = numberArg(url.searchParams.get('limit'), { fallback: 40, min: 1, max: 200, label: 'limit' });
          const rows = withStore(root, (db) => activityFeed(db, { limit }));
          return ok(res, { rows });
        }
        if (segments.length === 1 && segments[0] === 'sources') {
          const collection = textArg(url.searchParams.get('collection'), { max: 120, label: 'collection' });
          const tag = textArg(url.searchParams.get('tag'), { max: 64, label: 'tag' });
          const limit = numberArg(url.searchParams.get('limit'), { fallback: 50, min: 1, max: 200, label: 'limit' });
          const offset = numberArg(url.searchParams.get('offset'), { fallback: 0, min: 0, max: 100_000, label: 'offset' });
          const page = withStore(root, (db) => listSourceRows(db, { collection: collection || null, tag: tag || null, limit, offset }));
          return ok(res, page);
        }
        if (segments.length === 2 && segments[0] === 'sources') {
          const source = withStore(root, (db) => getSource(db, segments[1]));
          const chunks = withStore(root, (db) => db.prepare('SELECT ordinal, heading, text, char_start, char_end FROM chunks WHERE source_id = ? ORDER BY ordinal ASC').all(source.id));
          return ok(res, { source, chunks });
        }
        if (segments.length === 4 && segments[0] === 'sources' && segments[2] === 'chunks') {
          const chunk = withStore(root, (db) => {
            const row = db.prepare('SELECT chunk_key, ordinal, heading, text, char_start, char_end FROM chunks WHERE source_id = ? AND ordinal = ?')
              .get(segments[1], Number(segments[3]));
            if (!row) throw new RagError('source-not-found', `sin chunk ${segments[3]} en ${segments[1]}`);
            return row;
          });
          return ok(res, chunk);
        }
        if (segments.length === 2 && segments[0] === 'metrics' && segments[1] === 'summary') {
          const days = numberArg(url.searchParams.get('days'), { fallback: 7, min: 1, max: 365, label: 'days' });
          return ok(res, withStore(root, (db) => metricsSummary(db, { days, now: moment })));
        }
        if (segments.length === 2 && segments[0] === 'metrics' && segments[1] === 'series') {
          const metric = textArg(url.searchParams.get('metric'), { max: 64, label: 'metric' });
          if (!metric) throw new ApiError(400, 'invalid-argument', 'metric es obligatorio');
          const days = numberArg(url.searchParams.get('days'), { fallback: 30, min: 1, max: 365, label: 'days' });
          const dim = textArg(url.searchParams.get('dim'), { max: 64, label: 'dim' });
          return ok(res, withStore(root, (db) => metricSeries(db, { metric, days, dim: dim || undefined, now: moment })));
        }
        return fail(res, 404, 'not-found', `Ruta desconocida: ${url.pathname}`);
      }

      // POST ----------------------------------------------------------------------------------
      if (method !== 'POST') return fail(res, 405, 'method-not-allowed', `M?todo no permitido: ${method}`);
      assertWrite(req);
      const body = await readJson(req);
      const action = url.pathname.slice(API_PREFIX.length);

      if (action === '/search' || action === '/retrieval') {
        const query = textArg(body.query, { max: 2_000, label: 'query' });
        if (typeof query !== 'string' || query.trim() === '') throw new ApiError(400, 'invalid-argument', 'query es obligatorio');
        const limit = numberArg(body.limit, { fallback: config.search.limit, min: 1, max: config.search.maxLimit, label: 'limit' });
        const tags = arrayArg(body.tags, { max: 20, label: 'tags' });
        const tagMode = body.tagMode === 'all' ? 'all' : 'any';
        const strategy = ['hybrid', 'fts', 'vector'].includes(body.strategy) ? body.strategy : config.search.strategy;
        const collection = textArg(body.collection, { max: 120, label: 'collection' });
        const embedder = createEmbedder(config);
        const found = await withStoreAsync(root, (db) => search(db, {
          query, limit, collection: collection || null, tags, tagMode, strategy, config, embedder, now: moment,
        }));
        return ok(res, { ...found, results: found.results.map((row) => ({ ...row, text: String(row.text ?? '').slice(0, 4_000) })) });
      }

      if (action === '/context') {
        const query = textArg(body.query, { max: 2_000, label: 'query' });
        if (typeof query !== 'string' || query.trim() === '') throw new ApiError(400, 'invalid-argument', 'query es obligatorio');
        const budgetTokens = numberArg(body.budgetTokens, { fallback: config.context.budgetTokens, min: 16, max: 32_000, label: 'budgetTokens' });
        const maxChunks = numberArg(body.maxChunks, { fallback: config.context.maxChunks, min: 1, max: 40, label: 'maxChunks' });
        const embedder = createEmbedder(config);
        const built = await withStoreAsync(root, async (db) => {
          const found = await search(db, { query, limit: Math.max(maxChunks, 8), strategy: config.search.strategy, config, embedder, record: false, now: moment });
          return assembleContextAsync({ results: found.results, config, budgetTokens, maxChunks, embedder });
        });
        return ok(res, built);
      }

      if (action === '/actions') {
        const name = textArg(body.action, { max: 40, label: 'action' });
        const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
        const confirm = body.confirm === true;

        if (name === 'ingest') {
          const requested = Array.isArray(payload.paths) ? payload.paths.map(String) : [String(payload.path ?? '')];
          if (requested.filter((item) => item.trim() !== '').length === 0) throw new ApiError(400, 'invalid-argument', 'paths es obligatorio');
          const cwd = textArg(payload.cwd, { max: 1_000, label: 'cwd' }) ?? process.cwd();
          const limit = config.maxFilesPerIngest;
          const classified = expandInputs(requested, { cwd, roots: config.roots.extra, ragRootPath: paths.root, limit });
          const outside = classified.filter((item) => item.outsideRoots.length > 0);
          if (outside.length > 0) {
            throw new ApiError(409, 'path-not-allowed', 'Las rutas fuera del proyecto exigen aprobaci?n humana desde la herramienta; el panel no puede aprobarlas');
          }
          const embedder = createEmbedder(config);
          const result = await ingestFiles({
            root, files: classified.map((item) => item.realPath), collection: payload.collection ?? 'default',
            tags: arrayArg(payload.tags, { max: 20, label: 'tags' }) ?? [], force: payload.force === true, config, embedder, now: moment, actor: 'ui',
          });
          return ok(res, result);
        }

        if (name === 'forget') {
          if (!confirm) throw new ApiError(409, 'confirmation-required', 'forget exige confirm: true con el alcance exacto');
          const ref = textArg(payload.ref, { max: 1_000, label: 'ref' });
          if (!ref) throw new ApiError(400, 'invalid-argument', 'ref es obligatorio');
          const result = withStore(root, (db) => forgetSource(db, { ref, now: moment, actor: 'ui', sessionId: null, callId: null }));
          return ok(res, result);
        }

        if (name === 'reindex') {
          if (!confirm) throw new ApiError(409, 'confirmation-required', 'reindex exige confirm: true');
          const operation = ['fts', 'vectors', 'all'].includes(payload.operation) ? payload.operation : null;
          if (!operation) throw new ApiError(400, 'invalid-argument', "operation debe ser 'fts', 'vectors' o 'all'");
          const result = await withStoreAsync(root, (db) => reindex(db, { operation, config, now: moment, actor: 'ui', signal: undefined }));
          return ok(res, result);
        }

        if (name === 'purge') {
          if (!confirm) throw new ApiError(409, 'confirmation-required', 'purge exige confirm: true');
          const before = textArg(payload.beforeDay, { max: 10, label: 'beforeDay' });
          const result = withStore(root, (db) => {
            const beforeDay = before || retentionCutoff(config, moment);
            const removed = purgeMetrics(db, { beforeDay, at: moment });
            auditUi(db, { action: 'metrics.purge', target: beforeDay, details: { removed }, at: moment });
            return { removed, beforeDay };
          });
          return ok(res, result);
        }

        if (name === 'config') {
          const patch = body.patch;
          if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ApiError(400, 'invalid-argument', 'patch es obligatorio');
          const merged = { ...config, ...patch };
          const written = writeConfig(root, merged, { now: moment });
          withStore(root, (db) => auditUi(db, { action: 'config.update', target: paths.config, details: { keys: Object.keys(patch) }, at: moment }));
          return ok(res, { config: written.config, path: written.path });
        }

        return fail(res, 404, 'not-found', `Acci?n desconocida: ${name}`);
      }

      return fail(res, 404, 'not-found', `Ruta desconocida: ${url.pathname}`);
    } catch (error) {
      if (error instanceof ApiError) return fail(res, error.status, error.code, error.message, error.details);
      if (error instanceof RagError) {
        return fail(res, httpStatusFor(error.code, { legacy: true }), error.code, error.message, error.details);
      }
      return fail(res, 500, 'internal', error?.message ?? 'fallo interno');
    }
  };
}

/** Abre la base, ejecuta trabajo as?ncrono y cierra siempre. */
async function withStoreAsync(root, work) {
  const opened = openDatabase({ root, create: false });
  try { return await work(opened.db); } finally { closeDatabase(opened.db); }
}

