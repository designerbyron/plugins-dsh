/**
 * Harness Open Projects: proyectos abiertos en DeepSeek Harness como contexto de resolución.
 *
 * Regla que estas pruebas fijan:
 *   - abrir un proyecto en Harness lo convierte en el candidato de la sesión aunque el `cwd`
 *     apunte a la carpeta contenedora;
 *   - abrir NO autoriza: sin `trusted root` explícito se rechaza con el comando exacto;
 *   - los proyectos hermanos de la carpeta contenedora nunca se registran por el hecho de
 *     estar al lado del proyecto abierto.
 *
 * Perfiles temporales (`mkdtemp`); ninguna prueba toca `~/.dsh`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeRegistry, listRoots, openRegistry } from '../lib/registry.mjs';
import { projectIdFor, registerDiscoveredProject } from '../lib/discovery.mjs';
import { listOpenProjects, openProjectForCwd, openProjectForSession } from '../lib/harness-workspaces.mjs';
import { resolveScope } from '../lib/resolve.mjs';
import { addTrustedRoot } from '../lib/trusted-roots.mjs';

function tempProfile() {
  const base = mkdtempSync(join(tmpdir(), 'lcr-harness-'));
  const profile = { base, root: join(base, 'perfil') };
  const opened = openRegistry({ root: profile.root, create: true });
  closeRegistry(opened.db);
  return profile;
}

function withRegistry(profile, work) {
  const opened = openRegistry({ root: profile.root, create: false });
  try {
    return work(opened.db);
  } finally {
    closeRegistry(opened.db);
  }
}

/**
 * Registro explícito (ACP-07 D-02): resolver ya no crea proyectos. Las pruebas que examinan la
 * resolución registran antes el proyecto que finge estar abierto en Harness.
 */
function registerProject(db, path, name, now = 1) {
  return registerDiscoveredProject(db, { path, name, type: 'git', source: 'test', now }).projectId;
}

function project(dir, indicator = '.git') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, indicator), '', 'utf8');
  return dir;
}

function workspace(id, path, sessionIds, { title = path, status = 'ok' } = {}) {
  return {
    id,
    path,
    title,
    sessionIds,
    status: () => Promise.resolve(status),
  };
}

test('el proyecto abierto en Harness se resuelve aunque el cwd sea la carpeta contenedora', async () => {
  const profile = tempProfile();
  try {
    const htdocs = join(profile.base, 'htdocs');
    const abierto = project(join(htdocs, 'plugins-dhs'));
    const hermano = project(join(htdocs, 'businesssuite'));
    withRegistry(profile, (db) => {
      addTrustedRoot(db, { path: abierto, readAuthorization: true, now: 1 });
      registerProject(db, abierto, 'plugins-dhs');
    });

    const openProjects = [{
      id: 'ws_1', path: abierto, pathKey: abierto.toLowerCase(), title: 'plugins-dhs', sessionIds: ['ses-h'],
    }];
    const resolved = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'ses-h', profileKey: 'default' },
      expectedProfileKey: 'default',
      cwd: htdocs,
      openProjects,
      now: 2,
    }));

    assert.equal(resolved.source, 'cwd');
    assert.equal(resolved.scopes[0].roots[0], abierto);
    const roots = withRegistry(profile, (db) => listRoots(db, 'prj', resolved.projectId));
    assert.deepEqual(roots.map((row) => row.path), [abierto], 'sólo se registra la raíz del proyecto abierto');
    assert.ok(!roots.some((row) => row.path === hermano), 'el hermano no se registra solo');
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('un proyecto abierto sin trust se rechaza con el comando exacto y no se registra', () => {
  const profile = tempProfile();
  try {
    const abierto = project(join(profile.base, 'htdocs', 'plugins-dhs'));
    assert.throws(() => withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'ses-h', profileKey: 'default' },
      expectedProfileKey: 'default',
      cwd: join(profile.base, 'htdocs'),
      openProjects: [{
        id: 'ws_1', path: abierto, pathKey: abierto.toLowerCase(), title: 'plugins-dhs', sessionIds: ['ses-h'],
      }],
      now: 2,
    })), (error) => {
      assert.equal(error.code, 'scope-unresolved');
      assert.equal(error.details.reason, 'project-not-authorized');
      assert.match(error.details.command, /trust add --path/);
      return true;
    });
    const roots = withRegistry(profile, (db) => db.prepare('SELECT COUNT(*) AS n FROM roots').get().n);
    assert.equal(roots, 0, 'un rechazo no registra raíces');
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('dos sesiones abren proyectos distintos y cada una resuelve el suyo', () => {
  const profile = tempProfile();
  try {
    const uno = project(join(profile.base, 'htdocs', 'uno'));
    const dos = project(join(profile.base, 'htdocs', 'dos'));
    withRegistry(profile, (db) => {
      addTrustedRoot(db, { path: uno, readAuthorization: true, now: 1 });
      addTrustedRoot(db, { path: dos, readAuthorization: true, now: 1 });
      registerProject(db, uno, 'uno');
      registerProject(db, dos, 'dos');
    });
    const openProjects = [
      { id: 'ws_1', path: uno, pathKey: uno.toLowerCase(), title: 'uno', sessionIds: ['ses-1'] },
      { id: 'ws_2', path: dos, pathKey: dos.toLowerCase(), title: 'dos', sessionIds: ['ses-2'] },
    ];
    const first = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'ses-1', profileKey: 'default' },
      expectedProfileKey: 'default', cwd: join(profile.base, 'htdocs'), openProjects, now: 2,
    }));
    const second = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'ses-2', profileKey: 'default' },
      expectedProfileKey: 'default', cwd: join(profile.base, 'htdocs'), openProjects, now: 3,
    }));
    assert.equal(first.scopes[0].roots[0], uno);
    assert.equal(second.scopes[0].roots[0], dos);
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('el cwd de un proyecto abierto gana al contenedor aunque ambos estén confiados', () => {
  const profile = tempProfile();
  try {
    const htdocs = join(profile.base, 'htdocs');
    const abierto = project(join(htdocs, 'plugins-dhs'));
    withRegistry(profile, (db) => {
      addTrustedRoot(db, { path: htdocs, readAuthorization: true, now: 1 });
      addTrustedRoot(db, { path: abierto, readAuthorization: true, now: 1 });
      registerProject(db, abierto, 'plugins-dhs');
    });
    const resolved = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'ses-h', profileKey: 'default' },
      expectedProfileKey: 'default',
      cwd: join(abierto, 'lifecode-rag'),
      openProjects: [{
        id: 'ws_1', path: abierto, pathKey: abierto.toLowerCase(), title: 'plugins-dhs', sessionIds: ['ses-h'],
      }],
      now: 2,
    }));
    assert.equal(resolved.scopes[0].roots[0], abierto, 'el ámbito es la raíz del proyecto abierto');
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('listOpenProjects omite workspaces cuyo directorio ya no existe', async () => {
  const projects = await listOpenProjects({
    list: () => [
      workspace('ws_ok', 'C:/workspace/plugins-dhs', ['s1']),
      workspace('ws_missing', 'C:/workspace/borrado', ['s2'], { status: 'missing-dir' }),
    ],
  });
  assert.deepEqual(projects.map((entry) => entry.id), ['ws_ok']);
  assert.equal(projects[0].sessionIds[0], 's1');
});

