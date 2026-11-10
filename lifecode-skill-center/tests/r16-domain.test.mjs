/**
 * T3a — pruebas de dominio de R16: inventario, colisiones, preflight y proyectos.
 *
 * Todo ocurre en cajas temporales (`tests/helpers.mjs`): jamás se toca el almacén real
 * (`%USERPROFILE%\\.dsh`) ni ficheros de proyectos reales. Los adaptadores son el sistema de ficheros
 * real envuelto en promesas, para probar exactamente la superficie que usará `core-wiring`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  lstatSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { tempRoot } from './helpers.mjs';
import { cwdKey, normalizeCwd, projectIdFor } from '../lib/format.mjs';
import {
  COLLISION_CODES,
  canonicalSkillName,
  detectCollisions,
  diagnoseSkillName,
} from '../lib/collisions.mjs';
import {
  collectInventory,
  entryFromFile,
  mergeHostWinners,
  parseSkillFrontmatter,
  sha256Bytes,
  skillRootsFor,
} from '../lib/inventory.mjs';
import {
  PREFLIGHT_ACTIONS,
  preflight,
  requiredSources,
} from '../lib/preflight.mjs';
import {
  PROJECT_STATES,
  allowedOperations,
  buildProjectDetail,
  buildProjectsPayload,
  classifyProject,
  projectObservation,
} from '../lib/projects.mjs';

// ---------------------------------------------------------------------------
// Utilidades de caja temporal
// ---------------------------------------------------------------------------

function box(label = 'r16-domain') {
  return tempRoot(label);
}

function ensureDir(...parts) {
  const path = join(...parts);
  mkdirSync(path, { recursive: true });
  return path;
}

function skillMarkdown({ name, description = 'Descripción de prueba', whenToUse = '', extra = [] } = {}) {
  const lines = ['---'];
  if (name !== undefined) lines.push(`name: ${name}`);
  if (description !== undefined) lines.push(`description: ${description}`);
  if (whenToUse) lines.push(`whenToUse: ${whenToUse}`);
  for (const line of extra) lines.push(line);
  lines.push('---', '', '# Cuerpo', '', 'Contenido de la skill.', '');
  return lines.join('\n');
}

function writeSkillFile(root, folder, options) {
  const directory = ensureDir(root, folder);
  const path = join(directory, 'SKILL.md');
  writeFileSync(path, skillMarkdown(options), 'utf8');
  return { directory, path };
}

function writeFlatSkill(root, fileName, options) {
  const path = join(root, fileName);
  writeFileSync(path, skillMarkdown(options), 'utf8');
  return path;
}

function fsAdapters(overrides = {}) {
  return {
    async readdir(dir) {
      return readdirSync(dir, { withFileTypes: true });
    },
    async readFile(path) {
      return readFileSync(path);
    },
    async stat(path) {
      const stats = statSync(path);
      return {
        isDirectory: () => stats.isDirectory(),
        isFile: () => stats.isFile(),
        isSymbolicLink: () => stats.isSymbolicLink(),
        size: stats.size,
      };
    },
    async lstat(path) {
      const stats = lstatSync(path);
      return { isSymbolicLink: () => stats.isSymbolicLink(), size: stats.size };
    },
    async realpath(path) {
      return realpathSync(path);
    },
    ...overrides,
  };
}

function emptyState(extra = {}) {
  return { schemaVersion: 2, skills: {}, projects: {}, assignments: {}, improvements: {}, events: [], ...extra };
}

/** Hash de un árbol completo (nombres + bytes) para probar que una función no escribe nada. */
function hashTree(root) {
  const parts = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        parts.push(`D ${name}`);
        walk(full);
      } else {
        parts.push(`F ${name} ${sha256Bytes(readFileSync(full))}`);
      }
    }
  };
  walk(root);
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

/** Adaptador de inventario completo (fs real + estado y snapshot inyectados). */
function inventoryContext({ cwd, dshHome, root, state = emptyState(), snapshot = { skills: [], complete: true }, extra = {} }) {
  return { cwd, dshHome, root, state, snapshot, ...extra };
}

function entryFixture(overrides = {}) {
  const name = overrides.name ?? 'skill-a';
  const ownerKind = overrides.ownerKind ?? 'filesystem';
  const provider = overrides.provider ?? 'user-dsh';
  const origin = overrides.origin ?? 'filesystem';
  const path = overrides.path ?? null;
  const directory = overrides.directory ?? null;
  const kind = overrides.kind ?? (path === null ? 'virtual' : path.toLowerCase().endsWith('skill.md') ? 'directory' : 'file');
  return {
    key: overrides.key ?? `${ownerKind}:${provider}:${path ?? directory ?? name}`,
    name,
    canonicalName: overrides.canonicalName === undefined ? canonicalSkillName(name) : overrides.canonicalName,
    description: 'x',
    whenToUse: '',
    owner: { kind: ownerKind, provider, pluginEntryId: null },
    origin: { kind: origin, label: origin },
    location: { kind, path, directory, rootId: overrides.rootId ?? provider },
    scope: { kind: 'user', projectRoot: null, cwd: overrides.cwd ?? null },
    association: {
      loadedByHost: overrides.loadedByHost === true,
      provider: overrides.shadowedBy ? 'lifecode-skill-center' : provider,
      path,
      shadowedBy: overrides.shadowedBy ?? null,
    },
    execution: { modelInvocable: true, userInvocable: true },
    identity: {
      uuid: overrides.uuid ?? null,
      version: overrides.version ?? null,
      contentSha256: overrides.sha ?? null,
      manifestSha256: overrides.manifestSha256 ?? null,
    },
    confidence: overrides.confidence ?? 'content-hash',
    reasons: overrides.reasons ?? [],
  };
}

// ---------------------------------------------------------------------------
// §5.1 Raíces del cargador, ranks y profundidad 1
// ---------------------------------------------------------------------------

test('skillRootsFor: ranks 100..702 y raíces de proyecto, usuario, custom y declaradas (E1)', () => {
  const roots = skillRootsFor({
    cwd: 'C:/work/proyecto/sub',
    projectRoot: 'C:/work/proyecto',
    dshHome: 'C:/home/.dsh',
    agentsHome: 'C:/home/.agents',
    customDirs: ['C:/custom-skills'],
    bundledDir: 'C:/bundle/skills',
  });
  assert.deepEqual(roots.map((root) => root.rank), [100, 200, 300, 400, 500, 600, 700, 701, 702]);
  const byId = new Map(roots.map((root) => [root.rootId.split(':')[0], root]));
  assert.equal(byId.get('project-dsh').dir, normalizeCwd(join('C:/work/proyecto', '.dsh', 'skills')));
  assert.equal(byId.get('project-dsh').hostScanned, true);
  assert.equal(byId.get('project-agents').dir, normalizeCwd(join('C:/work/proyecto', '.agents', 'skills')));
  assert.equal(byId.get('custom').dir, normalizeCwd('C:/custom-skills'));
  assert.equal(byId.get('user-dsh').dir, normalizeCwd(join('C:/home/.dsh', 'skills')));
  assert.equal(byId.get('user-dsh').skipSystem, true);
  assert.equal(byId.get('user-agents').dir, normalizeCwd(join('C:/home/.agents', 'skills')));
  assert.equal(byId.get('bundled').dir, normalizeCwd(join('C:/bundle/skills')));
  assert.equal(byId.get('compiler-projects').layout.depth, 3);
  assert.deepEqual(byId.get('compiler-projects').layout.buckets.history, ['superseded']);
  assert.equal(byId.get('compiler-global').layout.depth, 1);
  assert.equal(byId.get('materialized').layout.depth, 2);
  assert.equal(byId.get('materialized').source, 'lifecode-skill-center');
  // Fallback documentado sin inyección.
  assert.equal(byId.get('materialized').dir, normalizeCwd(join('C:/home/.dsh', 'lifecode-skill-center', 'materialized')));
  // Inyección explícita de la raíz materializada (tests, LIFECODE_SKILL_CENTER_ROOT, context.root).
  const injected = skillRootsFor({ dshHome: 'C:/home/.dsh', materializedRoot: 'C:/tmp/centro/materialized' });
  assert.equal(injected.find((root) => root.rootId === 'materialized').dir, normalizeCwd('C:/tmp/centro/materialized'));
});

