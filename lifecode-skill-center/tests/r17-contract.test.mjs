/**
 * R17 — verificación independiente del contrato de actividad (§6, §12, §D1-D4).
 *
 * Todo se ejecuta contra el código real y en cajas temporales. No se lee ni se escribe el almacén real.
 * Estas pruebas son independientes de `tests/r17-api-activity.test.mjs` y `tests/r17-activity.test.mjs`:
 * aquí se comprueba la ruta por el handler real, la atribución por canal, la forma del payload y la
 * compatibilidad de un centro viejo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { API_PREFIX, handleApiRequest } from '../lib/api.mjs';
import { apply } from '../index.js';
import { appendEvent, centerFile, loadState, saveState, withState } from '../lib/state.mjs';
import { decodeActivityCursor, encodeActivityCursor } from '../lib/activity.mjs';
import { knowledgeFile } from '../lib/knowledge.mjs';
import { candidate, tempRoot } from './helpers.mjs';

const NOW = '2026-11-09T19:00:00.000Z';

function sha(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function get(root, search = '') {
  return handleApiRequest({ root, method: 'GET', pathname: `${API_PREFIX}/activity`, search, hostCwd: '', channel: 'browser', now: NOW });
}

function post(root, body) {
  return handleApiRequest({ root, method: 'POST', pathname: API_PREFIX, search: '', body, hostCwd: '', channel: 'browser', now: NOW });
}

function seededRoot(count = 1) {
  const root = tempRoot('r17-contract');
  for (let index = 0; index < count; index += 1) {
    const response = post(root, {
      action: 'create',
      payload: { ...candidate({ id: `skill-${index}`, title: `Skill ${index}` }), operationId: `op-${index}` },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
  return root;
}

/** Contexto mínimo equivalente al adaptador Cordis (mismo contrato que tests/index.test.mjs). */
function fakeContext({ workspaces = [], cwd = '' } = {}) {
  const routes = [];
  const cleanups = [];
  const services = {
    workingDirectory: { get: () => cwd },
    agents: { list: () => [] },
    workspaceRegistry: { list: () => workspaces, get: (id) => workspaces.find((item) => item.id === id) ?? null },
    connection: {
      browserPeer: { id: 'peer-prueba' },
      admit: ({ headers }) => (String(headers?.cookie ?? '') === '' ? { rejection: 401 } : { peer: { id: 'peer-prueba' } }),
    },
  };
  const ctx = {
    get(key) { return services[key]; },
    systemPrompt: { section: () => () => {} },
    tools: { register: () => {} },
    skills: { registerProvider: (callback) => { callback({ invalidate() {} }); return () => {}; } },
    effect(callback) { cleanups.push(callback()); },
    inject(names, callback) {
      assert.deepEqual(names, ['webServer']);
      callback({
        webServer: {
          register(route) { routes.push(route); return () => {}; },
          getOrigin: () => 'http://127.0.0.1:57238',
        },
      });
    },
    workingDirectory: { get: () => cwd },
    logger: { info() {} },
  };
  return { ctx, routes, cleanups };
}

function mounted(root, options = {}) {
  const fake = fakeContext(options);
  apply(fake.ctx, { root, dshHome: join(root, 'dsh-home'), agentsHome: join(root, 'agents-home') });
  const route = fake.routes.find((item) => String(item.path ?? '') === API_PREFIX) ?? fake.routes[0];
  assert.ok(route, 'el adaptador registra la ruta de la API');
  return { route, fake };
}

function dispatch(route, { method = 'GET', url = API_PREFIX, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { cookie: 'dsh-auth-prueba=1', origin: 'http://127.0.0.1:57238' };
    const request = {
      method,
      url,
      headers,
      on(name, handler) {
        if (name === 'data' && body !== null) handler(Buffer.from(JSON.stringify(body)));
        if (name === 'end') setImmediate(handler);
      },
    };
    const response = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(payload) {
        try { resolve({ status: this.statusCode, body: JSON.parse(String(payload)) }); } catch (error) { reject(error); }
      },
    };
    route.handler(request, response, () => resolve({ status: 0, body: null }));
  });
}

test('R17 §6: GET /api/activity por el handler real es sólo lectura y exige GET', async () => {
  const root = seededRoot(2);
  const { route } = mounted(root);
  const before = { sha: sha(centerFile(root)), state: loadState(root).state };
  const first = await dispatch(route, { url: `${API_PREFIX}/activity?limit=1` });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.apiVersion, 1);
  assert.deepEqual(Object.keys(first.body).sort(), ['apiVersion', 'events', 'generatedAt', 'nextBefore', 'ok', 'sources', 'total', 'truncated']);
  assert.equal(first.body.events.length, 1);
  const more = await dispatch(route, { url: `${API_PREFIX}/activity?limit=50` });
  assert.equal(more.status, 200);
  assert.equal(sha(centerFile(root)), before.sha, 'leer actividad no cambia el documento');
  assert.deepEqual(loadState(root).state, before.state);
  const wrong = await dispatch(route, { method: 'POST', url: `${API_PREFIX}/activity`, body: { action: 'create' } });
  assert.equal(wrong.status, 405);
  assert.equal(wrong.body.code, 'method');
});

