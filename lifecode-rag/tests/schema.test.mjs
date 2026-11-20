/**
 * Esquema, FTS externa y transacciones: invariantes I1–I5 del plan v2 / resolución v2.1.
 *
 * Todo se ejecuta en cajas temporales. La prueba de la fila huérfana inyecta en `chunks_fts` a mano,
 * que es exactamente lo que el diseño debe detectar y reparar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  assertAuditHead,
  closeDatabase,
  ftsIntegrityCheck,
  ftsRebuild,
  openDatabase,
  readMeta,
  withTransaction,
  writeMeta,
} from '../lib/db.mjs';
import { APPLICATION_ID, EXPECTED_TABLES, SCHEMA_VERSION } from '../lib/schema.mjs';
import { ftsMatches, insertChunk, insertSource, tempRoot } from './helpers.mjs';

function initialized() {
  const box = tempRoot('rag-schema');
  const opened = openDatabase({ root: box.root, create: true, now: 1_700_000_000_000 });
  return { ...box, ...opened };
}

test('init crea el esquema completo con application_id y user_version propios', () => {
  const { root, db, paths, cleanup } = initialized();
  try {
    assert.equal(existsSync(paths.database), true);
    assert.equal(Number(db.prepare('PRAGMA application_id').get().application_id), APPLICATION_ID);
    assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), SCHEMA_VERSION);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
    for (const name of EXPECTED_TABLES) assert.ok(tables.includes(name), `falta ${name}`);
    assert.equal(readMeta(db, 'schema_version'), String(SCHEMA_VERSION));
    assert.equal(readMeta(db, 'embedding_model'), 'local-hash-v1');
    assert.equal(readMeta(db, 'index_revision'), '0');
    assert.equal(readMeta(db, 'audit_head_seq'), '0');
    // quick_check y cabeza de auditoría coherentes en el momento de abrir.
    assertAuditHead(db);
  } finally {
    closeDatabase(db);
    cleanup();
  }
});

test('abrir sin crear no inventa un almacén; crear sobre otro producto no lo pisa', () => {
  const box = tempRoot('rag-guard');
  try {
    assert.throws(
      () => openDatabase({ root: box.root, create: false }),
      (error) => error.code === 'store-not-initialized',
    );
    assert.equal(existsSync(join(box.root, 'rag.sqlite3')), false, 'no debe crear el fichero al fallar');

    // Un SQLite ajeno (sin application_id, con tablas) se rechaza en vez de interpretarse.
    const foreign = new DatabaseSync(join(box.root, 'rag.sqlite3'));
    foreign.exec('CREATE TABLE otra (id INTEGER PRIMARY KEY)');
    foreign.close();
    assert.throws(
      () => openDatabase({ root: box.root, create: true }),
      (error) => error.code === 'store-not-rag',
    );
  } finally {
    box.cleanup();
  }
});

test('una versión de esquema más nueva no se abre', () => {
  const { root, db, cleanup } = initialized();
  db.exec('PRAGMA user_version = 99');
  closeDatabase(db);
  try {
    assert.throws(
      () => openDatabase({ root, create: false }),
      (error) => error.code === 'store-version-unsupported',
    );
  } finally {
    cleanup();
  }
});

test('los disparadores mantienen la FTS externa alineada en alta, cambio y borrado', () => {
  const { db, cleanup } = initialized();
  try {
    insertSource(db);
    const chunk = insertChunk(db, { text: 'alpha original' });
    assert.equal(ftsMatches(db, 'alpha'), 1);
    assert.equal(ftsMatches(db, 'original'), 1);

    db.prepare('UPDATE chunks SET text = ? WHERE id = ?').run('beta nuevo', chunk.id);
    assert.equal(ftsMatches(db, 'alpha'), 0, 'el término viejo no puede sobrevivir a un UPDATE');
    assert.equal(ftsMatches(db, 'beta'), 1);
    ftsIntegrityCheck(db);

    db.prepare('DELETE FROM chunks WHERE id = ?').run(chunk.id);
    assert.equal(ftsMatches(db, 'beta'), 0);
    ftsIntegrityCheck(db);
  } finally {
    closeDatabase(db);
    cleanup();
  }
});

test('una fila huérfana en chunks_fts se detecta y se repara con rebuild', () => {
  const { db, cleanup } = initialized();
  try {
    insertSource(db);
    insertChunk(db, { text: 'texto legítimo' });
    // Inyección directa: el diseño no puede impedirla desde SQL, pero sí detectarla.
    db.exec("INSERT INTO chunks_fts(rowid, text, title, heading) VALUES (999, 'fantasma', 'x', '')");
    assert.throws(() => ftsIntegrityCheck(db), (error) => error.code === 'fts-integrity');
    ftsRebuild(db);
    ftsIntegrityCheck(db);
    assert.equal(ftsMatches(db, 'fantasma'), 0);
    assert.equal(ftsMatches(db, 'legítimo'), 1);
  } finally {
    closeDatabase(db);
    cleanup();
  }
});

test('una transacción fallida no deja fuente, chunk ni entrada FTS', () => {
  const { db, cleanup } = initialized();
  try {
    assert.throws(() => withTransaction(db, () => {
      insertSource(db);
      insertChunk(db, { text: 'a medio escribir' });
      throw new Error('fallo simulado');
    }), /fallo simulado/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sources').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n, 0);
    assert.equal(ftsMatches(db, 'medio'), 0);
    ftsIntegrityCheck(db);
  } finally {
    closeDatabase(db);
    cleanup();
  }
});

test('la cabeza de auditoría declarada manda: una deriva impide abrir', () => {
  const { root, db, cleanup } = initialized();
  try {
    writeMeta(db, 'audit_head_seq', '7');
    assert.throws(() => assertAuditHead(db), (error) => error.code === 'store-corrupt');
  } finally {
    closeDatabase(db);
  }
  try {
    assert.throws(
      () => openDatabase({ root, create: false }),
      (error) => error.code === 'store-corrupt',
    );
  } finally {
    cleanup();
  }
});

test('borrar una fuente arrastra chunks, etiquetas, vectores y FTS', () => {
  const { db, cleanup } = initialized();
  try {
    insertSource(db);
    const chunk = insertChunk(db, { text: 'contenido arrastrado' });
    db.prepare('INSERT INTO source_tags (source_id, tag) VALUES (?, ?)').run('src-1', 'demo');
    const vec = new Uint8Array(new Float32Array([0.5, 0.5]).buffer);
    db.prepare('INSERT INTO vectors (chunk_key, model, dim, vec) VALUES (?, ?, ?, ?)').run(chunk.chunkKey, 'local-hash-v1', 2, vec);

    db.prepare('DELETE FROM sources WHERE id = ?').run('src-1');
    for (const table of ['chunks', 'source_tags', 'vectors']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
    }
    assert.equal(ftsMatches(db, 'arrastrado'), 0);
    ftsIntegrityCheck(db);
  } finally {
    closeDatabase(db);
    cleanup();
  }
});
