/**
 * UX-2.2 · API humana del seguimiento (`GET/PUT/DELETE /pa/tracking`, `pa/1.6.0`) y campos
 * aditivos de `GET /pa/workspaces`.
 *
 * Cada prueba monta el handler real (`createPaHandler`) contra un registro project-aware real
 * (`makeWorld` sobre `mkdtemp`) y un doble del registro de workspaces del Host. Lo que se fija:
 *   - el `GET` publica `items`, `counts`, `asOf` y `version: pa/1.6.0`, con proyecto y relación;
 *   - el `PUT` crea con `expectedRevision: 0`, devuelve revisión 1 y audita la acción humana
 *     (`enable`, `actor='human'`) — nunca la crea el modelo;
 *   - una revisión vieja es `409 revision-conflict` y **no** deja rastro (ni fila ni auditoría);
 *   - el `expectedRevision` que falta es `400`, y el CSRF ausente es `403` sin escribir;
 *   - el `DELETE` exige revisión, la respeta y la segunda vez es `404`;
 *   - la compuerta del host va antes de la ruta: sin credencial las tres rutas no se distinguen;
 *   - `/workspaces` gana `tracked`/`trackingState`/`trackingProject` y sigue sin escribir.
 *
 * Nada toca `~/.dsh`: el perfil es `mkdtemp` y el registro del host es un doble en memoria.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { makeWorld } from './pa3-helpers.mjs';
import { createPaHandler, PA_PREFIX, PA_VERSION } from '../lib/pa-api.mjs';
import { pathKeyFor, closeRegistry, openRegistry } from '../lib/registry.mjs';
import { applyTracking } from '../lib/tracking-store.mjs';

const allow = async () => ({ ok: true, peer: { id: 'host', principal: { kind: 'host' } } });
const deny = async () => ({ ok: false, status: 401, code: 'unauthenticated', message: 'sin credencial' });
const brokenGate = async () => { throw new Error('la compuerta no está disponible'); };

/** Cabeceras del panel: la mutación humana viaja con el testigo CSRF y cuerpo JSON. */
const CSRF = { 'x-lifecode-rag': '1', 'content-type': 'application/json' };

function fakeRegistry(items) {
  return {
    list: () => items,
    get: (id) => items.find((item) => item.id === id),
    create: () => { throw new Error('una lectura de workspaces no puede escribir'); },
    delete: () => { throw new Error('una lectura de workspaces no puede escribir'); },
    setTitle: () => { throw new Error('una lectura de workspaces no puede escribir'); },
  };
}

