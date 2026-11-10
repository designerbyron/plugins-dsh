/**
 * Identidad y forma: ids, rutas, versiones y palabras.
 *
 * Todo lo de aquí es **puro** —entra texto, sale texto— porque es la capa que decide qué carpeta se
 * escribe y qué versión sigue a cuál. Se prueba con `node --test`, sin harness y sin disco.
 */

import { createHash } from 'node:crypto';
import { basename } from 'node:path';

/** Gramática de un id de skill. El id es una ruta, así que se valida antes de usarse como tal. */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_ID_LENGTH = 64;
/** Un id más largo que esto se acorta al derivarlo de un título, pero se acepta si llega explícito. */
export const ID_SOFT_LENGTH = 48;

/**
 * Convierte un título en un id: sin acentos, minúsculas, guiones simples.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string} puede ser `''` si no queda nada utilizable; el llamador decide el error.
 */
export function slugId(text, max = ID_SOFT_LENGTH) {
  const source = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const full = source
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  const limit = Math.max(1, max);
  if (full.length <= limit) return full;
  const cut = full.slice(0, limit);
  // Cortar a lo bruto deja ids que terminan en media palabra («…-cero-c»). Si el corte cae dentro de una
  // palabra, se retira esa palabra entera; si no queda nada razonable, se acepta el corte tal cual.
  if (full[limit] === '-' || !cut.includes('-')) return cut.replace(/-+$/, '');
  const trimmed = cut.slice(0, cut.lastIndexOf('-'));
  return trimmed.length >= 12 ? trimmed : cut.replace(/-+$/, '');
}

/** ¿Se puede usar como id y como nombre de carpeta? */
export function isSafeId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id);
}

/**
 * Una ruta de trabajo, en la única forma en la que este plugin la compara: `/`, sin barra final.
 * No resuelve enlaces ni mayúsculas: eso lo hace `cwdKey`.
 */
export function normalizeCwd(cwd) {
  if (typeof cwd !== 'string') return '';
  let value = cwd.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (value.length > 1) value = value.replace(/\/+$/, '');
  return value;
}

/**
 * La clave de comparación de un proyecto. Windows no distingue mayúsculas en rutas, así que el mismo
 * proyecto abierto como `C:\Repo` y `c:\repo` tiene que ser UN proyecto y no dos.
 */
export function cwdKey(cwd) {
  return normalizeCwd(cwd).toLowerCase();
}

/**
 * Id estable de proyecto a partir de su ruta: legible (`plugins-dhs-a1b2c3d4`) y sin colisiones
 * probables. Estable significa que renombrar el nombre visible no mueve las asignaciones.
 */
export function projectIdFor(cwd) {
  const key = cwdKey(cwd);
  if (key === '') return null;
  const name = slugId(basename(key), 24) || 'proyecto';
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 8);
  return `${name}-${hash}`;
}

/** Nombre visible por defecto de un proyecto: el último tramo de su ruta. */
export function projectNameFor(cwd) {
  const normalized = normalizeCwd(cwd);
  if (normalized === '') return 'Proyecto';
  return basename(normalized) || normalized;
}

/** Huella corta y estable de un texto: identifica contenido sin guardarlo entero dos veces. */
export function shortHash(text, length = 12) {
  return createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, length);
}

/** `1.2.3` → números, o `null` si no es una versión. */
export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? '').trim());
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatVersion(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

/**
 * La versión que sigue. Por defecto **menor**, que es lo que significa una versión nueva de una skill:
 * misma identidad, contenido distinto.
 */
export function bumpVersion(version, level = 'minor') {
  const parsed = parseVersion(version) ?? { major: 1, minor: 0, patch: 0 };
  const next = { major: parsed.major, minor: parsed.minor, patch: parsed.patch };
  if (level === 'major') {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  } else if (level === 'patch') {
    next.patch += 1;
  } else {
    next.minor += 1;
    next.patch = 0;
  }
  return formatVersion(next);
}

/** Orden de versiones: negativo si `a` es anterior a `b`. Una versión ilegible ordena al principio. */
export function compareVersions(a, b) {
  const left = parseVersion(a) ?? { major: 0, minor: 0, patch: 0 };
  const right = parseVersion(b) ?? { major: 0, minor: 0, patch: 0 };
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

/** La última versión de una lista, sin confiar en el orden en el que llegó. */
export function latestVersion(versions) {
  const list = Array.isArray(versions) ? versions.filter((v) => parseVersion(v) !== null) : [];
  if (list.length === 0) return null;
  return list.slice().sort(compareVersions).at(-1);
}

/**
 * Palabras útiles de un texto: sin acentos, sin palabras vacías, sin repetir.
 *
 * Se usa para medir parecido entre skills. Quitar las palabras de relleno importa: sin eso, dos skills
 * de temas distintos comparten `the`, `with` y `para` y salen como "relacionadas".
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'when', 'where', 'into', 'your', 'you',
  'are', 'was', 'not', 'but', 'all', 'any', 'can', 'has', 'have', 'its', 'one', 'two', 'out',
  'use', 'using', 'used', 'skill', 'skills', 'proyecto', 'project', 'projects', 'para', 'por',
  'con', 'una', 'uno', 'unos', 'unas', 'que', 'los', 'las', 'del', 'mas', 'con', 'sus', 'como',
  'cuando', 'donde', 'este', 'esta', 'estos', 'estas', 'ser', 'son', 'hay', 'muy', 'sin', 'sobre',
  'cada', 'todo', 'toda', 'todos', 'todas', 'tambien', 'solo', 'entre', 'desde', 'hasta',
]);

export function words(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

export function unique(values) {
  return [...new Set(values)];
}
