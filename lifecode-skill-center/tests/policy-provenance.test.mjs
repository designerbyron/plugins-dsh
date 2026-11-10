import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyKnowledge,
  knowledgeSummary,
  loadKnowledge,
  policyFor,
  setPolicy,
  withKnowledge,
} from '../lib/knowledge.mjs';
import { evaluateDecision } from '../lib/decisions.mjs';
import { knowledgeView, runAction } from '../lib/api.mjs';
import { autonomyRoot, candidate, grantAutonomy, tempProject, tempRoot } from './helpers.mjs';

const GATE = {
  operation: 'activate',
  skillId: 'skill-de-prueba',
  projectId: 'proyecto-de-prueba',
  evaluation: { status: 'pass', score: 100 },
};

function gateOn(document, overrides = {}) {
  return evaluateDecision({
    state: {
      skills: { 'skill-de-prueba': { id: 'skill-de-prueba', currentVersion: '1.0.0', versions: [{ version: '1.0.0' }] } },
      projects: { 'proyecto-de-prueba': { id: 'proyecto-de-prueba', cwd: 'C:/x/proyecto-de-prueba' } },
      assignments: {},
      improvements: {},
      events: [],
    },
    knowledge: document,
    ...GATE,
    ...overrides,
  });
}

test('una concesión global con comprobante humano concede autonomía y se puede auditar', () => {
  const document = emptyKnowledge('2026-11-09T00:00:00.000Z');
  const saved = setPolicy(document, { mode: 'guarded-autonomous', actor: 'human', by: 'ana' }, '2026-11-09T10:00:00.000Z');
  assert.equal(saved.ok, true);
  assert.equal(document.policy.granted.by, 'ana');
  assert.equal(document.policy.granted.at, '2026-11-09T10:00:00.000Z');
  const effective = policyFor(document, 'cualquier-proyecto');
  assert.equal(effective.mode, 'guarded-autonomous');
  assert.equal(effective.source, 'global');
  assert.equal(effective.granted, true);
  assert.equal(effective.grantedAt, '2026-11-09T10:00:00.000Z');
  assert.equal(gateOn(document).gates.find((gate) => gate.id === 'policy').ok, true);
});

test('un valor global histórico sin comprobante es legacy-unverified y no concede autonomía', () => {
  // Así quedó el almacén real: el modo lo escribió el código, sin 'granted' ni evento humano.
  const document = emptyKnowledge('2026-11-09T00:00:00.000Z');
  document.policy.mode = 'guarded-autonomous';
  const effective = policyFor(document, 'proyecto-de-prueba');
  assert.equal(effective.source, 'legacy-unverified');
  assert.equal(effective.mode, 'human-approved', 'resuelve fail-closed');
  assert.equal(effective.storedMode, 'guarded-autonomous', 'conserva el dato original');
  const gate = gateOn(document);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'policy-human-approved');
  assert.equal(knowledgeSummary(document).policyProvenance, 'legacy-unverified');
  assert.equal(knowledgeSummary(document).legacyPolicy, true);
});

test('una concesión a medias (sin autor) tampoco vale como comprobante', () => {
  const document = emptyKnowledge('2026-11-09T00:00:00.000Z');
  document.policy.mode = 'guarded-autonomous';
  document.policy.granted = { at: '2026-11-09T10:00:00.000Z', by: '' };
  const effective = policyFor(document, '');
  assert.equal(effective.source, 'legacy-unverified');
  assert.equal(effective.mode, 'human-approved');
});

test('la política por proyecto manda sobre la global y no se hereda entre proyectos', () => {
  const document = emptyKnowledge('2026-11-09T00:00:00.000Z');
  setPolicy(document, { projectId: 'proyecto-a', mode: 'guarded-autonomous', actor: 'human', by: 'ana' }, '2026-11-09T10:00:00.000Z');
  assert.equal(policyFor(document, 'proyecto-a').source, 'project');
  assert.equal(policyFor(document, 'proyecto-a').mode, 'guarded-autonomous');
  // B no tiene política propia y el global está vacío: no hereda nada de A.
  const effectiveB = policyFor(document, 'proyecto-b');
  assert.equal(effectiveB.source, 'default');
  assert.equal(effectiveB.mode, 'human-approved');
});

test('sin política alguna, el defecto es human-approved y la IA no decide', () => {
  const document = emptyKnowledge('2026-11-09T00:00:00.000Z');
  assert.equal(policyFor(document, '').source, 'default');
  assert.equal(policyFor(document, '').mode, 'human-approved');
  const gate = gateOn(document);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'policy-human-approved');
});

