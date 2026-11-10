/*
 * R16.2 — verificación de RUNTIME: registro real y handshake.
 *
 * Estas pruebas no llaman funciones puras: montan el adaptador Cordis real (`apply`) sobre un `ctx`
 * mínimo, capturan la ruta `prefix` que el plugin registra en `webServer.register` y despachan
 * peticiones HTTP con URL real contra ese handler, como haría el servidor del Host. Así se mide el
 * contrato que ve el navegador (prefijo, método, admisión, estado y cuerpo) y no lo que la prueba
 * supone. Todo ocurre en cajas temporales: el almacén real (`~/.dsh`) no se lee ni se escribe.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  API_CONTRACT_VERSION,
  API_PREFIX,
  API_VERSION,
  CAPABILITY_IDS,
} from '../lib/api.mjs';
import { centerFile } from '../lib/state.mjs';
import { apply as applyPlugin } from '../index.js';
import { tempRoot } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PACKAGE = require('../package.json');

/** Huella del almacén del centro: cualquier escritura la cambia. */
function storeDigest(root) {
  const file = centerFile(root);
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'missing';
}

/** Huella de un árbol de proyecto, para demostrar que registrar/inspeccionar no lo tocan. */
function treeDigest(dir) {
  const hash = createHash('sha256');
  const walk = (current, prefix) => {
    for (const entry of require('node:fs').readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name);
      const rel = `${prefix}${entry.name}`;
      hash.update(rel);
      if (entry.isDirectory()) walk(full, `${rel}/`);
      else hash.update(readFileSync(full));
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return hash.digest('hex');
}

function fakeServices(workspacePath, hostCwd = workspacePath) {
  return {
    workspaceRegistry: {
      list: () => [
        { id: 'ws-runtime', path: workspacePath, title: 'workspace runtime', sessionIds: ['s-runtime'], status: async () => 'ok' },
      ],
    },
    skills: { snapshot: async () => ({ skills: [], complete: true }) },
    loader: { entries: () => [] },
    workingDirectory: { get: () => hostCwd },
    agents: { list: () => [{ session: { id: 's-runtime' }, cwd: hostCwd }] },
  };
}

/**
 * Monta el plugin y devuelve `dispatch`, más el registro de rutas y una puerta para cambiar servicios
 * en caliente (la prueba de reintento necesita simular «el Host aún no ofrece connection»).
 */
function mount({ root, dshHome, services = {}, connection = 'host' }) {
  const routes = [];
  const browserPeer = { id: 'peer-panel', principal: { kind: 'owner' } };
  const state = {
    connection:
      connection === 'missing'
        ? undefined
        : {
            browserPeer,
            admit: ({ headers }) => {
              if (String(headers?.cookie ?? '') === '') return { rejection: 401 };
              if (String(headers?.host ?? '') === 'host-ajeno') return { rejection: 403 };
              return { peer: browserPeer };
            },
          },
    ...services,
  };
  const ctx = {
    get: (key) => state[key],
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
    skills: { registerProvider: (callback) => callback({ invalidate: () => {} }) },
    effect: (callback) => callback(),
    inject: (names, callback) => callback({
      webServer: {
        register: (route) => { routes.push(route); return () => {}; },
        getOrigin: () => 'http://127.0.0.1:1',
      },
    }),
    logger: { info: () => {}, warn: () => {} },
  };
  applyPlugin(ctx, { root, dshHome });

  const dispatch = async ({ method = 'GET', pathname = API_PREFIX, search = '', body = null, headers = null } = {}) => {
    assert.equal(routes.length, 1, 'el adaptador registra una sola ruta para toda la API');
    const payload = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const listeners = new Map();
    const req = {
      method,
      url: `${pathname}${search}`,
      headers: headers ?? { cookie: 'dsh-auth-runtime=1' },
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
      res.end = (value = '') => { original(value); resolve(); };
    });
    routes[0].handler(req, res);
    if (payload !== null) {
      for (const callback of listeners.get('data') ?? []) callback(payload);
      for (const callback of listeners.get('end') ?? []) callback();
    }
    await done;
    return { status: res.statusCode, body: res.payload === '' ? undefined : JSON.parse(res.payload) };
  };

  return { routes, dispatch, state };
}

function legacyWorkspacesBody() {
  return {
    ok: true,
    apiVersion: 1,
    workspaces: [{ workspaceId: 'ws-viejo', title: 'workspace viejo', path: 'C:\\viejo' }],
    managed: [],
  };
}

