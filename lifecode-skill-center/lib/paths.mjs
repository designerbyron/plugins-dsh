/**
 * Rutas de la identidad de proyectos: contención y nombres.
 *
 * Dos procedimientos distintos, porque un archivo que aún no existe **no se puede** resolver con
 * `realpath` (el error sería `ENOENT` y no significa «fuera del directorio»):
 *
 * - **E · existente**: `realpath` del archivo + contención contra `realpath(.dsh/)` + tipo regular.
 * - **P · proyectado**: `realpath` del **padre** + contención + nombre validado contra la expresión
 *   estricta de su clase; después de crear se vuelve a resolver (un junction puede aparecer entre
 *   la comprobación y la publicación).
 *
 * Todo es puro salvo las llamadas al sistema de archivos, que se inyectan: así las pruebas cubren
 * los caminos imposibles de provocar en NTFS sin depender del equipo.
 */
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

/** Clases de archivo que la identidad publica en `.dsh/`. */
export const FILE_KINDS = {
  manifest: 'manifest',
  archived: 'archived',
  forkIntent: 'fork-intent',
  forkPublished: 'fork-published',
  repairIntent: 'repair-intent',
  repairPublished: 'repair-published',
  temp: 'temp',
  quarantineManifest: 'quarantine-manifest',
  quarantineIntent: 'quarantine-intent',
};

/**
 * Reglas de nombre. Son deliberadamente restrictivas: cualquier nombre que no encaje se rechaza en
 * vez de «arreglarse», porque un nombre construido con datos del disco (un `cwd` con espacios, un
 * nombre con `..`) es la vía por la que una ruta se sale del directorio autorizado.
 */
export const BASENAME_PATTERNS = {
  [FILE_KINDS.manifest]: /^lifecode-skill-center\.json$/,
  [FILE_KINDS.archived]: /^lifecode-skill-center\.manifest-\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/,
  [FILE_KINDS.forkIntent]: /^lifecode-skill-center\.fork-intent\.json$/,
  [FILE_KINDS.forkPublished]: /^lifecode-skill-center\.fork-published\.json$/,
  [FILE_KINDS.repairIntent]: /^lifecode-skill-center\.repair-intent\.json$/,
  [FILE_KINDS.repairPublished]: /^lifecode-skill-center\.repair-published\.json$/,
  [FILE_KINDS.temp]: /^\.lifecode-tmp-[a-z0-9-]{8,64}-\d{1,3}$/,
  [FILE_KINDS.quarantineManifest]: /^lifecode-skill-center\.manifest-invalid-\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/,
  [FILE_KINDS.quarantineIntent]: /^lifecode-skill-center\.fork-intent-invalid-\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/,
};

/** Nombres reservados de Windows: un fichero así no se puede crear y denunciaría una ruta construida. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Códigos de rechazo, para que la UI no tenga que interpretar el texto. */
export const PATH_CODES = {
  badKind: 'path-unknown-kind',
  badName: 'path-invalid-name',
  traversal: 'path-traversal',
  reserved: 'path-reserved-name',
  outside: 'path-outside-workspace',
  notDirectory: 'path-not-directory',
  notFile: 'path-not-file',
  symlink: 'path-symlink',
  missing: 'path-missing',
  unreadable: 'path-unreadable',
  escapedAfterPublish: 'path-escaped-after-publish',
};

/** Error de ruta: `only`/`code` viajan hasta la API y hasta la UI. */
function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

/**
 * Nombre válido para su clase. Rechaza separadores, traversal, segmentos especiales, caracteres de
 * control, espacio o punto final, y nombres reservados del sistema.
 */
export function basenameProblem(name, kind) {
  const pattern = BASENAME_PATTERNS[kind];
  if (pattern === undefined) return { ok: false, code: PATH_CODES.badKind };
  if (typeof name !== 'string' || name === '') return { ok: false, code: PATH_CODES.badName };
  if (name !== basename(name)) return { ok: false, code: PATH_CODES.traversal };
  if (name.includes('/') || name.includes('\\') || name.includes(':')) return { ok: false, code: PATH_CODES.traversal };
  if (name === '.' || name === '..' || name.includes('..')) return { ok: false, code: PATH_CODES.traversal };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) return { ok: false, code: PATH_CODES.badName };
  if (/[. ]$/.test(name) && !pattern.test(name)) return { ok: false, code: PATH_CODES.badName };
  if (name.length > 200) return { ok: false, code: PATH_CODES.badName };
  if (RESERVED_NAMES.test(name)) return { ok: false, code: PATH_CODES.reserved };
  if (!pattern.test(name)) return { ok: false, code: PATH_CODES.badName };
  return { ok: true };
}

function normalizeForCompare(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

/**
 * ¿`child` está dentro de `parent`? Compara por **frontera de separador**, no por prefijo de cadena:
 * `…\.dsh-otro` empieza por `…\.dsh` y aun así no es hijo.
 */
export function isInside(parent, child) {
  if (typeof parent !== 'string' || typeof child !== 'string' || parent === '' || child === '') return false;
  const left = normalizeForCompare(parent.replace(/[\\/]+$/, ''));
  const right = normalizeForCompare(child.replace(/[\\/]+$/, ''));
  if (left === right) return true;
  // `sep` es `\` en Windows y `/` en POSIX; se aceptan los dos porque una ruta puede llegar con `/`.
  if (![left + sep, left + '/'].some((prefix) => right.startsWith(prefix))) return false;
  const rest = relative(left, right);
  return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest);
}

