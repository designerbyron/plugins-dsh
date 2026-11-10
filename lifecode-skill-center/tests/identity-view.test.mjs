// Vista de identidad: lo que el panel muestra sobre cada carpeta. Se prueba aquí porque es la primera lectura
// que combina registro, manifiesto, artefactos del fork y disponibilidad del workspace; dos defectos reales
// vivieron justo en esta costura (la proyección de registros ocultaba la huella, y un `null` copiado a la fuerza
// convertía cualquier proyecto en `fork-registered`).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { identityPayload } from '../lib/api.mjs';
import { manifestBytes, publishExclusive } from '../lib/manifest-ops.mjs';
import { emptyState, loadState, saveState } from '../lib/state.mjs';

const NOW = '2026-11-09T03:59:11.645Z';
const UUID = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607';
const OTHER_UUID = '9b8c7d6e-5f40-4a31-82b9-0c1d2e3f4a5b';

function workspace(label) {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  mkdirSync(join(dir, '.dsh'), { recursive: true });
  return dir;
}

function writeManifest(dir, projectId, registeredAt = NOW) {
  const bytes = manifestBytes({ schema: 'lifecode-skill-center/project', schemaVersion: 1, projectId, registeredAt });
  writeFileSync(join(dir, '.dsh', 'lifecode-skill-center.json'), bytes);
  return createHash('sha256').update(bytes).digest('hex');
}

function seed({ schemaVersion = 3 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'identity-view-'));
  saveState(root, { ...emptyState(NOW), schemaVersion }, { now: NOW });
  return root;
}

function register(root, id, cwd, extra = {}) {
  const state = loadState(root).state;
  state.projects[id] = { id, name: id, cwd, createdAt: NOW, updatedAt: NOW, note: '', ...extra };
  saveState(root, state, { now: NOW });
}

function registryOf(entries) {
  return {
    list: () =>
      entries.map((entry, index) => ({
        id: entry.id ?? `ws-${index}`,
        path: entry.path,
        title: entry.title ?? `w${index}`,
        status: async () => entry.status ?? 'ok',
      })),
  };
}

test('un proyecto vinculado y verificado aparece como linked, no como unknown', () => {
  const root = seed();
  const dir = workspace('view-linked');
  const sha = writeManifest(dir, UUID);
  register(root, 'p1', dir, { uuid: UUID, manifestSha256: sha });

  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  assert.equal(view.total, 1);
  assert.equal(view.items[0].identity, 'linked');
  assert.equal(view.items[0].verification, 'verified');
  assert.equal(view.items[0].uuid, UUID);
  assert.deepEqual(view.counts, { linked: 1 });
});

test('un proyecto adoptado se distingue de uno simplemente vinculado', () => {
  const root = seed();
  const dir = workspace('view-adopted');
  const sha = writeManifest(dir, UUID);
  register(root, 'p1', dir, { uuid: UUID, manifestSha256: sha, adoptedAt: NOW });

  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  assert.equal(view.items[0].identity, 'adopted');
});

test('un registro sin manifiesto se clasifica manifest-missing y no inventa identidad', () => {
  const root = seed();
  const dir = workspace('view-missing');
  register(root, 'p1', dir, { uuid: UUID });

  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  assert.equal(view.items[0].identity, 'manifest-missing');
  assert.ok(view.items[0].reasons.includes('no-manifest'));
});

test('un manifiesto sin registro que lo reclame es manifest-only, no linked', () => {
  const root = seed();
  const dir = workspace('view-manifest-only');
  writeManifest(dir, UUID);

  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  assert.equal(view.items[0].identity, 'manifest-only');
  assert.equal(view.items[0].projectId, null);
});

test('un manifiesto de otra identidad en la ruta del registro es path-conflict', () => {
  const root = seed();
  const dir = workspace('view-conflict');
  const sha = writeManifest(dir, OTHER_UUID);
  register(root, 'p1', dir, { uuid: UUID, manifestSha256: sha });

  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  assert.equal(view.items[0].identity, 'path-conflict');
  assert.ok(view.items[0].reasons.includes('manifest-uuid-elsewhere'));
});

