// Compuerta de autonomía (ADDENDUM A). El addendum autoriza a la IA a ejecutar el ciclo de vida de una
// Skill cuando hay evidencia suficiente, y prohíbe que lo haga por confianza subjetiva o contra una
// decisión humana. Estas pruebas fijan las dos mitades: lo que la IA puede hacer con evidencia y lo que
// sigue rechazando.
//
// Cada caso monta el escenario que necesita (asignación nunca tocada, encendida por una persona o
// apagada por una persona) porque la compuerta `human-veto` tiene precedencia: si el escenario apaga con
// una persona, el rechazo habla del veto y no de la evidencia, y la prueba dejaría de medir lo que dice.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';

import { runAction } from '../lib/api.mjs';
import { evaluateDecision, evidenceLevel } from '../lib/decisions.mjs';
import {
  emptyKnowledge, knowledgeFile, loadKnowledge, receiveInsight, recordDecision, setPolicy, withKnowledge,
} from '../lib/knowledge.mjs';
import { autonomyRoot, candidate, grantAutonomy, tempProject, tempRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';
const LATER = '2026-11-09T13:00:00.000Z';

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Siembra el registro de conocimiento con hallazgos verificados de fuentes distintas. */
function seedInsights(root, { sources = 2, prefix = 'ins', confidence = 'strong' } = {}) {
  const saved = withKnowledge(root, (document) => {
    for (let index = 0; index < sources; index += 1) {
      receiveInsight(document, {
        insightId: `${prefix}-${index}`,
        sourceAgent: `${prefix}-agent-${index}`,
        parentRunId: 'run-1',
        taskId: `task-${index}`,
        projectId: '',
        scope: 'global',
        category: 'procedure',
        title: `hallazgo ${index}`,
        summary: 'algo medido',
        details: 'el detalle',
        evidence: [{ source: 'tools/check.mjs', location: `línea ${index}`, verification: 'ejecuté la comprobación', result: 'pasa' }],
        confidence,
        suggestedAction: 'create-or-improve-skill',
      }, NOW);
    }
  }, { now: NOW });
  assert.equal(saved.ok, true, 'el registro de conocimiento tiene que poder sembrarse');
}

/**
 * Un centro con una skill publicada y una asignación en el estado que pida la prueba:
 * `on` la encendió una persona, `off` la apagó una persona (veto), `none` nadie la ha tocado.
 */
function scenario({ seed = 0, assignment = 'none', prefix = 'ins' } = {}) {
  const root = autonomyRoot('autonomy');
  const cwd = tempProject('autonomy', tempRoot('autonomy-cwd'));
  const created = runAction({ root, action: 'create', cwd, now: NOW, actor: 'ai', payload: candidate({ id: 'autonomy-skill' }) });
  assert.equal(created.ok, true, JSON.stringify(created));
  const project = runAction({ root, action: 'open', cwd, now: NOW }).project;
  const toggle = (enabled) => runAction({ root, action: 'toggle', now: NOW, actor: 'human', payload: { projectId: project.id, skillId: 'autonomy-skill', enabled } });
  if (assignment === 'on') toggle(true);
  if (assignment === 'off') {
    toggle(true);
    toggle(false);
  }
  if (seed > 0) seedInsights(root, { sources: seed, prefix });
  return { root, cwd, projectId: project.id, skillId: 'autonomy-skill' };
}

test('sin evidencia la IA no enciende ni apaga: la compuerta rechaza las dos direcciones', () => {
  const { root, projectId, skillId } = scenario();
  const enable = runAction({ root, action: 'toggle', now: LATER, actor: 'ai', payload: { projectId, skillId, enabled: true, insightIds: ['ins-0', 'ins-1'] } });
  assert.equal(enable.ok, false);
  assert.equal(enable.code, 'approval-required');
  assert.equal(enable.reason, 'insufficient-evidence');

  const state = runAction({ root, action: 'state', now: LATER, cwd: '' });
  assert.equal(state.assignments[projectId], undefined, 'no puede quedar una asignación creada por la IA');
});

test('con evidencia fuerte la IA enciende, apaga y cada movimiento deja su decisión registrada', () => {
  const { root, projectId, skillId } = scenario({ seed: 2 });
  const enabled = runAction({ root, action: 'toggle', now: LATER, actor: 'ai', payload: { projectId, skillId, enabled: true, insightIds: ['ins-0', 'ins-1'] } });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  assert.equal(enabled.evidenceLevel, 'strong');
  assert.equal(typeof enabled.decisionId, 'string');

  let state = runAction({ root, action: 'state', now: LATER, cwd: '' });
  assert.equal(state.assignments[projectId][skillId].enabled, true);
  assert.equal(state.assignments[projectId][skillId].by, 'ai', 'el registro dice que la encendió la IA');

  const disabled = runAction({ root, action: 'toggle', now: LATER, actor: 'ai', payload: { projectId, skillId, enabled: false, insightIds: ['ins-0', 'ins-1'] } });
  assert.equal(disabled.ok, true, JSON.stringify(disabled));
  state = runAction({ root, action: 'state', now: LATER, cwd: '' });
  assert.equal(state.assignments[projectId][skillId].enabled, false);

  const knowledge = loadKnowledge(root).document;
  const activate = knowledge.decisions.find((item) => item.decisionId === enabled.decisionId);
  const deactivate = knowledge.decisions.find((item) => item.decisionId === disabled.decisionId);
  assert.equal(activate.outcome, 'activate');
  assert.equal(deactivate.outcome, 'deactivate');
  assert.equal(activate.actor, 'ai');
  assert.equal(activate.evidenceLevel, 'strong');
  assert.equal(activate.rollback.available, true, 'la decisión dice cómo revertirse');
  assert.equal(activate.projectId, projectId);
});

test('con una sola fuente la evidencia es moderada: puede preparar, no activar', () => {
  const { root, projectId, skillId } = scenario({ seed: 1 });
  const knowledge = loadKnowledge(root).document;
  const level = evidenceLevel({ insights: knowledge.insights });
  assert.equal(level.level, 'moderate');

  const activate = runAction({ root, action: 'toggle', now: LATER, actor: 'ai', payload: { projectId, skillId, enabled: true, insightIds: ['ins-0', 'ins-1'] } });
  assert.equal(activate.ok, false);
  assert.equal(activate.reason, 'insufficient-evidence');

  const improve = runAction({ root, action: 'improve', now: LATER, actor: 'ai', payload: { skillId, rationale: 'una razón suficientemente larga para proponer una mejora' } });
  assert.equal(improve.ok, true, 'preparar no cambia lo que ejecuta ningún proyecto');
  assert.equal(typeof improve.decisionId, 'string');
});

test('una decisión humana en contra manda sobre la evidencia de la IA', () => {
  const { root, projectId, skillId } = scenario({ seed: 2, assignment: 'off' });
  const refused = runAction({ root, action: 'toggle', now: LATER, actor: 'ai', payload: { projectId, skillId, enabled: true, insightIds: ['ins-0', 'ins-1'] } });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'human-decision');
  const state = runAction({ root, action: 'state', now: LATER, cwd: '' });
  assert.equal(state.assignments[projectId][skillId].enabled, false);
  assert.equal(state.assignments[projectId][skillId].by, 'human');
});

