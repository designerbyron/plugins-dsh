/**
 * AGENT-09 · Regresiones de los arreglos de UX-2.2 sobre el registro del perfil.
 *
 * Cubre tres defectos ya cerrados, con el registro REAL (`makeWorld` sobre `mkdtemp`) y el núcleo de
 * resolución real (`lib/resolve.mjs`, `lib/tracking-store.mjs`):
 *
 *   - F2: una identidad de OTRO perfil no escribe nada — ni filas de seguimiento, ni reconciliación.
 *         El rechazo se audita (fail-closed visible), pero antes de medir disponibilidad.
 *   - F4: un workspace cuyo `status()` lanza o devuelve `missing` no se traduce en `last_status='missing'`:
 *         la lista del Host omite lo que no midió (D-IMPL-09), y omitir no es afirmar una ausencia.
 *   - F7: la ruta de una fila se congela al crearla; la reconciliación que dispara `resolveScope` no la
 *         reescribe aunque el Host liste la misma clave con otra capitalización (D-IMPL-07).
 *
 * Perfiles temporales: ninguna prueba toca `~/.dsh`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';

import { pathKeyFor } from '../lib/registry.mjs';
import { listOpenProjects } from '../lib/harness-workspaces.mjs';
import { resolveScope } from '../lib/resolve.mjs';
import { applyTracking, readTracking, reconcileTracking } from '../lib/tracking-store.mjs';
import { makeWorld } from './pa3-helpers.mjs';

const PROFILE = 'pa3-test';
const NOW = 1_700_000_000_000;

function ws(id, path, sessionIds = [], status = () => Promise.resolve('ok')) {
  return { id, path, title: path, sessionIds, status };
}

/** Filas de seguimiento sin proyectar: el estado lógico real del almacén. */
function trackingRows(world) {
  return world.withRegistry((db) => db.prepare(`SELECT path_key, path, workspace_id, project_id, state,
      association, bound_by, bound_at, updated_at, last_status, last_seen_at, revision
    FROM workspace_tracking ORDER BY path_key`).all());
}

function reconcileAudit(world) {
  return world.withRegistry((db) => db.prepare(`SELECT seq, actor, target, detail FROM audit_registry
    WHERE action = 'tracking.reconcile' ORDER BY seq`).all());
}

function auditTail(world, afterSeq) {
  return world.withRegistry((db) => db.prepare(`SELECT seq, actor, action, target, outcome, detail
    FROM audit_registry WHERE seq > ? ORDER BY seq`).all(afterSeq));
}

