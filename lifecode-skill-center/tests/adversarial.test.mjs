/**
 * Disciplina adversarial del centro.
 *
 * Esta suite no comprueba «que hay pruebas»: comprueba que las pruebas del proyecto pueden fallar,
 * que miden conducta y no texto fuente, que no se acoplan a nombres internos y que no se tragan un
 * error inesperado. Las doce preguntas del test-of-tests están numeradas P01..P12 para que
 * `tools/adversarial.mjs` pueda leer el resultado sin interpretar el TAP a mano.
 *
 * Todo se ejecuta sobre `mkdtemp`; el almacén real no se lee ni se escribe.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

import { summarize } from '../lib/analytics.mjs';
import { buildSnapshot, runAction } from '../lib/api.mjs';
import { evaluateSkill } from '../lib/evaluate.mjs';
import { compareVersions, isSafeId } from '../lib/format.mjs';
import {
  createSkill,
  ensureProject,
  publishVersion,
  rollbackAssignment,
  toggleAssignment,
} from '../lib/operations.mjs';
import { defaultRoot, emptyState, loadState } from '../lib/state.mjs';
import { candidate, tempProject, tempRoot, autonomyRoot } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CLIENT_PATH = join(ROOT, 'client.js');
const SELF_PATH = fileURLToPath(import.meta.url);
const NOW = '2026-11-09T09:00:00.000Z';
const SEED = 0xc0ffee;

/* ------------------------------------------------------------------ utilidades */

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Huella de contenido **y** de mtime: una reescritura con el mismo texto también cuenta. */
function digestTree(root) {
  const hash = createHash('sha256');
  function walk(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const full = join(directory, entry.name);
      const key = relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        hash.update(`D:${key}\n`);
        walk(full);
      } else {
        const stat = statSync(full);
        hash.update(`F:${key}:${stat.size}:${stat.mtimeMs}\n`);
        hash.update(readFileSync(full));
      }
    }
  }
  walk(root);
  return hash.digest('hex');
}

/** PRNG determinista (mulberry32). La misma semilla reproduce exactamente la misma campaña. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function integer(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function isoAt(offsetMinutes) {
  return new Date(Date.parse(NOW) + offsetMinutes * 60_000).toISOString();
}

/**
 * Acepta sólo la negativa esperada. Un `code` distinto se relanza: es el defecto D7, donde un
 * `catch` total convertía cualquier excepción en el resultado que la prueba quería ver.
 */
function assertRefusal(result, expectedCode) {
  assert.equal(result?.ok, false, `se esperaba una negativa ${expectedCode}, llegó ${JSON.stringify(result)}`);
  assert.equal(result.code, expectedCode, `se esperaba el código ${expectedCode}, llegó ${result.code}`);
}

function onlyExpected(fn, expectedCode) {
  try {
    return fn();
  } catch (error) {
    if (error?.code !== expectedCode) {
      throw new Error(`error inesperado (${error?.code ?? 'sin code'}): ${error?.message ?? error}`, { cause: error });
    }
    return { ok: false, code: expectedCode };
  }
}

/** Escribe un test temporal y lo ejecuta en un proceso hijo; devuelve su salida real. */
function runNodeTest(source) {
  const directory = autonomyRoot('lsc-meta');
  const file = join(directory, 'meta.test.mjs');
  writeFileSync(file, source, 'utf8');
  const env = { ...process.env, LIFECODE_SKILL_CENTER_ROOT: directory };
  // El runner marca a sus hijos con `NODE_TEST_CONTEXT`; si el nieto lo hereda, Node cree que ya está
  // dentro de otro archivo de prueba y se salta el suyo (exit 0 aunque la aserción sea falsa). Esa
  // variable es la que convertía la meta-prueba en un falso verde.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', file], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', file };
}

/* --------------------------------------------------------------- cliente y DOM */

class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parent = null;
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.attributes = {};
    this.style = {};
  }

  appendChild(child) {
    if (child.parent !== null) child.parent.removeChild(child);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
  }

  remove() {
    if (this.parent !== null) this.parent.removeChild(this);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
}

function createDocument() {
  const head = new FakeNode('head');
  const body = new FakeNode('body');
  const document = {
    head,
    body,
    documentElement: new FakeNode('html'),
    visibilityState: 'visible',
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    getElementById(id) {
      const visit = (node) => {
        if (node.id === id) return node;
        for (const child of node.children) {
          const found = visit(child);
          if (found !== null) return found;
        }
        return null;
      };
      return visit(head) ?? visit(body);
    },
    querySelector: () => null,
  };
  return document;
}

