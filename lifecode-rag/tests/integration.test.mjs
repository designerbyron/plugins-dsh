/**
 * PA3: integración de las siete herramientas con identidad, registro, resolución y grants.
 *
 * Cada prueba construye un perfil temporal; ninguna abre el perfil real ni el almacén vivo.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createToolDefinitions } from '../lib/tools.mjs';
import { openRegistry, closeRegistry } from '../lib/registry.mjs';
import { openScopeStore } from '../lib/scope-stores.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { createEmbedder } from '../lib/embedders.mjs';
import { profileRoot } from '../lib/profile.mjs';
import { fakeExec, makeWorld, servicesFor, write } from './pa3-helpers.mjs';

function defsFor(world, options = {}, sessionId = 'sesion-a') {
  const services = servicesFor(world, { ...options, sessionId });
  const definitions = createToolDefinitions({ config: world.config, services });
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  return {
    services,
    definitions,
    call(name, args) {
      const definition = byName.get(`lifecode_rag_${name}`);
      assert.ok(definition, `no existe lifecode_rag_${name}`);
      return definition.execute(args, fakeExec(sessionId));
    },
  };
}

test('las siete herramientas mantienen nombres, parámetros y orden del contrato v0.1', () => {
  const worldless = createToolDefinitions({ config: undefined, services: {} });
  const names = worldless.map((definition) => definition.name);
  assert.deepEqual(names, [
    'lifecode_rag_ingest', 'lifecode_rag_search', 'lifecode_rag_context', 'lifecode_rag_get',
    'lifecode_rag_list', 'lifecode_rag_forget', 'lifecode_rag_reindex',
  ]);
  for (const definition of worldless) {
    assert.equal(definition.parameters.type, 'object');
    assert.equal(definition.parameters.additionalProperties, false);
  }
  const byName = Object.fromEntries(worldless.map((definition) => [definition.name, definition.parameters]));
  assert.deepEqual(byName.lifecode_rag_ingest.required, ['paths']);
  assert.deepEqual(byName.lifecode_rag_search.required, ['query']);
  assert.deepEqual(byName.lifecode_rag_get.required, ['ref']);
  assert.deepEqual(byName.lifecode_rag_forget.required, ['ref']);
  assert.deepEqual(byName.lifecode_rag_reindex.required, ['operation']);
  assert.deepEqual(byName.lifecode_rag_reindex.properties.operation.enum, ['fts', 'vectors', 'all']);
  // No se añaden project_id/scope_id/session_id al contrato público.
  for (const parameters of Object.values(byName)) {
    for (const forbidden of ['project_id', 'scope_id', 'session_id']) {
      assert.equal(parameters.properties[forbidden], undefined);
    }
  }
});

test('ingest escribe en el almacén del proyecto y search lo encuentra sin ver otros proyectos', async () => {
  const world = await makeWorld();
  try {
    const nuevo = write(world.dirA, 'nuevo.md', '# Nuevo\n\nkappanuevo\n');
    const tools = defsFor(world);
    const result = await tools.call('ingest', { paths: nuevo, collection: 'documentacion' });
    assert.equal(result.ingested.length, 1);
    assert.equal(result.ingested[0].uri, nuevo);

    const found = await tools.call('search', { query: 'kappanuevo' });
    assert.ok(found.results.length >= 1);
    assert.ok(found.results.some((row) => row.uri === nuevo));

    const other = defsFor(world, {}, 'sesion-b');
    const cross = await other.call('search', { query: 'kappanuevo' });
    assert.ok(cross.results.every((row) => row.uri !== nuevo), 'B no puede ver lo ingerido por A');
  } finally {
    world.cleanup();
  }
});

test('A y B no se ven entre sí, ni siquiera con términos compartidos', async () => {
  const world = await makeWorld({
    docsA: { 'a.md': '# Alfa\n\nkappalfa\n' },
    docsB: { 'b.md': '# Beta\n\nkappabeta\n' },
  });
  try {
    const a = defsFor(world);
    const b = defsFor(world, {}, 'sesion-b');
    const fromA = await a.call('search', { query: 'kappalfa' });
    assert.ok(fromA.results.every((row) => !row.uri.includes('proyecto-b')));
    assert.ok(fromA.results.some((row) => row.uri.includes('proyecto-a')));
    const fromB = await b.call('search', { query: 'kappabeta' });
    assert.ok(fromB.results.every((row) => !row.uri.includes('proyecto-a')));
    assert.ok(fromB.results.some((row) => row.uri.includes('proyecto-b')));
  } finally {
    world.cleanup();
  }
});

test('una biblioteca concedida se consulta; B no la ve aunque comparta término', async () => {
  const world = await makeWorld({
    docsLib: { 'lib.md': '# Biblioteca\n\nkappagamma\n' },
  });
  try {
    const a = defsFor(world);
    const found = await a.call('search', { query: 'kappagamma' });
    assert.ok(found.results.some((row) => row.uri.includes('biblioteca-a1')), 'A debe ver su biblioteca concedida');

    const b = defsFor(world, {}, 'sesion-b');
    const cross = await b.call('search', { query: 'kappagamma' });
    assert.ok(cross.results.every((row) => !row.uri.includes('biblioteca-a1')), 'B no tiene grant sobre A1');
  } finally {
    world.cleanup();
  }
});

test('revocar el grant impide nuevas consultas a esa biblioteca', async () => {
  const world = await makeWorld({
    docsLib: { 'lib.md': '# Biblioteca\n\nkapparevocable\n' },
  });
  try {
    const a = defsFor(world);
    assert.ok((await a.call('search', { query: 'kapparevocable' })).results.length >= 1);
    world.revokeLibrary();
    const after = await a.call('search', { query: 'kapparevocable' });
    assert.ok(after.results.every((row) => !row.uri.includes('biblioteca-a1')), 'tras revocar, la biblioteca deja de consultarse');
  } finally {
    world.cleanup();
  }
});

test('sin selección y con cwd dentro de una raíz, resuelve por cwd; fuera, falla en cerrado', async () => {
  const world = await makeWorld();
  try {
    const resolved = defsFor(world, { cwd: world.dirA }, 'sesion-cwd');
    const hits = await resolved.call('search', { query: 'kappalfa' });
    assert.ok(hits.results.length >= 1);

    const outside = defsFor(world, { cwd: join(world.base, 'fuera') }, 'sesion-cwd');
    await assert.rejects(() => outside.call('search', { query: 'alfa' }), (error) => {
      assert.equal(error.code, 'scope-unresolved');
      return true;
    });
  } finally {
    world.cleanup();
  }
});

test('identidad ausente y registro ausente fallan en cerrado antes de abrir nada', async () => {
  const world = await makeWorld();
  try {
    const services = servicesFor(world);
    const definitions = createToolDefinitions({ config: world.config, services });
    const search = definitions.find((definition) => definition.name === 'lifecode_rag_search');
    await assert.rejects(() => search.execute({ query: 'alfa' }, { callId: 'x' }), (error) => {
      assert.equal(error.code, 'session-invalid');
      return true;
    });

    const orphan = { ...world, env: { LIFECODE_RAG_ROOT: join(world.base, 'perfil-vacio'), DSH_PROFILE: 'pa3-test' } };
    const withoutRegistry = defsFor(orphan);
    await assert.rejects(() => withoutRegistry.call('search', { query: 'alfa' }), (error) => {
      assert.equal(error.code, 'registry-unavailable');
      return true;
    });
  } finally {
    world.cleanup();
  }
});

test('un almacén de biblioteca corrupto cierra en falso y no entrega un resultado que parezca completo', async () => {
  const world = await makeWorld({ docsLib: { 'lib.md': '# Biblioteca\n\ncorrupta\n' } });
  try {
    const libStore = join(world.root, 'scopes', world.library.id, 'rag.sqlite3');
    assert.ok(existsSync(libStore));
    writeFileSync(libStore, 'no es sqlite', 'utf8');

    const a = defsFor(world);
    // PA4-F: v0.1 no puede expresar «parcial», así que una biblioteca autorizada ilegible aborta la
    // búsqueda. Antes (PA3) se devolvían sólo los resultados del proyecto.
    await assert.rejects(() => a.call('search', { query: 'alfa' }), (error) => {
      assert.equal(error.code, 'scope-store-corrupt');
      assert.equal(error.details.scopeId, world.library.id);
      return true;
    });
  } finally {
    world.cleanup();
  }
});

test('get resuelve una fuente de biblioteca cuando es inequívoca', async () => {
  const world = await makeWorld({ docsLib: { 'lib.md': '# Biblioteca\n\nzeta unica\n' } });
  try {
    const a = defsFor(world);
    const rows = await a.call('list', {});
    assert.ok(rows.rows.every((row) => !row.uri.includes('biblioteca-a1')), 'list es sólo del proyecto');

    const ref = join(world.dirLib, 'lib.md');
    const got = await a.call('get', { ref });
    assert.equal(got.source.uri, ref);
    assert.ok(got.chunks.length >= 1);
    assert.equal(got.chunks[0].ordinal, 0);
  } finally {
    world.cleanup();
  }
});

test('get falla por ambigüedad si la misma fuente existe en proyecto y biblioteca', async () => {
  const world = await makeWorld({ docsLib: { 'lib.md': '# Biblioteca\n\ncontenido\n' } });
  try {
    // la misma ruta y el mismo uri en dos almacenes: el identificador colisiona a propósito
    const source = join(world.dirA, 'a.md');
    const db = openScopeStore({
      profileRoot: world.root, profileKey: 'pa3-test', scope: { kind: 'lib', id: world.library.id }, create: false,
    });
    try {
      await ingestFiles({
        db, root: world.dirLib, files: [source], collection: 'documentacion', config: world.config, embedder: createEmbedder(world.config),
      });
    } finally {
      db.close();
    }

    const a = defsFor(world);
    await assert.rejects(() => a.call('get', { ref: source }), (error) => {
      assert.equal(error.code, 'invalid-argument');
      assert.equal(error.details.reason, 'ambiguous-ref');
      return true;
    });
  } finally {
    world.cleanup();
  }
});

test('forget no borra fuentes de biblioteca y exige aprobación para las del proyecto', async () => {
  const world = await makeWorld({ docsLib: { 'lib.md': '# Biblioteca\n\nkappaintocable\n' } });
  try {
    const a = defsFor(world);
    const libraryRef = join(world.dirLib, 'lib.md');
    await assert.rejects(() => a.call('forget', { ref: libraryRef }), (error) => {
      assert.equal(error.code, 'invalid-argument');
      assert.equal(error.details.reason, 'library-read-only');
      return true;
    });

    const projectRef = join(world.dirA, 'a.md');
    const denied = defsFor(world, { approve: false });
    await assert.rejects(() => denied.call('forget', { ref: projectRef }), (error) => {
      assert.equal(error.code, 'approval-required');
      return true;
    });

    const removed = await a.call('forget', { ref: projectRef });
    assert.equal(removed.forgotten, true);
    assert.equal(removed.uri, projectRef);
    const after = await a.call('search', { query: 'kappalfa' });
    assert.ok(after.results.every((row) => row.uri !== projectRef));
    assert.ok((await a.call('search', { query: 'kappaintocable' })).results.length >= 1, 'la biblioteca sigue intacta');
  } finally {
    world.cleanup();
  }
});

test('reindex exige aprobación y sólo toca el proyecto', async () => {
  const world = await makeWorld({ docsLib: { 'lib.md': '# Biblioteca\n\nkappareindex\n' } });
  try {
    const a = defsFor(world);
    const denied = defsFor(world, { approve: false });
    await assert.rejects(() => denied.call('reindex', { operation: 'all' }), (error) => {
      assert.equal(error.code, 'approval-required');
      return true;
    });
    const result = await a.call('reindex', { operation: 'all' });
    assert.equal(result.operation, 'all');
    assert.ok(result.rebuiltChunks >= 1);
    assert.ok(result.rebuiltSources >= 1);
    assert.ok((await a.call('search', { query: 'kappareindex' })).results.length >= 1);
  } finally {
    world.cleanup();
  }
});

test('list y get se limitan a los ámbitos autorizados y no hay fallback global', async () => {
  const world = await makeWorld();
  try {
    const a = defsFor(world);
    const list = await a.call('list', {});
    assert.equal(list.total, 1);
    assert.ok(list.rows[0].uri.includes('proyecto-a'));

    const b = defsFor(world, {}, 'sesion-b');
    const bList = await b.call('list', {});
    assert.equal(bList.total, 1);
    assert.ok(bList.rows[0].uri.includes('proyecto-b'));

    const bGetA = await b.call('get', { ref: join(world.dirA, 'a.md') });
    assert.fail(`B no debería leer A, pero devolvió ${bGetA.source.uri}`);
  } catch (error) {
    assert.equal(error.code, 'source-not-found');
  } finally {
    world.cleanup();
  }
});

test('context falla en cerrado si una biblioteca autorizada no se puede abrir', async () => {
  const world = await makeWorld({ docsLib: { 'lib.md': '# Biblioteca\n\nkappacontexto\n' } });
  try {
    const libStore = join(world.root, 'scopes', world.library.id, 'rag.sqlite3');
    writeFileSync(libStore, 'no es una base de datos', 'utf8');
    const a = defsFor(world);
    // PA4-F: un ámbito autorizado ilegible aborta también `context`; no se devuelve texto que
    // parezca completo cuando falta una biblioteca entera.
    await assert.rejects(() => a.call('context', { query: 'kappacontexto' }), (error) => {
      assert.equal(error.code, 'scope-store-corrupt');
      assert.equal(error.details.scopeId, world.library.id);
      return true;
    });
  } finally {
    world.cleanup();
  }
});

test('la salida de context conserva exactamente los campos del contrato v0.1', async () => {
  const world = await makeWorld({ docsLib: { 'lib.md': '# Biblioteca\n\nkappacampos\n' } });
  try {
    const a = defsFor(world);
    const value = await a.call('context', { query: 'kappacampos' });
    assert.deepEqual(Object.keys(value).sort(), ['citations', 'considered', 'text', 'tokens', 'truncated']);
    assert.ok(value.citations.length >= 1);
    assert.deepEqual(Object.keys(value.citations[0]).sort(), [
      'charEnd', 'charStart', 'chunkKey', 'heading', 'n', 'ordinal', 'sourceId', 'title', 'uri',
    ]);
  } finally {
    world.cleanup();
  }
});
