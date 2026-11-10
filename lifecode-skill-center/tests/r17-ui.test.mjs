import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityEvent,
  activityPayload,
  createPanelHarness,
  jsonResponse,
  textOf,
} from './r17-ui-runtime.mjs';

const OPEN_ACTIVITY = 'Ver la actividad del centro';

function activityButton(harness) {
  const found = harness.nodes((node) => node.type === 'button' && String(node.props.title ?? '') === OPEN_ACTIVITY);
  return found[0];
}

function toastCards(harness) {
  return harness.nodes((node) => typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes('lsc-toast-card'));
}

function activityRows(harness) {
  return harness.nodes((node) => node.props?.className === 'lsc-activity-row');
}

function filterButton(harness, label) {
  return harness.nodes((node) => node.type === 'button'
    && typeof node.props?.className === 'string'
    && node.props.className.includes('lsc-activity-filter')
    && textOf(node) === label)[0];
}

test('la pila de avisos muestra como máximo tres y descarta el más antiguo', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  harness.testProbe.notify('Aviso uno', 'ok');
  harness.testProbe.notify('Aviso dos', 'ok');
  harness.testProbe.notify('Aviso tres', 'ok');
  harness.testProbe.notify('Aviso cuatro', 'ok');
  await harness.settle();
  const cards = toastCards(harness);
  assert.equal(cards.length, 3, 'nunca hay más de tres tarjetas');
  const visible = cards.map((card) => textOf(card)).join('\n');
  assert.match(visible, /Aviso cuatro/);
  assert.match(visible, /Aviso tres/);
  assert.match(visible, /Aviso dos/);
  assert.doesNotMatch(visible, /Aviso uno/, 'el cuarto aviso descarta el más antiguo');
});

test('un error no caduca solo: es persistente y no programa temporizador', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  const before = harness.timers.length;
  harness.testProbe.notify('No se pudo escribir', 'bad');
  await harness.settle();
  assert.equal(toastCards(harness).length, 1);
  assert.equal(harness.timers.length, before, 'un error no programa caducidad');
  await harness.settle(40);
  assert.equal(toastCards(harness).length, 1, 'sigue visible tras esperar');
  const card = toastCards(harness)[0];
  assert.equal(card.props.role, 'alert', 'los errores se anuncian como alerta');
});

test('success y warning programan 6 s y 8 s respectivamente', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  harness.testProbe.notify('Guardado', 'ok');
  harness.testProbe.notify('Cuidado', 'warn');
  await harness.settle();
  const durations = harness.timers.map((timer) => timer.ms).sort((left, right) => left - right);
  assert.deepEqual(durations, [6000, 8000]);
  assert.equal(toastCards(harness)[0].props['aria-live'], undefined);
});

test('dos avisos con el mismo correlationId se agrupan en una tarjeta con contador', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  const first = activityEvent({ eventId: 'evt-a', correlationId: 'corr-1', referencesAdded: ['ref-1'] });
  const second = activityEvent({ eventId: 'evt-b', correlationId: 'corr-1', referencesAdded: ['ref-2'], titleVars: { skill: 'Demo' } });
  harness.testProbe.toastFromActivity(first, false);
  harness.testProbe.toastFromActivity(second, false);
  await harness.settle();
  const cards = toastCards(harness);
  assert.equal(cards.length, 1, 'una sola tarjeta por correlación');
  assert.match(textOf(cards[0]), /×2/);
  assert.match(textOf(cards[0]), /2 añadidas/);
});

test('un evento replayed no duplica el aviso', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  harness.testProbe.toastFromActivity(activityEvent(), true);
  await harness.settle();
  assert.equal(toastCards(harness).length, 0);
  harness.testProbe.toastFromActivity(activityEvent(), false);
  await harness.settle();
  assert.equal(toastCards(harness).length, 1);
});

