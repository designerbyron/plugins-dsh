/**
 * PA4-A: estados de almacén. Una ausencia no es una biblioteca vacía, una corrupción no se abre y
 * una indisponibilidad sí se puede reintentar. Clasificar nunca crea, migra ni repara.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BLOCKING_STATES, LIBRARY_STATES, RETRYABLE_STATES, classifyScopeStore, isServable, libraryStateError,
  storeFileOf, verifyStoreIdentity,
} from '../lib/library-state.mjs';
import { openScopeStore } from '../lib/scope-stores.mjs';
import { openDatabase, readMeta, writeMeta } from '../lib/db.mjs';
import { makeEightWorld } from './pa4-helpers.mjs';

function stateOf(world, scope, extra = {}) {
  return classifyScopeStore({ profileRootPath: world.root, profileKey: 'pa4-test', scope, ...extra });
}

/** Ids de ámbito con la forma del contrato: `lib_` + 26 caracteres Crockford. */
function syntheticId(prefix, seed) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let body = '';
  for (let index = 0; index < 26; index += 1) body += alphabet[(seed + index) % alphabet.length];
  return `${prefix}_${body}`;
}

test('el catálogo de estados es el del contrato y los bloqueantes no son servibles', () => {
  assert.deepEqual([...LIBRARY_STATES], ['present', 'missing', 'unreadable', 'corrupt', 'unavailable', 'recovering', 'recovered']);
  for (const state of BLOCKING_STATES) assert.equal(isServable(state), false);
  assert.equal(isServable('present'), true);
  assert.equal(isServable('recovered'), true);
  for (const state of RETRYABLE_STATES) assert.equal(['unavailable', 'recovering'].includes(state), true);
});

test('present: un almacén sembrado se clasifica servible sin modificarse', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const before = stateOf(world, scope);
    assert.equal(before.state, 'present');
    assert.equal(before.retryable, false);
    assert.ok(before.bytes > 0);
    assert.equal(before.meta.scope_id, scope.id);
    // clasificar no escribe: el fichero no cambia de tamaño ni aparece ningún directorio nuevo
    const again = stateOf(world, scope);
    assert.equal(again.bytes, before.bytes);
  } finally {
    world.cleanup();
  }
});

test('missing: sin directorio y sin fichero no se interpreta como biblioteca vacía', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const file = storeFileOf(world.root, scope.id);
    rmSync(file);
    const withoutFile = stateOf(world, scope);
    assert.equal(withoutFile.state, 'missing');
    assert.equal(withoutFile.reason, 'store-absent');

    rmSync(join(world.root, 'scopes', scope.id), { recursive: true, force: true });
    const withoutDir = stateOf(world, scope);
    assert.equal(withoutDir.state, 'missing');
    assert.equal(withoutDir.reason, 'directory-absent');

    const error = libraryStateError(withoutDir);
    assert.equal(error.code, 'scope-store-unavailable');
    assert.equal(error.details.reason, 'directory-absent');
  } finally {
    world.cleanup();
  }
});

test('corrupt: un fichero que no es SQLite no se abre y no se sobrescribe', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const file = storeFileOf(world.root, scope.id);
    writeFileSync(file, 'esto no es una base de datos', 'utf8');
    const entry = stateOf(world, scope);
    assert.equal(entry.state, 'corrupt');
    assert.equal(entry.retryable, false);
    const error = libraryStateError(entry);
    assert.equal(error.code, 'scope-store-corrupt');
    // Sigue intacto: clasificar no repara ni reemplaza.
    assert.equal(existsSync(file), true);
  } finally {
    world.cleanup();
  }
});

test('unreadable: un almacén que no se puede abrir no se confunde con uno corrupto', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const file = storeFileOf(world.root, scope.id);
    rmSync(file);
    mkdirSync(file);
    const entry = stateOf(world, scope);
    assert.equal(entry.state, 'unreadable');
    assert.equal(libraryStateError(entry).code, 'scope-store-unavailable');
  } finally {
    world.cleanup();
  }
});

test('un enlace en el lugar del almacén se rechaza (no se sigue a ciegas)', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const file = storeFileOf(world.root, scope.id);
    const otherDir = join(world.base, 'almacen-real');
    mkdirSync(otherDir, { recursive: true });
    rmSync(file);
    // En Windows una junction de directorio no necesita privilegios; un symlink de fichero sí.
    symlinkSync(otherDir, file, 'junction');
    const entry = stateOf(world, scope);
    assert.equal(entry.state, 'unreadable');
    assert.equal(entry.reason, 'store-is-link');
  } finally {
    world.cleanup();
  }
});

test('un almacén de otro ámbito se cierra con scope-store-corrupt', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const foreignId = syntheticId('lib', 3);
    mkdirSync(join(world.root, 'scopes', foreignId), { recursive: true });
    copyFileSync(storeFileOf(world.root, scope.id), storeFileOf(world.root, foreignId));
    const foreign = stateOf(world, { kind: 'lib', id: foreignId });
    assert.equal(foreign.state, 'corrupt');
    assert.equal(foreign.reason, 'foreign-scope');

    const wrongKind = stateOf(world, { kind: 'prj', id: scope.id });
    assert.equal(wrongKind.state, 'corrupt');
    assert.equal(wrongKind.reason, 'foreign-kind');
  } finally {
    world.cleanup();
  }
});

test('un almacén de otro perfil se cierra con scope-forbidden al abrirlo', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const db = openScopeStore({ profileRoot: world.root, profileKey: 'pa4-test', scope, create: false });
    try {
      assert.equal(readMeta(db, 'profile_key'), 'pa4-test');
    } finally {
      db.close();
    }
    assert.throws(
      () => openScopeStore({ profileRoot: world.root, profileKey: 'otro-perfil', scope, create: false }),
      (error) => error.code === 'scope-forbidden',
    );
  } finally {
    world.cleanup();
  }
});

test('store_state corrupt y migrating se respetan; recovered es servible', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const opened = openDatabase({ root: join(world.root, 'scopes', scope.id), create: false });
    try {
      writeMeta(opened.db, 'store_state', 'corrupt');
    } finally {
      opened.db.close();
    }
    assert.equal(stateOf(world, scope).state, 'corrupt');

    const reopened = openDatabase({ root: join(world.root, 'scopes', scope.id), create: false });
    try {
      writeMeta(reopened.db, 'store_state', 'migrating');
    } finally {
      reopened.db.close();
    }
    const migrating = stateOf(world, scope);
    assert.equal(migrating.state, 'unavailable');
    assert.equal(migrating.retryable, true);

    const recovered = openDatabase({ root: join(world.root, 'scopes', scope.id), create: false });
    try {
      writeMeta(recovered.db, 'store_state', 'recovered');
    } finally {
      recovered.db.close();
    }
    assert.equal(stateOf(world, scope).state, 'recovered');
    assert.equal(isServable('recovered'), true);
  } finally {
    world.cleanup();
  }
});

test('verifyStoreIdentity exige el ámbito y rechaza identidad incompleta', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const opened = openDatabase({ root: join(world.root, 'scopes', scope.id), create: false });
    try {
      assert.equal(verifyStoreIdentity(opened.db, { scope, profileKey: 'pa4-test' }).ok, true);
      const missing = verifyStoreIdentity(opened.db, { scope: { kind: 'lib', id: 'lib_0' }, profileKey: 'pa4-test' });
      assert.equal(missing.ok, false);
      assert.equal(missing.reason, 'foreign-scope');
    } finally {
      opened.db.close();
    }
  } finally {
    world.cleanup();
  }
});
