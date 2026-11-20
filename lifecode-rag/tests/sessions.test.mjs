import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { listRoots, pathKeyFor } from '../lib/registry.mjs';
import { closeRegistry, createLibrary, createProject, addRoot, openRegistry } from '../lib/registry.mjs';
import { captureSession, assertSessionId } from '../lib/session-identity.mjs';
import {
  MAX_LIBRARIES_PER_PROJECT, effectiveScopes, expireSession, getSession, grantLibrary,
  invalidateSession, listSessions, markOrphans, registerSelection, revokeGrant,
} from '../lib/sessions.mjs';
import { resolveScope } from '../lib/resolve.mjs';
import { profileRoot } from '../lib/profile.mjs';

function workspace() {
  const base = mkdtempSync(join(tmpdir(), 'lcr-pa2-'));
  const env = { DSH_HOME: base };
  const root = profileRoot(env);
  const dirs = join(base, 'docs');
  mkdirSync(dirs, { recursive: true });
  return { base, env, root, dirs };
}

function withRegistry(fn) {
  const ws = workspace();
  const { db } = openRegistry({ root: ws.root, create: true });
  try {
    return fn({ ...ws, db, identity: (id) => captureSession({ id }, { env: ws.env }) });
  } finally {
    closeRegistry(db);
    rmSync(ws.base, { recursive: true, force: true });
  }
}

function selectionFor(db, id, projectId, identity) {
  return registerSelection(db, {
    identity: identity(id),
    expectedProfileKey: identity(id).profileKey,
    projectId,
  });
}

function setup(db, { name = 'Proyecto', root = null } = {}) {
  const project = createProject(db, { name });
  if (root) addRoot(db, { scopeKind: 'prj', scopeId: project.id, path: root });
  return project;
}

/**
 * Inserta una raíz saltándose la protección de PA4. Sirve para simular un registro anterior a PA4
 * (que sí podía contener solapamientos) y comprobar que la resolución sigue fallando en cerrado.
 */
function legacyRoot(db, { scopeKind, scopeId, path, id }) {
  db.prepare(
    `INSERT INTO roots (id, scope_kind, scope_id, path, path_key, state, added_at, added_by)
     VALUES (?, ?, ?, ?, ?, 'authorized', ?, 'human')`,
  ).run(id, scopeKind, scopeId, path, pathKeyFor(path), String(Date.now()));
}

test('identidad: usa agent.id y rechaza identidades ausentes o con caracteres de control', () => {
  const env = { DSH_HOME: 'C:\\temp\\x' };
  const identity = captureSession({ id: 'sesion-1' }, { env });
  assert.equal(identity.sessionId, 'sesion-1');
  assert.equal(identity.profileKey, 'default');
  assert.equal(assertSessionId('a b'), 'a b');
  assert.throws(() => captureSession({}, { env }), { code: 'session-invalid' });
  assert.throws(() => captureSession({ id: '' }, { env }), { code: 'session-invalid' });
  assert.throws(() => captureSession({ id: 'a\u0000b' }, { env }), { code: 'session-invalid' });
});

test('identidad: el nombre visible no se usa; dos nombres iguales con ids distintos no colisionan', () => {
  const env = { DSH_HOME: 'C:\\temp\\x' };
  const a = captureSession({ id: 'id-a', name: 'Charla' }, { env });
  const b = captureSession({ id: 'id-b', name: 'Charla' }, { env });
  assert.notEqual(a.sessionId, b.sessionId);
});

test('selección: crea fila activa con revisión 1 y la audita', () => withRegistry(({ db, identity }) => {
  const project = setup(db);
  const result = selectionFor(db, 's1', project.id, identity);
  assert.equal(result.created, true);
  assert.equal(result.selection.revision, 1);
  assert.equal(result.selection.state, 'active');
  const audit = db.prepare(`SELECT action, outcome, session_id, target FROM audit_registry ORDER BY seq`).all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'session.select');
  assert.equal(audit[0].session_id, 's1');
  assert.equal(audit[0].target, project.id);
}));

