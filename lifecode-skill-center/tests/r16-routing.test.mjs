/*
 * Pruebas del registro y despacho reales de la API (R16.2).
 *
 * No prueban el payload puro: montan el plugin con `apply()` sobre un `ctx` mínimo, capturan la ÚNICA
 * ruta `prefix` que se registra y despachan peticiones HTTP con URL real contra ese handler. Así se mide
 * lo que el harness ve (prefijo, método, ruta, cuerpo) y no lo que el test supone.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import {
  API_CONTRACT_VERSION,
  API_PREFIX,
  API_VERSION,
  CAPABILITY_IDS,
  handleApiRequest,
} from '../lib/api.mjs';
import { projectIdFor } from '../lib/format.mjs';
import { centerFile } from '../lib/state.mjs';
import { apply as applyPlugin } from '../index.js';
import { candidate, tempProject, tempRoot } from './helpers.mjs';
import { runAction } from '../lib/api.mjs';

const NOW = '2026-11-09T14:00:00.000Z';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Huella del almacén: si el handshake escribiera algo, cambiaría. */
function storeDigest(root) {
  const file = centerFile(root);
  return existsSync(file) ? sha256(readFileSync(file)) : 'missing';
}

/**
 * Monta el plugin y devuelve `dispatch`, que invoca la ruta registrada como lo haría el servidor web.
 *
 * `services` es lo único que cambia entre un Host completo y uno mínimo: el handler es el mismo.
 */
function mount({ root, dshHome, services = {} }) {
  const routes = [];
  const browserPeer = { id: 'peer-navegador', principal: { kind: 'owner' } };
  const ctx = {
    get: (key) =>
      ({
        connection: { browserPeer, admit: () => ({ peer: browserPeer }) },
        ...services,
      })[key],
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
    skills: { registerProvider: (callback) => callback({ invalidate: () => {} }) },
    effect: (callback) => {
      callback();
    },
    inject: (names, callback) =>
      callback({
        webServer: {
          register: (route) => {
            routes.push(route);
            return () => {};
          },
          getOrigin: () => 'http://127.0.0.1:1',
        },
      }),
    logger: { info: () => {}, warn: () => {} },
  };
  applyPlugin(ctx, { root, dshHome });

  const dispatch = async ({ method = 'GET', pathname = API_PREFIX, search = '', body = null }) => {
    assert.equal(routes.length, 1, 'la API se registra una sola vez');
    const payload = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const listeners = new Map();
    const req = {
      method,
      url: `${pathname}${search}`,
      headers: { cookie: 'dsh-auth-prueba=1' },
      on(event, callback) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(callback);
        return req;
      },
    };
    const res = {
      statusCode: 0,
      payload: '',
      setHeader() {},
      end(value = '') {
        this.payload = String(value);
      },
    };
    const done = new Promise((resolve) => {
      const original = res.end.bind(res);
      res.end = (value = '') => {
        original(value);
        resolve();
      };
    });
    routes[0].handler(req, res);
    if (payload !== null) {
      for (const callback of listeners.get('data') ?? []) callback(payload);
      for (const callback of listeners.get('end') ?? []) callback();
    }
    await done;
    return { status: res.statusCode, body: res.payload === '' ? undefined : JSON.parse(res.payload) };
  };

  return { routes, dispatch };
}

function fakeServices(project, { skills = [], complete = true } = {}) {
  const workspaces = [
    {
      id: 'ws-uno',
      path: project,
      title: 'workspace de prueba',
      sessionIds: ['sesion-uno'],
      status: async () => 'ok',
    },
  ];
  return {
    workspaceRegistry: {
      list() {
        return workspaces;
      },
    },
    skills: { snapshot: async () => ({ skills, complete }) },
    loader: { entries: () => [] },
  };
}

test('R16.2: GET capabilities responde con el registro del plugin y sin ningún servicio del Host', async () => {
  const root = tempRoot('lsc-r162-cap');
  const before = storeDigest(root);
  const { routes, dispatch } = mount({ root, dshHome: tempRoot('lsc-r162-cap-dsh') });

  // La ruta registrada es exactamente una, prefix y con el prefijo del contrato.
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, API_PREFIX);

  const response = await dispatch({ pathname: `${API_PREFIX}/capabilities` });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.kind, 'capabilities');
  assert.equal(response.body.apiVersion, API_VERSION);
  assert.equal(response.body.contractVersion, 2);
  assert.deepEqual(response.body.capabilities, CAPABILITY_IDS);
  assert.ok(response.body.capabilities.includes('activity'), 'R17: el feed de actividad se anuncia');
  assert.equal(response.body.routes['GET /api/activity'], 'activity');
  assert.equal(response.body.contract.prefix, API_PREFIX);
  assert.equal(response.body.contract.minClientContract, 2);
  assert.equal(response.body.contract.maxClientContract, 2);
  assert.equal(response.body.implementation, 'r16.2');
  assert.deepEqual(
    Object.keys(response.body.routes).sort(),
    [
      'GET /api/activity',
      'GET /api/capabilities',
      'GET /api/inventory',
      'GET /api/projects',
      'GET /api/workspaces',
      'POST /api#adopt-project',
      'POST /api#inspect-project',
      'POST /api#materialize-project',
      'POST /api#register-project',
    ].sort(),
  );
  assert.equal(typeof response.body.plugin.version, 'string');
  assert.match(response.body.plugin.version, /^\d+\.\d+\.\d+/u);
  assert.equal(storeDigest(root), before, 'el handshake no escribe el almacén');
});

