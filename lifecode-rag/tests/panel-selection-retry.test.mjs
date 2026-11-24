/**
 * F-1 y F-2 (1.5.11) sobre el PANEL MONTADO (hooks, reducer y vista reales; `fetch` doble).
 *
 * F-1 — «varios proyectos activos y ninguno seleccionado» dejaba el panel en «Servicio: Sin conexión»
 *       con «No se pudo mostrar esta vista · scope-ambiguous». El servicio estaba perfectamente: lo
 *       que faltaba era una decisión. Ahora el retrato llega con `needsProjectSelection: true` y el
 *       panel ofrece el selector; la elección sigue pasando por `POST /selection` con CAS.
 *
 * F-2 — «Reintentar» sólo incrementaba `viewEpoch`, que nadie consumía: la vista no se recuperaba
 *       hasta recargar la aplicación. Aquí se mide la secuencia completa (fallo → error → reintento
 *       → petición nueva → datos), que dos clics seguidos no dupliquen la petición, y que un fallo
 *       persistente vuelva a dejar el botón vivo.
 *
 * El arnés respeta las DEPENDENCIAS de `useEffect` (el de `panel-states` no las mira): sin eso, el
 * efecto de arranque se volvería a disparar en cada pasada y el reintento parecería funcionar por el
 * motivo equivocado.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const clientSource = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8');

let runtime = null;

const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity) };
  },
  useState(initial) { return runtime.useState(initial); },
  useRef(initial) { return runtime.useRef(initial); },
  useMemo(fn) { runtime.hook(); return fn(); },
  useCallback(fn) { runtime.hook(); return fn; },
  useEffect(fn, deps) { runtime.useEffect(fn, deps); return undefined; },
};

const fakeDocument = () => ({ head: { appendChild() {} }, createElement: () => ({ id: '', textContent: '', remove() {} }) });

function loadModule({ fetch: fetchImpl } = {}) {
  let definition = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => { definition = def; } } },
    console,
    document: fakeDocument(),
    fetch: fetchImpl ?? (async () => { throw new Error('fetch inesperado'); }),
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
  walk(node, (hit) => { if (hit.text !== undefined) text += ' ' + hit.text; });
  return text.replace(/\s+/g, ' ').trim();
}

/** Monta el componente con hooks ordenados y dependencias de efecto respetadas. */
function mount(component, props) {
  const cells = [];
  const seenDeps = new Map();
  let index = 0;
  let queued = [];
  let tree = null;

  runtime = {
    hook() { index += 1; },
    useState(initial) {
      const slot = index;
      index += 1;
      if (!(slot in cells)) cells[slot] = typeof initial === 'function' ? initial() : initial;
      return [cells[slot], (next) => {
        cells[slot] = typeof next === 'function' ? next(cells[slot]) : next;
        render();
      }];
    },
    useRef(initial) {
      const slot = index;
      index += 1;
      if (!(slot in cells)) cells[slot] = { current: initial };
      return cells[slot];
    },
    useEffect(fn, deps) {
      const slot = index;
      index += 1;
      const first = !seenDeps.has(slot);
      const same = !first && Array.isArray(deps) && Array.isArray(seenDeps.get(slot))
        && deps.length === seenDeps.get(slot).length
        && deps.every((value, at) => Object.is(value, seenDeps.get(slot)[at]));
      if (first || !same) {
        seenDeps.set(slot, Array.isArray(deps) ? deps.slice() : null);
        queued.push(fn);
      }
    },
  };

  function render() {
    index = 0;
    // La cola de efectos NO se vacía aquí: React ejecuta los efectos después del commit, y un segundo
    // render (p. ej. otro clic) no puede tirar el efecto que estaba pendiente de correr.
    tree = component(props);
  }
  render();

  return {
    get tree() { return tree; },
    runEffects() { const run = queued; queued = []; for (const effect of run) effect(); },
    text() { return textOf(tree); },
    pills() {
      const found = [];
      walk(tree, (node) => { if (node.props && node.props.className === 'lcr-pa-status__item') found.push(textOf(node)); });
      return found;
    },
    /** Todos los nodos que llevan una prop concreta (para pulsar por atributo, no por texto). */
    withProp(name) {
      const found = [];
      walk(tree, (node) => { if (node.props && Object.prototype.hasOwnProperty.call(node.props, name)) found.push(node); });
      return found;
    },
    click(node) {
      assert.equal(typeof node.props.onClick, 'function', 'el nodo debe ser pulsable');
      node.props.onClick({ preventDefault() {} });
    },
  };
}

