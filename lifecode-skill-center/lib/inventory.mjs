/**
 * Inventario de Skills: qué hay, de quién es y qué cargaría el Host.
 *
 * Módulo PURO en el sentido de la casa: no importa Cordis ni ningún paquete del harness, no escribe nada y toda
 * la E/S entra por `adapters`. La regla del Host es la del cargador (`dsh-skill-filesystem`):
 * profundidad 1, `<dir>/<nombre>/SKILL.md` y `<dir>/<nombre>.md`; el nombre sale del FRONTMATTER, no de
 * la carpeta. Las raíces heredadas del compilador y la vista materializada tienen un `layout` declarado
 * (Enmienda E1 del contrato) y son las ÚNICAS donde se permite bajar más de un nivel.
 *
 * Nada de aquí lanza hacia fuera: un adaptador que falla deja `sources[i].status = 'error'`,
 * `complete:false` y un aviso; el panel puede seguir mostrando lo que sí se observó.
 */

import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

import { canonicalSkillName } from './collisions.mjs';
import { cwdKey, normalizeCwd } from './format.mjs';
import { parseSkillFile, renderSkillFile } from './skillfile.mjs';

export const INVENTORY_VERSION = 1;

/** Fuentes de OBSERVACIÓN del contrato §5.1: estado de lo que se pudo comprobar, no de los datos. */
export const SOURCE_IDS = [
  'state',
  'workspace-registry',
  'skills-registry',
  'loader',
  'filesystem-project',
  'manifest',
  'filesystem-view',
  'sessions',
];

/** Fuentes declaradas que nunca se leen por diseño (E1): se informan, no se finge que están vacías. */
export const DECLARED_SOURCE_IDS = [...SOURCE_IDS, 'hermes-legacy', 'builtin-asar'];

const SOURCE_LABELS = {
  state: 'Almacén del centro',
  'workspace-registry': 'Registro de workspaces del Host',
  'skills-registry': 'Catálogo de skills del Host',
  loader: 'Cargador de plugins',
  'filesystem-project': 'Sistema de ficheros del proyecto',
  manifest: 'Manifiestos de proyecto',
  'filesystem-view': 'Raíces de skills en disco',
  sessions: 'Sesiones del Host',
  'hermes-legacy': 'Skills heredadas de Hermes (fuera de DSH_HOME)',
  'builtin-asar': 'Skills empaquetadas en app.asar',
};

export const DEFAULT_LIMITS = { maxEntries: 2000, maxBytes: 4 * 1024 * 1024, maxRootEntries: 500 };

const HOST_RANKS = {
  'project-dsh': { rank: 100, scope: 'project', kind: 'host' },
  'project-agents': { rank: 200, scope: 'project', kind: 'host' },
  custom: { rank: 300, scope: 'user', kind: 'host' },
  'user-dsh': { rank: 400, scope: 'user', kind: 'host', skipSystem: true },
  'user-agents': { rank: 500, scope: 'user', kind: 'host' },
  bundled: { rank: 600, scope: 'global', kind: 'bundled', owner: 'bundled' },
};

/** Identificadores de las raíces observables fuera del cargador (E1). */
export const INVENTORY_ROOT_IDS = ['compiler-projects', 'compiler-global', 'materialized'];

/** Descripción de las fuentes declaradas que el inventario NUNCA lee (E1). */
export function declaredSources() {
  return [
    {
      id: 'hermes-legacy',
      status: 'unavailable',
      reason: 'outside-dsh-home',
      found: null,
      label: SOURCE_LABELS['hermes-legacy'],
    },
    {
      id: 'builtin-asar',
      status: 'unavailable',
      reason: 'opaque-container',
      found: null,
      label: SOURCE_LABELS['builtin-asar'],
    },
  ];
}

/**
 * Descriptor de la fuente pedida. Para las fuentes de ficheros incluye las raíces que se escanearían.
 */
export function sourceDefinition({ id = '', dshHome = '', agentsHome = '', projectRoot = '', bundledDir = '', customDirs = [] } = {}) {
  const roots = skillRootsFor({ dshHome, agentsHome, projectRoot, bundledDir, customDirs });
  const known = SOURCE_LABELS[id];
  return {
    id,
    label: known ?? id,
    declaredOnly: id === 'hermes-legacy' || id === 'builtin-asar',
    roots: ['filesystem-view', 'filesystem-project', 'state'].includes(id) ? roots : [],
    dshHome: normalizeCwd(dshHome) || null,
    agentsHome: normalizeCwd(agentsHome) || null,
    projectRoot: normalizeCwd(projectRoot) || null,
  };
}

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Raíz del cargador y raíces declaradas, con rank y dueño (E1). Sin tocar el disco.
 * `materializedRoot` es inyectable (tests, `LIFECODE_SKILL_CENTER_ROOT`, `context.root`); si no se da,
 * se usa `<dshHome>/lifecode-skill-center/materialized` como fallback documentado.
 */
