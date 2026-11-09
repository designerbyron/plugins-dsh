/**
 * El adaptador Cordis, medido contra un `ctx` de mentira.
 *
 * `index.js` es la única pieza que el harness monta y que no se puede probar dentro del harness antes de
 * instalar. Con un `ctx` mínimo se comprueba lo que de verdad importa: que registra los cuatro puntos de
 * extensión, que la ruta habla JSON, que la autorización viaja con el actor, y que retirar el plugin
 * retira lo que montó (recargarlo no puede chocar con «esa ruta ya existe»).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, name, inject, API_PREFIX } from '../index.js';
import { PROVIDER_NAME, PROVIDER_RANK } from '../lib/provider.mjs';
import { runAction } from '../lib/api.mjs';
import { centerFile, loadState } from '../lib/state.mjs';
import { createHash } from 'node:crypto';
import { readFileSync as readBytes } from 'node:fs';

const SKILL_BODY = [
  '## Procedimiento',
  '',
  'Escribe la skill en el almacén del centro, evalúa su estructura con la compuerta de calidad y comprueba que se materializa en el proyecto autorizado antes de decir que está lista.',
  '',
  '## Evidencia',
  '',
  'La prueba hermética queda en verde y el panel muestra la versión publicada con su resumen de calidad.',
].join('\n');

const SKILL_INPUT = {
  id: 'cocina-el-centro-de-skills',
  description: 'Cocina el centro de skills de Lifecode con pruebas herméticas y evidencia legible',
  whenToUse: 'Cuando haya que crear o revisar una skill del centro de Lifecode',
  body: SKILL_BODY,
};

/**
 * Un `ctx` del harness reducido a lo que el plugin usa, con todo lo registrado a la vista.
 *
 * `connection` reproduce lo medido en el escritorio: `admit` devuelve el **mismo** objeto de
 * `browserPeer` cuando la credencial de navegador es válida, un peer distinto cuando la credencial es de
 * operador, y `{rejection}` cuando no hay credencial o el Host no confía. 'missing' simula un harness sin
 * el servicio; 'no-peer' una admisión que no devuelve peer (contrato roto).
 */
function fakeContext({ webServer = true, cwd = '', sessions, connection = 'host', workspaces = null } = {}) {
  const sections = [];
  const tools = [];
  const routes = [];
  const cleanups = [];
  const providers = [];
  const logs = [];
  // Lo que devuelve `agents.list()`: sesiones vivas con su directorio. La última es la más reciente,
  // que es la que el panel debe ofrecer por defecto.
  const live = Array.isArray(sessions) ? sessions : cwd === '' ? [] : [{ session: { id: 'sesion-falsa' }, cwd }];
  let invalidations = 0;
  let disposed = 0;
  let torndown = false;

  const browserPeer = { id: 'peer-navegador', principal: { kind: 'owner' }, interactions: 'answer' };
  const operatorPeer = { id: 'peer-operador', principal: { kind: 'owner' }, interactions: 'none' };

  // El servicio real recibe la sesión y devuelve su directorio; aquí se resuelve por id.
  const services = {
    workingDirectory: { get: (session) => live.find((entry) => entry.session?.id === session?.id)?.cwd ?? '' },
    agents: { list: () => live },
  };

  // El registro de workspaces es opcional en el Host: se inyecta sólo en las pruebas que lo piden.
  if (Array.isArray(workspaces)) {
    services.workspaceRegistry = { list: () => workspaces, get: (id) => workspaces.find((item) => item.id === id) };
  }

  if (connection !== 'missing') {
    services.connection = {
      browserPeer,
      admit: ({ headers }) => {
        if (connection === 'untrusted') return { rejection: 403 };
        if (connection === 'no-peer') return {};
        if (connection === 'api-peer') return { peer: operatorPeer };
        if (connection === 'unavailable') throw new Error('la conexión está de baja');
        const cookie = String(headers?.cookie ?? '');
        if (cookie === '') return { rejection: 401 };
        return { peer: browserPeer };
      },
    };
  }

  const ctx = {
    get: (key) => services[key],
    systemPrompt: { section: (options) => sections.push(options) },
    tools: { register: (tool) => tools.push(tool) },
    skills: {
      registerProvider: (callback) => {
        providers.push(callback({ invalidate: () => { invalidations += 1; } }));
      },
    },
    effect: (callback) => {
      const cleanup = callback();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
      return () => {};
    },
    inject: (services, callback) => {
      assert.deepEqual(services, ['webServer']);
      callback(webServer ? { webServer: { register: (route) => { routes.push(route); return () => { disposed += 1; }; }, getOrigin: () => 'http://127.0.0.1:57238' } } : {});
    },
    workingDirectory: { get: () => cwd },
    logger: { info: (line) => logs.push(line) },
  };

  return {
    ctx,
    sections,
    tools,
    routes,
    cleanups,
    providers,
    logs,
    get invalidations() { return invalidations; },
    get disposed() { return disposed; },
    teardown() {
      if (torndown) return;
      torndown = true;
      for (const cleanup of cleanups) cleanup();
    },
  };
}

