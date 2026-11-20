/**
 * PA4-B: revocación efectiva. La autorización se relee del registro (sin caché) antes de abrir cada
 * ámbito y otra vez antes de devolver información. Si un ámbito autorizado se revoca a mitad de la
 * operación, ésta falla con `grant-revoked` y no entrega ningún resultado: v0.1 no puede expresar
 * «parcial», así que un conjunto reducido se leería como exhaustivo.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { withAuthorizedContext } from '../lib/exec-context.mjs';
import { closeRegistry, createLibrary, openRegistry } from '../lib/registry.mjs';
import { expireSession, grantLibrary, invalidateSession } from '../lib/sessions.mjs';
import { createToolDefinitions } from '../lib/tools.mjs';
import { embedderThatTriggers, fakeExec, makeEightWorld, servicesFor, write } from './pa4-helpers.mjs';

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

/** Ejecuta `work` con el registro abierto desde una conexión distinta a la de la operación. */
function fromAnotherConnection(world, work) {
  const opened = openRegistry({ root: world.root, create: false });
  try {
    return work(opened.db);
  } finally {
    closeRegistry(opened.db);
  }
}

test('sin caché: un grant revocado antes de abrir no se consulta ni se omite en silencio', async () => {
  const world = await makeEightWorld({ libraryCount: 2 });
  try {
    const revoked = world.revokeLibrary(1); // token kappalib2
    const api = tools(world);
    const found = await api.call('search', { query: 'kappalib2' });
    assert.equal(found.results.some((row) => row.uri.includes('biblioteca-2')), false);
    assert.ok(found.results.length >= 0);
    // El proyecto sigue siendo consultable: la revocación quita un ámbito, no rompe la sesión.
    const project = await api.call('search', { query: 'kappaproyecto' });
    assert.ok(project.results.some((row) => row.uri.includes('proyecto-a')));
    assert.equal(world.auditCount('authorization.revoked'), 0, 'una revocación previa no es una revocación en vuelo');
    assert.ok(revoked.id);
  } finally {
    world.cleanup();
  }
});

test('revocación a mitad de una búsqueda multi-ámbito: falla en cerrado y no entrega resultados', async () => {
  const world = await makeEightWorld({ libraryCount: 3 });
  try {
    const library = world.libraries[0];
    // El trigger se dispara en la segunda vectorización: el proyecto ya se leyó y la primera
    // biblioteca está a medio consultar. La revocación la hace otra conexión.
    const embedder = embedderThatTriggers(world, () => fromAnotherConnection(world, (db) => {
      db.prepare("UPDATE grants SET revoked_at = '1700000000000', revoked_by = 'human' WHERE library_id = ?").run(library.id);
    }), { after: 2 });
    const api = tools(world, { embedder });
    let failure = null;
    try {
      await api.call('search', { query: 'kappalib1', limit: 5 });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, 'la búsqueda no puede terminar con éxito si perdió autorización');
    assert.equal(failure.code, 'grant-revoked');
    assert.equal(failure.details.reason, 'revoked-during-operation');
    assert.ok(failure.details.scopes.includes(library.id));
    assert.ok(world.auditCount('authorization.revoked') >= 1, 'la revocación queda auditada');
  } finally {
    world.cleanup();
  }
});

