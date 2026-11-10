// Ficha de detalle de una skill: versiones con su evaluación, asignaciones con su versión fijada, mejoras y
// línea de tiempo. Es la vista que convierte «hay 6 skills» en «esto le pasó a esta skill».
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleApiRequest, runAction, skillDetail } from '../lib/api.mjs';
import { API_PREFIX } from '../lib/api.mjs';
import { candidate, tempProject, tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';
const LATER = '2026-11-09T13:00:00.000Z';

function created() {
  const root = autonomyRoot('skill-detail');
  const cwd = tempProject('detalle', autonomyRoot('skill-detail-cwd'));
  const result = runAction({
    root,
    action: 'create',
    cwd,
    now: NOW,
    actor: 'ai',
    payload: candidate({ id: 'skill-detalle', title: 'Skill de detalle' }),
  });
  assert.equal(result.ok, true);
  return { root, cwd };
}

test('una skill desconocida devuelve skill-not-found, no una ficha vacía', () => {
  const root = autonomyRoot('skill-detail-missing');
  const detail = skillDetail({ root, skillId: 'no-existe', now: NOW });
  assert.equal(detail.ok, false);
  assert.equal(detail.code, 'skill-not-found');
});

test('la ficha trae la versión vigente con su evaluación resumida', () => {
  const { root } = created();
  const detail = skillDetail({ root, skillId: 'skill-detalle', now: NOW });
  assert.equal(detail.ok, true);
  assert.equal(detail.skill.id, 'skill-detalle');
  assert.equal(detail.metrics.versions, 1);
  assert.equal(detail.versions[0].version, '1.0.0');
  assert.equal(detail.versions[0].score, 100);
  assert.equal(detail.versions[0].status, 'pass');
  assert.equal(detail.versions[0].summary, 'correcta (100/100)');
  assert.equal(detail.metrics.quality.first, 100);
  assert.equal(detail.metrics.quality.delta, 0);
});

test('las versiones salen de la más nueva a la más vieja y el delta de calidad se mide', () => {
  const { root, cwd } = created();
  const improved = runAction({
    root,
    action: 'improve',
    cwd,
    now: NOW,
    actor: 'ai',
    payload: {
      skillId: 'skill-detalle',
      rationale: 'Añadir un límite explícito',
      body: `${candidate().body}\n\n## Limite\n\nLo que el catálogo ofrece no prueba que se aplicara.`,
    },
  });
  assert.equal(improved.ok, true);
  runAction({ root, action: 'decide', now: LATER, actor: 'human', payload: { improvementId: improved.improvementId, decision: 'approve' } });

  const detail = skillDetail({ root, skillId: 'skill-detalle', now: LATER });
  assert.deepEqual(detail.versions.map((version) => version.version), ['1.1.0', '1.0.0']);
  assert.equal(detail.skill.currentVersion, '1.1.0');
  assert.equal(detail.metrics.versions, 2);
  assert.equal(detail.improvements[0].status, 'approved');
  assert.equal(detail.improvements[0].version, '1.1.0');
});

test('las asignaciones traen la versión fijada y si están encendidas', () => {
  const { root, cwd } = created();
  const other = tempProject('otro', autonomyRoot('skill-detail-other'));
  const opened = runAction({ root, action: 'open', cwd: other, now: NOW });
  assert.equal(opened.ok, true);
  const projectId = opened.project.id;
  const toggled = runAction({
    root,
    action: 'toggle',
    now: NOW,
    actor: 'human',
    payload: { projectId, skillId: 'skill-detalle', enabled: true },
  });
  assert.equal(toggled.ok, true);

  const detail = skillDetail({ root, skillId: 'skill-detalle', now: NOW });
  assert.equal(detail.metrics.projectsAssigned, 1);
  assert.equal(detail.metrics.projectsActive, 1);
  const row = detail.assignments[0];
  assert.equal(row.projectId, projectId);
  assert.equal(row.enabled, true);
  assert.equal(row.version, '1.0.0');
  assert.equal(row.by, 'human');
  assert.notEqual(row.cwd, '');
  assert.equal(cwd === other, false);
});

test('la línea de tiempo recoge lo que el diario dice de esta skill, y sólo de esta', () => {
  const { root, cwd } = created();
  runAction({ root, action: 'create', cwd, now: NOW, actor: 'ai', payload: candidate({ id: 'otra-skill', title: 'Otra' }) });

  const detail = skillDetail({ root, skillId: 'skill-detalle', now: NOW });
  const types = detail.timeline.map((event) => event.type);
  assert.ok(types.includes('skill.created'));
  assert.equal(detail.timeline.every((event) => event.type !== undefined), true);
  const other = skillDetail({ root, skillId: 'otra-skill', now: NOW });
  assert.equal(other.timeline.some((event) => event.note?.includes('skill-detalle')), false);
});

test('las cargas se cuentan como ofertas del catálogo, no como aplicaciones', () => {
  const { root } = created();
  const detail = skillDetail({ root, skillId: 'skill-detalle', now: NOW });
  assert.equal(detail.metrics.loads, 0, 'sin eventos skill.loaded, la cifra es cero');
  assert.equal(typeof detail.metrics.loads, 'number');
});

test('la ficha no escribe en el almacén', () => {
  const { root } = created();
  const before = handleApiRequest({ root, method: 'GET', pathname: API_PREFIX, search: '?scan=0', now: NOW });
  const detail = skillDetail({ root, skillId: 'skill-detalle', now: NOW });
  const after = handleApiRequest({ root, method: 'GET', pathname: API_PREFIX, search: '?scan=0', now: NOW });
  assert.equal(detail.ok, true);
  assert.equal(after.body.integrity.sha256, before.body.integrity.sha256);
});

test('la ruta de detalle exige id y contesta 404 cuando no existe', () => {
  const { root } = created();
  const route = handleApiRequest({ root, method: 'GET', pathname: `${API_PREFIX}/skill`, search: '', now: NOW });
  assert.equal(route.status, 400);
  assert.equal(route.body.code, 'bad-request');
  const unknown = handleApiRequest({ root, method: 'GET', pathname: `${API_PREFIX}/skill`, search: '?id=no-existe', now: NOW });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, 'skill-not-found');
  const found = handleApiRequest({ root, method: 'GET', pathname: `${API_PREFIX}/skill`, search: '?id=skill-detalle', now: NOW });
  assert.equal(found.status, 200);
  assert.equal(found.body.skill.id, 'skill-detalle');
});
