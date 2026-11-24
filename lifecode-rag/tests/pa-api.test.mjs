/** LE-RAG-10 · API PA (solo lectura) sobre un mundo aislado. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeWorld } from './pa3-helpers.mjs';
import { createPaHandler, PA_PREFIX } from '../lib/pa-api.mjs';
import { addTrustedRoot } from '../lib/trusted-roots.mjs';

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

test('PA/CR-1: el snapshot declara los proyectos seleccionables del perfil', async () => {
  const world = await makeWorld();
  try {
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    const snap = await call(handler, '/snapshot?project=' + world.projectA.id);
    assert.equal(snap.status, 200);
    assert.equal(Array.isArray(snap.json.data.projects), true, 'el panel necesita la lista para poder cambiar de proyecto');
    assert.equal(snap.json.data.projects.length, 2);
    const current = snap.json.data.projects.filter((row) => row.current);
    assert.deepEqual(current.map((row) => row.id), [world.projectA.id]);
    for (const row of snap.json.data.projects) {
      assert.equal(typeof row.id, 'string');
      assert.equal(typeof row.name, 'string');
      assert.equal(typeof row.roots, 'number');
      assert.equal(Object.prototype.hasOwnProperty.call(row, 'current'), true);
    }
    // La lista es de proyectos del perfil, no de ámbitos del proyecto activo.
    assert.deepEqual(snap.json.data.projects.map((row) => row.id).sort(), [world.projectA.id, world.projectB.id].sort());
  } finally { world.cleanup(); }
});

test('PA: snapshot, search, context, config y actions', async () => {
  const world = await makeWorld();
  try {
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    const P = '?project=' + world.projectA.id;

    const snap = await call(handler, '/snapshot' + P);
    assert.equal(snap.status, 200);
    assert.equal(snap.json.data.mode, 'api');
    assert.equal(snap.json.data.project.id, world.projectA.id);
    assert.ok(snap.json.data.sources.total >= 1);

    const search = await call(handler, '/search' + P, 'POST', { query: 'alfa', limit: 3 });
    assert.equal(search.status, 200);
    assert.ok(search.json.data.results.length >= 1);
    const row = search.json.data.results[0];
    for (const field of ['chunkKey', 'sourceId', 'uri', 'title', 'heading', 'ordinal', 'rrf', 'score', 'snippet', 'scopeId', 'scopeKind', 'scopeName']) {
      assert.ok(Object.prototype.hasOwnProperty.call(row, field), 'falta el campo contractual ' + field);
    }
    assert.equal(row.uri, 'a.md', 'la URI se relativiza: nunca la ruta absoluta del disco');
    assert.equal(row.scopeId, world.projectA.id);
    assert.equal(row.scopeKind, 'prj');
    assert.equal(row.scopeName, 'Proyecto A');
    assert.equal(search.json.data.scopes.length, 1);
    assert.equal(typeof search.json.data.elapsedMs, 'number');

    const ctx = await call(handler, '/context' + P, 'POST', { query: 'alfa', budgetTokens: 200 });
    assert.equal(ctx.status, 200);
    assert.ok(Array.isArray(ctx.json.data.citations));
    assert.ok(ctx.json.data.citations.length >= 1);
    assert.equal(typeof ctx.json.data.tokens, 'number', 'el contrato expone tokens, no tokensEstimate');
    assert.equal(typeof ctx.json.data.truncated, 'boolean');
    assert.equal(typeof ctx.json.data.considered, 'number');
    assert.equal(typeof ctx.json.data.text, 'string', 'el texto servible al modelo forma parte del contrato');
    assert.ok(ctx.json.data.text.length > 0);
    assert.equal(ctx.json.data.text.includes('proyecto-a'), false, 'el texto no arrastra rutas del disco');
    assert.equal(ctx.json.data.citations[0].uri, 'a.md');
    assert.equal(ctx.json.data.scopes[0].id, world.projectA.id);

    const cfg = await call(handler, '/config');
    assert.equal(cfg.status, 200);
    assert.equal(typeof cfg.json.data.config.search.limit, 'number');

    const actions = await call(handler, '/actions', 'POST');
    assert.equal(actions.status, 403);
    assert.equal(actions.json.error.code, 'approval-required');
    assert.deepEqual(actions.json.error.details.tools, ['lifecode_rag_ingest', 'lifecode_rag_forget', 'lifecode_rag_reindex']);
  } finally { world.cleanup(); }
});

test('PA: /search y /context exigen POST; GET se rechaza con 405', async () => {
  const world = await makeWorld();
  try {
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    const P = '?project=' + world.projectA.id;
    for (const route of ['/search', '/context']) {
      const get = await call(handler, route + P + '&q=alfa');
      assert.equal(get.status, 405, route + ' con GET debe rechazarse');
      assert.equal(get.json.error.code, 'method-not-allowed');
      assert.deepEqual(get.json.error.details.allow, ['POST']);
      const put = await call(handler, route + P, 'PUT', { query: 'alfa' });
      assert.equal(put.status, 405);
    }
  } finally { world.cleanup(); }
});

test('PA: cuerpo JSON inválido, vacío o que no es objeto', async () => {
  const world = await makeWorld();
  try {
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    const P = '?project=' + world.projectA.id;
    const cases = [
      ['{no es json', 'invalid-json'],
      ['', 'missing-body'],
      ['[1,2,3]', 'invalid-body'],
      ['"texto"', 'invalid-body'],
    ];
    for (const [raw, reason] of cases) {
      const r = await call(handler, '/search' + P, 'POST', raw);
      assert.equal(r.status, 400, 'cuerpo ' + JSON.stringify(raw));
      assert.equal(r.json.error.code, 'invalid-argument');
      assert.equal(r.json.error.details.reason, reason);
      assert.equal(r.json.data, undefined, 'un error nunca se degrada a lista vacía');
    }
  } finally { world.cleanup(); }
});

test('PA: campos ausentes, tipos incorrectos, desconocidos y límites', async () => {
  const world = await makeWorld();
  try {
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    const P = '?project=' + world.projectA.id;
    const cases = [
      ['/search', {}, 'missing-field', 'query'],
      ['/search', { query: 42 }, 'invalid-field', 'query'],
      ['/search', { query: '   ' }, 'invalid-field', 'query'],
      ['/search', { query: 'alfa', limit: '8' }, 'invalid-field', 'limit'],
      ['/search', { query: 'alfa', limit: 0 }, 'invalid-field', 'limit'],
      ['/search', { query: 'alfa', limit: 51 }, 'limit-too-large', 'limit'],
      ['/search', { query: 'x'.repeat(513) }, 'query-too-long', 'query'],
      ['/search', { query: 'alfa', sessionId: 's' }, 'unknown-field', null],
      ['/context', { query: 'alfa', budgetTokens: 1.5 }, 'invalid-field', 'budgetTokens'],
      ['/context', { query: 'alfa', maxTokens: 800 }, 'unknown-field', null],
    ];
    for (const [route, body, reason, field] of cases) {
      const r = await call(handler, route + P, 'POST', body);
      assert.equal(r.status, 400, route + ' ' + JSON.stringify(body).slice(0, 40));
      assert.equal(r.json.error.code, 'invalid-argument');
      assert.equal(r.json.error.details.reason, reason);
      if (field) assert.equal(r.json.error.details.field, field);
    }
    // El campo desconocido se informa por nombre, nunca por valor.
    const unknown = await call(handler, '/search' + P, 'POST', { query: 'alfa', sessionId: 'secreto-no-expuesto' });
    assert.deepEqual(unknown.json.error.details.fields, ['sessionId']);
    assert.equal(JSON.stringify(unknown.json).includes('secreto-no-expuesto'), false);
    // Parámetro de query no declarado en la ruta.
    const param = await call(handler, '/search' + P + '&q=alfa', 'POST', { query: 'alfa' });
    assert.equal(param.status, 400);
    assert.deepEqual(param.json.error.details.parameters, ['q']);
  } finally { world.cleanup(); }
});

test('PA: proyecto desconocido, ambiguo y límites aceptados', async () => {
  const world = await makeWorld();
  try {
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    const unknown = await call(handler, '/search?project=prj_noexiste', 'POST', { query: 'alfa' });
    assert.equal(unknown.status, 403);
    assert.equal(unknown.json.error.code, 'project-not-authorized');
    // Con dos proyectos en el perfil, sin `project` no se adivina.
    const ambiguous = await call(handler, '/search', 'POST', { query: 'alfa' });
    assert.equal(ambiguous.status, 403);
    assert.equal(ambiguous.json.error.code, 'scope-ambiguous');
    const one = await call(handler, '/search?project=' + world.projectA.id, 'POST', { query: 'alfa', limit: 1 });
    assert.equal(one.status, 200);
    assert.ok(one.json.data.results.length <= 1);
    const max = await call(handler, '/search?project=' + world.projectA.id, 'POST', { query: 'alfa', limit: 50 });
    assert.equal(max.status, 200);
  } finally { world.cleanup(); }
});

test('PA: las consultas de lectura no escriben auditoría', async () => {
  const world = await makeWorld();
  try {
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    const P = '?project=' + world.projectA.id;
    const before = await call(handler, '/snapshot' + P);
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await call(handler, '/search' + P, 'POST', { query: 'alfa' })).status, 200);
      assert.equal((await call(handler, '/context' + P, 'POST', { query: 'alfa', budgetTokens: 200 })).status, 200);
    }
    const after = await call(handler, '/snapshot' + P);
    assert.equal(after.json.data.audit.head, before.json.data.audit.head, 'record:false: seis consultas no añaden eventos');
  } finally { world.cleanup(); }
});

test('PA: paginación y límites del snapshot', async () => {
  const world = await makeWorld();
  try {
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    const P = '?project=' + world.projectA.id;
    const page = await call(handler, '/snapshot' + P + '&limit=1');
    assert.equal(page.status, 200);
    assert.ok(page.json.data.sources.rows.length <= 1);
    if (page.json.data.sources.total > 1) assert.ok(page.json.data.sources.nextCursor);
    assert.equal((await call(handler, '/snapshot' + P + '&limit=0')).status, 400);
    // Parámetros no declarados: rechazo, nunca silencio.
    assert.equal((await call(handler, '/snapshot' + P + '&nope=1')).status, 400);
    assert.equal((await call(handler, '/nope' + P)).status, 404);
    // F-1 (1.5.11): sin `project` y con dos activos, el retrato pide selección en vez de dar 403;
    // un `project` que no existe sigue siendo 403 (esa petición sí es un error del cliente).
    const sinProyecto = await call(handler, '/snapshot');
    assert.equal(sinProyecto.status, 200);
    assert.equal(sinProyecto.json.data.needsProjectSelection, true);
    assert.equal((await call(handler, '/snapshot?project=prj_noexiste')).status, 403);
  } finally { world.cleanup(); }
});

test('PA: límite de fuentes por página según §8 (máximo 200)', async () => {
  const world = await makeWorld();
  try {
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    const P = '?project=' + world.projectA.id;
    const limitOf = async (query) => {
      const r = await call(handler, '/snapshot' + P + query);
      return r;
    };
    // Válido
    const valid = await limitOf('&limit=1');
    assert.equal(valid.status, 200);
    assert.equal(valid.json.data.sources.rows.length <= 1, true);
    // Máximo contractual
    const max = await limitOf('&limit=200');
    assert.equal(max.status, 200);
    // Por encima del máximo: 400, no recorte silencioso
    const over = await limitOf('&limit=201');
    assert.equal(over.status, 400);
    assert.equal(over.json.error.details.reason, 'limit-too-large');
    assert.equal(over.json.error.details.max, 200);
    assert.equal(over.json.data, undefined);
    // Negativo
    assert.equal((await limitOf('&limit=-1')).status, 400);
    // No numérico
    const nan = await limitOf('&limit=abc');
    assert.equal(nan.status, 400);
    assert.equal(nan.json.error.details.reason, 'invalid-field');
    // Ausente: se usa el valor por defecto (50) sin error
    const absent = await limitOf('');
    assert.equal(absent.status, 200);
    assert.equal(absent.json.data.sources.rows.length <= 50, true);
  } finally { world.cleanup(); }
});

test('PA: el sobre de respuesta es {ok:true,data} o {ok:false,error}', async () => {
  const world = await makeWorld();
  try {
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    const P = '?project=' + world.projectA.id;
    // Éxito: ok true, payload en data, sin bloque error.
    for (const [route, method, body] of [
      ['/snapshot' + P, 'GET', undefined],
      ['/config', 'GET', undefined],
      ['/search' + P, 'POST', { query: 'alfa' }],
      ['/context' + P, 'POST', { query: 'alfa', budgetTokens: 200 }],
    ]) {
      const r = await call(handler, route, method, body);
      assert.equal(r.status, 200, route);
      assert.equal(r.json.ok, true, route + ' debe declarar ok:true');
      assert.equal(typeof r.json.data, 'object');
      assert.equal(r.json.error, undefined);
    }
    // Error: ok false, sin data, con el status del código (nunca 200).
    for (const [route, method, body] of [
      ['/search' + P, 'POST', { query: 'alfa', limit: 51 }],
      ['/search?project=prj_noexiste', 'POST', { query: 'alfa' }],
      ['/search' + P + '&q=x', 'POST', { query: 'alfa' }],
      ['/search' + P, 'GET', undefined],
    ]) {
      const r = await call(handler, route, method, body);
      assert.equal(r.json.ok, false, route);
      assert.equal(typeof r.json.error.code, 'string');
      assert.equal(typeof r.json.error.message, 'string');
      assert.equal(r.json.data, undefined);
      assert.notEqual(r.status, 200, 'un fallo nunca viaja con 200');
    }
    // /actions conserva su sobre de error y su status.
    const actions = await call(handler, '/actions', 'POST');
    assert.equal(actions.status, 403);
    assert.equal(actions.json.ok, false);
    assert.equal(actions.json.error.code, 'approval-required');
  } finally { world.cleanup(); }
});

test('PA: respuesta que supera el tope declara response-too-large con 500', async () => {
  const world = await makeWorld();
  try {
    // Tope reducido para provocar la sobrecarga sin fabricar un megabyte de datos.
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', maxBody: 200 });
    const P = '?project=' + world.projectA.id;
    const r = await call(handler, '/snapshot' + P);
    assert.equal(r.status, 500, 'nunca 200 con el error dentro');
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error.code, 'response-too-large');
    assert.equal(r.json.error.details.limit, 200);
    assert.equal(r.json.data, undefined);
    // El tope es de la instancia, no del proceso: otro handler con el tope por defecto sirve igual.
    const normal = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    const control = await call(normal, '/snapshot' + P);
    assert.equal(control.status, 200);
    assert.equal(control.json.ok, true);
  } finally { world.cleanup(); }
});

/* -------------------------------------------------------------------------------------------- */
/* P-UX22-01 · fence CSRF de TODAS las mutaciones humanas de la API PA                           */
/*                                                                                              */
/* Las siete rutas POST que mutan estado (una de selección + seis de administración) exigen la   */
/* cabecera del panel y `content-type: application/json`; sin ellas, 403 `forbidden` con          */
/* `details.reason === 'csrf'` y **sin** ejecutar la mutación (ni escritura ni auditoría).        */
/* `/search` y `/context` son lecturas y quedan fuera a propósito. El orden es compuerta del     */
/* host → CSRF → validación → operación, y la compuerta del host no se toca.                     */
/* -------------------------------------------------------------------------------------------- */

