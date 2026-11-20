/**
 * Automatización controlada (M4).
 *
 * La política es explícita: sólo se vigilan `automation.watchRoots` declaradas por una persona en
 * `config.json`, y sólo con `automation.enabled: true`. No hay descubrimiento implícito de carpetas.
 * Cada pasada:
 *   1. recorre las raíces (sin seguir enlaces) y descarta los ficheros que ya están al día por sha256;
 *   2. ingiere como máximo `maxFilesPerRun`, de más reciente a más antiguo, uno a uno, para poder
 *      cancelar entre ficheros;
 *   3. audita la pasada y purga métricas fuera de retención.
 *
 * Nunca borra fuentes: si un fichero desaparece, se deja de reindexar y se informa como ausente.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

import { appendAudit } from './audit.mjs';
import { closeDatabase, openDatabase } from './db.mjs';
import { createEmbedder } from './embedders.mjs';
import { RagError } from './errors.mjs';
import { walkDirectory } from './inputs.mjs';
import { ingestFiles } from './ingest.mjs';
import { purgeMetrics, recordMetrics, retentionCutoff } from './metrics.mjs';
import { workerConfig } from './worker-context.mjs';
import { loadConfig, ragRoot } from './paths.mjs';
import { assertSupportedFormat, isProbablyBinary } from './extract.mjs';

const state = new WeakMap();

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function collectionFor(path, mappings) {
  const entries = Object.entries(mappings ?? {}).sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, collection] of entries) {
    if (path.toLowerCase().startsWith(prefix.toLowerCase())) return collection;
  }
  return 'default';
}

function knownDigests(db) {
  const map = new Map();
  for (const row of db.prepare('SELECT uri, sha256 FROM sources').all()) map.set(row.uri, row.sha256);
  return map;
}

/** Ficheros candidatos de una raíz, ordenados por mtime descendente. */
function candidates(root, limit) {
  const files = [];
  walkDirectory(root, files, Math.max(limit * 20, 1_000));
  const rows = [];
  for (const path of files) {
    try {
      const stat = statSync(path);
      if (!stat.isFile()) continue;
      rows.push({ path, mtime: stat.mtimeMs, size: stat.size });
    } catch { /* desapareció entre el recorrido y el stat */ }
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows;
}

export function createAutomation({ root = ragRoot(), env = process.env, now = () => Date.now(), logger = console, config = null, dataRoot = null } = {}) {
  let timer = null;
  let running = false;
  const status = { enabled: false, running: false, lastRunAt: null, lastResult: null, roots: [], intervalMs: null };

  function currentConfig() {
    return workerConfig({ config, dataRoot, root, env }).config;
  }

  function statusSnapshot() {
    const config = currentConfig();
    return {
      ...status,
      enabled: timer !== null,
      configured: config.automation.enabled,
      intervalMs: config.automation.intervalMs,
      roots: config.automation.watchRoots,
    };
  }

  async function runOnce({ signal = undefined } = {}) {
    const config = currentConfig();
    if (running) return { skipped: true, reason: 'already-running' };
    if (!config.automation.enabled) return { skipped: true, reason: 'disabled' };
    if (config.automation.watchRoots.length === 0) return { skipped: true, reason: 'no-watch-roots' };

    running = true;
    status.running = true;
    const started = now();
    const outcome = { at: started, roots: config.automation.watchRoots.length, scanned: 0, considered: 0, ingested: 0, skipped: 0, failed: 0, absent: 0, cancelled: false, errors: [] };
    try {
      const opened = openDatabase({ root, create: true, now: started });
      let digests;
      try { digests = knownDigests(opened.db); } finally { closeDatabase(opened.db); }

      const pending = [];
      for (const watch of config.automation.watchRoots) {
        let rows;
        try {
          rows = candidates(watch, config.automation.maxFilesPerRun);
        } catch (error) {
          outcome.errors.push({ path: watch, code: error.code ?? 'internal', message: error.message });
          continue;
        }
        outcome.scanned += rows.length;
        for (const row of rows) {
          if (signal?.aborted) { outcome.cancelled = true; break; }
          if (!isProbablyBinary(readFileSync(row.path))) {
            try { assertSupportedFormat(row.path); } catch { continue; }
          } else {
            continue;
          }
          let digest;
          try { digest = sha256File(row.path); } catch { continue; }
          if (digests.get(row.path) === digest) continue;
          pending.push({ ...row, digest, collection: collectionFor(row.path, config.automation.collections) });
        }
        if (outcome.cancelled) break;
      }
      outcome.considered = pending.length;
      pending.sort((a, b) => b.mtime - a.mtime);
      const batch = pending.slice(0, config.automation.maxFilesPerRun);
      const embedder = createEmbedder(config);

      for (const item of batch) {
        if (signal?.aborted) { outcome.cancelled = true; break; }
        try {
          const result = await ingestFiles({
            root, files: [item.path], collection: item.collection, now: now(), config, embedder, actor: 'automation',
          });
          outcome.ingested += result.ingested.length;
          outcome.skipped += result.skipped.length;
          outcome.failed += result.errors.length;
          for (const error of result.errors) outcome.errors.push(error);
        } catch (error) {
          outcome.failed += 1;
          outcome.errors.push({ path: item.path, code: error.code ?? 'internal', message: error.message });
        }
      }

      // Retención de métricas: sólo agregados, nunca datos de usuario.
      const finished = now();
      outcome.ms = finished - started;
      try {
        const opened2 = openDatabase({ root, create: false });
        try {
          if (config.metrics.enabled) purgeMetrics(opened2.db, { beforeDay: retentionCutoff(config, finished), at: finished });
          appendAudit(opened2.db, {
            at: finished,
            actor: 'automation',
            tool: 'lifecode_rag_automation',
            action: 'automation.run',
            target: config.automation.watchRoots.join(','),
            outcome: outcome.cancelled ? 'skipped' : outcome.failed > 0 ? 'failed' : 'ok',
            details: { ...outcome, errors: outcome.errors.slice(0, 20) },
          });
          recordMetrics(opened2.db, [
            { metric: 'automation.runs', value: 1, dim: outcome.cancelled ? 'cancelled' : 'ok', at: finished },
            { metric: 'automation.indexed', value: outcome.ingested, dim: 'default', at: finished },
            { metric: 'automation.failed', value: outcome.failed, dim: 'default', at: finished },
          ]);
        } finally { closeDatabase(opened2.db); }
      } catch (error) {
        logger.warn?.(`lifecode-rag: no se pudo auditar la pasada de automatización: ${error.message}`);
      }

      status.lastRunAt = finished;
      status.lastResult = outcome;
      return outcome;
    } catch (error) {
      if (!(error instanceof RagError) && error?.code !== undefined) throw error;
      outcome.errors.push({ path: null, code: error.code ?? 'internal', message: error.message });
      status.lastResult = outcome;
      throw error;
    } finally {
      running = false;
      status.running = false;
    }
  }

  function start() {
    const config = currentConfig();
    if (!config.automation.enabled) {
      status.enabled = false;
      return { started: false, reason: 'disabled' };
    }
    if (timer) return { started: true, already: true };
    status.enabled = true;
    status.intervalMs = config.automation.intervalMs;
    timer = setInterval(() => { runOnce().catch((error) => logger.warn?.(`lifecode-rag automatización: ${error.message}`)); }, config.automation.intervalMs);
    timer.unref?.();
    return { started: true, intervalMs: config.automation.intervalMs, roots: config.automation.watchRoots };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    status.enabled = false;
    return { stopped: true };
  }

  return { start, stop, runOnce, status: statusSnapshot };
}

export function automationFor(deps) {
  if (state.has(deps)) return state.get(deps);
  const automation = createAutomation(deps);
  state.set(deps, automation);
  return automation;
}
