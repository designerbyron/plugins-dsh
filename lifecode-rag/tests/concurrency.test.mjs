/**
 * PA4-E: concurrencia y escala con la capacidad máxima (un proyecto + siete bibliotecas = ocho
 * ámbitos), dos sesiones y varias conexiones.
 *
 * Qué se mide y por qué:
 * - apertura de los ocho almacenes, resolución y búsqueda: son los tres costes que crecen con el
 *   número de ámbitos, y los umbrales se fijan con holgura sobre lo observado (no son objetivos de
 *   producto: son guardas contra regresiones de orden de magnitud).
 * - contención: un bloqueo de escritura debe producir un error reintentable, nunca un almacén
 *   corrupto ni una autorización perdida.
 * - cierre: en Windows un SQLite abierto retiene su directorio, así que poder borrarlo prueba que no
 *   quedaron asas abiertas.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { closeRegistry, openRegistry, registryIntegrity } from '../lib/registry.mjs';
import { openDatabase, quickCheck, withTransaction } from '../lib/db.mjs';
import { openScopeStore, scopeStoreDir } from '../lib/scope-stores.mjs';
import { withAuthorizedContext } from '../lib/exec-context.mjs';
import { createToolDefinitions } from '../lib/tools.mjs';
import { reindexProject } from '../lib/scope-ops.mjs';
import { expireSession } from '../lib/sessions.mjs';
import { fakeExec, makeEightWorld, servicesFor, write } from './pa4-helpers.mjs';

function tools(world, options = {}, sessionId = 'sesion-a') {
  const services = servicesFor(world, { ...options, sessionId });
  const definitions = createToolDefinitions({ config: world.config, services });
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const exec = fakeExec(sessionId, { signal: options.signal });
  return {
    services,
    call(name, args) {
      const definition = byName.get(`lifecode_rag_${name}`);
      assert.ok(definition, `no existe lifecode_rag_${name}`);
      return definition.execute(args, exec);
    },
  };
}

/** Umbrales con holgura sobre lo medido en este host; documentados en el informe de PA4. */
const LIMITS = Object.freeze({
  resolveMs: 500,
  openEightMs: 1500,
  searchEightMs: 4000,
  closeMs: 1000,
});

test('ocho ámbitos: se abren, se leen y se cierran sin dejar asas', async () => {
  const world = await makeEightWorld({ libraryCount: 7 });
  try {
    assert.equal(world.libraries.length, 7);
    const scopeIds = [world.projectA.id, ...world.libraries.map((library) => library.id)];
    assert.equal(scopeIds.length, 8);

    const started = process.hrtime.bigint();
    const services = servicesFor(world);
    const measured = await withAuthorizedContext({ services, exec: fakeExec('sesion-a') }, (ctx) => {
      assert.equal(ctx.scopes.length, 8);
      for (const scope of ctx.scopes) assert.ok(ctx.open(scope), `el ámbito ${scope.id} no abrió`);
      assert.equal(ctx.openedScopes.length, 8);
      return Date.now();
    });
    const openMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(measured);
    assert.ok(openMs < LIMITS.openEightMs, `abrir ocho ámbitos tardó ${openMs.toFixed(0)}ms`);

    // Sin asas: los ocho directorios se pueden borrar (en Windows un fichero abierto lo impide).
    for (const id of scopeIds) {
      const dir = scopeStoreDir(world.root, id);
      rmSync(dir, { recursive: true, force: true });
      assert.equal(existsSync(dir), false, `el almacén ${id} sigue reteniendo el directorio`);
    }
  } finally {
    world.cleanup();
  }
});