export function skillRootsFor({ cwd = '', dshHome = '', agentsHome = '', customDirs = [], bundledDir = '', projectRoot = '', materializedRoot = '' } = {}) {
  const roots = [];
  const projectBase = normalizeCwd(projectRoot) || normalizeCwd(cwd);
  if (projectBase !== '') {
    for (const source of ['project-dsh', 'project-agents']) {
      const meta = HOST_RANKS[source];
      const dir = source === 'project-dsh' ? join(projectBase, '.dsh', 'skills') : join(projectBase, '.agents', 'skills');
      roots.push({
        rootId: `${source}:${cwdKey(projectBase)}`,
        kind: meta.kind,
        dir: normalizeCwd(dir),
        rank: meta.rank,
        source,
        scope: meta.scope,
        owner: 'filesystem',
        hostScanned: true,
        projectRoot: projectBase,
        present: null,
        found: 0,
      });
    }
  }
  const custom = Array.isArray(customDirs) ? customDirs : [];
  custom.forEach((dir, index) => {
    if (typeof dir !== 'string' || normalizeCwd(dir) === '') return;
    const meta = HOST_RANKS.custom;
    roots.push({
      rootId: `custom:${cwdKey(dir)}`,
      kind: meta.kind,
      dir: normalizeCwd(dir),
      rank: meta.rank,
      source: 'custom',
      scope: meta.scope,
      owner: 'filesystem',
      hostScanned: true,
      present: null,
      found: 0,
      index,
    });
  });
  const dsh = normalizeCwd(dshHome);
  if (dsh !== '') {
    roots.push({
      rootId: `user-dsh:${cwdKey(dsh)}`,
      kind: 'host',
      dir: normalizeCwd(join(dsh, 'skills')),
      rank: HOST_RANKS['user-dsh'].rank,
      source: 'user-dsh',
      scope: 'user',
      owner: 'filesystem',
      hostScanned: true,
      skipSystem: true,
      present: null,
      found: 0,
    });
    // E1: raíces heredadas del compilador anterior (el Host no las carga desde ahí).
    roots.push({
      rootId: 'compiler-projects',
      kind: 'legacy',
      dir: normalizeCwd(join(dsh, 'skill-compiler', 'projects')),
      rank: 700,
      source: 'skill-compiler',
      scope: 'user',
      owner: 'filesystem',
      hostScanned: false,
      present: null,
      found: 0,
      layout: {
        depth: 3,
        buckets: { live: ['approved', 'published', 'disabled'], history: ['superseded'] },
        skipDirs: ['upstream'],
      },
    });
    roots.push({
      rootId: 'compiler-global',
      kind: 'legacy',
      dir: normalizeCwd(join(dsh, 'skill-compiler', 'global')),
      rank: 701,
      source: 'skill-compiler',
      scope: 'user',
      owner: 'filesystem',
      hostScanned: false,
      present: null,
      found: 0,
      layout: { depth: 1 },
    });
  }
  // E1: vista materializada del propio centro; su identidad la sostiene manifest.json.
  // La raíz es inyectable (tests, LIFECODE_SKILL_CENTER_ROOT, context.root); sin inyección se usa
  // <dshHome>/lifecode-skill-center/materialized, que es el default real de state.materializedRoot.
  const materializedBase = normalizeCwd(materializedRoot)
    || (dsh !== '' ? normalizeCwd(join(dsh, 'lifecode-skill-center', 'materialized')) : '');
  if (materializedBase !== '') {
    roots.push({
      rootId: 'materialized',
      kind: 'derived',
      dir: materializedBase,
      rank: 702,
      source: 'lifecode-skill-center',
      scope: 'project',
      owner: 'lifecode',
      hostScanned: false,
      present: null,
      found: 0,
      layout: { depth: 2 },
    });
  }
  const agents = normalizeCwd(agentsHome);
  if (agents !== '') {
    roots.push({
      rootId: `user-agents:${cwdKey(agents)}`,
      kind: 'host',
      dir: normalizeCwd(join(agents, 'skills')),
      rank: HOST_RANKS['user-agents'].rank,
      source: 'user-agents',
      scope: 'user',
      owner: 'filesystem',
      hostScanned: true,
      present: null,
      found: 0,
    });
  }
  const bundled = normalizeCwd(bundledDir);
  if (bundled !== '') {
    roots.push({
      rootId: `bundled:${cwdKey(bundled)}`,
      kind: 'bundled',
      dir: bundled,
      rank: HOST_RANKS.bundled.rank,
      source: 'bundled',
      scope: 'global',
      owner: 'bundled',
      hostScanned: true,
      present: null,
      found: 0,
    });
  }
  roots.sort((a, b) => a.rank - b.rank);
  return roots;
}

function toBytes(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (typeof bytes === 'string') return Buffer.from(bytes, 'utf8');
  return Buffer.alloc(0);
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(toBytes(bytes)).digest('hex');
}

/**
 * Frontmatter de un SKILL.md según las reglas del Host. Devuelve los campos válidos o `{error}`;
 * nunca lanza (el fichero roto es un dato observable, no una excepción).
 */
export function parseSkillFrontmatter(bytes) {
  const buffer = toBytes(bytes);
  if (buffer.length === 0) return { error: 'empty-file' };
  const text = buffer.toString('utf8');
  const parsed = parseSkillFile(text);
  const data = isObject(parsed?.data) ? parsed.data : {};
  for (const legacy of ['disableModelInvocation', 'modelInvocable', 'userInvocable']) {
    if (Object.prototype.hasOwnProperty.call(data, legacy)) return { error: 'legacy-key', name: safeText(data.name) };
  }
  const rawName = data.name;
  const description = data.description;
  if (typeof rawName !== 'string' || rawName.trim() === '') return { error: 'missing-name' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawName.trim())) {
    return { error: 'invalid-name', name: rawName.trim(), description: safeText(description) };
  }
  if (typeof description !== 'string' || description.trim() === '') {
    return { error: 'missing-description', name: rawName.trim() };
  }
  const invocation = {
    modelInvocable: data['disable-model-invocation'] !== true,
    userInvocable: data['user-invocable'] !== false,
  };
  const metadata = isObject(data.metadata) ? data.metadata : {};
  return {
    name: rawName.trim(),
    description: description.trim(),
    whenToUse: typeof data.whenToUse === 'string' ? data.whenToUse : '',
    metadata,
    invocation,
  };
}

function provenanceLabel(data) {
  const metadata = isObject(data) ? data.metadata : null;
  const dsh = isObject(metadata?.dsh) ? metadata.dsh : null;
  if (typeof dsh?.origin === 'string' && dsh.origin !== '') return dsh.origin;
  return typeof dsh?.skillId === 'string' ? 'lifecode-skill-center' : '';
}

function originFor(root) {
  const kind = root?.kind;
  if (kind === 'legacy') return 'skill-compiler';
  if (kind === 'derived') return 'materialized';
  if (kind === 'bundled') return 'bundled';
  return 'filesystem';
}

function rootOwner(root) {
  if (root?.kind === 'bundled') return 'bundled';
  if (root?.kind === 'derived') return 'lifecode';
  return root?.owner === 'lifecode' ? 'lifecode' : 'filesystem';
}

function providerFor(root) {
  if (root?.kind === 'derived') return 'lifecode-skill-center';
  if (root?.kind === 'bundled') return 'bundled';
  return root?.source ?? 'filesystem';
}

const EMPTY_ASSOCIATION = { loadedByHost: false, provider: null, path: null, shadowedBy: null };

function pathKey(path) {
  return typeof path === 'string' && path !== '' ? cwdKey(path) : null;
}

/**
 * Entrada de inventario desde un fichero de disco. `root` es la raíz ya resuelta (o un objeto
 * `{source, kind, dir}`); nunca se sigue un symlink: eso lo decide el escáner antes de llamar aquí.
 */
