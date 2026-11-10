// Arnés de T46: monta el Host falso (slots, sesión, stream) y el overlay global de avisos.
// No usa el panel: el objeto de la prueba es que la pila viva FUERA del panel y sobreviva a la
// conversación. Sólo depende de `node:vm`, `node:fs` y de un React mínimo propio.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));

export const clientPath = path.join(here, '..', 'client.js');
export const clientSource = fs.readFileSync(clientPath, 'utf8');

export const Fragment = Symbol('Fragment');

export function createElement(type, props, ...children) {
  const normalized = { ...(props ?? {}) };
  if (children.length === 1) normalized.children = children[0];
  else if (children.length > 1) normalized.children = children;
  return { type, props: normalized };
}

const TEXT_STRINGS = {
  'activity.action.skill': 'Ver Skill',
  'activity.action.diff': 'Ver diferencias',
  'activity.action.project': 'Revisar',
  'toast.close': 'Cerrar aviso',
  'activity.title.skill-created': 'Skill «{skill}» creada',
  'activity.title.skill-version-saved': 'Guardada la versión {version} de «{skill}»',
  'activity.title.improvement-prepared': 'Mejora preparada para «{skill}»',
};

export function translate(es, key, vars) {
  const template = es[key];
  if (typeof template !== 'string') return key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    vars !== null && typeof vars === 'object' && name in vars ? String(vars[name]) : match);
}

