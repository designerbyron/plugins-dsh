/**
 * Recuperación de almacenes de ámbito (PA4-A).
 *
 * Qué es regenerable y qué no:
 * - **Autoritativo** (se copia exactamente): `sources`, `chunks`, `source_tags`, `audit`, `meta`
 *   (revisión, modelo de embeddings, creación) y `metrics_daily`/`policies` cuando están legibles.
 * - **Regenerable**: FTS5 (`rebuild` desde `chunks`), vectores del proveedor local determinista
 *   (`embedText` sobre el texto de cada chunk).
 * - **No regenerable sin red**: vectores de un proveedor remoto. Si no están, la recuperación se
 *   detiene; no se inventan ni se descargan.
 *
 * Garantías del procedimiento:
 * 1. El original **nunca** se modifica: sólo se abre en solo lectura.
 * 2. El almacén nuevo se construye en un directorio temporal hermano.
 * 3. Se verifica antes de sustituir: recuentos, digest de datos autoritativos, FTS, vectores,
 *    cadena de auditoría y cabecera del almacén.
 * 4. La sustitución es un `rename` del original a cuarentena y del temporal a su sitio; si el segundo
 *    `rename` falla, el primero se deshace.
 * 5. La cuarentena se conserva: `rollback` restaura el original sin borrar el intento fallido.
 *
 * Una biblioteca **ausente** no se «recupera» creándola: la ausencia es un estado que se informa, y
 * crear el almacén (o conceder permisos) es una decisión humana explícita.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { appendAudit, verifyAuditChain } from './audit.mjs';
import {
  closeDatabase, ftsIntegrityCheck, ftsRebuild, openDatabase, quickCheck, readMeta, withTransaction, writeMeta,
} from './db.mjs';
import { embedText, vectorToBlob } from './embed.mjs';
import { RagError } from './errors.mjs';
import { classifyScopeStore, isServable, storeFileOf } from './library-state.mjs';
import { beginOperation, finishOperation, recordStep } from './operations.mjs';
import { scopeRoot } from './profile.mjs';
import { appendRegistryAudit } from './registry.mjs';

/** Tablas autoritativas que se copian tal cual. `chunks_fts` se reconstruye después. */
const AUTHORITATIVE_TABLES = Object.freeze(['sources', 'chunks', 'source_tags', 'audit']);

const SOURCE_COLUMNS = 'id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at';
const CHUNK_COLUMNS = 'id, chunk_key, source_id, ordinal, title, heading, text, char_start, char_end, token_est';

function stampOf(now = Date.now()) {
  return `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
}

function countOf(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

function tablesOf(db) {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((row) => row.name);
}

/** Digest estable de los datos autoritativos de un almacén. */
export function digestStore(db) {
  const hash = createHash('sha256');
  for (const row of db.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources ORDER BY id`).all()) {
    hash.update(`s|${row.id}|${row.collection}|${row.uri}|${row.sha256}|${row.bytes}|${row.char_count}\n`);
  }
  for (const row of db.prepare('SELECT chunk_key, source_id, ordinal, text FROM chunks ORDER BY chunk_key').all()) {
    const text = createHash('sha256').update(row.text, 'utf8').digest('hex');
    hash.update(`c|${row.chunk_key}|${row.source_id}|${row.ordinal}|${text}\n`);
  }
  for (const row of db.prepare('SELECT source_id, tag FROM source_tags ORDER BY source_id, tag').all()) {
    hash.update(`t|${row.source_id}|${row.tag}\n`);
  }
  return hash.digest('hex');
}

/**
 * Inspecciona un almacén dañado sin modificarlo. Devuelve si sus datos autoritativos se pueden
 * copiar y si la cadena de auditoría está íntegra.
 */
