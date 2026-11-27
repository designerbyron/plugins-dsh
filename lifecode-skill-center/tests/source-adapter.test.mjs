/**
 * K8-B4/B5 · Contrato del Source Adapter sobre fixtures sintéticas originales.
 *
 * Cubre la frontera host-agnostic: referencia fijada, firma, manifiesto, hashes por fichero,
 * allowlist de rutas y repositorio, límites, symlinks, traversal, timeout y errores cerrados.
 * No hay red real, no se importa ni se activa nada y no se lee `vendor-adapters/**`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOURCE_ADAPTER_CONTRACT, createSourceAdapter, hasHumanAuthorization, normalizeSourceCandidate,
  safeRelativePath, sourceAdapterError, validateSourceReference,
} from '../host/source-adapter.mjs';
import {
  createHash,
} from 'node:crypto';

import { verifiedSignatureProof } from './helpers-vendor.mjs';
import { syntheticFetch, syntheticManifest, syntheticReference } from './fixtures/synthetic-source.mjs';

const NOW = '2026-11-26T20:00:00.000Z';
const AUTH = { role: 'human', by: 'maintainer', requestId: 'req-k8b-adapter', at: NOW };

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function rawBase(reference) {
  return `https://raw.githubusercontent.com/${reference.repository.replace('https://github.com/', '')}/${reference.commit}/${reference.tree}`;
}

/** Obtiene bytes de un fetch inyectado; nunca interpreta ni ejecuta el contenido. */
async function acquireBytes({ reference, manifest, fetchImpl }) {
  const manifestResponse = await fetchImpl(`${rawBase(reference)}/${reference.manifestPath}`);
  if (manifestResponse?.ok !== true) return sourceAdapterError('http-invalid', 'manifiesto no disponible');
  const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
  const files = new Map();
  for (const entry of manifest.files) {
    const response = await fetchImpl(`${rawBase(reference)}/${entry.path}`);
    if (response?.ok !== true) return sourceAdapterError('http-invalid', 'fichero no disponible', { path: entry.path });
    files.set(entry.path, Buffer.from(await response.arrayBuffer()));
  }
  return { ok: true, manifestBytes, files, manifest };
}

function makeAdapter(overrides = {}) {
  const reference = overrides.reference ?? syntheticReference();
  const manifest = overrides.manifest ?? syntheticManifest();
  const { fetchImpl, calls } = syntheticFetch({ reference, manifest, ...(overrides.corrupt ? { corrupt: overrides.corrupt } : {}) });
  const adapter = createSourceAdapter({
    reference,
    manifest,
    acquire: overrides.acquire ?? acquireBytes,
    verifyProof: overrides.verifyProof ?? (() => verifiedSignatureProof()),
    ...(overrides.validateProof ? { validateProof: overrides.validateProof } : {}),
    ...(overrides.limits ? { limits: overrides.limits } : {}),
    ...(overrides.allowedRepositories !== undefined ? { allowedRepositories: overrides.allowedRepositories } : {}),
    codePrefix: 'vendor.source.',
    now: NOW,
  });
  return { adapter, reference, manifest, calls, fetchImpl };
}

test('el contrato publica límites y códigos cerrados', () => {
  assert.equal(SOURCE_ADAPTER_CONTRACT.version, '1.0');
  assert.ok(SOURCE_ADAPTER_CONTRACT.limits.maxFetchMs > 0);
  for (const code of ['human-request-required', 'signature-invalid', 'manifest-mismatch', 'symlink-not-allowed', 'fetch-timeout']) {
    assert.ok(SOURCE_ADAPTER_CONTRACT.closedCodes.includes(code));
  }
});

test('las rutas relativas seguras rechazan traversal, unidades, NUL y barras invertidas', () => {
  assert.equal(safeRelativePath('docs/SECURITY.md'), true);
  for (const path of ['', '/abs', 'C:\\secreto', 'a\\b', 'a/../b', '../secreto', './a', 'a//b', `a\0b`]) {
    assert.equal(safeRelativePath(path), false, path);
  }
  assert.equal(safeRelativePath('a'.repeat(SOURCE_ADAPTER_CONTRACT.limits.maxPathLength + 1)), false);
});

