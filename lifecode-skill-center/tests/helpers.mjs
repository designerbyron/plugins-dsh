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

/**
 * Documento v2 **sintético** con entidades, pines, mejoras, eventos y evaluaciones.
 *
 * Lo usan las pruebas que antes exigían contenido del perfil real (perfil vacío en testUser):
 * ningún identificador, ruta ni dato sale de la biblioteca productiva. La forma es la que
 * `normalizeState` acepta, así que la cobertura sobre migración, firma funcional y diario
 * se mide igual en un `USERPROFILE` limpio.
 */
export function richDocument(now = new Date().toISOString()) {
  const projectId = 'proyecto-fixture-001';
  const firstSkill = 'skill-fixture-uno';
  const secondSkill = 'skill-fixture-dos';
  const version = {
    version: '1.0.0',
    description: 'Versión de fixture, sin contenido de terceros.',
    whenToUse: 'Úsala sólo dentro de la caja de arena de pruebas.',
    tags: ['fixture'],
    body: '# Fixture\n\nCuerpo sintético con longitud suficiente para la puerta de calidad.',
    references: {},
    createdAt: now,
    checksum: '0'.repeat(64),
    notes: '',
    evaluation: {
      checks: [{ code: 'fixture.check', ok: true, severity: 'info', message: 'Comprobación sintética.' }],
      findings: [],
      evaluatedAt: now,
    },
  };
  const skill = (id, title) => ({
    id,
    title,
    description: 'Descripción sintética de la fixture.',
    whenToUse: 'Cuando la prueba necesite una skill sin datos reales.',
    tags: ['fixture'],
    status: 'published',
    currentVersion: '1.0.0',
    createdAt: now,
    updatedAt: now,
    origin: { kind: 'human', from: null, fromVersion: null, note: 'fixture' },
    versions: [structuredClone(version)],
  });
  return {
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    skills: {
      [firstSkill]: skill(firstSkill, 'Skill fixture uno'),
      [secondSkill]: skill(secondSkill, 'Skill fixture dos'),
    },
    projects: {
      [projectId]: {
        id: projectId,
        name: 'Proyecto fixture',
        cwd: '',
        createdAt: now,
        updatedAt: now,
        note: 'Sólo pruebas',
      },
    },
    assignments: {
      [projectId]: {
        [firstSkill]: {
          enabled: true,
          version: '1.0.0',
          updatedAt: now,
          by: 'human',
          pinnedAt: now,
        },
      },
    },
    improvements: {
      'imp-fixture-001': {
        id: 'imp-fixture-001',
        skillId: firstSkill,
        baseVersion: '1.0.0',
        description: 'Mejora sintética para medir la firma funcional.',
        whenToUse: 'Sólo en pruebas.',
        tags: ['fixture'],
        body: 'Cuerpo de la mejora sintética.',
        references: {},
        rationale: 'Fixture',
        status: 'approved',
        createdAt: now,
        decidedAt: now,
        decidedBy: 'human',
        version: '',
        evaluation: { checks: [], findings: [], evaluatedAt: now },
      },
    },
    requests: {},
    events: [
      {
        id: 'ev-e1d22376f174',
        at: now,
        type: 'skill.created',
        skillId: firstSkill,
        actor: 'human',
        note: 'Evento sintético de creación.',
      },
      {
        id: 'ev-4b5ef716129b',
        at: now,
        type: 'skill-imported',
        skillId: secondSkill,
        actor: 'human',
        note: 'Evento sintético de importación.',
      },
    ],
  };
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
