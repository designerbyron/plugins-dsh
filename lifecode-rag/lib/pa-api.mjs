/**
 * LE-RAG-10 · API PA del panel.
 *
 * Núcleo puro: no importa nada del harness. `index.js` la conecta a `webServer`.
 * Rutas de lectura: `/snapshot` y `/config` por GET; `/search` y `/context` por POST con cuerpo JSON
 * (contrato `PA-UI-0-API-CONTRACT.md` §6.7 y §6.8); `/actions` responde SIEMPRE 403
 * `approval-required`: ninguna ruta HTTP puede ejecutar ingest/forget/reindex sin la aprobación
 * del host.
 *
 * ACP-07 F3 · administración de proyectos (§6.12): `/projects` (POST crear, PATCH actualizar),
 * `/projects/archive`, `/projects/restore`, `/roots`, `/roots/remove`, `/projects/register` y
 * `/candidates` (GET). Sólo se atienden con la compuerta del host resuelta: sin ella la
 * administración no existe (503), porque estas rutas no son herramientas del modelo.
 *
 * LE-RAG-11 (D-01): una sola forma de llamar a cada ruta. `/search` y `/context` con GET devuelven
 * 405; no se conservan dos contratos para la misma operación.
 *
 * UX-2.2 (`pa/1.5.0`, aditivo): `/tracking` es la API **humana** del seguimiento de workspaces.
 * `GET` lee; `PUT` y `DELETE` son mutaciones con CAS sobre `revision` y exigen la cabecera CSRF
 * del panel (`x-lifecode-rag: 1`) y `content-type: application/json` (D-UX22-10, D-IMPL-05).
 * Ninguna de las tres es una herramienta del modelo: quien decide el eje A es una persona.
 *
 * P-UX22-01 (cerrada): el fence CSRF no es exclusivo del seguimiento. **Toda** mutación de la API
 * PA — `POST /selection` y los POST de administración (`/projects`, `/projects/archive`,
 * `/projects/restore`, `/roots`, `/roots/remove`, `/projects/register`) — exige las mismas dos
 * cabeceras. `/search` y `/context` son lecturas y quedan fuera a propósito (ver
 * `POST_READ_ROUTES`). Orden de compuertas: autenticación del host → CSRF → validación → operación.
 */
import {
  addRoot, appendRegistryAudit, createProject, getProject, listProjects, listRoots,
  openRegistry, pathKeyFor, removeRoot, restoreProject, updateProject, verifyRegistryAudit,
} from './registry.mjs';
import { withTransaction } from './db.mjs';
import { openScopeStore } from './scope-stores.mjs';
import { search } from './search.mjs';
import { assembleContextAsync } from './context.mjs';
import { resolveConfig } from './config-resolve.mjs';
import { DEFAULT_DIM, LOCAL_PROVIDER, embedText } from './embed.mjs';
import { RagError, httpStatusFor } from './errors.mjs';
import { registryPath } from './profile.mjs';
import { applySelection, archiveProjectWithSelection, readSelection } from './selection.mjs';
import { registerDiscoveredProject, scanWorkspace } from './discovery.mjs';
import { trustedRootFor } from './trusted-roots.mjs';
import { verifyAuditChain } from './audit.mjs';
import { projectWorkspaces } from './harness-workspaces.mjs';
import { projectForPathKey } from './workspaces-projection.mjs';
import { isTrackingState } from './tracking.mjs';
import { TRACKING_LIST_MAX, applyTracking, countTracking, listTracking, removeTracking } from './tracking-store.mjs';

export const PA_PREFIX = '/lifecode-rag/pa';
export const PA_VERSION = 'pa/1.5.0';
const MAX_BODY = 1_000_000;
const MAX_LIMIT = 200;
const MAX_SEARCH = 50;
const MAX_NAME = 120;
const MAX_PATH = 4096;
/** Contrato §8: la consulta se limita a 512 caracteres; por encima se rechaza, nunca se recorta. */
const MAX_QUERY = 512;
const GET_ROUTES = {
  '/': ['project', 'limit', 'cursor'],
  '/snapshot': ['project', 'limit', 'cursor'],
  '/history': ['project', 'limit', 'cursor'],
  // UX-2.1 (§19): workspaces conocidos por el Host. No depende de un proyecto activo.
  '/workspaces': ['limit'],
  // UX-2.2: seguimiento humano por perfil. Tampoco depende de un proyecto activo.
  '/tracking': ['limit'],
};

/**
 * UX-2.2 · seguimiento (`pa/1.5.0`). `PUT` y `DELETE` son las dos únicas mutaciones y van por su
 * propio carril: si cayeran en el carril de `GET_ROUTES` responderían 405 por ser «solo lectura»,
 * que sería falso. Campos del `PUT`: los del contrato; `path` es obligatoria y se valida contra
 * `pathKeyFor(path)` (auditoría F8).
 */
const TRACKING_ROUTE = '/tracking';
const TRACKING_PUT_FIELDS = Object.freeze(['pathKey', 'state', 'projectId', 'expectedRevision', 'path']);
const TRACKING_DELETE_PARAMS = Object.freeze(['pathKey', 'expectedRevision']);
const TRACKING_CSRF_HEADER = 'x-lifecode-rag';
const TRACKING_CSRF_VALUE = '1';
const POST_FIELDS = {
  '/search': ['query', 'limit'],
  '/context': ['query', 'budgetTokens'],
  '/selection': ['projectId', 'expectedRevision'],
};
/** En POST el proyecto viaja por query string: la cabecera de sesión del contrato está BLOCKED (PA01). */
const POST_PARAMS = ['project'];
/**
 * P-UX22-01: los POST de esta tabla que **no** están aquí mutan estado y pasan por el fence CSRF
 * (hoy sólo `/selection`). `/search` y `/context` quedan FUERA a propósito, y la razón es de
 * dominio, no de comodidad: consultan el almacén con `record:false` —no escriben fila, no auditan
 * y no tocan el registro—, así que no hay nada que un CSRF pudiera provocar; exigirles el testigo
 * sólo rompería a los consumidores que ya las usan como consulta. La lista es la de **lecturas**,
 * no la de mutaciones: una ruta POST nueva entra al fence por defecto, sin que nadie se acuerde.
 */
const POST_READ_ROUTES = Object.freeze(['/search', '/context']);

/**
 * Administración de proyectos (ACP-07 F3, contrato §6.12).
 *
 * `fields` es por método y es la lista **exacta** de campos aceptados: lo no declarado se rechaza
 * (`unknown-field`), como en el resto de la API. Ninguna de estas rutas es una herramienta del
 * modelo: sin compuerta del host no se atienden (ver `adminGate`).
 */
