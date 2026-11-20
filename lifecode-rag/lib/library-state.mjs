/**
 * Estados de almacén y verificación de identidad (PA4-A / PA4-C).
 *
 * Un almacén de ámbito puede estar en siete estados. La diferencia importante es **cómo se
 * reacciona**: una ausencia (`missing`) no es una biblioteca vacía ni una corrupción; una
 * indisponibilidad (`unavailable`) se puede reintentar; una corrupción (`corrupt`) no se abre ni se
 * sobrescribe jamás. Todos los estados se detectan abriendo en **solo lectura**: clasificar nunca
 * crea, migra ni repara.
 *
 * La identidad del almacén se verifica contra el ámbito esperado antes de confiar en él:
 * `scope_id`, `scope_kind`, perfil y `store_state`. Un almacén de otro ámbito, de otro perfil o con
 * estado `corrupt` se cierra con `scope-store-corrupt` / `scope-forbidden`.
 */

import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { RagError } from './errors.mjs';
import { scopeRoot } from './profile.mjs';
import { APPLICATION_ID, SCHEMA_VERSION } from './schema.mjs';

/** Estados de almacén reconocidos. `recovering`/`recovered` los escribe el recuperador. */
export const LIBRARY_STATES = Object.freeze([
  'present',
  'missing',
  'unreadable',
  'corrupt',
  'unavailable',
  'recovering',
  'recovered',
]);

/** Estados que no permiten servir datos. */
export const BLOCKING_STATES = Object.freeze(['missing', 'unreadable', 'corrupt', 'unavailable', 'recovering']);

/** Estados que se pueden reintentar sin intervención humana. */
export const RETRYABLE_STATES = Object.freeze(['unavailable', 'recovering']);

export const STORE_FILE = 'rag.sqlite3';

/** Ruta del fichero de almacén de un ámbito. */
export function storeFileOf(profileRootPath, scopeId) {
  return join(scopeRoot(profileRootPath, scopeId), STORE_FILE);
}

const SQLITE_BUSY = new Set([5, 6]);
const SQLITE_CORRUPT = new Set([11, 26]);

