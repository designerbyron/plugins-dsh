/**
 * F-4 (1.5.11) · `search` entrega un `chunkKey` y `get` lo consume.
 *
 * Defecto medido en Fase D sobre el Host real: `lifecode_rag_search` devuelve
 * `src_b3be94d572069f33#0` y `lifecode_rag_get` respondía «no existe una fuente con esa referencia»,
 * porque la resolución sólo entendía id, URI y título (`lib/scope-ops.mjs` → `getSource`). El modelo
 * tenía que traducir el identificador que la herramienta anterior le acababa de dar.
 *
 * Extensión ADITIVA (contrato v0.1.0 intacto, `docs/CONTRATO-EXTENSIONES-1.4.md`): el `chunkKey` se
 * acepta, resuelve la fuente propietaria y devuelve ESE fragmento. Las tres formas históricas —id,
 * URI y título— siguen respondiendo igual.
 *
 * Perfil temporal (`mkdtemp`): nada toca `~/.dsh`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { withAuthorizedContext } from '../lib/exec-context.mjs';
import { createEmbedder } from '../lib/embedders.mjs';
import { getAcross, listProject, searchScopes } from '../lib/scope-ops.mjs';
import { fakeExec, makeWorld, seedScope, servicesFor } from './pa3-helpers.mjs';

/** Documento de varios fragmentos: tres secciones bien separadas pasan de `maxChars` (2 000). */
const LARGO = [
  '# Manual de operación',
  'SECCION-UNO. ' + 'Arranque del servicio y comprobaciones previas. '.repeat(30),
  'SECCION-DOS. ' + 'Rutina de copias y verificación de huellas. '.repeat(30),
  'SECCION-TRES. ' + 'Diagnóstico de fallos y escalado a la persona. '.repeat(30),
].join('\n\n');

async function withProject(run) {
  const world = await makeWorld({ docsA: { 'a.md': LARGO } });
  const services = servicesFor(world, { sessionId: 'sesion-a', cwd: world.dirA });
  const exec = fakeExec('sesion-a');
  try {
    return await withAuthorizedContext({ services, exec }, (ctx) => run({ ctx, world }));
  } finally {
    world.cleanup();
  }
}