export function inspectRecoverableStore(file) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 250');
  } catch (error) {
    return { readable: false, reason: String(error?.errstr ?? error?.message ?? error), counts: null, audit: null };
  }
  try {
    let tables;
    try {
      tables = tablesOf(db);
    } catch (error) {
      return { readable: false, reason: String(error?.errstr ?? error?.message ?? error), counts: null, audit: null };
    }
    const missing = AUTHORITATIVE_TABLES.filter((name) => !tables.includes(name)) ;
    if (missing.length > 0) {
      return { readable: false, reason: 'missing-tables', missing, counts: null, audit: null };
    }
    const counts = {
      sources: countOf(db, 'sources'),
      chunks: countOf(db, 'chunks'),
      tags: countOf(db, 'source_tags'),
      audit: countOf(db, 'audit'),
    };
    counts.vectors = tables.includes('vectors') ? countOf(db, 'vectors') : 0;
    let integrity = null;
    try {
      integrity = db.prepare('PRAGMA quick_check').all().map((row) => String(row.quick_check)).join(',');
    } catch (error) {
      integrity = `error:${error?.message ?? error}`;
    }
    let audit;
    try {
      audit = verifyAuditChain(db);
    } catch (error) {
      audit = { ok: false, reason: String(error?.message ?? error) };
    }
    let orphanChunks = null;
    try {
      orphanChunks = Number(db.prepare(
        'SELECT COUNT(*) AS n FROM chunks c LEFT JOIN sources s ON s.id = c.source_id WHERE s.id IS NULL',
      ).get().n);
    } catch {
      orphanChunks = null;
    }
    let digest = null;
    try {
      digest = digestStore(db);
    } catch {
      digest = null;
    }
    return {
      readable: true,
      reason: 'readable',
      counts,
      integrity,
      audit,
      orphanChunks,
      digest,
      dataComplete: orphanChunks === 0 && digest !== null,
    };
  } finally {
    try { db.close(); } catch { /* solo lectura */ }
  }
}

/**
 * Plan de recuperación. No modifica nada.
 *
 * `plan`: `none` (no hay nada que recuperar o no corresponde), `blocked` (indisponible o datos
 * incompletos), `rebuild` (datos y auditoría recuperables) o `reinit` (almacén ilegible: sólo cabe
 * conservar el original y construir uno vacío con autorización explícita de pérdida de datos).
 */
export function planRecovery({ profileRootPath, profileKey, scope, checkIntegrity = true } = {}) {
  const state = classifyScopeStore({ profileRootPath, profileKey, scope, checkIntegrity });
  const plan = {
    scopeId: scope.id,
    scopeKind: scope.kind,
    state: state.state,
    reason: state.reason,
    plan: 'none',
    recoverable: false,
    counts: null,
    audit: null,
    issues: [],
  };
  if (isServable(state.state)) return { ...plan, plan: 'none', reason: 'store-servable' };
  if (state.state === 'missing') return { ...plan, plan: 'none', reason: 'missing-store', issues: ['ausente'] };
  if (state.state === 'unavailable') {
    return { ...plan, plan: 'blocked', issues: [state.reason] };
  }
  const inspection = inspectRecoverableStore(storeFileOf(profileRootPath, scope.id));
  plan.counts = inspection.counts;
  plan.audit = inspection.audit;
  if (!inspection.readable) {
    // Un almacén ilegible por permisos no es un almacén destruido: no se cuarentena a ciegas.
    const planName = state.state === 'unreadable' ? 'blocked' : 'reinit';
    return { ...plan, plan: planName, recoverable: false, issues: [inspection.reason] };
  }
  if (inspection.dataComplete && inspection.audit?.ok) {
    return { ...plan, plan: 'rebuild', recoverable: true, digest: inspection.digest, inspection };
  }
  return {
    ...plan,
    plan: 'blocked',
    recoverable: false,
    issues: [
      ...(inspection.dataComplete ? [] : ['datos-incompletos']),
      ...(inspection.audit?.ok ? [] : [`auditoria:${inspection.audit?.reason ?? 'desconocida'}`]),
    ],
  };
}

