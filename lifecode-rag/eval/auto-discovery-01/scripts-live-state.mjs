/** Sonda de sólo lectura del estado real: registro, almacén y proyectos abiertos. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const REG = 'C:/Users/<USER>/.dsh/lifecode-rag/profiles/desktop/registry.sqlite3';
const STORE = 'C:/Users/<USER>/.dsh/lifecode-rag/profiles/desktop/scopes/prj_01M7RBSRD33M26HGBEFW51WPP6/rag.sqlite3';
const WS = 'C:/Users/<USER>/.dsh/storages/workspace.json';
const SESSION = 'session-de66bc5f-7f05-4b07-bad4-db75df6bc894';
const out = [];
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

out.push(`registry_sha256=${sha(REG)}`);
out.push(`store_sha256=${sha(STORE)}`);
out.push(`workspace_json_sha256=${sha(WS)}`);

const db = new DatabaseSync(REG, { readOnly: true });
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
out.push(`projects=${count('projects')} roots=${count('roots')} libraries=${count('libraries')} grants=${count('grants')}`);
for (const row of db.prepare('SELECT session_id, project_id, state, selection_source FROM session_scope').all()) {
  out.push(`session ${row.session_id} project=${row.project_id} state=${row.state} source=${row.selection_source}`);
}
out.push(`trust_meta=${db.prepare("SELECT value FROM meta WHERE key='trusted_roots'").get()?.value ?? 'NULL'}`);
db.close();

const store = new DatabaseSync(STORE, { readOnly: true });
for (const table of ['sources', 'chunks', 'vectors', 'audit']) {
  out.push(`${table}=${store.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n}`);
}
store.close();

const workspaces = JSON.parse(readFileSync(WS, 'utf8'));
for (const id of workspaces.global.workspaceIds) {
  const entry = workspaces.tables.workspaces[id];
  const current = entry.sessionIds.includes(SESSION) ? '*' : ' ';
  out.push(`workspace ${current} ${entry.path} sessions=${entry.sessionIds.length}`);
}
writeFileSync('eval/auto-discovery-01/17-harness-live-state.txt', `${out.join('\n')}\n`);
console.log(out.join('\n'));
