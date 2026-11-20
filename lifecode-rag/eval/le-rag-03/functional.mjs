/**
 * LE-RAG-03 · Prueba funcional de recuperación sobre COPIA del almacén real (sólo lectura).
 *
 *   node eval/le-rag-03/functional.mjs <ruta/rag.sqlite3>
 *
 * Comprueba: determinismo, golden `fragment` registrado, primera aparición por fuente en `source`,
 * límites, RRF intacto (mismas puntuaciones por fragmento) y paridad de configuración con el diagnóstico.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { search } from '../../lib/search.mjs';
import { validateConfig } from '../../lib/paths.mjs';
import { DEFAULT_DIM, LOCAL_PROVIDER, embedText } from '../../lib/embed.mjs';
import { resolveConfig } from '../../lib/config-resolve.mjs';
import { diagnoseProfile } from '../../lib/diagnose.mjs';

const file = process.argv[2];
if (!file) throw new Error('falta la ruta de la copia del almacén');
const QUERY = 'proyecto aware';
const LIMIT = 8;
const OUT = new URL('./functional-report.json', import.meta.url);

const db = new DatabaseSync(file, { readOnly: true });
const config = validateConfig({});
const embedder = { model: LOCAL_PROVIDER, dim: DEFAULT_DIM, embed: async (t) => t.map((x) => embedText(x)) };

const run = async (diversity) => search(db, { query: QUERY, limit: LIMIT, config, embedder, strategy: 'hybrid', record: false, diversity });

const fragmentA = await run('fragment');
const fragmentB = await run('fragment');
const sourceA = await run('source');
const sourceB = await run('source');

const keys = (r) => r.results.map((x) => x.chunkKey);
const failures = [];
if (JSON.stringify(keys(fragmentA)) !== JSON.stringify(keys(fragmentB))) failures.push('fragment no determinista');
if (JSON.stringify(keys(sourceA)) !== JSON.stringify(keys(sourceB))) failures.push('source no determinista');
if (fragmentA.results.length > LIMIT || sourceA.results.length > LIMIT) failures.push('se supera el límite');
if (keys(fragmentA).length === 0) failures.push('fragment sin resultados');

const firstSources = [];
for (const r of sourceA.results) if (!firstSources.includes(r.sourceId)) firstSources.push(r.sourceId);
const headDistinct = new Set(sourceA.results.slice(0, Math.min(3, sourceA.results.length)).map((r) => r.sourceId)).size;
if (sourceA.results.length >= 3 && headDistinct !== 3) failures.push('source no da una fuente distinta en las 3 primeras');

// RRF intacto: mismo fragmento → misma puntuación en ambos modos (mismos candidatos, misma fusión).
const scoreByKey = new Map(fragmentA.results.map((r) => [r.chunkKey, r.score]));
const mismatched = sourceA.results.filter((r) => scoreByKey.has(r.chunkKey) && Math.abs(scoreByKey.get(r.chunkKey) - r.score) > 1e-12);
if (mismatched.length > 0) failures.push(`RRF alterado en ${mismatched.length} fragmentos`);

// Paridad de configuración: resolvedor == diagnóstico.
const dataRoot = mkdtempSync(join(tmpdir(), 'lcr-functional-cfg-'));
writeFileSync(join(dataRoot, 'config.json'), JSON.stringify({ search: { diversity: 'source' } }), 'utf8');
const env = { ...process.env, LIFECODE_RAG_DATA: dataRoot, LIFECODE_RAG_PROFILE: 'desktop' };
const effective = resolveConfig({ dataRoot, profileKey: 'desktop' }).config;
const diag = diagnoseProfile({ env }).profile?.config?.effectiveSearch;
if (diag?.diversity !== effective.search.diversity) failures.push('diagnóstico y resolvedor discrepan');
rmSync(dataRoot, { recursive: true, force: true });

const report = {
  ok: failures.length === 0,
  failures,
  query: QUERY,
  limit: LIMIT,
  fragment: fragmentA.results.map((r) => ({ chunkKey: r.chunkKey, sourceId: r.sourceId, score: r.score })),
  source: sourceA.results.map((r) => ({ chunkKey: r.chunkKey, sourceId: r.sourceId, score: r.score })),
  distinctSources: { fragment: new Set(fragmentA.results.map((r) => r.sourceId)).size, source: new Set(sourceA.results.map((r) => r.sourceId)).size },
  configParity: { resolver: effective.search.diversity, diagnose: diag?.diversity },
};
writeFileSync(OUT, JSON.stringify(report, null, 1), 'utf8');
console.log(JSON.stringify({ ok: report.ok, failures, fragment: report.fragment.length, source: report.source.length, distinct: report.distinctSources, head: report.fragment.slice(0, 3).map((r) => `${r.sourceId}#${r.chunkKey}`) }, null, 1));
db.close();
process.exitCode = report.ok ? 0 : 1;
