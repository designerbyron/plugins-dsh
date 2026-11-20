/** LE-RAG-10 · API PA (solo lectura) sobre un mundo aislado. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorld } from './pa3-helpers.mjs';
import { createPaHandler, PA_PREFIX } from '../lib/pa-api.mjs';

function reqRes(url, method = 'GET', body) {
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b; },
  };
  const payload = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  const req = {
    url: PA_PREFIX + url,
    method,
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload, 'utf8');
    },
  };
  return { req, res };
}

async function call(handler, url, method = 'GET', body) {
  const { req, res } = reqRes(url, method, body);
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body || '{}'), headers: res.headers };
}

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
    assert.equal((await call(handler, '/snapshot')).status, 403);
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