function createHookRuntime() {
  const cells = [];
  let cursor = 0;
  let dirty = false;
  let pending = [];

  const same = (left, right) => Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));

  const React = {
    Fragment: Symbol.for('lsc.fragment'),
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) };
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return { type, props: merged, children };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial;
      const set = (next) => {
        const value = typeof next === 'function' ? next(cells[index]) : next;
        if (Object.is(value, cells[index])) return;
        cells[index] = value;
        dirty = true;
      };
      return [cells[index], set];
    },
    useMemo(fn, deps) {
      const index = cursor++;
      const cell = cells[index];
      if (cell !== undefined && same(cell.deps, deps)) return cell.value;
      const value = fn();
      cells[index] = { deps, value };
      return value;
    },
    useCallback(fn, deps) {
      return React.useMemo(() => fn, deps);
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = { current: initial };
      return cells[index];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const cell = cells[index];
      if (cell !== undefined && same(cell.deps, deps)) return;
      pending.push({ index, fn, deps, previous: cell?.cleanup });
    },
  };

  function begin() {
    cursor = 0;
    pending = [];
    // `dirty` describe lo que pidió el render anterior; al empezar uno nuevo se consume. Sin esto,
    // un `setState` de montaje deja la bandera encendida para siempre y `settle` nunca termina.
    dirty = false;
  }

  function end() {
    const effects = pending;
    pending = [];
    for (const effect of effects) {
      if (typeof effect.previous === 'function') effect.previous();
      const cleanup = effect.fn();
      cells[effect.index] = { deps: effect.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
    }
  }

  return {
    React,
    begin,
    end,
    render(component, props) {
      begin();
      try {
        return component(props);
      } finally {
        end();
      }
    },
    isDirty: () => dirty,
    reset() {
      cells.length = 0;
      cursor = 0;
      pending = [];
      dirty = false;
    },
  };
}

function snapshotFixture(cwd) {
  return {
    ok: true,
    apiVersion: '1',
    generatedAt: NOW,
    root: 'C:/lsc-fixture',
    storePath: 'C:/lsc-fixture/center.json',
    storeExists: true,
    storeError: '',
    readable: true,
    schemaVersion: 2,
    schemaMeta: { ok: true, supported: true, message: '' },
    integrity: { ok: true, message: '', checkedAt: NOW },
    identity: null,
    backup: null,
    migration: { canMigrate: false, message: '' },
    counts: { skills: 0, versions: 0, projects: 1, assignments: 0, improvements: 0, events: 0 },
    skills: [],
    projects: [{ id: 'fixture', name: 'fixture', cwd }],
    improvements: [],
    events: [],
    assignments: {},
    project: { id: 'fixture', name: 'fixture', cwd, createdAt: NOW, updatedAt: NOW, note: '', registered: true },
    external: { candidates: [] },
    analytics: { series: [], topSkills: [] },
    knowledge: { policies: {} },
  };
}

/** Carga `client.js` con el runtime mínimo y devuelve el módulo más lo que registró. */
function loadClient(source) {
  const document = createDocument();
  const hooks = createHookRuntime();
  const cleanups = [];
  const registrations = [];
  const injections = [];
  let captured = null;

  const window = {
    __ModuleLoader__: { load: (module) => { captured = module; } },
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    location: { href: 'http://127.0.0.1/' },
  };

  const fetch = async (url) => {
    const body = /\/state(?:\?|$)/.test(String(url)) ? snapshotFixture('C:/tmp/lsc-fixture') : { ok: true };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  };

  const sandbox = {
    window,
    document,
    console,
    fetch,
    // El panel agenda un sondeo cada 20 s y un toast a 4.2 s. En el arnés no deben existir: si se
    // usan los reales, el proceso de `node --test` se queda vivo después de la última aserción.
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    URL,
    URLSearchParams,
    AbortController,
    navigator: { language: 'es' },
    require: (name) => {
      if (name === 'react') return hooks.React;
      throw new Error(`require inesperado: ${name}`);
    },
  };

  vm.runInNewContext(source, sandbox, { filename: CLIENT_PATH, timeout: 10_000 });
  assert.notEqual(captured, null, 'client.js tiene que llamarse por window.__ModuleLoader__.load');
  const module_ = captured.factory(sandbox.require);

  const ctx = {
    effect(fn) {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
      return () => {};
    },
    locale: {
      register: () => () => {},
      getSnapshot: () => ({ locale: 'es' }),
      getLocale: () => 'es',
      subscribe: () => () => {},
    },
    slots: {
      inject(owner, callback) {
        injections.push(owner);
        return callback();
      },
      register(options, component) {
        registrations.push({ options, component });
        return { dispose: () => {} };
      },
    },
  };
  module_.apply(ctx);
  return { module: module_, document, hooks, cleanups, registrations, injections };
}

