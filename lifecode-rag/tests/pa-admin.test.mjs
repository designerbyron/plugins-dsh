/**
 * ACP-07 F3 · administración de proyectos por la API PA.
 *
 * Cubre los nueve puntos del alcance: `/projects` (POST/PATCH), `/projects/archive`,
 * `/projects/restore`, `/roots`, `/roots/remove`, `/candidates` y `/projects/register`, más el
 * snapshot aditivo. Todo ocurre en un perfil temporal (`LIFECODE_RAG_ROOT`); nada toca `~/.dsh`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeWorld } from './pa3-helpers.mjs';
import { createPaHandler, PA_PREFIX, PA_VERSION } from '../lib/pa-api.mjs';
import { addTrustedRoot } from '../lib/trusted-roots.mjs';
import { closeRegistry, openRegistry } from '../lib/registry.mjs';

const allow = async () => ({ ok: true, peer: { id: 'host', principal: { kind: 'host' } } });
const deny = async () => ({ ok: false, status: 401, code: 'unauthenticated', message: 'sin credencial' });

/**
 * P-UX22-01: el panel manda el testigo CSRF y `content-type: application/json` en **toda**
 * mutación, así que el doble de petición de la administración los lleva por defecto. El caso
 * «sin cabecera → 403 y sin escribir» vive en `pa-api.test.mjs`, que es donde se prueba el fence;
 * esta suite prueba la administración, no la compuerta.
 */
const CSRF_HEADERS = Object.freeze({ 'x-lifecode-rag': '1', 'content-type': 'application/json' });

function handlerFor(world, authorize = allow) {
  return createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test', authorize });
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
    headers: { ...CSRF_HEADERS, ...headers },
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

function registryPath(world) {
  return join(world.root, 'registry.sqlite3');
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function auditRows(world) {
  const { db } = openRegistry({ root: world.root, create: false });
  try {
    return db.prepare('SELECT seq, action, target, outcome FROM audit_registry ORDER BY seq').all();
  } finally {
    closeRegistry(db);
  }
}

/** Directorio con marcador de proyecto para que el descubrimiento lo vea. */
function seedCandidate(base, name) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }), 'utf8');
  return dir;
}

test('F3 · la administración no existe sin la compuerta del host', async () => {
  const world = await makeWorld();
  try {
    const bare = createPaHandler({ profileRoot: world.root, profileKey: 'pa3-test' });
    for (const [route, method, body] of [
      ['/projects', 'POST', { name: 'x' }],
      ['/projects/archive', 'POST', { id: world.projectB.id }],
      ['/projects/restore', 'POST', { id: world.projectB.id }],
      ['/roots', 'POST', { projectId: world.projectA.id, path: world.dirA }],
      ['/roots/remove', 'POST', { rootId: 'rt_x' }],
      ['/candidates', 'GET', undefined],
      ['/projects/register', 'POST', { path: world.dirA }],
    ]) {
      const response = await call(bare, route, method, body);
      assert.equal(response.status, 503, `${route} sin compuerta`);
      assert.equal(response.json.error.code, 'authorization-unavailable');
    }

    const denied = handlerFor(world, deny);
    const unauthorized = await call(denied, '/projects', 'POST', { name: 'x' });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.json.error.code, 'unauthenticated');

    // Nada de eso escribió: el registro sigue con sus dos proyectos y su auditoría.
    const snap = await call(handlerFor(world), '/snapshot?project=' + world.projectA.id);
    assert.equal(snap.status, 200);
    assert.equal(snap.json.data.projects.length, 2);
    assert.equal(auditRows(world).filter((row) => row.action.startsWith('project.') || row.action.startsWith('root.')).length, 0);
  } finally { world.cleanup(); }
});