function hostWorkspace(id, path, { title = null, sessionIds = [] } = {}) {
  return {
    id,
    path,
    title: title ?? path,
    sessionIds,
    status: () => Promise.resolve('ok'),
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

/** Auditoría del registro del perfil, tal cual: cualquier escritura deja una fila nueva. */
function auditRows(world) {
  return world.withRegistry((db) => db.prepare(
    'SELECT seq, at, actor, action, target, outcome FROM audit_registry ORDER BY seq',
  ).all());
}

/** Filas de seguimiento, sin proyectar: el estado real del almacén. */
function trackingRows(world) {
  return world.withRegistry((db) => db.prepare(
    'SELECT path_key, path, project_id, state, association, revision FROM workspace_tracking ORDER BY path_key',
  ).all());
}

/** Siembra una fila por el almacén (no por la ruta) para las pruebas de lectura. */
function seedTracking(world, { path, state = 'on', projectId = null, revision = 0 } = {}) {
  const pathKey = pathKeyFor(path);
  return world.withRegistry((db) => applyTracking(db, {
    pathKey, path, state, projectId, expectedRevision: revision, now: 1_700_000_000_000,
  }));
}

test('GET /tracking: items, counts, asOf y pa/1.6.0, con una fila por seguimiento', async () => {
  const world = await makeWorld();
  try {
    const suelto = join(world.base, 'sin-proyecto');
    seedTracking(world, { path: world.dirA, state: 'on', projectId: world.projectA.id });
    seedTracking(world, { path: suelto, state: 'paused' });
    const response = await call(handlerFor(world), '/tracking');
    assert.equal(response.status, 200);
    const payload = data(response);
    assert.deepEqual(Object.keys(payload).sort(), ['asOf', 'counts', 'items', 'truncated', 'version']);
    assert.equal(payload.version, 'pa/1.6.0');
    assert.equal(payload.truncated, false, 'todo el conjunto cabe en la página');
    assert.equal(PA_VERSION, 'pa/1.6.0');
    assert.equal(typeof payload.asOf, 'number');
    assert.equal(payload.items.length, 2, 'una fila por seguimiento, ni más ni menos');
    const porClave = new Map(payload.items.map((row) => [row.pathKey, row]));
    const deA = porClave.get(pathKeyFor(world.dirA));
    assert.equal(deA.state, 'on');
    assert.deepEqual(deA.project, { id: world.projectA.id, name: 'Proyecto A' });
    assert.equal(deA.relation, 'exact', 'la relación es la del workspace contra las raíces autorizadas');
    const sinProyecto = porClave.get(pathKeyFor(suelto));
    assert.equal(sinProyecto.state, 'paused');
    assert.equal(sinProyecto.project, null);
    assert.equal(sinProyecto.relation, 'none');
    assert.equal(payload.counts.total, 2);
    assert.equal(payload.counts.on, 1);
    assert.equal(payload.counts.paused, 1);
    assert.equal(payload.counts.withProject, 1);
    assert.equal(payload.counts.withoutProject, 1);
  } finally {
    world.cleanup();
  }
});

test('PUT /tracking: crea con expectedRevision 0, revisión 1 y auditoría enable de una persona', async () => {
  const world = await makeWorld();
  try {
    const pathKey = pathKeyFor(world.dirA);
    const response = await call(handlerFor(world), '/tracking', 'PUT', {
      pathKey, path: world.dirA, state: 'on', projectId: world.projectA.id, expectedRevision: 0,
    }, CSRF);
    assert.equal(response.status, 200, JSON.stringify(response.json));
    const payload = data(response);
    assert.equal(payload.changed, true);
    assert.equal(payload.revision, 1);
    assert.equal(payload.item.state, 'on');
    assert.equal(payload.item.revision, 1);
    assert.deepEqual(payload.item.project, { id: world.projectA.id, name: 'Proyecto A' });
    assert.equal(payload.item.relation, 'exact');
    const audit = auditRows(world);
    const humanas = audit.filter((row) => ['enable', 'disable', 'pause', 'resume', 'reassociate'].includes(row.action));
    assert.equal(humanas.length, 1, 'una sola acción humana: la de este PUT');
    assert.equal(humanas[0].action, 'enable');
    assert.equal(humanas[0].actor, 'human', 'el seguimiento lo mueve una persona, nunca el modelo');
    assert.equal(humanas[0].target, pathKey);

    // F8: otro workspace, con su ruta literal. `path` ya no es opcional: el panel la envía siempre.
    const otra = join(world.base, 'otro-workspace');
    const segunda = await call(handlerFor(world), '/tracking', 'PUT', {
      pathKey: pathKeyFor(otra), path: otra, state: 'off', expectedRevision: 0,
    }, CSRF);
    assert.equal(segunda.status, 200, JSON.stringify(segunda.json));
    assert.equal(data(segunda).item.path, otra, 'se guarda la ruta literal que vio la persona');
    assert.equal(trackingRows(world).length, 2);
  } finally {
    world.cleanup();
  }
});

test('PUT /tracking con revisión vieja: 409 revision-conflict y nada cambia', async () => {
  const world = await makeWorld();
  try {
    seedTracking(world, { path: world.dirA, state: 'on', projectId: world.projectA.id });
    const rowsBefore = trackingRows(world);
    const auditBefore = auditRows(world);
    const response = await call(handlerFor(world), '/tracking', 'PUT', {
      pathKey: pathKeyFor(world.dirA), path: world.dirA, state: 'off', expectedRevision: 0,
    }, CSRF);
    assert.equal(response.status, 409);
    assert.equal(response.json.error.code, 'revision-conflict');
    assert.equal(response.json.error.details.reason, 'revision-mismatch');
    assert.deepEqual(trackingRows(world), rowsBefore, 'la fila no se toca');
    assert.deepEqual(auditRows(world), auditBefore, 'ni se audita una escritura que no ocurrió');
  } finally {
    world.cleanup();
  }
});

test('PUT /tracking sin expectedRevision: 400 invalid-argument y sin escritura', async () => {
  const world = await makeWorld();
  try {
    const auditBefore = auditRows(world);
    const response = await call(handlerFor(world), '/tracking', 'PUT', {
      pathKey: pathKeyFor(world.dirA), path: world.dirA, state: 'on',
    }, CSRF);
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'invalid-argument');
    assert.equal(response.json.error.details.reason, 'missing-field');
    assert.equal(response.json.error.details.field, 'expectedRevision');
    assert.deepEqual(trackingRows(world), []);
    assert.deepEqual(auditRows(world), auditBefore);
  } finally {
    world.cleanup();
  }
});

test('PUT /tracking sin cabecera CSRF: 403 forbidden y sin tocar el registro', async () => {
  const world = await makeWorld();
  try {
    const body = { pathKey: pathKeyFor(world.dirA), path: world.dirA, state: 'on', expectedRevision: 0 };
    const auditBefore = auditRows(world);
    // Sin la cabecera del panel, aunque el cuerpo sea perfecto.
    const sinCabecera = await call(handlerFor(world), '/tracking', 'PUT', body, { 'content-type': 'application/json' });
    assert.equal(sinCabecera.status, 403);
    assert.equal(sinCabecera.json.error.code, 'forbidden');
    assert.equal(sinCabecera.json.error.details.reason, 'csrf');
    // Con la cabecera pero sin `content-type: application/json`, tampoco.
    const sinTipo = await call(handlerFor(world), '/tracking', 'PUT', body, { 'x-lifecode-rag': '1' });
    assert.equal(sinTipo.status, 403);
    assert.equal(sinTipo.json.error.details.reason, 'csrf');
    // Y el DELETE también exige el testigo.
    const borrado = await call(handlerFor(world), '/tracking?pathKey=' + encodeURIComponent(pathKeyFor(world.dirA)) + '&expectedRevision=1', 'DELETE');
    assert.equal(borrado.status, 403);
    assert.deepEqual(trackingRows(world), [], 'ninguna mutación sin CSRF llega al almacén');
    assert.deepEqual(auditRows(world), auditBefore);
  } finally {
    world.cleanup();
  }
});

test('DELETE /tracking: sin revisión 400; con la correcta 200 y la fila desaparece; repetido 404', async () => {
  const world = await makeWorld();
  try {
    seedTracking(world, { path: world.dirA, state: 'on', projectId: world.projectA.id });
    const pathKey = pathKeyFor(world.dirA);
    const url = `/tracking?pathKey=${encodeURIComponent(pathKey)}`;
    const sinRevision = await call(handlerFor(world), url, 'DELETE', undefined, CSRF);
    assert.equal(sinRevision.status, 400);
    assert.equal(sinRevision.json.error.code, 'invalid-argument');
    assert.equal(sinRevision.json.error.details.reason, 'missing-field');
    assert.equal(trackingRows(world).length, 1, 'sin revisión no se borra nada');

    const borrado = await call(handlerFor(world), `${url}&expectedRevision=1`, 'DELETE', undefined, CSRF);
    assert.equal(borrado.status, 200, JSON.stringify(borrado.json));
    assert.deepEqual(data(borrado), { changed: true });
    assert.deepEqual(trackingRows(world), []);
    const audit = auditRows(world);
    assert.equal(audit[audit.length - 1].action, 'disable');
    assert.equal(audit[audit.length - 1].actor, 'human');

    const repetido = await call(handlerFor(world), `${url}&expectedRevision=1`, 'DELETE', undefined, CSRF);
    assert.equal(repetido.status, 404);
    assert.equal(repetido.json.error.code, 'not-found');
  } finally {
    world.cleanup();
  }
});

test('validación del cuerpo: campo desconocido, state inválido y expectedRevision no entera son 400', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    const pathKey = pathKeyFor(world.dirA);
    const desconocido = await call(handler, '/tracking', 'PUT', {
      pathKey, path: world.dirA, state: 'on', expectedRevision: 0, project: world.projectA.id,
    }, CSRF);
    assert.equal(desconocido.status, 400);
    assert.equal(desconocido.json.error.details.reason, 'unknown-field');
    const estado = await call(handler, '/tracking', 'PUT', { pathKey, path: world.dirA, state: 'vigilando', expectedRevision: 0 }, CSRF);
    assert.equal(estado.status, 400);
    assert.equal(estado.json.error.details.field, 'state');
    const revision = await call(handler, '/tracking', 'PUT', { pathKey, path: world.dirA, state: 'on', expectedRevision: 1.5 }, CSRF);
    assert.equal(revision.status, 400);
    assert.equal(revision.json.error.details.field, 'expectedRevision');
    assert.deepEqual(trackingRows(world), []);
    // POST sobre la ruta humana no es otra forma de llamarla: 405 que declara los métodos reales.
    const post = await call(handler, '/tracking', 'POST', { pathKey, state: 'on', expectedRevision: 0 }, CSRF);
    assert.equal(post.status, 405);
    assert.deepEqual(post.json.error.details.allow, ['GET', 'HEAD', 'PUT', 'DELETE']);
  } finally {
    world.cleanup();
  }
});

