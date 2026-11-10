/**
 * Directiva §6 · evidencia de aplicación, probada en el producto.
 *
 * Lo que se mide:
 *   1. declarar una aplicación escribe `skill.applied` con su nota y su actor;
 *   2. sin nota no hay declaración (`note-required`) y el estado no cambia;
 *   3. una skill inexistente devuelve `missing-skill`;
 *   4. los indicadores separan entregas de aplicaciones y cuentan la brecha
 *      (`deliveries.withoutDeclaration`) sólo con entregas de skills no declaradas;
 *   5. leer los indicadores no escribe el almacén.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runAction, buildSnapshot } from '../lib/api.mjs';
import { centerFile } from '../lib/state.mjs';
import { tempProject, tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';

const DESCRIPTION = 'Comprobar un despliegue de DSH antes de darlo por bueno, con evidencia anotada y sin suponer nada.';
const WHEN = 'Cuando haya que verificar un despliegue real y no exista todavía evidencia del resultado';
const BODY = [
  '# Procedimiento',
  '',
  'Revisa el despliegue y anota la evidencia de cada comprobación, sin suponer que algo pasó porque el comando terminó sin error.',
  '',
  '# Evidencia',
  '',
  'Deja la salida de las comprobaciones en la nota y di explícitamente qué no pudiste verificar.',
].join('\n');

function prepare() {
  const root = autonomyRoot('lsc-aplicaciones');
  const created = runAction({
    root,
    action: 'create',
    actor: 'human',
    now: NOW,
    payload: {
      title: 'Comprobar un despliegue',
      description: DESCRIPTION,
      whenToUse: WHEN,
      body: BODY,
      tags: ['despliegue'],
    },
  });
  assert.equal(created.ok, true, `la skill de prueba se crea (${created.code ?? 'ok'})`);
  const project = tempProject('proyecto-aplicaciones');
  runAction({ root, action: 'register-project', actor: 'human', now: NOW, payload: { cwd: project } });
  const snapshot = buildSnapshot({ root, now: NOW });
  const projectId = snapshot.projects[0].id;
  return { root, skillId: created.id, projectId };
}

function bytesOf(root) {
  return readFileSync(centerFile(root));
}

test('declarar una aplicación escribe el evento con nota y actor', () => {
  const { root, skillId, projectId } = prepare();
  const before = bytesOf(root).length;
  const declared = runAction({
    root,
    action: 'declare-application',
    actor: 'human',
    now: NOW,
    payload: { skillId, projectId, note: 'Apliqué la lista de comprobaciones al despliegue de staging.' },
  });
  assert.equal(declared.ok, true);
  const document = JSON.parse(bytesOf(root).toString('utf8'));
  const event = document.events.at(-1);
  assert.equal(event.type, 'skill.applied');
  assert.equal(event.skillId, skillId);
  assert.equal(event.actor, 'human');
  assert.match(event.note, /staging/);
  assert.ok(bytesOf(root).length > before, 'el diario creció');
});

test('una declaración sin nota no se acepta y no toca el estado', () => {
  const { root, skillId } = prepare();
  const before = bytesOf(root);
  const refused = runAction({ root, action: 'declare-application', actor: 'ai', now: NOW, payload: { skillId, note: '   ' } });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'note-required');
  assert.deepEqual(bytesOf(root), before);
});

test('una skill inexistente no se puede declarar', () => {
  const { root } = prepare();
  const refused = runAction({
    root,
    action: 'declare-application',
    actor: 'human',
    now: NOW,
    payload: { skillId: 'no-existe', note: 'una nota suficientemente larga' },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'missing-skill');
});

test('los indicadores separan entregas de aplicaciones y no inventan la brecha', () => {
  const { root, skillId } = prepare();
  const before = buildSnapshot({ root, now: NOW }).insights;
  assert.equal(before.applications.total, 0);
  assert.equal(before.deliveries.withoutDeclaration, before.deliveries.total, 'sin declaraciones toda entrega está sin declarar');

  runAction({
    root,
    action: 'declare-application',
    actor: 'human',
    now: NOW,
    payload: { skillId, note: 'La apliqué al despliegue del proyecto de pruebas.' },
  });
  const after = buildSnapshot({ root, now: NOW }).insights;
  assert.equal(after.applications.total, 1);
  assert.equal(after.applications.bySkill[0].skillId, skillId);
  assert.equal(after.deliveries.withoutDeclaration, 0, 'la única skill entregada ya está declarada');
  assert.match(after.definitions.applications.limits, /declaración/);
});

test('leer los indicadores no escribe el almacén', () => {
  const { root } = prepare();
  const before = bytesOf(root);
  buildSnapshot({ root, now: NOW });
  assert.deepEqual(bytesOf(root), before);
});
