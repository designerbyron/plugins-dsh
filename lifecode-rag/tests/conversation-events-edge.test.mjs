/** LE-RAG-02 · Robustez del contrato de eventos (casos límite). */
import test from 'node:test';
import assert from 'node:assert/strict';

import { reduceConversation } from '../lib/conversation-events.mjs';

const ev = (over = {}) => ({ eventId: 'e1', conversationId: 'c1', sequence: 1, role: 'user', content: 'hola', ...over });

test('replace conserva la secuencia original', () => {
  const out = reduceConversation([
    ev({ eventId: 'a', sequence: 1, content: 'uno' }),
    ev({ eventId: 'b', sequence: 2, role: 'assistant', content: 'dos' }),
    ev({ eventId: 'a', sequence: 9, content: 'uno corregido', operation: 'replace' }),
  ]);
  assert.deepEqual(out.messages.map((m) => [m.eventId, m.sequence, m.content]), [
    ['a', 1, 'uno corregido'],
    ['b', 2, 'dos'],
  ]);
});

test('evento tardío por debajo del cursor se descarta', () => {
  const out = reduceConversation([ev({ eventId: 'a', sequence: 1 }), ev({ eventId: 'b', sequence: 2, role: 'assistant', content: 'ok' })], { cursor: 2 });
  assert.deepEqual(out.messages, []);
  assert.equal(out.lastSequence, 2);
});

test('cursor por delante del contenido: no inventa y lo declara', () => {
  const out = reduceConversation([ev({ eventId: 'a', sequence: 7 })], { cursor: 10 });
  assert.deepEqual(out.messages, []);
  assert.equal(out.lastSequence, 10);
  assert.equal(out.cursor, 10);
});

test('delete seguido de replay con cursor anterior es seguro', () => {
  const events = [
    ev({ eventId: 'a', sequence: 1, content: 'uno' }),
    ev({ eventId: 'b', sequence: 2, role: 'assistant', content: 'dos' }),
    ev({ eventId: 'b', sequence: 2, content: '', operation: 'delete' }),
  ];
  const first = reduceConversation(events);
  assert.deepEqual(first.messages.map((m) => m.eventId), ['a']);
  const replay = reduceConversation(events, { cursor: 1 });
  assert.deepEqual(replay.messages, [], 'lo anterior al cursor no se devuelve (ya estaba aplicado)');
  const full = reduceConversation(events, { cursor: 0 });
  assert.deepEqual(full.messages.map((m) => m.eventId), ['a'], 'el replay completo vuelve a aplicar el delete');
});

test('duplicado idéntico no cambia nada; evento duplicado con otro contenido sin replace falla', () => {
  const out = reduceConversation([ev({ eventId: 'a', sequence: 1 }), ev({ eventId: 'a', sequence: 1 })]);
  assert.equal(out.applied, 1);
  assert.equal(out.messages.length, 1);
  assert.throws(
    () => reduceConversation([ev({ eventId: 'a', sequence: 1 }), ev({ eventId: 'a', sequence: 1, content: 'distinto' })]),
    (e) => e.code === 'invalid-argument',
  );
});

test('entrada desordenada con secuencias repetidas de ids distintos: conflicto', () => {
  assert.throws(
    () => reduceConversation([ev({ eventId: 'a', sequence: 3 }), ev({ eventId: 'b', sequence: 3 })]),
    (e) => e.code === 'sequence-conflict',
  );
});

test('conversaciones mezcladas se rechazan', () => {
  assert.throws(
    () => reduceConversation([ev({ eventId: 'a', sequence: 1 }), ev({ eventId: 'b', sequence: 2, conversationId: 'c2' })]),
    (e) => e.code === 'invalid-argument',
  );
});
