/**
 * Almacén propio del conocimiento colectivo y del registro de decisiones.
 *
 * Vive en su propio fichero (`knowledge.json`) y no toca el documento v2 del centro: el addendum exige
 * no introducir escrituras implícitas de esquema nuevo en el almacén productivo. Aquí conviven tres cosas
 * con dueño distinto:
 *
 * - `insights`: lo que descubre un subagente y entrega al agente principal. Es dato no confiable: se
 *   guarda, se clasifica y se decide, pero nunca se ejecuta lo que diga dentro.
 * - `decisions`: el registro de decisiones autónomas con su evidencia, su justificación y su rollback.
 * - `policy`: el modo de autonomía por proyecto (`human-approved` o `guarded-autonomous`).
 *
 * El contrato de escritura es el de la casa: leer no escribe; escribir exige un documento íntegro, un
 * candado y un `rename` atómico; la recepción repetida del mismo hallazgo es idempotente.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const KNOWLEDGE_SCHEMA = 1;
export const KNOWLEDGE_SCHEMA_ID = 'lifecode-skill-center/knowledge';

export const INSIGHT_STATES = [
  'received',
  'triaged',
  'validated',
  'decided',
  'acted-on',
  'merged',
  'documented',
  'contradicted',
  'deferred',
  'rejected',
];

export const DECISION_OUTCOMES = [
  'create-new-skill',
  'reuse-existing-skill',
  'improve-existing-skill',
  'approve',
  'publish',
  'assign',
  'activate',
  'deactivate',
  'advance-pin',
  'rollback',
  'defer',
  'reject',
];

export const EVIDENCE_LEVELS = ['strong', 'moderate', 'weak'];
export const POLICY_MODES = ['human-approved', 'guarded-autonomous'];
export const DEFAULT_POLICY_MODE = 'human-approved';

export const INTEGRITY_OK = 'ok';
export const INTEGRITY_MISSING = 'missing';
export const INTEGRITY_UNREADABLE = 'unreadable';
export const INTEGRITY_INVALID_SHAPE = 'invalid-shape';
export const INTEGRITY_FUTURE_VERSION = 'future-version';

const LOCK_WAIT_MS = 4000;
const LOCK_RETRY_MS = 12;
const LOCK_STALE_MS = 20000;
const RENAME_RETRY_MS = 15;
const MAX_INSIGHTS = 500;
const MAX_DECISIONS = 2000;
export function knowledgeFile(root) {
  return join(root, 'knowledge.json');
}

function lockPath(root) {
  return `${knowledgeFile(root)}.lock`;
}

function nowIso(now) {
  return typeof now === 'string' && now !== '' ? now : new Date().toISOString();
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

/**
 * Marca de tiempo en ISO-8601. Acepta Date o cadena: `text()` sólo acepta cadenas, y pasar un
 * Date a un campo de fecha lo dejaba vacío al normalizar (defecto real de la ronda 14).
 */
function toIso(value, fallback = new Date().toISOString()) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value.toISOString();
  const stamp = text(value);
  return stamp === '' ? fallback : stamp;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [...new Set(list(values).map((value) => text(value)).filter(Boolean))];
}

function sha256OfBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sleep(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // espera activa corta: el candado se toma en milisegundos o se abandona
  }
}

/** Documento vacío. `policy.mode` es el modo por defecto de los proyectos sin entrada propia. */
export function emptyKnowledge(now = new Date().toISOString()) {
  return {
    schema: KNOWLEDGE_SCHEMA_ID,
    schemaVersion: KNOWLEDGE_SCHEMA,
    createdAt: now,
    updatedAt: now,
    // Sin modo: nadie ha concedido autonomía todavía. `policyFor` lo informa como 'default'
    // y la compuerta §6 lo trata como human-approved hasta que una persona lo conceda.
    policy: { mode: '', projects: {} },
    insights: [],
    decisions: [],
    events: [],
  };
}

function normalizeEvidence(raw) {
  return list(raw)
    .map((item) => (isPlainObject(item) ? {
      source: text(item.source),
      location: text(item.location),
      verification: text(item.verification),
      result: text(item.result),
    } : null))
    .filter((item) => item !== null && (item.source !== '' || item.result !== ''));
}

