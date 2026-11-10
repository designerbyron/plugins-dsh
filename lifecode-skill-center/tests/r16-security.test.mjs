/**
 * R16 — seguridad de efectos reales, medida sobre el adaptador Cordis montado con un `ctx` de mentira.
 *
 * Todas las rutas se llaman como las llama el Host (`route.handler`), con el mismo cuerpo JSON y la misma
 * credencial. Cada prueba que escribe compara el hash del árbol ANTES y DESPUÉS: si una acción normal
 * toca una skill externa, borra un proyecto o filtra un secreto, la prueba falla.
 *
 * El almacén real del usuario nunca se usa: cada montaje crea su propio almacén, su propio `dshHome`, su
 * propio `agentsHome` y su propio proyecto en cajas temporales.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { apply, API_PREFIX } from '../index.js';
import { handleApiRequest } from '../lib/api.mjs';
import { loadState } from '../lib/state.mjs';
import { candidate } from './helpers.mjs';

// ── Arnes: ctx Cordis minimo, igual que el que usa tests/index.test.mjs ────────────────────────────

function fakeContext({ cwd = '', workspaces = null, connection = 'host', skills = null } = {}) {
  const routes = [];
  const providers = [];
  const cleanups = [];
  const live = cwd === '' ? [] : [{ session: { id: 'sesion-falsa' }, cwd }];
  const browserPeer = { id: 'peer-navegador', principal: { kind: 'owner' }, interactions: 'answer' };
  const operatorPeer = { id: 'peer-operador', principal: { kind: 'owner' }, interactions: 'none' };
  const services = {
    workingDirectory: { get: (session) => live.find((entry) => entry.session?.id === session?.id)?.cwd ?? '' },
    agents: { list: () => live },
  };
  if (Array.isArray(workspaces)) {
    services.workspaceRegistry = { list: () => workspaces, get: (id) => workspaces.find((item) => item.id === id) };
  }
  if (skills !== null) services.skills = skills;
  if (connection !== 'missing') {
    services.connection = {
      browserPeer,
      admit: ({ headers }) => {
        if (connection === 'untrusted') return { rejection: 403 };
        if (connection === 'api-peer') return { peer: operatorPeer };
        if (connection === 'unavailable') throw new Error('la conexión está de baja');
        if (String(headers?.cookie ?? '') === '') return { rejection: 401 };
        return { peer: browserPeer };
      },
    };
  }
  const ctx = {
    get: (key) => services[key],
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
    skills: {
      registerProvider: (callback) => {
        providers.push(callback({ invalidate: () => {} }));
      },
    },
    effect: (callback) => {
      const cleanup = callback();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
      return () => {};
    },
    inject: (names, callback) => {
      assert.deepEqual(names, ['webServer']);
      callback({ webServer: { register: (route) => { routes.push(route); return () => {}; }, getOrigin: () => 'http://127.0.0.1:57238' } });
    },
    workingDirectory: { get: () => cwd },
    logger: { info: () => {} },
  };
  return { ctx, routes, providers, teardown() { for (const cleanup of cleanups) cleanup(); } };
}

function fakeResponse() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    payload: '',
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    end(payload = '') { this.payload = String(payload); },
  };
}

function fakeRequest({ method = 'GET', url = '/', body = null, origin = '', cookie = 'dsh-auth-prueba=1', headers = {} } = {}) {
  const listeners = new Map();
  const sent = {};
  if (origin !== '') sent.origin = origin;
  if (cookie !== '') sent.cookie = cookie;
  Object.assign(sent, headers);
  const req = {
    method,
    url,
    headers: sent,
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(callback);
      return req;
    },
  };
  setImmediate(() => {
    if (body !== null) for (const callback of listeners.get('data') ?? []) callback(Buffer.from(body, 'utf8'));
    for (const callback of listeners.get('end') ?? []) callback();
  });
  return req;
}

async function callRoute(route, options) {
  const res = fakeResponse();
  await route.handler(fakeRequest(options), res);
  return { status: res.statusCode, headers: res.headers, body: res.payload === '' ? null : JSON.parse(res.payload) };
}

const temporary = [];
function sandbox(label) {
  const dir = mkdtempSync(join(tmpdir(), `lsc-r16-sec-${label}-`));
  temporary.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

function treeHash(dir) {
  if (!existsSync(dir)) return 'ausente';
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(dir);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(file.slice(dir.length).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return `${files.length}:${hash.digest('hex')}`;
}

function writeSkill(root, name, body = '## Procedimiento\n\nHaz algo.\n') {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: skill ${name}\n---\n\n${body}`);
  return {
    id: name,
    name,
    description: `skill ${name}`,
    whenToUse: `cuando haga falta ${name}`,
    body,
    provider: 'filesystem',
    path: join(dir, 'SKILL.md'),
  };
}

/** Monta el plugin con almacén/dshHome/agentsHome/proyecto propios y devuelve la ruta montada. */
async function withHost({ snapshot = null, workspaces = null, connection = 'host' } = {}, run) {
  const store = sandbox('store');
  const dshHome = sandbox('dsh');
  const agentsHome = sandbox('agents');
  const work = sandbox('work');
  const project = join(work, 'proyecto');
  mkdirSync(project, { recursive: true });
  const skills = snapshot === null
    ? { registerProvider: () => {} }
    : { registerProvider: () => {}, snapshot };
  const fake = fakeContext({ cwd: project, workspaces, connection, skills });
  try {
    apply(fake.ctx, { root: store, dshHome, agentsHome });
    assert.equal(fake.routes.length, 1, 'el adaptador registra la ruta');
    assert.equal(fake.routes[0].path, API_PREFIX);
    return await run({ store, dshHome, agentsHome, project, work, route: fake.routes[0] });
  } finally {
    fake.teardown();
  }
}

