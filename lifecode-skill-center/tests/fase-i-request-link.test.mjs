/**
 * Fase I — trazabilidad entre `req-562393e0835f` y la importación real de Context7.
 *
 * Todo ocurre en una raíz temporal: ni el centro productivo ni el plugin instalado se tocan. La
 * importación se siembra con el operationId autorizado para reproducir la importación humana real
 * sin volver a ejecutarla ni descargar nada.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runAction, VENDOR_MAINTAINER_ROLE } from '../lib/api.mjs';
import { emptyState, fieldsLostByNormalization, loadState, normalizeState, withState } from '../lib/state.mjs';
import {
  VENDOR_CANDIDATE_ID, VENDOR_MANIFEST_SHA256, VENDOR_SKILL_ID, vendorImport,
} from '../lib/vendor.mjs';
import {
  VENDOR_LINK_KIND, VENDOR_LINK_OPERATION_ID, VENDOR_LINK_REQUEST_ID, VENDOR_LINK_REQUEST_TEXT,
  VENDOR_LINK_ROLE, VENDOR_LINK_SKILL_VERSION, linkVendorRequest,
} from '../lib/request-links.mjs';
import { centerTools } from '../lib/tools.mjs';
import { pinnedVendorBundle } from '../host/vendor-pipeline.mjs';
import { tempRoot } from './helpers.mjs';
import { fakeDependencies, verifiedSignatureProof } from './helpers-vendor.mjs';
import { syntheticCandidate } from './fixtures/synthetic-source.mjs';

const NOW = '2026-11-26T23:00:00.000Z';
const REQUEST = Object.freeze({
  id: VENDOR_LINK_REQUEST_ID,
  text: VENDOR_LINK_REQUEST_TEXT,
  createdAt: '2026-11-18T03:28:07.079Z',
  status: 'pending',
  skillId: '',
  fulfilledAt: '',
  by: '',
  note: '',
});
const HUMAN = { actor: 'human', actorEvidence: { channel: 'browser', source: 'ui-channel' } };

function setup({ withRequest = true, requestText = VENDOR_LINK_REQUEST_TEXT, enroll = true } = {}) {
  const root = tempRoot('lsc-phase-i-');
  const file = join(root, 'center.json');
  const state = emptyState(NOW);
  if (withRequest) state.requests = { [VENDOR_LINK_REQUEST_ID]: { ...REQUEST, text: requestText } };
  writeFileSync(file, JSON.stringify(state), 'utf8');
  const bundle = pinnedVendorBundle({
    now: NOW, dependencies: fakeDependencies(), signatureProof: verifiedSignatureProof(),
    candidate: syntheticCandidate(),
  });
  assert.equal(bundle.ok, true);
  const options = { root, now: NOW, ...HUMAN, vendorBundle: bundle };
  if (enroll) {
    const result = runAction({ ...options, action: 'vendor-enroll' });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  const validation = {
    ok: true, code: 'V12', checks: [], failures: [], signatureVerification: 'verified',
    signatureProof: bundle.signatureProof, ambiguousLicense: true,
    licensePolicy: 'internal-use-only', legalReviewRequired: true,
  };
  const imported = withState(root, (draft) => vendorImport(draft, {
    confirmed: true,
    operationId: VENDOR_LINK_OPERATION_ID,
    candidate: bundle.candidate,
    validation,
    skillId: VENDOR_SKILL_ID,
    approvedBy: VENDOR_LINK_ROLE,
    channel: 'browser',
  }, { now: NOW, actor: 'human' }), { now: NOW });
  assert.equal(imported.result.ok, true, JSON.stringify(imported.result));
  return { root, file, bundle, options };
}

const call = (ctx, action, payload = {}, extra = {}) => runAction({ ...ctx.options, action, payload, ...extra });
const beforeBytes = (ctx) => readFileSync(ctx.file, 'utf8');

test('I-01 · vínculo válido: campos exactos, operación nueva y solicitud intacta', () => {
  const ctx = setup();
  const before = beforeBytes(ctx);
  const result = call(ctx, 'vendor-link-request', {
    requestId: 'req-inventada', operationId: 'operacion-del-cliente', role: 'admin', confirmed: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.notEqual(result.operationId, VENDOR_LINK_OPERATION_ID);
  assert.match(result.operationId, /^lsc-vendor-link-/);
  assert.deepEqual(result.link, {
    requestId: VENDOR_LINK_REQUEST_ID,
    operationId: VENDOR_LINK_OPERATION_ID,
    kind: VENDOR_LINK_KIND,
    skillId: VENDOR_SKILL_ID,
    version: VENDOR_LINK_SKILL_VERSION,
    candidateId: VENDOR_CANDIDATE_ID,
    manifestSha256: VENDOR_MANIFEST_SHA256,
    linkedAt: NOW,
    by: VENDOR_LINK_ROLE,
    channel: 'browser',
  });
  const state = loadState(ctx.root).state;
  assert.deepEqual(state.requests[VENDOR_LINK_REQUEST_ID], REQUEST);
  assert.deepEqual(state.requestLinks[VENDOR_LINK_REQUEST_ID], result.link);
  assert.notEqual(before, beforeBytes(ctx), 'el vínculo sí es una escritura');
});

test('I-02 · solicitud inexistente: falla cerrado sin escribir', () => {
  const ctx = setup({ withRequest: false });
  const before = beforeBytes(ctx);
  const result = call(ctx, 'vendor-link-request');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'request-link.request-missing');
  assert.equal(beforeBytes(ctx), before);
});

test('I-03 · texto incompatible con el repositorio Context7', () => {
  const ctx = setup({ requestText: 'vendoriza otra cosa desde https://ejemplo.invalid/skill' });
  const before = beforeBytes(ctx);
  const result = call(ctx, 'vendor-link-request');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'request-link.text-mismatch');
  assert.equal(beforeBytes(ctx), before);
});

function mutate(ctx, fn) {
  withState(ctx.root, (state) => { fn(state); }, { now: NOW });
}

test('I-04 · operación inexistente', () => {
  const ctx = setup();
  mutate(ctx, (state) => {
    // Se renombra (no se vacía) para mantener el documento íntegro: un mapa vacío se descarta al
    // normalizar y eso lo marcaría como invalid-shape antes de llegar a la compuerta de vínculo.
    state.operations['otra-operacion'] = state.operations[VENDOR_LINK_OPERATION_ID];
    delete state.operations[VENDOR_LINK_OPERATION_ID];
  });
  const result = call(ctx, 'vendor-link-request');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'request-link.operation-missing');
});

test('I-05 · operación que no es vendor-import', () => {
  const ctx = setup();
  mutate(ctx, (state) => { state.operations[VENDOR_LINK_OPERATION_ID].kind = 'fork'; });
  const result = call(ctx, 'vendor-link-request');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'request-link.operation-kind');
});

test('I-06 · manifest incorrecto en procedencia y evento', () => {
  const ctx = setup();
  mutate(ctx, (state) => {
    state.skills[VENDOR_SKILL_ID].provenance.manifestSha256 = 'f'.repeat(64);
    state.events.find((event) => event.type === 'skill-vendor-imported').manifestSha256 = 'f'.repeat(64);
  });
  const result = call(ctx, 'vendor-link-request');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'request-link.manifest-mismatch');
});

test('I-07 · skill incorrecta: candidateId distinto del autorizado', () => {
  const ctx = setup();
  mutate(ctx, (state) => { state.skills[VENDOR_SKILL_ID].provenance.candidateId = 'otro-candidato@1.0.0'; });
  const result = call(ctx, 'vendor-link-request');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'request-link.candidate-mismatch');
});

test('I-08 · actor falso: el dominio lo rechaza y el canal tool no abre la compuerta', () => {
  const ctx = setup();
  const state = loadState(ctx.root).state;
  const pure = linkVendorRequest(state, { operationId: 'lsc-vendor-link-falso' }, {
    now: NOW, actor: 'ai', role: VENDOR_LINK_ROLE, channel: 'browser',
  });
  assert.equal(pure.ok, false);
  assert.equal(pure.code, 'request-link.actor-required');
  const api = call(ctx, 'vendor-link-request', {}, { actor: 'ai', actorEvidence: { channel: 'tool' } });
  assert.equal(api.ok, false);
  assert.equal(api.code, 'vendor.human-required');
});

test('I-09 · rol falso: el dominio lo rechaza; el cuerpo HTTP no elige rol', () => {
  const ctx = setup();
  const state = loadState(ctx.root).state;
  const pure = linkVendorRequest(state, { operationId: 'lsc-vendor-link-falso' }, {
    now: NOW, actor: 'human', role: 'admin', channel: 'browser',
  });
  assert.equal(pure.ok, false);
  assert.equal(pure.code, 'request-link.role-required');
  const api = call(ctx, 'vendor-link-request', { role: 'admin', by: 'alguien', actor: 'ai' });
  assert.equal(api.ok, true, 'el payload no es autoridad: el backend fija el rol');
  assert.equal(loadState(ctx.root).state.requestLinks[VENDOR_LINK_REQUEST_ID].by, VENDOR_MAINTAINER_ROLE);
});

test('I-10 · canales tool y api rechazados por la compuerta humana', () => {
  for (const options of [
    { actor: 'ai', actorEvidence: { channel: 'tool' } },
    { actor: 'human', actorEvidence: { channel: 'api' } },
  ]) {
    const ctx = setup();
    const before = beforeBytes(ctx);
    const result = call(ctx, 'vendor-link-request', {}, options);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'vendor.human-required');
    assert.equal(beforeBytes(ctx), before);
  }
});

test('I-11 · sesión humana sin rol habilitado rechazada', () => {
  const ctx = setup({ enroll: false });
  const before = beforeBytes(ctx);
  const result = call(ctx, 'vendor-link-request');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'vendor.maintainer-required');
  assert.equal(beforeBytes(ctx), before);
});

test('I-12 · reintento idéntico: devuelve el enlace, no crea otro evento ni escribe', () => {
  const ctx = setup();
  const first = call(ctx, 'vendor-link-request');
  assert.equal(first.replayed, false);
  const afterFirst = beforeBytes(ctx);
  const eventsBefore = loadState(ctx.root).state.events.length;
  const second = call(ctx, 'vendor-link-request');
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.deepEqual(second.link, first.link);
  assert.equal(loadState(ctx.root).state.events.length, eventsBefore);
  assert.equal(beforeBytes(ctx), afterFirst, 'el reintento no reescribe el centro');
});

test('I-13 · enlace incompatible: request-link-conflict', () => {
  const ctx = setup();
  call(ctx, 'vendor-link-request');
  mutate(ctx, (state) => { state.requestLinks[VENDOR_LINK_REQUEST_ID].operationId = 'otra-operacion'; });
  const before = beforeBytes(ctx);
  const result = call(ctx, 'vendor-link-request');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'request-link-conflict');
  assert.equal(beforeBytes(ctx), before);
});

test('I-14 · normalización y round-trip de requestLinks sin pérdidas', () => {
  const ctx = setup();
  const linked = loadState(ctx.root).state;
  call(ctx, 'vendor-link-request');
  const loaded = loadState(ctx.root);
  assert.equal(loaded.integrity, 'ok');
  const normalized = normalizeState(loaded.state);
  assert.deepEqual(normalized.requestLinks, loaded.state.requestLinks);
  assert.deepEqual(fieldsLostByNormalization(loaded.state).filter((loss) => loss.includes('requestLinks')), []);
  // Los eventos de auditoría conservan requestId, operationId y channel tras la recarga.
  const event = normalized.events.find((entry) => entry.type === 'skill.request-linked');
  assert.equal(event.requestId, VENDOR_LINK_REQUEST_ID);
  assert.match(event.operationId, /^lsc-vendor-link-/);
  assert.equal(event.channel, 'browser');
  assert.ok(linked.requestLinks === undefined || Object.keys(linked.requestLinks).length === 0);
});

test('I-15 · la solicitud histórica conserva sus ocho campos y su pending', () => {
  const ctx = setup();
  call(ctx, 'vendor-link-request');
  const request = loadState(ctx.root).state.requests[VENDOR_LINK_REQUEST_ID];
  assert.deepEqual(Object.keys(request), ['id', 'text', 'createdAt', 'status', 'skillId', 'fulfilledAt', 'by', 'note']);
  assert.deepEqual(request, REQUEST);
  assert.equal(request.status, 'pending');
});

test('I-16 · Context7 sin cambios: skill, versión, procedencia y firma', () => {
  const ctx = setup();
  const before = structuredClone(loadState(ctx.root).state.skills[VENDOR_SKILL_ID]);
  call(ctx, 'vendor-link-request');
  const after = loadState(ctx.root).state.skills[VENDOR_SKILL_ID];
  assert.deepEqual(after, before);
  assert.equal(after.vendorState, 'disabled');
  assert.equal(after.versions.length, 1);
  assert.equal(after.versions[0].provenance.signatureVerification, 'verified');
  assert.equal(after.license.legalReviewRequired, true);
  assert.equal(after.license.policy, 'internal-use-only');
});

test('I-17 · cero assignments y ningún evento de activación', () => {
  const ctx = setup();
  call(ctx, 'vendor-link-request');
  const state = loadState(ctx.root).state;
  assert.deepEqual(state.assignments, {});
  const activation = state.events.filter((event) =>
    event.skillId === VENDOR_SKILL_ID && ['skill.assigned', 'skill.advanced', 'skill.loaded', 'skill.unassigned'].includes(event.type));
  assert.deepEqual(activation, []);
});

test('I-18 · auditoría: evento humano, operationId distinto y ambos comprobantes', () => {
  const ctx = setup();
  const result = call(ctx, 'vendor-link-request');
  const state = loadState(ctx.root).state;
  const event = state.events.find((entry) => entry.type === 'skill.request-linked');
  assert.ok(event);
  assert.equal(event.actor, 'human');
  assert.equal(event.by, VENDOR_LINK_ROLE);
  assert.equal(event.requestId, VENDOR_LINK_REQUEST_ID);
  assert.equal(event.operationId, result.operationId);
  assert.equal(event.operationId === VENDOR_LINK_OPERATION_ID, false);
  assert.equal(state.operations[VENDOR_LINK_OPERATION_ID].kind, 'vendor-import');
  assert.equal(state.operations[result.operationId].kind, 'vendor-link-request');
  assert.equal(state.events.filter((entry) => entry.type === 'skill-vendor-imported').length, 1);
});

test('I-19 · corrección administrativa: se retira sólo el vínculo, no la importación', () => {
  const ctx = setup();
  const linked = call(ctx, 'vendor-link-request');
  const importedSkill = structuredClone(loadState(ctx.root).state.skills[VENDOR_SKILL_ID]);
  const result = call(ctx, 'vendor-unlink-request');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.notEqual(result.operationId, linked.operationId);
  assert.notEqual(result.operationId, VENDOR_LINK_OPERATION_ID);
  const state = loadState(ctx.root).state;
  assert.equal(state.requestLinks, undefined);
  assert.deepEqual(state.requests[VENDOR_LINK_REQUEST_ID], REQUEST);
  assert.deepEqual(state.skills[VENDOR_SKILL_ID], importedSkill);
  assert.equal(state.operations[VENDOR_LINK_OPERATION_ID].kind, 'vendor-import');
  assert.equal(state.events.filter((entry) => entry.type === 'skill-vendor-imported').length, 1);
  assert.equal(state.events.filter((entry) => entry.type === 'skill.request-link-reverted').length, 1);
  assert.deepEqual(state.assignments, {});
});

test('I-20 · ninguna herramienta del modelo puede vincular ni corregir', () => {
  const names = centerTools().map((tool) => tool.name);
  assert.equal(names.some((name) => /vendor|link-request/i.test(name)), false);
});

test('I-21 · la revisión publica el vínculo como dato, sin escribir ni marcar fulfilled', () => {
  const ctx = setup();
  const review = call(ctx, 'vendor-review');
  assert.equal(review.ok, true);
  assert.deepEqual(review.vendor.sourceRequest, { id: REQUEST.id, text: REQUEST.text, status: REQUEST.status });
  assert.equal(review.vendor.requestLink, null);
  assert.equal(review.vendor.importOperationId, VENDOR_LINK_OPERATION_ID);
  assert.equal(review.vendor.importVersion, VENDOR_LINK_SKILL_VERSION);
  const before = beforeBytes(ctx);
  call(ctx, 'vendor-review');
  assert.equal(beforeBytes(ctx), before);
  call(ctx, 'vendor-link-request');
  const after = call(ctx, 'vendor-review');
  assert.equal(after.vendor.requestLink.operationId, VENDOR_LINK_OPERATION_ID);
  assert.equal(after.vendor.sourceRequest.status, 'pending');
});
