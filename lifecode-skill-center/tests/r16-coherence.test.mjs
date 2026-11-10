/**
 * R16.3 — Verificación de coherencia entre inventario, colisiones y métricas.
 *
 * Independiente de las pruebas de dominio/UI de otros agentes: aquí se usan fixtures propias y se llama
 * al código real (`collectInventory`, `mergeHostWinners`, `detectCollisions`, `preflight`,
 * `buildProjectsPayload`, `buildProjectDetail`, `countOwners`). Todo ocurre en cajas temporales.
 *
 * Puntos cubiertos (task-24): 1 suma byOwner, 2 dedupe multi-fuente, 3 identidad no fusionada,
 * 4 no inspeccionado ≠ vacío, 5 fuente caída ≠ inventario vacío, 6 conflictos globales no atribuidos,
 * 7 filtros/conteos de colisiones, 8 severidades del preflight = motor, 9 legacy agrupada (1 por raíz),
 * 10 tri-estado `loadedByHost` (5 casos), 11 explicación de procedencias.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { collectInventory, mergeHostWinners } from '../lib/inventory.mjs';
import { detectCollisions } from '../lib/collisions.mjs';
import { preflight } from '../lib/preflight.mjs';
import { buildProjectDetail, buildProjectsPayload } from '../lib/projects.mjs';
import { countOwners } from '../lib/api.mjs';

const NOW = '2026-11-09T15:30:00.000Z';
const HERE = dirname(fileURLToPath(import.meta.url));
const boxes = [];

function box(label) {
  const dir = mkdtempSync(join(tmpdir(), `r16c-${label}-`));
  boxes.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of boxes) rmSync(dir, { recursive: true, force: true });
});

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

/** Adaptadores reales de sistema de ficheros, como los usan los tests de dominio. */
function fsAdapters({ listSkills } = {}) {
  return {
    readdir: async (dir) => readdirSync(dir, { withFileTypes: true }),
    readFile: async (file) => readFileSync(file),
    stat: async (file) => ({ isDirectory: () => statSync(file).isDirectory() }),
    lstat: async (file) => ({ isDirectory: () => statSync(file).isDirectory() }),
    ...(typeof listSkills === 'function' ? { listSkills } : {}),
  };
}

/** Escribe una skill con frontmatter mínimo (nombre canónico) en `<base>/<name>/SKILL.md`. */
function writeSkill(base, name, extra = '') {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  const body = `---\nname: ${name}\ndescription: fixture de coherencia ${name}\nwhenToUse: probar coherencia\ntags: [dsh, r16]\n---\n\n## Procedimiento\n\nPaso de prueba.\n\n## Evidencia\n\nSalida de prueba.${extra ? `\n\n${extra}` : ''}\n`;
  const file = join(dir, 'SKILL.md');
  writeFileSync(file, body, 'utf8');
  return { dir, file, content: body };
}

/** Entrada DTO de inventario (misma forma que produce `lib/inventory.mjs`). */
function makeEntry({
  name = 'demo-skill',
  canonicalName = name,
  ownerKind = 'filesystem',
  provider = null,
  rootId = 'user-dsh',
  kind = 'directory',
  path = `/sandbox/${name}/SKILL.md`,
  sha = null,
  uuid = null,
  projectId = null,
  loadedByHost = false,
  shadowedBy = null,
  key = null,
} = {}) {
  const locationPath = slash(path);
  return {
    key: key ?? `${ownerKind}:${rootId}:${locationPath}`,
    name,
    canonicalName,
    description: `fixture ${name}`,
    whenToUse: 'probar coherencia',
    owner: { kind: ownerKind, provider, pluginEntryId: null },
    origin: { kind: 'filesystem', label: rootId },
    location: {
      kind,
      path: locationPath,
      directory: slash(dirname(locationPath)),
      rootId,
    },
    scope: { kind: 'user', projectRoot: null, cwd: null, ...(projectId ? { projectId } : {}) },
    association: { loadedByHost, provider: null, path: null, shadowedBy },
    execution: { modelInvocable: true, userInvocable: true },
    identity: { uuid, version: null, contentSha256: sha, manifestSha256: null },
    confidence: 'manifest',
    reasons: [],
  };
}