/** Cabeceras que el panel manda en toda mutación (`client.js` · `request` con `mutation`/`body`). */
const CSRF = { 'x-lifecode-rag': '1', 'content-type': 'application/json' };
const allowGate = async () => ({ ok: true, peer: { id: 'host', principal: { kind: 'host' } } });

function gatedHandler(world) {
  return createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize: allowGate });
}

/**
 * Estado lógico del registro. Cualquier mutación de estas rutas toca al menos una de las tres
 * tablas (proyectos, raíces, selección) y deja asiento en `audit_registry`; comparar el estado
 * entero antes/después demuestra que un rechazo no escribe nada.
 */
function registryState(world) {
  return world.withRegistry((db) => ({
    audit: db.prepare('select coalesce(max(seq), 0) n from audit_registry').get().n,
    projects: db.prepare('select id, name, status from projects order by id').all(),
    roots: db.prepare('select id, scope_id, path, state from roots order by id').all(),
    selection: db.prepare('select project_id, revision from pa_selection').get() ?? null,
  }));
}

/** Una pareja (ruta, cuerpo válido) por cada POST mutador que el fence debe cubrir. */
function mutationCases(world) {
  return [
    ['/selection', { projectId: world.projectB.id, expectedRevision: 0 }],
    ['/projects', { name: 'Proyecto CSRF' }],
    ['/projects/archive', { id: world.projectB.id }],
    ['/projects/restore', { id: world.projectB.id }],
    ['/roots', { projectId: world.projectA.id, path: join(world.base, 'raiz-csrf') }],
    ['/roots/remove', { projectId: world.projectA.id, path: world.dirA }],
    ['/projects/register', { path: world.dirA }],
  ];
}

