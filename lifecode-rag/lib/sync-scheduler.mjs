/**
 * Programación de la sincronización (PA5 · endurecido en M6.7).
 *
 * El motor (`syncScope`) no sabe nada de relojes; este módulo sólo lo llama. La programación se
 * inyecta: el host pasa `ctx.timer.interval` (devuelve un disposer y muere con el plugin) y fuera del
 * host se usa `setInterval` de Node. Dentro del host NO se cae al temporizador global: si el servicio
 * no está, el programador se declara no iniciado (`no-timer`) en vez de crear un intervalo invisible
 * que nadie va a poder cerrar.
 *
 * Garantías (verificadas en `tests/sync-scheduler.test.mjs`):
 * - Activación única: `start()` dos veces no crea un segundo temporizador.
 * - Una pasada nunca se solapa con otra (`running`); los ticks que llegan durante una pasada se
 *   cuentan (`skippedTicks`) y no se encolan, así que no hay trabajo pendiente ilimitado.
 * - Cada tick lleva presupuesto de tiempo y límite de ficheros; una pasada que los alcanza termina
 *   como parcial (no como fallo) y el resto queda para el tick siguiente.
 * - Un fallo no detiene el temporizador ni propaga al host: se registra, se audita y se reintenta con
 *   espera creciente (factor 1, 2, 4, 8 como máximo).
 * - `stop()` cierra el disposer y aborta la pasada en curso: el teardown del plugin no deja trabajo
 *   escribiendo por detrás, y no se aceptan ticks después del cierre.
 * - Sin registro Project-Aware no hay nada que sincronizar: el tick se salta sin ruido y sin error.
 */

import { existsSync } from 'node:fs';
import { workerConfig } from './worker-context.mjs';
import { loadConfig } from './paths.mjs';
import { profileKey, profileRoot, registryPath } from './profile.mjs';
import { appendRegistryAudit, closeRegistry, openRegistry } from './registry.mjs';
import { activeSyncScopes, syncScopes } from './sync.mjs';

const state = new WeakMap();
const MAX_BACKOFF_FACTOR = 8;

/**
 * Enumeración de ámbitos sincronizables: proyectos activos y bibliotecas activas, cada uno con sus
 * raíces autorizadas. Un ámbito sin raíces no se sincroniza (y no es un error: puede estar vacío).
 */
export function listSyncScopes(registryDb) {
  return activeSyncScopes(registryDb);
}

/**
 * Temporizador por defecto: el de Node. Devuelve un disposer, igual que `ctx.timer.interval`.
 */
function nodeInterval(callback, delay) {
  const handle = setInterval(callback, delay);
  handle.unref?.();
  return () => clearInterval(handle);
}

/**
 * @param {object} [options]
 * @param {(callback: () => void, delay: number) => (() => void)} [options.interval]
 *   Temporizador del host (`ctx.timer.interval`). Si no se pasa, se usa el de Node.
 */
