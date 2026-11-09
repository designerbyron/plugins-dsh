/**
 * El almacén: un documento JSON versionado, escrito de forma atómica.
 *
 * Por qué un documento y no una carpeta por entidad: un cambio de este centro casi siempre toca dos o
 * tres cosas a la vez —publicar una versión y dejar su evaluación, asignarla y anotar el evento—, y con
 * un documento esas cosas se escriben juntas o no se escriben. No hay transacción entre ficheros, y
 * fingirla sería peor que no tenerla.
 *
 * La escritura es `tmp` + `rename`: en el mismo volumen el rename es atómico, así que un corte a mitad
 * deja el documento anterior entero, nunca medio documento.
 */

import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { isSafeId, parseVersion, shortHash } from './format.mjs';

export const SCHEMA_VERSION = 1;
/** Tope del diario de eventos. Más allá de esto lo que sobra no se consulta y engorda cada escritura. */
export const MAX_EVENTS = 4000;

/** Raíz de datos por defecto: hermana de `skills/` y de `skill-compiler/`, sin pisar ninguna. */
export function defaultRoot(env = process.env) {
  const dshHome = env?.DSH_HOME || join(homedir(), '.dsh');
  return join(dshHome, 'lifecode-skill-center');
}

export function centerFile(root) {
  return join(root, 'center.json');
}

/** Las skills asignadas se materializan aquí para que el harness las lea con su propio lector. */
export function materializedRoot(root) {
  return join(root, 'materialized');
}

