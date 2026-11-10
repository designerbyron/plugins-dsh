// Distribución visible en el panel. Estas pruebas ejercen la interacción de verdad: la versión anterior
// sólo miraba el texto del botón, así que la delegación a `onImport` nunca llegaba a ocurrir y un
// cambio que la rompiera seguía pasando en verde (lo midió el auditor de pruebas).
//
// Contrato R16.4: la sección de importar NUNCA escribe al pegar o elegir un fichero. Primero valida en
// lectura (paso 1), muestra la vista previa y sólo una confirmación explícita (paso 2) crea la copia.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

const e = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
const stub = (name) => (props, ...children) => ({ type: name, props: props ?? {}, children: children.flat(Infinity) });
const t = (key, vars) => `${key}${vars ? JSON.stringify(vars) : ''}`;

/** Extrae una función de nivel superior del cliente: salta los paréntesis de los parámetros y cuenta llaves. */
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `no encuentro ${name} en client.js`);
  let open = source.indexOf('(', start);
  let parens = 0;
  for (; open < source.length; open += 1) {
    if (source[open] === '(') parens += 1;
    if (source[open] === ')') {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  let depth = 0;
  let opened = false;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') { depth += 1; opened = true; }
    if (source[index] === '}') {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`no puedo cerrar ${name}`);
}

/**
 * Monta un componente de `client.js` sin navegador: el estado vive fuera y cada `setState` vuelve a
 * pintar, que es lo que permite pulsar el botón con el texto ya escrito.
 */
function mount(name, props) {
  const factory = new Function(
    'e', 'Section', 't', 'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef',
    `${extract(name)}\nreturn ${name};`,
  );
  const hooks = [];
  let cursor = 0;
  let tree = null;
  const api = {
    useState: (initial) => {
      const index = cursor;
      cursor += 1;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (next) => {
        const value = typeof next === 'function' ? next(hooks[index]) : next;
        if (value === hooks[index]) return;
        hooks[index] = value;
        draw();
      }];
    },
    useEffect: (effect) => {
      const index = cursor;
      cursor += 1;
      if (!(index in hooks)) { hooks[index] = true; effect(); }
    },
    useCallback: (callback) => callback,
    useMemo: (create) => create(),
    useRef: (initial) => {
      const index = cursor;
      cursor += 1;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
  };
  function draw() {
    cursor = 0;
    tree = factory(e, stub('Section'), t, api.useState, api.useEffect, api.useCallback, api.useMemo, api.useRef)(props);
  }
  draw();
  return { get tree() { return tree; } };
}

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit));
  if (node === null || typeof node !== 'object') return;
  visit(node);
  (node.children ?? []).forEach((child) => walk(child, visit));
}

function findAll(tree, predicate) {
  const found = [];
  walk(tree, (node) => { if (predicate(node)) found.push(node); });
  return found;
}

function textOf(tree) {
  const parts = [];
  walk(tree, (node) => {
    for (const child of node.children ?? []) if (typeof child === 'string') parts.push(child);
  });
  return parts.join(' ');
}

function buttonWith(tree, fragment) {
  return findAll(tree, (node) => node.type === 'button')
    .find((node) => textOf(node).includes(fragment));
}

function handlerSources(tree) {
  const sources = [];
  walk(tree, (node) => {
    for (const value of Object.values(node.props ?? {})) if (typeof value === 'function') sources.push(String(value));
  });
  return sources;
}

function previewResponse() {
  return {
    ok: true,
    inspected: true,
    preview: {
      name: 'Paquete demo',
      description: 'Una skill de demo',
      version: '1.2.0',
      origin: { app: 'lifecode-skill-center', skillId: 'skill-demo', version: '1.2.0', exportedAt: '2026-11-09T10:00:00.000Z', from: 'centro-a' },
      identity: { skillId: 'skill-demo', checksum: 'sha256:abc', bytes: 1200 },
      compatibility: { schema: 'lifecode-skill-center/skill-bundle', schemaVersion: 1, supported: true, compatible: true },
      integrity: { checksum: 'ok' },
      portability: { portable: true, warnings: [] },
      conflicts: { sameId: { exists: false }, sameName: [], alreadyImported: [] },
      plan: { action: 'create', targetIdCandidate: 'skill-demo' },
      preflight: { decision: 'allow', findings: [], reasons: [] },
    },
  };
}

test('la biblioteca valida en lectura y sólo importa al confirmar', async () => {
  const calls = [];
  const view = mount('ImportSection', {
    t,
    onImport: async (bundle, options) => {
      calls.push({ bundle, options });
      if (options?.mode === 'import') {
        return { ok: true, imported: true, id: 'skill-copiada', renamed: true, renamedFrom: 'skill-demo', warnings: [] };
      }
      return previewResponse();
    },
  });

  assert.match(textOf(view.tree), /portability\.import/, 'nombra la acción de importar');
  assert.ok(!handlerSources(view.tree).some((handler) => handler.includes('act(')), 'no habla con la API: delega en onImport');

  const validate = buttonWith(view.tree, 'portability.validate');
  assert.ok(validate, 'hay un botón de validar');
  assert.equal(validate.props.disabled, true, 'sin paquete no se puede validar');

  const [area] = findAll(view.tree, (node) => node.type === 'textarea');
  area.props.onChange({ target: { value: '{"schema":"lifecode-skill-center/skill-bundle"}' } });

  const enabled = buttonWith(view.tree, 'portability.validate');
  assert.equal(enabled.props.disabled, false, 'con un paquete el botón se habilita');
  await enabled.props.onClick();

  assert.equal(calls.length, 1, 'validar es la primera llamada');
  assert.deepEqual(calls[0], { bundle: '{"schema":"lifecode-skill-center/skill-bundle"}', options: undefined }, 'el paquete viaja a onImport y validar no confirma nada');
  const preview = textOf(view.tree);
  assert.match(preview, /Paquete demo/u, 'se ve la vista previa');
  assert.match(preview, /portability\.status\.valid/u, 'con su estado válido');
  assert.doesNotMatch(preview, /portability\.done\.id/u, 'validar no inventa una importación');

  const confirm = buttonWith(view.tree, 'portability.confirm');
  assert.ok(confirm, 'hay confirmación explícita');
  await confirm.props.onClick();

  assert.equal(calls.length, 2, 'confirmar es una segunda llamada');
  assert.deepEqual(calls[1].options, { mode: 'import', confirmed: true }, 'la confirmación es explícita');
  const done = textOf(view.tree);
  assert.match(done, /portability\.done\.id/u, 'la persona ve que quedó importada');
  assert.match(done, /skill-copiada/u, 'el aviso nombra la skill importada');
  assert.match(done, /portability\.done\.renamed/u, 'y el renombrado cuando lo hubo');
  assert.match(done, /portability\.done\.open/u, 'y el enlace a la Biblioteca');
});

test('el panel cablea las dos acciones de distribución por su API', () => {
  assert.ok(source.includes("act('export-skill'"), 'exportar va por la acción del panel');
  assert.match(source, /act\(\s*'import-bundle'/u, 'importar va por la acción del panel');
  assert.ok(source.includes("'drawer.export.done'"), 'exportar dice dónde quedó el paquete');
  assert.ok(source.includes("'library.import.renamed'"), 'importar avisa cuando renombra por id ocupado');
  assert.ok(!/fetch\([^)]*export-skill/u.test(source), 'la interfaz no llama a la ruta a mano: usa act');
  assert.ok(!/function ImportSection[\s\S]{0,1600}?act\(/.test(source), 'la sección de importar no habla con la API');
});
