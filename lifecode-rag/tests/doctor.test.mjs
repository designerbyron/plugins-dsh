/**
 * AC13: `doctor` diagnostica sin escribir y falla en cerrado cuando algo no cuadra.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { runDoctor } from '../lib/doctor.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { tempRoot } from './helpers.mjs';

test('doctor sobre una raíz nueva avisa, no falla', () => {
  const box = tempRoot('rag-doctor');
  try {
    const root = join(box.root, 'almacen');
    const report = runDoctor({ root, env: {} });
    assert.equal(report.ok, true);
    const store = report.checks.find((check) => check.name === 'almacén');
    assert.equal(store.status, 'warn');
    assert.equal(report.checks.find((check) => check.name === 'runtime').status, 'ok');
    assert.equal(report.checks.find((check) => check.name === 'embedder').status, 'ok');
  } finally {
    box.cleanup();
  }
});

test('doctor está en verde con un almacén recién ingerido y exportado', async () => {
  const box = tempRoot('rag-doctor');
  try {
    const root = join(box.root, 'almacen');
    const cwd = join(box.root, 'proyecto');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, 'a.md'), 'diagnóstico verde', 'utf8');
    await ingestFiles({ root, files: [join(cwd, 'a.md')], now: 1, config: validateConfig({}) });
    const opened = openDatabase({ root, create: false });
    const { exportAuditJsonl } = await import('../lib/audit-export.mjs');
    exportAuditJsonl(opened.db, { path: opened.paths.audit });
    closeDatabase(opened.db);

    const report = runDoctor({ root, env: {} });
    assert.equal(report.ok, true);
    assert.equal(report.checks.find((check) => check.name === 'almacén').status, 'ok');
  } finally {
    box.cleanup();
  }
});

test('doctor falla si la auditoría del fichero no coincide', async () => {
  const box = tempRoot('rag-doctor');
  try {
    const root = join(box.root, 'almacen');
    const cwd = join(box.root, 'proyecto');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, 'a.md'), 'contenido', 'utf8');
    await ingestFiles({ root, files: [join(cwd, 'a.md')], now: 1, config: validateConfig({}) });
    const opened = openDatabase({ root, create: false });
    const { exportAuditJsonl } = await import('../lib/audit-export.mjs');
    exportAuditJsonl(opened.db, { path: opened.paths.audit });
    closeDatabase(opened.db);
    writeFileSync(opened.paths.audit, '', 'utf8');

    const report = runDoctor({ root, env: {} });
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((check) => check.name === 'almacén').status, 'fail');
  } finally {
    box.cleanup();
  }
});
