/**
 * Fase C de LSC-UX-IA-VENDOR-001: ciclo durable de una solicitud a la IA.
 *
 * Cubre los contratos nuevos con ejecución real contra el código del plugin:
 *  - T1/T2: los tres registros históricos se leen como legacy/global SIN reescribirlos ni migrarlos;
 *    `req-562393e0835f` conserva id, texto y estado, y no se adjudica a ningún proyecto.
 *  - T3/T4: entrega con evidencia, claim atómico, expiración del lease, propiedad al cerrar.
 *  - T5/T6: una petición no entregada no se reclama; `status` nunca reclama; fallo/bloqueo/reanudación;
 *    una propuesta deja la petición bloqueada, nunca cumplida.
 *  - T7/T8: el handoff del Host exige agente vivo y devuelve un messageId real; sin él no se escribe.
 *  - T9/T10: la identidad del agente sale del Host, no del payload; la cola completa llega al modelo.
 *  - T11/T12: el Request Center existe, pinta el texto como dato y ofrece preparar, no entregar falsamente.
 *
 * Todo corre en cajas de arena. Ninguna prueba toca `~/.dsh/`, el perfil Desktop ni la versión instalada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleApiRequest, runAction } from '../lib/api.mjs';
import {
  claimRequest, deliverRequest, failRequest, fulfillRequest, linkProposal, openRequest,
  projectRequest, requestView, resumeRequest, blockRequest,
} from '../lib/requests.mjs';
import { emptyState, loadState, saveState } from '../lib/state.mjs';
import { agentContext, centerTools, lifecodeSkillRequest, lifecodeSkillStatus } from '../lib/tools.mjs';
import { createHandoff } from '../index.js';
import { candidate, tempRoot } from './helpers.mjs';
import { createPanelHarness, findByPredicate, jsonResponse, textOf } from './r17-ui-runtime.mjs';

const NOW = '2026-11-25T12:00:00.000Z';
const API_PATH = '/lifecode-skill-center/api/state';
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'historical-requests.json');
const LEGACY_ID = 'req-562393e0835f';
const DISMISSED_ID = 'req-ae7ed6149f96';
const FULFILLED_ID = 'req-f77c4f76b367';

function digest(root) {
  const file = join(root, 'center.json');
  if (!existsSync(file)) return 'absent';
  const bytes = readFileSync(file);
  return `${createHash('sha256').update(bytes).digest('hex')}:${statSync(file).mtimeMs}:${bytes.length}`;
}

function historical() {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')).requests;
}

function seededRoot(label) {
  const root = tempRoot(label);
  const state = emptyState(NOW);
  state.requests = structuredClone(historical());
  saveState(root, state, { now: NOW });
  return root;
}

function withSkill(state, id) {
  const base = candidate({ id, description: `Descripción de ${id} para probar el ciclo de peticiones del centro`, whenToUse: 'Cuando haga falta verificar el ciclo de una petición humana' });
  state.skills[id] = {
    id,
    title: `Skill ${id}`,
    description: base.description,
    whenToUse: base.whenToUse,
    tags: [],
    status: 'published',
    currentVersion: '1.0.0',
    createdAt: NOW,
    updatedAt: NOW,
    origin: { kind: 'ai', from: '', fromVersion: '', note: '' },
    versions: [{ version: '1.0.0', description: base.description, whenToUse: base.whenToUse, tags: [], body: base.body, references: {}, createdAt: NOW, checksum: 'abc', notes: '' }],
  };
}

function deliveredState(label, { kind = 'vendorize', scope = 'global', owner = 'ses-agente' } = {}) {
  const state = emptyState(NOW);
  const opened = openRequest(state, { text: 'necesito una skill que compruebe una instalación', kind, scope }, { now: NOW });
  assert.equal(opened.ok, true);
  const delivery = deliverRequest(state, opened.id, { sessionId: owner, messageId: `msg-${opened.id}` }, { now: NOW });
  assert.equal(delivery.ok, true);
  return { state, id: opened.id, owner };
}

function fakeCtx(agents) {
  return { get: (name) => (name === 'agents' ? { get: (id) => agents[id] ?? null } : null) };
}

/* ───────────────────────────── históricos, sin migración ───────────────────────────── */

