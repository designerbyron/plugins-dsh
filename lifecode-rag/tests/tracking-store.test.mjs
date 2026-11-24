/**
 * UX-2.2 · Almacén transaccional del seguimiento (registro v3).
 *
 * Qué se demuestra: CAS con `BEGIN IMMEDIATE` en creación y borrado (409 sin escribir), no-op
 * idempotente sin revisión nueva, reasociación auditada con proyecto anterior y nuevo, y una
 * reconciliación que **sólo** escribe el eje B y se audita como acción del Host —sin ninguna entrada
 * `actor='human'`— sin crear filas nunca.
 *
 * Cada caso abre su propio registro en una caja temporal; nada de esto toca `~/.dsh` ni el almacén
 * real, y cada cierre verifica la cadena de auditoría.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  closeRegistry, createProject, openRegistry, verifyRegistryAudit,
} from '../lib/registry.mjs';
import {
  applyTracking, countTracking, listTracking, readTracking, reconcileTracking, removeTracking,
} from '../lib/tracking-store.mjs';
import { trackingCounts } from '../lib/tracking.mjs';

const T0 = 1_700_000_000_000;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lcr-tracking-store-'));
  const { db } = openRegistry({ root, create: true, now: T0 });
  const alfa = createProject(db, { name: 'Alfa', now: T0 + 1 });
  const beta = createProject(db, { name: 'Beta', now: T0 + 2 });
  return {
    root, db, alfa, beta,
    cleanup() {
      closeRegistry(db);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function rawRow(world, pathKey) {
  return world.db.prepare('SELECT * FROM workspace_tracking WHERE path_key = ?').get(pathKey) ?? null;
}

function auditRows(world) {
  return world.db.prepare('SELECT seq, action, actor, target, detail FROM audit_registry ORDER BY seq').all()
    .map((row) => ({ ...row, detail: row.detail === null ? null : JSON.parse(row.detail) }));
}

function trackingAudit(world) {
  return auditRows(world).filter((row) => !row.action.startsWith('selection.') && row.target !== null);
}

const KEY_A = 'c:/workspaces/alfa';
const KEY_B = 'c:/workspaces/beta';

function create(world, overrides = {}) {
  return applyTracking(world.db, {
    pathKey: KEY_A,
    path: 'C:\\Workspaces\\Alfa',
    workspaceId: 'ws-1',
    state: 'on',
    projectId: world.alfa.id,
    expectedRevision: 0,
    now: T0 + 100,
    ...overrides,
  });
}

test('crear con expectedRevision 0: revisión 1, asociación explícita y auditoría enable', () => {
  const world = fixture();
  try {
    const result = create(world);
    assert.equal(result.changed, true);
    assert.equal(result.revision, 1);
    assert.equal(result.item.pathKey, KEY_A);
    assert.equal(result.item.state, 'on');
    assert.equal(result.item.association, 'explicit');
    assert.equal(result.item.boundBy, 'human');
    assert.equal(result.item.boundAt, T0 + 100);
    assert.equal(result.item.updatedAt, T0 + 100);
    assert.equal(result.item.lastStatus, null, 'sin reconciliar todavía');
    assert.equal(result.item.resolves, false);

    const raw = rawRow(world, KEY_A);
    assert.equal(raw.revision, 1);
    assert.equal(raw.bound_by, 'human');
    assert.equal(raw.workspace_id, 'ws-1');

    const audit = trackingAudit(world);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'enable');
    assert.equal(audit[0].actor, 'human');
    assert.equal(audit[0].target, KEY_A);
    assert.deepEqual(audit[0].detail.next, { state: 'on', projectId: world.alfa.id, association: 'explicit' });
    assert.equal(audit[0].detail.previous, null);
    assert.equal(verifyRegistryAudit(world.db).ok, true);

    // Sin proyecto: se puede seguir, pero la asociación queda pendiente.
    const orphan = create(world, { pathKey: KEY_B, path: 'C:\\Workspaces\\Beta', projectId: null });
    assert.equal(orphan.item.association, 'pending');
    assert.equal(orphan.item.projectId, null);
    assert.equal(orphan.item.resolves, false, 'seguido sin proyecto no resuelve');
    assert.equal(trackingAudit(world).length, 2);
  } finally { world.cleanup(); }
});

test('un clic repetido no crea revisión ni entrada de auditoría', () => {
  const world = fixture();
  try {
    create(world);
    const before = auditRows(world).length;
    const again = create(world, { expectedRevision: 1, now: T0 + 200 });
    assert.equal(again.changed, false);
    assert.equal(again.revision, 1);
    assert.equal(rawRow(world, KEY_A).revision, 1);
    assert.equal(rawRow(world, KEY_A).updated_at, String(T0 + 100), 'un no-op no reescribe la fila');
    assert.equal(auditRows(world).length, before, 'un no-op no audita');
    // La ruta literal queda congelada: un PUT no la reescribe; la reconciliación es la única dueña.
    const withPath = create(world, { expectedRevision: 1, path: 'C:\\Otra\\Ruta\\Alfa', now: T0 + 250 });
    assert.equal(withPath.changed, false);
    assert.equal(rawRow(world, KEY_A).path, 'C:\\Workspaces\\Alfa');
  } finally { world.cleanup(); }
});

test('revisión obsoleta o fila ya existente: 409 y nada escrito', () => {
  const world = fixture();
  try {
    create(world);
    const before = rawRow(world, KEY_A);
    const auditBefore = auditRows(world).length;

    assert.throws(
      () => applyTracking(world.db, {
        pathKey: KEY_A, state: 'paused', expectedRevision: 7, now: T0 + 300,
      }),
      (error) => {
        assert.equal(error.code, 'revision-conflict');
        assert.equal(error.details.expectedRevision, 7);
        assert.equal(error.details.currentRevision, 1);
        return true;
      },
    );
    // «Espero que no exista» sobre una fila que existe también es conflicto, no un INSERT.
    assert.throws(() => create(world, { expectedRevision: 0 }), (error) => error.code === 'revision-conflict');
    assert.deepEqual(rawRow(world, KEY_A), before, 'la fila no cambió');
    assert.equal(auditRows(world).length, auditBefore, 'un conflicto no audita');
  } finally { world.cleanup(); }
});

test('expectedRevision > 0 sobre una fila ausente es conflicto, no una creación silenciosa', () => {
  const world = fixture();
  try {
    assert.throws(() => create(world, { expectedRevision: 3 }), (error) => {
      assert.equal(error.code, 'revision-conflict');
      assert.equal(error.details.currentRevision, 0);
      return true;
    });
    assert.equal(readTracking(world.db, { pathKey: KEY_A }), null);
  } finally { world.cleanup(); }
});

test('las transiciones del eje A se auditan con su acción y suben la revisión una vez', () => {
  const world = fixture();
  try {
    create(world);
    const paused = applyTracking(world.db, {
      pathKey: KEY_A, state: 'paused', expectedRevision: 1, now: T0 + 200,
    });
    assert.equal(paused.revision, 2);
    assert.equal(paused.item.state, 'paused');
    assert.equal(paused.item.resolves, false, 'paused no resuelve');

    const resumed = applyTracking(world.db, { pathKey: KEY_A, state: 'on', expectedRevision: 2, now: T0 + 300 });
    assert.equal(resumed.revision, 3);
    const disabled = applyTracking(world.db, { pathKey: KEY_A, state: 'off', expectedRevision: 3, now: T0 + 400 });
    assert.equal(disabled.revision, 4);

    // `off → paused` no existe: se rechaza antes de escribir y no deja auditoría.
    const before = rawRow(world, KEY_A);
    assert.throws(
      () => applyTracking(world.db, { pathKey: KEY_A, state: 'paused', expectedRevision: 4, now: T0 + 450 }),
      (error) => {
        assert.equal(error.code, 'invalid-argument');
        assert.equal(error.details.reason, 'invalid-transition');
        return true;
      },
    );
    assert.deepEqual(rawRow(world, KEY_A), before);
    assert.equal(trackingAudit(world).length, 4);

    const enabled = applyTracking(world.db, { pathKey: KEY_A, state: 'on', expectedRevision: 4, now: T0 + 500 });
    assert.equal(enabled.revision, 5);

    assert.deepEqual(
      trackingAudit(world).map((row) => row.action),
      ['enable', 'pause', 'resume', 'disable', 'enable'],
    );
    assert.equal(verifyRegistryAudit(world.db).ok, true);
  } finally { world.cleanup(); }
});

test('reasociar se audita con el proyecto anterior y el nuevo, y no toca nada más', () => {
  const world = fixture();
  try {
    create(world);
    const rebound = applyTracking(world.db, {
      pathKey: KEY_A, state: 'on', projectId: world.beta.id, expectedRevision: 1, now: T0 + 700,
    });
    assert.equal(rebound.changed, true);
    assert.equal(rebound.revision, 2);
    assert.equal(rebound.item.projectId, world.beta.id);
    assert.equal(rebound.item.association, 'explicit');
    assert.equal(rebound.item.boundAt, T0 + 700, 'el vínculo nuevo tiene su momento');

    const reboundAudit = trackingAudit(world).at(-1);
    assert.equal(reboundAudit.action, 'reassociate');
    assert.equal(reboundAudit.actor, 'human');
    assert.equal(reboundAudit.detail.pathKey, KEY_A);
    assert.equal(reboundAudit.detail.previous.projectId, world.alfa.id);
    assert.equal(reboundAudit.detail.next.projectId, world.beta.id);
    // Sólo hay dos entradas: crear y reasociar. No se audita un cambio de estado que no ocurrió.
    assert.deepEqual(trackingAudit(world).map((row) => row.action), ['enable', 'reassociate']);
    assert.equal(verifyRegistryAudit(world.db).ok, true);
  } finally { world.cleanup(); }
});

test('cambiar estado y proyecto a la vez deja dos entradas de auditoría', () => {
  const world = fixture();
  try {
    create(world);
    const both = applyTracking(world.db, {
      pathKey: KEY_A, state: 'paused', projectId: null, expectedRevision: 1, now: T0 + 800,
    });
    assert.equal(both.revision, 2);
    assert.equal(both.item.state, 'paused');
    assert.equal(both.item.projectId, null);
    assert.equal(both.item.association, 'pending');

    const actions = trackingAudit(world).map((row) => row.action);
    assert.deepEqual(actions, ['enable', 'pause', 'reassociate']);
    const reassociate = trackingAudit(world).at(-1);
    assert.equal(reassociate.detail.previous.projectId, world.alfa.id);
    assert.equal(reassociate.detail.next.projectId, null);
    assert.equal(reassociate.detail.next.association, 'pending');
  } finally { world.cleanup(); }
});

test('removeTracking exige CAS, borra sólo la fila y audita disable con lo anterior', () => {
  const world = fixture();
  try {
    create(world);
    assert.throws(() => removeTracking(world.db, { pathKey: KEY_A, expectedRevision: 4, now: T0 + 900 }), (error) => {
      assert.equal(error.code, 'revision-conflict');
      assert.equal(error.details.currentRevision, 1);
      return true;
    });
    assert.ok(rawRow(world, KEY_A), 'el conflicto no borra');

    const removed = removeTracking(world.db, { pathKey: KEY_A, expectedRevision: 1, now: T0 + 900 });
    assert.equal(removed.changed, true);
    assert.equal(removed.removed.state, 'on');
    assert.equal(readTracking(world.db, { pathKey: KEY_A }), null);

    const audit = trackingAudit(world).at(-1);
    assert.equal(audit.action, 'disable');
    assert.equal(audit.actor, 'human');
    assert.equal(audit.detail.removed, true);
    assert.equal(audit.detail.previous.state, 'on');
    assert.equal(audit.detail.previous.revision, 1);

    assert.throws(() => removeTracking(world.db, { pathKey: KEY_A, expectedRevision: 1 }), (error) => {
      assert.equal(error.code, 'not-found');
      return true;
    });
    assert.equal(verifyRegistryAudit(world.db).ok, true);
  } finally { world.cleanup(); }
});

test('reconciliar escribe sólo el eje B, no crea filas y audita como host una sola vez', () => {
  const world = fixture();
  try {
    create(world);
    create(world, { pathKey: KEY_B, path: 'C:\\Workspaces\\Beta', state: 'off', projectId: null, now: T0 + 110 });
    const beforeA = rawRow(world, KEY_A);
    const beforeB = rawRow(world, KEY_B);
    const humanBefore = auditRows(world).filter((row) => row.actor === 'human').length;
    const auditBefore = auditRows(world).length;

    const result = reconcileTracking(world.db, {
      present: [{ pathKey: KEY_A, path: 'C:\\Workspaces\\Alfa-renombrada' }],
      absent: [KEY_B],
      unknown: ['c:/workspaces/nunca-seguido'],
      measuredAt: T0 + 1_000,
    });
    assert.equal(result.changed, 2);
    assert.equal(result.checked, 2);
    assert.equal(result.ok, 1);
    assert.equal(result.missing, 1);
    assert.equal(result.unknown, 0);
    assert.equal(result.skipped, 1, 'una ruta nunca seguida no se inventa');

    const afterA = rawRow(world, KEY_A);
    const afterB = rawRow(world, KEY_B);
    // Eje B: sí.
    assert.equal(afterA.last_status, 'ok');
    assert.equal(afterA.last_seen_at, String(T0 + 1_000));
    assert.equal(afterA.path, 'C:\\Workspaces\\Alfa-renombrada');
    assert.equal(afterB.last_status, 'missing');
    // Eje A y contabilidad: intactos.
    assert.equal(afterA.state, beforeA.state);
    assert.equal(afterA.project_id, beforeA.project_id);
    assert.equal(afterA.revision, beforeA.revision, 'la reconciliación no sube la revisión');
    assert.equal(afterA.updated_at, beforeA.updated_at, 'la reconciliación no reescribe updated_at');
    assert.equal(afterA.bound_at, beforeA.bound_at);
    assert.equal(afterB.state, 'off');
    assert.equal(afterB.revision, beforeB.revision);
    assert.equal(trackingCounts(listTracking(world.db)).missing, 1);

    // Auditoría: una sola fila, del Host, y ninguna humana nueva.
    const added = auditRows(world).slice(auditBefore);
    assert.equal(added.length, 1);
    assert.equal(added[0].action, 'tracking.reconcile');
    assert.equal(added[0].actor, 'host');
    assert.equal(added[0].detail.checked, 2);
    assert.equal(added[0].detail.ok, 1);
    assert.equal(added[0].detail.missing, 1);
    assert.equal(added[0].detail.unknown, 0);
    assert.equal(auditRows(world).filter((row) => row.actor === 'human').length, humanBefore);

    // Repetir con la misma medición no cambia filas, pero sí deja su entrada (una por llamada).
    const again = reconcileTracking(world.db, {
      present: [{ pathKey: KEY_A, path: 'C:\\Workspaces\\Alfa-renombrada' }],
      absent: [KEY_B],
      measuredAt: T0 + 1_000,
    });
    assert.equal(again.changed, 0);
    assert.equal(auditRows(world).at(-1).action, 'tracking.reconcile');
    assert.equal(auditRows(world).at(-1).actor, 'host');
    assert.equal(verifyRegistryAudit(world.db).ok, true);
  } finally { world.cleanup(); }
});

test('unknown no borra la fila ni la deja como no seguida', () => {
  const world = fixture();
  try {
    create(world);
    reconcileTracking(world.db, { present: [{ pathKey: KEY_A }], measuredAt: T0 + 1_000 });
    const seen = rawRow(world, KEY_A);
    assert.equal(seen.last_status, 'ok');

    const doubt = reconcileTracking(world.db, { unknown: [KEY_A], measuredAt: T0 + 2_000 });
    assert.equal(doubt.changed, 1);
    const after = rawRow(world, KEY_A);
    assert.equal(after.last_status, 'unknown');
    assert.equal(after.last_seen_at, seen.last_seen_at, 'una duda no borra la última vez visto');
    assert.equal(after.state, 'on');
    assert.equal(after.revision, seen.revision);
    assert.ok(readTracking(world.db, { pathKey: KEY_A }), 'la fila sigue existiendo');

    const gone = reconcileTracking(world.db, { absent: [KEY_A], measuredAt: T0 + 3_000 });
    assert.equal(gone.changed, 1);
    const missing = rawRow(world, KEY_A);
    assert.equal(missing.last_status, 'missing');
    assert.equal(missing.state, 'on', 'missing no es off');
    assert.equal(readTracking(world.db, { pathKey: KEY_A }).resolves, false);
    assert.equal(verifyRegistryAudit(world.db).ok, true);
  } finally { world.cleanup(); }
});

test('listTracking filtra por estado y proyecto, y readTracking no inventa filas', () => {
  const world = fixture();
  try {
    create(world);
    create(world, { pathKey: KEY_B, state: 'paused', projectId: null, now: T0 + 120 });
    create(world, { pathKey: 'c:/workspaces/gamma', state: 'off', projectId: world.beta.id, now: T0 + 130 });

    assert.equal(listTracking(world.db).length, 3);
    assert.deepEqual(listTracking(world.db, { state: 'on' }).map((row) => row.pathKey), [KEY_A]);
    assert.deepEqual(listTracking(world.db, { state: 'paused' }).map((row) => row.pathKey), [KEY_B]);
    assert.deepEqual(listTracking(world.db, { projectId: null }).map((row) => row.pathKey), [KEY_B]);
    assert.deepEqual(listTracking(world.db, { projectId: world.beta.id }).map((row) => row.pathKey), ['c:/workspaces/gamma']);
    assert.equal(listTracking(world.db, { limit: 2 }).length, 2);
    assert.equal(listTracking(world.db, { limit: 10_000 }).length, 3);
    assert.deepEqual(
      listTracking(world.db, { projectId: 'prj_01M7RBSRD33M26HGBEFW51WPP9' }),
      [],
      'filtrar por un proyecto desconocido es una lista vacía, no un error',
    );

    assert.throws(() => listTracking(world.db, { state: 'seguido' }), (error) => error.code === 'invalid-argument');
    assert.throws(() => listTracking(world.db, { limit: 0 }), (error) => error.code === 'invalid-argument');
    assert.equal(readTracking(world.db, { pathKey: 'c:/workspaces/inexistente' }), null);
    assert.throws(() => readTracking(world.db, {}), (error) => error.code === 'invalid-argument');
  } finally { world.cleanup(); }
});

test('el almacén rechaza al Host y los cuerpos inválidos, sin escribir', () => {
  const world = fixture();
  try {
    assert.throws(() => create(world, { actor: 'host' }), (error) => {
      assert.equal(error.code, 'invalid-argument');
      assert.equal(error.details.reason, 'actor-not-allowed');
      return true;
    });
    assert.throws(() => applyTracking(world.db, { pathKey: 'k', state: 'on' }), (error) => {
      assert.equal(error.code, 'invalid-argument');
      assert.equal(error.details.field, 'expectedRevision');
      return true;
    });
    assert.throws(() => create(world, { state: 'seguido' }), (error) => error.code === 'invalid-argument');
    assert.throws(() => create(world, { projectId: 'prj_01M7RBSRD33M26HGBEFW51WPP9' }), (error) => {
      assert.equal(error.code, 'invalid-argument');
      assert.equal(error.details.reason, 'unknown-project');
      return true;
    });
    assert.equal(listTracking(world.db).length, 0, 'ninguna petición inválida crea fila');
  } finally { world.cleanup(); }
});

test('el ciclo completo no toca raíces, selección, grants ni sesiones', () => {
  const world = fixture();
  try {
    const others = ['grants', 'libraries', 'pa_selection', 'projects', 'roots', 'session_scope', 'sync_state'];
    const snapshot = () => Object.fromEntries(others.map((table) => [
      table,
      Number(world.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n),
    ]));
    const before = snapshot();
    create(world);
    applyTracking(world.db, { pathKey: KEY_A, state: 'paused', expectedRevision: 1, now: T0 + 200 });
    reconcileTracking(world.db, { present: [KEY_A], measuredAt: T0 + 300 });
    removeTracking(world.db, { pathKey: KEY_A, expectedRevision: 2, now: T0 + 400 });
    assert.deepEqual(snapshot(), before);
    assert.equal(verifyRegistryAudit(world.db).ok, true);
  } finally { world.cleanup(); }
});

/**
 * F15 · Los recuentos salen de SQL sobre el conjunto, no de la página. Se comprueba además que el
 * resultado coincide fila a fila con `trackingCounts`, que sigue siendo el criterio de lectura.
 */
