/**
 * LE-RAG-10 · API PA (solo lectura) para el panel.
 *
 * Núcleo puro: no importa nada del harness. `index.js` la conecta a `webServer`.
 * Rutas: `/snapshot` y `/config` por GET; `/search` y `/context` por POST con cuerpo JSON
 * (contrato `PA-UI-0-API-CONTRACT.md` §6.7 y §6.8); `/actions` responde SIEMPRE 403
 * `approval-required`: ninguna ruta HTTP puede ejecutar ingest/forget/reindex sin la aprobación
 * del host.
 *
 * LE-RAG-11 (D-01): una sola forma de llamar a cada ruta. `/search` y `/context` con GET devuelven
 * 405; no se conservan dos contratos para la misma operación.
 */
import { openRegistry, listRoots } from './registry.mjs';
import { openScopeStore } from './scope-stores.mjs';
import { search } from './search.mjs';
import { assembleContextAsync } from './context.mjs';
import { resolveConfig } from './config-resolve.mjs';
import { DEFAULT_DIM, LOCAL_PROVIDER, embedText } from './embed.mjs';
import { RagError } from './errors.mjs';

export const PA_PREFIX = '/lifecode-rag/pa';
export const PA_VERSION = 'pa/1.0.0';
const MAX_BODY = 1_000_000;
const MAX_LIMIT = 200;
const MAX_SEARCH = 50;
/** Contrato §8: la consulta se limita a 512 caracteres; por encima se rechaza, nunca se recorta. */
const MAX_QUERY = 512;
const GET_ROUTES = { '/': ['project', 'limit', 'cursor'], '/snapshot': ['project', 'limit', 'cursor'] };
const POST_FIELDS = { '/search': ['query', 'limit'], '/context': ['query', 'budgetTokens'] };
/** En POST el proyecto viaja por query string: la cabecera de sesión del contrato está BLOCKED (PA01). */
const POST_PARAMS = ['project'];

const localEmbedder = {
  model: LOCAL_PROVIDER,
  dim: DEFAULT_DIM,
  embed: async (texts) => texts.map((text) => embedText(text)),
};

/** Escribe el sobre contractual (§5): {ok:true,data} o {ok:false,error}. Un cuerpo que supera el tope no se
 * sirve: se responde 500 con el código público response-too-large, nunca un 200 con error dentro. */
function writeJson(res, status, body, limit) {
  const text = JSON.stringify(body);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  if (text.length > limit) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: { code: 'response-too-large', message: 'la respuesta supera el tamaño máximo permitido', details: { limit } } }));
    return;
  }
  res.statusCode = status;
  res.end(text);
}

/** Rechaza parámetros de query no declarados por la ruta (contrato §5: no se ignora nada en silencio). */
function queryParams(url, allowed, route) {
  const unknown = [...new Set([...url.searchParams.keys()].filter((key) => !allowed.includes(key)))];
  if (unknown.length > 0) {
    throw new RagError('invalid-argument', `${route}: parámetro no declarado`, { details: { reason: 'unknown-parameter', parameters: unknown } });
  }
  const q = url.searchParams;
  const limitRaw = q.get('limit');
  const limit = limitRaw === null ? null : Number(limitRaw);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new RagError('invalid-argument', 'limit inválido', { details: { reason: 'invalid-field', field: 'limit' } });
  }  if (limit !== null && limit > MAX_LIMIT) {
    throw new RagError('invalid-argument', 'limit supera ' + MAX_LIMIT, { details: { reason: 'limit-too-large', field: 'limit', max: MAX_LIMIT } });
  }
  return {
    project: q.get('project') || null,
    limit,
    cursor: q.get('cursor') || null,
  };
}

