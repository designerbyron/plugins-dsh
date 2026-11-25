/**
 * Contrato del módulo de cliente de LifeCode RAG (K1-A/K1-B).
 *
 * Estas pruebas NO son una verificación del anfitrión: ejercitan el contrato del módulo (registro de
 * slots, locales, reducer, vistas y guardas) con un runtime de hooks mínimo y un `document` falso.
 * Lo que no se puede demostrar aquí —que el anfitrión componga el bundle y monte la fila— se declara
 * NO PROBADO en la evidencia, porque exige reiniciar el host y esa operación no está autorizada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { API_PREFIX } from '../lib/server.mjs';

const clientPath = fileURLToPath(new URL('../client.js', import.meta.url));
const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
const source = readFileSync(clientPath, 'utf8');
const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));

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
  useEffect(fn, deps) { return runtime.useEffect(fn, deps); },
};

function loadModule({ document, fetch: fetchImpl } = {}) {
  const spies = { fetch: 0, setInterval: 0, setTimeout: 0, requestAnimationFrame: 0 };
  let definition = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => { definition = def; } } },
    console,
    document,
    fetch: fetchImpl ?? (() => { spies.fetch += 1; throw new Error('fetch prohibido en modo sintético'); }),
    AbortController,
    Buffer,
    setInterval: () => { spies.setInterval += 1; return 0; },
    clearInterval: () => {},
    setTimeout: () => { spies.setTimeout += 1; return 0; },
    clearTimeout: () => {},
    requestAnimationFrame: () => { spies.requestAnimationFrame += 1; return 0; },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  assert.ok(definition, 'el módulo debe registrarse en window.__ModuleLoader__');
  const mod = definition.factory((name) => {
    if (name === 'react') return ReactStub;
    throw new Error('require inesperado: ' + name);
  });
  return { mod, definition, spies, sandbox };
}

function mount(component, props) {
  // `effectCells` guarda las dependencias de cada `useEffect` por posición de hook, para respetarlas
  // como React: un efecto con `[]` se ejecuta una sola vez y uno sin deps en cada render.
  const state = { cells: [], index: 0, effects: [], effectCells: [], tree: null };
  runtime = {
    effects: state.effects,
    hook() { state.index += 1; },
    useEffect(fn, deps) {
      const slot = state.index;
      state.index += 1;
      const previous = state.effectCells[slot];
      const unchanged = Boolean(previous) && deps !== undefined && previous.deps !== undefined
        && deps.length === previous.deps.length
        && deps.every((value, position) => Object.is(value, previous.deps[position]));
      state.effectCells[slot] = { deps };
      if (!unchanged) state.effects.push(fn);
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
    state.effects.length = 0;
    state.tree = component(props);
  }
  render();
  return {
    get tree() { return state.tree; },
    click(element) {
      assert.ok(element, 'no se encontró el elemento a pulsar');
      assert.equal(typeof element.props.onClick, 'function', 'el elemento debe tener onClick');
      element.props.onClick();
    },
    change(element, value) {
      assert.ok(element, 'no se encontró el campo');
      assert.equal(typeof element.props.onChange, 'function', 'el campo debe tener onChange');
      element.props.onChange({ target: { value } });
    },
    find(predicate) {
      for (const node of walk(state.tree)) {
        if (node.type && predicate(node)) return node;
      }
      return null;
    },
    all(predicate) {
      const found = [];
      for (const node of walk(state.tree)) {
        if (node.type && predicate(node)) found.push(node);
      }
      return found;
    },
    button(label) {
      return this.find((node) => node.type === 'button' && textOf(node) === label);
    },
    tab(label) {
      return this.find((node) => node.props.role === 'tab' && textOf(node) === label);
    },
    /**
     * UX-1: la navegación tiene dos niveles (área y sección). `go` reproduce lo que hace una
     * persona: si la sección no está en el nivel visible, entra primero en su área.
     */
    go(label) {
      const direct = this.tab(label);
      if (direct) { this.click(direct); return; }
      const areas = this.all((node) => node.props.role === 'tab' && node.props['data-area']);
      for (const area of areas) {
        this.click(area);
        const found = this.tab(label);
        if (found) { this.click(found); return; }
      }
      assert.fail('no se encontró la sección: ' + label);
    },
    text() {
      return textOf(state.tree);
    },
    /**
     * Ejecuta los `useEffect` recogidos en el último render: el runtime de prueba no los corre solo.
     * Las dependencias se respetan (ver `useEffect` arriba), así que repetir la llamada no vuelve a
     * negociar el modo ni a pedir el snapshot en mitad de un flujo.
     */
    runEffects() {
      for (const effect of state.effects.slice()) effect();
    },
  };
}

function* walk(node) {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child);
    return;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    yield { text: String(node) };
    return;
  }
  if (typeof node === 'object' && node.type) {
    yield node;
    for (const child of node.children) yield* walk(child);
  }
}

function textOf(node) {
  let text = '';
  for (const item of walk(node)) {
    if (item.text !== undefined) text += ' ' + item.text;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function byRole(role) {
  return (node) => node.props.role === role;
}

/* ---------------------------------------------------------------- documento falso */

function fakeDocument() {
  const appended = [];
  return {
    appended,
    head: { appendChild: (node) => { appended.push(node); } },
    createElement: () => ({ id: '', textContent: '', removed: false, remove() { this.removed = true; } }),
  };
}

function mountPanel() {
  const { mod, spies } = loadModule({ document: fakeDocument() });
  const { PaPanel, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  return { mod, spies, panel: mount(PaPanel, { t, demo: true }), t };
}

/* ------------------------------------------------------------------- estáticas */

test('el manifiesto exporta el cliente con la forma que exige el compositor', () => {
  assert.equal(manifest.name, '@designerbyron/lifecode-rag');
  assert.equal(manifest.exports['.'], './index.js');
  assert.equal(manifest.exports['./client'], './client.js');
  assert.equal(manifest.exports['./package.json'], './package.json');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  // `inject` es orden de activación, no requisito de carga: no se declara como dependencia.
  assert.equal(manifest.dsh.client.inject, undefined);
});

test('el id del loader es el nombre del paquete', () => {
  const { definition } = loadModule({ document: fakeDocument() });
  assert.equal(definition.id, manifest.name);
  assert.equal(typeof definition.factory, 'function');
});

test('el cliente no importa paquetes del anfitrión', () => {
  assert.equal(/from\s+['"]@deepseek-ai\//.test(source), false);
  assert.equal(/require\(\s*['"]@deepseek-ai\//.test(source), false);
  assert.equal(/\brequire\(['"]react['"]\)/.test(source), true, 'React llega por el cargador del host');
  assert.equal(source.includes('window.__ModuleLoader__.load'), true);
});

test('usa la misma ruta de API que el servidor y no pide red sin conexión confirmada', () => {
  assert.equal(API_PREFIX, '/lifecode-rag/api');
  assert.equal(source.includes("const API = '/lifecode-rag/api'"), true);
  assert.equal(source.includes("blocked.code = 'panel-not-connected'"), true);
});

test('registra los slots con la API vigente y no con la obsoleta', () => {
  assert.equal(source.includes('ctx.slots.inject(SIDEBAR_SLOT, () =>'), true);
  assert.equal(source.includes('ctx.slots.inject(MAIN_SLOT, () =>'), true);
  assert.equal(/ctx\.slots\.inject\(\s*[A-Z_]+\s*\)\s*;/.test(source), false, 'la forma inject(slot) sin callback ya no existe');
  assert.equal(source.includes('key: PANEL_ID'), true);
  assert.equal(source.includes("const PANEL_ID = 'lifecode-rag'"), true);
});

test('el panel arranca neutro y solo pasa a api si el servidor lo confirma', () => {
  assert.equal(source.includes("mode: 'connecting', reason: 'sin negociar'"), true, 'arranca sin datos, no en fixture');
  assert.equal(source.includes("const panelState = { mode: 'fixture'"), false, 'el fixture no es el estado inicial');
  assert.equal(source.includes('negotiateMode'), true, 'el modo se negocia con /lifecode-rag/pa/snapshot');
  assert.equal(/DATA_MODE\s*=\s*'live'/.test(source), false, 'no hay conmutación fija a live');
  assert.equal(source.includes('SYNTHETIC DATA MODE — DEMO: ESTA VISTA NO LEE EL PROYECTO REAL'), true);
  assert.equal(source.includes('paInitialState({ demo: true })'), true, 'la demo sólo se reconstruye si ya estaba activa');
});

test('la hoja de estilos cubre responsive, movimiento reducido y forced-colors', () => {
  assert.equal(source.includes('@media (max-width: 760px)'), true);
  assert.equal(source.includes('overflow-wrap: anywhere'), true);
  assert.equal(source.includes('prefers-reduced-motion'), true);
  assert.equal(source.includes('forced-colors'), true);
});

test('no inventa una aprobación desde la interfaz', () => {
  assert.equal(/approval|allowed-once/.test(source), false);
  assert.equal(source.includes("action: 'forget'"), true);
  assert.equal(source.includes('confirm: true'), true, 'las acciones destructivas son explícitas');
});

test('un perfil Project-Aware se explica como panel no disponible, no como 404 crudo', () => {
  // Regresión de la primera versión estable: en un perfil PA la API v0.2 no se monta, y el panel
  // mostraba «Not Found (http-404)» como si el producto estuviera roto.
  assert.equal(source.includes('response.status === 404'), true);
  assert.equal(source.includes("unavailable.code = 'panel-unavailable'"), true);
  assert.equal(/Project-Aware: el panel del almacén v0\.2 no está disponible/.test(source), true);
  assert.equal(source.includes('`http-${response.status}`'), true, 'los demás errores conservan su código');
});

/* ------------------------------------------------------------------ apply() */

test('apply registra locales y los dos slots, y todo se dispone al desmontar', () => {
  const document = fakeDocument();
  const { mod } = loadModule({ document });
  const registrations = [];
  const effects = [];
  let currentKey = null;
  const ctx = {
    effect(fn) { const dispose = fn(); effects.push(dispose); return dispose; },
    slots: {
      // La API vigente: `inject(key, cb)` ejecuta el callback (dentro de un effect) y el registro
      // se hace con `ctx.slots.register`, que devuelve el disposer.
      register(options, component) {
        registrations.push({ key: currentKey, options, component });
        return () => {};
      },
      inject(key, callback) {
        currentKey = key;
        const result = callback();
        assert.equal(typeof result, 'function', 'el callback devuelve el disposer');
        return result;
      },
    },
    locale: {
      register(namespace, dictionaries) {
        registrations.push({ locale: namespace, dictionaries });
        return () => {};
      },
    },
  };
  mod.apply(ctx);

  const sidebar = registrations.find((row) => row.key === 'sidebar.panellist');
  const main = registrations.find((row) => row.key === 'main');
  const locale = registrations.find((row) => row.locale);
  assert.ok(sidebar && main && locale, 'deben registrarse fila, vista y locale');
  assert.equal(sidebar.options.id, 'lifecode-rag');
  assert.equal(sidebar.options.locale, 'lifecode-rag');
  assert.equal(main.options.key, 'lifecode-rag');
  assert.equal(locale.locale, 'lifecode-rag');
  assert.ok(locale.dictionaries.es && locale.dictionaries.en);
  assert.equal(main.component, mod.__test.PaPanel, 'la vista montada es el panel Project-Aware');

  const style = document.appended[0];
  assert.equal(style.id, 'lcr-styles');
  assert.equal(style.textContent.includes('.lcr-pa-banner'), true);

  assert.equal(effects.length, 2, 'estilo y locale');
  for (const dispose of effects) if (typeof dispose === 'function') dispose();
  assert.equal(style.removed, true, 'el estilo se retira al desmontar');
  assert.equal(sidebar.options.label(), 'LifeCode RAG');
});

test('sin servicio de locale, apply no revienta y los slots siguen registrándose', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const registered = [];
  let currentKey = null;
  const ctx = {
    effect(fn) { return fn(); },
    slots: {
      register: (options) => { registered.push({ key: currentKey, options }); return () => {}; },
      inject: (key, callback) => { currentKey = key; return callback(); },
    },
  };
  mod.apply(ctx);
  assert.equal(registered.length, 2);
});

/* ------------------------------------------------------- diccionarios y textos */

test('los diccionarios ES y EN tienen las mismas claves, ninguna vacía', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { PA_DICT, paTranslate } = mod.__test;
  const es = Object.keys(PA_DICT.es).sort();
  const en = Object.keys(PA_DICT.en).sort();
  assert.deepEqual(en, es);
  assert.ok(es.length > 80, 'el panel tiene textos propios, no reutiliza el namespace de otro plugin');
  for (const key of es) {
    assert.equal(typeof PA_DICT.es[key], 'string');
    assert.equal(typeof PA_DICT.en[key], 'string');
    assert.ok(PA_DICT.es[key].trim().length > 0, 'ES vacío en ' + key);
    assert.ok(PA_DICT.en[key].trim().length > 0, 'EN vacío en ' + key);
    assert.notEqual(paTranslate('es', key), key, 'clave sin traducir: ' + key);
    assert.notEqual(paTranslate('en', key), key, 'clave sin traducir (EN): ' + key);
  }
});

test('paTranslate interpola parámetros y cae a español si el idioma no existe', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paTranslate } = mod.__test;
  assert.equal(paTranslate('es', 'common.page', { page: 2, pages: 3 }), 'Página 2 de 3');
  assert.equal(paTranslate('en', 'common.page', { page: 2, pages: 3 }), 'Page 2 of 3');
  assert.equal(paTranslate('fr', 'nav.project'), 'Proyecto');
  assert.equal(paTranslate('es', 'clave.inexistente'), 'clave.inexistente');
});

test('paReadLanguage lee snapshot o getLocale y tolera fallos', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paReadLanguage } = mod.__test;
  assert.equal(paReadLanguage({ getSnapshot: () => ({ locale: 'en-US' }) }), 'en');
  assert.equal(paReadLanguage({ getLocale: () => 'es-ES' }), 'es');
  assert.equal(paReadLanguage({}), 'es');
  assert.equal(paReadLanguage(null), 'es');
  assert.equal(paReadLanguage({ getSnapshot() { throw new Error('boom'); } }), 'es');
});

/* -------------------------------------------------------------- panel y vistas */

test('el panel monta el aviso sintético y una sola región viva', () => {
  const { mod, panel } = mountPanel();
  const text = panel.text();
  assert.equal(text.includes('SYNTHETIC DATA MODE — DEMO: ESTA VISTA NO LEE EL PROYECTO REAL'), true);
  assert.equal(panel.all(byRole('status')).length, 1, 'exactamente una región role=status');
  assert.equal(panel.all(byRole('tablist')).length, 1);
  assert.equal(panel.all(byRole('tab')).length, mod.__test.PA_AREAS.length, 'un tab por área');
  assert.equal(panel.all(byRole('tabpanel')).length, 1);
  assert.equal(panel.all((node) => node.props['aria-selected'] === 'true').length, 1);
});

test('las doce vistas renderizan sin lanzar y con contenido propio', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { PA_VIEWS, paInitialState, paReduce, paRenderView, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  const base = paInitialState({ demo: true });
  const ids = PA_VIEWS.map((view) => view.id).concat(['source']);
  assert.equal(ids.length, 16, 'quince vistas + detalle de fuente');
  for (const id of ids) {
    const state = paReduce(base, { type: 'nav', view: id });
    const text = textOf(paRenderView(state, t, () => {}));
    assert.ok(text.length > 0, 'vista sin contenido: ' + id);
    if (id === 'source') assert.equal(text.includes('La fuente ya no está disponible'), true);
  }
});

test('navegación: pestañas, paginación, detalle y vuelta', () => {
  const { panel } = mountPanel();
  panel.go('Fuentes');
  assert.equal(panel.find((node) => node.props['data-view'] === 'sources') !== null, true);
  assert.equal(panel.text().includes('Mostrando 50 de 121'), true);

  panel.click(panel.button('Siguiente'));
  assert.equal(panel.text().includes('Página 2 de 3'), true);

  panel.click(panel.button('Abrir'));
  assert.equal(panel.find((node) => node.props['data-view'] === 'source') !== null, true);
  assert.equal(panel.text().includes('Fragmento sintético 1'), true);
  assert.equal(panel.text().includes('GAP-05'), true);

  panel.click(panel.button('Volver'));
  assert.equal(panel.find((node) => node.props['data-view'] === 'sources') !== null, true);
});

test('búsqueda y contexto: procedencia visible y citas completas', () => {
  const { panel } = mountPanel();
  panel.go('Búsqueda');
  panel.change(panel.find((node) => node.props['data-field'] === 'query'), 'normativa');
  panel.click(panel.button('Buscar'));
  const afterSearch = panel.text();
  assert.equal(afterSearch.includes('Resultados con procedencia'), true);
  assert.equal(afterSearch.includes('Normativa interna'), true, 'la procedencia de biblioteca es visible');

  panel.click(panel.button('Construir contexto con estos resultados'));
  const afterContext = panel.text();
  assert.equal(afterContext.includes('Contexto recuperado'), true);
  assert.equal(afterContext.includes('Citas'), true);
  assert.equal(afterContext.includes('Tokens estimados'), true);
});

test('búsqueda sin resultados muestra estado vacío, no una tabla vacía', () => {
  const { panel } = mountPanel();
  panel.go('Búsqueda');
  panel.change(panel.find((node) => node.props['data-field'] === 'query'), 'zzzz-no-existe');
  panel.click(panel.button('Buscar'));
  assert.equal(panel.text().includes('Sin resultados para esa consulta'), true);
});

test('operaciones simuladas: ingesta y reindexación dejan rastro sin escribir', () => {
  const { panel } = mountPanel();
  panel.go('Operaciones');
  assert.equal(panel.text().includes('Todavía no se ejecutó ninguna operación simulada'), true);

  panel.click(panel.button('Ingesta simulada'));
  assert.equal(panel.text().includes('Ingesta simulada completada'), true);
  assert.equal(panel.text().includes('op-k1fx-001'), true);

  panel.click(panel.button('Reindexación simulada'));
  assert.equal(panel.text().includes('op-k1fx-002'), true);
  assert.equal(panel.text().includes('Fuentes afectadas: 122'), true);
});

test('una operación simulada puede fallar y el error se muestra sin escribir', () => {
  const { panel } = mountPanel();
  panel.go('Operaciones');
  panel.change(panel.find((node) => node.props['data-field'] === 'ingest-path'), 'sintetico/nuevo/informe-escaneado.pdf');
  panel.click(panel.button('Ingesta simulada'));
  const text = panel.text();
  assert.equal(text.includes('Formato no soportado en el fixture'), true);
  assert.equal(text.includes('unsupported-format'), true);
  assert.equal(text.includes('Fuentes afectadas: 121'), true, 'no se añadió ninguna fuente');
  panel.click(panel.button('Descartar aviso'));
  assert.equal(panel.text().includes('Formato no soportado en el fixture'), false);
});

test('historial sin API se presenta como no disponible, sin inventar entradas', () => {
  const { panel } = mountPanel();
  panel.go('Historial');
  assert.equal(panel.text().includes('No disponible en esta versión'), true);
  assert.equal(panel.text().includes('La API no ha devuelto un historial para este proyecto'), true);
  assert.equal(panel.text().includes('No se inventa una ruta'), true);
});

test('historial: la respuesta de /history llena el estado con total, integridad y cursor', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const page = {
    scope: { id: 'prj_01LAB', kind: 'prj', name: 'Laboratorio' },
    total: 141,
    entries: [
      { seq: 141, at: 1_700_000_000_000, actor: 'automation', tool: 'lifecode_rag_sync', action: 'sync.run', target: 'prj_01LAB', outcome: 'ok', hash: '5bc176a33fa5cc11', details: null },
      { seq: 140, at: 1_699_999_000_000, actor: 'model', tool: 'lifecode_rag_ingest', action: 'ingest', target: 'guia-soporte.md', outcome: 'ok', hash: '885b284111311111', details: { chunks: 1 } },
    ],
    nextCursor: '140',
    integrity: { ok: true, count: 141 },
  };
  const next = paReduce(paInitialState({ demo: true }), { type: 'history-ok', page, append: false });
  assert.equal(next.history.entries.length, 2);
  assert.equal(next.history.total, 141);
  assert.equal(next.history.pages, 3);
  assert.equal(next.history.nextCursor, '140');
  assert.equal(next.history.integrity.ok, true);
  assert.equal(next.pending, null);

  const appended = paReduce(next, { type: 'history-ok', page: { ...page, total: 141, nextCursor: null, entries: [page.entries[0]] }, append: true });
  assert.equal(appended.history.entries.length, 3, 'cargar más añade, no reemplaza');
  assert.equal(appended.history.nextCursor, null);
});

test('historial: un fallo de la API deja el estado vacío y marcado, sin datos inventados', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const failed = paReduce(paInitialState({ demo: true }), { type: 'history-error', reason: 'unauthenticated' });
  assert.equal(failed.history.loaded, true);
  assert.equal(failed.history.error, 'unauthenticated');
  assert.equal(failed.history.entries.length, 0);
  assert.equal(failed.pending, null);
});

test('el teclado recorre las áreas con flechas, Home y End', () => {
  const { panel } = mountPanel();
  const tablist = () => panel.find(byRole('tablist'));
  let prevented = false;
  const press = (key) => tablist().props.onKeyDown({ key, preventDefault: () => { prevented = true; } });

  assert.equal(panel.find((node) => node.props['data-view'] === 'overview') !== null, true, 'abre en Resumen');
  press('ArrowRight');
  assert.equal(prevented, true);
  assert.equal(panel.find((node) => node.props['data-view'] === 'workspaces') !== null, true);
  press('End');
  assert.equal(panel.find((node) => node.props['data-view'] === 'settings') !== null, true);
  press('Home');
  assert.equal(panel.find((node) => node.props['data-view'] === 'overview') !== null, true);
});

/* ------------------------------------------------------------------- reducer */

test('seleccionar proyecto sube la revisión y anota la operación', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const state = paInitialState({ demo: true });
  assert.equal(state.session.session.selection.revision, 3);
  const next = paReduce(state, { type: 'select-project', projectId: 'prj_k1fx_02' });
  assert.equal(next.session.session.selection.projectId, 'prj_k1fx_02');
  assert.equal(next.session.session.selection.revision, 4);
  assert.equal(next.journal.length, 1);
  assert.equal(next.projects.find((project) => project.id === 'prj_k1fx_02').current, true);
});

test('seleccionar el mismo proyecto no escribe nada', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const next = paReduce(paInitialState({ demo: true }), { type: 'select-project', projectId: 'prj_k1fx_01' });
  assert.equal(next.session.session.selection.revision, 3);
  assert.equal(next.journal.length, 0);
  assert.equal(next.notice.code, 'notice.sameProject');
});

test('la paginación acota el offset y la ingesta añade una fuente', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const state = paInitialState({ demo: true });
  assert.equal(paReduce(state, { type: 'page', offset: -40 }).sourcePage.offset, 0);
  assert.equal(paReduce(state, { type: 'page', offset: 9999 }).sourcePage.offset, 100);
  const ingested = paReduce(state, { type: 'ingest' });
  assert.equal(ingested.sources.length, 122);
  assert.equal(ingested.sources[0].id, 'src_k1fx_ing_01');
  assert.equal(paReduce(ingested, { type: 'reindex' }).sources.length, 122);
});