test('F3 · POST /projects crea con y sin raíz, y es idempotente por ruta', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);

    const empty = await call(handler, '/projects', 'POST', { name: 'Proyecto Vacío' });
    assert.equal(empty.status, 201);
    assert.equal(empty.json.data.created, true);
    assert.equal(empty.json.data.project.name, 'Proyecto Vacío');
    assert.deepEqual({ ...empty.json.data.project.roots }, { total: 0, authorized: 0 });
    assert.equal(empty.json.data.integrity.ok, true);

    const dirNuevo = seedCandidate(world.base, 'proyecto-nuevo');
    const withRoot = await call(handler, '/projects', 'POST', { name: 'Proyecto Nuevo', path: dirNuevo });
    assert.equal(withRoot.status, 201);
    assert.equal(withRoot.json.data.created, true);
    assert.deepEqual({ ...withRoot.json.data.project.roots }, { total: 1, authorized: 1 });

    // La misma ruta otra vez no crea un segundo proyecto: devuelve el que ya existe.
    const again = await call(handler, '/projects', 'POST', { name: 'Otro Nombre', path: dirNuevo });
    assert.equal(again.status, 200);
    assert.equal(again.json.data.created, false);
    assert.equal(again.json.data.project.id, withRoot.json.data.project.id);

    // Auditoría: dos altas y ninguna huérfana.
    const creates = auditRows(world).filter((row) => row.action === 'project.create' && row.outcome === 'ok');
    assert.equal(creates.length, 2);

    // Validación de campos.
    const missing = await call(handler, '/projects', 'POST', {});
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error.details.reason, 'missing-field');
    const unknown = await call(handler, '/projects', 'POST', { name: 'x', color: 'rojo' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.json.error.details.reason, 'unknown-field');
    const notText = await call(handler, '/projects', 'POST', { name: 42 });
    assert.equal(notText.status, 400);
    const tooLong = await call(handler, '/projects', 'POST', { name: 'x'.repeat(121) });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.json.error.details.reason, 'field-too-long');

    // Los métodos no declarados se rechazan con 405 y el Allow correcto.
    const getProjects = await call(handler, '/projects', 'GET');
    assert.equal(getProjects.status, 405);
    assert.match(getProjects.json.error.details.allow.join(','), /POST,?PATCH|PATCH,?POST/);
  } finally { world.cleanup(); }
});

test('F3 · PATCH /projects renombra y no admite otros campos ni ids desconocidos', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    const patched = await call(handler, '/projects', 'PATCH', { id: world.projectA.id, name: 'Proyecto A renombrado' });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.data.changed, true);
    assert.equal(patched.json.data.project.name, 'Proyecto A renombrado');
    assert.equal(patched.json.data.project.id, world.projectA.id);

    const same = await call(handler, '/projects', 'PATCH', { id: world.projectA.id, name: 'Proyecto A renombrado' });
    assert.equal(same.json.data.changed, false);

    const extra = await call(handler, '/projects', 'PATCH', { id: world.projectA.id, name: 'x', path: world.dirA });
    assert.equal(extra.status, 400);
    assert.equal(extra.json.error.details.reason, 'unknown-field');

    const ghost = await call(handler, '/projects', 'PATCH', { id: 'prj_inexistente', name: 'x' });
    assert.equal(ghost.status, 404);
    assert.equal(ghost.json.error.code, 'project-not-found');
  } finally { world.cleanup(); }
});

