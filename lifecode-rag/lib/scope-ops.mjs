/**
 * Operaciones sobre los ámbitos autorizados (PA3).
 *
 * Semántica decidida para no romper el contrato público v0.1:
 *
 *   ingest   escribe **sólo** en el almacén del proyecto; las bibliotecas son de sólo lectura.
 *   search   consulta el proyecto y las bibliotecas concedidas, agrega por puntuación y no mezcla
 *            resultados no autorizados.
 *   context  igual que search, con presupuesto global.
 *   get      busca en los ámbitos efectivos; si el mismo `ref` aparece en más de uno, falla por
 *            ambigüedad en vez de elegir uno.
 *   list     enumera **sólo** el proyecto: las bibliotecas se catalogan fuera de RAG.
 *   forget   borra **sólo** en el proyecto y rechaza borrar una fuente que vive en una biblioteca.
 *   reindex  reconstruye **sólo** el proyecto; una biblioteca la reindexa su dueño.
 *
 * Todo lo que abre un almacén lo hace a través del contexto autorizado (`exec-context.mjs`), que ya
 * validó identidad, perfil, selección y grants.
 */

import { RagError } from './errors.mjs';
import { assembleContextAsync } from './context.mjs';
import { blobToVector } from './embed.mjs';
import { createEmbedder } from './embedders.mjs';
import { relativeToRoots } from './paths.mjs';
import { getSource, listSources, search, selectBySource } from './search.mjs';
import { forgetSource, reindex as reindexStore } from './maintenance.mjs';
import { clearSyncState } from './sync.mjs';
import { expandInputs, walkDirectory } from './inputs.mjs';
import { ingestFiles } from './ingest.mjs';
import { recordMetrics } from './metrics.mjs';
import { withTransaction } from './db.mjs';

function scopeMeta(scope, state, extra = {}) {
  return { scope_id: scope.id, scope_kind: scope.kind, scope_name: scope.name, state, ...extra };
}

/**
 * Abre un ámbito para lectura con la semántica PA4:
 * - el proyecto sin almacén es un proyecto vacío legítimo (`null`);
 * - una **biblioteca** sin almacén no es una biblioteca vacía: su ausencia no se interpreta como
 *   «sin resultados» y mucho menos se crea en silencio;
 * - un almacén temporalmente ocupado se reintenta **una** vez; corrupto o ilegible no se reintenta.
 */
function openForRead(ctx, scope) {
  const attempt = () => ctx.open(scope, { create: false });
  let db;
  try {
    db = attempt();
  } catch (error) {
    const retryable = error instanceof RagError && error.details?.retryable === true;
    if (!retryable) throw error;
    db = attempt();
  }
  if (db || scope.kind === 'prj') return db;
  throw new RagError('scope-store-unavailable', 'el almacén de la biblioteca no existe', {
    details: {
      reason: 'library-missing', scope_id: scope.id, scope_kind: scope.kind, state: 'missing', retryable: false,
    },
  });
}

/**
 * Busca en todos los ámbitos efectivos y agrega.
 *
 * PA4: cada ámbito autorizado tiene que poder consultarse. Desde que v0.1 no puede expresar
 * «resultado parcial», un ámbito que no se puede leer (ausente, corrupto, revocado) **aborta la
 * búsqueda** en vez de devolver un subconjunto que parecería exhaustivo. El proyecto caído siempre
 * abortaba; ahora también una biblioteca.
 */
