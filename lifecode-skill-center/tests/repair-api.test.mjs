import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runAction } from '../lib/api.mjs';
import { emptyState, loadState, saveState } from '../lib/state.mjs';

const UUID = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607';
const OTHER = '9c8b7a65-4321-4fed-8cba-0987654321fe';
const NOW = '2026-11-09T03:59:11.645Z';

/** Centro v3 (política de identidad activa) sobre una caja de arena, sin tocar el almacén real. */
function v3Store(label) {
  const root = mkdtempSync(join(tmpdir(), `repair-${label}-`));
  saveState(root, { ...emptyState(NOW), schemaVersion: 3 }, { now: NOW });
  return root;
}

/** Workspace con un `.dsh` y, si se pide, un manifiesto inválido en el nombre canónico. */
function workspace(contents = null) {
  const cwd = mkdtempSync(join(tmpdir(), 'repair-ws-'));
  const dshRoot = join(cwd, '.dsh');
  mkdirSync(dshRoot, { recursive: true });
  if (contents !== null) writeFileSync(join(dshRoot, 'lifecode-skill-center.json'), contents, 'utf8');
  return { cwd, dshRoot, manifestPath: join(dshRoot, 'lifecode-skill-center.json') };
}

test('reparar un manifiesto inválido lo sustituye, deja comprobante y evento en el centro', () => {
  const root = v3Store('invalid');
  const ws = workspace('{ esto no es json');
  const result = runAction({
    root,
    action: 'repair',
    actor: 'human',
    now: NOW,
    payload: { projectId: UUID, cwd: ws.cwd, branch: 'invalid' },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.branch, 'invalid');
  assert.equal(result.resumed, false);

  const stored = loadState(root).state;
  const operation = stored.operations[result.operationId];
  assert.ok(operation, 'el comprobante existe');
  assert.equal(operation.kind, 'repair-manifest');
  assert.equal(operation.uuid, UUID);
  assert.equal(operation.status, 'registered');
  assert.equal(operation.targetSha256, result.manifestSha256);

  const anchored = stored.events.filter((entry) => entry.type === 'project.manifest-anchored');
  assert.equal(anchored.length, 1);
  assert.equal(anchored[0].projectId, UUID);

  const published = JSON.parse(readFileSync(ws.manifestPath, 'utf8'));
  assert.equal(published.projectId, UUID);
  const quarantined = readdirSync(ws.dshRoot).filter((name) => name.includes('manifest-invalid'));
  assert.equal(quarantined.length, 1, 'el archivo inválido queda como evidencia');
});

test('reparar dos veces la misma intención reanuda sin duplicar evidencia ni eventos', () => {
  const root = v3Store('resume');
  const ws = workspace('{ roto');
  const payload = { projectId: UUID, cwd: ws.cwd, branch: 'invalid' };
  const first = runAction({ root, action: 'repair', actor: 'human', now: NOW, payload });
  assert.equal(first.ok, true, first.message);
  const quarantinesAfterFirst = readdirSync(ws.dshRoot).filter((name) => name.includes('manifest-invalid'));

  const second = runAction({ root, action: 'repair', actor: 'human', now: NOW, payload });
  assert.equal(second.ok, true, second.message);
  assert.equal(second.resumed, true);
  assert.equal(second.quarantineFile, null);

  const quarantinesAfterSecond = readdirSync(ws.dshRoot).filter((name) => name.includes('manifest-invalid'));
  assert.deepEqual(quarantinesAfterSecond, quarantinesAfterFirst, 'no se crea una segunda cuarentena');
});

test('la rama de manifiesto ausente publica sin cuarentena', () => {
  const root = v3Store('missing');
  const ws = workspace(null);
  const result = runAction({
    root,
    action: 'repair',
    actor: 'human',
    now: NOW,
    payload: { projectId: OTHER, cwd: ws.cwd, branch: 'missing' },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.branch, 'missing');
  assert.equal(result.quarantineFile, null);
  assert.equal(readdirSync(ws.dshRoot).filter((name) => name.includes('manifest-invalid')).length, 0);
  assert.equal(JSON.parse(readFileSync(ws.manifestPath, 'utf8')).projectId, OTHER);
});

test('la reparación exige persona y no la puede pedir la IA', () => {
  const root = v3Store('ai');
  const ws = workspace('{ roto');
  const before = readFileSync(ws.manifestPath, 'utf8');
  const result = runAction({
    root,
    action: 'repair',
    actor: 'ai',
    now: NOW,
    payload: { projectId: UUID, cwd: ws.cwd, branch: 'invalid' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'approval-required');
  assert.equal(readFileSync(ws.manifestPath, 'utf8'), before, 'no se toca el archivo del proyecto');
  assert.equal(loadState(root).state.operations, undefined);
});

test('un identificador que no es UUID v4 se rechaza antes de escribir', () => {
  const root = v3Store('uuid');
  const ws = workspace('{ roto');
  const result = runAction({
    root,
    action: 'repair',
    actor: 'human',
    now: NOW,
    payload: { projectId: 'no-es-un-uuid', cwd: ws.cwd, branch: 'invalid' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-project-id');
  assert.equal(readFileSync(ws.manifestPath, 'utf8'), '{ roto');
  assert.equal(loadState(root).state.operations, undefined);
});

test('un centro v2 responde migration-required y no escribe nada', () => {
  const root = mkdtempSync(join(tmpdir(), 'repair-v2-'));
  saveState(root, { ...emptyState(NOW), schemaVersion: 2 }, { now: NOW });
  const ws = workspace('{ roto');
  const result = runAction({
    root,
    action: 'repair',
    actor: 'human',
    now: NOW,
    payload: { projectId: UUID, cwd: ws.cwd, branch: 'invalid' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'migration-required');
  assert.equal(readFileSync(ws.manifestPath, 'utf8'), '{ roto');
  assert.equal(loadState(root).state.operations, undefined);
});

test('el clonado de skills sigue funcionando: `fork` no es una operación de identidad', () => {
  const root = mkdtempSync(join(tmpdir(), 'repair-fork-'));
  saveState(root, { ...emptyState(NOW), schemaVersion: 2 }, { now: NOW });
  const created = runAction({
    root,
    action: 'create',
    actor: 'ai',
    now: NOW,
    payload: {
      id: 'skill-base',
      description: 'Base para comprobar que el clonado de skills no lo intercepta la puerta de identidad',
      whenToUse: 'Cuando se comprueba que fork sigue siendo una operación de la biblioteca de skills',
      body: '## Procedimiento\n\nDescribe el procedimiento con suficiente detalle para pasar la compuerta de calidad: qué se lee, qué se ejecuta y qué se comprueba antes de dar nada por bueno.\n\n## Evidencia\n\nDeja la evidencia medida, la ruta inspeccionada y el resultado exacto; si algo no está verificado, dilo.',
      tags: ['pruebas'],
    },
  });
  assert.equal(created.ok, true, created.message);
  const forked = runAction({
    root,
    action: 'fork',
    actor: 'human',
    now: NOW,
    payload: { sourceId: 'skill-base', id: 'skill-copia', note: 'copia de prueba' },
  });
  assert.equal(forked.ok, true, forked.message);
  const stored = loadState(root).state;
  assert.equal(stored.skills['skill-copia'].origin.kind, 'fork');
});

test('un fallo de publicación no deja comprobante, ni evento, ni toca el canónico', () => {
  // Medido: con un canónico ocupado (aquí un inválido en la ruta del manifiesto) y la rama `missing`,
  // la publicación no puede completarse. Antes la prueba toleraba el éxito y sólo comprobaba el caso
  // que ya se daba; ahora afirma la condición de fallo antes de mirar el estado.
  const root = v3Store('fail');
  const ws = workspace('{ roto');
  const before = readFileSync(ws.manifestPath, 'utf8');
  const eventsBefore = loadState(root).state.events.length;
  const result = runAction({
    root,
    action: 'repair',
    actor: 'human',
    now: NOW,
    payload: { projectId: UUID, cwd: ws.cwd, branch: 'missing' },
  });
  assert.equal(result.ok, false, 'la publicación tiene que fallar en este escenario');
  assert.equal(result.code, 'exists', 'el motivo es que el destino ya existe');
  const stored = loadState(root).state;
  assert.equal(stored.operations, undefined, 'sin éxito no hay comprobante');
  assert.equal(stored.events.length, eventsBefore, 'sin éxito no hay evento');
  assert.equal(readFileSync(ws.manifestPath, 'utf8'), before, 'el canónico queda como estaba');
});

test('una reparación que se niega no deja comprobante ni evento y no toca el canónico', () => {
  // La rama `invalid` exige un manifiesto inválido: con uno válido se niega (repair-branch-mismatch).
  // Esa negativa es la condición del nombre de la prueba, y se afirma sin ramas.
  const root = v3Store('refused');
  const valid = JSON.stringify({ schema: 'lifecode-skill-center/project', schemaVersion: 1, projectId: UUID, registeredAt: NOW });
  const ws = workspace(valid);
  const before = readFileSync(ws.manifestPath, 'utf8');
  const eventsBefore = loadState(root).state.events.length;
  const result = runAction({
    root,
    action: 'repair',
    actor: 'human',
    now: NOW,
    payload: { projectId: UUID, cwd: ws.cwd, branch: 'invalid' },
  });
  assert.equal(result.ok, false, 'la reparación tiene que negarse');
  assert.equal(result.code, 'repair-branch-mismatch');
  const stored = loadState(root).state;
  assert.equal(stored.operations, undefined, 'sin éxito no hay comprobante');
  assert.equal(stored.events.length, eventsBefore, 'sin éxito no hay evento');
  assert.equal(readFileSync(ws.manifestPath, 'utf8'), before, 'el canónico válido queda intacto');
});