export function emptyState(now = new Date().toISOString()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    skills: {},
    projects: {},
    assignments: {},
    improvements: {},
    events: [],
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEvaluation(value) {
  if (!isObject(value)) return null;
  return {
    status: ['pass', 'warn', 'fail'].includes(value.status) ? value.status : 'warn',
    score: Number.isFinite(value.score) ? Number(value.score) : 0,
    findings: list(value.findings)
      .filter((finding) => isObject(finding) && typeof finding.code === 'string')
      .map((finding) => ({
        code: finding.code,
        severity: ['block', 'warn', 'info'].includes(finding.severity) ? finding.severity : 'warn',
        message: text(finding.message),
      })),
    evaluatedAt: text(value.evaluatedAt),
  };
}

function normalizeVersion(raw) {
  if (!isObject(raw) || typeof raw.version !== 'string') return null;
  // Una versión sin número legible o sin cuerpo no se puede cargar ni comparar; conservarla sólo
  // serviría para que el panel ofreciera algo que falla al materializarse.
  if (parseVersion(raw.version) === null) return null;
  const body = text(raw.body);
  if (body.trim() === '') return null;
  const references = {};
  if (isObject(raw.references)) {
    for (const [path, content] of Object.entries(raw.references)) {
      if (typeof content === 'string' && path.startsWith('references/') && !path.includes('..')) references[path] = content;
    }
  }
  return {
    version: raw.version,
    description: text(raw.description),
    whenToUse: text(raw.whenToUse),
    tags: list(raw.tags).filter((tag) => typeof tag === 'string'),
    body,
    references,
    createdAt: text(raw.createdAt),
    checksum: text(raw.checksum),
    notes: text(raw.notes),
    evaluation: normalizeEvaluation(raw.evaluation),
  };
}

export function normalizeSkill(raw) {
  const versions = list(raw.versions).map(normalizeVersion).filter((version) => version !== null);
  const origin = isObject(raw.origin)
    ? {
      kind: ['ai', 'human', 'import', 'fork'].includes(raw.origin.kind) ? raw.origin.kind : 'human',
      from: typeof raw.origin.from === 'string' ? raw.origin.from : null,
      fromVersion: typeof raw.origin.fromVersion === 'string' ? raw.origin.fromVersion : null,
      note: text(raw.origin.note),
    }
    : { kind: 'human', from: null, fromVersion: null, note: '' };
  return {
    id: text(raw.id),
    title: text(raw.title),
    description: text(raw.description),
    whenToUse: text(raw.whenToUse),
    tags: list(raw.tags).filter((tag) => typeof tag === 'string'),
    status: raw.status === 'deprecated' ? 'deprecated' : 'published',
    currentVersion: text(raw.currentVersion),
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
    origin,
    versions,
  };
}

function normalizeProject(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  return {
    id: raw.id,
    name: text(raw.name, raw.id),
    cwd: text(raw.cwd),
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
    note: text(raw.note),
  };
}

function normalizeAssignment(raw) {
  if (!isObject(raw)) return null;
  return {
    enabled: raw.enabled === true,
    version: text(raw.version),
    updatedAt: text(raw.updatedAt),
    by: raw.by === 'ai' ? 'ai' : 'human',
  };
}

/**
 * Normaliza lo leído del disco. **Nunca lanza**: un documento corrupto deja el centro vacío y un aviso,
 * porque una biblioteca ilegible no puede tumbar la carga de skills de todas las sesiones.
 */
export function normalizeState(raw) {
  const base = emptyState();
  if (!isObject(raw)) return base;
  const state = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: text(raw.createdAt, base.createdAt),
    updatedAt: text(raw.updatedAt, base.createdAt),
    skills: {},
    projects: {},
    assignments: {},
    improvements: {},
    events: [],
  };
  if (isObject(raw.skills)) {
    for (const [id, skill] of Object.entries(raw.skills)) {
      if (!isObject(skill)) continue;
      if (typeof skill.id !== 'string' || skill.id === '') skill.id = id;
      const normalized = normalizeSkill(skill);
      if (!isSafeId(id) || normalized.versions.length === 0) continue;
      state.skills[id] = normalized;
    }
  }
  if (isObject(raw.projects)) {
    for (const [id, project] of Object.entries(raw.projects)) {
      const normalized = normalizeProject(isObject(project) ? { ...project, id: project.id ?? id } : null);
      if (normalized !== null) state.projects[normalized.id] = normalized;
    }
  }
  if (isObject(raw.assignments)) {
    for (const [projectId, entries] of Object.entries(raw.assignments)) {
      if (!isObject(entries)) continue;
      const row = {};
      for (const [skillId, assignment] of Object.entries(entries)) {
        const normalized = normalizeAssignment(assignment);
        if (normalized !== null) row[skillId] = normalized;
      }
      if (Object.keys(row).length > 0) state.assignments[projectId] = row;
    }
  }
  if (isObject(raw.improvements)) {
    for (const [id, improvement] of Object.entries(raw.improvements)) {
      if (!isObject(improvement) || typeof improvement.skillId !== 'string') continue;
      const status = ['proposed', 'approved', 'rejected'].includes(improvement.status) ? improvement.status : 'proposed';
      state.improvements[id] = {
        id,
        skillId: improvement.skillId,
        baseVersion: text(improvement.baseVersion),
        description: text(improvement.description),
        whenToUse: text(improvement.whenToUse),
        tags: list(improvement.tags).filter((tag) => typeof tag === 'string'),
        body: text(improvement.body),
        references: isObject(improvement.references) ? improvement.references : {},
        rationale: text(improvement.rationale),
        status,
        createdAt: text(improvement.createdAt),
        decidedAt: text(improvement.decidedAt),
        decidedBy: text(improvement.decidedBy),
        // La versión que publicó una propuesta aprobada: sin este campo el historial no puede decir
        // qué versión salió de qué propuesta (se perdía al recargar, no al aprobar).
        version: text(improvement.version),
        evaluation: normalizeEvaluation(improvement.evaluation),
      };
    }
  }
  state.events = list(raw.events)
    .filter((event) => isObject(event) && typeof event.type === 'string')
    .slice(-MAX_EVENTS)
    .map((event) => ({
      id: text(event.id),
      at: text(event.at),
      type: event.type,
      skillId: text(event.skillId),
      projectId: text(event.projectId),
      version: text(event.version),
      // `system` no es una persona ni el modelo: es el harness pidiendo el catálogo. Colapsarlo a
      // `human` falseaba la telemetría (una carga aparecía como acto de una persona).
      actor: event.actor === 'ai' || event.actor === 'system' ? event.actor : 'human',
      note: text(event.note),
    }));
  return state;
}

