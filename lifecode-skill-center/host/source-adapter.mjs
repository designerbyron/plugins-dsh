/**
 * K8-B · Capa B: Source Adapter Interface.
 *
 * Contrato genérico de adquisición de Skills externas. Vive en `host/**` (integración del Host),
 * fuera de `lib/**`, y no conoce a ningún proveedor: recibe una referencia fijada y una función
 * `acquire` inyectada. No redistribuye bytes, no ejecuta contenido, no hace red por sí mismo y
 * nunca importa ni asigna nada. Toda salida es cerrada: error + código determinista.
 *
 * El Vendor Engine (`lib/vendor.mjs`) sigue recibiendo un candidato ya obtenido y validado; este
 * módulo sólo formaliza la frontera entre «adquisición» y «validación».
 */
import { createHash } from 'node:crypto';

import { validateSignatureProof } from '../lib/vendor.mjs';

export const SOURCE_ADAPTER_CONTRACT = Object.freeze({
  version: '1.0',
  candidateFields: Object.freeze(['manifest', 'manifestBytes', 'files']),
  resultFields: Object.freeze(['ok', 'files', 'manifestBytes', 'signatureProof', 'source', 'humanAuthorization', 'resolvedAt']),
  limits: Object.freeze({
    maxFiles: 32,
    maxFileBytes: 2 * 1024 * 1024,
    maxTotalBytes: 8 * 1024 * 1024,
    maxPathLength: 512,
    maxUrlLength: 2048,
    maxFetchMs: 20000,
  }),
  closedCodes: Object.freeze([
    'human-request-required', 'reference-invalid', 'signature-invalid', 'fetch-unavailable',
    'fetch-timeout', 'http-invalid', 'candidate-invalid', 'manifest-mismatch', 'path-invalid',
    'symlink-not-allowed', 'file-missing', 'extra-file', 'file-mismatch', 'size-exceeded',
  ]),
});

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sourceAdapterError(code, detail, extra = {}) {
  return { ok: false, blocked: true, code, detail, ...extra };
}

function prefixed(codePrefix, code) {
  return `${codePrefix}${code}`;
}

/** Una solicitud de revisión sólo es humana si trae role/by/requestId/at verificables. */
export function hasHumanAuthorization(auth) {
  return Boolean(auth && typeof auth === 'object' && auth.role === 'human'
    && typeof auth.by === 'string' && auth.by.trim() !== ''
    && typeof auth.requestId === 'string' && auth.requestId.trim() !== ''
    && typeof auth.at === 'string' && !Number.isNaN(Date.parse(auth.at)));
}

/** Ruta relativa, sin unidades, sin barras invertidas y sin segmentos `.` o `..`. */
export function safeRelativePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= SOURCE_ADAPTER_CONTRACT.limits.maxPathLength
    && !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && !path.includes('\\')
    && !path.includes('\0')
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Valida la referencia fijada: URL de la allowlist, tag, commit exacto, árbol y hash del manifiesto. */
export function validateSourceReference(reference, {
  codePrefix = 'vendor.source.', now = undefined, allowedRepositories = undefined,
} = {}) {
  const fail = (code, detail) => sourceAdapterError(prefixed(codePrefix, code), detail, { ...(now === undefined ? {} : { at: now }) });
  if (!reference || typeof reference !== 'object') return fail('reference-invalid', 'La referencia de origen no es un objeto');
  const { repository, tag, commit, tree, manifestPath, manifestSha256 } = reference;
  if (typeof repository !== 'string'
    || !/^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository)
    || repository.length > SOURCE_ADAPTER_CONTRACT.limits.maxUrlLength) {
    return fail('reference-invalid', 'El repositorio no está en la allowlist https://github.com/…');
  }
  if (allowedRepositories !== undefined) {
    if (!Array.isArray(allowedRepositories) || allowedRepositories.length === 0
      || !allowedRepositories.every((url) => typeof url === 'string')
      || !allowedRepositories.includes(repository)) {
      return fail('reference-invalid', 'El repositorio no está en la allowlist exacta inyectada');
    }
  }
  if (typeof tag !== 'string' || !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
    return fail('reference-invalid', 'El tag no es una referencia exacta admitida');
  }
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)) {
    return fail('reference-invalid', 'El commit no es un SHA-1 completo en minúsculas');
  }
  if (!safeRelativePath(tree) || !safeRelativePath(manifestPath)) {
    return fail('path-invalid', 'El árbol o la ruta del manifiesto no son seguros');
  }
  if (typeof manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifestSha256)) {
    return fail('reference-invalid', 'El hash fijado del manifiesto no es SHA-256');
  }
  return { ok: true, reference, code: 'SOURCE-REF' };
}

