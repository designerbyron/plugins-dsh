/**
 * Ciclo de carga de la vista Seguimiento (UX-2.2) medido sobre el panel REAL.
 *
 * Defecto de partida: al entrar por primera vez en `Seguimiento` con la lista del Host sin cargar,
 * el efecto pedía `/workspaces` y, al despachar su resultado, el reducer ponía `pending: null`. Ese
 * cambio de dependencia disparaba la limpieza del efecto (`alive = false`) y la respuesta de
 * `/tracking` —que llegaba después— se descartaba. `tracking.loading` se quedaba en `true` para
 * siempre: «Leyendo el seguimiento…».
 *
 * Estas pruebas montan `PaPanel` con un runtime de hooks que, como React, ejecuta la limpieza del
 * efecto cuando cambian sus dependencias, y comprueban TRANSICIONES OBSERVABLES: qué se pinta
 * (`data-tracking-state`) después de cada respuesta. Ninguna usa fixtures y ninguna toca la red.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

import { createPaHandler, PA_PREFIX } from '../lib/pa-api.mjs';
import { closeRegistry, openRegistry } from '../lib/registry.mjs';

const clientSource = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8');
const PA = '/lifecode-rag/pa';

/* --------------------------------------------------------- runtime de hooks */

let runtime = null;

const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity) };
  },
  useState(initial) { return runtime.useState(initial); },
  useRef(initial) { return runtime.useRef(initial); },
  useMemo(fn) { runtime.hook(); return fn(); },
  useCallback(fn) { runtime.hook(); return fn; },
  useEffect(fn, deps) { return runtime.useEffect(fn, deps); },
};

const fakeDocument = () => ({
  head: { appendChild() {} },
  createElement: () => ({ id: '', textContent: '', remove() {} }),
});

/** Reloj controlable: el `setTimeout` del sandbox es de la prueba, no del proceso. */
function makeClock() {
  let nextId = 1;
  let elapsed = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, ms: Number(ms) || 0 });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    /** Milisegundos de los temporizadores que siguen vivos (para medir el presupuesto real). */
    delays() { return [...timers.values()].map((timer) => timer.ms).sort((a, b) => a - b); },
    /** Adelanta el reloj y ejecuta los temporizadores vencidos, en orden de vencimiento. */
    advance(ms) {
      elapsed += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.ms <= elapsed)
        .sort((a, b) => a[1].ms - b[1].ms);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.fn();
      }
    },
  };
}

function loadModule({ fetch: fetchImpl, clock }) {
  let definition = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => { definition = def; } } },
    console,
    document: fakeDocument(),
    fetch: fetchImpl,
    AbortController,
    Buffer,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(clientSource, sandbox, { filename: 'client.js' });
  assert.ok(definition, 'el módulo debe registrarse en window.__ModuleLoader__');
  const mod = definition.factory((name) => {
    if (name === 'react') return ReactStub;
    throw new Error('require inesperado: ' + name);
  });
  return { mod };
}

function mount(component, props) {
  const state = { cells: [], index: 0, queued: [], effectCells: [], cleanups: new Map(), tree: null };
  runtime = {
    hook() { state.index += 1; },
    useEffect(fn, deps) {
      const slot = state.index;
      state.index += 1;
      const previous = state.effectCells[slot];
      const unchanged = Boolean(previous) && deps !== undefined && previous.deps !== undefined
        && deps.length === previous.deps.length
        && deps.every((value, position) => Object.is(value, previous.deps[position]));
      if (unchanged) return;
      // Como React: la limpieza de la instancia anterior corre antes del cuerpo siguiente.
      const cleanup = state.cleanups.get(slot);
      if (typeof cleanup === 'function') {
        state.cleanups.delete(slot);
        cleanup();
      }
      state.effectCells[slot] = { deps };
      state.queued.push({ slot, fn });
    },
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
    state.tree = component(props);
  }
  render();
  return {
    get tree() { return state.tree; },
    runEffects() {
      const batch = state.queued.splice(0);
      for (const { slot, fn } of batch) {
        const cleanup = fn();
        if (typeof cleanup === 'function') state.cleanups.set(slot, cleanup);
      }
    },
    click(element) {
      assert.ok(element, 'no se encontró el elemento a pulsar');
      assert.equal(typeof element.props.onClick, 'function', 'el elemento debe tener onClick');
      element.props.onClick();
    },
    find(predicate) {
      for (const node of walk(state.tree)) if (node.type && predicate(node)) return node;
      return null;
    },
    all(predicate) {
      const found = [];
      for (const node of walk(state.tree)) if (node.type && predicate(node)) found.push(node);
      return found;
    },
    tab(label) {
      return this.find((node) => node.props.role === 'tab' && textOf(node) === label);
    },
    go(label) {
      const direct = this.tab(label);
      if (direct) { this.click(direct); return; }
      for (const area of this.all((node) => node.props.role === 'tab' && node.props['data-area'])) {
        this.click(area);
        const found = this.tab(label);
        if (found) { this.click(found); return; }
      }
      assert.fail('no se encontró la sección: ' + label);
    },
    text() { return textOf(state.tree); },
    /** Estado observable de la vista de seguimiento: 'loading' | 'error' | 'idle' | 'list' | … */
    trackingState() {
      // Las pestañas también llevan `data-view`; el estado de la vista está en `data-tracking-state`.
      const node = this.find((el) => el.props && typeof el.props['data-tracking-state'] === 'string');
      return node ? node.props['data-tracking-state'] : null;
    },
    trackingError() {
      const node = this.find((el) => el.props && el.props['data-tracking-error']);
      return node ? node.props['data-tracking-error'] : null;
    },
    rows() {
      return this.all((node) => node.props && typeof node.props['data-tracking-path'] === 'string')
        .map((node) => node.props['data-tracking-path']);
    },
  };
}

