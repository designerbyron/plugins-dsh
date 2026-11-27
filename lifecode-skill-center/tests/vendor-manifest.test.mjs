/** E2: manifiesto de seis ficheros, hashes byte a byte y huella agregada reproducible. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildVendorFileMap, manifestFingerprint, readVendorCandidate, verifyManifest,
  vendorCandidateFromManifest, VENDOR_CANDIDATE_ID, VENDOR_COMMIT, VENDOR_FILE_PATHS,
} from '../lib/vendor.mjs';
import { vendorFixture } from './helpers-vendor.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('el manifiesto describe exactamente los seis ficheros acordados', () => {
  const fixture = vendorFixture();
  assert.deepEqual(fixture.manifest.files.map((entry) => entry.path), [...VENDOR_FILE_PATHS]);
  assert.equal(fixture.manifest.candidateId, VENDOR_CANDIDATE_ID);
  assert.equal(fixture.manifest.commit, VENDOR_COMMIT);
  assert.equal(fixture.manifest.files.every((entry) => entry.commit === VENDOR_COMMIT), true);
});

test('verifyManifest acepta bytes en memoria y devuelve el contenido sin tocar red', () => {
  const fixture = vendorFixture();
  const result = verifyManifest(fixture.manifest, { files: fixture.files });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.code, 'manifest.verified');
  assert.equal(result.files.length, 6);
  assert.deepEqual(result.files.map((entry) => entry.sha256), fixture.manifest.files.map((entry) => entry.sha256));
});

test('la huella agregada es la de los bytes del manifiesto (BOM incluido, como en D5)', () => {
  const fixture = vendorFixture();
  const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(fixture.manifest), 'utf8')]);
  const parsed = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  const result = readVendorCandidate({
    root: '/staging',
    readFile: (path) => path.endsWith('MANIFEST.json')
      ? raw
      : fixture.files.get(String(path).replace(/^.*[\\/]staging[\\/]/, '').replace(/\\/g, '/')),
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.manifestSha256, sha(raw));
  assert.equal(result.candidateId, fixture.manifest.candidateId);
  assert.equal(result.content instanceof Map, true);
  assert.notEqual(manifestFingerprint(parsed), sha(raw));
});

test('un hash, un tamaño o una ruta cambiados rompen la verificación', () => {
  const fixture = vendorFixture();
  const badHash = structuredClone(fixture.manifest);
  badHash.files[0].sha256 = '0'.repeat(64);
  assert.equal(verifyManifest(badHash, { files: fixture.files }).ok, false);

  const badBytes = structuredClone(fixture.manifest);
  badBytes.files[1].bytes += 1;
  assert.equal(verifyManifest(badBytes, { files: fixture.files }).ok, false);

  const badPath = structuredClone(fixture.manifest);
  badPath.files[2].path = '../secreto';
  assert.equal(verifyManifest(badPath, { files: fixture.files }).ok, false);
});

test('un fichero sustituido por un enlace simbólico se rechaza antes de leerlo', () => {
  const fixture = vendorFixture();
  const result = verifyManifest(fixture.manifest, {
    root: '/staging',
    files: new Map(),
    readFile: () => { throw new Error('no debería leerse'); },
    lstat: (path) => ({ isSymbolicLink: () => path.endsWith('SKILL.md') }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('enlace simbólico')));
});

test('el candidato verificado conserva licencia por fichero pero no credenciales', () => {
  const fixture = vendorFixture();
  const candidate = vendorCandidateFromManifest(fixture.manifest, { files: fixture.files });
  assert.equal(candidate.ok, true);
  assert.equal(Object.keys(candidate.license.byFile).length, 6);
  assert.equal(candidate.license.byFile['scripts/context7.sh'].spdx, 'MIT');
  assert.equal(candidate.license.byFile['SKILL.md'].spdx, 'CC-BY-SA-4.0');
  assert.equal(candidate.license.legalReviewRequired, true);
  const serialized = JSON.stringify(candidate);
  assert.equal(/CONTEXT7_API_KEY\s*=/.test(serialized), false);
});

test('buildVendorFileMap admite mapa, lista y objeto sin perder bytes', () => {
  const fixture = vendorFixture();
  const bytes = fixture.files.get('SKILL.md');
  assert.deepEqual(buildVendorFileMap([{ path: 'SKILL.md', bytes }]).get('SKILL.md'), bytes);
  assert.deepEqual(buildVendorFileMap({ 'SKILL.md': bytes }).get('SKILL.md'), bytes);
  assert.deepEqual(buildVendorFileMap(fixture.files).get('SKILL.md'), bytes);
});
