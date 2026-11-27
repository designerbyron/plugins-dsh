/**
 * Fase G, interfaz: selector Global/Proyecto en el compositor «Pedir a la IA».
 *
 * Se ejecuta sobre el client.js real con el arnés de React mínimo del repositorio: sin DOM del harness,
 * sin stores reales y sin instalar nada. Comprueba lista/selector, estados vacíos, sugerencia rotulada,
 * limpieza al volver a Global, resumen visible, idioma y envío exacto del par `scope`/`projectId`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createPanelHarness, defaultSnapshot, textOf,
} from './r17-ui-runtime.mjs';

const ELIGIBLE_ID = 'proyecto-gestionado-a1b2c3d4';
const OTHER_ID = 'otro-proyecto-99999999';

function snapshotWithProjects({ eligible = true, panelId = ELIGIBLE_ID } = {}) {
  const snapshot = defaultSnapshot();
  snapshot.requestProjects = eligible
    ? [
      { id: ELIGIBLE_ID, name: 'Proyecto gestionado', cwd: 'C:/x/proyecto-gestionado' },
      { id: OTHER_ID, name: 'Otro proyecto', cwd: 'C:/x/otro-proyecto' },
    ]
    : [];
  snapshot.panelContext = {
    projectId: panelId, name: 'Proyecto del panel', cwd: 'C:/x/proyecto-gestionado',
    selectionSource: 'validated-selection', resolved: true,
  };
  snapshot.requests = {
    total: 1, pending: 1, actionable: 1,
    all: [{ id: 'req-antigua', text: 'petición heredada', status: 'pending', kind: 'unclassified', scope: 'legacy/global' }],
    pendingItems: [], actionableItems: [],
  };
  return snapshot;
}

async function panel(locale = 'es', options = {}) {
  const harness = createPanelHarness({ locale, snapshot: snapshotWithProjects(options) });
  await harness.mount();
  const label = locale === 'en' ? 'Requests' : 'Solicitudes';
  const nav = harness.nodes((node) => node.type === 'button'
    && String(node.props.className ?? '').includes('lsc-rail-item')
    && textOf(node).includes(label))[0];
  assert.ok(nav, `la navegación a ${label} existe`);
  await harness.click(nav);
  return harness;
}

function selectByLabel(harness, label) {
  return harness.nodes((node) => node.type === 'select' && String(node.props['aria-label'] ?? '') === label)[0];
}

async function changeSelect(harness, node, value) {
  assert.ok(node, 'el selector existe');
  node.props.onChange({ target: { value } });
  await harness.settle();
}

async function submitAsk(harness) {
  const form = harness.nodes((node) => node.type === 'form' && String(node.props.className ?? '').includes('lsc-row'))[0];
  assert.ok(form, 'el formulario del compositor existe');
  form.props.onSubmit({ preventDefault() {} });
  await harness.settle();
}

function askCalls(harness) {
  return harness.calls
    .filter((call) => call.method === 'POST' && call.url.includes('/api/state'))
    .map((call) => ({ ...call, json: JSON.parse(call.body ?? '{}') }))
    .filter((call) => call.json.action === 'request-skill');
}

test('G9: el compositor ofrece Global por defecto y el selector de proyecto aparece sólo en ámbito proyecto', async () => {
  const harness = await panel();
  const scope = selectByLabel(harness, 'Ámbito');
  assert.ok(scope, 'el selector de ámbito existe');
  assert.deepEqual(scope.props.value, 'global', 'Global es la opción inicial');
  assert.deepEqual(scope.props.children.map((option) => option.props.value), ['global', 'project']);
  assert.match(textOf(scope.props.children[0]), /Global \(sin proyecto\)/);
  assert.match(textOf(scope.props.children[1]), /Proyecto específico/);
  assert.equal(selectByLabel(harness, 'Proyecto de la solicitud'), undefined, 'en Global no hay selector de proyecto');
  assert.match(harness.text(), /Ámbito de la solicitud: Global \(sin proyecto\)/);
  harness.unmount();
});

test('G10: en Proyecto se listan sólo elegibles, el actual se rotula como sugerencia y el resumen lo nombra', async () => {
  const harness = await panel();
  await changeSelect(harness, selectByLabel(harness, 'Ámbito'), 'project');
  const picker = selectByLabel(harness, 'Proyecto de la solicitud');
  assert.ok(picker, 'el selector de proyecto aparece en ámbito proyecto');
  assert.deepEqual(picker.props.value, '', 'nada se preselecciona: la elección es explícita');
  const options = picker.props.children;
  assert.deepEqual(options.map((option) => option.props.value), ['', ELIGIBLE_ID, OTHER_ID]);
  assert.match(textOf(options[1]), /Proyecto gestionado · sugerencia del panel \(proyecto-gestionado-a1b2c3d4\)/);
  assert.doesNotMatch(textOf(options[2]), /sugerencia del panel/);
  assert.match(harness.text(), /Selecciona un proyecto elegible antes de registrar la petición/);

  await changeSelect(harness, picker, OTHER_ID);
  assert.match(harness.text(), /Ámbito de la solicitud: Proyecto específico · Otro proyecto \(otro-proyecto-99999999\)/);
  harness.unmount();
});

test('G11: sin proyectos elegibles hay mensaje y envío deshabilitado', async () => {
  const harness = await panel('es', { eligible: false });
  await changeSelect(harness, selectByLabel(harness, 'Ámbito'), 'project');
  assert.equal(selectByLabel(harness, 'Proyecto de la solicitud'), undefined);
  assert.match(harness.text(), /No hay proyectos gestionados con workspace válido/);
  const textarea = harness.nodes((node) => node.type === 'input' && node.props['aria-label'] === '¿Qué necesitas?')[0];
  textarea.props.onChange({ target: { value: 'necesito una revisión' } });
  await harness.settle();
  const send = harness.button('Registrar petición');
  assert.equal(send.props.disabled, true, 'sin proyecto elegible no se puede enviar');
  assert.equal(askCalls(harness).length, 0);
  harness.unmount();
});

test('G12: volver a Global limpia el projectId y el envío no lo reenvía', async () => {
  const harness = await panel();
  await changeSelect(harness, selectByLabel(harness, 'Ámbito'), 'project');
  await changeSelect(harness, selectByLabel(harness, 'Proyecto de la solicitud'), ELIGIBLE_ID);
  await changeSelect(harness, selectByLabel(harness, 'Ámbito'), 'global');
  assert.equal(selectByLabel(harness, 'Proyecto de la solicitud'), undefined);
  assert.match(harness.text(), /Ámbito de la solicitud: Global \(sin proyecto\)/);

  const textarea = harness.nodes((node) => node.type === 'input' && node.props['aria-label'] === '¿Qué necesitas?')[0];
  textarea.props.onChange({ target: { value: 'revisión global' } });
  await harness.settle();
  await submitAsk(harness);
  const calls = askCalls(harness);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].json.payload, {
    text: 'revisión global', kind: 'create', scope: 'global', projectId: '',
  });
  harness.unmount();
});

test('G13: el envío de proyecto manda scope project y el id elegido, sin inferirlo del panel', async () => {
  const harness = await panel();
  await changeSelect(harness, selectByLabel(harness, 'Ámbito'), 'project');
  await changeSelect(harness, selectByLabel(harness, 'Proyecto de la solicitud'), OTHER_ID);
  const textarea = harness.nodes((node) => node.type === 'input' && node.props['aria-label'] === '¿Qué necesitas?')[0];
  textarea.props.onChange({ target: { value: 'revisión de proyecto' } });
  await harness.settle();
  await submitAsk(harness);
  const calls = askCalls(harness);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].json.payload, {
    text: 'revisión de proyecto', kind: 'create', scope: 'project', projectId: OTHER_ID,
  });
  harness.unmount();
});

test('G14: el panel en inglés traduce el selector, el resumen y los estados vacíos', async () => {
  const harness = await panel('en');
  assert.ok(selectByLabel(harness, 'Scope'), 'el ámbito está traducido');
  assert.match(textOf(selectByLabel(harness, 'Scope').props.children[1]), /Specific project/);
  await changeSelect(harness, selectByLabel(harness, 'Scope'), 'project');
  await changeSelect(harness, selectByLabel(harness, 'Request project'), OTHER_ID);
  assert.match(harness.text(), /Request scope: Specific project · Otro proyecto \(otro-proyecto-99999999\)/);
  assert.doesNotMatch(harness.text(), /req\.[a-z]/i, 'no queda ninguna clave sin resolver');
  harness.unmount();

  const empty = await panel('en', { eligible: false });
  await changeSelect(empty, selectByLabel(empty, 'Scope'), 'project');
  assert.match(empty.text(), /There are no managed projects with a valid workspace/);
  assert.doesNotMatch(empty.text(), /req\.[a-z]/i);
  empty.unmount();
});

test('G15: cambiar de ámbito o de proyecto no dispara escrituras ni cambia la sesión', async () => {
  const harness = await panel();
  const before = harness.calls.filter((call) => call.method === 'POST').length;
  await changeSelect(harness, selectByLabel(harness, 'Ámbito'), 'project');
  await changeSelect(harness, selectByLabel(harness, 'Proyecto de la solicitud'), ELIGIBLE_ID);
  await changeSelect(harness, selectByLabel(harness, 'Ámbito'), 'global');
  assert.equal(harness.calls.filter((call) => call.method === 'POST').length, before, 'elegir no escribe');
  assert.equal(askCalls(harness).length, 0);
  assert.equal(harness.calls.filter((call) => call.url.includes('agent-session')).length, 0);
  harness.unmount();
});

test('G16: el Request Center sigue mostrando la petición heredada y VendorView sigue montando', async () => {
  const harness = await panel();
  assert.match(harness.text(), /petición heredada/);
  assert.match(harness.text(), /Global heredada/);
  assert.match(harness.text(), /El texto de una petición es dato/);
  const vendorNav = harness.nodes((node) => node.type === 'button'
    && String(node.props.className ?? '').includes('lsc-rail-item')
    && /Proveedor|Vendor/.test(textOf(node)))[0];
  await harness.click(vendorNav);
  assert.match(harness.text(), /Importador de proveedor|Vendor importer/);
  assert.match(harness.text(), /Revisar candidato|Review candidate/);
  harness.unmount();
});

test('G17: el selector de ámbito es flexible en escritorio y se apila en móvil/tableta', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /\.lsc-req-scope \{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/);
  assert.match(source, /\.lsc-req-scope \.lsc-select \{[^}]*flex:\s*1 1 150px/);
  const tablet = source.match(/@media \(max-width: 760px\) \{([\s\S]*?)\n\}/);
  assert.ok(tablet, 'existe el corte de 760 px');
  assert.match(tablet[1], /\.lsc-req-scope, \.lsc-req-scope \.lsc-select \{[^}]*width:\s*100%/);
  assert.match(tablet[1], /\.lsc-req-scope, \.lsc-req-scope \.lsc-select \{[^}]*max-width:\s*none/);
});