test('P-UX22-01: los siete POST que mutan exigen CSRF y sin él no escriben ni auditan', async () => {
  const world = await makeWorld();
  try {
    const handler = gatedHandler(world);
    for (const [route, body] of mutationCases(world)) {
      const before = registryState(world);
      const response = await call(handler, route, 'POST', body);
      assert.equal(response.status, 403, route + ' sin cabecera: ' + JSON.stringify(response.json));
      assert.equal(response.json.ok, false, route);
      assert.equal(response.json.error.code, 'forbidden', route);
      assert.equal(response.json.error.details.reason, 'csrf', route);
      assert.deepEqual(response.json.error.details.missing, ['x-lifecode-rag', 'content-type'], route);
      assert.deepEqual(registryState(world), before, route + ' no debe ejecutar la mutación');
    }
  } finally { world.cleanup(); }
});

test('P-UX22-01: hacen falta las DOS cabeceras, con el valor exacto', async () => {
  const world = await makeWorld();
  try {
    const handler = gatedHandler(world);
    const before = registryState(world);
    const onlyHeader = await call(handler, '/projects', 'POST', { name: 'x' }, { 'x-lifecode-rag': '1' });
    assert.equal(onlyHeader.status, 403);
    assert.deepEqual(onlyHeader.json.error.details.missing, ['content-type']);
    const onlyType = await call(handler, '/projects', 'POST', { name: 'x' }, { 'content-type': 'application/json' });
    assert.equal(onlyType.status, 403);
    assert.deepEqual(onlyType.json.error.details.missing, ['x-lifecode-rag']);
    const wrongValue = await call(handler, '/projects', 'POST', { name: 'x' }, { 'x-lifecode-rag': 'true', 'content-type': 'application/json' });
    assert.equal(wrongValue.status, 403);
    assert.deepEqual(wrongValue.json.error.details.missing, ['x-lifecode-rag']);
    assert.deepEqual(registryState(world), before, 'ningún intento rechazado deja rastro');
  } finally { world.cleanup(); }
});

