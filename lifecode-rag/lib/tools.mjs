/**
 * Herramientas públicas `lifecode_rag_*` (M5 + PA3).
 *
 * Este módulo es núcleo puro: no importa nada del harness. Recibe los servicios que necesita
 * (`approval`, `workingDirectory`, `env`) y devuelve definiciones listas para `ctx.tools.register`.
 *
 * PA3: ninguna herramienta abre un almacén por su cuenta. Todas pasan por
 * `withAuthorizedContext`, que valida identidad, perfil, selección, grants y ámbitos antes de
 * entregar conexiones ya autorizadas. El contrato público v0.1 no cambia: mismos nombres,
 * parámetros y campos de salida.
 */

import { RagError } from './errors.mjs';
import { createEmbedder } from './embedders.mjs';
import { effectiveConfig } from './config-resolve.mjs';
import { withAuthorizedContext } from './exec-context.mjs';
import {
  contextScopes, forgetInProject, getAcross, listProject, planIngest, reindexProject, runIngest, searchScopes,
} from './scope-ops.mjs';

const NAMESPACE = 'lifecode_rag_';

/** Esquema de objeto laxo: el pipeline valida el valor devuelto contra esto. */
const OBJECT = Object.freeze({ type: 'object' });

function textBlock(text) {
  return [{ type: 'text', text }];
}

function jsonBlock(value) {
  return textBlock(JSON.stringify(value));
}

/** aprueba una operación sensible o falla en cerrado. Sólo `allowed-once` es un permiso. */
async function requireApproval(services, exec, toolName, reason, deniedCode = 'approval-required') {
  const approval = services.approval;
  if (!approval || typeof approval.request !== 'function') {
    throw new RagError('approval-unavailable', 'el host no ofrece aprobaciones; la operación se rechaza', {
      details: { tool: toolName },
    });
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName,
    callId: exec.callId,
    reason,
    displayReason: { en: reason },
    signal: exec.signal,
  });
  if (outcome !== 'allowed-once') {
    throw new RagError(deniedCode, 'la operación necesita aprobación humana', {
      details: { tool: toolName, outcome },
    });
  }
}

/**
 * Egress: un proveedor remoto envía texto del usuario a un tercero. Sólo se permite con aprobación por
 * llamada; si el host no ofrece aprobaciones, la operación se rechaza (fail closed).
 */
async function requireEgress(services, exec, toolName, embedder) {
  if (embedder.kind !== 'semantic') return false;
  await requireApproval(services, exec, toolName,
    `Enviar texto a un proveedor remoto de embeddings (${embedder.model}); la aprobación vale sólo para esta llamada`,
    'egress-denied');
  return true;
}

function embedderFor(services, config) {
  return services.embedder ?? createEmbedder(config, { fetchImpl: services.fetch, credential: services.credential });
}

async function sessionCwd(services, exec) {
  const directory = services.workingDirectory;
  if (!directory || typeof directory.ensure !== 'function') return null;
  try {
    return await directory.ensure(exec.agent, exec.signal);
  } catch {
    return null;
  }
}

function normalizePaths(value) {
  const list = Array.isArray(value) ? value : [value];
  const paths = list.map((item) => String(item ?? '').trim()).filter((item) => item !== '');
  if (paths.length === 0) throw new RagError('invalid-argument', 'indica al menos una ruta');
  return paths;
}

function scopeLabel(scope) {
  return `${scope.kind === 'prj' ? 'proyecto' : 'biblioteca'} ${scope.name} (${scope.id})`;
}

/**
 * Construye las siete definiciones.
 * @param {{config: object, root?: string, services: object}} options
 */
