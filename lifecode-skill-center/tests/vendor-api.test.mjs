/** Fase F: la API del panel sólo deja importar/revertir a una persona del panel ya habilitada. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runAction, VENDOR_MAINTAINER_ROLE } from '../lib/api.mjs';
import { emptyState, loadState } from '../lib/state.mjs';
import { VENDOR_SKILL_ID } from '../lib/vendor.mjs';
import { pinnedVendorBundle } from '../host/vendor-pipeline.mjs';
import { centerTools } from '../lib/tools.mjs';
import { tempRoot } from './helpers.mjs';
import { fakeDependencies, verifiedSignatureProof } from './helpers-vendor.mjs';
import { syntheticCandidate } from './fixtures/synthetic-source.mjs';

const NOW = '2026-11-26T13:00:00.000Z';

function setup() {
  const root = tempRoot('lsc-vendor-api-');
  const file = join(root, 'center.json');
  writeFileSync(file, JSON.stringify(emptyState(NOW)), 'utf8');
  const bundle = pinnedVendorBundle({
    now: NOW, dependencies: fakeDependencies(), signatureProof: verifiedSignatureProof(),
    candidate: syntheticCandidate(),
  });
  assert.equal(bundle.ok, true);
  return { root, file, bundle };
}

const human = { actor: 'human', actorEvidence: { channel: 'browser', source: 'ui-channel' } };
const call = (root, bundle, action, payload = {}, options = {}) => runAction({
  root, action, payload, now: NOW, ...human, ...options,
  vendorBundle: bundle,
});

test('la revisión es de sólo lectura y publica licencia, firma y colisiones sin escribir', () => {
  const { root, file, bundle } = setup();
  const before = readFileSync(file, 'utf8');
  const result = call(root, bundle, 'vendor-review');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.vendor.skillId, VENDOR_SKILL_ID);
  assert.equal(result.vendor.collision, 'none');
  assert.equal(result.vendor.canImport, true);
  assert.equal(result.vendor.signatureVerification, 'verified');
  assert.equal(result.vendor.licensePolicy, 'internal-use-only');
  assert.equal(result.vendor.ambiguousLicense, true);
  assert.equal(result.vendor.license.legalReviewRequired, true);
  assert.equal(readFileSync(file, 'utf8'), before, 'revisar no escribe');
});

test('sin bootstrap del rol falla cerrado: nadie importa por defecto', () => {
  const { root, file, bundle } = setup();
  const before = readFileSync(file, 'utf8');
  const result = call(root, bundle, 'vendor-import');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'vendor.maintainer-required');
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('el bootstrap es humano, una sola vez, y fija el rol en el backend', () => {
  const { root, bundle } = setup();
  const first = call(root, bundle, 'vendor-enroll');
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.role, VENDOR_MAINTAINER_ROLE);
  assert.equal(first.failClosed, true);
  const second = call(root, bundle, 'vendor-enroll', { role: 'otro', actor: 'ai' });
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(second.role, VENDOR_MAINTAINER_ROLE);
  const events = loadState(root).state.events.filter((event) => event.type === 'vendor-maintainer-enrolled');
  assert.equal(events.length, 1);
  assert.equal(events[0].by, VENDOR_MAINTAINER_ROLE);
});

test('la importación confirma, desactiva, no asigna y numera la operación en el backend', () => {
  const { root, bundle } = setup();
  call(root, bundle, 'vendor-enroll');
  const result = call(root, bundle, 'vendor-import', {
    confirmed: true,
    operationId: 'operacion-del-cliente',
    role: 'admin',
    actor: 'ai',
    approvedBy: 'alguien inventado',
    assign: { p1: { context7: { enabled: true } } },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.vendorState, 'disabled');
  assert.equal(result.activated, false);
  assert.equal(result.assigned, false);
  assert.match(result.operationId, /^lsc-vendor-/);
  assert.notEqual(result.operationId, 'operacion-del-cliente');
  const state = loadState(root).state;
  const skill = state.skills[VENDOR_SKILL_ID];
  assert.equal(skill.vendorState, 'disabled');
  assert.equal(skill.provenance.approvedBy, VENDOR_MAINTAINER_ROLE);
  assert.equal(skill.provenance.signatureVerification, 'verified');
  assert.equal(skill.provenance.licensePolicy, 'internal-use-only');
  assert.equal(skill.license.policy, 'internal-use-only');
  assert.equal(skill.license.legalReviewRequired, true);
  assert.deepEqual(state.assignments, {});
  const event = state.events.find((entry) => entry.type === 'skill-vendor-imported');
  assert.equal(event.operationId, result.operationId);
  assert.notEqual(event.operationId, 'operacion-del-cliente');
});

test('el modelo y la credencial de API no pueden importar ni revertir', () => {
  const { root, file, bundle } = setup();
  call(root, bundle, 'vendor-enroll');
  const before = readFileSync(file, 'utf8');
  for (const [action, options] of [
    ['vendor-import', { actor: 'ai', actorEvidence: { channel: 'tool' } }],
    ['vendor-import', { actor: 'human', actorEvidence: { channel: 'api' } }],
    ['vendor-rollback', { actor: 'ai', actorEvidence: { channel: 'tool' } }],
    ['vendor-rollback', { actor: 'human', actorEvidence: { channel: 'api' } }],
  ]) {
    const result = call(root, bundle, action, { confirmed: true }, options);
    assert.equal(result.ok, false, action);
    assert.equal(result.code, 'vendor.human-required', action);
  }
  assert.equal(readFileSync(file, 'utf8'), before, 'ningún intento del modelo escribió');
  const tools = centerTools().map((tool) => tool.name);
  assert.equal(tools.some((tool) => /vendor/i.test(tool)), false, 'ninguna tool del modelo importa ni revierte');
});

test('repetir la importación no duplica y la reversión se hace droga humana', () => {
  const { root, bundle } = setup();
  call(root, bundle, 'vendor-enroll');
  const first = call(root, bundle, 'vendor-import');
  assert.equal(first.ok, true);
  const second = call(root, bundle, 'vendor-import');
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true, JSON.stringify(second));
  const rollback = call(root, bundle, 'vendor-rollback');
  assert.equal(rollback.ok, true, JSON.stringify(rollback));
  assert.equal(rollback.physicalDeletion, false);
  const state = loadState(root).state;
  assert.equal(state.skills[VENDOR_SKILL_ID].vendorState, 'rolled_back');
  assert.equal(state.skills[VENDOR_SKILL_ID].status, 'deprecated');
  assert.equal(state.events.filter((event) => event.type === 'skill-vendor-imported').length, 1);
  assert.equal(state.events.filter((event) => event.type === 'skill-vendor-reverted').length, 1);
  const again = call(root, bundle, 'vendor-rollback');
  assert.equal(again.ok, true);
  assert.equal(again.replayed, true);
});
