/**
 * K8-B7/B8 · Pruebas negativas del auditor de paquete con payloads sintéticos originales.
 *
 * No copian ni codifican material de terceros: sólo comprueban que el auditor detecta formas
 * peligrosas de incrustar bytes y que NO confunde metadatos legítimos con payloads.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { scanEncodedPayloads } from '../tools/package-audit.mjs';

const longBase64 = Buffer.from('fixture sintética original'.repeat(40), 'utf8').toString('base64');

test('detecta un data URI con base64 largo', () => {
  const hits = scanEncodedPayloads('package/fixture.md', `texto\n${`data:text/plain;base64,${longBase64}`}\n`);
  assert.ok(hits.some((hit) => hit.kind === 'data-uri-base64'), JSON.stringify(hits));
});

test('detecta gzip codificado en base64', () => {
  const hits = scanEncodedPayloads('package/fixture.mjs', `const payload = 'H4sI${'AbCd+/9'.repeat(20)}';`);
  assert.ok(hits.some((hit) => hit.kind === 'gzip-base64'), JSON.stringify(hits));
});

test('detecta un bloque base64 largo que no es un hash', () => {
  const hits = scanEncodedPayloads('package/fixture.js', `const x = '${'AbCdEf+/0123'.repeat(20)}';`);
  assert.ok(hits.some((hit) => hit.kind === 'base64-block'), JSON.stringify(hits));
});

test('detecta magia de ficheros comprimidos en bytes', () => {
  for (const bytes of [
    Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]),
    Buffer.from([0x42, 0x5a, 0x68, 0x39]),
  ]) {
    const hits = scanEncodedPayloads('package/fixture.bin', bytes);
    assert.ok(hits.length > 0, bytes.toString('hex'));
  }
});

test('no marca hashes hexadecimales, fingerprints ni metadatos de procedencia', () => {
  const metadata = [
    '01d2f069127eeeaf0a02efe8e1429e0bddc57669',
    'c3726a19b5526a08ffcb5b03fa380fd30ec73e2c7062ef7e83ac1b008de17c65',
    'SHA256:NOxv8dcZlMFz3wrLdHILVNSnF6xskqAjN3bnn0i7K30',
    'https://github.com/netresearch/context7-skill',
    'internal-use-only legalReviewRequired=true redistribution=not-authorized',
  ].join('\n');
  assert.deepEqual(scanEncodedPayloads('package/host/vendor-candidate.mjs', metadata), []);
});

test('un bloque hexadecimal largo tampoco se considera payload', () => {
  assert.deepEqual(scanEncodedPayloads('package/fixture.md', 'a'.repeat(200)), []);
});