export function entryFromFile({ path, root, bytes, cwd = '', projectRoot = '' } = {}) {
  const buffer = toBytes(bytes);
  const parsed = parseSkillFile(buffer.toString('utf8'));
  const data = isObject(parsed?.data) ? parsed.data : {};
  const frontmatter = parseSkillFrontmatter(buffer);
  const sha = sha256Bytes(buffer);
  const normalizedPath = normalizeCwd(path);
  const fileKind = basename(normalizedPath).toLowerCase() === 'skill.md' ? 'directory' : 'file';
  const directory = fileKind === 'directory' ? normalizeCwd(dirname(normalizedPath)) : normalizeCwd(root?.dir ?? dirname(normalizedPath));
  const errorCode = typeof frontmatter?.error === 'string' ? frontmatter.error : null;
  const name = errorCode === null ? frontmatter.name : (typeof frontmatter?.name === 'string' ? frontmatter.name : null);
  const canonical = canonicalSkillName(name);
  const reasons = [];
  if (errorCode !== null) reasons.push(errorCode);
  const metadata = isObject(data?.metadata) ? data.metadata : {};
  const execution = errorCode === null
    ? frontmatter.invocation
    : { modelInvocable: true, userInvocable: true };
  const scopeKind = root?.scope ?? (root?.kind === 'bundled' ? 'global' : 'user');
  const projectRootValue = normalizeCwd(projectRoot) || (scopeKind === 'project' ? normalizeCwd(root?.projectRoot) : '');
  const originKind = originFor(root);
  return {
    key: `${rootOwner(root)}:${root?.source ?? 'filesystem'}:${cwdKey(normalizedPath) || sha.slice(0, 12)}`,
    name,
    canonicalName: canonical,
    description: errorCode === null ? frontmatter.description : safeText(data?.description),
    whenToUse: errorCode === null ? frontmatter.whenToUse : safeText(data?.whenToUse),
    owner: { kind: rootOwner(root), provider: providerFor(root), pluginEntryId: null },
    origin: {
      kind: originKind,
      label:
        typeof metadata?.dsh?.origin === 'string' && metadata.dsh.origin !== ''
          ? metadata.dsh.origin
          : (isObject(metadata?.hermes) ? 'hermes-legacy' : provenanceLabel(data) || safeText(root?.source)),
    },
    location: {
      kind: fileKind,
      path: normalizedPath,
      directory,
      rootId: safeText(root?.rootId) || safeText(root?.source) || 'filesystem',
    },
    scope: {
      kind: scopeKind,
      projectRoot: projectRootValue || null,
      cwd: normalizeCwd(cwd) || null,
    },
    association: { ...EMPTY_ASSOCIATION },
    execution,
    identity: { uuid: null, version: null, contentSha256: sha, manifestSha256: null },
    confidence: 'content-hash',
    reasons,
  };
}

function candidateOwnerKind(candidate) {
  const provider = safeText(candidate?.provider).toLowerCase();
  const source = safeText(candidate?.source).toLowerCase();
  if (provider.includes('lifecode-skill-center')) return 'lifecode';
  if (source === 'bundled' || provider.includes('bundled')) return 'bundled';
  if (provider.includes('filesystem') || source.includes('project') || source.includes('user') || source.includes('custom')) return 'filesystem';
  return 'plugin';
}

function candidateOriginKind(candidate) {
  const source = safeText(candidate?.source).toLowerCase();
  if (source === 'bundled') return 'bundled';
  return 'loader';
}

/**
 * Entrada de inventario desde una fila del catálogo del Host (`snapshot()`). El Host identifica por
 * nombre y ruta; no da UUID ni versión, así que aquí no se inventan.
 */
export function entryFromCandidate(candidate, context = {}) {
  const name = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
  const canonical = canonicalSkillName(name);
  const provider = safeText(candidate?.provider);
  const source = safeText(candidate?.source);
  const path = typeof candidate?.path === 'string' && candidate.path !== '' ? normalizeCwd(candidate.path) : null;
  const ownerKind = candidateOwnerKind(candidate);
  const projectRoot = normalizeCwd(context.projectRoot);
  const projectPath = projectRoot !== '' && path !== null && cwdKey(path).startsWith(`${cwdKey(projectRoot)}/`);
  const scopeKind = context.scope ?? (path === null ? 'global' : projectPath ? 'project' : 'user');
  return {
    key: `host:${provider || source || 'loader'}:${pathKey(path) ?? canonical ?? name}`,
    name: name || null,
    canonicalName: canonical,
    description: safeText(candidate?.description),
    whenToUse: safeText(candidate?.whenToUse),
    owner: { kind: ownerKind, provider: provider || null, pluginEntryId: null },
    origin: { kind: candidateOriginKind(candidate), label: source || provider || 'loader' },
    location: {
      kind: path === null ? 'virtual' : basename(path).toLowerCase() === 'skill.md' ? 'directory' : 'file',
      path,
      directory: path === null ? null : normalizeCwd(dirname(path)),
      rootId: source || 'loader',
    },
    scope: {
      kind: scopeKind,
      projectRoot: projectPath ? projectRoot : null,
      cwd: normalizeCwd(context.cwd) || null,
    },
    association: {
      loadedByHost: true,
      provider: provider || null,
      path,
      shadowedBy: null,
    },
    execution: {
      modelInvocable: candidate?.invocation?.modelInvocable !== false,
      userInvocable: candidate?.invocation?.userInvocable !== false,
    },
    identity: { uuid: null, version: null, contentSha256: null, manifestSha256: null },
    confidence: path === null ? 'plugin-contract' : 'plugin-contract',
    reasons: path === null ? ['snapshot-without-path'] : [],
    fromSnapshot: true,
  };
}

function associationForWinner(winner) {
  return {
    loadedByHost: true,
    provider: safeText(winner?.provider) || null,
    path: typeof winner?.path === 'string' && winner.path !== '' ? normalizeCwd(winner.path) : null,
    shadowedBy: null,
  };
}

function shadowOf(winner) {
  return {
    provider: safeText(winner?.provider) || null,
    path: typeof winner?.path === 'string' && winner.path !== '' ? normalizeCwd(winner.path) : null,
    source: safeText(winner?.source) || null,
  };
}

/**
 * Cruza las entradas de disco con el ganador del Host. El ganador por nombre es el que devolvió
 * `snapshot()`: aquí NO se recalcula el merge del cargador, sólo se refleja.
 *
 * R16.3bis §5 (tri-estado): `loadedByHost` sólo afirma lo que la evidencia demuestra.
 * - `true` con match real nombre+ruta: el Host sirve exactamente ese fichero.
 * - `false` sólo (i) cuando el ganador del snapshot es OTRO del mismo nombre con ruta conocida
 *   (`shadowedBy`, sombreado demostrado) para una fila que no es del propio centro, o (ii) cuando la
 *   raíz declara `hostScanned:false` (el Host no la escanea: `compiler-projects`).
 * - `null` en el resto, con `association-scope-global` en `reasons`: `snapshot()` puede listar el
 *   nombre sin `path` y se consulta sin `scope` de sesión, así que la ausencia o la falta de ruta NO
 *   prueban que el Host no la cargue. Las filas del propio centro (`lifecode`) nunca pasan a `false`:
 *   que otra copia materializada de otro proyecto sea la ganadora no dice nada de esta.
 */
