/**
 * R1.2 · API `pa/1.6.0`: el toggle provisiona, la reactivación encola, y mover/revocar son actos
 * humanos separados que exigen la compuerta del Host.
 *
 * El handler real (`createPaHandler`) se monta sobre un perfil temporal. La compuerta y el
 * planificador son dobles: aquí se prueba el contrato HTTP, no el host.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createPaHandler, PA_PREFIX, PA_VERSION } from '../lib/pa-api.mjs';
import { addRoot, closeRegistry, createLibrary, createProject, getProject, listRoots, newId, openRegistry } from '../lib/registry.mjs';
import { pathKeyFor } from '../lib/registry.mjs';
import { readTracking } from '../lib/tracking-store.mjs';
import { getProvisionIntent, getSyncRequest, openProvisionIntent } from '../lib/provision-store.mjs';
import { beginOperation } from '../lib/operations.mjs';
import { recoverLifecycle } from '../lib/lifecycle.mjs';
import { listTrustedRoots } from '../lib/trusted-roots.mjs';

const T = 1_700_000_000_000;
const CSRF = { 'x-lifecode-rag': '1', 'content-type': 'application/json' };
const allow = async () => ({ ok: true, peer: { id: 'host', principal: { kind: 'host' } } });

function makeWorld() {
  const base = mkdtempSync(join(tmpdir(), 'lcr-pa-lifecycle-'));
  const root = join(base, 'perfil');
  const ws = join(base, 'workspace');
  const other = join(base, 'otro');
  const destination = join(base, 'destino');
  for (const dir of [ws, other, destination]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(ws, 'doc.md'), '# Doc\n\n', 'utf8');
  const registry = openRegistry({ root, create: true, now: T });
  return {
    base, root, ws, other, destination, db: registry.db,
    key: pathKeyFor(ws),
    close() { closeRegistry(registry.db); },
    cleanup() { rmSync(base, { recursive: true, force: true }); },
  };
}

function handlerFor(world, { authorize = allow, scheduler = null } = {}) {
  return createPaHandler({
    profileRoot: world.root,
    profileKey: 'pa-lifecycle-test',
    authorize,
    scheduler,
    now: () => T,
    services: null,
  });
}

function reqRes(url, method = 'GET', body, headers = {}) {
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b; },
  };
  const payload = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  const req = {
    url: PA_PREFIX + url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload, 'utf8');
    },
  };
  return { req, res };
}

async function call(handler, url, method = 'GET', body, headers = {}) {
  const { req, res } = reqRes(url, method, body, headers);
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') };
}

const data = (response) => response.json.data;

test('M4 · el PUT heredado que intenta compartir una memoria responde 409, no 500', async () => {
  const world = makeWorld();
  try {
    const handler = handlerFor(world);
    const first = await provision(handler, world);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const projectId = data(first).memory.projectId;

    // Cliente 1.5.0 (sin `intent`): escribe una segunda fila reclamando el proyecto ya asociado.
    const response = await call(handler, '/tracking', 'PUT', {
      pathKey: pathKeyFor(world.other), path: world.other, state: 'on',
      projectId, expectedRevision: 0,
    }, CSRF);
    assert.equal(response.status, 409, JSON.stringify(response.json));
    assert.equal(response.json.error.code, 'memory-exclusive');
    assert.equal(response.json.error.details.reason, 'project-associated');
    assert.equal(readTracking(world.db, { pathKey: pathKeyFor(world.other) }), null, 'la fila no se crea');
    assert.equal(readTracking(world.db, { pathKey: world.key }).projectId, projectId, 'la memoria existente no se toca');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('H-3 · un preflight no reintentable restaura la fila de seguimiento anterior', async () => {
  const world = makeWorld();
  try {
    const library = createLibrary(world.db, { name: 'Biblioteca de la ruta', now: T });
    addRoot(world.db, { scopeKind: 'lib', scopeId: library.id, path: world.ws, addedBy: 'host', now: T });
    const handler = handlerFor(world);
    const off = await call(handler, '/tracking', 'PUT', {
      pathKey: world.key, path: world.ws, state: 'off', expectedRevision: 0,
    }, CSRF);
    assert.equal(off.status, 200, JSON.stringify(off.json));
    const response = await provision(handler, world, { expectedRevision: data(off).revision });
    assert.equal(response.status, 409, JSON.stringify(response.json));
    assert.equal(response.json.error.code, 'memory-exclusive');
    assert.equal(response.json.error.details.reason, 'root-is-library');
    assert.equal(readTracking(world.db, { pathKey: world.key }).state, 'off',
      'la fila vuelve al estado anterior; no queda ON sin memoria');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('H1 · /tracking/revoke informa que el acceso continúa si la raíz es preexistente', async () => {
  const world = makeWorld();
  try {
    const project = createProject(world.db, { name: 'Memoria previa', now: T });
    addRoot(world.db, { scopeKind: 'prj', scopeId: project.id, path: world.ws, addedBy: 'host', now: T });
    const handler = handlerFor(world);
    const provisioned = await provision(handler, world);
    assert.equal(provisioned.status, 200, JSON.stringify(provisioned.json));

    const response = await call(handler, '/tracking/revoke', 'POST', {
      pathKey: world.key, expectedRevision: data(provisioned).revision,
    }, CSRF);
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(data(response).changed, true);
    assert.equal(data(response).complete, false, 'no se puede decir «acceso revocado» sin mentir');
    assert.equal(data(response).remaining.length, 1);
    assert.equal(data(response).remaining[0].path, world.ws);
    assert.ok(listRoots(world.db, { scopeKind: 'prj', scopeId: project.id })
      .some((root) => root.path_key === world.key && root.state === 'authorized'));
    assert.equal(listTrustedRoots(world.db).find((entry) => entry.pathKey === world.key).state, 'revoked');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('la administración no puede ampliar la memoria de un workspace a otra carpeta', async () => {
  const world = makeWorld();
  try {
    const handler = handlerFor(world);
    const provisioned = await provision(handler, world);
    const projectId = data(provisioned).memory.projectId;

    const response = await call(handler, '/roots', 'POST', {
      projectId, path: world.destination,
    }, CSRF);
    assert.equal(response.status, 409, JSON.stringify(response.json));
    assert.equal(response.json.error.code, 'memory-exclusive');
    assert.equal(response.json.error.details.reason, 'project-is-workspace');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('la guarda de administración sobrevive al borrado de la fila de seguimiento', async () => {
  const world = makeWorld();
  try {
    const handler = handlerFor(world);
    const provisioned = await provision(handler, world);
    const projectId = data(provisioned).memory.projectId;
    const revision = data(provisioned).revision;

    const removed = await call(handler,
      `/tracking?pathKey=${encodeURIComponent(world.key)}&expectedRevision=${revision}`, 'DELETE', undefined, CSRF);
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    assert.equal(readTracking(world.db, { pathKey: world.key }), null);

    const response = await call(handler, '/roots', 'POST', {
      projectId, path: world.destination,
    }, CSRF);
    assert.equal(response.status, 409, JSON.stringify(response.json));
    assert.equal(response.json.error.code, 'memory-exclusive');
    assert.equal(response.json.error.details.reason, 'project-is-workspace');
    assert.equal(listRoots(world.db, { scopeKind: 'prj', scopeId: projectId }).length, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('H5 · una provisión fallida no deja la fila en ON ni un proyecto activo fantasma', async () => {
  const world = makeWorld();
  try {
    // Almacén corrupto para la identidad reservada: la saga pasa de consentimiento y proyecto, y
    // falla al abrir el SQLite. La fila se escribió antes (la saga la necesita) y debe compensarse.
    const reserved = newId('prj_', T);
    const operation = beginOperation(world.db, {
      kind: 'provision', now: T,
      detail: { path_key: world.key, tracking_created: true },
    });
    openProvisionIntent(world.db, {
      pathKey: world.key, operationId: operation.id, expectedRevision: 1, projectId: reserved, now: T,
    });
    mkdirSync(join(world.root, 'scopes', reserved, 'rag.sqlite3'), { recursive: true });

    const handler = handlerFor(world);
    // Con la guarda de concurrencia, un proceso nuevo que encuentra otra operación viva recibe un
    // conflicto reintentable y no ejecuta pasos en paralelo. El arranque (recoverLifecycle) sí puede
    // adoptarla porque sabe que el proceso anterior ya no existe; ahí se mide la compensación.
    const conflict = await provision(handler, world);
    assert.equal(conflict.status, 409, JSON.stringify(conflict.json));
    assert.equal(conflict.json.error.code, 'revision-conflict');
    assert.equal(conflict.json.error.details.reason, 'concurrent-provision');
    assert.equal(conflict.json.error.details.retryable, true);

    const summary = recoverLifecycle(world.db, {
      profileRoot: world.root, profileKey: 'pa-lifecycle-test', now: T + 1,
    });
    assert.equal(summary.provisions, 1);
    assert.equal(summary.abandoned, 1);
    assert.equal(readTracking(world.db, { pathKey: world.key }), null, 'la fila no queda en ON');
    assert.equal(getProject(world.db, reserved)?.status, 'archived', 'el proyecto no queda activo');
    assert.equal(getProvisionIntent(world.db, world.key).state, 'abandoned');
    assert.equal(getSyncRequest(world.db, { scopeKind: 'prj', scopeId: reserved }), null);

    // La reserva del proyecto archivado se descarta: el reintento no puede morir en
    // `project-not-active` (MEDIUM de la primera re-auditoría).
    rmSync(join(world.root, 'scopes', reserved), { recursive: true, force: true });
    const retry = await provision(handler, world);
    assert.equal(retry.status, 200, JSON.stringify(retry.json));
    const newProjectId = data(retry).memory.projectId;
    assert.notEqual(newProjectId, reserved, 'no reutiliza la identidad archivada');
    assert.equal(getProject(world.db, newProjectId).status, 'active');
    assert.equal(readTracking(world.db, { pathKey: world.key }).projectId, newProjectId);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('H5b · un proyecto preexistente vacío no se archiva al fallar la provisión', async () => {
  const world = makeWorld();
  try {
    const existing = createProject(world.db, { name: 'Proyecto vacío', now: T });
    mkdirSync(join(world.root, 'scopes', existing.id, 'rag.sqlite3'), { recursive: true });
    const handler = handlerFor(world);
    const response = await call(handler, '/tracking', 'PUT', {
      pathKey: world.key, path: world.ws, state: 'on', expectedRevision: 0,
      projectId: existing.id, intent: 'provision',
    }, CSRF);
    assert.equal(response.status, 422, JSON.stringify(response.json));
    assert.equal(response.json.error.details.retryable, false);
    assert.equal(getProject(world.db, existing.id).status, 'active', 'el proyecto ajeno al acto no se toca');
    assert.equal(readTracking(world.db, { pathKey: world.key }), null);
  } finally {
    world.close();
    world.cleanup();
  }
});

function provision(handler, world, { expectedRevision = 0, path = world.ws } = {}) {
  return call(handler, '/tracking', 'PUT', {
    pathKey: pathKeyFor(path), path, state: 'on', expectedRevision, intent: 'provision',
  }, CSRF);
}

test('PUT con intent=provision: memoria lista, mensaje literal y sincronización encolada', async () => {
  const world = makeWorld();
  try {
    let drains = 0;
    const handler = handlerFor(world, { scheduler: { drainSoon() { drains += 1; return { scheduled: true }; } } });
    const response = await provision(handler, world);
    assert.equal(response.status, 200, JSON.stringify(response.json));
    const payload = data(response);
    assert.equal(payload.memory.state, 'ready');
    assert.equal(payload.memory.message, 'Memoria lista. Ya puedes indexar');
    assert.equal(payload.memory.reused, false);
    assert.match(payload.memory.projectId, /^prj_/);
    assert.equal(payload.item.project.id, payload.memory.projectId);
    assert.equal(payload.item.association, 'explicit');
    assert.equal(payload.revision, 2, 'la asociación sube la revisión');
    assert.equal(payload.memory.index.state, 'queued');
    assert.equal(drains, 1, 'el planificador drena fuera de la petición');

    const queued = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: payload.memory.projectId });
    assert.equal(queued.state, 'queued');
    assert.equal(queued.reason, 'provision');
    assert.equal(PA_VERSION, 'pa/1.6.0');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('repetir el toggle con intent reutiliza la memoria y no crea otro proyecto', async () => {
  const world = makeWorld();
  try {
    const handler = handlerFor(world);
    const first = await provision(handler, world);
    const projectId = data(first).memory.projectId;
    const revision = data(first).revision;
    const second = await provision(handler, world, { expectedRevision: revision });
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(data(second).memory.projectId, projectId);
    assert.equal(data(second).memory.reused, true);
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('un cliente sin intent conserva el comportamiento de 1.5.0: sólo escribe la fila', async () => {
  const world = makeWorld();
  try {
    const handler = handlerFor(world);
    const response = await call(handler, '/tracking', 'PUT', {
      pathKey: world.key, path: world.ws, state: 'on', expectedRevision: 0,
    }, CSRF);
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(data(response).revision, 1);
    assert.equal(data(response).item.project, null, 'no se asocia un proyecto');
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 0);
    assert.equal(data(response).item.memory.state, 'none');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('intent con state distinto de on se rechaza ANTES de escribir', async () => {
  const world = makeWorld();
  try {
    const handler = handlerFor(world);
    const response = await call(handler, '/tracking', 'PUT', {
      pathKey: world.key, path: world.ws, state: 'off', expectedRevision: 0, intent: 'provision',
    }, CSRF);
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'invalid-argument');
    assert.equal(response.json.error.details.reason, 'intent-requires-on');
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 0);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('intent no admitido y CSRF ausente no escriben', async () => {
  const world = makeWorld();
  try {
    const handler = handlerFor(world);
    const bad = await call(handler, '/tracking', 'PUT', {
      pathKey: world.key, path: world.ws, state: 'on', expectedRevision: 0, intent: 'associate',
    }, CSRF);
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.details.field, 'intent');

    const noCsrf = await call(handler, '/tracking', 'PUT', {
      pathKey: world.key, path: world.ws, state: 'on', expectedRevision: 0, intent: 'provision',
    }, { 'content-type': 'application/json' });
    assert.equal(noCsrf.status, 403);
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 0);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('GET /tracking publica el estado de memoria derivado por fila', async () => {
  const world = makeWorld();
  try {
    const handler = handlerFor(world);
    await provision(handler, world);
    const response = await call(handler, '/tracking');
    assert.equal(response.status, 200);
    const item = data(response).items.find((row) => row.pathKey === world.key);
    assert.ok(item);
    assert.equal(item.memory.state, 'ready');
    assert.equal(item.memory.store, 'present');
    assert.equal(item.memory.canRevoke, true);
    assert.equal(item.memory.index.state, 'queued');
    assert.equal(data(response).version, 'pa/1.6.0');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('revocar acceso: retira lo propio, conserva la memoria y es idempotente', async () => {
  const world = makeWorld();
  try {
    const handler = handlerFor(world);
    const provisioned = await provision(handler, world);
    const revision = data(provisioned).revision;
    const projectId = data(provisioned).memory.projectId;

    const revoked = await call(handler, '/tracking/revoke', 'POST', {
      pathKey: world.key, expectedRevision: revision,
    }, CSRF);
    assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
    assert.equal(data(revoked).changed, true);
    assert.equal(data(revoked).removed.trust.pathKey, world.key);
    assert.ok(data(revoked).removed.root.id);
    assert.equal(data(revoked).item.memory.projectId, projectId);
    assert.equal(readTracking(world.db, { pathKey: world.key }).state, 'on');
    assert.equal(getProvisionIntent(world.db, world.key).revokedAt !== null, true);

    const again = await call(handler, '/tracking/revoke', 'POST', {
      pathKey: world.key, expectedRevision: readTracking(world.db, { pathKey: world.key }).revision,
    }, CSRF);
    assert.equal(again.status, 200);
    assert.equal(data(again).changed, false);
    assert.equal(data(again).alreadyRevoked, true);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('mover: conserva el proyecto, elimina la fila vieja y responde con la nueva', async () => {
  const world = makeWorld();
  try {
    let drains = 0;
    const handler = handlerFor(world, { scheduler: { drainSoon() { drains += 1; return { scheduled: true }; } } });
    const provisioned = await provision(handler, world);
    const projectId = data(provisioned).memory.projectId;
    const revision = data(provisioned).revision;

    const moved = await call(handler, '/tracking/move', 'POST', {
      pathKey: world.key, newPath: world.destination, expectedRevision: revision,
    }, CSRF);
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal(data(moved).item.projectId, projectId);
    assert.equal(data(moved).item.pathKey, pathKeyFor(world.destination));
    assert.equal(data(moved).item.revision, 1);
    assert.equal(readTracking(world.db, { pathKey: world.key }), null);
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 1);
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind='move'").get().n, 1);
    assert.equal(drains, 2, 'la provisión y el movimiento piden drenaje');
    assert.equal(getSyncRequest(world.db, { scopeKind: 'prj', scopeId: projectId }).reason, 'move');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('las acciones avanzadas exigen la compuerta del Host y un cuerpo válido', async () => {
  const world = makeWorld();
  try {
    const withoutGate = handlerFor(world, { authorize: null });
    const refused = await call(withoutGate, '/tracking/move', 'POST', {
      pathKey: world.key, newPath: world.destination, expectedRevision: 1,
    }, CSRF);
    assert.equal(refused.status, 503);
    assert.equal(refused.json.error.code, 'authorization-unavailable');

    const refusedProvision = await provision(withoutGate, world);
    assert.equal(refusedProvision.status, 503, 'provisionar también exige la compuerta');
    assert.equal(refusedProvision.json.error.code, 'authorization-unavailable');
    assert.equal(readTracking(world.db, { pathKey: world.key }), null, 'sin compuerta no se escribe la fila');

    const handler = handlerFor(world);
    const provisioned = await provision(handler, world);
    const missing = await call(handler, '/tracking/move', 'POST', {
      pathKey: world.key, expectedRevision: data(provisioned).revision,
    }, CSRF);
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.details.field, 'newPath');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('el snapshot publica el eje de memoria derivado (Q-01)', async () => {
  const world = makeWorld();
  try {
    const handler = handlerFor(world);
    const provisioned = await provision(handler, world);
    const projectId = data(provisioned).memory.projectId;
    const selected = await call(handler, '/selection', 'POST', {
      projectId, expectedRevision: 0,
    }, CSRF);
    assert.equal(selected.status, 200, JSON.stringify(selected.json));
    const snapshot = await call(handler, '/snapshot');
    assert.equal(snapshot.status, 200, JSON.stringify(snapshot.json));
    const memory = data(snapshot).memory;
    assert.equal(memory.tracked, 1);
    assert.equal(memory.ready, 1);
    assert.equal(memory.index.queued, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('reactivar desde OFF sobre la misma fila encola incremental sin crear memoria', async () => {
  const world = makeWorld();
  try {
    let drains = 0;
    const handler = handlerFor(world, { scheduler: { drainSoon() { drains += 1; return { scheduled: true }; } } });
    const provisioned = await provision(handler, world);
    const projectId = data(provisioned).memory.projectId;
    const revision = data(provisioned).revision;

    const off = await call(handler, '/tracking', 'PUT', {
      pathKey: world.key, path: world.ws, state: 'off', expectedRevision: revision,
    }, CSRF);
    assert.equal(off.status, 200);
    assert.equal(readTracking(world.db, { pathKey: world.key }).projectId, projectId, 'OFF conserva el proyecto');
    assert.equal(readTracking(world.db, { pathKey: world.key }).state, 'off');
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);

    const on = await call(handler, '/tracking', 'PUT', {
      pathKey: world.key, path: world.ws, state: 'on', expectedRevision: data(off).revision,
    }, CSRF);
    assert.equal(on.status, 200, JSON.stringify(on.json));
    assert.equal(data(on).index.state, 'queued');
    assert.equal(data(on).item.projectId, projectId);
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
    assert.equal(drains, 2, 'provisión y reactivación piden drenaje');
  } finally {
    world.close();
    world.cleanup();
  }
});
