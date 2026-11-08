/**
 * Materialización: que lo encendido en el centro se convierta en algo que el harness pueda cargar.
 *
 * El centro es la fuente de la verdad; este directorio es una **vista derivada** de disco, escrita
 * para un único consumidor: el proveedor de skills (y, a través de él, el agente). Por eso se puede
 * borrar entero y regenerar sin perder nada, y por eso no se lee nunca para decidir: se lee el
 * documento del centro.
 *
 * Reglas que este módulo cumple y que sus pruebas comprueban:
 * - Al sincronizar sólo se toca la carpeta del proyecto sincronizado. Otro proyecto no se entera.
 * - Una skill que deja de estar asignada se retira de esa carpeta; su contenido sigue en el centro.
 * - Se escribe sólo si el texto cambió: un refresco no debe ensuciar el disco ni el watcher.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { materializedRoot } from './state.mjs';
import { renderSkillFile } from './skillfile.mjs';

/** La carpeta de un proyecto dentro de la vista materializada. */
export function projectDirectory(root, projectId) {
  return join(materializedRoot(root), projectId);
}

/** La carpeta de una skill materializada. */
export function skillDirectory(root, projectId, skillId) {
  return join(projectDirectory(root, projectId), skillId);
}

function writeIfChanged(path, text) {
  try {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
  } catch {
    // si no se puede leer, se escribe: el objetivo es que el fichero correcto esté ahí
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return true;
}

/**
 * Sincroniza la vista de un proyecto con las asignaciones encendidas.
 *
 * @param {{ root: string, project: {id: string, cwd: string}, assignments: {skill: object, version: object}[], now?: string }} input
 * @returns {{ ok: boolean, directory: string, written: string[], removed: string[], unchanged: number }}
 */
export function syncProject({ root, project, assignments, now = new Date().toISOString() }) {
  const directory = projectDirectory(root, project.id);
  mkdirSync(directory, { recursive: true });
  const written = [];
  const removed = [];
  const wanted = new Set();
  let unchanged = 0;

  for (const { skill, version } of assignments) {
    wanted.add(skill.id);
    const folder = join(directory, skill.id);
    mkdirSync(folder, { recursive: true });
    const file = join(folder, 'SKILL.md');
    if (writeIfChanged(file, renderSkillFile({ skill, version }))) written.push(file);
    else unchanged += 1;

    const references = version.references ?? {};
    for (const [relative, content] of Object.entries(references)) {
      const target = join(folder, relative);
      if (writeIfChanged(target, String(content))) written.push(target);
    }
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (wanted.has(entry.name)) continue;
    rmSync(join(directory, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }

  const manifest = {
    projectId: project.id,
    cwd: project.cwd,
    generatedAt: now,
    skills: assignments.map(({ skill, version }) => ({ id: skill.id, version: version.version, title: skill.title })),
  };
  // El manifiesto se reescribe sólo cuando cambia lo que dice. `generatedAt` es la fecha del último
  // cambio real, no la del último refresco: si no, cada sincronización ensuciaría el disco (y el
  // vigilante del almacén) sin que nada haya cambiado.
  if (writeManifestIfChanged(join(directory, 'manifest.json'), manifest)) written.push(join(directory, 'manifest.json'));
  else unchanged += 1;

  return { ok: true, directory, written, removed, unchanged };
}

function writeManifestIfChanged(path, manifest) {
  const next = { ...manifest, skills: manifest.skills };
  try {
    const previous = JSON.parse(readFileSync(path, 'utf8'));
    if (JSON.stringify(previous.skills ?? null) === JSON.stringify(next.skills)) return false;
  } catch {
    // sin manifiesto legible, se escribe
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return true;
}

/**
 * Qué diría la vista materializada de un proyecto si se preguntara por él, sin escribir nada.
 *
 * Sirve para contestar «¿está el harness viendo lo que el centro dice?» sin sincronizar, y para que el
 * diagnóstico detecte una vista obsoleta.
 */
export function inspectProject({ root, projectId }) {
  const directory = projectDirectory(root, projectId);
  if (!existsSync(directory)) return { directory, exists: false, skills: [] };
  const skills = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(directory, entry.name, 'SKILL.md');
    if (!existsSync(manifestPath)) continue;
    skills.push({ id: entry.name, path: manifestPath });
  }
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  } catch {
    manifest = null;
  }
  return { directory, exists: true, skills, manifest };
}