test('F3 · archivar mueve la selección y no toca el almacén del proyecto', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    // La persona selecciona A (CR-1) y después lo archiva.
    const selected = await call(handler, '/selection', 'POST', { projectId: world.projectA.id, expectedRevision: 0 });
    assert.equal(selected.status, 200);

    const storePath = join(world.root, 'scopes', world.projectA.id, 'rag.sqlite3');
    const before = digest(storePath);
    const snapshotBefore = await call(handler, '/snapshot?project=' + world.projectA.id);
    const sourcesBefore = snapshotBefore.json.data.sources.total;

    const archived = await call(handler, '/projects/archive', 'POST', { id: world.projectA.id });
    assert.equal(archived.status, 200);
    assert.equal(archived.json.data.changed, true);
    assert.equal(archived.json.data.project.status, 'archived');
    assert.equal(archived.json.data.selectionChange, 'moved');
    assert.equal(archived.json.data.selection.projectId, world.projectB.id);
    assert.equal(archived.json.data.integrity.ok, true);

    assert.equal(digest(storePath), before, 'archivar no puede modificar el almacén del ámbito');
    assert.equal(sourcesBefore >= 1, true);

    // El snapshot lo enseña en `archived` y sigue respondiendo sin él activo.
    const snapshot = await call(handler, '/snapshot');
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.json.data.project.id, world.projectB.id);
    assert.equal(snapshot.json.data.archived.length, 1);
    assert.equal(snapshot.json.data.archived[0].id, world.projectA.id);
    assert.equal(snapshot.json.data.archived[0].selectable, false);
    assert.equal(snapshot.json.data.version, PA_VERSION);
    assert.equal(snapshot.json.data.capabilities.projects.includes('archive'), true);

    // Pedirlo por id ya no lo resuelve como activo: 403 project-not-authorized. Sigue visible en
    // `archived`, que es desde donde se restaura.
    const rejected = await call(handler, '/snapshot?project=' + world.projectA.id);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.json.error.code, 'project-not-authorized');
  } finally { world.cleanup(); }
});

test('F3 · restaurar devuelve el proyecto activo con su identidad y sus raíces', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    await call(handler, '/projects/archive', 'POST', { id: world.projectB.id });
    const restored = await call(handler, '/projects/restore', 'POST', { id: world.projectB.id });
    assert.equal(restored.status, 200);
    assert.equal(restored.json.data.changed, true);
    assert.equal(restored.json.data.project.id, world.projectB.id);
    assert.equal(restored.json.data.project.status, 'active');
    assert.deepEqual({ ...restored.json.data.project.roots }, { total: 1, authorized: 1 });

    const again = await call(handler, '/projects/restore', 'POST', { id: world.projectB.id });
    assert.equal(again.json.data.changed, false);

    const snap = await call(handler, '/snapshot?project=' + world.projectB.id);
    assert.equal(snap.json.data.archived.length, 0);
    assert.equal(snap.json.data.projects.length, 2);
    assert.equal(snap.json.data.projects.every((row) => row.selectable === true), true);
  } finally { world.cleanup(); }
});

test('F3 · raíces: añadir, rechazar solapes y retirar sin borrar archivos', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    const extra = seedCandidate(world.base, 'raiz-extra');

    const added = await call(handler, '/roots', 'POST', { projectId: world.projectA.id, path: extra });
    assert.equal(added.status, 201);
    assert.equal(added.json.data.root.path, extra);
    assert.deepEqual({ ...added.json.data.project.roots }, { total: 2, authorized: 2 });
    assert.equal(added.json.data.integrity.ok, true);

    mkdirSync(join(world.dirA, 'sub'), { recursive: true });
    const overlap = await call(handler, '/roots', 'POST', { projectId: world.projectA.id, path: join(world.dirA, 'sub') });
    assert.equal(overlap.status, 409, 'una raíz anidada dentro de otra se rechaza');
    assert.equal(overlap.json.error.code, 'root-overlap');
    assert.equal(overlap.json.error.details.relation, 'left-descendant');

    const ghost = await call(handler, '/roots', 'POST', { projectId: 'prj_inexistente', path: extra });
    assert.equal(ghost.status, 404);

    // Quitar la raíz no elimina el directorio ni las fuentes ya indexadas.
    const rootId = added.json.data.root.id;
    const removed = await call(handler, '/roots/remove', 'POST', { rootId });
    assert.equal(removed.status, 200);
    assert.equal(removed.json.data.removed.id, rootId);
    assert.deepEqual({ ...removed.json.data.project.roots }, { total: 1, authorized: 1 });
    assert.equal(existsSync(extra), true, 'quitar una raíz no borra el directorio');

    // Por proyecto + ruta, y protegida la última raíz.
    await call(handler, '/roots', 'POST', { projectId: world.projectA.id, path: extra });
    const byPath = await call(handler, '/roots/remove', 'POST', { projectId: world.projectA.id, path: extra });
    assert.equal(byPath.status, 200);
    const last = await call(handler, '/roots/remove', 'POST', {
      projectId: world.projectA.id, rootId: byPath.json.data.removed.id,
    });
    assert.equal(last.status, 404, 'esa raíz ya no existe');

    const snapshot = await call(handler, '/snapshot?project=' + world.projectA.id);
    const rootA = snapshot.json.data.projects.find((row) => row.id === world.projectA.id);
    assert.equal(rootA.roots, 1);
  } finally { world.cleanup(); }
});

