/**
 * UX-2.2 · Almacén transaccional del seguimiento sobre el **registro del perfil**.
 *
 * Recibe la conexión ya abierta (`openRegistry`), nunca abre ficheros ni conoce al Host. Toda
 * escritura va dentro de `BEGIN IMMEDIATE` con compare-and-swap por `revision`: un cliente que no
 * conoce la revisión vigente recibe `revision-conflict` y **no** escribe, en vez de pisar el cambio
 * ajeno.
 *
 * Reparto de responsabilidades:
 * - `lib/tracking.mjs` decide (transiciones, eje B, proyección); aquí no se duplica esa lógica.
 * - `appendRegistryAudit` sella cada mutación en la cadena del registro. Las acciones humanas
 *   (`enable`/`disable`/`pause`/`resume`/`reassociate`) van con `actor='human'`; la reconciliación
 *   técnica va sólo una vez por llamada, con `action='tracking.reconcile'` y `actor='host'`, y jamás
 *   toca el eje A (`D-UX22-08`, `D-UX22-11`).
 */

import { RagError } from './errors.mjs';
import { appendRegistryAudit } from './registry.mjs';
import { storeFailure, withTransaction } from './db.mjs';
import {
  TRACKING_ACTIONS,
  TRACKING_STATES,
  TRACKING_STATUSES,
  actionForTransition,
  applyReconcile,
  isTrackingState,
  normalizeTrackingRow,
} from './tracking.mjs';

/** Tope de filas que devuelve un listado; el cliente no puede saltárselo con un `limit` enorme. */
export const TRACKING_LIST_MAX = 1_000;
const TRACKING_LIST_DEFAULT = 200;

function invalid(message, details) {
  return new RagError('invalid-argument', message, { details });
}

/**
 * F10 · Traduce un fallo **inesperado** de las mutaciones a una condición del almacén.
 *
 * Un `BEGIN IMMEDIATE` que agota `busy_timeout` sale de `node:sqlite` como excepción cruda
 * (`database is locked`, errcode 5): sin esta puerta, el handler la respondía `500 internal`, que
 * invita a no reintentar. La clasificación se **reutiliza** de `lib/db.mjs` (`storeFailure`, que ya
 * distingue contención de corrupción); aquí sólo se añade el `reason` que el contrato de la API
 * publica. Un `RagError` (validación, CAS, transición) se deja pasar tal cual: ya está clasificado.
 * El último recurso sí es `internal`, porque un fallo no identificado no debe disfrazarse de
 * corrupción del fichero.
 */
function guardStore(work) {
  try {
    return work();
  } catch (error) {
    if (error instanceof RagError) throw error;
    const classified = storeFailure(error);
    if (classified && classified.code === 'store-busy') {
      throw new RagError('store-busy', 'el almacén del seguimiento está ocupado por otra conexión; reintenta', {
        details: { reason: 'database-locked', retryable: true, errcode: Number(error?.errcode ?? 0) },
        cause: error,
      });
    }
    if (classified) throw classified;
    throw new RagError('internal', 'el almacén del seguimiento falló al escribir', {
      details: { reason: 'unclassified' },
      cause: error,
    });
  }
}

function requirePathKey(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4_096 || value.includes('\0')) {
    throw invalid('pathKey debe ser una clave de ruta no vacía', {
      reason: typeof value === 'string' ? 'invalid-field' : 'missing-field',
      field: 'pathKey',
    });
  }
  return value;
}

function requireExpectedRevision(value) {
  if (value === undefined || value === null) {
    throw invalid('falta expectedRevision', { reason: 'missing-field', field: 'expectedRevision' });
  }
  if (!Number.isInteger(value) || value < 0) {
    throw invalid('expectedRevision debe ser un entero no negativo', {
      reason: 'invalid-field', field: 'expectedRevision',
    });
  }
  return value;
}

/**
 * Proyecto válido o `null`. `undefined` significa «no lo toques» (actualización parcial), `null`
 * significa «déjalo pendiente» (quitar la asociación). Un id de otro perfil no se acepta: la fila
 * quedaría apuntando a un proyecto inexistente y la reconciliación no podría resolverlo.
 */