const ADMIN_ROUTES = Object.freeze({
  '/projects': {
    methods: ['POST', 'PATCH'],
    fields: { POST: ['name', 'path'], PATCH: ['id', 'name'] },
  },
  '/projects/archive': { methods: ['POST'], fields: { POST: ['id'] } },
  '/projects/restore': { methods: ['POST'], fields: { POST: ['id'] } },
  '/roots': { methods: ['POST'], fields: { POST: ['projectId', 'path'] } },
  '/roots/remove': { methods: ['POST'], fields: { POST: ['rootId', 'projectId', 'path', 'allowEmpty'] } },
  '/projects/register': { methods: ['POST'], fields: { POST: ['path', 'name'] } },
  '/candidates': { methods: ['GET', 'HEAD'], fields: {}, query: ['project', 'path', 'maxDepth'] },
});

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

/** CR-1 (§6.2): el cuerpo declara el proyecto y la revisión que el cliente cree vigente. */
function selectionPayload(body) {
  assertKnownFields(body, POST_FIELDS['/selection'], '/selection');
  if (!Object.prototype.hasOwnProperty.call(body, 'projectId')) {
    throw new RagError('invalid-argument', '/selection: falta projectId', { details: { reason: 'missing-field', field: 'projectId' } });
  }
  if (typeof body.projectId !== 'string' || !body.projectId.startsWith('prj_')) {
    throw new RagError('invalid-argument', '/selection: projectId debe ser un identificador de proyecto', { details: { reason: 'invalid-field', field: 'projectId' } });
  }
  return { projectId: body.projectId, expectedRevision: body.expectedRevision };
}

/** Cabecera por nombre, sin depender de que Node la haya bajado a minúsculas (pruebas, dobles). */
function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined;
  if (headers[name] !== undefined) return headers[name];
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

function headerText(value) {
  return String(Array.isArray(value) ? value[0] ?? '' : value ?? '');
}

/**
 * CSRF de las mutaciones humanas de la API PA (D-UX22-10 / D-IMPL-05 / P-UX22-01): la cabecera del
 * panel **y** `content-type: application/json`. Se comprueba ANTES de leer el cuerpo y de tocar el
 * registro: una petición sin la cabecera no llega a la transacción ni deja rastro en la auditoría.
 * Vale igual para `/tracking` (PUT/DELETE) que para `/selection` y los POST de administración: un
 * solo fence, un solo sitio donde se decide qué es una mutación humana.
 */
function assertMutationCsrf(req, route) {
  const headers = req?.headers ?? {};
  const missing = [];
  if (headerText(headerValue(headers, TRACKING_CSRF_HEADER)) !== TRACKING_CSRF_VALUE) missing.push(TRACKING_CSRF_HEADER);
  const contentType = headerText(headerValue(headers, 'content-type')).split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') missing.push('content-type');
  if (missing.length > 0) {
    throw new RagError('forbidden', `${route}: falta la protección CSRF de la API humana`, {
      details: { reason: 'csrf', missing },
    });
  }
}

/**
 * `expectedRevision` obligatoria (0 = «espero que no exista»). Falta no es lo mismo que inválida:
 * el panel necesita distinguir «no lo mandaste» de «mandaste basura». En query el valor llega como
 * texto; aquí se convierte sin aceptar `3.5` ni `-1`.
 */
function requireExpectedRevision(value, { route, fromQuery = false } = {}) {
  if (value === undefined || value === null || (fromQuery && value === '')) {
    throw new RagError('invalid-argument', `${route}: falta expectedRevision`, {
      details: { reason: 'missing-field', field: 'expectedRevision' },
    });
  }
  const revision = fromQuery ? Number(value) : value;
  if (!Number.isInteger(revision) || revision < 0) {
    throw new RagError('invalid-argument', `${route}: expectedRevision debe ser un entero no negativo`, {
      details: { reason: 'invalid-field', field: 'expectedRevision' },
    });
  }
  return revision;
}

/**
 * F8 · Ruta absoluta para el seguimiento: en Windows, letra de unidad (`C:\` o `C:/`) o UNC
 * (`\\servidor\recurso`); en POSIX, barra inicial. `node:path.isAbsolute` no sirve aquí: depende de
 * la plataforma del proceso y el contrato habla del workspace que la persona ve, igual que
 * `pathKeyFor`, que también es explícito sobre mayúsculas y separadores.
 */
function isAbsoluteWorkspacePath(path) {
  if (process.platform === 'win32') return /^[a-zA-Z]:[\\/]/.test(path) || /^[\\/]{2}/.test(path);
  return path.startsWith('/');
}

/**
 * F8 · Segmento `..` literal. No se resuelve la ruta para juzgarla: `pathKeyFor` normaliza y
 * `..` desaparecería del valor visible, así que la comprobación es sobre lo que llegó.
 */
function hasParentSegment(path) {
  return path.split(/[\\/]+/).some((segment) => segment === '..');
}

/**
 * Cuerpo del `PUT /tracking`. El contrato fija `{pathKey, state, projectId?, expectedRevision, path}`.
 *
 * F8 · `path` es **obligatoria** y debe ser una ruta absoluta real, sin `..` ni NUL, y su clave
 * canónica tiene que ser exactamente `pathKey`. Antes se aceptaba cualquier `pathKey` de texto y, si
 * faltaba `path`, se guardaba la clave en minúsculas como «ruta que vio la persona»: dos formas de
 * que la fila mintiera sobre el workspace. La canonicalización **no se reimplementa**: se compara
 * contra `pathKeyFor` (`lib/registry.mjs`), que resuelve `realpath` cuando la ruta existe — por eso
 * se compara contra su resultado real y no contra una suposición del cliente.
 */
