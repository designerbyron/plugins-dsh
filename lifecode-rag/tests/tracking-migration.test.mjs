/**
 * UX-2.2 · Registro v3: la migración es **aditiva**.
 *
 * Qué se demuestra: un registro v2 con datos reales en sus once tablas se abre, migra a v3 creando
 * sólo `workspace_tracking` y sus índices, y **ninguna fila de las tablas existentes cambia de
 * recuento**; `integrity_check` sigue en `ok`, la cadena de auditoría verifica, los dos marcadores de
 * versión (`PRAGMA user_version` y `meta.registry_version`) quedan en 3, y repetir la migración no
 * duplica ni falla.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  addRoot, appendRegistryAudit, closeRegistry, createLibrary, createProject, newId, openRegistry,
  registryIntegrity, verifyRegistryAudit,
} from '../lib/registry.mjs';
import { applySelection } from '../lib/selection.mjs';
import { REGISTRY_MIGRATIONS, REGISTRY_VERSION } from '../lib/registry-schema.mjs';

/** Las once tablas que un registro v2 real tiene. `workspace_tracking` no está: es lo que añade v3. */
const V2_TABLES = Object.freeze([
  'audit_registry', 'grants', 'libraries', 'meta', 'operation_steps', 'operations',
  'pa_selection', 'projects', 'roots', 'session_scope', 'sync_state',
]);

function tempDir(prefix = 'lcr-tracking-migration-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function tableCounts(db) {
  return Object.fromEntries(V2_TABLES.map((name) => [
    name,
    Number(db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n),
  ]));
}

function tableNames(db) {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map((row) => row.name);
}

function userVersion(db) {
  return Number(db.prepare('PRAGMA user_version').get().user_version);
}

function metaVersion(db) {
  return db.prepare(`SELECT value FROM meta WHERE key='registry_version'`).get()?.value ?? null;
}

/** Un registro v2 con datos en **todas** las tablas: mover la migración tiene que conservarlos. */
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

test('registro v2 → v3: crea sólo la tabla nueva y conserva las once tablas con sus recuentos', () => {
  const root = tempDir();
  const docs = tempDir('lcr-tracking-docs-');
  try {
    // 1) Un registro real, degradado a la forma v2 exacta: sin `workspace_tracking`, versión 2.
    const seeded = seedV2(root, docs);
    seeded.db.exec('DROP TABLE workspace_tracking');
    seeded.db.exec('PRAGMA user_version = 2');
    seeded.db.prepare(`UPDATE meta SET value='2' WHERE key='registry_version'`).run();
    const before = tableCounts(seeded.db);
    const beforeIntegrity = seeded.db.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check);
    assert.deepEqual(Object.keys(before).sort(), V2_TABLES, 'el v2 de partida tiene las once tablas');
    assert.equal(userVersion(seeded.db), 2);
    assert.equal(verifyRegistryAudit(seeded.db).ok, true);
    assert.equal(tableNames(seeded.db).includes('workspace_tracking'), false);
    closeRegistry(seeded.db);

    // 2) Abrirlo con el código nuevo migra de forma aditiva.
    const migrated = openRegistry({ root, create: false });
    try {
      assert.equal(userVersion(migrated.db), REGISTRY_VERSION);
      assert.equal(REGISTRY_VERSION, 3);
      assert.equal(metaVersion(migrated.db), '3', 'los dos marcadores de versión suben juntos');
      assert.ok(tableNames(migrated.db).includes('workspace_tracking'), 'la tabla nueva existe');

      assert.deepEqual(tableCounts(migrated.db), before, 'ninguna fila de las once tablas cambió de recuento');
      assert.deepEqual(
        migrated.db.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check),
        beforeIntegrity,
        'integrity_check sigue en ok',
      );
      assert.equal(migrated.db.prepare('PRAGMA foreign_key_check').all().length, 0);
      assert.equal(verifyRegistryAudit(migrated.db).ok, true, 'la cadena de auditoría no se tocó');
      const integrity = registryIntegrity(migrated.db);
      assert.equal(integrity.quickCheck, 'ok');
      assert.equal(integrity.audit.ok, true);

      // La tabla nueva nace vacía y con los CHECK y el DEFAULT de revisión del contrato.
      assert.equal(migrated.db.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 0);
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
        'el Host no puede ser autor de una fila en UX-2.2',
      );
    } finally { closeRegistry(migrated.db); }

    // 3) Idempotente: reabrir no vuelve a migrar ni altera nada.
    const again = openRegistry({ root, create: false });
    try {
      assert.equal(userVersion(again.db), 3);
      assert.equal(metaVersion(again.db), '3');
      assert.equal(again.db.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 1);
      assert.deepEqual(tableCounts(again.db), before);
    } finally { closeRegistry(again.db); }

    // 4) Y ejecutar las sentencias de la migración una segunda vez tampoco falla.
    const thrice = openRegistry({ root, create: false });
    try {
      for (const statement of REGISTRY_MIGRATIONS[3]) thrice.db.exec(statement);
      assert.equal(userVersion(thrice.db), 3);
      assert.equal(thrice.db.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 1);
      assert.equal(verifyRegistryAudit(thrice.db).ok, true);
    } finally { closeRegistry(thrice.db); }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(docs, { recursive: true, force: true });
  }
});

test('un registro nuevo ya nace en v3 con la tabla del seguimiento y sus dos índices', () => {
  const root = tempDir();
  try {
    const { db } = openRegistry({ root, create: true, now: 1_700_000_000_000 });
    try {
      assert.equal(userVersion(db), 3);
      assert.equal(metaVersion(db), '3');
      assert.ok(tableNames(db).includes('workspace_tracking'));
      const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='workspace_tracking'
        AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name`).all().map((row) => row.name);
      assert.deepEqual(indexes, ['workspace_tracking_project', 'workspace_tracking_state']);
      assert.equal(registryIntegrity(db).audit.ok, true);
    } finally { closeRegistry(db); }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