test('R16.2 runtime: apply registra UNA ruta prefix y el handshake viaja por ese handler', async () => {
  const root = tempRoot('lsc-r162-rt-cap');
  const dshHome = tempRoot('lsc-r162-rt-cap-home');
  const before = storeDigest(root);
  const { routes, dispatch } = mount({ root, dshHome, services: fakeServices(tempRoot('lsc-r162-rt-cap-ws')) });

  assert.equal(routes.length, 1, 'una única ruta para todo el prefijo');
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, API_PREFIX);
  assert.equal(typeof routes[0].handler, 'function');

  const response = await dispatch({ pathname: `${API_PREFIX}/capabilities`, headers: {} });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.kind, 'capabilities');
  assert.equal(response.body.apiVersion, API_VERSION);
  assert.equal(response.body.contractVersion, API_CONTRACT_VERSION);
  assert.equal(response.body.contractVersion, 2);
  assert.equal(response.body.implementation, 'r16.2');
  assert.equal(response.body.plugin.id, 'lifecode-skill-center');
  assert.equal(response.body.plugin.version, PACKAGE.version, 'la versión sale del package.json del plugin');
  assert.equal(response.body.contract.prefix, API_PREFIX);
  assert.deepEqual(response.body.capabilities, CAPABILITY_IDS);
  assert.ok(response.body.capabilities.includes('activity'), 'R17: la actividad se anuncia');
  assert.deepEqual(Object.keys(response.body.routes).sort(), [
    'GET /api/activity',
    'GET /api/capabilities',
    'GET /api/inventory',
    'GET /api/projects',
    'GET /api/workspaces',
    'POST /api#adopt-project',
    'POST /api#inspect-project',
    'POST /api#materialize-project',
    'POST /api#register-project',
  ].sort());
  assert.equal(storeDigest(root), before, 'el handshake no escribe en el almacén');
});

test('R16.2 runtime: capabilities es la superficie sin credencial y no filtra rutas ni datos del usuario', async () => {
  const workspace = tempRoot('lsc-r162-rt-anon-ws');
  const root = tempRoot('lsc-r162-rt-anon');
  const dshHome = tempRoot('lsc-r162-rt-anon-home');
  // Sin servicio `connection`: las rutas de datos dan 503, el handshake sigue siendo 200.
  const host = mount({ root, dshHome, services: fakeServices(workspace), connection: 'missing' });

  const anonymous = await host.dispatch({ pathname: `${API_PREFIX}/capabilities`, headers: {} });
  assert.equal(anonymous.status, 200, 'capabilities se sirve antes de la admisión');
  const serialized = JSON.stringify(anonymous.body);
  for (const secret of [root, dshHome, workspace, '.dsh', 'cookie', 'token']) {
    assert.equal(serialized.includes(secret), false, `el handshake no expone ${secret}`);
  }

  const projects = await host.dispatch({ pathname: `${API_PREFIX}/projects`, headers: {} });
  assert.equal(projects.status, 503);
  assert.equal(projects.body.code, 'auth-unavailable');

  const inventory = await host.dispatch({ pathname: `${API_PREFIX}/inventory`, headers: {} });
  assert.equal(inventory.status, 503);
  assert.equal(inventory.body.code, 'auth-unavailable');
});

test('R16.2 runtime: GET projects y GET inventory por el handler real son aditivos (apiVersion 1, contractVersion 2)', async () => {
  const workspace = tempRoot('lsc-r162-rt-data-ws');
  const root = tempRoot('lsc-r162-rt-data');
  const host = mount({ root, dshHome: tempRoot('lsc-r162-rt-data-home'), services: fakeServices(workspace) });

  const projects = await host.dispatch({ pathname: `${API_PREFIX}/projects` });
  assert.equal(projects.status, 200);
  assert.equal(projects.body.ok, true);
  assert.equal(projects.body.apiVersion, 1, 'apiVersion no cambia: el contrato nuevo es aditivo');
  assert.equal(projects.body.contractVersion, 2);
  assert.ok(Array.isArray(projects.body.projects));
  assert.ok(Array.isArray(projects.body.discovered));
  assert.ok(Array.isArray(projects.body.sources));

  const inventory = await host.dispatch({ pathname: `${API_PREFIX}/inventory` });
  assert.equal(inventory.status, 200);
  assert.equal(inventory.body.ok, true);
  assert.equal(inventory.body.apiVersion, 1);
  assert.equal(inventory.body.contractVersion, 2);
  assert.ok(Array.isArray(inventory.body.entries));
  assert.ok(Array.isArray(inventory.body.sources));
});

