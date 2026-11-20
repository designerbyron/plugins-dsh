/* LifeCode RAG — mitad cliente (pestaña del host).
 *
 * Módulo de cliente Cordis: React llega por el cargador del host, no por imports de
 * `@deepseek-ai/*`. La interfaz no tiene privilegios: no autoriza, no decide y no escribe.
 *
 * K1 (2026-11-19): el panel montado es el Project-Aware en **modo sintético** (fixtures). El código
 * heredado del Workspace v0.2 se conserva en este mismo fichero, pero queda inalcanzable: su capa de
 * red falla cerrada mientras `DATA_MODE` no sea 'live', y 'live' no está habilitado.
 */

window.__ModuleLoader__.load({
  id: '@local/lifecode-rag',
  factory(require) {
    const React = require('react');
    const el = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const API = '/lifecode-rag/api';
    const PANEL_ID = 'lifecode-rag';
    const SIDEBAR_SLOT = 'sidebar.panellist';
    const MAIN_SLOT = 'main';
    // Modo de datos del panel. 'fixture' = datos sintéticos, sin red. 'live' no está habilitado:
    // habilitarlo exige la integración de sesión que hoy no existe (PA01 BLOCKED). No hay ningún
    // control en la interfaz que cambie este valor.
    const DATA_MODE = 'fixture';

    /* ------------------------------------------------------------------ API */

    async function request(path, options = {}) {
      if (DATA_MODE !== 'live') {
        // K1: en modo sintético no se habla con ninguna API, ni con la heredada v0.2. Si algo
        // invocara esta capa, falla cerrado antes de tocar la red.
        const blocked = new Error('fixture-mode: sin acceso a la API del panel');
        blocked.code = 'fixture-mode';
        throw blocked;
      }
      const method = options.method || 'GET';
      const headers = { accept: 'application/json' };
      if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
        headers['x-lifecode-rag'] = '1';
      }
      const response = await fetch(API + path, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok) {
        if (response.status === 404 && !data?.error) {
          // Un perfil Project-Aware no monta la API del almacén v0.2 (cada proyecto vive en su
          // propio almacén y la superficie es la de las siete herramientas). Sin este caso el
          // panel mostraba un «Not Found (http-404)» que parecía un fallo del producto.
          const unavailable = new Error(
            'este perfil usa Project-Aware: el panel del almacén v0.2 no está disponible; usa las herramientas lifecode_rag_*',
          );
          unavailable.code = 'panel-unavailable';
          throw unavailable;
        }
        const error = new Error(data?.error?.message || `HTTP ${response.status}`);
        error.code = data?.error?.code || `http-${response.status}`;
        throw error;
      }
      return data;
    }

    const getSnapshot = () => request('/snapshot');
    const getSources = (query = '') => request(`/sources${query ? `?${query}` : ''}`);
    const getSource = (id) => request(`/sources/${encodeURIComponent(id)}`);
    const search = (payload) => request('/search', { method: 'POST', body: payload });
    const buildContext = (payload) => request('/context', { method: 'POST', body: payload });
    const action = (payload) => request('/actions', { method: 'POST', body: payload });
    const saveConfig = (patch) => request('/config', { method: 'POST', body: patch });
    const metricSeries = (metric, days = 7) => request(`/metrics/series?metric=${encodeURIComponent(metric)}&days=${days}`);

    /* --------------------------------------------------------------- helpers */

    function formatNumber(value) {
      return new Intl.NumberFormat('es-ES').format(value ?? 0);
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
      const units = ['B', 'kB', 'MB', 'GB'];
      const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
      return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
    }

    function formatTime(value) {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
    }

    function errorText(error) {
      if (!error) return '';
      if (error.code) return `${error.message} (${error.code})`;
      return error.message || String(error);
    }

    const TABS = [
      ['resumen', 'Resumen'],
      ['fuentes', 'Fuentes'],
      ['buscar', 'Buscar'],
      ['contexto', 'Contexto'],
      ['metricas', 'Métricas'],
      ['configuracion', 'Configuración'],
      ['salud', 'Salud'],
    ];

    /* ------------------------------------------------------------------- UI */

    function Chip({ tone = 'neutral', children }) {
      return el('span', { className: `lcr-chip lcr-chip--${tone}` }, children);
    }

    function Card({ title, extra, children }) {
      return el(
        'section',
        { className: 'lcr-card' },
        el('header', { className: 'lcr-card__head' },
          el('h3', { className: 'lcr-card__title' }, title),
          extra || null),
        el('div', { className: 'lcr-card__body' }, children),
      );
    }

    function Empty({ title, hint }) {
      return el('div', { className: 'lcr-empty' },
        el('p', { className: 'lcr-empty__title' }, title),
        hint ? el('p', { className: 'lcr-empty__hint' }, hint) : null);
    }

    function ErrorBox({ error, onRetry }) {
      if (!error) return null;
      return el('div', { className: 'lcr-error', role: 'alert' },
        el('span', null, error),
        onRetry ? el('button', { type: 'button', className: 'lcr-btn lcr-btn--ghost', onClick: onRetry }, 'Reintentar') : null);
    }

    function Confirm({ open, title, body, confirmLabel = 'Confirmar', onCancel, onConfirm }) {
      if (!open) return null;
      return el('div', { className: 'lcr-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        el('div', { className: 'lcr-modal__box' },
          el('h3', { className: 'lcr-modal__title' }, title),
          el('p', { className: 'lcr-modal__body' }, body),
          el('div', { className: 'lcr-modal__actions' },
            el('button', { type: 'button', className: 'lcr-btn lcr-btn--ghost', onClick: onCancel }, 'Cancelar'),
            el('button', { type: 'button', className: 'lcr-btn lcr-btn--danger', onClick: onConfirm }, confirmLabel))));
    }

    function Overview({ snapshot }) {
      const counts = snapshot?.counts || {};
      const health = snapshot?.health || { ok: false, checks: [] };
      const store = snapshot?.store || {};
      const stats = [
        ['Fuentes', counts.sources],
        ['Fragmentos', counts.chunks],
        ['Vectores', counts.vectors],
        ['Etiquetas', counts.tags],
        ['Colecciones', counts.collections],
      ];
      return el('div', { className: 'lcr-stack' },
        el('div', { className: 'lcr-stats' }, stats.map(([label, value]) =>
          el('div', { className: 'lcr-stat', key: label },
            el('span', { className: 'lcr-stat__label' }, label),
            el('strong', { className: 'lcr-stat__value' }, formatNumber(value))))),
        el('div', { className: 'lcr-grid' },
          el(Card, { title: 'Almacén' },
            el('dl', { className: 'lcr-kv' },
              el('dt', null, 'Ruta'), el('dd', { className: 'lcr-mono' }, store.path || '—'),
              el('dt', null, 'Base de datos'), el('dd', null, formatBytes(store.databaseBytes)),
              el('dt', null, 'Auditoría'), el('dd', null, formatBytes(store.auditBytes)),
              el('dt', null, 'Estado'), el('dd', null, store.initialized ? 'inicializado' : 'sin inicializar'))),
          el(Card, { title: 'Salud' },
            health.ok ? el(Chip, { tone: 'ok' }, 'todo en orden') : el(Chip, { tone: 'bad' }, 'revisar'),
            el('ul', { className: 'lcr-checks' }, (health.checks || []).map((check) =>
              el('li', { key: check.name, className: 'lcr-check' },
                el('span', { className: `lcr-dot lcr-dot--${check.status === 'ok' ? 'ok' : check.status === 'warn' ? 'warn' : 'bad'}`, 'aria-hidden': 'true' }),
                el('span', null, check.name),
                el('span', { className: 'lcr-muted' }, check.status))))),
        el(Card, { title: 'Actividad reciente' },
          (snapshot?.activity?.recent || []).length === 0
            ? el(Empty, { title: 'Sin actividad todavía', hint: 'Indexa una fuente para empezar.' })
            : el('ul', { className: 'lcr-activity' },
                (snapshot.activity.recent || []).map((event) =>
                  el('li', { key: `${event.seq}-${event.at}` },
                    el('span', { className: 'lcr-mono lcr-muted' }, formatTime(event.at)),
                    el('span', null, event.action),
                    el('span', { className: 'lcr-muted' }, event.target || '')))))));
    }

    function SourceDetail({ id, onBack, onChanged }) {
      const [detail, setDetail] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const [confirm, setConfirm] = useState(false);
      const [chunks, setChunks] = useState(20);

      const load = useCallback(async () => {
        setError('');
        try {
          setDetail(await getSource(id));
        } catch (failure) {
          setError(errorText(failure));
        }
      }, [id]);

      useEffect(() => { void load(); }, [load]);

      const forget = async () => {
        setBusy(true);
        try {
          await action({ action: 'forget', ref: id, confirm: true });
          setConfirm(false);
          onChanged();
          onBack();
        } catch (failure) {
          setError(errorText(failure));
        } finally {
          setBusy(false);
        }
      };

      if (error && !detail) return el('div', null, el(ErrorBox, { error, onRetry: load }), el('button', { type: 'button', className: 'lcr-btn lcr-btn--ghost', onClick: onBack }, 'Volver'));
      if (!detail) return el('p', { className: 'lcr-muted' }, 'Cargando fuente…');

      const source = detail.source || detail;
      return el('div', { className: 'lcr-stack' },
        el('div', { className: 'lcr-row' },
          el('button', { type: 'button', className: 'lcr-btn lcr-btn--ghost', onClick: onBack }, '← Fuentes'),
          el('button', { type: 'button', className: 'lcr-btn lcr-btn--danger', onClick: () => setConfirm(true), disabled: busy }, 'Olvidar fuente')),
        el(Card, { title: source.title || source.id },
          el('dl', { className: 'lcr-kv' },
            el('dt', null, 'Id'), el('dd', { className: 'lcr-mono' }, source.id),
            el('dt', null, 'Ruta'), el('dd', { className: 'lcr-mono' }, source.uri),
            el('dt', null, 'Colección'), el('dd', null, source.collection || '—'),
            el('dt', null, 'Actualizada'), el('dd', null, formatTime(source.updatedAt)),
            el('dt', null, 'Etiquetas'), el('dd', null, (source.tags || []).join(', ') || '—')),
          el(ErrorBox, { error })),
        el(Card, { title: 'Fragmentos' },
          el('ul', { className: 'lcr-chunks' }, (detail.chunks || []).slice(0, chunks).map((chunk) =>
            el('li', { key: chunk.ordinal, className: 'lcr-chunk' },
              el('div', { className: 'lcr-chunk__head' },
                el('span', { className: 'lcr-mono' }, `#${chunk.ordinal}`),
                el('span', { className: 'lcr-muted' }, chunk.heading || '')),
              el('p', { className: 'lcr-chunk__text' }, chunk.text)))),
          (detail.chunks || []).length > chunks
            ? el('button', { type: 'button', className: 'lcr-btn lcr-btn--ghost', onClick: () => setChunks((n) => n + 30 ) }, 'Mostrar más')
            : null),
        el(Confirm, {
          open: confirm,
          title: 'Olvidar fuente',
          body: `Se eliminarán ${formatNumber(source.chunks)} fragmentos y sus vectores. La acción queda auditada y no se puede deshacer.`,
          confirmLabel: busy ? 'Eliminando…' : 'Eliminar',
          onCancel: () => setConfirm(false),
          onConfirm: forget,
        }));
    }

    function Sources({ onChanged }) {
      const [rows, setRows] = useState(null);
      const [error, setError] = useState('');
      const [selected, setSelected] = useState(null);
      const [path, setPath] = useState('');
      const [collection, setCollection] = useState('');
      const [busy, setBusy] = useState(false);
      const [notice, setNotice] = useState('');

      const load = useCallback(async () => {
        setError('');
        try {
          const data = await getSources();
          setRows(data.rows || []);
        } catch (failure) {
          setError(errorText(failure));
        }
      }, []);

      useEffect(() => { void load(); }, [load]);

      const ingest = async () => {
        if (!path.trim()) {
          setError('Indica una ruta de fichero o carpeta.');
          return;
        }
        setBusy(true);
        setError('');
        setNotice('');
        try {
          const result = await action({ action: 'ingest', paths: [path.trim()], collection: collection.trim() || undefined });
          const failed = (result.errors || []).length;
          setNotice(`Indexados ${result.ingested ?? 0} · omitidos ${result.skipped ?? 0}${failed ? ` · errores ${failed}` : ''}`);
          if (failed) setError(result.errors.map((item) => `${item.path}: ${item.code}`).join('\n'));
          setPath('');
          await load();
          onChanged?.();
        } catch (failure) {
          setError(errorText(failure));
        } finally {
          setBusy(false);
        }
      };

      if (selected) return el(SourceDetail, { id: selected, onBack: () => setSelected(null), onChanged: load });

      return el('div', { className: 'lcr-stack' },
        el(Card, { title: 'Añadir fuente' },
          el('div', { className: 'lcr-form' },
            el('label', { className: 'lcr-field' },
              el('span', null, 'Ruta del proyecto'),
              el('input', { className: 'lcr-input lcr-mono', value: path, onChange: (event) => setPath(event.target.value), placeholder: 'docs/ o C:\\\\ruta\\\\a\\\\carpeta' })),
            el('label', { className: 'lcr-field' },
              el('span', null, 'Colección (opcional)'),
              el('input', { className: 'lcr-input', value: collection, onChange: (event) => setCollection(event.target.value), placeholder: 'documentacion' })),
            el('button', { type: 'button', className: 'lcr-btn', onClick: ingest, disabled: busy }, busy ? 'Indexando…' : 'Indexar')),
          el('p', { className: 'lcr-hint' }, 'Se permiten ficheros o carpetas. Los directorios del sistema y las rutas protegidas se rechazan enteras, sin escribir nada.'),
          notice ? el('p', { className: 'lcr-ok' }, notice) : null,
          el(ErrorBox, { error })),
        el(Card, {
          title: 'Fuentes',
          extra: el('button', { type: 'button', className: 'lcr-btn lcr-btn--ghost', onClick: load }, 'Actualizar'),
        },
          rows === null
            ? el('p', { className: 'lcr-muted' }, 'Cargando…')
            : rows.length === 0
              ? el(Empty, { title: 'Sin fuentes', hint: 'Añade una ruta para construir el índice.' })
              : el('table', { className: 'lcr-table' },
                  el('thead', null, el('tr', null,
                    el('th', { scope: 'col' }, 'Título'),
                    el('th', { scope: 'col' }, 'Colección'),
                    el('th', { scope: 'col', className: 'lcr-num' }, 'Fragmentos'),
                    el('th', { scope: 'col' }, 'Actualizada'))),
                  el('tbody', null, rows.map((row) =>
                    el('tr', { key: row.id },
                      el('td', null,
                        el('button', { type: 'button', className: 'lcr-link', onClick: () => setSelected(row.id) }, row.title || row.id),
                        el('div', { className: 'lcr-mono lcr-muted lcr-small' }, row.uri)),
                      el('td', null, row.collection || '—'),
                      el('td', { className: 'lcr-num' }, formatNumber(row.chunks)),
                      el('td', null, formatTime(row.updatedAt))))))));
    }

    function Search({ onContext }) {
      const [query, setQuery] = useState('');
      const [strategy, setStrategy] = useState('hybrid');
      const [limit, setLimit] = useState(8);
      const [result, setResult] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);

      const run = async () => {
        if (!query.trim()) return;
        setBusy(true);
        setError('');
        try {
          setResult(await search({ query: query.trim(), strategy, limit }));
        } catch (failure) {
          setError(errorText(failure));
        } finally {
          setBusy(false);
        }
      };

      const rows = result?.results || [];
      return el('div', { className: 'lcr-stack' },
        el(Card, { title: 'Buscar en el conocimiento' },
          el('div', { className: 'lcr-search' },
            el('input', {
              className: 'lcr-input',
              value: query,
              placeholder: '¿Qué necesitas saber?',
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') void run(); },
            }),
            el('select', { className: 'lcr-select', value: strategy, onChange: (event) => setStrategy(event.target.value) },
              el('option', { value: 'hybrid' }, 'Híbrida'),
              el('option', { value: 'fts' }, 'Léxica'),
              el('option', { value: 'vector' }, 'Vectorial')),
            el('select', { className: 'lcr-select', value: String(limit), onChange: (event) => setLimit(Number(event.target.value)) },
              [5, 8, 12, 20].map((n) => el('option', { key: n, value: String(n) }, `${n} resultados`))),
            el('button', { type: 'button', className: 'lcr-btn', onClick: run, disabled: busy }, busy ? 'Buscando…' : 'Buscar')),
          el(ErrorBox, { error })),
        result
          ? el(Card, {
              title: `${rows.length} resultado(s)`,
              extra: el('span', { className: 'lcr-muted lcr-small' }, `${result.diagnostics?.strategy || result.mode} · ${result.elapsedMs ?? 0} ms`),
            },
              rows.length === 0
                ? el(Empty, { title: 'Sin resultados', hint: 'Prueba otra formulación o revisa que la fuente esté indexada.' })
                : el('ul', { className: 'lcr-results' }, rows.map((row) =>
                    el('li', { key: row.chunkKey, className: 'lcr-result' },
                      el('div', { className: 'lcr-result__head' },
                        el('strong', null, row.title || row.sourceId),
                        row.heading && row.heading !== row.title ? el('span', { className: 'lcr-muted' }, ` › ${row.heading}`) : null,
                        el('span', { className: 'lcr-score' }, Number(row.score ?? 0).toFixed(3))),
                      el('p', { className: 'lcr-result__text' }, String(row.snippet || '').replace(/[[\]]/g, '').replace(/\*\*/g, '')),
                      el('div', { className: 'lcr-row lcr-row--end' },
                        el('span', { className: 'lcr-mono lcr-muted lcr-small' }, row.chunkKey),
                        el('button', {
                          type: 'button',
                          className: 'lcr-btn lcr-btn--ghost',
                          onClick: () => onContext?.({ query: query.trim(), limit }),
                        }, 'Construir contexto con esta consulta'))))))
          : el(Empty, { title: 'Empieza con una consulta', hint: 'La búsqueda usa el mismo motor que las herramientas del modelo.' }));
    }

    function Context({ seed }) {
      const [query, setQuery] = useState(seed?.query || '');
      const [budget, setBudget] = useState(2000);
      const [result, setResult] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);

      useEffect(() => { if (seed?.query) setQuery(seed.query); }, [seed]);

      const run = async () => {
        if (!query.trim()) return;
        setBusy(true);
        setError('');
        try {
          setResult(await buildContext({ query: query.trim(), budgetTokens: budget, maxChunks: 12 }));
        } catch (failure) {
          setError(errorText(failure));
        } finally {
          setBusy(false);
        }
      };

      return el('div', { className: 'lcr-stack' },
        el(Card, { title: 'Ensamblar contexto' },
          el('div', { className: 'lcr-form lcr-form--inline' },
            el('input', { className: 'lcr-input', value: query, placeholder: 'Consulta', onChange: (event) => setQuery(event.target.value) }),
            el('input', { className: 'lcr-input lcr-input--num', type: 'number', min: 100, max: 8000, step: 100, value: budget, onChange: (event) => setBudget(Number(event.target.value)) }),
            el('button', { type: 'button', className: 'lcr-btn', onClick: run, disabled: busy }, busy ? 'Construyendo…' : 'Construir')),
          el('p', { className: 'lcr-hint' }, 'Presupuesto en tokens estimados. Si el primer fragmento no cabe, se devuelve vacío y marcado como truncado, nunca un fragmento cortado a medias.'),
          el(ErrorBox, { error })),
        result
          ? el('div', { className: 'lcr-grid' },
              el(Card, { title: `Contexto · ${formatNumber(result.tokens)} tokens${result.truncated ? ' · truncado' : ''}` },
                result.text ? el('pre', { className: 'lcr-context' }, result.text) : el(Empty, { title: 'Sin contexto que quepa', hint: 'Reduce los fragmentos o aumenta el presupuesto.' })),
              el(Card, { title: 'Procedencia' },
                el('ol', { className: 'lcr-citations' }, (result.citations || []).map((citation) =>
                  el('li', { key: citation.chunkKey },
                    el('span', { className: 'lcr-mono' }, `[${citation.n}] ${citation.chunkKey}`),
                    el('div', null, citation.title || citation.uri))))))
          : el(Empty, { title: 'Sin contexto todavía', hint: 'Lanza una consulta para ver citas y presupuesto.' }));
    }

    function Metrics({ snapshot }) {
      const [metric, setMetric] = useState('query.ms');
      const [series, setSeries] = useState(null);
      const [error, setError] = useState('');

      const load = useCallback(async () => {
        setError('');
        try {
          setSeries(await metricSeries(metric, 7));
        } catch (failure) {
          setError(errorText(failure));
        }
      }, [metric]);

      useEffect(() => { void load(); }, [load]);

      const summary = snapshot?.metrics || [];
      const rows = Array.isArray(summary) ? summary : [];
      const points = Array.isArray(series) ? series : (series?.points || []);
      const max = points.reduce((value, point) => Math.max(value, Number(point.value) || 0), 0) || 1;

      return el('div', { className: 'lcr-stack' },
        el(Card, { title: 'Agregados (últimos 7 días)' },
          rows.length === 0
            ? el(Empty, { title: 'Sin métricas todavía', hint: 'Se registran al buscar, indexar y construir contexto.' })
            : el('table', { className: 'lcr-table' },
                el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Métrica'), el('th', { scope: 'col' }, 'Dimensión'), el('th', { scope: 'col', className: 'lcr-num' }, 'Total'))),
                el('tbody', null, rows.map((row) =>
                  el('tr', { key: `${row.metric}-${row.dim}` },
                    el('td', { className: 'lcr-mono' }, row.metric),
                    el('td', null, row.dim || '—'),
                    el('td', { className: 'lcr-num' }, formatNumber(row.total))))))),
        el(Card, {
          title: 'Serie',
          extra: el('select', { className: 'lcr-select', value: metric, onChange: (event) => setMetric(event.target.value) },
            ['query.ms', 'query.count', 'ingest.documents', 'context.tokens', 'automation.runs'].map((name) =>
              el('option', { key: name, value: name }, name))),
        },
          el(ErrorBox, { error, onRetry: load }),
          points.length === 0
            ? el('p', { className: 'lcr-muted' }, 'Sin datos para esa métrica.')
            : el('div', { className: 'lcr-bars' }, points.map((point) =>
                el('div', { key: point.day, className: 'lcr-bar' },
                  el('div', { className: 'lcr-bar__track' },
                    el('div', { className: 'lcr-bar__fill', style: { height: `${Math.max(4, (Number(point.value) / max) * 100)}%` } })),
                  el('span', { className: 'lcr-muted lcr-small' }, String(point.day).slice(5))))),
          el('p', { className: 'lcr-hint' }, 'Percentiles estimados por histograma; nunca se guardan consultas, prompts ni respuestas.')));
    }

    function Settings({ snapshot, onSaved }) {
      const config = snapshot?.config || {};
      const [strategy, setStrategy] = useState(config.strategy || 'hybrid');
      const [limit, setLimit] = useState(config.limit ?? 8);
      const [enabled, setEnabled] = useState(Boolean(config.automation?.enabled));
      const [roots, setRoots] = useState((config.automation?.watchRoots || []).join('\n'));
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [notice, setNotice] = useState('');

      useEffect(() => {
        setStrategy(config.strategy || 'hybrid');
        setLimit(config.limit ?? 8);
        setEnabled(Boolean(config.automation?.enabled));
        setRoots((config.automation?.watchRoots || []).join('\n'));
      }, [config.strategy, config.limit, config.automation?.enabled, config.automation?.watchRoots]);

      const save = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
          const watchRoots = roots.split('\n').map((line) => line.trim()).filter(Boolean);
          await saveConfig({ search: { strategy, limit }, automation: { enabled, watchRoots } });
          setNotice('Configuración guardada. La automatización se aplica al recargar el plugin.');
          onSaved?.();
        } catch (failure) {
          setError(errorText(failure));
        } finally {
          setBusy(false);
        }
      };

      return el('div', { className: 'lcr-stack' },
        el(Card, { title: 'Búsqueda' },
          el('div', { className: 'lcr-form' },
            el('label', { className: 'lcr-field' },
              el('span', null, 'Estrategia por defecto'),
              el('select', { className: 'lcr-select', value: strategy, onChange: (event) => setStrategy(event.target.value) },
                el('option', { value: 'hybrid' }, 'Híbrida (léxica + vectorial)'),
                el('option', { value: 'fts' }, 'Sólo léxica'),
                el('option', { value: 'vector' }, 'Sólo vectorial'))),
            el('label', { className: 'lcr-field' },
              el('span', null, 'Resultados por consulta'),
              el('input', { className: 'lcr-input lcr-input--num', type: 'number', min: 1, max: 50, value: limit, onChange: (event) => setLimit(Number(event.target.value)) })),
            el('p', { className: 'lcr-hint' },
              `Embeddings: ${config.embedding?.provider || 'local-hash-v1'} · ${config.embedding?.dim || 256} dims · ${config.embedding?.kind === 'semantic' ? 'semántico' : 'léxico (hash de tokens)'}. La calidad semántica requiere un proveedor neural aprobado.`))),
        el(Card, { title: 'Automatización' },
          el('label', { className: 'lcr-toggle' },
            el('input', { type: 'checkbox', checked: enabled, onChange: (event) => setEnabled(event.target.checked) }),
            el('span', null, 'Indexar automáticamente las carpetas vigiladas')),
          el('label', { className: 'lcr-field' },
            el('span', null, 'Carpetas vigiladas (una por línea, ruta absoluta)'),
            el('textarea', { className: 'lcr-input lcr-mono', rows: 4, value: roots, onChange: (event) => setRoots(event.target.value) })),
          el('p', { className: 'lcr-hint' }, 'La automatización no puede aprobar operaciones sensibles: olvidar fuentes y reindexar siguen exigiendo confirmación explícita.')),
        el('div', { className: 'lcr-row' },
          el('button', { type: 'button', className: 'lcr-btn', onClick: save, disabled: busy }, busy ? 'Guardando…' : 'Guardar configuración')),
        el(ErrorBox, { error }),
        notice ? el('p', { className: 'lcr-ok' }, notice) : null);
    }

    function Health({ snapshot }) {
      const health = snapshot?.health || { ok: false, checks: [] };
      const store = snapshot?.store || {};
      return el('div', { className: 'lcr-stack' },
        el(Card, { title: 'Comprobaciones' },
          el('ul', { className: 'lcr-checks' }, (health.checks || []).map((check) =>
            el('li', { key: check.name, className: 'lcr-check' },
              el('span', { className: `lcr-dot lcr-dot--${check.status === 'ok' ? 'ok' : check.status === 'warn' ? 'warn' : 'bad'}`, 'aria-hidden': 'true' }),
              el('span', null, check.name),
              el('span', { className: 'lcr-muted' }, check.detail || check.status))))),
        el(Card, { title: 'Diagnóstico' },
          el('dl', { className: 'lcr-kv' },
            el('dt', null, 'Versión de esquema'), el('dd', null, String(store.schemaVersion ?? '—')),
            el('dt', null, 'Base de datos'), el('dd', { className: 'lcr-mono' }, store.path || '—'),
            el('dt', null, 'Tamaño'), el('dd', null, formatBytes(store.databaseBytes)),
            el('dt', null, 'Journal de auditoría'), el('dd', null, formatBytes(store.auditBytes))),
          el('p', { className: 'lcr-hint' }, 'Si algo aparece en rojo, ejecuta el doctor del plugin: `node bin/lifecode-rag.mjs doctor`.')));
    }

    function Panel(props) {
      const [tab, setTab] = useState('resumen');
      const [snapshot, setSnapshot] = useState(null);
      const [error, setError] = useState('');
      const [seed, setSeed] = useState(null);
      const timer = useRef(null);

      const load = useCallback(async () => {
        try {
          setSnapshot(await getSnapshot());
          setError('');
        } catch (failure) {
          setError(errorText(failure));
        }
      }, []);

      useEffect(() => {
        void load();
        timer.current = setInterval(() => {
          if (document.visibilityState !== 'hidden') void load();
        }, 30_000);
        return () => clearInterval(timer.current);
      }, [load]);

      const content = useMemo(() => {
        switch (tab) {
          case 'fuentes': return el(Sources, { onChanged: load });
          case 'buscar': return el(Search, { onContext: (payload) => { setSeed(payload); setTab('contexto'); } });
          case 'contexto': return el(Context, { seed });
          case 'metricas': return el(Metrics, { snapshot });
          case 'configuracion': return el(Settings, { snapshot, onSaved: load });
          case 'salud': return el(Health, { snapshot });
          default: return el(Overview, { snapshot });
        }
      }, [tab, snapshot, seed, load]);

      return el('div', { className: 'lcr-root' },
        el('header', { className: 'lcr-header' },
          el('div', null,
            el('h2', { className: 'lcr-title' }, 'LifeCode RAG'),
            el('p', { className: 'lcr-subtitle' }, 'Conocimiento local, recuperación híbrida y contexto con procedencia.')),
          el('button', { type: 'button', className: 'lcr-btn lcr-btn--ghost', onClick: load, 'aria-label': 'Actualizar datos' }, 'Actualizar')),
        el('nav', { className: 'lcr-tabs', role: 'tablist', 'aria-label': 'Secciones del Workspace' },
          TABS.map(([id, label]) =>
            el('button', {
              key: id,
              type: 'button',
              role: 'tab',
              'aria-selected': tab === id,
              className: `lcr-tab${tab === id ? ' lcr-tab--active' : ''}`,
              onClick: () => setTab(id),
            }, label))),
        el(ErrorBox, { error, onRetry: load }),
        el('main', { className: 'lcr-main' }, snapshot ? content : el('p', { className: 'lcr-muted' }, 'Cargando Workspace…')));
    }

    const ICON = (props) => {
      const size = props?.size || 18;
      return el('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      },
        el('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 18.5z' }),
        el('path', { d: 'M8 7h8M8 11h8M8 15h5' }));
    };

    const CSS = `
      .lcr-root { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px 28px; color: var(--dsw-alias-label-primary, #e8e8ea); background: var(--dsw-alias-bg-base, #17181c); min-height: 100%; font-size: 13px; line-height: 1.5; }
      .lcr-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .lcr-title { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -0.01em; }
      .lcr-subtitle { margin: 2px 0 0; color: var(--dsw-alias-label-secondary, #a0a0aa); }
      .lcr-tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l1, #2c2d33); padding-bottom: 6px; }
      .lcr-tab { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #a0a0aa); padding: 6px 10px; border-radius: 6px; cursor: pointer; font: inherit; }
      .lcr-tab:hover { background: var(--dsw-alias-bg-layer-1, #202127); color: var(--dsw-alias-label-primary, #e8e8ea); }
      .lcr-tab:focus-visible, .lcr-btn:focus-visible, .lcr-input:focus-visible, .lcr-select:focus-visible, .lcr-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f8cff); outline-offset: 2px; }
      .lcr-tab--active { background: color-mix(in oklab, var(--dsw-alias-brand-primary, #4f8cff) 16%, transparent); color: var(--dsw-alias-label-primary, #e8e8ea); font-weight: 600; }
      .lcr-main { display: flex; flex-direction: column; gap: 14px; }
      .lcr-stack { display: flex; flex-direction: column; gap: 14px; }
      .lcr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
      .lcr-card { background: var(--dsw-alias-bg-layer-1, #202127); border: 1px solid var(--dsw-alias-border-l1, #2c2d33); border-radius: 10px; overflow: hidden; }
      .lcr-card__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--dsw-alias-border-l2, #34353d); }
      .lcr-card__title { margin: 0; font-size: 13px; font-weight: 600; }
      .lcr-card__body { padding: 12px 14px; }
      .lcr-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
      .lcr-stat { display: flex; flex-direction: column; gap: 2px; padding: 12px; border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #202127); border: 1px solid var(--dsw-alias-border-l1, #2c2d33); }
      .lcr-stat__label { color: var(--dsw-alias-label-secondary, #a0a0aa); font-size: 12px; }
      .lcr-stat__value { font-size: 22px; font-variant-numeric: tabular-nums; }
      .lcr-kv { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; }
      .lcr-kv dt { color: var(--dsw-alias-label-secondary, #a0a0aa); }
      .lcr-kv dd { margin: 0; overflow-wrap: anywhere; }
      .lcr-mono { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 12px; }
      .lcr-small { font-size: 11px; }
      .lcr-muted { color: var(--dsw-alias-label-secondary, #a0a0aa); }
      .lcr-hint { margin: 8px 0 0; color: var(--dsw-alias-label-secondary, #a0a0aa); font-size: 12px; }
      .lcr-ok { color: var(--dsw-alias-state-success-primary, #2e9e6b); font-size: 12px; }
      .lcr-error { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; background: color-mix(in oklab, var(--dsw-alias-state-error-primary, #e5484d) 12%, transparent); border: 1px solid color-mix(in oklab, var(--dsw-alias-state-error-primary, #e5484d) 40%, transparent); color: var(--dsw-alias-label-primary, #e8e8ea); white-space: pre-wrap; }
      .lcr-chip { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
      .lcr-chip--ok { background: color-mix(in oklab, var(--dsw-alias-state-success-primary, #2e9e6b) 18%, transparent); color: var(--dsw-alias-state-success-primary, #2e9e6b); }
      .lcr-chip--bad { background: color-mix(in oklab, var(--dsw-alias-state-error-primary, #e5484d) 18%, transparent); color: var(--dsw-alias-state-error-primary, #e5484d); }
      .lcr-chip--neutral { background: var(--dsw-alias-bg-layer-2, #2a2b32); color: var(--dsw-alias-label-secondary, #a0a0aa); }
      .lcr-checks { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .lcr-check { display: grid; grid-template-columns: 10px 1fr max-content; align-items: center; gap: 8px; }
      .lcr-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
      .lcr-dot--ok { background: var(--dsw-alias-state-success-primary, #2e9e6b); }
      .lcr-dot--warn { background: var(--dsw-alias-state-warn-primary, #d68a1f); }
      .lcr-dot--bad { background: var(--dsw-alias-state-error-primary, #e5484d); }
      .lcr-activity { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .lcr-activity li { display: grid; grid-template-columns: 120px 1fr auto; gap: 10px; padding: 4px 0; border-bottom: 1px solid var(--dsw-alias-border-l2, #34353d); }
      .lcr-form { display: flex; flex-direction: column; gap: 10px; }
      .lcr-form--inline { flex-direction: row; flex-wrap: wrap; align-items: center; }
      .lcr-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary, #a0a0aa); }
      .lcr-input, .lcr-select { background: var(--dsw-alias-bg-base, #17181c); color: var(--dsw-alias-label-primary, #e8e8ea); border: 1px solid var(--dsw-alias-border-l1, #2c2d33); border-radius: 6px; padding: 6px 8px; font: inherit; }
      .lcr-input--num { width: 110px; }
      .lcr-search { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .lcr-search .lcr-input { flex: 1 1 260px; }
      .lcr-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l1, #2c2d33); background: var(--dsw-alias-bg-layer-2, #2a2b32); color: var(--dsw-alias-label-primary, #e8e8ea); border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; }
      .lcr-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary, #4f8cff); }
      .lcr-btn:disabled { opacity: 0.55; cursor: default; }
      .lcr-btn--ghost { background: transparent; }
      .lcr-btn--danger { border-color: color-mix(in oklab, var(--dsw-alias-state-error-primary, #e5484d) 50%, transparent); color: var(--dsw-alias-state-error-primary, #e5484d); }
      .lcr-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .lcr-row--end { justify-content: flex-end; }
      .lcr-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .lcr-table th { text-align: left; font-weight: 600; color: var(--dsw-alias-label-secondary, #a0a0aa); padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, #2c2d33); }
      .lcr-table td { padding: 7px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2, #34353d); vertical-align: top; }
      .lcr-num { text-align: right; font-variant-numeric: tabular-nums; }
      .lcr-link { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-brand-primary, #4f8cff); padding: 0; font: inherit; cursor: pointer; text-align: left; }
      .lcr-empty { padding: 18px; text-align: center; border: 1px dashed var(--dsw-alias-border-l1, #2c2d33); border-radius: 8px; }
      .lcr-empty__title { margin: 0; font-weight: 600; }
      .lcr-empty__hint { margin: 4px 0 0; color: var(--dsw-alias-label-secondary, #a0a0aa); font-size: 12px; }
      .lcr-results, .lcr-chunks, .lcr-citations { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .lcr-result, .lcr-chunk { padding: 10px; border-radius: 8px; background: var(--dsw-alias-bg-base, #17181c); border: 1px solid var(--dsw-alias-border-l2, #34353d); }
      .lcr-result__head, .lcr-chunk__head { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
      .lcr-score { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary, #a0a0aa); }
      .lcr-result__text, .lcr-chunk__text { margin: 6px 0; color: var(--dsw-alias-label-primary, #e8e8ea); white-space: pre-wrap; }
      .lcr-context { margin: 0; padding: 10px; border-radius: 8px; background: var(--dsw-alias-bg-base, #17181c); border: 1px solid var(--dsw-alias-border-l2, #34353d); white-space: pre-wrap; font-family: inherit; font-size: 12px; max-height: 420px; overflow: auto; }
      .lcr-bars { display: flex; align-items: flex-end; gap: 6px; height: 120px; padding-top: 8px; overflow-x: auto; }
      .lcr-bar { flex: 0 0 48px; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
      .lcr-bar__track { width: 100%; flex: 1; display: flex; align-items: flex-end; background: var(--dsw-alias-bg-base, #17181c); border-radius: 4px; }
      .lcr-bar__fill { width: 100%; background: color-mix(in oklab, var(--dsw-alias-brand-primary, #4f8cff) 55%, transparent); border-radius: 4px 4px 0 0; min-height: 3px; }
      .lcr-toggle { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .lcr-modal { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 20px; }
      .lcr-modal__box { background: var(--dsw-alias-bg-layer-1, #202127); border: 1px solid var(--dsw-alias-border-l1, #2c2d33); border-radius: 10px; padding: 18px; max-width: 440px; width: 100%; }
      .lcr-modal__title { margin: 0 0 6px; font-size: 15px; }
      .lcr-modal__body { margin: 0 0 14px; color: var(--dsw-alias-label-secondary, #a0a0aa); }
      .lcr-modal__actions { display: flex; justify-content: flex-end; gap: 8px; }
      @media (prefers-reduced-motion: reduce) { .lcr-root * { transition: none !important; } }
      @media (forced-colors: active) { .lcr-card, .lcr-stat, .lcr-result, .lcr-chunk, .lcr-context { border-color: CanvasText; } }
    `;

    /* ==========================================================================
       K1 — panel Project-Aware EN MODO SINTÉTICO.

       Reglas que este bloque respeta:
        - Cero red: los datos salen de fixtures deterministas; las operaciones son simuladas.
        - Cero polling: no hay temporizadores. Si algún día existe 'live', el refresco deberá usar
          `usePanelInfo` (panel activo), no `document.visibilityState`.
        - Cero escritura: nada toca el registro, los almacenes ni el perfil.
        - La UI no decide autorización: sólo pinta el estado que le dan.
       ====================================================================== */

    const NS = 'lifecode-rag';
    const SYNTHETIC_BANNER = 'SYNTHETIC DATA MODE — DEMO: ESTA VISTA NO LEE EL PROYECTO REAL';
    const PA_BASE_AT = 1763000000000;
    const PA_PAGE_LIMIT = 50;
    const PA_INGEST_PATHS = [
      'sintetico/nuevo/acta-de-reunion.md',
      'sintetico/nuevo/decision-de-arquitectura.md',
      'sintetico/nuevo/guia-de-operacion.md',
      // Caso de error deliberado del fixture: permite ejercitar el estado de error sin tocar nada real.
      'sintetico/nuevo/informe-escaneado.pdf',
    ];

    const PA_DICT = {
      es: {
        'app.title': 'LifeCode RAG',
        'app.subtitle': 'Proyecto activo, bibliotecas, fuentes y recuperación — en modo sintético',
        'status.client': 'Cliente montado',
        'status.api': 'API no montada',
        'status.data': 'Demo (fixtures)',
        'a11y.status': 'Estado del panel y de la conexión',
        'app.reset': 'Reiniciar datos sintéticos',
        'banner.hint': 'Fixture de demostración: no representa el proyecto real. Las herramientas del agente (lifecode_rag_*) sí trabajan con datos reales.',
        'a11y.tabs': 'Secciones del panel',
        'a11y.banner': 'Aviso de modo sintético',
        'nav.project': 'Proyecto',
        'nav.libraries': 'Bibliotecas',
        'nav.sources': 'Fuentes',
        'nav.search': 'Búsqueda',
        'nav.context': 'Contexto',
        'nav.operations': 'Operaciones',
        'nav.diagnostics': 'Diagnóstico',
        'nav.connection': 'Conexión',
        'nav.history': 'Historial',
        'common.none': '—',
        'common.total': 'Total',
        'common.previous': 'Anterior',
        'common.next': 'Siguiente',
        'common.page': 'Página {page} de {pages}',
        'common.back': 'Volver',
        'common.open': 'Abrir',
        'common.source': 'Fuente',
        'common.chunks': 'Fragmentos',
        'common.bytes': 'Bytes',
        'common.updated': 'Actualizado',
        'common.indexed': 'Indexado',
        'common.collection': 'Colección',
        'common.status': 'Estado',
        'common.actions': 'Acciones',
        'common.value': 'Valor',
        'common.name': 'Nombre',
        'common.uri': 'URI',
        'common.store': 'Almacén',
        'common.roots': 'Raíces',
        'common.permission': 'Permiso',
        'common.granted': 'Concedido',
        'common.simulated': 'Simulado',
        'common.yes': 'Sí',
        'common.no': 'No',
        'common.detail': 'Detalle',
        'common.first': 'Primera página',
        'common.last': 'Última página',
        'common.showing': 'Mostrando {from}–{to} de {total}',
        'project.title': 'Proyecto activo',
        'project.candidates': 'Proyectos candidatos',
        'project.project': 'Proyecto',
        'project.selection': 'Selección',
        'project.source': 'Origen',
        'project.source.explicit': 'explícita',
        'project.source.cwd': 'directorio de trabajo',
        'project.revision': 'Revisión',
        'project.scopes': 'Ámbitos efectivos',
        'project.service': 'Servicio',
        'project.current': 'actual',
        'project.select': 'Seleccionar',
        'project.gap09': 'GAP-09: la selección todavía no protege contra dos pestañas (última escritura gana).',
        'libraries.title': 'Bibliotecas autorizadas',
        'libraries.readonly': 'Sólo lectura: el panel no concede ni revoca bibliotecas.',
        'libraries.allPresent': 'Todos los almacenes disponibles',
        'libraries.empty': 'No hay bibliotecas concedidas para este proyecto.',
        'libraries.gap': 'Una biblioteca revocada desaparece de esta lista; su causa se explica en el proyecto.',
        'sources.title': 'Fuentes del proyecto',
        'sources.empty': 'Este proyecto no tiene fuentes indexadas en el fixture.',
        'sources.showing': 'Mostrando {shown} de {total}',
        'sources.filter': 'La vista muestra el fixture; no hay ingesta real.',
        'source.title': 'Detalle de fuente',
        'source.notFound': 'La fuente ya no está en el fixture.',
        'source.chunksShown': 'Se muestran {shown} de {total} fragmentos.',
        'source.gap05': 'GAP-05: esta versión no pagina fragmentos; el detalle se limita a los primeros.',
        'source.meta': 'Metadatos',
        'search.title': 'Búsqueda',
        'search.placeholder': 'Texto a buscar en el fixture',
        'search.run': 'Buscar',
        'search.limit': 'Resultados',
        'search.mode': 'Modo',
        'search.elapsed': 'Duración',
        'search.results': 'Resultados con procedencia',
        'search.scope': 'Ámbito',
        'search.noResults': 'Sin resultados para esa consulta en el fixture.',
        'search.hint': 'La búsqueda se ejecuta sobre datos sintéticos; no consulta el motor.',
        'search.openContext': 'Construir contexto con estos resultados',
        'context.title': 'Contexto recuperado',
        'context.build': 'Construir contexto',
        'context.empty': 'Ejecuta una búsqueda y construye el contexto con sus resultados.',
        'context.tokens': 'Tokens estimados',
        'context.truncated': 'Truncado',
        'context.considered': 'Fragmentos considerados',
        'context.citations': 'Citas',
        'context.failClosed': 'Con un almacén ilegible, la operación falla en cerrado: no se sirve contexto parcial.',
        'context.text': 'Texto que se serviría al modelo',
        'operations.title': 'Operaciones simuladas',
        'operations.ingest': 'Ingesta simulada',
        'operations.ingestHint': 'Añade una fuente de ejemplo al fixture. No lee ni escribe ficheros.',
        'operations.reindex': 'Reindexación simulada',
        'operations.reindexHint': 'Recorre las fuentes del fixture y cuenta fragmentos. No abre ningún almacén.',
        'operations.journal': 'Registro de operaciones simuladas',
        'operations.empty': 'Todavía no se ejecutó ninguna operación simulada.',
        'operations.noWrite': 'Las operaciones de esta vista no escriben en el RAG ni en el registro de auditoría.',
        'operations.error': 'No se pudo completar la operación simulada',
        'operations.errorCode': 'Código',
        'operations.clearError': 'Descartar aviso',
        'operations.errUnsupported': 'Formato no soportado en el fixture',
        'operations.errDuplicate': 'URI duplicada',
        'notice.ingestError': 'La ingesta simulada falló: formato no soportado en el fixture.',
        'operations.affected': 'Fuentes afectadas',
        'operations.at': 'Momento',
        'operations.kind': 'Tipo',
        'diagnostics.title': 'Diagnóstico',
        'diagnostics.integrity': 'Integridad',
        'diagnostics.registry': 'Registro',
        'diagnostics.stores': 'Almacenes',
        'diagnostics.auditHead': 'Cabeza de auditoría',
        'diagnostics.scopes': 'Ámbitos',
        'diagnostics.versions': 'Versiones',
        'diagnostics.api': 'API',
        'diagnostics.host': 'Anfitrión',
        'diagnostics.gap06': 'GAP-06: el diagnóstico multi-ámbito está limitado; se compone por ámbito.',
        'diagnostics.gap10': 'GAP-10: no hay detalle por embedding; sólo estado global.',
        'diagnostics.gap07': 'GAP-07: las lecturas del panel todavía no se auditan (ui.read no implementado).',
        'diagnostics.notAvailable': 'no disponible',
        'diagnostics.verified': 'Verificado',
        'diagnostics.limitations': 'Limitaciones conocidas',
        'diagnostics.fixtureNote': 'Estos valores vienen del fixture sintético: no se leen del anfitrión.',
        'diagnostics.storesDetail': '{missing} de {total} almacenes no disponible(s)',
        'connection.title': 'Conexión y disponibilidad',
        'connection.service': 'Servicio',
        'connection.registry': 'Registro',
        'connection.storeRoot': 'Raíz de almacenes',
        'connection.api': 'API Project-Aware',
        'connection.legacy': 'API heredada v0.2',
        'connection.notMounted': 'no montada',
        'connection.mode': 'Modo de datos',
        'connection.notice': 'No hay conexión real: el panel no habla con ninguna API y no puede activarla.',
        'connection.serviceDetail': 'Servicio degradado: {missing} de {total} almacenes no disponible(s).',
        'history.title': 'Historial de operaciones',
        'history.unavailable': 'No disponible en esta versión',
        'history.why': 'El contrato pa-ui/0.1.0-draft no expone un listado de auditoría. /diagnostics sólo devuelve la cabeza de la cadena.',
        'history.route': 'No se inventa una ruta: la vista queda deshabilitada hasta que exista contrato.',
        'history.simulated': 'Las operaciones simuladas de esta sesión se registran en la vista Operaciones, no aquí.',
        'history.toOperations': 'Ver operaciones simuladas',
        'notice.sameProject': 'Ese proyecto ya está seleccionado; no hubo cambios.',
        'notice.selected': 'Selección simulada: la revisión subió y el cambio quedó anotado en Operaciones.',
        'notice.ingest': 'Ingesta simulada completada: una fuente añadida al fixture.',
        'notice.reindex': 'Reindexación simulada completada: no se escribió nada.',
        'notice.reset': 'Datos sintéticos reiniciados.',
        'notice.searchEmpty': 'La búsqueda no devolvió resultados en el fixture.',
        'notice.emptyQuery': 'Escribe algo para buscar; no se cambió nada.',
        'notice.longQuery': 'La consulta supera el límite de 512 caracteres.',
        'notice.duplicateUri': 'Esa URI ya está en el fixture; no se añadió nada.',
        'view.errorTitle': 'No se pudo mostrar esta vista',
        'view.errorHint': 'El resto del panel sigue disponible. Reintenta o cambia de sección.',
        'view.retry': 'Reintentar',
      },
      en: {
        'app.title': 'LifeCode RAG',
        'app.subtitle': 'Active project, libraries, sources and retrieval — in synthetic mode',
        'status.client': 'Client mounted',
        'status.api': 'API not mounted',
        'status.data': 'Demo (fixtures)',
        'a11y.status': 'Panel and connection status',
        'app.reset': 'Reset synthetic data',
        'banner.hint': 'Demo fixture: not the real project. Agent tools (lifecode_rag_*) do work with real data.',
        'a11y.tabs': 'Panel sections',
        'a11y.banner': 'Synthetic mode notice',
        'nav.project': 'Project',
        'nav.libraries': 'Libraries',
        'nav.sources': 'Sources',
        'nav.search': 'Search',
        'nav.context': 'Context',
        'nav.operations': 'Operations',
        'nav.diagnostics': 'Diagnostics',
        'nav.connection': 'Connection',
        'nav.history': 'History',
        'common.none': '—',
        'common.total': 'Total',
        'common.previous': 'Previous',
        'common.next': 'Next',
        'common.page': 'Page {page} of {pages}',
        'common.back': 'Back',
        'common.open': 'Open',
        'common.source': 'Source',
        'common.chunks': 'Chunks',
        'common.bytes': 'Bytes',
        'common.updated': 'Updated',
        'common.indexed': 'Indexed',
        'common.collection': 'Collection',
        'common.status': 'Status',
        'common.actions': 'Actions',
        'common.value': 'Value',
        'common.name': 'Name',
        'common.uri': 'URI',
        'common.store': 'Store',
        'common.roots': 'Roots',
        'common.permission': 'Permission',
        'common.granted': 'Granted',
        'common.simulated': 'Simulated',
        'common.yes': 'Yes',
        'common.no': 'No',
        'common.detail': 'Detail',
        'common.first': 'First page',
        'common.last': 'Last page',
        'common.showing': 'Showing {from}–{to} of {total}',
        'project.title': 'Active project',
        'project.candidates': 'Candidate projects',
        'project.project': 'Project',
        'project.selection': 'Selection',
        'project.source': 'Origin',
        'project.source.explicit': 'explicit',
        'project.source.cwd': 'working directory',
        'project.revision': 'Revision',
        'project.scopes': 'Effective scopes',
        'project.service': 'Service',
        'project.current': 'current',
        'project.select': 'Select',
        'project.gap09': 'GAP-09: selection does not protect against two tabs yet (last write wins).',
        'libraries.title': 'Authorized libraries',
        'libraries.readonly': 'Read-only: the panel neither grants nor revokes libraries.',
        'libraries.allPresent': 'All stores available',
        'libraries.empty': 'No libraries granted for this project.',
        'libraries.gap': 'A revoked library disappears from this list; the cause is explained in the project view.',
        'sources.title': 'Project sources',
        'sources.empty': 'This project has no indexed sources in the fixture.',
        'sources.showing': 'Showing {shown} of {total}',
        'sources.filter': 'This view shows the fixture; there is no real ingestion.',
        'source.title': 'Source detail',
        'source.notFound': 'The source is no longer in the fixture.',
        'source.chunksShown': 'Showing {shown} of {total} chunks.',
        'source.gap05': 'GAP-05: this version does not paginate chunks; detail is limited to the first ones.',
        'source.meta': 'Metadata',
        'search.title': 'Search',
        'search.placeholder': 'Text to search in the fixture',
        'search.run': 'Search',
        'search.limit': 'Results',
        'search.mode': 'Mode',
        'search.elapsed': 'Duration',
        'search.results': 'Results with provenance',
        'search.scope': 'Scope',
        'search.noResults': 'No results for that query in the fixture.',
        'search.hint': 'Search runs over synthetic data; it does not query the engine.',
        'search.openContext': 'Build context from these results',
        'context.title': 'Retrieved context',
        'context.build': 'Build context',
        'context.empty': 'Run a search and build the context from its results.',
        'context.tokens': 'Estimated tokens',
        'context.truncated': 'Truncated',
        'context.considered': 'Chunks considered',
        'context.citations': 'Citations',
        'context.failClosed': 'With an unreadable store, the operation fails closed: no partial context is served.',
        'context.text': 'Text that would be served to the model',
        'operations.title': 'Simulated operations',
        'operations.ingest': 'Simulated ingestion',
        'operations.ingestHint': 'Adds a sample source to the fixture. It neither reads nor writes files.',
        'operations.reindex': 'Simulated reindex',
        'operations.reindexHint': 'Walks the fixture sources and counts chunks. It opens no store.',
        'operations.journal': 'Simulated operations log',
        'operations.empty': 'No simulated operation has run yet.',
        'operations.noWrite': 'Operations in this view write neither to the RAG nor to the audit log.',
        'operations.error': 'The simulated operation could not be completed',
        'operations.errorCode': 'Code',
        'operations.clearError': 'Dismiss notice',
        'operations.errUnsupported': 'Unsupported format in the fixture',
        'operations.errDuplicate': 'Duplicate URI',
        'notice.ingestError': 'Simulated ingestion failed: unsupported format in the fixture.',
        'operations.affected': 'Affected sources',
        'operations.at': 'Time',
        'operations.kind': 'Type',
        'diagnostics.title': 'Diagnostics',
        'diagnostics.integrity': 'Integrity',
        'diagnostics.registry': 'Registry',
        'diagnostics.stores': 'Stores',
        'diagnostics.auditHead': 'Audit head',
        'diagnostics.scopes': 'Scopes',
        'diagnostics.versions': 'Versions',
        'diagnostics.api': 'API',
        'diagnostics.host': 'Host',
        'diagnostics.gap06': 'GAP-06: multi-scope diagnostics are limited; they are composed per scope.',
        'diagnostics.gap10': 'GAP-10: no per-embedding detail; global state only.',
        'diagnostics.gap07': 'GAP-07: panel reads are not audited yet (ui.read not implemented).',
        'diagnostics.notAvailable': 'not available',
        'diagnostics.verified': 'Verified',
        'diagnostics.limitations': 'Known limitations',
        'diagnostics.fixtureNote': 'These values come from the synthetic fixture: they are not read from the host.',
        'diagnostics.storesDetail': '{missing} of {total} stores unavailable',
        'connection.title': 'Connection and availability',
        'connection.service': 'Service',
        'connection.registry': 'Registry',
        'connection.storeRoot': 'Store root',
        'connection.api': 'Project-Aware API',
        'connection.legacy': 'Legacy v0.2 API',
        'connection.notMounted': 'not mounted',
        'connection.mode': 'Data mode',
        'connection.notice': 'No real connection: the panel talks to no API and cannot enable one.',
        'connection.serviceDetail': 'Service degraded: {missing} of {total} stores unavailable.',
        'history.title': 'Operation history',
        'history.unavailable': 'Not available in this version',
        'history.why': 'The pa-ui/0.1.0-draft contract exposes no audit listing. /diagnostics only returns the chain head.',
        'history.route': 'No route is invented: the view stays disabled until a contract exists.',
        'history.simulated': 'Simulated operations for this session are logged in the Operations view, not here.',
        'history.toOperations': 'View simulated operations',
        'notice.sameProject': 'That project is already selected; nothing changed.',
        'notice.selected': 'Simulated selection: the revision went up and the change was logged in Operations.',
        'notice.ingest': 'Simulated ingestion complete: one source added to the fixture.',
        'notice.reindex': 'Simulated reindex complete: nothing was written.',
        'notice.reset': 'Synthetic data reset.',
        'notice.searchEmpty': 'The search returned no results in the fixture.',
        'notice.emptyQuery': 'Type something to search; nothing changed.',
        'notice.longQuery': 'The query exceeds the 512-character limit.',
        'notice.duplicateUri': 'That URI is already in the fixture; nothing was added.',
        'view.errorTitle': 'This view could not be rendered',
        'view.errorHint': 'The rest of the panel is still available. Retry or switch section.',
        'view.retry': 'Retry',
      },
    };

    function paNormalizeLang(value) {
      return String(value ?? '').toLowerCase().startsWith('en') ? 'en' : 'es';
    }

    function paTranslate(lang, key, vars) {
      const table = PA_DICT[lang] ?? PA_DICT.es;
      const text = table[key] ?? PA_DICT.es[key] ?? key;
      if (vars === undefined) return text;
      return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
    }

    function paReadLanguage(locale) {
      if (locale === null || locale === undefined) return 'es';
      try {
        if (typeof locale.getSnapshot === 'function') {
          const snapshot = locale.getSnapshot();
          const value = snapshot?.locale ?? snapshot?.lang ?? snapshot?.id ?? snapshot?.name;
          if (value !== undefined && value !== null) return paNormalizeLang(value);
        }
        if (typeof locale.getLocale === 'function') return paNormalizeLang(locale.getLocale());
      } catch {
        /* el locale es presentación: si falla, seguimos en español */
      }
      return 'es';
    }

    /* ----------------------------------------------------------- fixtures */

    function paNum(value) {
      const text = String(Math.trunc(Number(value) || 0));
      return text.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function paTime(at) {
      try {
        return new Date(at).toISOString().slice(0, 16).replace('T', ' ');
      } catch {
        return '—';
      }
    }

    function paHash(text) {
      let hash = 0;
      for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 100000;
      return hash;
    }

    function paChunkCount(sourceId) {
      return 3 + (paHash(sourceId) % 9);
    }

    function paChunks(source) {
      const total = source.chunks;
      const rows = [];
      for (let ordinal = 0; ordinal < total; ordinal += 1) {
        rows.push({
          ordinal,
          heading: source.title + ' · sección ' + String(ordinal + 1),
          charStart: ordinal * 1200,
          charEnd: ordinal * 1200 + 1100,
          tokenEst: 275,
          text: 'Fragmento sintético ' + String(ordinal + 1) + ' de «' + source.title + '». Contenido de ejemplo para probar la interfaz: no proviene de ningún documento real ni de ningún almacén.',
        });
      }
      return rows;
    }

    const PA_DOC_NAMES = {
      normativa: ['Política de acceso', 'Registro de decisiones', 'Acta de revisión'],
      producto: ['Manual de producto', 'Guía de producto', 'Plan de pruebas'],
      operaciones: ['Guía de operación', 'Procedimiento de soporte', 'Contrato de datos'],
    };
    const PA_COLLECTIONS = ['normativa', 'producto', 'operaciones'];

    function paBuildSources(count) {
      const rows = [];
      for (let i = 1; i <= count; i += 1) {
        const id = 'src_k1fx_' + String(i).padStart(4, '0');
        const collection = PA_COLLECTIONS[i % PA_COLLECTIONS.length];
        const names = PA_DOC_NAMES[collection];
        const title = names[Math.floor(i / PA_COLLECTIONS.length) % names.length] + ' ' + String(i).padStart(3, '0');
        rows.push({
          id,
          uri: 'sintetico/' + collection + '/doc-' + String(i).padStart(4, '0') + '.md',
          title,
          collection,
          bytes: 800 + ((i * 37) % 4200),
          chunks: paChunkCount(id),
          updatedAt: PA_BASE_AT - i * 3600000,
          indexedAt: PA_BASE_AT - i * 3500000,
          mime: 'text/markdown',
        });
      }
      return rows;
    }

    function paFixtures() {
      const sources = paBuildSources(121);
      return {
        session: {
          api: 'pa-ui/0.1.0-draft',
          contract: '0.1.0',
          session: {
            id: 'session-k1fx-0001',
            profileKey: 'k1-fixture',
            state: 'active',
            invalidReason: null,
            expiresAt: null,
            selection: {
              state: 'active',
              projectId: 'prj_k1fx_01',
              projectName: 'Fixture de demostración (no real)',
              source: 'explicit',
              revision: 3,
              selectedBy: 'human',
              selectedAt: PA_BASE_AT - 3600000,
              candidates: [],
            },
          },
          project: { id: 'prj_k1fx_01', name: 'Fixture de demostración (no real)', status: 'active' },
          scopes: [
            { kind: 'prj', id: 'prj_k1fx_01', name: 'Fixture de demostración (no real)', roots: 2, store: 'present' },
            { kind: 'lib', id: 'lib_k1fx_01', name: 'Normativa interna', roots: 1, store: 'present', permission: 'read' },
            { kind: 'lib', id: 'lib_k1fx_02', name: 'Documentación de producto', roots: 1, store: 'missing', permission: 'read' },
          ],
          scopeCount: 3,
          service: { status: 'degraded', registry: 'ok', storeRoot: 'ready' },
        },
        projects: [
          { id: 'prj_k1fx_01', name: 'Fixture de demostración (no real)', current: true, rootCount: 2 },
          { id: 'prj_k1fx_02', name: 'Biblioteca Compartida Beta', current: false, rootCount: 1 },
        ],
        libraries: [
          { id: 'lib_k1fx_01', name: 'Normativa interna', permission: 'read', grantedAt: PA_BASE_AT - 7200000, grantedBy: 'human', store: 'present', roots: 1 },
          { id: 'lib_k1fx_02', name: 'Documentación de producto', permission: 'read', grantedAt: PA_BASE_AT - 7100000, grantedBy: 'human', store: 'missing', roots: 1 },
        ],
        sources,
        diagnostics: {
          session: { id: 'session-k1fx-0001', profileKey: 'k1-fixture', state: 'active' },
          selection: { projectId: 'prj_k1fx_01', source: 'explicit', revision: 3 },
          scopes: [
            { kind: 'prj', id: 'prj_k1fx_01', name: 'Fixture de demostración (no real)', store: 'present', verified: true },
            { kind: 'lib', id: 'lib_k1fx_01', name: 'Normativa interna', store: 'present', verified: true },
            { kind: 'lib', id: 'lib_k1fx_02', name: 'Documentación de producto', store: 'missing', verified: false },
          ],
          grants: [
            { libraryId: 'lib_k1fx_01', permission: 'read', grantedAt: PA_BASE_AT - 7200000, state: 'open' },
            { libraryId: 'lib_k1fx_02', permission: 'read', grantedAt: PA_BASE_AT - 7100000, state: 'open' },
          ],
          integrity: { registry: 'ok', stores: 'degraded', auditHead: 42 },
          versions: { plugin: '1.0.0', contract: '0.1.0', api: 'pa-ui/0.1.0-draft', host: '0.2.2-rc.5' },
          health: {
            status: 'degraded',
            checks: [
              { id: 'registry', ok: true },
              { id: 'stores', ok: false },
              { id: 'audit-chain', ok: true },
            ],
          },
        },
        health: { api: 'pa-ui/0.1.0-draft', contract: '0.1.0', status: 'degraded', registry: 'ok', legacy: false },
      };
    }

    function paInitialState() {
      const fx = paFixtures();
      return {
        view: 'project',
        session: fx.session,
        projects: fx.projects,
        libraries: fx.libraries,
        sources: fx.sources,
        sourcePage: { limit: PA_PAGE_LIMIT, offset: 0 },
        selectedSourceId: null,
        query: '',
        limit: 8,
        ingestPath: PA_INGEST_PATHS[0],
        results: null,
        context: null,
        diagnostics: fx.diagnostics,
        health: fx.health,
        journal: [],
        clock: 0,
        opSeq: 0,
        notice: null,
        lastError: null,
        searchInvalid: null,
        viewEpoch: 0,
      };
    }

    /* ------------------------------------------------------------ utilidades */

    function paNormalizeUri(value) {
      return String(value ?? '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .toLowerCase();
    }

    function paPageInfo(state) {
      const { limit, offset } = state.sourcePage;
      const total = state.sources.length;
      const pages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(pages, Math.floor(offset / limit) + 1);
      return {
        limit,
        offset: (page - 1) * limit,
        total,
        pages,
        page,
        from: total === 0 ? 0 : (page - 1) * limit + 1,
        to: Math.min(total, page * limit),
        hasPrev: page > 1,
        hasNext: page < pages,
      };
    }

    /* ------------------------------------------------------------ búsqueda */

    function paSearchResults(state, query, limit) {
      const text = String(query ?? '').trim().toLowerCase();
      if (text === '') return null;
      const hits = [];
      state.sources.forEach((source) => {
        const haystack = (source.title + ' ' + source.uri + ' ' + source.collection).toLowerCase();
        if (!haystack.includes(text)) return;
        hits.push({
          chunkKey: source.id + ':0',
          sourceId: source.id,
          uri: source.uri,
          title: source.title,
          heading: 'Introducción',
          ordinal: 0,
          rrf: 0.031 - hits.length * 0.001,
          snippet: 'Coincidencia sintética en «' + source.title + '» para «' + String(query).trim() + '».',
          scopeId: 'prj_k1fx_01',
          scopeKind: 'prj',
          scopeName: 'Fixture de demostración (no real)',
        });
      });
      if (/norm|acces|polit|libr/.test(text) || text.length < 3) {
        // La procedencia de biblioteca va primero para que se vea aun con el límite por defecto.
        hits.unshift({
          chunkKey: 'lib_k1fx_01:0',
          sourceId: 'src_k1fx_lib_01',
          uri: 'sintetico/normativa/acceso.md',
          title: 'Política de acceso (biblioteca)',
          heading: 'Ámbito de aplicación',
          ordinal: 0,
          rrf: 0.019,
          snippet: 'Resultado sintético de la biblioteca compartida para «' + String(query).trim() + '».',
          scopeId: 'lib_k1fx_01',
          scopeKind: 'lib',
          scopeName: 'Normativa interna',
        });
      }
      const results = hits.slice(0, limit);
      return {
        mode: 'hybrid',
        elapsedMs: 8 + (String(query).length % 11),
        results,
        scopes: [
          { id: 'prj_k1fx_01', kind: 'prj', name: 'Fixture de demostración (no real)', results: results.filter((r) => r.scopeKind === 'prj').length },
          { id: 'lib_k1fx_01', kind: 'lib', name: 'Normativa interna', results: results.filter((r) => r.scopeKind === 'lib').length },
        ],
      };
    }

    function paBuildContext(state, results) {
      if (!results || results.length === 0) return null;
      const chosen = results.slice(0, 3);
      const lines = chosen.map((row, index) => '[' + String(index + 1) + '] ' + row.title + ' — ' + row.heading + '\n' + row.snippet);
      const text = lines.join('\n\n');
      const citations = chosen.map((row, index) => ({
        n: index + 1,
        chunkKey: row.chunkKey,
        sourceId: row.sourceId,
        uri: row.uri,
        title: row.title,
        heading: row.heading,
        ordinal: row.ordinal,
        charStart: 0,
        charEnd: row.snippet.length,
      }));
      return {
        text,
        citations,
        tokens: Math.ceil(text.length / 4),
        truncated: false,
        considered: results.length,
        scopes: [
          { id: 'prj_k1fx_01', kind: 'prj', name: 'Fixture de demostración (no real)' },
          { id: 'lib_k1fx_01', kind: 'lib', name: 'Normativa interna' },
        ],
        elapsedMs: 5,
      };
    }

    /* ------------------------------------------------------------- reducer */

    function paJournalEntry(state, kind, detail) {
      const clock = state.clock + 1;
      const seq = state.opSeq + 1;
      const entry = {
        id: 'op-k1fx-' + String(seq).padStart(3, '0'),
        at: PA_BASE_AT + clock * 60000,
        kind,
        detail,
        status: 'simulated',
      };
      return { clock, seq, journal: [entry, ...state.journal] };
    }

    function paReduce(state, action) {
      if (!action || typeof action.type !== 'string') return state;
      switch (action.type) {
        case 'reset':
          return paInitialState();
        case 'nav':
          return { ...state, view: action.view, notice: null };
        case 'select-project': {
          const current = state.session.session.selection;
          if (!action.projectId || action.projectId === current.projectId) {
            return { ...state, notice: { code: 'notice.sameProject' } };
          }
          const project = state.projects.find((row) => row.id === action.projectId);
          if (!project) return { ...state, notice: { code: 'notice.sameProject' } };
          const entry = paJournalEntry(state, 'selection', project.name);
          return {
            ...state,
            session: {
              ...state.session,
              session: {
                ...state.session.session,
                selection: { ...current, projectId: project.id, projectName: project.name, source: 'explicit', revision: current.revision + 1 },
              },
            },
            projects: state.projects.map((row) => ({ ...row, current: row.id === project.id })),
            clock: entry.clock,
            opSeq: entry.seq,
            journal: entry.journal,
            notice: { code: 'notice.selected' },
          };
        }
        case 'page': {
          const maxOffset = Math.max(0, Math.floor((state.sources.length - 1) / state.sourcePage.limit) * state.sourcePage.limit);
          const offset = Math.min(maxOffset, Math.max(0, Number(action.offset) || 0));
          return { ...state, sourcePage: { ...state.sourcePage, offset } };
        }
        case 'open-source':
          return { ...state, view: 'source', selectedSourceId: action.id, notice: null };
        case 'query':
          return { ...state, query: String(action.value ?? ''), searchInvalid: null };
        case 'limit':
          return { ...state, limit: Number(action.value) || 8 };
        case 'search': {
          const text = String(state.query ?? '').trim();
          if (text === '') {
            return { ...state, view: 'search', searchInvalid: 'empty', notice: { code: 'notice.emptyQuery' } };
          }
          if (text.length > 512) {
            return { ...state, view: 'search', searchInvalid: 'long', notice: { code: 'notice.longQuery' } };
          }
          const results = paSearchResults(state, text, state.limit);
          return {
            ...state,
            view: 'search',
            results,
            context: null,
            searchInvalid: null,
            notice: results && results.results.length === 0 ? { code: 'notice.searchEmpty' } : null,
          };
        }
        case 'retry-view':
          return { ...state, viewEpoch: (state.viewEpoch ?? 0) + 1, notice: null };
        case 'context': {
          const context = state.results && state.results.results.length > 0 ? paBuildContext(state, state.results.results) : null;
          return { ...state, view: 'context', context, notice: context ? null : { code: 'notice.searchEmpty' } };
        }
        case 'ingest-path':
          return { ...state, ingestPath: String(action.value ?? PA_INGEST_PATHS[0]) };
        case 'ingest': {
          const path = String(state.ingestPath ?? '');
          if (path.toLowerCase().endsWith('.pdf')) {
            const failed = paJournalEntry(state, 'ingest', path);
            return {
              ...state,
              clock: failed.clock,
              opSeq: failed.seq,
              journal: failed.journal,
              lastError: { code: 'unsupported-format', key: 'operations.errUnsupported', path },
              notice: { code: 'notice.ingestError' },
            };
          }
          if (state.sources.some((row) => paNormalizeUri(row.uri) === paNormalizeUri(path))) {
            const rejected = paJournalEntry(state, 'ingest', path);
            return {
              ...state,
              clock: rejected.clock,
              opSeq: rejected.seq,
              journal: rejected.journal,
              lastError: { code: 'duplicate-uri', key: 'operations.errDuplicate', path },
              notice: { code: 'notice.duplicateUri' },
            };
          }
          const entry = paJournalEntry(state, 'ingest', path);
          const id = 'src_k1fx_ing_' + String(entry.seq).padStart(2, '0');
          const source = {
            id,
            uri: path,
            title: 'Documento sintético ' + String(entry.seq).padStart(2, '0'),
            collection: 'operaciones',
            bytes: 1024 + entry.seq * 16,
            chunks: paChunkCount(id),
            updatedAt: PA_BASE_AT + entry.clock * 60000,
            indexedAt: PA_BASE_AT + entry.clock * 60000,
            mime: 'text/markdown',
          };
          return {
            ...state,
            sources: [source, ...state.sources],
            clock: entry.clock,
            opSeq: entry.seq,
            journal: entry.journal,
            notice: { code: 'notice.ingest' },
          };
        }
        case 'reindex': {
          const entry = paJournalEntry(state, 'reindex', String(state.sources.length));
          return {
            ...state,
            clock: entry.clock,
            opSeq: entry.seq,
            journal: entry.journal,
            notice: { code: 'notice.reindex' },
          };
        }
        case 'clear-error':
          return { ...state, lastError: null, notice: null };
        default:
          return state;
      }
    }

    /* -------------------------------------------------------------- vistas */

    function paChip(text, tone) {
      return el('span', { className: 'lcr-pa-chip lcr-pa-chip--' + (tone ?? 'neutral') }, text);
    }

    function paCard(title, children, extra) {
      return el('section', { className: 'lcr-pa-card' },
        el('div', { className: 'lcr-pa-card__head' },
          el('h2', { className: 'lcr-pa-card__title' }, title),
          extra ?? null),
        el('div', { className: 'lcr-pa-card__body' }, children));
    }

    function paKv(pairs) {
      const children = [];
      pairs.forEach((pair, index) => {
        children.push(el('dt', { key: 'k' + index }, pair[0]));
        children.push(el('dd', { key: 'v' + index }, pair[1] === null || pair[1] === undefined || pair[1] === '' ? '—' : pair[1]));
      });
      return el('dl', { className: 'lcr-pa-kv' }, ...children);
    }

    function paTable(caption, cols, rows, wrapClass) {
      return el('div', { className: 'lcr-pa-scroll' + (wrapClass ? ' ' + wrapClass : '') },
        el('table', { className: 'lcr-pa-table' },
          el('caption', { className: 'lcr-pa-sr' }, caption),
          el('thead', null, el('tr', null, ...cols.map((col) => el('th', { key: col, scope: 'col' }, col)))),
          el('tbody', null, ...rows)));
    }

    function paEmpty(title, hint) {
      return el('div', { className: 'lcr-pa-empty' },
        el('p', { className: 'lcr-pa-empty__title' }, title),
        hint ? el('p', { className: 'lcr-pa-empty__hint' }, hint) : null);
    }

    function paNotice(state, t) {
      if (!state.notice) return null;
      return el('p', { className: 'lcr-pa-notice' }, t(state.notice.code));
    }

    function paKpi(label, value, hint) {
      return el('div', { className: 'lcr-pa-kpi' },
        el('span', { className: 'lcr-pa-kpi__label' }, label),
        el('span', { className: 'lcr-pa-kpi__value' }, value),
        hint ? el('span', { className: 'lcr-pa-kpi__hint' }, hint) : null);
    }

    function paViewProject(state, t, dispatch) {
      const selection = state.session.session.selection;
      const missingStores = state.diagnostics.scopes.filter((scope) => scope.store !== 'present').length;
      const missingLibraries = state.libraries.filter((library) => library.store !== 'present').length;
      const pages = Math.max(1, Math.ceil(state.sources.length / PA_PAGE_LIMIT));
      const rows = state.projects.map((project) => el('tr', { key: project.id },
        el('td', null, project.name),
        el('td', { className: 'lcr-pa-num' }, String(project.rootCount)),
        el('td', null, project.current ? paChip(t('project.current'), 'ok') : t('common.none')),
        el('td', null, el('button', {
          type: 'button',
          className: 'lcr-pa-btn',
          disabled: project.current,
          onClick: () => dispatch({ type: 'select-project', projectId: project.id }),
        }, t('project.select')))));
      return el('div', { className: 'lcr-pa-stack' },
        el('div', { className: 'lcr-pa-kpis' },
          paKpi(t('project.scopes'), String(state.session.scopeCount), selection.projectName),
          paKpi(t('nav.libraries'), String(state.libraries.length), missingLibraries > 0
            ? t('diagnostics.storesDetail', { missing: missingLibraries, total: state.libraries.length })
            : t('libraries.allPresent')),
          paKpi(t('nav.sources'), paNum(state.sources.length), t('common.page', { page: 1, pages })),
          paKpi(t('connection.service'), state.session.service.status, t('connection.serviceDetail', { missing: missingStores, total: state.diagnostics.scopes.length }))),
        el('div', { className: 'lcr-pa-split' },
          paCard(t('project.title'), el('div', { className: 'lcr-pa-stack' },
            paKv([
              [t('project.project'), selection.projectName],
              [t('project.selection'), selection.state],
              [t('project.source'), selection.source === 'explicit' ? t('project.source.explicit') : t('project.source.cwd')],
              [t('project.revision'), String(selection.revision)],
              [t('project.scopes'), String(state.session.scopeCount)],
              [t('project.service'), state.session.service.status],
            ]),
            el('p', { className: 'lcr-pa-hint' }, t('project.gap09')))),
          paCard(t('project.candidates'), paTable(t('project.candidates'), [t('project.project'), t('common.roots'), t('common.status'), t('common.actions')], rows))),
        paNotice(state, t));
    }

    function paViewLibraries(state, t) {
      const missingStores = state.libraries.filter((library) => library.store !== 'present').length;
      const rows = state.libraries.map((library) => el('tr', { key: library.id },
        el('td', null, library.name),
        el('td', null, paChip(library.permission, 'lib')),
        el('td', null, paChip(library.store, library.store === 'present' ? 'ok' : 'warn')),
        el('td', { className: 'lcr-pa-num' }, String(library.roots)),
        el('td', null, paTime(library.grantedAt))));
      return el('div', { className: 'lcr-pa-stack' },
        paCard(t('libraries.title'),
          el('div', { className: 'lcr-pa-stack' },
            el('p', { className: 'lcr-pa-hint' }, t('libraries.readonly')),
            state.libraries.length === 0
              ? paEmpty(t('libraries.empty'))
              : paTable(t('libraries.title'), [t('common.name'), t('common.permission'), t('common.store'), t('common.roots'), t('common.granted')], rows),
            el('p', { className: 'lcr-pa-hint' }, missingStores > 0
              ? t('diagnostics.storesDetail', { missing: missingStores, total: state.libraries.length })
              : t('libraries.allPresent')),
            el('p', { className: 'lcr-pa-hint' }, t('libraries.gap')))));
    }

    function paSourcePager(info, t, dispatch) {
      return el('div', { className: 'lcr-pa-row' },
        el('span', { className: 'lcr-pa-muted' }, t('common.page', { page: info.page, pages: info.pages })),
        el('span', { className: 'lcr-pa-row' },
          el('button', {
            type: 'button',
            className: 'lcr-pa-btn lcr-pa-btn--ghost',
            'aria-label': t('common.first'),
            disabled: !info.hasPrev,
            onClick: () => dispatch({ type: 'page', offset: 0 }),
          }, '«'),
          el('button', {
            type: 'button',
            className: 'lcr-pa-btn',
            disabled: !info.hasPrev,
            onClick: () => dispatch({ type: 'page', offset: info.offset - info.limit }),
          }, t('common.previous')),
          el('button', {
            type: 'button',
            className: 'lcr-pa-btn',
            disabled: !info.hasNext,
            onClick: () => dispatch({ type: 'page', offset: info.offset + info.limit }),
          }, t('common.next')),
          el('button', {
            type: 'button',
            className: 'lcr-pa-btn lcr-pa-btn--ghost',
            'aria-label': t('common.last'),
            disabled: !info.hasNext,
            onClick: () => dispatch({ type: 'page', offset: (info.pages - 1) * info.limit }),
          }, '»')));
    }

    function paViewSources(state, t, dispatch) {
      const info = paPageInfo(state);
      const pageRows = state.sources.slice(info.offset, info.offset + info.limit);
      const rows = pageRows.map((source) => el('tr', { key: source.id },
        el('td', null, source.title),
        el('td', null, el('span', { className: 'lcr-pa-mono lcr-pa-celluri', title: source.uri }, source.uri)),
        el('td', null, paChip(source.collection, 'lib')),
        el('td', { className: 'lcr-pa-num' }, String(source.chunks)),
        el('td', { className: 'lcr-pa-num' }, paNum(source.bytes)),
        el('td', null, paTime(source.updatedAt)),
        el('td', null, el('button', {
          type: 'button',
          className: 'lcr-pa-btn',
          onClick: () => dispatch({ type: 'open-source', id: source.id }),
        }, t('common.open')))));
      return el('div', { className: 'lcr-pa-stack' },
        paCard(t('sources.title'),
          el('div', { className: 'lcr-pa-stack' },
            el('div', { className: 'lcr-pa-toolbar' },
              el('span', { className: 'lcr-pa-toolbar__group' },
                paChip(t('nav.sources') + ': ' + paNum(info.total), 'lib'),
                el('span', { className: 'lcr-pa-muted' }, t('sources.showing', { shown: pageRows.length, total: info.total })))),
            el('p', { className: 'lcr-pa-hint' }, t('sources.filter')),
            info.total === 0
              ? paEmpty(t('sources.empty'))
              : paTable(t('sources.title'), [t('common.name'), t('common.uri'), t('common.collection'), t('common.chunks'), t('common.bytes'), t('common.updated'), t('common.actions')], rows, 'lcr-pa-tablewrap')),
          info.total === 0 ? null : paSourcePager(info, t, dispatch)),
        paNotice(state, t));
    }

    function paViewSource(state, t, dispatch) {
      const source = state.sources.find((row) => row.id === state.selectedSourceId);
      const back = () => dispatch({ type: 'nav', view: 'sources' });
      if (!source) {
        return paCard(t('source.title'), el('div', { className: 'lcr-pa-stack' },
          paEmpty(t('source.notFound')),
          el('div', { className: 'lcr-pa-row' },
            el('button', { type: 'button', className: 'lcr-pa-btn', onClick: back }, t('common.back')))));
      }
      const chunks = paChunks(source);
      const shown = chunks.slice(0, 8);
      const rows = shown.map((chunk) => el('tr', { key: chunk.ordinal },
        el('td', { className: 'lcr-pa-num' }, String(chunk.ordinal)),
        el('td', null, chunk.heading),
        el('td', { className: 'lcr-pa-mono' }, chunk.charStart + '..' + chunk.charEnd),
        el('td', { className: 'lcr-pa-num' }, String(chunk.tokenEst)),
        el('td', { className: 'lcr-pa-chunk-cell' }, chunk.text)));
      return el('div', { className: 'lcr-pa-stack' },
        paCard(source.title, el('div', { className: 'lcr-pa-stack' },
          el('div', { className: 'lcr-pa-toolbar' },
            el('button', { type: 'button', className: 'lcr-pa-btn', onClick: back }, t('common.back')),
            el('span', { className: 'lcr-pa-toolbar__group' },
              paChip(source.collection, 'lib'),
              paChip(paNum(source.bytes) + ' B'),
              paChip(String(source.chunks) + ' ' + t('common.chunks')))),
          paKv([
            [t('common.uri'), source.uri],
            [t('common.collection'), source.collection],
            [t('common.bytes'), paNum(source.bytes)],
            [t('common.chunks'), String(source.chunks)],
            [t('common.indexed'), paTime(source.indexedAt)],
          ]),
          el('h3', { className: 'lcr-pa-subtitle' }, t('common.chunks')),
          el('p', { className: 'lcr-pa-hint' }, t('source.chunksShown', { shown: shown.length, total: source.chunks })),
          paTable(t('common.chunks'), ['#', t('common.name'), 'charStart..charEnd', 'tokens', t('common.value')], rows, 'lcr-pa-tablewrap'),
          el('p', { className: 'lcr-pa-hint' }, t('source.gap05')))));
    }

    function paViewSearch(state, t, dispatch) {
      const results = state.results;
      const message = state.searchInvalid === 'empty' ? t('notice.emptyQuery')
        : state.searchInvalid === 'long' ? t('notice.longQuery') : null;
      const hasResults = Boolean(results && results.results.length > 0);
      const rows = results
        ? results.results.map((row, index) => el('tr', { key: row.chunkKey },
          el('td', { className: 'lcr-pa-num' }, String(index + 1)),
          el('td', null, row.title),
          el('td', null, row.heading),
          el('td', null, paChip(row.scopeName + ' · ' + row.scopeKind, row.scopeKind === 'lib' ? 'lib' : 'prj')),
          el('td', null, row.snippet),
          el('td', { className: 'lcr-pa-num' }, row.rrf.toFixed(3))))
        : [];
      return el('div', { className: 'lcr-pa-stack' },
        el('section', { className: 'lcr-pa-hero' },
          el('h2', { className: 'lcr-pa-card__title' }, t('search.title')),
          el('div', { className: 'lcr-pa-hero__form' },
            el('input', {
              type: 'text',
              className: 'lcr-pa-input',
              value: state.query,
              placeholder: t('search.placeholder'),
              'aria-label': t('search.placeholder'),
              'aria-invalid': message ? 'true' : 'false',
              'aria-describedby': 'lcr-pa-search-msg',
              'data-field': 'query',
              onChange: (event) => dispatch({ type: 'query', value: event.target.value }),
            }),
            el('label', { className: 'lcr-pa-field' }, t('search.limit'),
              el('select', {
                className: 'lcr-pa-input',
                value: String(state.limit),
                'data-field': 'limit',
                onChange: (event) => dispatch({ type: 'limit', value: event.target.value }),
              }, ['8', '20', '50'].map((value) => el('option', { key: value, value }, value)))),
            el('button', { type: 'button', className: 'lcr-pa-btn lcr-pa-btn--primary', onClick: () => dispatch({ type: 'search' }) }, t('search.run'))),
          el('p', { className: 'lcr-pa-hint', id: 'lcr-pa-search-msg' }, message ?? t('search.hint'))),
        results && results.results.length === 0
          ? paCard(t('search.results'), paEmpty(t('search.noResults'), t('search.hint')))
          : null,
        results && results.results.length > 0
          ? paCard(t('search.results'), el('div', { className: 'lcr-pa-stack' },
            el('div', { className: 'lcr-pa-toolbar' },
              el('span', { className: 'lcr-pa-toolbar__group' },
                paChip(t('search.mode') + ': ' + results.mode, 'ok'),
                paChip(String(results.elapsedMs) + ' ms'),
                paChip(String(results.results.length) + ' / ' + String(state.limit))),
              el('button', {
                type: 'button',
                className: 'lcr-pa-btn lcr-pa-btn--primary',
                disabled: !hasResults,
                onClick: () => dispatch({ type: 'context' }),
              }, t('search.openContext'))),
            paTable(t('search.results'), ['#', t('common.name'), t('common.value'), t('search.scope'), t('common.detail'), 'rrf'], rows, 'lcr-pa-tablewrap')))
          : null,
        paNotice(state, t));
    }

    function paViewContext(state, t, dispatch) {
      const context = state.context;
      const rows = context
        ? context.citations.map((citation) => el('tr', { key: citation.n },
          el('td', { className: 'lcr-pa-num' }, String(citation.n)),
          el('td', null, citation.title),
          el('td', { className: 'lcr-pa-mono' }, citation.uri),
          el('td', null, citation.heading),
          el('td', { className: 'lcr-pa-num' }, String(citation.ordinal)),
          el('td', { className: 'lcr-pa-mono' }, citation.charStart + '..' + citation.charEnd)))
        : [];
      return el('div', { className: 'lcr-pa-stack' },
        paCard(t('context.title'), el('div', { className: 'lcr-pa-stack' },
          el('div', { className: 'lcr-pa-row lcr-pa-row--end' },
            el('button', {
              type: 'button',
              className: 'lcr-pa-btn lcr-pa-btn--primary',
              disabled: !(state.results && state.results.results.length > 0),
              onClick: () => dispatch({ type: 'context' }),
            }, t('context.build'))),
          context === null
            ? paEmpty(t('context.empty'), t('context.failClosed'))
            : el('div', { className: 'lcr-pa-stack' },
              el('div', { className: 'lcr-pa-kpis' },
                paKpi(t('context.tokens'), String(context.tokens)),
                paKpi(t('context.truncated'), context.truncated ? t('common.yes') : t('common.no')),
                paKpi(t('context.considered'), String(context.considered))),
              el('h3', { className: 'lcr-pa-subtitle' }, t('context.text')),
              el('pre', { className: 'lcr-pa-context' }, context.text),
              el('h3', { className: 'lcr-pa-subtitle' }, t('context.citations')),
              paTable(t('context.citations'), ['#', t('common.name'), t('common.uri'), t('common.value'), 'ordinal', 'offsets'], rows, 'lcr-pa-tablewrap'),
              el('p', { className: 'lcr-pa-hint' }, t('context.failClosed'))))),
        paNotice(state, t));
    }

    function paViewOperations(state, t, dispatch) {
      const rows = state.journal.map((entry) => el('tr', { key: entry.id },
        el('td', { className: 'lcr-pa-mono' }, entry.id),
        el('td', null, paTime(entry.at)),
        el('td', null, entry.kind),
        el('td', null, entry.detail),
        el('td', null, paChip(t('common.simulated'), 'warn'))));
      return el('div', { className: 'lcr-pa-stack' },
        paCard(t('operations.title'), el('div', { className: 'lcr-pa-stack' },
          el('p', { className: 'lcr-pa-hint' }, t('operations.noWrite')),
          state.lastError ? el('div', { className: 'lcr-pa-error' },
            el('p', { className: 'lcr-pa-error__title' }, t(state.lastError.key ?? 'operations.error')),
            el('p', { className: 'lcr-pa-hint' }, t('operations.errorCode') + ': ' + state.lastError.code + ' · ' + state.lastError.path),
            el('button', { type: 'button', className: 'lcr-pa-btn', onClick: () => dispatch({ type: 'clear-error' }) }, t('operations.clearError'))) : null,
          el('div', { className: 'lcr-pa-grid' },
            paCard(t('operations.ingest'), el('div', { className: 'lcr-pa-stack' },
              el('p', { className: 'lcr-pa-hint' }, t('operations.ingestHint')),
              el('label', { className: 'lcr-pa-field' }, t('common.uri'),
                el('select', {
                  className: 'lcr-pa-input',
                  value: state.ingestPath,
                  'data-field': 'ingest-path',
                  onChange: (event) => dispatch({ type: 'ingest-path', value: event.target.value }),
                }, PA_INGEST_PATHS.map((value) => el('option', { key: value, value }, value)))),
              el('div', { className: 'lcr-pa-row' },
                el('button', { type: 'button', className: 'lcr-pa-btn lcr-pa-btn--primary', onClick: () => dispatch({ type: 'ingest' }) }, t('operations.ingest')))),
              paChip(t('common.simulated'), 'warn')),
            paCard(t('operations.reindex'), el('div', { className: 'lcr-pa-stack' },
              el('p', { className: 'lcr-pa-hint' }, t('operations.reindexHint')),
              el('p', { className: 'lcr-pa-hint' }, t('operations.affected') + ': ' + String(state.sources.length)),
              el('div', { className: 'lcr-pa-row' },
                el('button', { type: 'button', className: 'lcr-pa-btn lcr-pa-btn--primary', onClick: () => dispatch({ type: 'reindex' }) }, t('operations.reindex')))),
              paChip(t('common.simulated'), 'warn'))))),
        paCard(t('operations.journal'),
          state.journal.length === 0
            ? paEmpty(t('operations.empty'))
            : paTable(t('operations.journal'), ['id', t('operations.at'), t('operations.kind'), t('common.detail'), t('common.status')], rows, 'lcr-pa-tablewrap')),
        paNotice(state, t));
    }

    function paViewDiagnostics(state, t) {
      const diagnostics = state.diagnostics;
      const missingStores = diagnostics.scopes.filter((scope) => scope.store !== 'present').length;
      const scopeRows = diagnostics.scopes.map((scope) => el('tr', { key: scope.id },
        el('td', null, scope.kind),
        el('td', { className: 'lcr-pa-mono' }, scope.id),
        el('td', null, scope.name),
        el('td', null, scope.store),
        el('td', null, scope.verified ? t('common.yes') : t('common.no'))));
      const versions = paKv([
        ['plugin', diagnostics.versions.plugin],
        ['contract', diagnostics.versions.contract],
        [t('diagnostics.api'), diagnostics.versions.api],
        [t('diagnostics.host'), diagnostics.versions.host],
      ]);
      return el('div', { className: 'lcr-pa-stack' },
        el('div', { className: 'lcr-pa-kpis' },
          paKpi(t('diagnostics.registry'), diagnostics.integrity.registry),
          paKpi(t('diagnostics.stores'), diagnostics.integrity.stores, t('diagnostics.storesDetail', { missing: missingStores, total: diagnostics.scopes.length })),
          paKpi(t('diagnostics.auditHead'), String(diagnostics.integrity.auditHead))),
        el('div', { className: 'lcr-pa-split' },
          paCard(t('diagnostics.scopes'), paTable(t('diagnostics.scopes'), ['kind', 'id', t('common.name'), t('common.store'), t('diagnostics.verified')], scopeRows, 'lcr-pa-tablewrap')),
          paCard(t('diagnostics.versions'), el('div', { className: 'lcr-pa-stack' }, versions,
            el('p', { className: 'lcr-pa-hint' }, t('diagnostics.fixtureNote')),
            el('h3', { className: 'lcr-pa-subtitle' }, t('diagnostics.limitations')),
            el('ul', { className: 'lcr-pa-list' },
              el('li', { className: 'lcr-pa-list__item' }, paChip('GAP-06', 'warn'), el('span', null, t('diagnostics.gap06'))),
              el('li', { className: 'lcr-pa-list__item' }, paChip('GAP-10', 'warn'), el('span', null, t('diagnostics.gap10'))),
              el('li', { className: 'lcr-pa-list__item' }, paChip('GAP-07', 'warn'), el('span', null, t('diagnostics.gap07'))))))));
    }

    function paViewConnection(state, t) {
      const health = state.health;
      const missingStores = state.diagnostics.scopes.filter((scope) => scope.store !== 'present').length;
      return el('div', { className: 'lcr-pa-stack' },
        paCard(t('connection.title'), el('div', { className: 'lcr-pa-stack' },
          el('div', { className: 'lcr-pa-toolbar' },
            el('span', { className: 'lcr-pa-toolbar__group' },
              paChip(t('status.client'), 'ok'),
              paChip(t('status.api'), 'warn'),
              paChip(t('status.data'), 'warn'),
              paChip(t('connection.service') + ': ' + health.status, health.status === 'ok' ? 'ok' : 'warn'))),
          paKv([
            [t('connection.service'), health.status],
            [t('connection.registry'), health.registry],
            [t('connection.storeRoot'), state.session.service.storeRoot],
            [t('connection.api'), t('connection.notMounted')],
            [t('connection.legacy'), health.legacy ? 'legacy' : 'no'],
            [t('connection.mode'), DATA_MODE],
          ]),
          el('p', { className: 'lcr-pa-hint' }, t('connection.notice')),
          el('p', { className: 'lcr-pa-hint' }, t('connection.serviceDetail', { missing: missingStores, total: state.diagnostics.scopes.length })))));
    }

    function paViewHistory(state, t, dispatch) {
      return paCard(t('history.title'), el('div', { className: 'lcr-pa-stack' },
        el('div', { className: 'lcr-pa-empty lcr-pa-empty--big' },
          el('p', { className: 'lcr-pa-empty__title' }, t('history.unavailable')),
          el('p', { className: 'lcr-pa-empty__hint' }, t('history.why')),
          el('button', {
            type: 'button',
            className: 'lcr-pa-link',
            onClick: () => dispatch({ type: 'nav', view: 'operations' }),
          }, t('history.toOperations'))),
        el('p', { className: 'lcr-pa-hint' }, t('history.route')),
        el('p', { className: 'lcr-pa-hint' }, t('history.simulated'))));
    }

    const PA_VIEWS = [
      { id: 'project', key: 'nav.project' },
      { id: 'libraries', key: 'nav.libraries' },
      { id: 'sources', key: 'nav.sources' },
      { id: 'search', key: 'nav.search' },
      { id: 'context', key: 'nav.context' },
      { id: 'operations', key: 'nav.operations' },
      { id: 'diagnostics', key: 'nav.diagnostics' },
      { id: 'connection', key: 'nav.connection' },
      { id: 'history', key: 'nav.history' },
    ];

    function paRenderView(state, t, dispatch) {
      switch (state.view) {
        case 'libraries': return paViewLibraries(state, t);
        case 'sources': return paViewSources(state, t, dispatch);
        case 'source': return paViewSource(state, t, dispatch);
        case 'search': return paViewSearch(state, t, dispatch);
        case 'context': return paViewContext(state, t, dispatch);
        case 'operations': return paViewOperations(state, t, dispatch);
        case 'diagnostics': return paViewDiagnostics(state, t);
        case 'connection': return paViewConnection(state, t);
        case 'history': return paViewHistory(state, t, dispatch);
        default: return paViewProject(state, t, dispatch);
      }
    }

    function paRenderViewSafe(state, t, dispatch, render) {
      const draw = typeof render === 'function' ? render : paRenderView;
      try {
        return draw(state, t, dispatch);
      } catch (error) {
        return el('section', { className: 'lcr-pa-card', 'data-view-error': state.view },
          el('div', { className: 'lcr-pa-card__head' },
            el('h2', { className: 'lcr-pa-card__title' }, t('view.errorTitle'))),
          el('div', { className: 'lcr-pa-card__body' },
            el('div', { className: 'lcr-pa-error' },
              el('p', { className: 'lcr-pa-error__title' }, t('view.errorTitle')),
              el('p', { className: 'lcr-pa-hint' }, t('view.errorHint')),
              el('button', {
                type: 'button',
                className: 'lcr-pa-btn',
                onClick: () => dispatch({ type: 'retry-view' }),
              }, t('view.retry')))));
      }
    }

    function paStatusPill(label, tone) {
      return el('span', { className: 'lcr-pa-status__item' },
        el('span', { className: 'lcr-pa-dot lcr-pa-dot--' + tone, 'aria-hidden': 'true' }),
        label);
    }

    function PaPanel(props) {
      const [state, setState] = useState(() => paInitialState());
      const t = props && typeof props.t === 'function' ? props.t : (key, vars) => paTranslate('es', key, vars);
      const dispatch = (action) => setState((previous) => paReduce(previous, action));
      const activeId = state.view === 'source' ? 'sources' : state.view;
      const onKeyDown = (event) => {
        if (!event || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        const ids = PA_VIEWS.map((view) => view.id);
        const current = ids.indexOf(activeId);
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const next = ids[(current + delta + ids.length) % ids.length];
        dispatch({ type: 'nav', view: next });
      };
      const serviceStatus = state.session.service.status;
      return el('div', { className: 'lcr-pa-root', 'data-data-mode': DATA_MODE },
        el('div', { className: 'lcr-pa-banner', role: 'status', 'aria-atomic': 'true', 'aria-label': t('a11y.banner') },
          el('strong', null, SYNTHETIC_BANNER),
          el('span', { className: 'lcr-pa-banner__hint' }, t('banner.hint'))),
        el('header', { className: 'lcr-pa-head' },
          el('div', { className: 'lcr-pa-head__main' },
            el('div', { className: 'lcr-pa-brand' },
              el('span', { className: 'lcr-pa-mark', 'aria-hidden': 'true' }, 'RAG'),
              el('div', null,
                el('h1', { className: 'lcr-pa-head__title' }, t('app.title')),
                el('p', { className: 'lcr-pa-head__sub' }, t('app.subtitle')))),
            el('div', { className: 'lcr-pa-status', 'aria-label': t('a11y.status') },
              paStatusPill(t('status.client'), 'ok'),
              paStatusPill(t('status.api'), 'warn'),
              paStatusPill(t('status.data'), 'warn'),
              paStatusPill(t('connection.service') + ': ' + serviceStatus, serviceStatus === 'ok' ? 'ok' : 'warn'))),
          el('div', { className: 'lcr-pa-head__actions' },
            el('button', { type: 'button', className: 'lcr-pa-btn', onClick: () => dispatch({ type: 'reset' }) }, t('app.reset')))),
        el('div', { className: 'lcr-pa-tabs', role: 'tablist', 'aria-label': t('a11y.tabs'), onKeyDown },
          ...PA_VIEWS.map((view) => el('button', {
            key: view.id,
            type: 'button',
            role: 'tab',
            id: 'lcr-pa-tab-' + view.id,
            className: 'lcr-pa-tab' + (activeId === view.id ? ' lcr-pa-tab--active' : ''),
            'aria-selected': activeId === view.id ? 'true' : 'false',
            'aria-controls': 'lcr-pa-panel-' + view.id,
            tabIndex: activeId === view.id ? 0 : -1,
            onClick: () => dispatch({ type: 'nav', view: view.id }),
          }, t(view.key)))),
        el('div', {
          className: 'lcr-pa-body',
          role: 'tabpanel',
          id: 'lcr-pa-panel-' + activeId,
          'aria-labelledby': 'lcr-pa-tab-' + activeId,
          'data-view': state.view,
        }, paRenderViewSafe(state, t, dispatch)));
    }

    const CSS_PA = `
      .lcr-pa-root {
        --pa-bg: var(--dsw-alias-bg-base, #17181c);
        --pa-surface: var(--dsw-alias-bg-layer-1, #202127);
        --pa-surface-2: var(--dsw-alias-bg-layer-2, #2a2b32);
        --pa-border: var(--dsw-alias-border-l1, #2c2d33);
        --pa-border-2: var(--dsw-alias-border-l2, #34353d);
        --pa-text: var(--dsw-alias-label-primary, #e8e8ea);
        --pa-muted: var(--dsw-alias-label-secondary, #a0a0aa);
        --pa-accent: var(--dsw-alias-brand-primary, #4f8cff);
        --pa-ok: var(--dsw-alias-state-success-primary, #2fbf71);
        --pa-warn: var(--dsw-alias-state-warn-primary, #d6a100);
        --pa-err: var(--dsw-alias-state-error-primary, #e5484d);
        --pa-radius: 10px;
        --pa-radius-sm: 7px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: 100%;
        padding: 18px 20px 32px;
        overflow: auto;
        color: var(--pa-text);
        background: var(--pa-bg);
        font-family: inherit;
        font-size: 13px;
        line-height: 1.5;
      }
      .lcr-pa-root *, .lcr-pa-root *::before, .lcr-pa-root *::after { box-sizing: border-box; }
      /* Los bloques fijos de la cabecera no se comprimen cuando el slot tiene altura fija: sin esto,
         el navegador reparte la falta de espacio encogiendo la fila de pestañas (su min-height resuelve
         a 0 por el overflow-x) y la deja reducida a la barra de desplazamiento. */
      .lcr-pa-banner, .lcr-pa-head, .lcr-pa-tabs { flex: 0 0 auto; }
      .lcr-pa-body { flex: 1 0 auto; }
      .lcr-pa-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
      .lcr-pa-banner { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 7px 11px; border: 1px solid color-mix(in oklab, var(--pa-warn) 45%, transparent); border-radius: var(--pa-radius-sm); background: color-mix(in oklab, var(--pa-warn) 10%, transparent); font-size: 11.5px; }
      .lcr-pa-banner strong { font-size: 11px; letter-spacing: 0.04em; font-weight: 700; }
      .lcr-pa-banner__hint { color: var(--pa-muted); }
      .lcr-pa-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 14px; }
      .lcr-pa-head__main { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
      .lcr-pa-brand { display: flex; align-items: center; gap: 10px; }
      .lcr-pa-mark { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 9px; border: 1px solid color-mix(in oklab, var(--pa-accent) 45%, transparent); background: color-mix(in oklab, var(--pa-accent) 14%, transparent); color: var(--pa-accent); font-size: 10px; font-weight: 800; letter-spacing: 0.04em; }
      .lcr-pa-status { display: flex; flex-wrap: wrap; gap: 6px; }
      .lcr-pa-status__item { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border: 1px solid var(--pa-border); border-radius: 999px; background: var(--pa-surface); font-size: 11px; color: var(--pa-muted); }
      .lcr-pa-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--pa-muted); }
      .lcr-pa-dot--ok { background: var(--pa-ok); }
      .lcr-pa-dot--warn { background: var(--pa-warn); }
      .lcr-pa-dot--err { background: var(--pa-err); }
      .lcr-pa-head__title { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -0.01em; }
      .lcr-pa-head__sub { margin: 3px 0 0; color: var(--pa-muted); font-size: 12px; }
      .lcr-pa-head__actions { display: flex; align-items: center; gap: 8px; }
      .lcr-pa-tabs { display: flex; gap: 2px; padding: 3px; border: 1px solid var(--pa-border); border-radius: var(--pa-radius-sm); background: var(--pa-surface); overflow-x: auto; scrollbar-width: thin; }
      .lcr-pa-tab { appearance: none; flex: 0 0 auto; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--pa-muted); padding: 6px 11px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
      .lcr-pa-tab:hover { color: var(--pa-text); background: color-mix(in oklab, var(--pa-surface-2) 60%, transparent); }
      .lcr-pa-tab--active { color: var(--pa-text); background: var(--pa-surface-2); border-color: var(--pa-border-2); font-weight: 600; }
      .lcr-pa-tab:focus-visible, .lcr-pa-btn:focus-visible, .lcr-pa-input:focus-visible, .lcr-pa-link:focus-visible { outline: 2px solid var(--pa-accent); outline-offset: 2px; }
      .lcr-pa-body { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
      .lcr-pa-card { border: 1px solid var(--pa-border); border-radius: var(--pa-radius); background: var(--pa-surface); overflow: hidden; min-width: 0; }
      .lcr-pa-card__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 14px; border-bottom: 1px solid var(--pa-border); background: color-mix(in oklab, var(--pa-surface-2) 35%, transparent); }
      .lcr-pa-card__title { margin: 0; font-size: 12.5px; font-weight: 650; letter-spacing: 0.01em; }
      .lcr-pa-card__body { padding: 12px 14px; min-width: 0; }
      .lcr-pa-subtitle { margin: 14px 0 6px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; color: var(--pa-muted); }
      .lcr-pa-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; align-items: start; }
      .lcr-pa-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
      .lcr-pa-field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--pa-muted); min-width: 0; }
      .lcr-pa-input { appearance: none; border: 1px solid var(--pa-border); border-radius: 6px; background: var(--pa-bg); color: inherit; padding: 7px 9px; font: inherit; font-size: 12.5px; min-width: 0; }
      .lcr-pa-input:hover { border-color: var(--pa-border-2); }
      .lcr-pa-input[aria-invalid="true"] { border-color: var(--pa-err); }
      .lcr-pa-btn { appearance: none; border: 1px solid var(--pa-border); border-radius: 6px; background: var(--pa-surface-2); color: var(--pa-text); padding: 6px 12px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
      .lcr-pa-btn:hover:not(:disabled) { border-color: var(--pa-accent); }
      .lcr-pa-btn:disabled { opacity: 0.5; cursor: default; }
      .lcr-pa-btn--primary { background: color-mix(in oklab, var(--pa-accent) 72%, #000); border-color: color-mix(in oklab, var(--pa-accent) 72%, #000); color: #fff; font-weight: 600; }
      .lcr-pa-btn--ghost { background: transparent; }
      .lcr-pa-scroll { overflow: auto; min-width: 0; }
      .lcr-pa-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
      .lcr-pa-table th { position: sticky; top: 0; z-index: 1; text-align: left; font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--pa-muted); padding: 8px 10px; border-bottom: 1px solid var(--pa-border); background: var(--pa-surface); white-space: nowrap; }
      .lcr-pa-table td { padding: 8px 10px; border-bottom: 1px solid var(--pa-border-2); vertical-align: top; }
      .lcr-pa-table tbody tr:hover td { background: color-mix(in oklab, var(--pa-surface-2) 45%, transparent); }
      .lcr-pa-table tbody tr:last-child td { border-bottom: 0; }
      .lcr-pa-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .lcr-pa-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
      .lcr-pa-muted { color: var(--pa-muted); }
      .lcr-pa-hint { margin: 6px 0 0; color: var(--pa-muted); font-size: 11.5px; }
      .lcr-pa-kv { display: grid; grid-template-columns: minmax(120px, max-content) 1fr; gap: 6px 16px; margin: 0; }
      .lcr-pa-kv dt { color: var(--pa-muted); font-size: 11.5px; }
      .lcr-pa-kv dd { margin: 0; font-size: 12.5px; min-width: 0; overflow-wrap: anywhere; }
      .lcr-pa-chunk-cell { max-width: 460px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .lcr-pa-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--pa-border-2); font-size: 10.5px; font-weight: 600; white-space: nowrap; }
      .lcr-pa-chip--ok { border-color: color-mix(in oklab, var(--pa-ok) 45%, transparent); color: var(--pa-ok); background: color-mix(in oklab, var(--pa-ok) 12%, transparent); }
      .lcr-pa-chip--warn { border-color: color-mix(in oklab, var(--pa-warn) 45%, transparent); color: var(--pa-warn); background: color-mix(in oklab, var(--pa-warn) 12%, transparent); }
      .lcr-pa-chip--err { border-color: color-mix(in oklab, var(--pa-err) 45%, transparent); color: var(--pa-err); background: color-mix(in oklab, var(--pa-err) 12%, transparent); }
      .lcr-pa-chip--lib { border-color: color-mix(in oklab, var(--pa-accent) 45%, transparent); color: var(--pa-accent); background: color-mix(in oklab, var(--pa-accent) 12%, transparent); }
      .lcr-pa-notice { margin: 0; padding: 8px 11px; border-radius: var(--pa-radius-sm); border: 1px solid var(--pa-border); background: var(--pa-surface); font-size: 12px; }
      .lcr-pa-error { margin: 0 0 10px; padding: 10px 12px; border-radius: var(--pa-radius-sm); border: 1px solid color-mix(in oklab, var(--pa-err) 45%, transparent); background: color-mix(in oklab, var(--pa-err) 10%, transparent); font-size: 12px; }
      .lcr-pa-error__title { margin: 0 0 4px; font-weight: 650; }
      .lcr-pa-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 24px 16px; border: 1px dashed var(--pa-border-2); border-radius: var(--pa-radius-sm); text-align: center; }
      .lcr-pa-empty__title { margin: 0; font-weight: 650; font-size: 12.5px; }
      .lcr-pa-empty__hint { margin: 0; color: var(--pa-muted); font-size: 11.5px; max-width: 60ch; }
      .lcr-pa-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
      .lcr-pa-row--end { justify-content: flex-end; }
      .lcr-pa-context { margin: 8px 0 0; padding: 12px; border-radius: var(--pa-radius-sm); border: 1px solid var(--pa-border-2); background: var(--pa-bg); white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; max-height: 420px; overflow: auto; }
      .lcr-pa-stack { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
      .lcr-pa-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
      .lcr-pa-kpi { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid var(--pa-border); border-radius: var(--pa-radius); background: var(--pa-surface); min-width: 0; }
      .lcr-pa-kpi__label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--pa-muted); }
      .lcr-pa-kpi__value { font-size: 21px; font-weight: 650; letter-spacing: -0.01em; line-height: 1.2; }
      .lcr-pa-kpi__hint { font-size: 11px; color: var(--pa-muted); overflow-wrap: anywhere; }
      .lcr-pa-split { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr); gap: 14px; align-items: start; }
      .lcr-pa-hero { padding: 16px; border: 1px solid var(--pa-border); border-radius: var(--pa-radius); background: linear-gradient(180deg, color-mix(in oklab, var(--pa-accent) 7%, transparent), transparent 70%), var(--pa-surface); }
      .lcr-pa-hero__form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .lcr-pa-hero__form > .lcr-pa-input { flex: 1 1 320px; padding: 10px 12px; font-size: 13.5px; }
      .lcr-pa-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
      .lcr-pa-toolbar__group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .lcr-pa-list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
      .lcr-pa-list__item { display: flex; align-items: flex-start; gap: 8px; font-size: 11.5px; color: var(--pa-muted); }
      .lcr-pa-tablewrap { max-height: 540px; }
      .lcr-pa-celluri { display: block; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lcr-pa-empty--big { padding: 40px 18px; }
      .lcr-pa-link { appearance: none; border: 0; padding: 0; background: none; color: var(--pa-accent); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
      .lcr-pa-banner + .lcr-pa-head { margin-top: 2px; }
      @media (max-width: 760px) {
        .lcr-pa-root { padding: 14px 12px 24px; }
        .lcr-pa-head { flex-direction: column; align-items: stretch; }
        .lcr-pa-head__actions { justify-content: flex-start; }
        .lcr-pa-grid { grid-template-columns: 1fr; }
        .lcr-pa-split { grid-template-columns: 1fr; }
        .lcr-pa-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .lcr-pa-form { align-items: stretch; }
        .lcr-pa-form > * { flex: 1 1 100%; }
        .lcr-pa-hero__form > .lcr-pa-input { flex: 1 1 100%; }
        .lcr-pa-tab { padding: 5px 9px; font-size: 11.5px; }
        .lcr-pa-chunk-cell { max-width: 240px; }
        .lcr-pa-celluri { max-width: 180px; }
        .lcr-pa-kv { grid-template-columns: 1fr; }
        .lcr-pa-tablewrap { max-height: none; }
      }
      @media (prefers-reduced-motion: reduce) { .lcr-pa-root * { transition: none; } }
      @media (forced-colors: active) { .lcr-pa-card, .lcr-pa-banner, .lcr-pa-notice, .lcr-pa-empty, .lcr-pa-tabs { border-color: CanvasText; } }
    `;

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.id = 'lcr-styles';
          style.textContent = CSS + CSS_PA;
          document.head.appendChild(style);
          return () => { style.remove(); };
        });

        // Locales: diccionarios inline (ES/EN con paridad de claves). El registro se deshace al
        // descargar el plugin, no se acumula al remontar.
        const locale = ctx.locale ?? ctx.get?.('locale') ?? null;
        if (locale !== null && locale !== undefined && typeof locale.register === 'function') {
          ctx.effect(() => {
            const dispose = locale.register(NS, PA_DICT);
            return typeof dispose === 'function' ? dispose : undefined;
          });
        }

        // Slots con la API vigente del anfitrión: `inject(slot, cb)`. El registro vive dentro del
        // callback y su disposer lo administra el anfitrión; la forma antigua `inject(slot)` +
        // `.register(...)` devolvía un disposer y reventaba con TypeError.
        ctx.slots.inject(SIDEBAR_SLOT, () => ctx.slots.register({
          name: SIDEBAR_SLOT,
          id: PANEL_ID,
          order: 35,
          label: () => paTranslate(paReadLanguage(locale), 'app.title'),
          locale: NS,
        }, ICON));

        ctx.slots.inject(MAIN_SLOT, () => ctx.slots.register({
          name: MAIN_SLOT,
          key: PANEL_ID,
          order: 55,
          locale: NS,
        }, PaPanel));
      },
      // Superficie de pruebas: el anfitrión la ignora. Permite ejercitar el contrato del módulo
      // (slots, reducer, vistas, guarda de red) sin React y sin host.
      __test: {
        DATA_MODE,
        SYNTHETIC_BANNER,
        PA_DICT,
        PA_VIEWS,
        CSS_PA,
        CSS,
        PaPanel,
        paInitialState,
        paReduce,
        paRenderView,
        paRenderViewSafe,
        paNormalizeUri,
        paPageInfo,
        paFixtures,
        paTranslate,
        paReadLanguage,
        paChunks,
        paBuildSources,
        requestLegacy: request,
      },
    };
  },
});
