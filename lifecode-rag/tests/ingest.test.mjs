/**
 * Ingesta: atomicidad por fichero, sustitución sin residuos y auditoría encadenada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { verifyAuditChain } from '../lib/audit.mjs';
import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { ingestFiles, prepareDocument } from '../lib/ingest.mjs';
import { RagError } from '../lib/errors.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { ftsMatches, tempRoot } from './helpers.mjs';

const config = validateConfig({});

function store(root, file) {
  const dir = join(root, 'docs');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file.name);
  writeFileSync(path, file.body, 'utf8');
  return path;
}

function inspect(root, work) {
  const opened = openDatabase({ root, create: false });
  try { return work(opened.db); } finally { closeDatabase(opened.db); }
}

test('ingerir un markdown deja fuente, chunks, vectores, etiquetas y auditoría coherentes', async () => {
  const box = tempRoot('rag-ingest');
  try {
    const path = store(box.root, { name: 'guia.md', body: '## Instalación\n\nUsa el comando init para preparar el almacén local.\n' });
    const result = await ingestFiles({ root: box.root, files: [path], tags: ['docs', 'rag'], config });
    assert.deepEqual(result.errors, []);
    assert.equal(result.ingested.length, 1);
    assert.equal(result.skipped.length, 0);

    inspect(box.root, (db) => {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sources').get().n, 1);
      const source = db.prepare('SELECT * FROM sources').get();
      assert.equal(source.collection, 'default');
      assert.equal(source.title, 'Instalación');
      assert.match(source.uri, /guia\.md$/);
      assert.ok(db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n >= 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vectors').get().n, db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM source_tags').get().n, 2);
      assert.equal(ftsMatches(db, 'instalación'), 1);
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'index_revision'").get().value, '1');
      assert.deepEqual(verifyAuditChain(db), { ok: true, count: 1 });
    });
  } finally {
    box.cleanup();
  }
});

test('reingerir sin cambios no reescribe; force sí lo hace', async () => {
  const box = tempRoot('rag-skip');
  try {
    const path = store(box.root, { name: 'a.md', body: 'contenido estable' });
    await ingestFiles({ root: box.root, files: [path], config });
    const second = await ingestFiles({ root: box.root, files: [path], config });
    assert.equal(second.skipped.length, 1);
    assert.equal(second.ingested.length, 0);
    assert.equal(second.skipped[0].reason, 'unchanged', 'un duplicado explica el motivo');

    const forced = await ingestFiles({ root: box.root, files: [path], config, force: true });
    assert.equal(forced.ingested.length, 1);

    inspect(box.root, (db) => {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n, 1, 'force no debe duplicar chunks');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sources').get().n, 1);
    });
  } finally {
    box.cleanup();
  }
});

test('cambiar el contenido sustituye chunks y vectores: el término viejo no sobrevive', async () => {
  const box = tempRoot('rag-replace');
  try {
    const path = store(box.root, { name: 'a.md', body: 'termino alfa exclusivo' });
    await ingestFiles({ root: box.root, files: [path], config });
    writeFileSync(path, 'termino beta definitivo', 'utf8');
    const result = await ingestFiles({ root: box.root, files: [path], config });
    assert.deepEqual(result.errors, []);

    inspect(box.root, (db) => {
      assert.equal(ftsMatches(db, 'alfa'), 0);
      assert.equal(ftsMatches(db, 'beta'), 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vectors').get().n, 1);
      assert.deepEqual(verifyAuditChain(db), { ok: true, count: 2 });
    });
  } finally {
    box.cleanup();
  }
});

test('si la sustitución falla, la versión anterior queda intacta', async () => {
  const box = tempRoot('rag-atomic');
  try {
    const path = store(box.root, { name: 'a.md', body: 'alpha original intacta' });
    await ingestFiles({ root: box.root, files: [path], config });
    const before = inspect(box.root, (db) => ({
      sha: db.prepare('SELECT sha256 FROM sources').get().sha256,
      chunks: db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n,
      vectors: db.prepare('SELECT COUNT(*) AS n FROM vectors').get().n,
    }));

    inspect(box.root, (db) => db.exec("CREATE TRIGGER boom BEFORE INSERT ON chunks BEGIN SELECT RAISE(ABORT, 'boom'); END"));

    writeFileSync(path, 'beta nueva que no debe quedar', 'utf8');
    const result = await ingestFiles({ root: box.root, files: [path], config });
    assert.equal(result.ingested.length, 0);
    assert.equal(result.errors.length, 1);

    inspect(box.root, (db) => {
      const after = db.prepare('SELECT sha256 FROM sources').get();
      assert.equal(after.sha256, before.sha, 'la fuente no cambia');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n, before.chunks);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vectors').get().n, before.vectors);
      assert.equal(ftsMatches(db, 'alpha'), 1);
      assert.equal(ftsMatches(db, 'beta'), 0);
      assert.equal(verifyAuditChain(db).ok, true);
    });

    inspect(box.root, (db) => db.exec('DROP TRIGGER boom'));
    const retry = await ingestFiles({ root: box.root, files: [path], config });
    assert.deepEqual(retry.errors, []);
    inspect(box.root, (db) => {
      assert.equal(ftsMatches(db, 'beta'), 1);
      assert.equal(ftsMatches(db, 'alpha'), 0);
    });
  } finally {
    box.cleanup();
  }
});

test('un fallo de un fichero no impide ingerir el resto y queda auditado', async () => {
  const box = tempRoot('rag-batch');
  try {
    const good = store(box.root, { name: 'bien.md', body: 'contenido válido' });
    const binary = join(box.root, 'docs', 'binario.txt');
    writeFileSync(binary, new Uint8Array([0x00, 0x01, 0x02]));
    const result = await ingestFiles({ root: box.root, files: [good, binary], config });
    assert.equal(result.ingested.length, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].code, 'binary-file');

    inspect(box.root, (db) => {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sources').get().n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE outcome = 'failed'").get().n, 1);
      assert.equal(verifyAuditChain(db).ok, true);
      assert.ok(db.prepare('SELECT COUNT(*) AS n FROM metrics_daily').get().n > 0, 'la ingesta deja métricas agregadas');
    });
  } finally {
    box.cleanup();
  }
});

test('prepareDocument rechaza vacíos y demasiado grandes sin escribir', async () => {
  const box = tempRoot('rag-prepare');
  try {
    const empty = join(box.root, 'vacio.md');
    writeFileSync(empty, '', 'utf8');
    await assert.rejects(() => prepareDocument(empty, { config }), (error) => error.code === 'source-unreadable');

    const big = join(box.root, 'grande.md');
    writeFileSync(big, 'x'.repeat(2_000_001), 'utf8');
    await assert.rejects(() => prepareDocument(big, { config }), (error) => error instanceof RagError && error.code === 'too-large');
  } finally {
    box.cleanup();
  }
});
