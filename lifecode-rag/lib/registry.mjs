/**
 * Registro Project-Aware (PA1): un `registry.sqlite3` por perfil con proyectos, bibliotecas,
 * raíces autorizadas y auditoría propia del registro.
 *
 * Reglas que este módulo mantiene:
 * - La integridad se comprueba al abrir: `application_id`, versión, tablas esperadas y cadena de
 *   auditoría. Un registro incoherente no se usa «a medias»: se cierra con `registry-corrupt`.
 * - `roots.path_key` es único global; el esquema impone además que la raíz pertenezca a un proyecto
 *   o biblioteca existente mediante disparadores.
 * - Crear un proyecto/biblioteca/raíz es una operación **humana**: `added_by` sólo admite
 *   `human`/`host`, y la función no acepta `model`.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { RagError } from './errors.mjs';
import { canonicalJson } from './audit.mjs';
import { withTransaction } from './db.mjs';
import { REGISTRY_APPLICATION_ID, REGISTRY_DDL, REGISTRY_MIGRATIONS, REGISTRY_VERSION } from './registry-schema.mjs';
import { registryPath } from './profile.mjs';
import {
  assertRootStructure,
  canonicalKey,
  classifyRootRegistration,
  findRootConflicts,
  inspectRoot,
} from './roots-structure.mjs';

const REGISTRY_TABLES = Object.freeze([
  'audit_registry',
  'grants',
  'libraries',
  'meta',
  'operation_steps',
  'operations',
  'pa_selection',
  'projects',
  'provision_intents',
  'roots',
  'session_scope',
  'sync_requests',
  'sync_state',
  'workspace_tracking',
]);

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0;
let sequence = 0;

/** Identificador con forma ULID (26 caracteres Crockford en mayúsculas). */
export function newId(prefix, now = Date.now()) {
  let time = Math.max(now, lastTime);
  if (time === lastTime) {
    sequence = (sequence + 1) % 0x1000;
    if (sequence === 0) time += 1;
  } else {
    sequence = 0;
  }
  lastTime = time;
  const timePart = Array.from({ length: 10 }, (_, index) => CROCKFORD[Math.floor(time / 32 ** (9 - index)) % 32]).join('');
  const random = randomBytes(16);
  let randomPart = '';
  for (let index = 0; index < 16; index += 1) randomPart += CROCKFORD[random[index] % 32];
  return `${prefix}${timePart}${randomPart}`;
}

/**
 * Clave de ruta canónica para comparar raíces sin depender de mayúsculas, separadores ni enlaces
 * (Windows). Desde PA4 canonicaliza con `realpath` cuando la ruta existe: dos rutas que apuntan a
 * la misma carpeta física producen la misma clave.
 */
export function pathKeyFor(path) {
  return canonicalKey(path);
}

export function registryTables(db) {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map((row) => row.name);
}

/**
 * Abre el registro del perfil. Con `create` inicializa un registro vacío; sin él, un registro
 * ausente es un error explícito, nunca un registro vacío implícito.
 */
export function openRegistry({ root, create = false, now = Date.now() } = {}) {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    throw new RagError('invalid-config', 'la raíz del perfil debe ser una ruta absoluta');
  }
  const path = registryPath(root);
  const exists = existsSync(path);
  if (!exists && !create) {
    throw new RagError('store-not-initialized', 'el registro del perfil no existe', { details: { root } });
  }
  if (create) mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    // La identidad del fichero se comprueba ANTES de tocar `journal_mode`: abrir en WAL crea
    // `-wal`/`-shm` y cambia el hash incluso cuando después se rechaza. Un SQLite ajeno no se toca.
    const fresh = registryTables(db).length === 0;
    if (!fresh) {
      const appId = Number(db.prepare('PRAGMA application_id').get().application_id);
      if (appId !== REGISTRY_APPLICATION_ID) {
        throw new RagError('registry-corrupt', 'el fichero de registro no es de LifeCode RAG', { details: { root } });
      }
    }
    db.exec('PRAGMA synchronous = FULL');

    if (fresh) {
      const appId = Number(db.prepare('PRAGMA application_id').get().application_id);
      if (appId !== 0 && appId !== REGISTRY_APPLICATION_ID) {
        throw new RagError('registry-corrupt', 'el fichero vacío declara otra aplicación', { details: { root, appId } });
      }
      const version = Number(db.prepare('PRAGMA user_version').get().user_version);
      if (version !== 0) {
        throw new RagError('registry-corrupt', 'el fichero vacío declara una versión de registro', { details: { root, version } });
      }
      if (!create) throw new RagError('store-not-initialized', 'el registro del perfil está vacío');
      db.exec('PRAGMA journal_mode = WAL');
      initializeRegistry(db, { root, now });
    } else {
      db.exec('PRAGMA journal_mode = WAL');
      // Un registro de una versión anterior se migra de forma ADITIVA antes de validarlo: sólo se
      // crean estructuras nuevas (v1 → v2 añade `pa_selection`), ninguna fila existente se toca.
      migrateRegistry(db, { root });
      assertRegistry(db, { root });
    }
    return { db, path, root };
  } catch (error) {
    db.close();
    throw error;
  }
}

