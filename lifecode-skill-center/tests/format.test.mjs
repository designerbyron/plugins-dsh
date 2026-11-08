import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ID_LENGTH,
  bumpVersion,
  compareVersions,
  cwdKey,
  formatVersion,
  isSafeId,
  latestVersion,
  normalizeCwd,
  parseVersion,
  projectIdFor,
  projectNameFor,
  shortHash,
  slugId,
  unique,
  words,
} from '../lib/format.mjs';

test('slugId quita acentos, puntuación y mayúsculas', () => {
  assert.equal(slugId('Compilá y Verificá: ¡un plugin de DSH!'), 'compila-y-verifica-un-plugin-de-dsh');
  assert.equal(slugId('  espacios   de más  '), 'espacios-de-mas');
  // Sin letras no hay id: el llamador lo rechaza con `invalid-id` en vez de inventarse un nombre.
  assert.equal(slugId('***'), '');
});

test('slugId corta en palabra completa y no deja un id a medias', () => {
  const long = 'compila-y-verifica-un-plugin-de-dsh-desde-cero-con-pruebas-hermeticas-y-documentacion';
  const id = slugId(long, 40);
  assert.ok(id.length <= 40, `id demasiado largo: ${id}`);
  assert.ok(isSafeId(id));
  assert.ok(!id.endsWith('-'), `corta en guion: ${id}`);
  assert.ok(long.startsWith(id), 'el corte debe ser un prefijo del texto original');
  // Un texto sin guiones se recorta tal cual, sin quedarse vacío.
  assert.equal(slugId('a'.repeat(80), 10), 'a'.repeat(10));
});

test('isSafeId acepta lo que el frontmatter puede llevar y rechaza el resto', () => {
  assert.equal(isSafeId('skill-de-dsh'), true);
  assert.equal(isSafeId('skill_de_dsh'), false);
  assert.equal(isSafeId('Skill'), false);
  assert.equal(isSafeId(''), false);
  assert.equal(isSafeId(`a-${'b'.repeat(MAX_ID_LENGTH)}`), false);
});

test('normalizeCwd y cwdKey unifican separadores y mayúsculas', () => {
  assert.equal(normalizeCwd('C:\\repo\\plugins\\'), 'C:/repo/plugins');
  assert.equal(normalizeCwd('C:\\\\repo//plugins'), 'C:/repo/plugins');
  assert.equal(normalizeCwd(''), '');
  assert.equal(cwdKey('C:\\Repo\\Plugins'), 'c:/repo/plugins');
});

test('projectIdFor da un id estable, legible y distinto por ruta', () => {
  const first = projectIdFor('C:\\xampp\\htdocs\\plugins-dhs');
  const again = projectIdFor('c:/xampp/htdocs/plugins-dhs');
  const other = projectIdFor('C:\\xampp\\htdocs\\otro');
  assert.equal(first, again, 'la misma ruta con otro separador debe dar el mismo id');
  assert.notEqual(first, other);
  assert.match(first, /^plugins-dhs-[0-9a-f]{8}$/);
  assert.equal(projectNameFor('C:\\xampp\\htdocs\\plugins-dhs'), 'plugins-dhs');
});

test('shortHash es estable y corta a la longitud pedida', () => {
  assert.equal(shortHash('hola'), shortHash('hola'));
  assert.equal(shortHash('hola').length, 12);
  assert.equal(shortHash('hola', 4).length, 4);
  assert.notEqual(shortHash('hola'), shortHash('hola!'));
});

test('parseVersion y formatVersion son la ida y la vuelta', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.equal(parseVersion('1.2'), null);
  assert.equal(parseVersion('v1.2.3'), null);
  assert.equal(formatVersion({ major: 2, minor: 0, patch: 7 }), '2.0.7');
});

test('bumpVersion sube el nivel pedido y pone a cero los siguientes', () => {
  assert.equal(bumpVersion('1.0.0'), '1.1.0');
  assert.equal(bumpVersion('1.0.0', 'patch'), '1.0.1');
  assert.equal(bumpVersion('1.4.2', 'major'), '2.0.0');
  // Una versión ilegible cae a la base, no lanza: el almacén se defiende de sus propios datos.
  assert.equal(bumpVersion('basura'), '1.1.0');
});

test('compareVersions ordena como semver', () => {
  assert.ok(compareVersions('1.2.3', '1.2.4') < 0);
  assert.ok(compareVersions('2.0.0', '1.9.9') > 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(latestVersion(['1.0.0', '1.2.0', '1.1.9']), '1.2.0');
  assert.equal(latestVersion([]), null);
});

test('words parte por palabras útiles y tira las vacías y los acentos', () => {
  const result = words('Desplegar y verificar un plugin de DSH para el proyecto');
  assert.ok(result.includes('desplegar'));
  assert.ok(result.includes('verificar'));
  assert.ok(result.includes('plugin'));
  assert.ok(result.includes('dsh'), 'las siglas cortas sí son señal');
  // Las palabras funcionales no discriminan nada: si contaran, todo se parecería a todo.
  assert.ok(!result.includes('para'));
  assert.ok(!result.includes('proyecto'));
  assert.ok(!result.includes('los'));
});

test('unique deja el primer orden y quita repetidos', () => {
  assert.deepEqual(unique(['b', 'a', 'b', 'a', 'c']), ['b', 'a', 'c']);
  assert.deepEqual(unique([]), []);
});
