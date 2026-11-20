/**
 * LE-RAG-01 · Golden a nivel de HERRAMIENTA (no del motor).
 *
 * Fija la relación documentada: `lifecode_rag_search({limit:8})` pide al motor `cap = 16`
 * (`searchScopes` usa 2× el límite) y devuelve los 8 primeros de ese pool. Congela el orden
 * resultante para un corpus sintético determinista.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeExec, makeWorld, servicesFor } from './pa3-helpers.mjs';
import { openScopeStore } from '../lib/scope-stores.mjs';
import { insertChunk, insertSource } from './helpers.mjs';
import { createToolDefinitions } from '../lib/tools.mjs';
import { search } from '../lib/search.mjs';

async function worldWithCorpus() {
  const world = await makeWorld();
  const store = openScopeStore({
    profileRoot: world.root, profileKey: 'pa3-test', scope: { kind: 'prj', id: world.projectA.id }, create: true,
  });
  // Fuente dominante (12 fragmentos con alta frecuencia) y dos fuentes relevantes más largas.
  insertSource(store, { id: 'src-dom', uri: 'C:/demo/dom.md', title: 'Dom' });
  for (let i = 0; i < 12; i += 1) insertChunk(store, { sourceId: 'src-dom', ordinal: i, text: `alpha alpha alpha ${i}`, title: 'Dom' });
  insertSource(store, { id: 'src-a', uri: 'C:/demo/a.md', title: 'A' });
  insertChunk(store, { sourceId: 'src-a', ordinal: 0, text: `alpha ${'relleno '.repeat(60)}`, title: 'A' });
  insertSource(store, { id: 'src-b', uri: 'C:/demo/b.md', title: 'B' });
  insertChunk(store, { sourceId: 'src-b', ordinal: 0, text: `alpha ${'relleno '.repeat(60)}`, title: 'B' });
  store.close();
  return world;
}

function tools(world, config = world.config) {
  const defs = createToolDefinitions({ config, root: world.root, services: servicesFor(world, { sessionId: 'sesion-a' }) });
  return (name) => defs.find((d) => d.name === `lifecode_rag_${name}`);
}

test('golden de herramienta: limit 8 == motor cap 16, recortado a 8 (fragment)', async () => {
  const world = await worldWithCorpus();
  try {
    const result = await tools(world)('search').execute({ query: 'alpha', limit: 8 }, fakeExec('sesion-a'));
    const engineStore = openScopeStore({ profileRoot: world.root, profileKey: 'pa3-test', scope: { kind: 'prj', id: world.projectA.id } });
    const engine = await search(engineStore, {
      query: 'alpha', limit: 16, config: world.config, strategy: 'hybrid', record: false,
    });
    engineStore.close();
    assert.equal(result.results.length, 8);
    assert.deepEqual(
      result.results.map((r) => r.chunkKey),
      engine.results.slice(0, 8).map((r) => r.chunkKey),
      'la herramienta usa el pool de 16 y corta a 8',
    );
    // Golden congelado del fixture (orden léxico determinista).
    assert.deepEqual(result.results.slice(0, 3).map((r) => r.sourceId), ['src-dom', 'src-dom', 'src-dom']);
  } finally {
    world.cleanup();
  }
});

test('golden de herramienta: source da una fuente distinta por posición antes del relleno', async () => {
  const world = await worldWithCorpus();
  try {
    const cfg = { ...world.config, search: { ...world.config.search, diversity: 'source' } };
    const result = await tools(world, cfg)('search').execute({ query: 'alpha', limit: 3 }, fakeExec('sesion-a'));
    assert.equal(new Set(result.results.map((r) => r.sourceId)).size, 3);
  } finally {
    world.cleanup();
  }
});
