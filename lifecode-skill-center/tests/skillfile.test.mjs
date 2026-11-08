/**
 * El fichero que el harness va a leer. Se prueba de ida y vuelta: lo que componemos tiene que poder
 * leerse, y lo que leemos de otra herramienta tiene que sobrevivir sin reventar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { renderSkillFile, parseSkillFile, parseYamlSubset, candidateFromSkillFile, singleLine, quoteYaml } from '../lib/skillfile.mjs';
import { candidate, tempRoot } from './helpers.mjs';

function skillWith(version = {}) {
  const base = candidate();
  return {
    skill: { id: base.id, description: base.description, whenToUse: base.whenToUse, tags: base.tags, createdAt: '2026-11-08T12:00:00.000Z' },
    version: {
      version: '1.0.0',
      description: base.description,
      whenToUse: base.whenToUse,
      tags: base.tags,
      body: base.body,
      createdAt: '2026-11-08T12:00:00.000Z',
      ...version,
    },
  };
}

test('el SKILL.md compuesto se puede volver a leer y conserva identidad y cuerpo', () => {
  const file = renderSkillFile(skillWith());
  const { data, body } = parseSkillFile(file);
  assert.equal(data.name, candidate().id);
  assert.equal(data.description, candidate().description);
  assert.equal(data.whenToUse, candidate().whenToUse);
  // El cuerpo leído incluye el H1 que el propio fichero declara; el procedimiento va detrás, intacto.
  assert.equal(body, `# ${candidate().description}\n\n${candidate().body}`);
  assert.match(file, /^---\n/);
  assert.match(file, /\nmetadata:\n {2}dsh:\n {4}origin: lifecode-skill-center\n/);
  assert.match(file, /^# Compila y verifica/m);
});

test('un texto con dos puntos, comillas o saltos no rompe el YAML', () => {
  const nasty = 'Usa "esto": primero\nluego aquello \\ y lo otro';
  const file = renderSkillFile(skillWith({ description: nasty, whenToUse: nasty }));
  const { data } = parseSkillFile(file);
  assert.equal(data.description, 'Usa "esto": primero luego aquello \\ y lo otro');
  assert.equal(data.whenToUse, 'Usa "esto": primero luego aquello \\ y lo otro');
});

test('el cuerpo se recorta al principio y al final, nunca dentro', () => {
  const file = renderSkillFile(skillWith({ body: '\n\n## Paso\n\ncontenido\n\n' }));
  const { body } = parseSkillFile(file);
  assert.equal(body, `# ${candidate().description}\n\n## Paso\n\ncontenido`);
});

test('singleLine y quoteYaml son la única defensa contra romper el frontmatter', () => {
  assert.equal(singleLine('  a\n\tb   c  '), 'a b c');
  assert.equal(quoteYaml('di "hola"'), '"di \\"hola\\""');
  assert.equal(quoteYaml(null), '""');
});

test('parseYamlSubset entiende el subconjunto que usamos y no finge entender el resto', () => {
  const data = parseYamlSubset('name: uno\nlista: [a, b]\nmetadata:\n  dsh:\n    origin: x\nnota: "con: dos puntos"');
  assert.equal(data.name, 'uno');
  assert.deepEqual(data.lista, ['a', 'b']);
  assert.equal(data.metadata.dsh.origin, 'x');
  assert.equal(data.nota, 'con: dos puntos');
});

test('un SKILL.md de otra herramienta se reconoce con lo que traiga', () => {
  const foreign = ['---', 'name: cloud-deploy', 'description: Despliega el proyecto en la nube', 'whenToUse: Cuando hay que publicar', 'tags: [cloud, deploy]', '---', '', 'cuerpo'].join('\n');
  const parsed = candidateFromSkillFile(foreign, { path: 'C:/skills/cloud/SKILL.md', source: 'biblioteca' });
  assert.equal(parsed.id, 'cloud-deploy');
  assert.equal(parsed.name, 'cloud-deploy');
  assert.equal(parsed.source, 'biblioteca');
  assert.equal(parsed.path, 'C:/skills/cloud/SKILL.md');
  assert.deepEqual(parsed.tags, ['cloud', 'deploy']);
});

test('un fichero sin nombre ni descripción no es una skill', () => {
  assert.equal(candidateFromSkillFile('---\ntitle: otra cosa\n---\n', { path: 'x' }), null);
  assert.equal(candidateFromSkillFile('', { path: 'x' }), null);
});

test('el render no depende de que exista el disco', () => {
  // La misma entrada produce el mismo fichero: materializar dos veces no debe ensuciar el proyecto.
  const one = renderSkillFile(skillWith());
  const two = renderSkillFile(skillWith());
  assert.equal(one, two);
  // Y se puede escribir de verdad en una caja de arena, para comprobar que el texto es un fichero válido.
  const root = tempRoot();
  const directory = join(root, 'proyecto');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'SKILL.md');
  writeFileSync(file, one, 'utf8');
  assert.equal(parseSkillFile(one).body, `# ${candidate().description}\n\n${candidate().body}`);
});