test('la política por proyecto puede devolver la decisión a la persona', () => {
  const { root, projectId, skillId } = scenario({ seed: 2 });
  const policy = withKnowledge(root, (document) => setPolicy(document, { projectId, mode: 'human-approved', by: 'human' }, NOW), { now: NOW });
  assert.equal(policy.ok, true);

  const refused = runAction({ root, action: 'toggle', now: LATER, actor: 'ai', payload: { projectId, skillId, enabled: true, insightIds: ['ins-0', 'ins-1'] } });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'policy-human-approved');

  // La IA no puede darse autonomía a sí misma: la mutación se rechaza y no se guarda nada.
  const selfGranted = withKnowledge(root, (document) => setPolicy(document, { projectId, mode: 'guarded-autonomous', actor: 'ai' }, NOW), { now: NOW });
  assert.equal(selfGranted.result.ok, false);
  assert.equal(selfGranted.result.code, 'approval-required');
  assert.equal(selfGranted.saved, false, 'un rechazo no puede cambiar el registro');
  assert.equal(loadKnowledge(root).document.policy.projects[projectId].mode, 'human-approved');
});

test('publicar y avanzar el pin exigen evidencia fuerte y evaluación satisfactoria', () => {
  const { root, projectId, skillId } = scenario({ seed: 1, assignment: 'on' });
  const betterBody = `${candidate().body}\n\n## Límite\n\nEl avance del pin lo decide una persona o la compuerta con evidencia fuerte; esta versión añade ese límite explícito.`;
  const weakPublish = runAction({ root, action: 'publish', now: LATER, actor: 'ai', payload: { id: skillId, body: betterBody, notes: 'mejora', insightIds: ['ins-0', 'ins-1'] } });
  assert.equal(weakPublish.ok, false);
  assert.equal(weakPublish.reason, 'insufficient-evidence');

  seedInsights(root, { sources: 2, prefix: 'extra' });
  const strongPublish = runAction({ root, action: 'publish', now: LATER, actor: 'ai', payload: { id: skillId, body: betterBody, notes: 'mejora', insightIds: ['ins-0', 'extra-1'] } });
  assert.equal(strongPublish.ok, true, JSON.stringify(strongPublish));
  assert.equal(typeof strongPublish.decisionId, 'string');

  const before = runAction({ root, action: 'state', now: LATER, cwd: '' });
  assert.notEqual(before.assignments[projectId][skillId].version, strongPublish.version.version, 'publicar no mueve el pin solo');

  const advanced = runAction({ root, action: 'advance', now: LATER, actor: 'ai', payload: { projectId, skillId, insightIds: ['ins-0', 'extra-1'] } });
  assert.equal(advanced.ok, true, JSON.stringify(advanced));
  assert.equal(advanced.updated.length, 1);
  assert.equal(advanced.updated[0].to, strongPublish.version.version);
});

