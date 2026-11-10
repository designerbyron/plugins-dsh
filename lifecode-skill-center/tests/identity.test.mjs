import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempRoot, autonomyRoot } from './helpers.mjs';
import { centerFile, emptyState } from '../lib/state.mjs';
import {
  AUDIT,
  IDENTITY_STATES,
  INVENTORY,
  OPERATIONS,
  REASONS,
  STATE_PRECEDENCE,
  UNIQUENESS,
  VERIFICATION,
  buildIdentityView,
  classifyWorkspace,
  countStates,
  identityActionGate,
  inventoryStatus,
} from '../lib/identity.mjs';

const { equal, ok } = assert;

/** Una ruta de workspace sintética: estas pruebas no tocan disco. */
const PATH_A = 'C:/xampp/htdocs/alfa';
const PATH_B = 'C:/xampp/htdocs/beta';
const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const HASH_1 = 'a'.repeat(64);
const HASH_2 = 'b'.repeat(64);

const manifestOk = (projectId = UUID_1, sha256 = HASH_1) => ({ status: 'ok', projectId, sha256 });
const recordFor = (overrides = {}) => ({
  id: 'alfa-1234abcd',
  cwd: PATH_A,
  uuid: UUID_1,
  manifestSha256: HASH_1,
  manifestRegisteredAt: '2026-11-09T00:00:00.000Z',
  ...overrides,
});
const observation = (overrides = {}) => ({
  path: PATH_A,
  record: recordFor(),
  manifest: manifestOk(),
  ...overrides,
});

test('T12 · el clasificador tiene 19 estados y su precedencia no deja huecos', () => {
  const states = Object.values(IDENTITY_STATES);
  equal(states.length, 19);
  equal(new Set(states).size, 19);
  equal(STATE_PRECEDENCE.length, 19);
  for (const state of states) ok(STATE_PRECEDENCE.includes(state), state);
});

test('T13 · un conflicto de fork gana a cualquier otro estado', () => {
  const classified = classifyWorkspace(
    observation({
      intent: { status: 'ok', newUuid: UUID_2, newManifestSha256: HASH_2, previousManifestSha256: HASH_1 },
      manifest: manifestOk(UUID_1, HASH_1),
      record: recordFor({ fork: { newUuid: UUID_2, manifestSha256: HASH_2, forkedFrom: UUID_1 } }),
    }),
    { inventory: INVENTORY.complete, uuidDuplicates: [UUID_1] },
  );
  equal(classified.identity, IDENTITY_STATES.forkConflict);
  ok(classified.reasons.includes('published-hash-differs-from-intent'));
});

test('T14 · la duplicidad de UUID sólo se afirma con inventario completo', () => {
  const complete = classifyWorkspace(observation(), { inventory: INVENTORY.complete, uuidDuplicates: [UUID_1] });
  equal(complete.identity, IDENTITY_STATES.uuidDuplicated);
  equal(complete.verification, VERIFICATION.verified);

  const incomplete = classifyWorkspace(observation(), { inventory: INVENTORY.incomplete, uuidDuplicates: [UUID_1] });
  equal(incomplete.identity, IDENTITY_STATES.linked, 'sin inventario completo no hay duplicidad demostrable');
  equal(incomplete.verification, VERIFICATION.unverified);
});

test('T15 · dos registros en la misma ruta, o un UUID que aparece en otra, son `path-conflict`', () => {
  const duplicate = classifyWorkspace(observation(), { duplicateRecords: [PATH_A.toLowerCase()] });
  equal(duplicate.identity, IDENTITY_STATES.pathConflict);
  ok(duplicate.reasons.includes(REASONS.duplicateRecordPath));

  const elsewhere = classifyWorkspace(observation({ manifest: manifestOk(UUID_2, HASH_1) }), {});
  equal(elsewhere.identity, IDENTITY_STATES.pathConflict);
  ok(elsewhere.reasons.includes(REASONS.manifestUuidElsewhere));
});

test('T16 · vinculado, adoptado y movido se distinguen por sus campos y por la ruta', () => {
  equal(classifyWorkspace(observation(), {}).identity, IDENTITY_STATES.linked);
  equal(classifyWorkspace(observation({ record: recordFor({ adoptedAt: '2026-11-09T00:00:00.000Z' }) }), {}).identity, IDENTITY_STATES.adopted);

  const moved = classifyWorkspace(observation({ path: PATH_B, pathMissingConfirmed: true }), { inventory: INVENTORY.complete });
  equal(moved.identity, IDENTITY_STATES.movedManifest);
  ok(moved.reasons.includes(REASONS.oldPathConfirmedAbsent));

  const indeterminate = classifyWorkspace(observation({ path: PATH_B, oldPathIndeterminate: true }), { inventory: INVENTORY.complete });
  equal(indeterminate.identity, IDENTITY_STATES.linked);
  equal(indeterminate.verification, VERIFICATION.unverified);
  ok(indeterminate.reasons.includes(REASONS.oldPathIndeterminate));
});

