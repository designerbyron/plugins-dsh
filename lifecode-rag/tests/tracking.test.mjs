/**
 * UX-2.2 · Núcleo puro del seguimiento.
 *
 * Qué se demuestra: las transiciones humanas del eje A son exactamente las cinco permitidas, la
 * disponibilidad del eje B no puede tocar la preferencia (`missing ≠ off`), `paused` y `unknown` no
 * resuelven contexto, y la proyección y los recuentos no inventan campos ni estados.
 *
 * Ningún caso abre el registro: el módulo es puro por contrato, y se comprueba leyendo su fuente.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  TRACKING_ACTIONS,
  TRACKING_ASSOCIATIONS,
  TRACKING_STATES,
  TRACKING_STATUSES,
  actionForTransition,
  applyReconcile,
  normalizeTrackingRow,
  trackingCounts,
  trackingResolves,
} from '../lib/tracking.mjs';

function row(overrides = {}) {
  return {
    path_key: 'c:/workspaces/alfa',
    path: 'C:\\Workspaces\\Alfa',
    workspace_id: 'ws-1',
    project_id: 'prj_01M7RBSRD33M26HGBEFW51WPP6',
    state: 'on',
    association: 'explicit',
    bound_by: 'human',
    bound_at: '1700000000000',
    updated_at: '1700000000100',
    last_seen_at: '1700000000200',
    last_status: 'ok',
    revision: 1,
    ...overrides,
  };
}

test('los tres ejes y las cinco acciones son los del contrato, y no hay otros', () => {
  assert.deepEqual(Object.values(TRACKING_STATES), ['on', 'off', 'paused']);
  assert.deepEqual(Object.values(TRACKING_STATUSES), ['ok', 'missing', 'unknown']);
  assert.deepEqual(Object.values(TRACKING_ASSOCIATIONS), ['explicit', 'pending', 'conflict']);
  assert.deepEqual(Object.values(TRACKING_ACTIONS), ['enable', 'disable', 'pause', 'resume', 'reassociate']);
});

test('transiciones válidas del eje A: pause, resume, disable y enable', () => {
  assert.equal(actionForTransition('on', 'paused'), 'pause');
  assert.equal(actionForTransition('paused', 'on'), 'resume');
  assert.equal(actionForTransition('on', 'off'), 'disable');
  assert.equal(actionForTransition('paused', 'off'), 'disable', 'pausar y luego dejar de seguir es un disable');
  assert.equal(actionForTransition('off', 'on'), 'enable');
});

test('no-op: el mismo estado no produce acción ni revisión nueva', () => {
  for (const state of ['on', 'off', 'paused']) {
    assert.equal(actionForTransition(state, state), null, `${state} → ${state} no es una transición`);
  }
});

test('transiciones inválidas se rechazan con invalid-argument y su detalle', () => {
  // Desde `off` se reactiva primero: no se puede «pausar lo que no se sigue».
  for (const [from, to] of [['off', 'paused'], ['on', 'on?'], ['paused', 'off?']]) {
    assert.throws(() => actionForTransition(from, to), (error) => {
      assert.equal(error.code, 'invalid-argument');
      assert.equal(error.details.reason, 'invalid-transition');
      assert.equal(error.details.from, from);
      assert.equal(error.details.to, to);
      return true;
    });
  }
  assert.throws(() => actionForTransition(null, 'on'), (error) => error.code === 'invalid-argument');
  assert.throws(() => actionForTransition('on', null), (error) => error.code === 'invalid-argument');
});

test('resuelve sólo con on + ok + proyecto', () => {
  assert.equal(trackingResolves(row()), true);
  assert.equal(trackingResolves(row({ project_id: null })), false, 'seguido sin proyecto no resuelve');
  assert.equal(trackingResolves(row({ state: 'paused' })), false, 'paused no resuelve');
  assert.equal(trackingResolves(row({ state: 'off' })), false);
  assert.equal(trackingResolves(row({ last_status: 'missing' })), false);
  assert.equal(trackingResolves(row({ last_status: 'unknown' })), false, 'unknown nunca se pinta como seguido');
  assert.equal(trackingResolves(row({ last_status: null })), false, 'sin reconciliar todavía no resuelve');
  assert.equal(trackingResolves(null), false);
});

test('missing ≠ off: la ausencia técnica no cambia la decisión humana ni resuelve', () => {
  const tracked = row({ state: 'on', last_status: 'ok' });
  assert.equal(trackingResolves(tracked), true);

  const gone = applyReconcile(tracked, false, 1_700_000_100_000, tracked.path);
  assert.equal(gone.last_status, 'missing');
  const afterAbsence = { ...tracked, ...gone };

  assert.equal(afterAbsence.state, 'on', 'el eje A sigue en on: sólo una persona lo mueve');
  assert.equal(afterAbsence.project_id, tracked.project_id, 'la asociación no se toca');
  assert.equal(trackingResolves(afterAbsence), false, 'missing no resuelve');
  assert.notEqual(afterAbsence.state, 'off', 'missing no es off');
  assert.equal(afterAbsence.last_seen_at, tracked.last_seen_at, 'una ausencia no reescribe la última vez visto');

  // Y al volver, la misma fila recupera la resolución sin intervención humana: no hubo `off`.
  const back = applyReconcile(afterAbsence, true, 1_700_000_200_000, afterAbsence.path);
  assert.equal(back.last_status, 'ok');
  assert.equal(trackingResolves({ ...afterAbsence, ...back }), true);
});

test('applyReconcile devuelve sólo las tres columnas del eje B', () => {
  for (const present of [true, false, null]) {
    const result = applyReconcile(row(), present, 1_700_000_300_000, 'C:\\otra\\ruta');
    assert.deepEqual(Object.keys(result).sort(), ['last_seen_at', 'last_status', 'path']);
    for (const forbidden of ['state', 'association', 'project_id', 'bound_by', 'bound_at', 'revision']) {
      assert.equal(Object.hasOwn(result, forbidden), false, `${forbidden} no puede salir de la reconciliación`);
    }
  }
  assert.equal(applyReconcile(row(), true, 10, null).last_status, 'ok');
  assert.equal(applyReconcile(row(), false, 10, null).last_status, 'missing');
  assert.equal(applyReconcile(row(), null, 10, null).last_status, 'unknown');
  // Un instante ausente no puede convertirse en la cadena 'undefined' dentro de `last_seen_at`.
  assert.equal(
    applyReconcile(row(), true, undefined, null).last_seen_at,
    row().last_seen_at,
    'sin instante medido se conserva el último visto',
  );
});

test('unknown no borra la fila ni la marca como no seguida', () => {
  const tracked = row({ last_status: 'ok' });
  const doubt = applyReconcile(tracked, null, 1_700_000_400_000, tracked.path);
  assert.equal(doubt.last_status, 'unknown');
  const after = { ...tracked, ...doubt };
  assert.equal(after.state, 'on');
  assert.ok(after.project_id, 'la fila conserva su proyecto');
  assert.equal(trackingResolves(after), false, 'unknown no resuelve');
  // `path` se conserva cuando el Host no informa de la ruta.
  assert.equal(doubt.path, tracked.path);
  assert.equal(applyReconcile(tracked, null, 1, '   ').path, tracked.path, 'una ruta en blanco no borra la guardada');
});

test('normalizeTrackingRow publica exactamente las trece claves del contrato', () => {
  const item = normalizeTrackingRow(row());
  assert.deepEqual(Object.keys(item), [
    'pathKey', 'path', 'workspaceId', 'projectId', 'state', 'association', 'boundBy', 'boundAt',
    'updatedAt', 'lastSeenAt', 'lastStatus', 'revision', 'resolves',
  ]);
  assert.equal(item.pathKey, 'c:/workspaces/alfa');
  assert.equal(item.projectId, 'prj_01M7RBSRD33M26HGBEFW51WPP6');
  assert.equal(item.boundAt, 1_700_000_000_000);
  assert.equal(item.updatedAt, 1_700_000_000_100);
  assert.equal(item.lastSeenAt, 1_700_000_000_200);
  assert.equal(item.revision, 1);
  assert.equal(item.resolves, true);
  assert.equal(normalizeTrackingRow(null), null);
  assert.equal(normalizeTrackingRow(row({ last_seen_at: null, workspace_id: null, project_id: null })).lastSeenAt, null);
});

test('trackingCounts cuenta los dos ejes por separado y no inventa estados', () => {
  const counts = trackingCounts([
    row({ state: 'on', last_status: 'ok' }),
    row({ state: 'on', last_status: 'missing', project_id: null }),
    row({ state: 'off', last_status: 'ok' }),
    row({ state: 'paused', last_status: 'unknown', project_id: null }),
    row({ state: 'on', last_status: null }),
  ]);
  assert.deepEqual(counts, {
    total: 5, on: 3, off: 1, paused: 1,
    ok: 2, missing: 1, unknown: 1,
    withProject: 3, withoutProject: 2,
  });
  assert.deepEqual(trackingCounts([]), {
    total: 0, on: 0, off: 0, paused: 0, ok: 0, missing: 0, unknown: 0, withProject: 0, withoutProject: 0,
  });
  // El panel cuenta sobre las filas ya proyectadas sin volver a formatearlas.
  assert.deepEqual(
    trackingCounts([normalizeTrackingRow(row({ state: 'on', last_status: 'ok' })), normalizeTrackingRow(row({ state: 'off', last_status: 'missing', project_id: null }))]),
    { total: 2, on: 1, off: 1, paused: 0, ok: 1, missing: 1, unknown: 0, withProject: 1, withoutProject: 1 },
  );
});

test('el núcleo es puro: no importa fs, sqlite, red ni el Host', () => {
  const source = readFileSync(new URL('../lib/tracking.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .*?from\s+'([^']+)'/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ['./errors.mjs'], 'el único import es el error del propio núcleo');
  assert.doesNotMatch(source, /node:(fs|path|crypto|sqlite)|Date\.now|new Date\(|@deepseek-ai/);
});
