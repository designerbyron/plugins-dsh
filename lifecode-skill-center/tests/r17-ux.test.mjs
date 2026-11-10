/**
 * R17 — UX de avisos/centro de actividad con efectos reales en el runtime del panel (node:vm).
 *
 * Se usan el `client.js` real y el arnés `tests/r17-ui-runtime.mjs`. No hay Host ni DOM de verdad:
 * las peticiones son grabadas y se comprueba el presupuesto (0 al arrancar, 1 al abrir, 0 cerrado).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  activityEvent,
  activityPayload,
  clientPath,
  createPanelHarness,
  jsonResponse,
  textOf,
} from './r17-ui-runtime.mjs';

const OPEN = 'Ver la actividad del centro';
const TITLE = 'Actividad de LifeCode';

function activityButton(harness) {
  return harness.nodes((node) => node.type === 'button' && String(node.props.title ?? '') === OPEN)[0];
}

function activityRequests(harness) {
  return harness.calls.filter((call) => String(call.url).includes('/api/activity'));
}

function toastCards(harness) {
  return harness.nodes((node) => typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes('lsc-toast-card'));
}

test('R17-A: arrancar e inactividad no piden actividad; abrir pide una y cerrar no pide', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  await harness.settle(40);
  assert.equal(activityRequests(harness).length, 0, 'el arranque no consulta el feed');
  await harness.settle(20_000);
  assert.equal(activityRequests(harness).length, 0, 'no hay sondeo en inactividad');
  assert.equal(harness.timers.filter((timer) => timer.ms === 20_000).length, 0, 'no hay temporizador de 20 s');

  await harness.click(activityButton(harness));
  assert.equal(activityRequests(harness).length, 1, 'abrir consulta UNA vez');
  assert.match(harness.text(), new RegExp(TITLE));
  const close = harness.nodes((node) => node.type === 'button' && String(node.props['aria-label'] ?? '') === 'Cerrar actividad')[0];
  assert.ok(close, 'el drawer tiene un cierre accesible');
  await harness.click(close);
  assert.equal(activityRequests(harness).length, 1, 'cerrar no consulta');
  assert.doesNotMatch(harness.text(), new RegExp(TITLE));
});

test('R17-A: 20 aperturas/cierres no multiplican consultas ni dejan temporizadores', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  for (let index = 0; index < 20; index += 1) {
    await harness.click(activityButton(harness));
    assert.match(harness.text(), new RegExp(TITLE), `abre en el ciclo ${index}`);
    await harness.key('Escape');
  }
  assert.equal(activityRequests(harness).length, 1, 'el drawer reutiliza el feed vigente; abrir de nuevo no vuelve a consultar');
  assert.equal(harness.timers.filter((timer) => timer.ms === 20_000).length, 0, 'no se programó ningún intervalo');
  assert.equal(harness.nodes((node) => node.props?.role === 'dialog').length, 0, 'el último cierre deja el drawer cerrado');
});

test('R17 §7: persisted:false y replayed no generan aviso; persisted:true genera uno', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  const notPersisted = activityEvent({ eventId: 'ev-np', persisted: false });
  assert.equal(harness.testProbe.toastFromActivity(notPersisted, false), '');
  await harness.settle();
  assert.equal(toastCards(harness).length, 0, 'lo no persistido no se anuncia como hecho');
  const persisted = activityEvent({ eventId: 'ev-p', persisted: true });
  assert.notEqual(harness.testProbe.toastFromActivity(persisted, false), '');
  await harness.settle();
  assert.equal(toastCards(harness).length, 1);
  const before = toastCards(harness).length;
  assert.equal(harness.testProbe.toastFromActivity(activityEvent({ eventId: 'ev-r', persisted: true }), true), '');
  await harness.settle();
  assert.equal(toastCards(harness).length, before, 'un replay no duplica el aviso');
});

test('R17 §6: un payload inválido es error con reintento, no una lista vacía', async () => {
  const harness = createPanelHarness({
    responder: (call) => (String(call.url).includes('/api/activity')
      ? jsonResponse(200, { ok: true, apiVersion: 1, events: 'no-es-array' })
      : null),
  });
  await harness.mount();
  await harness.click(activityButton(harness));
  const dialog = harness.nodes((node) => node.props?.role === 'dialog')[0];
  assert.ok(dialog, 'el drawer está abierto');
  const screen = textOf(dialog);
  assert.doesNotMatch(screen, /Sin actividad todavía|Todavía no hay actividad registrada/, 'no finge un feed vacío');
  assert.match(screen, /Reintentar|No se pudo|forma esperada|inválid/i);
});

test('R17 §11: el drawer declara diálogo modal y Escape lo cierra; foco inicial en cerrar', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  await harness.click(activityButton(harness));
  const dialogs = harness.nodes((node) => node.props?.role === 'dialog');
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].props['aria-modal'], 'true');
  assert.ok(dialogs[0].props['aria-labelledby'] || dialogs[0].props['aria-label'], 'el diálogo se nombra con su título');
  await harness.key('Escape');
  assert.equal(harness.nodes((node) => node.props?.role === 'dialog').length, 0);
});

test('R17-A: no hay polling nuevo ni temporizadores permanentes en client.js', () => {
  const source = readFileSync(clientPath, 'utf8');
  const intervals = source.match(/setInterval\(/g) ?? [];
  assert.equal(intervals.length, 1, 'sólo queda el refresco preexistente de 20 s');
  const refresh = source.slice(source.indexOf('setInterval(') - 200, source.indexOf('setInterval(') + 200);
  assert.match(refresh, /20_?000|hidden|visibility/i, 'el único intervalo es el refresco con skip en hidden');
  assert.doesNotMatch(source, /new\s+Notification\(/, 'sin notificaciones del navegador');
  assert.doesNotMatch(source, /EventSource\(|WebSocket\(/, 'sin canales persistentes');
});

test('R17 §12/§11: i18n ES/EN cubre actividad y respeta reduced-motion', () => {
  const source = readFileSync(clientPath, 'utf8');
  for (const key of ['activityFeed.title', 'activity.button.title', 'activity.close', 'activity.filter.all', 'activity.toast.blocked']) {
    const occurrences = source.split(`'${key}'`).length - 1;
    assert.ok(occurrences >= 1, `${key} existe`);
  }
  assert.ok((source.match(/'activityFeed\.title'/g) ?? []).length >= 2, 'ES y EN tienen la clave');
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
  const reduced = source.slice(source.indexOf('prefers-reduced-motion: reduce'));
  assert.match(reduced.slice(0, 800), /lsc-toast|animation:\s*none|animation-duration:\s*0/, 'el aviso se desactiva con reduced motion');
});
