import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRegistry } from '../../lib/registry.mjs';
import { addTrustedRoot } from '../../lib/trusted-roots.mjs';
import { scanWorkspace } from '../../lib/discovery.mjs';
import { resolveScope } from '../../lib/resolve.mjs';
import { createToolDefinitions } from '../../lib/tools.mjs';
import { closeDatabase } from '../../lib/db.mjs';
import { loadConfig } from '../../lib/paths.mjs';

const source = 'C:/Users/<USER>/.dsh/lifecode-rag/profiles/desktop';
const base = mkdtempSync(join(tmpdir(), 'lcr-realshape-'));
const profileRoot = join(base, 'perfil');
cpSync(source, profileRoot, { recursive: true });
const env = { LIFECODE_RAG_ROOT: profileRoot, DSH_PROFILE: 'desktop' };
const identity = { sessionId: 'sesion-real-shape', profileKey: 'desktop' };
const cwd = 'C:/xampp/htdocs/plugins-dhs';
const log = [];

const registry = openRegistry({ root: profileRoot, create: false });
addTrustedRoot(registry.db, { path: cwd, readAuthorization: true, addedBy: 'human' });
log.push({ step: 'trust', roots: registry.db.prepare('SELECT path,state FROM roots').all() });
const scan = scanWorkspace(cwd);
log.push({ step: 'scan', projects: scan.projects.map((p) => ({ name: p.name, type: p.type, depth: p.depth })) });
const resolved = resolveScope(registry.db, { identity, expectedProfileKey: 'desktop', cwd, now: Date.now() });
log.push({ step: 'resolve', projectId: resolved.projectId, projectName: resolved.projectName, source: resolved.source, scopes: resolved.scopes.map((s) => ({ kind: s.kind, name: s.name, roots: s.roots })) });
const services = {
  env,
  now: () => Date.now(),
  approval: { request: async () => 'allowed-once' },
  workingDirectory: { ensure: () => cwd },
};
const tools = createToolDefinitions({ config: loadConfig(profileRoot).config, root: profileRoot, services });
const exec = { agent: { id: 'sesion-real-shape' }, callId: 'evidencia-1', signal: new AbortController().signal };
const search = tools.find((tool) => tool.name === 'lifecode_rag_search');
const list = tools.find((tool) => tool.name === 'lifecode_rag_list');
const searchResult = await search.execute({ query: 'project-aware', limit: 3 }, exec);
const listResult = await list.execute({ limit: 3 }, exec);
log.push({ step: 'search', mode: searchResult.mode, results: searchResult.results.length, elapsedMs: searchResult.elapsedMs });
log.push({ step: 'list', total: listResult.total, rows: listResult.rows.length });
log.push({ step: 'store-of-discovered-project', exists: (await import('node:fs')).existsSync(join(profileRoot, 'scopes', resolved.projectId, 'rag.sqlite3')) });
closeDatabase(registry.db);
console.log(JSON.stringify({ sourceProfile: source, tempProfile: profileRoot, log }, null, 1));
rmSync(base, { recursive: true, force: true });
