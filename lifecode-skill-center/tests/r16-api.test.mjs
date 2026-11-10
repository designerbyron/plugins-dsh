/*
 * Pruebas del cableado R16: API HTTP (inventario, proyectos, workspaces compatible) y compuertas de
 * preflight en las acciones que escriben. Todo vive en cajas de arena: ni el almacén real ni proyectos
 * reales se tocan. Las fuentes del Host se simulan con objetos `skills`/`loader`/`registry`.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  API_CONTRACT_VERSION,
  API_PREFIX,
  API_VERSION,
  CAPABILITY_IDS,
  countOwners,
  handleApiRequest,
  inventoryEvidence,
  inventoryPayload,
  projectsPayload,
  runAction,
} from '../lib/api.mjs';
import { projectIdFor } from '../lib/format.mjs';
import { scanExternalSkills } from '../lib/sources.mjs';
import { centerFile } from '../lib/state.mjs';
import { apply as applyPlugin } from '../index.js';
import { candidate, tempProject, tempRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';

/** SKILL.md con frontmatter completo, dentro de `<parent>/<name>/`. */
function writeSkill(parent, name, { frontmatter = null, body = 'Cuerpo de la skill con detalle suficiente.' } = {}) {
  const directory = join(parent, name);
  mkdirSync(directory, { recursive: true });
  const head = frontmatter ?? [
    `name: ${name}`,
    'description: Una skill de prueba con una descripción suficientemente larga para el inventario.',
    'whenToUse: cuando haga falta comprobar el cableado de fuentes del inventario.',
  ].join('\n');
  writeFileSync(join(directory, 'SKILL.md'), `---\n${head}\n---\n\n${body}\n`);
}

function fakeSkills(skills = [], { complete = true } = {}) {
  return { snapshot: async () => ({ skills, complete }) };
}

function fakeLoader(entries = []) {
  return { entries: () => entries };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Huella estable de un árbol: rutas relativas ordenadas + hash de cada contenido. */
function treeDigest(directory) {
  if (!existsSync(directory)) return 'missing';
  const rows = [];
  const walk = (current, prefix) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      const info = statSync(full);
      if (info.isDirectory()) walk(full, relative);
      else rows.push(`${relative}:${sha256(readFileSync(full))}`);
    }
  };
  walk(directory, '');
  return sha256(rows.join('\n'));
}

function fileDigest(path) {
  return existsSync(path) ? sha256(readFileSync(path)) : 'missing';
}

function postAction({ root, body, hostCwd = '', skills = null, loader = null, dshHome = '', agentsHome = '', materializedRoot = '', registry = null, inventory = null, collisions = null, hostSources = null }) {
  return handleApiRequest({
    root,
    method: 'POST',
    pathname: API_PREFIX,
    search: '',
    body,
    hostCwd,
    skills,
    loader,
    dshHome,
    agentsHome,
    materializedRoot,
    registry,
    inventory,
    collisions,
    hostSources,
    now: NOW,
  });
}

/**
 * La misma foto que mide `index.js` antes de despachar una acción con compuerta: adaptadores reales,
 * inventario/colisiones reales y la fila de `skills-registry` como fuente del Host.
 */
async function measureEvidence({ root, cwd, skills, loader = null, dshHome = '', agentsHome = '', materializedRoot = '' }) {
  const measured = await inventoryEvidence({ root, skills, loader, hostCwd: cwd, cwd, now: NOW, dshHome, agentsHome, materializedRoot });
  if (measured.unavailable !== undefined) {
    return {
      inventory: null,
      collisions: null,
      hostSources: [{ id: 'skills-registry', status: 'unavailable', reason: 'el Host no ofrece el catálogo de skills' }],
    };
  }
  const row = measured.inventory.sources.find((source) => source.id === 'skills-registry')
    ?? { id: 'skills-registry', status: 'incomplete', reason: 'el catálogo no se declaró completo' };
  return { inventory: measured.inventory, collisions: measured.collisions, hostSources: [row] };
}

