/**
 * Medición de las rutas que se refrescan solas (directiva §12).
 *
 * No es una prueba con umbral: en esta máquina los tiempos varían con la carga. Lo que este script garantiza es
 * que la medición se puede repetir y que las cifras del informe salen de un almacén **temporal** con una carga
 * declarada, no de una impresión.
 *
 * Uso: node tools/perf.mjs [--skills 200] [--events 4000]
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { buildSnapshot, handleApiRequest } from '../lib/api.mjs';
import { buildInsights } from '../lib/insights.mjs';
import { createSkill, toggleAssignment, publishVersion } from '../lib/operations.mjs';
import { emptyState, loadState, saveState } from '../lib/state.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined ? Number(argv[index + 1]) : fallback;
};
const SKILLS = option('skills', 200);
const EVENTS = option('events', 4000);
const NOW = '2026-01-01T00:00:00.000Z';

const BODY = [
  '# Procedimiento',
  '',
  'Uno: lee el manifiesto y el perfil antes de instalar nada, y anota la versión exacta con la que trabajas.',
  '',
  '## Evidencia',
  '',
  'Dos: deja el resultado de las pruebas y la ruta tocada, con la huella del almacén antes y después de la',
  'operación, y escribe lo que no se pudo verificar en vez de dar por bueno lo que no se midió.',
].join('\n');

function seed() {
  const state = emptyState();
  const root = mkdtempSync(join(tmpdir(), 'lsc-perf-'));
  const cwd = 'C:/xampp/htdocs/proyecto-de-carga';
  const project = { id: 'proyecto-de-carga', name: 'proyecto-de-carga', cwd, createdAt: NOW, updatedAt: NOW, note: '' };
  state.projects[project.id] = project;

  for (let index = 0; index < SKILLS; index += 1) {
    const created = createSkill(state, {
      id: `skill-de-carga-${index}`,
      title: `Skill de carga ${index}`,
      description: `Skill sintética ${index} para medir el coste de las rutas que se refrescan cada pocos segundos`,
      whenToUse: 'Cuando haya que medir la foto del panel y los indicadores con una biblioteca grande',
      tags: ['carga', `bloque-${index % 10}`],
      body: BODY,
    }, { now: NOW });
    if (created.ok !== true) throw new Error(`no se pudo sembrar la skill ${index}: ${created.message}`);
    if (index % 5 === 0) {
      publishVersion(state, created.id, { description: `Skill sintética ${index} con una segunda versión publicada`, body: `${BODY}\n\n## Cuándo no usarla\n\nCuando la medición sea la excusa.` }, { now: NOW, authorized: true });
    }
    if (index % 3 === 0) toggleAssignment(state, { projectId: project.id, skillId: created.id, enabled: true }, { now: NOW });
  }

  // Eventos de entrega: el caso real de un diario que crece.
  state.events = [];
  for (let index = 0; index < EVENTS; index += 1) {
    state.events.push({
      at: new Date(Date.parse(NOW) + index * 60000).toISOString(),
      type: index % 7 === 0 ? 'skill.loaded' : index % 5 === 0 ? 'skill.assigned' : 'skill.created',
      actor: index % 11 === 0 ? 'ai' : 'human',
      skillId: `skill-de-carga-${index % SKILLS}`,
      projectId: project.id,
      note: `evento sintético ${index}`,
    });
  }

  saveState(root, state, { now: NOW });
  return { root, cwd };
}

function median(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function measure(label, fn, runs = 5) {
  for (let index = 0; index < 2; index += 1) fn(); // calentar
  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  return { label, median: median(samples), max: Math.max(...samples) };
}

const { root, cwd } = seed();
const rawState = loadState(root).state;

const rows = [];
rows.push(measure('foto del panel (buildSnapshot)', () => buildSnapshot({ root, cwd, now: NOW })));
rows.push(measure('ruta /api/state (handleApiRequest)', () => handleApiRequest({ root, method: 'GET', pathname: '/lifecode-skill-center/api/state', search: `?cwd=${encodeURIComponent(cwd)}`, now: NOW })));
rows.push(measure('indicadores (buildInsights, sin releer el almacén)', () => buildInsights(rawState, { now: NOW, filters: {} })));

const total = rows.length;
process.stdout.write(`\nCarga: ${SKILLS} skills, ${EVENTS} eventos, 1 proyecto · almacén temporal\n\n`);
process.stdout.write('| Ruta | mediana | peor |\n|---|---|---|\n');
for (const row of rows) {
  process.stdout.write(`| ${row.label} | ${row.median.toFixed(1)} ms | ${row.max.toFixed(1)} ms |\n`);
}

const report = [
  '# Rendimiento y seguridad de las rutas que se refrescan solas',
  '',
  `Medido con \`node tools/perf.mjs --skills ${SKILLS} --events ${EVENTS}\` sobre un almacén **temporal**`,
  `(${SKILLS} skills, ${EVENTS} eventos, 1 proyecto con asignaciones y versiones extra).`,
  '',
  '| Ruta | mediana | peor |',
  '|---|---|---|',
  ...rows.map((row) => `| ${row.label} | ${row.median.toFixed(1)} ms | ${row.max.toFixed(1)} ms |`),
  '',
  'Lo que estas cifras dicen y lo que no:',
  '',
  '- Dicen cuánto cuesta **leer** con esa carga en esta máquina, con la caché de disco caliente.',
  '- No son un umbral: no hay presupuesto prometido ni prueba que falle por lentitud. Si mañana la foto tarda',
  '  el doble, esta tabla no lo impide; lo que sí lo impide es el contrato de la §7 (una lectura del registro por',
  '  petición) y la prueba de que `/api/state` no toca el registro del Host ni el almacén de conocimiento.',
  '- No miden el panel: el panel pinta lo que esta foto devuelve.',
  '',
  '## Seguridad de la distribución',
  '',
  'El id de una skill viaja desde fuera y se usaba para nombrar el fichero del paquete. Se cerró:',
  '',
  '- `bundlePath` valida forma (`/^[a-z0-9][a-z0-9-]{0,63}$/` para el id, `/^\\d+\\.\\d+\\.\\d+$/` para la versión)',
  '  y devuelve `null` si no cuadra; `writeBundle` responde `unsafe-bundle-name` **antes** de crear la carpeta.',
  '  Lo mide `tests/distribute-security.test.mjs`, incluido que `exports/` no llegue a existir.',
  '- `readBundle` no parsea más de `MAX_BUNDLE_BYTES` (512 KB) y devuelve `bundle-too-large`.',
  '',
  `Almacén real intacto: la medición y estas pruebas corren sobre \`${root}\`, que se borra al terminar.`,
].join('\n');

writeFileSync('C:/xampp/htdocs/plugins-dhs/_audit/RENDIMIENTO.md', `${report}\n`);
process.stdout.write(`\nInforme: C:/xampp/htdocs/plugins-dhs/_audit/RENDIMIENTO.md\n`);
rmSync(root, { recursive: true, force: true });
