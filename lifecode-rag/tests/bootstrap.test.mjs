/**
 * `D-IMPL-12` · El registro del perfil se garantiza al cargar el plugin.
 *
 * El defecto que estas pruebas fijan: en un perfil recién instalado `registry.sqlite3` no existía y
 * **todos** los caminos abren con `create: false` (`lib/exec-context.mjs`, `lib/pa-api.mjs`,
 * `lib/sync-scheduler.mjs`), así que las siete herramientas y las cinco vistas del panel respondían
 * `registry-unavailable` (HTTP 503) para siempre. Sólo funcionaba en perfiles con registro heredado.
 *
 * Qué se demuestra aquí:
 *   - `ensureRegistry` crea el registro vacío en una raíz temporal, en v3, con `workspace_tracking`;
 *   - es **idempotente**: la segunda llamada no reescribe el fichero ni cambia la versión;
 *   - con un registro v3 que ya tiene datos, el contenido previo queda intacto;
 *   - y el síntoma desaparece de punta a punta: `GET /pa/tracking` pasa de `registry-unavailable` a
 *     200 con `items` vacíos después de `ensureRegistry`, sin que se cree ningún dato.
 *
 * Nada toca `~/.dsh`: cada prueba usa `mkdtemp`.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { ensureRegistry, closeRegistry, openRegistry, pathKeyFor } from '../lib/registry.mjs';
import { registryPath } from '../lib/profile.mjs';
import { REGISTRY_VERSION } from '../lib/registry-schema.mjs';
import { applyTracking } from '../lib/tracking-store.mjs';
import { createPaHandler, PA_PREFIX, PA_VERSION } from '../lib/pa-api.mjs';
import { apply } from '../index.js';

const T0 = 1_700_000_000_000;

/** Raíz temporal de perfil (no existe: es un perfil recién instalado) y su limpieza. */
function tempProfile(prefix = 'lcr-bootstrap-') {
  const base = mkdtempSync(join(tmpdir(), prefix));
  return {
    base,
    root: join(base, 'perfil'),
    cleanup() { rmSync(base, { recursive: true, force: true }); },
  };
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

/**
 * Dobles de la API PA, con la misma forma que los de `tests/pa-tracking.test.mjs`: la compuerta del
 * host concedida y un `req`/`res` mínimos. Así la prueba integra la ruta REAL del handler.
 */
const allow = async () => ({ ok: true, peer: { id: 'host', principal: { kind: 'host' } } });

function reqRes(url, method = 'GET') {
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(key, value) { this.headers[key] = value; },
    end(body) { this.body = body; },
  };
  const req = {
    url: PA_PREFIX + url,
    method,
    headers: {},
    async *[Symbol.asyncIterator]() {},
  };
  return { req, res };
}

async function call(handler, url, method = 'GET') {
  const { req, res } = reqRes(url, method);
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') };
}

function handlerFor(root) {
  return createPaHandler({
    profileRoot: root,
    profileKey: 'bootstrap-test',
    authorize: allow,
    services: {},
  });
}

test('ensureRegistry: raíz temporal vacía → registra creado, en v3 y con workspace_tracking', () => {
  const box = tempProfile();
  try {
    const path = registryPath(box.root);
    assert.equal(readdirSync(box.base).includes('perfil'), false, 'el perfil no existe todavía');

    const summary = ensureRegistry({ root: box.root, now: T0 });
    assert.equal(summary.path, path);
    assert.equal(summary.created, true, 'esta llamada es la que crea el registro');
    assert.equal(summary.version, REGISTRY_VERSION);
    assert.equal(REGISTRY_VERSION, 4);
    assert.ok(summary.tables.includes('workspace_tracking'), `faltan tablas: ${summary.tables.join(', ')}`);

    // Lo mismo, leído de vuelta del fichero: los dos marcadores y la tabla en disco.
    const opened = openRegistry({ root: box.root, create: false });
    try {
      assert.equal(Number(opened.db.prepare('PRAGMA user_version').get().user_version), 4);
      assert.equal(opened.db.prepare("SELECT value FROM meta WHERE key='registry_version'").get().value, '4');
      const tables = opened.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
      assert.ok(tables.includes('workspace_tracking'));
      // El contenedor nace vacío: ninguna tabla de contenido tiene filas (`D-IMPL-12`).
      for (const table of ['projects', 'libraries', 'roots', 'workspace_tracking', 'audit_registry']) {
        assert.equal(count(opened.db, table), 0, `${table} debería nacer vacía`);
      }
    } finally {
      closeRegistry(opened.db);
    }
  } finally {
    box.cleanup();
  }
});

