/**
 * Detección de skills existentes: ¿esto ya está resuelto, y dónde?
 *
 * El plan lo pide explícito —«el sistema debe poder identificar si ya existen skills relacionadas a
 * proyectos concretos»— y sin esto la biblioteca se llena de duplicados: la IA crea una skill nueva
 * donde ya había una que valía.
 *
 * Dos piezas separadas a propósito: `scan` (disco, tolerante) y `rank` (puro, medido).
 */

import { words } from './format.mjs';

/** Las palabras de un candidato, como conjunto. */
export function candidateWords(candidate) {
  const parts = [
    candidate?.id ?? '',
    candidate?.name ?? '',
    candidate?.description ?? '',
    candidate?.whenToUse ?? '',
    ...(Array.isArray(candidate?.tags) ? candidate.tags : []),
  ];
  return new Set(words(parts.join(' ')));
}

/**
 * Parecido entre dos conjuntos de palabras: Jaccard sobre la unión.
 *
 * Jaccard y no un coseno porque los textos son cortos y la interpretación es directa: 0.5 significa
 * que la mitad del vocabulario es común. Los umbrales de abajo salen de esa lectura.
 */
export function jaccard(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Las palabras compartidas, para explicar por qué dos skills se parecen. */
export function sharedWords(left, right, limit = 6) {
  const shared = [];
  for (const word of left) if (matchesAny(word, right)) shared.push(word);
  return shared.slice(0, limit);
}

/**
 * ¿Dos palabras son la misma idea?
 *
 * En español y en inglés la misma acción aparece flexionada —`desplegar` / `despliega` / `despliegue`—
 * y una igualdad estricta deja fuera justo los casos que importan: la detección que no ve su propia
 * biblioteca no sirve de nada. Con cinco letras de prefijo común basta para unir la familia y sigue
 * siendo demasiado específico para confundir dos conceptos distintos.
 */
const MIN_PREFIX = 5;

export function tokensMatch(left, right) {
  if (left === right) return true;
  // `nube` / `nubes`: la palabra corta entera es el principio de la otra. No se confunde con `dsh`,
  // que no es prefijo de nada de este vocabulario, y evita que el plural se pierda por longitud.
  if (left.length >= 3 && right.length > left.length && right.startsWith(left)) return true;
  if (right.length >= 3 && left.length > right.length && left.startsWith(right)) return true;
  if (left.length < MIN_PREFIX || right.length < MIN_PREFIX) return false;
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index >= MIN_PREFIX;
}

function matchesAny(word, set) {
  if (set.has(word)) return true;
  for (const other of set) if (tokensMatch(word, other)) return true;
  return false;
}

/** Parecido léxico tolerante a la flexión: el mismo Jaccard, contando como común la familia de palabras. */
export function lexical(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (matchesAny(word, right)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Un id igual o contenido en el otro es la señal más fuerte que hay: dos skills con el mismo nombre. */
export function idAffinity(leftId, rightId) {
  if (leftId === '' || rightId === '') return 0;
  if (leftId === rightId) return 1;
  if (leftId.startsWith(`${rightId}-`) || rightId.startsWith(`${leftId}-`)) return 0.7;
  return 0;
}

/**
 * Ordena candidatos contra una consulta.
 *
 * @param {{ text?: string, id?: string, words?: Set<string> }} query
 * @param {object[]} candidates
 * @param {{ threshold?: number, limit?: number }} [options]
 * @returns {object[]} los candidatos con `score` y `why`, de más a menos parecido.
 */
export function rank(query, candidates, { threshold = 0.16, limit = 12 } = {}) {
  const wordsOfQuery = query?.words instanceof Set ? query.words : candidateWords({ description: query?.text ?? '', id: query?.id ?? '' });
  const queryId = String(query?.id ?? '');
  const ranked = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const candidateSet = candidateWords(candidate);
    const lexicalScore = lexical(wordsOfQuery, candidateSet);
    const identity = idAffinity(queryId, String(candidate?.id ?? candidate?.name ?? ''));
    // La identidad pesa más que el vocabulario: un id repetido es la misma skill con otro contenido.
    const score = Math.round((identity > 0 ? identity * 0.6 + lexicalScore * 0.4 : lexicalScore) * 100) / 100;
    if (score < threshold) continue;
    const shared = sharedWords(wordsOfQuery, candidateSet);
    ranked.push({
      ...candidate,
      score,
      why: identity >= 1
        ? 'mismo id'
        : shared.length > 0
          ? `comparte: ${shared.join(', ')}`
          : 'descripción parecida',
    });
  }
  ranked.sort((left, right) => (right.score === left.score ? String(left.id).localeCompare(String(right.id)) : right.score - left.score));
  return ranked.slice(0, limit);
}
