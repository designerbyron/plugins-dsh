/**
 * R17 — eventos con efectos reales (§1, §2, §3, §R6-R10).
 *
 * Cada prueba opera sobre el código real (`runAction`/`handleApiRequest`) y una caja temporal. Se mide el
 * hash de `center.json` antes y después para distinguir «éxito» de «no pasó nada».
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { runAction } from '../lib/api.mjs';
import { activityForResult, buildActivityFeed, normalizeEvent } from '../lib/activity.mjs';
import { appendEvent, centerFile, loadState, withState } from '../lib/state.mjs';
import { knowledgeFile } from '../lib/knowledge.mjs';
import { candidate, tempRoot } from './helpers.mjs';

const NOW = '2026-11-09T20:00:00.000Z';

function sha(path) {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'missing';
}

function act(root, action, payload = {}, extra = {}) {
  return runAction({ root, action, payload, actor: 'human', cwd: '', now: NOW, ...extra });
}

function create(root, overrides = {}) {
  return act(root, 'create', { ...candidate(), ...overrides });
}

function feed(root) {
  return buildActivityFeed(loadState(root).state, null, { limit: 50 });
}

test('R17 §1/R8: crear produce exactamente un evento y la respuesta trae su entrada', () => {
  const root = tempRoot('r17-events-create');
  const result = create(root, { operationId: 'op-create' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.replayed, false);
  assert.ok(result.activity, 'la respuesta enlaza la entrada del diario');
  assert.equal(result.activity.persisted, true);
  assert.equal(result.activity.category, 'create');
  assert.equal(result.activity.severity, 'success');
  const state = loadState(root).state;
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].id, result.activity.eventId);
  const page = feed(root);
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0].eventId, result.activity.eventId);
  assert.equal(page.events[0].actor, 'human');
  assert.equal(page.events[0].actorEvidence.channel, 'panel');
});

test('R17 §R6: el reintento con el mismo operationId no escribe ni duplica', () => {
  const root = tempRoot('r17-events-replay');
  const first = create(root, { operationId: 'op-replay' });
  assert.equal(first.ok, true);
  const before = sha(centerFile(root));
  const second = create(root, { operationId: 'op-replay' });
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(second.activity, null, 'un replay no anuncia una entrada nueva');
  assert.equal(sha(centerFile(root)), before, 'el reintento no escribió');
  assert.equal(loadState(root).state.events.length, 1);
});

test('R17 §9/R8: un reintento de create no duplica la skill, no añade evento y no escribe', () => {
  const root = tempRoot('r17-events-request');
  const first = create(root, { requestId: 'req-1' });
  assert.equal(first.ok, true);
  assert.equal(loadState(root).state.events.length, 1);
  const before = sha(centerFile(root));
  const retry = create(root, { requestId: 'req-1' });
  assert.equal(retry.idempotent, undefined, 'el mismo id no se recrea: el resultado es un conflicto honesto');
  assert.equal(retry.ok, false);
  assert.equal(retry.code, 'exists');
  assert.equal(sha(centerFile(root)), before, 'el reintento no escribió');
  assert.equal(loadState(root).state.events.length, 1);
});

test('R17 §2: un bloqueo 409 no escribe y no publica activity', () => {
  const root = tempRoot('r17-events-blocked');
  create(root);
  const before = sha(centerFile(root));
  const blocked = act(root, 'materialize-project', { projectId: 'no-existe', skillId: 'demo-skill' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'preflight-blocked');
  assert.equal(blocked.activity, undefined, 'un bloqueo no devuelve actividad');
  assert.equal(sha(centerFile(root)), before, 'un bloqueo no escribe ni un byte');
  assert.equal(loadState(root).state.events.length, 1);
});

test('R17 §3: el evento sobrevive a la recarga y sólo persiste channel/operationId', () => {
  const root = tempRoot('r17-events-durable');
  const created = create(root, { operationId: 'op-durable' });
  assert.equal(created.ok, true);
  const raw = loadState(root).state.events.at(-1);
  assert.equal(raw.channel, 'panel');
  assert.equal(raw.operationId, 'op-durable');
  // Simula un proceso nuevo: una lectura fresca del documento reconstruye el DTO sin campos guardados.
  const reread = loadState(root).state;
  const feedAfter = buildActivityFeed(reread, null, { limit: 10 });
  assert.equal(feedAfter.events[0].eventId, created.activity.eventId);
  assert.equal(feedAfter.events[0].category, 'create');
  assert.equal(feedAfter.events[0].titleKey, 'activity.title.skill-created');
  assert.equal(feedAfter.events[0].persisted, true);
});

test('R17 §2: un evento de knowledge.json recibe id determinista y una colisión exacta se numera', () => {
  const root = tempRoot('r17-events-knowledge');
  create(root);
  const knowledge = {
    events: [
      { at: '2026-11-09T10:00:00.000Z', type: 'insight-received', detail: 'un detalle privado', skillId: 's1' },
      { at: '2026-11-09T10:00:00.000Z', type: 'insight-received', detail: 'un detalle privado', skillId: 's1' },
    ],
  };
  writeFileSync(knowledgeFile(root), JSON.stringify(knowledge), 'utf8');
  const state = loadState(root).state;
  const page = buildActivityFeed(state, knowledge, { limit: 10 });
  const ids = page.events.map((event) => event.eventId);
  assert.equal(ids.length, 3, 'dos de conocimiento + una del centro');
  const knowledgeIds = ids.filter((id) => id.startsWith('kn-'));
  assert.equal(knowledgeIds.length, 2);
  assert.notEqual(knowledgeIds[0], knowledgeIds[1], 'la colisión exacta no comparte id');
  const first = page.events.find((event) => event.eventId === knowledgeIds[0] || event.eventId === knowledgeIds[1]);
  assert.equal(first.source, 'knowledge.json');
  assert.equal(first.category, 'improvement');
  const serialized = JSON.stringify(page.events);
  assert.doesNotMatch(serialized, /un detalle privado/, 'el detalle libre no se publica');
});

test('R17 §2.1: un cambio externo se publica como «Cambio detectado», nunca como acción de la IA', () => {
  const root = tempRoot('r17-events-external');
  withState(root, (state) => {
    appendEvent(state, { type: 'project.moved', projectId: 'p1' });
    return { ok: true };
  });
  const page = feed(root);
  const moved = page.events.find((event) => event.type === 'project.moved');
  assert.equal(moved.actorEvidence.channel, 'unknown', 'sin canal guardado no se afirma quién lo hizo');
  assert.notEqual(moved.actor, 'agent', 'un cambio detectado nunca es «la IA actualizó»');
  assert.equal(moved.origin, 'reconcile');
  assert.equal(moved.titleKey, 'activity.title.change-detected');
  const knowledgePage = buildActivityFeed(loadState(root).state, {
    events: [{ at: '2026-11-09T10:00:00.000Z', type: 'unknown-type', actor: 'external', detail: 'x' }],
  }, { limit: 10 });
  const external = knowledgePage.events.find((event) => event.source === 'knowledge.json');
  assert.equal(external.actor, 'external', 'un evento externo de knowledge conserva su autoría');
});

test('R17 §1: dos operaciones distintas dejan dos entradas ordenadas y sin colisión de id', () => {
  const root = tempRoot('r17-events-order');
  const first = create(root, { id: 'uno', title: 'Uno', operationId: 'op-uno' });
  const second = create(root, { id: 'dos', title: 'Dos', operationId: 'op-dos' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.activity.eventId, second.activity.eventId);
  const state = loadState(root).state;
  assert.equal(state.events.length, 2);
  const page = buildActivityFeed(state, null, { limit: 10 });
  assert.equal(page.events.length, 2);
  assert.ok(page.events.every((event) => event.actor === 'human'));
  assert.equal(state.operations['op-uno'].kind, 'create');
  assert.equal(state.operations['op-dos'].kind, 'create');
});

test('R17 §D1: una respuesta mutante y el feed no pueden discrepar', () => {
  const root = tempRoot('r17-events-d1');
  const created = create(root, { operationId: 'op-d1' });
  const state = loadState(root).state;
  const projected = activityForResult(state, created.activity.eventId);
  assert.deepEqual(projected, created.activity);
  const fromFeed = buildActivityFeed(state, null, { limit: 1 }).events[0];
  for (const key of ['eventId', 'type', 'category', 'severity', 'titleKey', 'titleVars', 'actor', 'at', 'persisted']) {
    assert.deepEqual(fromFeed[key], created.activity[key], key);
  }
  assert.equal(normalizeEvent({ type: '' }), null);
});