test('R17 §6: limit, category y before inválidos son 400; center ilegible es 409; knowledge ilegible es 200 parcial', () => {
  const root = seededRoot(1);
  for (const search of ['?limit=0', '?limit=51', '?limit=1.5', '?limit=abc', '?category=otra', '?before=%%%']) {
    const response = get(root, search);
    assert.equal(response.status, 400, `${search} debe ser 400`);
    assert.equal(response.body.code, 'bad-request', search);
    assert.equal(response.body.ok, false, search);
  }
  const invalidCursor = get(root, '?before=bm9wZQ');
  assert.equal(invalidCursor.body.reason, 'invalid-cursor');

  const brokenKnowledge = tempRoot('r17-contract-kn');
  post(brokenKnowledge, { action: 'create', payload: { ...candidate(), operationId: 'op-kn' } });
  writeFileSync(knowledgeFile(brokenKnowledge), '{ esto no es json', 'utf8');
  const partial = get(brokenKnowledge, '');
  assert.equal(partial.status, 200);
  assert.equal(partial.body.sources[0].status, 'ok');
  assert.equal(partial.body.sources[1].status, 'unreadable');
  assert.ok(partial.body.sources[1].reason.length > 0);
  assert.ok(Array.isArray(partial.body.events));

  const broken = tempRoot('r17-contract-broken');
  withState(broken, (state) => { state.events = []; return { ok: true }; });
  writeFileSync(centerFile(broken), '{ roto', 'utf8');
  const unreadable = get(broken, '');
  assert.equal(unreadable.status, 409);
  assert.equal(unreadable.body.code, 'store-unreadable');
  assert.equal(unreadable.body.events, undefined);
});

test('R17 §6/D4: la paginación por cursor no repite ni salta y nextBefore es literal', () => {
  const root = seededRoot(7);
  const seen = [];
  let cursor = '';
  for (let page = 0; page < 10; page += 1) {
    const response = get(root, `?limit=3${cursor === '' ? '' : `&before=${encodeURIComponent(cursor)}`}`);
    assert.equal(response.status, 200);
    if (page === 0) assert.equal(response.body.total, 7);
    for (const event of response.body.events) seen.push(event.eventId);
    if (response.body.nextBefore === null) break;
    assert.equal(typeof response.body.nextBefore, 'string');
    assert.match(response.body.nextBefore, /^[A-Za-z0-9_-]+$/);
    assert.equal(encodeActivityCursor(decodeActivityCursor(response.body.nextBefore)), response.body.nextBefore);
    cursor = response.body.nextBefore;
  }
  assert.equal(new Set(seen).size, seen.length, 'ninguna entrada se repite');
  assert.equal(seen.length, 7, 'ninguna entrada se pierde');
});

test('R17 §2: la atribución sale del canal real; un evento legacy sin evidencia es unknown', () => {
  const root = seededRoot(1);
  const created = get(root, '?limit=1');
  const human = created.body.events[0];
  assert.equal(human.actor, 'human');
  assert.equal(human.actorEvidence.channel, 'panel');
  assert.equal(human.origin, 'panel');

  const run = handleApiRequest({
    root,
    method: 'POST',
    pathname: API_PREFIX,
    body: { action: 'create', payload: { ...candidate({ id: 'skill-ai' }), actorEvidence: { channel: 'tool' } } },
    channel: 'browser',
    now: NOW,
  });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  // El despacho HTTP es siempre humano: el canal de la IA no se puede falsificar desde el cuerpo.
  assert.equal(run.body.activity.actor, 'human');

  const agentRoot = tempRoot('r17-contract-agent');
  withState(agentRoot, (state) => {
    appendEvent(state, { type: 'skill.created', skillId: 'x', actor: 'ai' });
    appendEvent(state, { type: 'project.moved', projectId: 'p1' });
    appendEvent(state, { type: 'skill.version', skillId: 'x', actor: 'persona' });
    state.events.push({ id: 'ev-legacy', at: '2026-11-09T10:00:00.000Z', type: 'skill.version', skillId: 'x', version: '1.0.0' });
    return { ok: true };
  });
  const feed = get(agentRoot, '?limit=10').body.events;
  const agent = feed.find((event) => event.type === 'skill.created');
  assert.equal(agent.actor, 'agent');
  assert.equal(agent.origin, 'tool');
  assert.equal(agent.actorEvidence.channel, 'unknown');
  const legacy = feed.find((event) => event.type === 'project.moved');
  assert.equal(legacy.actor, 'human');
  assert.equal(legacy.actorEvidence.channel, 'unknown', 'sin evidencia de canal no se afirma quién lo hizo');
  assert.equal(legacy.confidence, 'derived');
  assert.equal(legacy.titleKey, 'activity.title.change-detected');
  assert.notEqual(legacy.actor, 'agent', 'un cambio detectado nunca se atribuye a la IA');
  const persona = feed.find((event) => event.type === 'skill.version' && event.skillId === 'x' && event.actor !== 'unknown');
  assert.equal(persona.actor, 'human');
  const rawLegacy = feed.find((event) => event.eventId === 'ev-legacy');
  assert.equal(rawLegacy.actorEvidence.channel, 'unknown', 'sin evidencia de canal queda unknown');
  assert.notEqual(rawLegacy.actor, 'agent', 'nunca se atribuye a la IA sin evidencia');
  assert.equal(rawLegacy.confidence, 'derived');
});

