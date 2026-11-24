/**
 * El adaptador Cordis no se puede cargar fuera del host, pero sí se puede ejercitar con un `ctx`
 * mínimo: comprueba que registra las siete herramientas, la ruta HTTP y arranca/para la automatización
 * sin tocar el perfil ni el almacén real.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject, name } from '../index.js';
import { API_PREFIX } from '../lib/server.mjs';
import { PA_PREFIX } from '../lib/pa-api.mjs';
import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { profileRoot } from '../lib/profile.mjs';
import { closeRegistry, openRegistry } from '../lib/registry.mjs';
import { tempRoot } from './helpers.mjs';

test('registra herramientas, API y automatización con un ctx mínimo', () => {
  const box = tempRoot('rag-adapter');
  const previous = process.env.LIFECODE_RAG_ROOT;
  process.env.LIFECODE_RAG_ROOT = box.root;
  // La API y la automatización v0.2 sólo existen donde ya hay almacén legado: se crea uno temporal
  // (nunca el real) para ejercitar las tres piezas del adaptador.
  const legacy = openDatabase({ root: box.root, create: true });
  closeDatabase(legacy.db);
  try {
    const tools = [];
    const routes = [];
    const cleanups = [];
    const ctx = {
      get: (service) => (service === 'webServer' ? { register: (route) => { routes.push(route); return () => { route.disposed = true; }; } } : undefined),
      tools: { register: (definition) => { tools.push(definition); } },
      effect: (factory) => { const dispose = factory(); cleanups.push(dispose); },
    };

    apply(ctx);

    assert.equal(name, 'lifecode-rag');
    // PA01: `connection` es la compuerta de autenticación. El cargador del host no aplica la forma
    // `{required, optional}`, así que va en la lista; sin ella el plugin no carga (no se abre nada).
    assert.deepEqual(inject, ['tools', 'webServer', 'connection']);
    assert.equal(tools.length, 7);
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'lifecode_rag_context',
      'lifecode_rag_forget',
      'lifecode_rag_get',
      'lifecode_rag_ingest',
      'lifecode_rag_list',
      'lifecode_rag_reindex',
      'lifecode_rag_search',
    ]);
    assert.equal(routes.length, 2, 'API PA (siempre) + API heredada (con almacén legacy)');
    const paths = routes.map((r) => r.path).sort();
    assert.deepEqual(paths, [API_PREFIX, PA_PREFIX].sort());
    for (const route of routes) {
      assert.equal(route.kind, 'prefix');
      assert.equal(typeof route.handler, 'function');
    }
    assert.equal(cleanups.length, 4, 'PA + API + sincronización + automatización');
    for (const dispose of cleanups) dispose();
    for (const route of routes) assert.equal(route.disposed, true);
  } finally {
    if (previous === undefined) delete process.env.LIFECODE_RAG_ROOT;
    else process.env.LIFECODE_RAG_ROOT = previous;
    box.cleanup();
  }
});

/**
 * UX-2.1 · el adaptador ENTREGA las fuentes del Host a la API.
 *
 * Es el eslabón que ninguna prueba del motor detecta: si `index.js` construye `createPaHandler` sin
 * `services`, el registro de workspaces existe y la ruta responde `source:'none'` para siempre. Esta
 * prueba monta `apply(ctx)` con los servicios del Host y llama a la ruta REAL registrada, así que
 * falla si alguien vuelve a construir el handler sin pasarlos.
 */
test('UX-2.1: la ruta /pa/workspaces recibe el registro de workspaces y las sesiones del host', async () => {
  const box = tempRoot('rag-adapter-ws');
  const previous = process.env.LIFECODE_RAG_ROOT;
  process.env.LIFECODE_RAG_ROOT = box.root;
  const profile = profileRoot(process.env);
  const opened = openRegistry({ root: profile, create: true });
  closeRegistry(opened.db);
  try {
    const routes = [];
    const cleanups = [];
    const inventory = [{
      id: 'ws_1',
      path: box.root,
      title: 'caja del adaptador',
      sessionIds: ['s1', 's2'],
      status: async () => 'ok',
    }];
    const provided = {
      webServer: { register: (route) => { routes.push(route); return () => { route.disposed = true; }; } },
      connection: {
        requestRejection: async () => null,
        admit: async () => ({ peer: { id: 'peer', principal: { kind: 'owner' } } }),
      },
      workspaceRegistry: {
        list: () => inventory,
        // Las escrituras existen en el contrato del Host: aquí fallan si alguien las usa.
        create: async () => { throw new Error('create prohibido'); },
        delete: async () => { throw new Error('delete prohibido'); },
        setTitle: async () => { throw new Error('setTitle prohibido'); },
        pinSession: async () => { throw new Error('pinSession prohibido'); },
      },
      sessions: { list: () => [{ id: 's1' }] },
    };
    const ctx = {
      get: (service) => provided[service],
      tools: { register: () => {} },
      effect: (factory) => { const dispose = factory(); cleanups.push(dispose); },
      on: () => {},
      logger: { warn: () => {}, debug: () => {} },
    };

    apply(ctx);
    const route = routes.find((entry) => entry.path === PA_PREFIX);
    assert.ok(route, 'la API PA debe estar montada');

    const res = {
      statusCode: 0, headers: {}, body: '',
      setHeader(key, value) { this.headers[key] = value; },
      end(body) { this.body = body; },
    };
    await route.handler({
      url: PA_PREFIX + '/workspaces',
      method: 'GET',
      headers: {},
      async *[Symbol.asyncIterator]() {},
    }, res);

    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body).data;
    assert.equal(payload.source, 'host', 'sin `services` en createPaHandler esto sería source:"none"');
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].title, 'caja del adaptador');
    assert.deepEqual(payload.items[0].sessions, { known: 2, live: 1, historical: 1 },
      'las sesiones vivas del host tienen que llegar al conteo');
    for (const dispose of cleanups) if (typeof dispose === 'function') dispose();
  } finally {
    if (previous === undefined) delete process.env.LIFECODE_RAG_ROOT;
    else process.env.LIFECODE_RAG_ROOT = previous;
    box.cleanup();
  }
});