function auditHead(world) {
  return world.withRegistry((db) => Number(db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM audit_registry').get().n));
}

function seedRow(world, { path, projectId, state = 'on', workspaceId = 'ws', now = NOW }) {
  return world.withRegistry((db) => applyTracking(db, {
    pathKey: pathKeyFor(path), path, workspaceId, state, projectId, expectedRevision: 0, now,
  }));
}

test('F2: identidad de otro perfil lanza session-invalid sin escribir seguimiento ni reconciliar', async () => {
  const world = await makeWorld();
  try {
    const keyA = pathKeyFor(world.dirA);
    seedRow(world, { path: world.dirA, projectId: world.projectA.id, workspaceId: 'ws-a' });
    // La fila queda medida como `missing`: si el camino prohibido llegara a reconciliar con la lista
    // del Host (que sí trae A como `ok`), la escribiría y lo auditaría. Así el «no escribe» tiene algo
    // observable que habría cambiado.
    world.withRegistry((db) => reconcileTracking(db, {
      present: [], absent: [keyA], unknown: [], measuredAt: NOW + 1,
    }));
    const rowsBefore = trackingRows(world);
    const reconcileBefore = reconcileAudit(world);
    const headBefore = auditHead(world);
    assert.equal(rowsBefore.length, 1);
    assert.equal(rowsBefore[0].last_status, 'missing');

    assert.throws(() => world.withRegistry((db) => resolveScope(db, {
      identity: { sessionId: 'sesion-traza-a', profileKey: 'perfil-ajeno' },
      expectedProfileKey: PROFILE,
      cwd: world.dirA,
      // El Host sí tiene el workspace abierto: la única razón para no medir es la identidad.
      openProjects: [ws('ws-a', world.dirA, ['sesion-traza-a'])],
      now: NOW + 2,
    })), (error) => {
      assert.equal(error.code, 'session-invalid');
      assert.equal(error.details.reason, 'profile-mismatch');
      return true;
    });

    assert.deepEqual(trackingRows(world), rowsBefore, 'ninguna fila de workspace_tracking cambia');
    assert.deepEqual(reconcileAudit(world), reconcileBefore, 'no hay entrada tracking.reconcile nueva');

    // El rechazo sí se audita: un fallo cerrado que no deja rastro mentiría por omisión.
    const tail = auditTail(world, headBefore);
    assert.equal(tail.length, 1, `una sola entrada nueva (la denegación), no ${tail.length}`);
    assert.equal(tail[0].action, 'scope.resolve');
    assert.equal(tail[0].outcome, 'denied');
    assert.equal(tail[0].actor, 'host');
    const detail = typeof tail[0].detail === 'string' ? JSON.parse(tail[0].detail) : tail[0].detail;
    assert.equal(detail.code, 'session-invalid');
    console.log('[F2] rechazo auditado:', JSON.stringify({ seq: tail[0].seq, action: tail[0].action, outcome: tail[0].outcome, code: detail.code }));
    console.log('[F2] fila intacta:', JSON.stringify(rowsBefore[0]));
  } finally {
    world.cleanup();
  }
});

test('F4: status() que lanza o devuelve missing no convierte una fila en last_status=missing', async () => {
  const world = await makeWorld();
  try {
    const keyA = pathKeyFor(world.dirA);
    const keyB = pathKeyFor(world.dirB);
    seedRow(world, { path: world.dirA, projectId: world.projectA.id, workspaceId: 'ws-a' });
    seedRow(world, { path: world.dirB, projectId: world.projectB.id, workspaceId: 'ws-b' });
    // A medida `ok` (el estado que F4 no debe perder) y B `missing` (para que la reconciliación de la
    // ronda tenga algo que escribir y, por tanto, una entrada de auditoría que inspeccionar).
    world.withRegistry((db) => reconcileTracking(db, {
      present: [keyA], absent: [keyB], unknown: [], measuredAt: NOW,
    }));
    const before = world.withRegistry((db) => readTracking(db, { pathKey: keyA }));

    // Ronda 1: `status()` lanza (timeout transitorio del disco, no una ausencia medida).
    const throwing = {
      list: () => [
        ws('ws-a', world.dirA, [], () => Promise.reject(new Error('status() agotó el tiempo'))),
        ws('ws-b', world.dirB, ['sesion-traza-b'], () => Promise.resolve('ok')),
      ],
    };
    const openThrowing = await listOpenProjects(throwing);
    assert.deepEqual(openThrowing.map((project) => project.id), ['ws-b'], 'el Host omite lo que no pudo medir');
    const first = world.withRegistry((db) => resolveScope(db, {
      identity: { sessionId: 'sesion-traza-b', profileKey: PROFILE },
      expectedProfileKey: PROFILE,
      cwd: join(world.base, 'fuera'),
      openProjects: openThrowing,
      now: NOW + 5,
    }));
    assert.equal(first.source, 'tracking');
    assert.equal(first.projectId, world.projectB.id);

    const afterThrow = world.withRegistry((db) => readTracking(db, { pathKey: keyA }));
    assert.equal(afterThrow.lastStatus, 'ok', 'la fila conserva su medición previa');
    assert.equal(afterThrow.lastSeenAt, before.lastSeenAt, 'no se reescribe cuándo se vio por última vez');
    assert.equal(afterThrow.revision, before.revision, 'reconciliar no sube la revisión humana');

    const lastAudit = reconcileAudit(world).at(-1);
    const detail = typeof lastAudit.detail === 'string' ? JSON.parse(lastAudit.detail) : lastAudit.detail;
    assert.equal(detail.missing, 0, 'la auditoría no afirma ninguna ausencia');
    assert.equal(detail.ok, 1);
    assert.equal(detail.changed, 1, 'sólo se escribió la fila realmente medida');

    const missingRows = world.withRegistry((db) => db.prepare(
      "SELECT path_key FROM workspace_tracking WHERE last_status = 'missing'",
    ).all());
    assert.deepEqual(missingRows, [], 'ninguna fila quedó marcada como desaparecida');
    console.log('[F4·lanzamiento] fila A:', JSON.stringify({ lastStatus: afterThrow.lastStatus, lastSeenAt: afterThrow.lastSeenAt, revision: afterThrow.revision }));
    console.log('[F4·lanzamiento] auditoría:', JSON.stringify(detail));

    // Ronda 2: `status()` devuelve `missing-dir` (la lista del Host también lo omite).
    world.withRegistry((db) => reconcileTracking(db, { present: [], absent: [keyB], unknown: [], measuredAt: NOW + 6 }));
    const missingDir = {
      list: () => [
        ws('ws-a', world.dirA, [], () => Promise.resolve('missing-dir')),
        ws('ws-b', world.dirB, ['sesion-traza-b'], () => Promise.resolve('ok')),
      ],
    };
    const openMissing = await listOpenProjects(missingDir);
    assert.deepEqual(openMissing.map((project) => project.id), ['ws-b']);
    const second = world.withRegistry((db) => resolveScope(db, {
      identity: { sessionId: 'sesion-traza-b', profileKey: PROFILE },
      expectedProfileKey: PROFILE,
      cwd: join(world.base, 'fuera'),
      openProjects: openMissing,
      now: NOW + 7,
    }));
    assert.equal(second.source, 'tracking');
    const afterMissingDir = world.withRegistry((db) => readTracking(db, { pathKey: keyA }));
    assert.equal(afterMissingDir.lastStatus, 'ok', 'un missing-dir del Host tampoco se copia a ciegas');
    const secondDetail = reconcileAudit(world).at(-1).detail;
    const parsed = typeof secondDetail === 'string' ? JSON.parse(secondDetail) : secondDetail;
    assert.equal(parsed.missing, 0);
    console.log('[F4·missing-dir] fila A:', JSON.stringify({ lastStatus: afterMissingDir.lastStatus, lastSeenAt: afterMissingDir.lastSeenAt }));
    console.log('[F4·missing-dir] auditoría:', JSON.stringify(parsed));
  } finally {
    world.cleanup();
  }
});

test('F7: la capitalización que trae el Host no reescribe el path congelado de la fila', {
  skip: process.platform !== 'win32' ? 'la capitalización distinta es la misma clave sólo en Windows' : false,
}, async () => {
  const world = await makeWorld();
  try {
    const keyA = pathKeyFor(world.dirA);
    // La misma ruta física, escrita como la congeló la creación. En Windows `pathKeyFor` la reduce a la
    // misma clave, así que la fila se encuentra; la ruta literal NO debe seguir al Host.
    const frozenPath = world.dirA.toUpperCase();
    assert.notEqual(frozenPath, world.dirA, 'el literal congelado difiere del que listará el Host');
    assert.equal(pathKeyFor(frozenPath), keyA, 'misma clave pese a la capitalización');

    const created = seedRow(world, { path: frozenPath, projectId: world.projectA.id, workspaceId: 'ws-a' });
    assert.equal(created.item.path, frozenPath);
    assert.equal(created.item.revision, 1);

    const hostPath = world.dirA; // el Host lo lista con otra capitalización
    const open = [ws('ws-a', hostPath, ['sesion-traza-a'])];
    const resolved = world.withRegistry((db) => resolveScope(db, {
      identity: { sessionId: 'sesion-traza-a', profileKey: PROFILE },
      expectedProfileKey: PROFILE,
      cwd: join(world.base, 'fuera'),
      openProjects: open,
      now: NOW + 10,
    }));
    assert.equal(resolved.source, 'tracking');
    assert.equal(resolved.projectId, world.projectA.id);

    const row = world.withRegistry((db) => readTracking(db, { pathKey: keyA }));
    assert.equal(row.path, frozenPath, 'la reconciliación del resolver no reescribe la ruta');
    assert.equal(row.lastStatus, 'ok', 'sí mide disponibilidad');
    assert.equal(row.revision, 1, 'la revisión humana no cambia');
    const detail = reconcileAudit(world).at(-1).detail;
    const parsed = typeof detail === 'string' ? JSON.parse(detail) : detail;
    assert.equal(parsed.changed, 1, 'la reconciliación de esta resolución ocurrió');
    console.log('[F7] path congelado:', JSON.stringify({ creado: frozenPath, listadoPorHost: hostPath, guardado: row.path }));
    console.log('[F7] auditoría:', JSON.stringify(parsed));
  } finally {
    world.cleanup();
  }
});
