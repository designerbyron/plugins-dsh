/**
 * Rutas y configuración de LifeCode RAG.
 *
 * El almacén es **propio y separado**: por defecto `$DSH_HOME/lifecode-rag`, o lo que diga
 * `LIFECODE_RAG_ROOT`. Nunca se deriva del directorio de trabajo ni del almacén del Skill Center.
 * La configuración es un fichero opcional; si falta, se usan los valores por defecto **sin escribir**.
 */

import { existsSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { RagError } from './errors.mjs';

/** Configuración por defecto. Cambiarla exige revisar los límites de las pruebas de aceptación. */
export const DEFAULT_CONFIG = Object.freeze({
  maxFileBytes: 2_000_000,
  maxFilesPerIngest: 200,
  chunk: Object.freeze({ targetChars: 1_200, maxChars: 2_000, overlapChars: 120 }),
  context: Object.freeze({ budgetTokens: 2_000, maxChunks: 12, mmrLambda: 0.7 }),
  search: Object.freeze({
    limit: 8,
    maxLimit: 50,
    maxVectorScan: 20_000,
    strategy: 'hybrid',
    rrfK: 60,
    // Con el proveedor léxico (local-hash-v1) la lista "semántica" aporta ruido;
    // a 10.000 chunks, 1:1 baja Recall@5 a 0,692 mientras 3:1 la mantiene en 1,000.
    // Con un proveedor neural aprobado, el operador debe medir y ajustar (1:1 como punto de partida).
    weights: Object.freeze({ lexical: 3, semantic: 1 }),
    minScore: 0,
    maxPerSource: 0,
    diversity: 'fragment',
  }),
  embedding: Object.freeze({ provider: 'local-hash-v1', dim: 256, remote: null }),
  audit: Object.freeze({ exportJsonl: true }),
  roots: Object.freeze({ extra: Object.freeze([]) }),
  metrics: Object.freeze({ enabled: true, retentionDays: 90 }),
  automation: Object.freeze({
    enabled: false,
    intervalMs: 60_000,
    watchRoots: Object.freeze([]),
    maxFilesPerRun: 50,
    // Presupuesto de tiempo por tick (M6.7). El tick corre dentro del proceso del host: si una pasada
    // se alarga, compite con las herramientas del usuario y retrasa la respuesta. Se corta de forma
    // cooperativa entre fichero y fichero (lo ya confirmado no se revierte) y el resto queda para el
    // tick siguiente. 2 000 ms es el valor por defecto acordado en M6.7 §4.
    tickBudgetMs: 2_000,
    collections: Object.freeze({}),
  }),
  // PA6: contexto recuperado antes de cada respuesta. Desactivado por defecto: activarlo cambia lo que
  // el modelo ve en cada petición y consume tokens, así que es una decisión explícita del operador.
  autoContext: Object.freeze({
    enabled: false,
    maxChars: 1_600,
    maxChunks: 4,
    budgetTokens: 600,
    // Presupuesto del hook: el `agent/pre-step` corre en el camino crítico del turno, así que la
    // recuperación se abandona al vencer en vez de retrasar la respuesta (D-PA6-08).
    timeoutMs: 2_000,
  }),
});

const CONFIG_KEYS = new Set([
  'maxFileBytes', 'maxFilesPerIngest', 'chunk', 'context', 'search', 'embedding', 'audit', 'roots', 'metrics', 'automation',
  'autoContext',
]);

/** Una clave desconocida en cualquier nivel es un error: una errata no puede pasar muda. */
function onlyKeys(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) failConfig(`clave desconocida en ${label}: ${key}`, { key, label });
  }
}

/** ¿Es una ruta absoluta? Se exige para la raíz: una relativa dependería del cwd de cada sesión. */
export function absoluteRoot(value, label = 'LIFECODE_RAG_ROOT') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RagError('invalid-config', `${label} está vacío`);
  }
  if (!isAbsolute(value)) {
    throw new RagError('invalid-config', `${label} debe ser una ruta absoluta`, { details: { value } });
  }
  return resolve(value);
}

/**
 * Raíz del almacén. `LIFECODE_RAG_ROOT` manda; si no, `$DSH_HOME/lifecode-rag` y, en su defecto,
 * `~/.dsh/lifecode-rag`. El Harness expone `DSH_PROFILE_DIR`, pero no se usa: el perfil puede cambiar
 * de nombre y el almacén no debe depender de ello.
 */
