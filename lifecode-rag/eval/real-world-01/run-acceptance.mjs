/**
 * Aceptación con datos reales sobre un almacén real del plugin (SQLite en disco), no sobre un mundo simulado.
 *
 *   LIFECODE_RAG_ROOT=… DSH_PROFILE=real-world-01 node eval/real-world-01/run-acceptance.mjs ingest
 *   LIFECODE_RAG_ROOT=… DSH_PROFILE=real-world-01 node eval/real-world-01/run-acceptance.mjs verify
 *
 * `ingest` y `verify` se ejecutan en **procesos distintos**: lo que `verify` ve lo leyó del disco, no de
 * memoria. La sesión no tiene fila de selección: el proyecto se resuelve por `cwd` contra la raíz autorizada,
 * que es el camino que usa el agente en el día a día.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createToolDefinitions } from '../../lib/tools.mjs';
import { validateConfig } from '../../lib/paths.mjs';
import { loadConfig } from '../../lib/paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, 'docs');
const phase = process.argv[2] ?? 'ingest';
const sessionId = process.env.ACCEPTANCE_SESSION ?? 'sesion-real-01';
const root = process.env.LIFECODE_RAG_ROOT;

if (!root) {
  console.error('✗ falta LIFECODE_RAG_ROOT');
  process.exit(2);
}

const config = loadConfig(root).config ?? validateConfig({});
const services = {
  env: process.env,
  workingDirectory: { ensure: async () => docs },
  // El host concede la aprobación en uso real; aquí se simula `allowed-once` para poder recorrer el camino.
  approval: { request: async () => 'allowed-once' },
};

const definitions = createToolDefinitions({ config, root, services });
const byName = new Map(definitions.map((d) => [d.name.replace('lifecode_rag_', ''), d]));
const exec = { agent: { id: sessionId }, callId: `acc-${phase}` };
const call = (name, args = {}) => byName.get(name).execute(args, exec);

const out = [];
const step = (name, value) => out.push({ step: name, ...value });

function finish(ok, extra = {}) {
  console.log(JSON.stringify({ ok, phase, sessionId, root, ...extra, steps: out }, null, 1));
  process.exit(ok ? 0 : 1);
}

try {
  if (phase === 'ingest') {
    const ing = await call('ingest', { paths: [docs] });
    step('ingest', {
      ingeridas: (ing.ingested ?? []).map((s) => ({ uri: s.uri.split(/[\\/]/).pop(), chunks: s.chunks })),
      omitidas: (ing.skipped ?? []).length,
      errores: (ing.errors ?? []).map((e) => ({ code: e.code, path: e.path })),
    });

    const dup = await call('ingest', { paths: [docs] });
    step('ingest-duplicado', { ingeridas: (dup.ingested ?? []).length, omitidas: (dup.skipped ?? []).length, motivo: dup.skipped?.[0]?.reason ?? null });

    const list = await call('list', {});
    step('list', { total: list.total, uris: (list.rows ?? []).map((r) => String(r.uri).split(/[\\/]/).pop()) });

    const s1 = await call('search', { query: 'ZX-4471', limit: 5 });
    step('search-codigo', { resultados: s1.results.length, primera: s1.results[0]?.uri?.split(/[\\/]/).pop() ?? null });

    const s2 = await call('search', { query: 'treinta días naturales', limit: 3 });
    step('search-frase', { resultados: s2.results.length });

    const ctx = await call('context', { query: 'plazo de reembolso', maxTokens: 400 });
    step('context', { citas: ctx.citations?.length ?? 0, tokens: ctx.tokens, truncado: ctx.truncated === true, primeraCita: ctx.citations?.[0]?.uri?.split(/[\\/]/).pop() ?? null });

    const policyId = (list.rows ?? []).find((r) => String(r.uri).endsWith('politica-reembolsos.md'))?.id;
    const got = await call('get', { ref: policyId });
    step('get', { uri: got.source?.uri?.split(/[\\/]/).pop() ?? null, fragmentos: got.chunks?.length ?? null });

    const draftId = (list.rows ?? []).find((r) => String(r.uri).endsWith('borrador-temporal.md'))?.id;
    const del = await call('forget', { ref: draftId });
    step('forget', { fuente: String(del.uri).split(/[\\/]/).pop(), fragmentos: del.chunks });

    const afterDelete = await call('search', { query: 'BORRAME-9988', limit: 5 });
    step('search-tras-borrar', { resultados: afterDelete.results.length, modo: afterDelete.mode, fuentes: afterDelete.results.map((r) => String(r.uri).split(/[\/]/).pop()), conSnippet: afterDelete.results.filter((r) => r.snippet).length });

    const re = await call('reindex', { operation: 'fts' });
    step('reindex', { operacion: re.operation, reconstruidos: re.rebuiltChunks ?? null });

    const afterReindex = await call('search', { query: 'CAJA-2200', limit: 3 });
    step('search-tras-reindex', { resultados: afterReindex.results.length });

    const list2 = await call('list', {});
    step('list-final', { total: list2.total });
    finish(true, { docs });
  }

  if (phase === 'verify') {
    const list = await call('list', {});
    step('list', { total: list.total, uris: (list.rows ?? []).map((r) => String(r.uri).split(/[\\/]/).pop()) });

    const s1 = await call('search', { query: 'ZX-4471', limit: 5 });
    step('search-codigo', { resultados: s1.results.length, fuente: s1.results[0]?.uri?.split(/[\\/]/).pop() ?? null });

    const ctx = await call('context', { query: 'responsable de operaciones', maxTokens: 400 });
    step('context', { citas: ctx.citations?.length ?? 0, tokens: ctx.tokens });

    const policyId = (list.rows ?? []).find((r) => String(r.uri).endsWith('politica-reembolsos.md'))?.id;
    const got = await call('get', { ref: policyId });
    const body = JSON.stringify(got);
    step('get', { uri: got.source?.uri?.split(/[\\/]/).pop() ?? null, fragmentos: got.chunks?.length ?? null, contieneCodigo: body.includes('ZX-4471') });

    const deleted = await call('search', { query: 'BORRAME-9988', limit: 5 });
    step('borrado-sigue-ausente', { resultados: deleted.results.length });

    // Persistencia material: el fichero del almacén existe y tiene contenido tras el proceso anterior.
    const bytes = readFileSync(join(root, 'registry.sqlite3')).length;
    step('almacen', { registryBytes: bytes });

    // El criterio es que la fuente borrada no aparezca, no que la búsqueda devuelva cero: la rama vectorial
    // puede devolver aciertos sin coincidencia léxica (`mode: 'none'`, sin snippet), y eso se documenta.
    const deletedStillVisible = deleted.results.some((r) => String(r.uri).endsWith('borrador-temporal.md'));
    const ok = list.total === 2 && s1.results.length >= 1 && (ctx.citations?.length ?? 0) >= 1 && !deletedStillVisible && got.chunks?.length > 0;
    finish(ok);
  }

  console.error(`✗ fase desconocida: ${phase}`);
  process.exit(2);
} catch (error) {
  console.log(JSON.stringify({ ok: false, phase, code: error?.code ?? null, message: error?.message ?? String(error), steps: out }, null, 1));
  process.exit(1);
}
