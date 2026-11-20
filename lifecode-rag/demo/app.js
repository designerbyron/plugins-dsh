const API = '/lifecode-rag/api';
const TABS = [
  ['resumen', 'Resumen'],
  ['fuentes', 'Fuentes'],
  ['buscar', 'Buscar'],
  ['contexto', 'Contexto'],
  ['metricas', 'Métricas'],
  ['configuracion', 'Configuración'],
  ['salud', 'Salud'],
];

const state = { snapshot: null, tab: 'resumen', query: '', source: null, error: '', notice: '', search: null, context: null, series: null, metric: 'query.ms' };

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const banner = document.getElementById('banner');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const num = (value) => new Intl.NumberFormat('es-ES').format(value ?? 0);
const bytes = (value) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};
const when = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
};

const snippet = (value) => esc(String(value ?? '').replace(/\*\*/g, '')).replace(/\[([^\]]*)\]/g, '<mark>$1</mark>');

async function api(path, options = {}) {
  const headers = { accept: 'application/json' };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['x-lifecode-rag'] = '1';
  }
  const response = await fetch(API + path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error?.message || `HTTP ${response.status}`);
    error.code = data?.error?.code;
    throw error;
  }
  return data && data.ok === true && 'data' in data ? data.data : data;
}

function fail(error) {
  state.error = error?.code ? `${error.message} (${error.code})` : String(error?.message || error);
  render();
}

function ok(message) {
  state.notice = message;
  state.error = '';
  render();
}

async function loadSnapshot() {
  try {
    state.snapshot = await api('/snapshot');
    state.error = '';
  } catch (error) {
    state.error = error?.code ? `${error.message} (${error.code})` : String(error?.message || error);
  }
  render();
}

/* ------------------------------------------------------------------ vistas */

function card(title, body, extra = '') {
  return `<section class="lcr-card"><header class="lcr-card__head"><h2 class="lcr-card__title">${esc(title)}</h2>${extra}</header><div class="lcr-card__body">${body}</div></section>`;
}

function empty(title, hint) {
  return `<div class="lcr-empty"><p class="lcr-empty__title">${esc(title)}</p>${hint ? `<p class="lcr-empty__hint">${esc(hint)}</p>` : ''}</div>`;
}

function viewOverview() {
  const snapshot = state.snapshot;
  if (!snapshot) return `<p class="lcr-muted">Cargando…</p>`;
  const counts = snapshot.counts || {};
  const health = snapshot.health || { ok: false, checks: [] };
  const store = snapshot.store || {};
  const stats = [['Fuentes', counts.sources], ['Fragmentos', counts.chunks], ['Vectores', counts.vectors], ['Etiquetas', counts.tags], ['Colecciones', counts.collections]];
  return `
    <div class="lcr-stats">${stats.map(([label, value]) => `<div class="lcr-stat"><span class="lcr-stat__label">${esc(label)}</span><strong class="lcr-stat__value">${num(value)}</strong></div>`).join('')}</div>
    <div class="lcr-grid">
      ${card('Almacén', `<dl class="lcr-kv"><dt>Ruta</dt><dd class="lcr-mono">${esc(store.path)}</dd><dt>Base de datos</dt><dd>${bytes(store.databaseBytes)}</dd><dt>Auditoría</dt><dd>${bytes(store.auditBytes)}</dd><dt>Estado</dt><dd>${store.initialized ? 'inicializado' : 'sin inicializar'}</dd></dl>`)}
      ${card('Salud', `${health.ok ? '<span class="lcr-chip lcr-chip--ok">todo en orden</span>' : '<span class="lcr-chip lcr-chip--bad">revisar</span>'}<ul class="lcr-checks">${(health.checks || []).map((check) => `<li class="lcr-check"><span class="lcr-dot lcr-dot--${check.status === 'ok' ? 'ok' : check.status === 'warn' ? 'warn' : 'bad'}"></span><span>${esc(check.name)}</span><span class="lcr-muted">${esc(check.status)}</span></li>`).join('')}</ul>`)}
    </div>
    ${card('Actividad reciente', (snapshot.activity?.recent || []).length === 0
      ? empty('Sin actividad todavía', 'Indexa una fuente para empezar.')
      : `<ul class="lcr-activity">${snapshot.activity.recent.map((event) => `<li><span class="lcr-mono lcr-muted">${esc(when(event.at))}</span><span>${esc(event.action)}</span><span class="lcr-muted">${esc(event.target || '')}</span></li>`).join('')}</ul>`)}
  `;
}

