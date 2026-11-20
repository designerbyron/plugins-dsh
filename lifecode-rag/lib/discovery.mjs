/**
 * Descubrimiento de proyectos (auto-discovery 01).
 *
 * Reglas de diseño, en corto:
 *   - Sólo se escanea dentro de un *workspace confiable*; fuera de él no hay descubrimiento.
 *   - Descubrir no es registrar, ni autorizar, ni indexar: este módulo nunca abre almacenes de
 *     ámbito y sólo lee `package.json` (≤256 KiB) para clasificar; del resto de indicadores
 *     comprueba la existencia.
 *   - El registro es idempotente por `pathKey`: un proyecto ya registrado conserva su `id`, su
 *     almacén y sus fuentes; sólo se actualizan los metadatos de descubrimiento.
 *   - No se atraviesan enlaces/junctions: un enlace dentro del workspace no puede ampliar el
 *     ámbito a una ruta externa.
 */

import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { RagError } from './errors.mjs';
import { addRoot, appendRegistryAudit, createProject, getMeta, getProject, listRoots, setMeta } from './registry.mjs';
import { assertRootStructure, inspectRoot, normalizeKey } from './roots-structure.mjs';

export const DISCOVERY_MAX_DEPTH = 4;
export const DISCOVERY_MAX_PROJECTS = 200;
const PACKAGE_LIMIT_BYTES = 256 * 1024;

/** Directorios que nunca se recorren, ni se consideran proyectos, ni se indexan. */
export const IGNORED_DIRECTORIES = Object.freeze([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'bin', 'obj',
  '.next', '.nuxt', '.output', '.svelte-kit', '__pycache__', '.venv', 'venv', 'env', '.env',
  'cache', '.cache', '.turbo', '.parcel-cache', 'coverage', '.nyc_output', 'tmp', 'temp', '.tmp',
  '.idea', '.vscode', 'secrets', '.secrets', '.ssh', '.gnupg', 'test-results', 'playwright-report',
  '.pytest_cache', '.mypy_cache', '.gradle', '.terraform', '_audit', 'archivo', 'archive',
]);

/** Ficheros que nunca se leen ni se indexan, aunque aparezcan en un proyecto. */
export const SECRET_FILES = Object.freeze([
  '.env', '.env.local', '.env.production', 'id_rsa', 'id_dsa', 'id_ed25519', '.npmrc', '.pypirc',
  '.netrc', 'credentials.json', 'service-account.json', '.htpasswd',
]);

const IGNORED = new Set(IGNORED_DIRECTORIES.map((name) => name.toLowerCase()));

/**
 * Indicadores ordenados de más específico a más genérico. Se comprueba su existencia; sólo
 * `package.json` se lee (para tipo y nombre) y sólo si es pequeño.
 */
const INDICATORS = Object.freeze([
  { file: 'artisan', type: 'laravel', strong: true },
  { glob: 'nuxt.config.ts', type: 'nuxt', strong: true },
  { glob: 'nuxt.config.js', type: 'nuxt', strong: true },
  { glob: 'vue.config.js', type: 'vue', strong: true },
  { glob: 'angular.json', type: 'angular', strong: true },
  { glob: 'vite.config.ts', type: 'vite', strong: false },
  { glob: 'vite.config.js', type: 'vite', strong: false },
  { file: 'composer.json', type: 'php', strong: true },
  { file: 'package.json', type: 'node', strong: true },
  { glob: '*.sln', type: 'dotnet', strong: true },
  { glob: '*.csproj', type: 'dotnet', strong: true },
  { file: 'pyproject.toml', type: 'python', strong: true },
  { file: 'requirements.txt', type: 'python', strong: true },
  { file: 'setup.py', type: 'python', strong: false },
  { file: 'go.mod', type: 'go', strong: true },
  { file: 'Cargo.toml', type: 'rust', strong: true },
  { file: 'pom.xml', type: 'java', strong: true },
  { file: 'build.gradle', type: 'java', strong: false },
  { file: 'Gemfile', type: 'ruby', strong: true },
  { file: '.git', type: 'git', strong: false },
  { file: 'index.html', type: 'web', strong: false },
]);