test('la acción del aviso navega a la ficha de la skill', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  const event = activityEvent({ skillId: 'skill_demo', skillTitle: 'Demo' });
  harness.testProbe.toastFromActivity(event, false);
  await harness.settle();
  const action = harness.nodes((node) => node.type === 'button' && textOf(node).includes('Abrir detalle'))[0];
  assert.ok(action, 'el aviso ofrece abrir el detalle');
  await harness.click(action);
  const drawer = harness.nodes((node) => typeof node.props?.className === 'string' && node.props.className.includes('lsc-drawer'))[0];
  assert.ok(drawer, 'el panel abre la ficha de la skill');
});

test('el drawer no consulta hasta abrirse y al abrir hace UNA sola consulta', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  const before = harness.calls.filter((call) => call.url.includes('/api/activity')).length;
  assert.equal(before, 0, 'cerrado no pide nada');
  await harness.click(activityButton(harness));
  const after = harness.calls.filter((call) => call.url.includes('/api/activity'));
  assert.equal(after.length, 1, 'una consulta al abrir');
  assert.match(after[0].url, /limit=20/);
  await harness.settle(60);
  assert.equal(harness.calls.filter((call) => call.url.includes('/api/activity')).length, 1, 'sin polling');
});

test('«Cargar más» reenvía el cursor before tal cual', async () => {
  const events = [activityEvent({ eventId: 'evt-1' })];
  const harness = createPanelHarness({
    responder: (call) => {
      if (!call.url.includes('/api/activity')) return null;
      if (call.url.includes('before=cursor-2')) {
        return Promise.resolve(jsonResponse(200, activityPayload([activityEvent({ eventId: 'evt-2', at: '2026-11-08T10:00:00.000Z' })], { nextBefore: null, complete: true })));
      }
      return Promise.resolve(jsonResponse(200, activityPayload(events, { nextBefore: 'cursor-2', complete: false })));
    },
  });
  await harness.mount();
  await harness.click(activityButton(harness));
  const more = harness.nodes((node) => node.type === 'button' && textOf(node).includes('Cargar más'))[0];
  assert.ok(more, 'hay más páginas');
  await harness.click(more);
  const calls = harness.calls.filter((call) => call.url.includes('/api/activity'));
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /before=cursor-2/);
  assert.equal(activityRows(harness).length, 2, 'las páginas se concatenan');
});

test('los filtros de actividad filtran de verdad y marcan aria-pressed', async () => {
  const events = [
    activityEvent({ eventId: 'evt-c', category: 'create', severity: 'success', titleKey: 'activity.title.skill-created' }),
    activityEvent({ eventId: 'evt-u', category: 'update', severity: 'info', type: 'skill-updated', titleKey: 'activity.title.skill-updated' }),
  ];
  const harness = createPanelHarness({ events });
  await harness.mount();
  await harness.click(activityButton(harness));
  assert.equal(activityRows(harness).length, 2);
  const createFilter = filterButton(harness, 'Creaciones');
  await harness.click(createFilter);
  assert.equal(activityRows(harness).length, 1);
  assert.equal(filterButton(harness, 'Creaciones').props['aria-pressed'], 'true');
  assert.equal(filterButton(harness, 'Actualizaciones').props['aria-pressed'], 'false');
});

test('el badge de no leídas aparece y se limpia al abrir el drawer', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  harness.testProbe.setLastActivity('2026-11-09T18:59:30.000Z');
  await harness.settle();
  const dot = harness.nodes((node) => typeof node.props?.className === 'string' && node.props.className.includes('lsc-activity-badge'));
  assert.equal(dot.length, 1, 'hay un punto de no leídas');
  await harness.click(activityButton(harness));
  const after = harness.nodes((node) => typeof node.props?.className === 'string' && node.props.className.includes('lsc-activity-badge'));
  assert.equal(after.length, 0, 'abrir sella la marca');
  const stored = JSON.parse(harness.storage.get('lifecode-skill-center/activity-seen'));
  assert.equal(stored.v, 1);
  assert.equal(Array.isArray(stored.ids), true);
});

