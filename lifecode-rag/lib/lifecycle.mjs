/**
 * R1.2 · Ciclo de vida de la memoria por proyecto de trabajo.
 *
 * Este módulo **orquesta**; no absorbe. Usa las piezas que ya existen:
 * `registry` (proyectos y raíces), `trusted-roots` (consentimiento), `scope-stores` (almacén),
 * `tracking-store` (asociación con CAS), `operations` (journal durable), `provision-store`
 * (intención y procedencia) y `sync-scheduler` (cola de sincronización).
 *
 * Reglas que sostiene:
 * - 1 proyecto de trabajo = 1 proyecto de conocimiento = 1 almacén, por dato (índice único v4).
 * - La identidad se reserva con `newId('prj_')` y se **persiste** antes de crear el proyecto.
 * - Cada paso es idempotente y deja rastro en `operation_steps`; una caída se reanuda con evidencia.
 * - El consentimiento es de la **ruta exacta** y su procedencia (`consent_trust_key`,
 *   `consent_root_id`) es lo único que autoriza a revocar (Q08). `addedBy` no prueba nada.
 * - OFF no se toca aquí: apagar el seguimiento no revoca, no borra y no cambia `project_id`.
 *
 * Todo es síncrono: abrir un SQLite de Node es síncrono y no hay red. La indexación (que sí es
 * asíncrona y presupuestada) vive en `sync.mjs` y se encola, nunca se ejecuta dentro de este acto.
 */

import { basename, resolve } from 'node:path';

import { RagError } from './errors.mjs';
import { withTransaction } from './db.mjs';
import {
  addRoot,
  appendRegistryAudit,
  archiveProject,
  createProject,
  getProject,
  listRoots,
  newId,
} from './registry.mjs';
import { assertRootStructure, inspectRoot } from './roots-structure.mjs';
import { addTrustedRoot, deleteTrustedRootByKey, listTrustedRoots, removeTrustedRootByKey } from './trusted-roots.mjs';
import { openScopeStore, scopeStoreExists } from './scope-stores.mjs';
import {
  associateTracking,
  countTracking,
  listTracking,
  readTracking,
  removeTracking,
} from './tracking-store.mjs';
import {
  beginOperation,
  finishOperation,
  getOperation,
  listInterruptedOperations,
  listSteps,
  recordStep,
} from './operations.mjs';
import {
  finishProvisionIntent,
  getProvisionIntent,
  getSyncRequest,
  listOpenIntents,
  listProvisionIntents,
  markIntentRevoked,
  openProvisionIntent,
  recordProvisionedWorkspace,
  requestSync,
  setIntentConsent,
  setIntentProject,
} from './provision-store.mjs';

export const PROVISION_KIND = 'provision';
export const MOVE_KIND = 'move';
export const CLEANUP_KIND = 'cleanup';
export const REKEY_KIND = 'rekey';
export const PROVISION_MESSAGE = 'Memoria lista. Ya puedes indexar';
const RETRYABLE_CODES = Object.freeze(['store-busy', 'scope-store-unavailable', 'sync-root-unavailable']);
// Un conflicto ya clasificado se devuelve tal cual: envolverlo en `provisioning-failed`/`move-failed`
// escondería el código que el cliente necesita para resolverlo (409 de CAS, exclusividad, solape...).
const PASSTHROUGH_CODES = Object.freeze([
  'revision-conflict', 'memory-exclusive', 'root-overlap', 'move-conflict',
  'workspace-missing', 'scope-forbidden', 'scope-store-corrupt', 'project-not-found', 'not-found',
]);

function isRetryable(error) {
  return RETRYABLE_CODES.includes(error?.code);
}

function rethrowClassified(error) {
  if (error instanceof RagError && PASSTHROUGH_CODES.includes(error.code)) throw error;
}

/** Marca de vida para no tratar como huérfana la operación de otro proceso vivo. */
function operationDetail(operation) {
  try { return operation?.detail ? JSON.parse(operation.detail) : null; } catch { return null; }
}

/** Actualiza campos del detalle sin perder los que ya tenía la operación. */
function mergeOperationDetail(db, operationId, patch) {
  const operation = getOperation(db, operationId);
  if (!operation) return;
  const detail = operationDetail(operation) ?? {};
  db.prepare('UPDATE operations SET detail = ? WHERE id = ?')
    .run(JSON.stringify({ ...detail, ...patch }), operationId);
}

function operationOwnerAlive(operation) {
  const pid = Number(operationDetail(operation)?.owner_pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM significa que existe pero no podemos señalizarlo; ESRCH, que ya no está.
    return error?.code === 'EPERM';
  }
}

function stepsDone(db, operationId) {
  return new Set(listSteps(db, operationId).filter((step) => step.state === 'done').map((step) => step.step));
}

function effectKey(pathKey, step) {
  return `provision:${pathKey}:${step}`;
}

/**
 * Encola el primer pase / la sincronización de reactivación. Es un efecto **deseable pero no
 * esencial**: si la cola no se puede escribir, la memoria sigue lista y el fallo queda auditado; no
 * se convierte una provisión correcta en un `provisioning-failed` por no poder encolar trabajo.
 */
function enqueueSync(db, { projectId, reason, now }) {
  try {
    requestSync(db, { scopeKind: 'prj', scopeId: projectId, reason, now });
    return true;
  } catch (error) {
    try {
      appendRegistryAudit(db, {
        at: now, actor: 'host', sessionId: null, action: 'sync.enqueue.failed', target: projectId,
        outcome: 'failed', detail: { reason, code: error?.code ?? 'internal' },
      });
    } catch { /* la auditoría tampoco puede tapar el resultado de la provisión */ }
    return false;
  }
}

/** Ruta canónica del workspace, traducida a los códigos del contrato cuando no se puede leer. */
function workspaceInfo(path) {
  try {
    return assertRootStructure(inspectRoot(path));
  } catch (error) {
    if (error instanceof RagError && error.code === 'source-unreadable') {
      throw new RagError('workspace-missing', 'la carpeta del workspace no existe o no se puede leer', {
        details: { path, reason: 'unreadable', retryable: false },
        cause: error,
      });
    }
    throw error;
  }
}

function projectRow(db, projectId) {
  const project = getProject(db, projectId);
  if (!project) {
    throw new RagError('project-not-found', 'el proyecto de la memoria no existe en este perfil', {
      details: { project: projectId },
    });
  }
  if (project.status !== 'active') {
    throw new RagError('invalid-argument', 'el proyecto de la memoria está archivado', {
      details: { reason: 'project-not-active', project: projectId },
    });
  }
  return project;
}

/** Raíz exacta registrada para la clave del workspace, o `null`. */
function exactRoot(db, pathKey) {
  return db.prepare('SELECT * FROM roots WHERE path_key = ?').get(pathKey) ?? null;
}

function overlaps(leftKey, rightKey) {
  return leftKey === rightKey
    || leftKey.startsWith(`${rightKey}/`)
    || rightKey.startsWith(`${leftKey}/`);
}

/**
 * Decide la identidad destino **sin inferir por nombre ni por parecido**:
 * - si la fila ya tiene proyecto, ése manda;
 * - si hay una raíz exacta de un proyecto, ese proyecto es el dueño de la ruta (una ruta no puede
 *   tener dos memorias) y se reutiliza;
 * - si no, se reserva una identidad nueva.
 */
function resolveTargetProject(db, { row, pathKey, rootAtPath }) {
  let projectId = row.projectId ?? null;
  if (rootAtPath) {
    if (rootAtPath.scope_kind !== 'prj') {
      throw new RagError('memory-exclusive', 'esa ruta ya pertenece a una biblioteca y no puede ser un workspace', {
        details: { reason: 'root-is-library', scopeId: rootAtPath.scope_id, path: rootAtPath.path, retryable: false },
      });
    }
    if (projectId === null) projectId = rootAtPath.scope_id;
    else if (projectId !== rootAtPath.scope_id) {
      throw new RagError('memory-exclusive', 'la ruta ya está registrada por otro proyecto', {
        details: {
          reason: 'root-owner-conflict', projectId, rootProjectId: rootAtPath.scope_id,
          path: rootAtPath.path, retryable: false,
        },
      });
    }
  }
  return projectId;
}

/** Raíz que cubre la ruta: exacta, ancestro o descendiente. Devuelve la relación. */
function coveringRoot(db, pathKey, projectId) {
  for (const root of listRoots(db)) {
    if (!overlaps(root.path_key, pathKey)) continue;
    if (root.path_key === pathKey) return { root, relation: 'exact' };
    if (pathKey.startsWith(`${root.path_key}/`)) {
      return { root, relation: root.scope_kind === 'prj' && root.scope_id === projectId ? 'ancestor-own' : 'ancestor-other' };
    }
    return { root, relation: root.scope_kind === 'prj' && root.scope_id === projectId ? 'descendant-own' : 'descendant-other' };
  }
  return null;
}

/* ------------------------------------------------------------------ estado derivado (Q-01) */

function indexSummary({ request, counts }) {
  return {
    state: request?.state ?? 'idle',
    reason: request?.reason ?? null,
    operationId: request?.operationId ?? null,
    lastFinishedAt: request?.finishedAt ?? null,
    lastError: request?.errorCode ?? null,
    sources: Number(counts?.total ?? 0),
    present: Number(counts?.present ?? 0),
    missing: Number(counts?.missing ?? 0),
    unreadable: Number(counts?.unreadable ?? 0),
  };
}

function buildMemory({ db, row, intent, project, storePresent, request, counts }) {
  const provisioned = Boolean(project && project.status === 'active' && storePresent && row.association === 'explicit');
  const state = intent?.state === 'open' && row.state === 'on'
    ? 'provisioning'
    : project && project.status !== 'active'
      ? 'archived'
      : provisioned
        ? 'ready'
        : project && !storePresent
          ? 'store-missing'
          : project
            ? 'incomplete'
            : 'none';
  const hasProvenance = Boolean(intent && (intent.consentTrustKey !== null || intent.consentRootId !== null));
  let canRevokeReason = null;
  if (!intent) canRevokeReason = 'no-intent';
  else if (intent.revokedAt) canRevokeReason = 'already-revoked';
  else if (intent.state === 'open') canRevokeReason = 'provisioning';
  else if (!hasProvenance) canRevokeReason = 'no-provenance';
  else if (intent.state !== 'done' && intent.state !== 'abandoned') canRevokeReason = 'no-provenance';
  else if (!project || project.status !== 'active') canRevokeReason = 'project-inactive';
  const canRevoke = canRevokeReason === null;
  return {
    state,
    projectId: row.projectId ?? null,
    projectStatus: project?.status ?? null,
    association: row.association,
    store: project ? (storePresent ? 'present' : 'absent') : 'absent',
    intent: intent?.state ?? null,
    operationId: intent?.operationId ?? null,
    consent: {
      trust: intent?.consentTrustKey ?? null,
      root: intent?.consentRootId ?? null,
      revokedAt: intent?.revokedAt ?? null,
    },
    canRevoke: canRevoke,
    canRevokeReason: canRevokeReason,
    cleanup: pendingCleanupFor(db, row.projectId ?? null),
    rekey: pendingRekeyFor(db, row.projectId ?? null),
    index: indexSummary({ request, counts }),
  };
}

const EMPTY_COUNTS = { total: 0, present: 0, missing: 0, unreadable: 0 };

/**
 * Estado de memoria de varias filas, con lecturas **por lote**: una consulta de intenciones, una de
 * proyectos, una de la cola y una de `sync_state`; sólo `scopeStoreExists` es por proyecto (es un
 * `existsSync`, no abre el SQLite: abrir un WAL podría crear sidecars en una ruta de lectura).
 */
export function memoryMapForRows(db, { profileRoot, rows = [] } = {}) {
  const map = new Map();
  if (rows.length === 0) return map;
  const intents = new Map(listProvisionIntents(db).map((intent) => [intent.pathKey, intent]));
  const projectIds = [...new Set(rows.map((row) => row.projectId).filter((id) => typeof id === 'string' && id !== ''))];
  const projects = new Map();
  const requests = new Map();
  const storePresent = new Map();
  const counts = new Map();
  for (const projectId of projectIds) {
    projects.set(projectId, getProject(db, projectId));
    requests.set(projectId, getSyncRequest(db, { scopeKind: 'prj', scopeId: projectId }));
    storePresent.set(projectId, scopeStoreExists(profileRoot, projectId));
  }
  if (projectIds.length > 0) {
    const placeholders = projectIds.map(() => '?').join(',');
    const rowsCounted = db.prepare(`SELECT scope_id,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END) AS missing,
        SUM(CASE WHEN status = 'unreadable' THEN 1 ELSE 0 END) AS unreadable
      FROM sync_state WHERE scope_kind = 'prj' AND scope_id IN (${placeholders}) GROUP BY scope_id`)
      .all(...projectIds);
    for (const row of rowsCounted) counts.set(row.scope_id, row);
  }
  for (const row of rows) {
    const projectId = row.projectId ?? null;
    map.set(row.pathKey, buildMemory({
      db,
      row,
      intent: intents.get(row.pathKey) ?? null,
      project: projectId ? projects.get(projectId) ?? null : null,
      storePresent: projectId ? storePresent.get(projectId) === true : false,
      request: projectId ? requests.get(projectId) ?? null : null,
      counts: projectId ? counts.get(projectId) ?? EMPTY_COUNTS : EMPTY_COUNTS,
    }));
  }
  return map;
}

/** Estado de memoria de una fila. */
export function memoryForTracking(db, { profileRoot, row } = {}) {
  if (!row) return null;
  return memoryMapForRows(db, { profileRoot, rows: [row] }).get(row.pathKey) ?? null;
}

/**
 * Resumen del eje de memoria para el retrato del perfil (Q-01). Se calcula sobre las filas de
 * seguimiento, que son las que pueden tener memoria; un proyecto creado por administración y todavía
 * sin seguimiento no aparece aquí (no es un workspace seguido) y no se cuenta como cero memorias.
 */