/**
 * Integridad del documento. Un centro puede estar en cinco estados, y sólo dos permiten escribir:
 *
 * - `ok`: JSON válido y con la estructura del esquema que este código sabe leer.
 * - `missing`: no hay fichero. Se puede crear el primero con una operación legítima.
 * - `unreadable`: hay fichero y no es JSON válido. **No se toca**: se conserva y se avisa.
 * - `invalid-shape`: es JSON válido pero no tiene la forma del almacén (`{}`, `[]`, `{"skills":"x"}`…).
 * - `future-version`: lo escribió una versión más nueva. No se degrada ni se migra aquí.
 *
 * La tolerancia de `normalizeState` sirve para leer sin tumbar la sesión, **no** para autorizar una
 * escritura: usar un estado normalizado vacío como si fuera la biblioteca real borraba los datos
 * (medido en la auditoría LSC-007: 913 B → 204 B).
 */
export const INTEGRITY_OK = 'ok';
export const INTEGRITY_MISSING = 'missing';
export const INTEGRITY_UNREADABLE = 'unreadable';
export const INTEGRITY_INVALID_SHAPE = 'invalid-shape';
export const INTEGRITY_FUTURE_VERSION = 'future-version';

/** Las cinco colecciones que cualquier `center.json` del esquema v1 tiene, con su tipo. */
const STORE_SHAPE = {
  skills: 'object',
  projects: 'object',
  assignments: 'object',
  improvements: 'object',
  events: 'array',
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256OfBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * ¿Es este documento un almacén que sabemos leer?
 *
 * Se exige el objeto raíz y las cinco colecciones con su tipo. Son obligatorias a propósito: `{}` o
 * `{"skills":"x"}` no son «un centro vacío», son un documento que no es nuestro, y aceptarlos como
 * vacíos es lo que permitía borrar la biblioteca con la primera mutación.
 */
export function checkStoreShape(parsed) {
  if (!isPlainObject(parsed)) return { ok: false, reason: 'el documento raíz no es un objeto JSON' };
  for (const [key, kind] of Object.entries(STORE_SHAPE)) {
    const value = parsed[key];
    if (value === undefined) return { ok: false, reason: `falta la colección "${key}"` };
    if (kind === 'array' && !Array.isArray(value)) return { ok: false, reason: `"${key}" debería ser una lista` };
    if (kind === 'object' && !isPlainObject(value)) return { ok: false, reason: `"${key}" debería ser un mapa` };
  }
  const version = parsed.schemaVersion;
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    return { ok: false, reason: '"schemaVersion" no es un entero positivo' };
  }
  if (Number.isInteger(version) && version > SCHEMA_VERSION) {
    return { ok: false, future: true, reason: `el documento es de la versión ${version} y este centro escribe la ${SCHEMA_VERSION}` };
  }
  return { ok: true };
}

/**
 * Lee el documento **sin modificarlo**.
 *
 * Devuelve siempre el estado normalizado para poder pintar algo, pero `integrity` manda: quien vaya a
 * escribir tiene que mirarlo. `sha256` y `size` se calculan sobre los **bytes originales**, no sobre una
 * reserialización, porque son la huella con la que se verifica una preservación o una restauración.
 */
export function loadState(root = defaultRoot()) {
  const file = centerFile(root);
  let bytes = null;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        ok: true,
        integrity: INTEGRITY_MISSING,
        path: file,
        state: emptyState(),
        error: null,
        exists: false,
        sha256: null,
        size: 0,
      };
    }
    return {
      ok: false,
      integrity: INTEGRITY_UNREADABLE,
      path: file,
      state: emptyState(),
      error: String(error?.message ?? error),
      exists: true,
      sha256: null,
      size: 0,
    };
  }

  const sha256 = sha256OfBytes(bytes);
  const size = bytes.length;
  const base = { path: file, exists: true, sha256, size };
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return { ok: false, integrity: INTEGRITY_UNREADABLE, state: emptyState(), error: String(error?.message ?? error), ...base };
  }
  const shape = checkStoreShape(parsed);
  if (!shape.ok) {
    return {
      ok: false,
      integrity: shape.future === true ? INTEGRITY_FUTURE_VERSION : INTEGRITY_INVALID_SHAPE,
      state: emptyState(),
      error: shape.reason,
      ...base,
    };
  }
  return { ok: true, integrity: INTEGRITY_OK, state: normalizeState(parsed), error: null, ...base };
}

