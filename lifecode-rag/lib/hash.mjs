/**
 * Hashes de contenido de LifeCode RAG.
 *
 * El hash es la identidad del texto normalizado: dos ingestas del mismo documento no deben reindexar
 * si el hash coincide. Se calcula sobre UTF-8 con `node:crypto`; no hay dependencias.
 */

import { createHash } from 'node:crypto';

/** SHA-256 en hexadecimal minúscula de un `Buffer`, `Uint8Array` o cadena UTF-8. */
export function sha256Hex(value) {
  const hash = createHash('sha256');
  if (typeof value === 'string') hash.update(value, 'utf8');
  else if (value instanceof Uint8Array) hash.update(value);
  else throw new TypeError('sha256Hex espera string o Uint8Array');
  return hash.digest('hex');
}

/**
 * Huella de una fuente para decidir reutilización: normaliza saltos de línea (CRLF/CR → LF) y recorta el
 * final. El texto que se indexa ya pasó por la extracción; aquí sólo se evita que un cambio de saltos
 * de línea cuente como contenido distinto.
 */
export function contentDigest(text) {
  if (typeof text !== 'string') throw new TypeError('contentDigest espera string');
  return sha256Hex(text.replace(/\r\n?/g, '\n').replace(/\n+$/u, '\n'));
}

/** Identificador estable de un chunk dentro de su fuente: `<source_id>#<ordinal>`. */
export function chunkKey(sourceId, ordinal) {
  if (typeof sourceId !== 'string' || sourceId === '') throw new TypeError('sourceId vacío');
  if (!Number.isInteger(ordinal) || ordinal < 0) throw new TypeError('ordinal inválido');
  return `${sourceId}#${ordinal}`;
}
