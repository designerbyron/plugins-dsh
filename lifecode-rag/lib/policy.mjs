/**
 * Política de rutas (M5, P0.4/P1.9): qué se puede leer para indexar y qué nunca.
 *
 * La exclusión del Skill Center es **incondicional**: no depende de que exista, de que esté dentro del
 * cwd ni de una lista de raíces permitidas. Se comprueba por segmento de ruta *y* por ruta canónica,
 * porque las tres ubicaciones reales (repo, estado en `$DSH_HOME`, copia instalada en el perfil) no
 * comparten un prefijo único y ninguna es un enlace.
 *
 * La canonicalización con `realpath` resuelve symlinks y junctions de Windows antes de decidir, así que
 * un acceso directo dentro del cwd no puede apuntar al almacén protegido.
 */

import { lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { RagError } from './errors.mjs';
import { isWithin } from './paths.mjs';

/** Nombres de producto que nunca se indexan. En minúsculas; se comparan por segmento. */
export const PROTECTED_SEGMENTS = Object.freeze(['lifecode-skill-center']);

/**
 * Nombres de fichero que la sincronización periódica excluye por PATRÓN (M6.7 §5.1).
 *
 * Es una defensa en profundidad barata: el índice nunca debe contener credenciales, y una pasada
 * automática no tiene a nadie mirando cada fichero nuevo. La lista es deliberadamente corta y por
 * nombre exacto o extensión, para no excluir documentación legítima (p. ej. `environment.md` NO cae,
 * `id_rsa` sí). No es un gestor de secretos: un secreto con nombre inocente y dentro de la raíz
 * autorizada sigue siendo indexable, y por eso el contrato dice «sin secretos en la raíz».
 *
 * Se compara el nombre en minúsculas. `*.example`/`*.sample` sí se excluyen: son plantillas con la
 * misma forma que el fichero real y el valor diferencial es cero.
 */
export const SENSITIVE_NAME_PATTERNS = Object.freeze([
  /^\.env(\..+)?$/,
  /^\.npmrc$/,
  /^\.netrc$/,
  /^\.pgpass$/,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /^.*\.(pem|key|pfx|p12|keystore|jks)$/,
  /^.*\.(env|secrets?|credentials?)(\.(local|production|development|test))?$/,
  /^(.*[-_.])?(secrets?|credentials?)([-_.].*)?\.(json|ya?ml|toml|ini)$/,
]);

/** ¿El nombre del fichero (sin ruta) parece un secreto por su forma? */
export function isSensitiveName(name) {
  const lower = String(name ?? '').toLowerCase().trim();
  if (lower === '') return false;
  return SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(lower));
}

const WINDOWS_DEVICES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** ¿La ruta cae en un producto protegido? Comparación por segmento, insensible a mayúsculas. */
export function isProtectedPath(filePath) {
  const segments = String(filePath).split(/[\\/]+/).filter(Boolean).map((segment) => segment.toLowerCase());
  return segments.some((segment) => PROTECTED_SEGMENTS.includes(segment));
}

/**
 * Valida y canonicaliza una ruta de lectura.
 * @returns {{realPath:string, outsideRoots:boolean, directory?:boolean}}
 */
export function classifyPath(filePath, { cwd, roots = [], ragRootPath = null, allowDirectory = false } = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new RagError('invalid-argument', 'ruta vacía');
  }
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new RagError('invalid-argument', 'no se pudo determinar el directorio de trabajo de la sesión');
  }
  const requested = resolve(cwd, filePath);
  const name = basename(requested);
  if (name.includes(':') || WINDOWS_DEVICES.test(name)) {
    throw new RagError('path-unsupported', `nombre de fichero no admitido: ${name}`, { details: { path: requested } });
  }

  // §14: no se sigue un symlink/junction/reparse point. Se rechaza por su propio nombre antes de
  // resolver, para que un enlace a una ruta protegida no se convierta en una lectura de esa ruta.
  let linkStats;
  try {
    linkStats = lstatSync(requested);
  } catch (cause) {
    throw new RagError('source-unreadable', 'la ruta no existe o no se puede resolver', { cause, details: { path: requested } });
  }
  if (linkStats.isSymbolicLink()) {
    throw new RagError('path-escape', 'la ruta es un enlace simbólico o junction y no se sigue', { details: { path: requested } });
  }

  let realPath;
  try {
    realPath = realpathSync.native(requested);
  } catch (cause) {
    throw new RagError('source-unreadable', 'la ruta no existe o no se puede resolver', { cause, details: { path: requested } });
  }

  if (isProtectedPath(realPath) || isProtectedPath(requested)) {
    throw new RagError('path-denied', 'la ruta pertenece a un producto protegido y no se indexa', { details: { path: realPath } });
  }
  if (ragRootPath && isWithin(ragRootPath, realPath)) {
    throw new RagError('path-denied', 'la ruta pertenece al propio almacén de LifeCode RAG', { details: { path: realPath } });
  }
  for (const root of roots) {
    if (isProtectedPath(root)) throw new RagError('invalid-config', `raíz permitida protegida: ${root}`);
  }

  // A8: un enlace duro puede dar acceso a un fichero protegido con otro nombre. Se rechaza.
  let stats;
  try {
    stats = statSync(realPath);
  } catch (cause) {
    throw new RagError('source-unreadable', 'no se puede leer la ruta', { cause, details: { path: realPath } });
  }
  // `cwd` puede faltar: el host no siempre puede resolverlo (o la sesión se resolvió por selección
  // explícita). Sin cwd sólo cuentan las raíces; `resolve(null)` reventaría con TypeError.
  const allowed = [cwd, ...roots].filter((root) => typeof root === 'string' && root.length > 0);
  const outsideRoots = !allowed.some((root) => isWithin(resolve(root), realPath));
  if (stats.isDirectory()) {
    if (!allowDirectory) throw new RagError('path-unsupported', 'no es un fichero regular', { details: { path: realPath } });
    return { realPath, outsideRoots, directory: true };
  }
  if (!stats.isFile()) throw new RagError('path-unsupported', 'no es un fichero regular', { details: { path: realPath } });
  if (stats.nlink > 1) throw new RagError('hardlink-refused', 'el fichero tiene enlaces duros', { details: { path: realPath, nlink: stats.nlink } });

  return { realPath, outsideRoots };
}