async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Ejecuta los efectos que toque y deja que sus promesas se resuelvan. */
async function flush(panel, passes = 5) {
  for (let i = 0; i < passes; i += 1) {
    panel.runEffects();
    await settle();
  }
}

function ok(snapshot) {
  const body = JSON.stringify({ ok: true, data: snapshot });
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}
function fail(code = 'transport-error', status = 0) {
  const error = new Error('fallo de transporte');
  error.code = code;
  error.status = status;
  error.__isThrow = true;
  return error;
}

/* ───────────────────────────── retratos ───────────────────────────── */

function proyecto(id, name, { current = false, roots = 1 } = {}) {
  return { id, name, status: 'active', roots, total: roots, current, selectable: roots > 0, docs: null };
}

/** F-1: dos proyectos activos, ninguna selección. Es lo que ahora devuelve `/snapshot`. */
function retratoAmbiguo(ids = ['prj_uno', 'prj_dos']) {
  const rows = ids.map((id, at) => proyecto(id, 'Proyecto ' + (at + 1)));
  return {
    mode: 'api',
    service: 'ok',
    asOf: 1763856000000,
    version: 'pa/1.5.0',
    project: null,
    needsProjectSelection: true,
    needsProjectSelectionReason: 'scope-ambiguous',
    candidates: rows.map((row) => ({ id: row.id, name: row.name })),
    selection: null,
    projects: rows,
    archived: [],
    roots: [],
    scopes: [],
    libraries: [],
    sources: { rows: [], total: 0, nextCursor: null },
    audit: { head: 0 },
  };
}

/** Retrato normal de un proyecto concreto (lo que llega después de elegir). */
function retratoDe(id, name) {
  return {
    mode: 'api',
    service: 'ok',
    asOf: 1763856000000,
    version: 'pa/1.5.0',
    project: { id, name },
    needsProjectSelection: false,
    selection: { projectId: id, projectName: name, revision: 1, source: 'explicit', selectedBy: 'human', selectedAt: 1763850000000 },
    projects: [proyecto(id, name, { current: true })],
    archived: [],
    roots: [{ scopeId: id, id: 'rt_uno', path: 'C:/lab/fixtures', state: 'authorized' }],
    scopes: [{ kind: 'prj', id, name, roots: 1, authorized: 1 }],
    libraries: [],
    sources: { rows: [], total: 0, nextCursor: null },
    audit: { head: 1 },
  };
}

/* ───────────────────────────── pruebas F-1 ───────────────────────────── */

test('F-1: varios proyectos sin selección → selector visible y NUNCA «sin conexión»', async () => {
  const mod = loadModule({ fetch: async () => ok(retratoAmbiguo()) });
  const { PaPanel, paTranslate } = mod.__test;
  const panel = mount(PaPanel, { t: (key, vars) => paTranslate('es', key, vars) });
  await flush(panel);

  const text = panel.text();
  assert.match(text, /Elige un proyecto/, 'pide la decisión: ' + text);
  assert.doesNotMatch(text, /Sin conexión/, 'la API está sana; no se puede decir que no hay conexión');
  assert.doesNotMatch(text, /No se pudo mostrar esta vista/, 'tampoco es un error de vista');
  const selectors = panel.withProp('data-select-project');
  assert.equal(selectors.length, 2, 'un botón por proyecto activo');
  assert.deepEqual(panel.pills(), ['Servicio: ok', 'Conectado'], 'las capas honestas de la cabecera');
});