async function settle(runtime, renderOnce) {
  for (let round = 0; round < 25; round += 1) {
    await new Promise((resolveTick) => setImmediate(resolveTick));
    if (!runtime.isDirty()) return;
    renderOnce();
  }
  throw new Error('el panel no se asentó: sigue habiendo estado pendiente tras 25 vueltas');
}

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && node.props) return textOf(node.props.children);
  return '';
}

function findNode(node, predicate) {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof node !== 'object' || node.type === undefined) return null;
  if (predicate(node)) return node;
  return findNode(node.props?.children, predicate);
}

/** Monta el panel, espera el retrato, navega a Biblioteca y devuelve las props reales de la vista. */
async function renderLibrary(source = readFileSync(CLIENT_PATH, 'utf8')) {
  const loaded = loadClient(source);
  const registration = loaded.registrations.find((entry) => entry.options?.key === 'lifecode-skill-center');
  assert.ok(registration, 'el panel tiene que registrarse en el slot principal');
  const Panel = registration.component;

  let tree = loaded.hooks.render(Panel, {});
  await settle(loaded.hooks, () => { tree = loaded.hooks.render(Panel, {}); });

  const nav = findNode(tree, (node) => node.type === 'button' && textOf(node).includes('Biblioteca'));
  assert.ok(nav, 'la barra lateral tiene que ofrecer la vista Biblioteca');
  nav.props.onClick();
  await settle(loaded.hooks, () => { tree = loaded.hooks.render(Panel, {}); });

  const view = findNode(tree, (node) => typeof node.type === 'function'
    && node.props !== undefined
    && Object.prototype.hasOwnProperty.call(node.props, 'onNew'));
  assert.ok(view, 'la vista Biblioteca tiene que estar montada en el árbol del panel');
  return { ...loaded, view, tree };
}

/* ----------------------------------------------------------------- las preguntas */

test('P01 ¿la prueba puede fallar? Un hijo con una aserción falsa sale 1', () => {
  const operations = pathToFileURL(join(ROOT, 'lib', 'operations.mjs')).href;
  const stateModule = pathToFileURL(join(ROOT, 'lib', 'state.mjs')).href;
  const helpers = pathToFileURL(join(HERE, 'helpers.mjs')).href;
  const source = [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    `import { createSkill } from ${JSON.stringify(operations)};`,
    `import { emptyState } from ${JSON.stringify(stateModule)};`,
    `import { candidate } from ${JSON.stringify(helpers)};`,
    "test('falla a proposito', () => {",
    `  const state = emptyState(${JSON.stringify(NOW)});`,
    `  createSkill(state, candidate({ id: 'adv-can-fail' }), { now: ${JSON.stringify(NOW)} });`,
    "  assert.equal(state.skills['adv-can-fail'].currentVersion, '9.9.9');",
    '});',
  ].join('\n');
  const result = runNodeTest(source);
  assert.equal(result.status, 1, `el hijo debía fallar, salió ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout + result.stderr, /falla a proposito/, 'el fallo tiene que ser la aserción del hijo, no un error de carga');
});

test('P02 ¿mide conducta o implementación? El estilo se monta y se retira de verdad', () => {
  const loaded = loadClient(readFileSync(CLIENT_PATH, 'utf8'));
  assert.notEqual(loaded.document.getElementById('lsc-styles'), null, 'el estilo tiene que estar en el DOM tras aplicar');
  for (const cleanup of loaded.cleanups) cleanup();
  assert.equal(loaded.document.getElementById('lsc-styles'), null, 'el cleanup tiene que retirar el estilo del DOM');
});

test('P03 ¿tiene un caso negativo? Duplicar y publicar como IA se rechazan con su código', () => {
  const state = emptyState(NOW);
  const skill = candidate({ id: 'adv-negativo' });
  assert.equal(createSkill(state, skill, { now: NOW }).ok, true);
  assertRefusal(createSkill(state, skill, { now: NOW }), 'exists');
  assertRefusal(
    publishVersion(state, 'adv-negativo', { body: `${skill.body}\n\n## Otra sección\n\nCambio.` }, { now: NOW, actor: 'ai' }),
    'approval-required',
  );
});

