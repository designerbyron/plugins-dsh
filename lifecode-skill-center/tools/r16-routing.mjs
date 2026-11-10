#!/usr/bin/env node
/**
 * R16.2 — verificación de ROUTING real y de los cinco estados de compatibilidad.
 *
 * Primera parte: monta el adaptador Cordis REAL (`apply`) y despacha por el handler que el plugin
 * registra en `webServer.register({kind:'prefix', path: API_PREFIX})`. No llama funciones puras ni
 * inventa el contrato: mide lo que vería el servidor HTTP del Host.
 *
 * Segunda parte: ejecuta el panel real con `_audit/r16-render.mjs` en los cinco modos del handshake
 * (`compatible|legacy|incompatible|unavailable|auth`) y comprueba que cada uno pinta su estado sin
 * caer en la tarjeta de diagnóstico. Sólo lee; no regenera capturas ni toca datos reales.
 *
 * Uso: node tools/r16-routing.mjs   (desde cualquier cwd; las rutas se resuelven respecto al fichero)
 * Salida: una línea PASS/FAIL por expectativa y exit 1 si alguna falla.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(HERE, '..');
const REPO = resolve(PLUGIN, '..');
const RENDER = join(REPO, '_audit', 'r16-render.mjs');
const API = '/lifecode-skill-center/api';

const { apply } = await import(pathToFileURL(join(PLUGIN, 'index.js')).href);
const { API_CONTRACT_VERSION, CAPABILITY_IDS } = await import(pathToFileURL(join(PLUGIN, 'lib', 'api.mjs')).href);
const { centerFile } = await import(pathToFileURL(join(PLUGIN, 'lib', 'state.mjs')).href);
const PACKAGE = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'));

const boxes = [];
function box(label) {
  const dir = join(tmpdir(), `lsc-r162-routing-${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  boxes.push(dir);
  return dir;
}
function digest(root) {
  const file = centerFile(root);
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'missing';
}

function mount({ root, dshHome, services = {}, connection = 'host' }) {
  const routes = [];
  const browserPeer = { id: 'peer-routing' };
  const state = {
    connection: connection === 'missing' ? undefined : {
      browserPeer,
      admit: ({ headers }) => (String(headers?.cookie ?? '') === '' ? { rejection: 401 } : { peer: browserPeer }),
    },
    ...services,
  };
  const ctx = {
    get: (key) => state[key],
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
    skills: { registerProvider: (callback) => callback({ invalidate: () => {} }) },
    effect: (callback) => callback(),
    inject: (names, callback) => callback({ webServer: { register: (route) => { routes.push(route); return () => {}; }, getOrigin: () => 'http://127.0.0.1:1' } }),
    logger: { info: () => {}, warn: () => {} },
  };
  apply(ctx, { root, dshHome });

  const dispatch = async ({ method = 'GET', pathname = API, body = null, headers = undefined } = {}) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const listeners = new Map();
    const req = {
      method,
      url: pathname,
      headers: headers ?? { cookie: 'dsh-auth-routing=1' },
      on(event, callback) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(callback); return req; },
    };
    const res = { statusCode: 0, payload: '', setHeader() {}, end(value = '') { this.payload = String(value); } };
    const done = new Promise((resolveDone) => { const original = res.end.bind(res); res.end = (value = '') => { original(value); resolveDone(); }; });
    routes[0].handler(req, res);
    if (payload !== null) {
      for (const callback of listeners.get('data') ?? []) callback(payload);
      for (const callback of listeners.get('end') ?? []) callback();
    }
    await done;
    let parsed = null;
    try { parsed = JSON.parse(res.payload); } catch { parsed = res.payload; }
    return { status: res.statusCode, body: parsed };
  };
  return { routes, dispatch, state };
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: condition === true, detail });
  console.log(`${condition === true ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`);
}

/* ------------------------------------------------------------------ backend real */
const workspace = box('ws');
const root = box('root');
const dshHome = box('dsh');
const before = digest(root);
const services = {
  workspaceRegistry: { list: () => [{ id: 'ws-routing', path: workspace, title: 'workspace routing', sessionIds: [], status: async () => 'ok' }] },
  skills: { snapshot: async () => ({ skills: [], complete: true }) },
  loader: { entries: () => [] },
  workingDirectory: { get: () => workspace },
  agents: { list: () => [{ session: { id: 's-routing' }, cwd: workspace }] },
};
const host = mount({ root, dshHome, services });

