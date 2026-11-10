import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAction } from '../lib/api.mjs';
import { dismissRequest, fulfillRequest, openRequest, pendingRequests, requestView } from '../lib/requests.mjs';
import { emptyState, loadState, saveState } from '../lib/state.mjs';
import { centerTools } from '../lib/tools.mjs';
import { candidate } from './helpers.mjs';

const NOW = '2026-11-09T02:00:00.000Z';

function withSkill(state, id = 'skill-uno') {
  const created = candidate({
    id,
    title: 'Skill uno',
    description: 'Descripción de la skill uno para pruebas del centro de conocimiento',
    whenToUse: 'Cuando haga falta probar la cola de peticiones del centro de skills',
  });
  state.skills[id] = {
    id,
    title: created.title,
    description: created.description,
    whenToUse: created.whenToUse,
    tags: [],
    status: 'published',
    currentVersion: '1.0.0',
    createdAt: NOW,
    updatedAt: NOW,
    origin: { kind: 'ai', from: '', fromVersion: '', note: '' },
    versions: [
      {
        version: '1.0.0',
        description: created.description,
        whenToUse: created.whenToUse,
        tags: [],
        body: created.body,
        references: {},
        createdAt: NOW,
        checksum: 'abc',
        notes: '',
      },
    ],
  };
}

test('una petición humana queda pendiente y el duplicado no crea ruido', () => {
  const state = emptyState(NOW);
  const first = openRequest(state, { text: '  necesito una skill para desplegar  ' }, { now: NOW });
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.request.text, 'necesito una skill para desplegar');
  assert.equal(first.request.status, 'pending');
  const again = openRequest(state, { text: 'necesito una skill para desplegar' }, { now: '2026-11-09T03:00:00.000Z' });
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(again.id, first.id);
  assert.equal(Object.keys(state.requests).length, 1);
});

test('una petición vacía, larguísima o pedida por la IA no se abre', () => {
  const state = emptyState(NOW);
  assert.equal(openRequest(state, { text: '   ' }, { now: NOW }).code, 'empty-request');
  assert.equal(openRequest(state, { text: 'x'.repeat(2001) }, { now: NOW }).code, 'request-too-long');
  assert.equal(openRequest(state, { text: 'algo' }, { now: NOW, actor: 'ai' }).code, 'approval-required');
  assert.equal(Object.keys(state.requests).length, 0);
});

test('cumplir exige la skill creada y no se hace dos veces', () => {
  const state = emptyState(NOW);
  withSkill(state);
  const opened = openRequest(state, { text: 'necesito skill uno' }, { now: NOW });
  assert.equal(fulfillRequest(state, opened.id, { skillId: 'no-existe' }, { now: NOW }).code, 'missing-skill');
  assert.equal(fulfillRequest(state, opened.id, {}, { now: NOW }).code, 'missing-skill');
  const done = fulfillRequest(state, opened.id, { skillId: 'skill-uno', note: 'creada con evidencia' }, { now: NOW });
  assert.equal(done.ok, true);
  assert.equal(done.request.status, 'fulfilled');
  assert.equal(done.request.skillId, 'skill-uno');
  assert.equal(done.request.by, 'ai');
  assert.equal(fulfillRequest(state, opened.id, { skillId: 'skill-uno' }, { now: NOW }).code, 'settled');
  assert.equal(fulfillRequest(state, 'req-nada', { skillId: 'skill-uno' }, { now: NOW }).code, 'unknown-request');
});

test('descartar es de la persona, no de la IA', () => {
  const state = emptyState(NOW);
  const opened = openRequest(state, { text: 'algo que ya no hace falta' }, { now: NOW });
  assert.equal(dismissRequest(state, opened.id, { now: NOW, actor: 'ai' }).code, 'approval-required');
  const dismissed = dismissRequest(state, opened.id, { now: NOW, actor: 'human' });
  assert.equal(dismissed.ok, true);
  assert.equal(dismissed.request.status, 'dismissed');
});

test('la cola pendiente va de la más antigua a la más nueva y la vista cuenta bien', () => {
  const state = emptyState(NOW);
  withSkill(state);
  const a = openRequest(state, { text: 'primera necesidad' }, { now: '2026-11-09T01:00:00.000Z' });
  const b = openRequest(state, { text: 'segunda necesidad' }, { now: '2026-11-09T02:00:00.000Z' });
  fulfillRequest(state, b.id, { skillId: 'skill-uno' }, { now: NOW });
  assert.deepEqual(pendingRequests(state).map((entry) => entry.id), [a.id]);
  const view = requestView(state);
  assert.equal(view.pending, 1);
  assert.equal(view.total, 2);
  assert.equal(view.items[0].id, a.id);
  const done = view.items.find((entry) => entry.id === b.id);
  assert.equal(done.status, 'fulfilled');
  assert.equal(done.skillTitle, 'Skill uno');
});

