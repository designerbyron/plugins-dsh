/**
 * R1.2 · Persistencia de las dos piezas durables del ciclo de vida:
 *
 * - `provision_intents`: una fila por workspace con la operación que está provisionando, la revisión
 *   que la persona vio (fencing), la identidad reservada y la procedencia de lo que el acto creó.
 *   Responde «¿hay una provisión en curso para esta ruta?» por clave primaria, sin `LIKE` sobre
 *   `operations.detail` (Q-02), y es lo que permite demostrar propiedad al revocar (Q08).
 * - `sync_requests`: cola durable y coalescente por ámbito. Una petición nueva actualiza la fila en
 *   vez de apilar trabajos; el planificador la reclama antes de ejecutarla y la cierra con el
 *   resultado. Si el proceso muere, la fila sigue y se drena al arrancar.
 *
 * Este módulo no decide: sólo lee y escribe las filas. La saga vive en `lib/lifecycle.mjs`.
 */

import { RagError } from './errors.mjs';
import { withTransaction } from './db.mjs';

export const SYNC_REQUEST_STATES = Object.freeze(['queued', 'running', 'done', 'failed']);

function invalid(message, details) {
  return new RagError('invalid-argument', message, { details });
}

function requirePathKey(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4_096 || value.includes(String.fromCharCode(0))) {
    throw invalid('pathKey debe ser una clave de ruta no vacía', {
      reason: typeof value === 'string' ? 'invalid-field' : 'missing-field',
      field: 'pathKey',
    });
  }
  return value;
}

function requireScope(scopeKind, scopeId) {
  if (scopeKind !== 'prj' && scopeKind !== 'lib') {
    throw invalid('scopeKind debe ser prj o lib', { reason: 'invalid-field', field: 'scopeKind' });
  }
  const prefix = scopeKind === 'prj' ? 'prj_' : 'lib_';
  if (typeof scopeId !== 'string' || !scopeId.startsWith(prefix)) {
    throw invalid('scopeId no corresponde al tipo de ámbito', {
      reason: 'invalid-field', field: 'scopeId', scopeKind,
    });
  }
  return { scopeKind, scopeId };
}