function copyAuthoritative(source, target, { now }) {
  const insertSource = target.prepare(`INSERT INTO sources (${SOURCE_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of source.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources ORDER BY id`).all()) {
    insertSource.run(row.id, row.collection, row.uri, row.title, row.mime, row.sha256, row.bytes,
      row.char_count, row.metadata, row.created_at, row.updated_at, row.indexed_at);
  }
  const insertChunk = target.prepare(`INSERT INTO chunks (${CHUNK_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const row of source.prepare(`SELECT ${CHUNK_COLUMNS} FROM chunks ORDER BY id`).all()) {
    insertChunk.run(row.id, row.chunk_key, row.source_id, row.ordinal, row.title, row.heading, row.text,
      row.char_start, row.char_end, row.token_est);
  }
  const insertTag = target.prepare('INSERT INTO source_tags (source_id, tag) VALUES (?, ?)');
  for (const row of source.prepare('SELECT source_id, tag FROM source_tags ORDER BY source_id, tag').all()) {
    insertTag.run(row.source_id, row.tag);
  }
  const insertAudit = target.prepare(`INSERT INTO audit (seq, at, actor, session_id, call_id, tool, action, target, outcome, details, prev_hash, hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of source.prepare(`SELECT seq, at, actor, session_id, call_id, tool, action, target, outcome, details, prev_hash, hash
    FROM audit ORDER BY seq`).all()) {
    insertAudit.run(row.seq, row.at, row.actor, row.session_id, row.call_id, row.tool, row.action, row.target,
      row.outcome, row.details, row.prev_hash, row.hash);
  }
  const head = target.prepare('SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1').get();
  writeMeta(target, 'audit_head_seq', String(head ? head.seq : 0));
  writeMeta(target, 'audit_head_hash', head ? head.hash : '');
  const createdAt = readMeta(source, 'created_at');
  const model = readMeta(source, 'embedding_model');
  const revision = readMeta(source, 'index_revision');
  if (createdAt !== undefined && createdAt !== null) writeMeta(target, 'created_at', String(createdAt));
  if (model !== undefined && model !== null) writeMeta(target, 'embedding_model', String(model));
  writeMeta(target, 'index_revision', String(Number(revision ?? '0') + 1));
  // Métricas y políticas son operativas: se conservan si la tabla de origen está legible.
  const sourceTables = tablesOf(source);
  if (sourceTables.includes('metrics_daily')) {
    const insertMetric = target.prepare(`INSERT OR REPLACE INTO metrics_daily (day, metric, dim, value, updated_at)
      VALUES (?,?,?,?,?)`);
    for (const row of source.prepare('SELECT day, metric, dim, value, updated_at FROM metrics_daily').all()) {
      insertMetric.run(row.day, row.metric, row.dim, row.value, row.updated_at);
    }
  }
  if (sourceTables.includes('policies')) {
    const insertPolicy = target.prepare(`INSERT OR REPLACE INTO policies (key, value, updated_at) VALUES (?,?,?)`);
    for (const row of source.prepare('SELECT key, value, updated_at FROM policies').all()) {
      insertPolicy.run(row.key, row.value, row.updated_at);
    }
  }
  return { at: now };
}

function insertVectors(target, { config, now }) {
  const local = config.embedding.provider === 'local-hash-v1';
  if (!local) {
    throw new RagError('recovery-verification-failed', 'los vectores de un proveedor remoto no se regeneran sin red', {
      details: { provider: config.embedding.provider, reason: 'vectors-not-regenerable-offline' },
    });
  }
  const rows = target.prepare('SELECT chunk_key, text FROM chunks ORDER BY chunk_key').all();
  const insert = target.prepare('INSERT INTO vectors (chunk_key, model, dim, vec) VALUES (?, ?, ?, ?)');
  for (const row of rows) {
    const vector = embedText(row.text, config.embedding);
    insert.run(row.chunk_key, config.embedding.provider, config.embedding.dim, vectorToBlob(vector));
  }
  return { chunks: rows.length, model: config.embedding.provider, dim: config.embedding.dim, at: now };
}

