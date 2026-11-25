/**
 * AC13: `doctor` diagnostica sin escribir y falla en cerrado cuando algo no cuadra.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { runDoctor, runtimeSupported } from '../lib/doctor.mjs';
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


function snapshot(root) {
  const out = {};
  const visit = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const key = rel ? `${rel}/${name}` : name;
      const stat = statSync(path);
      out[key] = {
        kind: stat.isDirectory() ? 'dir' : 'file',
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        content: stat.isFile() ? readFileSync(path).toString('base64') : null,
      };
      if (stat.isDirectory()) visit(path, key);
    }
  };
  visit(root, '');
  return out;
}

test('doctor no crea, modifica ni toca timestamps de un almacén existente', () => {
  const box = tempRoot('rag-doctor-readonly');
  try {
    const root = join(box.root, 'almacen');
    const opened = openDatabase({ root, create: true, now: 1700000000000 });
    closeDatabase(opened.db);
    const before = snapshot(root);
    const report = runDoctor({ root, env: {} });
    const after = snapshot(root);
    assert.equal(report.ok, true);
    assert.equal(report.checks.find((check) => check.name === 'almacén').status, 'warn');
    assert.deepEqual(after, before, 'doctor no debe crear sidecars ni cambiar contenido/mtime');
  } finally {
    box.cleanup();
  }
});

test('doctor no modifica el JSONL de auditoría', async () => {
  const box = tempRoot('rag-doctor-audit-readonly');
  try {
    const root = join(box.root, 'almacen');
    const opened = openDatabase({ root, create: true, now: 1700000000000 });
    const { exportAuditJsonl } = await import('../lib/audit-export.mjs');
    exportAuditJsonl(opened.db, { path: opened.paths.audit });
    closeDatabase(opened.db);
    const before = snapshot(root);
    const report = runDoctor({ root, env: {} });
    const after = snapshot(root);
    assert.equal(report.ok, true);
    assert.deepEqual(after, before, 'doctor no debe tocar el JSONL ni sus timestamps');
  } finally {
    box.cleanup();
  }
});

test('doctor informa migración requerida pero no migra el almacén', () => {
  const box = tempRoot('rag-doctor-migration');
  try {
    const root = join(box.root, 'almacen');
    const opened = openDatabase({ root, create: true, now: 1700000000000 });
    opened.db.exec('PRAGMA user_version = 2');
    closeDatabase(opened.db);
    const before = snapshot(root);
    const report = runDoctor({ root, env: {} });
    const after = snapshot(root);
    const store = report.checks.find((check) => check.name === 'almacén');
    assert.equal(store.status, 'warn');
    assert.match(store.detail, /migración/);
    assert.deepEqual(after, before, 'doctor no debe migrar ni tocar el almacén');
  } finally {
    box.cleanup();
  }
});


test('runtimeSupported refleja el rango real de node:sqlite', () => {
  assert.equal(runtimeSupported('22.5.0'), false);
  assert.equal(runtimeSupported('22.12.0'), false);
  assert.equal(runtimeSupported('22.15.0'), false);
  assert.equal(runtimeSupported('22.16.0'), true);
  assert.equal(runtimeSupported('22.99.0'), true);
  assert.equal(runtimeSupported('23.0.0'), false);
  assert.equal(runtimeSupported('23.11.0'), false);
  assert.equal(runtimeSupported('24.0.0'), true);
  assert.equal(runtimeSupported('24.21.0'), true);
});


test('el manifiesto declara el mismo rango que runtimeSupported', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.engines.node, '>=22.16.0 <23.0.0 || >=24.0.0');
  assert.equal(pkg.version, '1.6.0');
});
