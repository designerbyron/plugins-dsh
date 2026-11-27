/**
 * Peticiones humanas a la IA: la persona describe en el panel lo que necesita y el agente lo atiende.
 *
 * Fase C: el buzón durable sigue siendo la fuente de verdad, pero ya no es el único acto. La entrega a
 * una sesión viva, el reclamo atómico y el resultado se registran como operaciones distintas con
 * evidencia. Los registros v2 sin `kind`/`scope` se leen como legacy/global: NUNCA se reescriben al leer.
 *
 * Fase G: `scope` y `projectId` siguen siendo los ÚNICOS campos de ámbito. Una petición global guarda
 * `projectId: null`; una de proyecto guarda el id canónico resuelto por el servidor. La proyección de
 * lectura puede mostrar `''` para ausencia, pero no reescribe el registro.
 *
 * Puro: no toca disco ni el harness, para poder probarlo con `node --test`.
 */
import { shortHash } from './format.mjs';

export const REQUEST_STATUSES = ['pending', 'delivered', 'processing', 'fulfilled', 'failed', 'blocked', 'dismissed'];
export const REQUEST_KINDS = ['create', 'improve', 'vendorize', 'general'];
export const REQUEST_SCOPES = ['global', 'project'];
export const LEGACY_SCOPE = 'legacy/global';
export const MAX_REQUEST_LENGTH = 2000;
export const MAX_SOURCE_URL_LENGTH = 2000;
export const DEFAULT_CLAIM_LEASE_MS = 10 * 60 * 1000;

function value(value) {
  return typeof value === 'string' ? value : '';
}

/** Texto como dato: se recorta y se limpian caracteres de control, pero no se interpreta ni se ejecuta. */
export function normalizeRequestText(text) {
  return typeof text === 'string'
    ? text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
    : '';
}

/** La URL es un dato a mostrar/validar; en Fase C nunca se descarga ni se consulta. */
export function normalizeSourceUrl(sourceUrl) {
  const raw = value(sourceUrl).trim();
  if (raw === '') return { ok: true, url: '' };
  if (raw.length > MAX_SOURCE_URL_LENGTH) return { ok: false, code: 'invalid-source-url', message: 'la URL es demasiado larga' };
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, code: 'invalid-source-url', message: 'sólo se aceptan URLs http/https como dato' };
    return { ok: true, url: raw };
  } catch {
    return { ok: false, code: 'invalid-source-url', message: 'esa URL no es válida' };
  }
}

/** Identificador estable y derivado del contenido. Nunca sobrescribe un id ya existente. */
export function requestIdFor(text, now) {
  return `req-${shortHash(`${text}:${now}`, 12)}`;
}

function freshId(state, text, now) {
  const base = requestIdFor(text, now);
  const requests = state?.requests ?? {};
  if (requests[base] === undefined) return base;
  let n = 2;
  while (requests[`${base}-${n}`] !== undefined) n += 1;
  return `${base}-${n}`;
}

/**
 * Proyección de lectura de un registro v2 o v3. Añade campos, no los escribe: un GET no migra nada.
 * `kind: 'unclassified'` y `scope: legacy/global` son etiquetas de presentación, no escrituras.
 */
