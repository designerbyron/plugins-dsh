/**
 * R16 — verificación INDEPENDIENTE del contrato (dominio + API).
 *
 * Cada prueba de este fichero puede fallar si el comportamiento se rompe: no comprueba que exista una
 * función, comprueba la DECISIÓN. Todo se ejecuta en cajas temporales; el almacén real del usuario no se
 * lee ni se escribe en ninguna prueba (ver la última prueba de auditoría de los ficheros de esta ronda).
 *
 * Los defectos D1-D4 que esta ronda encontró están cerrados en el árbol: cada uno tiene aquí su prueba
 * con la aserción del CONTRATO (no una caracterización del fallo), de modo que una regresión lo vuelve a
 * poner rojo. No se usan `{ todo }` porque el candado `tests/testquality-audit.test.mjs` cuenta cada
 * hallazgo alto nuevo de la suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { readFile as readFileAsync, readdir as readdirAsync, stat as statAsync, lstat as lstatAsync } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApiRequest, projectManifestPath } from '../lib/api.mjs';
import { lifecodeSkillCreate } from '../lib/tools.mjs';
import { apply } from '../index.js';
import { loadState, withState } from '../lib/state.mjs';
import { collectInventory } from '../lib/inventory.mjs';
import { canonicalSkillName, detectCollisions } from '../lib/collisions.mjs';
import { optionalSources, preflight, requiredSources } from '../lib/preflight.mjs';
import { buildProjectDetail, PROJECT_STATES } from '../lib/projects.mjs';
import { cwdKey, projectIdFor } from '../lib/format.mjs';
import { knowledgeFile, loadKnowledge, policyFor } from '../lib/knowledge.mjs';
import { candidate, grantAutonomy, tempProject, tempRoot } from './helpers.mjs';

const BASE = '/lifecode-skill-center/api';
const temporary = [];

function sandbox(label) {
  const dir = mkdtempSync(join(tmpdir(), `lsc-r16-${label}-`));
  temporary.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

/** Hash del árbol completo: prueba de que «no se escribió nada» significa nada, no «casi nada». */
function treeHash(dir) {
  if (!existsSync(dir)) return 'ausente';
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(dir);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(file.slice(dir.length).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return `${files.length}:${hash.digest('hex')}`;
}

function fileCount(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else count += 1;
    }
  };
  walk(dir);
  return count;
}

