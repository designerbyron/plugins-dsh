// D1 y D11 · la vista de identidad declara lo que ya sabe: duplicados del conjunto y estados de fork.
//
// Antes, `identityPayload` sólo pasaba `inventory` al clasificador, así que dos registros con el mismo UUID
// salían `linked`; y los estados de fork se clasificaban fila a fila pero no se contaban en ningún sitio.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { identityPayload } from '../lib/api.mjs';
import { emptyState, saveState } from '../lib/state.mjs';
import { tempProject, tempRoot, autonomyRoot } from './helpers.mjs';

const STORES = [];
const UUID = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const NOW = '2026-11-09T04:00:00.000Z';

after(() => {
  for (const dir of STORES) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // queda al sistema
    }
  }
});

function manifestFor(projectId) {
  return JSON.stringify({ schema: 'lifecode-skill-center/project', schemaVersion: 1, projectId, registeredAt: '2026-11-09T03:59:11.645Z' });
}

function workspaceWithManifest(label, projectId) {
  const dir = tempProject(label, storeRoot());
  mkdirSync(join(dir, '.dsh'), { recursive: true });
  const manifest = manifestFor(projectId);
  writeFileSync(join(dir, '.dsh', 'lifecode-skill-center.json'), manifest, 'utf8');
  return { dir, sha256: createHash('sha256').update(manifest, 'utf8').digest('hex') };
}

function storeRoot() {
  const dir = autonomyRoot('lsc-projection');
  STORES.push(dir);
  return dir;
}

function registryFor(dirs) {
  return { list: () => dirs.map((path) => ({ path })), subscribe: () => () => undefined };
}

test('D1 · dos registros con el mismo UUID se declaran duplicados y las filas lo dicen', () => {
  const store = storeRoot();
  const a = workspaceWithManifest('proj-a', UUID);
  const b = workspaceWithManifest('proj-b', UUID);
  const document = emptyState(NOW);
  document.schemaVersion = 3;
  document.projects = {
    a: { id: 'a', cwd: a.dir, uuid: UUID, manifestSha256: a.sha256, registeredAt: NOW },
    b: { id: 'b', cwd: b.dir, uuid: UUID, manifestSha256: b.sha256, registeredAt: NOW },
  };
  saveState(store, document);

  const view = identityPayload({ root: store, registry: registryFor([a.dir, b.dir]) });
  assert.equal(view.uniqueness, 'uuid-duplicated');
  assert.equal(view.duplicates.uuid.length, 1);
  assert.equal(view.duplicates.uuid[0].value, UUID);
  assert.deepEqual(view.duplicates.uuid[0].items.slice().sort(), [a.dir, b.dir].sort());
  assert.deepEqual(view.duplicates.path, []);
  for (const item of view.items) assert.equal(item.identity, 'uuid-duplicated');
});

test('D11 · un proyecto con campos de fork se clasifica y además se cuenta en el grupo', () => {
  const store = storeRoot();
  const forked = workspaceWithManifest('proj-fork', OTHER);
  const document = emptyState(NOW);
  document.schemaVersion = 3;
  document.projects = {
    forked: {
      id: 'forked',
      cwd: forked.dir,
      uuid: OTHER,
      manifestSha256: forked.sha256,
      registeredAt: NOW,
      forkedFrom: 'origen-1',
      forkOperationId: 'op-1',
    },
  };
  saveState(store, document);

  const view = identityPayload({ root: store, registry: registryFor([forked.dir]) });
  const item = view.items.find((row) => row.path === forked.dir);
  assert.equal(item.identity, 'fork-registered');
  assert.equal(view.forks.total, 1);
  assert.deepEqual(view.forks.byState, { 'fork-registered': 1 });
  assert.equal(view.uniqueness, 'ok');
  assert.deepEqual(view.duplicates.uuid, []);
});

test('control · un proyecto normal no se declara duplicado ni fork', () => {
  const store = storeRoot();
  const plain = workspaceWithManifest('proj-plain', UUID);
  const document = emptyState(NOW);
  document.schemaVersion = 3;
  document.projects = { plain: { id: 'plain', cwd: plain.dir, uuid: UUID, manifestSha256: plain.sha256, registeredAt: NOW } };
  saveState(store, document);

  const view = identityPayload({ root: store, registry: registryFor([plain.dir]) });
  assert.equal(view.uniqueness, 'ok');
  assert.deepEqual(view.duplicates, { uuid: [], path: [] });
  assert.deepEqual(view.forks, { total: 0, byState: {} });
  assert.equal(view.items[0].identity, 'linked');
});