test('collectInventory: profundidad 1 estricta (SKILL.md anidado NO se ve) y <nombre>.md sí', async () => {
  const boxRoot = box('r16-depth');
  const dshHome = ensureDir(boxRoot, '.dsh');
  const skills = ensureDir(dshHome, 'skills');
  const project = ensureDir(boxRoot, 'proyecto');
  writeSkillFile(skills, 'plana', { name: 'plana' });
  writeFlatSkill(skills, 'suelta.md', { name: 'suelta' });
  // Anidada: <root>/anidada/inner/SKILL.md — el cargador sólo mira profundidad 1.
  writeSkillFile(ensureDir(skills, 'anidada', 'inner'), '', { name: 'anidada' });
  // Corrección del helper: el fichero real es <root>/anidada/inner/SKILL.md.
  const nestedDir = ensureDir(skills, 'anidada', 'inner');
  writeFileSync(join(nestedDir, 'SKILL.md'), skillMarkdown({ name: 'anidada' }), 'utf8');

  const result = await collectInventory(fsAdapters(), inventoryContext({
    cwd: project,
    dshHome,
    root: ensureDir(boxRoot, 'centro'),
  }));
  const names = result.entries.map((entry) => entry.name).sort();
  assert.deepEqual(names, ['plana', 'suelta']);
  const userDsh = result.sources.find((source) => source.source === 'user-dsh');
  assert.equal(userDsh.status, 'complete');
  assert.equal(userDsh.found, 2);
  assert.equal(result.complete, true);
});

// ---------------------------------------------------------------------------
// §2 Frontmatter, confianza y symlinks
// ---------------------------------------------------------------------------

test('parseSkillFrontmatter y entryFromFile: el nombre del frontmatter manda sobre la carpeta', async () => {
  const boxRoot = box('r16-frontmatter');
  const dshHome = ensureDir(boxRoot, '.dsh');
  const skills = ensureDir(dshHome, 'skills');
  const project = ensureDir(boxRoot, 'proyecto');
  const { directory, path } = writeSkillFile(skills, 'nombre-de-carpeta', { name: 'nombre-real' });
  const parsed = parseSkillFrontmatter(readFileSync(path));
  assert.equal(parsed.name, 'nombre-real');
  const entry = entryFromFile({
    path,
    root: { source: 'user-dsh', kind: 'host', dir: skills, scope: 'user', rootId: 'user-dsh:test' },
    bytes: readFileSync(path),
    cwd: project,
  });
  assert.equal(entry.name, 'nombre-real');
  assert.equal(entry.canonicalName, 'nombre-real');
  assert.equal(entry.location.directory, normalizeCwd(directory));
  assert.equal(entry.location.kind, 'directory');
  assert.equal(entry.confidence, 'content-hash');
  assert.equal(entry.identity.contentSha256, sha256Bytes(readFileSync(path)));
});

test('nombre inválido: reason invalid-name, canonicalName null y NO se normaliza para igualar', () => {
  const bytes = Buffer.from(skillMarkdown({ name: 'Buen_Nombre' }), 'utf8');
  const parsed = parseSkillFrontmatter(bytes);
  assert.equal(parsed.error, 'invalid-name');
  const entry = entryFromFile({ path: 'C:/x/skills/mala/SKILL.md', root: { source: 'user-dsh', kind: 'host', dir: 'C:/x/skills' }, bytes });
  assert.equal(entry.name, 'Buen_Nombre');
  assert.equal(entry.canonicalName, null);
  assert.ok(entry.reasons.includes('invalid-name'));
  assert.equal(canonicalSkillName('Buen_Nombre'), null);
  assert.equal(canonicalSkillName('buen-nombre'), 'buen-nombre');
  // NFKC sólo diagnostica; jamás iguala.
  assert.equal(diagnoseSkillName('ｂｕｅｎ'), 'buen');
  const collisions = detectCollisions({
    entries: [
      entryFixture({ name: 'Buen_Nombre', canonicalName: null, path: 'C:/a/SKILL.md' }),
      entryFixture({ name: 'buen-nombre', path: 'C:/b/SKILL.md' }),
    ],
  });
  assert.equal(collisions.ambiguousNames.length, 0);
  assert.equal(collisions.collisions.length, 0);
});

test('frontmatter roto (sin frontmatter) ⇒ confidence content-hash y reason del error', () => {
  const bytes = Buffer.from('# Sólo cuerpo, sin frontmatter\n', 'utf8');
  assert.equal(parseSkillFrontmatter(bytes).error, 'missing-name');
  const entry = entryFromFile({ path: 'C:/x/skills/rota/SKILL.md', root: { source: 'user-dsh', kind: 'host', dir: 'C:/x/skills' }, bytes });
  assert.equal(entry.confidence, 'content-hash');
  assert.equal(entry.canonicalName, null);
  assert.deepEqual(entry.reasons, ['missing-name']);
});

test('symlink/junction no se atraviesa: ni carpeta ni .md suelto entran al inventario', async () => {
  // Windows sin privilegios de symlink devuelve EPERM; en vez de depender del sistema operativo se
  // inyecta el `Dirent` que el cargador vería (isSymbolicLink=true) y se comprueba que NO se atraviesa.
  const boxRoot = box('r16-symlink');
  const dshHome = ensureDir(boxRoot, '.dsh');
  const skills = ensureDir(dshHome, 'skills');
  const project = ensureDir(boxRoot, 'proyecto');
  writeSkillFile(skills, 'visible', { name: 'visible' });
  const base = fsAdapters();
  const direntOf = (name, isDirectory) => ({ name, isDirectory, isFile: !isDirectory, isSymbolicLink: true });
  const adapters = {
    ...base,
    async readdir(dir) {
      const entries = await base.readdir(dir);
      if (cwdKey(dir) !== cwdKey(skills)) return entries;
      return [...entries, direntOf('enlazada', true), direntOf('enlazada.md', false)];
    },
  };
  const result = await collectInventory(adapters, inventoryContext({
    cwd: project,
    dshHome,
    root: ensureDir(boxRoot, 'centro'),
  }));
  assert.deepEqual(result.entries.map((entry) => entry.name), ['visible']);
  const userDsh = result.sources.find((source) => source.source === 'user-dsh');
  assert.equal(userDsh.reason, 'symlink');
});

// ---------------------------------------------------------------------------
// §2.2/2.3 Cruce con el snapshot del Host
// ---------------------------------------------------------------------------

