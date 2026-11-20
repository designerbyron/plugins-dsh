/**
 * PA4-F — resultados parciales y PA4-C — operaciones interrumpidas.
 *
 * PA4-F: el contrato público v0.1 no puede expresar «resultado parcial». La decisión D-PA4-F-01 es
 * fallar en cerrado cuando un ámbito autorizado no se puede consultar. Este fichero comprueba que
 * `search` y `context` nunca entregan un resultado que parezca exhaustivo sin serlo, sea cual sea la
 * causa (ausente, corrupta, revocada, ocupada), y que el proyecto sigue disponible para las
 * operaciones que no dependen del ámbito caído.
 *
 * PA4-C: una operación destructiva interrumpida deja una fila `started`; repetirla sin reconciliar
 * podría duplicar un efecto ya ocurrido, así que el sistema falla en cerrado con `operation-uncertain`
 * y la reconciliación sólo cierra la fila, nunca reejecuta el trabajo.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertNoInterruptedOperation,
  beginOperation,
  finishOperation,
  getOperation,
  listInterruptedOperations,
  listSteps,
  reconcileInterruptedOperations,
  recordStep,
} from '../lib/operations.mjs';
import { storeFileOf, fakeExec, makeEightWorld, servicesFor, write } from './pa4-helpers.mjs';

/**
 * Ejecuta una herramienta y devuelve `{ok, value, error}` sin propagar: la ausencia de resultado es
 * tan importante como el error, y aquí se comprueban las dos cosas.
 */
function attempt(definitions, name, args, exec) {
  const definition = definitions.find((item) => item.name === `lifecode_rag_${name}`);
  return definition.execute(args, exec).then(
    (value) => ({ ok: true, value, error: null }),
    (error) => ({ ok: false, value: null, error }),
  );
}

function definitionsFor(world, options = {}) {
  const { createToolDefinitions } = options.createToolDefinitions;
  return createToolDefinitions({ config: world.config, services: servicesFor(world, options) });
}

async function importTools() {
  return import('../lib/tools.mjs');
}

test('biblioteca ausente: search cierra en falso en vez de entregar sólo el proyecto', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const { createToolDefinitions } = await importTools();
    const definitions = createToolDefinitions({ config: world.config, services: servicesFor(world) });
    // La biblioteca desaparece del disco (no se borra del registro: la ausencia es un estado real).
    rmSync(world.storeFile(world.libraries[0].id), { force: true });
    const result = await attempt(definitions, 'search', { query: 'kappaproyecto kappalib1' }, fakeExec('sesion-a'));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'scope-store-unavailable');
    assert.equal(result.error.details.reason, 'library-missing');
    assert.equal(result.error.details.state, 'missing');
    assert.equal(result.error.details.retryable, false);
    // El ámbito se nombra: un error sin ámbito no se puede investigar.
    assert.ok(result.error.details.scope_id, 'el error identifica el ámbito ausente');
    // Y no se creó nada en su lugar.
    assert.equal(existsSync(world.storeFile(world.libraries[0].id)), false);
  } finally {
    world.cleanup();
  }
});

test('biblioteca corrupta: search no devuelve un subconjunto que parezca completo', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const { createToolDefinitions } = await importTools();
    const definitions = createToolDefinitions({ config: world.config, services: servicesFor(world) });
    const file = world.storeFile(world.libraries[0].id);
    write(join(file, '..'), 'rag.sqlite3', 'esto no es sqlite');
    const result = await attempt(definitions, 'search', { query: 'kappaproyecto kappalib1' }, fakeExec('sesion-a'));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'scope-store-corrupt');
    // La evidencia del fallo se conserva: el fichero ilegible sigue donde estaba.
    assert.equal(existsSync(file), true);
  } finally {
    world.cleanup();
  }
});

test('biblioteca revocada antes de la llamada: context no la incluye ni entrega su contenido', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const { createToolDefinitions } = await importTools();
    const definitions = createToolDefinitions({ config: world.config, services: servicesFor(world) });
    world.revokeLibrary(0);
    // Revocar antes de abrir no es un fallo: el ámbito revocado simplemente ya no forma parte de la
    // consulta. Lo prohibido es entregar su contenido o presentar el resultado como exhaustivo.
    const result = await attempt(definitions, 'context', { query: 'kappaproyecto kappalib1' }, fakeExec('sesion-a'));
    assert.equal(result.ok, true);
    assert.equal(result.value.text.includes('kappalib1'), false);
    assert.equal(result.value.citations.some((row) => row.chunkKey.includes(world.libraries[0].id)), false);
    // La revocación queda auditada en el registro y sigue sin reverirse sola.
    assert.ok(world.auditCount('grant.revoke') >= 1);
  } finally {
    world.cleanup();
  }
});

