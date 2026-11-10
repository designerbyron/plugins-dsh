/**
 * Actividad del centro: una sola derivación pura para la ruta, el panel y las pruebas.
 *
 * Este módulo NO escribe ni lee ficheros: recibe el documento del centro (`state`) y, cuando se le pasa,
 * el registro de conocimiento (`knowledge`) ya cargados, y devuelve el DTO `ActivityEvent` del contrato
 * R17 (§1) más su proyección de notificación (§5). Reglas que no se rompen aquí:
 *
 * 1. **Se guarda poco, se deriva mucho** (§3): sólo `channel` y `operationId` son durables; el resto de
 *    campos del DTO se calculan al leer. Sin índice, sin caché, sin segundo sondeo.
 * 2. **Sin afirmaciones no demostradas** (§2.1): un evento sin canal demostrable publica
 *    `actor:'unknown'`, nunca `human` por defecto. `actorEvidence.stored` conserva el token original.
 * 3. **Dos fuentes, una salida** (§D2): `center.json` es la principal; los eventos de
 *    `knowledge.json` se marcan `source:'knowledge.json'` y reciben un id sintético determinista.
 * 4. **Nada de cuerpos ni rutas**: `titleVars` sólo lleva nombres, versiones, contadores y banderas
 *    (§12); el `detail` libre de un evento de conocimiento no se publica.
 */

import { shortHash } from './format.mjs';
import { compareReferences, eventResult } from './insights.mjs';

export const ACTIVITY_CATEGORIES = ['create', 'update', 'improvement', 'references', 'alert'];
export const ACTIVITY_CATEGORY_FILTERS = ['all', ...ACTIVITY_CATEGORIES];
export const ACTIVITY_SEVERITIES = ['success', 'info', 'warning', 'error'];
export const ACTIVITY_ACTORS = ['human', 'agent', 'system', 'external', 'unknown'];
export const ACTIVITY_ORIGINS = ['panel', 'tool', 'catalog', 'import', 'reconcile', 'maintenance', 'unknown'];
export const ACTIVITY_OUTCOMES = ['ok', 'failed', 'info'];
export const ACTIVITY_CONFIDENCES = ['verified', 'derived', 'unknown'];
export const ACTIVITY_SOURCES = ['center.json', 'knowledge.json'];
export const ACTIVITY_MAX_LIMIT = 50;
export const ACTIVITY_DEFAULT_LIMIT = 20;
/** Telemetría de entrega del catálogo: vive en Analítica, no en el Activity Center (§7). */
export const ACTIVITY_EXCLUDED_TYPES = new Set(['skill.loaded']);

const T = (name) => `activity.title.${name}`;

/** Mapa vinculante type → [category, severity, titleKey] (§5). La fila más específica gana. */
export const EVENT_MAP = Object.freeze({
  'skill.created': ['create', 'success', T('skill-created')],
  'skill-imported': ['create', 'success', T('skill-imported')],
  'skill.version': ['update', 'success', T('skill-updated')],
  'skill.assigned': ['update', 'info', T('skill-assigned')],
  'skill.unassigned': ['update', 'info', T('skill-unassigned')],
  'skill.advanced': ['update', 'info', T('skill-advanced')],
  'improvement.proposed': ['improvement', 'warning', T('improvement-prepared')],
  'improvement.approved': ['improvement', 'success', T('self-improvement-completed')],
  'improvement.rejected': ['alert', 'warning', T('improvement-rejected')],
  'skill.applied': ['improvement', 'success', T('self-improvement-completed')],
  'skill.rollback': ['alert', 'warning', T('change-reverted')],
  'skill.requested': ['improvement', 'info', T('skill-requested')],
  'skill.request-fulfilled': ['improvement', 'info', T('skill-request-fulfilled')],
  'skill.request-dismissed': ['improvement', 'info', T('skill-request-dismissed')],
  'project.registered': ['create', 'success', T('project-linked')],
  'project.linked': ['create', 'success', T('project-linked')],
  'project.adopted': ['create', 'success', T('project-linked')],
  'project.forked': ['create', 'success', T('project-linked')],
  'project.moved': ['update', 'info', T('change-detected')],
  'project.reconciled': ['update', 'info', T('change-detected')],
  'project.relinked': ['update', 'info', T('change-detected')],
  'project.renamed': ['update', 'info', T('change-detected')],
  'project.materialized': ['update', 'info', T('change-detected')],
  'project.detached': ['alert', 'warning', T('project-detached')],
  'store.backup': ['update', 'info', T('inspection-finished')],
  'store.restored': ['update', 'info', T('inspection-finished')],
  'store.migrated': ['update', 'info', T('inspection-finished')],
  'insight-received': ['improvement', 'info', T('insight-received')],
  'insight-origin-verified': ['improvement', 'info', T('insight-origin-verified')],
  'decision-recorded': ['improvement', 'info', T('decision-recorded')],
  'policy-changed': ['improvement', 'info', T('policy-changed')],
});