/** Catálogo simulado que anota la huella del almacén en el instante en que se le mide. */
function spyingSkills(root, skills) {
  const observed = [];
  return {
    observed,
    snapshot: async (options) => {
      observed.push(fileDigest(centerFile(root)));
      return skills.snapshot(options);
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// GET /api/inventory
// ---------------------------------------------------------------------------------------------------

test('GET inventory: fuentes completas, entradas propias/externas/globales/legacy y sombreado por el Host', async () => {
  const root = tempRoot('lsc-r16-inv');
  const cwd = tempRoot('lsc-r16-cwd');
  const dshHome = tempRoot('lsc-r16-dsh');
  const agentsHome = tempRoot('lsc-r16-agents');
  const materialized = tempRoot('lsc-r16-mat');

  writeSkill(join(cwd, '.dsh', 'skills'), 'propia-dsh');
  writeSkill(join(cwd, '.agents', 'skills'), 'propia-agents');
  writeSkill(join(dshHome, 'skills'), 'global-uno');
  writeSkill(join(dshHome, 'skills'), 'propia-dsh'); // misma skill que la del proyecto: colisión de nombre
  writeSkill(join(dshHome, 'skills'), 'Mala Nombre', { frontmatter: 'name: "Mala Nombre"' });
  writeSkill(join(agentsHome, 'skills'), 'agents-global');
  writeSkill(join(dshHome, 'skill-compiler', 'projects', 'proyecto-viejo', 'approved'), 'legacy-viva');
  writeSkill(join(dshHome, 'skill-compiler', 'projects', 'proyecto-viejo', 'superseded'), 'legacy-vieja');
  writeSkill(join(dshHome, 'skill-compiler', 'global'), 'legacy-global');
  writeSkill(join(materialized, 'proyecto'), 'material-uno');

  const skills = fakeSkills([
    { name: 'host-externa', description: 'Skill que aporta otro proveedor del Host.', provider: 'otro-proveedor', source: 'global' },
    { name: 'global-uno', description: 'Duplicada en disco; el catálogo del Host debe ganar.', provider: 'host', source: 'host', path: 'C:/otro-proveedor/global-uno/SKILL.md' },
  ]);
  const loader = fakeLoader([{ entryId: 'e1', moduleName: 'lifecode-skill-center', enabled: true, fiberPhase: 'active' }]);

  const response = await inventoryPayload({ root, skills, loader, hostCwd: cwd, dshHome, agentsHome, materializedRoot: materialized, now: NOW });
  assert.equal(response.status, 200);
  const body = response.body;
  assert.deepEqual(Object.keys(body), ['ok', 'apiVersion', 'contractVersion', 'generatedAt', 'complete', 'truncated', 'sources', 'entries', 'collisions', 'summary']);
  assert.equal(body.ok, true);
  assert.equal(body.apiVersion, API_VERSION);
  assert.equal(body.generatedAt, NOW);
  assert.equal(body.complete, true);
  assert.equal(body.truncated, false);

  const sourceById = new Map(body.sources.map((source) => [source.id, source]));
  for (const id of ['state', 'skills-registry', 'loader', 'filesystem-view', 'compiler-projects', 'compiler-global', 'materialized']) {
    assert.equal(sourceById.get(id)?.status, 'complete', `fuente ${id}: ${JSON.stringify(sourceById.get(id))}`);
  }
  assert.equal(sourceById.get('workspace-registry')?.status, 'unavailable');
  assert.equal(sourceById.get('sessions')?.status, 'unavailable');
  assert.equal(sourceById.get('compiler-projects')?.found, 1);
  assert.equal(sourceById.get('compiler-projects')?.history, 1);

  const byName = new Map(body.entries.map((entry) => [entry.name, entry]));
  for (const name of ['propia-dsh', 'propia-agents', 'global-uno', 'Mala Nombre', 'agents-global', 'legacy-viva', 'legacy-global', 'material-uno', 'host-externa']) {
    assert.ok(byName.has(name), `falta la entrada ${name}: ${[...byName.keys()].join(', ')}`);
  }
  const externa = byName.get('host-externa');
  assert.equal(externa.owner.kind, 'plugin');
  assert.equal(externa.origin.kind, 'loader');
  const shadowed = body.entries.filter((entry) => entry.name === 'global-uno' && entry.association?.shadowedBy !== null);
  assert.equal(shadowed.length, 1, 'la entrada de disco sombreada por el Host tiene que decirlo');
  assert.equal(shadowed[0].association.shadowedBy.provider, 'host');
  assert.ok(body.collisions.some((collision) => collision.code === 'name-collision'));
  assert.equal(body.summary.invalidNames, 1);
  assert.equal(body.summary.total, body.entries.length);
});

test('GET inventory: límite no entero es 400 y un límite válido trunca con honestidad', async () => {
  const root = tempRoot('lsc-r16-limit');
  const cwd = tempRoot('lsc-r16-limit-cwd');
  writeSkill(join(cwd, '.dsh', 'skills'), 'una-skill');
  writeSkill(join(cwd, '.dsh', 'skills'), 'otra-skill');
  const skills = fakeSkills([]);

  const bad = await handleApiRequest({
    root,
    method: 'GET',
    pathname: `${API_PREFIX}/inventory`,
    search: '?limit=abc',
    hostCwd: cwd,
    skills,
    now: NOW,
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'bad-request');

  const truncated = await inventoryPayload({ root, skills, hostCwd: cwd, limit: '1', now: NOW });
  assert.equal(truncated.status, 200);
  assert.equal(truncated.body.truncated, true);
  assert.equal(truncated.body.entries.length, 1);
  assert.ok(Array.isArray(truncated.body.sources) && truncated.body.sources.length > 0);
});

test('GET inventory: sin skills.snapshot ⇒ 503; almacén ilegible ⇒ 409; fuente rota ⇒ complete false', async () => {
  const root = tempRoot('lsc-r16-inv-fail');
  const cwd = tempRoot('lsc-r16-inv-fail-cwd');

  const noSkills = await inventoryPayload({ root, hostCwd: cwd, now: NOW });
  assert.equal(noSkills.status, 503);
  assert.equal(noSkills.body.code, 'skills-registry-unavailable');
  assert.equal(noSkills.body.retryable, true);

  rmSync(centerFile(root), { force: true });
  writeFileSync(centerFile(root), '{ esto no es json', 'utf8');
  const unreadable = await inventoryPayload({ root, skills: fakeSkills([]), hostCwd: cwd, now: NOW });
  assert.equal(unreadable.status, 409);
  assert.equal(unreadable.body.code, 'store-unreadable');

  const broken = tempRoot('lsc-r16-inv-broken');
  const brokenCwd = tempRoot('lsc-r16-inv-broken-cwd');
  // La raíz de skills del proyecto es un fichero: la fuente no se puede leer y debe decirlo.
  mkdirSync(join(brokenCwd, '.dsh'), { recursive: true });
  writeFileSync(join(brokenCwd, '.dsh', 'skills'), 'no soy una carpeta', 'utf8');
  const partial = await inventoryPayload({ root: broken, skills: fakeSkills([], { complete: false }), hostCwd: brokenCwd, now: NOW });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.complete, false);
  const skillsRow = partial.body.sources.find((source) => source.id === 'skills-registry');
  assert.equal(skillsRow.status, 'incomplete');
  assert.ok(partial.body.sources.some((source) => source.status === 'error'), 'una raíz ilegible tiene que salir como error');
});

// ---------------------------------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------------------------------

test('GET projects: los siete estados, siete workspaces y compatibilidad de identity', async () => {
  const root = tempRoot('lsc-r16-proj');
  const workspacesRoot = tempRoot('lsc-r16-ws');
  const paths = {};
  for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta']) {
    paths[name] = tempProject(name, workspacesRoot);
  }

  const registered = {};
  for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
    const result = runAction({ root, action: 'register-project', actor: 'human', cwd: paths[name], now: NOW });
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result).slice(0, 300)}`);
    registered[name] = result.project.id;
  }
  // beta: registro heredado sin manifiesto ⇒ managed (warn manifest-missing).
  rmSync(join(root, 'projects', registered.beta, 'manifest.json'), { force: true });
  // gamma: carpeta ausente y workspace missing-dir ⇒ unavailable.
  rmSync(paths.gamma, { recursive: true, force: true });
  // delta: manifiesto con otra uuid ⇒ identity-conflict.
  writeFileSync(join(root, 'projects', registered.delta, 'manifest.json'), JSON.stringify({
    schema: 'lifecode-skill-center/project',
    schemaVersion: 1,
    projectId: '00000000-0000-4000-8000-000000000000',
    registeredAt: NOW,
  }), 'utf8');
  // epsilon: el manifiesto no se puede leer (es un directorio) ⇒ partially-inspected.
  rmSync(join(root, 'projects', registered.epsilon, 'manifest.json'), { force: true });
  mkdirSync(join(root, 'projects', registered.epsilon, 'manifest.json'), { recursive: true });
  // eta: manifiesto válido en disco, sin registro ⇒ external-managed.
  const etaId = projectIdFor(paths.eta);
  mkdirSync(join(root, 'projects', etaId), { recursive: true });
  writeFileSync(join(root, 'projects', etaId, 'manifest.json'), JSON.stringify({
    schema: 'lifecode-skill-center/project',
    schemaVersion: 1,
    projectId: '22222222-2222-4222-8222-222222222222',
    registeredAt: NOW,
  }), 'utf8');

  const statuses = { gamma: 'missing-dir' };
  const items = Object.entries(paths).map(([name, path], index) => ({
    id: `ws-${name}`,
    path,
    title: `WS ${name}`,
    sessionIds: [`s-${index}`],
    status: async () => statuses[name] ?? 'ok',
  }));
  const registry = { list: () => items };
  const skills = fakeSkills([]);

  const response = await handleApiRequest({
    root,
    method: 'GET',
    pathname: `${API_PREFIX}/projects`,
    search: `?cwd=${encodeURIComponent(paths.alpha)}`,
    hostCwd: paths.alpha,
    skills,
    loader: fakeLoader([]),
    registry,
    now: NOW,
  });
  assert.equal(response.status, 200);
  const body = response.body;
  assert.deepEqual(Object.keys(body), ['ok', 'apiVersion', 'contractVersion', 'generatedAt', 'readable', 'complete', 'sources', 'discovered', 'projects', 'current', 'summary', 'identity']);
  assert.equal(body.ok, true);
  assert.equal(body.apiVersion, API_VERSION);
  assert.equal(body.readable, true);

  const stateOf = (name) => body.projects.find((project) => project.projectId === registered[name])?.state;
  assert.equal(stateOf('alpha'), 'healthy');
  assert.equal(stateOf('beta'), 'managed');
  assert.equal(stateOf('gamma'), 'unavailable');
  assert.equal(stateOf('delta'), 'identity-conflict');
  assert.equal(stateOf('epsilon'), 'partially-inspected');
  const external = body.projects.find((project) => project.projectId === etaId);
  assert.equal(external?.state, 'external-managed');
  assert.equal(body.discovered.length, 1);
  assert.equal(body.discovered[0].workspaceId, 'ws-zeta');
  assert.equal(body.discovered[0].state, 'discovered');

  assert.deepEqual(body.summary, {
    total: 6,
    discovered: 1,
    externalManaged: 1,
    managed: 1,
    healthy: 1,
    unavailable: 1,
    identityConflict: 1,
    partiallyInspected: 1,
  });
  assert.equal(body.current.cwd, paths.alpha.replace(/\\/g, '/'));
  assert.equal(body.current.workspaceId, 'ws-alpha');
  assert.equal(body.current.projectId, registered.alpha);
  assert.equal(body.current.state, 'healthy');
  assert.equal(body.current.confidence, 'session');
  assert.equal(body.current.via, 'host-cwd');
  assert.equal(body.identity.ok, true);
  for (const key of ['readable', 'inventory', 'items', 'counts', 'total', 'uniqueness', 'duplicates', 'forks']) {
    assert.ok(Object.hasOwn(body.identity, key), `identity perdió la clave ${key}`);
  }
});

test('GET projects: 503 sin registro de workspaces y 409 con el almacén ilegible', async () => {
  const root = tempRoot('lsc-r16-proj-fail');
  const noRegistry = await projectsPayload({ root, hostCwd: '', now: NOW });
  assert.equal(noRegistry.status, 503);
  assert.equal(noRegistry.body.code, 'workspace-registry-unavailable');
  assert.equal(noRegistry.body.retryable, true);

  writeFileSync(centerFile(root), 'no-json', 'utf8');
  const unreadable = await projectsPayload({ root, registry: { list: () => [] }, now: NOW });
  assert.equal(unreadable.status, 409);
  assert.equal(unreadable.body.code, 'store-unreadable');
});

// ---------------------------------------------------------------------------------------------------
// Compatibilidad de GET /api/workspaces
// ---------------------------------------------------------------------------------------------------

test('/workspaces conserva las claves de siempre y añade deprecated+state por fila', async () => {
  const root = tempRoot('lsc-r16-wscompat');
  const first = tempProject('uno', tempRoot('lsc-r16-wscompat-a'));
  const second = tempProject('dos', tempRoot('lsc-r16-wscompat-b'));
  const items = [
    { id: 'ws-uno', path: first, title: 'Uno', sessionIds: ['s1'], createdAt: NOW, updatedAt: NOW, status: async () => 'ok' },
    { id: 'ws-dos', path: second, title: 'Dos', sessionIds: [], createdAt: NOW, updatedAt: NOW, status: async () => 'ok' },
  ];
  const response = await handleApiRequest({
    root,
    method: 'GET',
    pathname: `${API_PREFIX}/workspaces`,
    search: '',
    hostCwd: first,
    registry: { list: () => items },
    now: NOW,
  });
  assert.equal(response.status, 200);
  const body = response.body;
  const expectedKeys = ['ok', 'apiVersion', 'generatedAt', 'readable', 'workspaces', 'managed', 'current', 'summary', 'identity'];
  const actualKeys = Object.keys(body);
  assert.equal(actualKeys.length, expectedKeys.length + 1, actualKeys.join(','));
  for (const key of expectedKeys) assert.ok(actualKeys.includes(key), `falta la clave vieja ${key}`);
  assert.equal(body.deprecated, true);
  assert.equal(body.workspaces.length, 2);
  for (const row of body.workspaces) {
    for (const key of ['workspaceId', 'title', 'path', 'sessionCount', 'status']) {
      assert.ok(Object.hasOwn(row, key), `la fila perdió ${key}`);
    }
    assert.equal(typeof row.state, 'string');
  }
  // La forma del despacho no cambia: un GET /workspaces sin registro sigue siendo 503.
  const unavailable = await handleApiRequest({ root, method: 'GET', pathname: `${API_PREFIX}/workspaces`, search: '', now: NOW });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.code, 'workspace-registry-unavailable');
});

// ---------------------------------------------------------------------------------------------------
// Acciones con compuerta
// ---------------------------------------------------------------------------------------------------

test('register-project por HTTP escribe manifiesto y registro sin tocar el proyecto', async () => {
  const root = tempRoot('lsc-r16-reg');
  const project = tempProject('registrable', tempRoot('lsc-r16-reg-proj'));
  mkdirSync(join(project, 'docs'), { recursive: true });
  writeFileSync(join(project, 'docs', 'nota.md'), '# nota\n', 'utf8');
  writeFileSync(join(project, 'README.md'), '# proyecto\n', 'utf8');
  const before = treeDigest(project);

  const response = await postAction({ root, body: { action: 'register-project', payload: { cwd: project } } });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 400));
  assert.equal(response.body.ok, true);

  const projectId = projectIdFor(project);
  assert.equal(response.body.project.id, projectId);
  assert.equal(response.body.project.cwd, project.replace(/\\/g, '/'));
  assert.equal(response.body.manifest.uuid, response.body.project.uuid);
  const manifestPath = join(root, 'projects', projectId, 'manifest.json');
  assert.ok(existsSync(manifestPath), 'el manifiesto R16 vive en el centro');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.schema, 'lifecode-skill-center/project');
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.projectId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const stored = JSON.parse(readFileSync(centerFile(root), 'utf8'));
  assert.equal(stored.projects[projectId]?.cwd, project.replace(/\\/g, '/'));
  assert.equal(stored.projects[projectId]?.uuid, manifest.projectId);

  assert.equal(treeDigest(project), before, 'registrar no puede escribir dentro del proyecto');
});

test('register-project con cwd del cliente distinto del hostCwd ⇒ 400 identity-from-client y cero escrituras', async () => {
  const root = tempRoot('lsc-r16-idc');
  const project = tempProject('cliente', tempRoot('lsc-r16-idc-proj'));
  const hostWorkspace = tempProject('host', tempRoot('lsc-r16-idc-host'));
  const response = await postAction({
    root,
    body: { action: 'register-project', payload: { cwd: project } },
    hostCwd: hostWorkspace,
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'identity-from-client');
  assert.equal(existsSync(centerFile(root)), false);
  assert.equal(existsSync(join(root, 'projects')), false);
});

test('register-project sin hostCwd rechaza un cwd relativo o con .. ⇒ 400 invalid-cwd y cero escrituras', async () => {
  const root = tempRoot('lsc-r16-cwd');
  for (const cwd of ['../..', '..', 'relativa/dentro', './dentro', '../fuera']) {
    const response = await postAction({ root, body: { action: 'register-project', payload: { cwd } } });
    assert.equal(response.status, 400, `«${cwd}» debería rechazarse: ${JSON.stringify(response.body).slice(0, 200)}`);
    assert.equal(response.body.code, 'invalid-cwd', `«${cwd}» debe dar invalid-cwd, no una ruta relativa registrada`);
  }
  assert.equal(existsSync(centerFile(root)), false);
  assert.equal(existsSync(join(root, 'projects')), false);
});

test('proyecto registrado cuya carpeta desapareció ⇒ unavailable aunque el registro diga que el workspace está', async () => {
  const root = tempRoot('lsc-r16-avail');
  const project = tempProject('desaparece', tempRoot('lsc-r16-avail-work'));
  const registered = runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  assert.equal(registered.ok, true);
  rmSync(project, { recursive: true, force: true });
  const registry = {
    list: () => [{ id: 'ws-fantasma', path: project, title: 'Fantasma', sessionIds: [], status: async () => 'ok' }],
  };
  const response = await projectsPayload({ root, registry, hostCwd: project, now: NOW, skills: fakeSkills([]), loader: fakeLoader([]) });
  assert.equal(response.status, 200);
  const row = response.body.projects.find((item) => item.projectId === registered.project.id);
  assert.equal(row?.state, 'unavailable', 'sin medir la carpeta se pintaría disponible por la fila del registro');
  assert.ok(row?.reasons?.some((reason) => String(reason).includes('no existe')), 'la ficha explica por qué no está disponible');
});

test('inspect-project sirve la ficha read-only y 404 si el proyecto no existe', async () => {
  const root = tempRoot('lsc-r16-inspect');
  const project = tempProject('ficha', tempRoot('lsc-r16-inspect-work'));
  const registered = runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  assert.equal(registered.ok, true);
  const centerBefore = fileDigest(centerFile(root));

  const response = await postAction({ root, body: { action: 'inspect-project', payload: { projectId: registered.project.id } } });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  assert.equal(response.body.ok, true);
  assert.equal(response.body.action, 'inspect-project');
  assert.equal(response.body.projectId, registered.project.id);
  assert.equal(response.body.project?.projectId, registered.project.id);
  assert.equal(fileDigest(centerFile(root)), centerBefore, 'inspeccionar no escribe el almacén');

  const missing = await postAction({ root, body: { action: 'inspect-project', payload: { projectId: 'no-existe-0000' } } });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'project-not-found');
});

test('preflight en bloque ⇒ 409 y el almacén no cambia ni una línea', async () => {
  const root = tempRoot('lsc-r16-block');
  const good = tempProject('bueno', tempRoot('lsc-r16-block-good'));
  const first = await postAction({ root, body: { action: 'register-project', payload: { cwd: good } } });
  assert.equal(first.status, 200);
  const centerBefore = fileDigest(centerFile(root));
  const projectsBefore = readdirSync(join(root, 'projects')).sort();

  const filePath = join(tempRoot('lsc-r16-block-file'), 'no-soy-carpeta.txt');
  writeFileSync(filePath, 'texto\n', 'utf8');
  const blocked = await postAction({ root, body: { action: 'register-project', payload: { cwd: filePath } } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'preflight-blocked');
  assert.ok(Array.isArray(blocked.body.findings) && blocked.body.findings.length > 0);
  assert.ok(blocked.body.findings.some((finding) => finding.severity === 'block'));
  assert.ok(blocked.body.evidence !== null && typeof blocked.body.evidence === 'object');
  assert.equal(fileDigest(centerFile(root)), centerBefore);
  assert.deepEqual(readdirSync(join(root, 'projects')).sort(), projectsBefore);
});

test('open-workspace por POST ⇒ 501 host-action-unsupported para el panel', async () => {
  const root = tempRoot('lsc-r16-open');
  const response = await postAction({ root, body: { action: 'open-workspace', payload: { workspaceId: 'ws-1' } } });
  assert.equal(response.status, 501);
  assert.equal(response.body.code, 'host-action-unsupported');
  assert.equal(response.body.clientAction, 'uiWorkspace.openWorkspace');
  assert.equal(response.body.workspaceId, 'ws-1');
  assert.equal(existsSync(centerFile(root)), false, 'una acción no soportada no escribe nada');
});

test('materialize-project sin skills-registry ⇒ 409 preflight-blocked y no materializa', async () => {
  const root = tempRoot('lsc-r16-mat');
  const project = tempProject('materializable', tempRoot('lsc-r16-mat-proj'));
  const registered = runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  assert.equal(registered.ok, true);

  const response = await postAction({ root, body: { action: 'materialize-project', payload: { projectId: registered.project.id } } });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'preflight-blocked');
  assert.ok(response.body.findings.some((finding) => finding.code === 'evidence-incomplete'));
  assert.equal(existsSync(join(root, 'materialized', registered.project.id)), false);
});

test('toggle sigue funcionando sin servicios del Host y registra la asignación', async () => {
  const root = tempRoot('lsc-r16-toggle');
  const project = tempProject('toggleable', tempRoot('lsc-r16-toggle-proj'));
  const registered = runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  assert.equal(registered.ok, true);
  const created = runAction({ root, action: 'create', payload: candidate(), actor: 'human', cwd: project, now: NOW });
  assert.equal(created.ok, true, JSON.stringify(created).slice(0, 300));

  const toggled = runAction({
    root,
    action: 'toggle',
    payload: { projectId: registered.project.id, skillId: created.id, enabled: true },
    actor: 'human',
    cwd: project,
    now: NOW,
  });
  assert.equal(toggled.ok, true, JSON.stringify(toggled).slice(0, 400));
  assert.equal(toggled.assignment.enabled, true);
  const stored = JSON.parse(readFileSync(centerFile(root), 'utf8'));
  assert.equal(stored.assignments[registered.project.id][created.id].enabled, true);
});

test('scanExternalSkills no atraviesa symlinks fuera de una raíz autorizada (R16 §3.1)', (t) => {
  const cwd = tempRoot('lsc-r16-symlink');
  const root = join(cwd, '.dsh', 'skills');
  writeSkill(root, 'skill-real');
  const outside = tempRoot('lsc-r16-symlink-fuera');
  writeFileSync(
    join(outside, 'SKILL.md'),
    '---\nname: skill-de-fuera\ndescription: una skill que vive fuera de la raíz y no debe descubrirse.\n---\n\nCuerpo.\n',
  );
  const link = join(root, 'atajo');
  try {
    symlinkSync(outside, link, 'junction');
  } catch (error) {
    t.skip(`el entorno no permite crear junctions: ${error?.code ?? error}`);
    rmSync(outside, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
    return;
  }
  try {
    const scan = scanExternalSkills({ cwd });
    const projectRoot = scan.roots.find((row) => row.source === 'proyecto actual');
    assert.equal(projectRoot.exists, true, 'la raíz autorizada sigue reportándose presente');
    assert.ok(projectRoot.found >= 1, 'la skill real de la raíz sí aparece');
    assert.equal(scan.candidates.some((item) => item.id === 'skill-real'), true);
    assert.equal(scan.candidates.some((item) => item.id === 'skill-de-fuera'), false);
    assert.equal(scan.candidates.some((item) => item.path.includes('atajo')), false, 'el enlace no se recorre');
    assert.equal(scan.truncated, false);
  } finally {
    rmSync(link, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------------
// R16.1 §2: política de creación/publicación y matriz de escritura (7 regresiones + importación)
// ---------------------------------------------------------------------------------------------------

test('R16.1: crear con una Skill externa del mismo nombre avisa (warn), escribe y mide el catálogo antes del almacén', async () => {
  const root = tempRoot('lsc-r161-create-owner');
  const project = tempProject('propietario', tempRoot('lsc-r161-create-work'));
  const registered = runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  assert.equal(registered.ok, true);
  const centerBefore = fileDigest(centerFile(root));

  const base = candidate();
  const inner = fakeSkills([{ name: base.id, description: 'La misma skill, servida por otro proveedor.', provider: 'otro-proveedor', source: 'global' }]);
  const spy = spyingSkills(root, inner);
  const evidence = await measureEvidence({ root, cwd: project, skills: spy });
  assert.ok(spy.observed.length > 0, 'el adaptador del catálogo se midió para la foto del preflight');
  assert.equal(spy.observed[0], centerBefore, 'la foto se tomó antes de cualquier escritura');

  const response = await postAction({ root, body: { action: 'create', payload: base }, hostCwd: project, ...evidence });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 400));
  assert.equal(response.body.ok, true);
  const finding = (response.body.findings ?? []).find((item) => item.code === 'name-collision');
  assert.ok(finding, 'el aviso de nombre ajeno no se calla');
  assert.equal(finding.severity, 'warn', 'crear no cambia la resolución del Host: aviso, no bloqueo');
  assert.match(finding.message, /otro-proveedor/);
  assert.notEqual(fileDigest(centerFile(root)), centerBefore, 'con warn la acción sí escribe');
});

test('R16.1: publicar un nombre que sirve otro proveedor ⇒ 409 preflight-blocked y cero escrituras', async () => {
  const root = tempRoot('lsc-r161-publish-owner');
  const project = tempProject('publicable', tempRoot('lsc-r161-publish-work'));
  runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  const created = runAction({ root, action: 'create', payload: candidate(), actor: 'human', now: NOW });
  assert.equal(created.ok, true);
  runAction({ root, action: 'evaluate', payload: { skillId: created.id }, actor: 'human', now: NOW });
  const centerBefore = fileDigest(centerFile(root));

  const inner = fakeSkills([{ name: created.id, description: 'Servida por otro proveedor.', provider: 'otro-proveedor', source: 'global' }]);
  const evidence = await measureEvidence({ root, cwd: project, skills: inner });
  const response = await postAction({
    root,
    body: { action: 'publish', payload: { id: created.id, body: `${candidate().body}\n\n## Evidencia\n\nPruebas en verde.` } },
    hostCwd: project,
    ...evidence,
  });
  assert.equal(response.status, 409, JSON.stringify(response.body).slice(0, 400));
  assert.equal(response.body.code, 'preflight-blocked');
  assert.ok(response.body.findings.some((item) => item.code === 'name-collision' && item.severity === 'block'));
  assert.equal(fileDigest(centerFile(root)), centerBefore, 'publicar bloqueado no toca el almacén');
});