test('la biblioteca caída no inutiliza el proyecto: list sigue sirviendo; get falla en cerrado', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const { createToolDefinitions } = await importTools();
    const definitions = createToolDefinitions({ config: world.config, services: servicesFor(world) });
    rmSync(world.storeFile(world.libraries[0].id), { force: true });
    // `list` sólo mira el almacén del proyecto: la biblioteca caída no lo afecta.
    const listing = await attempt(definitions, 'list', { limit: 10 }, fakeExec('sesion-a'));
    assert.equal(listing.ok, true);
    assert.ok(listing.value.total >= 1);
    // `get` sí falla en cerrado: para decidir si la referencia es ambigua debe poder mirar TODOS los
    // ámbitos autorizados, y con uno ilegible no puede descartar que la fuente viva también allí.
    const got = await attempt(definitions, 'get', { ref: join(world.dirA, 'a.md') }, fakeExec('sesion-a'));
    assert.equal(got.ok, false);
    assert.equal(got.error.code, 'scope-store-unavailable');
    assert.equal(got.error.details.reason, 'library-missing');
    // Tampoco devuelve un resultado del proyecto que parezca la respuesta completa.
    assert.equal(got.value, null);
  } finally {
    world.cleanup();
  }
});

test('el valor de search de v0.1 no gana ningún campo de parcialidad', async () => {
  const world = await makeEightWorld({ libraryCount: 2 });
  try {
    const { createToolDefinitions } = await importTools();
    const definitions = createToolDefinitions({ config: world.config, services: servicesFor(world) });
    const result = await attempt(definitions, 'search', { query: 'kappaproyecto kappalib1' }, fakeExec('sesion-a'));
    assert.equal(result.ok, true);
    const keys = Object.keys(result.value).sort();
    assert.deepEqual(keys, ['elapsedMs', 'mode', 'results']);
    assert.equal('partial' in result.value, false);
    assert.equal('errors' in result.value, false);
    assert.equal('scopes' in result.value, false);
  } finally {
    world.cleanup();
  }
});

test('operations: una operación interrumpida impide repetir el efecto y se reconcilia sin reejecutar', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    world.withRegistry((db) => {
      const operation = beginOperation(db, {
        kind: 'recovery',
        target: world.libraries[0].id,
        detail: { origin: 'prueba' },
        now: 1_700_000_000_000,
      });
      assert.match(operation.id, /^op_/);
      assert.equal(operation.state, 'started');
      recordStep(db, {
        operationId: operation.id,
        step: 'stage',
        state: 'done',
        effectKey: `${operation.id}:stage`,
        now: 1_700_000_000_100,
      });
      // Repetir el mismo paso actualiza su estado (progreso); un paso DISTINTO no puede reutilizar la
      // misma clave de efecto: el índice único parcial lo rechaza en vez de duplicar el trabajo.
      const duplicate = recordStep(db, {
        operationId: operation.id,
        step: 'stage-again',
        state: 'done',
        effectKey: `${operation.id}:stage`,
        now: 1_700_000_000_200,
      });
      assert.equal(duplicate.ok, false);
      assert.equal(duplicate.duplicate, true);
      // Y el paso original sigue siendo el único con ese efecto.
      const sameStep = recordStep(db, { operationId: operation.id, step: 'stage', state: 'done', now: 1_700_000_000_250 });
      assert.equal(sameStep.ok, true);
      assert.deepEqual(listSteps(db, operation.id).map((row) => row.step), ['stage']);

      // La operación se queda «empezada»: no sabemos si el efecto se aplicó.
      assert.equal(listInterruptedOperations(db, { kind: 'recovery' }).length, 1);
      assert.throws(() => assertNoInterruptedOperation(db, { kind: 'recovery' }), (error) => {
        assert.equal(error.code, 'operation-uncertain');
        assert.equal(error.details.operations[0].id, operation.id);
        assert.deepEqual(error.details.operations[0].steps, [{ step: 'stage', state: 'done' }]);
        return true;
      });

      // Reconciliar SÓLO cierra la fila: el efecto no se repite ni se deshace.
      const changed = reconcileInterruptedOperations(db, {
        kind: 'recovery',
        now: 1_700_000_000_300,
        decide: (row) => ({ state: 'reconciled', detail: { verdict: 'efecto-aplicado-sin-ceremonia', row: row.id } }),
      });
      assert.deepEqual(changed, [{ id: operation.id, from: 'started', to: 'reconciled' }]);
      const after = getOperation(db, operation.id);
      assert.equal(after.state, 'reconciled');
      // La columna es NUMERIC y SQLite normaliza el instante ('…300' se guarda '…300.0').
      assert.equal(Number(after.finished_at), 1_700_000_000_300);
      assert.equal(listSteps(db, operation.id).length, 1, 'reconciliar no añade pasos nuevos');
      assert.equal(assertNoInterruptedOperation(db, { kind: 'recovery' }), true);
    });
  } finally {
    world.cleanup();
  }
});

