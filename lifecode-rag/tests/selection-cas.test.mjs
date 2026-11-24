/**
 * CR-1 · Selección de proyecto con compare-and-swap.
 *
 * Qué se demuestra: la selección se persiste en el registro del perfil con una revisión monotónica,
 * se rechaza lo obsoleto con 409, dos clientes no pueden pisarse, el cambio sobrevive al cierre de
 * sesión y al reinicio del proceso, y cada escritura confirmada deja su entrada de auditoría.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorld } from './pa3-helpers.mjs';
import { createPaHandler, PA_PREFIX } from '../lib/pa-api.mjs';
import { openRegistry, closeRegistry, verifyRegistryAudit } from '../lib/registry.mjs';
import { expireSession } from '../lib/sessions.mjs';

/**
 * P-UX22-01: `/pa/selection` es una mutación humana y exige el testigo CSRF del panel más
 * `content-type: application/json`; el doble lleva ambas por defecto, como `client.js`. El caso
 * «sin cabecera → 403 y sin escribir» se prueba en `pa-api.test.mjs`.
 */
const CSRF_HEADERS = Object.freeze({ 'x-lifecode-rag': '1', 'content-type': 'application/json' });

function reqRes(url, { method = 'GET', body } = {}) {
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b; },
  };
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = {
    url: PA_PREFIX + url,
    method,
    headers: { ...CSRF_HEADERS },
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload, 'utf8');
    },
  };
  return { req, res };
}

async function call(handler, url, options) {
  const { req, res } = reqRes(url, options);
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') };
}

const authed = async () => ({ ok: true, peer: { id: 'peer-panel', principal: { kind: 'owner' } } });

function handlerFor(world) {
  return createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize: authed });
}

function selectionOf(world) {
  const opened = openRegistry({ root: world.root, create: false });
  try {
    const row = opened.db.prepare(`SELECT project_id, revision, selection_source, selected_by, principal
      FROM pa_selection WHERE selection_key='profile'`).get();
    const audit = verifyRegistryAudit(opened.db);
    const entries = opened.db.prepare(`SELECT action, target, outcome FROM audit_registry
      WHERE action LIKE 'selection.%' ORDER BY seq`).all();
    return { row: row ?? null, audit, entries };
  } finally { closeRegistry(opened.db); }
}

test('CR-1: selección válida crea la revisión 1 y queda auditada', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    const before = selectionOf(world);
    assert.equal(before.row, null, 'el mundo de prueba empieza sin selección de panel');

    const response = await call(handler, '/selection', {
      method: 'POST', body: { projectId: world.projectA.id, expectedRevision: 0 },
    });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json.data.changed, true);
    assert.equal(response.json.data.selection.projectId, world.projectA.id);
    assert.equal(response.json.data.selection.revision, 1);
    assert.equal(response.json.data.selection.selectedBy, 'human');
    assert.equal(response.json.data.selection.principal, 'owner');
    assert.equal(response.json.data.project.name, 'Proyecto A');

    const after = selectionOf(world);
    assert.equal(after.row.revision, 1);
    assert.equal(after.audit.ok, true, 'la cadena de auditoría del registro sigue verificando');
    assert.deepEqual(after.entries.map((e) => e.action), ['selection.select']);
  } finally { world.cleanup(); }
});

test('CR-1: una revisión obsoleta se rechaza con 409 y no escribe nada', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    await call(handler, '/selection', { method: 'POST', body: { projectId: world.projectA.id, expectedRevision: 0 } });

    const stale = await call(handler, '/selection', {
      method: 'POST', body: { projectId: world.projectB.id, expectedRevision: 0 },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, 'revision-conflict');
    assert.deepEqual(stale.json.error.details.current, { projectId: world.projectA.id, projectName: 'Proyecto A', revision: 1 });
    assert.equal(stale.json.error.details.expectedRevision, 0);

    const state = selectionOf(world);
    assert.equal(state.row.project_id, world.projectA.id, 'el perdedor no cambia la selección');
    assert.equal(state.row.revision, 1);
    assert.equal(state.entries.length, 1, 'un conflicto no genera entrada de selección');
  } finally { world.cleanup(); }
});

test('CR-1: dos clientes con la misma revisión — uno confirma, el otro recibe el estado vigente', async () => {
  const world = await makeWorld();
  try {
    const panelA = handlerFor(world);
    const panelB = handlerFor(world);
    await call(panelA, '/selection', { method: 'POST', body: { projectId: world.projectA.id, expectedRevision: 0 } });

    const [left, right] = await Promise.all([
      call(panelA, '/selection', { method: 'POST', body: { projectId: world.projectB.id, expectedRevision: 1 } }),
      call(panelB, '/selection', { method: 'POST', body: { projectId: world.projectA.id, expectedRevision: 1 } }),
    ]);
    const statuses = [left.status, right.status].sort();
    assert.deepEqual(statuses, [200, 409], 'exactamente uno gana; el otro no pisa el cambio ajeno');

    const winner = left.status === 200 ? left : right;
    assert.equal(winner.json.data.selection.revision, 2);
    const state = selectionOf(world);
    assert.equal(state.row.revision, 2, 'la revisión avanza una sola vez');
    assert.equal(state.row.project_id, winner.json.data.selection.projectId);
    assert.equal(state.audit.ok, true);
  } finally { world.cleanup(); }
});

