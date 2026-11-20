/**
 * Migración de un almacén v0.2 (un único `rag.sqlite3`) a un almacén de ámbito Project-Aware (PA1).
 *
 * Garantías que implementa `PROJECT-AWARE-ARCHITECTURE.md` §12:
 * - El origen se abre **en solo lectura** y nunca se mueve ni se modifica.
 * - Se copia a un ámbito nuevo, se verifica la igualdad y sólo entonces se registra el proyecto.
 * - Cualquier fallo deja el origen intacto y no deja ámbito registrado (rollback explícito).
 * - La copia conserva `chunk_key`, hashes, auditoría encadenada y metadatos de índice.
 *
 * Lo que **no** hace: no crea bibliotecas ni concesiones, no migra sesiones, no instala el plugin y
 * no toca el perfil operativo. El proyecto y la raíz se pasan explícitamente porque la decisión es
 * humana; esta función no los inventa.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { RagError } from './errors.mjs';
import { verifyAuditChain } from './audit.mjs';
import { closeDatabase, ftsIntegrityCheck, openDatabase, withTransaction } from './db.mjs';
import { openRegistry, addRoot, appendRegistryAudit, createProject, newId, pathKeyFor } from './registry.mjs';
import { profileRoot as defaultProfileRoot, scopeRoot as scopeRootFor, legacyRagRoot } from './profile.mjs';
import { APPLICATION_ID, SCHEMA_VERSION } from './schema.mjs';

const LEGACY_TABLES = ['meta', 'sources', 'chunks', 'vectors', 'source_tags', 'audit'];

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

function openLegacyReadOnly(dbPath) {
  if (!existsSync(dbPath)) {
    throw new RagError('store-not-initialized', 'no hay almacén v0.2 que migrar', { details: { path: dbPath } });
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const appId = Number(db.prepare('PRAGMA application_id').get().application_id);
    if (appId !== APPLICATION_ID) {
      throw new RagError('store-not-rag', 'el almacén de origen no es de LifeCode RAG', { details: { path: dbPath } });
    }
    const version = Number(db.prepare('PRAGMA user_version').get().user_version);
    if (version !== SCHEMA_VERSION) {
      throw new RagError('store-version-unsupported', 'sólo se migra el esquema v0.2 (versión 3)', {
        details: { found: version, expected: SCHEMA_VERSION },
      });
    }
    const tables = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((row) => row.name));
    const missing = LEGACY_TABLES.filter((name) => !tables.has(name));
    if (missing.length > 0) throw new RagError('store-corrupt', 'al almacén de origen le faltan tablas', { details: { missing } });
    const check = db.prepare('PRAGMA integrity_check').all();
    if (check.length !== 1 || check[0].integrity_check !== 'ok') {
      throw new RagError('store-corrupt', 'integrity_check del origen falló', { details: { check } });
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Inspección de solo lectura, sin escribir nada. */
export function inspectLegacyStore({ legacyRoot }) {
  const dbPath = join(legacyRoot, 'rag.sqlite3');
  const db = openLegacyReadOnly(dbPath);
  try {
    const chain = verifyAuditChain(db);
    return {
      path: dbPath,
      schemaVersion: Number(db.prepare('PRAGMA user_version').get().user_version),
      bytes: statSync(dbPath).size,
      sha256: sha256File(dbPath),
      counts: {
        sources: count(db, 'sources'),
        chunks: count(db, 'chunks'),
        vectors: count(db, 'vectors'),
        tags: count(db, 'source_tags'),
        audit: count(db, 'audit'),
      },
      audit: chain,
    };
  } finally {
    db.close();
  }
}

function backupStore(dbPath, backupDir) {
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, 'rag.sqlite3');
  copyFileSync(dbPath, target);
  const before = sha256File(dbPath);
  const after = sha256File(target);
  if (before !== after) {
    throw new RagError('internal', 'la copia de seguridad no coincide con el origen', { details: { before, after } });
  }
  return { path: target, sha256: after, bytes: statSync(target).size };
}

