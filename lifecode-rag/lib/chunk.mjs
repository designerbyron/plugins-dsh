/**
 * Chunking (M2): cortes contiguos sobre el texto normalizado, con solape y contexto de encabezado.
 *
 * Decisión: los offsets (`char_start`/`char_end`) son exactos sobre el texto normalizado, y el solape
 * se implementa **retrocediendo el inicio** del siguiente chunk, no duplicando texto en memoria. Así
 * una cita puede verificarse siempre contra el fichero original con `slice(start, end)`.
 */

import { RagError } from './errors.mjs';

const HEADING = /^(#{1,6})[ \t]+(\S.*)$/;

/** Posiciones de encabezado Markdown (y `===`/`---` de setext, sólo si la línea anterior no está vacía). */
function headingIndex(text) {
  const headings = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const match = HEADING.exec(line.trim());
    if (match) headings.push({ index: offset, text: match[2].trim() });
    offset += line.length + 1;
  }
  return headings;
}

function headingAt(headings, position) {
  let found = null;
  for (const heading of headings) {
    if (heading.index > position) break;
    found = heading.text;
  }
  return found;
}

/** Busca un corte hacia atrás desde `candidate`, sin bajar de `floor`, prefiriendo párrafo > línea > frase > espacio. */
function snapBack(text, candidate, floor) {
  const patterns = ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' '];
  for (const pattern of patterns) {
    const at = text.lastIndexOf(pattern, candidate);
    if (at >= floor) return at + pattern.length;
  }
  return candidate;
}

/**
 * Divide el texto en chunks.
 * @param {string} text texto normalizado
 * @param {{targetChars?:number, maxChars?:number, overlapChars?:number}} options
 * @returns {Array<{ordinal:number, text:string, heading:string|null, charStart:number, charEnd:number, tokenEst:number}>}
 */
export function chunkText(text, options = {}) {
  const targetChars = options.targetChars ?? 1_200;
  const maxChars = options.maxChars ?? 2_000;
  const overlapChars = Math.min(options.overlapChars ?? 120, Math.floor(targetChars / 2));

  if (typeof text !== 'string') throw new RagError('internal', 'chunkText espera un string');
  if (!(targetChars > 0) || !(maxChars >= targetChars) || !(overlapChars >= 0)) {
    throw new RagError('invalid-config', 'límites de chunking incoherentes', { details: { targetChars, maxChars, overlapChars } });
  }
  if (text.trim() === '') return [];

  const headings = headingIndex(text);
  const chunks = [];
  let position = 0;

  while (position < text.length) {
    while (position < text.length && /\s/.test(text[position])) position += 1;
    if (position >= text.length) break;

    const remaining = text.length - position;
    let end;
    if (remaining <= maxChars) {
      end = text.length;
    } else {
      const candidate = Math.min(position + targetChars, position + maxChars);
      end = snapBack(text, candidate, position + Math.floor(targetChars * 0.6));
      if (end <= position) end = Math.min(position + maxChars, text.length);
    }

    const slice = text.slice(position, end);
    if (slice.trim() !== '') {
      chunks.push({
        ordinal: chunks.length,
        text: slice,
        heading: headingAt(headings, position),
        charStart: position,
        charEnd: end,
        tokenEst: Math.ceil(slice.length / 4),
      });
    }

    if (end >= text.length) break;
    let next = end - overlapChars;
    if (next <= position) next = end;
    // No empezar a mitad de palabra: avanzar al siguiente espacio si el solape cayó dentro de una.
    while (next < text.length && next > position && !/\s/.test(text[next - 1])) next += 1;
    position = next;
  }

  return chunks;
}
