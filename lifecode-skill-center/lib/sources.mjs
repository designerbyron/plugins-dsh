/**
 * Barrido heredado de skills que ya existen fuera de la biblioteca del centro.
 *
 * **DEPRECADO (R16).** La detección de skills tiene UN solo modelo: `collectInventory` (§5.1), con sus
 * raíces (`skillRootsFor`), su ranking, sus layouts y su validación de frontmatter. Este módulo conserva
 * el export y la forma pública del barrido antiguo porque la acción `import` y pruebas existentes lo
 * usan, pero ya no define reglas propias: recorre exactamente las raíces y los layouts del inventario y
 * valida cada `SKILL.md` con `parseSkillFrontmatter`. No añadir usos nuevos.
 *
 * Sigue siendo el único sitio de esta ruta que toca el sistema de ficheros, y sólo lee.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { normalizeCwd } from './format.mjs';
import { parseSkillFrontmatter, skillRootsFor } from './inventory.mjs';
import { candidateFromSkillFile } from './skillfile.mjs';

/** Cuántos ficheros se aceptan: un barrido no puede ser una excusa para colgarse. */
const MAX_CANDIDATES = 600;

/** Etiquetas del contrato heredado para las raíces del inventario. */
const LEGACY_LABEL = {
  'project-dsh': 'proyecto actual',
  'project-agents': 'proyecto (agents)',
  'user-dsh': 'biblioteca de usuario',
  'user-agents': 'biblioteca de agentes',
  'skill-compiler': 'compilador anterior',
  materialized: 'vista materializada',
  custom: 'raíz personalizada',
  bundled: 'incluida con el Host',
};

const LEGACY_ORIGIN = {
  'project-dsh': 'project',
  'project-agents': 'project',
  'user-dsh': 'user-library',
  'user-agents': 'user-library',
  'skill-compiler': 'skill-compiler',
  materialized: 'lifecode-skill-center',
};

/** Raíces del modelo central, en la forma que publicaba este módulo (compatibilidad). */
function legacyRoots({ cwd = '', dshHome = '', agentsHome = '', materializedRoot = '' } = {}) {
  return skillRootsFor({ cwd, dshHome, agentsHome, materializedRoot }).map((root) => ({
    source: LEGACY_LABEL[root.source] ?? root.source,
    dir: root.dir,
    origin: LEGACY_ORIGIN[root.source] ?? root.source,
    rootId: root.rootId,
    layout: root.layout ?? null,
  }));
}

/** Las raíces que se miran, en orden de autoridad (contrato heredado de `skillRoots`). */
export function skillRoots({ cwd = '', dshHome = '' } = {}) {
  return legacyRoots({ cwd, dshHome }).map(({ source, dir, origin }) => ({ source, dir, origin }));
}

function readDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

function isDir(entry) {
  return entry.isDirectory() && !entry.isSymbolicLink();
}

function visitFile(path, root, push) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    push({ error: { path, message: String(error?.message ?? error) } });
    return;
  }
  // La validez la decide el modelo central: mismas reglas que el inventario.
  const parsed = parseSkillFrontmatter(text);
  if (parsed.error !== undefined) {
    push({ error: { path, message: 'sin cabecera utilizable' } });
    return;
  }
  const candidate = candidateFromSkillFile(text, { path, source: root.source });
  if (candidate === null) {
    push({ error: { path, message: 'sin cabecera utilizable' } });
    return;
  }
  push({ candidate: { ...candidate, origin: root.origin } });
}