test('R16.2: el payload puro de capacidades coincide con lo que sirve el despacho', () => {
  const pure = handleApiRequest({
    root: 'C:/no-existe',
    method: 'GET',
    pathname: `${API_PREFIX}/capabilities`,
    search: '',
    hostCwd: '',
    pluginVersion: '9.9.9',
    implementation: 'r16.2',
    now: NOW,
  });
  assert.equal(pure.status, 200);
  assert.equal(pure.body.plugin.version, '9.9.9');
  assert.equal(pure.body.generatedAt, NOW);
  assert.deepEqual(pure.body.capabilities, CAPABILITY_IDS);
  assert.equal(pure.body.contractVersion, API_CONTRACT_VERSION);
});

test('R16.2: GET projects e inventory por la ruta registrada responden con contractVersion 2', async () => {
  const root = tempRoot('lsc-r162-routes');
  const project = tempProject('rutas', tempRoot('lsc-r162-routes-work'));
  runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  const { dispatch } = mount({
    root,
    dshHome: tempRoot('lsc-r162-routes-dsh'),
    services: fakeServices(project),
  });

  const projects = await dispatch({ pathname: `${API_PREFIX}/projects` });
  assert.equal(projects.status, 200, JSON.stringify(projects.body).slice(0, 400));
  assert.equal(projects.body.ok, true);
  assert.equal(projects.body.apiVersion, API_VERSION);
  assert.equal(projects.body.contractVersion, 2);
  assert.ok(Array.isArray(projects.body.projects));
  assert.ok(Array.isArray(projects.body.discovered));
  assert.ok(Array.isArray(projects.body.sources));
  assert.equal(typeof projects.body.summary, 'object');
  assert.equal(typeof projects.body.current, 'object');
  assert.equal(typeof projects.body.identity, 'object');

  const inventory = await dispatch({ pathname: `${API_PREFIX}/inventory` });
  assert.equal(inventory.status, 200, JSON.stringify(inventory.body).slice(0, 400));
  assert.equal(inventory.body.ok, true);
  assert.equal(inventory.body.apiVersion, API_VERSION);
  assert.equal(inventory.body.contractVersion, 2);
  assert.ok(Array.isArray(inventory.body.entries));
  assert.ok(Array.isArray(inventory.body.collisions));
  assert.ok(Array.isArray(inventory.body.sources));
});

test('R16.2: POST inspect-project se despacha por la ruta registrada y lee el proyecto', async () => {
  const root = tempRoot('lsc-r162-inspect');
  const project = tempProject('inspeccion', tempRoot('lsc-r162-inspect-work'));
  const registered = runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  assert.equal(registered.ok, true);
  const projectId = projectIdFor(project);
  const { dispatch } = mount({
    root,
    dshHome: tempRoot('lsc-r162-inspect-dsh'),
    services: fakeServices(project),
  });

  const before = storeDigest(root);
  const response = await dispatch({
    method: 'POST',
    pathname: API_PREFIX,
    body: { action: 'inspect-project', projectId },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 400));
  assert.equal(response.body.ok, true);
  assert.equal(response.body.action, 'inspect-project');
  assert.equal(response.body.projectId, projectId);
  assert.equal(typeof response.body.project, 'object');
  assert.equal(storeDigest(root), before, 'inspect-project es de sólo lectura');
});

test('R16.2: una ruta desconocida conserva el 404 not-found del despacho', async () => {
  const root = tempRoot('lsc-r162-404');
  const { dispatch } = mount({ root, dshHome: tempRoot('lsc-r162-404-dsh') });
  const response = await dispatch({ pathname: `${API_PREFIX}/no-existe` });
  assert.equal(response.status, 404);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'not-found');
  assert.match(response.body.message, /esa ruta no es de la API/u);
});

