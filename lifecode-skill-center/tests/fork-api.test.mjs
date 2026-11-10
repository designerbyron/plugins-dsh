import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runAction } from '../lib/api.mjs';
import { emptyState, loadState, saveState } from '../lib/state.mjs';

const OLD = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607';
const OTHER = '9c8b7a65-4321-4fed-8cba-0987654321fe';
const NOW = '2026-11-09T03:59:11.645Z';

function manifestText(projectId) {
  return `${JSON.stringify({ schema: 'lifecode-skill-center/project', schemaVersion: 1, projectId, registeredAt: NOW }, null, 2)}\n`;
}

/** Centro en caja de arena con el proyecto `legacy-...` ya registrado y, opcionalmente, con manifiesto. */
function registeredProject({ label = 'fork', version = 3, withManifest = true, uuid = OLD } = {}) {
  const root = mkdtempSync(join(tmpdir(), `${label}-`));
  saveState(root, { ...emptyState(NOW), schemaVersion: version }, { now: NOW });
  const cwd = mkdtempSync(join(tmpdir(), `${label}-ws-`));
  const dshRoot = join(cwd, '.dsh');
  mkdirSync(dshRoot, { recursive: true });
  const manifestPath = join(dshRoot, 'lifecode-skill-center.json');
  if (withManifest === true) writeFileSync(manifestPath, manifestText(uuid), 'utf8');

  const state = loadState(root).state;
  const projectId = 'proyecto-de-prueba';
  state.projects[projectId] = {
    id: projectId,
    name: 'proyecto de prueba',
    cwd,
    createdAt: NOW,
    updatedAt: NOW,
    note: '',
    ...(typeof uuid === 'string' ? { uuid } : {}),
  };
  saveState(root, state, { now: NOW });
  const registry = { list: () => [{ id: 'ws-1', path: cwd, title: 'proyecto de prueba' }] };
  return { root, cwd, dshRoot, manifestPath, projectId, registry };
}