test('mergeHostWinners: el ganador del snapshot es el cargado; el resto queda shadowed', () => {
  const diskPath = 'C:/home/.dsh/skills/dup/SKILL.md';
  const entry = entryFromFile({
    path: diskPath,
    root: { source: 'user-dsh', kind: 'host', dir: 'C:/home/.dsh/skills', rootId: 'user-dsh:x' },
    bytes: Buffer.from(skillMarkdown({ name: 'dup' }), 'utf8'),
  });
  const winner = { name: 'dup', path: 'C:/otro/sitio/dup/SKILL.md', provider: 'lifecode-skill-center', source: 'user-dsh', description: 'd', invocation: {} };
  const [shadowed] = mergeHostWinners({ entries: [entry], snapshot: { skills: [winner], complete: true } });
  assert.equal(shadowed.association.loadedByHost, false);
  assert.deepEqual(shadowed.association.shadowedBy, {
    provider: 'lifecode-skill-center',
    path: normalizeCwd(winner.path),
    source: 'user-dsh',
  });
  const [loaded] = mergeHostWinners({ entries: [entry], snapshot: { skills: [{ ...winner, path: diskPath }], complete: true } });
  assert.equal(loaded.association.loadedByHost, true);
  assert.equal(loaded.association.shadowedBy, null);
  // Fila del snapshot sin entrada en disco: se añade virtual, cargada por el Host.
  const withRow = mergeHostWinners({ entries: [], snapshot: { skills: [{ name: 'solo-host', description: 'd', provider: 'bundled', source: 'bundled' }], complete: true } });
  assert.equal(withRow.length, 1);
  assert.equal(withRow[0].location.kind, 'virtual');
  assert.equal(withRow[0].association.loadedByHost, true);
  assert.equal(withRow[0].confidence, 'plugin-contract');

  // R16.3bis §5: nombre servido por el snapshot SIN ruta ⇒ no se puede afirmar ni la carga ni el
  // sombreado. Antes se respondía `false` y el panel decía «no cargada» sin prueba.
  const [unknownPath] = mergeHostWinners({
    entries: [entry],
    snapshot: { skills: [{ name: 'dup', provider: 'lifecode-skill-center', source: 'user-dsh', description: 'd', invocation: {} }], complete: true },
  });
  assert.equal(unknownPath.association.loadedByHost, null, 'sin ruta del ganador no hay match demostrable');
  assert.equal(unknownPath.association.provider, null);
  assert.equal(unknownPath.association.shadowedBy, null);
  assert.ok(unknownPath.reasons.includes('association-scope-global'));

  // Una entrada de disco cuyo nombre ni siquiera aparece en el snapshot tampoco es «no cargada»:
  // el snapshot se consulta sin `scope` de sesión, así que la ausencia no demuestra nada.
  const [absent] = mergeHostWinners({ entries: [entry], snapshot: { skills: [], complete: true } });
  assert.equal(absent.association.loadedByHost, null);
  assert.equal(absent.association.shadowedBy, null);
  assert.ok(absent.reasons.includes('association-scope-global'));
});

test('mergeHostWinners: raíz hostScanned:false ⇒ false sólo fuera del centro; el centro queda null', () => {
  const compilerPath = 'C:/home/.dsh/skill-compiler/projects/p/approved/vieja/SKILL.md';
  const compilerEntry = entryFromFile({
    path: compilerPath,
    root: { source: 'skill-compiler', kind: 'filesystem', dir: 'C:/home/.dsh/skill-compiler/projects/p/approved/vieja', rootId: 'compiler-projects' },
    bytes: Buffer.from(skillMarkdown({ name: 'vieja' }), 'utf8'),
  });
  const materialPath = 'C:/home/.dsh/lifecode-skill-center/materialized/otro-proyecto/propia/SKILL.md';
  const materialEntry = entryFromFile({
    path: materialPath,
    root: { source: 'materialized', kind: 'derived', dir: 'C:/home/.dsh/lifecode-skill-center/materialized/otro-proyecto/propia', rootId: 'materialized' },
    bytes: Buffer.from(skillMarkdown({ name: 'propia' }), 'utf8'),
  });
  const roots = [
    { rootId: 'compiler-projects', hostScanned: false },
    { rootId: 'materialized', hostScanned: false },
  ];
  const rows = mergeHostWinners({ entries: [compilerEntry, materialEntry], snapshot: { skills: [], complete: true }, roots });
  const compiler = rows.find((row) => row.location.rootId === 'compiler-projects');
  // El Host no escanea esta raíz: aquí `false` sí está demostrado por el propio contrato de la raíz.
  assert.equal(compiler.association.loadedByHost, false);
  assert.ok(compiler.reasons.includes('host-scan-out-of-scope'));
  const material = rows.find((row) => row.location.rootId === 'materialized');
  // Fila del propio centro: una copia materializada de otro proyecto no demuestra que no se cargue esta.
  assert.equal(material.owner.kind, 'lifecode');
  assert.equal(material.association.loadedByHost, null);
  assert.ok(material.reasons.includes('association-scope-global'));
});

test('mergeHostWinners: reparto del panel real 85 = true 9 / false 46 / null 30', () => {
  const row = (name, rootId, ownerKind, path) => ({
    key: `${rootId}:${name}:${path ?? ''}`,
    name,
    canonicalName: name,
    location: { kind: path === null ? 'virtual' : 'directory', path, rootId },
    owner: { kind: ownerKind, provider: ownerKind === 'lifecode' ? 'lifecode-skill-center' : 'filesystem' },
    association: { loadedByHost: false, provider: null, path: null, shadowedBy: null },
    reasons: [],
  });
  const entries = [];
  for (let i = 1; i <= 27; i += 1) entries.push(row(`user-${i}`, 'user-dsh', 'filesystem', `C:/home/.dsh/skills/user-${i}/SKILL.md`));
  for (let i = 1; i <= 46; i += 1) entries.push(row(`compiler-${i}`, 'compiler-projects', 'filesystem', `C:/home/.dsh/skill-compiler/projects/p/approved/compiler-${i}/SKILL.md`));
  const ownPath = 'C:/home/.dsh/lifecode-skill-center/materialized/proyecto-a/propia/SKILL.md';
  entries.push(row('propia', 'materialized', 'lifecode', ownPath));
  entries.push(row('propia', 'materialized', 'lifecode', 'C:/home/.dsh/lifecode-skill-center/materialized/proyecto-b/propia/SKILL.md'));
  entries.push(row('estado-a', 'state', 'lifecode', null));
  entries.push(row('estado-b', 'state', 'lifecode', null));
  const snapshot = {
    skills: [
      ...Array.from({ length: 27 }, (_, index) => ({ name: `user-${index + 1}`, provider: 'filesystem', source: 'user-dsh' })),
      { name: 'propia', path: ownPath, provider: 'lifecode-skill-center', source: 'materialized', description: 'd', invocation: {} },
      ...Array.from({ length: 8 }, (_, index) => ({ name: `builtin-${index + 1}`, provider: 'bundled', source: 'bundled', description: 'd', invocation: {} })),
    ],
    complete: true,
  };
  const roots = [
    { rootId: 'compiler-projects', hostScanned: false },
    { rootId: 'materialized', hostScanned: false },
  ];
  const merged = mergeHostWinners({ entries, snapshot, roots });
  const count = (value) => merged.filter((entry) => entry.association.loadedByHost === value).length;
  assert.equal(merged.length, 85);
  assert.deepEqual({ true: count(true), false: count(false), null: count(null) }, { true: 9, false: 46, null: 30 });
  const materialized = merged.filter((entry) => entry.location.rootId === 'materialized');
  assert.equal(materialized.filter((entry) => entry.association.loadedByHost === true).length, 1);
  assert.equal(materialized.filter((entry) => entry.association.loadedByHost === null).length, 1);
  for (const entry of merged.filter((item) => item.location.rootId === 'state')) {
    assert.equal(entry.association.loadedByHost, null);
    assert.equal(entry.association.provider, null);
  }
});