test('T17 · un manifiesto inválido o ausente no se confunde con «sin identidad»', () => {
  const invalid = classifyWorkspace(observation({ manifest: { status: 'invalid' } }), { inventory: INVENTORY.complete });
  equal(invalid.identity, IDENTITY_STATES.manifestInvalid);
  equal(invalid.verification, VERIFICATION.unverified);

  const missingWithRecord = classifyWorkspace(observation({ manifest: { status: 'missing' } }), { inventory: INVENTORY.complete });
  equal(missingWithRecord.identity, IDENTITY_STATES.manifestMissing);
  ok(missingWithRecord.reasons.includes(REASONS.noManifest));

  const unmanaged = classifyWorkspace({ path: PATH_A, record: null, manifest: { status: 'missing' } }, { inventory: INVENTORY.complete });
  equal(unmanaged.identity, IDENTITY_STATES.unmanaged);

  const manifestOnly = classifyWorkspace({ path: PATH_A, record: null, manifest: manifestOk() }, { inventory: INVENTORY.complete });
  equal(manifestOnly.identity, IDENTITY_STATES.manifestOnly);

  const legacy = classifyWorkspace(observation({ record: recordFor({ uuid: '' }) }), { inventory: INVENTORY.complete });
  equal(legacy.identity, IDENTITY_STATES.legacyManifestOnly);
});

test('T18 · el fork se publica por pasos: archivado, publicado y registrado', () => {
  const forkFields = { newUuid: UUID_2, manifestSha256: HASH_2, forkedFrom: UUID_1, forkPreviousManifestSha256: HASH_1 };
  const intent = { status: 'ok', newUuid: UUID_2, newManifestSha256: HASH_2, previousManifestSha256: HASH_1 };

  const archived = classifyWorkspace(
    observation({ manifest: { status: 'missing' }, archive: { status: 'ok', sha256: HASH_1 }, intent, record: recordFor({ fork: forkFields }) }),
    { inventory: INVENTORY.complete },
  );
  equal(archived.identity, IDENTITY_STATES.forkManifestArchived);
  ok(archived.reasons.includes(REASONS.forkArchivedPresent));

  const published = classifyWorkspace(
    observation({ manifest: manifestOk(UUID_2, HASH_2), archive: { status: 'ok', sha256: HASH_1 }, intent, record: recordFor({ fork: forkFields }) }),
    { inventory: INVENTORY.complete },
  );
  equal(published.identity, IDENTITY_STATES.forkManifestPublished);

  const withMarker = classifyWorkspace(
    observation({
      manifest: manifestOk(UUID_2, HASH_2),
      archive: { status: 'ok', sha256: HASH_1 },
      marker: { status: 'ok' },
      intent,
      record: recordFor({ fork: forkFields }),
    }),
    { inventory: INVENTORY.complete },
  );
  equal(withMarker.identity, IDENTITY_STATES.forkPublished);

  const registered = classifyWorkspace(
    observation({ manifest: manifestOk(UUID_2, HASH_2), record: recordFor({ uuid: UUID_2, manifestSha256: HASH_2, forkedFrom: UUID_1, forkOperationId: 'op-1' }) }),
    { inventory: INVENTORY.complete },
  );
  equal(registered.identity, IDENTITY_STATES.forkRegistered);
});

test('T19 · una ruta que no se pudo inspeccionar no se presenta como identidad verificada', () => {
  const unknown = classifyWorkspace({ path: PATH_A, record: null, manifest: { status: 'missing' }, inspected: false, inspectionError: 'missing-dir' }, {});
  equal(unknown.identity, IDENTITY_STATES.identityUnknown);
  equal(unknown.verification, VERIFICATION.unverified);
  equal(unknown.availability, 'missing-dir');
});

test('T20 · el inventario es completo sólo si se inspeccionó todo lo conocido', () => {
  const complete = inventoryStatus({
    records: [{ cwd: PATH_A }],
    workspaces: [{ path: PATH_A }, { path: PATH_B }],
    inspectedPaths: [PATH_A, PATH_B],
  });
  equal(complete.status, INVENTORY.complete);
  equal(complete.considered, 2);

  const partial = inventoryStatus({
    records: [{ cwd: PATH_A }],
    workspaces: [{ path: PATH_A }, { path: PATH_B }],
    inspectedPaths: [PATH_A],
  });
  equal(partial.status, INVENTORY.incomplete);
  ok(partial.reasons.includes(REASONS.inventoryIncomplete));

  const failed = inventoryStatus({
    workspaces: [{ path: PATH_A }, { path: PATH_B }],
    inspectedPaths: [PATH_A, PATH_B],
    failedPaths: [PATH_B],
  });
  equal(failed.status, INVENTORY.incomplete);
});