function* walk(node) {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
  if (typeof node === 'string' || typeof node === 'number') { yield { text: String(node) }; return; }
  if (typeof node === 'object' && node.type) {
    yield node;
    for (const child of node.children) yield* walk(child);
  }
}
function textOf(node) {
  let text = '';
  for (const item of walk(node)) if (item.text !== undefined) text += ' ' + item.text;
  return text.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------- doble de red */

const flush = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

/** Respuesta PA correcta (`{ok:true,data}`), que es lo que `request()` devuelve como payload. */
const okData = (data) => jsonResponse(200, { ok: true, data });
const failData = (status, code) => jsonResponse(status, { ok: false, error: { code } });

/**
 * Servidor PA en memoria. Cada ruta recibe respuestas encoladas; la última se repite.
 * `calls` cuenta las peticiones reales por ruta (para demostrar que no se duplican).
 */
function makeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = String(url).slice(PA.length).split('?')[0];
    calls.push({ path, method: (options && options.method) || 'GET' });
    const queue = routes[path];
    if (!queue || queue.length === 0) return failData(404, 'not-found');
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next({ path, options, calls });
  };
  fetchImpl.calls = calls;
  fetchImpl.count = (path) => calls.filter((call) => call.path === path).length;
  return fetchImpl;
}

const emptySnapshot = okData({
  mode: 'api',
  service: 'ok',
  project: null,
  selection: null,
  projects: [],
  scopes: [],
  libraries: [],
  sources: { rows: [], total: 0, nextCursor: null },
});

const hostList = (items = [
  { id: 'ws-1', path: 'C:/p/alfa', pathKey: 'c:/p/alfa', title: 'alfa', state: 'ok', sessions: { known: 1, live: 0 }, relation: 'exact' },
]) => okData({ source: 'host', asOf: 1_700_000_000_000, items, counts: { total: items.length } });

const trackingRows = (rows) => okData({
  items: rows,
  counts: { total: rows.length, followed: rows.filter((row) => row.state === 'on').length },
  asOf: 1_700_000_000_000,
});

const ROW_ALFA = { pathKey: 'c:/p/alfa', path: 'C:/p/alfa', state: 'on', revision: 3, project: { id: 'prj-1', name: 'Alfa' } };