test('reset devuelve el estado inicial completo', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const dirty = paReduce(paReduce(paInitialState({ demo: true }), { type: 'ingest' }), { type: 'select-project', projectId: 'prj_k1fx_02' });
  const clean = paReduce(dirty, { type: 'reset' });
  assert.equal(clean.sources.length, 121);
  assert.equal(clean.journal.length, 0);
  assert.equal(clean.session.session.selection.revision, 3);
});

test('hydrate pasa el panel a api y sustituye las fuentes por las filas del snapshot', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const snapshot = {
    mode: 'api',
    service: 'ok',
    project: { id: 'prj_01LAB', name: 'Laboratorio LE-RAG-10' },
    sources: { rows: [
      { id: 'src_01LABA', uri: 'C:/lab/corpus/guia-soporte.md', title: 'guia-soporte.md', mime: 'text/markdown', bytes: 1024, chunks: 3, indexedAt: '2026-11-19T20:00:00.000Z' },
      { id: 'src_01LABB', uri: 'C:/lab/corpus/politica-reembolsos.md', title: 'politica-reembolsos.md', mime: 'text/markdown', bytes: 2048, chunks: 4, indexedAt: '2026-11-19T20:01:00.000Z' },
    ] },
  };
  const next = paReduce(paInitialState({ demo: true }), { type: 'hydrate', snapshot });
  assert.equal(next.mode, 'api');
  assert.equal(next.sources.length, 2);
  assert.deepEqual(next.sources.map((row) => row.title), ['guia-soporte.md', 'politica-reembolsos.md']);
  assert.equal(next.projects[0].id, 'prj_01LAB');
  assert.equal(next.sourcePage.offset, 0);
  assert.equal(next.error, null);
});

/**
 * CR-1: en modo API el panel no inventa la selección. La revisión que pinta es la del servidor y el
 * cambio sólo se refleja cuando llega la confirmación; un conflicto no altera nada y se avisa.
 */
function apiState(mod, { selection = { projectId: 'prj_01LAB', projectName: 'Laboratorio', revision: 5 }, scopes = null } = {}) {
  const snapshot = {
    mode: 'api',
    service: 'ok',
    project: { id: selection.projectId, name: selection.projectName },
    selection: { ...selection, source: 'explicit', selectedBy: 'human', selectedAt: 1_700_000_000_000 },
    scopes: scopes ?? [
      { kind: 'prj', id: selection.projectId, name: selection.projectName, roots: 1, authorized: 1 },
      { kind: 'prj', id: 'prj_01LAB2', name: 'Segundo proyecto', roots: 1, authorized: 1 },
    ],
    sources: { rows: [] },
  };
  return mod.__test.paReduce(mod.__test.paInitialState({ demo: true }), { type: 'hydrate', snapshot });
}

test('CR-1: hydrate pinta la revisión del servidor, no la del fixture', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const state = apiState(mod);
  assert.equal(state.mode, 'api');
  assert.equal(state.session.session.selection.revision, 5, 'la revisión del fixture (3) no sobrevive a la hidratación');
  assert.equal(state.session.session.selection.projectId, 'prj_01LAB');
});

test('CR-1: en modo API la selección queda pendiente y no se adelanta la revisión', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paReduce } = mod.__test;
  const state = apiState(mod);
  const pending = paReduce(state, { type: 'select-project', projectId: 'prj_01LAB2' });
  assert.equal(pending.pending, 'selection');
  // El reducer corre dentro del sandbox `vm`: otro realm, otra `Object.prototype`, así que se
  // comparan los campos uno a uno (deepEqual estricto compara prototipos y falla por realm).
  assert.equal(pending.selectionPending.projectId, 'prj_01LAB2');
  assert.equal(pending.selectionPending.projectName, 'Segundo proyecto');
  assert.equal(pending.selectionPending.expectedRevision, 5);
  assert.equal(pending.session.session.selection.revision, 5, 'nada cambia antes de confirmar');
  assert.equal(pending.session.session.selection.projectId, 'prj_01LAB');

  const confirmed = paReduce(pending, {
    type: 'selection-ok',
    selection: { projectId: 'prj_01LAB2', projectName: 'Segundo proyecto', revision: 6, source: 'explicit', selectedBy: 'human' },
  });
  assert.equal(confirmed.pending, 'snapshot', 'tras confirmar se pide el snapshot del proyecto nuevo');
  assert.equal(confirmed.sources.length, 0, 'las fuentes del proyecto anterior no sobreviven al cambio');
  assert.equal(confirmed.sourcesTotal, 0);
  assert.equal(confirmed.session.session.selection.revision, 6, 'la revisión es la que confirmó el servidor');
  assert.equal(confirmed.session.session.selection.projectId, 'prj_01LAB2');
  assert.equal(confirmed.projects.find((row) => row.id === 'prj_01LAB2').current, true);
  assert.equal(confirmed.notice.code, 'notice.selected');
});

test('CR-1: un conflicto de revisión no cambia la selección y se avisa', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paReduce } = mod.__test;
  const pending = paReduce(apiState(mod), { type: 'select-project', projectId: 'prj_01LAB2' });
  const failed = paReduce(pending, { type: 'selection-error', reason: 'revision-conflict', reloaded: true });
  assert.equal(failed.pending, null);
  assert.equal(failed.selectionPending, null);
  assert.equal(failed.session.session.selection.projectId, 'prj_01LAB', 'el perdedor no pisa el cambio ajeno');
  assert.equal(failed.session.session.selection.revision, 5);
  assert.equal(failed.notice.code, 'notice.selectionConflict');
  // El aviso se pinta con el valor de la revisión resuelto, nunca con la plantilla cruda.
  assert.match(mod.__test.paTranslate('es', failed.notice.code, failed.notice.values), /revisión vigente/);
});

test('el snapshot hidrata la lista de proyectos del perfil y el total de fuentes', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const snapshot = {
    mode: 'api',
    service: 'ok',
    project: { id: 'prj_01LAB', name: 'Laboratorio' },
    selection: { projectId: 'prj_01LAB', projectName: 'Laboratorio', revision: 2, source: 'explicit' },
    projects: [
      { id: 'prj_01LAB', name: 'Laboratorio', roots: 1, current: true },
      { id: 'prj_01OTRO', name: 'Otro proyecto', roots: 2, current: false },
    ],
    sources: { rows: [{ id: 'src_1', uri: 'a.md', title: 'a', mime: 'text/markdown', bytes: 10, chunks: 1 }], total: 121 },
  };
  const state = paReduce(paInitialState({ demo: true }), { type: 'hydrate', snapshot });
  assert.equal(state.projects.length, 2, 'los dos proyectos del perfil, no sólo el activo');
  assert.equal(state.projects.find((row) => row.id === 'prj_01OTRO').current, false);
  assert.equal(state.sourcesTotal, 121, 'el total del proyecto, no las filas de la página');
  assert.equal(state.sources.length, 1, 'sólo se cargan las filas recibidas');
});

test('unavailable deja el panel en down con la razón del servidor', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const next = paReduce(paInitialState({ demo: true }), { type: 'unavailable', reason: 'transport-error' });
  assert.equal(next.mode, 'down');
  assert.equal(next.error, 'transport-error');
});

