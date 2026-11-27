/** Fase F / P-7: la firma no se presume: sólo una prueba íntegra del adaptador la marca verificada. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  validateSignatureProof, vendorCandidateFromManifest, vendorImport, vendorValidate,
  VENDOR_COMMIT, VENDOR_SIGNING_FINGERPRINT, VENDOR_TAG,
} from '../lib/vendor.mjs';
import { emptyState, withState } from '../lib/state.mjs';
import { tempRoot } from './helpers.mjs';
import { validOptions, verifiedSignatureProof, vendorFixture } from './helpers-vendor.mjs';

const NOW = '2026-11-26T12:00:00.000Z';

test('la prueba correcta se acepta y queda ligada al tag, commit y clave fijados', () => {
  const result = validateSignatureProof(verifiedSignatureProof(), { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.proof.status, 'verified');
  assert.equal(result.proof.tag, VENDOR_TAG);
  assert.equal(result.proof.commit, VENDOR_COMMIT);
  assert.equal(result.proof.keyFingerprint, VENDOR_SIGNING_FINGERPRINT);
});

test('cualquier alteración de la prueba la invalida con código concreto', () => {
  const cases = [
    [null, 'vendor.signature.missing'],
    [{ ...verifiedSignatureProof(), status: 'unverified' }, 'vendor.signature.not-verified'],
    [{ ...verifiedSignatureProof(), tag: 'v1.7.2' }, 'vendor.signature.binding-mismatch'],
    [{ ...verifiedSignatureProof(), commit: '0'.repeat(40) }, 'vendor.signature.binding-mismatch'],
    [{ ...verifiedSignatureProof(), tagObject: '0'.repeat(40) }, 'vendor.signature.tag-object-mismatch'],
    [{ ...verifiedSignatureProof(), principal: 'otro@example.test' }, 'vendor.signature.principal-mismatch'],
    [{ ...verifiedSignatureProof(), keyFingerprint: 'SHA256:otra' }, 'vendor.signature.key-mismatch'],
    [{ ...verifiedSignatureProof(), verifiedAt: 'ayer' }, 'vendor.signature.no-verified-at'],
  ];
  for (const [proof, code] of cases) {
    const result = validateSignatureProof(proof);
    assert.equal(result.ok, false, code);
    assert.equal(result.code, code);
  }
});

test('sin prueba, vendorValidate no puede declarar verified aunque V1-V12 estén en verde', () => {
  const fixture = vendorFixture();
  const candidate = vendorCandidateFromManifest(fixture.manifest, { files: fixture.files });
  const result = vendorValidate(candidate, validOptions(fixture, { signatureProof: null }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'vendor.signature.missing');
  assert.equal(result.checks.length, 12, 'las doce compuertas se siguen evaluando');
  assert.equal(result.checks.every((check) => check.ok), true);
  assert.equal(result.signatureVerification, 'unverified');
});

test('una validación sin firma verificada no puede importar', () => {
  const fixture = vendorFixture();
  const candidate = vendorCandidateFromManifest(fixture.manifest, { files: fixture.files });
  const loaded = vendorValidate(candidate, validOptions(fixture, { signatureProof: null }));
  const root = tempRoot('lsc-vendor-signature-');
  const wrapped = withState(root, (state) => vendorImport(state, {
    confirmed: true,
    operationId: 'op-sin-firma',
    candidate,
    validation: { ...loaded, ok: true },
  }, { now: NOW }), { now: NOW });
  assert.equal(wrapped.result.ok, false);
  assert.equal(wrapped.result.code, 'vendor.signature-required');
  assert.equal(wrapped.saved, false);
  // El estado no existe todavía: la puerta falló antes de escribir.
  assert.equal(emptyState(NOW).skills.context7, undefined);
});
