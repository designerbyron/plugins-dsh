/**
 * El almacén: un documento JSON versionado, escrito de forma atómica.
 *
 * Por qué un documento y no una carpeta por entidad: un cambio de este centro casi siempre toca dos o
 * tres cosas a la vez —publicar una versión y dejar su evaluación, asignarla y anotar el evento—, y con
 * un documento esas cosas se escriben juntas o no se escriben. No hay transacción entre ficheros, y
 * fingirla sería peor que no tenerla.
 *
 * La escritura es `tmp` + `rename`: en el mismo volumen el rename es atómico, así que un corte a mitad
 * deja el documento anterior entero, nunca medio documento.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { isSafeId, parseVersion, shortHash } from './format.mjs';

export const SCHEMA_VERSION = 1;
/** Tope del diario de eventos. Más allá de esto lo que sobra no se consulta y engorda cada escritura. */
export const MAX_EVENTS = 4000;

/** Raíz de datos por defecto: hermana de `skills/` y de `skill-compiler/`, sin pisar ninguna. */
export function defaultRoot(env = process.env) {
  const dshHome = env?.DSH_HOME || join(homedir(), '.dsh');
  return join(dshHome, 'lifecode-skill-center');
}

export function centerFile(root) {
  return join(root, 'center.json');
}

/** Las skills asignadas se materializan aquí para que el harness las lea con su propio lector. */
export function materializedRoot(root) {
  return join(root, 'materialized');
}

export function emptyState(now = new Date().toISOString()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    skills: {},
    projects: {},
    assignments: {},
    improvements: {},
    events: [],
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEvaluation(value) {
  if (!isObject(value)) return null;
  return {
    status: ['pass', 'warn', 'fail'].includes(value.status) ? value.status : 'warn',
    score: Number.isFinite(value.score) ? Number(value.score) : 0,
    findings: list(value.findings)
      .filter((finding) => isObject(finding) && typeof finding.code === 'string')
      .map((finding) => ({
        code: finding.code,
        severity: ['block', 'warn', 'info'].includes(finding.severity) ? finding.severity : 'warn',
        message: text(finding.message),
      })),
    evaluatedAt: text(value.evaluatedAt),
  };
}

function normalizeVersion(raw) {
  if (!isObject(raw) || typeof raw.version !== 'string') return null;
  // Una versión sin número legible o sin cuerpo no se puede cargar ni comparar; conservarla sólo
  // serviría para que el panel ofreciera algo que falla al materializarse.
  if (parseVersion(raw.version) === null) return null;
  const body = text(raw.body);
  if (body.trim() === '') return null;
  const references = {};
  if (isObject(raw.references)) {
    for (const [path, content] of Object.entries(raw.references)) {
      if (typeof content === 'string' && path.startsWith('references/') && !path.includes('..')) references[path] = content;
    }
  }
  return {
    version: raw.version,
    description: text(raw.description),
    whenToUse: text(raw.whenToUse),
    tags: list(raw.tags).filter((tag) => typeof tag === 'string'),
    body,
    references,
    createdAt: text(raw.createdAt),
    checksum: text(raw.checksum),
    notes: text(raw.notes),
    evaluation: normalizeEvaluation(raw.evaluation),
  };
}

export function normalizeSkill(raw) {
  const versions = list(raw.versions).map(normalizeVersion).filter((version) => version !== null);
  const origin = isObject(raw.origin)
    ? {
      kind: ['ai', 'human', 'import', 'fork'].includes(raw.origin.kind) ? raw.origin.kind : 'human',
      from: typeof raw.origin.from === 'string' ? raw.origin.from : null,
      fromVersion: typeof raw.origin.fromVersion === 'string' ? raw.origin.fromVersion : null,
      note: text(raw.origin.note),
    }
    : { kind: 'human', from: null, fromVersion: null, note: '' };
  return {
    id: text(raw.id),
    title: text(raw.title),
    description: text(raw.description),
    whenToUse: text(raw.whenToUse),
    tags: list(raw.tags).filter((tag) => typeof tag === 'string'),
    status: raw.status === 'deprecated' ? 'deprecated' : 'published',
    currentVersion: text(raw.currentVersion),
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
    origin,
    versions,
  };
}

function normalizeProject(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  return {
    id: raw.id,
    name: text(raw.name, raw.id),
    cwd: text(raw.cwd),
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
    note: text(raw.note),
  };
}

function normalizeAssignment(raw) {
  if (!isObject(raw)) return null;
  return {
    enabled: raw.enabled === true,
    version: text(raw.version),
    updatedAt: text(raw.updatedAt),
    by: raw.by === 'ai' ? 'ai' : 'human',
  };
}

/**
 * Normaliza lo leído del disco. **Nunca lanza**: un documento corrupto deja el centro vacío y un aviso,
 * porque una biblioteca ilegible no puede tumbar la carga de skills de todas las sesiones.
 */
export function normalizeState(raw) {
  const base = emptyState();
  if (!isObject(raw)) return base;
  const state = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: text(raw.createdAt, base.createdAt),
    updatedAt: text(raw.updatedAt, base.createdAt),
    skills: {},
    projects: {},
    assignments: {},
    improvements: {},
    events: [],
  };
  if (isObject(raw.skills)) {
    for (const [id, skill] of Object.entries(raw.skills)) {
      if (!isObject(skill)) continue;
      if (typeof skill.id !== 'string' || skill.id === '') skill.id = id;
      const normalized = normalizeSkill(skill);
      if (!isSafeId(id) || normalized.versions.length === 0) continue;
      state.skills[id] = normalized;
    }
  }
  if (isObject(raw.projects)) {
    for (const [id, project] of Object.entries(raw.projects)) {
      const normalized = normalizeProject(isObject(project) ? { ...project, id: project.id ?? id } : null);
      if (normalized !== null) state.projects[normalized.id] = normalized;
    }
  }
  if (isObject(raw.assignments)) {
    for (const [projectId, entries] of Object.entries(raw.assignments)) {
      if (!isObject(entries)) continue;
      const row = {};
      for (const [skillId, assignment] of Object.entries(entries)) {
        const normalized = normalizeAssignment(assignment);
        if (normalized !== null) row[skillId] = normalized;
      }
      if (Object.keys(row).length > 0) state.assignments[projectId] = row;
    }
  }
  if (isObject(raw.improvements)) {
    for (const [id, improvement] of Object.entries(raw.improvements)) {
      if (!isObject(improvement) || typeof improvement.skillId !== 'string') continue;
      const status = ['proposed', 'approved', 'rejected'].includes(improvement.status) ? improvement.status : 'proposed';
      state.improvements[id] = {
        id,
        skillId: improvement.skillId,
        baseVersion: text(improvement.baseVersion),
        description: text(improvement.description),
        whenToUse: text(improvement.whenToUse),
        tags: list(improvement.tags).filter((tag) => typeof tag === 'string'),
        body: text(improvement.body),
        references: isObject(improvement.references) ? improvement.references : {},
        rationale: text(improvement.rationale),
        status,
        createdAt: text(improvement.createdAt),
        decidedAt: text(improvement.decidedAt),
        decidedBy: text(improvement.decidedBy),
        evaluation: normalizeEvaluation(improvement.evaluation),
      };
    }
  }
  state.events = list(raw.events)
    .filter((event) => isObject(event) && typeof event.type === 'string')
    .slice(-MAX_EVENTS)
    .map((event) => ({
      id: text(event.id),
      at: text(event.at),
      type: event.type,
      skillId: text(event.skillId),
      projectId: text(event.projectId),
      version: text(event.version),
      actor: event.actor === 'ai' ? 'ai' : 'human',
      note: text(event.note),
    }));
  return state;
}