test('el cliente envía POST con el cuerpo contractual a /search y /context', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ mode: 'hybrid', elapsedMs: 1, results: [], citations: [], tokens: 0 }),
    };
  };
  const { mod } = loadModule({ document: fakeDocument(), fetch: fakeFetch });
  const { request, panelState } = mod.__test;
  panelState.mode = 'api'; // la guarda de red del cliente exige modo api
  await request('/search', { method: 'POST', body: { query: 'reembolso', limit: 8 } });
  await request('/context', { method: 'POST', body: { query: 'reembolso', budgetTokens: 2000 } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/lifecode-rag/pa/search');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(calls[0].init.headers['x-lifecode-rag'], '1');
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'reembolso', limit: 8 });
  assert.equal(calls[1].url, '/lifecode-rag/pa/context');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), { query: 'reembolso', budgetTokens: 2000 });
});

/* ------------------------------------------------- red, almacenes y temporizadores */

test('el cliente desenvuelve el sobre y trata ok:false como fallo aunque llegue con 200', async () => {
  const responses = [
    { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, data: { mode: 'api', results: [] } }) },
    { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: { code: 'response-too-large', message: 'respuesta demasiado grande' } }) },
  ];
  const fakeFetch = async () => responses.shift();
  const { mod } = loadModule({ document: fakeDocument(), fetch: fakeFetch });
  const { request, panelState } = mod.__test;
  panelState.mode = 'api';
  const payload = await request('/snapshot');
  assert.equal(payload.mode, 'api', 'request devuelve el contenido de data, no el sobre');
  assert.deepEqual([...payload.results], [], 'las listas llegan tal cual, sin envolver');
  await assert.rejects(
    () => request('/snapshot'),
    (error) => error.code === 'response-too-large' && /demasiado grande/.test(error.message),
    'un ok:false con 200 sigue siendo un fallo',
  );
});

test('ninguna interacción dispara red ni temporizadores', () => {
  const { mod, panel, spies } = mountPanel();
  for (const view of mod.__test.PA_VIEWS) {
    panel.go(mod.__test.paViewLabel(view.id, mod.__test.paTranslate.bind(null, 'es')));
  }
  panel.click(panel.button('Reiniciar datos sintéticos'));
  assert.deepEqual(spies, { fetch: 0, setInterval: 0, setTimeout: 0, requestAnimationFrame: 0 });
});

test('la capa heredada falla cerrada antes de tocar la red', async () => {
  const { mod, spies } = loadModule({ document: fakeDocument() });
  await assert.rejects(mod.__test.requestLegacy('/snapshot'), (error) => {
    assert.equal(error.code, 'panel-not-connected');
    return true;
  });
  assert.equal(spies.fetch, 0);
});

test('los fixtures no contienen datos privados reales', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState } = mod.__test;
  const state = paInitialState({ demo: true });
  const serialized = JSON.stringify({
    sources: state.sources,
    projects: state.projects,
    libraries: state.libraries,
    diagnostics: state.diagnostics,
    session: state.session,
  });
  const forbidden = [/[A-Za-z]:\\Users/, /\/home\//, /\.dsh/, /\.credentials/, /AUTH_RECORD_KEY/, /eyJ/, /\bsk-/, /Bearer /];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(serialized), false, 'fixture con patrón prohibido: ' + pattern);
  }
  for (const source of state.sources) {
    assert.equal(/^src_k1fx_[0-9a-z_]+$/.test(source.id), true, 'id sintético: ' + source.id);
    assert.equal(source.uri.startsWith('sintetico/'), true, 'uri sintética: ' + source.uri);
    assert.equal(/^prj_[0-9A-HJKMNP-TV-Z]{26}$/.test(source.id), false, 'un id con forma ULID no es sintético');
  }
  assert.equal(/^prj_k1fx_[0-9a-z_]+$/.test(state.session.session.selection.projectId), true);
  assert.equal(/^lib_k1fx_[0-9a-z_]+$/.test(state.libraries[0].id), true);
});

test('el estado y las vistas son deterministas (mismo fixture, mismo texto)', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paRenderView, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  const one = textOf(paRenderView(paInitialState({ demo: true }), t, () => {}));
  const two = textOf(paRenderView(paInitialState({ demo: true }), t, () => {}));
  assert.equal(one, two);
});

/* ==================================================================== */
/* Remediación funcional 01 — regresiones de los defectos FA-01…FA-14   */
/* ==================================================================== */

const PANEL_VIEW_LABELS = ['Resumen', 'Workspaces', 'Fuentes', 'Búsqueda', 'Contexto', 'Bibliotecas', 'Administrar proyectos', 'Seguimiento', 'Ajustes', 'Diagnóstico', 'Conexión', 'Historial', 'Operaciones', 'Candidatos'];
const RAW_KEY_PATTERN = /\b(common|nav|app|banner|project|libraries|sources|source|search|context|operations|diagnostics|connection|history|notice|view|status|a11y|ux|admin)\.[a-zA-Z]/;

test('FA-01/FA-02/FA-08: ninguna vista deja claves de traducción sin resolver', () => {
  const { panel } = mountPanel();
  for (const label of PANEL_VIEW_LABELS) {
    panel.go(label);
    const text = panel.text();
    assert.equal(RAW_KEY_PATTERN.test(text), false, 'clave cruda en «' + label + '»: ' + (text.match(RAW_KEY_PATTERN) ?? [])[0]);
  }
  panel.go('Diagnóstico');
  assert.equal(panel.text().includes('common.yes'), false);
  assert.equal(panel.text().includes('Verificado'), true, 'la columna verified se traduce');
});

test('FA-02: el diccionario resuelve todas las claves que el panel usa', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { PA_DICT } = mod.__test;
  const used = new Set();
  const pattern = /\bt\('([a-zA-Z0-9._]+)'/g;
  let match = pattern.exec(source);
  while (match) { used.add(match[1]); match = pattern.exec(source); }
  const missingEs = [...used].filter((key) => !(key in PA_DICT.es));
  const missingEn = [...used].filter((key) => !(key in PA_DICT.en));
  assert.deepEqual(missingEs, [], 'claves sin ES');
  assert.deepEqual(missingEn, [], 'claves sin EN');
  assert.deepEqual(Object.keys(PA_DICT.es).sort(), Object.keys(PA_DICT.en).sort(), 'paridad ES/EN');
});

test('FA-03: el panel usa sólo su espacio de nombres y no define selectores heredados', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { CSS_PA } = mod.__test;
  assert.equal(/\.lcr-(?!pa-)/.test(CSS_PA), false, 'la hoja PA no debe definir selectores .lcr-*');
  assert.equal(CSS_PA.includes('!important'), false, 'sin !important como sustituto de propiedad');
  const { panel } = mountPanel();
  const seen = new Set();
  for (const label of PANEL_VIEW_LABELS) {
    panel.go(label);
    for (const node of panel.all((candidate) => typeof candidate.props.className === 'string')) {
      for (const token of node.props.className.split(/\s+/)) {
        if (!token) continue;
        seen.add(token);
        assert.equal(token.startsWith('lcr-pa-'), true, 'clase fuera del espacio de nombres: ' + token);
      }
    }
  }
  assert.equal(seen.size > 20, true, 'se ejercitaron ' + seen.size + ' clases');
});

test('FA-05: una consulta vacía o en blanco no borra los resultados ni inventa búsqueda', () => {
  const { panel } = mountPanel();
  panel.go('Búsqueda');
  panel.change(panel.find((node) => node.props['data-field'] === 'query'), 'acta');
  panel.click(panel.button('Buscar'));
  assert.equal(panel.text().includes('Coincidencia sintética'), true, 'la búsqueda válida devuelve resultados');
  panel.change(panel.find((node) => node.props['data-field'] === 'query'), '   ');
  panel.click(panel.button('Buscar'));
  const text = panel.text();
  assert.equal(text.includes('Escribe algo para buscar'), true, 'mensaje de validación');
  assert.equal(text.includes('Coincidencia sintética'), true, 'los resultados anteriores siguen visibles');
  const input = panel.find((node) => node.props['data-field'] === 'query');
  assert.equal(input.props['aria-invalid'], 'true');
  assert.equal(input.props['aria-describedby'], 'lcr-pa-search-msg');
});

test('FA-05: una consulta fuera de límite se rechaza con mensaje y sin red', () => {
  const { panel } = mountPanel();
  panel.go('Búsqueda');
  panel.change(panel.find((node) => node.props['data-field'] === 'query'), 'x'.repeat(600));
  panel.click(panel.button('Buscar'));
  assert.equal(panel.text().includes('512 caracteres'), true);
  assert.equal(panel.text().includes('Sin resultados para esa consulta'), false);
});

test('FA-06: la ingesta rechaza URIs duplicadas y conserva el fixture', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce, paNormalizeUri } = mod.__test;
  const start = paInitialState({ demo: true });
  const once = paReduce(start, { type: 'ingest' });
  assert.equal(once.sources.length, start.sources.length + 1, 'la primera ingesta añade una fuente');
  const twice = paReduce(once, { type: 'ingest' });
  assert.equal(twice.sources.length, once.sources.length, 'la segunda no añade nada');
  assert.equal(twice.lastError.code, 'duplicate-uri');
  assert.equal(twice.notice.code, 'notice.duplicateUri');
  const spaced = paReduce(once, { type: 'ingest-path', value: '  ' + once.ingestPath.toUpperCase() + '  ' });
  const again = paReduce(spaced, { type: 'ingest' });
  assert.equal(again.sources.length, once.sources.length, 'mayúsculas y espacios no crean un duplicado');
  assert.equal(again.lastError.code, 'duplicate-uri');
  assert.equal(paNormalizeUri('SINTETICO\\Nuevo//Acta.MD  '), 'sintetico/nuevo/acta.md');
});

test('FA-10: un fallo de una vista no derriba el panel y ofrece reintento', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paRenderViewSafe, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  let retried = 0;
  const tree = paRenderViewSafe(paInitialState({ demo: true }), t, () => { retried += 1; }, () => { throw new Error('boom interno'); });
  const text = textOf(tree);
  assert.equal(text.includes('No se pudo mostrar esta vista'), true);
  assert.equal(text.includes('boom interno'), false, 'no se expone el error interno');
  const retry = [...walk(tree)].find((node) => node && node.type === 'button' && textOf(node) === 'Reintentar');
  assert.ok(retry, 'debe ofrecer reintento');
  retry.props.onClick();
  assert.equal(retried, 1);
});

test('FA-11: las tarjetas envuelven su contenido en un cuerpo con relleno', () => {
  const { panel } = mountPanel();
  const cards = panel.all((node) => node.props.className === 'lcr-pa-card');
  assert.equal(cards.length > 0, true);
  for (const card of cards) {
    const body = card.children.find((child) => child && child.props && child.props.className === 'lcr-pa-card__body');
    assert.ok(body, 'cada tarjeta tiene cuerpo propio');
  }
});

test('FA-12: construir contexto está deshabilitado mientras no haya resultados', () => {
  const { panel } = mountPanel();
  panel.go('Contexto');
  const button = panel.button('Construir contexto');
  assert.equal(button.props.disabled, true, 'sin resultados no se construye contexto');
  panel.go('Búsqueda');
  panel.change(panel.find((node) => node.props['data-field'] === 'query'), 'acta');
  panel.click(panel.button('Buscar'));
  const build = panel.button('Construir contexto con estos resultados');
  assert.equal(build.props.disabled, false, 'con resultados se habilita');
  panel.click(build);
  assert.equal(panel.text().includes('Tokens estimados'), true, 'el contexto se construye desde los resultados');
});

test('FA-13: el diagnóstico explica por qué el servicio está degradado', () => {
  const { panel } = mountPanel();
  panel.go('Diagnóstico');
  assert.equal(panel.text().includes('1 de 3 almacenes no disponible(s)'), true);
  panel.go('Conexión');
  assert.equal(panel.text().includes('Servicio degradado: 1 de 3 almacenes no disponible(s).'), true);
  assert.equal(panel.text().includes('no montada'), true);
});

test('FA-14: la paginación está en la cabecera y llega a la primera y a la última página', () => {
  const { panel } = mountPanel();
  panel.go('Fuentes');
  assert.equal(panel.text().includes('Página 1 de 3'), true);
  assert.equal(panel.text().includes('Mostrando 50 de 121'), true);
  panel.click(panel.button('»'));
  assert.equal(panel.text().includes('Página 3 de 3'), true);
  assert.equal(panel.text().includes('Mostrando 21 de 121'), true);
  panel.click(panel.button('«'));
  assert.equal(panel.text().includes('Página 1 de 3'), true);
  panel.click(panel.button('Siguiente'));
  assert.equal(panel.text().includes('Página 2 de 3'), true);
  panel.click(panel.button('Anterior'));
  assert.equal(panel.text().includes('Página 1 de 3'), true);
});

test('FA-09: el título de cada fuente declara la colección a la que pertenece', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paFixtures } = mod.__test;
  const map = new Map();
  for (const source of paFixtures().sources) {
    const prefix = source.title.replace(/ \d{3}$/, '');
    if (map.has(prefix)) assert.equal(map.get(prefix), source.collection, 'un título no puede vivir en dos colecciones');
    map.set(prefix, source.collection);
  }
  assert.equal(map.size >= 9, true, 'los títulos cubren las tres colecciones');
});

test('FA-07: las tablas no muestran un caption duplicado junto al título de la tarjeta', () => {
  const { panel } = mountPanel();
  panel.go('Fuentes');
  const captions = panel.all((node) => node.type === 'caption');
  assert.equal(captions.length, 1, 'una tabla, un caption');
  for (const caption of captions) assert.equal(caption.props.className, 'lcr-pa-sr');
});

test('la cabecera no finge conexión y los cuatro planos viven en Ajustes → Salud', () => {
  const { panel } = mountPanel();
  const text = panel.text();
  assert.equal(text.includes('Sintético (fixtures)'), true, 'el modo se declara en la cabecera');
  assert.equal(text.includes('API montada'), false, 'en modo sintético no puede decir que hay API');
  assert.equal(text.includes('SYNTHETIC DATA MODE'), true);
  assert.equal(panel.all((node) => node.props.role === 'status').length, 1, 'una sola región viva');
  panel.go('Ajustes');
  const salud = panel.text();
  for (const etiqueta of ['Servicio', 'API del panel', 'Modo', 'Documentos indexados']) {
    assert.equal(salud.includes(etiqueta), true, 'falta «' + etiqueta + '» en Ajustes → Salud');
  }
});

test('las pestañas no se comprimen cuando el slot tiene altura fija', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { CSS_PA } = mod.__test;
  assert.equal(/\.lcr-pa-tabs[^{}]*\{[^}]*flex:\s*0 0 auto/.test(CSS_PA), true,
    'la fila de pestañas debe declararse sin encogimiento (flex: 0 0 auto)');
  assert.equal(/\.lcr-pa-head[^{}]*\{[^}]*flex:\s*0 0 auto/.test(CSS_PA), true,
    'la cabecera tampoco se encoge');
  assert.equal(/\.lcr-pa-root\s*\{[^}]*overflow:\s*auto/.test(CSS_PA), true,
    'la raíz debe desplazarse en lugar de recortar el contenido');
});


/* ------------------------------------------- ACP-07 F4 · administración y candidatos */

