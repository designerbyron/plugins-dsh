import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  addRoot, appendRegistryAudit, closeRegistry, createLibrary, createProject, listRoots, newId,
  openRegistry, pathKeyFor, registryIntegrity, verifyRegistryAudit,
} from '../lib/registry.mjs';
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
    assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), 1);
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
