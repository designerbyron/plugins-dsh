/**
 * PA3 — matriz de aceptación, extremo a extremo por las siete herramientas.
 *
 * Estas pruebas cierran los huecos que `integration.test.mjs` no cubría de forma directa:
 *  - la biblioteca B1 concedida a B (simetría del aislamiento, no sólo «B no ve A1»),
 *  - la identidad mal formada y el perfil ajeno a través de la herramienta, no sólo del módulo,
 *  - la selección explícita incompatible con el `cwd` (nunca se rescata con una búsqueda global),
 *  - el cambio de proyecto de una sesión sin efecto sobre la otra,
 *  - el archivado del proyecto entre la vista previa y la escritura de `forget`,
 *  - la auditoría del propio almacén para `forget` y `reindex`.
 *
 * Todo perfil es temporal (mkdtemp). Ninguna prueba toca `$DSH_HOME` ni el almacén real.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { verifyAuditChain } from '../lib/audit.mjs';
import { withAuthorizedContext } from '../lib/exec-context.mjs';
import { closeRegistry, openRegistry } from '../lib/registry.mjs';
import { openScopeStore } from '../lib/scope-stores.mjs';
import { registerSelection } from '../lib/sessions.mjs';
import { createToolDefinitions } from '../lib/tools.mjs';
import { fakeExec, makeWorld, servicesFor } from './pa3-helpers.mjs';

function toolsFor(world, options = {}, sessionId = 'sesion-a') {
  const services = servicesFor(world, { ...options, sessionId });
  const byName = new Map(createToolDefinitions({ config: world.config, services })
    .map((definition) => [definition.name, definition]));
  return {
    services,
    call(name, args, exec = fakeExec(sessionId)) {
      const definition = byName.get(`lifecode_rag_${name}`);
      assert.ok(definition, `no existe lifecode_rag_${name}`);
      return definition.execute(args, exec);
    },
  };
}

test('PA3-B: la biblioteca de B no se ve desde A, ni la de A desde B', async () => {
  const world = await makeWorld({
    docsLib: { 'a1.md': '# A1\n\nalfauno solo de A1\n' },
    docsLibB: { 'b1.md': '# B1\n\nbetados solo de B1\n' },
  });
  try {
    const a = toolsFor(world);
    const b = toolsFor(world, {}, 'sesion-b');

    // Cada proyecto ve su propia biblioteca concedida.
    const aOwn = await a.call('search', { query: 'alfauno' });
    assert.ok(aOwn.results.some((row) => row.uri.endsWith('a1.md')));
    const bOwn = await b.call('search', { query: 'betados' });
    assert.ok(bOwn.results.some((row) => row.uri.endsWith('b1.md')));

    // Y no ve la del otro, ni por búsqueda ni por get. La búsqueda es híbrida: el vecino vectorial
    // siempre devuelve algo, así que lo que se afirma es que ninguna fila pertenece al otro ámbito.
    const aCross = await a.call('search', { query: 'betados' });
    assert.ok(aCross.results.every((row) => !row.uri.endsWith('b1.md')), 'A no puede obtener contenido de B1');
    const bCross = await b.call('search', { query: 'alfauno' });
    assert.ok(bCross.results.every((row) => !row.uri.endsWith('a1.md')), 'B no puede obtener contenido de A1');

    const b1Uri = join(world.dirLibB, 'b1.md');
    await assert.rejects(a.call('get', { ref: b1Uri }), (error) => error.code === 'source-not-found');
    const gotByB = await b.call('get', { ref: b1Uri });
    assert.equal(gotByB.source.uri, b1Uri);

    const listA = await a.call('list', {});
    assert.ok(listA.rows.every((row) => !String(row.uri).endsWith('b1.md')));

    // Revocar B1 sólo afecta a B: A conserva su biblioteca y B deja de ver la suya.
    world.revokeLibraryB();
    const aStill = await a.call('search', { query: 'alfauno' });
    assert.ok(aStill.results.some((row) => row.uri.endsWith('a1.md')));
    const bAfter = await b.call('search', { query: 'betados' });
    assert.ok(bAfter.results.every((row) => !row.uri.endsWith('b1.md')), 'revocado el grant, B1 desaparece de B');
  } finally {
    world.cleanup();
  }
});

test('PA3-B/E: ctx.open rechaza un ámbito fuera del conjunto autorizado aunque su almacén exista', async () => {
  const world = await makeWorld({ docsLib: { 'a1.md': '# A1\n\nalfauno\n' }, docsLibB: { 'b1.md': '# B1\n\nbetados\n' } });
  try {
    const services = servicesFor(world);
    const forbidden = { kind: 'lib', id: world.libraryB.id };
    await assert.rejects(
      withAuthorizedContext({ services, exec: fakeExec('sesion-a') }, (ctx) => {
        assert.equal(ctx.scopes.some((scope) => scope.id === forbidden.id), false);
        assert.equal(existsSync(join(world.root, 'scopes', forbidden.id, 'rag.sqlite3')), true,
          'el almacén existe: el rechazo no puede depender de que falte el fichero');
        ctx.open(forbidden);
      }),
      (error) => error.code === 'scope-forbidden' && error.details.reason === 'scope-not-in-snapshot',
    );
  } finally {
    world.cleanup();
  }
});

test('PA3-A: identidad ausente o mal formada falla antes de abrir ningún almacén', async () => {
  const world = await makeWorld();
  try {
    const tools = toolsFor(world);
    const malformed = [
      null,
      {},
      { agent: null },
      { agent: 'sesion-a' },
      { agent: {} },
      { agent: { id: '' } },
      { agent: { id: 'sesion\na' } },
      { agent: { id: 'x'.repeat(201) } },
    ];
    for (const exec of malformed) {
      await assert.rejects(
        tools.call('search', { query: 'alfa' }, exec),
        (error) => error.code === 'session-invalid',
        `la identidad ${JSON.stringify(exec)} debía rechazarse`,
      );
    }
  } finally {
    world.cleanup();
  }
});

test('PA3-A: un perfil distinto no cae al almacén por defecto ni crea un registro', async () => {
  const world = await makeWorld();
  try {
    const otherRoot = join(world.base, 'perfil-ajeno');
    const services = { ...servicesFor(world), env: { ...world.env, LIFECODE_RAG_ROOT: otherRoot, DSH_PROFILE: 'otro-perfil' } };
    const search = createToolDefinitions({ config: world.config, services })
      .find((definition) => definition.name === 'lifecode_rag_search');

    await assert.rejects(
      search.execute({ query: 'alfa' }, fakeExec('sesion-a')),
      (error) => error.code === 'registry-unavailable',
    );
    assert.equal(existsSync(otherRoot), false, 'sin registro no se crea perfil ni almacén');
  } finally {
    world.cleanup();
  }
});

test('PA3-A: selección explícita incompatible con el cwd es ambigua y no rescata datos', async () => {
  const world = await makeWorld();
  try {
    // Sesión A seleccionó el proyecto A, pero el host entrega el cwd del proyecto B.
    const tools = toolsFor(world, { cwd: world.dirB });
    await assert.rejects(
      tools.call('search', { query: 'beta' }),
      (error) => error.code === 'scope-ambiguous',
    );
    await assert.rejects(tools.call('list', {}), (error) => error.code === 'scope-ambiguous');
  } finally {
    world.cleanup();
  }
});

test('PA3-A: cambiar el proyecto de una sesión no altera la otra', async () => {
  const world = await makeWorld();
  try {
    const a = toolsFor(world);
    const b = toolsFor(world, {}, 'sesion-b');

    assert.ok((await a.call('search', { query: 'alfa' })).results.some((row) => row.uri.endsWith('a.md')));
    assert.ok((await b.call('search', { query: 'beta' })).results.some((row) => row.uri.endsWith('b.md')));

    const opened = openRegistry({ root: world.root, create: false });
    try {
      registerSelection(opened.db, {
        identity: { sessionId: 'sesion-a', profileKey: 'pa3-test' },
        expectedProfileKey: 'pa3-test',
        projectId: world.projectB.id,
      });
    } finally {
      closeRegistry(opened.db);
    }

    // El host entrega el cwd del proyecto recién seleccionado; con el cwd anterior la resolución
    // sería ambigua (y eso se prueba aparte), no un rescate silencioso.
    const cwd = world.dirB;
    const aMoved = createToolDefinitions({
      config: world.config,
      services: { ...servicesFor(world), workingDirectory: { async ensure() { return cwd; } } },
    });
    const moved = (name, args) => aMoved.find((definition) => definition.name === `lifecode_rag_${name}`)
      .execute(args, fakeExec('sesion-a'));

    // A pasa a ver B y deja de ver A; B no cambia.
    assert.ok((await moved('search', { query: 'beta' })).results.some((row) => row.uri.endsWith('b.md')));
    assert.ok((await moved('search', { query: 'alfa' })).results.every((row) => !row.uri.endsWith('a.md')));
    assert.ok((await b.call('search', { query: 'beta' })).results.some((row) => row.uri.endsWith('b.md')));
    assert.ok((await b.call('search', { query: 'alfa' })).results.every((row) => !row.uri.endsWith('a.md')));
  } finally {
    world.cleanup();
  }
});

test('PA3-C: ingest fuera de las raíces exige aprobación y no escribe si se rechaza', async () => {
  const world = await makeWorld();
  try {
    const foreign = join(world.base, 'externo');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, 'e.md'), '# Externo\n\ncontenido de fuera del proyecto\n', 'utf8');

    // Rechazo: la ruta se clasifica antes de abrir el almacén y no deja escritura parcial.
    const denied = toolsFor(world, { approve: false });
    await assert.rejects(
      denied.call('ingest', { paths: join(foreign, 'e.md') }),
      (error) => error.code === 'path-not-allowed',
    );
    const db = openScopeStore({ profileRoot: world.root, profileKey: 'pa3-test', scope: { kind: 'prj', id: world.projectA.id } });
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sources').get().n, 1, 'el rechazo no escribió nada');
    } finally {
      db.close();
    }

    // Aprobación: se indexa en el almacén del proyecto, nunca en otro ámbito.
    const allowed = toolsFor(world);
    const result = await allowed.call('ingest', { paths: join(foreign, 'e.md') });
    assert.equal(result.approvedOutside, true);
    const found = await allowed.call('search', { query: 'externo' });
    assert.ok(found.results.some((row) => row.uri.endsWith('e.md')));
  } finally {
    world.cleanup();
  }
});

test('PA3-D: archivar el proyecto entre la vista previa y la escritura impide el borrado', async () => {
  const world = await makeWorld();
  try {
    const services = servicesFor(world);
    services.approval = {
      async request() {
        const opened = openRegistry({ root: world.root, create: false });
        try {
          opened.db.prepare("UPDATE projects SET status='archived', archived_at=? WHERE id=?")
            .run(Date.now(), world.projectA.id);
        } finally {
          closeRegistry(opened.db);
        }
        return 'allowed-once';
      },
    };
    const forget = createToolDefinitions({ config: world.config, services })
      .find((definition) => definition.name === 'lifecode_rag_forget');
    const uri = join(world.dirA, 'a.md');

    await assert.rejects(
      forget.execute({ ref: uri }, fakeExec('sesion-a')),
      (error) => error.code === 'scope-forbidden' && error.details.reason === 'project-archived',
    );

    const db = openScopeStore({ profileRoot: world.root, profileKey: 'pa3-test', scope: { kind: 'prj', id: world.projectA.id } });
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM sources WHERE uri = ?').get(uri);
      assert.equal(row.n, 1, 'la fuente sigue existiendo: no se borró nada');
    } finally {
      db.close();
    }
  } finally {
    world.cleanup();
  }
});

test('PA3-D: forget y reindex dejan auditoría verificable en el almacén del proyecto', async () => {
  const world = await makeWorld();
  try {
    const tools = toolsFor(world);
    const uri = join(world.dirA, 'a.md');

    const reindexed = await tools.call('reindex', { operation: 'all' });
    assert.equal(reindexed.operation, 'all');
    const forgotten = await tools.call('forget', { ref: uri });
    assert.equal(forgotten.forgotten, true);

    const db = openScopeStore({ profileRoot: world.root, profileKey: 'pa3-test', scope: { kind: 'prj', id: world.projectA.id } });
    try {
      const actions = db.prepare('SELECT action FROM audit ORDER BY seq ASC').all().map((row) => row.action);
      assert.ok(actions.includes('reindex.fts'), `faltó reindex.fts en ${actions.join(',')}`);
      assert.ok(actions.includes('reindex.vectors'), `faltó reindex.vectors en ${actions.join(',')}`);
      assert.ok(actions.includes('forget'), `faltó forget en ${actions.join(',')}`);

      const audit = verifyAuditChain(db);
      assert.equal(audit.ok, true, `cadena de auditoría rota en ${audit.brokenAt} (${audit.reason})`);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sources WHERE uri = ?').get(uri).n, 0);
    } finally {
      db.close();
    }
  } finally {
    world.cleanup();
  }
});
