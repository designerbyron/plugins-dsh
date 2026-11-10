// Fase 6: sincronizar un proyecto con la biblioteca. El pin no se mueve solo (S4), así que avanzar es una acción
// explícita, humana y por proyecto. Estas pruebas fijan esas tres condiciones.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { API_PREFIX, handleApiRequest, runAction } from '../lib/api.mjs';
import { projectDirectory } from '../lib/materialize.mjs';
import { candidate, tempProject, tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-11-09T12:00:00.000Z';
const LATER = '2026-11-09T13:00:00.000Z';

function published() {
  const root = autonomyRoot('advance');
  const cwd = tempProject('advance', autonomyRoot('advance-cwd'));
  runAction({ root, action: 'create', cwd, now: NOW, actor: 'ai', payload: candidate({ id: 'advance-skill' }) });
  const opened = runAction({ root, action: 'open', cwd, now: NOW });
  const projectId = opened.project.id;
  runAction({ root, action: 'toggle', now: NOW, actor: 'human', payload: { projectId, skillId: 'advance-skill', enabled: true } });
  // Publica 1.1.0: el pin del proyecto se queda en 1.0.0 a propósito.
  const improved = runAction({
    root,
    action: 'improve',
    cwd,
    now: NOW,
    actor: 'ai',
    payload: { skillId: 'advance-skill', rationale: 'Añadir un límite', body: `${candidate().body}\n\n## Limite\n\nOtra sección.` },
  });
  runAction({ root, action: 'decide', now: LATER, actor: 'human', payload: { improvementId: improved.improvementId, decision: 'approve' } });
  return { root, cwd, projectId };
}

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('avanzar lleva el pin a la versión vigente y lo deja dicho en el diario', () => {
  const { root, cwd, projectId } = published();
  const before = handleApiRequest({ root, method: 'GET', pathname: API_PREFIX, search: `?scan=0&cwd=${encodeURIComponent(cwd)}`, now: LATER });
  const listed = before.body.projects.find((entry) => entry.id === projectId);
  assert.equal(listed.updatesCount, 1);
  const first = listed.updates[0];
  assert.deepEqual({ skillId: first.skillId, from: first.from, to: first.to }, { skillId: 'advance-skill', from: '1.0.0', to: '1.1.0' });
  assert.equal(typeof first.title, 'string');
  assert.ok(first.title.length > 0);

  const advanced = runAction({ root, action: 'advance', cwd, now: LATER, actor: 'human', payload: { projectId } });
  assert.equal(advanced.ok, true);
  assert.deepEqual(advanced.updated, [{ skillId: 'advance-skill', from: '1.0.0', to: '1.1.0' }]);

  const after = handleApiRequest({ root, method: 'GET', pathname: API_PREFIX, search: `?scan=0&cwd=${encodeURIComponent(cwd)}`, now: LATER });
  const row = after.body.projects.find((entry) => entry.id === projectId);
  assert.equal(row.updatesCount, 0);
  assert.equal(after.body.assignments[projectId]['advance-skill'].version, '1.1.0');
  assert.equal(after.body.events.some((event) => event.type === 'skill.advanced'), true);
});

test('la sincronización escribe el SKILL.md en el mismo acto', () => {
  const { root, projectId } = published();
  runAction({ root, action: 'advance', now: LATER, actor: 'human', payload: { projectId } });
  const file = join(projectDirectory(root, projectId), 'advance-skill', 'SKILL.md');
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes('version: "1.1.0"'), text.slice(0, 200));
  assert.ok(text.includes('## Limite'));
});

test('las skills apagadas conservan su versión: no se sincroniza lo que no está encendido', () => {
  const { root, projectId } = published();
  runAction({ root, action: 'toggle', now: LATER, actor: 'human', payload: { projectId, skillId: 'advance-skill', enabled: false } });
  const advanced = runAction({ root, action: 'advance', now: LATER, actor: 'human', payload: { projectId } });
  assert.equal(advanced.ok, true);
  assert.deepEqual(advanced.updated, []);
  const after = handleApiRequest({ root, method: 'GET', pathname: API_PREFIX, search: '?scan=0', now: LATER });
  assert.equal(after.body.assignments[projectId]['advance-skill'].version, '1.0.0');
});

test('sincronizar un proyecto no toca otro proyecto', () => {
  const { root, cwd, projectId } = published();
  const otherCwd = tempProject('otro-advance', autonomyRoot('advance-otro'));
  const other = runAction({ root, action: 'open', cwd: otherCwd, now: NOW }).project.id;
  // Se enciende dejando dicho 1.0.0: encender sin versión tomaría la vigente (1.1.0) y la prueba no mediría nada.
  runAction({ root, action: 'toggle', now: NOW, actor: 'human', payload: { projectId: other, skillId: 'advance-skill', enabled: true, version: '1.0.0' } });

  runAction({ root, action: 'advance', cwd, now: LATER, actor: 'human', payload: { projectId } });
  const after = handleApiRequest({ root, method: 'GET', pathname: API_PREFIX, search: '?scan=0', now: LATER });
  assert.equal(after.body.assignments[projectId]['advance-skill'].version, '1.1.0');
  assert.equal(after.body.assignments[other]['advance-skill'].version, '1.0.0', 'el otro proyecto sigue donde estaba');
});

test('sin nada que avanzar no escribe ni inventa eventos', () => {
  const { root, projectId } = published();
  runAction({ root, action: 'advance', now: LATER, actor: 'human', payload: { projectId } });
  const file = join(root, 'center.json');
  const before = sha(file);
  const again = runAction({ root, action: 'advance', now: LATER, actor: 'human', payload: { projectId } });
  assert.equal(again.ok, true);
  assert.deepEqual(again.updated, []);
  assert.equal(sha(file), before, 'la segunda pasada no debe escribir');
});

test('la IA no puede avanzar los pins de un proyecto', () => {
  const { root, projectId } = published();
  const file = join(root, 'center.json');
  const before = sha(file);
  const refused = runAction({ root, action: 'advance', now: LATER, actor: 'ai', payload: { projectId } });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'approval-required');
  assert.equal(sha(file), before, 'un rechazo no puede tocar el documento');
});

test('un proyecto desconocido se rechaza en voz alta', () => {
  const { root } = published();
  const refused = runAction({ root, action: 'advance', now: LATER, actor: 'human', payload: { projectId: 'no-existe' } });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'unknown-project');
});