test('P04 ¿falla si el código desaparece? Quitar la guardia de duplicado cambia la conducta', async () => {
  const directory = autonomyRoot('lsc-mutant-duplicate');
  cpSync(join(ROOT, 'lib'), join(directory, 'lib'), { recursive: true });
  const file = join(directory, 'lib', 'operations.mjs');
  const original = readFileSync(file, 'utf8');
  const guard = /  if \(state\.skills\[id\] !== undefined\) \{\n[\s\S]*?\n  \}\n/;
  assert.match(original, guard, 'la guardia de duplicado tiene que existir para poder quitarla');
  writeFileSync(file, original.replace(guard, ''), 'utf8');
  const mutant = await import(`${pathToFileURL(file).href}?mutant=${Date.now()}`);

  const state = emptyState(NOW);
  assert.equal(createSkill(state, candidate({ id: 'adv-mutante' }), { now: NOW }).ok, true);
  assertRefusal(createSkill(state, candidate({ id: 'adv-mutante' }), { now: NOW }), 'exists');
  const withoutGuard = mutant.createSkill(state, candidate({ id: 'adv-mutante' }), { now: NOW });
  assert.equal(withoutGuard.ok, true, 'sin la guardia, crear el duplicado tiene que pasar: si no, la prueba no mide esa línea');
});

test('P05 ¿está acoplada a nombres internos? Renombrar `detectState` no cambia el resultado', async () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  const renamed = source.replace(/\bdetectState\b/g, 'detectSnapshot');
  assert.notEqual(renamed, source, 'el renombrado tiene que tocar algo para que la prueba valga');
  const { view } = await renderLibrary(renamed);
  assert.equal(typeof view.props.detect?.text, 'string');
  assert.equal(view.props.detect, view.props.onDetect);
});

test('P06 ¿hay aserciones tautológicas? Cero comparaciones de un valor consigo mismo', () => {
  const source = readFileSync(SELF_PATH, 'utf8');
  const tautologies = source.match(/assert\.equal\(\s*([A-Za-z_$][\w$.]*)\s*,\s*\1\s*\)/g) ?? [];
  assert.deepEqual(tautologies, [], `aserciones tautológicas: ${tautologies.join(', ')}`);
  assert.equal(/assert\.ok\(\s*true\s*\)/.test(source), false, 'una aserción constante no mide nada');
  const assertions = source.match(/\bassert\./g) ?? [];
  assert.ok(assertions.length > 30, `la suite tiene que tener aserciones reales; contadas ${assertions.length}`);
});

test('P07 ¿el catch oculta errores? Un código distinto del esperado no da verde', () => {
  const unexpected = Object.assign(new Error('el disco contestó EIO'), { code: 'EIO' });
  assert.throws(
    () => onlyExpected(() => { throw unexpected; }, 'ELOCK'),
    /error inesperado \(EIO\)/,
    'un error distinto del esperado tiene que relanzarse',
  );
  assert.equal(onlyExpected(() => { throw Object.assign(new Error('lock'), { code: 'ELOCK' }); }, 'ELOCK').code, 'ELOCK');

  const strict = runNodeTest([
    "import test from 'node:test';",
    "function onlyExpected(fn, expected) { try { fn(); } catch (error) { if (error?.code === expected) return; throw error; } }",
    "test('catch estricto', () => {",
    "  onlyExpected(() => { throw Object.assign(new Error('otro fallo'), { code: 'EIO' }); }, 'ELOCK');",
    '});',
  ].join('\n'));
  assert.equal(strict.status, 1, `un catch estricto no puede dar verde\n${strict.stdout}\n${strict.stderr}`);

  const sloppy = runNodeTest([
    "import test from 'node:test';",
    "test('catch total', () => {",
    "  try { throw Object.assign(new Error('otro fallo'), { code: 'EIO' }); } catch { return; }",
    '});',
  ].join('\n'));
  assert.equal(sloppy.status, 0, `el catch total sí da verde: por eso la guardia estricta es la que vale\n${sloppy.stdout}`);
});