test('countTracking cuenta el conjunto con los mismos filtros que el listado', () => {
  const world = fixture();
  try {
    create(world);
    create(world, { pathKey: KEY_B, state: 'paused', projectId: null, now: T0 + 120 });
    create(world, { pathKey: 'c:/workspaces/gamma', state: 'off', projectId: world.beta.id, now: T0 + 130 });

    assert.deepEqual(countTracking(world.db), trackingCounts(listTracking(world.db)));
    assert.deepEqual(countTracking(world.db), {
      total: 3, on: 1, off: 1, paused: 1,
      ok: 0, missing: 0, unknown: 0, withProject: 2, withoutProject: 1,
    });
    // La página puede ser más corta que el recuento, y el recuento no cambia por ello.
    assert.equal(listTracking(world.db, { limit: 2 }).length, 2);
    assert.equal(countTracking(world.db).total, 3);
    // Los filtros son los mismos que los del listado, con la misma validación.
    assert.deepEqual(countTracking(world.db, { state: 'on' }), {
      total: 1, on: 1, off: 0, paused: 0,
      ok: 0, missing: 0, unknown: 0, withProject: 1, withoutProject: 0,
    });
    assert.equal(countTracking(world.db, { projectId: null }).total, 1);
    assert.equal(countTracking(world.db, { projectId: world.beta.id }).total, 1);
    assert.equal(countTracking(world.db, { projectId: 'prj_01M7RBSRD33M26HGBEFW51WPP9' }).total, 0);
    assert.throws(() => countTracking(world.db, { state: 'seguido' }), (error) => error.code === 'invalid-argument');
  } finally {
    world.cleanup();
  }
});

