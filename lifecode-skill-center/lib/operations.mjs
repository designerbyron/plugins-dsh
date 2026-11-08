/**
 * Las operaciones del centro. Todas son **puras sobre el estado**: reciben el documento, lo mutan y
 * devuelven un resultado con `ok`. No tocan el disco, no lanzan, y por eso se prueban enteras con
 * `node --test`.
 *
 * La autorización vive aquí, no en la interfaz: una mejora a una skill que ya existe la aprueba una
 * persona, y ninguna ruta de código permite que el actor `ai` publique una versión de algo que ya vive.
 * Que la herramienta del modelo ni siquiera exponga la aprobación es la segunda capa, no la única.
 */

import {
  bumpVersion,
  compareVersions,
  isSafeId,
  normalizeCwd,
  projectIdFor,
  projectNameFor,
  shortHash,
  slugId,
} from './format.mjs';
import { evaluateSkill } from './evaluate.mjs';
import { appendEvent } from './state.mjs';

/** Un id de evento: el instante basta y sobra para ordenar; el sufijo evita colisiones del mismo ms. */
function eventId(now, type) {
  return `ev-${shortHash(`${now}|${type}|${Math.random()}`)}`;
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function tagsOf(value) {
  return Array.isArray(value) ? value.map((tag) => oneLine(tag)).filter(Boolean) : [];
}

function referencesOf(value) {
  const out = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [path, content] of Object.entries(value)) {
    if (typeof content === 'string' && path.startsWith('references/') && !path.includes('..')) out[path] = content;
  }
  return out;
}

/** Registra un proyecto **visto**: su ruta, no su permiso. Asignar una skill es otro acto. */
export function ensureProject(state, cwd, { now = new Date().toISOString(), name } = {}) {
  const normalized = normalizeCwd(cwd);
  if (normalized === '') return null;
  const id = projectIdFor(normalized);
  if (id === null) return null;
  const existing = state.projects[id];
  if (existing !== undefined) {
    if (existing.cwd !== normalized) existing.cwd = normalized;
    return existing;
  }
  const project = {
    id,
    name: oneLine(name) || projectNameFor(normalized),
    cwd: normalized,
    createdAt: now,
    updatedAt: now,
    note: '',
  };
  state.projects[id] = project;
  return project;
}

/** El proyecto de una ruta, si ya está en el registro. */
export function findProject(state, cwd) {
  const normalized = normalizeCwd(cwd);
  if (normalized === '') return null;
  const id = projectIdFor(normalized);
  if (id !== null && state.projects[id] !== undefined) return state.projects[id];
  const key = normalized.toLowerCase();
  for (const project of Object.values(state.projects)) {
    if (normalizeCwd(project.cwd).toLowerCase() === key) return project;
  }
  return null;
}

export function currentVersionOf(skill) {
  if (skill === null || typeof skill !== 'object') return null;
  const versions = Array.isArray(skill.versions) ? skill.versions : [];
  return versions.find((version) => version.version === skill.currentVersion) ?? versions.at(-1) ?? null;
}

export function versionOf(skill, version) {
  const versions = Array.isArray(skill?.versions) ? skill.versions : [];
  if (typeof version === 'string' && version !== '') return versions.find((entry) => entry.version === version) ?? null;
  return currentVersionOf(skill);
}

/**
 * Crea una skill con su primera versión. Es el camino de la Fase 4: la IA redacta, la puerta de calidad
 * decide si sirve, y lo que queda **publicado en la biblioteca**, no activo en ningún proyecto.
 */