/** ¿Se puede escribir sobre este documento? Sólo si está sano o si todavía no existe. */
export function canWrite(integrity) {
  return integrity === INTEGRITY_OK || integrity === INTEGRITY_MISSING;
}

/**
 * Escritura atómica: se escribe al lado y se renombra encima.
 *
 * En Windows, renombrar sobre un fichero que otro proceso está leyendo puede fallar con `EPERM`
 * durante unos milisegundos (lo midió la auditoría con dos escritores). Se reintenta, porque el
 * candado de `withState` ya serializa lo nuestro y esto cubre a quien lea por fuera.
 */
export function saveState(root, state, { now = new Date().toISOString() } = {}) {
  const file = centerFile(root);
  mkdirSync(dirname(file), { recursive: true });
  state.schemaVersion = SCHEMA_VERSION;
  state.updatedAt = now;
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameWithRetry(tmp, file);
  return file;
}

const LOCK_WAIT_MS = 4000;
const LOCK_RETRY_MS = 12;
const LOCK_STALE_MS = 20000;
const RENAME_RETRY_MS = 15;

function lockFile(root) {
  return `${centerFile(root)}.lock`;
}

/** Espera síncrona sin dependencias: el núcleo es síncrono a propósito y cada acción es corta. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(tmp, file) {
  let last = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      renameSync(tmp, file);
      return;
    } catch (error) {
      last = error;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error;
      sleepSync(RENAME_RETRY_MS);
    }
  }
  throw last;
}

/**
 * Candado del documento, para que dos escritores no se pisen.
 *
 * Sin esto, dos procesos que leen-mutan-escriben a la vez producen **pérdida de escrituras**: el
 * último guarda su copia y borra lo que el otro acababa de añadir (medido: 50 proyectos en 50
 * aperturas concurrentes, sólo 31 sobrevivieron). El candado es un fichero `wx`; uno huérfano de un
 * proceso muerto se retira por antigüedad, no se espera indefinidamente.
 */
function acquireLock(root) {
  const file = lockFile(root);
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = openSync(file, 'wx');
      try {
        writeFileSync(handle, `${process.pid}\n`, 'utf8');
      } finally {
        closeSync(handle);
      }
      return () => {
        try {
          rmSync(file, { force: true });
        } catch {
          // si no se puede borrar, el siguiente lo verá viejo y lo retirará
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS) rmSync(file, { force: true });
      } catch {
        // el candado desapareció entre la comprobación y el borrado: se reintenta
      }
      if (Date.now() > deadline) throw new Error(`el centro está ocupado: no se pudo tomar el candado en ${LOCK_WAIT_MS} ms`);
      sleepSync(LOCK_RETRY_MS);
    }
  }
}

/**
 * Campos que NO cuentan como cambio funcional.
 *
 * `updatedAt` es un sello de escritura, no un dato del producto: si se incluyera en la firma, cualquier
 * guardado parecería un cambio y la detección de no-ops no serviría de nada. La lista es deliberadamente
 * corta: todo lo demás (eventos, asignaciones, versiones, referencias, proyectos) es funcional y entra.
 */
const NON_FUNCTIONAL_FIELDS = new Set(['updatedAt']);

