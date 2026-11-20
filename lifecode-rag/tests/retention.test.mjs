/**
 * PA4-G — retención y archivado (observación O-PA0-3).
 *
 * Lo que se prueba aquí no es «se borra lo viejo» (PA4 no lo hace), sino las tres garantías que la orden
 * exige: el planificador es de sólo lectura, la auditoría no se toca, y un corte exportado se puede
 * verificar por sí mismo (cabecera + sha256). Un corte sobre una cadena rota se rechaza antes de escribir.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openRegistry, closeRegistry, appendRegistryAudit, registryIntegrity } from '../lib/registry.mjs';
import { exportRegistryAuditSlice, planRetention, RETENTION_PROPOSAL, dayOf } from '../lib/retention.mjs';
import { listSessions } from '../lib/sessions.mjs';
import { makeEightWorld } from './pa4-helpers.mjs';

function auditRows(db) {
  return db.prepare('SELECT seq, hash FROM audit_registry ORDER BY seq').all();
}

test('el plan de retención es de sólo lectura: no borra ni modifica nada', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const before = world.withRegistry((db) => ({
      audit: auditRows(db),
      sessions: listSessions(db).length,
      integrity: registryIntegrity(db),
    }));
    const plan = world.withRegistry((db) => planRetention(db, { now: 1_700_000_000_000 }));
    assert.equal(plan.policy.approved, false);
    assert.equal(plan.policy.destructive, false);
    assert.equal(plan.policy.sessionScopeDays, RETENTION_PROPOSAL.sessionScopeDays);
    assert.equal(plan.candidates.metricsBefore, dayOf(1_700_000_000_000 - 400 * 86_400_000));
    assert.ok(plan.protected.activeSessions >= 1);
    assert.equal(plan.protected.unfinishedOperations, 0);
    assert.ok(plan.protected.auditRegistryEntries >= 1);
    const after = world.withRegistry((db) => ({
      audit: auditRows(db),
      sessions: listSessions(db).length,
      integrity: registryIntegrity(db),
    }));
    assert.deepEqual(after.audit, before.audit, 'la auditoría no cambia');
    assert.equal(after.sessions, before.sessions);
    assert.deepEqual(after.integrity.audit, before.integrity.audit);
  } finally {
    world.cleanup();
  }
});

test('exportar un corte de auditoría verifica la cadena y deja un sello sha256', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  const dir = mkdtempSync(join(tmpdir(), 'pa4-ret-'));
  try {
    world.withRegistry((db) => {
      appendRegistryAudit(db, {
        at: 1_700_000_000_100, actor: 'human', sessionId: null,
        action: 'prueba.retencion', target: 'corte', outcome: 'ok', detail: { nota: 'sólo copia' },
      });
    });
    const target = join(dir, 'registro-audit.jsonl');
    const slice = world.withRegistry((db) => exportRegistryAuditSlice(db, { path: target, now: 1_700_000_000_200 }));
    assert.ok(slice.entries >= 1);
    assert.equal(existsSync(target), true);
    assert.equal(existsSync(`${target}.sha256`), true);

    const body = readFileSync(target, 'utf8');
    const lines = body.trimEnd().split('\n');
    const header = JSON.parse(lines[0]);
    assert.equal(header.kind, 'lifecode-rag/registry-audit-slice');
    assert.equal(header.fromSeq, 1);
    assert.equal(header.headHash, JSON.parse(lines.at(-1)).hash);
    const sealed = readFileSync(`${target}.sha256`, 'utf8').split('  ')[0];
    assert.equal(sealed, createHash('sha256').update(body, 'utf8').digest('hex'));
    // La exportación se audita y no borra: el registro conserva todas sus entradas.
    const rows = world.withRegistry((db) => auditRows(db));
    assert.equal(rows.length >= slice.entries + 1, true);
    assert.equal(world.withRegistry((db) => registryIntegrity(db).audit.ok), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    world.cleanup();
  }
});

test('un corte cuya cadena no verifica se rechaza sin escribir el fichero', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  const dir = mkdtempSync(join(tmpdir(), 'pa4-ret-'));
  try {
    world.withRegistry((db) => {
      db.prepare(`UPDATE audit_registry SET detail = 'manipulado' WHERE seq = 1`).run();
    });
    const target = join(dir, 'roto.jsonl');
    // El registro se niega a abrir con la cadena rota: no se llega ni a exportar.
    assert.throws(
      () => world.withRegistry((db) => exportRegistryAuditSlice(db, { path: target, now: 1_700_000_000_300 })),
      (error) => {
        assert.equal(error.code, 'registry-corrupt');
        assert.equal(error.details.brokenAt, 1);
        assert.equal(error.details.reason, 'hash');
        return true;
      },
    );
    assert.equal(existsSync(target), false, 'no se escribe una copia que no verifica');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    world.cleanup();
  }
});

test('el módulo de retención no expone ninguna operación destructiva', async () => {
  const retention = await import('../lib/retention.mjs');
  const names = Object.keys(retention);
  assert.deepEqual(names.sort(), ['RETENTION_PROPOSAL', 'dayOf', 'exportRegistryAuditSlice', 'planRetention']);
  for (const name of names) {
    assert.equal(/delete|purge|compact|prune|drop/i.test(name), false, `${name} no debería existir en PA4`);
  }
  // Y el registro sigue intacto tras planificar: la política no se aplica sola.
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const before = world.withRegistry((db) => auditRows(db).length);
    world.withRegistry((db) => planRetention(db));
    assert.equal(world.withRegistry((db) => auditRows(db).length), before);
  } finally {
    world.cleanup();
  }
});

test('un registro cerrado y reabierto conserva la cabeza de auditoría que declara el plan', async () => {
  const world = await makeEightWorld({ libraryCount: 1 });
  try {
    const head = world.withRegistry((db) => planRetention(db).protected.auditHeadHash);
    const reopened = openRegistry({ root: world.root, create: false });
    try {
      const integrity = registryIntegrity(reopened.db);
      assert.equal(integrity.audit.ok, true);
      assert.equal(head, reopened.db.prepare(`SELECT value FROM meta WHERE key='audit_head_hash'`).get().value);
    } finally {
      closeRegistry(reopened.db);
    }
  } finally {
    world.cleanup();
  }
});