test('mergeHostWinners: ganador de otro proveedor ⇒ false + shadowedBy, con o sin ruta', () => {
  const ownPath = 'C:/home/.dsh/lifecode-skill-center/materialized/proyecto-a/propia/SKILL.md';
  const own = entryFromFile({
    path: ownPath,
    root: {
      source: 'materialized',
      kind: 'derived',
      dir: 'C:/home/.dsh/lifecode-skill-center/materialized/proyecto-a/propia',
      rootId: 'materialized',
    },
    bytes: Buffer.from(skillMarkdown({ name: 'propia' }), 'utf8'),
  });

  // (iii) Sombreado demostrado por el proveedor del ganador: hay ruta y no coincide.
  const withPath = {
    name: 'propia',
    path: 'C:/otro-proveedor/global/propia/SKILL.md',
    provider: 'otro-proveedor',
    source: 'plugin',
    description: 'd',
    invocation: {},
  };
  const [shadowed] = mergeHostWinners({ entries: [own], snapshot: { skills: [withPath], complete: true } });
  assert.equal(shadowed.association.loadedByHost, false);
  assert.equal(shadowed.association.provider, null);
  assert.deepEqual(shadowed.association.shadowedBy, {
    provider: 'otro-proveedor',
    path: normalizeCwd(withPath.path),
    source: 'plugin',
  });
  assert.ok(!shadowed.reasons.includes('association-scope-global'));

  // La ruta del ganador no siempre viaja en el snapshot, pero el proveedor ajeno ya demuestra el
  // sombreado: la fila propia no puede presentarse como «cargada por el Host».
  const withoutPath = { ...withPath, path: undefined };
  const [stillShadowed] = mergeHostWinners({ entries: [own], snapshot: { skills: [withoutPath], complete: true } });
  assert.equal(stillShadowed.association.loadedByHost, false);
  assert.equal(stillShadowed.association.shadowedBy?.provider, 'otro-proveedor');
});

test('colisiones: la explicación nombra procedencias distintas sin repetir la etiqueta', () => {
  const userEntry = entryFromFile({
    path: 'C:/home/.dsh/skills/agent-team/SKILL.md',
    root: { source: 'user-dsh', kind: 'host', dir: 'C:/home/.dsh/skills', rootId: 'user-dsh:x' },
    bytes: Buffer.from(skillMarkdown({ name: 'agent-team' }), 'utf8'),
  });
  const compilerEntry = entryFromFile({
    path: 'C:/home/.dsh/skill-compiler/projects/p/approved/agent-team/SKILL.md',
    root: {
      source: 'skill-compiler',
      kind: 'filesystem',
      dir: 'C:/home/.dsh/skill-compiler/projects/p/approved/agent-team',
      rootId: 'compiler-projects',
    },
    bytes: Buffer.from(skillMarkdown({ name: 'agent-team' }), 'utf8'),
  });
  const { collisions } = detectCollisions({
    entries: [userEntry, compilerEntry],
    projects: {},
    assignments: {},
    workspaces: [],
    manifests: [],
  });
  const collision = collisions.find((item) => item.code === 'name-collision');
  assert.ok(collision, 'debe existir la colisión de nombre');
  assert.match(collision.explanation, /\(biblioteca de usuario, compilador anterior\)/);
  assert.doesNotMatch(collision.explanation, /biblioteca de usuario, biblioteca de usuario/);
});

test('collectInventory: snapshot {complete:false} ⇒ complete false (fail-closed) y materializedRoot inyectable', async () => {
  const boxRoot = box('r16-complete');
  const dshHome = ensureDir(boxRoot, '.dsh');
  ensureDir(dshHome, 'skills');
  const project = ensureDir(boxRoot, 'proyecto');
  const center = ensureDir(boxRoot, 'centro');
  const materialized = ensureDir(boxRoot, 'centro', 'materialized');
  const projectId = projectIdFor(project);
  const skillDir = ensureDir(materialized, projectId, 'skill-a');
  writeFileSync(join(skillDir, 'SKILL.md'), skillMarkdown({ name: 'skill-a' }), 'utf8');
  writeFileSync(join(materialized, projectId, 'manifest.json'), JSON.stringify({ projectId, cwd: project, skills: [{ id: 'skill-a', version: '1.0.0' }] }), 'utf8');

  const partial = await collectInventory(fsAdapters(), inventoryContext({
    cwd: project,
    dshHome,
    root: center,
    snapshot: { skills: [], complete: false },
  }));
  assert.equal(partial.complete, false);
  assert.equal(partial.sources.find((source) => source.id === 'skills-registry').status, 'incomplete');

  const full = await collectInventory(fsAdapters(), inventoryContext({
    cwd: project,
    dshHome,
    root: center,
    state: emptyState(),
  }));
  assert.equal(full.complete, true);
  const materializedSource = full.sources.find((source) => source.id === 'materialized');
  assert.equal(materializedSource.dir, normalizeCwd(materialized));
  const materializedEntry = full.entries.find((entry) => entry.projectId === projectId);
  assert.ok(materializedEntry, 'la raíz materializada inyectada debe escanearse');
  assert.equal(materializedEntry.name, 'skill-a');
  assert.equal(materializedEntry.confidence, 'manifest');
  assert.equal(materializedEntry.identity.version, '1.0.0');
});

test('collectInventory nunca lanza: un adaptador que falla deja la fuente en error y complete false', async () => {
  const boxRoot = box('r16-error');
  const failAdapters = fsAdapters({
    async readdir() {
      throw Object.assign(new Error('sin permiso'), { code: 'EACCES' });
    },
  });
  const result = await collectInventory(failAdapters, inventoryContext({
    cwd: ensureDir(boxRoot, 'proyecto'),
    dshHome: ensureDir(boxRoot, '.dsh'),
    root: ensureDir(boxRoot, 'centro'),
  }));
  assert.equal(result.complete, false);
  const filesystemView = result.sources.find((source) => source.id === 'filesystem-view');
  assert.equal(filesystemView.status, 'error');
  assert.match(filesystemView.reason, /EACCES/);
  assert.ok(Array.isArray(result.entries));
});

// ---------------------------------------------------------------------------
// §3.2 Los seis tipos de colisión y su orden determinista
// ---------------------------------------------------------------------------

