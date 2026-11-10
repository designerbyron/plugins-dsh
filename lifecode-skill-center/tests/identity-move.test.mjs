import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runAction } from '../lib/api.mjs';
import { ensureBackup, emptyState, loadState, saveState } from '../lib/state.mjs';

const NOW = '2026-11-09T03:59:11.645Z';
const UUID = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607';
const OTHER = '9c8b7a65-4321-4fed-8cba-0987654321fe';

function manifestText(projectId) {
  return `${JSON.stringify({ schema: 'lifecode-skill-center/project', schemaVersion: 1, projectId, registeredAt: NOW }, null, 2)}\n`;
}

/** Centro v3 con un proyecto registrado en `cwd` y su manifiesto publicado. */
function centre({ label = 'move', withManifest = true, uuid = UUID, backup = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), `${label}-`));
  saveState(root, { ...emptyState(NOW), schemaVersion: 3 }, { now: NOW });
  const cwd = mkdtempSync(join(tmpdir(), `${label}-ws-`));
  mkdirSync(join(cwd, '.dsh'), { recursive: true });
  const manifestPath = join(cwd, '.dsh', 'lifecode-skill-center.json');
  if (withManifest === true) writeFileSync(manifestPath, manifestText(uuid), 'utf8');
  const state = loadState(root).state;
  state.projects['proyecto-x'] = {
    id: 'proyecto-x',
    name: 'proyecto x',
    cwd,
    createdAt: NOW,
    updatedAt: NOW,
    note: '',
    uuid,
  };
  state.assignments['proyecto-x'] = { 'skill-a': { enabled: true, version: '1.0.0', updatedAt: NOW, by: 'human' } };
  saveState(root, state, { now: NOW });
  if (backup === true) ensureBackup(root, { now: NOW, reason: 'migration' });
  return { root, cwd, manifestPath };
}

test('mover un proyecto exige que la ruta vieja ya no exista y que el destino lleve su manifiesto', () => {
  const box = centre({ label: 'move-ok' });
  const destination = join(mkdtempSync(join(tmpdir(), 'move-dest-')), 'proyecto');
  renameSync(box.cwd, destination);
  const registry = { list: () => [{ id: 'ws-new', path: destination, title: 'proyecto x' }] };
  const moved = runAction({
    root: box.root,
    action: 'identity-move',
    actor: 'human',
    registry,
    now: NOW,
    payload: { projectId: 'proyecto-x', fromCwd: box.cwd, toCwd: destination },
  });
  assert.equal(moved.ok, true, moved.message);
  const stored = loadState(box.root).state;
  assert.equal(stored.projects['proyecto-x'].cwd, destination.replaceAll('\\', '/'));
  assert.equal(stored.projects['proyecto-x'].uuid, UUID, 'la identidad no cambia');
  assert.deepEqual(stored.assignments['proyecto-x'], {
    'skill-a': { enabled: true, version: '1.0.0', updatedAt: NOW, by: 'human' },
  });
  assert.equal(stored.events.filter((event) => event.type === 'project.moved').length, 1);
});