test('ensureRegistry: segunda llamada no reescribe nada ni cambia la versión', () => {
  const box = tempProfile();
  try {
    const first = ensureRegistry({ root: box.root, now: T0 });
    const path = registryPath(box.root);
    const before = {
      hash: hashFile(path),
      bytes: readFileSync(path).length,
      files: readdirSync(box.root).sort(),
    };

    const second = ensureRegistry({ root: box.root, now: T0 + 60_000 });
    assert.equal(second.created, false, 'un registro ya existente no se crea otra vez');
    assert.equal(second.path, first.path);
    assert.equal(second.version, first.version);
    assert.deepEqual(second.tables, first.tables, 'no aparece ninguna tabla nueva');

    // Idempotencia medida, no supuesta: el fichero del registro es byte a byte el mismo y el
    // directorio del perfil no gana ficheros.
    assert.equal(hashFile(path), before.hash, 'el registro no se reescribe');
    assert.equal(readFileSync(path).length, before.bytes);
    assert.deepEqual(readdirSync(box.root).sort(), before.files);

    // Y una tercera, con otro `now`, tampoco: `now` sólo participa al crear.
    const third = ensureRegistry({ root: box.root, now: T0 + 120_000 });
    assert.equal(third.created, false);
    assert.equal(hashFile(path), before.hash);
  } finally {
    box.cleanup();
  }
});

test('ensureRegistry: registro v3 con datos → created:false y el contenido previo intacto', () => {
  const box = tempProfile();
  try {
    const dir = join(box.base, 'workspace-seguido');
    mkdirSync(dir, { recursive: true });
    const pathKey = pathKeyFor(dir);

    // Un registro v3 con una fila de seguimiento sembrada por el almacén (no por la ruta humana).
    const opened = openRegistry({ root: box.root, create: true, now: T0 });
    try {
      applyTracking(opened.db, {
        pathKey, path: dir, state: 'on', projectId: null, expectedRevision: 0, now: T0,
      });
    } finally {
      closeRegistry(opened.db);
    }
    const rowsBefore = (() => {
      const again = openRegistry({ root: box.root, create: false });
      try {
        return again.db.prepare('SELECT * FROM workspace_tracking ORDER BY path_key').all();
      } finally {
        closeRegistry(again.db);
      }
    })();
    assert.equal(rowsBefore.length, 1);

    const summary = ensureRegistry({ root: box.root, now: T0 + 60_000 });
    assert.equal(summary.created, false);
    assert.equal(summary.version, 4);

    const after = openRegistry({ root: box.root, create: false });
    try {
      assert.deepEqual(
        after.db.prepare('SELECT * FROM workspace_tracking ORDER BY path_key').all(),
        rowsBefore,
        'la fila sembrada sigue exactamente igual',
      );
      assert.equal(count(after.db, 'workspace_tracking'), 1, 'ni se duplica ni se borra');
      assert.equal(count(after.db, 'projects'), 0, 'el registro se garantiza, no se «arregla» con datos');
    } finally {
      closeRegistry(after.db);
    }
  } finally {
    box.cleanup();
  }
});

test('ensureRegistry propaga los errores reales en vez de tragárselos', () => {
  const box = tempProfile();
  try {
    // Raíz relativa: configuración inválida, no un «no había registro» silencioso.
    assert.throws(() => ensureRegistry({ root: 'perfil/relativo' }), (error) => error.code === 'invalid-config');

    // Un fichero que no es un registro de LifeCode RAG se rechaza (SQLite o `registry-corrupt`); lo
    // que importa es que el fallo sube y el fichero **no** se recrea encima.
    mkdirSync(box.root, { recursive: true });
    const path = registryPath(box.root);
    writeFileSync(path, 'esto no es sqlite', 'utf8');
    assert.throws(() => ensureRegistry({ root: box.root }), /not a database|registry-corrupt/);
    assert.equal(readFileSync(path, 'utf8'), 'esto no es sqlite', 'no se pisa un fichero ajeno');
  } finally {
    box.cleanup();
  }
});

test('ensureRegistry no toca un registro escrito por una versión más nueva', () => {
  const box = tempProfile();
  try {
    const opened = openRegistry({ root: box.root, create: true, now: T0 });
    try {
      opened.db.exec('PRAGMA user_version = 99');
    } finally {
      closeRegistry(opened.db);
    }
    assert.throws(
      () => ensureRegistry({ root: box.root }),
      (error) => error.code === 'store-version-unsupported',
      'un registro más nuevo no se «arregla» bajándolo de versión',
    );
    const after = new DatabaseSync(registryPath(box.root));
    try {
      assert.equal(Number(after.prepare('PRAGMA user_version').get().user_version), 99);
    } finally {
      after.close();
    }
  } finally {
    box.cleanup();
  }
});

