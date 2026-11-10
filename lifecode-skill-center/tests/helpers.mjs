/* Utilidades compartidas por las pruebas. Ninguna crea nada fuera del directorio temporal. */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setPolicy, withKnowledge } from '../lib/knowledge.mjs';

/** Raíz de almacén en una caja de arena: el almacén real no se toca nunca. */
export function tempRoot(label = 'lsc-test') {
  return mkdtempSync(join(tmpdir(), `${label}-`));
}

/** Proyecto de mentira con su carpeta, para registrar rutas sin depender de esta máquina. */
export function tempProject(name = 'proyecto', root = tempRoot('lsc-project')) {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

/**
 * Concede autonomía en una caja de arena, como lo haría una persona desde el panel.
 * Regla §6 de la directiva: sin concesión explícita de una persona el producto no decide solo,
 * así que toda prueba que espere conducta autónoma tiene que concederla primero.
 */
export function grantAutonomy(root, { projectId = '', mode = 'guarded-autonomous', by = 'prueba' } = {}) {
  const saved = withKnowledge(root, (document) =>
    setPolicy(document, { projectId, mode, actor: 'human', by }, new Date('2026-11-09T00:00:00.000Z')),
  );
  if (saved?.ok !== true) throw new Error(`no se pudo conceder autonomía: ${saved?.code ?? 'desconocido'}`);
  return saved;
}

/** Raíz de caja de arena con autonomía global concedida: atajo del motor de decisiones. */
export function autonomyRoot(label = 'lsc-auto') {
  const root = tempRoot(label);
  grantAutonomy(root);
  return root;
}

/** Una skill que pasa la puerta de calidad sin avisos: la base de casi todas las pruebas. */
export function candidate(overrides = {}) {
  return {
    id: 'compila-y-verifica-una-skill-de-dsh',
    description: 'Compila y verifica una skill de DSH desde cero, dejando evidencia de cada paso que se ejecuta.',
    whenToUse: 'Úsala cuando haya que crear o revisar una skill de DSH y demostrar que carga.',
    body: [
      '## Procedimiento',
      '',
      'Primero lee el contrato del harness y anota qué servicios existen de verdad. Después escribe la skill con sus secciones y sus referencias, y por último ejecuta las pruebas en una caja de arena.',
      '',
      '## Evidencia',
      '',
      'Adjunta la salida de las pruebas y el hash del fichero generado. Sin esa evidencia, la skill no se declara terminada.',
    ].join('\n'),
    tags: ['dsh', 'skills'],
    ...overrides,
  };
}
