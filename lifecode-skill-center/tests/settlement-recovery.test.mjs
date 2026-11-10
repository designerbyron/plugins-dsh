// RT-D3: autorizar no es ejecutar. El asiento tiene que dejar rastro recuperable cuando la
// ejecución no llega a terminar, y no puede contradecirse en un segundo asiento.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { knowledgeView, runAction } from '../lib/api.mjs';
import {
  loadKnowledge,
  receiveInsight,
  recordDecision,
  settleDecision,
  unsettledDecisions,
  withKnowledge,
} from '../lib/knowledge.mjs';
import { candidate, tempProject, autonomyRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';
const LATER = '2026-11-09T13:00:00.000Z';

function seedInsights(root, prefix = 'ins') {
  withKnowledge(root, (document) => {
    for (let index = 0; index < 2; index += 1) {
      receiveInsight(document, {
        insightId: `${prefix}-${index}`,
        sourceAgent: `${prefix}-agent-${index}`,
        evidence: [{ source: 'tools/check.mjs', location: `línea ${index}`, verification: 'ejecuté la comprobación', result: 'pasa' }],
        category: 'procedure',
        title: `hallazgo ${index}`,
        summary: 'algo medido',
        details: 'el detalle',
        confidence: 'strong',
      }, NOW);
    }
  }, { now: NOW });
}

function centerWithProject() {
  const root = autonomyRoot('settlement');
  const cwd = tempProject('settlement-a', autonomyRoot('settlement-cwd'));
  const created = runAction({ root, action: 'create', cwd, now: NOW, actor: 'ai', payload: candidate({ id: 'settlement-skill' }) });
  assert.equal(created.ok, true, JSON.stringify(created));
  const project = runAction({ root, action: 'open', cwd, now: NOW }).project;
  seedInsights(root);
  return { root, cwd, project, skillId: 'settlement-skill' };
}

test('RT-D3 · una autorización interrumpida queda como pendiente recuperable', () => {
  const { root, project, skillId } = centerWithProject();
  // Simula la compuerta que registró y el proceso que murió antes de firmar el asiento.
  const recorded = withKnowledge(root, (document) => recordDecision(document, {
    decisionId: 'dec-interrumpida',
    operation: 'activate',
    skillId,
    projectId: project.id,
    actor: 'ai',
    outcome: 'activate',
    level: 'strong',
    justification: 'dos hallazgos verificados',
    rollback: 'desactivar de nuevo en el proyecto',
  }, LATER), { now: LATER });
  assert.equal(recorded.ok, true, JSON.stringify(recorded));

  const pending = unsettledDecisions(loadKnowledge(root).document);
  assert.equal(pending.length, 1, 'el pendiente tiene que poder reconstruirse desde el almacén');
  assert.equal(pending[0].decisionId, 'dec-interrumpida');
  assert.equal(pending[0].operation, 'activate', 'el asiento expone su resultado como operación');
  assert.equal(pending[0].projectId, project.id);

  const view = knowledgeView({ root, now: LATER });
  assert.equal(view.pendingSettlements.length, 1, 'la vista lo publica para que alguien lo vea');
  assert.equal(view.pendingSettlements[0].decisionId, 'dec-interrumpida');
});

test('RT-D3 · cuando la operación termina, deja de estar pendiente', () => {
  const { root, cwd, project, skillId } = centerWithProject();
  const enabled = runAction({
    root,
    action: 'toggle',
    cwd,
    now: LATER,
    actor: 'ai',
    payload: { projectId: project.id, skillId, enabled: true, insightIds: ['ins-0', 'ins-1'] },
  });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  assert.ok(enabled.decisionId, 'la compuerta firma la decisión');

  const pending = unsettledDecisions(loadKnowledge(root).document);
  assert.equal(pending.length, 0, 'un asiento cerrado no puede seguir apareciendo como pendiente');

  const decision = loadKnowledge(root).document.decisions.find((item) => item.decisionId === enabled.decisionId);
  assert.equal(decision.settled.ok, true);
  assert.equal(decision.settled.detail, 'ok');
});

test('RT-D3 · un segundo asiento no puede contradecir al primero', () => {
  const { root, project, skillId } = centerWithProject();
  withKnowledge(root, (document) => recordDecision(document, {
    decisionId: 'dec-conflicto',
    operation: 'activate',
    skillId,
    projectId: project.id,
    actor: 'ai',
    outcome: 'activate',
    level: 'strong',
    justification: 'evidencia',
    rollback: 'desactivar',
  }, LATER), { now: LATER });

  const first = withKnowledge(root, (document) => settleDecision(document, { decisionId: 'dec-conflicto', ok: true, detail: 'ok' }, LATER), { now: LATER });
  assert.equal(first.ok, true, JSON.stringify(first));

  const again = withKnowledge(root, (document) => settleDecision(document, { decisionId: 'dec-conflicto', ok: true, detail: 'ok' }, LATER), { now: LATER });
  assert.equal(again.ok, true);
  assert.equal(again.saved, false, 'repetir el mismo asiento no escribe otra vez');

  const opposite = settleDecision(loadKnowledge(root).document, { decisionId: 'dec-conflicto', ok: false, detail: 'falló' }, LATER);
  assert.equal(opposite.ok, false);
  assert.equal(opposite.code, 'settled-conflict');

  const settled = loadKnowledge(root).document.decisions.find((item) => item.decisionId === 'dec-conflicto');
  assert.equal(settled.settled.ok, true, 'el asiento original se conserva: no se reescribe la historia');
});

test('RT-D3 · firmar exige un asiento conocido y un resultado booleano', () => {
  const { root } = centerWithProject();
  const document = loadKnowledge(root).document;
  const unknown = settleDecision(document, { decisionId: 'dec-que-no-existe', ok: true }, LATER);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'decision-not-found');

  withKnowledge(root, (inner) => recordDecision(inner, {
    decisionId: 'dec-sin-resultado',
    operation: 'activate',
    actor: 'ai',
    outcome: 'activate',
    level: 'strong',
    justification: 'evidencia',
    rollback: 'desactivar',
  }, LATER), { now: LATER });
  const noOutcome = settleDecision(loadKnowledge(root).document, { decisionId: 'dec-sin-resultado' }, LATER);
  assert.equal(noOutcome.ok, false);
  assert.equal(noOutcome.code, 'outcome-required');
});

test('RT-D3 · un reintento idempotente no deja asientos abiertos', () => {
  const { root, cwd, project, skillId } = centerWithProject();
  const first = runAction({
    root, action: 'toggle', cwd, now: LATER, actor: 'ai',
    payload: { projectId: project.id, skillId, enabled: true, insightIds: ['ins-0', 'ins-1'] },
  });
  assert.equal(first.ok, true, JSON.stringify(first));

  const retry = runAction({
    root, action: 'toggle', cwd, now: LATER, actor: 'ai',
    payload: { projectId: project.id, skillId, enabled: true, insightIds: ['ins-0', 'ins-1'] },
  });
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.unchanged, true, 'repetir el mismo estado no vuelve a ejecutar nada');

  const document = loadKnowledge(root).document;
  assert.equal(unsettledDecisions(document).length, 0);
  const closed = (document.decisions ?? []).filter((item) => item.settled !== null && item.settled !== undefined);
  assert.equal(closed.length, (document.decisions ?? []).length, 'todos los asientos de esta prueba tienen resultado');
});
