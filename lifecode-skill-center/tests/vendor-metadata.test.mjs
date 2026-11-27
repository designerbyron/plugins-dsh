/**
 * E1 / P-8: los metadatos del importador tienen que sobrevivir a la normalización del almacén.
 * `checkStoreShape=ok` por sí solo no basta: aquí se comprueba campo por campo.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createSkill } from '../lib/operations.mjs';
import { parseSkillFile } from '../lib/skillfile.mjs';
import {
  appendEvent, checkStoreShape, emptyState, fieldsLostByNormalization, normalizeState,
  vendorMetadataLosses,
} from '../lib/state.mjs';
import { vendorFixture } from './helpers-vendor.mjs';

function richState() {
  const fixture = vendorFixture();
  const parsed = parseSkillFile(fixture.content['SKILL.md']);
  const state = emptyState('2026-11-26T12:00:00.000Z');
  const created = createSkill(state, {
    id: 'context7',
    title: 'Context7',
    description: parsed.data.description,
    whenToUse: 'Cuando falte documentación de una biblioteca y el MCP no esté configurado.',
    body: parsed.body,
    tags: ['context7', 'docs'],
  }, { now: '2026-11-26T12:00:00.000Z' });
  assert.equal(created.ok, true, JSON.stringify(created.findings));

  const manifestSha256 = createHash('sha256').update(JSON.stringify(fixture.manifest)).digest('hex');
  const provenance = {
    kind: 'vendor',
    upstream: {
      repository: fixture.manifest.repository,
      tag: fixture.manifest.tag,
      commit: fixture.manifest.commit,
      fetchedAt: '2026-11-26T12:00:00.000Z',
      files: fixture.manifest.files.map(({ path, sha256, bytes, license }) => ({ path, sha256, bytes, license })),
    },
    manifestSha256,
    candidateId: fixture.manifest.candidateId,
    approvedBy: 'LifeCode Library Maintainer',
    signatureVerification: 'unverified',
    legalReviewRequired: true,
  };
  const license = {
    byFile: Object.fromEntries(fixture.manifest.files.map((entry) => [entry.path, {
      spdx: entry.license,
      file: entry.license === 'MIT' ? 'LICENSE-MIT' : 'LICENSE-CC-BY-SA-4.0',
      attribution: 'Netresearch DTT GmbH',
      modified: false,
      sourceUrl: `${fixture.manifest.repository}/blob/${fixture.manifest.commit}/${entry.path}`,
    }])),
    legalReviewRequired: true,
  };
  const files = fixture.manifest.files.map((entry) => ({ ...entry, role: entry.path === 'scripts/context7.sh' ? 'script' : 'document' }));
  for (const target of [state.skills.context7, created.version]) {
    target.provenance = structuredClone(provenance);
    target.license = structuredClone(license);
    target.files = structuredClone(files);
    target.vendorState = 'disabled';
  }
  appendEvent(state, {
    type: 'skill-vendor-imported',
    code: 'skill-vendor-imported',
    vendorState: 'disabled',
    candidateId: fixture.manifest.candidateId,
    manifestSha256,
    repository: fixture.manifest.repository,
    tag: fixture.manifest.tag,
    commit: fixture.manifest.commit,
    by: 'LifeCode Library Maintainer',
    operationId: 'op-p8',
    channel: 'api',
  });
  return { state, parsed: JSON.parse(JSON.stringify(state)), manifestSha256 };
}

test('P-8: un centro con procedencia vendor completa pasa checkStoreShape sin pérdidas', () => {
  const { parsed } = richState();
  assert.deepEqual(vendorMetadataLosses(parsed), []);
  assert.deepEqual(checkStoreShape(parsed), { ok: true });
});

test('round-trip: procedencia, licencias por fichero, hashes y evento sobreviven a normalizeState', () => {
  const { parsed } = richState();
  const reloaded = normalizeState(JSON.parse(JSON.stringify(parsed)));
  const skill = reloaded.skills.context7;
  assert.equal(skill.vendorState, 'disabled');
  assert.deepEqual(skill.provenance, parsed.skills.context7.provenance);
  assert.deepEqual(skill.license, parsed.skills.context7.license);
  assert.deepEqual(skill.files, parsed.skills.context7.files);
  assert.deepEqual(skill.versions[0].provenance, parsed.skills.context7.versions[0].provenance);
  assert.deepEqual(skill.versions[0].files, parsed.skills.context7.versions[0].files);
  const event = reloaded.events.find((entry) => entry.type === 'skill-vendor-imported');
  assert.equal(event.candidateId, parsed.events.find((entry) => entry.type === 'skill-vendor-imported').candidateId);
  assert.equal(event.channel, 'api');
  assert.equal(event.operationId, 'op-p8');
});

test('la detección general sí ve campos ajenos perdidos, pero nunca los cuatro campos vendor', () => {
  const { parsed } = richState();
  parsed.skills.context7.campoAjeno = 'se pierde';
  const lost = fieldsLostByNormalization(parsed);
  assert.ok(lost.includes('skills.context7.campoAjeno'));
  assert.equal(lost.some((entry) => entry.includes('.provenance') || entry.includes('.license') || entry.includes('.files') || entry.includes('.vendorState')), false);
});

test('un vendorState inventado se informa y checkStoreShape rechaza la escritura', () => {
  const { parsed } = richState();
  parsed.skills.context7.vendorState = 'encendido-a-escondidas';
  const losses = vendorMetadataLosses(parsed);
  assert.ok(losses.some((entry) => entry.includes('vendorState')));
  assert.equal(checkStoreShape(parsed).ok, false);
});

test('una license sin byFile o una provenance incompleta no se conserva a medias', () => {
  const { parsed } = richState();
  delete parsed.skills.context7.license.byFile;
  delete parsed.skills.context7.provenance.upstream.fetchedAt;
  const losses = vendorMetadataLosses(parsed);
  assert.ok(losses.some((entry) => entry.endsWith('.license no es metadato vendor válido y se descartaría')));
  assert.ok(losses.some((entry) => entry.endsWith('.provenance no es metadato vendor válido y se descartaría')));
});
