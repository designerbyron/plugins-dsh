/**
 * R16 — E2E simulado del ciclo completo en una caja temporal.
 *
 * Recorre el flujo del contrato con un Host de mentira (registro de workspaces + catálogo + directorio de
 * la sesión) y efectos reales sobre el almacén temporal: descubrir → preflight → registrar → ficha →
 * intentar materializar con colisión (bloquea y no escribe) → permitir → comprobar la vista materializada.
 *
 * La ficha se comprueba en el dominio (`buildProjectDetail`) y por la API (`inspect-project`), que debe
 * devolver el mismo `state` que la lista y 404 cuando el proyecto no está registrado.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApiRequest } from '../lib/api.mjs';
import { loadState } from '../lib/state.mjs';
import { detectCollisions } from '../lib/collisions.mjs';
import { preflight } from '../lib/preflight.mjs';
import { buildProjectDetail } from '../lib/projects.mjs';
import { candidate, tempProject } from './helpers.mjs';

const BASE = '/lifecode-skill-center/api';
const temporary = [];
function sandbox(label) {
  const dir = mkdtempSync(join(tmpdir(), `lsc-r16-e2e-${label}-`));
  temporary.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

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

function hostFixture(project) {
  const workspaces = [{ id: 'ws-1', path: project, title: 'proyecto', sessionIds: [], status: async () => 'ok' }];
  return {
    registry: { list: () => workspaces, get: (id) => workspaces.find((row) => row.id === id) },
    skills: {
      registerProvider() {},
      snapshot: async () => ({ skills: [candidate({ id: 'skill-publicada' })], complete: true, cwd: project }),
    },
    workspaces,
  };
}

const EMPTY_COLLISIONS = { collisions: [], ambiguousNames: [], byKey: new Map() };
const HOST_SOURCES = { sources: [{ id: 'skills-registry', status: 'complete', reason: 'snapshot del Host' }] };

function api(root, host, method, path, body = null) {
  return handleApiRequest({
    root,
    dshHome: join(root, '..', 'dsh-e2e'),
    agentsHome: join(root, '..', 'agents-e2e'),
    method,
    pathname: `${BASE}${path}`,
    search: '',
    body,
    registry: host.registry,
    skills: host.skills,
    hostCwd: host.workspaces[0].path,
    hostSources: HOST_SOURCES,
    inventory: { entries: [], sources: [{ id: 'skills-registry', status: 'complete', reason: 'snapshot del Host' }], complete: true },
    collisions: EMPTY_COLLISIONS,
  });
}

function entry(overrides) {
  return {
    key: `k-${Math.random().toString(36).slice(2, 8)}`,
    name: 'skill-en-colision',
    canonicalName: 'skill-en-colision',
    owner: { kind: 'filesystem', provider: 'disco' },
    origin: { kind: 'filesystem' },
    location: { kind: 'file', path: 'C:/uno/skill-en-colision/SKILL.md', directory: 'C:/uno/skill-en-colision', rootId: 'user-dsh' },
    scope: { kind: 'user' },
    association: { loadedByHost: false },
    identity: { uuid: null, contentSha256: null },
    ...overrides,
  };
}

test('E2E: descubrir → preflight → registrar → ficha → colisión bloquea sin escribir → permitir → materializar', async () => {
  const store = sandbox('store');
  const project = tempProject('proyecto-e2e', sandbox('work'));
  writeFileSync(join(project, 'LEEME.txt'), 'no tocar');
  const projectHash = treeHash(project);
  const host = hostFixture(project);

  // 1. Descubrir no registra nada.
  const discovered = await api(store, host, 'GET', '/projects');
  assert.equal(discovered.status, 200);
  assert.equal(discovered.body.discovered.length, 1);
  assert.equal(discovered.body.projects.length, 0);
  assert.equal(existsSync(join(store, 'center.json')), false);

  // 2. Preflight del registro: estado + proyecto en disco ⇒ allow.
  const source = (id) => ({ id, status: 'complete' });
  const gate = preflight({
    action: 'register-project',
    state: {},
    sources: [source('state'), source('filesystem-project'), source('manifest'), source('workspace-registry')],
  });
  assert.equal(gate.decision, 'allow');

  // 3. Registrar.
  const registered = await api(store, host, 'POST', '', { action: 'register-project', cwd: project });
  assert.equal(registered.status, 200);
  const id = registered.body.project.id;
  const listing = await api(store, host, 'GET', '/projects');
  const summary = listing.body.projects[0];
  assert.equal(summary.registration.present, true);

  // 4. Ficha en el dominio: mismo estado que la lista y secciones completas.
  const detail = buildProjectDetail({
    projectId: id,
    workspaces: host.workspaces,
    state: loadState(store).state,
    sources: listing.body.sources,
    manifests: [{
      projectId: id,
      cwd: project,
      present: true,
      sha256: registered.body.project.manifestSha256,
      uuid: registered.body.project.uuid,
    }],
    inspections: [{ projectId: id, cwd: project, status: 'complete', inspectedAt: '2026-11-09T00:00:00.000Z' }],
    now: '2026-11-09T00:00:00.000Z',
  });
  assert.equal(detail.state, summary.state, 'lista y ficha coinciden en state');
  for (const key of ['sources', 'identity', 'assignments', 'skills', 'sessions', 'collisions', 'findings']) {
    assert.ok(key in detail, `la ficha trae ${key}`);
  }

  // 5. Materializar con una colisión real: dos versiones propias del mismo nombre ⇒ block.
  const collisionEntries = [
    entry({ key: 'm1', owner: { kind: 'lifecode', provider: 'lifecode-skill-center' }, origin: { kind: 'materialized' }, location: { kind: 'directory', path: 'C:/centro/p1/skill-en-colision', directory: 'C:/centro/p1/skill-en-colision', rootId: 'materialized' }, scope: { kind: 'project', projectId: id, cwd: project }, association: { loadedByHost: true } }),
    entry({ key: 'm2', owner: { kind: 'lifecode', provider: 'lifecode-skill-center' }, origin: { kind: 'materialized' }, location: { kind: 'directory', path: 'C:/centro/p2/skill-en-colision', directory: 'C:/centro/p2/skill-en-colision', rootId: 'materialized' }, scope: { kind: 'project', projectId: id, cwd: project }, association: { loadedByHost: true } }),
  ];
  const detected = detectCollisions({ entries: collisionEntries });
  assert.ok(detected.collisions.some((item) => item.code === 'name-collision' && item.severity === 'block'));

  const blocked = await handleApiRequest({
    root: store,
    method: 'POST',
    pathname: BASE,
    search: '',
    body: { action: 'materialize-project', projectId: id, skillId: 'skill-en-colision' },
    registry: host.registry,
    skills: host.skills,
    hostCwd: project,
    hostSources: HOST_SOURCES,
    inventory: { entries: [], sources: [{ id: 'skills-registry', status: 'complete', reason: 'snapshot del Host' }], complete: true },
    collisions: detected,
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.ok, false);
  assert.equal(blocked.body.code, 'preflight-blocked');
  assert.ok(blocked.body.reasons.length > 0, 'un bloqueo explica por qué');
  assert.ok(blocked.body.findings.some((item) => item.code === 'name-collision' && item.severity === 'block'), 'el bloqueo es por la colisión, no por otra cosa');
  assert.equal(existsSync(join(store, 'materialized', id)), false, 'bloqueado NO escribe la vista');

  // 6. Permitir: sin colisiones, la materialización ocurre de verdad.
  const allowed = await api(store, host, 'POST', '', { action: 'materialize-project', projectId: id });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.ok, true);
  const view = join(store, 'materialized', id);
  assert.equal(existsSync(view), true, 'la vista existe tras permitir');
  const written = allowed.body.materialized.written;
  assert.ok(Array.isArray(written) ? written.length >= 1 : written >= 1);
  assert.equal(treeHash(project), projectHash, 'materializar no toca el proyecto de origen');
});

test('la ficha por API (inspect-project) sirve el mismo ProjectDetail y 404 si no existe', async () => {
  const store = sandbox('store');
  const project = tempProject('proyecto-ficha', sandbox('work'));
  const host = hostFixture(project);
  const registered = await api(store, host, 'POST', '', { action: 'register-project', cwd: project });
  const id = registered.body.project.id;
  const listed = await api(store, host, 'GET', '/projects');
  const summary = listed.body.projects.find((row) => row.projectId === id);

  const response = await api(store, host, 'POST', '', { action: 'inspect-project', projectId: id });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.projectId, id);
  assert.equal(response.body.project.projectId, id);
  assert.equal(response.body.project.state, summary.state, 'la ficha no contradice a la lista');
  assert.equal(response.body.project.sessions?.count, null, 'sesiones no contadas: null, nunca 0');

  const missing = await api(store, host, 'POST', '', { action: 'inspect-project', projectId: 'no-existe-0000' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'project-not-found');
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