function trackingPayload(body) {
  assertKnownFields(body, TRACKING_PUT_FIELDS, TRACKING_ROUTE);
  if (!Object.prototype.hasOwnProperty.call(body, 'pathKey') || body.pathKey === null) {
    throw new RagError('invalid-argument', `${TRACKING_ROUTE}: falta pathKey`, { details: { reason: 'missing-field', field: 'pathKey' } });
  }
  if (typeof body.pathKey !== 'string' || body.pathKey.trim() === '') {
    throw new RagError('invalid-argument', `${TRACKING_ROUTE}: pathKey debe ser una clave de ruta`, { details: { reason: 'invalid-field', field: 'pathKey' } });
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'state') || body.state === null) {
    throw new RagError('invalid-argument', `${TRACKING_ROUTE}: falta state`, { details: { reason: 'missing-field', field: 'state' } });
  }
  if (!isTrackingState(body.state)) {
    throw new RagError('invalid-argument', `${TRACKING_ROUTE}: state no es un estado de seguimiento`, {
      details: { reason: 'invalid-field', field: 'state', value: body.state },
    });
  }
  const expectedRevision = requireExpectedRevision(body.expectedRevision, { route: TRACKING_ROUTE });
  if (body.projectId !== undefined && body.projectId !== null && typeof body.projectId !== 'string') {
    throw new RagError('invalid-argument', `${TRACKING_ROUTE}: projectId debe ser texto o nulo`, { details: { reason: 'invalid-field', field: 'projectId' } });
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'path') || body.path === null) {
    throw new RagError('invalid-argument', `${TRACKING_ROUTE}: falta path`, { details: { reason: 'missing-field', field: 'path' } });
  }
  if (typeof body.path !== 'string' || body.path.trim() === '' || body.path.length > MAX_PATH || body.path.includes('\0')) {
    throw new RagError('invalid-argument', `${TRACKING_ROUTE}: path debe ser una ruta no vacía`, { details: { reason: 'invalid-field', field: 'path' } });
  }
  if (!isAbsoluteWorkspacePath(body.path)) {
    throw new RagError('invalid-argument', `${TRACKING_ROUTE}: path debe ser una ruta absoluta`, { details: { reason: 'invalid-field', field: 'path' } });
  }
  if (hasParentSegment(body.path)) {
    throw new RagError('invalid-argument', `${TRACKING_ROUTE}: path no puede contener '..'`, { details: { reason: 'invalid-field', field: 'path' } });
  }
  const expectedPathKey = pathKeyFor(body.path);
  if (body.pathKey !== expectedPathKey) {
    // Ni se corrige ni se ignora: el cliente y el registro no hablan del mismo workspace.
    throw new RagError('invalid-argument', `${TRACKING_ROUTE}: pathKey no corresponde a path`, {
      details: { reason: 'pathKey-mismatch', pathKey: body.pathKey, expectedPathKey },
    });
  }
  return {
    pathKey: body.pathKey,
    path: body.path,
    state: body.state,
    projectId: body.projectId,
    expectedRevision,
  };
}

/** Query del `DELETE /tracking`: `pathKey` y `expectedRevision`, y nada más. */
function trackingDeleteParams(url, route) {
  const unknown = [...new Set([...url.searchParams.keys()].filter((key) => !TRACKING_DELETE_PARAMS.includes(key)))];
  if (unknown.length > 0) {
    throw new RagError('invalid-argument', `${route}: parámetro no declarado`, { details: { reason: 'unknown-parameter', parameters: unknown } });
  }
  const pathKey = url.searchParams.get('pathKey');
  if (pathKey === null || pathKey.trim() === '') {
    throw new RagError('invalid-argument', `${route}: falta pathKey`, { details: { reason: 'missing-field', field: 'pathKey' } });
  }
  return {
    pathKey,
    expectedRevision: requireExpectedRevision(url.searchParams.get('expectedRevision'), { route, fromQuery: true }),
  };
}

/** Raíces autorizadas de los proyectos activos: el mismo criterio que usa `/workspaces`. */
function workspaceRoots(db) {
  const names = new Map(listProjects(db, { status: 'active' }).projects.map((project) => [project.id, project.name]));
  return listRoots(db)
    .filter((row) => row.scope_kind === 'prj' && row.state === 'authorized' && names.has(row.scope_id))
    .map((row) => ({ projectId: row.scope_id, name: names.get(row.scope_id), path: row.path }));
}

/** id → nombre de **todos** los proyectos: el seguimiento puede apuntar a uno archivado. */
function projectNameMap(db) {
  return new Map(db.prepare('select id, name from projects').all().map((row) => [row.id, row.name]));
}

/**
 * Fila de seguimiento enriquecida: `project` es el join al registro (nombre, o `null` si el
 * proyecto ya no está) y `relation` la del workspace contra las raíces autorizadas, con la misma
 * regla que `/workspaces`. No autoriza nada: describe.
 */
function trackingItemView(row, { roots = [], projectNames = null } = {}) {
  const name = row && row.projectId && projectNames instanceof Map ? projectNames.get(row.projectId) : null;
  const match = projectForPathKey(row?.pathKey, roots);
  return {
    ...row,
    project: name ? { id: row.projectId, name } : null,
    relation: match ? match.relation : 'none',
  };
}

/**
 * Proyecto efectivo de la petición, en este orden: el que pide el cliente, la selección persistida
 * del perfil (CR-1) y, si sólo hay uno, ese. Con varios proyectos y sin selección se responde
 * `scope-ambiguous`: nunca se elige uno «por defecto» a la callada.
 */
function projectView(db, requested, selection = null) {
  // Sólo proyectos ACTIVOS: un proyecto archivado no es seleccionable ni consultable como activo,
  // aunque alguien pida su id (aparece en `archived` del snapshot, que es donde se restaura).
  const projects = db.prepare(`select id, name from projects where status='active' order by created_at`).all();
  if (projects.length === 0) throw new RagError('project-not-authorized', 'el perfil no tiene proyectos');
  let project = null;
  if (requested) {
    project = projects.find((p) => p.id === requested) ?? null;
    if (!project) throw new RagError('project-not-authorized', 'proyecto desconocido o no autorizado', { details: { project: requested } });
  } else if (selection) {
    project = projects.find((p) => p.id === selection.projectId) ?? null;
    // Una selección que apunta a un proyecto desaparecido o archivado no se usa en silencio: se
    // ignora y se resuelve como si no hubiera selección.
  }
  if (!project) {
    if (projects.length === 1) project = projects[0];
    else throw new RagError('scope-ambiguous', 'varios proyectos: especifica project', { details: { candidates: projects.map((p) => p.id) } });
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
 * Proyectos seleccionables del perfil: id, nombre y raíces autorizadas. Es lo que el panel necesita
 * para ofrecer el cambio de proyecto (CR-1); sin esta lista el selector sólo podía mostrar el activo.
 *
 * F3 añade claves, no las cambia: `roots`/`authorized` siguen siendo el número de raíces autorizadas
 * y la lista sigue conteniendo sólo proyectos activos. Lo nuevo es `status`, `total` (raíces
 * registradas) y `selectable`, que ya tiene en cuenta si el proyecto puede usarse.
 */
function projectsIndex(db, currentId) {
  const rows = db.prepare(`select p.id, p.name, p.status,
      (select count(*) from roots r where r.scope_kind='prj' and r.scope_id=p.id) as total,
      (select count(*) from roots r where r.scope_kind='prj' and r.scope_id=p.id and r.state='authorized') as roots
    from projects p where p.status='active' order by p.created_at`).all();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    roots: Number(row.roots),
    authorized: Number(row.roots),
    total: Number(row.total),
    current: row.id === currentId,
    selectable: Number(row.roots) > 0,
  }));
}