function post(route, action, payload = {}, options = {}) {
  return callRoute(route, { method: 'POST', url: `${API_PREFIX}/`, body: JSON.stringify({ action, ...payload }), ...options });
}

// ── 1. Una skill externa en disco no se sobrescribe ni se borra ───────────────────────────────────

test('ninguna acción normal toca una skill externa: crear, registrar y materializar dejan el disco igual', async () => {
  await withHost({ snapshot: async () => ({ skills: [writeSkill(sandbox('skills'), 'externa')], complete: true }) }, async ({ route, dshHome, project }) => {
    const external = join(dshHome, 'skills', 'externa', 'SKILL.md');
    mkdirSync(dirname(external), { recursive: true });
    const original = '---\nname: externa\ndescription: mía\n---\n\n## Procedimiento\n\nno me toques\n';
    writeFileSync(external, original);
    const before = treeHash(dshHome);

    const created = await post(route, 'create', candidate({ id: 'skill-nueva-r16' }));
    assert.ok([200, 409, 400].includes(created.status), `create no puede reventar: ${created.status}`);
    const registered = await post(route, 'register-project', { cwd: project });
    assert.equal(registered.status, 200);
    const id = registered.body.project.id;
    const materialized = await post(route, 'materialize-project', { projectId: id });
    assert.ok([200, 409].includes(materialized.status), `materialize respondió ${materialized.status}`);

    assert.equal(readFileSync(external, 'utf8'), original, 'la skill externa conserva su contenido byte a byte');
    assert.equal(treeHash(dshHome), before, 'y su árbol no cambia');
  });
});

// ── 2. Descubrir un proyecto externo no lo modifica ─────────────────────────────────────────────

test('descubrir un proyecto externo no escribe ni borra nada dentro del proyecto', async () => {
  const workspaces = [];
  await withHost({ workspaces }, async ({ route, project }) => {
    writeFileSync(join(project, 'codigo.txt'), 'contenido del usuario');
    mkdirSync(join(project, '.dsh', 'skills'), { recursive: true });
    writeFileSync(join(project, '.dsh', 'skills', 'local.md'), 'local');
    workspaces.push({ id: 'ws-1', path: project, title: 'proyecto', sessionIds: [], status: async () => 'ok' });
    const before = treeHash(project);

    const listing = await callRoute(route, { method: 'GET', url: `${API_PREFIX}/projects` });
    assert.equal(listing.status, 200);
    assert.equal(listing.body.discovered.length, 1);
    assert.equal(listing.body.projects.length, 0);
    assert.equal(treeHash(project), before, 'descubrir es de sólo lectura');
  });
});

