import { deepEqual, equal, ok, throws } from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';

import {
  backupFile,
  backupMetaFile,
  checkStoreShape,
  ensureBackup,
  loadState,
  migrateStore,
  normalizeState,
  readBackupMeta,
  restoreFromBackup,
  restoreStore,
  verifyBackup,
  withState,
  functionalSignature,
  INTEGRITY_FUTURE_VERSION,
  INTEGRITY_INVALID_SHAPE,
  INTEGRITY_OK,
} from '../lib/state.mjs';
import { runAction } from '../lib/api.mjs';
import { tempRoot } from './helpers.mjs';

const REAL_STORE = 'C:/Users/BYRON/.dsh/lifecode-skill-center/center.json';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Copia el almacén real **sólo si existe**; los tests nunca lo escriben. */
function realCopy(root) {
  mkdirSync(root, { recursive: true });
  copyFileSync(REAL_STORE, join(root, 'center.json'));
  return join(root, 'center.json');
}

function v1Document() {
  const parsed = JSON.parse(readFileSync(REAL_STORE, 'utf8'));
  equal(parsed.schemaVersion, 1, 'la copia debe ser v1 para probar la migración');
  return parsed;
}

function writeDocument(root, document) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'center.json'), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

test('la copia de un almacén sano conserva bytes y SHA-256 exactos', () => {
  const root = tempRoot('lsc-bak-');
  const file = realCopy(root);
  const original = readFileSync(file);
  const result = ensureBackup(root, { now: '2026-11-03T09:00:00.000Z', reason: 'manual' });
  equal(result.ok, true, JSON.stringify(result));
  equal(result.created, true);
  const backup = readFileSync(backupFile(root));
  equal(sha256(backup), sha256(original));
  equal(backup.length, original.length);
  const meta = readBackupMeta(root);
  equal(meta.sha256, sha256(original));
  equal(meta.size, original.length);
  equal(meta.source, 'manual');
  const verified = verifyBackup(root);
  equal(verified.ok, true);
});

test('si la copia no se puede crear, el original queda intacto y la escritura se aborta', () => {
  const root = tempRoot('lsc-bak-fail-');
  const file = realCopy(root);
  const before = readFileSync(file);
  // Un directorio con el nombre del destino hace fallar el rename de la copia.
  mkdirSync(backupFile(root), { recursive: true });
  const result = ensureBackup(root, { now: '2026-11-03T09:00:00.000Z', reason: 'manual' });
  equal(result.ok, false);
  equal(result.code, 'backup-failed');
  equal(sha256(readFileSync(file)), sha256(before), 'el documento no puede cambiar');

  const mutation = withState(root, (state) => {
    state.projects['nuevo'] = { id: 'nuevo', name: 'nuevo', cwd: 'C:/x', createdAt: 'x', updatedAt: 'x', note: '' };
  }, { now: '2026-11-03T09:01:00.000Z' });
  equal(mutation.ok, false);
  equal(mutation.code, 'backup-failed');
  equal(mutation.saved, false);
  equal(sha256(readFileSync(file)), sha256(before), 'sin copia no se escribe');
});

test('una copia incompleta no es recuperable', () => {
  const root = tempRoot('lsc-bak-broken-');
  realCopy(root);
  ensureBackup(root, { now: '2026-11-03T09:00:00.000Z', reason: 'manual' });
  truncateSync(backupFile(root), 100);
  const verified = verifyBackup(root);
  equal(verified.ok, false);
  equal(verified.code, 'hash-mismatch');
  const restored = restoreFromBackup(root, { now: '2026-11-03T09:10:00.000Z' });
  equal(restored.ok, false);
  equal(restored.code, 'hash-mismatch');
});

test('la migración v1 → v2 conserva entidades, versiones, referencias, pins y eventos', () => {
  const root = tempRoot('lsc-mig-');
  realCopy(root);
  const before = loadState(root);
  equal(before.state.schemaVersion, 1);
  const migrated = migrateStore(root, { now: '2026-11-03T10:00:00.000Z' });
  equal(migrated.ok, true, JSON.stringify(migrated));
  equal(migrated.migrated, true);
  equal(migrated.from, 1);
  equal(migrated.to, 2);
  const after = loadState(root);
  equal(after.integrity, INTEGRITY_OK);
  equal(after.state.schemaVersion, 2);
  equal(after.sha256, migrated.after.sha256);

  deepEqual(Object.keys(after.state.skills).sort(), Object.keys(before.state.skills).sort());
  deepEqual(Object.keys(after.state.events).length, Object.keys(before.state.events).length);
  equal(after.state.events.length, before.state.events.length);
  for (const [id, skill] of Object.entries(before.state.skills)) {
    const migratedSkill = after.state.skills[id];
    equal(migratedSkill.currentVersion, skill.currentVersion, `${id}: la versión viva no cambia`);
    equal(migratedSkill.versions.length, skill.versions.length, `${id}: mismo número de versiones`);
    for (const version of skill.versions) {
      const other = migratedSkill.versions.find((entry) => entry.version === version.version);
      ok(other !== undefined, `${id}@${version.version} sobrevive`);
      equal(other.body, version.body, `${id}@${version.version}: cuerpo idéntico`);
      deepEqual(Object.keys(other.references ?? {}).sort(), Object.keys(version.references ?? {}).sort());
    }
  }
  for (const [projectId, row] of Object.entries(before.state.assignments)) {
    for (const [skillId, assignment] of Object.entries(row)) {
      const other = after.state.assignments[projectId][skillId];
      equal(other.version, assignment.version, `${projectId}/${skillId}: el pin no se mueve`);
      equal(other.enabled, assignment.enabled, `${projectId}/${skillId}: el interruptor no cambia`);
      equal(typeof other.pinnedAt, 'string');
    }
  }
  deepEqual(after.state.projects['plugins-dhs-7e085aaa'].id, 'plugins-dhs-7e085aaa');
});