test('detectCollisions: los seis códigos del contrato, con severidades y orden determinista', () => {
  const cwd = 'C:/work/proyecto';
  const materializedPath = `C:/home/.dsh/lifecode-skill-center/materialized/p1/shadow/SKILL.md`;
  const entries = [
    // 1) identity-duplicate: mismo uuid en dos skills distintas.
    entryFixture({ name: 'alpha', uuid: '11111111-1111-4111-8111-111111111111', path: 'C:/a/alpha/SKILL.md' }),
    entryFixture({ name: 'beta', uuid: '11111111-1111-4111-8111-111111111111', path: 'C:/b/beta/SKILL.md' }),
    // 2) name-collision con dos filas nuestras ⇒ block.
    entryFixture({ name: 'nombre-dup', ownerKind: 'lifecode', origin: 'materialized', provider: 'lifecode-skill-center', kind: 'file', path: 'C:/m/p1/nombre-dup/SKILL.md' }),
    entryFixture({ name: 'nombre-dup', ownerKind: 'lifecode', origin: 'materialized', provider: 'lifecode-skill-center', kind: 'file', path: 'C:/m/p2/nombre-dup/SKILL.md' }),
    // 3) path-collision: dos entradas distintas sobre la misma ruta canónica.
    entryFixture({ name: 'ruta-uno', kind: 'directory', directory: 'C:/compartida/uno', path: 'C:/compartida/uno/SKILL.md' }),
    entryFixture({ name: 'ruta-dos', kind: 'directory', directory: 'C:/compartida/uno', path: 'C:/compartida/uno/SKILL.md', key: 'otra-clave' }),
    // 4) content-collision: mismo sha256 con nombres distintos.
    entryFixture({ name: 'mismo-uno', path: 'C:/c/uno/SKILL.md', sha: 'a'.repeat(64) }),
    entryFixture({ name: 'mismo-dos', path: 'C:/c/dos/SKILL.md', sha: 'a'.repeat(64) }),
    // 5) assignment-shadowed: la asignación habilitada no es lo que carga el Host.
    entryFixture({
      name: 'shadow',
      ownerKind: 'lifecode',
      origin: 'materialized',
      provider: 'lifecode-skill-center',
      path: materializedPath,
      cwd,
      shadowedBy: { provider: 'filesystem', path: 'C:/otra/shadow/SKILL.md', source: 'user-dsh' },
    }),
    // 6) legacy-collision: dos filas bajo la MISMA ubicación heredada del compilador (R16.3 §3:
    //    una sola colisión warn por raíz, con todas sus filas y `count`; no una por nombre).
    entryFixture({ name: 'legacy-skill', path: 'C:/home/.dsh/skill-compiler/projects/p/approved/legacy-skill/SKILL.md' }),
    entryFixture({ name: 'legacy-skill-dos', path: 'C:/home/.dsh/skill-compiler/projects/p/approved/legacy-skill-dos/SKILL.md' }),
  ];
  const projects = [
    { id: 'p1', cwd },
    { id: 'p2', cwd }, // mismo cwdKey ⇒ path-collision de proyectos.
  ];
  const result = detectCollisions({
    entries,
    projects,
    assignments: { p1: { shadow: { enabled: true, version: '1.0.0', updatedAt: 'x', by: 'human' } } },
    workspaces: [
      { workspaceId: 'w1', path: cwd },
      { workspaceId: 'w2', path: cwd },
    ],
  });
  const codes = new Set(result.collisions.map((collision) => collision.code));
  for (const code of COLLISION_CODES) assert.ok(codes.has(code), `falta la colisión ${code}`);
  assert.ok(result.ambiguousNames.includes('nombre-dup'));
  // Orden: primero block, luego code, luego key.
  const rank = { block: 0, warn: 1, info: 2 };
  for (let index = 1; index < result.collisions.length; index += 1) {
    const previous = result.collisions[index - 1];
    const current = result.collisions[index];
    const order = rank[previous.severity] - rank[current.severity]
      || (previous.code < current.code ? -1 : previous.code > current.code ? 1 : 0)
      || (previous.key < current.key ? -1 : previous.key > current.key ? 1 : 0);
    assert.ok(order <= 0, `orden no determinista entre ${previous.code}:${previous.key} y ${current.code}:${current.key}`);
  }
  assert.equal(result.collisions[0].severity, 'block');
  // R16.3 §3: la historia del compilador se agrupa por raíz; N filas ⇒ UNA colisión con count.
  const legacy = result.collisions.filter((collision) => collision.code === 'legacy-collision');
  assert.equal(legacy.length, 1, 'una sola colisión legacy por raíz, no una por nombre');
  assert.equal(legacy[0].key, 'user-dsh');
  assert.equal(legacy[0].count, 2);
  assert.equal(legacy[0].rows.length, 2);
  assert.deepEqual(legacy[0].rows.map((row) => row.name).sort(), ['legacy-skill', 'legacy-skill-dos']);
  // byKey indexa también por filas y projectId.
  assert.ok(result.byKey.get('nombre-dup').some((collision) => collision.code === 'name-collision'));
  // Contenido: warn (nunca block), aunque el contrato lo llame colisión.
  assert.equal(result.collisions.find((collision) => collision.code === 'content-collision').severity, 'warn');
  assert.equal(result.collisions.find((collision) => collision.code === 'assignment-shadowed').severity, 'warn');
});

// ---------------------------------------------------------------------------
// §3 Colisiones de identidad por contenido (§3.1)
// ---------------------------------------------------------------------------

test('detectCollisions: mismo uuid y mismo nombre con contenidos distintos ⇒ identity-duplicate block', () => {
  const uuid = '22222222-2222-4222-8222-222222222222';
  const entriesWith = (sha) => ([
    entryFixture({ name: 'misma-skill', uuid, sha, path: 'C:/uno/misma-skill/SKILL.md' }),
    entryFixture({ name: 'misma-skill', uuid, sha, path: 'C:/dos/misma-skill/SKILL.md' }),
  ]);
  // El nombre coincide, pero una identidad no puede designar dos contenidos: block.
  const different = detectCollisions({
    entries: [
      entryFixture({ name: 'misma-skill', uuid, sha: 'a'.repeat(64), path: 'C:/uno/misma-skill/SKILL.md' }),
      entryFixture({ name: 'misma-skill', uuid, sha: 'b'.repeat(64), path: 'C:/dos/misma-skill/SKILL.md' }),
    ],
    projects: [],
  });
  const duplicated = different.collisions.find((collision) => collision.code === 'identity-duplicate' && collision.key === uuid);
  assert.ok(duplicated, 'mismo uuid con dos sha256 distintos debe ser identity-duplicate');
  assert.equal(duplicated.severity, 'block');
  // Mismo uuid, mismo nombre y mismo hash: es la misma entrada, no hay colisión de identidad.
  const same = detectCollisions({ entries: entriesWith('a'.repeat(64)), projects: [] });
  assert.equal(same.collisions.filter((collision) => collision.code === 'identity-duplicate' && collision.key === uuid).length, 0);
});

// ---------------------------------------------------------------------------
// §4 Preflight
// ---------------------------------------------------------------------------

test('colisiones: la misma skill propia materializada en dos proyectos NO es name-collision (R16.3bis §1)', () => {
  const sha = 'b50391f6'.padEnd(64, '0');
  const materialized = (projectId, contentSha = sha) => entryFixture({
    name: 'revisar-un-plugin-de-dsh-antes-de-instalarlo',
    ownerKind: 'lifecode',
    provider: 'lifecode-skill-center',
    origin: 'materialized',
    rootId: 'materialized',
    path: `C:/centro/.dsh/.dsh/lifecode-skill-center/materialized/${projectId}/revisar-un-plugin-de-dsh-antes-de-instalarlo/SKILL.md`,
    directory: `C:/centro/.dsh/.dsh/lifecode-skill-center/materialized/${projectId}/revisar-un-plugin-de-dsh-antes-de-instalarlo`,
    sha: contentSha,
    cwd: `C:/work/${projectId}`,
    loadedByHost: true,
  });

  const twin = detectCollisions({ entries: [materialized('plugins-dhs-7e085aaa'), materialized('proyecto-b-47c64e02')] });
  assert.equal(twin.collisions.filter((collision) => collision.code === 'name-collision').length, 0, 'es la misma skill vista desde dos proyectos');
  assert.deepEqual(twin.ambiguousNames, [], 'tampoco es ambigua: no hay dos candidatos distintos');

  const differ = detectCollisions({
    entries: [materialized('plugins-dhs-7e085aaa'), materialized('proyecto-b-47c64e02', 'c'.repeat(64))],
  });
  const clash = differ.collisions.filter((collision) => collision.code === 'name-collision');
  assert.equal(clash.length, 1, 'con contenido distinto sí hay dos skills distintas con el mismo nombre');
  assert.equal(clash[0].severity, 'block', 'dos copias nuestras que no son la misma skill se pisan al materializar');
  assert.equal(differ.ambiguousNames.length, 1);
});

