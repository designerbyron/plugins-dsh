/**
 * Ensamblado de contexto v0.2 (M1): diversidad MMR, deduplicación, presupuesto y citas verificables.
 *
 * Cada entrada lleva su `chunk_key` y el rango de caracteres en la fuente; un `[n]` del texto resuelve
 * contra `citations[n-1]`. El presupuesto se mide en tokens **estimados** (4 caracteres por token), y así
 * se declara; no se presenta como medición exacta.
 *
 * Dos entradas: `assembleContext` (síncrona, con vectores locales; compatible con v0.1) y
 * `assembleContextAsync` (usa el proveedor configurado, que puede ser remoto).
 */

import { embedText, cosine } from './embed.mjs';
import { RagError } from './errors.mjs';

export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

function headerFor(index, chunk) {
  const section = chunk.heading ? ` › ${chunk.heading}` : '';
  return `[${index + 1}] ${chunk.sourceTitle || chunk.title}${section}\n`;
}

function normalizeForDedupe(text) {
  return String(text).normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/**
 * Núcleo síncrono: recibe los vectores ya calculados por `chunkKey`.
 * @returns {{text:string, citations:Array, tokens:number, truncated:boolean, considered:number, deduped:number}}
 */
export function assembleContextWithVectors({
  results, config, budgetTokens = undefined, maxChunks = undefined, mmrLambda = undefined, vectors = undefined,
}) {
  if (!Array.isArray(results)) throw new RagError('internal', 'assembleContext espera resultados');
  const budget = budgetTokens ?? config.context.budgetTokens;
  const limit = Math.min(maxChunks ?? config.context.maxChunks, config.context.maxChunks);
  const lambda = mmrLambda ?? config.context.mmrLambda;
  if (!(budget > 0) || !(limit > 0)) throw new RagError('invalid-argument', 'presupuesto de contexto inválido');

  const seenText = new Set();
  const seenRange = new Set();
  const candidates = [];
  let deduped = 0;
  for (const row of results) {
    if (!row || typeof row.text !== 'string' || row.text === '') continue;
    const key = normalizeForDedupe(row.text);
    const range = `${row.sourceId}:${row.charStart}-${row.charEnd}`;
    if (seenText.has(key) || seenRange.has(range)) { deduped += 1; continue; }
    seenText.add(key);
    seenRange.add(range);
    candidates.push(row);
  }
  if (candidates.length === 0) {
    return { text: '', citations: [], tokens: 0, truncated: false, considered: 0, deduped };
  }

  const vectorMap = vectors ?? new Map(candidates.map((row) => [row.chunkKey, embedText(row.text, config.embedding)]));
  const maxScore = Math.max(...candidates.map((row) => row.score ?? row.rrf ?? 0), Number.EPSILON);
  const relevance = (row) => (row.score ?? row.rrf ?? 0) / maxScore;

  const pool = [...candidates];
  const selected = [];
  let tokens = 0;

  while (pool.length > 0 && selected.length < limit) {
    let bestIndex = -1;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const row = pool[i];
      let penalty = 0;
      for (const chosen of selected) {
        const a = vectorMap.get(row.chunkKey);
        const b = vectorMap.get(chosen.chunkKey);
        if (a && b) penalty = Math.max(penalty, cosine(a, b));
      }
      const value = lambda * relevance(row) - (1 - lambda) * penalty;
      if (value > bestValue) { bestValue = value; bestIndex = i; }
    }
    if (bestIndex < 0) break;
    const [candidate] = pool.splice(bestIndex, 1);

    const index = selected.length;
    const block = `${headerFor(index, candidate)}${candidate.text}`;
    const cost = estimateTokens(block) + 1;
    if (tokens + cost > budget) {
      if (selected.length === 0) {
        return { text: '', citations: [], tokens: 0, truncated: true, considered: candidates.length, deduped };
      }
      break;
    }
    selected.push(candidate);
    tokens += cost;
  }

  // Todas las claves se declaran siempre con un valor definido: una propiedad `undefined` hace que el
  // objeto no sobreviva a una ida y vuelta por JSON (`JSON.stringify` la omite) y el host rechaza el
  // resultado de la herramienta con «value is not lossless JSON». Observado en el perfil real con
  // citas de fuentes distintas (M6.5).
  const citations = selected.map((chunk, index) => ({
    n: index + 1,
    chunkKey: chunk.chunkKey ?? null,
    sourceId: chunk.sourceId ?? chunk.source_id ?? null,
    uri: chunk.uri ?? null,
    title: chunk.sourceTitle ?? chunk.title ?? null,
    heading: chunk.heading ?? null,
    ordinal: chunk.ordinal ?? null,
    charStart: chunk.charStart ?? null,
    charEnd: chunk.charEnd ?? null,
    score: chunk.score ?? null,
  }));

  const text = selected.map((chunk, index) => `${headerFor(index, chunk)}${chunk.text ?? ''}`).join('\n\n');
  return {
    text,
    citations,
    tokens,
    truncated: selected.length < candidates.length,
    considered: candidates.length,
    deduped,
  };
}

/** Compatibilidad v0.1: MMR con embeddings locales. */
export function assembleContext(options = {}) {
  return assembleContextWithVectors(options);
}

/**
 * Igual que la anterior, pero los vectores vienen del proveedor configurado (posible remoto).
 *
 * Sin embedder —el camino automático no tiene canal de aprobación para egresar— se usan vectores
 * locales sólo para la diversidad de MMR: es cálculo puro, no una llamada a un tercero.
 */
export async function assembleContextAsync({ results, config, embedder, vectors: prefetched = undefined, ...options } = {}) {
  if (!Array.isArray(results)) throw new RagError('internal', 'assembleContextAsync espera resultados');
  const candidates = results.filter((row) => row && typeof row.text === 'string' && row.text !== '');
  // Los vectores que ya existen en el almacén (mismo chunk, modelo y dimensión) se reutilizan tal cual;
  // sólo se calculan los que faltan. Con un proveedor remoto eso evita egreso y coste duplicados.
  const vectors = new Map(prefetched instanceof Map ? prefetched : []);
  const missing = candidates.filter((row) => !vectors.has(row.chunkKey));
  if (missing.length > 0) {
    if (embedder && typeof embedder.embed === 'function') {
      const embedded = await embedder.embed(missing.map((row) => row.text));
      missing.forEach((row, index) => vectors.set(row.chunkKey, embedded[index]));
    } else {
      // MMR con vectores locales aunque el proveedor configurado sea remoto: aquí no se egresa.
      const localEmbedding = { ...(config?.embedding ?? {}), provider: 'local-hash-v1' };
      for (const row of missing) vectors.set(row.chunkKey, embedText(row.text, localEmbedding));
    }
  }
  return assembleContextWithVectors({ results, config, vectors, ...options });
}