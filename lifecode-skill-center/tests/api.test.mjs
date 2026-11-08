/**
 * El borde del producto: lo que ven la herramienta del agente, el panel y el proveedor de skills.
 * Aquí se prueban las políticas (quién puede qué) y la promesa central — una skill activada en un
 * proyecto se carga en ese proyecto y sólo en ese.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { buildSnapshot, runAction, listAssignedFor, centerRoot, API_VERSION } from '../lib/api.mjs';
import { skillProviderFor } from '../lib/provider.mjs';
import { loadState, centerFile } from '../lib/state.mjs';
import { parseSkillFile } from '../lib/skillfile.mjs';
import { candidate, tempProject, tempRoot } from './helpers.mjs';

const NOW = '2026-11-08T12:00:00.000Z';
const root = () => tempRoot('lsc-api');
const projectA = () => tempProject('proyecto-a', tempRoot('lsc-cwd'));
const projectB = () => tempProject('proyecto-b', tempRoot('lsc-cwd'));

function createOne(store, cwd, overrides = {}) {
  const created = runAction({ root: store, action: 'create', payload: candidate(overrides), actor: 'ai', cwd, now: NOW });
  assert.equal(created.ok, true, JSON.stringify(created).slice(0, 400));
  return created;
}

test('centerRoot respeta el entorno y por defecto cuelga de DSH_HOME', () => {
  assert.equal(centerRoot({ LIFECODE_SKILL_CENTER_ROOT: 'C:/otro' }), 'C:/otro');
  assert.match(centerRoot({ DSH_HOME: 'C:/dsh' }).replace(/\\/g, '/'), /C:\/dsh\/lifecode-skill-center$/);
});

test('open registra el proyecto de la sesión y lo devuelve marcado', () => {
  const store = root();
  const cwd = projectA();
  const opened = runAction({ root: store, action: 'open', cwd, now: NOW });
  assert.equal(opened.ok, true);
  assert.equal(opened.opened, true);
  assert.equal(opened.apiVersion, API_VERSION);
  assert.equal(opened.project.registered, true);
  assert.equal(opened.project.cwd, cwd.replace(/\\/g, '/'));
  assert.ok(existsSync(centerFile(store)));
});

test('el snapshot cuenta lo que hay y deja claro en qué proyectos está cada skill', () => {
  const store = root();
  const cwd = projectA();
  const created = createOne(store, cwd);
  const snapshot = buildSnapshot({ root: store, cwd, now: NOW, scan: false });
  assert.equal(snapshot.skills.length, 1);
  assert.equal(snapshot.skills[0].id, created.id);
  assert.equal(snapshot.skills[0].currentVersion, '1.0.0');
  assert.equal(snapshot.skills[0].current.evaluation.status, 'pass');
  assert.deepEqual(snapshot.skills[0].enabledIn, []);
  assert.equal(snapshot.totals.skills, 1);
  assert.equal(snapshot.analytics.skills.total, 1);
});

test('la IA no enciende, no revierte, no importa y no decide: eso es de la persona', () => {
  const store = root();
  const cwd = projectA();
  const created = createOne(store, cwd);
  const opened = runAction({ root: store, action: 'open', cwd, now: NOW });
  const projectId = opened.project.id;

  const toggle = runAction({ root: store, action: 'toggle', actor: 'ai', payload: { projectId, skillId: created.id, enabled: true }, cwd, now: NOW });
  assert.equal(toggle.code, 'approval-required');

  const improve = runAction({ root: store, action: 'improve', actor: 'ai', payload: { skillId: created.id, ...candidate({ description: `${candidate().description} Otra.` }), rationale: 'una razón' }, cwd, now: NOW });
  assert.equal(improve.ok, true);
  const decide = runAction({ root: store, action: 'decide', actor: 'ai', payload: { improvementId: improve.improvementId, decision: 'approve' }, cwd, now: NOW });
  assert.equal(decide.code, 'approval-required');
  const publish = runAction({ root: store, action: 'publish', actor: 'ai', payload: { id: created.id, ...candidate(), notes: 'x' }, cwd, now: NOW });
  assert.equal(publish.code, 'approval-required');
  const rollback = runAction({ root: store, action: 'rollback', actor: 'ai', payload: { projectId, skillId: created.id, version: '1.0.0' }, cwd, now: NOW });
  assert.equal(rollback.code, 'approval-required');
});

test('la persona que decide es la que mueve el estado; el registro queda con su actor', () => {
  const store = root();
  const cwd = projectA();
  const created = createOne(store, cwd);
  const projectId = runAction({ root: store, action: 'open', cwd, now: NOW }).project.id;
  const on = runAction({ root: store, action: 'toggle', actor: 'human', payload: { projectId, skillId: created.id, enabled: true, version: '1.0.0' }, cwd, now: NOW });
  assert.equal(on.ok, true);
  const state = loadState(store).state;
  assert.equal(state.assignments[projectId][created.id].by, 'human');
  assert.equal(state.assignments[projectId][created.id].enabled, true);
  assert.ok(state.events.some((event) => event.type === 'skill.assigned' && event.actor === 'human'));
});

test('la promesa central: activa en dos proyectos, se carga en los dos, y apagarla en uno no toca al otro', async () => {
  const store = root();
  const cwdA = projectA();
  const cwdB = projectB();
  const created = createOne(store, cwdA);
  const idA = runAction({ root: store, action: 'open', cwd: cwdA, now: NOW }).project.id;
  const idB = runAction({ root: store, action: 'open', cwd: cwdB, now: NOW }).project.id;
  for (const projectId of [idA, idB]) {
    const toggled = runAction({ root: store, action: 'toggle', actor: 'human', payload: { projectId, skillId: created.id, enabled: true }, cwd: cwdA, now: NOW });
    assert.equal(toggled.ok, true, JSON.stringify(toggled));
  }

  const provider = skillProviderFor({ root: store, now: NOW });
  const forA = await provider.list({ cwd: cwdA });
  const forB = await provider.list({ cwd: cwdB });
  assert.deepEqual(forA.map((entry) => entry.name), [created.id]);
  assert.deepEqual(forB.map((entry) => entry.name), [created.id]);
  assert.equal(forA[0].provider, 'lifecode-skill-center');
  assert.ok(forA[0].path.includes('materialized'));

  // El contenido que el harness lee es el SKILL.md materializado, no el documento interno.
  const loaded = await provider.get(forA[0]);
  assert.ok(loaded.content.includes('## Procedimiento'));
  assert.equal(parseSkillFile(loaded.content).data.name, created.id);

  // Apagar en A deja a B sirviendo la skill, y la skill sigue en la biblioteca.
  const off = runAction({ root: store, action: 'toggle', actor: 'human', payload: { projectId: idA, skillId: created.id, enabled: false }, cwd: cwdA, now: NOW });
  assert.equal(off.ok, true);
  assert.deepEqual(await provider.list({ cwd: cwdA }), []);
  assert.deepEqual((await provider.list({ cwd: cwdB })).map((entry) => entry.name), [created.id]);
  assert.ok(loadState(store).state.skills[created.id]);
});

test('un proyecto sin asignaciones no recibe nada, aunque la biblioteca tenga skills', async () => {
  const store = root();
  const cwdA = projectA();
  const cwdB = projectB();
  createOne(store, cwdA);
  runAction({ root: store, action: 'open', cwd: cwdB, now: NOW });
  const provider = skillProviderFor({ root: store, now: NOW });
  assert.deepEqual(await provider.list({ cwd: cwdB }), []);
});

test('sync escribe el proyecto materializado con su manifiesto y es idempotente', () => {
  const store = root();
  const cwd = projectA();
  const created = createOne(store, cwd);
  const projectId = runAction({ root: store, action: 'open', cwd, now: NOW }).project.id;
  runAction({ root: store, action: 'toggle', actor: 'human', payload: { projectId, skillId: created.id, enabled: true }, cwd, now: NOW });

  const first = runAction({ root: store, action: 'sync', cwd, now: NOW, payload: { projectId } });
  assert.equal(first.ok, true);
  assert.equal(first.results.length, 1);
  assert.ok(first.results[0].written.length >= 2, 'SKILL.md y manifiesto');
  const directory = first.results[0].directory;
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.projectId, projectId);
  assert.deepEqual(manifest.skills.map((entry) => `${entry.id}@${entry.version}`), [`${created.id}@1.0.0`]);

  const second = runAction({ root: store, action: 'sync', cwd, now: NOW, payload: { projectId } });
  assert.deepEqual(second.results[0].written, [], 'sin cambios no se reescribe');
  assert.ok(second.results[0].unchanged >= 2);
});

test('la detección ve la biblioteca propia y las skills que ya viven en el disco', () => {
  const store = root();
  const cwd = tempProject('proyecto-con-skills', tempRoot('lsc-detect'));
  const created = createOne(store, cwd, { description: 'Despliega el proyecto en la nube con verificación de humo.' });

  // Una skill que ya existía en el proyecto, puesta a mano en el disco.
  const skillDir = join(cwd, '.dsh', 'skills', 'despliegue-heredado');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), ['---', 'name: despliegue-heredado', 'description: Despliega el proyecto en la nube paso a paso', '---', '', 'cuerpo'].join('\n'), 'utf8');

  const found = runAction({ root: store, action: 'detect', payload: { text: 'desplegar el proyecto en la nube' }, cwd, now: NOW });
  assert.equal(found.ok, true);
  const external = found.matches.filter((match) => !match.inLibrary);
  assert.ok(external.some((match) => match.id === 'despliegue-heredado'), JSON.stringify(found.matches));
  assert.ok(found.roots.length >= 1);

  // Y con la consulta de la biblioteca se ve lo propio: la detección mira en los dos sitios.
  const own = runAction({ root: store, action: 'detect', payload: { text: 'compila y verifica una skill de dsh' }, cwd, now: NOW });
  assert.ok(own.matches.some((match) => match.inLibrary && match.id === created.id), JSON.stringify(own.matches));
});

test('importar una skill del disco entra en la biblioteca como propuesta de la persona', () => {
  const store = root();
  const cwd = tempProject('proyecto-import', tempRoot('lsc-import'));
  const skillDir = join(cwd, '.dsh', 'skills', 'heredada');
  mkdirSync(skillDir, { recursive: true });
  const file = join(skillDir, 'SKILL.md');
  writeFileSync(file, [
    '---',
    'name: heredada',
    'description: Una skill que ya existía en este proyecto y hay que poder reutilizar en otros.',
    'whenToUse: Cuando haya que reutilizar lo que ya estaba escrito en el proyecto anterior.',
    '---',
    '',
    '## Procedimiento',
    '',
    'Lee el fichero heredado, compruébalo y anota la diferencia con lo que hace hoy el proyecto antes de reutilizarlo.',
    '',
    '## Evidencia',
    '',
    'La salida de la comprobación queda adjunta en el propio proyecto, junto al hash del fichero original.',
  ].join('\n'), 'utf8');

  const byAi = runAction({ root: store, action: 'import', actor: 'ai', payload: { path: file }, cwd, now: NOW });
  assert.equal(byAi.code, 'approval-required');
  const byHuman = runAction({ root: store, action: 'import', actor: 'human', payload: { path: file }, cwd, now: NOW });
  assert.equal(byHuman.ok, true, JSON.stringify(byHuman).slice(0, 400));
  const snapshot = buildSnapshot({ root: store, cwd, now: NOW, scan: false });
  assert.ok(snapshot.skills.some((skill) => skill.id === 'heredada'));
  assert.equal(snapshot.skills.find((skill) => skill.id === 'heredada').origin.kind, 'import');
});

test('listAssignedFor es lo que un proyecto carga, sin pasar por el proveedor', () => {
  const store = root();
  const cwd = projectA();
  const created = createOne(store, cwd);
  const projectId = runAction({ root: store, action: 'open', cwd, now: NOW }).project.id;
  runAction({ root: store, action: 'toggle', actor: 'human', payload: { projectId, skillId: created.id, enabled: true }, cwd, now: NOW });
  const assigned = listAssignedFor({ root: store, cwd });
  assert.equal(assigned.project.id, projectId);
  assert.deepEqual(assigned.skills.map((entry) => entry.skill.id), [created.id]);
});

test('una acción que no existe se dice, no se ignora', () => {
  const store = root();
  const unknown = runAction({ root: store, action: 'inventada', now: NOW });
  assert.equal(unknown.code, 'unknown-action');
});