test('F-1: elegir proyecto envía POST /selection con CAS y luego hidrata el proyecto elegido', async () => {
  const calls = [];
  const mod = loadModule({
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      calls.push({ url: String(url), method, body: options.body ? JSON.parse(options.body) : null });
      if (method === 'POST' && String(url).endsWith('/selection')) {
        return ok({ selection: { projectId: 'prj_dos', projectName: 'Proyecto 2', revision: 1, source: 'explicit', selectedBy: 'human', selectedAt: 1763850000000 }, changed: true });
      }
      if (String(url).includes('/snapshot')) {
        // Antes de elegir: ambiguo. Después: el proyecto elegido.
        const after = calls.some((call) => call.method === 'POST' && call.url.endsWith('/selection'));
        return ok(after ? retratoDe('prj_dos', 'Proyecto 2') : retratoAmbiguo());
      }
      throw new Error('ruta inesperada: ' + url);
    },
  });
  const { PaPanel, paTranslate } = mod.__test;
  const panel = mount(PaPanel, { t: (key, vars) => paTranslate('es', key, vars) });
  await flush(panel);
  assert.equal(panel.withProp('data-select-project').length, 2);

  const boton = panel.withProp('data-select-project').find((node) => node.props['data-select-project'] === 'prj_dos');
  assert.ok(boton, 'existe el botón del segundo proyecto');
  panel.click(boton);
  await flush(panel);

  const selection = calls.find((call) => call.method === 'POST' && call.url.endsWith('/selection'));
  assert.ok(selection, 'la elección se escribe en el servidor, no se adelanta en el cliente');
  assert.deepEqual(selection.body, { projectId: 'prj_dos', expectedRevision: 0 },
    'sin selección previa la revisión esperada es 0 (CAS de creación)');

  const text = panel.text();
  assert.doesNotMatch(text, /Elige un proyecto/, 'el selector desaparece al resolverse');
  assert.match(text, /Proyecto 2/, 'se pinta el proyecto confirmado por el servidor');
});

/* ───────────────────────────── pruebas F-2 ───────────────────────────── */

test('F-2: fallo → error con su motivo → «Reintentar» hace una petición NUEVA y recupera los datos', async () => {
  let attempt = 0;
  const calls = [];
  const mod = loadModule({
    fetch: async (url) => {
      calls.push(String(url));
      attempt += 1;
      if (attempt === 1) throw fail('transport-error');
      return ok(retratoDe('prj_uno', 'Proyecto 1'));
    },
  });
  const { PaPanel, paTranslate } = mod.__test;
  const panel = mount(PaPanel, { t: (key, vars) => paTranslate('es', key, vars) });
  await flush(panel);

  assert.match(panel.text(), /No se pudo mostrar esta vista/, 'el fallo se declara');
  const retry = panel.withProp('data-retry-view')[0];
  assert.ok(retry, 'hay botón de reintento');
  assert.equal(retry.props.disabled, false, 'el botón está vivo tras el fallo');

  const before = calls.length;
  panel.click(retry);
  await flush(panel);

  assert.ok(calls.length > before, 'el reintento hace una petición de verdad: ' + calls.slice(before).join(', '));
  const text = panel.text();
  assert.doesNotMatch(text, /No se pudo mostrar esta vista/, 'la vista se recupera');
  assert.match(text, /Proyecto 1/, 'y muestra los datos reales');
  assert.equal(panel.pills()[0], 'Servicio: ok');
});

