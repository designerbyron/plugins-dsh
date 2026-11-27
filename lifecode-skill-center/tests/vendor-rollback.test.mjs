/** E7: reversión sin borrado físico, con diario, comprobantes y asignaciones intactos. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  emptyState, loadState, verifyBackup, withState,
} from '../lib/state.mjs';
import {
  planVendorRollback, revertVendorImport, vendorCandidateFromManifest, vendorImport,
} from '../lib/vendor.mjs';
import { tempRoot } from './helpers.mjs';
import { vendorFixture, verifiedValidation } from './helpers-vendor.mjs';

const T0 = '2026-11-26T12:00:00.000Z';
const T1 = '2026-11-26T12:05:00.000Z';

function imported({ assign = false } = {}) {
  const fixture = vendorFixture();
  const candidate = vendorCandidateFromManifest(fixture.manifest, { files: fixture.files });
  const root = tempRoot('lsc-vendor-rollback');
  writeFileSync(join(root, 'center.json'), JSON.stringify(emptyState(T0)), 'utf8');
  const input = {
    confirmed: true, operationId: 'op-rb-1', candidate,
    validation: verifiedValidation(fixture),
    approvedBy: 'LifeCode Library Maintainer',
  };
  const wrapped = withState(root, (state) => {
    if (assign) state.assignments = { p1: { context7: { enabled: true, by: 'human' } } };
    return vendorImport(state, input, { now: T0 });
  }, { now: T0 });
  assert.equal(wrapped.result.ok, true);
  return { root, candidate, fixture, file: join(root, 'center.json') };
}

test('planVendorRollback identifica la operación y no toca el estado', () => {
  const { root } = imported();
  const before = readFileSync(join(root, 'center.json'), 'utf8');
  const state = loadState(root).state;
  const plan = planVendorRollback(state, { skillId: 'context7', version: '1.0.0', operationId: 'op-rb-1' });
  assert.equal(plan.ok, true);
  assert.equal(plan.existedBefore, false);
  assert.equal(plan.manifestSha256.length, 64);
  assert.equal(readFileSync(join(root, 'center.json'), 'utf8'), before);
});

test('el plan rechaza skill ausente, operación ajena, versión distinta y skill asignada', () => {
  const { root } = imported({ assign: true });
  const state = loadState(root).state;
  const cases = [
    [{ skillId: 'otra', version: '1.0.0', operationId: 'op-rb-1' }, 'vendor.rollback.missing-skill'],
    [{ skillId: 'context7', version: '1.0.0', operationId: 'otra-op' }, 'vendor.rollback.no-event'],
    [{ skillId: 'context7', version: '2.0.0', operationId: 'op-rb-1' }, 'vendor.rollback.version-mismatch'],
    [{ skillId: 'context7', version: '1.0.0', operationId: 'op-rb-1' }, 'vendor.rollback.assigned'],
  ];
  for (const [input, code] of cases) {
    const plan = planVendorRollback(state, input);
    assert.equal(plan.ok, false, code);
    assert.equal(plan.code, code);
  }
});

test('la reversión marca rolled_back/deprecated, conserva la historia y deja la huella verificable', () => {
  const { root, candidate } = imported();
  const before = loadState(root).state;
  const wrapped = withState(root, (state) => revertVendorImport(state, {
    skillId: 'context7', version: '1.0.0', operationId: 'op-rb-1',
  }, { now: T1 }), { now: T1 });
  assert.equal(wrapped.result.ok, true, JSON.stringify(wrapped.result));
  assert.equal(wrapped.result.physicalDeletion, false);
  assert.equal(wrapped.saved, true);

  const after = loadState(root);
  assert.equal(after.integrity, 'ok');
  const skill = after.state.skills.context7;
  assert.ok(skill, 'no se borra físicamente la skill');
  assert.equal(skill.vendorState, 'rolled_back');
  assert.equal(skill.status, 'deprecated');
  assert.equal(skill.versions[0].vendorState, 'rolled_back');
  assert.equal(skill.versions.length, before.skills.context7.versions.length);
  assert.equal(after.state.events.length, before.events.length + 1);
  assert.equal(after.state.events.some((event) => event.type === 'skill-vendor-imported'), true);
  assert.equal(after.state.events.at(-1).type, 'skill-vendor-reverted');
  assert.equal(after.state.operations['op-rb-1'].kind, 'vendor-import');
  assert.equal(after.state.operations['op-rb-1:rollback'].kind, 'vendor-rollback');
  assert.equal(verifyBackup(root).ok, true);

  const recomputed = skill.files.map((entry) => createHash('sha256')
    .update(candidate.content.get(entry.path)).digest('hex'));
  assert.deepEqual(recomputed, skill.files.map((entry) => entry.sha256));
});

test('revertir dos veces la misma operación es idempotente y no escribe', () => {
  const { root } = imported();
  const first = withState(root, (state) => revertVendorImport(state, {
    skillId: 'context7', version: '1.0.0', operationId: 'op-rb-1',
  }, { now: T1 }), { now: T1 });
  const second = withState(root, (state) => revertVendorImport(state, {
    skillId: 'context7', version: '1.0.0', operationId: 'op-rb-1',
  }, { now: T1 }), { now: T1 });
  assert.equal(first.result.idempotent, false);
  assert.equal(second.result.idempotent, true);
  assert.equal(second.saved, false);
  const events = loadState(root).state.events.filter((event) => event.type === 'skill-vendor-reverted');
  assert.equal(events.length, 1);
});

test('la reversión no toca asignaciones de otros skills', () => {
  const { root } = imported();
  withState(root, (state) => {
    state.assignments = { p2: { 'otra-skill': { enabled: true, by: 'human' } } };
  }, { now: T1 });
  withState(root, (state) => revertVendorImport(state, {
    skillId: 'context7', version: '1.0.0', operationId: 'op-rb-1',
  }, { now: T1 }), { now: T1 });
  assert.deepEqual(loadState(root).state.assignments, {
    p2: { 'otra-skill': { enabled: true, by: 'human', version: '', updatedAt: '' } },
  });
});
