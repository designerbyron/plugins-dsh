/**
 * Detección de lo que ya existe: la pregunta «¿esta máquina ya sabe esto?» es la primera del producto.
 *
 * Lo que se fija aquí es la tolerancia: dos descripciones que dicen lo mismo con otra conjugación tienen
 * que parecerse, y dos cosas distintas no. El umbral vive en `api.mjs`; el parecido, aquí.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { jaccard, lexical, rank, sharedWords, candidateWords, idAffinity, tokensMatch } from '../lib/detect.mjs';

const library = [
  {
    id: 'desplegar-en-la-nube',
    name: 'desplegar-en-la-nube',
    title: 'Desplegar en la nube',
    description: 'Despliega el servicio en la nube y verifica que el despliegue responda',
    whenToUse: 'Cuando haya que desplegar el servicio en la nube',
    tags: ['despliegue', 'nube'],
  },
  {
    id: 'cocina-el-centro-de-skills',
    name: 'cocina-el-centro-de-skills',
    title: 'Cocina el centro de skills',
    description: 'Cocina el centro de skills de Lifecode con pruebas herméticas y evidencia legible',
    whenToUse: 'Cuando haya que crear o revisar una skill del centro de Lifecode',
    tags: ['dsh', 'skills'],
  },
];

test('las palabras del candidato salen normalizadas y sin palabras vacías', () => {
  const words = candidateWords({ id: 'desplegar-en-la-nube', description: 'Desplegar el servicio para el proyecto' });
  assert.ok(words.has('desplegar'));
  assert.ok(!words.has('para'));
  assert.ok(!words.has('proyecto'));
});

test('la familia de una palabra cuenta: desplegar y despliega no son términos distintos', () => {
  assert.equal(tokensMatch('desplegar', 'despliega'), true);
  assert.equal(tokensMatch('nube', 'nubes'), true);
  assert.equal(tokensMatch('dsh', 'nube'), false, 'las palabras cortas no se emparejan por prefijo');
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3, 'jaccard sigue siendo la medida exacta');
});

test('una consulta con la misma intención encuentra lo que ya existe', () => {
  const matches = rank(
    { id: 'desplegar-servicio-nube', description: 'Despliega el servicio en la nube y comprueba que responde' },
    library,
    { threshold: 0.16 },
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'desplegar-en-la-nube');
  assert.ok(matches[0].score >= 0.16);
  assert.match(matches[0].why, /comparte:/);
  assert.match(matches[0].why, /desplegar|nube/);
});

test('energía distinta no se parece, y el umbral la deja fuera', () => {
  const matches = rank(
    { id: 'informe-mensual-de-ventas', description: 'Prepara el informe mensual de ventas por región' },
    library,
    { threshold: 0.16 },
  );
  assert.deepEqual(matches, []);
});

test('el mismo id gana, y un prefijo compartido acerca', () => {
  assert.equal(idAffinity('cocina-el-centro', 'cocina-el-centro-de-skills') > 0.6, true);
  assert.equal(idAffinity('cocina-el-centro', 'desplegar-en-la-nube'), 0);
  const ranked = rank({ id: 'cocina-el-centro-de-skills', description: '' }, library, { threshold: 0.2 });
  assert.equal(ranked[0].id, 'cocina-el-centro-de-skills');
  assert.equal(ranked[0].why, 'mismo id');
});

test('sharedWords devuelve como mucho lo que se le pide y lexical no miente con vacíos', () => {
  assert.ok(sharedWords(new Set(['a', 'b', 'c']), new Set(['a', 'b', 'c']), 2).length <= 2);
  assert.equal(lexical(new Set(), new Set(['a'])), 0);
});