export function memorySummary(db, { profileRoot, limit = 1_000 } = {}) {
  const rows = listTracking(db, { limit });
  const total = countTracking(db).total;
  const map = memoryMapForRows(db, { profileRoot, rows });
  const counts = {
    tracked: total,
    sampled: rows.length,
    truncated: rows.length < total,
    ready: 0, provisioning: 0, none: 0, incomplete: 0, storeMissing: 0, archived: 0,
  };
  const index = { queued: 0, running: 0, failed: 0 };
  for (const row of rows) {
    const memory = map.get(row.pathKey);
    if (!memory) continue;
    if (memory.state === 'ready') counts.ready += 1;
    else if (memory.state === 'provisioning') counts.provisioning += 1;
    else if (memory.state === 'none') counts.none += 1;
    else if (memory.state === 'store-missing') counts.storeMissing += 1;
    else if (memory.state === 'archived') counts.archived += 1;
    else counts.incomplete += 1;
    if (memory.index.state === 'queued') index.queued += 1;
    else if (memory.index.state === 'running') index.running += 1;
    else if (memory.index.state === 'failed') index.failed += 1;
  }
  return { ...counts, index };
}

/* ------------------------------------------------------------------ provisionamiento */

/** Valida la carpeta sin escribir nada. La API la usa antes de crear la fila de seguimiento. */
export function assertWorkspaceProvisionable(path) {
  const info = workspaceInfo(path);
  return { path: info.canonical, pathKey: info.key };
}

/**
 * Conflictos que deben detener la provisión ANTES del primer efecto. Es la misma regla que aplican
 * los pasos (defensa en profundidad), pero adelantada para que un rechazo no deje trust, proyecto ni
 * almacén a medio crear.
 */
function assertProvisionPreflight(db, { pathKey, targetProjectId }) {
  const exact = exactRoot(db, pathKey);
  if (exact) {
    if (exact.scope_kind !== 'prj') {
      throw new RagError('memory-exclusive', 'esa ruta ya pertenece a una biblioteca', {
        details: { reason: 'root-is-library', scopeId: exact.scope_id, path: exact.path, retryable: false },
      });
    }
    if (targetProjectId && exact.scope_id !== targetProjectId) {
      throw new RagError('memory-exclusive', 'la ruta ya está registrada por otro proyecto', {
        details: {
          reason: 'root-owner-conflict', projectId: targetProjectId,
          rootProjectId: exact.scope_id, path: exact.path, retryable: false,
        },
      });
    }
    return;
  }
  if (!targetProjectId) return;
  const project = getProject(db, targetProjectId);
  if (project && project.status !== 'active') {
    throw new RagError('invalid-argument', 'el proyecto de la memoria está archivado', {
      details: { reason: 'project-not-active', project: targetProjectId, retryable: false },
    });
  }
  const covering = coveringRoot(db, pathKey, targetProjectId);
  if (covering && covering.relation === 'ancestor-own') return;
  if (covering) {
    throw new RagError('root-overlap', 'la ruta se solapa con una raíz de otro ámbito', {
      details: {
        reason: covering.relation, path: covering.root.path,
        scopeKind: covering.root.scope_kind, scopeId: covering.root.scope_id, retryable: false,
      },
    });
  }
  const otherRoots = listRoots(db).filter((row) => row.scope_kind === 'prj'
    && row.scope_id === targetProjectId && row.state === 'authorized');
  if (otherRoots.length > 0) {
    throw new RagError('memory-exclusive',
      'el proyecto ya tiene raíces en otras rutas: no se mezclan dos carpetas en una memoria', {
        details: {
          reason: 'project-has-other-roots', projectId: targetProjectId,
          roots: otherRoots.map((row) => ({ id: row.id, path: row.path })), retryable: false,
        },
      });
  }
}

/**
 * Provisiona (o reutiliza) la memoria del workspace y la asocia con CAS.
 *
 * @returns {{memory: object, tracking: object, operationId: string|null, reused: boolean}}
 * @throws {RagError} `provisioning-failed` (con `operationId`, `failedStep` y `retryable`),
 *   `revision-conflict`, `memory-exclusive`, `workspace-missing`, `root-overlap`.
 */
