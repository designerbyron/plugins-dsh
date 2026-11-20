/**
 * Selección de ámbitos por sesión (PA2.2/PA2.3/PA2.5) sobre `session_scope` del registro PA1.
 *
 * Reglas que este módulo mantiene:
 * - Una fila de `session_scope` **es** una selección explícita; su ausencia es una sesión sin
 *   selección (no un error). El contrato de sesión prohíbe inventar un proyecto por defecto.
 * - Las sesiones terminales (`expired`, `invalidated`) no se reactivan: volver a seleccionar en
 *   ellas falla en cerrado.
 * - Los grants los crea una persona o el host (`granted_by`), nunca el modelo; el límite de
 *   siete bibliotecas (ocho ámbitos con el proyecto) se comprueba antes de insertar.
 * - Toda escritura se audita en la cadena del registro, en la misma transacción.
 */

import { RagError } from './errors.mjs';
import { appendRegistryAudit } from './registry.mjs';
import { assertProfile, assertSessionId } from './session-identity.mjs';

export const MAX_LIBRARIES_PER_PROJECT = 7;
export const MAX_SCOPES_PER_SELECTION = 8;

const SESSION_STATES = Object.freeze(['active', 'expired', 'invalidated']);
const INVALID_REASONS = Object.freeze([
  'project-archived', 'grant-revoked', 'root-revoked', 'profile-changed', 'admin', 'session-cloned',
]);

function audit(db, entry) {
  return appendRegistryAudit(db, {
    at: entry.now,
    actor: entry.actor ?? 'host',
    sessionId: entry.sessionId ?? null,
    action: entry.action,
    target: entry.target,
    outcome: entry.outcome ?? 'ok',
    detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
  });
}

export function getSession(db, sessionId) {
  assertSessionId(sessionId);
  return db.prepare('SELECT * FROM session_scope WHERE session_id = ?').get(sessionId) ?? null;
}

export function listSessions(db, { state } = {}) {
  if (state !== undefined && !SESSION_STATES.includes(state)) {
    throw new RagError('invalid-argument', 'estado de sesión inválido', { details: { state } });
  }
  return state
    ? db.prepare('SELECT * FROM session_scope WHERE state = ? ORDER BY session_id').all(state)
    : db.prepare('SELECT * FROM session_scope ORDER BY session_id').all();
}

function requireProject(db, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) throw new RagError('scope-forbidden', 'el proyecto no existe en este perfil', {
    details: { reason: 'project-missing', project_id: projectId },
  });
  if (project.status !== 'active') throw new RagError('scope-forbidden', 'el proyecto está archivado', {
    details: { reason: 'project-archived', project_id: projectId },
  });
  return project;
}

/**
 * Registra la selección explícita de una sesión. Es idempotente: repetir la misma selección no
 * crea una revisión nueva ni reescribe la marca de tiempo.
 */