test('P08 ¿siembra datos irreales? El fixture pasa la compuerta y el proyecto existe en disco', () => {
  const skill = candidate({ id: 'adv-fixture-real' });
  const evaluation = evaluateSkill(skill, { evaluatedAt: NOW });
  assert.ok(['pass', 'warn'].includes(evaluation.status), `el fixture no debería bloquearse: ${evaluation.status}`);
  assert.equal(isSafeId(skill.id), true);
  const project = tempProject('adv-fixture');
  assert.equal(existsSync(project), true, 'el cwd sembrado tiene que ser un directorio real');
});

test('P09 ¿es determinista? La misma semilla produce la misma campaña de 200 valores', () => {
  const firstGenerator = mulberry32(SEED);
  const secondGenerator = mulberry32(SEED);
  const first = Array.from({ length: 200 }, () => firstGenerator());
  const second = Array.from({ length: 200 }, () => secondGenerator());
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size > 1, true, 'un generador constante no sirve para property-based testing');
});

test('P10 ¿usa el almacén real? Todo vive bajo tmpdir y fuera de defaultRoot()', () => {
  const root = autonomyRoot('adv-hermetic');
  const relativeToTmp = relative(tmpdir(), root);
  assert.equal(relativeToTmp.startsWith('..'), false, `fuera de tmpdir: ${root}`);
  assert.notEqual(resolve(root), resolve(defaultRoot()));
  const store = autonomyRoot('adv-hermetic-store');
  runAction({ root: store, action: 'create', cwd: tempProject('adv-hermetic-project'), now: NOW, payload: candidate({ id: 'adv-store' }) });
  assert.equal(existsSync(join(store, 'center.json')), true, 'la propiedad 3 tiene que escribir su propio center.json temporal');
});

test('P11 ¿prueba el borde y no sólo el camino feliz? Cuatro negativas concretas', () => {
  const state = emptyState(NOW);
  const skill = candidate({ id: 'adv-bordes' });
  assert.equal(createSkill(state, skill, { now: NOW }).ok, true);
  const project = ensureProject(state, tempProject('adv-bordes-project'), { now: NOW });
  assertRefusal(publishVersion(state, 'adv-bordes', candidate({ id: 'adv-bordes' }), { now: NOW }), 'unchanged');
  assertRefusal(toggleAssignment(state, { projectId: project.id, skillId: 'adv-bordes', enabled: true, version: '9.9.9' }, { now: NOW }), 'unknown-version');
  const off = toggleAssignment(state, { projectId: project.id, skillId: 'adv-bordes', enabled: false }, { now: NOW });
  assert.equal(off.ok, true);
  assert.equal(off.assignment.version, '1.0.0', 'apagar sin asignación previa conserva la versión vigente');

  // La compuerta de la IA vive en el adaptador (`runAction`), no en la operación pura: se mide donde
  // de verdad se aplica, sin suponer que `toggleAssignment` conoce al actor.
  const root = autonomyRoot('adv-bordes-api');
  const cwd = tempProject('adv-bordes-api-project');
  const created = runAction({ root, action: 'create', cwd, now: NOW, payload: candidate({ id: 'adv-bordes-api' }) });
  assert.equal(created.ok, true, JSON.stringify(created));
  const opened = runAction({ root, action: 'open', cwd, now: NOW });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assertRefusal(
    runAction({ root, action: 'toggle', actor: 'ai', cwd, now: NOW, payload: { projectId: opened.project.id, skillId: created.id, enabled: true } }),
    'approval-required',
  );
});

