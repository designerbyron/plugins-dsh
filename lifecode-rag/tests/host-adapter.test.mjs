/**
 * PA6 — adaptador del host (`index.js`) sin el host.
 *
 * Se construye un contexto falso con las mismas piezas que usa Cordis (`tools.register`, `get`,
 * `effect`, `on`, `logger`) y se comprueba lo único que el adaptador decide: qué se registra, cómo se
 * encadena `agent/pre-step`, y que el temporizador del host se usa y se libera con el efecto.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apply } from '../index.js';
import { writeConfig } from '../lib/paths.mjs';
import { makeEightWorld, fakeExec } from './pa4-helpers.mjs';

const SEVEN = [
  'lifecode_rag_ingest',
  'lifecode_rag_search',
  'lifecode_rag_context',
  'lifecode_rag_get',
  'lifecode_rag_list',
  'lifecode_rag_forget',
  'lifecode_rag_reindex',
];

function fakeCtx({ timer = null, webServer = null, cwd = null } = {}) {
  const tools = [];
  const effects = [];
  const listeners = new Map();
  const logs = [];
  const ctx = {
    tools: { register(definition) { tools.push(definition); return () => {}; } },
    get(name) {
      if (name === 'timer') return timer;
      if (name === 'webServer') return webServer;
      if (name === 'approval') return { request: async () => 'rejected' };
      if (name === 'workingDirectory') return { ensure: async () => cwd ?? process.cwd() };
      return undefined;
    },
    effect(fn) { const dispose = fn(); effects.push(dispose); return dispose; },
    on(event, handler) { listeners.set(event, handler); },
    logger: {
      debug(message) { logs.push(String(message)); },
      info() {},
      warn(message) { logs.push(String(message)); },
      error() {},
    },
  };
  return { ctx, tools, effects, listeners, logs };
}

function hostTimer() {
  const calls = [];
  let disposed = 0;
  return {
    calls,
    get disposed() { return disposed; },
    interval(callback, delay) {
      calls.push({ callback, delay });
      return () => { disposed += 1; };
    },
  };
}

/**
 * Aplica un entorno temporal a `process.env` mientras corre el trabajo. El adaptador lee
 * `process.env` (igual que el host), así que la prueba tiene que reproducir eso y el `work` debe
 * ejecutarse DENTRO del entorno, no después.
 */
async function withEnv(env, work) {
  const previous = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    process.env[key] = env[key];
  }
  try {
    return await work();
  } finally {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function humanPrompt(text) {
  return { id: 'm1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } };
}

test('el adaptador registra exactamente las siete herramientas del contrato', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const { ctx, tools } = fakeCtx();
    await withEnv(world.env, () => apply(ctx));
    assert.deepEqual(tools.map((definition) => definition.name), SEVEN);
    for (const definition of tools) {
      assert.equal(definition.parameters.type, 'object');
      assert.equal(typeof definition.execute, 'function');
    }
  } finally {
    world.cleanup();
  }
});

test('sin temporizador del host no se programa nada; con él se usa y se libera', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const plain = fakeCtx();
    await withEnv(world.env, () => apply(plain.ctx));
    assert.equal(plain.effects.length, 1, 'sólo el efecto de sincronización');
    assert.equal(typeof plain.effects[0], 'function');

    writeConfig(world.root, { automation: { enabled: true, intervalMs: 5_000 } });
    const timer = hostTimer();
    const wired = fakeCtx({ timer });
    await withEnv(world.env, () => apply(wired.ctx));
    assert.equal(timer.calls.length, 1, 'una programación por intervalo');
    assert.equal(timer.calls[0].delay, 5_000);
    wired.effects[0]();
    assert.equal(timer.disposed, 1, 'el disposer del efecto cierra el intervalo del host');
  } finally {
    world.cleanup();
  }
});

test('agent/pre-step añade el contexto al lote del paso cuando está habilitado', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    writeConfig(world.root, { autoContext: { enabled: true, maxChars: 900, maxChunks: 2, budgetTokens: 400 } });
    const { ctx, listeners, logs } = fakeCtx({ cwd: world.dirA });
    await withEnv(world.env, async () => {
      apply(ctx);
      const handler = listeners.get('agent/pre-step');
      assert.equal(typeof handler, 'function');
      const next = async () => ({ kind: 'enter', messages: [humanPrompt('¿qué pone kappaproyecto?')] });
      const decision = await handler({ agent: { id: 'sesion-a' }, turn: 1, step: 1, signal: undefined }, next);
      assert.equal(decision.kind, 'enter');
      assert.equal(decision.messages.length, 2, `prompt + contexto (logs: ${logs.join(' | ')})`);
      assert.match(decision.messages[1].content[0].text, /kappaproyecto/);
      assert.equal(decision.messages[1].source.kind, 'lifecode-rag');
      // Segundo paso del mismo turno: no vuelve a inyectar.
      const again = await handler({ agent: { id: 'sesion-a' }, turn: 1, step: 2, signal: undefined }, next);
      assert.equal(again.messages.length, 1);
    });
  } finally {
    world.cleanup();
  }
});

