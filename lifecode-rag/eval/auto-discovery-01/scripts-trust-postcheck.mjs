/** Comprobación posterior a `trust add` (sólo lectura). */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const REG = 'C:/Users/<USER>/.dsh/lifecode-rag/profiles/desktop/registry.sqlite3';
const STORE = 'C:/Users/<USER>/.dsh/lifecode-rag/profiles/desktop/scopes/prj_01M7RBSRD33M26HGBEFW51WPP6/rag.sqlite3';
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const db = new DatabaseSync(REG, { readOnly: true });
const one = (sql) => db.prepare(sql).get();
const all = (sql) => db.prepare(sql).all();
console.log(`registry_sha256=${sha(REG)}`);
console.log(`projects=${one('SELECT COUNT(*) AS n FROM projects').n} roots=${one('SELECT COUNT(*) AS n FROM roots').n} libraries=${one('SELECT COUNT(*) AS n FROM libraries').n} grants=${one('SELECT COUNT(*) AS n FROM grants').n}`);
console.log(`roots_rows=${JSON.stringify(all("SELECT p.name AS project, r.path, r.state FROM roots r JOIN projects p ON p.id=r.scope_id"))}`);
console.log(`trust=${one("SELECT value FROM meta WHERE key='trusted_roots'").value}`);
console.log(`audit_total=${one('SELECT COUNT(*) AS n FROM audit_registry').n}`);
console.log(`audit_last=${JSON.stringify(all('SELECT seq, action, target, outcome, actor FROM audit_registry ORDER BY seq DESC LIMIT 3'))}`);
console.log(`sessions=${JSON.stringify(all('SELECT session_id, project_id, state, selection_source FROM session_scope'))}`);
db.close();

const store = new DatabaseSync(STORE, { readOnly: true });
console.log(`store_sha256=${sha(STORE)}`);
for (const table of ['sources', 'chunks', 'vectors', 'audit']) {
  console.log(`${table}=${store.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n}`);
}
store.close();
