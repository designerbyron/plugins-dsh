/* T42/T45 — toda herramienta de mutación devuelve su proyección `activity` en el resultado de la tool. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { runAction } from '../lib/api.mjs';
import { loadKnowledge } from '../lib/knowledge.mjs';
import { centerFile, loadState } from '../lib/state.mjs';
import { lifecodeSkillCreate, lifecodeSkillImprove, lifecodeSkillInsight, lifecodeSkillSearch, lifecodeSkillStatus } from '../lib/tools.mjs';
import { candidate, tempProject, tempRoot } from './helpers.mjs';

const NOW = '2026-11-12T10:00:00.000Z';
const ACTIVITY_KEYS = ['at', 'category', 'eventId', 'persisted', 'replayed', 'severity', 'titleKey', 'titleVars', 'type'];

function box() {
  const root = tempRoot('t42-tools');
  const cwd = tempProject('proyecto', tempRoot('t42-project'));
  return { root, cwd, exec: { agent: { session: { header: { cwd, id: 's42' } } } } };
}

function sha(path) {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'missing';
}

function eventsOf(root) {
  return loadState(root).state?.events ?? [];
}

test('lifecode_skill_create devuelve activity con las 9 claves y el evento existe en state.events', () => {
  const { root, exec } = box();
  const tool = lifecodeSkillCreate({ root });
  const result = tool.execute(candidate(), exec);

  assert.equal(result.status, 'published');
  assert.ok(result.activity !== null && typeof result.activity === 'object');
  assert.deepEqual(Object.keys(result.activity).sort(), ACTIVITY_KEYS);
  assert.equal(result.activity.type, 'skill.created');
  assert.equal(result.activity.category, 'create');
  assert.equal(result.activity.severity, 'success');
  assert.equal(result.activity.persisted, true);
  assert.equal(result.activity.replayed, false);
  assert.match(String(result.activity.eventId), /^ev-/);
  assert.equal(typeof result.activity.at, 'string');

  // El identificador no es decorativo: el evento está en el diario persistido con ese id.
  const event = eventsOf(root).find((entry) => entry.id === result.activity.eventId);
  assert.ok(event, 'el eventId publicado debe existir en state.events');
  assert.equal(event.type, 'skill.created');
  assert.equal(event.skillId, candidate().id);

  // Lo mismo que verá el cliente: sobrevive a la serialización del `tool/result`.
  const serialized = JSON.parse(JSON.stringify({ content: result }));
  assert.equal(serialized.content.activity.eventId, result.activity.eventId);
  assert.equal(serialized.content.activity.persisted, true);
});

test('lifecode_skill_improve devuelve activity de su propio evento persistido', () => {
  const { root, exec } = box();
  lifecodeSkillCreate({ root }).execute(candidate(), exec);
  const improved = lifecodeSkillImprove({ root }).execute({
    skillId: candidate().id,
    rationale: 'La medición del día 12 mostró que falta el paso de verificación final.',
    body: `${candidate().body}\n\n## Verificación\n\nEjecuta la suite completa y adjunta el recuento final.`,
  }, exec);

  assert.equal(improved.status, 'proposed');
  assert.deepEqual(Object.keys(improved.activity).sort(), ACTIVITY_KEYS);
  assert.equal(improved.activity.type, 'improvement.proposed');
  assert.equal(improved.activity.category, 'improvement');
  assert.equal(improved.activity.persisted, true);
  assert.equal(improved.activity.replayed, false);
  const event = eventsOf(root).find((entry) => entry.id === improved.activity.eventId);
  assert.ok(event);
  assert.equal(event.type, 'improvement.proposed');
});

test('lifecode_skill_insight devuelve activity del evento de knowledge.json', () => {
  const { root, exec } = box();
  const result = lifecodeSkillInsight({ root }).execute({
    insightId: 't42-hallazgo',
    title: 'El servidor de pruebas no acepta cabeceras con acentos',
    category: 'trap',
    confidence: 'strong',
    summary: 'Medido en la caja temporal.',
    evidence: [{ source: 'prueba', location: 'tests/t42-tools-activity.test.mjs', verification: 'ejecución local', result: 'ok' }],
  }, exec);

  assert.equal(result.status, 'ok');
  assert.deepEqual(Object.keys(result.activity).sort(), ACTIVITY_KEYS);
  assert.match(String(result.activity.eventId), /^kn-[0-9a-f]{12}/);
  assert.equal(result.activity.type, 'insight-received');
  assert.equal(result.activity.persisted, true);
  assert.equal(loadKnowledge(root).document.events.length, 1);
});

test('una creación fallida no publica activity persistida', () => {
  const { root, exec } = box();
  const tool = lifecodeSkillCreate({ root });
  tool.execute(candidate(), exec);

  // Mismo id: la herramienta responde 'exists' y no debe anunciar ninguna actividad nueva.
  const repeated = tool.execute(candidate(), exec);
  assert.equal(repeated.status, 'exists');
  assert.equal(repeated.activity, undefined);
  const created = eventsOf(root).filter((entry) => entry.type === 'skill.created');
  assert.equal(created.length, 1);
});

test('un bloqueo de preflight no escribe ni devuelve activity', () => {
  const { root, cwd } = box();
  const before = sha(centerFile(root));
  const blocked = runAction({
    root,
    action: 'create',
    actor: 'ai',
    cwd,
    payload: candidate(),
    hostSources: [{ id: 'skills-registry', status: 'complete', reason: 'medido' }],
    collisions: [{
      code: 'name-collision',
      severity: 'block',
      key: candidate().id,
      rows: [{ name: candidate().id, key: candidate().id, owner: 'external', location: 'otra/raiz' }],
      explanation: 'otra raíz sirve el mismo nombre',
      evidence: {},
    }],
    now: NOW,
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'preflight-blocked');
  assert.equal(blocked.activity, undefined);
  assert.equal(eventsOf(root).length, 0);
  assert.equal(sha(centerFile(root)), before, 'un bloqueo no toca el diario');
});

test('replay por operationId no duplica el evento ni anuncia actividad nueva', () => {
  const { root, cwd } = box();
  const payload = { ...candidate({ id: 'skill-repetible' }), operationId: 'op-t42-1' };
  const first = runAction({ root, action: 'create', actor: 'ai', cwd, payload, now: NOW });
  assert.equal(first.ok, true);
  assert.equal(first.replayed, false);
  assert.equal(first.activity.persisted, true);

  const second = runAction({ root, action: 'create', actor: 'ai', cwd, payload, now: NOW });
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(second.activity, null);
  const created = eventsOf(root).filter((entry) => entry.type === 'skill.created' && entry.skillId === 'skill-repetible');
  assert.equal(created.length, 1);
});

test('las herramientas de lectura no devuelven activity', () => {
  const { root, exec } = box();
  lifecodeSkillCreate({ root }).execute(candidate(), exec);
  const status = lifecodeSkillStatus({ root }).execute({}, exec);
  assert.equal(status.status, 'ok');
  assert.equal('activity' in status, false);
  const search = lifecodeSkillSearch({ root }).execute({ query: 'compilar skills de dsh' }, exec);
  assert.ok(search.status === 'found' || search.status === 'empty');
  assert.equal('activity' in search, false);
});

/** Igual que el pipeline real: `createSuccessResult` compone `{ isError, value, content, ...meta }` y la
 *  normalización del despacho conserva `meta`; en replay se recalcula desde el `value` persistido. */