test('T1: los tres registros históricos se leen sin reescribirlos ni reasignarlos', () => {
  const root = seededRoot('lsc-fc-t1');
  const before = digest(root);
  const loaded = loadState(root);
  const view = requestView(loaded.state);

  assert.equal(loaded.integrity, 'ok');
  assert.deepEqual(Object.keys(loaded.state.requests).sort(), [DISMISSED_ID, FULFILLED_ID, LEGACY_ID].sort());
  const legacy = loaded.state.requests[LEGACY_ID];
  assert.equal(legacy.id, LEGACY_ID);
  assert.equal(legacy.text, 'vendoriza la skill desde https://github.com/netresearch/context7-skill');
  assert.equal(legacy.status, 'pending');
  assert.equal(legacy.kind, undefined, 'la lectura NO inventa un tipo');
  assert.equal(legacy.scope, undefined, 'la lectura NO inventa un ámbito');
  assert.equal(legacy.projectId, undefined, 'la lectura NO adjudica un proyecto');
  assert.equal(legacy.delivery, undefined);

  const projected = projectRequest(legacy);
  assert.equal(projected.kind, 'unclassified');
  assert.equal(projected.scope, 'legacy/global');
  assert.equal(projected.effectiveStatus, 'pending');
  assert.equal(view.summary.pending, 1);
  assert.equal(view.all.length, 3, 'la vista completa incluye la petición antigua');
  assert.ok(view.all.some((entry) => entry.id === LEGACY_ID));
  assert.equal(digest(root), before, 'leer no es migrar: el disco queda byte a byte igual');
});

test('T2: el caso heredado se atiende desde pending sin tocar los otros dos ni importar nada', () => {
  const root = seededRoot('lsc-fc-t2');
  const loaded = loadState(root);
  const state = loaded.state;
  const before = digest(root);
  withSkill(state, 'vendorizada-desde-context7');
  const fulfilled = fulfillRequest(state, LEGACY_ID, { skillId: 'vendorizada-desde-context7', note: 'respondida sin migrar' }, { now: NOW });
  assert.equal(fulfilled.ok, true, JSON.stringify(fulfilled));
  assert.equal(fulfilled.request.status, 'fulfilled');
  assert.equal(fulfilled.request.skillId, 'vendorizada-desde-context7');
  assert.equal(fulfilled.request.kind, undefined, 'seguir sin tipo es la decisión; cumplir no clasifica');
  assert.deepEqual(state.requests[DISMISSED_ID], historical()[DISMISSED_ID]);
  assert.deepEqual(state.requests[FULFILLED_ID], historical()[FULFILLED_ID]);
  assert.equal(digest(root), before, 'la compatibilidad se ejerce en memoria: la lectura no escribe');

  const unknown = runAction({ root, action: 'create', actor: 'ai', now: NOW, payload: { ...candidate(), requestId: 'req-inventado' } });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'unknown-request', 'un requestId inventado no crea ni enlaza');
});

/* ─────────────────────────── entrega, claim y lease ─────────────────────────── */

test('T3: entregada → reclamada → cumplida deja evidencia en cada paso', () => {
  const { state, id, owner } = deliveredState('lsc-fc-t3');
  assert.equal(state.requests[id].status, 'delivered');
  assert.equal(state.requests[id].delivery.messageId, `msg-${id}`);
  assert.equal(state.requests[id].attempts, 1);

  const claimed = claimRequest(state, id, { owner, sessionId: owner }, { now: NOW });
  assert.equal(claimed.ok, true);
  assert.equal(state.requests[id].status, 'processing');
  assert.equal(state.requests[id].claim.owner, owner);

  const second = claimRequest(state, id, { owner: 'ses-otra', sessionId: 'ses-otra' }, { now: NOW });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'claim-active', 'el claim es excluyente');

  withSkill(state, 'skill-del-ciclo');
  const done = fulfillRequest(state, id, { skillId: 'skill-del-ciclo', sessionId: owner }, { now: NOW });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(state.requests[id].status, 'fulfilled');
  assert.equal(state.requests[id].result.kind, 'skill');
  assert.equal(state.requests[id].claim, null);
});