test('agent/pre-step no toca la decisión cuando el RAG no puede responder', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const fuera = join(world.base, 'fuera-de-toda-raiz');
    mkdirSync(fuera, { recursive: true });
    writeConfig(world.root, { autoContext: { enabled: true } });
    const { ctx, listeners } = fakeCtx({ cwd: fuera });
    await withEnv(world.env, async () => {
      apply(ctx);
      const decision = { kind: 'enter', messages: [humanPrompt('kappaproyecto')] };
      const result = await listeners.get('agent/pre-step')(
        { agent: { id: 'sesion-sin-registro' }, turn: 1, step: 1, signal: undefined },
        async () => decision,
      );
      assert.deepEqual(result, decision);
    });
  } finally {
    world.cleanup();
  }
});

test('una decisión distinta de enter se devuelve intacta', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const { ctx, listeners } = fakeCtx();
    await withEnv(world.env, async () => {
      apply(ctx);
      const rejected = { kind: 'reject' };
      const result = await listeners.get('agent/pre-step')(
        { agent: { id: 'sesion-a' }, turn: 1, step: 1 },
        async () => rejected,
      );
      assert.equal(result, rejected);
    });
  } finally {
    world.cleanup();
  }
});

test('un almacén legado ya existente conserva la automatización v0.2', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    writeFileSync(join(world.root, 'rag.sqlite3'), 'no-es-sqlite', 'utf8');
    const routes = [];
    const webServer = { register(options) { routes.push(options); return () => {}; } };
    const { ctx, effects } = fakeCtx({ webServer });
    await withEnv(world.env, () => apply(ctx));
    // Con almacén legado: sincronización + automatización v0.2 + API heredada. Un perfil nuevo no
    // crea el legado (pruebas anteriores: un solo efecto), así que la instalación no introduce un
    // almacén v0.2 implícito.
    assert.equal(effects.length, 3);
    assert.equal(routes.length, 1, 'la API heredada sólo se expone si existe el almacén legado');
  } finally {
    world.cleanup();
  }
});

test('la API heredada no se registra en un perfil Project-Aware sin almacén legado', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    const routes = [];
    const webServer = { register(options) { routes.push(options); return () => {}; } };
    const { ctx, effects } = fakeCtx({ webServer });
    await withEnv(world.env, () => apply(ctx));
    assert.equal(routes.length, 0, 'sin rag.sqlite3 la API mostraría otro almacén que las tools');
    assert.equal(effects.length, 1, 'sólo el efecto de sincronización');
  } finally {
    world.cleanup();
  }
});

test('la sincronización programada mira el registro del perfil, no la raíz legada', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    writeConfig(world.root, { automation: { enabled: true, intervalMs: 5_000 } });
    const timer = hostTimer();
    const { ctx } = fakeCtx({ timer });
    // Todo dentro del entorno: el scheduler relee la config y el perfil en cada tick, así que sacar
    // el tick fuera de `withEnv` lo haría correr con el `process.env` del runner.
    await withEnv(world.env, async () => {
      apply(ctx);
      assert.equal(timer.calls.length, 1);
      // Un fichero que sólo puede entrar si el tick encuentra el registro Project-Aware del perfil:
      // con la raíz legada (`$DSH_HOME/lifecode-rag`) no hay `registry.sqlite3` y el tick se omite.
      writeFileSync(join(world.dirA, 'nuevo-sync.md'), '# nuevo\n\nkappaproyecto recién sincronizado\n', 'utf8');
      timer.calls[0].callback();
      const { openScopeStore } = await import('../lib/scope-stores.mjs');
      const deadline = Date.now() + 10_000;
      let count = 0;
      while (Date.now() < deadline) {
        const db = openScopeStore({
          profileRoot: world.root, profileKey: 'pa4-test', scope: { kind: 'prj', id: world.projectA.id }, create: false,
        });
        try { count = db.prepare('SELECT COUNT(*) AS n FROM sources').get().n; } finally { db.close(); }
        if (count === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(count, 2, 'el tick debe sincronizar el almacén del proyecto del perfil');
    });
  } finally {
    world.cleanup();
  }
});

test('los servicios opcionales se resuelven al usarlos, no al cargar el plugin', async () => {
  const world = await makeEightWorld({ libraryCount: 0 });
  try {
    let asked = 0;
    const { ctx, tools } = fakeCtx();
    ctx.get = (name) => {
      if (name === 'approval') {
        asked += 1;
        return { request: async () => 'rejected' };
      }
      if (name === 'workingDirectory') return { ensure: async () => world.dirA };
      return undefined;
    };
    await withEnv(world.env, async () => {
      apply(ctx);
      assert.equal(asked, 0, 'cargar el plugin no debe congelar un servicio que aún no existe');
      const reindex = tools.find((definition) => definition.name === 'lifecode_rag_reindex');
      await assert.rejects(
        () => reindex.execute({ operation: 'fts' }, fakeExec('sesion-a')),
        (error) => error.code === 'approval-required',
      );
      assert.ok(asked >= 1, 'la aprobación se pide en la llamada, no en la carga');
    });
  } finally {
    world.cleanup();
  }
});