test('el veto humano bloquea la reactivación aunque la política esté concedida', () => {
  const document = emptyKnowledge('2026-11-09T00:00:00.000Z');
  setPolicy(document, { mode: 'guarded-autonomous', actor: 'human', by: 'ana' }, '2026-11-09T10:00:00.000Z');
  const state = {
    skills: { 'skill-de-prueba': { id: 'skill-de-prueba', currentVersion: '1.0.0', versions: [{ version: '1.0.0' }] } },
    projects: { 'proyecto-de-prueba': { id: 'proyecto-de-prueba', cwd: 'C:/x/proyecto-de-prueba' } },
    assignments: { 'proyecto-de-prueba': { 'skill-de-prueba': { enabled: false, version: '1.0.0', by: 'human' } } },
    improvements: {},
    events: [],
  };
  const gate = evaluateDecision({ state, knowledge: document, ...GATE });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'human-decision');
});

test('la IA no puede elevar un valor heredado a concesión: setPolicy exige persona', () => {
  const root = tempRoot('lsc-provenance-set');
  const ai = withKnowledge(root, (document) =>
    setPolicy(document, { mode: 'guarded-autonomous', actor: 'ai', by: 'ai' }, '2026-11-09T10:00:00.000Z'),
  );
  assert.equal(ai.ok, true);
  assert.equal(ai.result.ok, false);
  assert.equal(ai.result.code, 'approval-required');
  assert.equal(loadKnowledge(root).document.policy.mode, 'human-approved', 'sin concesión, el defecto efectivo es human-approved');
  const view = knowledgeView({ root, now: '2026-11-09T10:00:00.000Z' });
  assert.equal(view.policy.provenance, 'legacy-unverified');
  assert.equal(view.policy.legacyUnverified, true);
});

test('repetir una concesión antigua no la convierte en evidencia si el almacén no trae comprobante', () => {
  const root = tempRoot('lsc-provenance-replay');
  grantAutonomy(root, { by: 'ana' });
  const first = policyFor(loadKnowledge(root).document, '');
  assert.equal(first.source, 'global');
  // Un reenvío del modo por la vía de datos no añade comprobante: sólo `setPolicy` humano lo hace.
  const replayed = withKnowledge(root, (document) => {
    document.policy.mode = 'guarded-autonomous';
    return { ok: true };
  });
  assert.equal(replayed.ok, true);
  const second = policyFor(loadKnowledge(root).document, '');
  assert.equal(second.source, 'global', 'el comprobante original sigue ahí');
  // Y si el comprobante desaparece, vuelve a legacy sin conceder nada.
  const stripped = withKnowledge(root, (document) => {
    delete document.policy.granted;
    return { ok: true };
  });
  assert.equal(stripped.ok, true);
  assert.equal(policyFor(loadKnowledge(root).document, '').source, 'legacy-unverified');
});

test('los datos de política ilegibles no conceden autonomía y no se sobrescriben', () => {
  const root = tempRoot('lsc-provenance-corrupt');
  const project = tempProject('proyecto-ilegible', root);
  // El registro existe pero está truncado: no se puede leer ni interpretar como concesión.
  writeFileSync(join(root, 'knowledge.json'), '{"schema":"lifecode-skill-center/knowledge","policy":{"mode":"guarded-au', 'utf8');
  const before = readFileSync(join(root, 'knowledge.json'));
  const blocked = runAction({ root, action: 'toggle', actor: 'ai', payload: { projectId: project.id, skillId: 'x', enabled: true }, now: '2026-11-09T10:00:00.000Z' });
  assert.equal(blocked.ok, false);
  const view = knowledgeView({ root, now: '2026-11-09T10:00:00.000Z' });
  assert.equal(view.ok, false);
  assert.equal(view.code, 'knowledge-unreadable');
  assert.equal(view.policy, undefined, 'sin registro legible no se inventa procedencia');
  assert.equal(readFileSync(join(root, 'knowledge.json')).equals(before), true, 'no se sobrescribe');
});

test('leer la procedencia no escribe el almacén de conocimiento', () => {
  const root = autonomyRoot('lsc-provenance-read');
  const file = join(root, 'knowledge.json');
  const before = readFileSync(file);
  const document = loadKnowledge(root).document;
  policyFor(document, 'proyecto-de-prueba');
  knowledgeSummary(document);
  knowledgeView({ root, now: '2026-11-09T10:00:00.000Z' });
  const after = readFileSync(file);
  assert.equal(after.equals(before), true);
});

test('publicar una mejora con política heredada se rechaza con el motivo de política', () => {
  const root = tempRoot('lsc-provenance-publish');
  const document = emptyKnowledge('2026-11-09T00:00:00.000Z');
  document.policy.mode = 'guarded-autonomous';
  const gate = gateOn(document, { operation: 'publish', skillId: 'skill-de-prueba' });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'policy-human-approved');
  assert.equal(gate.gates.find((item) => item.id === 'policy').ok, false);
  assert.match(gate.gates.find((item) => item.id === 'policy').detail, /human-approved/u);
  assert.equal(candidate().description.length >= 60, true);
});
