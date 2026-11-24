/**
 * Optimizaciones y correcciones de UX-2.2 (P0-3, P0-4, P1-3, P1-5, P1-7, TOOL-01).
 *
 * Cada prueba fija un comportamiento que la auditoría declaró roto o inexistente:
 * identidad de fuente por colección, ausencia de estado compartido en `forget`, tiempos por etapa,
 * advertencias de secretos de alta confianza y ruta relativa aditiva en las respuestas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { ingestFiles, sourceIdFor } from '../lib/ingest.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { getSource } from '../lib/search.mjs';
import { createToolDefinitions } from '../lib/tools.mjs';
import { RagError } from '../lib/errors.mjs';
import { tempRoot, insertSource } from './helpers.mjs';
import { relativeToRoots } from '../lib/paths.mjs';
import { resolveCollections } from '../lib/sync.mjs';
import { fakeExec, makeWorld, servicesFor } from './pa3-helpers.mjs';

async function seed(root, files, extra = {}) {
  const cwd = join(root, 'proyecto');
  mkdirSync(cwd, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(cwd, name), body, 'utf8');
  const store = join(root, 'almacen');
  const result = await ingestFiles({
    root: store,
    files: Object.keys(files).map((name) => join(cwd, name)),
    now: 1,
    config: validateConfig({}),
    ...extra,
  });
  return { store, cwd, result };
}

test('la misma uri se indexa en dos colecciones sin colisión', async () => {
  const box = tempRoot('rag-collections');
  const files = { 'a.md': '# Alfa\n\nalfa de dos colecciones\n' };
  const first = await seed(box.root, files, { collection: 'default' });
  const second = await seed(box.root, files, { collection: 'otra' });

  assert.equal(first.result.ingested.length, 1);
  assert.equal(second.result.ingested.length, 1, 'la segunda colección debe indexar, no decir «unchanged»');
  assert.notEqual(
    first.result.ingested[0].id,
    second.result.ingested[0].id,
    'dos colecciones exigen dos identificadores',
  );

  const opened = openDatabase({ root: first.store });
  try {
    const rows = opened.db.prepare('SELECT id, collection FROM sources ORDER BY collection').all();
    assert.deepEqual(rows.map((row) => row.collection), ['default', 'otra']);
  } finally {
    closeDatabase(opened.db);
  }
});

test('la repetición dentro de la misma colección sigue siendo idempotente', async () => {
  const box = tempRoot('rag-collections-idem');
  const files = { 'a.md': '# Alfa\n\nalfa idempotente\n' };
  const first = await seed(box.root, files, { collection: 'otra' });
  const second = await seed(box.root, files, { collection: 'otra' });

  assert.equal(second.result.ingested.length, 0);
  assert.equal(second.result.skipped.length, 1);
  assert.equal(second.result.skipped[0].reason, 'unchanged');
  assert.equal(second.result.skipped[0].id, first.result.ingested[0].id);

  const opened = openDatabase({ root: first.store });
  try {
    assert.equal(opened.db.prepare('SELECT COUNT(*) AS n FROM sources').get().n, 1);
  } finally {
    closeDatabase(opened.db);
  }
});

test('el identificador derivado respeta la colección y no cambia para la colección por defecto', () => {
  const uri = 'C:/docs/a.md';
  assert.equal(sourceIdFor(uri), sourceIdFor(uri, 'default'));
  assert.notEqual(sourceIdFor(uri, 'otra'), sourceIdFor(uri, 'default'));
  assert.match(sourceIdFor(uri, 'otra'), /^src_[0-9a-f]{16}$/);
});

test('getSource prefiere el id y rechaza una uri ambigua entre colecciones', async () => {
  const box = tempRoot('rag-get-ambiguo');
  const files = { 'a.md': '# Alfa\n\nalfa ambigua\n' };
  const first = await seed(box.root, files, { collection: 'default' });
  await seed(box.root, files, { collection: 'otra' });

  const opened = openDatabase({ root: first.store });
  try {
    const byId = getSource(opened.db, first.result.ingested[0].id);
    assert.equal(byId.collection, 'default');

    const uri = first.result.ingested[0].uri;
    assert.throws(
      () => getSource(opened.db, uri),
      (error) => error instanceof RagError && error.code === 'invalid-argument'
        && error.details?.reason === 'ambiguous-ref',
    );
  } finally {
    closeDatabase(opened.db);
  }
});

function toolCaller(world, services) {
  const definitions = createToolDefinitions({ config: world.config, services });
  const byName = new Map(definitions.map((definition) => [definition.name.replace('lifecode_rag_', ''), definition]));
  const call = (name, args, sessionId = 'sesion-a') => byName.get(name).execute(args, fakeExec(sessionId));
  call.definition = (name) => byName.get(name);
  return call;
}

test('dos forget concurrentes informan cada uno de su propio recuento', async () => {
  const world = await makeWorld({ docsA: { 'a.md': '# Alfa\n\nalfa\n', 'b.md': '# Beta\n\nbeta\n' } });
  const call = toolCaller(world, servicesFor(world));
  const listed = await call('list', {});
  const byTitle = new Map(listed.rows.map((row) => [row.title, row]));
  const alfa = byTitle.get('Alfa') ?? listed.rows.find((row) => row.uri.endsWith('a.md'));
  const beta = byTitle.get('Beta') ?? listed.rows.find((row) => row.uri.endsWith('b.md'));
  assert.ok(alfa && beta, 'las dos fuentes deben existir antes del borrado');

  const [forgottenA, forgottenB] = await Promise.all([
    call('forget', { ref: alfa.id }),
    call('forget', { ref: beta.id }),
  ]);

  assert.equal(forgottenA.sourceId, alfa.id);
  assert.equal(forgottenB.sourceId, beta.id);
  assert.ok(Number.isInteger(forgottenA.chunks), 'el recuento debe viajar en el valor, no en estado compartido');
  assert.ok(forgottenA.chunks > 0);
  assert.ok(forgottenB.chunks > 0);

  // El texto de cada respuesta se pinta **después** de las dos llamadas: con estado compartido, las dos
  // mostrarían el recuento del último `forget`.
  const { render } = call.definition('forget').output;
  const textA = render({ ref: alfa.id }, forgottenA)[0].text;
  const textB = render({ ref: beta.id }, forgottenB)[0].text;
  assert.match(textA, new RegExp(`\\(${forgottenA.chunks} chunks\\)`));
  assert.match(textB, new RegExp(`\\(${forgottenB.chunks} chunks\\)`));
  assert.ok(textA.includes(`eliminada ${alfa.uri}`));
  assert.ok(textB.includes(`eliminada ${beta.uri}`));
});

test('la ingesta registra tiempos por etapa', async () => {
  const box = tempRoot('rag-stages');
  const { store } = await seed(box.root, { 'a.md': '# Alfa\n\nalfa por etapas\n' });
  const opened = openDatabase({ root: store });
  try {
    const rows = opened.db.prepare("SELECT dim, SUM(value) AS total FROM metrics_daily WHERE metric = 'ingest.stage_ms' GROUP BY dim ORDER BY dim").all();
    const dims = rows.map((row) => row.dim);
    assert.deepEqual(dims, ['chunk', 'embed', 'extract', 'write']);
    for (const row of rows) assert.ok(row.total >= 0);
  } finally {
    closeDatabase(opened.db);
  }
});

test('un fichero con pinta de clave privada se indexa con advertencia, sin bloquearlo', async () => {
  const box = tempRoot('rag-secretos');
  const { result } = await seed(box.root, {
    'notas.md': '# Notas\n\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n',
  });

  assert.equal(result.ingested.length, 1, 'no se bloquea: la heurística no es un control de seguridad');
  const item = result.ingested[0];
  assert.ok(Array.isArray(item.warnings));
  assert.ok(item.warnings.some((warning) => warning.code === 'possible-secret'));
  assert.equal(item.warnings.find((warning) => warning.code === 'possible-secret').kind, 'private-key');
});

test('get y list incluyen la ruta relativa; search conserva su forma', async () => {
  const world = await makeWorld();
  const call = toolCaller(world, servicesFor(world));

  const found = await call('search', { query: 'alfa', limit: 3 });
  assert.ok(found.results.length > 0);
  for (const row of found.results) {
    assert.ok(row.uri.includes('proyecto-a'), 'la absoluta sigue estando');
    assert.equal('relUri' in row, false, 'search mantiene las ocho claves del contrato');
    assert.deepEqual(
      Object.keys(row).sort(),
      ['chunkKey', 'heading', 'ordinal', 'rrf', 'snippet', 'sourceId', 'title', 'uri'],
    );
  }

  const listed = await call('list', {});
  assert.ok(listed.rows.every((row) => row.relUri === 'a.md'));

  const got = await call('get', { ref: listed.rows[0].id });
  assert.equal(got.source.relUri, 'a.md');
  assert.ok(got.source.uri.includes('proyecto-a'), 'la absoluta se conserva para `get --ref`');
});

// ---- Revisión técnica del diff: casos límite ----

test('relativeToRoots no corta de más cuando la raíz trae barra final ni cruza a un hermano', () => {
  assert.equal(relativeToRoots('C:/docs/sub/a.md', [{ path: 'C:/docs' }]), 'sub/a.md');
  assert.equal(relativeToRoots('C:\\docs\\sub\\a.md', [{ path: 'C:\\docs\\' }]), 'sub/a.md');
  assert.equal(relativeToRoots('C:/docs/sub/a.md', [{ path: 'C:/docs/' }, { path: 'C:/otra' }]), 'sub/a.md');
  // Un hermano que comparte prefijo textual no es una raíz contenedora.
  assert.equal(relativeToRoots('C:/proyecto-a-otro/a.md', [{ path: 'C:/proyecto-a' }]), null);
  assert.equal(relativeToRoots('C:/docs', [{ path: 'C:/docs' }]), '.');
  assert.equal(relativeToRoots('C:/ajeno/a.md', [{ path: 'C:/docs' }]), null);
});

test('un fichero ya indexado conserva su advertencia al repetir la ingesta', async () => {
  const box = tempRoot('rag-secretos-skip');
  const files = { 'notas.md': '# Notas\n\n-----BEGIN PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END PRIVATE KEY-----\n' };
  const first = await seed(box.root, files);
  assert.equal(first.result.ingested[0].warnings[0].kind, 'private-key');

  const second = await seed(box.root, files);
  assert.equal(second.result.skipped.length, 1);
  // La segunda pasada no recalcula texto, pero el aviso no puede desaparecer: el consumidor se queda
  // a ciegas justo cuando repite la operación.
  assert.ok(second.result.skipped[0].warnings.some((warning) => warning.kind === 'private-key'));
});

test('resolveCollections agrupa por colección y no se rinde con más de 100 rutas', async () => {
  const box = tempRoot('rag-resolve-collections');
  const opened = openDatabase({ root: join(box.root, 'almacen'), create: true });
  try {
    const batch = [];
    for (let i = 0; i < 101; i += 1) {
      const uri = `C:/docs/f${i}.md`;
      insertSource(opened.db, { id: `src-${i}`, uri, collection: 'otra', sha256: String(i).padStart(64, '0') });
      batch.push({ abs: uri, key: `k${i}` });
    }
    const groups = resolveCollections(opened.db, batch);
    assert.deepEqual([...groups.keys()], ['otra'], 'una sola colección aunque haya 101 rutas');
    assert.equal(groups.get('otra').length, 101);

    const mixed = resolveCollections(opened.db, [
      { abs: 'C:/docs/f0.md', key: 'a' },
      { abs: 'C:/docs/nuevo.md', key: 'b' },
    ]);
    assert.deepEqual([...mixed.keys()].sort(), ['default', 'otra'], 'cada fichero va a su colección');
    assert.equal(mixed.get('otra')[0].key, 'a');
    assert.equal(mixed.get('default')[0].key, 'b');
  } finally {
    closeDatabase(opened.db);
  }
});

test('get falla en cerrado si la referencia existe en dos colecciones', async () => {
  const world = await makeWorld();
  const call = toolCaller(world, servicesFor(world));
  const listed = await call('list', {});
  const original = listed.rows[0];

  // La misma ruta, en otra colección del mismo proyecto.
  await call('ingest', { paths: [original.uri], collection: 'otra' });
  const doble = await call('list', { collection: 'otra' });
  assert.equal(doble.rows.length, 1);

  await assert.rejects(
    () => call('get', { ref: original.uri }),
    (error) => error instanceof RagError && error.code === 'invalid-argument'
      && error.details?.reason === 'ambiguous-ref',
  );

  const porId = await call('get', { ref: doble.rows[0].id });
  assert.equal(porId.source.collection, 'otra');
  assert.equal(porId.source.relUri, 'a.md');
});