function isSecretFile(name) {
  const lower = name.toLowerCase();
  if (SECRET_FILES.includes(lower)) return true;
  return lower.startsWith('.env.') || lower.endsWith('.pem') || lower.endsWith('.key');
}

function safeEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function packageInfo(dir) {
  try {
    const file = join(dir, 'package.json');
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > PACKAGE_LIMIT_BYTES) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function classifyPackage(pkg, fallbackType) {
  if (!pkg) return fallbackType;
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  const has = (name) => Object.prototype.hasOwnProperty.call(all, name);
  if (has('nuxt') || has('nuxt3')) return 'nuxt';
  if (has('next')) return 'next';
  if (has('vue')) return 'vue';
  if (has('react')) return 'react';
  if (has('@angular/core')) return 'angular';
  if (has('svelte')) return 'svelte';
  return 'node';
}

function detectMarkers(dir) {
  const entries = safeEntries(dir);
  const names = new Set(entries.map((entry) => entry.name));
  const lowerNames = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry.name]));
  const indicators = [];
  let type = null;
  for (const indicator of INDICATORS) {
    if (indicator.file) {
      if (!names.has(indicator.file)) continue;
      indicators.push(indicator.file);
      if (!type) type = indicator.type;
      if (indicator.type === 'node') {
        type = classifyPackage(packageInfo(dir), 'node');
      }
      continue;
    }
    const suffix = indicator.glob.slice(1).toLowerCase();
    const match = entries.find((entry) => entry.name.toLowerCase().endsWith(suffix));
    if (!match) continue;
    indicators.push(lowerNames.get(match.name.toLowerCase()) ?? match.name);
    if (!type) type = indicator.type;
  }
  if (!type) return null;
  // El nombre visible es el del directorio: el nombre del manifiesto puede ser un scope npm
  // (`@local/x`) y confunde al identificar el proyecto en el panel.
  const name = basename(dir);
  const pkg = (type === 'node' || ['vue', 'nuxt', 'react', 'next', 'angular', 'svelte', 'vite'].includes(type))
    ? packageInfo(dir)
    : null;
  const manifestName = pkg && typeof pkg.name === 'string' && pkg.name.trim() !== '' ? pkg.name.trim() : null;
  return { name, manifestName, type, indicators: [...new Set(indicators)] };
}

/** Identidad estable de proyecto derivada de la ruta canónica (no aleatoria: idempotente). */
export function projectIdFor(pathKey) {
  // 26 caracteres del alfabeto del registro, derivados del hash de la clave canónica. La misma
  // ruta produce siempre el mismo id; una ruta distinta, uno distinto.
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let hash = 0xcbf29ce484222325n;
  const mask = 0xffffffffffffffffn;
  for (const char of pathKey) {
    hash ^= BigInt(char.codePointAt(0));
    hash = (hash * 0x100000001b3n) & mask;
  }
  let out = '';
  let value = hash;
  for (let index = 0; index < 26; index += 1) {
    out += alphabet[Number(value % 32n)];
    value /= 32n;
    if (value === 0n) value = hash ^ BigInt(index + 1);
  }
  return `prj_${out}`;
}

export function projectMetaKey(projectId) {
  return `project_discovery:${projectId}`;
}

