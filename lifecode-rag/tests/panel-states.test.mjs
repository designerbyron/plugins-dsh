/**
 * Semántica de los dos estados que el Host pinta en la cabecera y en Resumen:
 *
 *   «Listo · 0 documentos»  →  el estado de proyecto (`paProjectState`) sólo certifica
 *                               `status:'active'` + raíz autorizada. Se rotula «Configurado».
 *   «Servicio: degraded»    →  el snapshot usa `service:'degraded'` para UNA cosa: el proyecto está
 *                               registrado y su almacén de ámbito aún no se creó (nace con la primera
 *                               ingesta). No es una avería y no se muestra el código crudo: la
 *                               cabecera presenta tres capas —conectividad con la API, registro del
 *                               perfil y almacén del proyecto—.
 *
 * Sin red y sin fixtures de demostración: el `fetch` del panel es un doble en memoria y el estado se
 * hidrata con el retrato que el contrato PA describe (docs/PA-UI-0-API-CONTRACT.md §6.2).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

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
  let definition = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => { definition = def; } } },
    console,
    document: fakeDocument(),
    fetch: fetchImpl ?? (async () => { throw new Error('fetch inesperado: el panel pidió la red'); }),
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
  return definition.factory((name) => {
    if (name === 'react') return ReactStub;
    throw new Error('require inesperado: ' + name);
  });
}

function walk(node, visit) {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
  if (typeof node === 'string' || typeof node === 'number') { visit({ text: String(node) }); return; }
  if (typeof node === 'object' && node.type) {
    visit(node);
    (node.children || []).forEach((child) => walk(child, visit));
  }
}

function textOf(node) {
  let text = '';
  walk(node, (item) => { if (item.text !== undefined) text += ' ' + item.text; });
  return text.replace(/\s+/g, ' ').trim();
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
    runEffects() { for (const effect of state.effects.slice()) effect(); },
    text() { return textOf(state.tree); },
    /** Texto de las píldoras de estado de la cabecera, en orden. */
    pills() {
      const found = [];
      walk(state.tree, (node) => {
        if (node.props && node.props.className === 'lcr-pa-status__item') found.push(textOf(node));
      });
      return found;
    },
    /** Texto de la tarjeta de métrica identificada por `data-kpi`. */
    kpi(key) {
      let found = null;
      walk(state.tree, (node) => { if (node.props && node.props['data-kpi'] === key) found = node; });
      return found ? textOf(found) : null;
    },
  };
}

function respondWith(snapshot) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data: snapshot }),
    text: async () => JSON.stringify({ ok: true, data: snapshot }),
  });
}