/** Lee el cuerpo JSON de un POST: tamaño acotado, objeto plano y un error propio por cada caso. */
async function readJsonBody(req, limit = MAX_BODY) {
  const chunks = [];
  let size = 0;
  if (req && typeof req[Symbol.asyncIterator] === 'function') {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > limit) throw new RagError('too-large', 'cuerpo de la petición demasiado grande', { details: { limit } });
      chunks.push(buffer);
    }
  } else if (req && req.body !== undefined && req.body !== null) {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (raw.length > limit) throw new RagError('too-large', 'cuerpo de la petición demasiado grande', { details: { limit } });
    chunks.push(Buffer.from(raw));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') throw new RagError('invalid-argument', 'cuerpo JSON obligatorio', { details: { reason: 'missing-body' } });
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new RagError('invalid-argument', 'cuerpo JSON inválido', { details: { reason: 'invalid-json' } });
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new RagError('invalid-argument', 'el cuerpo debe ser un objeto JSON', { details: { reason: 'invalid-body' } });
  }
  return data;
}

function assertKnownFields(body, allowed, route) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new RagError('invalid-argument', `${route}: campo no declarado`, { details: { reason: 'unknown-field', fields: unknown } });
  }
}

function requireQuery(body, route) {
  if (!Object.prototype.hasOwnProperty.call(body, 'query')) {
    throw new RagError('invalid-argument', `${route}: falta query`, { details: { reason: 'missing-field', field: 'query' } });
  }
  if (typeof body.query !== 'string') {
    throw new RagError('invalid-argument', `${route}: query debe ser texto`, { details: { reason: 'invalid-field', field: 'query' } });
  }
  const query = body.query.trim();
  if (query === '') {
    throw new RagError('invalid-argument', `${route}: query vacío`, { details: { reason: 'invalid-field', field: 'query' } });
  }
  if (query.length > MAX_QUERY) {
    throw new RagError('invalid-argument', `${route}: query supera ${MAX_QUERY} caracteres`, { details: { reason: 'query-too-long', field: 'query', max: MAX_QUERY } });
  }
  return query;
}

function searchPayload(body, config) {
  assertKnownFields(body, POST_FIELDS['/search'], '/search');
  const query = requireQuery(body, '/search');
  const fallback = Number.isInteger(config?.search?.limit) ? config.search.limit : 8;
  let limit = Math.min(fallback, MAX_SEARCH);
  if (body.limit !== undefined) {
    if (!Number.isInteger(body.limit) || body.limit < 1) {
      throw new RagError('invalid-argument', '/search: limit inválido', { details: { reason: 'invalid-field', field: 'limit' } });
    }
    if (body.limit > MAX_SEARCH) {
      throw new RagError('invalid-argument', `/search: limit supera ${MAX_SEARCH}`, { details: { reason: 'limit-too-large', field: 'limit', max: MAX_SEARCH } });
    }
    limit = body.limit;
  }
  return { query, limit };
}

function contextPayload(body, config) {
  assertKnownFields(body, POST_FIELDS['/context'], '/context');
  const query = requireQuery(body, '/context');
  const fallback = Number.isInteger(config?.context?.budgetTokens) ? config.context.budgetTokens : 2000;
  let budgetTokens = fallback;
  if (body.budgetTokens !== undefined) {
    if (!Number.isInteger(body.budgetTokens) || body.budgetTokens < 1) {
      throw new RagError('invalid-argument', '/context: budgetTokens inválido', { details: { reason: 'invalid-field', field: 'budgetTokens' } });
    }
    budgetTokens = body.budgetTokens;
  }
  return { query, budgetTokens };
}

function projectView(db, requested) {
  const projects = db.prepare('select id, name from projects order by created_at').all();
  if (projects.length === 0) throw new RagError('project-not-authorized', 'el perfil no tiene proyectos');
  let project = null;
  if (requested) {
    project = projects.find((p) => p.id === requested) ?? null;
    if (!project) throw new RagError('project-not-authorized', 'proyecto desconocido o no autorizado', { details: { project: requested } });
  } else if (projects.length === 1) {
    project = projects[0];
  } else {
    throw new RagError('scope-ambiguous', 'varios proyectos: especifica project', { details: { candidates: projects.map((p) => p.id) } });
  }
  const roots = listRoots(db, { scopeKind: 'prj', scopeId: project.id });
  const authorized = roots.filter((r) => r.state === 'authorized');
  if (authorized.length === 0) throw new RagError('project-not-authorized', 'el proyecto no tiene raíces autorizadas', { details: { project: project.id } });
  return { project, roots, authorized };
}

