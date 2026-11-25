/**
 * Contexto recuperado antes de responder (PA6).
 *
 * El host expone `agent/pre-step` (waterfall) con la identidad real del agente y la señal de
 * cancelación. Ahí se puede **añadir un mensaje de usuario** al lote que entra en el paso, lo que
 * garantiza que el contexto viaje en la misma petición al modelo. `agent.inject()` no sirve para eso:
 * su contrato dice «next pre-step», así que puede caer en el paso siguiente y perderse la petición
 * actual (ver `eval/pa6/PA6-DECISIONS.md`, D-PA6-01).
 *
 * Reglas:
 * - Desactivado por defecto (`config.autoContext.enabled`): inyectar cambia lo que ve el modelo.
 * - Sólo en el primer paso de un turno y sólo con un prompt humano; nunca sobre resultados de
 *   herramienta ni sobre nuestro propio mensaje (evita bucles y ruido).
 * - La autorización se resuelve con el MISMO camino que las herramientas (`withAuthorizedContext`):
 *   sin caché de grants, con revocación efectiva y cierre de almacenes.
 * - Cualquier fallo se ignora: un turno sin contexto es aceptable; un turno roto por el RAG, no.
 * - Dedupe por `(sessionId, turn, hash)`: el mismo texto no se inyecta dos veces en el mismo turno.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createEmbedder } from './embedders.mjs';
import { withAuthorizedContext } from './exec-context.mjs';
import { contextScopes, searchScopes } from './scope-ops.mjs';
import { isRagError } from './errors.mjs';

/** Kind propio en `MessageSourceMap`; los consumidores ignoran kinds que no conocen. */
export const AUTO_CONTEXT_SOURCE = Object.freeze({ kind: 'lifecode-rag', form: 'recall' });

/** Marcador visible del bloque inyectado; también sirve para reconocerlo si vuelve por el pipeline. */
export const AUTO_CONTEXT_HEADER = '[LifeCode RAG · contexto recuperado]';

const MAX_QUERY_CHARS = 1_000;
const REMEMBER_TURNS = 64;

/**
 * Palabras que no aportan señal léxica. Sin esta lista la puerta de `searchScopes` se abría con
 * «de», «la» o «que» y el prefijo FTS (`"de"*`) coincidía con casi cualquier documento, así que se
 * inyectaba ruido en cada turno (hallazgo del adaptador, PA-quality).
 */
const STOPWORDS = new Set([
  'a', 'al', 'algo', 'algún', 'alguno', 'ante', 'antes', 'aquel', 'aquí', 'así', 'aun', 'aunque',
  'bien', 'cada', 'como', 'cómo', 'con', 'contra', 'cual', 'cuál', 'cuando', 'cuándo', 'de', 'del',
  'desde', 'donde', 'dónde', 'dos', 'el', 'él', 'ella', 'ellas', 'ellos', 'en', 'entonces', 'entre',
  'era', 'es', 'esa', 'ese', 'eso', 'esta', 'está', 'estas', 'este', 'esto', 'estos', 'fue', 'ha',
  'hacia', 'hasta', 'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'más', 'me', 'mi', 'mis', 'mucho',
  'muy', 'nada', 'ni', 'no', 'nos', 'nosotros', 'o', 'otra', 'otro', 'para', 'pero', 'poco', 'por',
  'porque', 'que', 'qué', 'quien', 'quién', 'se', 'sea', 'según', 'ser', 'si', 'sí', 'sin', 'sobre',
  'solo', 'sólo', 'son', 'su', 'sus', 'tal', 'también', 'te', 'tiene', 'tienen', 'todo', 'todos', 'tu',
  'tus', 'un', 'una', 'uno', 'unos', 'y', 'ya', 'yo', 'the', 'and', 'for', 'with', 'this', 'that',
]);