test('la migración es idempotente y no duplica nada', () => {
  const root = tempRoot('lsc-mig-twice-');
  realCopy(root);
  const first = migrateStore(root, { now: '2026-11-03T11:00:00.000Z' });
  equal(first.ok, true);
  const digest = loadState(root).sha256;
  const second = migrateStore(root, { now: '2026-11-03T11:05:00.000Z' });
  equal(second.ok, true);
  equal(second.migrated, false);
  equal(second.already, true);
  equal(loadState(root).sha256, digest, 'repetir la migración no reescribe el documento');
});

test('un documento que la normalización perdería no se migra ni se escribe', () => {
  const root = tempRoot('lsc-lossy-');
  const document = v1Document();
  // Una skill sin versiones legibles: normalizarla la borraría.
  document.skills['rota'] = { id: 'rota', title: 'rota', description: 'x'.repeat(80), whenToUse: 'y'.repeat(40), tags: [], status: 'published', currentVersion: '1.0.0', createdAt: '', updatedAt: '', origin: { kind: 'human' }, versions: [{ version: 'no-es-version', body: '' }] };
  writeDocument(root, document);
  const loaded = loadState(root);
  equal(loaded.integrity, INTEGRITY_INVALID_SHAPE);
  ok(String(loaded.error).includes('rota'));
  const bytes = readFileSync(join(root, 'center.json'));
  const migrated = migrateStore(root, { now: '2026-11-03T12:00:00.000Z' });
  equal(migrated.ok, false);
  equal(migrated.code, 'store-unreadable');
  const mutation = withState(root, (state) => {
    state.projects['x'] = { id: 'x' };
  });
  equal(mutation.ok, false);
  equal(sha256(readFileSync(join(root, 'center.json'))), sha256(bytes), 'los bytes no cambian');
});

test('si falla la escritura temporal, v1 sigue intacto y no queda basura', () => {
  const root = tempRoot('lsc-mig-tmpfail-');
  realCopy(root);
  const before = readFileSync(join(root, 'center.json'));
  const migrated = migrateStore(root, {
    now: '2026-11-03T13:00:00.000Z',
    writeFile: () => {
      throw new Error('disco lleno (simulado)');
    },
  });
  equal(migrated.ok, false);
  equal(migrated.code, 'migration-failed');
  equal(sha256(readFileSync(join(root, 'center.json'))), sha256(before), 'v1 intacto');
  equal(loadState(root).state.schemaVersion, 1);
  deepEqual(readdirSync(root).filter((name) => name.endsWith('.tmp')), []);
});

test('si falla el reemplazo, la copia verificada permite recuperar v1', () => {
  const root = tempRoot('lsc-mig-renamefail-');
  realCopy(root);
  const before = readFileSync(join(root, 'center.json'));
  const migrated = migrateStore(root, {
    now: '2026-11-03T14:00:00.000Z',
    rename: () => {
      throw new Error('no se pudo renombrar (simulado)');
    },
  });
  equal(migrated.ok, false);
  equal(migrated.code, 'migration-failed');
  equal(sha256(readFileSync(join(root, 'center.json'))), sha256(before));
  const backup = verifyBackup(root);
  equal(backup.ok, true, 'la copia existe aunque la migración fallara');
  const recovered = restoreFromBackup(root, { now: '2026-11-03T14:05:00.000Z' });
  equal(recovered.ok, true, JSON.stringify(recovered));
  equal(loadState(root).state.schemaVersion, 1);
  equal(sha256(readFileSync(join(root, 'center.json'))), sha256(before));
});

