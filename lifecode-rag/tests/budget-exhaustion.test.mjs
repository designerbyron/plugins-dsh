/**
 * M6.8 — R-07: agotamiento del presupuesto del tick.
 *
 * El presupuesto se mide con reloj **monotónico** y se comprueba entre fichero y fichero, nunca a
 * mitad de una transacción. Estas pruebas inyectan el reloj monotónico, así que son deterministas: no
 * dependen de dormir ni de la velocidad de la máquina.
 *
 * LÍMITE DECLARADO: es una prueba local con fixtures aislados. El agotamiento en el Host real no se
 * provocó (habría exigido escribir en el almacén real o activar el scheduler), así que ese caso sigue
 * NOT TESTED en el expediente.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmbedder } from '../lib/embedders.mjs';
import { closeRegistry, openRegistry } from '../lib/registry.mjs';
import { profileKey } from '../lib/profile.mjs';
import { listSteps } from '../lib/operations.mjs';
import { readSyncRows, syncScope, verifyScopeStore } from '../lib/sync.mjs';
import { openScopeStore } from '../lib/scope-stores.mjs';
import { makeEightWorld, write } from './pa4-helpers.mjs';

// ---------------------------------------------------------------------------------------------
// Utilidades de la prueba
// ---------------------------------------------------------------------------------------------

function clockSeries(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

function projectScope(world) {
  return { kind: 'prj', id: world.projectA.id, name: 'Proyecto A' };
}

function runPass(world, options = {}) {
  return syncScope({
    registryDb: options.registryDb,
    profileRoot: world.root,
    profileKey: profileKey(world.env),
    scope: projectScope(world),
    config: options.config ?? world.config,
    embedder: options.embedder ?? createEmbedder(world.config),
    now: options.now ?? (() => 1_700_000_500_000),
    limit: options.limit ?? 25,
    budgetMs: options.budgetMs ?? null,
    monotonic: options.monotonic ?? null,
    actor: 'human',
  });
}

function seedFiles(world, count) {
  for (let index = 1; index <= count; index += 1) {
    write(world.dirA, `presupuesto-${index}.md`, `# Presupuesto ${index}\n\nkappa presupuesto ${index}\n`);
  }
}

function presupuestoRows(world) {
  const registry = openRegistry({ root: world.root, create: false });
  try {
    const rows = [...readSyncRows(registry.db, { scopeKind: 'prj', scopeId: world.projectA.id }).values()].filter((row) =>
      String(row.source_key).startsWith('presupuesto-'),
    );
    return rows;
  } finally {
    closeRegistry(registry.db);
  }
}

function presupuestoSources(world) {
  const store = openScopeStore({
    profileRoot: world.root,
    profileKey: profileKey(world.env),
    scope: projectScope(world),
    create: false,
  });
  try {
    return store
      ? store.prepare("SELECT id, uri, sha256 FROM sources WHERE uri LIKE '%presupuesto-%' ORDER BY uri").all()
      : [];
  } finally {
    try {
      store?.close();
    } catch {
      /* cerrar dos veces no es un fallo */
    }
  }
}

function lastSyncOperation(world) {
  const registry = openRegistry({ root: world.root, create: false });
  try {
    const row = registry.db
      .prepare("SELECT id, state, detail FROM operations WHERE kind = 'sync' ORDER BY started_at DESC LIMIT 1")
      .get();
    if (!row) return null;
    return {
      id: row.id,
      state: row.state,
      detail: row.detail ? JSON.parse(row.detail) : null,
      steps: listSteps(registry.db, row.id),
    };
  } finally {
    closeRegistry(registry.db);
  }
}

// ---------------------------------------------------------------------------------------------
// Casos de R-07
// ---------------------------------------------------------------------------------------------

test('el presupuesto agotado antes del primer fichero no indexa nada ni abre el lote', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    seedFiles(world, 4);
    const registry = openRegistry({ root: world.root, create: false });
    try {
      // El primer valor fija el plazo; el segundo ya lo supera.
      const summary = await runPass(world, {
        registryDb: registry.db,
        budgetMs: 1,
        monotonic: clockSeries([0, 10]),
      });

      assert.equal(summary.budget_exhausted, true);
      assert.equal(summary.complete, false);
      assert.equal(summary.stop_reason, 'budget');
      assert.equal(summary.budget_ms, 1);
      assert.equal(summary.ingested, 0);
      assert.equal(summary.failed, 0);
      assert.equal(summary.errors.length, 0);
      assert.equal(presupuestoSources(world).length, 0, 'no se abrió el lote');
      assert.equal(presupuestoRows(world).length, 0, 'nada marcado como presente');

      const operation = lastSyncOperation(world);
      assert.equal(operation.state, 'committed', 'agotar presupuesto no es un fallo de la operación');
      assert.equal(operation.detail.complete, false);
      assert.equal(operation.detail.budget_exhausted, true);
    } finally {
      closeRegistry(registry.db);
    }
  } finally {
    world.cleanup();
  }
});