/**
 * El origen de un hallazgo nunca se da por verificado por lo que diga el JSON.
 * `declared` conserva lo que el subagente afirmó; `verified` sólo lo pone el Host cuando puede
 * comprobarlo contra su propio catálogo de hijos (`subagents.listChildren`).
 */
function normalizeOrigin(raw, fallback = {}) {
  const declared = isPlainObject(raw?.declared)
    ? {
      sourceAgent: text(raw.declared.sourceAgent),
      parentRunId: text(raw.declared.parentRunId),
      sessionId: text(raw.declared.sessionId),
    }
    : {
      sourceAgent: text(fallback.sourceAgent),
      parentRunId: text(fallback.parentRunId),
      sessionId: text(fallback.sessionId),
    };
  const verified = raw?.verified === true;
  return {
    declared,
    verified,
    verifiedBy: verified ? text(raw.verifiedBy) : '',
    verifiedAt: verified ? text(raw.verifiedAt) : '',
    note: verified ? '' : 'declarado por el emisor: el Host no lo ha verificado',
  };
}

function normalizeActedOn(raw) {
  if (!isPlainObject(raw) || raw.ok !== true) return null;
  return {
    ok: true,
    at: text(raw.at),
    decisionId: text(raw.decisionId),
    skillId: text(raw.skillId),
    version: text(raw.version),
    projectId: text(raw.projectId),
    operation: text(raw.operation),
    detail: text(raw.detail),
  };
}

function normalizeInsight(raw, now) {
  if (!isPlainObject(raw)) return null;
  const insightId = text(raw.insightId);
  const title = text(raw.title) || text(raw.summary);
  if (insightId === '' || title === '') return null;
  const state = INSIGHT_STATES.includes(text(raw.state)) ? text(raw.state) : 'received';
  const confidence = EVIDENCE_LEVELS.includes(text(raw.confidence)) ? text(raw.confidence) : 'weak';
  return {
    insightId,
    sourceAgent: text(raw.sourceAgent),
    parentRunId: text(raw.parentRunId),
    taskId: text(raw.taskId),
    projectId: text(raw.projectId),
    scope: text(raw.scope) || (text(raw.projectId) === '' ? 'global' : 'project'),
    category: text(raw.category) || 'observation',
    title,
    summary: text(raw.summary),
    details: text(raw.details),
    evidence: normalizeEvidence(raw.evidence),
    confidence,
    risks: uniqueStrings(raw.risks),
    suggestedAction: text(raw.suggestedAction),
    state,
    receivedAt: text(raw.receivedAt) || now,
    updatedAt: text(raw.updatedAt) || now,
    notes: text(raw.notes),
    decisionId: text(raw.decisionId),
    appliedSkillId: text(raw.appliedSkillId),
    origin: normalizeOrigin(raw.origin, raw),
    actedOn: normalizeActedOn(raw.actedOn),
  };
}

function normalizeDecision(raw, now) {
  if (!isPlainObject(raw)) return null;
  const decisionId = text(raw.decisionId);
  const outcome = text(raw.outcome);
  if (decisionId === '' || !DECISION_OUTCOMES.includes(outcome)) return null;
  return {
    decisionId,
    outcome,
    skillId: text(raw.skillId),
    version: text(raw.version),
    projectId: text(raw.projectId),
    scope: text(raw.scope) || (text(raw.projectId) === '' ? 'global' : 'project'),
    evidenceLevel: EVIDENCE_LEVELS.includes(text(raw.evidenceLevel)) ? text(raw.evidenceLevel) : 'weak',
    insightIds: uniqueStrings(raw.insightIds),
    gates: list(raw.gates).map((gate) => (isPlainObject(gate) ? {
      id: text(gate.id), ok: gate.ok === true, detail: text(gate.detail),
    } : null)).filter((gate) => gate !== null && gate.id !== ''),
    justification: text(raw.justification),
    risks: uniqueStrings(raw.risks),
    actor: text(raw.actor) || 'ai',
    at: text(raw.at) || now,
    rollback: isPlainObject(raw.rollback) ? cloneJson(raw.rollback) : { available: false },
    // El resultado real de la acción autorizada. Sin esto, el asiento se escribiría y al leerlo se perdería
    // (RT-D3): el ledger diría «autorizada» para siempre y nunca «ejecutada» o «fallida».
    settled: isPlainObject(raw.settled)
      ? { ok: raw.settled.ok === true, detail: text(raw.settled.detail), at: text(raw.settled.at) || now }
      : null,
  };
}

