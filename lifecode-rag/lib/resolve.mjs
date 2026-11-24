/**
 * Resolución de ámbitos (PA2.4/PA2.6): determinista y fail-closed.
 *
 * Orden del contrato de sesión:
 *   1. identidad estable del host (atada al perfil),
 *   2. selección explícita persistida,
 *   3. si no hay selección, `cwd` contra raíces autorizadas de proyectos activos,
 *   4. exactamente una coincidencia; cero → `scope-unresolved`, varias → `scope-ambiguous`.
 *
 * No hay proyecto por defecto, ni «el último», ni «el primero». Una selección explícita
 * incompatible con el `cwd` no se corrige sola: se rechaza como ambigua.
 */

import { RagError } from './errors.mjs';
import { appendRegistryAudit, getProject, pathKeyFor } from './registry.mjs';
import { findProjectBoundary } from './discovery.mjs';
import { normalizeWorkspace, openProjectForCwd, openProjectForSession } from './harness-workspaces.mjs';
import { assertSessionId } from './session-identity.mjs';
import { effectiveScopes, getSession } from './sessions.mjs';
import { trustedRootFor } from './trusted-roots.mjs';
import { readTracking, reconcileTracking } from './tracking-store.mjs';

function deny(db, { sessionId, identity, code, message, details, now }) {
  try {
    appendRegistryAudit(db, {
      at: now,
      actor: 'host',
      sessionId: sessionId ?? identity?.sessionId ?? null,
      action: 'scope.resolve',
      target: details?.project_id ?? details?.cwd ?? 'scope',
      outcome: 'denied',
      detail: JSON.stringify({ code, ...details }),
    });
  } catch {
    // si la auditoría falla, el rechazo sigue siendo un rechazo
  }
  throw new RagError(code, message, { details });
}

