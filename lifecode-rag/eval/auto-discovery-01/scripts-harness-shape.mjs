/**
 * Prueba de forma real (sólo lectura sobre el perfil real).
 *
 * Copia el registro real con `VACUUM INTO` a un perfil temporal, simula los proyectos abiertos
 * que el host publica en `$DSH_HOME/storages/workspace.json` y comprueba:
 *   1. sin `trusted root` de proyecto, un proyecto abierto se rechaza (project-not-authorized);
 *   2. tras autorizar SOLO `plugins-dhs` en la copia, la sesión actual resuelve exactamente ese
 *      proyecto aunque su `cwd` sea la carpeta contenedora `htdocs`;
 *   3. ningún proyecto hermano (`businesssuite`, …) queda registrado.
 *
 * Nunca escribe en el perfil real: la única escritura es en el directorio temporal.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { closeRegistry, listRoots, openRegistry } from '../../lib/registry.mjs';
import { addTrustedRoot, listTrustedRoots } from '../../lib/trusted-roots.mjs';
import { listOpenProjects } from '../../lib/harness-workspaces.mjs';
import { resolveScope } from '../../lib/resolve.mjs';

const REAL_ROOT = 'C:\\Users\\<USER>\\.dsh\\lifecode-rag';
const REAL_REGISTRY = join(REAL_ROOT, 'profiles', 'desktop', 'registry.sqlite3');
const WORKSPACE_STORE = 'C:\\Users\\<USER>\\.dsh\\storages\\workspace.json';
const SESSION = 'session-de66bc5f-7f05-4b07-bad4-db75df6bc894';
const HTDOCS = 'C:\\xampp\\htdocs';
const PROJECT = 'C:\\xampp\\htdocs\\plugins-dhs';

function say(label, value) {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

const temp = mkdtempSync(join(tmpdir(), 'lcr-harness-shape-'));
const profileRoot = join(temp, 'perfil');
mkdirSync(profileRoot, { recursive: true });
const source = new DatabaseSync(REAL_REGISTRY, { readOnly: true });
source.exec(`VACUUM INTO '${join(profileRoot, 'registry.sqlite3').replaceAll("'", "''")}'`);
source.close();

// `workspace.json` es la proyección durable del registro de workspaces del host.
const raw = JSON.parse(readFileSync(WORKSPACE_STORE, 'utf8'));
const workspaces = raw.global.workspaceIds.map((id) => {
  const entry = raw.tables.workspaces[id];
  return { id, path: entry.path, title: entry.title, sessionIds: entry.sessionIds, status: () => Promise.resolve('ok') };
});
const openProjects = await listOpenProjects({ list: () => workspaces });
say('proyectos_abiertos', openProjects.map((entry) => entry.path));
say('workspace_de_la_sesion', openProjects.find((entry) => entry.sessionIds.includes(SESSION))?.path ?? null);

let exitCode = 0;
const opened = openRegistry({ root: profileRoot, create: false });
try {
  const db = opened.db;
  const before = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  say('proyectos_registro_real', before);
  say('raices_registro_real', db.prepare('SELECT COUNT(*) AS n FROM roots').get().n);
  say('trust_previo', listTrustedRoots(db).length);

  const identity = { sessionId: SESSION, profileKey: 'default' };
  const expectedProfileKey = 'default';

  try {
    resolveScope(db, { identity, expectedProfileKey, cwd: HTDOCS, openProjects, now: Date.now() });
    say('sin_trust', 'RESOLVIO (inesperado)');
    exitCode = 1;
  } catch (error) {
    say('sin_trust_codigo', error.code);
    say('sin_trust_motivo', error.details?.reason ?? null);
    say('sin_trust_comando', error.details?.command ?? null);
    if (error.details?.reason !== 'project-not-authorized') exitCode = 1;
  }

  addTrustedRoot(db, { path: PROJECT, readAuthorization: true, now: Date.now() });
  const resolved = resolveScope(db, { identity, expectedProfileKey, cwd: HTDOCS, openProjects, now: Date.now() });
  say('con_trust_proyecto', resolved.projectName);
  say('con_trust_source', resolved.source);
  say('con_trust_raices', resolved.scopes[0].roots);
  say('con_trust_ambitos', resolved.scopes.map((scope) => scope.kind));

  const registered = db.prepare('SELECT p.name AS name, r.path AS path FROM roots r JOIN projects p ON p.id = r.scope_id').all();
  say('raices_registradas', registered);
  if (registered.some((row) => row.path.toLowerCase().includes('businesssuite'))) {
    say('hermanos_registrados', 'FALLO');
    exitCode = 1;
  } else {
    say('hermanos_registrados', 'ninguno');
  }
  if (resolved.projectName !== 'plugins-dhs') exitCode = 1;
  const after = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  say('proyectos_tras_resolver', after);
  if (after !== before + 1) exitCode = 1;
  // El almacén real no se abre: la prueba sólo ejercita el registro copiado.
  if (existsSync(join(REAL_ROOT, 'profiles', 'desktop', 'scopes'))) say('almacen_real', 'intacto (no abierto)');
} finally {
  closeRegistry(opened.db);
  rmSync(temp, { recursive: true, force: true });
}
say('EXIT', String(exitCode));
process.exit(exitCode);
