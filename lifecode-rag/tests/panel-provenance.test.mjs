/**
 * Regresión de PROCEDENCIA del panel LifeCode RAG.
 *
 * Fija el defecto medido en un Host DSH con un perfil REALMENTE vacío (registro creado, cero
 * proyectos): el panel decía «Servicio: ok · Conectado» y a la vez pintaba el fixture
 * («Fixture de demostración (no real)», «PROYECTOS LISTOS 2», «2 de 2»), porque el estado inicial
 * era el fixture y `hydrate` heredaba proyectos/selección cuando el snapshot traía listas vacías.
 *
 * Lo que se exige aquí:
 *   - registro vacío → snapshot real `mode:'api'`, `projects: []`, y estado vacío (0 proyectos,
 *     0 documentos, cobertura «Sin datos»), sin una sola fila del fixture;
 *   - una respuesta 200 vacía NUNCA se sustituye por fixtures;
 *   - un 503/401 se pinta como error real, tampoco con fixtures;
 *   - la demostración sólo se pinta con activación EXPLÍCITA y anunciada;
 *   - el indicador de servicio no puede decir `ok` cuando los datos son del fixture.
 *
 * Sin red: el handler PA se monta con un registro temporal (`mkdtemp`) y el `fetch` del panel es un
 * doble en memoria. Nada toca `~/.dsh`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { createPaHandler, PA_PREFIX } from '../lib/pa-api.mjs';
import { closeRegistry, openRegistry } from '../lib/registry.mjs';

const clientSource = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8');

/* --------------------------------------------------------------- runtime mínimo */

let runtime = null;

const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity) };
  },
  useState(initial) { return runtime.useState(initial); },
  useRef(initial) { return runtime.useRef(initial); },
  useMemo(fn) { runtime.hook(); return fn(); },
  useCallback(fn) { runtime.hook(); return fn; },
  useEffect(fn) { runtime.hook(); runtime.effects.push(fn); return undefined; },
};

const fakeDocument = () => ({
  head: { appendChild() {} },
  createElement: () => ({ id: '', textContent: '', remove() {} }),
});

function loadModule({ fetch: fetchImpl } = {}) {
  const spies = { fetch: 0 };
  let definition = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => { definition = def; } } },
    console,
    document: fakeDocument(),
    fetch: fetchImpl ?? (async () => { spies.fetch += 1; throw new Error('fetch inesperado'); }),
    AbortController,
    Buffer,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(clientSource, sandbox, { filename: 'client.js' });
  assert.ok(definition, 'el módulo debe registrarse en window.__ModuleLoader__');
  const mod = definition.factory((name) => {
    if (name === 'react') return ReactStub;
    throw new Error('require inesperado: ' + name);
  });
  return { mod, spies };
}

function mount(component, props) {
  const state = { cells: [], index: 0, effects: [], tree: null };
  runtime = {
    effects: state.effects,
    hook() { state.index += 1; },
    useState(initial) {
      const slot = state.index;
      state.index += 1;
      if (!(slot in state.cells)) state.cells[slot] = typeof initial === 'function' ? initial() : initial;
      return [state.cells[slot], (next) => {
        state.cells[slot] = typeof next === 'function' ? next(state.cells[slot]) : next;
        render();
      }];
    },
    useRef(initial) {
      const slot = state.index;
      state.index += 1;
      if (!(slot in state.cells)) state.cells[slot] = { current: initial };
      return state.cells[slot];
    },
  };
  function render() {
    state.index = 0;
    state.effects.length = 0;
    state.tree = component(props);
  }
  render();
  return {
    get tree() { return state.tree; },
    /** Ejecuta los `useEffect` recogidos (el runtime de prueba no los corre solo). */
    runEffects() {
      for (const effect of state.effects.slice()) effect();
    },
    text() {
      let text = '';
      const walk = (node) => {
        if (node === null || node === undefined || node === false) return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (typeof node === 'string' || typeof node === 'number') { text += ' ' + node; return; }
        if (typeof node === 'object' && node.type) (node.children || []).forEach(walk);
      };
      walk(state.tree);
      return text.replace(/\s+/g, ' ').trim();
    },
  };
}

const FIXTURE_NAMES = ['Fixture de demostración', 'Biblioteca Compartida Beta', 'PROYECTOS LISTOS', 'prj_k1fx_'];

function assertNoFixture(text, where) {
  for (const name of FIXTURE_NAMES) {
    assert.equal(text.includes(name), false, `se pintó el fixture en ${where}: ${name}`);
  }
}