function codesOf(result) {
  return result.collisions.map((collision) => collision.code);
}

function sourcesFor(ids) {
  return ids.map((id) => ({ id, status: 'complete', reason: '' }));
}

function projectState(projects) {
  const map = {};
  for (const [id, cwd] of Object.entries(projects)) {
    map[id] = { id, name: id, cwd: slash(cwd), createdAt: NOW, uuid: null, manifestSha256: null };
  }
  return { projects: map, assignments: {} };
}

test('§7.1 — byOwner suma el total: unknown se cuenta aparte y nunca se mezcla con own/external', async () => {
  const entries = [
    makeEntry({ name: 'propia-uno', ownerKind: 'lifecode' }),
    makeEntry({ name: 'propia-dos', ownerKind: 'lifecode' }),
    makeEntry({ name: 'externa-uno', ownerKind: 'plugin', provider: 'otro-plugin' }),
    makeEntry({ name: 'host-uno', ownerKind: 'bundled', rootId: 'bundled' }),
    makeEntry({ name: 'disco-uno', ownerKind: 'filesystem' }),
    makeEntry({ name: 'rara-uno', ownerKind: 'origen-desconocido' }),
    makeEntry({ name: 'rara-dos', ownerKind: '' }),
  ];
  const byOwner = countOwners(entries);
  assert.deepEqual(Object.keys(byOwner).sort(), ['external', 'filesystem', 'host', 'own', 'unknown']);
  assert.equal(byOwner.own, 2);
  assert.equal(byOwner.external, 1);
  assert.equal(byOwner.host, 1);
  assert.equal(byOwner.filesystem, 1);
  assert.equal(byOwner.unknown, 2, 'un dueño no reconocido se cuenta como unknown, no como propia');
  const sum = Object.values(byOwner).reduce((total, value) => total + value, 0);
  assert.equal(sum, entries.length, 'la suma de categorías debe ser el total, sin huecos ni dobles cuentas');

  // Y con inventario real: el reparto sigue cuadrando con las entradas que devuelve el colector.
  const dshHome = join(box('owners'), 'dsh');
  writeSkill(join(dshHome, 'skills'), 'mi-skill');
  writeSkill(join(dshHome, 'skills'), 'otra-skill');
  const inventory = await collectInventory(fsAdapters(), {
    dshHome,
    cwd: '',
    snapshot: { skills: [], complete: true },
    now: NOW,
  });
  const real = countOwners(inventory.entries);
  assert.equal(inventory.entries.length, 2);
  assert.equal(real.filesystem, 2);
  assert.equal(Object.values(real).reduce((total, value) => total + value, 0), inventory.entries.length);
});

test('§7.2 — la misma skill en varias fuentes es UNA fila (merge), y dos materializadas homónimas son dos proyectos, no una colisión', async () => {
  const base = box('dedupe');
  const dshHome = join(base, 'dsh');
  const root = join(base, 'center');
  const onDisk = writeSkill(join(dshHome, 'skills'), 'demo-skill');
  const inventory = await collectInventory(fsAdapters(), {
    dshHome,
    root,
    cwd: '',
    snapshot: { skills: [{ name: 'demo-skill', provider: 'filesystem', source: 'user', path: onDisk.file }], complete: true },
    now: NOW,
  });
  const sameName = inventory.entries.filter((entry) => entry.canonicalName === 'demo-skill');
  assert.equal(sameName.length, 1, 'la fila del disco y la del catálogo son la misma skill: no se duplica');
  assert.equal(sameName[0].association.loadedByHost, true);
  assert.equal(
    inventory.sources.find((source) => source.id === 'skills-registry').status,
    'complete',
    'el catálogo se consultó, así que la fusión se apoya en evidencia real',
  );

  // Dos proyectos materializan la MISMA skill (mismo contenido, misma forma de ruta).
  const materialized = join(root, 'materialized');
  writeSkill(join(materialized, 'proyecto-uno'), 'demo-skill');
  const segundo = writeSkill(join(materialized, 'proyecto-dos'), 'demo-skill');
  assert.equal(readFileSync(join(materialized, 'proyecto-uno', 'demo-skill', 'SKILL.md'), 'utf8'), segundo.content);

  const two = await collectInventory(fsAdapters(), {
    dshHome: '',
    root,
    materializedRoot: materialized,
    cwd: '',
    now: NOW,
  });
  assert.equal(two.entries.length, 2, 'una fila por proyecto materializado, sin fusionar');
  const collisions = detectCollisions({ entries: two.entries, projects: [] });
  assert.deepEqual(codesOf(collisions), [], 'la misma skill vista desde dos proyectos no es colisión de nombre');
  assert.deepEqual(collisions.ambiguousNames, [], 'tampoco ensucia los nombres ambiguos');
});