test('las peticiones sobreviven a guardar y cargar el documento', () => {
  const root = mkdtempSync(join(tmpdir(), 'lsc-requests-'));
  const state = emptyState(NOW);
  const opened = openRequest(state, { text: 'necesito algo durable' }, { now: NOW });
  saveState(root, state, { now: NOW });
  const loaded = loadState(root);
  assert.equal(loaded.integrity, 'ok');
  assert.equal(loaded.state.requests[opened.id].text, 'necesito algo durable');
  assert.equal(loaded.state.requests[opened.id].status, 'pending');
});

test('la API abre y descarta peticiones; la IA no puede abrirlas', () => {
  const root = mkdtempSync(join(tmpdir(), 'lsc-requests-api-'));
  const cwd = join(tmpdir(), 'proyecto-peticiones');

  const ai = runAction({ root, action: 'request-skill', payload: { text: 'abrir desde la IA' }, actor: 'ai', cwd, now: NOW });
  assert.equal(ai.ok, false);
  assert.equal(ai.code, 'approval-required');

  const opened = runAction({ root, action: 'request-skill', payload: { text: 'una skill que avise del desfase de versión' }, actor: 'human', cwd, now: NOW });
  assert.equal(opened.ok, true);
  const snapshot = runAction({ root, action: 'state', payload: { scan: false }, cwd, now: NOW });
  assert.equal(snapshot.requests.pending, 1);
  assert.equal(snapshot.requests.items[0].id, opened.id);

  const dismissed = runAction({ root, action: 'request-dismiss', payload: { requestId: opened.id }, actor: 'human', cwd, now: NOW });
  assert.equal(dismissed.ok, true);
  const after = runAction({ root, action: 'state', payload: { scan: false }, cwd, now: NOW });
  assert.equal(after.requests.pending, 0);
});

test('la herramienta de estado muestra la cola y crear con requestId la cumple', () => {
  const root = mkdtempSync(join(tmpdir(), 'lsc-requests-tool-'));
  const cwd = join(tmpdir(), 'proyecto-herramienta');
  const exec = { agent: { session: { header: { cwd } } } };
  const tools = centerTools({ root });
  const status = tools.find((tool) => tool.name === 'lifecode_skill_status');
  const create = tools.find((tool) => tool.name === 'lifecode_skill_create');

  const opened = runAction({ root, action: 'request-skill', payload: { text: 'skill pedida desde el panel' }, actor: 'human', cwd, now: NOW });

  const before = status.execute({}, exec);
  assert.equal(before.requests.pending, 1);
  assert.equal(before.requests.items[0].id, opened.id);
  assert.match(before.summary, /1 request\(s\) from a person/);
  // El modelo sólo ve el resumen: si el id y el texto no están ahí, no puede atender la petición.
  assert.match(before.summary, new RegExp(opened.id));
  assert.match(before.summary, /skill pedida desde el panel/);

  const created = create.execute(
    {
      id: 'skill-pedida',
      description: 'Skill creada para cumplir una petición humana hecha desde el panel del centro',
      whenToUse: 'Cuando una persona pide desde el panel una skill concreta y hay que cumplirla',
      body: '## Procedimiento\n\nCrea la skill con evidencia y enlázala con la petición que la persona dejó en el panel del centro. Añade el `requestId` al crear y comprueba después que la cola queda vacía.\n\n## Evidencia\n\nLa petición queda cumplida, enlazada a la skill creada y visible en el panel con su estado.',
      requestId: opened.id,
    },
    exec,
  );
  assert.equal(created.status, 'published');
  assert.equal(created.request, opened.id);

  const after = status.execute({}, exec);
  assert.equal(after.requests.pending, 0);
});

test('un documento con una petición sin texto no se puede escribir', () => {
  const { checkStoreShape } = require_state();
  const raw = {
    schemaVersion: 2,
    skills: {},
    projects: {},
    assignments: {},
    improvements: {},
    events: [],
    requests: { 'req-rota': { text: '', status: 'pending' } },
  };
  const shape = checkStoreShape(raw);
  assert.equal(shape.ok, false);
  assert.match(shape.reason, /requests\.req-rota/);
});

function require_state() {
  return stateModule;
}

import * as stateModule from '../lib/state.mjs';
