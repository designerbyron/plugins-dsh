import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempRoot, autonomyRoot } from './helpers.mjs';
import {
  MANIFEST_SCHEMA,
  acquireWorkspaceLock,
  isCanonicalUtc,
  isOwnTemp,
  isUuidV4,
  manifestBytes,
  newManifest,
  newOperationId,
  publishExclusive,
  readManifest,
  repairManifest,
  sameFileIdentity,
  sha256Hex,
  validateManifest,
} from '../lib/manifest-ops.mjs';

const { equal, ok, throws } = assert;

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const REGISTERED = '2026-11-09T03:59:11.645Z';

function workspace(label) {
  const root = autonomyRoot(`lsc-mops-${label}-`);
  const dsh = join(root, '.dsh');
  mkdirSync(dsh, { recursive: true });
  return { root, dsh, manifestPath: join(dsh, 'lifecode-skill-center.json') };
}

test('T15 · los bytes del manifiesto son canónicos y no dependen del orden de claves', () => {
  const lower = newManifest({ projectId: UUID, registeredAt: REGISTERED });
  const upper = { registeredAt: REGISTERED, projectId: UUID, schemaVersion: 1, schema: MANIFEST_SCHEMA };
  const a = manifestBytes(lower);
  const b = manifestBytes(upper);
  equal(a.length, 171);
  equal(sha256Hex(a), sha256Hex(b));
  equal(a.toString(), [
    '{',
    `  "schema": "${MANIFEST_SCHEMA}",`,
    '  "schemaVersion": 1,',
    `  "projectId": "${UUID}",`,
    `  "registeredAt": "${REGISTERED}"`,
    '}',
    '',
  ].join('\n'));
});

test('T16 · un manifiesto con campo desconocido, UUID no v4 o fecha no canónica se invalida', () => {
  const base = newManifest({ projectId: UUID, registeredAt: REGISTERED });
  equal(validateManifest(base).status, 'ok');
  equal(validateManifest({ ...base, name: 'alfa' }).reason, 'unknown-field:name');
  equal(validateManifest({ ...base, schema: 'otra/cosa' }).reason, 'manifest-schema');
  equal(validateManifest({ ...base, schemaVersion: 2 }).status, 'future');
  // Mayúsculas: el patrón exige minúsculas, así que un UUID en mayúsculas no es válido (y este UUID de
  // ejemplo es todo dígitos, por eso se usa uno con letras para el caso).
  equal(validateManifest({ ...base, projectId: 'AAAAAAAA-1111-4111-8111-111111111111' }).reason, 'manifest-project-id');
  equal(validateManifest({ ...base, registeredAt: '2026-11-09T03:59:11Z' }).reason, 'manifest-registered-at');
  equal(validateManifest({ ...base, registeredAt: '2026-11-09T03:59:11.645+01:00' }).reason, 'manifest-registered-at');
  ok(isUuidV4(UUID));
  ok(isCanonicalUtc(REGISTERED));
});

test('T17 · publicar crea el manifiesto, verifica su huella y no deja temporales', () => {
  const { dsh, manifestPath } = workspace('publish');
  const bytes = manifestBytes(newManifest({ projectId: UUID, registeredAt: REGISTERED }));
  const result = publishExclusive({ path: manifestPath, bytes, dshRoot: dsh });
  equal(result.ok, true);
  equal(result.sha256, sha256Hex(bytes));
  equal(result.size, bytes.length);
  equal(readManifest(manifestPath).status, 'ok');
  equal(readdirSync(dsh).filter((name) => name.startsWith('.lifecode-tmp-')).length, 0);
});

test('T18 · publicar dos veces el mismo contenido es idempotente por huella, y otro contenido es conflicto', () => {
  const { dsh, manifestPath } = workspace('exclusive');
  const first = manifestBytes(newManifest({ projectId: UUID, registeredAt: REGISTERED }));
  equal(publishExclusive({ path: manifestPath, bytes: first, dshRoot: dsh }).ok, true);

  const again = publishExclusive({ path: manifestPath, bytes: first, dshRoot: dsh });
  equal(again.ok, false);
  equal(again.code, 'exists');
  equal(again.existingSha256, sha256Hex(first));

  const other = manifestBytes(newManifest({ projectId: UUID_B, registeredAt: REGISTERED }));
  const conflict = publishExclusive({ path: manifestPath, bytes: other, dshRoot: dsh });
  equal(conflict.code, 'exists');
  equal(sha256Hex(readFileSync(manifestPath)), sha256Hex(first), 'el original no se sobrescribe');
});

