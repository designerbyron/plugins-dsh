/**
 * Contexto de ejecución autorizado (PA3) con revocación efectiva (PA4-B).
 *
 * Toda herramienta pública pasa por aquí antes de tocar un almacén. El flujo es el del contrato:
 *
 *   identidad del host → perfil → registro → selección/resolución → ámbitos efectivos → almacenes
 *
 * Si cualquier paso falla, la herramienta falla en cerrado: no hay proyecto por defecto, no hay
 * búsqueda global de rescate y no se abre ningún almacén antes de resolver.
 *
 * PA4 añade puntos de control de autorización (`revalidate`): se comprueban antes de abrir un ámbito
 * y otra vez antes de devolver información. Una revocación detectada a mitad de operación aborta la
 * operación con `grant-revoked` y no se devuelve ningún resultado: el contrato v0.1 no tiene un campo
 * público para decir «parcial», así que un conjunto reducido se leería como exhaustivo.
 */

import { RagError } from './errors.mjs';
import { appendRegistryAudit, closeRegistry, openRegistry } from './registry.mjs';
import { profileKey, profileRoot } from './profile.mjs';
import { captureSession } from './session-identity.mjs';
import { listOpenProjects } from './harness-workspaces.mjs';
import { resolveScope } from './resolve.mjs';
import { openScopeStore, scopeStoreExists, scopeStoreDir } from './scope-stores.mjs';
import { closeDatabase } from './db.mjs';
import { authorizationLostError, currentAuthorization, diffScopes, revocationError } from './revocation.mjs';
import { assertRootUnchanged } from './roots-structure.mjs';

function nowOf(services) {
  return typeof services.now === 'function' ? services.now() : Date.now();
}

function cancelledError(where) {
  return new RagError('cancelled', 'la operación se canceló', { details: { reason: 'signal-aborted', where } });
}

/**
 * El `cwd` sólo sirve para resolver; si el host no puede darlo, no se inventa. Una sesión con
 * selección explícita sigue funcionando; sin selección el resultado será `scope-unresolved`.
 */
async function cwdOf(services, exec) {
  const directory = services.workingDirectory;
  if (!directory || typeof directory.ensure !== 'function') return null;
  try {
    return await directory.ensure(exec.agent, exec.signal);
  } catch (error) {
    // Una cancelación no es «no hay directorio»: se propaga para no confundir un turno abortado con
    // un ámbito sin resolver (el host distingue `cancelled` de `scope-unresolved`).
    if (exec.signal?.aborted) {
      throw new RagError('cancelled', 'la operación se canceló mientras se resolvía el directorio', {
        details: { reason: 'signal-aborted', where: 'cwd' },
      });
    }
    return null;
  }
}

/**
 * Ejecuta `work` con el contexto autorizado y cierra todo al terminar, incluso si `work` falla.
 *
 * @param {{services: object, exec: object}} options
 * @param {(ctx: object) => Promise<any>|any} work
 */
