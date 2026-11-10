#!/usr/bin/env node
/**
 * R16 — E2E de efectos reales con un Host de mentira.
 *
 * Recorre el flujo del contrato sobre un almacén temporal y un proyecto temporal:
 *   descubrir → preflight → registrar → inspeccionar/ficha → materializar con colisión (bloquea)
 *   → comprobar que no se escribió → permitir → comprobar materializado.
 *
 * Imprime PASS/FAIL por paso, un hash del almacén al final y sale con código real (0 si todo lo
 * verificable pasa; 1 si algo falla). El paso `inspect-project` se marca SKIP: el producto no lo
 * implementa (defecto abierto), y se declara en la salida en lugar de fingir que pasó.
 *
 * Uso: node tools/r16-e2e.mjs
 * No lee ni escribe el almacén real: todo vive en el directorio temporal que imprime al final.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApiRequest } from '../lib/api.mjs';
import { loadState } from '../lib/state.mjs';
import { detectCollisions } from '../lib/collisions.mjs';
import { preflight } from '../lib/preflight.mjs';
import { buildProjectDetail } from '../lib/projects.mjs';

const API = '/lifecode-skill-center/api';
const results = [];

function pass(step, detail = '') {
  results.push({ step, status: 'PASS', detail });
  console.log(`PASS  ${step}${detail ? ` — ${detail}` : ''}`);
}
function fail(step, detail = '') {
  results.push({ step, status: 'FAIL', detail });
  console.log(`FAIL  ${step}${detail ? ` — ${detail}` : ''}`);
}
function skip(step, detail = '') {
  results.push({ step, status: 'SKIP', detail });
  console.log(`SKIP  ${step}${detail ? ` — ${detail}` : ''}`);
}
function check(step, condition, detail) {
  if (condition) pass(step, detail);
  else fail(step, detail);
  return Boolean(condition);
}

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
  return `${files.length} ficheros, sha256 ${hash.digest('hex')}`;
}

const sandbox = mkdtempSync(join(tmpdir(), 'lsc-r16-e2e-'));
const store = join(sandbox, 'store');
const dshHome = join(sandbox, 'dsh');
const agentsHome = join(sandbox, 'agents');
const project = join(sandbox, 'proyecto');
mkdirSync(store, { recursive: true });
mkdirSync(project, { recursive: true });
writeFileSync(join(project, 'LEEME.txt'), 'contenido del usuario que no se toca\n');
writeFileSync(join(dshHome, '..', 'placeholder'), '');
const projectHashBefore = treeHash(project);

const workspaces = [{ id: 'ws-1', path: project, title: 'proyecto', sessionIds: [], status: async () => 'ok' }];
const registry = { list: () => workspaces, get: (id) => workspaces.find((row) => row.id === id) };
const skills = {
  registerProvider() {},
  snapshot: async () => ({ skills: [], complete: true, cwd: project }),
};

const EMPTY_COLLISIONS = { collisions: [], ambiguousNames: [], byKey: new Map() };
const HOST_SOURCES = { sources: [{ id: 'skills-registry', status: 'complete', reason: 'snapshot del Host' }] };

function api(method, path, body = null, extra = {}) {
  return handleApiRequest({
    root: store,
    dshHome,
    agentsHome,
    method,
    pathname: `${API}${path}`,
    search: '',
    body,
    registry,
    skills,
    hostCwd: project,
    inventory: { entries: [], sources: [{ id: 'skills-registry', status: 'complete', reason: 'snapshot del Host' }], complete: true },
    hostSources: HOST_SOURCES,
    collisions: EMPTY_COLLISIONS,
    ...extra,
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

console.log(`R16 E2E — caja ${sandbox}\n`);
const storeBefore = treeHash(store);

// 1. Descubrir: lee y no registra ni escribe.
const discovery = await api('GET', '/projects');
const discoveryOk = discovery.status === 200
  && discovery.body.discovered.length === 1
  && discovery.body.projects.length === 0;
check('1/9 descubrir no registra ni escribe', discoveryOk, `status ${discovery.status}, discovered ${discovery.body?.discovered?.length}, projects ${discovery.body?.projects?.length}`);

// 2. Preflight del registro.
const source = (id) => ({ id, status: 'complete' });
const gate = preflight({
  action: 'register-project',
  state: {},
  sources: [source('state'), source('filesystem-project'), source('manifest'), source('workspace-registry')],
});
check('2/9 preflight register-project permite con fuentes completas', gate.decision === 'allow', `decision ${gate.decision}`);

// 3. Registrar.
const registered = await api('POST', '', { action: 'register-project', cwd: project });
const projectId = registered.body?.project?.id;
check(
  '3/9 registrar crea el proyecto con uuid y manifiesto',
  registered.status === 200 && registered.body?.ok === true && /^[0-9a-f]{64}$/.test(registered.body?.project?.manifestSha256 ?? ''),
  `status ${registered.status}, projectId ${projectId}`,
);

// 4. Lista + ficha del dominio.
const listing = await api('GET', '/projects');
const summary = listing.body?.projects?.[0];
const detail = summary
  ? buildProjectDetail({
    projectId: summary.projectId,
    workspaces,
    state: loadState(store).state,
    sources: listing.body.sources,
    manifests: [{ projectId: summary.projectId, cwd: project, present: true, sha256: registered.body.project.manifestSha256, uuid: registered.body.project.uuid }],
    inspections: [{ projectId: summary.projectId, cwd: project, status: 'complete', inspectedAt: new Date().toISOString() }],
  })
  : null;
check(
  '4/9 ficha del dominio coincide con la lista',
  Boolean(detail) && detail.state === summary.state && Array.isArray(detail.assignments) && 'sessions' in detail,
  detail ? `state ${detail.state}, sessions.count ${JSON.stringify(detail.sessions?.count)}` : 'sin ficha',
);

// 5. Ficha por API: ProjectDetail completo y 404 honesto si el proyecto no existe.
const inspected = await api('POST', '', { action: 'inspect-project', projectId });
const notFound = await api('POST', '', { action: 'inspect-project', projectId: 'no-existe-0000' });
check(
  '5/9 ficha por API (inspect-project) con 404 project-not-found',
  inspected.status === 200
    && inspected.body?.ok === true
    && inspected.body?.projectId === projectId
    && inspected.body?.project?.projectId === projectId
    && inspected.body?.project?.state === summary?.state
    && notFound.status === 404
    && notFound.body?.code === 'project-not-found',
  `status ${inspected.status}, state ${inspected.body?.project?.state}; 404 ${notFound.status} ${notFound.body?.code ?? '—'}`,
);

// 6. Materializar con colisión: debe bloquear.
const collisionEntries = [
  entry({ key: 'm1', owner: { kind: 'lifecode', provider: 'lifecode-skill-center' }, origin: { kind: 'materialized' }, location: { kind: 'directory', path: 'C:/centro/p1/skill-en-colision', directory: 'C:/centro/p1/skill-en-colision', rootId: 'materialized' }, scope: { kind: 'project', projectId, cwd: project }, association: { loadedByHost: true } }),
  entry({ key: 'm2', owner: { kind: 'lifecode', provider: 'lifecode-skill-center' }, origin: { kind: 'materialized' }, location: { kind: 'directory', path: 'C:/centro/p2/skill-en-colision', directory: 'C:/centro/p2/skill-en-colision', rootId: 'materialized' }, scope: { kind: 'project', projectId, cwd: project }, association: { loadedByHost: true } }),
];
const detected = detectCollisions({ entries: collisionEntries });
const blocked = await api('POST', '', { action: 'materialize-project', projectId, skillId: 'skill-en-colision' }, { collisions: detected });
check(
  '6/9 materializar con name-collision block ⇒ 409 preflight-blocked',
  blocked.status === 409
    && blocked.body?.ok === false
    && blocked.body?.code === 'preflight-blocked'
    && Array.isArray(blocked.body?.reasons) && blocked.body.reasons.length > 0
    && Array.isArray(blocked.body?.findings)
    && blocked.body.findings.some((item) => item.code === 'name-collision' && item.severity === 'block'),
  `status ${blocked.status}, code ${blocked.body?.code}, findings ${JSON.stringify((blocked.body?.findings ?? []).map((item) => `${item.code}:${item.severity}`))}`,
);

// 7. No se escribió nada.
const view = join(store, 'materialized', projectId);
check('7/9 el bloqueo no escribió la vista materializada', !existsSync(view), existsSync(view) ? `existe ${view}` : 'no existe');

// 8. Permitir y materializar.
const allowed = await api('POST', '', { action: 'materialize-project', projectId });
const writtenCount = Array.isArray(allowed.body?.materialized?.written) ? allowed.body.materialized.written.length : Number(allowed.body?.materialized?.written ?? 0);
check(
  '8/9 al quitar el bloqueo la vista se materializa',
  allowed.status === 200 && allowed.body?.ok === true && Number.isFinite(writtenCount) && writtenCount >= 1 && existsSync(view),
  `status ${allowed.status}, escrito ${writtenCount} fichero(s)`,
);

// 9. El proyecto de origen no cambió.
check('9/9 el proyecto externo sigue idéntico', treeHash(project) === projectHashBefore, projectHashBefore);

console.log(`\nHash del almacén temporal antes: ${storeBefore}`);
console.log(`Hash del almacén temporal ahora: ${treeHash(store)}`);
console.log(`Caja temporal: ${sandbox}`);

const failures = results.filter((row) => row.status === 'FAIL');
const skips = results.filter((row) => row.status === 'SKIP');
console.log(`\nResultado: ${results.length - failures.length - skips.length}/${results.length} PASS, ${skips.length} SKIP, ${failures.length} FAIL`);
if (failures.length > 0) {
  console.log('Fallos:');
  for (const row of failures) console.log(`  - ${row.step}: ${row.detail}`);
}
process.exitCode = failures.length === 0 ? 0 : 1;
