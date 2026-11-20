/**
 * Política de rutas: exclusión incondicional del Skill Center y rechazo de alias.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { classifyPath, isProtectedPath } from '../lib/policy.mjs';
import { tempRoot } from './helpers.mjs';

function file(dir, name, body = 'contenido') {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
  return path;
}

test('isProtectedPath reconoce el segmento en cualquier posición y mayúsculas', () => {
  assert.equal(isProtectedPath('C:\\x\\lifecode-skill-center\\a.md'), true);
  assert.equal(isProtectedPath('C:/x/LifeCode-Skill-Center/a.md'), true);
  assert.equal(isProtectedPath('C:\\x\\lifecode-skill-center-copia\\a.md'), false);
  assert.equal(isProtectedPath('C:\\x\\skill-center\\a.md'), false);
});

test('una ruta dentro del proyecto no necesita aprobación', () => {
  const box = tempRoot('rag-policy');
  try {
    const cwd = join(box.root, 'proyecto');
    const path = file(cwd, 'docs/a.md');
    const result = classifyPath('docs/a.md', { cwd });
    assert.equal(result.outsideRoots, false);
    assert.equal(result.realPath, path);
  } finally {
    box.cleanup();
  }
});

test('una ruta fuera del proyecto se marca, no se bloquea por sí sola', () => {
  const box = tempRoot('rag-policy');
  try {
    const cwd = join(box.root, 'proyecto');
    mkdirSync(cwd, { recursive: true });
    const outside = file(join(box.root, 'otro'), 'b.md');
    assert.equal(classifyPath(outside, { cwd }).outsideRoots, true);
    assert.equal(classifyPath(outside, { cwd, roots: [join(box.root, 'otro')] }).outsideRoots, false);
  } finally {
    box.cleanup();
  }
});

test('el Skill Center se rechaza aunque esté dentro del proyecto y sin leer su contenido', () => {
  const box = tempRoot('rag-policy');
  try {
    const cwd = join(box.root, 'proyecto');
    const path = file(join(cwd, 'lifecode-skill-center'), 'x.md', 'secreto');
    assert.throws(() => classifyPath(path, { cwd }), (error) => error.code === 'path-denied');
  } finally {
    box.cleanup();
  }
});

test('el propio almacén de RAG no es ingerible', () => {
  const box = tempRoot('rag-policy');
  try {
    const cwd = join(box.root, 'proyecto');
    const store = join(box.root, 'almacen');
    const path = file(join(store, 'docs'), 'a.md');
    assert.throws(() => classifyPath(path, { cwd, ragRootPath: store }), (error) => error.code === 'path-denied');
  } finally {
    box.cleanup();
  }
});

test('un enlace duro se rechaza (A8)', () => {
  const box = tempRoot('rag-policy');
  try {
    const cwd = join(box.root, 'proyecto');
    const original = file(cwd, 'a.md');
    const alias = join(cwd, 'alias.md');
    linkSync(original, alias);
    assert.throws(() => classifyPath(alias, { cwd }), (error) => error.code === 'hardlink-refused');
  } finally {
    box.cleanup();
  }
});

test('una junction de Windows hacia una ruta protegida se resuelve y se rechaza', (t) => {
  const box = tempRoot('rag-policy');
  try {
    const cwd = join(box.root, 'proyecto');
    const target = join(box.root, 'lifecode-skill-center');
    mkdirSync(target, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const link = join(cwd, 'acceso');
    try {
      symlinkSync(target, link, 'junction');
    } catch (error) {
      t.skip(`no se pudo crear la junction: ${error.code}`);
      return;
    }
    file(target, 'x.md', 'secreto');
    assert.throws(() => classifyPath(link, { cwd }), (error) => error.code === 'path-escape');
  } finally {
    box.cleanup();
  }
});

test('una ruta inexistente no se confunde con un permiso', () => {
  const box = tempRoot('rag-policy');
  try {
    const cwd = join(box.root, 'proyecto');
    mkdirSync(cwd, { recursive: true });
    assert.throws(() => classifyPath(join(cwd, 'no-existe.md'), { cwd }), (error) => error.code === 'source-unreadable');
  } finally {
    box.cleanup();
  }
});