test('F3 · los candidatos se descubren sin escribir en el registro', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    seedCandidate(world.base, 'candidato-nuevo');
    const before = digest(registryPath(world));
    const auditBefore = auditRows(world).length;

    // Sin raíz confiable no se recorre el árbol: descubrir es leer.
    const untrusted = await call(handler, '/candidates?path=' + encodeURIComponent(world.base));
    assert.equal(untrusted.json.error.code, 'scope-unresolved');
    assert.match(untrusted.json.error.details.command, /trust add/);

    const { db } = openRegistry({ root: world.root, create: false });
    try { addTrustedRoot(db, { path: world.base, readAuthorization: true }); } finally { closeRegistry(db); }

    // El trust sí escribe; la foto se toma después de él.
    const afterTrust = digest(registryPath(world));
    const auditAtTrust = auditRows(world).length;

    const candidates = await call(handler, '/candidates?path=' + encodeURIComponent(world.base));
    assert.equal(candidates.status, 200);
    assert.equal(candidates.json.data.total >= 1, true, 've el candidato nuevo: ' + JSON.stringify(candidates.json.data));
    const nuevo = candidates.json.data.candidates.find((row) => row.path === join(world.base, 'candidato-nuevo'));
    assert.ok(nuevo, 'el candidato con package.json aparece');
    assert.equal(nuevo.registered, false);
    assert.equal(nuevo.action, 'register-project');
    const existing = candidates.json.data.candidates.find((row) => row.path === world.dirA);
    if (existing) assert.equal(existing.action, null, 'lo ya registrado no se propone registrar');

    // Nada se ha escrito: ni un byte del registro, ni una fila de auditoría.
    assert.equal(digest(registryPath(world)), afterTrust);
    assert.equal(auditRows(world).length, auditAtTrust);
    assert.equal(before === afterTrust, false, 'el trust previo sí cambió el registro (control)');

    // Sin `path` y con varias raíces autorizadas se exige elegir.
    const ambiguous = await call(handler, '/candidates');
    assert.equal(ambiguous.status, 400);
    assert.equal(ambiguous.json.error.details.reason, 'path-required');
  } finally { world.cleanup(); }
});

test('F3 · registrar un candidato es un acto explícito y es idempotente', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    const dir = seedCandidate(world.base, 'candidato-nuevo');
    const { db } = openRegistry({ root: world.root, create: false });
    try { addTrustedRoot(db, { path: world.base, readAuthorization: true }); } finally { closeRegistry(db); }

    const registered = await call(handler, '/projects/register', 'POST', { path: dir, name: 'Candidato Nuevo' });
    assert.equal(registered.status, 201);
    assert.equal(registered.json.data.created, true);
    assert.equal(registered.json.data.registeredRoot, true);
    assert.equal(registered.json.data.project.name, 'Candidato Nuevo');
    assert.deepEqual({ ...registered.json.data.project.roots }, { total: 1, authorized: 1 });

    const again = await call(handler, '/projects/register', 'POST', { path: dir });
    assert.equal(again.status, 200);
    assert.equal(again.json.data.created, false);
    assert.equal(again.json.data.project.id, registered.json.data.project.id);

    const candidates = await call(handler, '/candidates?path=' + encodeURIComponent(world.base));
    const row = candidates.json.data.candidates.find((candidate) => candidate.path === dir);
    assert.equal(row.registered, true);
    assert.equal(row.action, null);
  } finally { world.cleanup(); }
});

