/**
 * Fase B de LSC-UX-IA-VENDOR-001: contexto de proyecto del panel.
 *
 * Cubre los cuatro contratos nuevos con evidencia ejecutable:
 *  - T1: abrir/navegar por HTTP no da de alta proyectos ni escribe el centro.
 *  - T2: el selector elige un projectId validado por el servidor; el agente sigue en su sesión.
 *  - T3: una respuesta tardía no puede pintar la selección posterior (generación en el cliente).
 *  - T4: los chips salen de la clasificación del servidor, no de workspaces parecidos.
 *  - T5: filtrar por proyecto no cambia la biblioteca global ni las asignaciones.
 *
 * Todo corre en cajas de arena: ni el almacén real ni la carpeta del agente se tocan.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { handleApiRequest, runAction } from '../lib/api.mjs';
import { candidate, tempProject, tempRoot } from './helpers.mjs';
import { createPanelHarness, jsonResponse, textOf } from './r17-ui-runtime.mjs';

const NOW = '2026-11-25T12:00:00.000Z';
const API_PATH = '/lifecode-skill-center/api/state';
const SELECTION_KEY = 'lifecode-skill-center/panel-project';
const slash = (value) => String(value ?? '').replace(/\\/g, '/');

function centerDigest(root) {
  const file = join(root, 'center.json');
  if (!existsSync(file)) return 'absent';
  const bytes = readFileSync(file);
  const stat = statSync(file);
  return `${createHash('sha256').update(bytes).digest('hex')}:${stat.mtimeMs}:${bytes.length}`;
}

function optionValues(harness) {
  return harness.nodes((node) => node.type === 'option').map((node) => node.props.value);
}

function selectNode(harness) {
  const found = harness.nodes((node) => node.type === 'select');
  assert.ok(found.length > 0, 'el panel tiene un selector de proyecto');
  return found[0];
}

function projectSnapshot(panelId = 'p-agent') {
  const cwdAgent = 'C:/lsc/faseb/agente';
  const cwdAdmin = 'C:/lsc/faseb/administrado';
  const projects = [
    { id: 'p-agent', name: 'Agente', cwd: cwdAgent, registered: true },
    { id: 'p-admin', name: 'Administrado', cwd: cwdAdmin, registered: true },
  ];
  const chosen = projects.find((project) => project.id === panelId) ?? null;
  return {
    ok: true,
    apiVersion: 1,
    contractVersion: 2,
    generatedAt: NOW,
    readable: true,
    cwd: chosen?.cwd ?? cwdAgent,
    hostCwd: cwdAgent,
    project: chosen === null ? null : { ...chosen },
    projects: projects.map((project) => ({ ...project })),
    panelContext: chosen === null
      ? { projectId: '', name: '', cwd: '', selectionSource: 'unresolved', resolved: false, updatedAt: '' }
      : { projectId: chosen.id, name: chosen.name, cwd: chosen.cwd, selectionSource: 'validated-selection', resolved: true, updatedAt: NOW },
    agentContext: { cwd: cwdAgent, projectId: 'p-agent', state: 'session-resolved', source: 'session', via: 'session-cwd' },
    skills: [],
    assignments: {},
    improvements: [],
    events: [],
    external: { candidates: [] },
    counts: { skills: 0, projects: 2, assignments: 0, improvements: 0, events: 0 },
    analytics: { skills: { versions: 0 } },
  };
}

function projectsPayload() {
  const row = (projectId, name, state, inspection = { status: 'complete' }) => ({
    projectId,
    name,
    cwd: `C:/lsc/faseb/${projectId}`,
    canonicalPath: `C:/lsc/faseb/${projectId}`,
    state,
    registration: { present: true },
    workspace: { workspaceId: `ws-${projectId}`, title: name, path: `C:/lsc/faseb/${projectId}`, availability: 'ok' },
    inspection,
    counts: { assigned: 0, active: 0, materialized: 0 },
    reasons: [],
  });
  return {
    ok: true,
    apiVersion: 1,
    contractVersion: 2,
    generatedAt: NOW,
    sources: [{ id: 'center', status: 'ok' }],
    projects: [
      row('p-missing', 'Ausente', 'unavailable'),
      row('p-conflict', 'Conflicto', 'identity-conflict'),
      row('p-partial', 'Parcial', 'partially-inspected', { status: 'incomplete' }),
    ],
    discovered: [],
    current: { cwd: '', workspaceId: null, workspaceTitle: '', projectId: null, state: null, confidence: 'unknown', via: 'host-cwd' },
    summary: { total: 3, discovered: 0, externalManaged: 0, managed: 0, healthy: 0, unavailable: 1, identityConflict: 1, partiallyInspected: 1 },
  };
}

function inventoryPayload() {
  return { ok: true, apiVersion: 1, contractVersion: 2, generatedAt: NOW, sources: [{ id: 'center', status: 'ok' }], entries: [], collisions: [], complete: true, truncated: false };
}

function dataResponder(extra = {}) {
  return async (call) => {
    if (call.url.includes('/api/projects')) return jsonResponse(200, projectsPayload());
    if (call.url.includes('/api/inventory')) return jsonResponse(200, inventoryPayload());
    if (call.url.includes('/api/workspaces')) {
      return jsonResponse(200, { ok: true, apiVersion: 1, workspaces: [], managed: [], identity: { available: true }, current: { cwd: '', workspaceId: null } });
    }
    return extra(call) ?? null;
  };
}

test('T1: POST open y GET por HTTP son lecturas: no registran el proyecto ni tocan center.json', () => {
  const root = tempRoot('lsc-faseb-t1');
  const cwd = tempProject('proyecto-visto', root);
  const before = centerDigest(root);

  const opened = handleApiRequest({ root, method: 'POST', pathname: API_PATH, body: { action: 'open', cwd }, now: NOW });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.opened, true);
  assert.equal(opened.body.project.registered, false, 'un proyecto visto NO es un proyecto gestionado');
  assert.deepEqual(opened.body.projects, []);

  const browsed = handleApiRequest({ root, method: 'GET', pathname: API_PATH, search: `?cwd=${encodeURIComponent(cwd)}`, now: NOW });
  assert.equal(browsed.status, 200);
  assert.equal(browsed.body.project.registered, false);
  assert.equal(centerDigest(root), before, 'abrir y navegar no pueden crear ni tocar el almacén');
});

test('T2: el servidor valida el projectId del panel y mantiene aparte el contexto de la sesión', () => {
  const root = tempRoot('lsc-faseb-t2');
  const cwdAgent = tempProject('agente', root);
  const cwdAdmin = tempProject('administrado', root);
  const agent = runAction({ root, action: 'open', cwd: cwdAgent, now: NOW });
  const admin = runAction({ root, action: 'open', cwd: cwdAdmin, now: NOW });
  assert.equal(agent.ok, true);
  assert.equal(admin.ok, true);

  const selected = handleApiRequest({
    root,
    method: 'GET',
    pathname: API_PATH,
    search: `?cwd=${encodeURIComponent(cwdAgent)}&panelProjectId=${encodeURIComponent(admin.project.id)}`,
    hostCwd: cwdAgent,
    now: NOW,
  });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.panelContext.projectId, admin.project.id);
  assert.equal(slash(selected.body.panelContext.cwd), slash(cwdAdmin));
  assert.equal(selected.body.panelContext.selectionSource, 'validated-selection');
  assert.equal(selected.body.project.id, admin.project.id);
  assert.equal(selected.body.agentContext.cwd, slash(cwdAgent));
  assert.equal(selected.body.agentContext.projectId, agent.project.id);
  assert.equal(selected.body.agentContext.via, 'session-cwd', 'la sesión del agente no se vuelve panel');

  const invalid = handleApiRequest({
    root,
    method: 'GET',
    pathname: API_PATH,
    search: `?cwd=${encodeURIComponent(cwdAgent)}&panelProjectId=no-existe`,
    hostCwd: cwdAgent,
    now: NOW,
  });
  assert.equal(invalid.body.panelContext.resolved, false);
  assert.equal(invalid.body.panelContext.cwd, '', 'una selección no válida no se convierte en ruta');
  assert.equal(invalid.body.agentContext.cwd, slash(cwdAgent), 'la sesión del agente sobrevive a una selección inválida');
  assert.equal(slash(invalid.body.project.cwd), slash(cwdAgent));
});

test('T3: una respuesta tardía de A no pinta el contexto de B', async () => {
  let releaseSlow = null;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const harness = createPanelHarness({
    snapshot: projectSnapshot(),
    responder: dataResponder((call) => {
      if (!call.url.includes('/api/state')) return null;
      if (call.method === 'POST') return jsonResponse(200, projectSnapshot('p-agent'));
      const id = new URL(call.url, 'http://panel.local').searchParams.get('panelProjectId') ?? '';
      if (id === 'p-admin') return slow.then(() => jsonResponse(200, projectSnapshot('p-admin')));
      return jsonResponse(200, projectSnapshot('p-agent'));
    }),
  });
  await harness.mount();

  selectNode(harness).props.onChange({ target: { value: 'p-admin' } });
  await harness.settle();
  assert.equal(selectNode(harness).props.value, 'p-admin', 'la selección nueva se muestra en cuanto se pide');

  selectNode(harness).props.onChange({ target: { value: 'p-agent' } });
  await harness.settle();
  assert.equal(selectNode(harness).props.value, 'p-agent');

  releaseSlow();
  await harness.settle(30);
  assert.equal(selectNode(harness).props.value, 'p-agent', 'la respuesta vieja no puede devolver el selector a B');
  assert.equal(JSON.parse(harness.storage.get(SELECTION_KEY) ?? '{}').projectId, 'p-agent');
  assert.match(harness.text(), /Sesión del agente/);
  assert.match(harness.text(), /Agente/, 'la sesión sigue siendo el contexto del agente');
});

test('T4: el selector usa projectId, guarda la preferencia y no registra nada al elegir', async () => {
  const harness = createPanelHarness({
    snapshot: projectSnapshot(),
    responder: dataResponder((call) => {
      if (!call.url.includes('/api/state')) return null;
      if (call.method === 'POST') return jsonResponse(200, projectSnapshot('p-agent'));
      const id = new URL(call.url, 'http://panel.local').searchParams.get('panelProjectId') ?? '';
      return jsonResponse(200, projectSnapshot(id));
    }),
  });
  await harness.mount();

  const values = optionValues(harness);
  assert.ok(values.includes('p-agent') && values.includes('p-admin'), 'las opciones son identidades');
  assert.ok(!values.some((value) => String(value).includes(':/')), 'ninguna opción es una ruta');
  assert.match(harness.text(), /Sesión del agente/);
  assert.match(harness.text(), /Coinciden/, 'al arrancar, panel y sesión coinciden');

  const postsBefore = harness.calls.filter((call) => call.method === 'POST').length;
  selectNode(harness).props.onChange({ target: { value: 'p-admin' } });
  await harness.settle();

  const stateCalls = harness.calls.filter((call) => call.method === 'GET' && call.url.includes('/api/state'));
  assert.ok(stateCalls.some((call) => call.url.includes('panelProjectId=p-admin')), 'la identidad viaja al servidor');
  assert.equal(selectNode(harness).props.value, 'p-admin');
  assert.match(harness.text(), /La administración está en otro proyecto; la sesión del agente no cambió\./);
  assert.equal(JSON.parse(harness.storage.get(SELECTION_KEY) ?? '{}').projectId, 'p-admin');
  assert.equal(harness.calls.filter((call) => call.method === 'POST').length, postsBefore, 'elegir no dispara registros ni escrituras');

  selectNode(harness).props.onChange({ target: { value: 'no-existe' } });
  await harness.settle();
  assert.equal(harness.storage.has(SELECTION_KEY), false, 'una identidad huérfana se olvida');
  assert.equal(selectNode(harness).props.value, '__unresolved__');
});

test('T5: los chips de disponibilidad salen del estado clasificado por el servidor', async () => {
  const harness = createPanelHarness({
    snapshot: projectSnapshot(),
    responder: dataResponder((call) => {
      if (!call.url.includes('/api/state')) return null;
      return jsonResponse(200, projectSnapshot());
    }),
  });
  await harness.mount();
  const nav = harness.nodes((node) => node.type === 'button'
    && String(node.props.className ?? '').includes('lsc-rail-item')
    && textOf(node).includes('Proyectos'))[0];
  assert.ok(nav, 'la navegación a Proyectos existe');
  await harness.click(nav);

  const text = harness.text();
  assert.match(text, /1 no disponible/, 'un proyecto `unavailable` cuenta como no disponible aunque su workspace diga ok');
  assert.match(text, /2 sin disponibilidad comprobada/, 'conflicto e inspección parcial no se cuentan como disponibles');
  assert.match(text, /1 con conflicto de identidad/, 'el conflicto de identidad tiene su propio chip');
  assert.doesNotMatch(text, /1 disponible/, 'no se hereda la disponibilidad del workspace');
});

test('T7: elegir otro proyecto no sustituye la ruta de la sesión en el transporte de escrituras', async () => {
  const harness = createPanelHarness({
    snapshot: projectSnapshot(),
    responder: dataResponder((call) => {
      if (!call.url.includes('/api/state')) return null;
      if (call.method === 'POST') return jsonResponse(200, projectSnapshot());
      const id = new URL(call.url, 'http://panel.local').searchParams.get('panelProjectId') ?? '';
      return jsonResponse(200, projectSnapshot(id));
    }),
  });
  await harness.mount();
  selectNode(harness).props.onChange({ target: { value: 'p-admin' } });
  await harness.settle();

  const stateGets = () => harness.calls.filter((call) => call.method === 'GET' && call.url.includes('/api/state'));
  const first = new URL(stateGets()[0].url, 'http://panel.local');
  assert.equal(first.searchParams.get('panelProjectId'), 'p-admin', 'la identidad elegida viaja aparte');
  assert.notEqual(first.searchParams.get('cwd'), 'C:/lsc/faseb/administrado', 'la ruta del panel no se convierte en transporte');

  // Tras la primera lectura el transporte ya está inicializado, y debe hacerlo con la sesión del agente.
  selectNode(harness).props.onChange({ target: { value: 'p-agent' } });
  await harness.settle();
  const gets = stateGets();
  const last = new URL(gets[gets.length - 1].url, 'http://panel.local');
  assert.equal(last.searchParams.get('cwd'), 'C:/lsc/faseb/agente', 'la ruta transportada es la de la sesión');
  assert.equal(last.searchParams.get('panelProjectId'), 'p-agent');
});

test('T6: cambiar el proyecto del panel no cambia la biblioteca global ni las asignaciones', () => {
  const root = tempRoot('lsc-faseb-t6');
  const cwdA = tempProject('agente', root);
  const cwdB = tempProject('administrado', root);
  const agent = runAction({ root, action: 'open', cwd: cwdA, now: NOW });
  const admin = runAction({ root, action: 'open', cwd: cwdB, now: NOW });
  const created = runAction({ root, action: 'create', payload: candidate(), actor: 'ai', cwd: cwdA, now: NOW });
  assert.equal(created.ok, true);
  assert.equal(runAction({ root, action: 'toggle', actor: 'human', payload: { projectId: agent.project.id, skillId: created.id, enabled: true }, cwd: cwdA, now: NOW }).ok, true);
  assert.equal(runAction({ root, action: 'toggle', actor: 'human', payload: { projectId: admin.project.id, skillId: created.id, enabled: true }, cwd: cwdA, now: NOW }).ok, true);

  const snapshotFor = (projectId, cwd) => handleApiRequest({
    root,
    method: 'GET',
    pathname: API_PATH,
    search: `?cwd=${encodeURIComponent(cwd)}&panelProjectId=${encodeURIComponent(projectId)}`,
    hostCwd: cwdA,
    now: NOW,
  }).body;
  const onAgent = snapshotFor(agent.project.id, cwdA);
  const onAdmin = snapshotFor(admin.project.id, cwdA);

  assert.deepEqual(onAdmin.skills, onAgent.skills, 'la biblioteca es global');
  assert.deepEqual(onAdmin.assignments, onAgent.assignments, 'las asignaciones no se filtran ni se mutan');
  assert.notEqual(onAdmin.panelContext.projectId, onAgent.panelContext.projectId);
  assert.deepEqual(onAdmin.agentContext, onAgent.agentContext, 'la sesión del agente no cambia con el filtro');
});
