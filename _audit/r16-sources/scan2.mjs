#!/usr/bin/env node
// scan2.mjs � segunda pasada del censo R16 de fuentes de skills.
// S�LO LECTURA sobre las fuentes reales; escribe únicamente fixtures anonimizados
// en _audit/r16-sources/. No ejecuta código de manifiestos ni de skills.
//
// Añade al primer censo (20-skills.json) las fuentes que faltaban:
//   - hermes-skills  (%LOCALAPPDATA%/hermes/skills, origen declarado por .system/hermes-import.json)
//   - builtin-runtime-office (resources/runtime/office-skills, copia empaquetada legible)
//   - builtin-asar (12 SKILL.md dentro de app.asar; rutas desde _audit/asar-index.json, contenido NO leído)
// y recalcula colisiones con clasificación (ciclo de vida vs entre fuentes distintas).

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, lstatSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = 'C:/xampp/htdocs/plugins-dhs/_audit/r16-sources';
const ENV = process.env;
const USERPROFILE = ENV.USERPROFILE || ENV.HOME || '<USERPROFILE>';
const DSH_HOME = ENV.DSH_HOME || join(USERPROFILE, '.dsh');
const LOCALAPPDATA = ENV.LOCALAPPDATA || join(USERPROFILE, 'AppData/Local');
const RES = join(LOCALAPPDATA, 'Programs/DeepSeek Harness/resources');
const ASAR_INDEX = 'C:/xampp/htdocs/plugins-dhs/_audit/asar-index.json';

const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.cache', 'vendor']);
const MAX_DEPTH = 6;
const MAX_FILES = 5000;

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { hasFrontmatter: false, fields: [], data: null };
  const fields = [];
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_.-]+):[ \t]*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    if (!fields.includes(key)) fields.push(key);
    if (!(key in data)) data[key] = kv[2];
  }
  return { hasFrontmatter: true, fields, data };
}

function walk(root, { maxDepth = MAX_DEPTH, maxFiles = MAX_FILES } = {}) {
  const out = { files: 0, dirs: 0, symlinks: 0, capHit: false, skillFiles: [], allDirs: [] };
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(dir, e.name);
      let st; try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) { out.symlinks++; continue; } // no se atraviesan
      if (st.isDirectory()) {
        out.dirs++;
        if (IGNORED.has(e.name.toLowerCase())) continue;
        out.allDirs.push(p);
        if (depth + 1 <= maxDepth) stack.push([p, depth + 1]);
      } else {
        out.files++;
        if (out.files > maxFiles) { out.capHit = true; return out; }
        if (e.name.toLowerCase() === 'skill.md') out.skillFiles.push(p);
      }
    }
  }
  return out;
}