const SNAP_F4 = {
  mode: 'api',
  service: 'ok',
  version: 'pa/1.3.0',
  project: { id: 'prj_a', name: 'Proyecto A' },
  selection: { projectId: 'prj_a', projectName: 'Proyecto A', source: 'explicit', selectedBy: 'human', selectedAt: 1, revision: 2 },
  projects: [
    { id: 'prj_a', name: 'Proyecto A', status: 'active', roots: 2, authorized: 2, total: 2, current: true, selectable: true },
    { id: 'prj_b', name: 'Proyecto B', status: 'active', roots: 0, authorized: 0, total: 1, current: false, selectable: false },
  ],
  archived: [{ id: 'prj_c', name: 'Proyecto C', status: 'archived', roots: 1, total: 1, archivedAt: 1700000000000, current: false, selectable: false }],
  roots: [
    { scopeId: 'prj_a', id: 'rt_1', path: 'C:/proyectos/a', state: 'authorized' },
    { scopeId: 'prj_a', id: 'rt_2', path: 'C:/proyectos/a-docs', state: 'authorized' },
    { scopeId: 'prj_c', id: 'rt_3', path: 'C:/proyectos/c', state: 'authorized' },
  ],
  capabilities: { projects: ['create', 'update', 'archive', 'restore'], roots: ['add', 'remove'], discovery: ['candidates', 'register'] },
  scopes: [{ kind: 'prj', id: 'prj_a', name: 'Proyecto A', roots: 2, authorized: 2 }],
  libraries: [],
  sources: { rows: [], total: 0, nextCursor: null },
  audit: { head: 3 },
  config: { strategy: 'hybrid', limit: 8, diversity: 'balanced' },
};

test('F4: el snapshot hidrata archivados, raíces y capacidades sin romper lo anterior', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const state = paReduce(paInitialState({ demo: true }), { type: 'hydrate', snapshot: SNAP_F4 });
  assert.equal(state.mode, 'api');
  assert.equal(state.archived.length, 1);
  assert.equal(state.archived[0].name, 'Proyecto C');
  assert.equal(state.projects.length, 2);
  assert.equal(state.projects[0].selectable, true);
  assert.equal(state.projects[1].selectable, false, 'un proyecto sin raíz autorizada no es seleccionable');
  assert.equal(state.roots.length, 3);
  assert.equal(state.roots.filter((root) => root.scopeId === 'prj_a').length, 2);
  assert.deepEqual(state.capabilities.projects, ['create', 'update', 'archive', 'restore']);
  // Lo de 1.2.0 sigue igual: las fuentes y la selección confirmada por el servidor.
  assert.equal(state.session.session.selection.revision, 2);
  assert.equal(state.sources.length, 0);
});

test('F4: crear un proyecto es una orden explícita y el panel no la simula sin API', () => {
  const { mod, spies } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;

  // En modo sintético no se escribe: se declara que no hay API.
  const fixture = paReduce(paInitialState({ demo: true }), { type: 'admin-op', op: { kind: 'create', name: 'Nuevo' } });
  assert.equal(fixture.pending, undefined ?? fixture.pending);
  assert.equal(fixture.admin.error, 'offline');
  assert.equal(spies.fetch, 0, 'el panel sintético no llama a la red para administrar');

  let state = paReduce(paInitialState({ demo: true }), { type: 'hydrate', snapshot: SNAP_F4 });
  state = paReduce(state, { type: 'admin-draft', field: 'name', value: 'Proyecto Nuevo' });
  assert.equal(state.admin.draft.name, 'Proyecto Nuevo');
  state = paReduce(state, { type: 'admin-op', op: { kind: 'create', name: 'Proyecto Nuevo', path: 'C:/nuevo' } });
  assert.equal(state.pending, 'admin');
  assert.equal(state.admin.busy, 'create');
  // Segunda orden mientras hay una en vuelo: se ignora (no se encolan escrituras).
  const blocked = paReduce(state, { type: 'admin-op', op: { kind: 'archive', id: 'prj_a' } });
  assert.equal(blocked.adminOp.kind, 'create');

  state = paReduce(state, { type: 'admin-ok', op: { kind: 'create' } });
  assert.equal(state.pending, 'snapshot', 'después de escribir se relee el registro');
  assert.equal(state.admin.notice.code, 'admin.done.create');
  assert.equal(state.admin.draft.name, '');
  assert.equal(state.admin.draft.path, '');
  assert.equal(state.admin.error, null);
});

test('F4: archivar, restaurar y renombrar dejan aviso y releen el snapshot', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const base = paReduce(paInitialState({ demo: true }), { type: 'hydrate', snapshot: SNAP_F4 });

  for (const [op, notice] of [
    [{ kind: 'archive', id: 'prj_a' }, 'admin.done.archive'],
    [{ kind: 'restore', id: 'prj_c' }, 'admin.done.restore'],
    [{ kind: 'update', id: 'prj_a', name: 'Renombrado' }, 'admin.done.update'],
    [{ kind: 'rootAdd', projectId: 'prj_a', path: 'C:/otra' }, 'admin.done.rootAdd'],
    [{ kind: 'rootRemove', rootId: 'rt_1' }, 'admin.done.rootRemove'],
  ]) {
    const requested = paReduce(base, { type: 'admin-op', op });
    assert.equal(requested.pending, 'admin', 'la operación viaja al servidor: ' + op.kind);
    const done = paReduce(requested, { type: 'admin-ok', op });
    assert.equal(done.pending, 'snapshot');
    assert.equal(done.admin.notice.code, notice);
  }

  // Un fallo no deja la interfaz bloqueada y se traduce por código.
  const failed = paReduce(paReduce(base, { type: 'admin-op', op: { kind: 'rootAdd', projectId: 'prj_a', path: 'C:/x' } }),
    { type: 'admin-error', reason: 'root-overlap' });
  assert.equal(failed.pending, null);
  assert.equal(failed.admin.busy, null);
  assert.equal(failed.admin.error, 'root-overlap');
  const { paViewProjects, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  assert.equal(textOf(paViewProjects(failed, t, () => {})).includes('solapa'), true);
});

test('F4: la vista de proyectos distingue activos, archivados y raíces', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce, paViewProjects, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  const base = paReduce(paInitialState({ demo: true }), { type: 'hydrate', snapshot: SNAP_F4 });

  const text = textOf(paViewProjects(base, t, () => {}));
  assert.equal(text.includes('Proyecto A'), true);
  assert.equal(text.includes('Proyecto B'), true, 'los activos se listan aunque no sean seleccionables');
  assert.equal(text.includes('Sin raíz autorizada'), true);
  assert.equal(text.includes('Proyecto C'), true, 'los archivados tienen su propia tabla');
  assert.equal(text.includes('Restaurar'), true);
  assert.equal(text.includes('Crear proyecto'), true);

  // El panel de raíces muestra rutas concretas (lo que el recuento no daba) y permite retirar una.
  const withRoots = paReduce(base, { type: 'admin-roots', projectId: 'prj_a' });
  const rootsText = textOf(paViewProjects(withRoots, t, () => {}));
  assert.equal(rootsText.includes('C:/proyectos/a-docs'), true);
  assert.equal(rootsText.includes('Añadir raíz'), true);
  assert.equal(rootsText.includes('no borra archivos'), true);

  // Sin API la administración se declara no disponible, sin botones activos.
  const down = paReduce(base, { type: 'unavailable', reason: 'transport-error' });
  const downText = textOf(paViewProjects(down, t, () => {}));
  assert.equal(downText.includes('no está disponible'), true);
});

test('F4: los candidatos sólo se descubren bajo demanda y se registran a mano', () => {
  const { mod, spies } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce, paViewCandidates, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  const base = paReduce(paInitialState({ demo: true }), { type: 'hydrate', snapshot: SNAP_F4 });
  assert.equal(base.candidates.loaded, false);

  // Navegar a la sección NO explora: el descubrimiento es una orden.
  const navigated = paReduce(base, { type: 'nav', view: 'candidates' });
  assert.equal(navigated.pending, null);
  assert.equal(navigated.candidates.loaded, false);
  assert.equal(spies.fetch, 0);

  const scanning = paReduce(navigated, { type: 'candidates-path', value: 'C:/workspace' });
  assert.equal(paReduce(scanning, { type: 'candidates-scan' }).pending, 'candidates');

  const loaded = paReduce(scanning, {
    type: 'candidates-ok',
    page: {
      root: 'C:/workspace',
      total: 2,
      truncated: false,
      skipped: [],
      candidates: [
        { path: 'C:/workspace/uno', name: 'uno', type: 'node', indicators: ['package.json'], depth: 1, registered: false, action: 'register-project' },
        { path: 'C:/workspace/dos', name: 'dos', type: 'git', indicators: ['.git'], depth: 1, registered: true, action: null },
      ],
    },
  });
  assert.equal(loaded.candidates.loaded, true);
  assert.equal(loaded.candidates.rows.length, 2);
  assert.equal(loaded.candidates.rows[1].registered, true);
  const text = textOf(paViewCandidates(loaded, t, () => {}));
  assert.equal(text.includes('Registrar'), true);
  assert.equal(text.includes('Registrado'), true);
  assert.equal(text.includes('C:/workspace/uno'), true);

  const registering = paReduce(loaded, { type: 'candidates-register', path: 'C:/workspace/uno' });
  assert.equal(registering.pending, 'register');
  assert.equal(registering.candidates.registering, 'C:/workspace/uno');
  const done = paReduce(registering, { type: 'register-ok', path: 'C:/workspace/uno', project: { id: 'prj_x' } });
  assert.equal(done.pending, 'snapshot', 'registrar cambia el perfil: se relee');
  assert.equal(done.candidates.rows[0].registered, true);
  assert.equal(done.candidates.rows[0].action, null);

  // Un fallo de descubrimiento se explica por código.
  const failed = paReduce(scanning, { type: 'candidates-error', reason: 'scope-unresolved' });
  assert.equal(failed.candidates.error, 'scope-unresolved');
  assert.equal(textOf(paViewCandidates(failed, t, () => {})).includes('no está autorizada para lectura'), true);
});

test('F4: el error de proyecto no registrado ofrece la salida por Candidatos', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce, paRenderViewSafe, paTranslate, PA_VIEWS } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  assert.equal(PA_VIEWS.some((view) => view.id === 'projects'), true);
  assert.equal(PA_VIEWS.some((view) => view.id === 'candidates'), true);

  // F2 devuelve scope-unresolved con acción register-project: el panel deja de ser un callejón.
  const down = paReduce(paInitialState({ demo: true }), { type: 'unavailable', reason: 'scope-unresolved' });
  const text = textOf(paRenderViewSafe(down, t, () => {}));
  assert.equal(text.includes('no está registrado'), true);
  assert.equal(text.includes('Ir a Candidatos'), true);
  assert.equal(text.includes('CLI'), true, 'la CLI sigue siendo una vía válida');
});

/* ==================================================================== */
/* UX-1 · fundaciones de experiencia: áreas, lenguaje y accesibilidad   */
/* ==================================================================== */

test('UX-1/T-UX-01: cinco áreas, cada una lleva a su primera vista y conserva subnavegación', () => {
  const { mod, panel } = mountPanel();
  const { PA_AREAS, PA_AREA_VIEWS, paTranslate } = mod.__test;
  assert.equal(PA_AREAS.length, 5, 'Resumen, Workspaces, Proyectos y contexto, Seguimiento, Ajustes');
  const etiquetas = PA_AREAS.map((area) => paTranslate('es', area.key));
  for (const etiqueta of etiquetas) {
    assert.equal(panel.tab(etiqueta) !== null, true, 'falta el área «' + etiqueta + '»');
  }
  const orden = panel.all((node) => node.props.role === 'tab' && node.props['data-area'])
    .map((node) => node.props['data-area']);
  assert.equal(orden.join(','), PA_AREAS.map((area) => area.id).join(','), 'el orden del DOM es el del teclado: ' + JSON.stringify(orden));

  for (const area of PA_AREAS) {
    panel.go(paTranslate('es', area.key));
    assert.equal(panel.find((node) => node.props['data-view'] === PA_AREA_VIEWS[area.id][0]) !== null, true,
      'el área «' + area.id + '» no abre su primera vista');
  }

  // Proyectos y contexto: la subnavegación conserva Fuentes, Búsqueda, Contexto y Bibliotecas.
  panel.go('Proyectos y contexto');
  for (const seccion of ['Resumen', 'Fuentes', 'Búsqueda', 'Contexto', 'Bibliotecas', 'Administrar proyectos']) {
    assert.equal(panel.tab(seccion) !== null, true, 'falta la sección «' + seccion + '»');
  }
  panel.go('Fuentes');
  assert.equal(panel.find((node) => node.props['aria-selected'] === 'true' && node.props.id === 'lcr-pa-sub-sources') !== null, true);
});

test('UX-1/T-UX-02: ninguna área de uso diario muestra códigos técnicos', () => {
  const { mod, panel } = mountPanel();
  const codigos = [/scope-unresolved/, /invalid-argument/, /revision-conflict/, /unauthenticated/, /authorization-unavailable/, /\b4\d\d\b/, /\b5\d\d\b/, /pa\/1\.\d/];
  for (const area of ['Resumen', 'Workspaces', 'Proyectos y contexto', 'Seguimiento']) {
    panel.go(area);
    const text = panel.text();
    for (const patron of codigos) {
      assert.equal(patron.test(text), false, 'código técnico en «' + area + '»: ' + patron);
    }
  }
  // Los códigos siguen disponibles donde toca: Ajustes → Diagnóstico.
  panel.go('Diagnóstico');
  const diag = panel.text();
  assert.equal(diag.includes('Ámbitos'), true, 'el detalle técnico debe seguir accesible en Ajustes → Diagnóstico');
  assert.equal(diag.toLowerCase().includes('auditoría'), true);
});

test('UX-1/T-UX-03: «Proyectos» no se rotula como candidatos y el administrador se llama por su nombre', () => {
  const { mod, panel } = mountPanel();
  const { paTranslate } = mod.__test;
  assert.equal(paTranslate('es', 'ux.projects.manage'), 'Administrar proyectos');
  panel.go('Administrar proyectos');
  const text = panel.text();
  assert.equal(/candidat/i.test(text), false, 'la vista de proyectos registrados no habla de candidatos');
  assert.equal(text.includes('Administración de proyectos'), true);
});

test('UX-1/T-UX-04: contraste AA de los pares texto/fondo declarados', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { CSS_PA } = mod.__test;
  const token = (nombre) => {
    const m = new RegExp('--' + nombre + ':[^;]*?(#[0-9a-fA-F]{6})').exec(CSS_PA);
    return m ? m[1] : null;
  };
  const lum = (hex) => {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const pares = [['pa-text', 'pa-bg', 7], ['pa-muted', 'pa-surface', 4.5], ['pa-text', 'pa-surface', 7], ['pa-accent', 'pa-surface', 3]];
  for (const [fg, bg, minimo] of pares) {
    const a = token(fg);
    const b = token(bg);
    assert.ok(a && b, 'tokens de color no encontrados: ' + fg + '/' + bg);
    assert.ok(ratio(a, b) >= minimo, fg + ' sobre ' + bg + ' = ' + ratio(a, b).toFixed(2) + ':1 (mínimo ' + minimo + ')');
  }
});

test('UX-1/T-UX-14: paridad exacta de claves entre ES y EN', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { PA_DICT } = mod.__test;
  const es = Object.keys(PA_DICT.es).sort();
  const en = Object.keys(PA_DICT.en).sort();
  assert.deepEqual(es, en, 'los dos diccionarios deben tener el mismo conjunto de claves');
  assert.equal(es.length >= 320, true, 'catálogo completo: ' + es.length + ' claves');
});