function child(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Servicio `skills` mínimo: el inventario exige `snapshot()`; sin él la respuesta honesta es 503. */
function skillsService(snapshot) {
  if (typeof snapshot !== 'function') return { registerProvider() {} };
  return { registerProvider() {}, snapshot };
}

async function call(root, method, path, options = {}) {
  const { body, registry, skills, snapshot, dshHome, agentsHome, ...rest } = options;
  return handleApiRequest({
    root,
    dshHome: dshHome ?? join(root, '..', 'dsh-fixture'),
    agentsHome: agentsHome ?? join(root, '..', 'agents-fixture'),
    method,
    pathname: `${BASE}${path}`,
    search: '',
    body: body ?? null,
    registry: registry ?? null,
    skills: skills ?? null,
    ...rest,
  });
}

function registryOf(rows) {
  return { list: () => rows, get: (id) => rows.find((row) => row.id === id) };
}

function workspace(id, path, status = 'ok', sessionIds = []) {
  return { id, path, title: id, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z', sessionIds, status: async () => status };
}

function post(root, action, extra = {}, options = {}) {
  return call(root, 'POST', '', { body: { action, ...extra }, ...options });
}

function projectsGet(root, registry, options = {}) {
  return call(root, 'GET', '/projects', { registry, ...options });
}

// ── Proyectos: descubrimiento, registro y ciclo de vida ─────────────────────────────────────────────

test('descubrir un workspace NO crea registro ni escribe: el almacén queda byte a byte igual', async () => {
  const root = sandbox('store');
  const dshHome = sandbox('dsh');
  const cwd = tempProject('descubierto', sandbox('work'));
  const response = await projectsGet(root, registryOf([workspace('ws-1', cwd)]), { dshHome });

  assert.equal(response.status, 200);
  assert.equal(response.body.projects.length, 0, 'descubrir no es registrar');
  assert.equal(response.body.discovered.length, 1);
  const discovered = response.body.discovered[0];
  assert.equal(discovered.state, 'discovered');
  assert.equal(discovered.availability, 'ok');
  assert.equal(discovered.projectId, projectIdFor(cwd));
  assert.equal(fileCount(root), 0, 'ninguna lectura escribe un solo fichero');
  assert.equal(existsSync(join(root, 'center.json')), false);
});

test('el registro explícito crea la relación administrativa en el centro y no toca el proyecto', async () => {
  const root = sandbox('store');
  const cwd = tempProject('registrado', sandbox('work'));
  writeFileSync(join(cwd, 'codigo.txt'), 'intacto');
  const before = treeHash(cwd);

  const response = await post(root, 'register-project', { cwd });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  const project = response.body.project;
  assert.match(project.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(project.manifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(existsSync(projectManifestPath(root, project.id)), true, 'el manifiesto vive en el centro');
  assert.equal(treeHash(cwd), before, 'registrar no escribe dentro del proyecto');

  const list = await projectsGet(root, registryOf([workspace('ws-1', cwd)]));
  assert.equal(list.body.projects.length, 1);
  assert.equal(list.body.projects[0].registration.present, true);
  assert.equal(list.body.projects[0].registration.uuid, project.uuid);
});

test('registrar dos veces el mismo proyecto no duplica ni pierde asignaciones', async () => {
  const root = sandbox('store');
  const cwd = tempProject('repetido', sandbox('work'));
  const first = await post(root, 'register-project', { cwd });
  const id = first.body.project.id;
  withState(root, (state) => {
    state.assignments = state.assignments ?? {};
    state.assignments[id] = {
      'skill-asignada': { version: '1.0.0', enabled: true, pinnedAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z', by: 'human' },
    };
    return { ok: true };
  });
  const second = await post(root, 'register-project', { cwd });
  assert.equal(second.status, 200);
  assert.equal(second.body.project.id, id, 'la identidad no cambia al repetir el alta');

  const state = loadState(root).state;
  assert.deepEqual(Object.keys(state.projects), [id], 'un proyecto, no dos');
  assert.equal(state.assignments[id]['skill-asignada'].enabled, true, 'la asignación sigue ahí');
  const list = await projectsGet(root, registryOf([workspace('ws-1', cwd)]));
  assert.deepEqual(list.body.projects[0].counts, { assigned: 1, active: 1, materialized: 0 });
});

test('la ruta equivalente (mayúsculas, \\ vs /, barra final) es el MISMO proyecto', async () => {
  const root = sandbox('store');
  const cwd = tempProject('equivalente', sandbox('work'));
  const variants = [
    cwd,
    cwd.replace(/\\/g, '/'),
    cwd.toUpperCase(),
    `${cwd.replace(/\\/g, '/').toUpperCase()}/`,
  ];
  const ids = [];
  for (const variant of variants) {
    const response = await post(root, 'register-project', { cwd: variant });
    assert.equal(response.status, 200, `«${variant}» debe registrarse`);
    ids.push(response.body.project.id);
  }
  assert.deepEqual(new Set(ids).size, 1, 'cuatro formas de la misma ruta, un projectId');
  assert.deepEqual(Object.keys(loadState(root).state.projects), [ids[0]]);
  // La clave de comparación es la misma que usa el registro.
  assert.equal(cwdKey(variants[0]), cwdKey(variants[3]));
  assert.equal(projectIdFor(variants[0]), projectIdFor(variants[2]));
});

test('un proyecto eliminado del disco se representa unavailable y no se recrea', async () => {
  const root = sandbox('store');
  const parent = sandbox('work');
  const cwd = tempProject('efimero', parent);
  const registered = await post(root, 'register-project', { cwd });
  assert.equal(registered.status, 200);
  rmSync(cwd, { recursive: true, force: true });

  const list = await projectsGet(root, registryOf([workspace('ws-1', cwd, 'missing-dir')]));
  assert.equal(list.status, 200);
  const summary = list.body.projects[0];
  assert.equal(summary.state, 'unavailable');
  assert.equal(summary.workspace.availability, 'missing-dir');
  assert.match(summary.reasons.join(' '), /no existe|accesible/i);
  assert.equal(existsSync(cwd), false, 'leer el estado no puede resucitar la carpeta');
});

test('el refresco conserva las asociaciones del proyecto', async () => {
  const root = sandbox('store');
  const cwd = tempProject('asociado', sandbox('work'));
  const registered = await post(root, 'register-project', { cwd });
  const id = registered.body.project.id;
  withState(root, (state) => {
    state.assignments = { [id]: { alfa: { version: '1.0.0', enabled: true }, beta: { version: '1.0.0', enabled: false } } };
    return { ok: true };
  });
  const first = await projectsGet(root, registryOf([workspace('ws-1', cwd)]));
  const second = await projectsGet(root, registryOf([workspace('ws-1', cwd)]));
  assert.deepEqual(first.body.projects[0].counts, second.body.projects[0].counts);
  assert.deepEqual(second.body.projects[0].counts, { assigned: 2, active: 1, materialized: 0 });
  assert.equal(second.body.projects[0].state, first.body.projects[0].state);
});

// ── Fallos parciales y servicios ausentes ───────────────────────────────────────────────────────────

test('un snapshot que lanza deja complete:false y JAMÁS un éxito falso al materializar', async () => {
  const root = sandbox('store');
  const cwd = tempProject('snapshot-roto', sandbox('work'));
  const registered = await post(root, 'register-project', { cwd });
  const id = registered.body.project.id;
  const skills = skillsService(async () => {
    throw Object.assign(new Error('el catálogo se cayó'), { code: 'snapshot-crash' });
  });

  const inventory = await call(root, 'GET', '/inventory', { skills });
  assert.equal(inventory.body.complete, false);
  const skillsRow = inventory.body.sources.find((row) => row.id === 'skills-registry');
  assert.notEqual(skillsRow.status, 'complete', 'una fuente caída no puede declararse completa');

  const materialize = await post(root, 'materialize-project', { projectId: id }, { skills });
  assert.notEqual(materialize.status, 200, 'con evidencia incompleta no hay 200');
  assert.equal(materialize.body.ok, false);
  assert.ok(['preflight-blocked', 'evidence-incomplete', 'skills-registry-unavailable'].includes(materialize.body.code), materialize.body.code);
  assert.equal(existsSync(join(root, 'materialized', id)), false, 'bloqueado significa que no se escribió la vista');
});

test('GET /api/projects sin registro de workspaces responde 503 honesto', async () => {
  const root = sandbox('store');
  const response = await call(root, 'GET', '/projects', {});
  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'workspace-registry-unavailable');
});

test('un registro de workspaces roto (list no es función) también es 503, no una lista vacía', async () => {
  const root = sandbox('store');
  const response = await call(root, 'GET', '/projects', { registry: { list: 'no' } });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'workspace-registry-unavailable');
});

// ── Ficha por API: inspect-project (contrato §6.3) ─────────────────────────────────────────────────

test('inspect-project sirve la ficha con el mismo state que la lista y 404 si no existe', async () => {
  const root = sandbox('store');
  const cwd = tempProject('ficha', sandbox('work'));
  const registered = await post(root, 'register-project', { cwd });
  const id = registered.body.project.id;
  const registry = registryOf([workspace('ws-1', cwd)]);
  const list = await projectsGet(root, registry);

  const before = treeHash(root);
  const detail = await post(root, 'inspect-project', { projectId: id }, { registry });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.ok, true);
  assert.equal(detail.body.action, 'inspect-project', 'la respuesta declara la acción servida');
  assert.equal(detail.body.projectId, id);
  assert.equal(detail.body.project.projectId, id);
  assert.equal(detail.body.project.state, list.body.projects[0].state, 'lista y ficha coinciden en state');
  assert.equal(detail.body.project.registration.present, true, 'la ficha trae el registro administrativo');
  assert.equal(detail.body.project.registration.uuid, registered.body.project.uuid, 'la identidad del registro se ve en la ficha');
  assert.ok(Array.isArray(detail.body.project.skills), 'la ficha trae las skills asignadas al proyecto');
  assert.ok(Array.isArray(detail.body.project.assignments), 'la ficha trae las asignaciones');
  assert.equal(detail.body.project.sessions?.count, null, 'sin sesiones contadas: null, nunca 0');
  assert.equal(treeHash(root), before, 'inspeccionar es de sólo lectura: no escribe el almacén');

  const missing = await post(root, 'inspect-project', { projectId: 'no-existe-0000' }, { registry });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.ok, false);
  assert.equal(missing.body.code, 'project-not-found');
});

test('register-project rechaza un cwd relativo o fuera de la raíz con 400 invalid-cwd y no escribe', async () => {
  const root = sandbox('store');
  const work = sandbox('work');
  const before = fileCount(root);
  for (const candidatePath of ['../..', '..', 'relativa/dentro', './dentro']) {
    const response = await post(root, 'register-project', { cwd: candidatePath });
    assert.equal(response.status, 400, `«${candidatePath}» no es una ruta absoluta registrable`);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.code, 'invalid-cwd', `«${candidatePath}» debe rechazarse como invalid-cwd`);
    assert.equal(fileCount(root), before, `«${candidatePath}» no puede escribir ni un fichero`);
  }
  const validPath = tempProject('absoluta-valida', work);
  writeFileSync(join(validPath, 'intacto.txt'), 'no se toca');
  const projectBefore = treeHash(validPath);
  const valid = await post(root, 'register-project', { cwd: validPath });
  assert.equal(valid.status, 200, 'una ruta absoluta y normalizada sigue aceptándose');
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.project.id, projectIdFor(validPath));
  assert.equal(treeHash(validPath), projectBefore, 'la ruta válida se registra sin tocar el proyecto');
});

// ── Propiedad e inventario ─────────────────────────────────────────────────────────────────────────

const adapters = {
  readdir: (dir) => readdirAsync(dir, { withFileTypes: true }),
  readFile: (path) => readFileAsync(path),
  stat: (path) => statAsync(path),
  lstat: (path) => lstatAsync(path),
};

function writeSkill(dir, name, frontmatter = true, body = '## Procedimiento\n\nHaz algo verificable.\n') {
  const folder = join(dir, name);
  mkdirSync(folder, { recursive: true });
  const text = frontmatter
    ? `---\nname: ${name}\ndescription: skill de prueba ${name}\n---\n\n${body}`
    : body;
  writeFileSync(join(folder, 'SKILL.md'), text);
  return folder;
}