function record(source, absPath, root, extra = {}) {
  let size = null, hash = null, text = null;
  try { size = statSync(absPath).size; } catch {}
  const legible = extra.legible !== false;
  let fm = { hasFrontmatter: false, fields: [], data: null };
  if (legible) {
    try { text = readFileSync(absPath, 'utf8'); } catch { }
    if (text != null) { try { hash = sha256(absPath); } catch {} fm = parseFrontmatter(text); }
  }
  const rel = absPath.slice(root.length + 1).replace(/\\/g, '/');
  const relPosix = rel.replace(/\\/g, '/');
  const segs = relPosix.split('/');
  let dirName = basename(relPosix.slice(0, relPosix.length - '/SKILL.md'.length));
  if (dirName === 'upstream' && segs.length >= 2) dirName = segs[segs.length - 2];
  const d = fm.data || {};
  const markers = {};
  if (d.name) markers.name = d.name;
  if (d.metadata) {
    const md = d.metadata;
    // metadatos planos: sólo claves conocidas del harness (no se copia contenido)
    for (const k of ['origin', 'skillId', 'project', 'projectKey', 'version', 'toolVersion', 'migrated_from', 'upstreamUrl']) {
      if (typeof md === 'object' && md !== null) break;
    }
  }
  return {
    source,
    rel: extra.relOverride || rel,
    dirName,
    depth: rel.split('/').length,
    name: typeof d.name === 'string' ? d.name.replace(/^["']|["']$/g, '') : null,
    uuid: null,
    hash,
    size,
    hasFrontmatter: fm.hasFrontmatter,
    fields: fm.fields,
    markers: extra.markers || null,
    system: !!extra.system,
    legible,
    ...extra,
  };
}

const report = { generatedAt: new Date().toISOString(), generatedBy: 'scan2.mjs (sólo lectura)', notes: [] };
const records = [];
const sources = [];

// ���� Reutiliza el primer censo (5 fuentes ya recorridas) ������������������������������������������������
// Base congelada del primer censo (scan.mjs), para que este script sea idempotente.
const first = JSON.parse(readFileSync(join(HERE, '20-skills.base.json'), 'utf8'));
const firstSources = JSON.parse(readFileSync(join(HERE, '10-sources.json'), 'utf8')).sources.filter((s) => first.records.some((r) => r.source === s.id) || s.id === 'user-skills-system' || s.id === 'workspaces-local' || s.id === 'plugins-with-skills' || s.id === 'center-catalog' || s.id === 'repo-test-fixture');
for (const r of first.records) {
  // normaliza dirName de las copias .../<skill>/upstream/SKILL.md del primer censo
  let dirName = r.dirName;
  if (dirName === 'upstream') {
    const segs = r.rel.replace(/\\/g, '/').split('/');
    if (segs.length >= 3) dirName = segs[segs.length - 3];
  }
  records.push({ ...r, dirName, legible: true });
}
report.notes.push('records base reutilizados de 20-skills.base.json (primer censo congelado)');

// ���� Fuente: hermes-skills ����������������������������������������������������������������������������������������������������������
const hermRoot = join(LOCALAPPDATA, 'hermes/skills');
{
  const w = walk(hermRoot);
  const byCat = {};
  for (const f of w.skillFiles) {
    const rel = f.slice(hermRoot.length + 1).replace(/\\/g, '/');
    const cat = rel.includes('/') ? rel.split('/')[0] : '(raíz)';
    byCat[cat] = (byCat[cat] || 0) + 1;
    records.push(record('hermes-skills', f, hermRoot, { markers: { origin: 'hermes' } }));
  }
  sources.push({
    id: 'hermes-skills',
    path: '%LOCALAPPDATA%/hermes/skills',
    status: existsSync(hermRoot) ? 'DISPONIBLE' : 'NO EXISTE',
    exists: existsSync(hermRoot),
    legible: true,
    skills: w.skillFiles.length,
    files: w.files,
    dirs: w.dirs,
    symlinks: w.symlinks,
    capHit: w.capHit,
    byCategory: byCat,
    note: 'origen declarado por %USERPROFILE%/.dsh/skills/.system/hermes-import.json',
  });
}

// ���� Fuente: builtin-runtime-office ����������������������������������������������������������������������������������������
const officeRoot = join(RES, 'runtime/office-skills');
{
  const w = walk(officeRoot, { maxDepth: 3 });
  for (const f of w.skillFiles) records.push(record('builtin-runtime-office', f, officeRoot, { markers: { origin: 'harness-bundled' } }));
  sources.push({
    id: 'builtin-runtime-office',
    path: '%LOCALAPPDATA%/Programs/DeepSeek Harness/resources/runtime/office-skills',
    status: existsSync(officeRoot) ? 'DISPONIBLE' : 'NO EXISTE',
    exists: existsSync(officeRoot),
    legible: true,
    skills: w.skillFiles.length,
    files: w.files,
    dirs: w.dirs,
    symlinks: w.symlinks,
    capHit: w.capHit,
    note: 'skills office empaquetadas con el harness; copia legible en claro',
  });
}

// ���� Fuente: builtin-asar (sólo rutas/tamaños del índice; contenido NO leído) ����
{
  const idx = JSON.parse(readFileSync(ASAR_INDEX, 'utf8'));
  const byPkg = {};
  let n = 0;
  for (const e of idx) {
    if (!/\/SKILL\.md$/i.test(e.path)) continue;
    const m = e.path.match(/^\/dsh\/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.*)$/);
    const pkg = m ? m[1] : '(desconocido)';
    const rel = m ? m[2] : e.path;
    const dirName = rel.split('/').slice(-2, -1)[0] || '(desconocido)';
    byPkg[pkg] = (byPkg[pkg] || 0) + 1;
    n++;
    records.push({
      source: 'builtin-asar',
      rel: rel.replace(/^(skills|assets)\//, ''),
      dirName,
      depth: rel.split('/').length,
      name: null,
      uuid: null,
      hash: null,
      size: e.size,
      hasFrontmatter: null,
      fields: null,
      markers: { origin: 'harness-bundled', asarPackage: pkg },
      system: false,
      legible: false,
      asarPath: e.path,
    });
  }
  sources.push({
    id: 'builtin-asar',
    path: '%LOCALAPPDATA%/Programs/DeepSeek Harness/resources/app.asar!/dsh/node_modules/@deepseek-ai/*',
    status: existsSync(join(RES, 'app.asar')) ? 'DISPONIBLE (índice) / NO LEGIBLE (contenido)' : 'NO EXISTE',
    exists: existsSync(join(RES, 'app.asar')),
    legible: false,
    skills: n,
    byPackage: byPkg,
    note: 'contenedor binario: NO legible como texto; rutas y tamaños provienen de _audit/asar-index.json (índice de texto preexistente)',
  });
}

// ���� Candidatos .dsh no censados antes (¿otra fuente?) ������������������������������������������������
{
  const extra = {};
  for (const dir of ['dsh-runtimes', 'cache', 'fixtures', 'f4-evidence', 'f4-followup', 'snapshots', 'update-backups']) {
    const root = join(DSH_HOME, dir);
    if (!existsSync(root)) { extra[dir] = { exists: false }; continue; }
    const w = walk(root, { maxDepth: 4, maxFiles: 2000 });
    extra[dir] = { exists: true, skills: w.skillFiles.length, files: w.files, capHit: w.capHit };
    for (const f of w.skillFiles) records.push(record(`dsh-extra:${dir}`, f, root, { system: true }));
  }
  report.dshExtraRoots = extra;
}

// ���� Provenancia declarada vs contenido en disco ������������������������������������������������������������
const provenance = { generatedAt: report.generatedAt, hermesImport: {}, native: {}, rehash: [] };
{
  const sys = join(DSH_HOME, 'skills/.system');
  const herm = JSON.parse(readFileSync(join(sys, 'hermes-import.json'), 'utf8'));
  const nat = JSON.parse(readFileSync(join(sys, 'native.json'), 'utf8'));
  provenance.declaredBy = { ownership: JSON.parse(readFileSync(join(DSH_HOME, 'skill-compiler/ownership.json'), 'utf8')) };
  const diskDirs = new Set(records.filter((r) => r.source === 'user-skills').map((r) => r.dirName));
  const live = new Map(records.filter((r) => r.source === 'user-skills').map((r) => [r.dirName, r.hash]));
  let present = 0, match = 0; const absent = [], drifted = [], adapted = [];
  for (const [name, e] of Object.entries(herm.skills)) {
    if (!diskDirs.has(name)) { absent.push(name); continue; }
    present++;
    const h = live.get(name);
    if (h && e.sourceSkillSha256 && h === e.sourceSkillSha256) match++;
    else drifted.push({ name, declared: e.sourceSkillSha256 || null, actual: h || null });
    if (e.adaptations && Object.keys(e.adaptations).length) adapted.push(name);
  }
  provenance.hermesImport = {
    declared: Object.keys(herm.skills).length,
    presentOnDisk: present,
    hashMatch: match,
    drifted: drifted.length,
    withAdaptations: adapted.length,
    absent,
    notInManifest: [...diskDirs].filter((n) => n !== 'upstream' && !(n in herm.skills)),
  };
  const natAbsent = Object.keys(nat.skills).filter((n) => !diskDirs.has(n));
  provenance.native = { declared: Object.keys(nat.skills).length, absent: natAbsent, entries: Object.fromEntries(Object.entries(nat.skills).map(([k, v]) => [k, Object.keys(v)])) };
  // rehash de la vista materializada y del catálogo (¿los ficheros del centro siguen siendo los mismos?)
  const cat = JSON.parse(readFileSync(join(HERE, '50-catalog.json'), 'utf8')).catalog;
  for (const s of cat.skills || []) {
    provenance.rehash.push({
      id: s.id,
      versions: s.versions,
      versionNumbers: s.versionNumbers,
      hasManifestSha: s.hasManifestSha,
      originKind: s.origin && s.origin.kind,
      note: s.hasManifestSha ? 'el catálogo guarda hash de manifiesto' : 'el catálogo NO guarda hash del contenido de la skill',
    });
  }
  provenance.catalogSkillFields = Object.keys((cat.skills || [])[0] || {});
}
// eslint-disable-next-line no-unused-vars

// ���� Colisiones, clasificadas ��������������������������������������������������������������������������������������������������
const normBase = (n) => n.replace(/-\d{4}-\d{2}-\d{2}T[\d-]+Z$/, '');
const groupBy = (arr, fn) => {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
};

// conjunto principal: sin copias de seguridad ni réplicas .system (se informan aparte)
const main = records.filter((r) => !r.system && r.source !== 'dsh-extra:update-backups');
const withName = main.filter((r) => r.name);
const sameNameCrossSource = [];
for (const [name, rows] of groupBy(withName, (r) => r.name)) {
  const srcs = [...new Set(rows.map((r) => r.source))];
  if (srcs.length < 2) continue;
  const hashes = [...new Set(rows.map((r) => r.hash).filter(Boolean))];
  sameNameCrossSource.push({
    name,
    sources: srcs,
    occurrences: rows.length,
    distinctHashes: hashes.length,
    identicalContent: hashes.length === 1,
    hashes: hashes.slice(0, 4),
    paths: rows.slice(0, 6).map((r) => `${r.source}:${r.rel}`),
  });
}
sameNameCrossSource.sort((a, b) => b.sources.length - a.sources.length || a.name.localeCompare(b.name));

const sameSha256CrossSource = [];
for (const [hash, rows] of groupBy(main.filter((r) => r.hash), (r) => r.hash)) {
  const srcs = [...new Set(rows.map((r) => r.source))];
  if (srcs.length < 2) continue;
  sameSha256CrossSource.push({ sha256: hash, sources: srcs, occurrences: rows.length, names: [...new Set(rows.map((r) => r.name || r.dirName))].slice(0, 6), paths: rows.slice(0, 6).map((r) => `${r.source}:${r.rel}`) });
}

// duplicados de ciclo de vida dentro del compilador (mismo proyecto + mismo basename)
const lifecycle = [];
for (const [key, rows] of groupBy(main.filter((r) => r.source === 'compiler-projects'), (r) => {
  const proj = r.rel.split('/')[0];
  return `${proj}::${normBase(r.dirName)}`;
})) {
  if (rows.length < 2) continue;
  lifecycle.push({ key, occurrences: rows.length, states: [...new Set(rows.map((r) => r.rel.split('/')[1]))], distinctHashes: new Set(rows.map((r) => r.hash).filter(Boolean)).size, sample: rows.slice(0, 4).map((r) => `${r.rel}`) });
}
lifecycle.sort((a, b) => b.occurrences - a.occurrences);

// mismo dirName entre fuentes distintas
const sameDirCrossSource = [];
for (const [dn, rows] of groupBy(main.filter((r) => r.dirName), (r) => r.dirName)) {
  const srcs = [...new Set(rows.map((r) => r.source))];
  if (srcs.length < 2) continue;
  sameDirCrossSource.push({ dirName: dn, sources: srcs, occurrences: rows.length, paths: rows.slice(0, 5).map((r) => `${r.source}:${r.rel}`) });
}

const noFrontmatter = main.filter((r) => r.legible && r.hasFrontmatter === false).map((r) => `${r.source}:${r.rel}`);
const noName = main.filter((r) => r.legible && r.hasFrontmatter === true && !r.name).map((r) => `${r.source}:${r.rel}`);
const uuidHits = main.filter((r) => r.uuid);
const backupShadows = records.filter((r) => r.system).map((r) => ({ source: r.source, rel: r.rel, name: r.name, size: r.size }));

const fieldFreq = {};
for (const r of records) {
  if (!r.legible || !Array.isArray(r.fields)) continue;
  fieldFreq[r.source] = fieldFreq[r.source] || {};
  for (const f of r.fields) fieldFreq[r.source][f] = (fieldFreq[r.source][f] || 0) + 1;
}

const collisions = {
  generatedAt: report.generatedAt,
  fieldFreq,
  backupShadows,
  totals: {
    records: records.length,
    sources: sources.length + firstSources.filter((s) => !sources.some((x) => x.id === s.id)).length,
    sameNameCrossSource: sameNameCrossSource.length,
    sameSha256CrossSource: sameSha256CrossSource.length,
    lifecycleGroups: lifecycle.length,
    sameDirCrossSource: sameDirCrossSource.length,
    noFrontmatter: noFrontmatter.length,
    noName: noName.length,
    uuid: uuidHits.length,
  },
  classification: {
    crossSource: 'misma skill (name, dir o sha256) declarada en DOS fuentes distintas: requiere regla de propiedad y prioridad',
    lifecycle: 'mismo proyecto + mismo basename en varios estados del compilador (approved/published/superseded): NO es colisión, es historial de versiones',
    materialized: 'la vista materializada copia por proyecto: misma skill en N proyectos es esperado',
    bundled: 'office aparece empaquetada dos veces (runtime legible + asar opaco)' ,
  },
  sameNameCrossSource,
  sameSha256CrossSource,
  lifecycle,
  sameDirCrossSource,
  noFrontmatter,
  noName,
  uuid: uuidHits,
};

// ���� Fixtures ����������������������������������������������������������������������������������������������������������������������������������
const sourcesOut = {
  generatedAt: report.generatedAt,
  generatedBy: report.generatedBy,
  dshHome: '%USERPROFILE%/.dsh',
  repo: '%REPO%',
  sources: [...firstSources, ...sources.filter((s) => !firstSources.some((f) => f.id === s.id))].map((s) => ({
    ...s,
    exists: s.exists !== undefined ? s.exists : !String(s.status || '').startsWith('NO EXISTE'),
    legible: s.legible === false ? false : true,
  })),
  extraChecks: report.dshExtraRoots || {},
  notes: report.notes,
};
writeFileSync(join(HERE, '10-sources.json'), JSON.stringify(sourcesOut, null, 2));
writeFileSync(join(HERE, '20-skills.json'), JSON.stringify({ meta: { ...first.meta, records: records.length, generatedBy: 'scan.mjs + scan2.mjs (sólo lectura)' }, records }, null, 2));
// 30-collisions.json lo escribe analyze.mjs: aquí no se emite para no dejar un fixture a medias.
provenance.coverage = (() => {
  const cat = JSON.parse(readFileSync(join(HERE, '50-catalog.json'), 'utf8')).catalog;
  const ids = (cat.skills || []).map((s) => s.id);
  const matDirs = [...new Set(records.filter((r) => r.source === 'center-materialized').map((r) => r.rel.split('/')[1]))];
  return {
    catalogSkills: ids.length,
    catalogProjectDirs: (cat.projects || []).map((p) => ({ id: p.id, cwd: p.cwd, cwdExists: p.cwdExists })),
    materializedSkillDirs: matDirs,
    catalogWithoutMaterialized: ids.filter((id) => !matDirs.includes(id)),
    materializedWithoutCatalog: matDirs.filter((d) => !ids.includes(d)),
  };
})();
provenance.catalogChecksum = (() => {
  try {
    const raw = JSON.parse(readFileSync(join(DSH_HOME, 'lifecode-skill-center/center.json'), 'utf8'));
    const arr = Array.isArray(raw.skills) ? raw.skills : Object.entries(raw.skills || {}).map(([id, v]) => ({ id, ...v }));
    let total = 0, eqBody = 0;
    for (const s of arr) for (const v of s.versions || []) {
      total++;
      const b = v.body == null ? '' : String(v.body);
      if (createHash('sha256').update(b, 'utf8').digest('hex').slice(0, 12) === v.checksum) eqBody++;
    }
    return { versions: total, checksumEsSha256DelBodyTruncadoA12: eqBody, checksumLongitudes: [...new Set(arr.flatMap((s) => (s.versions || []).map((v) => String(v.checksum).length)))] };
  } catch (e) { return { error: e.code }; }
})();
writeFileSync(join(HERE, '60-provenance.json'), JSON.stringify(provenance, null, 2));

// ���� Resumen por stdout ��������������������������������������������������������������������������������������������������������������
const line = (s) => console.log(s);
line('\n== FUENTES ==');
for (const s of sourcesOut.sources) {
  line(`${s.id}\t${s.exists ? 'EXISTE' : 'NO EXISTE'}\t${s.legible === false ? 'NO LEGIBLE' : 'LEGIBLE'}\tskills=${s.skills ?? '?'}\tfiles=${s.files ?? '?'}\tdirs=${s.dirs ?? '?'}`);
}
line('\n== TOTALS ==');
line(JSON.stringify(collisions.totals));
line('\n== sameNameCrossSource ==');
for (const g of sameNameCrossSource) line(`${g.name}\t[${g.sources.join(' + ')}]\tn=${g.occurrences}\thashes=${g.distinctHashes}\tidentico=${g.identicalContent}`);
line('\n== sameSha256CrossSource ==');
for (const g of sameSha256CrossSource) line(`${g.sha256.slice(0, 12)}⬦\t[${g.sources.join(' + ')}]\t${g.names.join(',')}`);
line('\n== lifecycle (top 12) ==');
for (const g of lifecycle.slice(0, 12)) line(`${g.key}\tn=${g.occurrences}\testados=${g.states.join('/')}\thashes=${g.distinctHashes}`);
line('\n== sameDirCrossSource ==');
for (const g of sameDirCrossSource) line(`${g.dirName}\t[${g.sources.join(' + ')}]\tn=${g.occurrences}`);
line('\n== provenance ==');
line(JSON.stringify(provenance.hermesImport));
line(JSON.stringify(provenance.native));
line('\n== extra roots ==');
line(JSON.stringify(report.dshExtraRoots, null, 1));
line('\n== hermes by category ==');
line(JSON.stringify(sources.find((s) => s.id === 'hermes-skills').byCategory, null, 1));
