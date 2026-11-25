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
import { ensureRegistry, openRegistry } from './lib/registry.mjs';
import { recoverLifecycle } from './lib/lifecycle.mjs';
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
    // UX-2.1 · sesiones VIVAS del host (`ctx.sessions` → `SessionStore.list()`), reducidas a sus
    // identificadores: la API sólo necesita contar cuántas de las sesiones de un workspace siguen
    // abiertas. Opcional: sin el servicio, la lista se sirve igual y el desglose llega como
    // `null` («no se pudo mirar»), nunca como cero. Se resuelve por petición, no al arrancar.
    get sessions() {
      const store = ctx.get('sessions');
      if (!store || typeof store.list !== 'function') return null;
      return {
        list: () => {
          const live = store.list();
          if (!Array.isArray(live)) return live;
          return live
            .map((session) => (session && typeof session.id === 'string' ? session.id : null))
            .filter((id) => typeof id === 'string' && id !== '');
        },
      };
    },
    env: process.env,
  };

  // El registro Project-Aware es el contenedor de todo lo demás. Sin él, un perfil recién instalado
  // dejaba las siete herramientas y las cinco vistas del panel en `registry-unavailable` (HTTP 503)
  // porque todos los caminos abren con `create: false`. Se garantiza aquí, una sola vez al cargar el
  // plugin y antes de dar de alta herramientas y rutas (`D-IMPL-12`); es idempotente, así que un
  // perfil ya migrado no escribe nada. Si falla de verdad (permisos, corrupción, versión más nueva)
  // el plugin carga igual y el error se sigue viendo en la API; se registra el motivo real.
  try {
    ensureRegistry({ root: profile });
  } catch (error) {
    logger.warn?.(`lifecode-rag registro: el registro del perfil no se pudo preparar (${error?.code ?? error?.message ?? error})`);
  }

  // R1.2 · Recuperación al arrancar: cierra o reanuda provisiones y movimientos que quedaron
  // abiertos. Es idempotente y no repite efectos a ciegas; si no puede abrir el registro, el
  // diagnóstico sigue disponible en la API y no se impide cargar el plugin.
  try {
    const opened = openRegistry({ root: profile, create: false });
    try {
      const recovered = recoverLifecycle(opened.db, {
        profileRoot: profile, profileKey: resolveProfileKey(process.env),
      });
      if (recovered.provisions > 0 || recovered.moves > 0) {
        logger.debug?.(`lifecode-rag ciclo de vida: recuperación ${JSON.stringify(recovered)}`);
      }
    } finally {
      opened.db.close();
    }
  } catch (error) {
    logger.warn?.(`lifecode-rag ciclo de vida: la recuperación no pudo ejecutarse (${error?.code ?? error?.message ?? error})`);
  }

  for (const definition of createToolDefinitions({ config, root: profile, services })) {
    ctx.tools.register(definition);
  }

  // Sincronización Project-Aware (PA5 + R1.2): el planificador se crea antes de la API porque el
  // toggle le pide drenar la cola tras provisionar o reactivar. El temporizador es el del host
  // (`ctx.timer.interval`): devuelve disposer y muere con el plugin. Dentro del host NO se cae a
  // `setInterval` global; si el servicio no está, `start()` devuelve `no-timer` y queda en `status()`.
  const interval = (callback, delay) => {
    const current = ctx.get('timer');
    if (!current || typeof current.interval !== 'function') {
      throw new Error('el host no ofrece ctx.timer.interval');
    }
    return current.interval(callback, delay);
  };
  const scheduler = createSyncScheduler({
    env: process.env, root: profile, dataRoot: resolveDataRoot(process.env), logger, interval,
  });

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
      profileRoot: profile, profileKey: resolveProfileKey(process.env), dataRoot: resolveDataRoot(process.env), env: process.env, authorize,
      // UX-2.1: las fuentes del host viajan como objeto plano con getters; el núcleo no conoce DSH
      // y cada petición resuelve el servicio en ese momento (no se congela el `null` del arranque).
      services,
      // R1.2: la cola de sincronización se drena fuera de la petición humana.
      scheduler,
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

  // Sincronización Project-Aware (PA5): arranque del planificador creado arriba. Su `start()` drena
  // una vez la cola durable (R1.2) aunque la automatización periódica esté desactivada.
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
