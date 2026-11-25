/**
 * R1.2 · OFF detiene la indexación automática, la cola es durable y la reaparición no duplica memoria.
 *
 * Se demuestra sobre un perfil temporal:
 *  - `activeSyncScopes` excluye proyectos con seguimiento `off`/`paused` y proyectos con provisión en
 *    curso; un proyecto sin fila de seguimiento conserva el comportamiento anterior;
 *  - la cola `sync_requests` coalesce y el planificador la drena como operación `kind='sync'` aparte;
 *  - una petición de un ámbito apagado termina `failed` sin indexar;
 *  - una carpeta que desaparece y vuelve con el mismo contenido no se reindexa; con otro contenido se
 *    reingiere sólo lo cambiado, conservando la identidad y el almacén.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  addRoot, closeRegistry, createProject, openRegistry,
} from '../lib/registry.mjs';
import { applyTracking } from '../lib/tracking-store.mjs';
import { openScopeStore } from '../lib/scope-stores.mjs';
import { pathKeyFor } from '../lib/registry.mjs';
import { loadConfig } from '../lib/paths.mjs';
import { activeSyncScopes, syncScopes } from '../lib/sync.mjs';
import { createSyncScheduler } from '../lib/sync-scheduler.mjs';
import { beginOperation, finishOperation, getOperation } from '../lib/operations.mjs';
import {
  claimSyncRequest, finishProvisionIntent, getSyncRequest, openProvisionIntent,
  reclaimInterruptedSyncRequests, requestSync,
} from '../lib/provision-store.mjs';

const T = 1_700_000_000_000;
const silent = { warn() {}, debug() {}, error() {}, info() {} };

function makeWorld() {
  const base = mkdtempSync(join(tmpdir(), 'lcr-sync-lifecycle-'));
  const root = join(base, 'perfil');
  const ws = join(base, 'workspace');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'doc.md'), '# Doc\n\ncontenido inicial\n', 'utf8');
  const env = { LIFECODE_RAG_ROOT: root, DSH_PROFILE: 'sync-lifecycle-test' };
  const config = loadConfig(root).config;
  const { db } = openRegistry({ root, create: true, now: T });
  const project = createProject(db, { name: 'Proyecto', now: T });
  addRoot(db, { scopeKind: 'prj', scopeId: project.id, path: ws, addedBy: 'human', now: T });
  const store = openScopeStore({
    profileRoot: root, profileKey: 'sync-lifecycle-test', scope: { kind: 'prj', id: project.id }, create: true, now: T,
  });
  store.close();
  return {
    base, root, ws, env, config, db, project,
    pathKey: pathKeyFor(ws),
    withRegistry(work) {
      const opened = openRegistry({ root, create: false });
      try { return work(opened.db); } finally { closeRegistry(opened.db); }
    },
    track({ state = 'on', projectId = null, expectedRevision = 0 } = {}) {
      return applyTracking(db, {
        pathKey: pathKeyFor(ws), path: ws, state, projectId, expectedRevision, now: T,
      });
    },
    scheduler() {
      return createSyncScheduler({ env, root, config, logger: silent, now: () => T });
    },
    cleanup() { closeRegistry(db); rmSync(base, { recursive: true, force: true }); },
  };
}

function scopeOf(world) {
  return { kind: 'prj', id: world.project.id, name: 'Proyecto', roots: 1 };
}

test('un cleanup pendiente y un rekey pendiente excluyen el proyecto del sync', () => {
  const world = makeWorld();
  try {
    const cleanup = beginOperation(world.db, {
      kind: 'cleanup', now: T,
      detail: { project_id: world.project.id, from_path_key: world.pathKey },
    });
    assert.deepEqual(activeSyncScopes(world.db), [], 'con dos raíces temporales no se indexa');
    finishOperation(world.db, { operationId: cleanup.id, state: 'committed', now: T + 1 });
    assert.deepEqual(activeSyncScopes(world.db).map((scope) => scope.id), [world.project.id]);

    const rekey = beginOperation(world.db, {
      kind: 'rekey', now: T + 2,
      detail: { project_id: world.project.id, from_path: world.ws, to_path: world.ws },
    });
    assert.deepEqual(activeSyncScopes(world.db), [], 'con la ruta del índice sin reasignar no se indexa');
    finishOperation(world.db, { operationId: rekey.id, state: 'committed', now: T + 3 });
  } finally {
    world.cleanup();
  }
});

test('OFF y una provisión en curso excluyen el proyecto de la sincronización automática', () => {
  const world = makeWorld();
  try {
    assert.deepEqual(activeSyncScopes(world.db).map((scope) => scope.id), [world.project.id],
      'sin seguimiento, el proyecto se sincroniza como antes');

    world.track({ state: 'off', projectId: world.project.id });
    assert.deepEqual(activeSyncScopes(world.db), [], 'OFF detiene la indexación automática');

    world.track({ state: 'on', expectedRevision: 1 });
    assert.deepEqual(activeSyncScopes(world.db).map((scope) => scope.id), [world.project.id],
      'ON vuelve a habilitarla');

    const operation = beginOperation(world.db, { kind: 'provision', now: T });
    openProvisionIntent(world.db, {
      pathKey: world.pathKey, operationId: operation.id, expectedRevision: 2,
      projectId: world.project.id, now: T,
    });
    assert.deepEqual(activeSyncScopes(world.db), [], 'no se indexa a mitad de la saga');
  } finally {
    world.cleanup();
  }
});

test('la cola coalesce y el drenaje la ejecuta como operación sync aparte', async () => {
  const world = makeWorld();
  try {
    world.track({ state: 'on', projectId: world.project.id });
    const first = requestSync(world.db, { scopeKind: 'prj', scopeId: world.project.id, reason: 'reactivation', now: T });
    requestSync(world.db, { scopeKind: 'prj', scopeId: world.project.id, reason: 'provision', now: T + 1 });
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM sync_requests').get().n, 1, 'una fila por ámbito');
    const queued = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: world.project.id });
    assert.equal(queued.state, 'queued');
    assert.equal(queued.reason, 'provision', 'la petición más reciente gana');
    assert.equal(queued.requestedAt, T + 1);

    const scheduler = world.scheduler();
    const drained = await scheduler.drain();
    assert.equal(drained.results.length, 1);
    const done = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: world.project.id });
    assert.equal(done.state, 'done');
    assert.ok(done.operationId);
    const operation = getOperation(world.db, done.operationId);
    assert.equal(operation.kind, 'sync');
    assert.equal(operation.state, 'committed');
    assert.equal(
      world.db.prepare("SELECT COUNT(*) AS n FROM sync_state WHERE status='present'").get().n,
      1,
      'el fichero quedó observado e indexado',
    );
    assert.ok(first);
  } finally {
    world.cleanup();
  }
});

test('una petición para un ámbito apagado termina failed y no indexa', async () => {
  const world = makeWorld();
  try {
    world.track({ state: 'off', projectId: world.project.id });
    requestSync(world.db, { scopeKind: 'prj', scopeId: world.project.id, reason: 'reactivation', now: T });
    const drained = await world.scheduler().drain();
    assert.equal(drained.results.length, 1);
    assert.equal(drained.results[0].reason, 'scope-not-syncable');
    const request = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: world.project.id });
    assert.equal(request.state, 'failed');
    assert.equal(request.errorCode, 'scope-not-syncable');
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM sync_state WHERE status='present'").get().n, 0);
  } finally {
    world.cleanup();
  }
});

test('una pasada parcial con avance se reencola; la siguiente pasada la completa', async () => {
  const world = makeWorld();
  try {
    for (const name of ['b.md', 'c.md']) writeFileSync(join(world.ws, name), `# ${name}\n\n`, 'utf8');
    world.track({ state: 'on', projectId: world.project.id });
    requestSync(world.db, { scopeKind: 'prj', scopeId: world.project.id, reason: 'reactivation', now: T });

    const partialConfig = {
      ...world.config,
      automation: { ...world.config.automation, maxFilesPerRun: 1 },
    };
    const firstScheduler = createSyncScheduler({
      env: world.env, root: world.root, config: partialConfig, logger: silent, now: () => T,
    });
    const first = await firstScheduler.drain();
    assert.equal(first.results.length, 1);
    assert.equal(first.results[0].requeued, true, 'una parcial con avance no se cierra como done');
    assert.equal(first.results[0].ingested, 1);
    const pending = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: world.project.id });
    assert.equal(pending.state, 'queued', 'queda lista para la siguiente pasada');
    assert.equal(pending.errorCode, 'partial');

    const fullConfig = {
      ...world.config,
      automation: { ...world.config.automation, maxFilesPerRun: 10 },
    };
    const secondScheduler = createSyncScheduler({
      env: world.env, root: world.root, config: fullConfig, logger: silent, now: () => T,
    });
    const second = await secondScheduler.drain();
    assert.equal(second.results.length, 1);
    const done = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: world.project.id });
    assert.equal(done.state, 'done');
    assert.equal(
      world.db.prepare("SELECT COUNT(*) AS n FROM sync_state WHERE status='present'").get().n, 3,
      'los tres ficheros quedaron indexados',
    );
  } finally {
    world.cleanup();
  }
});

test('M11 · el recorrido observa más de 1.000 ficheros y el límite sólo recorta la indexación', async () => {
  const world = makeWorld();
  try {
    const bulk = join(world.ws, 'bulk');
    mkdirSync(bulk, { recursive: true });
    for (let index = 0; index < 1_200; index += 1) {
      writeFileSync(join(bulk, `f${String(index).padStart(4, '0')}.md`), `# ${index}\n`, 'utf8');
    }
    world.track({ state: 'on', projectId: world.project.id });
    const run = (limit) => syncScopes({
      registryDb: world.db, profileRoot: world.root, profileKey: 'sync-lifecycle-test',
      scopes: [scopeOf(world)], config: world.config, now: () => T, limit,
    });

    // El recorrido ve TODO el árbol aunque la pasada sólo indexe 10: sin esto, el mismo prefijo
    // de 1.000 ficheros se repetía y la indexación nunca avanzaba.
    const first = await run(10);
    assert.equal(first[0].scanned, 1_201);
    assert.equal(first[0].ingested, 10);
    assert.equal(first[0].complete, false);

    const second = await run(2_000);
    assert.equal(second[0].scanned, 1_201);
    assert.equal(second[0].complete, true);
    assert.equal(
      world.db.prepare("SELECT COUNT(*) AS n FROM sync_state WHERE status='present'").get().n,
      1_201,
      'los 1.201 ficheros quedaron indexados',
    );
  } finally {
    world.cleanup();
  }
});

test('una memoria provisionada sin fila de seguimiento no se indexa sola', () => {
  const world = makeWorld();
  try {
    const operation = beginOperation(world.db, { kind: 'provision', now: T });
    openProvisionIntent(world.db, {
      pathKey: world.pathKey, operationId: operation.id, expectedRevision: 1,
      projectId: world.project.id, now: T,
    });
    finishProvisionIntent(world.db, {
      pathKey: world.pathKey, operationId: operation.id, projectId: world.project.id, now: T, state: 'done',
    });
    assert.deepEqual(activeSyncScopes(world.db), [],
      'borrar la fila no convierte la memoria en indexación automática sin dueño');
  } finally {
    world.cleanup();
  }
});

test('una petición running huérfana se reencola al arrancar, no se pierde', () => {
  const world = makeWorld();
  try {
    world.track({ state: 'on', projectId: world.project.id });
    requestSync(world.db, { scopeKind: 'prj', scopeId: world.project.id, reason: 'reactivation', now: T });
    const claim = claimSyncRequest(world.db, { scopeKind: 'prj', scopeId: world.project.id, now: T });
    assert.equal(claim.claimed, true);
    assert.equal(getSyncRequest(world.db, { scopeKind: 'prj', scopeId: world.project.id }).state, 'running');

    const reclaimed = reclaimInterruptedSyncRequests(world.db, { now: T + 400_000, olderThanMs: 300_000 });
    assert.equal(reclaimed, 1);
    const request = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: world.project.id });
    assert.equal(request.state, 'queued', 'se reencola para continuar, no se marca failed');
    assert.equal(request.errorCode, 'retried-after-interruption');
  } finally {
    world.cleanup();
  }
});

test('una petición running con dueño muerto se reencola aunque sea reciente', () => {
  const world = makeWorld();
  try {
    world.track({ state: 'on', projectId: world.project.id });
    requestSync(world.db, { scopeKind: 'prj', scopeId: world.project.id, reason: 'reactivation', now: T });
    const claim = claimSyncRequest(world.db, { scopeKind: 'prj', scopeId: world.project.id, now: T });
    assert.equal(claim.claimed, true);
    const request = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: world.project.id });
    assert.equal(request.state, 'running');

    const reclaimed = reclaimInterruptedSyncRequests(world.db, { now: T + 1_000, olderThanMs: 0 });
    assert.equal(reclaimed, 1, 'un arranque de perfil reclama la pasada reciente de la instancia anterior');
    assert.equal(getSyncRequest(world.db, { scopeKind: 'prj', scopeId: world.project.id }).state, 'queued');
  } finally {
    world.cleanup();
  }
});

test('reaparición: mismo contenido no reindexa; contenido distinto reingiere sólo lo cambiado', async () => {
  const world = makeWorld();
  try {
    world.track({ state: 'on', projectId: world.project.id });
    const run = () => syncScopes({
      registryDb: world.db, profileRoot: world.root, profileKey: 'sync-lifecycle-test',
      scopes: [scopeOf(world)], config: world.config, now: () => T,
    });

    const first = await run();
    assert.equal(first[0].ingested, 1);
    assert.equal(first[0].new, 1);

    rmSync(join(world.ws, 'doc.md'), { force: true });
    const missing = await run();
    assert.equal(missing[0].missing, 1);
    assert.equal(
      world.db.prepare("SELECT status FROM sync_state WHERE source_key='doc.md'").get().status,
      'missing',
    );

    // Vuelve con el MISMO contenido: se restaura la fila sin reindexar ni duplicar.
    writeFileSync(join(world.ws, 'doc.md'), '# Doc\n\ncontenido inicial\n', 'utf8');
    const same = await run();
    assert.equal(same[0].reappeared, 1);
    assert.equal(same[0].ingested, 0);
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM projects").get().n, 1);

    // Vuelve con OTRO contenido: se reingiere sólo ese fichero y la identidad no cambia.
    writeFileSync(join(world.ws, 'doc.md'), '# Doc\n\ncontenido reemplazado\n', 'utf8');
    const changed = await run();
    assert.equal(changed[0].changed, 1);
    assert.equal(changed[0].ingested, 1);
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM projects").get().n, 1);
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM roots").get().n, 1);
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM workspace_tracking").get().n, 1);
    assert.equal(world.project.id, scopeOf(world).id);
  } finally {
    world.cleanup();
  }
});
