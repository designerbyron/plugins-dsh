/**
 * Adaptador Cordis de LifeCode RAG.
 *
 * Deliberadamente mínimo: no importa nada de `@deepseek-ai/*` ni conoce el esquema de herramientas del
 * host. Todo lo que decide vive en `lib/` y se prueba con `node --test`; aquí sólo se conecta `ctx`.
 *
 * Registro: las herramientas, la ruta HTTP y el hook de contexto se dan de alta en el contexto que
 * llama a `apply`, así que su vida va atada al plugin (efecto del contexto), no a un estado global.
 *
 * PA6 fija tres piezas contra el host real (ver `eval/pa6/PA6-REPORT.md`):
 * - contexto por `agent/pre-step` (el host no activa el bridge de hooks Claude-Code aquí);
 * - sincronización con `ctx.timer.interval`, que devuelve disposer y muere con el plugin;
 * - la automatización v0.2 (`createAutomation`) queda sólo para perfiles que ya tienen el almacén
 *   legado, para no crear uno nuevo en perfiles Project-Aware.
 */

import { existsSync } from 'node:fs';
import { legacyRagRoot, profileRoot } from './lib/profile.mjs';
import { ragRoot, storePaths } from './lib/paths.mjs';
import { resolveConfig, resolveDataRoot, resolveProfileKey } from './lib/config-resolve.mjs';
import { createToolDefinitions } from './lib/tools.mjs';
import { API_PREFIX, createApiHandler } from './lib/server.mjs';
import { PA_PREFIX, createPaHandler } from './lib/pa-api.mjs';
import { createAutomation } from './lib/automation.mjs';
import { createSyncScheduler } from './lib/sync-scheduler.mjs';
import { createAutoContext } from './lib/auto-context.mjs';

export const name = 'lifecode-rag';

/** Servicios del host que el plugin necesita: herramientas, servidor web y, para PA01, la compuerta de
 * autenticación (`connection`). El cargador del host 0.2.2-rc.5 no aplica la forma `{required, optional}`
 * (medido: el plugin no se carga y su prefijo responde 404), así que se declaran los tres como requeridos:
 * un perfil sin servidor web no tiene panel que proteger y no carga el plugin igual que antes. */
export const inject = ['tools', 'webServer', 'connection'];

/**
 * PA01 · compuerta de autenticación del host para la API PA.
 *
 * El host autentica el navegador con una cookie firmada (token de lanzamiento en `GET /`) y aplica
 * la compuerta a `/` y `/api`, **no** a los prefijos que monta un plugin. Aquí se reutiliza su
 * mecanismo: `requestRejection` (trust + auth: 401/403) y `admit` (Peer vivo) sobre cada petición.
 *
 * - Sin `ctx.connection` no hay compuerta posible: se NIEGA (fail closed), nunca se abre.
 * - La identidad la fija el host; ninguna cabecera del renderer se interpreta como identidad.
 */
function hostGate(ctx, logger) {
  const connection = ctx.get('connection');
  const usable = connection
    && typeof connection.requestRejection === 'function'
    && typeof connection.admit === 'function';
  if (!usable) {
    logger.warn?.('lifecode-rag PA: el host no ofrece ctx.connection; la API PA queda cerrada');
    return async () => ({
      ok: false, status: 503, code: 'authorization-unavailable',
      message: 'el host no ofrece autenticación: la API PA está cerrada',
    });
  }
  return async ({ headers }) => {
    let rejection = null;
    try {
      rejection = await connection.requestRejection({ headers });
    } catch {
      return { ok: false, status: 503, code: 'authorization-unavailable', message: 'la compuerta del host falló' };
    }
    if (rejection) {
      const status = typeof rejection === 'number' ? rejection
        : (Number(rejection.status) || 401);
      return {
        ok: false,
        status: status === 403 ? 403 : 401,
        code: status === 403 ? 'forbidden' : 'unauthenticated',
        message: 'la petición no está autenticada por el host',
      };
    }
    let admitted = null;
    try {
      admitted = await connection.admit({ headers });
    } catch {
      return { ok: false, status: 503, code: 'authorization-unavailable', message: 'la compuerta del host falló' };
    }
    if (!admitted || !admitted.peer) {
      const status = admitted && admitted.rejection && Number(admitted.rejection.status) === 403 ? 403 : 401;
      return {
        ok: false,
        status,
        code: status === 403 ? 'forbidden' : 'unauthenticated',
        message: 'la petición no está autenticada por el host',
      };
    }
    return { ok: true, peer: admitted.peer };
  };
}