test('P12 ¿un cambio legítimo la rompe? Renombrar una local de operations no cambia el pin', async () => {
  const directory = autonomyRoot('lsc-mutant-refactor');
  cpSync(join(ROOT, 'lib'), join(directory, 'lib'), { recursive: true });
  const file = join(directory, 'lib', 'operations.mjs');
  const original = readFileSync(file, 'utf8');
  const refactored = original.replace(/\bpinned\b/g, 'pinVersion');
  assert.notEqual(refactored, original);
  writeFileSync(file, refactored, 'utf8');
  const mutant = await import(`${pathToFileURL(file).href}?refactor=${Date.now()}`);

  function run(toggle) {
    const state = emptyState(NOW);
    assert.equal(createSkill(state, candidate({ id: 'adv-refactor' }), { now: NOW }).ok, true);
    assert.equal(publishVersion(state, 'adv-refactor', { body: `${candidate().body}\n\n## Cambio\n\nVersión dos.` }, { now: NOW }).ok, true);
    const project = ensureProject(state, tempProject(`adv-refactor-${Math.random().toString(16).slice(2)}`), { now: NOW });
    const on = toggle(state, { projectId: project.id, skillId: 'adv-refactor', enabled: true }, { now: NOW });
    assert.equal(on.ok, true);
    const off = toggle(state, { projectId: project.id, skillId: 'adv-refactor', enabled: false }, { now: NOW });
    assert.equal(off.ok, true);
    return { on: on.assignment.version, off: off.assignment.version };
  }

  const official = run(toggleAssignment);
  const candidateResult = run(mutant.toggleAssignment);
  assert.deepEqual(candidateResult, official, 'un renombrado local no puede cambiar la versión que queda fijada');
  assert.equal(official.on, '1.1.0');
  assert.equal(official.off, '1.1.0');
});

test('D3 la vista Biblioteca recibe `detect` y `onDetect` con la misma referencia', async () => {
  const { view } = await renderLibrary();
  assert.equal(Object.prototype.hasOwnProperty.call(view.props, 'detect'), true, 'falta la prop detect');
  assert.equal(Object.prototype.hasOwnProperty.call(view.props, 'onDetect'), true, 'falta la prop onDetect');
  assert.equal(view.props.detect, view.props.onDetect, 'las dos props tienen que ser el mismo cuadro');
  assert.equal(typeof view.props.detect.text, 'string');
  assert.equal(typeof view.props.detect.change, 'function');
  assert.equal(typeof view.props.detect.run, 'function');
});

test('D4 el cleanup retira el nodo real, no sólo cuenta funciones', () => {
  const loaded = loadClient(readFileSync(CLIENT_PATH, 'utf8'));
  const style = loaded.document.getElementById('lsc-styles');
  assert.ok(style, 'el estilo tiene que existir antes del cleanup');
  assert.equal(loaded.cleanups.length > 0, true);
  for (const cleanup of loaded.cleanups) cleanup();
  assert.equal(loaded.document.head.children.includes(style), false, 'el nodo sigue colgado del head');
  assert.equal(loaded.document.getElementById('lsc-styles'), null);
});

test('D5 dos cwd distintos son dos proyectos distintos', () => {
  const state = emptyState(NOW);
  const first = ensureProject(state, tempProject('adv-cwd-uno'), { now: NOW });
  const second = ensureProject(state, tempProject('adv-cwd-dos'), { now: NOW });
  assert.notEqual(first.id, second.id, 'dos cwd distintos no pueden compartir id');
  assert.equal(createSkill(state, candidate({ id: 'adv-cwd-skill' }), { now: NOW }).ok, true);
  assert.equal(toggleAssignment(state, { projectId: first.id, skillId: 'adv-cwd-skill', enabled: true }, { now: NOW }).ok, true);
  assert.ok(state.assignments[first.id]?.['adv-cwd-skill']);
  assert.equal(state.assignments[second.id], undefined, 'activar en A no puede escribir en B');
});

/* --------------------------------------------------- propiedades (200 por propiedad) */

test('PROP-1 publicar nunca baja currentVersion ni inventa versiones (200 casos)', () => {
  for (let caseIndex = 0; caseIndex < 200; caseIndex += 1) {
    const random = mulberry32(SEED + caseIndex);
    const state = emptyState(NOW);
    const id = `prop-1-${caseIndex}`;
    const base = candidate({ id });
    assert.equal(createSkill(state, base, { now: NOW }).ok, true);
    let previous = state.skills[id].currentVersion;
    const steps = integer(random, 1, 4);
    for (let step = 0; step < steps; step += 1) {
      const body = `${base.body}\n\n## Ciclo ${step}\n\n${pick(random, ['uno', 'dos', 'tres', 'cuatro'])}-${caseIndex}-${step}`;
      const result = publishVersion(state, id, { body }, { now: isoAt(caseIndex * 10 + step), actor: 'human' });
      assert.equal(result.ok, true, `caso ${caseIndex}/${step}: ${JSON.stringify(result)}`);
      const current = state.skills[id].currentVersion;
      assert.equal(compareVersions(current, previous) > 0, true, `caso ${caseIndex}/${step}: ${current} no subió sobre ${previous}`);
      assert.equal(result.version.version, current);
      assert.equal(state.skills[id].versions.some((entry) => entry.version === current), true);
      assert.equal(new Set(state.skills[id].versions.map((entry) => entry.version)).size, state.skills[id].versions.length);
      previous = current;
    }
  }
});

