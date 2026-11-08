/**
 * Las operaciones son el corazón del producto: aquí viven las cinco promesas que el plan exige
 * proteger. Cada prueba de este fichero fija una de ellas, no un detalle de implementación.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureProject,
  findProject,
  createSkill,
  publishVersion,
  proposeImprovement,
  decideImprovement,
  toggleAssignment,
  rollbackAssignment,
  forkSkill,
  assignedSkills,
  currentVersionOf,
  versionOf,
  diffBodies,
  previousVersion,
} from '../lib/operations.mjs';
import { emptyState } from '../lib/state.mjs';
import { candidate, tempProject } from './helpers.mjs';

const NOW = '2026-11-08T12:00:00.000Z';

function freshState() {
  return emptyState(NOW);
}

function withSkill(overrides = {}) {
  const state = freshState();
  const project = ensureProject(state, tempProject('proyecto'), { now: NOW });
  const created = createSkill(state, candidate(overrides), { now: NOW, actor: 'ai' });
  assert.equal(created.ok, true, JSON.stringify(created));
  return { state, project, id: created.id };
}

test('createSkill publica la 1.0.0, deja el origen y anota el evento', () => {
  const state = freshState();
  const created = createSkill(state, candidate(), { now: NOW, actor: 'ai' });
  assert.equal(created.ok, true);
  assert.equal(created.version.version, '1.0.0');
  assert.equal(created.skill.currentVersion, '1.0.0');
  assert.equal(created.skill.origin.kind, 'ai');
  assert.equal(created.skill.versions.length, 1);
  assert.equal(created.evaluation.status, 'pass');
  assert.equal(state.events.at(-1).type, 'skill.created');
});

test('una skill que no pasa la puerta no se publica, y se explica por qué', () => {
  const state = freshState();
  const refused = createSkill(state, candidate({ description: '' }), { now: NOW, actor: 'ai' });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'evaluation-failed');
  assert.ok(refused.findings.some((finding) => finding.severity === 'block'));
  assert.deepEqual(Object.keys(state.skills), [], 'no debe quedar nada a medias');
});

test('un id repetido o inseguro se rechaza en vez de sobrescribir', () => {
  const state = freshState();
  createSkill(state, candidate(), { now: NOW, actor: 'ai' });
  const repeated = createSkill(state, candidate(), { now: NOW, actor: 'ai' });
  assert.equal(repeated.code, 'exists');
  const unsafe = createSkill(state, candidate({ id: 'Con Espacios' }), { now: NOW, actor: 'ai' });
  assert.equal(unsafe.code, 'invalid-id');
  const empty = createSkill(state, candidate({ id: '', title: '¿?' }), { now: NOW, actor: 'ai' });
  assert.equal(empty.code, 'invalid-id');
});

test('cada proyecto registrado es sólo un avistamiento, no un permiso', () => {
  const state = freshState();
  const cwd = tempProject('un-proyecto');
  const project = ensureProject(state, cwd, { now: NOW });
  assert.equal(findProject(state, cwd).id, project.id);
  assert.deepEqual(state.assignments, {}, 'registrar el proyecto no activa nada');
});

test('una persona publica una versión nueva; la IA no puede publicarla sola', () => {
  const { state, id } = withSkill();
  const improved = candidate({ description: `${candidate().description} Ahora con más detalle.` });
  const byAi = publishVersion(state, id, { ...improved, notes: 'mejora' }, { now: NOW, actor: 'ai' });
  assert.equal(byAi.code, 'approval-required');
  assert.equal(currentVersionOf(state.skills[id]).version, '1.0.0');

  const byHuman = publishVersion(state, id, { ...improved, notes: 'mejora' }, { now: NOW, actor: 'human' });
  assert.equal(byHuman.ok, true);
  assert.equal(byHuman.version.version, '1.1.0');
  assert.equal(state.skills[id].versions.length, 2, 'la versión anterior se conserva');
});

test('una mejora se propone, espera decisión humana y sólo entonces crea la versión', () => {
  const { state, id } = withSkill();
  const proposed = proposeImprovement(state, id, {
    ...candidate({ description: `${candidate().description} Mejorada.` }),
    rationale: 'El procedimiento cambi\u00f3 tras medir el flujo de trabajo.',
  }, { now: NOW, actor: 'ai' });
  assert.equal(proposed.ok, true);
  assert.equal(proposed.improvement.status, 'proposed');
  assert.equal(currentVersionOf(state.skills[id]).version, '1.0.0');

  const byAi = decideImprovement(state, proposed.improvementId, 'approve', { now: NOW, actor: 'ai' });
  assert.equal(byAi.code, 'approval-required', 'aprobar no es una herramienta del modelo');

  const byHuman = decideImprovement(state, proposed.improvementId, 'approve', { now: NOW, actor: 'human' });
  assert.equal(byHuman.ok, true);
  assert.equal(byHuman.version.version, '1.1.0');
  assert.equal(state.improvements[proposed.improvementId].status, 'approved');
  assert.equal(state.improvements[proposed.improvementId].version, '1.1.0', 'el historial dice qué versión salió de la propuesta');
  assert.ok(state.skills[id].versions.length === 2);
});

test('rechazar una mejora no toca la skill y una decisión no se repite', () => {
  const { state, id } = withSkill();
  const proposed = proposeImprovement(state, id, { ...candidate(), rationale: 'Una idea razonable pero peor.' }, { now: NOW, actor: 'ai' });
  const rejected = decideImprovement(state, proposed.improvementId, 'reject', { now: NOW, actor: 'human', note: 'no aporta' });
  assert.equal(rejected.ok, true);
  assert.equal(state.improvements[proposed.improvementId].status, 'rejected');
  assert.equal(currentVersionOf(state.skills[id]).version, '1.0.0');
  const again = decideImprovement(state, proposed.improvementId, 'approve', { now: NOW, actor: 'human' });
  assert.equal(again.code, 'settled');
});

test('una mejora propuesta sobre una versión vieja no se aplica encima', () => {
  const { state, id } = withSkill();
  const proposed = proposeImprovement(state, id, { ...candidate(), rationale: 'Sobre la 1.0.0.' }, { now: NOW, actor: 'ai' });
  publishVersion(state, id, { ...candidate({ description: `${candidate().description} Otra mejor.` }), notes: 'por su cuenta' }, { now: NOW, actor: 'human' });
  const stale = decideImprovement(state, proposed.improvementId, 'approve', { now: NOW, actor: 'human' });
  assert.equal(stale.code, 'stale');
  assert.equal(state.improvements[proposed.improvementId].status, 'proposed');
});

test('activar en un proyecto no activa en otro, y desactivar no borra ni desactiva fuera', () => {
  const state = freshState();
  const a = ensureProject(state, tempProject('a'), { now: NOW });
  const b = ensureProject(state, tempProject('b'), { now: NOW });
  const { id } = withSkillIn(state);

  assert.equal(toggleAssignment(state, { projectId: a.id, skillId: id, enabled: true }, { now: NOW, actor: 'human' }).ok, true);
  assert.equal(toggleAssignment(state, { projectId: b.id, skillId: id, enabled: true }, { now: NOW, actor: 'human' }).ok, true);
  assert.equal(assignedSkills(state, a.id).length, 1);
  assert.equal(assignedSkills(state, b.id).length, 1);

  // Desactivar en A: B sigue cargándola, y la skill sigue existiendo.
  assert.equal(toggleAssignment(state, { projectId: a.id, skillId: id, enabled: false }, { now: NOW, actor: 'human' }).ok, true);
  assert.equal(assignedSkills(state, a.id).length, 0);
  assert.equal(assignedSkills(state, b.id).length, 1, 'el otro proyecto no se entera');
  assert.ok(state.skills[id], 'desactivar no elimina');
  assert.ok(state.skills[id].versions.length === 1);
});

test('desactivar conserva la versión: volver a activar restaura exactamente lo que había', () => {
  const state = freshState();
  const project = ensureProject(state, tempProject('p'), { now: NOW });
  const { id } = withSkillIn(state);
  publishVersion(state, id, { ...candidate({ description: `${candidate().description} Segunda.` }), notes: 'nueva' }, { now: NOW, actor: 'human' });
  toggleAssignment(state, { projectId: project.id, skillId: id, enabled: true, version: '1.0.0' }, { now: NOW, actor: 'human' });
  assert.equal(assignedSkills(state, project.id)[0].version.version, '1.0.0', 'la asignación fija versión');
  toggleAssignment(state, { projectId: project.id, skillId: id, enabled: false }, { now: NOW, actor: 'human' });
  toggleAssignment(state, { projectId: project.id, skillId: id, enabled: true }, { now: NOW, actor: 'human' });
  assert.equal(assignedSkills(state, project.id)[0].version.version, '1.0.0', 'no salta a la última por su cuenta');
});

test('la autorización es del borde: estas operaciones registran quién decide, pero no deciden por ti', () => {
  // Quién puede encender una skill lo resuelve `lib/api.mjs`, que es el único punto por el que entran
  // la herramienta del agente y el panel; aquí se comprueba que el rastro queda con el actor real.
  const { state, project, id } = withSkill();
  toggleAssignment(state, { projectId: project.id, skillId: id, enabled: true }, { now: NOW, actor: 'ai' });
  assert.equal(state.assignments[project.id][id].by, 'ai');
  assert.equal(state.events.at(-1).actor, 'ai');
});

test('el pin de versión se puede mover sin borrar historial (rollback real)', () => {
  const state = freshState();
  const project = ensureProject(state, tempProject('p'), { now: NOW });
  const { id } = withSkillIn(state);
  publishVersion(state, id, { ...candidate({ description: `${candidate().description} Dos.` }), notes: 'dos' }, { now: NOW, actor: 'human' });
  toggleAssignment(state, { projectId: project.id, skillId: id, enabled: true, version: '1.1.0' }, { now: NOW, actor: 'human' });
  const rollback = rollbackAssignment(state, { projectId: project.id, skillId: id, version: '1.0.0' }, { now: NOW, actor: 'human' });
  assert.equal(rollback.ok, true);
  assert.equal(assignedSkills(state, project.id)[0].version.version, '1.0.0');
  assert.equal(state.skills[id].versions.length, 2, 'rollback no es borrar');
  const unknown = rollbackAssignment(state, { projectId: project.id, skillId: id, version: '9.9.9' }, { now: NOW, actor: 'human' });
  assert.equal(unknown.code, 'unknown-version');
});

test('clonar una skill no modifica el original', () => {
  const { state, id } = withSkill();
  const forked = forkSkill(state, { sourceId: id, id: 'copia-de-la-skill', title: 'Copia' }, { now: NOW, actor: 'human' });
  assert.equal(forked.ok, true);
  const clone = state.skills['copia-de-la-skill'];
  assert.equal(clone.origin.kind, 'fork');
  assert.equal(clone.origin.from, id);
  clone.versions[0].body = 'cambiado en la copia';
  assert.equal(state.skills[id].versions[0].body, candidate().body);
  const again = forkSkill(state, { sourceId: id, id: 'copia-de-la-skill' }, { now: NOW, actor: 'human' });
  assert.equal(again.code, 'exists');
});

test('una asignación a un proyecto desconocido no inventa nada', () => {
  const { state, id } = withSkill();
  const unknown = toggleAssignment(state, { projectId: 'no-existe', skillId: id, enabled: true }, { now: NOW, actor: 'human' });
  assert.equal(unknown.code, 'unknown-project');
  assert.deepEqual(state.assignments, {});
});

test('el diff de dos cuerpos dice qué entra y qué sale', () => {
  const diff = diffBodies('## A\nuno\ndos', '## A\nuno\ntres');
  assert.equal(diff.removed, 1);
  assert.equal(diff.added, 1);
  assert.deepEqual(diff.preview.filter((line) => line.kind === 'added').map((line) => line.text), ['tres']);
  // `previousVersion` devuelve el número de versión anterior, que es lo que necesita el botón de atrás.
  assert.equal(previousVersion(stateWithTwoVersions(), '1.1.0'), '1.0.0');
  assert.equal(previousVersion(stateWithTwoVersions(), '1.0.0'), null);
});

/* ── utilidades locales ─────────────────────────────────────────────────────────────────────────── */