test('compuerta: sin credencial del host las tres rutas no se distinguen de una inventada', async () => {
  const world = await makeWorld();
  try {
    const pathKey = pathKeyFor(world.dirA);
    const body = { pathKey, state: 'on', expectedRevision: 0 };
    const cerrada = handlerFor(world, { authorize: deny });
    const llamadas = [
      ['/tracking', 'GET', undefined],
      ['/tracking', 'PUT', body],
      ['/tracking?pathKey=' + encodeURIComponent(pathKey) + '&expectedRevision=1', 'DELETE', undefined],
      ['/tracking-inventada', 'GET', undefined],
    ];
    const estados = [];
    for (const [route, method, payload] of llamadas) {
      const response = await call(cerrada, route, method, payload, CSRF);
      estados.push(response.status);
      assert.equal(response.json.error.code, 'unauthenticated');
    }
    assert.deepEqual(new Set(estados), new Set([401]), 'la ruta no se revela antes de autenticar');

    const rota = handlerFor(world, { authorize: brokenGate });
    const caidas = [];
    for (const [route, method, payload] of llamadas) {
      const response = await call(rota, route, method, payload, CSRF);
      caidas.push(response.status);
      assert.equal(response.json.error.code, 'authorization-unavailable');
    }
    assert.deepEqual(new Set(caidas), new Set([503]), 'una compuerta rota tampoco distingue rutas');
    assert.deepEqual(trackingRows(world), []);
  } finally {
    world.cleanup();
  }
});

