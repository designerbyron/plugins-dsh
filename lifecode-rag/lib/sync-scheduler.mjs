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
import { claimSyncRequest, finishSyncRequest, listSyncRequests, reclaimInterruptedSyncRequests, requeueSyncRequest } from './provision-store.mjs';

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
  let draining = false;
  let drainScheduled = false;
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

  /**
   * R1.2 · Drena la cola durable (`sync_requests`): una petición por ámbito, coalescente.
   *
   * No depende de `automation.enabled`: una reactivación humana encola trabajo aunque el
   * mantenimiento periódico esté apagado. Sí respeta los presupuestos de la configuración. Cada
   * petición se reclama de forma condicional (estado + `requested_at`), así una petición que llega
   * durante la pasada no se pierde ni se pisa: queda `queued` para la siguiente.
   *
   * @returns {Promise<{at:number, results:Array, skipped?:boolean, reason?:string}>}
   */
  async function drain({ limit = 10 } = {}) {
    if (draining || running) return { skipped: true, reason: draining ? 'drain-running' : 'sync-running', results: [] };
    if (!existsSync(registryFile)) return { skipped: true, reason: 'no-registry', results: [] };
    draining = true;
    let registry = null;
    const results = [];
    // El teardown anula `controller`; se captura al empezar para que el bucle pueda abortar.
    const signal = controller?.signal ?? null;
    try {
      registry = openRegistry({ root, create: false, now: now() });
      const queued = listSyncRequests(registry.db, { state: 'queued', limit });
      if (queued.length === 0) return { at: now(), results };
      const config = currentConfig();
      for (const request of queued) {
        if (signal?.aborted) break;
        const claim = claimSyncRequest(registry.db, {
          scopeKind: request.scopeKind, scopeId: request.scopeId, now: now(),
        });
        if (!claim.claimed) continue;
        const scopes = activeSyncScopes(registry.db)
          .filter((scope) => scope.id === request.scopeId && scope.kind === request.scopeKind);
        if (scopes.length === 0) {
          // El ámbito dejó de ser sincronizable (OFF, archivado o sin raíces) entre encolar y drenar.
          finishSyncRequest(registry.db, {
            scopeKind: request.scopeKind, scopeId: request.scopeId, requestedAt: claim.request.requestedAt,
            state: 'failed', errorCode: 'scope-not-syncable', now: now(),
          });
          results.push({ scope_kind: request.scopeKind, scope_id: request.scopeId, skipped: true, reason: 'scope-not-syncable' });
          continue;
        }
        const run = await syncScopes({
          registryDb: registry.db,
          profileRoot: root,
          profileKey: profileKey(env),
          scopes,
          config,
          embedder,
          now,
          signal,
          limit: config.automation.maxFilesPerRun,
          budgetMs: config.automation.tickBudgetMs,
          monotonic,
          actor: 'automation',
        });
        const item = run[0] ?? null;
        const partial = Boolean(item && (item.outcome === 'partial' || item.complete === false || item.budget_exhausted === true));
        const progressed = Boolean(item && ((item.ingested ?? 0) > 0 || (item.new ?? 0) > 0
          || (item.changed ?? 0) > 0 || (item.reappeared ?? 0) > 0 || (item.missing ?? 0) > 0));
        if (partial && progressed) {
          // Pasada parcial con avance: se reencola para continuar donde quedó (presupuesto o
          // `too-many-files`). Sin avance se cierra `failed`: reencolar sería un bucle.
          requeueSyncRequest(registry.db, {
            scopeKind: request.scopeKind, scopeId: request.scopeId,
            requestedAt: claim.request.requestedAt, operationId: item?.operation ?? null,
            errorCode: 'partial', now: now(),
          });
          results.push({ ...item, requeued: true });
          continue;
        }
        const failed = !item || item.cancelled === true || item.failed > 0 || (partial && !progressed);
        finishSyncRequest(registry.db, {
          scopeKind: request.scopeKind, scopeId: request.scopeId, requestedAt: claim.request.requestedAt,
          state: failed ? 'failed' : 'done',
          operationId: item?.operation ?? null,
          errorCode: failed ? (partial ? (item.stop_reason ?? 'partial') : (item?.errors?.[0]?.code ?? 'sync-failed')) : null,
          now: now(),
        });
        if (item) results.push(item);
      }
      status.lastRunAt = now();
      status.lastResult = { drained: results.length, results };
      return { at: now(), results };
    } finally {
      if (registry) closeRegistry(registry.db);
      draining = false;
    }
  }

  /**
   * Pide un drenaje fuera del ciclo de la petición que lo provocó. El trabajo ya está en disco: si el
   * proceso muere antes de ejecutarlo, la fila sigue `queued` y se drena al arrancar.
   */
  function drainSoon() {
    if (drainScheduled) return { scheduled: true, already: true };
    drainScheduled = true;
    const run = () => {
      drainScheduled = false;
      drain().catch((error) => logger.warn?.(`lifecode-rag sincronización: drenaje falló: ${error?.message ?? error}`));
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else setTimeout(run, 0);
    return { scheduled: true };
  }

  /** Tick del temporizador: nunca propaga y deja constancia de los fallos consecutivos. */
  async function tick() {
    // Después de `stop()` el temporizador ya no existe; un callback rezagado no debe ejecutar nada.
    if (!disposeTimer) return;
    // Un drenaje en curso ya está sincronizando; `runOnce` no puede solaparse con él.
    if (draining) {
      status.skippedTicks += 1;
      status.lastSkippedAt = now();
      status.lastSkipReason = 'drain-running';
      return;
    }
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
      // R1.2: la cola de peticiones humanas se drena antes de la pasada completa. Si drenó algo, el
      // tick no repite la pasada sobre los mismos ámbitos (la siguiente hará el mantenimiento).
      const drained = await drain();
      if (drained.results && drained.results.length > 0) {
        status.consecutiveFailures = 0;
        status.lastError = null;
        nextAttemptAt = 0;
        return;
      }
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
    // Recuperación de la cola tras una caída: una petición que quedó `running` hace más de cinco
    // minutos no puede seguir viva; se cierra como fallida y, si procede, se vuelve a pedir. Antes de
    // drenar, nunca después: si no, el drenaje vería una fila `running` que ya nadie ejecuta.
    try {
      if (existsSync(registryFile)) {
        const opened = openRegistry({ root, create: false, now: now() });
        try {
          // En un arranque de perfil, cualquier petición `running` pertenece a la instancia anterior:
          // el perfil es único. No se espera la ventana de 5 minutos (una caída justo después de
          // reclamar dejaba la fila `running` y `drain()` sólo lee `queued`).
          reclaimInterruptedSyncRequests(opened.db, { now: now(), olderThanMs: 0 });
        } finally { closeRegistry(opened.db); }
      }
    } catch (error) {
      logger.warn?.(`lifecode-rag sincronización: no se pudo recuperar la cola: ${error?.message ?? error}`);
    }
    // La cola es durable y no depende de la automatización periódica: si el proceso anterior murió
    // con trabajo encolado, este arranque lo drena aunque `automation.enabled` sea false.
    drainSoon();
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

  return { start, stop, runOnce, drain, drainSoon, status: statusSnapshot, tick };
}

export function syncSchedulerFor(deps) {
  if (state.has(deps)) return state.get(deps);
  const scheduler = createSyncScheduler(deps);
  state.set(deps, scheduler);
  return scheduler;
}