export function mergeHostWinners({ entries = [], snapshot = null, roots = [] } = {}) {
  const hostScannedByRoot = new Map();
  for (const root of Array.isArray(roots) ? roots : []) {
    const id = safeText(root?.rootId) || safeText(root?.id);
    if (id !== '') hostScannedByRoot.set(id, root?.hostScanned !== false);
  }
  const isOurs = (entry) => safeText(entry?.owner?.kind) === 'lifecode' || safeText(entry?.owner?.provider) === 'lifecode-skill-center';
  const markUnknown = (entry) => {
    entry.association = { ...EMPTY_ASSOCIATION, ...entry.association, loadedByHost: null, provider: null, shadowedBy: null };
    if (!Array.isArray(entry.reasons)) entry.reasons = [];
    if (!entry.reasons.includes('association-scope-global')) entry.reasons.push('association-scope-global');
  };
  const skills = Array.isArray(snapshot) ? snapshot : Array.isArray(snapshot?.skills) ? snapshot.skills : [];
  const result = (Array.isArray(entries) ? entries : []).map((entry) => ({
    ...entry,
    association: { ...EMPTY_ASSOCIATION, ...(isObject(entry?.association) ? entry.association : {}) },
  }));
  const winners = new Map();
  for (const candidate of skills) {
    const name = canonicalSkillName(candidate?.name);
    if (name === null || winners.has(name)) continue;
    winners.set(name, candidate);
  }
  const touched = new Set();
  for (const [name, winner] of winners) {
    const sameName = result.filter((entry) => (canonicalSkillName(entry?.canonicalName) ?? canonicalSkillName(entry?.name)) === name);
    const winnerPath = typeof winner?.path === 'string' && winner.path !== '' ? pathKey(winner.path) : null;
    const winnerProvider = safeText(winner?.provider ?? winner?.source).trim().toLowerCase();
    const winnerIsOurs = winnerProvider === 'lifecode-skill-center';
    let match = null;
    if (winnerPath !== null) match = sameName.find((entry) => pathKey(entry?.location?.path) === winnerPath) ?? null;
    if (match) {
      match.association = associationForWinner(winner);
      touched.add(match.key);
    }
    // Sin ruta del ganador no se puede demostrar qué fichero sirve el Host. Pero si el ganador es de
    // OTRO proveedor, el nombre ya está servido por él: nuestras copias quedan sombreadas por proveedor
    // (`false`), aunque la ruta concreta quede sin probar.
    if (winnerPath !== null) {
      for (const entry of sameName) {
        if (entry === match) continue;
        // Una copia del propio centro sombreada por otra copia del MISMO proveedor (otro proyecto) es
        // un asunto de ámbito, no una prueba de que el Host no cargue esta: `null`. Si la sirve otro
        // proveedor, el sombreado sí está demostrado: `false` + `shadowedBy`.
        if (isOurs(entry) && winnerIsOurs) {
          markUnknown(entry);
        } else {
          entry.association = {
            ...entry.association,
            loadedByHost: false,
            provider: entry.association?.loadedByHost === true ? entry.association.provider : entry.association?.provider ?? null,
            shadowedBy: shadowOf(winner),
          };
        }
        touched.add(entry.key);
      }
    } else if (!winnerIsOurs) {
      for (const entry of sameName) {
        if (!isOurs(entry)) continue;
        entry.association = { ...entry.association, loadedByHost: false, provider: null, shadowedBy: shadowOf(winner) };
        touched.add(entry.key);
      }
    }
    if (!match && sameName.length === 0) {
      const row = entryFromCandidate(winner, { cwd: snapshot?.cwd ?? '' });
      result.push(row);
      touched.add(row.key);
    }
  }
  for (const entry of result) {
    if (touched.has(entry.key)) continue;
    const rootId = safeText(entry?.location?.rootId);
    const notScanned = hostScannedByRoot.get(rootId) === false;
    if (notScanned && !isOurs(entry)) {
      entry.association = { ...EMPTY_ASSOCIATION, ...entry.association, loadedByHost: false, provider: null, shadowedBy: null };
      if (!Array.isArray(entry.reasons)) entry.reasons = [];
      if (!entry.reasons.includes('host-scan-out-of-scope')) entry.reasons.push('host-scan-out-of-scope');
      continue;
    }
    markUnknown(entry);
  }
  return result;
}

function normalizeDirent(entry) {
  if (entry === null || typeof entry !== 'object') return null;
  const call = (name) => (typeof entry[name] === 'function' ? entry[name]() : entry[name] === true);
  return {
    name: safeText(entry.name),
    isDirectory: call('isDirectory'),
    isFile: call('isFile'),
    isSymbolicLink: call('isSymbolicLink'),
  };
}

async function statSafe(adapters, path) {
  if (typeof adapters?.stat !== 'function') return { available: false, value: null, error: 'no-adapter' };
  try {
    const value = await adapters.stat(path);
    return { available: true, value: value ?? null, error: null };
  } catch (error) {
    return { available: true, value: null, error: error?.code ?? 'error' };
  }
}

async function readDirSafe(adapters, dir) {
  if (typeof adapters?.readdir !== 'function') return { status: 'unavailable', entries: [], reason: 'sin-readdir' };
  try {
    const raw = await adapters.readdir(dir);
    const entries = (Array.isArray(raw) ? raw : []).map(normalizeDirent).filter(Boolean);
    return { status: 'complete', entries, reason: '' };
  } catch (error) {
    const code = error?.code;
    if (code === 'ENOENT') return { status: 'complete', entries: [], reason: '', missing: true };
    return { status: 'error', entries: [], reason: code ?? 'readdir-error' };
  }
}

async function readFileSafe(adapters, path) {
  if (typeof adapters?.readFile !== 'function') return { ok: false, reason: 'sin-readfile' };
  try {
    const bytes = await adapters.readFile(path);
    if (bytes === null || bytes === undefined) return { ok: false, reason: 'ENOENT' };
    return { ok: true, bytes: toBytes(bytes) };
  } catch (error) {
    return { ok: false, reason: error?.code ?? 'read-error' };
  }
}

