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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, name, inject, API_PREFIX } from '../index.js';
import { PROVIDER_NAME, PROVIDER_RANK } from '../lib/provider.mjs';
import { runAction } from '../lib/api.mjs';

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

/** Un `ctx` del harness reducido a lo que el plugin usa, con todo lo registrado a la vista. */
function fakeContext({ webServer = true, cwd = '', sessions } = {}) {
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

  // El servicio real recibe la sesión y devuelve su directorio; aquí se resuelve por id.
  const services = {
    workingDirectory: { get: (session) => live.find((entry) => entry.session?.id === session?.id)?.cwd ?? '' },
    agents: { list: () => live },
  };

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
 * en el que el adaptador los consume.
 */
function fakeRequest({ method = 'GET', url = '/', body = null, origin = '' } = {}) {
  const listeners = new Map();
  const req = {
    method,
    url,
    headers: { origin },
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

test('POST con actor «ai» no puede encender una skill para un proyecto', async () => {
  await withCenter({}, async ({ root, fake }) => {
    assert.equal(runAction({ root, action: 'create', actor: 'human', payload: SKILL_INPUT }).ok, true);
    assert.equal(runAction({ root, action: 'register-project', actor: 'human', cwd: 'C:\\proyecto\\actual' }).ok, true);

    const response = await callRoute(fake.routes[0], {
      method: 'POST',
      url: `${API_PREFIX}/state`,
      body: JSON.stringify({
        action: 'toggle',
        actor: 'ai',
        cwd: 'C:\\proyecto\\actual',
        payload: { skillId: SKILL_INPUT.id, enabled: true },
      }),
    });
    assert.equal(response.body.ok, false);
    assert.equal(response.body.code, 'approval-required');
    assert.equal(fake.invalidations, 0, 'lo rechazado no puede invalidar el catálogo');
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
