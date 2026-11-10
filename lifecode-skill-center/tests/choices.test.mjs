import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { runAction } from '../lib/api.mjs';
import { chooseOperation } from '../lib/decisions.mjs';
import { loadKnowledge, receiveInsight, withKnowledge } from '../lib/knowledge.mjs';
import { loadState } from '../lib/state.mjs';
import { candidate, tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = new Date('2026-11-09T12:00:00.000Z');

function seededSkill(state, title, extra = {}) {
  const id = extra.id ?? 'skill-existente';
  const description = extra.description ?? 'Comprueba que un plugin de DSH no escribe fuera de su carpeta y deja evidencia.';
  state.skills[id] = {
    id,
    title,
    description,
    tags: extra.tags ?? ['dsh', 'plugins'],
    status: 'published',
    currentVersion: '1.0.0',
    createdAt: NOW.toISOString(),
    versions: [
      {
        version: '1.0.0',
        title,
        description,
        whenToUse: 'Cuando haya que revisar un plugin antes de instalarlo en un perfil.',
        tags: extra.tags ?? ['dsh', 'plugins'],
        body: '## Procedimiento\n\nLee el manifiesto y ejecuta la suite.\n\n## Evidencia\n\nDeja el resultado.',
        createdAt: NOW.toISOString(),
        checksum: 'x'.repeat(64),
        evaluation: { status: 'pass', score: 100 },
      },
    ],
  };
  return id;
}

test('el elector propone crear cuando no hay nada parecido', () => {
  const state = { skills: {} };
  const choice = chooseOperation({
    state,
    title: 'Ordenar la despensa por caducidad',
    description: 'Clasifica los alimentos por fecha de caducidad para no tirar comida.',
    tags: ['cocina', 'orden'],
  });
  assert.equal(choice.ok, true);
  assert.equal(choice.operation, 'create-skill');
  assert.match(choice.reasons[0], /no hay ninguna skill parecida/);
});

test('el elector propone mejorar la existente cuando el título coincide', () => {
  const state = { skills: {} };
  const id = seededSkill(state, 'Revisar un plugin de DSH antes de instalarlo');

  const choice = chooseOperation({
    state,
    title: 'Revisar un plugin de DSH antes de instalarlo',
    description: 'Comprueba estructura, pruebas y manifiesto antes de instalar un plugin de DSH.',
    tags: ['dsh', 'plugins'],
  });

  assert.equal(choice.operation, 'improve-skill');
  assert.equal(choice.skillId, id);
  assert.ok(choice.reasons.includes('ya existe una skill con ese título'));
  assert.equal(choice.similar.length, 1);
});

test('el elector exige candidata y no inventa con datos vacíos', () => {
  const choice = chooseOperation({ state: { skills: {} }, title: '', description: '' });
  assert.equal(choice.ok, false);
  assert.equal(choice.code, 'candidate-required');
});

test('la acción plan recomienda y no escribe el almacén', () => {
  const root = autonomyRoot('lsc-plan');
  const opened = runAction({ root, action: 'open', payload: { cwd: 'C:/x/proyecto' }, actor: 'human', cwd: 'C:/x/proyecto', now: NOW.toISOString() });
  assert.equal(opened.ok, true);
  const state = loadState(root).state;
  const id = seededSkill(state, 'Revisar un plugin de DSH antes de instalarlo');
  // Sembrar a mano el estado ya abierto: `saveState` no hace falta, `plan` sólo lee.
  const file = join(root, 'center.json');
  const wrapper = JSON.parse(readFileSync(file, 'utf8'));
  wrapper.skills = wrapper.skills ?? {};
  wrapper.skills[id] = state.skills[id];
  writeFileSync(file, JSON.stringify(wrapper, null, 2), 'utf8');
  const seededBytes = readFileSync(file);

  const plan = runAction({
    root,
    action: 'plan',
    payload: { title: 'Revisar un plugin de DSH antes de instalarlo', description: 'Comprueba estructura y manifiesto de un plugin de DSH.' },
    actor: 'ai',
    now: NOW.toISOString(),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.operation, 'improve-skill');
  assert.equal(plan.skillId, id);
  assert.deepEqual(readFileSync(file), seededBytes, 'el plan no toca el almacén');

  const fresh = runAction({
    root,
    action: 'plan',
    payload: { title: 'Ordenar la despensa por caducidad', description: 'Clasifica alimentos por fecha para no tirar comida.' },
    actor: 'ai',
    now: NOW.toISOString(),
  });
  assert.equal(fresh.operation, 'create-skill');
});

test('crear desde un hallazgo enlaza la procedencia y mueve el hallazgo a triaje', () => {
  const root = autonomyRoot('lsc-insight-link');
  runAction({ root, action: 'open', payload: { cwd: 'C:/x/proyecto' }, actor: 'human', cwd: 'C:/x/proyecto', now: NOW.toISOString() });

  const recorded = runAction({
    root,
    action: 'insight',
    payload: {
      insightId: 'hallazgo-uno',
      title: 'Un plugin escribe fuera de su carpeta',
      category: 'defect',
      confidence: 'strong',
      summary: 'El instalador copia ficheros en el perfil de usuario sin pedirlo.',
      evidence: [{ source: 'qa', location: 'install.mjs', verification: 'diff del perfil antes y después', result: '2 ficheros nuevos' }],
    },
    actor: 'ai',
    now: NOW.toISOString(),
  });
  assert.equal(recorded.ok, true);

  const created = runAction({
    root,
    action: 'create',
    payload: { ...candidate({ id: 'skill-desde-hallazgo', title: 'Revisar escrituras fuera de carpeta', description: 'Comprueba que un instalador no escribe fuera de su carpeta y deja evidencia de los ficheros tocados.' }), insightId: 'hallazgo-uno' },
    actor: 'human',
    now: NOW.toISOString(),
  });
  assert.equal(created.ok, true);
  assert.equal(created.insightLink.linked, true);
  assert.equal(created.insightLink.appliedSkillId, 'skill-desde-hallazgo');

  const knowledge = loadKnowledge(root).document;
  const insights = Array.isArray(knowledge.insights) ? knowledge.insights : Object.values(knowledge.insights ?? {});
  const hallazgo = insights.find((item) => item.insightId === 'hallazgo-uno');
  assert.equal(hallazgo.state, 'triaged');
  assert.equal(hallazgo.appliedSkillId, 'skill-desde-hallazgo');

  const again = runAction({
    root,
    action: 'create',
    payload: { ...candidate({ id: 'skill-dos', title: 'Otra skill distinta', description: 'Documenta cómo se revisa un plugin distinto y deja evidencia de cada paso ejecutado.' }), insightId: 'no-existe' },
    actor: 'human',
    now: NOW.toISOString(),
  });
  assert.equal(again.ok, true, 'la skill se crea aunque el hallazgo no exista');
  assert.equal(again.insightLink.linked, false);
  assert.equal(again.insightLink.code, 'insight-not-found');
});

test('un hallazgo recibido se puede sembrar y queda pendiente en la bandeja', () => {
  const root = autonomyRoot('lsc-insight-seed');
  const written = withKnowledge(root, (document) => receiveInsight(document, {
    insightId: 'sembrado',
    sourceAgent: 'subagente-qa',
    title: 'Algo',
    category: 'trap',
    confidence: 'moderate',
    summary: 'Resumen',
  }, NOW), { now: NOW.toISOString() });
  assert.equal(written.ok, true);
  const seeded = Array.isArray(written.document.insights) ? written.document.insights : Object.values(written.document.insights ?? {});
  assert.equal(seeded.find((item) => item.insightId === 'sembrado').state, 'received');
});