export function projectRequest(entry) {
  const record = entry && typeof entry === 'object' ? entry : {};
  const kind = REQUEST_KINDS.includes(record.kind) ? record.kind : 'unclassified';
  const scope = record.scope === 'global' || record.scope === 'project' ? record.scope : LEGACY_SCOPE;
  const claim = record.claim && typeof record.claim === 'object' ? record.claim : null;
  const expiresAt = claim ? String(claim.expiresAt ?? '') : '';
  const claimExpired = expiresAt !== '' && Date.parse(expiresAt) <= Date.now();
  const status = REQUEST_STATUSES.includes(record.status) ? record.status : 'pending';
  return {
    id: String(record.id ?? ''),
    text: String(record.text ?? ''),
    status,
    effectiveStatus: status === 'processing' && claimExpired ? 'pending' : status,
    claimExpired: status === 'processing' && claimExpired,
    kind,
    scope,
    projectId: value(record.projectId),
    sourceUrl: value(record.sourceUrl),
    createdAt: value(record.createdAt),
    updatedAt: value(record.updatedAt || record.createdAt),
    skillId: value(record.skillId),
    fulfilledAt: value(record.fulfilledAt),
    startedAt: value(record.startedAt),
    finishedAt: value(record.finishedAt),
    by: value(record.by),
    requestedBy: value(record.requestedBy),
    note: value(record.note),
    attempts: Number.isFinite(record.attempts) ? record.attempts : 0,
    delivery: record.delivery && typeof record.delivery === 'object' ? { ...record.delivery } : null,
    claim,
    result: record.result && typeof record.result === 'object' ? { ...record.result } : null,
    errorCode: value(record.errorCode),
    blockedReason: value(record.blockedReason),
    skillTitle: '',
  };
}

/**
 * Abre una petición. Falla si el texto está vacío o es desmesurado: una petición sin contenido no se
 * puede atender y sólo ensucia la cola. Tipo y ámbito son explícitos en las peticiones nuevas.
 */
export function openRequest(state, input, { now = new Date().toISOString(), actor = 'human' } = {}) {
  if (!state || typeof state !== 'object') return { ok: false, code: 'invalid-state', message: 'no hay centro que abrir' };
  if (actor !== 'human') {
    return {
      ok: false,
      code: 'approval-required',
      message: 'una petición a la IA la abre una persona desde el panel: la IA no se encarga trabajo a sí misma',
    };
  }
  const text = normalizeRequestText(input?.text);
  if (text === '') return { ok: false, code: 'empty-request', message: 'escribe qué necesitas' };
  if (text.length > MAX_REQUEST_LENGTH) {
    return { ok: false, code: 'request-too-long', message: `una petición no puede pasar de ${MAX_REQUEST_LENGTH} caracteres` };
  }
  const kind = input?.kind === undefined || input?.kind === '' ? 'general' : value(input.kind);
  if (!REQUEST_KINDS.includes(kind)) return { ok: false, code: 'invalid-kind', message: `tipo desconocido: ${kind}` };
  const scope = input?.scope === undefined || input?.scope === '' ? 'global' : value(input.scope);
  if (!REQUEST_SCOPES.includes(scope)) return { ok: false, code: 'invalid-scope', message: `ámbito desconocido: ${scope}` };
  let projectId = null;
  if (scope === 'project') {
    if (typeof input?.projectId !== 'string' || input.projectId.trim() === '') {
      return { ok: false, code: 'missing-project', message: 'una petición de proyecto necesita un projectId validado' };
    }
    projectId = input.projectId;
  } else if (input?.projectId !== undefined && input?.projectId !== null && value(input.projectId) !== '') {
    return { ok: false, code: 'invalid-project-scope', message: 'una petición global no puede declarar un proyecto' };
  }
  const url = normalizeSourceUrl(input?.sourceUrl);
  if (url.ok !== true) return url;

  const requests = state.requests ?? {};
  const fingerprint = (entry) => `${projectRequest(entry).kind}|${projectRequest(entry).scope}|${value(entry?.projectId)}|${value(entry?.text)}`;
  for (const entry of Object.values(requests)) {
    if (entry?.status === 'pending' && fingerprint(entry) === `${kind}|${scope}|${projectId ?? ''}|${text}`) {
      return { ok: true, id: value(entry.id), request: entry, duplicate: true };
    }
  }
  const id = freshId(state, text, now);
  const request = {
    id,
    text,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    skillId: '',
    fulfilledAt: '',
    note: '',
    requestedBy: 'human',
    kind,
    scope,
    projectId,
    sourceUrl: url.url,
    delivery: null,
    claim: null,
    attempts: 0,
    startedAt: '',
    finishedAt: '',
    result: null,
    errorCode: '',
    blockedReason: '',
  };
  requests[id] = request;
  state.requests = requests;
  return { ok: true, id, request, duplicate: false };
}

