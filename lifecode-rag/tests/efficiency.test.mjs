/**
 * LifeCode Efficiency First (v2.2): reutilización de trabajo y presupuesto de contexto.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assembleContext } from '../lib/context.mjs';
import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { search } from '../lib/search.mjs';
import { tempRoot } from './helpers.mjs';

test('AC24: reingerir el mismo contenido no recalcula ni cambia la revisión', async () => {
  const box = tempRoot('rag-ef');
  try {
    const cwd = join(box.root, 'proyecto');
    const store = join(box.root, 'almacen');
    mkdirSync(cwd, { recursive: true });
    const path = join(cwd, 'a.md');
    writeFileSync(path, '# Estable\n\nEl contenido no cambia.', 'utf8');
    const config = validateConfig({});
    const first = await ingestFiles({ root: store, files: [path], now: 1, config });
    assert.equal(first.ingested.length, 1);

    const opened = openDatabase({ root: store, create: false });
    const revision = opened.db.prepare("SELECT value FROM meta WHERE key = 'index_revision'").get().value;
    const auditBefore = opened.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n;
    closeDatabase(opened.db);

    const again = await ingestFiles({ root: store, files: [path], now: 2, config });
    assert.equal(again.skipped.length, 1);
    assert.equal(again.ingested.length, 0);

    const after = openDatabase({ root: store, create: false });
    try {
      assert.equal(after.db.prepare("SELECT value FROM meta WHERE key = 'index_revision'").get().value, revision);
      assert.equal(after.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, auditBefore + 1, 'se audita el skip');
      assert.equal(after.db.prepare("SELECT outcome FROM audit ORDER BY seq DESC LIMIT 1").get().outcome, 'skipped');
    } finally {
      closeDatabase(after.db);
    }
  } finally {
    box.cleanup();
  }
});

test('AC20: el contexto no corta un bloque a mitad; si no cabe, lo dice', async () => {
  const box = tempRoot('rag-ef');
  try {
    const cwd = join(box.root, 'proyecto');
    const store = join(box.root, 'almacen');
    mkdirSync(cwd, { recursive: true });
    const path = join(cwd, 'largo.md');
    writeFileSync(path, `# Largo\n\n${'palabra '.repeat(3000)}`, 'utf8');
    const config = validateConfig({});
    await ingestFiles({ root: store, files: [path], now: 1, config });

    const opened = openDatabase({ root: store, create: false });
    try {
      const result = await search(opened.db, { query: 'palabra', limit: 5, config });
      const small = assembleContext({ results: result.results, config, budgetTokens: 10, maxChunks: 12, mmrLambda: 0.7 });
      assert.equal(small.text, '', 'no se entrega un fragmento recortado');
      assert.equal(small.truncated, true);

      const roomy = assembleContext({ results: result.results, config, budgetTokens: 2000, maxChunks: 12, mmrLambda: 0.7 });
      assert.equal(roomy.truncated, false);
      assert.ok(roomy.tokens <= 2000);
      assert.ok(roomy.citations.length >= 1);
    } finally {
      closeDatabase(opened.db);
    }
  } finally {
    box.cleanup();
  }
});
