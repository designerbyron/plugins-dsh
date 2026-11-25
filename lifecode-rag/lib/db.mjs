/**
 * Apertura, inicialización y comprobaciones baratas del almacén SQLite de LifeCode RAG.
 *
 * `node:sqlite` es una capacidad del propio host (disponible desde Node 22.13; FTS5 desde 22.16; Node 24/Electron 44), no una dependencia: el
 * plugin no importa nada de `@deepseek-ai/*`. El fichero lleva `application_id` propio para que un
 * `rag.sqlite3` de otro producto se rechace en vez de interpretarse.
 *
 * Apertura = comprobación **barata**: `PRAGMA quick_check` y coherencia de la cabeza de auditoría.
 * `integrity-check` de FTS es O(índice) y sólo corre en `doctor`, `reindex` y tras migrar.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { RagError } from './errors.mjs';
import { storePaths } from './paths.mjs';
import { APPLICATION_ID, DDL, DDL_V3, EXPECTED_TABLES, SCHEMA_VERSION, initialMeta } from './schema.mjs';

/** Configuración de conexión: durabilidad de auditoría y espera acotada, nunca bloqueo indefinido. */
export function configureConnection(db, { file = true } = {}) {
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  if (file) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
  }
}

function pragmaNumber(db, name) {
  const row = db.prepare(`PRAGMA ${name}`).get();
  return Number(row?.[name] ?? 0);
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
}

/** `quick_check` debe responder exactamente `ok`. */
export function quickCheck(db) {
  const rows = db.prepare('PRAGMA quick_check').all();
  if (rows.length !== 1 || rows[0]?.quick_check !== 'ok') {
    throw new RagError('store-corrupt', 'quick_check no devolvió ok', { details: { rows: rows.slice(0, 5) } });
  }
}

/** ¿La cabeza declarada en `meta` coincide con la última fila de `audit`? Detecta truncaciones y huecos. */
export function assertAuditHead(db) {
  const declared = Number(readMeta(db, 'audit_head_seq') ?? '0');
  const actual = Number(db.prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM audit').get()?.max_seq ?? 0);
  if (declared !== actual) {
    throw new RagError('store-corrupt', 'la cabeza de auditoría no coincide con la tabla', {
      details: { declared, actual },
    });
  }
}

/**
 * `integrity-check` de la FTS externa. Con `rank = 1` compara el contenido indexado con `chunks`; una
 * fila huérfana o un texto divergente lo hacen fallar. Es costoso: no se llama en cada apertura.
 */
export function ftsIntegrityCheck(db) {
  try {
    db.exec("INSERT INTO chunks_fts(chunks_fts, rank) VALUES('integrity-check', 1)");
  } catch (error) {
    throw new RagError('fts-integrity', 'el índice de texto no coincide con los chunks', { cause: error });
  }
}

/** Reconstruye la FTS desde `chunks`. Idempotente; se usa tras migrar y en `reindex`. */
export function ftsRebuild(db) {
  db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");
}

export function readMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row?.value;
}

export function writeMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

/** Transacción con reversión garantizada. `work` es síncrono: mantenerlo así evita awaits dentro del lock. */
export function withTransaction(db, work, { immediate = true } = {}) {
  db.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* el ROLLBACK puede fallar si SQLite ya revirtió */ }
    throw error;
  }
}

function initialize(db, now) {
  withTransaction(db, () => {
    for (const statement of DDL) db.exec(statement);
    db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    const insert = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    for (const [key, value] of initialMeta(now)) insert.run(key, value);
  });
  if (pragmaNumber(db, 'application_id') !== APPLICATION_ID) {
    throw new RagError('store-corrupt', 'no se pudo fijar application_id');
  }
  if (pragmaNumber(db, 'user_version') !== SCHEMA_VERSION) {
    throw new RagError('store-corrupt', 'no se pudo fijar user_version');
  }
}

/**
 * Migración secuencial. Sólo existe 2 → 3: la v1 nunca se publicó y no se finge soporte.
 * Todo ocurre en una transacción; si algo falla, el fichero queda en su versión anterior.
 */