export function provisionWorkspaceMemory(db, {
  profileRoot, profileKey, path, pathKey, expectedRevision, now = Date.now(), recovering = false,
  trackingCreated = false,
} = {}) {
  if (!profileRoot || !profileKey) {
    throw new RagError('invalid-argument', 'la provisión necesita el perfil resuelto');
  }
  let row = readTracking(db, { pathKey });
  if (!row) {
    throw new RagError('not-found', 'la fila de seguimiento no existe: el acto humano debe crearla antes', {
      details: { pathKey },
    });
  }
  if (row.revision !== expectedRevision) {
    throw new RagError('revision-conflict', 'el seguimiento cambió mientras se preparaba la memoria', {
      details: {
        reason: 'revision-mismatch', pathKey,
        expectedRevision, currentRevision: row.revision,
      },
    });
  }
  if (row.state !== 'on') {
    throw new RagError('invalid-argument', 'sólo se provisiona memoria con el seguimiento activado', {
      details: { reason: 'tracking-not-on', state: row.state },
    });
  }
  const info = workspaceInfo(row.path ?? path);
  // Sanea reservas muertas de intentos anteriores: si una intención abandonada apunta a un proyecto
  // archivado (o inexistente), conservarla condenaría el reintento a `project-not-active`. Se
  // descarta la reserva; la identidad nueva se crea en el paso `identity`.
  const priorIntent = getProvisionIntent(db, info.key);
  if (priorIntent && priorIntent.state === 'abandoned' && priorIntent.projectId) {
    const reserved = getProject(db, priorIntent.projectId);
    if (!reserved || reserved.status !== 'active') {
      db.prepare('UPDATE provision_intents SET project_id = NULL WHERE path_key = ?').run(info.key);
      appendRegistryAudit(db, {
        at: now, actor: 'host', sessionId: null, action: 'provision.reservation.discarded', target: info.key,
        outcome: 'ok',
        detail: { projectId: priorIntent.projectId, status: reserved?.status ?? 'missing' },
      });
    }
  }
  // Una ruta que se dejó de seguir después de un movimiento conserva una intención `done` con el
  // project_id anterior. Volver a seguirla debe abrir una identidad nueva, no reclamar la memoria
  // que ya vive en la ruta destino (el error `project-has-other-roots` era permanente y engañoso).
  const staleDone = getProvisionIntent(db, info.key);
  if (staleDone?.state === 'done' && staleDone.revokedAt && row.projectId === null) {
    db.prepare(`UPDATE provision_intents
        SET project_id = NULL, consent_trust_key = NULL, consent_root_id = NULL
      WHERE path_key = ? AND state = 'done'`).run(info.key);
    appendRegistryAudit(db, {
      at: now, actor: 'host', sessionId: null, action: 'provision.reservation.released', target: info.key,
      outcome: 'ok', detail: { projectId: staleDone.projectId, reason: 'path-left-after-move' },
    });
  }
  const rootAtPath = exactRoot(db, info.key);
  const targetProjectId = resolveTargetProject(db, { row, pathKey: info.key, rootAtPath });
  // Con una limpieza F-02 pendiente el proyecto puede tener dos raíces temporales. Provisionar la
  // ruta vieja ahora crearía una tercera asociación y la limpieza acabaría marcando la intención
  // nueva: se espera a que la obligación se complete. Se comprueba por ruta (aunque `targetProjectId`
  // aún no se haya resuelto) y por proyecto.
  const pendingCleanupPath = pendingCleanupForPath(db, info.key);
  if (pendingCleanupPath || (targetProjectId && pendingCleanupFor(db, targetProjectId).pending)) {
    const pendingProject = pendingCleanupPath?.projectId ?? targetProjectId;
    throw new RagError('memory-exclusive',
      'la memoria tiene una limpieza de acceso pendiente; espera a que termine', {
        details: { reason: 'cleanup-pending', projectId: pendingProject, pathKey: info.key, retryable: false },
      });
  }
  // Preflight ANTES de escribir: los conflictos de raíz/solape se detectan aquí, no después de crear
  // trust, proyecto y almacén. Un acto rechazado no debe dejar permisos ni proyectos fantasma.
  assertProvisionPreflight(db, { pathKey: info.key, targetProjectId });
  const hadProject = row.projectId !== null;

  // Intención en curso: se reanuda la MISMA operación (no se abre otra) si sigue viva y no quedó
  // desfasada por un acto humano posterior. Si la intención quedó huérfana (su operación ya cerró o
  // desapareció), se cierra antes de abrir una nueva: dos intenciones abiertas para la misma ruta
  // serían dos verdades.
  const existingIntent = getProvisionIntent(db, info.key);
  let operationId = null;
  if (existingIntent?.state === 'open') {
    const openOperation = getOperation(db, existingIntent.operationId);
    const alreadyAssociated = row.projectId !== null && row.projectId === existingIntent.projectId
      && row.association === 'explicit';
    if (alreadyAssociated) {
      // La asociación ya estaba escrita; la intención quedó abierta por una caída al cerrar.
      if (openOperation && openOperation.state === 'started') {
        finishOperation(db, { operationId: openOperation.id, state: 'committed', now, detail: { recovered: 'associated' } });
      }
      finishProvisionIntent(db, { pathKey: info.key, operationId: existingIntent.operationId, projectId: row.projectId, now });
      enqueueSync(db, { projectId: row.projectId, reason: 'provision', now });
      return {
        memory: memoryForTracking(db, { profileRoot, row }),
        tracking: row,
        operationId: existingIntent.operationId,
        reused: true,
      };
    }
    const stale = existingIntent.expectedRevision !== row.revision;
    const usable = openOperation && openOperation.state === 'started' && !stale;
    if (usable) {
      // Otra operación viva ya está ejecutando esta provisión. Ejecutar los pasos aquí sería un
      // segundo escritor sobre la misma raíz/asociación. Sólo la recuperación de arranque (que ya
      // sabe que el proceso anterior no existe) puede reanudarla; un llamador normal reintenta.
      if (!recovering) {
        throw new RagError('revision-conflict', 'otra provisión de este workspace está en curso', {
          details: {
            reason: 'concurrent-provision', pathKey: info.key,
            operationId: openOperation.id, retryable: true,
          },
        });
      }
      operationId = openOperation.id;
    } else {
      if (openOperation && openOperation.state === 'started') {
        finishOperation(db, {
          operationId: openOperation.id, state: 'failed', now,
          detail: {
            reason: stale ? 'fenced-by-newer-revision' : 'orphan-intent',
            expectedRevision: existingIntent.expectedRevision, currentRevision: row.revision,
          },
        });
      }
      finishProvisionIntent(db, { pathKey: info.key, operationId: existingIntent.operationId, now, state: 'abandoned' });
    }
  }

  if (!operationId) {
    const projectForIntent = targetProjectId;
    const operation = beginOperation(db, {
      kind: PROVISION_KIND, now,
      detail: { path_key: info.key, path: info.canonical, expected_revision: row.revision, project_id: projectForIntent, tracking_created: Boolean(trackingCreated), owner_pid: process.pid },
    });
    operationId = operation.id;
    const opened = openProvisionIntent(db, {
      pathKey: info.key, operationId, expectedRevision: row.revision, projectId: projectForIntent, now,
    });
    // Carrera entre dos procesos: la intención ya está abierta con OTRA operación viva. No se adopta
    // y se ejecuta en paralelo (dos escritores pisarían raíz y asociación): la nuestra se reconcilia
    // y se devuelve un conflicto reintentable. El primero termina; el segundo reintenta y reutiliza.
    if (opened.resumed && opened.intent.operationId !== operationId) {
      const adopted = getOperation(db, opened.intent.operationId);
      if (adopted?.state === 'started') {
        finishOperation(db, {
          operationId, state: 'reconciled', now,
          detail: { reason: 'concurrent-provision', adopted: opened.intent.operationId },
        });
        throw new RagError('revision-conflict', 'otra provisión de este workspace está en curso', {
          details: {
            reason: 'concurrent-provision', pathKey: info.key,
            operationId: opened.intent.operationId, retryable: true,
          },
        });
      }
      finishProvisionIntent(db, { pathKey: info.key, operationId: opened.intent.operationId, now, state: 'abandoned' });
      openProvisionIntent(db, {
        pathKey: info.key, operationId, expectedRevision: row.revision, projectId: projectForIntent, now,
      });
    }
  } else {
    // Reanudación: si la intención no traía identidad (caída entre abrir y reservar), se fija ahora.
    const intent = getProvisionIntent(db, info.key);
    if (!intent?.projectId && targetProjectId) {
      setIntentProject(db, { pathKey: info.key, projectId: targetProjectId, now });
    }
  }

  const done = stepsDone(db, operationId);
  let resolvedProjectId = getProvisionIntent(db, info.key)?.projectId ?? targetProjectId ?? null;
  // Sólo un proyecto creado por ESTE acto puede archivarse en la compensación. Un proyecto
  // preexistente y vacío (elegido por `projectId` o por descubrimiento) no es nuestro.
  let createdProject = false;
  let consentTrustKey = null;
  let consentRootId = null;

  const runStep = (step, work) => {
    if (done.has(step)) return;
    try {
      work();
      recordStep(db, { operationId, step, state: 'done', effectKey: effectKey(info.key, step), now });
    } catch (error) {
      recordStep(db, { operationId, step, state: 'failed', now });
      throw error;
    }
  };

  try {
    runStep('consent', () => {
      // Confianza + procedencia en la MISMA transacción: una caída entre ambas dejaba una confianza
      // autorizada sin `consent_trust_key` y, por tanto, imposible de atribuir y revocar (H-01-R2).
      withTransaction(db, () => {
        const trust = addTrustedRoot(db, { path: info.canonical, readAuthorization: true, addedBy: 'human', now });
        // Sólo es NUESTRA si este acto la creó o la reactivó (una entrada `revoked` que vuelve a
        // `trusted` por este acto es una concesión nueva del acto, aunque `created` sea false). Una
        // entrada preexistente intacta no se posee y jamás se revocará desde aquí.
        if (trust.created || trust.changed) {
          consentTrustKey = trust.root.pathKey;
          const recorded = setIntentConsent(db, { pathKey: info.key, consentTrustKey, now });
          if (!recorded) {
            throw new RagError('operation-uncertain',
              'la intención de provisión dejó de estar abierta durante el consentimiento', {
                details: { reason: 'intent-not-open', pathKey: info.key },
              });
          }
        }
      }, { immediate: true });
    });

    runStep('identity', () => {
      resolvedProjectId = resolvedProjectId ?? newId('prj_', now);
      setIntentProject(db, { pathKey: info.key, projectId: resolvedProjectId, now });
    });

    runStep('project', () => {
      const existing = getProject(db, resolvedProjectId);
      if (!existing) {
        createProject(db, { id: resolvedProjectId, name: basename(info.canonical), now });
        createdProject = true;
      } else if (existing.status !== 'active') {
        throw new RagError('invalid-argument', 'el proyecto reservado está archivado', {
          details: { reason: 'project-not-active', project: resolvedProjectId },
        });
      }
    });

    runStep('store', () => {
      const store = openScopeStore({
        profileRoot, profileKey, scope: { kind: 'prj', id: resolvedProjectId }, create: true, now,
      });
      try { /* la apertura crea y declara identidad */ } finally { store.close(); }
    });

    runStep('verify', () => {
      const store = openScopeStore({
        profileRoot, profileKey, scope: { kind: 'prj', id: resolvedProjectId }, create: false, now,
      });
      if (!store) {
        throw new RagError('scope-store-unavailable', 'el almacén no existe tras crearlo', {
          details: { reason: 'store-absent', projectId: resolvedProjectId },
        });
      }
      store.close();
    });

    runStep('root', () => {
      const exact = exactRoot(db, info.key);
      if (exact) {
        if (exact.scope_kind !== 'prj' || exact.scope_id !== resolvedProjectId) {
          throw new RagError('root-overlap', 'la ruta exacta ya está registrada por otro ámbito', {
            details: {
              reason: 'exact-root-other-scope',
              path: exact.path, scopeKind: exact.scope_kind, scopeId: exact.scope_id,
            },
          });
        }
        return; // ya cubierta por este proyecto; la raíz es preexistente y no se posee
      }
      const covering = coveringRoot(db, info.key, resolvedProjectId);
      if (covering && covering.relation === 'ancestor-own') return; // cubierta por una raíz del mismo proyecto
      if (covering) {
        throw new RagError('root-overlap', 'la ruta se solapa con una raíz de otro ámbito', {
          details: {
            reason: covering.relation, path: covering.root.path,
            scopeKind: covering.root.scope_kind, scopeId: covering.root.scope_id,
          },
        });
      }
      // Si el proyecto ya tiene raíces autorizadas en OTRAS rutas, añadir la del workspace mezclaría
      // dos carpetas en una sola memoria (1:1:1). Se detiene y se pide reconciliación humana.
      const otherRoots = listRoots(db).filter((row) => row.scope_kind === 'prj'
        && row.scope_id === resolvedProjectId && row.state === 'authorized');
      if (otherRoots.length > 0) {
        throw new RagError('memory-exclusive',
          'el proyecto ya tiene raíces en otras rutas: no se mezclan dos carpetas en una memoria', {
            details: {
              reason: 'project-has-other-roots', projectId: resolvedProjectId,
              roots: otherRoots.map((row) => ({ id: row.id, path: row.path })),
            },
          });
      }
      const root = withTransaction(db, () => {
        const created = addRoot(db, {
          scopeKind: 'prj', scopeId: resolvedProjectId, path: info.canonical, addedBy: 'human', now,
        });
        const recorded = setIntentConsent(db, { pathKey: info.key, consentRootId: created.id, now });
        if (!recorded) {
          throw new RagError('operation-uncertain',
            'la intención de provisión dejó de estar abierta al registrar la raíz', {
              details: { reason: 'intent-not-open', pathKey: info.key },
            });
        }
        return created;
      }, { immediate: true });
      consentRootId = root.id;
    });

    runStep('associate', () => {
      row = readTracking(db, { pathKey: info.key });
      const intent = getProvisionIntent(db, info.key);
      if (!row) {
        throw new RagError('not-found', 'la fila de seguimiento desapareció durante la provisión', {
          details: { pathKey: info.key },
        });
      }
      if (row.projectId === resolvedProjectId && row.association === 'explicit') return;
      if (row.revision !== intent.expectedRevision) {
        throw new RagError('revision-conflict', 'una operación anterior no puede asociar sobre una revisión nueva', {
          details: {
            reason: 'fenced', expectedRevision: intent.expectedRevision, currentRevision: row.revision,
          },
        });
      }
      associateTracking(db, {
        pathKey: info.key, projectId: resolvedProjectId, expectedRevision: row.revision, operationId, now,
      });
    });

    const steps = listSteps(db, operationId);
    if (steps.some((step) => step.state !== 'done')) {
      throw new RagError('operation-uncertain', 'quedaron pasos sin completar', {
        details: { operationId, steps: steps.map((step) => ({ step: step.step, state: step.state })) },
      });
    }
    finishOperation(db, {
      operationId, state: 'committed', now,
      detail: {
        path_key: info.key, path: info.canonical, project_id: resolvedProjectId,
        expected_revision: row.revision, consent_trust_key: consentTrustKey, consent_root_id: consentRootId,
      },
    });
    const intent = getProvisionIntent(db, info.key);
    consentTrustKey = consentTrustKey ?? intent?.consentTrustKey ?? null;
    consentRootId = consentRootId ?? intent?.consentRootId ?? null;
    finishProvisionIntent(db, { pathKey: info.key, operationId, projectId: resolvedProjectId, now });
    enqueueSync(db, { projectId: resolvedProjectId, reason: 'provision', now });
    const after = readTracking(db, { pathKey: info.key });
    return {
      memory: memoryForTracking(db, { profileRoot, row: after }),
      tracking: after,
      operationId,
      // Reutilizada si la memoria ya existía antes de este acto: la fila ya apuntaba a un proyecto o
      // la ruta ya tenía un proyecto dueño (descubrimiento). Un almacén recreado conserva la identidad.
      reused: hadProject || targetProjectId !== null,
    };
  } catch (error) {
    const failedStep = listSteps(db, operationId).find((step) => step.state === 'failed')?.step ?? null;
    const retryable = isRetryable(error);
    let compensated = false;
    let deferredCompensation = false;
    // En una reanudación las variables locales de consentimiento pueden ser null: los ids viven en
    // la intención durable. La compensación debe usar esa procedencia, no sólo la del proceso vivo.
    const recoveryIntent = getProvisionIntent(db, info.key);
    const effectiveConsentRootId = consentRootId ?? recoveryIntent?.consentRootId ?? null;
    const effectiveConsentTrustKey = consentTrustKey ?? recoveryIntent?.consentTrustKey ?? null;
    const effectiveProjectId = resolvedProjectId ?? recoveryIntent?.projectId ?? null;
    if (!retryable) {
      try {
        const current = readTracking(db, { pathKey: info.key });
        const associated = Boolean(current && resolvedProjectId
          && current.projectId === resolvedProjectId && current.association === 'explicit');
        // Compensación: si el acto alcanzó a crear confianza/raíz y NO llegó a asociar, se retiran
        // esas entradas. Dejar acceso de lectura de un acto fallido sería un permiso fantasma.
        if (!associated) {
          let compensationFailed = false;
          if (effectiveConsentRootId) {
            try {
              const root = db.prepare('SELECT * FROM roots WHERE id = ?').get(effectiveConsentRootId);
              if (root && root.scope_kind === 'prj' && root.scope_id === effectiveProjectId && root.path_key === info.key) {
                db.prepare('DELETE FROM roots WHERE id = ?').run(root.id);
                compensated = true;
              }
            } catch { compensationFailed = true; }
          }
          if (effectiveConsentTrustKey) {
            try {
              const revoked = deleteTrustedRootByKey(db, { pathKey: effectiveConsentTrustKey, removedBy: 'human', now });
              compensated = compensated || revoked.changed;
            } catch { compensationFailed = true; }
          }
          // Si la E/S impidió retirar una entrada, la obligación no se puede perder: se encola una
          // limpieza durable (F-02) y se deja el proyecto fuera del sync mientras esté abierta. Si ni
          // siquiera se puede persistir esa obligación, la provisión queda abierta para recuperación;
          // no se abandona el intent con una raíz/confianza fantasma.
          if ((effectiveConsentRootId || effectiveConsentTrustKey) && (compensationFailed || !compensated)) {
            try {
              const trust = effectiveConsentTrustKey
                ? listTrustedRoots(db).find((entry) => entry.pathKey === effectiveConsentTrustKey) ?? null
                : null;
              queueAccessCleanup(db, {
                projectId: effectiveProjectId, fromPathKey: info.key, fromPath: info.canonical,
                rootId: effectiveConsentRootId, trustKey: effectiveConsentTrustKey, trustAddedAt: trust?.addedAt ?? null,
                sourceOperationId: operationId, now, ownerPid: process.pid,
              });
            } catch {
              deferredCompensation = true;
            }
          }
          if (compensated) {
            appendRegistryAudit(db, {
              at: now, actor: 'human', sessionId: null, action: 'access.revoke.compensated', target: info.key,
              outcome: 'ok',
              detail: {
                operationId, projectId: effectiveProjectId, trustKey: effectiveConsentTrustKey, rootId: effectiveConsentRootId,
                failedStep, code: error?.code ?? 'internal',
              },
            });
            // Las claves de procedencia apuntan a entradas que ya no existen: conservarlas haría que
            // el panel ofreciera una revocación que no puede retirar nada.
            db.prepare(`UPDATE provision_intents
                SET consent_trust_key = NULL, consent_root_id = NULL WHERE path_key = ?`).run(info.key);
          }
          // Proyecto fantasma: si este acto creó el proyecto y no llegó a asociarlo ni a dejarle
          // raíz, se archiva. No se borra nada: un proyecto archivado no aparece como memoria viva
          // y deja de ser candidato de sincronización.
          if (createdProject && resolvedProjectId) {
            const project = getProject(db, resolvedProjectId);
            const roots = listRoots(db).filter((row) => row.scope_kind === 'prj'
              && row.scope_id === resolvedProjectId && row.state === 'authorized');
            if (project && project.status === 'active' && roots.length === 0) {
              archiveProject(db, { id: resolvedProjectId, now, actor: 'human' });
              // La reserva de identidad de un proyecto archivado no puede sobrevivir: un reintento
              // la reutilizaría y moriría en `project-not-active` (camino sin salida desde el panel).
              db.prepare('UPDATE provision_intents SET project_id = NULL WHERE path_key = ?').run(info.key);
            }
          }
        }
        // Si este acto creó la fila de seguimiento (p. ej. `PUT /tracking` con intent=provision), un
        // fallo no reintentable no puede dejarla en ON: la persona no eligió seguir un workspace cuya
        // memoria no se pudo preparar. La recuperación de arranque usa la marca durable del journal.
        if (trackingCreated) {
          const current = readTracking(db, { pathKey: info.key });
          if (current && !current.projectId) {
            removeTracking(db, { pathKey: info.key, expectedRevision: current.revision, now });
          }
        }
      } catch { /* la compensación no puede tapar el error original */ }
      try {
        if (deferredCompensation) {
          appendRegistryAudit(db, {
            at: now, actor: 'human', sessionId: null, action: 'access.revoke.compensation-deferred',
            target: info.key, outcome: 'skipped',
            detail: { operationId, projectId: resolvedProjectId, reason: 'cleanup-not-persisted' },
          });
        } else {
          const operation = getOperation(db, operationId);
          if (operation?.state === 'started') {
            finishOperation(db, {
              operationId, state: 'failed', now,
              detail: { failed_step: failedStep, code: error?.code ?? 'internal', retryable: false },
            });
          }
          if (!operation || operation.state === 'started' || operation.state === 'failed') {
            finishProvisionIntent(db, { pathKey: info.key, operationId, now, state: 'abandoned' });
          }
        }
      } catch { /* el journal no puede tapar el error original */ }
    }
    // El cliente necesita saber si el acto puede reintentarse tal cual. Los códigos que se devuelven
    // sin envolver (`rethrowClassified`) conservaban el detalle de la causa pero no esta marca; sin
    // ella la API no puede decidir si compensa la fila o la deja para la recuperación.
    if (!retryable && error && typeof error === 'object') {
      try {
        error.details = { ...(error.details ?? {}), retryable: false, compensated };
      } catch { /* un error congelado conserva su forma original */ }
    }
    rethrowClassified(error);
    throw new RagError('provisioning-failed', 'no se pudo preparar la memoria del workspace', {
      details: {
        operationId,
        failedStep,
        retryable,
        compensated,
        cause: error?.code ?? 'internal',
        message: error?.message ?? null,
        ...(error?.details ? { causeDetails: error.details } : {}),
      },
      cause: error,
    });
  }
}

/* ------------------------------------------------------------------ movimiento */

function ownedConsentOf(db, pathKey) {
  const intent = getProvisionIntent(db, pathKey);
  // Una intención `abandoned` conserva la procedencia de lo que el acto creó. Si el acto falló
  // después de crear trust/raíz, esas entradas siguen siendo nuestras y deben poder revocarse: negar
  // la revocación por el estado de la intención dejaría acceso real sin forma de retirarlo.
  if (!intent || (intent.state !== 'done' && intent.state !== 'abandoned') || intent.revokedAt) {
    return { intent, trustKey: null, rootId: null };
  }
  return {
    intent,
    trustKey: intent.consentTrustKey === pathKey ? intent.consentTrustKey : null,
    rootId: intent.consentRootId,
  };
}

/** Entradas que impiden revocar con seguridad: raíces autorizadas de otros ámbitos dentro de la ruta. */
function revokeBlockers(db, { pathKey, projectId, rootId = null }) {
  return listRoots(db)
    .filter((root) => root.id !== rootId && root.state === 'authorized' && root.path_key !== pathKey)
    .filter((root) => overlaps(root.path_key, pathKey))
    .filter((root) => !(root.scope_kind === 'prj' && root.scope_id === projectId))
    .map((root) => ({ id: root.id, path: root.path, scopeKind: root.scope_kind, scopeId: root.scope_id }));
}

/**
 * Acceso que sigue autorizando la ruta después de retirar lo propio. No basta con mirar `roots`: la
 * lectura de una sesión se resuelve también por `trustedRoots`, así que una confianza preexistente
 * del padre mantiene el acceso aunque no quede ninguna raíz. `complete:true` exige ambas cosas.
 */
