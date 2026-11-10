/**
 * Colisiones entre lo que dice el registro, lo que hay en disco y lo que el Host cargaría.
 *
 * Módulo PURO: sólo compara datos ya leídos. No toca el disco, no conoce Cordis y no lanza.
 * La normalización de nombres y de rutas vive aquí porque es la ÚNICA que se permite (D7): un nombre
 * canónico es el que el Host aceptaría tal cual, sin NFC/NFKC de por medio; un nombre que sólo se
 * parece (por composición Unicode o por mayúsculas) NO se iguala nunca, y esa diferencia se diagnostica.
 */

import { cwdKey } from './format.mjs';

/** Los seis tipos de colisión del contrato §3.2, en su orden de lectura. */
export const COLLISION_CODES = [
  'identity-duplicate',
  'name-collision',
  'path-collision',
  'content-collision',
  'assignment-shadowed',
  'legacy-collision',
];

/** Mismo patrón que el Host: minúsculas y dígitos separados por guiones simples. */
export const HOST_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SEVERITY_RANK = { block: 0, warn: 1, info: 2 };

export function isHostSkillName(value) {
  return typeof value === 'string' && HOST_SKILL_NAME.test(value);
}

/**
 * Nombre canónico de una skill: el nombre recortado si el Host lo aceptaría, o null.
 * NFKC se usa SÓLO para diagnosticar (ver `diagnoseSkillName`); jamás para igualar dos nombres, porque
 * dos nombres que difieren en la forma de composición son dos skills distintas para el cargador.
 */
export function canonicalSkillName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return HOST_SKILL_NAME.test(trimmed) ? trimmed : null;
}

/**
 * Variante diagnóstica: si tras NFKC el nombre sería válido pero el original no, devuelve el nombre
 * normalizado sólo para explicarlo en un mensaje. Nunca se usa como clave de igualdad.
 */
export function diagnoseSkillName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (HOST_SKILL_NAME.test(trimmed)) return null;
  const folded = trimmed.normalize('NFKC');
  return HOST_SKILL_NAME.test(folded) && folded !== trimmed ? folded : null;
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nameOf(entry) {
  return canonicalSkillName(entry?.canonicalName) ?? canonicalSkillName(entry?.name);
}

function ownerKindOf(entry) {
  return typeof entry?.owner?.kind === 'string' ? entry.owner.kind : 'unknown';
}

function entryPath(entry) {
  const path = entry?.location?.path;
  return typeof path === 'string' && path !== '' ? path : null;
}

function directoryOf(entry) {
  const directory = entry?.location?.directory;
  return typeof directory === 'string' && directory !== '' ? directory : null;
}

function locationKeyOf(entry) {
  const kind = entry?.location?.kind;
  if (kind === 'virtual') return null;
  const directory = directoryOf(entry);
  if (kind === 'directory' || (!entryPath(entry) && directory)) {
    return directory ? cwdKey(directory) : null;
  }
  const path = entryPath(entry);
  if (path) return cwdKey(path);
  return directory ? cwdKey(directory) : null;
}

function signatureOf(entry) {
  return `${ownerKindOf(entry)}|${text(entry?.origin?.kind)}|${locationKeyOf(entry) ?? 'virtual'}|${text(entry?.owner?.provider)}`;
}

/** Texto de una ruta normalizado a `/` para comparar sin depender del separador de Windows. */
function slashPath(entry) {
  const path = entryPath(entry) ?? directoryOf(entry) ?? '';
  return path.replace(/\\/g, '/');
}

