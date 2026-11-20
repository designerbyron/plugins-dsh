import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../lib/paths.mjs';
import { verifyAuditChain } from '../lib/audit.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { inspectLegacyStore, migrateLegacyStore } from '../lib/migrate.mjs';
import { closeRegistry, openRegistry } from '../lib/registry.mjs';

function tempRoot(prefix = 'lcr-migrate-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function buildLegacy({ root, title, body }) {
  const doc = join(root, '..', `${title}.md`);
  writeFileSync(doc, `# ${title}\n\n${body}\n`);
  const result = await ingestFiles({
    root, files: [doc], collection: 'migracion', now: 1_700_000_000_000, config: DEFAULT_CONFIG,
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.ingested.length, 1);
  return doc;
}

test('migra por igual: cuentas, hashes, FTS, auditoría y registro, sin tocar el origen', async () => {
  const legacy = tempRoot();
  const profile = tempRoot('lcr-profile-');
  const projectDir = tempRoot('lcr-project-');
  try {
    await buildLegacy({ root: legacy, title: 'Operación', body: 'La recuperación híbrida combina señales.' });
    const before = sha256(join(legacy, 'rag.sqlite3'));
    const inspected = inspectLegacyStore({ legacyRoot: legacy });
    assert.equal(inspected.counts.sources, 1);

    const report = migrateLegacyStore({
      legacyRoot: legacy, profileRoot: profile, projectName: 'Proyecto migrado',
      rootPath: projectDir, confirm: true, now: 1_700_000_000_000,
    });
    assert.equal(report.counts.sources, inspected.counts.sources);
    assert.equal(report.counts.chunks, inspected.counts.chunks);
    assert.equal(report.counts.vectors, inspected.counts.vectors);
    assert.equal(report.counts.audit, inspected.counts.audit);
    assert.equal(report.verification.integrity, 'ok');
    assert.equal(report.verification.audit.ok, true);
    assert.equal(report.legacy.untouched, true);
    assert.equal(sha256(join(legacy, 'rag.sqlite3')), before);
    assert.ok(existsSync(report.scope.database));
    assert.notEqual(report.scope.path, legacy);

    const registry = openRegistry({ root: profile });
    const project = registry.db.prepare('SELECT * FROM projects WHERE id = ?').get(report.project.id);
    assert.equal(project.name, 'Proyecto migrado');
    const root = registry.db.prepare('SELECT * FROM roots WHERE id = ?').get(report.root.id);
    assert.equal(root.path, projectDir);
    const operation = registry.db.prepare('SELECT * FROM operations WHERE id = ?').get(report.operationId);
    assert.equal(operation.kind, 'migrate');
    assert.equal(operation.state, 'committed');
    assert.equal(registry.db.prepare('SELECT COUNT(*) AS n FROM operation_steps WHERE operation_id = ?').get(report.operationId).n, 5);
    assert.equal(registry.db.prepare('SELECT COUNT(*) AS n FROM audit_registry').get().n, 1);
    closeRegistry(registry.db);
  } finally {
    for (const dir of [legacy, profile, projectDir]) rmSync(dir, { recursive: true, force: true });
  }
});

test('sin confirmación humana no escribe nada', async () => {
  const legacy = tempRoot();
  const profile = tempRoot('lcr-profile-');
  const projectDir = tempRoot('lcr-project-');
  try {
    await buildLegacy({ root: legacy, title: 'Sin confirmar', body: 'texto' });
    assert.throws(
      () => migrateLegacyStore({ legacyRoot: legacy, profileRoot: profile, projectName: 'No', rootPath: projectDir }),
      /confirmación humana/,
    );
    assert.equal(existsSync(join(profile, 'registry.sqlite3')), false);
  } finally {
    for (const dir of [legacy, profile, projectDir]) rmSync(dir, { recursive: true, force: true });
  }
});

test('un fallo de copia revierte el ámbito y el registro, y deja el origen intacto', async () => {
  const legacy = tempRoot();
  const profile = tempRoot('lcr-profile-');
  const projectDir = tempRoot('lcr-project-');
  try {
    await buildLegacy({ root: legacy, title: 'Corrupto', body: 'contenido íntegro' });
    const legacyDb = join(legacy, 'rag.sqlite3');
    // Corrupción referencial que `integrity_check` no ve: un chunk sin fuente. La copia falla por FK.
    const raw = new DatabaseSync(legacyDb);
    raw.exec('PRAGMA foreign_keys = OFF');
    raw.prepare(`INSERT INTO chunks (chunk_key, source_id, ordinal, title, heading, text, char_start, char_end, token_est)
      VALUES ('bogus#9', 'src_inexistente', 9, 'T', NULL, 'texto suelto', 0, 12, 3)`).run();
    raw.close();
    const before = sha256(legacyDb);

    assert.throws(
      () => migrateLegacyStore({
        legacyRoot: legacy, profileRoot: profile, projectName: 'Fallida', rootPath: projectDir,
        confirm: true, now: 1_700_000_000_000,
      }),
      /FOREIGN KEY|foreign key constraint/i,
    );

    const registry = openRegistry({ root: profile });
    assert.equal(registry.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 0);
    assert.equal(registry.db.prepare('SELECT COUNT(*) AS n FROM roots').get().n, 0);
    closeRegistry(registry.db);
    assert.equal(existsSync(join(profile, 'scopes')), true);
    assert.deepEqual(readdirSync(join(profile, 'scopes')), [], 'el rollback no deja ningún ámbito');
    assert.equal(sha256(legacyDb), before);
  } finally {
    for (const dir of [legacy, profile, projectDir]) rmSync(dir, { recursive: true, force: true });
  }
});

test('dos almacenes migran a dos ámbitos del mismo perfil, con cadenas de auditoría distintas', async () => {
  const legacyA = tempRoot();
  const legacyB = tempRoot();
  const profile = tempRoot('lcr-profile-');
  const projectA = tempRoot('lcr-project-');
  const projectB = tempRoot('lcr-project-');
  try {
    await buildLegacy({ root: legacyA, title: 'Alfa', body: 'documento alfa sobre rutas' });
    await buildLegacy({ root: legacyB, title: 'Beta', body: 'documento beta sobre índices' });
    const a = migrateLegacyStore({
      legacyRoot: legacyA, profileRoot: profile, projectName: 'Alfa', rootPath: projectA,
      confirm: true, now: 1_700_000_000_000,
    });
    const b = migrateLegacyStore({
      legacyRoot: legacyB, profileRoot: profile, projectName: 'Beta', rootPath: projectB,
      confirm: true, now: 1_700_000_001_000,
    });
    assert.notEqual(a.project.id, b.project.id);
    assert.notEqual(a.scope.path, b.scope.path);
    assert.ok(!b.scope.path.startsWith(a.scope.path), 'los ámbitos no se anidan');

    const registry = openRegistry({ root: profile });
    assert.equal(registry.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 2);
    assert.equal(registry.db.prepare('SELECT COUNT(*) AS n FROM roots').get().n, 2);
    assert.equal(registry.db.prepare('SELECT COUNT(*) AS n FROM audit_registry').get().n, 2);
    closeRegistry(registry.db);

    const auditA = new DatabaseSync(join(a.scope.path, 'rag.sqlite3'));
    const auditB = new DatabaseSync(join(b.scope.path, 'rag.sqlite3'));
    const hashesA = auditA.prepare('SELECT hash FROM audit ORDER BY seq').all();
    const hashesB = auditB.prepare('SELECT hash FROM audit ORDER BY seq').all();
    auditA.close();
    auditB.close();
    assert.notEqual(hashesA[0].hash, hashesB[0].hash, 'cada ámbito encadena su propia auditoría, sin ancla compartida');

    // PAR-12: manipular la auditoría de un ámbito no afecta a la del otro.
    const tamper = new DatabaseSync(join(a.scope.path, 'rag.sqlite3'));
    tamper.prepare(`UPDATE audit SET details = '{"mutado":true}' WHERE seq = 1`).run();
    tamper.close();
    const aDb = new DatabaseSync(join(a.scope.path, 'rag.sqlite3'), { readOnly: true });
    const bDb = new DatabaseSync(join(b.scope.path, 'rag.sqlite3'), { readOnly: true });
    assert.equal(verifyAuditChain(aDb).ok, false);
    assert.equal(verifyAuditChain(bDb).ok, true);
    aDb.close();
    bDb.close();
  } finally {
    for (const dir of [legacyA, legacyB, profile, projectA, projectB]) rmSync(dir, { recursive: true, force: true });
  }
});
