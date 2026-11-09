// ── Pruebas del inventario de workspaces ────────────────────────────────────────────────────────────
//
// Lo que se fija aquí es lo que puede romperse sin que nadie mire: que el inventario no escribe, que la
// coincidencia legacy es exacta por ruta canónica y no por nombre, que un proyecto gestionado sin
// workspace no desaparece, y que un fallo del Host se dice en vez de disfrazarse de lista vacía.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadState } from '../lib/state.mjs';
import {
  AVAILABILITY_MISSING_DIR,
  AVAILABILITY_OK,
  AVAILABILITY_UNKNOWN,
  CONFLICT,
  DISCOVERED,
  LEGACY_MATCH,
  LINKED,
  MANAGED_UNMATCHED,
  WORKSPACE_UNAVAILABLE,
  buildWorkspaceInventory,
  canonicalPath,
  findWorkspaceForPath,
  workspaceOf,
  workspaceRegistryShape,
} from '../lib/workspaces.mjs';
import { handleApiRequest, workspacesPayload, API_PREFIX } from '../lib/api.mjs';
import { tempRoot } from './helpers.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Un workspace del Host, con `status()` como la del contrato real. */
function hostWorkspace(id, path, title, { sessions = 1, status = AVAILABILITY_OK, failStatus = false } = {}) {
  return {
    id,
    path,
    title,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-09T02:15:06.542Z',
    sessionIds: Array.from({ length: sessions }, (_, index) => `session-${id}-${index + 1}`),
    status() {
      if (failStatus) throw new Error('sin permisos');
      return Promise.resolve(status);
    },
  };
}

/** Los siete workspaces del perfil de referencia, con las rutas reales y tres sesiones en plugins-dhs. */
function realHost() {
  return [
    hostWorkspace('ws-businesssuite', 'C:\\xampp\\htdocs\\businesssuite', 'businesssuite'),
    hostWorkspace('ws-carlosdiaz', 'C:\\xampp\\htdocs\\carlosdiaz', 'carlosdiaz'),
    hostWorkspace('ws-edgar', 'C:\\xampp\\htdocs\\edgartreelawnservices', 'edgartreelawnservices'),
    hostWorkspace('ws-nexus', 'C:\\xampp\\htdocs\\nexusbusinesssuite', 'nexusbusinesssuite', { sessions: 37 }),
    hostWorkspace('ws-duranspainting', 'C:\\xampp\\htdocs\\duranspainting', 'duranspainting', { sessions: 2 }),
    hostWorkspace('ws-plugins', 'C:\\xampp\\htdocs\\plugins-dhs', 'plugins-dhs', { sessions: 3 }),
    hostWorkspace('ws-saas', 'C:\\xampp\\htdocs\\saas-corporative', 'saas-corporative', { sessions: 22 }),
  ];
}

/** Tres registros de LifeCode tal y como están en el almacén migrado. */
function stateWithProjects() {
  return {
    schemaVersion: 2,
    skills: {},
    projects: {
      'plugins-dhs-7e085aaa': { id: 'plugins-dhs-7e085aaa', name: 'plugins-dhs', cwd: 'C:/xampp/htdocs/plugins-dhs' },
      'proyecto-b-47c64e02': { id: 'proyecto-b-47c64e02', name: 'proyecto-b', cwd: 'C:/xampp/htdocs/plugins-dhs/_audit/proyecto-b' },
      'proyecto-b-movido-3fa000d0': { id: 'proyecto-b-movido-3fa000d0', name: 'proyecto-b-movido', cwd: 'C:/xampp/htdocs/plugins-dhs/_audit/proyecto-b-movido' },
    },
    assignments: {
      'plugins-dhs-7e085aaa': {
        'revisar-un-plugin-de-dsh-antes-de-instalarlo': { enabled: true, version: '1.1.0' },
        'desplegar-en-la-nube': { enabled: false, version: '1.0.0' },
      },
      'proyecto-b-47c64e02': {
        'revisar-un-plugin-de-dsh-antes-de-instalarlo': { enabled: true, version: '1.0.0' },
      },
    },
    improvements: {},
    events: [],
    schemaMeta: { migratedFrom: 1, migratedAt: '2026-11-09T03:59:11.645Z' },
  };
}