export async function searchScopes(ctx, {
  query, limit, collection, tags, tagMode, strategy, config, embedder, now, scopes: only = null,
  diversity = 'fragment',
}) {
  const max = Math.min(config.search.maxLimit, Math.max(1, Math.trunc(Number(limit) || config.search.limit)));
  const perScope = Math.min(config.search.maxLimit, Math.max(max, max * 2));
  const collected = [];
  const scopes = [];
  const fallbacks = [];
  const started = Date.now();
  let mode = 'empty';

  for (const scope of only ?? ctx.scopes) {
    const db = openForRead(ctx, scope);
    if (!db) {
      scopes.push(scopeMeta(scope, 'uninitialized'));
      continue;
    }
    const result = await search(db, {
      query,
      limit: perScope,
      collection,
      tags,
      tagMode: tagMode ?? 'any',
      strategy,
      config,
      diversity,
      embedder,
      now,
      record: scope.kind === 'prj',
    });
    if (result.diagnostics?.degraded === true) {
      // Con varios ámbitos, un canal caído degrada la búsqueda entera: se declara una vez y con el código,
      // nunca con el mensaje del proveedor (que puede arrastrar detalles internos).
      fallbacks.push({ scopeId: scope.id, scopeKind: scope.kind, code: result.diagnostics.semantic.error ?? 'embedding-failed' });
    } else {
      mode = result.mode;
    }
    for (const row of result.results) {
      collected.push({ ...row, scopeId: scope.id, scopeKind: scope.kind });
    }
    scopes.push(scopeMeta(scope, 'searched', { results: result.results.length, truncated: result.vectors.truncated }));
  }

  // Un solo ámbar no se pinta de verde: si cualquier ámbito degradó, la respuesta no es exhaustiva por la
  // vía semántica y así se declara.
  const degraded = fallbacks.length > 0;

  // Punto de control de PA4-B: si la autorización cambió mientras se consultaba, no se devuelve nada.
  ctx.checkpoint('search:return');
  collected.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.rrf ?? 0) - (a.rrf ?? 0) || a.chunkKey.localeCompare(b.chunkKey));
  // La selección documental se aplica tras el merge y antes del recorte final: el re-orden por `score`
  // desharía el orden que fijó el motor. Es idempotente, así que aplicarla en ambos niveles es seguro.
  const ordered = diversity === 'source'
    ? selectBySource(collected, { limit: max, maxPerSource: config.search.maxPerSource })
    : collected;
  return {
    results: ordered.slice(0, max),
    mode: degraded ? 'lexical-fallback' : mode,
    elapsedMs: Math.round((Date.now() - started) * 100) / 100,
    scopes,
    partial: false,
    errors: [],
    diagnostics: { degraded, fallbacks },
  };
}

/**
 * Carga los vectores ya guardados de los fragmentos recuperados, por ámbito y con el modelo **exacto**.
 *
 * UX-2.2 · P0-2: la ingesta ya escribió estos vectores; recalcularlos para la diversidad de MMR pagaba
 * dos veces por el mismo texto (y con proveedor remoto, egreso y coste duplicados). Sólo se reutiliza lo
 * que coincide en `chunk_key`, `model` y `dim`; lo ausente o incompatible sigue el camino de generación
 * existente.
 */
function loadVectorsFor(ctx, rows, { model, dim }) {
  const vectors = new Map();
  if (!model || !Number.isInteger(dim) || dim <= 0) return vectors;
  const byScope = new Map();
  for (const row of rows) {
    if (!row?.chunkKey || !row?.scopeId) continue;
    const keys = byScope.get(row.scopeId) ?? new Set();
    keys.add(row.chunkKey);
    byScope.set(row.scopeId, keys);
  }
  for (const [scopeId, keys] of byScope) {
    const scope = ctx.scopes.find((candidate) => candidate.id === scopeId);
    if (!scope) continue;
    const db = openForRead(ctx, scope);
    if (!db) continue;
    const placeholders = [...keys].map(() => '?').join(',');
    const found = db.prepare(
      `SELECT chunk_key, vec, dim FROM vectors WHERE model = ? AND dim = ? AND chunk_key IN (${placeholders})`,
    ).all(model, dim, ...keys);
    for (const row of found) {
      try {
        vectors.set(row.chunk_key, blobToVector(row.vec, { dim }));
      } catch {
        // Vector guardado con otra forma: no se rompe la consulta, se recalcula en el ensamblado.
      }
    }
  }
  return vectors;
}

