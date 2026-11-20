/**
 * PA5 — programación de la sincronización.
 *
 * El motor no depende de un reloj; el programador es lo único que lo llama periódicamente. Aquí se
 * comprueba que respeta `automation.enabled`, que sincroniza todos los ámbitos activos con raíz, que
 * audita la pasada y que un temporizador arranca y se detiene sin dejar asas.
 *
 * LÍMITE DECLARADO: el temporizador es el de Node (`setInterval`). PA6 comprueba si DeepSeek Harness
 * ofrece programación nativa; hasta entonces, esto es lo que hay y así se documenta.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { writeConfig } from '../lib/paths.mjs';
import { closeRegistry, openRegistry } from '../lib/registry.mjs';
import { createSyncScheduler } from '../lib/sync-scheduler.mjs';
import { makeEightWorld, write } from './pa4-helpers.mjs';

test('con la automatización desactivada no se ejecuta nada', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scheduler = createSyncScheduler({ env: world.env, root: world.root, now: () => 1_700_000_500_000, logger: { warn() {} } });
    const result = await scheduler.runOnce();
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'disabled');
    assert.equal(scheduler.status().enabled, false);
  } finally {
    world.cleanup();
  }
});

test('una pasada sincroniza todos los ámbitos activos con raíz y audita el tick', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    write(world.dirA, 'tick.md', '# Tick\n\nkappa tick\n');
    writeConfig(world.root, { ...world.config, automation: { ...world.config.automation, enabled: true } });

    const scheduler = createSyncScheduler({ env: world.env, root: world.root, now: () => 1_700_000_500_000, logger: { warn() {} } });
    const result = await scheduler.runOnce();
    assert.equal(result.skipped, undefined);
    assert.equal(result.scopes, 3, 'proyecto A, proyecto B y la biblioteca');
    assert.equal(result.ingested, 1);
    const projectA = result.results.find((item) => item.scope_id === world.projectA.id);
    assert.equal(projectA.new, 1);
    assert.equal(projectA.verification.orphans, 0);

    const registry = openRegistry({ root: world.root, create: false });
    try {
      const ticks = registry.db.prepare("SELECT COUNT(*) AS n FROM audit_registry WHERE action = 'sync.tick'").get().n;
      assert.equal(Number(ticks), 1);
      const runs = registry.db.prepare("SELECT COUNT(*) AS n FROM audit_registry WHERE action = 'sync.run'").get().n;
      assert.equal(Number(runs), 3);
    } finally {
      closeRegistry(registry.db);
    }

    // Segunda pasada: sin cambios, nada que ingerir.
    const again = await scheduler.runOnce();
    assert.equal(again.ingested, 0);
  } finally {
    world.cleanup();
  }
});

test('el temporizador arranca con la automatización activa y se detiene sin dejar asas', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const off = createSyncScheduler({ env: world.env, root: world.root, logger: { warn() {} } });
    assert.deepEqual(off.start(), { started: false, reason: 'disabled' });

    writeConfig(world.root, { ...world.config, automation: { ...world.config.automation, enabled: true } });
    const scheduler = createSyncScheduler({ env: world.env, root: world.root, logger: { warn() {} } });
    const started = scheduler.start();
    assert.equal(started.started, true);
    assert.equal(started.intervalMs, world.config.automation.intervalMs);
    assert.equal(scheduler.status().enabled, true);
    assert.equal(scheduler.status().note.includes('Node'), true);

    scheduler.stop();
    assert.equal(scheduler.status().enabled, false);
    assert.deepEqual(scheduler.stop(), { stopped: true });
  } finally {
    world.cleanup();
  }
});

// ---------------------------------------------------------------------------------------------
// M6.7 §3.1/§3.2/§3.3: ciclo de vida, activación única, ticks omitidos y descarga.
// ---------------------------------------------------------------------------------------------

function fakeInterval() {
  const calls = [];
  let disposed = 0;
  const schedule = (callback, delay) => {
    calls.push({ callback, delay });
    return () => {
      disposed += 1;
    };
  };
  return { schedule, calls, disposedCount: () => disposed };
}

function enableAutomation(world, overrides = {}) {
  writeConfig(world.root, {
    ...world.config,
    automation: { ...world.config.automation, enabled: true, intervalMs: 5_000, tickBudgetMs: 2_000, ...overrides },
  });
}

test('activar dos veces no crea un segundo temporizador', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    enableAutomation(world);
    const timer = fakeInterval();
    const scheduler = createSyncScheduler({ env: world.env, root: world.root, logger: { warn() {} }, interval: timer.schedule });

    const first = scheduler.start();
    assert.equal(first.started, true);
    assert.equal(first.timer, 'host');
    const second = scheduler.start();
    assert.equal(second.already, true);
    assert.equal(timer.calls.length, 1, 'un único temporizador');
    assert.equal(scheduler.status().starts, 1);
    scheduler.stop();
  } finally {
    world.cleanup();
  }
});

test('un tick que llega durante una pasada se cuenta como omitido y no se encola', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    enableAutomation(world);
    write(world.dirA, 'a.md', '# A\n\nkappa uno\n');
    const timer = fakeInterval();
    const scheduler = createSyncScheduler({ env: world.env, root: world.root, logger: { warn() {} }, interval: timer.schedule });
    scheduler.start();

    const first = scheduler.tick();
    const second = scheduler.tick();
    await Promise.all([first, second]);
    const status = scheduler.status();
    assert.equal(status.skippedTicks, 1);
    assert.equal(status.lastSkipReason, 'already-running');
    assert.equal(status.running, false);
    scheduler.stop();
  } finally {
    world.cleanup();
  }
});

test('dos ticks consecutivos avanzan la sincronización por partes', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    enableAutomation(world, { maxFilesPerRun: 1 });
    write(world.dirA, 'a.md', '# A\n\nkappa uno\n');
    write(world.dirA, 'b.md', '# B\n\nkappa dos\n');
    const timer = fakeInterval();
    const scheduler = createSyncScheduler({ env: world.env, root: world.root, logger: { warn() {} }, interval: timer.schedule });
    scheduler.start();

    await scheduler.tick();
    const afterFirst = scheduler.status();
    assert.equal(afterFirst.ticks, 1);
    assert.equal(afterFirst.lastResult.ingested, 1, 'el límite de 1 fichero se respeta');
    assert.equal(afterFirst.lastResult.partial, 1);
    assert.equal(scheduler.status().effective.maxFilesPerRun, 1);

    await scheduler.tick();
    const afterSecond = scheduler.status();
    assert.equal(afterSecond.ticks, 2);
    assert.equal(afterSecond.lastResult.ingested, 1);
    assert.equal(afterSecond.consecutiveFailures, 0);
    scheduler.stop();
  } finally {
    world.cleanup();
  }
});

test('stop cierra el disposer y un callback rezagado no ejecuta nada', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    enableAutomation(world);
    const timer = fakeInterval();
    const scheduler = createSyncScheduler({ env: world.env, root: world.root, logger: { warn() {} }, interval: timer.schedule });
    scheduler.start();
    const stale = timer.calls[0].callback;

    scheduler.stop();
    assert.equal(timer.disposedCount(), 1);
    assert.equal(scheduler.status().enabled, false);
    assert.equal(scheduler.status().stops, 1);

    await stale();
    assert.equal(scheduler.status().ticks, 0, 'después del teardown no se ejecuta ninguna pasada');
  } finally {
    world.cleanup();
  }
});

test('sin temporizador del host el programador no arranca y lo declara', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    enableAutomation(world);
    const scheduler = createSyncScheduler({
      env: world.env,
      root: world.root,
      logger: { warn() {} },
      interval: () => {
        throw new Error('el host no ofrece ctx.timer.interval');
      },
    });
    const started = scheduler.start();
    assert.equal(started.started, false);
    assert.equal(started.reason, 'no-timer');
    const status = scheduler.status();
    assert.equal(status.enabled, false);
    assert.equal(status.lastError.code, 'no-timer');
  } finally {
    world.cleanup();
  }
});

test('el estado del programador es observable y trae la política efectiva', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    enableAutomation(world, { maxFilesPerRun: 25, tickBudgetMs: 2_000 });
    const timer = fakeInterval();
    const scheduler = createSyncScheduler({ env: world.env, root: world.root, logger: { warn() {} }, interval: timer.schedule });
    write(world.dirA, 'a.md', '# A\n\nkappa uno\n');
    scheduler.start();
    await scheduler.tick();
    const status = scheduler.status();
    assert.equal(status.effective.maxFilesPerRun, 25);
    assert.equal(status.effective.tickBudgetMs, 2_000);
    assert.equal(status.intervalMs, 5_000);
    assert.equal(typeof status.nextTickAt, 'number');
    assert.equal(status.ticks, 1);
    assert.equal(status.lastResult.budgetExhausted, 0);
    scheduler.stop();
  } finally {
    world.cleanup();
  }
});