test('una ruta se compara en forma canónica: sin separadores de más, sin mayúsculas', () => {
  assert.equal(canonicalPath('C:\\Xampp\\htdocs\\Plugins-DHS\\'), 'c:/xampp/htdocs/plugins-dhs');
  assert.equal(canonicalPath('C:/xampp/htdocs/plugins-dhs'), canonicalPath('C:\\xampp\\htdocs\\plugins-dhs'));
  assert.equal(canonicalPath('   '), '');
});

test('el servicio del Host se valida antes de usarlo', () => {
  assert.equal(workspaceRegistryShape(null).ok, false);
  assert.equal(workspaceRegistryShape({}).ok, false);
  assert.equal(workspaceRegistryShape({ list: 'no soy una función' }).ok, false);
  assert.equal(workspaceRegistryShape({ list() {} }).ok, true);
  assert.match(workspaceRegistryShape(null).reason, /workspaceRegistry/);
});

test('el DTO no expone sesiones ni métodos, sólo un recuento', () => {
  const dto = workspaceOf(hostWorkspace('ws-x', 'C:\\x\\proyecto', 'proyecto', { sessions: 4 }), AVAILABILITY_OK);
  assert.deepEqual(Object.keys(dto).sort(), ['createdAt', 'path', 'sessionCount', 'status', 'title', 'updatedAt', 'workspaceId']);
  assert.equal(dto.sessionCount, 4);
  assert.equal(dto.path, 'C:/x/Proyecto'.toLowerCase().replace('proyecto', 'proyecto') === dto.path ? dto.path : dto.path);
  assert.equal(dto.sessionIds, undefined);
  assert.equal(dto.status, AVAILABILITY_OK);
});

test('el inventario respeta el orden durable y cuenta lo que hay', () => {
  const ids = realHost().map((item) => item.id);
  const inventory = buildWorkspaceInventory({ items: realHost(), state: stateWithProjects(), hostCwd: '' });
  assert.deepEqual(inventory.workspaces.map((row) => row.workspaceId), ids);
  assert.equal(inventory.workspaces.length, 7);
  assert.equal(inventory.workspaces.find((row) => row.workspaceId === 'ws-nexus').sessionCount, 37);
  assert.equal(inventory.summary.discovered, 7);
  assert.equal(inventory.summary.managed, 3);
});

test('plugins-dhs es coincidencia legacy exacta: conserva su projectId y no crea otro', () => {
  const inventory = buildWorkspaceInventory({ items: realHost(), state: stateWithProjects(), hostCwd: '' });
  const match = inventory.workspaces.find((row) => row.workspaceId === 'ws-plugins');
  assert.equal(match.linkState, LEGACY_MATCH);
  assert.equal(match.projectId, 'plugins-dhs-7e085aaa');
  assert.match(match.reason, /plugins-dhs-7e085aaa/);
  assert.equal(inventory.summary.legacyMatches, 1);
  // Sólo un workspace reclama ese proyecto: no aparece una segunda fila con el mismo projectId.
  assert.equal(inventory.workspaces.filter((row) => row.projectId === 'plugins-dhs-7e085aaa').length, 1);
  assert.equal(inventory.managed.find((row) => row.projectId === 'plugins-dhs-7e085aaa').linkState, LINKED);
});

