import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  addRoot, appendRegistryAudit, archiveProject, closeRegistry, createLibrary, createProject, getProject,
  listProjects, listRoots, newId, openRegistry, pathKeyFor, registryIntegrity, removeRoot, restoreProject,
  updateProject, verifyRegistryAudit,
} from '../lib/registry.mjs';
import { applySelection, archiveProjectWithSelection, readSelection } from '../lib/selection.mjs';
import { httpStatusFor } from '../lib/errors.mjs';
import { REGISTRY_VERSION } from '../lib/registry-schema.mjs';
import { profileKey, profileRoot, registryPath } from '../lib/profile.mjs';

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'lcr-registry-'));
}

test('crea un registro vacío con esquema, aplicación y auditoría válidos', () => {
  const root = tempRoot();
  try {
    const { db, path } = openRegistry({ root, create: true, now: 1_700_000_000_000 });
    assert.equal(path, registryPath(root));
    const integrity = registryIntegrity(db);
    assert.equal(integrity.quickCheck, 'ok');
    assert.equal(integrity.foreignKeys, 0);
    assert.equal(integrity.audit.ok, true);
    assert.equal(Number(db.prepare('PRAGMA application_id').get().application_id), 1_279_480_402);
    assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), REGISTRY_VERSION);
    closeRegistry(db);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reabrir un registro válido funciona y un fichero ajeno se rechaza', () => {
  const root = tempRoot();
  try {
    closeRegistry(openRegistry({ root, create: true }).db);
    const again = openRegistry({ root });
    assert.equal(registryIntegrity(again.db).audit.ok, true);
    closeRegistry(again.db);

    const foreignRoot = tempRoot();
    const foreign = new DatabaseSync(registryPath(foreignRoot));
    foreign.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    foreign.exec('PRAGMA application_id = 123');
    foreign.close();
    assert.throws(() => openRegistry({ root: foreignRoot }), /no es de LifeCode RAG/);
    rmSync(foreignRoot, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('registro ausente sin create es un error, no un registro vacío', () => {
  const root = tempRoot();
  try {
    assert.throws(() => openRegistry({ root }), /no existe/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('proyecto, biblioteca y raíz: la raíz exige ámbito existente y ruta única', () => {
  const root = tempRoot();
  const projectDir = tempRoot();
  // Ruta distinta para el caso «ámbito inexistente»: con la misma ruta, la comprobación de
  // duplicado de PA4 salta antes que el disparador del esquema y el caso no se ejercitaría.
  const orphanDir = tempRoot();
  let db = null;
  try {
    ({ db } = openRegistry({ root, create: true }));
    const project = createProject(db, { name: 'Proyecto' });
    assert.match(project.id, /^prj_[0-9A-HJKMNP-TV-Z]{26}$/);

    const bound = addRoot(db, { scopeKind: 'prj', scopeId: project.id, path: projectDir });
    assert.equal(bound.pathKey, pathKeyFor(projectDir));
    assert.equal(listRoots(db).length, 1);

    assert.throws(
      () => addRoot(db, { scopeKind: 'prj', scopeId: newId('prj_'), path: orphanDir }),
      /root-scope-missing/,
    );
    assert.throws(
      () => addRoot(db, { scopeKind: 'prj', scopeId: project.id, path: projectDir }),
      /ya está registrada/,
    );
    const library = createLibrary(db, { name: 'Biblioteca' });
    assert.match(library.id, /^lib_/);
  } finally {
    if (db) closeRegistry(db);
    rmSync(root, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(orphanDir, { recursive: true, force: true });
  }
});

test('no se puede borrar un proyecto con raíces asociadas', () => {
  const root = tempRoot();
  const projectDir = tempRoot();
  try {
    const { db } = openRegistry({ root, create: true });
    const project = createProject(db, { name: 'Con raíz' });
    addRoot(db, { scopeKind: 'prj', scopeId: project.id, path: projectDir });
    assert.throws(() => db.prepare('DELETE FROM projects WHERE id = ?').run(project.id), /scope-has-roots/);
    closeRegistry(db);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('la cadena de auditoría del registro detecta una edición', () => {
  const root = tempRoot();
  try {
    const { db } = openRegistry({ root, create: true });
    appendRegistryAudit(db, { at: 1, actor: 'human', action: 'project.create', target: 'prj_x', outcome: 'ok', detail: '{}' });
    appendRegistryAudit(db, { at: 2, actor: 'human', action: 'root.add', target: 'rt_x', outcome: 'ok', detail: '{}' });
    assert.equal(verifyRegistryAudit(db).count, 2);
    db.prepare(`UPDATE audit_registry SET detail = '{"mutado":true}' WHERE seq = 1`).run();
    const broken = verifyRegistryAudit(db);
    assert.equal(broken.ok, false);
    assert.equal(broken.reason, 'hash');
    closeRegistry(db);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('registro v1 se migra a v2 de forma aditiva: crea `pa_selection` y conserva datos y auditoría', () => {
  const root = tempRoot();
  try {
    // Un registro recién creado, degradado a v1 tal como lo dejó la versión anterior: sin
    // `pa_selection`, con `user_version=1`. Es la forma exacta del registro del propietario.
    const first = openRegistry({ root, create: true, now: 1_700_000_000_000 });
    const project = createProject(first.db, { name: 'Proyecto v1', now: 1_700_000_000_000 });
    appendRegistryAudit(first.db, {
      at: 1_700_000_000_000, actor: 'human', action: 'test.seed', target: project.id, outcome: 'ok',
    });
    first.db.exec('DROP TABLE pa_selection');
    first.db.exec('PRAGMA user_version = 1');
    first.db.prepare(`UPDATE meta SET value='1' WHERE key='registry_version'`).run();
    closeRegistry(first.db);

    const migrated = openRegistry({ root, create: false });
    try {
      assert.equal(Number(migrated.db.prepare('PRAGMA user_version').get().user_version), REGISTRY_VERSION);
      assert.equal(migrated.db.prepare(`SELECT value FROM meta WHERE key='registry_version'`).get().value, String(REGISTRY_VERSION));
      const tables = migrated.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((row) => row.name);
      assert.ok(tables.includes('pa_selection'), 'la tabla nueva existe tras migrar');
      assert.equal(migrated.db.prepare('SELECT count(*) n FROM projects').get().n, 1, 'los proyectos no se tocan');
      assert.equal(registryIntegrity(migrated.db).audit.ok, true, 'la cadena de auditoría sigue verificando');
    } finally { closeRegistry(migrated.db); }

    // Idempotente: reabrir un registro ya migrado no vuelve a migrar ni falla.
    const again = openRegistry({ root, create: false });
    try {
      assert.equal(Number(again.db.prepare('PRAGMA user_version').get().user_version), REGISTRY_VERSION);
      assert.equal(again.db.prepare('SELECT count(*) n FROM projects').get().n, 1);
    } finally { closeRegistry(again.db); }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('raíz de perfil: anulación explícita, clave de perfil y rechazo de entornos vacíos', () => {
  const home = tempRoot();
  try {
    const override = join(home, 'custom');
    assert.equal(profileRoot({ LIFECODE_RAG_ROOT: override }), override);
    assert.equal(
      profileRoot({ DSH_HOME: home, DSH_PROFILE: 'desktop' }),
      join(home, 'lifecode-rag', 'profiles', 'desktop'),
    );
    // Un nombre que ya es un segmento válido no cambia: los perfiles existentes conservan su ruta.
    assert.equal(profileKey({ DSH_PROFILE: 'desktop' }), 'desktop');
    // Un nombre con pérdida (mayúsculas, espacios) se sanea y se desambigua: «Desktop Work» y
    // «desktop work» no pueden compartir registro, almacenes ni auditoría.
    const sanitized = profileKey({ DSH_PROFILE: 'Desktop Work' });
    assert.match(sanitized, /^desktop-work-[0-9a-f]{8}$/);
    assert.notEqual(sanitized, profileKey({ DSH_PROFILE: 'desktop work' }));
    assert.equal(sanitized, profileKey({ DSH_PROFILE: 'Desktop Work' }));
    assert.throws(() => profileRoot({ DSH_HOME: '' }), /vacía/);
    assert.throws(() => profileRoot({ LIFECODE_RAG_ROOT: 'relativa' }), /absoluta/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/* ------------------------------------------------- ACP-07 F1 · administración de proyectos
 *
 * Cada caso usa un registro y un directorio temporales. Ninguno abre un almacén de ámbito: el que se
 * simula (`scopes/<id>/rag.sqlite3`) contiene bytes arbitrarios y se comprueba por hash que las
 * operaciones no lo tocan.
 */

function adminFixture() {
  const root = tempRoot();
  const docs = mkdtempSync(join(tmpdir(), 'lcr-docs-'));
  const docs2 = mkdtempSync(join(tmpdir(), 'lcr-docs2-'));
  const { db } = openRegistry({ root, create: true, now: 1_700_000_000_000 });
  const project = createProject(db, { name: 'Alfa', now: 1_700_000_000_100 });
  addRoot(db, { scopeKind: 'prj', scopeId: project.id, path: docs, now: 1_700_000_000_200 });
  // Almacén de ámbito simulado: el registro nunca debe abrirlo ni escribirlo.
  const scopeDir = join(root, 'scopes', project.id);
  mkdirSync(scopeDir, { recursive: true });
  const scopeFile = join(scopeDir, 'rag.sqlite3');
  writeFileSync(scopeFile, 'almacen-simulado-de-fuentes');
  const digest = () => createHash('sha256').update(readFileSync(scopeFile)).digest('hex');
  return { root, docs, docs2, db, project, scopeFile, digest };
}

function cleanup(fixture) {
  try { closeRegistry(fixture.db); } catch { /* ya cerrado */ }
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.docs, { recursive: true, force: true });
  rmSync(fixture.docs2, { recursive: true, force: true });
}

test('updateProject cambia el nombre y conserva id, fecha de creación y raíces', () => {
  const fixture = adminFixture();
  try {
    const before = getProject(fixture.db, fixture.project.id);
    const result = updateProject(fixture.db, { id: fixture.project.id, name: 'Alfa renombrado', now: 1_700_000_001_000 });
    assert.equal(result.changed, true);
    assert.equal(result.project.name, 'Alfa renombrado');
    const after = getProject(fixture.db, fixture.project.id);
    assert.equal(after.id, before.id);
    assert.equal(after.created_at, before.created_at);
    assert.equal(after.updated_at, '1700000001000.0');
    assert.equal(listRoots(fixture.db, { scopeKind: 'prj', scopeId: fixture.project.id }).length, 1);
    // Repetir el mismo nombre no crea revisión ni entrada nueva.
    const again = updateProject(fixture.db, { id: fixture.project.id, name: 'Alfa renombrado', now: 1_700_000_002_000 });
    assert.equal(again.changed, false);
    assert.equal(verifyRegistryAudit(fixture.db).ok, true);
  } finally { cleanup(fixture); }
});

test('updateProject rechaza nombre vacío y proyecto inexistente', () => {
  const fixture = adminFixture();
  try {
    assert.throws(() => updateProject(fixture.db, { id: fixture.project.id, name: '  ' }), /entre 1 y 120/);
    assert.throws(() => updateProject(fixture.db, { id: 'prj_01M7RBSRD33M26HGBEFW51WPP9', name: 'X' }), (error) => {
      assert.equal(error.code, 'project-not-found');
      assert.equal(httpStatusFor(error.code), 404);
      return true;
    });
    assert.throws(() => updateProject(fixture.db, { id: 'no-es-un-id', name: 'X' }), /identificador de proyecto/);
    assert.equal(verifyRegistryAudit(fixture.db).ok, true);
  } finally { cleanup(fixture); }
});

test('archiveProject archiva sin borrar raíces y sin tocar el almacén del ámbito', () => {
  const fixture = adminFixture();
  try {
    const hashBefore = fixture.digest();
    const result = archiveProject(fixture.db, { id: fixture.project.id, now: 1_700_000_003_000 });
    assert.equal(result.changed, true);
    assert.equal(result.project.status, 'archived');
    assert.equal(result.project.archivedAt, 1_700_000_003_000);
    // La fila sigue, las raíces siguen y el almacén simulado está intacto byte a byte.
    assert.ok(getProject(fixture.db, fixture.project.id));
    assert.equal(listRoots(fixture.db, { scopeKind: 'prj', scopeId: fixture.project.id }).length, 1);
    assert.equal(fixture.digest(), hashBefore);
    assert.ok(existsSync(fixture.scopeFile));
    // Idempotente.
    const again = archiveProject(fixture.db, { id: fixture.project.id, now: 1_700_000_004_000 });
    assert.equal(again.changed, false);
    assert.equal(verifyRegistryAudit(fixture.db).ok, true);
  } finally { cleanup(fixture); }
});

test('archiveProject se niega si el proyecto está seleccionado', () => {
  const fixture = adminFixture();
  try {
    applySelection(fixture.db, { projectId: fixture.project.id, expectedRevision: 0, now: 1_700_000_005_000 });
    assert.throws(() => archiveProject(fixture.db, { id: fixture.project.id }), (error) => {
      assert.equal(error.code, 'invalid-argument');
      assert.equal(error.details.reason, 'selection-attached');
      return true;
    });
    // Y el proyecto sigue activo: la negativa no dejó nada a medias.
    assert.equal(getProject(fixture.db, fixture.project.id).status, 'active');
  } finally { cleanup(fixture); }
});

test('archiveProjectWithSelection mueve la selección al siguiente activo con revisión nueva', () => {
  const fixture = adminFixture();
  try {
    const beta = createProject(fixture.db, { name: 'Beta', now: 1_700_000_000_300 });
    addRoot(fixture.db, { scopeKind: 'prj', scopeId: beta.id, path: fixture.docs2, now: 1_700_000_000_400 });
    applySelection(fixture.db, { projectId: fixture.project.id, expectedRevision: 0, now: 1_700_000_006_000 });
    const result = archiveProjectWithSelection(fixture.db, { projectId: fixture.project.id, now: 1_700_000_007_000 });
    assert.equal(result.changed, true);
    assert.equal(result.project.status, 'archived');
    assert.equal(result.selectionChange, 'moved');
    assert.equal(result.selection.projectId, beta.id);
    assert.equal(result.selection.revision, 2);
    assert.equal(result.selection.selectedBy, 'host');
    // La selección persistida es la misma que devolvió la operación.
    assert.equal(readSelection(fixture.db).projectId, beta.id);
    assert.equal(verifyRegistryAudit(fixture.db).ok, true);
  } finally { cleanup(fixture); }
});

test('archiveProjectWithSelection deja el perfil sin selección si no queda ningún activo', () => {
  const fixture = adminFixture();
  try {
    applySelection(fixture.db, { projectId: fixture.project.id, expectedRevision: 0, now: 1_700_000_008_000 });
    const result = archiveProjectWithSelection(fixture.db, { projectId: fixture.project.id, now: 1_700_000_009_000 });
    assert.equal(result.selectionChange, 'cleared');
    assert.equal(result.selection, null);
    assert.equal(readSelection(fixture.db), null);
    assert.equal(listProjects(fixture.db, { status: 'active' }).projects.length, 0);
    assert.equal(verifyRegistryAudit(fixture.db).ok, true);
  } finally { cleanup(fixture); }
});

test('restoreProject devuelve a activo conservando identidad, raíces y sin tocar el almacén', () => {
  const fixture = adminFixture();
  try {
    const hashBefore = fixture.digest();
    archiveProject(fixture.db, { id: fixture.project.id, now: 1_700_000_010_000 });
    const restored = restoreProject(fixture.db, { id: fixture.project.id, now: 1_700_000_011_000 });
    assert.equal(restored.changed, true);
    assert.equal(restored.project.status, 'active');
    assert.equal(restored.project.archivedAt, null);
    assert.equal(restored.project.id, fixture.project.id);
    assert.equal(restored.project.createdAt, 1_700_000_000_100);
    assert.equal(listRoots(fixture.db, { scopeKind: 'prj', scopeId: fixture.project.id }).length, 1);
    assert.equal(fixture.digest(), hashBefore);
    assert.equal(restoreProject(fixture.db, { id: fixture.project.id }).changed, false);
    assert.equal(verifyRegistryAudit(fixture.db).ok, true);
  } finally { cleanup(fixture); }
});

test('removeRoot borra la fila, no el fichero, y protege la última raíz', () => {
  const fixture = adminFixture();
  try {
    const [rootRow] = listRoots(fixture.db, { scopeKind: 'prj', scopeId: fixture.project.id });
    // Única raíz: exige allowEmpty explícito.
    assert.throws(() => removeRoot(fixture.db, { rootId: rootRow.id }), (error) => {
      assert.equal(error.code, 'invalid-argument');
      assert.equal(error.details.reason, 'last-root');
      return true;
    });
    const hashBefore = fixture.digest();
    const result = removeRoot(fixture.db, { rootId: rootRow.id, allowEmpty: true, now: 1_700_000_012_000 });
    assert.equal(result.removed.id, rootRow.id);
    assert.equal(listRoots(fixture.db, { scopeKind: 'prj', scopeId: fixture.project.id }).length, 0);
    // El directorio del usuario y el almacén siguen donde estaban.
    assert.ok(existsSync(fixture.docs));
    assert.equal(fixture.digest(), hashBefore);
    assert.throws(() => removeRoot(fixture.db, { rootId: rootRow.id }), (error) => {
      assert.equal(error.code, 'source-not-found');
      return true;
    });
    assert.equal(verifyRegistryAudit(fixture.db).ok, true);
  } finally { cleanup(fixture); }
});

test('listProjects separa activos y archivados y cuenta raíces', () => {
  const fixture = adminFixture();
  try {
    const beta = createProject(fixture.db, { name: 'Beta', now: 1_700_000_000_300 });
    archiveProject(fixture.db, { id: beta.id, now: 1_700_000_013_000 });
    const active = listProjects(fixture.db, { status: 'active' });
    assert.deepEqual(active.projects.map((row) => row.name), ['Alfa']);
    assert.deepEqual(active.projects[0].roots, { total: 1, authorized: 1 });
    const archived = listProjects(fixture.db, { status: 'archived' });
    assert.deepEqual(archived.projects.map((row) => row.name), ['Beta']);
    assert.equal(archived.projects[0].roots.total, 0);
    const all = listProjects(fixture.db, { status: 'all' });
    assert.equal(all.projects.length, 2);
    assert.throws(() => listProjects(fixture.db, { status: 'otro' }), /active, archived o all/);
  } finally { cleanup(fixture); }
});

test('la cadena de auditoría del registro sigue verificando tras las cinco operaciones', () => {
  const fixture = adminFixture();
  try {
    const beta = createProject(fixture.db, { name: 'Beta', now: 1_700_000_014_000 });
    addRoot(fixture.db, { scopeKind: 'prj', scopeId: beta.id, path: fixture.docs2, now: 1_700_000_014_100 });
    updateProject(fixture.db, { id: beta.id, name: 'Beta 2', now: 1_700_000_014_200 });
    applySelection(fixture.db, { projectId: beta.id, expectedRevision: 0, now: 1_700_000_014_300 });
    archiveProjectWithSelection(fixture.db, { projectId: beta.id, now: 1_700_000_014_400 });
    restoreProject(fixture.db, { id: beta.id, now: 1_700_000_014_500 });
    const [betaRoot] = listRoots(fixture.db, { scopeKind: 'prj', scopeId: beta.id });
    removeRoot(fixture.db, { rootId: betaRoot.id, allowEmpty: true, now: 1_700_000_014_600 });

    const integrity = registryIntegrity(fixture.db);
    assert.equal(integrity.quickCheck, 'ok');
    assert.equal(integrity.foreignKeys, 0);
    assert.equal(integrity.audit.ok, true);
    const actions = fixture.db.prepare('SELECT action FROM audit_registry ORDER BY seq').all().map((row) => row.action);
    for (const expected of ['project.update', 'project.archive', 'project.restore', 'root.remove', 'selection.reselect']) {
      assert.ok(actions.includes(expected), `falta la acción ${expected} en la auditoría`);
    }
  } finally { cleanup(fixture); }
});
