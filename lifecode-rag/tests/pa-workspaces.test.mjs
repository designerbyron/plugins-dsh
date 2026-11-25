/**
 * UX-2.1 · `GET /pa/workspaces` de punta a punta sobre un perfil temporal.
 *
 * Cada prueba monta el handler real (`createPaHandler`) contra un registro Project-Aware real
 * (`mkdtemp`) y un doble del registro de workspaces del Host. Lo que se fija:
 *   - el Host ausente **no** produce una lista vacía que parezca un resultado (T-W2-02);
 *   - un `status()` que rechaza o no responde no rompe la lista (T-W2-03 + timeout);
 *   - ninguna escritura del registro del Host se invoca (T-W2-12), con doble que lanza y registra;
 *   - la selección global y el registro del perfil quedan idénticos (T-W2-13);
 *   - `pa/1.3.0` sigue respondiendo con la misma forma y `pa/1.4.0` sólo añade (T-W2-14/15);
 *     `pa/1.6.0` añade el seguimiento sin quitar ninguna de esas claves.
 *
 * Nada toca `~/.dsh`: el perfil es `mkdtemp` y el registro del host es un doble en memoria.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { makeWorld } from './pa3-helpers.mjs';
import { createPaHandler, PA_PREFIX, PA_VERSION } from '../lib/pa-api.mjs';
import { DEFAULT_BUDGET_MS, projectWorkspaces } from '../lib/harness-workspaces.mjs';
import { closeRegistry, listRoots, openRegistry } from '../lib/registry.mjs';

const allow = async () => ({ ok: true, peer: { id: 'host', principal: { kind: 'host' } } });
const deny = async () => ({ ok: false, status: 401, code: 'unauthenticated', message: 'sin credencial' });

/**
 * Doble del registro de workspaces del Host.
 *
 * Las operaciones de escritura del contrato real (`create`, `delete`, `setTitle`, `attachSession`,
 * `detachSession`, `insertSessionBefore`, `insertBefore`, `archiveSession`, `unarchiveSession`,
 * `pinSession`) existen a propósito y **lanzan** al ser llamadas, dejando rastro en `writes`: si la
 * ruta las usara, la prueba fallaría por excepción y por recuento.
 */
function fakeRegistry(items, { onList } = {}) {
  const writes = [];
  const forbid = (name) => async (...args) => {
    writes.push({ name, args });
    throw new Error(`escritura prohibida en UX-2.1: ${name}`);
  };
  return {
    writes,
    list: () => {
      if (onList) return onList();
      return items;
    },
    get: (id) => items.find((item) => item.id === id),
    resolveByPath: async () => { throw new Error('resolveByPath no debe usarse: hace realpath y puede rechazar'); },
    create: forbid('create'),
    delete: forbid('delete'),
    setTitle: forbid('setTitle'),
    attachSession: forbid('attachSession'),
    detachSession: forbid('detachSession'),
    insertSessionBefore: forbid('insertSessionBefore'),
    insertBefore: forbid('insertBefore'),
    archiveSession: forbid('archiveSession'),
    unarchiveSession: forbid('unarchiveSession'),
    pinSession: forbid('pinSession'),
  };
}

/** Workspace como lo entrega el Host: `status()` es asíncrono y hace `stat`. */
function hostWorkspace(id, path, { title = null, sessionIds = [], status = 'ok' } = {}) {
  return {
    id,
    path,
    title: title ?? path,
    sessionIds,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    status: () => (typeof status === 'function' ? status() : Promise.resolve(status)),
  };
}