/** Perfil temporal con el registro creado y CERO proyectos: el escenario del defecto. */
function emptyProfileSnapshot() {
  const base = mkdtempSync(join(tmpdir(), 'panel-empty-'));
  const root = join(base, 'perfil');
  const opened = openRegistry({ root, create: true });
  closeRegistry(opened.db);
  const handler = createPaHandler({
    profileRoot: root,
    profileKey: 'panel-empty',
    authorize: async () => ({ ok: true, peer: { id: 'host', principal: { kind: 'host' } } }),
  });
  return Promise.resolve().then(async () => {
    const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    const req = { url: PA_PREFIX + '/snapshot', method: 'GET', headers: {}, async *[Symbol.asyncIterator]() {} };
    await handler(req, res);
    const body = JSON.parse(res.body);
    rmSync(base, { recursive: true, force: true });
    return { status: res.statusCode, body };
  });
}

/* ------------------------------------------------------------------- pruebas */

test('registro vacío: /snapshot responde mode:api con cero proyectos y el panel deriva estado vacío', async () => {
  const { status, body } = await emptyProfileSnapshot();
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  const snapshot = body.data;
  assert.equal(snapshot.mode, 'api');
  assert.equal(snapshot.project, null, 'sin proyecto activo');
  assert.deepEqual(snapshot.projects, [], 'cero proyectos es un dato, no una ausencia');
  assert.deepEqual(snapshot.scopes, []);
  assert.deepEqual(snapshot.libraries, []);
  assert.deepEqual(snapshot.sources, { rows: [], total: 0, nextCursor: null });

  const { mod } = loadModule();
  const { paInitialState, paReduce, paOverviewMetrics, paRenderView, paTranslate } = mod.__test;
  assert.equal(paInitialState().mode, 'loading', 'el estado inicial es neutro');
  const state = paReduce(paInitialState(), { type: 'hydrate', snapshot });
  assert.equal(state.mode, 'api');
  assert.equal(state.dataSource, 'api');
  assert.equal(state.projects.length, 0, 'cero proyectos: no se hereda nada del estado anterior');
  assert.equal(state.sources.length, 0);
  assert.equal(state.sourcesTotal, 0);
  const metrics = paOverviewMetrics(state);
  assert.equal(metrics.ready, 0);
  assert.equal(metrics.total, 0);
  assert.equal(metrics.docs, 0);
  const t = (key, vars) => paTranslate('es', key, vars);
  const text = mount(() => paRenderView(state, t, () => {}), null).text();
  assertNoFixture(text, 'el panel vacío');
  assert.equal(text.includes('2 de 2 proyectos con raíz autorizada'), false, 'la cobertura no puede ser 100% en un perfil vacío');
  assert.equal(/\d+%/.test(text), false, 'sin documentos no se pinta ningún porcentaje de cobertura');
  assert.equal(text.includes('Registra tu primer proyecto para empezar.'), true);
});

test('una respuesta 200 vacía no pinta ni una fila del fixture', () => {
  const { mod } = loadModule();
  const { paInitialState, paReduce, paRenderView, paTranslate } = mod.__test;
  const emptySnapshot = { mode: 'api', service: 'ok', project: null, selection: null, projects: [], scopes: [], libraries: [], sources: { rows: [], total: 0 } };
  // Incluso partiendo del estado de demostración, el snapshot real lo sustituye por completo.
  const state = paReduce(paInitialState({ demo: true }), { type: 'hydrate', snapshot: emptySnapshot });
  assert.equal(state.projects.length, 0);
  assert.equal(state.libraries.length, 0);
  assert.equal(state.diagnostics.scopes.length, 0);
  assert.equal(state.session.session.selection.projectName, null, 'la selección del fixture no sobrevive');
  const text = mount(() => paRenderView(state, (key, vars) => paTranslate('es', key, vars), () => {}), null).text();
  assertNoFixture(text, 'el snapshot vacío');
});

test('un 503/401 se muestra como error real y no se sustituye por fixtures', async () => {
  const response503 = {
    ok: false,
    status: 503,
    json: async () => ({ ok: false, error: { code: 'service-unavailable', message: 'la API no está lista' } }),
  };
  const { mod } = loadModule({ fetch: async () => response503 });
  const { negotiateMode, panelState, paInitialState, paReduce, paRenderView, paTranslate, paOverviewMetrics } = mod.__test;
  await negotiateMode();
  assert.equal(panelState.mode, 'down', 'un fallo no habilita la demostración');
  assert.equal(panelState.reason, 'service-unavailable');
  assert.equal(panelState.service, 'down');

  const down = paReduce(paInitialState(), { type: 'unavailable', reason: panelState.reason });
  assert.equal(down.mode, 'down');
  assert.equal(down.projects.length, 0);
  const { paRenderViewSafe } = mod.__test;
  const text = mount(() => paRenderViewSafe(down, (key, vars) => paTranslate('es', key, vars), () => {}), null).text();
  assert.equal(text.includes('service-unavailable'), true, 'la razón real es visible');
  assertNoFixture(text, 'el estado de error');
  assert.equal(paOverviewMetrics(down).docs, 0);

  // 401 del Host: mismo contrato, distinto código, y tampoco hay datos sintéticos.
  const response401 = {
    ok: false,
    status: 401,
    json: async () => ({ ok: false, error: { code: 'unauthenticated', message: 'sin credencial del host' } }),
  };
  const denied = loadModule({ fetch: async () => response401 });
  await denied.mod.__test.negotiateMode();
  assert.equal(denied.mod.__test.panelState.mode, 'down');
  assert.equal(denied.mod.__test.panelState.reason, 'unauthenticated');
});