test('/pa/workspaces gana tracked/trackingState/trackingProject y sigue sin escribir', async () => {
  const world = await makeWorld();
  try {
    seedTracking(world, { path: world.dirA, state: 'on', projectId: world.projectA.id });
    const auditBefore = auditRows(world);
    const registry = fakeRegistry([
      hostWorkspace('ws_a', world.dirA, { title: 'Proyecto A' }),
      hostWorkspace('ws_b', world.dirB, { title: 'Proyecto B' }),
    ]);
    const response = await call(handlerFor(world, { registry }), '/workspaces');
    assert.equal(response.status, 200);
    const payload = data(response);
    const porId = new Map(payload.items.map((row) => [row.id, row]));
    assert.equal(porId.get('ws_a').tracked, true);
    assert.equal(porId.get('ws_a').trackingState, 'on');
    assert.deepEqual(porId.get('ws_a').trackingProject, { id: world.projectA.id, name: 'Proyecto A' });
    assert.equal(porId.get('ws_b').tracked, false);
    assert.equal(porId.get('ws_b').trackingState, null);
    assert.equal(porId.get('ws_b').trackingProject, null);
    // Los campos de UX-2.1 siguen intactos.
    assert.equal(porId.get('ws_a').relation, 'exact');
    assert.deepEqual(porId.get('ws_a').project, { id: world.projectA.id, name: 'Proyecto A' });
    assert.equal(typeof porId.get('ws_a').sessions.known, 'number');
    // Leer no escribe: ni seguimiento, ni lista de seguimiento, ni auditoría.
    assert.deepEqual(auditRows(world), auditBefore, 'GET /workspaces no audita nada');
    assert.equal(trackingRows(world).length, 1);
    assert.deepEqual(trackingRows(world)[0].state, 'on');
  } finally {
    world.cleanup();
  }
});

test('GET /tracking funciona sin proyecto activo, como /workspaces', async () => {
  const world = await makeWorld();
  try {
    seedTracking(world, { path: world.dirA, state: 'on', projectId: world.projectA.id });
    world.withRegistry((db) => {
      db.prepare("UPDATE projects SET status='archived', archived_at=1").run();
    });
    const response = await call(handlerFor(world), '/tracking');
    assert.equal(response.status, 200, 'el seguimiento no depende de un proyecto activo');
    const payload = data(response);
    assert.equal(payload.items.length, 1, 'archivar un proyecto no borra la decisión humana');
    assert.equal(payload.items[0].state, 'on');
    // El join al registro conserva el nombre; la relación cae a `none` porque un proyecto
    // archivado no se usa para relacionar (mismo criterio que /workspaces).
    assert.deepEqual(payload.items[0].project, { id: world.projectA.id, name: 'Proyecto A' });
    assert.equal(payload.items[0].relation, 'none');
  } finally {
    world.cleanup();
  }
});

