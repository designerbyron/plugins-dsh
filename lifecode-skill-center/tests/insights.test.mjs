/* Indicadores analíticos: filtros, comparaciones, pins y frescura de la copia. Todo en cajas de arena. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { tempRoot, tempProject, candidate, autonomyRoot } from './helpers.mjs';
import { runAction, handleApiRequest, doctorPayload, API_PREFIX } from '../lib/api.mjs';
import { buildInsights, parseFilters, compareReferences, eventStatus, eventResult, EVENT_STATUSES, EVENT_RESULTS } from '../lib/insights.mjs';

function storeHash(root) {
  const path = join(root, 'center.json');
  const bytes = readFileSync(path);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}

/** Siembra un centro con dos proyectos, una skill asignada en A y un pin atrasado en B. */
function seed() {
  const root = autonomyRoot('lsc-insights');
  const a = tempProject('proyecto-a', root);
  const b = tempProject('proyecto-b', root);
  const opened = { a: runAction({ root, action: 'open', payload: { cwd: a }, cwd: a, now: '2026-11-01T09:00:00.000Z' }), b: runAction({ root, action: 'open', payload: { cwd: b }, cwd: b, now: '2026-11-01T09:00:00.000Z' }) };
  const projectA = opened.a.project.id;
  const projectB = opened.b.project.id;
  const created = runAction({ root, action: 'create', payload: candidate(), actor: 'human', now: '2026-11-02T10:00:00.000Z' });
  assert.equal(created.ok, true, created.message ?? '');
  const skillId = created.skill.id;
  runAction({ root, action: 'publish', payload: { id: skillId, version: '1.0.0' }, actor: 'human', now: '2026-11-02T10:05:00.000Z' });
  runAction({ root, action: 'toggle', payload: { projectId: projectA, skillId, enabled: true, version: '1.0.0' }, actor: 'human', now: '2026-11-03T11:00:00.000Z' });
  runAction({ root, action: 'toggle', payload: { projectId: projectB, skillId, enabled: true, version: '1.0.0' }, actor: 'human', now: '2026-11-03T11:10:00.000Z' });
  const improved = runAction({ root, action: 'improve', payload: { id: skillId, body: `${candidate().body}\n\n## Limite\n\nEl catálogo no es la aplicación.` }, actor: 'ai', now: '2026-11-04T12:00:00.000Z' });
  assert.equal(improved.ok, true, improved.message ?? '');
  runAction({ root, action: 'decide', payload: { improvementId: improved.improvement.id, decision: 'approve' }, actor: 'human', now: '2026-11-04T12:30:00.000Z' });
  // B se queda atrás a propósito: publicar no mueve el pin.
  const currentAfter = JSON.parse(readFileSync(join(root, 'center.json'), 'utf8')).skills[skillId].currentVersion;
  runAction({ root, action: 'advance', payload: { projectId: projectA }, actor: 'human', now: '2026-11-05T13:00:00.000Z' });
  return { root, projectA, projectB, skillId, currentAfter };
}

test('los filtros recortan por fecha, proyecto, skill, tipo y versión sin cambiar el significado', () => {
  const { root, projectA, skillId } = seed();
  const loaded = JSON.parse(readFileSync(join(root, 'center.json'), 'utf8'));

  const all = buildInsights(loaded, { now: '2026-11-06T00:00:00.000Z', filters: parseFilters({ from: '2026-11-01', to: '2026-11-06' }, { now: '2026-11-06T00:00:00.000Z' }) });
  assert.equal(all.ok, true);
  assert.ok(all.events.matched > 0, 'sin eventos no hay nada que medir');

  const onlyA = buildInsights(loaded, { now: '2026-11-06T00:00:00.000Z', filters: parseFilters({ from: '2026-11-01', to: '2026-11-06', project: projectA }, { now: '2026-11-06T00:00:00.000Z' }) });
  assert.ok(onlyA.events.matched < all.events.matched, 'filtrar por proyecto debe recortar eventos');
  assert.equal(onlyA.events.recent.every((event) => event.projectId === projectA), true);

  const type = buildInsights(loaded, { filters: parseFilters({ from: '2026-11-01', to: '2026-11-06', type: 'skill.created' }, { now: '2026-11-06T00:00:00.000Z' }) });
  assert.equal(type.events.byType.length, 1);
  assert.equal(type.events.byType[0].type, 'skill.created');
  assert.equal(type.events.matched, 1);

  const version = buildInsights(loaded, { filters: parseFilters({ from: '2026-11-01', to: '2026-11-06', version: '1.1.0', skill: skillId }, { now: '2026-11-06T00:00:00.000Z' }) });
  assert.equal(version.events.recent.every((event) => event.version === '1.1.0'), true);

  const smallWindow = buildInsights(loaded, { filters: parseFilters({ from: '2026-11-05', to: '2026-11-05' }, { now: '2026-11-06T00:00:00.000Z' }) });
  assert.equal(smallWindow.window.days, 1);
  assert.equal(smallWindow.series.length, 1);
});