test('PROP-2 todo pin de toda asignación apunta a una versión existente (200 casos)', () => {
  for (let caseIndex = 0; caseIndex < 200; caseIndex += 1) {
    const random = mulberry32(SEED + 10_000 + caseIndex);
    const state = emptyState(NOW);
    const projects = [];
    const skills = [];
    for (let index = 0; index < integer(random, 1, 3); index += 1) {
      projects.push(ensureProject(state, tempProject(`prop-2-${caseIndex}-${index}`), { now: NOW }));
    }
    for (let index = 0; index < integer(random, 1, 3); index += 1) {
      const id = `prop-2-${caseIndex}-${index}`;
      skills.push(id);
      assert.equal(createSkill(state, candidate({ id }), { now: NOW }).ok, true);
      for (let publish = 0; publish < integer(random, 0, 3); publish += 1) {
        publishVersion(state, id, { body: `${candidate().body}\n\n## Versión\n\n${caseIndex}-${index}-${publish}` }, { now: NOW });
      }
    }
    for (let operation = 0; operation < integer(random, 5, 20); operation += 1) {
      const project = pick(random, projects);
      const skillId = pick(random, skills);
      const versions = state.skills[skillId].versions.map((entry) => entry.version);
      const kind = pick(random, ['toggle', 'toggle', 'rollback', 'publish']);
      if (kind === 'toggle') {
        const wanted = random() < 0.2 ? '9.9.9' : random() < 0.5 ? pick(random, versions) : undefined;
        toggleAssignment(state, { projectId: project.id, skillId, enabled: random() < 0.7, ...(wanted === undefined ? {} : { version: wanted }) }, { now: NOW });
      } else if (kind === 'rollback') {
        rollbackAssignment(state, { projectId: project.id, skillId, version: pick(random, versions) }, { now: NOW });
      } else {
        publishVersion(state, skillId, { body: `${candidate().body}\n\n## Publicación\n\n${caseIndex}-${operation}` }, { now: NOW });
      }
    }
    for (const [projectId, row] of Object.entries(state.assignments)) {
      assert.ok(state.projects[projectId], `caso ${caseIndex}: asignación a proyecto inexistente ${projectId}`);
      for (const [skillId, entry] of Object.entries(row)) {
        const skill = state.skills[skillId];
        assert.ok(skill, `caso ${caseIndex}: asignación a skill inexistente ${skillId}`);
        assert.equal(typeof entry.enabled, 'boolean');
        assert.match(entry.version, /^\d+\.\d+\.\d+$/);
        assert.equal(skill.versions.some((version) => version.version === entry.version), true,
          `caso ${caseIndex}: el pin ${entry.version} de ${skillId} no existe`);
      }
    }
  }
});

test('PROP-3 leer indicadores no escribe el almacén (200 lecturas)', () => {
  const root = autonomyRoot('prop-3-read');
  const cwd = tempProject('prop-3-project');
  assert.equal(runAction({ root, action: 'create', cwd, now: NOW, payload: candidate({ id: 'prop-3-skill' }) }).ok, true);
  assert.equal(runAction({ root, action: 'open', cwd, now: NOW }).ok, true);

  const before = digestTree(root);
  for (let index = 0; index < 200; index += 1) {
    const now = isoAt(index);
    const snapshot = buildSnapshot({ root, cwd, now, scan: false, analyticsProject: index % 2 === 0 ? '' : 'prop-3-project' });
    assert.equal(snapshot.ok, true, `lectura ${index}: ${JSON.stringify(snapshot)}`);
    const loaded = loadState(root);
    assert.equal(loaded.ok, true);
    const report = summarize(loaded.state, { now, days: integer(mulberry32(SEED + index), 1, 30), projectId: index % 3 === 0 ? 'prop-3-project' : '', skillId: index % 4 === 0 ? 'prop-3-skill' : '' });
    assert.ok(report && typeof report === 'object');
  }
  const after = digestTree(root);
  assert.equal(after, before, 'leer indicadores cambió center.json (contenido o mtime)');
});