function findRequest(state, id) {
  const requestId = value(id);
  const request = state?.requests?.[requestId];
  if (!request) return { ok: false, code: 'unknown-request', message: `no existe la petición ${requestId}` };
  return { ok: true, id: requestId, request };
}

function isSettled(request) {
  return ['fulfilled', 'dismissed'].includes(request.status);
}

/** Entrega real: exige evidencia del Host. Sin ella la petición sigue pendiente. */
export function deliverRequest(state, id, input, { now = new Date().toISOString(), actor = 'human' } = {}) {
  const found = findRequest(state, id);
  if (found.ok !== true) return found;
  const request = found.request;
  if (actor !== 'human') return { ok: false, code: 'approval-required', message: 'entregar al agente es una acción humana del panel' };
  if (isSettled(request) || request.status === 'processing') {
    return { ok: false, code: 'settled', message: `la petición ${found.id} ya está ${request.status}` };
  }
  const sessionId = value(input?.sessionId);
  const messageId = value(input?.messageId);
  if (sessionId === '' || messageId === '') return { ok: false, code: 'missing-delivery-evidence', message: 'la entrega necesita sessionId y messageId reales' };
  const previous = request.delivery && typeof request.delivery === 'object' ? request.delivery : null;
  if (previous?.sessionId === sessionId && ['delivered', 'processing'].includes(request.status)) {
    return { ok: false, code: 'already-delivered', message: `la petición ${found.id} ya fue entregada a esa sesión` };
  }
  request.status = 'delivered';
  request.delivery = { sessionId, messageId, at: now, via: value(input?.via) || 'agents.followup' };
  request.attempts = (Number.isFinite(request.attempts) ? request.attempts : 0) + 1;
  request.updatedAt = now;
  request.errorCode = '';
  request.blockedReason = '';
  return { ok: true, id: found.id, request };
}

/** Claim atómico del agente. Un reclamo vivo impide que otro agente tome la misma petición. */
export function claimRequest(state, id, input, { now = new Date().toISOString(), actor = 'ai', leaseMs = DEFAULT_CLAIM_LEASE_MS } = {}) {
  const found = findRequest(state, id);
  if (found.ok !== true) return found;
  const request = found.request;
  if (actor !== 'ai') return { ok: false, code: 'actor-required', message: 'sólo el canal de herramientas puede reclamar una petición' };
  if (isSettled(request)) return { ok: false, code: 'settled', message: `la petición ${found.id} ya está ${request.status}` };
  const nowMs = Date.parse(now);
  const current = request.claim && typeof request.claim === 'object' ? request.claim : null;
  const active = request.status === 'processing' && current !== null && Date.parse(value(current.expiresAt)) > nowMs;
  if (active) return { ok: false, code: 'claim-active', message: `la petición ${found.id} ya está reclamada` };
  if (!['delivered', 'processing'].includes(request.status)) {
    return { ok: false, code: 'not-delivered', message: `la petición ${found.id} todavía no fue entregada: reclamarla sería fingir un trabajo` };
  }
  const owner = value(input?.owner);
  if (owner === '') return { ok: false, code: 'missing-owner', message: 'el claim necesita la sesión del agente que lo adquiere' };
  request.status = 'processing';
  request.claim = {
    owner,
    sessionId: value(input?.sessionId) || owner,
    at: now,
    expiresAt: new Date(nowMs + Math.max(1000, leaseMs)).toISOString(),
  };
  request.startedAt = now;
  request.updatedAt = now;
  return { ok: true, id: found.id, request };
}