test('no se mueve si la carpeta anterior sigue existiendo', () => {
  const box = centre({ label: 'move-old-present' });
  const destination = mkdtempSync(join(tmpdir(), 'move-dest-'));
  mkdirSync(join(destination, '.dsh'), { recursive: true });
  writeFileSync(join(destination, '.dsh', 'lifecode-skill-center.json'), manifestText(UUID), 'utf8');
  const result = runAction({
    root: box.root,
    action: 'identity-move',
    actor: 'human',
    registry: { list: () => [] },
    now: NOW,
    payload: { projectId: 'proyecto-x', fromCwd: box.cwd, toCwd: destination },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'old-path-indeterminate');
  assert.equal(loadState(box.root).state.projects['proyecto-x'].cwd.replaceAll('\\', '/'), box.cwd.replaceAll('\\', '/'));
});

test('no se mueve a una carpeta sin manifiesto ni con el de otra identidad', () => {
  const box = centre({ label: 'move-dest' });
  const destination = join(mkdtempSync(join(tmpdir(), 'move-dest-')), 'proyecto');
  renameSync(box.cwd, destination);
  rmSync(join(destination, '.dsh'), { recursive: true, force: true });
  const empty = runAction({
    root: box.root,
    action: 'identity-move',
    actor: 'human',
    registry: { list: () => [] },
    now: NOW,
    payload: { projectId: 'proyecto-x', fromCwd: box.cwd, toCwd: destination },
  });
  assert.equal(empty.code, 'manifest-missing');

  mkdirSync(join(destination, '.dsh'), { recursive: true });
  writeFileSync(join(destination, '.dsh', 'lifecode-skill-center.json'), manifestText(OTHER), 'utf8');
  const foreign = runAction({
    root: box.root,
    action: 'identity-move',
    actor: 'human',
    registry: { list: () => [] },
    now: NOW,
    payload: { projectId: 'proyecto-x', fromCwd: box.cwd, toCwd: destination },
  });
  assert.equal(foreign.code, 'manifest-mismatch');
});

test('mover exige una copia verificada previa', () => {
  const box = centre({ label: 'move-nobackup', backup: false });
  const destination = join(mkdtempSync(join(tmpdir(), 'move-dest-')), 'proyecto');
  renameSync(box.cwd, destination);
  const result = runAction({
    root: box.root,
    action: 'identity-move',
    actor: 'human',
    registry: { list: () => [{ id: 'ws', path: destination, title: 'x' }] },
    now: NOW,
    payload: { projectId: 'proyecto-x', fromCwd: box.cwd, toCwd: destination },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'backup-required');
});

test('reconciliar exige confirmación explícita y no toca nada sin ella', () => {
  const box = centre({ label: 'reconcile-confirm' });
  const before = loadState(box.root).sha256;
  const result = runAction({
    root: box.root,
    action: 'identity-reconcile',
    actor: 'human',
    registry: { list: () => [{ id: 'ws', path: box.cwd, title: 'x' }] },
    now: NOW,
    payload: { projectId: 'proyecto-x', cwd: box.cwd },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'confirmation-required');
  assert.equal(loadState(box.root).sha256, before);
});

test('reconciliar sin diferencias no escribe ni emite evento', () => {
  const box = centre({ label: 'reconcile-same' });
  // El registro no tiene huella todavía: la primera reconciliación la ancla y deja constancia.
  const first = runAction({
    root: box.root,
    action: 'identity-reconcile',
    actor: 'human',
    registry: { list: () => [{ id: 'ws', path: box.cwd, title: 'x' }] },
    now: NOW,
    payload: { projectId: 'proyecto-x', cwd: box.cwd, confirm: true },
  });
  assert.equal(first.ok, true, first.message);
  assert.equal(first.reconciled, true);
  const events = loadState(box.root).state.events.filter((event) => event.type === 'project.reconciled');
  assert.equal(events.length, 1);

  const second = runAction({
    root: box.root,
    action: 'identity-reconcile',
    actor: 'human',
    registry: { list: () => [{ id: 'ws', path: box.cwd, title: 'x' }] },
    now: NOW,
    payload: { projectId: 'proyecto-x', cwd: box.cwd, confirm: true },
  });
  assert.equal(second.ok, true);
  assert.equal(second.reconciled, false, 'sin diferencias no hay nada que reconciliar');
  assert.equal(loadState(box.root).state.events.filter((event) => event.type === 'project.reconciled').length, 1);
});

test('reconciliar un manifiesto de otra identidad es un conflicto, no una reconciliación', () => {
  const box = centre({ label: 'reconcile-foreign' });
  writeFileSync(box.manifestPath, manifestText(OTHER), 'utf8');
  const result = runAction({
    root: box.root,
    action: 'identity-reconcile',
    actor: 'human',
    registry: { list: () => [{ id: 'ws', path: box.cwd, title: 'x' }] },
    now: NOW,
    payload: { projectId: 'proyecto-x', cwd: box.cwd, confirm: true },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'manifest-mismatch');
});

test('la IA no mueve ni reconcilia', () => {
  const box = centre({ label: 'move-ai' });
  const destination = join(mkdtempSync(join(tmpdir(), 'move-dest-')), 'proyecto');
  renameSync(box.cwd, destination);
  mkdirSync(join(destination, '.dsh'), { recursive: true });
  writeFileSync(join(destination, '.dsh', 'lifecode-skill-center.json'), manifestText(UUID), 'utf8');
  const moved = runAction({
    root: box.root,
    action: 'identity-move',
    actor: 'ai',
    registry: { list: () => [{ id: 'ws', path: destination, title: 'x' }] },
    now: NOW,
    payload: { projectId: 'proyecto-x', fromCwd: box.cwd, toCwd: destination },
  });
  assert.equal(moved.code, 'approval-required');
  const reconciled = runAction({
    root: box.root,
    action: 'identity-reconcile',
    actor: 'ai',
    registry: { list: () => [] },
    now: NOW,
    payload: { projectId: 'proyecto-x', cwd: destination, confirm: true },
  });
  assert.equal(reconciled.code, 'approval-required');
});
