// Arnés mínimo de R17: React con hooks reales, efectos por deps y panel montado en `node:vm`.
// No toca el DOM de verdad ni el Host: `fetch` está grabado y `document` es un doble.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const clientPath = path.join(here, '..', 'client.js');
export const clientSource = fs.readFileSync(clientPath, 'utf8');

export function createElement(type, props, ...children) {
  const merged = { ...(props ?? {}) };
  const list = children.length === 0 ? merged.children : children;
  if (list !== undefined) merged.children = list;
  return { type, props: merged };
}

function sameDeps(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) return false;
  return previous.every((value, index) => Object.is(value, next[index]));
}

export function createRuntime(options = {}) {
  const state = { fibers: new Map(), order: [], dirty: true, tree: null, component: null, rendered: new Set() };
  let local = null;

  function fiberFor(treePath) {
    let fiber = state.fibers.get(treePath);
    if (fiber === undefined) {
      fiber = { path: treePath, index: 0, slots: [], cleanups: [], mounted: false };
      state.fibers.set(treePath, fiber);
      state.order.push(treePath);
    }
    return fiber;
  }

  function slot() {
    if (local === null) throw new Error('hook fuera de un componente');
    const index = local.index;
    local.index += 1;
    if (local.slots[index] === undefined) local.slots[index] = { ready: false };
    return local.slots[index];
  }

  function useState(initial) {
    const item = slot();
    if (!item.ready) {
      item.value = typeof initial === 'function' ? initial() : initial;
      item.ready = true;
    }
    item.set = item.set ?? ((value) => {
      const next = typeof value === 'function' ? value(item.value) : value;
      if (Object.is(next, item.value)) return;
      item.value = next;
      state.dirty = true;
    });
    return [item.value, item.set];
  }

  function useRef(initial) {
    const item = slot();
    if (!item.ready) {
      item.value = { current: initial };
      item.ready = true;
    }
    return item.value;
  }

  function useMemo(factory, deps) {
    const item = slot();
    if (!item.ready || !sameDeps(item.deps, deps)) {
      item.value = factory();
      item.deps = deps;
      item.ready = true;
    }
    return item.value;
  }

  function useCallback(fn, deps) {
    const item = slot();
    if (!item.ready || !sameDeps(item.deps, deps)) {
      item.value = fn;
      item.deps = deps;
      item.ready = true;
    }
    return item.value;
  }

  function useEffect(fn, deps) {
    const item = slot();
    item.effect = fn;
    item.deps = deps;
    item.ready = true;
  }

  function begin(treePath) {
    const fiber = fiberFor(treePath);
    fiber.index = 0;
    const previous = local;
    local = fiber;
    return () => { local = previous; };
  }

  function renderNode(treePath, node) {
    if (node === null || node === undefined || node === false || node === true) return null;
    if (typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) {
      return node.map((child, index) => renderNode(`${treePath}[${index}]`, child)).filter((child) => child !== null);
    }
    const type = node.type;
    const props = node.props ?? {};
    if (type === Fragment) return renderNode(`${treePath}.frag`, props.children ?? null);
    if (typeof type === 'function') {
      state.rendered.add(treePath);
      const restore = begin(treePath);
      let output;
      try {
        output = type(props);
      } finally {
        restore();
      }
      return renderNode(`${treePath}.out`, output);
    }
    const children = renderNode(`${treePath}.children`, props.children ?? null);
    const host = { type, props: { ...props, children } };
    if (typeof options.attachHost === 'function') options.attachHost(host);
    const ref = props.ref;
    if (ref !== null && ref !== undefined) {
      if (typeof ref === 'function') ref(host);
      else ref.current = host;
    }
    return host;
  }

  function flush() {
    for (const treePath of state.order) {
      const fiber = state.fibers.get(treePath);
      if (fiber === undefined || !fiber.mounted) continue;
      for (const item of fiber.slots) {
        if (typeof item.effect !== 'function') continue;
        if (item.ran === true && Array.isArray(item.deps) && sameDeps(item.savedDeps, item.deps)) continue;
        if (typeof item.cleanup === 'function') item.cleanup();
        item.savedDeps = item.deps;
        item.ran = true;
        const cleanup = item.effect();
        item.cleanup = typeof cleanup === 'function' ? cleanup : null;
      }
    }
  }

  function markMounted() {
    for (const treePath of state.order) {
      const fiber = state.fibers.get(treePath);
      if (fiber !== undefined) fiber.mounted = true;
    }
  }

  // Un componente condicional que desaparece del árbol desmonta: sus efectos corren cleanup.
  function unmountMissing() {
    for (const treePath of state.order) {
      const fiber = state.fibers.get(treePath);
      if (fiber === undefined || fiber.mounted !== true) continue;
      if (state.rendered.has(treePath)) continue;
      for (const item of fiber.slots) {
        if (typeof item.cleanup === 'function') item.cleanup();
        item.cleanup = null;
        item.ran = false;
        item.savedDeps = undefined;
      }
      fiber.mounted = false;
    }
  }

  function render() {
    const component = state.component;
    if (component === null) throw new Error('no hay componente montado');
    let attempts = 0;
    do {
      state.dirty = false;
      state.rendered = new Set();
      state.tree = renderNode('root', createElement(component, {}));
      markMounted();
      unmountMissing();
      flush();
      attempts += 1;
    } while (state.dirty && attempts < 10);
    if (state.dirty) throw new Error('el render no converge');
    return state.tree;
  }

  async function settle(rounds = 24) {
    for (let index = 0; index < rounds; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      if (!state.dirty) continue;
      render();
    }
  }

  function mount(component) {
    state.component = component;
    state.dirty = true;
    return render();
  }

  return {
    state,
    render,
    settle,
    mount,
    useState,
    useRef,
    useMemo,
    useCallback,
    useEffect,
  };
}