test('R16.2 runtime: /workspaces nuevo lleva la marca `deprecated` y por tanto no es señal de backend viejo', async () => {
  const workspace = tempRoot('lsc-r162-rt-ws-ws');
  const host = mount({
    root: tempRoot('lsc-r162-rt-ws'),
    dshHome: tempRoot('lsc-r162-rt-ws-home'),
    services: fakeServices(workspace),
  });
  const response = await host.dispatch({ pathname: `${API_PREFIX}/workspaces` });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.deprecated, true, 'la compatibilidad se anuncia en el propio payload');
  assert.ok(Array.isArray(response.body.workspaces));

  // Señal POSITIVA de backend heredado: mismo endpoint SIN `deprecated` y con filas sin `state`.
  const legacy = legacyWorkspacesBody();
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, 'deprecated'), false);
  assert.equal(legacy.workspaces.some((row) => Object.prototype.hasOwnProperty.call(row, 'state')), false);
  // El backend actual NO cumple esa señal: un cliente nuevo no puede confundirlo con legacy.
  assert.equal(Object.prototype.hasOwnProperty.call(response.body, 'deprecated'), true);
});

test('R16.2 runtime: 404 de ruta y 404 de entidad son códigos distintos y ninguno es señal de compatibilidad', async () => {
  const workspace = tempRoot('lsc-r162-rt-404-ws');
  const host = mount({ root: tempRoot('lsc-r162-rt-404'), dshHome: tempRoot('lsc-r162-rt-404-home'), services: fakeServices(workspace) });

  const routeMissing = await host.dispatch({ pathname: `${API_PREFIX}/ruta-que-no-existe` });
  assert.equal(routeMissing.status, 404);
  assert.equal(routeMissing.body.ok, false);
  assert.equal(routeMissing.body.code, 'not-found');
  assert.match(routeMissing.body.message, new RegExp(API_PREFIX.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')));

  const entityMissing = await host.dispatch({
    method: 'POST',
    pathname: API_PREFIX,
    body: { action: 'inspect-project', projectId: 'no-existe' },
  });
  assert.equal(entityMissing.status, 404);
  assert.equal(entityMissing.body.ok, false);
  assert.equal(entityMissing.body.code, 'project-not-found');
  assert.notEqual(entityMissing.body.code, routeMissing.body.code, 'ruta ausente ≠ entidad ausente');
});

test('R16.2 runtime: register-project e inspect-project funcionan por el mismo handler y no tocan el proyecto', async () => {
  const workspace = tempRoot('lsc-r162-rt-reg-ws');
  const project = join(workspace, 'proyecto-runtime');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'README.md'), '# proyecto externo\n');
  const projectBefore = treeDigest(project);
  const host = mount({ root: tempRoot('lsc-r162-rt-reg'), dshHome: tempRoot('lsc-r162-rt-reg-home'), services: fakeServices(project, project) });

  const registered = await host.dispatch({ method: 'POST', pathname: API_PREFIX, body: { action: 'register-project', cwd: project } });
  assert.equal(registered.status, 200);
  assert.equal(registered.body.ok, true);
  assert.match(String(registered.body.project.uuid), /^[0-9a-f-]{36}$/i);
  assert.equal(registered.body.project.cwd.replaceAll('\\', '/'), project.replaceAll('\\', '/'));
  assert.equal(treeDigest(project), projectBefore, 'registrar no modifica el proyecto externo');

  const inspection = await host.dispatch({ method: 'POST', pathname: API_PREFIX, body: { action: 'inspect-project', projectId: registered.body.project.id } });
  assert.equal(inspection.status, 200);
  assert.equal(inspection.body.ok, true);
  assert.equal(inspection.body.action, 'inspect-project');
  assert.equal(inspection.body.project.projectId, registered.body.project.id);
  assert.equal(inspection.body.project.registration.uuid, registered.body.project.uuid);
  const listed = await host.dispatch({ pathname: `${API_PREFIX}/projects` });
  const listedRow = listed.body.projects.find((row) => row.projectId === registered.body.project.id);
  assert.ok(listedRow, 'el proyecto registrado aparece en la lista');
  assert.equal(inspection.body.project.state, listedRow.state, 'lista y ficha coinciden en state');
  assert.equal(treeDigest(project), projectBefore, 'inspeccionar tampoco modifica el proyecto externo');
});