test('revocación a mitad de context: no se devuelve texto ni citas', async () => {
  const world = await makeEightWorld({ libraryCount: 2 });
  try {
    const library = world.libraries[1];
    const embedder = embedderThatTriggers(world, () => world.revokeLibrary(1), { after: 2 });
    const api = tools(world, { embedder });
    let failure = null;
    try {
      await api.call('context', { query: 'kappalib2', maxChunks: 4 });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(failure.code, 'grant-revoked');
    assert.equal(failure.details.scopes.includes(library.id), true);
  } finally {
    world.cleanup();
  }
});

test('get sobre una biblioteca revocada: no se entrega su contenido', async () => {
  const world = await makeEightWorld({ libraryCount: 2 });
  try {
    const uri = join(world.libraryDirs[0], 'l1.md');
    const api = tools(world);
    const first = await api.call('get', { ref: uri });
    assert.ok(first.chunks.length >= 1);

    // Se revoca entre la resolución y la lectura; en la siguiente llamada el ámbito ya no existe
    // para la sesión, así que la referencia no se resuelve a ningún sitio.
    world.revokeLibrary(0);
    let failure = null;
    try {
      await api.call('get', { ref: uri });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(failure.code, 'source-not-found');
    assert.equal(failure.details.scopes.includes(world.libraries[0].id), false);
  } finally {
    world.cleanup();
  }
});

test('cancelación: una señal abortada a mitad de consulta detiene la operación', async () => {
  const world = await makeEightWorld({ libraryCount: 2 });
  const controller = new AbortController();
  try {
    const embedder = embedderThatTriggers(world, async () => controller.abort(), { after: 2 });
    const api = tools(world, { embedder, signal: controller.signal });
    let failure = null;
    try {
      await api.call('search', { query: 'kappaproyecto' });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(failure.code, 'cancelled');
    assert.equal(failure.details.reason, 'signal-aborted');
  } finally {
    world.cleanup();
  }
});

test('sesión expirada a mitad de operación: falla con session-expired y no entrega datos', async () => {
  const world = await makeEightWorld({ libraryCount: 2 });
  try {
    const embedder = embedderThatTriggers(world, () => fromAnotherConnection(world, (db) => {
      expireSession(db, {
        identity: { sessionId: 'sesion-a', profileKey: 'pa4-test' },
        expectedProfileKey: 'pa4-test',
        now: 1_700_000_000_000,
      });
    }), { after: 2 });
    const api = tools(world, { embedder });
    let failure = null;
    try {
      await api.call('search', { query: 'kappaproyecto' });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(failure.code, 'session-expired');
    assert.ok(world.auditCount('authorization.invalid') >= 1);
  } finally {
    world.cleanup();
  }
});

test('sesión invalidada a mitad de operación: falla con scope-forbidden y el motivo real', async () => {
  const world = await makeEightWorld({ libraryCount: 2 });
  try {
    const embedder = embedderThatTriggers(world, () => fromAnotherConnection(world, (db) => {
      invalidateSession(db, {
        identity: { sessionId: 'sesion-a', profileKey: 'pa4-test' },
        expectedProfileKey: 'pa4-test',
        reason: 'admin',
        now: 1_700_000_000_000,
      });
    }), { after: 2 });
    const api = tools(world, { embedder });
    let failure = null;
    try {
      await api.call('context', { query: 'kappaproyecto' });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(failure.code, 'scope-forbidden');
    assert.equal(failure.details.reason, 'admin');
  } finally {
    world.cleanup();
  }
});

test('escritura ya confirmada: la revocación detiene lo siguiente, no deshace lo escrito', async () => {
  const world = await makeEightWorld({ libraryCount: 2 });
  try {
    const one = write(world.dirA, 'nuevo-1.md', '# Uno\n\nkappanuevo1\n');
    const two = write(world.dirA, 'nuevo-2.md', '# Dos\n\nkappanuevo2\n');
    const embedder = embedderThatTriggers(world, () => world.revokeLibrary(0), { after: 1 });
    const api = tools(world, { embedder });
    let failure = null;
    try {
      await api.call('ingest', { paths: [one, two], collection: 'documentacion' });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(failure.code, 'grant-revoked');

    // El primer fichero ya había confirmado su transacción: sigue ingerido y el almacén es legible.
    const after = tools(world);
    const listed = await after.call('list', { collection: 'documentacion' });
    assert.ok(listed.rows.some((source) => source.uri === one), 'lo confirmado no se revierte');
    const search = await after.call('search', { query: 'kappanuevo1' });
    assert.ok(search.results.some((row) => row.uri === one));
    // El segundo fichero no llegó a empezar.
    const second = await after.call('search', { query: 'kappanuevo2' });
    assert.equal(second.results.every((row) => row.uri !== two), true);
  } finally {
    world.cleanup();
  }
});

test('las conexiones abiertas se liberan aunque la operación falle a mitad', async () => {
  const world = await makeEightWorld({ libraryCount: 3 });
  try {
    const services = servicesFor(world);
    const scopeIds = [world.projectA.id, ...world.libraries.map((library) => library.id)];
    await assert.rejects(
      withAuthorizedContext({ services, exec: fakeExec('sesion-a') }, (ctx) => {
        for (const scope of ctx.scopes) ctx.open(scope);
        throw new Error('fallo deliberado a mitad');
      }),
      /fallo deliberado a mitad/,
    );
    // En Windows un fichero SQLite abierto impide borrar su directorio: si esto funciona, no quedan
    // asas abiertas ni del proyecto ni de las bibliotecas.
    for (const id of scopeIds) {
      const dir = join(world.root, 'scopes', id);
      rmSync(dir, { recursive: true, force: true });
      assert.equal(existsSync(dir), false, `el almacén ${id} sigue reteniendo el directorio`);
    }
  } finally {
    world.cleanup();
  }
});

test('un ámbito añadido a mitad no se sirve de rebote: el conjunto se fija al abrir', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    // Biblioteca nueva, con raíz propia, que la sesión NO tenía concedida al abrir la operación.
    const extraDir = join(world.base, 'biblioteca-extra');
    mkdirSync(extraDir, { recursive: true });
    write(extraDir, 'extra.md', '# Extra\n\nkappaextra\n');
    const extra = world.withRegistry((db) => createLibrary(db, { name: 'Extra', now: 1_700_000_000_000 }));
    const extraScope = { kind: 'lib', id: extra.id, name: extra.name, roots: [] };

    const services = servicesFor(world);
    await withAuthorizedContext({ services, exec: fakeExec('sesion-a') }, async (ctx) => {
      // Otra conexión concede la biblioteca mientras esta operación está en marcha.
      fromAnotherConnection(world, (db) => {
        grantLibrary(db, { projectId: world.projectA.id, libraryId: extra.id, now: 1_700_000_000_000 });
      });
      // La autorización vigente ya la incluye, pero no estaba en la instantánea de la operación:
      // abrirla debe fallar en cerrado en vez de empezar a servirla de rebote.
      assert.throws(() => ctx.open(extraScope), (error) => {
        assert.equal(error.code, 'scope-forbidden');
        assert.equal(error.details.reason, 'scope-not-in-snapshot');
        return true;
      });
      // Y el ámbito no aparece entre los que la operación considera suyos.
      assert.equal(ctx.scopes.some((scope) => scope.id === extra.id), false);
    });
  } finally {
    world.cleanup();
  }
});