function initializeRegistry(db, { root, now }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const statement of REGISTRY_DDL) db.exec(statement);
    db.exec(`PRAGMA application_id = ${REGISTRY_APPLICATION_ID}`);
    db.exec(`PRAGMA user_version = ${REGISTRY_VERSION}`);
    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    meta.run('registry_version', String(REGISTRY_VERSION));
    meta.run('created_at', String(now));
    meta.run('profile_root', root);
    meta.run('audit_head_seq', '0');
    meta.run('audit_head_hash', '');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw new RagError('internal', `no se pudo crear el registro: ${error.message}`, { cause: error });
  }
}

/**
 * Preflight de la exclusividad 1:1:1 (R1.1.5). Devuelve las filas que impedirían crear el índice
 * único; **no** elige propietario, no borra y no fusiona. La migración aborta si hay alguna.
 */
export function preflightExclusiveTracking(db) {
  const duplicates = db.prepare(`
    SELECT t.project_id, t.path_key, t.path, t.state, t.association, t.revision
      FROM workspace_tracking t
      JOIN (SELECT project_id FROM workspace_tracking
             WHERE project_id IS NOT NULL
             GROUP BY project_id HAVING COUNT(*) > 1) d
        ON d.project_id = t.project_id
     ORDER BY t.project_id, t.path_key`).all();
  return duplicates.map((row) => ({
    projectId: row.project_id,
    pathKey: row.path_key,
    path: row.path,
    state: row.state,
    association: row.association,
    revision: Number(row.revision),
  }));
}

/**
 * Lleva el registro a `REGISTRY_VERSION` con migraciones aditivas, o no hace nada si ya está al día.
 *
 * Se ejecuta dentro de `BEGIN IMMEDIATE` y vuelve a leer la versión dentro de la transacción: dos
 * procesos del mismo perfil (host y CLI) pueden abrir a la vez, y sólo uno migra; el otro encuentra
 * el registro ya migrado y sigue. Una versión superior a la soportada no se toca: la rechaza
 * `assertRegistry` con `store-version-unsupported`.
 */
