// T45.4-C: indicador de actividad no leída (defecto C8 de T45.4-B).
//
// Lo que se fija aquí, y por qué:
//   · el evento que llega NO sella la lectura (antes lo hacía y apagaba el punto),
//   · con el cajón cerrado el punto se enciende (R1),
//   · abrir el cajón lo apaga (R2) y con el cajón abierto la actividad se sella (R2),
//   · sin actividad, sin fecha o con fecha no comparable no se enciende nada (R5/R6),
//   · varios eventos producen un solo indicador (R6).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityEvent,
  createPanelHarness,
  jsonResponse,
  textOf,
} from './r17-ui-runtime.mjs';

const OPEN_ACTIVITY = 'Ver la actividad del centro';
const UNREAD_DOT = 'puede haber novedades sin leer';

function activityButton(harness) {
  return harness.nodes((node) => node.type === 'button' && String(node.props.title ?? '') === OPEN_ACTIVITY)[0];
}

function badges(harness) {
  return harness.nodes((node) => typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes('lsc-activity-badge'));
}

function unreadDot(harness) {
  return badges(harness).filter((node) => String(node.props.className).includes('dot'));
}

function ariaLabel(harness) {
  return String(activityButton(harness)?.props?.['aria-label'] ?? '');
}

function newSkillButton(harness) {
  return harness.nodes((node) => node.type === 'button'
    && typeof node.props?.className === 'string'
    && node.props.className.includes('lsc-btn primary')
    && textOf(node).includes('Nueva skill'))[0];
}

function createButton(harness) {
  return harness.nodes((node) => node.type === 'button' && textOf(node) === 'Crear y evaluar')[0];
}

function modalFields(harness) {
  return harness.nodes((node) => node.type === 'input' || node.type === 'textarea');
}

/** Responder de creación exitosa: devuelve la `activity` persistida que el panel proyecta. */
function createdActivity(at, eventId = 'evt-new') {
  return { ...activityEvent({ at, eventId }), persisted: true };
}

function createResponder(activity, status = 200) {
  return (call) => {
    if (call.method !== 'POST' || !call.url.includes('/api/state')) return null;
    let parsed = {};
    try { parsed = JSON.parse(call.body ?? '{}'); } catch { parsed = {}; }
    if (parsed.action !== 'create') return null;
    return Promise.resolve(jsonResponse(status, {
      ok: true,
      replayed: false,
      activity,
      skills: [],
      snapshot: { readable: true, skills: [], projects: [] },
    }));
  };
}

async function createSkill(harness) {
  await harness.click(newSkillButton(harness));
  const fields = modalFields(harness);
  assert.ok(fields.length >= 6, 'el modal de creación tiene sus campos');
  ['Título de prueba', 'lab-unread-test', 'Descripción de prueba del indicador de no leídas.', 'Solo en pruebas.', 'lab'].forEach((value, index) => {
    fields[index].props.onChange({ target: { value } });
  });
  fields[5].props.onChange({ target: { value: '## Uno\nCuerpo.\n\n## Dos\nCuerpo.' } });
  await harness.settle();
  await harness.click(createButton(harness));
  await harness.settle();
}

/* ------------------------------------------------------------------ R1: aparece */

test('un evento nuevo con el cajón cerrado enciende el indicador de no leídas', async () => {
  const harness = createPanelHarness({ responder: createResponder(createdActivity('2026-11-10T12:00:00.000Z')) });
  await harness.mount();
  assert.equal(unreadDot(harness).length, 0, 'de partida no hay punto');

  await createSkill(harness);

  assert.equal(unreadDot(harness).length, 1, 'aparece el punto de no leídas');
  assert.match(ariaLabel(harness), new RegExp(UNREAD_DOT), 'el aria-label anuncia novedades');
  assert.equal(harness.testProbe.state().lastActivity, '2026-11-10T12:00:00.000Z');
});

test('el aviso de éxito ya no sella la lectura del evento', async () => {
  const harness = createPanelHarness({ responder: createResponder(createdActivity('2026-11-10T12:00:00.000Z')) });
  await harness.mount();
  const before = harness.testProbe.seen().lastSeenAt;
  await createSkill(harness);
  assert.equal(harness.testProbe.seen().lastSeenAt, before, 'crear no mueve lastSeenAt');
});

/* ------------------------------------------------------------------ R2: se apaga */

test('abrir el cajón apaga el indicador y sella la lectura', async () => {
  const harness = createPanelHarness({ responder: createResponder(createdActivity('2026-11-10T12:00:00.000Z')) });
  await harness.mount();
  await createSkill(harness);
  assert.equal(unreadDot(harness).length, 1);

  await harness.click(activityButton(harness));

  assert.equal(unreadDot(harness).length, 0, 'el punto desaparece al abrir');
  assert.notEqual(harness.testProbe.seen().lastSeenAt, '', 'la lectura queda sellada');
});

