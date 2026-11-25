/**
 * Errores del núcleo de LifeCode RAG.
 *
 * Todo fallo esperable se lanza como `RagError` con un `code` estable: el adaptador lo traduce a un
 * resultado de herramienta con `isError: true` y un mensaje accionable, sin trazas ni rutas internas.
 * Un error sin `code` es un defecto del programa, no una condición del almacén, y también se cierra.
 */

/**
 * Códigos públicos. Añadir uno es un cambio de contrato: va documentado y con prueba.
 *
 * Hasta ACP-02 esta lista se presentaba como cerrada pero le faltaban 18 códigos que el código lanza de
 * verdad (entre ellos los de autorización); ahora está completa y `tests/error-codes.test.mjs` recorre el
 * fuente para que no vuelva a desincronizarse.
 */
export const RAG_CODES = Object.freeze([
  // entrada / validación
  'invalid-argument',
  'invalid-config',
  'invalid-tag',
  'sequence-conflict',
  // almacén y esquema
  'store-not-initialized',
  'store-not-rag',
  'store-version-unsupported',
  'store-migration-required',
  'store-busy',
  'store-corrupt',
  'fts-integrity',
  'vector-index-incomplete',
  'recovery-verification-failed',
  'operation-uncertain',
  // fuentes y rutas
  'source-not-found',
  'project-not-found',
  'not-found',
  'source-unreadable',
  'path-outside-root',
  'path-denied',
  'path-not-allowed',
  'path-protected',
  'path-unsupported',
  'path-escape',
  'hardlink-refused',
  'root-symlink',
  'root-changed',
  'root-overlap',
  'sync-root-unavailable',
  // límites
  'too-large',
  'response-too-large',
  'too-many-files',
  'binary-file',
  // aprobación y autorización
  'approval-required',
  'approval-unavailable',
  'unauthenticated',
  'forbidden',
  'authorization-unavailable',
  'session-invalid',
  'session-expired',
  'scope-forbidden',
  'scope-unresolved',
  'scope-ambiguous',
  'scope-conflict',
  'scope-too-many',
  'grant-revoked',
  'project-not-authorized',
  'revision-conflict',
  // registro Project-Aware
  'registry-corrupt',
  'registry-unavailable',
  'registry-migration-conflict',
  'scope-store-corrupt',
  'scope-store-unavailable',
  // ciclo de vida de la memoria (R1.2)
  'provisioning-failed',
  'memory-exclusive',
  'move-conflict',
  'move-failed',
  'sync-in-progress',
  'revocation-not-proven',
  'workspace-missing',
  // embeddings y red
  'egress-denied',
  'embedding-failed',
  // control
  'cancelled',
  'internal',
]);

/** Conjunto para consultas O(1) y para las pruebas de exhaustividad. */
export const RAG_CODE_SET = Object.freeze(new Set(RAG_CODES));

/** `true` si el código está en el catálogo público. */
export function isCataloguedCode(code) {
  return RAG_CODE_SET.has(code);
}

/**
 * Status HTTP de cada código. **Un solo mapa**: las dos APIs del plugin lo usan en vez de mantener su
 * propia tabla, para que un código de seguridad no acabe en `500` por olvido.
 */
