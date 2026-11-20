/**
 * Resolución de configuración de LifeCode RAG (LE-RAG-01 · Fase 2).
 *
 * Precedencia **por clave**: perfil > global > defaults. Una sola validación sobre la mezcla,
 * de modo que el resultado es idéntico al que aplican las herramientas.
 *
 * El core no depende de DSH: la raíz de datos se puede fijar con `LIFECODE_RAG_DATA` y el perfil
 * con `LIFECODE_RAG_PROFILE`. Si no se indican, se conserva la raíz histórica (compatibilidad).
 *
 *   <dataRoot>/config.json                 configuración global (opcional)
 *   <dataRoot>/profiles/<profileKey>/config.json   configuración de perfil (opcional)
 *
 * Un fichero existente e inválido **falla en cerrado** (`invalid-config`) con la ruta en `details`;
 * nunca se cae en silencio a los defaults.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RagError } from './errors.mjs';
import { ragRoot, validateConfig } from './paths.mjs';
import { profileKey as legacyProfileKey } from './profile.mjs';

export const DATA_ROOT_ENV = 'LIFECODE_RAG_DATA';
export const PROFILE_ENV = 'LIFECODE_RAG_PROFILE';

/** Raíz de datos propia; si no se declara, la histórica del home (compatibilidad). */
export function resolveDataRoot(env = process.env) {
  const own = env?.[DATA_ROOT_ENV];
  if (typeof own === 'string' && own.trim() !== '') return own.trim();
  return ragRoot(env);
}

/** Perfil propio; si no se declara, el histórico (nombre del perfil del host). */
export function resolveProfileKey(env = process.env) {
  const own = env?.[PROFILE_ENV];
  if (typeof own === 'string' && own.trim() !== '') return own.trim();
  return legacyProfileKey(env);
}

export function configFilePaths({ dataRoot, profileKey }) {
  if (typeof dataRoot !== 'string' || dataRoot.trim() === '') {
    throw new RagError('invalid-config', 'falta la raíz de datos para resolver la configuración');
  }
  if (typeof profileKey !== 'string' || profileKey.trim() === '') {
    throw new RagError('invalid-config', 'falta el perfil para resolver la configuración');
  }
  return {
    global: join(dataRoot, 'config.json'),
    profile: join(dataRoot, 'profiles', profileKey, 'config.json'),
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Lectura estricta de una capa: ausente = null; ilegible o no-objeto = `invalid-config`. */
export function readConfigLayer(path) {
  if (!existsSync(path)) return { path, exists: false, value: null };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new RagError('invalid-config', 'no se pudo leer la configuración', { details: { path }, cause: error });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new RagError('invalid-config', 'la configuración no es JSON válido', { details: { path }, cause: error });
  }
  if (!isPlainObject(parsed)) {
    throw new RagError('invalid-config', 'la configuración debe ser un objeto JSON', { details: { path } });
  }
  return { path, exists: true, value: parsed };
}

/** Mezcla por clave, en orden de menor a mayor prioridad. Sólo fusiona objetos planos de primer nivel. */
export function mergeLayers(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!isPlainObject(layer)) continue;
    for (const [key, value] of Object.entries(layer)) {
      out[key] = isPlainObject(out[key]) && isPlainObject(value) ? { ...out[key], ...value } : value;
    }
  }
  return out;
}

/**
 * Resuelve la configuración efectiva.
 * @returns {{config: object, sources: {global: boolean, profile: boolean}, paths: object, dataRoot: string, profileKey: string}}
 */
export function resolveConfig({ dataRoot, profileKey } = {}) {
  const paths = configFilePaths({ dataRoot, profileKey });
  const global = readConfigLayer(paths.global);
  const profile = readConfigLayer(paths.profile);
  const merged = mergeLayers(global.value, profile.value);
  let config;
  try {
    config = validateConfig(merged);
  } catch (error) {
    // Se reetiqueta con las rutas implicadas; el mensaje original no contiene valores sensibles.
    throw new RagError('invalid-config', error?.message ?? 'configuración inválida', {
      details: {
        global: global.exists ? paths.global : null,
        profile: profile.exists ? paths.profile : null,
      },
      cause: error,
    });
  }
  return { config, sources: { global: global.exists, profile: profile.exists }, paths, dataRoot, profileKey };
}

/** Atajo para consumidores que sólo necesitan la configuración. */
export function effectiveConfig(env = process.env) {
  return resolveConfig({ dataRoot: resolveDataRoot(env), profileKey: resolveProfileKey(env) });
}
