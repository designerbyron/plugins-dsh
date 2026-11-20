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
  useEffect(fn) { runtime.hook(); runtime.effects.push(fn); return undefined; },
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
    text() {
      return textOf(state.tree);
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
  return { mod, spies, panel: mount(PaPanel, { t }), t };
}

/* ------------------------------------------------------------------- estáticas */

test('el manifiesto exporta el cliente con la forma que exige el compositor', () => {
  assert.equal(manifest.name, '@local/lifecode-rag');
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

test('usa la misma ruta de API que el servidor y la cierra en modo sintético', () => {
  assert.equal(API_PREFIX, '/lifecode-rag/api');
  assert.equal(source.includes("const API = '/lifecode-rag/api'"), true);
  assert.equal(source.includes("blocked.code = 'fixture-mode'"), true);
});

test('registra los slots con la API vigente y no con la obsoleta', () => {
  assert.equal(source.includes('ctx.slots.inject(SIDEBAR_SLOT, () =>'), true);
  assert.equal(source.includes('ctx.slots.inject(MAIN_SLOT, () =>'), true);
  assert.equal(/ctx\.slots\.inject\(\s*[A-Z_]+\s*\)\s*;/.test(source), false, 'la forma inject(slot) sin callback ya no existe');
  assert.equal(source.includes('key: PANEL_ID'), true);
  assert.equal(source.includes("const PANEL_ID = 'lifecode-rag'"), true);
});

test('el panel arranca en fixture y solo pasa a api si el servidor lo confirma', () => {
  assert.equal(source.includes("mode: 'fixture'"), true, 'arranca en demostración explícita');
  assert.equal(source.includes('negotiateMode'), true, 'el modo se negocia con /lifecode-rag/pa/snapshot');
  assert.equal(/DATA_MODE\s*=\s*'live'/.test(source), false, 'no hay conmutación fija a live');
  assert.equal(source.includes("responde mode:'api'"), true);
  assert.equal(source.includes('SYNTHETIC DATA MODE — DEMO: ESTA VISTA NO LEE EL PROYECTO REAL'), true);
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
  assert.equal(panel.all(byRole('tab')).length, mod.__test.PA_VIEWS.length);
  assert.equal(panel.all(byRole('tabpanel')).length, 1);
  assert.equal(panel.all((node) => node.props['aria-selected'] === 'true').length, 1);
});

test('las diez vistas renderizan sin lanzar y con contenido propio', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { PA_VIEWS, paInitialState, paReduce, paRenderView, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  const base = paInitialState();
  const ids = PA_VIEWS.map((view) => view.id).concat(['source']);
  assert.equal(ids.length, 10, 'nueve pestañas + detalle de fuente');
  for (const id of ids) {
    const state = paReduce(base, { type: 'nav', view: id });
    const text = textOf(paRenderView(state, t, () => {}));
    assert.ok(text.length > 0, 'vista sin contenido: ' + id);
    if (id === 'source') assert.equal(text.includes('La fuente ya no está disponible'), true);
  }
});

test('navegación: pestañas, paginación, detalle y vuelta', () => {
  const { panel } = mountPanel();
  panel.click(panel.tab('Fuentes'));
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
  panel.click(panel.tab('Búsqueda'));
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
  panel.click(panel.tab('Búsqueda'));
  panel.change(panel.find((node) => node.props['data-field'] === 'query'), 'zzzz-no-existe');
  panel.click(panel.button('Buscar'));
  assert.equal(panel.text().includes('Sin resultados para esa consulta'), true);
});

test('operaciones simuladas: ingesta y reindexación dejan rastro sin escribir', () => {
  const { panel } = mountPanel();
  panel.click(panel.tab('Operaciones'));
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
  panel.click(panel.tab('Operaciones'));
  panel.change(panel.find((node) => node.props['data-field'] === 'ingest-path'), 'sintetico/nuevo/informe-escaneado.pdf');
  panel.click(panel.button('Ingesta simulada'));
  const text = panel.text();
  assert.equal(text.includes('Formato no soportado en el fixture'), true);
  assert.equal(text.includes('unsupported-format'), true);
  assert.equal(text.includes('Fuentes afectadas: 121'), true, 'no se añadió ninguna fuente');
  panel.click(panel.button('Descartar aviso'));
  assert.equal(panel.text().includes('Formato no soportado en el fixture'), false);
});

test('historial se presenta como no disponible, sin inventar ruta', () => {
  const { panel } = mountPanel();
  panel.click(panel.tab('Historial'));
  assert.equal(panel.text().includes('No disponible en esta versión'), true);
  assert.equal(panel.text().includes('El contrato pa-ui/0.1.0-draft no expone un listado de auditoría'), true);
});

test('el teclado mueve el foco entre pestañas (flechas)', () => {
  const { panel } = mountPanel();
  const tablist = panel.find(byRole('tablist'));
  let prevented = false;
  tablist.props.onKeyDown({ key: 'ArrowRight', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(panel.find((node) => node.props['data-view'] === 'libraries') !== null, true);
});

/* ------------------------------------------------------------------- reducer */

test('seleccionar proyecto sube la revisión y anota la operación', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const state = paInitialState();
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
  const next = paReduce(paInitialState(), { type: 'select-project', projectId: 'prj_k1fx_01' });
  assert.equal(next.session.session.selection.revision, 3);
  assert.equal(next.journal.length, 0);
  assert.equal(next.notice.code, 'notice.sameProject');
});

test('la paginación acota el offset y la ingesta añade una fuente', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const state = paInitialState();
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
  const dirty = paReduce(paReduce(paInitialState(), { type: 'ingest' }), { type: 'select-project', projectId: 'prj_k1fx_02' });
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
  const next = paReduce(paInitialState(), { type: 'hydrate', snapshot });
  assert.equal(next.mode, 'api');
  assert.equal(next.sources.length, 2);
  assert.deepEqual(next.sources.map((row) => row.title), ['guia-soporte.md', 'politica-reembolsos.md']);
  assert.equal(next.projects[0].id, 'prj_01LAB');
  assert.equal(next.sourcePage.offset, 0);
  assert.equal(next.error, null);
});

test('unavailable deja el panel en down con la razón del servidor', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce } = mod.__test;
  const next = paReduce(paInitialState(), { type: 'unavailable', reason: 'transport-error' });
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
    panel.click(panel.tab(mod.__test.paTranslate('es', view.key)));
  }
  panel.click(panel.button('Reiniciar datos sintéticos'));
  assert.deepEqual(spies, { fetch: 0, setInterval: 0, setTimeout: 0, requestAnimationFrame: 0 });
});