function requireOwnClaim(request, actor, sessionId) {
  if (actor !== 'ai') return { ok: false, code: 'actor-required', message: 'esta transición es del agente que reclamo la petición' };
  if (request.status !== 'processing') return { ok: false, code: 'not-processing', message: 'la petición no está en ejecución real' };
  const owner = value(request.claim?.owner);
  if (owner === '' || value(sessionId) !== owner) {
    return { ok: false, code: 'claim-mismatch', message: 'otra sesión tiene el reclamo: no se puede cerrar esta petición' };
  }
  return { ok: true };
}

/** La ejecución terminó mal: se publica la razón y se permite reanudar. */
export function failRequest(state, id, input, { now = new Date().toISOString(), actor = 'ai' } = {}) {
  const found = findRequest(state, id);
  if (found.ok !== true) return found;
  const allowed = requireOwnClaim(found.request, actor, input?.sessionId);
  if (allowed.ok !== true) return allowed;
  found.request.status = 'failed';
  found.request.errorCode = value(input?.errorCode) || 'execution-failed';
  found.request.finishedAt = now;
  found.request.updatedAt = now;
  found.request.claim = null;
  return { ok: true, id: found.id, request: found.request };
}

/** Capacidad ausente o aprobación pendiente: causa explícita, nunca una finalización fingida. */
export function blockRequest(state, id, input, { now = new Date().toISOString(), actor = 'ai' } = {}) {
  const found = findRequest(state, id);
  if (found.ok !== true) return found;
  const allowed = requireOwnClaim(found.request, actor, input?.sessionId);
  if (allowed.ok !== true) return allowed;
  const reason = value(input?.blockedReason);
  if (reason === '') return { ok: false, code: 'missing-blocked-reason', message: 'una petición bloqueada necesita una causa' };
  found.request.status = 'blocked';
  found.request.blockedReason = reason;
  found.request.errorCode = value(input?.errorCode);
  found.request.finishedAt = now;
  found.request.updatedAt = now;
  found.request.claim = null;
  return { ok: true, id: found.id, request: found.request };
}

/** La persona reanuda una petición bloqueada o fallida; la entrega queda pendiente de nuevo. */
export function resumeRequest(state, id, { now = new Date().toISOString(), actor = 'human' } = {}) {
  const found = findRequest(state, id);
  if (found.ok !== true) return found;
  if (actor !== 'human') return { ok: false, code: 'approval-required', message: 'reanudar es una decisión humana' };
  if (!['blocked', 'failed'].includes(found.request.status)) {
    return { ok: false, code: 'not-resumable', message: `una petición ${found.request.status} no se reanuda` };
  }
  found.request.status = 'pending';
  found.request.blockedReason = '';
  found.request.errorCode = '';
  found.request.claim = null;
  found.request.delivery = null;
  found.request.updatedAt = now;
  return { ok: true, id: found.id, request: found.request };
}

/** El agente enlaza la skill que creó. Sin `skillId` no se cumple: cumplir es señalar el resultado. */
export function fulfillRequest(state, id, input, { now = new Date().toISOString(), actor = 'ai' } = {}) {
  const found = findRequest(state, id);
  if (found.ok !== true) return found;
  const request = found.request;
  // Compatibilidad: los registros v2 y las herramientas antiguas cumplen desde `pending`. Las
  // peticiones entregadas en Fase C tienen que pasar por claim antes de darse por cumplidas.
  if (!['pending', 'delivered', 'processing'].includes(request.status)) {
    return { ok: false, code: 'settled', message: `la petición ${found.id} ya está ${request.status}` };
  }
  if (request.status !== 'pending') {
    const allowed = requireOwnClaim(request, actor, input?.sessionId);
    if (allowed.ok !== true) return allowed;
  }
  const skillId = typeof input?.skillId === 'string' ? input.skillId.trim() : '';
  if (skillId === '') return { ok: false, code: 'missing-skill', message: 'cumplir una petición exige la skill creada' };
  if (!state.skills?.[skillId]) return { ok: false, code: 'missing-skill', message: `no existe la skill ${skillId}` };
  request.status = 'fulfilled';
  request.skillId = skillId;
  request.fulfilledAt = now;
  request.finishedAt = now;
  request.note = value(input?.note);
  request.result = { kind: 'skill', id: skillId, at: now, note: value(input?.note) };
  request.by = actor === 'ai' ? 'ai' : 'human';
  request.claim = null;
  request.errorCode = '';
  request.blockedReason = '';
  request.updatedAt = now;
  return { ok: true, id: found.id, request };
}

