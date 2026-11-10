/**
 * Distribución (§8): paquete portable, importación como copia aislada y garantías de aislamiento.
 * Todo sobre almacenes temporales; el almacén real no se toca.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';

import { importBundle, readBundle, skillBundle, writeBundle } from '../lib/distribute.mjs';
import { createSkill } from '../lib/operations.mjs';
import { runAction } from '../lib/api.mjs';
import { emptyState, loadState, saveState } from '../lib/state.mjs';
import { tempRoot, autonomyRoot } from './helpers.mjs';

const BODY = [
  '# Procedimiento',
  '',
  'Uno: lee el manifiesto y el perfil antes de instalar nada, y anota qué versión del plugin se va a',
  'instalar con el comando exacto que la instala.',
  '',
  '## Evidencia',
  '',
  'Dos: deja el resultado de las pruebas y la ruta tocada, con la huella del almacén antes y después',
  'de la operación, y escribe lo que no se haya podido verificar en vez de dar por bueno lo que no se midió.',
].join('\n');

function seed() {
  const state = emptyState();
  const created = createSkill(state, {
    id: 'skill-de-prueba-distribucion',
    title: 'Skill de prueba de distribución',
    description: 'Una skill de prueba que sirve para exportar e importar entre centros distintos',
    whenToUse: 'Cuando haya que comprobar que la distribución no toca el original ni sus asignaciones',
    tags: ['prueba', 'distribucion'],
    body: BODY,
    references: { 'references/uno.md': 'contenido de la referencia' },
  }, { now: '2026-01-01T00:00:00.000Z' });
  assert.equal(created.ok, true, created.message);
  return state;
}

test('un paquete lleva su versión, sus referencias y una huella que se puede verificar', () => {
  const state = seed();
  const packaged = skillBundle(state, 'skill-de-prueba-distribucion', { now: '2026-02-02T00:00:00.000Z' });
  assert.equal(packaged.ok, true);
  assert.equal(packaged.bundle.schema, 'lifecode-skill-center/skill-bundle');
  assert.equal(packaged.bundle.skill.version, '1.0.0');
  assert.deepEqual(Object.keys(packaged.bundle.skill.references), ['references/uno.md']);
  assert.match(packaged.bundle.checksum, /^[0-9a-f]{64}$/);

  const reread = readBundle(JSON.stringify(packaged.bundle));
  assert.equal(reread.ok, true);
  assert.equal(reread.checksum, packaged.bundle.checksum);
});

test('un paquete manipulado no entra: la huella no coincide', () => {
  const state = seed();
  const packaged = skillBundle(state, 'skill-de-prueba-distribucion');
  packaged.bundle.skill.body = `${packaged.bundle.skill.body}\n\nAñadido a mano por alguien.`;
  const reread = readBundle(JSON.stringify(packaged.bundle));
  assert.equal(reread.ok, false);
  assert.equal(reread.code, 'checksum-mismatch');
});

test('exportar no reescribe: la segunda exportación de la misma versión se rechaza', () => {
  const root = autonomyRoot('lsc-dist-export');
  saveState(root, seed(), { now: '2026-01-01T00:00:00.000Z' });
  const before = readFileSync(join(root, 'center.json'));

  const first = writeBundle({ root, state: loadState(root).state, skillId: 'skill-de-prueba-distribucion', now: '2026-02-02T00:00:00.000Z' });
  assert.equal(first.ok, true);
  assert.equal(existsSync(first.file), true);
  assert.match(first.file, /skill-de-prueba-distribucion-1\.0\.0\.json$/);

  const second = writeBundle({ root, state: loadState(root).state, skillId: 'skill-de-prueba-distribucion', now: '2026-02-03T00:00:00.000Z' });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'bundle-exists');

  assert.deepEqual(readFileSync(join(root, 'center.json')), before, 'exportar no puede escribir el almacén');
});

test('importar crea una copia aislada y no toca la skill original del centro de destino', () => {
  const origen = seed();
  const packaged = skillBundle(origen, 'skill-de-prueba-distribucion', { now: '2026-02-02T00:00:00.000Z' });
  const bundle = JSON.stringify(packaged.bundle);

  const destino = emptyState();
  // El destino ya tiene una skill con el mismo id: la importación debe renombrar, no sobrescribir.
  const existente = createSkill(destino, {
    id: 'skill-de-prueba-distribucion',
    title: 'La que ya estaba en el destino',
    description: 'Esta skill ya vivía aquí y la importación no puede cambiarla ni quitarle su versión',
    whenToUse: 'Cuando alguien importe un paquete con el mismo id y haya que demostrar el aislamiento',
    tags: ['local'],
    body: BODY,
  }, { now: '2026-01-05T00:00:00.000Z' });
  assert.equal(existente.ok, true);
  const antes = JSON.stringify(destino.skills['skill-de-prueba-distribucion']);

  const read = readBundle(bundle);
  assert.equal(read.ok, true);
  // R16.4: el renombrado ya no es silencioso; la copia se pide explícitamente con `onConflict:'copy'`.
  const imported = importBundle(destino, read.bundle, { now: '2026-03-03T00:00:00.000Z', from: 'centro-a', createSkill, onConflict: 'copy' });
  assert.equal(imported.ok, true, imported.message);
  assert.equal(imported.renamed, true);
  assert.equal(imported.id, 'skill-de-prueba-distribucion-copia');
  assert.equal(destino.skills['skill-de-prueba-distribucion-copia'].origin.kind, 'import');
  assert.equal(destino.skills['skill-de-prueba-distribucion-copia'].origin.from, 'centro-a');
  assert.equal(destino.skills['skill-de-prueba-distribucion-copia'].currentVersion, '1.0.0');
  assert.equal(JSON.stringify(destino.skills['skill-de-prueba-distribucion']), antes, 'la original no puede cambiar');
  assert.deepEqual(destino.assignments, {}, 'importar no asigna nada a ningún proyecto');
});

test('la API exporta e importa, exige persona y deja intacto el almacén al exportar', () => {
  const root = autonomyRoot('lsc-dist-api');
  saveState(root, seed(), { now: '2026-01-01T00:00:00.000Z' });
  const before = readFileSync(join(root, 'center.json'));

  const aiExport = runAction({ root, action: 'export-skill', actor: 'ai', payload: { skillId: 'skill-de-prueba-distribucion' }, now: '2026-02-02T00:00:00.000Z' });
  assert.equal(aiExport.ok, false);
  assert.equal(aiExport.code, 'approval-required');

  const humanExport = runAction({ root, action: 'export-skill', actor: 'human', payload: { skillId: 'skill-de-prueba-distribucion' }, now: '2026-02-02T00:00:00.000Z' });
  assert.equal(humanExport.ok, true, humanExport.message);
  assert.equal(humanExport.exported, true);
  assert.equal(existsSync(humanExport.file), true);
  assert.deepEqual(readFileSync(join(root, 'center.json')), before, 'exportar no escribe el almacén');

  const bundleText = readFileSync(humanExport.file, 'utf8');
  const importIntoOther = runAction({
    root,
    action: 'import-bundle',
    actor: 'human',
    // R16.4: confirmación explícita + copia explícita (nuevo contrato de importación).
    payload: { bundle: bundleText, from: 'otro-centro', confirmed: true, onConflict: 'copy' },
    now: '2026-03-03T00:00:00.000Z',
  });
  assert.equal(importIntoOther.ok, true, importIntoOther.message);
  assert.equal(importIntoOther.renamed, true);
  assert.equal(loadState(root).state.skills[importIntoOther.id].origin.from, 'otro-centro');
});
