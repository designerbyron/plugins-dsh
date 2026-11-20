/**
 * Errores del núcleo de LifeCode RAG.
 *
 * Todo fallo esperable se lanza como `RagError` con un `code` estable: el adaptador lo traduce a un
 * resultado de herramienta con `isError: true` y un mensaje accionable, sin trazas ni rutas internas.
 * Un error sin `code` es un defecto del programa, no una condición del almacén, y también se cierra.
 */

/** Códigos públicos. Añadir uno es un cambio de contrato: va documentado y con prueba. */
export const RAG_CODES = Object.freeze([
  'invalid-argument',
  'invalid-config',
  'invalid-tag',
  'store-not-initialized',
  'store-not-rag',
  'store-version-unsupported',
  'store-busy',
  'store-corrupt',
  'fts-integrity',
  'source-not-found',
  'source-unreadable',
  'path-outside-root',
  'path-denied',
  'path-not-allowed',
  'path-protected',
  'path-unsupported',
  'root-symlink',
  'root-changed',
  'recovery-verification-failed',
  'operation-uncertain',
  'too-large',
  'response-too-large',
  'too-many-files',
  'binary-file',
  'approval-required',
  'approval-unavailable',
  'egress-denied',
  'embedding-failed',
  'cancelled',
  'internal',
]);

export class RagError extends Error {
  /**
   * @param {string} code uno de `RAG_CODES`
   * @param {string} message mensaje accionable, sin datos sensibles
   * @param {object} [options]
   * @param {Record<string, unknown>} [options.details] datos mínimos para diagnosticar
   * @param {Error} [options.cause]
   */
  constructor(code, message, { details = {}, cause } = {}) {
    super(message, { cause });
    this.name = 'RagError';
    this.code = code;
    this.details = details;
  }
}

/** `true` si el error es una condición prevista del almacén, no un defecto del programa. */
export function isRagError(error) {
  return error instanceof RagError;
}