test('P-UX22-01: con la cabecera del panel las siete mutaciones conservan su comportamiento', async () => {
  const world = await makeWorld();
  try {
    const handler = gatedHandler(world);
    const auditBefore = registryState(world).audit;

    const selection = await call(handler, '/selection', 'POST', { projectId: world.projectA.id, expectedRevision: 0 }, CSRF);
    assert.equal(selection.status, 200, JSON.stringify(selection.json));
    assert.equal(selection.json.data.selection.projectId, world.projectA.id);

    const created = await call(handler, '/projects', 'POST', { name: 'Proyecto CSRF' }, CSRF);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.data.created, true);
    const newId = created.json.data.project.id;

    const archived = await call(handler, '/projects/archive', 'POST', { id: newId }, CSRF);
    assert.equal(archived.status, 200, JSON.stringify(archived.json));
    assert.equal(archived.json.data.project.status, 'archived');

    const restored = await call(handler, '/projects/restore', 'POST', { id: newId }, CSRF);
    assert.equal(restored.status, 200, JSON.stringify(restored.json));
    assert.equal(restored.json.data.project.status, 'active');

    const extra = join(world.base, 'raiz-csrf');
    mkdirSync(extra, { recursive: true });
    const root = await call(handler, '/roots', 'POST', { projectId: world.projectA.id, path: extra }, CSRF);
    assert.equal(root.status, 201, JSON.stringify(root.json));
    const rootId = root.json.data.root.id;

    const removed = await call(handler, '/roots/remove', 'POST', { rootId }, CSRF);
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    assert.equal(removed.json.data.removed.id, rootId);

    const candidate = join(world.base, 'candidato-csrf');
    mkdirSync(candidate, { recursive: true });
    writeFileSync(join(candidate, 'package.json'), JSON.stringify({ name: 'candidato-csrf' }), 'utf8');
    world.withRegistry((db) => addTrustedRoot(db, { path: world.base, readAuthorization: true }));
    const registered = await call(handler, '/projects/register', 'POST', { path: candidate, name: 'Registrado' }, CSRF);
    assert.equal(registered.status, 201, JSON.stringify(registered.json));
    assert.equal(registered.json.data.created, true);

    // `content-type` con parámetros (charset) también es JSON: el panel lo manda tal cual.
    const charset = await call(handler, '/projects', 'POST', { name: 'Proyecto charset' },
      { 'x-lifecode-rag': '1', 'content-type': 'application/json; charset=utf-8' });
    assert.equal(charset.status, 201, JSON.stringify(charset.json));

    assert.ok(registryState(world).audit > auditBefore, 'cada mutación aceptada deja su asiento');
  } finally { world.cleanup(); }
});