function controlQuery(db) {
  const row = db.prepare('SELECT text FROM chunks ORDER BY id LIMIT 1').get();
  if (!row) return { query: null, count: 0 };
  const token = (row.text.match(/[\p{L}\p{N}]{4,}/u) ?? [null])[0];
  if (!token) return { query: null, count: 0 };
  const query = `"${token.replaceAll('"', '""')}"`;
  const result = db.prepare('SELECT COUNT(*) AS n FROM chunks_fts WHERE chunks_fts MATCH ?').get(query);
  return { query, count: Number(result.n) };
}

function copyStore(legacy, destination, { now }) {
  const source = legacy.prepare('SELECT * FROM sources ORDER BY id').all();
  const chunks = legacy.prepare('SELECT * FROM chunks ORDER BY id').all();
  const vectors = legacy.prepare('SELECT * FROM vectors ORDER BY chunk_key, model').all();
  const tags = legacy.prepare('SELECT * FROM source_tags ORDER BY source_id, tag').all();
  const audit = legacy.prepare('SELECT * FROM audit ORDER BY seq').all();
  const meta = legacy.prepare('SELECT key, value FROM meta').all();

  const insertSource = destination.prepare(`INSERT INTO sources
    (id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const row of source) {
    insertSource.run(row.id, row.collection, row.uri, row.title, row.mime, row.sha256, row.bytes,
      row.char_count, row.metadata, row.created_at, row.updated_at, row.indexed_at);
  }

  const insertChunk = destination.prepare(`INSERT INTO chunks
    (id, chunk_key, source_id, ordinal, title, heading, text, char_start, char_end, token_est)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const row of chunks) {
    insertChunk.run(row.id, row.chunk_key, row.source_id, row.ordinal, row.title, row.heading,
      row.text, row.char_start, row.char_end, row.token_est);
  }

  const insertVector = destination.prepare('INSERT INTO vectors (chunk_key, model, dim, vec) VALUES (?, ?, ?, ?)');
  for (const row of vectors) insertVector.run(row.chunk_key, row.model, row.dim, row.vec);

  const insertTag = destination.prepare('INSERT INTO source_tags (source_id, tag) VALUES (?, ?)');
  for (const row of tags) insertTag.run(row.source_id, row.tag);

  const insertAudit = destination.prepare(`INSERT INTO audit
    (seq, at, actor, session_id, call_id, tool, action, target, outcome, details, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const row of audit) {
    insertAudit.run(row.seq, row.at, row.actor, row.session_id, row.call_id, row.tool, row.action,
      row.target, row.outcome, row.details, row.prev_hash, row.hash);
  }

  const setMeta = destination.prepare('UPDATE meta SET value = ? WHERE key = ?');
  const keep = new Set(['index_revision', 'embedding_model', 'audit_exported_seq', 'audit_head_seq', 'audit_head_hash', 'created_at']);
  const copiedMeta = [];
  for (const row of meta) {
    if (!keep.has(row.key)) continue;
    setMeta.run(row.value, row.key);
    copiedMeta.push(row.key);
  }
  setMeta.run(String(now), 'migrated_at');
  return { counts: { sources: source.length, chunks: chunks.length, vectors: vectors.length, tags: tags.length, audit: audit.length }, meta: copiedMeta };
}

function chunkTextMap(db) {
  const map = new Map();
  for (const row of db.prepare('SELECT chunk_key, text FROM chunks ORDER BY chunk_key').all()) map.set(row.chunk_key, row.text);
  return map;
}

function sourceHashMap(db) {
  const map = new Map();
  for (const row of db.prepare('SELECT id, sha256 FROM sources ORDER BY id').all()) map.set(row.id, row.sha256);
  return map;
}

function assertEqual(label, left, right) {
  const a = JSON.stringify(left);
  const b = JSON.stringify(right);
  if (a !== b) throw new RagError('store-corrupt', `la verificación de migración falló: ${label}`, {
    details: { phase: label },
  });
}

/** Verificación de igualdad entre origen y destino; devuelve el informe reproducible. */
export function verifyMigration(legacy, destination) {
  const legacyCounts = {
    sources: count(legacy, 'sources'), chunks: count(legacy, 'chunks'), vectors: count(legacy, 'vectors'),
    tags: count(legacy, 'source_tags'), audit: count(legacy, 'audit'),
  };
  const destinationCounts = {
    sources: count(destination, 'sources'), chunks: count(destination, 'chunks'), vectors: count(destination, 'vectors'),
    tags: count(destination, 'source_tags'), audit: count(destination, 'audit'),
  };
  assertEqual('counts', legacyCounts, destinationCounts);

  assertEqual('source-hashes', [...sourceHashMap(legacy)], [...sourceHashMap(destination)]);
  assertEqual('chunk-text', [...chunkTextMap(legacy)], [...chunkTextMap(destination)]);

  const legacyAudit = verifyAuditChain(legacy);
  const destinationAudit = verifyAuditChain(destination);
  assertEqual('audit-origin', legacyAudit.ok, true);
  assertEqual('audit-destination', destinationAudit.ok, true);
  assertEqual('audit-count', legacyAudit.count, destinationAudit.count);

  const check = destination.prepare('PRAGMA integrity_check').all();
  assertEqual('integrity', check.length === 1 ? check[0].integrity_check : 'invalid', 'ok');
  ftsIntegrityCheck(destination);
  const controlLegacy = controlQuery(legacy);
  const controlDestination = controlQuery(destination);
  assertEqual('fts-control', controlLegacy.count, controlDestination.count);

  const appId = Number(destination.prepare('PRAGMA application_id').get().application_id);
  const version = Number(destination.prepare('PRAGMA user_version').get().user_version);
  assertEqual('application-id', appId, APPLICATION_ID);
  assertEqual('schema-version', version, SCHEMA_VERSION);

  return {
    counts: destinationCounts,
    audit: destinationAudit,
    fts: { ...controlDestination, matches: controlLegacy.count },
    integrity: 'ok',
    applicationId: appId,
    schemaVersion: version,
  };
}

/**
 * Migra el almacén v0.2 del perfil a un ámbito de proyecto nuevo.
 *
 * @param {object} options
 * @param {boolean} options.confirm confirmación humana explícita; sin ella no se escribe nada
 * @param {string} options.projectName nombre del proyecto destino
 * @param {string} options.rootPath raíz autorizada del proyecto (absoluta, existente)
 * @param {string} [options.legacyRoot] raíz del almacén v0.2 (por defecto `$DSH_HOME/lifecode-rag`)
 * @param {string} [options.profileRoot] raíz del perfil Project-Aware
 */
export function migrateLegacyStore({
  legacyRoot,
  profileRoot,
  projectName,
  rootPath,
  confirm = false,
  now = Date.now(),
  backupDir,
} = {}) {
  if (confirm !== true) {
    throw new RagError('approval-required', 'la migración exige confirmación humana explícita');
  }
  const sourceRoot = resolve(legacyRoot ?? legacyRagRoot());
  if (profileRoot === undefined) profileRoot = defaultProfileRoot();
  if (typeof projectName !== 'string' || projectName.trim() === '') {
    throw new RagError('invalid-argument', 'falta el nombre del proyecto destino');
  }
  if (typeof rootPath !== 'string' || !isAbsolute(rootPath)) {
    throw new RagError('invalid-argument', 'la raíz del proyecto debe ser una ruta absoluta');
  }
  if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
    throw new RagError('source-unreadable', 'la raíz del proyecto no existe', { details: { path: rootPath } });
  }

  const legacy = { root: sourceRoot };
  const legacyDbPath = join(legacy.root, 'rag.sqlite3');
  const beforeSha = sha256File(legacyDbPath);
  const source = openLegacyReadOnly(legacyDbPath);
  let destinationDb = null;
  let registryDb = null;
  let scopeDir = null;
  let project = null;
  let rootRecord = null;
  let operationId = null;
  try {
    const inspection = inspectLegacyStore({ legacyRoot: legacy.root });
    assertEqual('legacy-audit', inspection.audit.ok, true);

    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    const backup = backupStore(legacyDbPath, backupDir ?? join(profileRoot, 'backups', `migration-${stamp}`));

    const registry = openRegistry({ root: profileRoot, create: true, now });
    registryDb = registry.db;
    registryDb.exec('BEGIN IMMEDIATE');
    project = createProject(registryDb, { name: projectName, now });
    rootRecord = addRoot(registryDb, { scopeKind: 'prj', scopeId: project.id, path: rootPath, addedBy: 'human', now });
    registryDb.exec('COMMIT');

    scopeDir = scopeRootFor(profileRoot, project.id);
    const opened = openDatabase({ root: scopeDir, create: true, now });
    destinationDb = opened.db;

    operationId = newId('op_', now);
    const copy = withTransaction(destinationDb, () => ({
      ...copyStore(source, destinationDb, { now }),
    }));

    const verification = verifyMigration(source, destinationDb);

    withTransaction(registryDb, () => {
      registryDb.prepare(`INSERT INTO operations (id, kind, state, started_at, finished_at, detail)
        VALUES (?, 'migrate', 'committed', ?, ?, ?)`)
        .run(operationId, now, now, JSON.stringify({ projectId: project.id, rootId: rootRecord.id, source: legacyDbPath }));
      const step = registryDb.prepare(`INSERT INTO operation_steps (operation_id, step, state, effect_key, updated_at)
        VALUES (?, ?, 'done', ?, ?)`);
      for (const name of ['inspect', 'backup', 'copy', 'verify', 'commit']) {
        step.run(operationId, name, `${operationId}:${name}`, now);
      }
      appendRegistryAudit(registryDb, {
        at: now, actor: 'human', action: 'migrate', target: project.id, outcome: 'ok',
        detail: JSON.stringify({ operationId, counts: verification.counts, backup: backup.path }),
      });
    });

    if (sha256File(legacyDbPath) !== beforeSha) {
      throw new RagError('internal', 'el almacén de origen cambió durante la migración');
    }

    return {
      project: { id: project.id, name: project.name },
      root: rootRecord,
      scope: { id: project.id, path: scopeDir, database: join(scopeDir, 'rag.sqlite3') },
      operationId,
      backup,
      counts: verification.counts,
      verification,
      legacy: { path: legacyDbPath, sha256: beforeSha, untouched: true },
      meta: copy.meta,
    };
  } catch (error) {
    // Rollback: nada del ámbito nuevo ni del registro debe sobrevivir a un fallo.
    try {
      if (destinationDb) closeDatabase(destinationDb);
    } catch {
      // ya cerrado
    }
    destinationDb = null;
    if (scopeDir) {
      try {
        rmSync(scopeDir, { recursive: true, force: true });
        // El directorio `scopes/` del perfil se creó para este intento: si quedó vacío, no se deja.
        rmSync(dirname(scopeDir), { recursive: false });
      } catch {
        // el rollback no debe ocultar el error original
      }
    }
    if (registryDb && project) {
      try {
        registryDb.exec('BEGIN IMMEDIATE');
        if (rootRecord) registryDb.prepare('DELETE FROM roots WHERE id = ?').run(rootRecord.id);
        registryDb.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
        registryDb.exec('COMMIT');
      } catch {
        try {
          registryDb.exec('ROLLBACK');
        } catch {
          // sin transacción abierta
        }
      }
    }
    throw error;
  } finally {
    try {
      source.close();
    } catch {
      // ya cerrado
    }
    if (destinationDb) closeDatabase(destinationDb);
    if (registryDb) {
      try {
        registryDb.close();
      } catch {
        // ya cerrado
      }
    }
  }
}
