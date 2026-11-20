/**
 * Contrato interno de eventos de conversación (LE-RAG-01 · Fase 5).
 *
 * Diseño, no integración: define la forma canónica que **cualquier host** puede entregar mediante un
 * adaptador. No importa nada del host y no se conecta a eventos reales.
 *
 * Reglas:
 *   - Sólo se aceptan mensajes (`message`) con rol `user`, `assistant` o `tool`.
 *   - Se rechazan roles internos (`system`, `reasoning`) y tipos desconocidos.
 *   - `eventId` es la clave de idempotencia: el mismo evento aplicado dos veces no cambia nada.
 *   - `sequence` ordena; dos eventos distintos con la misma secuencia → `sequence-conflict`.
 *   - `replace` sustituye el contenido de un evento existente sin cambiar su secuencia.
 *   - `delete` elimina un evento.
 *   - `metadata` se filtra: nunca se conservan claves con pinta de secreto.
 *   - La reducción es pura; el cursor lo decide quien la llama.
 */

import { RagError } from './errors.mjs';

export const EVENT_ROLES = Object.freeze(['user', 'assistant', 'tool']);
export const EVENT_OPERATIONS = Object.freeze(['append', 'replace', 'delete']);
const FORBIDDEN_ROLES = Object.freeze(['system', 'reasoning', 'developer']);
const SECRET_KEY = /(api[_-]?key|authorization|bearer|secret|password|token|cookie|credential)/i;

function fail(message, details = {}) {
  throw new RagError('invalid-argument', message, { details });
}

function cleanMetadata(metadata) {
  if (metadata === undefined || metadata === null) return {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) fail('metadata debe ser un objeto');
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEY.test(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
  }
  return out;
}

/** Valida y normaliza un evento crudo. Lanza `invalid-argument` si no es utilizable. */
export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('el evento debe ser un objeto');
  const { eventId, conversationId, sequence, role, content } = raw;
  if (typeof eventId !== 'string' || eventId.trim() === '') fail('eventId obligatorio', { field: 'eventId' });
  if (typeof conversationId !== 'string' || conversationId.trim() === '') fail('conversationId obligatorio', { field: 'conversationId' });
  if (!Number.isInteger(sequence) || sequence < 0) fail('sequence debe ser un entero ≥ 0', { field: 'sequence' });
  if (FORBIDDEN_ROLES.includes(role)) fail('rol no indexable', { field: 'role', role });
  if (!EVENT_ROLES.includes(role)) fail('rol desconocido', { field: 'role', role: role ?? null });
  const operation = raw.operation ?? 'append';
  if (operation !== 'delete' && (typeof content !== 'string' || content.trim() === '')) {
    fail('content obligatorio', { field: 'content' });
  }
  if (!EVENT_OPERATIONS.includes(operation)) fail('operación desconocida', { field: 'operation', operation });
  const timestamp = raw.timestamp === undefined ? null : raw.timestamp;
  if (timestamp !== null && !Number.isFinite(timestamp)) fail('timestamp debe ser numérico', { field: 'timestamp' });
  return {
    eventId,
    conversationId,
    sequence,
    role,
    content,
    operation,
    timestamp,
    metadata: cleanMetadata(raw.metadata),
  };
}

/**
 * Reduce una lista de eventos a los mensajes vigentes.
 * @returns {{messages: Array, applied: number, dropped: number, lastSequence: number, cursor: string|null}}
 */
export function reduceConversation(events, { cursor = null, maxEvents = 5000 } = {}) {
  if (!Array.isArray(events)) fail('events debe ser un array');
  const normalized = events.map(normalizeEvent);
  const conversationId = normalized[0]?.conversationId ?? null;
  if (normalized.some((event) => event.conversationId !== conversationId)) {
    fail('todos los eventos deben pertenecer a la misma conversación');
  }

  const seenSequence = new Map();
  for (const event of normalized) {
    const other = seenSequence.get(event.sequence);
    if (other && other !== event.eventId) {
      throw new RagError('sequence-conflict', 'dos eventos distintos comparten secuencia', {
        details: { sequence: event.sequence, eventId: event.eventId, other },
      });
    }
    seenSequence.set(event.sequence, event.eventId);
  }

  const ordered = [...normalized].sort((a, b) => a.sequence - b.sequence);
  const from = Number.isInteger(cursor) ? cursor : -1;
  const state = new Map();
  const applied = new Map();
  let applications = 0;
  let dropped = 0;
  let lastSequence = from;
  for (const event of ordered) {
    lastSequence = Math.max(lastSequence, event.sequence);
    if (event.sequence <= from) { dropped += 1; continue; }
    if (event.operation === 'delete') {
      state.delete(event.eventId);
      applied.delete(event.eventId);
      dropped += 1;
      continue;
    }
    const before = applied.get(event.eventId);
    if (before && before.content === event.content && before.operation === event.operation) {
      dropped += 1; // idempotencia: el mismo evento otra vez no cambia nada
      continue;
    }
    if (event.operation === 'append' && state.has(event.eventId)) {
      const current = state.get(event.eventId);
      if (current.content !== event.content) {
        fail('append sobre un evento existente con otro contenido; usa replace', { eventId: event.eventId });
      }
      dropped += 1;
      continue;
    }
    if (event.operation === 'replace') {
      const current = state.get(event.eventId);
      if (!current) fail('replace sobre un evento desconocido', { eventId: event.eventId });
      // El reemplazo cambia el contenido, no la posición: se conserva la secuencia original.
      state.set(event.eventId, { ...event, sequence: current.sequence });
      applied.set(event.eventId, { content: event.content, operation: event.operation });
      applications += 1;
      continue;
    }
    state.set(event.eventId, event);
    applied.set(event.eventId, { content: event.content, operation: event.operation });
    applications += 1;
  }

  let messages = [...state.values()].sort((a, b) => a.sequence - b.sequence);
  if (Number.isInteger(maxEvents) && maxEvents > 0 && messages.length > maxEvents) {
    messages = messages.slice(messages.length - maxEvents);
  }
  return {
    messages: messages.map(({ eventId, role, content, sequence, timestamp }) => ({ eventId, role, content, sequence, timestamp })),
    applied: applications,
    dropped,
    lastSequence,
    cursor: lastSequence,
  };
}
