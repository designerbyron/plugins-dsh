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
function fakeContext({ webServer = true, cwd = '' } = {}) {
  const sections = [];
  const tools = [];
  const routes = [];
  const cleanups = [];
  const providers = [];
  const logs = [];
  let invalidations = 0;
  let disposed = 0;
  let torndown = false;

  const ctx = {
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
      callback(webServer ? { webServer: { register: (route) => { routes.push(route); return () => { disposed += 1; }; } } } : {});
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

function postRequest(payload) {
  return new Request(`http://127.0.0.1:57238${API_PREFIX}state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('se identifica con el nombre del plugin y declara los servicios que necesita', () => {
  assert.equal(name, 'lifecode-skill-center');
  assert.deepEqual([...inject], ['tools', 'skills', 'systemPrompt']);
  assert.equal(API_PREFIX, '/lifecode-skill-center/api/');
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

test('la ruta del panel es un prefijo propio y se retira al descargar', async () => {
  await withCenter({}, ({ fake }) => {
    assert.equal(fake.routes.length, 1);
    assert.equal(fake.routes[0].kind, 'prefix');
    assert.equal(fake.routes[0].path, API_PREFIX);
    assert.equal(typeof fake.routes[0].resource, 'function');
    fake.teardown();
    assert.equal(fake.disposed, 1, 'la ruta se tiene que dar de baja con el plugin');
  });
});

test('GET devuelve el estado en JSON y no cachea', async () => {
  await withCenter({ cwd: 'C:\\proyecto\\actual' }, async ({ fake }) => {
    const resource = fake.routes[0].resource;
    const response = await resource(new Request(`http://127.0.0.1:57238${API_PREFIX}state?scan=0`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.apiVersion, 1);
    assert.equal(body.storeExists, false, 'el primer arranque no tiene que inventar un almacén');
    assert.equal(body.project.cwd, 'C:/proyecto/actual');
  });
});

test('POST ejecuta la acción y avisa al catálogo cuando cambia lo que el agente ve', async () => {
  await withCenter({}, async ({ fake }) => {
    const response = await fake.routes[0].resource(postRequest({ action: 'create', actor: 'human', payload: SKILL_INPUT }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true, JSON.stringify(body.findings ?? body.message ?? ''));
    assert.equal(fake.invalidations, 1, 'crear cambia el catálogo: hay que invalidarlo');
  });
});

test('POST con actor «ai» no puede encender una skill para un proyecto', async () => {
  await withCenter({}, async ({ root, fake }) => {
    assert.equal(runAction({ root, action: 'create', actor: 'human', payload: SKILL_INPUT }).ok, true);
    assert.equal(runAction({ root, action: 'register-project', actor: 'human', cwd: 'C:\\proyecto\\actual' }).ok, true);

    const response = await fake.routes[0].resource(postRequest({
      action: 'toggle',
      actor: 'ai',
      cwd: 'C:\\proyecto\\actual',
      payload: { skillId: SKILL_INPUT.id, enabled: true },
    }));
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'approval-required');
    assert.equal(fake.invalidations, 0, 'lo rechazado no puede invalidar el catálogo');
  });
});

test('un método que no es GET ni POST responde 405 y un cuerpo roto responde 400', async () => {
  await withCenter({}, async ({ fake }) => {
    const resource = fake.routes[0].resource;
    const notAllowed = await resource(new Request(`http://127.0.0.1:57238${API_PREFIX}state`, { method: 'PUT' }));
    assert.equal(notAllowed.status, 405);

    const broken = await resource(new Request(`http://127.0.0.1:57238${API_PREFIX}state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{no es json',
    }));
    const body = await broken.json();
    assert.equal(broken.status, 400, 'un POST sin acción no puede contestar con el estado: escondería el fallo');
    assert.equal(body.code, 'bad-request');

    const noAction = await resource(postRequest({ payload: SKILL_INPUT }));
    assert.equal((await noAction.json()).code, 'bad-request');
  });
});

test('sin servidor web el plugin conserva herramientas y catálogo', async () => {
  await withCenter({ webServer: false }, ({ fake }) => {
    assert.equal(fake.routes.length, 0);
    assert.equal(fake.tools.length, 4);
    assert.equal(fake.providers.length, 1);
  });
});
