/**
 * Proyección pura de proyectos: clasificación, payload de la lista y detalle.
 *
 * Este módulo NO hace E/S y NO puede `await`: el adaptador resuelve `registry.list()` y
 * `await workspace.status()` y entrega los workspaces ya materializados. La clasificación de §1.2 del
 * contrato vive SÓLO aquí: la API y la UI no recalculan `state`.
 */

import { cwdKey, normalizeCwd, projectIdFor, projectNameFor } from './format.mjs';

export const PROJECT_STATES = [
  'discovered',
  'external-managed',
  'managed',
  'healthy',
  'unavailable',
  'identity-conflict',
  'partially-inspected',
];

/** Operaciones permitidas por estado (contract §1.3), en orden estable. */
const ALLOWED = {
  'identity-conflict': ['read', 'inspect', 'detach-project'],
  unavailable: ['read', 'inspect', 'detach-project', 'repair-manifest'],
  'partially-inspected': ['read', 'inspect'],
  'external-managed': ['read', 'inspect', 'adopt-project', 'detach-project'],
  discovered: ['read', 'inspect', 'register-project'],
  managed: ['read', 'inspect', 'register-project', 'repair-manifest', 'assign-skill', 'materialize-project', 'rename-project', 'detach-project'],
  healthy: ['read', 'inspect', 'assign-skill', 'materialize-project', 'rename-project', 'repair-manifest', 'detach-project'],
};

const SOURCE_IDS = [
  'state',
  'workspace-registry',
  'skills-registry',
  'loader',
  'filesystem-project',
  'manifest',
  'filesystem-view',
  'sessions',
];

const INSPECTION_STATUSES = new Set(['complete', 'incomplete', 'not-run', 'failed']);

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function mapValue(value) {
  return isObject(value) ? value : {};
}

export function allowedOperations(state) {
  return Array.isArray(ALLOWED[state]) ? ALLOWED[state].slice() : ['read', 'inspect'];
}

function normalizeWorkspace(item) {
  if (!isObject(item)) return null;
  const id = safeText(item.workspaceId) || safeText(item.id);
  const path = normalizeCwd(safeText(item.path));
  const rawStatus = safeText(item.availability) || safeText(item.status);
  const availability = rawStatus === 'missing-dir' ? 'missing-dir' : rawStatus === 'ok' || rawStatus === '' ? (path === '' ? 'unknown' : 'ok') : 'unknown';
  const sessions = Array.isArray(item.sessionIds) ? item.sessionIds.length : null;
  const sessionCount = Number.isInteger(item.sessionCount) ? item.sessionCount : sessions;
  return {
    workspaceId: id === '' ? null : id,
    title: safeText(item.title),
    path,
    canonicalPath: cwdKey(path),
    sessionCount,
    availability,
  };
}

function workspaceForPath(workspaces, path) {
  const key = cwdKey(path);
  if (key === '') return null;
  let best = null;
  for (const workspace of workspaces) {
    if (workspace.canonicalPath === '') continue;
    if (workspace.canonicalPath === key) return workspace;
    if (key.startsWith(`${workspace.canonicalPath}/`)) {
      if (best === null || workspace.canonicalPath.length > best.canonicalPath.length) best = workspace;
    }
  }
  return best;
}

function normalizeManifest(manifest) {
  if (!isObject(manifest)) {
    return { present: false, valid: false, projectId: null, sha256: null, uuid: null, registeredAt: null, path: null };
  }
  const status = safeText(manifest.status);
  const present = manifest.present === true || status === 'ok' || manifest.present === undefined && status === '';
  return {
    present,
    valid: manifest.valid !== false && status !== 'invalid',
    projectId: safeText(manifest.projectId) || null,
    sha256: safeText(manifest.sha256) || null,
    uuid: safeText(manifest.uuid) || null,
    registeredAt: safeText(manifest.registeredAt) || null,
    path: safeText(manifest.path) || null,
  };
}

function normalizeInspection(inspection) {
  if (!isObject(inspection)) return { status: 'not-run', inspectedAt: null, reason: '' };
  const status = INSPECTION_STATUSES.has(inspection.status) ? inspection.status : 'not-run';
  return {
    status,
    inspectedAt: safeText(inspection.inspectedAt) || null,
    reason: safeText(inspection.reason),
  };
}

