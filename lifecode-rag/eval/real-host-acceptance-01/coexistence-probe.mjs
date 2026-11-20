/**
 * Coexistencia de proyectos: seis casos de resolución sobre una COPIA del registro real.
 * La copia se abre en escritura porque resolver puede descubrir/registrar y auditar; el original no se toca.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { listOpenProjects } from '../../lib/harness-workspaces.mjs';
import { listTrustedRoots } from '../../lib/trusted-roots.mjs';
import { resolveScope } from '../../lib/resolve.mjs';
import { scopeStoreExists, scopeStoreDir } from '../../lib/scope-stores.mjs';

const [registryCopy, workspaceFile] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(workspaceFile, 'utf8'));
const workspaces = Object.entries(raw?.tables?.workspaces ?? {}).map(([id, w]) => ({ id, ...w }));
const openProjects = await listOpenProjects({ list: () => workspaces });

const db = new DatabaseSync(registryCopy);
const trusted = listTrustedRoots(db);
const root = 'C:/Users/<USER>/.dsh/lifecode-rag/profiles/desktop';

function run(label, { cwd, sessionId }) {
  try {
    const r = resolveScope(db, {
      identity: { sessionId, profileKey: 'desktop' },
      expectedProfileKey: 'desktop', cwd, openProjects, now: Date.now(),
    });
    return {
      caso: label, cwd, session: sessionId, ok: true,
      origen: r.source, proyecto: r.projectName, projectId: r.projectId,
      almacen: r.scopes.map((s) => ({ id: s.id, existe: scopeStoreExists(root, s.id), dir: scopeStoreDir(root, s.id).split(/[\\/]/).slice(-2).join('/') })),
    };
  } catch (error) {
    return { caso: label, cwd, session: sessionId, ok: false, code: error?.code ?? null, mensaje: error?.message ?? String(error), detalles: error?.details ?? null };
  }
}

const S_SEL = 'session-c90d50d6-aa3d-4330-a9c8-76b21dc0f188'; // selección explícita a LifeCode RAG
const out = [];
out.push(run('A · plugins-dhs, sesión nueva sin selección', { cwd: 'C:/xampp/htdocs/plugins-dhs', sessionId: 'session-nueva-plugins-dhs' }));
out.push(run('B · lifecode-rag (raíz del proyecto), sesión nueva', { cwd: 'C:/xampp/htdocs/plugins-dhs/lifecode-rag', sessionId: 'session-nueva-lifecode-rag' }));
out.push(run('C · hermano saas-corporative, sesión nueva', { cwd: 'C:/xampp/htdocs/saas-corporative', sessionId: 'session-nueva-hermano' }));
out.push(run('D · plugins-dhs, sesión con selección a LifeCode RAG', { cwd: 'C:/xampp/htdocs/plugins-dhs', sessionId: S_SEL }));
out.push(run('E · raíz del proyecto, MISMA sesión con selección', { cwd: 'C:/xampp/htdocs/plugins-dhs/lifecode-rag', sessionId: S_SEL }));
out.push(run('F · plugins-dhs, segunda sesión nueva (¿hereda?)', { cwd: 'C:/xampp/htdocs/plugins-dhs', sessionId: 'session-nueva-plugins-dhs-2' }));

const sesiones = db.prepare('SELECT session_id, project_id, selection_source FROM session_scope ORDER BY session_id').all();
const proyectos = db.prepare('SELECT id, name FROM projects ORDER BY created_at').all();
const raices = db.prepare('SELECT scope_id, path FROM roots ORDER BY added_at').all();
db.close();

console.log(JSON.stringify({
  trusted: trusted.map((t) => ({ pathKey: t.pathKey, readAuthorization: t.readAuthorization })),
  proyectos, raices, sesiones,
  casos: out,
}, null, 1));