function insideRoot(cwdKey, rootKey) {
  if (!cwdKey || !rootKey) return false;
  if (cwdKey === rootKey) return true;
  const prefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`;
  return cwdKey.startsWith(prefix);
}

function matchingProjects(db, cwdKey) {
  const rows = db.prepare(`SELECT p.id AS project_id, p.name AS project_name, r.path, r.path_key
    FROM roots r JOIN projects p ON p.id = r.scope_id
    WHERE r.scope_kind='prj' AND r.state='authorized' AND p.status='active'
    ORDER BY r.path`).all();
  return rows.filter((row) => insideRoot(cwdKey, row.path_key));
}

/**
 * Con raíces anidadas (un proyecto dentro del directorio de otro) gana la raíz más específica:
 * se descarta toda coincidencia cuyo directorio contenga a otra coincidencia distinta. Si tras
 * podar quedan dos proyectos hermanos, la coincidencia sigue siendo ambigua.
 */
function mostSpecific(matches) {
  return matches.filter((row) => !matches.some((other) => (
    other.project_id !== row.project_id
    && other.path_key !== row.path_key
    && other.path_key.startsWith(`${row.path_key}/`)
  )));
}

/**
 * Averigua a qué proyecto apunta el `cwd` **sin escribir nada** (ACP-07 F2, decisión D-02).
 *
 * Antes esta función registraba el proyecto (`registerDiscoveredProject`). Eso hacía que un simple
 * uso del agente creara filas en el registro y difuminaba la diferencia entre candidato y proyecto
 * registrado. Ahora sólo informa: si el proyecto no está registrado, el llamador devuelve
 * `scope-unresolved` con la acción y el comando para registrarlo.
 *
 * @returns {{boundary: null} | {denied: object} | {boundary: object, projectId: string|null}}
 */
function probeCwdProject(db, { cwd, sessionId, openProjects }) {
  const cwdKey = typeof cwd === 'string' && cwd.trim() !== '' ? pathKeyFor(cwd) : null;
  const open = openProjectForCwd(openProjects, cwdKey)
    ?? openProjectForSession(openProjects, sessionId);

  let boundary = null;
  if (open) {
    boundary = { path: open.path, name: open.title, type: 'harness-workspace', indicators: [] };
  } else {
    const trust = trustedRootFor(db, cwdKey);
    if (!trust || trust.readAuthorization !== true) return { boundary: null };
    try {
      boundary = findProjectBoundary(cwd, { withinPath: trust.path });
    } catch {
      return { boundary: null };
    }
    if (!boundary) return { boundary: null };
  }

  const boundaryKey = pathKeyFor(boundary.path);
  const authorization = trustedRootFor(db, boundaryKey);
  if (!authorization || authorization.readAuthorization !== true) {
    return {
      denied: {
        code: 'scope-unresolved',
        message: 'el proyecto abierto en Harness no está autorizado para lectura',
        details: {
          session_id: sessionId,
          cwd: cwd ?? null,
          reason: 'project-not-authorized',
          project: { id: open?.id ?? null, path: open?.path ?? boundary.path, title: boundary.name },
          command: `node bin/lifecode-rag.mjs trust add --path "${open?.path ?? boundary.path}"`,
        },
      },
    };
  }

  // Si el proyecto ya está registrado (su raíz existe), se resuelve como siempre: aquí no hay nada
  // que crear ni que autorizar de nuevo.
  const registered = db.prepare(`SELECT scope_id FROM roots
      WHERE scope_kind = 'prj' AND path_key = ? LIMIT 1`).get(boundaryKey);
  return { boundary, projectId: registered?.scope_id ?? null };
}

function scopesOf(db, identity, expectedProfileKey) {
  return effectiveScopes(db, { identity, expectedProfileKey });
}

/**
 * Resuelve el ámbito de una sesión. Devuelve la selección efectiva sin abrir almacenes de ámbito
 * (eso corresponde a PA3) y sin persistir una selección derivada de `cwd`.
 */
export function resolveScope(db, {
  identity, expectedProfileKey, cwd = null, openProjects = [], now = Date.now(),
} = {}) {
  if (!identity || typeof identity !== 'object') {
    throw new RagError('session-invalid', 'falta la identidad de sesión', { details: { reason: 'missing-identity' } });
  }
  const sessionId = assertSessionId(identity.sessionId);
  const cwdKey = typeof cwd === 'string' && cwd.trim() !== '' ? pathKeyFor(cwd) : null;
  // Se normaliza en la frontera: cualquier llamante puede pasar la forma cruda del host.
  const open = (Array.isArray(openProjects) ? openProjects : [])
    .map((entry) => normalizeWorkspace(entry))
    .filter(Boolean);


  if (identity.profileKey !== expectedProfileKey) {
    deny(db, {
      sessionId, identity, code: 'session-invalid',
      message: 'la sesión pertenece a otro perfil',
      details: { reason: 'profile-mismatch' }, now,
    });
  }

  const session = getSession(db, sessionId);

  if (session) {
    if (session.state === 'expired') {
      // Una sesión terminada también es una denegación: si no se audita, la cadena miente por omisión.
      deny(db, {
        sessionId, identity, code: 'session-expired',
        message: 'la sesión está terminada',
        details: { session_id: sessionId, reason: 'session-expired', expires_at: session.expires_at }, now,
      });
    }
    if (session.state === 'invalidated') {
      deny(db, {
        sessionId, identity, code: 'scope-forbidden',
        message: 'la selección de la sesión fue invalidada',
        details: { session_id: sessionId, reason: session.invalid_reason }, now,
      });
    }
    const project = getProject(db, session.project_id);
    if (!project || project.status !== 'active') {
      deny(db, {
        sessionId, identity, code: 'scope-forbidden',
        message: 'el proyecto seleccionado no está activo',
        details: { session_id: sessionId, project_id: session.project_id, reason: 'project-archived' }, now,
      });
    }
    if (cwdKey) {
      const matches = mostSpecific(matchingProjects(db, cwdKey));
      const projects = new Set(matches.map((row) => row.project_id));
      if (projects.size > 1 || (projects.size === 1 && !projects.has(session.project_id))) {
        deny(db, {
          sessionId, identity, code: 'scope-ambiguous',
          message: 'el directorio de trabajo no corresponde a la selección explícita',
          details: {
            session_id: sessionId,
            selected_project_id: session.project_id,
            candidates: matches.map((row) => ({ project_id: row.project_id, path: row.path })),
          }, now,
        });
      }
    }
    const effective = scopesOf(db, identity, expectedProfileKey);
    const note = trackingNoteForSession(db, {
      sessionId, open, explicitProjectId: session.project_id,
    });
    succeed(db, {
      sessionId, projectId: effective.project.id, source: 'explicit', effective, now,
      tracking: note.tracking, discrepancy: note.discrepancy,
    });
    return resultOf(sessionId, 'explicit', effective);
  }

  // La disponibilidad se mide aquí, ya validados perfil y sesión (F2): una petición con identidad
  // ajena no escribe nada. Y sólo se anota lo que se midió: la lista del Host contiene únicamente
  // workspaces en estado ok, así que la ausencia en ella NO prueba ausencia en disco (D-IMPL-09).
  reconcileTrackedAvailability(db, open, now);

  // Escalón 2 (`D-UX22-12`): workspace seguido de ESTA sesión. Aporta sólo el proyecto; raíces,
  // grants y actividad se evalúan como siempre. Una selección explícita nunca llega hasta aquí.
  const seguidos = trackedForSession(db, { sessionId, open });
  if (seguidos.length > 0) {
    // `D-UX22-02`: un solo workspace por sesión. Si el Host asocia la sesión a varios, no se elige.
    if (seguidos.length > 1) {
      const proyectos = new Set(seguidos.map((row) => row.projectId));
      if (proyectos.size > 1) {
        deny(db, {
          sessionId, identity, code: 'scope-conflict',
          message: 'la sesión está asociada a más de un workspace seguido con proyectos distintos',
          details: {
            session_id: sessionId,
            workspaces: seguidos.map((row) => ({
              workspace_path: row.path ?? null, workspace_project_id: row.projectId,
            })),
          }, now,
        });
      }
    }
    const tracked = seguidos[0];
    if (tracked.state !== 'on' || tracked.lastStatus !== 'ok' || !tracked.projectId) {
      deny(db, {
        sessionId, identity, code: 'scope-unresolved',
        message: 'el workspace de esta sesión está seguido pero no resuelve contexto',
        details: {
          session_id: sessionId,
          cwd: cwd ?? null,
          reason: 'tracking-not-resolving',
          workspace_path: tracked.path ?? null,
          tracking: {
            state: tracked.state,
            last_status: tracked.lastStatus,
            association: tracked.association,
            project_id: tracked.projectId ?? null,
          },
        }, now,
      });
    }
    if (cwdKey) {
      const candidates = mostSpecific(matchingProjects(db, cwdKey));
      const projects = new Set(candidates.map((row) => row.project_id));
      // F14: el mismo cwd ambiguo del escalón 3 no puede resolverse aquí en silencio.
      if (projects.size > 1) {
        deny(db, {
          sessionId, identity, code: 'scope-ambiguous',
          message: 'el directorio de trabajo coincide con más de un proyecto',
          details: {
            session_id: sessionId,
            candidates: candidates.map((row) => ({ project_id: row.project_id, path: row.path })),
          }, now,
        });
      }
      if (projects.size === 1 && !projects.has(tracked.projectId)) {
        const [other] = candidates;
        deny(db, {
          sessionId, identity, code: 'scope-conflict',
          message: 'el workspace seguido y el directorio de trabajo apuntan a proyectos distintos',
          details: {
            session_id: sessionId,
            workspace_path: tracked.path ?? null,
            workspace_project_id: tracked.projectId,
            cwd: cwd ?? null,
            cwd_project_id: other.project_id,
          }, now,
        });
      }
    }
    const trackedProject = getProject(db, tracked.projectId);
    if (!trackedProject || trackedProject.status !== 'active') {
      deny(db, {
        sessionId, identity, code: 'scope-forbidden',
        message: 'el proyecto del workspace seguido no está activo',
        details: {
          session_id: sessionId, project_id: tracked.projectId, reason: 'project-archived',
        }, now,
      });
    }
    const effective = effectiveScopesForProject(db, tracked.projectId);
    succeed(db, { sessionId, projectId: effective.project.id, source: 'tracking', effective, now });
    return resultOf(sessionId, 'tracking', effective);
  }

  if (!cwdKey) {
    deny(db, {
      sessionId, identity, code: 'scope-unresolved',
      message: 'la sesión no tiene selección y no hay directorio de trabajo verificable',
      details: { session_id: sessionId, cwd: null }, now,
    });
  }
  let matches = matchingProjects(db, cwdKey);
  if (matches.length === 0) {
    const probe = probeCwdProject(db, { cwd, sessionId, openProjects: open });
    if (probe.denied) {
      deny(db, { sessionId, identity, ...probe.denied, now });
    }
    // Proyecto identificado y ya registrado: el `cwd` puede ser su carpeta contenedora, así que se
    // resuelve por id (no es una coincidencia por prefijo).
    if (probe.projectId) {
      const effective = effectiveScopesForProject(db, probe.projectId);
      succeed(db, { sessionId, projectId: probe.projectId, source: 'cwd', effective, now });
      return resultOf(sessionId, 'cwd', effective);
    }
    // Proyecto identificado pero NO registrado: no se registra solo (D-02). Se devuelve el acto
    // explícito que la persona debe realizar, con su comando.
    if (probe.boundary) {
      deny(db, {
        sessionId, identity, code: 'scope-unresolved',
        message: 'el proyecto no está registrado en este perfil',
        details: {
          session_id: sessionId,
          cwd: cwd ?? null,
          reason: 'project-not-registered',
          action: 'register-project',
          command: `node bin/lifecode-rag.mjs discover register --path "${probe.boundary.path}"`,
          project: {
            path: probe.boundary.path,
            title: probe.boundary.name,
            type: probe.boundary.type,
          },
        }, now,
      });
    }
  }
  matches = mostSpecific(matches);
  const projects = new Set(matches.map((row) => row.project_id));
  if (projects.size === 0) {
    deny(db, {
      sessionId, identity, code: 'scope-unresolved',
      message: 'el directorio de trabajo no está dentro de ninguna raíz autorizada',
      details: {
        session_id: sessionId,
        cwd: cwd ?? null,
        open_projects: open.map((project) => ({ id: project.id, path: project.path, title: project.title })),
      }, now,
    });
  }
  if (projects.size > 1) {
    deny(db, {
      sessionId, identity, code: 'scope-ambiguous',
      message: 'el directorio de trabajo coincide con más de un proyecto',
      details: {
        session_id: sessionId,
        candidates: matches.map((row) => ({ project_id: row.project_id, path: row.path })),
      }, now,
    });
  }
  const [match] = matches;
  const effective = effectiveScopesForProject(db, match.project_id);
  succeed(db, { sessionId, projectId: match.project_id, source: 'cwd', effective, now });
  return resultOf(sessionId, 'cwd', effective);
}

/**
 * Reconciliación del eje B (`D-UX22-08`, `D-IMPL-03`) en el punto que ya escribe auditoría.
 *
 * `GET /pa/workspaces` sigue siendo de sólo lectura: esto corre al **resolver**, con la lista real que
 * entrega el Host. No crea filas (`D-IMPL-02`), no toca el eje A y no lanza: la disponibilidad es un
 * dato informativo y su fallo no puede tumbar la resolución.
 */
function reconcileTrackedAvailability(db, open, now) {
  if (open.length === 0) return; // sin lista del Host no hay medición que valga
  let rows;
  try {
    rows = db.prepare('SELECT path_key, path, last_status FROM workspace_tracking').all();
  } catch {
    return; // registro todavía en v2: no hay seguimiento que reconciliar
  }
  if (rows.length === 0) return;
  const present = new Map();
  for (const project of open) {
    if (typeof project.path !== 'string' || project.path === '') continue;
    present.set(pathKeyFor(project.path), project.path);
  }
  if (present.size === 0) return;
  // D-IMPL-09: sólo se anota la presencia medida. La lista del Host omite los workspaces cuyo
  // `status()` falló o no es ok, así que su ausencia no prueba ausencia en disco: escribir `missing`
  // aquí convertiría un timeout transitorio en «desaparecido» (F4). `missing` exige una medición
  // propia (proyección de UX-2.1 o barrido explícito).
  const changed = rows.some((row) => present.has(row.path_key) && row.last_status !== 'ok');
  if (!changed) return; // sin novedad no se escribe ni se audita
  try {
    // D-IMPL-07: sin `path` en la reconciliación — la ruta literal se congela con la fila (F7).
    reconcileTracking(db, {
      present: [...present].map(([pathKey]) => ({ pathKey })),
      absent: [],
      unknown: [],
      measuredAt: now,
    });
  } catch {
    // ver arriba: informativo
  }
}

/**
 * Filas de seguimiento de los workspaces que el Host asocia a ESTA sesión (`D-UX22-02`).
 *
 * Devuelve una lista para que el llamador pueda detectar el caso en que la sesión aparezca en más de
 * un workspace (no se elige el primero en silencio). `state='off'` **no** es un workspace seguido:
 * significa «no seguido», así que no participa en la resolución y se deja caer al escalón siguiente (F1).
 */
function trackedForSession(db, { sessionId, open }) {
  if (open.length === 0) return [];
  const rows = [];
  for (const workspace of open) {
    if (!Array.isArray(workspace.sessionIds) || !workspace.sessionIds.includes(sessionId)) continue;
    if (typeof workspace.path !== 'string' || workspace.path === '') continue;
    let row = null;
    try {
      row = readTracking(db, { pathKey: pathKeyFor(workspace.path) });
    } catch {
      row = null;
    }
    if (row && row.state !== 'off') rows.push(row);
  }
  return rows;
}

function effectiveScopesForProject(db, projectId) {
  const project = getProject(db, projectId);
  if (!project || project.status !== 'active') {
    throw new RagError('scope-forbidden', 'el proyecto no está activo', {
      details: { project_id: projectId, reason: 'project-archived' },
    });
  }
  const libraries = db.prepare(`SELECT l.* FROM grants g
      JOIN libraries l ON l.id = g.library_id
      WHERE g.project_id = ? AND g.revoked_at IS NULL AND l.status = 'active'
      ORDER BY l.name, l.id`).all(projectId);
  const rootsOf = (scopeKind, scopeId) => db.prepare(
    `SELECT id, path FROM roots WHERE scope_kind=? AND scope_id=? AND state='authorized' ORDER BY path`,
  ).all(scopeKind, scopeId);
  const scopes = [
    { kind: 'prj', id: project.id, name: project.name, roots: rootsOf('prj', project.id) },
    ...libraries.map((library) => ({
      kind: 'lib', id: library.id, name: library.name, roots: rootsOf('lib', library.id),
    })),
  ];
  if (scopes.length > 8) {
    throw new RagError('scope-too-many', 'la selección supera el máximo de ámbitos', {
      details: { project_id: projectId, scopes: scopes.map((scope) => scope.id), limit: 8 },
    });
  }
  return { project, scopes, scopeCount: scopes.length, session: null };
}

function succeed(db, { sessionId, projectId, source, effective, now, tracking = null, discrepancy = false }) {
  // `D-UX22-12`: la selección explícita prevalece, pero la discrepancia con el workspace seguido debe
  // poder auditarse. Se anota sólo cuando se midió; si no hay fila, el detalle queda como siempre (F5).
  const detail = { project_id: projectId, source, scopes: effective.scopeCount };
  if (tracking) detail.tracking = tracking;
  if (discrepancy) detail.discrepancy = true;
  appendRegistryAudit(db, {
    at: now,
    actor: 'host',
    sessionId,
    action: 'scope.resolve',
    target: projectId,
    outcome: 'ok',
    detail: JSON.stringify(detail),
  });
}

/**
 * Lectura de sólo lectura del seguimiento para la rama de selección explícita: no decide nada, sólo
 * deja constancia de que el workspace seguido apunta a otro proyecto (F5).
 */
function trackingNoteForSession(db, { sessionId, open, explicitProjectId }) {
  const rows = trackedForSession(db, { sessionId, open });
  if (rows.length === 0) return { tracking: null, discrepancy: false };
  const [row] = rows;
  return {
    tracking: { project_id: row.projectId ?? null, state: row.state },
    discrepancy: Boolean(row.projectId) && row.projectId !== explicitProjectId,
  };
}

function resultOf(sessionId, source, effective) {
  return {
    sessionId,
    projectId: effective.project.id,
    projectName: effective.project.name,
    source,
    revision: effective.session?.revision ?? null,
    scopes: effective.scopes.map((scope) => ({
      kind: scope.kind, id: scope.id, name: scope.name, roots: scope.roots.map((root) => root.path),
    })),
    scopeCount: effective.scopeCount,
  };
}
