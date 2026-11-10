// R17.1 — Verificación independiente (T40).
//
// Cubre, con ejecución real y fixtures propias:
//  - el mapa type → titleKey y su traducción ES/EN (claves semánticas, no genéricas);
//  - que un evento histórico con `titleKey` incorrecto se pinta por su TIPO, sin reescribir
//    el almacén ni regenerar ids (lectura real del centro, hash antes/después);
//  - la etiqueta de conexión del cajón derivada de `sources` y del resultado real del fetch,
//    separada de la disponibilidad del canal externo y del contrato del cliente;
//  - que abrir/consultar el cajón es sólo lectura y no introduce polling.
//
// No copia los casos de `tests/r17-activity.test.mjs` ni de `tests/r17-ui.test.mjs`: usa fixtures
// y aserciones distintas, y cruza el backend con las tablas i18n reales de `client.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  EVENT_MAP,
  buildActivityFeed,
  normalizeEvent,
} from '../lib/activity.mjs';
import { loadState } from '../lib/state.mjs';
import {
  activityEvent,
  activityPayload,
  createPanelHarness,
  jsonResponse,
  textOf,
} from './r17-ui-runtime.mjs';

const CLIENT_SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const OPEN_ACTIVITY = 'Ver la actividad del centro';
const REAL_CENTER = path.join(homedir(), '.dsh', 'lifecode-skill-center');
const REAL_CENTER_FILE = path.join(REAL_CENTER, 'center.json');

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function activityButton(harness) {
  return harness.nodes((node) => node.type === 'button' && String(node.props.title ?? '') === OPEN_ACTIVITY)[0];
}

function dialogText(harness) {
  const dialog = harness.nodes((node) => node.props?.role === 'dialog')[0];
  return dialog === undefined ? '' : textOf(dialog);
}

function indicator(harness) {
  return harness.nodes((node) => typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes('lsc-activity-indicator'))[0];
}

function dotTone(harness) {
  const dot = harness.nodes((node) => typeof node.props?.className === 'string'
    && node.props.className.split(/\s+/).includes('lsc-activity-dot'))[0];
  if (dot === undefined) return '';
  return dot.props.className.split(/\s+/).find((part) => part === 'ok' || part === 'warn' || part === 'bad') ?? '';
}

function occurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

// ---------------------------------------------------------------------------
// 1) Mapa de tipos: cada tipo tiene clave semántica y traducción en ambos idiomas
// ---------------------------------------------------------------------------

test('R17.1: cada tipo del mapa tiene clave semántica traducida en ES y EN', () => {
  const keys = new Set();
  for (const [type, row] of Object.entries(EVENT_MAP)) {
    assert.ok(Array.isArray(row) && row.length === 3, `${type}: fila [categoría, severidad, clave]`);
    const [category, severity, titleKey] = row;
    assert.ok(['create', 'update', 'improvement', 'references', 'alert'].includes(category), `${type}: categoría`);
    assert.ok(['success', 'info', 'warning', 'error'].includes(severity), `${type}: severidad`);
    assert.match(titleKey, /^activity\.title\.[a-z0-9-]+$/, `${type}: clave con forma activity.title.*`);
    keys.add(titleKey);
  }

  // Las dos correcciones de R17.1, con el texto exacto que exige el contrato.
  assert.equal(EVENT_MAP['skill.created'][2], 'activity.title.skill-created');
  assert.equal(EVENT_MAP['skill-imported'][2], 'activity.title.skill-imported');
  assert.equal(EVENT_MAP['skill.created'][0], 'create');
  assert.equal(EVENT_MAP['skill-imported'][0], 'create');

  // Cruce backend ↔ cliente: cada clave usada por el motor está en las DOS tablas i18n.
  for (const key of keys) {
    assert.ok(occurrences(CLIENT_SOURCE, `'${key}':`) >= 2, `${key}: falta en ES o EN de client.js`);
  }
  assert.match(CLIENT_SOURCE, /'activity\.title\.skill-created': 'Skill «\{skill\}» creada'/);
  assert.match(CLIENT_SOURCE, /'activity\.title\.skill-created': 'Skill “\{skill\}” created'/);
  assert.match(CLIENT_SOURCE, /'activity\.title\.skill-imported': 'Skill «\{skill\}» importada'/);
  assert.match(CLIENT_SOURCE, /'activity\.title\.skill-imported': 'Skill “\{skill\}” imported'/);

  // Los tipos restantes de la directiva conservan su traducción (no caen al genérico).
  const required = [
    'improvement.proposed', 'improvement.approved', 'improvement.rejected',
    'skill.assigned', 'skill.unassigned', 'skill.advanced',
    'skill.requested', 'skill.request-fulfilled', 'skill.request-dismissed',
    'insight-received', 'insight-origin-verified', 'decision-recorded', 'policy-changed',
  ];
  const generic = 'activity.title.change-detected';
  for (const type of required) {
    const entry = normalizeEvent({ type, at: '2026-11-01T00:00:00.000Z', actor: 'human' }, { eventId: `ev-${type}` });
    assert.notEqual(entry.titleKey, generic, `${type}: no degrada al genérico`);
    assert.equal(occurrences(CLIENT_SOURCE, `'${entry.titleKey}':`), 2, `${type}: una entrada ES y una EN`);
  }
});

