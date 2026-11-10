/**
 * Pruebas funcionales de la sección **Proyectos** del panel (`client.js`).
 *
 * No basta con que el componente exista: aquí se monta el Panel real sobre un React mínimo
 * (estado + efectos + re-render), se pulsan los botones por su etiqueta i18n y se afirma lo que
 * el efecto hace de verdad: URL y cuerpo de cada `fetch`, estados visibles de busy/error, que un
 * 409/503 no se convierte en éxito, que «Abrir en DSH» llama al panel del workspace con el id
 * correcto, que los chips filtran la lista y que un botón deshabilitado no dispara ninguna petición.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = path.join(HERE, '..', 'client.js');
const CLIENT_SOURCE = fs.readFileSync(CLIENT_PATH, 'utf8');

const API = '/lifecode-skill-center/api';
const OPEN_NO_PANEL = 'Este harness no tiene el panel de workspaces cargado: no puedo abrirlo desde aquí.';

/* ------------------------------------------------------------------ React mínimo */

function createElement(type, props, ...children) {
  const next = props === null || props === undefined ? {} : { ...props };
  if (children.length === 1) next.children = children[0];
  else if (children.length > 1) next.children = children;
  return { type, props: next };
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return (asChildren(node)).map(textOf).join(' ');
}

function asChildren(node) {
  const value = node?.children ?? node?.props?.children;
  if (value === null || value === undefined || typeof value === 'boolean') return [];
  return Array.isArray(value) ? value : [value];
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object' || Array.isArray(node)) {
    if (Array.isArray(node)) node.forEach((child) => walk(child, visit));
    return;
  }
  visit(node);
  for (const child of asChildren(node)) walk(child, visit);
}

function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

/**
 * `React.Component` mínimo: el cliente lo necesita para la frontera de error (React sólo reconoce
 * `getDerivedStateFromError` en clases). El runtime sustituye `setState` por instancia; esto sólo
 * aporta el constructor y la marca `isReactComponent` que distingue una clase de una función.
 */
class TestComponent {
  constructor(props) {
    this.props = props;
    this.state = {};
  }

  setState(next) {
    const patch = typeof next === 'function' ? next(this.state) : next;
    this.state = { ...this.state, ...(patch ?? {}) };
  }

  forceUpdate() {}
}
TestComponent.prototype.isReactComponent = {};

function createRuntime() {
  const state = {
    fibers: new Map(),
    current: null,
    renderOrder: [],
    dirty: true,
    tree: null,
    component: null,
    error: null,
    boundaries: [],
    hookViolations: [],
  };

  function hook(kind) {
    const fiber = state.current;
    const index = fiber.hookIndex;
    fiber.hookIndex += 1;
    // Orden de hooks: React real desmonta el árbol si cambia entre renders y el React mínimo lo
    // toleraba en silencio. Aquí se comprueba la secuencia de tipos por posición y se falla.
    if (fiber.hookKinds === undefined) fiber.hookKinds = [];
    const previous = fiber.hookKinds[index];
    if (previous === undefined) fiber.hookKinds[index] = kind;
    else if (previous !== kind) {
      const message = `orden de hooks inestable en ${fiber.label ?? 'un componente'}: la posición ${index} era ${previous} y ahora ${kind}`;
      state.hookViolations.push(message);
      throw new Error(message);
    }
    if (fiber.hooks.length <= index) fiber.hooks.push({});
    return fiber.hooks[index];
  }

  function useState(initial) {
    const slot = hook('useState');
    if (!Object.prototype.hasOwnProperty.call(slot, 'value')) {
      slot.value = typeof initial === 'function' ? initial() : initial;
    }
    if (slot.setter === undefined) {
      slot.setter = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        state.dirty = true;
      };
    }
    return [slot.value, slot.setter];
  }

  function useRef(initial) {
    const slot = hook('useRef');
    if (!Object.prototype.hasOwnProperty.call(slot, 'current')) slot.current = initial;
    return slot;
  }

  function useMemo(factory, deps) {
    const slot = hook('useMemo');
    if (!Object.prototype.hasOwnProperty.call(slot, 'value') || !sameDeps(slot.deps, deps)) {
      slot.value = factory();
      slot.deps = deps;
    }
    return slot.value;
  }

  function useCallback(fn, deps) {
    return useMemo(() => fn, deps);
  }

  function useEffect(fn, deps) {
    const slot = hook('useEffect');
    const index = slot.index ?? (slot.index = fn.name + Math.random());
    state.current.pendingEffects.push({ fn, deps, index });
  }

  function renderTree(treePath, node) {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) return node.map((child, index) => renderTree(`${treePath}.${index}`, child));
    if (typeof node !== 'object') return null;
    const { type, props } = node;
    const safeProps = props ?? {};
    if (typeof type === 'function') {
      const fiber = getFiber(treePath, type);
      fiber.hookIndex = 0;
      fiber.pendingEffects = [];
      fiber.label = fiber.label ?? (type.displayName || type.name || 'anónimo');
      if (type.prototype !== undefined && type.prototype.isReactComponent !== undefined) {
        return renderClassComponent(treePath, type, safeProps, fiber);
      }
      const previous = state.current;
      state.current = fiber;
      let output;
      try {
        output = type(safeProps);
      } finally {
        state.current = previous;
      }
      state.renderOrder.push(fiber);
      return renderTree(`${treePath}.out`, output);
    }
    const children = asChildren({ props: safeProps }).map((child, index) => renderTree(`${treePath}.${index}`, child));
    return { type, props: safeProps, children };
  }

  function renderClassComponent(treePath, type, props, fiber) {
    if (fiber.instance === undefined) {
      fiber.instance = new type(props);
      fiber.instance.__fiber = fiber;
      fiber.classState = fiber.instance.state ?? {};
      fiber.mounted = false;
      fiber.instance.setState = (next, callback) => {
        const patch = typeof next === 'function' ? next(fiber.instance.state) : next;
        fiber.instance.state = { ...fiber.instance.state, ...(patch ?? {}) };
        fiber.classState = fiber.instance.state;
        state.dirty = true;
        if (typeof callback === 'function') callback();
      };
      fiber.instance.forceUpdate = (callback) => {
        state.dirty = true;
        if (typeof callback === 'function') callback();
      };
    }
    const instance = fiber.instance;
    instance.props = props;
    instance.state = fiber.classState ?? instance.state ?? {};
    fiber.hookIndex = 0;
    fiber.pendingEffects = [];
    // Las fronteras de error quedan apiladas mientras se dibuja SU subárbol: así un fallo de un
    // descendiente encuentra la frontera más cercana y puede convertirse en tarjeta visible.
    const isBoundary = typeof type.getDerivedStateFromError === 'function';
    if (isBoundary) state.boundaries.push(fiber);
    const previous = state.current;
    state.current = fiber;
    let output;
    try {
      output = instance.render();
    } catch (failure) {
      throw failure;
    } finally {
      state.current = previous;
    }
    state.renderOrder.push(fiber);
    fiber.classState = instance.state;
    const rendered = renderTree(`${treePath}.c`, output);
    if (isBoundary) state.boundaries.pop();
    return rendered;
  }

  function getFiber(treePath, type) {
    const existing = state.fibers.get(treePath);
    if (existing !== undefined && existing.type === type) return existing;
    const fiber = { type, hooks: [], hookIndex: 0, pendingEffects: [], effectDeps: [] };
    state.fibers.set(treePath, fiber);
    return fiber;
  }

  function flushEffects() {
    const queue = state.renderOrder.slice();
    state.renderOrder = [];
    for (const fiber of queue) {
      const pending = fiber.pendingEffects ?? [];
      for (const effect of pending) {
        const stored = fiber.effectDeps[effect.index];
        if (stored !== undefined && effect.deps !== undefined && sameDeps(stored, effect.deps)) continue;
        fiber.effectDeps[effect.index] = effect.deps;
        effect.fn();
      }
    }
  }

  function render() {
    state.dirty = false;
    state.renderOrder = [];
    state.current = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      state.boundaries = [];
      try {
        state.tree = renderTree('root', state.component);
        break;
      } catch (failure) {
        const boundary = state.boundaries.length === 0 ? null : state.boundaries[state.boundaries.length - 1];
        if (boundary === null) throw failure;
        const derived = boundary.type.getDerivedStateFromError(failure) ?? {};
        boundary.classState = { ...(boundary.instance?.state ?? {}), ...derived };
        if (boundary.instance !== undefined) boundary.instance.state = boundary.classState;
        if (boundary.instance !== undefined && typeof boundary.instance.componentDidCatch === 'function') {
          try {
            boundary.instance.componentDidCatch(failure, { componentStack: '' });
          } catch {
            /* el diagnóstico nunca puede tumbar el árbol de pruebas */
          }
        }
        state.renderOrder = [];
        state.dirty = false;
        if (attempt === 7) throw failure;
      }
    }
    for (const fiber of state.renderOrder.slice()) {
      if (fiber.instance !== undefined && fiber.mounted !== true && typeof fiber.instance.componentDidMount === 'function') {
        fiber.mounted = true;
        fiber.instance.componentDidMount();
      }
    }
    flushEffects();
  }

  async function settle(rounds = 12) {
    for (let index = 0; index < rounds; index += 1) {
      if (state.dirty || state.tree === null) render();
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (state.dirty) render();
  }

  return { state, render, settle, useState, useRef, useMemo, useCallback, useEffect };
}

/* ------------------------------------------------------------------ arnés del panel */

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function defaultSnapshot() {
  return {
    ok: true,
    readable: true,
    generatedAt: '2026-11-09T10:00:00.000Z',
    projects: [{
      id: 'proj-current',
      name: 'plugins-dhs',
      cwd: 'C:/work/plugins-dhs',
      updatesCount: 0,
      skills: [],
    }],
    skills: [],
    improvements: [],
    external: { candidates: [] },
    events: [],
  };
}

function defaultProjects() {
  return {
    ok: true,
    apiVersion: 1,
    generatedAt: '2026-11-09T10:05:00.000Z',
    readable: true,
    complete: true,
    sources: [
      { id: 'workspace-registry', status: 'complete' },
      { id: 'skills-registry', status: 'complete' },
    ],
    discovered: [
      {
        workspaceId: 'ws-a',
        title: 'alpha',
        path: 'C:/work/alpha',
        canonicalPath: 'C:/work/alpha',
        sessionCount: 2,
        availability: 'ok',
        projectId: 'proj-a',
        state: 'discovered',
      },
      {
        workspaceId: 'ws-b',
        title: 'beta',
        path: 'C:/work/beta',
        canonicalPath: 'C:/work/beta',
        sessionCount: null,
        availability: 'missing-dir',
        projectId: 'proj-b',
        state: 'discovered',
      },
      {
        workspaceId: null,
        title: 'gamma',
        path: 'C:/work/gamma',
        canonicalPath: 'C:/work/gamma',
        sessionCount: 0,
        availability: 'unknown',
        projectId: null,
        state: 'discovered',
      },
    ],
    projects: [{
      projectId: 'proj-m',
      name: 'managed-one',
      cwd: 'C:/work/managed',
      canonicalPath: 'C:/work/managed',
      state: 'healthy',
      registration: {
        present: true,
        uuid: '12345678-aaaa-bbbb-cccc-1234567890ab',
        manifestSha256: 'abcdef0123456789abcdef',
        registeredAt: null,
        adoptedAt: null,
      },
      workspace: { workspaceId: 'ws-m', title: 'managed', path: 'C:/work/managed', availability: 'ok' },
      inspection: { status: 'complete', inspectedAt: '2026-11-01T00:00:00.000Z', reason: '' },
      counts: { assigned: 2, active: 1, materialized: 0 },
      reasons: [],
    }],
    current: { cwd: '', workspaceId: null, workspaceTitle: '', projectId: null, confidence: 'unknown', via: '' },
    summary: { discovered: 3, managed: 1 },
  };
}

function defaultInventory() {
  return {
    ok: true,
    apiVersion: 1,
    generatedAt: '2026-11-09T10:05:01.000Z',
    complete: true,
    truncated: false,
    sources: [{ id: 'skills-registry', status: 'complete' }],
    entries: [{
      key: 'skill:own-skill',
      name: 'own-skill',
      canonicalName: 'own-skill',
      description: 'propia',
      whenToUse: '',
      owner: { kind: 'lifecode', provider: 'lifecode-skill-center', pluginEntryId: 'lsc' },
      origin: { kind: 'file', label: 'library' },
      location: { kind: 'file', path: 'C:/work/alpha/own-skill/SKILL.md', directory: 'C:/work/alpha', rootId: 'root' },
      scope: { kind: 'projectRoot', projectRoot: 'C:/work/alpha', cwd: '' },
      association: { loadedByHost: true, provider: 'lifecode-skill-center', path: '', shadowedBy: null },
      execution: { modelInvocable: true, userInvocable: true },
      identity: { uuid: null, version: null, contentSha256: 'sha', manifestSha256: null },
      confidence: 'verified',
      reasons: [],
    }],
    collisions: [],
    summary: { total: 1, byOwner: { filesystem: 0, lifecode: 1, plugin: 0 }, shadowed: 0, ambiguous: 0, invalidNames: 0 },
  };
}