test('T4: un lease caducado se recupera y la propiedad se comprueba al cerrar', () => {
  const { state, id } = deliveredState('lsc-fc-t4');
  const first = claimRequest(state, id, { owner: 'ses-muerta', sessionId: 'ses-muerta' }, { now: NOW, leaseMs: 1000 });
  assert.equal(first.ok, true);
  const later = '2026-11-25T12:02:00.000Z';
  const projected = projectRequest(state.requests[id]);
  // `projectRequest` mira el reloj real: con un expiresAt ya pasado en el pasado absoluto, se declara caducado.
  assert.equal(projected.claimExpired, true);
  assert.equal(projected.effectiveStatus, 'pending');
  const reclaimed = claimRequest(state, id, { owner: 'ses-viva', sessionId: 'ses-viva' }, { now: later });
  assert.equal(reclaimed.ok, true, 'el lease caducado se recupera');
  assert.equal(state.requests[id].claim.owner, 'ses-viva');

  assert.equal(failRequest(state, id, { sessionId: 'ses-muerta', errorCode: 'x' }, { now: later }).code, 'claim-mismatch');
  assert.equal(blockRequest(state, id, { sessionId: 'ses-viva', blockedReason: '' }, { now: later }).code, 'missing-blocked-reason');
  const blocked = blockRequest(state, id, { sessionId: 'ses-viva', blockedReason: 'falta aprobación humana' }, { now: later });
  assert.equal(blocked.ok, true);
  assert.equal(state.requests[id].status, 'blocked');
  assert.equal(state.requests[id].blockedReason, 'falta aprobación humana');
  assert.equal(resumeRequest(state, id, { now: later, actor: 'ai' }).code, 'approval-required');
  const resumed = resumeRequest(state, id, { now: later, actor: 'human' });
  assert.equal(resumed.ok, true);
  assert.equal(state.requests[id].status, 'pending');
  assert.equal(state.requests[id].delivery, null, 'reanudar exige nueva entrega');
});

test('T5: una petición sin entrega no se reclama y la entrega exige evidencia real', () => {
  const state = emptyState(NOW);
  const opened = openRequest(state, { text: 'necesito ayuda', kind: 'general', scope: 'global' }, { now: NOW });
  assert.equal(claimRequest(state, opened.id, { owner: 'ses' }, { now: NOW }).code, 'not-delivered');
  assert.equal(deliverRequest(state, opened.id, { sessionId: 'ses' }, { now: NOW }).code, 'missing-delivery-evidence');
  assert.equal(deliverRequest(state, opened.id, { sessionId: 'ses', messageId: 'msg' }, { now: NOW, actor: 'ai' }).code, 'approval-required');
  assert.equal(state.requests[opened.id].status, 'pending');

  const delivered = deliverRequest(state, opened.id, { sessionId: 'ses', messageId: 'msg' }, { now: NOW });
  assert.equal(delivered.ok, true);
  assert.equal(deliverRequest(state, opened.id, { sessionId: 'ses', messageId: 'otro' }, { now: NOW }).code, 'already-delivered');
});

test('T6: una propuesta no cumple la petición: queda bloqueada hasta aprobación', () => {
  const { state, id, owner } = deliveredState('lsc-fc-t6');
  withSkill(state, 'skill-a-mejorar');
  assert.equal(claimRequest(state, id, { owner, sessionId: owner }, { now: NOW }).ok, true);
  const linked = linkProposal(state, id, { improvementId: 'imp-123', sessionId: owner }, { now: NOW });
  assert.equal(linked.ok, true);
  assert.equal(state.requests[id].status, 'blocked');
  assert.deepEqual(state.requests[id].result, { kind: 'improvement', id: 'imp-123', at: NOW, note: 'proposal-awaiting-approval' });
  assert.equal(fulfillRequest(state, id, { skillId: 'skill-a-mejorar', sessionId: owner }, { now: NOW }).code, 'settled');
});

/* ─────────────────────────── API y handoff del Host ─────────────────────────── */

test('T7: request-deliver sólo escribe si el Host devuelve un messageId; sin handoff sigue pendiente', () => {
  const root = seededRoot('lsc-fc-t7');
  const opened = runAction({ root, action: 'request-skill', actor: 'human', now: NOW, payload: { text: 'entrega verificable', kind: 'general', scope: 'global', projectId: '' } });
  assert.equal(opened.ok, true);
  const noHandoff = handleApiRequest({ root, method: 'POST', pathname: API_PATH, body: { action: 'request-deliver', payload: { requestId: opened.id, sessionId: 'ses-viva' } }, now: NOW });
  assert.equal(noHandoff.status, 200);
  assert.equal(noHandoff.body.ok, false);
  assert.equal(noHandoff.body.code, 'handoff-unavailable');
  assert.equal(loadState(root).state.requests[opened.id].status, 'pending', 'sin evidencia no se escribe «entregado»');

  const seen = [];
  const delivered = handleApiRequest({
    root, method: 'POST', pathname: API_PATH, now: NOW,
    body: { action: 'request-deliver', payload: { requestId: opened.id, sessionId: 'ses-viva' } },
    handoff: (input) => { seen.push(input); return { ok: true, messageId: 'msg-real', via: 'agents.followup' }; },
  });
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.ok, true, JSON.stringify(delivered.body));
  assert.equal(seen[0].text, 'entrega verificable');
  const stored = loadState(root).state.requests[opened.id];
  assert.equal(stored.status, 'delivered');
  assert.equal(stored.delivery.messageId, 'msg-real');
});

