/**
 * Harness Open Projects.
 *
 * DeepSeek Harness mantiene un registro durable de *workspaces*: cada uno tiene una ruta
 * canónica, un título y las sesiones que lo tienen abierto (`sessionIds`). LifeCode RAG usa
 * ese registro como la señal de «qué proyectos tiene abiertos la persona», en lugar de asumir
 * que `cwd` describe todos los proyectos o de confiar en una carpeta contenedora.
 *
 * Lo que este módulo aporta:
 *   - normaliza los workspaces vivos a una forma estable y sin objetos del host;
 *   - resuelve el workspace de una sesión y el que contiene un `cwd`;
 *   - **no** autoriza nada: la autorización de lectura sigue siendo un `trusted root`
 *     explícito (ver `trusted-roots.mjs`), evaluado por `resolve.mjs`. Un proyecto abierto
 *     sin autorización produce un rechazo con el comando exacto que la persona debe ejecutar.
 */

import { pathKeyFor } from './registry.mjs';
import { projectWorkspaces as projectRows } from './workspaces-projection.mjs';

/** Forma interna de un proyecto abierto: sólo datos serializables. */
export function normalizeWorkspace(workspace) {
  if (!workspace || typeof workspace.path !== 'string' || workspace.path.trim() === '') return null;
  const sessionIds = Array.isArray(workspace.sessionIds)
    ? workspace.sessionIds.filter((id) => typeof id === 'string' && id !== '')
    : [];
  return {
    id: typeof workspace.id === 'string' ? workspace.id : null,
    path: workspace.path,
    pathKey: pathKeyFor(workspace.path),
    title: typeof workspace.title === 'string' && workspace.title.trim() !== ''
      ? workspace.title
      : workspace.path,
    sessionIds,
  };
}

/**
 * Lee el registro de workspaces del host y devuelve los proyectos abiertos.
 *
 * `registry` es el servicio `workspaceRegistry` (o cualquier objeto con `list()`). Los
 * workspaces cuyo directorio ya no existe (`status() !== 'ok'`) se omiten: un proyecto
 * abierto que desapareció del disco no debe convertirse en un ámbito candidato.
 */
export async function listOpenProjects(registry) {
  if (!registry || typeof registry.list !== 'function') return [];
  let raw;
  try {
    raw = registry.list();
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const projects = [];
  for (const workspace of raw) {
    const normalized = normalizeWorkspace(workspace);
    if (!normalized) continue;
    if (typeof workspace.status === 'function') {
      try {
        const status = await workspace.status();
        if (status !== 'ok') continue;
      } catch {
        continue;
      }
    }
    projects.push(normalized);
  }
  return projects;
}

/** El proyecto abierto más específico que contiene la clave dada. */
export function openProjectForCwd(projects, cwdKey) {
  if (!cwdKey || !Array.isArray(projects)) return null;
  let best = null;
  for (const project of projects) {
    const inside = cwdKey === project.pathKey || cwdKey.startsWith(`${project.pathKey}/`);
    if (!inside) continue;
    if (!best || project.pathKey.length > best.pathKey.length) best = project;
  }
  return best;
}

/** El proyecto abierto al que el host asocia esta sesión. */
export function openProjectForSession(projects, sessionId) {
  if (!sessionId || !Array.isArray(projects)) return null;
  return projects.find((project) => project.sessionIds.includes(sessionId)) ?? null;
}

/* ─────────────────────────── UX-2.1 · descubrimiento de workspaces (sólo lectura) ─────────────── */

/** Presupuesto por defecto de un `status()` individual: un disco lento no bloquea la lista. */
export const DEFAULT_STATUS_TIMEOUT_MS = 250;
/** Presupuesto total de la petición: agotado, el resto queda `unknown` con su motivo. */
export const DEFAULT_BUDGET_MS = 2000;

/**
 * Sesiones vivas del Host, si el adaptador las aportó.
 *
 * Se aceptan las formas que el Host usa de verdad (`SessionStore.list()` devuelve objetos con
 * `id`, y el adaptador puede reducirlos a identificadores). Sin servicio, o si falla, devuelve
 * `null`: **nunca un conjunto vacío**, porque «no hay sesiones» y «no se pudo mirar» no son lo
 * mismo y la interfaz lo dice distinto.
 */
async function liveSessionIdsOf(sessions) {
  if (!sessions || typeof sessions.list !== 'function') return null;
  let value;
  try {
    value = await sessions.list();
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const ids = new Set();
  for (const entry of value) {
    const id = typeof entry === 'string'
      ? entry
      : (entry && typeof entry.id === 'string' ? entry.id
        : (entry && entry.session && typeof entry.session.id === 'string' ? entry.session.id : null));
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Mide `status()` de un workspace con tiempo límite individual.
 *
 * Un fallo, un valor inesperado o un silencio terminan en `unknown` con su motivo; ninguno
 * interrumpe la lista ni se convierte en `missing` (que afirmaría algo sobre el disco que no se
 * midió). El temporizador se limpia siempre: la prueba no deja el proceso colgado.
 */
function measureStatus(workspace, timeoutMs) {
  if (!workspace || typeof workspace.status !== 'function') {
    return Promise.resolve({ state: 'unknown', stateReason: 'no-status' });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ state: 'unknown', stateReason: 'timeout' }), Math.max(1, timeoutMs));
    Promise.resolve()
      .then(() => workspace.status())
      .then(
        (value) => finish(value === 'ok'
          ? { state: 'ok', stateReason: null }
          : (value === 'missing-dir'
            ? { state: 'missing', stateReason: null }
            : { state: 'unknown', stateReason: 'unexpected-status' })),
        () => finish({ state: 'unknown', stateReason: 'status-error' }),
      );
  });
}