/** Serializa un valor de forma canónica: claves ordenadas, orden de arrays intacto. */
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (NON_FUNCTIONAL_FIELDS.has(key)) continue;
      out[key] = canonicalValue(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Firma canónica del estado **funcional**.
 *
 * Sirve para una sola cosa: decidir si una mutación cambió algo de verdad. Ordena claves (para que dos
 * documentos equivalentes den la misma firma), conserva el orden de los arrays (que sí es semántico:
 * el diario es una secuencia) y deja fuera sólo los sellos de tiempo.
 */
export function functionalSignature(state) {
  return JSON.stringify(canonicalValue(state ?? {}));
}

/**
 * Lee, deja mutar y guarda **bajo candado**. Si la mutación lanza, no se guarda nada: media operación
 * escrita es peor que ninguna, y el error viaja a quien llamó.
 *
 * Si la mutación no cambia nada funcional, **no se escribe**: se devuelve `saved: false`. Sin esto, una
 * lectura del catálogo reescribía el documento cada vez que el harness pedía las skills (T13): el
 * `updatedAt` cambiaba, el vigilante se despertaba y el SHA-256 del almacén se movía sin motivo.
 * La comparación se hace **dentro del candado**, con el estado que se acaba de leer y después de mutar:
 * comprobar antes sería una carrera entre dos procesos que leen lo mismo.
 */
export function withState(root = defaultRoot(), mutate, { now } = {}) {
  const stamp = now ?? new Date().toISOString();
  const release = acquireLock(root);
  try {
    const loaded = loadState(root);
    // La puerta va **dentro** del candado: si se comprobara antes, dos procesos podrían ver un almacén
    // sano y uno de ellos encontrarlo roto al escribir (o al revés). Aquí no hay carrera posible.
    if (!canWrite(loaded.integrity)) {
      return {
        ok: false,
        code: 'store-unreadable',
        integrity: loaded.integrity,
        path: loaded.path,
        sha256: loaded.sha256,
        size: loaded.size,
        error: loaded.error,
        saved: false,
        state: loaded.state,
        storeError: loaded.error,
      };
    }
    const before = functionalSignature(loaded.state);
    const result = mutate(loaded.state, { now: stamp, loaded });
    const after = functionalSignature(loaded.state);
    if (before === after) {
      return { ok: true, saved: false, result, state: loaded.state, storeError: null, integrity: loaded.integrity };
    }
    saveState(root, loaded.state, { now: stamp });
    return { ok: true, saved: true, result, state: loaded.state, storeError: null, integrity: loaded.integrity };
  } finally {
    release();
  }
}

/** Copia binaria del documento actual, sin renombrarlo ni tocarlo: `center.json.corrupt-<marca>`. */
export function archiveCorruptStore(root = defaultRoot(), { now = new Date().toISOString() } = {}) {
  const loaded = loadState(root);
  if (loaded.exists !== true) return { ok: false, code: 'nothing-to-preserve', message: 'no hay documento que conservar' };
  const source = readFileSync(loaded.path);
  const stamp = String(now).replace(/[^0-9A-Za-z]/g, '').slice(0, 17);
  let archivedAs = join(dirname(loaded.path), `center.json.corrupt-${stamp}`);
  let suffix = 0;
  // `wx` es exclusivo: nunca pisa una preservación anterior. Si el nombre ya existe, se numera.
  for (;;) {
    try {
      writeFileSync(archivedAs, source, { flag: 'wx' });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        return { ok: false, code: 'archive-failed', message: String(error?.message ?? error) };
      }
      suffix += 1;
      archivedAs = join(dirname(loaded.path), `center.json.corrupt-${stamp}-${suffix}`);
    }
  }
  const written = readFileSync(archivedAs);
  const sha256 = sha256OfBytes(written);
  if (sha256 !== loaded.sha256 || written.length !== source.length) {
    return { ok: false, code: 'archive-mismatch', message: 'la copia conservada no coincide con el original', archivedAs };
  }
  return { ok: true, archivedAs, sha256, size: written.length };
}

/**
 * Restauración **humana y explícita** de un documento.
 *
 * Orden obligatorio: comprobar el origen (hash y forma) → preservar el original ilegible → sólo entonces
 * instalarlo de forma atómica → releerlo y exigir `integrity: ok`. Si la preservación falla, se aborta
 * sin tocar `center.json`: quedarse sin copia sería cambiar un problema por otro.
 */
/**
 * `archive` se puede inyectar: la prueba del camino «la preservación falla» necesita forzar ese fallo
 * sin depender de permisos del sistema de ficheros (en Windows un directorio de solo lectura no lo es).
 */
