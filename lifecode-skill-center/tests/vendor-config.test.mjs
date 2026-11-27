/** Fase F / F-31: configuración local del perfil, resuelta por el Host y nunca por PATH. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadVendorConfig, vendorConfigPath } from '../host/vendor-config.mjs';
import { pinnedVendorBundle } from '../host/vendor-pipeline.mjs';
import { vendorValidate } from '../lib/vendor.mjs';
import { fakeDependencies, verifiedSignatureProof } from './helpers-vendor.mjs';
import { syntheticCandidate } from './fixtures/synthetic-source.mjs';

const tempHome = () => mkdtempSync(join(tmpdir(), 'lsc-vendor-config-'));

test('la ruta se deriva del perfil y se puede redirigir para pruebas', () => {
  const home = tempHome();
  assert.equal(
    vendorConfigPath({ env: {}, home, profile: 'desktop' }),
    join(home, '.dsh', 'profiles', 'desktop', 'lifecode-vendor.json'),
  );
  assert.equal(
    vendorConfigPath({ env: {}, home, profile: '../malicioso' }),
    join(home, '.dsh', 'profiles', 'malicioso', 'lifecode-vendor.json'),
  );
  assert.equal(
    vendorConfigPath({ env: { LIFECODE_VENDOR_CONFIG: join(home, 'otro.json') }, home }),
    join(home, 'otro.json'),
  );
});

test('sin configuración no se inventa ningún binario', () => {
  const home = tempHome();
  const loaded = loadVendorConfig({ env: {}, home });
  assert.equal(loaded.found, false);
  assert.equal(loaded.jqBin, '');
  assert.equal(loaded.curlBin, '');
});

test('sólo se aceptan rutas absolutas; una configuración rota no habilita nada', () => {
  const home = tempHome();
  const file = vendorConfigPath({ env: {}, home, profile: 'desktop' });
  mkdirSync(join(home, '.dsh', 'profiles', 'desktop'), { recursive: true });
  writeFileSync(file, JSON.stringify({ jqBin: 'jq', curlBin: join(home, 'curl') }), 'utf8');
  const loaded = loadVendorConfig({ env: {}, home });
  assert.equal(loaded.found, true);
  assert.equal(loaded.jqBin, '', 'una ruta relativa no es prueba de instalación');
  assert.equal(loaded.curlBin, join(home, 'curl'));
  writeFileSync(file, '{ roto', 'utf8');
  assert.equal(loadVendorConfig({ env: {}, home }).found, false);
});

test('regresión: el bundle sin argumentos usa las MISMAS dependencias en el preflight y en V10', () => {
  const dependencies = fakeDependencies();
  const bundle = pinnedVendorBundle({
    now: '2026-11-26T18:00:00.000Z', dependencies, signatureProof: verifiedSignatureProof(),
    candidate: syntheticCandidate(),
  });
  assert.equal(bundle.ok, true);
  assert.equal(bundle.options.dependencies, dependencies);
  const validation = vendorValidate(bundle.candidate, bundle.options);
  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
});
