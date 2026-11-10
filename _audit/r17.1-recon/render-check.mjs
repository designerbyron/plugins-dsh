#!/usr/bin/env node
// R17.1 — evidencia del panel simulado (mismo runtime de pruebas que la suite, sin navegador):
// los dos eventos históricos reales se pintan por su TIPO y el cajón declara el centro disponible.
//
// Uso: node _audit/r17.1-recon/render-check.mjs [--out <ruta.json>]
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..', '..', 'lifecode-skill-center');
const runtime = await import(pathToFileURL(join(plugin, 'tests', 'r17-ui-runtime.mjs')).href);

// Los dos eventos que el usuario reportó, con el titleKey INCORRECTO que traían en su día:
// el render debe ignorarlo y clasificar por `type`.
const created = runtime.activityEvent({
  eventId: 'ev-e1d22376f174',
  type: 'skill.created',
  origin: 'panel',
  actor: 'agent',
  titleKey: 'activity.title.skill-created',
  titleVars: { skill: 'prueba-entrega-catalogo-lsc-006' },
  skillTitle: 'prueba-entrega-catalogo-lsc-006',
});
const imported = runtime.activityEvent({
  eventId: 'ev-4b5ef716129b',
  type: 'skill-imported',
  origin: 'import',
  actor: 'human',
  titleKey: 'activity.title.skill-created',
  titleVars: { skill: 'prueba-entrega-catalogo-lsc-006-copia' },
  skillTitle: 'prueba-entrega-catalogo-lsc-006-copia',
});

const harness = runtime.createPanelHarness({ events: [created, imported] });
await harness.mount();
harness.calls.length = 0; // el montaje del panel pide su snapshot; aquí sólo interesa el cajón
const button = harness.nodes((node) => node.type === 'button' && String(node.props.title ?? '') === 'Ver la actividad del centro')[0];
await harness.click(button);
await harness.settle();

const dialog = harness.nodes((node) => node.props?.role === 'dialog')[0];
const rows = harness.nodes((node) => node.props?.className === 'lsc-activity-row').map((node) => runtime.textOf(node));
const header = runtime.textOf(dialog);
const requestCalls = harness.calls.filter((call) => String(call.url).includes('/api/activity'));
const postCalls = harness.calls.filter((call) => call.method === 'POST');

const evidence = {
  generatedAt: new Date().toISOString(),
  method: 'client.js real evaluado en node:vm con el runtime de pruebas del plugin; eventos históricos con titleKey incorrecto',
  rows,
  dialogHead: header.slice(0, 600),
  connected: /Centro disponible/.test(header),
  disconnected: /Sin conexión con el centro/.test(header),
  externalChannelDeclared: /Avisos externos no disponibles/.test(header),
  requestCount: requestCalls.length,
  writes: postCalls.length,
};
const outIndex = process.argv.indexOf('--out');
if (outIndex !== -1 && process.argv[outIndex + 1] !== undefined) {
  writeFileSync(process.argv[outIndex + 1], `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(evidence, null, 2));
