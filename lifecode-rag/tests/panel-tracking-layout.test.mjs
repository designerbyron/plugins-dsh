/**
 * Presentación de la tabla de Seguimiento (UX-2.2, addendum del propietario).
 *
 * Defecto de partida, medido en el Host sobre una captura de 1668×817: la última columna —Acciones—
 * quedaba fuera del contenedor. La causa no era un botón: era el reparto. La tabla vivía en
 * `.lcr-pa-scroll` (`overflow: auto`) con `table-layout: auto`, así que el nombre y la ruta del
 * workspace se llevaban el ancho, la columna de estado se estrujaba hasta partir el texto por
 * palabras sueltas y la de acciones, con botones `white-space: nowrap`, terminaba fuera de la caja:
 * barra de desplazamiento horizontal y «Pausar (», «Dejar de», «Quitar fi».
 *
 * Estas pruebas se hacen sobre el PANEL MONTADO (hooks, reducer y vista reales, red simulada) y sobre
 * la hoja de estilos que el panel inyecta. No hay motor de CSS en `node --test`: lo que se mide es la
 * ESTRUCTURA y las reglas emitidas —contenedor propio de acciones, reparto fijo, cortes por anchura,
 * texto íntegro en el DOM y completo en `title`—, no píxeles.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

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

function loadModule({ fetch: fetchImpl = async () => { throw new Error('sin red'); }, clock } = {}) {
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
    setTimeout: clock ? clock.setTimeout : () => 0,
    clearTimeout: clock ? clock.clearTimeout : () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(clientSource, sandbox, { filename: 'client.js' });
  assert.ok(definition, 'el módulo debe registrarse en window.__ModuleLoader__');
  return { mod: definition.factory((name) => {
    if (name === 'react') return ReactStub;
    throw new Error('require inesperado: ' + name);
  }) };
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
      const cleanup = state.cleanups.get(slot);
      if (typeof cleanup === 'function') { state.cleanups.delete(slot); cleanup(); }
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
      if (direct) { direct.props.onClick(); return; }
      for (const area of this.all((node) => node.props.role === 'tab' && node.props['data-area'])) {
        area.props.onClick();
        const found = this.tab(label);
        if (found) { found.props.onClick(); return; }
      }
      assert.fail('no se encontró la sección: ' + label);
    },
    text() { return textOf(state.tree); },
    trackingState() {
      const node = this.find((el) => el.props && typeof el.props['data-tracking-state'] === 'string');
      return node ? node.props['data-tracking-state'] : null;
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
const classesOf = (node) => (node && node.props ? String(node.props.className || '') : '').split(/\s+/).filter(Boolean);

/* ------------------------------------------------------------- doble de red */

const flush = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body };
}
const okData = (data) => jsonResponse(200, { ok: true, data });

function makeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = String(url).slice(PA.length).split('?')[0];
    calls.push({ path, method: (options && options.method) || 'GET' });
    const queue = routes[path];
    if (!queue || queue.length === 0) return jsonResponse(404, { ok: false, error: { code: 'not-found' } });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next({ path, options, calls });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

async function settle(panel) {
  for (let i = 0; i < 6; i += 1) { panel.runEffects(); await flush(); }
}

const emptySnapshot = okData({
  mode: 'api', service: 'ok', project: null, selection: null,
  projects: [], scopes: [], libraries: [], sources: { rows: [], total: 0, nextCursor: null },
});

/* ------------------------------------------------------------------- datos */

/** Nombres y rutas deliberadamente largos: son los que estiraban la tabla. */
const LARGO = 'plataforma-de-facturacion-electronica-corporativo-saas-clientes-2026';
const RUTA_LARGA = 'C:/workspace/corporativo-saas-clientes/' + LARGO;

const WORKSPACES = [
  { id: 'ws-1', path: RUTA_LARGA, pathKey: 'w-on', title: LARGO, state: 'ok', sessions: { known: 1, live: 0 }, relation: 'exact' },
  { id: 'ws-2', path: 'C:/workspace/rc150-lab', pathKey: 'w-paused', title: 'rc150-lab', state: 'ok', sessions: { known: 1, live: 0 }, relation: 'exact' },
  { id: 'ws-3', path: 'C:/workspace/plugins-dhs', pathKey: 'w-off', title: 'plugins-dhs', state: 'ok', sessions: { known: 1, live: 0 }, relation: 'exact' },
];

