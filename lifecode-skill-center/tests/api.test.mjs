/**
 * El borde del producto: lo que ven la herramienta del agente, el panel y el proveedor de skills.
 * Aquí se prueban las políticas (quién puede qué) y la promesa central — una skill activada en un
 * proyecto se carga en ese proyecto y sólo en ese.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { buildSnapshot, runAction, listAssignedFor, centerRoot, API_VERSION, API_PREFIX, CHANNEL_API, CHANNEL_BROWSER, handleApiRequest, healthPayload } from '../lib/api.mjs';
import { skillProviderFor } from '../lib/provider.mjs';
import { loadState, centerFile, materializedRoot } from '../lib/state.mjs';
import { parseSkillFile } from '../lib/skillfile.mjs';
import { candidate, tempProject, tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-11-08T12:00:00.000Z';
const root = () => autonomyRoot('lsc-api');
const projectA = () => tempProject('proyecto-a', autonomyRoot('lsc-cwd'));
const projectB = () => tempProject('proyecto-b', autonomyRoot('lsc-cwd'));

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

test('abrir el panel dos veces escribe una sola vez: la segunda apertura no es un cambio', () => {
  const store = root();
  const cwd = projectA();
  runAction({ root: store, action: 'open', cwd, now: NOW });
  const first = loadState(store).state.updatedAt;
  const again = runAction({ root: store, action: 'open', cwd, now: '2026-11-09T10:00:00.000Z' });
  assert.equal(again.ok, true);
  assert.equal(again.project.registered, true);
  const second = loadState(store).state.updatedAt;
  assert.equal(second, first, 'una apertura repetida no puede tocar el documento ni despertar al vigilante');
  assert.equal(Object.keys(loadState(store).state.projects).length, 1);
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
  assert.deepEqual(snapshot.skills[0].adoption, [], 'sin asignaciones no hay filas de adopción');
  assert.equal(snapshot.totals.skills, 1);
  assert.equal(snapshot.analytics.skills.total, 1);
});

test('la matriz de adopción publica encendidas, apagadas y las que van por detrás de la vigente', () => {
  const store = root();
  const cwd = projectA();
  const others = tempProject('proyecto-matriz', store);
  mkdirSync(cwd, { recursive: true });
  mkdirSync(others, { recursive: true });

  const created = createOne(store, cwd);
  runAction({ root: store, action: 'open', cwd, now: NOW, actor: 'human' });
  runAction({ root: store, action: 'open', cwd: others, now: NOW, actor: 'human' });
  const projects = loadState(store).state.projects;
  const rowA = Object.values(projects).find((project) => project.cwd === cwd.replaceAll('\\', '/'));
  const rowB = Object.values(projects).find((project) => project.cwd === others.replaceAll('\\', '/'));
  assert.ok(rowA !== undefined && rowB !== undefined);

  const onA = runAction({ root: store, action: 'toggle', payload: { projectId: rowA.id, skillId: created.id, enabled: true }, now: NOW, actor: 'human', cwd });
  assert.equal(onA.ok, true, `encender en A: ${onA.code ?? ''} ${onA.message ?? ''}`);
  const onB = runAction({ root: store, action: 'toggle', payload: { projectId: rowB.id, skillId: created.id, enabled: true }, now: NOW, actor: 'human', cwd });
  assert.equal(onB.ok, true, `encender en B: ${onB.code ?? ''} ${onB.message ?? ''}`);
  const offB = runAction({ root: store, action: 'toggle', payload: { projectId: rowB.id, skillId: created.id, enabled: false }, now: NOW, actor: 'human', cwd });
  assert.equal(offB.ok, true, `apagar en B: ${offB.code ?? ''} ${offB.message ?? ''}`);

  const snapshot = buildSnapshot({ root: store, cwd, now: NOW, scan: false });
  const adoption = snapshot.skills[0].adoption;
  assert.equal(adoption.length, 2, 'una fila por TODO proyecto que tenga la skill, encendida o no');
  const byProject = Object.fromEntries(adoption.map((row) => [row.projectId, row]));
  assert.equal(byProject[rowA.id].enabled, true);
  assert.equal(byProject[rowA.id].version, '1.0.0');
  assert.equal(byProject[rowB.id].enabled, false, 'una apagada sigue siendo visible en la matriz');
  assert.deepEqual(snapshot.skills[0].enabledIn, [rowA.id]);
  assert.deepEqual(adoption.map((row) => row.projectId), [...adoption.map((row) => row.projectId)].sort(), 'orden estable por proyecto');
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

  // Encender ya deja el disco al día: la vista materializada se rehace en el mismo acto, así que el
  // `sync` explícito posterior no tiene nada que escribir (antes hacía falta sincronizar a mano).
  const projectDirectory = join(materializedRoot(store), projectId);
  assert.ok(existsSync(join(projectDirectory, created.id, 'SKILL.md')), 'encender escribe el SKILL.md de la skill en su carpeta');
  const manifestBefore = JSON.parse(readFileSync(join(projectDirectory, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifestBefore.skills.map((entry) => `${entry.id}@${entry.version}`), [`${created.id}@1.0.0`]);

  const first = runAction({ root: store, action: 'sync', cwd, now: NOW, payload: { projectId } });
  assert.equal(first.ok, true);
  assert.equal(first.results.length, 1);
  assert.deepEqual(first.results[0].written, [], 'encender ya lo escribió');
  const directory = first.results[0].directory;
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.projectId, projectId);
  assert.deepEqual(manifest.skills.map((entry) => `${entry.id}@${entry.version}`), [`${created.id}@1.0.0`]);

  const second = runAction({ root: store, action: 'sync', cwd, now: NOW, payload: { projectId } });
  assert.deepEqual(second.results[0].written, [], 'sin cambios no se reescribe');
  assert.ok(second.results[0].unchanged >= 2);
});

test('cambiar la versión fijada reescribe el SKILL.md materializado en el mismo acto', () => {
  const store = root();
  const cwd = projectA();
  const created = createOne(store, cwd);
  const projectId = runAction({ root: store, action: 'open', cwd, now: NOW }).project.id;
  runAction({ root: store, action: 'toggle', actor: 'human', payload: { projectId, skillId: created.id, enabled: true }, cwd, now: NOW });

  const improved = runAction({
    root: store,
    action: 'improve',
    actor: 'ai',
    cwd,
    payload: { skillId: created.id, rationale: 'Añade un límite explícito.', body: `${candidate().body}\n\n## Limite\n\nQue el catálogo la ofrezca no prueba que se aplicara.` },
    now: NOW,
  });
  assert.equal(improved.ok, true);
  const approved = runAction({ root: store, action: 'decide', actor: 'human', cwd, payload: { improvementId: improved.improvementId, decision: 'approve' }, now: NOW });
  assert.equal(approved.ok, true);

  const skillFile = join(materializedRoot(store), projectId, created.id, 'SKILL.md');
  assert.ok(!readFileSync(skillFile, 'utf8').includes('## Limite'), 'la asignación sigue fijada a la 1.0.0');

  const moved = runAction({ root: store, action: 'rollback', actor: 'human', cwd, payload: { projectId, skillId: created.id, version: approved.version.version }, now: NOW });
  assert.equal(moved.ok, true);
  assert.ok(readFileSync(skillFile, 'utf8').includes('## Limite'), 'fijar la 1.1.0 la escribe sin pedir sync');
});

test('la detección ve la biblioteca propia y las skills que ya viven en el disco', () => {
  const store = root();
  const cwd = tempProject('proyecto-con-skills', autonomyRoot('lsc-detect'));
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
  const cwd = tempProject('proyecto-import', autonomyRoot('lsc-import'));
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


/* ------------------------------------------------------------------------------------------- */
/* El despacho HTTP: la misma lógica que el adaptador monta, probada sin Node ni harness.       */
/* ------------------------------------------------------------------------------------------- */

