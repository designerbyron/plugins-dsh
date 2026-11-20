/**
 * LE-RAG-04 · Validación de las SIETE herramientas sobre una COPIA del perfil real.
 *
 *   node eval/le-rag-04/seven-tools.mjs <profileRootCopia>
 *
 * La copia contiene `registry.sqlite3`, `config.json` y el almacén del proyecto. Ninguna ruta
 * apunta al perfil real: las escrituras (ingest, forget, reindex) caen dentro de la copia.
 */
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import { createToolDefinitions } from '../../lib/tools.mjs';
import { resolveConfig } from '../../lib/config-resolve.mjs';
import { ragRoot } from '../../lib/paths.mjs';

const PROFILE_ROOT = process.argv[2];
if (!PROFILE_ROOT) throw new Error('falta la raíz del perfil copiado');
const DATA_ROOT = dirname(dirname(PROFILE_ROOT));
const SESSION = 'session-c90d50d6-aa3d-4330-a9c8-76b21dc0f188';
const PROJECT_CWD = 'C:\\xampp\\htdocs\\plugins-dhs\\lifecode-rag';

const config = resolveConfig({ dataRoot: DATA_ROOT, profileKey: 'desktop' }).config;
const services = {
  env: { ...process.env, LIFECODE_RAG_ROOT: PROFILE_ROOT, DSH_PROFILE: 'desktop' },
  now: () => Date.now(),
  approval: { async request() { return 'allowed-once'; } },
  workingDirectory: { async ensure() { return PROJECT_CWD; } },
};
const defs = createToolDefinitions({ config, root: PROFILE_ROOT, services });
const map = new Map(defs.map((d) => [d.name.replace('lifecode_rag_', ''), d]));
const exec = (sessionId) => ({ agent: { id: sessionId }, callId: 'le-rag-04', signal: new AbortController().signal });
const call = async (name, args = {}, sessionId = SESSION) => map.get(name).execute(args, exec(sessionId));

const scopeDb = join(PROFILE_ROOT, 'scopes', 'prj_01M7RBSRD33M26HGBEFW51WPP6', 'rag.sqlite3');
const auditCount = () => {
  const db = new DatabaseSync(scopeDb, { readOnly: true });
  const row = db.prepare('select count(*) n from audit').get();
  db.close();
  return row.n;
};

const steps = [];
const step = (name, value) => steps.push({ step: name, ...value });
const before = auditCount();
step('audit-antes', { filas: before });

// 1 · list
const list = await call('list', { limit: 5 });
step('list', { total: list.total, filas: list.rows.length, primera: list.rows[0]?.uri ?? null });

// 2 · search
const search = await call('search', { query: 'proyecto aware', limit: 5 });
step('search', { resultados: search.results.length, fuentes: new Set(search.results.map((r) => r.sourceId)).size, primera: search.results[0]?.uri ?? null });

// 3 · context
const context = await call('context', { query: 'proyecto aware', maxTokens: 400 });
step('context', { citas: context.citations?.length ?? 0, tokens: context.tokensEstimate ?? context.tokens ?? null });

// 4 · get
const target = list.rows[0].id;
const got = await call('get', { ref: target });
step('get', { uri: got.source?.uri ?? null, fragmentos: got.chunks?.length ?? 0 });

// 5 · ingest (fichero DENTRO de la copia)
// Fuera del almacén (el policy prohíbe ingerir rutas del propio store).
const fixtureDir = mkdtempSync(join(tmpdir(), 'lcr-le-rag-04-'));
const fixture = join(fixtureDir, 'fixture-le-rag-04.md');
writeFileSync(fixture, '# Fixture LE-RAG-04\n\nclave-unica-9472 trazabilidad de prueba\n', 'utf8');
const ing = await call('ingest', { paths: [fixture] });
step('ingest', { ingeridas: ing.ingested?.length ?? 0, fragmentos: ing.ingested?.[0]?.chunks ?? null, errores: ing.errors?.length ?? 0 });
const nuevoId = ing.ingested?.[0]?.id ?? null;

const dup = await call('ingest', { paths: [fixture] });
step('ingest-duplicado', { omitidas: dup.skipped?.length ?? 0, motivo: dup.skipped?.[0]?.reason ?? null });

// 6 · reindex
const re = await call('reindex', { operation: 'fts' });
step('reindex', { claves: Object.keys(re) });

// 7 · forget
const del = await call('forget', { ref: nuevoId ?? target });
const afterForget = await call('search', { query: 'clave-unica-9472', limit: 5 });
step('forget', { borrada: del.sourceId ?? null, sigueVisible: afterForget.results.some((r) => r.sourceId === (nuevoId ?? target)) });

// Errores y aislamiento
let errInexistente; try { await call('get', { ref: 'src_noexiste' }); errInexistente = { ok: true }; } catch (e) { errInexistente = { ok: false, code: e.code }; }
step('get-inexistente', errInexistente);
let otraSesion; try { otraSesion = { ok: true, filas: (await call('list', {}, 'sesion-ajena')).rows.length }; } catch (e) { otraSesion = { ok: false, code: e.code }; }
step('aislamiento-sesion-ajena', otraSesion);

const after = auditCount();
step('audit-despues', { filas: after, delta: after - before });

console.log(JSON.stringify({ ok: true, config: { diversity: config.search.diversity, limit: config.search.limit }, dataRoot: DATA_ROOT, ragRootDefault: ragRoot(services.env), steps }, null, 1));
