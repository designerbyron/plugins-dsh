/**
 * Rutas, configuración y cajas: lo que decide dónde vive el almacén y qué límites acepta.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { RagError } from '../lib/errors.mjs';
import {
  DEFAULT_CONFIG,
  isWithin,
  loadConfig,
  ragRoot,
  storePaths,
  validateConfig,
} from '../lib/paths.mjs';
import { contentDigest, sha256Hex } from '../lib/hash.mjs';
import { tempRoot } from './helpers.mjs';

test('la raíz es propia y absoluta: LIFECODE_RAG_ROOT manda', () => {
  assert.equal(ragRoot({ LIFECODE_RAG_ROOT: 'C:\\datos\\rag', DSH_HOME: 'C:\\otro' }), 'C:\\datos\\rag');
  assert.equal(ragRoot({ DSH_HOME: 'C:\\Users\\demo\\.dsh' }), join('C:\\Users\\demo\\.dsh', 'lifecode-rag'));
  // Relativa: se rechaza en vez de depender del cwd de cada sesión.
  assert.throws(() => ragRoot({ LIFECODE_RAG_ROOT: 'datos/rag' }), (error) => error instanceof RagError && error.code === 'invalid-config');
  assert.throws(() => ragRoot({ LIFECODE_RAG_ROOT: '   ' }), (error) => error.code === 'invalid-config');
});

test('storePaths deriva del root y no crea nada', () => {
  const { root, cleanup } = tempRoot();
  try {
    const paths = storePaths(root);
    assert.equal(paths.database, join(root, 'rag.sqlite3'));
    assert.equal(paths.audit, join(root, 'audit.jsonl'));
    assert.equal(paths.backups, join(root, 'backups'));
    assert.equal(paths.config, join(root, 'config.json'));
  } finally {
    cleanup();
  }
});

test('isWithin no confunde prefijos ni mayúsculas de Windows', () => {
  assert.equal(isWithin('C:\\X', 'C:\\X\\y', 'win32'), true);
  assert.equal(isWithin('C:\\X', 'c:\\x\\y', 'win32'), true);
  assert.equal(isWithin('C:\\X', 'C:\\XY', 'win32'), false);
  assert.equal(isWithin('C:\\X', 'C:\\X\\..\\Y', 'win32'), false);
  assert.equal(isWithin('/srv/rag', '/srv/rag/a', 'linux'), true);
  assert.equal(isWithin('/srv/rag', '/srv/ragx', 'linux'), false);
});

test('la configuración por defecto es válida y queda congelada', () => {
  const config = validateConfig({});
  assert.equal(config.context.budgetTokens, 2000);
  assert.equal(config.embedding.provider, 'local-hash-v1');
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(DEFAULT_CONFIG.chunk), true);
});

test('una clave desconocida o un límite fuera de rango no pasan en silencio', () => {
  assert.throws(() => validateConfig({ limite: 1 }), (error) => error.code === 'invalid-config');
  assert.throws(() => validateConfig({ maxFileBytes: -1 }), (error) => error.code === 'invalid-config');
  assert.throws(() => validateConfig({ chunk: { targetChars: 9000 } }), (error) => error.code === 'invalid-config');
  assert.throws(() => validateConfig({ context: { mmrLambda: 1.5 } }), (error) => error.code === 'invalid-config');
  assert.throws(() => validateConfig({ embedding: { provider: 'remoto' } }), (error) => error.code === 'invalid-config');
  assert.throws(() => validateConfig({ audit: { exportJsonl: 'sí' } }), (error) => error.code === 'invalid-config');
});

test('loadConfig: ausente son defaults; inválido es fail closed', () => {
  const { root, cleanup } = tempRoot();
  try {
    const absent = loadConfig(root);
    assert.equal(absent.source, 'defaults');
    assert.equal(absent.config.search.limit, 8);

    writeFileSync(join(root, 'config.json'), JSON.stringify({ search: { limit: 3 } }), 'utf8');    const loaded = loadConfig(root);
    assert.equal(loaded.source, 'file');
    assert.equal(loaded.config.search.limit, 3);

    writeFileSync(join(root, 'config.json'), '{ roto', 'utf8');
    assert.throws(() => loadConfig(root), (error) => error.code === 'invalid-config');
  } finally {
    cleanup();
  }
});

test('el hash normaliza saltos de línea y distingue contenidos', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(contentDigest('a\r\nb\n'), contentDigest('a\nb\n'));
  assert.notEqual(contentDigest('alfa'), contentDigest('beta'));
  assert.throws(() => sha256Hex(42), TypeError);
});