test('el despacho HTTP respeta ruta, método, cuerpo y aviso de invalidación', async () => {
  const root = autonomyRoot('lsc-http');
  const skill = candidate();
  const base = API_PREFIX + '/state';

  const foreign = handleApiRequest({ root, method: 'GET', pathname: '/otra-cosa' });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.code, 'not-found');

  const method = handleApiRequest({ root, method: 'DELETE', pathname: base });
  assert.equal(method.status, 405);
  assert.match(method.body.message, /GET/);

  const broken = handleApiRequest({ root, method: 'POST', pathname: base, body: null });
  assert.equal(broken.status, 400);
  assert.equal(broken.body.code, 'bad-request');

  const read = handleApiRequest({ root, method: 'GET', pathname: base, search: '?scan=0', hostCwd: 'C:/proyecto/actual' });
  assert.equal(read.status, 200);
  assert.equal(read.body.ok, true);
  assert.equal(read.body.project.cwd, 'C:/proyecto/actual');
  assert.equal(read.invalidate, false, 'leer no invalida nada');

  const created = handleApiRequest({
    root,
    method: 'POST',
    pathname: base,
    body: { action: 'create', actor: 'human', payload: skill },
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true, JSON.stringify(created.body.findings ?? created.body.message ?? ''));
  assert.equal(created.invalidate, true, 'crear cambia el catálogo');

  const refused = handleApiRequest({
    root,
    method: 'POST',
    pathname: base,
    body: { action: 'create', actor: 'human', payload: skill },
  });
  assert.equal(refused.body.code, 'exists', 'la segunda vez la skill ya existe');
  assert.equal(refused.invalidate, false, 'sin cambio no hay nada que invalidar');
});