test('los indicadores publican pins atrasados, calidad por versión y referencias sin inventar', () => {
  const { root, projectA, projectB, skillId, currentAfter } = seed();
  const loaded = JSON.parse(readFileSync(join(root, 'center.json'), 'utf8'));
  const insights = buildInsights(loaded, { filters: parseFilters({ from: '2026-11-01', to: '2026-11-06' }, { now: '2026-11-06T00:00:00.000Z' }) });

  // B quedó en 1.0.0 cuando la vigente es 1.1.0; A se avanzó. Las dos filas existen y sólo una va por detrás.
  assert.equal(insights.pinsBehind.length, 1, JSON.stringify(insights.pinsBehind));
  assert.equal(insights.pinsBehind[0].projectId, projectB);
  assert.equal(insights.pinsBehind[0].skillId, skillId);
  assert.equal(insights.pinsBehind[0].version, '1.0.0');
  assert.equal(insights.pinsBehind[0].currentVersion, currentAfter);

  const quality = insights.qualityPerVersion.filter((entry) => entry.skillId === skillId);
  assert.ok(quality.length >= 2, 'deben aparecer al menos las dos versiones evaluadas');
  assert.equal(quality[0].version, '1.0.0');
  assert.equal(quality.at(-1).version, currentAfter);
  assert.equal(typeof quality[0].score, 'number');
  assert.equal(quality[0].delta, null, 'la primera versión no tiene contra qué compararse');
  assert.equal(quality.at(-1).delta, quality.at(-1).score - quality.at(-2).score);

  const row = insights.skills.find((entry) => entry.skillId === skillId);
  assert.equal(row.enabledProjects, 2);
  assert.equal(row.versions, quality.length);
  assert.equal(row.pinsBehind, 1);

  assert.equal(insights.improvements.total, 1);
  assert.equal(insights.improvements.approved, 1);
  assert.equal(insights.improvements.approvalRate, 100);

  const totals = insights.references.totals;
  assert.equal(Number.isInteger(totals.added) && Number.isInteger(totals.removed) && Number.isInteger(totals.modified), true);
  // Cada indicador se explica: sin definición y fuente, dos pantallas acaban midiendo cosas distintas.
  for (const key of ['deliveries', 'qualityPerVersion', 'pinsBehind', 'references', 'top']) {
    assert.equal(typeof insights.definitions[key].definition, 'string');
    assert.equal(typeof insights.definitions[key].source, 'string');
    assert.equal(typeof insights.definitions[key].limits, 'string');
  }
});

test('compareReferences distingue añadir, quitar y cambiar el contenido', () => {
  const before = { version: '1.0.0', references: { guia: 'texto viejo', extra: 'se va' } };
  const after = { version: '1.1.0', references: { guia: 'texto nuevo', nueva: 'entra' } };
  const diff = compareReferences(before, after);
  assert.deepEqual(diff.added, ['nueva']);
  assert.deepEqual(diff.removed, ['extra']);
  assert.deepEqual(diff.modified, ['guia']);
});

test('los indicadores no escriben el almacén y la ruta responde con 409 si no se puede leer', () => {
  const { root } = seed();
  const before = storeHash(root);
  const first = buildInsights(JSON.parse(readFileSync(join(root, 'center.json'), 'utf8')), { filters: parseFilters({ from: '2026-11-01', to: '2026-11-06' }, { now: '2026-11-06T00:00:00.000Z' }) });
  const after = storeHash(root);
  assert.deepEqual(after, before, 'leer indicadores no puede escribir');
  assert.ok(first.events.total >= 0);

  const response = handleApiRequest({ root, method: 'GET', pathname: `${API_PREFIX}/insights`, search: '?from=2026-11-01&to=2026-11-06', now: '2026-11-06T00:00:00.000Z' });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.filters.from, '2026-11-01');
  assert.equal(Array.isArray(response.body.eventTypes), true);

  writeFileSync(join(root, 'center.json'), '{"skills":', 'utf8');
  const broken = handleApiRequest({ root, method: 'GET', pathname: `${API_PREFIX}/insights`, now: '2026-11-06T00:00:00.000Z' });
  assert.equal(broken.status, 409);
  assert.equal(broken.body.code, 'store-unreadable');
});

