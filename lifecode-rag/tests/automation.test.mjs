/**
 * M4: automatización acotada por política, cancelable y auditada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createAutomation } from '../lib/automation.mjs';
import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { validateConfig, writeConfig } from '../lib/paths.mjs';
import { tempRoot } from './helpers.mjs';

function setup(box, overrides = {}) {
  const watched = join(box.root, 'vigilado');
  const store = join(box.root, 'almacen');
  mkdirSync(watched, { recursive: true });
  writeConfig(store, validateConfig({
    automation: { enabled: true, intervalMs: 60_000, watchRoots: [watched], maxFilesPerRun: 2, ...overrides },
  }));
  return { watched, store };
}

test('ingiere sólo lo nuevo o cambiado, respetando maxFilesPerRun', async () => {
  const box = tempRoot('rag-auto');
  try {
    const { watched, store } = setup(box);
    writeFileSync(join(watched, 'a.md'), 'alfa uno', 'utf8');
    writeFileSync(join(watched, 'b.md'), 'beta dos', 'utf8');
    writeFileSync(join(watched, 'c.md'), 'gamma tres', 'utf8');
    const automation = createAutomation({ root: store, now: () => 1_000 });

    const first = await automation.runOnce();
    assert.equal(first.skipped, 0);
    assert.equal(first.ingested, 2, 'el límite corta la pasada, no el recorrido');
    assert.equal(first.failed, 0);

    const second = await automation.runOnce();
    assert.equal(second.ingested, 1, 'lo que quedó pendiente entra en la siguiente pasada');

    const third = await automation.runOnce();
    assert.equal(third.ingested, 0);
    assert.equal(third.considered, 0);

    writeFileSync(join(watched, 'a.md'), 'alfa uno cambiado', 'utf8');
    const fourth = await automation.runOnce();
    assert.equal(fourth.ingested, 1);
    assert.equal(fourth.failed, 0);
  } finally {
    box.cleanup();
  }
});

test('deshabilitada no hace nada; sin raíces tampoco', async () => {
  const box = tempRoot('rag-auto');
  try {
    const store = join(box.root, 'almacen');
    writeConfig(store, validateConfig({ automation: { enabled: false } }));
    const disabled = await createAutomation({ root: store }).runOnce();
    assert.deepEqual(disabled, { skipped: true, reason: 'disabled' });

    writeConfig(store, validateConfig({ automation: { enabled: true, watchRoots: [] } }));
    const empty = await createAutomation({ root: store }).runOnce();
    assert.deepEqual(empty, { skipped: true, reason: 'no-watch-roots' });
  } finally {
    box.cleanup();
  }
});

test('se cancela entre ficheros sin dejar una pasada a medias', async () => {
  const box = tempRoot('rag-auto');
  try {
    const { watched, store } = setup(box, { maxFilesPerRun: 10 });
    writeFileSync(join(watched, 'a.md'), 'contenido a', 'utf8');
    const controller = new AbortController();
    controller.abort();
    const automation = createAutomation({ root: store });
    const result = await automation.runOnce({ signal: controller.signal });
    assert.equal(result.cancelled, true);
    assert.equal(result.ingested, 0);

    const opened = openDatabase({ root: store, create: false });
    try {
      const audit = opened.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'automation.run'").get().n;
      assert.equal(audit, 1, 'una pasada cancelada también se audita');
      assert.equal(opened.db.prepare("SELECT COUNT(*) AS n FROM sources").get().n, 0);
      assert.ok(opened.db.prepare("SELECT COUNT(*) AS n FROM metrics_daily WHERE metric = 'automation.runs'").get().n >= 1);
    } finally {
      closeDatabase(opened.db);
    }
  } finally {
    box.cleanup();
  }
});

test('start/stop es idempotente y status refleja la política', async () => {
  const box = tempRoot('rag-auto');
  try {
    const { store } = setup(box);
    const automation = createAutomation({ root: store });
    const first = automation.start();
    assert.equal(first.started, true);
    assert.equal(automation.start().already, true);
    assert.equal(automation.status().enabled, true);
    automation.stop();
    assert.equal(automation.status().enabled, false);
  } finally {
    box.cleanup();
  }
});
