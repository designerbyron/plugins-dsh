/**
 * Camino real de herramienta sobre una COPIA del almacén del perfil (registro + scopes).
 * Reproduce lo que hace el host: servicios con `workspaces` (registro durable) + `workingDirectory`.
 *
 *   node eval/real-host-acceptance-01/tool-path-probe.mjs <raiz-copia> <workspace.json> <cwd> <sessionId>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateConfig } from '../../lib/paths.mjs';
import { createToolDefinitions } from '../../lib/tools.mjs';

const [root, workspaceFile, cwd, sessionId] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(workspaceFile, 'utf8'));
const workspaces = Object.entries(raw?.tables?.workspaces ?? {}).map(([id, w]) => ({ id, ...w }));

const config = validateConfig({});
const services = {
  env: { ...process.env, LIFECODE_RAG_ROOT: root, DSH_PROFILE: 'desktop' },
  workspaces: { list: () => workspaces },
  workingDirectory: { ensure: async () => cwd },
  approval: { request: async () => 'deny' },
};

const defs = createToolDefinitions({ config, root, services });
const byName = new Map(defs.map((d) => [d.name.replace('lifecode_rag_', ''), d]));
const exec = { agent: { id: sessionId }, callId: 'host-acceptance' };
const call = (name, args) => byName.get(name).execute(args, exec);

const out = {};
try {
  const list = await call('list', { limit: 5 });
  out.list = { total: list.total, primeras: (list.rows ?? []).map((r) => ({ id: r.id, uri: String(r.uri).split(/[\\/]/).slice(-2).join('/') })) };

  const search = await call('search', { query: 'project-aware', limit: 3 });
  out.search = {
    modo: search.mode,
    elapsedMs: search.elapsedMs,
    resultados: (search.results ?? []).map((r) => ({
      sourceId: r.sourceId,
      chunkKey: r.chunkKey,
      uri: String(r.uri).split(/[\\/]/).slice(-2).join('/'),
      title: r.title,
      heading: r.heading,
      rrf: Math.round((r.rrf ?? 0) * 1e6) / 1e6,
      snippet: String(r.snippet ?? '').replace(/\s+/g, ' ').slice(0, 120),
    })),
  };

  const first = search.results?.[0];
  if (first) {
    const got = await call('get', { ref: first.sourceId });
    out.get = {
      ref: first.sourceId,
      uri: String(got.source?.uri ?? '').split(/[\\/]/).slice(-2).join('/'),
      title: got.source?.title ?? null,
      chunks: (got.chunks ?? []).length,
      primerFragmento: String(got.chunks?.[0]?.text ?? '').replace(/\s+/g, ' ').slice(0, 100),
    };
  }

  const ctx = await call('context', { query: 'project-aware', budgetTokens: 900 });
  out.context = { citas: (ctx.citations ?? []).length, tokens: ctx.tokens ?? null, truncado: ctx.truncated === true };
  out.ok = (out.search?.resultados?.length ?? 0) > 0 && (out.get?.chunks ?? 0) > 0;
} catch (error) {
  out.ok = false;
  out.error = { code: error?.code ?? null, message: error?.message ?? String(error), details: error?.details ?? null };
}

console.log(JSON.stringify({ root, sessionId, cwd, workspaces: workspaces.length, ...out }, null, 1));
process.exit(out.ok ? 0 : 1);
