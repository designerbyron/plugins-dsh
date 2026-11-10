import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_EVENTS,
  appendEvent,
  centerFile,
  defaultRoot,
  emptyState,
  loadState,
  materializedRoot,
  normalizeState,
  recordDailyEvent,
  saveState,
  withState,
} from '../lib/state.mjs';
import { tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-11-08T12:00:00.000Z';

test('un almacén que no existe se lee como vacío, no como error', () => {
  const root = autonomyRoot();
  const loaded = loadState(root);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.exists, false);
  assert.deepEqual(loaded.state.skills, {});
  assert.deepEqual(loaded.state.events, []);
});

test('saveState escribe y loadState devuelve lo mismo', () => {
  const root = autonomyRoot();
  const state = emptyState(NOW);
  state.skills['una-skill'] = {
    id: 'una-skill',
    title: 'Una skill',
    description: 'algo',
    currentVersion: '1.0.0',
    versions: [{ version: '1.0.0', body: 'cuerpo' }],
  };
  const file = saveState(root, state, { now: NOW });
  assert.equal(file, centerFile(root));
  assert.ok(existsSync(file));
  const loaded = loadState(root);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.exists, true);
  assert.equal(loaded.state.skills['una-skill'].description, 'algo');
  assert.equal(loaded.state.skills['una-skill'].versions[0].version, '1.0.0');
  assert.equal(loaded.state.updatedAt, NOW);
});

test('un JSON corrupto no revienta: se informa y se devuelve un estado usable', () => {
  const root = autonomyRoot();
  writeFileSync(centerFile(root), '{ esto no es json', 'utf8');
  const loaded = loadState(root);
  assert.equal(loaded.ok, false);
  assert.ok(loaded.error);
  assert.deepEqual(loaded.state.events, []);
});

test('normalizeState aguanta basura sin lanzar y descarta lo que no puede cargar', () => {
  assert.deepEqual(normalizeState(null).skills, {});
  assert.deepEqual(normalizeState('texto').projects, {});
  const state = normalizeState({
    skills: {
      // Sin versiones no hay nada que el harness pueda cargar: la entrada no se conserva.
      'a-b': { versions: [] },
      // Una versión con cuerpo vacío no es una versión legible.
      'c-d': { versions: [{ version: '', body: '' }] },
      'e-f': { versions: [{ version: '1.0.0', body: 'cuerpo' }] },
    },
    events: 'no',
  });
  assert.equal(state.skills['a-b'], undefined);
  assert.equal(state.skills['c-d'], undefined);
  assert.equal(state.skills['e-f'].versions.length, 1);
  assert.deepEqual(state.events, []);
});

test('una mutación que lanza no guarda nada', () => {
  const root = autonomyRoot();
  assert.throws(() => withState(root, () => { throw new Error('boom'); }), /boom/);
  assert.equal(existsSync(centerFile(root)), false, 'una mutación fallida no debe dejar fichero');

  const good = withState(root, (state) => { state.projects['p-1'] = { id: 'p-1', cwd: 'C:/x' }; return { ok: true }; });
  assert.equal(good.ok, true);
  assert.equal(loadState(root).state.projects['p-1'].id, 'p-1');
});

test('appendEvent conserva TODOS los eventos (regresión: el guard confundía arrays con objetos)', () => {
  const root = autonomyRoot();
  withState(root, (state) => { appendEvent(state, { type: 'uno', skillId: 'a' }); });
  withState(root, (state) => { appendEvent(state, { type: 'dos', skillId: 'a' }); });
  withState(root, (state) => { appendEvent(state, { type: 'tres', skillId: 'b' }); });
  const loaded = loadState(root);
  assert.deepEqual(loaded.state.events.map((event) => event.type), ['uno', 'dos', 'tres']);
});