export function ragRoot(env = process.env) {
  const explicit = env.LIFECODE_RAG_ROOT;
  if (typeof explicit === 'string') {
    // Presente pero vacía no significa «usa el defecto»: significa que algo se configuró mal. Caer al
    // almacén por defecto indexaría en otro sitio sin decirlo.
    if (explicit.trim() === '') throw new RagError('invalid-config', 'LIFECODE_RAG_ROOT está vacío');
    return absoluteRoot(explicit);
  }
  const home = typeof env.DSH_HOME === 'string'
    ? absoluteRoot(env.DSH_HOME, 'DSH_HOME')
    : join(homedir(), '.dsh');
  return join(home, 'lifecode-rag');
}

/** Rutas derivadas de la raíz. No crean nada. */
export function storePaths(root) {
  const base = absoluteRoot(root, 'root');
  return Object.freeze({
    root: base,
    database: join(base, 'rag.sqlite3'),
    audit: join(base, 'audit.jsonl'),
    backups: join(base, 'backups'),
    config: join(base, 'config.json'),
  });
}

/**
 * ¿`child` está dentro de `parent` (o es `parent`)? Comparación por ruta resuelta y, en Windows, sin
 * distinguir mayúsculas: el mismo directorio no puede considerarse «fuera» por una mayúscula.
 */
export function isWithin(parent, child, platform = process.platform) {
  const base = resolve(parent);
  const target = resolve(child);
  const fold = (value) => (platform === 'win32' ? value.toLowerCase() : value);
  const left = fold(base);
  const right = fold(target);
  if (left === right) return true;
  const rel = relative(left, right);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function failConfig(message, details = {}) {
  throw new RagError('invalid-config', message, { details });
}

function checkInteger(value, key, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    failConfig(`${key} debe ser un entero entre ${min} y ${max}`, { key, value });
  }
  return value;
}