/** Contexto ensamblado sobre los ámbitos efectivos. */
export async function contextScopes(ctx, {
  query, budgetTokens, maxChunks, collection, tags, config, embedder, now, strategy, scopes: only = null,
}) {
  const candidates = await searchScopes(ctx, {
    query,
    limit: Math.min(config.search.maxLimit, Math.max((maxChunks ?? config.context.maxChunks) * 3, 12)),
    collection,
    tags,
    config,
    embedder,
    now,
    strategy,
    scopes: only,
  });
  const provider = embedder ?? createEmbedder(config);
  const vectors = loadVectorsFor(ctx, candidates.results, { model: provider.model, dim: provider.dim });
  const assembled = await assembleContextAsync({
    results: candidates.results,
    config,
    // Se pasa **el embedder del llamante**, no el creado aquí: si no lo hay, el ensamblado usa vectores
    // locales para MMR y no egresa. Crear el proveedor sólo sirve para conocer modelo y dimensión.
    embedder,
    vectors,
    budgetTokens,
    maxChunks,
  });
  try {
    const project = ctx.project();
    const db = project ? ctx.open(project, { create: false }) : null;
    if (db) {
      withTransaction(db, () => recordMetrics(db, [
        { metric: 'context.builds', value: 1, dim: 'scope', at: now },
        { metric: 'context.tokens', value: assembled.tokens, dim: 'estimated', at: now },
        ...(assembled.truncated ? [{ metric: 'context.truncated', value: 1, dim: 'budget', at: now }] : []),
      ]));
    }
  } catch { /* una métrica no puede tumbar un contexto correcto */ }
  // `context` alimenta citas verificables: presentar un contexto incompleto como completo sería peor que
  // fallar. `searchScopes` ya cierra en falso cualquier ámbito autorizado ilegible; esto queda como red
  // de seguridad si alguna ruta futura vuelve a producir parciales.
  if (candidates.partial) {
    throw new RagError('scope-store-unavailable', 'no se pudo abrir algún ámbito autorizado', {
      details: { errors: candidates.errors },
    });
  }
  // Último punto de control DESPUÉS de leer y ensamblar, justo antes de devolver el texto al modelo.
  ctx.checkpoint('context:return');
  return assembled;
}

function chunksOf(db, sourceId, limit) {
  return db.prepare(`SELECT chunk_key, ordinal, title, heading, text, char_start, char_end
    FROM chunks WHERE source_id = ? ORDER BY ordinal ASC LIMIT ?`).all(sourceId, limit);
}

/**
 * Resuelve una referencia en los ámbitos efectivos. Un `ref` que existe en más de un ámbito es
 * ambiguo: no se elige por orden de iteración.
 */
