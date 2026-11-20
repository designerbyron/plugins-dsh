/**
 * Diagnóstico del perfil Project-Aware (sólo lectura).
 *
 * Responde a la pregunta operativa «¿está sano lo que tengo instalado?» sin abrir nada en
 * escritura y sin tocar el registro: perfil y configuración efectiva, integridad del registro y
 * de cada almacén de ámbito, cadenas de auditoría, recuentos, sincronización y selección humana.
 *
 * No repara nada a propósito: un diagnóstico que escribe deja de ser un diagnóstico.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { verifyAuditChain } from './audit.mjs';
import { closeRegistry, openRegistry, registryIntegrity } from './registry.mjs';
import { classifyScopeStore, isServable } from './library-state.mjs';
import { listRecoveryArtifacts } from './recovery.mjs';
import { loadConfig } from './paths.mjs';
import { resolveConfig, resolveDataRoot, resolveProfileKey } from './config-resolve.mjs';
import { profileKey, profileRoot, registryPath } from './profile.mjs';

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function countsOf(storeFile) {
  let store;
  try {
    store = new DatabaseSync(storeFile, { readOnly: true });
    store.exec('PRAGMA busy_timeout = 2000');
    const one = (sql) => Number(store.prepare(sql).get()?.n ?? 0);
    const model = store.prepare("SELECT value FROM meta WHERE key = 'embedding_model'").get()?.value ?? null;
    const result = {
      sources: one('SELECT COUNT(*) AS n FROM sources'),
      chunks: one('SELECT COUNT(*) AS n FROM chunks'),
      vectors: one('SELECT COUNT(*) AS n FROM vectors'),
      fts: one('SELECT COUNT(*) AS n FROM chunks_fts'),
      orphanChunks: one('SELECT COUNT(*) AS n FROM chunks c LEFT JOIN sources s ON s.id = c.source_id WHERE s.id IS NULL'),
      missingVectors: model
        ? one('SELECT COUNT(*) AS n FROM chunks c LEFT JOIN vectors v ON v.chunk_key = c.chunk_key AND v.model = ' + `'${String(model).replaceAll("'", "''")}'` + ' WHERE v.chunk_key IS NULL')
        : null,
    // Windows no distingue mayúsculas en rutas: un renombrado que sólo cambia el caso puede dejar dos
    // fuentes para el mismo fichero. Se cuenta para que el usuario lo vea y decida; no se repara aquí.
    caseCollisions: one(
      'SELECT COUNT(*) AS n FROM (SELECT lower(uri) AS u FROM sources GROUP BY lower(uri) HAVING COUNT(*) > 1)',
    ),
      schemaVersion: Number(store.prepare('PRAGMA user_version').get().user_version),
    };
    result.audit = verifyAuditChain(store);
    return result;
  } catch (error) {
    return { error: error.code ?? 'unreadable', message: error.message };
  } finally {
    if (store) store.close();
  }
}

/**
 * @param {{env?:object, argv?:string[], now?:() => number}} [options]
 * @returns {{ok:boolean, profile:object, registry:object|null, scopes:object[], selections:object[], problems:string[]}}
 */
