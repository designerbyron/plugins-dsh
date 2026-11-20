/**
 * Aceptación pedida por el propietario, ejecutada con las definiciones de producción (las mismas que el
 * host registra) contra el almacén REAL del perfil `desktop`.
 *
 * No es una llamada del modelo dentro de DSH: Hermes no tiene `lifecode_rag_*` en su juego de herramientas.
 * Es la herramienta real (mismo código, mismo registro, misma sesión) ejecutada desde fuera del host.
 */
import { loadConfig } from '../../lib/paths.mjs';
import { createToolDefinitions } from '../../lib/tools.mjs';
import { readFileSync } from 'node:fs';

const ROOT = 'C:/Users/<USER>/.dsh/lifecode-rag/profiles/desktop';
const SESSION = 'session-c90d50d6-aa3d-4330-a9c8-76b21dc0f188';

const raw = JSON.parse(readFileSync('C:/Users/<USER>/.dsh/storages/workspace.json', 'utf8'));
const workspaces = Object.entries(raw?.tables?.workspaces ?? {}).map(([id, w]) => ({ id, ...w }));

const { config } = loadConfig(ROOT);
const services = {
  env: { ...process.env, DSH_PROFILE: 'desktop' },
  workspaces: { list: () => workspaces },
  workingDirectory: { ensure: async () => process.argv[2] ?? 'C:/xampp/htdocs/plugins-dhs/lifecode-rag' },
  approval: { request: async () => 'deny' },
};

const defs = createToolDefinitions({ config, root: ROOT, services });
const byName = new Map(defs.map((d) => [d.name.replace('lifecode_rag_', ''), d]));
const exec = { agent: { id: SESSION }, callId: 'owner-acceptance-1' };
const call = (name, args) => byName.get(name).execute(args, exec);

const out = {};
try {
  const list = await call('list', { limit: 3 });
  out.list = { total: list.total, primeras: (list.rows ?? []).map((r) => r.uri) };

  const search = await call('search', { query: 'project-aware', limit: 3 });
  out.search = {
    modo: search.mode,
    ms: search.elapsedMs,
    resultados: (search.results ?? []).map((r) => ({
      sourceId: r.sourceId,
      chunkKey: r.chunkKey,
      uri: r.uri,
      title: r.title,
      heading: r.heading,
      snippet: String(r.snippet ?? '').replace(/\s+/g, ' ').trim(),
    })),
  };

  const first = search.results?.[0];
  if (first) {
    const got = await call('get', { ref: first.sourceId });
    out.get = {
      ref: first.sourceId,
      uri: got.source?.uri ?? null,
      title: got.source?.title ?? null,
      mime: got.source?.mime ?? null,
      chunks: (got.chunks ?? []).map((c) => ({ heading: c.heading ?? null, text: String(c.text ?? '') })),
    };
  }
} catch (error) {
  out.error = { code: error?.code ?? null, message: error?.message ?? String(error), details: error?.details ?? null };
}

const result = { session: SESSION, root: ROOT, cwd: process.argv[2] ?? 'C:/xampp/htdocs/plugins-dhs/lifecode-rag', ...out };
console.log(JSON.stringify(result, null, 1));
process.exit(out.error ? 1 : 0);