const TRACKING = [
  { pathKey: 'w-on', path: RUTA_LARGA, state: 'on', revision: 7, project: null, lastStatus: 'ok' },
  { pathKey: 'w-paused', path: 'C:/workspace/rc150-lab', state: 'paused', revision: 3, project: { id: 'prj-1', name: 'plugins-dhs' }, lastStatus: 'ok' },
];

/** Monta el panel real y lo deja en Seguimiento con las tres filas (seguido, pausado, sin seguimiento). */
async function mountTracking() {
  const fetchImpl = makeFetch({
    '/snapshot': [() => emptySnapshot],
    '/workspaces': [() => okData({ source: 'host', asOf: 1, items: WORKSPACES, counts: { total: WORKSPACES.length } })],
    '/tracking': [() => okData({ items: TRACKING, counts: { total: TRACKING.length, followed: 1 }, asOf: 1 })],
  });
  const { mod } = loadModule({ fetch: fetchImpl });
  const { PaPanel, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  const panel = mount(PaPanel, { t });
  await settle(panel);
  panel.go('Seguimiento');
  await settle(panel);
  assert.equal(panel.trackingState(), 'list', 'la tabla tiene que estar montada para medirla');
  return { mod, panel, t, fetchImpl };
}

/** Filas de la tabla (por su atributo de ruta) y su celda de acciones. */
function rowsOf(panel) {
  return panel.all((node) => node.props && typeof node.props['data-tracking-path'] === 'string')
    .map((row) => ({
      key: row.props['data-tracking-path'],
      state: row.props['data-tracking-state'],
      cells: row.children.filter((child) => child && child.type === 'td'),
    }));
}

const actionsContainerOf = (row) => {
  const cell = row.cells[row.cells.length - 1];
  assert.ok(classesOf(cell).includes('lcr-pa-track-cell--actions'),
    'la última celda debe ser la columna de acciones, con su clase: ' + classesOf(cell).join('.'));
  const containers = cell.children.filter((child) => child && typeof child === 'object'
    && classesOf(child).includes('lcr-pa-track-actions'));
  assert.equal(containers.length, 1, 'la celda de acciones debe tener UN contenedor propio');
  return containers[0];
};

/** Interruptor + rótulo de la fila (el rótulo es un span junto al switch, no un botón). */
const toggleOf = (container) => {
  const toggle = [...walk(container)].find((node) => classesOf(node).includes('lcr-pa-toggle'));
  assert.ok(toggle, 'la columna de acciones incluye el interruptor de seguimiento');
  const label = [...walk(toggle)].find((node) => classesOf(node).includes('lcr-pa-toggle__label'));
  const switchButton = [...walk(toggle)].find((node) => node.type === 'button');
  assert.ok(label && switchButton, 'el interruptor tiene rótulo y control');
  return { label: textOf(label), button: switchButton, props: switchButton.props };
};

const buttonsOf = (container) => {
  const out = [];
  for (const node of walk(container)) {
    if (node.type === 'button') out.push({ text: textOf(node), props: node.props });
  }
  return out;
};

/* ------------------------------------------------------------------ pruebas */

test('T-LAYOUT-01: la tabla de Seguimiento no vive en una zona con scroll y las acciones tienen contenedor propio', async () => {
  const { mod, panel } = await mountTracking();
  const { CSS_PA } = mod.__test;

  // 1. El contenedor de la tabla es propio y NO es la caja con `overflow: auto` de `paTable`.
  const track = panel.find((node) => classesOf(node).includes('lcr-pa-track'));
  assert.ok(track, 'la tabla de seguimiento tiene contenedor propio (.lcr-pa-track)');
  const scrollTraps = [...walk(track)].filter((node) => classesOf(node).includes('lcr-pa-scroll'));
  assert.deepEqual(scrollTraps.map((node) => classesOf(node).join('.')), [],
    'dentro del contenedor de la tabla no puede haber una zona con scroll: ahí se recortaban las acciones');
  const tablewrap = panel.all((node) => classesOf(node).includes('lcr-pa-tablewrap'));
  assert.equal(tablewrap.length, 0, 'la vista ya no usa la caja con scroll y altura máxima de las tablas genéricas');

  // 2. La hoja: contenedor sin scroll, reparto fijo y columna de acciones con ancho propio.
  assert.match(CSS_PA, /\.lcr-pa-track\s*\{[^}]*min-width:\s*0/, 'el contenedor declara su min-width');
  assert.doesNotMatch(CSS_PA, /\.lcr-pa-track\s*\{[^}]*overflow/, 'el contenedor no declara overflow: no hay nada que desplazar');
  assert.match(CSS_PA, /\.lcr-pa-track-table\s*\{[^}]*table-layout:\s*fixed/,
    'reparto fijo: la tabla nunca es más ancha que su contenedor');
  assert.match(CSS_PA, /\.lcr-pa-track-table\s*\{[^}]*width:\s*100%/);
  assert.match(CSS_PA, /\.lcr-pa-track-head--actions\s*\{\s*width:\s*232px/,
    'la columna de acciones tiene ancho propio y suficiente (232px)');
  assert.match(CSS_PA, /\.lcr-pa-track-actions\s*\{[^}]*flex:\s*0\s+0\s+auto/,
    'el contenedor de acciones no se encoge (flex: 0 0 auto)');
  assert.match(CSS_PA, /\.lcr-pa-track-actions\s*>\s*\*\s*\{[^}]*flex:\s*0\s+0\s+auto/,
    'los controles tampoco se encogen: se apilan, no se recortan');

  // 3. El texto de estado se parte por palabras, nunca por caracteres.
  assert.equal(CSS_PA.includes('break-all'), false, 'nada de word-break: break-all');
  assert.match(CSS_PA, /\.lcr-pa-track-cell\s*\{[^}]*white-space:\s*normal/);
  assert.match(CSS_PA, /\.lcr-pa-track-cell\s*\{[^}]*word-break:\s*normal/);
  assert.match(CSS_PA, /\.lcr-pa-track-head--state\s*\{\s*width:\s*17%/, 'la columna de estado tiene un ancho mínimo razonable');
});

test('T-LAYOUT-02: los tres estados emiten sus botones completos dentro de la columna de acciones', async () => {
  const { panel } = await mountTracking();
  const rows = rowsOf(panel);
  assert.deepEqual(rows.map((row) => row.key), ['w-on', 'w-paused', 'w-off'], 'las tres filas llegan de la API, en orden');
  assert.deepEqual(rows.map((row) => row.state), ['on', 'paused', 'off'], 'cada fila conserva su estado');

  // Seguido sin proyecto asociado: interruptor encendido, pausar, dejar de seguir y quitar.
  const onContainer = actionsContainerOf(rows[0]);
  const onToggle = toggleOf(onContainer);
  assert.equal(onToggle.label, 'Pausar', 'fila seguida: el interruptor dice «Pausar»');
  assert.equal(onToggle.props['aria-checked'], 'true');
  assert.deepEqual(buttonsOf(onContainer).filter((button) => button.props.role !== 'switch')
    .map((button) => button.text), ['Dejar de seguir', 'Quitar fila'],
    'fila seguida: «Dejar de seguir» y «Quitar fila», con el texto íntegro en el DOM');
  const onOps = buttonsOf(onContainer).filter((button) => button.props['data-tracking-op']);
  assert.deepEqual(onOps.map((button) => button.props['data-tracking-op']), ['disable', 'remove']);

  // Pausado: reanudar en lugar de pausar; las acciones destructivas siguen ahí.
  const pausedContainer = actionsContainerOf(rows[1]);
  assert.equal(toggleOf(pausedContainer).label, 'Reanudar');
  assert.equal(toggleOf(pausedContainer).props['aria-checked'], 'false');
  assert.deepEqual(buttonsOf(pausedContainer).filter((button) => button.props.role !== 'switch')
    .map((button) => button.text), ['Dejar de seguir', 'Quitar fila', 'Revocar acceso de lectura', 'Mover carpeta'],
    'R1.2: la fila con proyecto añade las acciones avanzadas, también con su texto íntegro');

  // Sin seguimiento: sólo se ofrece seguir; no hay «Dejar de seguir» ni fila que quitar.
  const offContainer = actionsContainerOf(rows[2]);
  assert.equal(toggleOf(offContainer).label, 'Activar seguimiento');
  assert.equal(toggleOf(offContainer).props['aria-checked'], 'false');
  assert.deepEqual(buttonsOf(offContainer).filter((button) => button.props.role !== 'switch')
    .map((button) => button.text), [],
    'sin seguimiento no se ofrece una acción que presuponga que se seguía');

  // Todos los controles son botones de verdad y no viven detrás de ningún menú.
  for (const row of rows) {
    for (const button of buttonsOf(actionsContainerOf(row))) {
      assert.equal(button.props.type, 'button', 'accesibilidad: type="button" en todos los controles');
      assert.equal(button.props.onClick !== undefined || button.props.disabled, true,
        'cada control tiene su acción directa o está deshabilitado: nada escondido en menús');
    }
  }
});

test('T-LAYOUT-03: paTrackingLayout decide las tres variantes con los seis anchos del addendum', () => {
  const { mod } = loadModule();
  const { paTrackingLayout, PA_TRACK_BREAKPOINTS } = mod.__test;
  assert.deepEqual(JSON.parse(JSON.stringify(PA_TRACK_BREAKPOINTS)), { compact: 1100, mobile: 640 },
    'los cortes son los del addendum');

  const esperado = [
    [1668, 'table'],
    [1440, 'table'],
    [1280, 'table'],
    [1024, 'compact'],
    [768, 'compact'],
    [390, 'mobile'],
  ];
  for (const [width, layout] of esperado) {
    assert.equal(paTrackingLayout(width), layout, `${width}px → ${layout}`);
  }

  // Los bordes no son ambiguos: el corte entra en la variante pequeña.
  assert.equal(paTrackingLayout(1101), 'table');
  assert.equal(paTrackingLayout(1100), 'compact');
  assert.equal(paTrackingLayout(641), 'compact');
  assert.equal(paTrackingLayout(640), 'mobile');
  // Sin medida no se inventa una variante: la hoja CSS sigue mandando.
  assert.equal(paTrackingLayout(undefined), 'table');
  assert.equal(paTrackingLayout('ancho'), 'table');
  assert.equal(paTrackingLayout(0), 'table');
});

test('T-LAYOUT-04: la hoja CSS aplica los cortes que decide paTrackingLayout (tabla, tarjeta y móvil)', () => {
  const { mod } = loadModule();
  const { CSS_PA, PA_TRACK_BREAKPOINTS } = mod.__test;

  const compactAt = CSS_PA.indexOf(`@media (max-width: ${PA_TRACK_BREAKPOINTS.compact}px)`);
  const mobileAt = CSS_PA.indexOf(`@media (max-width: ${PA_TRACK_BREAKPOINTS.mobile}px)`);
  assert.ok(compactAt > 0, 'existe el corte compacto, con el número que decide la función');
  assert.ok(mobileAt > compactAt, 'existe el corte móvil, después del compacto');

  const compact = CSS_PA.slice(compactAt, mobileAt);
  // La fila se reorganiza como tarjeta: celdas en bloque, cabecera fuera y rótulo por celda.
  assert.match(compact, /\.lcr-pa-track-table td\s*\{[^}]*display:\s*block/, 'en compacto cada celda es un bloque');
  assert.match(compact, /\.lcr-pa-track-table thead\s*\{\s*display:\s*none/, 'la cabecera de tabla desaparece');
  assert.match(compact, /td::before\s*\{\s*content:\s*attr\(data-label\)/, 'cada valor conserva su rótulo');
  assert.match(compact, /\.lcr-pa-track-actions\s*\{[^}]*flex-direction:\s*column/,
    'en compacto las acciones se apilan en vertical dentro de la columna');
  assert.match(compact, /\.lcr-pa-track-actions \.lcr-pa-btn\s*\{[^}]*width:\s*100%/,
    'los botones ocupan el ancho de la tarjeta y se ven completos');

  const mobile = CSS_PA.slice(mobileAt);
  assert.match(mobile, /\.lcr-pa-track-table tbody tr\s*\{[^}]*padding/, 'en móvil la tarjeta se estrecha');
});

test('T-LAYOUT-05: nombre y ruta largos se recortan en la presentación y el texto íntegro sigue disponible', async () => {
  const { mod, panel, t } = await mountTracking();
  const { CSS_PA, PaPath } = mod.__test;

  // La hoja recorta el nombre con puntos suspensivos y deja la ruta dentro de la celda.
  assert.match(CSS_PA, /\.lcr-pa-track-name\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(CSS_PA, /\.lcr-pa-track-name\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(CSS_PA, /\.lcr-pa-track-path\s*\{[^}]*min-width:\s*0/, 'la ruta puede encogerse: no empuja la tabla');

  const primero = panel.find((node) => node.props && node.props['data-tracking-path'] === 'w-on');
  assert.ok(primero);
  const name = [...walk(primero)].find((node) => classesOf(node).includes('lcr-pa-track-name'));
  assert.equal(name.props.title, LARGO, 'el nombre completo queda en title');
  assert.equal(textOf(name), LARGO, 'el DOM lleva el nombre completo: el recorte es sólo visual');

  // La ruta llega entera al componente (que la resume en pantalla y la guarda en `title`).
  const pathNode = [...walk(primero)].find((node) => node.type === PaPath);
  assert.ok(pathNode, 'la celda del workspace incluye el componente de ruta');
  assert.equal(pathNode.props.path, RUTA_LARGA, 'la ruta completa viaja al componente');

  const rendered = PaPath({ path: RUTA_LARGA, t, onCopy: () => {} });
  const pathValue = [...walk(rendered)].find((node) => classesOf(node).includes('lcr-pa-path__value'));
  assert.equal(pathValue.props.title, RUTA_LARGA, 'la ruta completa queda en title');
  const pathButtons = [...walk(rendered)]
    .filter((node) => node.type === 'button' && classesOf(node).includes('lcr-pa-path__btn'))
    .map((node) => textOf(node));
  assert.deepEqual(pathButtons, ['Mostrar ruta', 'Copiar ruta'],
    'los botones de ruta que ya existían siguen ahí, completos');
  assert.equal(/…/.test(textOf(pathValue)), true, 'en pantalla se muestra la ruta resumida');
  assert.equal(textOf(pathValue).length < RUTA_LARGA.length, true, 'la ruta no ocupa el ancho completo');
});

test('T-LAYOUT-06: la presentación no introduce fixtures ni muta datos', async () => {
  const { panel, fetchImpl } = await mountTracking();
  assert.equal(panel.text().includes('Fixture de demostración'), false, 'sin banner de demostración');
  assert.equal(panel.text().includes('prj_k1fx_'), false, 'sin identificadores sintéticos');
  const rows = rowsOf(panel);
  assert.deepEqual(rows.map((row) => row.key), TRACKING
    .map((row) => row.pathKey).concat(['w-off']), 'las filas son las de la API, sin añadidos');
  assert.deepEqual(fetchImpl.calls.map((call) => call.method + ' ' + call.path).sort(),
    ['GET /snapshot', 'GET /snapshot', 'GET /tracking', 'GET /workspaces'],
    'la presentación sólo lee: ninguna mutación');
});

test('T-LAYOUT-07: en una sola columna el grid no estira la fila del nav (banda vacía del Host)', () => {
  // Defecto medido en el Host real a 768×1024 y 834×1024 (capturas de la aceptación 1.5.8): con el
  // layout en una columna, `.lcr-pa-layout` tiene dos filas implícitas (nav y contenido) y, como
  // hereda `flex: 1 0 auto`, su `align-content` por defecto (normal → stretch) repartía el alto
  // sobrante entre las dos: la fila del nav pasaba de 51 px a 141 px y dejaba 90 px de vacío entre
  // las pestañas y «Resumen». Sin motor de CSS en `node --test`, se comprueba la REGLA emitida.
  const { mod } = loadModule();
  const { CSS_PA, PA_TRACK_BREAKPOINTS } = mod.__test;

  // En la hoja hay más de un bloque con el corte de 1100 px (el de la tabla de Seguimiento se
  // interpola desde PA_TRACK_BREAKPOINTS). Se localiza el bloque cuyo cuerpo gobierna el layout.
  const blocks = [];
  const re = /@media \(max-width: (\d+)px\)/g;
  let hit;
  while ((hit = re.exec(CSS_PA)) !== null) {
    const end = CSS_PA.indexOf('@media', hit.index + 1);
    blocks.push({ width: Number(hit[1]), body: CSS_PA.slice(hit.index, end === -1 ? undefined : end) });
  }
  const compact = blocks.filter((b) => b.width === PA_TRACK_BREAKPOINTS.compact && /\.lcr-pa-layout\s*\{/.test(b.body));
  assert.equal(compact.length, 1, 'hay exactamente un bloque compacto que gobierna el layout');
  const body = compact[0].body;

  assert.match(body, /\.lcr-pa-layout\s*\{[^}]*grid-template-columns:\s*1fr/,
    'el corte compacto pone el layout en una columna');
  assert.match(body, /\.lcr-pa-layout\s*\{[^}]*align-content:\s*start/,
    'y declara align-content: start: las filas conservan su alto real, sin banda vacía');
  assert.equal((body.match(/\.lcr-pa-layout\s*\{/g) || []).length, 1,
    'el layout aparece una sola vez en ese corte');

  // El layout base (dos columnas, una sola fila) declara el reparto en el eje transversal, que es
  // lo que necesita el nav lateral; ahí `align-content` no participa.
  const base = CSS_PA.slice(CSS_PA.indexOf('.lcr-pa-layout {'), CSS_PA.indexOf('.lcr-pa-nav {'));
  assert.match(base, /align-items:\s*start/, 'el layout base sigue alineando sus columnas arriba');
});
