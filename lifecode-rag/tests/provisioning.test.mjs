/**
 * R1.2 · Saga de provisión, exclusividad, revocación con procedencia, movimiento y recuperación.
 *
 * Todo ocurre sobre un perfil temporal (`mkdtemp`) y una carpeta de trabajo temporal. El almacén
 * real del propietario no se abre ni se toca. Lo que se fija aquí es el contrato del ciclo de vida:
 * 1:1:1 por dato, consentimiento de la ruta exacta con procedencia, revocación que se niega sin
 * prueba, movimiento que conserva identidad y journal que reanuda sin duplicar.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import test from 'node:test';

import {
  addRoot, closeRegistry, createProject, getProject, listRoots, newId, openRegistry,
} from '../lib/registry.mjs';
import { addTrustedRoot, listTrustedRoots, removeTrustedRootByKey, trustedRootFor } from '../lib/trusted-roots.mjs';
import { scopeStoreExists, openScopeStore } from '../lib/scope-stores.mjs';
import { applyTracking, associateTracking, readTracking } from '../lib/tracking-store.mjs';
import { beginOperation, getOperation, listSteps, recordStep } from '../lib/operations.mjs';
import {
  getProvisionIntent, getSyncRequest, openProvisionIntent, setIntentConsent,
} from '../lib/provision-store.mjs';
import {
  memoryForTracking, moveWorkspaceMemory, provisionWorkspaceMemory, recoverLifecycle, revokeReadAccess,
} from '../lib/lifecycle.mjs';
import { activeSyncScopes } from '../lib/sync.mjs';
import { pathKeyFor } from '../lib/registry.mjs';

const T = 1_700_000_000_000;

function fingerprint(dir) {
  const out = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (!stat.isFile()) continue;
    out[name] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return out;
}

function makeWorld() {
  const base = mkdtempSync(join(tmpdir(), 'lcr-lifecycle-'));
  const root = join(base, 'perfil');
  const ws = join(base, 'workspace');
  const other = join(base, 'otro');
  mkdirSync(ws, { recursive: true });
  mkdirSync(other, { recursive: true });
  writeFileSync(join(ws, 'doc.md'), '# Documento\n\ncontenido del workspace\n', 'utf8');
  const { db } = openRegistry({ root, create: true, now: T });
  return {
    base, root, profileKey: 'lifecycle-test', ws, other, db,
    pathKey: pathKeyFor(ws),
    close() { closeRegistry(db); },
    cleanup() { rmSync(base, { recursive: true, force: true }); },
    count(table) { return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n); },
    track(path, { state = 'on', projectId = null, expectedRevision = 0 } = {}) {
      return applyTracking(db, {
        pathKey: pathKeyFor(path), path, state, projectId, expectedRevision, now: T,
      });
    },
    provision({ expectedRevision, path = ws } = {}) {
      return provisionWorkspaceMemory(db, {
        profileRoot: root, profileKey: 'lifecycle-test', path,
        pathKey: pathKeyFor(path), expectedRevision, now: T + 1,
      });
    },
  };
}

test('provisión: crea memoria, consentimiento exacto y asociación; no escribe en la carpeta', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const before = fingerprint(world.ws);
    const result = world.provision({ expectedRevision: 1 });

    assert.equal(result.memory.state, 'ready');
    assert.equal(result.reused, false);
    assert.equal(result.tracking.state, 'on');
    assert.equal(result.tracking.association, 'explicit');
    assert.equal(result.tracking.revision, 2);
    const projectId = result.tracking.projectId;
    assert.match(projectId, /^prj_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.equal(getProject(world.db, projectId).status, 'active');

    const roots = listRoots(world.db, { scopeKind: 'prj', scopeId: projectId });
    assert.equal(roots.length, 1);
    assert.equal(roots[0].path_key, world.pathKey);
    assert.equal(roots[0].added_by, 'human');

    const trust = listTrustedRoots(world.db).filter((entry) => entry.pathKey === world.pathKey);
    assert.equal(trust.length, 1);
    assert.equal(trust[0].readAuthorization, true);
    assert.equal(trust[0].addedBy, 'human');
    assert.equal(trustedRootFor(world.db, pathKeyFor(world.other)), null, 'no se confía el padre ni el hermano');

    assert.equal(scopeStoreExists(world.root, projectId), true);
    assert.equal(world.count('projects'), 1);
    assert.equal(world.count('libraries'), 0, 'la provisión no toca grants ni bibliotecas');

    const intent = getProvisionIntent(world.db, world.pathKey);
    assert.equal(intent.state, 'done');
    assert.equal(intent.projectId, projectId);
    assert.equal(intent.consentTrustKey, world.pathKey);
    assert.ok(intent.consentRootId);
    const operation = getOperation(world.db, intent.operationId);
    assert.equal(operation.state, 'committed');
    assert.ok(listSteps(world.db, operation.id).every((step) => step.state === 'done'));

    const queued = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: projectId });
    assert.equal(queued.state, 'queued');
    assert.equal(queued.reason, 'provision');

    assert.deepEqual(fingerprint(world.ws), before, 'la carpeta original no cambia');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('repetir la provisión reutiliza identidad, raíz, confianza y almacén', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const first = world.provision({ expectedRevision: 1 });
    const projectId = first.tracking.projectId;
    const second = world.provision({ expectedRevision: first.tracking.revision });

    assert.equal(second.tracking.projectId, projectId);
    assert.equal(second.reused, true);
    assert.equal(second.memory.state, 'ready');
    assert.equal(world.count('projects'), 1);
    assert.equal(listRoots(world.db).length, 1);
    assert.equal(listTrustedRoots(world.db).length, 1);
    assert.equal(scopeStoreExists(world.root, projectId), true);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('reutiliza el proyecto que ya posee la ruta exacta (descubrimiento), sin inventar otro', () => {
  const world = makeWorld();
  try {
    const discovered = createProject(world.db, { name: 'Descubierto', now: T });
    addRoot(world.db, { scopeKind: 'prj', scopeId: discovered.id, path: world.ws, addedBy: 'host', now: T });
    world.track(world.ws);
    const result = world.provision({ expectedRevision: 1 });

    assert.equal(result.tracking.projectId, discovered.id);
    assert.equal(result.reused, true);
    assert.equal(world.count('projects'), 1);
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: discovered.id }).length, 1);
    const intent = getProvisionIntent(world.db, world.pathKey);
    assert.equal(intent.consentRootId, null, 'la raíz preexistente no es propiedad del acto');
    assert.equal(intent.consentTrustKey, world.pathKey, 'la confianza exacta sí la creó el acto');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('exclusividad: otro workspace no puede reclamar la misma memoria', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const first = world.provision({ expectedRevision: 1 });
    const projectId = first.tracking.projectId;

    world.track(world.other);
    assert.throws(
      () => associateTracking(world.db, {
        pathKey: pathKeyFor(world.other), projectId, expectedRevision: 1, now: T + 2,
      }),
      (error) => {
        assert.equal(error.code, 'memory-exclusive');
        assert.equal(error.details.projectId, projectId);
        return true;
      },
    );
    assert.equal(readTracking(world.db, { pathKey: pathKeyFor(world.other) }).projectId, null);

    // Provisonar el segundo workspace crea SU memoria, no comparte la del primero.
    const second = world.provision({ path: world.other, expectedRevision: 1 });
    assert.notEqual(second.tracking.projectId, projectId);
    assert.equal(world.count('projects'), 2);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('revocación: retira sólo lo propio y conserva proyecto, almacén y seguimiento', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const revision = provisioned.tracking.revision;

    const revoked = revokeReadAccess(world.db, {
      profileRoot: world.root, pathKey: world.pathKey, expectedRevision: revision, now: T + 2,
    });
    assert.equal(revoked.changed, true);
    assert.equal(revoked.removed.trust.pathKey, world.pathKey);
    assert.ok(revoked.removed.root.id);
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 0);
    assert.equal(
      listTrustedRoots(world.db).some((entry) => entry.pathKey === world.pathKey && entry.state === 'trusted'),
      false,
    );

    const row = readTracking(world.db, { pathKey: world.pathKey });
    assert.equal(row.projectId, projectId, 'revocar no desasocia');
    assert.equal(row.state, 'on', 'revocar no apaga el seguimiento');
    assert.equal(getProject(world.db, projectId).status, 'active');
    assert.equal(scopeStoreExists(world.root, projectId), true, 'el almacén sigue');
    const intent = getProvisionIntent(world.db, world.pathKey);
    assert.ok(intent.revokedAt);

    const again = revokeReadAccess(world.db, {
      profileRoot: world.root, pathKey: world.pathKey, expectedRevision: row.revision, now: T + 3,
    });
    assert.equal(again.changed, false);
    assert.equal(again.alreadyRevoked, true);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('revocación sin procedencia: se niega y no retira una entrada preexistente', () => {
  const world = makeWorld();
  try {
    // Entrada y raíz preexistentes (acto humano ajeno al provisioning), en la MISMA ruta.
    addTrustedRoot(world.db, { path: world.ws, readAuthorization: true, addedBy: 'human', now: T });
    const prior = createProject(world.db, { name: 'Ajeno', now: T });
    const preexistingRoot = addRoot(world.db, {
      scopeKind: 'prj', scopeId: prior.id, path: world.ws, addedBy: 'human', now: T,
    });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    assert.equal(provisioned.tracking.projectId, prior.id, 'la ruta ya tenía dueño: se reutiliza');

    const intent = getProvisionIntent(world.db, world.pathKey);
    assert.equal(intent.consentTrustKey, null, 'la confianza preexistente no es nuestra');
    assert.equal(intent.consentRootId, null, 'la raíz preexistente no es nuestra');

    assert.throws(
      () => revokeReadAccess(world.db, {
        profileRoot: world.root, pathKey: world.pathKey, expectedRevision: provisioned.tracking.revision, now: T + 2,
      }),
      (error) => {
        assert.equal(error.code, 'revocation-not-proven');
        return true;
      },
    );
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === world.pathKey).state, 'trusted');
    assert.ok(world.db.prepare('SELECT id FROM roots WHERE id = ?').get(preexistingRoot.id));
  } finally {
    world.close();
    world.cleanup();
  }
});

test('movimiento: conserva identidad y almacén, elimina la fila vieja y deja traza durable', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const store = openScopeStore({
      profileRoot: world.root, profileKey: 'lifecycle-test',
      scope: { kind: 'prj', id: projectId }, create: false, now: T,
    });
    try {
      store.prepare(`INSERT INTO sources
          (id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at)
        VALUES ('src_move_test', 'default', ?, 'Documento', 'text/markdown', ?, 10, 10, '{}', ?, ?, ?)`)
        .run(join(world.ws, 'doc.md'), 'a'.repeat(64), T, T, T);
    } finally {
      store.close();
    }
    const destination = join(world.base, 'destino');
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, 'nuevo.md'), '# Nuevo\n\n', 'utf8');

    const moved = moveWorkspaceMemory(world.db, {
      profileRoot: world.root, profileKey: 'lifecycle-test',
      pathKey: world.pathKey, newPath: destination,
      expectedRevision: provisioned.tracking.revision, now: T + 5,
    });

    assert.equal(moved.tracking.projectId, projectId, 'la identidad no cambia');
    assert.equal(moved.tracking.pathKey, pathKeyFor(destination));
    assert.equal(moved.tracking.state, 'on');
    assert.equal(moved.tracking.association, 'explicit');
    assert.equal(moved.tracking.revision, 1);
    assert.equal(readTracking(world.db, { pathKey: world.pathKey }), null, 'la fila vieja se elimina');
    assert.equal(world.count('workspace_tracking'), 1, 'no quedan dos asociaciones activas');
    assert.equal(scopeStoreExists(world.root, projectId), true);

    const roots = listRoots(world.db, { scopeKind: 'prj', scopeId: projectId });
    assert.equal(roots.length, 1);
    assert.equal(roots[0].path_key, pathKeyFor(destination));

    const movedStore = openScopeStore({
      profileRoot: world.root, profileKey: 'lifecycle-test',
      scope: { kind: 'prj', id: projectId }, create: false, now: T + 5,
    });
    try {
      const sources = movedStore.prepare('SELECT id, uri FROM sources').all();
      assert.equal(sources.length, 1, 'una sola fuente: el movimiento reescribe la ruta, no duplica');
      assert.equal(sources[0].id, 'src_move_test', 'conserva el source_id y su conocimiento');
      assert.equal(sources[0].uri, join(destination, 'doc.md'));
    } finally {
      movedStore.close();
    }

    const oldTrust = listTrustedRoots(world.db).find((entry) => entry.pathKey === world.pathKey);
    assert.equal(oldTrust.state, 'revoked', 'el acceso exacto viejo se retira: era nuestro');
    const parentTrust = listTrustedRoots(world.db).find((entry) => entry.pathKey === pathKeyFor(world.base));
    assert.equal(parentTrust.state, 'trusted', 'la entrada del padre es preexistente y no se toca');

    const operation = getOperation(world.db, moved.operationId);
    assert.equal(operation.kind, 'move');
    assert.equal(operation.state, 'committed');
    const detail = JSON.parse(operation.detail);
    assert.equal(detail.from_path_key, world.pathKey);
    assert.equal(detail.to_path_key, pathKeyFor(destination));
    assert.equal(detail.project_id, projectId);
    assert.equal(detail.from_revision, provisioned.tracking.revision);
    assert.equal(detail.to_revision, 1);
    assert.ok(detail.trust_added_at, 'la procedencia de la confianza sobrevive al cierre');

    // Y el journal conserva la operación: la fila vieja no está, la traza sí.
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind='move'").get().n, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('movimiento: si el rekey del almacén falla, la obligación es durable y no se duplica la fuente', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    // Grafía distinta a la canónica (barras `/`): la API la acepta por pathKey; el rekey debe usar la
    // ruta de la raíz, no el literal de la fila, o no movería la fuente.
    world.track(world.ws.split('\\').join('/'));
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const destination = join(world.base, 'destino-rekey');
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, 'doc.md'), '# Nuevo\n\n', 'utf8');
    const sibling = join(world.base, 'app-docs');
    mkdirSync(sibling, { recursive: true });

    const store = openScopeStore({
      profileRoot: world.root, profileKey: 'lifecycle-test',
      scope: { kind: 'prj', id: projectId }, create: false, now: T,
    });
    try {
      store.prepare(`INSERT INTO sources
          (id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at)
        VALUES ('src_rekey_old', 'default', ?, 'Doc', 'text/markdown', ?, 10, 10, '{}', ?, ?, ?)`)
        .run(join(world.ws, 'doc.md'), 'a'.repeat(64), T, T, T);
      store.prepare(`INSERT INTO sources
          (id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at)
        VALUES ('src_rekey_sibling', 'default', ?, 'Hermano', 'text/markdown', ?, 10, 10, '{}', ?, ?, ?)`)
        .run(join(sibling, 'notas.md'), 'b'.repeat(64), T, T, T);
      store.exec(`CREATE TRIGGER fail_sources_update BEFORE UPDATE ON sources BEGIN
        SELECT RAISE(ABORT, 'io-sources'); END;`);
    } finally {
      store.close();
    }

    let moved;
    try {
      moved = moveWorkspaceMemory(world.db, {
        profileRoot: world.root, profileKey: 'lifecycle-test',
        pathKey: world.pathKey, newPath: destination,
        expectedRevision: provisioned.tracking.revision, now: T + 5,
      });
    } finally {
      const cleanupStore = openScopeStore({
        profileRoot: world.root, profileKey: 'lifecycle-test',
        scope: { kind: 'prj', id: projectId }, create: false, now: T + 5,
      });
      try { cleanupStore.exec('DROP TRIGGER fail_sources_update'); } finally { cleanupStore.close(); }
    }
    assert.equal(moved.tracking.projectId, projectId);
    const pendingRekey = world.db.prepare("SELECT id FROM operations WHERE kind = 'rekey' AND state = 'started'").all();
    assert.equal(pendingRekey.length, 1, 'el fallo de rekey queda como obligación durable');
    // Simula el reinicio: el dueño anterior ya no existe; si no, la recuperación no debe adoptarla.
    const pendingDetail = JSON.parse(world.db.prepare('SELECT detail FROM operations WHERE id = ?').get(pendingRekey[0].id).detail);
    pendingDetail.owner_pid = 999999;
    world.db.prepare('UPDATE operations SET detail = ? WHERE id = ?').run(JSON.stringify(pendingDetail), pendingRekey[0].id);

    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 6 });
    assert.equal(summary.rekeys, 1);
    assert.equal(summary.rekeyErrors, 0);
    const syncAfterRekey = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: projectId });
    assert.ok(syncAfterRekey, 'el rekey completado vuelve a encolar sync');
    assert.equal(syncAfterRekey.reason, 'recovery');

    const after = openScopeStore({
      profileRoot: world.root, profileKey: 'lifecycle-test',
      scope: { kind: 'prj', id: projectId }, create: false, now: T + 6,
    });
    try {
      const sources = after.prepare('SELECT id, uri FROM sources ORDER BY id').all();
      assert.equal(sources.length, 2, 'una fuente movida y una hermana: no se duplica');
      assert.equal(sources.find((row) => row.id === 'src_rekey_old').uri, join(destination, 'doc.md'));
      assert.equal(sources.find((row) => row.id === 'src_rekey_sibling').uri, join(sibling, 'notas.md'));
    } finally {
      after.close();
    }
  } finally {
    world.close();
    world.cleanup();
  }
});

test('movimiento: mover después de revocar conserva una sola fuente', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const store = openScopeStore({
      profileRoot: world.root, profileKey: 'lifecycle-test',
      scope: { kind: 'prj', id: projectId }, create: false, now: T,
    });
    try {
      store.prepare(`INSERT INTO sources
          (id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at)
        VALUES ('src_revoke_move', 'default', ?, 'Doc', 'text/markdown', ?, 10, 10, '{}', ?, ?, ?)`)
        .run(join(world.ws, 'doc.md'), 'a'.repeat(64), T, T, T);
    } finally {
      store.close();
    }
    removeTrustedRootByKey(world.db, { pathKey: pathKeyFor(world.base), removedBy: 'human', now: T + 4 });
    const revoked = revokeReadAccess(world.db, {
      profileRoot: world.root, profileKey: 'lifecycle-test',
      pathKey: world.pathKey, expectedRevision: provisioned.tracking.revision, now: T + 5,
    });
    assert.equal(revoked.complete, true);
    const destination = join(world.base, 'destino-tras-revocar');
    mkdirSync(destination, { recursive: true });
    // La API acepta la misma ruta con separador final; el rekey no puede depender de la grafía.
    const destinationRaw = `${destination}${sep}`;
    const current = readTracking(world.db, { pathKey: world.pathKey });
    const moved = moveWorkspaceMemory(world.db, {
      profileRoot: world.root, profileKey: 'lifecycle-test',
      pathKey: world.pathKey, newPath: destinationRaw,
      expectedRevision: current.revision, now: T + 6,
    });
    assert.equal(moved.tracking.projectId, projectId);
    const after = openScopeStore({
      profileRoot: world.root, profileKey: 'lifecycle-test',
      scope: { kind: 'prj', id: projectId }, create: false, now: T + 6,
    });
    try {
      const sources = after.prepare('SELECT id, uri FROM sources').all();
      assert.equal(sources.length, 1, 'el rekey se hizo aunque la raíz ya no existiera');
      assert.equal(sources[0].id, 'src_revoke_move');
      assert.equal(sources[0].uri, join(destination, 'doc.md'));
    } finally {
      after.close();
    }
  } finally {
    world.close();
    world.cleanup();
  }
});

test('provisión: una carpeta ausente es no reintentable para que la API restaure la fila', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    rmSync(world.ws, { recursive: true, force: true });
    assert.throws(
      () => world.provision({ expectedRevision: 1 }),
      (error) => {
        assert.equal(error.code, 'workspace-missing');
        assert.equal(error.details.retryable, false);
        return true;
      },
    );
  } finally {
    world.close();
    world.cleanup();
  }
});

test('provisión: con una limpieza F-02 pendiente no se abre una tercera asociación en la ruta vieja', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const destination = join(world.base, 'destino-cleanup-pending');
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, 'doc.md'), '# Destino\n\n', 'utf8');
    world.db.exec(`CREATE TRIGGER fail_root_delete BEFORE DELETE ON roots BEGIN
      SELECT RAISE(ABORT, 'io-root'); END;`);
    try {
      moveWorkspaceMemory(world.db, {
        profileRoot: world.root, profileKey: 'lifecycle-test',
        pathKey: world.pathKey, newPath: destination,
        expectedRevision: provisioned.tracking.revision, now: T + 5,
      });
    } finally {
      world.db.exec('DROP TRIGGER fail_root_delete');
    }
    world.track(world.ws);
    assert.throws(
      () => world.provision({ expectedRevision: 1 }),
      (error) => {
        assert.equal(error.code, 'memory-exclusive');
        assert.equal(error.details.reason, 'cleanup-pending');
        return true;
      },
    );
  } finally {
    world.close();
    world.cleanup();
  }
});

test('recuperación: un perdedor caído hacia otro destino compensa su raíz y confianza huérfanas', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const winner = join(world.base, 'destino-ganador');
    const loser = join(world.base, 'destino-perdedor');
    mkdirSync(winner, { recursive: true });
    mkdirSync(loser, { recursive: true });
    // El ganador mueve y borra la fila de origen.
    moveWorkspaceMemory(world.db, {
      profileRoot: world.root, profileKey: 'lifecycle-test',
      pathKey: world.pathKey, newPath: winner,
      expectedRevision: provisioned.tracking.revision, now: T + 5,
    });

    // El perdedor alcanzó a crear raíz/confianza en su propio destino y cayó antes del rebind.
    const loserKey = pathKeyFor(loser);
    const operation = beginOperation(world.db, {
      kind: 'move', now: T + 6,
      detail: {
        from_path_key: world.pathKey, from_path: world.ws,
        to_path_key: loserKey, to_path: loser, project_id: projectId,
        from_revision: provisioned.tracking.revision, to_revision: 1,
      },
    });
    openProvisionIntent(world.db, {
      pathKey: loserKey, operationId: operation.id, expectedRevision: 1, projectId, now: T + 6,
    });
    const trust = addTrustedRoot(world.db, { path: loser, readAuthorization: true, addedBy: 'human', now: T + 6 });
    const root = addRoot(world.db, {
      scopeKind: 'prj', scopeId: projectId, path: loser, addedBy: 'human', now: T + 6,
    });
    setIntentConsent(world.db, {
      pathKey: loserKey, consentTrustKey: trust.created ? loserKey : null, consentRootId: root.id, now: T + 6,
    });

    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 7 });
    assert.equal(summary.abandoned, 1);
    assert.equal(getOperation(world.db, operation.id).state, 'failed');
    assert.equal(getProvisionIntent(world.db, loserKey).state, 'abandoned');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1,
      'sólo queda la raíz del destino ganador');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId })[0].path_key, pathKeyFor(winner));
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === loserKey), undefined,
      'la confianza creada por el perdedor no queda autorizada');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('movimiento: la ruta destino seguida por otro workspace es un conflicto y no escribe', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    world.track(world.other);
    assert.throws(
      () => moveWorkspaceMemory(world.db, {
        profileRoot: world.root, profileKey: 'lifecycle-test',
        pathKey: world.pathKey, newPath: world.other,
        expectedRevision: provisioned.tracking.revision, now: T + 5,
      }),
      (error) => {
        assert.equal(error.code, 'move-conflict');
        assert.equal(error.details.reason, 'destination-tracked');
        return true;
      },
    );
    assert.equal(readTracking(world.db, { pathKey: world.pathKey }).projectId, provisioned.tracking.projectId);
    assert.equal(world.count('workspace_tracking'), 2);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('recuperación: reanuda una provisión interrumpida sin duplicar identidad ni almacén', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    // Caída tras el consentimiento: operación abierta, intención abierta y sólo ese paso hecho.
    const operation = beginOperation(world.db, {
      kind: 'provision', now: T + 1, detail: { path_key: world.pathKey, expected_revision: 1 },
    });
    openProvisionIntent(world.db, {
      pathKey: world.pathKey, operationId: operation.id, expectedRevision: 1, now: T + 1,
    });
    addTrustedRoot(world.db, { path: world.ws, readAuthorization: true, addedBy: 'human', now: T + 1 });
    recordStep(world.db, {
      operationId: operation.id, step: 'consent', state: 'done',
      effectKey: `provision:${world.pathKey}:consent`, now: T + 1,
    });

    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 2 });
    assert.equal(summary.provisions, 1);
    assert.equal(summary.committed, 1);
    const row = readTracking(world.db, { pathKey: world.pathKey });
    assert.ok(row.projectId);
    assert.equal(row.association, 'explicit');
    assert.equal(world.count('projects'), 1);
    assert.equal(listRoots(world.db).length, 1);
    assert.equal(scopeStoreExists(world.root, row.projectId), true);
    const intent = getProvisionIntent(world.db, world.pathKey);
    assert.equal(intent.state, 'done');
    assert.equal(getOperation(world.db, operation.id).state, 'committed');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('fencing: una provisión vieja no asocia sobre una revisión nueva y se abandona', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const reserved = newId('prj_', T);
    const operation = beginOperation(world.db, { kind: 'provision', now: T + 1 });
    openProvisionIntent(world.db, {
      pathKey: world.pathKey, operationId: operation.id, expectedRevision: 1, projectId: reserved, now: T + 1,
    });
    // La persona pausa el seguimiento: la revisión cambia antes de que la saga asocie.
    applyTracking(world.db, {
      pathKey: world.pathKey, path: world.ws, state: 'paused', expectedRevision: 1, now: T + 2,
    });

    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 3 });
    assert.equal(summary.abandoned, 1);
    assert.equal(getProject(world.db, reserved), null, 'la identidad reservada no se creó');
    assert.equal(readTracking(world.db, { pathKey: world.pathKey }).projectId, null);
    assert.equal(getProvisionIntent(world.db, world.pathKey).state, 'abandoned');
    assert.equal(getOperation(world.db, operation.id).state, 'failed');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('recuperación: una provisión ya asociada sólo se cierra, no se repite', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const intent = getProvisionIntent(world.db, world.pathKey);
    // Simula la caída entre `associate` y `finishOperation`: pasos hechos, operación abierta.
    world.db.prepare("UPDATE operations SET state='started', finished_at=NULL WHERE id = ?").run(intent.operationId);
    world.db.prepare("UPDATE provision_intents SET state='open' WHERE path_key = ?").run(world.pathKey);

    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 2 });
    assert.equal(summary.committed, 1);
    assert.equal(world.count('projects'), 1);
    assert.equal(readTracking(world.db, { pathKey: world.pathKey }).projectId, projectId);
    assert.equal(getOperation(world.db, intent.operationId).state, 'committed');
    assert.equal(getProvisionIntent(world.db, world.pathKey).state, 'done');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('H1 · con una raíz preexistente, la revocación retira lo propio pero no afirma que el acceso cesó', () => {
  const world = makeWorld();
  try {
    // Una raíz del Host ya autorizaba la carpeta antes de que LifeCode RAG la siguiera: la raíz
    // NO es nuestra (consentRootId=null), la confianza exacta sí la crea el acto.
    const project = createProject(world.db, { name: 'Memoria previa', now: T });
    addRoot(world.db, { scopeKind: 'prj', scopeId: project.id, path: world.ws, addedBy: 'host', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const intent = getProvisionIntent(world.db, world.pathKey);
    assert.equal(intent.consentTrustKey, world.pathKey);
    assert.equal(intent.consentRootId, null, 'la raíz preexistente no es propiedad del acto');

    const revoked = revokeReadAccess(world.db, {
      profileRoot: world.root, pathKey: world.pathKey,
      expectedRevision: provisioned.tracking.revision, now: T + 2,
    });
    assert.equal(revoked.changed, true, 'la confianza creada por el acto sí se retira');
    assert.equal(revoked.complete, false, 'no puede afirmarse que el acceso de lectura cesó');
    assert.equal(revoked.remaining.length, 1);
    assert.equal(revoked.remaining[0].path, world.ws);
    assert.equal(revoked.removed.trust.pathKey, world.pathKey);
    assert.equal(revoked.removed.root, null);
    assert.ok(
      world.db.prepare("SELECT id FROM roots WHERE scope_id = ? AND path_key = ? AND state = 'authorized'").get(project.id, world.pathKey),
      'la raíz preexistente sigue autorizada: no se toca',
    );
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === world.pathKey).state, 'revoked');
    assert.equal(readTracking(world.db, { pathKey: world.pathKey }).projectId, provisioned.tracking.projectId, 'la memoria no se borra');

    // Repetir la revocación no puede decir «acceso revocado»: la raíz preexistente sigue ahí.
    const again = revokeReadAccess(world.db, {
      profileRoot: world.root, pathKey: world.pathKey,
      expectedRevision: provisioned.tracking.revision, now: T + 3,
    });
    assert.equal(again.alreadyRevoked, true);
    assert.equal(again.complete, false);
    assert.equal(again.remaining.length, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('H1b · una confianza preexistente del padre impide declarar el acceso revocado', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const revoked = revokeReadAccess(world.db, {
      profileRoot: world.root, pathKey: world.pathKey,
      expectedRevision: provisioned.tracking.revision, now: T + 2,
    });
    assert.equal(revoked.changed, true);
    assert.equal(revoked.complete, false, 'la confianza del padre sigue autorizando la lectura');
    assert.ok(revoked.remaining.some((entry) => entry.kind === 'trust' && entry.pathKey === pathKeyFor(world.base)),
      'remaining mide también trusted_roots, no sólo roots');
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === world.pathKey).state, 'revoked');
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === pathKeyFor(world.base)).state, 'trusted',
      'la confianza preexistente no se toca');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('H4 · revocar con la carpeta ausente retira el acceso igualmente', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    rmSync(world.ws, { recursive: true, force: true });

    const revoked = revokeReadAccess(world.db, {
      profileRoot: world.root, pathKey: world.pathKey,
      expectedRevision: provisioned.tracking.revision, now: T + 2,
    });
    assert.equal(revoked.changed, true, 'la confianza se retira por pathKey, sin exigir que exista');
    assert.equal(revoked.complete, true);
    assert.equal(revoked.removed.root.path, world.ws);
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === world.pathKey).state, 'revoked');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: provisioned.tracking.projectId }).length, 0);
    assert.equal(readTracking(world.db, { pathKey: world.pathKey }).projectId, provisioned.tracking.projectId);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('H2 · mover con una raíz preexistente en la ruta vieja se rechaza antes de escribir', () => {
  const world = makeWorld();
  try {
    const project = createProject(world.db, { name: 'Memoria previa', now: T });
    addRoot(world.db, { scopeKind: 'prj', scopeId: project.id, path: world.ws, addedBy: 'host', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const destination = join(world.base, 'destino-h2');
    mkdirSync(destination, { recursive: true });

    assert.throws(
      () => moveWorkspaceMemory(world.db, {
        profileRoot: world.root, profileKey: 'lifecycle-test',
        pathKey: world.pathKey, newPath: destination,
        expectedRevision: provisioned.tracking.revision, now: T + 5,
      }),
      (error) => {
        assert.equal(error.code, 'move-conflict');
        assert.equal(error.details.reason, 'source-root-not-owned');
        return true;
      },
    );
    assert.equal(readTracking(world.db, { pathKey: world.pathKey }).projectId, provisioned.tracking.projectId);
    assert.equal(readTracking(world.db, { pathKey: pathKeyFor(destination) }), null);
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind='move'").get().n, 0);
    assert.ok(world.db.prepare('SELECT id FROM roots WHERE path_key = ? AND state = ?').get(world.pathKey, 'authorized'));
  } finally {
    world.close();
    world.cleanup();
  }
});

test('M2 · mover a una subcarpeta de la propia carpeta es un conflicto de contención', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const inside = join(world.ws, 'dentro');
    mkdirSync(inside, { recursive: true });
    assert.throws(
      () => moveWorkspaceMemory(world.db, {
        profileRoot: world.root, profileKey: 'lifecycle-test',
        pathKey: world.pathKey, newPath: inside,
        expectedRevision: provisioned.tracking.revision, now: T + 5,
      }),
      (error) => {
        assert.equal(error.code, 'move-conflict');
        assert.equal(error.details.reason, 'containment');
        return true;
      },
    );
    assert.equal(readTracking(world.db, { pathKey: world.pathKey }).projectId, provisioned.tracking.projectId);
    assert.equal(world.count('workspace_tracking'), 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('M2b · un proyecto con una segunda raíz no se mueve a otra carpeta', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    addRoot(world.db, { scopeKind: 'prj', scopeId: projectId, path: world.other, addedBy: 'host', now: T + 2 });
    const destination = join(world.base, 'destino-m2b');
    mkdirSync(destination, { recursive: true });

    assert.throws(
      () => moveWorkspaceMemory(world.db, {
        profileRoot: world.root, profileKey: 'lifecycle-test',
        pathKey: world.pathKey, newPath: destination,
        expectedRevision: provisioned.tracking.revision, now: T + 5,
      }),
      (error) => {
        assert.equal(error.code, 'move-conflict');
        assert.equal(error.details.reason, 'project-has-other-roots');
        return true;
      },
    );
    assert.equal(readTracking(world.db, { pathKey: world.pathKey }).projectId, projectId);
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 2);
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind='move'").get().n, 0);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('movimiento: un rekey pendiente bloquea el siguiente movimiento antes de escribir', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const pending = beginOperation(world.db, {
      kind: 'rekey', now: T + 5,
      detail: {
        reason: 'move-rekey', project_id: projectId,
        from_path: join(world.base, 'ruta-anterior'), to_path: world.ws,
      },
    });
    const destination = join(world.base, 'destino-con-rekey-pendiente');
    mkdirSync(destination, { recursive: true });
    assert.throws(
      () => moveWorkspaceMemory(world.db, {
        profileRoot: world.root, profileKey: 'lifecycle-test',
        pathKey: world.pathKey, newPath: destination,
        expectedRevision: provisioned.tracking.revision, now: T + 6,
      }),
      (error) => {
        assert.equal(error.code, 'move-conflict');
        assert.equal(error.details.reason, 'rekey-pending');
        return true;
      },
    );
    assert.equal(readTracking(world.db, { pathKey: pathKeyFor(destination) }), null);
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM operations WHERE kind = ?').get('move').n, 0);
    assert.equal(getOperation(world.db, pending.id).state, 'started');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('recuperación: un movimiento con rebind hecho vuelve a encolar sync', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const destination = join(world.base, 'destino-recovery');
    mkdirSync(destination, { recursive: true });
    const moved = moveWorkspaceMemory(world.db, {
      profileRoot: world.root, profileKey: 'lifecycle-test',
      pathKey: world.pathKey, newPath: destination,
      expectedRevision: provisioned.tracking.revision, now: T + 5,
    });
    const destKey = pathKeyFor(destination);
    // Caída entre el rebind y el cierre: la operación y la intención vuelven a `open`.
    world.db.prepare("UPDATE operations SET state='started', finished_at=NULL WHERE id = ?").run(moved.operationId);
    world.db.prepare("UPDATE provision_intents SET state='open' WHERE path_key = ?").run(destKey);

    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 6 });
    assert.equal(summary.moves, 1);
    assert.equal(getOperation(world.db, moved.operationId).state, 'committed');
    assert.equal(getProvisionIntent(world.db, destKey).state, 'done');
    assert.equal(world.count('workspace_tracking'), 1, 'no se duplica la asociación');
    assert.equal(readTracking(world.db, { pathKey: destKey }).projectId, moved.tracking.projectId);
    assert.equal(readTracking(world.db, { pathKey: world.pathKey }), null, 'la fila vieja sigue eliminada');
    const sync = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: moved.tracking.projectId });
    assert.ok(sync, 'la recuperación encola una pasada de sync');
    assert.equal(sync.reason, 'recovery');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('rekey: un fallo al persistir la obligación no deja el movimiento atascado', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const destination = join(world.base, 'destino-rekey-insert');
    mkdirSync(destination, { recursive: true });
    const destKey = pathKeyFor(destination);
    const store = openScopeStore({
      profileRoot: world.root, profileKey: 'lifecycle-test',
      scope: { kind: 'prj', id: provisioned.tracking.projectId }, create: false, now: T,
    });
    try {
      store.prepare(`INSERT INTO sources
          (id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at)
        VALUES ('src_rekey_insert', 'default', ?, 'Doc', 'text/markdown', ?, 10, 10, '{}', ?, ?, ?)`)
        .run(join(world.ws, 'doc.md'), 'a'.repeat(64), T, T, T);
      store.exec(`CREATE TRIGGER fail_sources_update BEFORE UPDATE ON sources BEGIN
        SELECT RAISE(ABORT, 'io-sources'); END;`);
    } finally {
      store.close();
    }
    // El INSERT de la operación `rekey` falla una vez; el move ya hizo el rebind y no puede
    // presentarse como fallido, pero el paso queda `failed` y debe recuperarse al arrancar.
    world.db.exec(`CREATE TRIGGER fail_rekey_insert BEFORE INSERT ON operations
      WHEN NEW.kind = 'rekey' BEGIN SELECT RAISE(ABORT, 'io-op'); END;`);
    let moved = null;
    try {
      moved = moveWorkspaceMemory(world.db, {
        profileRoot: world.root, profileKey: 'lifecycle-test',
        pathKey: world.pathKey, newPath: destination,
        expectedRevision: provisioned.tracking.revision, now: T + 5,
      });
    } catch { /* la API puede devolver el error; lo importante es el journal */ }
    world.db.exec('DROP TRIGGER fail_rekey_insert');
    const cleanupStore = openScopeStore({
      profileRoot: world.root, profileKey: 'lifecycle-test',
      scope: { kind: 'prj', id: provisioned.tracking.projectId }, create: false, now: T + 5,
    });
    try { cleanupStore.exec('DROP TRIGGER fail_sources_update'); } finally { cleanupStore.close(); }
    const moveRow = world.db.prepare("SELECT id FROM operations WHERE kind = 'move' ORDER BY rowid DESC LIMIT 1").get();
    assert.ok(moveRow, 'el rebind quedó registrado');
    const operation = getOperation(world.db, moveRow.id);
    assert.equal(operation.state, 'started');
    assert.equal(operation.steps.find((step) => step.step === 'rekey').state, 'failed');
    assert.equal(getProvisionIntent(world.db, destKey).state, 'open');
    // La caída es de este proceso: para simular el arranque posterior se marca al dueño como muerto.
    const detail = JSON.parse(operation.detail);
    detail.owner_pid = 999999;
    world.db.prepare('UPDATE operations SET detail = ? WHERE id = ?').run(JSON.stringify(detail), moveRow.id);

    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 6 });
    assert.ok(summary.rekeys >= 1);
    assert.equal(getOperation(world.db, moveRow.id).state, 'committed');
    assert.equal(getProvisionIntent(world.db, destKey).state, 'done');
    assert.equal(readTracking(world.db, { pathKey: destKey }).projectId, provisioned.tracking.projectId);
    assert.ok(moved === null || moved.tracking.projectId === provisioned.tracking.projectId);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('R-1 · si no se puede persistir el rekey, la recuperación no cierra ni deja indexar', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const destination = join(world.base, 'destino-recovery-insert');
    mkdirSync(destination, { recursive: true });
    const destKey = pathKeyFor(destination);
    const operation = beginOperation(world.db, {
      kind: 'move', now: T + 5,
      detail: {
        from_path_key: world.pathKey, from_path: world.ws,
        to_path_key: destKey, to_path: destination, project_id: projectId,
        from_revision: provisioned.tracking.revision, to_revision: 1,
        owner_pid: 999999,
      },
    });
    openProvisionIntent(world.db, {
      pathKey: destKey, operationId: operation.id, expectedRevision: 1, projectId, now: T + 5,
    });
    const trust = addTrustedRoot(world.db, { path: destination, readAuthorization: true, addedBy: 'human', now: T + 5 });
    const root = addRoot(world.db, { scopeKind: 'prj', scopeId: projectId, path: destination, addedBy: 'human', now: T + 5 });
    setIntentConsent(world.db, {
      pathKey: destKey, consentTrustKey: trust.created ? destKey : null, consentRootId: root.id, now: T + 5,
    });
    const store = openScopeStore({
      profileRoot: world.root, profileKey: 'lifecycle-test',
      scope: { kind: 'prj', id: projectId }, create: false, now: T,
    });
    try {
      store.prepare(`INSERT INTO sources
          (id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at)
        VALUES ('src_r1', 'default', ?, 'Doc', 'text/markdown', ?, 10, 10, '{}', ?, ?, ?)`)
        .run(join(world.ws, 'doc.md'), 'a'.repeat(64), T, T, T);
    } finally {
      store.close();
    }
    world.db.prepare('DELETE FROM workspace_tracking WHERE path_key = ?').run(world.pathKey);
    applyTracking(world.db, {
      pathKey: destKey, path: destination, state: 'on', projectId, expectedRevision: 0, now: T + 5,
    });
    recordStep(world.db, { operationId: operation.id, step: 'rebind', state: 'done', now: T + 5 });

    world.db.exec(`CREATE TRIGGER fail_recovery_rekey BEFORE INSERT ON operations
      WHEN NEW.kind = 'rekey' BEGIN SELECT RAISE(ABORT, 'io-op'); END;`);
    let summary;
    try {
      summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 6 });
    } finally {
      world.db.exec('DROP TRIGGER fail_recovery_rekey');
    }
    assert.ok(summary.skipped >= 1);
    assert.equal(getOperation(world.db, operation.id).state, 'started', 'no se cierra sin obligación rekey');
    assert.equal(getProvisionIntent(world.db, destKey).state, 'open');
    assert.equal(activeSyncScopes(world.db).some((scope) => scope.id === projectId), false,
      'la intención abierta mantiene el proyecto fuera del sync');
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === world.pathKey)?.state, 'trusted',
      'el acceso viejo sigue intacto');
    assert.ok(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId })
      .some((row) => row.path_key === world.pathKey), 'la raíz vieja sigue presente');

    const retry = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 7 });
    assert.ok(retry.rekeys >= 1);
    assert.equal(getOperation(world.db, operation.id).state, 'committed');
    assert.equal(getProvisionIntent(world.db, destKey).state, 'done');
    assert.equal(activeSyncScopes(world.db).some((scope) => scope.id === projectId), true);
    const afterStore = openScopeStore({
      profileRoot: world.root, profileKey: 'lifecycle-test',
      scope: { kind: 'prj', id: projectId }, create: false, now: T + 7,
    });
    try {
      const sources = afterStore.prepare('SELECT id, uri FROM sources').all();
      assert.equal(sources.length, 1, 'una sola fuente tras el rekey');
      assert.equal(sources[0].uri, join(destination, 'doc.md'));
    } finally {
      afterStore.close();
    }
  } finally {
    world.close();
    world.cleanup();
  }
});

