/**
 * ACP-02 · El catálogo de errores es la fuente única y no puede desincronizarse.
 *
 * El defecto que cierra esta prueba: `RAG_CODES` se presentaba como cerrado pero le faltaban 18 códigos
 * que el código lanza de verdad —incluidos los de autorización—, y cada API tenía su propia tabla de
 * status. Quien mapeara errores por el catálogo perdía los fallos de seguridad y el servidor heredado los
 * degradaba a 500.
 *
 * Estas pruebas recorren el FUENTE: si alguien lanza un código nuevo sin catalogarlo, o añade un status
 * sin código, o mete un código de seguridad con 5xx, falla aquí.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  FAIL_CLOSED_CODES, HTTP_STATUS, LEGACY_HTTP_OVERRIDES, RAG_CODES, RAG_CODE_SET, SECURITY_CODES,
  RagError, httpStatusFor, isCataloguedCode, isSecurityCode,
} from '../lib/errors.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sources = [];
for (const dir of ['lib', 'bin']) {
  for (const name of readdirSync(join(root, dir))) if (name.endsWith('.mjs')) sources.push(join(dir, name));
}
sources.push('index.js');

const read = (rel) => readFileSync(join(root, rel), 'utf8');

/** Códigos lanzados con literal en todo el fuente. */
function literalCodes() {
  const found = new Map();
  for (const rel of sources) {
    for (const match of read(rel).matchAll(/new RagError\(\s*'([a-z-]+)'/g)) {
      if (!found.has(match[1])) found.set(match[1], rel);
    }
  }
  return found;
}

/**
 * Sitios dinámicos declarados: `new RagError(code, …)` donde el código viene de una tabla o parámetro.
 * Se enumeran explícitamente para que la exhaustividad no se quede en «los literales».
 */
const DYNAMIC_SITES = Object.freeze([
  {
    file: 'lib/registry.mjs',
    reason: 'verdict.code de roots-structure',
    codes: ['invalid-argument', 'root-overlap'],
    source: 'lib/roots-structure.mjs',
  },
  {
    file: 'lib/resolve.mjs',
    reason: 'deny({code}) de la resolución de ámbito',
    codes: ['scope-unresolved', 'scope-forbidden', 'scope-ambiguous', 'scope-conflict', 'session-invalid', 'session-expired'],
    source: 'lib/resolve.mjs',
  },
  {
    file: 'lib/tools.mjs',
    reason: 'deniedCode de requireApproval',
    codes: ['approval-required', 'egress-denied'],
    source: 'lib/tools.mjs',
  },
]);

test('todo código lanzado con literal está en el catálogo', () => {
  const missing = [...literalCodes()].filter(([code]) => !isCataloguedCode(code)).map(([code, file]) => `${code} (${file})`);
  assert.deepEqual(missing, [], `códigos lanzados y no catalogados: ${missing.join(', ')}`);
});

test('los sitios dinámicos lanzan sólo códigos catalogados, y sus codes están en el fuente', () => {
  for (const site of DYNAMIC_SITES) {
    for (const code of site.codes) {
      assert.equal(isCataloguedCode(code), true, `${site.file} (${site.reason}) lanza «${code}» y no está catalogado`);
    }
    // El fuente debe contener esos códigos donde se declaran: si alguien añade otro a la tabla y no lo
    // pone en esta prueba, la comprobación deja de cubrirlo.
    const text = read(site.source);
    for (const code of site.codes) {
      if (site.source === 'lib/tools.mjs') continue; // el default y el argumento se declaran en llamadas
      assert.match(text, new RegExp(`code: '${code}'`), `«${code}» no aparece como code: en ${site.source}`);
    }
  }
});

test('catálogo y mapa de status son el mismo conjunto (biyección)', () => {
  const codes = [...RAG_CODES].sort();
  const mapped = Object.keys(HTTP_STATUS).sort();
  assert.deepEqual(mapped, codes, 'sobran o faltan códigos en HTTP_STATUS');
  for (const code of codes) {
    const status = HTTP_STATUS[code];
    assert.equal(Number.isInteger(status), true, `${code} sin status entero`);
    assert.equal(status >= 400 && status <= 599 || status === 499, true, `${code} tiene un status fuera de rango: ${status}`);
  }
  assert.equal(RAG_CODE_SET.size, RAG_CODES.length, 'el catálogo tiene duplicados');
});

test('una decisión de autorización nunca se degrada a 5xx ni a un 4xx de entrada', () => {
  for (const code of SECURITY_CODES) {
    assert.equal(isCataloguedCode(code), true, `${code} es de seguridad y no está catalogado`);
    const status = httpStatusFor(code);
    assert.equal(isSecurityCode(code), true);
    assert.equal(status < 500, true, `${code} (${status}) no puede ser 5xx`);
    assert.equal([400, 404, 413, 415, 422, 429, 499].includes(status), false, `${code} (${status}) no puede disfrazarse de error de entrada`);
  }
  // Los cierres por falta de mecanismo son 503 y tampoco se leen como error del usuario.
  for (const code of FAIL_CLOSED_CODES) {
    assert.equal(isCataloguedCode(code), true, `${code} no está catalogado`);
    assert.equal(httpStatusFor(code), 503, `${code} cierra el servicio con 503`);
    assert.equal(isSecurityCode(code), true, `${code} es de la familia de seguridad (cierre)`);
    assert.equal(httpStatusFor(code, { legacy: true }) === 503 || code in LEGACY_HTTP_OVERRIDES, true);
  }
  // Invariante por status, no por nombre: todo 401/403 del catálogo tiene que estar clasificado como
  // decisión de seguridad. Así no se escapa ninguno por llamarse distinto, y `revision-conflict` (409)
  // no se disfraza de «acceso denegado».
  for (const code of RAG_CODES) {
    const status = httpStatusFor(code);
    if (status === 401 || status === 403) {
      assert.equal(SECURITY_CODES.includes(code), true, `${code} responde ${status} y no está en SECURITY_CODES`);
    }
  }
});

test('las diferencias de la API heredada son explícitas y sólo tocan códigos catalogados', () => {
  for (const [code, status] of Object.entries(LEGACY_HTTP_OVERRIDES)) {
    assert.equal(isCataloguedCode(code), true, `${code} está en las diferencias heredadas y no en el catálogo`);
    assert.equal(httpStatusFor(code, { legacy: true }), status);
    assert.notEqual(httpStatusFor(code, { legacy: true }), httpStatusFor(code), 'una diferencia que no cambia nada es ruido');
  }
  // Todo lo demás es idéntico en las dos APIs.
  for (const code of RAG_CODES) {
    if (code in LEGACY_HTTP_OVERRIDES) continue;
    assert.equal(httpStatusFor(code, { legacy: true }), httpStatusFor(code), `${code} difiere sin estar declarado`);
  }
});

test('un código desconocido no se convierte en silencio y no pasa por seguridad', () => {
  const error = new RagError('codigo-inventado', 'mensaje');
  assert.equal(error.code, 'codigo-inventado', 'el código original se conserva');
  assert.equal(error.catalogued, false, 'se marca como no catalogado');
  assert.equal(httpStatusFor('codigo-inventado'), 500, 'lo no clasificado es 500 explícito');
  assert.equal(isSecurityCode('codigo-inventado'), false);
  assert.equal(isCataloguedCode(undefined), false);
});

test('las dos APIs responden con el mapa común (sin tablas locales)', () => {
  // El fuente no puede volver a tener su propia tabla de status.
  for (const rel of ['lib/server.mjs', 'lib/pa-api.mjs']) {
    const text = read(rel);
    assert.equal(/STATUS_BY_CODE/.test(text), false, `${rel} no debe mantener una tabla de status propia`);
    assert.match(text, /httpStatusFor/, `${rel} debe usar httpStatusFor`);
  }
  // Y el mapeo de la API heredada pide explícitamente el perfil legacy.
  assert.match(read('lib/server.mjs'), /httpStatusFor\(error\.code, \{ legacy: true \}\)/);
});

test('los códigos del contrato del panel tienen el status documentado', () => {
  // §7 del contrato PA-UI-0: los que un cliente tiene que distinguir.
  const expected = {
    unauthenticated: 401,
    forbidden: 403,
    'authorization-unavailable': 503,
    'scope-forbidden': 403,
    'scope-ambiguous': 403,
    'scope-unresolved': 409,
    'project-not-authorized': 403,
    'grant-revoked': 403,
    'session-invalid': 401,
    'session-expired': 409,
    'revision-conflict': 409,
    'invalid-argument': 400,
    'too-large': 413,
    'response-too-large': 500,
    'approval-required': 403,
    'store-not-initialized': 503,
    'registry-corrupt': 500,
    'internal': 500,
  };
  for (const [code, status] of Object.entries(expected)) {
    assert.equal(httpStatusFor(code), status, `${code} debe responder ${status}`);
  }
  // La API heredada conserva los suyos.
  assert.equal(httpStatusFor('store-not-initialized', { legacy: true }), 404);
  assert.equal(httpStatusFor('approval-required', { legacy: true }), 409);
});