test('P-UX22-01: orden autenticación → CSRF → validación', async () => {
  const world = await makeWorld();
  try {
    // La compuerta del host sigue siendo la primera: sin credencial es 401, no 403 de CSRF.
    const denyGate = async () => ({ ok: false, status: 401, code: 'unauthenticated', message: 'sin credencial' });
    const denied = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize: denyGate });
    const anonymous = await call(denied, '/projects', 'POST', { name: 'x' });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.error.code, 'unauthenticated');

    // Autenticado y sin testigo: 403 CSRF, sin llegar a parsear el cuerpo (no es 400).
    const handler = gatedHandler(world);
    const noToken = await call(handler, '/projects', 'POST', '{no es json');
    assert.equal(noToken.status, 403);
    assert.equal(noToken.json.error.details.reason, 'csrf');
    // Con testigo, el mismo cuerpo inválido sí se valida: la puerta deja pasar y falla la validación.
    const withToken = await call(handler, '/projects', 'POST', '{no es json', CSRF);
    assert.equal(withToken.status, 400);
    assert.equal(withToken.json.error.details.reason, 'invalid-json');
  } finally { world.cleanup(); }
});

test('P-UX22-01: /search y /context son lecturas y siguen sirviendo SIN la cabecera', async () => {
  const world = await makeWorld();
  try {
    const handler = gatedHandler(world);
    const P = '?project=' + world.projectA.id;
    // /candidates es lectura administrativa: exige raíz confiable (D-05), no la cabecera CSRF.
    world.withRegistry((db) => addTrustedRoot(db, { path: world.base, readAuthorization: true }));
    const before = await call(handler, '/snapshot' + P);

    const search = await call(handler, '/search' + P, 'POST', { query: 'alfa' });
    assert.equal(search.status, 200, JSON.stringify(search.json));
    assert.ok(search.json.data.results.length >= 1);

    const context = await call(handler, '/context' + P, 'POST', { query: 'alfa', budgetTokens: 200 });
    assert.equal(context.status, 200, JSON.stringify(context.json));
    assert.ok(context.json.data.text.length > 0);

    // GET sigue igual: ni el snapshot ni las rutas de administración de lectura piden CSRF.
    assert.equal((await call(handler, '/snapshot' + P)).status, 200);
    assert.equal((await call(handler, '/candidates?path=' + encodeURIComponent(world.dirA))).status, 200);

    const after = await call(handler, '/snapshot' + P);
    assert.equal(after.json.data.audit.head, before.json.data.audit.head, 'las lecturas POST no auditan');
  } finally { world.cleanup(); }
});