test('compensación: no retira una confianza que otro acto recreó después', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const destination = join(world.base, 'destino-confianza-recreada');
    mkdirSync(destination, { recursive: true });
    const destKey = pathKeyFor(destination);
    const operation = beginOperation(world.db, {
      kind: 'move', now: T + 5,
      detail: {
        from_path_key: world.pathKey, from_path: world.ws,
        to_path_key: destKey, to_path: destination, project_id: projectId,
        from_revision: provisioned.tracking.revision, to_revision: 1,
        trust_added_at: T + 5,
      },
    });
    openProvisionIntent(world.db, {
      pathKey: destKey, operationId: operation.id, expectedRevision: 1, projectId, now: T + 5,
    });
    const trust = addTrustedRoot(world.db, { path: destination, readAuthorization: true, addedBy: 'human', now: T + 5 });
    addRoot(world.db, { scopeKind: 'prj', scopeId: projectId, path: destination, addedBy: 'human', now: T + 5 });
    setIntentConsent(world.db, {
      pathKey: destKey, consentTrustKey: trust.created ? destKey : null,
      consentRootId: listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).find((row) => row.path_key === destKey)?.id ?? null,
      now: T + 5,
    });
    // Una persona revoca y vuelve a autorizar antes de la recuperación: es otra concesión.
    removeTrustedRootByKey(world.db, { pathKey: destKey, removedBy: 'human', now: T + 6 });
    const recreated = addTrustedRoot(world.db, { path: destination, readAuthorization: true, addedBy: 'human', now: T + 10 });
    assert.equal(recreated.changed, true);
    assert.equal(recreated.root.addedAt, T + 10);

    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 11 });
    assert.equal(summary.abandoned, 1);
    const current = listTrustedRoots(world.db).find((entry) => entry.pathKey === destKey);
    assert.equal(current.state, 'trusted', 'la concesión recreada no se retira');
    assert.equal(current.addedAt, T + 10);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('H-01 · recuperación antes del rebind compensa el destino y deja una sola raíz', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const destination = join(world.base, 'destino-h01');
    mkdirSync(destination, { recursive: true });
    const destKey = pathKeyFor(destination);

    // Caída después de crear consentimiento y raíz en destino, ANTES del rebind.
    const operation = beginOperation(world.db, {
      kind: 'move', now: T + 5,
      detail: {
        from_path_key: world.pathKey, to_path_key: destKey, project_id: projectId,
        from_revision: provisioned.tracking.revision, to_revision: 1,
      },
    });
    openProvisionIntent(world.db, {
      pathKey: destKey, operationId: operation.id, expectedRevision: 1, projectId, now: T + 5,
    });
    const trust = addTrustedRoot(world.db, { path: destination, readAuthorization: true, addedBy: 'human', now: T + 5 });
    const root = addRoot(world.db, { scopeKind: 'prj', scopeId: projectId, path: destination, addedBy: 'human', now: T + 5 });
    setIntentConsent(world.db, {
      pathKey: destKey, consentTrustKey: trust.created ? destKey : null, consentRootId: root.id, now: T + 5,
    });
    for (const step of ['verify', 'consent', 'root']) {
      recordStep(world.db, { operationId: operation.id, step, state: 'done', now: T + 5 });
    }

    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 6 });
    assert.equal(summary.moves, 1);
    assert.equal(summary.abandoned, 1);
    assert.equal(getOperation(world.db, operation.id).state, 'failed');
    assert.equal(getProvisionIntent(world.db, destKey).state, 'abandoned');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1,
      'queda sólo la raíz de origen: el planificador no puede indexar dos carpetas');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId })[0].path_key, world.pathKey);
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === destKey), undefined,
      'la confianza creada por el acto fallido no sobrevive');
    const compensatedIntent = getProvisionIntent(world.db, destKey);
    assert.equal(compensatedIntent.consentRootId, null, 'la procedencia no sobrevive a la compensación');
    assert.equal(compensatedIntent.consentTrustKey, null);

    // Y el intento puede repetirse sin restaurar nada por administración.
    const moved = moveWorkspaceMemory(world.db, {
      profileRoot: world.root, profileKey: 'lifecycle-test',
      pathKey: world.pathKey, newPath: destination,
      expectedRevision: provisioned.tracking.revision, now: T + 7,
    });
    assert.equal(moved.tracking.projectId, projectId);
    assert.equal(readTracking(world.db, { pathKey: destKey }).association, 'explicit');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('recuperación: no compensa una operación de movimiento que sigue viva en otro proceso', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const destination = join(world.base, 'destino-vivo');
    mkdirSync(destination, { recursive: true });
    const destKey = pathKeyFor(destination);
    const operation = beginOperation(world.db, {
      kind: 'move', now: T + 5,
      detail: {
        from_path_key: world.pathKey, from_path: world.ws,
        to_path_key: destKey, to_path: destination, project_id: projectId,
        from_revision: provisioned.tracking.revision, to_revision: 1, owner_pid: process.pid,
      },
    });
    openProvisionIntent(world.db, {
      pathKey: destKey, operationId: operation.id, expectedRevision: 1, projectId, now: T + 5,
    });
    const destTrust = addTrustedRoot(world.db, { path: destination, readAuthorization: true, addedBy: 'human', now: T + 5 });
    const destRoot = addRoot(world.db, {
      scopeKind: 'prj', scopeId: projectId, path: destination, addedBy: 'human', now: T + 5,
    });
    setIntentConsent(world.db, {
      pathKey: destKey, consentTrustKey: destTrust.created ? destKey : null, consentRootId: destRoot.id, now: T + 5,
    });

    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 6 });
    assert.equal(summary.skipped, 1, 'la operación viva no se toca');
    assert.equal(getOperation(world.db, operation.id).state, 'started');
    assert.equal(getProvisionIntent(world.db, destKey).state, 'open');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 2,
      'el destino no se compensa a mitad del movimiento vivo');
    assert.ok(listTrustedRoots(world.db).find((entry) => entry.pathKey === destKey && entry.state === 'trusted'));
  } finally {
    world.close();
    world.cleanup();
  }
});

