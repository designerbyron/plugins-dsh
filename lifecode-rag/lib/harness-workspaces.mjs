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