test('appendEvent recorta el diario al máximo y sella cada evento', () => {
  const state = emptyState(NOW);
  for (let index = 0; index < MAX_EVENTS + 5; index += 1) appendEvent(state, { type: 'x' });
  assert.equal(state.events.length, MAX_EVENTS);
  const last = state.events[state.events.length - 1];
  assert.ok(last.id.startsWith('ev-'));
  assert.ok(last.at);
  assert.equal(last.actor, 'human');
});

test('recordDailyEvent no repite el mismo evento el mismo día', () => {
  const state = emptyState(NOW);
  recordDailyEvent(state, { type: 'skill.loaded', skillId: 'a', projectId: 'p', day: '2026-11-08' });
  recordDailyEvent(state, { type: 'skill.loaded', skillId: 'a', projectId: 'p', day: '2026-11-08' });
  recordDailyEvent(state, { type: 'skill.loaded', skillId: 'a', projectId: 'p', day: '2026-11-09' });
  assert.equal(state.events.length, 2);
  assert.equal(state.events[0].at, '2026-11-08T00:00:00.000Z');
  assert.equal(state.events[1].at, '2026-11-09T00:00:00.000Z');
});

test('normalizeState conserva la versión que publicó una propuesta aprobada', () => {
  const state = normalizeState({
    improvements: {
      'imp-1': {
        id: 'imp-1',
        skillId: 'una-skill',
        baseVersion: '1.0.0',
        status: 'approved',
        version: '1.1.0',
        decidedAt: NOW,
        decidedBy: 'human',
      },
    },
  });
  assert.equal(state.improvements['imp-1'].version, '1.1.0', 'el historial no puede perder qué versión salió de la propuesta');
});

test('defaultRoot sale de DSH_HOME y las rutas derivadas cuelgan de la raíz', () => {
  const root = defaultRoot({ DSH_HOME: 'C:/dsh-home' });
  assert.equal(root, join('C:/dsh-home', 'lifecode-skill-center'));
  assert.equal(centerFile('C:/r'), join('C:/r', 'center.json'));
  assert.equal(materializedRoot('C:/r'), join('C:/r', 'materialized'));
});

test('la escritura es atómica: el fichero final aparece completo', () => {
  const root = autonomyRoot();
  const state = emptyState(NOW);
  saveState(root, state, { now: NOW });
  const raw = readFileSync(centerFile(root), 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw));
  assert.equal(JSON.parse(raw).schemaVersion, state.schemaVersion);
});

test('un candado abandonado no bloquea para siempre y se retira al escribir', () => {
  const root = autonomyRoot();
  withState(root, (state) => { state.projects['p-1'] = { id: 'p-1', cwd: 'C:/x' }; });
  const lock = `${centerFile(root)}.lock`;
  writeFileSync(lock, JSON.stringify({ pid: 1, at: NOW }), 'utf8');
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);

  const saved = withState(root, (state) => { state.projects['p-2'] = { id: 'p-2', cwd: 'C:/y' }; });
  assert.equal(saved.ok, true, 'un candado de hace un minuto está abandonado');
  assert.equal(saved.saved, true);
  assert.equal(existsSync(lock), false, 'el candado abandonado se retira');
  assert.equal(loadState(root).state.projects['p-2'].id, 'p-2');
});

test('un candado reciente sí bloquea y no se toca el documento', () => {
  const root = autonomyRoot();
  withState(root, (state) => { state.projects['p-1'] = { id: 'p-1', cwd: 'C:/x' }; });
  const lock = `${centerFile(root)}.lock`;
  writeFileSync(lock, JSON.stringify({ pid: 2, at: NOW }), 'utf8');
  const before = readFileSync(centerFile(root));

  assert.throws(
    () => withState(root, (state) => { state.projects['p-3'] = { id: 'p-3', cwd: 'C:/z' }; }),
    /ocupado|candado/iu,
  );
  assert.deepEqual(readFileSync(centerFile(root)), before, 'un candado ajeno no puede provocar escritura');
  assert.equal(existsSync(lock), true, 'el candado de otro proceso se respeta');
});