export async function withAuthorizedContext({ services, exec }, work) {
  if (!exec || typeof exec !== 'object') {
    throw new RagError('session-invalid', 'la herramienta se ejecutó sin contexto', { details: { reason: 'missing-exec' } });
  }
  if (!exec.agent || typeof exec.agent !== 'object') {
    throw new RagError('session-invalid', 'el host no entregó identidad de sesión', {
      details: { reason: 'missing-agent' },
    });
  }

  const env = services.env ?? process.env;
  const now = nowOf(services);
  const key = profileKey(env);
  const root = profileRoot(env);
  const identity = captureSession(exec.agent, { env, now });
  const signal = exec.signal ?? null;
  if (signal?.aborted) throw cancelledError('before-resolve');
  const cwd = await cwdOf(services, exec);

  let registry;
  try {
    registry = openRegistry({ root, create: false, now });
  } catch (error) {
    if (error instanceof RagError && error.code === 'store-not-initialized') {
      throw new RagError('registry-unavailable', 'este perfil no tiene registro Project-Aware', {
        details: { profile: key, root },
      });
    }
    throw error;
  }

  const opened = new Map();
  const openedScopes = [];
  const revocations = [];
  try {
    // Proyectos abiertos en Harness: señal de contexto, nunca autorización. Se leen antes de
    // resolver para que un `cwd` contenedor no oculte el proyecto que la persona tiene abierto.
    const openProjects = await listOpenProjects(services.workspaces);
    const resolved = resolveScope(registry.db, {
      identity, expectedProfileKey: key, cwd, openProjects, now,
    });

    const scopes = resolved.scopes.map((scope) => ({
      ...scope,
      dir: scopeStoreDir(root, scope.id),
      exists: scopeStoreExists(root, scope.id),
    }));
    // Una raíz autorizada representa una zona física concreta. Si su destino real cambió (junction,
    // enlace o directorio sustituido) deja de representar lo autorizado: se falla en cerrado antes de
    // abrir nada. Es la comprobación que hacía falta en el camino de ejecución, no sólo al registrar.
    const rootRows = registry.db.prepare(
      `SELECT id, path, path_key FROM roots WHERE scope_kind = ? AND scope_id = ? AND state = 'authorized' ORDER BY path`,
    );
    for (const scope of scopes) {
      for (const rootRow of rootRows.all(scope.kind, scope.id)) {
        assertRootUnchanged({ path: rootRow.path, path_key: rootRow.path_key, scope_id: scope.id });
      }
    }
    const authorized = new Set(scopes.map((scope) => scope.id));
    const audited = new Set();

    /** Deja constancia una sola vez por ámbito y operación. */
    function recordRevocation({ revoked, added, checkpoint }) {
      const fresh = revoked.filter((id) => !audited.has(`${id}:${checkpoint}`));
      if (fresh.length === 0) return;
      for (const id of fresh) audited.add(`${id}:${checkpoint}`);
      revocations.push({ revoked: [...revoked], added: [...added], checkpoint, at: nowOf(services) });
      appendRegistryAudit(registry.db, {
        at: nowOf(services),
        actor: 'host',
        sessionId: identity.sessionId,
        action: 'authorization.revoked',
        target: resolved.projectId,
        outcome: 'denied',
        detail: { revoked, added, checkpoint, guarantee: 'sin resultados del ámbito revocado' },
      });
    }

    /**
     * Relee la autorización real. Sin caché: lo que diga el registro en este instante es la verdad.
     * Lanza en cerrado si la sesión, el proyecto o un ámbito dejaron de estar autorizados.
     */
    function revalidate({ checkpoint = 'check', strict = true } = {}) {
      if (signal?.aborted) throw cancelledError(checkpoint);
      const current = currentAuthorization(registry.db, {
        sessionId: identity.sessionId,
        projectId: resolved.projectId,
        // Resolver por cwd no escribe una selección: en ese caso la autorización se lee del proyecto
        // y sus grants, no de una fila de sesión que legítimamente no existe.
        sessionOptional: resolved.source === 'cwd',
      });
      if (!current.ok) {
        appendRegistryAudit(registry.db, {
          at: nowOf(services),
          actor: 'host',
          sessionId: identity.sessionId,
          action: 'authorization.invalid',
          target: resolved.projectId,
          outcome: 'denied',
          detail: { reason: current.reason, invalidReason: current.invalidReason ?? null, checkpoint },
        });
        throw authorizationLostError(current);
      }
      const { revoked, added } = diffScopes([...authorized], current.scopes);
      if (revoked.length > 0) {
        recordRevocation({ revoked, added, checkpoint });
        if (strict) throw revocationError({ revoked, sessionId: identity.sessionId, reason: 'revoked-during-operation' });
        return { ok: false, revoked, added, authorization: current };
      }
      return { ok: true, revoked: [], added, authorization: current };
    }

    const ctx = {
      sessionId: identity.sessionId,
      profileKey: key,
      profileRoot: root,
      registryPath: registry.path,
      cwd,
      resolved,
      scopes,
      signal,
      openedScopes,
      revocations,
      /** Registro abierto del perfil: sólo para mantenimiento interno (ledger, `sync_state`). */
      registry: registry.db,
      /** Relee autorización; un ámbito revocado aborta la operación. */
      revalidate,
      /** Comprueba que este ámbito sigue autorizado justo antes de abrirlo o usarlo. */
      assertAuthorized(scope, checkpoint = 'scope') {
        const result = revalidate({ checkpoint: `${checkpoint}:${scope.id}`, strict: false });
        if (!result.ok) throw revocationError({ revoked: result.revoked, sessionId: identity.sessionId });
        if (!authorized.has(scope.id)) {
          throw new RagError('scope-forbidden', 'el ámbito no estaba autorizado al abrir la operación', {
            details: { reason: 'scope-not-in-snapshot', scope: scope.id },
          });
        }
        return result;
      },
      /** Punto de control obligatorio antes de devolver información al consumidor. */
      checkpoint(where = 'return') {
        return revalidate({ checkpoint: where, strict: true });
      },
      /** Abre un ámbito ya autorizado. `create` sólo se usa para la escritura del proyecto. */
      open(scope, { create = false } = {}) {
        if (!scope || typeof scope.id !== 'string') {
          throw new RagError('internal', 'ámbito no válido');
        }
        if (signal?.aborted) throw cancelledError(`open:${scope.id}`);
        // Un handle ya abierto no es una autorización permanente: se vuelve a comprobar antes de
        // devolverlo, porque una revocación puede haber ocurrido entre dos usos del mismo ámbito.
        if (opened.has(scope.id)) {
          ctx.assertAuthorized(scope, 'reopen');
          return opened.get(scope.id);
        }
        ctx.assertAuthorized(scope, 'open');
        const db = openScopeStore({ profileRoot: root, profileKey: key, scope, create, now });
        if (db) {
          opened.set(scope.id, db);
          openedScopes.push({ id: scope.id, kind: scope.kind, create });
        }
        return db;
      },
      project() {
        return scopes.find((scope) => scope.kind === 'prj') ?? null;
      },
      libraries() {
        return scopes.filter((scope) => scope.kind === 'lib');
      },
    };

    return await work(ctx);
  } finally {
    for (const db of opened.values()) closeDatabase(db);
    closeRegistry(registry.db);
  }
}