/**
 * Normaliza un candidato ya adquirido. Comprueba estructura, allowlist de rutas, ausencia de
 * symlinks, límites de tamaño/tiempo implícitos en el contrato, SHA-256 por fichero y hash del
 * manifiesto. Nunca interpreta ni ejecuta el contenido.
 */
export function normalizeSourceCandidate({
  manifest = null, manifestBytes = null, files = null, signatureProof = null,
}, {
  reference = null, codePrefix = 'vendor.source.', allowedRepositories = undefined,
  limits = SOURCE_ADAPTER_CONTRACT.limits, now = undefined,
} = {}) {
  const fail = (code, detail, extra = {}) => sourceAdapterError(prefixed(codePrefix, code), detail, { ...extra, ...(now === undefined ? {} : { at: now }) });
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    return fail('candidate-invalid', 'El manifiesto del candidato no es válido');
  }
  if (manifest.status !== 'NOT_ACTIVATED') {
    return fail('candidate-invalid', 'El candidato debe llegar desactivado');
  }
  if (!(files instanceof Map)) {
    return fail('candidate-invalid', 'Los ficheros del candidato deben venir en un Map');
  }
  if (!Buffer.isBuffer(manifestBytes) && !(manifestBytes instanceof Uint8Array)) {
    return fail('candidate-invalid', 'Los bytes del manifiesto no están disponibles');
  }
  if (manifest.files.length > limits.maxFiles || files.size > limits.maxFiles) {
    return fail('size-exceeded', 'El número de ficheros supera el límite del contrato');
  }

  if (reference !== null) {
    const checked = validateSourceReference(reference, { codePrefix, now, allowedRepositories });
    if (checked.ok !== true) return checked;
    if (manifest.repository !== reference.repository || manifest.tag !== reference.tag
      || manifest.commit !== reference.commit) {
      return fail('manifest-mismatch', 'El manifiesto no coincide con la referencia fijada');
    }
    if (sha256Hex(manifestBytes) !== reference.manifestSha256) {
      return fail('manifest-mismatch', 'El manifiesto no coincide con el hash fijado');
    }
  }

  const expected = new Map();
  const seenPaths = new Set();
  let total = 0;
  for (const entry of manifest.files) {
    if (!entry || !safeRelativePath(entry.path)) return fail('path-invalid', 'Ruta de candidato no admitida');
    if (seenPaths.has(entry.path)) return fail('path-invalid', 'El manifiesto declara la misma ruta dos veces', { path: entry.path });
    seenPaths.add(entry.path);
    if (entry.symlink === true || entry.type === 'symlink' || entry.kind === 'symlink') {
      return fail('symlink-not-allowed', 'Los symlinks no se admiten en un candidato', { path: entry.path });
    }
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      return fail('candidate-invalid', 'Entrada de manifiesto incompleta', { path: entry.path });
    }
    expected.set(entry.path, entry);
  }
  for (const path of files.keys()) {
    if (!expected.has(path)) return fail('extra-file', 'Fichero adicional no declarado', { path });
  }
  for (const [path, entry] of expected) {
    if (!files.has(path)) return fail('file-missing', 'Falta un fichero declarado', { path });
    const bytes = files.get(path);
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
      return fail('candidate-invalid', 'El fichero no son bytes', { path });
    }
    if (bytes.length !== entry.bytes || bytes.length > limits.maxFileBytes) {
      return fail('size-exceeded', 'El tamaño del fichero no coincide o excede el límite', { path });
    }
    total += bytes.length;
    if (total > limits.maxTotalBytes) return fail('size-exceeded', 'El tamaño total excede el límite');
    if (sha256Hex(bytes) !== entry.sha256) {
      return fail('file-mismatch', 'El hash del fichero no coincide', { path });
    }
  }

  return {
    ok: true,
    candidate: {
      manifest,
      manifestBytes,
      files,
      signatureProof,
      paths: [...expected.keys()],
      status: 'NOT_ACTIVATED',
    },
    code: 'SOURCE-CANDIDATE-OK',
  };
}