test('selección idempotente: repetir la misma no crea revisión ni auditoría', () => withRegistry(({ db, identity }) => {
  const project = setup(db);
  selectionFor(db, 's1', project.id, identity);
  const again = selectionFor(db, 's1', project.id, identity);
  assert.equal(again.changed, false);
  assert.equal(again.selection.revision, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_registry').get().n, 1);
}));

test('selección: cambiar de proyecto sube la revisión; A y B son independientes', () => withRegistry(({ db, identity }) => {
  const a = setup(db, { name: 'A' });
  const b = setup(db, { name: 'B' });
  selectionFor(db, 's1', a.id, identity);
  selectionFor(db, 's2', b.id, identity);
  const changed = selectionFor(db, 's1', b.id, identity);
  assert.equal(changed.selection.revision, 2);
  assert.equal(getSession(db, 's1').project_id, b.id);
  assert.equal(getSession(db, 's2').project_id, b.id);
  assert.equal(getSession(db, 's2').revision, 1);
}));

test('persistencia: la selección sobrevive al cierre y reapertura del registro', () => {
  const ws = workspace();
  const first = openRegistry({ root: ws.root, create: true }).db;
  const project = createProject(first, { name: 'Persistente' });
  const identity = captureSession({ id: 's1' }, { env: ws.env });
  selectionFor(first, 's1', project.id, () => identity);
  closeRegistry(first);

  const second = openRegistry({ root: ws.root }).db;
  try {
    const row = getSession(second, 's1');
    assert.equal(row.project_id, project.id);
    assert.equal(row.state, 'active');
    const resolved = resolveScope(second, { identity, expectedProfileKey: identity.profileKey });
    assert.equal(resolved.source, 'explicit');
    assert.equal(resolved.projectId, project.id);
  } finally {
    closeRegistry(second);
    rmSync(ws.base, { recursive: true, force: true });
  }
});

test('clon: una sesión nueva con clone_of empieza en revisión 1, no hereda la de origen', () => withRegistry(({ db, identity }) => {
  const project = setup(db);
  selectionFor(db, 's1', project.id, identity);
  const clone = captureSession({ id: 's2' }, { env: { DSH_HOME: 'x' } });
  registerSelection(db, {
    identity: clone, expectedProfileKey: clone.profileKey, cloneOf: 's1', projectId: project.id,
  });
  const cloneRow = getSession(db, 's2');
  assert.equal(cloneRow.clone_of, 's1');
  assert.equal(cloneRow.revision, 1);
  assert.equal(getSession(db, 's1').revision, 1);
}));

test('clon: una sesión sin fila resuelve por cwd o falla; nunca hereda', () => withRegistry(({ db, dirs, identity }) => {
  const project = setup(db, { root: dirs });
  const cloneIdentity = captureSession({ id: 's-clon' }, { env: { DSH_HOME: 'x' } });
  assert.equal(getSession(db, 's-clon'), null);
  const resolved = resolveScope(db, {
    identity: cloneIdentity, expectedProfileKey: 'default', cwd: dirs,
  });
  assert.equal(resolved.source, 'cwd');
  assert.equal(resolved.projectId, project.id);
}));

test('terminación: expired no se reactiva y resolver devuelve session-expired', () => withRegistry(({ db, identity }) => {
  const project = setup(db);
  selectionFor(db, 's1', project.id, identity);
  const expired = expireSession(db, { identity: identity('s1'), expectedProfileKey: 'default' });
  assert.equal(expired.changed, true);
  assert.throws(() => selectionFor(db, 's1', project.id, identity), { code: 'session-expired' });
  assert.throws(
    () => resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default' }),
    { code: 'session-expired' },
  );
}));

test('invalidación: motivo válido, rechazo al resolver y al volver a seleccionar', () => withRegistry(({ db, identity }) => {
  const project = setup(db);
  selectionFor(db, 's1', project.id, identity);
  invalidateSession(db, { identity: identity('s1'), expectedProfileKey: 'default', reason: 'admin' });
  assert.throws(
    () => resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default' }),
    (error) => error.code === 'scope-forbidden' && error.details.reason === 'admin',
  );
  assert.throws(() => selectionFor(db, 's1', project.id, identity), { code: 'scope-forbidden' });
  assert.throws(
    () => invalidateSession(db, { identity: identity('s1'), expectedProfileKey: 'default', reason: 'inventado' }),
    { code: 'invalid-argument' },
  );
}));

test('huérfanas: las sesiones activas ausentes de la lista viva se terminan', () => withRegistry(({ db, identity }) => {
  const project = setup(db);
  selectionFor(db, 's1', project.id, identity);
  selectionFor(db, 's2', project.id, identity);
  const result = markOrphans(db, { activeSessionIds: ['s2'] });
  assert.deepEqual(result.orphans, ['s1']);
  assert.equal(getSession(db, 's1').state, 'expired');
  assert.equal(getSession(db, 's2').state, 'active');
  assert.equal(listSessions(db, { state: 'expired' }).length, 1);
}));

test('resolución por cwd: una sola raíz autorizada resuelve sin persistir selección', () => withRegistry(({ db, dirs, identity }) => {
  const project = setup(db, { name: 'Docs', root: dirs });
  const nested = join(dirs, 'sub');
  mkdirSync(nested);
  const resolved = resolveScope(db, { identity: identity('s9'), expectedProfileKey: 'default', cwd: nested });
  assert.equal(resolved.projectId, project.id);
  assert.equal(resolved.source, 'cwd');
  assert.equal(resolved.revision, null);
  assert.equal(getSession(db, 's9'), null);
}));

test('resolución por cwd: fuera de toda raíz es scope-unresolved', () => withRegistry(({ db, base, identity }) => {
  setup(db, { root: join(base, 'docs') });
  assert.throws(
    () => resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default', cwd: join(base, 'otro') }),
    (error) => error.code === 'scope-unresolved',
  );
}));

test('resolución por cwd: con raíces solapadas heredadas gana la raíz más específica', () => withRegistry(({ db, base, identity }) => {
  const outer = join(base, 'docs');
  const inner = join(outer, 'sub');
  mkdirSync(outer, { recursive: true });
  mkdirSync(inner, { recursive: true });
  const a = createProject(db, { name: 'A' });
  const b = createProject(db, { name: 'B' });
  // PA4 rechaza el solapamiento al registrar; un registro heredado de PA1-PA3 sí puede contenerlo.
  // La resolución debe elegir el proyecto cuya raíz es más específica, no el orden de las filas.
  legacyRoot(db, { scopeKind: 'prj', scopeId: a.id, path: outer, id: 'rt_00000000000000000000000001' });
  legacyRoot(db, { scopeKind: 'prj', scopeId: b.id, path: inner, id: 'rt_00000000000000000000000002' });
  const resolved = resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default', cwd: inner });
  assert.equal(resolved.projectId, b.id);
  assert.equal(resolved.source, 'cwd');
  const fromOuter = resolveScope(db, { identity: identity('s2'), expectedProfileKey: 'default', cwd: join(outer, 'otro') });
  assert.equal(fromOuter.projectId, a.id);
}));

test('PA4-D: registrar una raíz que solapa con otra ya autorizada se rechaza al registrar', () => withRegistry(({ db, base }) => {
  const outer = join(base, 'docs');
  const inner = join(outer, 'sub');
  mkdirSync(inner, { recursive: true });
  const a = createProject(db, { name: 'A' });
  const b = createProject(db, { name: 'B' });
  addRoot(db, { scopeKind: 'prj', scopeId: a.id, path: outer });
  assert.throws(
    () => addRoot(db, { scopeKind: 'prj', scopeId: b.id, path: inner }),
    (error) => error.code === 'root-overlap' && error.details.conflictsWith.scopeId === a.id,
  );
  assert.equal(listRoots(db).length, 1, 'el rechazo no deja una raíz a medias');
}));

test('conflicto: selección explícita A + cwd de B es ambigua, no se corrige sola', () => withRegistry(({ db, base, identity }) => {
  const dirA = join(base, 'a');
  const dirB = join(base, 'b');
  mkdirSync(dirA);
  mkdirSync(dirB);
  const a = setup(db, { name: 'A', root: dirA });
  setup(db, { name: 'B', root: dirB });
  selectionFor(db, 's1', a.id, identity);
  assert.throws(
    () => resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default', cwd: dirB }),
    (error) => error.code === 'scope-ambiguous',
  );
  const ok = resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default', cwd: dirA });
  assert.equal(ok.projectId, a.id);
}));

test('proyecto archivado: la selección existente falla en cerrado', () => withRegistry(({ db, identity }) => {
  const project = setup(db);
  selectionFor(db, 's1', project.id, identity);
  db.prepare(`UPDATE projects SET status='archived', archived_at=? WHERE id=?`).run(Date.now(), project.id);
  assert.throws(
    () => resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default' }),
    (error) => error.code === 'scope-forbidden' && error.details.reason === 'project-archived',
  );
}));

test('perfil: una identidad capturada en otro perfil es session-invalid', () => withRegistry(({ db }) => {
  const project = createProject(db, { name: 'P' });
  const foreign = captureSession({ id: 's1' }, { env: { DSH_HOME: 'C:\\otro', DSH_PROFILE: 'trabajo' } });
  assert.throws(
    () => registerSelection(db, { identity: foreign, expectedProfileKey: 'default', projectId: project.id }),
    (error) => error.code === 'session-invalid' && error.details.reason === 'profile-mismatch',
  );
}));

test('grants: biblioteca concedida entra; revocada sale en la siguiente resolución', () => withRegistry(({ db, dirs, base, identity }) => {
  const project = setup(db, { root: dirs });
  const library = createLibrary(db, { name: 'Compartida' });
  // La biblioteca vive FUERA de la raíz del proyecto: PA4 rechaza que dos ámbitos reclamen la misma
  // zona física, así que el fixture ya no puede anidarla dentro.
  const libraryDir = join(base, 'biblioteca');
  mkdirSync(libraryDir);
  addRoot(db, { scopeKind: 'lib', scopeId: library.id, path: libraryDir });
  selectionFor(db, 's1', project.id, identity);
  grantLibrary(db, { projectId: project.id, libraryId: library.id });
  const withLibrary = resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default' });
  assert.equal(withLibrary.scopeCount, 2);
  assert.equal(withLibrary.scopes[1].id, library.id);

  revokeGrant(db, { projectId: project.id, libraryId: library.id });
  const after = resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default' });
  assert.equal(after.scopeCount, 1);
  assert.equal(after.scopes.some((scope) => scope.id === library.id), false);
}));

test('grants: octava biblioteca rechazada con scope-too-many; siete permitidas', () => withRegistry(({ db, dirs, identity }) => {
  const project = setup(db, { root: dirs });
  selectionFor(db, 's1', project.id, identity);
  const libs = [];
  for (let index = 0; index < MAX_LIBRARIES_PER_PROJECT; index += 1) {
    const library = createLibrary(db, { name: `L${index}` });
    grantLibrary(db, { projectId: project.id, libraryId: library.id });
    libs.push(library.id);
  }
  const eight = createLibrary(db, { name: 'L8' });
  assert.throws(
    () => grantLibrary(db, { projectId: project.id, libraryId: eight.id }),
    (error) => error.code === 'scope-too-many' && error.details.limit === 7,
  );
  const scopes = resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default' });
  assert.equal(scopes.scopeCount, 8);
  assert.equal(scopes.scopes[0].kind, 'prj');
}));

test('grants: biblioteca archivada no se concede; el modelo no puede conceder', () => withRegistry(({ db }) => {
  const project = createProject(db, { name: 'P' });
  const library = createLibrary(db, { name: 'L' });
  db.prepare(`UPDATE libraries SET status='archived', archived_at=? WHERE id=?`).run(Date.now(), library.id);
  assert.throws(
    () => grantLibrary(db, { projectId: project.id, libraryId: library.id }),
    (error) => error.code === 'scope-forbidden' && error.details.reason === 'library-archived',
  );
  assert.throws(
    () => grantLibrary(db, { projectId: project.id, libraryId: library.id, grantedBy: 'model' }),
    { code: 'invalid-argument' },
  );
}));

test('concurrencia: dos conexiones seleccionan sesiones distintas sin pisarse', () => {
  const ws = workspace();
  const first = openRegistry({ root: ws.root, create: true }).db;
  const a = createProject(first, { name: 'A' });
  const b = createProject(first, { name: 'B' });
  const second = openRegistry({ root: ws.root }).db;
  try {
    const identityA = captureSession({ id: 's-a' }, { env: ws.env });
    const identityB = captureSession({ id: 's-b' }, { env: ws.env });
    registerSelection(second, { identity: identityA, expectedProfileKey: 'default', projectId: a.id });
    registerSelection(first, { identity: identityB, expectedProfileKey: 'default', projectId: b.id });
    assert.equal(getSession(first, 's-a').project_id, a.id);
    assert.equal(getSession(second, 's-b').project_id, b.id);
    assert.equal(getSession(first, 's-a').revision, 1);
    assert.equal(getSession(second, 's-b').revision, 1);
  } finally {
    closeRegistry(first);
    closeRegistry(second);
    rmSync(ws.base, { recursive: true, force: true });
  }
});

test('auditoría: los rechazos de resolución quedan como denied, sin resultados', () => withRegistry(({ db, base, identity }) => {
  setup(db, { root: join(base, 'docs') });
  assert.throws(
    () => resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default', cwd: join(base, 'fuera') }),
    { code: 'scope-unresolved' },
  );
  const denied = db.prepare(`SELECT action, outcome, session_id, detail FROM audit_registry WHERE outcome='denied'`).all();
  assert.equal(denied.length, 1);
  assert.equal(denied[0].action, 'scope.resolve');
  assert.equal(denied[0].session_id, 's1');
  assert.match(denied[0].detail, /scope-unresolved/);
}));

test('sin selección y sin cwd: scope-unresolved explícito', () => withRegistry(({ db, identity }) => {
  assert.throws(
    () => resolveScope(db, { identity: identity('s1'), expectedProfileKey: 'default' }),
    (error) => error.code === 'scope-unresolved' && error.details.session_id === 's1',
  );
}));

test('effectiveScopes: sin selección falla; con selección devuelve proyecto y grants', () => withRegistry(({ db, dirs, identity }) => {
  const project = setup(db, { root: dirs });
  assert.throws(
    () => effectiveScopes(db, { identity: identity('s1'), expectedProfileKey: 'default' }),
    { code: 'scope-unresolved' },
  );
  selectionFor(db, 's1', project.id, identity);
  const effective = effectiveScopes(db, { identity: identity('s1'), expectedProfileKey: 'default' });
  assert.equal(effective.scopeCount, 1);
  assert.equal(effective.project.id, project.id);
}));