function migrate(db, from, now) {
  if (from === 2) {
    withTransaction(db, () => {
      for (const statement of DDL_V3) db.exec(statement);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      writeMeta(db, 'schema_version', SCHEMA_VERSION);
      writeMeta(db, 'migrated_at', now);
    });
    return;
  }
  throw new RagError('store-version-unsupported', 'no hay migración desde esta versión', {
    details: { found: from, supported: SCHEMA_VERSION },
  });
}

/** Tamaño en bytes de un fichero, para dejar constancia del daño sin lanzar por el camino. */
function sizeOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/**
 * Abre el almacén. `create: true` es la única vía que crea el árbol y el fichero (`init`), y sólo cuando
 * no existe nada: sobre un fichero existente nunca se inicializa encima.
 *
 * @returns {{ db: DatabaseSync, paths: ReturnType<typeof storePaths>, created: boolean }}
 */
export function openDatabase({ root, create = false, readOnly = false, now = Date.now() } = {}) {
  const paths = storePaths(root);
  const existed = existsSync(paths.database);
  if (!existed && !create) {
    throw new RagError('store-not-initialized', 'el almacén no existe; ejecuta init o ingiere un documento', {
      details: { path: paths.database },
    });
  }
  if (create && !readOnly && !existsSync(paths.root)) mkdirSync(paths.root, { recursive: true });
  if (create && !readOnly && !existsSync(paths.backups)) mkdirSync(paths.backups, { recursive: true });

  let db;
  try {
    // `readOnly` se reserva para copias de diagnóstico: SQLite puede crear `-wal`/`-shm`
    // aunque la conexión sea de sólo lectura. El almacén original no se abre con esta opción.
    db = new DatabaseSync(paths.database, readOnly ? { readOnly: true } : {});
  } catch (error) {
    throw openError(error, paths.database);
  }
  try {    configureConnection(db, { file: !readOnly });
    const appId = pragmaNumber(db, 'application_id');
    const version = pragmaNumber(db, 'user_version');
    const tables = tableNames(db);

    if (tables.length === 0) {
      if (readOnly) throw new RagError('store-not-initialized', 'el almacén no tiene esquema para diagnóstico');
      if (appId !== 0) throw new RagError('store-not-rag', 'application_id presente sin esquema');
      if (existed) {
        // El fichero EXISTÍA y no tiene esquema: un corte durante un checkpoint, un disco lleno o una
        // copia truncada. Inicializar encima destruiría la única prueba de lo que había. Se trata como
        // corrupto y la recuperación es explícita, nunca implícita.
        throw new RagError('store-corrupt', 'el fichero del almacén existe pero no tiene esquema utilizable', {
          details: { path: paths.database, bytes: sizeOf(paths.database) },
        });
      }
      if (!create) {
        throw new RagError('store-not-initialized', 'el fichero existe pero no tiene esquema', {
          details: { path: paths.database },
        });
      }
      initialize(db, now);
    } else {
      if (appId !== APPLICATION_ID) {
        throw new RagError('store-not-rag', 'el fichero no es un almacén de LifeCode RAG', {
          details: { applicationId: appId },
        });
      }
      if (version > SCHEMA_VERSION) {
        throw new RagError('store-version-unsupported', 'el almacén es de una versión más nueva', {
          details: { found: version, supported: SCHEMA_VERSION },
        });
      }
      if (version < SCHEMA_VERSION && readOnly) {
        throw new RagError('store-migration-required', 'el almacén necesita migración; doctor no la ejecuta', {
          details: { found: version, supported: SCHEMA_VERSION, readOnly: true },
        });
      }
      if (version < SCHEMA_VERSION) migrate(db, version, now);
      const currentTables = tableNames(db);
      const missing = EXPECTED_TABLES.filter((name) => !currentTables.includes(name));
      if (missing.length > 0) {
        throw new RagError('store-corrupt', 'faltan tablas del esquema', { details: { missing } });
      }
      quickCheck(db);
      ftsTableIsExternal(db);
      assertAuditHead(db);
    }

    return { db, paths, created: !existed };
  } catch (error) {
    try { db.close(); } catch { /* cerrar tras un fallo no debe ocultar el fallo original */ }
    if (isBusyError(error)) {
      throw new RagError('store-busy', 'el almacén está bloqueado por otra conexión', {
        details: { path: paths.database, errcode: Number(error?.errcode ?? 0) },
        cause: error,
      });
    }
    if (isCorruptionError(error)) {
      throw new RagError('store-corrupt', 'el fichero del almacén no es una base de datos utilizable', {
        details: { path: paths.database, errcode: Number(error?.errcode ?? 0) },
        cause: error,
      });
    }
    throw error;
  }
}

