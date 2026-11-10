/**
 * Contrato de la foto que se refresca (§12): el barrido del disco no va por defecto.
 *
 * La foto se pide cada 20 s desde el panel. Si barrer las skills externas (biblioteca del usuario, proyecto)
 * fuera el camino por defecto, cada refresco costaba decenas de milisegundos y lecturas de disco sin que nadie
 * las mirara. Medido en esta máquina con 200 skills y 4 000 eventos: 101 ms con barrido, 31 ms sin él.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildSnapshot, handleApiRequest } from '../lib/api.mjs';
import { saveState, emptyState } from '../lib/state.mjs';
import { tempRoot, autonomyRoot } from './helpers.mjs';

const NOW = '2026-01-01T00:00:00.000Z';

function seedWithExternal() {
  const root = autonomyRoot('lsc-scan-root');
  const cwd = autonomyRoot('lsc-scan-cwd');
  saveState(root, emptyState(NOW), { now: NOW });

  // Una skill externa reconocible en el proyecto: si el barrido corre, aparece como candidata.
  const dir = join(cwd, '.dsh', 'skills', 'skill-externa-de-prueba');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), [
    '---',
    'name: skill-externa-de-prueba',
    'description: Skill externa que ya existe en el proyecto y el barrido puede detectar',
    'whenToUse: Cuando haya que comprobar si la foto barrió el disco',
    '---',
    '',
    '# Procedimiento',
    '',
    'Uno: no hagas nada, esta skill sólo existe para medir el barrido.',
    '',
    '## Evidencia',
    '',
    'Dos: si aparece en la foto sin pedirla, el barrido se coló donde no debía.',
    '',
  ].join('\n'), 'utf8');

  return { root, cwd };
}

test('la foto no barre el disco salvo que se pida', () => {
  const { root, cwd } = seedWithExternal();

  const quiet = buildSnapshot({ root, cwd, now: NOW });
  assert.equal(quiet.ok, true);
  assert.equal(quiet.external.total, 0, 'sin pedirlo no se camina el proyecto');
  assert.deepEqual(quiet.external.candidates, []);

  const scanned = buildSnapshot({ root, cwd, now: NOW, scan: true });
  assert.equal(scanned.ok, true);
  // El barrido real también ve la biblioteca del usuario, así que se comprueba que **está** la del proyecto
  // en vez de fijar un total que depende de lo que haya en esta máquina.
  assert.ok(scanned.external.total >= 1, 'pedido explícitamente, sí aparece');
  assert.ok(
    scanned.external.candidates.some((candidate) => candidate.id === 'skill-externa-de-prueba'),
    'la skill del proyecto tiene que estar entre las candidatas',
  );
});

test('la ruta del panel no barre salvo scan=1, y abrir el panel tampoco', () => {
  const { root, cwd } = seedWithExternal();
  const search = `?cwd=${encodeURIComponent(cwd)}`;

  const quiet = handleApiRequest({ root, method: 'GET', pathname: '/lifecode-skill-center/api/state', search, now: NOW });
  assert.equal(quiet.status, 200);
  assert.equal(quiet.body.external.total, 0);

  const scanned = handleApiRequest({ root, method: 'GET', pathname: '/lifecode-skill-center/api/state', search: `${search}&scan=1`, now: NOW });
  assert.equal(scanned.status, 200);
  assert.ok(scanned.body.external.total >= 1);
  assert.ok(scanned.body.external.candidates.some((candidate) => candidate.id === 'skill-externa-de-prueba'));

  const opened = handleApiRequest({ root, method: 'POST', pathname: '/lifecode-skill-center/api/state', body: { action: 'open', cwd }, now: NOW });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.external.total, 0, 'abrir el panel no puede costar un barrido');
});