test('R16.2: sin servicio de conexión el handshake responde 200 (se sirve antes de la puerta)', async () => {
  // Igual que la salud: el panel necesita poder preguntar «¿me conoces?» aunque el Host aún no ofrezca
  // `connection`. Si esta ruta quedara detrás de la admisión, el panel contra un backend sin auth vería
  // un 503 indistinguible de un backend viejo y elegiría el modo equivocado.
  const root = tempRoot('lsc-r162-noauth');
  const routes = [];
  const ctx = {
    get: () => undefined,
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
    skills: { registerProvider: (callback) => callback({ invalidate: () => {} }) },
    effect: (callback) => {
      callback();
    },
    inject: (names, callback) =>
      callback({ webServer: { register: (route) => (routes.push(route), () => {}), getOrigin: () => '' } }),
    logger: { info: () => {} },
  };
  applyPlugin(ctx, { root, dshHome: tempRoot('lsc-r162-noauth-dsh') });
  const res = {
    statusCode: 0,
    payload: '',
    setHeader() {},
    end(value = '') {
      this.payload = String(value);
    },
  };
  await routes[0].handler(
    { method: 'GET', url: `${API_PREFIX}/capabilities`, headers: { cookie: 'x' }, on() {} },
    res,
  );
  assert.equal(res.statusCode, 200, res.payload.slice(0, 300));
  const body = JSON.parse(res.payload);
  assert.equal(body.kind, 'capabilities');
  assert.equal(body.contractVersion, 2);
  assert.deepEqual(body.capabilities, CAPABILITY_IDS);
});

test('R16.2: capabilities no lee almacén ni servicios (almacén corrupto + skills que lanza)', async () => {
  const root = tempRoot('lsc-r162-static');
  const dshHome = tempRoot('lsc-r162-static-dsh');
  writeFileSync(centerFile(root), '{ esto no es json ');
  let serviceReads = 0;
  const routes = [];
  const ctx = {
    get: (key) => {
      if (key !== 'connection') serviceReads += 1;
      return undefined;
    },
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
    skills: { registerProvider: (callback) => callback({ invalidate: () => {} }) },
    effect: (callback) => {
      callback();
    },
    inject: (names, callback) =>
      callback({ webServer: { register: (route) => (routes.push(route), () => {}), getOrigin: () => '' } }),
    logger: { info: () => {} },
  };
  // `ctx.get('skills')` lanzaría si se consultara; el handshake no debe llegar ahí.
  ctx.get = (key) => {
    if (key === 'connection') return undefined;
    serviceReads += 1;
    if (key === 'skills') throw new Error('el handshake no puede tocar skills');
    return undefined;
  };
  applyPlugin(ctx, { root, dshHome });
  const res = {
    statusCode: 0,
    payload: '',
    setHeader() {},
    end(value = '') {
      this.payload = String(value);
    },
  };
  await routes[0].handler(
    { method: 'GET', url: `${API_PREFIX}/capabilities`, headers: { cookie: 'x' }, on() {} },
    res,
  );
  assert.equal(res.statusCode, 200, res.payload.slice(0, 300));
  const body = JSON.parse(res.payload);
  assert.equal(body.kind, 'capabilities');
  assert.equal(serviceReads <= 1, true, 'no resuelve skills/registry/loader para el handshake');
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /integrity|sha256|entries|generatedFrom/iu, 'sin datos del almacén');
  assert.deepEqual(Object.keys(body).sort(), [
    'apiVersion',
    'capabilities',
    'contract',
    'contractVersion',
    'generatedAt',
    'implementation',
    'kind',
    'ok',
    'plugin',
    'routes',
  ].sort());
});

test('R16.2: el resto de rutas sigue exigiendo admisión (503 sin connection, 401/403 con rechazo)', async () => {
  const root = tempRoot('lsc-r162-gate');
  const withoutConnection = mount({
    root,
    dshHome: tempRoot('lsc-r162-gate-dsh'),
    services: { connection: undefined },
  });
  const capabilities = await withoutConnection.dispatch({ pathname: `${API_PREFIX}/capabilities` });
  assert.equal(capabilities.status, 200, 'el handshake no depende de connection');
  const projects = await withoutConnection.dispatch({ pathname: `${API_PREFIX}/projects` });
  assert.equal(projects.status, 503);
  assert.equal(projects.body.code, 'auth-unavailable');

  for (const rejection of [401, 403]) {
    const denied = mount({
      root,
      dshHome: tempRoot(`lsc-r162-gate-${rejection}`),
      services: { connection: { admit: () => ({ rejection }) } },
    });
    const response = await denied.dispatch({ pathname: `${API_PREFIX}/inventory` });
    assert.equal(response.status, rejection);
    assert.equal(response.body.code, rejection === 403 ? 'forbidden' : 'unauthorized');
  }
});

test('R16.2: HEAD capabilities responde sin cuerpo y con el mismo estado', async () => {
  const root = tempRoot('lsc-r162-head');
  const { dispatch } = mount({ root, dshHome: tempRoot('lsc-r162-head-dsh') });
  const response = await dispatch({ method: 'HEAD', pathname: `${API_PREFIX}/capabilities` });
  assert.equal(response.status, 200);
  assert.equal(response.body, undefined);
});
