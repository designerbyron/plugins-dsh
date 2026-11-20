/** Aislamiento entre proyectos: una sesión en el proyecto B no puede recuperar una fuente del proyecto A. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createToolDefinitions } from '../../lib/tools.mjs';
import { validateConfig } from '../../lib/paths.mjs';
import { profileRoot } from '../../lib/profile.mjs';

const here = 'C:/xampp/htdocs/plugins-dhs/lifecode-rag/eval/real-world-01';
const docsA = join(here, 'docs');
const docsB = join(here, 'docs-b');
mkdirSync(docsB, { recursive: true });
writeFileSync(join(docsB, 'otro-proyecto.md'), '# Otro proyecto\n\ncontenido exclusivo del proyecto B: CLAVE-B-3311\n', 'utf8');

let cwd = docsA;
const config = validateConfig({});
const services = {
  env: process.env,
  workingDirectory: { ensure: async () => cwd },
  approval: { request: async () => 'allowed-once' },
};
const defs = createToolDefinitions({ config, root: profileRoot(process.env), services });
const map = new Map(defs.map((d) => [d.name.replace('lifecode_rag_', ''), d]));
const callA = (name, args) => map.get(name).execute(args, { agent: { id: 'sesion-proyecto-a' }, callId: `a-${name}` });
const callB = (name, args) => map.get(name).execute(args, { agent: { id: 'sesion-proyecto-b' }, callId: `b-${name}` });

const listA = await callA('list', {});
const target = (listA.rows ?? []).find((r) => String(r.uri).endsWith('politica-reembolsos.md'));

cwd = docsB;
const listB = await callB('list', {});
const ingB = await callB('ingest', { paths: [join(docsB, 'otro-proyecto.md')] });
const listB2 = await callB('list', {});

let crossGet;
try { await callB('get', { ref: target.id }); crossGet = { ok: true, fuga: true }; }
catch (error) { crossGet = { ok: false, code: error.code }; }

let crossSearch;
try {
  const r = await callB('search', { query: 'ZX-4471', limit: 5 });
  crossSearch = { resultados: r.results.length, uris: r.results.map((x) => String(x.uri).split(/[\\/]/).pop()) };
} catch (error) { crossSearch = { code: error.code }; }

console.log(JSON.stringify({
  proyectoA: { fuentes: listA.total, objetivo: String(target.uri).split(/[\\/]/).pop() },
  proyectoB: { fuentesAntes: listB.total, ingeridas: (ingB.ingested ?? []).length, fuentesDespues: listB2.total,
    uris: (listB2.rows ?? []).map((r) => String(r.uri).split(/[\\/]/).pop()) },
  getCruzado: crossGet,
  busquedaCruzada: crossSearch,
}, null, 1));
if (crossGet.fuga || crossSearch.uris?.includes('politica-reembolsos.md') || listB.total !== 0) process.exit(1);