test('R16.2 runtime: admisión 401/403 deja capabilities accesible y nunca escribe', async () => {
  const workspace = tempRoot('lsc-r162-rt-auth-ws');
  const root = tempRoot('lsc-r162-rt-auth');
  const before = storeDigest(root);
  const host = mount({ root, dshHome: tempRoot('lsc-r162-rt-auth-home'), services: fakeServices(workspace) });

  const noCookie = await host.dispatch({ pathname: `${API_PREFIX}/projects`, headers: {} });
  assert.equal(noCookie.status, 401);
  assert.equal(noCookie.body.code, 'unauthorized');

  const foreignOrigin = await host.dispatch({
    pathname: `${API_PREFIX}/inventory`,
    headers: { cookie: 'dsh-auth-runtime=1', origin: 'http://evil.example' },
  });
  assert.equal(foreignOrigin.status, 403);
  assert.equal(foreignOrigin.body.code, 'cross-origin');

  const capabilities = await host.dispatch({ pathname: `${API_PREFIX}/capabilities`, headers: {} });
  assert.equal(capabilities.status, 200, 'el handshake no queda detrás de la puerta');

  const post = await host.dispatch({
    method: 'POST',
    pathname: API_PREFIX,
    body: { action: 'inspect-project', projectId: 'x' },
    headers: {},
  });
  assert.equal(post.status, 401, 'una acción sin credencial no llega al despacho');
  assert.equal(storeDigest(root), before, 'ningún rechazo escribió en el almacén');
});

test('R16.2 runtime: dos instancias registradas — el handler vigente responde contrato 2 y el viejo no se usa', async () => {
  const current = mount({
    root: tempRoot('lsc-r162-rt-inst'),
    dshHome: tempRoot('lsc-r162-rt-inst-home'),
    services: fakeServices(tempRoot('lsc-r162-rt-inst-ws')),
  });
  assert.equal(current.routes.length, 1);
  const currentHandler = current.routes[0].handler;

  // Backend heredado simulado: capabilities ausente (404 not-found) y /workspaces con forma vieja.
  const oldHandler = (req, res) => {
    const url = String(req.url ?? '');
    const send = (status, body) => {
      res.statusCode = status;
      res.end(`${JSON.stringify(body)}\n`);
    };
    if (url.endsWith('/capabilities')) return send(404, { ok: false, code: 'not-found', message: `esa ruta no es de la API (${API_PREFIX})` });
    if (url.endsWith('/workspaces')) return send(200, legacyWorkspacesBody());
    return send(404, { ok: false, code: 'not-found', message: `esa ruta no es de la API (${API_PREFIX})` });
  };

  // El Host resuelve una única ruta por prefijo: con dos cargas, la registrada en último lugar es la
  // vigente. La prueba fija esa semántica y comprueba que el viejo handler sigue delatándose como viejo.
  const routes = [{ kind: 'prefix', path: API_PREFIX, handler: oldHandler }, ...current.routes];
  const resolved = routes.at(-1).handler;
  assert.equal(resolved, currentHandler, 'la instancia vigente gana');

  const capabilities = await current.dispatch({ pathname: `${API_PREFIX}/capabilities`, headers: {} });
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.body.contractVersion, 2);

  const oldResponse = await new Promise((resolve) => {
    const res = { statusCode: 0, setHeader() {}, end(value = '') { resolve({ status: this.statusCode, body: JSON.parse(String(value)) }); } };
    oldHandler({ url: `${API_PREFIX}/capabilities` }, res);
  });
  assert.equal(oldResponse.status, 404);
  assert.equal(oldResponse.body.code, 'not-found', 'el backend viejo sigue respondiendo 404 de ruta');
  assert.equal(legacyWorkspacesBody().deprecated, undefined, 'la forma vieja no trae la marca nueva');
});

test('R16.2 runtime: reintento tras recuperar `connection` — 503 auth-unavailable y después 200, sin efectos dobles', async () => {
  const workspace = tempRoot('lsc-r162-rt-retry-ws');
  const root = tempRoot('lsc-r162-rt-retry');
  const before = storeDigest(root);
  const host = mount({ root, dshHome: tempRoot('lsc-r162-rt-retry-home'), services: fakeServices(workspace), connection: 'missing' });

  const first = await host.dispatch({ pathname: `${API_PREFIX}/projects` });
  assert.equal(first.status, 503);
  assert.equal(first.body.code, 'auth-unavailable');

  host.state.connection = {
    browserPeer: { id: 'peer-panel' },
    admit: () => ({ peer: { id: 'peer-panel' } }),
  };
  const second = await host.dispatch({ pathname: `${API_PREFIX}/projects` });
  assert.equal(second.status, 200, 'el mismo handler se recupera cuando el Host ofrece connection');
  assert.equal(second.body.ok, true);
  assert.equal(storeDigest(root), before, 'ni el fallo ni el reintento escribieron');
});