function remainingAccess(db, pathKey) {
  const covers = (entryPathKey) => entryPathKey === pathKey || pathKey.startsWith(`${entryPathKey}/`);
  const roots = listRoots(db)
    .filter((root) => root.state === 'authorized' && overlaps(root.path_key, pathKey))
    .map((root) => ({ kind: 'root', id: root.id, path: root.path, scopeKind: root.scope_kind, scopeId: root.scope_id }));
  const trusts = listTrustedRoots(db)
    .filter((entry) => entry.state === 'trusted' && entry.readAuthorization !== false && covers(entry.pathKey))
    .map((entry) => ({ kind: 'trust', id: null, pathKey: entry.pathKey, path: entry.path, scopeKind: null, scopeId: null }));
  return [...roots, ...trusts];
}

/**
 * Revoca el acceso de lectura que **LifeCode RAG creó** para este workspace (Q08).
 *
 * No es OFF: no toca `state`, `project_id`, sesiones, almacén ni historial. Si no hay procedencia
 * demostrable, no escribe nada y responde `revocation-not-proven`; es preferible un «no puedo
 * demostrarlo» a revocar un permiso ajeno.
 */
export function revokeReadAccess(db, { profileRoot = null, pathKey, expectedRevision, now = Date.now() } = {}) {
  const row = readTracking(db, { pathKey });
  if (!row) {
    throw new RagError('not-found', 'ese workspace no está seguido', { details: { pathKey } });
  }
  if (row.revision !== expectedRevision) {
    throw new RagError('revision-conflict', 'el seguimiento cambió mientras se revocaba', {
      details: { reason: 'revision-mismatch', pathKey, expectedRevision, currentRevision: row.revision },
    });
  }
  const owned = ownedConsentOf(db, pathKey);
  if (!owned.intent) {
    throw new RagError('revocation-not-proven',
      'LifeCode RAG no tiene constancia de haber creado acceso para este workspace', {
        details: { pathKey, reason: 'no-provision-intent' },
      });
  }
  if (owned.intent.revokedAt) {
    // Repetir la acción no puede convertir una revocación parcial en total: se vuelve a medir lo
    // que sigue autorizado y se responde con la misma verdad.
    const remaining = remainingAccess(db, pathKey);
    return {
      changed: false, complete: remaining.length === 0, remaining,
      alreadyRevoked: true, revokedAt: owned.intent.revokedAt, removed: null, left: null,
      memory: memoryForTracking(db, { profileRoot, row }),
    };
  }
  if (!owned.trustKey && !owned.rootId) {
    throw new RagError('revocation-not-proven',
      'no hay evidencia de propiedad: las entradas de esta ruta no las creó LifeCode RAG', {
        details: {
          pathKey,
          reason: 'no-provenance',
          consentTrustKey: owned.intent.consentTrustKey,
          consentRootId: owned.intent.consentRootId,
        },
      });
  }
  const blockers = revokeBlockers(db, { pathKey, projectId: owned.intent.projectId, rootId: owned.rootId });
  if (blockers.length > 0) {
    throw new RagError('revocation-not-proven',
      'hay otras raíces autorizadas dentro de esa ruta: retirar el acceso las afectaría', {
        details: { pathKey, reason: 'other-roots-inside', blockers },
      });
  }
  // Acceso que queda tras retirar lo propio. Se mide DENTRO de la transacción, después de borrar:
  // un root preexistente (de descubrimiento, del Host o de otro acto) NO se puede borrar por Q08; si
  // sigue ahí, la operación no puede decir «acceso revocado» sin mentir.
  let remaining = [];
  let complete = false;
  const removed = { trust: null, root: null };
  const left = [];
  withTransaction(db, () => {
    if (owned.rootId) {
      const root = db.prepare('SELECT * FROM roots WHERE id = ?').get(owned.rootId);
      if (root && root.scope_kind === 'prj' && root.scope_id === owned.intent.projectId && root.path_key === pathKey) {
        db.prepare('DELETE FROM roots WHERE id = ?').run(root.id);
        removed.root = { id: root.id, path: root.path };
      } else if (root) {
        left.push({ kind: 'root', reason: 'root-not-owned', id: root.id, path: root.path });
      }
    }
    if (owned.trustKey) {
      const trust = listTrustedRoots(db).find((entry) => entry.pathKey === pathKey && entry.state === 'trusted');
      if (trust) {
        // Por pathKey: retirar la confianza no puede exigir que la carpeta siga existiendo.
        removeTrustedRootByKey(db, { pathKey: trust.pathKey, removedBy: 'human', now });
        removed.trust = { pathKey: trust.pathKey, path: trust.path };
      }
    }
    remaining = remainingAccess(db, pathKey);
    complete = remaining.length === 0;
    markIntentRevoked(db, { pathKey, now });
    appendRegistryAudit(db, {
      at: now, actor: 'human', sessionId: null, action: 'access.revoke', target: pathKey, outcome: 'ok',
      detail: { operationId: owned.intent.operationId, projectId: owned.intent.projectId, removed, left, complete, remaining },
    });
  }, { immediate: true });
  return {
    changed: Boolean(removed.trust || removed.root),
    complete,
    remaining,
    alreadyRevoked: false,
    removed,
    left,
    memory: memoryForTracking(db, { profileRoot, row }),
  };
}

/**
 * Mueve la memoria de un workspace a otra ruta conservando identidad y almacén (Q09).
 *
 * No es un clon: el `project_id` es el mismo y el almacén no se copia. La fila vieja se elimina
 * dentro de la misma transacción que crea la nueva; el journal guarda ruta anterior, ruta nueva,
 * identidad, revisiones y resultado. Sólo se revoca el acceso viejo que creó este plugin.
 */