/** Proyectos archivados: no son seleccionables, pero el panel debe poder restaurarlos (F4). */
function archivedIndex(db) {
  const rows = db.prepare(`select p.id, p.name, p.archived_at,
      (select count(*) from roots r where r.scope_kind='prj' and r.scope_id=p.id) as total,
      (select count(*) from roots r where r.scope_kind='prj' and r.scope_id=p.id and r.state='authorized') as roots
    from projects p where p.status='archived' order by p.archived_at, p.id`).all();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: 'archived',
    roots: Number(row.roots),
    total: Number(row.total),
    archivedAt: row.archived_at === null ? null : Number(row.archived_at),
    current: false,
    selectable: false,
  }));
}

/** Lo que esta versión de la API ofrece a la interfaz (F4). Es informativo y aditivo. */
function adminCapabilities() {
  return {
    projects: ['create', 'update', 'archive', 'restore'],
    roots: ['add', 'remove'],
    discovery: ['candidates', 'register'],
  };
}

/**
 * Raíces de los proyectos con su ruta. El recuento no basta para la interfaz: para retirar una raíz
 * concreta hay que conocer su id y su ruta (ACP-07 F4). Es aditivo en `pa/1.3.0`.
 */
function rootsIndex(db) {
  return listRoots(db)
    .filter((row) => row.scope_kind === 'prj')
    .map((row) => ({ scopeId: row.scope_id, id: row.id, path: row.path, state: row.state }));
}

/** Vista resumida de un proyecto para las respuestas de administración. */
function projectAdminView(db, projectId) {
  const project = getProject(db, projectId);
  if (!project) throw new RagError('project-not-found', 'el proyecto no existe en este perfil', { details: { project: projectId } });
  const roots = listRoots(db, { scopeKind: 'prj', scopeId: projectId });
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    createdAt: Number(project.created_at),
    updatedAt: Number(project.updated_at),
    archivedAt: project.archived_at === null ? null : Number(project.archived_at),
    roots: {
      total: roots.length,
      authorized: roots.filter((r) => r.state === 'authorized').length,
    },
  };
}

/**
 * Claves de `audit.details` que se publican. El resto se descarta: los detalles pueden llevar rutas
 * absolutas, ids de otros ámbitos o mensajes de error con trayectorias, y el historial es de lectura.
 */
const HISTORY_DETAIL_KEYS = Object.freeze(['sourceId', 'chunks', 'bytes', 'code', 'revision', 'replace', 'embedding', 'skipped']);

function safeDetails(raw) {
  if (raw === null || raw === undefined) return null;
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out = {};
  for (const key of HISTORY_DETAIL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) out[key] = parsed[key];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Historial del proyecto ACTIVO, leído de SU almacén (`audit`), que es la cadena encadenada por hash.
 * No hay forma de ver el historial de otro proyecto por esta ruta: cada proyecto tiene su propio
 * fichero y sus propias filas, así que el filtro de ámbito es estructural, no un `where` que se pueda
 * olvidar. `details` se filtra por lista blanca y `target` se relativiza a las raíces autorizadas.
 */
function historyPage(db, { limit, cursor, roots, scope }) {
  const take = Math.min(limit ?? 50, MAX_LIMIT);
  const before = cursor ? Number(cursor) : null;
  if (before !== null && (!Number.isInteger(before) || before < 0)) {
    throw new RagError('invalid-argument', 'cursor inválido', { details: { reason: 'invalid-field', field: 'cursor' } });
  }
  const total = db.prepare('select count(*) n from audit').get().n;
  const rows = before === null
    ? db.prepare(`select seq, at, actor, tool, action, target, outcome, details, hash
        from audit order by seq desc limit ?`).all(take)
    : db.prepare(`select seq, at, actor, tool, action, target, outcome, details, hash
        from audit where seq < ? order by seq desc limit ?`).all(before, take);
  const entries = rows.map((row) => ({
    seq: row.seq,
    at: Number(row.at),
    actor: row.actor,
    tool: row.tool,
    action: row.action,
    target: row.target === null ? null : relUri(row.target, roots),
    outcome: row.outcome,
    hash: String(row.hash).slice(0, 16),
    details: safeDetails(row.details),
  }));
  const oldest = entries.length > 0 ? entries[entries.length - 1].seq : null;
  return {
    scope,
    total,
    entries,
    nextCursor: oldest !== null && oldest > 1 ? String(oldest) : null,
  };
}

/** Campos de administración: texto obligatorio u opcional, con tope y sin recortes silenciosos. */
function adminField(body, field, { route, max = MAX_NAME, required = true } = {}) {
  const value = body ? body[field] : undefined;
  if (value === undefined || value === null) {
    if (!required) return null;
    throw new RagError('invalid-argument', `${route}: falta el campo ${field}`, { details: { reason: 'missing-field', field } });
  }
  if (typeof value !== 'string') {
    throw new RagError('invalid-argument', `${route}: ${field} debe ser texto`, { details: { reason: 'invalid-field', field } });
  }
  const text = value.trim();
  if (text === '') {
    throw new RagError('invalid-argument', `${route}: ${field} no puede estar vacío`, { details: { reason: 'invalid-field', field } });
  }
  if (text.length > max) {
    throw new RagError('invalid-argument', `${route}: ${field} supera ${max} caracteres`, { details: { reason: 'field-too-long', field, max } });
  }
  return text;
}

function adminProject(db, projectId) {
  const project = getProject(db, projectId);
  if (!project) {
    throw new RagError('project-not-found', 'el proyecto no existe en este perfil', { details: { project: projectId } });
  }
  return project;
}

/**
 * Toda escritura de administración deja su entrada en la cadena del registro. `addRoot` y
 * `createProject` son operaciones de dominio que no auditan por sí solas: la ruta las envuelve en
 * una transacción y añade el asiento, de modo que no existe escritura sin rastro.
 */
function auditedWrite(db, { action, detail, now, work }) {
  return withTransaction(db, () => {
    const result = work();
    appendRegistryAudit(db, {
      at: now, actor: 'human', sessionId: null, action, target: result.id, outcome: 'ok',
      detail: typeof detail === 'function' ? detail(result) : detail,
    });
    return result;
  });
}

/**
 * Descubrimiento de candidatos: lee el disco y **no escribe nada** (decisión D-02 y D-05). Exige una
 * raíz autorizada para lectura, porque recorrer un árbol es leerlo.
 */
function candidateRootPath(db, { project: projectParam, path: pathParam }) {
  if (pathParam) return pathParam;
  const rows = projectParam
    ? db.prepare(`select path from roots where scope_kind='prj' and scope_id=? and state='authorized' order by path`).all(projectParam)
    : db.prepare(`select path from roots where scope_kind='prj' and state='authorized' order by path`).all();
  if (rows.length === 1) return rows[0].path;
  throw new RagError('invalid-argument', 'indica path: hay varias raíces autorizadas', {
    details: { reason: 'path-required', roots: rows.map((row) => row.path) },
  });
}

function assertReadableRoot(db, path) {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new RagError('invalid-argument', 'la ruta es obligatoria', { details: { reason: 'missing-field', field: 'path' } });
  }
  const trust = trustedRootFor(db, pathKeyFor(path));
  if (!trust || trust.readAuthorization !== true) {
    throw new RagError('scope-unresolved', 'la raíz no está autorizada para lectura', {
      details: {
        reason: 'project-not-authorized',
        path,
        command: `node bin/lifecode-rag.mjs trust add --path "${path}"`,
      },
    });
  }
}

