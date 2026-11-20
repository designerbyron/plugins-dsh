/**
 * Expansión de entradas del usuario a ficheros reales.
 *
 * Vive aparte de las herramientas porque la API del Workspace necesita exactamente las mismas
 * reglas (protección de productos, límites, omisión de árboles) y duplicarlas sería una segunda
 * política que puede divergir. Es puro: no escribe ni abre la base.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { RagError } from './errors.mjs';
import { PROTECTED_SEGMENTS, classifyPath } from './policy.mjs';

export const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.dsh', 'dist', 'build', 'coverage']);

/**
 * Recorre un directorio y acumula ficheros. No sigue enlaces simbólicos ni junctions, omite árboles
 * que no aportan conocimiento y **nunca** desciende a un producto protegido. El límite se comprueba
 * mientras se recorre, no después de llenar memoria.
 */
export function walkDirectory(directory, files, limit) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (cause) {
    throw new RagError('source-unreadable', 'no se puede leer el directorio', { cause, details: { path: directory } });
  }
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (entry.isSymbolicLink()) continue;
    const child = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(lower) || PROTECTED_SEGMENTS.includes(lower)) continue;
      walkDirectory(child, files, limit);
    } else if (entry.isFile()) {
      if (files.length >= limit) {
        throw new RagError('too-many-files', `la ingesta supera el máximo de ${limit} ficheros`, {
          details: { limit, path: directory },
        });
      }
      files.push(child);
    }
  }
}

/**
 * Expande rutas de entrada a una lista de ficheros reales. Una lista con cualquier ruta protegida
 * falla entera antes de escribir; los directorios se recorren con los límites de la configuración.
 */
export function expandInputs(requested, { cwd, roots, ragRootPath, limit }) {
  const files = [];
  for (const path of requested) {
    const item = classifyPath(path, { cwd, roots, ragRootPath, allowDirectory: true });
    if (item.directory) walkDirectory(item.realPath, files, limit);
    else files.push(item.realPath);
  }
  const unique = [...new Set(files)].sort();
  if (unique.length === 0) throw new RagError('invalid-argument', 'las rutas no contienen ningún fichero indexable');
  if (unique.length > limit) {
    throw new RagError('too-many-files', `la ingesta supera el máximo de ${limit} ficheros`, {
      details: { requested: unique.length },
    });
  }
  // La clasificación final vuelve a comprobar protección y enlaces duros sobre cada fichero real.
  return unique.map((path) => classifyPath(path, { cwd, roots, ragRootPath }));
}