/** Tipos `insight-*` (triaje) comparten fila: el mapa explícito no puede enumerar estados futuros. */
function mapOf(type) {
  const mapped = EVENT_MAP[type];
  if (Array.isArray(mapped)) return mapped;
  if (/^insight-/.test(type)) return ['improvement', 'info', T('insight-received')];
  return ['update', 'info', T('change-detected')];
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nullIfEmpty(value) {
  const valueText = text(value).trim();
  return valueText === '' ? null : valueText;
}

function actorOf(stored) {
  const token = text(stored).trim().toLowerCase();
  if (token === 'human' || token === 'person' || token === 'persona') return 'human';
  if (token === 'ai' || token === 'agent' || token === 'model' || token === 'agente') return 'agent';
  if (token === 'system' || token === 'telemetry' || token === 'sistema') return 'system';
  if (token === 'external' || token === 'externo' || token === 'reconciliation') return 'external';
  return 'unknown';
}

function originOf(type, actor) {
  if (type === 'skill.loaded') return 'catalog';
  if (type === 'skill-imported') return 'import';
  if (type === 'project.reconciled' || type === 'project.relinked' || type === 'project.moved') return 'reconcile';
  if (/^store\./.test(type)) return 'maintenance';
  if (actor === 'human') return 'panel';
  if (actor === 'agent') return 'tool';
  if (actor === 'system') return 'catalog';
  return 'unknown';
}

function versionOf(value) {
  const versionText = text(value).trim();
  return /^\d+\.\d+\.\d+$/.test(versionText) ? versionText : null;
}

function skillOf(state, skillId) {
  if (!isObject(state?.skills)) return null;
  const skill = state.skills[skillId];
  return isObject(skill) ? skill : null;
}

function projectNameOf(state, projectId) {
  if (projectId === null || !isObject(state?.projects)) return null;
  const project = state.projects[projectId];
  if (!isObject(project)) return null;
  return text(project.title || project.name) || null;
}

/** Versión inmediatamente anterior a `versionAfter` dentro del historial de la skill (§2.3). */
function previousVersionOf(skill, versionAfter) {
  if (!isObject(skill) || !Array.isArray(skill.versions) || versionAfter === null) return null;
  const index = skill.versions.findIndex((version) => versionOf(version?.version) === versionAfter);
  if (index <= 0) return null;
  const previous = skill.versions[index - 1];
  if (!isObject(previous)) return null;
  return previous;
}

function referencesOfVersion(version) {
  if (!isObject(version) || !isObject(version.references)) return new Map();
  return new Map(Object.keys(version.references).sort().map((key) => [key, version.references[key]]));
}

function referenceArrays(event, skill, versionAfter) {
  const current = skill?.versions?.find((version) => versionOf(version?.version) === versionAfter);
  if (!isObject(current)) {
    // Sin historial no se inventan deltas: `null` es «no se sabe», distinto de `[]` (§1).
    return { added: null, updated: null, removed: null };
  }
  if (event.type === 'skill.created' || event.type === 'skill-imported') {
    return { added: [...referencesOfVersion(current).keys()], updated: [], removed: [] };
  }
  const previous = previousVersionOf(skill, versionAfter);
  if (previous === null) return { added: null, updated: null, removed: null };
  const delta = compareReferences(previous, current);
  return { added: delta.added, updated: delta.modified, removed: delta.removed };
}

function confidenceOf(event, eventId, at, type) {
  if (eventId === null || at === '' || type === '') return 'unknown';
  const stored = text(event?.actor).trim();
  if (stored === '' || actorOf(stored) === 'unknown') return 'derived';
  return 'derived';
}

/**
 * Un nombre publicable: sin saltos de línea, corto y sin patrones de secreto (§12). El `title` de una
 * skill puede haberse sembrado con la descripción en almacenes antiguos; ese texto no se publica.
 */
function nameLike(value) {
  const candidate = text(value).trim();
  if (candidate === '' || candidate.length > 80 || /[\r\n]/.test(candidate)) return null;
  // Un título legítimo es un nombre corto («R17 Activity»); una frase sembrada con la descripción no lo es.
  if (candidate.split(/\s+/).length > 10) return null;
  if (/-----BEGIN|\bapi[_-]?key\b|\bpassword\b/i.test(candidate)) return null;
  return candidate;
}

/** Cursor opaco base64url de `at|eventId` (D4, §6). */
export function encodeActivityCursor(entry) {
  return Buffer.from(`${entry.at}|${entry.eventId}`, 'utf8').toString('base64url');
}

/** `null` si el cursor no es base64url de un `at|eventId` con fecha válida. */
export function decodeActivityCursor(value) {
  const raw = text(value).trim();
  if (raw === '') return null;
  let decoded;
  try {
    decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const separator = decoded.indexOf('|');
  if (separator <= 0) return null;
  const at = decoded.slice(0, separator);
  const eventId = decoded.slice(separator + 1);
  if (eventId === '' || Number.isNaN(Date.parse(at))) return null;
  return { at, eventId };
}

function compareEntries(left, right) {
  if (left.at !== right.at) return left.at < right.at ? 1 : -1;
  if (left.eventId === right.eventId) return 0;
  return left.eventId < right.eventId ? 1 : -1;
}

function beforeCursor(entry, cursor) {
  if (cursor === null) return true;
  if (entry.at !== cursor.at) return entry.at < cursor.at;
  return entry.eventId < cursor.eventId;
}

function titleVarsOf(event, { skillTitle, skillId, projectName, versionAfter, versionBefore, references }) {
  const vars = {};
  const skillName = skillTitle ?? skillId;
  if (skillName !== null) vars.skill = skillName;
  if (projectName !== null) vars.project = projectName;
  const version = versionAfter ?? versionBefore;
  if (version !== null) vars.version = version;
  if (event.type === 'skill-imported') vars.origin = 'import';
  if (typeof event.renamed === 'boolean') vars.renamed = event.renamed;
  if (event.type === 'skill.assigned') vars.change = 'assigned';
  if (event.type === 'skill.unassigned') vars.change = 'unassigned';
  if (event.type === 'skill.advanced') vars.change = 'advanced';
  if (references !== null && references.added !== null && references.added.length > 0) {
    vars.references = references.added.length;
  }
  return vars;
}

function dtoOf(event, state, { eventId, source }) {
  const type = text(event?.type);
  const at = text(event?.at);
  const actor = actorOf(event?.actor);
  const skillId = nullIfEmpty(event?.skillId);
  const projectId = nullIfEmpty(event?.projectId);
  const skill = skillOf(state, skillId);
  const versionAfter = versionOf(event?.version);
  const previous = previousVersionOf(skill, versionAfter);
  const references = referenceArrays(event, skill, versionAfter);
  const skillTitle = nameLike(skill?.title);
  const projectName = projectNameOf(state, projectId);
  const correlation = nullIfEmpty(event?.correlationId) ?? nullIfEmpty(event?.operationId);
  const derivedCorrelation = correlation ?? `corr-${shortHash(`${type}|${skillId ?? ''}|${projectId ?? ''}|${at}`, 12)}`;
  const [category, severity, titleKey] = mapOf(type);
  const stored = text(event?.actor).trim();
  const channel = text(event?.channel).trim();
  return {
    eventId,
    type,
    at,
    actor,
    actorEvidence: { channel: channel === '' ? 'unknown' : channel, stored: stored === '' ? null : stored },
    origin: originOf(type, actor),
    source,
    projectId,
    skillId,
    skillTitle,
    versionBefore: versionOf(previous?.version),
    versionAfter,
    referencesAdded: references.added,
    referencesUpdated: references.updated,
    referencesRemoved: references.removed,
    correlationId: derivedCorrelation,
    requestId: nullIfEmpty(event?.requestId),
    outcome: eventResult(event),
    persisted: true,
    humanApprovalRequired: type === 'improvement.proposed' || event?.code === 'approval-required',
    confidence: confidenceOf(event, eventId, at, type),
    category,
    severity,
    titleKey,
    titleVars: titleVarsOf(event, { skillTitle, skillId, projectName, versionAfter, versionBefore: versionOf(previous?.version), references }),
  };
}

/**
 * Normaliza un evento del centro al DTO del contrato. Exportado para que una respuesta de mutación y el
 * feed no puedan discrepar (§D1).
 */
export function normalizeEvent(event, { state = null, source = 'center.json', eventId = null } = {}) {
  if (!isObject(event) || text(event.type) === '') return null;
  if (ACTIVITY_EXCLUDED_TYPES.has(text(event.type))) return null;
  const id = eventId ?? (nullIfEmpty(event.id) ?? `ev-${shortHash(`${text(event.at)}|${text(event.type)}|${text(event.skillId)}|${text(event.projectId)}`, 12)}`);
  return dtoOf(event, state, { eventId: id, source });
}

/** Id sintético estable de un evento de knowledge.json (R4): `kn-<12hex>`, sin escribir el fichero. */
export function knowledgeEventId(event) {
  return `kn-${shortHash(`${text(event?.at)}|${text(event?.type)}|${text(event?.detail)}|${text(event?.skillId)}|${text(event?.projectId)}`, 12)}`;
}

/**
 * Feed paginado sobre las dos fuentes.
 *
 * @param {object} state documento del centro
 * @param {object|null} knowledge documento de conocimiento (null si no se pudo leer)
 * @param {{ limit?: number, before?: string|null, category?: string|null }} [options]
 * @returns {{ events: object[], nextBefore: string|null, total: number, truncated: boolean }}
 */
export function buildActivityFeed(state, knowledge, { limit = ACTIVITY_DEFAULT_LIMIT, before = null, category = null } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, ACTIVITY_MAX_LIMIT) : ACTIVITY_DEFAULT_LIMIT;
  const wanted = category === null || category === 'all' || category === '' ? null : category;
  const cursor = typeof before === 'string' ? decodeActivityCursor(before) : null;
  const events = [];

  const centerEvents = Array.isArray(state?.events) ? state.events : [];
  const seen = new Set();
  for (const event of centerEvents) {
    const entry = normalizeEvent(event, { state, source: 'center.json' });
    if (entry === null) continue;
    if (wanted !== null && entry.category !== wanted) continue;
    events.push(entry);
  }

  const knowledgeEvents = Array.isArray(knowledge?.events) ? knowledge.events : [];
  const collisions = new Map();
  for (const event of knowledgeEvents) {
    const base = knowledgeEventId(event);
    const seenCount = collisions.get(base) ?? 0;
    collisions.set(base, seenCount + 1);
    const eventId = seenCount === 0 ? base : `${base}-${seenCount + 1}`;
    if (seen.has(eventId)) continue;
    seen.add(eventId);
    const entry = dtoOf(event, state, { eventId, source: 'knowledge.json' });
    if (ACTIVITY_EXCLUDED_TYPES.has(entry.type)) continue;
    if (wanted !== null && entry.category !== wanted) continue;
    events.push(entry);
  }

  // R9: `total` cuenta toda la categoría, no la página ni lo que queda tras el cursor.
  const total = events.length;
  const visible = cursor === null ? events : events.filter((entry) => beforeCursor(entry, cursor));
  visible.sort(compareEntries);
  const page = visible.slice(0, safeLimit);
  const last = page[page.length - 1];
  const nextBefore = visible.length > page.length && last !== undefined ? encodeActivityCursor(last) : null;
  return { events: page, nextBefore, total, truncated: visible.length > page.length };
}

/** Proyección mínima que viaja en la respuesta de una mutación (§7). */
export function activityForResult(state, eventId) {
  const wanted = text(eventId);
  if (wanted === '') return null;
  const events = Array.isArray(state?.events) ? state.events : [];
  const event = events.find((item) => text(item?.id) === wanted);
  if (event === undefined) return null;
  const entry = normalizeEvent(event, { state, source: 'center.json', eventId: wanted });
  if (entry === null) return null;
  return {
    eventId: entry.eventId,
    type: entry.type,
    category: entry.category,
    severity: entry.severity,
    titleKey: entry.titleKey,
    titleVars: entry.titleVars,
    actor: entry.actor,
    at: entry.at,
    persisted: true,
  };
}