// ---------------------------------------------------------------------------
// 2) Evento histórico: manda el TIPO, no el titleKey guardado
// ---------------------------------------------------------------------------

test('R17.1: un titleKey guardado incorrecto no manda; la clave se deriva del tipo', () => {
  const imported = normalizeEvent({
    id: 'ev-legado-1',
    type: 'skill-imported',
    at: '2026-10-30T10:00:00.000Z',
    actor: 'human',
    channel: 'panel',
    // El almacén viejo tenía la clave equivocada: se ignora sin migrarlo.
    titleKey: 'activity.title.skill-created',
  }, { eventId: 'ev-legado-1' });
  assert.equal(imported.titleKey, 'activity.title.skill-imported');
  assert.notEqual(imported.titleKey, 'activity.title.skill-created');

  const created = normalizeEvent({
    id: 'ev-legado-2',
    type: 'skill.created',
    at: '2026-10-30T10:01:00.000Z',
    actor: 'human',
    titleKey: 'titulo.inventado',
  }, { eventId: 'ev-legado-2' });
  assert.equal(created.titleKey, 'activity.title.skill-created');

  // Tipo desconocido: se degrada al genérico; nunca inventa una clave semántica.
  const unknown = normalizeEvent({ type: 'skill.unknown', at: '2026-10-30T10:02:00.000Z' }, { eventId: 'ev-x' });
  assert.equal(unknown.titleKey, 'activity.title.change-detected');

  // El DTO no re-emite el campo crudo del almacén.
  assert.equal(Object.hasOwn(imported, 'titleKeyPersisted'), false);
});

// ---------------------------------------------------------------------------
// 3) Centro real: lectura, ids intactos y cero titleKey persistidos
// ---------------------------------------------------------------------------

test('R17.1: el centro real se lee en sólo lectura y deriva skill-created/skill-imported', () => {
  const before = sha256File(REAL_CENTER_FILE);
  const loaded = loadState(REAL_CENTER);
  assert.equal(loaded.integrity, 'ok', 'el centro real debe ser legible');
  assert.equal(sha256File(REAL_CENTER_FILE), before, 'leer no escribe ni re-serializa el centro');

  const events = Array.isArray(loaded.state?.events) ? loaded.state.events : [];
  assert.ok(events.length >= 2, 'el centro tiene eventos');

  // Ningún evento histórico persiste la clave de traducción (se deriva al leer).
  assert.equal(events.filter((event) => event !== null && typeof event === 'object' && 'titleKey' in event).length, 0,
    'persistedTitleKeys debe ser 0');

  const byId = new Map(events.map((event) => [event?.id, event]));
  const created = byId.get('ev-e1d22376f174');
  const imported = byId.get('ev-4b5ef716129b');
  assert.ok(created, 'ev-e1d22376f174 presente');
  assert.ok(imported, 'ev-4b5ef716129b presente');
  assert.equal(created.type, 'skill.created');
  assert.equal(imported.type, 'skill-imported');

  const feed = buildActivityFeed({ events }, null, { limit: 50 });
  const feedCreated = feed.events.find((event) => event.eventId === 'ev-e1d22376f174');
  const feedImported = feed.events.find((event) => event.eventId === 'ev-4b5ef716129b');
  assert.equal(feedCreated.titleKey, 'activity.title.skill-created');
  assert.equal(feedImported.titleKey, 'activity.title.skill-imported');
  assert.equal(feedImported.category, 'create');
  assert.equal(feedImported.origin, 'import');
  assert.equal(sha256File(REAL_CENTER_FILE), before, 'la derivación tampoco escribe');
});

// ---------------------------------------------------------------------------
// 4) Etiqueta de conexión del cajón: hechos distintos, nunca mezclados
// ---------------------------------------------------------------------------

