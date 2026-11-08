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

import { API_PREFIX, centerRoot, handleApiRequest } from './lib/api.mjs';
import { skillProviderFor } from './lib/provider.mjs';
import { centerTools } from './lib/tools.mjs';
import { createStoreSignal } from './lib/watch.mjs';

export { API_PREFIX };

/** Identidad del Loader. */
export const name = 'lifecode-skill-center';

/** Servicios necesarios; sin ellos el plugin queda inactivo en vez de lanzar. */
export const inject = ['tools', 'skills', 'systemPrompt'];

/** Orden de la sección estática: después de la guía del harness y del compilador anterior. */
const SECTION_ORDER = 9001;

/**
 * La base de la API del panel vive en `lib/api.mjs` (con la misma prueba que el resto de decisiones) y se
 * reexporta desde aquí porque el Loader y los tests la leen del adaptador.
 *
 * **Sin barra final, y esto está medido en el harness vivo:** registrada como
 * `/lifecode-skill-center/api/`, sólo respondía la ruta exacta de la base (200) y
 * `/lifecode-skill-center/api/state` caía en el 404 del fallback. Con la base sin barra final, el
 * prefijo cubre las subrutas. La coincidencia es `path` o `path + '/'`, nunca `path + 'x'`.
 */

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

/** Cuerpo máximo que acepta un POST del panel: una skill con sus referencias cabe de sobra. */
const MAX_BODY_BYTES = 1_048_576;

/**
 * Lee el cuerpo de un POST y lo deja en texto.
 *
 * La ruta del panel es un `handler` de Node, no un `resource`: un `resource` sólo contesta `GET`/`HEAD` y
 * el servidor devuelve 405 a cualquier `POST` antes de mirar la ruta (*«405 with Allow: GET, HEAD for any
 * other method, checked before matching»*). Con un `resource`, el panel no podía escribir nada.
 */
function readRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      if (overflow) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(overflow ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/** Escribe una respuesta JSON en el `ServerResponse` de Node. */
function sendJson(res, status, value, { head = false } = {}) {
  const payload = `${JSON.stringify(value)}\n`;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-length', Buffer.byteLength(payload));
  if (head) {
    res.end();
    return;
  }
  res.end(payload);
}

/**
 * ¿Dos orígenes son el mismo? Se compara el origen serializado (`protocolo//host:puerto`) y se tolera
 * la diferencia de puerto explícito frente a omitido, que el navegador no perdona.
 */
function sameOrigin(left, right) {
  const parse = (value) => {
    try {
      const url = new URL(value);
      const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80';
      return `${url.protocol}//${url.hostname}:${port}`;
    } catch {
      return '';
    }
  };
  const a = parse(left);
  const b = parse(right);
  return a !== '' && a === b;
}

/**
 * El directorio que el panel muestra como proyecto actual.
 *
 * El slot `main` no da binding de sesión para claves que no sean `conversation`, así que el cliente no
 * sabe en qué carpeta está trabajando. El host sí: `workingDirectory.get(session)` es la fuente, y las
 * sesiones vivas se piden a `agents.list()`. Se resuelve **en cada petición** (y no una vez al aplicar)
 * porque la persona cambia de proyecto durante la vida del plugin; la más reciente gana, que es lo que
 * el panel debe ofrecer por defecto.
 */
function resolveHostCwd(ctx) {
  const desktop = ctx.get?.('workingDirectory');
  const agents = ctx.get?.('agents');
  if (typeof desktop?.get !== 'function' || typeof agents?.list !== 'function') return '';
  let live = [];
  try {
    live = agents.list();
  } catch {
    return '';
  }
  for (let index = live.length - 1; index >= 0; index -= 1) {
    try {
      const value = desktop.get(live[index]?.session);
      if (typeof value === 'string' && value.trim() !== '') return value;
    } catch {
      /* una sesión sin directorio no es un fallo del panel */
    }
  }
  return '';
}

export function apply(ctx, config = {}) {
  const root = config.root ?? centerRoot();

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

    const handler = async (req, res) => {
      // Un navegador manda `Origin` en cada POST; si viene y no es el del propio harness, la petición
      // es de otra página y no se atiende. No sustituye a una credencial (la API vive en localhost y no
      // tiene autenticación: es un riesgo declarado), pero cierra la vía de un sitio ajeno.
      const origin = String(req.headers?.origin ?? '');
      if (origin !== '') {
        const own = String(registry.getOrigin?.() ?? '');
        if (own !== '' && !sameOrigin(origin, own)) {
          sendJson(res, 403, { ok: false, code: 'cross-origin', message: `este panel no atiende peticiones de ${origin}` });
          return;
        }
      }
      const method = String(req.method ?? 'GET').toUpperCase();
      let body = null;
      if (method === 'POST') {
        const raw = await readRequestBody(req);
        if (raw !== null) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = null;
          }
        }
      }
      let url = null;
      try {
        url = new URL(String(req.url ?? '/'), 'http://localhost');
      } catch {
        url = new URL('/', 'http://localhost');
      }
      let outcome = null;
      try {
        outcome = handleApiRequest({
          root,
          method,
          pathname: url.pathname,
          search: url.search,
          body,
          hostCwd: resolveHostCwd(ctx),
        });
      } catch (error) {
        outcome = { status: 500, body: { ok: false, code: 'internal', message: String(error?.message ?? error) } };
      }
      if (outcome.invalidate === true) {
        try {
          invalidate();
        } catch {
          /* sin invalidación queda el aviso del vigilante del almacén */
        }
      }
      sendJson(res, outcome.status, outcome.body, { head: method === 'HEAD' });
    };

    ctx.effect(() => {
      // Una ruta con `handler` y no con `resource`: un `resource` sólo contesta GET/HEAD y el servidor
      // responde 405 a todo POST antes de mirar la ruta, así que el panel no podría guardar nada.
      const off = registry.register({ kind: 'prefix', path: API_PREFIX, handler });
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