export function getAcross(ctx, { ref, limit = 50 } = {}) {
  const matches = [];
  for (const scope of ctx.scopes) {
    const db = openForRead(ctx, scope);
    if (!db) continue;
    try {
      const source = getSource(db, String(ref));
      matches.push({ scope, db, source });
    } catch (error) {
      if (!(error instanceof RagError)) throw error;
      // F-4: un `chunkKey` cuya FUENTE existe en este ámbito pero cuyo ordinal no, no es «sigue
      // buscando»: la referencia ya está resuelta y el fragmento pedido no está. Se propaga para que
      // el error diga qué pasó (motivo `chunk-not-found`) en vez de un «no existe la fuente» que
      // miente. El resto de `source-not-found` sigue significando «prueba en el siguiente ámbito».
      if (error.code !== 'source-not-found' || error.details?.reason === 'chunk-not-found') throw error;
    }
  }
  // Antes de decidir «no existe» o «es ambiguo» se confirma que la autorización sigue en pie. Se
  // comprueba al final, con los datos ya leídos: validar antes de leer y entregar después dejaba una
  // ventana en la que la lectura ocurría con una autorización que ya no existía.
  if (matches.length === 0) {
    ctx.checkpoint('get:not-found');
    throw new RagError('source-not-found', 'no existe una fuente con esa referencia en los ámbitos autorizados', {
      details: { ref: String(ref), scopes: ctx.scopes.map((scope) => scope.id) },
    });
  }
  if (matches.length > 1) {
    ctx.checkpoint('get:ambiguous');
    throw new RagError('invalid-argument', 'la referencia existe en más de un ámbito y no es inequívoca', {
      details: {
        reason: 'ambiguous-ref',
        ref: String(ref),
        scopes: matches.map((match) => match.scope.id),
      },
    });
  }
  const [{ scope, db, source }] = matches;
  const capped = Math.min(Number.isInteger(limit) && limit > 0 ? limit : 50, 200);
  // F-4 (1.5.11): si la referencia era un `chunkKey`, se devuelve ESE fragmento, no la lista entera.
  // Quien preguntó por `src_x#3` pidió el 3; devolverle todo el documento es otra cosa. El marcador
  // `matched` es aditivo y dice por qué forma se resolvió la referencia.
  const matchedOrdinal = Number.isInteger(source.matchedChunkOrdinal) ? source.matchedChunkOrdinal : null;
  const chunks = chunksOf(db, source.id, capped)
    .filter((chunk) => matchedOrdinal === null || chunk.ordinal === matchedOrdinal)
    .map((chunk) => ({
      chunkKey: chunk.chunk_key, ordinal: chunk.ordinal, heading: chunk.heading,
      charStart: chunk.char_start, charEnd: chunk.char_end, text: chunk.text,
    }));
  const payload = {
    scopeId: scope.id,
    scopeKind: scope.kind,
    source: {
      id: source.id, collection: source.collection, uri: source.uri, title: source.title, mime: source.mime,
      sha256: source.sha256, bytes: source.bytes, indexedAt: source.indexed_at,
      relUri: relativeToRoots(source.uri, scope.roots),
    },
    chunks,
  };
  if (matchedOrdinal !== null) payload.matched = { by: 'chunk-key', ordinal: matchedOrdinal };
  ctx.checkpoint('get:return');
  return payload;
}

/** Lista sólo el proyecto. */
export function listProject(ctx, { collection, tag, limit = 50, offset = 0 } = {}) {
  const scope = ctx.project();
  if (!scope) throw new RagError('internal', 'el contexto no contiene un proyecto');
  const db = openForRead(ctx, scope);
  if (!db) {
    ctx.checkpoint('list:return');
    return { total: 0, rows: [] };
  }
  const listed = listSources(db, {
    collection,
    tag,
    limit: Math.min(Number.isInteger(limit) && limit > 0 ? limit : 50, 200),
    offset: Number.isInteger(offset) && offset >= 0 ? offset : 0,
  });
  ctx.checkpoint('list:return');
  const roots = scope.roots ?? [];
  return {
    ...listed,
    // Aditivo: la ruta relativa a la raíz del ámbito, sin quitar la absoluta que ya consumían los clientes.
    rows: listed.rows.map((row) => ({ ...row, relUri: relativeToRoots(row.uri, roots) })),
  };
}

/** ¿Existe la fuente en alguna biblioteca concedida? Se usa para rechazar borrados cruzados. */
function findInLibraries(ctx, ref) {
  for (const scope of ctx.libraries()) {
    const db = openForRead(ctx, scope);
    if (!db) continue;
    try {
      return { scope, source: getSource(db, String(ref)) };
    } catch (error) {
      if (!(error instanceof RagError) || error.code !== 'source-not-found') throw error;
    }
  }
  return null;
}