/** `projectId` del segmento `<...>/materialized/<projectId>/...`, o `null` si no es una vista materializada. */
function materializedProjectOf(entry) {
  const match = slashPath(entry).match(/\/materialized\/([^/]+)\//i);
  return match === null ? null : match[1];
}

/** Ruta con el segmento `<projectId>` de `<...>/materialized/<projectId>/` sustituido por `*`. */
function materializedShapeOf(entry) {
  return slashPath(entry).replace(/\/materialized\/[^/]+\//i, '/materialized/*/').toLowerCase();
}

function contentShaOf(entry) {
  const sha = text(entry?.identity?.contentSha256).trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(sha) ? sha : null;
}

/**
 * ¿Son todas las filas la MISMA skill propia, materializada por proyectos distintos?
 *
 * R16.3bis §1: `materialized/<projectId>/<skill>` es una copia por proyecto de una sola skill del
 * centro. Si el nombre canónico y el contenido (`identity.contentSha256`) coinciden y la única
 * diferencia de ruta es el segmento `<projectId>`, no hay dos skills: hay una, vista desde dos
 * proyectos. Tratarlo como `name-collision` (y encima como block) impediría materializar el segundo
 * proyecto legítimamente.
 */
function isSameSkillAcrossProjects(group) {
  if (group.length < 2) return false;
  const shas = new Set();
  const shapes = new Set();
  for (const entry of group) {
    if (ownerKindOf(entry) !== 'lifecode') return false;
    if (materializedProjectOf(entry) === null) return false;
    const sha = contentShaOf(entry);
    if (sha === null) return false;
    shas.add(sha);
    shapes.add(materializedShapeOf(entry));
  }
  return shas.size === 1 && shapes.size === 1;
}


function projectList(projects) {
  if (Array.isArray(projects)) return projects.filter((project) => isObject(project));
  if (isObject(projects)) {
    return Object.entries(projects)
      .filter(([, value]) => isObject(value))
      .map(([id, value]) => ({ id, ...value }));
  }
  return [];
}

function projectIndex(projects) {
  const byId = new Map();
  for (const project of projectList(projects)) {
    const id = text(project.id || project.projectId);
    if (id !== '') byId.set(id, { ...project, id });
  }
  return byId;
}

function cwdOwnerIndex(projects) {
  const index = new Map();
  for (const project of projects) {
    const key = cwdKey(project.cwd);
    if (key === '') continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(project.id);
  }
  return index;
}

function entryProjectId(entry, byCwd) {
  const explicit = text(entry?.projectId || entry?.scope?.projectId);
  if (explicit !== '') return explicit;
  const key = cwdKey(entry?.scope?.cwd);
  if (key === '') return null;
  const owners = byCwd.get(key) ?? [];
  return owners.length === 1 ? owners[0] : null;
}

function rowOf(entry, byCwd) {
  const row = {
    key: text(entry?.key) || nameOf(entry) || 'entrada',
    // El nombre legible de la fila: `content-collision` usa el sha256 como `key`, así que sin este campo
    // el preflight no puede casar la colisión con el sujeto (§4) y la omite.
    name: nameOf(entry) ?? null,
    owner: ownerKindOf(entry),
    location: entryPath(entry) ?? directoryOf(entry),
  };
  const projectId = entryProjectId(entry, byCwd);
  if (projectId !== null) row.projectId = projectId;
  return row;
}

function projectRow(project) {
  return {
    key: project.id,
    owner: 'project',
    location: projectPath(project),
    projectId: project.id,
  };
}

function projectPath(project) {
  const cwd = text(project?.cwd);
  return cwd === '' ? null : cwd;
}

function makeCollision(code, severity, key, rows, explanation, evidence = []) {
  return { code, severity, key: text(key) || 'sin-clave', rows, explanation, evidence };
}

function groupBy(values, keyOf) {
  const map = new Map();
  for (const value of values) {
    const key = keyOf(value);
    if (key === null || key === undefined) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  return map;
}

function identityDuplicates(entries, projects, byCwd) {
  const collisions = [];
  const byUuid = groupBy(entries, (entry) => {
    const uuid = text(entry?.identity?.uuid).trim().toLowerCase();
    return uuid === '' ? null : uuid;
  });
  for (const [uuid, group] of byUuid) {
    const names = new Set();
    const hashes = new Set();
    for (const entry of group) {
      const name = nameOf(entry);
      if (name !== null) names.add(name);
      const hash = text(entry?.identity?.contentSha256).trim().toLowerCase();
      if (hash !== '') hashes.add(hash);
    }
    // §3.1: una identidad no puede designar dos contenidos. Da igual que el nombre coincida: si el mismo
    // uuid aparece con mas de un sha256, es duplicado de identidad (block). Con los mismos hashes no lo es.
    const differentNames = names.size > 1;
    const differentContent = hashes.size > 1;
    if (differentNames || differentContent) {
      const why = differentNames
        ? `aparece en ${names.size} skills distintas (${[...names].sort().join(', ')})`
        : `aparece con ${hashes.size} contenidos distintos`;
      collisions.push(makeCollision(
        'identity-duplicate',
        'block',
        uuid,
        group.map((entry) => rowOf(entry, byCwd)),
        `El uuid ${uuid} ${why}; una identidad no puede designar dos cosas.`,
      ));
    }
  }
  const byProjectUuid = groupBy(projects, (project) => {
    const uuid = text(project?.uuid).trim().toLowerCase();
    return uuid === '' ? null : uuid;
  });
  for (const [uuid, group] of byProjectUuid) {
    if (group.length > 1) {
      collisions.push(makeCollision(
        'identity-duplicate',
        'block',
        uuid,
        group.map(projectRow),
        `El uuid de proyecto ${uuid} aparece en ${group.length} registros de proyecto; la identidad de proyecto es única.`,
      ));
    }
  }
  return collisions;
}

/**
 * Choques de nombre canónico. Un nombre sólo es colisión si lo reclaman entradas de procedencia
 * distinta; la misma skill propia materializada por varios proyectos NO es una colisión (R16.3bis §1,
 * ver `isSameSkillAcrossProjects`) y por eso tampoco ensucia `ambiguousNames`.
 *
 * La severidad es block sólo cuando hay más de una fila propia en ubicaciones distintas: dos copias
 * nuestras que no son la misma skill sí se pisan al materializar.
 */
function nameCollisions(entries, byCwd) {
  const collisions = [];
  const ambiguous = new Set();
  const byName = groupBy(entries, nameOf);
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    if (isSameSkillAcrossProjects(group)) continue;
    const signatures = new Set(group.map(signatureOf));
    if (signatures.size < 2) continue;
    const ours = group.filter((entry) => ownerKindOf(entry) === 'lifecode');
    const ourLocations = new Set(ours.map((entry) => locationKeyOf(entry) ?? `virtual:${entry?.key ?? ''}`));
    const severity = ours.length > 1 && (ourLocations.size > 1 || ourLocations.size === 0) ? 'block' : 'warn';
    ambiguous.add(name);
    collisions.push(makeCollision(
      'name-collision',
      severity,
      name,
      group.map((entry) => rowOf(entry, byCwd)),
      `El nombre «${name}» lo reclaman ${group.length} entradas de procedencia distinta (${describeProvenance(group)}).`,
    ));
  }
  return { collisions, ambiguous };
}

/** Etiqueta legible de la procedencia real de una fila: raíz conocida, origen declarado o dueño. */
function provenanceOf(entry) {
  const rootId = text(entry?.location?.rootId);
  const key = rootId.split(':')[0].toLowerCase();
  const byRoot = {
    'project-dsh': 'proyecto actual',
    'project-agents': 'proyecto (agents)',
    'user-dsh': 'biblioteca de usuario',
    'user-agents': 'biblioteca de agentes',
    'compiler-projects': 'compilador anterior',
    'compiler-global': 'compilador anterior (global)',
    materialized: 'vista materializada',
    state: 'catálogo del centro',
    loader: 'catálogo del Host',
    bundled: 'builtin del Host',
    custom: 'raíz personalizada',
  };
  return byRoot[key]
    || text(entry?.origin?.label)
    || rootId
    || text(entry?.owner?.provider)
    || ownerKindOf(entry);
}

/**
 * Lista de procedencias para el texto de la colisión. `owner.kind` se repite (todas las filas de disco
 * son `filesystem`) y no explica nada; el origen sí (biblioteca de usuario, compilador anterior…). Si dos
 * filas comparten etiqueta, se añade la ruta para desambiguarlas.
 */
function describeProvenance(group) {
  const labels = group.map((entry) => provenanceOf(entry));
  const counts = new Map();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return labels
    .map((label, index) => {
      if ((counts.get(label) ?? 0) < 2) return label;
      const path = entryPath(group[index]);
      return path === '' ? label : `${label} en ${path}`;
    })
    .join(', ');
}

function pathCollisions(entries, projects, workspaces, byCwd) {
  const collisions = [];
  const byLocation = groupBy(entries, locationKeyOf);
  for (const [location, group] of byLocation) {
    const keys = new Set(group.map((entry) => text(entry?.key) || signatureOf(entry)));
    if (keys.size < 2) continue;
    collisions.push(makeCollision(
      'path-collision',
      'block',
      location,
      group.map((entry) => rowOf(entry, byCwd)),
      `Dos entradas distintas apuntan a la misma ruta canónica (${location}); una de las dos es invisible o se pisa al materializar.`,
    ));
  }
  const byProjectCwd = groupBy(projects, (project) => {
    const key = cwdKey(project?.cwd);
    return key === '' ? null : key;
  });
  for (const [location, group] of byProjectCwd) {
    if (group.length < 2) continue;
    collisions.push(makeCollision(
      'path-collision',
      'block',
      location,
      group.map(projectRow),
      `${group.length} proyectos registrados comparten la misma ruta canónica (${location}).`,
    ));
  }
  const byWorkspacePath = groupBy(workspaces, (workspace) => {
    const key = cwdKey(workspace?.path ?? workspace?.canonicalPath);
    return key === '' ? null : key;
  });
  for (const [location, group] of byWorkspacePath) {
    if (group.length < 2) continue;
    collisions.push(makeCollision(
      'path-collision',
      'block',
      location,
      group.map((workspace) => ({
        key: text(workspace?.workspaceId ?? workspace?.id) || location,
        owner: 'workspace',
        location: text(workspace?.path),
      })),
      `${group.length} workspaces del Host comparten la misma ruta canónica (${location}).`,
    ));
  }
  return collisions;
}

function contentCollisions(entries, byCwd) {
  const collisions = [];
  const byHash = groupBy(entries, (entry) => {
    const sha = text(entry?.identity?.contentSha256).trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(sha) ? sha : null;
  });
  for (const [sha, group] of byHash) {
    const names = new Set();
    for (const entry of group) {
      const name = nameOf(entry);
      if (name !== null) names.add(name);
    }
    if (names.size < 2) continue;
    collisions.push(makeCollision(
      'content-collision',
      'warn',
      sha,
      group.map((entry) => rowOf(entry, byCwd)),
      `El mismo contenido (${sha.slice(0, 12)}…) aparece con ${names.size} nombres distintos (${[...names].sort().join(', ')}); puede ser duplicado o un rename sin versión.`,
    ));
  }
  return collisions;
}

function projectIdOfMaterializedPath(value) {
  const path = text(value).replace(/\\/g, '/');
  const match = path.match(/\/materialized\/([^/]+)\//i);
  return match === null ? null : match[1];
}

/**
 * Sombreado de una asignación habilitada: la copia que cargaría el Host no es la del proyecto de la
 * asignación.
 *
 * R16.3bis §2: cuando el llamante declara el proyecto observado (`observedProjectId`, derivado del
 * `hostCwd`), sólo se juzgan las asignaciones DE ESE proyecto. El sombreado cruzado —la asignación de
 * `proyecto-b` tapada por la materialización de `plugins-dhs`, el proyecto que está mirando el Host— no
 * es un conflicto de la asignación: es la resolución del cwd actual. Sin contexto observado se mantiene
 * el barrido histórico para las llamadas puras que aún no lo aportan.
 *
 * Tampoco es conflicto que el ganador sea la materialización del MISMO proyecto: ahí el Host carga
 * exactamente lo que la asignación pide.
 */
function assignmentShadowed(entries, assignments, projects, byCwd, observed = {}) {
  const collisions = [];
  if (!isObject(assignments)) return collisions;
  const observedProjectId = observed?.observedProjectId;
  const byProject = projects.length > 0 ? new Map(projects.map((project) => [project.id, project])) : new Map();
  for (const [projectId, row] of Object.entries(assignments)) {
    if (!isObject(row)) continue;
    if (observedProjectId !== undefined && projectId !== observedProjectId) continue;
    const project = byProject.get(projectId) ?? null;
    const projectCwd = cwdKey(project?.cwd);
    for (const [skillId, assignment] of Object.entries(row)) {
      if (!isObject(assignment) || assignment.enabled !== true) continue;
      const name = canonicalSkillName(skillId);
      if (name === null) continue;
      const candidates = entries.filter((entry) => nameOf(entry) === name);
      const ours = candidates.find((entry) => {
        if (ownerKindOf(entry) !== 'lifecode') return false;
        const entryProject = entryProjectId(entry, byCwd);
        if (entryProject !== null && entryProject !== projectId) return false;
        if (projectCwd !== '' && entry?.scope?.cwd && cwdKey(entry.scope.cwd) !== projectCwd) return false;
        return true;
      });
      if (!ours) continue;
      let winner = ours.association?.shadowedBy ?? null;
      if (!winner && ours.association?.loadedByHost === false) {
        const loaded = candidates.find((entry) => entry?.association?.loadedByHost === true && text(entry?.key) !== text(ours?.key));
        if (loaded) {
          winner = {
            provider: text(loaded?.association?.provider ?? loaded?.owner?.provider),
            path: entryPath(loaded),
            source: text(loaded?.origin?.kind),
          };
        }
      }
      if (!winner) continue;
      const winnerProvider = text(winner.provider).trim().toLowerCase();
      const winnerProject = projectIdOfMaterializedPath(winner.path);
      if (winnerProvider === 'lifecode-skill-center' && winnerProject !== null && winnerProject === projectId) continue;
      collisions.push(makeCollision(
        'assignment-shadowed',
        'warn',
        `${projectId}:${skillId}`,
        [{ ...rowOf(ours, byCwd), projectId }],
        `La asignación habilitada «${skillId}» del proyecto ${projectId} no es la que carga el Host: la sombrea ${text(winner.provider) || 'otro proveedor'}${winner.path ? ` en ${winner.path}` : ''}. Materializar la dejaría invisible.`,
        [{ provider: text(winner.provider), path: winner.path ?? null, source: text(winner.source) }],
      ));
    }
  }
  return collisions;
}

const LEGACY_MARKER = '/skill-compiler/projects/';

/**
 * Historia del compilador: no son conflictos actuales.
 *
 * R16.3 §3: las skills bajo `<dshHome>/skill-compiler/projects` son una ubicación heredada que el Host ya
 * no carga; el compilador dejó una fila por skill y por proyecto. Antes se emitía una colisión por nombre
 * (46 en el inventario real), lo que convertía el archivo histórico en «conflictos actuales» y mentía en
 * el KPI. Ahora se agrupa por **raíz legacy** (`location.rootId`): UNA colisión warn por raíz, con todas
 * sus filas y `count`. Sigue siendo visible —el dato no se esconde— pero cuenta como un hecho histórico,
 * no como N conflictos vivos.
 */
function legacyCollisions(entries, projects, manifests, byCwd) {
  const collisions = [];
  const legacy = entries.filter((entry) => {
    const path = (entryPath(entry) ?? directoryOf(entry) ?? '').replace(/\\/g, '/').toLowerCase();
    return path.includes(LEGACY_MARKER);
  });
  if (legacy.length > 0) {
    const byRoot = groupBy(legacy, (entry) => text(entry?.location?.rootId) || 'legacy');
    for (const [rootId, group] of byRoot) {
      const rows = group.map((entry) => rowOf(entry, byCwd));
      collisions.push({
        ...makeCollision(
          'legacy-collision',
          'warn',
          rootId,
          rows,
          `La raíz heredada ${rootId} conserva ${rows.length} skills bajo <dshHome>/skill-compiler/projects; el Host ya no las carga desde ahí. Es historia del compilador, no un conflicto activo.`,
        ),
        count: rows.length,
      });
    }
  }
  const disks = entries.filter((entry) => {
    const kind = entry?.location?.kind;
    return (kind === 'file' || kind === 'directory') && typeof entry?.location?.rootId === 'string';
  });
  const byRootName = groupBy(disks, (entry) => {
    const name = nameOf(entry);
    return name === null ? null : `${entry.location.rootId}|${name}`;
  });
  for (const [key, group] of byRootName) {
    const kinds = new Set(group.map((entry) => entry?.location?.kind));
    if (kinds.has('file') && kinds.has('directory')) {
      collisions.push(makeCollision(
        'legacy-collision',
        'warn',
        key.split('|')[1] ?? key,
        group.map((entry) => rowOf(entry, byCwd)),
        'Conviven una carpeta <nombre>/SKILL.md y un <nombre>.md suelto en la misma raíz; el Host sólo carga uno.',
      ));
    }
  }
  const known = new Set(projects.map((project) => project.id));
  for (const manifest of Array.isArray(manifests) ? manifests : []) {
    if (!isObject(manifest)) continue;
    const projectId = text(manifest.projectId ?? manifest.id);
    if (projectId === '' || known.has(projectId)) continue;
    collisions.push(makeCollision(
      'legacy-collision',
      'warn',
      projectId,
      [{ key: projectId, owner: 'manifest', location: text(manifest.path) || null, projectId }],
      `Hay un manifiesto con projectId ${projectId} que no existe en el registro; el proyecto quedaría huérfano.`,
    ));
  }
  return collisions;
}

function compareCollisions(a, b) {
  const severity = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
  if (severity !== 0) return severity;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Detecta los seis tipos de colisión del contrato §3.2 sobre datos ya observados.
 * `null` en `entries`/`projects`/`assignments` se trata como ausencia de esa observación, no como error.
 *
 * `observedProjectId` (R16.3bis §2) limita `assignment-shadowed` al proyecto que el Host está mirando.
 * Se deja `undefined` en las llamadas puras que aún no tienen contexto; ahí se conserva el barrido
 * histórico y el llamante que sí lo tiene debe pasarlo.
 */
export function detectCollisions({
  entries = [],
  projects = [],
  assignments = null,
  workspaces = [],
  manifests = [],
  observedProjectId = undefined,
} = {}) {
  const list = Array.isArray(entries) ? entries.filter(isObject) : [];
  const projectRecords = projectList(projects);
  const byCwd = cwdOwnerIndex(projectRecords);
  const found = [
    ...identityDuplicates(list, projectRecords, byCwd),
    ...nameCollisions(list, byCwd).collisions,
    ...pathCollisions(list, projectRecords, Array.isArray(workspaces) ? workspaces.filter(isObject) : [], byCwd),
    ...contentCollisions(list, byCwd),
    ...assignmentShadowed(list, assignments, projectRecords, byCwd, { observedProjectId }),
    ...legacyCollisions(list, projectRecords, manifests, byCwd),
  ];
  found.sort(compareCollisions);
  const nameScan = nameCollisions(list, byCwd);
  const ambiguousNames = [...nameScan.ambiguous].sort();
  const byKey = new Map();
  for (const collision of found) {
    const keys = new Set([collision.key]);
    for (const row of collision.rows) {
      if (row?.key) keys.add(String(row.key));
      if (row?.projectId) keys.add(String(row.projectId));
    }
    for (const key of keys) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(collision);
    }
  }
  return { collisions: found, ambiguousNames, byKey };
}