// ── S1: el despacho distingue canal y no acepta un actor del cuerpo ───────────────────────────────

test('/health sólo dice si el Host puede autenticar, sin datos privados', () => {
  const health = healthPayload({ auth: 'host' });
  assert.deepEqual(Object.keys(health).sort(), ['apiVersion', 'auth', 'ok']);
  assert.equal(health.auth, 'host');
  assert.equal(healthPayload().auth, 'unavailable');
  assert.equal(healthPayload({ auth: 'otra-cosa' }).auth, 'unavailable', 'sólo host o unavailable: nada intermedio');
});

test('una credencial de operador lee el centro pero no lo cambia', () => {
  const store = root();
  const cwd = projectA();
  createOne(store, cwd);
  const read = handleApiRequest({ root: store, method: 'GET', pathname: `${API_PREFIX}/state`, search: '?scan=0', channel: CHANNEL_API });
  assert.equal(read.status, 200);
  assert.equal(read.body.skills.length, 1);

  const write = handleApiRequest({
    root: store,
    method: 'POST',
    pathname: `${API_PREFIX}/state`,
    body: { action: 'create', payload: candidate({ id: 'otra-skill-de-prueba', description: 'Otra skill de prueba del centro con una descripción larga y suficiente' }) },
    channel: CHANNEL_API,
  });
  assert.equal(write.status, 403);
  assert.equal(write.body.code, 'api-peer-restricted');
  assert.equal(Object.keys(loadState(store).state.skills).length, 1, 'lo denegado no puede haber escrito');
});

test('el actor del panel lo pone el canal: el cuerpo no puede escribirlo', () => {
  const store = root();
  const cwd = projectA();
  const created = createOne(store, cwd);
  const registered = runAction({ root: store, action: 'register-project', actor: 'human', cwd });
  assert.equal(registered.ok, true);
  const project = registered.project;
  const response = handleApiRequest({
    root: store,
    method: 'POST',
    pathname: `${API_PREFIX}/state`,
    body: {
      action: 'toggle',
      actor: 'ai',
      payload: { projectId: project.id, skillId: created.id, enabled: true },
    },
    channel: CHANNEL_BROWSER,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true, JSON.stringify(response.body));
  const state = loadState(store).state;
  assert.equal(state.assignments[project.id][created.id].by, 'human', 'el cuerpo no elige quién firma');
  assert.equal(state.events[state.events.length - 1].actor, 'human');
});

test('la analítica se puede acotar por proyecto y ventana desde la ruta', () => {
  const store = root();
  const cwd = projectA();
  const created = runAction({
    root: store, action: 'create', cwd, now: NOW, actor: 'ai',
    payload: candidate({ id: 'skill-analitica', title: 'Skill de analítica' }),
  });
  assert.equal(created.ok, true);
  const snapshot = handleApiRequest({ root: store, method: 'GET', pathname: API_PREFIX, search: '?scan=0', now: NOW });
  assert.equal(snapshot.status, 200);
  const scoped = handleApiRequest({
    root: store, method: 'GET', pathname: API_PREFIX, search: '?scan=0&days=7&project=no-existe', now: NOW,
  });
  assert.equal(scoped.status, 200);
  assert.equal(scoped.body.analytics.series.length, 7, 'la ventana pedida llega al resumen');
  assert.equal(scoped.body.analytics.assignments.total, 0, 'un proyecto inexistente no hereda las cifras globales');
});