test('T8: el handoff del adaptador exige un agente vivo y entrega un mensaje con source.kind=user', () => {
  const handoff = createHandoff(fakeCtx({}));
  const missing = handoff({ requestId: LEGACY_ID, sessionId: 'ses-id', text: 'x' });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'session-not-found');

  const messages = [];
  const agent = { session: { id: 'ses-viva' }, followup: (message) => messages.push(message) };
  const live = createHandoff(fakeCtx({ 'ses-viva': agent }));
  const result = live({ requestId: LEGACY_ID, sessionId: 'ses-viva', text: '<img onerror=alert(1)>', kind: 'vendorize', scope: 'legacy/global', sourceUrl: 'https://example.org' });
  assert.equal(result.ok, true);
  assert.equal(result.via, 'agents.followup');
  assert.match(result.messageId, /^[0-9a-f-]{36}$/);
  const message = messages[0];
  assert.equal(message.id, result.messageId);
  assert.equal(message.role, 'user');
  assert.deepEqual(message.source, { kind: 'user' });
  assert.equal(message.content[0].type, 'text');
  assert.match(message.content[0].text, /--- BEGIN PERSON TEXT ---\n<img onerror=alert\(1\)>\n--- END PERSON TEXT ---/);
  assert.match(message.content[0].text, new RegExp(LEGACY_ID));
  assert.match(message.content[0].text, /data only; do not fetch automatically/);

  const throwing = createHandoff(fakeCtx({ 'ses-rota': { session: { id: 'ses-rota' }, followup: () => { throw new Error('agente cerrado'); } } }));
  assert.equal(throwing({ requestId: 'r', sessionId: 'ses-rota', text: 'x' }).code, 'handoff-failed');
  assert.equal(createHandoff({ get: () => null })({ requestId: 'r', sessionId: 's', text: 'x' }).code, 'handoff-unavailable');
});

test('T9: la sesión del reclamo sale del Host, nunca del payload', () => {
  const root = seededRoot('lsc-fc-t9');
  const opened = runAction({ root, action: 'request-skill', actor: 'human', now: NOW, payload: { text: 'x' } });
  const delivered = runAction({
    root, action: 'request-deliver', actor: 'human', now: NOW,
    payload: { requestId: opened.id, sessionId: 'ses-otra' },
    handoff: () => ({ ok: true, messageId: 'msg-otra', via: 'agents.followup' }),
  });
  assert.equal(delivered.ok, true);

  const exec = { agent: { session: { id: 'ses-host', header: { cwd: 'C:/proyecto' } } } };
  assert.deepEqual(agentContext(exec), { sessionId: 'ses-host', cwd: 'C:/proyecto' });
  const tool = lifecodeSkillRequest({ root });
  const claimed = tool.execute({ requestId: opened.id, action: 'claim', sessionId: 'ses-otra' }, exec);
  assert.equal(claimed.status, 'ok');
  assert.equal(claimed.claim.owner, 'ses-host', 'el sessionId del payload no suplanta al Host');
  assert.equal(loadState(root).state.requests[opened.id].claim.owner, 'ses-host', 'el dueño escrito es el del Host');
});

test('T10: lifecode_skill_status muestra la cola completa y leer nunca reclama', () => {
  const root = seededRoot('lsc-fc-t10');
  const before = digest(root);
  const tool = lifecodeSkillStatus({ root });
  const value = tool.execute({}, { agent: { session: { id: 'ses', header: { cwd: 'C:/proyecto' } } } });
  assert.equal(value.status, 'ok');
  assert.equal(value.requests.actionable, 1);
  assert.equal(value.requests.items[0].id, LEGACY_ID);
  assert.match(value.summary, new RegExp(LEGACY_ID));
  assert.match(value.summary, /vendoriza la skill desde/);
  assert.equal(digest(root), before, 'status es de sólo lectura: no reclama ni escribe');
  assert.equal(centerTools({ root }).length, 6, 'seis herramientas, ninguna de aprobar o activar');
  assert.deepEqual(centerTools({ root }).map((tool_) => tool_.name), [
    'lifecode_skill_search', 'lifecode_skill_create', 'lifecode_skill_improve',
    'lifecode_skill_status', 'lifecode_skill_request', 'lifecode_skill_insight',
  ]);
});

