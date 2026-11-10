/**
 * Peticiones humanas a la IA: la persona describe en el panel lo que necesita y el agente lo crea.
 *
 * El plugin no puede llamar a un modelo —el Host no expone esa capacidad a los plugins—, así que la
 * "creación por lenguaje natural" se hace donde sí hay un modelo: la sesión del agente. Este módulo
 * guarda la petición como dato durable y el agente la ve por su herramienta de estado; cuando crea la
 * skill, la petición queda enlazada. Nada se publica ni se activa por esto: crear y publicar siguen
 * siendo actos separados y humanos en su aprobación.
 *
 * Puro: no toca disco ni el harness, para poder probarlo con `node --test`.
 */
import { shortHash } from './format.mjs';

export const REQUEST_STATUSES = ['pending', 'fulfilled', 'dismissed'];
export const MAX_REQUEST_LENGTH = 2000;

function value(value) {
  return typeof value === 'string' ? value : '';
}

/** Identificador estable y derivado del contenido: dos peticiones iguales no crean ruido. */
export function requestIdFor(text, now) {
  return `req-${shortHash(`${text}:${now}`, 12)}`;
}

/**
 * Abre una petición. Falla si el texto está vacío o es desmesurado: una petición sin contenido no se
 * puede cumplir y sólo ensucia la cola.
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
  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  if (text === '') return { ok: false, code: 'empty-request', message: 'escribe qué necesitas' };
  if (text.length > MAX_REQUEST_LENGTH) {
    return {
      ok: false,
      code: 'request-too-long',
      message: `una petición no puede pasar de ${MAX_REQUEST_LENGTH} caracteres`,
    };
  }
  const requests = state.requests ?? {};
  for (const entry of Object.values(requests)) {
    if (entry?.status === 'pending' && entry.text === text) {
      return { ok: true, id: entry.id, request: entry, duplicate: true };
    }
  }
  const id = requestIdFor(text, now);
  const request = { id, text, createdAt: now, status: 'pending', skillId: '', fulfilledAt: '', note: '' };
  requests[id] = request;
  state.requests = requests;
  return { ok: true, id, request, duplicate: false };
}

/** El agente enlaza la skill que creó. Sin `skillId` no se cumple: cumplir es señalar el resultado. */
export function fulfillRequest(state, id, input, { now = new Date().toISOString(), actor = 'ai' } = {}) {
  const request = state?.requests?.[id];
  if (!request) return { ok: false, code: 'unknown-request', message: `no existe la petición ${id}` };
  if (request.status !== 'pending') {
    return { ok: false, code: 'settled', message: `la petición ${id} ya está ${request.status}` };
  }
  const skillId = typeof input?.skillId === 'string' ? input.skillId.trim() : '';
  if (skillId === '') return { ok: false, code: 'missing-skill', message: 'cumplir una petición exige la skill creada' };
  if (!state.skills?.[skillId]) return { ok: false, code: 'missing-skill', message: `no existe la skill ${skillId}` };
  request.status = 'fulfilled';
  request.skillId = skillId;
  request.fulfilledAt = now;
  request.note = value(input?.note);
  request.by = actor === 'ai' ? 'ai' : 'human';
  return { ok: true, id, request };
}

/** Descartar es humano: la IA no decide que una necesidad deja de importar. */
export function dismissRequest(state, id, { now = new Date().toISOString(), actor = 'human' } = {}) {
  const request = state?.requests?.[id];
  if (!request) return { ok: false, code: 'unknown-request', message: `no existe la petición ${id}` };
  if (request.status !== 'pending') {
    return { ok: false, code: 'settled', message: `la petición ${id} ya está ${request.status}` };
  }
  if (actor !== 'human') {
    return { ok: false, code: 'approval-required', message: 'descartar una petición es de la persona que la abrió' };
  }
  request.status = 'dismissed';
  request.fulfilledAt = now;
  return { ok: true, id, request };
}

/** Cola pendiente, la más antigua primero: el agente debe atender por orden de llegada. */
export function pendingRequests(state) {
  const all = Object.values(state?.requests ?? {});
  return all
    .filter((entry) => entry?.status === 'pending')
    .sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''));
}

/** Vista para el panel y para la herramienta del agente; no expone nada que no sea la petición. */
export function requestView(state, { limit = 20 } = {}) {
  const all = Object.values(state?.requests ?? {});
  const sorted = all.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
  const pending = sorted.filter((entry) => entry.status === 'pending');
  const recent = sorted.filter((entry) => entry.status !== 'pending');
  const items = [...pending, ...recent]
    .slice(0, Math.max(1, Math.min(limit, 100)))
    .map((entry) => ({
      id: entry.id,
      text: entry.text,
      status: entry.status,
      createdAt: entry.createdAt,
      skillId: entry.skillId ?? '',
      skillTitle: entry.skillId ? (state?.skills?.[entry.skillId]?.title ?? '') : '',
      fulfilledAt: entry.fulfilledAt ?? '',
      by: entry.by ?? '',
    }));
  return { pending: pending.length, total: all.length, items };
}