export function createSkill(state, input, { now = new Date().toISOString(), actor = 'human' } = {}) {
  const description = oneLine(input?.description);
  const title = oneLine(input?.title) || description;
  const requested = oneLine(input?.id);
  const id = requested !== '' ? requested : slugId(title || description);
  if (!isSafeId(id)) {
    return {
      ok: false,
      code: 'invalid-id',
      message: requested === ''
        ? 'la descripción no da un id utilizable: pasa un id en kebab-case'
        : `"${id}" no es un id válido: minúsculas, números y guiones simples, hasta 64 caracteres`,
    };
  }
  if (state.skills[id] !== undefined) {
    return {
      ok: false,
      code: 'exists',
      message: `ya existe una skill con el id "${id}": propón una mejora sobre ella en vez de crear un duplicado`,
      existingVersion: state.skills[id].currentVersion,
    };
  }

  const body = String(input?.body ?? '');
  const candidate = {
    id,
    description,
    whenToUse: oneLine(input?.whenToUse),
    tags: tagsOf(input?.tags),
    references: referencesOf(input?.references),
    body,
  };
  const evaluation = evaluateSkill(candidate, { evaluatedAt: now });
  if (evaluation.blocksPublish) {
    return { ok: false, code: 'evaluation-failed', evaluation, message: 'la skill no pasa la puerta de calidad', findings: evaluation.findings };
  }

  const version = {
    version: '1.0.0',
    description: candidate.description,
    whenToUse: candidate.whenToUse,
    tags: candidate.tags,
    body,
    references: candidate.references,
    createdAt: now,
    checksum: shortHash(body),
    notes: oneLine(input?.notes),
    evaluation,
  };
  const originKind = ['ai', 'human', 'import', 'fork'].includes(input?.origin?.kind) ? input.origin.kind : actor === 'ai' ? 'ai' : 'human';
  state.skills[id] = {
    id,
    title,
    description: candidate.description,
    whenToUse: candidate.whenToUse,
    tags: candidate.tags,
    status: 'published',
    currentVersion: '1.0.0',
    createdAt: now,
    updatedAt: now,
    origin: {
      kind: originKind,
      from: text(input?.origin?.from) || null,
      fromVersion: text(input?.origin?.fromVersion) || null,
      note: oneLine(input?.origin?.note),
    },
    versions: [version],
  };
  appendEvent(state, { id: eventId(now, 'skill.created'), at: now, type: 'skill.created', skillId: id, version: '1.0.0', actor });
  return { ok: true, id, skill: state.skills[id], version, evaluation };
}

/**
 * Publica una versión nueva de una skill viva.
 *
 * El actor `ai` no puede: una mejora del modelo es una **propuesta** (`proposeImprovement`) hasta que
 * una persona la aprueba. Es la diferencia entre preparar y publicar, y es una regla, no una costumbre.
 */
export function publishVersion(state, id, input, { now = new Date().toISOString(), actor = 'human' } = {}) {
  const skill = state.skills[id];
  if (skill === undefined) return { ok: false, code: 'missing', message: `no hay ninguna skill con el id "${id}"` };
  if (actor === 'ai') {
    return {
      ok: false,
      code: 'approval-required',
      message: 'una versión nueva de una skill que ya existe la publica una persona: usa una propuesta de mejora, que espera aprobación',
    };
  }
  const base = currentVersionOf(skill);
  if (base === null) return { ok: false, code: 'corrupt', message: 'la skill no tiene ninguna versión legible' };
  const candidate = {
    id,
    description: oneLine(input?.description ?? skill.description),
    whenToUse: oneLine(input?.whenToUse ?? skill.whenToUse),
    tags: input?.tags === undefined ? skill.tags : tagsOf(input.tags),
    references: input?.references === undefined ? base.references : referencesOf(input.references),
    body: input?.body === undefined ? base.body : String(input.body),
  };
  const evaluation = evaluateSkill(candidate, { evaluatedAt: now });
  if (evaluation.blocksPublish) {
    return { ok: false, code: 'evaluation-failed', evaluation, message: 'la versión no pasa la puerta de calidad', findings: evaluation.findings };
  }
  const version = {
    version: bumpVersion(skill.currentVersion),
    description: candidate.description,
    whenToUse: candidate.whenToUse,
    tags: candidate.tags,
    body: candidate.body,
    references: candidate.references,
    createdAt: now,
    checksum: shortHash(candidate.body),
    notes: oneLine(input?.notes),
    evaluation,
  };
  skill.versions.push(version);
  skill.currentVersion = version.version;
  skill.description = candidate.description;
  skill.whenToUse = candidate.whenToUse;
  skill.tags = candidate.tags;
  skill.updatedAt = now;
  appendEvent(state, { id: eventId(now, 'skill.version'), at: now, type: 'skill.version', skillId: id, version: version.version, actor, note: version.notes });
  return { ok: true, id, version, skill, evaluation };
}

/**
 * Prepara una mejora sobre la versión vigente. No toca la skill: crea una propuesta que espera
 * decisión. El diff que devuelve es lo que se lee antes de aprobar.
 */
