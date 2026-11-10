// Ronda 14 §7: ataques de seguridad sobre la autonomía. Cada caso intenta elevar privilegios con datos
// del llamador y mide que el producto no los acepta.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { knowledgeView, runAction } from '../lib/api.mjs';
import {
  loadKnowledge,
  receiveInsight,
  recordDecision,
  settleDecision,
  withKnowledge,
} from '../lib/knowledge.mjs';
import { autonomyRoot, candidate, tempProject, tempRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';
const LATER = '2026-11-09T13:00:00.000Z';

function seedInsights(root, prefix = 'atk', identical = false) {
  withKnowledge(root, (document) => {
    for (let index = 0; index < 2; index += 1) {
      receiveInsight(document, {
        insightId: `${prefix}-${index}`,
        sourceAgent: identical ? 'misma-fuente' : `fuente-${index}`,
        category: 'procedure',
        title: identical ? 'misma observación' : `hallazgo ${index}`,
        summary: identical ? 'idéntico' : `resumen ${index}`,
        details: 'detalle',
        evidence: identical
          ? [{ source: 'tools/check.mjs', location: 'línea 1', verification: 'ejecuté', result: 'pasa' }]
          : [{ source: 'tools/check.mjs', location: `línea ${index}`, verification: 'ejecuté', result: 'pasa' }],
        confidence: 'strong',
      }, NOW);
    }
  }, { now: NOW });
}

function centerWithProject() {
  const root = autonomyRoot('attacks');
  const cwd = tempProject('attacks-a', autonomyRoot('attacks-cwd'));
  const created = runAction({ root, action: 'create', cwd, now: NOW, actor: 'ai', payload: candidate({ id: 'attacks-skill' }) });
  assert.equal(created.ok, true, JSON.stringify(created));
  const project = runAction({ root, action: 'open', cwd, now: NOW }).project;
  seedInsights(root);
  return { root, cwd, project, skillId: 'attacks-skill' };
}

test('§7 · la IA no se concede política aunque lo pida con cuerpo de persona', () => {
  // Sin concesión previa: el almacén nace en el defecto seguro.
  const root = tempRoot('attacks-policy');
  const refused = runAction({
    root, action: 'policy', now: LATER, actor: 'ai',
    payload: { mode: 'guarded-autonomous', projectId: '', actor: 'human', by: 'human' },
  });
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.equal(refused.code, 'approval-required');
  assert.equal(knowledgeView({ root, now: LATER }).policy.mode, 'human-approved', 'sin concesión no hay autonomía');
});

test('§7 · el actor del payload no cambia quién firma', () => {
  const { root, cwd, project, skillId } = centerWithProject();
  const selfDeclared = runAction({
    root, action: 'toggle', cwd, now: LATER, actor: 'ai',
    payload: { projectId: project.id, skillId, enabled: true, actor: 'human', insightIds: ['atk-0', 'atk-1'] },
  });
  assert.equal(selfDeclared.ok, true, JSON.stringify(selfDeclared));
  const decision = loadKnowledge(root).document.decisions.find((item) => item.decisionId === selfDeclared.decisionId);
  assert.equal(decision.actor, 'ai', 'la firma del asiento es la del canal, no la del cuerpo');
});

test('§7 · `authorized: true` inyectado no salta la compuerta', () => {
  const { root, cwd, skillId } = centerWithProject();
  const attempted = runAction({
    root, action: 'publish', cwd, now: LATER, actor: 'ai',
    payload: { skillId, authorized: true, explicitRequest: true },
  });
  assert.equal(attempted.ok, false, JSON.stringify(attempted));
  assert.equal(attempted.code, 'approval-required', 'sin evaluación y sin evidencia citada no se publica');
});

test('§7 · evidencia duplicada no se convierte en dos observaciones', () => {
  const root = autonomyRoot('attacks-dup');
  const cwd = tempProject('attacks-dup-a', autonomyRoot('attacks-cwd'));
  const created = runAction({ root, action: 'create', cwd: cwd === '' ? '' : undefined, now: NOW, actor: 'ai', payload: candidate({ id: 'dup-skill' }) });
  assert.equal(created.ok, true, JSON.stringify(created));
  seedInsights(root, 'dup', true);
  const level = runAction({
    root, action: 'toggle', cwd, now: LATER, actor: 'ai',
    payload: { projectId: runAction({ root, action: 'open', cwd, now: NOW }).project.id, skillId: 'dup-skill', enabled: true, insightIds: ['dup-0', 'dup-1'] },
  });
  assert.equal(level.ok, false, JSON.stringify(level));
  // La negativa del motor se publica como `approval-required`; el motivo concreto viaja en `reason`.
  assert.ok(String(level.reason ?? '').includes('insufficient-evidence'), JSON.stringify(level));
});

test('§7 · un `decisionId` reutilizado no crea una segunda decisión', () => {
  const { root, project, skillId } = centerWithProject();
  const raw = {
    decisionId: 'dec-replay',
    operation: 'activate',
    skillId,
    projectId: project.id,
    actor: 'ai',
    outcome: 'activate',
    level: 'strong',
    justification: 'evidencia',
    rollback: 'desactivar',
  };
  const first = withKnowledge(root, (document) => recordDecision(document, raw, LATER), { now: LATER });
  assert.equal(first.ok, true, JSON.stringify(first));
  const replay = withKnowledge(root, (document) => recordDecision(document, raw, LATER), { now: LATER });
  assert.equal(replay.ok, true);
  assert.equal(replay.result?.duplicate, true, 'el replay es idempotente');
  assert.equal((loadKnowledge(root).document.decisions ?? []).filter((item) => item.decisionId === 'dec-replay').length, 1);
});

test('§7 · un asiento no se puede reescribir para tapar un fallo', () => {
  const { root, project, skillId } = centerWithProject();
  withKnowledge(root, (document) => recordDecision(document, {
    decisionId: 'dec-manipulado', operation: 'activate', skillId, projectId: project.id,
    actor: 'ai', outcome: 'activate', level: 'strong', justification: 'evidencia', rollback: 'desactivar',
  }, LATER), { now: LATER });
  withKnowledge(root, (document) => settleDecision(document, { decisionId: 'dec-manipulado', ok: false, detail: 'falló' }, LATER), { now: LATER });
  const manipulation = settleDecision(loadKnowledge(root).document, { decisionId: 'dec-manipulado', ok: true, detail: 'ok' }, LATER);
  assert.equal(manipulation.ok, false);
  assert.equal(manipulation.code, 'settled-conflict');
});

test('§7 · un hallazgo no puede declararse verificado a sí mismo', () => {
  const { root } = centerWithProject();
  const recorded = runAction({
    root, action: 'insight', now: LATER, actor: 'ai',
    payload: {
      insightId: 'atk-autofirma',
      title: 'me declaro verificado',
      category: 'observation',
      confidence: 'strong',
      origin: { verified: true, verifiedBy: 'subagents.listChildren' },
      sourceAgent: 'subagents.listChildren',
    },
  });
  assert.equal(recorded.ok, true, JSON.stringify(recorded));
  // El documento normalizado guarda los hallazgos como lista; el origen lo devuelve la propia acción.
  const insight = recorded.insight;
  assert.equal(insight.origin.verified, false, 'la verificación sólo la escribe la ruta del Host');
  assert.equal(insight.origin.verifiedBy, '');
  assert.equal(insight.origin.note, 'declarado por el emisor: el Host no lo ha verificado');
});

test('§7 · la IA no enciende un proyecto que no es el suyo, aunque lo nombre', () => {
  const { root, project, skillId } = centerWithProject();
  const otherCwd = tempProject('attacks-b', autonomyRoot('attacks-cwd'));
  const other = runAction({ root, action: 'open', cwd: otherCwd, now: NOW }).project;
  const attempted = runAction({
    root, action: 'toggle', cwd: otherCwd, now: LATER, actor: 'ai',
    payload: { projectId: project.id, skillId, enabled: true, insightIds: ['atk-0', 'atk-1'] },
  });
  assert.equal(attempted.ok, false, JSON.stringify(attempted));
  assert.equal(attempted.code, 'project-mismatch');
  const state = runAction({ root, action: 'state', now: LATER });
  assert.equal(state.assignments?.[other.id]?.[skillId], undefined, 'no se creó asignación en el proyecto nombrado');
});

test('§7 · repetir el asiento de un fallo no lo convierte en éxito', () => {
  const { root, project, skillId } = centerWithProject();
  withKnowledge(root, (document) => recordDecision(document, {
    decisionId: 'dec-fallo', operation: 'activate', skillId, projectId: project.id,
    actor: 'ai', outcome: 'activate', level: 'strong', justification: 'evidencia', rollback: 'desactivar',
  }, LATER), { now: LATER });
  withKnowledge(root, (document) => settleDecision(document, { decisionId: 'dec-fallo', ok: false, detail: 'publish-failed' }, LATER), { now: LATER });
  const again = withKnowledge(root, (document) => settleDecision(document, { decisionId: 'dec-fallo', ok: false, detail: 'publish-failed' }, LATER), { now: LATER });
  assert.equal(again.ok, true);
  assert.equal(again.saved, false);
  const settled = loadKnowledge(root).document.decisions.find((item) => item.decisionId === 'dec-fallo');
  assert.equal(settled.settled.ok, false, 'el fallo queda registrado');
});