test('colisiones: assignment-shadowed sólo juzga el proyecto observado (R16.3bis §2)', () => {
  const projects = [
    { id: 'plugins-dhs-7e085aaa', cwd: 'C:/xampp/htdocs/plugins-dhs' },
    { id: 'proyecto-b-47c64e02', cwd: 'C:/xampp/htdocs/proyecto-b' },
  ];
  const ours = (projectId, cwd, shadowPath) => entryFixture({
    name: 'skill-sombreada',
    ownerKind: 'lifecode',
    provider: 'lifecode-skill-center',
    origin: 'registry',
    rootId: 'registry',
    path: 'C:/centro/.dsh/.dsh/lifecode-skill-center/skills/skill-sombreada/SKILL.md',
    sha: 'd'.repeat(64),
    cwd,
    shadowedBy: { provider: 'otro-proveedor', path: shadowPath, source: 'prompt' },
    projectId,
  });
  const entries = [
    ours('plugins-dhs-7e085aaa', projects[0].cwd, 'C:/other/skills/skill-sombreada/SKILL.md'),
    ours('proyecto-b-47c64e02', projects[1].cwd, 'C:/other/skills/skill-sombreada/SKILL.md'),
  ];
  const assignments = {
    'plugins-dhs-7e085aaa': { 'skill-sombreada': { enabled: true } },
    'proyecto-b-47c64e02': { 'skill-sombreada': { enabled: true } },
  };

  const observed = detectCollisions({ entries, projects, assignments, observedProjectId: 'proyecto-b-47c64e02' });
  const observedShadowed = observed.collisions.filter((collision) => collision.code === 'assignment-shadowed');
  assert.equal(observedShadowed.length, 1, 'el sombreado cruzado del otro proyecto no se reporta');
  assert.equal(observedShadowed[0].rows[0].projectId, 'proyecto-b-47c64e02');

  const historical = detectCollisions({ entries, projects, assignments });
  assert.equal(historical.collisions.filter((collision) => collision.code === 'assignment-shadowed').length, 2, 'sin contexto observado se conserva el barrido histórico');

  // El ganador es nuestra materialización del MISMO proyecto: el Host carga justo lo que la asignación pide.
  const sameEntry = ours(
    'proyecto-b-47c64e02',
    projects[1].cwd,
    'C:/centro/.dsh/.dsh/lifecode-skill-center/materialized/proyecto-b-47c64e02/skill-sombreada/SKILL.md',
  );
  sameEntry.association.shadowedBy = {
    provider: 'lifecode-skill-center',
    path: 'C:/centro/.dsh/.dsh/lifecode-skill-center/materialized/proyecto-b-47c64e02/skill-sombreada/SKILL.md',
    source: 'materialized',
  };
  const same = detectCollisions({
    entries: [sameEntry],
    projects: [projects[1]],
    assignments: { 'proyecto-b-47c64e02': { 'skill-sombreada': { enabled: true } } },
    observedProjectId: 'proyecto-b-47c64e02',
  });
  assert.equal(same.collisions.filter((collision) => collision.code === 'assignment-shadowed').length, 0);
});

test('preflight: required ausente ⇒ block evidence-incomplete (nunca warn)', () => {
  const result = preflight({
    action: 'assign-skill',
    state: emptyState({ projects: { p1: { id: 'p1', cwd: 'C:/w/p1', manifestSha256: 'sha' } } }),
    sources: [
      { id: 'state', status: 'complete' },
      { id: 'manifest', status: 'error', reason: 'EACCES' },
    ],
    projectId: 'p1',
    skillId: 'skill-a',
  });
  assert.equal(result.decision, 'block');
  assert.ok(result.findings.some((finding) => finding.code === 'evidence-incomplete' && finding.severity === 'block'));
  assert.equal(result.evidence.preflightVersion, 1);
  assert.match(result.evidence.inventoryHash, /^[0-9a-f]{64}$/);
  assert.equal(result.evidence.stateSha256.length, 64);
});

test('preflight: optional ausente ⇒ warn catalog-unverified; allow limpio con required completo', () => {
  const warnResult = preflight({
    action: 'register-project',
    state: emptyState(),
    sources: [
      { id: 'state', status: 'complete' },
      { id: 'filesystem-project', status: 'complete' },
    ],
  });
  assert.equal(warnResult.decision, 'warn');
  assert.ok(warnResult.findings.some((finding) => finding.code === 'catalog-unverified' && finding.severity === 'warn'));
  assert.ok(!warnResult.findings.some((finding) => finding.severity === 'block'));

  const allowResult = preflight({
    action: 'create-skill',
    state: emptyState(),
    inventory: { entries: [], complete: true },
    sources: [
      { id: 'state', status: 'complete' },
      { id: 'manifest', status: 'complete' },
      { id: 'skills-registry', status: 'complete' },
    ],
  });
  assert.equal(allowResult.decision, 'allow');
  assert.deepEqual(allowResult.findings, []);
  assert.equal(allowResult.evidence.preflightVersion, 1);

  // R16.1 §2: crear deja el catálogo en OPTIONAL — sin catálogo se avisa y se continúa…
  const createNoCatalog = preflight({
    action: 'create-skill',
    state: emptyState(),
    sources: [
      { id: 'state', status: 'complete' },
      { id: 'manifest', status: 'complete' },
    ],
  });
  assert.equal(createNoCatalog.decision, 'warn');
  assert.ok(createNoCatalog.findings.some((finding) => finding.code === 'catalog-unverified' && finding.severity === 'warn'));
  // …pero publicar lo exige en REQUIRED: sin catálogo no se publica a ciegas.
  const publishNoCatalog = preflight({
    action: 'publish-version',
    state: emptyState(),
    sources: [
      { id: 'state', status: 'complete' },
      { id: 'manifest', status: 'complete' },
    ],
  });
  assert.equal(publishNoCatalog.decision, 'block');
  assert.ok(publishNoCatalog.findings.some((finding) => finding.code === 'evidence-incomplete' && finding.severity === 'block'));
  assert.equal(requiredSources('publish-version').includes('skills-registry'), true);
  assert.equal(PREFLIGHT_ACTIONS.includes('register-project'), true);
  assert.deepEqual(requiredSources('materialize-project'), ['state', 'manifest', 'skills-registry', 'filesystem-view']);

  // `project-unavailable` sólo bloquea cuando la acción exige `filesystem-project`: assign/enable no lo
  // exigen (un proyecto registrado cuya carpeta desapareció no impide habilitar su skill materializada).
  const assignMissingDir = preflight({
    action: 'assign-skill',
    state: emptyState({ projects: { p1: { id: 'p1', cwd: 'C:/w/p1', manifestSha256: 'sha' } } }),
    sources: [
      { id: 'state', status: 'complete' },
      { id: 'manifest', status: 'complete' },
    ],
    projectId: 'p1',
    skillId: 'skill-a',
    projectAvailability: 'missing-dir',
  });
  assert.ok(!assignMissingDir.findings.some((finding) => finding.code === 'project-unavailable'));
  // register-project tampoco se bloquea por una carpeta aún inexistente: la observación
  // `filesystem-project` ya es completa y el registro histórico de una ruta no creada se mantiene.
  const registerMissingDir = preflight({
    action: 'register-project',
    state: emptyState(),
    sources: [
      { id: 'state', status: 'complete' },
      { id: 'filesystem-project', status: 'complete' },
    ],
    projectAvailability: 'missing-dir',
  });
  assert.ok(!registerMissingDir.findings.some((finding) => finding.code === 'project-unavailable'));
  assert.equal(registerMissingDir.decision, 'warn');
});

test('preflight: ambigüedad que afecta al sujeto ⇒ block ambiguous-identity', () => {
  const result = preflight({
    action: 'assign-skill',
    state: emptyState({ projects: { p1: { id: 'p1', cwd: 'C:/w/p1', manifestSha256: 'sha' } } }),
    sources: [
      { id: 'state', status: 'complete' },
      { id: 'manifest', status: 'complete' },
    ],
    projectId: 'p1',
    skillId: 'nombre-dup',
    collisions: { collisions: [], ambiguousNames: ['nombre-dup', 'otra'] },
  });
  assert.equal(result.decision, 'block');
  assert.ok(result.findings.some((finding) => finding.code === 'ambiguous-identity' && finding.severity === 'block'));
});