export function proposeImprovement(state, id, input, { now = new Date().toISOString(), actor = 'ai' } = {}) {
  const skill = state.skills[id];
  if (skill === undefined) return { ok: false, code: 'missing', message: `no hay ninguna skill con el id "${id}"` };
  const base = currentVersionOf(skill);
  if (base === null) return { ok: false, code: 'corrupt', message: 'la skill no tiene ninguna versión legible' };
  const candidate = {
    id,
    description: oneLine(input?.description ?? skill.description),
    whenToUse: oneLine(input?.whenToUse ?? skill.whenToUse),
    tags: input?.tags === undefined ? skill.tags : tagsOf(input.tags),
    references: input?.references === undefined ? base.references : referencesOf(input.references),
    body: input?.body === undefined ? base.body : String(input.body),
  };
  const evaluation = evaluateSkill(candidate, { evaluatedAt: now });
  if (evaluation.blocksPublish) {
    return { ok: false, code: 'evaluation-failed', evaluation, message: 'la propuesta no pasa la puerta de calidad', findings: evaluation.findings };
  }
  const improvementId = `imp-${shortHash(`${id}|${base.version}|${now}|${candidate.body}`)}`;
  const improvement = {
    id: improvementId,
    skillId: id,
    baseVersion: base.version,
    description: candidate.description,
    whenToUse: candidate.whenToUse,
    tags: candidate.tags,
    body: candidate.body,
    references: candidate.references,
    rationale: oneLine(input?.rationale),
    status: 'proposed',
    createdAt: now,
    decidedAt: '',
    decidedBy: '',
    evaluation,
  };
  state.improvements[improvementId] = improvement;
  appendEvent(state, { id: eventId(now, 'improvement.proposed'), at: now, type: 'improvement.proposed', skillId: id, version: base.version, actor });
  return { ok: true, improvementId, improvement, evaluation, diff: diffBodies(base.body, candidate.body) };
}

/**
 * Aprueba o rechaza una propuesta. **Solo una persona**: es la puerta que el plan llama «no publicar
 * cambios de alcance amplio sin política de autorización».
 */
export function decideImprovement(state, improvementId, decision, { now = new Date().toISOString(), actor = 'human', note = '' } = {}) {
  if (actor !== 'human') {
    return { ok: false, code: 'approval-required', message: 'aprobar o rechazar una propuesta es un acto humano' };
  }
  const improvement = state.improvements[improvementId];
  if (improvement === undefined) return { ok: false, code: 'missing', message: `no hay ninguna propuesta con el id "${improvementId}"` };
  if (improvement.status !== 'proposed') {
    return { ok: false, code: 'settled', message: `esa propuesta ya está ${improvement.status === 'approved' ? 'aprobada' : 'rechazada'}` };
  }
  const skill = state.skills[improvement.skillId];
  if (skill === undefined) return { ok: false, code: 'missing-skill', message: 'la skill de esa propuesta ya no está' };

  if (decision === 'reject') {
    improvement.status = 'rejected';
    improvement.decidedAt = now;
    improvement.decidedBy = 'human';
    appendEvent(state, { id: eventId(now, 'improvement.rejected'), at: now, type: 'improvement.rejected', skillId: skill.id, version: improvement.baseVersion, actor: 'human', note: oneLine(note) });
    return { ok: true, status: 'rejected', improvementId };
  }

  if (decision !== 'approve') return { ok: false, code: 'invalid-decision', message: 'la decisión es approve o reject' };

  const base = versionOf(skill, improvement.baseVersion);
  if (base === null) return { ok: false, code: 'stale', message: 'la versión sobre la que se propuso la mejora ya no está en la skill' };
  if (skill.currentVersion !== improvement.baseVersion) {
    return {
      ok: false,
      code: 'stale',
      message: `la skill avanzó a ${skill.currentVersion} desde que se propuso: la propuesta se hizo contra ${improvement.baseVersion}`,
    };
  }
  const version = {
    version: bumpVersion(skill.currentVersion),
    description: improvement.description,
    whenToUse: improvement.whenToUse,
    tags: improvement.tags,
    body: improvement.body,
    references: improvement.references,
    createdAt: now,
    checksum: shortHash(improvement.body),
    notes: improvement.rationale === '' ? `mejora ${improvementId}` : improvement.rationale,
    evaluation: improvement.evaluation,
  };
  skill.versions.push(version);
  skill.currentVersion = version.version;
  skill.description = improvement.description;
  skill.whenToUse = improvement.whenToUse;
  skill.tags = improvement.tags;
  skill.updatedAt = now;
  improvement.status = 'approved';
  improvement.decidedAt = now;
  improvement.decidedBy = 'human';
  improvement.version = version.version;
  appendEvent(state, { id: eventId(now, 'improvement.approved'), at: now, type: 'improvement.approved', skillId: skill.id, version: version.version, actor: 'human' });
  return { ok: true, status: 'approved', improvementId, version, skill };
}