export function readProjectMeta(db, projectId) {
  const raw = getMeta(db, projectMetaKey(projectId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeProjectMeta(db, projectId, meta) {
  setMeta(db, projectMetaKey(projectId), JSON.stringify(meta));
}

function projectByRootKey(db, pathKey) {
  const row = db.prepare(`SELECT scope_id, path, path_key FROM roots
    WHERE scope_kind='prj' AND path_key = ? LIMIT 1`).get(pathKey);
  if (!row) return null;
  return getProject(db, row.scope_id);
}

function insideAnyRoot(db, pathKey) {
  return listRoots(db).some((root) => root.path_key === pathKey || pathKey.startsWith(`${root.path_key}/`));
}

function auditDiscovery(db, { at, action, target, outcome = 'ok', detail }) {
  try {
    appendRegistryAudit(db, {
      at,
      actor: 'host',
      sessionId: null,
      action,
      target,
      outcome,
      detail: JSON.stringify(detail ?? {}),
    });
  } catch {
    // la auditoría no invalida un descubrimiento ya decidido
  }
}

/**
 * Registra un proyecto descubierto. Idempotente por raíz: si la ruta ya está registrada, no se
 * crea nada y sólo se actualizan los metadatos de descubrimiento.
 *
 * `authorization`:
 *   - `'read'`      → la raíz queda `authorized` (requiere `trust.readAuthorization`).
 *   - `'discovered'`→ el proyecto se registra sin raíz: visible, no resoluble ni indexable.
 */
export function registerDiscoveredProject(db, {
  path, name, type, indicators = [], source = 'scan', authorization = 'read', now = Date.now(),
} = {}) {
  if (authorization !== 'read' && authorization !== 'discovered') {
    throw new RagError('invalid-argument', 'authorization debe ser read o discovered');
  }
  const info = assertRootStructure(inspectRoot(path));
  const existingProject = projectByRootKey(db, info.key);
  if (existingProject) {
    const previous = readProjectMeta(db, existingProject.id) ?? {};
    const meta = {
      ...previous,
      path: info.canonical,
      pathKey: info.key,
      type: previous.type ?? type ?? 'unknown',
      indicators: [...new Set([...(previous.indicators ?? []), ...indicators])],
      firstDiscoveredAt: previous.firstDiscoveredAt ?? now,
      lastSeenAt: now,
      source,
    };
    writeProjectMeta(db, existingProject.id, meta);
    return { created: false, projectId: existingProject.id, name: existingProject.name, path: info.canonical };
  }

  if (authorization === 'discovered') {
    const project = createProject(db, { name: name || basename(info.canonical), now });
    writeProjectMeta(db, project.id, {
      path: info.canonical, pathKey: info.key, type: type ?? 'unknown', indicators,
      firstDiscoveredAt: now, lastSeenAt: now, source, registeredRoot: false,
    });
    auditDiscovery(db, {
      at: now, action: 'project.discover', target: project.id,
      detail: { path: info.canonical, type: type ?? 'unknown', registeredRoot: false },
    });
    return { created: true, projectId: project.id, name: project.name, path: info.canonical, registeredRoot: false };
  }

  const project = createProject(db, { name: name || basename(info.canonical), now });
  try {
    addRoot(db, {
      scopeKind: 'prj', scopeId: project.id, path: info.canonical, addedBy: 'host', now, allowNested: true,
    });
  } catch (error) {
    // La identidad ya creada sin raíz no se descarta: se documenta como descubierta, no legible.
    writeProjectMeta(db, project.id, {
      path: info.canonical, pathKey: info.key, type: type ?? 'unknown', indicators,
      firstDiscoveredAt: now, lastSeenAt: now, source, registeredRoot: false,
      registrationError: error?.code ?? 'root-registration-failed',
    });
    auditDiscovery(db, {
      at: now, action: 'project.discover', target: project.id, outcome: 'failed',
      detail: { path: info.canonical, code: error?.code ?? 'root-registration-failed' },
    });
    return {
      created: true, projectId: project.id, name: project.name, path: info.canonical,
      registeredRoot: false, error: error?.code ?? 'root-registration-failed',
    };
  }
  writeProjectMeta(db, project.id, {
    path: info.canonical, pathKey: info.key, type: type ?? 'unknown', indicators,
    firstDiscoveredAt: now, lastSeenAt: now, source, registeredRoot: true,
  });
  auditDiscovery(db, {
    at: now, action: 'project.discover', target: project.id,
    detail: { path: info.canonical, type: type ?? 'unknown', registeredRoot: true },
  });
  return { created: true, projectId: project.id, name: project.name, path: info.canonical, registeredRoot: true };
}

/**
 * Escanea un workspace confiable y devuelve lo detectado, sin escribir. El llamador decide si
 * registra (`registerDiscoveredProject`).
 */
export function scanWorkspace(path, { maxDepth = DISCOVERY_MAX_DEPTH, maxProjects = DISCOVERY_MAX_PROJECTS } = {}) {
  const info = assertRootStructure(inspectRoot(path));
  const rootKey = info.key;
  const found = [];
  const skipped = [];
  const queue = [{ dir: info.canonical, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && found.length < maxProjects && visited < maxProjects * 40) {
    const { dir, depth } = queue.shift();
    visited += 1;
    const project = detectMarkers(dir);
    if (project) {
      const candidate = inspectRoot(dir);
      if (candidate.key !== rootKey && !candidate.key.startsWith(`${rootKey}/`)) {
        skipped.push({ path: dir, reason: 'outside-trusted-root' });
      } else {
        found.push({
          path: candidate.canonical,
          pathKey: candidate.key,
          name: project.name,
          manifestName: project.manifestName ?? null,
          type: project.type,
          indicators: project.indicators,
          depth,
        });
      }
    }
    if (depth >= maxDepth) continue;
    for (const entry of safeEntries(dir)) {
      if (entry.isSymbolicLink()) {
        skipped.push({ path: join(dir, entry.name), reason: 'symlink' });
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (IGNORED.has(entry.name.toLowerCase())) continue;
      queue.push({ dir: join(dir, entry.name), depth: depth + 1 });
    }
  }
  return { root: info.canonical, rootKey, projects: found, skipped, truncated: found.length >= maxProjects, visited };
}

/**
 * Encuentra el proyecto que contiene un directorio subiendo desde él hasta el workspace
 * confiable. Devuelve el límite **más específico** (el primero con indicadores), nunca el
 * workspace por defecto si el directorio no pertenece a ningún proyecto identificable.
 */
export function findProjectBoundary(startPath, { withinPath } = {}) {
  if (typeof startPath !== 'string' || !isAbsolute(startPath)) return null;
  let current = resolve(startPath);
  const limitKey = withinPath ? normalizeKey(assertRootStructure(inspectRoot(withinPath)).canonical) : null;
  // Un cwd puede no existir todavía (p. ej. el host informa de un directorio aún no creado):
  // se sube al ancestro existente más cercano sin salir del workspace confiable.
  for (let steps = 0; steps < 64; steps += 1) {
    try {
      lstatSync(current);
      break;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
  for (let steps = 0; steps < 64; steps += 1) {
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      return null;
    }
    if (stat.isSymbolicLink()) return null;
    if (!stat.isDirectory()) {
      current = dirname(current);
      continue;
    }
    const key = normalizeKey(current);
    if (limitKey && key !== limitKey && !key.startsWith(`${limitKey}/`)) return null;
    const project = detectMarkers(current);
    if (project) {
      const info = assertRootStructure(inspectRoot(current));
      return { path: info.canonical, pathKey: info.key, name: project.name, type: project.type, indicators: project.indicators };
    }
    if (limitKey && key === limitKey) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

export function describeProject(db, projectId) {
  const project = getProject(db, projectId);
  if (!project) return null;
  const meta = readProjectMeta(db, projectId) ?? {};
  const roots = db.prepare(`SELECT path, state FROM roots WHERE scope_kind='prj' AND scope_id=? ORDER BY path`).all(projectId);
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    type: meta.type ?? 'unknown',
    indicators: meta.indicators ?? [],
    discoveredAt: meta.firstDiscoveredAt ?? null,
    lastSeenAt: meta.lastSeenAt ?? null,
    registeredRoot: meta.registeredRoot !== false,
    roots: roots.map((row) => ({ path: row.path, state: row.state })),
  };
}

export function isIgnoredDirectory(name) {
  return IGNORED.has(String(name).toLowerCase());
}

export function isSecretFileName(name) {
  return isSecretFile(String(name));
}
