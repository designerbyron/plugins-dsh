/** K7-D: las comprobaciones se hacen sobre el tarball npm real, no sobre el árbol de trabajo. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { auditPackage } from '../tools/package-audit.mjs';

test('el tarball publicable pasa la auditoría completa K7-D', () => {
  const report = auditPackage();
  assert.equal(report.ok, true, JSON.stringify(report.problems));
  assert.equal(report.manifest.name, 'dsh-lifecode-skill-center');
  assert.equal(report.manifest.version, '1.1.0-rc.2');
  assert.equal(report.manifest.license, 'MIT');
  assert.equal(report.tarball.entryCount, report.files.length);
  assert.match(report.tarball.sha256, /^[a-f0-9]{64}$/);
  assert.match(report.tarball.sha512, /^[a-f0-9]{128}$/);
  assert.deepEqual(report.restrictedHits, []);
  assert.deepEqual(report.secretHits, []);
  assert.deepEqual(report.encodedHits, []);
  assert.ok(report.files.includes('package/host/vendor-candidate.mjs'));
  assert.ok(report.files.includes('package/host/source-adapter.mjs'));
  assert.ok(!report.files.some((file) => file.startsWith('package/vendor-adapters/')));
  assert.ok(!report.files.some((file) => ['package/tests/', 'package/tools/', 'package/plans/', 'package/stores/', 'package/reports/'].some((prefix) => file.startsWith(prefix))));
});