test('dos sesiones simultáneas no ven los ámbitos de la otra ni sus resultados', async () => {
  const world = await makeEightWorld({ libraryCount: 2 });
  try {
    const a = tools(world, {}, 'sesion-a');
    const b = tools(world, {}, 'sesion-b');
    const [fromA, fromB] = await Promise.all([
      a.call('search', { query: 'kappaproyecto kappalib1' }),
      b.call('search', { query: 'kappaproyectob' }),
    ]);
    assert.ok(fromA.results.some((row) => row.uri.includes('proyecto-a')));
    assert.ok(fromA.results.some((row) => row.uri.includes('biblioteca-1')));
    assert.equal(fromB.results.every((row) => !row.uri.includes('proyecto-a')), true);
    assert.equal(fromB.results.every((row) => !row.uri.includes('biblioteca-')), true);
    assert.ok(fromB.results.some((row) => row.uri.includes('proyecto-b')));
  } finally {
    world.cleanup();
  }
});

test('lectura concurrente mientras otra conexión escribe: WAL sirve el último estado confirmado', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'prj', id: world.projectA.id };
    const writer = openScopeStore({ profileRoot: world.root, profileKey: 'pa4-test', scope, create: false });
    try {
      const api = tools(world);
      const before = await api.call('search', { query: 'kappaproyecto' });
      // Escritura sin confirmar retenida en otra conexión: el lector no debe bloquearse ni verla.
      writer.exec('BEGIN IMMEDIATE');
      writer.prepare(`UPDATE sources SET title = 'sin confirmar' WHERE 1 = 1`).run();
      const during = await api.call('search', { query: 'kappaproyecto' });
      assert.equal(during.results.length, before.results.length);
      assert.equal(during.results.every((row) => row.title !== 'sin confirmar'), true);
      writer.exec('ROLLBACK');
    } finally {
      writer.close();
    }
  } finally {
    world.cleanup();
  }
});

test('escrituras concurrentes en ámbitos distintos: las dos confirman y ninguna pierde datos', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const fileA = write(world.dirA, 'concurrente-a.md', '# A\n\nkappaescrituraa\n');
    const fileB = write(world.dirB, 'concurrente-b.md', '# B\n\nkappaescriturab\n');
    const a = tools(world, {}, 'sesion-a');
    const b = tools(world, {}, 'sesion-b');
    const [resultA, resultB] = await Promise.all([
      a.call('ingest', { paths: [fileA], collection: 'documentacion' }),
      b.call('ingest', { paths: [fileB], collection: 'documentacion' }),
    ]);
    assert.equal(resultA.ingested.length, 1);
    assert.equal(resultB.ingested.length, 1);

    const foundA = await a.call('search', { query: 'kappaescrituraa' });
    const foundB = await b.call('search', { query: 'kappaescriturab' });
    assert.ok(foundA.results.some((row) => row.uri === fileA));
    assert.ok(foundB.results.some((row) => row.uri === fileB));
    // Aislamiento: cada proyecto sigue viendo sólo lo suyo.
    assert.equal(foundA.results.every((row) => row.uri !== fileB), true);
  } finally {
    world.cleanup();
  }
});

test('reindexación concurrente con búsquedas: no se corrompe y el índice queda completo', async () => {
  const world = await makeEightWorld({ libraryCount: 2 });
  try {
    const api = tools(world);
    const [reindexed, searched] = await Promise.all([
      api.call('reindex', { operation: 'all' }),
      api.call('search', { query: 'kappaproyecto' }),
    ]);
    assert.equal(reindexed.operation, 'all');
    assert.ok(reindexed.rebuiltChunks >= 1);
    assert.ok(searched.results.length >= 1);

    const scope = { kind: 'prj', id: world.projectA.id };
    const db = openScopeStore({ profileRoot: world.root, profileKey: 'pa4-test', scope, create: false });
    try {
      quickCheck(db);
      const chunks = Number(db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n);
      const vectors = Number(db.prepare('SELECT COUNT(*) AS n FROM vectors').get().n);
      assert.equal(vectors, chunks, 'toda fuente conserva sus vectores tras reindexar');
      assert.doesNotThrow(() =>
        db.prepare(`INSERT INTO chunks_fts(chunks_fts, rank) VALUES('integrity-check', 1)`).run());
    } finally {
      db.close();
    }
  } finally {
    world.cleanup();
  }
});

