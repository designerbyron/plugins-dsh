/**
 * Almacenes de ámbito (PA3, endurecido en PA4).
 *
 * Cada ámbito (proyecto o biblioteca) tiene su propio `rag.sqlite3` bajo
 * `<raíz de perfil>/scopes/<scope_id>/`. No hay un almacén común: abrir un ámbito es la única forma
 * de leerlo, y el `scope_id` grabado en `meta` impide que dos ámbitos se confundan aunque alguien
 * mueva directorios.
 *
 * PA4 añade tres cosas:
 * - la identidad se verifica completa (`scope_id`, `scope_kind`, perfil y `store_state`), no sólo el
 *   `scope_id`;
 * - un almacén marcado `corrupt` o en migración no se abre: se distingue corrupción de
 *   indisponibilidad;
 * - los almacenes nuevos declaran `profile_id` y `store_state='ready'`, y los heredados de PA3
 *   (que sólo tienen `profile_key`) siguen abriéndose.
 *
 * La apertura no decide autorización: eso ocurre antes, en `exec-context.mjs`.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { closeDatabase, openDatabase, writeMeta } from './db.mjs';
import { RagError } from './errors.mjs';
import { scopeRoot } from './profile.mjs';
import { STORE_FILE, libraryStateError, verifyStoreIdentity } from './library-state.mjs';

/** Directorio del almacén de un ámbito. */
export function scopeStoreDir(profileRootPath, scopeId) {
  return scopeRoot(profileRootPath, scopeId);
}

/** Ruta del fichero del almacén de un ámbito. */
export function scopeStoreFile(profileRootPath, scopeId) {
  return join(scopeStoreDir(profileRootPath, scopeId), STORE_FILE);
}

/** ¿Existe ya el fichero del ámbito? No lo abre. */
export function scopeStoreExists(profileRootPath, scopeId) {
  return existsSync(scopeStoreFile(profileRootPath, scopeId));
}

function declareIdentity(db, { scope, key }) {
  writeMeta(db, 'scope_id', scope.id);
  writeMeta(db, 'scope_kind', scope.kind);
  writeMeta(db, 'profile_id', key);
  writeMeta(db, 'profile_key', key);
  writeMeta(db, 'store_state', 'ready');
}

/**
 * Abre el almacén de un ámbito.
 *
 * @returns {import('node:sqlite').DatabaseSync|null} `null` si no existe y `create` es falso.
 * @throws {RagError} `scope-store-corrupt` si el fichero no es el de este ámbito o no es utilizable;
 *   `scope-store-unavailable` si está en migración; `scope-forbidden` si pertenece a otro perfil.
 */
export function openScopeStore({
  profileRoot: profileRootPath, profileKey: key, scope, create = false, now = Date.now(),
} = {}) {
  const root = scopeStoreDir(profileRootPath, scope.id);
  const file = scopeStoreFile(profileRootPath, scope.id);
  if (!create && !existsSync(file)) return null;

  let opened;
  try {
    opened = openDatabase({ root, create, now });
  } catch (error) {
    if (error instanceof RagError && error.code === 'store-not-initialized') return null;
    if (error instanceof RagError && error.code === 'store-busy') {
      // Contención no es corrupción: el llamador puede reintentar y la sesión conserva su autorización.
      throw new RagError('scope-store-unavailable', `el almacén del ámbito ${scope.id} está bloqueado`, {
        cause: error,
        details: {
          scopeId: scope.id,
          scope_id: scope.id,
          scope_kind: scope.kind,
          reason: 'busy',
          retryable: true,
          path: root,
        },
      });
    }
    if (error instanceof RagError && ['store-not-rag', 'store-corrupt', 'store-version-unsupported', 'fts-integrity'].includes(error.code)) {
      throw new RagError('scope-store-corrupt', `el almacén del ámbito ${scope.id} no es utilizable`, {
        cause: error,
        details: { scopeId: scope.id, scope_id: scope.id, scope_kind: scope.kind, underlying: error.code, path: root },
      });
    }
    throw error;
  }

  const db = opened.db;
  try {
    if (create && opened.created) declareIdentity(db, { scope, key });
    const identity = verifyStoreIdentity(db, { scope, profileKey: key });
    if (!identity.ok) {
      if (identity.reason === 'foreign-profile') {
        throw new RagError('scope-forbidden', 'el almacén pertenece a otro perfil', {
          details: { scope_id: scope.id, ...identity.details },
        });
      }
      if (identity.reason === 'migrating') {
        throw libraryStateError(
          { state: 'unavailable', reason: 'migrating', retryable: true, scopeId: scope.id, scopeKind: scope.kind },
          { scopeId: scope.id, scopeKind: scope.kind },
        );
      }
      // Adoptar la identidad de un fichero que ya existía sería confiar en un almacén ajeno: sólo se
      // declara cuando lo acabamos de crear nosotros en esta misma llamada.
      if (identity.reason === 'missing-scope-id' && opened.created) {
        declareIdentity(db, { scope, key });
      } else if (identity.reason === 'missing-scope-id' && create) {
        throw new RagError('scope-store-corrupt', `el almacén del ámbito ${scope.id} existe sin identidad declarada`, {
          details: { scopeId: scope.id, scope_id: scope.id, scope_kind: scope.kind, reason: identity.reason, path: root },
        });
      } else {
        throw new RagError('scope-store-corrupt', `el almacén del ámbito ${scope.id} no declara su identidad completa`, {
          details: { scopeId: scope.id, scope_id: scope.id, scope_kind: scope.kind, reason: identity.reason, ...identity.details, path: root },
        });
      }
    }
    return db;
  } catch (error) {
    closeDatabase(db);
    throw error;
  }
}
