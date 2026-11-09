// ── El inventario de workspaces de DSH ──────────────────────────────────────────────────────────────
//
// Este módulo es puro: no importa el harness, no toca el disco y no decide nada sobre el almacén de
// LifeCode. Recibe la lista que devuelve `workspaceRegistry.list()` —objetos del Host, con métodos— y
// los estados que el adaptador ya preguntó con `Workspace.status()`, y produce una proyección plana.
//
// Por qué aquí y no en `index.js`: lo que se decide (qué es una coincidencia legacy, qué se considera
// «sin workspace», cómo se cuenta el resumen) tiene que poder probarse con `node --test` sin instalar
// nada. El adaptador se limita a resolver el servicio opcional y a pasar los datos.
//
// Reglas que este módulo respeta y que conviene no romper:
//   · Nada de escaneo de disco ni de contenido de proyectos. Sólo se comparan rutas canónicas que ya
//     vienen del Host.
//   · Nada de crear identidades: un workspace descubierto NO recibe UUID, no crea manifiesto y no se
//     registra en `center.json`. La adopción es un acto humano posterior (LSC-017).
//   · Nada de deducir coincidencias por título ni por parecido de nombres: sólo ruta canónica exacta.
//   · Ningún valor del cliente decide identidad: el proyecto actual sale del `cwd` de la sesión viva.

import { normalizeCwd } from './format.mjs';

/** Código con el que la API dice «este Host no ofrece el registro de workspaces». */
export const WORKSPACE_UNAVAILABLE = 'workspace-registry-unavailable';

/** Estados de vinculación de un workspace descubierto. */
export const DISCOVERED = 'discovered';
export const LEGACY_MATCH = 'legacy-match';
export const LINKED = 'linked';
export const CONFLICT = 'conflict';
export const UNKNOWN_LINK = 'unknown';

/** Estados de un proyecto gestionado que no encuentra su workspace. */
export const MANAGED_MISSING = 'missing';
export const MANAGED_UNMATCHED = 'unmatched';

/** Estados de disponibilidad del directorio. */
export const AVAILABILITY_OK = 'ok';
export const AVAILABILITY_MISSING_DIR = 'missing-dir';
export const AVAILABILITY_UNKNOWN = 'unknown';

/**
 * ¿El servicio tiene la forma que se espera?
 *
 * Se comprueba antes de usarlo porque `ctx.get('workspaceRegistry')` puede devolver cualquier cosa en
 * un harness futuro. Un servicio a medias no es un inventario: mejor decir «no disponible» que inventar.
 */
export function workspaceRegistryShape(value) {
  if (value === null || typeof value !== 'object') return { ok: false, reason: 'el Host no ofrece workspaceRegistry' };
  if (typeof value.list !== 'function') return { ok: false, reason: 'workspaceRegistry no tiene list()' };
  return { ok: true };
}

/**
 * La forma canónica de una ruta para comparar.
 *
 * `normalizeCwd` ya unifica separadores y quita la barra final; aquí se baja a minúsculas porque
 * Windows no distingue mayúsculas en rutas y dos rutas que sólo difieren en eso son la misma carpeta.
 */
