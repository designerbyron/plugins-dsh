/*
 * Flujo de creación por IA (directiva §9): reintentar una petición no puede llenar la biblioteca de copias,
 * y una skill nueva tiene que avisar de los duplicados probables antes de que alguien la publique.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runAction } from '../lib/api.mjs';
import { loadState } from '../lib/state.mjs';
import { tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-02-01T00:00:00.000Z';

function body(text = 'Procedimiento con su evidencia correspondiente y sus dos secciones bien escritas.') {
  return [
    '## Procedimiento',
    '',
    text,
    '',
    '## Evidencia',
    '',
    'Adjunta la salida de las pruebas y el hash del fichero generado. Sin esa evidencia no se declara terminada.',
  ].join('\n');
}

function skillInput(overrides = {}) {
  return {
    id: 'revisa-un-plugin-antes-de-instalarlo',
    title: 'Revisa un plugin antes de instalarlo',
    description: 'Revisa estructura, pruebas y manifiesto de un plugin de DSH antes de instalarlo en un perfil de desarrollo.',
    whenToUse: 'Cuando vayas a instalar o actualizar un plugin de DSH y quieras evidencia antes de tocar el perfil.',
    tags: ['dsh', 'plugins'],
    body: body(),
    ...overrides,
  };
}

test('reintentar una creación con el mismo requestId devuelve la skill ya creada', () => {
  const root = autonomyRoot('lsc-idempotency');

  const opened = runAction({ root, action: 'request-skill', actor: 'human', payload: { text: 'necesito una revisión de plugins' }, now: NOW });
  assert.equal(opened.ok, true);
  const requestId = opened.id;

  const first = runAction({ root, action: 'create', actor: 'ai', payload: { ...skillInput(), requestId }, now: NOW });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.id, 'revisa-un-plugin-antes-de-instalarlo');

  const linked = runAction({ root, action: 'request-fulfill', actor: 'ai', payload: { requestId, skillId: first.id }, now: NOW });
  assert.equal(linked.ok, true, JSON.stringify(linked));

  const retry = runAction({ root, action: 'create', actor: 'ai', payload: { ...skillInput(), requestId }, now: NOW });
  assert.equal(retry.ok, true);
  assert.equal(retry.idempotent, true, 'un reintento no es una creación');
  assert.equal(retry.id, first.id);
  assert.match(String(retry.message), /ya tiene su skill/);

  const state = loadState(root).state;
  assert.equal(Object.keys(state.skills).length, 1, 'la biblioteca tiene una sola skill después del reintento');
  assert.equal(state.requests[requestId].status, 'fulfilled');
});

test('crear con un requestId desconocido no se confunde con un reintento', () => {
  const root = autonomyRoot('lsc-idempotency-unknown');
  const created = runAction({ root, action: 'create', actor: 'ai', payload: { ...skillInput(), requestId: 'req-inventado' }, now: NOW });
  assert.equal(created.ok, true);
  assert.equal(created.idempotent, undefined, 'sin petición previa cumplida, crear es crear');
  assert.equal(Object.keys(loadState(root).state.skills).length, 1);
});

test('una skill nueva avisa de los duplicados probables por título', () => {
  const root = autonomyRoot('lsc-duplicates');
  const first = runAction({ root, action: 'create', actor: 'human', payload: skillInput(), now: NOW });
  assert.equal(first.ok, true, JSON.stringify(first));

  const second = runAction({
    root,
    action: 'create',
    actor: 'human',
    payload: skillInput({ id: 'revisa-un-plugin-antes-de-instalar', title: 'Revisa un plugin antes de instalarlo ' }),
    now: NOW,
  });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.ok(Array.isArray(second.duplicates), 'la creación publica los duplicados probables');
  assert.equal(second.duplicates.length, 1);
  assert.equal(second.duplicates[0].id, first.id);
  assert.ok(second.duplicates[0].reasons.includes('mismo título'), 'la razón se explica, no se adivina');
});

test('una skill sin relación con la biblioteca no inventa duplicados', () => {
  const root = autonomyRoot('lsc-duplicates-none');
  runAction({ root, action: 'create', actor: 'human', payload: skillInput(), now: NOW });
  const other = runAction({
    root,
    action: 'create',
    actor: 'human',
    payload: skillInput({
      id: 'mide-el-tiempo-de-arranque-de-una-cola',
      title: 'Mide el tiempo de arranque de una cola',
      description: 'Mide cuánto tarda en arrancar una cola de trabajos y deja la curva de latencia con su método.',
      whenToUse: 'Cuando alguien sospeche que la cola tarda en arrancar y quiera números en vez de impresiones.',
      tags: ['colas', 'latencia'],
      body: body('Arranca la cola cinco veces con el mismo tamaño de lote y anota cada marca de tiempo en la misma tabla.'),
    }),
    now: NOW,
  });
  assert.equal(other.ok, true, JSON.stringify(other));
  assert.equal(other.duplicates, undefined, 'sin parecido no hay aviso');
});
