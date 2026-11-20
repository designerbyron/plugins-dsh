/**
 * LE-RAG-02 · Benchmark reproducible (fixtures sintéticos, sin datos reales).
 *
 *   node bench/bench.mjs [iteraciones]
 *
 * Mide p50/p95 de: léxico, híbrido fragment, híbrido source, resolución de configuración y
 * reducción de eventos. Calienta antes de medir y no escribe en ningún almacén real.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { ftsSearch, search } from '../lib/search.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { resolveConfig } from '../lib/config-resolve.mjs';
import { reduceConversation } from '../lib/conversation-events.mjs';
import { insertChunk, insertSource } from '../tests/helpers.mjs';

const ITER = Number(process.argv[2] ?? 30);
const WARM = 5;
const box = mkdtempSync(join(tmpdir(), 'lcr-bench-'));
const { db } = openDatabase({ root: join(box, 'store'), create: true });

// 30 fuentes × 10 fragmentos = 300 fragmentos, todas con el término «alpha».
for (let s = 0; s < 30; s += 1) {
  insertSource(db, { id: `src-${s}`, uri: `C:/bench/${s}.md`, title: `S${s}` });
  for (let c = 0; c < 10; c += 1) {
    insertChunk(db, { sourceId: `src-${s}`, ordinal: c, text: `alpha documento ${s} fragmento ${c}`, title: `S${s}` });
  }
}

const config = validateConfig({});
const embedder = { model: 'bench', dim: 8, embed: async (texts) => texts.map(() => new Float32Array(8)) };

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

const events = Array.from({ length: 100 }, (_, i) => ({
  eventId: `e${i}`, conversationId: 'c1', sequence: i, role: i % 2 ? 'assistant' : 'user', content: `mensaje ${i}`,
}));
const cfgDir = mkdtempSync(join(tmpdir(), 'lcr-bench-cfg-'));

const results = [];
results.push(await measure('fts', () => ftsSearch(db, { query: 'alpha', limit: 8 })));
results.push(await measure('hybrid:fragment', () => search(db, { query: 'alpha', limit: 8, config, embedder, strategy: 'hybrid', record: false, diversity: 'fragment' })));
results.push(await measure('hybrid:source', () => search(db, { query: 'alpha', limit: 8, config, embedder, strategy: 'hybrid', record: false, diversity: 'source' })));
results.push(await measure('config:resolve', () => resolveConfig({ dataRoot: cfgDir, profileKey: 'bench' })));
results.push(await measure('events:reduce100', () => reduceConversation(events)));

console.log(JSON.stringify({
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpus: (await import('node:os')).cpus().length },
  fixture: { sources: 30, chunks: 300, query: 'alpha', limit: 8 },
  results,
}, null, 1));

closeDatabase(db);
rmSync(box, { recursive: true, force: true });
rmSync(cfgDir, { recursive: true, force: true });
