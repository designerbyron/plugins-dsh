#!/usr/bin/env node
// analyze.mjs -- Clasifica los records del censo R16 y mide colisiones reales.
// Sólo lee. Entrada: 20-skills.json + 10-sources.json (los produce scan.mjs/scan2.mjs).
// Salida: 30-collisions.json (fixture) y un resumen por stdout.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RECS = JSON.parse(readFileSync(join(HERE, '20-skills.json'), 'utf8'));
const SOURCES = JSON.parse(readFileSync(join(HERE, '10-sources.json'), 'utf8'));

const norm = (p) => String(p || '').replace(/\\/g, '/');
const short = (h) => (h ? h.slice(0, 12) : null);
const UPSTREAM = /\/upstream\/SKILL\.md$/i;
const ARCHIVED_HERMES = /^\.archive\//i;

// Clasificación de cada fichero censado en un nivel de confianza.
function tierOf(r) {
  const rel = norm(r.rel);
  if (r.source === 'builtin-asar') return 'opaque';          // dentro del asar: contenido no legible
  if (UPSTREAM.test(rel)) return 'snapshot';                 // copia upstream embebida en otra skill
  if (r.source === 'hermes-skills' && ARCHIVED_HERMES.test(rel)) return 'shadow'; // archivo de Hermes
  if (r.source.startsWith('dsh-extra:')) return 'shadow';    // backups/restauración
  if (r.source === 'center-materialized') return 'derived';  // vista materializada (render, no copia)
  return 'managed';                                          // fuente viva o candidata a viva
}

const records = RECS.records.map((r) => ({ ...r, tier: tierOf(r) }));
for (const r of records) {
  r.liveGroup = r.source === 'hermes-skills' && ARCHIVED_HERMES.test(norm(r.rel)) ? 'archive' : 'live';
}

const byTier = {};
for (const r of records) byTier[r.tier] = (byTier[r.tier] || 0) + 1;

// Colisiones por nombre entre FUENTES distintas (una fuente = r.source).
function groupBy(keyFn) {
  const m = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function describe(name, rows) {
  const sources = [...new Set(rows.map((r) => r.source))].sort();
  const hashes = [...new Set(rows.map((r) => r.hash))];
  return {
    name,
    sources,
    occurrences: rows.length,
    hashes: hashes.length,
    identical: hashes.length === 1,
    tiers: [...new Set(rows.map((r) => r.tier))].sort(),
    rows: rows.map((r) => ({
      source: r.source, tier: r.tier, rel: norm(r.rel), hash12: short(r.hash), size: r.size,
    })),
  };
}

function crossSource(rows) {
  return new Set(rows.map((r) => r.source)).size >= 2;
}

const byName = groupBy((r) => r.name);
const byHash = groupBy((r) => r.hash);
const byUuid = groupBy((r) => r.uuid);

const nameGroups = [...byName.entries()]
  .filter(([, rows]) => rows.length >= 2 && crossSource(rows))
  .map(([name, rows]) => describe(name, rows))
  .sort((a, b) => a.name.localeCompare(b.name));

const hashGroups = [...byHash.entries()]
  .filter(([, rows]) => rows.length >= 2 && crossSource(rows))
  .map(([, rows]) => describe(rows[0].name || rows[0].dirName, rows))
  .sort((a, b) => a.name.localeCompare(b.name));

const uuidGroups = [...byUuid.entries()].filter(([, rows]) => rows.length >= 2);

// Colisiones por nombre DENTRO de la misma fuente y estado (p.ej. la misma skill
// aprobada en dos proyectos distintos, o el mismo name en approved y published).
const bySourceName = groupBy((r) => `${r.source}\u0000${r.name}`);
const intraSource = [...bySourceName.entries()]
  .filter(([, rows]) => rows.length >= 2)
  .map(([, rows]) => describe(rows[0].name, rows));

// Cruces managed <-> snapshot/shadow: mismo contenido exacto fuera del conjunto gestionado.
const shadowCross = hashGroups.filter((g) => g.tiers.includes('managed') && g.tiers.some((t) => t === 'snapshot' || t === 'shadow'));

// Mismo name, contenido divergente (lo que un inventario global debe resolver por versión, no por nombre).
const onlyManaged = (g) => g.tiers.length === 1 && g.tiers[0] === 'managed';
const divergent = nameGroups.filter((g) => !g.identical && onlyManaged(g));
const identical = nameGroups.filter((g) => g.identical && onlyManaged(g));
const shadowInvolved = nameGroups.filter((g) => g.tiers.some((t) => t === 'shadow' || t === 'snapshot'))

// Anomalías de frontmatter.
const anomalies = {
  noFrontmatter: records.filter((r) => r.hasFrontmatter === false).length,
  noName: records.filter((r) => !r.name && r.legible).length,
  nameVsDirMismatch: records.filter((r) => r.name && r.dirName && r.name !== r.dirName).length,
  uuidPresent: records.filter((r) => r.uuid).length,
};

// Un fichero censado por skill gestionada: dirs de skill = dirName normalizado.
const managed = records.filter((r) => r.tier === 'managed');
const managedBySource = {};
for (const r of managed) {
  const s = (managedBySource[r.source] = managedBySource[r.source] || { files: 0, dirs: new Set(), depth: {} });
  s.files += 1;
  s.dirs.add(`${r.source}/${r.dirName}`);
  s.depth[r.depth] = (s.depth[r.depth] || 0) + 1;
}
const sourceSummary = Object.fromEntries(
  Object.entries(managedBySource).map(([k, v]) => [k, { files: v.files, skillDirs: v.dirs.size, depth: v.depth }]),
);

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    generatedBy: 'analyze.mjs (sólo lectura; entrada 20-skills.json + 10-sources.json)',
    note: 'tier managed = fuentes vivas/candidatas; snapshot = copia upstream dentro de otra skill; shadow = archivo o backup; derived = vista materializada; opaque = dentro de app.asar',
    excludedFromCollisions: ['opaque'],
  },
  totals: {
    records: records.length,
    sources: new Set(records.map((r) => r.source)).size,
    byTier,
    managed: managed.length,
    managedSkillDirs: new Set(managed.map((r) => `${r.source}/${r.dirName}`)).size,
    bySource: sourceSummary,
  },
  classification: Array.from(new Set(records.map((r) => ({ source: r.source, tier: r.tier, liveGroup: r.liveGroup }).source + '|' + r.tier + '|' + r.liveGroup))).sort()
    .map((k) => { const [source, tier, liveGroup] = k.split('|'); return { source, tier, liveGroup }; }),
  collisions: {
    nameCrossSource: nameGroups.length,
    nameCrossSourceIdentical: identical.length,
    nameCrossSourceDivergent: divergent.length,
    hashCrossSource: hashGroups.length,
    hashCrossSourceManagedOnly: hashGroups.filter((g) => g.tiers.includes('managed') && !g.tiers.includes('derived')).length,
    uuidGroups: uuidGroups.length,
    intraSourceGroups: intraSource.length,
    shadowCrossGroups: shadowCross.length,
    shadowInvolvedNameGroups: shadowInvolved.length,
  },
  anomalies,
  details: {
    identical: identical.map((g) => ({ name: g.name, sources: g.sources, hash12: g.rows[0].hash12, occurrences: g.occurrences })),
    divergent: divergent.map((g) => ({ name: g.name, sources: g.sources, hashes: g.hashes, occurrences: g.occurrences, rows: g.rows })),
    intraSource: intraSource.map((g) => ({ name: g.name, source: g.sources[0], hashes: g.hashes, rows: g.rows })),
    hashCrossSourceAll: hashGroups.map((g) => ({ hash12: g.rows[0].hash12, names: [...new Set(g.rows.map((r) => r.name || r.dirName))], tiers: g.tiers, rows: g.rows })),
    shadowInvolved: shadowInvolved.map((g) => ({ name: g.name, tiers: g.tiers, hashes: g.hashes, identical: g.identical, rows: g.rows })),
    shadowCross: shadowCross.map((g) => ({ name: g.name, tiers: g.tiers, rows: g.rows })),
  },
};