test('R17 §12: el payload no publica cuerpos, notas ni secretos y respeta ~40 KB', () => {
  const root = tempRoot('r17-contract-payload');
  const secret = 'SECRETO-QUE-NO-SE-PUBLICA-123';
  for (let index = 0; index < 60; index += 1) {
    withState(root, (state) => {
      appendEvent(state, { type: 'skill.version', skillId: `s-${index}`, version: '1.0.0', note: `${secret} ${'x'.repeat(400)}` });
      return { ok: true };
    });
  }
  const response = get(root, '?limit=50');
  assert.equal(response.status, 200);
  assert.ok(response.body.events.length <= 50);
  const serialized = JSON.stringify(response.body);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= 40 * 1024, `payload ${Buffer.byteLength(serialized)} B`);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, /x{200}/);
  for (const event of response.body.events) {
    assert.equal(event.body, undefined);
    assert.equal(event.note, undefined);
    assert.equal(event.detail, undefined);
    assert.ok(!Object.hasOwn(event, 'path'));
  }
});

test('R17 §3: un centro viejo sin eventos abre sin migración y guarda el estado normalizado', () => {
  const root = tempRoot('r17-contract-legacy');
  const created = loadState(root);
  saveState(root, created.state, { now: NOW });
  const document = JSON.parse(readFileSync(centerFile(root), 'utf8'));
  document.events = [{ id: 'ev-viejo', at: '2026-01-01T00:00:00.000Z', type: 'skill.created', skillId: 'vieja' }];
  writeFileSync(centerFile(root), JSON.stringify(document), 'utf8');
  const before = sha(centerFile(root));
  const response = get(root, '');
  assert.equal(response.status, 200);
  assert.equal(response.body.events.length, 1, 'un evento viejo del centro se sirve');
  assert.equal(response.body.events[0].eventId, 'ev-viejo');
  assert.equal(response.body.events[0].actorEvidence.channel, 'unknown', 'sin channel no se inventa el canal');
  assert.equal(sha(centerFile(root)), before, 'la lectura no migra ni escribe');
  const loaded = loadState(root);
  assert.equal(loaded.integrity, 'ok');
  assert.equal(loaded.state.events.length, 1);
  assert.equal(loaded.state.events[0].channel, undefined, 'la lectura no añade el campo channel');
  assert.equal(loaded.state.schemaVersion, 2);
  saveState(root, loaded.state, { now: NOW });
  const after = loadState(root);
  assert.equal(after.state.schemaVersion, 2);
  assert.equal(after.state.events[0].id, 'ev-viejo', 'el evento viejo hace round-trip sin perder su id');
  assert.equal(after.state.events[0].channel, undefined);
});

test('R17 §3/R2: sólo channel y operationId son durables; el DTO se deriva al leer', () => {
  const root = tempRoot('r17-contract-durable');
  post(root, { action: 'create', payload: { ...candidate({ id: 'durable' }), operationId: 'op-durable' } });
  const state = loadState(root).state;
  const raw = state.events.at(-1);
  assert.equal(raw.channel, 'panel');
  assert.equal(raw.operationId, 'op-durable');
  for (const derived of ['category', 'severity', 'titleKey', 'titleVars', 'origin', 'confidence', 'persisted', 'correlationId']) {
    assert.equal(Object.hasOwn(raw, derived), false, `${derived} no se persiste`);
  }
  assert.ok(state.operations['op-durable'], 'el recibo de la operación sobrevive');
});