/** Monta el plugin sobre una raíz de usar y tirar y desmonta siempre, aunque la prueba falle. */
async function withCenter(options, run) {
  const root = mkdtempSync(join(tmpdir(), 'lsc-index-'));
  const fake = fakeContext(options);
  try {
    apply(fake.ctx, { root });
    return await run({ root, fake });
  } finally {
    fake.teardown();
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Un `ServerResponse` de mentira: lo justo para comprobar el estado, las cabeceras y el cuerpo.
 */
function fakeResponse() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    payload: '',
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    end(payload = '') {
      this.payload = String(payload);
    },
  };
}

/**
 * Un `IncomingMessage` de mentira. Emite el cuerpo y el fin en cuanto alguien escucha, que es el orden
 * en el que el adaptador los consume. Por defecto trae la cookie que el shell inyecta en el canal del
 * panel; `cookie: ''` es el caso del proceso local sin credencial.
 */
function fakeRequest({ method = 'GET', url = '/', body = null, origin = '', cookie = 'dsh-auth-prueba=1', headers = {} } = {}) {
  const listeners = new Map();
  const sent = {};
  if (origin !== '') sent.origin = origin;
  if (cookie !== '') sent.cookie = cookie;
  for (const [name, value] of Object.entries(headers)) sent[name] = value;
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
    if (body !== null) {
      for (const callback of listeners.get('data') ?? []) callback(Buffer.from(body, 'utf8'));
    }
    for (const callback of listeners.get('end') ?? []) callback();
  });
  return req;
}

/** Llama a la ruta montada como lo haría el servidor y devuelve `{status, headers, body}`. */
async function callRoute(route, options) {
  const res = fakeResponse();
  await route.handler(fakeRequest(options), res);
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.payload === '' ? null : JSON.parse(res.payload),
  };
}

test('se identifica con el nombre del plugin y declara los servicios que necesita', () => {
  assert.equal(name, 'lifecode-skill-center');
  assert.deepEqual([...inject], ['tools', 'skills', 'systemPrompt']);
  assert.equal(API_PREFIX, '/lifecode-skill-center/api', 'sin barra final: con barra, el harness sólo casaba la ruta exacta');
});

test('deja una sección de prompt corta que dice la asimetría del producto', async () => {
  await withCenter({}, ({ fake }) => {
    assert.equal(fake.sections.length, 1);
    const [section] = fake.sections;
    assert.equal(section.name, 'lifecode-skill-center:protocol');
    assert.equal(section.order, 9001);
    assert.equal(section.interpolate, false);
    assert.ok(section.text.length < 700, `la sección se paga en cada prompt: ${section.text.length} caracteres`);
    assert.match(section.text, /active nowhere/);
    assert.match(section.text, /lifecode_skill_search/);
  });
});

test('registra las cuatro herramientas del agente y ninguna que apruebe', async () => {
  await withCenter({}, ({ fake }) => {
    const names = fake.tools.map((tool) => tool.name);
    assert.deepEqual(names, ['lifecode_skill_search', 'lifecode_skill_create', 'lifecode_skill_improve', 'lifecode_skill_status']);
    for (const tool of fake.tools) {
      assert.equal(typeof tool.execute, 'function');
      assert.ok(tool.output?.schema, `${tool.name} necesita declarar su salida`);
      assert.equal(typeof tool.output.render, 'function');
    }
  });
});

test('sirve el catálogo con un provider propio, de rango menor que el compilador anterior', async () => {
  await withCenter({}, ({ fake }) => {
    assert.equal(fake.providers.length, 1);
    const provider = fake.providers[0];
    assert.equal(provider.name, PROVIDER_NAME);
    assert.equal(PROVIDER_RANK, 160, 'el rango va por debajo del compilador anterior (150)');
    assert.equal(typeof provider.list, 'function');
    assert.equal(typeof provider.get, 'function');
  });
});