/** Recorre una raíz con SU layout declarado (el mismo que usa `collectInventory`). */
function walkRoot(root, push) {
  const top = readDir(root.dir);
  if (top === null) return;
  const names = top.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (root.layout && root.layout.depth === 3) {
    const buckets = root.layout.buckets ?? { live: [], history: [] };
    const skipDirs = root.layout.skipDirs ?? [];
    for (const projectDir of names) {
      if (!isDir(projectDir)) continue;
      const projectPath = join(root.dir, projectDir.name);
      const projectList = readDir(projectPath);
      if (projectList === null) continue;
      for (const bucket of projectList.slice().sort((a, b) => a.name.localeCompare(b.name))) {
        if (!isDir(bucket)) continue;
        const bucketPath = join(projectPath, bucket.name);
        if (skipDirs.includes(bucket.name) || ![...buckets.live, ...buckets.history].includes(bucket.name)) continue;
        // El historial (`superseded`) no es contenido vivo: se cuenta en el inventario, no se importa.
        if (buckets.history.includes(bucket.name)) continue;
        const bucketList = readDir(bucketPath);
        if (bucketList === null) continue;
        for (const skillDir of bucketList.filter(isDir).sort((a, b) => a.name.localeCompare(b.name))) {
          visitFile(join(bucketPath, skillDir.name, 'SKILL.md'), root, push);
        }
      }
    }
    return;
  }
  if (root.layout && root.layout.depth === 2) {
    for (const projectDir of names) {
      if (!isDir(projectDir)) continue;
      const projectPath = join(root.dir, projectDir.name);
      const projectList = readDir(projectPath);
      if (projectList === null) continue;
      for (const skillDir of projectList.filter(isDir).sort((a, b) => a.name.localeCompare(b.name))) {
        visitFile(join(projectPath, skillDir.name, 'SKILL.md'), root, push);
      }
    }
    return;
  }
  // Layout plano (raíces que el Host escanea): `<dir>/<skill>/SKILL.md` o `<dir>/<skill>.md`.
  for (const entry of names) {
    if (!entry.name || entry.name === '.' || entry.name === '..') continue;
    if (entry.name === '.system') continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (readDir(join(root.dir, entry.name)) === null) continue;
      visitFile(join(root.dir, entry.name, 'SKILL.md'), root, push);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name.toLowerCase() !== 'skill.md') {
      visitFile(join(root.dir, entry.name), root, push);
    }
  }
}

/**
 * Recorre las raíces y devuelve los candidatos, sus raíces y lo que se rompió por el camino.
 *
 * **DEPRECADO (R16).** Delega raíces, layouts y validación en el modelo central del inventario; se
 * conserva el export y su contrato público (candidatos con `origin`, raíces con `source/dir/exists/found`,
 * errores tolerantes y `truncated`) porque lo usan la acción `import` y pruebas existentes. No añadir usos
 * nuevos: para detectar, usar `collectInventory` / `inventoryEvidence`.
 *
 * @param {{ cwd?: string, dshHome?: string, agentsHome?: string, materializedRoot?: string, limit?: number }} [options]
 * @returns {{ candidates: object[], roots: object[], errors: object[], truncated: boolean }}
 */
export function scanExternalSkills({
  cwd = '',
  dshHome = '',
  agentsHome = '',
  materializedRoot = '',
  limit = MAX_CANDIDATES,
} = {}) {
  const roots = [];
  const candidates = [];
  const errors = [];
  const seen = new Set();
  let truncated = false;

  const push = (item) => {
    if (item.error !== undefined) {
      errors.push(item.error);
      return;
    }
    if (candidates.length >= limit) {
      truncated = true;
      return;
    }
    const absolute = normalize(item.candidate.path);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    candidates.push({ ...item.candidate, path: absolute });
  };

  for (const root of legacyRoots({ cwd, dshHome, agentsHome, materializedRoot })) {
    if (candidates.length >= limit) {
      truncated = true;
      break;
    }
    const exists = existsSync(root.dir);
    const row = { source: root.source, dir: root.dir, exists, found: 0 };
    roots.push(row);
    if (!exists) continue;
    const before = candidates.length;
    walkRoot({ ...root, dir: normalizeCwd(root.dir) || root.dir }, push);
    row.found = candidates.length - before;
  }

  return { candidates, roots, errors, truncated };
}
