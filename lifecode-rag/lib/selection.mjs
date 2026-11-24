/**
 * CR-1 · Selección de proyecto persistida con compare-and-swap.
 *
 * Una sola fila por perfil (`selection_key='profile'`) con una `revision` monotónica. El cliente
 * lee la revisión vigente y la envía de vuelta al escribir: si otro cliente ya escribió, la revisión
 * no coincide y la escritura se rechaza con `revision-conflict` en vez de perder el cambio ajeno
 * (nada de *last write wins*).
 *
 * Qué NO es: no es identidad. La selección no autentica a nadie; el principal lo fija el host y el
 * adaptador lo pasa como `principal`. Un `SessionId` de conversación tampoco sirve como identidad
 * ni como llave de concurrencia.
 *
 * La revisión vive en el registro del perfil, así que sobrevive al cierre de la sesión y al reinicio
 * del proceso. La tabla es aditiva (registro v2) y no toca ninguna fila existente.
 */
import { RagError } from './errors.mjs';
import { appendRegistryAudit, archiveProject } from './registry.mjs';
import { withTransaction } from './db.mjs';

export const SELECTION_KEY = 'profile';
/** Revisión que declara un cliente que todavía no ha visto ninguna selección. */
export const NO_SELECTION_REVISION = 0;

function rowToSelection(row, projectName = null) {
  if (!row) return null;
  return {
    projectId: row.project_id,
    projectName,
    revision: Number(row.revision),
    source: row.selection_source,
    selectedBy: row.selected_by,
    principal: row.principal,
    selectedAt: Number(row.selected_at),
    updatedAt: Number(row.updated_at),
  };
}

/** Selección vigente del perfil, o `null` si nadie ha seleccionado todavía. */
export function readSelection(db) {
  const row = db.prepare(`SELECT s.selection_key, s.project_id, s.revision, s.selection_source,
      s.selected_by, s.principal, s.selected_at, s.updated_at, p.name AS project_name
    FROM pa_selection s LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.selection_key = ?`).get(SELECTION_KEY);
  return rowToSelection(row, row?.project_name ?? null);
}

function requireProjectForSelection(db, projectId) {
  if (typeof projectId !== 'string' || !projectId.startsWith('prj_')) {
    throw new RagError('invalid-argument', 'projectId no es un identificador de proyecto', {
      details: { reason: 'invalid-field', field: 'project' },
    });
  }
  const project = db.prepare('SELECT id, name, status FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    throw new RagError('project-not-authorized', 'proyecto desconocido o no autorizado', {
      details: { project: projectId },
    });
  }
  if (project.status !== 'active') {
    throw new RagError('project-not-authorized', 'el proyecto está archivado', {
      details: { project: projectId, status: project.status },
    });
  }
  return project;
}

function requireExpectedRevision(value) {
  if (value === undefined || value === null) {
    throw new RagError('invalid-argument', 'falta expectedRevision', {
      details: { reason: 'missing-field', field: 'expectedRevision' },
    });
  }
  if (!Number.isInteger(value) || value < NO_SELECTION_REVISION) {
    throw new RagError('invalid-argument', 'expectedRevision inválida', {
      details: { reason: 'invalid-field', field: 'expectedRevision' },
    });
  }
  return value;
}

/**
 * Cambia la selección del perfil si —y sólo si— el cliente conoce la revisión vigente.
 *
 * @returns {{changed: boolean, selection: object}}
 * @throws {RagError} `revision-conflict` (409) si la revisión esperada no es la vigente;
 *   `invalid-argument` si falta o no es válida; `project-not-authorized` si el proyecto no sirve.
 */