function normalizeSessions(sessions) {
  if (!isObject(sessions)) return { count: null, archived: 0, source: 'none' };
  const count = Number.isInteger(sessions.count) ? sessions.count : null;
  const archived = Number.isInteger(sessions.archived) ? sessions.archived : 0;
  const source = ['workspace', 'persistence'].includes(sessions.source) ? sessions.source : 'none';
  return { count, archived, source };
}

/**
 * Normaliza la observación de un proyecto. `manifest` es el resultado de `readManifest` (o null si no
 * se pudo observar); `availability` y `inspection` los resuelve el adaptador.
 */
export function projectObservation({
  workspace = null,
  record = null,
  manifest = null,
  availability = undefined,
  inspection = null,
  sessions = null,
  duplicateCwd = false,
  workspaceConflict = false,
  storeWritable = true,
  sourcesError = false,
} = {}) {
  const normalizedWorkspace = normalizeWorkspace(workspace);
  const normalizedRecord = isObject(record) ? record : null;
  const cwd = normalizeCwd(safeText(normalizedRecord?.cwd) || safeText(normalizedWorkspace?.path));
  const canonicalPath = cwdKey(cwd);
  const resolvedAvailability = safeText(availability)
    || normalizedWorkspace?.availability
    || 'unknown';
  return {
    projectId: safeText(normalizedRecord?.id) || safeText(workspace?.projectId) || null,
    cwd,
    canonicalPath,
    workspace: normalizedWorkspace,
    record: normalizedRecord,
    manifest: normalizeManifest(manifest),
    availability: ['ok', 'missing-dir', 'unknown'].includes(resolvedAvailability) ? resolvedAvailability : 'unknown',
    inspection: normalizeInspection(inspection),
    sessions: normalizeSessions(sessions),
    duplicateCwd: duplicateCwd === true,
    workspaceConflict: workspaceConflict === true,
    storeWritable: storeWritable !== false,
    sourcesError: sourcesError === true,
  };
}

function reasonList(reasons) {
  return reasons.filter((reason) => typeof reason === 'string' && reason !== '');
}

/**
 * Clasifica un proyecto con la tabla §1.2 y su precedencia. Es la ÚNICA fuente del campo `state`.
 */
export function classifyProject(observation = {}) {
  const obs = isObject(observation) ? observation : {};
  const record = isObject(obs.record) ? obs.record : null;
  const manifest = normalizeManifest(obs.manifest);
  const availability = safeText(obs.availability) || 'unknown';
  const inspection = normalizeInspection(obs.inspection);
  const findings = [];
  const reasons = [];
  const block = (code, message) => {
    findings.push({ code, severity: 'block', message });
    reasons.push(message);
  };
  const warn = (code, message) => {
    findings.push({ code, severity: 'warn', message });
    reasons.push(message);
  };

  const projectId = safeText(obs.projectId) || safeText(record?.id) || manifest.projectId;
  const manifestMismatch =
    record !== null
    && manifest.present
    && ((manifest.projectId !== null && projectId !== null && manifest.projectId !== projectId)
      || (safeText(record.uuid) !== '' && manifest.uuid !== null && safeText(record.uuid) !== manifest.uuid)
      || (safeText(record.manifestSha256) !== '' && manifest.sha256 !== null && safeText(record.manifestSha256) !== manifest.sha256));
  if (manifestMismatch) {
    block('identity-conflict', 'El manifiesto del proyecto no coincide con la identidad registrada.');
    return { state: 'identity-conflict', reasons: reasonList(reasons), findings };
  }
  if (obs.duplicateCwd === true) {
    block('identity-conflict', 'Dos proyectos registrados comparten la misma ruta canónica.');
    return { state: 'identity-conflict', reasons: reasonList(reasons), findings };
  }
  if (obs.workspaceConflict === true) {
    block('identity-conflict', 'Dos workspaces del Host comparten la misma ruta canónica.');
    return { state: 'identity-conflict', reasons: reasonList(reasons), findings };
  }
  if (availability === 'missing-dir' || record !== null && safeText(record.cwd) === '') {
    block('project-unavailable', 'La carpeta del proyecto no existe o no es accesible.');
    return { state: 'unavailable', reasons: reasonList(reasons), findings };
  }
  if (inspection.status === 'incomplete' || inspection.status === 'failed' || obs.storeWritable === false || obs.sourcesError === true) {
    block('evidence-incomplete', 'La inspección del proyecto no terminó; no hay evidencia completa.');
    return { state: 'partially-inspected', reasons: reasonList(reasons), findings };
  }
  if (record === null) {
    if (manifest.present && manifest.valid !== false) {
      warn('external-managed', 'Hay un manifiesto válido en disco, pero el proyecto no está registrado en el centro.');
      return { state: 'external-managed', reasons: reasonList(reasons), findings };
    }
    reasons.push('El workspace del Host está disponible y no hay registro ni manifiesto.');
    return { state: 'discovered', reasons: reasonList(reasons), findings };
  }

  // Registrado: lo coherente es healthy; cualquier duda es managed (nunca se finge salud).
  if (safeText(record.uuid) === '') warn('legacy-record', 'El proyecto está registrado sin uuid de identidad (registro heredado).');
  if (safeText(record.manifestSha256) === '') {
    warn('manifest-missing', 'El proyecto está registrado sin huella de manifiesto.');
  } else if (!manifest.present) {
    warn('manifest-missing', 'El proyecto está registrado con huella de manifiesto, pero el fichero no se encontró.');
  }
  if (availability === 'unknown') warn('availability-unknown', 'No se pudo comprobar si la carpeta del proyecto existe.');
  if (findings.length > 0) return { state: 'managed', reasons: reasonList(reasons), findings };
  reasons.push('Proyecto registrado con identidad coherente y sin avisos.');
  return { state: 'healthy', reasons: reasonList(reasons), findings };
}

