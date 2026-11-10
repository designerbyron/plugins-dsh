// T45.4-B: foco del cajón de actividad y aviso persistente de errores de creación.
// El arnés provee `ref`, `isConnected`, `focus()` observable y desmontaje con cleanup, sin DOM real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityEvent,
  createPanelHarness,
  jsonResponse,
  textOf,
} from './r17-ui-runtime.mjs';

const OPEN_ACTIVITY = 'Ver la actividad del centro';
const CLOSE_ACTIVITY = 'Cerrar actividad';

function activityButton(harness) {
  return harness.nodes((node) => node.type === 'button' && String(node.props.title ?? '') === OPEN_ACTIVITY)[0];
}

function closeActivityButton(harness) {
  return harness.nodes((node) => node.type === 'button' && String(node.props.title ?? '') === CLOSE_ACTIVITY)[0];
}

function panelRoot(harness) {
  return harness.nodes((node) => typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes('lsc-root'))[0];
}

function toastCards(harness) {
  return harness.nodes((node) => typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes('lsc-toast-card'));
}

function drawerText(harness) {
  const dialog = harness.nodes((node) => node.props?.role === 'dialog')[0];
  return dialog === undefined ? '' : textOf(dialog);
}

function createModalText(harness) {
  const modal = harness.nodes((node) => typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes('lsc-modal-wrap'))[0];
  return modal === undefined ? '' : textOf(modal);
}

function newSkillButton(harness) {
  return harness.nodes((node) => node.type === 'button'
    && typeof node.props?.className === 'string'
    && node.props.className.includes('lsc-btn primary')
    && textOf(node).includes('Nueva skill'))[0];
}

function createModalFields(harness) {
  return harness.nodes((node) => node.type === 'input' || node.type === 'textarea');
}

function createButton(harness) {
  return harness.nodes((node) => node.type === 'button' && textOf(node) === 'Crear y evaluar')[0];
}

async function openActivity(harness) {
  await harness.click(activityButton(harness));
}

/* ------------------------------------------------------------------ helpers puros */

test('focusTargetOf elige el primer destino conectado y enfocable, y descarta el resto', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  const { focusTargetOf } = harness.testProbe;
  const disconnected = { isConnected: false, focus() {} };
  const notFocusable = { isConnected: true };
  const connected = { isConnected: true, focus() {} };
  assert.equal(focusTargetOf([null, undefined, disconnected, notFocusable, connected]), connected);
  assert.equal(focusTargetOf([null, disconnected, notFocusable]), null);
  assert.equal(focusTargetOf([]), null);
  assert.equal(focusTargetOf(undefined), null);
});

test('restoreFocus enfoca un destino válido y no lanza cuando no hay ninguno', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  const { restoreFocus } = harness.testProbe;
  const target = { isConnected: true, focus() { this.focused = true; } };
  assert.equal(restoreFocus([target]), true);
  assert.equal(target.focused, true);
  assert.equal(restoreFocus([{ isConnected: false, focus() { throw new Error('no debe llamarse'); } }]), false);
  assert.equal(restoreFocus([{ isConnected: true, focus() { throw new Error('focus roto'); } }]), false);
  assert.equal(restoreFocus([]), false);
});

test('activityFailureToast conserva título, código, findings y reasons del Host', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  const { activityFailureToast } = harness.testProbe;
  const labels = { failed: 'Falló', blocked: 'Bloqueado', code: 'código' };
  const toast = activityFailureToast({
    code: 'exists',
    message: 'ya existe una skill con ese id',
    findings: [{ code: 'duplicate-id', message: 'ids únicos' }],
    reasons: ['propón una mejora'],
  }, 409, labels);
  assert.equal(toast.title, 'ya existe una skill con ese id');
  assert.match(toast.detail, /^Bloqueado · código: exists/);
  assert.match(toast.detail, /duplicate-id: ids únicos/);
  assert.match(toast.detail, /propón una mejora/);
  const fallback = activityFailureToast({}, 0, labels);
  assert.equal(fallback.title, 'Falló');
  assert.match(fallback.detail, /código: 0/);
});

/* -------------------------------------------------------------- foco del cajón */