export const HTTP_STATUS = Object.freeze({
  'invalid-argument': 400,
  'invalid-config': 400,
  'invalid-tag': 400,
  'sequence-conflict': 409,
  'store-not-initialized': 503,
  'store-not-rag': 409,
  'store-version-unsupported': 409,
  'store-migration-required': 409,
  'store-busy': 503,
  'store-corrupt': 500,
  'fts-integrity': 500,
  'vector-index-incomplete': 500,
  'recovery-verification-failed': 500,
  'operation-uncertain': 409,
  'source-not-found': 404,
  'project-not-found': 404,
  'not-found': 404,
  'source-unreadable': 422,
  'path-outside-root': 409,
  'path-denied': 403,
  'path-not-allowed': 403,
  'path-protected': 403,
  'path-unsupported': 415,
  'path-escape': 403,
  'hardlink-refused': 403,
  'root-symlink': 409,
  'root-changed': 409,
  'root-overlap': 409,
  'sync-root-unavailable': 503,
  'too-large': 413,
  'response-too-large': 500,
  'too-many-files': 413,
  'binary-file': 415,
  'approval-required': 403,
  'approval-unavailable': 503,
  unauthenticated: 401,
  forbidden: 403,
  'authorization-unavailable': 503,
  'session-invalid': 401,
  'session-expired': 409,
  'scope-forbidden': 403,
  'scope-unresolved': 409,
  'scope-ambiguous': 403,
  'scope-conflict': 409,
  'scope-too-many': 409,
  'grant-revoked': 403,
  'project-not-authorized': 403,
  'revision-conflict': 409,
  'registry-corrupt': 500,
  'registry-unavailable': 503,
  'registry-migration-conflict': 409,
  'scope-store-corrupt': 500,
  'scope-store-unavailable': 503,
  // ciclo de vida de la memoria (R1.2): un fallo recuperable de provisión no es un 500
  'provisioning-failed': 422,
  'memory-exclusive': 409,
  'move-conflict': 409,
  'move-failed': 422,
  'sync-in-progress': 409,
  'revocation-not-proven': 409,
  'workspace-missing': 422,
  'egress-denied': 403,
  'embedding-failed': 502,
  cancelled: 499,
  internal: 500,
});

/**
 * Diferencias documentadas de la API heredada v0.2 (`CONTRATO-v0.1.md`), que no se tocan aquí para no
 * romper su contrato: `store-not-initialized` respondía 404 y la aprobación 409.
 */
export const LEGACY_HTTP_OVERRIDES = Object.freeze({
  'store-not-initialized': 404,
  'approval-required': 409,
  'approval-unavailable': 409,
});

/** Status de un código; `500` sólo para lo no clasificado (nunca para un código de seguridad). */
export function httpStatusFor(code, { legacy = false } = {}) {
  if (legacy && Object.prototype.hasOwnProperty.call(LEGACY_HTTP_OVERRIDES, code)) {
    return LEGACY_HTTP_OVERRIDES[code];
  }
  return Object.prototype.hasOwnProperty.call(HTTP_STATUS, code) ? HTTP_STATUS[code] : 500;
}

/**
 * Decisiones de autorización: un fallo de esta lista se responde con 4xx y **nunca** se degrada a 5xx
 * (un 500 aquí es un fallo de clasificación, no «algo del servidor»).
 */
export const SECURITY_CODES = Object.freeze([
  'approval-required',
  'unauthenticated',
  'forbidden',
  'session-invalid',
  'session-expired',
  'scope-forbidden',
  'scope-unresolved',
  'scope-ambiguous',
  'scope-conflict',
  'scope-too-many',
  'grant-revoked',
  'project-not-authorized',
  'path-denied',
  'path-not-allowed',
  'path-protected',
  'path-escape',
  'hardlink-refused',
  'egress-denied',
]);

/**
 * Cierres por falta de mecanismo, no por una decisión: el host no ofrece compuerta o aprobación, así que
 * la operación se rechaza. Son `503` a propósito —el fallo es del servicio— pero nunca `2xx` ni un 4xx
 * que se lea como error del usuario.
 */
export const FAIL_CLOSED_CODES = Object.freeze([
  'approval-unavailable',
  'authorization-unavailable',
]);

/** `true` si el código pertenece a la familia de autorización/seguridad (decisión o cierre). */
export function isSecurityCode(code) {
  return SECURITY_CODES.includes(code) || FAIL_CLOSED_CODES.includes(code);
}

export class RagError extends Error {
  /**
   * @param {string} code uno de `RAG_CODES`
   * @param {string} message mensaje accionable, sin datos sensibles
   * @param {object} [options]
   * @param {Record<string, unknown>} [options.details] datos mínimos para diagnosticar
   * @param {Error} [options.cause]
   *
   * El código se conserva tal cual: un código no catalogado **no** se convierte en `internal` en
   * silencio (eso degradaría un fallo de seguridad a genérico). `catalogued` lo deja visible y
   * `tests/error-codes.test.mjs` impide que el fuente introduzca uno sin catalogarlo.
   */
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, { cause });
    this.name = 'RagError';
    this.code = code;
    this.details = details;
    this.catalogued = isCataloguedCode(code);
  }
}

/** `true` si el error es una condición prevista del almacén, no un defecto del programa. */
export function isRagError(error) {
  return error instanceof RagError;
}