// ── 3. Un error de inventario no produce éxito ──────────────────────────────────────────────────

test('un error del catálogo no produce éxito ni escribe la vista materializada', async () => {
  await withHost({ snapshot: async () => { throw new Error('catálogo caído'); } }, async ({ route, store, dshHome, project }) => {
    const registered = await post(route, 'register-project', { cwd: project });
    assert.equal(registered.status, 200);
    const id = registered.body.project.id;
    const storeBefore = treeHash(store);
    const dshBefore = treeHash(dshHome);

    const materialized = await post(route, 'materialize-project', { projectId: id });
    assert.notEqual(materialized.status, 200, 'sin catálogo no hay 200');
    assert.equal(materialized.body.ok, false);
    assert.match(String(materialized.body.code), /preflight-blocked|evidence-incomplete|skills-registry-unavailable/);
    assert.equal(existsSync(join(store, 'materialized', id)), false, 'no se escribió la vista');
    assert.equal(treeHash(dshHome), dshBefore, 'ni se tocó el catálogo externo');
    assert.equal(treeHash(store), storeBefore, 'el intento bloqueado no deja basura');

    const inventory = await callRoute(route, { method: 'GET', url: `${API_PREFIX}/inventory` });
    assert.notEqual(inventory.status, 500, 'una fuente caída no es un error interno');
    assert.equal(inventory.body.ok, true, 'la lectura responde, pero…');
    assert.equal(inventory.body.complete, false, '…declarándose incompleta, nunca completa');
    const skillsRow = inventory.body.sources.find((row) => row.id === 'skills-registry');
    assert.notEqual(skillsRow.status, 'complete');
  });
});

// ── 4. Admisión ────────────────────────────────────────────────────────────────────────────────

test('sin credencial 401, Host desconfiado 403, servicio ausente 503 y origen ajeno 403', async () => {
  await withHost({}, async ({ route }) => {
    const noCookie = await callRoute(route, { method: 'GET', url: `${API_PREFIX}/projects`, cookie: '' });
    assert.equal(noCookie.status, 401);
    assert.equal(noCookie.body.code, 'unauthorized');
  });
  await withHost({ connection: 'untrusted' }, async ({ route }) => {
    const untrusted = await callRoute(route, { method: 'GET', url: `${API_PREFIX}/projects` });
    assert.equal(untrusted.status, 403);
  });
  await withHost({ connection: 'missing' }, async ({ route }) => {
    const missing = await callRoute(route, { method: 'GET', url: `${API_PREFIX}/projects` });
    assert.equal(missing.status, 503);
  });
  await withHost({}, async ({ route }) => {
    const foreign = await callRoute(route, { method: 'GET', url: `${API_PREFIX}/projects`, origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.code, 'cross-origin');
  });
});

test('una credencial de operador (api-peer) no puede ejecutar POST', async () => {
  await withHost({ connection: 'api-peer' }, async ({ route, store }) => {
    const before = treeHash(store);
    const response = await post(route, 'register-project', { cwd: '' });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'api-peer-restricted');
    assert.equal(treeHash(store), before, 'rechazar no puede escribir');
  });
});

// ── 5. Rutas de escape ────────────────────────────────────────────────────────────────────────

test('un projectId con .. no escribe fuera del almacén', async () => {
  await withHost({}, async ({ route, store }) => {
    const escape = join(dirname(store), 'escape-r16');
    rmSync(escape, { recursive: true, force: true });
    const response = await post(route, 'materialize-project', { projectId: `../../${'escape-r16'}` });
    assert.notEqual(response.status, 200);
    assert.equal(existsSync(escape), false, 'ningún camino de escape crea directorios fuera de la raíz');
  });
});