export function normalizeKnowledge(raw, now = new Date().toISOString()) {
  if (!isPlainObject(raw)) return emptyKnowledge(now);
  const base = emptyKnowledge(text(raw.createdAt) || now);
  base.updatedAt = text(raw.updatedAt) || now;
  const policy = isPlainObject(raw.policy) ? raw.policy : {};
  base.policy.mode = POLICY_MODES.includes(text(policy.mode)) ? text(policy.mode) : DEFAULT_POLICY_MODE;
  // Sin este campo, una concesión global se escribiría y se perdería al leer (mismo fallo que 'settled').
  if (isPlainObject(policy.granted) && text(policy.granted.at) !== '') {
    base.policy.granted = { at: text(policy.granted.at), by: text(policy.granted.by) || 'human' };
  }
  base.policy.updatedAt = text(policy.updatedAt) || (isPlainObject(policy.granted) ? text(policy.granted.at) : '');
  if (isPlainObject(policy.projects)) {
    for (const [projectId, entry] of Object.entries(policy.projects)) {
      if (!isPlainObject(entry)) continue;
      const mode = text(entry.mode);
      if (!POLICY_MODES.includes(mode)) continue;
      base.policy.projects[projectId] = { mode, updatedAt: text(entry.updatedAt) || now, by: text(entry.by) || 'human' };
    }
  }
  base.insights = list(raw.insights).map((item) => normalizeInsight(item, now)).filter((item) => item !== null).slice(-MAX_INSIGHTS);
  base.decisions = list(raw.decisions).map((item) => normalizeDecision(item, now)).filter((item) => item !== null).slice(-MAX_DECISIONS);
  base.events = list(raw.events).map((item) => (isPlainObject(item) ? {
    at: text(item.at) || now,
    type: text(item.type),
    actor: text(item.actor) || 'ai',
    insightId: text(item.insightId),
    decisionId: text(item.decisionId),
    detail: text(item.detail),
  } : null)).filter((item) => item !== null && item.type !== '').slice(-MAX_EVENTS);
  return base;
}

const MAX_EVENTS = 4000;

/** Verifica la forma del documento. Devuelve `null` si sólo es una biblioteca vacía legítima. */
export function checkKnowledgeShape(parsed) {
  if (!isPlainObject(parsed)) return 'el documento no es un objeto';
  if (parsed.schema !== KNOWLEDGE_SCHEMA_ID) return `schema desconocido: ${String(parsed.schema)}`;
  const version = Number(parsed.schemaVersion);
  if (!Number.isInteger(version) || version < 1) return `schemaVersion inválida: ${String(parsed.schemaVersion)}`;
  if (version > KNOWLEDGE_SCHEMA) return 'future-version';
  for (const key of ['insights', 'decisions', 'events']) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) return `${key} tiene que ser una lista`;
  }
  if (parsed.policy !== undefined && !isPlainObject(parsed.policy)) return 'policy tiene que ser un objeto';
  return null;
}

