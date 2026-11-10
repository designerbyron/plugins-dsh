// R16.3 — lee la captura real del navegador, la sanea y resume sin volcar datos personales.
// Uso: node _audit/r16.3-recon/analyze-live.mjs <ruta-al-json>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const source = process.argv[2];
if (!source) {
  console.error('uso: node analyze-live.mjs <r163-live.json>');
  process.exit(2);
}
const raw = readFileSync(source, 'utf8');
// Cualquier ruta de perfil (unidad + `Users` + nombre de usuario), con separador `\` o `/`
// y en cualquier combinación de mayúsculas. No se codifica ningún nombre de usuario.
const USER_PATH = /C:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+[A-Za-z0-9._-]+/gi;
const sanitize = (text) => text.replace(USER_PATH, '<home>');
const data = JSON.parse(raw);
const body = (name) => data[name]?.body ?? null;
const clean = {
  capturedAt: new Date().toISOString(),
  statuses: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.status])),
  capabilities: body('capabilities'),
  projects: body('projects'),
  workspaces: body('workspaces'),
  inventory: body('inventory'),
};
writeFileSync(
  path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'live-api.json'),
  sanitize(JSON.stringify(clean, null, 1)),
  'utf8',
);

const lines = [];
const add = (line = '') => lines.push(line);
const inv = body('inventory') || {};
const projects = body('projects') || {};
const workspaces = body('workspaces') || {};
const entries = Array.isArray(inv.entries) ? inv.entries : [];
const collisions = Array.isArray(inv.collisions) ? inv.collisions : [];

add(`# Captura real del panel — ${clean.capturedAt}`);
add(`statuses: ${JSON.stringify(clean.statuses)}`);
add('');
add('## capabilities');
add(`contractVersion=${body('capabilities')?.contractVersion} implementation=${body('capabilities')?.implementation} plugin=${JSON.stringify(body('capabilities')?.plugin)}`);
add(`capabilities=${JSON.stringify(body('capabilities')?.capabilities)}`);
add('');
add('## inventory');
add(`ok=${inv.ok} complete=${inv.complete} truncated=${inv.truncated} entries=${entries.length} collisions=${collisions.length} generatedAt=${inv.generatedAt} contractVersion=${inv.contractVersion}`);
add(`summary=${JSON.stringify(inv.summary)}`);
const src = Array.isArray(inv.sources) ? inv.sources : [];
add(`sources (${src.length}):`);
for (const s of src) add(`  - ${s.id ?? s.source ?? '?'} status=${s.status} present=${s.present} found=${s.found} reason=${s.reason ?? ''}`);
const group = (keyFn) => {
  const map = new Map();
  for (const e of entries) {
    const k = keyFn(e);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};
add('');
add(`entries por owner.kind: ${JSON.stringify(group((e) => e.owner?.kind))}`);
add(`entries por confidence: ${JSON.stringify(group((e) => e.confidence))}`);
add(`entries por location.rootId: ${JSON.stringify(group((e) => e.location?.rootId ?? e.location?.kind))}`);
add(`entries por origin.kind: ${JSON.stringify(group((e) => e.origin?.kind))}`);
add(`entries por scope.kind: ${JSON.stringify(group((e) => e.scope?.kind))}`);
add('');
add('## colisiones por código/severidad');
const colKey = (c) => `${c.code}|${c.severity}`;
add(JSON.stringify(group2(collisions, colKey)));
function group2(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const k = keyFn(item);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}
add('');
add('## colisiones (detalle)');
for (const [i, c] of collisions.entries()) {
  const rowNames = (c.rows || []).map((r) => `${r.name ?? r.key}@${r.owner?.kind ?? r.owner ?? '?'}`).join(' , ');
  add(`${i + 1}. ${c.code} [${c.severity}] key=${c.key}`);
  add(`   rows(${(c.rows || []).length}): ${rowNames}`);
  add(`   why=${String(c.explanation || c.reason || '').slice(0, 220)}`);
}
add('');
add('## projects payload');
add(`ok=${projects.ok} readable=${projects.readable} complete=${projects.complete}`);
add(`summary=${JSON.stringify(projects.summary)}`);
add(`current=${JSON.stringify(projects.current)}`);
const discovered = Array.isArray(projects.discovered) ? projects.discovered : [];
add(`discovered (${discovered.length}):`);
for (const d of discovered) {
  add(`  - ${d.title ?? d.name} | ${d.path} | availability=${d.availability} | sessions=${d.sessionCount} | state=${d.state} | projectId=${d.projectId ?? '-'} | workspaceId=${d.workspaceId ?? '-'}`);
}
const managed = Array.isArray(projects.projects) ? projects.projects : [];
add(`managed (${managed.length}):`);
for (const p of managed) add(`  - ${p.name} | ${p.cwd} | state=${p.state} | inspection=${p.inspection?.status} | counts=${JSON.stringify(p.counts)} | reasons=${JSON.stringify(p.reasons ?? [])}`);
add('');
add('## workspaces payload');
add(`ok=${workspaces.ok} deprecated=${workspaces.deprecated}`);
const ws = Array.isArray(workspaces.workspaces) ? workspaces.workspaces : [];
add(`workspaces (${ws.length}):`);
for (const w of ws) add(`  - ${w.title} | ${w.path} | status=${w.status} | sessions=${w.sessionCount} | linkState=${w.linkState} | projectId=${w.projectId ?? '-'}`);
add(`summary=${JSON.stringify(workspaces.summary)}`);

const out = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'live-summary.txt');
writeFileSync(out, sanitize(lines.join('\n')), 'utf8');
console.log(`escrito ${out} (${lines.length} líneas)`);