test('R16.1: sin catálogo del Host, crear avisa catalog-unverified y publicar bloquea', async () => {
  const createRoot = tempRoot('lsc-r161-cat-create');
  const createProject = tempProject('sin-catalogo', tempRoot('lsc-r161-cat-create-work'));
  runAction({ root: createRoot, action: 'register-project', actor: 'human', cwd: createProject, now: NOW });
  const unavailable = await measureEvidence({ root: createRoot, cwd: createProject, skills: null });
  const created = await postAction({ root: createRoot, body: { action: 'create', payload: candidate() }, hostCwd: createProject, ...unavailable });
  assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 400));
  assert.equal(created.body.ok, true);
  assert.ok(created.body.findings.some((item) => item.code === 'catalog-unverified' && item.severity === 'warn'));

  const publishRoot = tempRoot('lsc-r161-cat-publish');
  const publishProject = tempProject('sin-catalogo-2', tempRoot('lsc-r161-cat-publish-work'));
  runAction({ root: publishRoot, action: 'register-project', actor: 'human', cwd: publishProject, now: NOW });
  const skill = runAction({ root: publishRoot, action: 'create', payload: candidate(), actor: 'human', now: NOW });
  assert.equal(skill.ok, true);
  runAction({ root: publishRoot, action: 'evaluate', payload: { skillId: skill.id }, actor: 'human', now: NOW });
  const centerBefore = fileDigest(centerFile(publishRoot));
  const blocked = await postAction({
    root: publishRoot,
    body: { action: 'publish', payload: { id: skill.id, body: `${candidate().body}\n\n## Evidencia\n\nMás pruebas.` } },
    hostCwd: publishProject,
    ...(await measureEvidence({ root: publishRoot, cwd: publishProject, skills: null })),
  });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body).slice(0, 400));
  assert.ok(blocked.body.findings.some((item) => item.code === 'evidence-incomplete' && item.severity === 'block'));
  assert.equal(fileDigest(centerFile(publishRoot)), centerBefore);
});

