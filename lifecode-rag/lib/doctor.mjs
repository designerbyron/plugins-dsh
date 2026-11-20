/**
 * Diagnóstico del almacén y del runtime (AC13). No escribe nada: sólo mide y explica.
 */

import { constants, accessSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { auditState } from './audit-export.mjs';
import { closeDatabase, ftsIntegrityCheck, openDatabase } from './db.mjs';
import { embedText } from './embed.mjs';
import { ragRoot } from './paths.mjs';
import { resolveConfig, resolveProfileKey } from './config-resolve.mjs';

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
    const [major, minor] = process.versions.node.split('.').map(Number);
    const ok = major > 22 || (major === 22 && minor >= 5);
    return { status: ok ? 'ok' : 'fail', detail: `node ${process.versions.node}${ok ? '' : ' (necesita >=22.5 para node:sqlite)'}` };
  }));

  checks.push(check('raíz', () => {
    if (!root || typeof root !== 'string') return { status: 'fail', detail: 'sin raíz de almacén' };
    if (existsSync(root)) {
      if (!statSync(root).isDirectory()) return { status: 'fail', detail: `${root} no es un directorio` };
      accessSync(root, constants.W_OK);
      return { status: 'ok', detail: root };
    }
    accessSync(dirname(root), constants.W_OK);
    return { status: 'warn', detail: `${root} aún no existe (se creará en la primera ingesta)` };
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
    const opened = openDatabase({ root, create: false });
    try {
      const tables = opened.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
      ftsIntegrityCheck(opened.db);
      if (!existsSync(opened.paths.audit)) {
        const chain = auditState(opened.db, { path: opened.paths.audit });
        if (!chain.ok && chain.where === 'database') return { status: 'fail', detail: `auditoría: ${chain.reason}` };
        return { status: 'warn', detail: `esquema v${opened.db.prepare('PRAGMA user_version').get().user_version}, FTS íntegra, sin exportación JSONL (derivable)` };
      }
      const audit = auditState(opened.db, { path: opened.paths.audit });
      if (!audit.ok) return { status: 'fail', detail: `auditoría: ${audit.where}/${audit.reason}` };
      return { status: 'ok', detail: `esquema v${opened.db.prepare('PRAGMA user_version').get().user_version}, ${tables} tablas, FTS íntegra, ${audit.entries} entradas de auditoría` };
    } finally {
      closeDatabase(opened.db);
    }
  }));

  const ok = checks.every((item) => item.status !== 'fail');
  return { ok, root, checks };
}
