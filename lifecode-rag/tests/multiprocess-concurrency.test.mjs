/**
 * P1 · concurrencia multiproceso REAL sobre un único registry de laboratorio.
 *
 * Cada caso lanza procesos Node independientes que compiten por el mismo SQLite. No hay mocks de
 * concurrencia: si el CAS, el índice único o la transacción fallan, se ve aquí.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createProject, closeRegistry, openRegistry,
} from '../lib/registry.mjs';
import { pathKeyFor } from '../lib/registry.mjs';
import { applyTracking, readTracking } from '../lib/tracking-store.mjs';
import { addTrustedRoot } from '../lib/trusted-roots.mjs';
import { getOperation } from '../lib/operations.mjs';
import { getProvisionIntent, getSyncRequest } from '../lib/provision-store.mjs';
import { provisionWorkspaceMemory, recoverLifecycle } from '../lib/lifecycle.mjs';

const T = 1_700_000_000_000;
const WORKER = fileURLToPath(new URL('./helpers/concurrency-worker.mjs', import.meta.url));

function makeWorld() {
  const base = mkdtempSync(join(tmpdir(), 'lcr-concurrency-'));
  const root = join(base, 'perfil');
  const ws = join(base, 'workspace');
  const other = join(base, 'otro');
  const destination = join(base, 'destino');
  for (const dir of [ws, other, destination]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(ws, 'doc.md'), '# Doc\n\n', 'utf8');
  writeFileSync(join(other, 'doc.md'), '# Doc\n\n', 'utf8');
  const { db } = openRegistry({ root, create: true, now: T });
  return {
    base, root, ws, other, destination, db, profileKey: 'concurrency-test',
    close() { closeRegistry(db); },
    cleanup() { rmSync(base, { recursive: true, force: true }); },
    row(path = ws) {
      return applyTracking(db, {
        pathKey: pathKeyFor(path), path, state: 'on', projectId: null, expectedRevision: 0, now: T,
      });
    },
    provision(path = ws, expectedRevision = 1) {
      return provisionWorkspaceMemory(db, {
        profileRoot: root, profileKey: this.profileKey, path,
        pathKey: pathKeyFor(path), expectedRevision, now: T + 1,
      });
    },
  };
}

function runWorker(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER, JSON.stringify(args)], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      let json = null;
      try { json = lines.length ? JSON.parse(lines[lines.length - 1]) : null; } catch { json = null; }
      resolve({ code, json, stdout, stderr });
    });
  });
}

test('dos procesos provisionan el mismo workspace: una identidad y un almacén', async () => {
  const world = makeWorld();
  try {
    world.row();
    const base = { command: 'provision', root: world.root, profileKey: world.profileKey, path: world.ws, expectedRevision: 1 };
    const [first, second] = await Promise.all([runWorker(base), runWorker({ ...base })]);
    assert.ok([first, second].some((result) => result.json?.ok === true), `${first.stdout} ${second.stdout}`);
    assert.ok([first, second].some((result) => result.json?.code === 'revision-conflict'
      || result.json?.ok === true), 'el segundo puede reintentar sin corromper');
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM roots').get().n, 1);
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM workspace_tracking').get().n, 1);
    const row = readTracking(world.db, { pathKey: pathKeyFor(world.ws) });
    assert.equal(row.association, 'explicit');
    assert.match(row.projectId, /^prj_/);
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM provision_intents WHERE state = 'done'").get().n, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('dos procesos asocian el mismo project_id a workspaces distintos: sólo uno gana', async () => {
  const world = makeWorld();
  try {
    const project = createProject(world.db, { name: 'Proyecto', now: T });
    world.row(world.ws);
    world.row(world.other);
    const [first, second] = await Promise.all([
      runWorker({
        command: 'associate', root: world.root, profileKey: world.profileKey,
        path: world.ws, projectId: project.id, expectedRevision: 1,
      }),
      runWorker({
        command: 'associate', root: world.root, profileKey: world.profileKey,
        path: world.other, projectId: project.id, expectedRevision: 1,
      }),
    ]);
    const winners = world.db.prepare('SELECT path_key FROM workspace_tracking WHERE project_id = ?').all(project.id);
    assert.equal(winners.length, 1, `${first.stdout} ${second.stdout}`);
    assert.ok([first, second].some((result) => result.json?.ok === true));
    assert.ok([first, second].some((result) => result.json?.code === 'memory-exclusive'
      || result.json?.code === 'revision-conflict'));
  } finally {
    world.close();
    world.cleanup();
  }
});

test('dos procesos mueven el mismo workspace: un rebind y una revisión coherente', async () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.row();
    const provisioned = world.provision();
    const args = {
      command: 'move', root: world.root, profileKey: world.profileKey,
      path: world.ws, newPath: world.destination, expectedRevision: provisioned.tracking.revision,
    };
    const [first, second] = await Promise.all([runWorker(args), runWorker({ ...args })]);
    const rows = world.db.prepare('SELECT path_key, project_id, revision FROM workspace_tracking').all();
    assert.equal(rows.length, 1, `${first.stdout} ${second.stdout}`);
    assert.equal(rows[0].path_key, pathKeyFor(world.destination));
    assert.equal(rows[0].project_id, provisioned.tracking.projectId);
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM roots').get().n, 1);
    assert.ok([first, second].some((result) => result.json?.ok === true));
    // El segundo puede llegar después del rebind y reutilizar (idempotente), chocar con el CAS o
    // perder el preflight del destino (`move-conflict`); todos son resultados legítimos.
    assert.ok([first, second].every((result) => result.json?.ok === true
      || result.json?.code === 'revision-conflict' || result.json?.code === 'not-found'
      || result.json?.code === 'move-conflict'));
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE state = 'started'").get().n, 0,
      'ninguna operación queda abierta: el journal no miente');
    assert.equal(world.db.prepare("SELECT COUNT(*) AS n FROM provision_intents WHERE state = 'open'").get().n, 0,
      'ninguna intención queda abierta apuntando a un perdedor');
    const destinationIntent = getProvisionIntent(world.db, pathKeyFor(world.destination));
    assert.equal(destinationIntent.state, 'done', 'la intención destino es la del ganador, cerrada');
    assert.ok(destinationIntent.consentRootId, 'conserva la procedencia del acto que sí movió');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('una operación antigua pierde contra una revisión humana posterior', async () => {
  const world = makeWorld();
  try {
    world.row();
    const opened = await runWorker({
      command: 'open-provision', root: world.root, profileKey: world.profileKey,
      path: world.ws, expectedRevision: 1,
    });
    assert.equal(opened.json?.ok, true, opened.stderr);
    applyTracking(world.db, {
      pathKey: pathKeyFor(world.ws), path: world.ws, state: 'paused', expectedRevision: 1, now: T + 2,
    });
    const summary = recoverLifecycle(world.db, { profileRoot: world.root, profileKey: world.profileKey, now: T + 3 });
    assert.equal(summary.abandoned, 1);
    assert.equal(getProvisionIntent(world.db, pathKeyFor(world.ws)).state, 'abandoned');
    assert.equal(getOperation(world.db, opened.json.operationId).state, 'failed');
    assert.equal(readTracking(world.db, { pathKey: pathKeyFor(world.ws) }).projectId, null);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('dos procesos drenan la misma cola: un solo trabajo', async () => {
  const world = makeWorld();
  try {
    world.row();
    const provisioned = world.provision();
    const args = { command: 'drain', root: world.root, profileKey: world.profileKey };
    const [first, second] = await Promise.all([runWorker(args), runWorker({ ...args })]);
    const request = getSyncRequest(world.db, { scopeKind: 'prj', scopeId: provisioned.tracking.projectId });
    assert.equal(request.state, 'done');
    const syncOperations = world.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind = 'sync'").get().n;
    assert.equal(syncOperations, 1, `${first.stdout} ${second.stdout}`);
    assert.equal([first, second].filter((result) => result.json?.ok === true).length, 2,
      'ambos procesos terminan sin corromper la cola');
  } finally {
    world.close();
    world.cleanup();
  }
});

test('un proceso muere durante la operación y el otro recupera el estado', async () => {
  const world = makeWorld();
  try {
    world.row();
    const crashed = await runWorker({
      command: 'open-provision', root: world.root, profileKey: world.profileKey,
      path: world.ws, expectedRevision: 1, crash: true,
    });
    assert.equal(crashed.code, 7);
    const recovered = await runWorker({
      command: 'recover', root: world.root, profileKey: world.profileKey,
    });
    assert.equal(recovered.json?.ok, true, recovered.stderr);
    const row = readTracking(world.db, { pathKey: pathKeyFor(world.ws) });
    assert.equal(row.association, 'explicit');
    assert.match(row.projectId, /^prj_/);
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM roots').get().n, 1);
  } finally {
    world.close();
    world.cleanup();
  }
});

test('dos procesos revocan el mismo consentimiento: una sola revocación efectiva', async () => {
  const world = makeWorld();
  try {
    addTrustedRoot(world.db, { path: world.base, readAuthorization: true, addedBy: 'human', now: T });
    world.row();
    const provisioned = world.provision();
    const args = {
      command: 'revoke', root: world.root, profileKey: world.profileKey,
      path: world.ws, expectedRevision: provisioned.tracking.revision,
    };
    const [first, second] = await Promise.all([runWorker(args), runWorker({ ...args })]);
    assert.ok([first, second].some((result) => result.json?.ok === true), `${first.stdout} ${second.stdout}`);
    assert.ok([first, second].some((result) => result.json?.alreadyRevoked === true
      || result.json?.changed === true));
    assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM roots').get().n, 0);
    assert.equal(getProvisionIntent(world.db, pathKeyFor(world.ws)).revokedAt !== null, true);
  } finally {
    world.close();
    world.cleanup();
  }
});