export function moveWorkspaceMemory(db, {
  profileRoot, profileKey, pathKey, newPath, expectedRevision, now = Date.now(),
} = {}) {
  const row = readTracking(db, { pathKey });
  if (!row) {
    throw new RagError('not-found', 'ese workspace no está seguido', { details: { pathKey } });
  }
  if (row.revision !== expectedRevision) {
    throw new RagError('revision-conflict', 'el seguimiento cambió mientras se movía', {
      details: { reason: 'revision-mismatch', pathKey, expectedRevision, currentRevision: row.revision },
    });
  }
  if (!row.projectId) {
    throw new RagError('invalid-argument', 'el workspace no tiene memoria que mover', {
      details: { reason: 'no-memory', pathKey },
    });
  }
  const project = projectRow(db, row.projectId);
  if (!scopeStoreExists(profileRoot, project.id)) {
    throw new RagError('move-conflict', 'la memoria del workspace no está disponible', {
      details: { reason: 'store-absent', projectId: project.id },
    });
  }
  // Un movimiento encadenado antes de completar el rekey del anterior dejaría la obligación vieja
  // apuntando a una ruta que ya no es la del seguimiento: al recuperarla movería fuentes a una ruta
  // hermana y el sync posterior las duplicaría. Se rechaza hasta que el rekey pendiente termine.
  const pendingRekey = pendingRekeyFor(db, project.id);
  if (pendingRekey.pending) {
    throw new RagError('move-conflict',
      'la memoria tiene un rekey pendiente: espera a que termine antes de mover otra vez', {
        details: {
          reason: 'rekey-pending', projectId: project.id,
          operationId: pendingRekey.operationId, retryable: true,
        },
      });
  }
  // Un pase de sync en vuelo enumera la raíz vieja y puede ingerir después del rebind. Se evita la
  // carrera: el movimiento se rechaza mientras una pasada del MISMO proyecto siga viva.
  const activeSyncs = db.prepare("SELECT id, detail FROM operations WHERE kind = 'sync' AND state = 'started'").all();
  for (const active of activeSyncs) {
    let detail = null;
    try { detail = active.detail ? JSON.parse(active.detail) : null; } catch { detail = null; }
    if (detail?.scope_kind !== 'prj' || detail?.scope_id !== project.id) continue;
    if (!operationOwnerAlive(active)) continue;
    throw new RagError('sync-in-progress',
      'hay una sincronización en vuelo para esta memoria: espera a que termine antes de mover', {
        details: { reason: 'sync-in-progress', projectId: project.id, operationId: active.id, retryable: true },
      });
  }
  const info = workspaceInfo(newPath);
  if (info.key === pathKey) {
    throw new RagError('invalid-argument', 'la ruta nueva es la misma que la actual', {
      details: { reason: 'same-path', pathKey },
    });
  }
  const otherRow = db.prepare('SELECT path_key FROM workspace_tracking WHERE path_key = ?').get(info.key);
  if (otherRow) {
    throw new RagError('move-conflict', 'la ruta nueva ya está seguida por otro workspace', {
      details: { reason: 'destination-tracked', pathKey: info.key },
    });
  }
  // Mover dentro de la propia carpeta (o a un padre que la contiene) cambiaría qué se indexa: la
  // raíz cubriría hermanos que no son el workspace. Se rechaza con un conflicto claro.
  if (info.key.startsWith(`${pathKey}/`) || pathKey.startsWith(`${info.key}/`)) {
    throw new RagError('move-conflict', 'la ruta nueva contiene o está contenida en la actual', {
      details: { reason: 'containment', from: pathKey, to: info.key },
    });
  }
  // Acceso residual: si la ruta vieja tiene una raíz autorizada que este plugin NO creó (o que no es
  // exactamente la suya), no se puede retirar después del rebind. Mover dejaría DOS raíces sobre la
  // misma memoria y la carpeta vieja seguiría indexándose. Se detiene ANTES de escribir nada.
  const ownedSource = ownedConsentOf(db, pathKey);
  const foreignSourceRoots = listRoots(db)
    .filter((root) => root.state === 'authorized' && overlaps(root.path_key, pathKey))
    .filter((root) => root.id !== ownedSource.rootId)
    .map((root) => ({ id: root.id, path: root.path, scopeKind: root.scope_kind, scopeId: root.scope_id }));
  if (foreignSourceRoots.length > 0) {
    throw new RagError('move-conflict',
      'la ruta actual tiene una raíz autorizada que LifeCode RAG no creó: retírala antes de mover', {
        details: { reason: 'source-root-not-owned', pathKey, roots: foreignSourceRoots },
      });
  }
  // Un proyecto con raíces en otras carpetas tampoco se mueve: el resultado sería una memoria que
  // cubre dos sitios. La reconciliación de esa memoria es un acto aparte, no un movimiento.
  const otherProjectRoots = listRoots(db)
    .filter((root) => root.scope_kind === 'prj' && root.scope_id === project.id
      && root.state === 'authorized' && root.id !== ownedSource.rootId)
    .map((root) => ({ id: root.id, path: root.path }));
  if (otherProjectRoots.length > 0) {
    throw new RagError('move-conflict',
      'el proyecto tiene raíces en otras carpetas: no se mueve una memoria con dos sitios', {
        details: { reason: 'project-has-other-roots', projectId: project.id, roots: otherProjectRoots },
      });
  }
  const covering = coveringRoot(db, info.key, project.id);
  if (covering && covering.relation.startsWith('exact')) {
    if (covering.root.scope_kind !== 'prj' || covering.root.scope_id !== project.id) {
      throw new RagError('move-conflict', 'la ruta nueva ya pertenece a otro ámbito', {
        details: { reason: 'destination-root-other', path: covering.root.path, scopeId: covering.root.scope_id },
      });
    }
  } else if (covering && covering.relation !== 'ancestor-own') {
    throw new RagError('move-conflict', 'la ruta nueva se solapa con una raíz de otro ámbito', {
      details: { reason: covering.relation, path: covering.root.path, scopeId: covering.root.scope_id },
    });
  }

  const operation = beginOperation(db, {
    kind: MOVE_KIND, now,
    detail: {
      from_path_key: pathKey, from_path: row.path, to_path_key: info.key, to_path: info.canonical,
      project_id: project.id, from_revision: row.revision, from_state: row.state, owner_pid: process.pid,
    },
  });
  const operationId = operation.id;
  // Intención de la ruta destino: deja la procedencia durable de lo que este movimiento cree. No se
  // reabre una intención `done`: si otro movimiento ya terminó, sus `consent_*` son la verdad y este
  // acto no puede borrarlos ni cerrar la intención ajena.
  const opened = openProvisionIntent(db, {
    pathKey: info.key, operationId, expectedRevision: 1, projectId: project.id, now,
    resetConsent: true, reopenDone: false,
  });
  if (opened.alreadyDone || (opened.resumed && opened.intent.operationId !== operationId)) {
    const settled = readTracking(db, { pathKey: info.key });
    finishOperation(db, {
      operationId, state: 'reconciled', now,
      detail: {
        from_path_key: pathKey, to_path_key: info.key, project_id: project.id,
        reason: opened.alreadyDone ? 'destination-intent-done' : 'destination-intent-owned',
      },
    });
    if (opened.alreadyDone && settled?.projectId === project.id) {
      return {
        operationId: null,
        tracking: settled,
        memory: memoryForTracking(db, { profileRoot, row: settled }),
        reused: true,
      };
    }
    throw new RagError('revision-conflict',
      opened.alreadyDone
        ? 'la ruta destino ya tenía una intención cerrada por otro acto'
        : 'otro movimiento está preparando la ruta destino', {
        details: {
          reason: opened.alreadyDone ? 'destination-intent-done' : 'concurrent-move',
          pathKey: info.key, projectId: project.id, retryable: true,
        },
      });
  }
  const done = stepsDone(db, operationId);
  let newTrustKey = null;
  let newRootId = null;
  let newTrustAddedAt = null;
  const runStep = (step, work) => {
    if (done.has(step)) return;
    try {
      work();
      recordStep(db, { operationId, step, state: 'done', effectKey: `move:${pathKey}:${step}`, now });
    } catch (error) {
      recordStep(db, { operationId, step, state: 'failed', now });
      throw error;
    }
  };

  try {
    runStep('verify', () => { /* revisión y ruta ya validadas arriba */ });

    runStep('consent', () => {
      withTransaction(db, () => {
        const prior = getProvisionIntent(db, info.key)?.consentTrustKey;
        const trust = addTrustedRoot(db, { path: info.canonical, readAuthorization: true, addedBy: 'human', now });
        if (trust.created || trust.changed) {
          newTrustKey = trust.root.pathKey;
          newTrustAddedAt = trust.root.addedAt;
        } else if (prior === info.key) {
          newTrustKey = prior;
        }
        const recorded = setIntentConsent(db, { pathKey: info.key, consentTrustKey: newTrustKey, now });
        if (!recorded) {
          throw new RagError('operation-uncertain',
            'la intención del movimiento dejó de estar abierta durante el consentimiento', {
              details: { reason: 'intent-not-open', pathKey: info.key },
            });
        }
        // La procedencia exacta incluye cuándo se concedió: la compensación no puede retirar una
        // confianza recreada después por otro acto. Se guarda en el journal del movimiento.
        if (newTrustAddedAt !== null) {
          mergeOperationDetail(db, operationId, { trust_added_at: newTrustAddedAt });
        }
      }, { immediate: true });
    });

    runStep('root', () => {
      const exact = exactRoot(db, info.key);
      if (exact) {
        if (exact.scope_kind !== 'prj' || exact.scope_id !== project.id) {
          throw new RagError('move-conflict', 'la ruta nueva ya está registrada por otro ámbito', {
            details: { reason: 'destination-root-other', path: exact.path, scopeId: exact.scope_id },
          });
        }
        if (getProvisionIntent(db, info.key)?.consentRootId === exact.id) newRootId = exact.id;
        return;
      }
      const covering = coveringRoot(db, info.key, project.id);
      if (covering && covering.relation === 'ancestor-own') return;
      if (covering) {
        throw new RagError('move-conflict', 'la ruta nueva se solapa con una raíz de otro ámbito', {
          details: { reason: covering.relation, path: covering.root.path, scopeId: covering.root.scope_id },
        });
      }
      // La comprobación y el `addRoot` van en la MISMA transacción inmediata: dos movimientos
      // concurrentes no pueden pasar ambos la revalidación antes de que el otro confirme.
      const root = withTransaction(db, () => {
        const competing = listRoots(db).filter((row) => row.scope_kind === 'prj'
          && row.scope_id === project.id && row.state === 'authorized' && row.id !== ownedSource.rootId);
        if (competing.length > 0) {
          throw new RagError('memory-exclusive',
            'el proyecto ya tiene otra raíz: dos movimientos no pueden crear dos memorias', {
              details: {
                reason: 'project-has-other-roots', projectId: project.id,
                roots: competing.map((row) => ({ id: row.id, path: row.path })),
              },
            });
        }
        const created = addRoot(db, { scopeKind: 'prj', scopeId: project.id, path: info.canonical, addedBy: 'human', now });
        const recorded = setIntentConsent(db, { pathKey: info.key, consentRootId: created.id, now });
        if (!recorded) {
          throw new RagError('operation-uncertain',
            'la intención del movimiento dejó de estar abierta al registrar la raíz', {
              details: { reason: 'intent-not-open', pathKey: info.key },
            });
        }
        return created;
      }, { immediate: true });
      newRootId = root.id;
    });

    runStep('rebind', () => {
      withTransaction(db, () => {
        const current = db.prepare('SELECT * FROM workspace_tracking WHERE path_key = ?').get(pathKey);
        if (!current) throw new RagError('not-found', 'la fila de seguimiento desapareció', { details: { pathKey } });
        if (Number(current.revision) !== row.revision) {
          throw new RagError('revision-conflict', 'el seguimiento cambió durante el movimiento', {
            details: { reason: 'revision-mismatch', pathKey, expectedRevision: row.revision, currentRevision: Number(current.revision) },
          });
        }
        const at = String(now);
        db.prepare('DELETE FROM workspace_tracking WHERE path_key = ? AND revision = ?')
          .run(pathKey, Number(current.revision));
        db.prepare(`INSERT INTO workspace_tracking
            (path_key, path, workspace_id, project_id, state, association, bound_by, bound_at, updated_at,
             last_seen_at, last_status, revision)
          VALUES (?, ?, ?, ?, ?, 'explicit', 'human', ?, ?, ?, 'ok', 1)`)
          .run(info.key, info.canonical, current.workspace_id ?? null, project.id, current.state, at, at, at);
        appendRegistryAudit(db, {
          at, actor: 'human', sessionId: null, action: 'tracking.move', target: info.key, outcome: 'ok',
          detail: {
            operationId, projectId: project.id,
            from: { pathKey, path: current.path, revision: Number(current.revision) },
            to: { pathKey: info.key, path: info.canonical, revision: 1 },
          },
        });
      }, { immediate: true });
    });

    runStep('rekey', () => {
      // El almacén es el mismo: las fuentes deben cambiar de prefijo, no duplicarse. Si el almacén
      // no responde justo ahora, la obligación queda en el journal y se reintenta al arrancar; el
      // movimiento sigue siendo válido y no se presenta como fallido (como F-02).
      const fromRootId = ownedSource.rootId ?? null;
      const toRootId = newRootId ?? exactRoot(db, info.key)?.id ?? null;
      try {
        rekeyScopeAfterMove(db, {
          profileRoot, profileKey, projectId: project.id,
          fromPath: row.path, toPath: info.canonical,
          fromRootId, toRootId, now,
        });
      } catch (error) {
        const rekeyOperationId = queueRekey(db, {
          projectId: project.id, fromPath: row.path, toPath: info.canonical,
          fromRootId, toRootId, sourceOperationId: operationId, now,
        });
        appendRegistryAudit(db, {
          at: now, actor: 'human', sessionId: null, action: 'tracking.move.rekey', target: project.id,
          outcome: 'failed',
          detail: { operationId, rekeyOperationId, fromPath: row.path, toPath: info.canonical, code: error?.code ?? 'internal' },
        });
      }
    });

    runStep('revoke-old', () => {
      // Después del rebind, un fallo al retirar el acceso viejo NO puede convertir un movimiento ya
      // hecho en «fallido»: se audita lo que quedó y se encola una limpieza durable. La UI no
      // promete que la ruta vieja deje de estar autorizada salvo que el acceso fuera nuestro; si no
      // se pudo retirar, se dice y la obligación sobrevive a reinicios (F-02).
      let owned = null;
      try {
        owned = ownedConsentOf(db, pathKey);
        if (!owned.intent || owned.intent.projectId !== project.id || owned.intent.revokedAt) return;
        if (!owned.trustKey && !owned.rootId) return;
        // Aquí se retira NUESTRA raíz exacta, no una raíz padre: los roots de otros proyectos que
        // vivan dentro no se tocan y siguen autorizados por sí mismos. Dejarla sería dejar dos raíces
        // del mismo proyecto y el planificador indexaría las dos (F-02).
        const removed = { trust: null, root: null };
        if (owned.rootId) {
          const root = db.prepare('SELECT * FROM roots WHERE id = ?').get(owned.rootId);
          if (root && root.scope_kind === 'prj' && root.scope_id === project.id && root.path_key === pathKey) {
            db.prepare('DELETE FROM roots WHERE id = ?').run(root.id);
            removed.root = { id: root.id, path: root.path };
          }
        }
        if (owned.trustKey) {
          const trust = listTrustedRoots(db).find((entry) => entry.pathKey === pathKey && entry.state === 'trusted');
          if (trust) {
            removeTrustedRootByKey(db, { pathKey: trust.pathKey, removedBy: 'human', now });
            removed.trust = { pathKey: trust.pathKey, path: trust.path };
          }
        }
        markIntentRevoked(db, { pathKey, now });
        appendRegistryAudit(db, {
          at: now, actor: 'human', sessionId: null, action: 'access.revoke', target: pathKey, outcome: 'ok',
          detail: { operationId, projectId: project.id, reason: 'move', removed },
        });
      } catch (error) {
        // La obligación no se pierde: se identifica exactamente lo propio que quedó y se encola una
        // operación `cleanup` en el journal. Nada ajeno entra en el detalle.
        let cleanupOperationId = null;
        try {
          const intent = getProvisionIntent(db, pathKey);
          if (intent && intent.projectId === project.id) {
            const root = intent.consentRootId
              ? db.prepare('SELECT * FROM roots WHERE id = ?').get(intent.consentRootId)
              : null;
            const rootOwned = Boolean(root && root.scope_kind === 'prj'
              && root.scope_id === project.id && root.path_key === pathKey);
            const trustKey = intent.consentTrustKey === pathKey ? pathKey : null;
            const trustEntry = trustKey
              ? listTrustedRoots(db).find((entry) => entry.pathKey === trustKey && entry.state === 'trusted')
              : null;
            const trustOwned = Boolean(trustEntry);
            if (rootOwned || trustOwned) {
              cleanupOperationId = queueAccessCleanup(db, {
                projectId: project.id, fromPathKey: pathKey, fromPath: row.path,
                rootId: rootOwned ? root.id : null, trustKey: trustOwned ? trustKey : null,
                trustAddedAt: trustEntry?.addedAt ?? null,
                sourceOperationId: operationId, now,
              });
            }
          }
        } catch { /* la auditoría de abajo conserva el fallo original */ }
        appendRegistryAudit(db, {
          at: now, actor: 'human', sessionId: null, action: 'access.revoke.skipped', target: pathKey, outcome: 'failed',
          detail: { operationId, reason: 'revoke-failed', cleanupOperationId, code: error?.code ?? 'internal' },
        });
      }
    });

    const steps = listSteps(db, operationId);
    if (steps.some((step) => step.state !== 'done')) {
      throw new RagError('operation-uncertain', 'quedaron pasos sin completar', { details: { operationId } });
    }
    // Cerrar el journal ANTES de registrar la intención destino: si el proceso muere entre ambos, la
    // intención sigue `open` y la recuperación cierra la operación con evidencia. Al revés quedaría
    // una operación `started` sin intención que nadie reclamaría.
    finishOperation(db, {
      operationId, state: 'committed', now,
      detail: {
        from_path_key: pathKey, from_path: row.path, to_path_key: info.key, to_path: info.canonical,
        project_id: project.id, from_revision: row.revision, to_revision: 1, result: 'committed',
        trust_added_at: newTrustAddedAt ?? operationDetail(getOperation(db, operationId))?.trust_added_at ?? null,
      },
    });
    recordProvisionedWorkspace(db, {
      pathKey: info.key, operationId, expectedRevision: 1, projectId: project.id,
      consentTrustKey: newTrustKey ?? getProvisionIntent(db, info.key)?.consentTrustKey ?? null,
      consentRootId: newRootId ?? getProvisionIntent(db, info.key)?.consentRootId ?? null,
      now,
    });
    // La ruta nueva aún no tiene `sync_state`: se encola una pasada para que el índice no espere al
    // siguiente tick (que puede no existir si la automatización está apagada).
    enqueueSync(db, { projectId: project.id, reason: 'move', now });
    const after = readTracking(db, { pathKey: info.key });
    return {
      operationId,
      tracking: after,
      memory: memoryForTracking(db, { profileRoot, row: after }),
    };
  } catch (error) {
    if (!isRetryable(error)) {
      const current = readTracking(db, { pathKey: info.key });
      const didRebind = Boolean(current && current.projectId === project.id);
      if (didRebind) {
        // El rebind ya es un hecho: el movimiento no puede presentarse como fallido. Pero si el
        // rebind lo hizo OTRO proceso y este perdió su CAS, esta operación no puede cerrarse
        // `committed`: el journal diría que este acto hizo algo que no hizo y la intención quedaría
        // abierta. Se cierra `failed` y se abandona la intención propia; la fila real se devuelve.
        const steps = listSteps(db, operationId);
        const rebindDone = steps.some((step) => step.step === 'rebind' && step.state === 'done');
        if (!rebindDone) {
          try {
            withTransaction(db, () => {
              const operation = getOperation(db, operationId);
              if (operation?.state === 'started') {
                finishOperation(db, {
                  operationId, state: 'failed', now,
                  detail: {
                    from_path_key: pathKey, to_path_key: info.key, project_id: project.id,
                    reason: 'superseded-rebind', code: error?.code ?? 'internal',
                  },
                });
              }
              finishProvisionIntent(db, { pathKey: info.key, operationId, now, state: 'abandoned' });
            }, { immediate: true });
          } catch { /* la recuperación de arranque termina el cierre */ }
          throw new RagError('revision-conflict',
            'otro movimiento completó el rebind antes que esta operación', {
              details: { reason: 'move-superseded', pathKey: info.key, projectId: project.id, retryable: true },
            });
        }
        // El rebind ya es un hecho: el movimiento no puede presentarse como fallido. Se cierra lo que
        // falte (paso `record`, intención) y se devuelve la fila real. Si el cierre no cabe, la
        // recuperación lo termina; el usuario ve el estado que existe.
        try {
          withTransaction(db, () => {
            const operation = getOperation(db, operationId);
            if (operation?.state === 'started') {
              finishOperation(db, {
                operationId, state: 'committed', now,
                detail: {
                  from_path_key: pathKey, to_path_key: info.key, project_id: project.id,
                  result: 'committed-despite-post-rebind-error',
                  trust_added_at: operationDetail(getOperation(db, operationId))?.trust_added_at ?? null,
                },
              });
            }
            finishProvisionIntent(db, { pathKey: info.key, operationId, now, state: 'done' });
          }, { immediate: true });
        } catch { /* la recuperación de arranque termina el cierre */ }
        enqueueSync(db, { projectId: project.id, reason: 'move', now });
        const after = readTracking(db, { pathKey: info.key });
        return {
          operationId,
          tracking: after,
          memory: memoryForTracking(db, { profileRoot, row: after }),
        };
      }
      // No hubo rebind: se compensa lo que el acto creó en destino antes de abandonar. Sin esto,
      // un `revision-conflict` normal del CAS dejaba dos raíces y el planificador indexaba las dos
      // (H-01-R). La intención quedaba `abandoned` y la recuperación ya no la miraba.
      try {
        withTransaction(db, () => {
          const destIntent = getProvisionIntent(db, info.key);
          const compensation = compensateMoveDestination(db, {
            intent: destIntent, projectId: project.id, toPathKey: info.key, now,
          });
          const operation = getOperation(db, operationId);
          if (operation?.state === 'started') {
            finishOperation(db, {
              operationId, state: 'failed', now,
              detail: {
                reason: 'move-failed', code: error?.code ?? 'internal',
                from_path_key: pathKey, to_path_key: info.key,
                compensated: Boolean(compensation.root || compensation.trust),
              },
            });
          }
          finishProvisionIntent(db, { pathKey: info.key, operationId, now, state: 'abandoned' });
          if (compensation.root || compensation.trust) {
            db.prepare(`UPDATE provision_intents
                SET consent_trust_key = NULL, consent_root_id = NULL WHERE path_key = ?`).run(info.key);
          }
        }, { immediate: true });
      } catch { /* no tapar el error original */ }
    }
    rethrowClassified(error);
    throw new RagError('move-failed', 'no se pudo mover la memoria del workspace', {
      details: {
        operationId, retryable: isRetryable(error), cause: error?.code ?? 'internal',
        message: error?.message ?? null,
        ...(error?.details ? { causeDetails: error.details } : {}),
      },
      cause: error,
    });
  }
}