function viewSources() {
  if (state.source) {
    const detail = state.source;
    return `
      <div class="lcr-row"><button class="lcr-btn lcr-btn--ghost" data-go="fuentes">← Fuentes</button><button class="lcr-btn lcr-btn--danger" data-action="forget" data-ref="${esc(detail.source.id)}">Olvidar fuente</button></div>
      ${card(detail.source.title || detail.source.id, `<dl class="lcr-kv"><dt>Id</dt><dd class="lcr-mono">${esc(detail.source.id)}</dd><dt>Ruta</dt><dd class="lcr-mono">${esc(detail.source.uri)}</dd><dt>Colección</dt><dd>${esc(detail.source.collection || '—')}</dd><dt>Actualizada</dt><dd>${esc(when(detail.source.updatedAt))}</dd></dl>`)}
      ${card('Fragmentos', `<ul class="lcr-chunks">${(detail.chunks || []).map((chunk) => `<li class="lcr-chunk"><div class="lcr-chunk__head"><span class="lcr-mono">#${chunk.ordinal}</span><span class="lcr-muted">${esc(chunk.heading || '')}</span></div><p class="lcr-chunk__text">${esc(chunk.text)}</p></li>`).join('')}</ul>`)}
    `;
  }
  const rows = state.sources || [];
  return `
    ${card('Añadir fuente', `
      <form class="lcr-form" data-form="ingest">
        <label class="lcr-field"><span>Ruta del proyecto</span><input class="lcr-input lcr-mono" name="path" placeholder="demo/corpus/arquitectura.md"></label>
        <label class="lcr-field"><span>Colección (opcional)</span><input class="lcr-input" name="collection" placeholder="documentacion"></label>
        <button class="lcr-btn" type="submit">Indexar</button>
      </form>
      <p class="lcr-hint">Acepta ficheros o carpetas. Las rutas protegidas se rechazan enteras, sin escribir nada.</p>`)}
    ${card('Fuentes', rows.length === 0 ? empty('Sin fuentes', 'Añade una ruta para construir el índice.') : `
      <table class="lcr-table"><thead><tr><th>Título</th><th>Colección</th><th class="lcr-num">Fragmentos</th><th>Actualizada</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td><button class="lcr-link" data-source="${esc(row.id)}">${esc(row.title || row.id)}</button><div class="lcr-mono lcr-muted lcr-small">${esc(row.uri)}</div></td><td>${esc(row.collection || '—')}</td><td class="lcr-num">${num(row.chunks)}</td><td>${esc(when(row.updatedAt))}</td></tr>`).join('')}</tbody></table>`, '<button class="lcr-btn lcr-btn--ghost" data-refresh="sources">Actualizar</button>')}
  `;
}

function viewSearch() {
  const result = state.search;
  return `
    ${card('Buscar en el conocimiento', `
      <form class="lcr-search" data-form="search">
        <input class="lcr-input" name="query" value="${esc(state.query)}" placeholder="¿Qué necesitas saber?" aria-label="Consulta">
        <select class="lcr-select" name="strategy"><option value="hybrid">Híbrida</option><option value="fts">Léxica</option><option value="vector">Vectorial</option></select>
        <button class="lcr-btn" type="submit">Buscar</button>
      </form>`)}
    ${result ? card(`${result.results.length} resultado(s)`, result.results.length === 0
      ? empty('Sin resultados', 'Prueba otra formulación o revisa que la fuente esté indexada.')
      : `<ul class="lcr-results">${result.results.map((row) => `<li class="lcr-result"><div class="lcr-result__head"><strong>${esc(row.title || row.sourceId)}</strong>${row.heading && row.heading !== row.title ? `<span class="lcr-muted"> › ${esc(row.heading)}</span>` : ''}<span class="lcr-score">${(row.score ?? 0).toFixed(3)}</span></div><p class="lcr-result__text">${snippet(row.snippet)}</p><div class="lcr-row lcr-row--end"><span class="lcr-mono lcr-muted lcr-small">${esc(row.chunkKey)}</span></div></li>`).join('')}</ul>`,
      `<span class="lcr-muted lcr-small">${esc(result.diagnostics?.strategy || result.mode)} · ${result.elapsedMs ?? 0} ms</span>`) : empty('Empieza con una consulta', 'La búsqueda usa el mismo motor que las herramientas del modelo.')}
  `;
}

function viewContext() {
  const result = state.context;
  return `
    ${card('Ensamblar contexto', `
      <form class="lcr-form lcr-form--inline" data-form="context">
        <input class="lcr-input" name="query" value="${esc(state.query)}" placeholder="Consulta" aria-label="Consulta">
        <input class="lcr-input lcr-input--num" name="budget" type="number" min="100" max="8000" step="100" value="2000" aria-label="Presupuesto">
        <button class="lcr-btn" type="submit">Construir</button>
      </form>
      <p class="lcr-hint">Presupuesto en tokens estimados. Si el primer fragmento no cabe, se devuelve vacío y marcado como truncado.</p>`)}
    ${result ? `<div class="lcr-grid">${card(`Contexto · ${num(result.tokens)} tokens${result.truncated ? ' · truncado' : ''}`, result.text ? `<pre class="lcr-context">${esc(result.text)}</pre>` : empty('Sin contexto que quepa', 'Reduce los fragmentos o aumenta el presupuesto.'))}${card('Procedencia', `<ol class="lcr-citations">${(result.citations || []).map((citation) => `<li><span class="lcr-mono">[${citation.n}] ${esc(citation.chunkKey)}</span><div>${esc(citation.title || citation.uri)}</div></li>`).join('')}</ol>`)}</div>` : empty('Sin contexto todavía', 'Lanza una consulta para ver citas y presupuesto.')}
  `;
}

function viewMetrics() {
  const snapshot = state.snapshot || {};
  const rows = Array.isArray(snapshot.metrics) ? snapshot.metrics : [];
  const points = Array.isArray(state.series) ? state.series : (state.series?.points || []);
  const max = Math.max(1, ...points.map((point) => Number(point.value) || 0));
  return `
    ${card('Agregados (últimos 7 días)', rows.length === 0 ? empty('Sin métricas todavía', 'Se registran al buscar, indexar y construir contexto.') : `
      <table class="lcr-table"><thead><tr><th>Métrica</th><th>Dimensión</th><th class="lcr-num">Total</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td class="lcr-mono">${esc(row.metric)}</td><td>${esc(row.dim || '—')}</td><td class="lcr-num">${num(row.total)}</td></tr>`).join('')}</tbody></table>`)}
    ${card('Serie', points.length === 0 ? `<p class="lcr-muted">Sin datos para esa métrica.</p>` : `<div class="lcr-bars">${points.map((point) => `<div class="lcr-bar"><div class="lcr-bar__track"><div class="lcr-bar__fill" style="height:${Math.max(4, (Number(point.value) / max) * 100)}%"></div></div><span class="lcr-muted lcr-small">${esc(String(point.day).slice(5))}</span></div>`).join('')}</div>`, `<select class="lcr-select" data-metric>${['query.ms', 'query.count', 'ingest.documents', 'context.tokens', 'automation.runs'].map((name) => `<option value="${name}" ${state.metric === name ? 'selected' : ''}>${name}</option>`).join('')}</select>`)}
  `;
}