test('compatibilidad: pa/1.3.0 y pa/1.4.0 siguen respondiendo igual bajo pa/1.6.0', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world, { registry: fakeRegistry([hostWorkspace('ws_a', world.dirA)]) });
    const project = '?project=' + encodeURIComponent(world.projectA.id);
    const snapshot = await call(handler, '/snapshot' + project);
    assert.equal(snapshot.status, 200);
    const payload = data(snapshot);
    // Ninguna clave de 1.3.0 desaparece y la ruta nueva no cambia el snapshot.
    for (const key of [
      'mode', 'service', 'asOf', 'version', 'project', 'selection', 'projects', 'archived',
      'roots', 'auth', 'scopes', 'libraries', 'sources', 'audit', 'config', 'capabilities',
    ]) {
      assert.equal(Object.prototype.hasOwnProperty.call(payload, key), true, `el snapshot perdió ${key}`);
    }
    assert.equal(payload.version, 'pa/1.6.0');
    assert.deepEqual(Object.keys(data(await call(handler, '/config'))).sort(), ['config', 'mode', 'profile', 'service', 'version']);
    const history = await call(handler, '/history' + project);
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(data(history).entries));
    const workspaces = await call(handler, '/workspaces');
    assert.deepEqual(Object.keys(data(workspaces)).sort(), [
      'asOf', 'counts', 'items', 'mode', 'reason', 'service', 'source', 'truncated', 'version',
    ]);
    const search = await call(handler, '/search' + project, 'POST', { query: 'alfa', limit: 1 });
    assert.equal(search.status, 200);
    const actions = await call(handler, '/actions');
    assert.equal(actions.status, 403);
    assert.equal(actions.json.error.code, 'approval-required');
    // Un parámetro no declarado en la ruta nueva se rechaza, como en el resto de la API.
    const raro = await call(handler, '/tracking?path=' + encodeURIComponent(world.dirA));
    assert.equal(raro.status, 400);
    assert.equal(raro.json.error.details.reason, 'unknown-parameter');
  } finally {
    world.cleanup();
  }
});

/**
 * F8 · El `PUT` no acepta una identidad inventada. Antes cualquier texto servía de `pathKey` y, sin
 * `path`, se guardaba la clave en minúsculas como ruta visible: la fila quedaba apuntando a un
 * workspace que no era el de la persona. Ahora `path` es obligatoria, absoluta, sin `..` ni NUL y su
 * clave canónica (`pathKeyFor`, no una copia) tiene que ser exactamente la declarada.
 */
test('F8: path obligatoria, absoluta, sin «..» ni NUL, y pathKey derivado de path', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    const auditBefore = auditRows(world);
    const pathKey = pathKeyFor(world.dirA);

    const sinPath = await call(handler, '/tracking', 'PUT', {
      pathKey, state: 'on', expectedRevision: 0,
    }, CSRF);
    assert.equal(sinPath.status, 400);
    assert.equal(sinPath.json.error.code, 'invalid-argument');
    assert.deepEqual(sinPath.json.error.details, { reason: 'missing-field', field: 'path' });

    const relativa = await call(handler, '/tracking', 'PUT', {
      pathKey, path: 'proyecto-a/documentos', state: 'on', expectedRevision: 0,
    }, CSRF);
    assert.equal(relativa.status, 400);
    assert.deepEqual(relativa.json.error.details, { reason: 'invalid-field', field: 'path' });

    const conPadre = await call(handler, '/tracking', 'PUT', {
      pathKey, path: `${world.dirA}/../proyecto-a`, state: 'on', expectedRevision: 0,
    }, CSRF);
    assert.equal(conPadre.status, 400);
    assert.deepEqual(conPadre.json.error.details, { reason: 'invalid-field', field: 'path' });

    const conNul = await call(handler, '/tracking', 'PUT', {
      pathKey, path: `${world.dirA}\0oculto`, state: 'on', expectedRevision: 0,
    }, CSRF);
    assert.equal(conNul.status, 400);
    assert.deepEqual(conNul.json.error.details, { reason: 'invalid-field', field: 'path' });

    // Misma petición válida salvo por la identidad: la clave de A con la ruta de B no cuadra.
    const descuadre = await call(handler, '/tracking', 'PUT', {
      pathKey, path: world.dirB, state: 'on', expectedRevision: 0,
    }, CSRF);
    assert.equal(descuadre.status, 400);
    assert.equal(descuadre.json.error.code, 'invalid-argument');
    assert.equal(descuadre.json.error.details.reason, 'pathKey-mismatch');
    assert.equal(descuadre.json.error.details.pathKey, pathKey);
    assert.equal(descuadre.json.error.details.expectedPathKey, pathKeyFor(world.dirB),
      'el esperado es el que calcula pathKeyFor para esa ruta, no una suposición');

    // Ninguna de las cinco llega al almacén ni a la auditoría.
    assert.deepEqual(trackingRows(world), [], 'un cuerpo inválido no crea fila');
    assert.deepEqual(auditRows(world), auditBefore, 'ni deja auditoría');
  } finally {
    world.cleanup();
  }
});