export function apply(ctx) {
  // Dos raíces con propósitos distintos: `ragRoot` sólo guarda la configuración heredada (global al
  // home, no por perfil) y `profileRoot` los datos Project-Aware de ESTE perfil (registro + scopes).
  // Configuración efectiva (LE-RAG-01): perfil > global > defaults. `LIFECODE_RAG_DATA` y
  // `LIFECODE_RAG_PROFILE` permiten un despliegue sin Harness; sin ellos se conserva la raíz histórica.
  const { config } = resolveConfig({
    dataRoot: resolveDataRoot(process.env),
    profileKey: resolveProfileKey(process.env),
  });
  const profile = profileRoot(process.env);
  const legacy = legacyRagRoot(process.env);
  const logger = ctx.logger ?? console;
  // Los servicios opcionales se resuelven en el momento de uso: `ctx.get` dentro de `apply` puede
  // devolver `undefined` si Cordis todavía no cargó `approval`/`workingDirectory` (el plugin sólo
  // inyecta `tools`). Congelarlos aquí convertía una carrera de arranque en un fallo permanente
  // (`approval-unavailable` en cada escritura, sin directorio de trabajo → sin resolución).
  const services = {
    get approval() { return ctx.get('approval'); },
    get workingDirectory() { return ctx.get('workingDirectory'); },
    // Proyectos abiertos en Harness: vista de sólo lectura del registro durable de workspaces.
    // Opcional: sin el servicio, la resolución sigue por `cwd` como antes.
    get workspaces() {
      const registry = ctx.get('workspaceRegistry');
      return registry && typeof registry.list === 'function'
        ? { list: () => registry.list() }
        : null;
    },
    env: process.env,
  };
  for (const definition of createToolDefinitions({ config, root: profile, services })) {
    ctx.tools.register(definition);
  }

  // API del Workspace v0.2 (almacén único). En un perfil Project-Aware no hay `rag.sqlite3` legado:
  // exponerla allí mostraría un almacén distinto del que consultan las herramientas, así que sólo se
  // registra cuando el almacén legado existe de verdad.
  const legacyStoreExists = existsSync(storePaths(legacy).database);
  const webServer = ctx.get('webServer');
  if (webServer) {
    // LE-RAG-10: el panel lee el almacén del PERFIL (no el legacy). Solo lectura.
    // PA01: toda la API PA pasa por la compuerta de autenticación del host antes de tocar el almacén.
    const authorize = hostGate(ctx, logger);
    const paHandler = createPaHandler({
      profileRoot: profile, profileKey: resolveProfileKey(process.env), env: process.env, authorize,
    });
    ctx.effect(() => webServer.register({ kind: 'prefix', path: PA_PREFIX, handler: paHandler }));
  }
  if (webServer && legacyStoreExists) {
    const handler = createApiHandler({ root: legacy, env: process.env });
    ctx.effect(() => webServer.register({ kind: 'prefix', path: API_PREFIX, handler }));
  }

  // Contexto antes de responder: sólo el primer paso de un turno y sólo con prompt humano. Si el
  // contexto no se puede recuperar (sin registro, sin proyecto, revocado), el turno sigue sin él.
  const autoContext = createAutoContext({ services, config, logger });
  // `on` existe en cualquier Context de Cordis; el guarda sólo cubre dobles de prueba mínimos.
  if (typeof ctx.on === 'function') {
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next();
      if (!decision || decision.kind !== 'enter') return decision;
      try {
        const extra = await autoContext.messageFor(payload, decision.messages ?? []);
        if (!extra) return decision;
        return { ...decision, messages: [...(decision.messages ?? []), extra] };
      } catch (error) {
        logger.warn?.(`lifecode-rag contexto: ${error?.message ?? error}`);
        return decision;
      }
    });
  }

  // Sincronización Project-Aware (PA5) programada con el temporizador del host: su disposer cierra el
  // intervalo cuando el plugin se descarga o el contexto se libera. La raíz es la del PERFIL: el
  // registro Project-Aware vive ahí, no en la raíz legada (pasarla mal dejaba la automatización en un
  // `no-registry` silencioso en cada tick).
  //
  // M6.7 §3.1: dentro del host NO se cae a `setInterval` global. Si `ctx.timer` no está en el momento
  // de programar, se lanza y `start()` devuelve `no-timer`; el motivo queda en `status()`. Un intervalo
  // global creado aquí sería invisible para el teardown del plugin y sobreviviría a la descarga.
  const interval = (callback, delay) => {
    const current = ctx.get('timer');
    if (!current || typeof current.interval !== 'function') {
      throw new Error('el host no ofrece ctx.timer.interval');
    }
    return current.interval(callback, delay);
  };
  const scheduler = createSyncScheduler({ env: process.env, root: profile, logger, interval });
  ctx.effect(() => {
    const started = scheduler.start();
    if (started?.started === false && started.reason) {
      logger.debug?.(`lifecode-rag sincronización: no arranca (${started.reason})`);
    }
    return () => scheduler.stop();
  });

  // Automatización v0.2: sólo si este perfil ya tenía un almacén legado. En un perfil Project-Aware no
  // se crea nada nuevo (D-PA6-04).
  if (legacyStoreExists) {
    const automation = createAutomation({ root: legacy, env: process.env });
    ctx.effect(() => {
      automation.start();
      return () => automation.stop();
    });
  }
}