test('un bloqueo de escritura produce un error reintentable, no corrupción ni pérdida de autorización', {
  timeout: 60_000,
}, async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  let writer = null;
  try {
    const scope = { kind: 'prj', id: world.projectA.id };
    writer = openScopeStore({ profileRoot: world.root, profileKey: 'pa4-test', scope, create: false });
    writer.exec('BEGIN IMMEDIATE');
    writer.prepare(`UPDATE sources SET title = title WHERE 1 = 1`).run();

    const api = tools(world);
    const started = Date.now();
    // La ingesta no lanza por fichero: acumula el fallo en `errors[]`. Lo que no puede pasar es que
    // ese fallo se disfrace de éxito ni que salga del contrato como `internal`.
    const blocked = await api.call('ingest', {
      paths: [write(world.dirA, 'bloqueado.md', '# Bloqueado\n\nkappabloqueo\n')],
      collection: 'documentacion',
    });
    const elapsed = Date.now() - started;
    assert.equal(blocked.ingested.length, 0, 'una escritura bloqueada no puede fingir éxito');
    assert.equal(blocked.errors.length, 1);
    assert.equal(blocked.errors[0].code, 'store-busy');
    assert.equal(blocked.errors[0].retryable, true);
    assert.ok(!/database is locked/i.test(blocked.errors[0].message), 'no se filtra el mensaje crudo de SQLite');
    // El plazo es `busy_timeout` (5 s) por cada intento de escritura implicado.
    assert.ok(elapsed < 20_000, `el bloqueo tardó ${elapsed}ms en resolverse`);

    writer.exec('ROLLBACK');
    writer.close();
    writer = null;

    // Recuperado el bloqueo, la misma sesión sigue autorizada y el almacén sigue sano.
    const after = await api.call('ingest', {
      paths: [join(world.dirA, 'bloqueado.md')],
      collection: 'documentacion',
    });
    assert.equal(after.ingested.length, 1);
    const db = openScopeStore({ profileRoot: world.root, profileKey: 'pa4-test', scope, create: false });
    try {
      quickCheck(db);
    } finally {
      db.close();
    }
  } finally {
    if (writer) {
      try {
        writer.exec('ROLLBACK');
      } catch { /* la transacción pudo abortarse ya */ }
      writer.close();
    }
    world.cleanup();
  }
});

test('un almacén en migración es indisponible y reintentable, y se sirve al terminar', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const library = world.libraries[0];
    const scope = { kind: 'lib', id: library.id };
    const db = openScopeStore({ profileRoot: world.root, profileKey: 'pa4-test', scope, create: false });
    try {
      db.prepare(`UPDATE meta SET value='migrating' WHERE key='store_state'`).run();
    } finally {
      db.close();
    }
    const api = tools(world);
    let failure = null;
    try {
      await api.call('list', {});
    } catch (error) {
      failure = error;
    }
    // `list` sólo abre el proyecto; el bloqueo se ve al consultar la biblioteca.
    assert.equal(failure, null);
    failure = null;
    try {
      await api.call('search', { query: 'kappalib1' });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(failure.code, 'scope-store-unavailable');
    assert.equal(failure.details.retryable, true);

    const ready = new DatabaseSync(world.storeFile(library.id));
    try {
      ready.exec('PRAGMA busy_timeout = 5000');
      ready.prepare(`UPDATE meta SET value='ready' WHERE key='store_state'`).run();
    } finally {
      ready.close();
    }
    const after = await api.call('search', { query: 'kappalib1' });
    assert.ok(after.results.length >= 1);
  } finally {
    world.cleanup();
  }
});

