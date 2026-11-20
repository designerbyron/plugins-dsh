/**
 * LE-RAG-01 · Resolución de configuración (perfil > global > defaults).
 * Todo en cajas temporales: nunca toca el home real.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  configFilePaths, mergeLayers, readConfigLayer, resolveConfig,
} from '../lib/config-resolve.mjs';

function box() {
  const root = mkdtempSync(join(tmpdir(), 'lcr-config-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeProfile(root, key, data) {
  const dir = join(root, 'profiles', key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(data), 'utf8');
}

function writeGlobal(root, data) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'config.json'), JSON.stringify(data), 'utf8');
}

test('sin ficheros: defaults y fuentes vacías', () => {
  const b = box();
  try {
    const r = resolveConfig({ dataRoot: b.root, profileKey: 'p1' });
    assert.equal(r.config.search.diversity, 'fragment');
    assert.equal(r.config.search.limit, 8);
    assert.deepEqual(r.sources, { global: false, profile: false });
    assert.equal(r.paths.global, join(b.root, 'config.json'));
    assert.equal(r.paths.profile, join(b.root, 'profiles', 'p1', 'config.json'));
  } finally { b.cleanup(); }
});

test('sólo global: se aplica a cualquier perfil', () => {
  const b = box();
  try {
    writeGlobal(b.root, { search: { diversity: 'source', limit: 20 } });
    const r = resolveConfig({ dataRoot: b.root, profileKey: 'p1' });
    assert.equal(r.config.search.diversity, 'source');
    assert.equal(r.config.search.limit, 20);
    assert.deepEqual(r.sources, { global: true, profile: false });
  } finally { b.cleanup(); }
});

test('precedencia por clave: el perfil gana sólo donde define', () => {
  const b = box();
  try {
    writeGlobal(b.root, { search: { diversity: 'source', limit: 20 }, context: { budgetTokens: 3000 } });
    writeProfile(b.root, 'p1', { search: { limit: 5 } });
    const r = resolveConfig({ dataRoot: b.root, profileKey: 'p1' });
    assert.equal(r.config.search.limit, 5, 'perfil gana');
    assert.equal(r.config.search.diversity, 'source', 'global se conserva donde el perfil no define');
    assert.equal(r.config.context.budgetTokens, 3000, 'sección no tocada por el perfil');
    assert.deepEqual(r.sources, { global: true, profile: true });
  } finally { b.cleanup(); }
});

test('aislamiento: dos perfiles no comparten configuración de perfil', () => {
  const b = box();
  try {
    writeGlobal(b.root, { search: { limit: 20 } });
    writeProfile(b.root, 'a', { search: { diversity: 'source' } });
    writeProfile(b.root, 'b', { search: { diversity: 'fragment' } });
    assert.equal(resolveConfig({ dataRoot: b.root, profileKey: 'a' }).config.search.diversity, 'source');
    assert.equal(resolveConfig({ dataRoot: b.root, profileKey: 'b' }).config.search.diversity, 'fragment');
  } finally { b.cleanup(); }
});

test('fichero inválido: falla en cerrado y nombra el fichero', () => {
  const b = box();
  try {
    writeProfile(b.root, 'p1', { search: { diversity: 'document' } });
    assert.throws(
      () => resolveConfig({ dataRoot: b.root, profileKey: 'p1' }),
      (error) => error.code === 'invalid-config'
        && error.details?.profile?.endsWith(join('profiles', 'p1', 'config.json'))
        && /diversity/.test(error.message),
    );

    const dir = join(b.root, 'profiles', 'p2');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), '{ roto', 'utf8');
    assert.throws(
      () => resolveConfig({ dataRoot: b.root, profileKey: 'p2' }),
      (error) => error.code === 'invalid-config' && /JSON/.test(error.message),
    );
  } finally { b.cleanup(); }
});

test('clave desconocida en el perfil: invalid-config (sin fallback silencioso)', () => {
  const b = box();
  try {
    writeProfile(b.root, 'p1', { search: { desconocida: 1 } });
    assert.throws(() => resolveConfig({ dataRoot: b.root, profileKey: 'p1' }), (e) => e.code === 'invalid-config');
  } finally { b.cleanup(); }
});

test('mergeLayers y readConfigLayer', () => {
  assert.deepEqual(mergeLayers({ a: 1, b: { x: 1 } }, { b: { y: 2 } }), { a: 1, b: { x: 1, y: 2 } });
  assert.deepEqual(mergeLayers(null, undefined, { a: 1 }), { a: 1 });
  const b = box();
  try {
    assert.deepEqual(readConfigLayer(join(b.root, 'nada.json')), { path: join(b.root, 'nada.json'), exists: false, value: null });
    assert.throws(() => configFilePaths({ dataRoot: b.root }), (e) => e.code === 'invalid-config');
  } finally { b.cleanup(); }
});