function migrateRegistry(db, { root }) {
  const from = Number(db.prepare('PRAGMA user_version').get().user_version);
  if (!Number.isInteger(from) || from < 1 || from >= REGISTRY_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = Number(db.prepare('PRAGMA user_version').get().user_version);
    if (current >= REGISTRY_VERSION) {
      db.exec('COMMIT');
      return;
    }
    for (let target = current + 1; target <= REGISTRY_VERSION; target += 1) {
      // v4: el índice único no puede crearse sobre datos que ya lo violan. Se mide ANTES y, si hay
      // duplicados, se aborta la migración entera: el registro sigue en v3 y una persona decide.
      if (target === 4) {
        const duplicates = preflightExclusiveTracking(db);
        if (duplicates.length > 0) {
          throw new RagError('registry-migration-conflict',
            'hay proyectos con más de un workspace: la migración v4 no elige propietario', {
              details: {
                from: current,
                to: 4,
                duplicates,
                resolution: 'una persona decide qué workspace conserva cada memoria; después se reintenta la migración',
              },
            });
        }
      }
      for (const statement of REGISTRY_MIGRATIONS[target] ?? []) db.exec(statement);
    }
    db.exec(`PRAGMA user_version = ${REGISTRY_VERSION}`);
    db.prepare(`INSERT INTO meta (key, value) VALUES ('registry_version', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(REGISTRY_VERSION));
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* la transacción ya no estaba abierta */ }
    // Una condición de dominio ya clasificada (conflicto de migración) se propaga tal cual: envolverla
    // en `registry-corrupt` diría que el fichero está dañado y ocultaría la decisión que hace falta.
    if (error instanceof RagError) throw error;
    throw new RagError('registry-corrupt', 'no se pudo migrar el registro del perfil', {
      details: { root, from, to: REGISTRY_VERSION },
      cause: error,
    });
  }
}

function assertRegistry(db, { root }) {
  const appId = Number(db.prepare('PRAGMA application_id').get().application_id);
  if (appId !== REGISTRY_APPLICATION_ID) {
    throw new RagError('registry-corrupt', 'el fichero de registro no es de LifeCode RAG', { details: { root } });
  }
  const version = Number(db.prepare('PRAGMA user_version').get().user_version);
  if (!Number.isInteger(version) || version < 1) {
    throw new RagError('registry-corrupt', 'versión de registro inválida', { details: { version } });
  }
  if (version > REGISTRY_VERSION) {
    throw new RagError('store-version-unsupported', 'el registro fue escrito por una versión más nueva', {
      details: { found: version, supported: REGISTRY_VERSION },
    });
  }
  const tables = new Set(registryTables(db));
  const missing = REGISTRY_TABLES.filter((name) => !tables.has(name));
  if (missing.length > 0) {
    throw new RagError('registry-corrupt', 'al registro le faltan tablas', { details: { missing } });
  }
  const check = db.prepare('PRAGMA quick_check').all();
  if (check.length !== 1 || check[0].quick_check !== 'ok') {
    throw new RagError('registry-corrupt', 'quick_check del registro falló', { details: { check } });
  }
  const chain = verifyRegistryAudit(db);
  if (!chain.ok) {
    throw new RagError('registry-corrupt', 'la cadena de auditoría del registro no verifica', { details: chain });
  }
}

export function closeRegistry(db) {
  try {
    db.close();
  } catch {
    // cerrar dos veces no es un fallo
  }
}

/**
 * Garantiza que el perfil tenga registro. Devuelve `{ path, created, tables, version }`.
 *
 * `D-IMPL-12`: el registro es el **contenedor** de todo lo demás (proyectos, raíces, selección,
 * seguimiento), así que se crea al cargar el plugin en vez de esperar a que alguien ejecute la
 * migración. Idempotente por construcción: `openRegistry` sólo escribe cuando el fichero no existe
 * (o está vacío); con un registro ya en `REGISTRY_VERSION` abre, valida y no toca nada. `created`
 * dice si esta llamada fue la que lo creó.
 *
 * Crea el contenedor, **nunca** contenido: ni proyectos, ni bibliotecas, ni raíces, ni filas de
 * seguimiento. Los errores reales (permisos, registro corrupto, versión más nueva) se propagan tal
 * cual: quien llama decide si eso impide arrancar, en lugar de tragárselos aquí.
 */
export function ensureRegistry({ root, now = Date.now() } = {}) {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    throw new RagError('invalid-config', 'la raíz del perfil debe ser una ruta absoluta');
  }
  const path = registryPath(root);
  // Un fichero de cero bytes no es un registro: SQLite lo inicializa igual que uno ausente y el
  // resumen tiene que decirlo. (Al cerrar la conexión, WAL deja el contenido en el fichero.)
  const created = !existsSync(path) || statSync(path).size === 0;
  const { db } = openRegistry({ root, create: true, now });
  try {
    return {
      path,
      created,
      tables: registryTables(db),
      version: Number(db.prepare('PRAGMA user_version').get().user_version),
    };
  } finally {
    closeRegistry(db);
  }
}

function requireName(name) {
  if (typeof name !== 'string' || name.trim() === '' || name.trim().length > 120) {
    throw new RagError('invalid-argument', 'el nombre debe tener entre 1 y 120 caracteres');
  }
  return name.trim();
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setMeta(db, key, value) {
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
  return value;
}

/**
 * Crea un proyecto de conocimiento. `id` permite conservar una identidad **reservada** por una
 * intención de provisión (`newId('prj_')` calculado antes del INSERT y persistido en
 * `provision_intents`): si el proceso muere entre reservar y crear, la reanudación reutiliza el mismo
 * id en vez de inventar otro.
 */
export function createProject(db, { name, now = Date.now(), id = null } = {}) {
  const projectId = id ?? newId('prj_', now);
  if (typeof projectId !== 'string' || !/^prj_[0-9A-HJKMNP-TV-Z]{26}$/.test(projectId)) {
    throw new RagError('invalid-argument', 'el id reservado del proyecto no tiene forma válida', {
      details: { id: typeof projectId === 'string' ? projectId : null },
    });
  }
  db.prepare(`INSERT INTO projects (id, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)`)
    .run(projectId, requireName(name), now, now);
  return { id: projectId, name: name.trim(), createdAt: now };
}

export function createLibrary(db, { name, now = Date.now() } = {}) {
  const id = newId('lib_', now);
  db.prepare(`INSERT INTO libraries (id, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)`)
    .run(id, requireName(name), now, now);
  return { id, name: name.trim(), createdAt: now };
}

/**
 * Añade una raíz autorizada. La ruta debe ser absoluta y existir; la pertenencia al proyecto o
 * biblioteca la valida el disparador del esquema.
 */
/**
 * Añade una raíz autorizada. Desde PA4 la estructura se valida **antes** de escribir: la ruta debe
 * existir, ser un directorio real (no enlace/junction/reparse) y no solaparse con ninguna raíz ya
 * registrada, ni duplicarla. La pertenencia al proyecto o biblioteca la valida el disparador.
 */
export function addRoot(db, {
  scopeKind, scopeId, path, addedBy = 'human', now = Date.now(), allowNested = false,
} = {}) {
  if (!['prj', 'lib'].includes(scopeKind)) throw new RagError('invalid-argument', 'scopeKind inválido');
  if (typeof scopeId !== 'string' || !scopeId.startsWith(scopeKind === 'prj' ? 'prj_' : 'lib_')) {
    throw new RagError('invalid-argument', 'scopeId no corresponde al tipo de ámbito');
  }
  if (!['human', 'host'].includes(addedBy)) {
    throw new RagError('invalid-argument', 'sólo una persona o el host pueden autorizar raíces');
  }
  if (typeof path !== 'string' || path.trim() === '' || !isAbsolute(path)) {
    throw new RagError('invalid-argument', 'la raíz debe ser una ruta absoluta');
  }
  const info = assertRootStructure(inspectRoot(path));
  const existing = listRoots(db);
  const verdict = classifyRootRegistration({ key: info.key, path: info.canonical }, existing, { allowNested });
  if (!verdict.ok) {
    throw new RagError(verdict.code, verdict.message, {
      details: {
        path: info.canonical,
        relation: verdict.conflict.relation,
        conflictsWith: {
          scopeKind: verdict.conflict.root.scope_kind,
          scopeId: verdict.conflict.root.scope_id,
          path: verdict.conflict.root.path,
        },
      },
    });
  }

  const id = newId('rt_', now);
  try {
    db.prepare(`INSERT INTO roots (id, scope_kind, scope_id, path, path_key, state, added_at, added_by)
                VALUES (?, ?, ?, ?, ?, 'authorized', ?, ?)`)
      .run(id, scopeKind, scopeId, info.canonical, info.key, now, addedBy);
  } catch (error) {
    if (String(error.message).includes('UNIQUE') || String(error.message).includes('unique')) {
      throw new RagError('invalid-argument', 'esa ruta ya está registrada en este perfil', {
        details: { path: info.canonical },
        cause: error,
      });
    }
    throw error;
  }
  return { id, scopeKind, scopeId, path: info.canonical, pathKey: info.key };
}

export function getProject(db, id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) ?? null;
}

export function listRoots(db, { scopeKind, scopeId } = {}) {
  if (scopeKind && scopeId) {
    return db.prepare('SELECT * FROM roots WHERE scope_kind = ? AND scope_id = ? ORDER BY path').all(scopeKind, scopeId);
  }
  return db.prepare('SELECT * FROM roots ORDER BY path').all();
}

/* ------------------------------------------------------------------ administración de proyectos
 *
 * ACP-07 F1. Las cinco operaciones son de **registro**, no de contenido: ninguna abre el almacén de
 * ámbito (`scopes/<id>/rag.sqlite3`), así que archivar o quitar una raíz no puede tocar fuentes ni
 * ficheros del usuario.
 *
 * Todas escriben dentro de una transacción `IMMEDIATE` (o reutilizan la del llamador, igual que
 * `appendRegistryAudit`) y dejan su entrada en la cadena de auditoría del registro.
 */

/** Ejecuta `work` en una transacción sólo si el llamador no está ya dentro de una. */
function transactional(db, work) {
  return db.isTransaction ? work() : withTransaction(db, work, { immediate: true });
}

function requireActor(actor) {
  if (!['human', 'host'].includes(actor)) {
    throw new RagError('invalid-argument', 'sólo una persona o el host pueden administrar proyectos');
  }
  return actor;
}

/** Fila del proyecto o `project-not-found` (404). */
function requireProjectRow(db, id) {
  if (typeof id !== 'string' || !id.startsWith('prj_')) {
    throw new RagError('invalid-argument', 'id no es un identificador de proyecto', {
      details: { reason: 'invalid-field', field: 'project' },
    });
  }
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!row) {
    throw new RagError('project-not-found', 'el proyecto no existe en este perfil', { details: { project: id } });
  }
  return row;
}

function projectRow(db, id) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return row
    ? {
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      archivedAt: row.archived_at === null ? null : Number(row.archived_at),
    }
    : null;
}

/** Cambia el nombre de un proyecto. No toca raíces, selección ni almacenes. */
export function updateProject(db, { id, name, now = Date.now(), actor = 'human' } = {}) {
  requireActor(actor);
  const nextName = requireName(name);
  return transactional(db, () => {
    const before = requireProjectRow(db, id);
    if (before.name === nextName) {
      return { changed: false, project: projectRow(db, id) };
    }
    db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(nextName, now, id);
    appendRegistryAudit(db, {
      at: now,
      actor,
      sessionId: null,
      action: 'project.update',
      target: id,
      outcome: 'ok',
      detail: { before: { name: before.name }, after: { name: nextName } },
    });
    return { changed: true, project: projectRow(db, id) };
  });
}

/**
 * Archiva un proyecto (eliminación lógica). No borra la fila, ni las raíces, ni el almacén del ámbito:
 * sólo cambia `status` y `archived_at`, que el esquema obliga a mantener coherentes.
 *
 * Se niega si la selección del perfil apunta a este proyecto: mover o limpiar la selección es
 * responsabilidad de `archiveProjectWithSelection` (lib/selection.mjs), que hace ambas cosas en una
 * sola transacción. Así no puede quedar una selección colgando por llamar a la función suelta.
 */
export function archiveProject(db, { id, now = Date.now(), actor = 'human' } = {}) {
  requireActor(actor);
  return transactional(db, () => {
    const row = requireProjectRow(db, id);
    if (row.status === 'archived') {
      return { changed: false, project: projectRow(db, id) };
    }
    const selected = db.prepare('SELECT project_id FROM pa_selection WHERE selection_key = ?').get('profile');
    if (selected && selected.project_id === id) {
      throw new RagError('invalid-argument', 'el proyecto está seleccionado: usa archiveProjectWithSelection', {
        details: { reason: 'selection-attached', project: id },
      });
    }
    db.prepare("UPDATE projects SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, id);
    appendRegistryAudit(db, {
      at: now,
      actor,
      sessionId: null,
      action: 'project.archive',
      target: id,
      outcome: 'ok',
      detail: { name: row.name, roots: db.prepare("SELECT COUNT(*) AS n FROM roots WHERE scope_kind='prj' AND scope_id = ?").get(id).n },
    });
    return { changed: true, project: projectRow(db, id) };
  });
}

/** Devuelve un proyecto archivado a `active`. Conserva identidad, raíces y referencias RAG. */
export function restoreProject(db, { id, now = Date.now(), actor = 'human' } = {}) {
  requireActor(actor);
  return transactional(db, () => {
    const row = requireProjectRow(db, id);
    if (row.status === 'active') {
      return { changed: false, project: projectRow(db, id) };
    }
    db.prepare("UPDATE projects SET status = 'active', archived_at = NULL, updated_at = ? WHERE id = ?")
      .run(now, id);
    appendRegistryAudit(db, {
      at: now,
      actor,
      sessionId: null,
      action: 'project.restore',
      target: id,
      outcome: 'ok',
      detail: { name: row.name, archivedAt: row.archived_at === null ? null : Number(row.archived_at) },
    });
    return { changed: true, project: projectRow(db, id) };
  });
}

/**
 * Quita una raíz del registro. Sólo borra la fila: no toca ficheros del usuario ni fuentes RAG.
 *
 * Guarda: no deja un proyecto activo sin ninguna raíz salvo `allowEmpty`, porque a partir de ahí sus
 * herramientas dejarían de resolver sin un motivo evidente.
 */
export function removeRoot(db, { rootId, allowEmpty = false, now = Date.now(), actor = 'human' } = {}) {
  requireActor(actor);
  return transactional(db, () => {
    const row = typeof rootId === 'string'
      ? db.prepare('SELECT * FROM roots WHERE id = ?').get(rootId)
      : null;
    if (!row) {
      throw new RagError('source-not-found', 'la raíz no existe en este perfil', {
        details: { root: typeof rootId === 'string' ? rootId : null },
      });
    }
    const siblings = db.prepare('SELECT COUNT(*) AS n FROM roots WHERE scope_kind = ? AND scope_id = ?')
      .get(row.scope_kind, row.scope_id).n;
    if (siblings <= 1 && !allowEmpty) {
      throw new RagError('invalid-argument', 'es la última raíz del ámbito: pide allowEmpty para dejarlo sin raíces', {
        details: { reason: 'last-root', scopeId: row.scope_id, path: row.path },
      });
    }
    db.prepare('DELETE FROM roots WHERE id = ?').run(row.id);
    appendRegistryAudit(db, {
      at: now,
      actor,
      sessionId: null,
      action: 'root.remove',
      target: row.id,
      outcome: 'ok',
      detail: { scopeKind: row.scope_kind, scopeId: row.scope_id, path: row.path },
    });
    return { removed: { id: row.id, scopeKind: row.scope_kind, scopeId: row.scope_id, path: row.path } };
  });
}

/**
 * Listado de proyectos con su estado y el recuento de raíces. Es la consulta que comparten la CLI y
 * la API del panel; no depende del descubrimiento, así que un proyecto registrado sigue apareciendo
 * aunque su carpeta ya no se descubra.
 */
export function listProjects(db, { status = 'active' } = {}) {
  if (status !== 'active' && status !== 'archived' && status !== 'all') {
    throw new RagError('invalid-argument', 'status debe ser active, archived o all', { details: { status } });
  }
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM projects ORDER BY created_at, id').all()
    : db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY created_at, id').all(status);
  const counts = new Map(
    db.prepare(`SELECT scope_id, COUNT(*) AS total, SUM(state = 'authorized') AS authorized
      FROM roots WHERE scope_kind = 'prj' GROUP BY scope_id`).all()
      .map((row) => [row.scope_id, { total: Number(row.total), authorized: Number(row.authorized ?? 0) }]),
  );
  return {
    projects: rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      archivedAt: row.archived_at === null ? null : Number(row.archived_at),
      roots: counts.get(row.id) ?? { total: 0, authorized: 0 },
    })),
  };
}

function registryAuditPayload(entry) {
  return {
    at: Number(entry.at),
    actor: entry.actor,
    sessionId: entry.sessionId ?? null,
    action: entry.action,
    target: entry.target,
    outcome: entry.outcome,
    detail: normalizeDetail(entry.detail),
  };
}

/**
 * El detalle se guarda siempre como texto JSON: así el hash es estable y no depende de que cada
 * llamador se acuerde de serializar (un objeto pasado crudo rompía el enlace de SQLite).
 */
function normalizeDetail(detail) {
  if (detail === undefined || detail === null) return null;
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

export function registryAuditHash(prevHash, entry) {
  return createHash('sha256').update(`${prevHash}\n${canonicalJson(registryAuditPayload(entry))}`, 'utf8').digest('hex');
}

/**
 * Añade una entrada a la cadena de auditoría del registro.
 *
 * La lectura de la cabeza, el cálculo del hash, el `INSERT` y la actualización de `meta` van en la
 * MISMA transacción `IMMEDIATE`: dos conexiones del perfil (host y CLI, por ejemplo) se serializan y
 * la cadena no puede quedar con un `prev_hash` que no cuadre —lo que dejaría el perfil entero
 * inservible, porque `assertRegistry` verifica la cadena al abrir—. Si el llamador ya está en una
 * transacción se reutiliza esa: abrir otra dentro fallaría.
 */
export function appendRegistryAudit(db, entry) {
  const append = () => {
    const head = Number(db.prepare(`SELECT value FROM meta WHERE key='audit_head_seq'`).get()?.value ?? '0');
    let prevHash = '0'.repeat(64);
    if (head > 0) {
      const row = db.prepare('SELECT hash FROM audit_registry WHERE seq = ?').get(head);
      if (!row) throw new RagError('registry-corrupt', `falta la entrada de auditoría del registro ${head}`);
      prevHash = row.hash;
    }
    const payload = registryAuditPayload(entry);
    const hash = registryAuditHash(prevHash, payload);
    const info = db.prepare(`INSERT INTO audit_registry (at, actor, session_id, action, target, outcome, detail, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      payload.at, payload.actor, payload.sessionId, payload.action, payload.target,
      payload.outcome, payload.detail, prevHash, hash,
    );
    const seq = Number(info.lastInsertRowid);
    db.prepare(`UPDATE meta SET value=? WHERE key='audit_head_seq'`).run(String(seq));
    db.prepare(`UPDATE meta SET value=? WHERE key='audit_head_hash'`).run(hash);
    return { seq, hash };
  };
  return db.isTransaction ? append() : withTransaction(db, append, { immediate: true });
}

export function verifyRegistryAudit(db) {
  const verify = () => {
    const rows = db.prepare(`SELECT seq, at, actor, session_id, action, target, outcome, detail, prev_hash, hash
      FROM audit_registry ORDER BY seq ASC`).all();
    let prevHash = '0'.repeat(64);
    for (const row of rows) {
      if (row.prev_hash !== prevHash) return { ok: false, brokenAt: row.seq, reason: 'prev-hash' };
      const expected = registryAuditHash(prevHash, {
        at: row.at,
        actor: row.actor,
        sessionId: row.session_id,
        action: row.action,
        target: row.target,
        outcome: row.outcome,
        detail: row.detail,
      });
      if (expected !== row.hash) return { ok: false, brokenAt: row.seq, reason: 'hash' };
      prevHash = row.hash;
    }
    const head = Number(db.prepare(`SELECT value FROM meta WHERE key='audit_head_seq'`).get()?.value ?? '0');
    if (head !== rows.length) return { ok: false, brokenAt: head, reason: 'head' };
    return { ok: true, count: rows.length };
  };
  // Una lectura sin transacción puede ver las filas y después un `audit_head_seq` ya avanzado por
  // otro proceso: falso `registry-corrupt`. El snapshot de una transacción de lectura elimina la
  // carrera sin bloquear escritores.
  return db.isTransaction ? verify() : withTransaction(db, verify, { immediate: false });
}

/** Comprobación de integridad completa (usada por el informe y las pruebas). */
export function registryIntegrity(db) {
  const foreign = db.prepare('PRAGMA foreign_key_check').all();
  const roots = listRoots(db);
  const rootConflicts = findRootConflicts(roots);
  return {
    quickCheck: db.prepare('PRAGMA quick_check').all().map((row) => row.quick_check).join(','),
    foreignKeys: foreign.length,
    tables: registryTables(db).length,
    roots: roots.length,
    rootConflicts: rootConflicts.map(({ left, right, relation }) => ({
      relation,
      left: { scopeKind: left.scope_kind, scopeId: left.scope_id, path: left.path },
      right: { scopeKind: right.scope_kind, scopeId: right.scope_id, path: right.path },
    })),
    audit: verifyRegistryAudit(db),
  };
}
