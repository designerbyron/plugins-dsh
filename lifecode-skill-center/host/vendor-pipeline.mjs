/**
 * Preparación del candidato vendor en el adaptador del Host (K8-B).
 *
 * Este fichero es host-specific y vive fuera de `lib/**`. No importa ni lee `vendor-adapters/**`:
 * recibe un candidato ya obtenido y validado por un Source Adapter. Sin candidate inyectado el
 * bundle queda bloqueado con un código explícito; nunca hay descarga implícita ni degradación
 * silenciosa. El núcleo (`lib/vendor.mjs`) recibe sólo datos comprobados y no hace red ni lee
 * configuración del usuario. Context7 es únicamente una demostración del adaptador genérico.
 */
import { spawnSync } from 'node:child_process';

import {
  VENDOR_COMMIT, VENDOR_REPOSITORY, VENDOR_SIGNING_FINGERPRINT, VENDOR_SIGNING_KEY,
  VENDOR_SIGNING_PRINCIPAL, VENDOR_TAG, checkRuntimeDependencies, validateSignatureProof,
  vendorCandidateFromManifest, vendorValidationOptions,
} from '../lib/vendor.mjs';
import {
  PINNED_MANIFEST, PINNED_REFERENCE, PINNED_UPSTREAM, resolvePinnedCandidateFromUpstream,
} from './vendor-candidate.mjs';
import { normalizeSourceCandidate } from './source-adapter.mjs';
import { verifyPinnedTagSignature } from './vendor-evidence.mjs';

/** Preflight real, sin instalar nada: los binarios se pueden inyectar con variables de entorno. */
export function measureVendorDependencies({
  curlBin = process.env.LIFECODE_VENDOR_CURL_BIN || process.env.CURL_BIN || 'curl',
  jqBin = process.env.LIFECODE_VENDOR_JQ_BIN || process.env.JQ_BIN || 'jq',
  run = spawnSync,
  platform = process.platform,
} = {}) {
  const result = checkRuntimeDependencies({ curlBin, jqBin, run, platform });
  return {
    ...result,
    curlBin,
    jqBin,
    note: 'Sin instalación automática. Sin cambios en PATH global ni en el perfil real de DSH.',
  };
}

function pinnedIdentity() {
  return {
    repository: VENDOR_REPOSITORY,
    tag: VENDOR_TAG,
    commit: VENDOR_COMMIT,
    principal: VENDOR_SIGNING_PRINCIPAL,
    key: VENDOR_SIGNING_KEY,
    keyFingerprint: VENDOR_SIGNING_FINGERPRINT,
  };
}

function blockedBundle(detail, dependencies, code = 'vendor.candidate.not-packaged') {
  return {
    ok: false,
    blocked: true,
    code,
    detail,
    candidate: null,
    signatureProof: null,
    dependencies,
    hardenedScript: null,
    originalScript: '',
    options: null,
    pinned: pinnedIdentity(),
    reference: PINNED_REFERENCE,
  };
}

/** Normaliza la prueba del adaptador con el validador del núcleo; nunca confía en un `ok` del cliente. */
function checkedProof({ signatureProof, now }) {
  const rawProof = signatureProof ?? verifyPinnedTagSignature({ now, tag: VENDOR_TAG, commit: VENDOR_COMMIT });
  const checked = validateSignatureProof(rawProof, { tag: VENDOR_TAG, commit: VENDOR_COMMIT });
  return checked.ok === true ? checked.proof : null;
}

function assembleBundle({
  files, manifestBytes, hardenedScript, dependencies, proof, now,
  manifest = PINNED_MANIFEST, providedOriginalScript = '',
}) {
  const candidate = vendorCandidateFromManifest(manifest, { files, manifestBytes });
  const originalScript = providedOriginalScript || files.get('scripts/context7.sh')?.toString('utf8') || '';
  return {
    ok: candidate.ok === true && proof !== null,
    candidate,
    signatureProof: proof,
    dependencies,
    hardenedScript,
    originalScript,
    options: candidate.ok === true ? vendorValidationOptions(candidate, {
      files,
      dependencies,
      hardenedScript,
      originalScript,
      signatureProof: proof,
    }) : null,
    pinned: pinnedIdentity(),
    reference: PINNED_REFERENCE,
    preparedAt: now,
  };
}