const defaultFs = { lstatSync, realpathSync, statSync };

/**
 * **E · archivo existente**. Devuelve la ruta real, comprueba que es hija del centro y que es un
 * fichero regular (no symlink, no junction, no directorio). La llamada debe repetirse justo antes de
 * retirar o publicar: entre el preflight y el uso hay una ventana real.
 */
export function checkExistingFile({ path, dshRoot, kind = FILE_KINDS.manifest, fs = defaultFs } = {}) {
  if (typeof path !== 'string' || path === '') return fail(PATH_CODES.missing, 'no se indicó ninguna ruta');
  const name = basename(path);
  const problem = basenameProblem(name, kind);
  if (!problem.ok) return fail(problem.code, `el nombre "${name}" no es válido para ${kind}`);

  let rootReal;
  try {
    rootReal = fs.realpathSync(dshRoot);
  } catch (error) {
    return fail(PATH_CODES.unreadable, `no se pudo resolver el directorio del centro: ${error.code ?? error.message}`);
  }

  let real;
  try {
    real = fs.realpathSync(path);
  } catch (error) {
    return fail(
      error.code === 'ENOENT' ? PATH_CODES.missing : PATH_CODES.unreadable,
      `no se pudo resolver "${path}": ${error.code ?? error.message}`,
    );
  }
  if (!isInside(rootReal, real)) return fail(PATH_CODES.outside, 'la ruta resuelta queda fuera del centro');

  let stats;
  try {
    stats = fs.lstatSync(real, { bigint: true });
  } catch (error) {
    return fail(PATH_CODES.unreadable, `no se pudo inspeccionar "${real}": ${error.code ?? error.message}`);
  }
  if (stats.isSymbolicLink?.() === true) return fail(PATH_CODES.symlink, 'la ruta es un enlace simbólico');
  if (stats.isDirectory?.() === true) return fail(PATH_CODES.notFile, 'la ruta es un directorio');

  return {
    ok: true,
    path,
    real,
    root: rootReal,
    dev: typeof stats.dev === 'bigint' ? stats.dev : BigInt(stats.dev ?? 0),
    ino: typeof stats.ino === 'bigint' ? stats.ino : BigInt(stats.ino ?? 0),
    nlink: typeof stats.nlink === 'bigint' ? stats.nlink : BigInt(stats.nlink ?? 1),
    size: typeof stats.size === 'bigint' ? stats.size : BigInt(stats.size ?? 0),
    stats,
  };
}

/**
 * **P · archivo proyectado (todavía inexistente)**: resuelve y contiene el **padre**, valida el
 * nombre y devuelve la ruta de publicación. No crea nada y no toca el disco.
 */
export function checkProjectedFile({ dir, name, dshRoot, kind, fs = defaultFs } = {}) {
  if (typeof dir !== 'string' || dir === '') return fail(PATH_CODES.unreadable, 'no se indicó el directorio');
  const problem = basenameProblem(name, kind);
  if (!problem.ok) return fail(problem.code, `el nombre "${name}" no es válido para ${kind}`);

  let rootReal;
  let dirReal;
  try {
    rootReal = fs.realpathSync(dshRoot);
  } catch (error) {
    return fail(PATH_CODES.unreadable, `no se pudo resolver la raíz del centro: ${error.code ?? error.message}`);
  }
  try {
    dirReal = fs.realpathSync(dir);
  } catch (error) {
    // Un directorio que no existe no es «ilegible»: es un ENOENT **esperado** cuando el workspace aún no
    // tiene su `.dsh/`. Distinguirlo importa: ilegible detiene el inventario, ausente se puede crear por su
    // dueño (DSH) y no se inventa nada desde aquí.
    if (error.code === 'ENOENT') return fail(PATH_CODES.missing, 'el directorio de publicación no existe');
    return fail(PATH_CODES.unreadable, `no se pudo resolver el directorio: ${error.code ?? error.message}`);
  }
  if (!isInside(rootReal, dirReal)) return fail(PATH_CODES.outside, 'el directorio de publicación queda fuera del centro');

  let stats;
  try {
    stats = fs.lstatSync(dirReal);
  } catch (error) {
    return fail(PATH_CODES.unreadable, `no se pudo inspeccionar el directorio: ${error.code ?? error.message}`);
  }
  if (stats.isDirectory() !== true) return fail(PATH_CODES.notDirectory, 'el destino de publicación no es un directorio');

  const path = join(dirReal, name);
  if (!isInside(rootReal, path)) return fail(PATH_CODES.outside, 'la ruta de publicación queda fuera del centro');
  return { ok: true, path, dir: dirReal, root: rootReal, name };
}

/**
 * Después de publicar: el archivo ya existe, así que se vuelve a resolver. Un junction creado entre
 * la comprobación y el `link` haría que los bytes aterrizaran fuera del centro; esto lo detecta.
 */
export function checkPublishedFile({ path, dshRoot, kind = FILE_KINDS.manifest, fs = defaultFs } = {}) {
  const checked = checkExistingFile({ path, dshRoot, kind, fs });
  if (checked.ok !== true) {
    return fail(PATH_CODES.escapedAfterPublish, `la publicación no quedó donde debía: ${checked.message}`, {
      cause: checked.code,
    });
  }
  return checked;
}

/** Directorio de la ruta indicada (el `.dsh/` del workspace, o su subcarpeta de generaciones). */
export function parentOf(path) {
  return typeof path === 'string' && path !== '' ? dirname(path) : '';
}