test('Escape cierra el cajón y devuelve el foco al botón que lo abrió', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  await openActivity(harness);
  assert.match(drawerText(harness), /Actividad de LifeCode/);
  assert.equal(String(harness.activeElement()?.props?.title ?? ''), CLOSE_ACTIVITY, 'al abrir enfoca el cierre del cajón');
  await harness.key('Escape');
  assert.equal(harness.testProbe.state().activityOpen, false, 'Escape cierra el cajón');
  assert.equal(harness.activeElement(), activityButton(harness), 'el foco vuelve al invocador');
});

test('el botón de cierre devuelve el foco al invocador', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  await openActivity(harness);
  await harness.click(closeActivityButton(harness));
  assert.equal(harness.testProbe.state().activityOpen, false);
  assert.equal(harness.activeElement(), activityButton(harness));
});

test('la cadena de respaldo usa el panel cuando el invocador ya no existe', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  const { restoreFocus } = harness.testProbe;
  const detachedTrigger = { isConnected: false, focus() { throw new Error('no debe enfocarse'); } };
  const root = { isConnected: true, focus() { this.focused = true; } };
  assert.equal(restoreFocus([detachedTrigger, root]), true);
  assert.equal(root.focused, true, 'cae en el contenedor del panel');
  assert.equal(restoreFocus([detachedTrigger, { isConnected: false, focus() {} }]), false, 'sin destino válido no enfoca nada');
});

test('un rerender del panel no reinstala el efecto de foco', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  await openActivity(harness);
  harness.render();
  await harness.settle();
  await harness.key('Escape');
  assert.equal(harness.activeElement(), activityButton(harness));
});

/* ---------------------------------------------------- aviso persistente de creación */

function createResponder(body, status = 409) {
  return (call) => {
    if (call.method !== 'POST' || !call.url.includes('/api/state')) return null;
    const parsed = JSON.parse(call.body ?? '{}');
    if (parsed.action !== 'create') return null;
    return Promise.resolve(jsonResponse(status, body));
  };
}

async function fillCreateForm(harness, values = {}) {
  await harness.click(newSkillButton(harness));
  const fields = createModalFields(harness);
  assert.ok(fields.length >= 6, 'el modal tiene sus campos');
  const order = ['title', 'id', 'description', 'whenToUse', 'tags'];
  order.forEach((key, index) => {
    const value = values[key] ?? (key === 'id' ? 'dup' : `${key}-valor`);
    fields[index].props.onChange({ target: { value } });
  });
  fields[5].props.onChange({ target: { value: '# cuerpo' } });
  await harness.settle();
}

test('un id duplicado muestra aviso persistente con el código real y el inline', async () => {
  const harness = createPanelHarness({
    responder: createResponder({
      ok: false,
      code: 'exists',
      message: 'ya existe una skill con el id "dup"',
      existingVersion: '1.0.0',
      findings: [{ code: 'duplicate-id', message: 'los ids son únicos' }],
    }),
  });
  await harness.mount();
  await fillCreateForm(harness);
  await harness.click(createButton(harness));
  await harness.settle();
  const cards = toastCards(harness);
  assert.equal(cards.length, 1, 'un solo aviso: no hay notificación duplicada');
  const toastText = textOf(cards[0]);
  assert.match(toastText, /ya existe una skill con el id "dup"/);
  assert.match(toastText, /exists/, 'conserva el código del Host');
  assert.match(toastText, /duplicate-id/, 'conserva los findings');
  assert.match(createModalText(harness), /los ids son únicos/, 'el detalle inline sigue visible');
  const timersBefore = harness.timers.length;
  await harness.settle(40);
  assert.equal(toastCards(harness).length, 1, 'el error no caduca solo');
  assert.equal(harness.timers.length, timersBefore, 'no programa temporizador');
});

test('el éxito de creación mantiene su aviso y no pinta un toast de error', async () => {
  const harness = createPanelHarness({
    responder: createResponder({ ok: true, id: 'nueva', skills: [] }, 200),
  });
  await harness.mount();
  await fillCreateForm(harness);
  await harness.click(createButton(harness));
  await harness.settle();
  const cards = toastCards(harness);
  assert.equal(cards.length, 1);
  assert.match(textOf(cards[0]), /Skill creada y evaluada\./);
});