/** ¿El texto tiene al menos un término con contenido? Evita abrir la puerta con sólo stopwords. */
export function hasContentTerm(text) {
  if (typeof text !== 'string') return false;
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function hashOf(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Texto plano de los bloques de una `UserMessage` del host. */
function textOfMessage(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const parts = [];
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n').trim();
}

/**
 * Quita los recordatorios de sistema que el host (o hooks) añaden al prompt: no son la pregunta del
 * usuario y ensucian la consulta léxica.
 */
export function stripSystemReminders(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
    .replace(/<system_reminder>[\s\S]*?<\/system_reminder>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿Estos mensajes son un prompt humano nuevo? Se exige `source.kind === 'user'` (o ausente) y que no
 * lleve el marcador de contexto inyectado. Los resultados de herramienta llegan en el mismo evento en
 * pasos posteriores, y `step > 1` los descarta antes de llegar aquí.
 */
export function isHumanPrompt(message) {
  if (!message || message.role !== 'user') return false;
  const kind = message.source?.kind;
  if (typeof kind === 'string' && kind !== 'user') return false;
  const text = textOfMessage(message);
  if (text.length < 8) return false;
  return !text.includes(AUTO_CONTEXT_HEADER);
}

/** Consulta para la recuperación: el último prompt humano del lote, sin recordatorios de sistema. */
export function queryFromMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (!isHumanPrompt(message)) continue;
    const text = stripSystemReminders(textOfMessage(message));
    if (text.length >= 8) return text.slice(0, MAX_QUERY_CHARS);
  }
  return '';
}

/**
 * Compone el bloque inyectado. Se recorta por `maxChars` y se numeran las citas para que el modelo
 * pueda referirse a ellas; nunca se inventan fragmentos.
 */
export function renderContext({ projectName = null, scopes = [], citations = [], text = '', maxChars = 1_600 } = {}) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return '';
  const scopeNames = scopes.map((scope) => scope.name).filter((name) => typeof name === 'string' && name);
  const scopeLine = projectName
    ? `Proyecto: ${projectName}${scopeNames.length > 0 ? ` · bibliotecas: ${scopeNames.join(', ')}` : ''}`
    : '';
  const header = [AUTO_CONTEXT_HEADER, scopeLine].filter(Boolean).join('\n');
  const citeLine = citations.length > 0
    ? `\n\nCitas: ${citations.slice(0, 20).map((cite, index) => `${index + 1}. ${cite.title || cite.uri || cite.chunkKey}`).join(' · ')}`
    : '';
  const budget = Math.max(200, maxChars) - header.length - citeLine.length - 2;
  if (budget <= 0) return '';
  const clipped = body.length > budget ? `${body.slice(0, Math.max(0, budget - 1)).trimEnd()}…` : body;
  const rendered = `${header}\n\n${clipped}${citeLine}`;
  return rendered.length > maxChars ? `${rendered.slice(0, maxChars - 1).trimEnd()}…` : rendered;
}

/** Construye la `UserMessage` del host sin importar nada de `@deepseek-ai/*`. */
export function contextMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { ...AUTO_CONTEXT_SOURCE },
  };
}

/**
 * Recupera el contexto para una sesión. Devuelve `null` cuando no hay nada que inyectar o cuando la
 * recuperación no es posible; nunca lanza hacia el host.
 *
 * @param {object} options
 * @param {object} options.services  Servicios del host (`env`, `workingDirectory`, `approval`…).
 * @param {object} options.agent     `Agent` real del host (identidad de sesión).
 * @param {AbortSignal} [options.signal]
 * @param {string} options.query
 * @param {object} options.config
 */
export async function collectContext({ services, agent, signal, query, config }) {
  const policy = config.autoContext;
  if (!policy.enabled || typeof query !== 'string' || query.trim() === '') return null;
  if (signal?.aborted) return null;
  // Sin canal de aprobación no hay egreso: con un proveedor remoto el hook automático no puede
  // enviar la pregunta ni los fragmentos a un tercero, así que se recupera sólo por léxico.
  const localProvider = !config?.embedding?.provider || config.embedding.provider === 'local-hash-v1';
  let embedder = null;
  if (localProvider) {
    try {
      embedder = createEmbedder(config);
    } catch {
      embedder = null;
    }
  }
  const strategy = embedder ? undefined : 'fts';
  return withAuthorizedContext(
    { services, exec: { agent, signal, callId: 'auto-context' } },
    async (ctx) => {
      // Una biblioteca concedida pero todavía sin almacén no aporta nada y hace fallar el conjunto
      // (la ausencia de una biblioteca no es una biblioteca vacía, PA4). Aquí se omite en vez de
      // abortar el contexto del turno; las herramientas siguen fallando en cerrado.
      const scopes = ctx.scopes.filter((scope) => scope.kind !== 'lib' || scope.exists !== false);
      if (signal?.aborted) return null;
      // Puerta léxica: con `hybrid`, la búsqueda vectorial siempre devuelve vecinos, aunque el turno no
      // hable de nada indexado. Inyectar esos vecinos sería ruido y gasto de tokens en cada petición,
      // así que sólo se inyecta cuando al menos un término de la consulta aparece de verdad en el
      // índice (D-PA6-02). Los stopwords no cuentan como señal.
      if (!hasContentTerm(query)) return null;
      const lexical = await searchScopes(ctx, {
        query,
        limit: 1,
        strategy: 'fts',
        config,
        embedder: null,
        scopes,
        now: typeof services.now === 'function' ? services.now() : Date.now(),
      });
      if (lexical.results.length === 0) return null;
      if (signal?.aborted) return null;
      const assembled = await contextScopes(ctx, {
        query,
        budgetTokens: policy.budgetTokens,
        maxChunks: policy.maxChunks,
        strategy,
        scopes,
        config,
        embedder,
        now: typeof services.now === 'function' ? services.now() : Date.now(),
      });
      const rendered = renderContext({
        projectName: ctx.resolved?.projectName ?? null,
        scopes: scopes.filter((scope) => scope.kind === 'lib'),
        citations: assembled.citations ?? [],
        text: assembled.text ?? '',
        maxChars: policy.maxChars,
      });
      if (!rendered) return null;
      return {
        text: rendered,
        tokens: assembled.tokens ?? null,
        citations: assembled.citations ?? [],
        scopes: scopes.map((scope) => scope.id),
      };
    },
  );
}