/**
 * Reasigna el prefijo de las fuentes del almacén del proyecto al mover el workspace. No crea
 * conocimiento: cambia la ruta y conserva `source_id`, chunks y vectores. Si la ruta nueva ya tiene
 * una fuente equivalente (una pasada anterior que llegó antes), retira la vieja para no duplicar.
 * El prefijo se compara con separador: `app` no puede arrastrar `app-docs`.
 */
function withoutTrailingSeparators(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  const trimmed = value.replace(/[\\/]+$/, '');
  if (trimmed === '') return value.startsWith('/') || value.startsWith('\\') ? value[0] : value;
  // Una raíz de unidad (`C:\\`) conserva su separador; no es un prefijo con barra final.
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`;
  return trimmed;
}

/** Normaliza la grafía léxica de una ruta (`.` y separadores duplicados) sin exigir que exista. */
function normalizedPathPrefix(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  try { return withoutTrailingSeparators(resolve(value)); } catch { return withoutTrailingSeparators(value); }
}

function rekeyScopeAfterMove(db, {
  profileRoot, profileKey, projectId, fromPath, toPath, fromRootId, toRootId, now,
}) {
  // El rekey es del **contenido**, no de la raíz: tras una revocación la raíz/trust ya no existen y
  // `fromRootId` es null, pero las fuentes siguen con la URI vieja. Exigir el root dejaba el
  // movimiento sin rekey y el sync insertaba una segunda fuente (mover después de revocar).
  if (typeof fromPath !== 'string' || typeof toPath !== 'string' || fromPath === toPath) return null;
  if (fromRootId && toRootId && fromRootId === toRootId) return null;
  // La ruta que guarda el seguimiento puede venir con otra grafía (barras `/`, mayúsculas) que la API
  // acepta por `pathKey`. Las fuentes se indexaron desde la raíz canónica: usar esa ruta como prefijo
  // evita un rekey silencioso que no mueve nada.
  const sourceRoot = db.prepare('SELECT path FROM roots WHERE id = ?').get(fromRootId);
  const targetRoot = db.prepare('SELECT path FROM roots WHERE id = ?').get(toRootId);
  const oldPrefix = normalizedPathPrefix(sourceRoot?.path ?? fromPath);
  const newPrefix = normalizedPathPrefix(targetRoot?.path ?? toPath);
  if (oldPrefix === newPrefix) return { moved: 0, removed: 0 };
  const normalizedOldPrefix = oldPrefix.replaceAll('/', '\\');
  const foldedOldPrefix = normalizedOldPrefix.toLowerCase();
  let moved = 0;
  let removed = 0;
  const store = openScopeStore({
    profileRoot, profileKey, scope: { kind: 'prj', id: projectId }, create: false, now,
  });
  if (!store) return { moved: 0, removed: 0 };
  try {
    withTransaction(store, () => {
      // La comparación de prefijos se hace en JS porque `lower()` de SQLite sólo pliega ASCII:
      // un workspace con `Ö`/`Ü` mayúsculas se indexa en una grafía y la raíz conserva otra.
      const rows = store.prepare('SELECT id, uri FROM sources').all();
      const foldedOldPrefix = normalizedOldPrefix.toLowerCase();
      for (const row of rows) {
        const foldedUri = row.uri.replaceAll('/', '\\').toLowerCase();
        if (!foldedUri.startsWith(foldedOldPrefix)) continue;
        if (foldedUri.length > foldedOldPrefix.length && foldedUri[foldedOldPrefix.length] !== '\\') continue;
        const nextUri = newPrefix + row.uri.slice(oldPrefix.length);
        const existing = store.prepare('SELECT id FROM sources WHERE uri = ? AND id <> ?').get(nextUri, row.id);
        if (existing) {
          // La pasada nueva llegó antes: conservar la fuente nueva y retirar la vieja evita que el
          // mismo fichero viva dos veces; no se toca ninguna otra fuente.
          store.prepare('DELETE FROM sources WHERE id = ?').run(row.id);
          removed += 1;
        } else {
          store.prepare('UPDATE sources SET uri = ?, updated_at = ? WHERE id = ?').run(nextUri, now, row.id);
          moved += 1;
        }
      }
    }, { immediate: true });
  } finally {
    store.close();
  }
  // `sync_state` es del registro global; se retira el estado del root viejo si todavía existe. El
  // siguiente sync reconstruye el estado del root nuevo y reconoce las fuentes ya reasignadas.
  if (fromRootId) {
    db.prepare(`DELETE FROM sync_state WHERE scope_kind = 'prj' AND scope_id = ? AND root_id = ?`)
      .run(projectId, fromRootId);
  }
  return { moved, removed };
}

/** Ejecuta una obligación de rekey pendiente. Un fallo deja la operación `started` para reintentar. */
export function runRekeyOperation(db, { operation, profileRoot, profileKey, now = Date.now() } = {}) {
  const detail = operationDetail(operation);
  if (!detail?.project_id || !detail?.from_path || !detail?.to_path) {
    finishOperation(db, {
      operationId: operation.id, state: 'failed', now,
      detail: { reason: 'rekey-detail-missing' },
    });
    return { state: 'failed', reason: 'rekey-detail-missing' };
  }
  try {
    const result = rekeyScopeAfterMove(db, {
      profileRoot, profileKey, projectId: detail.project_id,
      fromPath: detail.from_path, toPath: detail.to_path,
      fromRootId: detail.from_root_id, toRootId: detail.to_root_id, now,
    });
    finishOperation(db, {
      operationId: operation.id, state: 'committed', now,
      detail: { ...detail, result: result ?? { moved: 0, removed: 0 } },
    });
    // Si esta obligación nació de un move cuyo paso `rekey` quedó `failed` (por ejemplo, porque
    // falló el INSERT de esta propia operación), el rekey ya está hecho: se marca el paso y se cierra
    // el move/intención que quedaron atascados. Sin esto el proyecto quedaba excluido del sync para
    // siempre aunque el rekey se hubiera completado.
    finishSourceMoveAfterRekey(db, detail, now);
    // Aunque el move ya estuviera `committed` (fallo de rekey tras el rebind), la petición de sync
    // pudo consumirse como `scope-not-syncable` mientras el rekey estaba pendiente. Al completarlo
    // se encola una pasada nueva; la ruta destino ya está lista y no se duplica ninguna fuente.
    enqueueSync(db, { projectId: detail.project_id, reason: 'recovery', now });
    appendRegistryAudit(db, {
      at: now, actor: 'human', sessionId: null, action: 'tracking.move.rekey', target: detail.project_id,
      outcome: 'ok', detail: { operationId: operation.id, ...detail, ...(result ?? {}) },
    });
    return { state: 'committed', ...(result ?? {}) };
  } catch (error) {
    appendRegistryAudit(db, {
      at: now, actor: 'human', sessionId: null, action: 'tracking.move.rekey', target: detail.project_id,
      outcome: 'failed', detail: { operationId: operation.id, code: error?.code ?? 'internal' },
    });
    throw error;
  }
}

function finishSourceMoveAfterRekey(db, detail, now) {
  const sourceOperationId = detail?.source_operation_id;
  if (!sourceOperationId) return;
  const source = getOperation(db, sourceOperationId);
  if (!source || source.state !== 'started') return;
  try {
    withTransaction(db, () => {
      const rekeyStep = listSteps(db, sourceOperationId).find((step) => step.step === 'rekey');
      if (rekeyStep && rekeyStep.state !== 'done') {
        recordStep(db, { operationId: sourceOperationId, step: 'rekey', state: 'done', now });
      }
      const steps = listSteps(db, sourceOperationId);
      if (steps.some((step) => step.state !== 'done')) return;
      const sourceDetail = operationDetail(source) ?? {};
      finishOperation(db, {
        operationId: sourceOperationId, state: 'committed', now,
        detail: { ...sourceDetail, result: 'recovered-after-rekey' },
      });
      const intent = listOpenIntents(db).find((row) => row.state === 'open' && row.operationId === sourceOperationId);
      if (intent) {
        finishProvisionIntent(db, { pathKey: intent.pathKey, operationId: sourceOperationId, now, state: 'done' });
      }
    }, { immediate: true });
    enqueueSync(db, { projectId: detail.project_id, reason: 'recovery', now });
  } catch (error) {
    try {
      appendRegistryAudit(db, {
        at: now, actor: 'host', sessionId: null, action: 'tracking.move.recovery.failed',
        target: sourceOperationId, outcome: 'failed',
        detail: { reason: 'close-after-rekey', code: error?.code ?? 'internal' },
      });
    } catch { /* el rekey ya está confirmado; la recuperación reintenta el cierre */ }
  }
}

function queueRekey(db, {
  projectId, fromPath, toPath, fromRootId, toRootId, sourceOperationId, now, ownerPid = process.pid,
}) {
  const rows = db.prepare(`SELECT id, detail FROM operations
      WHERE kind = ? AND state = 'started' ORDER BY started_at, id`).all(REKEY_KIND);
  for (const row of rows) {
    const detail = operationDetail(row);
    if (detail?.project_id === projectId && detail?.from_path === fromPath && detail?.to_path === toPath) {
      return row.id;
    }
  }
  const detail = {
    reason: 'move-rekey', project_id: projectId,
    from_path: fromPath, to_path: toPath, from_root_id: fromRootId, to_root_id: toRootId,
    source_operation_id: sourceOperationId, owner_pid: ownerPid ?? null,
  };
  const operation = beginOperation(db, { kind: REKEY_KIND, detail, now });
  appendRegistryAudit(db, {
    at: now, actor: 'human', sessionId: null, action: 'tracking.move.rekey.queued', target: projectId,
    outcome: 'ok', detail: { operationId: operation.id, ...detail },
  });
  return operation.id;
}

function pendingRekeyFor(db, projectId) {
  if (!projectId) return { pending: false, operationId: null, fromPath: null, toPath: null };
  const rows = db.prepare(`SELECT id, detail FROM operations
      WHERE kind = ? AND state = 'started' ORDER BY started_at, id`).all(REKEY_KIND);
  for (const row of rows) {
    const detail = operationDetail(row);
    if (detail?.project_id === projectId) {
      return {
        pending: true, operationId: row.id,
        fromPath: detail.from_path ?? null, toPath: detail.to_path ?? null,
      };
    }
  }
  return { pending: false, operationId: null, fromPath: null, toPath: null };
}

/* ------------------------------------------------------------------ limpieza durable (F-02) */
function cleanupDetailOf(operation) {
  try {
    const detail = operation?.detail ? JSON.parse(operation.detail) : null;
    if (!detail || typeof detail.from_path_key !== 'string' || typeof detail.project_id !== 'string') return null;
    return detail;
  } catch { return null; }
}

/**
 * Limpieza de acceso pendiente de un movimiento ya confirmado. Se representa como una operación
 * `kind='cleanup'` en el journal existente: sobrevive a reinicios, es idempotente y distingue el
 * movimiento (committed) de la limpieza (started hasta que se completa). No es un segundo journal.
 */
export function pendingCleanupFor(db, projectId) {
  if (!projectId) return { pending: false, operationId: null, fromPath: null };
  const rows = db.prepare(`SELECT id, detail FROM operations
      WHERE kind = ? AND state = 'started' ORDER BY started_at, id`).all(CLEANUP_KIND);
  for (const row of rows) {
    const detail = cleanupDetailOf(row);
    if (detail && detail.project_id === projectId) {
      return { pending: true, operationId: row.id, fromPath: detail.from_path ?? null };
    }
  }
  return { pending: false, operationId: null, fromPath: null };
}

function pendingCleanupForPath(db, pathKey) {
  const rows = db.prepare(`SELECT id, detail FROM operations
      WHERE kind = ? AND state = 'started' ORDER BY started_at, id`).all(CLEANUP_KIND);
  for (const row of rows) {
    const detail = cleanupDetailOf(row);
    if (detail?.from_path_key === pathKey) return { pending: true, operationId: row.id, projectId: detail.project_id };
  }
  return null;
}

/** Retira la procedencia de una intención que aún no tiene `project_id` (caída entre consent e
 * identity). No hay proyecto al que asociar una operación de limpieza durable; se retiran las
 * entradas exactas por su clave/raíz. Devuelve si cambió algo; un fallo se propaga. */
function removeConsentWithoutProject(db, { intent, now }) {
  let changed = false;
  if (intent?.consentRootId) {
    const root = db.prepare('SELECT * FROM roots WHERE id = ?').get(intent.consentRootId);
    if (root && root.path_key === intent.pathKey && root.scope_kind === 'prj') {
      db.prepare('DELETE FROM roots WHERE id = ?').run(root.id);
      changed = true;
    }
  }
  if (intent?.consentTrustKey) {
    const removed = deleteTrustedRootByKey(db, { pathKey: intent.consentTrustKey, removedBy: 'human', now });
    changed = changed || removed.changed;
  }
  if (changed) {
    db.prepare(`UPDATE provision_intents
        SET consent_trust_key = NULL, consent_root_id = NULL WHERE path_key = ?`).run(intent.pathKey);
  }
  return changed;
}

function queueAccessCleanup(db, {
  projectId, fromPathKey, fromPath = null, rootId = null, trustKey = null, trustAddedAt = null, sourceOperationId = null, now, ownerPid = process.pid,
}) {
  // No duplicar la obligación si ya hay una limpieza abierta para el mismo proyecto y ruta.
  const rows = db.prepare(`SELECT id, detail FROM operations
      WHERE kind = ? AND state = 'started' ORDER BY started_at, id`).all(CLEANUP_KIND);
  for (const row of rows) {
    const detail = cleanupDetailOf(row);
    if (detail && detail.project_id === projectId && detail.from_path_key === fromPathKey) return row.id;
  }
  const detail = {
    reason: 'move-revoke-old', project_id: projectId,
    from_path_key: fromPathKey, from_path: fromPath,
    root_id: rootId, trust_key: trustKey, trust_added_at: trustAddedAt,
    source_operation_id: sourceOperationId, owner_pid: ownerPid ?? null,
  };
  const operation = beginOperation(db, { kind: CLEANUP_KIND, detail, now });
  appendRegistryAudit(db, {
    at: now, actor: 'human', sessionId: null, action: 'access.cleanup.queued', target: fromPathKey,
    outcome: 'ok', detail: { operationId: operation.id, ...detail },
  });
  return operation.id;
}

/**
 * Ejecuta una limpieza pendiente. Verifica propiedad ANTES de cada borrado: si la raíz o la
 * confianza ya no existen, la limpieza es idempotente; si existen pero no son de este proyecto o de
 * esta ruta, NO se tocan y se registra el motivo. Cualquier error de E/S deja la operación `started`
 * para que la recuperación lo reintente: la obligación no se pierde.
 */
export function runAccessCleanup(db, { operation, now = Date.now() } = {}) {
  const detail = cleanupDetailOf(operation);
  if (!detail) {
    finishOperation(db, {
      operationId: operation.id, state: 'failed', now,
      detail: { reason: 'cleanup-detail-missing' },
    });
    return { state: 'failed', reason: 'cleanup-detail-missing' };
  }
  const result = { root: null, trust: null, skipped: [] };
  withTransaction(db, () => {
    if (detail.root_id) {
      const root = db.prepare('SELECT * FROM roots WHERE id = ?').get(detail.root_id);
      if (!root) {
        result.skipped.push({ kind: 'root', reason: 'already-absent', id: detail.root_id });
      } else if (root.scope_kind === 'prj' && root.scope_id === detail.project_id
        && root.path_key === detail.from_path_key) {
        db.prepare('DELETE FROM roots WHERE id = ?').run(root.id);
        result.root = { id: root.id, path: root.path };
      } else {
        result.skipped.push({ kind: 'root', reason: 'not-owned', id: root.id, path: root.path });
      }
    }
    if (detail.trust_key) {
      if (detail.trust_key !== detail.from_path_key) {
        result.skipped.push({ kind: 'trust', reason: 'not-owned', pathKey: detail.trust_key });
      } else {
        const trust = listTrustedRoots(db).find((entry) => entry.pathKey === detail.trust_key && entry.state === 'trusted');
        if (trust && detail.trust_added_at !== null && detail.trust_added_at !== undefined
          && Number(trust.addedAt) !== Number(detail.trust_added_at)) {
          // La concesión vieja se retiró y se volvió a crear para otra persona/acto: no es la misma
          // entrada. Se deja intacta; la obligación de la concesión original ya no existe.
          result.skipped.push({ kind: 'trust', reason: 'recreated', pathKey: detail.trust_key });
        } else if (trust) {
          removeTrustedRootByKey(db, { pathKey: trust.pathKey, removedBy: 'human', now });
          result.trust = { pathKey: trust.pathKey, path: trust.path };
        } else {
          result.skipped.push({ kind: 'trust', reason: 'already-absent', pathKey: detail.trust_key });
        }
      }
    }
    const currentIntent = getProvisionIntent(db, detail.from_path_key);
    if (!currentIntent || currentIntent.projectId === detail.project_id) {
      // Si la ruta ya fue reclamada por otra identidad, no se marca su intención: sería cerrar una
      // provisión nueva que no tiene nada que ver con este movimiento.
      markIntentRevoked(db, { pathKey: detail.from_path_key, now });
    }
    finishOperation(db, {
      operationId: operation.id, state: 'committed', now,
      detail: { ...detail, cleaned: result, cleaned_at: now },
    });
  }, { immediate: true });
  // La petición de sync del movimiento pudo consumirse como `scope-not-syncable` mientras había dos
  // raíces. Al terminar la limpieza se encola una pasada nueva; sin esto, con automatización apagada
  // la ruta destino quedaría lista pero sin indexar hasta una acción manual.
  try {
    enqueueSync(db, { projectId: detail.project_id, reason: 'cleanup', now });
  } catch (error) {
    appendRegistryAudit(db, {
      at: now, actor: 'host', sessionId: null, action: 'sync.enqueue.failed', target: detail.project_id,
      outcome: 'failed', detail: { operationId: operation.id, reason: 'cleanup', code: error?.code ?? 'internal' },
    });
  }
  appendRegistryAudit(db, {
    at: now, actor: 'human', sessionId: null, action: 'access.cleanup', target: detail.from_path_key,
    outcome: 'ok', detail: { operationId: operation.id, projectId: detail.project_id, ...result },
  });
  return { state: 'committed', ...result };
}

/* ------------------------------------------------------------------ recuperación */

/**
 * Reanuda lo que quedó abierto al arrancar. No repite efectos destructivos a ciegas:
 * - intenciones `open` de provisión se reanudan si la revisión sigue vigente; si no, se abandonan;
 * - una provisión con todos los pasos `done` se cierra `committed` sin re-ejecutar nada;
 * - un movimiento cuyo `rebind` ya ocurrió completa la revocación pendiente; si no ocurrió, se cierra
 *   `failed` (la transacción garantiza que no hay estado intermedio) y una persona lo reintenta.
 *
 * @returns {{provisions: number, committed: number, abandoned: number, skipped: number, moves: number}}
 */
export function recoverLifecycle(db, { profileRoot, profileKey, now = Date.now() } = {}) {
  const summary = {
    provisions: 0, committed: 0, abandoned: 0, skipped: 0, moves: 0, cleanups: 0, cleanupErrors: 0,
    rekeys: 0, rekeyErrors: 0,
  };
  for (const intent of listOpenIntents(db)) {
    const operation = getOperation(db, intent.operationId);
    if (!operation) {
      finishProvisionIntent(db, { pathKey: intent.pathKey, operationId: intent.operationId, now, state: 'abandoned' });
      summary.abandoned += 1;
      continue;
    }
    if (operationOwnerAlive(operation)) {
      // Otro proceso sigue vivo y es el dueño de esta operación: la recuperación no puede
      // compensarle el destino ni cerrarle la intención a mitad de camino.
      summary.skipped += 1;
      continue;
    }
    if (operation.kind === MOVE_KIND) {
      summary.moves += 1;
      try {
        recoverMove(db, { operation, intent, profileRoot, now, summary });
      } catch (error) {
        // Un fallo inesperado de un move no puede impedir que la pasada recupere las demás
        // intenciones. La operación y su intención quedan abiertas para el siguiente arranque.
        summary.skipped += 1;
        try {
          appendRegistryAudit(db, {
            at: now, actor: 'host', sessionId: null, action: 'tracking.move.recovery.failed',
            target: operation.id, outcome: 'failed', detail: { code: error?.code ?? 'internal' },
          });
        } catch { /* no tapar el fallo original */ }
      }
      continue;
    }
    summary.provisions += 1;
    const row = readTracking(db, { pathKey: intent.pathKey });
    if (!row) {
      // La fila se borró antes del arranque, pero la intención conserva la procedencia de una raíz o
      // confianza que el acto creó. No se abandona sin retirarlas: se encola la limpieza durable y se
      // intenta ahora; si no se puede persistir, la intención queda abierta (excluida del sync).
      if (!intent.projectId && (intent.consentRootId || intent.consentTrustKey)) {
        try { removeConsentWithoutProject(db, { intent, now }); } catch { summary.skipped += 1; continue; }
      } else if ((intent.consentRootId || intent.consentTrustKey) && intent.projectId) {
        let cleanupId = null;
        try {
          const trust = intent.consentTrustKey
            ? listTrustedRoots(db).find((entry) => entry.pathKey === intent.consentTrustKey) ?? null
            : null;
          cleanupId = queueAccessCleanup(db, {
            projectId: intent.projectId, fromPathKey: intent.pathKey, fromPath: null,
            rootId: intent.consentRootId, trustKey: intent.consentTrustKey,
            trustAddedAt: trust?.addedAt ?? null, sourceOperationId: operation.id, now, ownerPid: null,
          });
        } catch {
          summary.skipped += 1;
          continue;
        }
        if (cleanupId) {
          try {
            runAccessCleanup(db, { operation: getOperation(db, cleanupId), now });
            summary.cleanups += 1;
          } catch { summary.cleanupErrors += 1; }
        }
      }
      if (operation.state === 'started') {
        finishOperation(db, {
          operationId: operation.id, state: 'failed', now,
          detail: { reason: 'tracking-row-missing', code: 'recovery' },
        });
      }
      finishProvisionIntent(db, { pathKey: intent.pathKey, operationId: operation.id, now, state: 'abandoned' });
      summary.abandoned += 1;
      continue;
    }
    const alreadyAssociated = row.projectId !== null && row.projectId === intent.projectId && row.association === 'explicit';
    if (alreadyAssociated) {
      if (operation.state === 'started') {
        finishOperation(db, { operationId: operation.id, state: 'committed', now, detail: { recovered: 'associate-done' } });
      }
      finishProvisionIntent(db, { pathKey: intent.pathKey, operationId: operation.id, projectId: row.projectId, now });
      requestSync(db, { scopeKind: 'prj', scopeId: row.projectId, reason: 'recovery', now });
      summary.committed += 1;
      continue;
    }
    if (row.state !== 'on' || intent.expectedRevision !== row.revision) {
      // La fila cambió de estado/revisión antes de arrancar. La intención puede conservar una raíz o
      // confianza que este acto creó: se retira de forma durable antes de abandonar, igual que en
      // la rama de fila ausente.
      if (!intent.projectId && (intent.consentRootId || intent.consentTrustKey)) {
        try { removeConsentWithoutProject(db, { intent, now }); } catch { summary.skipped += 1; continue; }
      } else if ((intent.consentRootId || intent.consentTrustKey) && intent.projectId) {
        let cleanupId = null;
        try {
          const trust = intent.consentTrustKey
            ? listTrustedRoots(db).find((entry) => entry.pathKey === intent.consentTrustKey) ?? null
            : null;
          cleanupId = queueAccessCleanup(db, {
            projectId: intent.projectId, fromPathKey: intent.pathKey, fromPath: null,
            rootId: intent.consentRootId, trustKey: intent.consentTrustKey,
            trustAddedAt: trust?.addedAt ?? null, sourceOperationId: operation.id, now, ownerPid: null,
          });
        } catch {
          summary.skipped += 1;
          continue;
        }
        if (cleanupId) {
          try { runAccessCleanup(db, { operation: getOperation(db, cleanupId), now }); summary.cleanups += 1; }
          catch { summary.cleanupErrors += 1; }
        }
      }
      if (operation.state === 'started') {
        finishOperation(db, {
          operationId: operation.id, state: 'failed', now,
          detail: { reason: 'fenced', expectedRevision: intent.expectedRevision, currentRevision: row.revision, state: row.state },
        });
      }
      finishProvisionIntent(db, { pathKey: intent.pathKey, operationId: operation.id, now, state: 'abandoned' });
      summary.abandoned += 1;
      continue;
    }
    try {
      let trackingCreated = false;
      try {
        trackingCreated = Boolean(JSON.parse(operation.detail ?? '{}').tracking_created);
      } catch { /* un detalle ilegible no cambia la compensación de acceso */ }
      provisionWorkspaceMemory(db, {
        profileRoot, profileKey, path: row.path, pathKey: intent.pathKey, expectedRevision: row.revision, now,
        recovering: true, trackingCreated,
      });
      summary.committed += 1;
    } catch (error) {
      // Una carpeta ausente no invalida la intención: se deja abierta para cuando vuelva.
      if (error?.code === 'workspace-missing'
        || error?.details?.cause === 'workspace-missing' || error?.cause?.code === 'workspace-missing') {
        summary.skipped += 1;
      } else {
        summary.abandoned += 1;
      }
    }
  }
  // Rekeys pendientes de un movimiento ya confirmado. Se ejecutan antes del sync para que la ruta
  // nueva no se ingiera otra vez como un documento distinto.
  for (const operation of listInterruptedOperations(db, { kind: REKEY_KIND })) {
    if (operationOwnerAlive(operation)) {
      summary.skipped += 1;
      continue;
    }
    try {
      runRekeyOperation(db, { operation, profileRoot, profileKey, now });
      summary.rekeys += 1;
    } catch (error) {
      summary.rekeyErrors += 1;
      try {
        appendRegistryAudit(db, {
          at: now, actor: 'host', sessionId: null, action: 'tracking.move.rekey.retry', target: operation.id,
          outcome: 'failed', detail: { code: error?.code ?? 'internal', message: error?.message ?? null },
        });
      } catch { /* no tapar el error original */ }
    }
  }
  // Limpiezas de acceso pendientes de un movimiento ya confirmado. Se reintentan en cada arranque;
  // si el error persiste, la operación sigue `started` y el fallo queda auditado (F-02).
  for (const operation of listInterruptedOperations(db, { kind: CLEANUP_KIND })) {
    if (operationOwnerAlive(operation)) {
      summary.skipped += 1;
      continue;
    }
    try {
      runAccessCleanup(db, { operation, now });
      summary.cleanups += 1;
    } catch (error) {
      summary.cleanupErrors += 1;
      try {
        appendRegistryAudit(db, {
          at: now, actor: 'host', sessionId: null, action: 'access.cleanup.retry', target: operation.id,
          outcome: 'failed', detail: { code: error?.code ?? 'internal', message: error?.message ?? null },
        });
      } catch { /* no tapar el error original */ }
    }
  }
  // Operaciones `started` sin intención (caída entre abrir la operación y persistir la intención):
  // no las reclama ninguna recuperación y quedarían mintiendo para siempre. Se cierran con evidencia
  // de que no hay paso que reanudar; no se repite ningún efecto.
  const referenced = new Set(listProvisionIntents(db).map((intent) => intent.operationId));
  for (const operation of listInterruptedOperations(db)) {
    if (operationOwnerAlive(operation)) continue;
    if (referenced.has(operation.id)) continue;
    // Sólo las operaciones del ciclo de vida. Una sincronización viva de otro proceso no se toca.
    if (operation.kind !== PROVISION_KIND && operation.kind !== MOVE_KIND) continue;
    finishOperation(db, {
      operationId: operation.id, state: 'failed', now,
      detail: { reason: 'orphan-operation', kind: operation.kind },
    });
    summary.abandoned += 1;
  }
  return summary;
}

/**
 * Compensa un movimiento que no llegó al `rebind`: retira la raíz y la confianza que el acto creó en
 * el destino. Sin esto, la recuperación dejaba dos raíces autorizadas del mismo proyecto y el
 * planificador indexaba las dos carpetas en una sola memoria (H-01). No toca entradas preexistentes:
 * sólo actúa sobre lo que la intención del destino registra como propio.
 */
function compensateMoveDestination(db, { intent, projectId, toPathKey, now }) {
  const result = { root: null, trust: null };
  if (!intent || intent.pathKey !== toPathKey || intent.projectId !== projectId) return result;
  let expectedTrustAddedAt = null;
  if (intent.operationId) {
    const source = getOperation(db, intent.operationId);
    expectedTrustAddedAt = operationDetail(source)?.trust_added_at ?? null;
  }
  if (intent.consentRootId) {
    const root = db.prepare('SELECT * FROM roots WHERE id = ?').get(intent.consentRootId);
    if (root && root.scope_kind === 'prj' && root.scope_id === projectId && root.path_key === toPathKey) {
      db.prepare('DELETE FROM roots WHERE id = ?').run(root.id);
      result.root = { id: root.id, path: root.path };
    }
  }
  if (intent.consentTrustKey === toPathKey) {
    const current = listTrustedRoots(db).find((entry) => entry.pathKey === toPathKey && entry.state === 'trusted');
    // Una confianza recreada después de la caída tiene otro `addedAt`: no es la que este acto creó
    // y no se puede retirar. Sin la marca (intenciones antiguas) se conserva el comportamiento previo.
    const stillOurs = !current || expectedTrustAddedAt === null
      || Number(current.addedAt) === Number(expectedTrustAddedAt);
    if (stillOurs) {
      const removed = deleteTrustedRootByKey(db, { pathKey: toPathKey, removedBy: 'human', now });
      if (removed.changed) result.trust = { pathKey: toPathKey, path: removed.root.path };
    }
  }
  if (result.root || result.trust) {
    appendRegistryAudit(db, {
      at: now, actor: 'human', sessionId: null, action: 'access.revoke.compensated', target: toPathKey,
      outcome: 'ok',
      detail: { reason: 'move-recovery-before-rebind', projectId, ...result },
    });
  }
  return result;
}

function recoverFailedMoveSteps(db, operationId, now) {
  for (const step of listSteps(db, operationId)) {
    if (step.state === 'failed' && (step.step === 'revoke-old' || step.step === 'record')) {
      recordStep(db, { operationId, step: step.step, state: 'done', now });
    }
  }
}

function recoverMove(db, { operation, intent, profileRoot, now, summary }) {
  let detail = null;
  try { detail = operation.detail ? JSON.parse(operation.detail) : null; } catch { detail = null; }
  if (!detail?.from_path_key || !detail?.to_path_key) {
    if (operation.state === 'started') {
      finishOperation(db, { operationId: operation.id, state: 'failed', now, detail: { reason: 'move-detail-missing' } });
    }
    finishProvisionIntent(db, { pathKey: intent.pathKey, operationId: operation.id, now, state: 'abandoned' });
    summary.abandoned += 1;
    return;
  }
  const destination = readTracking(db, { pathKey: detail.to_path_key });
  const source = readTracking(db, { pathKey: detail.from_path_key });
  if (destination && destination.projectId === detail.project_id) {
    // Si la caída fue entre el rebind y el rekey, la obligación no está todavía en el journal:
    // se crea aquí y se intenta antes de retirar el acceso. Si la obligación no se puede persistir,
    // NO se puede seguir: retirar el acceso y cerrar dejaría el proyecto sincronizable sin rekey y
    // el siguiente pase duplicaría las fuentes (R-1). Se deja el move/intención abiertos para el
    // próximo arranque, exactamente como con una limpieza que no se pudo representar.
    try {
      const fromIntent = getProvisionIntent(db, detail.from_path_key);
      const toIntent = getProvisionIntent(db, detail.to_path_key);
      const rekeyOperationId = queueRekey(db, {
        projectId: detail.project_id,
        fromPath: detail.from_path ?? fromIntent?.consentTrustKey ?? null,
        toPath: detail.to_path ?? null,
        fromRootId: fromIntent?.consentRootId ?? null,
        toRootId: toIntent?.consentRootId ?? null,
        sourceOperationId: operation.id, now, ownerPid: null,
      });
      // La pasada de rekeys del arranque ejecuta la obligación inmediatamente después de cerrar
      // las intenciones; ejecutarla aquí también la duplicaría y podría marcar un error ya resuelto.
      void rekeyOperationId;
    } catch (error) {
      summary.rekeyErrors += 1;
      summary.skipped += 1;
      appendRegistryAudit(db, {
        at: now, actor: 'host', sessionId: null, action: 'tracking.move.rekey.retry',
        target: detail.to_path_key, outcome: 'failed', detail: { code: error?.code ?? 'internal' },
      });
      return;
    }
    // El rebind ocurrió. Se completa lo pendiente (revoke-old) sin repetir el resto.
    try {
      const owned = ownedConsentOf(db, detail.from_path_key);
      if (owned.intent && !owned.intent.revokedAt) {
        if (owned.rootId) {
          const root = db.prepare('SELECT * FROM roots WHERE id = ?').get(owned.rootId);
          if (root && root.path_key === detail.from_path_key && root.scope_id === detail.project_id) {
            db.prepare('DELETE FROM roots WHERE id = ?').run(root.id);
          }
        }
        if (owned.trustKey) {
          const trust = listTrustedRoots(db).find((entry) => entry.pathKey === detail.from_path_key && entry.state === 'trusted');
          if (trust) removeTrustedRootByKey(db, { pathKey: trust.pathKey, removedBy: 'human', now });
        }
        markIntentRevoked(db, { pathKey: detail.from_path_key, now });
      }
      // Un paso `revoke-old`/`record` que quedó `failed` por la caída ya está atendido por esta
      // recuperación (acceso retirado o limpieza durable encolada). Se cierra como `done` para que
      // `committed` no quede bloqueado por un paso que la propia recuperación ha resuelto.
      recoverFailedMoveSteps(db, operation.id, now);
      finishOperation(db, {
        operationId: operation.id, state: 'committed', now,
        detail: { ...detail, result: 'recovered-after-rebind' },
      });
      summary.committed += 1;
    } catch (error) {
      // Si retirar el acceso viejo vuelve a fallar (mismo E/S que provocó la caída), NO se puede
      // declarar el movimiento `failed` ni perder la obligación: el rebind es un hecho. Se encola
      // la limpieza durable (F-02) y el movimiento queda `committed`.
      let cleanupOperationId = null;
      try {
        const stale = getProvisionIntent(db, detail.from_path_key);
        if (stale && stale.projectId === detail.project_id) {
          const root = stale.consentRootId
            ? db.prepare('SELECT * FROM roots WHERE id = ?').get(stale.consentRootId)
            : null;
          const rootOwned = Boolean(root && root.scope_kind === 'prj'
            && root.scope_id === detail.project_id && root.path_key === detail.from_path_key);
          const trustKey = stale.consentTrustKey === detail.from_path_key ? detail.from_path_key : null;
          const trustEntry = trustKey
            ? listTrustedRoots(db).find((entry) => entry.pathKey === trustKey && entry.state === 'trusted')
            : null;
          const trustOwned = Boolean(trustEntry);
          if (rootOwned || trustOwned) {
            cleanupOperationId = queueAccessCleanup(db, {
              projectId: detail.project_id, fromPathKey: detail.from_path_key, fromPath: detail.from_path,
              rootId: rootOwned ? root.id : null, trustKey: trustOwned ? trustKey : null,
              trustAddedAt: trustEntry?.addedAt ?? null,
              sourceOperationId: operation.id, now, ownerPid: null,
            });
          }
        }
      } catch { /* se conserva la operación abierta para el siguiente arranque */ }
      if (cleanupOperationId) {
        recoverFailedMoveSteps(db, operation.id, now);
        finishOperation(db, {
          operationId: operation.id, state: 'committed', now,
          detail: { ...detail, result: 'recovered-after-rebind', cleanup_operation_id: cleanupOperationId },
        });
        appendRegistryAudit(db, {
          at: now, actor: 'host', sessionId: null, action: 'access.revoke.skipped',
          target: detail.from_path_key, outcome: 'failed',
          detail: { operationId: operation.id, reason: 'recovery-revoke-failed', cleanupOperationId, code: error?.code ?? 'internal' },
        });
        summary.committed += 1;
      } else {
        // El journal y la intención siguen abiertos: la recuperación lo reintenta en el próximo
        // arranque. No se finge una limpieza que no se pudo representar.
        appendRegistryAudit(db, {
          at: now, actor: 'host', sessionId: null, action: 'access.revoke.skipped',
          target: detail.from_path_key, outcome: 'failed',
          detail: { operationId: operation.id, reason: 'recovery-queue-failed', code: error?.code ?? 'internal' },
        });
        summary.skipped += 1;
        return;
      }
    }
    // La intención destino sólo se cierra `done` si la operación quedó realmente `committed`.
    const finalOperation = getOperation(db, operation.id);
    finishProvisionIntent(db, {
      pathKey: intent.pathKey, operationId: operation.id, now,
      state: finalOperation?.state === 'committed' ? 'done' : 'abandoned',
    });
    if (finalOperation?.state === 'committed') {
      enqueueSync(db, { projectId: detail.project_id, reason: 'recovery', now });
    }
    return;
  }
  if (!destination && source && source.projectId === detail.project_id) {
    // No hubo rebind: se compensa lo que el acto creó en el destino y se cierra. Así queda UNA raíz
    // (la de origen), el proyecto sigue siendo 1:1 y el intento puede repetirse sin admin. Un fallo de
    // E/S no puede abortar la pasada de recuperación ni cerrar el move a ciegas: se deja abierto para
    // el siguiente arranque y se audita.
    try {
      withTransaction(db, () => {
        const compensation = compensateMoveDestination(db, {
          intent, projectId: detail.project_id, toPathKey: detail.to_path_key, now,
        });
        finishOperation(db, {
          operationId: operation.id, state: 'failed', now,
          detail: { ...detail, reason: 'not-rebound', compensated: Boolean(compensation.root || compensation.trust) },
        });
        finishProvisionIntent(db, { pathKey: intent.pathKey, operationId: operation.id, now, state: 'abandoned' });
        if (compensation.root || compensation.trust) {
          db.prepare(`UPDATE provision_intents
              SET consent_trust_key = NULL, consent_root_id = NULL WHERE path_key = ?`).run(intent.pathKey);
        }
      }, { immediate: true });
      summary.abandoned += 1;
    } catch (error) {
      appendRegistryAudit(db, {
        at: now, actor: 'host', sessionId: null, action: 'access.revoke.skipped',
        target: detail.to_path_key, outcome: 'failed',
        detail: { operationId: operation.id, reason: 'recovery-not-rebound-failed', code: error?.code ?? 'internal' },
      });
      summary.skipped += 1;
    }
    return;
  }
  // Estado inesperado: el destino no tiene fila y el origen tampoco (el ganador de un doble move
  // a otro destino ya borró la fila de origen). No se puede abandonar sin compensar lo que este acto
  // creó en su destino: quedarían dos raíces del proyecto y el sync indexaría una carpeta ajena.
  let compensated = false;
  let cleanupOperationId = null;
  try {
    const compensation = compensateMoveDestination(db, {
      intent, projectId: detail.project_id, toPathKey: detail.to_path_key, now,
    });
    compensated = Boolean(compensation.root || compensation.trust);
  } catch (error) {
    try {
      const stale = getProvisionIntent(db, detail.to_path_key);
      if (stale && stale.projectId === detail.project_id) {
        const root = stale.consentRootId
          ? db.prepare('SELECT * FROM roots WHERE id = ?').get(stale.consentRootId)
          : null;
        const rootOwned = Boolean(root && root.scope_kind === 'prj'
          && root.scope_id === detail.project_id && root.path_key === detail.to_path_key);
        const trustKey = stale.consentTrustKey === detail.to_path_key ? detail.to_path_key : null;
        const trustEntry = trustKey
          ? listTrustedRoots(db).find((entry) => entry.pathKey === trustKey && entry.state === 'trusted')
          : null;
        if (rootOwned || trustEntry) {
          cleanupOperationId = queueAccessCleanup(db, {
            projectId: detail.project_id, fromPathKey: detail.to_path_key, fromPath: detail.to_path,
            rootId: rootOwned ? root.id : null, trustKey: trustEntry ? trustKey : null,
            trustAddedAt: trustEntry?.addedAt ?? null,
            sourceOperationId: operation.id, now, ownerPid: null,
          });
        }
      }
    } catch { /* la operación queda abierta para el siguiente arranque */ }
    if (!cleanupOperationId) {
      // No se pudo representar la obligación: no se cierra el move como si estuviera limpio.
      appendRegistryAudit(db, {
        at: now, actor: 'host', sessionId: null, action: 'access.revoke.skipped',
        target: detail.to_path_key, outcome: 'failed',
        detail: { operationId: operation.id, reason: 'unexpected-state-compensation-failed', code: error?.code ?? 'internal' },
      });
      summary.skipped += 1;
      return;
    }
  }
  finishOperation(db, {
    operationId: operation.id, state: 'failed', now,
    detail: { ...detail, reason: 'unexpected-state', compensated, cleanup_operation_id: cleanupOperationId },
  });
  finishProvisionIntent(db, { pathKey: intent.pathKey, operationId: operation.id, now, state: 'abandoned' });
  if (compensated && !cleanupOperationId) {
    db.prepare(`UPDATE provision_intents
        SET consent_trust_key = NULL, consent_root_id = NULL WHERE path_key = ?`).run(intent.pathKey);
  }
  summary.abandoned += 1;
}
