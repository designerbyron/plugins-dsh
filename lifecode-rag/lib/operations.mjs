/**
 * Operaciones coordinadas (PA0 §9) usadas por los flujos de PA4.
 *
 * Una operación que se interrumpe deja una fila `started`. Eso **no** significa que no se escribiera
 * nada: significa que el resultado es desconocido. La regla del contrato es que un efecto destructivo
 * cuyo resultado es incierto no se repite: o se reconcilia con evidencia, o se marca `failed` y se
 * deja la decisión a una persona.
 *
 * Este módulo no borra nada y no repite efectos: sólo registra, consulta y cierra operaciones.
 */

import { RagError } from './errors.mjs';
import { newId } from './registry.mjs';

export const OPERATION_STATES = Object.freeze(['started', 'committed', 'failed', 'reconciled']);
export const STEP_STATES = Object.freeze(['pending', 'done', 'failed']);

/** Abre una operación en estado `started`. */
export function beginOperation(db, { kind, target, detail = null, now = Date.now(), id } = {}) {
  if (typeof kind !== 'string' || kind.trim() === '') {
    throw new RagError('invalid-argument', 'la operación necesita un tipo');
  }
  const operationId = id ?? newId('op_', now);
  db.prepare(`INSERT INTO operations (id, kind, state, started_at, finished_at, detail)
    VALUES (?, ?, 'started', ?, NULL, ?)`)
    .run(operationId, kind, now, detail === null ? null : JSON.stringify(detail));
  return { id: operationId, kind, target, state: 'started' };
}

/**
 * Registra un paso. Repetir el mismo paso actualiza su estado (progreso normal); `effectKey` es la
 * clave de idempotencia del efecto: un paso **distinto** no puede reutilizarla dentro de la misma
 * operación, y el índice único parcial lo rechaza en vez de duplicar el trabajo.
 */
export function recordStep(db, { operationId, step, state = 'done', effectKey = null, now = Date.now() } = {}) {
  if (!STEP_STATES.includes(state)) {
    throw new RagError('invalid-argument', 'estado de paso inválido', { details: { state } });
  }
  try {
    db.prepare(`INSERT INTO operation_steps (operation_id, step, state, effect_key, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(operation_id, step) DO UPDATE SET
        state = excluded.state,
        effect_key = excluded.effect_key,
        updated_at = excluded.updated_at`)
      .run(operationId, step, state, effectKey, now);
  } catch (error) {
    if (/UNIQUE|unique/.test(String(error?.message ?? ''))) {
      return { ok: false, duplicate: true, operationId, step, effectKey };
    }
    throw error;
  }
  return { ok: true, operationId, step, state, effectKey };
}

/** Cierra la operación. `committed` exige que todos los pasos estén `done`. */
export function finishOperation(db, { operationId, state, now = Date.now(), detail = undefined } = {}) {
  if (!['committed', 'failed', 'reconciled'].includes(state)) {
    throw new RagError('invalid-argument', 'estado final de operación inválido', { details: { state } });
  }
  const steps = listSteps(db, operationId);
  if (state === 'committed' && steps.some((step) => step.state !== 'done')) {
    throw new RagError('operation-uncertain', 'la operación no se puede confirmar: hay pasos sin completar', {
      details: { operationId, steps: steps.map((step) => ({ step: step.step, state: step.state })) },
    });
  }
  const patch = detail === undefined ? null : JSON.stringify(detail);
  const result = patch === null
    ? db.prepare(`UPDATE operations SET state=?, finished_at=? WHERE id=?`).run(state, now, operationId)
    : db.prepare(`UPDATE operations SET state=?, finished_at=?, detail=? WHERE id=?`).run(state, now, patch, operationId);
  if (Number(result.changes) === 0) {
    throw new RagError('invalid-argument', 'la operación no existe', { details: { operationId } });
  }
  return { id: operationId, state };
}

export function getOperation(db, operationId) {
  const operation = db.prepare('SELECT * FROM operations WHERE id = ?').get(operationId) ?? null;
  return operation ? { ...operation, steps: listSteps(db, operationId) } : null;
}

export function listSteps(db, operationId) {
  return db.prepare('SELECT * FROM operation_steps WHERE operation_id = ? ORDER BY step').all(operationId);
}

/** Operaciones que quedaron abiertas: resultado desconocido hasta reconciliarlas. */
export function listInterruptedOperations(db, { kind } = {}) {
  const rows = kind
    ? db.prepare(`SELECT * FROM operations WHERE state='started' AND kind=? ORDER BY started_at, id`).all(kind)
    : db.prepare(`SELECT * FROM operations WHERE state='started' ORDER BY started_at, id`).all();
  return rows.map((row) => ({ ...row, steps: listSteps(db, row.id) }));
}

/**
 * Reconcilia operaciones interrumpidas con la evidencia que aporte el llamador.
 *
 * `decide(operation)` devuelve `{state: 'committed'|'failed'|'reconciled', detail?}`. La función no
 * ejecuta el trabajo otra vez: sólo cierra la fila con la conclusión documentada.
 *
 * @returns {Array<{id: string, from: string, to: string}>}
 */
export function reconcileInterruptedOperations(db, { kind, decide, now = Date.now() } = {}) {
  if (typeof decide !== 'function') throw new RagError('invalid-argument', 'reconciliar exige una función decide');
  const changed = [];
  for (const operation of listInterruptedOperations(db, { kind })) {
    const verdict = decide(operation) ?? { state: 'failed', detail: { reason: 'sin-evidencia' } };
    finishOperation(db, { operationId: operation.id, state: verdict.state, now, detail: verdict.detail });
    changed.push({ id: operation.id, from: 'started', to: verdict.state });
  }
  return changed;
}

/**
 * Falla en cerrado si hay una operación destructiva interrumpida de este tipo: repetirla podría
 * duplicar un efecto que quizá ya ocurrió.
 */
export function assertNoInterruptedOperation(db, { kind } = {}) {
  const interrupted = listInterruptedOperations(db, { kind });
  if (interrupted.length > 0) {
    throw new RagError('operation-uncertain', 'hay una operación destructiva interrumpida sin reconciliar', {
      details: {
        kind: kind ?? null,
        operations: interrupted.map((operation) => ({
          id: operation.id,
          started_at: operation.started_at,
          steps: listSteps(db, operation.id).map((step) => ({ step: step.step, state: step.state })),
        })),
      },
    });
  }
  return true;
}
