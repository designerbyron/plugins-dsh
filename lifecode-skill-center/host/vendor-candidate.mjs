/**
 * Metadatos públicos del candidato vendor PINNED y resolvedor seguro desde el upstream fijado.
 *
 * K7-B: este módulo NO contiene los seis ficheros de Context7 ni el script adaptado. Publica sólo
 * identidad, hashes, licencias y procedencia. Los bytes se resuelven desde el tag/commit fijados
 * sólo bajo una solicitud humana explícita, con firma verificada contra la clave fijada y
 * comprobación SHA-256 por fichero y manifiesto. Nunca ejecuta SKILL.md, scripts ni comandos de
 * terceros. La importación queda desactivada hasta la decisión humana en el panel.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  VENDOR_ATTRIBUTION, VENDOR_COMMIT, VENDOR_MANIFEST_SHA256, VENDOR_REPOSITORY, VENDOR_TAG,
} from '../lib/vendor.mjs';
import { verifyPinnedTagSignature } from './vendor-evidence.mjs';
import { createSourceAdapter, sha256Hex, sourceAdapterError } from './source-adapter.mjs';

export const PINNED_MANIFEST = {
  "candidateId": "netresearch-context7@1.7.3+01d2f069127eeeaf0a02efe8e1429e0bddc57669",
  "status": "NOT_ACTIVATED",
  "repository": "https://github.com/netresearch/context7-skill",
  "tag": "v1.7.3",
  "commit": "01d2f069127eeeaf0a02efe8e1429e0bddc57669",
  "preparedAt": "2026-11-26T10:21:40.6894535-06:00",
  "files": [
    {
      "path": "SKILL.md",
      "sha256": "032066c6c00e920d926110ee348f5c8cf3ef9d304939bfd10bb6642d654b5df4",
      "bytes": 3754,
      "license": "CC-BY-SA-4.0",
      "origin": "https://github.com/netresearch/context7-skill",
      "tag": "v1.7.3",
      "commit": "01d2f069127eeeaf0a02efe8e1429e0bddc57669"
    },
    {
      "path": "scripts/context7.sh",
      "sha256": "5ab3fde2c9efc0f8f36208783dcb422936a4ec380a8c4c7d5b2a70e8b320ad76",
      "bytes": 4933,
      "license": "MIT",
      "origin": "https://github.com/netresearch/context7-skill",
      "tag": "v1.7.3",
      "commit": "01d2f069127eeeaf0a02efe8e1429e0bddc57669"
    },
    {
      "path": "LICENSE-MIT",
      "sha256": "1fe06508f104247560f79952cd4fbf79b4295c987e60bf39a6a20fe1c5c3c38c",
      "bytes": 1103,
      "license": "MIT",
      "origin": "https://github.com/netresearch/context7-skill",
      "tag": "v1.7.3",
      "commit": "01d2f069127eeeaf0a02efe8e1429e0bddc57669"
    },
    {
      "path": "LICENSE-CC-BY-SA-4.0",
      "sha256": "744b1d087cf81825a7c8c3b3e2b12c665f26fb5e045e90d627b980d7032119c2",
      "bytes": 861,
      "license": "CC-BY-SA-4.0",
      "origin": "https://github.com/netresearch/context7-skill",
      "tag": "v1.7.3",
      "commit": "01d2f069127eeeaf0a02efe8e1429e0bddc57669"
    },
    {
      "path": "README.md",
      "sha256": "59750e25663efc71e9cd9c28ecec55299b23ccb84496f98cbb6cba17c1aba7ed",
      "bytes": 8188,
      "license": "CC-BY-SA-4.0",
      "origin": "https://github.com/netresearch/context7-skill",
      "tag": "v1.7.3",
      "commit": "01d2f069127eeeaf0a02efe8e1429e0bddc57669"
    },
    {
      "path": "docs/SECURITY-ASSURANCE.md",
      "sha256": "20010c910c8860681dac1ffc515a73432bd010ed6730484f40e01c0489c31ad0",
      "bytes": 8030,
      "license": "CC-BY-SA-4.0",
      "origin": "https://github.com/netresearch/context7-skill",
      "tag": "v1.7.3",
      "commit": "01d2f069127eeeaf0a02efe8e1429e0bddc57669"
    }
  ],
  "verification": {
    "tests": "a6d423747edee162803316abba08865e5ee763361113bf5f88a9ba15c8b3adf1",
    "jq": "a6fc67fedaf9128a3309a1e2ebb8b986aeccf70122ee46d2cb4849e423f0c627",
    "note": "tests/ and tools/ are outside candidate/; jq 1.8.2 portable binary, not installed globally"
  }
};

/** Puntero fijo al upstream; ningún valor depende del entorno ni de la fecha de publicación. */
export const PINNED_UPSTREAM = Object.freeze({
  repository: VENDOR_REPOSITORY,
  tag: VENDOR_TAG,
  commit: VENDOR_COMMIT,
  tree: 'skills/context7',
  manifestPath: 'MANIFEST.json',
  manifestSha256: VENDOR_MANIFEST_SHA256,
});