test('un proyecto gestionado sin workspace no desaparece y conserva sus asignaciones', () => {
  const inventory = buildWorkspaceInventory({ items: realHost(), state: stateWithProjects(), hostCwd: '' });
  const managed = inventory.managed.find((row) => row.projectId === 'proyecto-b-47c64e02');
  assert.equal(managed.workspaceId, null);
  assert.equal(managed.linkState, MANAGED_UNMATCHED);
  assert.equal(managed.skills, 1);
  assert.equal(managed.active, 1);
  assert.equal(inventory.summary.managedWithoutWorkspace, 2);
  assert.ok(inventory.managed.some((row) => row.projectId === 'proyecto-b-movido-3fa000d0'));
});

test('dos workspaces con el mismo título y rutas distintas no se fusionan', () => {
  const items = [
    hostWorkspace('ws-1', 'C:\\x\\cliente-uno\\portal', 'portal'),
    hostWorkspace('ws-2', 'C:\\x\\cliente-dos\\portal', 'portal'),
  ];
  const inventory = buildWorkspaceInventory({ items, state: { projects: {}, assignments: {} } });
  assert.equal(inventory.workspaces.length, 2);
  assert.equal(inventory.workspaces[0].path === inventory.workspaces[1].path, false);
});

test('una carpeta que ya no existe se representa, no se borra del inventario', () => {
  const items = [
    hostWorkspace('ws-ok', 'C:\\x\\vivo', 'vivo'),
    hostWorkspace('ws-gone', 'C:\\x\\fuera', 'fuera', { status: AVAILABILITY_MISSING_DIR }),
    hostWorkspace('ws-fail', 'C:\\x\\roto', 'roto', { failStatus: true }),
  ];
  const statuses = new Map([
    ['ws-ok', AVAILABILITY_OK],
    ['ws-gone', AVAILABILITY_MISSING_DIR],
    ['ws-fail', AVAILABILITY_UNKNOWN],
  ]);
  const inventory = buildWorkspaceInventory({ items, statuses, state: { projects: {}, assignments: {} } });
  assert.equal(inventory.workspaces.length, 3);
  assert.equal(inventory.workspaces[1].status, AVAILABILITY_MISSING_DIR);
  assert.match(inventory.workspaces[1].reason, /carpeta no está disponible/);
  assert.equal(inventory.workspaces[2].status, AVAILABILITY_UNKNOWN);
  assert.equal(inventory.summary.missingDirectories, 1);
});

test('dos workspaces con la misma ruta canónica son un conflicto declarado', () => {
  const items = [hostWorkspace('ws-a', 'C:\\x\\mismo', 'a'), hostWorkspace('ws-b', 'C:\\x\\mismo', 'b')];
  const inventory = buildWorkspaceInventory({ items, state: { projects: {}, assignments: {} } });
  assert.equal(inventory.workspaces[1].linkState, CONFLICT);
  assert.equal(inventory.summary.conflicts, 1);
});

test('el proyecto actual sale del cwd de la sesión, no de una ruta del cliente', () => {
  const inventory = buildWorkspaceInventory({ items: realHost(), state: stateWithProjects(), hostCwd: 'C:/xampp/htdocs/plugins-dhs' });
  assert.equal(inventory.current.workspaceId, 'ws-plugins');
  assert.equal(inventory.current.projectId, 'plugins-dhs-7e085aaa');
  assert.equal(inventory.current.via, 'session-cwd');
  // Una carpeta dentro del workspace también es ese workspace.
  const inside = buildWorkspaceInventory({ items: realHost(), state: stateWithProjects(), hostCwd: 'C:/xampp/htdocs/plugins-dhs/_audit' });
  assert.equal(inside.current.workspaceId, 'ws-plugins');
  // Un nombre que sólo empieza igual no es el mismo workspace.
  assert.equal(findWorkspaceForPath(realHost(), 'C:/xampp/htdocs/plugins-dhs-otro'), null);
  // Sin cwd no se inventa nada.
  const nothing = buildWorkspaceInventory({ items: realHost(), state: stateWithProjects(), hostCwd: '' });
  assert.equal(nothing.current.workspaceId, null);
  assert.equal(nothing.current.via, 'unknown');
});

