/** E6: importación transaccional, sin activación, sin asignación y con idempotencia durable. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  checkStoreShape, emptyState, loadState, vendorMetadataLosses, withState,
} from '../lib/state.mjs';
import {
  vendorCandidateFromManifest, vendorImport, VENDOR_SIGNING_FINGERPRINT, VENDOR_SKILL_ID,
} from '../lib/vendor.mjs';
import { tempRoot } from './helpers.mjs';
import { validOptions, vendorFixture, verifiedValidation } from './helpers-vendor.mjs';

const NOW = '2026-11-26T12:00:00.000Z';
const verificationFingerprint = VENDOR_SIGNING_FINGERPRINT;

function setup() {
  const fixture = vendorFixture();
  const candidate = vendorCandidateFromManifest(fixture.manifest, { files: fixture.files });
  assert.equal(candidate.ok, true);
  const validation = verifiedValidation(fixture);
  const root = tempRoot('lsc-vendor-import');
  const file = join(root, 'center.json');
  writeFileSync(file, JSON.stringify(emptyState(NOW)), 'utf8');
  return { root, file, fixture, candidate, validation };
}

function apply(root, mutate, now = NOW) {
  return withState(root, mutate, { now });
}

function baseInput(candidate, validation, overrides = {}) {
  return {
    confirmed: true,
    operationId: 'op-import-1',
    candidate,
    validation,
    approvedBy: 'LifeCode Library Maintainer',
    channel: 'api',
    ...overrides,
  };
}

test('la importación deja la skill en disabled, sin activar ni asignar, y pasa P-8', () => {
  const { root, file, candidate, validation } = setup();
  const wrapped = apply(root, (state) => {
    state.assignments = { 'proyecto-ajeno': { 'otra-skill': { enabled: true, assignedBy: 'human' } } };
    return vendorImport(state, baseInput(candidate, validation, { skillId: VENDOR_SKILL_ID }), { now: NOW });
  });
  assert.equal(wrapped.result.ok, true, JSON.stringify(wrapped.result));
  assert.equal(wrapped.saved, true);
  assert.equal(wrapped.result.vendorState, 'disabled');
  assert.equal(wrapped.result.activated, false);
  assert.equal(wrapped.result.assigned, false);

  const loaded = loadState(root);
  assert.equal(loaded.integrity, 'ok');
  const skill = loaded.state.skills[VENDOR_SKILL_ID];
  assert.equal(skill.vendorState, 'disabled');
  assert.equal(skill.status, 'published');
  assert.equal(skill.provenance.manifestSha256, candidate.manifestSha256);
  assert.equal(skill.provenance.signatureVerification, 'verified');
  assert.equal(skill.provenance.signatureProof.keyFingerprint, verificationFingerprint);
  assert.equal(skill.provenance.licensePolicy, 'internal-use-only');
  assert.equal(skill.provenance.ambiguousLicense, true);
  assert.equal(skill.license.policy, 'internal-use-only');
  assert.equal(skill.license.ambiguous, true);
  assert.equal(skill.provenance.legalReviewRequired, true);
  assert.equal(skill.versions[0].vendorState, 'disabled');
  assert.deepEqual(loaded.state.assignments, {
    'proyecto-ajeno': { 'otra-skill': { enabled: true, by: 'human', version: '', updatedAt: '' } },
  });
  const event = loaded.state.events.find((entry) => entry.type === 'skill-vendor-imported');
  assert.equal(event.operationId, 'op-import-1');
  assert.equal(event.channel, 'api');
  assert.equal(loaded.state.operations['op-import-1'].kind, 'vendor-import');
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(vendorMetadataLosses(parsed), []);
  assert.equal(checkStoreShape(parsed).ok, true);
});

test('repetir el operationId no duplica evento ni escritura', () => {
  const { root, candidate, validation } = setup();
  const first = apply(root, (state) => vendorImport(state, baseInput(candidate, validation), { now: NOW }));
  const second = apply(root, (state) => vendorImport(state, baseInput(candidate, validation), { now: NOW }), '2026-11-26T12:01:00.000Z');
  assert.equal(first.result.ok, true);
  assert.equal(second.result.ok, true);
  assert.equal(second.result.idempotent, true);
  assert.equal(second.saved, false);
  const loaded = loadState(root);
  assert.equal(loaded.state.events.filter((entry) => entry.type === 'skill-vendor-imported').length, 1);
});

test('se rechazan destinos, actor no humano, falta de confirmación y operación sin id', () => {
  const { root, candidate, validation } = setup();
  const cases = [
    ['assign', baseInput(candidate, validation, { assign: { projectId: 'p1' } }), 'vendor.destination-forbidden'],
    ['projectId', baseInput(candidate, validation, { projectId: 'p1' }), 'vendor.destination-forbidden'],
    ['activate', baseInput(candidate, validation, { activate: true }), 'vendor.destination-forbidden'],
    ['sin confirmar', baseInput(candidate, validation, { confirmed: false }), 'vendor.confirmation-required'],
    ['sin operationId', baseInput(candidate, validation, { operationId: '' }), 'vendor.operation-id-required'],
    ['validación roja', baseInput(candidate, { ok: false }), 'vendor.validation-required'],
    ['candidate ausente', baseInput(null, validation), 'vendor.candidate-required'],
    ['id inseguro', baseInput(candidate, validation, { skillId: '../malo' }), 'vendor.invalid-id'],
  ];
  for (const [name, input, expected] of cases) {
    const wrapped = apply(root, (state) => vendorImport(state, input, { now: NOW }));
    assert.equal(wrapped.result.ok, false, name);
    assert.equal(wrapped.result.code, expected, name);
    assert.equal(wrapped.saved, false, name);
  }
  const ai = apply(root, (state) => vendorImport(state, baseInput(candidate, validation), { now: NOW, actor: 'ai' }));
  assert.equal(ai.result.code, 'vendor.actor-required');
});

test('un id ocupado con otra procedencia no se sobrescribe', () => {
  const { root, candidate, validation } = setup();
  apply(root, (state) => {
    const skill = emptyState().skills;
    void skill;
    state.skills.context7 = {
      id: 'context7', title: 'Otra', description: 'x', whenToUse: 'y', tags: [], status: 'published',
      currentVersion: '1.0.0', versions: [{ version: '1.0.0', body: 'cuerpo', references: {}, createdAt: NOW, checksum: 'a'.repeat(12) }],
      origin: { kind: 'human', from: null, fromVersion: null, note: '' },
    };
  });
  const wrapped = apply(root, (state) => vendorImport(state, baseInput(candidate, validation), { now: NOW }));
  assert.equal(wrapped.result.code, 'vendor.id-conflict');
  assert.equal(wrapped.saved, false);
});

test('el cuerpo importado es el del upstream, con descripción recortada al contrato de enrutado', () => {
  const { root, candidate, validation, fixture } = setup();
  const wrapped = apply(root, (state) => vendorImport(state, baseInput(candidate, validation), { now: NOW }));
  assert.equal(wrapped.result.ok, true);
  const skill = loadState(root).state.skills[VENDOR_SKILL_ID];
  assert.ok(skill.description.length >= 60 && skill.description.length <= 300);
  assert.ok(skill.whenToUse.length <= 200);
  assert.ok(skill.versions[0].body.includes('# Context7 Documentation Lookup Skill'));
  assert.equal(fixture.content['SKILL.md'].includes(skill.versions[0].body.slice(0, 40)), true);
});