test('F3 · el snapshot con todos los proyectos archivados sigue sirviendo al panel', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    await call(handler, '/projects/archive', 'POST', { id: world.projectA.id });
    await call(handler, '/projects/archive', 'POST', { id: world.projectB.id });

    const snapshot = await call(handler, '/snapshot');
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.json.data.project, null);
    assert.equal(snapshot.json.data.projects.length, 0);
    assert.equal(snapshot.json.data.archived.length, 2);
    assert.deepEqual({ ...snapshot.json.data.sources }, { rows: [], total: 0, nextCursor: null });
    assert.equal(snapshot.json.data.capabilities.projects.includes('restore'), true);

    // Las rutas que exigen proyecto activo siguen rechazando.
    const search = await call(handler, '/search', 'POST', { query: 'alfa' });
    assert.equal(search.json.error.code, 'project-not-authorized');
  } finally { world.cleanup(); }
});

test('F3 · contrato de compatibilidad: pa/1.3.0 y las siete rutas de lectura intactas', async () => {
  const world = await makeWorld();
  try {
    const handler = handlerFor(world);
    const snapshot = await call(handler, '/snapshot?project=' + world.projectA.id);
    assert.equal(snapshot.status, 200);
    // UX-2.1: la versión del contrato sube a `pa/1.4.0` (aditivo). UX-2.2 la sube a `pa/1.5.0`,
    // también aditiva. Lo que esta prueba protege es la FORMA: ninguna clave de `pa/1.3.0`
    // desaparece y las rutas nuevas no cambian el snapshot.
    assert.equal(snapshot.json.data.version, 'pa/1.5.0');
    // Claves que ya consumía el panel y que no pueden desaparecer.
    for (const key of ['mode', 'service', 'asOf', 'version', 'project', 'selection', 'projects', 'auth', 'scopes', 'libraries', 'sources', 'audit', 'config']) {
      assert.ok(Object.prototype.hasOwnProperty.call(snapshot.json.data, key), 'falta ' + key);
    }
    // Y las nuevas son aditivas.
    for (const key of ['archived', 'capabilities']) {
      assert.ok(Object.prototype.hasOwnProperty.call(snapshot.json.data, key), 'falta ' + key);
    }
    assert.equal(typeof snapshot.json.data.projects[0].selectable, 'boolean');
    // F4: las raíces con su ruta, para que la interfaz pueda retirar una concreta sin adivinar.
    assert.equal(Array.isArray(snapshot.json.data.roots), true);
    assert.equal(snapshot.json.data.roots.length, 2);
    for (const root of snapshot.json.data.roots) {
      assert.equal(typeof root.id, 'string');
      assert.equal(typeof root.scopeId, 'string');
      assert.equal(root.state, 'authorized');
      assert.equal(root.path.includes('proyecto-'), true);
    }

    for (const [route, method, body] of [
      ['/config', 'GET', undefined],
      ['/history?project=' + world.projectA.id, 'GET', undefined],
      ['/search?project=' + world.projectA.id, 'POST', { query: 'alfa', limit: 1 }],
      ['/context?project=' + world.projectA.id, 'POST', { query: 'alfa', budgetTokens: 200 }],
      ['/selection', 'POST', { projectId: world.projectB.id, expectedRevision: 0 }],
    ]) {
      const response = await call(handler, route, method, body);
      assert.equal(response.status, 200, `${route} → ${JSON.stringify(response.json)}`);
      assert.equal(response.json.ok, true);
    }
    const actions = await call(handler, '/actions');
    assert.equal(actions.status, 403);
    assert.equal(actions.json.error.code, 'approval-required');
  } finally { world.cleanup(); }
});
