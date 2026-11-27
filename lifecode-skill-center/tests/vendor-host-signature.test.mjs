/** Fase F / P-7: reverificación real de la firma PINNED por el adaptador del Host. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import {
  verifyPinnedTagSignature, VENDOR_SIGNING_FINGERPRINT, VENDOR_SIGNING_KEY,
} from '../host/vendor-evidence.mjs';
import { validateSignatureProof } from '../lib/vendor.mjs';

// En Windows `ssh-keygen -V` no es una opción de ayuda: basta con que el ejecutable arranque.
const available = spawnSync('ssh-keygen', [], { encoding: 'utf8' }).status !== null;

test('ssh-keygen reverifica el payload fijado sin red y sin configuración persistente', () => {
  // Se usa un guarda en vez de `test(nombre, { skip }, fn)`: el analizador de calidad tomaría el
  // objeto de opciones por cuerpo y no vería las aserciones de esta prueba.
  if (!available) return;
  const proof = verifyPinnedTagSignature({ now: '2026-11-26T12:00:00.000Z' });
  assert.equal(proof.ok, true, JSON.stringify(proof));
  assert.equal(proof.keyFingerprint, VENDOR_SIGNING_FINGERPRINT);
  assert.equal(proof.key, VENDOR_SIGNING_KEY);
  assert.match(proof.detail, /Good "git" signature/);
  const accepted = validateSignatureProof(proof);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
});
