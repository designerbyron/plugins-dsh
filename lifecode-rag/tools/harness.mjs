/**
 * Arnés reproducible de M0.1: mide el motor real de LifeCode RAG con corpus sintéticos
 * deterministas de 1.000, 5.000 y 10.000 chunks.
 *
 * - El corpus se genera fuera del repositorio, en un directorio temporal propio.
 * - Cada tamaño se repite (por defecto 3 veces) y se conservan los resultados crudos.
 * - La recuperación se mide con `search()` real y el contexto con `assembleContextAsync()`.
 * - Separa lo medido de lo derivado: aquí todo es medición directa salvo el recuento de
 *   chunks, que se lee de la base tras la ingesta.
 *
 * Uso:
 *   node tools/harness.mjs [--sizes 1000,5000,10000] [--repeats 3] [--queries 40]
 *                          [--out eval/m0/harness]
 */

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { assembleContextAsync } from '../lib/context.mjs';
import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { createEmbedder } from '../lib/embedders.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { search } from '../lib/search.mjs';
import { validateConfig } from '../lib/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const WORD_BANK = [
  'archivo', 'biblioteca', 'busqueda', 'contenido', 'documento', 'indice', 'memoria', 'proceso',
  'recuperacion', 'servidor', 'sistema', 'termino', 'usuario', 'ventana', 'almacen', 'consulta',
  'fragmento', 'modelo', 'vector', 'lexico', 'contexto', 'politica', 'metrica', 'registro',
  'instalacion', 'configuracion', 'operacion', 'verificacion', 'seguridad', 'rendimiento',
  'aplicacion', 'conexion', 'gestion', 'herramienta', 'proyecto', 'revision', 'evidencia',
];

/** Cada documento ronda 1,4-1,8 KB: un chunk con la configuración por defecto. */
function makeDocument(random, index) {
  const topic = WORD_BANK[index % WORD_BANK.length];
  const unique = `token${String(index).padStart(5, '0')}`;
  const lines = [`# Documento ${index} sobre ${topic}`, ''];
  for (let section = 0; section < 3; section += 1) {
    const words = [];
    for (let word = 0; word < 55; word += 1) {
      words.push(WORD_BANK[Math.floor(random() * WORD_BANK.length)]);
    }
    lines.push(`Seccion ${section + 1}: ${topic} y ${unique}. ${words.join(' ')}.`);
    lines.push('');
  }
  return lines.join('\n');
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(3));
}

