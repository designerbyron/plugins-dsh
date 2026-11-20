#!/usr/bin/env node
/**
 * CLI de LifeCode RAG. No registra herramientas ni habla con el host: sirve para diagnosticar, verificar
 * y recuperar los almacenes antes o después de una operación. Nunca crea un almacén que falte.
 *
 *   node bin/lifecode-rag.mjs doctor
 *   node bin/lifecode-rag.mjs project create --name <nombre> [--create] | project list
 *   node bin/lifecode-rag.mjs root add --project <prj_id> --path <ruta absoluta> [--create] | root list
 *   node bin/lifecode-rag.mjs select --session <id> --project <prj_id> [--by human|host]
 *   node bin/lifecode-rag.mjs session show --session <id>
 *   node bin/lifecode-rag.mjs audit export|verify
 *   node bin/lifecode-rag.mjs library status|verify|plan|recover|rollback
 *   node bin/lifecode-rag.mjs sync run [--scope <id>] [--dry-run] [--limit n] | sync status
 */

import { auditState, exportAuditJsonl, verifyAuditExport } from '../lib/audit-export.mjs';
import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { diagnoseProfile } from '../lib/diagnose.mjs';
import { runDoctor } from '../lib/doctor.mjs';
import { loadConfig, ragRoot, storePaths } from '../lib/paths.mjs';
import { profileKey, profileRoot } from '../lib/profile.mjs';
import { closeRegistry, openRegistry, addRoot, createProject, getProject, listRoots } from '../lib/registry.mjs';
import { describeProject, registerDiscoveredProject, scanWorkspace } from '../lib/discovery.mjs';
import { addTrustedRoot, listTrustedRoots, removeTrustedRoot } from '../lib/trusted-roots.mjs';
import { getSession, registerSelection } from '../lib/sessions.mjs';
import {
  listRecoveryArtifacts, planRecovery, recoverScopeStore, rollbackRecovery, scopeHealth,
} from '../lib/recovery.mjs';
import { isServable } from '../lib/library-state.mjs';
import { activeSyncScopes, syncScopes, syncStatus } from '../lib/sync.mjs';

const argv = process.argv.slice(2);
const [command, subcommand] = argv;

function fail(message, code = 1) {
  console.error(`✗ ${message}`);
  process.exit(code);
}