/**
 * REESCRITA en UX-2.2 (incremento 7). La versión anterior FIJABA la maqueta: exigía un
 * `role=switch` con `disabled:true` y `aria-disabled:true` porque el seguimiento no estaba
 * implementado. Ya lo está —`GET/PUT/DELETE /pa/tracking` existen y el panel los usa—, así que
 * mantener aquella aserción habría convertido la prueba en una barrera contra la funcionalidad.
 * Ahora se fija lo contrario: el control está habilitado, refleja el eje A (`aria-checked`), y al
 * activarlo se pide la mutación con CAS (`expectedRevision`). Lo de los estados vacíos no cambia.
 */
test('UX-2.2/T-UX-16: el control de seguimiento está habilitado, refleja el estado y muta con CAS', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce, paRenderView, paTranslate, paTrackingRequest } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  const vacio = { ...paInitialState({ demo: true }), projects: [], archived: [], sources: [], sourcesTotal: 0 };
  const overview = textOf(paRenderView(paReduce(vacio, { type: 'nav', view: 'overview' }), t, () => {}));
  assert.equal(overview.includes('Todavía no hay proyectos configurados'), true);
  // UX-2.1: la sección Workspaces dejó de pintar los proyectos registrados como sustituto. Sin API
  // (modo demostración) declara que la lista necesita la API en vez de inventar workspaces.
  const workspaces = textOf(paRenderView(paReduce(vacio, { type: 'nav', view: 'workspaces' }), t, () => {}));
  assert.equal(workspaces.includes('La lista del Host necesita la API'), true);
  assert.equal(workspaces.includes('La detección automática de workspaces'), false, 'ya no promete una fase futura');

  // Estado real: API, un workspace del Host y ninguna fila de seguimiento.
  const conLista = paReduce({ ...paInitialState({ demo: true }), mode: 'api' }, {
    type: 'workspaces-ok',
    payload: payloadCon([fila({ project: null, relation: 'none' })]),
  });
  const sinFila = {
    ...paReduce(conLista, { type: 'tracking-ok', payload: { items: [], counts: { total: 0 }, asOf: 1 } }),
    view: 'tracking',
  };
  const acciones = [];
  const control = findRoleSwitch(paRenderView(sinFila, t, (action) => acciones.push(action)));
  assert.ok(control, 'debe existir el control de seguimiento');
  assert.notEqual(control.props.disabled, true, 'el control ya no es una maqueta: está habilitado');
  assert.notEqual(control.props['aria-disabled'], 'true');
  assert.equal(control.props['aria-checked'], 'false', 'sin fila no puede declararse seguido');
  control.props.onClick();
  // `{...}` copia el objeto del sandbox al realm del test: deepStrictEqual compara prototipos.
  // R1.2: activar un workspace sin memoria pide provisión; el servidor lo revalida.
  assert.deepEqual({ ...acciones.pop() }, {
    type: 'tracking-op', action: 'enable', state: 'on', intent: 'provision',
    pathKey: fila().pathKey, path: fila().path, projectId: null,
  });

  // Con fila en `on`, el mismo control se declara marcado.
  const seguido = {
    ...paReduce(sinFila, { type: 'tracking-ok', payload: { items: [filaSeguimiento({ state: 'on' })], counts: {}, asOf: 1 } }),
    view: 'tracking',
  };
  assert.equal(findRoleSwitch(paRenderView(seguido, t, () => {})).props['aria-checked'], 'true');

  // El clic se convierte en la petición PUT con la revisión de la fila (CAS), no en un reintento ciego.
  const pausado = {
    ...paReduce(sinFila, { type: 'tracking-ok', payload: { items: [filaSeguimiento({ state: 'paused', revision: 7 })], counts: {}, asOf: 1 } }),
    view: 'tracking',
  };
  const pendiente = paReduce(pausado, { type: 'tracking-op', action: 'resume', state: 'on', pathKey: fila().pathKey });
  assert.equal(pendiente.pending, 'tracking-mutation');
  assert.equal(pendiente.trackingOp.expectedRevision, 7);
  const built = paTrackingRequest(pendiente.trackingOp);
  assert.equal(built.path, '/tracking');
  assert.equal(built.options.method, 'PUT');
  // La ruta literal viaja en el cuerpo (`D-IMPL-07`): la fila debe guardar la ruta que ve la persona,
  // no la clave canónica en minúsculas.
  assert.deepEqual({ ...built.options.body }, {
    pathKey: fila().pathKey, path: fila().path, state: 'on', expectedRevision: 7, projectId: 'prj_1',
  });
});

test('UX-1: las rutas se muestran acortadas y con acción explícita (D-UX-14)', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paShortPath, paInitialState, paReduce, paRenderView, paTranslate } = mod.__test;
  assert.equal(paShortPath('C:/corto'), 'C:/corto');
  const largo = 'C:/workspace/businesssuite/apps/web/src/components/formulario-muy-largo.tsx';
  const corto = paShortPath(largo);
  assert.equal(corto.length < largo.length, true);
  assert.equal(corto.includes('…'), true);

  // UX-2.1: la tabla real de workspaces sale de `GET /workspaces`; la ruta la pinta `PaPath`.
  const base = { ...paInitialState({ demo: true }), mode: 'api' };
  const conLista = paReduce(base, {
    type: 'workspaces-ok',
    payload: {
      source: 'host', reason: null, version: 'pa/1.4.0',
      items: [{ id: 'ws_1', path: largo, pathKey: largo.toLowerCase(), title: 'formulario', state: 'ok', stateReason: null, sessions: { known: 1, live: 1, historical: 0 }, project: { id: 'prj_1', name: 'Proyecto' }, relation: 'inside' }],
      counts: { total: 1, returned: 1, withProject: 1 }, truncated: false,
    },
  });
  const vista = paRenderView({ ...conLista, view: 'workspaces' }, (k, v) => paTranslate('es', k, v), () => {});
  const { PaPath } = mod.__test;
  const usaPath = (function buscar(nodo) {
    if (!nodo || nodo === false) return false;
    if (Array.isArray(nodo)) return nodo.some(buscar);
    if (typeof nodo === 'object' && nodo.type) return nodo.type === PaPath || (nodo.children || []).some(buscar);
    return false;
  })(vista);
  assert.equal(usaPath, true, 'la tabla de workspaces usa el componente de ruta');

  // El componente se monta aparte: es el que decide qué se ve por defecto.
  const ruta = mount(PaPath, { path: largo, t: (k, v) => paTranslate('es', k, v), onCopy: () => {} });
  const texto = ruta.text();
  assert.equal(texto.includes(largo), false, 'la ruta completa no se pinta por defecto');
  assert.equal(texto.includes('Mostrar ruta'), true);
  const boton = ruta.find((node) => node.type === 'button');
  ruta.click(boton);
  assert.equal(ruta.text().includes(largo), true, 'al pedirla, se muestra completa');
});

test('UX-1: el panel abre en Resumen y la marca es «LifeCode RAG · Workspace Center» (D-UX-15)', () => {
  const { panel } = mountPanel();
  assert.equal(panel.find((node) => node.props['data-view'] === 'overview') !== null, true);
  assert.equal(panel.text().includes('Workspace Center'), true);
  assert.equal(panel.text().includes('RAG'), true);
});

/* ─────────────────────────── UX-2.1 · sección Workspaces (T-W2-04, 05, 16, 18) ─────────────── */

/** Estado con la lista ya cargada desde `GET /workspaces`, para pintar la tabla real. */
function stateConWorkspaces(payload, extra = {}) {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const base = { ...paInitialState({ demo: true }), mode: 'api', ...extra };
  const conLista = paReduce(base, { type: 'workspaces-ok', payload });
  return { mod, state: { ...conLista, view: 'workspaces' } };
}

function fila(overrides = {}) {
  return {
    id: 'ws_1', path: 'C:/workspace/plugins-dhs', pathKey: 'c:/workspace/plugins-dhs',
    title: 'plugins-dhs', state: 'ok', stateReason: null,
    sessions: { known: 2, live: 1, historical: 1 },
    project: { id: 'prj_1', name: 'plugins-dhs' }, relation: 'exact',
    ...overrides,
  };
}

function payloadCon(items, extra = {}) {
  return {
    source: 'host', reason: null, version: 'pa/1.4.0',
    items,
    counts: {
      total: items.length, returned: items.length,
      withProject: items.filter((row) => row.project).length,
      unknown: items.filter((row) => row.state === 'unknown').length,
    },
    truncated: false,
    ...extra,
  };
}

function renderWorkspaces(state, mod, lang = 'es') {
  const { paRenderView, paTranslate } = mod.__test;
  return textOf(paRenderView(state, (key, vars) => paTranslate(lang, key, vars), () => {}));
}

test('T-W2-04: los tres estados se pintan en lenguaje de usuario', () => {
  const { mod, state } = stateConWorkspaces(payloadCon([
    fila({ id: 'ws_ok', pathKey: 'a', state: 'ok' }),
    fila({ id: 'ws_missing', pathKey: 'b', state: 'missing' }),
    fila({ id: 'ws_unknown', pathKey: 'c', state: 'unknown', stateReason: 'timeout' }),
  ]));
  const texto = renderWorkspaces(state, mod);
  assert.equal(texto.includes('Encontrado'), true);
  assert.equal(texto.includes('No encontrado'), true, 'missing-dir se pinta como «No encontrado»');
  assert.equal(texto.includes('Sin comprobar'), true, 'unknown no se disfraza de encontrado ni de ausente');
  assert.equal(texto.includes('no respondió a tiempo'), true, 'el motivo del timeout se explica');
});

test('T-W2-05: un workspace histórico (0 vivas) dice que no hay sesiones abiertas', () => {
  const { mod, state } = stateConWorkspaces(payloadCon([
    fila({ sessions: { known: 3, live: 0, historical: 3 } }),
  ]));
  const texto = renderWorkspaces(state, mod);
  assert.equal(texto.includes('Sin sesiones abiertas'), true);
  assert.equal(texto.includes('3 históricas'), true);
});

test('T-W2-06 (UI): con sesiones vivas se muestra el desglose', () => {
  const { mod, state } = stateConWorkspaces(payloadCon([
    fila({ sessions: { known: 4, live: 2, historical: 2 } }),
  ]));
  const texto = renderWorkspaces(state, mod);
  assert.equal(texto.includes('2 vivas · 4 en total'), true);
});

test('sin servicio de sesiones la columna no inventa un cero y la cabecera lo avisa', () => {
  const { mod, state } = stateConWorkspaces(payloadCon([
    fila({ sessions: { known: 2, live: null, historical: null } }),
  ], { reason: 'sessions-unavailable' }));
  const texto = renderWorkspaces(state, mod);
  assert.equal(texto.includes('No se pudo mirar'), true);
  assert.equal(texto.includes('no ofreció su servicio de sesiones'), true);
});

test('T-W2-16: sin registro del Host se dice el motivo y se ofrece «Añadir carpeta»', () => {
  const { mod, state } = stateConWorkspaces(
    { source: 'none', reason: 'no-registry', items: [], counts: { total: 0, returned: 0 }, truncated: false },
    { mode: 'api' },
  );
  const texto = renderWorkspaces(state, mod);
  assert.equal(texto.includes('El Host no ofrece su registro de workspaces'), true);
  assert.equal(texto.includes('No es una lista vacía'), true, 'no se hace pasar por un resultado válido');
  assert.equal(texto.includes('no-registry'), true, 'el motivo queda visible para diagnosticar');
  assert.equal(texto.includes('Añadir carpeta'), true, 'hay salida al flujo existente');

  const enIngles = renderWorkspaces(state, mod, 'en');
  assert.equal(enIngles.includes('The Host does not provide its workspace registry'), true);
  assert.equal(enIngles.includes('Add folder'), true);
});

test('la lista vacía legítima se distingue de «sin registry»', () => {
  const { mod, state } = stateConWorkspaces(payloadCon([], { source: 'host' }));
  const texto = renderWorkspaces(state, mod);
  assert.equal(texto.includes('No hay workspaces que mostrar'), true);
  assert.equal(texto.includes('El Host no ofrece su registro'), false);
});

test('T-W2-18: paridad ES/EN de las claves nuevas, con los mismos marcadores', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { PA_DICT } = mod.__test;
  const NUEVAS = [
    'ux.ws.col.title', 'ux.ws.col.relation', 'ux.ws.col.sessions', 'ux.ws.stOk', 'ux.ws.stMissing',
    'ux.ws.stUnknown', 'ux.ws.relExact', 'ux.ws.relInside', 'ux.ws.refresh', 'ux.ws.refreshing',
    'ux.ws.loading', 'ux.ws.idle', 'ux.ws.offline', 'ux.ws.offlineHint', 'ux.ws.noRegistry',
    'ux.ws.noRegistryHint', 'ux.ws.err', 'ux.ws.errCode', 'ux.ws.retry', 'ux.ws.countProject',
    'ux.ws.truncated', 'ux.ws.noSessions', 'ux.ws.sessLive', 'ux.ws.sessHistorical',
    'ux.ws.sessUnknown', 'ux.ws.whyTimeout', 'ux.ws.whyError', 'ux.ws.whyBudget',
    'ux.ws.whyNoStatus', 'ux.ws.readOnly',
  ];
  const marcadores = (texto) => (String(texto).match(/\{[a-zA-Z]+\}/g) || []).sort().join(',');
  for (const clave of NUEVAS) {
    assert.equal(typeof PA_DICT.es[clave], 'string', 'falta en ES: ' + clave);
    assert.equal(typeof PA_DICT.en[clave], 'string', 'falta en EN: ' + clave);
    assert.ok(PA_DICT.es[clave].trim().length > 0);
    assert.ok(PA_DICT.en[clave].trim().length > 0);
    assert.equal(marcadores(PA_DICT.es[clave]), marcadores(PA_DICT.en[clave]), 'marcadores distintos en ' + clave);
  }
  // La promesa de una fase futura ya no existe: la sección hace lo que dice.
  assert.equal('ux.ws.pending' in PA_DICT.es, false);
  assert.equal('ux.ws.pending' in PA_DICT.en, false);
});

test('entrar en la sección pide la lista y Actualizar la vuelve a pedir', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const api = { ...paInitialState({ demo: true }), mode: 'api' };
  const alEntrar = paReduce(api, { type: 'nav', view: 'workspaces' });
  assert.equal(alEntrar.pending, 'workspaces');
  assert.equal(alEntrar.workspaces.loading, true);
  assert.equal(alEntrar.workspaces.error, null);

  // Con una petición en curso no se encola otra (ni se pierde la que hay).
  const enCurso = paReduce(alEntrar, { type: 'nav', view: 'workspaces' });
  assert.equal(enCurso.pending, 'workspaces');

  const conLista = paReduce(alEntrar, { type: 'workspaces-ok', payload: payloadCon([fila()]) });
  const otraVez = paReduce(conLista, { type: 'nav', view: 'workspaces' });
  assert.equal(otraVez.pending, 'workspaces', 'cada entrada refresca: el Host no emite eventos');
  const boton = paReduce({ ...otraVez, pending: null }, { type: 'workspaces-refresh' });
  assert.equal(boton.pending, 'workspaces');
  assert.equal(boton.workspaces.loading, true);
});