/**
 * Despacho de la administración de proyectos (F3). Recibe el registro ya abierto y devuelve
 * `{status, data}`; no escribe nada fuera de las operaciones de F1/F2 ni abre almacenes de ámbito:
 * archivar, restaurar, renombrar y quitar una raíz no tocan `scopes/<id>/rag.sqlite3`.
 */
async function adminDispatch(db, { route, method, body, url, principal, now, profileRoot }) {
  const integrity = () => verifyRegistryAudit(db);

  if (route === '/projects' && method === 'POST') {
    const name = adminField(body, 'name', { route });
    const path = adminField(body, 'path', { route, max: MAX_PATH, required: false });
    if (!path) {
      // Proyecto sin raíz: existe en el registro y se le añaden raíces después. No es seleccionable
      // hasta que tenga al menos una (lo refleja `selectable`).
      const created = auditedWrite(db, {
        action: 'project.create', detail: { name, path: null }, now,
        work: () => createProject(db, { name, now }),
      });
      return {
        status: 201,
        data: { created: true, project: projectAdminView(db, created.id), integrity: integrity() },
      };
    }
    const outcome = withTransaction(db, () => {
      const existing = db.prepare(`select scope_id from roots where scope_kind='prj' and path_key=? limit 1`).get(pathKeyFor(path));
      if (existing) return { created: false, projectId: existing.scope_id };
      const project = createProject(db, { name, now });
      const root = addRoot(db, { scopeKind: 'prj', scopeId: project.id, path, addedBy: 'human', now });
      appendRegistryAudit(db, {
        at: now, actor: 'human', sessionId: null, action: 'project.create', target: project.id,
        outcome: 'ok', detail: { name: project.name, path: root.path, rootId: root.id },
      });
      return { created: true, projectId: project.id };
    });
    return {
      status: outcome.created ? 201 : 200,
      data: {
        created: outcome.created,
        project: projectAdminView(db, outcome.projectId),
        integrity: integrity(),
      },
    };
  }

  if (route === '/projects' && method === 'PATCH') {
    const id = adminField(body, 'id', { route });
    const name = adminField(body, 'name', { route });
    adminProject(db, id);
    const result = updateProject(db, { id, name, now, actor: 'human' });
    return {
      status: 200,
      data: { changed: result.changed, project: projectAdminView(db, id), integrity: integrity() },
    };
  }

  if (route === '/projects/archive') {
    const id = adminField(body, 'id', { route });
    adminProject(db, id);
    // Archivar el proyecto seleccionado mueve o retira la selección en la MISMA transacción (F1).
    const result = archiveProjectWithSelection(db, {
      projectId: id, now, actor: 'human', principal: principal ?? 'owner',
    });
    return {
      status: 200,
      data: {
        changed: result.changed,
        project: projectAdminView(db, id),
        selection: result.selection,
        selectionChange: result.selectionChange,
        integrity: integrity(),
      },
    };
  }

  if (route === '/projects/restore') {
    const id = adminField(body, 'id', { route });
    adminProject(db, id);
    const result = restoreProject(db, { id, now, actor: 'human' });
    return {
      status: 200,
      data: { changed: result.changed, project: projectAdminView(db, id), integrity: integrity() },
    };
  }

  if (route === '/roots') {
    const projectId = adminField(body, 'projectId', { route });
    adminProject(db, projectId);
    const path = adminField(body, 'path', { route, max: MAX_PATH });
    const root = auditedWrite(db, {
      action: 'root.add', detail: { scopeId: projectId, path }, now,
      work: () => addRoot(db, { scopeKind: 'prj', scopeId: projectId, path, addedBy: 'human', now }),
    });
    return {
      status: 201,
      data: {
        root: { id: root.id, path: root.path, state: 'authorized' },
        project: projectAdminView(db, projectId),
        integrity: integrity(),
      },
    };
  }

  if (route === '/roots/remove') {
    const rootId = adminField(body, 'rootId', { route, required: false });
    const projectId = adminField(body, 'projectId', { route, required: false });
    const path = adminField(body, 'path', { route, max: MAX_PATH, required: false });
    if (body && body.allowEmpty !== undefined && typeof body.allowEmpty !== 'boolean') {
      throw new RagError('invalid-argument', '/roots/remove: allowEmpty debe ser booleano', { details: { reason: 'invalid-field', field: 'allowEmpty' } });
    }
    let target = rootId;
    if (!target) {
      if (!projectId || !path) {
        throw new RagError('invalid-argument', '/roots/remove: indica rootId o projectId y path', {
          details: { reason: 'missing-field', fields: ['rootId', 'projectId+path'] },
        });
      }
      const row = db.prepare(`select id from roots where scope_kind='prj' and scope_id=? and path_key=?`)
        .get(projectId, pathKeyFor(path));
      if (!row) throw new RagError('source-not-found', 'la raíz no existe en este proyecto', { details: { project: projectId, path } });
      target = row.id;
    }
    const result = removeRoot(db, { rootId: target, allowEmpty: body?.allowEmpty === true, now, actor: 'human' });
    return {
      status: 200,
      data: {
        removed: result.removed,
        project: projectAdminView(db, result.removed.scopeId),
        integrity: integrity(),
      },
    };
  }

  if (route === '/candidates') {
    const path = candidateRootPath(db, {
      project: url.searchParams.get('project'),
      path: url.searchParams.get('path'),
    });
    assertReadableRoot(db, path);
    const maxDepthRaw = url.searchParams.get('maxDepth');
    const maxDepth = maxDepthRaw === null ? undefined : Number(maxDepthRaw);
    if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 8)) {
      throw new RagError('invalid-argument', 'maxDepth debe ser un entero entre 0 y 8', { details: { reason: 'invalid-field', field: 'maxDepth', max: 8 } });
    }
    const scan = scanWorkspace(path, maxDepth === undefined ? {} : { maxDepth });
    const registered = new Set(db.prepare(`select path_key from roots where scope_kind='prj'`).all().map((row) => row.path_key));
    return {
      status: 200,
      data: {
        root: scan.root,
        total: scan.projects.length,
        truncated: scan.truncated,
        candidates: scan.projects.map((row) => ({
          path: row.path,
          name: row.name,
          manifestName: row.manifestName ?? null,
          type: row.type,
          indicators: row.indicators,
          depth: row.depth,
          registered: registered.has(row.pathKey),
          action: registered.has(row.pathKey) ? null : 'register-project',
        })),
        skipped: scan.skipped,
      },
    };
  }

  if (route === '/projects/register') {
    const path = adminField(body, 'path', { route, max: MAX_PATH });
    const name = adminField(body, 'name', { route, required: false });
    assertReadableRoot(db, path);
    // Registrar es un acto explícito y separado del descubrimiento: es la persona quien lo pide.
    const result = registerDiscoveredProject(db, {
      path, ...(name ? { name } : {}), type: 'unknown', source: 'api', now,
    });
    return {
      status: result.created ? 201 : 200,
      data: {
        created: result.created,
        registeredRoot: result.registeredRoot ?? null,
        error: result.error ?? null,
        project: projectAdminView(db, result.projectId),
        integrity: integrity(),
      },
    };
  }

  return failDispatch(route);
}