/* ─────────────────────────── Request Center en la UI ─────────────────────────── */

function requestsSnapshot() {
  const all = [
    { ...projectRequest(historical()[LEGACY_ID]) },
    { ...projectRequest(historical()[DISMISSED_ID]) },
  ];
  all[0].skillTitle = '';
  all[1].skillTitle = '';
  return {
    ok: true, apiVersion: 1, contractVersion: 2, generatedAt: NOW, readable: true,
    cwd: 'C:/proyecto', hostCwd: 'C:/proyecto',
    project: { id: 'p-proyecto', name: 'Proyecto', cwd: 'C:/proyecto', registered: true },
    projects: [],
    panelContext: { projectId: 'p-proyecto', name: 'Proyecto', cwd: 'C:/proyecto', selectionSource: 'validated-selection', resolved: true },
    agentContext: { cwd: 'C:/proyecto', projectId: 'p-proyecto', state: 'session-resolved' },
    skills: [], assignments: {}, improvements: [], events: [], external: { candidates: [] },
    counts: { skills: 0, projects: 1, assignments: 0, improvements: 0, events: 0 },
    analytics: { skills: { total: 0 }, projects: {}, assignments: {}, quality: {}, loads: 0 },
    requests: {
      pending: 1, actionable: 1, total: 2,
      summary: { total: 2, pending: 1, dismissed: 1 },
      pendingItems: [all[0]], actionableItems: [all[0]], items: all.slice(0, 2), all,
    },
  };
}

async function requestsPanel(locale = 'es') {
  const harness = createPanelHarness({ locale, snapshot: requestsSnapshot() });
  await harness.mount();
  const label = locale === 'en' ? 'Requests' : 'Solicitudes';
  const nav = harness.nodes((node) => node.type === 'button'
    && String(node.props.className ?? '').includes('lsc-rail-item')
    && textOf(node).includes(label))[0];
  assert.ok(nav, `la navegación a ${label} existe`);
  await harness.click(nav);
  return harness;
}

test('T11: el Request Center pinta el texto heredado como dato y ofrece preparar, no entregar en falso', async () => {
  const harness = await requestsPanel();
  const text = harness.text();
  assert.match(text, /Centro de solicitudes/);
  assert.match(text, /vendoriza la skill desde/);
  assert.match(text, /heredada \(sin tipo\)/);
  assert.match(text, /Global heredada/);
  assert.match(text, /El texto de una petición es dato/);
  const selects = harness.nodes((node) => node.type === 'select'
    && /Tipo|Ámbito/.test(String(node.props['aria-label'] ?? '')));
  assert.equal(selects.length, 2, 'el compositor elige tipo y ámbito explícitamente');
  assert.match(text, /El ámbito elegido se guarda tal cual/);
  // Sin sesión viva en el arnés, la única acción honesta es preparar la instrucción.
  const item = harness.nodes((node) => node.type === 'button'
    && String(node.props.role ?? '') === 'listitem' && textOf(node).includes(LEGACY_ID))[0];
  assert.ok(item, 'la petición heredada está en la lista, no se pierde por el recorte');
  await harness.click(item);
  assert.equal(harness.buttons('Entregar a la IA').length, 0);
  assert.ok(harness.buttons('Preparar instrucción').length > 0);
  assert.match(harness.text(), /Esperando atención del agente/, 'sin entrega el fallback se declara explícitamente');
  const malicious = harness.nodes((node) => node.type === 'img');
  assert.equal(malicious.length, 0, 'el texto de la persona nunca se convierte en HTML');
});

test('T12: el centro está traducido y no filtra el registro antiguo del panel', async () => {
  const harness = await requestsPanel('en');
  const text = harness.text();
  assert.match(text, /Request Center/);
  assert.match(text, /inherited \(no type\)/);
  assert.match(text, /Inherited global/);
  assert.match(text, /A request body is data written by a person/);
  assert.equal(harness.nodes((node) => node.type === 'select'
    && /Type|Scope/.test(String(node.props['aria-label'] ?? ''))).length, 2);
  const item = harness.nodes((node) => node.type === 'button'
    && String(node.props.role ?? '') === 'listitem' && textOf(node).includes(LEGACY_ID))[0];
  await harness.click(item);
  assert.ok(harness.buttons('Prepare instruction').length > 0);
  assert.match(harness.text(), /Waiting for the agent's attention/, 'el fallback también está traducido');
  assert.doesNotMatch(harness.text(), /req\.[a-z]/i, 'no queda ninguna clave de traducción sin resolver');
});