function defaultDetail(projectId) {
  return {
    ok: true,
    projectId,
    name: projectId === 'proj-m' ? 'managed-one' : 'alpha',
    cwd: projectId === 'proj-m' ? 'C:/work/managed' : 'C:/work/alpha',
    canonicalPath: projectId === 'proj-m' ? 'C:/work/managed' : 'C:/work/alpha',
    state: projectId === 'proj-m' ? 'healthy' : 'discovered',
    registration: projectId === 'proj-m'
      ? { present: true, uuid: '12345678-aaaa-bbbb-cccc-1234567890ab', manifestSha256: 'abcdef0123456789abcdef', registeredAt: null, adoptedAt: null }
      : { present: false, uuid: null, manifestSha256: null, registeredAt: null, adoptedAt: null },
    workspace: { workspaceId: projectId === 'proj-m' ? 'ws-m' : 'ws-a', title: 'alpha', path: 'C:/work/alpha', availability: 'ok' },
    inspection: { status: 'complete', inspectedAt: '2026-11-02T00:00:00.000Z', reason: '' },
    counts: { assigned: 1, active: 1, materialized: 0 },
    reasons: [],
    sources: [{ id: 'workspace-registry', status: 'complete' }],
    identity: {
      projectId,
      uuid: projectId === 'proj-m' ? '12345678-aaaa-bbbb-cccc-1234567890ab' : null,
      manifestSha256: 'abcdef0123456789abcdef',
      state: projectId === 'proj-m' ? 'match' : 'missing',
    },
    assignments: [{ skillId: 'skill:own-skill', version: '1.0.0', enabled: true, pinnedAt: null, updatedAt: null, by: 'test' }],
    skills: [{
      skillId: 'skill:own-skill',
      name: 'own-skill',
      assignedVersion: '1.0.0',
      host: { provider: 'lifecode-skill-center', path: 'C:/work/alpha/own-skill/SKILL.md', source: 'file' },
      shadowed: false,
    }],
    sessions: { count: 2, archived: 0, source: 'workspace' },
    collisions: [{ code: 'name-collision', severity: 'warn', key: 'own-skill' }],
    findings: [{ code: 'name-collision', severity: 'warn', message: 'dos skills con el mismo nombre' }],
  };
}

function defaultLegacy() {
  return {
    ok: true,
    workspaces: [{ workspaceId: 'ws-old', title: 'old', path: 'C:/work/old', status: 'ok', linkState: 'none', sessionCount: 1, projectId: null, reason: '' }],
    managed: [],
    current: { cwd: '', workspaceId: null },
    identity: { available: false, items: [] },
    summary: {},
  };
}

function defaultCapabilities() {
  return {
    ok: true,
    kind: 'capabilities',
    apiVersion: 1,
    contractVersion: 2,
    implementation: 'r16.2',
    plugin: { id: 'lifecode-skill-center', version: '0.5.0' },
    contract: { name: 'lifecode-skill-center', prefix: '/lifecode-skill-center/api', minClientContract: 2, maxClientContract: 2 },
    capabilities: ['state', 'projects', 'inventory', 'register-project', 'inspect-project'],
    routes: {},
    generatedAt: '2026-11-09T10:05:00.000Z',
  };
}

function legacyRouteResponse(call) {
  if (call.url.includes(`${API}/capabilities`)) {
    return jsonResponse(404, { ok: false, code: 'not-found', message: 'esa ruta no es de la API' });
  }
  if (call.url.includes(`${API}/workspaces`)) return jsonResponse(200, defaultLegacy());
  return undefined;
}

function createPanelHarness(options = {}) {
  const runtime = createRuntime();
  const calls = [];
  const opened = [];
  let responder = options.responder ?? null;
  let captured = null;
  let panelComponent = null;

  const React = {
    createElement,
    Component: TestComponent,
    Fragment: Symbol('Fragment'),
    useState: runtime.useState,
    useRef: runtime.useRef,
    useMemo: runtime.useMemo,
    useCallback: runtime.useCallback,
    useEffect: runtime.useEffect,
  };

  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          captured = definition;
        },
      },
      addEventListener: undefined,
      removeEventListener: undefined,
    },
    document: {
      visibilityState: 'visible',
      createElement() { return { remove() {}, set textContent(value) {}, get textContent() { return ''; } }; },
      head: { appendChild() {} },
    },
    fetch: async (url, init = {}) => {
      const method = String(init.method ?? 'GET').toUpperCase();
      let body = null;
      if (init.body !== null && init.body !== undefined) {
        try { body = JSON.parse(String(init.body)); } catch { body = null; }
      }
      const call = { url: String(url), method, body };
      calls.push(call);
      if (typeof responder === 'function') {
        const custom = await responder(call);
        if (custom !== undefined) return custom;
      }
      return defaultResponse(call);
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    URL,
    URLSearchParams,
    console,
  };

  function defaultResponse(call) {
    if (call.url.includes(`${API}/state`) && call.method === 'GET') {
      return jsonResponse(200, defaultSnapshot());
    }
    if (call.url.includes(`${API}/state`) && call.method === 'POST') {
      const action = call.body?.action;
      if (action === 'open') return jsonResponse(200, defaultSnapshot());
      if (action === 'inspect-project') return jsonResponse(200, defaultDetail(call.body?.payload?.projectId));
      if (action === 'register-project') return jsonResponse(200, { ok: true, project: { projectId: 'proj-new' }, findings: [] });
      return jsonResponse(200, { ok: true });
    }
    if (call.url.includes(`${API}/capabilities`)) return jsonResponse(200, defaultCapabilities());
    if (call.url.includes(`${API}/projects`)) return jsonResponse(200, defaultProjects());
    if (call.url.includes(`${API}/inventory`)) return jsonResponse(200, defaultInventory());
    if (call.url.includes(`${API}/workspaces`)) return jsonResponse(200, defaultLegacy());
    return jsonResponse(404, { ok: false, error: { code: 'not-found', message: 'no route' } });
  }

  vm.runInNewContext(CLIENT_SOURCE, sandbox, { filename: CLIENT_PATH });
  assert.ok(captured !== null, 'client.js se registró con __ModuleLoader__');
  const module_ = captured.factory((name) => {
    assert.equal(name, 'react', 'el cliente sólo puede requerir react');
    return React;
  });
  assert.equal(typeof module_.apply, 'function', 'el módulo expone apply');

  const ctx = {
    effect(fn) {
      const cleanup = fn();
      return () => { if (typeof cleanup === 'function') cleanup(); };
    },
    slots: {
      inject(_slot, callback) { return callback(); },
      register(definition, component) {
        if (definition?.name === 'main') panelComponent = component;
        return { dispose() {} };
      },
    },
    locale: {
      register() { return () => {}; },
      getSnapshot() { return { locale: options.locale ?? 'es' }; },
      getLocale() { return options.locale ?? 'es'; },
      subscribe() { return () => {}; },
    },
    get() { return null; },
  };
  if (options.uiWorkspaceGuard === true) {
    // Simula el proxy de servicios de Cordis en producción: leer una propiedad del servicio sin
    // declararlo en `inject` lanza. Era la causa del panel en blanco, así que la prueba monta el
    // panel con ese ctx hostil y exige una tarjeta de diagnóstico en vez de un área vacía.
    const service = {};
    Object.defineProperty(service, 'openWorkspace', {
      configurable: true,
      get() {
        if (service.guarded !== false) throw new Error('cannot get property "openWorkspace" without inject');
        return async (workspaceId) => { opened.push(workspaceId); };
      },
    });
    ctx.get = (name) => (name === 'uiWorkspace' ? service : null);
    ctx.uiWorkspace = service;
  }
  if (options.openWorkspace !== false) {
    ctx.uiWorkspace = {
      async openWorkspace(workspaceId) {
        opened.push(workspaceId);
        if (typeof options.openWorkspace === 'function') return options.openWorkspace(workspaceId);
        return undefined;
      },
    };
  }
  try {
    module_.apply(ctx);
  } catch (failure) {
    assert.fail(`apply() lanzó: ${failure?.message ?? failure}`);
  }

  const Panel = panelComponent;
  assert.equal(typeof Panel, 'function', 'apply() registra el componente main');
  runtime.state.component = createElement(Panel, {});

  const accessors = {
    calls,
    opened,
    runtime,
    ctx,
    async mount(component) {
      runtime.state.component = component;
      runtime.state.tree = null;
      runtime.state.fibers.clear();
      runtime.state.dirty = true;
      await runtime.settle();
    },
    get tree() { return runtime.state.tree; },
    setResponder(next) { responder = next; },
    reset() { calls.length = 0; },
    settle(rounds) { return runtime.settle(rounds); },
    all(predicate) {
      const found = [];
      walk(runtime.state.tree, (node) => { if (predicate(node)) found.push(node); });
      return found;
    },
    byClass(fragment) {
      return accessors.all((node) => typeof node.props?.className === 'string' && node.props.className.includes(fragment));
    },
    buttons(label) {
      return accessors.all((node) => node.type === 'button' && textOf(node).includes(label));
    },
    buttonExact(label) {
      return accessors.all((node) => node.type === 'button' && textOf(node).trim() === label);
    },
    button(label) {
      const found = accessors.buttons(label);
      assert.equal(found.length, 1, `un solo botón «${label}» (encontrados ${found.length})`);
      return found[0];
    },
    nodeText(label) {
      return accessors.all((node) => textOf(node).includes(label))[0] ?? null;
    },
    text() { return textOf(runtime.state.tree); },
    cards() { return accessors.byClass('lsc-project-card'); },
    card(name) {
      const found = accessors.cards().filter((node) => textOf(node).includes(name));
      return found[0] ?? null;
    },
    inNode(node, predicate) {
      const found = [];
      walk(node, (candidate) => { if (predicate(candidate)) found.push(candidate); });
      return found;
    },
    async click(node) {
      assert.ok(node !== null && node !== undefined, 'nodo a pulsar existe');
      assert.equal(typeof node.props?.onClick, 'function', 'el nodo tiene onClick');
      node.props.onClick({ preventDefault() {}, stopPropagation() {}, target: { value: '' } });
      await runtime.settle();
    },
    async clickText(label) {
      const node = accessors.button(label);
      await accessors.click(node);
      return node;
    },
    async change(node, value) {
      assert.equal(typeof node.props?.onChange, 'function', 'el nodo tiene onChange');
      node.props.onChange({ target: { value }, preventDefault() {}, stopPropagation() {} });
      await runtime.settle();
    },
  };

  return runtime.settle().then(() => accessors);
}

async function openProjects(options = {}) {
  const harness = await createPanelHarness(options);
  const nav = harness.buttons(options.navLabel ?? 'Proyectos')[0];
  assert.ok(nav, 'existe el botón de navegación «Proyectos»');
  await harness.click(nav);
  return harness;
}

function postsTo(harness, action) {
  return harness.calls.filter((call) => call.method === 'POST' && call.url.includes(`${API}/state`) && call.body?.action === action);
}

/* ------------------------------------------------------------------ pruebas */

test('el arranque carga el inventario nuevo con cwd y límite explícitos', async () => {
  const harness = await openProjects();
  const projectsRead = harness.calls.filter((call) => call.method === 'GET' && call.url.includes(`${API}/projects`));
  const inventoryRead = harness.calls.filter((call) => call.method === 'GET' && call.url.includes(`${API}/inventory`));
  assert.equal(projectsRead.length, 1, 'un GET /projects al abrir la vista');
  assert.equal(inventoryRead.length, 1, 'un GET /inventory al abrir la vista');
  assert.equal(projectsRead[0].url, `${API}/projects?cwd=&limit=500`);
  assert.equal(inventoryRead[0].url, `${API}/inventory?cwd=&limit=500`);
  // Éxito honesto: recuento de una sola vista normalizada y hora del snapshot.
  assert.match(harness.text(), /3 workspaces · 1 gestionados · 0 cambios/);
  assert.match(harness.text(), /hora/);
  assert.equal(harness.cards().length, 3, 'tres tarjetas descubiertas, no cuatro ni siete');
});

