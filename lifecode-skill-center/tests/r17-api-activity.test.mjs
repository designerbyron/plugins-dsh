/**
 * R17 — `GET /api/activity` y `activity` en las respuestas mutantes (contrato §6-§7, §R6-R10).
 *
 * Todo ocurre en cajas temporales; nunca se lee ni se escribe el almacén real.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

import { API_PREFIX, activityPayload, handleApiRequest } from '../lib/api.mjs';
import { appendEvent, centerFile, loadState, withState } from '../lib/state.mjs';
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
  return handleApiRequest({ root, method: 'POST', pathname: `${API_PREFIX}`, search: '', body, hostCwd: '', channel: 'browser', now: NOW });
}

function createdRoot() {
  const root = tempRoot('r17-api');
  const result = post(root, { action: 'create', payload: { ...candidate(), operationId: 'op-create' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { root, result };
}

test('GET /api/activity responde con las claves del contrato y sin escribir', () => {
  const { root } = createdRoot();
  const center = centerFile(root);
  const knowledge = knowledgeFile(root);
  const beforeCenter = { sha: sha(center), mtime: statSync(center).mtimeMs };
  const knowledgeExists = existsSync(knowledge);
  const beforeKnowledge = knowledgeExists ? { sha: sha(knowledge), mtime: statSync(knowledge).mtimeMs } : null;
  const first = get(root, '?limit=10');
  assert.equal(first.status, 200);
  assert.deepEqual(Object.keys(first.body).sort(), [
    'apiVersion', 'events', 'generatedAt', 'nextBefore', 'ok', 'sources', 'total', 'truncated',
  ]);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.apiVersion, 1);
  assert.deepEqual(first.body.sources.map((row) => row.id), ['center', 'knowledge']);
  assert.equal(first.body.sources[0].status, 'ok');
  assert.ok(first.body.events.length >= 1);
  assert.equal(first.body.total, first.body.events.length);
  assert.equal(first.body.truncated, false);
  // Tres lecturas más y ni un byte ni un mtime cambian.
  get(root, '?limit=5');
  get(root, '?category=create');
  get(root, '');
  assert.equal(sha(center), beforeCenter.sha);
  assert.equal(statSync(center).mtimeMs, beforeCenter.mtime);
  if (beforeKnowledge !== null) {
    assert.equal(sha(knowledge), beforeKnowledge.sha);
    assert.equal(statSync(knowledge).mtimeMs, beforeKnowledge.mtime);
  }
  // HEAD usa el mismo despacho de lectura.
  const head = handleApiRequest({ root, method: 'HEAD', pathname: `${API_PREFIX}/activity`, search: '', hostCwd: '', channel: 'browser', now: NOW });
  assert.equal(head.status, 200);
});

test('limit, before y category inválidos son 400 con razón, y POST es 405', () => {
  const { root } = createdRoot();
  for (const search of ['?limit=0', '?limit=51', '?limit=abc', '?limit=1.5']) {
    const bad = get(root, search);
    assert.equal(bad.status, 400, search);
    assert.equal(bad.body.code, 'bad-request');
    assert.equal(bad.body.reason, 'invalid-limit');
  }
  for (const search of ['?before=no-es-cursor', '?before=' + Buffer.from('sin-fecha|ev-1', 'utf8').toString('base64url')]) {
    const bad = get(root, search);
    assert.equal(bad.status, 400, search);
    assert.equal(bad.body.reason, 'invalid-cursor');
  }
  const badCategory = get(root, '?category=inventada');
  assert.equal(badCategory.status, 400);
  assert.equal(badCategory.body.reason, 'invalid-category');
  const postResult = handleApiRequest({ root, method: 'POST', pathname: `${API_PREFIX}/activity`, search: '', body: { action: 'activity' }, hostCwd: '', channel: 'browser', now: NOW });
  assert.equal(postResult.status, 405);
  assert.equal(postResult.body.code, 'method');
  assert.equal(postResult.body.message, 'usa GET para la actividad');
});

test('un center.json ilegible es 409 y no publica nada', () => {
  const root = tempRoot('r17-broken');
  writeFileSync(centerFile(root), '{ esto no es json');
  const response = get(root);
  assert.equal(response.status, 409);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'store-unreadable');
  assert.match(response.body.message, /no se publica actividad sobre datos dudosos/);
});

test('knowledge.json ilegible se declara en sources sin ocultar el diario del centro', () => {
  const { root } = createdRoot();
  writeFileSync(knowledgeFile(root), '{ roto');
  const response = get(root);
  assert.equal(response.status, 200);
  assert.equal(response.body.sources[0].status, 'ok');
  assert.equal(response.body.sources[1].id, 'knowledge');
  assert.equal(response.body.sources[1].status, 'unreadable');
  assert.ok(typeof response.body.sources[1].reason === 'string' && response.body.sources[1].reason !== '');
  assert.ok(response.body.events.some((entry) => entry.source === 'center.json'));
  assert.ok(response.body.events.every((entry) => entry.source !== 'knowledge.json'));
});

test('la mutación devuelve activity y replayed:false, sin notas ni cuerpos', () => {
  const { root, result } = createdRoot();
  assert.equal(result.body.activity.category, 'create');
  assert.equal(result.body.activity.severity, 'success');
  assert.equal(result.body.activity.titleKey, 'activity.title.skill-created');
  assert.equal(result.body.activity.persisted, true);
  assert.equal(result.body.activity.actor, 'human');
  const projectionKeys = Object.keys(result.body.activity).sort();
  assert.deepEqual(projectionKeys, ['actor', 'at', 'category', 'eventId', 'persisted', 'severity', 'titleKey', 'titleVars', 'type']);
  // El evento del centro guarda el canal y la operación, no la nota libre.
  const stored = loadState(root).state.events.find((event) => event.type === 'skill.created');
  assert.equal(stored.channel, 'panel');
  assert.equal(stored.operationId, 'op-create');
  const body = JSON.stringify(result.body.activity);
  assert.equal(body.includes('api_key'), false);
  assert.equal(body.includes('C:'), false);
  assert.equal(body.includes('references/'), false);
});

test('replay con el mismo operationId: una sola entrada y sin segunda escritura', () => {
  const root = tempRoot('r17-replay');
  const payload = { ...candidate(), operationId: 'op-replay' };
  const first = post(root, { action: 'create', payload });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.replayed, false);
  assert.ok(first.body.activity !== null);
  const afterFirst = sha(centerFile(root));
  const second = post(root, { action: 'create', payload });
  assert.equal(second.status, 200);
  assert.equal(second.body.ok, true);
  assert.equal(second.body.replayed, true);
  assert.equal(second.body.activity, null);
  assert.equal(sha(centerFile(root)), afterFirst);
  const journal = loadState(root).state.events.filter((event) => event.type === 'skill.created');
  assert.equal(journal.length, 1);
});

test('una acción bloqueada no deja evento ni activity', () => {
  const root = tempRoot('r17-blocked');
  const before = (() => {
    post(root, { action: 'create', payload: { ...candidate(), operationId: 'op-ok' } });
    return sha(centerFile(root));
  })();
  const blocked = post(root, { action: 'create', payload: { ...candidate({ description: 'corta' }), operationId: 'op-blocked' } });
  assert.equal(blocked.body.ok, false);
  assert.equal('activity' in blocked.body, false);
  assert.equal(sha(centerFile(root)), before);
});

test('las mutaciones sin evento devuelven activity:null (R8)', () => {
  const { root } = createdRoot();
  // Habilitar dos veces la misma asignación: la segunda no cambia el documento y no hay evento.
  const project = post(root, { action: 'register-project', payload: { cwd: 'C:/proyectos/actividad', projectId: 'actividad-1' } });
  assert.equal(project.body.ok, true);
  const skills = loadState(root).state.skills;
  const skillId = Object.keys(skills)[0];
  const projectId = project.body.project.id;
  const assign = post(root, { action: 'toggle', payload: { projectId, skillId, enabled: true, operationId: 'op-toggle-1' } });
  assert.equal(assign.body.ok, true);
  assert.ok(assign.body.activity !== null);
  const again = post(root, { action: 'toggle', payload: { projectId, skillId, enabled: true, operationId: 'op-toggle-2' } });
  assert.equal(again.body.ok, true);
  assert.equal(again.body.activity, null);
  assert.equal(again.body.replayed, false);
});

test('el feed limita a 50 filas y ~40 KB con un diario grande', () => {
  const root = tempRoot('r17-big');
  withState(root, (state) => {
    for (let index = 0; index < 120; index += 1) {
      appendEvent(state, {
        type: index % 2 === 0 ? 'skill.created' : 'skill.version',
        skillId: `skill-${index}`,
        version: '1.0.0',
        actor: index % 3 === 0 ? 'ai' : 'human',
        at: new Date(Date.parse(NOW) + index * 1000).toISOString(),
        note: 'x'.repeat(200),
      });
    }
    return { ok: true };
  }, { now: NOW });
  const response = get(root, '?limit=50');
  assert.equal(response.status, 200);
  assert.equal(response.body.events.length, 50);
  assert.equal(response.body.total, 120);
  assert.equal(response.body.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(response.body), 'utf8') <= 40 * 1024, 'payload menor de 40 KB');
  assert.ok(typeof response.body.nextBefore === 'string' && response.body.nextBefore !== '');
  // Recorrer sin huecos ni repetidos.
  const seen = new Set();
  let before = null;
  for (let page = 0; page < 10; page += 1) {
    const chunk = get(root, `?limit=50${before === null ? '' : `&before=${encodeURIComponent(before)}`}`);
    for (const entry of chunk.body.events) {
      assert.equal(seen.has(entry.eventId), false);
      seen.add(entry.eventId);
    }
    before = chunk.body.nextBefore;
    if (before === null) break;
  }
  assert.equal(seen.size, 120);
  // El payload no publica la nota libre que se guardó en el evento.
  assert.equal(JSON.stringify(response.body).includes('xxxxx'), false);
});

test('default de límite y filtro por categoría', () => {
  const root = tempRoot('r17-default');
  withState(root, (state) => {
    for (let index = 0; index < 25; index += 1) {
      appendEvent(state, { type: index % 2 === 0 ? 'skill.created' : 'skill.rollback', skillId: `s-${index}`, actor: 'human', at: new Date(Date.parse(NOW) + index * 1000).toISOString() });
    }
    return { ok: true };
  }, { now: NOW });
  const page = get(root);
  assert.equal(page.body.events.length, 20);
  assert.equal(page.body.truncated, true);
  const alerts = get(root, '?category=alert&limit=50');
  assert.equal(alerts.status, 200);
  assert.equal(alerts.body.total, 12);
  assert.ok(alerts.body.events.every((entry) => entry.category === 'alert'));
});

test('la ruta de import-bundle conserva su compuerta (confirmed obligatorio) y no anuncia actividad', () => {
  const { root } = createdRoot();
  const before = sha(centerFile(root));
  const missing = post(root, { action: 'import-bundle', payload: { bundle: '{}' } });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'confirmation-required');
  assert.equal(sha(centerFile(root)), before);
});