export function restoreStore(root = defaultRoot(), { sourcePath = '', expectedSha256 = '', now = new Date().toISOString(), archive = archiveCorruptStore } = {}) {
  const wanted = String(sourcePath ?? '').trim();
  if (wanted === '') return { ok: false, code: 'missing-source', message: 'falta el archivo de origen' };
  let source;
  try {
    source = readFileSync(wanted);
  } catch (error) {
    return { ok: false, code: 'unreadable-source', message: `no se pudo leer el origen: ${String(error?.message ?? error)}` };
  }
  const sha256 = sha256OfBytes(source);
  const expected = String(expectedSha256 ?? '').trim().toLowerCase();
  if (expected !== '' && expected !== sha256) {
    return { ok: false, code: 'hash-mismatch', message: `el origen no coincide con el hash esperado (${sha256})`, sha256 };
  }
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch (error) {
    return { ok: false, code: 'invalid-source', message: `el origen no es JSON válido: ${String(error?.message ?? error)}` };
  }
  const shape = checkStoreShape(parsed);
  if (!shape.ok) return { ok: false, code: 'invalid-source', message: `el origen no es un almacén legible: ${shape.reason}` };

  const release = acquireLock(root);
  try {
    const current = loadState(root);
    let archived = null;
    if (current.exists === true && !canWrite(current.integrity)) {
      const preserved = archive(root, { now });
      if (!preserved.ok) {
        return { ok: false, code: 'archive-failed', message: `no se pudo preservar el original: ${preserved.message}` };
      }
      archived = preserved;
    }
    const file = centerFile(root);
    const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, source);
    renameWithRetry(tmp, file);
    const after = loadState(root);
    if (after.integrity !== INTEGRITY_OK) {
      return { ok: false, code: 'restore-unverified', message: 'el documento restaurado no se relee como válido', integrity: after.integrity };
    }
    return {
      ok: true,
      restoredFrom: wanted,
      sha256: after.sha256,
      archivedAs: archived === null ? null : archived.archivedAs,
      preservedSha256: archived === null ? null : archived.sha256,
      previousIntegrity: current.integrity,
    };
  } finally {
    release();
  }
}

/** Añade un evento al diario, recortando por delante lo que ya no cabe. */
export function appendEvent(state, event) {
  // `isObject` dice «objeto» y un array no lo es: usarlo aquí vaciaba el diario en cada evento y la
  // telemetría sólo recordaba el último. Se comprueba la forma real del campo, no la del tipo.
  if (!Array.isArray(state.events)) state.events = [];
  const at = text(event.at) || new Date().toISOString();
  const type = text(event.type, 'unknown');
  state.events.push({
    // Id y sello se completan aquí cuando quien llama no los trae: un evento sin identificador no se
    // puede referenciar y uno sin fecha no se puede ordenar, así que no tiene sentido aceptarlos.
    id: text(event.id) || `ev-${shortHash(`${at}:${type}:${state.events.length}`, 12)}`,
    at,
    type,
    skillId: text(event.skillId),
    projectId: text(event.projectId),
    version: text(event.version),
    // `system` no es una persona ni el modelo: es el harness pidiendo el catálogo. Colapsarlo a
      // `human` falseaba la telemetría (una carga aparecía como acto de una persona).
      actor: event.actor === 'ai' || event.actor === 'system' ? event.actor : 'human',
    note: text(event.note),
  });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  return state.events.at(-1);
}

/**
 * ¿Ya hay un evento de este tipo para este día y sujeto? Lo usa el proveedor para no pedir una escritura
 * cuando la entrega del catálogo no aporta nada nuevo.
 */
export function dailyEventExists(state, { type, skillId = '', projectId = '', day }) {
  const target = day ?? new Date().toISOString().slice(0, 10);
  if (!Array.isArray(state?.events)) return false;
  return state.events.some((event) => event.type === type
    && event.skillId === skillId
    && event.projectId === projectId
    && String(event.at).slice(0, 10) === target);
}

/**
 * Anota un evento **como mucho una vez por día y sujeto**.
 *
 * Una carga de skill no es una acción humana: el catálogo de una sesión se pide muchas veces por
 * minuto. Sin esta puerta, la telemetría de cargas se comería el documento y no mediría nada.
 */
export function recordDailyEvent(state, { type, skillId = '', projectId = '', version = '', actor = 'human', note = '', day }) {
  const target = day ?? new Date().toISOString().slice(0, 10);
  if (!Array.isArray(state.events)) state.events = [];
  if (dailyEventExists(state, { type, skillId, projectId, day: target })) return null;
  return appendEvent(state, {
    type,
    skillId,
    projectId,
    version,
    actor,
    note,
    at: `${target}T00:00:00.000Z`,
    id: `${target}-${type}-${skillId}-${projectId}`.slice(0, 120),
  });
}