test('R16.2 runtime: dos POST register concurrentes no duplican proyecto ni pierden asignaciones', async () => {
  const workspace = tempRoot('lsc-r162-rt-dup-ws');
  const project = join(workspace, 'proyecto-duplicado');
  mkdirSync(project, { recursive: true });
  const root = tempRoot('lsc-r162-rt-dup');
  const host = mount({ root, dshHome: tempRoot('lsc-r162-rt-dup-home'), services: fakeServices(project, project) });

  const [left, right] = await Promise.all([
    host.dispatch({ method: 'POST', pathname: API_PREFIX, body: { action: 'register-project', cwd: project } }),
    host.dispatch({ method: 'POST', pathname: API_PREFIX, body: { action: 'register-project', cwd: project } }),
  ]);
  assert.equal(left.status, 200);
  assert.equal(right.status, 200);
  assert.equal(left.body.project.id, right.body.project.id, 'el mismo cwd resuelve el mismo proyecto');

  const state = JSON.parse(readFileSync(centerFile(root), 'utf8'));
  assert.equal(Object.keys(state.projects ?? {}).length, 1, 'un único proyecto registrado, sin duplicar');
  assert.deepEqual(state.projects[left.body.project.id].assignments ?? {}, {}, 'no se inventan asignaciones');
});

test('R16.2 runtime: la rama de capabilities existe antes de workspaces en el despacho y no depende de servicios', async () => {
  const source = readFileSync(join(HERE, '..', 'index.js'), 'utf8');
  const capabilitiesAt = source.indexOf("route === 'capabilities'");
  const workspacesAt = source.indexOf("route === 'workspaces'");
  assert.ok(capabilitiesAt > 0, 'index.js sirve capabilities');
  assert.ok(workspacesAt > 0);
  assert.ok(capabilitiesAt < workspacesAt, 'capabilities se resuelve antes que la ruta heredada');
  assert.match(source, /capabilitiesPayload\(\{/);
  assert.match(source, /PLUGIN_VERSION/);
});

test('R16.2 runtime: el cliente sólo declara legacy con señal positiva y clasifica incompatible los workspaces nuevos', () => {
  // Guardarraíles estáticos del handshake del cliente (`client.js:2136-2147` y `5327-5375`).
  // La prueba funcional de los cinco estados vive en `tests/r16-ui.test.mjs` (matriz de compatibilidad);
  // aquí se fija que la señal POSITIVA y no el 404 deciden el modo, para que un cambio futuro no
  // reintroduzca el heurístico «404 ⇒ legacy» que causó el panel en blanco de R16.2.
  const source = readFileSync(join(HERE, '..', 'client.js'), 'utf8');
  assert.match(source, /function asLegacyWorkspacesPayload\(value\) \{/, 'existe el validador de la forma heredada');
  assert.match(source, /hasOwnProperty\.call\(value, 'deprecated'\)[\s\S]{0,120}return null/, 'una marca `deprecated` descarta la forma heredada');
  assert.match(source, /hasOwnProperty\.call\(row, 'state'\)[\s\S]{0,80}return null/, 'una fila con `state` descarta la forma heredada');
  const loadCompat = source.slice(source.indexOf('const loadCompat = useCallback'), source.indexOf('const loadProjects = useCallback'));
  assert.match(loadCompat, /const legacyPayload = probe\.ok === true \? asLegacyWorkspacesPayload\(probe\.data\) : null;/, 'legacy sólo con probe válido');
  assert.match(loadCompat, /if \(legacyPayload !== null\) \{[\s\S]{0,220}legacy-compatible/, 'la señal positiva entra en legacy');
  assert.match(loadCompat, /setCompat\(next\('backend-incompatible', \{ legacyProbe:[\s\S]{0,120}return 'backend-incompatible';/, 'probe inválido (workspaces nuevos) ⇒ backend-incompatible');
  assert.match(loadCompat, /version >= 2 && capabilities\.includes\('projects'\) && capabilities\.includes\('inventory'\)/, 'compatible exige contrato 2 y las dos rutas');
});