/** Lee sin escribir. `integrity` distingue ausencia de corrupción. */
export function loadKnowledge(root) {
  const file = knowledgeFile(root);
  if (!existsSync(file)) {
    return { integrity: INTEGRITY_MISSING, file, document: emptyKnowledge(), sha256: '', size: 0, reason: '' };
  }
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    return { integrity: INTEGRITY_UNREADABLE, file, document: emptyKnowledge(), sha256: '', size: 0, reason: error.message };
  }
  const sha256 = sha256OfBytes(bytes);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return { integrity: INTEGRITY_UNREADABLE, file, document: emptyKnowledge(), sha256, size: bytes.length, reason: error.message };
  }
  const problem = checkKnowledgeShape(parsed);
  if (problem === 'future-version') {
    return { integrity: INTEGRITY_FUTURE_VERSION, file, document: emptyKnowledge(), sha256, size: bytes.length, reason: 'esquema del futuro' };
  }
  if (problem !== null) {
    return { integrity: INTEGRITY_INVALID_SHAPE, file, document: emptyKnowledge(), sha256, size: bytes.length, reason: problem };
  }
  return { integrity: INTEGRITY_OK, file, document: normalizeKnowledge(parsed), sha256, size: bytes.length, reason: '' };
}

export function canWriteKnowledge(integrity) {
  return integrity === INTEGRITY_OK || integrity === INTEGRITY_MISSING;
}

/** Firma canónica: dos documentos equivalentes producen los mismos bytes. */
export function knowledgeSignature(document) {
  const canonical = JSON.stringify(normalizeKnowledge(document), Object.keys(normalizeKnowledge(document)).sort());
  return sha256OfBytes(Buffer.from(canonical, 'utf8'));
}

function acquireLock(root) {
  const file = lockPath(root);
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx' });
      return () => rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const age = Date.now() - Number(JSON.parse(readFileSync(file, 'utf8')).at ? Date.parse(JSON.parse(readFileSync(file, 'utf8')).at) : 0);
        if (age > LOCK_STALE_MS) rmSync(file, { force: true });
      } catch {
        rmSync(file, { force: true });
      }
      sleep(LOCK_RETRY_MS);
    }
  }
  const busy = new Error('el registro de conocimiento está ocupado: no se pudo tomar el candado');
  busy.code = 'knowledge-busy';
  throw busy;
}

function writeAtomic(file, bytes) {
  const temp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(temp, bytes);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      renameSync(temp, file);
      return;
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EBUSY' && error.code !== 'EEXIST') {
        rmSync(temp, { force: true });
        throw error;
      }
      sleep(RENAME_RETRY_MS);
    }
  }
  rmSync(temp, { force: true });
  throw new Error('no se pudo publicar el registro de conocimiento');
}

/**
 * Ejecuta `mutator(document)` bajo candado. Sólo escribe si el resultado cambia los bytes.
 * Devuelve `{ ok, saved, document, result }`; con el registro ilegible devuelve `{ ok:false, code:'store-unreadable' }`.
 */
export function withKnowledge(root, mutator, { now = new Date().toISOString() } = {}) {
  now = toIso(now);
  const loaded = loadKnowledge(root);
  if (!canWriteKnowledge(loaded.integrity)) {
    return { ok: false, code: 'store-unreadable', integrity: loaded.integrity, reason: loaded.reason, document: loaded.document };
  }
  const release = acquireLock(root);
  try {
    const reloaded = loadKnowledge(root);
    if (!canWriteKnowledge(reloaded.integrity)) {
      return { ok: false, code: 'store-unreadable', integrity: reloaded.integrity, reason: reloaded.reason, document: reloaded.document };
    }
    const draft = cloneJson(reloaded.document);
    const result = mutator(draft, now);
    const normalized = normalizeKnowledge(draft, now);
    normalized.updatedAt = now;
    const before = reloaded.integrity === INTEGRITY_OK ? readFileSync(knowledgeFile(root)) : null;
    const bytes = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    if (before !== null && sha256OfBytes(before) === sha256OfBytes(bytes)) {
      return { ok: true, saved: false, document: normalized, result, sha256: sha256OfBytes(bytes), size: bytes.length };
    }
    writeAtomic(knowledgeFile(root), bytes);
    return { ok: true, saved: true, document: normalized, result, sha256: sha256OfBytes(bytes), size: bytes.length };
  } finally {
    release();
  }
}

function appendEvent(document, event, now) {
  document.events = [...list(document.events), { at: now, ...event }].slice(-MAX_EVENTS);
}