test('Escape cierra el drawer', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  await harness.click(activityButton(harness));
  assert.ok(harness.nodes((node) => typeof node.props?.className === 'string' && node.props.className.includes('lsc-activity-drawer-wrap')).length > 0);
  await harness.key('Escape');
  assert.equal(harness.nodes((node) => typeof node.props?.className === 'string' && node.props.className.includes('lsc-activity-drawer-wrap')).length, 0);
});

test('un 409 del feed es error con reintento, no una lista vacía', async () => {
  const harness = createPanelHarness({
    responder: (call) => {
      if (!call.url.includes('/api/activity')) return null;
      return Promise.resolve(jsonResponse(409, { ok: false, code: 'store-unreadable', message: 'no se pudo leer el almacén' }));
    },
  });
  await harness.mount();
  await harness.click(activityButton(harness));
  const visible = harness.text();
  assert.match(visible, /No se pudo leer la actividad/);
  assert.match(visible, /Reintentar/);
  assert.doesNotMatch(visible, /Todavía no hay actividad registrada/);
});

test('una fuente ilegible avisa de actividad parcial sin romper el resto', async () => {
  const events = [activityEvent()];
  const harness = createPanelHarness({
    responder: (call) => {
      if (!call.url.includes('/api/activity')) return null;
      return Promise.resolve(jsonResponse(200, activityPayload(events, {
        sources: [{ id: 'knowledge', status: 'unreadable', reason: 'permiso' }],
      })));
    },
  });
  await harness.mount();
  await harness.click(activityButton(harness));
  assert.match(harness.text(), /Parte de la actividad no está disponible/);
  assert.equal(activityRows(harness).length, 1, 'los eventos legibles se muestran');
});

test('el panel no añade ningún setInterval nuevo (baseline exacto)', async () => {
  const source = (await import('./r17-ui-runtime.mjs')).clientSource;
  const intervals = source.match(/setInterval\(/g) ?? [];
  assert.equal(intervals.length, 1, 'el único setInterval es el refresco preexistente');
});

test('la sección de actividad respeta prefers-reduced-motion', async () => {
  const { clientSource } = await import('./r17-ui-runtime.mjs');
  assert.match(clientSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(clientSource, /\.lsc-toast-card \{[^}]*animation: none/);
});

test('i18n: ES y EN tienen exactamente las mismas claves', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  const dictionaries = harness.locales[0]?.dictionaries;
  assert.ok(dictionaries, 'el módulo registra diccionarios');
  const es = Object.keys(dictionaries.es).sort();
  const en = Object.keys(dictionaries.en).sort();
  assert.deepEqual(en, es, 'paridad exacta de claves');
});

test('el idioma EN cambia el copy del panel y del drawer', async () => {
  const harness = createPanelHarness({ locale: 'en', events: [activityEvent()] });
  await harness.mount();
  const button = harness.nodes((node) => node.type === 'button' && String(node.props.title ?? '') === 'View the center activity')[0];
  assert.ok(button, 'el botón se rotula en inglés');
  await harness.click(button);
  assert.match(harness.text(), /LifeCode Activity/);
  assert.match(harness.text(), /Knowledge created, improved and preserved\./);
});

function dialogText(harness) {
  const dialog = harness.nodes((node) => node.props?.role === 'dialog')[0];
  return dialog === undefined ? '' : textOf(dialog);
}

test('con 200 y ambas fuentes ok el cajón declara el centro disponible, no desconectado (R17.1)', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  await harness.click(activityButton(harness));
  const visible = dialogText(harness);
  assert.match(visible, /Centro disponible/);
  assert.doesNotMatch(visible, /Sin conexión con el centro/);
  assert.match(visible, /Avisos externos no disponibles/, 'el canal externo se declara como capacidad aparte');
});