export const Fragment = Symbol('Fragment');

export function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children ?? null);
}

export function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
  if (node.type === undefined) return;
  visit(node);
  walk(node.props?.children ?? null, visit);
}

export function findByPredicate(tree, predicate) {
  const found = [];
  walk(tree, (node) => { if (predicate(node)) found.push(node); });
  return found;
}

export function textNodes(tree) {
  walk(tree, () => {});
  return textOf(tree);
}

export function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
}

export function defaultSnapshot() {
  return {
    ok: true,
    apiVersion: 1,
    generatedAt: '2026-11-09T19:00:00.000Z',
    version: '0.5.0',
    library: { skills: 0, versions: 0, pending: 0 },
    skills: [],
    projects: [],
    events: [],
    stats: { skills: 0, projects: 0, events: 0, pending: 0 },
    pending: [],
  };
}

export function defaultCapabilities() {
  return {
    ok: true,
    kind: 'capabilities',
    apiVersion: 1,
    contractVersion: 2,
    implementation: 'r17',
    plugin: { id: 'lifecode-skill-center', version: '0.5.0' },
    capabilities: ['state', 'projects', 'inventory', 'activity'],
    contract: { name: 'lifecode-skill-center', minClientContract: 2, maxClientContract: 2 },
  };
}

export function activityEvent(overrides = {}) {
  return {
    eventId: 'evt-1',
    type: 'skill-created',
    at: '2026-11-09T18:59:00.000Z',
    actor: 'agent',
    actorEvidence: { channel: 'tool', stored: 'activity.jsonl' },
    origin: 'skill-compiler',
    source: 'center.json',
    projectId: null,
    skillId: 'skill_demo',
    skillTitle: 'Demo',
    versionBefore: null,
    versionAfter: '1.2.0',
    referencesAdded: null,
    referencesUpdated: null,
    referencesRemoved: null,
    correlationId: null,
    requestId: null,
    outcome: 'ok',
    persisted: true,
    humanApprovalRequired: false,
    confidence: 'verified',
    category: 'create',
    severity: 'success',
    titleKey: 'activity.title.skill-created',
    titleVars: { skill: 'Demo' },
    ...overrides,
  };
}

export function activityPayload(events, overrides = {}) {
  return {
    ok: true,
    apiVersion: 1,
    contractVersion: 2,
    generatedAt: '2026-11-09T19:00:00.000Z',
    events,
    sources: [{ id: 'center', status: 'ok', reason: null }, { id: 'knowledge', status: 'ok', reason: null }],
    nextBefore: null,
    total: events.length,
    complete: true,
    truncated: false,
    ...overrides,
  };
}