/** Recepción idempotente: el mismo `insightId` no crea una segunda entrada ni un segundo evento. */
export function receiveInsight(document, raw, now = new Date().toISOString()) {
  const insight = normalizeInsight(raw, now);
  if (insight !== null) insight.origin = normalizeOrigin(raw?.origin, raw);
  if (insight === null) return { ok: false, code: 'insight-invalid', detail: 'hace falta insightId y título o resumen' };
  const existing = list(document.insights).find((item) => item.insightId === insight.insightId);
  if (existing) return { ok: true, duplicate: true, insight: existing };
  const created = { ...insight, state: 'received', receivedAt: now, updatedAt: now };
  document.insights = [...list(document.insights), created].slice(-MAX_INSIGHTS);
  appendEvent(document, { type: 'insight-received', actor: 'ai', insightId: created.insightId, detail: created.title }, now);
  return { ok: true, duplicate: false, insight: created };
}

const TRIAGE_TRANSITIONS = {
  received: ['triaged', 'deferred', 'rejected'],
  triaged: ['validated', 'deferred', 'rejected', 'merged', 'documented', 'contradicted'],
  validated: ['decided', 'deferred', 'rejected', 'merged', 'documented', 'contradicted'],
  decided: ['acted-on', 'deferred', 'rejected', 'documented', 'contradicted'],
  'acted-on': [],
  merged: ['documented'],
  documented: [],
  contradicted: ['deferred', 'rejected', 'merged', 'documented'],
  deferred: ['triaged'],
  rejected: [],
};

/** Cambia el estado de un hallazgo respetando las transiciones permitidas. */
/**
 * Guarda el resultado de una verificación de origen hecha por el Host. El `proof` no lo aporta el
 * subagente: lo produce el adaptador cuando puede comprobarlo contra `subagents.listChildren`, y aquí
 * sólo se escribe el hecho comprobado. Sin `childId` no hay verificación: el origen queda declarado.
 */
export function recordOriginVerification(document, { insightId, proof } = {}, now = new Date().toISOString()) {
  const insight = list(document.insights).find((item) => item.insightId === text(insightId));
  if (!insight) return { ok: false, code: 'insight-not-found', detail: text(insightId) };
  if (!isPlainObject(proof) || text(proof.childId) === '' || text(proof.verifiedBy) === '') {
    return { ok: false, code: 'origin-proof-invalid', detail: 'falta el hijo comprobado o la fuente de la comprobación' };
  }
  insight.origin = {
    declared: isPlainObject(insight.origin?.declared) ? insight.origin.declared : { sourceAgent: '', parentRunId: '', sessionId: '' },
    verified: true,
    verifiedBy: text(proof.verifiedBy),
    verifiedAt: text(proof.at) || now,
    note: '',
    childId: text(proof.childId),
    parentId: text(proof.parentId),
  };
  insight.updatedAt = now;
  appendEvent(document, {
    type: 'insight-origin-verified',
    actor: 'human',
    insightId: insight.insightId,
    detail: `${insight.origin.verifiedBy} · hijo ${insight.origin.childId}`,
  }, now);
  return { ok: true, insight };
}

export function triageInsight(document, { insightId, state, note = '', decisionId = '', appliedSkillId = '', action = null } = {}, now = new Date().toISOString()) {
  const target = text(state);
  if (!INSIGHT_STATES.includes(target)) return { ok: false, code: 'insight-state-unknown', detail: target };
  const insight = list(document.insights).find((item) => item.insightId === text(insightId));
  if (!insight) return { ok: false, code: 'insight-not-found', detail: text(insightId) };
  const allowed = TRIAGE_TRANSITIONS[insight.state] ?? [];
  if (!allowed.includes(target)) {
    return { ok: false, code: 'insight-transition-invalid', detail: `${insight.state} -> ${target}`, allowed };
  }
  // `acted-on` no se gana leyendo, enlazando ni decidiendo: sólo con una acción que terminó bien.
  if (target === 'acted-on') {
    const done = isPlainObject(action) && action.ok === true;
    if (text(decisionId) === '' && text(insight.decisionId) === '') {
      return { ok: false, code: 'insight-requires-decision', detail: 'acted-on exige un decisionId registrado' };
    }
    if (!done) {
      return { ok: false, code: 'insight-action-not-done', detail: 'acted-on exige una acción con resultado correcto (ok:true)' };
    }
    insight.actedOn = normalizeActedOn({ ...action, at: text(action.at) || now, decisionId: text(decisionId) || insight.decisionId });
  }
  insight.state = target;
  insight.updatedAt = now;
  if (text(note) !== '') insight.notes = text(note);
  if (text(decisionId) !== '') insight.decisionId = text(decisionId);
  if (text(appliedSkillId) !== '') insight.appliedSkillId = text(appliedSkillId);
  const detail = target === 'acted-on' && insight.actedOn !== null
    ? `${note} · ${insight.actedOn.operation || 'action'} ok`
    : note;
  appendEvent(document, { type: `insight-${target}`, actor: 'ai', insightId: insight.insightId, decisionId: insight.decisionId, detail }, now);
  return { ok: true, insight };
}