/** Valida una configuración ya parseada. Rechaza claves desconocidas: una errata no puede pasar muda. */
export function validateConfig(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    failConfig('config.json debe ser un objeto');
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key)) failConfig(`clave de configuración desconocida: ${key}`, { key });
  }
  onlyKeys(raw.chunk ?? {}, ['targetChars', 'maxChars', 'overlapChars'], 'chunk');
  onlyKeys(raw.context ?? {}, ['budgetTokens', 'maxChunks', 'mmrLambda'], 'context');
  onlyKeys(raw.search ?? {}, ['limit', 'maxLimit', 'maxVectorScan', 'strategy', 'rrfK', 'weights', 'minScore', 'maxPerSource', 'diversity'], 'search');
  onlyKeys(raw.embedding ?? {}, ['provider', 'dim', 'remote'], 'embedding');
  onlyKeys(raw.audit ?? {}, ['exportJsonl'], 'audit');
  onlyKeys(raw.roots ?? {}, ['extra'], 'roots');
  onlyKeys(raw.metrics ?? {}, ['enabled', 'retentionDays'], 'metrics');
  onlyKeys(raw.automation ?? {}, ['enabled', 'intervalMs', 'watchRoots', 'maxFilesPerRun', 'tickBudgetMs', 'collections'], 'automation');
  onlyKeys(raw.autoContext ?? {}, ['enabled', 'maxChars', 'maxChunks', 'budgetTokens', 'timeoutMs'], 'autoContext');

  const merged = {
    maxFileBytes: raw.maxFileBytes ?? DEFAULT_CONFIG.maxFileBytes,
    maxFilesPerIngest: raw.maxFilesPerIngest ?? DEFAULT_CONFIG.maxFilesPerIngest,
    chunk: { ...DEFAULT_CONFIG.chunk, ...(raw.chunk ?? {}) },
    context: { ...DEFAULT_CONFIG.context, ...(raw.context ?? {}) },
    search: {
      ...DEFAULT_CONFIG.search,
      ...(raw.search ?? {}),
      weights: { ...DEFAULT_CONFIG.search.weights, ...(raw.search?.weights ?? {}) },
    },
    embedding: { ...DEFAULT_CONFIG.embedding, ...(raw.embedding ?? {}) },
    audit: { ...DEFAULT_CONFIG.audit, ...(raw.audit ?? {}) },
    roots: { ...DEFAULT_CONFIG.roots, ...(raw.roots ?? {}) },
    metrics: { ...DEFAULT_CONFIG.metrics, ...(raw.metrics ?? {}) },
    automation: {
      ...DEFAULT_CONFIG.automation,
      ...(raw.automation ?? {}),
      collections: { ...DEFAULT_CONFIG.automation.collections, ...(raw.automation?.collections ?? {}) },
    },
    autoContext: { ...DEFAULT_CONFIG.autoContext, ...(raw.autoContext ?? {}) },
  };
  checkInteger(merged.maxFileBytes, 'maxFileBytes', 1_024, 64 * 1024 * 1024);
  checkInteger(merged.maxFilesPerIngest, 'maxFilesPerIngest', 1, 10_000);
  checkInteger(merged.chunk.targetChars, 'chunk.targetChars', 128, 8_000);
  checkInteger(merged.chunk.maxChars, 'chunk.maxChars', merged.chunk.targetChars, 16_000);
  checkInteger(merged.chunk.overlapChars, 'chunk.overlapChars', 0, merged.chunk.targetChars);
  checkInteger(merged.context.budgetTokens, 'context.budgetTokens', 128, 200_000);
  checkInteger(merged.context.maxChunks, 'context.maxChunks', 1, 100);
  if (typeof merged.context.mmrLambda !== 'number' || merged.context.mmrLambda < 0 || merged.context.mmrLambda > 1) {
    failConfig('context.mmrLambda debe estar entre 0 y 1', { value: merged.context.mmrLambda });
  }
  checkInteger(merged.search.limit, 'search.limit', 1, 100);
  checkInteger(merged.search.maxLimit, 'search.maxLimit', merged.search.limit, 200);
  checkInteger(merged.search.maxVectorScan, 'search.maxVectorScan', 100, 1_000_000);
  if (!['hybrid', 'fts', 'vector'].includes(merged.search.strategy)) {
    failConfig('search.strategy debe ser hybrid, fts o vector', { value: merged.search.strategy });
  }
  checkInteger(merged.search.rrfK, 'search.rrfK', 1, 1_000);
  for (const side of ['lexical', 'semantic']) {
    const weight = merged.search.weights[side];
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 10) {
      failConfig(`search.weights.${side} debe estar entre 0 y 10`, { value: weight });
    }
  }
  if (merged.search.weights.lexical + merged.search.weights.semantic <= 0) {
    failConfig('search.weights debe tener algún peso mayor que cero');
  }
  if (typeof merged.search.minScore !== 'number' || merged.search.minScore < 0 || merged.search.minScore > 1) {
    failConfig('search.minScore debe estar entre 0 y 1', { value: merged.search.minScore });
  }
  checkInteger(merged.search.maxPerSource, 'search.maxPerSource', 0, 100);
  if (!['fragment', 'source'].includes(merged.search.diversity)) {
    failConfig('search.diversity debe ser "fragment" o "source"', { value: merged.search.diversity });
  }
  if (!Array.isArray(merged.roots.extra)) failConfig('roots.extra debe ser una lista');
  merged.roots.extra.forEach((root, index) => {
    if (typeof root !== 'string' || !isAbsolute(root)) {
      failConfig(`roots.extra[${index}] debe ser una ruta absoluta`, { value: root });
    }
  });
  merged.roots = Object.freeze({ extra: Object.freeze([...merged.roots.extra]) });

  if (!['local-hash-v1', 'remote'].includes(merged.embedding.provider)) {
    failConfig('embedding.provider debe ser local-hash-v1 o remote', { value: merged.embedding.provider });
  }
  checkInteger(merged.embedding.dim, 'embedding.dim', 64, 4_096);
  if (merged.embedding.provider === 'remote') {
    const remote = merged.embedding.remote;
    if (remote === null || typeof remote !== 'object' || Array.isArray(remote)) {
      failConfig('embedding.remote es obligatorio cuando provider es remote');
    }
    onlyKeys(remote, ['endpoint', 'model', 'batchSize', 'timeoutMs', 'credentialRef'], 'embedding.remote');
    if (typeof remote.endpoint !== 'string' || !/^https?:\/\/[^\s]+$/i.test(remote.endpoint)) {
      failConfig('embedding.remote.endpoint debe ser una URL http(s)');
    }
    if (typeof remote.model !== 'string' || remote.model.trim() === '' || remote.model.length > 120) {
      failConfig('embedding.remote.model debe ser un identificador no vacío');
    }
    checkInteger(remote.batchSize ?? 16, 'embedding.remote.batchSize', 1, 256);
    checkInteger(remote.timeoutMs ?? 20_000, 'embedding.remote.timeoutMs', 500, 120_000);
    if (remote.credentialRef !== undefined && (typeof remote.credentialRef !== 'string' || remote.credentialRef === '')) {
      failConfig('embedding.remote.credentialRef debe ser una referencia no vacía');
    }
    merged.embedding.remote = Object.freeze({
      endpoint: remote.endpoint,
      model: remote.model,
      batchSize: remote.batchSize ?? 16,
      timeoutMs: remote.timeoutMs ?? 20_000,
      credentialRef: remote.credentialRef ?? null,
    });
  } else if (merged.embedding.remote !== null) {
    failConfig('embedding.remote sólo se admite con provider remote');
  }
  if (merged.audit.exportJsonl !== true && merged.audit.exportJsonl !== false) {
    failConfig('audit.exportJsonl debe ser booleano');
  }
  if (typeof merged.metrics.enabled !== 'boolean') failConfig('metrics.enabled debe ser booleano');
  checkInteger(merged.metrics.retentionDays, 'metrics.retentionDays', 1, 3_650);
  if (typeof merged.automation.enabled !== 'boolean') failConfig('automation.enabled debe ser booleano');
  checkInteger(merged.automation.intervalMs, 'automation.intervalMs', 5_000, 3_600_000);
  checkInteger(merged.automation.maxFilesPerRun, 'automation.maxFilesPerRun', 1, 1_000);
  checkInteger(merged.automation.tickBudgetMs, 'automation.tickBudgetMs', 250, 120_000);
  if (!Array.isArray(merged.automation.watchRoots)) failConfig('automation.watchRoots debe ser una lista');
  merged.automation.watchRoots.forEach((watch, index) => {
    if (typeof watch !== 'string' || !isAbsolute(watch)) {
      failConfig(`automation.watchRoots[${index}] debe ser una ruta absoluta`, { value: watch });
    }
  });
  if (merged.automation.collections === null || typeof merged.automation.collections !== 'object' || Array.isArray(merged.automation.collections)) {
    failConfig('automation.collections debe ser un objeto ruta→colección');
  }
  for (const [key, value] of Object.entries(merged.automation.collections)) {
    if (typeof value !== 'string' || value.trim() === '') failConfig(`automation.collections[${key}] debe ser texto`);
  }
  merged.automation = Object.freeze({
    enabled: merged.automation.enabled,
    intervalMs: merged.automation.intervalMs,
    watchRoots: Object.freeze([...merged.automation.watchRoots]),
    maxFilesPerRun: merged.automation.maxFilesPerRun,
    tickBudgetMs: merged.automation.tickBudgetMs,
    collections: Object.freeze({ ...merged.automation.collections }),
  });
  merged.metrics = Object.freeze({ enabled: merged.metrics.enabled, retentionDays: merged.metrics.retentionDays });
  if (typeof merged.autoContext.enabled !== 'boolean') failConfig('autoContext.enabled debe ser booleano');
  checkInteger(merged.autoContext.maxChars, 'autoContext.maxChars', 200, 20_000);
  checkInteger(merged.autoContext.maxChunks, 'autoContext.maxChunks', 1, 20);
  checkInteger(merged.autoContext.budgetTokens, 'autoContext.budgetTokens', 64, 8_000);
  checkInteger(merged.autoContext.timeoutMs, 'autoContext.timeoutMs', 100, 15_000);
  if (merged.autoContext.budgetTokens > merged.context.budgetTokens) {
    failConfig('autoContext.budgetTokens no puede superar context.budgetTokens');
  }
  merged.autoContext = Object.freeze({
    enabled: merged.autoContext.enabled,
    maxChars: merged.autoContext.maxChars,
    maxChunks: merged.autoContext.maxChunks,
    budgetTokens: merged.autoContext.budgetTokens,
    timeoutMs: merged.autoContext.timeoutMs,
  });
  merged.search = Object.freeze({ ...merged.search, weights: Object.freeze({ ...merged.search.weights }) });
  return Object.freeze(merged);
}

