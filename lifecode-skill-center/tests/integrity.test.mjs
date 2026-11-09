/* S4-A — integridad del almacén: un centro corrupto no se lee como vacío ni se sobrescribe. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildSnapshot, handleApiRequest, runAction } from '../lib/api.mjs';
import { centerTools } from '../lib/tools.mjs';
import { skillProviderFor } from '../lib/provider.mjs';
import {
  archiveCorruptStore,
  centerFile,
  functionalSignature,
  loadState,
  restoreStore,
  withState,
} from '../lib/state.mjs';
import { candidate, tempProject, tempRoot } from './helpers.mjs';

const SHA = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Un almacén válido de verdad, creado por el producto (nunca a mano). */
function healthyStore() {
  const root = tempRoot('lsc-s4a');
  const project = tempProject('proyecto', root);
  const created = runAction({ root, action: 'create', payload: candidate(), actor: 'ai', cwd: project, now: '2026-11-01T10:00:00.000Z' });
  assert.equal(created.ok, true);
  const registered = runAction({ root, action: 'register-project', payload: { cwd: project }, actor: 'human', now: '2026-11-01T10:00:30.000Z' });
  assert.equal(registered.ok, true);
  const projectId = registered.project.id;
  const toggled = runAction({ root, action: 'toggle', payload: { projectId, skillId: created.id, enabled: true }, actor: 'human', cwd: project, now: '2026-11-01T10:01:00.000Z' });
  assert.equal(toggled.ok, true, JSON.stringify(toggled));
  return { root, project, projectId, skillId: created.id };
}

/** Escribe bytes literales en `center.json` (equivale a un archivo dañado en disco). */
function writeRaw(root, text) {
  mkdirSync(root, { recursive: true });
  writeFileSync(centerFile(root), text);
}

function snapshotOf(root) {
  return buildSnapshot({ root, cwd: '', scan: false, now: '2026-11-02T10:00:00.000Z' });
}

test('un JSON truncado es unreadable, no una biblioteca vacía', () => {
  const { root } = healthyStore();
  const original = readFileSync(centerFile(root));
  writeRaw(root, original.toString('utf8').slice(0, 40));
  const loaded = loadState(root);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.integrity, 'unreadable');
  assert.equal(loaded.sha256, SHA(readFileSync(centerFile(root))));
  assert.equal(loaded.size, readFileSync(centerFile(root)).length);
});

for (const [label, text] of [
  ['{}', '{}'],
  ['[]', '[]'],
  ['null', 'null'],
  ['{"skills":"x"}', '{"skills":"x","projects":{},"assignments":{},"improvements":{},"events":[]}'],
]) {
  test(`${label} es invalid-shape`, () => {
    const root = tempRoot('lsc-s4a-shape');
    writeRaw(root, text);
    const loaded = loadState(root);
    assert.equal(loaded.ok, false);
    assert.equal(loaded.integrity, 'invalid-shape');
    assert.equal(loaded.state.skills && Object.keys(loaded.state.skills).length, 0);
  });
}

test('un documento de una versión futura no se acepta como válido ni se migra', () => {
  const root = tempRoot('lsc-s4a-future');
  writeRaw(root, JSON.stringify({ schemaVersion: 99, skills: {}, projects: {}, assignments: {}, improvements: {}, events: [] }));
  const before = readFileSync(centerFile(root));
  const loaded = loadState(root);
  assert.equal(loaded.integrity, 'future-version');
  const mutation = runAction({ root, action: 'create', payload: candidate(), actor: 'ai', now: '2026-11-02T10:00:00.000Z' });
  assert.equal(mutation.ok, false);
  assert.equal(mutation.code, 'store-unreadable');
  assert.deepEqual(readFileSync(centerFile(root)), before);
});