function withSkillIn(state) {
  const created = createSkill(state, candidate(), { now: NOW, actor: 'ai' });
  assert.equal(created.ok, true, JSON.stringify(created));
  return { id: created.id, skill: created.skill };
}

function stateWithTwoVersions() {
  const state = freshState();
  const { id } = withSkillIn(state);
  publishVersion(state, id, { ...candidate({ description: `${candidate().description} Dos.` }), notes: 'dos' }, { now: NOW, actor: 'human' });
  const skill = state.skills[id];
  assert.equal(versionOf(skill, '1.0.0').version, '1.0.0');
  return skill;
}


test('las referencias se aceptan como mapa o como lista, y una ruta inválida se rechaza en voz alta', () => {
  const state = freshState();
  const lista = createSkill(state, {
    ...candidate(),
    id: 'con-referencias-en-lista',
    references: [{ path: 'references/checklist.md', content: '# Checklist\n' }],
  }, { now: NOW, actor: 'ai' });
  assert.equal(lista.ok, true);
  assert.deepEqual(Object.keys(lista.version.references), ['references/checklist.md']);

  const mapa = createSkill(state, {
    ...candidate(),
    id: 'con-referencias-en-mapa',
    references: { 'references/otra.md': '# Otra\n' },
  }, { now: NOW, actor: 'ai' });
  assert.equal(mapa.ok, true);
  assert.deepEqual(Object.keys(mapa.version.references), ['references/otra.md']);

  const mala = createSkill(state, {
    ...candidate(),
    id: 'con-referencia-que-escapa',
    references: [{ path: '../../escapa.txt', content: 'x' }],
  }, { now: NOW, actor: 'ai' });
  assert.equal(mala.ok, false);
  assert.equal(mala.code, 'invalid-references');
});
