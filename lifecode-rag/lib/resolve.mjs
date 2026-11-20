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
import { findProjectBoundary, registerDiscoveredProject } from './discovery.mjs';
import { normalizeWorkspace, openProjectForCwd, openProjectForSession } from './harness-workspaces.mjs';
import { assertSessionId } from './session-identity.mjs';
import { effectiveScopes, getSession } from './sessions.mjs';
import { trustedRootFor } from './trusted-roots.mjs';

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
 * Auto-descubrimiento en el camino de resolución.
 *
 * Si la persona tiene un proyecto abierto en Harness, ese proyecto es el candidato natural
 * aunque el `cwd` de la sesión apunte a su carpeta contenedora (p. ej. `htdocs`): abrir
 * `plugins-dhs` no autoriza a sus hermanos. Si no hay workspace abierto, se mantiene el
 * descubrimiento por `cwd` dentro de un workspace confiable.
 *
 * En ambos casos la lectura exige un `trusted root` explícito que cubra el proyecto. Un
 * proyecto abierto sin autorización devuelve una denegación con el comando exacto que la
 * persona debe ejecutar; nunca se concede autorización por el hecho de estar abierto.
 */
function autoDiscoverCwd(db, { cwd, sessionId, openProjects, now }) {
  const cwdKey = typeof cwd === 'string' && cwd.trim() !== '' ? pathKeyFor(cwd) : null;
  const open = openProjectForCwd(openProjects, cwdKey)
    ?? openProjectForSession(openProjects, sessionId);

  let boundary = null;
  if (open) {
    boundary = { path: open.path, name: open.title, type: 'harness-workspace', indicators: [] };
  } else {
    const trust = trustedRootFor(db, cwdKey);
    if (!trust || trust.readAuthorization !== true) return { registered: false };
    try {
      boundary = findProjectBoundary(cwd, { withinPath: trust.path });
    } catch {
      return { registered: false };
    }
    if (!boundary) return { registered: false };
  }

  const boundaryKey = pathKeyFor(boundary.path);
  const authorization = trustedRootFor(db, boundaryKey);
  if (!authorization || authorization.readAuthorization !== true) {
    return {
      registered: false,
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

  try {
    const result = registerDiscoveredProject(db, {
      path: boundary.path,
      name: boundary.name,
      type: boundary.type,
      indicators: boundary.indicators,
      source: open ? 'harness' : 'auto',
      authorization: 'read',
      now,
    });
    return { registered: result.registeredRoot !== false, projectId: result.projectId };
  } catch {
    return { registered: false };
  }
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
    succeed(db, { sessionId, projectId: effective.project.id, source: 'explicit', effective, now });
    return resultOf(sessionId, 'explicit', effective);
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
    const attempt = autoDiscoverCwd(db, { cwd, sessionId, openProjects: open, now });
    if (attempt.denied) {
      deny(db, { sessionId, identity, ...attempt.denied, now });
    }
    if (attempt.registered && attempt.projectId) {
      // El proyecto abierto puede ser hijo del `cwd` (la carpeta contenedora): no es una
      // coincidencia por prefijo, así que se resuelve directamente por su id.
      const effective = effectiveScopesForProject(db, attempt.projectId);
      succeed(db, { sessionId, projectId: attempt.projectId, source: 'cwd', effective, now });
      return resultOf(sessionId, 'cwd', effective);
    }
    if (attempt.registered) matches = matchingProjects(db, cwdKey);
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

function succeed(db, { sessionId, projectId, source, effective, now }) {
  appendRegistryAudit(db, {
    at: now,
    actor: 'host',
    sessionId,
    action: 'scope.resolve',
    target: projectId,
    outcome: 'ok',
    detail: JSON.stringify({ project_id: projectId, source, scopes: effective.scopeCount }),
  });
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
