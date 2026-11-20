/**
 * RAG-RANKING-03 · Pruebas de regresión para la diversidad documental.
 *
 * Estado: el modo `source` NO está implementado. Este archivo:
 *   - protege el comportamiento actual (`fragment`): orden, RRF, límites, contrato y aislamiento;
 *   - fija la especificación aprobada de `source`/`maxPerSource` como pruebas en rojo esperado
 *     (`todo`), que pasarán a verde cuando exista `selectBySource` en `lib/search.mjs`.
 *
 * No modifica producción. Todos los almacenes son temporales (`tempRoot`), nunca `~/.dsh`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { fuseRrf, search, selectBySource } from '../lib/search.mjs';
import * as searchModule from '../lib/search.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { openScopeStore } from '../lib/scope-stores.mjs';
import { createToolDefinitions } from '../lib/tools.mjs';
import { fakeExec, makeWorld, servicesFor } from './pa3-helpers.mjs';
import { insertChunk, insertSource, tempRoot } from './helpers.mjs';

const CONFIG = validateConfig({});
const EMBEDDER = {
  model: 'test-embed',
  dim: 8,
  embed: async (texts) => texts.map(() => new Float32Array(8)),
};

/** Almacén sintético: una fuente con 37 fragmentos y dos fuentes pequeñas. */
function bigStore() {
  const box = tempRoot('rag-diversity');
  const { db } = openDatabase({ root: box.root, create: true });
  insertSource(db, { id: 'src-big', uri: 'C:/demo/big.md', title: 'Big' });
  for (let i = 0; i < 37; i += 1) {
    insertChunk(db, { sourceId: 'src-big', ordinal: i, text: `alpha fragmento ${i}`, title: 'Big' });
  }
  insertSource(db, { id: 'src-one', uri: 'C:/demo/one.md', title: 'One' });
  insertChunk(db, { sourceId: 'src-one', ordinal: 0, text: 'alpha uno', title: 'One' });
  insertChunk(db, { sourceId: 'src-one', ordinal: 1, text: 'alpha dos', title: 'One' });
  insertSource(db, { id: 'src-two', uri: 'C:/demo/two.md', title: 'Two' });
  insertChunk(db, { sourceId: 'src-two', ordinal: 0, text: 'alpha tres', title: 'Two' });
  insertChunk(db, { sourceId: 'src-two', ordinal: 1, text: 'alpha cuatro', title: 'Two' });
  insertSource(db, { id: 'src-other', uri: 'C:/demo/other.md', title: 'Other' });
  insertChunk(db, { sourceId: 'src-other', ordinal: 0, text: 'beta sin coincidencia', title: 'Other' });
  return { box, db };
}

function close(store) {
  closeDatabase(store.db);
  store.box.cleanup();
}

const runSearch = (db, { limit, strategy = 'hybrid', config = CONFIG } = {}) => search(db, {
  query: 'alpha', limit, config, embedder: EMBEDDER, strategy, record: false, now: 1_700_000_000_000,
});

/** Oráculo de la especificación aprobada (D-02 + decisiones 6-9). */
function specSelect(rows, { limit, maxPerSource = 0 } = {}) {
  const cap = maxPerSource > 0 ? maxPerSource : Number.POSITIVE_INFINITY;
  const seen = new Map();
  const first = [];
  const rest = [];
  for (const row of rows) {
    const key = row.sourceId;
    const count = seen.get(key) ?? 0;
    if (count === 0) {
      first.push(row);
      seen.set(key, 1);
    } else {
      rest.push(row);
    }
    if (first.length >= limit) break;
  }
  const out = [...first];
  for (const row of rows) {
    if (out.length >= limit) break;
    if (first.includes(row)) continue;
    const count = seen.get(row.sourceId) ?? 0;
    if (count >= cap) continue;
    seen.set(row.sourceId, count + 1);
    out.push(row);
  }
  return out.slice(0, limit);
}