test('el presupuesto agotado tras varios ficheros conserva lo confirmado y deja el resto pendiente', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    seedFiles(world, 6);
    const registry = openRegistry({ root: world.root, create: false });
    try {
      // Cada llamada al reloj avanza 4 ms: con presupuesto de 10 ms se cortan unos pocos ficheros.
      const summary = await runPass(world, {
        registryDb: registry.db,
        budgetMs: 10,
        monotonic: clockSeries([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40]),
      });

      assert.equal(summary.budget_exhausted, true);
      assert.equal(summary.stop_reason, 'budget');
      assert.equal(summary.complete, false);
      assert.ok(summary.ingested >= 1, 'algo se confirmó antes del corte');
      assert.ok(summary.ingested < 6, 'el corte llegó antes de terminar');
      assert.equal(summary.failed, 0, 'el corte por presupuesto no es un error de fichero');

      // Lo confirmado está completo: cada fuente tiene chunks y cada chunk su vector. Un corte a mitad
      // de transacción dejaría una fuente sin chunks o chunks sin vectores.
      const store = openScopeStore({
        profileRoot: world.root,
        profileKey: profileKey(world.env),
        scope: projectScope(world),
        create: false,
      });
      try {
        const broken = store
          .prepare(
            `SELECT s.id, COUNT(c.id) AS chunks,
                    (SELECT COUNT(*) FROM vectors v WHERE v.chunk_key IN (SELECT chunk_key FROM chunks WHERE source_id = s.id)) AS vectors
             FROM sources s LEFT JOIN chunks c ON c.source_id = s.id
             WHERE s.uri LIKE '%presupuesto-%'
             GROUP BY s.id`,
          )
          .all();
        assert.equal(broken.length, summary.ingested);
        for (const row of broken) {
          assert.ok(Number(row.chunks) >= 1, `la fuente ${row.id} quedó sin chunks`);
          assert.equal(Number(row.vectors), Number(row.chunks), `la fuente ${row.id} quedó sin vectores`);
        }

        const verification = verifyScopeStore(store, { model: createEmbedder(world.config).model });
        assert.equal(verification.orphans, 0);
        assert.equal(verification.missingVectors, 0);
        assert.equal(verification.fts, 'ok');
      } finally {
        try {
          store?.close();
        } catch {
          /* cerrar dos veces no es un fallo */
        }
      }

      // Sin falsos `missing`: un corte no es una desaparición.
      const rows = presupuestoRows(world);
      assert.equal(rows.length, summary.ingested);
      assert.equal(rows.filter((row) => row.status === 'missing').length, 0);
      assert.equal(rows.filter((row) => row.status === 'present').length, summary.ingested);

      const operation = lastSyncOperation(world);
      assert.equal(operation.state, 'committed');
      assert.equal(operation.detail.complete, false);
      assert.equal(operation.detail.budget_exhausted, true);
      assert.deepEqual(
        operation.steps.map((step) => `${step.step}:${step.state}`).sort(),
        ['apply:done', 'observe:done', 'verify:done'],
      );
    } finally {
      closeRegistry(registry.db);
    }
  } finally {
    world.cleanup();
  }
});

test('la pasada siguiente termina el trabajo pendiente sin duplicar', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    seedFiles(world, 6);
    const registry = openRegistry({ root: world.root, create: false });
    try {
      const first = await runPass(world, {
        registryDb: registry.db,
        budgetMs: 10,
        monotonic: clockSeries([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40]),
      });
      assert.ok(first.ingested < 6);

      const second = await runPass(world, { registryDb: registry.db });
      assert.equal(second.budget_exhausted, false);
      assert.equal(second.stop_reason, 'complete');
      assert.equal(second.ingested, 6 - first.ingested);

      const sources = presupuestoSources(world);
      assert.equal(sources.length, 6, 'las seis fuentes, ni una más');
      assert.equal(new Set(sources.map((row) => row.uri)).size, 6, 'sin duplicados por la misma ruta');

      const rows = presupuestoRows(world);
      assert.equal(rows.length, 6);
      assert.equal(rows.every((row) => row.status === 'present'), true);
    } finally {
      closeRegistry(registry.db);
    }
  } finally {
    world.cleanup();
  }
});

test('el presupuesto no depende del reloj de pared: un salto atrás no alarga el tick', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    seedFiles(world, 6);
    const registry = openRegistry({ root: world.root, create: false });
    try {
      // Reloj de pared que retrocede 10 minutos a mitad de la pasada: si el presupuesto se midiera con
      // él, `now()` sería menor que el plazo y el tick se alargaría indefinidamente.
      let wall = 1_700_000_500_000;
      const jumpingWall = () => {
        wall -= 600_000;
        return wall;
      };
      const summary = await runPass(world, {
        registryDb: registry.db,
        budgetMs: 10,
        now: jumpingWall,
        monotonic: clockSeries([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40]),
      });

      assert.equal(summary.budget_exhausted, true);
      assert.equal(summary.stop_reason, 'budget');
      assert.ok(summary.ingested < 6, 'el reloj de pared no alargó el presupuesto');
      assert.ok(summary.ms >= 0, 'la duración reportada nunca es negativa');
    } finally {
      closeRegistry(registry.db);
    }
  } finally {
    world.cleanup();
  }
});
