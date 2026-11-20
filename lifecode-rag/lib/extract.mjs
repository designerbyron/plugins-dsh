/**
 * Extracción y normalización de texto (M2).
 *
 * Formatos de la v1: texto y familia textual. No se interpreta PDF/DOCX: se rechazan con
 * `path-unsupported` en vez de intentar heurísticas que producirían basura indexada.
 *
 * Invariantes:
 * - Un fichero binario (NUL en la cabecera) se rechaza; no se indexa «lo que se pueda».
 * - UTF-8 inválido se rechaza; no se sustituye por U+FFFD silenciosamente.
 * - La normalización es determinista: NFC, LF, sin BOM, sin NUL, sin espacios finales.
 */

import { RagError } from './errors.mjs';

/** Extensiones aceptadas y su MIME. La lista es deliberadamente corta y explícita. */
export const FORMATS = Object.freeze({
  '.txt': 'text/plain',
  '.text': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xhtml': 'text/html',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.ndjson': 'application/x-ndjson',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.xml': 'application/xml',
  // Código: se indexa como texto; el lenguaje no cambia el pipeline.
  '.js': 'text/plain', '.mjs': 'text/plain', '.cjs': 'text/plain', '.ts': 'text/plain',
  '.jsx': 'text/plain', '.tsx': 'text/plain', '.py': 'text/plain', '.rb': 'text/plain',
  '.php': 'text/plain', '.java': 'text/plain', '.cs': 'text/plain', '.go': 'text/plain',
  '.rs': 'text/plain', '.c': 'text/plain', '.h': 'text/plain', '.cpp': 'text/plain',
  '.hpp': 'text/plain', '.sh': 'text/plain', '.ps1': 'text/plain', '.sql': 'text/plain',
  '.css': 'text/plain', '.scss': 'text/plain', '.vue': 'text/plain', '.svelte': 'text/plain',
  '.toml': 'text/plain', '.ini': 'text/plain', '.cfg': 'text/plain', '.conf': 'text/plain',
});

const MIME_BY_EXTENSION = new Map(Object.entries(FORMATS));

/** Extensión en minúsculas, incluida la del último segmento (`.d.ts` → `.ts`). */
export function extensionOf(filePath) {
  const name = String(filePath).replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/** MIME declarado o derivado de la extensión. `undefined` si el formato no está soportado. */
export function mimeOf(filePath, declared = undefined) {
  if (typeof declared === 'string' && declared !== '') return declared;
  return MIME_BY_EXTENSION.get(extensionOf(filePath));
}

/** Rechaza un formato no soportado con el motivo concreto. */
export function assertSupportedFormat(filePath, declared = undefined) {
  const mime = mimeOf(filePath, declared);
  if (mime === undefined) {
    throw new RagError('path-unsupported', `formato no soportado: ${extensionOf(filePath) || '(sin extensión)'}`, {
      details: { path: filePath },
    });
  }
  return mime;
}

/** ¿Parece binario? Un NUL en la cabecera es la señal barata y fiable que usa Git. */
export function isProbablyBinary(bytes) {
  const limit = Math.min(bytes.length, 8_000);
  for (let i = 0; i < limit; i += 1) if (bytes[i] === 0) return true;
  return false;
}

/** Decodifica UTF-8 estricto quitando el BOM. Un byte inválido es un error, no un reemplazo. */
export function decodeUtf8(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new RagError('source-unreadable', 'el fichero no es UTF-8 válido', { cause });
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Uuml: 'Ü', Ntilde: 'Ñ',
  iexcl: '¡', iquest: '¿', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…',
});

/** Decodifica entidades HTML habituales y numéricas. */
export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

const BLOCK_TAGS = /<\/(?:p|div|section|article|li|tr|h[1-6]|blockquote|pre|table|ul|ol|dl|dt|dd|figure|figcaption)>|<br\s*\/?>/gi;

/** HTML → texto legible: fuera script/style/comentarios, bloques a saltos, entidades decodificadas. */
export function extractHtml(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(BLOCK_TAGS, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t\u00a0]+/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '');
}

/** XML → texto: se conserva el contenido y los saltos, no la estructura de etiquetas. */
export function extractXml(xml) {
  return decodeEntities(
    xml
      .replace(/<\?[\s\S]*?\?>/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<\/[^>]+>/g, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t\u00a0]+/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '');
}

/** JSON → texto con claves y valores, en líneas. Un JSON inválido se rechaza. */
export function extractJson(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (cause) {
    throw new RagError('source-unreadable', 'JSON inválido', { cause, details: { format: 'json' } });
  }
  return flattenJson(value).join('\n');
}

function flattenJson(value, prefix = '', out = [], depth = 0) {
  if (depth > 32) return out;
  if (value === null || typeof value !== 'object') {
    out.push(prefix === '' ? String(value) : `${prefix}: ${String(value)}`);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenJson(item, `${prefix}[]`, out, depth + 1));
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    flattenJson(item, prefix === '' ? key : `${prefix}.${key}`, out, depth + 1);
  }
  return out;
}

/** JSONL → una línea por objeto; una línea inválida invalida el fichero entero. */
export function extractJsonl(source) {
  const lines = source.split('\n');
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === '') continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch (cause) {
      throw new RagError('source-unreadable', `JSONL inválido en la línea ${index + 1}`, { cause });
    }
    out.push(...flattenJson(value));
  }
  return out.join('\n');
}

/** Parser mínimo CSV/TSV con comillas dobles y comillas escapadas. */
export function parseDelimited(source, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

/** CSV/TSV → texto tabular legible: `cabecera = valor; …` por fila. */
export function extractDelimited(source, delimiter) {
  const rows = parseDelimited(source, delimiter);
  if (rows.length === 0) return '';
  const header = rows[0].map((cell) => cell.trim());
  const out = [];
  rows.slice(1).forEach((row, index) => {
    const cells = row.map((cell, column) => {
      const key = header[column] === '' ? `col${column + 1}` : header[column];
      return `${key} = ${cell.trim()}`;
    });
    out.push(`fila ${index + 1}: ${cells.join('; ')}`);
  });
  return out.join('\n');
}

/** Normalización final, idempotente: NFC, LF, sin NUL, sin espacios finales, como mucho un salto doble. */
export function normalizeText(text) {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Punto de entrada de la extracción. Devuelve `{text, mime}` ya normalizado.
 * `title` lo aporta quien llama (nombre del fichero o `<title>` si es HTML).
 */
export function extractText(bytes, { path, mime: declared } = {}) {
  if (!(bytes instanceof Uint8Array)) {
    throw new RagError('internal', 'extractText espera Uint8Array');
  }
  if (isProbablyBinary(bytes)) {
    throw new RagError('binary-file', 'el fichero parece binario', { details: { path } });
  }
  const mime = assertSupportedFormat(path ?? '', declared);
  const raw = decodeUtf8(bytes);
  if (raw.trim() === '') throw new RagError('source-unreadable', 'el fichero está vacío', { details: { path } });

  let text;
  if (mime === 'text/html') text = extractHtml(raw);
  else if (mime === 'application/xml') text = extractXml(raw);
  else if (mime === 'application/json') text = extractJson(raw);
  else if (mime === 'application/x-ndjson') text = extractJsonl(raw);
  else if (mime === 'text/csv') text = extractDelimited(raw, ',');
  else if (mime === 'text/tab-separated-values') text = extractDelimited(raw, '\t');
  else text = raw;

  const normalized = normalizeText(text);
  if (normalized === '') throw new RagError('source-unreadable', 'el fichero no contiene texto utilizable', { details: { path } });
  return { text: normalized, mime };
}