function openStore(profileRoot, profileKey, scopeId) {
  const store = openScopeStore({ profileRoot, profileKey, scope: { kind: 'prj', id: scopeId }, create: false });
  if (!store) throw new RagError('store-not-initialized', 'el proyecto no tiene almacén', { details: { project: scopeId } });
  return store;
}

function relUri(uri, roots) {
  const norm = (v) => String(v).split(String.fromCharCode(92)).join('/').toLowerCase();
  const target = norm(uri);
  for (const root of roots) {
    const base = norm(root.path);
    if (target === base) return '.';
    if (target.startsWith(base + '/')) return String(uri).slice(root.path.length + 1);
  }
  const parts = String(uri).split(String.fromCharCode(92)).join('/').split('/');
  return parts[parts.length - 1] ?? String(uri);
}

function sourcesPage(db, { limit, cursor, roots = [] }) {
  const take = Math.min(limit ?? 50, MAX_LIMIT);
  const offset = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(offset) || offset < 0) throw new RagError('invalid-argument', 'cursor inválido');
  const total = db.prepare('select count(*) n from sources').get().n;
  const rows = db.prepare(`select s.id, s.uri, s.title, s.mime, s.bytes, s.indexed_at,
      (select count(*) from chunks c where c.source_id = s.id) as chunk_count
    from sources s order by s.uri limit ? offset ?`).all(take, offset);
  return {
    rows: rows.map((r) => ({ id: r.id, uri: relUri(r.uri, roots), title: r.title, mime: r.mime, bytes: r.bytes, chunks: r.chunk_count, indexedAt: r.indexed_at })),
    total,
    nextCursor: offset + rows.length < total ? String(offset + rows.length) : null,
  };
}

function auditHead(db) {
  const row = db.prepare('select max(seq) seq from audit').get();
  return { head: row?.seq ?? 0 };
}

/**
 * @param {{profileRoot: string, profileKey?: string, env?: object, now?: () => number}} options
 */