/* ───────────────────── F-1 (1.5.11) · varios proyectos activos sin selección ───────────────── */

test('F-1: dos proyectos activos sin selección → 200 con needsProjectSelection, no 403 ni «sin conexión»', async () => {
  const world = await makeWorld();
  try {
    const handler = gatedHandler(world);
    const snap = await call(handler, '/snapshot');
    assert.equal(snap.status, 200, 'falta de decisión no es un fallo del servicio: ' + JSON.stringify(snap.json));
    const data = snap.json.data;
    assert.equal(data.needsProjectSelection, true);
    assert.equal(data.needsProjectSelectionReason, 'scope-ambiguous');
    assert.equal(data.project, null, 'no se elige ninguno en silencio');
    assert.equal(data.service, 'ok', 'la API está sana y el registro abrió');
    assert.deepEqual(data.candidates.map((row) => row.id).sort(), [world.projectA.id, world.projectB.id].sort());
    assert.deepEqual(data.sources.rows, [], 'sin proyecto no se leen documentos de ninguno');
    assert.deepEqual(data.scopes, []);
    // El registro sigue sin selección de perfil: el panel no ha elegido nada por su cuenta.
    const profileSelection = world.withRegistry((db) => db.prepare('select count(*) as n from pa_selection where selection_key not like ?').get('session:%'));
    assert.equal(profileSelection.n, 0, 'la ambigüedad no escribe selección');
  } finally { world.cleanup(); }
});

