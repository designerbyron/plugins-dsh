import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runAction } from '../lib/api.mjs';
import { emptyState, loadState, saveState } from '../lib/state.mjs';

const NOW = '2026-11-09T03:59:11.645Z';
const UUID = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607';
const OTHER = '9c8b7a65-4321-4fed-8cba-0987654321fe';

function box({ label = 'ops', version = 3, uuid = null, manifest = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), `${label}-`));
  saveState(root, { ...emptyState(NOW), schemaVersion: version }, { now: NOW });
  const cwd = mkdtempSync(join(tmpdir(), `${label}-ws-`));
  mkdirSync(join(cwd, '.dsh'), { recursive: true });
  const manifestPath = join(cwd, '.dsh', 'lifecode-skill-center.json');
  if (manifest !== null) writeFileSync(manifestPath, manifest, 'utf8');
  const state = loadState(root).state;
  state.projects['proyecto-x'] = {
    id: 'proyecto-x',
    name: 'proyecto x',
    cwd,
    createdAt: NOW,
    updatedAt: NOW,
    note: '',
    ...(uuid === null ? {} : { uuid }),
  };
  saveState(root, state, { now: NOW });
  const registry = { list: () => [{ id: 'ws-x', path: cwd, title: 'proyecto x' }] };
  return { root, cwd, manifestPath, registry };
}

function manifestText(projectId) {
  return `${JSON.stringify({ schema: 'lifecode-skill-center/project', schemaVersion: 1, projectId, registeredAt: NOW }, null, 2)}\n`;
}

test('adoptar una identidad heredada le asigna UUID y publica su manifiesto', () => {
  const b = box({ label: 'adopt' });
  const result = runAction({ root: b.root, action: 'identity-adopt', actor: 'human', registry: b.registry, now: NOW, payload: { projectId: 'proyecto-x', cwd: b.cwd } });
  assert.equal(result.ok, true, result.message);
  assert.match(result.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const stored = loadState(b.root).state;
  assert.equal(stored.projects['proyecto-x'].uuid, result.uuid);
  assert.equal(stored.projects['proyecto-x'].adoptedAt, NOW);
  assert.equal(JSON.parse(readFileSync(b.manifestPath, 'utf8')).projectId, result.uuid);
  assert.equal(stored.events.filter((event) => event.type === 'project.adopted').length, 1);
  assert.equal(stored.operations[result.operationId].kind, 'adopt-manifest');
});

test('adoptar dos veces no crea un segundo manifiesto ni un segundo evento', () => {
  const b = box({ label: 'adopt-twice' });
  const first = runAction({ root: b.root, action: 'identity-adopt', actor: 'human', registry: b.registry, now: NOW, payload: { projectId: 'proyecto-x', cwd: b.cwd } });
  assert.equal(first.ok, true, first.message);
  const second = runAction({ root: b.root, action: 'identity-adopt', actor: 'human', registry: b.registry, now: NOW, payload: { projectId: 'proyecto-x', cwd: b.cwd } });
  assert.equal(second.ok, true, second.message);
  assert.equal(second.resumed, true);
  const stored = loadState(b.root).state;
  assert.equal(stored.events.filter((event) => event.type === 'project.adopted').length, 1);
  assert.equal(JSON.parse(readFileSync(b.manifestPath, 'utf8')).projectId, first.uuid);
});

test('adoptar una carpeta con el manifiesto de otra identidad es un conflicto de ruta', () => {
  const b = box({ label: 'adopt-conflict', manifest: manifestText(OTHER) });
  const result = runAction({ root: b.root, action: 'identity-adopt', actor: 'human', registry: b.registry, now: NOW, payload: { projectId: 'proyecto-x', cwd: b.cwd } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'path-conflict');
  assert.equal(JSON.parse(readFileSync(b.manifestPath, 'utf8')).projectId, OTHER, 'no se pisa la otra identidad');
});

test('adoptar un manifiesto dañado exige repararlo antes', () => {
  const b = box({ label: 'adopt-invalid', manifest: '{ roto' });
  const result = runAction({ root: b.root, action: 'identity-adopt', actor: 'human', registry: b.registry, now: NOW, payload: { projectId: 'proyecto-x', cwd: b.cwd } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'manifest-invalid');
  assert.equal(readFileSync(b.manifestPath, 'utf8'), '{ roto');
});

test('vincular un registro que ya tiene UUID publica ese mismo UUID', () => {
  const b = box({ label: 'link', uuid: UUID });
  const result = runAction({ root: b.root, action: 'identity-link', actor: 'human', registry: b.registry, now: NOW, payload: { projectId: 'proyecto-x', cwd: b.cwd } });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.uuid, UUID);
  const stored = loadState(b.root).state;
  assert.equal(stored.events.filter((event) => event.type === 'project.linked').length, 1);
  assert.equal(stored.operations[result.operationId].kind, 'link-manifest');
});

test('la IA no adopta ni vincula, y v2 no escribe nada', () => {
  const ai = box({ label: 'ops-ai' });
  const byAi = runAction({ root: ai.root, action: 'identity-adopt', actor: 'ai', registry: ai.registry, now: NOW, payload: { projectId: 'proyecto-x', cwd: ai.cwd } });
  assert.equal(byAi.code, 'approval-required');
  assert.equal(loadState(ai.root).state.events.length, 0);

  const v2 = box({ label: 'ops-v2', version: 2 });
  const before = loadState(v2.root).sha256;
  const rejected = runAction({ root: v2.root, action: 'identity-link', actor: 'human', registry: v2.registry, now: NOW, payload: { projectId: 'proyecto-x', cwd: v2.cwd } });
  assert.equal(rejected.code, 'migration-required');
  assert.equal(loadState(v2.root).sha256, before);
});
