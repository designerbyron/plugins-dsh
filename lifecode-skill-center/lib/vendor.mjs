/**
 * Vendor Importer de LifeCode Skill Center (Fase E, estrategia C).
 *
 * Este módulo es **propio**: no importa Skill-Compiler ni el harness. Reutiliza los contratos que
 * se aprendieron de aquel motor —procedencia con SHA por fichero, HTTPS allowlist, límites, escaneo
 * antes de escribir, snapshot, archivado e idempotencia por `operationId`— pero corrige sus tres
 * limitaciones conocidas: licencias por fichero, inclusión de `scripts/` y preservación P-8.
 *
 * Todo lo que hay aquí es puro respecto al almacén: las funciones de importación y reversión
 * **mutan el estado que reciben** y deben llamarse dentro de `withState`, que pone el candado,
 * comprueba la forma, hace la copia y escribe de forma atómica. Ninguna función descarga nada,
 * ejecuta el script importado ni escribe en la biblioteca global.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants as fsConstants, lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, posix } from 'node:path';

import { isSafeId } from './format.mjs';
import { createSkill } from './operations.mjs';
import { appendEvent, operationOf, recordOperation, VENDOR_STATES } from './state.mjs';
import { parseSkillFile } from './skillfile.mjs';

/* ------------------------------------------------------------------------------------------------
 * Hechos fijados en D1/D8. No son configurables por el modelo: cambiar cualquiera exige una
 * decisión humana nueva y un manifiesto nuevo.
 * ---------------------------------------------------------------------------------------------- */

export const VENDOR_REPOSITORY = 'https://github.com/netresearch/context7-skill';
export const VENDOR_TAG = 'v1.7.3';
export const VENDOR_COMMIT = '01d2f069127eeeaf0a02efe8e1429e0bddc57669';
export const VENDOR_CANDIDATE_ID = `netresearch-context7@1.7.3+${VENDOR_COMMIT}`;
export const VENDOR_SKILL_ID = 'context7';
export const VENDOR_ATTRIBUTION = 'Netresearch DTT GmbH';
export const MIN_CURL_VERSION = '7.55';
export const MIN_JQ_VERSION = '1.6';

/* Fase F / P-1 y P-7: hechos verificados en el preflight, fijados como datos.
 * El núcleo no los descubre: recibe la prueba ya calculada por un adaptador confiable. */
export const VENDOR_LICENSE_POLICY = 'internal-use-only';
export const VENDOR_MANIFEST_SHA256 = '5cd772fcd877d40ebf54fa2ef06cf4095c9a08158642acd0aeadd8fb0a20ab2c';
export const VENDOR_TAG_OBJECT = 'b51014445da2a325bd520950805ebbb8463d7e8c';
export const VENDOR_SIGNING_PRINCIPAL = 'info@sebastianmendel.de';
export const VENDOR_SIGNING_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMiIH3/oRiL0mClsixaIoBCNlngoZJ+V3R4HML1bMNz1';
export const VENDOR_SIGNING_FINGERPRINT = 'SHA256:NOxv8dcZlMFz3wrLdHILVNSnF6xskqAjN3bnn0i7K30';
export const VENDOR_SIGNATURE_SOURCE = 'https://api.github.com/users/CybotTM/ssh_signing_keys';

/** Los seis ficheros del candidato. Orden canónico: el del manifiesto verificado en D5. */
export const VENDOR_FILE_PATHS = Object.freeze([
  'SKILL.md',
  'scripts/context7.sh',
  'LICENSE-MIT',
  'LICENSE-CC-BY-SA-4.0',
  'README.md',
  'docs/SECURITY-ASSURANCE.md',
]);

export const VENDOR_GATES = Object.freeze([
  'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12',
]);

export const VENDOR_COMMIT_EVIDENCE = Object.freeze({
  tag: VENDOR_TAG,
  commit: VENDOR_COMMIT,
  tagObjectSha256: VENDOR_TAG_OBJECT,
  release: Object.freeze({ draft: false, prerelease: false }),
});
export const VENDOR_COMMIT_TREE = Object.freeze(VENDOR_FILE_PATHS.map((path) => `skills/context7/${path}`));

const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HIDDEN_DENY = /^\./;
const FORBIDDEN_DESTINATION_KEYS = Object.freeze(['projectId', 'workspaceId', 'agentId', 'assign', 'activate']);

