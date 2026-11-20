/**
 * LE-RAG-03 · Benchmark sobre COPIA del almacén real (sólo lectura).
 *
 *   node bench/bench-real.mjs <ruta/rag.sqlite3> [iteraciones]
 *
 * Abre la copia en `readOnly`, no escribe nada y no usa la red.
 */
import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { ftsSearch, search } from '../lib/search.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { blobToVector } from '../lib/embed.mjs';
import { LOCAL_PROVIDER, DEFAULT_DIM, embedText } from '../lib/embed.mjs';

const file = process.argv[2];
if (!file) throw new Error('falta la ruta de la copia del almacén');
const ITER = Number(process.argv[3] ?? 30);
const WARM = 5;

const db = new DatabaseSync(file, { readOnly: true });
const config = validateConfig({});
const embedder = {
  model: LOCAL_PROVIDER,
  dim: DEFAULT_DIM,
  embed: async (texts) => texts.map((t) => embedText(t)),
};

const counts = {
  sources: db.prepare('select count(*) n from sources').get().n,
  chunks: db.prepare('select count(*) n from chunks').get().n,
  vectors: db.prepare('select count(*) n from vectors').get().n,
  bytes: statSync(file).size,
};
const vectorCols = db.prepare('pragma table_info(vectors)').all().map((c) => c.name);

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return { p50: Number(at(50).toFixed(3)), p95: Number(at(95).toFixed(3)), mean: Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3)) };
}

async function measure(label, fn) {
  for (let i = 0; i < WARM; i += 1) await fn();
  const samples = [];
  for (let i = 0; i < ITER; i += 1) {
    const t0 = process.hrtime.bigint();
    await fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return { label, iterations: ITER, warmup: WARM, ms: stats(samples) };
}

const rssStart = process.memoryUsage().rss;
const results = [];
results.push(await measure('real:fts', () => ftsSearch(db, { query: 'proyecto aware', limit: 8 })));
results.push(await measure('real:hybrid:fragment', () => search(db, { query: 'proyecto aware', limit: 8, config, embedder, strategy: 'hybrid', record: false, diversity: 'fragment' })));
results.push(await measure('real:hybrid:source', () => search(db, { query: 'proyecto aware', limit: 8, config, embedder, strategy: 'hybrid', record: false, diversity: 'source' })));
results.push(await measure('real:vector-only', () => search(db, { query: 'proyecto aware', limit: 8, config, embedder, strategy: 'vector', record: false })));
const rssEnd = process.memoryUsage().rss;

console.log(JSON.stringify({
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  corpus: { ...counts, vectorCols, file },
  results,
  memory: { rssStartMB: Number((rssStart / 1048576).toFixed(1)), rssEndMB: Number((rssEnd / 1048576).toFixed(1)) },
}, null, 1));
db.close();