test('bifurcar crea una identidad nueva, archiva la anterior y no hereda asignaciones', () => {
  const box = registeredProject();
  const result = runAction({
    root: box.root,
    action: 'identity-fork',
    actor: 'human',
    registry: box.registry,
    now: NOW,
    payload: { projectId: box.projectId, cwd: box.cwd },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.previousProjectId, box.projectId);
  assert.match(result.projectId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(result.projectId, OLD);

  const stored = loadState(box.root).state;
  assert.equal(Object.keys(stored.projects).length, 2, 'el proyecto anterior sigue registrado');
  assert.equal(stored.projects[result.projectId].uuid, result.projectId);
  assert.equal(stored.projects[result.projectId].forkedFrom, box.projectId);
  assert.equal(stored.projects[box.projectId].uuid, OLD, 'la identidad anterior no se toca');
  assert.equal(stored.assignments[result.projectId], undefined, 'nada se hereda');

  const published = JSON.parse(readFileSync(box.manifestPath, 'utf8'));
  assert.equal(published.projectId, result.projectId);
  assert.ok(result.archivedFile !== null, 'la identidad anterior queda archivada');
  assert.equal(existsSync(join(box.dshRoot, result.archivedFile)), true);
  assert.equal(readFileSync(join(box.dshRoot, result.archivedFile), 'utf8'), manifestText(OLD));

  const operation = stored.operations[result.operationId];
  assert.equal(operation.kind, 'fork-project');
  assert.equal(operation.uuid, result.projectId);
  assert.equal(stored.events.filter((event) => event.type === 'project.forked').length, 1);
  assert.equal(stored.events.find((event) => event.type === 'project.forked').actor, 'human');
});

test('bifurcar acepta un UUID nuevo explícito y rechaza uno que ya existe', () => {
  const box = registeredProject({ label: 'fork-explicit' });
  const explicit = runAction({
    root: box.root,
    action: 'identity-fork',
    actor: 'human',
    registry: box.registry,
    now: NOW,
    payload: { projectId: box.projectId, cwd: box.cwd, newProjectId: OTHER },
  });
  assert.equal(explicit.ok, true, explicit.message);
  assert.equal(explicit.projectId, OTHER);

  const repeated = runAction({
    root: box.root,
    action: 'identity-fork',
    actor: 'human',
    registry: box.registry,
    now: NOW,
    payload: { projectId: box.projectId, cwd: box.cwd, newProjectId: OTHER },
  });
  assert.equal(repeated.ok, false);
  assert.equal(repeated.code, 'exists');
});

test('la IA no puede bifurcar y en v2 la operación ni se intenta', () => {
  const box = registeredProject({ label: 'fork-auth' });
  const byAi = runAction({
    root: box.root,
    action: 'identity-fork',
    actor: 'ai',
    registry: box.registry,
    now: NOW,
    payload: { projectId: box.projectId, cwd: box.cwd },
  });
  assert.equal(byAi.code, 'approval-required');
  assert.equal(loadState(box.root).state.events.length, 0);

  const v2 = registeredProject({ label: 'fork-v2', version: 2 });
  const before = loadState(v2.root).sha256;
  const rejected = runAction({
    root: v2.root,
    action: 'identity-fork',
    actor: 'human',
    registry: v2.registry,
    now: NOW,
    payload: { projectId: v2.projectId, cwd: v2.cwd },
  });
  assert.equal(rejected.code, 'migration-required');
  assert.equal(rejected.status, 409);
  assert.equal(loadState(v2.root).sha256, before, 'v2 no escribe ni un byte');
});

test('sin manifiesto legible no hay nada que bifurcar', () => {
  const box = registeredProject({ label: 'fork-missing', withManifest: false });
  const result = runAction({
    root: box.root,
    action: 'identity-fork',
    actor: 'human',
    registry: box.registry,
    now: NOW,
    payload: { projectId: box.projectId, cwd: box.cwd },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'fork-source-missing');
  assert.equal(loadState(box.root).state.events.length, 0);
});

test('el manifiesto de la carpeta tiene que ser el de la identidad registrada', () => {
  const box = registeredProject({ label: 'fork-mismatch' });
  writeFileSync(box.manifestPath, manifestText(OTHER), 'utf8');
  const result = runAction({
    root: box.root,
    action: 'identity-fork',
    actor: 'human',
    registry: box.registry,
    now: NOW,
    payload: { projectId: box.projectId, cwd: box.cwd },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'fork-source-mismatch');
  assert.equal(JSON.parse(readFileSync(box.manifestPath, 'utf8')).projectId, OTHER, 'no se toca la carpeta');
});

test('bifurcar exige identidad registrada y la carpeta correcta', () => {
  const box = registeredProject({ label: 'fork-validation' });
  const unknown = runAction({
    root: box.root,
    action: 'identity-fork',
    actor: 'human',
    registry: box.registry,
    now: NOW,
    payload: { projectId: 'no-existe', cwd: box.cwd },
  });
  assert.equal(unknown.code, 'unknown-project');

  const wrongPath = runAction({
    root: box.root,
    action: 'identity-fork',
    actor: 'human',
    registry: box.registry,
    now: NOW,
    payload: { projectId: box.projectId, cwd: mkdtempSync(join(tmpdir(), 'otra-')) },
  });
  assert.equal(wrongPath.code, 'path-mismatch');

  const noId = runAction({ root: box.root, action: 'identity-fork', actor: 'human', registry: box.registry, now: NOW, payload: { cwd: box.cwd } });
  assert.equal(noId.code, 'invalid-project-id');
});

test('repetir la bifurcación no duplica la identidad nueva', () => {
  const box = registeredProject({ label: 'fork-repeat' });
  const first = runAction({
    root: box.root,
    action: 'identity-fork',
    actor: 'human',
    registry: box.registry,
    now: NOW,
    payload: { projectId: box.projectId, cwd: box.cwd },
  });
  assert.equal(first.ok, true, first.message);
  const again = runAction({
    root: box.root,
    action: 'identity-fork',
    actor: 'human',
    registry: box.registry,
    now: NOW,
    payload: { projectId: box.projectId, cwd: box.cwd },
  });
  assert.equal(again.ok, false, 'la carpeta ya es la identidad nueva');
  assert.equal(loadState(box.root).state.events.filter((event) => event.type === 'project.forked').length, 1);
});

test('la bifurcación no deja temporales ni bloqueos', () => {
  const box = registeredProject({ label: 'fork-clean' });
  const result = runAction({
    root: box.root,
    action: 'identity-fork',
    actor: 'human',
    registry: box.registry,
    now: NOW,
    payload: { projectId: box.projectId, cwd: box.cwd },
  });
  assert.equal(result.ok, true, result.message);
  const leftovers = readdirSync(box.dshRoot).filter((name) => name.startsWith('.lifecode-tmp-'));
  assert.deepEqual(leftovers, []);
});