test('inventario: raíz propia, local de proyecto, legacy del compilador y materializada, con procedencia', async () => {
  const root = sandbox('store');
  const dshHome = sandbox('dsh');
  const agentsHome = sandbox('agents');
  const projectRoot = sandbox('work');
  writeSkill(join(dshHome, 'skills'), 'propia-del-usuario');
  writeSkill(join(projectRoot, '.dsh', 'skills'), 'local-del-proyecto');
  writeSkill(join(dshHome, 'skill-compiler', 'projects', 'p1', 'approved'), 'legacy-aprobada');
  writeSkill(join(dshHome, 'skill-compiler', 'projects', 'p1', 'superseded'), 'legacy-historica');
  writeSkill(join(dshHome, 'skill-compiler', 'global'), 'legacy-global');
  writeSkill(join(root, 'materialized', 'p1'), 'materializada');
  writeSkill(join(dshHome, 'skills'), 'sin-frontmatter', false, 'sólo cuerpo, sin metadatos de origen');

  const inventory = await collectInventory(adapters, {
    cwd: projectRoot,
    projectRoot,
    dshHome,
    agentsHome,
    root,
    snapshot: { skills: [], complete: true },
    now: '2026-11-09T00:00:00.000Z',
  });
  assert.ok(Array.isArray(inventory.entries));
  const byName = new Map(inventory.entries.filter((entry) => entry.name !== null).map((entry) => [entry.name, entry]));
  for (const name of ['propia-del-usuario', 'local-del-proyecto', 'legacy-aprobada', 'legacy-global', 'materializada']) {
    assert.ok(byName.has(name), `falta la entrada ${name}: ${[...byName.keys()].join(', ')}`);
  }
  assert.equal(byName.has('legacy-historica'), false, 'superseded/ es historia, no entrada (E1)');

  const provenance = byName.get('legacy-aprobada');
  assert.equal(provenance.origin.kind, 'skill-compiler');
  assert.equal(provenance.association.loadedByHost, false, 'el Host no carga esa raíz');
  assert.equal(byName.get('materializada').owner.kind, 'lifecode');

  const anonymous = inventory.entries.find((entry) => entry.location.directory.endsWith('sin-frontmatter'));
  assert.ok(anonymous, 'la skill sin frontmatter sí está en el inventario');
  assert.match(anonymous.identity.contentSha256, /^[0-9a-f]{64}$/, 'sin frontmatter el origen es el contenido');
  assert.ok(['content-hash', 'name-only'].includes(anonymous.confidence), anonymous.confidence);

  const row = (id) => inventory.sources.find((source) => source.id === id);
  assert.equal(row('hermes-legacy').status, 'unavailable', 'fuera de DSH_HOME es declarada, no vacía');
  assert.equal(row('builtin-asar').status, 'unavailable');
  assert.equal(row('skills-registry').status, 'complete');
});

test('inventario sin snapshot: 503 skills-registry-unavailable, nunca un inventario vacío', async () => {
  const root = sandbox('store');
  const response = await call(root, 'GET', '/inventory', {});
  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'skills-registry-unavailable');
  assert.equal(response.body.entries, undefined, 'un 503 no finge una lista vacía');
});

test('sessions.count es null (no contado), nunca 0, cuando la fuente no existe', () => {
  const root = sandbox('store');
  const cwd = tempProject('sesiones', sandbox('work'));
  const state = {
    projects: { p1: { id: 'p1', name: 'p1', cwd, manifestSha256: 'x' } },
    assignments: { p1: { alfa: { version: '1.0.0', enabled: true } } },
  };
  const detail = buildProjectDetail({
    projectId: 'p1',
    workspaces: [workspace('ws-1', cwd)],
    state,
    sources: [],
    now: '2026-11-09T00:00:00.000Z',
  });
  assert.ok(detail, 'la ficha existe');
  assert.deepEqual(detail.sessions, { count: null, archived: 0, source: 'none' });
  assert.ok(PROJECT_STATES.includes(detail.state));
  assert.ok(Array.isArray(detail.assignments));
  assert.ok(Array.isArray(detail.collisions));
});

// ── Colisiones (§3) ────────────────────────────────────────────────────────────────────────────────

function entry(overrides = {}) {
  return {
    key: `clave-${Math.random().toString(36).slice(2, 10)}`,
    name: 'demo-skill',
    canonicalName: 'demo-skill',
    owner: { kind: 'filesystem', provider: 'disco' },
    origin: { kind: 'skill' },
    location: { kind: 'file', path: 'C:/uno/demo-skill/SKILL.md', directory: 'C:/uno/demo-skill', rootId: 'user-dsh' },
    scope: { kind: 'user' },
    association: { loadedByHost: false },
    identity: { uuid: null, contentSha256: null },
    ...overrides,
  };
}

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const UUID = '11111111-1111-4111-8111-111111111111';

test('mismo nombre canónico con contenido distinto ⇒ name-collision', () => {
  const result = detectCollisions({
    entries: [
      entry({ key: 'l1', name: 'demo-skill', identity: { uuid: null, contentSha256: SHA_A } }),
      entry({
        key: 'l2',
        name: 'demo-skill',
        location: { kind: 'file', path: 'C:/dos/demo-skill/SKILL.md', directory: 'C:/dos/demo-skill', rootId: 'user-dsh' },
        identity: { uuid: null, contentSha256: SHA_B },
      }),
    ],
  });
  const collision = result.collisions.find((item) => item.code === 'name-collision');
  assert.ok(collision, 'debe haber name-collision');
  assert.equal(collision.severity, 'warn', 'disco contra disco no es ambiguo para el Host');
  assert.ok(result.ambiguousNames.includes('demo-skill'));
});

test('dos versiones propias compitiendo ⇒ name-collision con severidad block', () => {
  const lifecode = (key, directory) => entry({
    key,
    owner: { kind: 'lifecode', provider: 'lifecode-skill-center' },
    location: { kind: 'directory', path: join(directory, 'demo-skill'), directory: join(directory, 'demo-skill'), rootId: 'materialized' },
    association: { loadedByHost: true },
  });
  const result = detectCollisions({ entries: [lifecode('m1', 'C:/centro/p1'), lifecode('m2', 'C:/centro/p2')] });
  const collision = result.collisions.find((item) => item.code === 'name-collision');
  assert.ok(collision);
  assert.equal(collision.severity, 'block');
});

test('mismo UUID con contenido distinto ⇒ identity-duplicate block', () => {
  const result = detectCollisions({
    entries: [
      entry({ key: 'u1', name: 'uno', canonicalName: null, identity: { uuid: UUID, contentSha256: SHA_A } }),
      entry({
        key: 'u2',
        name: 'dos',
        canonicalName: null,
        location: { kind: 'file', path: 'C:/dos/dos/SKILL.md', directory: 'C:/dos/dos', rootId: 'user-dsh' },
        identity: { uuid: UUID, contentSha256: SHA_B },
      }),
    ],
  });
  const collision = result.collisions.find((item) => item.code === 'identity-duplicate');
  assert.ok(collision);
  assert.equal(collision.severity, 'block');
});