/**
 * Lee `config.json` si existe. Ausente ⇒ defaults sin escribir; ilegible o inválido ⇒ `invalid-config`
 * (fail closed: un almacén con configuración ambigua no se usa).
 */
export function loadConfig(root) {
  const paths = storePaths(root);
  if (!existsSync(paths.config)) return { config: validateConfig({}), source: 'defaults', path: paths.config };
  let text;
  try {
    text = readFileSync(paths.config, 'utf8');
  } catch (error) {
    throw new RagError('invalid-config', 'no se pudo leer config.json', { details: { path: paths.config }, cause: error });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new RagError('invalid-config', 'config.json no es JSON válido', { details: { path: paths.config }, cause: error });
  }
  return { config: validateConfig(parsed), source: 'file', path: paths.config };
}

/**
 * Escribe `config.json` de forma atómica: se valida antes, se escribe en temporal, `fsync` y
 * `rename`. Un fallo a mitad deja la configuración anterior intacta. La escritura la decide una
 * persona desde el Workspace o la CLI; nunca se escribe un fichero por el simple hecho de leer.
 */
export function writeConfig(root, raw, { now = Date.now() } = {}) {
  const config = validateConfig(raw);
  const paths = storePaths(root);
  mkdirSync(paths.root, { recursive: true });
  const tmp = `${paths.config}.tmp-${process.pid}-${now}`;
  const handle = openSync(tmp, 'w');
  try {
    writeFileSync(handle, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(tmp, paths.config);
  return { config, path: paths.config };
}