function failDispatch(route) {
  throw new RagError('not-found', `ruta PA desconocida: ${route}`);
}

/**
 * @param {{profileRoot: string, profileKey?: string, env?: object, now?: () => number,
 *          maxBody?: number, authorize?: (request: {headers: object, method: string, url: URL}) =>
 *            Promise<{ok: boolean, peer?: {id?: string, principal?: {kind?: string}}, status?: number,
 *                      code?: string, message?: string}> | {ok: boolean, peer?: object}} options
 *
 * `authorize` es la compuerta del anfitrión (PA01). Sin ella el núcleo sigue sirviendo tal cual —es
 * su contrato de independencia—, pero el adaptador de DSH **siempre** pasa una, y cuando el host no
 * ofrece servicio de conexión pasa una que niega: la ausencia de compuerta no se degrada a «abierto».
 *
 * ACP-07 F3: `authorize` es además lo que habilita la administración. Sin compuerta, las rutas
 * `/projects*`, `/roots*` y `/candidates` responden 503 `authorization-unavailable`: no existe
 * una versión «abierta» de la administración para un host que no identifica a nadie.
 *
 * UX-2.1: `services` lleva las fuentes del host que la API no puede resolver sola — el registro de
 * workspaces (`list()`) y el servicio de sesiones (`list()` de las vivas). Es un objeto plano y
 * **opcional**: sin él, `GET /workspaces` responde `source:'none'` con su motivo, nunca una lista
 * vacía que parezca un resultado. Se lee en cada petición (getters del adaptador), no al crear el
 * handler: en `apply()` el registro del host puede no estar listo todavía.
 */