test('un registro con huella distinta a la del manifiesto es path-conflict', () => {
  const root = seed();
  const dir = workspace('view-hash-differs');
  const sha = writeManifest(dir, UUID);
  register(root, 'p1', dir, { uuid: UUID, manifestSha256: `${'a'.repeat(64)}` });
  assert.notEqual(sha, `${'a'.repeat(64)}`);

  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  assert.equal(view.items[0].identity, 'path-conflict');
  assert.ok(view.items[0].reasons.includes('manifest-hash-differs'));
});

test('un proyecto con campos de fork y manifiesto coincidente es fork-registered', () => {
  const root = seed();
  const dir = workspace('view-fork');
  const sha = writeManifest(dir, UUID);
  register(root, 'p1', dir, {
    uuid: UUID,
    manifestSha256: sha,
    forkedFrom: 'plugins-dhs',
    forkOperationId: 'abc123abc123abc1',
    forkedAt: NOW,
    forkPreviousManifestSha256: `${'b'.repeat(64)}`,
    forkArchivedFile: 'lifecode-skill-center.manifest-20261109T035911Z-cafebabe.json',
  });

  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  assert.equal(view.items[0].identity, 'fork-registered');
});

test('un proyecto desvinculado con manifiesto todavía presente es detached-manifest', () => {
  const root = seed();
  const dir = workspace('view-detached');
  const sha = writeManifest(dir, UUID);
  register(root, 'p1', dir, { uuid: UUID, manifestSha256: sha, detachedFrom: dir, detachedAt: NOW, detachedSha256: sha });

  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  assert.equal(view.items[0].identity, 'detached-manifest');
});

test('una carpeta de workspace sin nada del centro es unmanaged', () => {
  const root = seed();
  const dir = workspace('view-unmanaged');

  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  assert.equal(view.items[0].identity, 'unmanaged');
  assert.equal(view.items[0].availability, 'ok');
});

test('una ruta que ya no existe no desaparece del inventario', () => {
  const root = seed();
  const dir = workspace('view-removed');
  register(root, 'p1', dir, { uuid: UUID });
  rmSync(dir, { recursive: true, force: true });

  const view = identityPayload({ root, registry: registryOf([]) });
  assert.equal(view.total, 1);
  assert.equal(view.items[0].availability, 'missing-dir');
  assert.equal(view.items[0].verification, 'unverified');
});

test('el inventario es completo cuando todas las rutas se inspeccionan y no hay servicio de workspaces', () => {
  const root = seed();
  const dir = workspace('view-no-registry');
  const sha = writeManifest(dir, UUID);
  register(root, 'p1', dir, { uuid: UUID, manifestSha256: sha });

  const view = identityPayload({ root, registry: null });
  assert.equal(view.inventory.status, 'incomplete');
  assert.ok(view.inventory.reasons.includes('inventory-no-registry'));
  assert.equal(view.items[0].identity, 'linked');
  assert.equal(view.items[0].verification, 'unverified');
});

test('un manifiesto válido publicado por el producto se lee igual que uno escrito a mano', () => {
  const root = seed();
  const dir = workspace('view-published');
  const bytes = manifestBytes({ schema: 'lifecode-skill-center/project', schemaVersion: 1, projectId: UUID, registeredAt: NOW });
  const published = publishExclusive({
    path: join(dir, '.dsh', 'lifecode-skill-center.json'),
    bytes,
    dshRoot: join(dir, '.dsh'),
    kind: 'manifest',
  });
  assert.equal(published.ok, true);
  register(root, 'p1', dir, { uuid: UUID, manifestSha256: published.sha256 });

  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  assert.equal(view.items[0].identity, 'linked');
  assert.equal(view.items[0].verification, 'verified');
});

test('la vista de identidad no escribe en el almacén', () => {
  const root = seed();
  const dir = workspace('view-readonly');
  writeManifest(dir, UUID);
  const before = loadState(root);
  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  const after = loadState(root);
  assert.equal(view.ok, true);
  assert.equal(after.sha256, before.sha256);
  assert.equal(after.size, before.size);
});

test('un almacén v2 también produce vista: la lectura no exige v3', () => {
  const root = seed({ schemaVersion: 2 });
  const dir = workspace('view-v2');
  const sha = writeManifest(dir, UUID);
  register(root, 'p1', dir, { uuid: UUID, manifestSha256: sha });

  const view = identityPayload({ root, registry: registryOf([{ path: dir }]) });
  assert.equal(view.ok, true);
  assert.equal(view.items[0].identity, 'linked');
});
