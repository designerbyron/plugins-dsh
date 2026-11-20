/** LE-RAG-01 · Contrato interno de eventos de conversación (fixtures sintéticos). */
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeEvent, reduceConversation } from '../lib/conversation-events.mjs';

const ev = (over = {}) => ({
  eventId: 'e1', conversationId: 'c1', sequence: 1, role: 'user', content: 'hola', ...over,
});

test('normalizeEvent: acepta roles indexables y rechaza internos', () => {
  assert.equal(normalizeEvent(ev()).role, 'user');
  assert.equal(normalizeEvent(ev({ role: 'assistant' })).role, 'assistant');
  assert.equal(normalizeEvent(ev({ role: 'tool' })).role, 'tool');
  for (const role of ['system', 'reasoning', 'developer']) {
    assert.throws(() => normalizeEvent(ev({ role })), (e) => e.code === 'invalid-argument');
  }
  assert.throws(() => normalizeEvent(ev({ sequence: -1 })), (e) => e.code === 'invalid-argument');
  assert.throws(() => normalizeEvent(ev({ content: '   ' })), (e) => e.code === 'invalid-argument');
  assert.throws(() => normalizeEvent(ev({ operation: 'merge' })), (e) => e.code === 'invalid-argument');
});

test('normalizeEvent: metadata filtra claves con pinta de secreto', () => {
  const out = normalizeEvent(ev({ metadata: { apiKey: 'x', authorization: 'y', sessionId: 's', n: 1, nested: { a: 1 } } }));
  assert.deepEqual(out.metadata, { sessionId: 's', n: 1 });
});

test('reduce: orden por secuencia y contenido vigente', () => {
  const out = reduceConversation([
    ev({ eventId: 'b', sequence: 2, role: 'assistant', content: 'dos' }),
    ev({ eventId: 'a', sequence: 1, content: 'uno' }),
  ]);
  assert.deepEqual(out.messages.map((m) => m.content), ['uno', 'dos']);
  assert.equal(out.lastSequence, 2);
  assert.equal(out.cursor, 2, 'el cursor es la última secuencia aplicada');
});

test('reduce: replace y delete sin inventar', () => {
  const out = reduceConversation([
    ev({ eventId: 'a', sequence: 1, content: 'original' }),
    ev({ eventId: 'a', sequence: 1, content: 'reemplazado', operation: 'replace' }),
    ev({ eventId: 'b', sequence: 2, content: 'temporal' }),
    ev({ eventId: 'b', sequence: 2, content: '', operation: 'delete' }),
  ]);
  assert.deepEqual(out.messages.map((m) => [m.eventId, m.content]), [['a', 'reemplazado']]);
  assert.throws(() => reduceConversation([ev({ eventId: 'z', sequence: 3, operation: 'replace' })]), (e) => e.code === 'invalid-argument');
});

test('reduce: idempotencia con cursor y conflicto de secuencia', () => {
  const events = [ev({ eventId: 'a', sequence: 1 }), ev({ eventId: 'b', sequence: 2, role: 'assistant', content: 'ok' })];
  const first = reduceConversation(events);
  const again = reduceConversation(events, { cursor: first.cursor });
  assert.deepEqual(again.messages.map((m) => m.eventId), []);
  assert.equal(again.cursor, first.cursor);

  assert.throws(
    () => reduceConversation([ev({ eventId: 'a', sequence: 1 }), ev({ eventId: 'b', sequence: 1 })]),
    (e) => e.code === 'sequence-conflict',
  );
});

test('reduce: retención y determinismo', () => {
  const events = Array.from({ length: 6 }, (_, i) => ev({ eventId: `e${i}`, sequence: i, content: `m${i}` }));
  const out = reduceConversation(events, { maxEvents: 2 });
  assert.deepEqual(out.messages.map((m) => m.content), ['m4', 'm5']);
  assert.deepEqual(out.messages, reduceConversation(events, { maxEvents: 2 }).messages);
});
