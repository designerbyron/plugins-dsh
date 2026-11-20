/**
 * Revocación efectiva (PA4-B).
 *
 * PA3 fijaba la autorización al empezar la llamada: una consulta en curso terminaba con los ámbitos
 * que ya había abierto. PA4 añade **puntos de control** que vuelven a leer el registro (sin caché de
 * grants) y una garantía verificable:
 *
 * - Antes de abrir cada ámbito se comprueba que sigue autorizado.
 * - Antes de devolver información al consumidor se comprueba otra vez el conjunto completo.
 * - Si durante la operación se revoca un ámbito que la operación tenía autorizado, la operación
 *   **no devuelve resultados** de ningún ámbito: falla con `grant-revoked` y deja constancia en la
 *   auditoría del registro. Un resultado reducido no se presenta como exhaustivo (v0.1 no puede
 *   expresar `partial`).
 *
 * Latencias y límites, que se documentan en vez de prometerse:
 * - El modelo de ejecución es de un solo hilo por proceso: un cambio hecho por *otra conexión* u otro
 *   proceso sólo puede confirmarse entre dos sentencias nuestras. La revocación se detecta como muy
 *   tarde en el siguiente punto de control, nunca en mitad de una sentencia SQLite propia.
 * - Una escritura ya confirmada (`COMMIT`) no se revierte: la revocación impide seguir escribiendo y
 *   devolver datos, no deshace lo escrito. La atomicidad de una escritura termina en su `COMMIT`.
 * - `grant-revoked` con `reason: 'revoked-during-operation'` significa «autorizado al abrir, no
 *   autorizado al devolver»; no hay resultados parciales que entregar.
 */

import { RagError } from './errors.mjs';

/**
 * Estado de autorización actual, leído de la base del registro. Sin caché: cada llamada ve lo que
 * hay comprometido en ese instante.
 */
export function currentAuthorization(db, { sessionId, projectId, sessionOptional = false } = {}) {
  const session = db.prepare('SELECT * FROM session_scope WHERE session_id = ?').get(sessionId) ?? null;
  if (!session) {
    // Resolver por cwd no registra selección: sin fila de sesión la autorización es la del proyecto.
    if (sessionOptional) return projectAuthorization(db, projectId);
    return { ok: false, reason: 'session-missing', scopes: null };
  }
  if (session.state === 'expired') return { ok: false, reason: 'session-expired', scopes: null };
  if (session.state === 'invalidated') {
    return { ok: false, reason: 'session-invalidated', invalidReason: session.invalid_reason, scopes: null };
  }
  if (session.project_id !== projectId) {
    return { ok: false, reason: 'selection-changed', projectId: session.project_id, scopes: null };
  }
  const effective = projectAuthorization(db, projectId);
  if (!effective.ok) return effective;
  return { ...effective, revision: session.revision };
}

/**
 * Autorización que no depende de una selección explícita: proyecto activo + grants abiertos +
 * bibliotecas activas.
 *
 * No exige que la biblioteca tenga una raíz autorizada: ése es un estado de *contenido* (una
 * biblioteca recién concedida y todavía sin raíz), no de autorización. Si aquí se filtrara por raíz,
 * el conjunto releído tendría menos ámbitos que la instantánea con la que se abrió la operación y
 * cualquier llamada legítima fallaría con `grant-revoked` —una revocación que nadie hizo— dejando el
 * proyecto inservible. La falta de raíz ya la trata la propia operación (ámbito sin nada que servir).
 */
export function projectAuthorization(db, projectId) {
  const project = db.prepare('SELECT id, status FROM projects WHERE id = ?').get(projectId) ?? null;
  if (!project) return { ok: false, reason: 'project-missing', scopes: null };
  if (project.status !== 'active') return { ok: false, reason: 'project-archived', scopes: null };
  const libraries = db.prepare(
    `SELECT l.id FROM grants g
       JOIN libraries l ON l.id = g.library_id
      WHERE g.project_id = ? AND g.revoked_at IS NULL AND l.status = 'active'
      ORDER BY l.name, l.id`,
  ).all(projectId).map((row) => row.id);
  return {
    ok: true,
    reason: 'ok',
    projectId,
    revision: null,
    libraries,
    scopes: [projectId, ...libraries],
  };
}

/** Diferencia de conjuntos de ámbitos: `revoked` son los que ya no están, `added` los nuevos. */
export function diffScopes(before = [], after = []) {
  const previous = new Set(before);
  const current = new Set(after);
  return {
    revoked: [...previous].filter((id) => !current.has(id)),
    added: [...current].filter((id) => !previous.has(id)),
    unchanged: [...current].filter((id) => previous.has(id)),
  };
}

/** Error de revocación con motivo explícito y sin datos sensibles. */
export function revocationError({ revoked = [], reason = 'revoked-during-operation', tool = null, sessionId = null } = {}) {
  return new RagError('grant-revoked', 'la autorización del ámbito se revocó durante la operación', {
    details: {
      reason,
      tool,
      sessionId,
      scopes: revoked,
      guarantee: 'la operación no devuelve resultados de ámbitos revocados',
    },
  });
}

/**
 * Traduce un estado de autorización perdido a su error del contrato.
 */
export function authorizationLostError(authorization) {
  if (authorization.reason === 'session-expired') {
    return new RagError('session-expired', 'la sesión expiró durante la operación', { details: { reason: 'session-expired' } });
  }
  if (authorization.reason === 'session-invalidated') {
    return new RagError('scope-forbidden', 'la sesión se invalidó durante la operación', {
      details: { reason: authorization.invalidReason ?? 'admin' },
    });
  }
  if (authorization.reason === 'project-archived') {
    return new RagError('scope-forbidden', 'el proyecto se archivó durante la operación', {
      details: { reason: 'project-archived' },
    });
  }
  return new RagError('scope-forbidden', 'la autorización de la operación dejó de ser válida', {
    details: { reason: authorization.reason },
  });
}