test('los chips cuentan distinto, filtran de verdad y exponen aria-pressed', async () => {
  const harness = await openProjects();
  assert.equal(harness.cards().length, 3);
  const chips = harness.all((node) => typeof node.props?.['aria-pressed'] === 'string' && typeof node.props?.title === 'string' && node.props.title.length > 20);
  assert.ok(chips.length >= 11, `los 11 indicadores están presentes (${chips.length})`);
  assert.ok(chips.every((chip) => chip.props['aria-pressed'] === 'false'), 'ningún filtro activo al entrar');

  const unavailableChip = harness.buttons('no disponible')[0];
  assert.ok(unavailableChip, 'existe el chip de no disponibles');
  await harness.click(unavailableChip);
  assert.equal(harness.cards().length, 1, 'filtrar por no disponibles deja una tarjeta');
  assert.equal(harness.card('beta') !== null, true, 'la tarjeta que queda es la del workspace sin carpeta');
  assert.equal(harness.buttons('no disponible')[0].props['aria-pressed'], 'true', 'el chip activo se anuncia');

  const clear = harness.buttons('Quitar filtro')[0];
  assert.ok(clear, 'hay un botón para quitar el filtro');
  await harness.click(clear);
  assert.equal(harness.cards().length, 3, 'quitar el filtro restaura las tres tarjetas');
});

test('«Abrir en DSH» llama al panel del workspace con el id de su tarjeta', async () => {
  const harness = await openProjects();
  const alpha = harness.card('alpha');
  assert.ok(alpha, 'existe la tarjeta alpha');
  const open = harness.inNode(alpha, (node) => node.type === 'button' && textOf(node).includes('Abrir en DSH'))[0];
  assert.ok(open, 'la tarjeta descubierta ofrece abrir');
  assert.equal(open.props.disabled, false, 'con el panel cargado el botón está habilitado');
  await harness.click(open);
  assert.deepEqual(harness.opened, ['ws-a'], 'abre el workspace de esa tarjeta, no otro');
  // Los datos no se inventan: sesiones y disponibilidad salen del payload.
  assert.match(harness.text(), /2 sesiones/);
  assert.match(harness.text(), /sesiones: no contado/);
  assert.match(harness.text(), /sin verificar|No se pudo comprobar la disponibilidad/);
});

test('sin panel de workspaces el botón queda deshabilitado con el motivo exacto y no abre nada', async () => {
  const harness = await openProjects({ openWorkspace: false });
  const alpha = harness.card('alpha');
  const open = harness.inNode(alpha, (node) => node.type === 'button' && textOf(node).includes('Abrir en DSH'))[0];
  assert.ok(open, 'el botón sigue visible');
  assert.equal(open.props.disabled, true, 'deshabilitado sin la API del panel');
  assert.equal(open.props.title, OPEN_NO_PANEL, 'el título explica el motivo exacto de §7');
  await harness.click(open);
  assert.deepEqual(harness.opened, [], 'un botón deshabilitado no abre ninguna sesión');
  assert.equal(harness.calls.filter((call) => call.url.includes('open-workspace')).length, 0, 'jamás se llama a open-workspace');
});

test('un 503 del registro de workspaces se informa como error y nunca como éxito', async () => {
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/projects`)) {
        return jsonResponse(503, { ok: false, error: { code: 'workspace-registry-unavailable', message: 'sin registro de workspaces' } });
      }
      return undefined;
    },
  });
  const text = harness.text();
  assert.match(text, /Falló la consulta de proyectos/);
  assert.match(text, /workspace-registry-unavailable/);
  assert.match(text, /No se pudo refrescar/);
  assert.doesNotMatch(text, /3 workspaces/);
});

test('que falle sólo el inventario de skills se dice con su propio código', async () => {
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/inventory`)) {
        return jsonResponse(503, { ok: false, error: { code: 'skills-registry-unavailable', message: 'sin catálogo' } });
      }
      return undefined;
    },
  });
  assert.match(harness.text(), /Falló la consulta del inventario de skills/);
  assert.match(harness.text(), /skills-registry-unavailable/);
  assert.match(harness.text(), /No se pudo refrescar/);
  assert.doesNotMatch(harness.text(), /3 workspaces · 1 gestionados/);
  // Sin inventario no se pinta un 0: los indicadores de skills dicen «sin comprobar».
  assert.ok(harness.buttons('con skills detectadas').length === 0 || harness.text().includes('sin comprobar'));
});

test('inventario parcial y truncado se distinguen del completo', async () => {
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/projects`)) {
        const body = defaultProjects();
        body.complete = false;
        return jsonResponse(200, body);
      }
      if (call.url.includes(`${API}/inventory`)) {
        const body = defaultInventory();
        body.truncated = true;
        return jsonResponse(200, body);
      }
      return undefined;
    },
  });
  assert.match(harness.text(), /Inventario parcial/);
  assert.match(harness.text(), /Inventario recortado/);
  assert.doesNotMatch(harness.text(), /No se pudo refrescar/);
});

test('refrescar está deshabilitado mientras corre y no duplica la petición', async () => {
  const harness = await openProjects();
  const before = harness.calls.filter((call) => call.url.includes(`${API}/projects`)).length;
  const pending = [];
  harness.setResponder(async (call) => {
    if (call.url.includes(`${API}/projects`)) {
      return new Promise((resolve) => { pending.push(() => resolve(jsonResponse(200, defaultProjects()))); });
    }
    return undefined;
  });
  await harness.clickText('Refrescar inventario');
  assert.match(harness.text(), /Actualizando/);
  const refresh = harness.button('Actualizando');
  assert.equal(refresh.props.disabled, true, 'el botón de refresco queda deshabilitado');
  await harness.click(refresh);
  assert.equal(
    harness.calls.filter((call) => call.url.includes(`${API}/projects`)).length,
    before + 1,
    'el segundo clic no dispara otra petición',
  );
  for (const release of pending) release();
  await harness.settle();
});

test('Inspeccionar skills manda el projectId y abre la ficha en sólo lectura', async () => {
  const harness = await openProjects();
  const alpha = harness.card('alpha');
  const inspect = harness.inNode(alpha, (node) => node.type === 'button' && textOf(node).includes('Inspeccionar skills'))[0];
  assert.ok(inspect, 'la tarjeta descubierta ofrece inspeccionar');
  await harness.click(inspect);
  const posts = postsTo(harness, 'inspect-project');
  assert.equal(posts.length, 1, 'una sola petición de inspección');
  assert.deepEqual(posts[0].body, { action: 'inspect-project', payload: { projectId: 'proj-a' }, cwd: '' });
  const text = harness.text();
  assert.match(text, /Inspecci\S*n del proyecto|Ficha del proyecto/);
  assert.match(text, /Skills asociadas/);
  assert.match(text, /Origen y propiedad/);
  assert.match(text, /own-skill/);
  assert.match(text, /sólo lectura|solo lectura|read-only/i);
});

test('un 409 evidence-incomplete muestra las fuentes y no se convierte en éxito', async () => {
  const harness = await openProjects({
    responder: async (call) => {
      if (call.method === 'POST' && call.body?.action === 'inspect-project') {
        return jsonResponse(409, {
          ok: false,
          error: {
            code: 'evidence-incomplete',
            message: 'faltan fuentes',
            sources: [{ id: 'loader', status: 'incomplete', reason: 'timeout' }],
          },
        });
      }
      return undefined;
    },
  });
  const alpha = harness.card('alpha');
  await harness.click(harness.inNode(alpha, (node) => node.type === 'button' && textOf(node).includes('Inspeccionar skills'))[0]);
  const text = harness.text();
  assert.match(text, /No se escribió nada/);
  assert.match(text, /evidence-incomplete/);
  assert.match(text, /loader/);
  assert.doesNotMatch(text, /Proyecto registrado/);
});

test('el botón superior usa el mismo diálogo: prevalidación, confirmación y POST exacto', async () => {
  const harness = await openProjects();
  await harness.clickText('+ Registrar proyecto');
  assert.match(harness.text(), /Prevalidación de sólo lectura/);
  assert.match(harness.text(), /Workspace descubierto/);
  assert.match(harness.text(), /Cobertura del inventario/);

  const select = harness.all((node) => node.type === 'select' && asChildren(node).some((child) => textOf(child).includes('Elige un workspace')))[0];
  assert.ok(select, 'el diálogo elige entre workspaces descubiertos');
  await harness.change(select, 'ws-a');

  // Sin ruta no se puede confirmar: el botón está deshabilitado y no dispara petición.
  const review = harness.button('Revisar y continuar');
  assert.equal(review.props.disabled, false, 'con el workspace elegido se puede revisar');
  await harness.click(review);
  assert.equal(postsTo(harness, 'register-project').length, 0, 'revisar no registra nada');

  const confirm = harness.buttonExact('Registrar proyecto')[0];
  await harness.click(confirm);
  const posts = postsTo(harness, 'register-project');
  assert.equal(posts.length, 1, 'un único POST de registro');
  assert.deepEqual(posts[0].body, { action: 'register-project', payload: { cwd: 'C:/work/alpha' }, cwd: '' });
  assert.match(harness.text(), /Proyecto registrado/, 'éxito honesto tras un 200 real');
  assert.equal(harness.calls.filter((call) => call.url.includes(`${API}/projects`)).length >= 2, true, 'el éxito refresca el inventario');
});

test('un 409 preflight-blocked conserva el diálogo y muestra findings, reasons y sources', async () => {
  const harness = await openProjects({
    responder: async (call) => {
      if (call.method === 'POST' && call.body?.action === 'register-project') {
        return jsonResponse(409, {
          ok: false,
          error: {
            code: 'preflight-blocked',
            message: 'la prevalidación bloquea el registro',
            reasons: ['name-collision'],
            findings: [{ code: 'name-collision', severity: 'block', message: 'ya existe una skill con ese nombre' }],
            sources: [{ id: 'skills-registry', status: 'incomplete', reason: 'timeout' }],
          },
        });
      }
      return undefined;
    },
  });
  await harness.clickText('+ Registrar proyecto');
  const select = harness.all((node) => node.type === 'select' && asChildren(node).some((child) => textOf(child).includes('Elige un workspace')))[0];
  await harness.change(select, 'ws-a');
  await harness.clickText('Revisar y continuar');
  await harness.click(harness.buttonExact('Registrar proyecto')[0]);

  const text = harness.text();
  assert.match(text, /Registro bloqueado por la prevalidación/);
  assert.match(text, /name-collision/);
  assert.match(text, /Motivos del servidor/);
  assert.match(text, /Fuentes consultadas/);
  assert.match(text, /skills-registry/);
  assert.doesNotMatch(text, /Proyecto registrado/);
  // El diálogo sigue abierto en el paso de confirmación para poder corregir.
  assert.match(text, /Qué se va a registrar/);
});

test('sin ruta no se registra nada: el botón está deshabilitado y el clic no hace fetch', async () => {
  const harness = await openProjects();
  await harness.clickText('+ Registrar proyecto');
  const continueButton = harness.button('Revisar y continuar');
  assert.equal(continueButton.props.disabled, true, 'sin ruta el paso de revisión está bloqueado');
  assert.ok(String(continueButton.props.title).length > 10, 'el motivo del bloqueo se explica en el título');
  await harness.click(continueButton);
  assert.equal(postsTo(harness, 'register-project').length, 0, 'un botón deshabilitado no dispara fetch');
});

test('la pestaña Gestionados abre la ficha del proyecto con sus secciones', async () => {
  const harness = await openProjects();
  await harness.clickText('Gestionados');
  const managed = harness.card('managed-one');
  assert.ok(managed, 'aparece la tarjeta del proyecto gestionado');
  assert.match(textOf(managed), /UUID 12345678-aaa/);
  const detail = harness.inNode(managed, (node) => node.type === 'button' && textOf(node).includes('Abrir ficha'))[0];
  assert.ok(detail, 'la tarjeta gestionada ofrece abrir ficha');
  await harness.click(detail);
  const posts = postsTo(harness, 'inspect-project');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.payload.projectId, 'proj-m');
  const text = harness.text();
  assert.match(text, /Sesiones/);
  assert.match(text, /Origen y propiedad/);
  assert.match(text, /Conflictos/);
  assert.match(text, /Actividad e historial/);
  assert.match(text, /Identidad y vinculación/);
  assert.match(text, /assignments|Asignaciones|asignaciones/i);
});

test('el payload heredado se anuncia como heredado y no se pinta como éxito del contrato nuevo', async () => {
  const harness = await openProjects({ responder: async (call) => legacyRouteResponse(call) });
  const text = harness.text();
  assert.match(text, /Modo compatibilidad heredada/);
  assert.match(text, /\/api\/projects/);
  assert.match(text, /\/api\/inventory/);
  assert.doesNotMatch(text, /3 workspaces · 1 gestionados/);
  assert.ok(harness.cards().length >= 1, 'se muestra el inventario antiguo mientras el nuevo no exista');
  // Un 404 de ruta NO es un error rojo: el único aviso es el banner ámbar.
  assert.equal(harness.byClass('lsc-notice bad').length, 0, 'en legacy no hay banners rojos de ruta');
  assert.equal(harness.calls.filter((call) => call.url.includes(`${API}/projects`)).length, 0, 'no se consulta /projects en legacy');
  assert.equal(harness.calls.filter((call) => call.url.includes(`${API}/inventory`)).length, 0, 'no se consulta /inventory en legacy');
});

test('dos proyectos con prefijo común no comparten skills, colisiones ni actividad', async () => {
  const shortPath = 'C:\\repo\\plugins-dhs';
  const longPath = 'C:\\repo\\plugins-dhs-extra';
  const projectsBody = {
    ok: true,
    apiVersion: 1,
    generatedAt: '2026-11-09T10:05:00.000Z',
    readable: true,
    complete: true,
    sources: [{ id: 'workspace-registry', status: 'complete' }],
    discovered: [
      {
        workspaceId: 'ws-short',
        title: 'plugins-dhs',
        path: shortPath,
        canonicalPath: shortPath,
        sessionCount: 1,
        availability: 'ok',
        projectId: 'proj-short',
        state: 'discovered',
      },
      {
        workspaceId: 'ws-long',
        title: 'plugins-dhs-extra',
        path: longPath,
        canonicalPath: longPath,
        sessionCount: 1,
        availability: 'ok',
        projectId: 'proj-long',
        state: 'discovered',
      },
    ],
    projects: [],
    current: { cwd: '', workspaceId: null, workspaceTitle: '', projectId: null, confidence: 'unknown', via: '' },
    summary: { discovered: 2, managed: 0 },
  };
  const inventoryBody = {
    ok: true,
    apiVersion: 1,
    generatedAt: '2026-11-09T10:05:01.000Z',
    complete: true,
    truncated: false,
    sources: [{ id: 'skills-registry', status: 'complete' }],
    entries: [
      {
        key: 'skill:short',
        name: 'short-skill',
        canonicalName: 'short-skill',
        description: '',
        whenToUse: '',
        owner: { kind: 'lifecode', provider: 'lifecode-skill-center', pluginEntryId: 'lsc' },
        origin: { kind: 'file', label: 'library' },
        location: { kind: 'file', path: `${shortPath}\\short-skill\\SKILL.md`, directory: shortPath, rootId: 'root' },
        scope: { kind: 'projectRoot', projectRoot: shortPath, cwd: '' },
        association: { loadedByHost: true, provider: 'lifecode-skill-center', path: '', shadowedBy: null },
        execution: { modelInvocable: true, userInvocable: true },
        identity: { uuid: null, version: null, contentSha256: 'sha-short', manifestSha256: null },
        confidence: 'verified',
        reasons: [],
      },
      {
        key: 'skill:long',
        name: 'long-skill',
        canonicalName: 'long-skill',
        description: '',
        whenToUse: '',
        owner: { kind: 'plugin', provider: 'otro-plugin', pluginEntryId: 'otro' },
        origin: { kind: 'file', label: 'plugin' },
        location: { kind: 'file', path: `${longPath}\\long-skill\\SKILL.md`, directory: longPath, rootId: 'root' },
        scope: { kind: 'projectRoot', projectRoot: longPath, cwd: '' },
        association: { loadedByHost: true, provider: 'otro-plugin', path: '', shadowedBy: null },
        execution: { modelInvocable: true, userInvocable: true },
        identity: { uuid: null, version: null, contentSha256: 'sha-long', manifestSha256: null },
        confidence: 'manifest',
        reasons: [],
      },
    ],
    collisions: [{
      code: 'name-collision',
      severity: 'warn',
      key: 'long-skill',
      rows: [{ key: 'long-skill', owner: 'plugin', location: `${longPath}\\long-skill` }],
      explanation: 'colisión sólo del proyecto extra',
      evidence: [],
    }],
    summary: { total: 2, byOwner: { filesystem: 0, lifecode: 1, plugin: 1 }, shadowed: 0, ambiguous: 0, invalidNames: 0 },
  };
  const detailFor = (projectId, name, cwd) => ({
    ok: true,
    projectId,
    name,
    cwd,
    canonicalPath: cwd,
    state: 'discovered',
    registration: { present: false, uuid: null, manifestSha256: null, registeredAt: null, adoptedAt: null },
    workspace: { workspaceId: projectId === 'proj-short' ? 'ws-short' : 'ws-long', title: name, path: cwd, availability: 'ok' },
    inspection: { status: 'complete', inspectedAt: null, reason: '' },
    counts: { assigned: 0, active: 0, materialized: 0 },
    reasons: [],
    sources: [{ id: 'workspace-registry', status: 'complete' }],
    identity: { projectId, uuid: null, manifestSha256: null, state: 'missing' },
    assignments: [],
    skills: [],
    sessions: { count: 1, archived: 0, source: 'workspace' },
    findings: [],
  });
  const snapshot = {
    ...defaultSnapshot(),
    events: [
      { projectId: null, cwd: `${shortPath}\\src`, type: 'evento-corto' },
      { projectId: null, cwd: longPath, type: 'evento-del-extra' },
    ],
  };
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/state`)) return jsonResponse(200, snapshot);
      if (call.url.includes(`${API}/inventory`)) return jsonResponse(200, inventoryBody);
      if (call.url.includes(`${API}/projects`)) return jsonResponse(200, projectsBody);
      if (call.method === 'POST' && call.body?.action === 'inspect-project') {
        const projectId = call.body?.payload?.projectId;
        const isShort = projectId === 'proj-short';
        return jsonResponse(200, detailFor(projectId, isShort ? 'plugins-dhs' : 'plugins-dhs-extra', isShort ? shortPath : longPath));
      }
      return undefined;
    },
  });

  assert.equal(harness.cards().length, 2, 'los dos proyectos con prefijo común son entradas distintas');
  // El resumen no infla los conflictos: la colisión sólo pertenece al proyecto «-extra».
  assert.match(harness.text(), /1 con conflicto/);
  assert.doesNotMatch(harness.text(), /2 con conflictos/);

  const cardFor = (pathText) => harness.cards().filter((node) => textOf(node).includes(pathText))[0] ?? null;
  const shortCard = cardFor(shortPath);
  assert.ok(shortCard, 'existe la tarjeta del proyecto corto');
  await harness.click(harness.inNode(shortCard, (node) => node.type === 'button' && textOf(node).includes('Inspeccionar skills'))[0]);
  let text = harness.text();
  assert.match(text, /short-skill/, 'la ficha del proyecto corto ve su propia skill');
  assert.doesNotMatch(text, /long-skill/, 'la skill del proyecto «-extra» no se atribuye al corto');
  assert.doesNotMatch(text, /name-collision/, 'la colisión del «-extra» no se atribuye al corto');
  assert.match(text, /evento-corto/, 'la actividad del corto sí aparece');
  assert.doesNotMatch(text, /evento-del-extra/, 'la actividad del «-extra» no aparece en el corto');

  await harness.click(harness.buttons('Cerrar')[0]);
  const longCard = cardFor(`${longPath}`);
  assert.ok(longCard, 'existe la tarjeta del proyecto largo');
  await harness.click(harness.inNode(longCard, (node) => node.type === 'button' && textOf(node).includes('Inspeccionar skills'))[0]);
  text = harness.text();
  assert.match(text, /long-skill/, 'la ficha del «-extra» ve su propia skill');
  assert.doesNotMatch(text, /short-skill/, 'la skill del corto no se atribuye al «-extra»');
  assert.match(text, /name-collision/, 'la colisión sí pertenece al «-extra»');
  assert.match(text, /evento-del-extra/);
  assert.doesNotMatch(text, /evento-corto/);
});