export function applySelection(db, {
  projectId, expectedRevision, selectedBy = 'human', source = 'explicit',
  principal = 'owner', now = Date.now(),
} = {}) {
  if (!['human', 'host'].includes(selectedBy)) {
    throw new RagError('invalid-argument', 'sólo una persona o el host pueden seleccionar proyecto');
  }
  if (!['explicit', 'cwd'].includes(source)) {
    throw new RagError('invalid-argument', 'origen de selección inválido', { details: { source } });
  }
  const expected = requireExpectedRevision(expectedRevision);
  const project = requireProjectForSelection(db, projectId);

  return withTransaction(db, () => {
    // `BEGIN IMMEDIATE` serializa a los escritores del perfil: la lectura de la revisión y la
    // escritura ocurren en la misma transacción, así que dos clientes con la misma revisión no
    // pueden confirmar los dos.
    const current = readSelection(db);
    const currentRevision = current ? current.revision : NO_SELECTION_REVISION;
    if (currentRevision !== expected) {
      throw new RagError('revision-conflict', 'la selección cambió mientras la editabas', {
        details: {
          reason: 'revision-mismatch',
          expectedRevision: expected,
          currentRevision,
          current: current
            ? { projectId: current.projectId, projectName: current.projectName, revision: current.revision }
            : { projectId: null, projectName: null, revision: NO_SELECTION_REVISION },
        },
      });
    }
    if (current && current.projectId === projectId) {
      // Misma selección y misma revisión: no se crea una revisión nueva por un clic repetido.
      return { changed: false, selection: current };
    }
    const nextRevision = currentRevision + 1;
    if (current) {
      db.prepare(`UPDATE pa_selection
          SET project_id = ?, revision = ?, selection_source = ?, selected_by = ?, principal = ?, updated_at = ?
        WHERE selection_key = ?`)
        .run(projectId, nextRevision, source, selectedBy, principal, now, SELECTION_KEY);
    } else {
      db.prepare(`INSERT INTO pa_selection
          (selection_key, project_id, revision, selection_source, selected_by, principal, selected_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(SELECTION_KEY, projectId, nextRevision, source, selectedBy, principal, now, now);
    }
    appendRegistryAudit(db, {
      at: now,
      actor: selectedBy,
      sessionId: null,
      action: current ? 'selection.reselect' : 'selection.select',
      target: projectId,
      outcome: 'ok',
      detail: {
        revision: nextRevision,
        previous: current ? { projectId: current.projectId, revision: current.revision } : null,
        principal,
      },
    });
    return { changed: true, selection: readSelection(db) };
  }, { immediate: true });
}

/* --------------------------------------------------------- reselección al archivar (ACP-07 F1)
 *
 * R-1: un proyecto activo no se archiva sin resolver la selección. Estas dos funciones lo garantizan
 * en una sola transacción: primero se mueve (o se limpia) la selección y después se archiva. Si algo
 * falla, el `ROLLBACK` deja las dos cosas como estaban.
 */

/**
 * Mueve la selección al proyecto activo más antiguo distinto del archivado; si no queda ninguno,
 * deja el perfil sin selección. **Asume que el llamador ya abrió una transacción.**
 *
 * @returns {{changed: boolean, selection: object|null, reason: string}}
 */
export function reselectAfterArchive(db, { archivedProjectId, now = Date.now(), principal = 'owner' } = {}) {
  const current = readSelection(db);
  if (!current || current.projectId !== archivedProjectId) {
    return { changed: false, selection: current, reason: 'not-selected' };
  }
  const next = db.prepare(`SELECT id, name FROM projects
      WHERE status = 'active' AND id <> ? ORDER BY created_at, id LIMIT 1`).get(archivedProjectId);
  const nextRevision = current.revision + 1;
  if (next) {
    db.prepare(`UPDATE pa_selection
        SET project_id = ?, revision = ?, selection_source = 'explicit', selected_by = 'host',
            principal = ?, updated_at = ?
      WHERE selection_key = ?`)
      .run(next.id, nextRevision, principal, now, SELECTION_KEY);
    appendRegistryAudit(db, {
      at: now,
      actor: 'host',
      sessionId: null,
      action: 'selection.reselect',
      target: next.id,
      outcome: 'ok',
      detail: {
        reason: 'project-archived',
        revision: nextRevision,
        previous: { projectId: current.projectId, revision: current.revision },
      },
    });
    return { changed: true, selection: readSelection(db), reason: 'moved' };
  }
  // Ni un solo proyecto activo: el perfil se queda sin selección, y el cliente lo verá al releer.
  db.prepare('DELETE FROM pa_selection WHERE selection_key = ?').run(SELECTION_KEY);
  appendRegistryAudit(db, {
    at: now,
    actor: 'host',
    sessionId: null,
    action: 'selection.reselect',
    target: current.projectId,
    outcome: 'ok',
    detail: { reason: 'project-archived', revision: nextRevision, previous: { projectId: current.projectId, revision: current.revision }, next: null },
  });
  return { changed: true, selection: null, reason: 'cleared' };
}

/**
 * Archiva un proyecto resolviendo antes la selección, todo en una transacción `IMMEDIATE`.
 * Es la única forma de archivar el proyecto seleccionado: `archiveProject` solo se niega.
 */
export function archiveProjectWithSelection(db, {
  projectId, now = Date.now(), actor = 'human', principal = 'owner',
} = {}) {
  return withTransaction(db, () => {
    const reselect = reselectAfterArchive(db, { archivedProjectId: projectId, now, principal });
    const archived = archiveProject(db, { id: projectId, now, actor });
    return {
      changed: archived.changed,
      project: archived.project,
      selection: reselect.selection,
      selectionChange: reselect.reason,
    };
  }, { immediate: true });
}