test('monta el vigilante y la ruta, y desmontarlo dos veces no rompe nada', async () => {
  await withCenter({}, ({ fake }) => {
    assert.ok(fake.cleanups.length >= 2, 'vigilante del almacén y ruta del panel');
    for (const cleanup of fake.cleanups) cleanup();
    for (const cleanup of fake.cleanups) cleanup();
  });
});

test('la ruta del panel es un prefijo propio con `handler` — un `resource` no contesta POST', async () => {
  await withCenter({}, ({ fake }) => {
    assert.equal(fake.routes.length, 1);
    assert.equal(fake.routes[0].kind, 'prefix');
    assert.equal(fake.routes[0].path, API_PREFIX);
    // El servidor contesta «405 with Allow: GET, HEAD for any other method, checked before matching»
    // a un `resource`. Con `resource` el panel no podía guardar nada, y las pruebas no lo veían
    // porque llamaban al `resource` a mano.
    assert.equal(typeof fake.routes[0].handler, 'function', 'la ruta tiene que llevar `handler`');
    assert.equal(fake.routes[0].resource, undefined, 'un `resource` sólo sirve GET/HEAD');
    fake.teardown();
    assert.equal(fake.disposed, 1, 'la ruta se tiene que dar de baja con el plugin');
  });
});

test('GET devuelve el estado en JSON y no cachea', async () => {
  await withCenter({ cwd: 'C:\\proyecto\\actual' }, async ({ fake }) => {
    const response = await callRoute(fake.routes[0], { url: `${API_PREFIX}/state?scan=0` });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.body.ok, true);
    assert.equal(response.body.apiVersion, 1);
    assert.equal(response.body.storeExists, false, 'el primer arranque no tiene que inventar un almacén');
    assert.equal(response.body.project.cwd, 'C:/proyecto/actual');
  });
});

test('HEAD responde cabeceras sin cuerpo', async () => {
  await withCenter({}, async ({ fake }) => {
    const response = await callRoute(fake.routes[0], { method: 'HEAD', url: `${API_PREFIX}/state` });
    assert.equal(response.status, 200);
    assert.equal(response.body, null, 'HEAD no lleva cuerpo');
  });
});