test('operations: cerrar como committed exige que todos los pasos estén hechos', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    world.withRegistry((db) => {
      const operation = beginOperation(db, { kind: 'recovery', target: world.libraries[0].id, now: 1_700_000_000_000 });
      recordStep(db, { operationId: operation.id, step: 'stage', state: 'done', now: 1_700_000_000_100 });
      recordStep(db, { operationId: operation.id, step: 'swap', state: 'pending', now: 1_700_000_000_200 });
      // Declarar `committed` con un paso pendiente sería mentir sobre el resultado.
      assert.throws(
        () => finishOperation(db, { operationId: operation.id, state: 'committed', now: 1_700_000_000_300 }),
        (error) => {
          assert.equal(error.code, 'operation-uncertain');
          assert.deepEqual(error.details.steps, [{ step: 'stage', state: 'done' }, { step: 'swap', state: 'pending' }]);
          return true;
        },
      );
      // Y la fila sigue abierta: la incertidumbre se declara, no se esconde.
      assert.equal(getOperation(db, operation.id).state, 'started');
      finishOperation(db, { operationId: operation.id, state: 'failed', now: 1_700_000_000_400, detail: { reason: 'prueba' } });
      assert.equal(getOperation(db, operation.id).state, 'failed');
    });
  } finally {
    world.cleanup();
  }
});

test('operations: un fallo de paso se registra y deja la operación fallida, no silenciosamente abierta', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    world.withRegistry((db) => {
      const operation = beginOperation(db, { kind: 'recovery', target: world.libraries[0].id, now: 1_700_000_000_000 });
      recordStep(db, { operationId: operation.id, step: 'verify', state: 'failed', effectKey: `${operation.id}:verify`, now: 1_700_000_000_100 });
      finishOperation(db, { operationId: operation.id, state: 'failed', now: 1_700_000_000_200, detail: { reason: 'recovery-verification-failed' } });
      const finished = getOperation(db, operation.id);
      assert.equal(finished.state, 'failed');
      assert.equal(listInterruptedOperations(db).length, 0);
    });
  } finally {
    world.cleanup();
  }
});

test('PA4-E: dos escrituras simultáneas en el mismo almacén no pierden trabajo ni autorización', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const { createToolDefinitions } = await importTools();
    const definitions = createToolDefinitions({ config: world.config, services: servicesFor(world) });
    const files = [
      write(world.dirA, 'c1.md', '# C1\n\nkappaconcurrente uno\n'),
      write(world.dirA, 'c2.md', '# C2\n\nkappaconcurrente dos\n'),
    ];
    const results = await Promise.all(
      files.map((file) => attempt(definitions, 'ingest', { paths: [file], collection: 'documentacion' }, fakeExec('sesion-a'))),
    );
    const written = results.filter((item) => item.ok && item.value.ingested.length === 1);
    const busy = results.filter((item) => item.ok && item.value.errors.length === 1 && item.value.errors[0].code === 'store-busy');
    assert.equal(written.length + busy.length, 2, 'cada escritura o confirma o dice que se reintente');
    // Nada se pierde: reingresar lo que quedó pendiente deja las dos fuentes presentes.
    for (const item of results) {
      if (item.ok && item.value.errors.length > 0) {
        const path = item.value.errors[0].path;
        const retry = await attempt(definitions, 'ingest', { paths: [path], collection: 'documentacion' }, fakeExec('sesion-a'));
        assert.equal(retry.ok, true);
        assert.equal(retry.value.ingested.length + retry.value.skipped.length, 1);
      }
    }
    const listing = await attempt(definitions, 'list', { limit: 10 }, fakeExec('sesion-a'));
    assert.ok(listing.value.total >= 2);
  } finally {
    world.cleanup();
  }
});