export function createPaHandler({ profileRoot, profileKey = 'desktop', env = process.env, now = () => Date.now(), maxBody = MAX_BODY } = {}) {
  // Respondedores ligados al tope de esta instancia: la sobrecarga se mide por respuesta.
  const respond = (res, status, payload) => writeJson(res, status, { ok: true, data: payload }, maxBody);
  const failWith = (res, status, code, message, details) => writeJson(res, status, { ok: false, error: { code, message, ...(details ? { details } : {}) } }, maxBody);
  const methodNotAllowed = (res, allowed, message) => failWith(res, 405, 'method-not-allowed', message, { reason: 'method-not-allowed', allow: allowed });

  if (typeof profileRoot !== 'string' || !profileRoot) throw new TypeError('profileRoot obligatorio');

  return async function paHandler(req, res) {
    const started = now();
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(PA_PREFIX)) return failWith(res, 404, 'not-found', 'ruta fuera de la API PA');
      const route = url.pathname.slice(PA_PREFIX.length).replace(/\/+$/, '') || '/';
      const method = (req.method || 'GET').toUpperCase();
      const { config } = resolveConfig({ dataRoot: profileRoot, profileKey });

      // /config no depende de proyecto: se responde antes de abrir el registro.
      if (route === '/config') {
        if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(res, ['GET', 'HEAD'], 'la configuración se lee con GET');
        queryParams(url, [], route);
        return respond(res, 200, { mode: 'api', service: 'ok', version: PA_VERSION, config, profile: { key: profileKey } });
      }

      if (route === '/actions') {
        return failWith(res, 403, 'approval-required', 'las operaciones de escritura requieren aprobación del host', {
          tools: ['lifecode_rag_ingest', 'lifecode_rag_forget', 'lifecode_rag_reindex'],
        });
      }

      let params;
      let payload = null;
      if (Object.prototype.hasOwnProperty.call(POST_FIELDS, route)) {
        // LE-RAG-11: /search y /context son POST con cuerpo JSON. GET sobre ellas se rechaza: una
        // sola forma de llamar a cada ruta (D-01).
        if (method !== 'POST') return methodNotAllowed(res, ['POST'], `${route} se consulta con POST y cuerpo JSON`);
        params = queryParams(url, POST_PARAMS, route);
        const body = await readJsonBody(req, maxBody);
        payload = route === '/search' ? searchPayload(body, config) : contextPayload(body, config);
      } else if (Object.prototype.hasOwnProperty.call(GET_ROUTES, route)) {
        if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(res, ['GET', 'HEAD'], 'la API PA es de solo lectura');
        params = queryParams(url, GET_ROUTES[route], route);
      } else {
        return failWith(res, 404, 'not-found', `ruta PA desconocida: ${route}`);
      }

      let registry;
      try {
        registry = openRegistry({ root: profileRoot, create: false, now: now() });
      } catch (error) {
        if (error instanceof RagError && error.code === 'store-not-initialized') {
          return failWith(res, 503, 'registry-unavailable', 'el perfil no tiene registro Project-Aware');
        }
        throw error;
      }
      const db = registry.db ?? registry;
      try {
        const { project, roots, authorized } = projectView(db, params.project);
        const store = openStore(profileRoot, profileKey, project.id);
        const sdb = store.db ?? store;
        const scope = { id: project.id, kind: 'prj', name: project.name };
        try {
          if (route === '/' || route === '/snapshot') {
            return respond(res, 200, {
              mode: 'api', service: 'ok', asOf: started, version: PA_VERSION,
              project: { id: project.id, name: project.name },
              scopes: [{ kind: 'prj', id: project.id, name: project.name, roots: roots.length, authorized: authorized.length }],
              libraries: [],
              sources: sourcesPage(sdb, { limit: params.limit, cursor: params.cursor, roots: authorized }),
              audit: auditHead(sdb),
              config: { strategy: config.search.strategy, limit: config.search.limit, diversity: config.search.diversity },
            });
          }
          if (route === '/search') {
            const result = await search(sdb, {
              query: payload.query, limit: payload.limit, config, embedder: localEmbedder,
              strategy: config.search.strategy, diversity: config.search.diversity, record: false, now: now(),
            });
            const rows = result.results ?? [];
            return respond(res, 200, {
              mode: config.search.strategy,
              elapsedMs: result.elapsedMs ?? null,
              results: rows.map((r) => ({
                chunkKey: r.chunkKey,
                sourceId: r.sourceId,
                uri: relUri(r.uri, authorized),
                title: r.title,
                heading: r.heading ?? null,
                ordinal: r.ordinal,
                rrf: r.rrf ?? null,
                score: r.score ?? null,
                snippet: r.snippet ?? null,
                scopeId: scope.id,
                scopeKind: scope.kind,
                scopeName: scope.name,
              })),
              scopes: [{ ...scope, results: rows.length }],
            });
          }
          if (route === '/context') {
            const result = await search(sdb, {
              query: payload.query, limit: Math.min(config.search.limit * 2, MAX_SEARCH), config,
              embedder: localEmbedder, strategy: config.search.strategy, record: false, now: now(),
            });
            const assembled = await assembleContextAsync({
              results: result.results ?? [], config, embedder: localEmbedder, maxTokens: payload.budgetTokens,
            });
            const citations = (assembled.citations ?? []).map((citation) => ({ ...citation, uri: relUri(citation.uri, authorized) }));
            return respond(res, 200, {
              mode: config.search.strategy,
              elapsedMs: result.elapsedMs ?? null,
              text: assembled.text ?? '',
              citations,
              tokens: assembled.tokens ?? null,
              truncated: assembled.truncated ?? null,
              considered: assembled.considered ?? null,
              scopes: [{ ...scope, results: citations.length }],
            });
          }
          return failWith(res, 404, 'not-found', `ruta PA desconocida: ${route}`);
        } finally {
          store.close?.();
        }
      } finally {
        (db.close ?? (() => {})).call(db);
      }
    } catch (error) {
      if (error instanceof RagError) {
        const status = error.code === 'invalid-argument' ? 400
          : error.code === 'too-large' ? 413
            : error.code === 'project-not-authorized' || error.code === 'scope-unresolved' || error.code === 'scope-ambiguous' ? 403
              : error.code === 'store-not-initialized' ? 503 : 500;
        return failWith(res, status, error.code, error.message, error.details);
      }
      return failWith(res, 500, 'internal-error', 'error interno del transporte PA');
    }
  };
}
