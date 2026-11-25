/**
 * R1.2 · Registro v4: la migración es **aditiva** y el índice de exclusividad tiene preflight.
 *
 * Qué se demuestra:
 *  - un registro v2 (once tablas, con datos) se abre y migra a v4 creando sólo las estructuras
 *    nuevas (`workspace_tracking`, `provision_intents`, `sync_requests` y sus índices), sin cambiar
 *    el recuento de ninguna tabla existente ni la cadena de auditoría;
 *  - un registro v3 con dos filas que comparten `project_id` **no** migra: aborta con
 *    `registry-migration-conflict`, deja el registro en v3 y no elige propietario;
 *  - la migración es idempotente y un registro nuevo ya nace en v4 con el índice único.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  addRoot, appendRegistryAudit, closeRegistry, createLibrary, createProject, newId, openRegistry,
  preflightExclusiveTracking, registryIntegrity, verifyRegistryAudit,
} from '../lib/registry.mjs';
import { applySelection } from '../lib/selection.mjs';
import { REGISTRY_MIGRATIONS, REGISTRY_VERSION } from '../lib/registry-schema.mjs';

/** Las once tablas que un registro v2 real tiene. Las de v3/v4 no están: son lo que añade la migración. */
const V2_TABLES = Object.freeze([
  'audit_registry', 'grants', 'libraries', 'meta', 'operation_steps', 'operations',
  'pa_selection', 'projects', 'roots', 'session_scope', 'sync_state',
]);

const V4_ONLY_TABLES = Object.freeze(['provision_intents', 'sync_requests', 'workspace_tracking']);

function tempDir(prefix = 'lcr-tracking-migration-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function tableCounts(db, tables = V2_TABLES) {
  return Object.fromEntries(tables.map((name) => [
    name,
    Number(db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n),
  ]));
}

function tableNames(db) {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map((row) => row.name);
}