test('R16.1: proveedor externo ≠ propietario — nuestra copia sombreada ⇒ publicar bloquea y cita al proveedor', async () => {
  const root = tempRoot('lsc-r161-shadow-publish');
  const project = tempProject('sombreado', tempRoot('lsc-r161-shadow-work'));
  const registered = runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  const skill = runAction({ root, action: 'create', payload: candidate(), actor: 'human', now: NOW });
  assert.equal(skill.ok, true);
  const toggled = runAction({
    root,
    action: 'toggle',
    payload: { projectId: registered.project.id, skillId: skill.id, enabled: true },
    actor: 'human',
    cwd: project,
    now: NOW,
  });
  assert.equal(toggled.ok, true);
  runAction({ root, action: 'evaluate', payload: { skillId: skill.id }, actor: 'human', now: NOW });
  const centerBefore = fileDigest(centerFile(root));

  const inner = fakeSkills([{ name: skill.id, description: 'Copia del mismo nombre de otro proveedor.', provider: 'otro-proveedor', source: 'global' }]);
  const evidence = await measureEvidence({ root, cwd: project, skills: inner });
  const shadowed = evidence.inventory.entries.find((entry) => entry.canonicalName === skill.id && entry.association?.shadowedBy !== undefined);
  assert.ok(shadowed, 'la copia local aparece sombreada por el proveedor externo');
  const response = await postAction({
    root,
    body: { action: 'publish', payload: { id: skill.id, body: `${candidate().body}\n\n## Evidencia\n\nPruebas.` } },
    hostCwd: project,
    ...evidence,
  });
  assert.equal(response.status, 409, JSON.stringify(response.body).slice(0, 400));
  const finding = (response.body.findings ?? []).find((item) => item.code === 'name-collision');
  assert.ok(finding && finding.severity === 'block');
  assert.match(finding.message, /otro-proveedor/);
  assert.equal(fileDigest(centerFile(root)), centerBefore);
});