function viewSettings() {
  const config = state.snapshot?.config || {};
  const roots = (config.automation?.watchRoots || []).join('\n');
  return `
    ${card('Búsqueda y automatización', `<form class="lcr-form" data-form="config">
      <label class="lcr-field"><span>Estrategia por defecto</span><select class="lcr-select" name="strategy"><option value="hybrid" ${config.strategy === 'hybrid' ? 'selected' : ''}>Híbrida</option><option value="fts" ${config.strategy === 'fts' ? 'selected' : ''}>Sólo léxica</option><option value="vector" ${config.strategy === 'vector' ? 'selected' : ''}>Sólo vectorial</option></select></label>
      <label class="lcr-field"><span>Resultados por consulta</span><input class="lcr-input lcr-input--num" name="limit" type="number" min="1" max="50" value="${config.limit ?? 8}"></label>
      <p class="lcr-hint">Embeddings: ${esc(config.embedding?.provider || 'local-hash-v1')} · ${esc(String(config.embedding?.dim || 256))} dims · ${config.embedding?.kind === 'semantic' ? 'semántico' : 'léxico (hash de tokens)'}. La calidad semántica requiere un proveedor neural aprobado.</p>
      <label class="lcr-toggle"><input type="checkbox" name="enabled" ${config.automation?.enabled ? 'checked' : ''}><span>Indexar automáticamente las carpetas vigiladas</span></label>
      <label class="lcr-field"><span>Carpetas vigiladas (una por línea)</span><textarea class="lcr-input lcr-mono" name="roots" rows="3">${esc(roots)}</textarea></label>
      <button class="lcr-btn" type="submit">Guardar configuración</button>
    </form>
    <p class="lcr-hint">La automatización no puede aprobar operaciones sensibles: olvidar fuentes y reindexar exigen confirmación explícita. Los cambios se aplican al recargar el plugin.</p>`)}
  `;
}