async function settle() {
  for (let round = 0; round < 8; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function mountPanel(snapshot, lang = 'es') {
  const mod = loadModule({ fetch: respondWith(snapshot) });
  const { PaPanel, paTranslate } = mod.__test;
  const panel = mount(PaPanel, { t: (key, vars) => paTranslate(lang, key, vars) });
  panel.runEffects();
  await settle();
  return { panel, mod };
}

/* ------------------------------------------------------------------- retratos */

/**
 * Retrato PA mínimo. `roots` es la raíz AUTORIZADA del proyecto (`projectsIndex` → `roots`), que es
 * lo único que alimenta el estado «Configurado». `sources.total` certifica los documentos.
 */
function retrato({ docs = 0, service = 'ok', roots = 1 } = {}) {
  const proyecto = {
    id: 'prj_dhs',
    name: 'plugins-dhs',
    status: 'active',
    roots,
    total: roots,
    current: true,
    selectable: roots > 0,
    docs,
  };
  return {
    mode: 'api',
    service,
    asOf: 1763856000000,
    version: 'pa/1.6.0',
    project: { id: proyecto.id, name: proyecto.name },
    selection: { projectId: proyecto.id, projectName: proyecto.name, revision: 1, source: 'explicit', selectedBy: 'human' },
    projects: [proyecto],
    archived: [],
    roots: [],
    scopes: [{ kind: 'prj', id: proyecto.id, name: proyecto.name, roots, authorized: roots }],
    libraries: [],
    sources: {
      rows: Array.from({ length: docs }, (_, index) => ({
        id: 'src_' + index,
        uri: 'C:/lab/corpus/doc-' + index + '.md',
        title: 'doc-' + index + '.md',
        mime: 'text/markdown',
        bytes: 512,
        chunks: 2,
        indexedAt: '2026-11-23T10:00:00.000Z',
      })),
      total: docs,
      nextCursor: null,
    },
    audit: { head: 0 },
  };
}

/* -------------------------------------------------------------------- pruebas */

test('estado de proyecto: el activo con raíz autorizada dice «Configurado», nunca «Listo»', async () => {
  const { panel, mod } = await mountPanel(retrato({ docs: 0 }));
  const text = panel.text();

  // La fila de «Actividad de proyectos»: estado + recuento de documentos del proyecto activo.
  assert.equal(text.includes('Configurado'), true, 'el estado del proyecto se rotula por lo que mide: ' + text);
  assert.equal(/\bListo\b/.test(text), false, '«Listo» prometía documentos y sólo hay una raíz: ' + text);
  assert.equal(text.includes('0'), true, 'el recuento de documentos es del snapshot, no una suposición');

  // El estado no depende del recuento de documentos: con documentos sigue siendo configuración.
  const { panel: conDocs } = await mountPanel(retrato({ docs: 3 }));
  assert.equal(conDocs.text().includes('Configurado'), true);
  assert.equal(/\bListo\b/.test(conDocs.text()), false);

  // Y en inglés el mismo vocabulario.
  const { panel: en } = await mountPanel(retrato({ docs: 0 }), 'en');
  assert.equal(en.text().includes('Configured'), true, 'EN: ' + en.text());
  assert.equal(/\bReady\b/.test(en.text()), false, 'EN no puede decir «Ready»: ' + en.text());

  // Sin raíz autorizada el proyecto no está configurado: es el mismo estado, otro caso.
  const { panel: sinRaiz } = await mountPanel(retrato({ docs: 0, roots: 0 }));
  assert.equal(sinRaiz.text().includes('Sin ruta'), true);
  assert.equal(sinRaiz.text().includes('Configurado'), false);

  // El valor interno del registro no se toca: sólo cambió la presentación.
  const { paInitialState, paReduce } = mod.__test;
  const state = paReduce(paInitialState(), { type: 'hydrate', snapshot: retrato({ docs: 0 }) });
  assert.equal(state.projects[0].status, 'active');
  assert.equal(state.projects[0].selectable, true);
});

test('cabecera con service: degraded y proyecto sin almacén: conecta, nombra el motivo y no habla de avería', async () => {
  const { panel, mod } = await mountPanel(retrato({ docs: 0, service: 'degraded' }));
  const text = panel.text();
  const pills = panel.pills();

  // Capa 1 y 2: la API respondió 200 y el retrato salió del registro ⇒ servicio y registro sanos.
  assert.equal(text.includes('Servicio: ok'), true, 'la conectividad con la API no se degrada: ' + text);
  assert.equal(text.includes('Conectado'), true, 'el modo de datos es real, no demo: ' + text);

  // Capa 3: lo único que falta, dicho con su nombre y sin el código crudo.
  assert.equal(text.includes('Almacén del proyecto: sin crear todavía'), true,
    'la cabecera distingue el almacén del proyecto: ' + pills.join(' | '));
  // La píldora explica en su `title` de dónde sale ese estado, para que nadie lo lea como avería.
  let storeHint = null;
  walk(panel.tree, (node) => { if (node.props && node.props.title) storeHint = node.props.title; });
  assert.equal(String(storeHint).includes('primera ingesta'), true,
    'la píldora dice cuándo nace el almacén: ' + storeHint);
  assert.equal(/\bdegraded\b|\bdegradad[oa]\b/i.test(text), false,
    'el código interno del snapshot no se pinta como si fuera el estado visible: ' + text);
  assert.equal(/aver[ií]a|fallo|error|incidencia/i.test(text), false,
    'un proyecto sin documentos no es una avería: ' + text);

  // El valor interno NO se toca: el contrato sigue diciendo `degraded`; sólo cambia la presentación.
  const { paInitialState, paReduce, paServiceReading, paTranslate } = mod.__test;
  const state = paReduce(paInitialState(), { type: 'hydrate', snapshot: retrato({ docs: 0, service: 'degraded' }) });
  assert.equal(state.session.service.status, 'degraded', 'el valor del snapshot se conserva intacto');
  const reading = paServiceReading(state, (key, vars) => paTranslate('es', key, vars));
  assert.equal(reading.label, 'ok');
  assert.equal(reading.store.label, 'sin crear todavía');

  // Y la misma lectura en inglés, sin códigos crudos en la interfaz.
  const { panel: en } = await mountPanel(retrato({ docs: 0, service: 'degraded' }), 'en');
  assert.equal(en.text().includes('Project store: not created yet'), true);
  assert.equal(/\bdegraded\b/i.test(en.text()), false);
});

test('cabecera con service: ok sigue diciendo «ok» y no inventa un almacén pendiente', async () => {
  const { panel } = await mountPanel(retrato({ docs: 2, service: 'ok' }));
  const text = panel.text();
  assert.equal(text.includes('Servicio: ok'), true, 'un servicio sano se rotula sano: ' + text);
  assert.equal(text.includes('Almacén del proyecto: ok'), true, 'y el almacén del proyecto también: ' + text);
  assert.equal(text.includes('sin crear todavía'), false, 'no se declara pendiente lo que existe');
});

test('perfil sin proyecto activo (service: ok): la cabecera no inventa capa de almacén', async () => {
  const vacio = {
    mode: 'api', service: 'ok', version: 'pa/1.6.0',
    project: null, selection: null, projects: [], archived: [], roots: [], scopes: [], libraries: [],
    sources: { rows: [], total: 0, nextCursor: null }, audit: { head: 0 },
  };
  const { panel } = await mountPanel(vacio);
  const text = panel.text();
  assert.equal(text.includes('Servicio: ok'), true);
  assert.equal(text.includes('Almacén del proyecto'), false, 'sin proyecto no hay almacén que rotular: ' + text);
});

test('vista Perfil: la tarjeta del servicio nombra el almacén pendiente, no el código crudo', () => {
  const mod = loadModule();
  const { paInitialState, paReduce, paRenderView, paTranslate } = mod.__test;
  const t = (key, vars) => paTranslate('es', key, vars);
  const state = paReduce(paInitialState(), { type: 'hydrate', snapshot: retrato({ docs: 0, service: 'degraded' }) });
  const text = textOf(paRenderView({ ...state, view: 'project' }, t, () => {}));
  assert.equal(text.includes('Almacén del proyecto'), true, 'la vista Perfil rotula la capa que falta: ' + text);
  assert.equal(text.includes('sin crear todavía'), true, 'y dice el estado de esa capa: ' + text);
  assert.equal(text.includes('nace con la primera ingesta'), true, 'y por qué no es una avería: ' + text);
  assert.equal(/degraded|aver[ií]a|error/i.test(text), false, 'sin códigos crudos ni alarmas: ' + text);
});

test('estas vistas no inventan cobertura documental: «Sin datos» y ni un porcentaje', async () => {
  for (const service of ['ok', 'degraded']) {
    const { panel } = await mountPanel(retrato({ docs: 0, service }));
    const cobertura = panel.kpi('coverage');
    assert.equal(cobertura.includes('Sin datos'), true, `cobertura sin documentos (${service}): ` + cobertura);
    assert.equal(/\d+\s?%/.test(cobertura), false, `ni 0 % ni 100 % (${service}): ` + cobertura);
    assert.equal(panel.kpi('documents'), 'Documentos indexados 0 en el proyecto activo');
    assert.equal(/\d+\s?%/.test(panel.text()), false, `ningún porcentaje en la vista (${service}): ` + panel.text());
  }
});