test('R16.1: nombre ambiguo (dos copias con contenidos distintos) ⇒ crear bloquea con cero escrituras', async () => {
  const root = tempRoot('lsc-r161-ambiguous');
  const project = tempProject('ambiguo', tempRoot('lsc-r161-ambiguous-work'));
  const dshHome = tempRoot('lsc-r161-ambiguous-dsh');
  runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  writeSkill(join(project, '.dsh', 'skills'), 'nombre-ambiguo', { body: 'Cuerpo uno, distinto del otro.' });
  writeSkill(join(dshHome, 'skills'), 'nombre-ambiguo', { body: 'Cuerpo dos, distinto del primero.' });
  const evidence = await measureEvidence({ root, cwd: project, skills: fakeSkills([]), loader: fakeLoader([]), dshHome });
  assert.ok(evidence.collisions.ambiguousNames.includes('nombre-ambiguo'), 'el motor de colisiones ve el nombre ambiguo');
  const centerBefore = fileDigest(centerFile(root));

  const response = await postAction({
    root,
    body: { action: 'create', payload: candidate({ id: 'nombre-ambiguo' }) },
    hostCwd: project,
    dshHome,
    ...evidence,
  });
  assert.equal(response.status, 409, JSON.stringify(response.body).slice(0, 400));
  assert.equal(response.body.code, 'preflight-blocked');
  assert.ok(response.body.findings.some((item) => item.code === 'ambiguous-identity' && item.severity === 'block'));
  assert.equal(fileDigest(centerFile(root)), centerBefore, 'un nombre ambiguo no deja una escritura a medias');
});

