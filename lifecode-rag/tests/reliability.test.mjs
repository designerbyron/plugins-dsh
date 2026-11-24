/**
 * Confiabilidad de la recuperación (UX-2.2 · P0-1, RET-03).
 *
 * El canal semántico es opcional: si el proveedor de embeddings falla por una causa recuperable, la
 * búsqueda debe seguir sirviendo el canal léxico y **declararlo**. Lo que no puede hacer el fallback es
 * ocultar cancelaciones, denegaciones de autorización, corrupción ni errores internos.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { search } from '../lib/search.mjs';
import { RagError } from '../lib/errors.mjs';
import { createToolDefinitions } from '../lib/tools.mjs';
import { createEmbedder } from '../lib/embedders.mjs';
import { tempRoot } from './helpers.mjs';
import { fakeExec, makeWorld, servicesFor } from './pa3-helpers.mjs';

function failingEmbedder(code = 'embedding-failed', kind = 'lexical') {
  return {
    model: 'doble-roto',
    dim: 8,
    kind,
    async embed() {
      throw new RagError(code, `fallo simulado del proveedor (${code})`);
    },
  };
}

async function seededStore(box, files) {
  const cwd = join(box.root, 'proyecto');
  mkdirSync(cwd, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(cwd, name), body, 'utf8');
  const store = join(box.root, 'almacen');
  await ingestFiles({
    root: store,
    files: Object.keys(files).map((name) => join(cwd, name)),
    now: 1,
    config: validateConfig({}),
  });
  return { store, cwd };
}

test('un proveedor de embeddings caído degrada a léxico y lo declara', async () => {
  const box = tempRoot('rag-fallback');
  const { store } = await seededStore(box, { 'a.md': '# Alta\n\nalfa exclusiva del proyecto\n' });
  const opened = openDatabase({ root: store });
  try {
    const result = await search(opened.db, {
      query: 'alfa',
      config: validateConfig({}),
      embedder: failingEmbedder(),
    });
    assert.ok(result.results.length > 0, 'el canal léxico debe servir resultados');
    assert.equal(result.mode, 'lexical-fallback');
    assert.equal(result.diagnostics.degraded, true);
    assert.equal(result.diagnostics.semantic.error, 'embedding-failed');
    assert.ok(result.diagnostics.lexical.hits > 0);
    // La degradación queda medida: un canal caído no se cuenta como «consulta vacía».
    const fallback = opened.db.prepare("SELECT SUM(value) AS total FROM metrics_daily WHERE metric = 'query.fallback'").get();
    assert.equal(Number(fallback.total), 1);
  } finally {
    closeDatabase(opened.db);
  }
});

test('el fallback no oculta cancelación, autorización, aislamiento ni integridad', async () => {
  const box = tempRoot('rag-fallback-codes');
  const { store } = await seededStore(box, { 'a.md': '# Alta\n\nalfa exclusiva del proyecto\n' });
  const opened = openDatabase({ root: store });
  try {
    for (const code of ['cancelled', 'egress-denied', 'session-invalid', 'scope-forbidden', 'store-corrupt', 'internal']) {
      await assert.rejects(
        () => search(opened.db, { query: 'alfa', config: validateConfig({}), embedder: failingEmbedder(code) }),
        (error) => error instanceof RagError && error.code === code,
        `el código ${code} debe propagarse sin degradar`,
      );
    }
  } finally {
    closeDatabase(opened.db);
  }
});

test('si el léxico tampoco devuelve nada, el fallo de embeddings se propaga', async () => {
  const box = tempRoot('rag-fallback-empty');
  const { store } = await seededStore(box, { 'a.md': '# Alta\n\nalfa exclusiva del proyecto\n' });
  const opened = openDatabase({ root: store });
  try {
    await assert.rejects(
      () => search(opened.db, { query: 'terminoquenoexiste', config: validateConfig({}), embedder: failingEmbedder() }),
      (error) => error instanceof RagError && error.code === 'embedding-failed',
    );
  } finally {
    closeDatabase(opened.db);
  }
});

test('la estrategia vectorial explícita no degrada a léxico', async () => {
  const box = tempRoot('rag-fallback-vector');
  const { store } = await seededStore(box, { 'a.md': '# Alta\n\nalfa exclusiva del proyecto\n' });
  const opened = openDatabase({ root: store });
  try {
    await assert.rejects(
      () => search(opened.db, {
        query: 'alfa',
        strategy: 'vector',
        config: validateConfig({}),
        embedder: failingEmbedder(),
      }),
      (error) => error instanceof RagError && error.code === 'embedding-failed',
    );
  } finally {
    closeDatabase(opened.db);
  }
});

function toolCaller(world, services) {
  const definitions = createToolDefinitions({ config: world.config, services });
  const byName = new Map(definitions.map((definition) => [definition.name.replace('lifecode_rag_', ''), definition]));
  return (name, args, sessionId = 'sesion-a') => byName.get(name).execute(args, fakeExec(sessionId));
}

test('la degradación no falsea el modo léxico que realmente se usó', async () => {
  const box = tempRoot('rag-fallback-mode');
  const { store } = await seededStore(box, { 'a.md': '# Alta\n\nalfa exclusiva del proyecto\n' });
  const opened = openDatabase({ root: store });
  try {
    const result = await search(opened.db, {
      query: 'alfa',
      config: validateConfig({}),
      embedder: failingEmbedder(),
    });
    assert.equal(result.mode, 'lexical-fallback');
    assert.equal(result.diagnostics.lexical.mode, 'and', 'el diagnóstico informa el modo FTS real');
    assert.ok(result.diagnostics.lexical.hits > 0);
  } finally {
    closeDatabase(opened.db);
  }
});

test('la herramienta search declara la degradación sin romper el valor de v0.1', async () => {
  const world = await makeWorld();
  const services = { ...servicesFor(world), embedder: failingEmbedder('embedding-failed') };
  const call = toolCaller(world, services);
  const result = await call('search', { query: 'alfa', limit: 5 });

  assert.ok(Array.isArray(result.results));
  assert.ok(result.results.length > 0);
  assert.equal(result.mode, 'lexical-fallback');
  assert.equal(typeof result.elapsedMs, 'number');
  // El valor de `search` de v0.1 está congelado por contrato: no gana campos de diagnóstico.
  assert.deepEqual(Object.keys(result).sort(), ['elapsedMs', 'mode', 'results']);
  // La proyección de resultados no cambia: mismos campos que el contrato v0.1.
  assert.deepEqual(
    Object.keys(result.results[0]).sort(),
    ['chunkKey', 'heading', 'ordinal', 'rrf', 'snippet', 'sourceId', 'title', 'uri'].sort(),
  );
});

test('la herramienta search no degrada cuando la aprobación de egreso se deniega', async () => {
  const world = await makeWorld();
  const services = {
    ...servicesFor(world, { approve: false }),
    embedder: failingEmbedder('embedding-failed', 'semantic'),
  };
  const call = toolCaller(world, services);
  await assert.rejects(
    () => call('search', { query: 'alfa' }),
    (error) => error instanceof RagError && error.code === 'egress-denied',
  );
});

/** Envoltorio del embedder local que cuenta cuántos textos se embeben. */
function countingEmbedder(base) {
  const calls = [];
  return {
    model: base.model,
    dim: base.dim,
    kind: base.kind,
    calls,
    async embed(texts) {
      calls.push(Array.isArray(texts) ? texts.length : 1);
      return base.embed(texts);
    },
  };
}