/**
 * F10 · Contención de SQLite. Una segunda conexión retiene `BEGIN IMMEDIATE`; las tres mutaciones
 * agotan el `busy_timeout` (aquí 25 ms, para no esperar los 5 s de la conexión de producción) y
 * deben salir como `store-busy` reintentable, no como la excepción cruda `database is locked` que el
 * handler respondía `500 internal`. Los `RagError` de validación no se re-etiquetan.
 */
test('F10: la contención de SQLite se traduce a store-busy reintentable', () => {
  const world = fixture();
  const holder = openRegistry({ root: world.root, create: false });
  const isBusy = (error) => {
    assert.equal(error.code, 'store-busy');
    assert.equal(error.details.reason, 'database-locked');
    assert.equal(error.details.retryable, true);
    assert.equal(error.details.errcode, 5, 'SQLITE_BUSY, no corrupción');
    assert.ok(error.cause, 'la causa original queda enlazada');
    return true;
  };
  try {
    holder.db.exec('BEGIN IMMEDIATE');
    world.db.exec('PRAGMA busy_timeout = 25');

    assert.throws(() => create(world), isBusy);
    assert.throws(() => removeTracking(world.db, { pathKey: KEY_A, expectedRevision: 1, now: T0 + 200 }), isBusy);
    assert.throws(() => reconcileTracking(world.db, { present: [KEY_A], measuredAt: T0 + 300 }), isBusy);

    // Nada escrito: la contención ocurre antes de tocar la tabla.
    assert.equal(listTracking(world.db).length, 0);
    assert.equal(auditRows(world).filter((row) => row.actor === 'human').length, 0);

    // La validación sigue siendo `invalid-argument`, no se confunde con contención.
    assert.throws(() => create(world, { state: 'seguido' }), (error) => error.code === 'invalid-argument');
  } finally {
    try { holder.db.exec('ROLLBACK'); } catch { /* el BEGIN puede haber cedido */ }
    closeRegistry(holder.db);
    world.cleanup();
  }
});