test('mismo uuid con el MISMO nombre: contenidos distintos ⇒ identity-duplicate block; mismo hash ⇒ no', () => {
  const twin = (hash) => entry({
    key: `gemela-${hash.slice(0, 4)}`,
    name: 'demo-skill',
    canonicalName: 'demo-skill',
    identity: { uuid: UUID, contentSha256: hash },
  });
  const different = detectCollisions({
    entries: [
      twin(SHA_A),
      entry({
        key: 'gemela-b',
        name: 'demo-skill',
        canonicalName: 'demo-skill',
        location: { kind: 'file', path: 'C:/dos/demo-skill/SKILL.md', directory: 'C:/dos/demo-skill', rootId: 'user-dsh' },
        identity: { uuid: UUID, contentSha256: SHA_B },
      }),
    ],
  });
  const duplicate = different.collisions.find((item) => item.code === 'identity-duplicate');
  assert.ok(duplicate, 'el mismo uuid con dos contenidos es duplicado aunque el nombre coincida');
  assert.equal(duplicate.severity, 'block');
  assert.equal(duplicate.key, UUID, 'la clave de la colisión es la identidad compartida');

  const identical = detectCollisions({
    entries: [
      twin(SHA_A),
      entry({
        key: 'gemela-a2',
        name: 'demo-skill',
        canonicalName: 'demo-skill',
        location: { kind: 'file', path: 'C:/dos/demo-skill/SKILL.md', directory: 'C:/dos/demo-skill', rootId: 'user-dsh' },
        identity: { uuid: UUID, contentSha256: SHA_A },
      }),
    ],
  });
  assert.equal(
    identical.collisions.some((item) => item.code === 'identity-duplicate'),
    false,
    'la misma identidad con el mismo contenido no es un duplicado',
  );
});

test('misma ruta canónica con dos dueños ⇒ path-collision block', () => {
  const result = detectCollisions({ entries: [entry({ key: 'a' }), entry({ key: 'b', name: 'otra-skill', canonicalName: 'otra-skill' })] });
  const collision = result.collisions.find((item) => item.code === 'path-collision');
  assert.ok(collision);
  assert.equal(collision.severity, 'block');
});

test('contenido idéntico con nombres distintos ⇒ content-collision warn', () => {
  const result = detectCollisions({
    entries: [
      entry({ key: 'c1', name: 'uno', canonicalName: null, identity: { uuid: null, contentSha256: SHA_A } }),
      entry({ key: 'c2', name: 'dos', canonicalName: null, location: { kind: 'file', path: 'C:/dos/dos/SKILL.md', directory: 'C:/dos/dos', rootId: 'user-dsh' }, identity: { uuid: null, contentSha256: SHA_A } }),
    ],
  });
  const collision = result.collisions.find((item) => item.code === 'content-collision');
  assert.ok(collision);
  assert.equal(collision.severity, 'warn');
});

test('una asignación sombreada se avisa al leer y BLOQUEA materializar', () => {
  const shadowed = [
    entry({
      key: 'lifecode:p1:demo-skill',
      owner: { kind: 'lifecode', provider: 'lifecode-skill-center' },
      origin: { kind: 'materialized' },
      location: { kind: 'directory', path: 'C:/centro/materialized/p1/demo-skill', directory: 'C:/centro/materialized/p1/demo-skill', rootId: 'materialized' },
      scope: { kind: 'project', projectId: 'p1', cwd: 'C:/proyecto' },
      association: { loadedByHost: false },
    }),
    entry({ key: 'host-disco', association: { loadedByHost: true, provider: 'disco', path: 'C:/usuario/demo-skill/SKILL.md' } }),
  ];
  const projects = [{ id: 'p1', cwd: 'C:/proyecto' }];
  const assignments = { p1: { 'demo-skill': { enabled: true } } };
  const found = detectCollisions({ entries: shadowed, projects, assignments });
  const collision = found.collisions.find((item) => item.code === 'assignment-shadowed');
  assert.ok(collision);
  assert.equal(collision.severity, 'warn');
  assert.equal(collision.key, 'p1:demo-skill');

  const base = {
    action: 'materialize-project',
    projectId: 'p1',
    skillId: 'demo-skill',
    state: { projects: { p1: { id: 'p1', cwd: 'C:/proyecto', manifestSha256: 'abc' } } },
    sources: ['state', 'manifest', 'skills-registry', 'filesystem-view'].map((id) => ({ id, status: 'complete', reason: '' })),
    projectAvailability: 'ok',
  };
  assert.equal(preflight({ ...base, collisions: [] }).decision, 'allow');
  const blocked = preflight({ ...base, collisions: found.collisions });
  assert.equal(blocked.decision, 'block');
  assert.ok(blocked.findings.some((item) => item.code === 'assignment-shadowed' && item.severity === 'block'));
});

test('preflight exige las fuentes declaradas por acción (§4) y bloquea si falta una requerida', () => {
  assert.deepEqual(requiredSources('materialize-project').sort(), ['filesystem-view', 'manifest', 'skills-registry', 'state']);
  assert.deepEqual(requiredSources('register-project').sort(), ['filesystem-project', 'state']);
  assert.deepEqual(optionalSources('register-project').sort(), ['manifest', 'workspace-registry']);
  const blocked = preflight({
    action: 'register-project',
    state: {},
    sources: [{ id: 'state', status: 'complete' }],
  });
  assert.equal(blocked.decision, 'block', 'sin filesystem-project no se autoriza');
  assert.ok(blocked.findings.some((item) => item.code === 'evidence-incomplete' && item.severity === 'block'));
  assert.match(blocked.reasons[0], /No se escribió nada/);
  assert.equal(blocked.evidence.preflightVersion, 1);
  assert.match(blocked.evidence.inventoryHash, /^[0-9a-f]{64}$/);

  // Faltar una fuente OPCIONAL no bloquea: se degrada a warn declarándolo.
  const warned = preflight({
    action: 'register-project',
    state: {},
    sources: [{ id: 'state', status: 'complete' }, { id: 'filesystem-project', status: 'complete' }],
  });
  assert.equal(warned.decision, 'warn');
  assert.ok(warned.findings.some((item) => item.code === 'catalog-unverified' && item.severity === 'warn'));

  const clean = preflight({
    action: 'register-project',
    state: {},
    sources: ['state', 'filesystem-project', 'manifest', 'workspace-registry'].map((id) => ({ id, status: 'complete' })),
  });
  assert.equal(clean.decision, 'allow');
});

// ── Unicode, mayúsculas y symlinks ─────────────────────────────────────────────────────────────────

test('mayúsculas y NFC/NFD no generan colisiones falsas; la ruta equivalente sí se unifica', () => {
  for (const raw of ['Demo-Skill', 'demo-skill\u0301', 'cafe\u0301']) {
    assert.equal(canonicalSkillName(raw), null, `«${raw}» no es un nombre canónico del Host`);
  }
  assert.equal(canonicalSkillName('demo-skill'), 'demo-skill');
  assert.equal(canonicalSkillName('  demo-skill  '), 'demo-skill');
  const result = detectCollisions({
    entries: [
      entry({ key: 'n1', name: 'Demo-Skill', canonicalName: null }),
      entry({ key: 'n2', name: 'demo-skillé', canonicalName: null, location: { kind: 'file', path: 'C:/otro/SKILL.md', directory: 'C:/otro', rootId: 'user-dsh' } }),
    ],
  });
  assert.equal(result.collisions.some((item) => item.code === 'name-collision'), false, 'la normalización Unicode no puede inventar un choque');
  assert.equal(cwdKey('C:\\Repo\\'), cwdKey('c:/repo'));
});

test('un symlink/junction en una raíz de skills no se atraviesa', async (t) => {
  const root = sandbox('store');
  const dshHome = sandbox('dsh');
  const outside = sandbox('fuera');
  writeSkill(outside, 'intrusa-desde-fuera');
  mkdirSync(join(dshHome, 'skills'), { recursive: true });
  try {
    symlinkSync(outside, join(dshHome, 'skills', 'enlace'), 'junction');
  } catch (error) {
    t.skip(`no se pudo crear el junction en esta máquina: ${error?.code ?? error}`);
    return;
  }
  const inventory = await collectInventory(adapters, { dshHome, root, snapshot: { skills: [], complete: true } });
  assert.equal(inventory.entries.some((item) => item.name === 'intrusa-desde-fuera'), false, 'el enlace no se atraviesa');
});