function flag(name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

if (command === 'doctor') {
  const root = ragRoot(process.env);
  const report = runDoctor({ root });
  console.log(`LifeCode RAG · ${root}`);
  for (const item of report.checks) {
    const icon = item.status === 'ok' ? '✓' : item.status === 'warn' ? '!' : '✗';
    console.log(`  ${icon} ${item.name}: ${item.detail}`);
  }
  console.log(`  · perfil Project-Aware: ${profileKey(process.env)} (usa \`diagnose\` para el detalle del registro y los almacenes)`);
  process.exit(report.ok ? 0 : 1);
}

if (command === 'diagnose') {
  // Diagnóstico del perfil Project-Aware: sólo lectura, sin reparar nada y sin tocar el registro.
  const report = diagnoseProfile({ env: process.env });
  if (flag('json', false)) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
  const icon = (value) => (value ? '✓' : '✗');
  console.log(`LifeCode RAG · diagnóstico del perfil ${report.profile.key}`);
  console.log(`  ${icon(Boolean(report.profile.config.sha256))} perfil: ${report.profile.root}`);
  const cfg = report.profile.config;
  console.log(
    `  ${icon(!cfg.error)} configuración: ${cfg.exists ? `${cfg.bytes} B sha256 ${String(cfg.sha256).slice(0, 12)}…` : 'no existe (valores por defecto)'}` +
      `${cfg.automation ? ` · automation=${cfg.automation.enabled ? 'ON' : 'off'}` : ''}` +
      `${cfg.autoContext ? ` · autoContext=${cfg.autoContext.enabled ? 'ON' : 'off'}` : ''}`,
  );
  const reg = report.registry;
  if (!reg?.exists) {
    console.log('  ✗ registro: no existe en este perfil');
  } else if (reg.error) {
    console.log(`  ✗ registro: ${reg.error} (${reg.path})`);
  } else {
    console.log(
      `  ${icon(reg.quickCheck === 'ok' && reg.foreignKeys === 0 && reg.audit?.ok)} registro: ${reg.bytes} B · quick_check=${reg.quickCheck} · fk=${reg.foreignKeys} · auditoría=${reg.audit?.count ?? 0}${reg.audit?.ok ? ' ok' : ` ROTA en ${reg.audit?.brokenAt}`} · operaciones sin cerrar=${reg.unfinishedOperations.length}`,
    );
    for (const item of report.scopes) {
      const counts = item.counts && !item.counts.error ? item.counts : null;
      const detail = counts
        ? `${counts.sources} fuentes / ${counts.chunks} chunks / ${counts.vectors} vectores · sync ${Object.entries(item.sync ?? {}).map(([k, v]) => `${k}=${v}`).join(' ') || 'sin filas'} · auditoría=${counts.audit?.count ?? 0}${counts.audit?.ok ? '' : ' ROTA'}`
        : item.reason ?? 'sin almacén';
      console.log(`  ${isServable(item.state) ? '✓' : '✗'} ${item.kind === 'prj' ? 'proyecto' : 'biblioteca'} ${item.name ?? item.scopeId}: ${item.state}${item.state === 'present' ? '' : ` (${detail})`}${item.state === 'present' ? ` · ${detail}` : ''}`);
    }
    for (const selection of report.selections) {
      console.log(`  · sesión ${selection.session_id}: ${selection.state} (${selection.selection_source}/${selection.selected_by}, revisión ${selection.revision})`);
    }
  }
  if (report.problems.length > 0) {
    console.log('  problemas:');
    for (const problem of report.problems) console.log(`    ✗ ${problem}`);
  }
  console.log(`RESULTADO: ${report.ok ? 'sin problemas' : `${report.problems.length} problema(s)`}`);
  process.exit(report.ok ? 0 : 1);
}

if (command === 'audit' && (subcommand === 'export' || subcommand === 'verify')) {
  const root = ragRoot(process.env);
  loadConfig(root);
  const opened = openDatabase({ root, create: false });
  try {
    const path = storePaths(root).audit;
    if (subcommand === 'export') {
      const result = exportAuditJsonl(opened.db, { path });
      console.log(`✓ auditoría exportada: ${result.entries} entrada(s), ${result.bytes} bytes → ${path}`);
    } else {
      const result = verifyAuditExport(opened.db, { path });
      if (result.ok) {
        console.log(`✓ auditoría coherente: ${result.entries} entrada(s), base y fichero coinciden`);
      } else {
        fail(`auditoría incoherente: ${result.reason}${result.seq ? ` (seq ${result.seq})` : ''}`);
      }
      const state = auditState(opened.db, { path });
      if (!state.ok) fail(`estado de auditoría inválido: ${state.where}/${state.reason}`);
    }
  } finally {
    closeDatabase(opened.db);
  }
  process.exit(0);
}

/** Todos los ámbitos del registro con su nombre y estado; sólo lee. */
function allScopes(registryDb) {
  const projects = registryDb.prepare(`SELECT id, name, status FROM projects ORDER BY name`).all()
    .map((row) => ({ id: row.id, kind: 'prj', name: row.name, status: row.status }));
  const libraries = registryDb.prepare(`SELECT id, name, status FROM libraries ORDER BY name`).all()
    .map((row) => ({ id: row.id, kind: 'lib', name: row.name, status: row.status }));
  return [...projects, ...libraries];
}

function findScope(registryDb, id) {
  if (typeof id !== 'string' || id.length === 0) fail('falta --scope <scope_id>', 2);
  const scope = allScopes(registryDb).find((entry) => entry.id === id);
  if (!scope) fail(`no existe el ámbito ${id} en este perfil`, 2);
  return scope;
}

if (command === 'library') {
  const env = process.env;
  const root = profileRoot(env);
  const key = profileKey(env);
  const now = Date.now();
  let registry;
  try {
    registry = openRegistry({ root, create: false, now });
  } catch (error) {
    fail(`registro no disponible en ${root}: ${error?.message ?? error}`);
  }
  try {
    if (!subcommand || subcommand === 'status' || subcommand === 'verify') {
      const scopes = allScopes(registry.db);
      const health = scopeHealth({ profileRootPath: root, profileKey: key, scopes });
      console.log(`LifeCode RAG · ${root}`);
      let blocked = 0;
      for (const entry of health) {
        const ok = subcommand === 'verify' ? isServable(entry.state) : true;
        if (!ok) blocked += 1;
        const icon = isServable(entry.state) ? '✓' : '✗';
        const size = entry.bytes ? `, ${entry.bytes} bytes` : '';
        console.log(`  ${icon} ${entry.kind} ${entry.scopeId} (${entry.name ?? 'sin nombre'}): ${entry.state}${size}${entry.reason ? ` — ${entry.reason}` : ''}`);
        for (const staging of entry.artifacts.staging) console.log(`      ! trabajo de recuperación sin terminar: ${staging}`);
        for (const quarantine of entry.artifacts.quarantine) console.log(`      · cuarentena disponible: ${quarantine}`);
      }
      process.exit(subcommand === 'verify' && blocked > 0 ? 1 : 0);
    }

    if (subcommand === 'plan' || subcommand === 'recover') {
      const scope = findScope(registry.db, flag('scope'));
      if (subcommand === 'plan') {
        const plan = planRecovery({ profileRootPath: root, profileKey: key, scope });
        console.log(JSON.stringify(plan, null, 2));
        process.exit(plan.plan === 'blocked' ? 1 : 0);
      }
      const { config } = loadConfig(root);
      const mode = flag('mode', 'auto');
      const result = recoverScopeStore({
        profileRootPath: root,
        profileKey: key,
        scope,
        config,
        mode,
        confirm: flag('confirm') === true,
        now,
        actor: 'human',
        registryDb: registry.db,
      });
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    if (subcommand === 'rollback') {
      const scope = findScope(registry.db, flag('scope'));
      const art = listRecoveryArtifacts({ profileRootPath: root, scope });
      const from = flag('from', null);
      const quarantine = from === null ? art.quarantine.at(-1) : String(from);
      if (!quarantine) fail(`no hay cuarentena para ${scope.id}; usa --from <ruta>`, 2);
      const result = rollbackRecovery({ profileRootPath: root, scope, quarantine, now, registryDb: registry.db });
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    fail('uso: library status|verify|plan --scope <id>|recover --scope <id> [--mode auto|rebuild|reinit] --confirm|rollback --scope <id> [--from <ruta>]', 2);
  } finally {
    closeRegistry(registry.db);
  }
}

if (command === 'sync') {
  const env = process.env;
  const root = profileRoot(env);
  const key = profileKey(env);
  const { config } = loadConfig(root);
  const now = Date.now();
  let registry;
  try {
    registry = openRegistry({ root, create: false, now });
  } catch (error) {
    fail(`registro no disponible en ${root}: ${error?.message ?? error}`);
  }
  try {
    if (!subcommand || subcommand === 'status') {
      const scopes = activeSyncScopes(registry.db);
      console.log(`LifeCode RAG · ${root}`);
      if (scopes.length === 0) console.log('  · ningún ámbito activo con raíz autorizada');
      for (const scope of scopes) {
        const status = syncStatus(registry.db, { scopeKind: scope.kind, scopeId: scope.id });
        const detail = status.length === 0
          ? 'sin sincronizar'
          : status.map((entry) => `${entry.status}=${entry.count}`).join(' ');
        console.log(`  · ${scope.kind} ${scope.id} (${scope.name}): ${detail}`);
      }
      process.exit(0);
    }

    if (subcommand === 'run') {
      const scopeId = flag('scope', null);
      const scopes = activeSyncScopes(registry.db).filter((scope) => scopeId === null || scope.id === scopeId);
      if (scopes.length === 0) fail('no hay ámbitos activos que sincronizar con ese filtro', 2);
      const limit = flag('limit', null);
      const results = await syncScopes({
        registryDb: registry.db,
        profileRoot: root,
        profileKey: key,
        scopes,
        config,
        now: () => Date.now(),
        limit: limit === null ? null : Number(limit),
        actor: 'human',
        dryRun: flag('dry-run') === true,
      });
      for (const result of results) {
        console.log(`${result.scope_kind} ${result.scope_id}: observados=${result.observed} sin_cambios=${result.unchanged} nuevos=${result.new} modificados=${result.changed} ausentes=${result.missing} ilegibles=${result.unreadable} no_soportados=${result.unsupported} sensibles=${result.sensitive} ingeridos=${result.ingested} fallos=${result.failed}${result.stop_reason ? ` motivo=${result.stop_reason}` : ''}${result.cancelled ? ' CANCELADO' : ''}${result.dry_run ? ' (simulación)' : ''}`);
        for (const error of result.errors.slice(0, 5)) console.log(`    ! ${error.code}: ${error.path ?? ''} ${error.message}`);
      }
      const failed = results.some((result) => result.failed > 0 || result.cancelled || result.complete === false);
      process.exit(failed ? 1 : 0);
    }

    if (subcommand === 'report') {
      // Observabilidad sin inspeccionar la base a mano: últimas pasadas y ticks tal como quedaron
      // auditados (M6.7 §7). Sólo agregados; nunca contenido de documentos ni de prompts.
      const limit = Number(flag('limit', 10));
      const rows = registry.db
        .prepare(
          `SELECT seq, at, action, outcome, detail FROM audit_registry
            WHERE action IN ('sync.run', 'sync.tick')
            ORDER BY seq DESC LIMIT ?`,
        )
        .all(Number.isInteger(limit) && limit > 0 ? limit : 10);
      if (rows.length === 0) console.log('  · sin pasadas de sincronización auditadas');
      for (const row of rows) {
        let detail = {};
        try { detail = row.detail ? JSON.parse(row.detail) : {}; } catch { detail = {}; }
        const parts = [
          `scopes=${detail.scopes ?? '?'}`,
          `nuevos=${detail.new ?? 0}`,
          `ingeridos=${detail.ingested ?? 0}`,
          `ausentes=${detail.missing ?? 0}`,
          `fallos=${detail.failed ?? 0}`,
          `no_soportados=${detail.unsupported ?? 0}`,
          `sensibles=${detail.sensitive ?? 0}`,
          `parciales=${detail.partial ?? 0}`,
          `ms=${detail.ms ?? '?'}`,
          detail.budget_ms ? `presupuesto_ms=${detail.budget_ms}` : null,
          detail.stop_reason ? `motivo=${detail.stop_reason}` : null,
        ].filter(Boolean);
        console.log(`  #${row.seq} ${row.action} ${row.outcome} ${new Date(Number(row.at)).toISOString()} ${parts.join(' ')}`);
      }
      process.exit(0);
    }

    fail('uso: sync run [--scope <id>] [--dry-run] [--limit n] | sync status | sync report [--limit n]', 2);
  } finally {
    closeRegistry(registry.db);
  }
}

if (command === 'project' || command === 'root' || command === 'select' || command === 'session'
  || command === 'trust' || command === 'discover') {
  // Registro del perfil: crear proyecto, autorizar una raíz o fijar la selección de una sesión. No crea
  // el almacén salvo `--create` explícito: la CLI nunca inventa un perfil. Toda salida va por stdout en
  // JSON para que sea verificable; el código de salida es 0 sólo si la operación se completó.
  const env = process.env;
  const root = profileRoot(env);
  const key = profileKey(env);
  const now = Date.now();
  let registry;
  try {
    registry = openRegistry({ root, create: flag('create', false) === true, now });
  } catch (error) {
    fail(`registro no disponible en ${root}: ${error?.message ?? error}`);
  }
  const db = registry.db;
  let status = 0;
  try {
    if (command === 'project' && (!subcommand || subcommand === 'list')) {
      const rows = db.prepare('SELECT id, name, status, created_at FROM projects ORDER BY created_at').all();
      console.log(JSON.stringify({ profile: key, root, projects: rows.length, rows }, null, 1));
    } else if (command === 'project' && (subcommand === 'create' || subcommand === 'add')) {
      const name = flag('name');
      if (name === null || name === true) fail('falta --name <nombre>', 2);
      const project = createProject(db, { name: String(name), now });
      console.log(JSON.stringify({ ok: true, profile: key, project }, null, 1));
    } else if (command === 'project') {
      fail('uso: project create --name <nombre> [--create] | project list', 2);
    } else if (command === 'root' && (!subcommand || subcommand === 'list')) {
      const rows = listRoots(db);
      console.log(JSON.stringify({ profile: key, roots: rows.length, rows }, null, 1));
    } else if (command === 'root' && (subcommand === 'add' || subcommand === 'authorize')) {
      const projectId = flag('project');
      const path = flag('path');
      if (projectId === null || projectId === true) fail('falta --project <prj_id>', 2);
      if (path === null || path === true) fail('falta --path <ruta absoluta>', 2);
      if (!getProject(db, String(projectId))) fail(`no existe el proyecto ${projectId} en este perfil`, 2);
      const row = addRoot(db, { scopeKind: 'prj', scopeId: String(projectId), path: String(path), addedBy: 'human', now });
      console.log(JSON.stringify({ ok: true, profile: key, root: row }, null, 1));
    } else if (command === 'root') {
      fail('uso: root add --project <prj_id> --path <ruta absoluta> [--create] | root list', 2);
    } else if (command === 'select') {
      const session = flag('session');
      const projectId = flag('project');
      if (session === null || session === true) fail('falta --session <id>', 2);
      if (projectId === null || projectId === true) fail('falta --project <prj_id>', 2);
      const result = registerSelection(db, {
        identity: { sessionId: String(session), profileKey: key },
        expectedProfileKey: key,
        projectId: String(projectId),
        selectedBy: flag('by', 'human') === 'host' ? 'host' : 'human',
        source: 'explicit',
        actor: 'human',
        now,
      });
      const selection = result.selection;
      console.log(JSON.stringify({
        ok: true,
        profile: key,
        created: result.created,
        changed: result.changed,
        selection: {
          session: selection.session_id,
          project: selection.project_id,
          source: selection.selection_source,
          by: selection.selected_by,
          state: selection.state,
          revision: selection.revision,
        },
      }, null, 1));
    } else if (command === 'trust' && (!subcommand || subcommand === 'list')) {
      const rows = listTrustedRoots(db);
      console.log(JSON.stringify({
        profile: key, root, trusted: rows.length, rows,
      }, null, 1));
    } else if (command === 'trust' && (subcommand === 'add' || subcommand === 'authorize')) {
      const path = flag('path');
      if (path === null || path === true) fail('falta --path <ruta absoluta del workspace>', 2);
      const result = addTrustedRoot(db, {
        path: String(path),
        readAuthorization: flag('read', 'true') !== 'false',
        addedBy: 'human',
        now,
      });
      console.log(JSON.stringify({
        ok: true, profile: key, created: result.created, changed: result.changed, root: result.root,
      }, null, 1));
    } else if (command === 'trust' && subcommand === 'remove') {
      const path = flag('path');
      if (path === null || path === true) fail('falta --path <ruta absoluta del workspace>', 2);
      const result = removeTrustedRoot(db, { path: String(path), removedBy: 'human', now });
      console.log(JSON.stringify({ ok: true, profile: key, changed: result.changed }, null, 1));
    } else if (command === 'discover' && (subcommand === 'scan' || subcommand === 'register')) {
      const path = flag('path');
      if (path === null || path === true) fail('falta --path <ruta absoluta del workspace confiable>', 2);
      const scan = scanWorkspace(String(path));
      if (subcommand === 'scan') {
        console.log(JSON.stringify({ profile: key, ...scan }, null, 1));
      } else {
        const authorization = flag('read', 'true') !== 'false' ? 'read' : 'discovered';
        const results = scan.projects.map((project) => registerDiscoveredProject(db, {
          path: project.path,
          name: project.name,
          type: project.type,
          indicators: project.indicators,
          source: 'cli',
          authorization,
          now,
        }));
        console.log(JSON.stringify({
          profile: key,
          scanned: scan.projects.length,
          registered: results.filter((row) => row.created).length,
          reused: results.filter((row) => !row.created).length,
          skipped: scan.skipped,
          results,
        }, null, 1));
      }
    } else if (command === 'discover' && subcommand === 'show') {
      const projectId = flag('project');
      if (projectId === null || projectId === true) fail('falta --project <prj_id>', 2);
      console.log(JSON.stringify({ profile: key, project: describeProject(db, String(projectId)) }, null, 1));
    } else if (command === 'discover') {
      fail('uso: discover scan|register --path <ruta> [--read true|false] | discover show --project <id>', 2);
    } else if (command === 'trust') {
      fail('uso: trust add --path <ruta> [--read true|false] | trust list | trust remove --path <ruta>', 2);
    } else if (command === 'session' && subcommand === 'show') {
      const session = flag('session');
      if (session === null || session === true) fail('falta --session <id>', 2);
      const row = getSession(db, String(session));
      console.log(JSON.stringify({ profile: key, session: row ?? null }, null, 1));
      if (!row) status = 1;
    } else {
      fail('uso: session show --session <id>', 2);
    }
  } catch (error) {
    // Un error de dominio (proyecto inexistente, raíz no autorizable) no puede tumbar la CLI con traza.
    console.error(`✗ ${error?.message ?? error}`);
    status = 1;
  } finally {
    closeRegistry(db);
  }
  process.exit(status);
}

fail('uso: lifecode-rag.mjs doctor | diagnose | audit export | audit verify | project create|list | root add|list | select | session show | library status|verify|plan|recover|rollback | sync run|status|report', 2);