export function createPanelHarness(options = {}) {
  const calls = [];
  const listeners = new Map();
  const timers = [];
  let sequence = 0;
  const localStorageData = new Map(Object.entries(options.storage ?? {}));
  const document_ = {
    activeElement: null,
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) {
      const set = listeners.get(name);
      if (set !== undefined) set.delete(handler);
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
    head: { appendChild() {} },
    getElementById: () => null,
  };
  const focusLog = [];
  const runtime = createRuntime({
    attachHost(host) {
      host.isConnected = true;
      host.getAttribute = () => null;
      host.focus = () => {
        if (host.isConnected !== true) return;
        document_.activeElement = host;
        focusLog.push(host);
      };
    },
  });
  const React = {
    createElement,
    Fragment,
    useState: runtime.useState,
    useRef: runtime.useRef,
    useMemo: runtime.useMemo,
    useCallback: runtime.useCallback,
    useEffect: runtime.useEffect,
  };
  const localStorage = {
    getItem: (key) => (localStorageData.has(key) ? localStorageData.get(key) : null),
    setItem: (key, value) => { localStorageData.set(key, String(value)); },
    removeItem: (key) => { localStorageData.delete(key); },
  };
  const fetchImpl = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: String(init.method ?? 'GET').toUpperCase(),
      body: typeof init.body === 'string' ? init.body : null,
    };
    calls.push(call);
    const responder = options.responder ?? (() => null);
    const custom = await responder(call);
    if (custom !== null && custom !== undefined) return custom;
    return defaultResponse(call);
  };
  function defaultResponse(call) {
    const url = call.url;
    if (url.includes('/api/capabilities')) return jsonResponse(200, defaultCapabilities());
    if (url.includes('/api/activity')) return jsonResponse(200, activityPayload(options.events ?? []));
    if (url.includes('/api/state')) {
      if (call.method === 'POST') {
        let body = {};
        try { body = JSON.parse(call.body ?? '{}'); } catch { body = {}; }
        if (body.action === 'open') return jsonResponse(200, options.snapshot ?? defaultSnapshot());
        return jsonResponse(200, { ok: true, result: {} });
      }
      return jsonResponse(200, options.snapshot ?? defaultSnapshot());
    }
    return jsonResponse(404, { ok: false, code: 'not-found', message: 'ruta de prueba' });
  }

  let captured = null;
  const registrations = [];
  const injections = [];
  const locales = [];
  const cleanups = [];
  const sandbox = {
    window: { __ModuleLoader__: { load: (definition) => { captured = definition; } } },
    document: document_,
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage,
    fetch: fetchImpl,
    console,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return sequence += 1; },
    clearTimeout: () => {},
    setInterval: undefined,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    RegExp,
    Promise,
    Error,
    Symbol,
    Map,
    Set,
    Intl,
  };
  const require = (name) => {
    assert.equal(name, 'react');
    return React;
  };
  vm.runInNewContext(clientSource, { ...sandbox, require }, { filename: clientPath });
  assert.ok(captured !== null, 'client.js llama a window.__ModuleLoader__.load');
  const module_ = captured.factory(require);
  const testProbe = {};
  let panel = null;
  const ctx = {
    __lscTest: testProbe,
    effect(fn) {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
      return () => {};
    },
    locale: {
      register(namespace, dictionaries) {
        locales.push({ namespace, dictionaries });
        return () => {};
      },
      getSnapshot: () => ({ locale: options.locale ?? 'es' }),
      getLocale: () => options.locale ?? 'es',
      subscribe: () => () => {},
    },
    slots: {
      inject(owner, callback) {
        injections.push(owner);
        return callback();
      },
      register(definition, component) {
        registrations.push({ definition, component });
        if (definition?.name === 'main') panel = component;
        return { dispose: () => {} };
      },
    },
    get: () => null,
  };
  module_.apply(ctx);
  assert.equal(typeof panel, 'function', 'el panel se registra en el slot main');

  function tree() {
    return runtime.state.tree;
  }

  function nodes(predicate) {
    return findByPredicate(tree(), predicate);
  }

  function text() {
    return textOf(tree());
  }

  function buttons(label) {
    return nodes((node) => node.type === 'button' && (label === undefined || textOf(node).includes(label)));
  }

  function button(label) {
    return buttons(label)[0];
  }

  function click(node) {
    assert.ok(node, 'el botón existe');
    assert.notEqual(node.props.disabled, true, 'el botón no está deshabilitado');
    node.props.onClick?.({ preventDefault() {}, stopPropagation() {} });
    return runtime.settle();
  }

  async function clickText(label) {
    return click(button(label));
  }

  function fire(name, event) {
    for (const handler of listeners.get(name) ?? []) handler(event);
    return runtime.settle();
  }

  function key(name) {
    return fire('keydown', { key: name, preventDefault() {}, shiftKey: false });
  }

  async function mount() {
    runtime.mount(panel);
    await runtime.settle(14);
    return tree();
  }

  return {
    module: module_,
    runtime,
    ctx,
    calls,
    timers,
    storage: localStorageData,
    locales,
    registrations,
    testProbe,
    focusLog,
    activeElement: () => document_.activeElement,
    mount,
    settle: runtime.settle,
    render: runtime.render,
    tree,
    nodes,
    text,
    buttons,
    button,
    click,
    clickText,
    fire,
    key,
    unmount() {
      for (const cleanup of cleanups) cleanup();
      return undefined;
    },
  };
}
