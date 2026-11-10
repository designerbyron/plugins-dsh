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
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadKnowledge, recordOriginVerification, withKnowledge } from './lib/knowledge.mjs';
import {
  API_PREFIX,
  CHANNEL_API,
  CHANNEL_BROWSER,
  apiRouteOf,
  capabilitiesPayload,
  centerRoot,
  handleApiRequest,
  healthPayload,
  inventoryEvidence,
  inventoryPayload,
  projectsPayload,
  workspacesPayload,
} from './lib/api.mjs';
import { skillProviderFor } from './lib/provider.mjs';
import { materializedRoot } from './lib/state.mjs';
import { centerTools } from './lib/tools.mjs';
import { createStoreSignal } from './lib/watch.mjs';

export { API_PREFIX };

/**
 * Comprueba el origen declarado de un hallazgo contra el catálogo real de subagentes del Host.
 *
 * El subagente no puede fabricar esta prueba: el cuerpo sólo trae `insightId`, y el hijo se busca en
 * `subagents.listChildren(...)`. No se usa `agents.currentInitiator()`: en un handler HTTP no hay
 * ejecución de agente y devolvía `null` (medido en vivo como 503 `initiator-unavailable`). En su lugar
 * se pregunta por las sesiones que el Host conoce (`agents.list()`) y se acepta como prueba que **alguna**
 * de ellas liste al hijo declarado; la sesión que lo lista queda escrita como `parentId`.
 *
 * Si el servicio no está o no expone `listChildren`, la respuesta es 503 y el hallazgo sigue
 * **declarado, no verificado**.
 */
async function originVerifyOutcome({ ctx, root, admission, body }) {
  const insightId = String(body?.insightId ?? '').trim();
  if (insightId === '') return { status: 400, body: { ok: false, code: 'bad-request', message: 'falta insightId' } };

  const subagents = ctx.get?.('subagents');
  const agents = ctx.get?.('agents');
  if (typeof subagents?.listChildren !== 'function') {
    return { status: 503, body: { ok: false, code: 'host-unavailable', message: 'el Host no expone subagents.listChildren: el origen sigue declarado' } };
  }

  const loaded = loadKnowledge(root);
  const insight = (loaded.document?.insights ?? []).find((item) => item.insightId === insightId) ?? null;
  if (insight === null) return { status: 404, body: { ok: false, code: 'insight-not-found', message: insightId } };

  const declared = insight.origin?.declared ?? {};
  const wanted = [String(declared.sessionId ?? ''), String(declared.parentRunId ?? '')].filter((value) => value !== '');
  if (wanted.length === 0) {
    return { status: 200, body: { ok: false, code: 'origin-not-declared', message: 'el hallazgo no declara la sesión que lo produjo: no hay nada que contrastar' } };
  }

  let sessions = [];
  try {
    sessions = typeof agents?.list === 'function' ? agents.list() : [];
  } catch {
    sessions = [];
  }
  const parentIds = [];
  for (const agent of Array.isArray(sessions) ? sessions : []) {
    const id = String(agent?.session?.id ?? agent?.sessionId ?? agent?.id ?? '');
    if (id !== '' && !parentIds.includes(id)) parentIds.push(id);
  }
  if (parentIds.length === 0) {
    return { status: 503, body: { ok: false, code: 'initiator-unavailable', message: 'el Host no expone sesiones sobre las que contrastar el origen' } };
  }

  const checked = [];
  for (const parentId of parentIds) {
    let children = [];
    try {
      children = await subagents.listChildren(parentId);
    } catch {
      continue;
    }
    checked.push(parentId);
    const match = (Array.isArray(children) ? children : []).find((child) => wanted.includes(String(child?.id ?? '')));
    if (match === undefined) continue;
    const written = withKnowledge(root, (document) => recordOriginVerification(document, {
      insightId,
      proof: { childId: String(match.id), parentId, verifiedBy: 'subagents.listChildren', at: new Date().toISOString() },
    }), { now: new Date().toISOString() });
    if (written.ok !== true || written.result?.ok !== true) {
      return { status: 409, body: { ok: false, code: written.result?.code ?? 'write-failed', message: written.result?.detail ?? '' } };
    }
    return { status: 200, body: { ok: true, insightId, origin: written.result.insight.origin, saved: written.saved === true } };
  }

  return { status: 200, body: { ok: false, code: 'origin-not-verified', message: 'el hijo declarado no aparece en el catálogo de ninguna sesión del Host', declaredFor: wanted, checked } };
}

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
 * Versión del propio plugin para el handshake de capacidades (R16.2). Se lee del `package.json` con
 * `createRequire` porque el adaptador es CJS-compatible dentro del harness y un import con `assert`
 * rompería en algunos cargadores. Si el fichero no se puede leer, el handshake sigue respondiendo: la
 * versión vacía es un dato honesto, no un error de la ruta.
 */
