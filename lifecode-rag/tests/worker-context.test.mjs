/** LE-RAG-03 · Contexto explícito de los trabajadores: niveles, precedencia y compatibilidad. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { workerConfig } from '../lib/worker-context.mjs';

function box() {
  const root = mkdtempSync(join(tmpdir(), 'lcr-worker-'));
  mkdirSync(join(root, 'profiles', 'p1'), { recursive: true });
  writeFileSync(join(root, 'config.json'), JSON.stringify({ automation: { intervalMs: 111000 } }), 'utf8');
  writeFileSync(join(root, 'profiles', 'p1', 'config.json'), JSON.stringify({ search: { diversity: 'source' } }), 'utf8');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('nivel 1: la config inyectada manda sobre todo lo demás', () => {
  const injected = { automation: { enabled: true, intervalMs: 7, watchRoots: [] }, search: { diversity: 'fragment' } };
  const out = workerConfig({ config: injected, dataRoot: '/no/existe', root: '/tampoco' });
  assert.equal(out.source, 'injected');
  assert.equal(out.config, injected);
});

test('nivel 2: dataRoot + perfil usan el resolvedor único', () => {
  const b = box();
  try {
    const out = workerConfig({ dataRoot: b.root, profileKey: 'p1' });
    assert.equal(out.source, 'resolver');
    assert.equal(out.config.search.diversity, 'source');
    assert.equal(out.config.automation.intervalMs, 111000, 'hereda la global');
  } finally { b.cleanup(); }
});

test('nivel 3: sin contexto, se conserva el contrato histórico (root/config.json)', () => {
  const b = box();
  try {
    const out = workerConfig({ root: b.root, env: {} });
    assert.equal(out.source, 'root');
    assert.equal(out.config.search.diversity, 'fragment', 'no lee profiles/');
    assert.equal(out.config.automation.intervalMs, 111000);
    assert.throws(() => workerConfig({}), TypeError);
  } finally { b.cleanup(); }
});

test('el scheduler consume la config inyectada sin romper su contrato', async () => {
  const { createSyncScheduler } = await import('../lib/sync-scheduler.mjs');
  const b = box();
  const timers = [];
  const disposers = [];
  const interval = (cb, ms) => { timers.push(ms); return () => disposers.push(ms); };
  try {
    const scheduler = createSyncScheduler({
      env: {}, root: b.root, interval, logger: { info() {}, warn() {}, error() {} },
      config: { automation: { enabled: true, intervalMs: 5, watchRoots: ['C:/x'], maxFilesPerRun: 1, tickBudgetMs: 1 } },
    });
    assert.equal(scheduler.start().started, true);
    const status = scheduler.status();
    scheduler.stop();
    assert.equal(disposers.length, 1, 'stop() cierra el temporizador del host');
    // El ciclo de vida (arranque, tick, parada) lo cubren las pruebas históricas con fichero;
    // aquí se comprueba lo nuevo: que la configuración inyectada es la que se aplica.
    assert.equal(status.configured, true);
    assert.equal(status.effective.intervalMs, 5);
    assert.ok(timers.every((ms) => ms === 5), 'ningún temporizador con el intervalo del fichero');
  } finally { b.cleanup(); }
});

test('automation acepta dataRoot explícito y conserva el contrato del root', async () => {
  const { createAutomation } = await import('../lib/automation.mjs');
  const b = box();
  try {
    const viaData = createAutomation({ dataRoot: b.root, env: {}, logger: { info() {}, warn() {}, error() {} } });
    assert.equal(viaData.status().intervalMs, 111000, 'hereda la global');
    const legacy = createAutomation({ root: b.root, env: {}, logger: { info() {}, warn() {}, error() {} } });
    assert.equal(legacy.status().intervalMs, 111000, 'mismo resultado por el camino histórico');
    const injected = createAutomation({ config: { automation: { enabled: false, intervalMs: 42, watchRoots: [] } }, env: {}, logger: { info() {}, warn() {}, error() {} } });
    assert.equal(injected.status().intervalMs, 42, 'la inyectada manda');
  } finally { b.cleanup(); }
});