/**
 * Adaptador del hook: decide si en este paso toca inyectar, respeta el dedupe y devuelve la
 * `UserMessage` lista o `null`. No lanza: el host no debe romperse por el RAG.
 */
export function createAutoContext({ services, config, logger = console, now = () => Date.now() } = {}) {
  const seen = new Map();
  const warned = new Map();
  const policy = config?.autoContext ?? null;

  function markSeen(sessionId, turn, digest) {
    let entry = seen.get(sessionId);
    if (!entry || entry.size >= REMEMBER_TURNS) {
      entry = new Set();
      seen.set(sessionId, entry);
    }
    const key = `${turn}:${digest}`;
    if (entry.has(key)) return false;
    entry.add(key);
    return true;
  }

  /**
   * Limita el tiempo del hook: `agent/pre-step` está en el camino crítico de la respuesta, así que
   * se abandona la recuperación al vencer en vez de retrasar el turno. El trabajo que no responde a
   * la señal queda acotado por el timeout del proveedor (20 s) y su rechazo se ignora.
   */
  function withBudget(promise, timeoutMs, signal) {
    const ms = Math.max(100, Number(timeoutMs) || 2_000);
    let timer;
    const budget = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
      timer.unref?.();
    });
    const candidates = [promise, budget];
    let onAbort;
    if (signal) {
      const aborted = new Promise((resolve) => {
        if (signal.aborted) resolve(null);
        else {
          onAbort = () => resolve(null);
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
      candidates.push(aborted);
    }
    promise.catch(() => {});
    return Promise.race(candidates).finally(() => {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    });
  }

  /** Un fallo real (registro caído, almacén corrupto, revocación) no debe ser invisible. */
  function warnOnce(sessionId, code, message) {
    let codes = warned.get(sessionId);
    if (!codes) {
      codes = new Set();
      warned.set(sessionId, codes);
    }
    if (codes.has(code)) return;
    codes.add(code);
    logger.warn?.(`lifecode-rag contexto no disponible (${code}): ${message}`);
  }

  /**
   * @param {object} payload  Payload de `agent/pre-step`.
   * @param {object[]} messages  Mensajes que entran en el paso (ya decididos por el host).
   * @returns {Promise<object|null>} `UserMessage` a añadir o `null`.
   */
  async function messageFor({ agent, turn, step, signal }, messages) {
    const policyNow = config?.autoContext;
    if (!policyNow?.enabled) return null;
    if (step !== 1) return null;
    if (!Number.isInteger(turn) || turn < 1) return null;
    if (!agent || typeof agent !== 'object') return null;
    if (signal?.aborted) return null;
    const query = queryFromMessages(messages);
    if (!query) return null;
    const digest = hashOf(query);
    if (seen.get(agent.id)?.has(`${turn}:${digest}`)) return null;
    try {
      const collected = await withBudget(
        collectContext({ services, agent, signal, query, config }),
        policyNow.timeoutMs,
        signal,
      );
      if (!collected) return null;
      // Se marca SÓLO lo que se inyectó: un fallo no consume el turno (antes se marcaba al empezar).
      markSeen(agent.id, turn, digest);
      logger.debug?.(`lifecode-rag contexto: ${collected.citations.length} citas, ${collected.text.length} caracteres`);
      return contextMessage(collected.text);
    } catch (error) {
      // Revocación, almacén caído, sesión inválida…: se ignora y el turno sigue sin contexto, pero
      // el operador se entera una vez por sesión en vez de no verlo nunca.
      const code = isRagError(error) ? error.code : 'internal';
      warnOnce(agent.id, code, error?.message ?? String(error));
      return null;
    }
  }

  return {
    messageFor,
    policy,
    status() {
      return { enabled: Boolean(config?.autoContext?.enabled), ...(config?.autoContext ?? {}) };
    },
  };
}
