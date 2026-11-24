/**
 * UX-2.2 — escalón de resolución por workspace seguido (`D-UX22-02`, `D-UX22-03`, `D-UX22-12`).
 *
 * Reglas que estas pruebas fijan:
 *   - sin filas de seguimiento, la resolución se comporta exactamente como antes;
 *   - un workspace seguido `on` + `ok` resuelve por su proyecto (`source: 'tracking'`);
 *   - `paused` no resuelve y **no** se cae al `cwd` como consuelo;
 *   - seguido != `cwd` es `scope-conflict`, nunca una elección silenciosa;
 *   - dos sesiones con workspaces seguidos distintos quedan aisladas;
 *   - la reconciliación del eje B la hace el Host, sólo escribe `last_status`/`last_seen_at` y se
 *     audita con `actor='host'`.
 *
 * Perfiles temporales (`mkdtemp`); ninguna prueba toca `~/.dsh`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeRegistry, openRegistry, pathKeyFor } from '../lib/registry.mjs';
import { registerDiscoveredProject } from '../lib/discovery.mjs';
import { resolveScope } from '../lib/resolve.mjs';
import { applyTracking, readTracking, reconcileTracking } from '../lib/tracking-store.mjs';
import { registerSelection } from '../lib/sessions.mjs';

function tempProfile() {
  const base = mkdtempSync(join(tmpdir(), 'lcr-tracking-resolve-'));
  const profile = { base };
  const opened = openRegistry({ root: join(base, 'perfil'), create: true });
  closeRegistry(opened.db);
  return profile;
}

function withRegistry(profile, work) {
  const opened = openRegistry({ root: join(profile.base, 'perfil'), create: false });
  try {
    return work(opened.db);
  } finally {
    closeRegistry(opened.db);
  }
}

function project(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.git'), '', 'utf8');
  return dir;
}

function workspace(id, path, sessionIds, status = 'ok') {
  return {
    id, path, title: path, sessionIds, status: () => Promise.resolve(status),
  };
}

const IDENTITY = { sessionId: 'ses-tracking-1', profileKey: 'default' };
const PROFILE_KEY = 'default';

function track(db, { path, projectId, state = 'on', workspaceId = 'ws-x', now = 10 }) {
  return applyTracking(db, {
    pathKey: pathKeyFor(path),
    path,
    workspaceId,
    state,
    projectId,
    expectedRevision: 0,
    now,
    actor: 'human',
  });
}

test('sin seguimiento, el cwd sigue resolviendo igual que antes', () => {
  const profile = tempProfile();
  try {
    const raiz = join(profile.base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    withRegistry(profile, (db) => registerDiscoveredProject(db, {
      path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
    }));
    const resolved = withRegistry(profile, (db) => resolveScope(db, {
      identity: IDENTITY,
      expectedProfileKey: PROFILE_KEY,
      cwd: a,
      openProjects: [workspace('ws-a', a, [IDENTITY.sessionId])],
      now: 2,
    }));
    assert.equal(resolved.source, 'cwd');
    assert.equal(resolved.scopes[0].roots[0], a);
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('el workspace seguido de ESTA sesión resuelve por su proyecto', () => {
  const profile = tempProfile();
  try {
    const raiz = join(profile.base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    const fuera = join(profile.base, 'sin-rama');
    mkdirSync(fuera, { recursive: true });
    const projectId = withRegistry(profile, (db) => {
      const id = registerDiscoveredProject(db, {
        path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
      }).projectId;
      track(db, { path: a, projectId: id, workspaceId: 'ws-a' });
      return id;
    });
    // El `cwd` está fuera de toda raíz: sólo el seguimiento puede resolver.
    const resolved = withRegistry(profile, (db) => resolveScope(db, {
      identity: IDENTITY,
      expectedProfileKey: PROFILE_KEY,
      cwd: fuera,
      openProjects: [workspace('ws-a', a, [IDENTITY.sessionId])],
      now: 2,
    }));
    assert.equal(resolved.source, 'tracking');
    assert.equal(resolved.projectId, projectId);
    // La reconciliación del Host dejó el eje B medido y el eje A intacto.
    const row = withRegistry(profile, (db) => readTracking(db, { pathKey: pathKeyFor(a) }));
    assert.equal(row.lastStatus, 'ok');
    assert.equal(row.state, 'on');
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('un workspace pausado NO resuelve y no se cae al cwd', () => {
  const profile = tempProfile();
  try {
    const raiz = join(profile.base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    withRegistry(profile, (db) => {
      const id = registerDiscoveredProject(db, {
        path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
      }).projectId;
      track(db, { path: a, projectId: id, state: 'paused' });
    });
    assert.throws(() => withRegistry(profile, (db) => resolveScope(db, {
      identity: IDENTITY,
      expectedProfileKey: PROFILE_KEY,
      cwd: a, // el cwd SÍ resolvería, pero el escalón 2 aplica y no deja caer
      openProjects: [workspace('ws-a', a, [IDENTITY.sessionId])],
      now: 2,
    })), (error) => {
      assert.equal(error.code, 'scope-unresolved');
      assert.equal(error.details.reason, 'tracking-not-resolving');
      assert.equal(error.details.tracking.state, 'paused');
      return true;
    });
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('seguido y cwd en proyectos distintos es scope-conflict, con las dos partes en details', () => {
  const profile = tempProfile();
  try {
    const raiz = join(profile.base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    const b = project(join(raiz, 'proyecto-b'));
    withRegistry(profile, (db) => {
      const idA = registerDiscoveredProject(db, {
        path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
      }).projectId;
      registerDiscoveredProject(db, {
        path: b, name: 'proyecto-b', type: 'git', source: 'test', now: 1,
      });
      track(db, { path: a, projectId: idA });
    });
    assert.throws(() => withRegistry(profile, (db) => resolveScope(db, {
      identity: IDENTITY,
      expectedProfileKey: PROFILE_KEY,
      cwd: b,
      openProjects: [workspace('ws-a', a, [IDENTITY.sessionId]), workspace('ws-b', b, [])],
      now: 2,
    })), (error) => {
      assert.equal(error.code, 'scope-conflict');
      assert.equal(error.details.workspace_project_id !== error.details.cwd_project_id, true);
      assert.equal(error.details.cwd, b);
      assert.equal(error.details.workspace_path, a);
      return true;
    });
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('dos sesiones con workspaces seguidos distintos quedan aisladas', () => {
  const profile = tempProfile();
  try {
    const raiz = join(profile.base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    const b = project(join(raiz, 'proyecto-b'));
    const fuera = join(profile.base, 'sin-rama');
    mkdirSync(fuera, { recursive: true });
    const ids = withRegistry(profile, (db) => {
      const idA = registerDiscoveredProject(db, {
        path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
      }).projectId;
      const idB = registerDiscoveredProject(db, {
        path: b, name: 'proyecto-b', type: 'git', source: 'test', now: 1,
      }).projectId;
      track(db, { path: a, projectId: idA, workspaceId: 'ws-a' });
      track(db, { path: b, projectId: idB, workspaceId: 'ws-b', now: 11 });
      return { idA, idB };
    });
    const openProjects = [
      workspace('ws-a', a, ['ses-tracking-1']),
      workspace('ws-b', b, ['ses-tracking-2']),
    ];
    const uno = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'ses-tracking-1', profileKey: PROFILE_KEY },
      expectedProfileKey: PROFILE_KEY,
      cwd: fuera,
      openProjects,
      now: 3,
    }));
    const dos = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'ses-tracking-2', profileKey: PROFILE_KEY },
      expectedProfileKey: PROFILE_KEY,
      cwd: fuera,
      openProjects,
      now: 4,
    }));
    assert.equal(uno.projectId, ids.idA);
    assert.equal(dos.projectId, ids.idB);
    assert.notEqual(uno.projectId, dos.projectId);
    assert.equal(uno.source, 'tracking');
    assert.equal(dos.source, 'tracking');
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('un workspace seguido sin proyecto se conserva pero NO resuelve (D-UX22-04)', () => {
  const profile = tempProfile();
  try {
    const raiz = join(profile.base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    withRegistry(profile, (db) => {
      registerDiscoveredProject(db, {
        path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
      });
      track(db, { path: a, projectId: null });
    });
    assert.throws(() => withRegistry(profile, (db) => resolveScope(db, {
      identity: IDENTITY,
      expectedProfileKey: PROFILE_KEY,
      cwd: a, // el cwd resolvería, pero el escalón 2 aplica y no cae al consuelo silencioso
      openProjects: [workspace('ws-a', a, [IDENTITY.sessionId])],
      now: 2,
    })), (error) => {
      assert.equal(error.code, 'scope-unresolved');
      assert.equal(error.details.reason, 'tracking-not-resolving');
      assert.equal(error.details.tracking.project_id, null);
      assert.equal(error.details.tracking.association, 'pending');
      return true;
    });
    // La fila sigue ahí: seguido y utilizable son cosas distintas.
    const row = withRegistry(profile, (db) => readTracking(db, { pathKey: pathKeyFor(a) }));
    assert.equal(row.state, 'on');
    assert.equal(row.projectId, null);
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('la reconciliación es del Host: escribe sólo el eje B y se audita con actor host', () => {
  const profile = tempProfile();
  try {
    const raiz = join(profile.base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    const b = project(join(raiz, 'proyecto-b'));
    const key = pathKeyFor(a);
    withRegistry(profile, (db) => {
      const idA = registerDiscoveredProject(db, {
        path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
      }).projectId;
      registerDiscoveredProject(db, {
        path: b, name: 'proyecto-b', type: 'git', source: 'test', now: 1,
      });
      track(db, { path: a, projectId: idA });
      // El Host lista otro workspace: el seguido deja de estar presente sin que nadie lo apague.
      reconcileTracking(db, {
        present: [{ pathKey: pathKeyFor(b), path: b }], absent: [key], unknown: [], measuredAt: 5,
      });
      const row = readTracking(db, { pathKey: key });
      assert.equal(row.lastStatus, 'missing', 'missing es un hecho técnico');
      assert.equal(row.state, 'on', 'missing != off: la preferencia humana sigue intacta');
      const audit = db.prepare("SELECT actor, action FROM audit_registry WHERE action = 'tracking.reconcile'").all();
      assert.equal(audit.length, 1, 'una entrada por llamada');
      assert.equal(audit[0].actor, 'host', 'la reconciliación nunca se atribuye a la persona');
      const human = db.prepare("SELECT COUNT(*) AS n FROM audit_registry WHERE action = 'tracking.reconcile' AND actor = 'human'").get();
      assert.equal(human.n, 0);
    });
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test("F1: un workspace 'off' no es seguido y no bloquea la resolución por cwd", () => {
  const profile = tempProfile();
  try {
    const raiz = join(profile.base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    withRegistry(profile, (db) => {
      const id = registerDiscoveredProject(db, {
        path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
      }).projectId;
      track(db, { path: a, projectId: id, state: 'off' });
    });
    const resolved = withRegistry(profile, (db) => resolveScope(db, {
      identity: IDENTITY,
      expectedProfileKey: PROFILE_KEY,
      cwd: a,
      openProjects: [workspace('ws-a', a, [IDENTITY.sessionId])],
      now: 2,
    }));
    // `off` es «no seguido»: el escalón 2 no aplica y resuelve el cwd, como antes de UX-2.2.
    assert.equal(resolved.source, 'cwd');
    assert.equal(resolved.scopes[0].roots[0], a);
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('F3: si la sesión está en dos workspaces seguidos con proyectos distintos, no se elige uno', () => {
  const profile = tempProfile();
  try {
    const raiz = join(profile.base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    const b = project(join(raiz, 'proyecto-b'));
    const fuera = join(profile.base, 'sin-rama');
    mkdirSync(fuera, { recursive: true });
    withRegistry(profile, (db) => {
      const idA = registerDiscoveredProject(db, {
        path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
      }).projectId;
      const idB = registerDiscoveredProject(db, {
        path: b, name: 'proyecto-b', type: 'git', source: 'test', now: 1,
      }).projectId;
      track(db, { path: a, projectId: idA, workspaceId: 'ws-a' });
      track(db, { path: b, projectId: idB, workspaceId: 'ws-b', now: 11 });
    });
    assert.throws(() => withRegistry(profile, (db) => resolveScope(db, {
      identity: IDENTITY,
      expectedProfileKey: PROFILE_KEY,
      cwd: fuera,
      // El Host lista la MISMA sesión en los dos workspaces.
      openProjects: [
        workspace('ws-a', a, [IDENTITY.sessionId]),
        workspace('ws-b', b, [IDENTITY.sessionId]),
      ],
      now: 2,
    })), (error) => {
      assert.equal(error.code, 'scope-conflict');
      assert.equal(error.details.workspaces.length, 2);
      return true;
    });
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('F5: la selección explícita prevalece y la discrepancia con el seguimiento queda auditada', () => {
  const profile = tempProfile();
  try {
    const raiz = join(profile.base, 'htdocs');
    const a = project(join(raiz, 'proyecto-a'));
    const b = project(join(raiz, 'proyecto-b'));
    withRegistry(profile, (db) => {
      const idA = registerDiscoveredProject(db, {
        path: a, name: 'proyecto-a', type: 'git', source: 'test', now: 1,
      }).projectId;
      const idB = registerDiscoveredProject(db, {
        path: b, name: 'proyecto-b', type: 'git', source: 'test', now: 1,
      }).projectId;
      track(db, { path: a, projectId: idA }); // seguido A
      // Selección explícita de B para esta sesión, por la API real del registro.
      registerSelection(db, {
        identity: IDENTITY, expectedProfileKey: PROFILE_KEY, projectId: idB,
        selectedBy: 'human', source: 'explicit', now: 2,
      });
    });
    const resolved = withRegistry(profile, (db) => resolveScope(db, {
      identity: IDENTITY,
      expectedProfileKey: PROFILE_KEY,
      cwd: b,
      openProjects: [workspace('ws-a', a, [IDENTITY.sessionId])],
      now: 2,
    }));
    assert.equal(resolved.source, 'explicit');
    withRegistry(profile, (db) => {
      const row = db.prepare(`SELECT detail FROM audit_registry WHERE action = 'scope.resolve'
        ORDER BY seq DESC LIMIT 1`).get();
      const detail = JSON.parse(row.detail);
      assert.equal(detail.source, 'explicit');
      assert.equal(detail.discrepancy, true, 'la discrepancia queda registrada, no oculta');
      assert.equal(typeof detail.tracking.project_id, 'string');
    });
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});