/**
 * F15 · `counts` describe el conjunto, `items` la página. Antes `counts` se sumaba sobre las 1000
 * filas del listado: con un `limit` menor, el total era el de la página y nada lo declaraba.
 */
test('F15: counts sobre el conjunto completo y truncated declarando la página', async () => {
  const world = await makeWorld();
  try {
    const suelto = join(world.base, 'suelto');
    seedTracking(world, { path: world.dirA, state: 'on', projectId: world.projectA.id });
    seedTracking(world, { path: world.dirB, state: 'off', projectId: world.projectB.id });
    seedTracking(world, { path: suelto, state: 'paused' });

    const pagina = await call(handlerFor(world), '/tracking?limit=2');
    assert.equal(pagina.status, 200);
    const recortada = data(pagina);
    assert.equal(recortada.items.length, 2, 'la página respeta limit');
    assert.equal(recortada.counts.total, 3, 'el total es el del conjunto, no el de la página');
    assert.equal(recortada.counts.on, 1);
    assert.equal(recortada.counts.off, 1);
    assert.equal(recortada.counts.paused, 1);
    assert.equal(recortada.counts.withProject, 2);
    assert.equal(recortada.counts.withoutProject, 1);
    assert.equal(recortada.truncated, true, 'truncated declara que hay más filas');

    const completa = data(await call(handlerFor(world), '/tracking'));
    assert.equal(completa.items.length, 3);
    assert.equal(completa.counts.total, 3);
    assert.equal(completa.truncated, false, 'sin recorte, truncated es falso');
  } finally {
    world.cleanup();
  }
});

/**
 * F10 · Contención de SQLite. Una segunda conexión retiene `BEGIN IMMEDIATE`; el `PUT` del handler
 * agota `busy_timeout` y la excepción cruda (`database is locked`, errcode 5) **no** puede salir como
 * `500 internal`: se traduce a `503 store-busy` reintentable. El `busy_timeout` de la conexión del
 * handler es de 5 s (`lib/db.mjs`), así que esta prueba tarda unos segundos a propósito: demuestra la
 * espera real, no un atajo.
 */
test('F10: contención de SQLite responde 503 store-busy, no 500', async () => {
  const world = await makeWorld();
  const holder = openRegistry({ root: world.root, create: false });
  try {
    holder.db.exec('BEGIN IMMEDIATE');
    const response = await call(handlerFor(world), '/tracking', 'PUT', {
      pathKey: pathKeyFor(world.dirA), path: world.dirA, state: 'on', expectedRevision: 0,
    }, CSRF);
    assert.equal(response.status, 503, JSON.stringify(response.json));
    assert.equal(response.json.error.code, 'store-busy');
    assert.equal(response.json.error.details.reason, 'database-locked');
    assert.equal(response.json.error.details.retryable, true);
    assert.equal(response.json.error.details.errcode, 5, 'SQLITE_BUSY, no corrupción');
    assert.deepEqual(trackingRows(world), [], 'la contención no escribe nada');
  } finally {
    try { holder.db.exec('ROLLBACK'); } catch { /* si el BEGIN ya no está, nada que revertir */ }
    closeRegistry(holder.db);
    world.cleanup();
  }
});
