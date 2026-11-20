/**
 * Embeddings locales deterministas (`local-hash-v1`).
 *
 * Esto es **hashing léxico con signo**, no un modelo neuronal. Sirve para recuperación por similitud
 * aproximada de vocabulario y para que el sistema funcione sin red ni credenciales; no captura
 * sinonimia ni paráfrasis. La documentación y los benchmarks deben decirlo así (P1.6 del plan v2).
 *
 * Garantías: mismo texto → mismo vector, en cualquier máquina y ejecución; vector L2-normalizado;
 * dimensión fija y declarada en `meta.embedding_model` / `vectors.model`.
 */

import { createHash } from 'node:crypto';

import { RagError } from './errors.mjs';

export const LOCAL_PROVIDER = 'local-hash-v1';
export const DEFAULT_DIM = 256;
export const SUPPORTED_PROVIDERS = Object.freeze([LOCAL_PROVIDER]);

/** Tokens Unicode (letras/números) en minúsculas. Sin stemming: el corpus se indexa tal cual. */
export function tokenize(text) {
  return String(text).normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function hashPair(value) {
  const digest = createHash('sha256').update(value, 'utf8').digest();
  return { bucket: digest.readUInt32LE(0), sign: (digest[4] & 1) === 0 ? 1 : -1 };
}

/**
 * Vector de un texto.
 * @param {string} text
 * @param {{dim?:number, provider?:string}} options
 * @returns {Float32Array}
 */
export function embedText(text, options = {}) {
  const provider = options.provider ?? LOCAL_PROVIDER;
  const dim = options.dim ?? DEFAULT_DIM;
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new RagError('invalid-config', `proveedor de embeddings no soportado: ${provider}`);
  }
  if (!Number.isInteger(dim) || dim < 32 || dim > 4_096) {
    throw new RagError('invalid-config', `dimensión de embedding inválida: ${dim}`);
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new RagError('invalid-argument', 'no se puede embeber un texto vacío');
  }

  const tokens = tokenize(text);
  if (tokens.length === 0) throw new RagError('invalid-argument', 'el texto no contiene tokens');

  const vector = new Float32Array(dim);
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const [token, count] of counts) {
    const { bucket, sign } = hashPair(token);
    vector[bucket % dim] += sign * (1 + Math.log1p(count));
  }
  // Bigramas con medio peso: dan algo de orden sin convertirlo en un modelo de frases.
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const { bucket, sign } = hashPair(`${tokens[i]} ${tokens[i + 1]}`);
    vector[bucket % dim] += sign * 0.5;
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i += 1) vector[i] /= norm;
  return vector;
}

/** Producto escalar de dos vectores normalizados = similitud coseno. */
export function cosine(a, b) {
  if (a.length !== b.length) throw new RagError('internal', 'vectores de dimensión distinta');
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

/** `Float32Array` → BLOB (copia little-endian del buffer). */
export function vectorToBlob(vector) {
  if (!(vector instanceof Float32Array)) throw new RagError('internal', 'vectorToBlob espera Float32Array');
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

/** BLOB → `Float32Array`; un tamaño que no sea múltiplo de 4 es corrupción. */
export function blobToVector(blob, { dim } = {}) {
  if (!(blob instanceof Uint8Array)) throw new RagError('store-corrupt', 'vector almacenado con tipo inválido');
  if (blob.byteLength % 4 !== 0) throw new RagError('store-corrupt', 'vector almacenado con longitud inválida');
  const copy = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  const vector = new Float32Array(copy);
  if (dim !== undefined && vector.length !== dim) {
    throw new RagError('store-corrupt', `vector de dimensión ${vector.length}, se esperaba ${dim}`);
  }
  return vector;
}