const PLUGIN_VERSION = (() => {
  try {
    return String(createRequire(import.meta.url)('./package.json')?.version ?? '');
  } catch {
    return '';
  }
})();

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

/** Un identificador de correlación válido; si no lo es, se genera uno. Nunca autoriza nada. */
const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

function requestIdOf(req) {
  const raw = String(req.headers?.['x-lifecode-request'] ?? '').trim().toLowerCase();
  if (REQUEST_ID_PATTERN.test(raw)) return raw;
  return `req-${Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')}`;
}

/**
 * La admisión del Host, medida y no supuesta.
 *
 * Medido en el escritorio (acto LSC-004): el canal `dsh-app://app` **no habla HTTP como un navegador**;
 * el shell borra `host`, `origin`, `cookie` y `sec-fetch-site` e inyecta la cookie de sesión del Host que
 * él mismo obtuvo al arrancar. Por eso una petición del panel llega aquí con credencial válida y sin
 * cabeceras de navegación, y una petición de un proceso local llega sin credencial.
 *
 * El canal **no** se deduce de que la admisión haya salido bien: se compara el peer devuelto con
 * `connection.browserPeer`. El principal es siempre `owner` (`PrincipalMap` sólo tiene `owner`), así que
 * no sirve para distinguir personas ni canales.
 *
 * Sin el servicio, o sin `admit`, la respuesta es `503 auth-unavailable`: fail-closed. No hay modo de
 * configuración que apague la autenticación, a propósito (acto LSC-005).
 */