test('restaurar la copia con su hash funciona; con otro hash no se toca nada', () => {
  const root = tempRoot('lsc-restore-');
  const file = realCopy(root);
  ensureBackup(root, { now: '2026-11-03T15:00:00.000Z', reason: 'manual' });
  const backupBytes = readFileSync(backupFile(root));
  // Se sustituye el documento por otro válido (un v2 mínimo) para notar la restauración.
  writeDocument(root, { schemaVersion: 2, createdAt: 'x', updatedAt: 'x', skills: {}, projects: {}, assignments: {}, improvements: {}, events: [] });
  const wrong = restoreStore(root, { sourcePath: backupFile(root), expectedSha256: 'f'.repeat(64) });
  equal(wrong.ok, false);
  equal(wrong.code, 'hash-mismatch');
  equal(loadState(root).state.skills === undefined ? 0 : Object.keys(loadState(root).state.skills).length, 0, 'no cambió nada');
  const good = restoreFromBackup(root, { now: '2026-11-03T15:10:00.000Z' });
  equal(good.ok, true, JSON.stringify(good));
  equal(sha256(readFileSync(file)), sha256(backupBytes));
  const live = loadState(root);
  equal(live.state.schemaVersion, 1);
  ok(Object.keys(live.state.skills).length > 0);
  ok(String(good.archivedAs).includes('replaced'), 'el documento reemplazado se conserva');
});

test('una versión futura no se migra, no se escribe y se conserva intacta', () => {
  const root = tempRoot('lsc-future-');
  const document = v1Document();
  document.schemaVersion = 3;
  writeDocument(root, document);
  const bytes = readFileSync(join(root, 'center.json'));
  const loaded = loadState(root);
  equal(loaded.integrity, INTEGRITY_FUTURE_VERSION);
  equal(migrateStore(root).code, 'store-unreadable');
  equal(withState(root, (state) => { state.projects['x'] = { id: 'x' }; }).ok, false);
  equal(sha256(readFileSync(join(root, 'center.json'))), sha256(bytes));
});

test('la firma excluye sólo el sello raíz y conserva los funcionales', () => {
  const root = tempRoot('lsc-signature-');
  realCopy(root);
  const base = loadState(root).state;

  const onlyStamp = structuredClone(base);
  onlyStamp.updatedAt = '2099-01-01T00:00:00.000Z';
  equal(functionalSignature(onlyStamp), functionalSignature(base), 'el sello de escritura no es funcional');

  const assignment = Object.keys(base.assignments)[0];
  const skillId = Object.keys(base.assignments[assignment])[0];

  const pin = structuredClone(base);
  pin.assignments[assignment][skillId].version = '9.9.9';
  ok(functionalSignature(pin) !== functionalSignature(base), 'cambiar el pin es funcional');

  const enabled = structuredClone(base);
  enabled.assignments[assignment][skillId].enabled = !enabled.assignments[assignment][skillId].enabled;
  ok(functionalSignature(enabled) !== functionalSignature(base), 'cambiar el interruptor es funcional');

  const decidedAt = structuredClone(base);
  const improvementId = Object.keys(base.improvements)[0];
  decidedAt.improvements[improvementId].decidedAt = '2099-02-02T00:00:00.000Z';
  ok(functionalSignature(decidedAt) !== functionalSignature(base), 'decidedAt es funcional');

  const createdAt = structuredClone(base);
  const someSkill = Object.keys(base.skills)[0];
  createdAt.skills[someSkill].createdAt = '2099-03-03T00:00:00.000Z';
  ok(functionalSignature(createdAt) !== functionalSignature(base), 'createdAt es funcional');

  const eventAt = structuredClone(base);
  eventAt.events[0].at = '2099-04-04T00:00:00.000Z';
  ok(functionalSignature(eventAt) !== functionalSignature(base), 'events[].at es funcional');

  const pinnedAt = structuredClone(base);
  pinnedAt.assignments[assignment][skillId].pinnedAt = '2099-05-05T00:00:00.000Z';
  ok(functionalSignature(pinnedAt) !== functionalSignature(base), 'pinnedAt es funcional en v2');

  const nested = structuredClone(base);
  nested.skills[someSkill].updatedAt = '2099-06-06T00:00:00.000Z';
  ok(functionalSignature(nested) !== functionalSignature(base), 'un updatedAt anidado sí es funcional (ya no se excluye por nombre)');
});

test('cambiar el pin se guarda; tocar sólo el sello raíz no escribe', () => {
  const root = tempRoot('lsc-save-');
  realCopy(root);
  const projectId = Object.keys(loadState(root).state.assignments)[0];
  const skillId = Object.keys(loadState(root).state.assignments[projectId])[0];

  const noop = withState(root, (state) => {
    state.updatedAt = '2099-07-07T00:00:00.000Z';
  }, { now: '2026-11-03T16:00:00.000Z' });
  equal(noop.ok, true);
  equal(noop.saved, false);

  const pin = withState(root, (state) => {
    state.assignments[projectId][skillId].version = '7.7.7';
  }, { now: '2026-11-03T16:01:00.000Z' });
  equal(pin.ok, true, JSON.stringify(pin));
  equal(pin.saved, true);
  equal(loadState(root).state.assignments[projectId][skillId].version, '7.7.7');
});