function dispatchedByPipeline(tool, args, value) {
  const meta = tool.output.presentationMeta(args, value);
  return {
    isError: false,
    value,
    content: tool.output.render(args, value),
    meta: JSON.parse(JSON.stringify(meta)),
  };
}

test('T50: create publica meta.activity y el pipeline normalizado lo conserva (eventId real)', () => {
  const { root, exec } = box();
  const tool = lifecodeSkillCreate({ root });
  const args = candidate();
  const value = tool.execute(args, exec);
  const dispatched = dispatchedByPipeline(tool, args, value);

  assert.ok(dispatched.meta.activity !== null && typeof dispatched.meta.activity === 'object');
  assert.deepEqual(Object.keys(dispatched.meta.activity).sort(), ACTIVITY_KEYS);
  assert.equal(dispatched.meta.activity.persisted, true);
  assert.equal(dispatched.meta.activity.replayed, false);

  const event = eventsOf(root).find((entry) => entry.id === dispatched.meta.activity.eventId);
  assert.ok(event, 'el eventId del meta coincide con un evento real de state.events');
  assert.equal(event.type, 'skill.created');

  // Igual que el replay: misma entrada ⇒ mismo meta, y no muta el valor persistido.
  const before = JSON.stringify(value);
  assert.deepEqual(tool.output.presentationMeta(args, value), tool.output.presentationMeta(args, value));
  assert.equal(JSON.stringify(value), before);
});

