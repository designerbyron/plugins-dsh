/**
 * Arnés del Red Team del LifeCode Skill Center.
 *
 * Dos cosas, y sólo dos:
 *   1. Los ayudantes que usan las pruebas `tests/redteam-*.test.mjs` (almacenes temporales,
 *      lectura de bytes, siembra de hallazgos, ejecución de herramientas con la forma real de `exec`).
 *   2. El runner hermético: mide el sha256 del almacén REAL antes y después de la suite y falla si
 *      cambió. Las pruebas nunca reciben la raíz real: aquí sólo se fotografía.
 *
 * No toca el producto. Si se ejecuta directamente corre la suite; si se importa, sólo exporta.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runAction } from '../lib/api.mjs';
import { knowledgeFile, receiveInsight, withKnowledge } from '../lib/knowledge.mjs';

export const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const NOW = '2026-11-09T12:00:00.000Z';

/** Los dos ficheros del almacén real. Sólo se leen para el sha256: nunca se escriben. */
export function realStoreFiles(home = homedir()) {
  const base = join(home, '.dsh', 'lifecode-skill-center');
  return { center: join(base, 'center.json'), knowledge: join(base, 'knowledge.json') };
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Bytes del fichero, o `null` si no existe. Comparar Buffers es comparar bytes, no JSON. */
export function bytesOf(file) {
  return existsSync(file) ? readFileSync(file) : null;
}

export function shaOf(file) {
  const bytes = bytesOf(file);
  return bytes === null ? 'missing' : sha256(bytes);
}

/** Un almacén temporal aislado: centro, registro y un directorio de proyecto dentro de la caja. */
export function makeStore(label = 'lsc-rt') {
  const root = mkdtempSync(join(tmpdir(), `${label}-`));
  const projectPath = join(root, 'proyecto');
  const otherPath = join(root, 'otro-proyecto');
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(otherPath, { recursive: true });
  return {
    root,
    projectPath,
    otherPath,
    center: join(root, 'center.json'),
    ledger: knowledgeFile(root),
  };
}

/** La forma real de `exec` que `lib/tools.mjs` usa para resolver el ámbito de la sesión. */
export function execAt(cwd) {
  return { agent: { session: { header: { cwd } } } };
}

export function openProject(store, cwd = store.projectPath) {
  const opened = runAction({ root: store.root, action: 'open', cwd, now: NOW });
  return opened.project.id;
}

/** Siembra hallazgos por la puerta real del registro (no escribe JSON a mano). */
export function seedInsights(store, insights) {
  return withKnowledge(store.root, (document) => {
    for (const insight of insights) {
      receiveInsight(document, insight, NOW);
    }
  }, { now: NOW });
}

/** Dos hallazgos verificados de dos fuentes distintas: el mínimo que el motor llama «strong». */
export function seedStrong(store, extra = {}) {
  return seedInsights(store, [
    { insightId: 'rt-strong-a', sourceAgent: 'agente-a', title: 'medición A', evidence: [{ source: 'audit', location: 'src/a.mjs', verification: 'node --test', result: 'verde' }], ...extra },
    { insightId: 'rt-strong-b', sourceAgent: 'agente-b', title: 'medición B', evidence: [{ source: 'audit', location: 'src/b.mjs', verification: 'node --test', result: 'verde' }], ...extra },
  ]);
}

export function stateOf(store, cwd = store.projectPath) {
  return runAction({ root: store.root, action: 'state', actor: 'human', cwd, payload: {}, now: NOW });
}

/** Nombres de las herramientas que el modelo ve de verdad. */
export function toolNames() {
  return ['lifecode_skill_search', 'lifecode_skill_create', 'lifecode_skill_improve', 'lifecode_skill_status', 'lifecode_skill_insight'];
}

/** La suite del Red Team, con huella del almacén real antes y después. */
function main() {
  const real = realStoreFiles();
  const before = { center: shaOf(real.center), knowledge: shaOf(real.knowledge) };
  console.log(`[redteam] almacén real ANTES  center.json    ${before.center}`);
  console.log(`[redteam] almacén real ANTES  knowledge.json ${before.knowledge}`);

  const files = readdirSync(join(PLUGIN_ROOT, 'tests'))
    .filter((name) => /^redteam-.*\.test\.mjs$/.test(name))
    .sort()
    .map((name) => join('tests', name));
  if (files.length === 0) {
    console.error('[redteam] no hay pruebas redteam-*.test.mjs');
    process.exit(2);
  }
  const run = spawnSync(process.execPath, ['--test', ...files], { cwd: PLUGIN_ROOT, stdio: 'inherit' });

  const after = { center: shaOf(real.center), knowledge: shaOf(real.knowledge) };
  console.log(`[redteam] almacén real DESPUÉS center.json    ${after.center}`);
  console.log(`[redteam] almacén real DESPUÉS knowledge.json ${after.knowledge}`);
  const intact = before.center === after.center && before.knowledge === after.knowledge;
  console.log(intact
    ? '[redteam] el almacén real NO cambió: la suite es hermética'
    : '[redteam] ALMACÉN REAL MODIFICADO: la suite no es hermética');
  if (!intact) process.exit(3);
  process.exit(run.status ?? 1);
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