function handlerFor(world, { registry = null, sessions = null, authorize = allow } = {}) {
  return createPaHandler({
    profileRoot: world.root,
    profileKey: 'pa3-test',
    authorize,
    services: {
      get workspaces() { return registry; },
      get sessions() { return sessions; },
    },
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
  return { status: res.statusCode, json: JSON.parse(res.body || '{}'), headers: res.headers };
}

const data = (response) => response.json.data;

function snapshotOfRegistry(world) {
  const { db } = openRegistry({ root: world.root, create: false });
  try {
    return {
      selection: db.prepare('SELECT selection_key, project_id, revision, selected_by FROM pa_selection ORDER BY selection_key').all(),
      projects: db.prepare('SELECT id, name, status FROM projects ORDER BY id').all(),
      roots: listRoots(db).map((row) => ({ scope: row.scope_id, path: row.path, state: row.state })),
      auditRows: db.prepare('SELECT COUNT(*) AS n, MAX(seq) AS head FROM audit_registry').get(),
      trusted: db.prepare("SELECT value FROM meta WHERE key='trusted_roots'").all(),
    };
  } finally {
    closeRegistry(db);
  }
}

function digestOf(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('T-W2-02: sin registro del Host no hay lista — source none con motivo', async () => {
  const world = await makeWorld();
  try {
    const response = await call(handlerFor(world), '/workspaces');
    assert.equal(response.status, 200);
    const payload = data(response);
    assert.equal(payload.source, 'none');
    assert.equal(payload.reason, 'no-registry');
    assert.deepEqual(payload.items, []);
    assert.equal(payload.truncated, false);
    assert.equal(payload.version, PA_VERSION);
    // Una lista vacía «normal» sería indistinguible de un perfil sin workspaces: aquí se distingue.
    assert.equal(payload.counts.total, 0);
  } finally {
    world.cleanup();
  }
});

test('un list() que falla o devuelve basura tampoco se pinta como lista', async () => {
  const world = await makeWorld();
  try {
    const roto = await call(handlerFor(world, { registry: fakeRegistry([], { onList: () => { throw new Error('boom'); } }) }), '/workspaces');
    assert.equal(data(roto).source, 'none');
    assert.equal(data(roto).reason, 'registry-error');
    const basura = await call(handlerFor(world, { registry: fakeRegistry([], { onList: () => ({ nope: true }) }) }), '/workspaces');
    assert.equal(data(basura).source, 'none');
    assert.equal(data(basura).reason, 'registry-invalid');
  } finally {
    world.cleanup();
  }
});

test('T-W2-01/15: la lista sale normalizada y aditiva sobre pa/1.3.0', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([
      hostWorkspace('ws_a', world.dirA, { title: 'Proyecto A', sessionIds: ['s1', 's2'] }),
      hostWorkspace('ws_b', world.dirB, { title: 'Proyecto B', sessionIds: ['s3'] }),
      hostWorkspace('ws_hijo', join(world.dirA, 'sub'), { title: 'sub' }),
    ]);
    const sessions = { list: () => ['s1', 's3', 'otra-sesion'] };
    const response = await call(handlerFor(world, { registry, sessions }), '/workspaces');
    assert.equal(response.status, 200);
    const payload = data(response);
    assert.equal(payload.source, 'host');
    assert.equal(payload.reason, null);
    assert.equal(payload.items.length, 3);
    const porId = new Map(payload.items.map((row) => [row.id, row]));
    assert.equal(porId.get('ws_a').relation, 'exact');
    assert.equal(porId.get('ws_a').project.name, 'Proyecto A');
    assert.deepEqual(porId.get('ws_a').sessions, { known: 2, live: 1, historical: 1 });
    assert.equal(porId.get('ws_b').sessions.live, 1);
    assert.equal(porId.get('ws_hijo').relation, 'inside');
    assert.equal(porId.get('ws_hijo').project.name, 'Proyecto A');
    assert.equal(payload.counts.withProject, 3);
    assert.equal(payload.counts.liveSessions, 2);
    // Campos que el Host NO publica no aparecen inventados en la respuesta.
    for (const row of payload.items) {
      assert.equal(Object.prototype.hasOwnProperty.call(row, 'sessionIds'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(row, 'lastActivityAt'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(row, 'archived'), false);
    }
  } finally {
    world.cleanup();
  }
});

test('T-W2-03: un status() que rechaza deja ese item en unknown y no rompe la lista', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([
      hostWorkspace('ws_ok', world.dirA),
      hostWorkspace('ws_roto', world.dirB, { status: () => Promise.reject(new Error('EPERM')), title: 'roto' }),
      hostWorkspace('ws_ok2', join(world.base, 'tercero')),
    ]);
    const response = await call(handlerFor(world, { registry }), '/workspaces');
    assert.equal(response.status, 200);
    const payload = data(response);
    assert.equal(payload.items.length, 3);
    const roto = payload.items.find((row) => row.id === 'ws_roto');
    assert.equal(roto.state, 'unknown');
    assert.equal(roto.stateReason, 'status-error');
    assert.deepEqual(payload.items.filter((row) => row.state === 'ok').map((row) => row.id), ['ws_ok', 'ws_ok2']);
    assert.equal(payload.counts.unknown, 1);
    assert.equal(payload.counts.ok, 2);
  } finally {
    world.cleanup();
  }
});

test('un status() que nunca responde termina en timeout controlado, sin bloquear la lista', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([
      hostWorkspace('ws_colgado', world.dirA, { status: () => new Promise(() => {}) }),
      hostWorkspace('ws_vivo', world.dirB),
    ]);
    const started = Date.now();
    const response = await call(handlerFor(world, { registry }), '/workspaces');
    const elapsed = Date.now() - started;
    assert.equal(response.status, 200);
    const payload = data(response);
    assert.equal(payload.items.length, 2);
    const colgado = payload.items.find((row) => row.id === 'ws_colgado');
    assert.equal(colgado.state, 'unknown');
    assert.equal(colgado.stateReason, 'timeout');
    assert.equal(payload.items.find((row) => row.id === 'ws_vivo').state, 'ok');
    assert.ok(elapsed < 5000, `la petición debe cerrar por timeout, tardó ${elapsed} ms`);
  } finally {
    world.cleanup();
  }
});