/** Registro idempotente de una decisión; el actor lo pone quien decide, nunca el cuerpo de la petición. */
/**
 * Cierra un asiento ya autorizado con lo que de verdad pasó. No crea asientos nuevos: si el id no está,
 * no inventa una decisión que nadie tomó. El resultado es obligatorio porque el ledger debe poder separar
 * «se autorizó» de «se ejecutó».
 */
export function settleDecision(document, { decisionId, ok, detail = '' }, now) {
  const wanted = String(decisionId ?? '');
  const entry = (document.decisions ?? []).find((one) => String(one?.decisionId ?? '') === wanted);
  if (entry === undefined) return { ok: false, code: 'decision-not-found', decisionId: wanted };
  if (ok !== true && ok !== false) return { ok: false, code: 'outcome-required', decisionId: wanted };
  if (entry.settled !== null && entry.settled !== undefined) {
    const same = entry.settled.ok === ok;
    if (same) return { ok: true, decisionId: wanted, settled: entry.settled, saved: false };
    return { ok: false, code: 'settled-conflict', decisionId: wanted, settled: entry.settled };
  }
  entry.settled = { ok, detail: String(detail ?? ''), at: now };
  document.events.push({
    at: now,
    type: 'decision-settled',
    actor: 'system',
    decisionId: wanted,
    message: (ok === true ? 'ejecutada' : 'fallida') + (String(detail ?? '') === '' ? '' : ': ' + detail),
  });
  if (document.events.length > MAX_EVENTS) document.events.splice(0, document.events.length - MAX_EVENTS);
  document.updatedAt = now;
  return { ok: true, decisionId: wanted, settled: entry.settled };
}

export function recordDecision(document, raw, now = new Date().toISOString()) {
  const decision = normalizeDecision(raw, now);
  if (decision === null) {
    return { ok: false, code: 'decision-invalid', detail: 'hace falta decisionId y un outcome conocido' };
  }
  if (decision.actor === 'human') return { ok: false, code: 'decision-actor-invalid', detail: 'una decisión autónoma no se registra como humana' };
  const existing = list(document.decisions).find((item) => item.decisionId === decision.decisionId);
  if (existing) return { ok: true, duplicate: true, decision: existing };
  document.decisions = [...list(document.decisions), decision].slice(-MAX_DECISIONS);
  appendEvent(document, { type: 'decision-recorded', actor: decision.actor, decisionId: decision.decisionId, detail: decision.outcome }, now);
  return { ok: true, duplicate: false, decision };
}