function normalizeSources(sources, inventorySources) {
  const listValue = Array.isArray(sources) ? sources : Array.isArray(inventorySources) ? inventorySources : [];
  const map = new Map();
  for (const source of listValue) {
    if (!isObject(source)) continue;
    const id = safeText(source.id);
    if (id === '') continue;
    map.set(id, { id, status: safeText(source.status) || 'unavailable', reason: safeText(source.reason) });
  }
  return SOURCE_IDS.map((id) => map.get(id) ?? { id, status: 'unavailable', reason: 'no-observada' });
}

function indexBy(value, keys = []) {
  const index = new Map();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isObject(item)) continue;
      for (const key of keys) {
        const raw = safeText(item[key]);
        if (raw !== '') index.set(raw, item);
        index.set(cwdKey(raw), item);
      }
    }
    return index;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (!isObject(item)) continue;
      index.set(key, item);
      index.set(cwdKey(key), item);
    }
  }
  return index;
}

function lookup(index, ...keys) {
  for (const key of keys) {
    if (typeof key !== 'string' || key === '') continue;
    if (index.has(key)) return index.get(key);
    if (index.has(cwdKey(key))) return index.get(cwdKey(key));
  }
  return null;
}

function projectEntries(inventory, projectId, cwd) {
  const entries = list(inventory?.entries);
  const key = cwdKey(cwd);
  return entries.filter((entry) => {
    if (!isObject(entry)) return false;
    if (entry.projectId !== undefined) return entry.projectId === projectId;
    if (entry.owner?.kind !== 'lifecode') return false;
    return key !== '' && cwdKey(entry.scope?.cwd) === key;
  });
}

function buildSummary({ projectId, record, workspace, manifest, inspection, sessions, availability, state, inventory, duplicateCwd, workspaceConflict }) {
  const measuredAvailability = isObject(availability) ? safeText(availability.availability) : safeText(availability);
  const observation = projectObservation({
    workspace,
    record,
    manifest,
    inspection,
    sessions,
    availability: measuredAvailability,
    duplicateCwd,
    workspaceConflict,
  });
  const classification = classifyProject(observation);
  const assignments = mapValue(mapValue(state?.assignments)[projectId]);
  const assigned = Object.keys(assignments).length;
  const active = Object.values(assignments).filter((assignment) => assignment?.enabled === true).length;
  const materialized = projectEntries(inventory, projectId, observation.cwd)
    .filter((entry) => entry.location?.kind !== 'virtual' && entry.location?.path).length;
  return {
    projectId,
    name: safeText(record?.name) || projectNameFor(observation.cwd),
    cwd: observation.cwd,
    canonicalPath: observation.canonicalPath,
    state: classification.state,
    registration: {
      present: record !== null,
      uuid: safeText(record?.uuid) || null,
      manifestSha256: safeText(record?.manifestSha256) || null,
      registeredAt: safeText(record?.createdAt) || null,
      adoptedAt: safeText(record?.adoptedAt) || null,
    },
    workspace: observation.workspace
      ? {
        workspaceId: observation.workspace.workspaceId,
        title: observation.workspace.title,
        path: observation.workspace.path || null,
        availability: observation.workspace.availability,
      }
      : { workspaceId: null, title: '', path: null, availability: observation.availability },
    inspection: observation.inspection,
    counts: { assigned, active, materialized },
    reasons: classification.reasons,
    findings: classification.findings,
    observation,
    record,
    manifest: normalizeManifest(manifest),
  };
}

