/**
 * K8-B5 · Fixtures sintéticas originales para el Source Adapter.
 *
 * Todo el texto de este fichero es original del laboratorio. Sólo se conservan cadenas que son
 * metadatos permitidos por K8-B3 (SPDX, atribución, rutas y hashes calculados). No hay bytes del
 * candidato Context7, ni del script adaptado, ni de su documentación.
 */
import { createHash } from 'node:crypto';

import { VENDOR_FILE_PATHS, VENDOR_MANIFEST_SHA256 } from '../../lib/vendor.mjs';
import { vendorFixture, verifiedSignatureProof } from '../helpers-vendor.mjs';

export const SYNTHETIC_DESCRIPTION = 'Fixture original del laboratorio para comprobar la adquisición genérica de Skills externas.';

export const SYNTHETIC_ADAPTER_SCRIPT = [
  '#!/bin/bash',
  '# Fixture sintético original: adaptador de demostración para pruebas, sin contenido de terceros.',
  '# SPDX-License-Identifier: MIT',
  '# SPDX-FileCopyrightText: Fixture sintético LSC',
  'set -euo pipefail',
  '',
  'CURL_BIN="${CURL_BIN:-curl}"',
  'JQ_BIN="${JQ_BIN:-jq}"',
  '',
  'HTTP_BAD_REQUEST=64',
  'HTTP_UPSTREAM_4XX=2',
  'HTTP_UPSTREAM_5XX=3',
  'HTTP_TIMEOUT=4',
  'HTTP_DNS=5',
  'HTTP_INVALID=6',
  '',
  'encode_library_id() {',
  '  printf \'%s\' "$1" | "$JQ_BIN" -sRr @uri',
  '}',
  '',
  'die() { printf \'%s\\n\' "$2" >&2; exit "$1"; }',
  '',
  'fetch() {',
  '  local url="$1" key="$2" response status',
  '  set +e',
  '  if [ -n "$key" ]; then',
  '    response=$(printf \'Authorization: Bearer %s\\n\' "$key" | "$CURL_BIN" -q -sS --fail --connect-timeout 5 --max-time 20 "$url" -H @- -w $\'\\n%{http_code}\')',
  '  else',
  '    response=$("$CURL_BIN" -q -sS --fail --connect-timeout 5 --max-time 20 "$url" -w $\'\\n%{http_code}\')',
  '  fi',
  '  status=$?',
  '  set -e',
  '  case "$status" in',
  '    28) die "$HTTP_TIMEOUT" \'timeout\' ;;',
  '    6) die "$HTTP_DNS" \'resolver o conectar\' ;;',
  '    0) ;;',
  '    *) die "$HTTP_DNS" \'resolver o conectar\' ;;',
  '  esac',
  '  local code="${response##*$\'\\n\'}"',
  '  printf \'%s\' "${response%$\'\\n\'*}"',
  '  case "$code" in',
  '    4??) die "$HTTP_UPSTREAM_4XX" "HTTP $code" ;;',
  '    5??) die "$HTTP_UPSTREAM_5XX" "HTTP $code" ;;',
  '  esac',
  '}',
  '',
  'case "${1:-}" in',
  '  search)',
  '    query=$(encode_library_id "${2:-}")',
  '    body=$(fetch "https://fixture.invalid/v1/search?query=$query" "${API_KEY:-}")',
  '    printf \'%s\' "$body" | "$JQ_BIN" -e >/dev/null || die "$HTTP_INVALID" \'no es JSON\'',
  '    printf \'%s\' "$body" | "$JQ_BIN" -r',
  '    ;;',
  '  docs)',
  '    library="${2:-}"',
  '    case "$library" in',
  '      *..*|*\\\\*) die "$HTTP_BAD_REQUEST" \'library-id no válido\' ;;',
  '    esac',
  '    topic=$(encode_library_id "${3:-}")',
  '    path=${library#/}',
  '    printf \'%s\\n\' "$(fetch "https://fixture.invalid/v2/docs/code/$path?type=txt&topic=$topic" "${API_KEY:-}")"',
  '    ;;',
  '  *) die "$HTTP_BAD_REQUEST" \'modo no admitido\' ;;',
  'esac',
].join('\n');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Manifiesto sintético de seis ficheros; los hashes se calculan, nunca se copian. */
export function syntheticManifest() {
  return vendorFixture().manifest;
}

/** Referencia fijada sintética: el hash del manifiesto se deriva de los bytes que servimos. */
export function syntheticReference() {
  const manifest = syntheticManifest();
  return Object.freeze({
    repository: manifest.repository,
    tag: manifest.tag,
    commit: manifest.commit,
    tree: 'skills/context7',
    manifestPath: 'MANIFEST.json',
    manifestSha256: sha256(Buffer.from(JSON.stringify(manifest), 'utf8')),
  });
}

/** Candidato sintético listo para inyectar en el pipeline (sin leer ningún fichero real). */
export function syntheticCandidate({ manifest = syntheticManifest(), includeBytes = true } = {}) {
  const fixture = vendorFixture();
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  if (!includeBytes) return { ok: true, manifest, manifestBytes, files: new Map(), signatureProof: verifiedSignatureProof() };
  return {
    ok: true,
    manifest,
    manifestBytes,
    files: fixture.files,
    signatureProof: verifiedSignatureProof(),
    hardenedScript: SYNTHETIC_ADAPTER_SCRIPT,
    originalScript: SYNTHETIC_ADAPTER_SCRIPT,
    // Metadato público permitido: simula el hash fijado de la decisión humana sin copiar el
    // MANIFEST.json de terceros ni relajar la compuerta de la API.
    expectedManifestSha256: VENDOR_MANIFEST_SHA256,
  };
}

/** `fetch` determinista sobre el candidato sintético; admite corrupción controlada. */
export function syntheticFetch({ corrupt = '', manifestBytes = null, reference = syntheticReference(), manifest = syntheticManifest() } = {}) {
  const calls = [];
  const bytesManifest = manifestBytes ?? Buffer.from(JSON.stringify(manifest), 'utf8');
  const fixture = vendorFixture();
  const response = (bytes, status = 200) => ({
    ok: status === 200,
    status,
    async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
  });
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith(reference.manifestPath)) return response(bytesManifest);
    const path = url.split(`/${reference.tree}/`)[1] ?? '';
    const bytes = Buffer.from(fixture.files.get(path) ?? Buffer.alloc(0));
    if (corrupt === path && bytes.length > 0) bytes[0] ^= 0xff;
    return response(bytes);
  };
  return { fetchImpl, calls, manifestBytes: bytesManifest };
}

export const SYNTHETIC_FILE_PATHS = Object.freeze([...VENDOR_FILE_PATHS]);
