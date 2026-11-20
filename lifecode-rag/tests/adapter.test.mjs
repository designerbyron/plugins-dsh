/**
 * El adaptador Cordis no se puede cargar fuera del host, pero sí se puede ejercitar con un `ctx`
 * mínimo: comprueba que registra las siete herramientas, la ruta HTTP y arranca/para la automatización
 * sin tocar el perfil ni el almacén real.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject, name } from '../index.js';
import { API_PREFIX } from '../lib/server.mjs';
import { closeDatabase, openDatabase } from '../lib/db.mjs';
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
    assert.deepEqual(inject, ['tools']);
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
    assert.equal(routes.length, 1);
    assert.equal(routes[0].kind, 'prefix');
    assert.equal(routes[0].path, API_PREFIX);
    assert.equal(typeof routes[0].handler, 'function');
    assert.equal(cleanups.length, 3, 'API + sincronización + automatización');
    for (const dispose of cleanups) dispose();
    assert.equal(routes[0].disposed, true);
  } finally {
    if (previous === undefined) delete process.env.LIFECODE_RAG_ROOT;
    else process.env.LIFECODE_RAG_ROOT = previous;
    box.cleanup();
  }
});