/** Carrera con límite de tiempo: si expira, devuelve un resultado cerrado y no espera a la red. */
function withDeadline(execute, ms, onTimeout) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve(onTimeout());
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __sourceAdapterDeadline: true, ...onTimeout() }), ms);
  });
  return Promise.race([
    Promise.resolve().then(execute),
    timeout,
  ]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

/**
 * Fábrica del adaptador. `acquire` es la única pieza que puede obtener bytes; se inyecta y puede
 * ser el resolvedor PINNED de Context7 o cualquier otro proveedor. La revisión exige persona,
 * verifica la firma con la prueba inyectada y devuelve el candidato normalizado, desactivado.
 */
export function createSourceAdapter({
  reference,
  manifest,
  acquire,
  verifyProof = null,
  validateProof = validateSignatureProof,
  codePrefix = 'vendor.source.',
  now = new Date().toISOString(),
  limits = SOURCE_ADAPTER_CONTRACT.limits,
  allowedRepositories = undefined,
} = {}) {
  const fail = (code, detail, extra = {}) => sourceAdapterError(prefixed(codePrefix, code), detail, { ...extra, at: now });
  const allowlist = allowedRepositories ?? (reference?.repository ? [reference.repository] : undefined);
  const maxFetchMs = Number.isFinite(limits?.maxFetchMs)
    ? limits.maxFetchMs
    : SOURCE_ADAPTER_CONTRACT.limits.maxFetchMs;

  return Object.freeze({
    contract: SOURCE_ADAPTER_CONTRACT,
    describe: () => ({
      repository: reference?.repository ?? '',
      tag: reference?.tag ?? '',
      commit: reference?.commit ?? '',
      tree: reference?.tree ?? '',
      manifestSha256: reference?.manifestSha256 ?? '',
      codePrefix,
    }),
    async review({ humanAuthorization = null, fetchImpl = globalThis.fetch } = {}) {
      if (!hasHumanAuthorization(humanAuthorization)) {
        return fail('human-request-required', 'Sin solicitud humana explícita (role/by/requestId/at) no se adquiere ni se importa nada');
      }
      const checkedReference = validateSourceReference(reference, { codePrefix, now, allowedRepositories: allowlist });
      if (checkedReference.ok !== true) return checkedReference;
      if (typeof acquire !== 'function') return fail('fetch-unavailable', 'No hay adaptador de adquisición inyectado');
      if (typeof verifyProof !== 'function') return fail('signature-invalid', 'No hay verificador de firma inyectado');

      const rawProof = verifyProof({ now, tag: reference.tag, commit: reference.commit });
      const checkedProof = validateProof(rawProof, { tag: reference.tag, commit: reference.commit });
      if (checkedProof.ok !== true) {
        return fail('signature-invalid', 'La firma de la referencia fijada no verificó', { proof: checkedProof });
      }
      if (typeof fetchImpl !== 'function') return fail('fetch-unavailable', 'No hay implementación de fetch inyectada');

      const acquired = await withDeadline(
        () => acquire({ reference, manifest, fetchImpl, now, limits }),
        maxFetchMs,
        () => fail('fetch-timeout', `La adquisición superó el límite de ${maxFetchMs} ms`),
      );
      if (acquired?.__sourceAdapterDeadline === true) {
        const { __sourceAdapterDeadline, ...closed } = acquired;
        return closed;
      }
      if (acquired?.ok !== true) {
        if (typeof acquired?.code === 'string' && acquired.code.startsWith(codePrefix)) return acquired;
        return {
          ...acquired,
          code: prefixed(codePrefix, typeof acquired?.code === 'string' && acquired.code !== '' ? acquired.code : 'acquire-failed'),
        };
      }
      const normalized = normalizeSourceCandidate({
        ...acquired,
        manifest: acquired.manifest ?? manifest,
      }, { reference, codePrefix, limits, now });
      if (normalized.ok !== true) return normalized;

      return {
        ok: true,
        files: normalized.candidate.files,
        manifestBytes: normalized.candidate.manifestBytes,
        signatureProof: checkedProof.proof,
        source: {
          repository: reference.repository,
          tag: reference.tag,
          commit: reference.commit,
          tree: reference.tree,
          manifestSha256: reference.manifestSha256,
        },
        humanAuthorization: {
          by: humanAuthorization.by,
          requestId: humanAuthorization.requestId,
          at: humanAuthorization.at,
          role: 'human',
        },
        resolvedAt: now,
        note: 'Bytes verificados, no ejecutados. Importación desactivada hasta decisión humana en el panel.',
      };
    },
  });
}