test('POST ejecuta la acción y avisa al catálogo cuando cambia lo que el agente ve', async () => {
  await withCenter({}, async ({ fake }) => {
    const response = await callRoute(fake.routes[0], {
      method: 'POST',
      url: `${API_PREFIX}/state`,
      body: JSON.stringify({ action: 'create', actor: 'human', payload: SKILL_INPUT }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true, JSON.stringify(response.body.findings ?? response.body.message ?? ''));
    assert.equal(fake.invalidations, 1, 'crear cambia el catálogo: hay que invalidarlo');
  });
});

test('el cuerpo no elige el actor: un POST del panel con actor «ai» sigue siendo una persona', async () => {
  await withCenter({}, async ({ root, fake }) => {
    const created = runAction({ root, action: 'create', actor: 'human', payload: SKILL_INPUT });
    assert.equal(created.ok, true);
    const registered = runAction({ root, action: 'register-project', actor: 'human', cwd: 'C:\\proyecto\\actual' });
    assert.equal(registered.ok, true);
    const projectId = registered.project.id;

    // `actor:'ai'` en el cuerpo antes degradaba la petición a «la IA no puede»; ahora el actor lo pone el
    // canal, y el panel es el canal humano. Si el cuerpo mandara, este POST habría sido rechazado.
    const response = await callRoute(fake.routes[0], {
      method: 'POST',
      url: `${API_PREFIX}/state`,
      body: JSON.stringify({
        action: 'toggle',
        actor: 'ai',
        cwd: 'C:\\proyecto\\actual',
        payload: { projectId, skillId: SKILL_INPUT.id, enabled: true },
      }),
    });
    assert.equal(response.body.ok, true, JSON.stringify(response.body));
    const state = loadState(root).state;
    assert.equal(state.assignments[projectId][SKILL_INPUT.id].by, 'human', 'el cuerpo no puede escribir el actor');
    const last = state.events[state.events.length - 1];
    assert.equal(last.actor, 'human', 'el diario registra el canal, no lo que el cliente afirme');
  });
});

test('una cabecera de actor no concede autoridad', async () => {
  await withCenter({}, async ({ root, fake }) => {
    const created = runAction({ root, action: 'create', actor: 'human', payload: SKILL_INPUT });
    assert.equal(created.ok, true);
    const registered = runAction({ root, action: 'register-project', actor: 'human', cwd: 'C:\\proyecto\\actual' });
    assert.equal(registered.ok, true);
    const projectId = registered.project.id;
    const response = await callRoute(fake.routes[0], {
      method: 'POST',
      url: `${API_PREFIX}/state`,
      headers: { 'x-lifecode-actor': 'ai', 'x-lifecode-request': 'prueba-cabecera-actor' },
      body: JSON.stringify({ action: 'toggle', payload: { projectId, skillId: SKILL_INPUT.id, enabled: true } }),
    });
    assert.equal(response.body.ok, true, 'la cabecera se ignora: el canal es el que manda');
    const state = loadState(root).state;
    assert.equal(Object.values(Object.values(state.assignments)[0])[0].by, 'human');
  });
});

test('un método que no es GET ni POST responde 405 y un cuerpo roto responde 400', async () => {
  await withCenter({}, async ({ fake }) => {
    const route = fake.routes[0];
    const notAllowed = await callRoute(route, { method: 'PUT', url: `${API_PREFIX}/state` });
    assert.equal(notAllowed.status, 405);

    const broken = await callRoute(route, { method: 'POST', url: `${API_PREFIX}/state`, body: '{no es json' });
    assert.equal(broken.status, 400, 'un POST sin acción no puede contestar con el estado: escondería el fallo');
    assert.equal(broken.body.code, 'bad-request');

    const noAction = await callRoute(route, { method: 'POST', url: `${API_PREFIX}/state`, body: JSON.stringify({ payload: SKILL_INPUT }) });
    assert.equal(noAction.body.code, 'bad-request');
  });
});

test('sin servidor web el plugin conserva herramientas y catálogo', async () => {
  await withCenter({ webServer: false }, ({ fake }) => {
    assert.equal(fake.routes.length, 0);
    assert.equal(fake.tools.length, 4);
    assert.equal(fake.providers.length, 1);
  });
});

test('el proyecto actual sale de la sesión viva más reciente, no de una lectura única al montar', async () => {
  const sessions = [
    { session: { id: 'vieja' }, cwd: 'C:\\proyecto\\viejo' },
    { session: { id: 'nueva' }, cwd: 'C:\\proyecto\\nuevo' },
  ];
  await withCenter({ sessions }, async ({ fake }) => {
    const response = await callRoute(fake.routes[0], { url: `${API_PREFIX}/state?scan=0` });
    assert.equal(response.body.hostCwd, 'C:/proyecto/nuevo', 'el panel debe ofrecer la carpeta de la sesión más reciente');
    assert.equal(response.body.project.cwd, 'C:/proyecto/nuevo');
  });
});

test('una ruta que no es de la API responde 404 en vez de caer en el estado', async () => {
  await withCenter({}, async ({ fake }) => {
    const route = fake.routes[0];
    const foreign = await callRoute(route, { url: '/lifecode-skill-center/otra-cosa' });
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.code, 'not-found');

    const prefixed = await callRoute(route, { url: '/lifecode-skill-center/apixy' });
    assert.equal(prefixed.status, 404, 'el prefijo casa con «/» o con la base exacta, nunca con otra ruta que empiece igual');
  });
});

test('una petición de otra página se rechaza: el panel sólo atiende a su propio origen', async () => {
  await withCenter({}, async ({ fake }) => {
    const route = fake.routes[0];
    const ajeno = await callRoute(route, {
      method: 'POST',
      url: API_PREFIX + "/state",
      origin: 'http://evil.example',
      body: JSON.stringify({ action: 'state', payload: {}, cwd: process.cwd() }),
    });
    assert.equal(ajeno.status, 403);
    assert.equal(ajeno.body.code, 'cross-origin');

    const propio = await callRoute(route, {
      method: 'POST',
      url: API_PREFIX + "/state",
      origin: 'http://127.0.0.1:57238',
      body: JSON.stringify({ action: 'state', payload: {}, cwd: process.cwd() }),
    });
    assert.equal(propio.status, 200);
  });
});

// ── S1: admisión y seguridad del panel ────────────────────────────────────────────────────────────
// Lo que estas pruebas fijan no es «hay una condición»: es el contrato del borde. Un panel sin
// credencial no lee, un proceso local no escribe, un harness sin servicio de conexión no se convierte
// en lectura libre, y el cuerpo de la petición no elige quién firma el cambio.

function digestOf(path) {
  return createHash('sha256').update(readBytes(path)).digest('hex');
}

test('sin la credencial del Host la ruta privada no contesta el estado', async () => {
  await withCenter({}, async ({ root, fake }) => {
    for (const method of ['GET', 'POST']) {
      const response = await callRoute(fake.routes[0], {
        method,
        url: method === 'GET' ? `${API_PREFIX}/state?scan=0` : `${API_PREFIX}/state`,
        body: method === 'POST' ? JSON.stringify({ action: 'state' }) : null,
        cookie: '',
      });
      assert.equal(response.status, 401, `${method} sin credencial tiene que ser 401`);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.code, 'unauthorized');
      assert.ok(!('skills' in response.body), 'una negativa no puede arrastrar datos privados');
      assert.match(String(response.body.requestId), /^[a-z0-9-]{8,64}$/, 'la negativa deja un identificador de correlación');
    }
    assert.equal(loadState(root).exists, false, 'una petición no admitida no puede ni crear el almacén');
  });
});

