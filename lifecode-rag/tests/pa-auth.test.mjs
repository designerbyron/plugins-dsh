/**
 * PA01 · Compuerta de autenticación de la API PA.
 *
 * Qué se demuestra (los ocho casos del encargo):
 *  1. sin credencial del host, toda petición se rechaza;
 *  2. con credencial admitida, las lecturas responden;
 *  3. la protección cubre TODAS las rutas, incluidas las inventadas;
 *  4. `/actions` sigue siendo 403 `approval-required` ya autenticado;
 *  5. sin servicio de autenticación se falla CERRADO (nunca se abre);
 *  6. las rutas del host que no son de la API PA no se tocan (la compuerta no se aplica ni se invoca);
 *  7. ninguna cabecera del renderer concede identidad;
 *  8. la respuesta no expone credenciales al JavaScript del cliente.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorld } from './pa3-helpers.mjs';
import { createPaHandler, PA_PREFIX } from '../lib/pa-api.mjs';

const COOKIE = 'dsh_session=valor-secreto-de-prueba';

function reqRes(url, { method = 'GET', body, headers = {} } = {}) {
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

async function call(handler, url, options) {
  const { req, res } = reqRes(url, options);
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body || '{}'), raw: res.body, headers: res.headers };
}

/** Compuerta de prueba con la misma forma que la del adaptador. */
function gate() {
  const seen = [];
  const authorize = async ({ headers }) => {
    seen.push(headers);
    const cookie = headers.cookie ?? '';
    if (cookie.includes(COOKIE)) return { ok: true, peer: { id: 'peer-1', principal: { kind: 'owner' } } };
    return { ok: false, status: 401, code: 'unauthenticated', message: 'sin credencial del host' };
  };
  return { authorize, seen };
}

const PROTECTED = [
  ['/', 'GET'],
  ['/snapshot', 'GET'],
  ['/config', 'GET'],
  ['/search', 'POST'],
  ['/context', 'POST'],
  ['/selection', 'POST'],
  ['/actions', 'POST'],
  ['/ruta-que-no-existe', 'GET'],
];

test('PA01: sin credencial del host toda petición se rechaza (y ninguna ruta se distingue)', async () => {
  const world = await makeWorld();
  try {
    const { authorize } = gate();
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize });
    for (const [url, method] of PROTECTED) {
      const response = await call(handler, url, {
        method, body: method === 'POST' ? { query: 'alfa' } : undefined,
        headers: { accept: 'application/json' },
      });
      assert.equal(response.status, 401, `${method} ${url} debe rechazarse sin credencial`);
      assert.equal(response.json.ok, false, 'el sobre de error es contractual');
      assert.equal(response.json.error.code, 'unauthenticated');
      assert.equal(response.json.data, undefined, 'un fallo nunca lleva datos');
    }
  } finally { world.cleanup(); }
});

test('PA01: con credencial admitida las lecturas responden y declaran el principal del host', async () => {
  const world = await makeWorld();
  try {
    const { authorize, seen } = gate();
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize });
    const headers = { cookie: COOKIE, accept: 'application/json' };
    // El mundo de prueba tiene dos proyectos: estas pruebas son de autenticación, así que el
    // proyecto viaja explícito (la selección persistida se prueba en selection-cas.test.mjs).
    const P = '?project=' + world.projectA.id;

    const snap = await call(handler, '/snapshot' + P, { headers });
    assert.equal(snap.status, 200);
    assert.equal(snap.json.ok, true);
    assert.equal(snap.json.data.mode, 'api');
    assert.deepEqual(snap.json.data.auth, { principal: 'owner' }, 'el principal es el del host, no inventado');

    const cfg = await call(handler, '/config', { headers });
    assert.equal(cfg.status, 200);

    const search = await call(handler, '/search' + P, { method: 'POST', body: { query: 'alfa', limit: 3 }, headers });
    assert.equal(search.status, 200);
    assert.ok(search.json.data.results.length >= 1);

    const ctx = await call(handler, '/context' + P, { method: 'POST', body: { query: 'alfa', budgetTokens: 200 }, headers });
    assert.equal(ctx.status, 200);

    assert.equal(seen.length, 4, 'la compuerta se consulta en cada petición, no una vez por proceso');
  } finally { world.cleanup(); }
});