test('la capa heredada falla cerrada antes de tocar la red', async () => {
  const { mod, spies } = loadModule({ document: fakeDocument() });
  await assert.rejects(mod.__test.requestLegacy('/snapshot'), (error) => {
    assert.equal(error.code, 'fixture-mode');
    return true;
  });
  assert.equal(spies.fetch, 0);
});

test('los fixtures no contienen datos privados reales', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState } = mod.__test;
  const state = paInitialState();
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
  const one = textOf(paRenderView(paInitialState(), t, () => {}));
  const two = textOf(paRenderView(paInitialState(), t, () => {}));
  assert.equal(one, two);
});

/* ==================================================================== */
/* Remediación funcional 01 — regresiones de los defectos FA-01…FA-14   */
/* ==================================================================== */

const PANEL_VIEW_LABELS = ['Proyecto', 'Bibliotecas', 'Fuentes', 'Búsqueda', 'Contexto', 'Operaciones', 'Diagnóstico', 'Conexión', 'Historial'];
const RAW_KEY_PATTERN = /\b(common|nav|app|banner|project|libraries|sources|source|search|context|operations|diagnostics|connection|history|notice|view|status|a11y)\.[a-zA-Z]/;

test('FA-01/FA-02/FA-08: ninguna vista deja claves de traducción sin resolver', () => {
  const { panel } = mountPanel();
  for (const label of PANEL_VIEW_LABELS) {
    panel.click(panel.tab(label));
    const text = panel.text();
    assert.equal(RAW_KEY_PATTERN.test(text), false, 'clave cruda en «' + label + '»: ' + (text.match(RAW_KEY_PATTERN) ?? [])[0]);
  }
  panel.click(panel.tab('Diagnóstico'));
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
    panel.click(panel.tab(label));
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
  panel.click(panel.tab('Búsqueda'));
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
  panel.click(panel.tab('Búsqueda'));
  panel.change(panel.find((node) => node.props['data-field'] === 'query'), 'x'.repeat(600));
  panel.click(panel.button('Buscar'));
  assert.equal(panel.text().includes('512 caracteres'), true);
  assert.equal(panel.text().includes('Sin resultados para esa consulta'), false);
});

test('FA-06: la ingesta rechaza URIs duplicadas y conserva el fixture', () => {
  const { mod } = loadModule({ document: fakeDocument() });
  const { paInitialState, paReduce, paNormalizeUri } = mod.__test;
  const start = paInitialState();
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
  const tree = paRenderViewSafe(paInitialState(), t, () => { retried += 1; }, () => { throw new Error('boom interno'); });
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
  panel.click(panel.tab('Contexto'));
  const button = panel.button('Construir contexto');
  assert.equal(button.props.disabled, true, 'sin resultados no se construye contexto');
  panel.click(panel.tab('Búsqueda'));
  panel.change(panel.find((node) => node.props['data-field'] === 'query'), 'acta');
  panel.click(panel.button('Buscar'));
  const build = panel.button('Construir contexto con estos resultados');
  assert.equal(build.props.disabled, false, 'con resultados se habilita');
  panel.click(build);
  assert.equal(panel.text().includes('Tokens estimados'), true, 'el contexto se construye desde los resultados');
});

test('FA-13: el diagnóstico explica por qué el servicio está degradado', () => {
  const { panel } = mountPanel();
  panel.click(panel.tab('Diagnóstico'));
  assert.equal(panel.text().includes('1 de 3 almacenes no disponible(s)'), true);
  panel.click(panel.tab('Conexión'));
  assert.equal(panel.text().includes('Servicio degradado: 1 de 3 almacenes no disponible(s).'), true);
  assert.equal(panel.text().includes('no montada'), true);
});

test('FA-14: la paginación está en la cabecera y llega a la primera y a la última página', () => {
  const { panel } = mountPanel();
  panel.click(panel.tab('Fuentes'));
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
  panel.click(panel.tab('Fuentes'));
  const captions = panel.all((node) => node.type === 'caption');
  assert.equal(captions.length, 1, 'una tabla, un caption');
  for (const caption of captions) assert.equal(caption.props.className, 'lcr-pa-sr');
});

test('la cabecera distingue cliente, API, datos y servicio sin fingir conexión', () => {
  const { panel } = mountPanel();
  const text = panel.text();
  assert.equal(text.includes('Cliente montado'), true);
  assert.equal(text.includes('API no montada'), true);
  assert.equal(text.includes('Demo (fixtures)'), true);
  assert.equal(text.includes('SYNTHETIC DATA MODE'), true);
  assert.equal(panel.all((node) => node.props.role === 'status').length, 1, 'una sola región viva');
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
