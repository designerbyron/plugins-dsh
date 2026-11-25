/**
 * Worker de concurrencia real (P1). Cada proceso abre el MISMO registry de laboratorio y ejecuta una
 * sola operación. No hay mocks de concurrencia: son procesos Node independientes compitiendo por el
 * mismo SQLite.
 */

import { openRegistry, closeRegistry } from '../../lib/registry.mjs';
import { pathKeyFor } from '../../lib/registry.mjs';
import { applyTracking } from '../../lib/tracking-store.mjs';
import { beginOperation } from '../../lib/operations.mjs';
import { openProvisionIntent } from '../../lib/provision-store.mjs';
import {
  moveWorkspaceMemory, provisionWorkspaceMemory, recoverLifecycle, revokeReadAccess,
} from '../../lib/lifecycle.mjs';
import { createSyncScheduler } from '../../lib/sync-scheduler.mjs';
import { loadConfig } from '../../lib/paths.mjs';

const args = JSON.parse(process.argv[2] ?? '{}');
const T = 1_700_000_000_000;
const silent = { warn() {}, debug() {}, error() {}, info() {} };

function out(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(error) {
  out({
    ok: false,
    code: error?.code ?? 'internal',
    message: error?.message ?? String(error),
    details: error?.details ?? null,
  });
  process.exitCode = 1;
}

const registry = openRegistry({ root: args.root, create: false, now: T });
const { db } = registry;
try {
  if (args.command === 'provision') {
    const result = provisionWorkspaceMemory(db, {
      profileRoot: args.root, profileKey: args.profileKey,
      path: args.path, pathKey: pathKeyFor(args.path), expectedRevision: args.expectedRevision, now: T + 1,
    });
    out({ ok: true, projectId: result.tracking.projectId, revision: result.tracking.revision, reused: result.reused });
  } else if (args.command === 'associate') {
    const row = applyTracking(db, {
      pathKey: pathKeyFor(args.path), path: args.path, state: 'on',
      projectId: args.projectId, expectedRevision: args.expectedRevision, now: T + 1,
    });
    out({ ok: true, projectId: row.projectId, revision: row.revision });
  } else if (args.command === 'move') {
    const result = moveWorkspaceMemory(db, {
      profileRoot: args.root, profileKey: args.profileKey,
      pathKey: pathKeyFor(args.path), newPath: args.newPath,
      expectedRevision: args.expectedRevision, now: T + 2,
    });
    out({ ok: true, projectId: result.tracking.projectId, pathKey: result.tracking.pathKey });
  } else if (args.command === 'revoke') {
    const result = revokeReadAccess(db, {
      profileRoot: args.root, pathKey: pathKeyFor(args.path),
      expectedRevision: args.expectedRevision, now: T + 2,
    });
    out({
      ok: true, changed: result.changed, complete: result.complete,
      alreadyRevoked: result.alreadyRevoked === true,
    });
  } else if (args.command === 'open-provision') {
    const operation = beginOperation(db, { kind: 'provision', now: T, detail: { path_key: pathKeyFor(args.path) } });
    openProvisionIntent(db, {
      pathKey: pathKeyFor(args.path), operationId: operation.id,
      expectedRevision: args.expectedRevision, now: T,
    });
    out({ ok: true, operationId: operation.id });
    if (args.crash) process.exit(7);
  } else if (args.command === 'recover') {
    const summary = recoverLifecycle(db, {
      profileRoot: args.root, profileKey: args.profileKey, now: T + 3,
    });
    out({ ok: true, summary });
  } else if (args.command === 'drain') {
    const config = loadConfig(args.root).config;
    const scheduler = createSyncScheduler({
      env: { LIFECODE_RAG_ROOT: args.root, DSH_PROFILE: args.profileKey },
      root: args.root, config, logger: silent, now: () => T + 2,
    });
    const result = await scheduler.drain();
    out({ ok: true, results: result.results });
  } else {
    fail(new Error(`comando desconocido: ${args.command}`));
  }
} catch (error) {
  fail(error);
} finally {
  closeRegistry(db);
}
