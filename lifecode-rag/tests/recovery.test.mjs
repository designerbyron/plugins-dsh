/**
 * PA4-A: recuperación de almacenes de biblioteca. Todo se ejercita sobre fixtures temporales; ningún
 * almacén real se toca. Se comprueba lo que importa: el original sobrevive, la sustitución es
 * verificable, el rollback devuelve el original y una ausencia no se «recupera» creándola.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeDatabase, ftsIntegrityCheck, openDatabase } from '../lib/db.mjs';
import { isServable } from '../lib/library-state.mjs';
import { listSteps } from '../lib/operations.mjs';
import { closeRegistry, openRegistry } from '../lib/registry.mjs';
import {
  digestStore, inspectRecoverableStore, listRecoveryArtifacts, planRecovery, recoverScopeStore,
  rollbackRecovery, scopeHealth,
} from '../lib/recovery.mjs';
import { makeEightWorld, storeFileOf } from './pa4-helpers.mjs';

function withRegistry(world, work) {
  const opened = openRegistry({ root: world.root, create: false });
  try {
    return work(opened.db);
  } finally {
    closeRegistry(opened.db);
  }
}

function garbage(world, scopeId, bytes = 'esto no es una base de datos') {
  const file = storeFileOf(world.root, scopeId);
  writeFileSync(file, bytes, 'utf8');
  return { file, bytes };
}

function markCorrupt(world, scopeId) {
  const opened = openDatabase({ root: join(world.root, 'scopes', scopeId), create: false });
  try {
    opened.db.prepare("UPDATE meta SET value = 'corrupt' WHERE key = 'store_state'").run();
  } finally {
    closeDatabase(opened.db);
  }
}

function countIn(file, sql) {
  const opened = openDatabase({ root: join(file, '..'), create: false });
  try {
    return Number(opened.db.prepare(sql).get().n);
  } finally {
    closeDatabase(opened.db);
  }
}

test('plan: ausente no es recuperable, corrupto ilegible es reinit y corrupción marcada es rebuild', async () => {
  const world = await makeEightWorld({ libraryCount: 2 });
  try {
    const servable = { kind: 'lib', id: world.libraries[0].id };
    assert.equal(planRecovery({ profileRootPath: world.root, profileKey: 'pa4-test', scope: servable }).plan, 'none');

    const absent = { kind: 'lib', id: world.libraries[1].id };
    rmSync(storeFileOf(world.root, absent.id));
    const missing = planRecovery({ profileRootPath: world.root, profileKey: 'pa4-test', scope: absent });
    assert.equal(missing.plan, 'none');
    assert.equal(missing.reason, 'missing-store');

    garbage(world, absent.id);
    const reinit = planRecovery({ profileRootPath: world.root, profileKey: 'pa4-test', scope: absent });
    assert.equal(reinit.plan, 'reinit');
    assert.equal(reinit.recoverable, false);

    markCorrupt(world, servable.id);
    const rebuild = planRecovery({ profileRootPath: world.root, profileKey: 'pa4-test', scope: servable });
    assert.equal(rebuild.plan, 'rebuild');
    assert.equal(rebuild.recoverable, true);
    assert.ok(rebuild.counts.sources >= 1);
    assert.equal(rebuild.audit.ok, true);
  } finally {
    world.cleanup();
  }
});

test('confirmación: sin confirm no se toca nada y no queda trabajo a medias', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const { bytes } = garbage(world, scope.id);
    const before = readFileSync(storeFileOf(world.root, scope.id));
    assert.throws(
      () => recoverScopeStore({ profileRootPath: world.root, profileKey: 'pa4-test', scope, config: world.config }),
      (error) => error.code === 'approval-required',
    );
    assert.deepEqual(readFileSync(storeFileOf(world.root, scope.id)), before);
    assert.ok(bytes.length > 0);
    const artifacts = listRecoveryArtifacts({ profileRootPath: world.root, scope });
    assert.deepEqual(artifacts.staging, []);
  } finally {
    world.cleanup();
  }
});

test('reinit: el original ilegible se conserva en cuarentena y el nuevo almacén queda vacío', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    garbage(world, scope.id, 'basura-original');
    const result = withRegistry(world, (registryDb) => recoverScopeStore({
      profileRootPath: world.root, profileKey: 'pa4-test', scope, config: world.config, confirm: true,
      mode: 'auto', registryDb, now: 1_700_000_000_000, actor: 'human',
    }));
    assert.equal(result.action, 'recovered');
    assert.equal(result.mode, 'reinit');

    // El original sigue existiendo, byte a byte, dentro de la cuarentena.
    assert.equal(readFileSync(join(result.quarantine, 'rag.sqlite3'), 'utf8'), 'basura-original');
    // El nuevo almacén está en su sitio, servible y sin datos inventados.
    const health = scopeHealth({ profileRootPath: world.root, profileKey: 'pa4-test', scopes: [scope] })[0];
    assert.equal(health.state, 'recovered');
    assert.equal(isServable(health.state), true);
    assert.equal(countIn(world.storeFile(scope.id), 'SELECT COUNT(*) AS n FROM chunks'), 0);

    const operation = withRegistry(world, (registryDb) => registryDb
      .prepare("SELECT state FROM operations WHERE kind = 'recovery' ORDER BY rowid DESC LIMIT 1").get());
    assert.equal(operation.state, 'committed');
    const steps = withRegistry(world, (registryDb) => listSteps(registryDb,
      registryDb.prepare("SELECT id FROM operations WHERE kind = 'recovery' ORDER BY rowid DESC LIMIT 1").get().id));
    assert.deepEqual(steps.map((step) => `${step.step}:${step.state}`), [
      'inspect:done', 'stage:done', 'swap:done', 'verify:done',
    ]);
  } finally {
    world.cleanup();
  }
});

test('rebuild: se copian datos autoritativos, se regeneran FTS y vectores y el digest coincide', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const sourceFile = storeFileOf(world.root, scope.id);
    const originalDigest = (() => {
      const opened = openDatabase({ root: join(world.root, 'scopes', scope.id), create: false });
      try { return digestStore(opened.db); } finally { closeDatabase(opened.db); }
    })();
    markCorrupt(world, scope.id);
    const original = readFileSync(sourceFile);

    const result = withRegistry(world, (registryDb) => recoverScopeStore({
      profileRootPath: world.root, profileKey: 'pa4-test', scope, config: world.config, confirm: true, registryDb,
      now: 1_700_000_000_000,
    }));
    assert.equal(result.mode, 'rebuild');
    assert.equal(result.verification.digest, originalDigest);
    assert.equal(result.verification.counts.vectors, result.verification.counts.chunks);
    assert.equal(result.verification.audit.ok, true);

    // FTS íntegro y vectores completos en el almacén publicado.
    const opened = openDatabase({ root: join(world.root, 'scopes', scope.id), create: false });
    try {
      assert.doesNotThrow(() => ftsIntegrityCheck(opened.db));
      const chunks = Number(opened.db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n);
      const vectors = Number(opened.db.prepare('SELECT COUNT(*) AS n FROM vectors').get().n);
      assert.equal(vectors, chunks);
      assert.equal(digestStore(opened.db), originalDigest);
    } finally {
      closeDatabase(opened.db);
    }

    // El original marcado como corrupto se conserva en cuarentena intacto.
    assert.deepEqual(readFileSync(join(result.quarantine, 'rag.sqlite3')), original);
  } finally {
    world.cleanup();
  }
});

test('recuperación incompleta: un proveedor remoto sin red detiene el rebuild y deja el original intacto', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const file = storeFileOf(world.root, scope.id);
    markCorrupt(world, scope.id);
    const before = readFileSync(file);
    const remote = { ...world.config, embedding: { ...world.config.embedding, provider: 'remoto-sin-red' } };
    const result = withRegistry(world, (registryDb) => {
      let failure = null;
      try {
        recoverScopeStore({
          profileRootPath: world.root, profileKey: 'pa4-test', scope, config: remote, confirm: true, registryDb,
          now: 1_700_000_000_000,
        });
      } catch (error) {
        failure = error;
      }
      return failure;
    });
    assert.equal(result.code, 'recovery-verification-failed');
    assert.equal(result.details.reason, 'vectors-not-regenerable-offline');
    // El original no se ha sustituido: mismo contenido y sigue sin ser servible.
    assert.deepEqual(readFileSync(file), before);
    assert.equal(scopeHealth({ profileRootPath: world.root, profileKey: 'pa4-test', scopes: [scope] })[0].state, 'corrupt');

    const interrupted = withRegistry(world, (registryDb) => registryDb
      .prepare("SELECT state FROM operations WHERE kind = 'recovery' ORDER BY rowid DESC LIMIT 1").get());
    assert.equal(interrupted.state, 'failed');
  } finally {
    world.cleanup();
  }
});

test('rollback: restaura la cuarentena y aparta el intento fallido sin borrar nada', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    garbage(world, scope.id, 'original-cuarentena');
    const recovered = withRegistry(world, (registryDb) => recoverScopeStore({
      profileRootPath: world.root, profileKey: 'pa4-test', scope, config: world.config, confirm: true, registryDb,
      now: 1_700_000_000_000,
    }));
    const restored = withRegistry(world, (registryDb) => rollbackRecovery({
      profileRootPath: world.root, scope, quarantine: recovered.quarantine, registryDb,
    }));

    assert.equal(readFileSync(join(restored.restored, 'rag.sqlite3'), 'utf8'), 'original-cuarentena');
    assert.equal(existsSync(restored.previous), true, 'el intento apartado se conserva');
    const artifacts = listRecoveryArtifacts({ profileRootPath: world.root, scope });
    assert.equal(artifacts.failed.length, 1);
    assert.equal(scopeHealth({ profileRootPath: world.root, profileKey: 'pa4-test', scopes: [scope] })[0].state, 'corrupt');
    assert.equal(world.auditCount('recovery.rollback'), 1, 'la restauración queda auditada en el registro');
  } finally {
    world.cleanup();
  }
});

test('rollback rechaza una cuarentena que no es de este ámbito', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const elsewhere = join(world.base, 'otro', `${scope.id}.quarantine-x`);
    mkdirSync(elsewhere, { recursive: true });
    assert.throws(
      () => rollbackRecovery({ profileRootPath: world.root, scope, quarantine: elsewhere }),
      (error) => error.code === 'invalid-argument',
    );
    assert.equal(readdirSync(join(world.base, 'otro')).length, 1);
  } finally {
    world.cleanup();
  }
});

test('inspectRecoverableStore informa sin modificar y detecta datos incompletos', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    const file = storeFileOf(world.root, scope.id);
    const before = readFileSync(file);
    const inspection = inspectRecoverableStore(file);
    assert.equal(inspection.readable, true);
    assert.ok(inspection.counts.sources >= 1);
    assert.equal(inspection.audit.ok, true);
    assert.equal(inspection.dataComplete, true);
    assert.equal(inspection.orphanChunks, 0);
    assert.deepEqual(readFileSync(file), before, 'inspeccionar no escribe');

    // Un chunk huérfano hace la copia incompleta: no se puede sostener que la recuperación sea fiel.
    const opened = openDatabase({ root: join(world.root, 'scopes', scope.id), create: false });
    try {
      opened.db.exec('PRAGMA foreign_keys = OFF');
      opened.db.prepare(`INSERT INTO chunks (chunk_key, source_id, ordinal, title, heading, text, char_start, char_end, token_est)
        VALUES ('huerfano#0', 'src_inexistente', 0, 't', NULL, 'texto', 0, 5, 1)`).run();
    } finally {
      opened.db.close();
    }
    const damaged = inspectRecoverableStore(file);
    assert.equal(damaged.orphanChunks, 1);
    assert.equal(damaged.dataComplete, false);
    const plan = planRecovery({ profileRootPath: world.root, profileKey: 'pa4-test', scope });
    assert.equal(plan.plan, 'blocked');
  } finally {
    world.cleanup();
  }
});

test('el modo pedido no puede forzar algo distinto del plan', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const scope = { kind: 'lib', id: world.libraries[0].id };
    markCorrupt(world, scope.id);
    assert.throws(
      () => recoverScopeStore({
        profileRootPath: world.root, profileKey: 'pa4-test', scope, config: world.config, confirm: true, mode: 'reinit',
      }),
      (error) => error.code === 'recovery-verification-failed' && error.details.planned === 'rebuild',
    );
  } finally {
    world.cleanup();
  }
});
