/**
 * Aceptación end-to-end de las siete herramientas sobre un mundo PA aislado (helpers del proyecto).
 * No toca `~/.dsh`: la raíz sale de `LIFECODE_RAG_ROOT` del mundo temporal.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fakeExec, makeWorld, servicesFor } from '../../tests/pa3-helpers.mjs';
import { createToolDefinitions } from '../../lib/tools.mjs';
import { invalidateSession } from '../../lib/sessions.mjs';

const world = await makeWorld();
const out = [];
const step = (name, value) => out.push({ step: name, ...value });

function toolsFor(sessionId) {
  const services = servicesFor(world, { sessionId });
  const defs = createToolDefinitions({ config: world.config, root: world.root, services });
  const map = new Map(defs.map((d) => [d.name.replace('lifecode_rag_', ''), d]));
  const exec = fakeExec(sessionId);
  return async (name, args = {}) => {
    const def = map.get(name);
    if (!def) throw new Error('herramienta ausente: ' + name);
    return def.execute(args, exec);
  };
}

const call = toolsFor('sesion-a');

try {
  const list0 = await call('list', {});
  step('list', { claves: Object.keys(list0), total: list0.total ?? null, filas: (list0.rows ?? []).length, primeraUri: list0.rows?.[0]?.uri ?? null });

  const s1 = await call('search', { query: 'alfa', limit: 5 });
  step('search', { resultados: s1.results.length, primera: s1.results[0]?.uri ?? null, tieneSnippet: Boolean(s1.results[0]?.snippet) });

  const ctx = await call('context', { query: 'alfa exclusiva', maxTokens: 300 });
  step('context', { claves: Object.keys(ctx), citas: ctx.citations?.length ?? 0, tokens: ctx.tokensEstimate ?? ctx.tokens ?? ctx.tokenEstimate ?? null, primeraCita: ctx.citations?.[0]?.uri ?? null });

  const id = list0.rows[0].id;
  const got = await call('get', { ref: id });
  step('get', { uri: got.source?.uri ?? null, fragmentos: got.chunks?.length ?? null });

  let missing;
  try { missing = { ok: true, valor: await call('get', { ref: 'src_noexiste' }) }; }
  catch (e) { missing = { ok: false, code: e.code }; }
  step('get-inexistente', missing);

  let empty;
  try { empty = { ok: true, resultados: (await call('search', { query: '   ' })).results?.length ?? null }; }
  catch (e) { empty = { ok: false, code: e.code }; }
  step('search-vacia', empty);

  const nuevo = join(world.dirA, 'nuevo.md');
  writeFileSync(nuevo, '# Nuevo\n\ncontenido nuevo sobre trazabilidad\n', 'utf8');
  const ing = await call('ingest', { paths: [nuevo] });
  step('ingest', { claves: Object.keys(ing), ingeridas: ing.ingested?.length ?? null, fragmentos: ing.ingested?.[0]?.chunks ?? null, errores: ing.errors?.length ?? null });

  const dup = await call('ingest', { paths: [nuevo] });
  step('ingest-duplicado', { ingeridas: dup.ingested?.length ?? null, omitidas: dup.skipped?.length ?? null, clavesOmitida: dup.skipped?.[0] ? Object.keys(dup.skipped[0]) : [] });

  const re = await call('reindex', { operation: 'fts' });
  step('reindex', { claves: Object.keys(re) });

  const nuevoId = ing.ingested?.[0]?.id ?? ((await call('list', {})).rows ?? []).find((row) => String(row.uri).endsWith('nuevo.md'))?.id ?? null;
  const del = await call('forget', { ref: nuevoId });
  const after = await call('search', { query: 'trazabilidad', limit: 5 });
  step('forget', { claves: Object.keys(del), borrada: del.sourceId ?? null, aparicionesDeLaBorrada: after.results.filter((r) => r.sourceId === nuevoId).length, resultadosTotales: after.results.length });

  const callB = toolsFor('sesion-b');
  let cross;
  try { cross = { ok: true, uri: (await callB('get', { ref: id })).source?.uri ?? null }; }
  catch (e) { cross = { ok: false, code: e.code }; }
  step('aislamiento-get', cross);

  const listB = await callB('list', {});
  step('aislamiento-list', { total: listB.total ?? null, uris: (listB.rows ?? []).map((s) => s.uri) });

  world.withRegistry((db) => invalidateSession(db, {
    identity: { sessionId: 'sesion-a', profileKey: 'pa3-test' },
    expectedProfileKey: 'pa3-test',
    actor: 'human',
    reason: 'admin',
  }));
  let invalid;
  try { invalid = { ok: true, resultados: (await call('search', { query: 'alfa' })).results?.length ?? null }; }
  catch (e) { invalid = { ok: false, code: e.code }; }
  step('sesion-invalidada', invalid);

  console.log(JSON.stringify({ ok: true, pasos: out.length, out }, null, 1));
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error.code, message: error.message, out }, null, 1));
  process.exitCode = 1;
} finally {
  world.cleanup();
}