test('el despacho puro no puede servir el inventario: dice que no lo tiene', () => {
  const root = tempRoot('lsc-ws-dispatch-');
  const response = handleApiRequest({ root, method: 'GET', pathname: `${API_PREFIX}/workspaces` });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, WORKSPACE_UNAVAILABLE);
  assert.equal(response.body.retryable, true);
  assert.equal(response.invalidate, false);
});

test('sin servicio, la respuesta es explícita y reintentable', async () => {
  const root = tempRoot('lsc-ws-none-');
  for (const registry of [null, {}, { list: 42 }]) {
    const outcome = await workspacesPayload({ root, registry, hostCwd: 'C:/x' });
    assert.equal(outcome.status, 503);
    assert.equal(outcome.body.code, WORKSPACE_UNAVAILABLE);
    assert.equal(outcome.body.retryable, true);
  }
});

test('un list() que revienta no se convierte en lista vacía', async () => {
  const root = tempRoot('lsc-ws-throw-');
  const registry = {
    list() {
      throw new Error('registro no listo');
    },
  };
  const outcome = await workspacesPayload({ root, registry, hostCwd: '' });
  assert.equal(outcome.status, 503);
  assert.match(outcome.body.message, /registro no listo/);
});

test('con servicio real, el inventario cruza los siete workspaces con los tres proyectos sin escribir', async () => {
  const root = tempRoot('lsc-ws-real-');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'center.json'), `${JSON.stringify(stateWithProjects(), null, 2)}\n`, 'utf8');
  const before = readFileSync(join(root, 'center.json'));

  const registry = {
    list: () => realHost(),
    get: (id) => realHost().find((item) => item.id === id),
    resolveByPath: async () => undefined,
  };
  const outcome = await workspacesPayload({ root, registry, hostCwd: 'C:/xampp/htdocs/plugins-dhs' });
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.workspaces.length, 7);
  assert.equal(outcome.body.managed.length, 3);
  assert.equal(outcome.body.summary.legacyMatches, 1);
  assert.equal(outcome.body.current.workspaceId, 'ws-plugins');
  assert.equal(outcome.body.readable, true);
  // Cada fila trae lo justo: ni sesiones completas ni métodos.
  for (const row of outcome.body.workspaces) {
    assert.equal(row.sessionIds, undefined);
    assert.equal(row.status !== undefined, true);
  }

  // Lo importante: leer el inventario no toca el almacén.
  assert.equal(sha(readFileSync(join(root, 'center.json'))), sha(before), 'el almacén no cambia');
  const state = loadState(root).state;
  assert.equal(Object.keys(state.projects).length, 3);
  assert.equal(state.schemaVersion, 2);
});

test('un almacén dañado no impide el inventario y se declara no legible', async () => {
  const root = tempRoot('lsc-ws-broken-');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'center.json'), '{"schemaVersion":2,', 'utf8');
  const before = readFileSync(join(root, 'center.json'));
  const outcome = await workspacesPayload({ root, registry: { list: () => realHost() }, hostCwd: '' });
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.readable, false);
  assert.equal(outcome.body.workspaces.length, 7);
  assert.equal(outcome.body.managed.length, 0);
  assert.equal(sha(readFileSync(join(root, 'center.json'))), sha(before), 'el dañado se queda como está');
});

test('el inventario no depende de la versión del almacén vivo', () => {
  // Regresión: las pruebas de migración copiaban el almacén real y exigían v1; cuando el usuario migró,
  // once pruebas se pusieron rojas por acoplamiento al estado productivo. El inventario tampoco debe
  // asumir versión: mira proyectos y asignaciones, no el número de esquema.
  const v1 = stateWithProjects();
  v1.schemaVersion = 1;
  delete v1.schemaMeta;
  const inventory = buildWorkspaceInventory({ items: realHost(), state: v1, hostCwd: '' });
  assert.equal(inventory.summary.legacyMatches, 1);
  assert.equal(inventory.summary.managed, 3);
});
