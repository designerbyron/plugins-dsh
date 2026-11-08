/**
 * Barrido de skills que ya existen fuera de la biblioteca del centro: la biblioteca de usuario del
 * harness, lo que el compilador anterior aprobó por proyecto, y lo que el propio repositorio declara
 * en `.dsh/skills/`.
 *
 * Es la mitad «disco» de la detección: tolerante a propósito. Que una ruta no exista no es un error
 * —significa que en esta máquina no hay nada ahí— y que un `SKILL.md` esté roto no puede tumbar el
 * barrido: se anota y se sigue.
 *
 * Este módulo es el único de la detección que toca el sistema de ficheros, y sólo lee.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { normalizeCwd } from './format.mjs';
import { candidateFromSkillFile } from './skillfile.mjs';

/** Cuánto se camina y cuántos ficheros se aceptan: un barrido no puede ser una excusa para colgarse. */
const MAX_DEPTH = 4;
const MAX_CANDIDATES = 600;
const SKIP = new Set(['node_modules', '.git', '.cache', 'dist', 'build', 'coverage', 'vendor']);

/** Las raíces que se miran, en orden de autoridad. */
export function skillRoots({ cwd = '', dshHome = '' } = {}) {
  const roots = [];
  if (dshHome !== '') {
    roots.push({ source: 'biblioteca de usuario', dir: join(dshHome, 'skills'), origin: 'user-library' });
    roots.push({ source: 'compilador anterior', dir: join(dshHome, 'skill-compiler', 'projects'), origin: 'skill-compiler' });
  }
  const normalized = normalizeCwd(cwd);
  if (normalized !== '') {
    roots.push({ source: 'proyecto actual', dir: join(normalized, '.dsh', 'skills'), origin: 'project' });
  }
  return roots;
}

function walk(dir, depth, visit) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    let directory = entry.isDirectory();
    if (!directory && entry.isSymbolicLink()) {
      try {
        directory = statSync(path).isDirectory();
      } catch {
        directory = false;
      }
    }
    if (directory) {
      if (SKIP.has(entry.name)) continue;
      if (depth < MAX_DEPTH) walk(path, depth + 1, visit);
      continue;
    }
    if (entry.name === 'SKILL.md') visit(path);
  }
}

/**
 * Recorre las raíces y devuelve los candidatos, sus raíces y lo que se rompió por el camino.
 *
 * @param {{ cwd?: string, dshHome?: string, limit?: number }} [options]
 * @returns {{ candidates: object[], roots: object[], errors: object[], truncated: boolean }}
 */
export function scanExternalSkills({ cwd = '', dshHome = '', limit = MAX_CANDIDATES } = {}) {
  const roots = [];
  const candidates = [];
  const errors = [];
  const seen = new Set();
  let truncated = false;

  for (const root of skillRoots({ cwd, dshHome })) {
    const exists = existsSync(root.dir);
    roots.push({ source: root.source, dir: root.dir, exists, found: 0 });
    if (!exists) continue;
    const before = candidates.length;
    walk(root.dir, 0, (path) => {
      if (candidates.length >= limit) {
        truncated = true;
        return;
      }
      const absolute = normalize(path);
      if (seen.has(absolute)) return;
      seen.add(absolute);
      try {
        const text = readFileSync(absolute, 'utf8');
        const candidate = candidateFromSkillFile(text, { path: absolute, source: root.source });
        if (candidate === null) {
          errors.push({ path: absolute, message: 'sin cabecera utilizable' });
          return;
        }
        candidates.push({ ...candidate, origin: root.origin });
      } catch (error) {
        errors.push({ path: absolute, message: String(error?.message ?? error) });
      }
    });
    roots.at(-1).found = candidates.length - before;
  }

  return { candidates, roots, errors, truncated };
}
