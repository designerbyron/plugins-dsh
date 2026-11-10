/**
 * R17-A — presupuesto de rendimiento medido, comparable con `_audit/r17-perf-baseline.json`.
 *
 * Uso: `node tools/r17-perf.mjs` (desde cualquier cwd). No escribe en el almacén real: sólo lee el
 * `center.json` real para tamaño de payload y mide el panel en el runtime de pruebas (`node:vm`).
 * Salida: `_audit/r17-perf-after.json`; exit code = nº de comprobaciones fallidas.
 */

import { readFileSync, statSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PLUGIN = resolve(HERE, '..');
const REPO = resolve(PLUGIN, '..');
const AUDIT = join(REPO, '_audit');

const { createPanelHarness, activityEvent } = await import(new URL('../tests/r17-ui-runtime.mjs', import.meta.url).href);

const client = readFileSync(join(PLUGIN, 'client.js'), 'utf8');
const index = readFileSync(join(PLUGIN, 'index.js'), 'utf8');
const api = readFileSync(join(PLUGIN, 'lib/api.mjs'), 'utf8');
const libs = readdirSync(join(PLUGIN, 'lib')).filter((name) => name.endsWith('.mjs'));
const count = (source, pattern) => (source.match(pattern) ?? []).length;
const bytes = (path) => statSync(path).size;

let baseline = null;
try { baseline = JSON.parse(readFileSync(join(AUDIT, 'r17-perf-baseline.json'), 'utf8')); } catch { baseline = null; }

// Almacén real: sólo lectura, para tamaño de payload (no se escribe ni se copia).
let store = { events: 0, skills: 0, projects: 0, eventsBytes: 0, last80SnapshotBytes: 0, readError: null };
try {
  const raw = readFileSync(join(process.env.USERPROFILE, '.dsh', 'lifecode-skill-center', 'center.json'), 'utf8');
  const parsed = JSON.parse(raw);
  store = {
    events: (parsed.events ?? []).length,
    skills: Object.keys(parsed.skills ?? {}).length,
    projects: Object.keys(parsed.projects ?? {}).length,
    eventsBytes: Buffer.byteLength(JSON.stringify(parsed.events ?? []), 'utf8'),
    last80SnapshotBytes: Buffer.byteLength(JSON.stringify((parsed.events ?? []).slice(-80).reverse()), 'utf8'),
    readError: null,
  };
} catch (error) {
  store.readError = error.message;
}

// Panel real en node:vm: cuenta peticiones de actividad por fase.
async function measurePanel() {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  await harness.settle(30);
  const startup = harness.calls.filter((call) => call.url.includes('/api/activity')).length;
  await harness.settle(21_000);
  const idle = harness.calls.filter((call) => call.url.includes('/api/activity')).length;
  const buttonOf = () => harness.nodes((node) => node.type === 'button' && String(node.props.title ?? '') === 'Ver la actividad del centro')[0];
  await harness.click(buttonOf());
  const open = harness.calls.filter((call) => call.url.includes('/api/activity')).length;
  await harness.key('Escape');
  const closed = harness.calls.filter((call) => call.url.includes('/api/activity')).length;
  for (let index = 0; index < 20; index += 1) {
    await harness.click(buttonOf());
    await harness.key('Escape');
  }
  const cycles = harness.calls.filter((call) => call.url.includes('/api/activity')).length;
  // El arnés de UI no expone `style.remove`; se mide sin desmontar (el sandbox no crea intervalos).
  return {
    startupRequests: startup,
    idleRequests: idle,
    openRequests: open,
    closedRequests: closed,
    cyclesRequests: cycles,
    longTimers: harness.timers.filter((timer) => timer.ms >= 20_000).length,
  };
}

const runtime = await measurePanel();
const after = {
  measuredAt: new Date().toISOString(),
  stage: 'after-r17',
  files: {
    clientBytes: bytes(join(PLUGIN, 'client.js')),
    indexBytes: bytes(join(PLUGIN, 'index.js')),
    apiBytes: bytes(join(PLUGIN, 'lib/api.mjs')),
    libFiles: libs.length,
    libBytes: libs.reduce((total, name) => total + bytes(join(PLUGIN, 'lib', name)), 0),
  },
  codeCounts: {
    clientFetch: count(client, /fetch\(/g),
    clientSetInterval: count(client, /setInterval\(/g),
    clientSetTimeout: count(client, /setTimeout\(/g),
    clientRaf: count(client, /requestAnimationFrame\(/g),
    indexSetInterval: count(index, /setInterval\(/g),
    apiSetInterval: count(api, /setInterval\(/g),
    clientNotifyCallers: count(client, /\bnotify\(/g),
    clientActivityUI: count(client, /activity/gi),
  },
  runtime,
  store,
  checks: [],
};

function check(name, condition, detail) {
  after.checks.push({ name, pass: condition === true, detail: String(detail ?? '') });
}

check('arranque sin peticiones de actividad', runtime.startupRequests === 0, runtime.startupRequests);
check('inactividad sin peticiones', runtime.idleRequests === 0, runtime.idleRequests);
check('abrir el drawer ⇒ exactamente 1 consulta', runtime.openRequests === 1, runtime.openRequests);
check('cerrado no consulta', runtime.closedRequests === 1, runtime.closedRequests);
check('20 aperturas/cierres no multiplican consultas (feed vigente)', runtime.cyclesRequests === 1, runtime.cyclesRequests);
check('sin temporizadores de 20 s', runtime.longTimers === 0, runtime.longTimers);
check('un único setInterval (refresco preexistente)', after.codeCounts.clientSetInterval === 1, after.codeCounts.clientSetInterval);
check('sin requestAnimationFrame nuevo', after.codeCounts.clientRaf === 0, after.codeCounts.clientRaf);
check('sin setInterval en backend', after.codeCounts.indexSetInterval === 0 && after.codeCounts.apiSetInterval === 0, `${after.codeCounts.indexSetInterval}/${after.codeCounts.apiSetInterval}`);
if (baseline !== null) {
  const before = baseline.files ?? {};
  after.baseline = { file: '_audit/r17-perf-baseline.json', clientBytes: before.clientBytes, measuredAt: baseline.measuredAt };
  // Presupuesto por tramos, no un número movido a la ligera. Cada tramo tiene su medición y su motivo:
  //   · R17    → 60 KiB (Activity Center + pila de toasts del panel).
  //   · R17.1  → +8 KiB (claves por tipo de evento + estados de conexión del cajón; +64 034 B acumulados).
  //   · T42    → +16 KiB (overlay global `shell.overlay`, store único de toasts, puente de sesión y su
  //              probe; medido 519 032 → 532 605 B = +13 573 B = 13,3 KiB, dentro del tramo con 2,7 KiB
  //              de margen). El gate relativo (<20 %) sigue intacto y los 10 checks de runtime —cero
  //              consultas en arranque/inactividad, cero timers nuevos, un solo setInterval
  //              preexistente— son la garantía principal; el tamaño sólo acota el bundle.
  // Agotado este tramo, cualquier crecimiento nuevo exige aprobación explícita y su propia medición.
  const budgetBytes = 84 * 1024;
  check('client.js crece menos de 84 KB (R17 + R17.1 + T42)', after.files.clientBytes - before.clientBytes < budgetBytes, `${before.clientBytes} → ${after.files.clientBytes}`);
  check('client.js crece menos del 20 %', after.files.clientBytes < before.clientBytes * 1.2, `${before.clientBytes} → ${after.files.clientBytes}`);
} else {
  check('baseline disponible', false, 'no se pudo leer _audit/r17-perf-baseline.json');
}

writeFileSync(join(AUDIT, 'r17-perf-after.json'), `${JSON.stringify(after, null, 2)}\n`, 'utf8');
const failed = after.checks.filter((item) => item.pass !== true);
for (const item of after.checks) console.log(`${item.pass === true ? 'PASS' : 'FAIL'}  ${item.name}  (${item.detail})`);
console.log(`\nR17-A: ${after.checks.length - failed.length}/${after.checks.length} PASS · escritura _audit/r17-perf-after.json`);
process.exitCode = failed.length === 0 ? 0 : 1;
