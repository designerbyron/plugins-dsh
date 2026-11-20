/**
 * M6.8 — R-08: backoff tras un fallo del tick.
 *
 * El reloj y el temporizador se inyectan, así que el escenario es determinista: no se duerme ni se
 * depende de la velocidad de la máquina. El fallo se provoca con una configuración inválida (el
 * programador relee la configuración en cada tick), que es exactamente lo que ocurre si alguien deja
 * `config.json` a medias.
 *
 * Alcance: prueba local. En el Host real no se provocó un fallo del scheduler (habría exigido romper
 * la configuración del perfil en producción), así que ese caso sigue NOT TESTED en el expediente.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { writeConfig } from '../lib/paths.mjs';
import { createSyncScheduler } from '../lib/sync-scheduler.mjs';
import { makeEightWorld, write } from './pa4-helpers.mjs';

const INTERVAL = 5_000;

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
    automation: { ...world.config.automation, enabled: true, intervalMs: INTERVAL, tickBudgetMs: 2_000, ...overrides },
  });
}

/** Configuración inválida a propósito: `intervalMs` por debajo del mínimo (5 000). */
function breakConfig(world) {
  writeFileSync(
    join(world.root, 'config.json'),
    `${JSON.stringify({ automation: { enabled: true, intervalMs: 1 } }, null, 2)}\n`,
    'utf8',
  );
}

function makeScheduler(world, timer, clock) {
  return createSyncScheduler({
    env: world.env,
    root: world.root,
    now: () => clock.value,
    logger: { warn() {} },
    interval: timer.schedule,
  });
}

test('backoff exponencial con tope de ocho, sin reintentos inmediatos', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    enableAutomation(world);
    write(world.dirA, 'a.md', '# A\n\nkappa uno\n');
    const timer = fakeInterval();
    const clock = { value: 1_700_000_000_000 };
    const scheduler = makeScheduler(world, timer, clock);
    scheduler.start();

    // Primera pasada buena: deja el contador a cero.
    await scheduler.tick();
    assert.equal(scheduler.status().consecutiveFailures, 0);

    breakConfig(world);

    // 1. Primer fallo → factor 1.
    await scheduler.tick();
    let status = scheduler.status();
    assert.equal(status.consecutiveFailures, 1);
    assert.equal(status.lastError.code, 'invalid-config');
    assert.equal(status.backoffFactor, 1);
    assert.equal(status.nextAttemptAt, clock.value + INTERVAL);
    assert.equal(status.backoffRemainingMs, INTERVAL);

    // 2. Tick inmediato → omitido, no reintenta.
    await scheduler.tick();
    status = scheduler.status();
    assert.equal(status.skippedTicks, 1);
    assert.equal(status.lastSkipReason, 'backoff');
    assert.equal(status.consecutiveFailures, 1, 'omitir no cuenta como fallo nuevo');

    // Un tick justo antes del plazo sigue omitido.
    clock.value += INTERVAL - 1;
    await scheduler.tick();
    assert.equal(scheduler.status().skippedTicks, 2);

    // 3. Al cumplirse el plazo → segundo fallo, factor 2.
    clock.value += 1;
    await scheduler.tick();
    status = scheduler.status();
    assert.equal(status.consecutiveFailures, 2);
    assert.equal(status.backoffFactor, 2);
    assert.equal(status.nextAttemptAt, clock.value + 2 * INTERVAL);

    // 4. Tercero → 4; cuarto → 8; quinto → sigue en 8 (tope).
    for (const expected of [4, 8]) {
      clock.value += (expected / 2) * INTERVAL;
      await scheduler.tick();
      status = scheduler.status();
      assert.equal(status.backoffFactor, expected);
      assert.equal(status.nextAttemptAt, clock.value + expected * INTERVAL);
    }
    clock.value += 8 * INTERVAL;
    await scheduler.tick();
    status = scheduler.status();
    assert.equal(status.consecutiveFailures, 5);
    assert.equal(status.backoffFactor, 8, 'el tope es ocho intervalos, no más');
    assert.equal(status.backoffRemainingMs, 8 * INTERVAL);

    // 5. Recuperación: con la configuración sana, el siguiente intento funciona y resetea el contador.
    enableAutomation(world);
    clock.value += 8 * INTERVAL;
    await scheduler.tick();
    status = scheduler.status();
    assert.equal(status.consecutiveFailures, 0);
    assert.equal(status.backoffFactor, 0);
    assert.equal(status.nextAttemptAt, null);
    assert.equal(status.lastError, null);
    assert.equal(status.lastResult.ingested, 0);

    // 6. Sin temporizadores residuales.
    scheduler.stop();
    assert.equal(timer.disposedCount(), 1);
    assert.equal(timer.calls.length, 1);
  } finally {
    world.cleanup();
  }
});