function admitRequest(ctx, req) {
  const connection = ctx.get?.('connection');
  if (connection === undefined || connection === null) {
    return {
      ok: false,
      status: 503,
      code: 'auth-unavailable',
      message: 'este harness no ofrece el servicio de conexión: el centro no puede autenticar la petición',
    };
  }
  if (typeof connection.admit !== 'function') {
    return {
      ok: false,
      status: 503,
      code: 'auth-unavailable',
      message: 'el servicio de conexión no expone `admit`: no hay forma verificable de saber quién llama',
    };
  }
  let admission = null;
  try {
    admission = connection.admit({ headers: req.headers ?? {} });
  } catch (error) {
    return {
      ok: false,
      status: 503,
      code: 'auth-unavailable',
      message: `la admisión del Host falló: ${String(error?.message ?? error)}`,
    };
  }
  if (admission !== null && typeof admission === 'object' && 'rejection' in admission) {
    const status = admission.rejection === 403 ? 403 : 401;
    return {
      ok: false,
      status,
      code: status === 403 ? 'forbidden' : 'unauthorized',
      message:
        status === 403
          ? 'el Host no confía en esta petición: host u origen no son los del harness'
          : 'esta petición no trae la credencial del Host: no es una petición del panel',
    };
  }
  const peer = admission?.peer;
  if (peer === undefined || peer === null) {
    return {
      ok: false,
      status: 503,
      code: 'auth-unavailable',
      message: 'la admisión no devolvió un peer: no se puede saber quién llama',
    };
  }
  const browser = connection.browserPeer;
  const sameBrowser = browser !== undefined && browser !== null && String(peer.id) === String(browser.id);
  return {
    ok: true,
    channel: sameBrowser ? CHANNEL_BROWSER : CHANNEL_API,
    peerId: String(peer.id ?? ''),
  };
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

/**
 * El registro de workspaces del Host, si existe.
 *
 * Se resuelve **en cada petición** y no se guarda el fallo: el servicio puede no estar listo cuando
 * `apply()` corre (el registro durable espera a `sessionPersistence`), y cachear un `undefined` dejaría el
 * inventario vacío para siempre. Un servicio con forma rara se devuelve tal cual: `workspacesPayload` lo
 * valida y contesta `workspace-registry-unavailable`, que es reintentable.
 */
function resolveWorkspaceRegistry(ctx) {
  try {
    const registry = ctx.get?.('workspaceRegistry');
    return registry ?? null;
  } catch {
    return null;
  }
}

/**
 * Resuelve un servicio del Host **en cada petición** y devuelve `null` si no está.
 *
 * No se cachea el fallo: los servicios pueden montarse después de `apply()` (el registro durable espera a
 * `sessionPersistence`). Un servicio con forma rara se devuelve tal cual; el payload puro lo valida y
 * contesta el código cerrado (`skills-registry-unavailable`, `workspace-registry-unavailable`).
 */
function resolveService(ctx, name) {
  try {
    return ctx?.get?.(name) ?? null;
  } catch {
    return null;
  }
}

function resolveSkillsRegistry(ctx) {
  return resolveService(ctx, 'skills');
}

/** `ctx.get('loader')` y, si no está registrado como servicio, la propiedad del loader del contexto. */
function resolveLoader(ctx) {
  const service = resolveService(ctx, 'loader');
  if (service !== null && service !== undefined) return service;
  try {
    return ctx?.loader ?? null;
  } catch {
    return null;
  }
}

function resolveSessions(ctx) {
  return resolveService(ctx, 'sessionPersistence');
}

/**
 * `DSH_HOME` oficial: configurado > `$DSH_HOME` (blanco ignorado) > `~/.dsh`. Nunca cadena vacía: si ni
 * config ni entorno lo dan, la raíz personal del usuario es la respuesta oficial, no una ruta inventada.
 */
export function resolveDshHome(config = {}, env = process.env) {
  const configured = typeof config?.dshHome === 'string' ? config.dshHome.trim() : '';
  if (configured !== '') return configured;
  const fromEnv = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  if (fromEnv !== '') return fromEnv;
  const home = homedir();
  return home === '' ? '' : join(home, '.dsh');
}

export function resolveAgentsHome(config = {}, env = process.env) {
  const configured = typeof config?.agentsHome === 'string' ? config.agentsHome.trim() : '';
  if (configured !== '') return configured;
  const fromEnv = typeof env?.DSH_AGENTS_HOME === 'string' ? env.DSH_AGENTS_HOME.trim() : '';
  if (fromEnv !== '') return fromEnv;
  const home = homedir();
  return home === '' ? '' : join(home, '.agents');
}

/**
 * Acciones POST que pasan por una compuerta de preflight. Para juzgarlas con datos reales el adaptador
 * mide el inventario **antes** del despacho sincrónico: el motor de colisiones tiene que ver las entradas,
 * no un lienzo vacío (§4.3).
 */
const GATED_ACTIONS = new Set([
  'register-project',
  'adopt-project',
  'repair-manifest',
  'detach-project',
  'materialize-project',
  'toggle',
  'create',
  'publish',
  'import',
  'inspect-bundle',
  'import-bundle',
]);

/**
 * Fuentes que sólo el Host puede medir. Las demás (`state`, `manifest`, `filesystem-*`) las vuelve a
 * medir el gate sobre el almacén y el sistema de ficheros reales: heredar su estado de la foto del
 * inventario las pisaría con una lectura distinta de la que decide.
 */
const HOST_MEASURED_SOURCES = new Set(['skills-registry', 'loader', 'sessions']);

/**
 * Evidencia que el despacho **sincrónico** no puede leer por sí mismo.
 *
 * `runAction` no puede esperar, así que el adaptador preconsulta aquí el inventario completo y las
 * colisiones, y le pasa la foto ya medida. Si la medición falla se declara una fila `skills-registry` en
 * `error` (fail-closed honesto): nunca un `null` silencioso que aparente «no hay conflictos».
 */
async function resolvePreflightEvidence({ ctx, root, cwd, dshHome, agentsHome }) {
  try {
    const evidence = await inventoryEvidence({
      root,
      registry: resolveWorkspaceRegistry(ctx),
      skills: resolveSkillsRegistry(ctx),
      loader: resolveLoader(ctx),
      sessions: resolveSessions(ctx),
      hostCwd: cwd,
      cwd,
      dshHome,
      agentsHome,
      materializedRoot: materializedRoot(root),
    });
    if (evidence.unavailable !== undefined) {
      return {
        inventory: null,
        collisions: null,
        hostSources: [{ id: 'skills-registry', status: 'unavailable', reason: evidence.unavailable.message }],
      };
    }
    if (evidence.storeUnreadable !== undefined) {
      // El gate vuelve a leer el almacén y contesta 409: aquí no se inventa evidencia.
      return { inventory: null, collisions: null, hostSources: null };
    }
    return {
      inventory: evidence.inventory,
      collisions: evidence.collisions,
      // Sólo las fuentes que SÓLO el Host puede medir pisan la compuerta; las de E/S (state, manifest,
      // filesystem-*) las vuelve a medir el gate sobre el almacén real y no se heredan de la foto.
      hostSources: Array.isArray(evidence.sources)
        ? evidence.sources.filter((row) => HOST_MEASURED_SOURCES.has(String(row?.id ?? '')))
        : null,
    };
  } catch (error) {
    return {
      inventory: null,
      collisions: null,
      hostSources: [{ id: 'skills-registry', status: 'error', reason: `la medición del inventario falló: ${String(error?.message ?? error)}` }],
    };
  }
}

export function apply(ctx, config = {}) {
  const root = config.root ?? centerRoot();

  ctx.systemPrompt.section({
    name: 'lifecode-skill-center:protocol',
    order: SECTION_ORDER,
    interpolate: false,
    text: PROTOCOL,
  });

  // La creación asistida por IA también pasa por la compuerta: el adaptador mide inventario y colisiones
  // justo antes de ejecutar, para que un nombre que ya sirve otro proveedor no se cree a ciegas.
  const toolEvidence = async ({ cwd = '' } = {}) => {
    const measured = await resolvePreflightEvidence({
      ctx,
      root,
      cwd: cwd === '' ? resolveHostCwd(ctx) : String(cwd),
      dshHome: resolveDshHome(config),
      agentsHome: resolveAgentsHome(config),
    });
    // Sin inventario se conserva la fila de fuente medida (si la hay): la compuerta de creación debe
    // poder avisar `catalog-unverified` en vez de callar que el catálogo no se miró.
    return { inventory: measured.inventory ?? null, collisions: measured.collisions ?? null, hostSources: measured.hostSources ?? null };
  };
  for (const tool of centerTools({ root, evidence: toolEvidence })) ctx.tools.register(defineTool(tool));

  // ── El catálogo y su invalidación ───────────────────────────────────────────────────────────────
  // El registro cachea los catálogos y sólo los tira cuando el provider llama a la invalidación que él
  // mismo entrega. Se guarda aquí y se dispara por dos vías: el cambio del almacén (que cubre también lo
  // que muta fuera de este proceso) y cada acción del panel que lo toca.
  let invalidate = () => {};

  ctx.skills.registerProvider((control) => {
    if (typeof control?.invalidate === 'function') invalidate = control.invalidate;
    return skillProviderFor({
      root,
      // El proveedor sólo puede devolver una lista; cuando el centro está dañado devuelve vacío **sin**
      // escribir y avisa por aquí. El log es la única señal que el host puede dar del motivo.
      onDiagnostic: (diagnostic) => {
        try {
          ctx.logger?.warn?.(`lifecode-skill-center: ${diagnostic.message} (${diagnostic.integrity}, ${diagnostic.size} bytes)`);
        } catch {
          // un log que falla no puede tumbar el catálogo
        }
      },
    });
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
      const method = String(req.method ?? 'GET').toUpperCase();
      const requestId = requestIdOf(req);
      let url = null;
      try {
        url = new URL(String(req.url ?? '/'), 'http://localhost');
      } catch {
        url = new URL('/', 'http://localhost');
      }
      const route = apiRouteOf(url.pathname);
      const fail = (status, code, message) =>
        sendJson(res, status, { ok: false, code, message, requestId }, { head: method === 'HEAD' });

      // 1. La salud se sirve ANTES de cualquier admisión y antes del 503 por falta de `connection`.
      //    Dice si el Host puede autenticar y nada más: ni rutas, ni skills, ni proyectos, ni ids.
      if ((method === 'GET' || method === 'HEAD') && route === 'health') {
        const auth = ctx.get?.('connection') === undefined ? 'unavailable' : 'host';
        sendJson(res, 200, healthPayload({ auth }), { head: method === 'HEAD' });
        return;
      }

      // 2. El handshake de capacidades es la SEGUNDA y última superficie sin credencial. Se sirve antes
      //    de la admisión porque un panel contra un backend viejo (o con `connection` caída) necesita
      //    distinguir «esta ruta no existe» de «existe pero le faltan capacidades»; si quedara detrás de
      //    la puerta, un 503/401 sería indistinguible de un backend antiguo. Su payload es 100% estático
      //    y del propio plugin (id, versión, apiVersion, contractVersion, capabilities, rutas, contrato,
      //    generatedAt): no lee almacén, no resuelve servicios, no devuelve rutas de disco, recuentos ni
      //    datos del usuario. Todo lo demás sigue exigiendo admisión (paso 4).
      if ((method === 'GET' || method === 'HEAD') && route === 'capabilities') {
        sendJson(
          res,
          200,
          capabilitiesPayload({
            now: new Date().toISOString(),
            pluginVersion: PLUGIN_VERSION,
            implementation: 'r16.2',
          }),
          { head: method === 'HEAD' },
        );
        return;
      }

      // 3. Un `Origin` ajeno se rechaza antes de admitir. El proxy del escritorio borra esta cabecera en
      //    el canal del panel, así que esto sólo alcanza a peticiones directas; se conserva como defensa
      //    en profundidad y porque un Host/Origin no confiable es un 403 declarado en el contrato.
      const origin = String(req.headers?.origin ?? '');
      if (origin !== '') {
        const own = String(registry.getOrigin?.() ?? '');
        if (own !== '' && !sameOrigin(origin, own)) {
          fail(403, 'cross-origin', `este panel no atiende peticiones de ${origin}`);
          return;
        }
      }

      // 4. La puerta. Sin credencial del Host no se lee ni se escribe nada: el fallo es visible (401/403)
      //    y, si el harness no ofrece `connection`, es 503 — nunca una lectura libre por omisión.
      const admission = admitRequest(ctx, req);
      if (!admission.ok) {
        fail(admission.status, admission.code, admission.message);
        return;
      }

      // 5. Sólo después de admitir se toca el cuerpo y el almacén.
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

      let outcome = null;
      const hostCwd = resolveHostCwd(ctx);
      const dshHome = resolveDshHome(config);
      const agentsHome = resolveAgentsHome(config);
      try {
        if ((method === 'GET' || method === 'HEAD') && route === 'workspaces') {
          // El inventario de workspaces necesita el servicio del Host, así que se compone aquí: el despacho
          // puro no puede tocar `ctx`, y devolverle una foto falsa sería peor que decir «no disponible».
          outcome = await workspacesPayload({
            root,
            registry: resolveWorkspaceRegistry(ctx),
            hostCwd,
          });
        } else if ((method === 'GET' || method === 'HEAD') && route === 'inventory') {
          // Inventario único de skills de todas las fuentes (§5.1). El adaptador sólo resuelve servicios;
          // la decisión de qué es cada entrada y cuándo una fuente está incompleta vive en `lib/`.
          const params = new URLSearchParams(url.search);
          outcome = await inventoryPayload({
            root,
            registry: resolveWorkspaceRegistry(ctx),
            skills: resolveSkillsRegistry(ctx),
            loader: resolveLoader(ctx),
            sessions: resolveSessions(ctx),
            hostCwd,
            dshHome,
            agentsHome,
            materializedRoot: materializedRoot(root),
            limit: params.get('limit') ?? undefined,
          });
        } else if ((method === 'GET' || method === 'HEAD') && route === 'projects') {
          // Proyección de los siete estados (§5.4): el registro de workspaces y la sesión viva los pone
          // el Host; el estado, el manifiesto y el materializado los pone el centro.
          const params = new URLSearchParams(url.search);
          outcome = await projectsPayload({
            root,
            registry: resolveWorkspaceRegistry(ctx),
            hostCwd,
            skills: resolveSkillsRegistry(ctx),
            loader: resolveLoader(ctx),
            sessions: resolveSessions(ctx),
            cwd: params.get('cwd') ?? '',
            dshHome,
            agentsHome,
            materializedRoot: materializedRoot(root),
          });
        } else if (method === 'POST' && route === 'origin-verify') {
          outcome = await originVerifyOutcome({ ctx, root, admission, body });
        } else {
          // Las acciones que llevan compuerta necesitan la foto real del inventario y de las colisiones:
          // `runAction` es sincrónico y no puede medirlas, así que el adaptador las mide aquí, antes del
          // despacho. Si la medición falla, la fila de fuente viaja en `error` (nunca un `null` callado).
          let evidence = null;
          if (method === 'POST' && GATED_ACTIONS.has(String(body?.action ?? ''))) {
            evidence = await resolvePreflightEvidence({
              ctx,
              root,
              cwd: String(body?.cwd ?? body?.payload?.cwd ?? '') || hostCwd,
              dshHome,
              agentsHome,
            });
          }
          outcome = handleApiRequest({
            root,
            method,
            pathname: url.pathname,
            search: url.search,
            body,
            hostCwd,
            channel: admission.channel,
            // La comprobación del producto informa del inventario del Host, no de una foto: se le pasa el servicio
            // resuelto, igual que a la ruta de workspaces. Sin él, ese renglón diría «no disponible» siendo falso.
            registry: resolveWorkspaceRegistry(ctx),
            skills: resolveSkillsRegistry(ctx),
            loader: resolveLoader(ctx),
            sessions: resolveSessions(ctx),
            dshHome,
            agentsHome,
            materializedRoot: materializedRoot(root),
            hostSources: evidence?.hostSources ?? null,
            inventory: evidence?.inventory ?? null,
            collisions: evidence?.collisions ?? null,
          });
        }
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