test('el registro de decisiones es idempotente y no admite que la IA firme como humana', () => {
  const root = autonomyRoot('autonomy-ledger');
  const decision = {
    decisionId: 'dec-fixed', outcome: 'publish', skillId: 's', version: '1.0.1', evidenceLevel: 'strong', justification: 'medido', actor: 'ai', at: NOW,
  };
  const first = withKnowledge(root, (document) => recordDecision(document, decision, NOW), { now: NOW });
  assert.equal(first.result.ok, true);
  assert.equal(first.result.duplicate, false);
  const second = withKnowledge(root, (document) => recordDecision(document, decision, NOW), { now: NOW });
  assert.equal(second.result.duplicate, true);
  assert.equal(loadKnowledge(root).document.decisions.length, 1);

  const forged = withKnowledge(root, (document) => recordDecision(document, { ...decision, decisionId: 'dec-human', actor: 'human' }, NOW), { now: NOW });
  assert.equal(forged.result.ok, false);
  assert.equal(forged.result.code, 'decision-actor-invalid');
});

test('leer el registro no lo crea, y un registro corrupto no se sobrescribe', () => {
  const root = tempRoot('autonomy-store');
  const loaded = loadKnowledge(root);
  assert.equal(loaded.integrity, 'missing');
  assert.equal(existsSync(knowledgeFile(root)), false, 'leer no puede crear el fichero');

  writeFileSync(knowledgeFile(root), '{ esto no es json', 'utf8');
  const broken = loadKnowledge(root);
  assert.equal(broken.integrity, 'unreadable');
  const before = sha(knowledgeFile(root));
  const refused = withKnowledge(root, (document) => receiveInsight(document, { insightId: 'x', title: 'x' }, NOW), { now: NOW });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'store-unreadable');
  assert.equal(sha(knowledgeFile(root)), before, 'el documento ilegible se deja intacto');
});

test('la compuerta es determinista y explica qué compuerta falló', () => {
  const root = autonomyRoot('autonomy-gates');
  const cwd = tempProject('autonomy-gates', tempRoot('autonomy-gates-cwd'));
  runAction({ root, action: 'create', cwd, now: NOW, actor: 'human', payload: candidate({ id: 'gate-skill' }) });
  const project = runAction({ root, action: 'open', cwd, now: NOW }).project;
  const state = runAction({ root, action: 'state', now: NOW, cwd: '' });
  const evaluation = evaluateDecision({
    state,
    knowledge: loadKnowledge(root).document,
    operation: 'activate',
    skillId: 'gate-skill',
    projectId: project.id,
    now: NOW,
  });
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.code, 'insufficient-evidence');
  assert.ok(evaluation.gates.some((gate) => gate.id === 'evidence' && gate.ok === false));
  assert.match(evaluation.justification, /rechazada/);
});