test('muchos ticks durante el backoff no se acumulan ni disparan trabajo', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    enableAutomation(world);
    const timer = fakeInterval();
    const clock = { value: 1_700_000_000_000 };
    const scheduler = makeScheduler(world, timer, clock);
    scheduler.start();
    await scheduler.tick();
    breakConfig(world);
    await scheduler.tick();

    const before = scheduler.status();
    for (let index = 0; index < 25; index += 1) await scheduler.tick();
    const after = scheduler.status();

    assert.equal(after.ticks, before.ticks, 'no se ejecutó ninguna pasada nueva');
    assert.equal(after.skippedTicks, before.skippedTicks + 25);
    assert.equal(after.consecutiveFailures, 1, 'omitir no infla el contador de fallos');
    assert.equal(after.running, false);
    assert.equal(timer.calls.length, 1, 'sigue habiendo un solo temporizador');
    scheduler.stop();
  } finally {
    world.cleanup();
  }
});

test('desactivar durante el backoff y descargar el plugin deja de programar sin asas', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    enableAutomation(world);
    const timer = fakeInterval();
    const clock = { value: 1_700_000_000_000 };
    const scheduler = makeScheduler(world, timer, clock);
    scheduler.start();
    const stale = timer.calls[0].callback;
    await scheduler.tick();
    breakConfig(world);
    await scheduler.tick();
    assert.equal(scheduler.status().consecutiveFailures, 1);
    assert.ok(scheduler.status().backoffRemainingMs > 0);

    // Desactivación explícita: el tick siguiente ya no ejecuta una pasada, sólo se salta.
    writeConfig(world.root, {
      ...world.config,
      automation: { ...world.config.automation, enabled: false, intervalMs: INTERVAL },
    });
    await scheduler.tick();
    assert.equal(scheduler.status().lastSkipReason, 'disabled');

    // Descarga del plugin (equivalente al teardown del contexto) durante el backoff.
    scheduler.stop();
    assert.equal(timer.disposedCount(), 1);
    assert.equal(scheduler.status().enabled, false);
    const ticksBefore = scheduler.status().ticks;
    await stale();
    assert.equal(scheduler.status().ticks, ticksBefore, 'un callback rezagado no ejecuta nada');
    assert.equal(timer.calls.length, 1);
  } finally {
    world.cleanup();
  }
});

test('un fallo de fichero no detiene el scheduler ni dispara el backoff del tick', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    enableAutomation(world);
    // Un fichero binario no se puede ingerir, pero el motor lo cuenta como no soportado y sigue.
    writeFileSync(join(world.dirA, 'binario.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    write(world.dirA, 'a.md', '# A\n\nkappa uno\n');
    const timer = fakeInterval();
    const clock = { value: 1_700_000_000_000 };
    const scheduler = makeScheduler(world, timer, clock);
    scheduler.start();

    await scheduler.tick();
    const first = scheduler.status();
    assert.equal(first.consecutiveFailures, 0, 'un fichero no ingestable no es un fallo del tick');
    assert.equal(first.lastResult.failed, 0);

    clock.value += INTERVAL;
    await scheduler.tick();
    const second = scheduler.status();
    assert.equal(second.ticks, 2, 'el scheduler sigue funcionando después del incidente');
    assert.equal(second.lastSkipReason, null);
    scheduler.stop();
  } finally {
    world.cleanup();
  }
});