function requireProjectId(db, projectId) {
  if (projectId === undefined) return undefined;
  if (projectId === null) return null;
  if (typeof projectId !== 'string' || !projectId.startsWith('prj_') || projectId.length !== 30) {
    throw invalid('projectId no es un identificador de proyecto', {
      reason: 'invalid-field', field: 'projectId',
    });
  }
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    throw invalid('el proyecto no existe en este perfil', {
      reason: 'unknown-project', field: 'projectId', project: projectId,
    });
  }
  return projectId;
}

/** La transición que representa **crear** una fila con un estado inicial dado. */
function creationActionFor(state) {
  if (state === 'on') return TRACKING_ACTIONS.enable;
  if (state === 'off') return TRACKING_ACTIONS.disable;
  return TRACKING_ACTIONS.pause;
}

function rawRow(db, pathKey) {
  return db.prepare('SELECT * FROM workspace_tracking WHERE path_key = ?').get(pathKey) ?? null;
}

/** Fila del seguimiento ya proyectada, o `null` si no está seguida. */
export function readTracking(db, { pathKey } = {}) {
  return normalizeTrackingRow(rawRow(db, requirePathKey(pathKey)));
}

/**
 * Filtros compartidos por `listTracking` y `countTracking`: una sola validación y un solo WHERE para
 * que la página y el recuento no puedan divergir. `state` filtra el eje A; `projectId` acepta un id
 * (con proyecto) o `null` (sin proyecto).
 */
