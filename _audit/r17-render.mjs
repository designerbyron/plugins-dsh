// Renders de R17. NO es el GUI vivo: es el panel montado con el runtime `node:vm` de las pruebas
// y serializado a HTML estático, con la CSS real del cliente. Los fixtures son sintéticos.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPanelHarness, activityEvent, textOf } from '../lifecode-skill-center/tests/r17-ui-runtime.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const captureDir = path.join(here, 'r16-capture');
const cssSource = fs.readFileSync(path.join(here, '..', 'lifecode-skill-center', 'client.js'), 'utf8');
const cssMatch = cssSource.match(/const CSS = `([\s\S]*?)`;\n/);
if (!cssMatch) throw new Error('no se encontró la CSS del cliente');
const css = cssMatch[1];

const VOID = new Set(['input', 'br', 'hr', 'img', 'meta', 'link']);

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attr(name, value) {
  if (value === undefined || value === null || value === false) return '';
  if (name === 'children' || typeof value === 'function') return '';
  if (name === 'style' && typeof value === 'object') {
    const cssText = Object.entries(value).map(([key, item]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${item}`).join(';');
    return ` style="${esc(cssText)}"`;
  }
  const mapped = name === 'className' ? 'class' : name === 'htmlFor' ? 'for' : name;
  if (value === true) return ` ${mapped}`;
  if (mapped === 'value' || mapped === 'checked' || mapped === 'selected') return '';
  return ` ${mapped}="${esc(value)}"`;
}

function serialize(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return esc(node);
  if (Array.isArray(node)) return node.map(serialize).join('');
  const tag = typeof node.type === 'string' ? node.type : 'div';
  const props = node.props ?? {};
  const attrs = Object.entries(props).map(([name, value]) => attr(name, value)).join('');
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  const children = serialize(props.children ?? null);
  return `<${tag}${attrs}>${children}</${tag}>`;
}

function page(inner) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#0b1020;}
  .lsc-root{min-height:100vh;}
  ${css}
  .lsc-toast-card{animation:none !important;}
  </style></head><body>${inner}</body></html>`;
}

const EVENT_DONE = activityEvent({
  eventId: 'evt-done',
  at: new Date().toISOString(),
  titleKey: 'activity.title.skill-version-saved',
  titleVars: { skill: 'Revisar un plugin de DSH antes de instalarlo', version: '1.2.0' },
  versionBefore: '1.0.0',
  versionAfter: '1.2.0',
  correlationId: 'corr-render',
  referencesAdded: ['references/contratos.md'],
});
const EVENT_INFO = activityEvent({
  eventId: 'evt-info',
  type: 'improvement-prepared',
  category: 'improvement',
  severity: 'info',
  titleKey: 'activity.title.improvement-prepared',
  titleVars: { skill: 'Revisar un plugin de DSH antes de instalarlo' },
  at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
});

async function render(options, steps) {
  const harness = createPanelHarness(options);
  await harness.mount();
  await steps(harness);
  return page(serialize(harness.tree()));
}

const legacyToast = `<div class="lsc-toast-wrap"><div class="lsc-toast ok">Skill «Revisar un plugin de DSH» publicada</div></div>`;

const captures = [
  {
    name: 'r17-before-toast',
    window: '1440,1000',
    build: async () => (await render({}, async () => {})) + legacyToast,
    note: 'estado anterior: un único toast al pie, sin pila',
  },
  {
    name: 'r17-after-toast',
    window: '1440,1000',
    build: async () => render({ events: [EVENT_DONE, EVENT_INFO] }, async (harness) => {
      harness.testProbe.toastFromActivity(EVENT_DONE, false);
      harness.testProbe.notify('Copia con otro id creada', 'ok', { detail: 'skill-demo-copia' });
      await harness.settle();
    }),
  },
  {
    name: 'r17-after-drawer',
    window: '1440,1000',
    build: async () => render({ events: [EVENT_DONE, EVENT_INFO] }, async (harness) => {
      const button = harness.nodes((node) => node.type === 'button' && String(node.props.title ?? '') === 'Ver la actividad del centro')[0];
      await harness.click(button);
    }),
  },
  {
    name: 'r17-after-indicator',
    window: '1440,1000',
    build: async () => render({ events: [EVENT_DONE] }, async (harness) => {
      harness.testProbe.setLastActivity(new Date(Date.now() - 2 * 60 * 1000).toISOString());
      await harness.settle();
    }),
  },
];

const edgeCandidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function edgeBinary() {
  for (const candidate of edgeCandidates) if (fs.existsSync(candidate)) return candidate;
  throw new Error('no se encontró Microsoft Edge');
}

const results = [];
for (const capture of captures) {
  const html = await capture.build();
  const htmlFile = path.join(captureDir, `${capture.name}.html`);
  fs.writeFileSync(htmlFile, html, 'utf8');
  const pngFile = path.join(here, `${capture.name}.png`);
  const [width, height] = capture.window.split(',');
  execFileSync(edgeBinary(), [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    `--user-data-dir=${path.join(os.tmpdir(), 'lsc-r17-edge-profile')}`,
    `--window-size=${width},${height}`,
    `--screenshot=${pngFile}`,
    `file:///${htmlFile.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });
  results.push({ name: capture.name, png: pngFile, bytes: fs.statSync(pngFile).size, html: htmlFile });
}

for (const result of results) {
  console.log(`PNG ${path.basename(result.png)} · ${result.bytes} B`);
}
console.log(`HTML en ${path.relative(here, captureDir)} · CSS ${css.length} B`);