async function measure({ chunksTarget, repeat, queries }) {
  const boxRoot = mkdtempSync(join(tmpdir(), `lifecode-rag-harness-${chunksTarget}-${repeat}-`));
  const corpus = join(boxRoot, 'corpus');
  const store = join(boxRoot, 'almacen');
  mkdirSync(corpus, { recursive: true });

  const documents = chunksTarget;
  const random = rng(1_000 + chunksTarget * 31 + repeat);
  const files = [];
  let bytes = 0;
  for (let index = 0; index < documents; index += 1) {
    const path = join(corpus, `doc-${String(index).padStart(5, '0')}.md`);
    const body = makeDocument(random, index);
    writeFileSync(path, body, 'utf8');
    bytes += Buffer.byteLength(body);
    files.push(path);
  }

  let config = validateConfig({
    maxFilesPerIngest: Math.min(documents, 10_000),
    search: { strategy: 'hybrid' },
  });
  // Sólo para experimentos de calidad: permite comparar pesos sin tocar los valores por defecto.
  const weightOverride = process.env.LCR_HARNESS_WEIGHTS;
  if (weightOverride) {
    const [lexical, semantic] = weightOverride.split(',').map(Number);
    config = validateConfig({
      ...config,
      search: { ...config.search, weights: { lexical, semantic } },
    });
  }
  const embedder = createEmbedder(config);

  const rssBefore = process.memoryUsage().rss;
  const ingestStart = performance.now();
  const result = await ingestFiles({ root: store, files, config, embedder });
  const ingestMs = performance.now() - ingestStart;

  const opened = openDatabase({ root: store, create: false });
  const chunks = opened.db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
  const sources = opened.db.prepare('SELECT COUNT(*) AS n FROM sources').get().n;
  const dbBytes = statSync(opened.paths.database).size;

  const exactQueries = [];
  for (let index = 0; index < Math.ceil(queries / 2); index += 1) {
    const doc = (index * 37) % documents;
    exactQueries.push({ query: `token${String(doc).padStart(5, '0')}`, expected: doc });
  }
  const bankQueries = [];
  for (let index = 0; index < Math.floor(queries / 2); index += 1) {
    bankQueries.push({ query: WORD_BANK[(index * 7) % WORD_BANK.length], expected: null });
  }

  const latencies = { fts: [], hybrid: [] };
  const recalls = { fts: [], hybrid: [] };
  let empty = 0;
  const contextTokens = [];
  let contextTruncated = 0;

  for (const item of [...exactQueries, ...bankQueries]) {
    for (const strategy of ['fts', 'hybrid']) {
      const start = performance.now();
      const found = await search(opened.db, { query: item.query, limit: 5, strategy, config, embedder, record: false });
      latencies[strategy].push(performance.now() - start);
      if (found.results.length === 0) empty += 1;
      if (item.expected !== null) {
        const source = opened.db.prepare('SELECT uri FROM sources WHERE id = ?').get(found.results[0]?.sourceId ?? '');
        recalls[strategy].push(source?.uri.endsWith(`doc-${String(item.expected).padStart(5, '0')}.md`) ? 1 : 0);
      }
    }
  }

  for (const item of exactQueries.slice(0, 10)) {
    const found = await search(opened.db, { query: item.query, limit: 8, strategy: 'hybrid', config, embedder, record: false });
    const built = await assembleContextAsync({ results: found.results, config, embedder });
    contextTokens.push(built.tokens);
    if (built.truncated) contextTruncated += 1;
  }

  closeDatabase(opened.db);

  const rssAfter = process.memoryUsage().rss;
  const stats = {
    size: chunksTarget,
    repeat,
    documents,
    bytes,
    sources,
    chunks,
    dbBytes,
    ingestMs: Number(ingestMs.toFixed(1)),
    chunksPerSecond: Number((chunks / (ingestMs / 1000)).toFixed(1)),
    ingestErrors: result.errors.length,
    ingestSkipped: result.skipped.length,
    rssBeforeMB: Number((rssBefore / 1024 / 1024).toFixed(1)),
    rssAfterMB: Number((rssAfter / 1024 / 1024).toFixed(1)),
    queries: exactQueries.length + bankQueries.length,
    emptyResults: empty,
    latencyMs: {
      fts: { p50: percentile(latencies.fts, 50), p95: percentile(latencies.fts, 95) },
      hybrid: { p50: percentile(latencies.hybrid, 50), p95: percentile(latencies.hybrid, 95) },
    },
    recallAt5: {
      fts: recalls.fts.length ? Number((recalls.fts.reduce((a, b) => a + b, 0) / recalls.fts.length).toFixed(3)) : null,
      hybrid: recalls.hybrid.length ? Number((recalls.hybrid.reduce((a, b) => a + b, 0) / recalls.hybrid.length).toFixed(3)) : null,
    },
    context: {
      samples: contextTokens.length,
      meanTokens: contextTokens.length ? Math.round(contextTokens.reduce((a, b) => a + b, 0) / contextTokens.length) : null,
      truncated: contextTruncated,
    },
  };

  rmSync(boxRoot, { recursive: true, force: true });
  return stats;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const sizes = arg('sizes', '1000,5000,10000').split(',').map((value) => Number(value.trim())).filter(Boolean);
  const repeats = Number(arg('repeats', '3'));
  const queries = Number(arg('queries', '40'));
  const outDir = resolve(ROOT, '..', arg('out', 'eval/m0/harness'));
  mkdirSync(outDir, { recursive: true });

  const all = [];
  for (const size of sizes) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      process.stderr.write(`harness: ${size} chunks, repeticion ${repeat}/${repeats}...\n`);
      all.push(await measure({ chunksTarget: size, repeat, queries }));
    }
  }

  const bySize = new Map();
  for (const row of all) {
    if (!bySize.has(row.size)) bySize.set(row.size, []);
    bySize.get(row.size).push(row);
  }
  const aggregate = [...bySize.entries()].map(([size, rows]) => ({
    size,
    runs: rows.length,
    chunksMedian: median(rows.map((row) => row.chunks)),
    ingestMsMedian: median(rows.map((row) => row.ingestMs)),
    chunksPerSecondMedian: median(rows.map((row) => row.chunksPerSecond)),
    dbBytesMedian: median(rows.map((row) => row.dbBytes)),
    rssPeakMB: Math.max(...rows.map((row) => row.rssAfterMB)),
    latencyFtsP50Median: median(rows.map((row) => row.latencyMs.fts.p50)),
    latencyFtsP95Median: median(rows.map((row) => row.latencyMs.fts.p95)),
    latencyHybridP50Median: median(rows.map((row) => row.latencyMs.hybrid.p50)),
    latencyHybridP95Median: median(rows.map((row) => row.latencyMs.hybrid.p95)),
    recallFtsMedian: median(rows.map((row) => row.recallAt5.fts)),
    recallHybridMedian: median(rows.map((row) => row.recallAt5.hybrid)),
    contextMeanTokensMedian: median(rows.map((row) => row.context.meanTokens)),
    emptyResultsMedian: median(rows.map((row) => row.emptyResults)),
  }));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(outDir, `harness-${stamp}.json`);
  const mdPath = join(outDir, `harness-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), sizes, repeats, queries, runs: all, aggregate }, null, 2)}\n`, 'utf8');

  const lines = [
    '# Arnes M0.1 - resultados crudos',
    '',
    `Generado: ${new Date().toISOString()}`,
    `Tamanos: ${sizes.join(', ')} - repeticiones: ${repeats} - consultas por ejecucion: ${queries}`,
    '',
    '| chunks | runs | chunks (mediana) | ingesta ms | chunks/s | DB bytes | RSS pico MB | FTS p50 | FTS p95 | hibrido p50 | hibrido p95 | Recall@5 FTS | Recall@5 hibrido | tokens contexto |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of aggregate) {
    lines.push(`| ${row.size} | ${row.runs} | ${row.chunksMedian} | ${row.ingestMsMedian} | ${row.chunksPerSecondMedian} | ${row.dbBytesMedian} | ${row.rssPeakMB} | ${row.latencyFtsP50Median} | ${row.latencyFtsP95Median} | ${row.latencyHybridP50Median} | ${row.latencyHybridP95Median} | ${row.recallFtsMedian} | ${row.recallHybridMedian} | ${row.contextMeanTokensMedian} |`);
  }
  lines.push('', 'Los valores son mediciones directas del motor real; `chunks` se lee de SQLite tras la ingesta.', '');
  writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify({ json: jsonPath, md: mdPath, aggregate }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