check('apply registra exactamente una ruta prefix en el prefijo del contrato',
  host.routes.length === 1 && host.routes[0].kind === 'prefix' && host.routes[0].path === API && typeof host.routes[0].handler === 'function',
  `${host.routes.length} ruta(s)`);

const capabilities = await host.dispatch({ pathname: `${API}/capabilities`, headers: {} });
check('GET capabilities por el handler: 200 sin credencial, contrato 2 y capacidades completas',
  capabilities.status === 200
  && capabilities.body?.contractVersion === API_CONTRACT_VERSION
  && Array.isArray(capabilities.body?.capabilities)
  && CAPABILITY_IDS.every((id) => capabilities.body.capabilities.includes(id))
  && capabilities.body?.plugin?.version === PACKAGE.version,
  `status ${capabilities.status}, contract ${capabilities.body?.contractVersion}`);

for (const [label, pathname] of [['projects', `${API}/projects`], ['inventory', `${API}/inventory`], ['workspaces', `${API}/workspaces`]]) {
  const response = await host.dispatch({ pathname });
  check(`GET ${label} por el handler: 200 ok`, response.status === 200 && response.body?.ok === true, `status ${response.status}`);
  if (label !== 'workspaces') {
    check(`GET ${label} declara contractVersion 2 de forma aditiva`, response.body?.contractVersion === API_CONTRACT_VERSION && response.body?.apiVersion === 1, `apiVersion ${response.body?.apiVersion}`);
  } else {
    check('GET workspaces nuevo declara `deprecated` (no es señal de backend viejo)', response.body?.deprecated === true, String(response.body?.deprecated));
  }
}

const missingRoute = await host.dispatch({ pathname: `${API}/ruta-que-no-existe` });
check('404 de RUTA: code not-found', missingRoute.status === 404 && missingRoute.body?.code === 'not-found', `status ${missingRoute.status}`);
const missingEntity = await host.dispatch({ method: 'POST', pathname: API, body: { action: 'inspect-project', projectId: 'no-existe' } });
check('404 de ENTIDAD: code project-not-found (distinto del de ruta)',
  missingEntity.status === 404 && missingEntity.body?.code === 'project-not-found' && missingEntity.body?.code !== missingRoute.body?.code,
  `status ${missingEntity.status}`);

const unauthorized = await host.dispatch({ pathname: `${API}/projects`, headers: {} });
check('sin credencial: 401 unauthorized en la ruta de datos', unauthorized.status === 401 && unauthorized.body?.code === 'unauthorized', `status ${unauthorized.status}`);

const anonymousHost = mount({ root: box('root-anon'), dshHome: box('dsh-anon'), services, connection: 'missing' });
const anonCapabilities = await anonymousHost.dispatch({ pathname: `${API}/capabilities`, headers: {} });
const anonProjects = await anonymousHost.dispatch({ pathname: `${API}/projects`, headers: {} });
check('sin servicio connection: capabilities 200 y rutas de datos 503 auth-unavailable',
  anonCapabilities.status === 200 && anonProjects.status === 503 && anonProjects.body?.code === 'auth-unavailable',
  `capabilities ${anonCapabilities.status}, projects ${anonProjects.status}`);

check('ninguna lectura del handshake ni de las rutas escribió en el almacén', digest(root) === before, `digest ${digest(root)}`);

/* --------------------------------------------------------- cliente: 5 estados reales */
const MODES = ['compatible', 'legacy', 'incompatible', 'unavailable', 'auth'];
for (const mode of MODES) {
  const run = spawnSync(process.execPath, [RENDER, '--html-only', `--compat=${mode}`], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, LIFECODE_SKILL_CENTER_RENDER: '1' },
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  check(`cliente --compat=${mode}: render estable con su estado (no blanco)`,
    run.status === 0 && new RegExp(`COMPAT ${mode} `).test(output),
    `exit ${run.status}`);
}

for (const dir of boxes) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* temporal */ }
}

const failed = results.filter((item) => item.pass !== true);
console.log(`\nR16.2 routing: ${results.length - failed.length}/${results.length} PASS · ${failed.length} FAIL`);
process.exitCode = failed.length === 0 ? 0 : 1;
