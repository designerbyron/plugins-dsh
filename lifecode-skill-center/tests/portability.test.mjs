/**
 * Aprendizaje entre proyectos: una skill que se comparte **no** puede arrastrar rutas privadas en silencio.
 *
 * Se prueba con dos paquetes: uno limpio y otro cuya referencia apunta a una ruta absoluta de una máquina
 * concreta. El segundo se importa igual (bloquear sería decidir por la persona), pero sale con
 * `portable:false` y el motivo escrito.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { importBundle, privateReferences, skillBundle } from '../lib/distribute.mjs';
import { createSkill } from '../lib/operations.mjs';
import { emptyState } from '../lib/state.mjs';

const BODY = [
  '## Procedimiento',
  '',
  'Revisa el paquete portable antes de importarlo y comprueba que ninguna referencia apunta a una carpeta privada de la maquina de origen.',
  '',
  '## Evidencia',
  '',
  'El paquete importado queda con su propia version y la original no cambia, y ademas declara las referencias que no son portables.',
].join('\n');

/** Estado sembrado con una skill publicada, para exportarla como paquete. */
function seededState(references) {
  const state = emptyState();
  const created = createSkill(state, {
    id: 'skill-con-referencias',
    description: 'Comprueba que una skill distribuida declara las referencias que no son portables entre proyectos',
    whenToUse: 'Cuando haya que compartir una skill con otro centro y revisar antes sus referencias',
    body: BODY,
    tags: ['distribucion', 'portabilidad'],
    references,
  }, { now: '2026-11-09T00:00:00.000Z' });
  assert.equal(created.ok, true);
  return state;
}

test('el paquete declara las referencias con ruta absoluta y no las borra', () => {
  const state = seededState({
    'references/limpia.md': 'Usa la ruta relativa `docs/checklist.md` del propio proyecto.',
    'references/privada.md': 'El resultado esta en C:\\datos\\interno\\salida.json',
  });
  const exported = skillBundle(state, 'skill-con-referencias');
  assert.equal(exported.ok, true);
  assert.equal(exported.bundle.portable, false);
  assert.equal(exported.bundle.warnings.length, 1);
  assert.equal(exported.bundle.warnings[0].path, 'references/privada.md');
  assert.equal(exported.bundle.warnings[0].reason, 'absolute-path');
  // El contenido sigue ahí: se declara, no se censura.
  assert.equal(exported.bundle.skill.references['references/privada.md'], 'El resultado esta en C:\\datos\\interno\\salida.json');
});

test('un paquete sin rutas absolutas se declara portable', () => {
  const state = seededState({ 'references/limpia.md': 'Usa la ruta relativa `docs/checklist.md` del propio proyecto.' });
  const exported = skillBundle(state, 'skill-con-referencias');
  assert.equal(exported.ok, true);
  assert.equal(exported.bundle.portable, true);
  assert.deepEqual(exported.bundle.warnings, []);
});

test('la importacion crea la copia igualmente y avisa de lo que no es portable', () => {
  const source = seededState({ 'references/privada.md': 'El resultado esta en C:\\datos\\interno\\salida.json' });
  const exported = skillBundle(source, 'skill-con-referencias');
  const target = emptyState();
  const imported = importBundle(target, exported.bundle, { createSkill, from: 'centro-a' });
  assert.equal(imported.ok, true);
  assert.equal(imported.portable, false);
  assert.deepEqual(imported.warnings.map((entry) => entry.reason), ['absolute-path']);
  assert.equal(target.skills[imported.id].origin.kind, 'import');
  assert.equal(target.skills[imported.id].origin.from, 'centro-a');
  assert.deepEqual(target.assignments, {}, 'importar no asigna nada en el destino');
});

test('privateReferences distingue rutas POSIX, Windows y de red, y no marca rutas relativas', () => {
  const found = privateReferences({
    'a.md': 'Ver /mnt/datos/datos.csv',
    'b.md': 'Ver C:/datos/datos.csv',
    'c.md': 'Ver \\\\servidor\\share\\datos.csv',
    'd.md': 'Ver docs/datos.csv y ./local/datos.csv',
  });
  assert.deepEqual(found.map((entry) => entry.path), ['a.md', 'b.md', 'c.md']);
});

test('los paquetes no escriben en el almacen que se les pasa', () => {
  const root = mkdtempSync(join(tmpdir(), 'lsc-portable-'));
  try {
    const state = seededState({ 'references/privada.md': 'C:\\datos\\x.json' });
    const before = JSON.stringify(state);
    skillBundle(state, 'skill-con-referencias');
    assert.equal(JSON.stringify(state), before, 'empaquetar es de solo lectura');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('las acciones del panel devuelven el aviso de portabilidad en exportar e importar', async () => {
  const { runAction } = await import('../lib/api.mjs');
  const { readFileSync } = await import('node:fs');
  const { loadState, saveState } = await import('../lib/state.mjs');
  const origin = mkdtempSync(join(tmpdir(), 'lsc-portable-a-'));
  const target = mkdtempSync(join(tmpdir(), 'lsc-portable-b-'));
  try {
    saveState(origin, seededState({ 'references/privada.md': 'El dato esta en /mnt/datos/privado.csv' }), { now: '2026-11-09T00:00:00.000Z' });

    const exported = runAction({ root: origin, action: 'export-skill', actor: 'human', payload: { skillId: 'skill-con-referencias' }, now: '2026-11-09T01:00:00.000Z' });
    assert.equal(exported.ok, true);
    assert.equal(exported.portable, false);
    assert.deepEqual(exported.warnings.map((entry) => entry.reason), ['absolute-path']);

    saveState(target, emptyState(), { now: '2026-11-09T00:00:00.000Z' });
    const bundleText = readFileSync(exported.file, 'utf8');
    const imported = runAction({ root: target, action: 'import-bundle', actor: 'human', payload: { bundle: bundleText, from: 'centro-a', confirmed: true }, now: '2026-11-09T02:00:00.000Z' });
    assert.equal(imported.ok, true);
    assert.equal(imported.portable, false);
    assert.equal(imported.warnings.length, 1);
    assert.equal(loadState(target).state.skills[imported.id].origin.from, 'centro-a');
  } finally {
    rmSync(origin, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