test('resolución y búsqueda con ocho ámbitos quedan dentro de los umbrales medidos', async () => {
  const world = await makeEightWorld({ libraryCount: 7 });
  try {
    const api = tools(world);
    const resolveStarted = process.hrtime.bigint();
    await withAuthorizedContext({ services: servicesFor(world), exec: fakeExec('sesion-a') }, (ctx) => ctx.scopes.length);
    const resolveMs = Number(process.hrtime.bigint() - resolveStarted) / 1e6;
    assert.ok(resolveMs < LIMITS.resolveMs, `resolver ocho ámbitos tardó ${resolveMs.toFixed(0)}ms`);

    const searchStarted = process.hrtime.bigint();
    const found = await api.call('search', { query: 'kappaproyecto kappalib1' });
    const searchMs = Number(process.hrtime.bigint() - searchStarted) / 1e6;
    assert.ok(found.results.length >= 2);
    assert.ok(searchMs < LIMITS.searchEightMs, `buscar en ocho ámbitos tardó ${searchMs.toFixed(0)}ms`);

    // Métricas medidas: se devuelven para que el informe de PA4 cite números reales, no umbrales.
    assert.equal(found.measurements, undefined);
    console.log(`[pa4-e] resolución=${resolveMs.toFixed(1)}ms búsqueda8=${searchMs.toFixed(1)}ms ámbitos=8`);
  } finally {
    world.cleanup();
  }
});

test('cierre y reapertura: el registro y los almacenes vuelven con la misma integridad', async () => {
  const world = await makeEightWorld({ libraryCount: 3 });
  try {
    const before = world.withRegistry((db) => registryIntegrity(db));
    assert.equal(before.quickCheck, 'ok');
    assert.equal(before.foreignKeys, 0);

    // Se cierra todo y se reabre: mismo recuento de raíces y misma cadena de auditoría.
    const reopened = openRegistry({ root: world.root, create: false });
    try {
      const after = registryIntegrity(reopened.db);
      assert.equal(after.quickCheck, 'ok');
      assert.equal(after.foreignKeys, 0);
      assert.equal(after.roots, before.roots);
      assert.equal(after.audit.ok, true);
      assert.deepEqual(after.rootConflicts, []);
    } finally {
      closeRegistry(reopened.db);
    }

    // Tras la reapertura las herramientas siguen funcionando y la sesión conserva su autorización.
    const api = tools(world);
    const found = await api.call('search', { query: 'kappalib1' });
    assert.ok(found.results.length >= 1);
  } finally {
    world.cleanup();
  }
});

test('una sesión expirada no bloquea a otra: el aislamiento no depende del orden', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    world.withRegistry((db) => {
      expireSession(db, {
        identity: { sessionId: 'sesion-b', profileKey: 'pa4-test' },
        expectedProfileKey: 'pa4-test',
        now: 1_700_000_000_000,
      });
    });
    const b = tools(world, {}, 'sesion-b');
    let failure = null;
    try {
      await b.call('search', { query: 'kappaproyectob' });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(failure.code, 'session-expired');

    const a = tools(world, {}, 'sesion-a');
    const found = await a.call('search', { query: 'kappaproyecto' });
    assert.ok(found.results.length >= 1);
  } finally {
    world.cleanup();
  }
});

test('reindexar dos veces seguidas es idempotente en resultados y en vectores', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const services = servicesFor(world);
    const first = await withAuthorizedContext({ services, exec: fakeExec('sesion-a') }, (ctx) =>
      reindexProject(ctx, { operation: 'all', config: world.config, now: 1_700_000_000_000, exec: fakeExec('sesion-a') }).run());
    const second = await withAuthorizedContext({ services, exec: fakeExec('sesion-a') }, (ctx) =>
      reindexProject(ctx, { operation: 'all', config: world.config, now: 1_700_000_100_000, exec: fakeExec('sesion-a') }).run());
    assert.equal(first.rebuiltChunks, second.rebuiltChunks);
    assert.equal(first.rebuiltSources, second.rebuiltSources);

    const scope = { kind: 'prj', id: world.projectA.id };
    const opened = openDatabase({ root: join(world.root, 'scopes', scope.id) });
    try {
      const chunks = Number(opened.db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n);
      const vectors = Number(opened.db.prepare('SELECT COUNT(*) AS n FROM vectors').get().n);
      assert.equal(vectors, chunks);
    } finally {
      opened.db.close();
    }
  } finally {
    world.cleanup();
  }
});
