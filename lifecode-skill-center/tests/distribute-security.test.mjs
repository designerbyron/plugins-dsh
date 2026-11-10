/**
 * Seguridad de la distribución: nombres de fichero y tamaño de entrada.
 * El id viaja desde fuera; sin validar, `../../x` escribiría fuera de `exports/`.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { MAX_BUNDLE_BYTES, bundlePath, readBundle, writeBundle } from '../lib/distribute.mjs';
import { createSkill } from '../lib/operations.mjs';
import { emptyState, loadState, saveState } from '../lib/state.mjs';
import { tempRoot, autonomyRoot } from './helpers.mjs';

const BODY = [
  '# Procedimiento',
  '',
  'Uno: lee el manifiesto y el perfil antes de instalar nada, y anota la versión exacta del plugin que vas',
  'a instalar con el comando que la instala.',
  '',
  '## Evidencia',
  '',
  'Dos: deja el resultado de las pruebas y la ruta tocada, con la huella del almacén antes y después de la',
  'operación, y escribe lo que no se pudo verificar en vez de dar por bueno lo que no se midió.',
].join('\n');

function stateConSkill() {
  const state = emptyState();
  const created = createSkill(state, {
    id: 'skill-distribucion-segura',
    title: 'Skill de distribución segura',
    description: 'Una skill de prueba para comprobar que el nombre del paquete no puede escapar de la carpeta',
    whenToUse: 'Cuando haya que verificar que un id malicioso no escribe fuera de la carpeta de exportaciones',
    tags: ['prueba', 'seguridad'],
    body: BODY,
  }, { now: '2026-01-01T00:00:00.000Z' });
  assert.equal(created.ok, true, created.message);
  return state;
}

test('un id con ".." no produce ruta: se rechaza antes de escribir', () => {
  assert.equal(bundlePath('C:/centro', '../../otro', '1.0.0'), null);
  assert.equal(bundlePath('C:/centro', 'skill-ok', '../../1.0.0'), null);
  assert.equal(bundlePath('C:/centro', 'skill-ok', '1.0.0'), join('C:/centro', 'exports', 'skill-ok-1.0.0.json'));
});

test('exportar con un id inseguro devuelve unsafe-bundle-name y no crea nada', () => {
  const root = autonomyRoot('lsc-dist-unsafe');
  const state = stateConSkill();
  // Se fuerza un id inseguro en el estado para probar la puerta del módulo, no la de creación.
  state.skills['skill-distribucion-segura'].id = '../../fuera';
  state.skills['../../fuera'] = state.skills['skill-distribucion-segura'];
  const before = readBundleBytes(root);
  const written = writeBundle({ root, state, skillId: '../../fuera', now: '2026-02-02T00:00:00.000Z' });
  assert.equal(written.ok, false);
  assert.equal(written.code, 'unsafe-bundle-name');
  assert.equal(existsSync(join(root, 'exports')), false, 'no puede crear la carpeta de exportaciones');
  assert.deepEqual(readBundleBytes(root), before);
});

test('un paquete gigante no se parsea: tope de lectura', () => {
  const big = JSON.stringify({ schema: 'lifecode-skill-center/skill-bundle', schemaVersion: 1, relleno: 'x'.repeat(MAX_BUNDLE_BYTES + 10) });
  const read = readBundle(big);
  assert.equal(read.ok, false);
  assert.equal(read.code, 'bundle-too-large');
});

function readBundleBytes(root) {
  const file = join(root, 'center.json');
  return existsSync(file) ? loadState(root).state : {};
}