async function isSymlinked(adapters, path, dirent) {
  if (dirent?.isSymbolicLink === true) return true;
  if (typeof adapters?.lstat === 'function') {
    try {
      const stats = await adapters.lstat(path);
      const link = typeof stats?.isSymbolicLink === 'function' ? stats.isSymbolicLink() : stats?.isSymbolicLink === true;
      if (link) return true;
    } catch {
      return false;
    }
  }
  if (typeof adapters?.realpath === 'function') {
    try {
      const real = await adapters.realpath(path);
      if (typeof real === 'string' && cwdKey(real) !== cwdKey(path)) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function manifestSkills(bytes) {
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(toBytes(bytes).toString('utf8'));
    if (!Array.isArray(parsed?.skills)) return null;
    const map = new Map();
    for (const skill of parsed.skills) {
      if (typeof skill?.id === 'string') map.set(skill.id, typeof skill.version === 'string' ? skill.version : null);
    }
    return { projectId: safeText(parsed.projectId), cwd: safeText(parsed.cwd), skills: map };
  } catch {
    return null;
  }
}

function withLimits(limits) {
  const merged = { ...DEFAULT_LIMITS, ...(isObject(limits) ? limits : {}) };
  return {
    maxEntries: Number.isFinite(merged.maxEntries) && merged.maxEntries > 0 ? merged.maxEntries : DEFAULT_LIMITS.maxEntries,
    maxBytes: Number.isFinite(merged.maxBytes) && merged.maxBytes > 0 ? merged.maxBytes : DEFAULT_LIMITS.maxBytes,
    maxRootEntries: Number.isFinite(merged.maxRootEntries) && merged.maxRootEntries > 0 ? merged.maxRootEntries : DEFAULT_LIMITS.maxRootEntries,
  };
}

async function findProjectRoot(adapters, cwd) {
  const start = normalizeCwd(cwd);
  if (start === '') return { projectRoot: '', considered: false };
  let current = start;
  for (let guard = 0; guard < 64; guard += 1) {
    const stats = await statSafe(adapters, join(current, '.git'));
    if (stats.available && stats.value !== null && stats.error === null) return { projectRoot: current, considered: true };
    const parent = normalizeCwd(dirname(current));
    if (parent === current || parent === '') break;
    current = parent;
  }
  return { projectRoot: start, considered: true };
}

function sourceStatus(map, id, status, reason = '', extra = {}) {
  map.set(id, { id, status, reason, ...extra });
}

function rootDescriptor(root, state) {
  return {
    id: root.rootId,
    status: state.status,
    reason: state.reason ?? '',
    present: state.present ?? null,
    found: state.found ?? 0,
    history: state.history ?? 0,
    rank: root.rank,
    source: root.source,
    kind: root.kind,
    dir: root.dir,
    hostScanned: root.hostScanned !== false,
    layout: root.layout ?? null,
  };
}

/**
 * Escanea una raíz con SU regla. Devuelve las entradas, el estado de observación y los contadores que
 * el contrato exige en `sources[]` (`present`, `found`, `history`).
 */
async function scanRoot({ adapters, root, context, limits, budget }) {
  const state = { status: 'complete', reason: '', present: null, found: 0, history: 0 };
  const found = [];
  const listing = await readDirSafe(adapters, root.dir);
  if (listing.status === 'unavailable') {
    state.status = 'incomplete';
    state.reason = listing.reason;
    return { entries: found, state };
  }
  if (listing.status === 'error') {
    state.status = 'error';
    state.reason = listing.reason;
    return { entries: found, state };
  }
  state.present = listing.missing ? false : true;
  if (listing.missing) return { entries: found, state };

  let names = listing.entries.slice().sort((a, b) => a.name.localeCompare(b.name));

  const pushFile = async (path, extra = {}) => {
    if (found.length >= limits.maxRootEntries) {
      state.history += 0;
      return false;
    }
    if (budget.entries >= limits.maxEntries) {
      budget.truncated = true;
      return false;
    }
    const stats = await statSafe(adapters, path);
    const size = Number.isFinite(stats.value?.size) ? stats.value.size : null;
    if (size !== null && budget.bytes + size > limits.maxBytes) {
      budget.truncated = true;
      return false;
    }
    const read = await readFileSafe(adapters, path);
    if (!read.ok) {
      if (read.reason !== 'ENOENT') state.reason = state.reason || read.reason;
      return false;
    }
    budget.bytes += read.bytes.length;
    budget.entries += 1;
    const entry = entryFromFile({ path, root, bytes: read.bytes, cwd: context.cwd, projectRoot: context.projectRoot });
    Object.assign(entry, extra);
    found.push(entry);
    return true;
  };

  if (root.layout && root.layout.depth === 3) {
    const buckets = root.layout.buckets ?? { live: [], history: [] };
    const skipDirs = root.layout.skipDirs ?? [];
    for (const projectDir of names) {
      if (!projectDir.isDirectory || projectDir.isSymbolicLink) continue;
      const projectPath = join(root.dir, projectDir.name);
      if (await isSymlinked(adapters, projectPath, projectDir)) {
        state.reason = state.reason || 'symlink';
        continue;
      }
      const projectList = await readDirSafe(adapters, projectPath);
      if (projectList.status !== 'complete') {
        state.status = state.status === 'complete' ? 'incomplete' : state.status;
        state.reason = state.reason || projectList.reason;
        continue;
      }
      for (const bucket of projectList.entries.slice().sort((a, b) => a.name.localeCompare(b.name))) {
        if (!bucket.isDirectory || bucket.isSymbolicLink) continue;
        const bucketPath = join(projectPath, bucket.name);
        if (skipDirs.includes(bucket.name) || ![...buckets.live, ...buckets.history].includes(bucket.name)) continue;
        const bucketList = await readDirSafe(adapters, bucketPath);
        if (bucketList.status !== 'complete') {
          state.status = state.status === 'complete' ? 'incomplete' : state.status;
          continue;
        }
        const skillDirs = bucketList.entries.filter((entry) => entry.isDirectory && !entry.isSymbolicLink);
        if (buckets.history.includes(bucket.name)) {
          state.history += skillDirs.length;
          continue;
        }
        for (const skillDir of skillDirs) {
          const skillPath = join(bucketPath, skillDir.name);
          if (await isSymlinked(adapters, skillPath, skillDir)) {
            state.reason = state.reason || 'symlink';
            continue;
          }
          await pushFile(join(skillPath, 'SKILL.md'), { projectFolder: projectDir.name, bucket: bucket.name });
        }
      }
    }
  } else if (root.layout && root.layout.depth === 2) {
    for (const projectDir of names) {
      if (!projectDir.isDirectory || projectDir.isSymbolicLink) continue;
      const projectPath = join(root.dir, projectDir.name);
      if (await isSymlinked(adapters, projectPath, projectDir)) {
        state.reason = state.reason || 'symlink';
        continue;
      }
      const projectList = await readDirSafe(adapters, projectPath);
      if (projectList.status !== 'complete') {
        state.status = state.status === 'complete' ? 'incomplete' : state.status;
        continue;
      }
      const manifestRead = await readFileSafe(adapters, join(projectPath, 'manifest.json'));
      const manifest = manifestRead.ok ? manifestSkills(manifestRead.bytes) : null;
      for (const skillDir of projectList.entries.filter((entry) => entry.isDirectory && !entry.isSymbolicLink).sort((a, b) => a.name.localeCompare(b.name))) {
        const skillPath = join(projectPath, skillDir.name);
        if (await isSymlinked(adapters, skillPath, skillDir)) {
          state.reason = state.reason || 'symlink';
          continue;
        }
        const version = manifest?.skills?.get(skillDir.name) ?? null;
        const added = await pushFile(join(skillPath, 'SKILL.md'), { projectId: projectDir.name });
        if (added && found.length > 0) {
          const last = found[found.length - 1];
          if (last.projectId === projectDir.name) {
            last.identity = { ...last.identity, version };
            last.confidence = manifest ? 'manifest' : 'content-hash';
            last.reasons = manifest ? [] : ['manifest-missing'];
            if (manifest?.skills?.has(skillDir.name)) last.name = skillDir.name;
          }
        }
      }
    }
  } else {
    for (const dirent of names) {
      if (!dirent.name || dirent.name === '.' || dirent.name === '..') continue;
      if (root.skipSystem && dirent.name === '.system') continue;
      const childPath = join(root.dir, dirent.name);
      if (dirent.isSymbolicLink) {
        state.reason = state.reason || 'symlink';
        continue;
      }
      if (dirent.isDirectory) {
        if (await isSymlinked(adapters, childPath, dirent)) {
          state.reason = state.reason || 'symlink';
          continue;
        }
        await pushFile(join(childPath, 'SKILL.md'));
      } else if (dirent.isFile) {
        if (!dirent.name.toLowerCase().endsWith('.md') || dirent.name.toLowerCase() === 'skill.md') continue;
        if (await isSymlinked(adapters, childPath, dirent)) {
          state.reason = state.reason || 'symlink';
          continue;
        }
        await pushFile(childPath);
      }
      if (budget.truncated) break;
    }
  }
  state.found = found.length;
  if (budget.truncated) state.reason = state.reason || 'limit';
  return { entries: found, state };
}

async function loadStateFrom(adapters, root) {
  if (typeof adapters?.loadState !== 'function') return { ok: false, reason: 'sin-loadState' };
  try {
    const loaded = await adapters.loadState(root);
    if (isObject(loaded) && isObject(loaded.state)) return { ok: true, state: loaded.state, integrity: safeText(loaded.integrity) || 'ok' };
    if (isObject(loaded)) return { ok: true, state: loaded, integrity: 'ok' };
    return { ok: false, reason: 'shape' };
  } catch (error) {
    return { ok: false, reason: error?.code ?? 'load-error' };
  }
}

/**
 * Inventario completo. Async porque el catálogo del Host (`snapshot`) y el disco son async.
 * Acepta `(adapters, context)` o `({ adapters, ...context })`. Nunca lanza.
 */
export async function collectInventory(adaptersOrContext = {}, maybeContext = {}) {
  const adapters = isObject(adaptersOrContext?.adapters) ? adaptersOrContext.adapters : adaptersOrContext;
  const context = isObject(adaptersOrContext?.adapters) ? adaptersOrContext : (isObject(maybeContext) ? maybeContext : {});
  const limits = withLimits(context.limits);
  const now = typeof context.now === 'string' && context.now !== '' ? context.now : new Date().toISOString();
  const sourceMap = new Map();
  for (const id of DECLARED_SOURCE_IDS) sourceMap.set(id, { id, status: 'unavailable', reason: 'no-consultada', label: SOURCE_LABELS[id] ?? id });
  const warnings = [];
  const budget = { entries: 0, bytes: 0, truncated: false };

  try {
    const cwd = normalizeCwd(context.cwd);
    let projectRoot = normalizeCwd(context.projectRoot);
    const dshHome = normalizeCwd(context.dshHome);
    const agentsHome = normalizeCwd(context.agentsHome);
    // Raíz materializada inyectable: context.materializedRoot > <context.root>/materialized >
    // <dshHome>/lifecode-skill-center/materialized (default real de state.materializedRoot).
    const explicitMaterializedRoot = normalizeCwd(context.materializedRoot);
    const centerRoot = normalizeCwd(context.root);
    const materializedRoot = explicitMaterializedRoot !== ''
      ? explicitMaterializedRoot
      : centerRoot !== ''
        ? normalizeCwd(join(centerRoot, 'materialized'))
        : dshHome !== '' ? normalizeCwd(join(dshHome, 'lifecode-skill-center', 'materialized')) : '';
    let projectAvailability = 'unknown';
    let projectExists = false;
    let projectIsDirectory = false;
    if (cwd !== '') {
      if (typeof adapters?.stat !== 'function') {
        sourceStatus(sourceMap, 'filesystem-project', 'error', 'sin-adaptador-de-sistema-de-ficheros');
      } else {
        const stats = await statSafe(adapters, cwd);
        if (stats.error !== null || stats.value === null) {
          sourceStatus(sourceMap, 'filesystem-project', 'complete', 'no-existe');
          projectAvailability = 'missing-dir';
        } else {
          projectAvailability = 'ok';
          projectExists = true;
          projectIsDirectory = stats.value?.isDirectory !== false;
          if (!projectIsDirectory) projectAvailability = 'missing-dir';
          sourceStatus(sourceMap, 'filesystem-project', 'complete', '');
        }
      }
      if (projectRoot === '') {
        const resolved = await findProjectRoot(adapters, cwd);
        projectRoot = resolved.projectRoot;
      }
    } else {
      sourceStatus(sourceMap, 'filesystem-project', 'unavailable', 'sin-cwd');
    }

    // Estado: legible (incluido MISSING) es `complete`; corrupto/ilegible es `error`.
    let state = isObject(context.state) ? context.state : null;
    let integrity = safeText(context.integrity) || 'ok';
    if (state === null) {
      const loaded = await loadStateFrom(adapters, context.root ?? dshHome);
      if (loaded.ok) {
        state = loaded.state;
        integrity = loaded.integrity;
        sourceStatus(sourceMap, 'state', 'complete', '');
      } else {
        sourceStatus(sourceMap, 'state', 'error', loaded.reason);
        warnings.push({ code: 'store-unreadable', severity: 'block', message: `El almacén del centro no se pudo leer (${loaded.reason}).` });
      }
    } else {
      sourceStatus(sourceMap, 'state', 'complete', '');
    }
    if (state !== null && integrity !== 'ok' && integrity !== 'missing') {
      sourceStatus(sourceMap, 'state', 'error', integrity);
      warnings.push({ code: 'store-unreadable', severity: 'block', message: `El almacén del centro está en estado «${integrity}».` });
    }

    // Manifiestos: aquí no se lee el directorio de manifiestos; el adaptador puede declarar el hecho.
    if (context.manifest !== undefined || context.manifests !== undefined) {
      sourceStatus(sourceMap, 'manifest', 'complete', '');
    } else {
      sourceStatus(sourceMap, 'manifest', 'unavailable', 'sin-lectura-de-manifiestos');
    }

    // Raíces del cargador + raíces declaradas (E1).
    const roots = skillRootsFor({ cwd, dshHome, agentsHome, customDirs: context.customDirs, bundledDir: context.bundledDir, projectRoot, materializedRoot });
    const entries = [];
    const rootRows = [];
    for (const root of roots) {
      if (budget.truncated) break;
      const scanned = await scanRoot({ adapters, root, context: { cwd, projectRoot }, limits, budget });
      entries.push(...scanned.entries);
      rootRows.push(rootDescriptor(root, scanned.state));
      if (scanned.state.status !== 'complete') {
        sourceStatus(sourceMap, 'filesystem-view', scanned.state.status === 'error' ? 'error' : 'incomplete', `${root.rootId}: ${scanned.state.reason}`);
      } else if (!sourceMap.get('filesystem-view')) {
        sourceStatus(sourceMap, 'filesystem-view', 'complete', '');
      }
    }
    if (!sourceMap.get('filesystem-view') || sourceMap.get('filesystem-view').status === 'unavailable') {
      const anyScan = roots.length > 0;
      sourceStatus(sourceMap, 'filesystem-view', anyScan ? 'complete' : 'unavailable', anyScan ? '' : 'sin-raíces');
    }
    if (budget.truncated) {
      warnings.push({ code: 'inventory-truncated', severity: 'warn', message: 'El inventario se cortó por límite de entradas o de bytes; no es la lista completa.' });
    }

    // Cargador de plugins: informativo; no aporta skills por sí mismo.
    if (typeof adapters?.getLoaderEntries === 'function') {
      try {
        const loaderEntries = await adapters.getLoaderEntries();
        sourceStatus(sourceMap, 'loader', 'complete', Array.isArray(loaderEntries) ? '' : 'sin-entradas');
      } catch (error) {
        sourceStatus(sourceMap, 'loader', 'error', error?.code ?? 'loader-error');
        warnings.push({ code: 'loader-error', severity: 'warn', message: 'El cargador de plugins no respondió.' });
      }
    } else {
      sourceStatus(sourceMap, 'loader', 'unavailable', 'sin-cargador');
    }

    // Catálogo del Host: es la verdad de lo que cargaría. Sin él no hay ganador que atribuir.
    let snapshot = null;
    if (isObject(context.snapshot) || Array.isArray(context.snapshot)) {
      snapshot = context.snapshot;
      sourceStatus(sourceMap, 'skills-registry', snapshot.complete === false ? 'incomplete' : 'complete', snapshot.complete === false ? 'snapshot-incompleto' : '');
    } else if (typeof adapters?.listSkills === 'function') {
      try {
        const raw = await adapters.listSkills({ cwd });
        snapshot = Array.isArray(raw) ? { skills: raw, complete: true } : raw;
        if (!isObject(snapshot) || !Array.isArray(snapshot.skills)) {
          sourceStatus(sourceMap, 'skills-registry', 'incomplete', 'shape');
        } else {
          sourceStatus(sourceMap, 'skills-registry', snapshot.complete === false ? 'incomplete' : 'complete', snapshot.complete === false ? 'snapshot-incompleto' : '');
        }
      } catch (error) {
        sourceStatus(sourceMap, 'skills-registry', 'unavailable', error?.code ?? 'snapshot-error');
        warnings.push({ code: 'skills-registry-unavailable', severity: 'warn', message: 'El catálogo de skills del Host no respondió.' });
      }
    } else {
      sourceStatus(sourceMap, 'skills-registry', 'unavailable', 'sin-servicio');
    }

    let merged = mergeHostWinners({ entries, snapshot, roots });
    const snapshotSkills = Array.isArray(snapshot?.skills) ? snapshot.skills : Array.isArray(snapshot) ? snapshot : [];
    const builtinCount = snapshotSkills.filter((candidate) => safeText(candidate?.source).toLowerCase() === 'bundled').length;
    if (sourceMap.has('builtin-asar')) {
      sourceMap.set('builtin-asar', {
        id: 'builtin-asar',
        status: 'unavailable',
        reason: 'opaque-container',
        found: builtinCount > 0 ? builtinCount : null,
        label: SOURCE_LABELS['builtin-asar'],
      });
    }

    // Catálogo propio (v3): filas por asignación, enriquecidas si el fichero materializado casa.
    if (state !== null) {
      merged = addCatalogRows({ entries: merged, state, dshHome, root: context.root ?? dshHome, projectRoot, materializedRoot });
    }

    // Fuentes opcionales que sólo el adaptador puede declarar.
    if (isObject(context.workspaceRegistry)) {
      const status = safeText(context.workspaceRegistry.status) || 'complete';
      sourceStatus(sourceMap, 'workspace-registry', status, safeText(context.workspaceRegistry.reason));
    } else if (typeof adapters?.listWorkspaces === 'function') {
      try {
        await adapters.listWorkspaces();
        sourceStatus(sourceMap, 'workspace-registry', 'complete', '');
      } catch (error) {
        sourceStatus(sourceMap, 'workspace-registry', 'unavailable', error?.code ?? 'workspace-error');
      }
    } else {
      sourceStatus(sourceMap, 'workspace-registry', 'unavailable', 'sin-servicio');
    }
    sourceStatus(sourceMap, 'sessions', 'unavailable', 'sin-servicio');

    const sources = [
      ...SOURCE_IDS.map((id) => sourceMap.get(id)),
      ...DECLARED_SOURCE_IDS.filter((id) => !SOURCE_IDS.includes(id)).map((id) => sourceMap.get(id)),
      ...rootRows,
    ];
    // Fail-closed: una fuente crítica incompleta (no sólo con error) invalida la evidencia. Las
    // declaradas y opcionales (workspace-registry, manifest, sessions, loader, ...) no bloquean aquí:
    // el preflight ya las exige según la acción concreta.
    const COMPLETENESS_CRITICAL = ['state', 'filesystem-project', 'filesystem-view', 'skills-registry'];
    const complete = !budget.truncated && !sources.some((source) => source.status === 'error'
      || (COMPLETENESS_CRITICAL.includes(source.id) && source.status !== 'complete'));
    return {
      entries: merged,
      sources,
      complete,
      generatedAt: now,
      warnings,
      truncated: budget.truncated,
      roots: rootRows,
      project: {
        cwd,
        projectRoot,
        availability: projectAvailability,
        exists: projectExists,
        isDirectory: projectIsDirectory,
      },
    };
  } catch (error) {
    // Red de seguridad: el inventario jamás tumba la sesión.
    for (const id of DECLARED_SOURCE_IDS) {
      const current = sourceMap.get(id);
      if (!current || current.status === 'unavailable') sourceStatus(sourceMap, id, 'error', error?.code ?? 'internal');
    }
    return {
      entries: [],
      sources: DECLARED_SOURCE_IDS.map((id) => sourceMap.get(id)),
      complete: false,
      generatedAt: now,
      warnings: [{ code: 'inventory-error', severity: 'block', message: 'El inventario falló de forma inesperada; no hay evidencia completa.' }],
      truncated: false,
      roots: [],
      project: { cwd: normalizeCwd(context.cwd), projectRoot: normalizeCwd(context.projectRoot), availability: 'unknown', exists: false, isDirectory: false },
    };
  }
}

/**
 * Filas del catálogo propio (`state.skills` × `state.assignments`). Si la vista materializada ya está
 * escaneada, se enriquece esa fila en vez de duplicarla: una skill no aparece dos veces por estar
 * asignada y materializada.
 */
function addCatalogRows({ entries = [], state, dshHome = '', root = '', projectRoot = '', materializedRoot = '' }) {
  const assignments = isObject(state?.assignments) ? state.assignments : {};
  const skills = isObject(state?.skills) ? state.skills : {};
  const projects = isObject(state?.projects) ? state.projects : {};
  const result = entries.slice();
  const materializedBase = normalizeCwd(materializedRoot)
    || normalizeCwd(join(root || dshHome || '', 'lifecode-skill-center', 'materialized'));
  const projectRootValue = normalizeCwd(projectRoot);
  for (const [projectId, row] of Object.entries(assignments)) {
    if (!isObject(row)) continue;
    const project = isObject(projects[projectId]) ? projects[projectId] : null;
    const projectCwd = normalizeCwd(project?.cwd ?? '');
    for (const [skillId, assignment] of Object.entries(row)) {
      const skill = isObject(skills[skillId]) ? skills[skillId] : null;
      if (!skill || !isObject(assignment)) continue;
      const versionId = safeText(assignment.version) || safeText(skill.currentVersion);
      const version = Array.isArray(skill.versions) ? skill.versions.find((candidate) => candidate?.version === versionId) ?? null : null;
      let expectedSha = null;
      if (version) {
        try {
          expectedSha = sha256Bytes(Buffer.from(renderSkillFile({ skill, version }), 'utf8'));
        } catch {
          expectedSha = null;
        }
      }
      const diskPath = materializedBase === '' ? '' : normalizeCwd(join(materializedBase, projectId, skillId, 'SKILL.md'));
      const index = diskPath === '' ? -1 : result.findIndex((entry) => pathKey(entry?.location?.path) === pathKey(diskPath));
      const identity = {
        uuid: typeof skill.uuid === 'string' && skill.uuid !== '' ? skill.uuid : null,
        version: versionId === '' ? null : versionId,
        contentSha256: index >= 0 ? result[index].identity?.contentSha256 ?? null : expectedSha,
        manifestSha256: typeof project?.manifestSha256 === 'string' ? project.manifestSha256 : null,
      };
      if (index >= 0) {
        const entry = result[index];
        const hashMatches = expectedSha !== null && entry.identity?.contentSha256 === expectedSha;
        const loadedByHost = entry.association?.loadedByHost === true && entry.association?.provider === 'lifecode-skill-center';
        const reasons = formatReasons(entry.reasons, hashMatches || expectedSha === null ? [] : ['materialized-hash-mismatch']);
        result[index] = {
          ...entry,
          name: skillId,
          canonicalName: canonicalSkillName(skillId),
          description: safeText(skill.description),
          whenToUse: safeText(skill.whenToUse),
          owner: { ...entry.owner, kind: 'lifecode', provider: 'lifecode-skill-center' },
          origin: { kind: 'materialized', label: 'lifecode-skill-center' },
          scope: {
            kind: 'project',
            projectRoot: projectCwd !== '' ? projectCwd : projectRootValue || null,
            cwd: projectCwd !== '' ? projectCwd : null,
          },
          identity,
          projectId,
          confidence: loadedByHost && hashMatches ? 'verified' : 'local-registry',
          reasons,
        };
        continue;
      }
      result.push({
        key: `lifecode:${projectId}:${skillId}`,
        name: skillId,
        canonicalName: canonicalSkillName(skillId),
        description: safeText(skill.description),
        whenToUse: safeText(skill.whenToUse),
        owner: { kind: 'lifecode', provider: 'lifecode-skill-center', pluginEntryId: null },
        origin: { kind: 'registry', label: 'catálogo v3' },
        location: { kind: 'virtual', path: null, directory: null, rootId: 'state' },
        scope: {
          kind: 'project',
          projectRoot: projectCwd !== '' ? projectCwd : projectRootValue || null,
          cwd: projectCwd !== '' ? projectCwd : null,
        },
        association: { ...EMPTY_ASSOCIATION, loadedByHost: null },
        execution: { modelInvocable: true, userInvocable: true },
        identity,
        projectId,
        confidence: 'local-registry',
        reasons: ['association-scope-global'],
      });
    }
  }
  return result;
}

function formatReasons(existing, extra) {
  const merged = Array.isArray(existing) ? existing.slice() : [];
  for (const reason of extra) if (!merged.includes(reason)) merged.push(reason);
  return merged;
}