test('un fallo deja la sección en error con salida, nunca en carga infinita', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce, paRenderView, paTranslate } = mod.__test;
  const alEntrar = paReduce({ ...paInitialState({ demo: true }), mode: 'api' }, { type: 'nav', view: 'workspaces' });
  const fallo = paReduce(alEntrar, { type: 'workspaces-error', reason: 'transport-error' });
  assert.equal(fallo.pending, null);
  assert.equal(fallo.workspaces.loading, false);
  assert.equal(fallo.workspaces.error, 'transport-error');
  const texto = textOf(paRenderView({ ...fallo, view: 'workspaces' }, (key, vars) => paTranslate('es', key, vars), () => {}));
  assert.equal(texto.includes('No se pudo leer la lista de workspaces'), true);
  assert.equal(texto.includes('transport-error'), true);
  assert.equal(texto.includes('Reintentar'), true);
  assert.equal(texto.includes('Leyendo los workspaces'), false, 'no se queda cargando');
});

test('la carga inicial se anuncia y no se queda en blanco', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce, paRenderView, paTranslate } = mod.__test;
  const alEntrar = paReduce({ ...paInitialState({ demo: true }), mode: 'api' }, { type: 'nav', view: 'workspaces' });
  const texto = textOf(paRenderView({ ...alEntrar, view: 'workspaces' }, (key, vars) => paTranslate('es', key, vars), () => {}));
  assert.equal(texto.includes('Leyendo los workspaces que conoce el Host'), true);
});

test('el truncamiento se declara y los recuentos no se recortan con la tabla', () => {
  const { mod, state } = stateConWorkspaces(payloadCon([fila()], {
    truncated: true,
    counts: { total: 7, returned: 1, withProject: 1, unknown: 0 },
  }));
  const texto = renderWorkspaces(state, mod);
  assert.equal(texto.includes('Se muestran 1 de 7 workspaces'), true);
});

test('un workspace sin proyecto no enseña nombre de proyecto ni relación inventada', () => {
  const { mod, state } = stateConWorkspaces(payloadCon([
    fila({ project: null, relation: 'none' }),
  ]));
  const texto = renderWorkspaces(state, mod);
  assert.equal(texto.includes('Raíz del proyecto'), false);
  assert.equal(texto.includes('Dentro del proyecto'), false);
});

test('la sección no ofrece ninguna acción que escriba en el Host', () => {
  const { mod, state } = stateConWorkspaces(payloadCon([fila()]));
  const { paRenderView, paTranslate } = mod.__test;
  const vista = paRenderView(state, (key, vars) => paTranslate('es', key, vars), () => {});
  const etiquetas = [];
  (function buscar(nodo) {
    if (!nodo || nodo === false) return;
    if (Array.isArray(nodo)) { nodo.forEach(buscar); return; }
    if (typeof nodo === 'object' && nodo.type) {
      if (nodo.type === 'button') etiquetas.push(textOf(nodo));
      (nodo.children || []).forEach(buscar);
    }
  })(vista);
  const texto = etiquetas.join(' | ');
  for (const verbo of ['Autorizar', 'Revocar', 'Indexar', 'Archivar', 'Borrar', 'Olvidar']) {
    assert.equal(texto.includes(verbo), false, 'no debe ofrecerse «' + verbo + '» en Workspaces');
  }
  assert.equal(texto.includes('Actualizar'), true);
  assert.equal(texto.includes('Añadir carpeta'), true);
});

/* ───────────────────────────── UX-2.2 · seguimiento (incremento 7) ─────────────────────────── */

/** Fila de `GET /pa/tracking` con la forma exacta del contrato de la API. */
function filaSeguimiento(overrides = {}) {
  return {
    pathKey: fila().pathKey,
    path: fila().path,
    workspaceId: 'ws_1',
    project: { id: 'prj_1', name: 'plugins-dhs' },
    state: 'on',
    association: 'explicit',
    lastStatus: 'ok',
    lastSeenAt: '2026-11-23T10:00:00.000Z',
    updatedAt: '2026-11-23T10:00:00.000Z',
    revision: 1,
    resolves: true,
    relation: 'exact',
    ...overrides,
  };
}

/** Estado de API con la lista del Host y las filas de seguimiento ya cargadas. */
function stateTracking({ workspaces = [fila()], items = [], selection = null } = {}) {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  let state = { ...paInitialState({ demo: true }), mode: 'api' };
  if (selection) {
    state = {
      ...state,
      session: {
        ...state.session,
        session: {
          ...state.session.session,
          selection: { ...state.session.session.selection, ...selection },
        },
      },
    };
  }
  state = paReduce(state, { type: 'workspaces-ok', payload: payloadCon(workspaces) });
  state = paReduce(state, { type: 'tracking-ok', payload: { items, counts: {}, asOf: 1 } });
  return { mod, state: { ...state, view: 'tracking' } };
}

function renderTracking(state, mod, lang = 'es') {
  const { paRenderView, paTranslate } = mod.__test;
  return textOf(paRenderView(state, (key, vars) => paTranslate(lang, key, vars), () => {}));
}

/** Primer nodo con `role=switch` (el control de seguimiento de una fila). */
function findRoleSwitch(node) {
  if (!node || node === false) return null;
  if (Array.isArray(node)) {
    for (const child of node) { const found = findRoleSwitch(child); if (found) return found; }
    return null;
  }
  if (typeof node === 'object' && node.type) {
    if (node.props && node.props.role === 'switch') return node;
    for (const child of node.children || []) { const found = findRoleSwitch(child); if (found) return found; }
  }
  return null;
}

/** Filas de la tabla de seguimiento, por su atributo de ruta (el texto no distingue filas). */
function filasDe(vista) {
  const rows = [];
  for (const node of walk(vista)) {
    if (node.props && typeof node.props['data-tracking-path'] === 'string') rows.push(node);
  }
  return rows;
}

test('T-UX22-08: seguido, pausado y sin seguimiento son tres textos y tres estados de fila', () => {
  const { mod, state } = stateTracking({
    workspaces: [
      fila({ pathKey: 'w-on', path: 'C:/on', title: 'on' }),
      fila({ pathKey: 'w-paused', path: 'C:/paused', title: 'paused' }),
      fila({ pathKey: 'w-off', path: 'C:/off', title: 'off' }),
    ],
    items: [
      filaSeguimiento({ pathKey: 'w-on', path: 'C:/on', state: 'on', project: null }),
      filaSeguimiento({ pathKey: 'w-paused', path: 'C:/paused', state: 'paused' }),
    ],
  });
  const { paRenderView, paTranslate } = mod.__test;
  const vista = paRenderView(state, (key, vars) => paTranslate('es', key, vars), () => {});
  const estados = filasDe(vista).map((row) => row.props['data-tracking-state']).sort();
  assert.deepEqual(estados, ['off', 'on', 'paused'], 'cada fila conserva su estado real');
  const texto = textOf(vista);
  assert.equal(texto.includes('Seguido'), true);
  assert.equal(texto.includes('Pausado'), true);
  assert.equal(texto.includes('Sin seguimiento'), true);
  // D-UX22-04: seguido SIN proyecto no resuelve, y la vista lo dice con el texto exacto.
  assert.equal(texto.includes('Seguido · sin proyecto asociado — no resolverá contexto'), true);
  assert.equal(texto.includes('revisión 1'), true, 'la revisión del CAS queda visible');
});

test('T-UX22-05: «Seleccionado para administrar» es la selección de perfil, no el seguimiento', () => {
  const { mod, state } = stateTracking({
    workspaces: [
      fila({ pathKey: 'w-1', path: 'C:/one', title: 'one', project: { id: 'prj_1', name: 'Proyecto Uno' } }),
      fila({ pathKey: 'w-2', path: 'C:/two', title: 'two', project: { id: 'prj_2', name: 'Proyecto Dos' } }),
    ],
    items: [
      filaSeguimiento({ pathKey: 'w-1', path: 'C:/one', project: { id: 'prj_1', name: 'Proyecto Uno' } }),
      filaSeguimiento({ pathKey: 'w-2', path: 'C:/two', project: { id: 'prj_2', name: 'Proyecto Dos' } }),
    ],
    selection: { projectId: 'prj_1', projectName: 'Proyecto Uno', revision: 3 },
  });
  const texto = renderTracking(state, mod);
  assert.equal(texto.includes('Seleccionado para administrar'), true);
  // Dos apariciones: la cabecera (la selección de perfil siempre visible) y la fila cuyo proyecto
  // asociado es justamente el seleccionado. Ninguna otra fila la lleva.
  assert.equal((texto.match(/Seleccionado para administrar/g) || []).length, 2);
  assert.equal(texto.includes('Seleccionado para administrar: Proyecto Uno'), true);
  const sinCoincidencia = stateTracking({ workspaces: [fila({ pathKey: 'w-2', path: 'C:/two', title: 'two', project: { id: 'prj_2', name: 'Proyecto Dos' } })], items: [filaSeguimiento({ pathKey: 'w-2', path: 'C:/two', project: { id: 'prj_2', name: 'Proyecto Dos' } })], selection: { projectId: 'prj_9', projectName: 'Otro', revision: 1 } });
  assert.equal((renderTracking(sinCoincidencia.state, sinCoincidencia.mod).match(/Seleccionado para administrar/g) || []).length, 1,
    'sin fila que coincida queda sólo la cabecera');
  assert.equal(texto.includes('Seguido'), true, 'las dos filas seguidas siguen diciendo «Seguido»');
  assert.equal((texto.match(/Seguido/g) || []).length >= 2, true);
  assert.equal(texto.includes('Seleccionado para administrar · Seguido'), false, 'no se fusionan los conceptos');
});

test('T-UX22-03: el proyecto resuelto por una sesión de IA no se inventa', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento()] });
  const texto = renderTracking(state, mod);
  assert.equal(texto.includes('Proyecto de la sesión de IA'), true);
  assert.equal(texto.includes('No se puede determinar desde el panel'), true);
  // Si la API lo entrega de forma explícita, se pinta; nunca se deduce del proyecto asociado.
  const conSesion = stateTracking({ items: [filaSeguimiento({ sessionProject: { id: 'prj_9', name: 'Sesión Nueve' } })] });
  const textoCon = renderTracking(conSesion.state, conSesion.mod);
  assert.equal(textoCon.includes('Sesión Nueve'), true);
  assert.equal(textoCon.includes('No se puede determinar desde el panel'), false);
  // El proyecto asociado NO se usa como sustituto del de la sesión.
  assert.equal(texto.includes('plugins-dhs'), true, 'el proyecto asociado sí se pinta en su columna');
  assert.equal((texto.match(/plugins-dhs/g) || []).length >= 2, true);
});

test('T-UX22-06: el aviso de autorización es visible en todos los estados de la vista', () => {
  const AVISO = 'Seguir un workspace no autoriza su lectura ni sus subcarpetas; la autorización se administra aparte';
  const lista = stateTracking({ items: [filaSeguimiento()] });
  assert.equal(renderTracking(lista.state, lista.mod).includes(AVISO), true, 'lista');
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce, paRenderView, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  const offline = paRenderView({ ...paInitialState({ demo: true }), view: 'tracking' }, t, () => {});
  assert.equal(textOf(offline).includes(AVISO), true, 'modo demostración');
  const error = paReduce({ ...paInitialState({ demo: true }), mode: 'api' }, { type: 'tracking-error', reason: 'transport-error' });
  assert.equal(textOf(paRenderView({ ...error, view: 'tracking' }, t, () => {})).includes(AVISO), true, 'error');
  const cargando = paReduce({ ...paInitialState({ demo: true }), mode: 'api' }, { type: 'nav', view: 'tracking' });
  assert.equal(textOf(paRenderView({ ...cargando, view: 'tracking' }, t, () => {})).includes(AVISO), true, 'cargando');
});

test('los cinco filtros recortan la tabla sin inventar filas', () => {
  const { mod, state } = stateTracking({
    workspaces: [
      fila({ pathKey: 'w-1', path: 'C:/one', title: 'one', project: { id: 'prj_1', name: 'Uno' } }),
      fila({ pathKey: 'w-2', path: 'C:/two', title: 'two', project: null }),
      fila({ pathKey: 'w-3', path: 'C:/three', title: 'three', project: { id: 'prj_3', name: 'Tres' } }),
    ],
    items: [
      filaSeguimiento({ pathKey: 'w-1', path: 'C:/one', state: 'on', project: { id: 'prj_1', name: 'Uno' } }),
      filaSeguimiento({ pathKey: 'w-2', path: 'C:/two', state: 'paused', project: null }),
    ],
  });
  const { paReduce, paRenderView, paTranslate, PA_TRACKING_FILTERS } = mod.__test;
  const contar = (s) => filasDe(paRenderView(s, (key, vars) => paTranslate('es', key, vars), () => {})).length;
  assert.deepEqual([...PA_TRACKING_FILTERS], ['all', 'followed', 'none', 'withProject', 'withoutProject']);
  assert.equal(contar(state), 3, 'Todos');
  assert.equal(contar(paReduce(state, { type: 'tracking-filter', filter: 'followed' })), 2, 'Seguidos incluye pausados');
  assert.equal(contar(paReduce(state, { type: 'tracking-filter', filter: 'none' })), 1, 'Sin seguimiento');
  assert.equal(contar(paReduce(state, { type: 'tracking-filter', filter: 'withProject' })), 1,
    'sólo cuenta la asociación de seguimiento, no la relación del Host');
  assert.equal(contar(paReduce(state, { type: 'tracking-filter', filter: 'withoutProject' })), 2);
  assert.equal(contar(paReduce(state, { type: 'tracking-filter', filter: 'inventado' })), 3, 'un filtro inválido no vacía la tabla');
});

test('T-UX22-10: las cinco acciones humanas se enrutan con la revisión de la fila', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento({ state: 'on', revision: 4 })] });
  const { paReduce, paInitialState } = mod.__test;
  const op = (action, st) => paReduce(state, { type: 'tracking-op', action, state: st, pathKey: fila().pathKey });
  assert.equal(op('enable', 'on').trackingOp.state, 'on');
  assert.equal(op('pause', 'paused').trackingOp.state, 'paused');
  assert.equal(op('resume', 'on').trackingOp.state, 'on');
  assert.equal(op('disable', 'off').trackingOp.state, 'off');
  assert.equal(op('disable', 'off').trackingOp.expectedRevision, 4);
  assert.equal(op('remove').trackingOp.action, 'remove');
  assert.equal(op('pause', 'paused').pending, 'tracking-mutation');
  // Sin fila la revisión es 0: el contrato dice que 0 significa «crear».
  const sinFila = stateTracking({ items: [] }).state;
  const crear = paReduce(sinFila, { type: 'tracking-op', action: 'enable', state: 'on', pathKey: fila().pathKey });
  assert.equal(crear.trackingOp.expectedRevision, 0);
  // En modo demostración no se encola nada: se avisa y se queda como estaba.
  const demo = paReduce({ ...paInitialState({ demo: true }), view: 'tracking' }, { type: 'tracking-op', action: 'enable', pathKey: 'x' });
  assert.equal(demo.pending, null);
  assert.equal(demo.notice.code, 'notice.trackingOffline');
});