/** Referencia pblica: hashes, licencias y procedencia, sin contenido redistribuible. */
export const PINNED_REFERENCE = Object.freeze({
  candidateId: PINNED_MANIFEST.candidateId,
  status: PINNED_MANIFEST.status,
  files: Object.freeze(PINNED_MANIFEST.files.map((entry) => Object.freeze({
    path: entry.path,
    sha256: entry.sha256,
    bytes: entry.bytes,
    license: entry.license,
    origin: entry.origin,
    tag: entry.tag,
    commit: entry.commit,
  }))),
  licensePolicy: 'internal-use-only',
  legalReviewRequired: true,
  attribution: VENDOR_ATTRIBUTION,
  redistribution: 'not-authorized',
});

function upstreamBase(repository, reference) {
  if (repository !== reference.repository) {
    throw new Error('repositorio fuera de la referencia fijada');
  }
  return repository.replace('https://github.com/', 'https://raw.githubusercontent.com/');
}

function readStaged(path) {
  // Lectura local del archivo temporal ya verificado; no hay ejecución ni interpretación.
  return readFileSync(path);
}

/**
 * Capa C (demostración de Context7): adquisición del upstream fijado. Sólo obtiene bytes y los
 * staginga en un temporal privado; la autorización humana, la firma, el manifiesto, los hashes y
 * el contrato los comprueba la Capa B (`host/source-adapter.mjs`). Nunca ejecuta contenido.
 */
function pinnedAcquire({ reference, manifest, fetchImpl, tmpRoot }) {
  return async () => {
    const base = `${upstreamBase(reference.repository, reference)}/${reference.commit}/${reference.tree}`;
    const temp = mkdtempSync(join(tmpRoot, 'lsc-upstream-'));
    const files = new Map();
    try {
      const manifestUrl = `${base}/${reference.manifestPath}`;
      const manifestResponse = await fetchImpl(manifestUrl);
      if (!manifestResponse?.ok) {
        return sourceAdapterError('vendor.candidate.manifest-unavailable', 'MANIFEST.json no disponible', { url: manifestUrl, status: manifestResponse?.status });
      }
      const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
      if (sha256Hex(manifestBytes) !== reference.manifestSha256) {
        return sourceAdapterError('vendor.candidate.manifest-mismatch', 'El MANIFEST.json del upstream no coincide con el hash fijado');
      }

      for (const [index, expected] of manifest.files.entries()) {
        const url = `${base}/${expected.path}`;
        const response = await fetchImpl(url);
        if (!response?.ok) {
          return sourceAdapterError('vendor.candidate.file-unavailable', `${expected.path} no disponible`, { path: expected.path, url, status: response?.status });
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (sha256Hex(bytes) !== expected.sha256 || bytes.length !== expected.bytes) {
          return sourceAdapterError('vendor.candidate.file-mismatch', `${expected.path} difiere del hash o tamaño fijado`, { path: expected.path });
        }
        // Escritura efímera y privada. Nunca se ejecuta ni se conserva tras la resolución.
        const staged = join(temp, `${String(index).padStart(2, '0')}-${expected.path.split('/').pop()}`);
        writeFileSync(staged, bytes, { mode: 0o600, flag: 'wx' });
        files.set(expected.path, readStaged(staged));
      }

      return { ok: true, files, manifestBytes, manifest };
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  };
}

/**
 * Resuelve los bytes del candidato desde el upstream fijado. Sin autorización humana no hace red.
 * Los valores por defecto son el caso de demostración PINNED; se pueden inyectar otra referencia y
 * otro manifiesto para ejercer el adaptador genérico con fixtures sintéticas.
 */
export async function resolvePinnedCandidateFromUpstream({
  humanAuthorization = null,
  fetchImpl = globalThis.fetch,
  verifyProof = verifyPinnedTagSignature,
  now = new Date().toISOString(),
  tmpRoot = tmpdir(),
  reference = PINNED_UPSTREAM,
  manifest = PINNED_MANIFEST,
} = {}) {
  const adapter = createSourceAdapter({
    reference,
    manifest,
    acquire: pinnedAcquire({ reference, manifest, fetchImpl, tmpRoot }),
    verifyProof,
    codePrefix: 'vendor.candidate.',
    now,
  });
  return adapter.review({ humanAuthorization, fetchImpl });
}