test('F-1: tras elegir proyecto, el retrato vuelve a la normalidad y sólo ve SU documento', async () => {
  const world = await makeWorld();
  try {
    const handler = gatedHandler(world);
    const before = await call(handler, '/snapshot');
    assert.equal(before.json.data.needsProjectSelection, true);

    const chosen = await call(handler, '/selection', 'POST', { projectId: world.projectA.id, expectedRevision: 0 }, CSRF);
    assert.equal(chosen.status, 200, JSON.stringify(chosen.json));

    const after = await call(handler, '/snapshot');
    assert.equal(after.status, 200);
    const data = after.json.data;
    assert.equal(data.needsProjectSelection, false);
    assert.equal(data.project.id, world.projectA.id);
    assert.equal(data.selection.projectId, world.projectA.id);
    assert.equal(data.selection.revision, 1);
    const uris = data.sources.rows.map((row) => row.uri);
    assert.equal(uris.length, 1, 'un único documento en A');
    assert.match(uris[0], /a\.md$/, 'y es el de A, no el de B');
  } finally { world.cleanup(); }
});

test('F-1: un solo proyecto activo se resuelve solo — nunca se pide selección', async () => {
  const world = await makeWorld();
  try {
    const handler = gatedHandler(world);
    const archived = await call(handler, '/projects/archive', 'POST', { id: world.projectB.id }, CSRF);
    assert.equal(archived.status, 200, JSON.stringify(archived.json));

    const snap = await call(handler, '/snapshot');
    assert.equal(snap.status, 200);
    assert.equal(snap.json.data.needsProjectSelection, false);
    assert.equal(snap.json.data.project.id, world.projectA.id);
    assert.equal(snap.json.data.candidates, undefined, 'sin ambigüedad no se publican candidatos');
  } finally { world.cleanup(); }
});

test('F-1: perfil sin proyectos activos → retrato vacío, y tampoco es «falta selección»', async () => {
  const world = await makeWorld();
  try {
    const handler = gatedHandler(world);
    for (const id of [world.projectA.id, world.projectB.id]) {
      const archived = await call(handler, '/projects/archive', 'POST', { id }, CSRF);
      assert.equal(archived.status, 200, JSON.stringify(archived.json));
    }
    const snap = await call(handler, '/snapshot');
    assert.equal(snap.status, 200, 'un perfil vacío se retrata, no se cae');
    assert.equal(snap.json.data.needsProjectSelection, false);
    assert.equal(snap.json.data.project, null);
    assert.deepEqual(snap.json.data.projects, []);
    assert.equal(snap.json.data.archived.length, 2, 'los archivados se publican para poder restaurarlos');
  } finally { world.cleanup(); }
});
