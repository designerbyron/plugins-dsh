import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  emptyKnowledge,
  recordOriginVerification,
  receiveInsight,
  triageInsight,
} from '../lib/knowledge.mjs';

const NOW = '2026-11-09T12:00:00.000Z';
const LATER = '2026-11-09T12:10:00.000Z';

function withInsight(insightId = 'i-1') {
  const document = emptyKnowledge();
  const received = receiveInsight(document, {
    insightId,
    title: 'Un hallazgo',
    category: 'trap',
    confidence: 'strong',
    summary: 'algo observado',
    sourceAgent: 'subagente-x',
    sessionId: 'sesion-hija-1',
    parentRunId: 'sesion-padre',
    evidence: [{ source: 'auditoría', verification: 'prueba ejecutada', result: 'ok' }],
  }, NOW);
  assert.equal(received.ok, true);
  return { document, insight: received.insight };
}

test('el origen entra declarado y no verificado: el JSON del emisor no es una firma', () => {
  const { insight } = withInsight();
  assert.equal(insight.origin.verified, false);
  assert.equal(insight.origin.declared.sourceAgent, 'subagente-x');
  assert.equal(insight.origin.declared.sessionId, 'sesion-hija-1');
  assert.match(insight.origin.note, /declarado/i);
});

test('la verificación de origen exige la prueba del Host, no la declaración', () => {
  const { document, insight } = withInsight();
  const withoutProof = recordOriginVerification(document, { insightId: insight.insightId, proof: { verifiedBy: 'subagents.listChildren' } }, LATER);
  assert.equal(withoutProof.ok, false);
  assert.equal(withoutProof.code, 'origin-proof-invalid');
  assert.equal(document.insights[0].origin.verified, false);

  const withProof = recordOriginVerification(document, {
    insightId: insight.insightId,
    proof: { childId: 'sesion-hija-1', parentId: 'sesion-padre', verifiedBy: 'subagents.listChildren' },
  }, LATER);
  assert.equal(withProof.ok, true);
  assert.equal(withProof.insight.origin.verified, true);
  assert.equal(withProof.insight.origin.childId, 'sesion-hija-1');
  assert.equal(withProof.insight.origin.verifiedBy, 'subagents.listChildren');
});

test('acted-on no se gana leyendo ni enlazando: exige decisión y acción correcta', () => {
  const { document, insight } = withInsight();
  triageInsight(document, { insightId: insight.insightId, state: 'triaged' }, LATER);
  triageInsight(document, { insightId: insight.insightId, state: 'validated' }, LATER);
  triageInsight(document, { insightId: insight.insightId, state: 'decided', decisionId: 'dec-1' }, LATER);

  const withoutAction = triageInsight(document, { insightId: insight.insightId, state: 'acted-on', decisionId: 'dec-1' }, LATER);
  assert.equal(withoutAction.ok, false);
  assert.equal(withoutAction.code, 'insight-action-not-done');
  assert.equal(document.insights[0].state, 'decided');

  const failedAction = triageInsight(document, {
    insightId: insight.insightId,
    state: 'acted-on',
    decisionId: 'dec-1',
    action: { ok: false, operation: 'publish' },
  }, LATER);
  assert.equal(failedAction.ok, false);
  assert.equal(document.insights[0].state, 'decided');

  const done = triageInsight(document, {
    insightId: insight.insightId,
    state: 'acted-on',
    decisionId: 'dec-1',
    action: { ok: true, operation: 'publish', skillId: 's-1', version: '1.1.0', projectId: 'p-1' },
  }, LATER);
  assert.equal(done.ok, true);
  assert.equal(document.insights[0].state, 'acted-on');
  assert.equal(document.insights[0].actedOn.version, '1.1.0');
  assert.equal(document.insights[0].actedOn.operation, 'publish');
});

test('acted-on exige una decisión registrada, no sólo una acción', () => {
  const { document, insight } = withInsight();
  triageInsight(document, { insightId: insight.insightId, state: 'triaged' }, LATER);
  triageInsight(document, { insightId: insight.insightId, state: 'validated' }, LATER);
  triageInsight(document, { insightId: insight.insightId, state: 'decided' }, LATER);
  const noDecision = triageInsight(document, {
    insightId: insight.insightId,
    state: 'acted-on',
    action: { ok: true, operation: 'create' },
  }, LATER);
  assert.equal(noDecision.ok, false);
  assert.equal(noDecision.code, 'insight-requires-decision');
});

test('no se salta el ciclo: de recibido no se pasa a acted-on', () => {
  const { document, insight } = withInsight();
  const skipped = triageInsight(document, {
    insightId: insight.insightId,
    state: 'acted-on',
    decisionId: 'dec-1',
    action: { ok: true, operation: 'create' },
  }, LATER);
  assert.equal(skipped.ok, false);
  assert.equal(skipped.code, 'insight-transition-invalid');
  assert.deepEqual(skipped.allowed, ['triaged', 'deferred', 'rejected']);
});

test('una contradicción se declara sin fusionar las fuentes', () => {
  const { document, insight } = withInsight();
  triageInsight(document, { insightId: insight.insightId, state: 'triaged' }, LATER);
  const contradicted = triageInsight(document, { insightId: insight.insightId, state: 'contradicted', note: 'dos mediciones discrepan' }, LATER);
  assert.equal(contradicted.ok, true);
  assert.equal(contradicted.insight.state, 'contradicted');
  assert.equal(contradicted.insight.evidence.length, 1, 'la evidencia original no se pierde');
});
