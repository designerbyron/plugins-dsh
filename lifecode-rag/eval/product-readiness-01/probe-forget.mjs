/** Sonda: ¿qué queda tras forget? Solo hechos, sin contenido sensible (fixtures propios). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeWorld, fakeExec, servicesFor } from '../../tests/pa3-helpers.mjs';
import { createToolDefinitions } from '../../lib/tools.mjs';
import { openScopeStore } from '../../lib/scope-stores.mjs';

const world = await makeWorld();
const services = servicesFor(world, { sessionId: 'sesion-a' });
const defs = createToolDefinitions({ config: world.config, root: world.root, services });
const map = new Map(defs.map((d) => [d.name.replace('lifecode_rag_', ''), d]));
const call = (name, args) => map.get(name).execute(args, fakeExec('sesion-a'));

const path = join(world.dirA, 'borrame.md');
writeFileSync(path, '# Borrame\n\npalabraunica trazabilidad extrema\n', 'utf8');
const ing = await call('ingest', { paths: [path] });
const id = ing.ingested[0].id;

const store = openScopeStore({ profileRoot: world.root, profileKey: 'pa3-test', scope: { kind: 'prj', id: world.projectA.id }, create: false });
const tables = store.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
const hasVec = tables.includes('vectors');
const count = (table, where, ...params) => store.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...params).n;

const before = {
  sources: count('sources', 'WHERE id = ?', id),
  chunks: count('chunks', 'WHERE source_id = ?', id),
  fts: count('chunks_fts', "WHERE chunks_fts MATCH 'palabraunica'"),
};

const s1 = await call('search', { query: 'palabraunica', limit: 5 });
const del = await call('forget', { ref: id });

const after = {
  sources: count('sources', 'WHERE id = ?', id),
  chunks: count('chunks', 'WHERE source_id = ?', id),
  fts: count('chunks_fts', "WHERE chunks_fts MATCH 'palabraunica'"),
};

const s2 = await call('search', { query: 'palabraunica', limit: 5 });
store.close();
world.cleanup();

console.log(JSON.stringify({ tablas: tables,
  antes: before,
  busquedaAntes: s1.results.map((r) => r.uri),
  forget: { deleted: del.forgotten ?? del.deleted ?? null, sourceId: del.sourceId ?? null },
  despues: after,
  busquedaDespues: s2.results.map((r) => ({ uri: r.uri, sourceId: r.sourceId })),
}, null, 1));
