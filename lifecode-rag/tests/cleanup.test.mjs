/**
 * F-02 · limpieza durable del acceso anterior tras un movimiento confirmado.
 *
 * El rebind es un hecho: el movimiento queda `committed`. Si retirar la raíz/confianza vieja falla,
 * la obligación se guarda como una operación `kind='cleanup'` en el journal, sobrevive a reinicios y
 * se reintenta sin duplicar efectos. Nunca toca entradas ajenas.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  addRoot, closeRegistry, createProject, listRoots, openRegistry,
} from '../lib/registry.mjs';
import { pathKeyFor } from '../lib/registry.mjs';
import { addTrustedRoot, listTrustedRoots } from '../lib/trusted-roots.mjs';
import { openScopeStore } from '../lib/scope-stores.mjs';
import { applyTracking, readTracking, removeTracking } from '../lib/tracking-store.mjs';
import { beginOperation, getOperation, recordStep } from '../lib/operations.mjs';
import {
  finishProvisionIntent, getSyncRequest, openProvisionIntent, setIntentConsent,
} from '../lib/provision-store.mjs';
import {
  CLEANUP_KIND, moveWorkspaceMemory, pendingCleanupFor, recoverLifecycle, runAccessCleanup,
} from '../lib/lifecycle.mjs';

const T = 1_700_000_000_000;

function makeWorld() {
  const base = mkdtempSync(join(tmpdir(), 'lcr-cleanup-'));
  const root = join(base, 'perfil');
  const ws = join(base, 'workspace');
  const destination = join(base, 'destino');
  mkdirSync(ws, { recursive: true });
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(ws, 'doc.md'), '# Doc\n\n', 'utf8');
  const { db } = openRegistry({ root, create: true, now: T });
  return {
    base, root, ws, destination, db,
    pathKey: pathKeyFor(ws),
    close() { closeRegistry(db); },
    cleanup() { rmSync(base, { recursive: true, force: true }); },
    track(path) {
      return applyTracking(db, {
        pathKey: pathKeyFor(path), path, state: 'on', projectId: null, expectedRevision: 0, now: T,
      });
    },
    provision() {
      const project = createProject(db, { name: 'Proyecto', now: T });
      const rootEntry = addRoot(db, { scopeKind: 'prj', scopeId: project.id, path: this.ws, addedBy: 'human', now: T });
      addTrustedRoot(db, { path: this.ws, readAuthorization: true, addedBy: 'human', now: T });
      const store = openScopeStore({
        profileRoot: root, profileKey: 'cleanup-test', scope: { kind: 'prj', id: project.id }, create: true, now: T,
      });
      store.close();
      applyTracking(db, {
        pathKey: this.pathKey, path: this.ws, state: 'on', projectId: null, expectedRevision: 0, now: T,
      });
      const operation = beginOperation(db, { kind: 'provision', now: T });
      openProvisionIntent(db, {
        pathKey: this.pathKey, operationId: operation.id, expectedRevision: 1, projectId: project.id, now: T,
      });
      setIntentConsent(db, { pathKey: this.pathKey, consentTrustKey: this.pathKey, consentRootId: rootEntry.id, now: T });
      finishProvisionIntent(db, {
        pathKey: this.pathKey, operationId: operation.id, projectId: project.id, state: 'done', now: T,
      });
      applyTracking(db, {
        pathKey: this.pathKey, path: this.ws, state: 'on', projectId: project.id, expectedRevision: 1, now: T,
      });
      return project.id;
    },
    move(expectedRevision, now = T + 5) {
      return moveWorkspaceMemory(db, {
        profileRoot: root, profileKey: 'cleanup-test',
        pathKey: this.pathKey, newPath: this.destination, expectedRevision, now,
      });
    },
  };
}

function pending(db) {
  return db.prepare(`SELECT * FROM operations WHERE kind = ? AND state = 'started'`).all(CLEANUP_KIND);
}

function markOwnerGone(db, operationId) {
  const row = db.prepare('SELECT detail FROM operations WHERE id = ?').get(operationId);
  const detail = JSON.parse(row.detail);
  detail.owner_pid = 999999;
  db.prepare('UPDATE operations SET detail = ? WHERE id = ?').run(JSON.stringify(detail), operationId);
}

test('F-02 · fallo al borrar la raíz: el movimiento confirma y la limpieza queda durable', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    const otherProject = createProject(world.db, { name: 'Otro proyecto', now: T });
    const otherDir = join(world.base, 'otro-proyecto');
    mkdirSync(otherDir, { recursive: true });
    const otherRoot = addRoot(world.db, {
      scopeKind: 'prj', scopeId: otherProject.id, path: otherDir, addedBy: 'human', now: T,
    });
    const projectId = world.provision();
    world.db.exec(`CREATE TRIGGER fail_root_delete BEFORE DELETE ON roots BEGIN
      SELECT RAISE(ABORT, 'io-root'); END;`);

    let moved;
    try {
      moved = world.move(2);
    } finally {
      world.db.exec('DROP TRIGGER fail_root_delete');
    }
    assert.equal(moved.tracking.pathKey, pathKeyFor(world.destination), 'el rebind se confirma');
    assert.equal(getOperation(world.db, moved.operationId).state, 'committed');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 2,
      'la raíz vieja sigue ahí: la limpieza es la obligación pendiente');
    const queued = pending(world.db);
    assert.equal(queued.length, 1);
    assert.equal(pendingCleanupFor(world.db, projectId).pending, true);
    markOwnerGone(world.db, queued[0].id);
    const detail = JSON.parse(queued[0].detail);
    assert.equal(detail.from_path_key, world.pathKey);
    assert.equal(detail.project_id, projectId);
    assert.ok(detail.root_id);
    assert.equal(detail.trust_key, world.pathKey);

    // La reprovisión de la ruta vieja con limpieza pendiente se rechaza con `cleanup-pending`;
    // la prueba determinista de esa guarda se hace con la saga real, no con el helper de este test.

    // Reinicio lógico: se cierra y reabre el registro y la recuperación completa la limpieza.
    world.close();
    const opened = openRegistry({ root: world.root, create: false });
    try {
      const summary = recoverLifecycle(opened.db, { profileRoot: world.root, profileKey: 'cleanup-test', now: T + 6 });
      assert.equal(summary.cleanups, 1);
      assert.equal(summary.cleanupErrors, 0);
      assert.equal(listRoots(opened.db, { scopeKind: 'prj', scopeId: projectId }).length, 1);
      assert.equal(listRoots(opened.db, { scopeKind: 'prj', scopeId: projectId })[0].path_key, pathKeyFor(world.destination));
      assert.equal(listTrustedRoots(opened.db).find((entry) => entry.pathKey === world.pathKey).state, 'revoked');
      assert.equal(listTrustedRoots(opened.db).find((entry) => entry.pathKey === pathKeyFor(world.base)).state, 'trusted',
        'la confianza preexistente del padre no se toca');
      const keptOther = listRoots(opened.db, { scopeKind: 'prj', scopeId: otherProject.id });
      assert.equal(keptOther.length, 1, 'la raíz de otro proyecto no se toca');
      assert.equal(keptOther[0].id, otherRoot.id);
      assert.equal(pending(opened.db).length, 0);
      const cleaned = getOperation(opened.db, queued[0].id);
      assert.equal(cleaned.state, 'committed');
      assert.equal(JSON.parse(cleaned.detail).cleaned.root.path, world.ws);

      // Doble ejecución: no duplica efectos ni vuelve a abrir la operación.
      const again = recoverLifecycle(opened.db, { profileRoot: world.root, profileKey: 'cleanup-test', now: T + 7 });
      assert.equal(again.cleanups, 0);
      assert.equal(listRoots(opened.db, { scopeKind: 'prj', scopeId: projectId }).length, 1);
    } finally {
      closeRegistry(opened.db);
    }
    // Evita el doble cierre del finally externo.
    world.db = null;
  } finally {
    if (world.db) world.close();
    world.cleanup();
  }
});

test('F-02 · fallo al retirar la confianza: se limpia después, la raíz ya retirada no se toca', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    const projectId = world.provision();
    world.db.exec(`CREATE TRIGGER fail_trust_write BEFORE UPDATE ON meta
      WHEN NEW.key = 'trusted_roots'
       AND NEW.value LIKE '%"state":"revoked"%'
       AND OLD.value NOT LIKE '%"state":"revoked"%'
      BEGIN SELECT RAISE(ABORT, 'io-trust'); END;`);
    let moved;
    try {
      moved = world.move(2);
    } finally {
      world.db.exec('DROP TRIGGER fail_trust_write');
    }
    assert.equal(getOperation(world.db, moved.operationId).state, 'committed');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1,
      'la raíz vieja se retiró antes del fallo de la confianza');
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === world.pathKey).state, 'trusted');
    const queued = pending(world.db);
    assert.equal(queued.length, 1);
    const detail = JSON.parse(queued[0].detail);
    assert.equal(detail.root_id, null, 'no se vuelve a pedir una raíz ya ausente');
    markOwnerGone(world.db, queued[0].id);

    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'cleanup-test', now: T + 6 });
    assert.equal(summary.cleanups, 1);
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === world.pathKey).state, 'revoked');
    assert.equal(pending(world.db).length, 0);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('F-02 · un fallo persistente queda visible y se reintenta; no se declara limpio', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    const projectId = world.provision();
    world.db.exec(`CREATE TRIGGER fail_root_delete BEFORE DELETE ON roots BEGIN
      SELECT RAISE(ABORT, 'io-root'); END;`);
    let moved;
    try {
      moved = world.move(2);
    } finally {
      // El trigger sigue vivo: la limpieza no puede completarse.
    }
    assert.equal(getOperation(world.db, moved.operationId).state, 'committed');
    assert.equal(pending(world.db).length, 1);
    markOwnerGone(world.db, pending(world.db)[0].id);

    const failed = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'cleanup-test', now: T + 6 });
    assert.equal(failed.cleanups, 0);
    assert.equal(failed.cleanupErrors, 1);
    assert.equal(pending(world.db).length, 1, 'la obligación no se pierde');
    const retryAudit = world.db.prepare(`SELECT COUNT(*) AS n FROM audit_registry
      WHERE action = 'access.cleanup.retry'`).get().n;
    assert.equal(retryAudit, 1);

    world.db.exec('DROP TRIGGER fail_root_delete');
    const fixed = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'cleanup-test', now: T + 7 });
    assert.equal(fixed.cleanups, 1);
    assert.equal(pending(world.db).length, 0);
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('F-02 · una limpieza con entradas ya ausentes es idempotente', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    const projectId = world.provision();
    const destination = world.destination;
    world.db.exec(`CREATE TRIGGER fail_root_delete BEFORE DELETE ON roots BEGIN
      SELECT RAISE(ABORT, 'io-root'); END;`);
    let moved;
    try {
      moved = world.move(2);
    } finally {
      world.db.exec('DROP TRIGGER fail_root_delete');
    }
    assert.equal(moved.tracking.pathKey, pathKeyFor(destination));
    const op = pending(world.db)[0];
    // Otra limpieza ya retiró las entradas antes de que esta se ejecute.
    world.db.prepare('DELETE FROM roots WHERE path_key = ?').run(world.pathKey);
    world.db.prepare('UPDATE provision_intents SET consent_root_id = NULL, consent_trust_key = NULL WHERE path_key = ?')
      .run(world.pathKey);
    const result = runAccessCleanup(world.db, { operation: op, now: T + 8 });
    assert.equal(result.state, 'committed');
    assert.equal(result.root, null);
    assert.ok(result.skipped.some((item) => item.kind === 'root' && item.reason === 'already-absent'));
    assert.equal(getOperation(world.db, op.id).state, 'committed');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('F-02 · si la revocación falla durante la recuperación, el rebind queda committed y la limpieza pendiente', () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    const projectId = world.provision();
    const destKey = pathKeyFor(world.destination);
    mkdirSync(world.destination, { recursive: true });
    writeFileSync(join(world.destination, 'doc.md'), '# Destino\n\n', 'utf8');

    // Estado exacto después del rebind: fila nueva, intención destino abierta y operación `move`
    // empezada; la ruta vieja conserva aún raíz y confianza propias. Simula la caída antes de
    // `revoke-old`.
    const operation = beginOperation(world.db, {
      kind: 'move', now: T + 5,
      detail: {
        from_path_key: world.pathKey, from_path: world.ws,
        to_path_key: destKey, to_path: world.destination,
        project_id: projectId, from_revision: 2, to_revision: 1,
      },
    });
    recordStep(world.db, { operationId: operation.id, step: 'revoke-old', state: 'failed', now: T + 5 });
    openProvisionIntent(world.db, {
      pathKey: destKey, operationId: operation.id, expectedRevision: 1, projectId, now: T + 5,
    });
    const destTrust = addTrustedRoot(world.db, { path: world.destination, readAuthorization: true, addedBy: 'human', now: T + 5 });
    const destRoot = addRoot(world.db, {
      scopeKind: 'prj', scopeId: projectId, path: world.destination, addedBy: 'human', now: T + 5,
    });
    setIntentConsent(world.db, {
      pathKey: destKey,
      consentTrustKey: destTrust.created ? destKey : null,
      consentRootId: destRoot.id, now: T + 5,
    });
    const sourceRow = readTracking(world.db, { pathKey: world.pathKey });
    removeTracking(world.db, {
      pathKey: world.pathKey, expectedRevision: sourceRow.revision, now: T + 5,
    });
    applyTracking(world.db, {
      pathKey: destKey, path: world.destination, state: 'on', projectId, expectedRevision: 0, now: T + 5,
    });
    const store = openScopeStore({
      profileRoot: world.root, profileKey: 'cleanup-test',
      scope: { kind: 'prj', id: projectId }, create: false, now: T + 5,
    });
    try {
      store.prepare(`INSERT INTO sources
          (id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at)
        VALUES ('src_recovery_old', 'default', ?, 'Doc', 'text/markdown', ?, 10, 10, '{}', ?, ?, ?)`)
        .run(join(world.ws, 'doc.md'), 'a'.repeat(64), T, T, T);
    } finally {
      store.close();
    }
    world.db.exec(`CREATE TRIGGER fail_root_delete BEFORE DELETE ON roots BEGIN
      SELECT RAISE(ABORT, 'io-root'); END;`);

    let first;
    try {
      first = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'cleanup-test', now: T + 6 });
    } finally {
      world.db.exec('DROP TRIGGER fail_root_delete');
    }
    assert.equal(first.committed, 1, 'el rebind no se convierte en failed');
    assert.equal(first.rekeys, 1, 'el rekey se intenta en la recuperación');
    assert.equal(first.rekeyErrors, 0, 'el rekey no falla en la recuperación');
    assert.equal(getOperation(world.db, operation.id).state, 'committed');
    assert.equal(pending(world.db).length, 1, 'la obligación de limpieza quedó en el journal');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 2,
      'la raíz vieja sigue ahí: la limpieza es la obligación pendiente');
    const afterRekey = openScopeStore({
      profileRoot: world.root, profileKey: 'cleanup-test',
      scope: { kind: 'prj', id: projectId }, create: false, now: T + 6,
    });
    try {
      const source = afterRekey.prepare("SELECT uri FROM sources WHERE id = 'src_recovery_old'").get();
      assert.equal(source.uri, join(world.destination, 'doc.md'),
        'el rekey se completa en la misma recuperación aunque falle la limpieza de acceso');
    } finally {
      afterRekey.close();
    }

    const second = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: 'cleanup-test', now: T + 7 });
    assert.equal(second.cleanups, 1);
    assert.equal(pending(world.db).length, 0);
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1);
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId })[0].path_key, destKey);
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === world.pathKey).state, 'revoked');
    const queuedAfterCleanup = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: projectId });
    assert.ok(queuedAfterCleanup, 'la limpieza vuelve a encolar una pasada de sync');
    assert.equal(queuedAfterCleanup.reason, 'cleanup');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('F-02 · una operación de limpieza sin detalle se cierra failed, no se repite a ciegas', () => {
  const world = makeWorld();
  try {
    const operation = beginOperation(world.db, { kind: CLEANUP_KIND, now: T });
    recordStep(world.db, { operationId: operation.id, step: 'noop', state: 'done', now: T });
    const result = runAccessCleanup(world.db, { operation: { ...operation, detail: null }, now: T + 1 });
    assert.equal(result.state, 'failed');
    assert.equal(getOperation(world.db, operation.id).state, 'failed');
  } finally {
    world.close();
    world.cleanup();
  }
});