test('R16.1: asignación a Skill sombreada ⇒ toggle avisa y materializar bloquea sin escribir', async () => {
  const root = tempRoot('lsc-r161-assign-shadow');
  const project = tempProject('asignado', tempRoot('lsc-r161-assign-work'));
  const registered = runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  const skill = runAction({ root, action: 'create', payload: candidate(), actor: 'human', now: NOW });
  runAction({
    root,
    action: 'toggle',
    payload: { projectId: registered.project.id, skillId: skill.id, enabled: true },
    actor: 'human',
    cwd: project,
    now: NOW,
  });
  const inner = fakeSkills([{ name: skill.id, description: 'Otra copia que el Host carga.', provider: 'otro-proveedor', source: 'global' }]);
  const evidence = await measureEvidence({ root, cwd: project, skills: inner });
  assert.ok(evidence.collisions.collisions.some((item) => item.code === 'assignment-shadowed'));

  const toggled = await postAction({
    root,
    body: { action: 'toggle', payload: { projectId: registered.project.id, skillId: skill.id, enabled: true } },
    hostCwd: project,
    ...evidence,
  });
  assert.equal(toggled.status, 200, JSON.stringify(toggled.body).slice(0, 400));
  assert.equal(toggled.body.ok, true);
  assert.ok(toggled.body.findings.some((item) => item.code === 'assignment-shadowed' && item.severity === 'warn'));

  const centerBefore = fileDigest(centerFile(root));
  const materializedBefore = treeDigest(join(root, 'materialized', registered.project.id));
  const materialized = await postAction({
    root,
    body: { action: 'materialize-project', payload: { projectId: registered.project.id } },
    hostCwd: project,
    ...evidence,
  });
  assert.equal(materialized.status, 409, JSON.stringify(materialized.body).slice(0, 400));
  assert.equal(materialized.body.code, 'preflight-blocked');
  assert.ok(materialized.body.findings.some((item) => item.code === 'assignment-shadowed' && item.severity === 'block'));
  assert.equal(fileDigest(centerFile(root)), centerBefore);
  assert.equal(treeDigest(join(root, 'materialized', registered.project.id)), materializedBefore, 'materializar bloqueado no reescribe la vista');
});