test('un harness sin el servicio de conexión falla cerrado: 503, no lectura libre', async () => {
  await withCenter({ connection: 'missing' }, async ({ root, fake }) => {
    const read = await callRoute(fake.routes[0], { url: `${API_PREFIX}/state?scan=0` });
    assert.equal(read.status, 503);
    assert.equal(read.body.code, 'auth-unavailable');
    const write = await callRoute(fake.routes[0], {
      method: 'POST',
      url: `${API_PREFIX}/state`,
      body: JSON.stringify({ action: 'create', payload: SKILL_INPUT }),
    });
    assert.equal(write.status, 503);
    assert.equal(loadState(root).exists, false, 'sin admisión no se escribe nada');
  });
});

test('una admisión que no devuelve peer también falla cerrada', async () => {
  await withCenter({ connection: 'no-peer' }, async ({ fake }) => {
    const read = await callRoute(fake.routes[0], { url: `${API_PREFIX}/state?scan=0` });
    assert.equal(read.status, 503);
    assert.equal(read.body.code, 'auth-unavailable');
  });
});

test('un Host que no confía en la petición recibe 403', async () => {
  await withCenter({ connection: 'untrusted' }, async ({ fake }) => {
    const read = await callRoute(fake.routes[0], { url: `${API_PREFIX}/state?scan=0` });
    assert.equal(read.status, 403);
    assert.equal(read.body.code, 'forbidden');
  });
});

test('el navegador admitido manda: lee y escribe el centro', async () => {
  await withCenter({}, async ({ fake }) => {
    const created = await callRoute(fake.routes[0], {
      method: 'POST',
      url: `${API_PREFIX}/state`,
      body: JSON.stringify({ action: 'create', payload: SKILL_INPUT }),
    });
    assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 300));
    assert.equal(created.body.ok, true);
    const read = await callRoute(fake.routes[0], { url: `${API_PREFIX}/state?scan=0` });
    assert.equal(read.status, 200);
    assert.equal(read.body.skills.length, 1);
  });
});

test('una credencial de operador lee pero no cambia el centro', async () => {
  await withCenter({ connection: 'api-peer' }, async ({ fake }) => {
    const read = await callRoute(fake.routes[0], { url: `${API_PREFIX}/state?scan=0` });
    assert.equal(read.status, 200, 'la lectura de operador está justificada');
    const write = await callRoute(fake.routes[0], {
      method: 'POST',
      url: `${API_PREFIX}/state`,
      body: JSON.stringify({ action: 'create', payload: SKILL_INPUT }),
    });
    assert.equal(write.status, 403);
    assert.equal(write.body.code, 'api-peer-restricted');
  });
});

test('/health se sirve sin admisión, sin datos privados y con auth host o unavailable', async () => {
  await withCenter({ connection: 'missing' }, async ({ fake }) => {
    const response = await callRoute(fake.routes[0], { url: `${API_PREFIX}/health`, cookie: '' });
    assert.equal(response.status, 200, 'la salud contesta antes del rechazo por falta de connection');
    assert.deepEqual(Object.keys(response.body).sort(), ['apiVersion', 'auth', 'ok']);
    assert.equal(response.body.auth, 'unavailable');
  });
  await withCenter({}, async ({ fake }) => {
    const response = await callRoute(fake.routes[0], { url: `${API_PREFIX}/health` });
    assert.equal(response.body.auth, 'host');
  });
});

