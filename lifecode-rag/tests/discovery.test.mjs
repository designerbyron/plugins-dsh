/**
 * Auto-discovery 01: descubrimiento, registro idempotente, resolución por cwd y límites.
 *
 * Todas las pruebas usan perfiles temporales (`LIFECODE_RAG_ROOT`); ninguna toca `~/.dsh`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  closeRegistry, createProject, addRoot, getProject, listRoots, openRegistry,
} from '../lib/registry.mjs';
import { addTrustedRoot, listTrustedRoots, removeTrustedRoot } from '../lib/trusted-roots.mjs';
import {
  describeProject, findProjectBoundary, isIgnoredDirectory, isSecretFileName,
  registerDiscoveredProject, scanWorkspace,
} from '../lib/discovery.mjs';
import { resolveScope } from '../lib/resolve.mjs';
import { registerSelection } from '../lib/sessions.mjs';
import { createToolDefinitions } from '../lib/tools.mjs';
import { scopeStoreExists } from '../lib/scope-stores.mjs';
import { fakeExec, makeWorld, servicesFor } from './pa3-helpers.mjs';

function tempProfile() {
  const base = mkdtempSync(join(tmpdir(), 'lcr-discovery-'));
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

function touch(dir, ...names) {
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const target = join(dir, name);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, '', 'utf8');
  }
  return dir;
}

function json(dir, name, value) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(value), 'utf8');
  return dir;
}

test('descubre Git, Laravel, Node/Vue/Nuxt, .NET y Python por sus indicadores', () => {
  const base = mkdtempSync(join(tmpdir(), 'lcr-scan-'));
  touch(join(base, 'repo-git'), '.git');
  touch(join(base, 'laravel'), 'artisan', 'composer.json');
  json(join(base, 'node'), 'package.json', { name: 'servicio-node', dependencies: { express: '1' } });
  json(join(base, 'vue'), 'package.json', { name: 'panel-vue', dependencies: { vue: '3' } });
  json(join(base, 'nuxt'), 'package.json', { name: 'sitio-nuxt', dependencies: { nuxt: '3' } });
  touch(join(base, 'dotnet'), 'App.sln');
  touch(join(base, 'python'), 'pyproject.toml');
  const scan = scanWorkspace(base);
  const byDir = new Map(scan.projects.map((project) => [project.path.split(/[\\/]/).pop(), project]));
  assert.equal(byDir.get('repo-git')?.type, 'git');
  assert.equal(byDir.get('laravel')?.type, 'laravel');
  assert.equal(byDir.get('node')?.type, 'node');
  assert.equal(byDir.get('node')?.name, 'node', 'el nombre visible es el del directorio, no el scope npm');
  assert.equal(byDir.get('node')?.manifestName, 'servicio-node');
  assert.equal(byDir.get('vue')?.type, 'vue');
  assert.equal(byDir.get('nuxt')?.type, 'nuxt');
  assert.equal(byDir.get('dotnet')?.type, 'dotnet');
  assert.equal(byDir.get('python')?.type, 'python');
  rmSync(base, { recursive: true, force: true });
});

test('no desciende a node_modules ni descubre secretos', () => {
  const base = mkdtempSync(join(tmpdir(), 'lcr-scan-'));
  json(join(base, 'dependencias', 'node_modules', 'paquete'), 'package.json', { name: 'interno' });
  touch(join(base, 'con-secretos'), '.env', 'package.json');
  const scan = scanWorkspace(base);
  assert.equal(scan.projects.some((project) => project.path.includes('node_modules')), false);
  assert.equal(isIgnoredDirectory('NODE_MODULES'), true);
  assert.equal(isSecretFileName('.env'), true);
  assert.equal(isSecretFileName('id_ed25519'), true);
  assert.equal(isSecretFileName('package.json'), false);
  rmSync(base, { recursive: true, force: true });
});

test('el registro es idempotente y no duplica raíces ni proyectos', () => {
  const profile = tempProfile();
  try {
    const projectDir = touch(join(profile.base, 'proyecto'), '.git');
    const first = withRegistry(profile, (db) => registerDiscoveredProject(db, {
      path: projectDir, name: 'proyecto', type: 'git', source: 'test', now: 1000,
    }));
    assert.equal(first.created, true);
    assert.equal(first.registeredRoot, true);
    const second = withRegistry(profile, (db) => registerDiscoveredProject(db, {
      path: projectDir, name: 'proyecto', type: 'git', source: 'test', now: 2000,
    }));
    assert.equal(second.created, false);
    assert.equal(second.projectId, first.projectId);
    withRegistry(profile, (db) => {
      assert.equal(listRoots(db).length, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
      const meta = describeProject(db, first.projectId);
      assert.equal(meta.type, 'git');
      assert.equal(meta.lastSeenAt, 2000);
      assert.equal(meta.discoveredAt, 1000);
    });
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('reconoce un proyecto ya registrado y conserva su identidad y su almacén', () => {
  const profile = tempProfile();
  try {
    const projectDir = touch(join(profile.base, 'existente'), '.git');
    const existing = withRegistry(profile, (db) => {
      const project = createProject(db, { name: 'Existente', now: 10 });
      addRoot(db, { scopeKind: 'prj', scopeId: project.id, path: projectDir, addedBy: 'human', now: 10 });
      return project;
    });
    const result = withRegistry(profile, (db) => registerDiscoveredProject(db, {
      path: projectDir, type: 'git', source: 'test', now: 20,
    }));
    assert.equal(result.created, false);
    assert.equal(result.projectId, existing.id);
    withRegistry(profile, (db) => {
      assert.equal(getProject(db, existing.id).name, 'Existente');
      assert.equal(listRoots(db).length, 1);
    });
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('descubrir y registrar no crea el almacén del proyecto', () => {
  const profile = tempProfile();
  try {
    const projectDir = json(join(profile.base, 'sin-indice'), 'package.json', { name: 'sin-indice' });
    const result = withRegistry(profile, (db) => registerDiscoveredProject(db, {
      path: projectDir, type: 'node', source: 'test', now: 1,
    }));
    assert.equal(scopeStoreExists(profile.root, result.projectId), false);
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('resuelve por cwd registrando el proyecto del workspace confiable', () => {
  const profile = tempProfile();
  try {
    const workspace = touch(join(profile.base, 'htdocs', 'repositorio'), '.git');
    withRegistry(profile, (db) => {
      addTrustedRoot(db, { path: join(profile.base, 'htdocs'), readAuthorization: true, now: 1 });
    });
    const resolved = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'sesion-nueva', profileKey: 'default' },
      expectedProfileKey: 'default',
      cwd: join(workspace, 'src'),
      now: 2,
    }));
    assert.equal(resolved.source, 'cwd');
    assert.equal(resolved.scopes[0].roots[0], workspace);
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('con raíces anidadas gana la más específica', () => {
  const profile = tempProfile();
  try {
    const outer = touch(join(profile.base, 'monorepo'), '.git');
    const inner = json(join(outer, 'paquete-interno'), 'package.json', { name: 'interno' });
    withRegistry(profile, (db) => {
      addTrustedRoot(db, { path: profile.base, readAuthorization: true, now: 1 });
    });
    const fromInner = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'sesion-1', profileKey: 'default' },
      expectedProfileKey: 'default', cwd: join(inner, 'src'), now: 2,
    }));
    const fromOuter = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'sesion-2', profileKey: 'default' },
      expectedProfileKey: 'default', cwd: join(outer, 'docs'), now: 3,
    }));
    const fromInnerAgain = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'sesion-3', profileKey: 'default' },
      expectedProfileKey: 'default', cwd: join(inner, 'src'), now: 4,
    }));
    assert.equal(fromInner.scopes[0].roots[0], inner);
    assert.equal(fromOuter.scopes[0].roots[0], outer);
    assert.equal(fromInnerAgain.scopes[0].roots[0], inner);
    assert.notEqual(fromInner.projectId, fromOuter.projectId);
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('fuera del workspace confiable no hay descubrimiento ni búsqueda global', () => {
  const profile = tempProfile();
  try {
    touch(join(profile.base, 'confiable', 'proyecto'), '.git');
    touch(join(profile.base, 'ajeno', 'otro'), '.git');
    withRegistry(profile, (db) => {
      addTrustedRoot(db, { path: join(profile.base, 'confiable'), readAuthorization: true, now: 1 });
    });
    assert.throws(() => withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'sesion-fuera', profileKey: 'default' },
      expectedProfileKey: 'default', cwd: join(profile.base, 'ajeno', 'otro'), now: 2,
    })), (error) => error.code === 'scope-unresolved');
    withRegistry(profile, (db) => {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM projects WHERE name = 'otro'").get().n, 0);
    });
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('sin autorización de lectura no se registra nada', () => {
  const profile = tempProfile();
  try {
    const project = touch(join(profile.base, 'solo-descubierto'), '.git');
    withRegistry(profile, (db) => {
      addTrustedRoot(db, { path: profile.base, readAuthorization: false, now: 1 });
    });
    assert.throws(() => withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'sesion-x', profileKey: 'default' },
      expectedProfileKey: 'default', cwd: project, now: 2,
    })), (error) => error.code === 'scope-unresolved');
    withRegistry(profile, (db) => assert.equal(listRoots(db).length, 0));
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('un enlace dentro del workspace no amplía el ámbito', () => {
  const base = mkdtempSync(join(tmpdir(), 'lcr-link-'));
  try {
    const outside = json(join(base, 'fuera'), 'package.json', { name: 'fuera' });
    const workspace = join(base, 'workspace');
    mkdirSync(workspace, { recursive: true });
    let linked = true;
    try {
      symlinkSync(outside, join(workspace, 'atajo'), 'junction');
    } catch {
      linked = false;
    }
    const scan = scanWorkspace(workspace);
    assert.equal(scan.projects.length, 0);
    if (linked) {
      assert.equal(scan.skipped.some((row) => row.reason === 'symlink'), true);
      assert.equal(findProjectBoundary(join(workspace, 'atajo'), { withinPath: workspace }), null);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('la selección explícita prevalece sobre la resolución automática', () => {
  const profile = tempProfile();
  try {
    const preferred = touch(join(profile.base, 'preferido'), '.git');
    touch(join(profile.base, 'otro'), '.git');
    const projectId = withRegistry(profile, (db) => {
      addTrustedRoot(db, { path: profile.base, readAuthorization: true, now: 1 });
      const registered = registerDiscoveredProject(db, {
        path: preferred, name: 'preferido', type: 'git', source: 'test', now: 1,
      });
      return registered.projectId;
    });
    withRegistry(profile, (db) => {
      registerSelection(db, {
        identity: { sessionId: 'sesion-eligio', profileKey: 'default' },
        expectedProfileKey: 'default',
        projectId,
        selectedBy: 'human',
        source: 'explicit',
        now: 5,
      });
    });
    const resolved = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 'sesion-eligio', profileKey: 'default' },
      expectedProfileKey: 'default', cwd: preferred, now: 6,
    }));
    assert.equal(resolved.source, 'explicit');
    assert.equal(resolved.projectId, projectId);
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('sesiones distintas resuelven proyectos distintos y no comparten ámbitos', () => {
  const profile = tempProfile();
  try {
    const a = touch(join(profile.base, 'a'), '.git');
    const b = json(join(profile.base, 'b'), 'package.json', { name: 'b' });
    withRegistry(profile, (db) => addTrustedRoot(db, { path: profile.base, readAuthorization: true, now: 1 }));
    const one = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 's-a', profileKey: 'default' },
      expectedProfileKey: 'default', cwd: a, now: 2,
    }));
    const two = withRegistry(profile, (db) => resolveScope(db, {
      identity: { sessionId: 's-b', profileKey: 'default' },
      expectedProfileKey: 'default', cwd: b, now: 3,
    }));
    assert.notEqual(one.projectId, two.projectId);
    assert.equal(one.scopes.length, 1);
    assert.equal(two.scopes.length, 1);
    assert.notEqual(one.scopes[0].id, two.scopes[0].id);
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('la confianza y los proyectos registrados sobreviven a reabrir el registro', () => {
  const profile = tempProfile();
  try {
    const project = touch(join(profile.base, 'persistente'), '.git');
    withRegistry(profile, (db) => {
      addTrustedRoot(db, { path: profile.base, readAuthorization: true, now: 1 });
      registerDiscoveredProject(db, { path: project, type: 'git', source: 'test', now: 1 });
    });
    withRegistry(profile, (db) => {
      assert.equal(listTrustedRoots(db).length, 1);
      assert.equal(listRoots(db).length, 1);
      const resolved = resolveScope(db, {
        identity: { sessionId: 's-persist', profileKey: 'default' },
        expectedProfileKey: 'default', cwd: project, now: 9,
      });
      assert.equal(resolved.source, 'cwd');
    });
    withRegistry(profile, (db) => {
      const removed = removeTrustedRoot(db, { path: profile.base, now: 10 });
      assert.equal(removed.changed, true);
      assert.equal(listTrustedRoots(db)[0].state, 'revoked');
      // Revocar la confianza no borra el proyecto ya registrado.
      assert.equal(listRoots(db).length, 1);
    });
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});

test('las siete herramientas funcionan con un proyecto descubierto sin selección manual', async () => {
  const world = await makeWorld({ docsA: { 'a.md': '# Alfa\n\nalfa del proyecto descubierto\n' } });
  try {
    // El proyecto A ya existe; el workspace confiable sólo tiene que permitir llegar a su raíz.
    mkdirSync(join(world.dirA, '.git'), { recursive: true });
    withRegistry({ root: world.root }, (db) => {
      addTrustedRoot(db, { path: world.base, readAuthorization: true, now: 100 });
    });
    const definitions = createToolDefinitions({
      config: world.config, root: world.root,
      services: servicesFor(world, { cwd: world.dirA, sessionId: 'sesion-descubierta' }),
    });
    const search = definitions.find((tool) => tool.name === 'lifecode_rag_search');
    const payload = await search.execute({ query: 'alfa' }, fakeExec('sesion-descubierta'));
    assert.equal(payload.results.some((row) => row.uri.endsWith('a.md')), true);
  } finally {
    world.cleanup();
  }
});

test('una sesión no ve el proyecto de otra aunque ambas estén bajo el mismo workspace', async () => {
  const world = await makeWorld();
  try {
    mkdirSync(join(world.dirA, '.git'), { recursive: true });
    mkdirSync(join(world.dirB, '.git'), { recursive: true });
    withRegistry({ root: world.root }, (db) => {
      addTrustedRoot(db, { path: world.base, readAuthorization: true, now: 100 });
    });
    const definitions = createToolDefinitions({
      config: world.config, root: world.root,
      services: servicesFor(world, { cwd: world.dirB, sessionId: 'sesion-b' }),
    });
    const search = definitions.find((tool) => tool.name === 'lifecode_rag_search');
    const payload = await search.execute({ query: 'alfa' }, fakeExec('sesion-b'));
    assert.equal(payload.results.every((row) => !row.uri.endsWith('a.md')), true);
  } finally {
    world.cleanup();
  }
});

test('la CLI de confianza es idempotente y no autoriza lectura si se pide --read false', () => {
  const profile = tempProfile();
  try {
    const workspace = touch(join(profile.base, 'cli-workspace'), '.git');
    withRegistry(profile, (db) => {
      const first = addTrustedRoot(db, { path: workspace, readAuthorization: false, now: 1 });
      const second = addTrustedRoot(db, { path: workspace, readAuthorization: false, now: 2 });
      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(second.changed, false);
      assert.equal(listTrustedRoots(db).length, 1);
      assert.equal(listTrustedRoots(db)[0].readAuthorization, false);
    });
  } finally {
    rmSync(profile.base, { recursive: true, force: true });
  }
});