test('preflight: content-collision siempre warn; manifest-mismatch block; assignment-shadowed block sólo al materializar', () => {
  const base = {
    action: 'assign-skill',
    state: emptyState({ projects: { p1: { id: 'p1', cwd: 'C:/w/p1', manifestSha256: 'sha' } } }),
    sources: [
      { id: 'state', status: 'complete' },
      { id: 'manifest', status: 'complete' },
    ],
    projectId: 'p1',
    skillId: 'mismo-uno',
  };
  const content = preflight({
    ...base,
    collisions: { collisions: [{ code: 'content-collision', severity: 'block', key: 'mismo-uno', rows: [] }], ambiguousNames: [] },
  });
  const contentFinding = content.findings.find((finding) => finding.code === 'content-collision');
  assert.equal(contentFinding.severity, 'warn');
  assert.equal(content.decision, 'warn');

  const mismatch = preflight({ ...base, identityState: 'mismatch' });
  assert.equal(mismatch.decision, 'block');
  assert.ok(mismatch.findings.some((finding) => finding.code === 'manifest-mismatch' && finding.severity === 'block'));

  const shadow = { code: 'assignment-shadowed', severity: 'warn', key: 'p1:shadow', rows: [{ key: 'p1:shadow', projectId: 'p1' }] };
  const assign = preflight({ ...base, skillId: 'shadow', collisions: { collisions: [shadow], ambiguousNames: [] } });
  assert.equal(assign.decision, 'warn');
  const materialize = preflight({
    action: 'materialize-project',
    state: base.state,
    sources: [...base.sources, { id: 'skills-registry', status: 'complete' }, { id: 'filesystem-view', status: 'complete' }],
    projectId: 'p1',
    skillId: 'shadow',
    collisions: { collisions: [shadow], ambiguousNames: [] },
  });
  assert.equal(materialize.decision, 'block');
  assert.ok(materialize.findings.some((finding) => finding.code === 'assignment-shadowed' && finding.severity === 'block'));
});

// ---------------------------------------------------------------------------
// §1.2/1.3 Proyectos: siete estados, precedencia y operaciones
// ---------------------------------------------------------------------------

function healthyObservation(overrides = {}) {
  const cwd = 'C:/work/proyecto';
  return projectObservation({
    workspace: { workspaceId: 'w1', title: 'Proyecto', path: cwd, availability: 'ok' },
    record: {
      id: 'p1',
      name: 'Proyecto',
      cwd,
      createdAt: '2026-01-01T00:00:00.000Z',
      uuid: '22222222-2222-4222-8222-222222222222',
      manifestSha256: 'sha-1',
    },
    manifest: {
      present: true,
      status: 'ok',
      projectId: 'p1',
      sha256: 'sha-1',
      uuid: '22222222-2222-4222-8222-222222222222',
      registeredAt: '2026-01-01T00:00:00.000Z',
    },
    availability: 'ok',
    inspection: { status: 'complete', inspectedAt: '2026-01-02T00:00:00.000Z', reason: '' },
    ...overrides,
  });
}

test('classifyProject: los siete estados con su precedencia', () => {
  assert.equal(classifyProject(healthyObservation()).state, 'healthy');

  // managed: registrado pero con aviso (registro heredado sin uuid).
  const managed = healthyObservation();
  managed.record = { ...managed.record, uuid: '' };
  assert.equal(classifyProject(managed).state, 'managed');

  // discovered: workspace disponible sin registro ni manifiesto.
  assert.equal(classifyProject(projectObservation({ workspace: { workspaceId: 'w1', path: 'C:/work/nuevo' }, availability: 'ok' })).state, 'discovered');

  // external-managed: manifiesto válido en disco sin registro.
  assert.equal(classifyProject(projectObservation({
    workspace: { workspaceId: 'w1', path: 'C:/work/ext' },
    manifest: { present: true, status: 'ok', projectId: 'p-ext', sha256: 'sha-ext' },
    availability: 'ok',
  })).state, 'external-managed');

  // unavailable: la carpeta no existe.
  assert.equal(classifyProject(healthyObservation({ availability: 'missing-dir' })).state, 'unavailable');

  // partially-inspected: la inspección no terminó.
  assert.equal(classifyProject(healthyObservation({ inspection: { status: 'incomplete', reason: 'timeout' } })).state, 'partially-inspected');

  // identity-conflict: manifiesto con otra identidad.
  const conflict = healthyObservation();
  conflict.manifest = { ...conflict.manifest, projectId: 'p-otro' };
  assert.equal(classifyProject(conflict).state, 'identity-conflict');

  // Precedencia: identity-conflict gana a unavailable.
  const both = healthyObservation({ availability: 'missing-dir' });
  both.manifest = { ...both.manifest, projectId: 'p-otro' };
  assert.equal(classifyProject(both).state, 'identity-conflict');
  // unavailable gana a partially-inspected.
  assert.equal(classifyProject(healthyObservation({ availability: 'missing-dir', inspection: { status: 'failed' } })).state, 'unavailable');
  // partially-inspected gana a external-managed.
  assert.equal(classifyProject(projectObservation({
    workspace: { workspaceId: 'w1', path: 'C:/work/ext' },
    manifest: { present: true, status: 'ok', projectId: 'p-ext', sha256: 'sha-ext' },
    availability: 'ok',
    inspection: { status: 'incomplete' },
  })).state, 'partially-inspected');
  assert.deepEqual(PROJECT_STATES.slice().sort(), [
    'discovered',
    'external-managed',
    'healthy',
    'identity-conflict',
    'managed',
    'partially-inspected',
    'unavailable',
  ]);
});

test('allowedOperations: la tabla ALLOWED §1.3 por estado', () => {
  assert.deepEqual(allowedOperations('identity-conflict'), ['read', 'inspect', 'detach-project']);
  assert.deepEqual(allowedOperations('unavailable'), ['read', 'inspect', 'detach-project', 'repair-manifest']);
  assert.deepEqual(allowedOperations('partially-inspected'), ['read', 'inspect']);
  assert.deepEqual(allowedOperations('external-managed'), ['read', 'inspect', 'adopt-project', 'detach-project']);
  assert.deepEqual(allowedOperations('discovered'), ['read', 'inspect', 'register-project']);
  assert.ok(allowedOperations('healthy').includes('assign-skill'));
  assert.ok(allowedOperations('managed').includes('register-project'));
  assert.ok(!allowedOperations('healthy').includes('register-project'));
  assert.ok(!allowedOperations('discovered').includes('assign-skill'));
});

// ---------------------------------------------------------------------------
// §1.4/5.4 Payload y detalle puros
// ---------------------------------------------------------------------------

test('buildProjectsPayload: discovered calcula projectId sin registrar y no muta el estado', () => {
  const boxRoot = box('r16-payload');
  const cwd = ensureDir(boxRoot, 'proyecto-libre');
  const state = emptyState();
  const payload = buildProjectsPayload({
    workspaces: [{ workspaceId: 'w1', title: 'Libre', path: cwd, sessionCount: 3, status: 'ok' }],
    state,
    hostCwd: cwd,
  });
  assert.equal(payload.projects.length, 0);
  assert.equal(payload.discovered.length, 1);
  const discovered = payload.discovered[0];
  assert.equal(discovered.state, 'discovered');
  assert.equal(discovered.projectId, projectIdFor(cwd));
  assert.equal(discovered.sessionCount, 3);
  assert.equal(payload.summary.discovered, 1);
  assert.equal(payload.current.projectId, null);
  assert.equal(payload.current.cwd, normalizeCwd(cwd));
  assert.deepEqual(Object.keys(state.projects), []);
  assert.equal(payload.complete, true);
});