test('las ayudas de workspace eligen el proyecto abierto correcto', () => {
  const projects = [
    { id: 'a', path: 'C:/htdocs', pathKey: 'c:/htdocs', title: 'htdocs', sessionIds: [] },
    { id: 'b', path: 'C:/htdocs/plugins-dhs', pathKey: 'c:/htdocs/plugins-dhs', title: 'plugins', sessionIds: ['s1'] },
  ];
  assert.equal(openProjectForCwd(projects, 'c:/htdocs/plugins-dhs/lib').id, 'b');
  assert.equal(openProjectForCwd(projects, 'c:/htdocs/otro').id, 'a');
  assert.equal(openProjectForSession(projects, 's1').id, 'b');
  assert.equal(openProjectForSession(projects, 's2'), null);
});

test('un proyecto abierto no crea almacén de ámbito al resolver', () => {
  const profile = tempProfile();
  try {
    const abierto = project(join(profile.base, 'htdocs', 'plugins-dhs'));
    withRegistry(profile, (db) => {
      addTrustedRoot(db, { path: abierto, readAuthorization: true, now: 1 });
      registerProject(db, abierto, 'plugins-dhs');
    });
    withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'ses-h', profileKey: 'default' },
      expectedProfileKey: 'default', cwd: join(profile.base, 'htdocs'),
      openProjects: [{
        id: 'ws_1', path: abierto, pathKey: abierto.toLowerCase(), title: 'plugins-dhs', sessionIds: ['ses-h'],
      }],
      now: 2,
    }));
    assert.equal(projectIdFor(abierto.toLowerCase()), projectIdFor(abierto.toLowerCase()));
    const stores = withRegistry(profile, (db) => db.prepare('SELECT COUNT(*) AS n FROM roots WHERE path LIKE ?').get(`%${abierto.split(/[\\/]/).pop()}%`).n);
    assert.equal(stores, 1);
    // La creación del almacén es responsabilidad de la herramienta que escribe, nunca de resolver.
    assert.equal(withRegistry(profile, (db) => db.prepare('SELECT COUNT(*) AS n FROM projects').get().n), 1);
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('un proyecto abierto sin registrar pide el registro explícito y no escribe nada (ACP-07 D-02)', () => {
  const profile = tempProfile();
  try {
    const abierto = project(join(profile.base, 'htdocs', 'plugins-dhs'));
    withRegistry(profile, (db) => addTrustedRoot(db, { path: abierto, readAuthorization: true, now: 1 }));
    assert.throws(() => withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'ses-h', profileKey: 'default' },
      expectedProfileKey: 'default',
      cwd: join(profile.base, 'htdocs'),
      openProjects: [{
        id: 'ws_1', path: abierto, pathKey: abierto.toLowerCase(), title: 'plugins-dhs', sessionIds: ['ses-h'],
      }],
      now: 2,
    })), (error) => {
      assert.equal(error.code, 'scope-unresolved');
      assert.equal(error.details.reason, 'project-not-registered');
      assert.equal(error.details.action, 'register-project');
      assert.match(error.details.command, /discover register --path/);
      assert.equal(error.details.project.path, abierto);
      return true;
    });
    const counts = withRegistry(profile, (db) => ({
      projects: db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,
      roots: db.prepare('SELECT COUNT(*) AS n FROM roots').get().n,
    }));
    assert.deepEqual({ ...counts }, { projects: 0, roots: 0 }, 'resolver no escribe en el registro');
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});
