/**
 * Embeddings locales: determinismo, normalización y contrato de almacenamiento.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { blobToVector, cosine, embedText, LOCAL_PROVIDER, tokenize, vectorToBlob } from '../lib/embed.mjs';
import { RagError } from '../lib/errors.mjs';

test('el mismo texto produce el mismo vector, siempre', () => {
  const a = embedText('LifeCode RAG indexa conocimiento local');
  const b = embedText('LifeCode RAG indexa conocimiento local');
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.equal(a.length, 256);
});

test('el vector está normalizado y la similitud consigo mismo es 1', () => {
  const vector = embedText('proyecto documentación decisiones anteriores');
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(norm - 1) < 1e-5);
  assert.ok(Math.abs(cosine(vector, vector) - 1) < 1e-5);
});

test('textos distintos no colisionan en el mismo vector y el orden de tokens influye', () => {
  const base = embedText('base de datos local');
  const other = embedText('servidor remoto en la nube');
  assert.ok(cosine(base, other) < 0.9);
  assert.notDeepEqual(Array.from(embedText('gato come pescado')), Array.from(embedText('pescado come gato')));
});

test('tokenize conserva letras acentuadas y números', () => {
  assert.deepEqual(tokenize('Niño, año 2026 — RAG'), ['niño', 'año', '2026', 'rag']);
});

test('un texto vacío o sin tokens es un error de argumento, no un vector cero', () => {
  assert.throws(() => embedText(''), (error) => error instanceof RagError && error.code === 'invalid-argument');
  assert.throws(() => embedText('... --- ...'), (error) => error.code === 'invalid-argument');
});

test('un proveedor no soportado se rechaza', () => {
  assert.throws(() => embedText('hola', { provider: 'remoto' }), (error) => error.code === 'invalid-config');
  assert.equal(LOCAL_PROVIDER, 'local-hash-v1');
});

test('BLOB de ida y vuelta conserva los valores', () => {
  const vector = embedText('vector de prueba');
  const blob = vectorToBlob(vector);
  assert.ok(blob instanceof Uint8Array);
  assert.equal(blob.byteLength, 256 * 4);
  const back = blobToVector(blob, { dim: 256 });
  assert.deepEqual(Array.from(back), Array.from(vector));
  assert.throws(() => blobToVector(new Uint8Array(3)), (error) => error.code === 'store-corrupt');
  assert.throws(() => blobToVector(blob, { dim: 128 }), (error) => error.code === 'store-corrupt');
});
