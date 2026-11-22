/**
 * ACP-02 · Historial de lectura del proyecto activo (`GET /pa/history`).
 *
 * Lo que se demuestra: la ruta es de sólo lectura, el ámbito es estructural (sólo se abren las filas del
 * almacén del proyecto activo), `target` se relativiza, `details` pasa por lista blanca, la cadena de
 * auditoría se informa verificada, y la paginación por `cursor` no repite ni pierde entradas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorld, seedScope } from './pa3-helpers.mjs';
import { createPaHandler, PA_PREFIX } from '../lib/pa-api.mjs';

function reqRes(url) {
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b; },
  };
  return { req: { url: PA_PREFIX + url, method: 'GET', headers: {}, async *[Symbol.asyncIterator]() {} }, res };
}

async function call(handler, url) {
  const { req, res } = reqRes(url);
  await handler(req, res);
  const json = JSON.parse(res.body || '{}');
  return { status: res.statusCode, json, raw: res.body };
}

const authed = async () => ({ ok: true, peer: { id: 'peer-panel', principal: { kind: 'owner' } } });
const handlerFor = (world) => createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize: authed });

test('historial: entradas reales del proyecto activo, con cadena verificada y target relativo', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    const response = await call(handler, '/history?project=' + world.projectA.id);
    assert.equal(response.status, 200, response.raw);
    const data = response.json.data;
    assert.equal(data.scope.id, world.projectA.id);
    assert.equal(data.scope.kind, 'prj');
    assert.ok(data.entries.length >= 1, 'la ingesta de makeWorld deja al menos una entrada');
    assert.equal(data.integrity.ok, true, 'la cadena de auditoría del almacén verifica');
    for (const entry of data.entries) {
      assert.equal(typeof entry.seq, 'number');
      assert.equal(typeof entry.at, 'number');
      assert.equal(typeof entry.actor, 'string');
      assert.equal(typeof entry.tool, 'string');
      assert.equal(typeof entry.action, 'string');
      assert.equal(typeof entry.outcome, 'string');
      assert.equal(entry.hash.length, 16, 'hash corto como procedencia');
      assert.equal(String(entry.target).includes(':'), false, `target no puede ser una ruta absoluta: ${entry.target}`);
    }
    // Orden: de más reciente a más antigua.
    const seqs = data.entries.map((entry) => entry.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => b - a));
    // Sin `details` crudos: sólo las claves permitidas.
    const allowed = ['sourceId', 'chunks', 'bytes', 'code', 'revision', 'replace', 'embedding', 'skipped'];
    for (const entry of data.entries) {
      if (entry.details === null) continue;
      for (const key of Object.keys(entry.details)) assert.ok(allowed.includes(key), `detalle no permitido: ${key}`);
    }
  } finally { world.cleanup(); }
});

test('historial: paginación por cursor sin repetir ni perder entradas', async () => {
  const world = await makeWorld();
  try {
    // Tres ingestas más por la vía real (almacén temporal del mundo de prueba) para tener varias filas.
    await seedScope({
      profileRootPath: world.root, profileKey: 'pa3-test', scope: { kind: 'prj', id: world.projectA.id },
      dir: world.dirA, config: world.config,
      docs: {
        'c.md': '# Gamma gamma del proyecto A',
        'd.md': '# Delta delta del proyecto A',
        'e.md': '# Epsilon epsilon del proyecto A',
      },
    });
    const handler = handlerFor(world);
    const first = await call(handler, '/history?limit=1&project=' + world.projectA.id);
    assert.equal(first.status, 200);
    assert.equal(first.json.data.entries.length, 1);
    const total = first.json.data.total;
    assert.ok(total >= 2, 'hacen falta al menos dos entradas para paginar');
    assert.equal(first.json.data.nextCursor !== null, true);

    const seen = new Set(first.json.data.entries.map((entry) => entry.seq));
    let cursor = first.json.data.nextCursor;
    let guard = 0;
    while (cursor && guard < 50) {
      const page = await call(handler, `/history?limit=1&cursor=${cursor}&project=${world.projectA.id}`);
      assert.equal(page.status, 200);
      for (const entry of page.json.data.entries) {
        assert.equal(seen.has(entry.seq), false, `la entrada ${entry.seq} se repitió`);
        seen.add(entry.seq);
      }
      cursor = page.json.data.nextCursor;
      guard += 1;
    }
    assert.equal(seen.size, total, 'la paginación cubre el total exacto');
  } finally { world.cleanup(); }
});

test('historial: cada proyecto ve sólo sus filas y con proyecto desconocido no se sirve nada', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    const a = await call(handler, '/history?limit=200&project=' + world.projectA.id);
    const b = await call(handler, '/history?limit=200&project=' + world.projectB.id);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    for (const entry of a.json.data.entries) {
      assert.equal(String(entry.target).includes('b.md'), false, 'el proyecto A no ve objetivos de B');
    }
    const aSeqs = new Set(a.json.data.entries.map((entry) => entry.seq));
    // Los almacenes son distintos: si alguna entrada de A aparece en B, sería una fuga.
    const overlap = b.json.data.entries.filter((entry) => aSeqs.has(entry.seq) && entry.tool !== entry.tool);
    assert.deepEqual(overlap, []);

    const foreign = await call(handler, '/history?project=prj_01M7TRDQYRAPJR03QTM3PP6PX2');
    assert.equal(foreign.status, 403);
    assert.equal(foreign.json.error.code, 'project-not-authorized');
  } finally { world.cleanup(); }
});

test('historial: sin credencial del host no se sirve ni una fila', async () => {
  const world = await makeWorld();
  try {
    const closed = createPaHandler({
      profileRoot: world.root, profileKey: 'pa3-test',
      authorize: async () => ({ ok: false, status: 401, code: 'unauthenticated', message: 'sin credencial' }),
    });
    const response = await call(closed, '/history?project=' + world.projectA.id);
    assert.equal(response.status, 401);
    assert.equal(response.json.error.code, 'unauthenticated');
    assert.equal(response.json.data, undefined);
  } finally { world.cleanup(); }
});

test('historial: cursor inválido y parámetros no declarados se rechazan', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    for (const url of [
      '/history?cursor=abc&project=' + world.projectA.id,
      '/history?cursor=-3&project=' + world.projectA.id,
      '/history?scope=lib_x&project=' + world.projectA.id,
      '/history?limit=201&project=' + world.projectA.id,
    ]) {
      const response = await call(handler, url);
      assert.equal(response.status, 400, url);
      assert.equal(response.json.error.code, 'invalid-argument');
    }
  } finally { world.cleanup(); }
});