/** `true` si el error de SQLite es contención (busy/locked) y no corrupción. */
export function isBusyError(error) {
  const errcode = Number(error?.errcode ?? 0);
  if (errcode === 5 || errcode === 6) return true;
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(String(error?.code ?? '') + String(error?.message ?? ''));
}

/**
 * `true` si SQLite dice que el fichero no es una base de datos o está dañada (11 = corrupt,
 * 26 = not a database). Se comprueba antes que la contención y se distingue de un fichero que sólo
 * no se puede abrir por permisos.
 */
export function isCorruptionError(error) {
  const errcode = Number(error?.errcode ?? 0);
  if (errcode === 11 || errcode === 26) return true;
  return /SQLITE_CORRUPT|SQLITE_NOTADB|file is not a database|database disk image is malformed|malformed database/i.test(
    String(error?.code ?? '') + ' ' + String(error?.message ?? ''),
  );
}

/** Traduce un fallo al abrir el fichero: un fichero ilegible no es una base corrupta. */
function openError(error, path) {
  if (isBusyError(error)) {
    return new RagError('store-busy', 'el almacén está bloqueado por otra conexión', {
      details: { path },
      cause: error,
    });
  }
  if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    return new RagError('source-unreadable', 'el almacén no se puede leer por permisos', {
      details: { path },
      cause: error,
    });
  }
  return error;
}

/**
 * Traduce un fallo de SQLite surgido **con la conexión ya abierta** (por ejemplo una escritura que
 * encuentra otra conexión con el bloqueo tomado). Sin esto, `node:sqlite` deja escapar el mensaje
 * crudo `database is locked` como error `internal`, que ni es del contrato ni dice que reintentar
 * baste. Devuelve `null` cuando el fallo no es de almacén y el llamador debe decidir otra cosa.
 *
 * La contención es transitoria, no pérdida de autorización ni corrupción: se marca `store-busy`
 * para que el consumidor sepa que puede reintentar la misma operación.
 */
export function storeFailure(error, { path = null } = {}) {
  if (isBusyError(error)) {
    return new RagError('store-busy', 'el almacén está ocupado por otra operación; reintenta', {
      details: { path, retryable: true },
      cause: error,
    });
  }
  if (isCorruptionError(error)) {
    return new RagError('store-corrupt', 'el fichero del almacén no es una base de datos utilizable', {
      details: { path },
      cause: error,
    });
  }
  return null;
}

/** La FTS debe ser externa y apuntar a `chunks`: si alguien la recreó interna, el diseño cambió. */
function ftsTableIsExternal(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'chunks_fts'").get();
  const sql = String(row?.sql ?? '');
  if (!/CREATE VIRTUAL TABLE/i.test(sql) || !/content\s*=\s*'chunks'/i.test(sql) || !/content_rowid\s*=\s*'id'/i.test(sql)) {
    throw new RagError('store-corrupt', 'chunks_fts no es una tabla externa sobre chunks', { details: { sql } });
  }
}

export function closeDatabase(db) {
  try { db.close(); } catch { /* doble cierre tolerable */ }
}

/** Abre, ejecuta y cierra pase lo que pase. Para una operación de herramienta, el handle no sobrevive. */
export function withDatabase(options, work) {
  const opened = openDatabase(options);
  try {
    return work(opened);
  } finally {
    closeDatabase(opened.db);
  }
}
