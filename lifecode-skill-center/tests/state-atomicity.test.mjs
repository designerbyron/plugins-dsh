// El contrato de atomicidad no se puede probar mirando el código: se mide. Un `writeFileSync` directo
// sobre el destino deja el mismo fichero (misma fecha de creación); `tmp` + `rename` publica uno nuevo.
// Esta prueba falló de verdad cuando el auditor de pruebas sustituyó el rename por escritura directa.
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { emptyState, loadState, saveState } from '../lib/state.mjs';
import { join as joinPath } from 'node:path';
import { mkdirSync, writeFileSync as write } from 'node:fs';
import { tempRoot, autonomyRoot } from './helpers.mjs';

test('guardar publica un fichero nuevo (tmp + rename), no reescribe el existente', () => {
  const root = autonomyRoot('atomic');
  const file = join(root, 'center.json');
  write(file, `${JSON.stringify(emptyState('2026-11-09T12:00:00.000Z'), null, 2)}\n`, 'utf8');
  const before = statSync(file).birthtimeMs;

  const until = Date.now() + 30;
  while (Date.now() < until) { /* el sistema de ficheros necesita un instante distinto */ }

  const loaded = loadState(root);
  assert.equal(loaded.integrity, 'ok', 'el almacén sembrado tiene que leerse');
  saveState(root, loaded.state, { now: '2026-11-09T12:05:00.000Z' });

  const after = statSync(file).birthtimeMs;
  assert.ok(after > before, `el destino tiene que ser un fichero nuevo (antes ${before}, después ${after})`);
});