/** Monta el panel, negocia y deja el registro vacío pintado (perfil recién creado, 0 proyectos). */
async function mountEmptyProfile(routes) {
  const clock = makeClock();
  const fetchImpl = makeFetch(routes);
  const { mod } = loadModule({ fetch: fetchImpl, clock });
  const { PaPanel, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  const panel = mount(PaPanel, { t });
  await settle(panel);
  assert.equal(panel.text().includes('Registra tu primer proyecto para empezar.'), true,
    'el perfil vacío tiene que estar pintado antes de entrar en Seguimiento');
  return { panel, mod, t, clock, fetchImpl };
}

/** Ejecuta los efectos encolados y drena las promesas, como el commit de React. */
async function settle(panel) {
  for (let i = 0; i < 6; i += 1) {
    panel.runEffects();
    await flush();
  }
}

async function enterTracking(panel) {
  panel.go('Seguimiento');
  await settle(panel);
}

const FIXTURE_MARKS = ['Fixture de demostración', 'PROYECTOS LISTOS', 'prj_k1fx_'];

function assertNoFixture(panel, where) {
  const text = panel.text();
  for (const mark of FIXTURE_MARKS) {
    assert.equal(text.includes(mark), false, `se pintó el fixture en ${where}: ${mark}`);
  }
}

/* ------------------------------------------------------------------ pruebas */

test('T01 · 200 con filas: sale de «Leyendo el seguimiento…» y pinta la tabla', async () => {
  const routes = {
    '/snapshot': [() => emptySnapshot],
    '/workspaces': [() => hostList()],
    '/tracking': [() => trackingRows([ROW_ALFA])],
  };
  const { panel, fetchImpl } = await mountEmptyProfile(routes);
  panel.go('Seguimiento');
  assert.equal(panel.trackingState(), 'loading', 'al entrar se anuncia la lectura');

  await settle(panel);
  assert.equal(panel.trackingState(), 'list', 'la vista tiene que salir de carga');
  assert.deepEqual(panel.rows(), ['c:/p/alfa']);
  assert.equal(panel.text().includes('Leyendo el seguimiento'), false, 'no queda el spinner');
  assert.equal(panel.trackingError(), null);
  assertNoFixture(panel, 'T01');
  assert.equal(fetchImpl.count('/tracking'), 1, 'una sola lectura por entrada');
  assert.equal(fetchImpl.count('/workspaces'), 1, 'la lista del Host se pide una vez');
});

test('T02 · 200 con items vacío es ÉXITO: estado vacío legítimo, sin fixture ni error', async () => {
  const routes = {
    '/snapshot': [() => emptySnapshot],
    '/workspaces': [() => hostList([])],
    '/tracking': [() => trackingRows([])],
  };
  const { panel } = await mountEmptyProfile(routes);
  await enterTracking(panel);
  assert.equal(panel.trackingState(), 'list', 'una lista vacía del servidor es una lista, no un fallo');
  assert.equal(panel.text().includes('No hay workspaces que seguir'), true);
  assert.equal(panel.trackingError(), null);
  assert.equal(panel.text().includes('Leyendo el seguimiento'), false);
  assertNoFixture(panel, 'T02');
});

const HTTP_CASES = [
  { name: 'T03 · 401: error real, sin datos inventados', status: 401, code: 'unauthenticated' },
  { name: 'T04 · 403: error real, sin datos inventados', status: 403, code: 'forbidden' },
  { name: 'T05 · 404: error real, sin datos inventados', status: 404, code: 'not-found' },
  { name: 'T06 · 409: error real, sin datos inventados', status: 409, code: 'revision-conflict' },
  { name: 'T07 · 500: error real, sin datos inventados', status: 500, code: 'internal' },
];

for (const scenario of HTTP_CASES) {
  test(scenario.name, async () => {
    const routes = {
      '/snapshot': [() => emptySnapshot],
      '/workspaces': [() => hostList()],
      '/tracking': [() => failData(scenario.status, scenario.code)],
    };
    const { panel } = await mountEmptyProfile(routes);
    await enterTracking(panel);
    assert.equal(panel.trackingState(), 'error', `HTTP ${scenario.status} no puede dejar la vista cargando`);
    assert.equal(panel.trackingError(), scenario.code, 'se pinta el motivo que dio el servidor');
    assert.equal(panel.text().includes('Leyendo el seguimiento'), false);
    assertNoFixture(panel, 'HTTP ' + scenario.status);
  });
}

test('T08 · JSON inválido: error invalid-json, no una lista vacía', async () => {
  const routes = {
    '/snapshot': [() => emptySnapshot],
    '/workspaces': [() => hostList()],
    '/tracking': [() => ({
      ok: true,
      status: 200,
      text: async () => '<html>no es json</html>',
      json: async () => { throw new SyntaxError('JSON roto'); },
    })],
  };
  const { panel } = await mountEmptyProfile(routes);
  await enterTracking(panel);
  assert.equal(panel.trackingState(), 'error');
  assert.equal(panel.trackingError(), 'invalid-json');
  assert.equal(panel.text().includes('Leyendo el seguimiento'), false);
  assertNoFixture(panel, 'T08');
});

test('T09 · timeout de 10 s: aborta con AbortController y deja un error recuperable', async () => {
  const routes = {
    '/snapshot': [() => emptySnapshot],
    '/workspaces': [() => hostList()],
    '/tracking': [({ options }) => new Promise((resolve, reject) => {
      // Transporte que nunca responde: sólo la señal del cliente lo cancela.
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })],
  };
  const { panel, clock } = await mountEmptyProfile(routes);
  panel.go('Seguimiento');
  panel.runEffects();
  await flush();
  assert.equal(panel.trackingState(), 'loading');
  assert.deepEqual(clock.delays(), [10000], 'el presupuesto de la lectura de seguimiento es 10 s');

  clock.advance(9999);
  await flush();
  assert.equal(panel.trackingState(), 'loading', 'a los 9,999 s todavía no se ha rendido');

  clock.advance(1);
  await settle(panel);
  assert.equal(panel.trackingState(), 'error');
  assert.equal(panel.trackingError(), 'timeout');
  assert.equal(panel.text().includes('Leyendo el seguimiento'), false);
  assert.equal(panel.text().includes('Reintentar'), true, 'el error es recuperable');
  assertNoFixture(panel, 'T09');
});

test('T10 · error de red: error network, nunca carga infinita', async () => {
  const routes = {
    '/snapshot': [() => emptySnapshot],
    '/workspaces': [() => hostList()],
    '/tracking': [() => { throw new TypeError('fetch failed'); }],
  };
  const { panel } = await mountEmptyProfile(routes);
  await enterTracking(panel);
  assert.equal(panel.trackingState(), 'error');
  assert.equal(panel.trackingError(), 'network');
  assert.equal(panel.text().includes('Leyendo el seguimiento'), false);
  assertNoFixture(panel, 'T10');
});

test('T11 · cancelación al salir de la sección: cierra la carga sin error', async () => {
  let aborted = false;
  const routes = {
    '/snapshot': [() => emptySnapshot],
    '/workspaces': [() => hostList()],
    '/tracking': [
      ({ options }) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          aborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
      () => trackingRows([ROW_ALFA]),
    ],
  };
  const { panel } = await mountEmptyProfile(routes);
  panel.go('Seguimiento');
  panel.runEffects();
  await flush();
  assert.equal(panel.trackingState(), 'loading');

  // La persona se va a otra sección con la lectura en vuelo: se cancela.
  panel.go('Workspaces');
  await settle(panel);
  assert.equal(aborted, true, 'la petición en vuelo se aborta al desmontar el ciclo');

  // Vuelve: ni error heredado de la cancelación, ni spinner pegado.
  panel.go('Seguimiento');
  assert.equal(panel.trackingState(), 'loading', 'el ciclo nuevo empieza limpio');
  await settle(panel);
  assert.equal(panel.trackingState(), 'list');
  assert.equal(panel.trackingError(), null, 'la cancelación no se pinta como fallo');
  assert.deepEqual(panel.rows(), ['c:/p/alfa']);
  assertNoFixture(panel, 'T11');
});

test('T12 · reintento: el botón vuelve a pedir y la vista se recupera', async () => {
  const routes = {
    '/snapshot': [() => emptySnapshot],
    '/workspaces': [() => hostList()],
    '/tracking': [() => failData(500, 'internal'), () => trackingRows([ROW_ALFA])],
  };
  const { panel, fetchImpl } = await mountEmptyProfile(routes);
  await enterTracking(panel);
  assert.equal(panel.trackingState(), 'error');

  const retry = panel.find((node) => node.type === 'button' && textOf(node) === 'Reintentar');
  panel.click(retry);
  assert.equal(panel.trackingState(), 'loading', 'el reintento anuncia la nueva lectura');
  await settle(panel);
  assert.equal(panel.trackingState(), 'list', 'la segunda respuesta pinta la tabla');
  assert.equal(panel.trackingError(), null);
  assert.deepEqual(panel.rows(), ['c:/p/alfa']);
  assert.equal(fetchImpl.count('/tracking'), 2, 'una petición por intento, sin duplicados');
  assertNoFixture(panel, 'T12');
});

test('T13 · respuesta obsoleta: la que llega tarde no sobrescribe a la vigente', async () => {
  const first = [];
  const second = [];
  let releaseFirst;
  let releaseSecond;
  const routes = {
    '/snapshot': [() => emptySnapshot],
    '/workspaces': [() => hostList()],
    '/tracking': [
      // Primer ciclo: NO honra la señal (el transporte ya traía los bytes). Llega tarde.
      () => new Promise((resolve) => { first.push(1); releaseFirst = () => resolve(trackingRows([{ pathKey: 'c:/p/beta', path: 'C:/p/beta', state: 'paused', revision: 1 }])); }),
      () => new Promise((resolve) => { second.push(1); releaseSecond = () => resolve(trackingRows([ROW_ALFA])); }),
    ],
  };
  const { panel } = await mountEmptyProfile(routes);
  panel.go('Seguimiento');
  panel.runEffects();
  await flush();
  assert.equal(first.length, 1, 'el primer ciclo pidió su lectura');

  // Salir y volver abre un ciclo nuevo mientras el primero sigue en vuelo.
  panel.go('Workspaces');
  panel.runEffects();
  await flush();
  panel.go('Seguimiento');
  panel.runEffects();
  await flush();
  assert.equal(second.length, 1, 'el ciclo vigente pidió su propia lectura');

  releaseSecond();
  await settle(panel);
  assert.deepEqual(panel.rows(), ['c:/p/alfa'], 'manda la respuesta del ciclo vigente');

  // Ahora llega la vieja: no puede pintar ni reabrir la carga.
  releaseFirst();
  await settle(panel);
  assert.deepEqual(panel.rows(), ['c:/p/alfa'], 'la respuesta obsoleta no sobrescribe');
  assert.equal(panel.trackingState(), 'list');
  assert.equal(panel.trackingError(), null, 'una respuesta obsoleta no es un error de la vista');
});

test('T14 · reentrar en la pestaña no dispara peticiones duplicadas', async () => {
  const routes = {
    '/snapshot': [() => emptySnapshot],
    '/workspaces': [() => hostList()],
    '/tracking': [() => trackingRows([ROW_ALFA])],
  };
  const { panel, fetchImpl } = await mountEmptyProfile(routes);
  await enterTracking(panel);
  assert.equal(fetchImpl.count('/tracking'), 1);
  assert.equal(fetchImpl.count('/workspaces'), 1);

  panel.go('Resumen');
  await settle(panel);
  await enterTracking(panel);
  assert.equal(fetchImpl.count('/tracking'), 2, 'una lectura por entrada, no dos');
  assert.equal(fetchImpl.count('/workspaces'), 1, 'la lista cargada no se vuelve a pedir');
  assert.equal(panel.trackingState(), 'list');
  assertNoFixture(panel, 'T14');
});


test('T15 · ciclo real sobre /pa/*: registro vacío, sale de carga y no pinta fixture', async () => {
  const base = mkdtempSync(join(tmpdir(), 'panel-cycle-'));
  const root = join(base, 'perfil');
  const opened = openRegistry({ root, create: true });
  closeRegistry(opened.db);
  const handler = createPaHandler({
    profileRoot: root,
    profileKey: 'panel-cycle',
    authorize: async () => ({ ok: true, peer: { id: 'host', principal: { kind: 'host' } } }),
  });
  const statuses = [];
  const fetchReal = async (url, options = {}) => {
    const res = { statusCode: 0, headers: {}, body: '', setHeader() {}, end(body) { this.body = body; } };
    const req = {
      url: String(url),
      method: (options && options.method) || 'GET',
      headers: (options && options.headers) || {},
      async *[Symbol.asyncIterator]() {
        if (options && options.body) yield Buffer.from(options.body);
      },
    };
    await handler(req, res);
    statuses.push({ path: String(url).slice(PA_PREFIX.length).split('?')[0], status: res.statusCode });
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      text: async () => res.body,
      json: async () => JSON.parse(res.body),
    };
  };
  try {
    const clock = makeClock();
    const { mod } = loadModule({ fetch: fetchReal, clock });
    const { PaPanel, paTranslate } = mod.__test;
    const panel = mount(PaPanel, { t: (key, vars) => paTranslate('es', key, vars) });
    await settle(panel);
    assert.equal(panel.text().includes('Registra tu primer proyecto para empezar.'), true,
      'el panel tiene que leer el registro real vacío');

    await enterTracking(panel);
    assert.equal(panel.trackingState(), 'list', '/pa/tracking responde y la vista sale de carga');
    assert.equal(panel.trackingError(), null, 'sin error en un perfil vacío');
    assert.equal(panel.text().includes('Leyendo el seguimiento'), false);
    assertNoFixture(panel, 'T15');
    const paths = statuses.map((entry) => entry.path + ' ' + entry.status);
    assert.equal(paths.includes('/snapshot 200'), true, JSON.stringify(paths));
    assert.equal(paths.includes('/workspaces 200'), true, JSON.stringify(paths));
    assert.equal(paths.includes('/tracking 200'), true, '/pa/tracking es parte de la API de este perfil');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