test('context reutiliza los vectores guardados y sólo embebe la consulta', async () => {
  const world = await makeWorld();
  const base = createEmbedder(world.config);
  const counter = countingEmbedder(base);
  const call = toolCaller(world, { ...servicesFor(world), embedder: counter });
  const result = await call('context', { query: 'alfa', budgetTokens: 400 });

  assert.ok(result.citations.length > 0, 'el contexto debe citar lo recuperado');
  const embedded = counter.calls.reduce((total, n) => total + n, 0);
  assert.equal(embedded, 1, `sólo la consulta debe embeberse, se embebieron ${embedded} textos`);
  assert.deepEqual(counter.calls, [1]);
});

test('context no reutiliza vectores de otro modelo: los calcula y no falla', async () => {
  const world = await makeWorld();
  const base = createEmbedder(world.config);
  const ajeno = { ...countingEmbedder(base), model: 'modelo-ajeno-v9' };
  const call = toolCaller(world, { ...servicesFor(world), embedder: ajeno });
  const result = await call('context', { query: 'alfa', budgetTokens: 400 });

  assert.ok(result.citations.length > 0);
  const embedded = ajeno.calls.reduce((total, n) => total + n, 0);
  assert.ok(embedded > 1, `con otro modelo hay que embeber los candidatos; se embebieron ${embedded}`);
});