test('§7.3 — la identidad no se fusiona sin evidencia: mismo uuid con contenido distinto ⇒ block; mismo hash ⇒ sin colisión', () => {
  const uuid = '4f9a6c1e-2b7d-4c3a-9f10-8d5e2a7b6c01';
  const contentA = sha256('contenido A');
  const contentB = sha256('contenido B');

  const divergence = detectCollisions({
    entries: [
      makeEntry({ name: 'identidad', uuid, sha: contentA, path: '/sandbox/a/identidad/SKILL.md' }),
      makeEntry({ name: 'identidad', uuid, sha: contentB, path: '/sandbox/b/identidad/SKILL.md' }),
    ],
  });
  const identity = divergence.collisions.filter((collision) => collision.code === 'identity-duplicate');
  assert.equal(identity.length, 1);
  assert.equal(identity[0].severity, 'block');
  assert.equal(identity[0].key, uuid);
  assert.equal(identity[0].rows.length, 2, 'las dos filas divergentes quedan visibles, sin fusionar');

  const agreement = detectCollisions({
    entries: [
      makeEntry({ name: 'identidad', uuid, sha: contentA, path: '/sandbox/c/identidad/SKILL.md' }),
      makeEntry({ name: 'identidad', uuid, sha: contentA, path: '/sandbox/d/identidad/SKILL.md' }),
    ],
  });
  assert.deepEqual(
    codesOf(agreement).filter((code) => code === 'identity-duplicate' || code === 'content-collision'),
    [],
    'misma identidad con el mismo contenido no es colisión',
  );
});

test('§7.4 — un proyecto sin inspeccionar no se presenta como vacío: status not-run y motivo, sin inventar conteos', () => {
  const base = box('notrun');
  const cwd = join(base, 'proyecto');
  mkdirSync(cwd, { recursive: true });
  const state = projectState({ 'p-sin-inspeccionar': cwd });
  const payload = buildProjectsPayload({
    workspaces: [{ workspaceId: 'ws-1', title: 'Proyecto', path: cwd, sessionIds: [] }],
    state,
    hostCwd: cwd,
    inventory: { entries: [], sources: [] },
    sources: [],
    now: NOW,
  });
  const summary = payload.projects.find((project) => project.projectId === 'p-sin-inspeccionar');
  assert.ok(summary, 'el proyecto registrado aparece en la lista');
  assert.equal(summary.inspection.status, 'not-run');
  assert.equal(summary.inspection.inspectedAt, null);
  assert.ok(Array.isArray(summary.reasons) && summary.reasons.length >= 1, 'el estado no verificado lleva motivo');
  assert.equal(summary.counts.materialized, 0);

  // Un descubierto no es una ficha vacía: no se le fabrica `inspection` ni conteos de skills.
  const discoveredPayload = buildProjectsPayload({
    workspaces: [{ workspaceId: 'ws-2', title: 'Descubierto', path: join(base, 'otro'), sessionIds: [] }],
    state: { projects: {}, assignments: {} },
    hostCwd: '',
    inventory: { entries: [], sources: [] },
    sources: [],
    now: NOW,
  });
  const discovered = discoveredPayload.discovered.find((row) => row.workspaceId === 'ws-2');
  assert.ok(discovered);
  assert.equal(discovered.state, 'discovered');
  assert.equal('inspection' in discovered, false, 'descubrir no finge una inspección que no se ha hecho');
  assert.equal(discoveredPayload.summary.discovered, 1);
});