test('register-project rechaza un cwd fuera de la raíz con 400 invalid-cwd y no escribe', async () => {
  const store = sandbox('store');
  const before = treeHash(store);
  for (const cwd of ['..\\..', '../..']) {
    const direct = await handleApiRequest({
      root: store,
      method: 'POST',
      pathname: `${API_PREFIX}/`,
      body: { action: 'register-project', cwd },
    });
    assert.equal(direct.status, 400, `«${cwd}» no se registra`);
    assert.equal(direct.body.ok, false);
    assert.equal(direct.body.code, 'invalid-cwd');
  }
  assert.equal(treeHash(store), before, 'un cwd inválido no escribe el almacén');
  assert.equal(Object.keys(loadState(store).state.projects).length, 0);

  // Con el adaptador montado y una sesión viva, el cwd del cliente tampoco manda: 400, cero altas.
  await withHost({}, async ({ route, store: hostStore }) => {
    const response = await post(route, 'register-project', { cwd: '..\\..' });
    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.equal(Object.values(loadState(hostStore).state.projects).some((project) => project.cwd === '..\\..' || project.cwd === '../..'), false, 'no se registra una ruta de escape');
  });
});

// ── 6. Las respuestas no exponen secretos ────────────────────────────────────────────────────

test('las respuestas no incluyen contenido de .env ni secretos del proyecto', async () => {
  const skills = [writeSkill(sandbox('skills'), 'publica')];
  await withHost({ snapshot: async () => ({ skills, complete: true }) }, async ({ route, project, dshHome }) => {
    writeFileSync(join(project, '.env'), 'DB_PASSWORD=supersecreto-r16\nDB_HOST=127.0.0.1\n');
    mkdirSync(join(dshHome, 'skills'), { recursive: true });
    writeFileSync(join(dshHome, 'skills', 'secreta.md'), 'TOKEN-INTERNO-r16\n');
    const registered = await post(route, 'register-project', { cwd: project });
    const bodies = [registered.body];
    for (const [method, action, payload] of [
      ['GET', null, null],
      ['GET', 'inventory', null],
      ['POST', 'materialize-project', { projectId: registered.body.project.id }],
    ]) {
      const response = action === null
        ? await callRoute(route, { method, url: `${API_PREFIX}/projects` })
        : action === 'inventory'
          ? await callRoute(route, { method, url: `${API_PREFIX}/inventory` })
          : await post(route, action, payload);
      bodies.push(response.body);
    }
    const text = JSON.stringify(bodies);
    for (const secret of ['supersecreto-r16', 'TOKEN-INTERNO-r16', 'DB_PASSWORD', 'DB_HOST']) {
      assert.equal(text.includes(secret), false, `la respuesta filtra «${secret}»`);
    }
  });
});

// ── 7. open-workspace ────────────────────────────────────────────────────────────────────────

test('open-workspace responde 501 con clientAction y no simula la apertura', async () => {
  await withHost({}, async ({ route, store }) => {
    const before = treeHash(store);
    const response = await post(route, 'open-workspace', { workspaceId: 'ws-1' });
    assert.equal(response.status, 501);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.code, 'host-action-unsupported');
    assert.equal(response.body.clientAction, 'uiWorkspace.openWorkspace');
    assert.equal(response.body.workspaceId, 'ws-1');
    assert.equal(treeHash(store), before, 'el panel no puede fingir que abrió algo');
  });
});

// ── 8. No-regresión ──────────────────────────────────────────────────────────────────────────

test('no-regresión: los ficheros de esta ronda no tocan el almacén real del usuario', () => {
  const files = ['tests/r16-contract.test.mjs', 'tests/r16-security.test.mjs', 'tests/r16-e2e-sim.test.mjs', 'tools/r16-e2e.mjs', 'tools/r16-collision-matrix.mjs'];
  const plugin = join(import.meta.dirname, '..');
  const forbidden = [new RegExp(`home${'dir'}\\s*\\(`), new RegExp(`USER${'PROFILE'}|APP${'DATA'}`), new RegExp("[\"`']~[\\\\/]\\.dsh")];
  for (const relative of files) {
    const path = join(plugin, relative);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const pattern of forbidden) assert.equal(pattern.test(text), false, `${relative} coincide con ${pattern}`);
    if (/writeFileSync|writeFile|mkdirSync|rmSync|appendFileSync|createWriteStream/.test(text)) {
      assert.match(text, /mkdtempSync|tmpdir\(\)/, `${relative} escribe y debe trabajar en caja temporal`);
    }
  }
});
