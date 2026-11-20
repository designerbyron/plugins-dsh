/**
 * Capturas reales del Workspace de demostración con Edge headless.
 *
 * No simula la interfaz: abre la página real, deja que consulte la API y guarda el PNG. Verifica
 * dimensiones y tamaño mínimo para que una captura en blanco no pase como evidencia.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const OUT = join(REPO, 'eval', 'm5', 'capturas');
const EDGE = process.env.LCR_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.LCR_DEMO_URL || 'http://127.0.0.1:7333';

const SHOTS = [
  ['resumen', '/#/resumen'],
  ['fuentes', '/#/fuentes'],
  ['buscar', `/?q=${encodeURIComponent('recuperación híbrida y fusión RRF')}#/buscar`],
  ['contexto', `/?q=${encodeURIComponent('cómo se protege el almacén y las rutas')}#/contexto`],
  ['metricas', '/#/metricas'],
  ['configuracion', '/#/configuracion'],
  ['salud', '/#/salud'],
  ['error', '/#/fuentes/src_inexistente'],
];

function pngSize(path) {
  const buffer = readFileSync(path);
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return { width: 0, height: 0 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

if (!existsSync(EDGE)) {
  console.error(`no se encontró Edge en ${EDGE}; define LCR_EDGE`);
  process.exit(2);
}
if (!existsSync(join(REPO, 'lifecode-rag', 'demo', 'server.mjs'))) {
  console.error('falta demo/server.mjs');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [name, route] of SHOTS) {
  const target = join(OUT, `${name}.png`);
  const started = Date.now();
  execFileSync(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1280,920',
    '--virtual-time-budget=6000',
    `--screenshot=${target}`,
    `${BASE}${route}`,
  ], { stdio: 'ignore', timeout: 60_000 });
  const size = pngSize(target);
  const bytes = statSync(target).size;
  const ok = size.width === 1280 && size.height === 920 && bytes > 20_000;
  rows.push({ name, route, width: size.width, height: size.height, bytes, ok, ms: Date.now() - started });
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(14)} ${size.width}x${size.height} ${String(bytes).padStart(7)} B ${route}`);
}

const failed = rows.filter((row) => !row.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} capturas válidas en ${OUT}`);
if (failed.length > 0) process.exit(1);