test('buildProjectsPayload: manifiesto sin registro ⇒ external-managed y su ficha se abre', () => {
  const boxRoot = box('r16-external');
  const cwd = ensureDir(boxRoot, 'proyecto-externo');
  const projectId = projectIdFor(cwd);
  const manifests = [{ present: true, status: 'ok', projectId, cwd, sha256: 'sha-ext', registeredAt: '2026-01-01T00:00:00.000Z' }];
  const payload = buildProjectsPayload({
    workspaces: [{ workspaceId: 'w1', title: 'Externo', path: cwd, status: 'ok' }],
    state: emptyState(),
    manifests,
    hostCwd: cwd,
  });
  assert.equal(payload.projects.length, 1);
  assert.equal(payload.projects[0].state, 'external-managed');
  assert.equal(payload.projects[0].registration.present, false);
  assert.deepEqual(payload.discovered, []);
  const detail = buildProjectDetail({ projectId, workspaces: [{ workspaceId: 'w1', title: 'Externo', path: cwd, status: 'ok' }], state: emptyState(), manifests });
  assert.ok(detail, 'la ficha de un external-managed debe abrirse');
  assert.equal(detail.state, 'external-managed');
  assert.equal(detail.identity.state, 'missing');
  assert.deepEqual(detail.sources.map((source) => source.id), [
    'state',
    'workspace-registry',
    'skills-registry',
    'loader',
    'filesystem-project',
    'manifest',
    'filesystem-view',
    'sessions',
  ]);
});

test('dos proyectos con el mismo cwdKey ⇒ identity-conflict en lista y en detalle', () => {
  const cwd = 'C:/work/duplicado';
  const state = emptyState({
    projects: {
      a: { id: 'a', name: 'A', cwd, createdAt: '2026-01-01T00:00:00.000Z', uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', manifestSha256: 'sha-a' },
      b: { id: 'b', name: 'B', cwd: 'C:/WORK/Duplicado/', createdAt: '2026-01-02T00:00:00.000Z', uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', manifestSha256: 'sha-b' },
    },
  });
  const workspaces = [{ workspaceId: 'w1', title: 'Duplicado', path: cwd, status: 'ok' }];
  assert.equal(cwdKey('C:/WORK/Duplicado/'), cwdKey(cwd));
  const payload = buildProjectsPayload({ workspaces, state });
  assert.equal(payload.summary.identityConflict, 2);
  assert.deepEqual(payload.projects.map((project) => project.state), ['identity-conflict', 'identity-conflict']);
  const detailA = buildProjectDetail({ projectId: 'a', workspaces, state });
  const detailB = buildProjectDetail({ projectId: 'b', workspaces, state });
  assert.equal(detailA.state, 'identity-conflict');
  assert.equal(detailB.state, 'identity-conflict');
  assert.equal(detailA.state, payload.projects.find((project) => project.projectId === 'a').state);
  assert.equal(detailB.state, payload.projects.find((project) => project.projectId === 'b').state);
});

test('buildProjectsPayload y buildProjectDetail no escriben ni un byte (hash del árbol antes/después)', () => {
  const boxRoot = box('r16-pureza');
  const cwd = ensureDir(boxRoot, 'proyecto');
  writeSkillFile(cwd, '.dsh/skills/propia', { name: 'propia' });
  const center = ensureDir(boxRoot, 'centro');
  writeFileSync(join(center, 'center.json'), JSON.stringify(emptyState()), 'utf8');
  ensureDir(center, 'materialized', 'p1');
  writeFileSync(join(center, 'materialized', 'p1', 'manifest.json'), JSON.stringify({ projectId: 'p1', cwd, skills: [] }), 'utf8');
  const state = emptyState({
    projects: {
      p1: { id: 'p1', name: 'Proyecto', cwd, createdAt: '2026-01-01T00:00:00.000Z', uuid: '33333333-3333-4333-8333-333333333333', manifestSha256: 'sha-1' },
    },
    skills: { 'skill-a': { id: 'skill-a', title: 'A', description: 'd', status: 'published', currentVersion: '1.0.0', versions: [{ version: '1.0.0', body: 'x' }] } },
    assignments: { p1: { 'skill-a': { enabled: true, version: '1.0.0', updatedAt: '2026-01-01T00:00:00.000Z', by: 'human' } } },
  });
  const inventory = {
    entries: [entryFixture({ name: 'skill-a', ownerKind: 'lifecode', origin: 'materialized', provider: 'lifecode-skill-center', path: join(center, 'materialized', 'p1', 'skill-a', 'SKILL.md'), cwd, projectId: 'p1' })],
    sources: [{ id: 'state', status: 'complete' }, { id: 'skills-registry', status: 'complete' }],
  };
  const before = hashTree(boxRoot);
  const payload = buildProjectsPayload({ workspaces: [{ workspaceId: 'w1', title: 'Proyecto', path: cwd, status: 'ok' }], state, hostCwd: cwd, inventory });
  const detail = buildProjectDetail({ projectId: 'p1', workspaces: [{ workspaceId: 'w1', title: 'Proyecto', path: cwd, status: 'ok' }], state, inventory });
  const after = hashTree(boxRoot);
  assert.equal(before, after, 'la proyección de proyectos debe ser pura');
  assert.equal(payload.projects.length, 1);
  assert.ok(detail);
  assert.equal(detail.counts.assigned, 1);
  assert.equal(detail.counts.active, 1);
  assert.equal(detail.counts.materialized, 1);
  assert.equal(detail.assignments[0].skillId, 'skill-a');
  assert.equal(detail.skills[0].host !== null, true);
  assert.equal(detail.sessions.count, null);
  assert.equal(detail.sessions.source, 'none');
});

test('buildProjectsPayload: la disponibilidad no se inventa (sin medición ⇒ unknown; missing-dir ⇒ unavailable)', () => {
  const cwd = 'C:/work/carpeta-medida';
  const state = emptyState({
    projects: {
      p1: {
        id: 'p1',
        name: 'Medida',
        cwd,
        createdAt: '2026-01-01T00:00:00.000Z',
        uuid: '44444444-4444-4444-8444-444444444444',
        manifestSha256: 'sha-medida',
      },
    },
  });
  const manifests = [{ present: true, status: 'ok', projectId: 'p1', cwd, sha256: 'sha-medida', registeredAt: '2026-01-01T00:00:00.000Z' }];
  // Sin nadie que aporte la medición, el módulo puro NO puede afirmar salud.
  const unmeasured = buildProjectsPayload({ workspaces: [], state, hostCwd: cwd, manifests });
  assert.equal(unmeasured.projects[0].state, 'managed');
  assert.ok(unmeasured.projects[0].reasons.some((reason) => String(reason).includes('No se pudo comprobar')), 'debe avisar de que no se pudo comprobar la carpeta');
  // Con la carpeta medida como ausente, el estado es unavailable (nunca healthy).
  const measured = buildProjectsPayload({
    workspaces: [],
    state,
    hostCwd: cwd,
    manifests,
    availability: [{ projectId: 'p1', cwd, availability: 'missing-dir' }],
  });
  assert.equal(measured.projects[0].state, 'unavailable');
  assert.ok(measured.projects[0].reasons.some((reason) => String(reason).includes('no existe')));
  // Y con la carpeta medida como presente, sí puede ser healthy.
  const present = buildProjectsPayload({
    workspaces: [],
    state,
    hostCwd: cwd,
    manifests,
    availability: [{ projectId: 'p1', cwd, availability: 'ok' }],
  });
  assert.equal(present.projects[0].state, 'healthy');
});