function publicSummary(built) {
  const { observation, findings, record, manifest, ...summary } = built;
  return summary;
}

/** Manifiestos observados como lista normalizada (objeto indexado o array). */
function manifestCandidates(manifests) {
  const out = [];
  const add = (item, key) => {
    if (!isObject(item)) return;
    const projectId = safeText(item.projectId) || (isObject(item.project) ? safeText(item.project.id) : '') || safeText(key);
    out.push({ projectId, manifest: item, cwd: normalizeCwd(safeText(item.cwd)) });
  };
  if (Array.isArray(manifests)) {
    for (const item of manifests) add(item, '');
  } else if (isObject(manifests)) {
    for (const [key, item] of Object.entries(manifests)) add(item, key);
  }
  return out;
}

/**
 * Payload de la lista de proyectos. Recibe workspaces ya resueltos y tolera `inventory=null`,
 * `sources` parciales y mapas opcionales `manifests`/`inspections`/`sessions` por projectId o cwdKey.
 */
export function buildProjectsPayload({
  workspaces = [],
  state = {},
  hostCwd = '',
  inventory = null,
  sources = [],
  now = '',
  manifests = null,
  inspections = null,
  sessions = null,
  availability = null,
  currentConfidence = '',
  currentVia = '',
} = {}) {
  const generatedAt = typeof now === 'string' && now !== '' ? now : new Date().toISOString();
  const normalizedSources = normalizeSources(sources, inventory?.sources);
  const workspaceList = list(workspaces).map(normalizeWorkspace).filter(Boolean);
  const records = Object.entries(mapValue(state?.projects)).map(([projectId, record]) => ({ projectId, record }));
  const manifestIndex = indexBy(manifests, ['projectId', 'cwd', 'path']);
  const inspectionIndex = indexBy(inspections, ['projectId', 'cwd']);
  const sessionsIndex = indexBy(sessions, ['projectId', 'cwd']);
  const availabilityIndex = indexBy(availability, ['projectId', 'cwd']);

  const cwdCounts = new Map();
  for (const { record } of records) {
    const key = cwdKey(record?.cwd);
    if (key !== '') cwdCounts.set(key, (cwdCounts.get(key) ?? 0) + 1);
  }
  const workspaceCounts = new Map();
  for (const workspace of workspaceList) {
    if (workspace.canonicalPath !== '') workspaceCounts.set(workspace.canonicalPath, (workspaceCounts.get(workspace.canonicalPath) ?? 0) + 1);
  }

  const projects = [];
  const knownIds = new Set();
  for (const { projectId, record } of records) {
    knownIds.add(projectId);
    const cwd = safeText(record?.cwd);
    const workspace = workspaceForPath(workspaceList, cwd);
    const manifest = lookup(manifestIndex, projectId, cwd);
    const built = buildSummary({
      projectId,
      record,
      workspace,
      manifest,
      inspection: lookup(inspectionIndex, projectId, cwd),
      sessions: lookup(sessionsIndex, projectId, cwd),
      availability: lookup(availabilityIndex, projectId, cwd),
      state,
      inventory,
      duplicateCwd: (cwdCounts.get(cwdKey(cwd)) ?? 0) > 1,
      workspaceConflict: workspace !== null && (workspaceCounts.get(workspace.canonicalPath) ?? 0) > 1,
    });
    projects.push(built);
  }
  // Manifiestos válidos sin registro: proyectos external-managed, aunque no estén en el registro.
  for (const candidate of manifestCandidates(manifests)) {
    const { projectId, manifest, cwd } = candidate;
    if (projectId === '' || knownIds.has(projectId)) continue;
    if (cwd === '' || !normalizeManifest(manifest).present) continue;
    knownIds.add(projectId);
    const workspace = workspaceForPath(workspaceList, cwd);
    const built = buildSummary({
      projectId,
      record: null,
      workspace,
      manifest,
      inspection: lookup(inspectionIndex, projectId, cwd),
      sessions: lookup(sessionsIndex, projectId, cwd),
      availability: lookup(availabilityIndex, projectId, cwd),
      state,
      inventory,
      duplicateCwd: false,
      workspaceConflict: workspace !== null && (workspaceCounts.get(workspace.canonicalPath) ?? 0) > 1,
    });
    projects.push(built);
  }

  const recordCwds = new Set(records.map(({ record }) => cwdKey(record?.cwd)).filter((key) => key !== ''));
  const manifestCwds = new Set();
  for (const candidate of manifestCandidates(manifests)) {
    if (candidate.cwd !== '') manifestCwds.add(cwdKey(candidate.cwd));
  }
  const discovered = [];
  for (const workspace of workspaceList) {
    if (workspace.availability !== 'ok' || workspace.path === '') continue;
    if (recordCwds.has(workspace.canonicalPath) || manifestCwds.has(workspace.canonicalPath)) continue;
    if (knownIds.has(projectIdFor(workspace.path))) continue;
    discovered.push({
      workspaceId: workspace.workspaceId,
      title: workspace.title,
      path: workspace.path,
      canonicalPath: workspace.canonicalPath,
      sessionCount: workspace.sessionCount,
      availability: workspace.availability,
      projectId: projectIdFor(workspace.path),
      state: 'discovered',
    });
  }

  const hostNormalized = normalizeCwd(hostCwd);
  const hostWorkspace = workspaceForPath(workspaceList, hostNormalized);
  const hostRecord = records.find(({ record }) => {
    const key = cwdKey(record?.cwd);
    return key !== '' && (key === cwdKey(hostNormalized) || cwdKey(hostNormalized).startsWith(`${key}/`));
  }) ?? null;
  const currentProjectId = hostRecord?.projectId ?? null;
  const knownCurrent = projects.find((project) => project.projectId === currentProjectId) ?? null;
  const confidence = typeof currentConfidence === 'string' && currentConfidence !== ''
    ? currentConfidence
    : hostNormalized === '' ? 'unknown' : currentProjectId !== null ? 'session' : 'unknown';
  const current = {
    cwd: hostNormalized,
    workspaceId: hostWorkspace?.workspaceId ?? null,
    workspaceTitle: hostWorkspace?.title ?? '',
    projectId: currentProjectId,
    state: knownCurrent?.state ?? null,
    confidence,
    via: typeof currentVia === 'string' && currentVia !== '' ? currentVia : 'host-cwd',
  };

  const summary = {
    total: projects.length,
    discovered: discovered.length,
    externalManaged: projects.filter((project) => project.state === 'external-managed').length,
    managed: projects.filter((project) => project.state === 'managed').length,
    healthy: projects.filter((project) => project.state === 'healthy').length,
    unavailable: projects.filter((project) => project.state === 'unavailable').length,
    identityConflict: projects.filter((project) => project.state === 'identity-conflict').length,
    partiallyInspected: projects.filter((project) => project.state === 'partially-inspected').length,
  };
  const complete = normalizedSources.every((source) => source.status !== 'error' && source.status !== 'incomplete');
  return {
    sources: normalizedSources,
    projects: projects.map(publicSummary),
    discovered,
    current,
    summary,
    generatedAt,
    complete,
  };
}