test('un registro interno malformado no se descarta en silencio: invalid-shape', () => {
  const root = tempRoot('lsc-internal-');
  const document = v1Document();
  document.projects['sin-id'] = { name: 'sin id' };
  document.events.push({ sin: 'tipo' });
  writeDocument(root, document);
  const loaded = loadState(root);
  equal(loaded.integrity, INTEGRITY_INVALID_SHAPE);
  ok(/projects|events/.test(String(loaded.error)));
});

test('la copia de hoy evita copias repetidas, y el historial tiene tope', () => {
  const root = tempRoot('lsc-backup-daily-');
  realCopy(root);
  const first = ensureBackup(root, { now: '2026-11-03T17:00:00.000Z', reason: 'mutation' });
  equal(first.created, true);
  const second = ensureBackup(root, { now: '2026-11-03T17:05:00.000Z', reason: 'mutation' });
  equal(second.created, false);
  const history = readdirSync(join(root, 'backups'));
  equal(history.length, 1);
  equal(history[0], 'center-2026-11-03.json');
  ok(statSync(backupMetaFile(root)).size > 0);
});

test('una migración fuerza copia aunque ya hubiera una del día', () => {
  const root = tempRoot('lsc-backup-forced-');
  realCopy(root);
  const first = ensureBackup(root, { now: '2026-11-03T18:00:00.000Z', reason: 'mutation' });
  equal(first.created, true);
  const forced = ensureBackup(root, { now: '2026-11-03T18:01:00.000Z', reason: 'migration' });
  equal(forced.created, true);
  equal(readBackupMeta(root).source, 'migration');
});

test('un documento sin schemaVersion no se acepta como válido', () => {
  const root = tempRoot('lsc-noversion-');
  const document = v1Document();
  delete document.schemaVersion;
  writeDocument(root, document);
  const loaded = loadState(root);
  equal(loaded.integrity, INTEGRITY_INVALID_SHAPE);
  ok(String(loaded.error).includes('schemaVersion'));
});

test('el documento migrado conserva los checks de evaluación (no se pierden al normalizar)', () => {
  const root = tempRoot('lsc-checks-');
  realCopy(root);
  const before = normalizeState(v1Document());
  const migrated = migrateStore(root, { now: '2026-11-03T19:00:00.000Z' });
  equal(migrated.ok, true, JSON.stringify(migrated));
  const after = loadState(root).state;
  let compared = 0;
  for (const [id, skill] of Object.entries(before.skills)) {
    for (const version of skill.versions) {
      const other = after.skills[id].versions.find((entry) => entry.version === version.version);
      const left = version.evaluation?.checks?.length ?? 0;
      const right = other.evaluation?.checks?.length ?? 0;
      equal(right, left, `${id}@${version.version}: los checks sobreviven`);
      if (left > 0) compared += 1;
    }
  }
  ok(compared > 0, 'la biblioteca real tiene evaluaciones con checks');
  equal(checkStoreShape(JSON.parse(readFileSync(join(root, 'center.json'), 'utf8'))).ok, true);
});

test('el panel recibe schemaVersion y el estado de la copia en la instantánea', () => {
  const root = tempRoot('lsc-snapshot-');
  realCopy(root);
  const before = runAction({ root, action: 'state', payload: { scan: false }, now: '2026-11-03T20:00:00.000Z' });
  equal(before.schemaVersion, 1);
  equal(before.backup.exists, false, 'sin copia todavía');
  const backed = runAction({ root, action: 'backup', payload: {}, actor: 'human', now: '2026-11-03T20:01:00.000Z' });
  equal(backed.ok, true, JSON.stringify(backed));
  equal(backed.snapshot.backup.verified, true);
  equal(backed.snapshot.backup.sha256, before.integrity.sha256);
  const migrated = runAction({ root, action: 'migrate', payload: {}, actor: 'human', now: '2026-11-03T20:02:00.000Z' });
  equal(migrated.ok, true, JSON.stringify(migrated));
  equal(migrated.snapshot.schemaVersion, 2);
  equal(migrated.snapshot.backup.verified, true);
});

test('la IA no migra, no copia ni restaura', () => {
  const root = tempRoot('lsc-actor-');
  realCopy(root);
  for (const action of ['migrate', 'backup', 'restore']) {
    const result = runAction({ root, action, payload: {}, actor: 'ai', now: '2026-11-03T21:00:00.000Z' });
    equal(result.ok, false, action);
    equal(result.code, 'approval-required', action);
  }
  equal(loadState(root).state.schemaVersion, 1);
});
