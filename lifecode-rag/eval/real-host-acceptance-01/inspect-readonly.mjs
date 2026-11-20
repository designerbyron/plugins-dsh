/**
 * Inspección de SÓLO LECTURA del perfil real `desktop`, sobre una copia del almacén.
 *
 * No abre los ficheros reales: la copia se hace antes con `cp`. Así el almacén real no puede cambiar
 * ni por el `-shm` de WAL. Las consultas usan las mismas funciones de producción que sólo leen
 * (`ftsSearch`, `getSource`, `assembleContext`).
 */
import { DatabaseSync } from 'node:sqlite';

import { ftsSearch, getSource } from '../../lib/search.mjs';
import { assembleContext, estimateTokens } from '../../lib/context.mjs';
import { validateConfig } from '../../lib/paths.mjs';

const [snapshot, registryFile, scopeFile, query] = process.argv.slice(2);
const config = validateConfig({});
const out = {};

const reg = new DatabaseSync(registryFile, { readOnly: true });
try {
  out.proyectos = reg.prepare('SELECT id, name, status, created_at FROM projects').all();
  out.raices = reg.prepare('SELECT id, scope_kind, scope_id, path, path_key, state, added_by FROM roots').all();
  out.sesiones = reg.prepare(`SELECT session_id, project_id, state, selection_source, selected_by, revision, updated_at
                                FROM session_scope ORDER BY updated_at DESC LIMIT 5`).all();
  out.auditoriaRegistro = reg.prepare('SELECT COUNT(*) AS n FROM audit_registry').get().n;
} finally { reg.close(); }

const db = new DatabaseSync(scopeFile, { readOnly: true });
try {
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  out.almacen = {
    sources: count('SELECT COUNT(*) AS n FROM sources'),
    chunks: count('SELECT COUNT(*) AS n FROM chunks'),
    vectors: count('SELECT COUNT(*) AS n FROM vectors'),
    audit: count('SELECT COUNT(*) AS n FROM audit'),
    indexRevision: db.prepare("SELECT value FROM meta WHERE key = 'index_revision'").get()?.value ?? null,
    quickCheck: db.prepare('PRAGMA quick_check').all().map((r) => r.quick_check),
  };

  out.herramientasEnAuditoria = db.prepare(`SELECT tool, action, outcome, COUNT(*) AS n
      FROM audit WHERE tool IS NOT NULL GROUP BY tool, action, outcome ORDER BY n DESC LIMIT 15`).all();
  out.ultimaAuditoria = db.prepare('SELECT seq, at, tool, action, outcome FROM audit ORDER BY seq DESC LIMIT 3').all();

  const rows = ftsSearch(db, { query, limit: 5 });
  out.busqueda = {
    consulta: query,
    hits: rows.length,
    resultados: rows.map((r) => ({
      sourceId: r.source_id,
      uri: String(r.uri).split(/[\\/]/).slice(-2).join('/'),
      title: r.title,
      heading: r.heading ?? null,
      score: Math.round((r.bm25 ?? 0) * 1000) / 1000,
      snippet: String(r.snippet ?? '').replace(/\s+/g, ' ').slice(0, 160),
    })),
  };

  if (rows.length > 0) {
    const ref = rows[0].source_id;
    const source = getSource(db, ref);
    out.recuperacion = {
      ref,
      uri: String(source.uri).split(/[\\/]/).slice(-2).join('/'),
      title: source.title,
      mime: source.mime,
      bytes: source.bytes,
      chunks: source.chunks ?? null,
      hasText: Boolean(source.text && source.text.length > 0),
    };
  }

  const ctx = assembleContext({ results: rows, config, budgetTokens: 1200 });
  out.contexto = {
    citas: ctx.citations?.length ?? 0,
    tokens: ctx.tokens ?? null,
    estimadoDelTexto: ctx.text ? estimateTokens(ctx.text) : null,
    truncado: ctx.truncated === true,
    fuentesCitadas: [...new Set((ctx.citations ?? []).map((c) => String(c.uri).split(/[\\/]/).slice(-2).join('/')))],
  };
} finally { db.close(); }

console.log(JSON.stringify({ snapshot, ...out }, null, 1));
