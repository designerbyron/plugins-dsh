/**
 * Etiquetas normalizadas (resolución v2.1 §2): minúsculas, recortadas y con forma estable.
 * Se validan antes de tocar el almacén para que una etiqueta inválida no deje media ingesta.
 */

import { RagError } from './errors.mjs';

export const TAG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const MAX_TAGS_PER_SOURCE = 20;

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeTag(raw) {
  if (typeof raw !== 'string') throw new RagError('invalid-tag', 'la etiqueta debe ser texto');
  const tag = raw.trim().toLowerCase();
  if (!TAG_PATTERN.test(tag)) {
    throw new RagError('invalid-tag', `etiqueta inválida: ${JSON.stringify(raw)}`, {
      details: { tag: raw, pattern: TAG_PATTERN.source },
    });
  }
  return tag;
}

/**
 * @param {unknown} raw
 * @param {{max?:number}=} options
 * @returns {string[]}
 */
export function normalizeTags(raw, { max = MAX_TAGS_PER_SOURCE } = {}) {
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const tags = [];
  for (const item of list) {
    const tag = normalizeTag(item);
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > max) {
    throw new RagError('invalid-tag', `demasiadas etiquetas: ${tags.length} (máximo ${max})`, {
      details: { count: tags.length, max },
    });
  }
  return tags;
}