test('F-4: `get` acepta el `chunkKey` que devuelve `search` y devuelve ESE fragmento', async () => {
  await withProject(async ({ ctx, world }) => {
    const found = await searchScopes(ctx, { query: 'SECCION-DOS', limit: 5, config: world.config, embedder: createEmbedder(world.config) });
    assert.ok(found.results.length > 0, 'la búsqueda debe encontrar el documento');
    const row = found.results[0];
    assert.match(row.chunkKey, /^src_[A-Za-z0-9_-]+#\d+$/, 'search publica chunkKey con la forma documentada');

    const got = getAcross(ctx, { ref: row.chunkKey, limit: 200 });
    assert.equal(got.source.id, row.sourceId, 'resuelve la fuente PROPIETARIA del fragmento');
    assert.equal(got.matched.by, 'chunk-key', 'declara por qué forma se resolvió la referencia');
    assert.equal(got.matched.ordinal, row.ordinal, 'respeta el ordinal pedido');
    assert.equal(got.chunks.length, 1, 'devuelve el fragmento pedido, no el documento entero');
    assert.equal(got.chunks[0].chunkKey, row.chunkKey);
    assert.equal(got.chunks[0].ordinal, row.ordinal);
    assert.match(got.chunks[0].text, /SECCION-DOS/);
  });
});

test('F-4: el `chunkKey` de cada fragmento devuelve su propio ordinal, no siempre el primero', async () => {
  await withProject(async ({ ctx }) => {
    const row = listProject(ctx, { limit: 200 }).rows.find((item) => String(item.uri).endsWith('a.md'));
    const source = getAcross(ctx, { ref: row.id, limit: 200 }).source;
    const all = getAcross(ctx, { ref: source.id, limit: 200 }).chunks;
    assert.ok(all.length >= 2, 'el documento de prueba tiene varios fragmentos: ' + all.length);

    for (const chunk of all) {
      const one = getAcross(ctx, { ref: chunk.chunkKey, limit: 200 });
      assert.equal(one.chunks.length, 1);
      assert.equal(one.chunks[0].ordinal, chunk.ordinal);
      assert.equal(one.chunks[0].chunkKey, chunk.chunkKey);
      assert.equal(one.chunks[0].text, chunk.text, 'el texto del fragmento viaja íntegro');
    }
  });
});

test('F-4: compatibilidad — id y URI siguen devolviendo todos los fragmentos', async () => {
  await withProject(async ({ ctx }) => {
    // La URI la guarda la ingesta tal cual (absoluta): se toma de la lista, no se supone.
    const listed = listProject(ctx, { limit: 200 });
    const row = listed.rows.find((item) => String(item.uri).endsWith('a.md'));
    assert.ok(row, 'la fuente sembrada está en el proyecto');
    const byId = getAcross(ctx, { ref: row.id, limit: 200 });
    const allChunks = byId.chunks.length;
    assert.ok(allChunks >= 2, 'el documento de prueba debe tener varios fragmentos');
    assert.equal(byId.matched, undefined, 'sin chunkKey no se inventa el marcador `matched`');

    for (const ref of [row.id, row.uri]) {
      const got = getAcross(ctx, { ref, limit: 200 });
      assert.equal(got.source.id, row.id, 'la referencia ' + ref + ' resuelve la misma fuente');
      assert.equal(got.chunks.length, allChunks, 'y devuelve la lista completa de fragmentos');
      assert.equal(got.matched, undefined);
    }
  });
});

test('F-4: ordinal inexistente → source-not-found con motivo chunk-not-found', async () => {
  await withProject(async ({ ctx }) => {
    const sourceId = listProject(ctx, { limit: 200 }).rows.find((item) => String(item.uri).endsWith('a.md')).id;
    assert.throws(
      () => getAcross(ctx, { ref: sourceId + '#9999' }),
      (error) => error.code === 'source-not-found'
        && error.details.reason === 'chunk-not-found'
        && error.details.ordinal === 9999
        && error.details.sourceId === sourceId,
      'no se inventa una familia nueva de errores: se usa la contractual',
    );
  });
});

test('F-4: referencias malformadas o ajenas caen en el error de siempre, sin romper nada', async () => {
  await withProject(async ({ ctx }) => {
    for (const ref of ['src_inexistente#0', '#0', 'src_x#abc', 'src_x#', 'manual.md#1']) {
      assert.throws(
        () => getAcross(ctx, { ref }),
        (error) => error.code === 'source-not-found',
        'la referencia ' + JSON.stringify(ref) + ' debe dar source-not-found',
      );
    }
  });
});

test('F-4: un fichero cuya ruta contiene `#` no se confunde con un fragmento', async () => {
  const world = await makeWorld();
  try {
    // `makeWorld` siembra siempre `a.md`/`b.md`; este fichero se ingiere aparte para tener un nombre
    // con `#`, que es justo lo que la forma de `chunkKey` podría confundir.
    await seedScope({
      profileRootPath: world.root, profileKey: 'pa3-test',
      scope: { kind: 'prj', id: world.projectA.id }, dir: world.dirA,
      docs: { 'notas#1.md': '# Notas\n\ncontenido con numeral en el nombre\n' }, config: world.config,
    });
    const services = servicesFor(world, { sessionId: 'sesion-a', cwd: world.dirA });
    await withAuthorizedContext({ services, exec: fakeExec('sesion-a') }, (ctx) => {
      const withHash = listProject(ctx, { limit: 200 }).rows.find((item) => String(item.uri).includes('notas#1.md'));
      assert.ok(withHash, 'la fuente con # en el nombre está indexada');
      const got = getAcross(ctx, { ref: withHash.uri, limit: 200 });
      assert.equal(got.source.id, withHash.id, 'se resolvió por URI, no por forma de chunkKey');
      assert.equal(got.matched, undefined);
      assert.equal(got.chunks.length, 1);
    });
  } finally {
    world.cleanup();
  }
});
