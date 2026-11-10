#!/usr/bin/env node
/**
 * R16 — matriz determinista de colisiones contra `lib/collisions.mjs` y `lib/preflight.mjs` (§3 y §4).
 *
 * Para cada uno de los seis códigos del contrato construye entradas fixture con la forma del DTO de
 * inventario, ejecuta el motor de colisiones y el preflight de `materialize-project`, compara severidad y
 * decisión con lo que exige el contrato e imprime una tabla. Sale 1 si alguna fila no cumple.
 *
 * Uso: node tools/r16-collision-matrix.mjs
 */
import { detectCollisions } from '../lib/collisions.mjs';
import { preflight } from '../lib/preflight.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT = 'p1';

function entry(overrides = {}) {
  return {
    key: `k-${Math.random().toString(36).slice(2, 8)}`,
    name: 'demo-skill',
    canonicalName: 'demo-skill',
    owner: { kind: 'filesystem', provider: 'disco' },
    origin: { kind: 'filesystem' },
    location: { kind: 'file', path: 'C:/uno/demo-skill/SKILL.md', directory: 'C:/uno/demo-skill', rootId: 'user-dsh' },
    scope: { kind: 'project', projectId: PROJECT, cwd: 'C:/proyecto' },
    association: { loadedByHost: false },
    identity: { uuid: null, contentSha256: null },
    ...overrides,
  };
}

const lifecode = (key, directory, extra = {}) => entry({
  key,
  owner: { kind: 'lifecode', provider: 'lifecode-skill-center' },
  origin: { kind: 'materialized' },
  location: { kind: 'directory', path: `${directory}/demo-skill`, directory: `${directory}/demo-skill`, rootId: 'materialized' },
  association: { loadedByHost: true },
  ...extra,
});

const fixtures = [
  {
    code: 'identity-duplicate',
    expectedSeverity: 'block',
    expectedDecision: 'block',
    entries: [
      entry({ key: 'u1', name: 'uno', canonicalName: null, identity: { uuid: UUID, contentSha256: SHA_A } }),
      entry({ key: 'u2', name: 'dos', canonicalName: null, location: { kind: 'file', path: 'C:/dos/dos/SKILL.md', directory: 'C:/dos/dos', rootId: 'user-dsh' }, identity: { uuid: UUID, contentSha256: SHA_B } }),
    ],
  },
  {
    code: 'name-collision',
    expectedSeverity: 'block',
    expectedDecision: 'block',
    entries: [lifecode('m1', 'C:/centro/p1'), lifecode('m2', 'C:/centro/p2')],
  },
  {
    code: 'path-collision',
    expectedSeverity: 'block',
    expectedDecision: 'block',
    entries: [entry({ key: 'p-a' }), entry({ key: 'p-b', name: 'otra', canonicalName: 'otra' })],
  },
  {
    code: 'content-collision',
    expectedSeverity: 'warn',
    expectedDecision: 'warn',
    // El sujeto del materializado es `uno`: sin sujeto que case, §4 no emite hallazgos de otros nombres.
    skillId: 'uno',
    entries: [
      entry({ key: 'c1', name: 'uno', canonicalName: null, identity: { uuid: null, contentSha256: SHA_A } }),
      entry({ key: 'c2', name: 'dos', canonicalName: null, location: { kind: 'file', path: 'C:/dos/dos/SKILL.md', directory: 'C:/dos/dos', rootId: 'user-dsh' }, identity: { uuid: null, contentSha256: SHA_A } }),
    ],
  },
  {
    code: 'assignment-shadowed',
    expectedSeverity: 'warn',
    expectedDecision: 'block',
    entries: [
      lifecode('lifecode:p1:demo-skill', 'C:/centro/materialized/p1', { association: { loadedByHost: false } }),
      entry({ key: 'host-winner', association: { loadedByHost: true, provider: 'disco', path: 'C:/usuario/demo-skill/SKILL.md' } }),
    ],
    assignments: { [PROJECT]: { 'demo-skill': { enabled: true } } },
  },
  {
    code: 'legacy-collision',
    expectedSeverity: 'warn',
    expectedDecision: 'warn',
    entries: [
      entry({ key: 'legacy', name: 'legacy-skill', canonicalName: 'legacy-skill', location: { kind: 'file', path: 'C:/dsh/skill-compiler/projects/p1/approved/legacy-skill/SKILL.md', directory: 'C:/dsh/skill-compiler/projects/p1/approved/legacy-skill', rootId: 'compiler-projects' } }),
    ],
  },
];

const sources = ['state', 'manifest', 'skills-registry', 'filesystem-view'].map((id) => ({ id, status: 'complete' }));
const state = { projects: { [PROJECT]: { id: PROJECT, cwd: 'C:/proyecto', manifestSha256: 'abc' } } };

const rows = [];
let failures = 0;
for (const fixture of fixtures) {
  const result = detectCollisions({ entries: fixture.entries, assignments: fixture.assignments ?? {}, projects: [{ id: PROJECT, cwd: 'C:/proyecto' }] });
  const collision = result.collisions.find((item) => item.code === fixture.code);
  const severity = collision?.severity ?? 'no-detectada';
  const decision = preflight({
    action: 'materialize-project',
    projectId: PROJECT,
    skillId: fixture.skillId ?? 'demo-skill',
    state,
    sources,
    collisions: collision ? [collision] : [],
    projectAvailability: 'ok',
  }).decision;
  const ok = severity === fixture.expectedSeverity && decision === fixture.expectedDecision;
  if (!ok) failures += 1;
  rows.push({ code: fixture.code, expectedSeverity: fixture.expectedSeverity, severity, expectedDecision: fixture.expectedDecision, decision, ok });
}

const width = (text, size) => String(text).padEnd(size);
const line = `| ${width('código', 22)} | ${width('severidad', 12)} | ${width('preflight', 10)} | ${width('OK', 4)} |`;
console.log('R16 — matriz de colisiones (§3) y preflight (§4), acción materialize-project\n');
console.log(`| ${width('código', 22)} | ${width('esperado', 20)} | ${width('obtenido', 20)} | ${width('OK', 4)} |`);
console.log(`|${'-'.repeat(24)}|${'-'.repeat(22)}|${'-'.repeat(22)}|${'-'.repeat(6)}|`);
for (const row of rows) {
  console.log(`| ${width(row.code, 22)} | ${width(`${row.expectedSeverity}/${row.expectedDecision}`, 20)} | ${width(`${row.severity}/${row.decision}`, 20)} | ${width(row.ok ? 'sí' : 'NO', 4)} |`);
}
console.log(`\n${rows.length - failures}/${rows.length} códigos cumplen la severidad y la decisión esperadas.`);
if (failures > 0) {
  console.log('Filas que no cumplen:');
  for (const row of rows.filter((item) => !item.ok)) console.log(`  - ${row.code}: esperado ${row.expectedSeverity}/${row.expectedDecision}, obtenido ${row.severity}/${row.decision}`);
}
console.log('\nNota: assignment-shadowed es warn como colisión y block al materializar (contrato §3/§4).');
if (failures > 0) {
  console.log('\nDEFECTO del producto detectado por esta matriz:');
  console.log('  - §4 exige `content-collision` warn en el preflight, pero `lib/preflight.mjs:178-181` compara');
  console.log('    la clave de la colisión con nombres; la clave de content-collision es el sha256');
  console.log('    (`lib/collisions.mjs`, `content-collision`), así que la relevancia nunca casa y el');
  console.log('    preflight la omite: decisión allow en vez de warn. No es un fallo de la matriz.');
}
process.exitCode = failures === 0 ? 0 : 1;