test('presupuesto agotado: el resto queda unknown con motivo budget, no se pierde ninguna fila', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([
      hostWorkspace('ws_1', world.dirA),
      hostWorkspace('ws_2', world.dirB),
    ]);
    const payload = await projectWorkspaces(registry, { projects: [], budgetMs: 0 });
    assert.equal(payload.items.length, 2);
    assert.deepEqual(payload.items.map((row) => row.state), ['unknown', 'unknown']);
    assert.deepEqual(payload.items.map((row) => row.stateReason), ['budget', 'budget']);
  } finally {
    world.cleanup();
  }
});

test('el presupuesto por defecto existe y es finito', () => {
  assert.equal(Number.isFinite(DEFAULT_BUDGET_MS), true);
  assert.ok(DEFAULT_BUDGET_MS > 0);
});

test('T-W2-12: cero llamadas de escritura al registro del Host', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([
      hostWorkspace('ws_a', world.dirA, { sessionIds: ['s1'] }),
      hostWorkspace('ws_b', world.dirB),
    ]);
    const response = await call(handlerFor(world, { registry, sessions: { list: () => ['s1'] } }), '/workspaces');
    assert.equal(response.status, 200);
    assert.deepEqual(registry.writes, [], 'ninguna operación de mutación puede haberse invocado');
  } finally {
    world.cleanup();
  }
});

test('T-W2-13: la petición no change la selección, los proyectos, las raíces ni la auditoría', async () => {
  const world = await makeWorld();
  try {
    const registryPath = join(world.root, 'registry.sqlite3');
    const storeA = join(world.root, 'scopes', world.projectA.id, 'rag.sqlite3');
    const storeB = join(world.root, 'scopes', world.projectB.id, 'rag.sqlite3');
    const before = snapshotOfRegistry(world);
    const hashBefore = digestOf(registryPath);
    // Los almacenes de ámbito guardan las FUENTES y los CONTEXTOS: la ruta de workspaces no debe ni
    // abrirlos (no llama a `openScopeStore`), así que sus bytes tienen que quedar idénticos.
    const storesBefore = { a: digestOf(storeA), b: digestOf(storeB) };
    const registry = fakeRegistry([hostWorkspace('ws_a', world.dirA)]);
    await call(handlerFor(world, { registry }), '/workspaces');
    const after = snapshotOfRegistry(world);
    assert.deepEqual(after.selection, before.selection);
    assert.deepEqual(after.projects, before.projects);
    assert.deepEqual(after.roots, before.roots);
    assert.deepEqual(after.auditRows, before.auditRows);
    assert.deepEqual(after.trusted, before.trusted);
    assert.equal(digestOf(registryPath), hashBefore, 'el registro del perfil no se escribe al leer workspaces');
    assert.deepEqual({ a: digestOf(storeA), b: digestOf(storeB) }, storesBefore, 'los almacenes de ámbito no se tocan');
  } finally {
    world.cleanup();
  }
});