/**
 * Detalle de un proyecto: resumen + identidad, asignaciones, skills, sesiones, colisiones y findings.
 * Devuelve `null` si el projectId no corresponde a ningún registro ni manifiesto observado.
 */
export function buildProjectDetail({
  projectId = '',
  workspaces = [],
  state = {},
  inventory = null,
  sources = [],
  now = '',
  manifests = null,
  inspections = null,
  sessions = null,
  collisions = null,
  availability = null,
} = {}) {
  const payload = buildProjectsPayload({ workspaces, state, hostCwd: '', inventory, sources, now, manifests, inspections, sessions, availability });
  const summary = payload.projects.find((project) => project.projectId === projectId);
  if (!summary) return null;
  const generatedAt = payload.generatedAt;
  const normalizedSources = payload.sources;
  const record = isObject(mapValue(state?.projects)[projectId]) ? state.projects[projectId] : null;
  const manifestIndex = indexBy(manifests, ['projectId', 'cwd']);
  const detailCwd = record?.cwd ?? summary.cwd;
  const manifest = normalizeManifest(lookup(manifestIndex, projectId, detailCwd));
  // La ficha usa el MISMO estado y findings que la lista: se recalcula la clasificación con los mismos
  // flags (cwd duplicado, workspaces duplicados) y la misma observación, no con flags en falso.
  const detailWorkspaceList = list(workspaces).map(normalizeWorkspace).filter(Boolean);
  const cwdCounts = new Map();
  for (const project of Object.values(mapValue(state?.projects))) {
    const key = cwdKey(project?.cwd);
    if (key !== '') cwdCounts.set(key, (cwdCounts.get(key) ?? 0) + 1);
  }
  const workspaceCounts = new Map();
  for (const workspace of detailWorkspaceList) {
    if (workspace.canonicalPath !== '') workspaceCounts.set(workspace.canonicalPath, (workspaceCounts.get(workspace.canonicalPath) ?? 0) + 1);
  }
  const detailWorkspace = workspaceForPath(detailWorkspaceList, detailCwd);
  const classification = classifyProject(projectObservation({
    workspace: detailWorkspace,
    record,
    manifest,
    inspection: lookup(indexBy(inspections, ['projectId', 'cwd']), projectId, detailCwd),
    sessions: lookup(indexBy(sessions, ['projectId', 'cwd']), projectId, detailCwd),
    availability: lookup(indexBy(availability, ['projectId', 'cwd']), projectId, detailCwd),
    duplicateCwd: (cwdCounts.get(cwdKey(detailCwd)) ?? 0) > 1,
    workspaceConflict: detailWorkspace !== null && (workspaceCounts.get(detailWorkspace.canonicalPath) ?? 0) > 1,
  }));
  // 'not-recorded' sólo si no hay ni registro ni manifiesto; con manifiesto pero sin registro la
  // identidad está sin confirmar por el centro ('missing').
  const identityState = record === null
    ? manifest.present ? 'missing' : 'not-recorded'
    : safeText(record.manifestSha256) === ''
      ? 'not-recorded'
      : manifest.present
        ? manifest.sha256 !== null && manifest.sha256 === record.manifestSha256 ? 'match' : 'mismatch'
        : 'missing';
  const assignments = Object.entries(mapValue(mapValue(state?.assignments)[projectId]))
    .map(([skillId, assignment]) => ({
      skillId,
      version: safeText(assignment?.version),
      enabled: assignment?.enabled === true,
      pinnedAt: safeText(assignment?.pinnedAt) || null,
      updatedAt: safeText(assignment?.updatedAt),
      by: assignment?.by === 'ai' ? 'ai' : 'human',
    }))
    .sort((a, b) => a.skillId.localeCompare(b.skillId));
  const entries = projectEntries(inventory, projectId, summary.cwd);
  const skills = assignments.map((assignment) => {
    const entry = entries.find((candidate) => candidate.canonicalName === assignment.skillId || candidate.name === assignment.skillId || candidate.identity?.version === undefined && candidate.key === `lifecode:${projectId}:${assignment.skillId}`) ?? null;
    return {
      skillId: assignment.skillId,
      name: assignment.skillId,
      assignedVersion: assignment.version,
      host: entry === null ? null : {
        provider: safeText(entry.association?.provider) || safeText(entry.owner?.provider) || 'lifecode-skill-center',
        path: entry.location?.path ?? null,
        source: entry.association?.shadowedBy ? 'shadowed' : safeText(entry.origin?.kind) || 'registry',
      },
      shadowed: isObject(entry?.association?.shadowedBy),
    };
  });
  const sessionsValue = normalizeSessions(lookup(indexBy(sessions, ['projectId', 'cwd']), projectId, detailCwd));
  const collisionList = Array.isArray(collisions) ? collisions : Array.isArray(collisions?.collisions) ? collisions.collisions : [];
  const relevantCollisions = collisionList
    .filter((collision) => isObject(collision) && (list(collision.rows).some((row) => safeText(row?.projectId) === projectId) || safeText(collision.key).includes(projectId)))
    .map((collision) => ({ code: safeText(collision.code), severity: safeText(collision.severity), key: safeText(collision.key) }));
  return {
    ...summary,
    sources: normalizedSources,
    identity: {
      projectId,
      uuid: manifest.uuid ?? (safeText(record?.uuid) || null),
      manifestSha256: manifest.sha256 ?? (safeText(record?.manifestSha256) || null),
      state: identityState,
    },
    assignments,
    skills,
    sessions: sessionsValue,
    collisions: relevantCollisions,
    findings: classification.findings,
    generatedAt,
  };
}