test('«entregas» concuerda en singular y plural en tarjeta y ficha (0, 1 y N)', async () => {
  const projectFor = (projectId, name, materialized) => ({
    projectId,
    name,
    cwd: `C:/work/${projectId}`,
    canonicalPath: `C:/work/${projectId}`,
    state: 'healthy',
    registration: { present: true, uuid: `${projectId}-uuid`, manifestSha256: 'sha', registeredAt: null, adoptedAt: null },
    workspace: { workspaceId: `ws-${projectId}`, title: name, path: `C:/work/${projectId}`, availability: 'ok' },
    inspection: { status: 'complete', inspectedAt: null, reason: '' },
    counts: { assigned: 0, active: 0, materialized },
    reasons: [],
  });
  const projectsBody = {
    ok: true,
    apiVersion: 1,
    generatedAt: '2026-11-09T10:05:00.000Z',
    readable: true,
    complete: true,
    sources: [{ id: 'workspace-registry', status: 'complete' }],
    discovered: [],
    projects: [
      projectFor('proj-zero', 'cero', 0),
      projectFor('proj-one', 'uno', 1),
      projectFor('proj-two', 'dos', 2),
    ],
    current: { cwd: '', workspaceId: null, workspaceTitle: '', projectId: null, confidence: 'unknown', via: '' },
    summary: { discovered: 0, managed: 3 },
  };
  const detailFor = (projectId) => {
    const record = projectsBody.projects.filter((project) => project.projectId === projectId)[0];
    return {
      ...record,
      sources: [],
      identity: { projectId, uuid: record.registration.uuid, manifestSha256: 'sha', state: 'match' },
      assignments: [],
      skills: [],
      sessions: { count: 1, archived: 0, source: 'workspace' },
      collisions: [],
      findings: [],
    };
  };
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/projects`)) return jsonResponse(200, projectsBody);
      if (call.url.includes(`${API}/inventory`)) return jsonResponse(200, defaultInventory());
      if (call.method === 'POST' && call.body?.action === 'inspect-project') {
        return jsonResponse(200, detailFor(call.body?.payload?.projectId));
      }
      return undefined;
    },
  });

  await harness.clickText('Gestionados');
  const cardsText = harness.cards().map((node) => textOf(node)).join(' | ');
  assert.match(cardsText, /0 entregas/, 'cero va en plural');
  assert.match(cardsText, /1 entrega\b/, 'una entrega en singular');
  assert.match(cardsText, /2 entregas/, 'dos entregas en plural');
  assert.doesNotMatch(cardsText, /1 entregas/, 'nunca «1 entregas»');

  const oneCard = harness.cards().filter((node) => textOf(node).includes('C:/work/proj-one'))[0];
  assert.ok(oneCard, 'existe la tarjeta del proyecto con una entrega');
  await harness.click(harness.inNode(oneCard, (node) => node.type === 'button' && textOf(node).includes('Abrir ficha'))[0]);
  const ficha = harness.byClass('lsc-ficha')[0];
  assert.ok(ficha, 'la ficha está abierta');
  assert.match(textOf(ficha), /1 entrega\b/, 'la ficha también usa el singular');
  assert.doesNotMatch(textOf(ficha), /1 entregas/, 'la ficha no repite el literal incorrecto');

  await harness.click(harness.buttons('Cerrar')[0]);
  const twoCard = harness.cards().filter((node) => textOf(node).includes('C:/work/proj-two'))[0];
  assert.ok(twoCard, 'existe la tarjeta del proyecto con dos entregas');
  await harness.click(harness.inNode(twoCard, (node) => node.type === 'button' && textOf(node).includes('Abrir ficha'))[0]);
  const secondFicha = harness.byClass('lsc-ficha')[0];
  assert.ok(secondFicha, 'la segunda ficha está abierta');
  assert.match(textOf(secondFicha), /2 entregas/, 'la ficha pluraliza con N');
});

/* ------------------------------------------- R16.1: el panel no puede quedar en blanco */

test('un Host anterior (capabilities 404 y /workspaces válido) degrada al modo heredado sin romper', async () => {
  // Regresión del panel en blanco: un Host antiguo no publica `/api/capabilities` ni las rutas nuevas.
  // El handshake exige la señal POSITIVA de `/api/workspaces`; sin ella no se activa legacy.
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/capabilities`)) {
        return jsonResponse(404, { ok: false, code: 'not-found', message: 'esa ruta no es de la API' });
      }
      if (call.url.includes(`${API}/workspaces`)) return jsonResponse(200, defaultLegacy());
      return undefined;
    },
  });
  assert.equal(harness.byClass('lsc-diagnostic').length, 0, 'el panel se dibuja, no una tarjeta de error');
  assert.match(harness.text(), /Modo compatibilidad heredada/, 'se anuncia el modo heredado');
  assert.doesNotMatch(harness.text(), /Falló la consulta de proyectos/, 'un 404 de ruta no es un fallo de datos');
  assert.equal(harness.byClass('lsc-notice bad').length, 0, 'sin banners rojos por rutas que no existen');
  assert.equal(harness.cards().length, 1, 'las tarjetas salen del payload heredado de /workspaces');
  assert.equal(harness.runtime.state.hookViolations.length, 0, 'los hooks conservan su orden en este flujo');
});