function indexNames(db, table) {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?
    AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name`).all(table).map((row) => row.name);
}

function userVersion(db) {
  return Number(db.prepare('PRAGMA user_version').get().user_version);
}

function metaVersion(db) {
  return db.prepare(`SELECT value FROM meta WHERE key='registry_version'`).get()?.value ?? null;
}

/** Degrada el registro recién creado a la forma v2 exacta (sin estructuras de v3 ni de v4). */
function degradeToV2(db) {
  db.exec('DROP TABLE workspace_tracking');
  db.exec('DROP TABLE provision_intents');
  db.exec('DROP TABLE sync_requests');
  db.exec('PRAGMA user_version = 2');
  db.prepare(`UPDATE meta SET value='2' WHERE key='registry_version'`).run();
}

/** Un registro con datos en **todas** las tablas de v2: migrar tiene que conservarlos. */
function seedV2(root, docs) {
  const { db } = openRegistry({ root, create: true, now: 1_700_000_000_000 });
  const alpha = createProject(db, { name: 'Alfa', now: 1_700_000_000_100 });
  const beta = createProject(db, { name: 'Beta', now: 1_700_000_000_200 });
  const library = createLibrary(db, { name: 'Biblioteca', now: 1_700_000_000_300 });
  const rootRow = addRoot(db, {
    scopeKind: 'prj', scopeId: alpha.id, path: docs, now: 1_700_000_000_400,
  });
  const insertAt = '2026-11-23T00:00:00.000Z';
  db.prepare(`INSERT INTO grants (project_id, library_id, permission, granted_at, granted_by)
    VALUES (?, ?, 'read', ?, 'human')`).run(alpha.id, library.id, insertAt);
  db.prepare(`INSERT INTO session_scope
      (session_id, project_id, state, selection_source, selected_by, selected_at, updated_at)
    VALUES ('ses-v2', ?, 'active', 'explicit', 'human', ?, ?)`).run(alpha.id, insertAt, insertAt);
  db.prepare(`INSERT INTO sync_state
      (scope_kind, scope_id, root_id, source_key, status, last_seen_at, updated_at)
    VALUES ('prj', ?, ?, 'docs/guia.md', 'present', ?, ?)`)
    .run(alpha.id, rootRow.id, insertAt, insertAt);
  const operation = newId('op_', 1_700_000_000_500);
  db.prepare(`INSERT INTO operations (id, kind, state, started_at, finished_at, detail)
    VALUES (?, 'ingest', 'committed', ?, ?, '{}')`).run(operation, insertAt, insertAt);
  db.prepare(`INSERT INTO operation_steps (operation_id, step, state, updated_at)
    VALUES (?, 'chunks', 'done', ?)`).run(operation, insertAt);
  applySelection(db, { projectId: beta.id, expectedRevision: 0, now: 1_700_000_000_600 });
  appendRegistryAudit(db, {
    at: 1_700_000_000_700, actor: 'human', action: 'project.create', target: alpha.id, outcome: 'ok',
  });
  appendRegistryAudit(db, {
    at: 1_700_000_000_800, actor: 'host', action: 'scope.resolve', target: beta.id, outcome: 'ok',
  });
  return { db, alpha, beta };
}

test('registro v2 → v4: crea sólo las estructuras nuevas y conserva las once tablas con sus recuentos', () => {
  const root = tempDir();
  const docs = tempDir('lcr-tracking-docs-');
  try {
    const seeded = seedV2(root, docs);
    degradeToV2(seeded.db);
    const before = tableCounts(seeded.db);
    const beforeIntegrity = seeded.db.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check);
    assert.deepEqual(Object.keys(before).sort(), V2_TABLES, 'el v2 de partida tiene las once tablas');
    assert.equal(userVersion(seeded.db), 2);
    assert.equal(verifyRegistryAudit(seeded.db).ok, true);
    for (const table of V4_ONLY_TABLES) {
      assert.equal(tableNames(seeded.db).includes(table), false, `v2 no tiene ${table}`);
    }
    closeRegistry(seeded.db);

    const migrated = openRegistry({ root, create: false });
    try {
      assert.equal(REGISTRY_VERSION, 4);
      assert.equal(userVersion(migrated.db), 4);
      assert.equal(metaVersion(migrated.db), '4', 'los dos marcadores de versión suben juntos');
      for (const table of V4_ONLY_TABLES) {
        assert.ok(tableNames(migrated.db).includes(table), `la tabla ${table} existe`);
      }
      assert.deepEqual(
        indexNames(migrated.db, 'workspace_tracking'),
        ['workspace_tracking_project', 'workspace_tracking_project_exclusive', 'workspace_tracking_state'],
        'los dos índices de v3 y el único de exclusividad',
      );
      assert.deepEqual(tableCounts(migrated.db), before, 'ninguna fila de las once tablas cambió de recuento');
      assert.deepEqual(
        migrated.db.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check),
        beforeIntegrity,
        'integrity_check sigue en ok',
      );
      assert.equal(migrated.db.prepare('PRAGMA foreign_key_check').all().length, 0);
      assert.equal(verifyRegistryAudit(migrated.db).ok, true, 'la cadena de auditoría no se tocó');
      assert.equal(registryIntegrity(migrated.db).quickCheck, 'ok');
      assert.equal(registryIntegrity(migrated.db).audit.ok, true);

      // La tabla nueva nace vacía y con los CHECK y el DEFAULT de revisión del contrato.
      assert.equal(migrated.db.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 0);
      assert.equal(migrated.db.prepare('SELECT COUNT(*) AS n FROM provision_intents').get().n, 0);
      assert.equal(migrated.db.prepare('SELECT COUNT(*) AS n FROM sync_requests').get().n, 0);
      migrated.db.prepare(`INSERT INTO workspace_tracking
          (path_key, path, workspace_id, project_id, state, association, bound_by, bound_at, updated_at)
        VALUES ('c:/tmp/alfa', 'C:\\tmp\\Alfa', 'ws-1', ?, 'on', 'explicit', 'human', '1', '1')`)
        .run(seeded.alpha.id);
      const inserted = migrated.db.prepare('SELECT revision, last_status, last_seen_at FROM workspace_tracking').get();
      assert.deepEqual({ ...inserted }, { revision: 1, last_status: null, last_seen_at: null });
      assert.throws(
        () => migrated.db.prepare(`INSERT INTO workspace_tracking
            (path_key, state, association, bound_by, bound_at, updated_at)
          VALUES ('c:/tmp/beta', 'seguido', 'explicit', 'human', '1', '1')`).run(),
        /CHECK|constraint/i,
        'un estado fuera de on/off/paused no entra',
      );
      assert.throws(
        () => migrated.db.prepare(`INSERT INTO workspace_tracking
            (path_key, state, association, bound_by, bound_at, updated_at)
          VALUES ('c:/tmp/gamma', 'on', 'explicit', 'host', '1', '1')`).run(),
        /CHECK|constraint/i,
        'el Host no puede ser autor de una fila',
      );
      assert.throws(
        () => migrated.db.prepare(`INSERT INTO workspace_tracking
            (path_key, path, project_id, state, association, bound_by, bound_at, updated_at)
          VALUES ('c:/tmp/delta', 'C:\\tmp\\Delta', ?, 'on', 'explicit', 'human', '1', '1')`)
          .run(seeded.alpha.id),
        /UNIQUE|unique/i,
        'el índice de exclusividad impide dos workspaces sobre la misma memoria',
      );
    } finally { closeRegistry(migrated.db); }

    const again = openRegistry({ root, create: false });
    try {
      assert.equal(userVersion(again.db), 4);
      assert.equal(metaVersion(again.db), '4');
      assert.equal(again.db.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 1);
      assert.deepEqual(tableCounts(again.db), before);
    } finally { closeRegistry(again.db); }

    const thrice = openRegistry({ root, create: false });
    try {
      for (const statement of REGISTRY_MIGRATIONS[4]) thrice.db.exec(statement);
      assert.equal(userVersion(thrice.db), 4);
      assert.equal(thrice.db.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 1);
      assert.equal(verifyRegistryAudit(thrice.db).ok, true);
    } finally { closeRegistry(thrice.db); }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(docs, { recursive: true, force: true });
  }
});

test('preflight v4: dos workspaces sobre el mismo proyecto abortan la migración sin elegir dueño', async () => {
  const root = tempDir();
  const docs = tempDir('lcr-tracking-conflict-');
  try {
    // Registro v3 "de verdad": se quitan sólo las estructuras de v4.
    const seeded = seedV2(root, docs);
    seeded.db.exec('DROP TABLE provision_intents');
    seeded.db.exec('DROP TABLE sync_requests');
    seeded.db.exec('DROP INDEX workspace_tracking_project_exclusive');
    seeded.db.exec('PRAGMA user_version = 3');
    seeded.db.prepare(`UPDATE meta SET value='3' WHERE key='registry_version'`).run();
    const at = '2026-11-23T00:00:00.000Z';
    const insert = seeded.db.prepare(`INSERT INTO workspace_tracking
        (path_key, path, project_id, state, association, bound_by, bound_at, updated_at, revision)
      VALUES (?, ?, ?, 'on', 'explicit', 'human', ?, ?, 1)`);
    insert.run('c:/tmp/alfa', 'C:\\tmp\\Alfa', seeded.alpha.id, at, at);
    insert.run('c:/tmp/alfa-clon', 'C:\\tmp\\AlfaClon', seeded.alpha.id, at, at);
    const duplicates = preflightExclusiveTracking(seeded.db);
    assert.equal(duplicates.length, 2);
    assert.deepEqual(duplicates.map((row) => row.pathKey), ['c:/tmp/alfa', 'c:/tmp/alfa-clon']);
    closeRegistry(seeded.db);

    assert.throws(
      () => openRegistry({ root, create: false }),
      (error) => {
        assert.equal(error.code, 'registry-migration-conflict');
        assert.equal(error.details.to, 4);
        assert.equal(error.details.duplicates.length, 2);
        return true;
      },
      'la migración aborta y explica el conflicto',
    );

    // El registro se quedó en v3, con sus dos filas y sin estructuras v4: no hubo escritura parcial.
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(join(root, 'registry.sqlite3'));
    try {
      assert.equal(Number(raw.prepare('PRAGMA user_version').get().user_version), 3);
      assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 2);
      assert.equal(
        raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('provision_intents','sync_requests')").get().n,
        0,
      );
    } finally { raw.close(); }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(docs, { recursive: true, force: true });
  }
});

test('un registro nuevo ya nace en v4 con seguimiento, intención, cola e índice de exclusividad', () => {
  const root = tempDir();
  try {
    const { db } = openRegistry({ root, create: true, now: 1_700_000_000_000 });
    try {
      assert.equal(userVersion(db), 4);
      assert.equal(metaVersion(db), '4');
      for (const table of V4_ONLY_TABLES) assert.ok(tableNames(db).includes(table), table);
      assert.deepEqual(
        indexNames(db, 'workspace_tracking'),
        ['workspace_tracking_project', 'workspace_tracking_project_exclusive', 'workspace_tracking_state'],
      );
      assert.deepEqual(indexNames(db, 'provision_intents'), ['provision_intents_state']);
      assert.deepEqual(indexNames(db, 'sync_requests'), ['sync_requests_state']);
      assert.equal(registryIntegrity(db).audit.ok, true);
    } finally { closeRegistry(db); }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