/**
 * El adaptador: cargar el plugin en un perfil vacío deja el registro creado (es el arreglo del
 * defecto, en el sitio donde vive: `apply()`). Se usa un `ctx` mínimo, como en `adapter.test.mjs`, y
 * una raíz `mkdtemp`: el perfil real no se toca.
 */
test('apply(): cargar el plugin en un perfil vacío deja el registro en v3 y la API responde', async () => {
  const box = tempProfile();
  const previous = process.env.LIFECODE_RAG_ROOT;
  process.env.LIFECODE_RAG_ROOT = box.root;
  try {
    assert.equal(existsSync(registryPath(box.root)), false);
    const routes = [];
    const connection = {
      requestRejection: async () => null,
      admit: async () => ({ peer: { id: 'peer', principal: { kind: 'owner' } } }),
    };
    const ctx = {
      get: (service) => {
        if (service === 'webServer') {
          return { register: (route) => { routes.push(route); return () => {}; } };
        }
        if (service === 'connection') return connection;
        return undefined;
      },
      tools: { register: () => {} },
      effect: (factory) => { const dispose = factory(); return typeof dispose === 'function' ? dispose : () => {}; },
      on: () => {},
      logger: { warn: () => {}, debug: () => {} },
    };

    apply(ctx);

    assert.equal(existsSync(registryPath(box.root)), true, 'apply() tiene que dejar el registro creado');
    const opened = openRegistry({ root: box.root, create: false });
    try {
      assert.equal(Number(opened.db.prepare('PRAGMA user_version').get().user_version), 4);
      assert.equal(count(opened.db, 'projects'), 0, 'sin datos: sólo el contenedor');
    } finally {
      closeRegistry(opened.db);
    }

    // Y la ruta PA que antes respondía 503 ya sirve el perfil nuevo.
    const pa = routes.find((route) => route.path === PA_PREFIX);
    assert.ok(pa, 'la API PA sigue montándose');
    const response = await call(pa.handler, '/tracking');
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.deepEqual(response.json.data.items, []);
  } finally {
    if (previous === undefined) delete process.env.LIFECODE_RAG_ROOT;
    else process.env.LIFECODE_RAG_ROOT = previous;
    box.cleanup();
  }
});

/**
 * El síntoma, de punta a punta. Un perfil recién instalado no tiene registro: la ruta humana
 * `GET /pa/tracking` responde 503 `registry-unavailable` (lo que veía el panel en sus cinco vistas).
 * Después de `ensureRegistry` —lo que hace `apply()` al cargar el plugin— la misma petición responde
 * 200 con `items` vacíos. Y el registro sigue sin datos: garantizar el contenedor no crea proyectos,
 * ni raíces, ni filas de seguimiento.
 */
test('integración: GET /pa/tracking pasa de registry-unavailable a 200 tras ensureRegistry', async () => {
  const box = tempProfile();
  try {
    const handler = handlerFor(box.root);

    const antes = await call(handler, '/tracking');
    assert.equal(antes.status, 503, JSON.stringify(antes.json));
    assert.equal(antes.json.ok, false);
    assert.equal(antes.json.error.code, 'registry-unavailable', 'es el síntoma del perfil nuevo');
    assert.equal(readdirSync(box.base).includes('perfil'), false, 'la lectura no crea el registro');

    const summary = ensureRegistry({ root: box.root, now: T0 });
    assert.equal(summary.created, true);

    const despues = await call(handler, '/tracking');
    assert.equal(despues.status, 200, JSON.stringify(despues.json));
    assert.equal(despues.json.ok, true);
    const payload = despues.json.data;
    assert.deepEqual(payload.items, [], 'un perfil nuevo no tiene seguimiento');
    assert.equal(payload.counts.total, 0);
    assert.equal(payload.counts.on, 0);
    assert.equal(payload.version, 'pa/1.6.0');
    assert.equal(PA_VERSION, 'pa/1.6.0');

    // Garantizar el registro no sembró nada en el perfil.
    const opened = openRegistry({ root: box.root, create: false });
    try {
      for (const table of ['projects', 'libraries', 'roots', 'workspace_tracking', 'audit_registry']) {
        assert.equal(count(opened.db, table), 0, `${table} debe seguir vacía`);
      }
    } finally {
      closeRegistry(opened.db);
    }
  } finally {
    box.cleanup();
  }
});