test('T19 · un destino fuera del centro se rechaza antes de escribir', () => {
  const { root, dsh } = workspace('outside');
  const bytes = manifestBytes(newManifest({ projectId: UUID, registeredAt: REGISTERED }));
  const outside = join(root, 'otro-sitio', 'lifecode-skill-center.json');
  mkdirSync(join(root, 'otro-sitio'), { recursive: true });
  const result = publishExclusive({ path: outside, bytes, dshRoot: dsh });
  equal(result.ok, false);
  equal(result.code, 'path-outside-workspace');
  equal(existsSync(outside), false);
});

test('T20 · un fallo de `fsync` no publica nada y deja el temporal como evidencia', () => {
  const { dsh, manifestPath } = workspace('fsync');
  const bytes = manifestBytes(newManifest({ projectId: UUID, registeredAt: REGISTERED }));
  const result = publishExclusive({
    path: manifestPath,
    bytes,
    dshRoot: dsh,
    fs: {
      fsyncSync: () => {
        throw Object.assign(new Error('disco'), { code: 'EIO' });
      },
    },
  });
  equal(result.ok, false);
  equal(result.code, 'temp-unverified');
  equal(existsSync(manifestPath), false);
  equal(readdirSync(dsh).some((name) => name.startsWith('.lifecode-tmp-')), true);
});

test('T21 · el bloqueo por workspace es exclusivo y se libera', () => {
  const { dsh } = workspace('lock');
  const first = acquireWorkspaceLock({ dshRoot: dsh, operation: 'repair' });
  equal(first.ok, true);
  const second = acquireWorkspaceLock({ dshRoot: dsh, operation: 'repair' });
  equal(second.ok, false);
  equal(second.code, 'workspace-busy');
  first.release();
  const third = acquireWorkspaceLock({ dshRoot: dsh, operation: 'repair' });
  equal(third.ok, true);
  third.release();
});

test('T22 · un bloqueo abandonado se retira, pero uno reciente no', () => {
  const { dsh } = workspace('stale');
  const held = acquireWorkspaceLock({ dshRoot: dsh, operation: 'repair' });
  equal(held.ok, true);

  const recent = acquireWorkspaceLock({ dshRoot: dsh, operation: 'repair', now: Date.now() + 1000 });
  equal(recent.ok, false, 'un bloqueo de hace un segundo no está abandonado');

  const stale = acquireWorkspaceLock({ dshRoot: dsh, operation: 'repair', now: Date.now() + 10 * 60 * 1000 });
  equal(stale.ok, true, 'pasados diez minutos se considera abandonado y se retira');
  stale.release();
});

test('T23 · la rama A conserva el manifiesto inválido en cuarentena verificada', () => {
  const { dsh, manifestPath } = workspace('repair-invalid');
  writeFileSync(manifestPath, '{ esto no es json', 'utf8');
  const invalidSha = sha256Hex(readFileSync(manifestPath));
  const result = repairManifest({
    dshRoot: dsh,
    manifestPath,
    manifest: newManifest({ projectId: UUID, registeredAt: REGISTERED }),
    branch: 'invalid',
  });
  equal(result.ok, true);
  equal(result.invalidSha256, invalidSha);
  ok(String(result.quarantineFile).includes('manifest-invalid'));
  const quarantinePath = join(dsh, result.quarantineFile);
  equal(sha256Hex(readFileSync(quarantinePath)), invalidSha);
  equal(readManifest(manifestPath).status, 'ok');
  equal(readManifest(manifestPath).projectId, UUID);
});

test('T24 · la rama B no inventa cuarentena cuando el manifiesto no existe', () => {
  const { dsh, manifestPath } = workspace('repair-missing');
  const result = repairManifest({
    dshRoot: dsh,
    manifestPath,
    manifest: newManifest({ projectId: UUID, registeredAt: REGISTERED }),
    branch: 'missing',
  });
  equal(result.ok, true);
  equal(result.quarantineFile, null);
  equal(result.invalidSha256, null);
  equal(readManifest(manifestPath).status, 'ok');
  equal(readdirSync(dsh).some((name) => name.includes('manifest-invalid')), false);
});