/**
 * Enciende o apaga una skill en **un** proyecto.
 *
 * Apagar no borra: la asignación queda con `enabled: false` y su versión, así que volver a encenderla
 * devuelve exactamente lo que había. Y no toca los demás proyectos: cada fila es de su proyecto.
 */
export function toggleAssignment(state, input, { now = new Date().toISOString(), actor = 'human' } = {}) {
  const projectId = text(input?.projectId);
  const skillId = text(input?.skillId);
  const project = state.projects[projectId];
  if (project === undefined) return { ok: false, code: 'unknown-project', message: `el proyecto "${projectId}" no está en el registro` };
  const skill = state.skills[skillId];
  if (skill === undefined) return { ok: false, code: 'missing-skill', message: `no hay ninguna skill con el id "${skillId}"` };
  const wanted = input?.version === undefined || input.version === '' ? null : text(input.version);
  const target = wanted === null ? currentVersionOf(skill) : versionOf(skill, wanted);
  if (target === null) return { ok: false, code: 'unknown-version', message: `la versión "${wanted}" no existe en esa skill` };

  const row = state.assignments[projectId] ?? {};
  const previous = row[skillId];
  const enabled = input?.enabled === true;
  // Si nadie dice versión: al encender por primera vez, la vigente; al volver a encender, la que estaba
  // puesta. Que una versión publicada mientras el proyecto estaba apagado entre sola sería un cambio
  // silencioso de lo que ese proyecto ejecuta, y para eso está el selector de versión.
  const pinned = wanted !== null
    ? target.version
    : previous === undefined
      ? target.version
      : previous.version;
  row[skillId] = {
    enabled,
    version: pinned,
    updatedAt: now,
    by: actor === 'ai' ? 'ai' : 'human',
  };
  state.assignments[projectId] = row;
  appendEvent(state, {
    id: eventId(now, enabled ? 'skill.assigned' : 'skill.unassigned'),
    at: now,
    type: enabled ? 'skill.assigned' : 'skill.unassigned',
    skillId,
    projectId,
    version: row[skillId].version,
    actor: actor === 'ai' ? 'ai' : 'human',
  });
  return { ok: true, assignment: row[skillId], projectId, skillId };
}

/** Devuelve una asignación a una versión anterior. La versión que se deja atrás no se borra. */
export function rollbackAssignment(state, input, { now = new Date().toISOString(), actor = 'human' } = {}) {
  const projectId = text(input?.projectId);
  const skillId = text(input?.skillId);
  const skill = state.skills[skillId];
  if (skill === undefined) return { ok: false, code: 'missing-skill', message: `no hay ninguna skill con el id "${skillId}"` };
  const target = versionOf(skill, text(input?.version));
  if (target === null) return { ok: false, code: 'unknown-version', message: 'esa versión no existe en la skill' };
  const row = state.assignments[projectId];
  if (row === undefined || row[skillId] === undefined) {
    return { ok: false, code: 'not-assigned', message: 'esa skill no está asignada a ese proyecto' };
  }
  row[skillId] = { ...row[skillId], version: target.version, updatedAt: now, by: actor === 'ai' ? 'ai' : 'human' };
  appendEvent(state, { id: eventId(now, 'skill.rollback'), at: now, type: 'skill.rollback', skillId, projectId, version: target.version, actor: actor === 'ai' ? 'ai' : 'human' });
  return { ok: true, assignment: row[skillId] };
}

/**
 * Copia una skill a un id nuevo. Una copia **no puede** modificar el original: son dos entradas
 * distintas del documento, y la copia guarda de dónde salió para que se pueda auditar.
 */