test('una mutación sobre cada estado ilegible devuelve store-unreadable y no escribe', () => {
  const cases = [
    ['unreadable', '{"schemaVersion":1,"skills":{'],
    ['invalid-shape', '[]'],
    ['future-version', JSON.stringify({ schemaVersion: 9, skills: {}, projects: {}, assignments: {}, improvements: {}, events: [] })],
  ];
  for (const [expected, text] of cases) {
    const root = tempRoot('lsc-s4a-reject');
    writeRaw(root, text);
    const before = readFileSync(centerFile(root));
    const createdAt = statSync(centerFile(root)).mtimeMs;
    const result = runAction({ root, action: 'create', payload: candidate(), actor: 'ai', now: '2026-11-02T10:00:00.000Z' });
    assert.equal(result.ok, false, expected);
    assert.equal(result.code, 'store-unreadable', expected);
    assert.equal(result.integrity.status, expected);
    // bytes, tamaño, hash y mtime intactos
    assert.deepEqual(readFileSync(centerFile(root)), before, expected);
    assert.equal(statSync(centerFile(root)).mtimeMs, createdAt, expected);
  }
});

test('el rechazo no deja .tmp, ni candado, ni materializaciones, ni eventos', () => {
  const { root, project } = healthyStore();
  writeRaw(root, 'no soy json');
  const before = readdirSync(root, { recursive: true }).map(String).sort();
  const result = runAction({ root, action: 'toggle', payload: { projectId: Object.keys(loadState(root).state.projects ?? {})[0] ?? '', skillId: 'x', enabled: false }, actor: 'human', cwd: project, now: '2026-11-03T10:00:00.000Z' });
  assert.equal(result.ok, false);
  const after = readdirSync(root, { recursive: true }).map(String).sort();
  assert.deepEqual(after, before);
  assert.equal(after.some((entry) => entry.endsWith('.tmp') || entry.endsWith('.lock')), false);
});

test('la instantánea dice que no es legible en vez de fingir cero skills', () => {
  const { root } = healthyStore();
  writeRaw(root, '{"schemaVersion":1,');
  const snapshot = snapshotOf(root);
  assert.equal(snapshot.readable, false);
  assert.equal(snapshot.integrity.status, 'unreadable');
  assert.match(snapshot.integrity.sha256, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.storeError !== null, true);
});