export function createRuntime() {
  const state = { fibers: new Map(), roots: new Map(), trees: new Map(), dirty: false, cursor: null, tree: null, order: [] };

  function fiberFor(fiberPath) {
    let fiber = state.fibers.get(fiberPath);
    if (fiber === undefined) {
      fiber = { hooks: [], effects: [] };
      state.fibers.set(fiberPath, fiber);
      state.order.push(fiberPath);
    }
    return fiber;
  }

  function hookSlot(kind, initial) {
    const cursor = state.cursor;
    if (cursor === null) throw new Error('hook fuera de un componente');
    const fiber = fiberFor(cursor.path);
    const index = cursor.index;
    cursor.index += 1;
    const current = fiber.hooks[index];
    if (current === undefined) {
      const created = { kind, value: initial };
      fiber.hooks[index] = created;
      return created;
    }
    if (current.kind !== kind) {
      throw new Error(`orden de hooks inestable en ${cursor.path}: la posición ${index} era ${current.kind} y ahora ${kind}`);
    }
    return current;
  }

  function useState(initial) {
    const cursor = state.cursor;
    const slot = hookSlot('state', typeof initial === 'function' ? initial() : initial);
    const fiber = fiberFor(cursor.path);
    const index = cursor.index - 1;
    const setter = (next) => {
      const holder = fiber.hooks[index];
      const value = typeof next === 'function' ? next(holder.value) : next;
      if (Object.is(value, holder.value)) return;
      holder.value = value;
      state.dirty = true;
    };
    return [slot.value, setter];
  }

  function useRef(initial) {
    return hookSlot('ref', { current: initial }).value;
  }

  function useMemo(factory, deps) {
    const cursor = state.cursor;
    const slot = hookSlot('memo', undefined);
    const list = Array.isArray(deps) ? deps : [];
    if (slot.deps === undefined || !sameDeps(slot.deps, list)) {
      slot.deps = list.slice();
      slot.value = factory();
    }
    void cursor;
    return slot.value;
  }

  function useCallback(fn, deps) {
    return useMemo(() => fn, deps);
  }

  function useEffect(effect, deps) {
    const cursor = state.cursor;
    const fiber = fiberFor(cursor.path);
    const index = cursor.index;
    hookSlot('effect', undefined);
    const list = Array.isArray(deps) ? deps : null;
    const previous = fiber.effects[index];
    const changed = previous === undefined || list === null
      || previous.deps === null || !sameDeps(previous.deps, list);
    if (!changed) return;
    const cleanup = () => {
      const entry = fiber.effects[index];
      if (entry !== undefined && typeof entry.cleanup === 'function') entry.cleanup();
      if (entry !== undefined) entry.cleanup = null;
    };
    cleanup();
    fiber.effects[index] = { deps: list === null ? null : list.slice(), cleanup: null, queue: effect };
  }

  function renderNode(node, nodePath) {
    if (node === null || node === undefined || node === false || node === true) return null;
    if (typeof node === 'string' || typeof node === 'number') return { type: 'text', text: String(node) };
    if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${nodePath}.${index}`));
    if (typeof node !== 'object' || node === null) return null;
    const { type, props } = node;
    if (typeof type === 'function') {
      const previous = state.cursor;
      state.cursor = { path: nodePath, index: 0 };
      let output;
      try {
        output = type(props ?? {});
      } finally {
        state.cursor = previous;
      }
      return renderNode(output, `${nodePath}.out`);
    }
    return {
      type: String(type),
      props: props ?? {},
      children: renderNode(props?.children, `${nodePath}.kids`),
    };
  }

  function flushEffects() {
    for (const fiberPath of state.order) {
      const fiber = state.fibers.get(fiberPath);
      for (const entry of fiber.effects) {
        if (entry === undefined || entry.queue === undefined) continue;
        const queue = entry.queue;
        entry.queue = undefined;
        const cleanup = queue();
        entry.cleanup = typeof cleanup === 'function' ? cleanup : null;
      }
    }
  }

  function render() {
    state.dirty = false;
    for (const [key, element] of state.roots) state.trees.set(key, renderNode(element, key));
    flushEffects();
    state.tree = state.trees.get('overlay') ?? null;
    return state.tree;
  }

  async function settle(rounds = 24) {
    for (let index = 0; index < rounds; index += 1) {
      if (index > 0) await new Promise((resolve) => setImmediate(resolve));
      if (state.dirty) render();
      else if (index > 0) return;
    }
  }

  function mount(component, key = 'root') {
    state.roots.set(key, createElement(component, {}));
    state.dirty = false;
    render();
  }

  function unmount() {
    for (const fiberPath of state.order) {
      const fiber = state.fibers.get(fiberPath);
      for (const entry of fiber.effects) {
        if (entry !== undefined && typeof entry.cleanup === 'function') entry.cleanup();
      }
    }
    state.fibers.clear();
    state.order.length = 0;
    state.roots.clear();
    state.trees.clear();
  }

  const React = { createElement, Fragment, useState, useRef, useMemo, useCallback, useEffect };
  return { React, state, mount, render, settle, unmount };
}

function sameDeps(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

export function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'object' && typeof node.type === 'string' && node.type === 'text') return node.text;
  if (typeof node === 'object' && node.children !== undefined) return textOf(node.children);
  return '';
}

export function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  visit(node);
  if (node.children !== undefined) walk(node.children, visit);
}

export function createSessionStore() {
  const state = { entries: [], hasMore: false, revision: 0, change: null };
  const listeners = new Set();
  const source = {
    getSnapshot: () => ({ entries: state.entries.slice(), hasMore: state.hasMore, revision: state.revision, change: state.change }),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    source,
    get subscriberCount() { return listeners.size; },
    append(events) {
      const normalized = events.map((event) => ({ type: 'event', event }));
      state.entries.push(...normalized);
      state.revision += 1;
      state.change = { kind: 'append', entries: normalized };
      for (const listener of Array.from(listeners)) listener(source.getSnapshot());
    },
  };
}

export function createHostHarness(options = {}) {
  const registrations = [];
  const slotInjectNames = [];
  const sessionStores = new Map();
  const intervals = [];
  const timeouts = [];
  const cleanups = [];
  const storage = new Map();
  let definition = null;
  let currentSlotName = '';

  const localStorage = {
    getItem: (key) => (storage.has(String(key)) ? storage.get(String(key)) : null),
    setItem: (key, value) => { storage.set(String(key), String(value)); },
    removeItem: (key) => { storage.delete(String(key)); },
  };

  const sessions = {
    binding(sessionId) {
      const id = String(sessionId);
      if (!sessionStores.has(id)) sessionStores.set(id, createSessionStore());
      const store = sessionStores.get(id);
      return { sessionId: id, eventSource: store.source };
    },
  };

  const ctx = {
    get(name) {
      if (name === 'sessions') return sessions;
      return undefined;
    },
    effect(factory) {
      const dispose = factory();
      if (typeof dispose === 'function') cleanups.push(dispose);
      return dispose;
    },
    slots: {
      inject(name, callback) {
        slotInjectNames.push(String(name));
        if (name !== 'shell.overlay' && name !== 'conversation.session.header.actions') return { dispose() {} };
        const previousSlot = currentSlotName;
        currentSlotName = String(name);
        const register = (slotDefinition, component) => ctx.slots.register(slotDefinition, component);
        try {
          callback(register);
        } finally {
          currentSlotName = previousSlot;
        }
        return { dispose() {} };
      },
      register(slotDefinition, component) {
        const record = {
          name: currentSlotName !== '' ? currentSlotName : String(slotDefinition?.name ?? ''),
          definition: slotDefinition,
          component,
        };
        registrations.push(record);
        return { slotDefinition, component, dispose() {} };
      },
    },
    locale: {
      register() {},
      getSnapshot() { return { locale: 'es' }; },
      getLocale() { return 'es'; },
      subscribe() { return () => {}; },
    },
    logger: { warn() {}, error() {}, info() {} },
  };

  function fakeNode() {
    return {
      style: {},
      children: [],
      setAttribute() {},
      getAttribute() { return null; },
      appendChild(child) { this.children.push(child); return child; },
      removeChild(child) { this.children = this.children.filter((item) => item !== child); return child; },
      remove() {},
      addEventListener() {},
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
    };
  }

  const sandbox = {
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
    document: {
      createElement() { return fakeNode(); },
      createTextNode() { return fakeNode(); },
      head: fakeNode(),
      body: fakeNode(),
      documentElement: fakeNode(),
      getElementById() { return null; },
      addEventListener() {},
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    localStorage,
    navigator: { clipboard: { writeText: async () => undefined } },
    fetch: options.fetch ?? (async () => ({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ ok: true, apiVersion: 1 }),
    })),
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout: () => {},
    setInterval: (fn, ms) => { intervals.push(ms); return intervals.length; },
    clearInterval: () => {},
    URL,
    URLSearchParams,
    console: { warn() {}, error() {}, info() {}, log() {} },
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Set,
    Map,
    Number,
    String,
    Boolean,
    Error,
    RegExp,
    Intl,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(clientSource, sandbox, { filename: clientPath });
  if (definition === null) throw new Error('client.js no llamó a window.__ModuleLoader__.load');
  const runtime = createRuntime();
  const module_ = definition.factory((name) => {
    if (name !== 'react') throw new Error(`require inesperado: ${name}`);
    return runtime.React;
  });
  if (typeof module_.apply !== 'function') throw new Error('client.js no expone apply(ctx)');
  module_.apply(ctx);

  function translation(key, vars) { return translate(TEXT_STRINGS, key, vars); }

  function overlayRegistration() {
    const record = registrations.find((item) => item.name === 'shell.overlay');
    if (record === undefined) throw new Error('no se registró shell.overlay');
    return record;
  }

  function probeRegistration() {
    const record = registrations.find((item) => item.name === 'conversation.session.header.actions');
    if (record === undefined) throw new Error('no se registró el probe de sesión');
    return record;
  }

  function mountOverlay() {
    const record = overlayRegistration();
    const injected = typeof record.definition.inject === 'function' ? record.definition.inject() : {};
    runtime.mount((props) => record.component({ ...props, ...injected, t: translation }), 'overlay');
    return runtime;
  }

  function mountProbe(sessionId) {
    const record = probeRegistration();
    const injected = typeof record.definition.inject === 'function' ? record.definition.inject() : {};
    runtime.mount((props) => record.component({ ...props, ...injected, sessionId }), 'probe');
    return runtime;
  }

  function emit(sessionId, events) {
    sessions.binding(sessionId);
    sessionStores.get(String(sessionId)).append(events);
  }

  function toasts() {
    const found = [];
    walk(runtime.state.trees.get('overlay') ?? null, (node) => {
      const className = node.props?.className;
      if (typeof className === 'string' && className.split(/\s+/).includes('lsc-toast-card')) found.push(node);
    });
    return found;
  }

  function text() { return textOf(runtime.state.trees.get('overlay') ?? null); }

  function dispose() {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      try { cleanup(); } catch { /* el Host nunca debe caer por un dispose */ }
    }
    runtime.unmount();
  }

  async function settle(rounds = 24) {
    await runtime.settle(rounds);
  }

  return {
    runtime,
    ctx,
    registrations,
    slotInjectNames,
    t: translation,
    translate: translation,
    mountOverlay,
    mountProbe,
    emit,
    toasts,
    text,
    settle,
    dispose,
    intervals,
    timeouts,
    storage,
    sessionSubscribers: (sessionId) => sessionStores.get(String(sessionId))?.subscriberCount ?? 0,
  };
}

export function toolCall(callId, name) {
  return { type: 'tool/call', data: { callId, name } };
}

export function toolResult(callId, activity, options = {}) {
  const data = {
    message: {
      toolCallId: callId,
      content: options.jsonContent === false
        ? [{ type: 'text', text: 'resumen del tool' }]
        : [{ type: 'text', text: JSON.stringify(options.envelope === true ? { activity } : activity) }],
    },
  };
  if (options.meta === true) data.meta = { activity };
  if (options.replayed === true) data.replayed = true;
  return { type: 'tool/result', data };
}

export function activityFixture(overrides = {}) {
  return {
    eventId: 'evt-1',
    type: 'skill-created',
    at: '2026-11-09T20:00:00.000Z',
    skillId: 'skill_demo',
    skillTitle: 'Demo',
    projectId: null,
    correlationId: null,
    referencesAdded: null,
    referencesUpdated: null,
    referencesRemoved: null,
    category: 'create',
    severity: 'success',
    titleKey: 'activity.title.skill-created',
    titleVars: { skill: 'Demo' },
    persisted: true,
    outcome: 'ok',
    ...overrides,
  };
}