test('T21 · la vista agrega estados, unicidad y auditoría sin inventar', () => {
  const observations = [
    observation(),
    { path: PATH_B, record: null, manifest: { status: 'missing' } },
    { path: 'C:/xampp/htdocs/gamma', record: null, manifest: { status: 'missing' } },
  ];
  const view = buildIdentityView({
    observations,
    records: [recordFor()],
    workspaces: observations.map((entry) => ({ path: entry.path })),
    inventory: { status: INVENTORY.complete, considered: 3, inspected: 3, missing: [], reasons: [] },
  });
  equal(view.items.length, 3);
  equal(view.items[0].identity, IDENTITY_STATES.linked);
  equal(view.counts[IDENTITY_STATES.linked], 1);
  equal(view.counts[IDENTITY_STATES.unmanaged], 2);
  equal(view.uniqueness.status, UNIQUENESS.unique);
  equal(view.uniqueness.duplicates.length, 0);
  equal(view.audit.status, AUDIT.ok);
  equal(countStates(view.items).unmanaged, 2);
});

test('T22 · la puerta de identidad exige v3 antes que cualquier otra condición', () => {
  const v2 = identityActionGate({ operation: OPERATIONS.link, schemaVersion: 2, requiredSchemaVersion: 3 });
  equal(v2.ok, false);
  equal(v2.code, 'migration-required');
  equal(v2.status, 409);

  const unknown = identityActionGate({ operation: 'borrar-todo', schemaVersion: 3 });
  equal(unknown.code, 'unknown-operation');

  const incomplete = identityActionGate({ operation: OPERATIONS.link, schemaVersion: 3, inventory: { status: INVENTORY.incomplete } });
  equal(incomplete.code, 'inventory-incomplete');

  const duplicated = identityActionGate({
    operation: OPERATIONS.adopt,
    schemaVersion: 3,
    inventory: { status: INVENTORY.complete },
    uniqueness: { status: UNIQUENESS.duplicated },
  });
  equal(duplicated.code, 'uuid-duplicated');
});

test('T23 · `move` y `reconcile` exigen copia previa; el resto no', () => {
  const base = {
    schemaVersion: 3,
    inventory: { status: INVENTORY.complete },
    uniqueness: { status: UNIQUENESS.unique },
    states: [],
    backupVerified: false,
  };
  equal(identityActionGate({ ...base, operation: OPERATIONS.link }).ok, true);
  equal(identityActionGate({ ...base, operation: OPERATIONS.move }).code, 'backup-required');
  equal(identityActionGate({ ...base, operation: OPERATIONS.reconcile }).code, 'backup-required');
  equal(identityActionGate({ ...base, operation: OPERATIONS.move, backupVerified: true }).ok, true);
});

test('T24 · un conflicto abierto bloquea cualquier operación de identidad', () => {
  const blocked = identityActionGate({
    operation: OPERATIONS.link,
    schemaVersion: 3,
    inventory: { status: INVENTORY.complete },
    uniqueness: { status: UNIQUENESS.unique },
    states: [IDENTITY_STATES.linked, IDENTITY_STATES.pathConflict],
  });
  equal(blocked.code, 'path-conflict');
});

/** Almacén mínimo en v3 para las pruebas de política a través de la API. */
function seedV3(label) {
  const root = autonomyRoot(`lsc-identity-${label}-`);
  mkdirSync(dirname(centerFile(root)), { recursive: true });
  const state = emptyState('2026-11-09T00:00:00.000Z');
  state.schemaVersion = 3;
  state.schemaMeta = { migratedFrom: 1, migratedAt: '2026-11-09T00:00:00.000Z' };
  writeFileSync(centerFile(root), JSON.stringify(state, null, 2), 'utf8');
  return root;
}

test('T25 · en v2 la API rechaza toda operación de identidad con 409 y sin escribir', async () => {
  const { runAction, IDENTITY_ACTIONS } = await import('../lib/api.mjs');
  const { loadState } = await import('../lib/state.mjs');
  const root = seedV3('v2');
  const state = loadState(root).state;
  state.schemaVersion = 2;
  delete state.schemaMeta;
  writeFileSync(centerFile(root), JSON.stringify(state, null, 2), 'utf8');
  const before = loadState(root).sha256;
  for (const operation of IDENTITY_ACTIONS) {
    const result = runAction({ root, action: operation, actor: 'human', payload: {} });
    equal(result.ok, false, operation);
    equal(result.code, 'migration-required', operation);
    equal(result.status, 409, operation);
    equal(result.identity.available, false, operation);
  }
  equal(loadState(root).sha256, before, 'ninguna operación de identidad escribió un byte');
});

test('T26 · en v3 la IA no ejecuta identidad y la persona recibe la fase pendiente', async () => {
  const { runAction, buildSnapshot } = await import('../lib/api.mjs');
  const { loadState } = await import('../lib/state.mjs');
  const root = seedV3('v3');
  const before = loadState(root).sha256;

  const snapshot = buildSnapshot({ root, cwd: PATH_A, scan: false });
  equal(snapshot.identity.available, true);
  equal(snapshot.identity.requiredSchemaVersion, 3);
  ok(snapshot.identity.operations.includes(OPERATIONS.fork));

  const byAi = runAction({ root, action: 'identity-link', actor: 'ai', payload: {} });
  equal(byAi.code, 'inventory-incomplete', 'la política va antes que la autorización');

  const byHuman = runAction({ root, action: 'identity-link', actor: 'human', payload: {} });
  equal(byHuman.code, 'inventory-incomplete');
  equal(loadState(root).sha256, before);
});
