/**
 * Resolución real, en frío: registro real del perfil `desktop` (copia) + workspaces abiertos reales
 * (`~/.dsh/storages/workspace.json`) + cwd real. Usa las funciones de producción sin escribir nada.
 *
 *   node eval/real-host-acceptance-01/resolve-probe.mjs <copia-registro> <workspace.json> <cwd> <sessionId>
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { listOpenProjects } from '../../lib/harness-workspaces.mjs';
import { listTrustedRoots } from '../../lib/trusted-roots.mjs';
import { resolveScope } from '../../lib/resolve.mjs';

const [registryCopy, workspaceFile, cwd, sessionId] = process.argv.slice(2);
// La copia se abre en escritura: la resolución puede registrar el proyecto descubierto o auditar
// una denegación. Sobre el registro real esto sería una escritura; aquí sólo toca la copia.
const db = new DatabaseSync(registryCopy);

const raw = JSON.parse(readFileSync(workspaceFile, 'utf8'));
const table = raw?.tables?.workspaces ?? {};
const workspaces = Object.entries(table).map(([id, w]) => ({ id, ...w }));

const trusted = listTrustedRoots(db);
const openProjects = await listOpenProjects({ list: () => workspaces });

let resolved;
try {
  resolved = resolveScope(db, {
    identity: { sessionId, profileKey: 'desktop' },
    expectedProfileKey: 'desktop',
    cwd,
    openProjects,
    now: Date.now(),
  });
} catch (error) {
  resolved = { error: { code: error?.code ?? null, message: error?.message ?? String(error), details: error?.details ?? null } };
}
db.close();

console.log(JSON.stringify({
  entrada: { cwd, sessionId, workspacesAbiertos: workspaces.length, openProjects: openProjects.length, trustedRoots: trusted.length },
  workspaces: workspaces.map((w) => ({ id: w.id, path: w.path, title: w.title, sesiones: (w.sessionIds ?? []).length, contieneSesion: (w.sessionIds ?? []).includes(sessionId) })),
  trusted: trusted.map((t) => ({ pathKey: t.pathKey, state: t.state, readAuthorization: t.readAuthorization })),
  resolucion: resolved.error
    ? { ok: false, ...resolved.error }
    : {
        ok: true,
        proyecto: resolved.project ? { id: resolved.project.id, name: resolved.project.name } : null,
        sesion: resolved.session ? { id: resolved.session.session_id, project: resolved.session.project_id, source: resolved.session.selection_source } : null,
        origen: resolved.origin ?? resolved.selectionSource ?? null,
        scopes: (resolved.scopes ?? []).map((s) => ({ id: s.id, kind: s.kind })),
        boundary: resolved.boundary ?? null,
        raw: resolved,
      },
}, null, 1));