export function forkSkill(state, input, { now = new Date().toISOString(), actor = 'human' } = {}) {
  const source = state.skills[text(input?.sourceId)];
  if (source === undefined) return { ok: false, code: 'missing', message: 'no existe la skill de origen' };
  const base = versionOf(source, text(input?.baseVersion));
  if (base === null) return { ok: false, code: 'corrupt', message: 'la skill de origen no tiene una versión legible' };
  const id = oneLine(input?.id) || `${source.id}-copia`;
  if (!isSafeId(id)) return { ok: false, code: 'invalid-id', message: `"${id}" no es un id válido` };
  if (state.skills[id] !== undefined) return { ok: false, code: 'exists', message: `ya existe una skill con el id "${id}"` };
  return createSkill(state, {
    id,
    title: oneLine(input?.title) || source.title,
    description: oneLine(input?.description) || source.description,
    whenToUse: source.whenToUse,
    tags: source.tags,
    body: base.body,
    references: base.references,
    notes: `copia de ${source.id} v${base.version}`,
    origin: { kind: 'fork', from: source.id, fromVersion: base.version, note: oneLine(input?.note) },
  }, { now, actor });
}

/** Las skills que un proyecto carga de verdad: encendidas, con una versión que existe. */
export function assignedSkills(state, projectId) {
  const row = state.assignments[projectId];
  if (row === undefined) return [];
  const out = [];
  for (const skillId of Object.keys(row)) {
    const assignment = row[skillId];
    if (assignment?.enabled !== true) continue;
    const skill = state.skills[skillId];
    if (skill === undefined) continue;
    const version = versionOf(skill, assignment.version);
    if (version === null) continue;
    out.push({ skill, version, assignment });
  }
  return out.sort((left, right) => (left.skill.id < right.skill.id ? -1 : 1));
}

/** Re-evalúa una versión guardada: la puerta se puede volver a pasar cuando cambian los criterios. */
export function evaluateStored(state, id, version, { now = new Date().toISOString() } = {}) {
  const skill = state.skills[id];
  if (skill === undefined) return { ok: false, code: 'missing', message: 'esa skill no existe' };
  const target = versionOf(skill, version);
  if (target === null) return { ok: false, code: 'unknown-version', message: 'esa versión no existe' };
  const evaluation = evaluateSkill({
    id,
    description: target.description,
    whenToUse: target.whenToUse,
    tags: target.tags,
    body: target.body,
    references: target.references,
  }, { evaluatedAt: now });
  target.evaluation = evaluation;
  return { ok: true, evaluation, version: target.version };
}

/**
 * El diff que se lee antes de aprobar: líneas que entran y salen, con vista previa.
 *
 * Un LCS de verdad, acotado: por encima de 400 líneas por lado se compara por bloques, porque un diff
 * de un millón de celdas en el proceso del host no es un adorno, es una caída.
 */
export function diffBodies(before, after) {
  const left = String(before ?? '').split('\n');
  const right = String(after ?? '').split('\n');
  if (left.length > 400 || right.length > 400) {
    return {
      added: Math.max(0, right.length - left.length),
      removed: Math.max(0, left.length - right.length),
      preview: [],
      truncated: true,
    };
  }
  const table = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const preview = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (table[i + 1][j] >= table[i][j + 1]) {
      removed += 1;
      if (preview.length < 40) preview.push({ kind: 'removed', text: left[i] });
      i += 1;
    } else {
      added += 1;
      if (preview.length < 40) preview.push({ kind: 'added', text: right[j] });
      j += 1;
    }
  }
  for (; i < left.length; i += 1) {
    removed += 1;
    if (preview.length < 40) preview.push({ kind: 'removed', text: left[i] });
  }
  for (; j < right.length; j += 1) {
    added += 1;
    if (preview.length < 40) preview.push({ kind: 'added', text: right[j] });
  }
  return { added, removed, preview, truncated: false };
}

/** Elige, entre las versiones de una skill, la anterior a una dada. Sirve al botón de volver atrás. */
export function previousVersion(skill, version) {
  const versions = (Array.isArray(skill?.versions) ? skill.versions : [])
    .map((entry) => entry.version)
    .filter((entry) => compareVersions(entry, version) < 0)
    .sort(compareVersions);
  return versions.length === 0 ? null : versions.at(-1);
}