test('el banner heredado no repite su título y la tarjeta no afirma identidad no consultada', async () => {
  // En legacy la identidad no se consultó: «sin UUID» sería un dato no comprobado. El banner
  // tampoco debe repetir el título dentro del cuerpo (lo pintaba dos veces).
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/capabilities`)) {
        return jsonResponse(404, { ok: false, code: 'not-found', message: 'esa ruta no es de la API' });
      }
      if (call.url.includes(`${API}/workspaces`)) return jsonResponse(200, defaultLegacy());
      return undefined;
    },
  });
  const text = harness.text();
  assert.equal((text.match(/Modo compatibilidad heredada/g) ?? []).length, 1, 'el título del banner aparece una sola vez');
  assert.doesNotMatch(text, /Modo compatibilidad heredada:/, 'el cuerpo no repite el título con dos puntos');
  assert.match(text, /sin comprobar \(backend heredado\)/, 'la identidad se declara no comprobada');
  assert.doesNotMatch(text, /sin UUID|identidad: [0-9a-f]{8}/, 'no se afirma una identidad que no se consultó');

  const english = await openProjects({
    locale: 'en',
    navLabel: 'Projects',
    responder: async (call) => {
      if (call.url.includes(`${API}/capabilities`)) {
        return jsonResponse(404, { ok: false, code: 'not-found', message: 'not an API route' });
      }
      if (call.url.includes(`${API}/workspaces`)) return jsonResponse(200, defaultLegacy());
      return undefined;
    },
  });
  const englishText = english.text();
  assert.equal((englishText.match(/Legacy compatibility mode/g) ?? []).length, 1, 'el título EN aparece una sola vez');
  assert.doesNotMatch(englishText, /Legacy compatibility mode:/, 'el cuerpo EN no repite el título');
  assert.match(englishText, /not checked \(legacy backend\)/, 'la identidad EN se declara no comprobada');
});

test('en compatible-r16 un proyecto sin UUID sí muestra «sin UUID»', async () => {
  const harness = await openProjects();
  const gamma = harness.card('gamma');
  assert.match(textOf(gamma), /identidad: sin UUID/, 'el payload verificado omite UUID y se dice tal cual');
  assert.doesNotMatch(textOf(gamma), /sin comprobar \(backend heredado\)/, 'en compatible no se degrada la identidad');
});

test('un 200 con otra forma y handshake válido es contrato roto, no inventario heredado', async () => {
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/projects`)) return jsonResponse(200, defaultSnapshot());
      if (call.url.includes(`${API}/inventory`)) return jsonResponse(200, defaultSnapshot());
      return undefined;
    },
  });
  assert.equal(harness.byClass('lsc-diagnostic').length, 0, 'el panel se dibuja');
  assert.match(harness.text(), /Falló la consulta de proyectos/, 'se informa el contrato ausente');
  assert.doesNotMatch(harness.text(), /Modo compatibilidad heredada/, 'no se degrada a legacy con la ruta publicada');
  // La única lectura de /workspaces es la de la pestaña Identidad: no se sondea como fallback.
  assert.equal(harness.calls.filter((call) => call.url.includes(`${API}/workspaces`)).length, 1, 'no se sondea /workspaces como fallback');
  assert.equal(harness.cards().length, 0, 'sin contrato no se inventan tarjetas');
});

/* ---------------------------------------------------- R16.2: matriz de compatibilidad */

test('compatible-r16 usa las rutas nuevas y no muestra banner de compatibilidad', async () => {
  const harness = await openProjects();
  assert.match(harness.text(), /3 workspaces · 1 gestionados/);
  assert.doesNotMatch(harness.text(), /Modo compatibilidad heredada/);
  const capabilitiesRead = harness.calls.filter((call) => call.url.includes(`${API}/capabilities`));
  assert.equal(capabilitiesRead.length, 1, 'el handshake se pide una vez al entrar');
  assert.equal(harness.calls.filter((call) => call.url.includes(`${API}/workspaces`)).length, 1, 'la pestaña Identidad conserva su lectura de /workspaces');
});

test('el 404 de ruta sin señal positiva es incompatible y detiene las operaciones', async () => {
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/capabilities`)) {
        return jsonResponse(404, { ok: false, code: 'not-found', message: 'esa ruta no es de la API' });
      }
      if (call.url.includes(`${API}/workspaces`)) {
        return jsonResponse(404, { ok: false, code: 'not-found', message: 'tampoco' });
      }
      return undefined;
    },
  });
  assert.match(harness.text(), /Backend incompatible/);
  assert.match(harness.text(), /Cliente: contrato 2/);
  assert.equal(harness.calls.filter((call) => call.url.includes(`${API}/projects`)).length, 0, 'no se consulta /projects');
  assert.equal(harness.calls.filter((call) => call.url.includes(`${API}/inventory`)).length, 0, 'no se consulta /inventory');
  const register = harness.buttons('Registrar proyecto')[0];
  assert.ok(register, 'el botón de registro sigue visible');
  assert.equal(register.props.disabled, true, 'registrar queda deshabilitado');
  assert.match(register.props.title, /contrato R16\.2/i);
  const chip = harness.buttons('sin comprobar')[0];
  assert.ok(chip, 'los indicadores sin datos se anuncian como sin comprobar');
  assert.equal(chip.props.disabled, true, 'no se puede filtrar por un indicador sin comprobar');
  assert.doesNotMatch(harness.text(), /0 skills|0 colisiones|0 conflictos/, 'nunca ceros verificados');
  assert.ok(harness.buttons('Copiar diagnóstico').length >= 1, 'ofrece copiar el diagnóstico saneado');
});

test('un 503 del handshake es backend no disponible, con reintento y sin legacy', async () => {
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/capabilities`)) {
        return jsonResponse(503, { ok: false, error: { code: 'auth-unavailable', message: 'sin autorización' } });
      }
      return undefined;
    },
  });
  assert.match(harness.text(), /Backend no disponible/);
  assert.doesNotMatch(harness.text(), /Modo compatibilidad heredada/);
  assert.equal(harness.calls.filter((call) => call.url.includes(`${API}/workspaces`)).length, 1, 'sólo la pestaña Identidad lee /workspaces');
  assert.equal(harness.buttons('Reintentar').length, 1, 'ofrece reintentar');
});