test('R16.1: materializar con catálogo incompleto ⇒ 409 por evidencia incompleta y no materializa', async () => {
  const root = tempRoot('lsc-r161-mat-incomplete');
  const project = tempProject('incompleto', tempRoot('lsc-r161-mat-incomplete-work'));
  const registered = runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  const partial = fakeSkills([], { complete: false });
  const evidence = await measureEvidence({ root, cwd: project, skills: partial });
  assert.equal(evidence.inventory.sources.find((row) => row.id === 'skills-registry')?.status, 'incomplete');
  const centerBefore = fileDigest(centerFile(root));

  const response = await postAction({
    root,
    body: { action: 'materialize-project', payload: { projectId: registered.project.id } },
    hostCwd: project,
    ...evidence,
  });
  assert.equal(response.status, 409, JSON.stringify(response.body).slice(0, 400));
  assert.ok(response.body.findings.some((item) => item.code === 'evidence-incomplete' && item.severity === 'block'));
  assert.equal(fileDigest(centerFile(root)), centerBefore);
  assert.equal(existsSync(join(root, 'materialized', registered.project.id)), false);
});

test('R16.1: importar pasa por el preflight con evidencia real; sin catálogo avisa y nunca escribe el origen', async () => {
  const root = tempRoot('lsc-r161-import');
  const project = tempProject('importable', tempRoot('lsc-r161-import-work'));
  runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  const source = join(project, '.dsh', 'skills', 'skill-a-importar', 'SKILL.md');
  const body = [
    '## Procedimiento',
    '',
    'Lee el fichero de origen, comprueba que su cabecera tiene nombre, descripción y situación de uso, y',
    'copia el contenido a la biblioteca del centro sin tocar el original. Después verifica que el id no',
    'colisiona con otra skill y deja constancia de la ruta importada en la respuesta para poder volver.',
    '',
    '## Evidencia',
    '',
    'La respuesta del centro cita la ruta de origen y el id creado; el hash del fichero de origen no cambia.',
  ].join('\n');
  writeSkill(join(project, '.dsh', 'skills'), 'skill-a-importar', { body });
  const originBefore = fileDigest(source);
  const evidence = await measureEvidence({ root, cwd: project, skills: null });
  const centerBefore = fileDigest(centerFile(root));

  const response = await postAction({
    root,
    body: { action: 'import', payload: { path: source } },
    hostCwd: project,
    dshHome: tempRoot('lsc-r161-import-dsh'),
    ...evidence,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 400));
  assert.equal(response.body.ok, true);
  assert.ok(response.body.findings.some((item) => item.code === 'catalog-unverified' && item.severity === 'warn'));
  assert.notEqual(fileDigest(centerFile(root)), centerBefore, 'importar escribe en el centro');
  assert.equal(fileDigest(source), originBefore, 'importar jamás escribe el fichero de origen');
});