function trackingFilters({ state, projectId } = {}) {
  if (state !== undefined && !isTrackingState(state)) {
    throw invalid('state no es un estado de seguimiento', {
      reason: 'invalid-field', field: 'state', value: state ?? null,
    });
  }
  const where = [];
  const params = [];
  if (state !== undefined) {
    where.push('state = ?');
    params.push(state);
  }
  if (projectId === null) {
    where.push('project_id IS NULL');
  } else if (projectId !== undefined) {
    // Filtro, no escritura: un id bien formado que no exista devuelve lista vacía, no un 400.
    if (typeof projectId !== 'string' || !projectId.startsWith('prj_')) {
      throw invalid('projectId no es un identificador de proyecto', {
        reason: 'invalid-field', field: 'projectId',
      });
    }
    where.push('project_id = ?');
    params.push(projectId);
  }
  return { clause: where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * Listado de filas, proyectadas. `limit` se acota al tope del módulo. Las filas son la **página**;
 * para el total del conjunto se usa `countTracking` (F15).
 */
export function listTracking(db, { state, projectId, limit = TRACKING_LIST_DEFAULT } = {}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw invalid('limit debe ser un entero positivo', { reason: 'invalid-field', field: 'limit' });
  }
  const capped = Math.min(limit, TRACKING_LIST_MAX);
  const { clause, params } = trackingFilters({ state, projectId });
  const sql = `SELECT * FROM workspace_tracking${clause} ORDER BY path_key LIMIT ?`;
  return db.prepare(sql).all(...params, capped).map(normalizeTrackingRow);
}

/**
 * F15 · Recuentos del **conjunto filtrado completo**, calculados por SQL y no sumando la página.
 *
 * Antes el sobre de `GET /tracking` contaba sobre las 1000 filas que caben en un listado: con más,
 * `counts.total` mentía sin decirlo. `COUNT(*)` y los `COUNT(CASE …)` recorren la tabla con el mismo
 * WHERE que el listado, así que la página puede ser corta y el recuento seguir siendo cierto. Misma
 * forma que `trackingCounts` (`lib/tracking.mjs`), que sigue siendo el criterio de lectura.
 */
export function countTracking(db, { state, projectId } = {}) {
  const { clause, params } = trackingFilters({ state, projectId });
  const row = db.prepare(`SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN state = '${TRACKING_STATES.on}' THEN 1 END) AS on_count,
      COUNT(CASE WHEN state = '${TRACKING_STATES.off}' THEN 1 END) AS off_count,
      COUNT(CASE WHEN state = '${TRACKING_STATES.paused}' THEN 1 END) AS paused_count,
      COUNT(CASE WHEN last_status = '${TRACKING_STATUSES.ok}' THEN 1 END) AS ok_count,
      COUNT(CASE WHEN last_status = '${TRACKING_STATUSES.missing}' THEN 1 END) AS missing_count,
      COUNT(CASE WHEN last_status = '${TRACKING_STATUSES.unknown}' THEN 1 END) AS unknown_count,
      COUNT(CASE WHEN project_id IS NOT NULL THEN 1 END) AS with_project_count
    FROM workspace_tracking${clause}`).get(...params);
  const total = Number(row?.total ?? 0);
  const withProject = Number(row?.with_project_count ?? 0);
  return {
    total,
    on: Number(row?.on_count ?? 0),
    off: Number(row?.off_count ?? 0),
    paused: Number(row?.paused_count ?? 0),
    ok: Number(row?.ok_count ?? 0),
    missing: Number(row?.missing_count ?? 0),
    unknown: Number(row?.unknown_count ?? 0),
    withProject,
    withoutProject: total - withProject,
  };
}

/**
 * Crea o actualiza la fila de seguimiento si —y sólo si— la revisión esperada es la vigente.
 *
 * `expectedRevision: 0` significa «espero que no exista» y crea. Con fila existente, cualquier
 * discrepancia es `revision-conflict` **sin escribir**. Repetir la misma petición no sube la
 * revisión (`changed: false`).
 *
 * @returns {{changed: boolean, item: object, revision: number}}
 */
export function applyTracking(db, input = {}) {
  // F10: la contención de `BEGIN IMMEDIATE` se traduce a `store-busy`, no a un 500 crudo.
  return guardStore(() => applyTrackingWork(db, input));
}

function applyTrackingWork(db, {
  pathKey, path, workspaceId, state, projectId,
  expectedRevision, now = Date.now(), actor = 'human',
} = {}) {
  const key = requirePathKey(pathKey);
  if (!isTrackingState(state)) {
    throw invalid('state no es un estado de seguimiento', {
      reason: 'invalid-field', field: 'state', value: state ?? null,
    });
  }
  if (actor !== 'human') {
    // `D-UX22-09`/`D-UX22-11`: sólo una persona mueve el eje A; el Host reconcilia, no decide.
    throw invalid('sólo una persona puede cambiar el seguimiento de un workspace', {
      reason: 'actor-not-allowed', actor: actor ?? null,
    });
  }
  if (workspaceId !== undefined && workspaceId !== null && typeof workspaceId !== 'string') {
    throw invalid('workspaceId debe ser texto o nulo', { reason: 'invalid-field', field: 'workspaceId' });
  }
  const expected = requireExpectedRevision(expectedRevision);
  const requestedProject = requireProjectId(db, projectId);
  const at = String(now);

  return withTransaction(db, () => {
    const current = rawRow(db, key);

    if (!current) {
      if (expected !== 0) {
        // El cliente creía conocer una fila que ya no está: es el mismo hecho que una revisión vieja.
        throw new RagError('revision-conflict', 'la fila de seguimiento ya no existe', {
          details: { reason: 'revision-mismatch', pathKey: key, expectedRevision: expected, currentRevision: 0 },
        });
      }
      if (typeof path !== 'string' || path.trim() === '') {
        throw invalid('al crear el seguimiento hace falta la ruta del workspace', {
          reason: 'missing-field', field: 'path',
        });
      }
      const nextProjectId = requestedProject ?? null;
      const association = nextProjectId === null ? 'pending' : 'explicit';
      db.prepare(`INSERT INTO workspace_tracking
          (path_key, path, workspace_id, project_id, state, association, bound_by, bound_at, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, 'human', ?, ?, 1)`)
        .run(key, path, workspaceId ?? null, nextProjectId, state, association, at, at);
      appendRegistryAudit(db, {
        at: now,
        actor: 'human',
        sessionId: null,
        action: creationActionFor(state),
        target: key,
        outcome: 'ok',
        detail: {
          pathKey: key,
          revision: 1,
          previous: null,
          next: { state, projectId: nextProjectId, association },
        },
      });
      return { changed: true, item: readTracking(db, { pathKey: key }), revision: 1 };
    }

    if (Number(current.revision) !== expected) {
      throw new RagError('revision-conflict', 'el seguimiento cambió mientras lo editabas', {
        details: {
          reason: 'revision-mismatch',
          pathKey: key,
          expectedRevision: expected,
          currentRevision: Number(current.revision),
        },
      });
    }

    const nextProjectId = requestedProject === undefined ? (current.project_id ?? null) : requestedProject;
    const nextAssociation = nextProjectId === null ? 'pending' : 'explicit';
    const nextWorkspaceId = workspaceId === undefined ? (current.workspace_id ?? null) : (workspaceId ?? null);

    const stateChanged = current.state !== state;
    const projectChanged = (current.project_id ?? null) !== nextProjectId;
    const associationChanged = current.association !== nextAssociation;
    const workspaceChanged = (current.workspace_id ?? null) !== nextWorkspaceId;
    // `path` queda congelada al crear la fila (`D-IMPL-07`): después sólo la reconciliación la
    // actualiza con la ruta que informa el Host. Un PUT no puede reescribirla en silencio.

    if (!stateChanged && !projectChanged && !associationChanged && !workspaceChanged) {
      // Clic repetido: mismo estado, misma revisión, ninguna entrada de auditoría.
      return { changed: false, item: normalizeTrackingRow(current), revision: Number(current.revision) };
    }

    // Se valida ANTES de escribir: `off → paused` no existe y la transacción no debe dejar rastro.
    const transitionAction = stateChanged ? actionForTransition(current.state, state) : null;
    const nextRevision = Number(current.revision) + 1;
    const nextBoundAt = projectChanged ? at : current.bound_at;
    const info = db.prepare(`UPDATE workspace_tracking
        SET workspace_id = ?, project_id = ?, state = ?, association = ?,
            bound_by = 'human', bound_at = ?, updated_at = ?, revision = ?
      WHERE path_key = ? AND revision = ?`)
      .run(
        nextWorkspaceId, nextProjectId, state, nextAssociation,
        nextBoundAt, at, nextRevision, key, Number(current.revision),
      );
    if (Number(info.changes) !== 1) {
      throw new RagError('revision-conflict', 'el seguimiento cambió durante la escritura', {
        details: { reason: 'revision-mismatch', pathKey: key, expectedRevision: expected },
      });
    }

    if (transitionAction) {
      appendRegistryAudit(db, {
        at: now,
        actor: 'human',
        sessionId: null,
        action: transitionAction,
        target: key,
        outcome: 'ok',
        detail: {
          pathKey: key,
          revision: nextRevision,
          previous: { state: current.state, projectId: current.project_id ?? null },
          next: { state, projectId: nextProjectId },
        },
      });
    }
    if (projectChanged) {
      // `D-UX22-09`: se registra la asociación anterior y la nueva; no se mueve conocimiento.
      appendRegistryAudit(db, {
        at: now,
        actor: 'human',
        sessionId: null,
        action: TRACKING_ACTIONS.reassociate,
        target: key,
        outcome: 'ok',
        detail: {
          pathKey: key,
          revision: nextRevision,
          previous: { projectId: current.project_id ?? null, association: current.association },
          next: { projectId: nextProjectId, association: nextAssociation },
        },
      });
    }

    return { changed: true, item: readTracking(db, { pathKey: key }), revision: nextRevision };
  }, { immediate: true });
}

/**
 * Quita la fila con CAS y la audita como `disable` (la persona deja de seguir). No toca raíces,
 * grants, selección ni almacenes: sólo borra la preferencia.
 */
export function removeTracking(db, input = {}) {
  return guardStore(() => removeTrackingWork(db, input));
}

function removeTrackingWork(db, { pathKey, expectedRevision, now = Date.now() } = {}) {
  const key = requirePathKey(pathKey);
  const expected = requireExpectedRevision(expectedRevision);
  return withTransaction(db, () => {
    const current = rawRow(db, key);
    if (!current) {
      throw new RagError('not-found', 'ese workspace no está seguido', { details: { pathKey: key } });
    }
    if (Number(current.revision) !== expected) {
      throw new RagError('revision-conflict', 'el seguimiento cambió mientras lo editabas', {
        details: {
          reason: 'revision-mismatch',
          pathKey: key,
          expectedRevision: expected,
          currentRevision: Number(current.revision),
        },
      });
    }
    const info = db.prepare('DELETE FROM workspace_tracking WHERE path_key = ? AND revision = ?')
      .run(key, Number(current.revision));
    if (Number(info.changes) !== 1) {
      throw new RagError('revision-conflict', 'el seguimiento cambió durante la escritura', {
        details: { reason: 'revision-mismatch', pathKey: key, expectedRevision: expected },
      });
    }
    appendRegistryAudit(db, {
      at: now,
      actor: 'human',
      sessionId: null,
      action: TRACKING_ACTIONS.disable,
      target: key,
      outcome: 'ok',
      detail: {
        pathKey: key,
        removed: true,
        previous: {
          state: current.state,
          projectId: current.project_id ?? null,
          revision: Number(current.revision),
        },
      },
    });
    return { changed: true, removed: normalizeTrackingRow(current) };
  }, { immediate: true });
}

/** Acepta una clave suelta o una entrada `{pathKey, path}` en las listas de reconciliación. */
function reconcileEntry(entry, list) {
  if (typeof entry === 'string') return { pathKey: requirePathKey(entry), path: undefined };
  if (entry && typeof entry === 'object') {
    return {
      pathKey: requirePathKey(entry.pathKey),
      path: typeof entry.path === 'string' ? entry.path : undefined,
    };
  }
  throw invalid('cada entrada de reconciliación debe ser un pathKey o un objeto con pathKey', {
    reason: 'invalid-field', field: list,
  });
}

/**
 * Reconciliación técnica de disponibilidad (`D-UX22-08`, `D-IMPL-03`).
 *
 * Sólo escribe `last_status`, `last_seen_at` y `path` de filas **existentes**: nunca crea ni borra
 * filas, nunca sube la revisión y nunca toca `state`, `association`, `project_id` ni `bound_*`. Se
 * audita **una sola vez por llamada**, con `actor='host'`, para que jamás se atribuya a la persona.
 *
 * `present`/`absent`/`unknown` son listas de `pathKey` o de objetos `{pathKey, path}`.
 *
 * @returns {{changed: number, changes: object[], checked: number, ok: number, missing: number,
 *   unknown: number, skipped: number}}
 */
export function reconcileTracking(db, input = {}) {
  return guardStore(() => reconcileTrackingWork(db, input));
}

function reconcileTrackingWork(db, {
  present = [], absent = [], unknown = [], measuredAt = Date.now(),
} = {}) {
  if (!Array.isArray(present) || !Array.isArray(absent) || !Array.isArray(unknown)) {
    throw invalid('present, absent y unknown deben ser listas', { reason: 'invalid-field', field: 'reconcile' });
  }
  if (!Number.isFinite(measuredAt)) {
    throw invalid('measuredAt debe ser un instante numérico', { reason: 'invalid-field', field: 'measuredAt' });
  }
  const groups = [
    { flag: true, entries: present.map((entry) => reconcileEntry(entry, 'present')), counter: 'ok' },
    { flag: false, entries: absent.map((entry) => reconcileEntry(entry, 'absent')), counter: 'missing' },
    { flag: null, entries: unknown.map((entry) => reconcileEntry(entry, 'unknown')), counter: 'unknown' },
  ];

  return withTransaction(db, () => {
    const changes = [];
    const totals = { checked: 0, ok: 0, missing: 0, unknown: 0, skipped: 0 };
    for (const group of groups) {
      for (const entry of group.entries) {
        const current = rawRow(db, entry.pathKey);
        if (!current) {
          // `D-IMPL-02`: el sistema no crea filas; una ruta nueva nace sin seguimiento.
          totals.skipped += 1;
          continue;
        }
        totals.checked += 1;
        totals[group.counter] += 1;
        const next = applyReconcile(current, group.flag, measuredAt, entry.path);
        const changed = (next.last_status ?? null) !== (current.last_status ?? null)
          || (next.last_seen_at === null ? null : String(next.last_seen_at)) !== (current.last_seen_at ?? null)
          || (next.path ?? null) !== (current.path ?? null);
        if (!changed) continue;
        db.prepare(`UPDATE workspace_tracking
            SET last_status = ?, last_seen_at = ?, path = ?
          WHERE path_key = ?`)
          .run(
            next.last_status,
            next.last_seen_at === null ? null : String(next.last_seen_at),
            next.path,
            entry.pathKey,
          );
        changes.push({
          pathKey: entry.pathKey,
          previous: { lastStatus: current.last_status ?? null, lastSeenAt: current.last_seen_at ?? null },
          next: { lastStatus: next.last_status, lastSeenAt: next.last_seen_at === null ? null : String(next.last_seen_at) },
        });
      }
    }

    appendRegistryAudit(db, {
      at: measuredAt,
      // `D-UX22-11`: acción del sistema, nunca de la persona.
      actor: 'host',
      sessionId: null,
      action: 'tracking.reconcile',
      target: 'workspace_tracking',
      outcome: 'ok',
      detail: {
        checked: totals.checked,
        ok: totals.ok,
        missing: totals.missing,
        unknown: totals.unknown,
        skipped: totals.skipped,
        measuredAt,
        changed: changes.length,
      },
    });
    return { changed: changes.length, changes, ...totals };
  }, { immediate: true });
}