export function diagnoseProfile({ env = process.env, argv = process.argv, now = () => Date.now() } = {}) {
  const key = profileKey(env, argv);
  const root = profileRoot(env, argv);
  const configPath = join(root, 'config.json');
  const problems = [];

  const config = {
    path: configPath,
    exists: existsSync(configPath),
    bytes: existsSync(configPath) ? statSync(configPath).size : null,
    sha256: existsSync(configPath) ? sha256(configPath) : null,
  };
  try {
    // Configuración efectiva (perfil > global > defaults), la misma que aplican las herramientas.
    const loaded = resolveConfig({ dataRoot: resolveDataRoot(env), profileKey: resolveProfileKey(env) }).config;
    config.effectiveSearch = { diversity: loaded.search.diversity, strategy: loaded.search.strategy, limit: loaded.search.limit };
    config.automation = {
      enabled: loaded.automation.enabled,
      intervalMs: loaded.automation.intervalMs,
      maxFilesPerRun: loaded.automation.maxFilesPerRun,
      tickBudgetMs: loaded.automation.tickBudgetMs,
    };
    config.autoContext = { enabled: loaded.autoContext.enabled, timeoutMs: loaded.autoContext.timeoutMs };
    config.embedding = { provider: loaded.embedding.provider, dim: loaded.embedding.dim };
    if (loaded.automation.enabled) problems.push('automation.enabled=true: la sincronización periódica está activa');
  } catch (error) {
    config.error = error.code ?? 'invalid-config';
    problems.push(`configuración ilegible: ${config.error}`);
  }

  const report = {
    generatedAt: new Date(now()).toISOString(),
    profile: { key, root, config },
    registry: null,
    scopes: [],
    selections: [],
    problems,
  };

  const registryFile = registryPath(root);
  if (!existsSync(registryFile)) {
    report.registry = { path: registryFile, exists: false };
    problems.push('el perfil no tiene registro Project-Aware (todavía no hay proyecto registrado)');
    return { ...report, ok: false };
  }

  let opened;
  try {
    opened = openRegistry({ root, create: false, now: now() });
  } catch (error) {
    report.registry = { path: registryFile, exists: true, error: error.code ?? 'registry-unavailable', message: error.message };
    problems.push(`registro ilegible: ${report.registry.error}`);
    return { ...report, ok: false };
  }

  try {
    const db = opened.db;
    const integrity = registryIntegrity(db);
    const projects = db.prepare('SELECT id, name, status FROM projects ORDER BY created_at').all();
    const libraries = db.prepare('SELECT id, name, status FROM libraries ORDER BY name').all();
    const roots = db.prepare('SELECT id, scope_kind, scope_id, path, state FROM roots ORDER BY path').all();
    const grants = db.prepare('SELECT project_id, library_id FROM grants WHERE revoked_at IS NULL').all();
    const sessions = db.prepare('SELECT session_id, project_id, state, revision, selection_source, selected_by FROM session_scope').all();
    const unfinished = db.prepare("SELECT id, kind FROM operations WHERE state = 'started'").all();
    const syncRows = db
      .prepare('SELECT scope_kind, scope_id, status, COUNT(*) AS n FROM sync_state GROUP BY scope_kind, scope_id, status')
      .all();

    report.registry = {
      path: registryFile,
      exists: true,
      bytes: statSync(registryFile).size,
      sha256: sha256(registryFile),
      quickCheck: integrity.quickCheck,
      foreignKeys: integrity.foreignKeys,
      audit: integrity.audit,
      projects,
      libraries,
      roots,
      grants,
      sessionCount: sessions.length,
      unfinishedOperations: unfinished,
    };
    report.selections = sessions;

    if (integrity.quickCheck !== 'ok') problems.push(`registro: quick_check=${integrity.quickCheck}`);
    if (integrity.foreignKeys !== 0) problems.push(`registro: ${integrity.foreignKeys} violaciones de clave ajena`);
    if (!integrity.audit?.ok) problems.push(`registro: cadena de auditoría rota en ${integrity.audit?.brokenAt}`);
    if (unfinished.length > 0) problems.push(`registro: ${unfinished.length} operación(es) sin cerrar`);

    const scopes = [
      ...projects.map((project) => ({ kind: 'prj', id: project.id, name: project.name, status: project.status })),
      ...libraries.map((library) => ({ kind: 'lib', id: library.id, name: library.name, status: library.status })),
    ];
    for (const scope of scopes) {
      const entry = classifyScopeStore({ profileRootPath: root, profileKey: key, scope, checkIntegrity: true });
      const row = {
        scopeId: scope.id,
        kind: scope.kind,
        name: scope.name,
        status: scope.status,
        state: entry.state,
        reason: entry.reason ?? null,
        path: entry.path ?? null,
        bytes: entry.bytes ?? null,
        artifacts: listRecoveryArtifacts({ profileRootPath: root, scope }).length,
        roots: roots.filter((r) => r.scope_kind === scope.kind && r.scope_id === scope.id).map((r) => ({ path: r.path, state: r.state })),
        sync: syncRows
          .filter((r) => r.scope_kind === scope.kind && r.scope_id === scope.id)
          .reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {}),
      };
      if (isServable(entry.state) && entry.path && existsSync(entry.path)) row.counts = countsOf(entry.path);
      report.scopes.push(row);
      if (!isServable(entry.state)) {
        problems.push(`ámbito ${scope.id} (${scope.name ?? scope.kind}): estado ${entry.state}${entry.reason ? ` (${entry.reason})` : ''}`);
      }
      const counts = row.counts;
      if (counts && !counts.error) {
        if (counts.chunks !== counts.fts) problems.push(`ámbito ${scope.id}: FTS ${counts.fts} ≠ chunks ${counts.chunks}`);
        if (counts.orphanChunks) problems.push(`ámbito ${scope.id}: ${counts.orphanChunks} chunks huérfanos`);
        if (counts.missingVectors) problems.push(`ámbito ${scope.id}: ${counts.missingVectors} vectores faltantes`);
        if (counts.caseCollisions) {
          problems.push(
            `ámbito ${scope.id}: ${counts.caseCollisions} ruta(s) duplicadas sólo por mayúsculas/minúsculas ` +
              '(renombrado de caso); revisa las fuentes y usa forget en la duplicada',
          );
        }
        if (!counts.audit?.ok) problems.push(`ámbito ${scope.id}: cadena de auditoría rota en ${counts.audit?.brokenAt}`);
      }
    }
  } finally {
    closeRegistry(opened.db);
  }

  return { ...report, ok: problems.length === 0 };
}