test('el proveedor no entrega una biblioteca vacía como si fuera válida', async () => {
  const { root, project, skillId } = healthyStore();
  const healthy = await skillProviderFor({ root }).list({ cwd: project });
  assert.equal(healthy.length, 1, skillId);
  const diagnostics = [];
  writeRaw(root, '{ roto');
  const provider = skillProviderFor({ root, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
  assert.deepEqual(await provider.list({ cwd: project }), []);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'store-unreadable');
  assert.equal(diagnostics[0].integrity, 'unreadable');
});

test('las cuatro herramientas comunican que el centro no se puede leer', () => {
  const { root, project } = healthyStore();
  writeRaw(root, '{"schemaVersion":1,"skills":');
  const [search, create, improve, status] = centerTools({ root });
  const exec = { agent: { session: { header: { cwd: project } } } };
  assert.equal(search.execute({ query: 'cualquier cosa' }, exec).status, 'unreadable');
  assert.equal(create.execute({ description: 'x'.repeat(80), whenToUse: 'y'.repeat(30), body: `## A\n\n${'z'.repeat(220)}` }, exec).status, 'unreadable');
  assert.equal(improve.execute({ skillId: 'algo', rationale: 'r'.repeat(30) }, exec).status, 'unreadable');
  const reported = status.execute({}, exec);
  assert.equal(reported.status, 'unreadable');
  assert.match(reported.summary, /cannot be read/);
  assert.match(reported.summary, /NOT done|left untouched/);
});

test('la restauración con hash correcto funciona y deja copia verificable', () => {
  const { root } = healthyStore();
  const backup = readFileSync(centerFile(root));
  writeRaw(root, '{"schemaVersion":1,"skil');
  const corrupted = readFileSync(centerFile(root).replace(/center\.json$/, 'center.json'));
  const source = join(root, 'copia-valida.json');
  writeFileSync(source, backup);
  const restored = restoreStore(root, { sourcePath: source, expectedSha256: SHA(backup), now: '2026-11-04T10:00:00.000Z' });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(restored.sha256, SHA(backup));
  assert.equal(loadState(root).integrity, 'ok');
  // el documento dañado se conserva byte a byte
  assert.deepEqual(readFileSync(restored.archivedAs), corrupted);
  assert.equal(restored.preservedSha256, SHA(corrupted));
});

test('la restauración con hash incorrecto falla y no toca el original', () => {
  const { root } = healthyStore();
  const backup = readFileSync(centerFile(root));
  writeRaw(root, '{ roto');
  const before = readFileSync(centerFile(root));
  const source = join(root, 'copia.json');
  writeFileSync(source, backup);
  const restored = restoreStore(root, { sourcePath: source, expectedSha256: 'f'.repeat(64), now: '2026-11-04T10:00:00.000Z' });
  assert.equal(restored.ok, false);
  assert.equal(restored.code, 'hash-mismatch');
  assert.deepEqual(readFileSync(centerFile(root)), before);
});

test('si no se puede preservar el original, la restauración aborta sin tocarlo', () => {
  const { root } = healthyStore();
  const backup = readFileSync(centerFile(root));
  writeRaw(root, '{ roto');
  const before = readFileSync(centerFile(root));
  const source = join(root, 'copia.json');
  writeFileSync(source, backup);
  // La costura `archive` fuerza el único fallo que no se puede provocar con permisos en Windows.
  const restored = restoreStore(root, {
    sourcePath: source,
    now: '2026-11-04T10:00:00.000Z',
    archive: () => ({ ok: false, code: 'archive-failed', message: 'simulado: no hay sitio para la copia' }),
  });
  assert.equal(restored.ok, false);
  assert.equal(restored.code, 'archive-failed');
  assert.deepEqual(readFileSync(centerFile(root)), before);
});

test('un almacén válido sigue aceptando mutaciones y un no-op no escribe', () => {
  const { root } = healthyStore();
  const before = loadState(root);
  const noop = withState(root, () => ({ ok: true }), { now: '2026-11-05T10:00:00.000Z' });
  assert.equal(noop.ok, true);
  assert.equal(noop.saved, false);
  assert.equal(loadState(root).sha256, before.sha256);
  const created = runAction({ root, action: 'create', payload: candidate({ id: 'otra-skill-de-prueba', description: candidate().description }), actor: 'ai', now: '2026-11-05T11:00:00.000Z' });
  assert.equal(created.ok, true);
  assert.equal(loadState(root).integrity, 'ok');
  assert.equal(functionalSignature(loadState(root).state) !== functionalSignature(before.state), true);
});

test('un almacén ausente se puede inicializar con la primera operación', () => {
  const root = tempRoot('lsc-s4a-missing');
  assert.equal(loadState(root).integrity, 'missing');
  const created = runAction({ root, action: 'create', payload: candidate(), actor: 'ai', now: '2026-11-06T10:00:00.000Z' });
  assert.equal(created.ok, true);
  assert.equal(loadState(root).integrity, 'ok');
});

test('la API responde 409 cuando la mutación choca con un centro ilegible', () => {
  const root = tempRoot('lsc-s4a-409');
  writeRaw(root, '{ roto');
  const answer = handleApiRequest({
    root,
    method: 'POST',
    pathname: '/lifecode-skill-center/api/state',
    body: { action: 'create', payload: candidate() },
    now: '2026-11-07T10:00:00.000Z',
  });
  assert.equal(answer.status, 409);
  assert.equal(answer.body.code, 'store-unreadable');
  assert.equal(answer.body.integrity.status, 'unreadable');
});

test('archivar conserva bytes y no pisa una preservación anterior', () => {
  const { root } = healthyStore();
  writeRaw(root, '{ roto');
  const first = archiveCorruptStore(root, { now: '2026-11-04T10:00:00.000Z' });
  assert.equal(first.ok, true);
  const second = archiveCorruptStore(root, { now: '2026-11-04T10:00:00.000Z' });
  assert.equal(second.ok, true);
  assert.notEqual(second.archivedAs, first.archivedAs);
  assert.deepEqual(readFileSync(first.archivedAs), readFileSync(centerFile(root)));
});