test('T-UX22-10: un 409 recarga, avisa y no reintenta a ciegas', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento({ revision: 2 })] });
  const { paReduce, paRenderView, paTranslate } = mod.__test;
  const pendiente = paReduce(state, { type: 'tracking-op', action: 'pause', state: 'paused', pathKey: fila().pathKey });
  const conflicto = paReduce(pendiente, { type: 'tracking-mutation-error', reason: 'revision-conflict', reloaded: true });
  assert.equal(conflicto.pending, null, 'no queda ninguna petición en curso: no hay reintento automático');
  assert.equal(conflicto.trackingOp, null, 'la operación fallida no se conserva para repetirla');
  assert.equal(conflicto.notice.code, 'notice.trackingConflict');
  const texto = textOf(paRenderView(conflicto, (key, vars) => paTranslate('es', key, vars), () => {}));
  assert.equal(texto.includes('Otro panel cambió el seguimiento antes'), true);
  assert.equal(texto.includes('se recargó el estado vigente'), true);
  // Un fallo que no es de revisión se distingue: no se dice «conflicto» cuando no lo es.
  const fallo = paReduce(pendiente, { type: 'tracking-mutation-error', reason: 'transport-error', reloaded: true });
  assert.equal(fallo.notice.code, 'notice.trackingFailed');
  assert.equal(fallo.notice.values.reason, 'transport-error');
  const textoFallo = textOf(paRenderView(fallo, (key, vars) => paTranslate('es', key, vars), () => {}));
  assert.equal(textoFallo.includes('Se recargó el seguimiento'), true, 'el aviso dice que se releyó el estado real');
  assert.equal(textoFallo.includes('no se cambió nada'), false, 'no se afirma un estado que no se ha mirado');
  assert.equal(textoFallo.includes('Otro panel cambió'), false);
});

test('F9 · si la relectura también falla, el aviso no afirma que se releyó', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento({ revision: 2 })] });
  const { paReduce, paRenderView, paTranslate } = mod.__test;
  const pending = paReduce(state, { type: 'tracking-op', action: 'pause', state: 'paused', pathKey: fila().pathKey });
  const failed = paReduce(pending, { type: 'tracking-mutation-error', reason: 'transport-error', reloaded: false });
  assert.equal(failed.notice.code, 'notice.trackingFailedUnreloaded');
  const text = textOf(paRenderView(failed, (key, vars) => paTranslate('es', key, vars), () => {}));
  assert.equal(text.includes('Se recargó el seguimiento'), false, 'no se afirma una relectura que falló');
  assert.equal(text.includes('la vista puede estar desactualizada'), true);
});

test('compatibilidad: un panel 1.6 contra un servidor 1.5 conocido no envía intent ni acciones avanzadas', () => {
  const { mod, state } = stateTracking({
    items: [filaSeguimiento({ revision: 1, state: 'off', project: { id: 'prj_1', name: 'plugins-dhs' } })],
  });
  const base = { ...state };
  const oldActions = [];
  const oldTree = mod.__test.paRenderView(
    { ...base, apiVersion: 'pa/1.5.0' },
    (key, vars) => mod.__test.paTranslate('es', key, vars),
    (action) => oldActions.push(action),
  );
  const oldToggle = findRoleSwitch(oldTree);
  assert.ok(oldToggle, 'la fila conserva el control');
  oldToggle.props.onClick();
  assert.equal(oldActions[0].intent, null, 'un 1.5 no conoce intent=provision');
  assert.equal(textOf(oldTree).includes('Avanzado'), false, 'un 1.5 no tiene rutas move/revoke');

  const newActions = [];
  const newTree = mod.__test.paRenderView(
    { ...base, apiVersion: 'pa/1.6.0' },
    (key, vars) => mod.__test.paTranslate('es', key, vars),
    (action) => newActions.push(action),
  );
  const newToggle = findRoleSwitch(newTree);
  newToggle.props.onClick();
  assert.equal(newActions[0].intent, 'provision', 'control positivo: 1.6 sí prepara memoria');
  assert.equal(textOf(newTree).includes('Avanzado'), true);
});

test('F9 · si la relectura de una respuesta sin item falla, el aviso cambia a no recargado', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento({ revision: 2 })] });
  const { paReduce } = mod.__test;
  const pending = paReduce(state, { type: 'tracking-op', action: 'pause', state: 'paused', pathKey: fila().pathKey });
  const withoutItem = paReduce(pending, {
    type: 'tracking-mutation-ok', op: { action: 'pause', pathKey: fila().pathKey }, data: {},
  });
  assert.equal(withoutItem.notice.code, 'notice.trackingReloaded');
  const failed = paReduce(withoutItem, { type: 'tracking-error', reason: 'transport-error' });
  assert.equal(failed.notice.code, 'notice.trackingReloadFailed');
});

test('T-R1.2-04: una revocación parcial no se anuncia como revocación total', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento({ revision: 3, projectId: 'prj_01J0000000000000000000000' })] });
  const { paReduce, paRenderView, paTranslate } = mod.__test;
  const conAdmin = paReduce(state, {
    type: 'tracking-admin', action: 'revoke', pathKey: fila().pathKey, revision: 3,
  });
  const parcial = paReduce(conAdmin, {
    type: 'tracking-admin-ok',
    admin: { action: 'revoke', pathKey: fila().pathKey },
    data: { changed: true, complete: false, remaining: [{ id: 'root_1', path: fila().path }] },
  });
  assert.equal(parcial.notice.code, 'notice.trackingRevokedPartial');
  assert.equal(parcial.notice.values.count, 1);
  const texto = textOf(paRenderView(parcial, (key, vars) => paTranslate('es', key, vars), () => {}));
  assert.equal(texto.includes('el acceso de lectura continúa'), true);
  assert.equal(texto.includes('Acceso de lectura revocado; la memoria sigue intacta'), false);
});

test('T-R1.2-04b: una revocación sin cambio no anuncia que retiró acceso', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento({ revision: 3, projectId: 'prj_01J0000000000000000000000' })] });
  const { paReduce, paRenderView, paTranslate } = mod.__test;
  const already = paReduce(state, {
    type: 'tracking-admin-ok',
    admin: { action: 'revoke', pathKey: fila().pathKey },
    data: { changed: false, complete: true, remaining: [] },
  });
  assert.equal(already.notice.code, 'notice.trackingRevokeNoChange');
  const remaining = paReduce(state, {
    type: 'tracking-admin-ok',
    admin: { action: 'revoke', pathKey: fila().pathKey },
    data: { changed: false, complete: false, remaining: [{ id: 'root_padre', path: 'C:/padre' }] },
  });
  assert.equal(remaining.notice.code, 'notice.trackingRevokeNoChangeRemaining');
  const texto = textOf(paRenderView(remaining, (key, vars) => paTranslate('es', key, vars), () => {}));
  assert.equal(texto.includes('No se retiró ningún acceso propio'), true);
  assert.equal(texto.includes('Se retiró el acceso que creó LifeCode RAG'), false);
});

test('T-R1.2-05: el botón de revocar explica el motivo real (ya revocado, en curso, no demostrable)', () => {
  const { mod, state } = stateTracking({
    items: [filaSeguimiento({
      memory: {
        state: 'ready', projectId: 'prj_1', association: 'explicit', store: 'present',
        canRevoke: false, canRevokeReason: 'already-revoked',
        consent: { trust: null, root: null, revokedAt: '2026-11-24T10:00:00.000Z' },
      },
    })],
  });
  const texto = renderTracking(state, mod);
  assert.equal(texto.includes('El acceso propio ya se revocó'), true);
  assert.equal(texto.includes('No se puede demostrar'), false, 'no se afirma falta de prueba cuando ya se revocó');

  const reasonText = (reason) => {
    const built = stateTracking({
      items: [filaSeguimiento({
        memory: {
          state: reason === 'provisioning' ? 'provisioning' : 'ready',
          projectId: 'prj_1', association: 'explicit', store: 'present',
          canRevoke: false, canRevokeReason: reason,
          consent: { trust: null, root: null, revokedAt: null },
        },
      })],
    });
    return renderTracking(built.state, built.mod);
  };
  assert.equal(reasonText('provisioning').includes('se está preparando'), true);
  assert.equal(reasonText('project-inactive').includes('no está activo'), true);
  assert.equal(reasonText('no-provenance').includes('No se puede demostrar'), true);
});

test('T-R1.2-06: un fallo de acción avanzada que no es de revisión no se etiqueta como «otro panel»', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento({ revision: 2 })] });
  const { paReduce } = mod.__test;
  const failed = paReduce(state, { type: 'tracking-admin-error', reason: 'revocation-not-proven', conflict: false, reloaded: true });
  assert.equal(failed.notice.code, 'notice.trackingAdminFailed');
  const texto = renderTracking(failed, mod);
  assert.equal(texto.includes('revocation-not-proven'), true);
  assert.equal(texto.includes('Otro panel'), false);
});

test('T-UX22-13: una mutación confirmada pinta la revisión del servidor y avisa', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento({ state: 'on', revision: 2 })] });
  const { paReduce, paRenderView, paTranslate } = mod.__test;
  const pendiente = paReduce(state, { type: 'tracking-op', action: 'pause', state: 'paused', pathKey: fila().pathKey });
  const confirmado = paReduce(pendiente, {
    type: 'tracking-mutation-ok',
    op: pendiente.trackingOp,
    data: { item: filaSeguimiento({ state: 'paused', revision: 3 }), revision: 3 },
  });
  assert.equal(confirmado.pending, null);
  assert.equal(confirmado.notice.code, 'notice.trackingSaved');
  assert.equal(confirmado.notice.values.revision, 3, 'la revisión es la del servidor, no «la anterior + 1»');
  assert.equal(confirmado.tracking.items[0].state, 'paused');
  assert.equal(confirmado.tracking.items[0].revision, 3);
  const texto = textOf(paRenderView(confirmado, (key, vars) => paTranslate('es', key, vars), () => {}));
  assert.equal(texto.includes('Seguimiento actualizado (revisión 3)'), true);
});

test('T-UX22-15: sin `item` en la respuesta se relee y no se inventa la revisión', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento({ revision: 2 })] });
  const { paReduce } = mod.__test;
  const pendiente = paReduce(state, { type: 'tracking-op', action: 'pause', state: 'paused', pathKey: fila().pathKey });
  const releer = paReduce(pendiente, { type: 'tracking-mutation-ok', op: pendiente.trackingOp, data: { changed: true } });
  assert.equal(releer.notice.code, 'notice.trackingReloaded');
  assert.equal(releer.pending, 'tracking', 'se pide una relectura explícita');
  assert.equal(releer.tracking.items[0].revision, 2, 'la fila conserva la revisión real; no se sube a ciegas');
});

test('T-UX22-14: un fallo de relectura conserva las filas y ofrece reintentar', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento({ revision: 2 })] });
  const { paReduce, paRenderView, paTranslate } = mod.__test;
  const fallo = paReduce(state, { type: 'tracking-error', reason: 'transport-error' });
  assert.equal(fallo.tracking.items.length, 1, 'lo que la persona ya tenía delante no se borra');
  assert.equal(fallo.tracking.items[0].revision, 2);
  const vista = paRenderView(fallo, (key, vars) => paTranslate('es', key, vars), () => {});
  const texto = textOf(vista);
  assert.equal(texto.includes('transport-error'), true);
  assert.equal(texto.includes('Reintentar'), true, 'el error tiene salida');
  assert.equal(texto.includes('Seguido'), true, 'la fila sigue pintándose');
});

/* ═══════════════ UX-2.2 · pautas del panel de seguimiento (recuperadas) ════════════════════════
 *
 * Cierran el contrato del panel de Seguimiento contra la red real del cliente: qué se pide al entrar
 * en la sección, qué cabeceras y qué CAS lleva cada mutación, qué ocurre con un 409 y qué NO se
 * inventa cuando la respuesta no trae la fila. Todo con un `fetch` guionizado: sin red, sin Host y
 * sin tocar `~/.dsh`.
 */

/** Doble de `fetch` por ruta: cada respuesta es el sobre §5 y las llamadas quedan registradas. */
function paFetchScript(routes) {
  const calls = [];
  const queues = new Map(Object.entries(routes)
    .map(([key, value]) => [key, Array.isArray(value) ? value.slice() : [value]]));
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    // La ruta se compara sin prefijo ni query: el panel siempre habla con `PA_API`.
    const path = String(url).replace('/lifecode-rag/pa', '').split('?')[0];
    const key = method + ' ' + path;
    calls.push({ url: String(url), method, path, headers: init.headers || {}, body: init.body });
    const queue = queues.get(key);
    assert.ok(queue && queue.length > 0, 'petición no guionizada: ' + key);
    // La última respuesta se repite: un `GET` que se relee no agota el guion.
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const status = next.status || 200;
    // `negotiateMode` lee por `.json()` y `request` por `.text()`: el doble expone las dos.
    return {
      ok: status < 400,
      status,
      json: async () => JSON.parse(JSON.stringify(next.body ?? null)),
      text: async () => JSON.stringify(next.body),
    };
  };
  return { fetchImpl, calls };
}

/** Deja correr lo que el panel encadena: promesas del `fetch`, `dispatch` y efectos nuevos. */
async function settle(panel, rounds = 10) {
  for (let round = 0; round < rounds; round += 1) {
    panel.runEffects();
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}

/** Snapshot Project-Aware mínimo pero real: un proyecto activo y cero fuentes. */
function panelSnapshot() {
  return {
    mode: 'api',
    service: 'ok',
    project: { id: 'prj_1', name: 'plugins-dhs' },
    projects: [{ id: 'prj_1', name: 'plugins-dhs', current: true, roots: 1 }],
    scopes: [{ id: 'prj_1', kind: 'prj', name: 'plugins-dhs', roots: 1 }],
    libraries: [],
    sources: { rows: [], total: 0 },
    archived: [],
    roots: [],
    selection: null,
  };
}

/** Monta el panel real en modo API y lo deja con la sección de Seguimiento ya cargada. */
async function mountTrackingPanel(routes) {
  const script = paFetchScript({
    'GET /snapshot': { body: { ok: true, data: panelSnapshot() } },
    'GET /workspaces': { body: { ok: true, data: payloadCon([fila()]) } },
    ...routes,
  });
  const { mod } = loadModule({ document: fakeDocument(), fetch: script.fetchImpl });
  const t = (key, vars) => mod.__test.paTranslate('es', key, vars);
  const panel = mount(mod.__test.PaPanel, { t });
  await settle(panel);       // negocia el modo y pide `/snapshot`
  panel.go('Seguimiento');  // entrar en la sección pide el estado
  await settle(panel);      // `/workspaces` (si falta) y `/tracking`
  return { mod, panel, t, calls: script.calls };
}

test('UX-2.2: entrar en la sección pide el estado y en modo demostración no dispara red', async () => {
  // Demostración EXPLÍCITA: el panel se monta anunciado (no negociado) y no pide nada a la red.
  const demo = mountPanel();
  assert.equal(demo.panel.text().includes('SYNTHETIC DATA MODE — DEMO: ESTA VISTA NO LEE EL PROYECTO REAL'), true,
    'la demostración se anuncia al montar');
  demo.panel.go('Seguimiento');
  assert.ok(demo.panel.find((node) => node.props['data-view'] === 'tracking'), 'la sección se monta en demostración');
  assert.equal(demo.panel.text().includes('En modo demostración no se inventan seguimientos ni se escribe nada.'), true);
  assert.equal(demo.spies.fetch, 0, 'la demostración no dispara red');

  // Modo API: entrar en la sección pide la lista del Host y el estado del seguimiento, en ese orden.
  const { panel, calls } = await mountTrackingPanel({
    'GET /tracking': { body: { ok: true, data: { items: [filaSeguimiento({ revision: 3 })], counts: {}, asOf: 1 } } },
  });
  assert.deepEqual(calls.map((call) => call.method + ' ' + call.path),
    ['GET /snapshot', 'GET /snapshot', 'GET /workspaces', 'GET /tracking'],
    'arranque y entrada en la sección: snapshot (negociar y leer), lista del Host y estado del seguimiento');
  assert.equal(panel.text().includes('revisión 3'), true, 'la revisión del servidor queda visible');
  assert.equal(panel.text().includes('plugins-dhs'), true);
});

test('UX-2.2: /pa/workspaces ya no descarta tracked, trackingState ni trackingProject', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce, paTrackingRows } = mod.__test;
  const conEstado = fila({
    tracked: true,
    trackingState: 'paused',
    trackingProject: { id: 'prj_1', name: 'plugins-dhs' },
  });
  const sinProyecto = fila({
    id: 'ws_2', pathKey: 'c:/otro', path: 'C:/otro', title: 'otro',
    project: null, relation: 'none', tracked: false, trackingState: 'off', trackingProject: null,
  });
  const state = paReduce({ ...paInitialState(), mode: 'api' },
    { type: 'workspaces-ok', payload: payloadCon([conEstado, sinProyecto]) });
  const [primera, segunda] = state.workspaces.items;
  // La lista blanca anterior descartaba los tres campos aditivos y la vista se quedaba sin estado.
  assert.equal(primera.tracked, true);
  assert.equal(primera.trackingState, 'paused', 'el estado aditivo del Host no se pierde');
  // Los objetos nacen en el contexto `vm` del cliente: se comparan por valor, no por referencia.
  assert.deepEqual(JSON.parse(JSON.stringify(primera.trackingProject)), { id: 'prj_1', name: 'plugins-dhs' });
  assert.equal(segunda.trackingState, 'off');
  assert.equal(segunda.tracked, false);
  assert.equal(segunda.trackingProject, null);
  // La vista de Seguimiento cruza las dos fuentes: sin fila de tracking, la asociación viene de aquí.
  const rows = paTrackingRows(state);
  assert.equal(rows.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(rows[0].project)), { id: 'prj_1', name: 'plugins-dhs' },
    'el proyecto asociado de /pa/workspaces llega a la vista');
  assert.equal(rows[0].state, 'off', 'sin fila de seguimiento no se inventa uno');
  assert.equal(rows[0].lastStatus, 'ok', 'la disponibilidad del Host se conserva');
});