function viewHealth() {
  const snapshot = state.snapshot || {};
  const health = snapshot.health || { ok: false, checks: [] };
  const store = snapshot.store || {};
  return `
    ${card('Comprobaciones', `<ul class="lcr-checks">${(health.checks || []).map((check) => `<li class="lcr-check"><span class="lcr-dot lcr-dot--${check.status === 'ok' ? 'ok' : check.status === 'warn' ? 'warn' : 'bad'}"></span><span>${esc(check.name)}</span><span class="lcr-muted">${esc(check.detail || check.status)}</span></li>`).join('')}</ul>`)}
    ${card('Diagnóstico', `<dl class="lcr-kv"><dt>Versión de esquema</dt><dd>${store.schemaVersion ?? '—'}</dd><dt>Base de datos</dt><dd class="lcr-mono">${esc(store.path || '—')}</dd><dt>Tamaño</dt><dd>${bytes(store.databaseBytes)}</dd></dl>`)}
  `;
}

/* ------------------------------------------------------------------ render */

function render() {
  tabs.innerHTML = TABS.map(([id, label]) => `<button class="lcr-tab${state.tab === id ? ' lcr-tab--active' : ''}" role="tab" aria-selected="${state.tab === id}" data-tab="${id}">${label}</button>`).join('');
  banner.innerHTML = state.error
    ? `<div class="lcr-error" role="alert">${esc(state.error)}</div>`
    : state.notice ? `<p class="lcr-ok">${esc(state.notice)}</p>` : '';
  let html = '';
  if (state.tab === 'resumen') html = viewOverview();
  else if (state.tab === 'fuentes') html = viewSources();
  else if (state.tab === 'buscar') html = viewSearch();
  else if (state.tab === 'contexto') html = viewContext();
  else if (state.tab === 'metricas') html = viewMetrics();
  else if (state.tab === 'configuracion') html = viewSettings();
  else html = viewHealth();
  view.innerHTML = html;
}