test('un 401 en las rutas de datos es error de autorización, no de contrato', async () => {
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/projects`) || call.url.includes(`${API}/inventory`)) {
        return jsonResponse(401, { ok: false, code: 'unauthorized', message: 'sin sesión' });
      }
      return undefined;
    },
  });
  assert.match(harness.text(), /Autorización pendiente/);
  assert.doesNotMatch(harness.text(), /Backend incompatible/);
  assert.equal(harness.calls.filter((call) => call.url.includes(`${API}/workspaces`)).length, 1, 'no se sondea legacy');
});

test('en legacy las acciones R16 están deshabilitadas con motivo y abrir workspace sigue disponible', async () => {
  const harness = await openProjects({ responder: async (call) => legacyRouteResponse(call) });
  const card = harness.cards()[0];
  const inspect = harness.inNode(card, (node) => node.type === 'button' && textOf(node).includes('Inspeccionar skills'))[0];
  assert.ok(inspect, 'la acción sigue visible para explicar por qué no se puede');
  assert.equal(inspect.props.disabled, true, 'inspeccionar deshabilitado en legacy');
  assert.match(inspect.props.title, /contrato R16\.2/i);
  const open = harness.inNode(card, (node) => node.type === 'button' && textOf(node).includes('Abrir en DSH'))[0];
  assert.equal(open.props.disabled, false, 'abrir el workspace no depende del contrato nuevo');
  await harness.click(open);
  assert.deepEqual(harness.opened, ['ws-old']);
  assert.doesNotMatch(harness.text(), /0 skills|0 colisiones/, 'la ausencia de inventario no se pinta como cero');
});

test('el reintento del handshake no duplica peticiones mientras corre', async () => {
  let release = null;
  const harness = await openProjects({
    responder: async (call) => {
      if (call.url.includes(`${API}/capabilities`) && release !== null) {
        return new Promise((resolve) => { release = resolve; });
      }
      if (call.url.includes(`${API}/capabilities`)) {
        return jsonResponse(503, { ok: false, error: { code: 'auth-unavailable', message: 'sin autorización' } });
      }
      return undefined;
    },
  });
  const retry = harness.buttons('Reintentar')[0];
  assert.ok(retry, 'hay reintento');
  // Segunda llamada en vuelo: el botón se deshabilita y no se dispara otra petición.
  release = () => {};
  harness.calls.length = 0;
  await harness.click(retry);
  const capabilityCalls = harness.calls.filter((call) => call.url.includes(`${API}/capabilities`));
  assert.equal(capabilityCalls.length, 1, 'un reintento = un handshake');
  const second = harness.buttons('Reintentar')[0];
  assert.equal(second.props.disabled, true, 'mientras corre, reintentar queda deshabilitado');
  await harness.click(second);
  assert.equal(harness.calls.filter((call) => call.url.includes(`${API}/capabilities`)).length, 1, 'el segundo clic no dispara nada');
});

test('una excepción de render muestra la tarjeta de diagnóstico y «Reintentar» repinta', async () => {
  const harness = await createPanelHarness({ uiWorkspaceGuard: true });
  // El servicio se lee al pintar la vista Proyectos: pulsar la navegación provoca el fallo real.
  await harness.click(harness.buttons('Proyectos')[0]);
  const card = harness.byClass('lsc-diagnostic')[0];
  assert.ok(card, 'la frontera de error dibuja una tarjeta en vez de dejar el área vacía');
  assert.match(textOf(card), /El panel no pudo dibujarse/, 'la tarjeta se titula');
  assert.match(textOf(card), /cannot get property "openWorkspace" without inject/, 'el mensaje real del fallo queda visible');
  assert.match(textOf(card), /render/, 'se informa el paso en el que falló');

  // El ctx se repara (como haría una versión del harness con el servicio disponible) y se reintenta.
  harness.ctx.get('uiWorkspace').guarded = false;
  await harness.clickText('Reintentar');
  assert.equal(harness.byClass('lsc-diagnostic').length, 0, 'la tarjeta desaparece al reintentar');
  assert.match(harness.text(), /Proyectos/, 'el panel vuelve a dibujarse con su navegación');
});

test('el runtime detecta un orden de hooks inestable (React real desmontaría el árbol)', async () => {
  const runtime = createRuntime();
  let flipped = false;
  function Toy() {
    if (flipped) {
      runtime.useState(0);
      runtime.useRef(null);
    } else {
      runtime.useRef(null);
      runtime.useState(0);
    }
    return null;
  }
  runtime.state.component = createElement(Toy, {});
  runtime.state.dirty = true;
  await runtime.settle(2);
  assert.equal(runtime.state.hookViolations.length, 0, 'el primer render es estable');

  flipped = true;
  runtime.state.dirty = true;
  assert.throws(() => runtime.render(), /orden de hooks inestable en Toy/);
  assert.equal(runtime.state.hookViolations.length, 1, 'la violación queda registrada con su componente');
});

// --- R16.3: honestidad de la inspección, inventario global, colisiones y ficha de Skill ---

function respondWith({ projects, inventory }) {
  return (call) => {
    if (call.url.includes(`${API}/capabilities`)) return jsonResponse(200, defaultCapabilities());
    if (call.url.includes(`${API}/inventory`)) return jsonResponse(200, inventory);
    if (call.url.includes(`${API}/projects`)) return jsonResponse(200, projects);
    if (call.url.includes(`${API}/workspaces`)) return jsonResponse(200, defaultLegacy());
    return undefined;
  };
}

function managedProjects(overrides = {}) {
  const base = defaultProjects();
  const record = {
    ...base.projects[0],
    inspection: { status: 'complete', inspectedAt: '2026-11-02T00:00:00.000Z', reason: '' },
    ...overrides,
  };
  return { ...base, discovered: [], projects: [record] };
}

function inventoryWith(overrides = {}) {
  const base = defaultInventory();
  return {
    ...base,
    entries: [],
    collisions: [],
    summary: { total: 0, byOwner: {}, shadowed: 0, ambiguous: 0, invalidNames: 0 },
    ...overrides,
  };
}

test('una inspección no ejecutada no se pinta como «sin skills»: not-run, completa-vacía y parcial se distinguen', async () => {
  const notRun = await openProjects({ responder: respondWith({ projects: managedProjects({ inspection: { status: 'not-run', inspectedAt: null, reason: '' } }), inventory: inventoryWith() }) });
  await notRun.clickText('Gestionados');
  let cardText = textOf(notRun.card('managed-one'));
  assert.match(cardText, /sin inspeccionar todavía: no se ejecutó ninguna inspección/, 'not-run se nombra como tal');
  assert.doesNotMatch(cardText, /inspección completa: 0/, 'not-run no se disfraza de inspección completa vacía');
  assert.doesNotMatch(notRun.text(), /inspección completa: 0/, 'ninguna tarjeta afirma un cero que no se comprobó');

  const empty = await openProjects({ responder: respondWith({ projects: managedProjects(), inventory: inventoryWith() }) });
  await empty.clickText('Gestionados');
  cardText = textOf(empty.card('managed-one'));
  assert.match(cardText, /inspección completa: 0 en el ámbito de este proyecto/, 'completa-vacía sí es un cero verificado');
  assert.match(cardText, /el inventario global tiene 0/, 'y declara el total global en la misma frase');

  const partial = await openProjects({ responder: respondWith({ projects: managedProjects(), inventory: inventoryWith({ complete: false }) }) });
  await partial.clickText('Gestionados');
  cardText = textOf(partial.card('managed-one'));
  assert.match(cardText, /inspección parcial: puede haber skills que no se listaron/, 'inventario parcial se distingue de completa-vacía');
  assert.doesNotMatch(cardText, /inspección completa: 0/, 'parcial nunca afirma un cero');

  const failed = await openProjects({ responder: respondWith({ projects: managedProjects({ inspection: { status: 'failed', inspectedAt: null, reason: 'loader caído' } }), inventory: inventoryWith() }) });
  await failed.clickText('Gestionados');
  assert.match(textOf(failed.card('managed-one')), /la inspección falló: no se pudo comprobar/, 'failed se nombra como fallo, no como vacío');
});

test('el resumen de propietarios consume claves nuevas y heredadas y no inventa ceros', async () => {
  const legacyKeys = await openProjects({
    responder: respondWith({
      projects: defaultProjects(),
      inventory: inventoryWith({ summary: { total: 85, byOwner: { filesystem: 73, lifecode: 4, bundled: 8 }, shadowed: 0, ambiguous: 8, invalidNames: 0 } }),
    }),
  });
  const legacyText = legacyKeys.text();
  assert.match(legacyText, /4 propias/, 'lifecode heredada se lee como propia');
  assert.match(legacyText, /73 en disco sin propietario/, 'filesystem conserva su categoría, no «desconocido»');
  assert.match(legacyText, /8 del Host/, 'bundled heredada se lee como Host');
  assert.match(legacyText, /propietario desconocido: sin comprobar/, 'sin clave unknown no se pinta 0');
  assert.doesNotMatch(legacyText, /0 con propietario desconocido/, 'no hay cero falso de desconocidas');

  const newKeys = await openProjects({
    responder: respondWith({
      projects: defaultProjects(),
      inventory: inventoryWith({ summary: { total: 85, byOwner: { own: 4, external: 2, filesystem: 70, host: 9, unknown: 0 }, shadowed: 0, ambiguous: 0, invalidNames: 0 } }),
    }),
  });
  const newText = newKeys.text();
  assert.match(newText, /4 propias/, 'clave own');
  assert.match(newText, /2 externas/, 'clave external');
  assert.match(newText, /70 en disco sin propietario/, 'clave filesystem');
  assert.match(newText, /9 del Host/, 'clave host');
  assert.match(newText, /0 con propietario desconocido/, 'clave unknown 0 sí es un cero declarado');
  assert.match(newText, /Las colisiones globales \(0\) no son «proyectos con conflicto» \(0\)/, 'la UI explica que colisiones globales no son proyectos con conflicto');
});

test('la pestaña Colisiones filtra por código, severidad y propietario, y es sólo lectura', async () => {
  const collisions = [
    {
      code: 'name-collision', severity: 'warn', key: 'own-skill',
      rows: [{ key: 'own-skill', owner: 'lifecode', location: 'C:/work/alpha/own-skill/SKILL.md' }],
      explanation: 'dos skills con el mismo nombre', evidence: [],
    },
    {
      code: 'legacy-collision', severity: 'warn', key: 'legacy-skill',
      rows: [{ key: 'legacy-skill', owner: 'filesystem', location: 'C:/work/legacy/SKILL.md' }],
      explanation: 'una skill legacy choca con la biblioteca', evidence: [],
    },
  ];
  const inventory = inventoryWith({
    entries: defaultInventory().entries,
    collisions,
    summary: { total: 1, byOwner: { lifecode: 1 }, shadowed: 0, ambiguous: 0, invalidNames: 0 },
  });
  const harness = await openProjects({ responder: respondWith({ projects: defaultProjects(), inventory }) });

  await harness.clickText('con colisiones');
  assert.match(harness.text(), /2 de 2 colisiones/, 'el contador declara el total');
  assert.match(harness.text(), /Sólo lectura: esta vista no borra, adopta ni reasigna nada/, 'la vista se declara de sólo lectura');
  const codeSelect = harness.all((node) => node.type === 'select' && node.props?.title === 'Tipo de colisión')[0];
  const severitySelect = harness.all((node) => node.type === 'select' && node.props?.title === 'Severidad')[0];
  const ownerSelect = harness.all((node) => node.type === 'select' && node.props?.title === 'Propietario')[0];
  assert.ok(codeSelect && severitySelect && ownerSelect, 'hay tres filtros: código, severidad y propietario');
  const optionTexts = harness.all((node) => node.type === 'option').map((node) => textOf(node));
  for (const code of ['identity-duplicate', 'name-collision', 'path-collision', 'content-collision', 'assignment-shadowed', 'legacy-collision']) {
    assert.ok(optionTexts.some((value) => value.includes(code)), `el filtro ofrece el código ${code}`);
  }
  for (const severity of ['bloqueante', 'aviso', 'informativa']) {
    assert.ok(optionTexts.some((value) => value.includes(severity)), `el filtro ofrece la severidad ${severity}`);
  }

  await harness.change(codeSelect, 'legacy-collision');
  assert.match(harness.text(), /1 de 2 colisiones/, 'filtrar por código reduce el contador');
  assert.doesNotMatch(harness.text(), /dos skills con el mismo nombre/, 'la fila filtrada desaparece');

  await harness.change(codeSelect, 'content-collision');
  assert.match(harness.text(), /Ninguna colisión coincide con los filtros/, 'filtro sin coincidencias se dice, no se deja vacío');
  await harness.change(codeSelect, '');
  assert.match(harness.text(), /2 de 2 colisiones/, 'quitar el filtro restaura');

  const skillButton = harness.all((node) => node.type === 'button'
    && node.props?.title === 'Abrir la ficha de esta skill'
    && textOf(node).includes('own-skill'))[0];
  await harness.click(skillButton);
  const dialog = harness.byClass('lsc-ficha').find((node) => textOf(node).includes('Identidad e integridad'));
  assert.ok(dialog, 'la fila de colisión abre la ficha de la skill');
  const dialogText = textOf(dialog);
  assert.match(dialogText, /Confianza/, 'la ficha muestra la confianza');
  assert.match(dialogText, /verified/, 'y su valor real');
  assert.match(dialogText, /lifecode/, 'y el propietario declarado');
  assert.match(dialogText, /name-collision/, 'y la colisión que la afecta');
  assert.doesNotMatch(dialogText, /Eliminar|Borrar|Adoptar|Desinstalar|Desvincular/, 'no ofrece acciones destructivas');
  const dialogButtons = harness.inNode(dialog, (node) => node.type === 'button');
  assert.ok(dialogButtons.length >= 1, 'la ficha tiene al menos un botón de cierre');
  // La ficha permite exportar el paquete (lectura) y cerrar; nada que borre o adopte.
  for (const button of dialogButtons) {
    assert.ok(
      ['Cerrar', 'Exportar en la ficha'].includes(textOf(button).trim()),
      'la ficha sólo ofrece cerrar o exportar, no acciones destructivas',
    );
  }
  assert.ok(dialogButtons.some((button) => textOf(button).trim() === 'Cerrar'), 'la ficha se puede cerrar');
});

test('la ficha de un proyecto abre la ficha global de la skill detectada con sus campos reales', async () => {
  const base = defaultInventory();
  const inventory = {
    ...base,
    entries: [{
      ...base.entries[0],
      location: { ...base.entries[0].location, path: 'C:/work/managed/own-skill/SKILL.md', directory: 'C:/work/managed' },
      scope: { ...base.entries[0].scope, projectRoot: 'C:/work/managed' },
    }],
  };
  const harness = await openProjects({ responder: respondWith({ projects: defaultProjects(), inventory }) });
  await harness.clickText('Gestionados');
  await harness.click(harness.inNode(harness.card('managed-one'), (node) => node.type === 'button' && textOf(node).includes('Abrir ficha'))[0]);
  const projectDialog = harness.byClass('lsc-ficha').find((node) => textOf(node).includes('Skills asociadas'));
  assert.ok(projectDialog, 'la ficha del proyecto está abierta');
  const skillButton = harness.inNode(projectDialog, (node) => node.type === 'button' && textOf(node).trim() === 'own-skill')[0];
  assert.ok(skillButton, 'la fila detectada es un botón accesible');
  await harness.click(skillButton);
  const dialog = harness.byClass('lsc-ficha').find((node) => textOf(node).includes('Identidad e integridad'));
  assert.ok(dialog, 'se abre la ficha de la skill desde la ficha del proyecto');
  const dialogText = textOf(dialog);
  assert.match(dialogText, /Propietario, origen y confianza tal como los declara el inventario/, 'sección de origen con su hint');
  assert.match(dialogText, /Confianza/, 'confianza');
  assert.match(dialogText, /verified/, 'valor de confianza');
  assert.match(dialogText, /El registro de skills no publica la lista de proveedores/, 'limitación de proveedores declarada');
});

test('los recuentos de propietario se leen del resumen del servidor y no se recalculan en la UI', async () => {
  // Tres entradas de disco, pero el backend declara 7: manda el servidor. Si la UI recontara las
  // entradas diría «3 en disco» y contradiría el total del propio payload.
  const base = defaultInventory();
  const filesystemEntry = {
    ...base.entries[0],
    key: 'disk-skill-a',
    owner: { kind: 'filesystem', provider: 'host-scan', pluginEntryId: null },
  };
  const inventory = inventoryWith({
    entries: [filesystemEntry, { ...filesystemEntry, key: 'disk-skill-b' }, { ...filesystemEntry, key: 'disk-skill-c' }],
    summary: { total: 85, byOwner: { own: 0, external: 0, filesystem: 7, host: 0, unknown: 0 }, shadowed: 0, ambiguous: 0, invalidNames: 0 },
  });
  const harness = await openProjects({ responder: respondWith({ projects: defaultProjects(), inventory }) });
  assert.match(harness.text(), /7 en disco sin propietario/, 'el recuento sale de summary.byOwner');
  assert.doesNotMatch(harness.text(), /3 en disco sin propietario/, 'la UI no re-clasifica las entradas por su cuenta');
  assert.match(harness.text(), /0 propias/, 'un 0 declarado por el servidor sí se pinta');

  // Inventario incompleto: la categoría que el backend no publica va a «sin comprobar» y su title
  // explica el motivo; nunca un 0.
  const partial = inventoryWith({
    complete: false,
    entries: [],
    summary: { total: 10, byOwner: { own: 4 }, shadowed: 0, ambiguous: 0, invalidNames: 0 },
  });
  const partialHarness = await openProjects({ responder: respondWith({ projects: defaultProjects(), inventory: partial }) });
  const pending = partialHarness.all((node) => node.type === 'span' && textOf(node).includes('externas: sin comprobar'))[0];
  assert.ok(pending, 'categoría no publicada se declara sin comprobar');
  assert.match(pending.props.title, /el inventario está incompleto o una fuente no respondió/, 'el motivo viaja en el title');
});

test('las colisiones se agrupan por código, cuentan filas y distinguen la historia del compilador', async () => {
  const manyRows = Array.from({ length: 20 }, (_, index) => ({
    key: 'legacy-' + index, owner: 'filesystem', location: 'C:/legacy/' + index + '/SKILL.md',
  }));
  const collisions = [
    { code: 'legacy-collision', severity: 'warn', key: 'compiler-projects', count: 46, rows: manyRows, explanation: 'raíz heredada', evidence: [] },
    { code: 'legacy-collision', severity: 'warn', key: 'compiler-projects-2', count: 8, rows: manyRows.slice(0, 3), explanation: 'otra raíz heredada', evidence: [] },
    { code: 'name-collision', severity: 'warn', key: 'own-skill', rows: [{ key: 'own-skill', owner: 'lifecode', location: 'C:/work/alpha/own-skill/SKILL.md' }], explanation: 'dos nombres iguales', evidence: [] },
  ];
  const inventory = inventoryWith({
    entries: defaultInventory().entries,
    collisions,
    summary: { total: 1, byOwner: { own: 1 }, shadowed: 0, ambiguous: 0, invalidNames: 0 },
  });
  const harness = await openProjects({ responder: respondWith({ projects: defaultProjects(), inventory }) });
  await harness.clickText('con colisiones');
  assert.match(harness.text(), /legacy-collision · 2/, 'las colisiones se agrupan por código con su recuento');
  assert.match(harness.text(), /name-collision · 1/, 'y cada grupo muestra cuántas hay');
  assert.match(harness.text(), /Historia del compilador/i, 'legacy-collision se etiqueta como historia, no conflicto vivo');
  assert.match(harness.text(), /46 entradas agrupadas/, 'una colisión con muchas filas declara su total sin repetirlas');
  assert.match(harness.text(), /… y 12 filas más/, 'las filas grandes se recortan en vez de repetir 20 líneas');
  assert.ok(harness.byClass('lsc-collision-row').length === 3, 'una tarjeta por colisión, no una por fila');
  assert.match(harness.text(), /Sólo lectura/, 'la vista no ofrece resolución');
});

test('loadedByHost es tri-estado: true carga, false sólo es sombreada con proveedor, null no se determina', async () => {
  const base = defaultInventory();
  const entry = base.entries[0];
  const openDialogFor = async (association) => {
    const inventory = inventoryWith({
      entries: [{ ...entry, association: { ...entry.association, ...association } }],
      collisions: [{
        code: 'name-collision', severity: 'warn', key: entry.key,
        rows: [{ key: entry.key, owner: 'lifecode', location: entry.location.path }], explanation: '', evidence: [],
      }],
      summary: { total: 1, byOwner: { own: 1 }, shadowed: 0, ambiguous: 0, invalidNames: 0 },
    });
    const harness = await openProjects({ responder: respondWith({ projects: defaultProjects(), inventory }) });
    await harness.clickText('con colisiones');
    await harness.click(harness.all((node) => node.type === 'button' && node.props?.title === 'Abrir la ficha de esta skill')[0]);
    const dialog = harness.byClass('lsc-ficha').find((node) => textOf(node).includes('Identidad e integridad'));
    assert.ok(dialog, 'la ficha de la skill está abierta');
    return textOf(dialog);
  };

  const loaded = await openDialogFor({ loadedByHost: true });
  assert.match(loaded, /Cargada por el Host/, 'true se pinta como cargada');

  const shadowed = await openDialogFor({ loadedByHost: false, shadowedBy: 'otro-proveedor' });
  assert.match(shadowed, /sombreada por otro-proveedor/, 'false con shadowedBy dice quién la sirve');

  const undetermined = await openDialogFor({ loadedByHost: null, shadowedBy: null });
  assert.match(undetermined, /carga no determinada/, 'null se declara no determinado');
  assert.doesNotMatch(undetermined, /No\/?cargada|Loaded by the Host/, 'null no se disfraza de «no cargada»');
});


/* ------------------------------------------- portabilidad R16.4 (task-29) */

function librarySnapshot() {
  return {
    ...defaultSnapshot(),
    skills: [{
      id: 'skill_demo',
      title: 'Demo skill',
      currentVersion: '1.2.0',
      status: 'published',
      versions: [{ version: '1.2.0' }, { version: '1.0.0' }],
      origin: { kind: 'file', from: 'otro-centro' },
    }],
  };
}

function previewFixture(overrides = {}) {
  return {
    ok: true,
    apiVersion: 1,
    contractVersion: 2,
    preview: {
      name: 'Demo paquete',
      description: 'Una skill de demo',
      version: '1.2.0',
      origin: {
        app: 'lifecode-skill-center',
        skillId: 'skill_demo',
        version: '1.2.0',
        exportedAt: '2026-11-09T10:00:00.000Z',
        from: 'otro-centro',
      },
      identity: { skillId: 'skill_demo', checksum: 'sha256:abc', bytes: 1234 },
      compatibility: { schema: 'lifecode-skill-center/skill-bundle', schemaVersion: 1, supported: true },
      integrity: { checksum: 'ok' },
      portability: { portable: true, warnings: [] },
      conflicts: { sameId: { exists: false, currentVersion: null }, sameName: [], alreadyImported: [] },
      plan: { action: 'create', targetIdCandidate: 'skill_demo' },
      preflight: { decision: 'allow', findings: [], reasons: [] },
      ...overrides,
    },
  };
}

/** Monta el panel en la vista Biblioteca con una snapshot con skills y un guion de respuestas. */
async function openLibrary(script = {}) {
  const snapshot = librarySnapshot();
  const responder = async (call) => {
    if (call.url.includes(`${API}/state`)) {
      if (call.method === 'GET') return jsonResponse(200, snapshot);
      const action = call.body?.action;
      if (action === 'open') return jsonResponse(200, snapshot);
      if (typeof script.state === 'function') {
        const custom = await script.state(call);
        if (custom !== undefined) return custom;
      }
      return jsonResponse(200, { ok: true });
    }
    return undefined;
  };
  const harness = await createPanelHarness({ responder });
  const nav = harness.buttons('Biblioteca')[0];
  assert.ok(nav, 'existe el botón de navegación «Biblioteca»');
  await harness.click(nav);
  return harness;
}

async function expandPortability(harness) {
  const toggle = harness.buttons('Portabilidad de Skills')[0];
  assert.ok(toggle, 'existe el conmutador de Portabilidad de Skills');
  await harness.click(toggle);
  return harness;
}

test('la portabilidad empieza plegada y no renderiza el importador hasta abrirla', async () => {
  const harness = await openLibrary();
  assert.equal(harness.all((node) => node.type === 'textarea').length, 0, 'plegada: no hay textarea de importación');
  assert.match(harness.text(), /Portabilidad de Skills/, 'se anuncia la sección');
  assert.match(harness.text(), /Función avanzada/, 'con su insignia de función avanzada');
  await expandPortability(harness);
  assert.equal(harness.all((node) => node.type === 'textarea').length, 1, 'al abrirla aparece el área de pegado');
  assert.match(harness.text(), /nunca escribe al pegarlo ni al elegirlo/, 'la ayuda dice que validar no importa');
  assert.match(harness.text(), /Pegar o elegir un archivo no importa nada/, 'y lo repite junto al botón');
});

test('pegar un paquete no importa y validar llama inspect-bundle sin escribir', async () => {
  const harness = await openLibrary({
    state: (call) => (call.body?.action === 'inspect-bundle' ? jsonResponse(200, previewFixture()) : undefined),
  });
  await expandPortability(harness);
  const area = harness.all((node) => node.type === 'textarea')[0];
  await harness.change(area, '{"schema":"lifecode-skill-center/skill-bundle"}');
  assert.equal(postsTo(harness, 'import-bundle').length, 0, 'pegar no importa');
  assert.equal(postsTo(harness, 'inspect-bundle').length, 0, 'ni valida solo');
  await harness.clickText('Validar paquete');
  const inspections = postsTo(harness, 'inspect-bundle');
  assert.equal(inspections.length, 1, 'validar hace exactamente una lectura');
  assert.deepEqual(inspections[0].body, {
    action: 'inspect-bundle',
    payload: { bundle: '{"schema":"lifecode-skill-center/skill-bundle"}', from: 'panel' },
    cwd: '',
  }, 'el paquete viaja tal cual, sin confirmar nada');
  assert.equal(postsTo(harness, 'import-bundle').length, 0, 'validar nunca escribe');
  const preview = harness.byClass('lsc-bundle-preview')[0];
  assert.ok(preview, 'se muestra la vista previa obligatoria');
  const previewText = textOf(preview);
  for (const fragment of ['Demo paquete', 'Válido', 'compatible', 'checksum correcto', 'Crear', 'Permitido']) {
    assert.ok(previewText.includes(fragment), `la vista previa muestra ${fragment}`);
  }
  assert.equal(harness.buttons('Importar una copia').length, 1, 'con paquete válido hay confirmación explícita');
});

test('la vista previa traduce plan y preflight, conserva hallazgos y no repite «Esquema»', async () => {
  const harness = await openLibrary({
    state: (call) => (call.body?.action === 'inspect-bundle'
      ? jsonResponse(200, previewFixture({
          plan: { action: 'copy', targetIdCandidate: 'skill_demo' },
          preflight: { decision: 'block', findings: [{ code: 'name-collision', severity: 'block', message: 'ya existe ese nombre' }], reasons: ['nombre duplicado'] },
        }))
      : undefined),
  });
  await expandPortability(harness);
  const area = harness.all((node) => node.type === 'textarea')[0];
  await harness.change(area, '{"schema":"lifecode-skill-center/skill-bundle"}');
  await harness.clickText('Validar paquete');
  const preview = harness.byClass('lsc-bundle-preview')[0];
  assert.ok(preview, 'hay vista previa');
  const previewText = textOf(preview);
  assert.match(previewText, /Crear copia con otro id/, 'plan.copy se traduce');
  assert.match(previewText, /Bloqueado/, 'preflight.block se traduce');
  assert.match(previewText, /name-collision/, 'los findings siguen visibles con su código');
  assert.match(previewText, /ya existe ese nombre/, 'el mensaje del finding se conserva');
  assert.match(previewText, /nombre duplicado/, 'los reasons se conservan');
  assert.doesNotMatch(previewText, /(^|\s)copy(\s|·|$)/, 'no se pinta el valor técnico crudo «copy»');
  assert.doesNotMatch(previewText, /(^|\s)block(\s|·|$)/, 'no se pinta el valor técnico crudo «block»');
  const esquemaRows = (previewText.match(/Esquema/g) || []).length;
  assert.equal(esquemaRows, 1, 'sólo una fila se llama «Esquema»');
  assert.match(previewText, /Compatibilidad/, 'la compatibilidad tiene su propia etiqueta');
  assert.match(previewText, /Comprobación previa/, 'el preflight ya no se pinta en inglés');
});

async function validatePreview(harness, fixture) {
  harness.setResponder((call) => {
    if (call.body?.action === 'inspect-bundle') return jsonResponse(200, fixture);
    return undefined;
  });
  await expandPortability(harness);
  const area = harness.all((node) => node.type === 'textarea')[0];
  await harness.change(area, '{"schema":"lifecode-skill-center/skill-bundle"}');
  await harness.clickText('Validar paquete');
  return harness.byClass('lsc-bundle-preview')[0];
}

test('la vista previa avisa de que la compuerta de calidad se evalúa al importar', async () => {
  const harness = await openLibrary();
  const preview = await validatePreview(harness, previewFixture());
  assert.match(textOf(preview), /La compuerta de calidad se evalúa al importar; si rechaza el contenido, no se creará ninguna copia/,
    'la nota de compuerta está en la vista previa');
});

test('«Crear copia con otro id» sólo se ofrece cuando el plan la declara y el id está ocupado', async () => {
  // already-imported: el servidor volvería a rechazar aunque sameId esté ocupado y el plan diga copy.
  const yaImportada = await openLibrary();
  const previewYa = await validatePreview(yaImportada, previewFixture({
    conflicts: { sameId: { exists: true, currentVersion: '1.0.0' }, sameName: [], alreadyImported: [{ id: 'skill_demo', importedAt: '2026-11-08T10:00:00.000Z' }] },
    plan: { action: 'copy', targetIdCandidate: 'skill_demo-copia' },
  }));
  assert.match(textOf(previewYa), /Ya importada|already/i, 'se explica que ya está importada');
  assert.equal(yaImportada.buttons('Crear copia con otro id').length, 0, 'ya importada no ofrece copia');
  assert.equal(yaImportada.buttons('Cancelar').length, 1, 'sólo se puede cancelar');

  // blocked: el preflight bloquea; tampoco hay copia.
  const bloqueada = await openLibrary();
  const previewBloqueada = await validatePreview(bloqueada, previewFixture({
    conflicts: { sameId: { exists: false }, sameName: [], alreadyImported: [] },
    plan: { action: 'blocked', targetIdCandidate: 'skill_demo' },
    preflight: { decision: 'block', findings: [{ code: 'project-unavailable', severity: 'block', message: 'proyecto no disponible' }], reasons: [] },
  }));
  assert.match(textOf(previewBloqueada), /Bloqueado/, 'se explica el bloqueo');
  assert.equal(bloqueada.buttons('Crear copia con otro id').length, 0, 'bloqueada no ofrece copia');
  assert.equal(bloqueada.buttons('Cancelar').length, 1, 'sólo se puede cancelar');

  // duplicate-identity con plan copy: aquí sí resuelve crear la copia.
  const conflicto = await openLibrary();
  await validatePreview(conflicto, previewFixture({
    conflicts: { sameId: { exists: true, currentVersion: '1.0.0' }, sameName: [], alreadyImported: [] },
    plan: { action: 'copy', targetIdCandidate: 'skill_demo-copia' },
  }));
  assert.equal(conflicto.buttons('Crear copia con otro id').length, 1, 'el conflicto con plan copy ofrece la copia');
  assert.equal(conflicto.buttons('Cancelar').length, 1, 'y también permite cancelar');
});

test('evaluation-failed muestra los códigos de la compuerta y ningún éxito', async () => {
  const harness = await openLibrary({
    state: (call) => {
      if (call.body?.action === 'inspect-bundle') return jsonResponse(200, previewFixture());
      if (call.body?.action === 'import-bundle') {
        return jsonResponse(400, {
          ok: false,
          code: 'evaluation-failed',
          message: 'la compuerta rechazó el contenido',
          evaluation: { checks: [{ code: 'broken-reference', severity: 'block', message: 'enlace roto' }] },
        });
      }
      return undefined;
    },
  });
  await expandPortability(harness);
  const area = harness.all((node) => node.type === 'textarea')[0];
  await harness.change(area, '{"schema":"lifecode-skill-center/skill-bundle"}');
  await harness.clickText('Validar paquete');
  await harness.clickText('Importar una copia');
  const text = harness.text();
  assert.match(text, /evaluation-failed/, 'se ve el código de la compuerta');
  assert.match(text, /broken-reference/, 'se ve el código del check');
  assert.match(text, /bloqueante/, 'la severidad se traduce');
  assert.match(text, /La compuerta de calidad rechazó el contenido/, 'el estado se explica en castellano');
  assert.doesNotMatch(text, /Importada con el id/, 'un fallo de compuerta no produce éxito');
  assert.doesNotMatch(text, /Abrir en Biblioteca/, 'ni enlace de éxito');
});

test('el renombrado se avisa una sola vez (en el resultado inline)', async () => {
  const harness = await openLibrary({
    state: (call) => {
      if (call.body?.action === 'inspect-bundle') {
        return jsonResponse(200, previewFixture({
          conflicts: { sameId: { exists: true, currentVersion: '1.0.0' }, sameName: [], alreadyImported: [] },
          plan: { action: 'copy', targetIdCandidate: 'skill_demo-copia' },
        }));
      }
      if (call.body?.action === 'import-bundle') {
        return jsonResponse(200, { ok: true, imported: true, id: 'skill_demo-copia', renamed: true, renamedFrom: 'skill_demo' });
      }
      return undefined;
    },
  });
  await expandPortability(harness);
  const area = harness.all((node) => node.type === 'textarea')[0];
  await harness.change(area, '{"schema":"lifecode-skill-center/skill-bundle"}');
  await harness.clickText('Validar paquete');
  const copiaButtons = harness.buttons('Crear copia con otro id');
  assert.equal(copiaButtons.length, 1, 'hay botón de copia');
  await harness.click(copiaButtons[0]);
  const text = harness.text();
  const inline = (text.match(/Renombrada desde «skill_demo»/g) || []).length;
  assert.equal(inline, 1, 'el aviso de renombrado aparece una sola vez');
  assert.doesNotMatch(text, /renombrada porque el id ya existía/, 'no se duplica con el toast heredado');
  assert.match(text, /Importada con el id «skill_demo-copia»/, 'el resultado inline dice el id creado');
});


test('el preview sólo pinta «Mismo id» cuando sameId.exists es true', async () => {
  const sinConflicto = await openLibrary({
    state: (call) => (call.body?.action === 'inspect-bundle'
      ? jsonResponse(200, previewFixture({ conflicts: { sameId: { exists: false, currentVersion: null }, sameName: [], alreadyImported: [] } }))
      : undefined),
  });
  await expandPortability(sinConflicto);
  let area = sinConflicto.all((node) => node.type === 'textarea')[0];
  await sinConflicto.change(area, '{"schema":"lifecode-skill-center/skill-bundle"}');
  await sinConflicto.clickText('Validar paquete');
  let previewText = textOf(sinConflicto.byClass('lsc-bundle-preview')[0]);
  assert.match(previewText, /Válido/, 'el paquete válido sin conflicto sigue validando');
  assert.match(previewText, /Crear/, 'el plan se mantiene');
  assert.doesNotMatch(previewText, /Mismo id/, 'sin conflicto no se pinta la fila «Mismo id»');

  const conConflicto = await openLibrary({
    state: (call) => (call.body?.action === 'inspect-bundle'
      ? jsonResponse(200, previewFixture({ conflicts: { sameId: { exists: true, id: 'skill_demo', currentVersion: '1.2.0' }, sameName: [], alreadyImported: [] } }))
      : undefined),
  });
  await expandPortability(conConflicto);
  area = conConflicto.all((node) => node.type === 'textarea')[0];
  await conConflicto.change(area, '{"schema":"lifecode-skill-center/skill-bundle"}');
  await conConflicto.clickText('Validar paquete');
  previewText = textOf(conConflicto.byClass('lsc-bundle-preview')[0]);
  assert.match(previewText, /Mismo id/, 'con conflicto sí aparece la fila');
  assert.match(previewText, /skill_demo/, 'muestra el id en conflicto');
  assert.match(previewText, /1\.2\.0/, 'muestra la versión registrada');
});


test('un plan o un preflight desconocidos no rompen la vista previa', async () => {
  const harness = await openLibrary({
    state: (call) => (call.body?.action === 'inspect-bundle'
      ? jsonResponse(200, previewFixture({
          plan: { action: 'teleport', targetIdCandidate: 'skill_demo' },
          preflight: { decision: 'maybe', findings: [], reasons: [] },
        }))
      : undefined),
  });
  await expandPortability(harness);
  const area = harness.all((node) => node.type === 'textarea')[0];
  await harness.change(area, '{"schema":"lifecode-skill-center/skill-bundle"}');
  await harness.clickText('Validar paquete');
  const preview = harness.byClass('lsc-bundle-preview')[0];
  const previewText = textOf(preview);
  assert.match(previewText, /desconocido \(teleport\)/, 'el plan desconocido se explica sin romper');
  assert.match(previewText, /desconocido \(maybe\)/, 'el preflight desconocido se explica sin romper');
});


test('la confirmación es un segundo paso y manda confirmed:true; el éxito enlaza con la Biblioteca', async () => {
  const harness = await openLibrary({
    state: (call) => {
      if (call.body?.action === 'inspect-bundle') return jsonResponse(200, previewFixture());
      if (call.body?.action === 'import-bundle') return jsonResponse(200, { ok: true, imported: true, id: 'skill_copia', renamed: false });
      return undefined;
    },
  });
  await expandPortability(harness);
  await harness.change(harness.all((node) => node.type === 'textarea')[0], '{"schema":"x"}');
  await harness.clickText('Validar paquete');
  assert.equal(postsTo(harness, 'import-bundle').length, 0, 'validar no escribe');
  await harness.clickText('Importar una copia');
  const imports = postsTo(harness, 'import-bundle');
  assert.equal(imports.length, 1, 'confirmar escribe una vez');
  assert.deepEqual(imports[0].body, {
    action: 'import-bundle',
    payload: { bundle: '{"schema":"x"}', from: 'panel', confirmed: true },
    cwd: '',
  }, 'la escritura lleva confirmación humana explícita');
  assert.match(harness.text(), /Importada con el id «skill_copia»/, 'dice qué id quedó');
  const openButton = harness.buttons('Abrir en Biblioteca')[0];
  assert.ok(openButton, 'ofrece abrir la skill importada');
  await harness.click(openButton);
  assert.equal(harness.byClass('lsc-drawer').length, 1, 'el enlace abre el cajón de la Biblioteca');
});

test('un conflicto de identidad exige elegir y la copia manda onConflict:copy', async () => {
  const harness = await openLibrary({
    state: (call) => {
      if (call.body?.action === 'inspect-bundle') {
        return jsonResponse(200, previewFixture({
          conflicts: { sameId: { exists: true, currentVersion: '1.2.0' }, sameName: [], alreadyImported: [] },
          plan: { action: 'copy', targetIdCandidate: 'skill_demo-copia' },
        }));
      }
      if (call.body?.action === 'import-bundle') {
        return jsonResponse(200, { ok: true, imported: true, id: 'skill_demo-copia', renamed: true, renamedFrom: 'skill_demo' });
      }
      return undefined;
    },
  });
  await expandPortability(harness);
  await harness.change(harness.all((node) => node.type === 'textarea')[0], '{"schema":"x"}');
  await harness.clickText('Validar paquete');
  assert.match(harness.text(), /Identidad duplicada/, 'se ve el estado del conflicto');
  assert.equal(harness.buttons('Importar una copia').length, 0, 'con conflicto no hay importación directa');
  await harness.clickText('Crear copia con otro id');
  const imports = postsTo(harness, 'import-bundle');
  assert.equal(imports.length, 1, 'la copia se pide una vez');
  assert.equal(imports[0].body.payload.onConflict, 'copy', 'se elige crear copia');
  assert.equal(imports[0].body.payload.confirmed, true, 'y sigue siendo una confirmación explícita');
  assert.match(harness.text(), /Renombrada desde «skill_demo»/, 'el resultado dice de dónde salió el renombrado');
});

test('un 409 real no produce mensaje de éxito y deja cancelar', async () => {
  const harness = await openLibrary({
    state: (call) => (call.body?.action === 'inspect-bundle'
      ? jsonResponse(409, {
        ok: false,
        code: 'checksum-mismatch',
        message: 'el checksum no coincide',
        preview: previewFixture().preview,
      })
      : undefined),
  });
  await expandPortability(harness);
  await harness.change(harness.all((node) => node.type === 'textarea')[0], '{"schema":"x"}');
  await harness.clickText('Validar paquete');
  assert.match(harness.text(), /Integridad rota/, 'el estado dice que la integridad falla');
  assert.match(harness.text(), /checksum-mismatch/, 'y el código real del error');
  assert.doesNotMatch(harness.text(), /Importada con el id/, 'un error no es un éxito');
  assert.equal(harness.buttons('Importar una copia').length, 0, 'no se ofrece confirmar lo que falló');
  assert.equal(postsTo(harness, 'import-bundle').length, 0, 'y no se escribió nada');
});

test('la matriz de estados del paquete se muestra con su etiqueta honesta', async () => {
  const cases = [
    ['Válido', () => jsonResponse(200, previewFixture())],
    ['Formato no válido', () => jsonResponse(400, { ok: false, code: 'invalid-bundle', message: 'json roto' })],
    ['Esquema no soportado', () => jsonResponse(200, previewFixture({ compatibility: { schema: 'x', schemaVersion: 99, supported: false } }))],
    ['Integridad rota', () => jsonResponse(200, previewFixture({ integrity: { checksum: 'mismatch' } }))],
    ['Identidad duplicada', () => jsonResponse(200, previewFixture({ conflicts: { sameId: { exists: true, currentVersion: '1.2.0' }, sameName: [], alreadyImported: [] } }))],
    ['Conflicto de nombre', () => jsonResponse(200, previewFixture({ conflicts: { sameId: { exists: false }, sameName: [{ id: 'skill_other', title: 'Otra' }], alreadyImported: [] } }))],
    ['Procedencia incompleta', () => jsonResponse(200, previewFixture({ preflight: { decision: 'warn', findings: [], reasons: ['sin origen'] } }))],
    ['Ya importada', () => jsonResponse(200, previewFixture({ conflicts: { sameId: { exists: false }, sameName: [], alreadyImported: [{ id: 'skill_demo', importedAt: '2026-11-08T10:00:00.000Z' }] } }))],
    ['Bloqueado', () => jsonResponse(200, previewFixture({ preflight: { decision: 'block', findings: [{ code: 'identity-duplicate', severity: 'block', message: 'ya existe' }], reasons: ['identidad duplicada'] } }))],
    ['Almacén ilegible', () => jsonResponse(409, { ok: false, code: 'store-unreadable', message: 'no se pudo leer el almacén' })],
  ];
  for (const [label, build] of cases) {
    const harness = await openLibrary({
      state: (call) => (call.body?.action === 'inspect-bundle' ? build() : undefined),
    });
    await expandPortability(harness);
    await harness.change(harness.all((node) => node.type === 'textarea')[0], '{"schema":"x"}');
    await harness.clickText('Validar paquete');
    const pattern = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.match(harness.text(), pattern, `el estado «${label}» se muestra`);
    assert.doesNotMatch(harness.text(), /Importada con el id/, `«${label}» no inventa un éxito`);
    assert.equal(postsTo(harness, 'import-bundle').length, 0, `«${label}» no escribe`);
  }
});

test('exportar usa la skill y la versión elegidas y muestra checksum y bytes', async () => {
  const harness = await openLibrary({
    state: (call) => (call.body?.action === 'export-skill'
      ? jsonResponse(200, {
        ok: true,
        bytes: 1234,
        sha256: 'a'.repeat(64),
        checksum: 'sha256:' + 'a'.repeat(64),
        portable: true,
        warnings: [],
        json: '{"schema":"lifecode-skill-center/skill-bundle"}',
      })
      : undefined),
  });
  await expandPortability(harness);
  const chosenSkill = harness.all((node) => node.type === 'select')
    .find((node) => harness.inNode(node, (child) => child.type === 'option' && textOf(child).includes('skill_demo')).length > 0);
  assert.ok(chosenSkill, 'hay selector de skill');
  await harness.change(chosenSkill, 'skill_demo');
  const versionSelect = harness.all((node) => node.type === 'select')
    .find((node) => harness.inNode(node, (child) => child.type === 'option' && textOf(child).includes('1.0.0')).length > 0);
  assert.ok(versionSelect, 'hay selector de versión');
  await harness.change(versionSelect, '1.0.0');
  await harness.clickText('Generar paquete');
  const exports = postsTo(harness, 'export-skill');
  assert.equal(exports.length, 1, 'exportar es una acción del panel');
  assert.deepEqual(exports[0].body, {
    action: 'export-skill',
    payload: { skillId: 'skill_demo', version: '1.0.0' },
    cwd: '',
  }, 'usa la skill y la versión elegidas');
  assert.match(harness.text(), /1234 bytes/, 'dice el tamaño del paquete');
  assert.match(harness.text(), /checksum/, 'y su checksum');
});
