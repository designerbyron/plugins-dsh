/**
 * Benchmark reproducible: léxico (BM25/FTS) frente a híbrido (FTS + vectores locales).
 *
 * Mide Recall@5, MRR@5, latencia y tokens de contexto frente a leer la fuente completa. No afirma nada
 * sobre calidad semántica: `local-hash-v1` es léxico por diseño, y este banco lo demuestra con dos familias
 * de consultas (exactas y paráfrasis ausentes del corpus).
 *
 * Uso: `node tools/benchmark.mjs` (escribe un informe Markdown en stdout).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assembleContext } from '../lib/context.mjs';
import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { search } from '../lib/search.mjs';

const DOCS = 40;
const INSTALL_DOCS = 10;
const TOP_K = 5;

const RELLENO = ('el sistema local conserva cada decisión y permite consultar el historial sin cargar '
  + 'contexto innecesario; la recuperación selectiva reduce el ruido y mantiene la trazabilidad. ').repeat(6);

function buildCorpus() {
  const docs = [];
  for (let i = 0; i < DOCS; i += 1) {
    const instalacion = i < INSTALL_DOCS;
    const titulo = instalacion ? 'Instalación del entorno local' : `Guía de operación ${i}`;
    const cuerpo = [
      `# ${titulo}`,
      '',
      `## Procedimiento ${i}`,
      '',
      `Clave única: clave${String(i).padStart(4, '0')}. ${RELLENO}`,
      '',
      instalacion
        ? '## Instalación\n\nLa instalación del paquete requiere permisos y deja evidencia en el registro local.'
        : '## Operación\n\nLa operación habitual no necesita permisos adicionales y queda auditada.',
      '',
      `## Cierre\n\nEl cierre de clave${String(i).padStart(4, '0')} conserva el historial y las citas verificables.`,
    ].join('\n');
    docs.push({ name: `doc-${String(i).padStart(3, '0')}.md`, body: cuerpo });
  }
  return docs;
}

function recallAt(results, relevant) {
  return results.slice(0, TOP_K).some((row) => relevant.has(row.sourceId)) ? 1 : 0;
}

function reciprocalRank(results, relevant) {
  const index = results.slice(0, TOP_K).findIndex((row) => relevant.has(row.sourceId));
  return index === -1 ? 0 : 1 / (index + 1);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function measure(db, { queries, config }) {
  const out = { fts: { recall: [], mrr: [], latency: [] }, hybrid: { recall: [], mrr: [], latency: [] } };
  for (const check of queries) {
    for (const strategy of ['fts', 'hybrid']) {
      const result = search(db, { query: check.query, limit: TOP_K, strategy, config });
      out[strategy].recall.push(recallAt(result.results, check.relevant));
      out[strategy].mrr.push(reciprocalRank(result.results, check.relevant));
      out[strategy].latency.push(result.elapsedMs);
    }
  }
  const summarise = (bucket) => ({
    recall: bucket.recall.reduce((a, b) => a + b, 0) / bucket.recall.length,
    mrr: bucket.mrr.reduce((a, b) => a + b, 0) / bucket.mrr.length,
    mean: bucket.latency.reduce((a, b) => a + b, 0) / bucket.latency.length,
    p95: percentile(bucket.latency, 95),
  });
  return { fts: summarise(out.fts), hybrid: summarise(out.hybrid) };
}

const box = mkdtempSync(join(tmpdir(), 'rag-bench-'));
try {
  const cwd = join(box, 'proyecto');
  const store = join(box, 'almacen');
  mkdirSync(cwd, { recursive: true });
  const config = validateConfig({});

  const docs = buildCorpus();
  for (const doc of docs) writeFileSync(join(cwd, doc.name), doc.body, 'utf8');
  const ingested = ingestFiles({
    root: store, files: docs.map((doc) => join(cwd, doc.name)), collection: 'bench', tags: ['bench'], now: Date.now(), config,
  });
  if (ingested.ingested.length !== DOCS) throw new Error(`corpus incompleto: ${JSON.stringify(ingested.errors)}`);

  const opened = openDatabase({ root: store, create: false });
  try {
    const byName = new Map(opened.db.prepare('SELECT id, uri FROM sources').all().map((row) => [row.uri.split(/[\\/]/).pop(), row.id]));

    const exactas = [];
    for (const doc of docs) {
      const match = /clave(\d+)/.exec(doc.body);
      if (!match) continue;
      exactas.push({ query: `clave${match[1]}`, relevant: new Set([byName.get(doc.name)]) });
    }
    const parametros = docs.filter((doc) => doc.body.includes('# Instalación del entorno')).slice(0, 5);
    const relevantesInstalacion = new Set(parametros.map((doc) => byName.get(doc.name)));
    // Palabra que el corpus NO contiene: el documento dice «instalación», la consulta dice «instalar».
    const parafrasis = [{ query: 'instalar', relevant: relevantesInstalacion }];

    const exact = measure(opened.db, { queries: exactas, config });
    const paraphrase = measure(opened.db, { queries: parafrasis, config });
    const sinAcento = measure(opened.db, { queries: [{ query: 'instalacion', relevant: relevantesInstalacion }], config });

    const contextSamples = [];
    const corpusTokens = opened.db.prepare('SELECT SUM(token_est) AS tokens FROM chunks').get().tokens;
    for (const check of exactas) {
      const result = search(opened.db, { query: check.query, limit: TOP_K, config });
      const context = assembleContext({ results: result.results, config, budgetTokens: 2000, maxChunks: 12, mmrLambda: 0.7 });
      contextSamples.push({ tokens: context.tokens, truncated: context.truncated });
    }

    const avg = (values) => values.reduce((a, b) => a + b, 0) / values.length;
    const contextTokens = avg(contextSamples.map((sample) => sample.tokens));
    const truncated = contextSamples.filter((sample) => sample.truncated).length;

    const fmt = (value) => value.toFixed(3);
    console.log(`# Benchmark LifeCode RAG — ${new Date().toISOString().slice(0, 10)}\n`);
    console.log(`Corpus sintético: ${DOCS} documentos, ${opened.db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n} fragmentos. `
      + `Consultas: ${exactas.length} exactas + ${parafrasis.length} paráfrasis. Top-${TOP_K}.\n`);
    console.log('| Estrategia | Recall@5 exactas | MRR@5 exactas | Latencia media (ms) | p95 (ms) |');
    console.log('|---|---:|---:|---:|---:|');
    console.log(`| FTS (BM25) | ${fmt(exact.fts.recall)} | ${fmt(exact.fts.mrr)} | ${exact.fts.mean.toFixed(2)} | ${exact.fts.p95.toFixed(2)} |`);
    console.log(`| Híbrido | ${fmt(exact.hybrid.recall)} | ${fmt(exact.hybrid.mrr)} | ${exact.hybrid.mean.toFixed(2)} | ${exact.hybrid.p95.toFixed(2)} |`);
    console.log('\n| Estrategia | Recall@5 paráfrasis (`instalar`) | Recall@5 sin acento (`instalacion`) |');
    console.log('|---|---:|---:|');
    console.log(`| FTS (BM25) | ${fmt(paraphrase.fts.recall)} | ${fmt(sinAcento.fts.recall)} |`);
    console.log(`| Híbrido | ${fmt(paraphrase.hybrid.recall)} | ${fmt(sinAcento.hybrid.recall)} |`);
    console.log('\n| Contexto | Valor |');
    console.log('|---|---:|');
    console.log(`| Tokens medios con presupuesto 2000 | ${contextTokens.toFixed(0)} |`);
    console.log(`| Tokens del corpus completo (sin recuperación) | ${corpusTokens} |`);
    console.log(`| Consultas truncadas | ${truncated} / ${contextSamples.length} |`);
    console.log(`| Ahorro frente a cargar el corpus | ${(100 * (1 - contextTokens / corpusTokens)).toFixed(1)} % |`);
    console.log('\nLímite medido, no una opinión: `local-hash-v1` indexa tokens, no significado. '
      + 'La paráfrasis fuera del vocabulario no se recupera con ninguno de los dos modos; para eso hace falta '
      + 'un proveedor neuronal opt-in, y no se afirma lo contrario.');
  } finally {
    closeDatabase(opened.db);
  }
} finally {
  rmSync(box, { recursive: true, force: true });
}