/** Borra una fuente del proyecto. Nunca toca una biblioteca. */
export function forgetInProject(ctx, { ref, exec, now }) {
  const scope = ctx.project();
  if (!scope) throw new RagError('internal', 'el contexto no contiene un proyecto');
  const db = openForRead(ctx, scope);
  if (!db) {
    throw new RagError('source-not-found', 'el proyecto no tiene almacén todavía', {
      details: { ref: String(ref), scope_id: scope.id },
    });
  }
  let source;
  try {
    source = getSource(db, String(ref));
  } catch (error) {
    if (!(error instanceof RagError) || error.code !== 'source-not-found') throw error;
    const library = findInLibraries(ctx, ref);
    if (library) {
      throw new RagError('invalid-argument', 'la fuente pertenece a una biblioteca y no se puede borrar desde el proyecto', {
        details: { reason: 'library-read-only', ref: String(ref), scope_id: library.scope.id },
      });
    }
    throw error;
  }
  // El borrado es destructivo: se confirma la autorización justo antes de devolver el «preview».
  ctx.checkpoint('forget:preview');
  return {
    scope,
    preview: source,
    run() {
      // Segunda comprobación inmediatamente antes del efecto destructivo. Si el grant se revocó entre
      // la vista previa y la confirmación, no se borra nada. Si se revoca **después** del COMMIT, lo
      // borrado no se deshace: la atomicidad de `forget` termina en su COMMIT y así se documenta.
      ctx.assertAuthorized(scope, 'forget:write');
      const forgotten = forgetSource(db, {
        ref: source.id,
        now,
        actor: 'model',
        sessionId: exec.agent?.id ?? null,
        callId: exec.callId,
      });
      // El estado de sincronización no puede seguir afirmando que ese fichero está presente.
      clearSyncState({
        registryDb: ctx.registry,
        scopeKind: scope.kind,
        scopeId: scope.id,
        roots: scope.roots ?? [],
        uri: source.uri,
      });
      return forgotten;
    },
  };
}

/** Reindexa sólo el proyecto. */
export function reindexProject(ctx, { operation, config, now, exec }) {
  const scope = ctx.project();
  if (!scope) throw new RagError('internal', 'el contexto no contiene un proyecto');
  const db = openForRead(ctx, scope);
  if (!db) {
    throw new RagError('scope-store-unavailable', 'el proyecto no tiene almacén todavía', {
      details: { scope_id: scope.id },
    });
  }
  ctx.checkpoint('reindex:preview');
  return {
    scope,
    run() {
      ctx.assertAuthorized(scope, 'reindex:write');
      return reindexStore(db, {
        operation,
        config,
        now,
        actor: 'model',
        sessionId: exec.agent?.id ?? null,
        callId: exec.callId,
        signal: exec.signal,
      });
    },
  };
}

/** Ingesta en el proyecto: expande y clasifica antes de abrir el almacén. */
export function planIngest(ctx, { requested, cwd, config }) {
  const scope = ctx.project();
  if (!scope) throw new RagError('internal', 'el contexto no contiene un proyecto');
  const roots = scope.roots.map((root) => root.path);
  const classified = expandInputs(requested, {
    cwd,
    roots,
    ragRootPath: ctx.profileRoot,
    limit: config.maxFilesPerIngest,
  });
  return { scope, classified };
}

export async function runIngest(ctx, {
  scope, files, collection, tags, force, now, config, embedder, actor = 'model',
}) {
  // La escritura sólo va al proyecto y sólo si sigue autorizado justo antes de abrir.
  ctx.assertAuthorized(scope, 'ingest:open');
  const db = ctx.open(scope, { create: true });
  const result = await ingestFiles({
    db,
    root: scope.dir,
    files,
    collection,
    tags,
    force,
    now,
    config,
    embedder,
    actor,
    authorize: () => ctx.assertAuthorized(scope, 'ingest:file'),
  });
  // Cada fichero se confirma en su propio COMMIT: una revocación posterior impide seguir escribiendo y
  // devolver datos del ámbito, pero no deshace lo ya confirmado. Se revalida para dejar constancia.
  ctx.revalidate({ checkpoint: 'ingest:return', strict: false });
  return result;
}

export { walkDirectory };
