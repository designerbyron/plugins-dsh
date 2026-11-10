import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { handleApiRequest, runAction } from '../lib/api.mjs';
import { loadState } from '../lib/state.mjs';
import { candidate, tempProject, tempRoot, autonomyRoot } from './helpers.mjs';

const BODY_V1 = `## Procedimiento

Lee el manifiesto y ejecuta la suite de pruebas antes de instalar nada.
Anota lo que falta con el comando que lo arregla.

## Evidencia

Deja el resultado de las pruebas y el estado de git.`;

const BODY_V2 = `## Procedimiento

Lee el manifiesto y ejecuta la suite de pruebas antes de instalar nada.
Anota lo que falta con el comando que lo arregla.

## Evidencia

Deja el resultado de las pruebas y el estado de git.

## Limite

Que el catalogo ofrezca la skill no prueba que el modelo la aplicara.`;

async function seed(label) {
  const root = autonomyRoot(label);
  const cwd = tempProject('proyecto-diff', root);
  const created = await runAction({
    root,
    action: 'create',
    cwd,
    actor: 'human',
    payload: { ...candidate({ body: BODY_V1 }), id: 'skill-para-diff' },
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const proposed = await runAction({
    root,
    action: 'improve',
    cwd,
    actor: 'ai',
    payload: { skillId: 'skill-para-diff', body: BODY_V2, rationale: 'dejar dicho que entrega no es aplicación' },
  });
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  const decided = await runAction({
    root,
    action: 'decide',
    cwd,
    actor: 'human',
    payload: { improvementId: proposed.improvementId, decision: 'approve' },
  });
  assert.equal(decided.ok, true, JSON.stringify(decided));
  return { root, cwd };
}

test('la comparación devuelve las líneas añadidas y el sello de cada versión', async () => {
  const { root } = await seed('diff-ok');
  const response = await handleApiRequest({
    root,
    method: 'GET',
    pathname: '/lifecode-skill-center/api/diff',
    search: '?id=skill-para-diff&from=1.0.0&to=1.1.0',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.from.version, '1.0.0');
  assert.equal(response.body.to.version, '1.1.0');
  assert.equal(response.body.added, 4, 'las cuatro líneas de la sección nueva');
  assert.equal(response.body.removed, 0);
  assert.ok(response.body.preview.some((line) => line.kind === 'added' && line.text.includes('## Limite')));
  assert.ok(response.body.from.checksum !== response.body.to.checksum);
  assert.ok(response.body.from.score >= 0 && response.body.to.score >= 0);
});

test('la comparación en el sentido contrario cuenta las líneas retiradas', async () => {
  const { root } = await seed('diff-reverse');
  const response = await handleApiRequest({
    root,
    method: 'GET',
    pathname: '/lifecode-skill-center/api/diff',
    search: '?id=skill-para-diff&from=1.1.0&to=1.0.0',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.added, 0);
  assert.equal(response.body.removed, 4);
});

test('la comparación no escribe en el centro', async () => {
  const { root } = await seed('diff-no-write');
  const before = loadState(root);
  await handleApiRequest({
    root,
    method: 'GET',
    pathname: '/lifecode-skill-center/api/diff',
    search: '?id=skill-para-diff&from=1.0.0&to=1.1.0',
  });
  const after = loadState(root);
  assert.equal(after.sha256, before.sha256);
  assert.equal(after.size, before.size);
});

test('sin id, sin from o sin to la ruta responde 400 y no supone nada', async () => {
  const { root } = await seed('diff-bad-request');
  for (const search of ['', '?id=skill-para-diff', '?id=skill-para-diff&from=1.0.0', '?from=1.0.0&to=1.1.0']) {
    const response = await handleApiRequest({ root, method: 'GET', pathname: '/lifecode-skill-center/api/diff', search });
    assert.equal(response.status, 400, `esperaba 400 para «${search}»`);
    assert.equal(response.body.code, 'bad-request');
  }
});

test('una skill inexistente y una versión inexistente se distinguen', async () => {
  const { root } = await seed('diff-missing');
  const noSkill = await handleApiRequest({
    root,
    method: 'GET',
    pathname: '/lifecode-skill-center/api/diff',
    search: '?id=no-existe&from=1.0.0&to=1.1.0',
  });
  assert.equal(noSkill.status, 404);
  assert.equal(noSkill.body.code, 'skill-not-found');

  const noVersion = await handleApiRequest({
    root,
    method: 'GET',
    pathname: '/lifecode-skill-center/api/diff',
    search: '?id=skill-para-diff&from=1.0.0&to=9.9.9',
  });
  assert.equal(noVersion.status, 404);
  assert.equal(noVersion.body.code, 'version-not-found');
  assert.match(noVersion.body.message, /9\.9\.9/);
});

test('el centro ilegible no inventa una comparación', async () => {
  const { root } = await seed('diff-unreadable');
  const file = join(root, 'center.json');
  const fs = await import('node:fs');
  fs.writeFileSync(file, '{"schemaVersion": 2, "skills": {', 'utf8');
  const response = await handleApiRequest({
    root,
    method: 'GET',
    pathname: '/lifecode-skill-center/api/diff',
    search: '?id=skill-para-diff&from=1.0.0&to=1.1.0',
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'store-unreadable');
  // El original sigue byte a byte: comparar no puede ser la excusa para perder el archivo dañado.
  assert.equal(fs.readFileSync(file, 'utf8'), '{"schemaVersion": 2, "skills": {');
});