function verifyRecovered({ target, expected, config }) {
  quickCheck(target);
  ftsIntegrityCheck(target);
  const audit = verifyAuditChain(target);
  if (!audit.ok) {
    throw new RagError('recovery-verification-failed', 'la cadena de auditoría del almacén recuperado no verifica', {
      details: audit,
    });
  }
  const counts = {
    sources: countOf(target, 'sources'),
    chunks: countOf(target, 'chunks'),
    tags: countOf(target, 'source_tags'),
    audit: countOf(target, 'audit'),
    vectors: countOf(target, 'vectors'),
  };
  if (expected.counts.sources !== counts.sources || expected.counts.chunks !== counts.chunks) {
    throw new RagError('recovery-verification-failed', 'los recuentos del almacén recuperado no coinciden', {
      details: { expected: { sources: expected.counts.sources, chunks: expected.counts.chunks }, found: counts },
    });
  }
  if (counts.vectors !== counts.chunks) {
    throw new RagError('recovery-verification-failed', 'el índice de vectores no cubre todos los chunks', {
      details: { chunks: counts.chunks, vectors: counts.vectors, model: config.embedding.provider },
    });
  }
  const digest = digestStore(target);
  if (expected.digest !== null && digest !== expected.digest) {
    throw new RagError('recovery-verification-failed', 'los datos autoritativos cambiaron durante la recuperación', {
      details: { expected: expected.digest, found: digest },
    });
  }
  return { counts, digest, audit };
}

/**
 * Añade la entrada de auditoría de la propia recuperación y verifica el almacén ya con ella: la
 * cadena que se va a publicar es la que se comprueba, no una anterior.
 */
function appendRecoveryAuditThenVerify({ target, plan, scope, actor, sessionId, operation, now, config, expected }) {
  appendAudit(target, {
    at: now,
    actor,
    sessionId,
    callId: operation?.id ?? null,
    tool: 'lifecode_rag_recover',
    action: plan.plan === 'rebuild' ? 'recovery.rebuild' : 'recovery.reinit',
    target: scope.id,
    outcome: 'ok',
    details: { scopeKind: scope.kind, counts: plan.counts },
  });
  const verification = verifyRecovered({
    target,
    expected: plan.plan === 'rebuild' ? expected : { counts: { sources: 0, chunks: 0 }, digest: null },
    config,
  });
  return {
    ...verification,
    counts: { ...verification.counts, audit: countOf(target, 'audit') },
  };
}

function swapIn(staging, scopeDir, now) {
  const quarantine = `${scopeDir}.quarantine-${stampOf(now)}`;
  renameSync(scopeDir, quarantine);
  try {
    renameSync(staging, scopeDir);
  } catch (error) {
    renameSync(quarantine, scopeDir);
    throw new RagError('recovery-verification-failed', 'no se pudo sustituir el almacén; el original sigue en su sitio', {
      details: { staging, scopeDir, quarantine },
      cause: error,
    });
  }
  return quarantine;
}

/**
 * Recupera un almacén corrupto o ilegible.
 *
 * @param {'auto'|'rebuild'|'reinit'} mode `auto` decide con el plan; `rebuild` exige datos legibles;
 *   `reinit` acepta pérdida de datos y sólo construye un almacén vacío conservando el original.
 */