writeFileSync(join(HERE, '30-collisions.json'), JSON.stringify(out, null, 2), 'utf8');

console.log('== TOTALS ==');
console.log(JSON.stringify(out.totals));
console.log('== COLLISION COUNTS ==');
console.log(JSON.stringify(out.collisions));
console.log('== ANOMALIES ==');
console.log(JSON.stringify(out.anomalies));
console.log('== CLASSIFICATION ==');
for (const c of out.classification) console.log(`${c.source}\t${c.tier}\t${c.liveGroup}`);
console.log('== IDENTICAL (cross-source) ==');
for (const g of out.details.identical) console.log(`${g.name}\t${g.hash12}\t${g.sources.join(' + ')}`);
console.log('== DIVERGENT (cross-source) ==');
for (const g of out.details.divergent) console.log(`${g.name}\t${g.sources.join(' + ')}\thashes=${g.hashes}\tn=${g.occurrences}`);
console.log('== INTRA-SOURCE ==');
for (const g of out.details.intraSource) console.log(`${g.name}\t${g.source}\thashes=${g.hashes}\tn=${g.rows.length}`);
console.log('== HASH GROUPS composition ==');
const comp = { managedOnly: 0, withShadowOrSnapshot: 0, withDerived: 0 };
for (const g of out.details.hashCrossSourceAll) {
  if (g.tiers.includes('derived')) comp.withDerived += 1;
  else if (g.tiers.some((t) => t === 'shadow' || t === 'snapshot')) comp.withShadowOrSnapshot += 1;
  else comp.managedOnly += 1;
}
console.log(JSON.stringify(comp));
for (const g of out.details.hashCrossSourceAll) console.log([g.hash12, g.tiers.join('+'), g.names.join(' | ')].join('\t'));
console.log('== SHADOW INVOLVED ==');
for (const g of out.details.shadowInvolved) console.log([g.name, g.tiers.join('+'), 'hashes=' + g.hashes, 'identical=' + g.identical].join('\t'));
console.log('== SHADOW CROSS ==');
for (const g of out.details.shadowCross) console.log(`${g.name}\t${g.tiers.join('+')}\tn=${g.rows.length}`);
