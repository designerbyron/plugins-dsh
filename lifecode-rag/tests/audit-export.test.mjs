/**
 * AC10/AC18: exportación derivada, regenerable y verificable frente a la base.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { auditState, exportAuditJsonl, verifyAuditExport } from '../lib/audit-export.mjs';
import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { tempRoot } from './helpers.mjs';

async function prepared() {
  const box = tempRoot('rag-audit');
  const cwd = join(box.root, 'proyecto');
  const store = join(box.root, 'almacen');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'a.md'), 'contenido auditado', 'utf8');
  await ingestFiles({ root: store, files: [join(cwd, 'a.md')], now: 10, config: validateConfig({}) });
  const opened = openDatabase({ root: store, create: false });
  return { box, store, opened, path: opened.paths.audit };
}

test('exportar produce una línea por entrada y verificar coincide', async () => {
  const { box, opened, path } = await prepared();
  try {
    const result = exportAuditJsonl(opened.db, { path });
    assert.equal(result.entries, 1);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).outcome, 'ok');
    assert.deepEqual(verifyAuditExport(opened.db, { path }), { ok: true, entries: 1 });
    assert.deepEqual(auditState(opened.db, { path }), { ok: true, entries: 1 });
  } finally {
    closeDatabase(opened.db);
    box.cleanup();
  }
});

test('truncar el fichero se detecta', async () => {
  const { box, opened, path } = await prepared();
  try {
    exportAuditJsonl(opened.db, { path });
    writeFileSync(path, '', 'utf8');
    assert.equal(verifyAuditExport(opened.db, { path }).reason, 'truncated');
  } finally {
    closeDatabase(opened.db);
    box.cleanup();
  }
});

test('editar una línea se detecta', async () => {
  const { box, opened, path } = await prepared();
  try {
    exportAuditJsonl(opened.db, { path });
    const line = JSON.parse(readFileSync(path, 'utf8').trim());
    line.outcome = 'denied';
    writeFileSync(path, `${JSON.stringify(line)}\n`, 'utf8');
    assert.equal(verifyAuditExport(opened.db, { path }).reason, 'mismatch');
  } finally {
    closeDatabase(opened.db);
    box.cleanup();
  }
});

test('una línea extra o corrupta se detecta; regenerar es idempotente', async () => {
  const { box, opened, path } = await prepared();
  try {
    exportAuditJsonl(opened.db, { path });
    appendFileSync(path, '{"seq":99}\n', 'utf8');
    assert.equal(verifyAuditExport(opened.db, { path }).reason, 'extra');
    exportAuditJsonl(opened.db, { path });
    assert.equal(verifyAuditExport(opened.db, { path }).ok, true);
    appendFileSync(path, 'no-json\n', 'utf8');
    assert.equal(verifyAuditExport(opened.db, { path }).reason, 'invalid-line');
  } finally {
    closeDatabase(opened.db);
    box.cleanup();
  }
});
