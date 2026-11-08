/**
 * lifecode-skill-center — adaptador Cordis del centro de skills.
 *
 * Este fichero es deliberadamente **fino** porque es el único que no se puede probar antes de instalar
 * (importa `@deepseek-ai/dsh-tools`, que sólo existe dentro del harness). Todo lo que decide algo vive en
 * `lib/`, donde sí hay pruebas.
 *
 * Los cuatro puntos de extensión, y por qué cada uno:
 *   1. `ctx.systemPrompt.section(...)` — una sección estática y corta. No se usa `system-prompt/assemble`:
 *      añadir texto por ahí rompe el prompt caching y la guía del harness lo prohíbe para esto.
 *   2. `ctx.tools.register(...)` — las cuatro herramientas del agente. Ninguna aprueba ni activa.
 *   3. `ctx.skills.registerProvider(...)` — sirve **sólo** lo encendido para el proyecto que pregunta.
 *   4. `ctx.webServer.register(...)` — la API JSON del panel. El SHA de esta decisión está en el porqué:
 *      los resultados de comando que llegan al cliente se normalizan a `{kind,text}`, así que una
 *      interfaz con tablas y formularios necesita una ruta propia, no texto de comando.
 *
 * La invalidación del catálogo se conserva del contrato medido: el registro de skills cachea y no tiene
 * TTL; sin llamar a `control.invalidate` una skill recién encendida no llega al agente hasta reiniciar.
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

import { buildSnapshot, centerRoot, runAction } from './lib/api.mjs';
import { skillProviderFor } from './lib/provider.mjs';
import { centerTools } from './lib/tools.mjs';
import { createStoreSignal } from './lib/watch.mjs';

/** Identidad del Loader. */
export const name = 'lifecode-skill-center';

/** Servicios necesarios; sin ellos el plugin queda inactivo en vez de lanzar. */
export const inject = ['tools', 'skills', 'systemPrompt'];

/** Orden de la sección estática: después de la guía del harness y del compilador anterior. */
const SECTION_ORDER = 9001;

/** La ruta del panel. Prefijo propio: una ruta con nombre gana al fallback del SPA. */
export const API_PREFIX = '/lifecode-skill-center/api/';

/**
 * Lo que el agente necesita saber y no puede deducir de las descripciones de las herramientas: la
 * asimetría del producto. Entra en el prompt de todas las sesiones, así que se paga entero cada vez y se
 * mantiene corto a propósito (~430 caracteres).
 */
const PROTOCOL = [
  '## Skill center (lifecode-skill-center)',
  '',
  'Before writing a skill: `lifecode_skill_search` — the machine may already know it, here or in another project.',
  'Create only with evidence. A new skill is **published in the shared library and active nowhere**; improving a live',
  'one is `lifecode_skill_improve`, which only proposes. A person approves and a person enables a skill per project:',
  'never report a skill as active because you created it.',
].join('\n');

/** Las acciones que cambian el catálogo que el agente ve. */
const CHANGES_CATALOG = new Set(['create', 'publish', 'improve', 'decide', 'toggle', 'rollback', 'fork', 'import', 'evaluate']);

/** Un objeto de verdad: ni `null` ni un array. */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonResponse(status, value) {
  return new Response(`${JSON.stringify(value)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function apply(ctx, config = {}) {
  const root = config.root ?? centerRoot();

  // La carpeta del harness, como sugerencia para el panel: la interfaz no recibe el directorio de la
  // sesión —el slot `main` no da binding de sesión para claves que no sean `conversation`—, así que
  // pregunta por el del proceso y la persona confirma en el selector de proyecto.
  const hostCwd = (() => {
    try {
      const value = ctx.workingDirectory?.get?.();
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  })();

  ctx.systemPrompt.section({
    name: 'lifecode-skill-center:protocol',
    order: SECTION_ORDER,
    interpolate: false,
    text: PROTOCOL,
  });

  for (const tool of centerTools({ root })) ctx.tools.register(defineTool(tool));

  // ── El catálogo y su invalidación ───────────────────────────────────────────────────────────────
  // El registro cachea los catálogos y sólo los tira cuando el provider llama a la invalidación que él
  // mismo entrega. Se guarda aquí y se dispara por dos vías: el cambio del almacén (que cubre también lo
  // que muta fuera de este proceso) y cada acción del panel que lo toca.
  let invalidate = () => {};

  ctx.skills.registerProvider((control) => {
    if (typeof control?.invalidate === 'function') invalidate = control.invalidate;
    return skillProviderFor({ root });
  });

  ctx.effect(() => {
    const signal = createStoreSignal({ root, onChange: () => invalidate() });
    signal.start();
    return () => signal.stop();
  });

  // ── La API del panel ────────────────────────────────────────────────────────────────────────────
  // Opcional a propósito: en un perfil sin servidor web el panel no existe y el plugin conserva las
  // herramientas y el catálogo. `ctx.inject` deja el registro en un contexto hijo y el efecto retira la
  // ruta al descargar el plugin, para que recargarlo no choque con «esa ruta ya existe».
  ctx.inject(['webServer'], (scoped) => {
    const registry = scoped?.webServer ?? ctx.webServer;
    if (registry === undefined || registry === null || typeof registry.register !== 'function') return;

    const resource = async (request) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        const route = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : '';

        if (request.method === 'GET' && (route === '' || route === 'state')) {
          const cwd = url.searchParams.get('cwd') ?? '';
          const scan = url.searchParams.get('scan') !== '0';
          return jsonResponse(200, buildSnapshot({ root, cwd: cwd !== '' ? cwd : hostCwd, hostCwd, scan }));
        }

        if (request.method === 'POST') {
          let body = null;
          try {
            body = await request.json();
          } catch {
            body = null;
          }
          // Un POST sin acción es un error del cliente, no una consulta: contestar con el estado
          // escondería el fallo justo cuando alguien está depurando el panel.
          const action = String(body?.action ?? '');
          if (body === null || !isObject(body) || action === '') {
            return jsonResponse(400, { ok: false, code: 'bad-request', message: 'un POST necesita un cuerpo JSON con «action»' });
          }
          const payload = isObject(body.payload) ? body.payload : body;
          const cwd = String(body.cwd ?? payload.cwd ?? '');
          const result = runAction({ root, action, payload, actor: body.actor === 'ai' ? 'ai' : 'human', cwd: cwd !== '' ? cwd : hostCwd, hostCwd });
          if (result?.ok === true && CHANGES_CATALOG.has(action)) {
            try {
              invalidate();
            } catch {
              /* sin invalidación queda el aviso del vigilante del almacén */
            }
          }
          return jsonResponse(200, result);
        }

        return jsonResponse(405, { ok: false, code: 'method', message: 'usa GET para el estado y POST para las acciones' });
      } catch (error) {
        return jsonResponse(500, { ok: false, code: 'internal', message: String(error?.message ?? error) });
      }
    };

    ctx.effect(() => {
      const off = registry.register({ kind: 'prefix', path: API_PREFIX, resource });
      return () => {
        try {
          off?.();
        } catch {
          /* ya retirada */
        }
      };
    });
  });

  // Diagnóstico: una herramienta no necesita esto, pero el arranque deja por escrito que el plugin está
  // montado y con qué raíz, que es lo primero que se pregunta cuando el panel no aparece.
  ctx.logger?.info?.(`lifecode-skill-center: centro en ${root} · api ${API_PREFIX}`);
}