test('la autorización sólo cuenta si es humana, completa y fechada', () => {
  assert.equal(hasHumanAuthorization(AUTH), true);
  for (const auth of [
    null,
    { ...AUTH, role: 'ai' },
    { ...AUTH, by: '' },
    { ...AUTH, requestId: '' },
    { ...AUTH, at: 'no-fecha' },
  ]) {
    assert.equal(hasHumanAuthorization(auth), false);
  }
});

test('la referencia fijada exige URL permitida, tag, commit, árbol y hash de manifiesto', () => {
  const reference = syntheticReference();
  assert.equal(validateSourceReference(reference).ok, true);
  const cases = [
    [{ ...reference, repository: 'https://example.com/a/b' }, undefined],
    [{ ...reference, tag: 'main' }, undefined],
    [{ ...reference, commit: 'abc' }, undefined],
    [{ ...reference, tree: '../secreto' }, undefined],
    [reference, ['https://github.com/otro/proyecto']],
    [reference, []],
  ];
  for (const [candidate, allowedRepositories] of cases) {
    const result = validateSourceReference(candidate, { allowedRepositories });
    assert.equal(result.ok, false, JSON.stringify(candidate));
    assert.match(result.code, /reference-invalid|path-invalid/);
  }
});

test('normaliza un candidato sintético válido y devuelve rutas declaradas', () => {
  const reference = syntheticReference();
  const manifest = syntheticManifest();
  const { fetchImpl } = syntheticFetch({ reference, manifest });
  const result = acquireBytes({ reference, manifest, fetchImpl });
  return result.then((acquired) => {
    assert.equal(acquired.ok, true);
    const normalized = normalizeSourceCandidate({ ...acquired, manifest }, { reference, now: NOW });
    assert.equal(normalized.ok, true, JSON.stringify(normalized));
    assert.equal(normalized.candidate.paths.length, 6);
    assert.equal(normalized.candidate.status, 'NOT_ACTIVATED');
  });
});

test('rechaza manifiesto adulterado, tag/commit incorrectos y hash de manifiesto distinto', async () => {
  const reference = syntheticReference();
  const manifest = syntheticManifest();
  const { fetchImpl } = syntheticFetch({ reference, manifest });
  const acquired = await acquireBytes({ reference, manifest, fetchImpl });
  assert.equal(acquired.ok, true);
  const bytes = acquired.manifestBytes;

  assert.equal(normalizeSourceCandidate({ ...acquired, manifest }, { reference, now: NOW }).ok, true);

  const adulterated = Buffer.from(JSON.stringify({ ...manifest, nota: 'cambio' }), 'utf8');
  assert.equal(normalizeSourceCandidate({ ...acquired, manifestBytes: adulterated, manifest }, {
    reference, now: NOW,
  }).code, 'vendor.source.manifest-mismatch');
  assert.equal(normalizeSourceCandidate({ ...acquired, manifest }, {
    reference: { ...reference, tag: 'v9.9.9' }, now: NOW,
  }).code, 'vendor.source.manifest-mismatch');
  assert.equal(normalizeSourceCandidate({ ...acquired, manifest }, {
    reference: { ...reference, commit: 'f'.repeat(40) }, now: NOW,
  }).code, 'vendor.source.manifest-mismatch');
  assert.equal(sha256(bytes), reference.manifestSha256);
});

test('rechaza hash modificado, fichero extra, ausente, symlink, traversal y duplicados', async () => {
  const reference = syntheticReference();
  const manifest = syntheticManifest();
  const { fetchImpl } = syntheticFetch({ reference, manifest });
  const acquired = await acquireBytes({ reference, manifest, fetchImpl });
  assert.equal(acquired.ok, true);
  const base = { reference, now: NOW };

  const changed = new Map(acquired.files);
  const first = manifest.files[0].path;
  const corrupted = Buffer.from(changed.get(first));
  corrupted[0] ^= 0xff;
  changed.set(first, corrupted);
  assert.equal(normalizeSourceCandidate({ ...acquired, files: changed, manifest }, base).code, 'vendor.source.file-mismatch');

  const extra = new Map(acquired.files);
  extra.set('extra.txt', Buffer.from('extra'));
  assert.equal(normalizeSourceCandidate({ ...acquired, files: extra, manifest }, base).code, 'vendor.source.extra-file');

  const missing = new Map(acquired.files);
  missing.delete(first);
  assert.equal(normalizeSourceCandidate({ ...acquired, files: missing, manifest }, base).code, 'vendor.source.file-missing');

  const symlinkManifest = {
    ...manifest,
    files: manifest.files.map((entry, index) => index === 0 ? { ...entry, symlink: true } : entry),
  };
  assert.equal(normalizeSourceCandidate({ ...acquired, manifest: symlinkManifest }, base).code, 'vendor.source.symlink-not-allowed');

  const traversalManifest = {
    ...manifest,
    files: manifest.files.map((entry, index) => index === 0 ? { ...entry, path: '../secreto' } : entry),
  };
  assert.equal(normalizeSourceCandidate({ ...acquired, manifest: traversalManifest }, base).code, 'vendor.source.path-invalid');

  const duplicateManifest = { ...manifest, files: [manifest.files[0], ...manifest.files] };
  assert.equal(normalizeSourceCandidate({ ...acquired, manifest: duplicateManifest }, base).code, 'vendor.source.path-invalid');
});

