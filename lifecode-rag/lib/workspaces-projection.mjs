/**
 * UX-2.1 · Proyección pura de workspaces del Host.
 *
 * Qué hace: convierte lo que el registro de workspaces de DeepSeek Harness ya decidió (una ruta
 * canónica, un título, sus sesiones y un estado medido) en filas normalizadas para el panel, y las
 * cruza con las raíces autorizadas de los proyectos RAG.
 *
 * Qué **no** hace, a propósito:
 *   - no toca el disco ni el reloj: el estado (`status()`) se resuelve en el adaptador
 *     (`lib/harness-workspaces.mjs`) con su tiempo límite, y aquí llega ya resuelto;
 *   - no conoce el harness ni el registro de proyectos: recibe objetos planos;
 *   - no autoriza nada, no escribe nada y no inventa campos que el Host no publica
 *     (`sessionIds` se cuenta, nunca se lista; no hay `lastActivityAt` ni `archived`);
 *   - no usa el título como identidad: la identidad es la ruta canónica, comparada por `pathKey`.
 *
 * Relación workspace ↔ proyecto: `exact` (misma ruta que una raíz autorizada), `inside` (el
 * workspace está dentro de una raíz) o `none` (ni una cosa ni la otra). Cuando varias raíces
 * encajan gana la **más específica** (la clave más larga), que es la misma regla que usa
 * `openProjectForCwd` para resolver el proyecto de un `cwd`. Una raíz que cae *dentro* del
 * workspace no lo convierte en ese proyecto: un workspace que contiene proyectos no es un
 * proyecto, y decir lo contrario asignaría el contenedor entero a una de sus carpetas.
 *
 * UX-2.2 (aditivo) · seguimiento: cada fila gana `tracked`, `trackingState` y `trackingProject`.
 * Las filas de seguimiento **llegan como parámetro** —leídas por el handler—, nunca se consultan
 * aquí: esta proyección sigue siendo pura y sin base de datos. El eje A (`on`/`off`/`paused`) se
 * publica tal cual; lo que el Host mide (`lastStatus`) no se mezcla con él.
 */

import { isTrackingState } from './tracking.mjs';

/** Estados publicados para un workspace. `unknown` es «no se pudo comprobar», nunca «vacío». */
export const WORKSPACE_STATES = Object.freeze(['ok', 'missing', 'unknown']);

/** Relaciones publicadas. `none` es la ausencia de relación, explícita. */
export const WORKSPACE_RELATIONS = Object.freeze(['exact', 'inside', 'none']);

/** Tope duro de filas por respuesta (mismo techo que el resto de la API: `MAX_LIMIT`). */
export const MAX_WORKSPACE_LIMIT = 200;

/**
 * Clave comparable de una ruta: barras `/`, sin barra final, minúsculas en Windows.
 *
 * Es la misma regla que `normalizeKey` de `lib/roots-structure.mjs`, replicada aquí para que este
 * módulo no importe nada que cargue `node:fs`. La paridad está fijada por prueba
 * (`tests/workspaces-projection.test.mjs`): si una cambia y la otra no, la prueba falla.
 */
export function pathKeyOf(path) {
  const slashes = String(path).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? slashes.toLowerCase() : slashes;
}

/** Raíz normalizada a `{ projectId, name, pathKey }`, o `null` si no sirve para comparar. */
function normalizeRoot(root) {
  if (!root || typeof root !== 'object') return null;
  const projectId = typeof root.projectId === 'string' && root.projectId !== '' ? root.projectId : null;
  if (!projectId) return null;
  const pathKey = typeof root.pathKey === 'string' && root.pathKey !== ''
    ? root.pathKey
    : (typeof root.path === 'string' && root.path !== '' ? pathKeyOf(root.path) : '');
  if (pathKey === '') return null;
  return { projectId, name: typeof root.name === 'string' && root.name !== '' ? root.name : projectId, pathKey };
}