test('una fuente no legible se declara parcial sin declarar caído el centro (R17.1)', async () => {
  const harness = createPanelHarness({
    events: [activityEvent()],
    responder: (call) => {
      if (!String(call.url).includes('/api/activity')) return null;
      return jsonResponse(200, activityPayload([activityEvent()], {
        sources: [
          { id: 'center', status: 'ok', reason: null },
          { id: 'knowledge', status: 'unreadable', reason: 'permiso' },
        ],
      }));
    },
  });
  await harness.mount();
  await harness.click(activityButton(harness));
  const visible = dialogText(harness);
  assert.match(visible, /Centro disponible con avisos: knowledge/);
  assert.doesNotMatch(visible, /Sin conexión con el centro/);
});

test('el indicador usa la disponibilidad de la API como evidencia, no el contrato (R17.1)', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  const indicator = harness.nodes((node) => typeof node.props?.className === 'string'
    && node.props.className.includes('lsc-activity-indicator'))[0];
  assert.ok(indicator, 'hay indicador de actividad');
  assert.doesNotMatch(textOf(indicator), /Sin conexión con el centro/);
  const dot = harness.nodes((node) => typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes('lsc-activity-dot'))[0];
  assert.ok(dot, 'hay punto de estado');
  assert.match(String(dot.props.className), /(^|\s)ok(\s|$)/, 'el punto es verde cuando la API respondió');
});

test('el tipo manda sobre un titleKey incorrecto del payload, sin tocar el almacén (R17.1)', async () => {
  const created = activityEvent({
    eventId: 'ev-e1d22376f174',
    type: 'skill.created',
    origin: 'panel',
    titleKey: 'activity.title.skill-created',
    titleVars: { skill: 'original' },
  });
  const imported = activityEvent({
    eventId: 'ev-4b5ef716129b',
    type: 'skill-imported',
    origin: 'import',
    titleKey: 'activity.title.skill-created', // clave guardada incorrecta de un backend anterior
    titleVars: { skill: 'copia' },
  });
  const harness = createPanelHarness({ events: [imported, created] });
  await harness.mount();
  harness.calls.length = 0;
  await harness.click(activityButton(harness));
  await harness.settle();
  const visible = dialogText(harness);
  assert.match(visible, /Skill «copia» importada/, 'el tipo corrige la clave guardada');
  assert.equal((visible.match(/creada/g) ?? []).length, 1, 'sólo el evento de creación se pinta como creada');
  assert.equal(harness.calls.some((call) => call.method === 'POST'), false, 'leer el histórico no escribe');
});

test('un tipo desconocido conserva el título genérico que trae el payload (R17.1)', async () => {
  const unknown = activityEvent({
    eventId: 'ev-unknown-1',
    type: 'skill.unknown',
    origin: 'reconcile',
    titleKey: 'activity.title.change-detected',
    titleVars: { origin: 'reconcile' },
  });
  const harness = createPanelHarness({ events: [unknown] });
  await harness.mount();
  await harness.click(activityButton(harness));
  await harness.settle();
  assert.match(dialogText(harness), /Cambio detectado en reconcile/, 'sin clave derivable se usa la del DTO');
});

test('abrir y consultar el cajón no escribe ni emite eventos nuevos (R17.1)', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  await harness.click(activityButton(harness));
  harness.calls.length = 0;
  // Cerrar no consulta, y volver a abrir pide el feed una vez: nunca escribe.
  const close = harness.nodes((node) => node.type === 'button' && String(node.props.title ?? '') === 'Cerrar actividad')[0];
  assert.ok(close, 'el cajón se puede cerrar');
  await harness.click(close);
  assert.equal(harness.calls.filter((call) => String(call.url).includes('/api/activity')).length, 0, 'cerrar no consulta');
  await harness.click(activityButton(harness));
  await harness.settle();
  assert.equal(harness.calls.some((call) => call.method === 'POST'), false, 'el cajón nunca escribe');
  const requests = harness.calls.filter((call) => String(call.url).includes('/api/activity'));
  assert.ok(requests.length <= 1, 'reabrir no duplica consultas');
  assert.equal(requests.every((call) => call.method === 'GET'), true);
});