test('§7.4b — el panel rotula «sin inspeccionar», no «ninguna»: la ausencia se dice, no se disfraza de vacío', () => {
  const client = readFileSync(join(HERE, '..', 'client.js'), 'utf8');
  assert.ok(client.includes("'projects.inspection.not-run': 'sin inspeccionar'"));
  assert.ok(client.includes("'projects.card.skills.notRun': 'sin inspeccionar todavía: no se ejecutó ninguna inspección'"));
  const notRunLine = client.split('\n').find((line) => line.includes("'projects.card.skills.notRun'") && line.includes('sin inspeccionar todavía'));
  assert.ok(notRunLine, 'la etiqueta de skills no inspeccionadas existe en el panel');
  assert.equal(
    /\bninguna\b(?! inspección)/i.test(notRunLine.replace('ninguna inspección', '')),
    false,
    'la ausencia de inspección no se rotula como «ninguna»',
  );
});

test('§7.5 — una fuente no disponible no vacía el inventario: la fila cae con motivo, complete:false y las entradas siguen', async () => {
  const dshHome = join(box('source-down'), 'dsh');
  writeSkill(join(dshHome, 'skills'), 'superviviente-uno');
  writeSkill(join(dshHome, 'skills'), 'superviviente-dos');
  const breaking = fsAdapters({
    listSkills: async () => {
      const error = new Error('catálogo caído');
      error.code = 'catalog-down';
      throw error;
    },
  });
  const inventory = await collectInventory(breaking, { dshHome, cwd: '', now: NOW });
  const registry = inventory.sources.find((source) => source.id === 'skills-registry');
  assert.ok(registry);
  assert.equal(registry.status, 'unavailable');
  assert.equal(registry.reason, 'catalog-down');
  assert.equal(inventory.complete, false, 'sin catálogo la evidencia no está completa');
  assert.equal(inventory.entries.length, 2, 'las entradas de disco no se borran porque falle otra fuente');
  assert.ok(inventory.warnings.some((warning) => warning.code === 'skills-registry-unavailable'));
  assert.equal(inventory.entries.filter((entry) => entry.canonicalName === 'superviviente-uno').length, 1);
});

test('§7.6 — los conflictos globales no se atribuyen a todos los proyectos: solo la ficha dueña los muestra', () => {
  const base = box('attribution');
  const p1 = join(base, 'proyecto-uno');
  const p2 = join(base, 'proyecto-dos');
  mkdirSync(p1, { recursive: true });
  mkdirSync(p2, { recursive: true });
  const state = projectState({ p1, p2 });
  const manifests = [
    { projectId: 'p1', cwd: slash(p1), present: true, sha256: 'a'.repeat(64) },
    { projectId: 'p2', cwd: slash(p2), present: true, sha256: 'b'.repeat(64) },
  ];
  const inspections = [
    { projectId: 'p1', cwd: slash(p1), status: 'complete', inspectedAt: NOW },
    { projectId: 'p2', cwd: slash(p2), status: 'complete', inspectedAt: NOW },
  ];
  const collisions = [
    { code: 'name-collision', severity: 'warn', key: 'solo-p1', rows: [{ key: 'k1', name: 'solo-p1', projectId: 'p1' }] },
    { code: 'content-collision', severity: 'warn', key: 'global', rows: [{ key: 'k2', name: 'global' }] },
  ];
  const common = { workspaces: [], state, inventory: { entries: [], sources: [] }, sources: [], now: NOW, manifests, inspections, sessions: null, collisions };
  const detailOne = buildProjectDetail({ ...common, projectId: 'p1' });
  const detailTwo = buildProjectDetail({ ...common, projectId: 'p2' });
  assert.equal(detailOne.collisions.length, 1);
  assert.equal(detailOne.collisions[0].key, 'solo-p1');
  assert.equal(detailTwo.collisions.length, 0, 'el conflicto de otro proyecto no se le atribuye');
  assert.equal(detailOne.counts.materialized, 0);
  assert.equal(detailTwo.counts.materialized, 0);
});

