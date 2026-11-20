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
import { createAutomation } from './lib/automation.mjs';
import { createSyncScheduler } from './lib/sync-scheduler.mjs';
import { createAutoContext } from './lib/auto-context.mjs';

export const name = 'lifecode-rag';

/** Sólo `tools` es imprescindible. `approval`, `workingDirectory`, `webServer`, `timer` se usan si están. */
export const inject = ['tools'];

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