async function go(tab) {
  state.tab = tab;
  state.error = '';
  state.notice = '';
  if (tab === 'fuentes' && !state.sources) state.sources = (await api('/sources')).rows || [];
  if (tab === 'metricas') state.series = await api(`/metrics/series?metric=${encodeURIComponent(state.metric)}&days=7`).catch(() => null);
  render();
}

/* ----------------------------------------------------------------- acciones */

document.addEventListener('click', async (event) => {
  const target = event.target.closest('button, [data-metric]');
  if (!target) return;
  try {
    if (target.dataset.tab) { await go(target.dataset.tab); return; }
    if (target.dataset.go) { state.tab = target.dataset.go; await go(target.dataset.go); return; }
    if (target.dataset.refresh === 'sources') { state.sources = (await api('/sources')).rows; render(); return; }
    if (target.dataset.source) { state.source = await api(`/sources/${encodeURIComponent(target.dataset.source)}`); render(); return; }
    if (target.dataset.metric) { state.metric = target.dataset.metric; state.series = await api(`/metrics/series?metric=${encodeURIComponent(state.metric)}&days=7`); render(); return; }
    if (target.dataset.action === 'forget') {
      if (!confirm('Se eliminarán los fragmentos y vectores de esta fuente. ¿Continuar?')) return;
      await api('/actions', { method: 'POST', body: { action: 'forget', ref: target.dataset.ref, confirm: true } });
      state.source = null;
      state.sources = (await api('/sources')).rows;
      ok('Fuente olvidada.');
      return;
    }
  } catch (error) {
    fail(error);
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  try {
    if (form.dataset.form === 'search') {
      state.query = data.get('query');
      state.search = await api('/search', { method: 'POST', body: { query: state.query, strategy: data.get('strategy') } });
      location.hash = '#/buscar';
      render();
      return;
    }
    if (form.dataset.form === 'context') {
      state.query = data.get('query');
      state.context = await api('/context', { method: 'POST', body: { query: state.query, budgetTokens: Number(data.get('budget')) } });
      render();
      return;
    }
    if (form.dataset.form === 'ingest') {
      const path = String(data.get('path') || '').trim();
      if (!path) return;
      const result = await api('/actions', { method: 'POST', body: { action: 'ingest', paths: [path], collection: data.get('collection') || undefined } });
      state.sources = (await api('/sources')).rows;
      ok(`Indexados ${result.ingested ?? 0} · omitidos ${result.skipped ?? 0}${(result.errors || []).length ? ` · errores ${result.errors.length}` : ''}`);
      return;
    }
    if (form.dataset.form === 'config') {
      const watchRoots = String(data.get('roots') || '').split('\n').map((line) => line.trim()).filter(Boolean);
      await api('/config', { method: 'POST', body: { search: { strategy: data.get('strategy'), limit: Number(data.get('limit')) }, automation: { enabled: data.get('enabled') === 'on', watchRoots } } });
      state.snapshot = await api('/snapshot');
      ok('Configuración guardada.');
    }
  } catch (error) {
    fail(error);
  }
});

/* -------------------------------------------------------------------- init */

try {
  await loadSnapshot();
  const [wanted, sub] = (location.hash.replace(/^#\/?/, '') || 'resumen').split('/');
  state.tab = TABS.some(([id]) => id === wanted) ? wanted : 'resumen';
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  if (q) state.query = q;
  if (state.tab === 'fuentes') {
    state.sources = (await api('/sources')).rows || [];
    if (sub) state.source = await api(`/sources/${encodeURIComponent(sub)}`);
  }
  if (state.tab === 'buscar' && q) {
    state.search = await api('/search', { method: 'POST', body: { query: q, strategy: params.get('strategy') || 'hybrid' } });
  }
  if (state.tab === 'contexto' && q) {
    state.context = await api('/context', { method: 'POST', body: { query: q, budgetTokens: Number(params.get('budget') || 2000) } });
  }
  if (state.tab === 'metricas') {
    state.series = await api(`/metrics/series?metric=${encodeURIComponent(state.metric)}&days=7`).catch(() => null);
  }
  render();
} catch (error) {
  fail(error);
}