test('la copia íntegra pero anterior se declara anterior, no «verificada» sin más', () => {
  const { root } = seed();
  const doctor = doctorPayload({ root, now: '2026-11-06T00:00:00.000Z' });
  const check = doctor.checks.find((entry) => entry.id === 'backup');
  assert.ok(check !== undefined);
  // Con una copia del estado previo, el diagnóstico no puede dar «ok»: eso hacía creer que el respaldo cubre
  // el documento de hoy (defecto real del panel).
  assert.equal(check.status, 'warn', JSON.stringify(check));
  assert.match(check.detail, /anterior al documento actual/u);
  assert.equal(doctor.backup.fresh, false);
  assert.equal(doctor.backup.verified, true);
});

test('las reversiones de pin salen del diario y declaran su límite', () => {
  const { root, projectA, skillId } = seed();
  runAction({ root, action: 'rollback', payload: { projectId: projectA, skillId }, actor: 'human', now: '2026-11-05T14:00:00.000Z' });
  const loaded = JSON.parse(readFileSync(join(root, 'center.json'), 'utf8'));
  const insights = buildInsights(loaded, { now: '2026-11-06T00:00:00.000Z' });
  assert.equal(insights.rollbacks.total, 1, 'debe contar el evento skill.rollback');
  assert.equal(insights.rollbacks.bySkill.length, 1);
  assert.equal(insights.rollbacks.bySkill[0].skillId, skillId);
  assert.equal(insights.rollbacks.bySkill[0].count, 1);
  assert.ok(insights.rollbacks.latestAt.startsWith('2026-11-05'), 'la fecha de la última reversión debe venir del evento');
  const definition = insights.definitions.rollbacks;
  assert.ok(definition && /skill\.rollback/.test(definition.source), 'la definición debe decir de dónde sale la cifra');
  assert.ok(/no dice si la skill se aplicó/i.test(definition.limits), 'la definición debe declarar su límite');
  // Contar reversiones no escribe el almacén.
  const before = storeHash(root);
  buildInsights(JSON.parse(readFileSync(join(root, 'center.json'), 'utf8')), { now: '2026-11-06T00:00:00.000Z' });
  assert.deepEqual(storeHash(root), before);
});

test('estado y resultado se derivan del evento y el filtro dice algo verdadero', () => {
  const { root, projectA, skillId } = seed();
  const loaded = JSON.parse(readFileSync(join(root, 'center.json'), 'utf8'));
  const now = '2026-11-06T00:00:00.000Z';

  // `eventStatus` y `eventResult` son la regla única; el filtro la usa.
  assert.equal(eventStatus({ type: 'improvement.proposed' }), 'pending');
  assert.equal(eventStatus({ type: 'improvement.approved' }), 'approved');
  assert.equal(eventStatus({ type: 'skill.applied' }), 'applied');
  assert.equal(eventStatus({ type: 'skill.loaded' }), 'other');
  assert.equal(eventResult({ type: 'skill.loaded' }), 'ok');
  assert.equal(eventResult({ type: 'repair.failed' }), 'failed');
  assert.equal(eventResult({ type: 'algo.raro' }), 'info');

  const todos = buildInsights(loaded, { now });
  assert.ok(todos.events.matched > 0, 'el almacén sembrado tiene eventos');
  assert.deepEqual(todos.options.statuses, EVENT_STATUSES);
  assert.deepEqual(todos.options.results, EVENT_RESULTS);
  assert.ok(todos.events.recent.every((event) => typeof event.status === 'string' && typeof event.result === 'string'));

  // Filtrar por resultado «ok» no puede colar un evento fallido, y filtrar por estado «approved»
  // sólo deja eventos de aprobación.
  const ok = buildInsights(loaded, { now, filters: parseFilters({ result: 'ok', from: '2026-11-01', to: '2026-11-06' }, { now }) });
  assert.ok(ok.events.recent.every((event) => event.result === 'ok'));
  const approved = buildInsights(loaded, { now, filters: parseFilters({ status: 'approved', from: '2026-11-01', to: '2026-11-06' }, { now }) });
  assert.ok(approved.events.recent.every((event) => event.status === 'approved'));
  assert.ok(approved.events.matched <= todos.events.matched, 'un filtro no puede ampliar el conjunto');

  // El proyecto A tiene eventos y el filtro de proyecto sigue mandando sobre el estado.
  const porProyecto = buildInsights(loaded, { now, filters: parseFilters({ project: projectA, status: 'other', from: '2026-11-01', to: '2026-11-06' }, { now }) });
  assert.ok(porProyecto.events.recent.every((event) => event.projectId === projectA || event.projectId === undefined));

  // La skill sigue siendo filtrable junto al estado.
  const porSkill = buildInsights(loaded, { now, filters: parseFilters({ skill: skillId, from: '2026-11-01', to: '2026-11-06' }, { now }) });
  assert.ok(porSkill.events.matched > 0);
});