export function registerSelection(db, {
  identity,
  expectedProfileKey,
  projectId,
  selectedBy = 'human',
  source = 'explicit',
  cwd = null,
  cloneOf = null,
  actor = null,
  now = Date.now(),
} = {}) {
  const sessionId = assertProfile(identity, expectedProfileKey);
  if (!['human', 'host'].includes(selectedBy)) {
    throw new RagError('invalid-argument', 'sólo una persona o el host pueden seleccionar proyecto');
  }
  if (!['explicit', 'cwd'].includes(source)) {
    throw new RagError('invalid-argument', 'origen de selección inválido', { details: { source } });
  }
  if (typeof projectId !== 'string' || !projectId.startsWith('prj_')) {
    throw new RagError('invalid-argument', 'projectId no es un identificador de proyecto');
  }
  requireProject(db, projectId);

  const existing = getSession(db, sessionId);
  if (existing) {
    if (existing.state === 'expired') {
      throw new RagError('session-expired', 'la sesión está terminada', {
        details: { session_id: sessionId, expires_at: existing.expires_at },
      });
    }
    if (existing.state === 'invalidated') {
      throw new RagError('scope-forbidden', 'la selección de la sesión fue invalidada', {
        details: { session_id: sessionId, reason: existing.invalid_reason },
      });
    }
  }

  if (existing && existing.project_id === projectId && existing.selection_source === source) {
    return {
      created: false, changed: false, selection: existing,
    };
  }

  const write = actor ?? selectedBy;
  db.exec('BEGIN IMMEDIATE');
  try {
    let selection;
    if (existing) {
      db.prepare(`UPDATE session_scope
        SET project_id=?, selection_source=?, selected_by=?, updated_at=?, cwd=?, revision=revision+1
        WHERE session_id=?`)
        .run(projectId, source, selectedBy, now, cwd, sessionId);
      selection = getSession(db, sessionId);
      audit(db, {
        now, actor: write, sessionId, action: 'session.reselect', target: projectId,
        detail: { project_id: projectId, revision: selection.revision },
      });
    } else {
      db.prepare(`INSERT INTO session_scope
        (session_id, project_id, state, selection_source, selected_by, selected_at, updated_at, cwd, clone_of, revision)
        VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 1)`)
        .run(sessionId, projectId, source, selectedBy, now, now, cwd, cloneOf);
      selection = getSession(db, sessionId);
      audit(db, {
        now, actor: write, sessionId, action: 'session.select', target: projectId,
        detail: { project_id: projectId, revision: 1, clone_of: cloneOf ?? null },
      });
    }
    db.exec('COMMIT');
    return { created: !existing, changed: true, selection };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Terminación normal: conserva la fila para auditoría y prohíbe reactivarla. */
export function expireSession(db, { identity, expectedProfileKey, actor = 'host', now = Date.now() } = {}) {
  const sessionId = assertProfile(identity, expectedProfileKey);
  const existing = getSession(db, sessionId);
  if (!existing) return { changed: false };
  if (existing.state !== 'active') return { changed: false, state: existing.state };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE session_scope SET state='expired', expires_at=?, updated_at=? WHERE session_id=?`)
      .run(now, now, sessionId);
    audit(db, { now, actor, sessionId, action: 'session.terminate', target: sessionId, detail: { state: 'expired' } });
    db.exec('COMMIT');
    return { changed: true, state: 'expired' };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Invalida una selección por una causa del contrato; nunca la reutiliza. */
export function invalidateSession(db, {
  identity, expectedProfileKey, reason, actor = 'host', now = Date.now(),
} = {}) {
  const sessionId = assertProfile(identity, expectedProfileKey);
  if (!INVALID_REASONS.includes(reason)) {
    throw new RagError('invalid-argument', 'motivo de invalidación inválido', { details: { reason } });
  }
  const existing = getSession(db, sessionId);
  if (!existing) return { changed: false };
  if (existing.state !== 'active') return { changed: false, state: existing.state };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE session_scope
      SET state='invalidated', invalidated_at=?, invalid_reason=?, updated_at=? WHERE session_id=?`)
      .run(now, reason, now, sessionId);
    audit(db, {
      now, actor, sessionId, action: 'session.invalidate', target: sessionId,
      detail: { reason },
    });
    db.exec('COMMIT');
    return { changed: true, state: 'invalidated', reason };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Sesiones huérfanas: filas activas cuyo `SessionId` ya no está entre las sesiones vivas del host.
 * Se terminan (no se invalidan): la causa es la desaparición de la sesión, no un permiso revocado.
 */
export function markOrphans(db, { activeSessionIds, now = Date.now() } = {}) {
  if (!Array.isArray(activeSessionIds)) {
    throw new RagError('invalid-argument', 'activeSessionIds debe ser una lista');
  }
  const active = new Set(activeSessionIds);
  const rows = db.prepare(`SELECT session_id FROM session_scope WHERE state='active' ORDER BY session_id`).all();
  const orphans = rows.map((row) => row.session_id).filter((id) => !active.has(id));
  let changed = 0;
  for (const sessionId of orphans) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE session_scope SET state='expired', expires_at=?, updated_at=? WHERE session_id=? AND state='active'`)
        .run(now, now, sessionId);
      audit(db, {
        now, actor: 'host', sessionId, action: 'session.orphan', target: sessionId,
        detail: { state: 'expired' },
      });
      db.exec('COMMIT');
      changed += 1;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return { changed, orphans };
}

export function grantLibrary(db, {
  projectId, libraryId, grantedBy = 'human', actor = null, now = Date.now(),
} = {}) {
  if (!['human', 'host'].includes(grantedBy)) {
    throw new RagError('invalid-argument', 'sólo una persona o el host pueden conceder bibliotecas');
  }
  requireProject(db, projectId);
  const library = db.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId);
  if (!library) throw new RagError('scope-forbidden', 'la biblioteca no existe en este perfil', {
    details: { reason: 'library-missing', library_id: libraryId },
  });
  if (library.status !== 'active') throw new RagError('scope-forbidden', 'la biblioteca está archivada', {
    details: { reason: 'library-archived', library_id: libraryId },
  });
  const open = db.prepare('SELECT * FROM grants WHERE project_id=? AND library_id=? AND revoked_at IS NULL')
    .get(projectId, libraryId);
  if (open) return { created: false, grant: open };
  const count = Number(db.prepare('SELECT COUNT(*) AS n FROM grants WHERE project_id=? AND revoked_at IS NULL')
    .get(projectId).n);
  if (count >= MAX_LIBRARIES_PER_PROJECT) {
    throw new RagError('scope-too-many', 'el proyecto ya tiene el máximo de bibliotecas concedidas', {
      details: {
        project_id: projectId, libraries: count, limit: MAX_LIBRARIES_PER_PROJECT, scopes_limit: MAX_SCOPES_PER_SELECTION,
      },
    });
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const info = db.prepare(`INSERT INTO grants (project_id, library_id, permission, granted_at, granted_by)
      VALUES (?, ?, 'read', ?, ?)`).run(projectId, libraryId, now, grantedBy);
    const grantId = Number(info.lastInsertRowid);
    audit(db, {
      now, actor: actor ?? grantedBy, action: 'grant.create', target: libraryId,
      detail: { project_id: projectId, library_id: libraryId, grant_id: grantId },
    });
    db.exec('COMMIT');
    return { created: true, grant: { id: grantId, project_id: projectId, library_id: libraryId } };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function revokeGrant(db, {
  projectId, libraryId, revokedBy = 'human', actor = null, now = Date.now(),
} = {}) {
  if (!['human', 'host'].includes(revokedBy)) {
    throw new RagError('invalid-argument', 'sólo una persona o el host pueden revocar bibliotecas');
  }
  const open = db.prepare('SELECT * FROM grants WHERE project_id=? AND library_id=? AND revoked_at IS NULL')
    .get(projectId, libraryId);
  if (!open) return { changed: false };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE grants SET revoked_at=?, revoked_by=? WHERE id=?').run(now, revokedBy, open.id);
    audit(db, {
      now, actor: actor ?? revokedBy, action: 'grant.revoke', target: libraryId,
      detail: { project_id: projectId, library_id: libraryId, grant_id: open.id },
    });
    db.exec('COMMIT');
    return { changed: true };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Ámbitos efectivos de una selección activa: el proyecto y sus bibliotecas concedidas y activas.
 * Aplica el límite de ocho ámbitos sin truncar: si se supera, falla.
 */
export function effectiveScopes(db, { identity, expectedProfileKey } = {}) {
  const sessionId = assertProfile(identity, expectedProfileKey);
  const session = getSession(db, sessionId);
  if (!session) {
    throw new RagError('scope-unresolved', 'la sesión no tiene selección', {
      details: { session_id: sessionId },
    });
  }
  if (session.state === 'expired') {
    throw new RagError('session-expired', 'la sesión está terminada', {
      details: { session_id: sessionId },
    });
  }
  if (session.state === 'invalidated') {
    throw new RagError('scope-forbidden', 'la selección de la sesión fue invalidada', {
      details: { session_id: sessionId, reason: session.invalid_reason },
    });
  }
  const project = requireProject(db, session.project_id);
  const libraries = db.prepare(`SELECT l.* FROM grants g
      JOIN libraries l ON l.id = g.library_id
      WHERE g.project_id = ? AND g.revoked_at IS NULL AND l.status = 'active'
      ORDER BY l.name, l.id`).all(project.id);
  if (libraries.length > MAX_LIBRARIES_PER_PROJECT) {
    throw new RagError('scope-too-many', 'la selección supera el máximo de bibliotecas', {
      details: {
        project_id: project.id,
        libraries: libraries.map((library) => library.id),
        limit: MAX_LIBRARIES_PER_PROJECT,
      },
    });
  }

  const rootsOf = (scopeKind, scopeId) => db.prepare(
    `SELECT id, path, path_key FROM roots WHERE scope_kind=? AND scope_id=? AND state='authorized' ORDER BY path`,
  ).all(scopeKind, scopeId);

  const projectRoots = rootsOf('prj', project.id);
  const scopes = [
    { kind: 'prj', id: project.id, name: project.name, roots: projectRoots },
    ...libraries.map((library) => ({
      kind: 'lib', id: library.id, name: library.name, roots: rootsOf('lib', library.id),
    })),
  ];
  const scopeCount = scopes.length;
  if (scopeCount > MAX_SCOPES_PER_SELECTION) {
    throw new RagError('scope-too-many', 'la selección supera el máximo de ámbitos', {
      details: { project_id: project.id, scopes: scopes.map((scope) => scope.id), limit: MAX_SCOPES_PER_SELECTION },
    });
  }
  return { session, project, scopes, scopeCount };
}
