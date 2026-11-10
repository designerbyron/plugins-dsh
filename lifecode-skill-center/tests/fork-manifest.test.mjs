import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  forkProjectManifest,
  manifestBytes,
  newManifest,
  readManifest,
} from '../lib/manifest-ops.mjs';

const SOURCE = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607';
const TARGET = '9c8b7a65-4321-4fed-8cba-0987654321fe';
const NOW = '2026-11-09T03:59:11.645Z';

/** Workspace con `.dsh` y, opcionalmente, un manifiesto válido ya publicado. */
function workspace(withManifest = SOURCE) {
  const cwd = mkdtempSync(join(tmpdir(), 'fork-ws-'));
  const dshRoot = join(cwd, '.dsh');
  mkdirSync(dshRoot, { recursive: true });
  const manifestPath = join(dshRoot, 'lifecode-skill-center.json');
  if (withManifest !== null) {
    writeFileSync(manifestPath, manifestBytes(newManifest({ projectId: withManifest, registeredAt: NOW })), 'utf8');
  }
  return { dshRoot, manifestPath };
}

test('un fork publica manifiesto nuevo, archiva el original y deja intención y marcador', () => {
  const ws = workspace();
  const original = readManifest(ws.manifestPath);
  const result = forkProjectManifest({
    dshRoot: ws.dshRoot,
    manifestPath: ws.manifestPath,
    manifest: newManifest({ projectId: TARGET, registeredAt: NOW }),
    now: NOW,
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.resumed, false);

  const current = readManifest(ws.manifestPath);
  assert.equal(current.manifest.projectId, TARGET);

  assert.ok(result.archivedFile, 'hay archivo');
  const archived = readManifest(join(ws.dshRoot, result.archivedFile));
  assert.equal(archived.sha256, original.sha256, 'el archivo conserva el original byte a byte');
  assert.equal(archived.manifest.projectId, SOURCE);
  assert.equal(result.archivedSha256, original.sha256);

  const files = readdirSync(ws.dshRoot);
  assert.ok(files.includes('lifecode-skill-center.fork-intent.json'));
  assert.ok(files.includes('lifecode-skill-center.fork-published.json'));
  const marker = JSON.parse(readFileSync(join(ws.dshRoot, 'lifecode-skill-center.fork-published.json'), 'utf8'));
  assert.equal(marker.newUuid, TARGET);
  assert.equal(marker.manifestSha256, current.sha256);
});

test('repetir el fork del mismo contenido reanuda sin publicar otra vez', () => {
  const ws = workspace();
  const first = forkProjectManifest({ dshRoot: ws.dshRoot, manifestPath: ws.manifestPath, manifest: newManifest({ projectId: TARGET, registeredAt: NOW }), now: NOW });
  assert.equal(first.ok, true, first.message);
  const archives = readdirSync(ws.dshRoot).filter((name) => name.includes('lifecode-skill-center.manifest-'));

  const second = forkProjectManifest({ dshRoot: ws.dshRoot, manifestPath: ws.manifestPath, manifest: newManifest({ projectId: TARGET, registeredAt: NOW }), now: NOW });
  assert.equal(second.ok, true, second.message);
  assert.equal(second.resumed, true);
  assert.deepEqual(readdirSync(ws.dshRoot).filter((name) => name.includes('lifecode-skill-center.manifest-')), archives);
});

test('un fork sobre el mismo UUID se rechaza sin tocar el manifiesto', () => {
  const ws = workspace();
  const before = readFileSync(ws.manifestPath, 'utf8');
  const result = forkProjectManifest({ dshRoot: ws.dshRoot, manifestPath: ws.manifestPath, manifest: newManifest({ projectId: SOURCE, registeredAt: NOW }), now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'fork-same-identity');
  assert.equal(readFileSync(ws.manifestPath, 'utf8'), before);
});

test('sin manifiesto de origen el fork se rechaza y no crea evidencia', () => {
  const ws = workspace(null);
  const result = forkProjectManifest({ dshRoot: ws.dshRoot, manifestPath: ws.manifestPath, manifest: newManifest({ projectId: TARGET, registeredAt: NOW }), now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'fork-source-missing');
  assert.deepEqual(readdirSync(ws.dshRoot), []);
});

test('una interrupción tras archivar se reanuda en la siguiente pasada', () => {
  const ws = workspace();
  const original = readManifest(ws.manifestPath);
  let interrupted = null;
  assert.throws(
    () =>
      forkProjectManifest({
        dshRoot: ws.dshRoot,
        manifestPath: ws.manifestPath,
        manifest: newManifest({ projectId: TARGET, registeredAt: NOW }),
        now: NOW,
        hooks: {
          afterArchive: () => {
            interrupted = 'boom';
            throw new Error('interrupción simulada');
          },
        },
      }),
    /interrupción simulada/,
  );
  assert.equal(interrupted, 'boom');
  // La pasada interrumpida deja intención + archivo; el manifiesto canónico puede seguir ahí.
  const archives = readdirSync(ws.dshRoot).filter((name) => name.includes('lifecode-skill-center.manifest-'));
  assert.equal(archives.length, 1);
  assert.equal(readManifest(join(ws.dshRoot, archives[0])).sha256, original.sha256);

  const second = forkProjectManifest({ dshRoot: ws.dshRoot, manifestPath: ws.manifestPath, manifest: newManifest({ projectId: TARGET, registeredAt: NOW }), now: NOW });
  assert.equal(second.ok, true, second.message);
  assert.equal(readManifest(ws.manifestPath).manifest.projectId, TARGET);
  assert.equal(readdirSync(ws.dshRoot).filter((name) => name.includes('lifecode-skill-center.manifest-')).length, 1, 'no duplica el archivo');
});