test('recuperación: un fallo de E/S al compensar no aborta las demás intenciones', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const destination = join(world.base, 'destino-fallo-compensacion');
    mkdirSync(destination, { recursive: true });
    const destKey = pathKeyFor(destination);
    const operation = beginOperation(world.db, {
      kind: 'move', now: T + 5,
      detail: {
        from_path_key: world.pathKey, from_path: world.ws,
        to_path_key: destKey, to_path: destination, project_id: projectId,
        from_revision: provisioned.tracking.revision, to_revision: 1,
      },
    });
    openProvisionIntent(world.db, {
      pathKey: destKey, operationId: operation.id, expectedRevision: 1, projectId, now: T + 5,
    });
    const trust = addTrustedRoot(world.db, { path: destination, readAuthorization: true, addedBy: 'human', now: T + 5 });
    const root = addRoot(world.db, {
      scopeKind: 'prj', scopeId: projectId, path: destination, addedBy: 'human', now: T + 5,
    });
    setIntentConsent(world.db, {
      pathKey: destKey, consentTrustKey: trust.created ? destKey : null, consentRootId: root.id, now: T + 5,
    });
    world.db.exec(`CREATE TRIGGER fail_root_delete BEFORE DELETE ON roots BEGIN
      SELECT RAISE(ABORT, 'io-root'); END;`);
    let summary;
    try {
      summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 6 });
    } finally {
      world.db.exec('DROP TRIGGER fail_root_delete');
    }
    assert.equal(summary.skipped, 1);
    assert.equal(getOperation(world.db, operation.id).state, 'started');
    assert.equal(getProvisionIntent(world.db, destKey).state, 'open');

    const retry = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'lifecycle-test', now: T + 7 });
    assert.equal(retry.abandoned, 1);
    assert.equal(getOperation(world.db, operation.id).state, 'failed');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('H-01-R · un rebind que falla por CAS compensa el destino y permite reintentar', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const destination = join(world.base, 'destino-h01r');
    mkdirSync(destination, { recursive: true });
    const destKey = pathKeyFor(destination);

    // Otro escritor cambia la revisión justo entre `root` y `rebind`: el CAS del rebind debe fallar.
    world.db.exec(`CREATE TRIGGER bump_revision AFTER INSERT ON roots BEGIN
      UPDATE workspace_tracking SET revision = revision + 1 WHERE path_key = '${world.pathKey}';
    END;`);
    try {
      assert.throws(
        () => moveWorkspaceMemory(world.db, {
          profileRoot: world.root, profileKey: 'lifecycle-test',
          pathKey: world.pathKey, newPath: destination,
          expectedRevision: provisioned.tracking.revision, now: T + 5,
        }),
        (error) => {
          assert.equal(error.code, 'revision-conflict');
          return true;
        },
      );
    } finally {
      world.db.exec('DROP TRIGGER bump_revision');
    }

    // El fallo normal del CAS no puede dejar la raíz/confianza de destino vivas.
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1);
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId })[0].path_key, world.pathKey);
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === destKey), undefined);
    assert.equal(readTracking(world.db, { pathKey: destKey }), null);
    const after = readTracking(world.db, { pathKey: world.pathKey });
    assert.equal(after.revision, provisioned.tracking.revision + 1, 'el trigger cambió la revisión');
    assert.equal(getProvisionIntent(world.db, destKey).state, 'abandoned');
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind='move'").get().n, 1);

    // Y el reintento con la revisión vigente funciona sin administración.
    const moved = moveWorkspaceMemory(world.db, {
      profileRoot: world.root, profileKey: 'lifecycle-test',
      pathKey: world.pathKey, newPath: destination,
      expectedRevision: after.revision, now: T + 6,
    });
    assert.equal(moved.tracking.projectId, projectId);
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('H-01-R2 · raíz y procedencia son atómicas: si falla la segunda, no queda raíz', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const destination = join(world.base, 'destino-h01r2');
    mkdirSync(destination, { recursive: true });
    const destKey = pathKeyFor(destination);

    // La confianza del paso `consent` se permite; la escritura de `consent_root_id` se aborta, que es
    // la ventana entre `addRoot` y `setIntentConsent`. La transacción debe revertir la raíz.
    world.db.exec(`CREATE TRIGGER block_root_consent BEFORE UPDATE ON provision_intents
      WHEN NEW.consent_root_id IS NOT NULL AND OLD.consent_root_id IS NULL
      BEGIN SELECT RAISE(ABORT, 'blocked-root-consent'); END;`);
    try {
      assert.throws(
        () => moveWorkspaceMemory(world.db, {
          profileRoot: world.root, profileKey: 'lifecycle-test',
          pathKey: world.pathKey, newPath: destination,
          expectedRevision: provisioned.tracking.revision, now: T + 5,
        }),
      );
    } finally {
      world.db.exec('DROP TRIGGER block_root_consent');
    }
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1,
      'la raíz del destino se revirtió con la procedencia');
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === destKey), undefined,
      'la confianza del acto fallido también se compensa');
    assert.equal(readTracking(world.db, { pathKey: destKey }), null);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('F-01 · si la intención se cierra entre pasos, la raíz no se commitea sin procedencia', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const projectId = provisioned.tracking.projectId;
    const destination = join(world.base, 'destino-f01');
    mkdirSync(destination, { recursive: true });
    const destKey = pathKeyFor(destination);

    // Otro escritor (o una recuperación) cierra la intención entre `addRoot` y `setIntentConsent`.
    world.db.exec(`CREATE TRIGGER abandon_move_intent AFTER INSERT ON roots BEGIN
      UPDATE provision_intents SET state = 'abandoned' WHERE path_key = '${destKey}';
    END;`);
    try {
      assert.throws(
        () => moveWorkspaceMemory(world.db, {
          profileRoot: world.root, profileKey: 'lifecycle-test',
          pathKey: world.pathKey, newPath: destination,
          expectedRevision: provisioned.tracking.revision, now: T + 5,
        }),
        (error) => {
          assert.equal(error.code, 'move-failed');
          assert.equal(error.details.cause, 'operation-uncertain');
          return true;
        },
      );
    } finally {
      world.db.exec('DROP TRIGGER abandon_move_intent');
    }
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1,
      'la raíz no puede quedar sin procedencia');
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === destKey), undefined);
    assert.equal(readTracking(world.db, { pathKey: destKey }), null);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('F-01b · provisión: una raíz sin procedencia no se commitea', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    world.db.exec(`CREATE TRIGGER abandon_provision_intent AFTER INSERT ON roots BEGIN
      UPDATE provision_intents SET state = 'abandoned' WHERE path_key = '${world.pathKey}';
    END;`);
    try {
      assert.throws(
        () => world.provision({ expectedRevision: 1 }),
        (error) => {
          assert.equal(error.code, 'provisioning-failed');
          assert.equal(error.details.cause, 'operation-uncertain');
          return true;
        },
      );
    } finally {
      world.db.exec('DROP TRIGGER abandon_provision_intent');
    }
    assert.equal(listRoots(world.db, { scopeKind: 'prj' }).length, 0, 'la raíz se revirtió');
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === world.pathKey), undefined);
    assert.equal(world.count('projects'), 1);
    assert.equal(world.db.prepare('SELECT status FROM projects').get().status, 'archived');
    assert.equal(getProvisionIntent(world.db, world.pathKey).state, 'abandoned');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('clone: una copia de la carpeta crea identidad y almacén independientes', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const first = world.provision({ expectedRevision: 1 });
    writeFileSync(join(world.other, 'doc.md'), readFileSync(join(world.ws, 'doc.md')));
    world.track(world.other);
    const second = world.provision({ path: world.other, expectedRevision: 1 });
    assert.notEqual(second.tracking.projectId, first.tracking.projectId, 'el clon no adopta la identidad');
    assert.equal(world.count('projects'), 2);
    assert.equal(world.count('workspace_tracking'), 2);
    assert.equal(scopeStoreExists(world.root, first.tracking.projectId), true);
    assert.equal(scopeStoreExists(world.root, second.tracking.projectId), true);
    assert.equal(listRoots(world.db).length, 2);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('la ruta vieja que reaparece tras un movimiento no se indexa ni se asocia', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const destination = join(world.base, 'destino-reaparece');
    mkdirSync(destination, { recursive: true });
    moveWorkspaceMemory(world.db, {
      profileRoot: world.root, profileKey: 'lifecycle-test',
      pathKey: world.pathKey, newPath: destination,
      expectedRevision: provisioned.tracking.revision, now: T + 5,
    });
    // La carpeta vieja vuelve con contenido: no tiene fila, no tiene raíz y no debe resucitar.
    mkdirSync(world.ws, { recursive: true });
    writeFileSync(join(world.ws, 'doc.md'), '# Doc\n\ncontenido resucitado\n', 'utf8');
    assert.equal(readTracking(world.db, { pathKey: world.pathKey }), null);
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: provisioned.tracking.projectId })
      .some((root) => root.path_key === world.pathKey), false);
    assert.equal(world.count('workspace_tracking'), 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('la ruta vieja puede volver a seguirse con una identidad nueva, sin reclamar la memoria movida', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    const provisioned = world.provision({ expectedRevision: 1 });
    const oldProject = provisioned.tracking.projectId;
    const destination = join(world.base, 'destino-reuso');
    mkdirSync(destination, { recursive: true });
    moveWorkspaceMemory(world.db, {
      profileRoot: world.root, profileKey: 'lifecycle-test',
      pathKey: world.pathKey, newPath: destination,
      expectedRevision: provisioned.tracking.revision, now: T + 5,
    });
    mkdirSync(world.ws, { recursive: true });
    writeFileSync(join(world.ws, 'doc.md'), '# Nuevo comienzo\n\n', 'utf8');

    world.track(world.ws);
    const again = world.provision({ expectedRevision: 1 });
    assert.equal(again.memory.state, 'ready');
    assert.notEqual(again.tracking.projectId, oldProject, 'la identidad vieja no se reutiliza');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: oldProject }).length, 1,
      'la memoria movida conserva su única raíz');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: again.tracking.projectId })[0].path_key, world.pathKey);
    const revoked = revokeReadAccess(world.db, {
      profileRoot: world.root, pathKey: world.pathKey,
      expectedRevision: again.tracking.revision, now: T + 9,
    });
    assert.equal(revoked.changed, true);
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === world.pathKey).state, 'revoked',
      'la confianza reactivada por el acto nuevo vuelve a ser revocable');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: again.tracking.projectId }).length, 0);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('memoria ausente: reprovisionar recrea el almacén del MISMO proyecto', () => {
  const world = makeWorld();
  try {
    world.track(world.ws);
    const first = world.provision({ expectedRevision: 1 });
    const projectId = first.tracking.projectId;
    rmSync(join(world.root, 'scopes', projectId, 'rag.sqlite3'), { force: true });
    assert.equal(scopeStoreExists(world.root, projectId), false);
    const memory = memoryForTracking(world.db, {
      profileRoot: world.root, row: readTracking(world.db, { pathKey: world.pathKey }),
    });
    assert.equal(memory.state, 'store-missing');

    const again = world.provision({ expectedRevision: first.tracking.revision });
    assert.equal(again.tracking.projectId, projectId, 'no se inventa otro proyecto');
    assert.equal(scopeStoreExists(world.root, projectId), true);
    assert.equal(world.count('projects'), 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('F-04: si la compensación no puede borrar la raíz, deja limpieza durable y no sincroniza', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.track(world.ws);
    world.db.exec(`CREATE TRIGGER fail_assoc BEFORE UPDATE ON workspace_tracking
      BEGIN SELECT RAISE(ABORT, 'io-track'); END;`);
    world.db.exec(`CREATE TRIGGER fail_root_delete BEFORE DELETE ON roots
      BEGIN SELECT RAISE(ABORT, 'io-root'); END;`);
    assert.throws(
      () => provisionWorkspaceMemory(world.db, {
        profileRoot: world.root, profileKey: 'lifecycle-test', path: world.ws,
        pathKey: world.pathKey, expectedRevision: 1, trackingCreated: true, now: T + 1,
      }),
      (error) => error?.details?.retryable === false,
    );
    world.db.exec('DROP TRIGGER fail_assoc');
    world.db.exec('DROP TRIGGER fail_root_delete');
    const cleanup = world.db.prepare("SELECT state FROM operations WHERE kind = 'cleanup'").all();
    assert.equal(cleanup.length, 1);
    assert.equal(cleanup[0].state, 'started');
    assert.equal(activeSyncScopes(world.db).length, 0, 'la limpieza pendiente excluye el proyecto del sync');
  } finally {
    world.close();
    world.cleanup();
  }
});
