// Contrato corregido de la ronda 11: estas pruebas certifican que los abusos que el Red Team
// reprodujo en `tests/historical/redteam-*.historical.mjs` ya no funcionan. Cada caso mide la
// conducta protegida, no la implementación: el payload no firma evidencia, dos copias del mismo
// hallazgo no son dos fuentes, una contradicción no eleva la confianza y la aprobación de la IA
// queda firmada como IA.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAction } from '../lib/api.mjs';
import { evidenceLevel } from '../lib/decisions.mjs';
import { emptyKnowledge, loadKnowledge, receiveInsight, withKnowledge } from '../lib/knowledge.mjs';
import { candidate, tempProject, tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';
const LATER = '2026-11-09T13:00:00.000Z';

function seed(root, insights) {
  const saved = withKnowledge(root, (document) => {
    for (const insight of insights) receiveInsight(document, insight, NOW);
  }, { now: NOW });
  assert.equal(saved.ok, true, 'el registro tiene que poder sembrarse');
}

function insightOne(id, overrides = {}) {
  return {
    insightId: id,
    sourceAgent: `${id}-agent`,
    parentRunId: 'run-1',
    taskId: 'task-1',
    projectId: '',
    scope: 'global',
    category: 'procedure',
    title: 'el despliegue falla sin la ruta de datos',
    summary: 'se midió el fallo dos veces',
    details: 'el detalle',
    evidence: [{ source: 'tools/e2e.mjs', location: 'proyecto A', verification: 'ejecuté la suite', result: 'falla' }],
    confidence: 'strong',
    suggestedAction: 'create-or-improve-skill',
    ...overrides,
  };
}

function centre({ insights = [] } = {}) {
  const root = autonomyRoot('redteam-fixed');
  const cwd = tempProject('proyecto', autonomyRoot('redteam-fixed-cwd'));
  if (insights.length > 0) seed(root, insights);
  const created = runAction({ root, action: 'create', cwd, now: NOW, actor: 'ai', payload: candidate({ id: 'skill-a' }) });
  assert.equal(created.ok, true, JSON.stringify(created));
  const project = runAction({ root, action: 'open', cwd, now: NOW }).project;
  return { root, cwd, project, skillId: 'skill-a' };
}

test('RT-D2 · el payload no firma evidencia: explicitRequest se ignora y sin hallazgos no activa', () => {
  const { root, project, skillId } = centre();
  const toggled = runAction({
    root, action: 'toggle', now: NOW, actor: 'ai',
    payload: { projectId: project.id, skillId, enabled: true, explicitRequest: true },
  });
  assert.equal(toggled.ok, false, 'la IA no puede activar por una firma que ella misma pone');
  assert.equal(toggled.code, 'approval-required');
  const gates = new Map((toggled.gates ?? []).map((gate) => [gate.id, gate.ok]));
  assert.equal(gates.get('evidence'), false, 'la compuerta de evidencia tiene que rechazar');
});

test('RT-D4 · dos copias del mismo hallazgo son una sola observación', () => {
  const root = autonomyRoot('redteam-dedupe');
  seed(root, [insightOne('ins-1'), insightOne('ins-2')]);
  const stored = loadKnowledge(root);
  const level = evidenceLevel({ insights: stored.document.insights, explicitRequest: false });
  assert.equal(level.level, 'moderate', 'dos copias idénticas son una sola observación');
});

test('RT-D4 · una contradicción sobre el mismo punto no eleva la confianza', () => {
  const root = autonomyRoot('redteam-contradiction');
  seed(root, [
    insightOne('ins-1'),
    insightOne('ins-2', {
      sourceAgent: 'otro-agente',
      evidence: [{ source: 'tools/e2e.mjs', location: 'proyecto A', verification: 'ejecuté la suite', result: 'pasa' }],
    }),
  ]);
  const stored = loadKnowledge(root);
  const level = evidenceLevel({ insights: stored.document.insights, explicitRequest: false });
  assert.equal(level.level, 'weak', 'una contradicción no eleva la confianza');
  assert.match(String(level.reason ?? ''), /contradic/iu);
});

test('RT-D1 · aprobar la mejora de una skill no puede evaluar otra: el skillId del payload se rechaza', () => {
  const { root, cwd, project, skillId } = centre({
    insights: [
      insightOne('ins-1'),
      insightOne('ins-2', {
        sourceAgent: 'agente-2',
        title: 'el resumen del despliegue mejora con una sección de límites',
        summary: 'medido en dos proyectos',
        evidence: [{ source: 'tools/check.mjs', location: 'salida completa', verification: 'comparé antes y después', result: 'pasa' }],
      }),
    ],
  });
  const toggled = runAction({ root, action: 'toggle', now: NOW, actor: 'human', payload: { projectId: project.id, skillId, enabled: true } });
  assert.equal(toggled.ok, true, JSON.stringify(toggled));
  const improved = runAction({
    root, action: 'improve', cwd, now: LATER, actor: 'ai',
    payload: { skillId, ...candidate({ description: 'Compila y verifica una skill de DSH desde cero, dejando evidencia de cada paso y una sección de límites.' }) },
  });
  assert.equal(improved.ok, true, JSON.stringify(improved));
  const improvementId = improved.improvement?.id ?? improved.id;
  assert.ok(improvementId, 'la mejora tiene que traer id');
  const decoy = runAction({
    root, action: 'decide', now: LATER, actor: 'ai',
    payload: { improvementId, decision: 'approve', skillId: 'otra-skill' },
  });
  assert.equal(decoy.ok, false, 'la compuerta no puede mirar el skillId del payload');
  assert.equal(decoy.code, 'skill-mismatch');
});

test('RT-D7 · una aprobación de la IA queda firmada como IA', () => {
  const { root, cwd, project, skillId } = centre({
    insights: [
      insightOne('ins-1'),
      insightOne('ins-2', {
        sourceAgent: 'agente-2',
        title: 'el resumen del despliegue mejora con una sección de límites',
        summary: 'medido en dos proyectos',
        evidence: [{ source: 'tools/check.mjs', location: 'salida completa', verification: 'comparé antes y después', result: 'pasa' }],
      }),
    ],
  });
  runAction({ root, action: 'toggle', now: NOW, actor: 'human', payload: { projectId: project.id, skillId, enabled: true } });
  const improved = runAction({
    root, action: 'improve', cwd, now: LATER, actor: 'ai',
    payload: { skillId, ...candidate({ description: 'Compila y verifica una skill de DSH desde cero, dejando evidencia de cada paso y una sección de límites.' }) },
  });
  const improvementId = improved.improvement?.id ?? improved.id;
  const decided = runAction({ root, action: 'decide', now: LATER, actor: 'ai', payload: { improvementId, decision: 'approve', insightIds: ['ins-1', 'ins-2'] } });
  assert.equal(decided.ok, true, JSON.stringify(decided));
  const stored = loadKnowledge(root);
  const decision = (stored.document.decisions ?? []).find((entry) => entry.outcome === 'approve');
  assert.ok(decision, 'la aprobación autónoma tiene que quedar en el registro');
  assert.equal(decision.actor, 'ai', 'la IA no puede firmar como persona');
});