export function recoverScopeStore({
  profileRootPath, profileKey, scope, config, mode = 'auto', confirm = false,
  now = Date.now(), actor = 'human', sessionId = null, registryDb = null,
} = {}) {
  if (confirm !== true) {
    throw new RagError('approval-required', 'recuperar un almacén exige confirmación humana explícita', {
      details: { scope: scope?.id, mode },
    });
  }
  if (!config?.embedding?.provider) {
    throw new RagError('invalid-argument', 'la recuperación necesita la configuración de embeddings');
  }
  const plan = planRecovery({ profileRootPath, profileKey, scope });
  if (plan.plan === 'none' || plan.plan === 'blocked') {
    if (plan.plan === 'blocked') {
      throw new RagError('recovery-verification-failed', 'el almacén no se puede recuperar con seguridad', {
        details: { scopeId: scope.id, state: plan.state, reason: plan.reason, issues: plan.issues },
      });
    }
    return { action: 'none', scopeId: scope.id, state: plan.state, reason: plan.reason };
  }
  if (mode !== 'auto' && mode !== plan.plan) {
    throw new RagError('recovery-verification-failed', 'el modo pedido no corresponde al estado del almacén', {
      details: { requested: mode, planned: plan.plan, state: plan.state },
    });
  }

  const scopeDir = scopeRoot(profileRootPath, scope.id);
  const staging = `${scopeDir}.recovery-${stampOf(now)}`;
  const operation = registryDb
    ? beginOperation(registryDb, { kind: 'recovery', target: scope.id, now, detail: { mode: plan.plan } })
    : null;
  let source = null;
  let target = null;
  try {
    if (registryDb && operation) {
      recordStep(registryDb, { operationId: operation.id, step: 'inspect', effectKey: `${operation.id}:inspect`, now });
    }

    let expected = { counts: { sources: 0, chunks: 0 }, digest: null };
    if (plan.plan === 'rebuild') {
      source = new DatabaseSync(storeFileOf(profileRootPath, scope.id), { readOnly: true });
      source.exec('PRAGMA busy_timeout = 250');
      expected = { counts: plan.inspection.counts, digest: plan.inspection.digest };
    }

    mkdirSync(dirname(staging), { recursive: true });
    const opened = openDatabase({ root: staging, create: true, now });
    target = opened.db;
    writeMeta(target, 'scope_id', scope.id);
    writeMeta(target, 'scope_kind', scope.kind);
    writeMeta(target, 'profile_id', profileKey);
    writeMeta(target, 'profile_key', profileKey);
    writeMeta(target, 'store_state', 'recovering');
    if (registryDb && operation) {
      // El paso se registra en cuanto existe el directorio temporal, también en `reinit`: si el
      // proceso muere aquí, la operación queda abierta con evidencia de qué se llegó a crear.
      recordStep(registryDb, { operationId: operation.id, step: 'stage', effectKey: `${operation.id}:stage`, now });
    }

    if (plan.plan === 'rebuild') {
      withTransaction(target, () => {
        copyAuthoritative(source, target, { now });
        insertVectors(target, { config, now });
        ftsRebuild(target);
        ftsIntegrityCheck(target);
      });
    } else {
      ftsRebuild(target);
      ftsIntegrityCheck(target);
    }

    const verification = appendRecoveryAuditThenVerify({ target, plan, scope, actor, sessionId, operation, now, config, expected });
    writeMeta(target, 'store_state', 'recovered');
    if (registryDb) {
      recordStep(registryDb, { operationId: operation.id, step: 'verify', effectKey: `${operation.id}:verify`, now });
    }
    closeDatabase(target);
    target = null;
    if (source) {
      try { source.close(); } catch { /* solo lectura */ }
      source = null;
    }

    const quarantine = swapIn(staging, scopeDir, now);
    if (registryDb) {
      recordStep(registryDb, { operationId: operation.id, step: 'swap', effectKey: `${operation.id}:swap`, now });
      finishOperation(registryDb, { operationId: operation.id, state: 'committed', now });
      appendRegistryAudit(registryDb, {
        at: now,
        actor,
        sessionId,
        action: 'recovery',
        target: scope.id,
        outcome: 'ok',
        detail: JSON.stringify({ operationId: operation.id, mode: plan.plan, quarantine, counts: verification.counts }),
      });
    }
    return {
      action: 'recovered',
      scopeId: scope.id,
      mode: plan.plan,
      state: plan.state,
      quarantine,
      rollbackCommand: `library rollback --scope ${scope.id} --from "${quarantine}"`,
      verification,
    };
  } catch (error) {
    closeDatabase(target);
    if (source) {
      try { source.close(); } catch { /* solo lectura */ }
    }
    if (registryDb && operation) {
      recordStep(registryDb, {
        operationId: operation.id, step: 'stage', state: 'failed', effectKey: `${operation.id}:stage`, now,
      });
      finishOperation(registryDb, {
        operationId: operation.id,
        state: 'failed',
        now,
        detail: { reason: error?.code ?? 'internal', message: String(error?.message ?? error) },
      });
      // Una recuperación fallida también deja rastro: el original sigue intacto y el intento, registrado.
      try {
        appendRegistryAudit(registryDb, {
          at: now,
          actor,
          sessionId,
          action: 'recovery',
          target: scope.id,
          outcome: 'failed',
          detail: JSON.stringify({ operationId: operation.id, mode: plan.plan, reason: error?.code ?? 'internal', staging }),
        });
      } catch { /* el fallo original manda */ }
    }
    throw error;
  }
}