test('CR-1: petición duplicada — el mismo proyecto y la revisión vigente no crean revisión nueva', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    await call(handler, '/selection', { method: 'POST', body: { projectId: world.projectA.id, expectedRevision: 0 } });

    const duplicate = await call(handler, '/selection', {
      method: 'POST', body: { projectId: world.projectA.id, expectedRevision: 1 },
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.json.data.changed, false, 'un clic repetido no inventa una revisión');
    assert.equal(duplicate.json.data.selection.revision, 1);

    // Reenviar la petición original (revisión ya consumida) sí es un conflicto, no un segundo cambio.
    const replay = await call(handler, '/selection', {
      method: 'POST', body: { projectId: world.projectA.id, expectedRevision: 0 },
    });
    assert.equal(replay.status, 409);
    assert.equal(selectionOf(world).row.revision, 1);
  } finally { world.cleanup(); }
});

test('CR-1: sin revisión o con revisión inválida se responde 400 y no se escribe', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    for (const body of [
      { project: world.projectA.id },
      { projectId: world.projectA.id, expectedRevision: -1 },
      { projectId: world.projectA.id, expectedRevision: 1.5 },
      { projectId: world.projectA.id, expectedRevision: '1' },
      { expectedRevision: 0 },
      { projectId: 'nope', expectedRevision: 0 },
      { projectId: world.projectA.id, expectedRevision: 0, extra: true },
    ]) {
      const response = await call(handler, '/selection', { method: 'POST', body });
      assert.equal(response.status, 400, `debe rechazarse: ${JSON.stringify(body)}`);
      assert.equal(response.json.error.code, 'invalid-argument');
    }
    assert.equal(selectionOf(world).row, null, 'ninguna petición inválida deja selección');
  } finally { world.cleanup(); }
});

test('CR-1: proyecto inexistente o de otro perfil se rechaza con 403', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    const foreign = await call(handler, '/selection', {
      method: 'POST', body: { projectId: 'prj_01M7TRDQYRAPJR03QTM3PP6PX2', expectedRevision: 0 },
    });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.json.error.code, 'project-not-authorized');
    assert.equal(selectionOf(world).row, null);

    // Y el acceso cruzado por lectura tampoco se cuela pidiendo otro proyecto.
    const read = await call(handler, '/snapshot?project=prj_01M7TRDQYRAPJR03QTM3PP6PX2');
    assert.equal(read.status, 403);
    assert.equal(read.json.error.code, 'project-not-authorized');
  } finally { world.cleanup(); }
});

test('CR-1: la selección sobrevive al cierre de las sesiones y al reinicio del proceso', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    await call(handler, '/selection', { method: 'POST', body: { projectId: world.projectB.id, expectedRevision: 0 } });

    // Cierre de sesión: no es la selección de una conversación, así que caducar sesiones no la borra.
    world.withRegistry((db) => {
      for (const sessionId of ['sesion-a', 'sesion-b']) {
        expireSession(db, { identity: { sessionId, profileKey: 'pa3-test' }, expectedProfileKey: 'pa3-test' });
      }
    });
    const afterExpiry = selectionOf(world);
    assert.equal(afterExpiry.row.project_id, world.projectB.id, 'la selección del panel no depende de una sesión');

    // Reinicio: un handler nuevo (otra conexión al registro) ve la misma revisión y resuelve el
    // proyecto por defecto con ella, sin repetir `?project=`.
    const restarted = handlerFor(world);
    const snapshot = await call(restarted, '/snapshot');
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.json.data.project.id, world.projectB.id, 'el snapshot usa la selección persistida');
    assert.equal(snapshot.json.data.selection.revision, 1);
    assert.equal(snapshot.json.data.selection.projectId, world.projectB.id);

    const next = await call(restarted, '/selection', {
      method: 'POST', body: { projectId: world.projectA.id, expectedRevision: 1 },
    });
    assert.equal(next.status, 200, 'tras el reinicio la revisión sigue siendo la vigente');
    assert.equal(next.json.data.selection.revision, 2);
  } finally { world.cleanup(); }
});

test('CR-1/F-1: con dos proyectos y sin selección el snapshot no elige uno — pide la decisión (200 + needsProjectSelection)', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    const snapshot = await call(handler, '/snapshot');
    // 1.5.11 (F-1): la ambigüedad ya no es un 403 que el panel leía como «sin conexión». La regla que
    // importa sigue intacta: NO se elige ninguno en silencio.
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.json.data.needsProjectSelection, true);
    assert.equal(snapshot.json.data.project, null, 'ninguno elegido');
    assert.deepEqual(
      snapshot.json.data.candidates.map((row) => row.id).sort(),
      [world.projectA.id, world.projectB.id].sort(),
    );
    // Y ninguna ruta de contenido se resuelve sola por detrás.
    const search = await call(handler, '/search', { method: 'POST', body: { query: 'alfa' } });
    assert.equal(search.status, 403);
    assert.equal((await call(handler, '/history')).status, 403);
  } finally { world.cleanup(); }
});