export function canonicalPath(value) {
  const normalized = normalizeCwd(value);
  return normalized === '' ? '' : normalized.toLowerCase();
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Un DTO plano de un workspace. Nunca expone `sessionIds` ni métodos del Host. */
export function workspaceOf(item, status = undefined) {
  const sessions = Array.isArray(item?.sessionIds) ? item.sessionIds : [];
  // El estado puede venir ya medido (segundo argumento) o traerlo el propio item; si no, es desconocido.
  const reported = status !== undefined ? status : item?.status;
  const known = reported === AVAILABILITY_OK || reported === AVAILABILITY_MISSING_DIR ? reported : AVAILABILITY_UNKNOWN;
  return {
    workspaceId: text(item?.id),
    title: text(item?.title),
    path: normalizeCwd(item?.path),
    sessionCount: count(sessions.length),
    createdAt: text(item?.createdAt),
    updatedAt: text(item?.updatedAt),
    status: known,
  };
}

/**
 * Busca el workspace que corresponde a una ruta.
 *
 * Exacto primero; si la ruta es una carpeta dentro del workspace, gana el prefijo más largo que termine
 * en separador (`plugins-dhs` cubre `plugins-dhs/sub`, pero `plugins-dhs` no cubre `plugins-dhs-otro`).
 */
export function findWorkspaceForPath(workspaces, path) {
  const target = canonicalPath(path);
  if (target === '' || !Array.isArray(workspaces)) return null;
  let best = null;
  for (const workspace of workspaces) {
    const canonical = canonicalPath(workspace.path);
    if (canonical === '') continue;
    if (canonical === target) return workspace;
    if (target.startsWith(`${canonical}/`) && (best === null || canonical.length > canonicalPath(best.path).length)) {
      best = workspace;
    }
  }
  return best;
}

/**
 * Construye el inventario completo: workspaces descubiertos, proyectos gestionados, resumen y actual.
 *
 * `items` son los objetos del Host; `statuses` es `Map<workspaceId, 'ok'|'missing-dir'|'unknown'>` que el
 * adaptador promedio ya midió; `state` es el documento de LifeCode (sólo se lee); `hostCwd` es el
 * directorio de la sesión viva, del que sale el proyecto actual — nunca una ruta enviada por el cliente.
 */
export function buildWorkspaceInventory({ items = [], statuses = new Map(), state = {}, hostCwd = '' } = {}) {
  const projects = state && typeof state.projects === 'object' && state.projects !== null ? state.projects : {};
  const assignments = state && typeof state.assignments === 'object' && state.assignments !== null ? state.assignments : {};

  const workspaces = (Array.isArray(items) ? items : [])
    .map((item) => workspaceOf(item, statuses instanceof Map ? statuses.get(text(item?.id)) : undefined))
    .filter((workspace) => workspace.workspaceId !== '');

  // La coincidencia legacy es exacta por ruta canónica, y sólo se informa: no se crea nada.
  const byPath = new Map();
  for (const [projectId, project] of Object.entries(projects)) {
    const canonical = canonicalPath(project?.cwd);
    if (canonical === '' || byPath.has(canonical)) continue;
    byPath.set(canonical, { projectId, project });
  }

  const seenPaths = new Set();
  for (const workspace of workspaces) {
    const canonical = canonicalPath(workspace.path);
    const match = byPath.get(canonical);
    if (match !== undefined) {
      workspace.linkState = LEGACY_MATCH;
      workspace.projectId = match.projectId;
      workspace.reason = `la ruta canónica coincide con el proyecto registrado ${match.projectId}`;
    } else {
      workspace.linkState = DISCOVERED;
      workspace.projectId = null;
      workspace.reason = '';
    }
    // Dos workspaces con la misma ruta canónica son un conflicto del Host, no algo que resolver aquí.
    if (canonical !== '' && seenPaths.has(canonical)) {
      workspace.linkState = CONFLICT;
      workspace.reason = 'otro workspace del Host declara la misma ruta canónica';
    }
    if (canonical !== '') seenPaths.add(canonical);
    if (workspace.status === AVAILABILITY_MISSING_DIR && workspace.linkState === DISCOVERED) {
      workspace.reason = 'el Host conoce este workspace pero su carpeta no está disponible';
    }
  }

  const workspaceByPath = new Map();
  const workspaceById = new Map();
  for (const workspace of workspaces) {
    workspaceById.set(workspace.workspaceId, workspace);
    const canonical = canonicalPath(workspace.path);
    if (canonical !== '' && !workspaceByPath.has(canonical)) workspaceByPath.set(canonical, workspace);
  }

  const managedPaths = new Map();
  const managed = Object.entries(projects).map(([projectId, project]) => {
    const canonical = canonicalPath(project?.cwd);
    // `Map.get` devuelve `undefined`, no `null`: normalizarlo aquí evita el `workspace.workspaceId` de
    // un proyecto que no tiene workspace (defecto real encontrado por las pruebas de LSC-016).
    const workspace = (canonical === '' ? null : workspaceByPath.get(canonical)) ?? null;
    const row = assignments[projectId];
    const assigned = row !== null && typeof row === 'object' && !Array.isArray(row) ? Object.entries(row) : [];
    const active = assigned.filter(([, value]) => value?.enabled === true);
    const duplicate = canonical !== '' && managedPaths.has(canonical);
    if (canonical !== '') managedPaths.set(canonical, projectId);
    return {
      projectId,
      name: text(project?.name),
      cwd: normalizeCwd(project?.cwd),
      workspaceId: workspace === null ? null : workspace.workspaceId,
      workspaceTitle: workspace === null ? '' : workspace.title,
      linkState: workspace === null ? MANAGED_UNMATCHED : workspace.linkState === CONFLICT ? CONFLICT : LINKED,
      skills: assigned.length,
      active: active.length,
      reason: duplicate
        ? 'otro proyecto registrado declara la misma ruta canónica'
        : workspace === null
          ? 'ningún workspace de DSH declara esta ruta'
          : '',
    };
  });

  // El proyecto actual sale del directorio de la sesión viva, con la misma búsqueda por prefijo.
  const currentWorkspace = findWorkspaceForPath(workspaces, hostCwd);
  const hostCanonical = canonicalPath(hostCwd);
  const currentProject = hostCanonical === '' ? null : managed.find((row) => canonicalPath(row.cwd) === hostCanonical) ?? null;
  const current = {
    cwd: normalizeCwd(hostCwd),
    workspaceId: currentWorkspace === null ? null : currentWorkspace.workspaceId,
    workspaceTitle: currentWorkspace === null ? '' : currentWorkspace.title,
    projectId: currentProject === null ? null : currentProject.projectId,
    via: currentWorkspace === null ? UNKNOWN_LINK : 'session-cwd',
  };

  const summary = {
    discovered: workspaces.length,
    managed: managed.length,
    legacyMatches: workspaces.filter((workspace) => workspace.linkState === LEGACY_MATCH).length,
    pendingAdoption: workspaces.filter((workspace) => workspace.linkState === LEGACY_MATCH).length,
    conflicts: workspaces.filter((workspace) => workspace.linkState === CONFLICT).length,
    managedWithoutWorkspace: managed.filter((row) => row.workspaceId === null).length,
    missingDirectories: workspaces.filter((workspace) => workspace.status === AVAILABILITY_MISSING_DIR).length,
  };

  return { workspaces, managed, current, summary };
}