export function createSyncScheduler({
  env = process.env,
  root = profileRoot(env),
  now = () => Date.now(),
  monotonic = null,
  logger = console,
  embedder = null,
  interval = null,
  config = null,
  dataRoot = null,
} = {}) {
  const schedule = typeof interval === 'function' ? interval : nodeInterval;
  const usingHostTimer = typeof interval === 'function';
  const registryFile = registryPath(root);
  let disposeTimer = null;
  let controller = null;
  let running = false;
  let nextAttemptAt = 0;
  const status = {
    enabled: false,
    running: false,
    lastTickAt: null,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
    consecutiveFailures: 0,
    intervalMs: null,
    // Diagnóstico del ciclo de vida (M6.7 §7): cuántas veces se pidió una pasada, cuántas no cabía y
    // cuántas veces se ha (re)programado el temporizador.
    ticks: 0,
    skippedTicks: 0,
    lastSkippedAt: null,
    lastSkipReason: null,
    starts: 0,
    stops: 0,
    timerType: usingHostTimer ? 'host' : 'node',
    effective: null,
  };

  function currentConfig() {
    return workerConfig({ config, dataRoot, root, env }).config;
  }

  function effectivePolicy(config) {
    return {
      intervalMs: config?.automation?.intervalMs ?? null,
      maxFilesPerRun: config?.automation?.maxFilesPerRun ?? null,
      tickBudgetMs: config?.automation?.tickBudgetMs ?? null,
    };
  }

  function statusSnapshot() {
    // Una configuración inválida no puede hacer que el diagnóstico (el panel) reviente: se devuelve el
    // error como dato, que es justo cuando más falta hace verlo.
    let config = null;
    let configError = null;
    try {
      config = currentConfig();
    } catch (error) {
      configError = { code: error?.code ?? 'invalid-config', message: error?.message ?? 'configuración inválida' };
    }
    const intervalMs = config?.automation?.intervalMs ?? status.intervalMs;
    const nextTickAt = status.enabled && intervalMs && status.lastTickAt !== null ? status.lastTickAt + intervalMs : null;
    // Backoff observable (M6.8, R-08): un operador tiene que poder ver cuánto falta para el próximo
    // intento y en qué factor va, sin abrir el proceso ni leer auditoría.
    const backoffFactor =
      status.consecutiveFailures > 0 ? Math.min(2 ** (status.consecutiveFailures - 1), MAX_BACKOFF_FACTOR) : 0;
    return {
      ...status,
      enabled: disposeTimer !== null,
      configured: config?.automation?.enabled ?? null,
      intervalMs,
      nextTickAt,
      nextAttemptAt: nextAttemptAt > 0 ? nextAttemptAt : null,
      backoffFactor,
      backoffRemainingMs: nextAttemptAt > 0 ? Math.max(0, nextAttemptAt - now()) : 0,
      effective: config ? effectivePolicy(config) : status.effective,
      timer: usingHostTimer ? 'host:ctx.timer.interval' : 'node:setInterval',
      note: usingHostTimer
        ? 'temporizador del host (ctx.timer.interval); su ciclo de vida lo cierra el contexto del plugin'
        : 'temporizador de Node; dentro del host PA6 inyecta ctx.timer.interval',
      ...(configError ? { configError } : {}),
    };
  }

  /**
   * Una pasada completa sobre todos los ámbitos activos.
   * @returns {Promise<{at:number, scopes:number, results:Array, ms:number, skipped?:boolean, reason?:string}>}
   */
  async function runOnce({ signal = undefined, scopeId = null, dryRun = false } = {}) {
    if (running) return { skipped: true, reason: 'already-running' };
    const config = currentConfig();
    if (!config.automation.enabled && !dryRun) return { skipped: true, reason: 'disabled' };
    if (!existsSync(registryFile)) return { skipped: true, reason: 'no-registry' };

    running = true;
    status.running = true;
    const started = now();
    status.lastTickAt = started;
    status.ticks += 1;
    status.effective = effectivePolicy(config);
    let registry = null;
    try {
      registry = openRegistry({ root, create: false, now: started });
      const scopes = activeSyncScopes(registry.db).filter((scope) => scopeId === null || scope.id === scopeId);
      const results = await syncScopes({
        registryDb: registry.db,
        profileRoot: root,
        profileKey: profileKey(env),
        scopes,
        config,
        embedder,
        now,
        signal,
        // Política efectiva del tick: límite de ficheros y presupuesto de tiempo vienen de la config
        // (M6.7 §4). El motor los aplica entre fichero y fichero y nunca a mitad de una transacción.
        limit: config.automation.maxFilesPerRun,
        budgetMs: config.automation.tickBudgetMs,
        monotonic,
        actor: 'automation',
        dryRun,
      });
      const finished = now();
      const outcome = {
        at: finished,
        scopes: results.length,
        results,
        ingested: results.reduce((total, item) => total + item.ingested, 0),
        missing: results.reduce((total, item) => total + item.missing, 0),
        failed: results.reduce((total, item) => total + item.failed, 0),
        unsupported: results.reduce((total, item) => total + item.unsupported, 0),
        sensitive: results.reduce((total, item) => total + (item.sensitive ?? 0), 0),
        partial: results.filter((item) => item.outcome === 'partial').length,
        budgetExhausted: results.filter((item) => item.budget_exhausted === true).length,
        cancelled: results.some((item) => item.cancelled),
        ms: finished - started,
      };
      if (!dryRun) {
        try {
          appendRegistryAudit(registry.db, {
            at: finished,
            actor: 'automation',
            action: 'sync.tick',
            target: 'all',
            outcome: outcome.cancelled ? 'skipped' : outcome.failed > 0 ? 'failed' : 'ok',
            detail: {
              scopes: outcome.scopes,
              ingested: outcome.ingested,
              missing: outcome.missing,
              failed: outcome.failed,
              unsupported: outcome.unsupported,
              sensitive: outcome.sensitive,
              partial: outcome.partial,
              budget_exhausted: outcome.budgetExhausted,
              ms: outcome.ms,
              budget_ms: config.automation.tickBudgetMs,
              max_files: config.automation.maxFilesPerRun,
            },
          });
        } catch (error) {
          logger.warn?.(`lifecode-rag sincronización: no se pudo auditar la pasada: ${error.message}`);
        }
      }
      status.lastRunAt = finished;
      status.lastResult = outcome;
      return outcome;
    } finally {
      if (registry) closeRegistry(registry.db);
      running = false;
      status.running = false;
    }
  }

  /** Tick del temporizador: nunca propaga y deja constancia de los fallos consecutivos. */
  async function tick() {
    // Después de `stop()` el temporizador ya no existe; un callback rezagado no debe ejecutar nada.
    if (!disposeTimer) return;
    if (running) {
      status.skippedTicks += 1;
      status.lastSkippedAt = now();
      status.lastSkipReason = 'already-running';
      return;
    }
    // Desactivar mientras se espera un reintento tiene que surtir efecto YA: si el operador apaga la
    // automatización, el tick no debe seguir contando backoff (ni arrastrarlo si vuelve a activarla).
    let configured = null;
    try {
      configured = currentConfig()?.automation?.enabled ?? null;
    } catch {
      // Configuración inválida: se deja que `runOnce` la reporte como fallo y cuente el backoff.
      configured = null;
    }
    if (configured === false) {
      status.skippedTicks += 1;
      status.lastSkippedAt = now();
      status.lastSkipReason = 'disabled';
      status.consecutiveFailures = 0;
      status.lastError = null;
      nextAttemptAt = 0;
      return;
    }
    if (now() < nextAttemptAt) {
      status.skippedTicks += 1;
      status.lastSkippedAt = now();
      status.lastSkipReason = 'backoff';
      return;
    }
    try {
      const result = await runOnce({ signal: controller?.signal });
      if (!result?.skipped) {
        status.consecutiveFailures = 0;
        status.lastError = null;
        nextAttemptAt = 0;
      } else {
        status.skippedTicks += 1;
        status.lastSkippedAt = now();
        status.lastSkipReason = result.reason ?? 'skipped';
      }
    } catch (error) {
      status.consecutiveFailures += 1;
      status.lastError = {
        at: now(),
        code: error?.code ?? 'internal',
        message: error?.message ?? 'fallo de sincronización',
      };
      const base = status.intervalMs ?? 60_000;
      const factor = Math.min(2 ** (status.consecutiveFailures - 1), MAX_BACKOFF_FACTOR);
      nextAttemptAt = now() + base * factor;
      logger.warn?.(
        `lifecode-rag sincronización: ${error?.message ?? 'fallo'} (intento ${status.consecutiveFailures}; espera ${factor}×)`,
      );
    }
  }

  function start() {
    const config = currentConfig();
    if (!config.automation.enabled) {
      status.enabled = false;
      return { started: false, reason: 'disabled' };
    }
    if (disposeTimer) return { started: true, already: true };
    status.intervalMs = config.automation.intervalMs;
    status.effective = effectivePolicy(config);
    controller = new AbortController();
    // Programar primero y declarar `enabled` después: si el temporizador del host lanza (por ejemplo,
    // porque el servicio no existe), `status()` no puede decir que la sincronización está activa.
    let dispose;
    try {
      dispose = schedule(() => {
        tick().catch((error) => logger.warn?.(`lifecode-rag sincronización: ${error?.message ?? 'fallo'}`));
      }, config.automation.intervalMs);
    } catch (error) {
      controller = null;
      status.lastError = { at: now(), code: 'no-timer', message: error?.message ?? 'sin temporizador' };
      return { started: false, reason: 'no-timer', message: status.lastError.message };
    }
    disposeTimer = dispose;
    status.enabled = true;
    status.starts += 1;
    return {
      started: true,
      intervalMs: config.automation.intervalMs,
      timer: usingHostTimer ? 'host' : 'node',
      budgetMs: config.automation.tickBudgetMs,
      maxFilesPerRun: config.automation.maxFilesPerRun,
      scopes: 0,
    };
  }

  function stop() {
    if (disposeTimer) disposeTimer();
    disposeTimer = null;
    status.enabled = false;
    status.stops += 1;
    // Un programador detenido no tiene reintentos pendientes: el backoff se descarta para que un
    // rearranque no herede una espera de hasta ocho intervalos.
    nextAttemptAt = 0;
    status.consecutiveFailures = 0;
    status.lastError = null;
    // Abortar la pasada en curso: el teardown no debe dejar una sincronización escribiendo por detrás.
    if (controller) {
      try {
        controller.abort('scheduler-stopped');
      } catch {
        /* abortar dos veces no es un fallo */
      }
      controller = null;
    }
    return { stopped: true };
  }

  return { start, stop, runOnce, status: statusSnapshot, tick };
}

export function syncSchedulerFor(deps) {
  if (state.has(deps)) return state.get(deps);
  const scheduler = createSyncScheduler(deps);
  state.set(deps, scheduler);
  return scheduler;
}