test('§7.7 — los filtros de colisiones particionan: por code y por severity suman el total', () => {
  const collisions = [
    { code: 'name-collision', severity: 'warn', key: 'uno', rows: [{ key: 'r1', owner: 'filesystem' }, { key: 'r2', owner: 'lifecode' }] },
    { code: 'name-collision', severity: 'block', key: 'dos', rows: [{ key: 'r3', owner: 'lifecode' }] },
    { code: 'content-collision', severity: 'warn', key: 'tres', rows: [{ key: 'r4', owner: 'filesystem' }] },
    { code: 'legacy-collision', severity: 'warn', key: 'cuatro', rows: [{ key: 'r5', owner: 'filesystem' }] },
    { code: 'path-collision', severity: 'block', key: 'cinco', rows: [{ key: 'r6', owner: 'lifecode' }] },
  ];
  const byCode = new Map();
  const bySeverity = new Map();
  for (const collision of collisions) {
    byCode.set(collision.code, (byCode.get(collision.code) ?? 0) + 1);
    bySeverity.set(collision.severity, (bySeverity.get(collision.severity) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(byCode), {
    'name-collision': 2,
    'content-collision': 1,
    'legacy-collision': 1,
    'path-collision': 1,
  });
  assert.equal([...byCode.values()].reduce((total, value) => total + value, 0), collisions.length);
  assert.deepEqual(Object.fromEntries(bySeverity), { warn: 3, block: 2 });
  assert.equal([...bySeverity.values()].reduce((total, value) => total + value, 0), collisions.length);
  const onlyWarn = collisions.filter((collision) => collision.severity === 'warn');
  assert.equal(onlyWarn.length, bySeverity.get('warn'));
  const owners = new Set(collisions.flatMap((collision) => collision.rows.map((row) => row.owner)));
  assert.deepEqual([...owners].sort(), ['filesystem', 'lifecode']);
});

test('§7.8 — el preflight usa la severidad del motor: name block, content warn, legacy warn, assignment sombreada block al materializar', () => {
  const content = sha256('mismo contenido para dos nombres');
  const complete = sourcesFor(['state', 'manifest', 'skills-registry', 'filesystem-view']);
  const base = { action: 'materialize-project', state: {}, inventory: { entries: [], sources: [] }, sources: complete, now: NOW };

  const nameEngine = detectCollisions({
    entries: [
      makeEntry({ name: 'choque-nombre', ownerKind: 'lifecode', rootId: 'materialized', path: '/sandbox/mat/p1/choque-nombre/SKILL.md' }),
      makeEntry({ name: 'choque-nombre', ownerKind: 'lifecode', rootId: 'materialized', path: '/sandbox/mat/p2/choque-nombre/SKILL.md' }),
    ],
  });
  assert.equal(nameEngine.collisions[0].severity, 'block');
  const nameGate = preflight({ ...base, projectId: 'p1', skillId: 'choque-nombre', collisions: nameEngine });
  const nameFinding = nameGate.findings.find((finding) => finding.code === 'name-collision');
  assert.ok(nameFinding);
  assert.equal(nameFinding.severity, 'block');
  assert.equal(nameGate.decision, 'block');

  const contentEngine = detectCollisions({
    entries: [
      makeEntry({ name: 'contenido-uno', sha: content, path: '/sandbox/a/contenido-uno/SKILL.md' }),
      makeEntry({ name: 'contenido-dos', sha: content, path: '/sandbox/b/contenido-dos/SKILL.md' }),
    ],
  });
  const contentCollision = contentEngine.collisions.find((collision) => collision.code === 'content-collision');
  assert.ok(contentCollision);
  assert.equal(contentCollision.severity, 'warn');
  const contentGate = preflight({ ...base, projectId: 'p1', skillId: 'contenido-uno', collisions: contentEngine });
  const contentFinding = contentGate.findings.find((finding) => finding.code === 'content-collision');
  assert.ok(contentFinding, 'el preflight no puede omitir la colisión que el motor sí ve');
  assert.equal(contentFinding.severity, 'warn');
  assert.notEqual(contentGate.decision, 'block');

  const legacyEngine = detectCollisions({
    entries: [
      makeEntry({ name: 'vieja', rootId: 'compiler-projects', projectId: 'p1', path: '/sandbox/dsh/skill-compiler/projects/p1/vieja/SKILL.md' }),
    ],
  });
  const legacyCollision = legacyEngine.collisions.find((collision) => collision.code === 'legacy-collision');
  assert.ok(legacyCollision);
  const legacyGate = preflight({ ...base, projectId: 'p1', skillId: 'vieja', collisions: legacyEngine });
  const legacyFinding = legacyGate.findings.find((finding) => finding.code === 'legacy-collision');
  assert.ok(legacyFinding);
  assert.equal(legacyFinding.severity, 'warn');

  const shadowEngine = detectCollisions({
    entries: [
      makeEntry({ name: 'sombreada', ownerKind: 'lifecode', rootId: 'materialized', projectId: 'p1', loadedByHost: false, path: '/sandbox/mat/p1/sombreada/SKILL.md' }),
      makeEntry({ name: 'sombreada', ownerKind: 'plugin', provider: 'otro-proveedor', rootId: 'loader', loadedByHost: true, path: '/sandbox/otro/sombreada/SKILL.md' }),
    ],
    assignments: { p1: { sombreada: { version: '1.0.0', enabled: true, by: 'human' } } },
  });
  const shadowCollision = shadowEngine.collisions.find((collision) => collision.code === 'assignment-shadowed');
  assert.ok(shadowCollision);
  assert.equal(shadowCollision.key, 'p1:sombreada');
  const shadowGate = preflight({ ...base, projectId: 'p1', skillId: 'sombreada', collisions: shadowEngine });
  const shadowFinding = shadowGate.findings.find((finding) => finding.code === 'assignment-shadowed');
  assert.ok(shadowFinding);
  assert.equal(shadowFinding.severity, 'block', 'materializar una asignación sombreada se bloquea');
  const readOnlyGate = preflight({ ...base, action: 'assign-skill', projectId: 'p1', skillId: 'sombreada', collisions: shadowEngine });
  const readOnlyFinding = readOnlyGate.findings.find((finding) => finding.code === 'assignment-shadowed');
  assert.ok(readOnlyFinding);
  assert.equal(readOnlyFinding.severity, 'warn', 'fuera de materialización solo advierte');
});

test('§7.9 — legacy-collision se agrupa: UNA por raíz con N filas y count, sin inflar el KPI', () => {
  const entries = [];
  for (let index = 0; index < 46; index += 1) {
    entries.push(makeEntry({
      name: `historica-${String(index).padStart(2, '0')}`,
      rootId: 'compiler-projects',
      path: `/sandbox/dsh/skill-compiler/projects/proyecto-${index}/historica-${index}/SKILL.md`,
    }));
  }
  const collisions = detectCollisions({ entries });
  assert.equal(collisions.collisions.length, 1, '46 filas históricas son UN hecho, no 46 conflictos vivos');
  const legacy = collisions.collisions[0];
  assert.equal(legacy.code, 'legacy-collision');
  assert.equal(legacy.severity, 'warn');
  assert.equal(legacy.count, 46);
  assert.equal(legacy.rows.length, 46);
  assert.equal(collisions.ambiguousNames.length, 0, 'los nombres históricos no son ambigüedades actuales');
});

test('§7.10 — tri-estado de loadedByHost: true demostrado, false sombreado/raíz no escaneada y null cuando no hay prueba', () => {
  const roots = [
    { rootId: 'user-dsh', hostScanned: true },
    { rootId: 'compiler-projects', hostScanned: false },
  ];
  const merged = mergeHostWinners({
    entries: [
      makeEntry({ name: 'servida', path: '/sandbox/dsh/skills/servida/SKILL.md' }),
      makeEntry({ name: 'sombreada', ownerKind: 'lifecode', path: '/sandbox/centro/mat/p1/sombreada/SKILL.md' }),
      makeEntry({ name: 'no-escaneada', rootId: 'compiler-projects', path: '/sandbox/dsh/skill-compiler/projects/vieja/no-escaneada/SKILL.md' }),
      makeEntry({ name: 'compartida', ownerKind: 'lifecode', path: '/sandbox/centro/mat/p1/compartida/SKILL.md' }),
      makeEntry({ name: 'compartida', ownerKind: 'lifecode', path: '/sandbox/centro/mat/p2/compartida/SKILL.md' }),
      makeEntry({ name: 'solo-disco', path: '/sandbox/dsh/skills/solo-disco/SKILL.md' }),
    ],
    snapshot: {
      complete: true,
      cwd: '',
      skills: [
        { name: 'servida', provider: 'filesystem', source: 'user', path: '/sandbox/dsh/skills/servida/SKILL.md' },
        { name: 'sombreada', provider: 'otro-proveedor', source: 'loader', path: '/sandbox/otro/sombreada/SKILL.md' },
        { name: 'compartida', provider: 'lifecode-skill-center', source: 'materialized', path: '/sandbox/centro/mat/p1/compartida/SKILL.md' },
      ],
    },
    roots,
  });
  const byName = new Map(merged.map((entry) => [`${entry.name}:${entry.location.path}`, entry]));

  const served = byName.get('servida:/sandbox/dsh/skills/servida/SKILL.md');
  assert.equal(served.association.loadedByHost, true, 'true solo con match real de nombre y ruta');

  const shadowed = byName.get('sombreada:/sandbox/centro/mat/p1/sombreada/SKILL.md');
  assert.equal(shadowed.association.loadedByHost, false);
  assert.equal(shadowed.association.shadowedBy.provider, 'otro-proveedor');

  const unscanned = byName.get('no-escaneada:/sandbox/dsh/skill-compiler/projects/vieja/no-escaneada/SKILL.md');
  assert.equal(unscanned.association.loadedByHost, false);
  assert.ok(unscanned.reasons.includes('host-scan-out-of-scope'));

  const p1 = byName.get('compartida:/sandbox/centro/mat/p1/compartida/SKILL.md');
  const p2 = byName.get('compartida:/sandbox/centro/mat/p2/compartida/SKILL.md');
  assert.equal(p1.association.loadedByHost, true);
  assert.equal(p2.association.loadedByHost, null, 'otra copia nuestra no prueba que el Host no cargue esta');
  assert.ok(p2.reasons.includes('association-scope-global'));

  const diskOnly = byName.get('solo-disco:/sandbox/dsh/skills/solo-disco/SKILL.md');
  assert.equal(diskOnly.association.loadedByHost, null, 'sin ganador de catálogo no se inventa false');
  assert.ok(diskOnly.reasons.includes('association-scope-global'));
});

test('§7.11 — la explicación de name-collision nombra procedencias distintas una vez, sin repetir la etiqueta', () => {
  const result = detectCollisions({
    entries: [
      makeEntry({ name: 'procedencia', rootId: 'user-dsh', path: '/sandbox/dsh/skills/procedencia/SKILL.md' }),
      makeEntry({ name: 'procedencia', rootId: 'compiler-projects', path: '/sandbox/dsh/skill-compiler/projects/viejo/procedencia/SKILL.md' }),
    ],
  });
  const collision = result.collisions.find((item) => item.code === 'name-collision');
  assert.ok(collision);
  assert.equal(collision.severity, 'warn');
  const occurrences = (needle) => collision.explanation.split(needle).length - 1;
  assert.equal(occurrences('biblioteca de usuario'), 1);
  assert.equal(occurrences('compilador anterior'), 1);
  assert.equal(occurrences('filesystem'), 0, 'no se repite el owner genérico de todas las filas de disco');
  assert.ok(result.ambiguousNames.includes('procedencia'));
});
