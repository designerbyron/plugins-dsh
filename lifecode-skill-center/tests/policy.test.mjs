/**
 * Política de autonomía por proyecto.
 *
 * Lo que se mide: la IA decide **dentro** de una política que fija una persona. No puede cambiarla, ni
 * concederse autonomía, y el cambio queda registrado en el almacén de conocimiento — nunca en
 * `center.json`, que sigue siendo el documento de las skills.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { knowledgeView, runAction, handleApiRequest } from '../lib/api.mjs';
import { knowledgeFile, loadKnowledge, policyFor } from '../lib/knowledge.mjs';

function store() {
  return mkdtempSync(join(tmpdir(), 'lsc-policy-'));
}

test('una persona fija la política de un proyecto y queda registrada', () => {
  const root = store();
  const result = runAction({ root, action: 'policy', actor: 'human', payload: { projectId: 'proyecto-a', mode: 'human-approved' } });
  assert.equal(result.ok, true);
  assert.equal(result.policy.scope, 'project');
  assert.equal(result.policy.projectId, 'proyecto-a');
  assert.equal(result.policy.mode, 'human-approved');
  assert.equal(result.saved, true);

  const loaded = loadKnowledge(root);
  assert.equal(loaded.integrity, 'ok');
  assert.equal(policyFor(loaded.document, 'proyecto-a').mode, 'human-approved');
  assert.equal(policyFor(loaded.document, 'proyecto-b').mode, 'human-approved', 'sin concesión, el resto queda en el modo por defecto seguro');
  assert.equal(existsSync(join(root, 'center.json')), false, 'la política no crea el almacén de las skills');
});

test('la política global cambia el modo de todos los proyectos sin política propia', () => {
  const root = store();
  const result = runAction({ root, action: 'policy', actor: 'human', payload: { projectId: '', mode: 'human-approved' } });
  assert.equal(result.ok, true);
  assert.equal(result.policy.scope, 'global');
  const loaded = loadKnowledge(root);
  assert.equal(policyFor(loaded.document, 'cualquiera').mode, 'human-approved');
  assert.equal(policyFor(loaded.document, '').source, 'global');
});

test('la IA no se concede autonomía: cambiar la política exige una persona', () => {
  const root = store();
  runAction({ root, action: 'policy', actor: 'human', payload: { projectId: 'proyecto-a', mode: 'human-approved' } });
  const before = readFileSync(knowledgeFile(root));
  const refused = runAction({ root, action: 'policy', actor: 'ai', payload: { projectId: 'proyecto-a', mode: 'guarded-autonomous' } });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'approval-required');
  assert.deepEqual(readFileSync(knowledgeFile(root)), before, 'un rechazo no escribe ni un byte');
  assert.equal(policyFor(loadKnowledge(root).document, 'proyecto-a').mode, 'human-approved');
});

test('un modo desconocido se rechaza con su código y no cae al valor por defecto', () => {
  const root = store();
  const refused = runAction({ root, action: 'policy', actor: 'human', payload: { projectId: 'proyecto-a', mode: 'totalmente-autonomo' } });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'policy-mode-unknown');
  assert.equal(existsSync(knowledgeFile(root)), false, 'no se crea el registro para un modo inválido');
});

test('la vista del conocimiento publica la política global y la de cada proyecto', () => {
  const root = store();
  runAction({ root, action: 'policy', actor: 'human', payload: { projectId: '', mode: 'human-approved' } });
  runAction({ root, action: 'policy', actor: 'human', payload: { projectId: 'proyecto-a', mode: 'guarded-autonomous' } });
  const view = knowledgeView({ root });
  assert.equal(view.ok, true);
  assert.equal(view.policy.mode, 'human-approved');
  assert.equal(view.policy.projects['proyecto-a'].mode, 'guarded-autonomous');
  assert.deepEqual(view.modes, ['human-approved', 'guarded-autonomous'], 'la vista enumera los modos válidos');
});

test('la ruta HTTP del panel aplica la política y escribe sólo el registro de conocimiento', () => {
  const root = store();
  const response = handleApiRequest({
    root,
    method: 'POST',
    pathname: '/lifecode-skill-center/api/state',
    body: { action: 'policy', payload: { projectId: 'proyecto-a', mode: 'human-approved' } },
  });
  // El despacho HTTP **es** el canal del panel: la persona que pulsa es quien decide, y el actor no se
  // lee del cuerpo. Lo que se mide aquí es que el cambio llega al registro propio y no al de las skills.
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.saved, true);
  assert.equal(existsSync(knowledgeFile(root)), true);
  assert.equal(existsSync(join(root, 'center.json')), false, 'la política no toca el almacén de las skills');
  assert.equal(policyFor(loadKnowledge(root).document, 'proyecto-a').mode, 'human-approved');
});