test('T50: improve e insight también declaran presentationMeta con su evento propio', () => {
  const { root, exec } = box();
  lifecodeSkillCreate({ root }).execute(candidate(), exec);

  const improveTool = lifecodeSkillImprove({ root });
  const improveArgs = {
    skillId: candidate().id,
    rationale: 'La medición del día 12 mostró que falta la verificación final.',
    body: `${candidate().body}\n\n## Verificación\n\nEjecuta la suite completa.`,
  };
  const improveValue = improveTool.execute(improveArgs, exec);
  const improveMeta = improveTool.output.presentationMeta(improveArgs, improveValue);
  assert.equal(improveMeta.activity.type, 'improvement.proposed');
  assert.equal(improveMeta.activity.persisted, true);
  assert.ok(eventsOf(root).some((entry) => entry.id === improveMeta.activity.eventId));

  const insightTool = lifecodeSkillInsight({ root });
  const insightArgs = {
    insightId: 't50-meta',
    title: 'El meta de presentación viaja con el resultado',
    category: 'contract',
    confidence: 'strong',
    summary: 'Medido ejecutando el contrato de presentationMeta.',
    evidence: [{ source: 'prueba', location: 'tests/t42-tools-activity.test.mjs', verification: 'ejecución local', result: 'ok' }],
  };
  const insightValue = insightTool.execute(insightArgs, exec);
  const insightMeta = insightTool.output.presentationMeta(insightArgs, insightValue);
  assert.equal(insightMeta.activity.type, 'insight-received');
  assert.match(String(insightMeta.activity.eventId), /^kn-[0-9a-f]{12}/);
  assert.ok(loadKnowledge(root).document.events.some((entry) => entry.type === 'insight-received'));
});

test('T50: bloqueo e idempotencia no llevan activity persistida en el meta', async () => {
  const { root, exec } = box();
  const collision = {
    code: 'name-collision',
    severity: 'block',
    key: candidate().id,
    rows: [{ name: candidate().id, key: candidate().id, owner: 'external', location: 'otra/raiz' }],
    explanation: 'otra raíz sirve el mismo nombre',
    evidence: {},
  };
  const blockedTool = lifecodeSkillCreate({
    root,
    evidence: async () => ({
      inventory: { entries: [], sources: [{ id: 'skills-registry', status: 'complete', reason: 'medido' }], complete: true },
      collisions: [collision],
      hostSources: [{ id: 'skills-registry', status: 'complete', reason: 'medido' }],
    }),
  });
  const blockedValue = await blockedTool.execute(candidate(), exec);
  const blockedMeta = blockedTool.output.presentationMeta(candidate(), blockedValue);
  assert.equal(blockedMeta.activity, null, 'un bloqueo no anuncia actividad');
  assert.equal(eventsOf(root).length, 0);
  assert.equal(existsSync(centerFile(root)) ? sha(centerFile(root)) : 'missing', 'missing');

  // Idempotencia: la segunda creación responde 'exists' y tampoco hay meta que anuncie un hecho nuevo.
  const tool = lifecodeSkillCreate({ root });
  const first = tool.execute(candidate(), exec);
  const second = tool.execute(candidate(), exec);
  assert.equal(second.status, 'exists');
  assert.equal(tool.output.presentationMeta(candidate(), second).activity, null);
  assert.equal(tool.output.presentationMeta(candidate(), first).activity.persisted, true);
});

test('T50: la tool de lectura no declara presentationMeta', () => {
  assert.equal(lifecodeSkillSearch({ root: tempRoot('t50-read') }).output.presentationMeta, undefined);
  assert.equal(lifecodeSkillStatus({ root: tempRoot('t50-read2') }).output.presentationMeta, undefined);
});