export function createToolDefinitions({ config = effectiveConfig().config, services = {} } = {}) {
  const now = () => (typeof services.now === 'function' ? services.now() : Date.now());
  const definitions = [];

  definitions.push({
    name: `${NAMESPACE}ingest`,
    description: 'Indexa ficheros de texto locales en la base de conocimiento de LifeCode RAG. Acepta ficheros o directorios del proyecto actual (omite .git, node_modules, dist, build y coverage); fuera del proyecto exige aprobación humana. Formatos: md, txt, html, json, jsonl, csv, tsv, yaml, xml, logs y código.',
    parameters: {
      type: 'object',
      properties: {
        paths: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        collection: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        force: { type: 'boolean' },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const requested = normalizePaths(args.paths);
      return withAuthorizedContext({ services, exec }, async (ctx) => {
        // expandir y clasificar antes de abrir el almacén del proyecto: una ruta protegida o un
        // enlace duro rechazan la llamada entera sin efectos.
        const cwd = ctx.cwd ?? await sessionCwd(services, exec);
        const { scope, classified } = planIngest(ctx, { requested, cwd, config });
        const outside = classified.filter((item) => item.outsideRoots).map((item) => item.realPath);
        if (outside.length > 0) {
          await requireApproval(services, exec, `${NAMESPACE}ingest`,
            `Indexar ${outside.length} ruta(s) fuera de ${scopeLabel(scope)}: ${outside.join(', ')}`, 'path-not-allowed');
        }
        const embedder = embedderFor(services, config);
        await requireEgress(services, exec, `${NAMESPACE}ingest`, embedder);
        const result = await runIngest(ctx, {
          scope,
          files: classified.map((item) => item.realPath),
          collection: args.collection ?? 'default',
          tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
          force: args.force === true,
          now: now(),
          config,
          embedder,
          actor: 'model',
        });
        return { ...result, approvedOutside: outside.length > 0 };
      });
    },
    output: {
      schema: OBJECT,
      render(args, value) {
        const lines = [
          `ingeridos: ${value.ingested.length}, omitidos: ${value.skipped.length}, errores: ${value.errors.length}`,
          ...value.ingested.map((item) => `+ ${item.uri} (${item.chunks} chunks)`),
          ...value.errors.map((item) => `! ${item.path}: ${item.code} — ${item.message}`),
        ];
        return textBlock(lines.join('\n'));
      },
    },
  });

  definitions.push({
    name: `${NAMESPACE}search`,
    description: 'Busca en la base de conocimiento local (híbrido léxico + vectores) y devuelve fragmentos compactos con su fuente y posición. Usa lifecode_rag_context para obtener el contexto listo para citar.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
        collection: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        tagMode: { type: 'string', enum: ['any', 'all'] },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      return withAuthorizedContext({ services, exec }, async (ctx) => {
        const embedder = embedderFor(services, config);
        await requireEgress(services, exec, `${NAMESPACE}search`, embedder);
        const result = await searchScopes(ctx, {
          query: args.query,
          limit: args.limit,
          collection: args.collection,
          tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
          tagMode: args.tagMode ?? 'any',
          // Único punto donde la configuración llega a la herramienta; `context` no pasa este valor.
          diversity: config.search.diversity,
          config,
          embedder,
          now: now(),
        });
        return {
          results: result.results.map((row) => ({
            chunkKey: row.chunkKey,
            sourceId: row.sourceId,
            uri: row.uri,
            title: row.sourceTitle || row.title,
            heading: row.heading,
            ordinal: row.ordinal,
            rrf: row.rrf,
            snippet: row.snippet,
          })),
          mode: result.mode,
          elapsedMs: result.elapsedMs,
        };
      });
    },
    output: { schema: OBJECT, render: (args, value) => jsonBlock(value) },
  });

  definitions.push({
    name: `${NAMESPACE}context`,
    description: 'Ensambla contexto listo para el modelo: fragmentos diversificados (MMR), dentro de un presupuesto de tokens, con citas numeradas verificables. Consulta el proyecto y las bibliotecas autorizadas.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        budgetTokens: { type: 'number' },
        maxChunks: { type: 'number' },
        collection: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      return withAuthorizedContext({ services, exec }, async (ctx) => {
        const embedder = embedderFor(services, config);
        await requireEgress(services, exec, `${NAMESPACE}context`, embedder);
        const assembled = await contextScopes(ctx, {
          query: args.query,
          budgetTokens: args.budgetTokens,
          maxChunks: args.maxChunks,
          collection: args.collection,
          tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
          config,
          embedder,
          now: now(),
        });
        // Proyección al contrato v0.1: cinco campos y citas sin metadatos internos de ámbito.
        return {
          text: assembled.text,
          citations: assembled.citations.map((citation) => ({
            n: citation.n,
            chunkKey: citation.chunkKey,
            sourceId: citation.sourceId,
            uri: citation.uri,
            title: citation.title,
            heading: citation.heading,
            ordinal: citation.ordinal,
            charStart: citation.charStart,
            charEnd: citation.charEnd,
          })),
          tokens: assembled.tokens,
          truncated: assembled.truncated,
          considered: assembled.considered,
        };
      });
    },
    output: {
      schema: OBJECT,
      render(args, value) {
        if (value.text === '') return textBlock('Sin resultados para el presupuesto solicitado.');
        const sources = value.citations.map((citation) => `[${citation.n}] ${citation.uri}${citation.heading ? ` › ${citation.heading}` : ''} (${citation.chunkKey})`);
        return textBlock(`${value.text}\n\nFuentes:\n${sources.join('\n')}`);
      },
    },
  });

  definitions.push({
    name: `${NAMESPACE}get`,
    description: 'Lee una fuente indexada y sus fragmentos completos, para verificar una cita o revisar el original normalizado. La referencia debe ser inequívoca dentro de los ámbitos autorizados.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['ref'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      return withAuthorizedContext({ services, exec }, (ctx) => {
        const found = getAcross(ctx, { ref: args.ref, limit: args.limit });
        return { source: found.source, chunks: found.chunks };
      });
    },
    output: { schema: OBJECT, render: (args, value) => jsonBlock(value) },
  });

  definitions.push({
    name: `${NAMESPACE}list`,
    description: 'Lista las fuentes indexadas del proyecto actual con filtros por colección o etiqueta y paginación.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        tag: { type: 'string' },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
      additionalProperties: false,
    },
    async execute(args, exec) {
      return withAuthorizedContext({ services, exec }, (ctx) => listProject(ctx, {
        collection: args.collection,
        tag: args.tag,
        limit: args.limit,
        offset: args.offset,
      }));
    },
    output: { schema: OBJECT, render: (args, value) => jsonBlock(value) },
  });

  definitions.push({
    name: `${NAMESPACE}forget`,
    description: 'Elimina una fuente del proyecto actual y todo lo indexado de ella. Operación destructiva: exige aprobación humana con el objetivo exacto y nunca borra una fuente de una biblioteca.',
    parameters: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      return withAuthorizedContext({ services, exec }, async (ctx) => {
        const pending = forgetInProject(ctx, { ref: args.ref, exec, now: now() });
        await requireApproval(services, exec, `${NAMESPACE}forget`,
          `Eliminar la fuente ${pending.preview.id} (${pending.preview.uri}) de ${scopeLabel(pending.scope)} y todo su índice`);
        const removed = await pending.run();
        // El recuento viaja **en el valor** de esta llamada: antes vivía en una variable del cierre y dos
        // `forget` concurrentes podían cruzar sus números. Campo aditivo sobre el contrato v0.1.
        return { forgotten: true, sourceId: removed.sourceId, uri: removed.uri, chunks: Number(removed.chunks ?? 0) };
      });
    },
    output: { schema: OBJECT, render: (args, value) => textBlock(`eliminada ${value.uri} (${value.chunks ?? 0} chunks)`) },
  });

  definitions.push({
    name: `${NAMESPACE}reindex`,
    description: 'Reconstruye el índice de texto, los vectores o ambos del proyecto actual. Exige aprobación humana porque recalcula el índice completo; no reindexa bibliotecas ajenas.',
    parameters: {
      type: 'object',
      properties: { operation: { type: 'string', enum: ['fts', 'vectors', 'all'] } },
      required: ['operation'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      return withAuthorizedContext({ services, exec }, async (ctx) => {
        const pending = reindexProject(ctx, { operation: args.operation, config, now: now(), exec });
        await requireApproval(services, exec, `${NAMESPACE}reindex`,
          `Reindexar (${args.operation}) ${scopeLabel(pending.scope)}`);
        const result = await pending.run();
        return {
          operation: result.operation,
          ...(result.fts ? { rebuiltChunks: result.fts.rebuiltChunks } : {}),
          ...(result.vectors ? { rebuiltSources: result.vectors.sources } : {}),
        };
      });
    },
    output: { schema: OBJECT, render: (args, value) => jsonBlock(value) },
  });

  return definitions;
}
