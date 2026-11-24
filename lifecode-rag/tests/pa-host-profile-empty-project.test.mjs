/**
 * Escenario del Host (laboratorio rc150): el Host **no publica `DSH_PROFILE`**; el perfil activo
 * sólo se deduce del argumento con el que arrancó (`.../profiles/desktop`) y su registro existe.
 *
 * Dentro de ese perfil hay un proyecto recién registrado (`project create` + `root add`, o
 * `POST /projects`) al que **todavía no se le ingirió nada**: existe en el registro y no tiene
 * almacén de ámbito. `/snapshot` —la ruta con la que arranca el panel— respondía 503
 * `store-not-initialized` («el proyecto no tiene almacén») y el panel entero quedaba «sin conexión».
 *
 * La regresión fija: el retrato del perfil se sirve igual (proyecto, cero fuentes, servicio
 * `degraded`) y las rutas que necesitan contenido siguen diciendo la verdad.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { tempRoot } from './helpers.mjs';
import { profileKey, profileRoot, registryPath } from '../lib/profile.mjs';
import { addRoot, closeRegistry, createProject, ensureRegistry, openRegistry } from '../lib/registry.mjs';
import { createPaHandler, PA_PREFIX } from '../lib/pa-api.mjs';

function call(handler, url, method = 'GET') {
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b; },
  };
  const req = {
    url: PA_PREFIX + url,
    method,
    headers: {},
    async *[Symbol.asyncIterator]() {},
  };
  return handler(req, res).then(() => ({ status: res.statusCode, json: JSON.parse(res.body || '{}') }));
}

/** Prepara un DSH_HOME de laboratorio con un perfil `desktop` y devuelve las piezas del Host. */
function hostWorld() {
  const box = tempRoot('lifecode-rag-host');
  const home = box.root;
  const profileDir = join(home, 'profiles', 'desktop');
  mkdirSync(profileDir, { recursive: true });
  // El Host no exporta DSH_PROFILE ni DSH_PROFILE_DIR: sólo lleva el perfil como argumento.
  const env = { DSH_HOME: home };
  const argv = [
    'C:/Program Files/DeepSeek Harness/DeepSeek Harness.exe',
    '--expose-internals',
    'C:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js',
    'C:/Program Files/DeepSeek Harness/resources/app.asar/dsh',
    profileDir,
  ];
  return { box, home, profileDir, env, argv };
}

test('Host sin DSH_PROFILE: el perfil se resuelve por argv y un proyecto sin almacén no tumba el panel', async (t) => {
  const { box, env, argv, profileDir } = hostWorld();
  t.after(() => box.cleanup());

  assert.equal(env.DSH_PROFILE, undefined, 'el escenario exige que el Host NO exponga DSH_PROFILE');
  assert.equal(profileKey(env, argv), 'desktop', 'el argumento .../profiles/desktop es la señal del perfil');
  const root = profileRoot(env, argv);
  assert.equal(root, join(box.root, 'lifecode-rag', 'profiles', 'desktop'));

  // El plugin garantiza el registro del perfil al cargar (index.js:148-155).
  ensureRegistry({ root });

  // Proyecto registrado por una persona, sin ingesta todavía: registro con proyecto y raíz,
  // ningún `scopes/<id>/rag.sqlite3`.
  const fixtures = join(box.root, 'fixtures');
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(join(fixtures, 'alpha.md'), '# alfa\n');
  const { db } = openRegistry({ root, create: false });
  const project = createProject(db, { name: 'LifeCode RAG - Synthetic Acceptance' });
  addRoot(db, { scopeKind: 'prj', scopeId: project.id, path: fixtures, addedBy: 'human' });
  closeRegistry(db);
  const storeFile = join(root, 'scopes', project.id, 'rag.sqlite3');
  assert.equal(existsSync(storeFile), false, 'el escenario exige un proyecto SIN almacén');

  const handler = createPaHandler({ profileRoot: root, profileKey: profileKey(env, argv), env });
  const snap = await call(handler, '/snapshot');

  assert.equal(snap.status, 200, 'el retrato del perfil no puede caerse por un proyecto vacío');
  assert.equal(snap.json.data.mode, 'api');
  assert.equal(snap.json.data.project.id, project.id);
  assert.equal(snap.json.data.scopes.length, 1);
  assert.deepEqual(snap.json.data.sources, { rows: [], total: 0, nextCursor: null });
  assert.deepEqual(snap.json.data.audit, { head: 0 });
  assert.equal(snap.json.data.service, 'degraded', 'el servicio se declara degradado, no «ok» ni «sin conexión»');
  assert.equal(snap.json.data.projects.length, 1);

  // La lectura no crea el almacén: sigue sin existir después del snapshot.
  assert.equal(existsSync(storeFile), false, 'la lectura no puede inventar el almacén del proyecto');

  // Las rutas que sí necesitan contenido siguen fallando con el motivo real.
  const history = await call(handler, '/history');
  assert.equal(history.status, 503);
  assert.equal(history.json.error.code, 'store-not-initialized');
  assert.equal(history.json.error.details.project, project.id);
});

test('sin registro en la ruta resuelta, el 503 dice la clave usada y el fichero buscado', async (t) => {
  const { box, env, argv, profileDir } = hostWorld();
  t.after(() => box.cleanup());

  const root = profileRoot(env, argv);
  assert.equal(existsSync(registryPath(root)), false);
  assert.equal(profileDir, join(box.root, 'profiles', 'desktop'), 'el perfil existe aunque no tenga datos del plugin');

  const handler = createPaHandler({ profileRoot: root, profileKey: profileKey(env, argv), env });
  const snap = await call(handler, '/snapshot');

  assert.equal(snap.status, 503);
  assert.equal(snap.json.error.code, 'registry-unavailable');
  assert.match(snap.json.error.message, /«desktop»/, 'el mensaje nombra la clave de perfil usada');
  assert.equal(snap.json.error.details.profileKey, 'desktop');
  assert.equal(snap.json.error.details.registry, registryPath(root), 'el mensaje dice qué fichero se buscó');
});
