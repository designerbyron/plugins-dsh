/**
 * PA4-D: protección estructural de raíces.
 *
 * Lo que se prueba es lo que el sistema operativo y Node permiten medir: duplicados, solapamiento
 * padre/hijo, normalización de mayúsculas y separadores, traversal, enlaces (junction/symlink),
 * ficheros donde se espera un directorio y cambio de destino después del registro. Lo que no se puede
 * medir con fiabilidad (reparse points de proveedor, hardlinks de directorio) se documenta como límite
 * en el informe PA4 y no se simula.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertRootStructure, assertRootUnchanged, canonicalKey, classifyRootRegistration, inspectRoot, normalizeKey,
  relationOf,
} from '../lib/roots-structure.mjs';
import { addRoot, closeRegistry, createProject, openRegistry, registryIntegrity } from '../lib/registry.mjs';

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), 'pa4-roots-'));
  return { base, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('normaliza separadores y mayúsculas en Windows, y detecta el mismo destino', () => {
  const left = normalizeKey('C:\\Datos\\Proyecto\\');
  const right = normalizeKey('c:/datos/proyecto');
  assert.equal(left, right);
  assert.equal(relationOf(left, right), 'same');
});

test('clasifica el solapamiento padre/hijo en ambos sentidos', () => {
  const parent = normalizeKey('C:\\datos\\proyecto');
  const child = normalizeKey('C:\\datos\\proyecto\\sub');
  assert.equal(relationOf(parent, child), 'left-ancestor');
  assert.equal(relationOf(child, parent), 'left-descendant');
  assert.equal(relationOf(normalizeKey('C:\\datos\\otro'), parent), 'disjoint');
});

test('un duplicado y un solapamiento se rechazan con su código, sin tocar el registro', () => {
  const box = sandbox();
  try {
    const existing = [{ id: 'rt_1', scopeId: 'prj_A', path: 'C:\\datos\\proyecto', pathKey: normalizeKey('C:\\datos\\proyecto') }];
    const duplicate = classifyRootRegistration(
      { path: 'C:\\DATOS\\PROYECTO\\', key: normalizeKey('C:\\datos\\proyecto'), canonical: 'C:\\datos\\proyecto' },
      existing,
    );
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.code, 'invalid-argument');

    const nested = classifyRootRegistration(
      { path: 'C:\\datos\\proyecto\\sub', key: normalizeKey('C:\\datos\\proyecto\\sub'), canonical: 'C:\\datos\\proyecto\\sub' },
      existing,
    );
    assert.equal(nested.ok, false);
    assert.equal(nested.code, 'root-overlap');

    const disjoint = classifyRootRegistration(
      { path: 'C:\\datos\\otro', key: normalizeKey('C:\\datos\\otro'), canonical: 'C:\\datos\\otro' },
      existing,
    );
    assert.equal(disjoint.ok, true);
  } finally {
    box.cleanup();
  }
});

test('traversal: una ruta con `..` se resuelve antes de comparar y delata el solapamiento', () => {
  const box = sandbox();
  try {
    const project = join(box.base, 'proyecto');
    mkdirSync(project, { recursive: true });
    const info = inspectRoot(join(project, 'sub', '..'));
    // `sub` no existe: canonicalKey cae en resolve(), y el resultado es el directorio padre.
    assert.equal(normalizeKey(info.canonical), normalizeKey(project));
    const conflict = classifyRootRegistration(info, [
      { id: 'rt_1', scopeId: 'prj_A', path: project, pathKey: normalizeKey(project) },
    ]);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, 'invalid-argument', 'el destino resuelto coincide con una raíz existente');
  } finally {
    box.cleanup();
  }
});

test('una junction se detecta como enlace y se rechaza con root-symlink', () => {
  const box = sandbox();
  try {
    const target = join(box.base, 'destino');
    const link = join(box.base, 'enlace');
    mkdirSync(target, { recursive: true });
    symlinkSync(target, link, 'junction');
    const info = inspectRoot(link);
    assert.equal(info.isLink, true);
    assert.throws(() => assertRootStructure(info), (error) => error.code === 'root-symlink');
  } finally {
    box.cleanup();
  }
});

test('un fichero donde se espera un directorio y una ruta inexistente fallan con su código', () => {
  const box = sandbox();
  try {
    const file = join(box.base, 'fichero.txt');
    writeFileSync(file, 'hola', 'utf8');
    assert.throws(() => assertRootStructure(inspectRoot(file)), (error) => error.code === 'invalid-argument');
    assert.throws(() => inspectRoot(join(box.base, 'no-existe')), (error) => error.code === 'source-unreadable');
  } finally {
    box.cleanup();
  }
});

test('el destino no puede cambiar después del registro', () => {
  const box = sandbox();
  try {
    const root = join(box.base, 'proyecto');
    const other = join(box.base, 'otro');
    mkdirSync(root, { recursive: true });
    mkdirSync(other, { recursive: true });
    const before = inspectRoot(root);
    const registered = { path: root, path_key: before.key };
    assert.equal(assertRootUnchanged(registered).key, before.key);
    // Se sustituye el directorio registrado por una junction al otro sitio.
    rmSync(root, { recursive: true, force: true });
    symlinkSync(other, root, 'junction');
    assert.throws(() => assertRootUnchanged(registered), (error) => error.code === 'root-changed');
  } finally {
    box.cleanup();
  }
});

test('addRoot rechaza duplicados y solapamientos y deja el registro sin raíces', () => {
  const box = sandbox();
  try {
    const root = join(box.base, 'perfil');
    const project = join(box.base, 'proyecto');
    const nested = join(project, 'anidado');
    mkdirSync(project, { recursive: true });
    mkdirSync(nested, { recursive: true });
    const registry = openRegistry({ root, create: true });
    try {
      const scope = createProject(registry.db, { name: 'Proyecto' });
      addRoot(registry.db, { scopeKind: 'prj', scopeId: scope.id, path: project, addedBy: 'human' });
      assert.throws(
        () => addRoot(registry.db, { scopeKind: 'prj', scopeId: scope.id, path: nested, addedBy: 'human' }),
        (error) => error.code === 'root-overlap',
      );
      assert.throws(
        () => addRoot(registry.db, { scopeKind: 'prj', scopeId: scope.id, path: project.toUpperCase(), addedBy: 'human' }),
        (error) => error.code === 'invalid-argument',
      );
      assert.equal(registry.db.prepare('SELECT COUNT(*) AS n FROM roots').get().n, 1);
    } finally {
      closeRegistry(registry.db);
    }
  } finally {
    box.cleanup();
  }
});

test('registryIntegrity señala solapamientos heredados de un registro anterior a PA4', () => {
  const box = sandbox();
  try {
    const root = join(box.base, 'perfil');
    const project = join(box.base, 'proyecto');
    const nested = join(project, 'anidado');
    mkdirSync(nested, { recursive: true });
    const registry = openRegistry({ root, create: true });
    try {
      const scope = createProject(registry.db, { name: 'Proyecto' });
      // Simula un registro escrito por PA1/PA2, cuando el solapamiento no se validaba.
      const insert = registry.db.prepare(
        `INSERT INTO roots (id, scope_kind, scope_id, path, path_key, added_by, added_at, state)
         VALUES (?, 'prj', ?, ?, ?, 'human', '2026-01-01T00:00:00.000Z', 'authorized')`,
      );
      insert.run('rt_0123456789ABCDEFGHJKMNPQRS', scope.id, project, normalizeKey(project));
      insert.run('rt_0123456789ABCDEFGHJKMNPQRT', scope.id, nested, normalizeKey(nested));
      const integrity = registryIntegrity(registry.db);
      assert.equal(integrity.roots, 2);
      assert.equal(integrity.rootConflicts.length, 1, 'el solapamiento se detecta');
      assert.equal(integrity.rootConflicts[0].relation, 'left-ancestor');
    } finally {
      closeRegistry(registry.db);
    }
  } finally {
    box.cleanup();
  }
});

test('canonicalKey resuelve enlaces y no inventa mayúsculas distintas', () => {
  const box = sandbox();
  try {
    const target = join(box.base, 'destino');
    const link = join(box.base, 'enlace');
    mkdirSync(target, { recursive: true });
    symlinkSync(target, link, 'junction');
    assert.equal(normalizeKey(canonicalKey(link)), normalizeKey(canonicalKey(target)));
  } finally {
    box.cleanup();
  }
});