// ─── T01 · Golden de `fragment` (comportamiento actual) ────────────────────────────────────────────
test('T01 fragment: orden, sourceId, chunkKey, rrf y número de resultados', async () => {
  const store = bigStore();
  try {
    const first = await runSearch(store.db, { limit: 8 });
    const second = await runSearch(store.db, { limit: 8 });

    assert.equal(first.results.length, 8, 'devuelve exactamente el límite pedido');
    assert.deepEqual(second.results.map((r) => r.chunkKey), first.results.map((r) => r.chunkKey), 'determinista');

    // Golden del orden: los documentos cortos ganan en BM25; los 37 fragmentos del grande van después.
    assert.deepEqual(
      first.results.slice(0, 4).map((r) => r.chunkKey),
      ['src-one#0', 'src-one#1', 'src-two#0', 'src-two#1'],
      'orden léxico estable de las fuentes pequeñas',
    );
    assert.ok(first.results.slice(4).every((r) => r.sourceId === 'src-big'), 'el resto son fragmentos de la fuente grande');

    // RRF intacto en cada posición: 3/(60+rank) con pesos 3:1 y k=60.
    first.results.forEach((row, index) => {
      assert.ok(Math.abs(row.rrf - 3 / (60 + index + 1)) < 1e-9, `rrf de la posición ${index + 1}`);
    });

    for (const row of first.results) {
      assert.match(row.chunkKey, /^src-[a-z]+#\d+$/);
      assert.equal(row.sourceId, row.chunkKey.split('#')[0]);
      assert.ok(row.rrf > 0 && row.rrf <= 3 / 61 + 1e-12, 'rrf dentro del rango léxico (peso 3, k=60)');
    }
    // RRF exacto del primer puesto léxico: 3/(60+1). Sin vectores, el fusor sólo suma la rama léxica.
    assert.ok(Math.abs(first.results[0].rrf - 3 / 61) < 1e-12);

    // `maxPerSource` sigue siendo un filtro que puede acortar la lista (comportamiento vigente, D-06).
    const cappedCfg = validateConfig({ search: { maxPerSource: 1 } });
    const capped = await runSearch(store.db, { limit: 8, config: cappedCfg });
    assert.equal(capped.results.length, 3, 'con tope 1 por fuente devuelve 3 filas, no 8');
    assert.equal(new Set(capped.results.map((r) => r.sourceId)).size, capped.results.length);
  } finally {
    close(store);
  }
});

// ─── T06 · RRF intacto ────────────────────────────────────────────────────────────────────────────
test('T06 fuseRrf: fórmula, orden y determinismo sin tocar puntuaciones', () => {
  const fts = [
    { chunk_key: 'a#0', source_id: 'a', uri: 'a', rank: 1 },
    { chunk_key: 'a#1', source_id: 'a', uri: 'a', rank: 2 },
    { chunk_key: 'b#0', source_id: 'b', uri: 'b', rank: 3 },
  ];
  const vec = [
    { chunk_key: 'b#0', source_id: 'b', uri: 'b', rank: 1, score: 0.9 },
    { chunk_key: 'a#0', source_id: 'a', uri: 'a', rank: 2, score: 0.8 },
  ];
  const k = 60;
  const weights = { lexical: 3, semantic: 1 };
  const fusion = fuseRrf(fts, vec, { k, limit: 10, weights });
  const byKey = new Map(fusion.all.map((row) => [row.chunkKey, row]));

  assert.ok(Math.abs(byKey.get('a#0').rrf - (3 / 61 + 1 / 62)) < 1e-12);
  assert.ok(Math.abs(byKey.get('b#0').rrf - (3 / 63 + 1 / 61)) < 1e-12);
  assert.ok(Math.abs(byKey.get('a#1').rrf - 3 / 62) < 1e-12);
  assert.deepEqual(byKey.get('a#0').via, ['fts', 'vector']);
  assert.equal(fusion.all[0].score, 1, 'el primero se normaliza a 1.0');

  const again = fuseRrf(fts, vec, { k, limit: 10, weights });
  assert.deepEqual(again.all.map((r) => [r.chunkKey, r.rrf]), fusion.all.map((r) => [r.chunkKey, r.rrf]));
});

// ─── T07 · Límites ────────────────────────────────────────────────────────────────────────────────
test('T07 fragment: límites 1, 3, 5, 8 y 50 nunca se superan', async () => {
  const store = bigStore();
  try {
    for (const limit of [1, 3, 5, 8, 50]) {
      const out = await runSearch(store.db, { limit });
      assert.ok(out.results.length <= limit, `no supera ${limit}`);
      assert.equal(out.results.length, Math.min(limit, 41), `rellena hasta ${limit} con 41 candidatos`);
    }
  } finally {
    close(store);
  }
});

// ─── T09 · Compatibilidad de configuración ────────────────────────────────────────────────────────
test('T09a una configuración sin `diversity` sigue siendo válida y operable', async () => {
  assert.doesNotThrow(() => validateConfig({}));
  assert.doesNotThrow(() => validateConfig({ search: { limit: 5, maxPerSource: 2 } }));
  const store = bigStore();
  try {
    const out = await runSearch(store.db, { limit: 3 });
    assert.equal(out.results.length, 3);
  } finally {
    close(store);
  }
});

test('T09b el valor por defecto de `diversity` es `fragment`', () => {
  assert.equal(validateConfig({}).search.diversity, 'fragment');
});

// ─── T10 · Validación ────────────────────────────────────────────────────────────────────────────
test('T10a valores no admitidos de `diversity` se rechazan por el enum', () => {
  for (const value of ['document', 'hybrid', true, null]) {
    assert.throws(
      () => validateConfig({ search: { diversity: value } }),
      (error) => error.code === 'invalid-config' && /diversity/.test(error.message),
      `debe rechazar ${JSON.stringify(value)} por el enum, no por clave desconocida`,
    );
  }
});

test('T10b `fragment` y `source` son valores admitidos', () => {
  for (const value of ['fragment', 'source']) {
    const cfg = validateConfig({ search: { diversity: value } });
    assert.equal(cfg.search.diversity, value);
  }
});

// ─── T11 · Contrato de la herramienta ────────────────────────────────────────────────────────────
test('T11 la respuesta de `lifecode_rag_search` no expone score, cosine ni via', async () => {
  const world = await makeWorld();
  try {
    const services = servicesFor(world, { sessionId: 'sesion-a' });
    const defs = createToolDefinitions({ config: world.config, root: world.root, services });
    const searchTool = defs.find((d) => d.name === 'lifecode_rag_search');
    const out = await searchTool.execute({ query: 'alfa', limit: 3 }, fakeExec('sesion-a'));

    assert.deepEqual(Object.keys(out).sort(), ['elapsedMs', 'mode', 'results']);
    for (const row of out.results) {
      assert.deepEqual(Object.keys(row).sort(), ['chunkKey', 'heading', 'ordinal', 'rrf', 'snippet', 'sourceId', 'title', 'uri']);
      assert.equal('score' in row, false);
      assert.equal('cosine' in row, false);
      assert.equal('via' in row, false);
    }
    assert.equal('diversity' in searchTool.parameters.properties, false, 'no se añaden parámetros');
  } finally {
    world.cleanup();
  }
});

// ─── T12 · Aislamiento ───────────────────────────────────────────────────────────────────────────
test('T12 la selección sólo ve filas del scope autorizado', async () => {
  const world = await makeWorld();
  try {
    const defsA = createToolDefinitions({ config: world.config, root: world.root, services: servicesFor(world, { sessionId: 'sesion-a' }) });
    const defsB = createToolDefinitions({ config: world.config, root: world.root, services: servicesFor(world, { sessionId: 'sesion-b' }) });
    const searchA = defsA.find((d) => d.name === 'lifecode_rag_search');
    const searchB = defsB.find((d) => d.name === 'lifecode_rag_search');

    const a = await searchA.execute({ query: 'alfa', limit: 5 }, fakeExec('sesion-a'));
    const b = await searchB.execute({ query: 'alfa', limit: 5 }, fakeExec('sesion-b'));

    const idsA = new Set(a.results.map((r) => r.sourceId));
    const idsB = new Set(b.results.map((r) => r.sourceId));
    assert.ok(idsA.size >= 1);
    for (const id of idsB) assert.equal(idsA.has(id), false, 'ningún sourceId compartido entre proyectos');
  } finally {
    world.cleanup();
  }
});

// ─── Oráculo de la especificación (se valida a sí mismo hoy) ─────────────────────────────────────
test('SPEC el oráculo de `source` reproduce la semántica aprobada', () => {
  const rows = [
    { sourceId: 'A', chunkKey: 'A#0' }, { sourceId: 'A', chunkKey: 'A#1' },
    { sourceId: 'B', chunkKey: 'B#0' }, { sourceId: 'C', chunkKey: 'C#0' },
    { sourceId: 'A', chunkKey: 'A#2' }, { sourceId: 'B', chunkKey: 'B#1' },
  ];
  assert.deepEqual(specSelect(rows, { limit: 3 }).map((r) => r.chunkKey), ['A#0', 'B#0', 'C#0']);
  assert.deepEqual(specSelect(rows, { limit: 5 }).map((r) => r.chunkKey), ['A#0', 'B#0', 'C#0', 'A#1', 'A#2']);
  assert.deepEqual(specSelect(rows, { limit: 5, maxPerSource: 1 }).map((r) => r.chunkKey), ['A#0', 'B#0', 'C#0']);
  assert.deepEqual(specSelect(rows, { limit: 2, maxPerSource: 2 }).map((r) => r.chunkKey), ['A#0', 'B#0']);
});

// ─── T02–T05, T08 · Modo `source`: en rojo esperado hasta RAG-RANKING-04 ──────────────────────────
test('T02 source prioriza fuentes distintas (37 fragmentos en una)', async () => {
  const store = bigStore();
  try {
    const rows = (await runSearch(store.db, { limit: 20 })).results;
    const selected = searchModule.selectBySource(rows, { limit: 3 });
    assert.equal(new Set(selected.map((r) => r.sourceId)).size, 3);
  } finally {
    close(store);
  }
});

test('T03 source rellena con la segunda vuelta respetando el orden', async () => {
  const store = bigStore();
  try {
    const rows = (await runSearch(store.db, { limit: 20 })).results;
    const selected = searchModule.selectBySource(rows, { limit: 5 });
    assert.deepEqual(selected.map((r) => r.chunkKey), specSelect(rows, { limit: 5 }).map((r) => r.chunkKey));
  } finally {
    close(store);
  }
});

test('T04 source respeta maxPerSource 0/1/2 (la primera aparición cuenta)', async () => {
  const store = bigStore();
  try {
    const rows = (await runSearch(store.db, { limit: 30 })).results;
    for (const cap of [0, 1, 2]) {
      const selected = searchModule.selectBySource(rows, { limit: 10, maxPerSource: cap });
      assert.deepEqual(selected.map((r) => r.chunkKey), specSelect(rows, { limit: 10, maxPerSource: cap }).map((r) => r.chunkKey));
      if (cap === 1) assert.equal(new Set(selected.map((r) => r.sourceId)).size, selected.length);
    }
  } finally {
    close(store);
  }
});

test('T05 source no descarta el resto: con límite amplio devuelve todo reordenado', async () => {
  const store = bigStore();
  try {
    const rows = (await runSearch(store.db, { limit: 50 })).results;
    const selected = searchModule.selectBySource(rows, { limit: 50 });
    assert.equal(selected.length, rows.length);
    assert.deepEqual(new Set(selected.map((r) => r.chunkKey)), new Set(rows.map((r) => r.chunkKey)));
    assert.ok(Math.abs(selected[0].rrf - rows[0].rrf) < 1e-12, 'no recalcula puntuaciones');
  } finally {
    close(store);
  }
});

test('T08 fuentes insuficientes: devuelve lista corta sin inventar', async () => {
  const store = bigStore();
  try {
    const rows = (await runSearch(store.db, { limit: 50 })).results.filter((r) => r.sourceId !== 'src-big');
    // Sólo dos fuentes coinciden con «alpha»: con tope 1 la lista es corta y no se inventa nada.
    const selected = selectBySource(rows, { limit: 8, maxPerSource: 1 });
    assert.equal(selected.length, 2);
    assert.equal(new Set(selected.map((r) => r.sourceId)).size, 2);
    assert.ok(selected.every((r) => rows.some((row) => row.chunkKey === r.chunkKey)));
  } finally {
    close(store);
  }
});

// ─── T13 · Integración de extremo a extremo: tools → searchScopes → motor ─────────────────────
test('T13 `source` diversifica desde la herramienta; `fragment` no cambia; context no hereda', async () => {
  const world = await makeWorld();
  try {
    // Fuente dominante (alta frecuencia, texto corto) y dos fuentes relevantes pero más largas.
    const store = openScopeStore({
      profileRoot: world.root, profileKey: 'pa3-test', scope: { kind: 'prj', id: world.projectA.id }, create: true,
    });
    try {
      insertSource(store, { id: 'src-dom', uri: 'C:/demo/dom.md', title: 'Dom' });
      for (let i = 0; i < 5; i += 1) insertChunk(store, { sourceId: 'src-dom', ordinal: i, text: 'alpha alpha alpha alpha', title: 'Dom' });
      insertSource(store, { id: 'src-a', uri: 'C:/demo/a.md', title: 'A' });
      insertChunk(store, { sourceId: 'src-a', ordinal: 0, text: `alpha ${'relleno '.repeat(40)}`, title: 'A' });
      insertSource(store, { id: 'src-b', uri: 'C:/demo/b.md', title: 'B' });
      insertChunk(store, { sourceId: 'src-b', ordinal: 0, text: `alpha ${'relleno '.repeat(40)}`, title: 'B' });
    } finally {
      store.close();
    }

    const sourceConfig = { ...world.config, search: { ...world.config.search, diversity: 'source' } };
    const build = (config, sessionId) => createToolDefinitions({
      config, root: world.root, services: servicesFor(world, { sessionId }),
    });
    const defsSource = build(sourceConfig, 'sesion-a');
    const defsFragment = build(world.config, 'sesion-a');
    const tool = (defs, name) => defs.find((d) => d.name === `lifecode_rag_${name}`);

    const withSource = await tool(defsSource, 'search').execute({ query: 'alpha', limit: 3 }, fakeExec('sesion-a'));
    const withFragment = await tool(defsFragment, 'search').execute({ query: 'alpha', limit: 3 }, fakeExec('sesion-a'));

    assert.ok(new Set(withSource.results.map((r) => r.sourceId)).size >= 2, 'source prioriza fuentes distintas');
    assert.equal(new Set(withFragment.results.map((r) => r.sourceId)).size, 1, 'fragment conserva el dominio del ranking');

    // `context` no recibe el modo: mismas citas con ambas configuraciones.
    const ctxA = await tool(defsSource, 'context').execute({ query: 'alpha', budgetTokens: 600 }, fakeExec('sesion-a'));
    const ctxB = await tool(defsFragment, 'context').execute({ query: 'alpha', budgetTokens: 600 }, fakeExec('sesion-a'));
    assert.ok((ctxA.citations ?? []).length > 0);
    assert.deepEqual(
      (ctxA.citations ?? []).map((c) => c.chunkKey ?? c.sourceId),
      (ctxB.citations ?? []).map((c) => c.chunkKey ?? c.sourceId),
      'context no hereda diversity',
    );

    // Otro proyecto no ve las fuentes de A aunque comparta configuración.
    const defsB = build(sourceConfig, 'sesion-b');
    const resB = await tool(defsB, 'search').execute({ query: 'alpha', limit: 3 }, fakeExec('sesion-b'));
    for (const row of resB.results) assert.equal(['src-dom', 'src-a', 'src-b'].includes(row.sourceId), false);
  } finally {
    world.cleanup();
  }
});

// ─── T14 · Función pura ─────────────────────────────────────────────────────────────────────────
test('T14 selectBySource: no muta, no inventa, determinista, idempotente y respeta el límite', () => {
  const rows = [
    { sourceId: 'A', chunkKey: 'A#0', rrf: 0.05 },
    { sourceId: 'A', chunkKey: 'A#1', rrf: 0.04 },
    { sourceId: 'B', chunkKey: 'B#0', rrf: 0.03 },
    { sourceId: 'A', chunkKey: 'A#2', rrf: 0.02 },
    { sourceId: 'C', chunkKey: 'C#0', rrf: 0.01 },
  ];
  const snapshot = JSON.stringify(rows);
  const out = selectBySource(rows, { limit: 3 });

  assert.equal(JSON.stringify(rows), snapshot, 'no muta la entrada');
  assert.ok(out.every((row) => rows.includes(row)), 'no inventa filas: mismas referencias');
  for (const row of out) assert.equal(row.rrf, rows.find((x) => x.chunkKey === row.chunkKey).rrf, 'no altera puntuaciones');
  assert.deepEqual(out.map((r) => r.chunkKey), ['A#0', 'B#0', 'C#0']);
  assert.deepEqual(
    selectBySource(rows, { limit: 3 }).map((r) => r.chunkKey),
    out.map((r) => r.chunkKey),
    'determinista',
  );
  assert.deepEqual(selectBySource(out, { limit: 3 }).map((r) => r.chunkKey), out.map((r) => r.chunkKey), 'idempotente');
  assert.equal(selectBySource(rows, { limit: 100 }).length, rows.length, 'nunca supera el número de candidatos');
  assert.equal(selectBySource(rows, { limit: 2, maxPerSource: 1 }).length, 2);
});
