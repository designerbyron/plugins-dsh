/**
 * Protección estructural de raíces (PA4-D).
 *
 * PA2 detectaba el solapamiento *al resolver* (`scope-ambiguous`), pero el registro aceptaba dos
 * raíces padre/hijo o dos rutas que apuntaban a la misma zona física. Eso deja la ambigüedad
 * latente: dos ámbitos pueden reclamar la misma carpeta y el resultado depende del orden de la
 * consulta. Aquí la ambigüedad se rechaza **al registrar** y se vuelve a comprobar al abrir.
 *
 * Reglas:
 * - La ruta se canonicaliza con `realpathSync.native`, no con `resolve`: resolver la cadena de
 *   enlaces es lo único que impide que `C:\docs` y `C:\enlace-a-docs` convivan como dos raíces.
 * - En Windows la comparación es insensible a mayúsculas y acepta `\` y `/`.
 * - Un enlace simbólico, una junction o un reparse point que Node pueda ver (`lstat` marca
 *   `symbolicLink`) se rechaza con `root-symlink`: la zona física quedaría reclamada por el destino
 *   y por la raíz a la vez.
 * - Un solapamiento padre/hijo o un duplicado se rechaza con `root-overlap` / `invalid-argument`
 *   aunque pertenezcan al mismo ámbito: la misma carpeta no puede ser dos raíces distintas.
 * - Si el destino real de una raíz ya registrada cambia después (enlace re-apuntado, carpeta
 *   sustituida), `assertRootUnchanged` falla en cerrado con `root-changed`.
 *
 * Límites que este módulo **no** inventa:
 * - Node no expone el tag de reparse point de Windows: una junction y un enlace de directorio se
 *   ven igual (`lstat().isSymbolicLink()`), y un reparse point de proveedor (OneDrive, DFS) cuyo
 *   destino no cambia la ruta canónica no es distinguible. Ambos casos se documentan como límite;
 *   el segundo se mitiga comparando el destino canónico en cada reapertura.
 * - Los hardlinks de directorio no existen en NTFS; para ficheros la comprobación vive en la
 *   política de ingesta (`hardlink-refused`), no aquí.
 */

import { lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { RagError } from './errors.mjs';

/** Relaciones posibles entre dos claves canónicas. */
export const ROOT_RELATIONS = Object.freeze(['same', 'left-ancestor', 'left-descendant', 'disjoint']);

/** Normaliza una ruta a clave comparable: barras `/`, sin barra final y minúsculas en Windows. */
export function normalizeKey(path) {
  const slashes = String(path).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? slashes.toLowerCase() : slashes;
}

/**
 * Clave canónica de una ruta. Resuelve enlaces si la ruta existe; si no existe (por ejemplo un cwd
 * borrado), usa la ruta resuelta: la comparación sigue siendo determinista y no crea nada.
 */
export function canonicalKey(path) {
  const absolute = resolve(path);
  let real = absolute;
  try {
    real = realpathSync.native(absolute);
  } catch {
    real = absolute;
  }
  return normalizeKey(real);
}

/** Relación entre dos claves ya normalizadas. */
export function relationOf(leftKey, rightKey) {
  if (leftKey === rightKey) return 'same';
  if (rightKey.startsWith(`${leftKey}/`)) return 'left-ancestor';
  if (leftKey.startsWith(`${rightKey}/`)) return 'left-descendant';
  return 'disjoint';
}

/**
 * Inspecciona una ruta de raíz sin modificarla. Lanza `source-unreadable` si no existe o no se
 * puede leer; el resto de comprobaciones las decide `assertRootStructure`.
 */
export function inspectRoot(path) {
  if (typeof path !== 'string' || path.trim() === '' || !isAbsolute(path)) {
    throw new RagError('invalid-argument', 'la raíz debe ser una ruta absoluta');
  }
  const absolute = resolve(path);
  let link = null;
  try {
    link = lstatSync(absolute);
  } catch (error) {
    throw new RagError('source-unreadable', 'la raíz no existe o no se puede leer', {
      details: { path: absolute },
      cause: error,
    });
  }
  const isLink = link.isSymbolicLink();
  let linkTarget = null;
  if (isLink) {
    try {
      linkTarget = readlinkSync(absolute);
    } catch {
      linkTarget = null;
    }
  }
  let real;
  try {
    real = realpathSync.native(absolute);
  } catch (error) {
    throw new RagError('source-unreadable', 'la raíz no se puede resolver a una ruta real', {
      details: { path: absolute },
      cause: error,
    });
  }
  let stat;
  try {
    stat = statSync(real);
  } catch (error) {
    throw new RagError('source-unreadable', 'el destino de la raíz no se puede leer', {
      details: { path: real },
      cause: error,
    });
  }
  return {
    input: path,
    absolute,
    exists: true,
    isLink,
    linkTarget,
    linkKind: isLink ? classifyLink(link, linkTarget) : null,
    canonical: real,
    key: normalizeKey(real),
    identicalToCanonical: normalizeKey(absolute) === normalizeKey(real),
    isDirectory: stat.isDirectory(),
    hardlinkCount: stat.nlink,
  };
}

/**
 * Node no distingue una junction de un enlace de directorio (ambas se ven como `symbolicLink`).
 * Se declara explícitamente ese límite en vez de fingir una clasificación que la API no da.
 */
function classifyLink(link, target) {
  const permissions = link.mode & 0o777;
  if (process.platform !== 'win32') return 'symlink';
  // Un enlace de directorio creado con `symlink(...,'dir')` hereda 0o777; una junction no.
  return permissions === 0o777 ? 'dir-symlink' : 'junction-or-reparse';
}

/** Rechaza una raíz que no puede usarse como zona física inequívoca. */
export function assertRootStructure(info) {
  if (info.isLink) {
    throw new RagError('root-symlink', 'una raíz no puede ser un enlace, una junction ni un reparse point', {
      details: { path: info.absolute, linkKind: info.linkKind },
    });
  }
  if (!info.identicalToCanonical) {
    throw new RagError('root-symlink', 'la ruta de la raíz atraviesa un enlace o un reparse point', {
      details: { path: info.absolute, canonical: info.canonical },
    });
  }
  if (!info.isDirectory) {
    throw new RagError('invalid-argument', 'la raíz debe ser un directorio', { details: { path: info.absolute } });
  }
  return info;
}

/**
 * Decide si una raíz candidata puede registrarse junto a las existentes. Función pura: la usa el
 * registro y las pruebas sin tocar el sistema de ficheros.
 *
 * @param {{key: string, path?: string}} candidate
 * @param {Array<{id?: string, scope_kind?: string, scope_id?: string, path: string, path_key?: string}>} existing
 */
export function classifyRootRegistration(candidate, existing = [], { allowNested = false } = {}) {
  for (const root of existing) {
    const key = root.path_key ?? canonicalKey(root.path);
    const relation = relationOf(candidate.key, key);
    if (relation === 'same') {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'esa ruta ya está registrada en este perfil',
        conflict: { relation, root },
      };
    }
    if ((relation === 'left-ancestor' || relation === 'left-descendant') && !allowNested) {
      return {
        ok: false,
        code: 'root-overlap',
        message: 'la raíz se solapa con otra raíz ya autorizada; dos ámbitos no pueden reclamar la misma zona',
        conflict: { relation, root },
      };
    }
  }
  return { ok: true, conflict: null };
}

/** Lista de pares de raíces ya registradas que se solapan (diagnóstico de registros heredados). */
export function findRootConflicts(roots = []) {
  const conflicts = [];
  for (let index = 0; index < roots.length; index += 1) {
    for (let other = index + 1; other < roots.length; other += 1) {
      const left = roots[index];
      const right = roots[other];
      const relation = relationOf(left.path_key ?? canonicalKey(left.path), right.path_key ?? canonicalKey(right.path));
      if (relation !== 'disjoint') {
        conflicts.push({ left, right, relation });
      }
    }
  }
  return conflicts;
}

/**
 * Comprueba que el destino real de una raíz registrada sigue siendo el mismo. Si cambió, la raíz
 * deja de representar la zona que se autorizó: se falla en cerrado con `root-changed`.
 */
export function assertRootUnchanged(root) {
  let info;
  try {
    info = inspectRoot(root.path);
  } catch (error) {
    throw new RagError('root-changed', 'la raíz autorizada ya no se puede resolver', {
      details: { path: root.path, scopeId: root.scope_id },
      cause: error,
    });
  }
  const expected = root.path_key ?? canonicalKey(root.path);
  if (info.key !== expected) {
    throw new RagError('root-changed', 'el destino real de la raíz cambió desde que se autorizó', {
      details: { path: root.path, expected, found: info.canonical, scopeId: root.scope_id },
    });
  }
  return info;
}