/**
 * Proyección de los workspaces que conoce el Host, para `GET /pa/workspaces` (UX-2.1).
 *
 * Sólo lee: `list()` y `status()` del registro, y `list()` del servicio de sesiones. No llama a
 * ninguna escritura del registro (`create`, `delete`, `setTitle`, `pinSession`…), ni resuelve
 * rutas con `resolveByPath` (que hace `realpath` y puede rechazar). La ruta se publica tal como
 * el Host la guardó, que ya es canónica: aquí no se reescribe.
 *
 * Lo que el Host no publica no se inventa: los `sessionIds` se cuentan y nunca se listan, y no
 * hay `lastActivityAt` ni `archived` porque el registro no los tiene.
 *
 * @param {object|null} registry servicio `workspaceRegistry` (o cualquier objeto con `list()`)
 * @param {object} options
 * @param {object|null} options.sessions servicio de sesiones vivas (opcional)
 * @param {Array} options.projects raíces autorizadas como `[{projectId, name, path}]`
 * @param {number} options.limit máximo de filas devueltas
 * @param {Array} options.tracking filas de seguimiento ya leídas de `workspace_tracking`
 * @param {Map|object|null} options.projectNames nombres de proyecto para `trackingProject`
 * @param {number} options.timeoutMs tiempo límite por `status()`
 * @param {number} options.budgetMs presupuesto total de la petición
 * @param {() => number} options.now reloj inyectable (pruebas)
 */
export async function projectWorkspaces(registry, {
  sessions = null, projects = [], limit = undefined,
  tracking = [], projectNames = null,
  timeoutMs = DEFAULT_STATUS_TIMEOUT_MS, budgetMs = DEFAULT_BUDGET_MS, now = () => Date.now(),
} = {}) {
  if (!registry || typeof registry.list !== 'function') {
    return projectRows({ source: 'none', reason: 'no-registry', limit });
  }
  let raw;
  try {
    raw = registry.list();
  } catch {
    return projectRows({ source: 'none', reason: 'registry-error', limit });
  }
  if (!Array.isArray(raw)) {
    return projectRows({ source: 'none', reason: 'registry-invalid', limit });
  }
  const liveIds = await liveSessionIdsOf(sessions);
  const deadline = now() + (Number.isFinite(budgetMs) && budgetMs >= 0 ? budgetMs : DEFAULT_BUDGET_MS);
  const measured = [];
  let skipped = 0;
  for (const workspace of raw) {
    const normalized = normalizeWorkspace(workspace);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    // Agotado el presupuesto no se mide más: se publica `unknown` con el motivo, la fila sigue.
    const status = now() >= deadline
      ? { state: 'unknown', stateReason: 'budget' }
      : await measureStatus(workspace, timeoutMs);
    measured.push({ ...normalized, ...status });
  }
  return projectRows({
    workspaces: measured,
    roots: projects,
    liveIds,
    skipped,
    source: 'host',
    reason: liveIds === null && raw.length > 0 ? 'sessions-unavailable' : null,
    limit,
    tracking,
    projectNames,
  });
}