/**
 * Lee el documento. Devuelve siempre un estado utilizable; `ok` dice si lo leído era válido, y el
 * `error` explica lo que pasó cuando no lo era. Que el fichero no exista **no** es un error.
 */
export function loadState(root = defaultRoot()) {
  const file = centerFile(root);
  try {
    const text = readFileSync(file, 'utf8');
    const parsed = JSON.parse(text);
    return { ok: true, path: file, state: normalizeState(parsed), error: null, exists: true };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: true, path: file, state: emptyState(), error: null, exists: false };
    }
    return { ok: false, path: file, state: emptyState(), error: String(error?.message ?? error), exists: true };
  }
}

/** Escritura atómica: se escribe al lado y se renombra encima. */
export function saveState(root, state, { now = new Date().toISOString() } = {}) {
  const file = centerFile(root);
  mkdirSync(dirname(file), { recursive: true });
  state.schemaVersion = SCHEMA_VERSION;
  state.updatedAt = now;
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return file;
}

/**
 * Lee, deja mutar y guarda. Si la mutación lanza, **no se guarda nada**: media operación escrita es
 * peor que ninguna, y el error viaja a quien llamó.
 */
export function withState(root = defaultRoot(), mutate, { now } = {}) {
  const stamp = now ?? new Date().toISOString();
  const loaded = loadState(root);
  const result = mutate(loaded.state, { now: stamp, loaded });
  saveState(root, loaded.state, { now: stamp });
  return { ok: true, result, state: loaded.state, storeError: loaded.error };
}

/** Añade un evento al diario, recortando por delante lo que ya no cabe. */
export function appendEvent(state, event) {
  // `isObject` dice «objeto» y un array no lo es: usarlo aquí vaciaba el diario en cada evento y la
  // telemetría sólo recordaba el último. Se comprueba la forma real del campo, no la del tipo.
  if (!Array.isArray(state.events)) state.events = [];
  const at = text(event.at) || new Date().toISOString();
  const type = text(event.type, 'unknown');
  state.events.push({
    // Id y sello se completan aquí cuando quien llama no los trae: un evento sin identificador no se
    // puede referenciar y uno sin fecha no se puede ordenar, así que no tiene sentido aceptarlos.
    id: text(event.id) || `ev-${shortHash(`${at}:${type}:${state.events.length}`, 12)}`,
    at,
    type,
    skillId: text(event.skillId),
    projectId: text(event.projectId),
    version: text(event.version),
    actor: event.actor === 'ai' ? 'ai' : 'human',
    note: text(event.note),
  });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  return state.events.at(-1);
}

/**
 * Anota un evento **como mucho una vez por día y sujeto**.
 *
 * Una carga de skill no es una acción humana: el catálogo de una sesión se pide muchas veces por
 * minuto. Sin esta puerta, la telemetría de cargas se comería el documento y no mediría nada.
 */
export function recordDailyEvent(state, { type, skillId = '', projectId = '', version = '', actor = 'human', note = '', day }) {
  const target = day ?? new Date().toISOString().slice(0, 10);
  if (!Array.isArray(state.events)) state.events = [];
  const repeated = state.events.some((event) => event.type === type
    && event.skillId === skillId
    && event.projectId === projectId
    && String(event.at).slice(0, 10) === target);
  if (repeated) return null;
  return appendEvent(state, {
    type,
    skillId,
    projectId,
    version,
    actor,
    note,
    at: `${target}T00:00:00.000Z`,
    id: `${target}-${type}-${skillId}-${projectId}`.slice(0, 120),
  });
}
