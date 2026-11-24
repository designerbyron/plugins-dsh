/**
 * UX-2.2 · Núcleo **puro** del seguimiento de workspaces.
 *
 * Aquí viven las dos reglas que no admiten interpretación y que no necesitan base de datos para
 * probarse (`D-UX22-08`, `D-UX22-11`):
 *
 * - **Eje A · decisión humana** (`state`): `on` / `off` / `paused`. Sólo una persona lo mueve.
 * - **Eje B · disponibilidad** (`last_status`): `ok` / `missing` / `unknown`. Lo mide el Host.
 *
 * Los dos ejes son **independientes**: `missing` es un hecho técnico y `off` una decisión humana, así
 * que reconciliar la disponibilidad **nunca** cambia la preferencia ni borra la fila. `paused` no
 * resuelve contexto.
 *
 * Este módulo no abre ficheros, no lee el reloj, no habla con SQLite y no conoce al Host: recibe filas
 * planas del registro y devuelve columnas o decisiones. Así el mismo criterio se prueba sin almacén y
 * el almacén (`tracking-store.mjs`) no puede reimplementarlo a su manera.
 */

import { RagError } from './errors.mjs';

/** Eje A · decisión humana. */
export const TRACKING_STATES = Object.freeze({ on: 'on', off: 'off', paused: 'paused' });

/** Eje B · disponibilidad medida por el Host. */
export const TRACKING_STATUSES = Object.freeze({ ok: 'ok', missing: 'missing', unknown: 'unknown' });

/** Cómo nació la asociación workspace → proyecto. `conflict` existe en el esquema pero UX-2.2 no lo produce. */
export const TRACKING_ASSOCIATIONS = Object.freeze({
  explicit: 'explicit',
  pending: 'pending',
  conflict: 'conflict',
});

/** Las únicas acciones humanas auditables (`D-UX22-11`). */
export const TRACKING_ACTIONS = Object.freeze({
  enable: 'enable',
  disable: 'disable',
  pause: 'pause',
  resume: 'resume',
  reassociate: 'reassociate',
});

const STATE_VALUES = new Set(Object.values(TRACKING_STATES));
const STATUS_VALUES = new Set(Object.values(TRACKING_STATUSES));

/**
 * ¿La fila resuelve contexto? Sólo si la persona la dejó `on`, el Host confirmó que está y hay
 * proyecto asociado. La actividad del proyecto (`status='active'`) se comprueba fuera: este módulo no
 * consulta el registro.
 */
export function trackingResolves(row) {
  if (!row) return false;
  return row.state === TRACKING_STATES.on
    && row.last_status === TRACKING_STATUSES.ok
    && row.project_id !== null
    && row.project_id !== undefined;
}

/**
 * Acción humana que corresponde a mover el eje A de `from` a `to`.
 *
 * @returns {'enable'|'disable'|'pause'|'resume'|null} `null` si no hay cambio (no-op).
 * @throws {RagError} `invalid-argument` si la transición no existe (por ejemplo `off` → `paused`:
 *   desde «no seguido» se reactiva primero y se pausa después).
 */
export function actionForTransition(from, to) {
  if (!STATE_VALUES.has(from) || !STATE_VALUES.has(to)) {
    throw new RagError('invalid-argument', 'estado de seguimiento desconocido', {
      details: { reason: 'invalid-transition', from: from ?? null, to: to ?? null, allowed: [...STATE_VALUES] },
    });
  }
  if (from === to) return null;
  if (from === TRACKING_STATES.on && to === TRACKING_STATES.paused) return TRACKING_ACTIONS.pause;
  if (from === TRACKING_STATES.paused && to === TRACKING_STATES.on) return TRACKING_ACTIONS.resume;
  if (from === TRACKING_STATES.off && to === TRACKING_STATES.on) return TRACKING_ACTIONS.enable;
  if (to === TRACKING_STATES.off) return TRACKING_ACTIONS.disable;
  throw new RagError('invalid-argument', 'transición de seguimiento no permitida', {
    details: { reason: 'invalid-transition', from, to },
  });
}

