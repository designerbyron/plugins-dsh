/**
 * Diagnóstico del almacén y del runtime (AC13). No escribe nada: sólo mide y explica.
 */

import { constants, accessSync, copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditState } from './audit-export.mjs';
import { closeDatabase, ftsIntegrityCheck, openDatabase } from './db.mjs';
import { embedText } from './embed.mjs';
import { ragRoot, storePaths } from './paths.mjs';
import { resolveConfig, resolveProfileKey } from './config-resolve.mjs';


/**
 * Copia el almacén (y sus sidecars) a un directorio temporal. El diagnóstico nunca abre el
 * original en escritura: SQLite puede crear `-wal`/`-shm` incluso en modo read-only.
 */
function diagnosticCopy(paths) {
  const temp = mkdtempSync(join(tmpdir(), 'lifecode-rag-doctor-'));
  try {
    copyFileSync(paths.database, join(temp, 'rag.sqlite3'));
    // `-shm` es efímero y puede estar bloqueado por un lector vivo; no se copia.
    for (const suffix of ['-wal']) {
      if (existsSync(`${paths.database}${suffix}`)) copyFileSync(`${paths.database}${suffix}`, join(temp, `rag.sqlite3${suffix}`));
    }
    return temp;
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

/** Rango real de `node:sqlite` con FTS5: 22.16+ en 22.x, o 24+. */
export function runtimeSupported(version) {
  const [major, minor] = String(version).split('.').map(Number);
  return (major === 22 && minor >= 16) || major >= 24;
}

function check(name, run) {
  try {
    const detail = run();
    return { name, status: detail?.status ?? 'ok', detail: detail?.detail ?? String(detail ?? '') };
  } catch (error) {
    return { name, status: 'fail', detail: error?.code ?? error?.message ?? String(error) };
  }
}

/**
 * @param {{root?:string, env?:object}} [options]
 * @returns {{ok:boolean, root:string, checks:Array<{name:string,status:'ok'|'warn'|'fail',detail:string}>}}
 */
export function runDoctor({ root = ragRoot(process.env), env = process.env } = {}) {
  const checks = [];

  checks.push(check('runtime', () => {
    const ok = runtimeSupported(process.versions.node);
    return { status: ok ? 'ok' : 'fail', detail: `node ${process.versions.node}${ok ? '' : ' (necesita >=22.16 o >=24 para node:sqlite con FTS5)'}` };
  }));

  checks.push(check('raíz', () => {
    if (!root || typeof root !== 'string') return { status: 'fail', detail: 'sin raíz de almacén' };
    if (existsSync(root)) {
      if (!statSync(root).isDirectory()) return { status: 'fail', detail: `${root} no es un directorio` };
      accessSync(root, constants.R_OK);
      return { status: 'ok', detail: root };
    }
    return { status: 'warn', detail: `${root} aún no existe (se creará en la primera ingesta; doctor no lo crea)` };
  }));

  let config;
  checks.push(check('configuración', () => {
    config = resolveConfig({ dataRoot: root, profileKey: resolveProfileKey(env) }).config;
    return { status: 'ok', detail: `embedder ${config.embedding.provider} (${config.embedding.dim} dim)` };
  }));

  checks.push(check('embedder', () => {
    const active = config ?? resolveConfig({ dataRoot: root, profileKey: resolveProfileKey(env) }).config;
    const vector = embedText('prueba determinista', { provider: active.embedding.provider, dim: active.embedding.dim });
    const again = embedText('prueba determinista', { provider: active.embedding.provider, dim: active.embedding.dim });
    const same = vector.length === again.length && vector.every((value, index) => value === again[index]);
    return { status: same ? 'ok' : 'fail', detail: `${vector.length} dimensiones, ${same ? 'determinista' : 'inestable'}` };
  }));

  checks.push(check('almacén', () => {
    if (!existsSync(root)) return { status: 'warn', detail: 'no inicializado' };
    const original = storePaths(root);
    const temp = diagnosticCopy(original);
    try {
      let probe;
      try {
        probe = openDatabase({ root: temp, create: false, readOnly: true });
        const version = probe.db.prepare('PRAGMA user_version').get().user_version;
        closeDatabase(probe.db);
        probe = null;
        if (version < 3) return { status: 'warn', detail: 'el almacén necesita migración; doctor no la ejecuta' };
      } catch (error) {
        if (probe) closeDatabase(probe.db);
        if (error?.code === 'store-migration-required') return { status: 'warn', detail: 'el almacén necesita migración; doctor no la ejecuta' };
        throw error;
      }
      const opened = openDatabase({ root: temp, create: false });
      try {
        const tables = opened.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
        ftsIntegrityCheck(opened.db);
        if (!existsSync(original.audit)) {
          const chain = auditState(opened.db, { path: original.audit });
          if (!chain.ok && chain.where === 'database') return { status: 'fail', detail: `auditoría: ${chain.reason}` };
          return { status: 'warn', detail: `esquema v${opened.db.prepare('PRAGMA user_version').get().user_version}, FTS íntegra, sin exportación JSONL (derivable)` };
        }
        const audit = auditState(opened.db, { path: original.audit });
        if (!audit.ok) return { status: 'fail', detail: `auditoría: ${audit.where}/${audit.reason}` };
        return { status: 'ok', detail: `esquema v${opened.db.prepare('PRAGMA user_version').get().user_version}, ${tables} tablas, FTS íntegra, ${audit.entries} entradas de auditoría` };
      } finally {
        closeDatabase(opened.db);
      }
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }));

  const ok = checks.every((item) => item.status !== 'fail');
  return { ok, root, checks };
}