test('navegar por otras rutas de lectura tampoco escribe en el registro', async () => {
  const world = await makeWorld();
  try {
    const registryPath = join(world.root, 'registry.sqlite3');
    const hashBefore = digestOf(registryPath);
    const handler = handlerFor(world, { registry: fakeRegistry([hostWorkspace('ws_a', world.dirA)]) });
    const project = '?project=' + encodeURIComponent(world.projectA.id);
    for (const route of ['/config', '/snapshot' + project, '/history' + project, '/workspaces']) {
      const response = await call(handler, route);
      assert.ok(response.status === 200, `${route} respondió ${response.status}`);
    }
    assert.equal(digestOf(registryPath), hashBefore);
  } finally {
    world.cleanup();
  }
});

test('T-W2-14/15: las rutas de pa/1.3.0 conservan su forma y el snapshot no pierde claves', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world, { registry: fakeRegistry([hostWorkspace('ws_a', world.dirA)]) });
    const project = '?project=' + encodeURIComponent(world.projectA.id);
    const snapshot = await call(handler, '/snapshot' + project);
    assert.equal(snapshot.status, 200);
    const payload = data(snapshot);
    // Conjunto de claves de primer nivel fijado en pa/1.3.0: pa/1.4.0 no quita ninguna.
    const KEYS_1_3_0 = [
      'mode', 'service', 'asOf', 'version', 'project', 'selection', 'projects', 'archived',
      'roots', 'auth', 'scopes', 'libraries', 'sources', 'audit', 'config', 'capabilities',
    ];
    for (const key of KEYS_1_3_0) {
      assert.equal(Object.prototype.hasOwnProperty.call(payload, key), true, `el snapshot perdió ${key}`);
    }
    assert.equal(payload.version, 'pa/1.6.0');
    // UX-2.2 sube el contrato a `pa/1.6.0` de forma aditiva: las claves de 1.3.0 siguen todas.
    assert.equal(PA_VERSION, 'pa/1.6.0');
    const config = await call(handler, '/config');
    assert.deepEqual(Object.keys(data(config)).sort(), ['config', 'mode', 'profile', 'service', 'version']);
    const history = await call(handler, '/history' + project);
    assert.equal(history.status, 200);
    assert.equal(typeof data(history).total, 'number');
    assert.ok(Array.isArray(data(history).entries));
  } finally {
    world.cleanup();
  }
});

test('el contrato nuevo sólo añade: /workspaces responde con su forma exacta', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([hostWorkspace('ws_a', world.dirA)]);
    const payload = data(await call(handlerFor(world, { registry }), '/workspaces'));
    assert.deepEqual(Object.keys(payload).sort(), [
      'asOf', 'counts', 'items', 'mode', 'reason', 'service', 'source', 'truncated', 'version',
    ]);
    assert.deepEqual(Object.keys(payload.items[0]).sort(), [
      'id', 'path', 'pathKey', 'project', 'relation', 'sessions', 'state', 'stateReason', 'title',
      // UX-2.2: aditivos por fila. `tracked` es la existencia de la fila; `trackingState` el eje A.
      'tracked', 'trackingProject', 'trackingState',
    ]);
    assert.deepEqual(Object.keys(payload.counts).sort(), [
      'exact', 'inside', 'knownSessions', 'liveSessions', 'missing', 'ok', 'returned',
      'skipped', 'total', 'unknown', 'withProject', 'withoutProject',
    ]);
  } finally {
    world.cleanup();
  }
});

test('sin servicio de sesiones el desglose es null y la respuesta lo declara', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([hostWorkspace('ws_a', world.dirA, { sessionIds: ['s1'] })]);
    const payload = data(await call(handlerFor(world, { registry }), '/workspaces'));
    assert.equal(payload.reason, 'sessions-unavailable');
    assert.deepEqual(payload.items[0].sessions, { known: 1, live: null, historical: null });
  } finally {
    world.cleanup();
  }
});

test('un servicio de sesiones que falla no inventa cero sesiones vivas', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([hostWorkspace('ws_a', world.dirA, { sessionIds: ['s1'] })]);
    const sessions = { list: () => { throw new Error('store cerrado'); } };
    const payload = data(await call(handlerFor(world, { registry, sessions }), '/workspaces'));
    assert.equal(payload.items[0].sessions.live, null);
    assert.equal(payload.reason, 'sessions-unavailable');
  } finally {
    world.cleanup();
  }
});

