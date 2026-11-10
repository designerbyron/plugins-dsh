// RT-D3 y RT-D5: el asiento se cierra con el resultado real, y la IA sólo opera sobre el proyecto de su carpeta.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAction } from '../lib/api.mjs';
import { loadKnowledge, receiveInsight, withKnowledge } from '../lib/knowledge.mjs';
import { candidate, tempProject, tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';
const LATER = '2026-11-09T13:00:00.000Z';

/** Dos hallazgos de fuentes distintas: la compuerta los cuenta como dos observaciones. */
function seedInsights(root, prefix = 'ins') {
  withKnowledge(root, (document) => {
    for (let index = 0; index < 2; index += 1) {
      receiveInsight(document, {
        insightId: `${prefix}-${index}`,
        sourceAgent: `${prefix}-agent-${index}`,
        parentRunId: 'run-1',
        taskId: `task-${index}`,
        scope: 'global',
        category: 'procedure',
        title: `hallazgo ${index}`,
        summary: 'algo medido',
        details: 'el detalle',
        evidence: [{ source: 'tools/check.mjs', location: `línea ${index}`, verification: 'ejecuté la comprobación', result: 'pasa' }],
        confidence: 'strong',
      }, NOW);
    }
  }, { now: NOW });
}

/** Centro con una skill publicada y dos proyectos con carpetas distintas. */
function twoProjects() {
  const root = autonomyRoot('binding');
  const cwdA = tempProject('binding-a', autonomyRoot('binding-cwd'));
  const cwdB = tempProject('binding-b', autonomyRoot('binding-cwd'));
  const created = runAction({ root, action: 'create', cwd: cwdA, now: NOW, actor: 'ai', payload: candidate({ id: 'binding-skill' }) });
  assert.equal(created.ok, true, JSON.stringify(created));
  const projectA = runAction({ root, action: 'open', cwd: cwdA, now: NOW }).project;
  const projectB = runAction({ root, action: 'open', cwd: cwdB, now: NOW }).project;
  seedInsights(root);
  return { root, cwdA, cwdB, projectA, projectB, skillId: 'binding-skill' };
}

test('RT-D3 · el asiento guarda que la operación se ejecutó, no sólo que se autorizó', () => {
  const { root, cwdA, projectA, skillId } = twoProjects();
  const enabled = runAction({
    root,
    action: 'toggle',
    cwd: cwdA,
    now: LATER,
    actor: 'ai',
    payload: { projectId: projectA.id, skillId, enabled: true, insightIds: ['ins-0', 'ins-1'] },
  });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));

  const decision = loadKnowledge(root).document.decisions.find((item) => item.decisionId === enabled.decisionId);
  assert.equal(decision?.settled?.ok, true, 'el asiento tiene que decir que la operación terminó bien');
  assert.equal(decision.settled.detail, 'ok');
});

test('RT-D3 · si el producto rechaza la acción ya autorizada, el asiento queda fallido con su motivo', () => {
  const { root, cwdA, projectA, skillId } = twoProjects();
  // La compuerta autoriza (hay skill, proyecto y evidencia) pero el producto no puede revertir: sólo hay una
  // versión fijada. El asiento tiene que decir «fallida» y el motivo, no quedarse en «autorizada».
  const human = runAction({ root, action: 'toggle', now: LATER, actor: 'human', payload: { projectId: projectA.id, skillId, enabled: true } });
  assert.equal(human.ok, true, JSON.stringify(human));

  const rolled = runAction({
    root,
    action: 'rollback',
    cwd: cwdA,
    now: LATER,
    actor: 'ai',
    payload: { projectId: projectA.id, skillId, insightIds: ['ins-0', 'ins-1'] },
  });
  assert.equal(rolled.ok, false, JSON.stringify(rolled));
  assert.equal(rolled.code, 'no-previous-version');

  const decision = loadKnowledge(root).document.decisions.find((item) => item.decisionId === rolled.decisionId);
  assert.equal(decision, undefined, 'el rechazo no devuelve decisionId, así que no se puede mentir con uno');

  const settled = (loadKnowledge(root).document.decisions ?? []).filter((item) => item.settled !== null && item.settled !== undefined);
  const failed = settled.find((item) => item.settled.ok === false);
  assert.equal(failed?.settled?.detail, 'no-previous-version', 'el ledger distingue autorizar de ejecutar');
});

test('RT-D5 · la IA no puede encender un proyecto que no es el de su carpeta', () => {
  const { root, cwdA, projectB, skillId } = twoProjects();
  const foreign = runAction({
    root,
    action: 'toggle',
    cwd: cwdA,
    now: LATER,
    actor: 'ai',
    payload: { projectId: projectB.id, skillId, enabled: true, insightIds: ['ins-0', 'ins-1'] },
  });
  assert.equal(foreign.ok, false, JSON.stringify(foreign));
  assert.equal(foreign.code, 'project-mismatch');

  const state = runAction({ root, action: 'state', now: LATER, cwd: '' });
  assert.equal(state.assignments[projectB.id], undefined, 'no puede quedar una asignación ajena');
});

test('RT-D5 · sin proyecto en el payload, la IA opera sobre el de su carpeta', () => {
  const { root, cwdA, projectA, skillId } = twoProjects();
  const enabled = runAction({
    root,
    action: 'toggle',
    cwd: cwdA,
    now: LATER,
    actor: 'ai',
    payload: { skillId, enabled: true, insightIds: ['ins-0', 'ins-1'] },
  });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  const state = runAction({ root, action: 'state', now: LATER, cwd: '' });
  assert.equal(state.assignments[projectA.id][skillId].enabled, true);
});

test('RT-D5 · una persona sigue pudiendo alternar cualquier proyecto', () => {
  const { root, projectB, skillId } = twoProjects();
  const human = runAction({
    root,
    action: 'toggle',
    now: LATER,
    actor: 'human',
    payload: { projectId: projectB.id, skillId, enabled: true },
  });
  assert.equal(human.ok, true, JSON.stringify(human));
});