/**
 * Columnas del eje B que resultan de una reconciliación con el Host.
 *
 * Devuelve **exclusivamente** `last_status`, `last_seen_at` y `path`: no incluye ni puede incluir
 * `state`, `association`, `project_id` ni `bound_*`, de modo que quien escriba el resultado no tiene
 * forma de tocar la decisión humana. `present === null` significa «no se pudo comprobar» (`unknown`)
 * y tampoco borra la fila: el borrado sólo lo decide una persona.
 *
 * `last_seen_at` sólo avanza cuando el Host lo vio: una ausencia o una duda no reescriben la última
 * vez que se vio, que es el dato que la interfaz muestra.
 */
export function applyReconcile(row, present, measuredAt, path) {
  const status = present === true
    ? TRACKING_STATUSES.ok
    : present === false
      ? TRACKING_STATUSES.missing
      : TRACKING_STATUSES.unknown;
  return {
    last_status: status,
    last_seen_at: present === true && Number.isFinite(measuredAt) ? measuredAt : (row?.last_seen_at ?? null),
    path: typeof path === 'string' && path.trim() !== '' ? path : (row?.path ?? null),
  };
}

/**
 * Proyección camelCase de una fila del registro para la API y la interfaz. `resolves` se calcula con
 * la misma regla que `trackingResolves`, no con una copia.
 */
export function normalizeTrackingRow(row) {
  if (!row) return null;
  return {
    pathKey: row.path_key,
    path: row.path,
    workspaceId: row.workspace_id ?? null,
    projectId: row.project_id ?? null,
    state: row.state,
    association: row.association,
    boundBy: row.bound_by,
    boundAt: row.bound_at === null || row.bound_at === undefined ? null : Number(row.bound_at),
    updatedAt: row.updated_at === null || row.updated_at === undefined ? null : Number(row.updated_at),
    lastSeenAt: row.last_seen_at === null || row.last_seen_at === undefined ? null : Number(row.last_seen_at),
    lastStatus: row.last_status ?? null,
    revision: Number(row.revision),
    resolves: trackingResolves(row),
  };
}

/**
 * Recuentos de una lista de filas. `ok`/`missing`/`unknown` cuentan el eje B y `withProject` el eje A
 * con proyecto: un `total` mayor que la suma de estados significa filas todavía sin reconciliar
 * (`last_status` nulo), que no se pintan como «no seguido».
 */
export function trackingCounts(rows) {
  const counts = {
    total: 0, on: 0, off: 0, paused: 0,
    ok: 0, missing: 0, unknown: 0,
    withProject: 0, withoutProject: 0,
  };
  for (const row of rows ?? []) {
    counts.total += 1;
    if (row.state === TRACKING_STATES.on) counts.on += 1;
    else if (row.state === TRACKING_STATES.off) counts.off += 1;
    else if (row.state === TRACKING_STATES.paused) counts.paused += 1;
    // Acepta la fila cruda del registro y la ya proyectada: el panel cuenta sin volver a formatear.
    const status = row.last_status ?? row.lastStatus ?? null;
    if (status === TRACKING_STATUSES.ok) counts.ok += 1;
    else if (status === TRACKING_STATUSES.missing) counts.missing += 1;
    else if (status === TRACKING_STATUSES.unknown) counts.unknown += 1;
    const projectId = row.project_id ?? row.projectId ?? null;
    if (projectId !== null) counts.withProject += 1;
    else counts.withoutProject += 1;
  }
  return counts;
}

/** `true` si el valor es un estado del eje A. Exportado para que el almacén valide sin duplicar listas. */
export function isTrackingState(value) {
  return STATE_VALUES.has(value);
}

/** `true` si el valor es un estado del eje B. */
export function isTrackingStatus(value) {
  return STATUS_VALUES.has(value);
}
