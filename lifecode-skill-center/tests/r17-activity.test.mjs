/**
 * R17 — actividad: derivación pura del diario (contrato `_audit/R17-EVENT-CONTRACT.md` §1-§5, §R1-R5).
 *
 * Estas pruebas no tocan el almacén real: el estado se construye en memoria o en una caja temporal y se
 * comprueba lo que se publica, no lo que se guarda (salvo el round-trip del §R3, que usa una caja).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_FILTERS,
  ACTIVITY_EXCLUDED_TYPES,
  ACTIVITY_MAX_LIMIT,
  EVENT_MAP,
  activityForResult,
  buildActivityFeed,
  decodeActivityCursor,
  encodeActivityCursor,
  knowledgeEventId,
  normalizeEvent,
} from '../lib/activity.mjs';
import { appendEvent, centerFile, emptyState, loadState, saveState, withState } from '../lib/state.mjs';
import { candidate, tempRoot } from './helpers.mjs';

const NOW = '2026-11-09T18:00:00.000Z';

function stateWith(events = [], skills = {}) {
  return { ...emptyState(NOW), skills, events };
}

function event(overrides = {}) {
  return {
    id: 'ev-000000000001',
    at: NOW,
    type: 'skill.created',
    skillId: 'skill-uno',
    projectId: '',
    version: '1.0.0',
    actor: 'human',
    note: 'nota libre que no debe publicarse',
    ...overrides,
  };
}

test('el DTO publica los campos del contrato y never inventa autoría', () => {
  const state = stateWith([event({ actor: '' })]);
  const [entry] = buildActivityFeed(state, null, { limit: 10 }).events;
  for (const key of [
    'eventId', 'type', 'at', 'actor', 'actorEvidence', 'origin', 'source', 'projectId', 'skillId',
    'skillTitle', 'versionBefore', 'versionAfter', 'referencesAdded', 'referencesUpdated',
    'referencesRemoved', 'correlationId', 'requestId', 'outcome', 'persisted', 'humanApprovalRequired',
    'confidence', 'category', 'severity', 'titleKey', 'titleVars',
  ]) {
    assert.ok(key in entry, `falta ${key}`);
  }
  // Sin actor demostrable no se afirma «human»: el histórico desconocido es unknown.
  assert.equal(entry.actor, 'unknown');
  assert.equal(entry.actorEvidence.stored, null);
  assert.equal(entry.persisted, true);
  assert.equal(entry.source, 'center.json');
  assert.equal(typeof entry.correlationId, 'string');
  assert.equal(entry.requestId, null);
  // `ai` se traduce a agent pero el token original se conserva para auditoría.
  const translated = normalizeEvent(event({ actor: 'ai' }), { eventId: 'ev-x' });
  assert.equal(translated.actor, 'agent');
  assert.equal(translated.actorEvidence.stored, 'ai');
  assert.equal(translated.actorEvidence.channel, 'unknown');
});

test('titleVars sólo lleva nombres, versiones, contadores y banderas', () => {
  const state = stateWith([
    event({ type: 'skill-imported', note: 'api_key: super-secreta', skillId: 'skill-uno' }),
  ], {
    'skill-uno': {
      id: 'skill-uno',
      title: 'Mi Skill',
      versions: [{ version: '1.0.0', references: { 'references/a.md': {}, 'references/b.md': {} }, body: 'cuerpo privado' }],
    },
  });
  const [entry] = buildActivityFeed(state, null, { limit: 5 }).events;
  assert.deepEqual(entry.titleVars, { skill: 'Mi Skill', version: '1.0.0', origin: 'import', references: 2 });
  const publicJson = JSON.stringify(entry);
  assert.equal(publicJson.includes('api_key'), false);
  assert.equal(publicJson.includes('cuerpo privado'), false);
  assert.equal(publicJson.includes('super-secreta'), false);
  assert.equal(entry.titleKey, 'activity.title.skill-imported');
});

test('un título sembrado con la descripción no se publica como nombre', () => {
  const description = 'Descripción larga que en almacenes antiguos acabó como título y no debe viajar al feed';
  const state = stateWith([event()], {
    'skill-uno': { id: 'skill-uno', title: description, versions: [{ version: '1.0.0', references: {} }] },
  });
  const [entry] = buildActivityFeed(state, null, { limit: 5 }).events;
  assert.equal(entry.skillTitle, null);
  assert.equal(entry.titleVars.skill, 'skill-uno');
  assert.equal(JSON.stringify(entry).includes(description), false);
});

test('el mapa type → categoría/severidad/titleKey es total y estable', () => {
  for (const [type, [category, severity, titleKey]] of Object.entries(EVENT_MAP)) {
    assert.ok(ACTIVITY_CATEGORIES.includes(category), `${type}: categoría`);
    assert.ok(['success', 'info', 'warning', 'error'].includes(severity), `${type}: severidad`);
    assert.match(titleKey, /^activity\.title\.[a-z0-9-]+$/, `${type}: titleKey`);
    const entry = normalizeEvent(event({ type }), { eventId: `ev-${type}` });
    assert.equal(entry.category, category, `${type}: categoría derivada`);
    assert.equal(entry.severity, severity, `${type}: severidad derivada`);
    assert.equal(entry.titleKey, titleKey, `${type}: titleKey derivado`);
  }
  // Tipos de insight no enumerados y el fallback externo.
  assert.equal(normalizeEvent(event({ type: 'insight-triaged' }), { eventId: 'ev-k' }).category, 'improvement');
  assert.equal(normalizeEvent(event({ type: 'skill.unknown' }), { eventId: 'ev-u' }).severity, 'info');
  assert.equal(normalizeEvent(event({ type: 'skill.unknown' }), { eventId: 'ev-u' }).titleKey, 'activity.title.change-detected');
  // improvement.proposed es la única que exige aprobación humana.
  assert.equal(normalizeEvent(event({ type: 'improvement.proposed' }), { eventId: 'ev-a' }).humanApprovalRequired, true);
  assert.equal(normalizeEvent(event({ type: 'improvement.approved' }), { eventId: 'ev-b' }).humanApprovalRequired, false);
  assert.equal(normalizeEvent(event({ type: 'improvement.rejected' }), { eventId: 'ev-c' }).severity, 'warning');
});

test('skill.loaded se excluye del feed pero sigue existiendo en el almacén', () => {
  const state = stateWith([event({ id: 'ev-loaded', type: 'skill.loaded' }), event({ id: 'ev-created' })]);
  const feed = buildActivityFeed(state, null, { limit: 10 });
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0].type, 'skill.created');
  assert.equal(ACTIVITY_EXCLUDED_TYPES.has('skill.loaded'), true);
  assert.equal(normalizeEvent({ type: 'skill.loaded', at: NOW }, { eventId: 'x' }), null);
});

test('eventos legacy sin campos nuevos se leen con defaults y sin claves inventadas', () => {
  const legacy = event({ correlationId: undefined });
  const entry = normalizeEvent(legacy, { eventId: 'ev-legacy' });
  assert.equal(entry.source, 'center.json');
  assert.equal(entry.confidence, 'derived');
  assert.equal(entry.requestId, null);
  assert.equal(entry.projectId, null);
  assert.equal(entry.actor, 'human');
  assert.equal(entry.referencesAdded, null);
});

test('versionBefore sale del historial inmediato y nunca se inventa 1.0.0', () => {
  const skill = {
    id: 'skill-uno',
    title: 'Skill',
    versions: [
      { version: '1.0.0', references: {} },
      { version: '1.1.0', references: {} },
      { version: '1.2.0', references: {} },
    ],
  };
  const entry = normalizeEvent(event({ type: 'skill.version', version: '1.2.0' }), {
    state: { skills: { 'skill-uno': skill } },
    eventId: 'ev-v',
  });
  assert.equal(entry.versionAfter, '1.2.0');
  assert.equal(entry.versionBefore, '1.1.0');
  // Sin historial: null, no 1.0.0.
  const single = normalizeEvent(event({ type: 'skill.version', version: '2.0.0' }), {
    state: { skills: { 'skill-uno': { ...skill, versions: [{ version: '2.0.0', references: {} }] } } },
    eventId: 'ev-w',
  });
  assert.equal(single.versionBefore, null);
});

test('referencias: created usa added y [] en el resto; skill.version compara contra la previa', () => {
  const created = normalizeEvent(event({ type: 'skill.created' }), {
    state: { skills: { 'skill-uno': { id: 'skill-uno', versions: [{ version: '1.0.0', references: { 'references/a.md': {} } }] } } },
    eventId: 'ev-c',
  });
  assert.deepEqual(created.referencesAdded, ['references/a.md']);
  assert.deepEqual(created.referencesUpdated, []);
  assert.deepEqual(created.referencesRemoved, []);
  const changed = normalizeEvent(event({ type: 'skill.version', version: '1.1.0' }), {
    state: {
      skills: {
        'skill-uno': {
          id: 'skill-uno',
          versions: [
            { version: '1.0.0', references: { 'references/a.md': {}, 'references/b.md': {} } },
            { version: '1.1.0', references: { 'references/a.md': {}, 'references/c.md': {} } },
          ],
        },
      },
    },
    eventId: 'ev-d',
  });
  assert.deepEqual(changed.referencesAdded, ['references/c.md']);
  assert.deepEqual(changed.referencesRemoved, ['references/b.md']);
  assert.deepEqual(changed.referencesUpdated, []);
});

test('knowledge.json se marca como fuente secundaria con ids kn- deterministas y sufijo ante colisión', () => {
  const knowledge = {
    events: [
      { at: NOW, type: 'insight-received', actor: 'ai', insightId: 'i-1', detail: 'una idea' },
      { at: NOW, type: 'insight-received', actor: 'ai', insightId: 'i-2', detail: 'otra idea' },
    ],
  };
  const first = buildActivityFeed(stateWith(), knowledge, { limit: 10 });
  assert.equal(first.events.length, 2);
  for (const entry of first.events) {
    assert.equal(entry.source, 'knowledge.json');
    assert.match(entry.eventId, /^kn-[a-f0-9]{12}(-\d+)?$/);
    assert.equal(entry.category, 'improvement');
    assert.equal(entry.titleKey, 'activity.title.insight-received');
  }
  const ids = first.events.map((entry) => entry.eventId);
  assert.equal(new Set(ids).size, 2);
  // Deterministas entre llamadas.
  assert.deepEqual(buildActivityFeed(stateWith(), knowledge, { limit: 10 }).events.map((e) => e.eventId), ids);
  // Colisión exacta del id sintético: el segundo recibe sufijo, no se pierde.
  const duplicate = { events: [{ at: NOW, type: 'insight-received', detail: 'x' }, { at: NOW, type: 'insight-received', detail: 'x' }] };
  const deduped = buildActivityFeed(stateWith(), duplicate, { limit: 10 });
  assert.equal(deduped.events.length, 2);
  assert.equal(deduped.events[0].eventId.startsWith('kn-'), true);
  assert.match(deduped.events.map((e) => e.eventId).sort()[0], /^kn-[a-f0-9]{12}$/);
  assert.match(deduped.events.map((e) => e.eventId).sort()[1], /^kn-[a-f0-9]{12}-2$/);
  assert.equal(knowledgeEventId(knowledge.events[0]), knowledgeEventId(knowledge.events[0]));
});

test('orden estable y paginación por cursor sin huecos ni repetidos', () => {
  const events = Array.from({ length: 30 }, (_, index) => event({
    id: `ev-${String(index).padStart(12, '0')}`,
    at: new Date(Date.parse(NOW) + index * 1000).toISOString(),
    skillId: `skill-${index}`,
  }));
  const state = stateWith(events);
  const seen = [];
  let before = null;
  for (let page = 0; page < 10; page += 1) {
    const feed = buildActivityFeed(state, null, { limit: 4, before });
    assert.ok(feed.events.length <= 4);
    assert.equal(feed.total, 30);
    seen.push(...feed.events.map((entry) => entry.eventId));
    before = feed.nextBefore;
    if (before === null) break;
  }
  assert.equal(seen.length, 30);
  assert.equal(new Set(seen).size, 30);
  const sorted = [...seen].sort();
  assert.deepEqual(sorted, events.map((item) => item.id).sort());
  // Primera página: lo más reciente primero.
  const first = buildActivityFeed(state, null, { limit: 2 });
  assert.deepEqual(first.events.map((e) => e.eventId), ['ev-000000000029', 'ev-000000000028']);
  assert.equal(first.truncated, true);
});

test('total cuenta la categoría filtrada, no la página restante', () => {
  const events = [
    event({ id: 'ev-1', type: 'skill.created' }),
    event({ id: 'ev-2', type: 'skill.version', version: '1.1.0' }),
    event({ id: 'ev-3', type: 'skill.created' }),
  ];
  const feed = buildActivityFeed(stateWith(events), null, { limit: 1, category: 'create' });
  assert.equal(feed.total, 2);
  assert.equal(feed.events.length, 1);
  assert.equal(feed.truncated, true);
});

test('cursor opaco: base64url de at|eventId y rechazo de basura', () => {
  const entry = { at: NOW, eventId: 'ev-abc' };
  const cursor = encodeActivityCursor(entry);
  assert.equal(cursor.includes('+'), false);
  assert.equal(cursor.includes('/'), false);
  assert.deepEqual(decodeActivityCursor(cursor), entry);
  assert.equal(decodeActivityCursor('no-es-un-cursor'), null);
  assert.equal(decodeActivityCursor(Buffer.from('sin-separador', 'utf8').toString('base64url')), null);
  assert.equal(decodeActivityCursor(Buffer.from('no-fecha|ev-1', 'utf8').toString('base64url')), null);
  assert.equal(decodeActivityCursor(''), null);
});

test('el feed nunca supera el máximo aunque se pida más', () => {
  const events = Array.from({ length: 80 }, (_, index) => event({ id: `ev-max-${index}`, at: NOW }));
  const feed = buildActivityFeed(stateWith(events), null, { limit: 500 });
  assert.equal(feed.events.length, ACTIVITY_MAX_LIMIT);
});

test('activityForResult devuelve la proyección mínima y null si no consta', () => {
  const state = stateWith([event({ id: 'ev-result' })]);
  const projection = activityForResult(state, 'ev-result');
  assert.deepEqual(Object.keys(projection).sort(), [
    'actor', 'at', 'category', 'eventId', 'persisted', 'severity', 'titleKey', 'titleVars', 'type',
  ]);
  assert.equal(activityForResult(state, 'ev-inexistente'), null);
  assert.equal(activityForResult(state, ''), null);
});

test('R3: el round-trip de un centro enriquecido y de uno legacy es byte a byte', () => {
  const root = tempRoot('r17-roundtrip');
  // Centro enriquecido: se escribe a través del núcleo (canal y operación durables).
  withState(root, (state) => {
    const created = candidate();
    state.skills[created.id] = {
      id: created.id,
      title: created.id,
      description: created.description,
      whenToUse: created.whenToUse,
      tags: created.tags,
      versions: [{ version: '1.0.0', body: created.body, description: created.description, whenToUse: created.whenToUse, tags: created.tags, references: {}, createdAt: NOW }],
      currentVersion: '1.0.0',
      createdAt: NOW,
      updatedAt: NOW,
    };
    appendEvent(state, { type: 'skill.created', skillId: created.id, version: '1.0.0', actor: 'ai', channel: 'tool', operationId: 'op-roundtrip' });
    return { ok: true };
  }, { now: NOW, eventDefaults: { channel: 'tool' }, operationId: 'op-roundtrip', operationKind: 'create' });
  const path = centerFile(root);
  const enriched = readFileSync(path);
  assert.match(enriched.toString('utf8'), /"channel": "tool"/);
  assert.match(enriched.toString('utf8'), /"operationId": "op-roundtrip"/);
  saveState(root, loadState(root).state, { now: NOW });
  const enrichedAgain = readFileSync(path);
  assert.equal(enrichedAgain.length > 0, true);
  // Cargar y volver a guardar no cambia ni un byte del documento canónico.
  const firstPass = readFileSync(path);
  saveState(root, loadState(root).state, { now: NOW });
  assert.equal(readFileSync(path).equals(firstPass), true);
  // Sin `channel`/`operationId` el documento también es estable y no gana claves.
  const document = JSON.parse(firstPass.toString('utf8'));
  for (const item of document.events ?? []) { delete item.channel; delete item.operationId; }
  const legacyRoot = tempRoot('r17-legacy');
  const legacyPath = centerFile(legacyRoot);
  saveState(legacyRoot, { ...emptyState(NOW), events: document.events ?? [] }, { now: NOW });
  // El primer guardado parte de un objeto en memoria; a partir de ahí el documento ya es canónico.
  saveState(legacyRoot, loadState(legacyRoot).state, { now: NOW });
  const legacyBytes = readFileSync(legacyPath);
  assert.equal(legacyBytes.toString('utf8').includes('"channel"'), false);
  saveState(legacyRoot, loadState(legacyRoot).state, { now: NOW });
  assert.equal(readFileSync(legacyPath).equals(legacyBytes), true);
});


test('cada tipo de skill se pinta con su clave semántica propia (R17.1)', () => {
  const expected = {
    'skill.created': 'activity.title.skill-created',
    'skill-imported': 'activity.title.skill-imported',
    'skill.version': 'activity.title.skill-updated',
    'skill.assigned': 'activity.title.skill-assigned',
    'skill.unassigned': 'activity.title.skill-unassigned',
    'skill.advanced': 'activity.title.skill-advanced',
    'improvement.proposed': 'activity.title.improvement-prepared',
    'improvement.approved': 'activity.title.self-improvement-completed',
    'improvement.rejected': 'activity.title.improvement-rejected',
    'skill.requested': 'activity.title.skill-requested',
    'skill.request-fulfilled': 'activity.title.skill-request-fulfilled',
    'skill.request-dismissed': 'activity.title.skill-request-dismissed',
    'policy-changed': 'activity.title.policy-changed',
    'decision-recorded': 'activity.title.decision-recorded',
    'insight-received': 'activity.title.insight-received',
    'insight-origin-verified': 'activity.title.insight-origin-verified',
  };
  for (const [type, titleKey] of Object.entries(expected)) {
    assert.equal(normalizeEvent(event({ type }), { eventId: `ev-${type}` }).titleKey, titleKey, type);
  }
});

test('un título guardado incorrecto no manda: el tipo decide la clasificación (histórico)', () => {
  const legacy = event({
    type: 'skill-imported',
    titleKey: 'activity.title.skill-created',
    titleVars: { skill: 'otra' },
  });
  const [entry] = buildActivityFeed(stateWith([legacy]), null, { limit: 5 }).events;
  assert.equal(entry.type, 'skill-imported');
  assert.equal(entry.titleKey, 'activity.title.skill-imported');
  assert.notEqual(entry.titleKey, 'activity.title.skill-created');
});