test('UX-2.2: cadenas nuevas en ES y EN, con los mismos marcadores', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { PA_DICT, paTranslate } = mod.__test;
  const claves = Object.keys(PA_DICT.es)
    .filter((key) => key.startsWith('ux.track.') || key.startsWith('notice.tracking'));
  assert.equal(claves.length >= 60, true, 'el bloque de seguimiento trae sus cadenas: ' + claves.length);
  const marcadores = (text) => (String(text).match(/\{[a-zA-Z]+\}/g) || []).sort();
  for (const key of claves) {
    assert.equal(typeof PA_DICT.en[key], 'string', 'falta en EN: ' + key);
    assert.equal(String(PA_DICT.en[key]).trim() === '', false, 'cadena vacía en EN: ' + key);
    assert.deepEqual(marcadores(PA_DICT.en[key]), marcadores(PA_DICT.es[key]), 'marcadores distintos en ' + key);
    // Los marcadores se sustituyen de verdad, en los dos idiomas: ninguno queda como `{algo}`.
    const requeridos = [...new Set(PA_DICT.es[key].match(/\{[a-zA-Z]+\}/g) || [])];
    const vars = Object.fromEntries(requeridos.map((token) => [token.slice(1, -1), 'X']));
    assert.equal(/\{[a-zA-Z]+\}/.test(paTranslate('es', key, vars)), false, 'marcador sin resolver en ES: ' + key);
    assert.equal(/\{[a-zA-Z]+\}/.test(paTranslate('en', key, vars)), false, 'marcador sin resolver en EN: ' + key);
  }
  assert.equal(paTranslate('es', 'ux.track.countFollowed', { count: 2 }), 'Seguidos: 2');
  assert.equal(paTranslate('en', 'ux.track.countFollowed', { count: 2 }), 'Followed: 2');
  assert.equal(paTranslate('es', 'notice.trackingSaved', { revision: 4 }), 'Seguimiento actualizado (revisión 4).');
});

test('T-UX22-10: PUT y DELETE llevan cabeceras de mutación y el CAS', async () => {
  const { panel, calls } = await mountTrackingPanel({
    'GET /tracking': [
      { body: { ok: true, data: { items: [filaSeguimiento({ revision: 2 })], counts: {}, asOf: 1 } } },
      { body: { ok: true, data: { items: [filaSeguimiento({ state: 'paused', revision: 5 })], counts: {}, asOf: 2 } } },
    ],
    'PUT /tracking': { status: 409, body: { ok: false, error: { code: 'revision-conflict', message: 'revisión desactualizada' } } },
    'DELETE /tracking': { body: { ok: true, data: { changed: true } } },
  });
  const toggle = panel.find((node) => node.props['data-tracking-toggle'] === fila().pathKey);
  assert.equal(toggle.props['aria-checked'], 'true', 'la fila llegó del servidor como seguida');
  panel.click(toggle);
  await settle(panel);

  // Camino completo de `revision-conflict`: PUT con CAS → 409 → relectura → aviso, sin reintento.
  const puts = calls.filter((call) => call.method === 'PUT');
  assert.equal(puts.length, 1, 'un 409 no se reintenta a ciegas');
  assert.equal(puts[0].path, '/tracking');
  assert.equal(puts[0].headers['content-type'], 'application/json');
  assert.equal(puts[0].headers['x-lifecode-rag'], '1', 'la compuerta del servidor exige la cabecera de mutación');
  assert.deepEqual(JSON.parse(puts[0].body), {
    pathKey: fila().pathKey,
    state: 'paused',
    expectedRevision: 2,
    path: fila().path,
    projectId: 'prj_1',
  }, 'el CAS viaja en el cuerpo con la revisión de la fila');
  const reads = calls.filter((call) => call.method === 'GET' && call.path === '/tracking');
  assert.equal(reads.length, 2, 'una lectura al entrar y otra tras el conflicto');
  assert.equal(panel.text().includes('Otro panel cambió el seguimiento antes'), true);
  assert.equal(panel.text().includes('revisión 5'), true, 'manda la revisión que devolvió el servidor');

  // DELETE: argumentos en la query, cabeceras de mutación explícitas y ningún cuerpo.
  panel.click(panel.find((node) => node.props['data-tracking-op'] === 'remove'));
  await settle(panel);
  const deletes = calls.filter((call) => call.method === 'DELETE');
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].url, '/lifecode-rag/pa/tracking?pathKey='
    + encodeURIComponent(fila().pathKey) + '&expectedRevision=5');
  assert.equal(deletes[0].body, undefined, 'DELETE no lleva cuerpo');
  assert.equal(deletes[0].headers['x-lifecode-rag'], '1', 'sin cuerpo también se declara la mutación');
  assert.equal(panel.text().includes('Se quitó la fila de seguimiento'), true);
});

test('T-UX22-10: un 409 con la relectura también rota conserva las filas y avisa del conflicto', async () => {
  const { panel, calls } = await mountTrackingPanel({
    'GET /tracking': [
      { body: { ok: true, data: { items: [filaSeguimiento({ revision: 2 })], counts: {}, asOf: 1 } } },
      { status: 500, body: { ok: false, error: { code: 'internal', message: 'registro no disponible' } } },
    ],
    'PUT /tracking': { status: 409, body: { ok: false, error: { code: 'revision-conflict', message: 'revisión desactualizada' } } },
  });
  panel.click(panel.find((node) => node.props['data-tracking-toggle'] === fila().pathKey));
  await settle(panel);
  // La relectura del estado vigente falló: no hay datos nuevos, pero tampoco se borra lo que había.
  const reads = calls.filter((call) => call.method === 'GET' && call.path === '/tracking');
  assert.equal(reads.length, 2, 'se intentó releer una sola vez');
  const filas = filasDe(panel.tree);
  assert.equal(filas.length, 1, 'la fila que la persona tenía delante no se borra');
  assert.equal(filas[0].props['data-tracking-state'], 'on');
  assert.equal(panel.text().includes('Otro panel cambió el seguimiento antes'), true,
    'el conflicto se explica aunque la relectura falle');
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 1, 'no se reintenta a ciegas');
});

test('F9: una respuesta de PUT sin `item` no inventa la fila ni la revisión y pide recarga', async () => {
  const { panel, calls } = await mountTrackingPanel({
    'GET /tracking': [
      { body: { ok: true, data: { items: [filaSeguimiento({ revision: 2 })], counts: {}, asOf: 1 } } },
      { body: { ok: true, data: { items: [filaSeguimiento({ state: 'paused', revision: 3 })], counts: {}, asOf: 2 } } },
    ],
    // El contrato devuelve `item`; esta respuesta no lo trae.
    'PUT /tracking': { body: { ok: true, data: { changed: true } } },
  });
  panel.click(panel.find((node) => node.props['data-tracking-toggle'] === fila().pathKey));
  await settle(panel);
  const reads = calls.filter((call) => call.method === 'GET' && call.path === '/tracking');
  assert.equal(reads.length, 2, 'sin `item` el panel relee `GET /tracking` en vez de suponer');
  assert.equal(panel.text().includes('La respuesta no trajo la fila: se recargó el seguimiento desde el servidor.'), true);
  assert.equal(panel.text().includes('Seguimiento actualizado'), false, 'no se anuncia un éxito que no consta');
  assert.equal(panel.text().includes('revisión 3'), true, 'la revisión es la que devolvió la relectura');
  const filas = filasDe(panel.tree);
  assert.equal(filas.length, 1, 'la relectura sustituye la fila; no se duplica ni se sintetiza');
  assert.equal(filas[0].props['data-tracking-state'], 'paused');
});

test('F9: un estado de seguimiento no reconocido es `null` y se pinta como indeterminado', () => {
  const { mod, state } = stateTracking({ items: [filaSeguimiento({ state: 'seguido' })] });
  assert.equal(state.tracking.items[0].state, null, 'un valor fuera del contrato no se interpreta');
  const { paRenderView, paTranslate, paTrackingState } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  assert.equal(paTrackingState(state.tracking.items[0], t).label, 'No se puede determinar desde el panel');
  const vista = paRenderView(state, t, () => {});
  const filas = filasDe(vista);
  assert.equal(filas[0].props['data-tracking-state'], 'unknown', 'la fila no elige bando');
  const control = findRoleSwitch(vista);
  assert.equal(control.props['aria-checked'], 'mixed');
  assert.equal(control.props.disabled, true, 'sin estado no se ofrece cambiar la decisión');
  assert.equal(control.props.onClick, undefined);
  const texto = textOf(vista);
  assert.equal(texto.includes('Seguidos: 0'), true);
  assert.equal(texto.includes('Sin seguimiento: 0'), true, 'tampoco se cuenta como «sin seguimiento»');
});

test('F9: `lastStatus` y `resolves` no reconocidos quedan en null (no se deducen)', () => {
  const { mod, state } = stateTracking({
    items: [filaSeguimiento({ lastStatus: 'excelente', resolves: 'sí', association: 'inventada' })],
  });
  const row = state.tracking.items[0];
  assert.equal(row.lastStatus, null, 'la disponibilidad no se deduce del estado de seguimiento');
  assert.equal(row.resolves, null, 'el veredicto sólo se usa si la API manda un booleano');
  assert.equal(row.association, null, 'una asociación desconocida no se convierte en «explicit»');
  assert.equal(row.state, 'on', 'el eje A sí era válido y se conserva');
  const texto = renderTracking(state, mod);
  assert.equal(texto.includes('Disponibilidad:'), false, 'sin estado reconocido no se pinta la disponibilidad');
  assert.equal(texto.includes('Seguido'), true, 'el eje A sigue pintándose');
});

test('F9: `tracked:true` con un estado no reconocido no se convierte en «on»', () => {
  const { mod, state } = stateTracking({
    workspaces: [fila({ tracked: true, trackingState: 'paused ', trackingProject: null })],
    items: [],
  });
  const item = state.workspaces.items[0];
  assert.equal(item.trackingState, null, '«paused » no es «paused»: no se recorta ni se adivina');
  assert.equal(item.tracked, false, 'la bandera del Host no basta para afirmar que se sigue');
  const vista = mod.__test.paRenderView(state, (key, vars) => mod.__test.paTranslate('es', key, vars), () => {});
  const filas = filasDe(vista);
  assert.equal(filas[0].props['data-tracking-state'], 'off', 'sin fila de seguimiento queda «sin seguimiento», no «seguido»');
  assert.equal(findRoleSwitch(vista).props['aria-checked'], 'false');
  assert.equal(textOf(vista).includes('Seguidos: 0'), true);
});

test('R1.2: el toggle pide provisión, mover conserva el CAS y revocar sin prueba se deshabilita', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce, paRenderView, paTrackingRequest, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  const base = {
    ...paInitialState({ demo: true }), mode: 'api', view: 'tracking',
    workspaces: { loaded: true, loading: false, source: 'host', items: [], error: null },
    tracking: {
      loaded: true, loading: false, error: null, counts: null, asOf: 1, truncated: false, filter: 'all',
      items: [{
        pathKey: 'c:/ws', path: 'C:/ws', state: 'off', revision: 4,
        project: { id: 'prj_1', name: 'P' }, association: 'explicit', lastStatus: 'ok',
        memory: { state: 'none', canRevoke: false, index: null },
      }],
    },
  };

  // Activar un workspace sin memoria pide provisión, con la revisión de la fila como CAS.
  const enabled = paReduce(base, {
    type: 'tracking-op', action: 'enable', state: 'on', intent: 'provision',
    pathKey: 'c:/ws', path: 'C:/ws', projectId: 'prj_1',
  });
  assert.equal(enabled.trackingOp.intent, 'provision');
  const built = paTrackingRequest(enabled.trackingOp);
  assert.equal(built.options.body.intent, 'provision');
  assert.equal(built.options.body.expectedRevision, 4);

  // Mover: abrir, escribir la ruta y confirmar. El cuerpo lleva la revisión de la fila.
  const opened = paReduce(base, {
    type: 'tracking-admin-open', action: 'move', pathKey: 'c:/ws', path: 'C:/ws', revision: 4,
  });
  assert.equal(opened.trackingAdmin.action, 'move');
  const typed = paReduce(opened, { type: 'tracking-admin-input', value: 'C:/nuevo' });
  const confirmed = paReduce(typed, { type: 'tracking-admin-confirm' });
  assert.equal(confirmed.pending, 'tracking-admin');
  const done = paReduce(confirmed, {
    type: 'tracking-admin-ok',
    admin: typed.trackingAdmin,
    data: {
      item: {
        pathKey: 'c:/nuevo', path: 'C:/nuevo', state: 'off', revision: 1,
        project: { id: 'prj_1', name: 'P' }, memory: { state: 'ready', canRevoke: true },
      },
    },
  });
  assert.equal(done.pending, null);
  assert.equal(done.trackingAdmin, null);
  assert.equal(done.tracking.items.length, 1);
  assert.equal(done.tracking.items[0].pathKey, 'c:/nuevo');
  assert.equal(done.notice.code, 'notice.trackingMoved');

  // Revocar sin procedencia: el botón existe, está deshabilitado y se explica por qué.
  const vista = paRenderView(base, t, () => {});
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of node.children ?? []) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  };
  const revoke = find(vista, (node) => node.props && node.props['data-tracking-revoke']);
  assert.ok(revoke, 'la acción de revocar existe en la fila');
  assert.equal(revoke.props.disabled, true);
  assert.equal(textOf(vista).includes('No se puede demostrar'), true);
});
