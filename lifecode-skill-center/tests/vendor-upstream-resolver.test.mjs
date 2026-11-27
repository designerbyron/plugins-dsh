/**
 * K8-B5 · Resolución del candidato desde una referencia fijada, sólo bajo solicitud humana.
 * Usa exclusivamente fixtures sintéticas originales: sin red, sin bytes de Context7 y sin lectura
 * de `vendor-adapters/**`. El caso de demostración PINNED se prueba en el smoke opcional.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolvePinnedCandidateFromUpstream } from '../host/vendor-candidate.mjs';
import { resolveVendorBundleFromUpstream } from '../host/vendor-pipeline.mjs';
import { fakeDependencies, verifiedSignatureProof } from './helpers-vendor.mjs';
import {
  SYNTHETIC_ADAPTER_SCRIPT, syntheticFetch, syntheticManifest, syntheticReference,
} from './fixtures/synthetic-source.mjs';

const NOW = '2026-11-26T19:00:00.000Z';
const AUTH = { role: 'human', by: 'maintainer', requestId: 'req-k8b-resolver', at: NOW };
const REFERENCE = syntheticReference();
const MANIFEST = syntheticManifest();
const verifyProof = () => verifiedSignatureProof();

test('sin solicitud humana no hay red ni resolución', async () => {
  let called = false;
  const result = await resolvePinnedCandidateFromUpstream({
    humanAuthorization: null,
    fetchImpl: async () => { called = true; throw new Error('no debió llamar'); },
    verifyProof,
    now: NOW,
    reference: REFERENCE,
    manifest: MANIFEST,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'vendor.candidate.human-request-required');
  assert.equal(called, false);
});

test('una solicitud incompleta o no humana también queda bloqueada', async () => {
  for (const auth of [
    { role: 'ai', by: 'bot', requestId: 'r', at: NOW },
    { role: 'human', by: '', requestId: 'r', at: NOW },
    { role: 'human', by: 'maintainer', requestId: '', at: NOW },
    { role: 'human', by: 'maintainer', requestId: 'r', at: 'no-fecha' },
  ]) {
    const result = await resolvePinnedCandidateFromUpstream({
      humanAuthorization: auth, verifyProof, now: NOW, reference: REFERENCE, manifest: MANIFEST,
    });
    assert.equal(result.code, 'vendor.candidate.human-request-required');
  }
});

test('la firma debe verificarse contra la prueba fijada antes de descargar', async () => {
  const { fetchImpl, calls } = syntheticFetch();
  const result = await resolvePinnedCandidateFromUpstream({
    humanAuthorization: AUTH,
    fetchImpl,
    verifyProof: () => ({ status: 'unverified' }),
    now: NOW,
    reference: REFERENCE,
    manifest: MANIFEST,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'vendor.candidate.signature-invalid');
  assert.equal(calls.length, 0);
});

test('resuelve los seis ficheros, comprueba hashes y limpia el temporal', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'lsc-resolver-ok-'));
  const { fetchImpl, calls, manifestBytes } = syntheticFetch();
  try {
    const result = await resolvePinnedCandidateFromUpstream({
      humanAuthorization: AUTH, fetchImpl, verifyProof, now: NOW, tmpRoot,
      reference: REFERENCE, manifest: MANIFEST,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.files.size, 6);
    assert.deepEqual([...result.files.keys()], MANIFEST.files.map((entry) => entry.path));
    assert.equal(result.manifestBytes.equals(manifestBytes), true);
    assert.equal(result.humanAuthorization.requestId, AUTH.requestId);
    assert.equal(calls.length, 7);
    const base = `https://raw.githubusercontent.com/${REFERENCE.repository.replace('https://github.com/', '')}/${REFERENCE.commit}/${REFERENCE.tree}`;
    assert.ok(calls.every((url) => url.startsWith(base)));
    assert.deepEqual(readdirSync(tmpRoot), []);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('rechaza un fichero que difiere del hash fijado y no deja temporales', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'lsc-resolver-bad-'));
  const { fetchImpl } = syntheticFetch({ corrupt: 'SKILL.md' });
  try {
    const result = await resolvePinnedCandidateFromUpstream({
      humanAuthorization: AUTH, fetchImpl, verifyProof, now: NOW, tmpRoot,
      reference: REFERENCE, manifest: MANIFEST,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'vendor.candidate.file-mismatch');
    assert.equal(result.path, 'SKILL.md');
    assert.deepEqual(readdirSync(tmpRoot), []);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('el bundle exige además el script endurecido aportado por una persona', async () => {
  const { fetchImpl } = syntheticFetch();
  const result = await resolveVendorBundleFromUpstream({
    humanAuthorization: AUTH,
    fetchImpl,
    verifyProof,
    now: NOW,
    dependencies: fakeDependencies(),
    reference: REFERENCE,
    manifest: MANIFEST,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'vendor.candidate.hardened-script-required');
});

test('con autorización, hashes y script revisado el bundle queda listo pero desactivado', async () => {
  const { fetchImpl } = syntheticFetch();
  const result = await resolveVendorBundleFromUpstream({
    humanAuthorization: AUTH,
    hardenedScript: SYNTHETIC_ADAPTER_SCRIPT,
    fetchImpl,
    verifyProof,
    now: NOW,
    dependencies: fakeDependencies(),
    reference: REFERENCE,
    manifest: MANIFEST,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.candidate.ok, true);
  assert.equal(result.candidate.status, 'NOT_ACTIVATED');
  assert.equal(result.options.dependencies.ok, true);
  assert.equal(result.reference.licensePolicy, 'internal-use-only');
  assert.equal(result.reference.legalReviewRequired, true);
  assert.equal(result.reference.attribution, 'Netresearch DTT GmbH');
});
