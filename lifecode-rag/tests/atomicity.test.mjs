/**
 * AC9: un fallo inyectado a mitad del commit no toca la versión anterior ni la fila de `sources`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { verifyAuditChain } from '../lib/audit.mjs';
import { closeDatabase, ftsIntegrityCheck, openDatabase } from '../lib/db.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { tempRoot } from './helpers.mjs';

test('un fallo inyectado durante el reemplazo conserva la fuente anterior y su revisión', async () => {
  const box = tempRoot('rag-atomic');
  try {
    const cwd = join(box.root, 'proyecto');
    const store = join(box.root, 'almacen');
    mkdirSync(cwd, { recursive: true });
    const config = validateConfig({});

    writeFileSync(join(cwd, 'a.md'), 'alpha original', 'utf8');
    const first = await ingestFiles({ root: store, files: [join(cwd, 'a.md')], now: 1, config });
    assert.equal(first.ingested.length, 1);

    const before = openDatabase({ root: store, create: false });
    const revision = before.db.prepare("SELECT value FROM meta WHERE key = 'index_revision'").get().value;
    const sourceBefore = before.db.prepare('SELECT id, sha256 FROM sources').get();
    before.db.exec(`CREATE TRIGGER inject_failure BEFORE INSERT ON chunks
      WHEN instr(new.text, 'FALLA') > 0 BEGIN SELECT RAISE(ABORT, 'fallo inyectado'); END`);
    closeDatabase(before.db);

    writeFileSync(join(cwd, 'b.md'), `${'relleno '.repeat(400)}FALLA`, 'utf8');
    const second = await ingestFiles({ root: store, files: [join(cwd, 'b.md')], now: 2, config });
    assert.equal(second.ingested.length, 0);
    assert.equal(second.errors.length, 1);
    assert.match(second.errors[0].message, /fallo inyectado/);

    const after = openDatabase({ root: store, create: false });
    try {
      const sources = after.db.prepare('SELECT id, sha256 FROM sources').all();
      assert.equal(sources.length, 1, 'la fuente fallida no aparece');
      assert.deepEqual(sources[0], sourceBefore, 'la fuente anterior no cambió');
      const chunks = after.db.prepare('SELECT text FROM chunks').all();
      assert.deepEqual(chunks.map((chunk) => chunk.text), ['alpha original']);
      const fts = after.db.prepare('SELECT text FROM chunks_fts WHERE chunks_fts MATCH ?').all('"alpha"');
      assert.equal(fts.length, 1, 'la FTS sigue apuntando a la versión anterior');
      assert.equal(after.db.prepare("SELECT value FROM meta WHERE key = 'index_revision'").get().value, revision);
      ftsIntegrityCheck(after.db);
      const audit = verifyAuditChain(after.db);
      assert.equal(audit.ok, true);
      assert.equal(audit.count, 2, 'el fallo queda auditado sin arrastrar la mutación');
    } finally {
      closeDatabase(after.db);
    }
  } finally {
    box.cleanup();
  }
});