test('R17.1: 200 con center+knowledge ok ⇒ «Centro disponible» y canal externo aparte', async () => {
  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  // El panel hace su bootstrap al montar (incluido `POST /api/state {action:'open'}`);
  // lo que se mide aquí es lo que provoca ABRIR el cajón.
  harness.calls.length = 0;
  await harness.click(activityButton(harness));

  const visible = dialogText(harness);
  assert.match(visible, /Centro disponible/);
  assert.doesNotMatch(visible, /Sin conexión con el centro/);
  assert.doesNotMatch(visible, /Centro disponible con avisos/);
  // El canal externo se declara como capacidad distinta, no como caída del centro.
  assert.match(visible, /Avisos externos no disponibles/);
  assert.equal(dotTone(harness), 'ok');

  const activityCalls = harness.calls.filter((call) => String(call.url).includes('/api/activity'));
  assert.equal(activityCalls.length, 1, 'una sola consulta al abrir');
  assert.equal(activityCalls[0].method, 'GET');
  assert.match(activityCalls[0].url, /\/api\/activity\?limit=\d+/);
  assert.doesNotMatch(activityCalls[0].url, /before=/);
  assert.equal(harness.calls.some((call) => call.method === 'POST'), false, 'abrir no escribe');
});

test('R17.1: una fuente no legible ⇒ «Centro disponible con avisos: <id>», nunca caído', async () => {
  const harness = createPanelHarness({
    events: [activityEvent()],
    responder: (call) => {
      if (!String(call.url).includes('/api/activity')) return null;
      return jsonResponse(200, activityPayload([activityEvent()], {
        sources: [
          { id: 'center', status: 'ok', reason: null },
          { id: 'knowledge', status: 'unreadable', reason: 'permiso denegado' },
        ],
      }));
    },
  });
  await harness.mount();
  await harness.click(activityButton(harness));

  const visible = dialogText(harness);
  assert.match(visible, /Centro disponible con avisos: knowledge/);
  assert.doesNotMatch(visible, /Sin conexión con el centro/);
  assert.doesNotMatch(visible, /Centro disponible\s*$/m, 'no finge que todo está bien');
});

test('R17.1: sin fuentes en la respuesta no hay evidencia ⇒ «Estado no disponible»', async () => {
  const harness = createPanelHarness({
    events: [activityEvent()],
    responder: (call) => {
      if (!String(call.url).includes('/api/activity')) return null;
      return jsonResponse(200, activityPayload([activityEvent()], { sources: [] }));
    },
  });
  await harness.mount();
  await harness.click(activityButton(harness));

  const visible = dialogText(harness);
  assert.match(visible, /Estado no disponible/);
  assert.doesNotMatch(visible, /Sin conexión con el centro/);
  assert.doesNotMatch(visible, /Centro disponible/);
});

test('R17.1: si el feed falla, el cajón lo dice y ofrece reintentar; no simula un centro sano', async () => {
  const harness = createPanelHarness({
    events: [],
    responder: (call) => {
      if (!String(call.url).includes('/api/activity')) return null;
      return jsonResponse(500, { ok: false, code: 'internal', message: 'fallo simulado del feed' });
    },
  });
  await harness.mount();
  harness.calls.length = 0;
  await harness.click(activityButton(harness));

  const visible = dialogText(harness);
  assert.match(visible, /Sin conexión con el centro/);
  assert.match(visible, /Reintentar/);
  // El cliente no pinta el cuerpo crudo del error: anuncia que el registro no tiene
  // la forma esperada y deja reintentar. Lo importante es que no finge un centro sano.
  assert.match(visible, /No se pudo leer la actividad/);
  assert.doesNotMatch(visible, /Centro disponible/);
  assert.equal(harness.calls.some((call) => call.method === 'POST'), false);
});

// ---------------------------------------------------------------------------
// 5) Sin polling nuevo y sin escrituras; setInterval único preexistente
// ---------------------------------------------------------------------------

test('R17.1: el cliente conserva un solo setInterval (el refresco preexistente) y el cajón no crea timers', async () => {
  assert.equal(occurrences(CLIENT_SOURCE, 'setInterval('), 1, 'sólo el refresco preexistente');
  assert.match(CLIENT_SOURCE, /SEEN_REFRESH_MS|20_000|20000/);

  const harness = createPanelHarness({ events: [activityEvent()] });
  await harness.mount();
  harness.calls.length = 0;
  await harness.click(activityButton(harness));
  await harness.settle();

  assert.equal(harness.timers.filter((timer) => Number(timer.ms) >= 10000).length, 0, 'sin temporizadores de polling');
  assert.equal(harness.timers.filter((timer) => Number(timer.ms) === 20000).length, 0);
  assert.equal(harness.calls.every((call) => call.method === 'GET'), true, 'abrir/consultar sólo hace GET');
});