// ── Concurrencia ───────────────────────────────────────────────────────────────────────────────────

test('dos registros concurrentes del mismo proyecto no duplican ni pierden la asignación', async () => {
  const root = sandbox('store');
  const cwd = tempProject('concurrente', sandbox('work'));
  const [a, b] = await Promise.all([
    post(root, 'register-project', { cwd }),
    post(root, 'register-project', { cwd }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const state = loadState(root).state;
  assert.equal(Object.keys(state.projects).length, 1, 'un solo proyecto');
  assert.match(a.body.project.manifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(existsSync(projectManifestPath(root, a.body.project.id)), true);
});

// ── No-regresión: los ficheros de esta ronda no escriben el almacén real ───────────────────────────

test('§4: el preflight hace aflorar content-collision como warn, nunca allow', () => {
  const entries = [
    { key: 'c1', name: 'uno', canonicalName: null, owner: { kind: 'filesystem', provider: 'disco' }, origin: { kind: 'filesystem' }, location: { kind: 'file', path: 'C:/uno/SKILL.md', directory: 'C:/uno', rootId: 'user-dsh' }, scope: { kind: 'project', projectId: 'p1', cwd: 'C:/proyecto' }, association: { loadedByHost: false }, identity: { uuid: null, contentSha256: 'a'.repeat(64) } },
    { key: 'c2', name: 'dos', canonicalName: null, owner: { kind: 'filesystem', provider: 'disco' }, origin: { kind: 'filesystem' }, location: { kind: 'file', path: 'C:/dos/SKILL.md', directory: 'C:/dos', rootId: 'user-dsh' }, scope: { kind: 'project', projectId: 'p1', cwd: 'C:/proyecto' }, association: { loadedByHost: false }, identity: { uuid: null, contentSha256: 'a'.repeat(64) } },
  ];
  const detected = detectCollisions({ entries });
  const content = detected.collisions.find((item) => item.code === 'content-collision');
  assert.ok(content, 'el motor de colisiones sí la detecta');
  assert.equal(content.severity, 'warn');
  const gate = preflight({
    action: 'materialize-project',
    projectId: 'p1',
    skillId: 'uno',
    state: {},
    sources: requiredSources('materialize-project').map((id) => ({ id, status: 'complete' })),
    collisions: [content],
    projectAvailability: 'ok',
  });
  // La salida real del motor lleva el sha256 como clave: el preflight tiene que reconocer el sujeto
  // por las filas/nombres y emitir el finding warn de §4, no callarse.
  const finding = gate.findings.find((item) => item.code === 'content-collision');
  assert.ok(finding, 'content-collision aflora en el preflight');
  assert.equal(finding.severity, 'warn');
  assert.equal(gate.decision, 'warn');
  assert.notEqual(gate.decision, 'block', 'una colisión de contenido avisa, nunca bloquea');
});

// ── §12.13: registrar no hereda ni modifica políticas ───────────────────────────────────────────────

test('§12.13: registrar un proyecto no hereda la política de otro ni toca la concesión', async () => {
  const root = sandbox('policy');
  const work = sandbox('policy-work');
  const first = await post(root, 'register-project', { cwd: tempProject('politica-a', work) });
  assert.equal(first.status, 200);
  const projectA = first.body.project.id;
  grantAutonomy(root, { projectId: projectA, mode: 'guarded-autonomous', by: 'persona' });

  const before = createHash('sha256').update(readFileSync(knowledgeFile(root))).digest('hex');
  const second = await post(root, 'register-project', { cwd: tempProject('politica-b', work) });
  assert.equal(second.status, 200);
  const projectB = second.body.project.id;
  assert.notEqual(projectA, projectB);
  const after = createHash('sha256').update(readFileSync(knowledgeFile(root))).digest('hex');
  assert.equal(after, before, 'registrar no escribe el almacén de políticas');

  const { document } = loadKnowledge(root);
  const inherited = policyFor(document, projectB);
  assert.equal(inherited.mode, 'human-approved', 'B no hereda la autonomía de A');
  assert.notEqual(inherited.source, 'project', 'la política de B no es la concesión de A');
  const own = policyFor(document, projectA);
  assert.equal(own.mode, 'guarded-autonomous', 'la concesión de A sigue intacta');
  assert.equal(own.source, 'project');
});

// ── R16.1: traza de evidencia real, política create/publish y consistencia ─────────────────────────

/**
 * Monta el plugin completo (`apply`) sobre cajas temporales y devuelve la ruta HTTP ya registrada.
 * El servicio `skills` NO devuelve un catálogo fijo: envuelve el `snapshot` que pida cada prueba y
 * anota, en ese instante, el hash del almacén. Así se puede demostrar que la medición ocurrió ANTES
 * de la escritura, no después.
 */
function mountedHost(options = {}) {
  const root = sandbox('r161-store');
  const dshHome = options.dshHome ?? sandbox('r161-dsh');
  const agentsHome = options.agentsHome ?? sandbox('r161-agents');
  const routes = [];
  const calls = [];
  const cleanups = [];
  const snapshot = options.snapshot ?? (async () => ({ skills: [], complete: true }));
  const services = {
    workingDirectory: { get: () => options.cwd ?? '' },
    agents: { list: () => [] },
    skills: {
      registerProvider(callback) { callback({ invalidate() {} }); },
      snapshot: async () => {
        calls.push({ store: treeHash(root), dsh: treeHash(dshHome) });
        return snapshot();
      },
    },
    connection: {
      browserPeer: { id: 'peer-navegador' },
      admit: ({ headers }) => (String(headers?.cookie ?? '') === ''
        ? { rejection: 401 }
        : { peer: { id: 'peer-navegador', principal: { kind: 'owner' }, interactions: 'answer' } }),
    },
  };
  if (Array.isArray(options.workspaces)) {
    services.workspaceRegistry = { list: () => options.workspaces, get: (id) => options.workspaces.find((item) => item.id === id) };
  }
  const ctx = {
    get: (key) => services[key],
    systemPrompt: { section() {} },
    tools: { register() {} },
    skills: services.skills,
    effect: (callback) => {
      const cleanup = callback();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
      return () => {};
    },
    inject: (list, callback) => {
      assert.deepEqual(list, ['webServer']);
      callback({ webServer: { register: (route) => { routes.push(route); return () => {}; }, getOrigin: () => 'http://127.0.0.1:57238' } });
    },
    workingDirectory: { get: () => options.cwd ?? '' },
    logger: { info() {} },
  };
  apply(ctx, { root, dshHome, agentsHome });
  const host = {
    root,
    dshHome,
    agentsHome,
    routes,
    calls,
    get: (path) => requestRoute(routes[0], { method: 'GET', url: `${BASE}${path}` }),
    post: (action, payload, extra = {}) => requestRoute(routes[0], { method: 'POST', url: BASE, body: JSON.stringify({ action, payload, ...extra }) }),
    close() {
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
    },
  };
  mountedHosts.push(host);
  return host;
}

/** Los `effect` del plugin se desmontan al final: sin esto un temporizador del Host deja el proceso vivo. */
const mountedHosts = [];
test.after(() => {
  for (const host of mountedHosts) host.close();
});

/** `ServerResponse`/`IncomingMessage` mínimos: el adaptador sólo necesita estado, cabeceras y cuerpo. */
async function requestRoute(route, { method = 'GET', url = BASE, body = null, cookie = 'dsh-auth-prueba=1', origin = '' } = {}) {
  const headers = {};
  if (cookie !== '') headers.cookie = cookie;
  if (origin !== '') headers.origin = origin;
  const res = {
    statusCode: 0,
    headers: {},
    payload: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(payload = '') { this.payload = String(payload); },
  };
  const listeners = new Map();
  const req = {
    method,
    url,
    headers,
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(callback);
      return req;
    },
  };
  setImmediate(() => {
    if (body !== null) for (const callback of listeners.get('data') ?? []) callback(Buffer.from(body, 'utf8'));
    for (const callback of listeners.get('end') ?? []) callback();
  });
  await route.handler(req, res);
  return { status: res.statusCode, headers: res.headers, body: res.payload === '' ? null : JSON.parse(res.payload) };
}

test('R16.1: create y publish miden el catálogo real ANTES de escribir y la colisión aflora', async () => {
  const dshHome = sandbox('r161-dsh');
  const external = writeSkill(join(dshHome, 'skills'), 'demo-skill');
  const externalBefore = treeHash(external);
  const host = mountedHost({ dshHome });
  const storeBefore = treeHash(host.root);

  const created = await host.post('create', { ...candidate(), id: 'demo-skill' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.ok, true);
  assert.equal(host.calls.length, 1, 'el adaptador midió el catálogo una vez antes de despachar');
  assert.equal(host.calls[0].store, storeBefore, 'la foto se tomó con el almacén todavía intacto');
  const createFindings = created.body.findings ?? [];
  assert.ok(
    createFindings.some((item) => item.code === 'name-collision' && item.severity === 'warn'),
    `crear con una skill externa del mismo nombre avisa del choque: ${JSON.stringify(createFindings)}`,
  );
  assert.equal(treeHash(external), externalBefore, 'crear NUNCA toca la skill externa');

  const storeBeforePublish = treeHash(host.root);
  const published = await host.post('publish', { id: 'demo-skill' });
  assert.equal(published.status, 409, JSON.stringify(published.body));
  assert.equal(published.body.ok, false);
  assert.equal(published.body.code, 'preflight-blocked');
  assert.equal(host.calls.length, 2, 'publicar volvió a medir, no reutilizó una foto vieja');
  assert.equal(host.calls[1].store, storeBeforePublish, 'la segunda medición precede a cualquier escritura');
  const publishFindings = published.body.findings ?? [];
  assert.ok(publishFindings.some((item) => item.code === 'name-collision' && item.severity === 'block'), JSON.stringify(publishFindings));
  assert.ok(published.body.reasons.length > 0, 'un block explica por qué');
  assert.equal(published.body.evidence.preflightVersion, 1, 'un 409 conserva la evidencia');
  assert.match(published.body.evidence.inventoryHash, /^[0-9a-f]{64}$/);
  assert.equal(treeHash(host.root), storeBeforePublish, 'bloqueado significa cero escrituras en el centro');
});

test('R16.1: las 9 rutas con compuerta miden evidencia antes del despacho (ninguna evita el preflight)', async () => {
  const workspaceDir = sandbox('r161-work');
  const projectCwd = tempProject('r161-proyecto', workspaceDir);
  const dshHome = sandbox('r161-dsh');
  const importFile = join(writeSkill(join(dshHome, 'skills'), 'skill-a-importar'), 'SKILL.md');
  const host = mountedHost({ dshHome, cwd: projectCwd, workspaces: [workspace('ws-1', projectCwd)] });

  // El registro y el proyecto sembrado son el estado previo de la traza; no cuentan como rutas medidas.
  const seededProject = (await host.post('register-project', { cwd: projectCwd })).body.project.id;
  const storeBefore = treeHash(host.root);
  const measuredBefore = host.calls.length;

  const routes = [
    ['create', { ...candidate(), id: 'skill-nueva-de-prueba' }],
    ['publish', { id: seededProject === null ? 'no-existe' : 'skill-nueva-de-prueba' }],
    ['toggle', { projectId: seededProject, skillId: 'skill-nueva-de-prueba', enabled: true }],
    ['materialize-project', { projectId: seededProject }],
    ['import', { path: importFile }],
    ['register-project', { cwd: tempProject('r161-otro', workspaceDir) }],
    ['adopt-project', { projectId: seededProject }],
    ['repair-manifest', { projectId: seededProject }],
    ['detach-project', { projectId: seededProject }],
  ];
  for (const [action, payload] of routes) {
    const before = host.calls.length;
    const storeBeforeAction = treeHash(host.root);
    const response = await host.post(action, payload);
    assert.equal(host.calls.length, before + 1, `«${action}» debe medir el catálogo antes de despachar (respuesta ${response.status})`);
    assert.equal(host.calls[before].store, storeBeforeAction, `«${action}» mide con el almacén en su estado real, no uno inventado`);
    assert.ok(host.calls.length - measuredBefore <= routes.length, 'sin mediciones duplicadas por petición');
  }
  assert.equal(host.calls.length, measuredBefore + routes.length, 'una medición por ruta, ninguna se salta la compuerta');
  // Al menos una ruta de escritura real (register-project) dejó el almacén distinto: la traza no es vacía.
  assert.notEqual(treeHash(host.root), storeBefore, 'la compuerta no impide las operaciones legítimas');
});

test('R16.1: publicar sin skills-registry BLOQUEA con evidence-incomplete y no escribe', async () => {
  const host = mountedHost();
  const created = await host.post('create', { ...candidate(), id: 'skill-a-publicar' });
  assert.equal(created.status, 200);
  const before = treeHash(host.root);
  const blocked = await call(host.root, 'POST', '', {
    body: { action: 'publish', payload: { id: 'skill-a-publicar' } },
    hostSources: { sources: [{ id: 'skills-registry', status: 'unavailable', reason: 'el Host no ofreció catálogo' }] },
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.ok, false);
  assert.equal(blocked.body.code, 'preflight-blocked');
  const missing = blocked.body.findings.find((item) => item.code === 'evidence-incomplete');
  assert.ok(missing, 'sin catálogo la publicación no puede fingir que miró');
  assert.equal(missing.severity, 'block');
  assert.ok(blocked.body.findings.some((item) => item.subject === 'skills-registry' || String(item.message).includes('skills-registry')), 'declara qué fuente falta');
  assert.ok(blocked.body.reasons.length > 0);
  assert.equal(blocked.body.evidence.preflightVersion, 1);
  assert.equal(treeHash(host.root), before, 'un block deja el árbol idéntico');
});

test('R16.1: crear sin catálogo avisa catalog-unverified y no afirma «sin colisiones»', async () => {
  const host = mountedHost();
  const before = treeHash(host.root);
  const created = await call(host.root, 'POST', '', {
    body: { action: 'create', payload: { ...candidate(), id: 'skill-sin-catalogo' } },
    hostSources: { sources: [{ id: 'skills-registry', status: 'unavailable', reason: 'el Host no ofreció catálogo' }] },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.ok, true);
  const warning = (created.body.findings ?? []).find((item) => item.code === 'catalog-unverified');
  assert.ok(warning, 'crear sin catálogo ADVierte, no bloquea');
  assert.equal(warning.severity, 'warn');
  assert.doesNotMatch(JSON.stringify(created.body.findings ?? []), /sin colisiones/i, 'no se puede afirmar lo que no se midió');
  assert.notEqual(treeHash(host.root), before, 'la creación local sí se permite con la advertencia');
});

test('R16.1: materializar con evidencia incompleta bloquea y no crea la vista', async () => {
  const host = mountedHost();
  const workspaceDir = sandbox('r161-work2');
  const cwd = tempProject('r161-materializar', workspaceDir);
  const registered = await host.post('register-project', { cwd });
  assert.equal(registered.status, 200);
  const projectId = registered.body.project.id;
  const before = treeHash(host.root);
  const blocked = await call(host.root, 'POST', '', { body: { action: 'materialize-project', payload: { projectId } } });
  assert.notEqual(blocked.status, 200, 'sin catálogo no hay 200');
  assert.equal(blocked.body.ok, false);
  assert.notEqual(blocked.body.code, undefined);
  assert.equal(existsSync(join(host.root, 'materialized', projectId)), false, 'bloqueado: la vista no existe');
  assert.equal(treeHash(host.root), before, 'el árbol queda idéntico');
});

test('R16.1: un proveedor externo distinto del propietario bloquea publicar', async () => {
  const host = mountedHost();
  await host.post('create', { ...candidate(), id: 'skill-de-dos-proveedores' });
  const before = treeHash(host.root);
  const entry = {
    key: 'host:externo:skill-de-dos-proveedores',
    name: 'skill-de-dos-proveedores',
    canonicalName: 'skill-de-dos-proveedores',
    owner: { kind: 'filesystem', provider: 'proveedor-externo' },
    origin: { kind: 'filesystem', label: 'proveedor externo' },
    location: { kind: 'file', path: 'C:/externo/skill-de-dos-proveedores/SKILL.md', directory: 'C:/externo/skill-de-dos-proveedores', rootId: 'user-dsh' },
    scope: { kind: 'user' },
    association: { loadedByHost: true, provider: 'otro-proveedor' },
    identity: { uuid: null, contentSha256: 'f'.repeat(64) },
  };
  const blocked = await call(host.root, 'POST', '', {
    body: { action: 'publish', payload: { id: 'skill-de-dos-proveedores' } },
    inventory: {
      entries: [entry],
      sources: ['state', 'manifest', 'skills-registry', 'filesystem-project', 'filesystem-view'].map((id) => ({ id, status: 'complete', reason: '' })),
      complete: true,
    },
  });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.equal(blocked.body.code, 'preflight-blocked');
  assert.ok(blocked.body.findings.some((item) => item.code === 'name-collision' && item.severity === 'block'), JSON.stringify(blocked.body.findings));
  assert.equal(treeHash(host.root), before);
});

test('R16.1: un nombre ambiguo bloquea publicar (ambiguous-identity)', async () => {
  const host = mountedHost();
  await host.post('create', { ...candidate(), id: 'skill-ambigua' });
  const before = treeHash(host.root);
  const materialized = (key) => ({
    key,
    name: 'skill-ambigua',
    canonicalName: 'skill-ambigua',
    owner: { kind: 'lifecode', provider: 'lifecode-skill-center' },
    origin: { kind: 'materialized' },
    location: { kind: 'directory', path: `C:/centro/${key}`, directory: `C:/centro/${key}`, rootId: 'materialized' },
    scope: { kind: 'project', projectId: 'p1', cwd: 'C:/proyecto' },
    association: { loadedByHost: true },
    identity: { uuid: null, contentSha256: null },
  });
  const detected = detectCollisions({ entries: [materialized('a'), materialized('b')] });
  assert.ok(detected.ambiguousNames.includes('skill-ambigua'));
  const blocked = await call(host.root, 'POST', '', {
    body: { action: 'publish', payload: { id: 'skill-ambigua' } },
    inventory: {
      entries: [materialized('a'), materialized('b')],
      sources: ['state', 'manifest', 'skills-registry'].map((id) => ({ id, status: 'complete', reason: '' })),
      complete: true,
    },
    collisions: detected,
  });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.ok(blocked.body.findings.some((item) => item.code === 'ambiguous-identity' && item.severity === 'block'), JSON.stringify(blocked.body.findings));
  assert.equal(treeHash(host.root), before);
});

test('R16.1: una asignación a una skill sombreada se avisa al asignar y BLOQUEA materializar', async () => {
  const workspaceDir = sandbox('r161-work3');
  const cwd = tempProject('r161-shadow', workspaceDir);
  const host = mountedHost({
    cwd,
    workspaces: [workspace('ws-1', cwd)],
    snapshot: async () => ({
      skills: [{ name: 'demo-skill', description: 'la sirve el Host', path: 'C:/host/demo-skill/SKILL.md', provider: 'host' }],
      complete: true,
    }),
  });
  const registered = await host.post('register-project', { cwd });
  assert.equal(registered.status, 200);
  const projectId = registered.body.project.id;
  writeSkill(join(host.root, 'materialized', projectId), 'demo-skill');
  withState(host.root, (state) => {
    state.assignments = state.assignments ?? {};
    state.assignments[projectId] = { 'demo-skill': { version: '1.0.0', enabled: true, by: 'human' } };
    return { ok: true };
  });

  const before = treeHash(host.root);
  const toggle = await host.post('toggle', { projectId, skillId: 'demo-skill', enabled: true });
  assert.equal(toggle.status, 200, JSON.stringify(toggle.body));
  assert.ok(
    (toggle.body.findings ?? []).some((item) => item.code === 'assignment-shadowed' && item.severity === 'warn'),
    `asignar una skill sombreada avisa con la evidencia real: ${JSON.stringify(toggle.body.findings)}`,
  );
  const materialize = await host.post('materialize-project', { projectId, skillId: 'demo-skill' });
  assert.equal(materialize.status, 409, JSON.stringify(materialize.body));
  const shadow = (materialize.body.findings ?? []).find((item) => item.code === 'assignment-shadowed');
  assert.ok(shadow, `la asignación sombreada bloquea la materialización: ${JSON.stringify(materialize.body.findings)}`);
  assert.equal(shadow.severity, 'block');
  assert.equal(treeHash(host.root), before, 'bloqueada: ni un byte materializado');
});

test('R16.1: GET /api/inventory declara la fuente caída y nunca finge un inventario completo', async () => {
  const host = mountedHost({
    snapshot: async () => {
      throw Object.assign(new Error('catálogo caído'), { code: 'snapshot-crash' });
    },
  });
  const response = await host.get('/inventory');
  assert.equal(response.status, 200, 'el inventario degradado se sirve; lo que no se puede es mentir');
  assert.equal(response.body.ok, true);
  assert.equal(response.body.complete, false, 'una fuente caída jamás deja complete:true');
  const row = response.body.sources.find((item) => item.id === 'skills-registry');
  assert.ok(row, 'la fila de la fuente está, aunque falle');
  assert.notEqual(row.status, 'complete');
  assert.ok(['error', 'incomplete', 'unavailable'].includes(row.status), row.status);
  assert.ok(String(row.reason ?? '').length > 0, 'la fila explica el fallo');
  assert.match(row.reason, /catálogo se cayó|catálogo caído|snapshot-crash/i);
  assert.ok(Array.isArray(response.body.entries), 'las entradas honestas son una lista, no un éxito inventado');
});

test('R16.1: GET /api/projects no confunde un workspace descubierto con uno registrado', async () => {
  const workspaceDir = sandbox('r161-work4');
  const registeredCwd = tempProject('r161-registrado', workspaceDir);
  const discoveredCwd = tempProject('r161-descubierto', workspaceDir);
  const host = mountedHost({
    cwd: registeredCwd,
    workspaces: [workspace('ws-registrado', registeredCwd), workspace('ws-descubierto', discoveredCwd)],
  });
  const registered = await host.post('register-project', { cwd: registeredCwd });
  assert.equal(registered.status, 200);
  const list = await host.get('/projects');
  assert.equal(list.status, 200);
  assert.equal(list.body.projects.length, 1, 'sólo el registrado es proyecto');
  assert.equal(list.body.projects[0].cwd.toLowerCase(), cwdKey(registeredCwd));
  assert.equal(list.body.projects[0].state, 'healthy');
  const discovered = list.body.discovered ?? [];
  assert.equal(discovered.length, 1, 'el otro sigue siendo descubierto');
  assert.equal(discovered[0].workspaceId, 'ws-descubierto');
  assert.equal(discovered[0].state, 'discovered');
  assert.equal(discovered[0].projectId, projectIdFor(discoveredCwd));
  assert.equal(list.body.projects.some((item) => item.projectId === discovered[0].projectId), false, 'descubierto no está registrado');
  assert.equal(discovered.some((item) => item.workspaceId === 'ws-registrado'), false, 'registrado no está descubierto');
  assert.equal(list.body.summary.total, 1);
  assert.equal(list.body.summary.discovered, 1);
});

test('R16.1: cada entrada del inventario declara owner, origin, location y scope', async () => {
  const dshHome = sandbox('r161-dsh-detalle');
  writeSkill(join(dshHome, 'skills'), 'skill-con-procedencia');
  const host = mountedHost({ dshHome });
  const response = await host.get('/inventory');
  assert.equal(response.status, 200);
  const entry = response.body.entries.find((item) => item.name === 'skill-con-procedencia');
  assert.ok(entry, 'la skill está en el inventario');
  assert.equal(typeof entry.owner.kind, 'string');
  assert.equal(typeof entry.owner.provider, 'string');
  assert.equal(typeof entry.origin.kind, 'string');
  assert.ok(['file', 'directory'].includes(entry.location.kind), entry.location.kind);
  assert.match(entry.location.path, /skill-con-procedencia/i);
  assert.equal(typeof entry.scope.kind, 'string');
  assert.equal(typeof entry.confidence, 'string');
  assert.ok(Array.isArray(entry.reasons));
});

test('R16.1: la herramienta IA mide la evidencia antes de crear (no hay camino sin compuerta)', async () => {
  const root = sandbox('r161-tool');
  const name = 'skill-de-herramienta-ia';
  const ours = (key) => entry({
    key,
    name,
    canonicalName: name,
    owner: { kind: 'lifecode', provider: 'lifecode-skill-center' },
    origin: { kind: 'materialized' },
    location: { kind: 'directory', path: `C:/centro/${key}`, directory: `C:/centro/${key}`, rootId: 'materialized' },
    scope: { kind: 'project', projectId: 'p1', cwd: 'C:/proyecto' },
    association: { loadedByHost: true },
  });
  const detected = detectCollisions({ entries: [ours('a'), ours('b')] });
  const before = treeHash(root);
  const measurements = [];
  const tool = lifecodeSkillCreate({
    root,
    evidence: async () => {
      measurements.push(treeHash(root));
      return {
        inventory: {
          entries: [ours('a'), ours('b')],
          sources: ['state', 'manifest', 'skills-registry'].map((id) => ({ id, status: 'complete', reason: '' })),
          complete: true,
        },
        collisions: detected,
      };
    },
  });
  const output = await tool.execute(
    { ...candidate(), id: name },
    { agent: { session: { header: { cwd: '' } } } },
  );
  assert.equal(measurements.length, 1, 'la herramienta IA mide exactamente una vez antes de crear');
  assert.equal(measurements[0], before, 'la medición precede a la escritura');
  assert.equal(output.status, 'failed', JSON.stringify(output));
  assert.match(JSON.stringify(output), /ambiguous-identity/i, 'la herramienta IA no crea sobre un nombre ambiguo sin declararlo');
  assert.equal(treeHash(root), before, 'la herramienta IA tampoco escribe cuando la evidencia bloquea');
});

test('R16.1: lib/ no conserva una segunda detección con DSH_HOME y sources delega en las raíces centrales', () => {
  const plugin = join(import.meta.dirname, '..');
  const libDir = join(plugin, 'lib');
  const files = readdirSync(libDir, { withFileTypes: true }).filter((item) => item.isFile() && item.name.endsWith('.mjs'));
  for (const file of files) {
    const text = readFileSync(join(libDir, file.name), 'utf8');
    assert.equal(/process\.env\.DSH_HOME/.test(text), false, `lib/${file.name} no puede leer DSH_HOME por su cuenta`);
  }
  const sources = readFileSync(join(libDir, 'sources.mjs'), 'utf8');
  assert.match(sources, /skillRootsFor/, 'sources.mjs obtiene las raíces del inventario central');
  assert.equal(/function\s+walk\s*\(/.test(sources) && !/skillRoots/.test(sources), false, 'la política de raíces no está duplicada');
});

test('R16.1: importar mide el catálogo real antes de copiar y no toca el origen', async () => {
  const dshHome = sandbox('r161-dsh-import');
  const fixture = candidate();
  const folder = join(dshHome, 'skills', 'skill-importada');
  mkdirSync(folder, { recursive: true });
  const importFile = join(folder, 'SKILL.md');
  writeFileSync(importFile, `---\nname: skill-importada\ndescription: ${fixture.description}\nwhenToUse: ${fixture.whenToUse}\n---\n\n${fixture.body}`);
  const externalBefore = treeHash(folder);
  const host = mountedHost({
    dshHome,
    snapshot: async () => ({ skills: [{ name: 'skill-importada', description: 'ya servida', path: 'C:/host/skill-importada/SKILL.md', provider: 'otro' }], complete: true }),
  });
  const before = treeHash(host.root);
  const response = await host.post('import', { path: importFile });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(host.calls.length, 1, 'importar también pasa por la compuerta');
  assert.equal(host.calls[0].store, before, 'mide antes de escribir');
  assert.equal(response.body.ok, true, `la importación se acepta: ${JSON.stringify(response.body).slice(0, 300)}`);
  assert.equal(response.body.skill?.origin?.kind, 'import', 'la skill importada declara su procedencia');
  assert.equal(host.calls[0].dsh, treeHash(dshHome), 'la compuerta midió el catálogo con la caja real de fuentes');
  assert.equal(treeHash(folder), externalBefore, 'importar lee el origen y jamás lo escribe');
});

test('no-regresión: los ficheros de esta ronda no tocan ~/.dsh real', () => {
  const files = ['tests/r16-contract.test.mjs', 'tests/r16-security.test.mjs', 'tests/r16-e2e-sim.test.mjs', 'tools/r16-e2e.mjs', 'tools/r16-collision-matrix.mjs'];
  const plugin = join(import.meta.dirname, '..');
  // Los patrones se construyen por partes para que esta misma prueba (que los contiene) no se marque sola.
  const forbidden = [
    new RegExp(`home${'dir'}\\s*\\(`),
    new RegExp(`USER${'PROFILE'}|APP${'DATA'}`),
    new RegExp(`['"\`]~[\\\\/]\\.dsh`),
  ];
  for (const relative of files) {
    const path = join(plugin, relative);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, `${relative} coincide con ${pattern}`);
    }
    if (/writeFileSync|writeFile|mkdirSync|rmSync|appendFileSync|createWriteStream/.test(text)) {
      assert.match(text, /mkdtempSync|tmpdir\(\)/, `${relative} escribe y debe trabajar en caja temporal`);
    }
  }
});