test('PA01: /actions sigue siendo 403 approval-required aun autenticado', async () => {
  const world = await makeWorld();
  try {
    const { authorize } = gate();
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize });
    const actions = await call(handler, '/actions', { method: 'POST', headers: { cookie: COOKIE } });
    assert.equal(actions.status, 403);
    assert.equal(actions.json.error.code, 'approval-required');
  } finally { world.cleanup(); }
});

test('PA01: sin servicio de autenticación se falla cerrado, con dos formas distintas', async () => {
  const world = await makeWorld();
  try {
    // (a) La compuerta no puede decidir (servicio ausente o roto): 403, nunca 200.
    const closed = createPaHandler({
      profileRoot: world.root, profileKey: 'pa3-test',
      authorize: async () => ({ ok: false, status: 403, code: 'authorization-unavailable', message: 'el host no ofrece autenticación' }),
    });
    const denied = await call(closed, '/snapshot');
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error.code, 'authorization-unavailable');

    // (b) La compuerta lanza: 503 y tampoco se sirve nada.
    const broken = createPaHandler({
      profileRoot: world.root, profileKey: 'pa3-test',
      authorize: async () => { throw new Error('servicio caído'); },
    });
    const failed = await call(broken, '/snapshot');
    assert.equal(failed.status, 503);
    assert.equal(failed.json.error.code, 'authorization-unavailable');

    // (c) La compuerta devuelve algo que no es una decisión: se rechaza igual.
    const empty = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize: async () => undefined });
    const undefinedDecision = await call(empty, '/snapshot');
    assert.equal(undefinedDecision.status, 403);
    assert.equal(undefinedDecision.json.error.code, 'authorization-unavailable');
  } finally { world.cleanup(); }
});

test('PA01: las rutas del host fuera del prefijo no se tocan ni consultan la compuerta', async () => {
  const world = await makeWorld();
  try {
    const { authorize, seen } = gate();
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize });
    for (const url of ['/api/no-existe', '/index.html', '/']) {
      const { req, res } = reqRes('');
      req.url = url; // fuera del prefijo del plugin
      await handler(req, res);
      assert.equal(res.statusCode, 404);
    }
    assert.equal(seen.length, 0, 'la compuerta del plugin no se aplica a rutas que no son suyas');
  } finally { world.cleanup(); }
});

test('PA01: ninguna cabecera del renderer concede identidad ni salta la compuerta', async () => {
  const world = await makeWorld();
  try {
    const { authorize } = gate();
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize });
    const spoof = {
      'x-user': 'owner',
      'x-principal': 'owner',
      'x-auth-user': 'owner',
      'x-session-id': 'sesion-a',
      'x-forwarded-user': 'owner',
      authorization: 'Bearer owner',
      accept: 'application/json',
    };
    const response = await call(handler, '/snapshot', { headers: spoof });
    assert.equal(response.status, 401, 'sólo el host concede identidad');
    assert.equal(response.json.error.code, 'unauthenticated');
  } finally { world.cleanup(); }
});

test('PA01: la respuesta no expone credenciales al JavaScript del cliente', async () => {
  const world = await makeWorld();
  try {
    const { authorize } = gate();
    const handler = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize });
    const response = await call(handler, '/snapshot?project=' + world.projectA.id, { headers: { cookie: COOKIE } });
    assert.equal(response.status, 200);
    assert.equal(response.raw.includes('valor-secreto-de-prueba'), false, 'el cuerpo no repite la cookie');
    for (const forbidden of ['cookie', 'set-cookie', 'token', 'secret', 'password', 'credentials']) {
      assert.equal(response.raw.toLowerCase().includes(forbidden), false, `el cuerpo no debe contener «${forbidden}»`);
      assert.equal(Object.keys(response.headers).map((key) => key.toLowerCase()).includes(forbidden), false, `la respuesta no debe emitir la cabecera «${forbidden}»`);
    }
    assert.equal(response.headers['cache-control'], 'no-store');
  } finally { world.cleanup(); }
});
