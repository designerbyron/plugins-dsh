/**
 * E5/E4: licencias por fichero, atribución conservada y calificación pendiente (P-1).
 * La técnica no declara resuelta la interpretación jurídica de `(MIT AND CC-BY-SA-4.0)`.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { validateHardenedScript, validateVendorLicenses } from '../lib/vendor.mjs';
import { vendorFixture } from './helpers-vendor.mjs';
import { SYNTHETIC_ADAPTER_SCRIPT } from './fixtures/synthetic-source.mjs';

test('V6: mapa de seis ficheros, MIT para el script y CC BY-SA para el resto', () => {
  const fixture = vendorFixture();
  const result = validateVendorLicenses(fixture.files, { manifest: fixture.manifest });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(Object.keys(result.byFile).length, 6);
  assert.equal(result.byFile['scripts/context7.sh'].spdx, 'MIT');
  assert.equal(result.byFile['LICENSE-MIT'].spdx, 'MIT');
  assert.equal(result.byFile['SKILL.md'].spdx, 'CC-BY-SA-4.0');
  assert.equal(Object.values(result.byFile).every((entry) => entry.attribution === 'Netresearch DTT GmbH'), true);
});

test('la cuestión jurídica queda abierta aunque la comprobación técnica pase', () => {
  const fixture = vendorFixture();
  const result = validateVendorLicenses(fixture.files, { manifest: fixture.manifest });
  assert.equal(result.ambiguous, true);
  assert.equal(result.finalLicenseValidation, false);
  assert.equal(result.legalReviewRequired, true);
});

test('un texto de licencia alterado o una SPDX cambiada bloquea', () => {
  const fixture = vendorFixture();
  const noMit = new Map(fixture.files);
  noMit.set('LICENSE-MIT', Buffer.from('sin texto'));
  assert.equal(validateVendorLicenses(noMit, { manifest: fixture.manifest }).ok, false);

  const noNotice = new Map(fixture.files);
  noNotice.set('scripts/context7.sh', Buffer.from('#!/bin/bash\ncurl -s "$url"\n'));
  assert.equal(validateVendorLicenses(noNotice, { manifest: fixture.manifest }).ok, false);

  const wrongSpdx = structuredClone(fixture.manifest);
  wrongSpdx.files[0].license = 'GPL-3.0';
  assert.equal(validateVendorLicenses(fixture.files, { manifest: wrongSpdx }).ok, false);
});

test('la fixture sintética conserva MIT, atribución y el hash declarado en su README', () => {
  const script = SYNTHETIC_ADAPTER_SCRIPT;
  const actual = createHash('sha256').update(Buffer.from(script)).digest('hex');
  const readme = [
    '# Adaptador sintético de demostración',
    '',
    'Contenido original del laboratorio. No incluye material de terceros.',
    `SHA-256 adaptado | \`${actual}\``,
    'legalReviewRequired=true',
    'firma: unverified (fixture)',
  ].join('\n');
  assert.match(script, /SPDX-License-Identifier:\s*MIT/);
  assert.match(script, /SPDX-FileCopyrightText:\s*Fixture sintético LSC/);
  assert.equal(validateHardenedScript(script, { original: script }).ok, true);
  const declared = /SHA-256 adaptado \| `([a-f0-9]{64})`/.exec(readme)?.[1];
  assert.equal(declared, actual);
  assert.match(readme, /legalReviewRequired=true/);
  assert.match(readme, /unverified/);
});