test('F-2: dos clics seguidos no lanzan dos peticiones', async () => {
  let attempt = 0;
  const calls = [];
  const mod = loadModule({
    fetch: async (url) => {
      calls.push(String(url));
      attempt += 1;
      if (attempt === 1) throw fail('transport-error');
      return ok(retratoDe('prj_uno', 'Proyecto 1'));
    },
  });
  const { PaPanel, paTranslate } = mod.__test;
  const panel = mount(PaPanel, { t: (key, vars) => paTranslate('es', key, vars) });
  await flush(panel);
  const retry = panel.withProp('data-retry-view')[0];
  const before = calls.length;

  panel.click(retry);
  // Segundo clic antes de que llegue la respuesta: el estado ya tiene una petición en vuelo.
  const retry2 = panel.withProp('data-retry-view')[0];
  if (retry2) panel.click(retry2);
  await flush(panel);

  assert.equal(calls.length - before, 2, 'una negociación + un snapshot, no cuatro llamadas: ' + calls.slice(before).join(', '));
});

test('F-2: fallo persistente deja el error real y el botón vuelve a estar disponible', async () => {
  const calls = [];
  const mod = loadModule({
    fetch: async (url) => { calls.push(String(url)); throw fail('registry-unavailable', 503); },
  });
  const { PaPanel, paTranslate } = mod.__test;
  const panel = mount(PaPanel, { t: (key, vars) => paTranslate('es', key, vars) });
  await flush(panel);
  assert.match(panel.text(), /registry-unavailable/, 'se muestra el motivo REAL, no un texto genérico');

  const retry = panel.withProp('data-retry-view')[0];
  panel.click(retry);
  await flush(panel);

  assert.match(panel.text(), /registry-unavailable/, 'sigue fallando y lo dice');
  const retryAgain = panel.withProp('data-retry-view')[0];
  assert.ok(retryAgain, 'el botón sigue ahí');
  assert.equal(retryAgain.props.disabled, false, 'y no se queda muerto tras el segundo fallo');
  assert.equal(panel.withProp('data-retry-view').length, 1, 'no se acumulan botones de reintento');
});

/* ───────────────────────────── pruebas F-3 ───────────────────────────── */

test('F-3: el enlace-acción declara área de 36 px en escritorio y 44 px en móvil, sin partir el texto', () => {
  const mod = loadModule({ fetch: async () => ok(retratoDe('prj_uno', 'Proyecto 1')) });
  const { CSS_PA } = mod.__test;

  const base = CSS_PA.slice(CSS_PA.indexOf('.lcr-pa-link {'), CSS_PA.indexOf('.lcr-pa-link:hover'));
  assert.match(base, /min-height:\s*36px/, 'escritorio: alto mínimo 36 px (WCAG 2.5.8 pide 24)');
  assert.match(base, /min-width:\s*36px/, 'escritorio: ancho mínimo 36 px');
  assert.match(base, /display:\s*inline-flex/, 'el área crece sin romper el flujo del texto');
  assert.match(base, /white-space:\s*nowrap/, 'la etiqueta no se parte en dos líneas');
  assert.match(base, /padding:\s*8px 10px/, 'el área se gana con espacio propio, no con font-size');

  const mobileAt = CSS_PA.indexOf('@media (max-width: 760px)');
  const mobile = CSS_PA.slice(mobileAt);
  assert.match(mobile, /\.lcr-pa-link\s*\{[^}]*min-height:\s*44px/, 'móvil: 44 px de alto');
  assert.match(mobile, /\.lcr-pa-link\s*\{[^}]*min-width:\s*44px/, 'móvil: 44 px de ancho');
  assert.match(CSS_PA, /\.lcr-pa-link:focus-visible\s*\{[^}]*outline:/, 'el foco sigue siendo visible');
  assert.equal(/\boutline:\s*none/.test(base), false, 'y no se anula en la regla base');
  // El área táctil ensancha la columna de acciones: en móvil se compensa con relleno de celda, no
  // recortando el objetivo. Sin esto la tabla de actividad desbordaba 15 px a 390 (medido en el Host).
  assert.match(mobile, /\.lcr-pa-table th, \.lcr-pa-table td\s*\{[^}]*padding-left:\s*6px/,
    'en móvil las celdas recortan relleno horizontal para que la tabla siga entrando');
});