/** Traduce un error de SQLite a un estado de almacén, sin inventar diagnósticos. */
export function classifySqliteError(error) {
  const errcode = Number(error?.errcode ?? 0);
  const errno = Number(error?.errno ?? 0);
  if (SQLITE_BUSY.has(errcode) || ['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error?.code)) {
    return { state: 'unavailable', reason: 'busy', retryable: true };
  }
  if (SQLITE_CORRUPT.has(errcode)) {
    return { state: 'corrupt', reason: error?.errstr ?? 'not-a-database', retryable: false };
  }
  if (errcode === 14 || errno === 2 || errno === 13 || /unable to open/i.test(String(error?.message ?? ''))) {
    return { state: 'unreadable', reason: 'unopenable', retryable: false };
  }
  if (['EACCES', 'EPERM'].includes(error?.code)) {
    return { state: 'unreadable', reason: 'permission', retryable: false };
  }
  if (error?.code === 'ENOENT') return { state: 'missing', reason: 'store-absent', retryable: false };
  // Un error desconocido no demuestra corrupción: marcarlo `corrupt` bloquearía el ámbito para siempre
  // por un fallo transitorio. Se declara no disponible y reintentable, sin filtrar el mensaje crudo
  // (que suele contener rutas absolutas) al consumidor.
  return { state: 'unavailable', reason: 'io-error', retryable: true };
}

function readMetaRows(db, keys) {
  const placeholders = keys.map(() => '?').join(',');
  const rows = db.prepare(`SELECT key, value FROM meta WHERE key IN (${placeholders})`).all(...keys);
  const meta = {};
  for (const row of rows) meta[row.key] = row.value;
  return meta;
}

/**
 * Verifica que el almacén abierto pertenece al ámbito y perfil esperados.
 *
 * @returns {{ok: true, meta: Record<string,string>} | {ok: false, reason: string, details: object}}
 */
export function verifyStoreIdentity(db, { scope, profileKey, requireState = false } = {}) {
  let meta;
  try {
    meta = readMetaRows(db, ['scope_id', 'scope_kind', 'profile_id', 'profile_key', 'store_state', 'schema_version']);
  } catch (error) {
    return { ok: false, reason: 'unreadable-meta', details: { message: String(error?.message ?? error) } };
  }
  if (!meta.scope_id) {
    return { ok: false, reason: 'missing-scope-id', details: { scopeId: scope.id } };
  }
  if (meta.scope_id !== scope.id) {
    return { ok: false, reason: 'foreign-scope', details: { expected: scope.id, found: meta.scope_id } };
  }
  if (meta.scope_kind && meta.scope_kind !== scope.kind) {
    return { ok: false, reason: 'foreign-kind', details: { expected: scope.kind, found: meta.scope_kind } };
  }
  if (profileKey) {
    // `profile_id` es el nombre del contrato PA0; `profile_key` es lo que escribieron los almacenes
    // de PA3. Se aceptan ambos y se exige que coincidan si están los dos.
    let declared = 0;
    for (const key of ['profile_id', 'profile_key']) {
      if (meta[key] === undefined || meta[key] === '') continue;
      declared += 1;
      if (meta[key] !== profileKey) {
        return { ok: false, reason: 'foreign-profile', details: { expected: profileKey, found: meta[key], key } };
      }
    }
    // Un almacén que no declara perfil no se adopta: no hay forma de saber de quién es.
    if (declared === 0) return { ok: false, reason: 'missing-profile', details: { scopeId: scope.id } };
  }
  if (meta.store_state === 'corrupt') {
    return { ok: false, reason: 'marked-corrupt', details: { scopeId: scope.id } };
  }
  if (meta.store_state === 'migrating') {
    return { ok: false, reason: 'migrating', details: { scopeId: scope.id }, retryable: true };
  }
  if (requireState && meta.store_state === undefined) {
    return { ok: false, reason: 'missing-store-state', details: { scopeId: scope.id } };
  }
  return { ok: true, meta };
}

/**
 * Clasifica un almacén sin modificarlo. Abre en solo lectura y comprueba cabecera, versión,
 * `quick_check` e identidad.
 *
 * @returns {{state: string, reason: string, retryable: boolean, scopeId: string, kind: string,
 *   path: string, bytes: number|null, meta: Record<string,string>|null}}
 */
export function classifyScopeStore({ profileRootPath, profileKey, scope, checkIntegrity = true } = {}) {
  const path = storeFileOf(profileRootPath, scope.id);
  const base = {
    scopeId: scope.id,
    scopeKind: scope.kind ?? null,
    kind: scope.kind ?? null,
    path,
    bytes: null,
    meta: null,
  };
  const dir = scopeRoot(profileRootPath, scope.id);
  if (!existsSync(dir)) return { ...base, state: 'missing', reason: 'directory-absent', retryable: false };
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...base, state: 'missing', reason: 'store-absent', retryable: false };
    const classified = classifySqliteError(error);
    return { ...base, ...classified };
  }
  base.bytes = stat.size;
  if (stat.isSymbolicLink()) return { ...base, state: 'unreadable', reason: 'store-is-link', retryable: false };

  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 250');
  } catch (error) {
    return { ...base, ...classifySqliteError(error) };
  }
  try {
    let applicationId;
    let version;
    try {
      applicationId = Number(db.prepare('PRAGMA application_id').get().application_id);
      version = Number(db.prepare('PRAGMA user_version').get().user_version);
      base.meta = readMetaRows(db, ['scope_id', 'scope_kind', 'profile_id', 'profile_key', 'store_state', 'schema_version']);
    } catch (error) {
      return { ...base, ...classifySqliteError(error) };
    }
    if (applicationId !== APPLICATION_ID) {
      return { ...base, state: 'corrupt', reason: 'foreign-application', retryable: false };
    }
    if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) {
      return { ...base, state: 'corrupt', reason: 'unsupported-version', retryable: false };
    }
    if (checkIntegrity) {
      try {
        const check = db.prepare('PRAGMA quick_check').all();
        const joined = check.map((row) => String(row.quick_check)).join(',');
        if (joined !== 'ok') return { ...base, state: 'corrupt', reason: 'quick-check', retryable: false };
        // Las referencias rotas (chunks sin fuente, por ejemplo) no rompen el fichero pero sí la
        // confianza en los datos: el contrato exige integridad, no sólo que SQLite lea.
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length > 0) {
          return { ...base, state: 'corrupt', reason: 'foreign-keys', retryable: false, findings: broken.slice(0, 5) };
        }
      } catch (error) {
        return { ...base, ...classifySqliteError(error) };
      }
    }
    const identity = verifyStoreIdentity(db, { scope, profileKey });
    if (!identity.ok) {
      if (identity.reason === 'migrating') return { ...base, state: 'unavailable', reason: 'migrating', retryable: true };
      return { ...base, state: 'corrupt', reason: identity.reason, retryable: false, identity: identity.details };
    }
    if (identity.meta.store_state === 'recovered') {
      return { ...base, state: 'recovered', reason: 'recovered', retryable: false };
    }
    if (identity.meta.store_state === 'recovering') {
      return { ...base, state: 'recovering', reason: 'recovering', retryable: true };
    }
    return { ...base, state: 'present', reason: 'ok', retryable: false };
  } finally {
    try {
      db.close();
    } catch {
      // cerrar dos veces no es un fallo
    }
  }
}

/** `true` si el estado permite servir datos. */
export function isServable(state) {
  return state === 'present' || state === 'recovered';
}

/**
 * Error accionable para un estado que bloquea. No convierte una ausencia en «vacío»: la ausencia es
 * `scope-store-unavailable` con `reason: 'missing'`, la corrupción es `scope-store-corrupt`.
 */
export function libraryStateError(entry, { scopeId, scopeKind } = {}) {
  const details = {
    scopeId: scopeId ?? entry.scopeId,
    scopeKind: scopeKind ?? entry.scopeKind,
    reason: entry.reason,
    state: entry.state,
    retryable: entry.retryable === true,
  };
  if (entry.state === 'corrupt') {
    return new RagError('scope-store-corrupt', 'el almacén del ámbito está corrupto; no se abre ni se sobrescribe', {
      details,
    });
  }
  return new RagError('scope-store-unavailable', 'el almacén del ámbito no está disponible', { details });
}

/** Catálogo de metadatos que un almacén debe declarar (para informes y doctor). */
export function requiredStoreMeta() {
  return Object.freeze({
    scope_id: 'identificador del ámbito dueño',
    scope_kind: 'prj | lib',
    profile_id: 'perfil lógico (se acepta profile_key heredado de PA3)',
    schema_version: 'versión del esquema de almacén',
    store_state: 'ready | migrating | corrupt',
    created_at: 'marca de creación',
  });
}
