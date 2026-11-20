/** Sonda de diagnóstico sobre el almacén de aceptación: qué devuelve una consulta y qué responde reindex. */
import { join } from 'node:path';

import { createToolDefinitions } from '../../lib/tools.mjs';
import { validateConfig } from '../../lib/paths.mjs';

const here = 'C:/xampp/htdocs/plugins-dhs/lifecode-rag/eval/real-world-01';
const docs = join(here, 'docs');
const config = validateConfig({});
const services = {
  env: process.env,
  workingDirectory: { ensure: async () => docs },
  approval: { request: async () => 'allowed-once' },
};
const defs = createToolDefinitions({ config, root: process.env.LIFECODE_RAG_ROOT, services });
const map = new Map(defs.map((d) => [d.name.replace('lifecode_rag_', ''), d]));
const exec = { agent: { id: 'probe' }, callId: 'probe' };

const s = await map.get('search').execute({ query: 'BORRAME-9988', limit: 5 }, exec);
const re = await map.get('reindex').execute({ operation: 'fts' }, exec);
const list = await map.get('list').execute({}, exec);

console.log(JSON.stringify({
  busqueda: s.results.map((r) => ({ uri: r.uri.split(/[\\/]/).pop(), score: r.score, cosine: r.cosine, via: r.via, bm25: r.bm25 })),
  reindex: re,
  fuentes: (list.rows ?? []).map((r) => ({ uri: String(r.uri).split(/[\\/]/).pop(), chunks: r.chunks ?? null })),
}, null, 1));