/** Política por proyecto. Sólo un humano puede fijarla: la IA no se concede autonomía a sí misma. */
export function setPolicy(document, { projectId = '', mode, actor = 'human', by = 'human' } = {}, now = new Date().toISOString()) {
  now = toIso(now);
  const target = text(mode);
  if (!POLICY_MODES.includes(target)) return { ok: false, code: 'policy-mode-unknown', detail: target };
  if (text(actor) !== 'human') return { ok: false, code: 'approval-required', detail: 'la política de autonomía la fija una persona' };
  const id = text(projectId);
  if (id === '') {
    document.policy.mode = target;
    // Comprobante de la concesión: sin esto, un valor persistido no se puede distinguir
    // de un valor inicial escrito por el código (ver policyProvenance).
    document.policy.granted = { at: now, by: text(by) || 'human' };
    document.policy.updatedAt = now;
    appendEvent(document, { type: 'policy-changed', actor: 'human', detail: `global:${target}`, grantedAt: now, grantedBy: text(by) || 'human' }, now);
    return { ok: true, scope: 'global', mode: target, grantedAt: now };
  }
  document.policy.projects[id] = { mode: target, updatedAt: now, by: text(by) || 'human' };
  appendEvent(document, { type: 'policy-changed', actor: 'human', projectId: id, detail: `${id}:${target}` }, now);
  return { ok: true, scope: 'project', projectId: id, mode: target };
}

/** Modo efectivo de un proyecto: el suyo, o el global. */
export function policyFor(document, projectId = '') {
  const id = text(projectId);
  const entry = isPlainObject(document?.policy?.projects) ? document.policy.projects[id] : undefined;
  if (isPlainObject(entry) && POLICY_MODES.includes(text(entry.mode))) {
    return { mode: text(entry.mode), source: 'project', updatedAt: text(entry.updatedAt) };
  }
  const globalMode = text(document?.policy?.mode);
  const explicitGlobal = POLICY_MODES.includes(globalMode);
  const granted = isPlainObject(document?.policy?.granted) ? document.policy.granted : null;
  const grantedByHuman = granted !== null && text(granted.at) !== '' && text(granted.by) !== '';
  if (!explicitGlobal) {
    return { mode: DEFAULT_POLICY_MODE, source: 'default', updatedAt: '' };
  }
  if (!grantedByHuman) {
    // Un valor persistido no es una concesión: se conserva el dato original (storedMode) y se
    // resuelve fail-closed en tiempo de ejecución. La IA nunca puede elevarlo a concesión.
    return {
      mode: 'human-approved',
      source: 'legacy-unverified',
      storedMode: globalMode,
      updatedAt: '',
    };
  }
  return { mode: globalMode, source: 'global', granted: true, grantedAt: text(granted.at), updatedAt: text(document?.policy?.updatedAt) };
}

/** Resumen para herramientas y panel: qué espera decisión y qué se decidió. */
/**
 * Decisiones autorizadas que nunca recibieron su asiento de resultado.
 * Es la única prueba honesta de RT-D3: el asiento existe antes de ejecutar, así que una
 * ejecución interrumpida deja rastro recuperable en vez de desaparecer sin evidencia.
 */
export function unsettledDecisions(document) {
  const now = Date.now();
  return list(document?.decisions)
    .filter((decision) => isPlainObject(decision) && decision.settled === null)
    .map((decision) => ({
      decisionId: decision.decisionId,
      operation: decision.outcome,
      skillId: decision.skillId,
      projectId: decision.projectId,
      actor: decision.actor,
      decidedAt: decision.decidedAt,
      ageMs: (() => {
        const at = Date.parse(decision.decidedAt ?? '');
        return Number.isNaN(at) ? null : Math.max(0, now - at);
      })(),
    }));
}

export function knowledgeSummary(document) {
  const insights = list(document?.insights);
  const decisions = list(document?.decisions);
  const byState = {};
  for (const insight of insights) byState[insight.state] = (byState[insight.state] ?? 0) + 1;
  const byConfidence = {};
  for (const insight of insights) byConfidence[insight.confidence] = (byConfidence[insight.confidence] ?? 0) + 1;
  const pending = insights.filter((insight) => ['received', 'triaged', 'validated'].includes(insight.state));
  const byOutcome = {};
  for (const decision of decisions) byOutcome[decision.outcome] = (byOutcome[decision.outcome] ?? 0) + 1;
  const policy = policyFor(document, '');
  return {
    total: insights.length,
    pending: pending.length,
    policyProvenance: policy.source,
    legacyPolicy: policy.source === 'legacy-unverified',
    pendingIds: pending.map((insight) => insight.insightId),
    byState,
    byConfidence,
    decisions: decisions.length,
    byOutcome,
    mode: policyFor(document, '').mode,
  };
}