export function createPaHandler({
  profileRoot, profileKey = 'desktop', env = process.env, now = () => Date.now(),
  maxBody = MAX_BODY, authorize = null, services = null,
} = {}) {
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

      // PA01: la compuerta va ANTES de resolver la ruta. Sin credencial del host no se distingue una
      // ruta existente de una inventada: 401/403 y nada más.
      let peer = null;
      if (authorize) {
        let decision;
        try {
          decision = await authorize({ headers: req.headers ?? {}, method, url });
        } catch {
          return failWith(res, 503, 'authorization-unavailable', 'la compuerta de autenticación del host falló');
        }
        if (!decision || decision.ok !== true) {
          const status = decision?.status === 401 ? 401 : (decision?.status ?? 403);
          const code = decision?.code ?? (status === 401 ? 'unauthenticated' : 'authorization-unavailable');
          return failWith(res, status, code, decision?.message ?? 'la petición no está autenticada por el host');
        }
        peer = decision.peer ?? null;
      }
      const principal = peer && peer.principal && peer.principal.kind ? String(peer.principal.kind) : null;

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
      let trackingBody = null;
      const adminSpec = Object.prototype.hasOwnProperty.call(ADMIN_ROUTES, route) ? ADMIN_ROUTES[route] : null;
      let adminBody = null;
      if (adminSpec) {
        // Administración (F3): métodos declarados, sin campos de más y con la compuerta del host ya
        // resuelta. Si el host no ofrece compuerta, la administración no existe (503).
        if (!adminSpec.methods.includes(method)) {
          return methodNotAllowed(res, adminSpec.methods, `${route} se llama con ${adminSpec.methods.join(' o ')}`);
        }
        if (!authorize) {
          return failWith(res, 503, 'authorization-unavailable',
            'la administración de proyectos exige la compuerta del host');
        }
        // P-UX22-01: los POST de administración mutan el registro, así que exigen las mismas
        // cabeceras que `/tracking`. Va aquí —compuerta del host resuelta y antes de leer el
        // cuerpo—: autenticación → CSRF → validación → operación. Sin testigo no hay cuerpo que
        // parsear ni escritura que auditar. `PATCH /projects` (renombrar) queda fuera del encargo
        // (no es POST y un navegador no puede emitirlo sin preflight CORS): hueco declarado, no
        // olvidado.
        if (method === 'POST') assertMutationCsrf(req, route);
        params = queryParams(url, adminSpec.query ?? [], route);
        if (method !== 'GET' && method !== 'HEAD') {
          adminBody = await readJsonBody(req, maxBody);
          assertKnownFields(adminBody, adminSpec.fields[method] ?? [], route);
        }
      } else if (Object.prototype.hasOwnProperty.call(POST_FIELDS, route)) {
        // LE-RAG-11: /search y /context son POST con cuerpo JSON. GET sobre ellas se rechaza: una
        // sola forma de llamar a cada ruta (D-01).
        if (method !== 'POST') return methodNotAllowed(res, ['POST'], `${route} se consulta con POST y cuerpo JSON`);
        // P-UX22-01: sólo las lecturas declaradas se saltan el fence. `/selection` muta la
        // selección del perfil y exige el testigo del panel antes de que se lea su cuerpo.
        if (!POST_READ_ROUTES.includes(route)) assertMutationCsrf(req, route);
        params = queryParams(url, POST_PARAMS, route);
        const body = await readJsonBody(req, maxBody);
        payload = route === '/search' ? searchPayload(body, config)
          : route === '/context' ? contextPayload(body, config)
            : selectionPayload(body);
      } else if (route === TRACKING_ROUTE && (method === 'PUT' || method === 'DELETE')) {
        // UX-2.2: carril propio ANTES del 405 de las rutas de lectura. El CSRF se comprueba lo
        // primero: una petición sin la cabecera del panel no llega a leer el cuerpo ni a escribir.
        assertMutationCsrf(req, route);
        if (method === 'PUT') {
          params = queryParams(url, [], route);
          trackingBody = trackingPayload(await readJsonBody(req, maxBody));
        } else {
          params = trackingDeleteParams(url, route);
        }
      } else if (Object.prototype.hasOwnProperty.call(GET_ROUTES, route)) {
        if (method !== 'GET' && method !== 'HEAD') {
          // `/tracking` sí admite escritura (PUT/DELETE, por su carril): no se le dice «solo
          // lectura» a quien pregunta con otro método.
          return route === TRACKING_ROUTE
            ? methodNotAllowed(res, ['GET', 'HEAD', 'PUT', 'DELETE'], `${route} se lee con GET, se sigue con PUT y se deja con DELETE`)
            : methodNotAllowed(res, ['GET', 'HEAD'], 'la API PA es de solo lectura');
        }
        params = queryParams(url, GET_ROUTES[route], route);
      } else {
        return failWith(res, 404, 'not-found', `ruta PA desconocida: ${route}`);
      }

      let registry;
      try {
        registry = openRegistry({ root: profileRoot, create: false, now: now() });
      } catch (error) {
        if (error instanceof RagError && error.code === 'store-not-initialized') {
          // Accionable, no adivinación: dice qué clave de perfil se usó y qué fichero se buscó, para
          // que «sin conexión» no deje al operador sin saber si el perfil resuelto es el que cree.
          return failWith(res, 503, 'registry-unavailable',
            `el perfil «${profileKey}» no tiene registro Project-Aware: no existe ${registryPath(profileRoot)}`,
            {
              profileKey,
              profileRoot,
              registry: registryPath(profileRoot),
              resolution: 'DSH_PROFILE > DSH_PROFILE_DIR > argv (.../profiles/<perfil>) > "default"',
            });
        }
        throw error;
      }
      const db = registry.db ?? registry;
      try {
        // UX-2.2: seguimiento por perfil. Las tres rutas son humanas y NO dependen del proyecto
        // activo: la fila referencia un proyecto, pero no se resuelve ningún ámbito aquí (igual
        // que `/workspaces`, que tampoco lo hace). Se responde antes de `projectView`.
        if (route === TRACKING_ROUTE) {
          if (method === 'PUT') {
            const applied = applyTracking(db, {
              pathKey: trackingBody.pathKey,
              // F8: la ruta llega validada y casada con `pathKey`; ya no hay respaldo a la clave.
              path: trackingBody.path,
              state: trackingBody.state,
              projectId: trackingBody.projectId,
              expectedRevision: trackingBody.expectedRevision,
              now: now(),
              // Sólo una persona mueve el eje A (`D-UX22-09`); el almacén lo vuelve a exigir.
              actor: 'human',
            });
            return respond(res, 200, {
              changed: applied.changed,
              item: trackingItemView(applied.item, { roots: workspaceRoots(db), projectNames: projectNameMap(db) }),
              revision: applied.revision,
            });
          }
          if (method === 'DELETE') {
            const removed = removeTracking(db, {
              pathKey: params.pathKey, expectedRevision: params.expectedRevision, now: now(),
            });
            return respond(res, 200, { changed: removed.changed });
          }
          // GET: filas ya proyectadas, con su proyecto y su relación. `counts` sale de SQL sobre el
          // conjunto completo (F15), no de la página: con más de `limit` filas el total sería falso.
          // `truncated` declara que `items` es una página.
          const rows = listTracking(db, { limit: params.limit ?? TRACKING_LIST_MAX });
          const counts = countTracking(db);
          const roots = workspaceRoots(db);
          const names = projectNameMap(db);
          const items = rows.map((row) => trackingItemView(row, { roots, projectNames: names }));
          return respond(res, 200, {
            items,
            counts,
            truncated: items.length < counts.total,
            asOf: started,
            version: PA_VERSION,
          });
        }
        // UX-2.1 §19: workspaces conocidos por el Host. Se responde ANTES de resolver el proyecto
        // activo: el inventario del Host no depende de la selección, y un perfil sin proyecto
        // seleccionado (o sin ninguno registrado) sigue pudiendo leerlo. Sólo lectura: no se llama
        // a ninguna operación de escritura del registro del host.
        if (route === '/workspaces') {
          const payload = await projectWorkspaces(services ? services.workspaces : null, {
            sessions: services ? services.sessions : null,
            projects: workspaceRoots(db),
            limit: params.limit ?? undefined,
            // UX-2.2: el handler lee el seguimiento y lo pasa; la proyección sigue siendo pura y
            // esta lectura no escribe, no reconcilia y no audita (T-W2-12 / T-W2-13).
            tracking: listTracking(db, { limit: TRACKING_LIST_MAX }),
            projectNames: projectNameMap(db),
          });
          return respond(res, 200, {
            mode: 'api', service: 'ok', asOf: started, version: PA_VERSION, ...payload,
          });
        }
        // ACP-07 F3: la administración no depende del proyecto activo (crear, archivar, restaurar o
        // descubrir candidatos funcionan aunque no haya selección o el proyecto esté archivado).
        if (adminSpec) {
          const result = await adminDispatch(db, {
            route, method, body: adminBody, url, principal: principal ?? 'owner', now: now(), profileRoot,
          });
          return respond(res, result.status, result.data);
        }
        // CR-1: la selección se escribe en el registro del perfil, con CAS sobre la revisión.
        if (route === '/selection') {
          const applied = applySelection(db, {
            projectId: payload.projectId,
            expectedRevision: payload.expectedRevision,
            selectedBy: 'human',
            source: 'explicit',
            principal: principal ?? 'owner',
            now: now(),
          });
          const selected = db.prepare('select id, name from projects where id = ?').get(applied.selection.projectId);
          return respond(res, 200, {
            changed: applied.changed,
            selection: applied.selection,
            project: selected ? { id: selected.id, name: selected.name } : null,
          });
        }
        const selection = readSelection(db);
        // El snapshot es el único sitio que puede responder con un perfil *sin* proyecto activo: es
        // el retrato que el panel necesita para ofrecer restaurar o registrar. El resto de rutas
        // siguen exigiendo un proyecto resoluble, igual que antes.
        let view = null;
        let awaitingSelection = null;
        try {
          view = projectView(db, params.project, selection);
        } catch (error) {
          const emptyProfile = route === '/' || route === '/snapshot';
          const recoverable = error instanceof RagError
            && (error.code === 'project-not-authorized' || error.code === 'scope-ambiguous');
          if (!emptyProfile || !recoverable) throw error;
          const active = listProjects(db, { status: 'active' }).projects;
          // F-1 (1.5.11): varios proyectos activos y ninguna selección NO es «sin conexión». El
          // retrato del perfil responde 200 con `needsProjectSelection: true` y la lista de
          // candidatos, y el panel ofrece el selector. Sigue sin elegirse ninguno en silencio: la
          // selección la escribe la persona con `POST /selection` (CAS sobre la revisión).
          if (error.code === 'scope-ambiguous' && active.length > 1) {
            awaitingSelection = { candidates: active.map((row) => ({ id: row.id, name: row.name })) };
          } else if (active.length > 0) {
            throw error;
          }
        }
        if (awaitingSelection) {
          return respond(res, 200, {
            mode: 'api', service: 'ok', asOf: started, version: PA_VERSION,
            project: null,
            // Aditivo: dice que falta una decisión, no que falte el servicio.
            needsProjectSelection: true,
            candidates: awaitingSelection.candidates,
            needsProjectSelectionReason: 'scope-ambiguous',
            selection,
            projects: projectsIndex(db, null),
            archived: archivedIndex(db),
            roots: rootsIndex(db),
            auth: peer ? { principal: principal ?? 'owner' } : null,
            scopes: [],
            libraries: [],
            sources: { rows: [], total: 0, nextCursor: null },
            audit: { head: 0 },
            config: { strategy: config.search.strategy, limit: config.search.limit, diversity: config.search.diversity },
            capabilities: adminCapabilities(),
          });
        }
        if (!view) {
          return respond(res, 200, {
            mode: 'api', service: 'ok', asOf: started, version: PA_VERSION,
            project: null,
            needsProjectSelection: false,
            selection,
            projects: projectsIndex(db, null),
            archived: archivedIndex(db),
            roots: rootsIndex(db),
            auth: peer ? { principal: principal ?? 'owner' } : null,
            scopes: [],
            libraries: [],
            sources: { rows: [], total: 0, nextCursor: null },
            audit: { head: 0 },
            config: { strategy: config.search.strategy, limit: config.search.limit, diversity: config.search.diversity },
            capabilities: adminCapabilities(),
          });
        }
        const { project, roots, authorized } = view;
        // Un proyecto puede existir en el registro **sin almacén todavía**: `POST /projects` y la CLI
        // (`project create` + `root add`) registran proyecto y raíz, y el almacén de ámbito nace sólo
        // con la primera ingesta. El retrato del perfil (`/` y `/snapshot`) no puede caerse por eso
        // —dejaba el panel entero en «sin conexión» por un proyecto vacío—: se responde con el
        // proyecto, cero fuentes y `service: 'degraded'`. Las rutas que sí necesitan contenido
        // (`/history`, `/search`, `/context`) siguen fallando con `store-not-initialized`, que es la
        // verdad de ese proyecto hasta que se ingiera algo.
        const portrait = route === '/' || route === '/snapshot';
        let store = null;
        try {
          store = openStore(profileRoot, profileKey, project.id);
        } catch (error) {
          const missing = error instanceof RagError && error.code === 'store-not-initialized';
          if (!portrait || !missing) throw error;
        }
        const sdb = store ? (store.db ?? store) : null;
        const scope = { id: project.id, kind: 'prj', name: project.name };
        try {
          if (route === '/history') {
            // Historial del proyecto activo: sale de SU almacén (no de otro), con la cadena verificada.
            const page = historyPage(sdb, { limit: params.limit, cursor: params.cursor, roots: authorized, scope });
            return respond(res, 200, { mode: 'api', ...page, integrity: verifyAuditChain(sdb) });
          }
          if (route === '/' || route === '/snapshot') {
            return respond(res, 200, {
              mode: 'api', service: store ? 'ok' : 'degraded', asOf: started, version: PA_VERSION,
              project: { id: project.id, name: project.name },
              needsProjectSelection: false,
              selection,
              projects: projectsIndex(db, project.id),
              archived: archivedIndex(db),
              roots: rootsIndex(db),
              auth: peer ? { principal: principal ?? 'owner' } : null,
              scopes: [{ kind: 'prj', id: project.id, name: project.name, roots: roots.length, authorized: authorized.length }],
              libraries: [],
              sources: store
                ? sourcesPage(sdb, { limit: params.limit, cursor: params.cursor, roots: authorized })
                : { rows: [], total: 0, nextCursor: null },
              audit: store ? auditHead(sdb) : { head: 0 },
              config: { strategy: config.search.strategy, limit: config.search.limit, diversity: config.search.diversity },
              capabilities: adminCapabilities(),
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
          store?.close?.();
        }
      } finally {
        (db.close ?? (() => {})).call(db);
      }
    } catch (error) {
      if (error instanceof RagError) {
        // Un solo mapa (lib/errors.mjs): un código de autorización no puede acabar en 500 por no estar
        // en una tabla local. El status sale de HTTP_STATUS; lo no clasificado cae a 500 explícitamente.
        return failWith(res, httpStatusFor(error.code), error.code, error.message, error.details);
      }
      return failWith(res, 500, 'internal-error', 'error interno del transporte PA');
    }
  };
}