test('R16.1: el adaptador mide el catálogo ANTES de despachar las cinco acciones con compuerta', async () => {
  const root = tempRoot('lsc-r161-order');
  const project = tempProject('orden', tempRoot('lsc-r161-order-work'));
  const dshHome = tempRoot('lsc-r161-order-dsh');
  runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  const skill = runAction({ root, action: 'create', payload: candidate(), actor: 'human', now: NOW });
  runAction({ root, action: 'evaluate', payload: { skillId: skill.id }, actor: 'human', now: NOW });
  writeSkill(join(project, '.dsh', 'skills'), 'importable-uno');

  // `ctx` mínimo del harness: servicio de skills espiado, loader, sesión con cwd y ruta registrada.
  const observed = [];
  const skills = {
    snapshot: async () => {
      observed.push(fileDigest(centerFile(root)));
      return { skills: [], complete: true };
    },
  };
  const routes = [];
  const browserPeer = { id: 'peer-navegador', principal: { kind: 'owner' } };
  const ctx = {
    get: (key) => ({
      skills,
      loader: { entries: () => [] },
      workingDirectory: { get: () => project },
      agents: { list: () => [{ session: { id: 'sesion-orden' }, cwd: project }] },
      connection: { browserPeer, admit: () => ({ peer: browserPeer }) },
    })[key],
    systemPrompt: { section: () => {} },
    tools: { register: () => {} },
    skills: { registerProvider: (callback) => callback({ invalidate: () => {} }) },
    effect: (callback) => { callback(); },
    inject: (services, callback) => callback({ webServer: { register: (route) => { routes.push(route); return () => {}; }, getOrigin: () => 'http://127.0.0.1:1' } }),
    logger: { info: () => {} },
  };
  applyPlugin(ctx, { root, dshHome });

  const dispatch = async (body) => {
    observed.length = 0;
    const before = fileDigest(centerFile(root));
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const listeners = new Map();
    const req = {
      method: 'POST',
      url: `${API_PREFIX}`,
      headers: { cookie: 'dsh-auth-prueba=1' },
      on(event, callback) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(callback);
        return req;
      },
    };
    const res = {
      statusCode: 0,
      payload: '',
      setHeader() {},
      end(value = '') { this.payload = String(value); },
    };
    const done = new Promise((resolve) => {
      const original = res.end.bind(res);
      res.end = (value = '') => { original(value); resolve(); };
    });
    routes[routes.length - 1].handler(req, res);
    for (const callback of listeners.get('data') ?? []) callback(payload);
    for (const callback of listeners.get('end') ?? []) callback();
    await done;
    assert.equal(observed.length > 0, true, `«${body.action}» midió el catálogo antes de despachar`);
    assert.equal(observed[0], before, `«${body.action}» midió el catálogo antes de la primera escritura`);
    return { status: res.statusCode, body: JSON.parse(res.payload) };
  };

  const created = await dispatch({ action: 'create', payload: candidate({ id: 'creada-por-http-r161' }) });
  assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 300));
  const published = await dispatch({
    action: 'publish',
    payload: { id: skill.id, body: `${candidate().body}\n\n## Evidencia\n\nPruebas en verde.` },
  });
  assert.equal(published.status, 200, JSON.stringify(published.body).slice(0, 300));
  const toggled = await dispatch({ action: 'toggle', payload: { projectId: projectIdFor(project), skillId: skill.id, enabled: true } });
  assert.equal(toggled.status, 200, JSON.stringify(toggled.body).slice(0, 300));
  const materialized = await dispatch({ action: 'materialize-project', payload: { projectId: projectIdFor(project) } });
  assert.equal(materialized.status, 200, JSON.stringify(materialized.body).slice(0, 300));
  const imported = await dispatch({ action: 'import', payload: { path: join(project, '.dsh', 'skills', 'importable-uno', 'SKILL.md') } });
  assert.equal(imported.status, 200, JSON.stringify(imported.body).slice(0, 300));
});

test('R16.2: capabilities se sirve sin servicios y anuncia el contrato 2', () => {
  const root = tempRoot('lsc-r162-api-cap');
  const response = handleApiRequest({
    root,
    method: 'GET',
    pathname: `${API_PREFIX}/capabilities`,
    search: '',
    hostCwd: '',
    now: NOW,
    pluginVersion: '1.2.3',
    implementation: 'r16.2',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.kind, 'capabilities');
  assert.equal(response.body.apiVersion, 1);
  assert.equal(response.body.contractVersion, API_CONTRACT_VERSION);
  assert.equal(response.body.plugin.id, 'lifecode-skill-center');
  assert.equal(response.body.plugin.version, '1.2.3');
  assert.deepEqual(response.body.capabilities, CAPABILITY_IDS);
  assert.ok(response.body.capabilities.includes('activity'), 'R17: la actividad forma parte del contrato anunciado');
  assert.equal(response.body.routes['GET /api/activity'], 'activity');
  assert.equal(response.body.contract.prefix, API_PREFIX);
  assert.equal(existsSync(centerFile(root)), false, 'el handshake no crea almacén');
});

test('R16.2: inventory y projects anuncian contractVersion 2 sin perder apiVersion 1', async () => {
  const root = tempRoot('lsc-r162-api-cv');
  const project = tempProject('contrato', tempRoot('lsc-r162-api-cv-work'));
  const registry = {
    list: () => [{ id: 'ws-cv', path: project, title: 'contrato', sessionIds: [], status: async () => 'ok' }],
  };
  const inventory = await inventoryPayload({ root, registry, skills: fakeSkills(), loader: fakeLoader(), hostCwd: project, now: NOW });
  assert.equal(inventory.status, 200, JSON.stringify(inventory.body).slice(0, 300));
  assert.equal(inventory.body.apiVersion, 1);
  assert.equal(inventory.body.contractVersion, 2);

  runAction({ root, action: 'register-project', actor: 'human', cwd: project, now: NOW });
  const projects = await projectsPayload({ root, registry, skills: fakeSkills(), loader: fakeLoader(), hostCwd: project, now: NOW });
  assert.equal(projects.status, 200, JSON.stringify(projects.body).slice(0, 300));
  assert.equal(projects.body.apiVersion, 1);
  assert.equal(projects.body.contractVersion, 2);
  assert.equal(projects.body.ok, true);
});

test('métricas: byOwner usa las cinco categorías y su suma es el total (R16.3 §2)', () => {
  const entries = [
    ...Array.from({ length: 73 }, (_, index) => ({ name: `fs-${index}`, owner: { kind: 'filesystem' } })),
    ...Array.from({ length: 4 }, (_, index) => ({ name: `own-${index}`, owner: { kind: 'lifecode' } })),
    ...Array.from({ length: 4 }, (_, index) => ({ name: `ext-${index}`, owner: { kind: 'plugin' } })),
    ...Array.from({ length: 4 }, (_, index) => ({ name: `builtin-${index}`, owner: { kind: 'bundled' } })),
  ];
  assert.equal(entries.length, 85);
  const counts = countOwners(entries);
  assert.deepEqual(Object.keys(counts).sort(), ['external', 'filesystem', 'host', 'own', 'unknown']);
  assert.deepEqual(counts, { own: 4, external: 4, filesystem: 73, host: 4, unknown: 0 });
  const sum = counts.own + counts.external + counts.filesystem + counts.host + counts.unknown;
  assert.equal(sum, entries.length, 'la suma de categorías es el total, sin doble conteo');

  const withUnknown = countOwners([
    ...entries,
    { name: 'rara', owner: { kind: 'proveedor-no-conocido' } },
    { name: 'del-host', owner: { kind: 'host' } },
  ]);
  assert.equal(withUnknown.unknown, 1, 'un kind que no conocemos es evidencia insuficiente, no una categoría inventada');
  assert.equal(withUnknown.host, 5, 'host incluye el builtin del Host y el catálogo sin proveedor');
  assert.equal(withUnknown.own, 4, 'unknown nunca se suma a own');
  assert.equal(withUnknown.external, 4, 'bundled es del Host, no de un plugin externo');
  assert.equal(
    withUnknown.own + withUnknown.external + withUnknown.filesystem + withUnknown.host + withUnknown.unknown,
    87,
  );
});
