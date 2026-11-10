/*
 * Contrato de descubrimiento (directiva §7): el registro de workspaces del Host se consulta **a petición**,
 * nunca como efecto del sondeo del panel, y descubrir no escribe identidad.
 *
 * Esta prueba existe por una razón concreta: el panel refresca `/api/state` cada 20 s. Si el inventario del
 * Host entrara en esa foto, cada panel abierto estaría sondeando el registro del Host cada 20 s sin que
 * nadie lo pidiera. Se mide con un registro falso que cuenta llamadas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import { handleApiRequest, workspacesPayload, API_PREFIX } from '../lib/api.mjs';
import { emptyState, loadState, saveState } from '../lib/state.mjs';
import { tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-01-01T00:00:00.000Z';

/** Almacén v2 real en la caja de arena: saveState es la vía del producto, no una imitación. */
function storeV2() {
  const root = autonomyRoot('lsc-discovery');
  saveState(root, { ...emptyState(NOW), schemaVersion: 2 }, { now: NOW });
  return root;
}

function countingRegistry() {
  const counters = { list: 0, status: 0 };
  const items = [
    {
      id: 'workspace-a',
      name: 'workspace-a',
      path: 'C:/x/proyecto-a',
      async status() {
        counters.status += 1;
        return 'ok';
      },
    },
    {
      id: 'workspace-b',
      name: 'workspace-b',
      path: 'C:/x/proyecto-b',
      async status() {
        counters.status += 1;
        return 'missing-dir';
      },
    },
  ];
  return {
    counters,
    registry: {
      list() {
        counters.list += 1;
        return items;
      },
    },
  };
}

test('la foto del panel no consulta el registro de workspaces del Host', () => {
  const root = storeV2();
  const { counters, registry } = countingRegistry();

  const response = handleApiRequest({
    root,
    registry,
    method: 'GET',
    pathname: `${API_PREFIX}/state`,
    search: '?scan=0',
    now: NOW,
  });

  assert.equal(response.status, 200);
  assert.equal(counters.list, 0, 'leer el estado no puede listar el registro del Host');
  assert.equal(counters.status, 0, 'leer el estado no puede preguntar el estado de cada workspace');
  assert.equal(typeof response.body.skills, 'object', 'la respuesta es la foto del panel');
  assert.equal(
    Object.hasOwn(response.body, 'workspaces'),
    false,
    'el inventario no viaja dentro de la foto: se pide aparte, cuando alguien abre la pestaña',
  );
});

test('el inventario se pide a propósito, una vez, y no escribe identidad', async () => {
  const root = storeV2();
  const before = readFileSync(`${root}/center.json`);
  const beforeStat = statSync(`${root}/center.json`);

  const { counters, registry } = countingRegistry();
  const payload = await workspacesPayload({ root, registry, hostCwd: 'C:/x/proyecto-a', now: NOW });

  assert.equal(payload.status, 200);
  assert.equal(counters.list, 1, 'un inventario es una lectura del registro, no tres');
  assert.equal(counters.status, 2, 'se pregunta el estado de cada workspace exactamente una vez');
  assert.ok(Array.isArray(payload.body.workspaces), 'el inventario publica sus filas');
  assert.equal(payload.body.workspaces.length, 2);

  assert.deepEqual(readFileSync(`${root}/center.json`), before, 'descubrir no puede reescribir el centro');
  assert.equal(statSync(`${root}/center.json`).mtimeMs, beforeStat.mtimeMs, 'ni siquiera tocarlo');
});

test('sin servicio del Host, el estado sigue respondiendo y el inventario dice que no lo sabe', async () => {
  const root = storeV2();

  const state = handleApiRequest({
    root,
    registry: null,
    method: 'GET',
    pathname: `${API_PREFIX}/state`,
    search: '?scan=0',
    now: NOW,
  });
  assert.equal(state.status, 200, 'el panel tiene que abrirse aunque el Host no ofrezca workspaces');

  const inventory = await workspacesPayload({ root, registry: null, now: NOW });
  assert.equal(inventory.status, 503);
  assert.equal(inventory.body.code, 'workspace-registry-unavailable');

  const pure = handleApiRequest({
    root,
    registry: null,
    method: 'GET',
    pathname: `${API_PREFIX}/workspaces`,
    now: NOW,
  });
  assert.equal(pure.status, 503, 'el despacho puro no finge un inventario que no puede resolver');
  assert.equal(pure.body.code, 'workspace-registry-unavailable');
});

test('la capacidad de identidad se declara en la foto, pero no se ejecuta al descubrir', () => {
  const root = storeV2();
  const before = loadState(root).state;

  const response = handleApiRequest({
    root,
    method: 'GET',
    pathname: `${API_PREFIX}/state`,
    search: '?scan=0',
    now: NOW,
  });

  assert.equal(response.body.identity.available, false, 'en v2 las acciones de identidad están bloqueadas');
  assert.equal(response.body.identity.requiredSchemaVersion, 3);
  assert.deepEqual(loadState(root).state, before, 'declarar la capacidad no cambia el documento');
});