test('los límites de tamaño y ficheros se aplican antes de aceptar el candidato', async () => {
  const reference = syntheticReference();
  const manifest = syntheticManifest();
  const { fetchImpl } = syntheticFetch({ reference, manifest });
  const acquired = await acquireBytes({ reference, manifest, fetchImpl });
  const small = { ...SOURCE_ADAPTER_CONTRACT.limits, maxFileBytes: 1 };
  assert.equal(normalizeSourceCandidate({ ...acquired, manifest }, { reference, limits: small, now: NOW }).code, 'vendor.source.size-exceeded');
  const few = { ...SOURCE_ADAPTER_CONTRACT.limits, maxFiles: 2 };
  assert.equal(normalizeSourceCandidate({ ...acquired, manifest }, { reference, limits: few, now: NOW }).code, 'vendor.source.size-exceeded');
});

test('sin solicitud humana no se adquiere nada', async () => {
  const { adapter, calls } = makeAdapter();
  const result = await adapter.review({ humanAuthorization: null });
  assert.equal(result.code, 'vendor.source.human-request-required');
  assert.deepEqual(calls, []);
});

test('la firma inválida y la falta de fetch cierran antes de obtener bytes', async () => {
  const badProof = makeAdapter({ verifyProof: () => ({ status: 'unverified' }) });
  const badResult = await badProof.adapter.review({ humanAuthorization: AUTH, fetchImpl: badProof.fetchImpl });
  assert.equal(badResult.code, 'vendor.source.signature-invalid');
  assert.deepEqual(badProof.calls, []);

  const noFetch = makeAdapter();
  const noFetchResult = await noFetch.adapter.review({ humanAuthorization: AUTH, fetchImpl: null });
  assert.equal(noFetchResult.code, 'vendor.source.fetch-unavailable');
  assert.deepEqual(noFetch.calls, []);
});

test('un error HTTP del adaptador se propaga cerrado, sin degradar a candidato válido', async () => {
  const { adapter, fetchImpl } = makeAdapter({
    acquire: async () => sourceAdapterError('http-invalid', 'HTTP 503', { status: 503 }),
  });
  const result = await adapter.review({ humanAuthorization: AUTH, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'vendor.source.http-invalid');
  assert.equal(result.status, 503);
});

test('un acquire que no responde expira con código determinista', async () => {
  const { adapter, fetchImpl } = makeAdapter({
    acquire: () => new Promise(() => {}),
    limits: { ...SOURCE_ADAPTER_CONTRACT.limits, maxFetchMs: 10 },
  });
  const result = await adapter.review({ humanAuthorization: AUTH, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'vendor.source.fetch-timeout');
  assert.match(result.detail, /10 ms/);
});

test('la revisión válida devuelve bytes desactivados y procedencia, sin importar ni asignar', async () => {
  const { adapter, calls, fetchImpl } = makeAdapter();
  const result = await adapter.review({ humanAuthorization: AUTH, fetchImpl });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.files.size, 6);
  assert.equal(result.source.commit, syntheticReference().commit);
  assert.equal(result.humanAuthorization.requestId, AUTH.requestId);
  assert.equal(result.humanAuthorization.role, 'human');
  assert.equal(calls.length, 7);
  assert.equal(result.note.includes('Importación desactivada'), true);
  assert.equal(Object.hasOwn(result, 'imported'), false);
  assert.equal(Object.hasOwn(result, 'assignments'), false);
});