test('los workspaces anidados son filas independientes y no se fusionan', async () => {
  const world = await makeWorld();
  try {
    const padre = world.dirA;
    const hijo = join(padre, 'anidado');
    const registry = fakeRegistry([
      hostWorkspace('ws_padre', padre, { title: 'padre' }),
      hostWorkspace('ws_hijo', hijo, { title: 'hijo' }),
    ]);
    const payload = data(await call(handlerFor(world, { registry }), '/workspaces'));
    assert.equal(payload.items.length, 2);
    const filas = payload.items.map((row) => `${row.id}:${row.relation}`);
    assert.deepEqual(filas, ['ws_padre:exact', 'ws_hijo:inside']);
  } finally {
    world.cleanup();
  }
});

test('truncamiento y límites: limit acota filas, truncated lo declara', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([
      hostWorkspace('ws_1', world.dirA),
      hostWorkspace('ws_2', world.dirB),
      hostWorkspace('ws_3', join(world.base, 'tercero')),
    ]);
    const handler = handlerFor(world, { registry });
    const page = data(await call(handler, '/workspaces?limit=2'));
    assert.equal(page.items.length, 2);
    assert.equal(page.truncated, true);
    assert.equal(page.counts.total, 3);
    assert.equal(page.counts.returned, 2);
    const todo = data(await call(handler, '/workspaces'));
    assert.equal(todo.items.length, 3);
    assert.equal(todo.truncated, false);
    const excesivo = await call(handler, '/workspaces?limit=201');
    assert.equal(excesivo.status, 400);
    assert.equal(excesivo.json.error.code, 'invalid-argument');
    const desconocido = await call(handler, '/workspaces?path=C:/x');
    assert.equal(desconocido.status, 400);
    assert.equal(desconocido.json.error.details.reason, 'unknown-parameter');
  } finally {
    world.cleanup();
  }
});

test('/workspaces es de lectura y pasa por la compuerta del host', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([hostWorkspace('ws_a', world.dirA)]);
    const post = await call(handlerFor(world, { registry }), '/workspaces', 'POST', {});
    assert.equal(post.status, 405);
    const sinCredencial = await call(handlerFor(world, { registry, authorize: deny }), '/workspaces', 'GET', undefined, {});
    assert.equal(sinCredencial.status, 401);
    const sinCompuerta = await call(createPaHandler({
      profileRoot: world.root,
      profileKey: 'pa3-test',
      services: { get workspaces() { return registry; } },
    }), '/workspaces');
    // El núcleo sirve sin compuerta (contrato de independencia); el adaptador de DSH siempre pasa una.
    assert.equal(sinCompuerta.status, 200);
  } finally {
    world.cleanup();
  }
});

test('un perfil sin proyecto activo sigue pudiendo leer los workspaces del Host', async () => {
  const world = await makeWorld();
  try {
    // Se archiva el único proyecto «seleccionable» no: se archivan los dos, dejando el perfil vacío.
    world.withRegistry((db) => {
      db.prepare("UPDATE projects SET status='archived', archived_at=1").run();
    });
    const registry = fakeRegistry([hostWorkspace('ws_a', world.dirA)]);
    const response = await call(handlerFor(world, { registry }), '/workspaces');
    assert.equal(response.status, 200);
    const payload = data(response);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].project, null, 'un proyecto archivado no se usa para relacionar');
    assert.equal(payload.items[0].relation, 'none');
  } finally {
    world.cleanup();
  }
});

test('entradas inválidas del Host no se convierten en filas', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([
      hostWorkspace('ws_a', world.dirA),
      { id: 'ws_sin_ruta', title: 'sin ruta', sessionIds: [] },
      null,
    ]);
    const payload = data(await call(handlerFor(world, { registry }), '/workspaces'));
    assert.equal(payload.items.length, 1);
    assert.equal(payload.counts.skipped, 2);
  } finally {
    world.cleanup();
  }
});

test('la respuesta no filtra rutas de proyectos no relacionadas', async () => {
  const world = await makeWorld();
  try {
    const registry = fakeRegistry([hostWorkspace('ws_a', join(world.base, 'otra-carpeta'))]);
    const body = JSON.stringify(data(await call(handlerFor(world, { registry }), '/workspaces')));
    assert.equal(body.includes(world.dirA.replaceAll('\\', '/')), false, 'la ruta del proyecto A no aparece');
    assert.equal(body.toLowerCase().includes('proyecto a'), false, 'ni su nombre');
  } finally {
    world.cleanup();
  }
});
