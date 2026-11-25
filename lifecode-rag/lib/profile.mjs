/**
 * Resolución de rutas Project-Aware (PA1).
 *
 * El registro es **uno por perfil**. Para que dos perfiles de DeepSeek Harness no compartan
 * conocimiento, la raíz de datos se deriva del perfil activo y no de una ruta fija:
 *
 *   1. `LIFECODE_RAG_ROOT` (anulación explícita, útil en pruebas y desarrollo).
 *   2. `$DSH_HOME/lifecode-rag/profiles/<profileKey>/`.
 *
 * `profileKey` es el nombre del perfil (`DSH_PROFILE`) o, si no está, el nombre del directorio del
 * perfil (`DSH_PROFILE_DIR`) o, si tampoco está, el directorio de perfil con el que el host arrancó
 * (`<...>/profiles/<nombre>` en `process.argv`). El host de escritorio recibe el perfil como
 * argumento y no siempre lo publica en el entorno; sin este último paso el plugin dentro de la app
 * resolvía `default` mientras el perfil real era `desktop`. Nunca se inventa una ruta: si no hay
 * ninguna señal se usa `default`.
 *
 * El almacén v0.2 anterior vivía en `$DSH_HOME/lifecode-rag/rag.sqlite3`; esa ruta se conserva como
 * origen de migración y **no** se reutiliza como raíz de perfil.
 */

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { RagError } from './errors.mjs';

function nonBlank(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new RagError('invalid-config', `${name} debe ser una cadena`);
  if (value.trim() === '') {
    throw new RagError('invalid-config', `${name} está definida pero vacía (fail-closed)`);
  }
  return value.trim();
}

export function dshHome(env = process.env) {
  const home = nonBlank(env.DSH_HOME, 'DSH_HOME');
  return home ? resolve(home) : join(homedir(), '.dsh');
}

/**
 * Nombre estable del perfil activo, saneado para usarse como segmento de ruta.
 *
 * El saneado es con pérdida: `Pruebas` y `pruebas`, o `a b` y `a-b`, colapsan al mismo nombre. Como
 * esta clave separa registros y almacenes, dos perfiles distintos compartirían conocimiento y
 * auditoría. Cuando el saneado cambia el valor original se añade un sufijo derivado del nombre crudo,
 * de modo que la identidad sigue siendo determinista pero inyectiva. Los nombres que ya son válidos
 * (`desktop`, `headless`) no cambian: no hay migración de rutas para los perfiles existentes.
 */
export function profileKey(env = process.env, argv = process.argv) {
  const own = nonBlank(env.LIFECODE_RAG_PROFILE, 'LIFECODE_RAG_PROFILE');
  const name = own ?? nonBlank(env.DSH_PROFILE, 'DSH_PROFILE');
  const dir = nonBlank(env.DSH_PROFILE_DIR, 'DSH_PROFILE_DIR');
  const fromEnv = name ?? (dir ? basename(dir) : '');
  const raw = fromEnv || profileNameFromArgv(argv) || '';
  if (raw === '') return 'default';
  const clean = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (clean === '' || clean === '.' || clean === '..') return `default-${suffixOf(raw)}`;
  const truncated = clean.slice(0, 64);
  if (truncated === raw && clean === raw) return truncated;
  // Sólo cuando hubo pérdida se desambigua; el resultado cabe en el límite de 64 caracteres.
  return `${truncated.slice(0, 55)}-${suffixOf(raw)}`;
}

/** Sufijo estable (8 hex) de la identidad cruda del perfil. */
function suffixOf(raw) {
  return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 8);
}

/**
 * Nombre del perfil a partir del argumento con el que arrancó el host.
 *
 * El host de escritorio se lanza como `<exe> .../dsh-desktop-host/lib/index.js <dsh> <profileDir>
 * <runtime> ...` y no exporta `DSH_PROFILE` en su propio entorno (esas variables se inyectan a los
 * procesos hijos). Buscar aquí un directorio real `.../profiles/<nombre>` evita que el plugin dentro
 * de la app resuelva `default` y no encuentre el registro del perfil activo. Sólo cuenta una ruta
 * absoluta existente cuyo padre se llame `profiles`; cualquier otra cosa se ignora.
 */
function profileNameFromArgv(argv) {
  for (const arg of Array.isArray(argv) ? argv : []) {
    if (typeof arg !== 'string' || !isAbsolute(arg)) continue;
    if (basename(dirname(arg)) !== 'profiles') continue;
    try {
      if (statSync(arg).isDirectory()) return basename(arg);
    } catch {
      // Ruta desaparecida o inaccesible: no es una señal de identidad.
    }
  }
  return '';
}

/** Raíz de datos del perfil: contiene `registry.sqlite3` y `scopes/`. */
export function profileRoot(env = process.env, argv = process.argv) {
  const override = nonBlank(env.LIFECODE_RAG_ROOT, 'LIFECODE_RAG_ROOT');
  if (override) {
    if (!isAbsolute(override)) {
      throw new RagError('invalid-config', 'LIFECODE_RAG_ROOT debe ser una ruta absoluta');
    }
    return resolve(override);
  }
  const dataRoot = nonBlank(env.LIFECODE_RAG_DATA, 'LIFECODE_RAG_DATA');
  if (dataRoot) {
    if (!isAbsolute(dataRoot)) {
      throw new RagError('invalid-config', 'LIFECODE_RAG_DATA debe ser una ruta absoluta');
    }
    return join(resolve(dataRoot), 'profiles', profileKey(env, argv));
  }
  return join(dshHome(env), 'lifecode-rag', 'profiles', profileKey(env, argv));
}

/**
 * Almacén único de v0.2, origen de la migración y dueño de la API heredada.
 *
 * Con `LIFECODE_RAG_ROOT` (pruebas y desarrollo) la raíz legada es ese mismo directorio: toda la
 * instalación queda confinada ahí y una prueba nunca puede tocar el `$DSH_HOME` real. Sin anulación
 * es `$DSH_HOME/lifecode-rag`, que es donde vivía v0.2.
 */
export function legacyRagRoot(env = process.env) {
  const override = nonBlank(env.LIFECODE_RAG_ROOT, 'LIFECODE_RAG_ROOT');
  if (override) {
    if (!isAbsolute(override)) {
      throw new RagError('invalid-config', 'LIFECODE_RAG_ROOT debe ser una ruta absoluta');
    }
    return resolve(override);
  }
  return join(dshHome(env), 'lifecode-rag');
}

export function registryPath(root) {
  return join(root, 'registry.sqlite3');
}

export function scopeRoot(root, scopeId) {
  return join(root, 'scopes', scopeId);
}