test('un POST no admitido no cambia un byte del almacén', async () => {
  await withCenter({}, async ({ root, fake }) => {
    assert.equal(runAction({ root, action: 'create', actor: 'human', payload: SKILL_INPUT }).ok, true);
    const before = digestOf(centerFile(root));
    const response = await callRoute(fake.routes[0], {
      method: 'POST',
      url: `${API_PREFIX}/state`,
      cookie: '',
      body: JSON.stringify({ action: 'toggle', payload: { skillId: SKILL_INPUT.id, enabled: true } }),
    });
    assert.equal(response.status, 401);
    assert.equal(digestOf(centerFile(root)), before, 'la negativa no puede dejar rastro en disco');
  });
});

test('las cuatro herramientas conservan sus permisos: la IA crea y propone, no activa', async () => {
  await withCenter({}, async ({ root, fake }) => {
    const create = fake.tools.find((tool) => tool.name === 'lifecode_skill_create');
    const improve = fake.tools.find((tool) => tool.name === 'lifecode_skill_improve');
    const exec = { agent: { session: { header: { cwd: '/proyecto/x' } } } };
    const created = await create.execute(SKILL_INPUT, exec);
    assert.equal(created.status, 'published');
    const improved = await improve.execute(
      { skillId: SKILL_INPUT.id, rationale: 'la ruta del panel quedó documentada' },
      exec,
    );
    assert.equal(improved.status, 'proposed');
    const state = loadState(root).state;
    assert.equal(state.skills[SKILL_INPUT.id].currentVersion, '1.0.0');
    assert.equal(Object.values(state.improvements)[0].status, 'proposed');
  });
});

// ── El inventario de workspaces (LSC-016) ──────────────────────────────────────────────────────────

/** Siete workspaces como los del Host, con su función `status()` resuelta. */
function hostWorkspaces() {
  const rows = [
    ['ws-businesssuite', 'C:\\xampp\\htdocs\\businesssuite', 'businesssuite', 1],
    ['ws-carlosdiaz', 'C:\\xampp\\htdocs\\carlosdiaz', 'carlosdiaz', 1],
    ['ws-edgar', 'C:\\xampp\\htdocs\\edgartreelawnservices', 'edgartreelawnservices', 1],
    ['ws-nexus', 'C:\\xampp\\htdocs\\nexusbusinesssuite', 'nexusbusinesssuite', 37],
    ['ws-duranspainting', 'C:\\xampp\\htdocs\\duranspainting', 'duranspainting', 2],
    ['ws-plugins', 'C:\\xampp\\htdocs\\plugins-dhs', 'plugins-dhs', 3],
    ['ws-saas', 'C:\\xampp\\htdocs\\saas-corporative', 'saas-corporative', 22],
  ];
  return rows.map(([id, path, title, sessions]) => ({
    id,
    path,
    title,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-09T02:15:06.542Z',
    sessionIds: Array.from({ length: sessions }, (_, index) => `session-${id}-${index + 1}`),
    status: async () => 'ok',
  }));
}

test('el inventario de workspaces se sirve por su ruta, con la admisión puesta', async () => {
  await withCenter({ cwd: 'C:/xampp/htdocs/plugins-dhs', workspaces: hostWorkspaces() }, async ({ root, fake }) => {
    const response = await callRoute(fake.routes[0], { url: '/lifecode-skill-center/api/workspaces' });
    assert.equal(response.status, 200);
    const body = response.body;
    assert.equal(body.ok, true);
    assert.equal(body.workspaces.length, 7);
    assert.deepEqual(body.workspaces.map((row) => row.workspaceId), hostWorkspaces().map((row) => row.id));
    assert.equal(body.workspaces.find((row) => row.workspaceId === 'ws-plugins').linkState, 'discovered');
    assert.equal(body.managed.length, 0);
    assert.equal(body.current.workspaceId, 'ws-plugins');
    for (const row of body.workspaces) assert.equal(row.sessionIds, undefined);
    // Leer el inventario no crea el almacén ni lo toca.
    assert.equal(existsSync(join(root, 'center.json')), false);
  });
});

test('sin registro de workspaces la ruta dice que no puede, y se puede reintentar', async () => {
  await withCenter({ cwd: 'C:/xampp/htdocs/plugins-dhs' }, async ({ fake }) => {
    const response = await callRoute(fake.routes[0], { url: '/lifecode-skill-center/api/workspaces' });
    assert.equal(response.status, 503);
    const body = response.body;
    assert.equal(body.ok, false);
    assert.equal(body.code, 'workspace-registry-unavailable');
    assert.equal(body.retryable, true);
    assert.match(body.message, /workspaceRegistry/);
  });
});