function text(value) {
  return typeof value === 'string' ? value : '';
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256Of(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (isObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalJson(value[key]);
    return out;
  }
  return value;
}

function bytesOf(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(String(value ?? ''), 'utf8');
}

function versionTuple(value) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(value ?? ''));
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function versionAtLeast(actual, minimum) {
  const left = versionTuple(actual);
  const right = versionTuple(minimum);
  if (left === null || right === null) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

function pass(code, detail) {
  return { code, ok: true, detail };
}

function fail(code, detail, reasonCode = '') {
  return { code, ok: false, detail, reasonCode };
}

/* ------------------------------------------------------------------------------------------------
 * E2 — Candidato y manifiesto de seis ficheros
 * ---------------------------------------------------------------------------------------------- */

/**
 * Huella agregada y reproducible del manifiesto. Sólo entran los campos acordados; el propio
 * `manifestSha256` y cualquier observación añadida quedan fuera, para que la huella sea estable.
 */
export function manifestFingerprint(manifest) {
  const payload = {
    candidateId: text(manifest?.candidateId),
    repository: text(manifest?.repository),
    tag: text(manifest?.tag),
    commit: text(manifest?.commit),
    files: (Array.isArray(manifest?.files) ? manifest.files : [])
      .map((entry) => ({
        path: text(entry?.path),
        sha256: text(entry?.sha256),
        bytes: Number.isInteger(entry?.bytes) ? entry.bytes : -1,
        license: text(entry?.license),
        origin: text(entry?.origin),
        tag: text(entry?.tag),
        commit: text(entry?.commit),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  return sha256Of(Buffer.from(JSON.stringify(canonicalJson(payload)), 'utf8'));
}

/** Acepta un mapa `ruta → contenido` o una lista `[{ path, content | bytes | text }]`. */
export function buildVendorFileMap(input) {
  const out = new Map();
  if (input instanceof Map) {
    for (const [path, value] of input) out.set(text(path), bytesOf(value));
    return out;
  }
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (!isObject(entry)) continue;
      out.set(text(entry.path), bytesOf(entry.bytes ?? entry.content ?? entry.text));
    }
    return out;
  }
  if (isObject(input)) {
    for (const [path, value] of Object.entries(input)) out.set(path, bytesOf(value));
  }
  return out;
}

/**
 * Verifica el manifiesto contra los bytes disponibles. Nunca descarga: los bytes vienen de un mapa
 * en memoria o de un root de staging inyectado. Devuelve la huella agregada y los seis ficheros.
 */
export function verifyManifest(manifest, { files, root = '', readFile = readFileSync, lstat = null, manifestBytes = null } = {}) {
  const errors = [];
  if (!isObject(manifest)) return { ok: false, code: 'manifest.invalid', errors: ['el manifiesto no es un objeto'] };
  if (text(manifest.candidateId) !== VENDOR_CANDIDATE_ID) errors.push(`candidateId: se esperaba ${VENDOR_CANDIDATE_ID}`);
  if (text(manifest.repository) !== VENDOR_REPOSITORY) errors.push('repository: no es la allowlist fijada');
  if (text(manifest.tag) !== VENDOR_TAG) errors.push(`tag: se esperaba ${VENDOR_TAG}`);
  if (text(manifest.commit) !== VENDOR_COMMIT) errors.push(`commit: se esperaba ${VENDOR_COMMIT}`);
  const entries = Array.isArray(manifest.files) ? manifest.files : [];
  const paths = entries.map((entry) => text(entry?.path));
  const expected = [...VENDOR_FILE_PATHS].sort();
  if (JSON.stringify([...paths].sort()) !== JSON.stringify(expected)) {
    errors.push(`files: se esperaban exactamente seis rutas (${VENDOR_FILE_PATHS.join(', ')})`);
  }
  for (const entry of entries) {
    if (!isObject(entry)) {
      errors.push('files: entrada no válida');
      continue;
    }
    if (!SHA256_RE.test(text(entry.sha256))) errors.push(`${entry.path}: sha256 no válido`);
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) errors.push(`${entry.path}: bytes no válidos`);
    if (typeof entry.license !== 'string' || entry.license === '') errors.push(`${entry.path}: falta license`);
    if (text(entry.commit) !== VENDOR_COMMIT) errors.push(`${entry.path}: commit distinto del fijado`);
    if (text(entry.tag) !== VENDOR_TAG) errors.push(`${entry.path}: tag distinto del fijado`);
  }

  const available = buildVendorFileMap(files);
  const verified = [];
  for (const entry of entries) {
    const path = text(entry?.path);
    let bytes = available.get(path);
    if (bytes === undefined && root !== '') {
      const full = join(root, path);
      if (typeof lstat === 'function') {
        try {
          if (lstat(full).isSymbolicLink()) {
            errors.push(`${path}: es un enlace simbólico`);
            continue;
          }
        } catch (error) {
          errors.push(`${path}: no se puede inspeccionar (${error?.code ?? 'error'})`);
          continue;
        }
      }
      try {
        bytes = bytesOf(readFile(full));
      } catch (error) {
        errors.push(`${path}: no se puede leer (${error?.code ?? 'error'})`);
        continue;
      }
    }
    if (bytes === undefined) {
      errors.push(`${path}: falta el contenido`);
      continue;
    }
    const sha256 = sha256Of(bytes);
    if (sha256 !== text(entry.sha256)) errors.push(`${path}: sha256 distinto (${sha256})`);
    if (bytes.length !== entry.bytes) errors.push(`${path}: mide ${bytes.length} bytes, el manifiesto dice ${entry.bytes}`);
    verified.push({ path, sha256, bytes: bytes.length, license: text(entry.license), content: bytes });
  }

  // El SHA agregado acordado en D5 es el de los bytes del MANIFEST.json tal como se preparó (BOM
  // incluido). Si el llamador aporta esos bytes se conserva ese hecho; si sólo trae el objeto se
  // calcula una huella canónica equivalente para pruebas sintéticas.
  const manifestSha256 = manifestBytes === null ? manifestFingerprint(manifest) : sha256Of(bytesOf(manifestBytes));
  return {
    ok: errors.length === 0,
    code: errors.length === 0 ? 'manifest.verified' : 'manifest.mismatch',
    errors,
    manifestSha256,
    files: verified,
    candidateId: text(manifest.candidateId),
  };
}

/** Proyección del manifiesto ya verificado al candidato que consume el importador. */
export function vendorCandidateFromManifest(manifest, options = {}) {
  const verified = verifyManifest(manifest, options);
  if (!verified.ok) return verified;
  const byPath = new Map(verified.files.map((entry) => [entry.path, entry]));
  const byFile = {};
  for (const entry of verified.files) {
    byFile[entry.path] = {
      spdx: entry.license,
      file: entry.path === 'scripts/context7.sh' || entry.path === 'LICENSE-MIT'
        ? 'LICENSE-MIT'
        : 'LICENSE-CC-BY-SA-4.0',
      attribution: VENDOR_ATTRIBUTION,
      modified: false,
      sourceUrl: `${VENDOR_REPOSITORY}/blob/${VENDOR_COMMIT}/${entry.path}`,
    };
  }
  return {
    ok: true,
    candidateId: verified.candidateId,
    status: text(manifest.status) || 'NOT_ACTIVATED',
    repository: text(manifest.repository),
    tag: text(manifest.tag),
    commit: text(manifest.commit),
    manifestSha256: verified.manifestSha256,
    files: verified.files.map(({ path, sha256, bytes, license }) => ({ path, sha256, bytes, license })),
    license: { byFile, legalReviewRequired: true },
    // Los bytes quedan en memoria para derivar el cuerpo y volver a verificar; nunca se escriben como
    // parte del registro de la skill (sólo se guardan sus hashes).
    content: new Map(verified.files.map((entry) => [entry.path, entry.content])),
  };
}

/** Lectura del candidato desde un root de staging aislado; sin red y sin ejecutar nada. */
export function readVendorCandidate({ root, manifestPath = '', readFile = readFileSync, lstat = null } = {}) {
  const file = manifestPath || join(root ?? '', 'MANIFEST.json');
  let raw;
  try {
    raw = readFile(file);
  } catch (error) {
    return { ok: false, code: 'manifest.unreadable', errors: [`no se pudo leer ${file}: ${error?.code ?? 'error'}`] };
  }
  let manifest;
  try {
    manifest = JSON.parse(bytesOf(raw).toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { ok: false, code: 'manifest.invalid-json', errors: [`MANIFEST.json no es JSON: ${String(error?.message ?? error)}`] };
  }
  return vendorCandidateFromManifest(manifest, { root, readFile, lstat, manifestBytes: raw });
}

/* ------------------------------------------------------------------------------------------------
 * E3 — Compuertas V1–V12
 * ---------------------------------------------------------------------------------------------- */

/** V1: allowlist exacta, HTTPS, sin credenciales, query ni fragmento. */
export function validateVendorRepository(repository, { allowlist = [VENDOR_REPOSITORY] } = {}) {
  const value = text(repository);
  if (!allowlist.includes(value)) return { ok: false, code: 'vendor.repo.not-allowed', detail: `"${value}" no está en la allowlist` };
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return { ok: false, code: 'vendor.repo.https-only', detail: 'sólo HTTPS' };
    if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
      return { ok: false, code: 'vendor.repo.not-canonical', detail: 'sin credenciales, query ni fragmento' };
    }
  } catch {
    return { ok: false, code: 'vendor.repo.not-allowed', detail: 'URL no analizable' };
  }
  return pass('V1', value);
}

/**
 * V2: SHA de 40 hex y correspondencia con el tag anotado. La firma SSH sigue **sin verificar**:
 * este módulo no lee `allowedSignersFile`, no importa claves y no cambia la configuración de Git.
 */
export function validateVendorCommit(commit, { expected = VENDOR_COMMIT, tag = VENDOR_TAG, evidence = null } = {}) {
  const value = text(commit);
  if (!COMMIT_RE.test(value)) return { ok: false, code: 'vendor.commit.format', detail: 'el commit debe ser un SHA de 40 hexadecimales' };
  if (value !== expected) return { ok: false, code: 'vendor.commit.mismatch', detail: `se esperaba ${expected}` };
  if (!isObject(evidence)) return { ok: false, code: 'vendor.commit.no-evidence', detail: 'falta la evidencia tag → objeto anotado → commit' };
  if (text(evidence.tag) !== tag) return { ok: false, code: 'vendor.commit.tag-mismatch', detail: `se esperaba ${tag}` };
  if (text(evidence.commit) !== value) return { ok: false, code: 'vendor.commit.evidence-mismatch', detail: 'la evidencia nombra otro commit' };
  if (!COMMIT_RE.test(text(evidence.tagObjectSha256))) {
    return { ok: false, code: 'vendor.commit.no-tag-object', detail: 'falta el SHA del objeto anotado' };
  }
  if (evidence.release?.draft === true || evidence.release?.prerelease === true) {
    return { ok: false, code: 'vendor.commit.release-not-final', detail: 'el release no es final' };
  }
  return { ok: true, code: 'V2', detail: `${tag} → ${evidence.tagObjectSha256} → ${value}`, signatureVerification: 'unverified' };
}

function safeRelativePath(path) {
  if (typeof path !== 'string' || path === '' || path.includes('\0')) return false;
  if (isAbsolute(path) || path.includes('\\') || path.startsWith('/')) return false;
  const parts = path.split('/');
  if (parts.includes('..') || parts.includes('.') || parts.some((part) => part === '')) return false;
  if (parts.some((part) => HIDDEN_DENY.test(part))) return false;
  if (posix.normalize(path) !== path) return false;
  return true;
}

/** V4: rutas relativas y canónicas, tanto las pedidas como las que devuelve la fuente. */
export function validateVendorPaths(paths, { allowed = VENDOR_FILE_PATHS, sourceNames = null } = {}) {
  const list = Array.isArray(paths) ? paths : [];
  if (list.length !== allowed.length) {
    return { ok: false, code: 'vendor.paths.count', detail: `se esperaban ${allowed.length} rutas, llegaron ${list.length}` };
  }
  const seen = new Set();
  for (const path of list) {
    if (!safeRelativePath(path)) return { ok: false, code: 'vendor.paths.unsafe', detail: `"${path}" no es una ruta segura` };
    if (seen.has(path)) return { ok: false, code: 'vendor.paths.duplicate', detail: `"${path}" repetida` };
    seen.add(path);
    if (!allowed.includes(path)) return { ok: false, code: 'vendor.paths.not-allowed', detail: `"${path}" no está en el manifiesto` };
  }
  if (sourceNames !== null) {
    const returned = Array.isArray(sourceNames) ? sourceNames : [];
    const extra = returned.filter((name) => !allowed.includes(name) || !safeRelativePath(name));
    if (extra.length > 0 || returned.length !== list.length) {
      return { ok: false, code: 'vendor.paths.source-mismatch', detail: 'la fuente devolvió nombres distintos de los validados' };
    }
  }
  return pass('V4', [...seen].sort().join(', '));
}

/** V5: denylist de desarrollo, credenciales y ejecutables furtivos. */
export function validateVendorDenylist(paths) {
  const denied = [
    /^\.env/i, /(^|\/)(secrets?|keys?|credentials?|tokens?|password)(\/|$)/i,
    /\.(pem|p12|pfx|key)$/i, /^\.github\//, /^\.claude-plugin\//,
    /^evals\//, /^tests?\//, /^tools?\//, /^scripts\/verify-harness\.sh$/,
    /(^|\/)(package(-lock)?\.json|composer\.json|renovate\.json|plugin\.json)$/i,
    /\.(exe|dll|so|dylib|zip|tar|gz|bin|wasm)$/i,
  ];
  for (const path of Array.isArray(paths) ? paths : []) {
    if (denied.some((re) => re.test(path))) {
      return { ok: false, code: 'vendor.denylist', detail: `"${path}" está prohibido` };
    }
  }
  return pass('V5', 'sin entradas prohibidas');
}

const SECRET_PATTERNS = Object.freeze([
  { code: 'secret.private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { code: 'secret.token', re: /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/ },
  { code: 'secret.assignment', re: /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?(?!your-|example|placeholder|<|\$\{)[A-Za-z0-9_\-./+]{16,}/i },
]);
const INJECTION_PATTERNS = Object.freeze([
  { code: 'injection.override', re: /ignore\s+(all\s+)?(previous|prior)\s+instructions/i },
  { code: 'injection.disregard', re: /disregard\s+(all\s+)?(previous|prior)/i },
  { code: 'injection.prompt', re: /\b(system\s+prompt|reveal\s+your\s+(api|secret|system))\b/i },
  { code: 'injection.role', re: /\byou\s+are\s+now\s+(a|an|the)\b/i },
]);
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/;

/** V8: escaneo best-effort por forma, nunca presentado como garantía de intención. */
export function scanVendorContent(files, { patterns = null } = {}) {
  const map = buildVendorFileMap(files);
  const secretRules = patterns?.secrets ?? SECRET_PATTERNS;
  const injectionRules = patterns?.injection ?? INJECTION_PATTERNS;
  const findings = [];
  for (const [path, bytes] of map) {
    const lines = bytes.toString('utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      for (const rule of secretRules) {
        if (rule.re.test(line)) findings.push({ path, line: index + 1, label: rule.code, kind: 'secret' });
      }
      for (const rule of injectionRules) {
        if (rule.re.test(line)) findings.push({ path, line: index + 1, label: rule.code, kind: 'injection' });
      }
      if (INVISIBLE_RE.test(line)) findings.push({ path, line: index + 1, label: 'invisible-unicode', kind: 'injection' });
    }
  }
  const blocked = findings.some((finding) => finding.kind === 'secret' || finding.kind === 'injection');
  return {
    ok: true,
    code: blocked ? 'vendor.scan.blocked' : 'vendor.scan.clear',
    findings,
    blocked,
    bestEffort: true,
    detail: blocked ? `${findings.length} hallazgo(s)` : 'sin hallazgos por forma (best-effort)',
  };
}

/** V6: mapa por fichero. La ambigüedad histórica se declara; no se inventa una conclusión legal. */
export function validateVendorLicenses(files, {
  manifest = null,
  attribution = VENDOR_ATTRIBUTION,
  allowed = ['MIT', 'CC-BY-SA-4.0'],
} = {}) {
  const map = buildVendorFileMap(files);
  const byFile = {};
  const errors = [];
  const expected = isObject(manifest) && Array.isArray(manifest.files)
    ? new Map(manifest.files.map((entry) => [text(entry?.path), text(entry?.license)]))
    : null;
  for (const path of VENDOR_FILE_PATHS) {
    const bytes = map.get(path);
    if (bytes === undefined) {
      errors.push(`${path}: falta para clasificar la licencia`);
      continue;
    }
    const declared = expected?.get(path) ?? (path === 'scripts/context7.sh' || path === 'LICENSE-MIT' ? 'MIT' : 'CC-BY-SA-4.0');
    if (!allowed.includes(declared)) {
      errors.push(`${path}: SPDX "${declared}" no admitido`);
      continue;
    }
    const body = bytes.toString('utf8');
    if (path === 'LICENSE-MIT' && !/MIT License/i.test(body)) errors.push('LICENSE-MIT: falta el texto MIT');
    if (path === 'LICENSE-CC-BY-SA-4.0' && !/Creative Commons/i.test(body)) errors.push('LICENSE-CC-BY-SA-4.0: falta el texto CC BY-SA');
    if (path === 'scripts/context7.sh' && !/SPDX-License-Identifier:\s*MIT/.test(body)) errors.push(`${path}: falta el SPDX MIT`);
    if (path === 'SKILL.md' && !new RegExp(`SPDX-FileCopyrightText:\\s*${attribution.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(body)) {
      errors.push(`${path}: falta la atribución a ${attribution}`);
    }
    byFile[path] = { spdx: declared, attribution, modified: path === 'scripts/context7.sh', file: declared === 'MIT' ? 'LICENSE-MIT' : 'LICENSE-CC-BY-SA-4.0' };
  }
  return {
    ok: errors.length === 0,
    code: errors.length === 0 ? 'V6' : 'vendor.license.invalid',
    byFile,
    errors,
    // P-1: `(MIT AND CC-BY-SA-4.0)` sigue sin interpretación jurídica. La técnica aplica la regla
    // conservadora, pero no declara cerrada la cuestión.
    ambiguous: true,
    finalLicenseValidation: false,
    legalReviewRequired: true,
    detail: errors.length === 0 ? 'mapa por fichero completo; revisión jurídica pendiente' : errors.join('; '),
  };
}

/** V7: el único ejecutable admitido es el script del manifiesto, y se guarda como dato. */
export function validateVendorScripts(paths, files) {
  const list = Array.isArray(paths) ? paths : [];
  const scripts = list.filter((path) => path.startsWith('scripts/'));
  const allowed = ['scripts/context7.sh'];
  if (scripts.some((path) => !allowed.includes(path))) {
    return { ok: false, code: 'vendor.script.not-allowed', detail: `script no admitido: ${scripts.join(', ')}` };
  }
  if (!scripts.includes('scripts/context7.sh')) {
    return { ok: false, code: 'vendor.script.missing', detail: 'falta scripts/context7.sh' };
  }
  const map = buildVendorFileMap(files);
  const content = map.get('scripts/context7.sh')?.toString('utf8') ?? '';
  if (content.trim() === '') return { ok: false, code: 'vendor.script.empty', detail: 'el script está vacío' };
  return pass('V7', 'scripts/context7.sh declarado, sin ejecución');
}

/** V11 (estática): lo que el adaptador debe cumplir y lo que jamás puede aparecer. */
export function validateHardenedScript(source, { original = '' } = {}) {
  const script = text(source);
  const errors = [];
  const require = (re, code) => { if (!re.test(script)) errors.push(code); };
  require(/--fail|-f(?:\s|\))/m, 'missing-http-fail');
  require(/--connect-timeout/, 'missing-connect-timeout');
  require(/--max-time/, 'missing-max-time');
  require(/(^|[|\s])-q(\s|$)/m, 'missing-curl-quiet');
  require(/-H\s+@-/, 'missing-stdin-header');
  require(/(?:"\$JQ_BIN"|jq)[^\n]*@uri/, 'missing-uri-encoding');
  require(/@uri[^\n]*library|library[^\n]*@uri|encode_library/i, 'missing-library-id-encoding');
  require(/HTTP_\w+|exit\s+[2-9]/, 'missing-stable-exit-codes');
  require(/set\s+-e/, 'missing-set-e');
  const forbidden = [
    { re: /(^|[^A-Za-z])eval\s/m, code: 'contains-eval' },
    { re: /(^|[^A-Za-z])source\s/m, code: 'contains-source' },
    { re: /\|\s*(bash|sh|zsh)\b/, code: 'pipes-to-shell' },
    { re: /curl\s+\$\(/, code: 'dynamic-curl-argv' },
  ];
  for (const rule of forbidden) if (rule.re.test(script)) errors.push(rule.code);
  if (text(original) !== '' && !/SPDX-License-Identifier:\s*MIT/.test(script)) errors.push('missing-original-mit-notice');
  return {
    ok: errors.length === 0,
    code: errors.length === 0 ? 'V11' : 'vendor.script.not-hardened',
    errors,
    detail: errors.length === 0 ? 'matriz estática del adaptador completa' : errors.join(', '),
  };
}

/**
 * V10: preflight de dependencias. Sólo consulta versiones; no instala, no toca PATH global y no
 * escribe. El llamador puede inyectar `run` para usar los binarios portables del laboratorio.
 */
export function checkRuntimeDependencies({
  curlBin = 'curl',
  jqBin = 'jq',
  shellBin = '',
  scriptPath = '',
  run = spawnSync,
  platform = process.platform,
} = {}) {
  const errors = [];
  const messages = [];
  const checks = [];
  const curl = run(curlBin, ['--version'], { encoding: 'utf8' });
  const curlText = `${curl?.stdout ?? ''}\n${curl?.stderr ?? ''}`;
  const curlVersion = /curl\s+(\d+\.\d+(?:\.\d+)?)/.exec(curlText)?.[1] ?? '';
  const curlOk = curl?.status === 0 && versionAtLeast(curlVersion, MIN_CURL_VERSION);
  if (!curlOk) {
    errors.push(`DEPENDENCY_MISSING: curl >= ${MIN_CURL_VERSION} is required. Install curl manually and retry. No installation was performed.`);
  }
  checks.push({ name: 'curl', ok: curlOk, version: curlVersion, detail: curlText.split('\n')[0]?.trim() ?? '' });

  const jq = run(jqBin, ['--version'], { encoding: 'utf8' });
  const jqText = `${jq?.stdout ?? ''}\n${jq?.stderr ?? ''}`;
  const jqVersion = /jq-(\d+\.\d+(?:\.\d+)?)/.exec(jqText)?.[1] ?? '';
  const jqOk = jq?.status === 0 && versionAtLeast(jqVersion, MIN_JQ_VERSION);
  if (!jqOk) {
    errors.push('DEPENDENCY_MISSING: jq is required. Install jq manually and retry. No installation was performed.');
  }
  checks.push({ name: 'jq', ok: jqOk, version: jqVersion, detail: jqText.trim() });

  const shell = text(shellBin) === '' ? { ok: true, version: platform === 'win32' ? 'host-shell' : 'posix-shell', detail: 'intérprete del host' } : (() => {
    const result = run(shellBin, ['--version'], { encoding: 'utf8' });
    return {
      ok: result?.status === 0,
      version: `${result?.stdout ?? ''}`.split('\n')[0]?.trim() ?? '',
      detail: 'intérprete declarado',
    };
  })();
  if (!shell.ok) errors.push('DEPENDENCY_MISSING: el intérprete del adaptador no responde');
  checks.push({ name: 'shell', ...shell });

  let script = { ok: true, detail: 'no se requirió ruta de script' };
  if (text(scriptPath) !== '') {
    try {
      accessSync(scriptPath, fsConstants.X_OK);
      script = { ok: true, detail: 'ejecutable' };
    } catch {
      script = { ok: false, detail: 'sin permiso de ejecución' };
      errors.push('DEPENDENCY_MISSING: el adaptador no tiene permiso de ejecución');
    }
  }
  checks.push({ name: 'script', ...script });
  messages.push('Sin instalación automática. Sin cambios en PATH global ni en el perfil real de DSH.');
  return { ok: errors.length === 0, code: errors.length === 0 ? 'V10' : 'vendor.dependencies.missing', checks, errors, messages, curl: checks[0], jq: checks[1], shell: checks[2], script: checks[3] };
}

/**
 * P-7: valida la **prueba** que entrega el adaptador confiable. El núcleo no ejecuta git, no lee
 * `allowedSignersFile` y no acepta un booleano del cliente: comprueba forma, clave, principal,
 * tag, commit y momento, y sólo entonces permite escribir `verified` en la procedencia.
 */
export function validateSignatureProof(proof, { tag = VENDOR_TAG, commit = VENDOR_COMMIT } = {}) {
  if (!isObject(proof)) {
    return { ok: false, code: 'vendor.signature.missing', detail: 'falta la prueba de firma verificada por el adaptador' };
  }
  if (proof.status !== 'verified') {
    return { ok: false, code: 'vendor.signature.not-verified', detail: 'la verificación de la firma no está en verde' };
  }
  if (text(proof.tag) !== tag || text(proof.commit) !== commit) {
    return { ok: false, code: 'vendor.signature.binding-mismatch', detail: 'la prueba no corresponde al tag y commit fijados' };
  }
  if (text(proof.tagObject) !== VENDOR_TAG_OBJECT) {
    return { ok: false, code: 'vendor.signature.tag-object-mismatch', detail: 'el objeto de tag verificado no es el fijado' };
  }
  if (text(proof.principal) !== VENDOR_SIGNING_PRINCIPAL) {
    return { ok: false, code: 'vendor.signature.principal-mismatch', detail: 'el principal no es el aprobado' };
  }
  if (text(proof.keyFingerprint) !== VENDOR_SIGNING_FINGERPRINT || text(proof.key) !== VENDOR_SIGNING_KEY) {
    return { ok: false, code: 'vendor.signature.key-mismatch', detail: 'la clave no es la publicada y aprobada' };
  }
  if (!ISO_RE.test(text(proof.verifiedAt))) {
    return { ok: false, code: 'vendor.signature.no-verified-at', detail: 'falta el momento de verificación con forma ISO' };
  }
  return {
    ok: true,
    code: 'vendor.signature.verified',
    proof: {
      status: 'verified',
      tag,
      commit,
      tagObject: VENDOR_TAG_OBJECT,
      principal: VENDOR_SIGNING_PRINCIPAL,
      keyFingerprint: VENDOR_SIGNING_FINGERPRINT,
      key: VENDOR_SIGNING_KEY,
      method: text(proof.method) || 'ssh-keygen -Y verify',
      source: text(proof.source) || VENDOR_SIGNATURE_SOURCE,
      verifiedAt: text(proof.verifiedAt),
    },
  };
}

/** Opciones canónicas de V1–V12: la API no tiene que reconstruir la evidencia fijada. */
export function vendorValidationOptions(candidate, options = {}) {
  const map = buildVendorFileMap(options.files ?? candidate?.content ?? {});
  return {
    commitEvidence: VENDOR_COMMIT_EVIDENCE,
    commitTree: VENDOR_COMMIT_TREE,
    dependencies: options.dependencies ?? null,
    hardenedScript: options.hardenedScript ?? String(map.get('scripts/context7.sh')?.toString('utf8') ?? ''),
    assignmentsBefore: options.assignmentsBefore ?? {},
    assignmentsAfter: options.assignmentsAfter ?? options.assignmentsBefore ?? {},
    signatureProof: options.signatureProof ?? null,
  };
}

/** Ejecuta las doce compuertas sobre un candidato ya leído. No escribe ni importa nada. */
export function vendorValidate(candidate, options = {}) {
  const checks = [];
  // P-1: conservar `ambiguous` y `legalReviewRequired` del resultado de V6. Antes se descartaban y
  // la bandera `ambiguousLicense` de la validación quedaba falsa aunque la licencia fuera ambigua.
  const add = (gate, result) => checks.push({
    gate,
    ok: result.ok === true,
    code: result.code,
    detail: result.detail,
    reasonCode: result.reasonCode ?? '',
    ...(result.ambiguous === true ? { ambiguous: true } : {}),
    ...(result.legalReviewRequired === true ? { legalReviewRequired: true } : {}),
  });
  const files = candidate?.files ?? [];
  const paths = files.map((entry) => entry.path);
  const map = buildVendorFileMap(options.files ?? candidate?.content ?? {});

  add('V1', validateVendorRepository(candidate?.repository));
  add('V2', validateVendorCommit(candidate?.commit, { evidence: options.commitEvidence }));
  add('V3', (() => {
    const tree = options.commitTree;
    if (!Array.isArray(tree)) return { ok: false, code: 'vendor.commit.no-tree', detail: 'falta el árbol del commit fijado' };
    // El candidato se presenta como raíz autónoma; en el repositorio vive bajo skills/context7/.
    const prefix = options.commitPrefix ?? 'skills/context7/';
    const missing = VENDOR_FILE_PATHS.filter((path) => !tree.includes(`${prefix}${path}`));
    return missing.length === 0
      ? pass('V3', `los seis ficheros pertenecen al commit (raíz ${prefix})`)
      : { ok: false, code: 'vendor.commit.not-in-tree', detail: `fuera del árbol: ${missing.join(', ')}` };
  })());
  add('V4', validateVendorPaths(paths, { sourceNames: options.sourceNames ?? null }));
  add('V5', validateVendorDenylist(paths));
  add('V6', validateVendorLicenses(map, { manifest: candidate, attribution: VENDOR_ATTRIBUTION }));
  add('V7', validateVendorScripts(paths, map));
  const scan = scanVendorContent(map);
  add('V8', { ...scan, ok: scan.blocked !== true });
  add('V9', (() => {
    const errors = [];
    for (const entry of files) {
      const bytes = map.get(entry.path);
      if (bytes === undefined) {
        errors.push(`${entry.path}: sin bytes`);
        continue;
      }
      if (sha256Of(bytes) !== entry.sha256) errors.push(`${entry.path}: hash distinto`);
      if (bytes.length !== entry.bytes) errors.push(`${entry.path}: tamaño distinto`);
    }
    return errors.length === 0 ? pass('V9', 'seis hashes byte a byte') : { ok: false, code: 'vendor.hash.mismatch', detail: errors.join('; ') };
  })());
  add('V10', options.dependencies ?? { ok: false, code: 'vendor.dependencies.not-provided', detail: 'hay que pasar el preflight' });
  add('V11', options.hardenedScript
    ? validateHardenedScript(options.hardenedScript, { original: options.originalScript ?? '' })
    : { ok: false, code: 'vendor.script.not-provided', detail: 'falta el adaptador endurecido' });
  add('V12', (() => {
    const before = options.assignmentsBefore ?? null;
    const after = options.assignmentsAfter ?? before;
    if (before === null) return { ok: false, code: 'vendor.assignments.no-snapshot', detail: 'falta la foto de assignments' };
    if (JSON.stringify(canonicalJson(before)) !== JSON.stringify(canonicalJson(after))) {
      return { ok: false, code: 'vendor.assignments.changed', detail: 'la validación cambió asignaciones' };
    }
    return pass('V12', 'assignments intactos');
  })());

  const failures = checks.filter((check) => !check.ok).map((check) => `${check.gate}:${check.code}`);
  const license = checks.find((check) => check.gate === 'V6');
  // P-7: la firma NO se presume. Sólo el adaptador del Host puede entregar una prueba; el núcleo
  // comprueba su forma y su enlace con el tag/commit fijados antes de publicar `verified`.
  const signature = validateSignatureProof(options.signatureProof);
  return {
    ok: failures.length === 0 && signature.ok,
    code: failures.length === 0 && signature.ok
      ? 'vendor.validated'
      : (signature.ok ? 'vendor.validation-failed' : signature.code),
    checks,
    failures,
    signatureVerification: signature.ok ? 'verified' : 'unverified',
    signatureProof: signature.ok ? signature.proof : null,
    legalReviewRequired: true,
    licensePolicy: VENDOR_LICENSE_POLICY,
    ambiguousLicense: license?.ambiguous === true,
  };
}

/* ------------------------------------------------------------------------------------------------
 * E6/E7 — Importación y reversión transaccionales (mutan el estado dentro de `withState`)
 * ---------------------------------------------------------------------------------------------- */

function assignmentsSignature(state) {
  return JSON.stringify(canonicalJson(state?.assignments ?? {}));
}

function derivedSkillInput(candidate, { skillId }) {
  const skillFile = candidate?.content?.get?.('SKILL.md')
    ?? buildVendorFileMap(candidate?.content ?? {}).get('SKILL.md');
  const parsed = parseSkillFile(skillFile?.toString('utf8') ?? '');
  const upstreamDescription = parsed.data?.description ?? '';
  const longDescription = typeof upstreamDescription === 'string' && upstreamDescription.trim() !== ''
    ? upstreamDescription.replace(/\s+/g, ' ').trim()
    : 'Consulta documentación de bibliotecas desde la API REST de Context7 cuando el MCP no está disponible.';
  // El enrutado de Skill Center mide 60–300 caracteres; la descripción upstream es más larga. Se recorta
  // en una frontera de palabra y se deja el original íntegro en `provenance.upstream.files`, no aquí.
  const description = longDescription.length <= 300
    ? longDescription
    : `${longDescription.slice(0, 297).replace(/\s+\S*$/, '')}…`.slice(0, 300);
  const triggers = /Triggers on:\s*(.*)$/i.exec(longDescription)?.[1] ?? '';
  const whenToUse = triggers.trim() !== ''
    ? triggers.replace(/\s+/g, ' ').trim().slice(0, 200)
    : 'Cuando haga falta documentación de una biblioteca y el servidor MCP de Context7 no esté configurado.';
  const body = parsed.body ?? '';
  const tags = Array.isArray(parsed.data?.tags) ? parsed.data.tags.map((tag) => String(tag)).slice(0, 8) : ['context7', 'docs'];
  return { id: skillId, title: 'Context7 — documentación de bibliotecas', description, whenToUse, body, tags };
}

/**
 * Incorpora el candidato **validado** a un estado ya abierto en transacción. No activa, no asigna,
 * no publica fuera de la biblioteca y no toca `req-562393e0835f`.
 */
export function vendorImport(state, input = {}, { now = new Date().toISOString(), actor = 'human' } = {}) {
  const forbidden = FORBIDDEN_DESTINATION_KEYS.filter((key) => input[key] !== undefined);
  if (forbidden.length > 0) {
    return { ok: false, code: 'vendor.destination-forbidden', detail: `no se aceptan parámetros de destino: ${forbidden.join(', ')}` };
  }
  if (actor !== 'human') return { ok: false, code: 'vendor.actor-required', detail: 'la importación la pide una persona' };
  if (input.confirmed !== true) return { ok: false, code: 'vendor.confirmation-required', detail: 'confirmed:true explícito' };
  if (typeof input.operationId !== 'string' || input.operationId === '') {
    return { ok: false, code: 'vendor.operation-id-required', detail: 'operationId estable y no vacío' };
  }
  if (operationOf(state, input.operationId) !== null) {
    return { ok: true, idempotent: true, code: 'vendor.already-imported', operationId: input.operationId };
  }
  const validation = input.validation;
  if (validation?.ok !== true) return { ok: false, code: 'vendor.validation-required', detail: 'V1–V12 deben estar en verde' };
  // P-7: ni un booleano del cliente ni una validación sin prueba pueden marcar la procedencia como
  // verificada. Se revalida la prueba que entregó el adaptador; si cambia el tag o el commit, falla.
  if (validation.signatureVerification !== 'verified') {
    return { ok: false, code: 'vendor.signature-required', detail: 'la firma del tag debe estar verificada por el adaptador del Host' };
  }
  const signature = validateSignatureProof(validation.signatureProof);
  if (!signature.ok) return { ok: false, code: signature.code, detail: signature.detail };
  const candidate = input.candidate;
  if (candidate?.ok !== true || candidate.manifestSha256 === undefined) {
    return { ok: false, code: 'vendor.candidate-required', detail: 'falta el candidato verificado' };
  }
  const skillId = text(input.skillId) || VENDOR_SKILL_ID;
  if (!isSafeId(skillId)) return { ok: false, code: 'vendor.invalid-id', detail: `"${skillId}" no es un id seguro` };
  if (state.skills?.[skillId] !== undefined) {
    const existing = state.skills[skillId];
    if (existing.provenance?.candidateId === candidate.candidateId) {
      return { ok: true, idempotent: true, code: 'vendor.already-imported', id: skillId, operationId: input.operationId };
    }
    return { ok: false, code: 'vendor.id-conflict', detail: `ya existe "${skillId}" con otra procedencia` };
  }

  const assignmentsBefore = assignmentsSignature(state);
  const approvedBy = text(input.approvedBy) || 'LifeCode Library Maintainer';
  const created = createSkill(state, derivedSkillInput(candidate, { skillId }), { now, actor: 'human' });
  if (!created.ok) return { ...created, code: `vendor.${created.code}` };

  const skill = state.skills[skillId];
  const provenance = {
    kind: 'vendor',
    upstream: {
      repository: candidate.repository,
      tag: candidate.tag,
      commit: candidate.commit,
      fetchedAt: now,
      files: candidate.files.map(({ path, sha256, bytes, license }) => ({ path, sha256, bytes, license })),
    },
    manifestSha256: candidate.manifestSha256,
    candidateId: candidate.candidateId,
    approvedBy,
    signatureVerification: 'verified',
    signatureProof: signature.proof,
    legalReviewRequired: true,
    licensePolicy: VENDOR_LICENSE_POLICY,
    ambiguousLicense: validation.ambiguousLicense === true,
  };
  const license = {
    byFile: structuredClone(candidate.license?.byFile ?? {}),
    policy: VENDOR_LICENSE_POLICY,
    ambiguous: validation.ambiguousLicense === true,
    legalReviewRequired: true,
  };
  const files = candidate.files.map((entry) => ({ ...entry, role: entry.path === 'scripts/context7.sh' ? 'script' : entry.path.startsWith('LICENSE') ? 'license' : 'document' }));
  for (const target of [skill, created.version]) {
    target.provenance = structuredClone(provenance);
    target.license = structuredClone(license);
    target.files = structuredClone(files);
    target.vendorState = 'disabled';
  }
  skill.origin.kind = 'import';
  skill.origin.from = candidate.repository;
  skill.origin.fromVersion = candidate.tag;
  skill.origin.note = `vendorizado desde ${candidate.commit}; no activado`;

  appendEvent(state, {
    id: `ev-vendor-import-${input.operationId}`.slice(0, 120),
    at: now,
    type: 'skill-vendor-imported',
    code: 'skill-vendor-imported',
    skillId,
    version: created.version.version,
    actor: 'human',
    by: approvedBy,
    note: `importación de vendor validada; ${text(input.note) || 'sin activación ni asignación'}`,
    checksum: candidate.manifestSha256,
    candidateId: candidate.candidateId,
    manifestSha256: candidate.manifestSha256,
    vendorState: 'disabled',
    repository: candidate.repository,
    tag: candidate.tag,
    commit: candidate.commit,
    operationId: input.operationId,
    channel: text(input.channel),
  });
  recordOperation(state, input.operationId, {
    kind: 'vendor-import',
    uuid: text(input.operationId),
    targetSha256: candidate.manifestSha256,
    registeredAt: now,
    status: 'registered',
  });

  if (canonicalJson(assignmentsSignature(state)) !== assignmentsBefore) {
    return { ok: false, code: 'vendor.assignments.changed', detail: 'la importación intentó cambiar asignaciones' };
  }
  return {
    ok: true,
    id: skillId,
    version: created.version.version,
    candidateId: candidate.candidateId,
    manifestSha256: candidate.manifestSha256,
    vendorState: 'disabled',
    activated: false,
    assigned: false,
    operationId: input.operationId,
    assignmentsBefore,
    assignmentsAfter: assignmentsSignature(state),
  };
}

/** Plan de reversión: qué se va a tocar y con qué huella. No muta nada. */
export function planVendorRollback(state, input = {}) {
  const skillId = text(input.skillId);
  const skill = state?.skills?.[skillId];
  if (skill === undefined) return { ok: false, code: 'vendor.rollback.missing-skill', detail: `no existe "${skillId}"` };
  const version = text(input.version) || skill.currentVersion;
  const operationId = text(input.operationId);
  if (operationId === '') return { ok: false, code: 'vendor.rollback.operation-id', detail: 'operationId obligatorio' };
  const event = (Array.isArray(state.events) ? state.events : []).find((entry) =>
    entry?.type === 'skill-vendor-imported' && entry?.skillId === skillId && entry?.operationId === operationId);
  if (event === undefined) return { ok: false, code: 'vendor.rollback.no-event', detail: 'esa operación no importó esta skill' };
  if (version !== event.version) return { ok: false, code: 'vendor.rollback.version-mismatch', detail: 'la versión no coincide con la importada' };
  const referenced = Object.entries(state.assignments ?? {}).filter(([, row]) => isObject(row) && row[skillId] !== undefined);
  if (referenced.length > 0) {
    return { ok: false, code: 'vendor.rollback.assigned', detail: 'la skill está asignada: una persona debe desactivarla antes' };
  }
  return {
    ok: true,
    skillId,
    version,
    operationId,
    manifestSha256: text(event.manifestSha256),
    candidateId: text(event.candidateId),
    // D8 §11.7: no hay `deleteSkill`. La skill fue creada por esta importación, así que el snapshot
    // previo es «no existía»: la baja se modela como `rolled_back`/`deprecated`, nunca como borrado.
    existedBefore: false,
    snapshot: {
      provenance: structuredClone(skill.provenance ?? null),
      license: structuredClone(skill.license ?? null),
      files: structuredClone(skill.files ?? null),
      vendorState: text(skill.vendorState),
    },
  };
}

/**
 * Revierte **sólo** el artefacto de esa operación. Conserva el diario, los eventos ajenos y las
 * asignaciones; un `operationId` repetido no duplica asiento ni escritura.
 */
export function revertVendorImport(state, input = {}, { now = new Date().toISOString() } = {}) {
  const operationId = text(input.operationId);
  if (operationId === '') return { ok: false, code: 'vendor.rollback.operation-id', detail: 'operationId obligatorio' };
  const already = (Array.isArray(state.events) ? state.events : []).some((entry) =>
    entry?.type === 'skill-vendor-reverted' && entry?.operationId === operationId);
  if (already) return { ok: true, idempotent: true, code: 'vendor.rollback.idempotent', operationId };

  const plan = planVendorRollback(state, input);
  if (!plan.ok) return plan;
  const skill = state.skills[plan.skillId];
  skill.vendorState = 'rolled_back';
  skill.status = 'deprecated';
  skill.provenance = structuredClone(plan.snapshot.provenance ?? null);
  skill.license = structuredClone(plan.snapshot.license ?? null);
  skill.files = structuredClone(plan.snapshot.files ?? null);
  // La versión importada se conserva: borrarla sería borrar la historia de una persona, no revertir
  // un artefacto. El estado `rolled_back` impide que el panel la ofrezca como candidata a activar.
  for (const version of skill.versions) if (version.version === plan.version) version.vendorState = 'rolled_back';

  appendEvent(state, {
    id: `ev-vendor-revert-${operationId}`.slice(0, 120),
    at: now,
    type: 'skill-vendor-reverted',
    code: 'skill-vendor-reverted',
    skillId: plan.skillId,
    version: plan.version,
    actor: 'human',
    by: text(input.approvedBy) || 'LifeCode Library Maintainer',
    note: 'reversión de la importación de vendor; diario y asignaciones ajenas conservados',
    checksum: plan.manifestSha256,
    candidateId: plan.candidateId,
    manifestSha256: plan.manifestSha256,
    vendorState: 'rolled_back',
    operationId,
  });
  recordOperation(state, `${operationId}:rollback`, {
    kind: 'vendor-rollback',
    uuid: `${operationId}:rollback`,
    targetSha256: plan.manifestSha256,
    registeredAt: now,
    status: 'registered',
  });
  return {
    ok: true,
    idempotent: false,
    skillId: plan.skillId,
    version: plan.version,
    operationId,
    previousVersionRestored: null,
    physicalDeletion: false,
    journalPreserved: true,
    assignmentsUntouched: true,
  };
}

export const VENDOR_EXPORTS = Object.freeze([
  'manifestFingerprint', 'buildVendorFileMap', 'verifyManifest', 'vendorCandidateFromManifest',
  'readVendorCandidate', 'validateVendorRepository', 'validateVendorCommit', 'validateVendorPaths',
  'validateVendorDenylist', 'scanVendorContent', 'validateVendorLicenses', 'validateVendorScripts',
  'validateHardenedScript', 'checkRuntimeDependencies', 'validateSignatureProof',
  'vendorValidationOptions', 'vendorValidate', 'vendorImport',
  'planVendorRollback', 'revertVendorImport',
]);
