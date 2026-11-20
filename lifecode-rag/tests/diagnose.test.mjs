import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { diagnoseProfile } from '../lib/diagnose.mjs';
import { appendRegistryAudit, closeRegistry, createProject, addRoot, openRegistry } from '../lib/registry.mjs';
import { loadConfig } from '../lib/paths.mjs';
import { seedScope } from './pa4-helpers.mjs';

const NOW = 1_700_000_000_000;

/** Perfil temporal con un proyecto y una raíz ya registrados. */
function makeProfile({ seed = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'diagnose-'));
  const root = join(base, 'perfil');
  const dir = join(base, 'proyecto');
  mkdirSync(dir, { recursive: true });
  const env = { LIFECODE_RAG_ROOT: root, DSH_PROFILE: 'diag-test' };
  const opened = openRegistry({ root, create: true, now: NOW });
  const project = createProject(opened.db, { name: 'Proyecto diagnóstico', now: NOW });
  addRoot(opened.db, { scopeKind: 'prj', scopeId: project.id, path: dir, addedBy: 'human', now: NOW });
  appendRegistryAudit(opened.db, { at: NOW, actor: 'human', action: 'test.setup', target: project.id, outcome: 'ok', detail: { note: 'diagnóstico' } });
  closeRegistry(opened.db);
  return {
    base, root, dir, env, project,
    async seed() {
      await seedScope({
        profileRootPath: root,
        profileKey: 'diag-test',
        scope: { kind: 'prj', id: project.id, name: 'Proyecto diagnóstico' },
        dir,
        docs: { 'a.md': '# Alfa\n\ncontenido de diagnóstico\n' },
        config: loadConfig(root).config,
      });
    },
    cleanup() { rmSync(base, { recursive: true, force: true }); },
  };
}

test('perfil sano: registro, almacén, FTS, auditoría y selección legibles', async () => {
  const world = makeProfile();
  try {
    await world.seed();
    const report = diagnoseProfile({ env: world.env, argv: [] });
    assert.equal(report.ok, true, JSON.stringify(report.problems));
    assert.equal(report.profile.key, 'diag-test');
    assert.equal(report.registry.exists, true);
    assert.equal(report.registry.quickCheck, 'ok');
    assert.equal(report.registry.foreignKeys, 0);
    assert.equal(report.registry.audit.ok, true);
    assert.equal(report.scopes.length, 1);
    const scope = report.scopes[0];
    assert.equal(scope.scopeId, world.project.id);
    assert.equal(scope.state, 'present');
    assert.equal(scope.counts.sources, 1);
    assert.equal(scope.counts.chunks, scope.counts.fts);
    assert.equal(scope.counts.vectors, scope.counts.chunks);
    assert.equal(scope.counts.orphanChunks, 0);
    assert.equal(scope.counts.missingVectors, 0);
    assert.equal(scope.sync.present ?? 0, 0);
  } finally {
    world.cleanup();
  }
});

test('almacén ausente: se declara missing y no se crea nada', () => {
  const world = makeProfile({ seed: false });
  try {
    const report = diagnoseProfile({ env: world.env, argv: [] });
    assert.equal(report.ok, false);
    assert.equal(report.scopes[0].state, 'missing');
    assert.ok(report.problems.some((problem) => problem.includes('estado missing')), report.problems.join(' | '));
  } finally {
    world.cleanup();
  }
});

test('sin registro: explica que el perfil todavía no tiene proyecto', () => {
  const base = mkdtempSync(join(tmpdir(), 'diagnose-empty-'));
  try {
    const report = diagnoseProfile({ env: { LIFECODE_RAG_ROOT: join(base, 'perfil'), DSH_PROFILE: 'diag-test' }, argv: [] });
    assert.equal(report.ok, false);
    assert.equal(report.registry.exists, false);
    assert.ok(report.problems.some((problem) => problem.includes('registro Project-Aware')), report.problems.join(' | '));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('cadena de auditoría rota: el registro no se abre y se informa el código', () => {
  const world = makeProfile();
  try {
    const opened = openRegistry({ root: world.root, create: false, now: NOW });
    opened.db.prepare("UPDATE audit_registry SET outcome = 'denied' WHERE seq = 1").run();
    closeRegistry(opened.db);
    const report = diagnoseProfile({ env: world.env, argv: [] });
    assert.equal(report.ok, false);
    assert.equal(report.registry.exists, true);
    assert.equal(report.registry.error, 'registry-corrupt');
    assert.ok(report.problems.some((problem) => problem.includes('registro ilegible')), report.problems.join(' | '));
  } finally {
    world.cleanup();
  }
});

test('dos fuentes del mismo fichero que sólo difieren en mayúsculas se señalan', async () => {
  const world = makeProfile();
  try {
    await world.seed();
    const storeFile = join(world.root, 'scopes', world.project.id, 'rag.sqlite3');
    const store = new DatabaseSync(storeFile);
    const existing = store.prepare("SELECT uri FROM sources WHERE uri LIKE '%a.md'").get().uri;
    store
      .prepare(
        `INSERT INTO sources (id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at)
         VALUES ('src_duplicado_caso', 'default', ?, 'A.md', 'text/markdown', 'deadbeef', 10, 10, '{}', ?, ?, ?)`,
      )
      .run(existing.replace(/a\.md$/, 'A.md'), NOW, NOW, NOW);
    store.close();
    const report = diagnoseProfile({ env: world.env, argv: [] });
    assert.equal(report.ok, false);
    assert.equal(report.scopes[0].counts.caseCollisions, 1);
    assert.ok(
      report.problems.some((problem) => problem.includes('mayúsculas/minúsculas')),
      report.problems.join(' | '),
    );
  } finally {
    world.cleanup();
  }
});