/**
 * Raíz autorizada más específica que contiene (o iguala) la clave del workspace.
 *
 * @returns {{projectId: string, name: string, relation: 'exact'|'inside'}|null}
 */
export function projectForPathKey(pathKey, roots = []) {
  if (typeof pathKey !== 'string' || pathKey === '') return null;
  let best = null;
  for (const root of Array.isArray(roots) ? roots : []) {
    const normalized = normalizeRoot(root);
    if (!normalized) continue;
    const relation = pathKey === normalized.pathKey
      ? 'exact'
      : (pathKey.startsWith(`${normalized.pathKey}/`) ? 'inside' : null);
    // Un fallo de comparación no es «casi»: no se asignan proyectos por prefijo suelto.
    if (!relation) continue;
    if (!best || normalized.pathKey.length > best.pathKey.length) {
      best = { ...normalized, relation };
    }
  }
  if (!best) return null;
  return { projectId: best.projectId, name: best.name, relation: best.relation };
}

/** `state` publicado: sólo los tres valores del contrato; lo demás es `unknown`, no se adivina. */
function publishedState(value) {
  return value === 'ok' || value === 'missing' || value === 'unknown' ? value : 'unknown';
}

function publishedReason(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Nombre de proyecto desde un `Map` o un objeto plano; `null` si no está. */
function projectNameOf(projectNames, projectId) {
  if (!projectId) return null;
  if (projectNames instanceof Map) return projectNames.get(projectId) ?? null;
  if (projectNames && typeof projectNames === 'object') {
    const value = projectNames[projectId];
    return typeof value === 'string' && value !== '' ? value : null;
  }
  return null;
}

/**
 * Índice `pathKey → {state, projectId, project}` a partir de las filas de seguimiento que el
 * llamador ya leyó (crudas del registro o ya proyectadas). Puro: no consulta la base ni el reloj.
 *
 * Una fila cuyo proyecto no está en `projectNames` conserva su `state` y su `projectId`, pero
 * `project` queda `null`: no se inventa un nombre que el registro no tiene.
 */
export function trackingIndex(tracking = [], projectNames = null) {
  const index = new Map();
  for (const row of Array.isArray(tracking) ? tracking : []) {
    if (!row || typeof row !== 'object') continue;
    const pathKey = typeof row.pathKey === 'string' && row.pathKey !== ''
      ? row.pathKey
      : (typeof row.path_key === 'string' && row.path_key !== '' ? row.path_key : null);
    if (!pathKey) continue;
    const projectId = row.projectId ?? row.project_id ?? null;
    const name = projectNameOf(projectNames, projectId);
    index.set(pathKey, {
      state: isTrackingState(row.state) ? row.state : null,
      projectId: projectId ?? null,
      project: name === null ? null : { id: projectId, name },
    });
  }
  return index;
}

/**
 * (Re)normaliza una fila ya medida. Devuelve `null` cuando la entrada no es un workspace válido
 * (sin `path` de texto): una entrada rota se cuenta como descartada, nunca se pinta como fila.
 *
 * `tracking` es el índice de `trackingIndex()` (o `null`): sin él, toda fila se publica como no
 * seguida, que es la verdad para un llamador que no aportó seguimiento.
 */
export function projectWorkspaceRow(workspace, { roots = [], liveIds = null, tracking = null } = {}) {
  if (!workspace || typeof workspace !== 'object') return null;
  if (typeof workspace.path !== 'string' || workspace.path.trim() === '') return null;
  const pathKey = typeof workspace.pathKey === 'string' && workspace.pathKey !== ''
    ? workspace.pathKey
    : pathKeyOf(workspace.path);
  const sessionIds = Array.isArray(workspace.sessionIds)
    ? workspace.sessionIds.filter((id) => typeof id === 'string' && id !== '')
    : [];
  const known = sessionIds.length;
  const live = liveIds instanceof Set
    ? sessionIds.filter((id) => liveIds.has(id)).length
    : null;
  const match = projectForPathKey(pathKey, roots);
  const track = tracking instanceof Map ? (tracking.get(pathKey) ?? null) : null;
  return {
    id: typeof workspace.id === 'string' && workspace.id !== '' ? workspace.id : null,
    path: workspace.path,
    pathKey,
    title: typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : workspace.path,
    state: publishedState(workspace.state),
    stateReason: publishedReason(workspace.stateReason),
    // Conteos, no identificadores: el Host no publica actividad por sesión y no se inventa.
    sessions: {
      known,
      live,
      historical: live === null ? null : Math.max(0, known - live),
    },
    project: match ? { id: match.projectId, name: match.name } : null,
    relation: match ? match.relation : 'none',
    // Eje A: decisión humana. `tracked` es la existencia de la fila, no que resuelva contexto.
    tracked: track !== null,
    trackingState: track ? track.state : null,
    trackingProject: track ? track.project : null,
  };
}

/** Recuentos de la lista completa (no sólo de las filas devueltas). */
export function countWorkspaces(rows = []) {
  const counts = {
    total: rows.length,
    returned: 0,
    skipped: 0,
    withProject: 0,
    withoutProject: 0,
    ok: 0,
    missing: 0,
    unknown: 0,
    exact: 0,
    inside: 0,
    liveSessions: 0,
    knownSessions: 0,
  };
  for (const row of rows) {
    if (row.project) counts.withProject += 1;
    else counts.withoutProject += 1;
    counts[row.state] += 1;
    counts.knownSessions += row.sessions.known;
    if (row.sessions.live !== null) counts.liveSessions += row.sessions.live;
    if (row.relation === 'exact') counts.exact += 1;
    if (row.relation === 'inside') counts.inside += 1;
  }
  return counts;
}

/**
 * Payload de `GET /pa/workspaces`.
 *
 * @param {object} input
 * @param {Array} input.workspaces filas ya medidas (`{id, path, title, state, sessionIds}`)
 * @param {Array} input.roots raíces autorizadas (`{projectId, name, path}`)
 * @param {Set|null} input.liveIds identificadores de sesión vivos, o `null` si el Host no los da
 * @param {number} input.skipped entradas del Host que no eran válidas (las contó el adaptador)
 * @param {'host'|'none'} input.source de dónde sale la lista
 * @param {string|null} input.reason por qué `source` es `none` (o aviso parcial)
 * @param {number} input.limit máximo de filas devueltas
 * @param {Array} input.tracking filas de seguimiento ya leídas (`{pathKey, state, projectId}`)
 * @param {Map|object|null} input.projectNames nombres de proyecto para `trackingProject`
 */
export function projectWorkspaces({
  workspaces = [], roots = [], liveIds = null, skipped = 0,
  source = 'host', reason = null, limit = MAX_WORKSPACE_LIMIT,
  tracking = [], projectNames = null,
} = {}) {
  // El índice se construye una sola vez por respuesta: cruzar N filas no reindexa el seguimiento.
  const trackIndex = trackingIndex(tracking, projectNames);
  const rows = [];
  let invalid = 0;
  for (const raw of Array.isArray(workspaces) ? workspaces : []) {
    const row = projectWorkspaceRow(raw, { roots, liveIds, tracking: trackIndex });
    if (row) rows.push(row);
    else invalid += 1;
  }
  const counts = countWorkspaces(rows);
  counts.skipped = invalid + (Number.isInteger(skipped) && skipped > 0 ? skipped : 0);
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_WORKSPACE_LIMIT) : MAX_WORKSPACE_LIMIT;
  const items = rows.slice(0, cap);
  counts.returned = items.length;
  return {
    source: source === 'host' ? 'host' : 'none',
    reason: publishedReason(reason),
    items,
    counts,
    truncated: items.length < counts.total,
  };
}
