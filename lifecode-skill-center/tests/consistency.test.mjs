import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildSnapshot, runAction, doctorPayload } from '../lib/api.mjs';
import { loadState, centerFile } from '../lib/state.mjs';
import { candidate, tempProject, tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';

// QA de coherencia: los números que el panel enseña (biblioteca, analítica, matriz de adopción) tienen que
// salir del mismo documento y no contradecirse. Estas comprobaciones se hacen sobre un centro sembrado con
// acciones reales, para que un cambio de contabilidad rompa la prueba y no una captura de pantalla.
function seed() {
  const root = autonomyRoot('lsc-consistency');
  const cwdA = tempProject('proyecto-a', root);
  const cwdB = tempProject('proyecto-b', root);

  runAction({ root, action: 'open', cwd: cwdA, now: NOW, actor: 'human' });
  runAction({ root, action: 'open', cwd: cwdB, now: NOW, actor: 'human' });

  const created = runAction({ root, action: 'create', payload: candidate(), actor: 'ai', cwd: cwdA, now: NOW });
  assert.equal(created.ok, true, JSON.stringify(created).slice(0, 300));

  const state = loadState(root).state;
  const projectA = Object.values(state.projects).find((project) => project.cwd === cwdA.replaceAll('\\', '/'));
  const projectB = Object.values(state.projects).find((project) => project.cwd === cwdB.replaceAll('\\', '/'));

  for (const projectId of [projectA.id, projectB.id]) {
    const toggled = runAction({ root, action: 'toggle', payload: { projectId, skillId: created.id, enabled: true }, now: NOW, actor: 'human', cwd: cwdA });
    assert.equal(toggled.ok, true, JSON.stringify(toggled).slice(0, 300));
  }

  const improved = runAction({
    root,
    action: 'improve',
    payload: { skillId: created.id, rationale: 'añade un límite explícito', body: `## Procedimiento\n\n${'Paso medido. '.repeat(12)}\n\n## Limite\n\nUna carga no prueba aplicación.` },
    actor: 'ai',
    cwd: cwdA,
    now: NOW,
  });
  assert.equal(improved.ok, true, JSON.stringify(improved).slice(0, 300));

  return { root, cwdA, projectA, projectB, created, improvementId: improved.improvementId };
}

test('los números del panel salen del mismo documento y no se contradicen', () => {
  const { root, cwdA, projectA, projectB, created } = seed();
  const snapshot = buildSnapshot({ root, cwd: cwdA, now: NOW, scan: false });
  const state = loadState(root).state;

  assert.equal(snapshot.skills.length, 1);
  assert.equal(snapshot.skills.length, snapshot.analytics.skills.total);
  assert.equal(snapshot.skills[0].versions.length, snapshot.analytics.skills.versions);
  assert.equal(snapshot.projects.length, snapshot.analytics.projects.registered);
  assert.equal(snapshot.projects.length, 2);

  const adoption = snapshot.skills[0].adoption;
  assert.equal(adoption.length, 2, 'una fila por proyecto que tiene la skill');
  assert.equal(adoption.filter((row) => row.enabled === true).length, snapshot.analytics.assignments.active);
  assert.deepEqual(snapshot.skills[0].enabledIn, [projectA.id, projectB.id]);
  assert.equal(snapshot.analytics.assignments.total, 2);

  // La calidad media es la de la versión vigente, no la del historial.
  const measured = snapshot.skills.filter((skill) => skill.current?.evaluation !== undefined);
  const average = Math.round(measured.reduce((total, skill) => total + Number(skill.current.evaluation.score ?? 0), 0) / measured.length);
  assert.equal(snapshot.analytics.quality.average, average);
  assert.equal(snapshot.analytics.quality.measured, measured.length);

  // Propuestas pendientes: mismo número en la instantánea, en la analítica y en el documento.
  const pending = Object.values(state.improvements).filter((entry) => entry.status === 'proposed').length;
  assert.equal(snapshot.analytics.improvements.proposed, pending);
  assert.equal(snapshot.improvements.filter((entry) => entry.status === 'proposed').length, pending);

  // Las cargas son eventos del catálogo, no usos: se cuentan del diario, no se inventan.
  const loads = state.events.filter((event) => event.type === 'skill.loaded').length;
  assert.equal(snapshot.analytics.loads, loads);

  // El detalle de la skill cuenta lo mismo que la biblioteca.
  const detail = buildSnapshot({ root, cwd: cwdA, now: NOW, scan: false }).skills[0];
  assert.equal(detail.id, created.id);
  assert.equal(detail.adoption.length, adoption.length);
});

test('el diagnóstico y la lectura no escriben el almacén', async () => {
  const { root, cwdA } = seed();
  const file = centerFile(root);
  const before = readFileSync(file);

  buildSnapshot({ root, cwd: cwdA, now: NOW, scan: false });
  buildSnapshot({ root, cwd: cwdA, now: NOW, scan: true });

  const doctor = await doctorPayload({ root, registry: null, now: NOW });
  assert.equal(doctor.summary.fail, 0);
  assert.ok(doctor.checks.some((check) => check.id === 'store-integrity' && check.status === 'ok'));

  const after = readFileSync(file);
  assert.equal(Buffer.compare(before, after), 0, 'leer el catálogo, el estado y el diagnóstico no puede escribir');
});

test('un centro ilegible no publica cifras falsas', async () => {
  const { root, cwdA } = seed();
  const file = centerFile(root);
  const before = readFileSync(file);
  // Se trunca una copia en el sitio: es la única forma de que la instantánea tenga que defenderse.
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, before.subarray(0, Math.floor(before.length / 2)));

  const snapshot = buildSnapshot({ root, cwd: cwdA, now: NOW, scan: false });
  assert.equal(snapshot.readable, false);
  assert.equal(snapshot.skills.length, 0, 'un documento ilegible no se presenta como biblioteca vacía legítima');

  const doctor = await doctorPayload({ root, registry: null, now: NOW });
  assert.equal(doctor.summary.fail, 1);
  assert.equal(doctor.checks.find((check) => check.id === 'store-integrity').status, 'fail');
});