/** Lista las cuarentenas disponibles y los directorios de trabajo huérfanos. */
export function listRecoveryArtifacts({ profileRootPath, scope }) {
  const scopesDir = dirname(scopeRoot(profileRootPath, scope.id));
  if (!existsSync(scopesDir)) return { quarantine: [], staging: [], failed: [] };
  const entries = readdirSync(scopesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${scope.id}.`))
    .map((entry) => entry.name);
  return {
    quarantine: entries.filter((name) => name.includes('.quarantine-')).map((name) => join(scopesDir, name)),
    staging: entries.filter((name) => name.includes('.recovery-')).map((name) => join(scopesDir, name)),
    failed: entries.filter((name) => name.includes('.failed-')).map((name) => join(scopesDir, name)),
  };
}

/**
 * Restaura una cuarentena. No borra el almacén actual: lo aparta con sufijo `.failed-`, de modo que
 * un rollback equivocado sigue siendo reversible.
 */
export function rollbackRecovery({
  profileRootPath, scope, quarantine, now = Date.now(), registryDb = null, actor = 'human', sessionId = null,
} = {}) {
  const scopeDir = scopeRoot(profileRootPath, scope.id);
  const scopesDir = dirname(scopeDir);
  if (typeof quarantine !== 'string' || !quarantine.startsWith(join(scopesDir, `${scope.id}.quarantine-`))) {
    throw new RagError('invalid-argument', 'la cuarentena no pertenece a este ámbito', { details: { quarantine } });
  }
  if (!existsSync(quarantine)) {
    throw new RagError('invalid-argument', 'la cuarentena no existe', { details: { quarantine } });
  }
  if (!existsSync(scopeDir)) {
    throw new RagError('invalid-argument', 'no hay almacén actual que sustituir', { details: { scopeDir } });
  }
  const aside = `${scopeDir}.failed-${stampOf(now)}`;
  renameSync(scopeDir, aside);
  try {
    renameSync(quarantine, scopeDir);
  } catch (error) {
    renameSync(aside, scopeDir);
    throw new RagError('recovery-verification-failed', 'no se pudo restaurar la cuarentena', {
      details: { quarantine, scopeDir },
      cause: error,
    });
  }
  if (registryDb) {
    // La restauración mueve almacenes: sin esta entrada la auditoría del registro no explicaría por
    // qué el almacén actual es otro. Un fallo de auditoría no puede deshacer una restauración hecha.
    try {
      appendRegistryAudit(registryDb, {
        at: now,
        actor,
        sessionId,
        action: 'recovery.rollback',
        target: scope.id,
        outcome: 'ok',
        detail: `restaurado ${scopeDir}; el almacén sustituido queda en ${aside}`,
      });
    } catch { /* el rollback ya ocurrió */ }
  }
  return { restored: scopeDir, previous: aside, from: quarantine };
}

/** Estado de todos los almacenes de un ámbito del perfil, en solo lectura. */
export function scopeHealth({ profileRootPath, profileKey, scopes = [] } = {}) {
  return scopes.map((scope) => {
    const entry = classifyScopeStore({ profileRootPath, profileKey, scope });
    const artifacts = listRecoveryArtifacts({ profileRootPath, scope });
    return {
      scopeId: scope.id,
      kind: scope.kind,
      name: scope.name ?? null,
      state: entry.state,
      reason: entry.reason,
      path: entry.path,
      bytes: entry.bytes,
      artifacts,
    };
  });
}
