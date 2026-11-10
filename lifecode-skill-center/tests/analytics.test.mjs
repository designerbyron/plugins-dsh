// Analítica con filtros: el panel puede mirar un proyecto o una skill, y esa vista tiene que ser la misma
// contabilidad acotada, no una segunda verdad. Estas pruebas fijan qué significa cada cifra al filtrar.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarize } from '../lib/analytics.mjs';

const NOW = '2026-11-09T12:00:00.000Z';

function state() {
  const today = '2026-11-09';
  return {
    schemaVersion: 2,
    skills: {
      alfa: {
        id: 'alfa',
        title: 'Alfa',
        status: 'published',
        currentVersion: '1.1.0',
        versions: [
          { version: '1.0.0', evaluation: { score: 100 } },
          { version: '1.1.0', evaluation: { score: 80 } },
        ],
      },
      beta: {
        id: 'beta',
        title: 'Beta',
        status: 'published',
        currentVersion: '1.0.0',
        versions: [{ version: '1.0.0', evaluation: { score: 60 } }],
      },
    },
    projects: {
      'proj-a': { id: 'proj-a', name: 'A', cwd: 'C:/a' },
      'proj-b': { id: 'proj-b', name: 'B', cwd: 'C:/b' },
    },
    assignments: {
      'proj-a': { alfa: { enabled: true, version: '1.0.0' } },
      'proj-b': { alfa: { enabled: true, version: '1.1.0' }, beta: { enabled: false, version: '1.0.0' } },
    },
    improvements: {
      'imp-1': { id: 'imp-1', skillId: 'alfa', status: 'proposed' },
      'imp-2': { id: 'imp-2', skillId: 'beta', status: 'approved' },
    },
    events: [
      { id: 'e1', at: `${today}T10:00:00.000Z`, type: 'skill.loaded', skillId: 'alfa', projectId: 'proj-a' },
      { id: 'e2', at: `${today}T11:00:00.000Z`, type: 'skill.loaded', skillId: 'alfa', projectId: 'proj-b' },
      { id: 'e3', at: `${today}T12:00:00.000Z`, type: 'skill.loaded', skillId: 'beta', projectId: 'proj-b' },
      { id: 'e4', at: `${today}T09:00:00.000Z`, type: 'skill.assigned', skillId: 'alfa', projectId: 'proj-b' },
    ],
  };
}

test('sin filtros resume la biblioteca entera', () => {
  const view = summarize(state(), { now: NOW });
  assert.equal(view.skills.total, 2);
  assert.equal(view.skills.versions, 3);
  assert.equal(view.projects.registered, 2);
  assert.equal(view.assignments.total, 3);
  assert.equal(view.assignments.active, 2);
  assert.equal(view.improvements.total, 2);
  assert.equal(view.loads, 3);
  assert.equal(view.quality.average, 70);
});

test('filtrar por proyecto cuenta sólo lo de ese proyecto', () => {
  const view = summarize(state(), { now: NOW, projectId: 'proj-a' });
  assert.equal(view.skills.total, 1, 'skills del proyecto: sólo las asignadas');
  assert.equal(view.projects.registered, 2, 'el censo de proyectos no cambia al filtrar');
  assert.equal(view.assignments.total, 1);
  assert.equal(view.assignments.active, 1);
  assert.equal(view.loads, 1, 'sólo la carga de alfa en A');
  assert.deepEqual(view.topSkills.map((row) => row.id), ['alfa']);
  assert.equal(view.improvements.total, 1, 'la mejora de la skill asignada');

  const other = summarize(state(), { now: NOW, projectId: 'proj-b' });
  assert.equal(other.assignments.total, 2);
  assert.equal(other.assignments.active, 1);
  assert.equal(other.assignments.paused, 1);
  assert.equal(other.loads, 2);
  assert.equal(other.skills.total, 2);
});

test('filtrar por skill mantiene sus asignaciones en todos los proyectos', () => {
  const view = summarize(state(), { now: NOW, skillId: 'alfa' });
  assert.equal(view.skills.total, 1);
  assert.equal(view.assignments.total, 2, 'alfa está en A y en B');
  assert.equal(view.assignments.active, 2);
  assert.equal(view.loads, 2);
  assert.equal(view.improvements.total, 1);
  assert.equal(view.quality.average, 80, 'alfa en su versión vigente: 80');
});

test('proyecto y skill a la vez acotan las dos cosas', () => {
  const view = summarize(state(), { now: NOW, projectId: 'proj-b', skillId: 'alfa' });
  assert.equal(view.skills.total, 1);
  assert.equal(view.assignments.total, 1);
  assert.equal(view.loads, 1);
  assert.equal(view.improvements.total, 1);

  const empty = summarize(state(), { now: NOW, projectId: 'proj-a', skillId: 'beta' });
  assert.equal(empty.assignments.total, 0);
  assert.equal(empty.loads, 0);
  assert.equal(empty.skills.total, 1, 'la skill pedida sigue describiéndose');
  assert.equal(empty.quality.average, 60, 'beta sigue midiéndose aunque el proyecto no la tenga');
});

test('un proyecto inexistente devuelve cifras vacías, no las globales', () => {
  const view = summarize(state(), { now: NOW, projectId: 'no-existe' });
  assert.equal(view.assignments.total, 0);
  assert.equal(view.loads, 0);
  assert.equal(view.skills.total, 0);
  assert.equal(view.quality.measured, 0);
  assert.equal(view.quality.average, null);
});

test('la serie temporal también se acota', () => {
  const whole = summarize(state(), { now: NOW, days: 7 });
  const scoped = summarize(state(), { now: NOW, days: 7, projectId: 'proj-a' });
  const lastDay = whole.series.at(-1);
  const scopedDay = scoped.series.at(-1);
  assert.ok(scopedDay.loads <= lastDay.loads);
  assert.equal(scopedDay.loads, 1);
  assert.equal(whole.series.length, 7);
  assert.equal(scoped.series.length, 7);
});