test('la demostración exige activación explícita, se anuncia y no dice «Servicio: ok»', () => {
  const { mod } = loadModule();
  const { PaPanel, paTranslate, panelState } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);

  // Sin activación: neutro, sin banner y sin fixture.
  const neutral = mount(PaPanel, { t }).text();
  assertNoFixture(neutral, 'el arranque sin demo');
  assert.equal(neutral.includes('SYNTHETIC DATA MODE'), false, 'no se anuncia demo si no la hay');

  // Con activación explícita (prop del host / botón de Ajustes): fixtures ANUNCIADOS.
  const demo = mount(PaPanel, { t, demo: true }).text();
  assert.equal(demo.includes('SYNTHETIC DATA MODE — DEMO: ESTA VISTA NO LEE EL PROYECTO REAL'), true);
  assert.equal(demo.includes('Fixture de demostración (no real)'), true);
  assert.equal(demo.includes('Servicio: ok'), false, 'el indicador de servicio no puede mentir en demo');
  assert.equal(demo.includes('Demo (sin servicio real)'), true);
  assert.equal(panelState.demo, false, 'la demo de un montaje no enciende el modo global');
});

test('el panel montado negocia al arrancar y pinta el registro vacío, no el fixture', async () => {
  const { body } = await emptyProfileSnapshot();
  const calls = [];
  const snapshotJson = body;
  const fakeFetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => snapshotJson,
      text: async () => JSON.stringify(snapshotJson),
    };
  };
  const { mod } = loadModule({ fetch: fakeFetch });
  const { PaPanel, paTranslate } = mod.__test;
  const panel = mount(PaPanel, { t: (key, vars) => paTranslate('es', key, vars) });
  // Antes de negociar: neutro, ni fixture ni una falsa conexión.
  assertNoFixture(panel.text(), 'el primer render');
  assert.equal(panel.text().includes('Servicio: ok'), false);
  panel.runEffects();
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2, 'negocia y después pide el snapshot');
  assert.equal(calls[0], '/lifecode-rag/pa/snapshot');
  const text = panel.text();
  assertNoFixture(text, 'el panel tras negociar');
  assert.equal(text.includes('Registra tu primer proyecto para empezar.'), true);
  assert.equal(text.includes('0 de 0 proyectos con raíz autorizada'), true);
  assert.equal(text.includes('Servicio: ok'), true, 'el servicio es real: responde 200 con un registro vacío');
  assert.equal(text.includes('SYNTHETIC DATA MODE'), false);
});

test('el indicador de servicio no dice ok si el origen de los datos es el fixture', () => {
  const { mod } = loadModule();
  const { paInitialState, paReduce, paRenderView, paTranslate } = mod.__test;
  const demo = paInitialState({ demo: true });
  assert.equal(demo.dataSource, 'fixture');
  const settings = paRenderView({ ...demo, view: 'settings' }, (key, vars) => paTranslate('es', key, vars), () => {});
  const text = mount(() => settings, null).text();
  assert.equal(text.includes('Demo (sin servicio real)'), true);
  assert.equal(text.includes('Fixtures de demostración'), true, 'la procedencia es visible y verificable');

  // En cambio, un perfil real vacío sí puede decir ok: son datos reales, aunque no haya ninguno.
  const real = paReduce(paInitialState(), { type: 'hydrate', snapshot: { mode: 'api', service: 'ok', project: null, projects: [], scopes: [], libraries: [], sources: { rows: [], total: 0 } } });
  assert.equal(real.session.service.status, 'ok');
  assert.equal(real.dataSource, 'api');
  const realSettings = mount(() => paRenderView({ ...real, view: 'settings' }, (key, vars) => paTranslate('es', key, vars), () => {}), null).text();
  assert.equal(realSettings.includes('Registro del perfil (API PA)'), true);
  assert.equal(realSettings.includes('Demo (sin servicio real)'), false);
});