/** Una propuesta NO cumple la petición: queda bloqueada hasta aprobación humana. */
export function linkProposal(state, id, input, { now = new Date().toISOString(), actor = 'ai' } = {}) {
  const found = findRequest(state, id);
  if (found.ok !== true) return found;
  const allowed = requireOwnClaim(found.request, actor, input?.sessionId);
  if (allowed.ok !== true) return allowed;
  const improvementId = value(input?.improvementId);
  if (improvementId === '') return { ok: false, code: 'missing-improvement', message: 'no hay propuesta que enlazar' };
  found.request.status = 'blocked';
  found.request.result = { kind: 'improvement', id: improvementId, at: now, note: 'proposal-awaiting-approval' };
  found.request.blockedReason = 'proposal-awaiting-approval';
  found.request.finishedAt = now;
  found.request.updatedAt = now;
  found.request.claim = null;
  return { ok: true, id: found.id, request: found.request };
}

/** Descartar es humano: la IA no decide que una necesidad deja de importar. */
export function dismissRequest(state, id, { now = new Date().toISOString(), actor = 'human' } = {}) {
  const found = findRequest(state, id);
  if (found.ok !== true) return found;
  if (isSettled(found.request)) {
    return { ok: false, code: 'settled', message: `la petición ${found.id} ya está ${found.request.status}` };
  }
  if (actor !== 'human') {
    return { ok: false, code: 'approval-required', message: 'descartar una petición es de la persona que la abrió' };
  }
  found.request.status = 'dismissed';
  found.request.fulfilledAt = now;
  found.request.finishedAt = now;
  found.request.updatedAt = now;
  found.request.claim = null;
  return { ok: true, id: found.id, request: found.request };
}

/** Cola pendiente, la más antigua primero: el agente atiende por orden de llegada. */
export function pendingRequests(state) {
  return Object.values(state?.requests ?? {})
    .filter((entry) => entry?.status === 'pending')
    .sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''));
}

/** Vista para el panel y la herramienta. Enriquece sin mutar; `pendingItems` no se recorta jamás. */
export function requestView(state, { limit = 20 } = {}) {
  const all = Object.values(state?.requests ?? {});
  const summary = { total: all.length };
  for (const status of REQUEST_STATUSES) summary[status] = 0;
  const projected = all.map((entry) => {
    const view = projectRequest(entry);
    summary[view.effectiveStatus] = (summary[view.effectiveStatus] ?? 0) + 1;
    view.skillTitle = view.skillId ? String(state?.skills?.[view.skillId]?.title ?? '') : '';
    return view;
  });
  const byArrival = [...projected].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const pendingItems = byArrival.filter((entry) => entry.effectiveStatus === 'pending');
  // "Atendible" incluye lo entregado pero aún no reclamado: si la herramienta de estado sólo mostrara
  // `pending`, una petición entregada desaparecería justo cuando el agente tiene que recogerla.
  const actionableItems = byArrival.filter((entry) => ['pending', 'delivered'].includes(entry.effectiveStatus));
  const others = [...projected].filter((entry) => !['pending', 'delivered'].includes(entry.effectiveStatus))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const items = [...actionableItems, ...others].slice(0, Math.max(1, Math.min(limit, 100)));
  return {
    pending: pendingItems.length,
    actionable: actionableItems.length,
    total: all.length,
    summary,
    pendingItems,
    actionableItems,
    items,
    // El panel necesita la lista completa para filtrar: un «ver más» que recortara a 20 dejaría
    // inalcanzables las peticiones antiguas (el caso heredado req-562393e0835f).
    all: projected,
    truncated: projected.length > items.length,
  };
}