test('actividad que llega con el cajón abierto se sella y no deja punto detrás', async () => {
  const harness = createPanelHarness({
    responder: (call) => {
      if (call.method === 'POST' && call.url.includes('/api/state')) {
        return Promise.resolve(jsonResponse(200, {
          ok: true, replayed: false, skills: [],
          activity: createdActivity('2026-11-10T12:30:00.000Z', 'evt-open'),
        }));
      }
      return null;
    },
  });
  await harness.mount();
  await harness.click(activityButton(harness));
  await createSkill(harness);
  assert.equal(unreadDot(harness).length, 0, 'con el cajón abierto no queda punto');
});

/* ------------------------------------------------------- R3: posterior a lo leído */

test('un evento posterior a la marca de lectura vuelve a encender el punto', async () => {
  const harness = createPanelHarness({ responder: createResponder(createdActivity('2026-11-10T12:00:00.000Z')) });
  await harness.mount();
  await createSkill(harness);
  await harness.click(activityButton(harness));
  assert.equal(unreadDot(harness).length, 0);
  await harness.key('Escape');   // con el cajón abierto la actividad se sella (R2); hay que cerrarlo
  await harness.settle();
  assert.equal(harness.testProbe.state().activityOpen, false, 'el cajón quedó cerrado');

  harness.testProbe.setLastActivity(new Date(Date.now() + 60_000).toISOString());
  await harness.settle();
  assert.equal(unreadDot(harness).length, 1, 'vuelve a encenderse con actividad posterior');
});

/* ------------------------------------------------ R3: sin falsos positivos */

test('un evento anterior o igual a la marca de lectura no enciende el punto', async () => {
  const harness = createPanelHarness({
    storage: {
      'lifecode-skill-center/activity-seen': JSON.stringify({ v: 1, lastSeenAt: '2026-11-10T12:00:00.000Z', ids: [] }),
    },
  });
  await harness.mount();
  harness.testProbe.setLastActivity('2026-11-10T11:59:59.000Z');
  await harness.settle();
  assert.equal(unreadDot(harness).length, 0, 'anterior a la lectura no cuenta');

  harness.testProbe.setLastActivity('2026-11-10T12:00:00.000Z');
  await harness.settle();
  assert.equal(unreadDot(harness).length, 0, 'igual a la lectura tampoco');

  harness.testProbe.setLastActivity('2026-11-10T12:00:00.001Z');
  await harness.settle();
  assert.equal(unreadDot(harness).length, 1, 'un milisegundo después sí');
});

/* ------------------------------------------------------------- R5: nada engañoso */

test('sin actividad, sin fecha o con fecha ilegible no se inventa el punto', async () => {
  const harness = createPanelHarness();
  await harness.mount();
  assert.equal(unreadDot(harness).length, 0, 'sin actividad no hay punto');

  harness.testProbe.setLastActivity('');
  await harness.settle();
  assert.equal(unreadDot(harness).length, 0);

  harness.testProbe.setLastActivity('no-es-una-fecha');
  await harness.settle();
  assert.equal(unreadDot(harness).length, 0, 'una fecha ilegible no enciende nada');
});

test('una actividad sin persisted no mueve la última actividad ni el punto', async () => {
  const harness = createPanelHarness({
    responder: createResponder({ ...activityEvent({ at: '2026-11-10T12:00:00.000Z' }), persisted: false }),
  });
  await harness.mount();
  await createSkill(harness);
  assert.equal(unreadDot(harness).length, 0);
});

/* ------------------------------------------------------------ R6: un solo indicador */

test('varios eventos seguidos dejan un único indicador', async () => {
  let index = 0;
  const harness = createPanelHarness({
    responder: (call) => {
      if (call.method !== 'POST' || !call.url.includes('/api/state')) return null;
      index += 1;
      return Promise.resolve(jsonResponse(200, {
        ok: true, replayed: false, skills: [],
        activity: createdActivity(`2026-11-10T12:0${index}:00.000Z`, `evt-${index}`),
      }));
    },
  });
  await harness.mount();
  await createSkill(harness);
  await createSkill(harness);
  await createSkill(harness);
  assert.equal(badges(harness).length, 1, 'no se duplican badges');
  assert.equal(unreadDot(harness).length, 1);
});

/* ------------------------------------------------------------- R3: persistencia tras recarga */

test('tras recargar se respeta la marca persistida y no se inventa el punto', async () => {
  const first = createPanelHarness({ responder: createResponder(createdActivity('2026-11-10T12:00:00.000Z')) });
  await first.mount();
  await createSkill(first);
  await first.click(activityButton(first));           // sella la lectura
  const persisted = first.storage.get('lifecode-skill-center/activity-seen');
  assert.ok(persisted, 'la marca quedó escrita');
  const seenAt = JSON.parse(persisted).lastSeenAt;
  assert.notEqual(seenAt, '');

  // Simula la recarga: un panel nuevo con el localStorage anterior.
  const second = createPanelHarness({ storage: { 'lifecode-skill-center/activity-seen': persisted } });
  await second.mount();
  assert.equal(unreadDot(second).length, 0, 'al recargar no hay punto si nada es posterior');
  assert.equal(second.testProbe.seen().lastSeenAt, seenAt, 'la marca persiste');

  second.testProbe.setLastActivity(new Date(Date.parse(seenAt) + 60_000).toISOString());
  await second.settle();
  assert.equal(unreadDot(second).length, 1, 'con actividad posterior vuelve el punto');
});
