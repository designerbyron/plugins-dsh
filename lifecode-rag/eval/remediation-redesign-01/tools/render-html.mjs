/**
 * Render estático del panel Project-Aware para capturas de evidencia.
 *
 * Carga `client.js` en un VM con un runtime de hooks mínimo (el mismo enfoque que
 * `tests/client.test.mjs`), monta el panel, lo lleva al estado de cada vista y serializa el árbol a
 * HTML con la hoja de estilos del propio módulo. No abre el host, no toca el almacén y no usa red.
 *
 * Uso: node eval/remediation-redesign-01/tools/render-html.mjs <directorio-salida>
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = fileURLToPath(new URL('..', import.meta.url));
const clientPath = join(here, '..', '..', 'client.js');
const source = readFileSync(clientPath, 'utf8');
const outDir = resolve(process.argv[2] ?? join(here, 'preview'));

/* ------------------------------------------------------------- runtime mínimo */

const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity) };
  },
  useState(initial) { return runtime.useState(initial); },
  useRef(initial) { return runtime.useRef(initial); },
  useMemo(fn) { runtime.hook(); return fn(); },
  useCallback(fn) { runtime.hook(); return fn; },
  useEffect(fn) { runtime.hook(); return undefined; },
};

let runtime = null;

function loadModule() {
  let definition = null;
  const styleSink = { id: null, textContent: '' };
  const fakeDocument = {
    head: { appendChild: () => {} },
    createElement: () => styleSink,
  };
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => { definition = def; } } },
    console,
    document: fakeDocument,
    fetch: () => { throw new Error('fetch prohibido'); },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  const mod = definition.factory((name) => {
    if (name === 'react') return ReactStub;
    throw new Error('require inesperado: ' + name);
  });
  return { mod, styleSink };
}

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return textOf(node.children);
}

function* walk(node) {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
  if (typeof node !== 'object') return;
  yield node;
  yield* walk(node.children);
}

function mountPanel(mod) {
  const cells = [];
  let index = 0;
  let tree = null;
  runtime = {
    hook() { index += 1; },
    useState(initial) {
      const slot = index;
      index += 1;
      if (!(slot in cells)) cells[slot] = typeof initial === 'function' ? initial() : initial;
      return [cells[slot], (next) => {
        cells[slot] = typeof next === 'function' ? next(cells[slot]) : next;
        draw();
      }];
    },
    useRef(initial) {
      const slot = index;
      index += 1;
      if (!(slot in cells)) cells[slot] = { current: initial };
      return cells[slot];
    },
  };
  function draw() {
    index = 0;
    tree = mod.__test.PaPanel({});
  }
  draw();
  return {
    get tree() { return tree; },
    find(predicate) {
      for (const node of walk(tree)) if (node.type && predicate(node)) return node;
      return null;
    },
    click(element) {
      if (!element) throw new Error('elemento no encontrado');
      if (typeof element.props.onClick !== 'function') throw new Error('sin onClick: ' + element.type);
      element.props.onClick();
    },
    change(element, value) {
      if (!element) throw new Error('campo no encontrado');
      element.props.onChange({ target: { value } });
    },
    button(label) { return this.find((node) => node.type === 'button' && textOf(node) === label); },
    tab(label) { return this.find((node) => node.props.role === 'tab' && textOf(node) === label); },
  };
}

/* ------------------------------------------------------------- serializador */

const VOID_TAGS = new Set(['input', 'br', 'hr', 'img']);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attributes(props, extra = {}) {
  const out = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === 'key' || key === 'children' || key === 'onClick' || key === 'onChange') continue;
    const name = key === 'className' ? 'class' : key === 'htmlFor' ? 'for' : key;
    if (name === 'value' && extra.skipValue) continue;
    if (name === 'value') { out.push('value="' + escapeHtml(value) + '"'); continue; }
    if (value === null || value === undefined || value === false) continue;
    if (value === true) { out.push(name); continue; }
    out.push(name + '="' + escapeHtml(value) + '"');
  }
  return out.length ? ' ' + out.join(' ') : '';
}

function serialize(node, selectedValue) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (Array.isArray(node)) return node.map((child) => serialize(child, selectedValue)).join('');
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
  if (typeof node !== 'object' || !node.type) return '';
  const tag = node.type;
  const props = node.props ?? {};
  if (tag === 'input') {
    return '<input' + attributes({ ...props, value: undefined }, { skipValue: true })
      + (props.value === undefined ? '' : ' value="' + escapeHtml(props.value) + '"') + '>';
  }
  if (tag === 'option') {
    const selected = selectedValue !== undefined && String(props.value) === String(selectedValue);
    return '<option' + attributes(props, { skipValue: true }) + (selected ? ' selected' : '') + '>'
      + serialize(node.children) + '</option>';
  }
  if (VOID_TAGS.has(tag)) return '<' + tag + attributes(props) + '>';
  const childSelected = tag === 'select' ? props.value : undefined;
  return '<' + tag + attributes(props) + '>' + serialize(node.children, childSelected) + '</' + tag + '>';
}

/* ------------------------------------------------------------- vistas */

const { mod, styleSink } = loadModule();
const t = (key, vars) => mod.__test.paTranslate('es', key, vars);
const CSS = mod.__test.CSS + mod.__test.CSS_PA;
void styleSink;

const scenarios = [
  { file: 'project', label: 'Proyecto', steps: [] },
  { file: 'libraries', label: 'Bibliotecas', steps: [] },
  { file: 'sources', label: 'Fuentes', steps: [] },
  { file: 'source', label: 'Fuentes', steps: [(panel) => panel.click(panel.button('Abrir'))] },
  { file: 'search', label: 'Búsqueda', steps: [(panel) => {
    panel.change(panel.find((node) => node.props['data-field'] === 'query'), 'normativa');
    panel.click(panel.button('Buscar'));
  }] },
  { file: 'context', label: 'Búsqueda', steps: [(panel) => {
    panel.change(panel.find((node) => node.props['data-field'] === 'query'), 'normativa');
    panel.click(panel.button('Buscar'));
    panel.click(panel.button('Construir contexto con estos resultados'));
  }] },
  { file: 'operations', label: 'Operaciones', steps: [(panel) => {
    panel.click(panel.button('Ingesta simulada'));
  }] },
  { file: 'diagnostics', label: 'Diagnóstico', steps: [] },
  { file: 'connection', label: 'Conexión', steps: [] },
  { file: 'history', label: 'Historial', steps: [] },
];

mkdirSync(outDir, { recursive: true });
const written = [];

for (const scenario of scenarios) {
  const panel = mountPanel(mod);
  if (scenario.label !== 'Proyecto') panel.click(panel.tab(scenario.label));
  for (const step of scenario.steps) step(panel);
  const body = serialize(panel.tree);
  const html = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>LifeCode RAG · ' + scenario.file + '</title>\n'
    + '<style>html, body { margin: 0; padding: 0; background: #17181c; } '
    + '#app { min-height: 100vh; }\n' + CSS + '</style>\n</head>\n<body>\n<div id="app">'
    + body + '</div>\n</body>\n</html>\n';
  const target = join(outDir, scenario.file + '.html');
  writeFileSync(target, html, 'utf8');
  written.push({ file: scenario.file + '.html', bytes: Buffer.byteLength(html) });
}

console.log(JSON.stringify({ outDir, views: written.length, written }, null, 2));