function normalizeIntent(row) {
  if (!row) return null;
  return {
    pathKey: row.path_key,
    operationId: row.operation_id,
    expectedRevision: Number(row.expected_revision),
    projectId: row.project_id ?? null,
    state: row.state,
    consentTrustKey: row.consent_trust_key ?? null,
    consentRootId: row.consent_root_id ?? null,
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function getProvisionIntent(db, pathKey) {
  return normalizeIntent(db.prepare('SELECT * FROM provision_intents WHERE path_key = ?').get(requirePathKey(pathKey)));
}

export function listOpenIntents(db) {
  return db.prepare("SELECT * FROM provision_intents WHERE state = 'open' ORDER BY created_at, path_key").all()
    .map(normalizeIntent);
}

export function listProvisionIntents(db) {
  return db.prepare('SELECT * FROM provision_intents ORDER BY created_at, path_key').all().map(normalizeIntent);
}

/**
 * Abre (o reabre) la intención de un workspace. `operationId` debe existir ya en `operations`: la FK
 * lo exige y así la intención nunca apunta a una operación inventada.
 *
 * - Fila `open` con la misma operación: reanudación pura (`resumed: true`).
 * - Fila `open` con otra operación: se conserva la más antigua y se devuelve `resumed: true` con su
 *   `operationId`; el llamador debe ejecutar ésa y **no** la que acababa de abrir (el journal de la
 *   nueva se cierra como `reconciled` para no dejarla mintiendo).
 * - Fila `done`/`abandoned`: se reabre con la operación nueva. La identidad y la procedencia
 *   anteriores se conservan si el llamador no aporta otras.
 */
export function openProvisionIntent(db, {
  pathKey, operationId, expectedRevision, projectId = null, now = Date.now(), resetConsent = false,
  reopenDone = true,
} = {}) {
  const key = requirePathKey(pathKey);
  if (typeof operationId !== 'string' || !operationId.startsWith('op_')) {
    throw invalid('operationId no es una operación del journal', { reason: 'invalid-field', field: 'operationId' });
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw invalid('expectedRevision debe ser un entero no negativo', {
      reason: 'invalid-field', field: 'expectedRevision',
    });
  }
  return withTransaction(db, () => {
    const current = getProvisionIntent(db, key);
    if (current?.state === 'open') {
      return { intent: current, created: false, resumed: true };
    }
    if (!reopenDone && current?.state === 'done') {
      // Un movimiento no puede reabrir una intención que otro acto ya cerró: borraría su
      // procedencia y dejaría la memoria lista sin poder revocarse.
      return { intent: current, created: false, resumed: false, alreadyDone: true };
    }
    // `resetConsent` se usa cuando el acto empieza de cero en una ruta que ya tuvo otra vida (un
    // movimiento): la procedencia anterior no puede autorizar a revocar entradas de este acto.
    const sql = resetConsent
      ? `INSERT INTO provision_intents
          (path_key, operation_id, expected_revision, project_id, state, consent_trust_key, consent_root_id,
           revoked_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'open', NULL, NULL, NULL, ?, ?)
        ON CONFLICT(path_key) DO UPDATE SET
          operation_id      = excluded.operation_id,
          expected_revision = excluded.expected_revision,
          project_id        = COALESCE(excluded.project_id, provision_intents.project_id),
          state             = 'open',
          consent_trust_key = NULL,
          consent_root_id   = NULL,
          revoked_at        = NULL,
          created_at        = excluded.created_at,
          updated_at        = excluded.updated_at`
      : `INSERT INTO provision_intents
          (path_key, operation_id, expected_revision, project_id, state, consent_trust_key, consent_root_id,
           revoked_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, ?, ?)
        ON CONFLICT(path_key) DO UPDATE SET
          operation_id      = excluded.operation_id,
          expected_revision = excluded.expected_revision,
          project_id        = COALESCE(excluded.project_id, provision_intents.project_id),
          state             = 'open',
          consent_trust_key = COALESCE(excluded.consent_trust_key, provision_intents.consent_trust_key),
          consent_root_id   = COALESCE(excluded.consent_root_id, provision_intents.consent_root_id),
          revoked_at        = NULL,
          updated_at        = excluded.updated_at`;
    if (resetConsent) {
      db.prepare(sql).run(key, operationId, expectedRevision, projectId, now, now);
    } else {
      db.prepare(sql).run(
        key, operationId, expectedRevision, projectId,
        current?.consentTrustKey ?? null, current?.consentRootId ?? null,
        current?.createdAt ?? now, now,
      );
    }
    return { intent: getProvisionIntent(db, key), created: true, resumed: false };
  }, { immediate: true });
}

/**
 * Registra una memoria ya provisionada sin pasar por la saga: lo usa el movimiento, que reutiliza la
 * identidad y crea consentimiento nuevo en la ruta destino. Deja la intención en `done` con la
 * procedencia exacta de lo que este acto creó.
 */
export function recordProvisionedWorkspace(db, {
  pathKey, operationId, expectedRevision, projectId,
  consentTrustKey = null, consentRootId = null, now = Date.now(),
} = {}) {
  const key = requirePathKey(pathKey);
  db.prepare(`INSERT INTO provision_intents
      (path_key, operation_id, expected_revision, project_id, state, consent_trust_key, consent_root_id,
       revoked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'done', ?, ?, NULL, ?, ?)
    ON CONFLICT(path_key) DO UPDATE SET
      operation_id      = excluded.operation_id,
      expected_revision = excluded.expected_revision,
      project_id        = excluded.project_id,
      state             = 'done',
      consent_trust_key = excluded.consent_trust_key,
      consent_root_id   = excluded.consent_root_id,
      revoked_at        = NULL,
      updated_at        = excluded.updated_at`).run(
    key, operationId, expectedRevision, projectId, consentTrustKey, consentRootId, now, now,
  );
  return getProvisionIntent(db, key);
}

export function setIntentProject(db, { pathKey, projectId, now = Date.now() } = {}) {
  const info = db.prepare('UPDATE provision_intents SET project_id = ?, updated_at = ? WHERE path_key = ? AND state = \'open\'')
    .run(projectId, now, requirePathKey(pathKey));
  return Number(info.changes) === 1;
}

export function setIntentConsent(db, { pathKey, consentTrustKey = null, consentRootId = null, now = Date.now() } = {}) {
  const info = db.prepare(`UPDATE provision_intents
      SET consent_trust_key = COALESCE(?, consent_trust_key),
          consent_root_id   = COALESCE(?, consent_root_id),
          updated_at = ?
    WHERE path_key = ? AND state = 'open'`)
    .run(consentTrustKey, consentRootId, now, requirePathKey(pathKey));
  return Number(info.changes) === 1;
}

export function finishProvisionIntent(db, {
  pathKey, operationId, projectId = null, now = Date.now(), state = 'done',
} = {}) {
  if (state !== 'done' && state !== 'abandoned') {
    throw invalid('estado final de intención inválido', { reason: 'invalid-field', field: 'state' });
  }
  const info = db.prepare(`UPDATE provision_intents
      SET state = ?, project_id = COALESCE(?, project_id), updated_at = ?
    WHERE path_key = ? AND operation_id = ?`)
    .run(state, projectId, now, requirePathKey(pathKey), operationId);
  return Number(info.changes) === 1;
}

/** Marca la revocación como hecha. Idempotente: repetirla no cambia `revoked_at`. */
export function markIntentRevoked(db, { pathKey, now = Date.now() } = {}) {
  const info = db.prepare('UPDATE provision_intents SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE path_key = ?')
    .run(now, now, requirePathKey(pathKey));
  return Number(info.changes) === 1;
}

/* ------------------------------------------------------------------ cola de sincronización */

function normalizeSyncRequest(row) {
  if (!row) return null;
  return {
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    state: row.state,
    reason: row.reason,
    operationId: row.operation_id ?? null,
    requestedAt: Number(row.requested_at),
    startedAt: row.started_at === null ? null : Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    errorCode: row.error_code ?? null,
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Encola una sincronización para el ámbito. Coalescencia: si ya hay una fila, se actualiza.
 * - `queued`: no hay pasada en curso; se queda en cola.
 * - `running`: se marca `queued` para que la pasada actual no se pise y se haga **una** pasada más
 *   con los cambios nuevos (nunca una cola ilimitada).
 */
export function requestSync(db, {
  scopeKind = 'prj', scopeId, reason = 'manual', now = Date.now(),
} = {}) {
  const scope = requireScope(scopeKind, scopeId);
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw invalid('la petición de sincronización necesita un motivo', { reason: 'invalid-field', field: 'reason' });
  }
  return withTransaction(db, () => {
    db.prepare(`INSERT INTO sync_requests
        (scope_kind, scope_id, state, reason, operation_id, requested_at, started_at, finished_at, error_code, updated_at)
      VALUES (?, ?, 'queued', ?, NULL, ?, NULL, NULL, NULL, ?)
      ON CONFLICT(scope_kind, scope_id) DO UPDATE SET
        state        = 'queued',
        reason       = excluded.reason,
        operation_id = NULL,
        requested_at = excluded.requested_at,
        started_at   = NULL,
        finished_at  = NULL,
        error_code   = NULL,
        updated_at   = excluded.updated_at`).run(
      scope.scopeKind, scope.scopeId, reason.trim(), now, now,
    );
    return getSyncRequest(db, scope);
  }, { immediate: true });
}

export function getSyncRequest(db, { scopeKind = 'prj', scopeId } = {}) {
  const scope = requireScope(scopeKind, scopeId);
  return normalizeSyncRequest(db.prepare(
    'SELECT * FROM sync_requests WHERE scope_kind = ? AND scope_id = ?',
  ).get(scope.scopeKind, scope.scopeId));
}

export function listSyncRequests(db, { state = null, limit = 100 } = {}) {
  if (state !== null && !SYNC_REQUEST_STATES.includes(state)) {
    throw invalid('estado de petición inválido', { reason: 'invalid-field', field: 'state' });
  }
  const capped = Math.min(Math.max(Number(limit) || 100, 1), 1_000);
  const rows = state === null
    ? db.prepare('SELECT * FROM sync_requests ORDER BY requested_at, scope_id LIMIT ?').all(capped)
    : db.prepare('SELECT * FROM sync_requests WHERE state = ? ORDER BY requested_at, scope_id LIMIT ?').all(state, capped);
  return rows.map(normalizeSyncRequest);
}

/**
 * Reclama una petición en cola. La escritura es condicional a que siga `queued` **con la misma
 * `requested_at`**: si otra petición llegó mientras tanto, no se roba el trabajo nuevo.
 */
export function claimSyncRequest(db, { scopeKind = 'prj', scopeId, now = Date.now() } = {}) {
  const scope = requireScope(scopeKind, scopeId);
  return withTransaction(db, () => {
    const current = getSyncRequest(db, scope);
    if (!current || current.state !== 'queued') return { claimed: false, request: current };
    const info = db.prepare(`UPDATE sync_requests
        SET state = 'running', started_at = ?, finished_at = NULL, error_code = NULL, updated_at = ?
      WHERE scope_kind = ? AND scope_id = ? AND state = 'queued' AND requested_at = ?`)
      .run(now, now, scope.scopeKind, scope.scopeId, current.requestedAt);
    if (Number(info.changes) !== 1) return { claimed: false, request: getSyncRequest(db, scope) };
    return { claimed: true, request: getSyncRequest(db, scope) };
  }, { immediate: true });
}

/**
 * Cierra la petición **sólo si sigue siendo la misma pasada**. Si llegó una petición nueva durante la
 * ejecución, la fila quedó en `queued` con otro `requested_at` y este cierre no la toca.
 */
export function finishSyncRequest(db, {
  scopeKind = 'prj', scopeId, requestedAt, state, operationId = null, errorCode = null, now = Date.now(),
} = {}) {
  const scope = requireScope(scopeKind, scopeId);
  if (state !== 'done' && state !== 'failed') {
    throw invalid('estado final de sincronización inválido', { reason: 'invalid-field', field: 'state' });
  }
  const info = db.prepare(`UPDATE sync_requests
      SET state = ?, operation_id = ?, finished_at = ?, error_code = ?, updated_at = ?
    WHERE scope_kind = ? AND scope_id = ? AND state = 'running' AND requested_at = ?`)
    .run(state, operationId, now, errorCode, now, scope.scopeKind, scope.scopeId, requestedAt);
  return Number(info.changes) === 1;
}

/**
 * Vuelve a poner en cola una petición que quedó a medias. Se usa para pasadas parciales (presupuesto
 * o `too-many-files`) y para recuperar una `running` huérfana. La fila conserva su `reason` y deja
 * `error_code='partial'`/`process-interrupted` para que el diagnóstico lo distinga de un fallo.
 */
export function requeueSyncRequest(db, {
  scopeKind = 'prj', scopeId, requestedAt, operationId = null, errorCode = 'partial', now = Date.now(),
} = {}) {
  const scope = requireScope(scopeKind, scopeId);
  const info = db.prepare(`UPDATE sync_requests
      SET state = 'queued', operation_id = ?, requested_at = ?, started_at = NULL, finished_at = NULL,
          error_code = ?, updated_at = ?
    WHERE scope_kind = ? AND scope_id = ? AND state = 'running' AND requested_at = ?`)
    .run(operationId, now, errorCode, now, scope.scopeKind, scope.scopeId, requestedAt);
  return Number(info.changes) === 1;
}

/**
 * Recupera al arrancar las peticiones que quedaron `running`. Se reencolan (no se pierden) y sólo se
 * tocan las que llevan más de `olderThanMs` en marcha: una pasada recién tomada por otra instancia
 * del mismo perfil no se roba.
 */
export function reclaimInterruptedSyncRequests(db, {
  now = Date.now(), olderThanMs = 300_000,
} = {}) {
  const cutoff = now - Math.max(0, Number(olderThanMs) || 0);
  const rows = db.prepare("SELECT * FROM sync_requests WHERE state = 'running' ORDER BY requested_at").all()
    .map(normalizeSyncRequest);
  let reclaimed = 0;
  for (const row of rows) {
    let ownerPid = null;
    if (row.operationId) {
      const operation = db.prepare('SELECT detail FROM operations WHERE id = ?').get(row.operationId);
      try {
        const detail = operation?.detail ? JSON.parse(operation.detail) : null;
        ownerPid = Number(detail?.owner_pid) || null;
      } catch { ownerPid = null; }
    }
    if (ownerPid) {
      try {
        process.kill(ownerPid, 0);
        continue; // el proceso dueño sigue vivo: no se le roba la pasada
      } catch (error) {
        if (error?.code === 'EPERM') continue; // existe, no podemos señalizarlo
        // ESRCH: el dueño ya no está; se puede reclamar aunque sea reciente.
      }
    } else if (row.startedAt && Number(row.startedAt) > cutoff) {
      // Sin marca de dueño (peticiones anteriores a esta versión), mantener la ventana conservadora.
      continue;
    }
    db.prepare(`UPDATE sync_requests
        SET state = 'queued', operation_id = NULL, requested_at = ?, started_at = NULL, finished_at = NULL,
            error_code = 'retried-after-interruption', updated_at = ?
      WHERE scope_kind = ? AND scope_id = ? AND state = 'running' AND requested_at = ?`)
      .run(now, now, row.scopeKind, row.scopeId, row.requestedAt);
    reclaimed += 1;
  }
  return reclaimed;
}