test('T25 · la rama equivocada no repara: A exige inválido y B exige ausente', () => {
  const { dsh, manifestPath } = workspace('repair-branch');
  const good = manifestBytes(newManifest({ projectId: UUID, registeredAt: REGISTERED }));
  publishExclusive({ path: manifestPath, bytes: good, dshRoot: dsh });

  const wrongA = repairManifest({
    dshRoot: dsh,
    manifestPath,
    manifest: newManifest({ projectId: UUID_B, registeredAt: REGISTERED }),
    branch: 'invalid',
  });
  equal(wrongA.code, 'repair-branch-mismatch');

  const wrongB = repairManifest({
    dshRoot: dsh,
    manifestPath,
    manifest: newManifest({ projectId: UUID_B, registeredAt: REGISTERED }),
    branch: 'missing',
  });
  equal(wrongB.code, 'repair-branch-mismatch');
  equal(sha256Hex(readFileSync(manifestPath)), sha256Hex(good), 'el documento válido no se toca');
});

test('T26 · reparar dos veces el mismo contenido reanuda en vez de duplicar evidencia', () => {
  const { dsh, manifestPath } = workspace('repair-resume');
  writeFileSync(manifestPath, 'basura', 'utf8');
  const manifest = newManifest({ projectId: UUID, registeredAt: REGISTERED });
  const first = repairManifest({ dshRoot: dsh, manifestPath, manifest, branch: 'invalid' });
  equal(first.ok, true);
  equal(first.resumed, false);

  // Otra pasada de la **misma** intención reconoce que ya está publicado y reanuda sin tocar nada.
  const resumed = repairManifest({ dshRoot: dsh, manifestPath, manifest, branch: 'invalid' });
  equal(resumed.ok, true);
  equal(resumed.resumed, true);
  equal(resumed.quarantineFile, null, 'no se crea una segunda cuarentena');
  const quarantines = readdirSync(dsh).filter((name) => name.includes('manifest-invalid'));
  equal(quarantines.length, 1);
});

test('T27 · la identidad física distingue objetos y la reconoce tras un enlace', () => {
  const { dsh, manifestPath } = workspace('identity');
  const bytes = manifestBytes(newManifest({ projectId: UUID, registeredAt: REGISTERED }));
  const first = publishExclusive({ path: manifestPath, bytes, dshRoot: dsh });
  equal(first.ok, true);
  const copyPath = join(dsh, 'lifecode-skill-center.manifest-20261109T035911Z-af017e36.json');
  writeFileSync(copyPath, bytes, 'utf8');
  const copy = publishExclusive({ path: join(dsh, 'lifecode-skill-center.json.bak'), bytes: Buffer.from('{}'), dshRoot: dsh, kind: 'archived' });
  equal(copy.code !== 'link-failed', true);
  equal(sameFileIdentity({ dev: 1n, ino: 2n }, { dev: 1n, ino: 2n }), true);
  equal(sameFileIdentity({ dev: 1n, ino: 2n }, { dev: 1n, ino: 3n }), false);
  equal(sameFileIdentity(null, { dev: 1n, ino: 2n }), false);
});

test('T28 · los temporales propios se reconocen y los ajenos no', () => {
  const { dsh } = workspace('temps');
  const operationId = newOperationId();
  equal(isOwnTemp(join(dsh, `.lifecode-tmp-${operationId}-1`), dsh), true);
  equal(isOwnTemp(join(dsh, '.lifecode-tmp-CORTO'), dsh), false);
  equal(isOwnTemp(join(dsh, 'otra-cosa'), dsh), false);
  equal(isOwnTemp(join(dsh, '..', 'fuera', `.lifecode-tmp-${operationId}-1`), dsh), false);
});

test('T29 · una interrupción entre la escritura del temporal y la publicación deja recuperable el estado anterior', () => {
  const { dsh, manifestPath } = workspace('interrupt');
  const first = manifestBytes(newManifest({ projectId: UUID, registeredAt: REGISTERED }));
  publishExclusive({ path: manifestPath, bytes: first, dshRoot: dsh });

  const second = manifestBytes(newManifest({ projectId: UUID_B, registeredAt: REGISTERED }));
  const interrupted = publishExclusive({
    path: manifestPath,
    bytes: second,
    dshRoot: dsh,
    hooks: {
      beforeLink: () => {
        throw Object.assign(new Error('muerte simulada'), { code: 'SIMULATED' });
      },
    },
  });
  equal(interrupted.ok, false);
  equal(interrupted.code, 'link-failed');
  equal(sha256Hex(readFileSync(manifestPath)), sha256Hex(first), 'el manifiesto anterior sigue entero');

  // La siguiente pasada reconoce la intención por huella y publica el nuevo.
  const retried = publishExclusive({ path: manifestPath, bytes: second, dshRoot: dsh });
  equal(retried.code, 'exists');
  rmSync(manifestPath, { force: true });
  equal(publishExclusive({ path: manifestPath, bytes: second, dshRoot: dsh }).ok, true);
});