/**
 * Ensambla el bundle a partir de un candidato ya obtenido por un Source Adapter. Sin `candidate`
 * devuelve un bundle bloqueado: ni el tarball ni la fuente pública redistribuyen bytes de terceros.
 * `reference = null` permite inyectar candidatos sintéticos en las pruebas sin relajar las puertas.
 */
export function pinnedVendorBundle({
  now = new Date().toISOString(), dependencies = null, signatureProof = null,
  jqBin = '', curlBin = '', candidate = null, reference = null, manifest = PINNED_MANIFEST,
} = {}) {
  const resolved = dependencies ?? measureVendorDependencies({
    ...(jqBin !== '' ? { jqBin } : {}),
    ...(curlBin !== '' ? { curlBin } : {}),
  });
  if (candidate === null || candidate?.ok !== true) {
    return blockedBundle(
      'El paquete no redistribuye el candidato residente. Se requiere resolución humana desde una fuente fijada.',
      resolved,
    );
  }
  const sourceManifest = candidate.manifest ?? manifest;
  const normalized = normalizeSourceCandidate({
    manifest: sourceManifest,
    manifestBytes: candidate.manifestBytes,
    files: candidate.files,
    signatureProof: candidate.signatureProof ?? null,
  }, { reference, codePrefix: 'vendor.candidate.', now });
  if (normalized.ok !== true) return blockedBundle(normalized.detail, resolved, normalized.code);

  const bundle = assembleBundle({
    files: normalized.candidate.files,
    manifestBytes: normalized.candidate.manifestBytes,
    hardenedScript: candidate.hardenedScript ?? null,
    dependencies: resolved,
    proof: checkedProof({
      signatureProof: signatureProof ?? candidate.signatureProof,
      now,
    }),
    now,
    manifest: sourceManifest,
    providedOriginalScript: candidate.originalScript ?? candidate.hardenedScript ?? '',
  });
  // Costura de prueba explícita: sólo de prueba, el candidato sintético declara el hash fijado que
  // simula la decisión humana. Producción no lo setea y la puerta de la API sigue comparando
  // contra VENDOR_MANIFEST_SHA256 sin cambios.
  if (/^[a-f0-9]{64}$/.test(candidate.expectedManifestSha256 ?? '')) {
    bundle.candidate = { ...bundle.candidate, manifestSha256: candidate.expectedManifestSha256 };
  }
  return bundle;
}

/**
 * Resolución segura bajo solicitud humana. No lee material local: obtiene los bytes del upstream
 * fijado a través del adaptador, comprueba firma y hashes y exige que la persona aporte el script
 * endurecido revisado. Nunca ejecuta contenido de terceros y deja la importación desactivada.
 */
export async function resolveVendorBundleFromUpstream({
  humanAuthorization = null,
  hardenedScript = null,
  fetchImpl,
  verifyProof,
  now = new Date().toISOString(),
  dependencies = null,
  reference = PINNED_UPSTREAM,
  manifest = PINNED_MANIFEST,
} = {}) {
  const resolvedDependencies = dependencies ?? measureVendorDependencies();
  const candidateResolution = await resolvePinnedCandidateFromUpstream({
    humanAuthorization,
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    ...(verifyProof !== undefined ? { verifyProof } : {}),
    now,
    reference,
    manifest,
  });
  if (candidateResolution.ok !== true) {
    return { ...candidateResolution, dependencies: resolvedDependencies, reference: PINNED_REFERENCE };
  }
  const scriptReady = (Buffer.isBuffer(hardenedScript) || typeof hardenedScript === 'string')
    && hardenedScript.length > 0;
  if (!scriptReady) {
    return blockedBundle(
      'Se requiere el script endurecido revisado por una persona; el paquete no lo redistribuye.',
      resolvedDependencies,
      'vendor.candidate.hardened-script-required',
    );
  }
  return pinnedVendorBundle({
    now,
    dependencies: resolvedDependencies,
    reference,
    manifest,
    candidate: {
      ok: true,
      manifest,
      manifestBytes: candidateResolution.manifestBytes,
      files: candidateResolution.files,
      signatureProof: candidateResolution.signatureProof,
      hardenedScript,
      originalScript: hardenedScript,
    },
  });
}

export const VENDOR_BUNDLE_SOURCES = Object.freeze({
  sourceAdapter: 'host/source-adapter.mjs (contrato genérico, sin bytes de proveedor)',
  context7Demo: 'host/vendor-candidate.mjs (metadatos PINNED, sin payload)',
  upstream: PINNED_UPSTREAM,
});
