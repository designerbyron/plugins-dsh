/**
 * Contrato del panel para la portabilidad y la verificación de origen.
 *
 * Se comprueba sobre el fichero del cliente porque lo que se fija es **lo que la persona ve**: que existan
 * las claves en los dos idiomas, que el aviso de portabilidad se dispare cuando el servidor lo manda, y que
 * el panel lea `origin.verified` (el campo que el servidor publica) y no un `verified` de la raíz que no
 * existe — leer el campo equivocado hacía que dijera «no se pudo verificar» justo cuando sí se verificó.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

test('las claves de portabilidad existen en los dos idiomas', () => {
  for (const key of ['library.import.warn', 'drawer.export.warn', 'analytics.knowledge.origin.notDeclared']) {
    const occurrences = client.split(`'${key}'`).length - 1;
    assert.ok(occurrences >= 2, `${key} tiene que estar en ES y EN (encontradas: ${occurrences})`);
  }
});

test('el panel avisa cuando el paquete lleva referencias no portables', () => {
  assert.match(client, /Array\.isArray\(result\.warnings\) && result\.warnings\.length > 0/u);
  assert.match(client, /t\('drawer\.export\.warn', \{ n: String\(result\.warnings\.length\) \}\)/u);
  assert.match(client, /t\('library\.import\.warn', \{ n: String\(result\.warnings\.length\) \}\)/u);
});

test('el panel lee el estado de verificación del campo que el servidor publica', () => {
  assert.match(client, /result\?\.origin\?\.verified === true/u);
  assert.match(client, /origin-not-declared/u);
});
