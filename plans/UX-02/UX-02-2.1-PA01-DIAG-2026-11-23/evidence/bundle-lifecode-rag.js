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
  id: '@designerbyron/lifecode-rag',
  factory(require) {
    const React = require('react');
    const el = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const API = '/lifecode-rag/api';
    const PA_API = '/lifecode-rag/pa';
    const REQUEST_TIMEOUT_MS = 8000;
    /** Presupuesto de contexto por defecto del contrato §8 (2000 tokens estimados). */
    const PA_CONTEXT_BUDGET = 2000;
    const PANEL_ID = 'lifecode-rag';
    const SIDEBAR_SLOT = 'sidebar.panellist';
    const MAIN_SLOT = 'main';
    // Modo de datos del panel. 'fixture' = datos sintéticos, sin red. 'live' no está habilitado:
    // habilitarlo exige la integración de sesión que hoy no existe (PA01 BLOCKED). No hay ningún
    // control en la interfaz que cambie este valor.
    // LE-RAG-10: el modo se negocia con el servidor PA. Arranca en 'fixture' (demostración
    // explícita) y solo pasa a 'api' si /snapshot responde mode:'api'. Si el servidor falla,
    // NO se vuelve silenciosamente al fixture: se informa el estado y la razón.
    const panelState = { mode: 'fixture', reason: 'sin negociar', service: null };
    let requestSeq = 0;
    const latestSeq = new Map();

    /* ------------------------------------------------------------------ API */

    async function request(path, options = {}) {
      if (panelState.mode !== 'api') {
        const blocked = new Error('fixture-mode: el panel no está conectado a la API PA');
        blocked.code = 'fixture-mode';
        throw blocked;
      }
      const base = options.target === 'legacy' ? API : PA_API;
      const method = options.method || 'GET';
      const headers = { accept: 'application/json' };
      if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
        headers['x-lifecode-rag'] = '1';
      }
      const key = method + ' ' + path;
      const seq = ++requestSeq;
      latestSeq.set(key, seq);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      if (options.signal) options.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
      let response;
      try {
        response = await fetch(base + path, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        const aborted = error && error.name === 'AbortError';
        const failure = new Error(aborted ? 'tiempo de espera agotado' : 'fallo de transporte');
        failure.code = aborted ? 'timeout' : 'transport-error';
        throw failure;
      }
      clearTimeout(timer);
      if (latestSeq.get(key) !== seq) {
        const stale = new Error('respuesta obsoleta descartada');
        stale.code = 'stale-response';
        throw stale;
      }
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (data === null) {
        const invalid = new Error('respuesta no es JSON válido');
        invalid.code = 'invalid-json';
        invalid.status = response.status;
        throw invalid;
      }
      // LE-RAG-12: sobre contractual (§5) — `{ok:true, data}` en éxito, `{ok:false, error}` en fallo.
      // Un `ok:false` con status 200 también es un fallo: nunca se degrada a datos vacíos.
      if (data.ok === false && data.error) {
        const failure = new Error(data.error.message || 'la operación no se completó');
        failure.code = data.error.code || 'internal';
        failure.status = response.status;
        throw failure;
      }
      if (!response.ok) {
        if (response.status === 404 && !(data && data.error)) {
          const unavailable = new Error('este perfil usa Project-Aware: el panel del almacén v0.2 no está disponible; usa las herramientas lifecode_rag_*');
          unavailable.code = 'panel-unavailable';
          throw unavailable;
        }
        const failure = new Error((data.error && data.error.message) || ('HTTP ' + response.status));
        failure.code = (data.error && data.error.code) || (`http-${response.status}`);
        failure.status = response.status;
        throw failure;
      }
      return data.ok === true && data.data !== undefined ? data.data : data;
    }

    async function negotiateMode(options) {
      const project = options && options.project ? options.project : null;
      const suffix = project ? ('?project=' + encodeURIComponent(project)) : '';
      try {
        const response = await fetch(PA_API + '/snapshot' + suffix, { headers: { accept: 'application/json' } });
        let data = null;
        try { data = await response.json(); } catch { data = null; }
        // LE-RAG-12: el sobre §5 envuelve el payload en `data`.
        const payload = data && data.ok === true && data.data ? data.data : data;
        if (response.ok && payload && payload.mode === 'api') {
          panelState.mode = 'api';
          panelState.reason = 'api';
          panelState.service = payload.service || 'ok';
          return panelState;
        }
        panelState.mode = 'fixture';
        panelState.reason = (data && data.error && data.error.code) || ('http-' + response.status);
        panelState.service = 'down';
      } catch (error) {
        panelState.mode = 'fixture';
        panelState.reason = (error && error.code) || 'transport-error';
        panelState.service = 'down';
      }
      return panelState;
    }

    // LE-RAG-10: normalización de las respuestas reales de la API PA a las filas que pintan las
    // vistas. Se usa la URI relativa del snapshot cuando la cita trae un sourceId conocido, para no
    // exponer rutas absolutas del disco en la interfaz.
    function paNormalizeSearch(data, sources, fallbackScope) {
      const rows = Array.isArray(data && data.results) ? data.results : [];
      const byId = new Map((sources || []).map((row) => [row.id, row]));
      return {
        mode: (data && data.mode) || 'api',
        elapsedMs: data && typeof data.elapsedMs === 'number' ? data.elapsedMs : null,
        results: rows.map((row) => {
          const source = byId.get(row.sourceId) || null;
          return {
            chunkKey: row.chunkKey,
            sourceId: row.sourceId,
            uri: source ? source.uri : (row.uri || ''),
            title: row.title || (source ? source.title : ''),
            heading: row.heading || '',
            ordinal: row.ordinal ?? null,
            snippet: row.snippet ?? '',
            score: typeof row.score === 'number' ? row.score : (typeof row.rrf === 'number' ? row.rrf : null),
            scopeKind: row.scopeKind || 'prj',
            scopeName: row.scopeName || fallbackScope || '',
          };
        }),
      };
    }

    function paNormalizeContext(data, sources) {
      const citations = Array.isArray(data && data.citations) ? data.citations : [];
      const byId = new Map((sources || []).map((row) => [row.id, row]));
      return {
        text: data && typeof data.text === 'string' ? data.text : '',
        tokens: data && typeof data.tokens === 'number' ? data.tokens
          : (data && typeof data.tokensEstimate === 'number' ? data.tokensEstimate : null),
        truncated: data && typeof data.truncated === 'boolean' ? data.truncated : null,
        considered: data && Number.isFinite(data.considered) ? data.considered
          : (data && Array.isArray(data.considered) ? data.considered.length : null),
        citations: citations.map((citation) => {
          const source = byId.get(citation.sourceId) || null;
          return { ...citation, uri: source ? source.uri : (citation.uri || '') };
        }),
      };
    }

    // `limit=200` es el máximo del contrato (§8): con él la lista cargada coincide con el total en
    // perfiles normales, y si hay más se declara que el listado está acotado.
    const getSnapshot = () => request('/snapshot?limit=200');
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
          // LE-RAG-10: negociar modo antes de pedir datos. Solo se pinta el fixture si el
          // servidor PA no confirma 'api'; en ese caso se muestra la razón, nunca una lista vacía.
          if (panelState.mode !== 'api') await negotiateMode();
          if (panelState.mode !== 'api') {
            setSnapshot(null);
            setError('panel sin conexión con la API PA: ' + panelState.reason);
            return;
          }
          setSnapshot(await getSnapshot());
          setError('');
        } catch (failure) {
          const text = errorText(failure);
          setError(text ? text : 'error de transporte');
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
        'app.subtitle': 'Proyecto activo, bibliotecas, fuentes y recuperación',
        'status.client': 'Cliente montado',
        'status.api': 'API no montada',
        'status.apiOk': 'API montada',
        'status.data': 'Demo (fixtures)',
        'status.dataApi': 'Datos del proyecto',
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
        'nav.projects': 'Proyectos',
        'nav.candidates': 'Candidatos',
        'nav.overview': 'Resumen',
        'nav.workspaces': 'Workspaces',
        'nav.tracking': 'Seguimiento',
        'nav.settings': 'Ajustes',
        'nav.projectsArea': 'Proyectos y contexto',
        'nav.advanced': 'Avanzado',
        'app.module': 'Workspace Center',
        'app.tagline': 'Contexto de tus proyectos, sin tocar nada tuyo',
        'ux.a11y.area': 'Áreas del panel',
        'ux.a11y.subnav': 'Secciones del área',
        'ux.overview.sub': 'Todo lo importante de un vistazo',
        'ux.overview.projects': 'Proyectos listos',
        'ux.overview.sources': 'Documentos',
        'ux.overview.coverage': 'Cobertura',
        'ux.overview.coverageHint': '{ready} de {total} proyectos con contexto',
        'ux.overview.tracking': 'Seguimiento automático',
        'ux.overview.trackingOff': 'No disponible en esta versión',
        'ux.overview.next': 'Siguiente paso',
        'ux.overview.nextNone': 'Nada pendiente: todos tus proyectos tienen contexto.',
        'ux.overview.nextNoDocs': '«{name}» no tiene documentos todavía.',
        'ux.overview.nextNoProject': 'Registra tu primer proyecto para empezar.',
        'ux.overview.empty': 'Todavía no hay proyectos con contexto',
        'ux.overview.emptyHint': 'Registra un proyecto o añade una carpeta para empezar.',
        'ux.overview.activity': 'Actividad de proyectos',
        'ux.overview.selected': 'En esta conversación',
        'ux.overview.noSelection': 'Ninguno seleccionado',
        'ux.overview.open': 'Abrir',
        'ux.ws.title': 'Workspaces',
        'ux.ws.sub': 'Lo que DeepSeek Harness tiene abierto y lo que RAG ya conoce',
        'ux.ws.fromHost': 'Detectados por DSH',
        'ux.ws.col.project': 'Proyecto',
        'ux.ws.col.path': 'Ruta',
        'ux.ws.col.state': 'Estado',
        'ux.ws.col.docs': 'Documentos',
        'ux.ws.col.roots': 'Raíces',
        'ux.ws.stReady': 'Listo',
        'ux.ws.stNoDocs': 'Sin documentos',
        'ux.ws.stArchived': 'Archivado',
        'ux.ws.stNoPath': 'Sin ruta',
        'ux.ws.action': 'Abrir',
        'ux.ws.add': 'Añadir carpeta (avanzado)',
        'ux.ws.empty': 'No hay workspaces que mostrar',
        'ux.ws.emptyHint': 'Registra un proyecto o añade una carpeta.',
        'ux.ws.col.title': 'Nombre',
        'ux.ws.col.relation': 'Relación',
        'ux.ws.col.sessions': 'Sesiones',
        'ux.ws.stOk': 'Encontrado',
        'ux.ws.stMissing': 'No encontrado',
        'ux.ws.stUnknown': 'Sin comprobar',
        'ux.ws.relExact': 'Raíz del proyecto',
        'ux.ws.relInside': 'Dentro del proyecto',
        'ux.ws.refresh': 'Actualizar',
        'ux.ws.refreshing': 'Actualizando…',
        'ux.ws.loading': 'Leyendo los workspaces que conoce el Host…',
        'ux.ws.idle': 'Entra de nuevo en esta sección para leer la lista del Host.',
        'ux.ws.offline': 'La lista del Host necesita la API',
        'ux.ws.offlineHint': 'En modo demostración no se inventan workspaces: los datos que ves son sintéticos.',
        'ux.ws.noRegistry': 'El Host no ofrece su registro de workspaces',
        'ux.ws.noRegistryHint': 'No es una lista vacía: no hay de dónde leer. Los proyectos registrados siguen en Proyectos.',
        'ux.ws.err': 'No se pudo leer la lista de workspaces',
        'ux.ws.errCode': 'Motivo',
        'ux.ws.retry': 'Reintentar',
        'ux.ws.countProject': 'Con proyecto',
        'ux.ws.truncated': 'Se muestran {returned} de {total} workspaces.',
        'ux.ws.noSessions': 'El Host no ofreció su servicio de sesiones: no se pudo separar las sesiones vivas de las históricas.',
        'ux.ws.sessLive': '{live} vivas · {known} en total',
        'ux.ws.sessHistorical': 'Sin sesiones abiertas · {known} históricas',
        'ux.ws.sessUnknown': 'No se pudo mirar · {known} registradas',
        'ux.ws.whyTimeout': 'no respondió a tiempo',
        'ux.ws.whyError': 'la comprobación falló',
        'ux.ws.whyBudget': 'se agotó el tiempo de la petición',
        'ux.ws.whyNoStatus': 'el Host no publica su estado',
        'ux.ws.readOnly': 'Sólo lectura: esta lista no autoriza, no indexa ni cambia nada del Host.',
        'ux.track.title': 'Seguimiento automático',
        'ux.track.sub': 'Una sola decisión: que RAG mantenga el contexto al día por ti',
        'ux.track.off': 'No disponible en esta versión',
        'ux.track.offHint': 'El modo fácil necesita la detección de workspaces del Host y tus decisiones de autorización. Llegará en una fase posterior; hoy el seguimiento es manual.',
        'ux.track.step1': '1 · Leer la lista de workspaces',
        'ux.track.step1Hint': 'Sólo nombre y ruta; nunca el contenido.',
        'ux.track.step2': '2 · Leer las carpetas que aceptes',
        'ux.track.step2Hint': 'Una por una: autorizar una carpeta no autoriza a sus subcarpetas.',
        'ux.track.step3': '3 · Preparar el contexto',
        'ux.track.step3Hint': 'Al abrir el proyecto, sin que hagas nada.',
        'ux.track.manual': 'Mientras tanto: anade carpetas desde Proyectos y actualiza el contexto cuando quieras.',
        'ux.set.title': 'Ajustes',
        'ux.projects.summary': 'Resumen',
        'ux.state.active': 'Activa',
        'ux.state.ok': 'Correcto',
        'ux.state.degraded': 'Degradado',
        'ux.set.docsHint': 'en el proyecto activo',
        'ux.set.coverageHint': 'de tus proyectos',
        'ux.ws.current': 'Seleccionado',
        'ux.ws.available': 'Disponible',
        'ux.track.easy': 'Modo fácil',
        'ux.set.d.diagnostics': 'Almacenes, ámbitos y verificaciones',
        'ux.set.d.connection': 'Adaptador y compuerta de autorización',
        'ux.set.d.history': 'Auditoría de operaciones',
        'ux.set.d.operations': 'Ingesta y reindexación',
        'ux.set.d.candidates': 'Carpetas fuera de DSH',
        'ux.set.sub': 'Estado del servicio y herramientas técnicas',
        'ux.set.health': 'Salud',
        'ux.set.advanced': 'Avanzado',
        'ux.set.service': 'Servicio',
        'ux.set.api': 'API del panel',
        'ux.set.mode': 'Modo',
        'ux.set.apiMode': 'Conectado',
        'ux.set.synthetic': 'Sintético (fixtures)',
        'ux.set.audit': 'Auditorías',
        'ux.set.docs': 'Documentos indexados',
        'ux.set.hint': 'Los códigos técnicos y el detalle de la API viven en estas secciones.',
        'ux.state.ready': 'Listo',
        'ux.state.partial': 'Con acceso',
        'ux.state.detected': 'Detectado',
        'ux.state.missing': 'No encontrado',
        'ux.path.show': 'Mostrar ruta',
        'ux.path.hide': 'Ocultar',
        'ux.path.copy': 'Copiar ruta',
        'ux.path.copied': 'Copiada',
        'ux.projects.sub': 'Proyectos registrados y su contexto',
        'ux.projects.manage': 'Administrar proyectos',
        'ux.projects.select': 'Usar en esta conversación',
        'ux.chip.soon': 'Próximamente',
        'ux.loading': 'Cargando…',
        'admin.title': 'Administración de proyectos',
        'admin.hint': 'Crear, renombrar, archivar y restaurar proyectos, y gestionar sus raíces. Son acciones humanas: el agente no las ejecuta.',
        'admin.offline': 'La API no responde: la administración no está disponible.',
        'admin.active': 'Activos',
        'admin.archived': 'Archivados',
        'admin.create': 'Crear proyecto',
        'admin.name': 'Nombre',
        'admin.path': 'Ruta',
        'admin.pathHint': 'Opcional: registra también esta ruta como primera raíz',
        'admin.rename': 'Renombrar',
        'admin.save': 'Guardar',
        'admin.cancel': 'Cancelar',
        'admin.archive': 'Archivar',
        'admin.restore': 'Restaurar',
        'admin.roots': 'Raíces',
        'admin.addRoot': 'Añadir raíz',
        'admin.removeRoot': 'Quitar',
        'admin.rootPath': 'Ruta de la raíz',
        'admin.rootsHint': 'Quitar una raíz no borra archivos ni fuentes: sólo deja de resolver por ella.',
        'admin.archiveHint': 'Archivar es lógico: el almacén y las fuentes se conservan y se puede restaurar.',
        'admin.selectable': 'Seleccionable',
        'admin.blocked': 'Sin raíz autorizada',
        'admin.emptyActive': 'No hay proyectos activos.',
        'admin.emptyArchived': 'No hay proyectos archivados.',
        'admin.busy': 'Guardando…',
        'admin.confirmArchive': '¿Archivar «{name}»?',
        'admin.current': 'Seleccionado',
        'admin.done.create': 'Proyecto creado.',
        'admin.done.update': 'Nombre actualizado.',
        'admin.done.archive': 'Proyecto archivado.',
        'admin.done.restore': 'Proyecto restaurado.',
        'admin.done.rootAdd': 'Raíz añadida.',
        'admin.done.rootRemove': 'Raíz retirada.',
        'admin.err.project-not-found': 'El proyecto ya no existe en este perfil.',
        'admin.err.root-overlap': 'Esa raíz se solapa con otra ya autorizada.',
        'admin.err.invalid-argument': 'Revisa los datos: la ruta o el nombre no son válidos.',
        'admin.err.source-not-found': 'Esa raíz ya no existe.',
        'admin.err.authorization-unavailable': 'El host no está autenticando esta petición.',
        'admin.err.unauthenticated': 'Sesión no autenticada.',
        'admin.err.generic': 'No se pudo completar la operación ({code}).',
        'candidates.title': 'Candidatos',
        'candidates.hint': 'El descubrimiento no registra nada: muestra lo que hay y tú decides qué registrar.',
        'candidates.scan': 'Buscar candidatos',
        'candidates.scanning': 'Explorando…',
        'candidates.root': 'Raíz explorada',
        'candidates.detected': 'Proyecto detectado',
        'candidates.registered': 'Registrado',
        'candidates.register': 'Registrar',
        'candidates.registering': 'Registrando…',
        'candidates.empty': 'No se han encontrado proyectos en esa raíz.',
        'candidates.needRoot': 'Indica una ruta o elige un proyecto con una sola raíz autorizada.',
        'candidates.done': 'Candidato registrado.',
        'candidates.truncated': 'La exploración se detuvo en el límite: hay más proyectos de los mostrados.',
        'candidates.skipped': 'Omitidos: {count}',
        'candidates.err.scope-unresolved': 'Esa raíz no está autorizada para lectura: añádela a un proyecto o autorízala con la CLI.',
        'candidates.err.invalid-argument': 'La ruta no es válida o falta.',
        'candidates.err.generic': 'No se pudo explorar ({code}).',
        'view.registerHint': 'Este proyecto no está registrado en el perfil. Puedes registrarlo desde Candidatos o con el comando de la CLI.',
        'view.goCandidates': 'Ir a Candidatos',
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
        'project.candidates': 'Proyectos',
        'project.project': 'Proyecto',
        'project.selection': 'Selección',
        'project.source': 'Origen',
        'project.source.explicit': 'explícita',
        'project.source.cwd': 'directorio de trabajo',
        'project.revision': 'Revisión',
        'project.scopes': 'Contextos disponibles',
        'project.service': 'Servicio',
        'project.current': 'actual',
        'project.select': 'Seleccionar',
        'project.selectionCas': 'El cambio se aplica al instante. Si otro panel cambia la selección a la vez, se avisa y no se pisa tu elección.',
        'libraries.title': 'Bibliotecas autorizadas',
        'libraries.readonly': 'Sólo lectura: el panel no concede ni revoca bibliotecas.',
        'libraries.allPresent': 'Todos los almacenes disponibles',
        'libraries.empty': 'No hay bibliotecas concedidas para este proyecto.',
        'libraries.gap': 'Una biblioteca revocada desaparece de esta lista; su causa se explica en el proyecto.',
        'sources.title': 'Fuentes del proyecto',
        'sources.empty': 'Este proyecto no tiene fuentes indexadas.',
        'sources.showing': 'Mostrando {shown} de {total}',
        'sources.capped': 'El listado carga las primeras {loaded} fuentes de {total}; las demás se consultan con las herramientas lifecode_rag_*.',
        'sources.filter': 'Sólo lectura: la ingesta se hace con las herramientas del agente, nunca desde el panel.',
        'source.title': 'Detalle de fuente',
        'source.notFound': 'La fuente ya no está disponible.',
        'source.chunksShown': 'Se muestran {shown} de {total} fragmentos.',
        'source.chunksPending': 'La API PA todavía no expone el texto de los fragmentos: aquí sólo se muestran los metadatos de la fuente.',
        'source.gap05': 'GAP-05: esta versión no pagina fragmentos; el detalle se limita a los primeros.',
        'source.meta': 'Metadatos',
        'search.title': 'Búsqueda',
        'search.placeholder': 'Texto a buscar en el proyecto',
        'search.run': 'Buscar',
        'search.running': 'Buscando…',
        'search.limit': 'Resultados',
        'search.mode': 'Modo',
        'search.elapsed': 'Duración',
        'search.results': 'Resultados con procedencia',
        'search.scope': 'Ámbito',
        'search.score': 'Puntuación',
        'search.noResults': 'Sin resultados para esa consulta.',
        'search.failed': 'La búsqueda falló',
        'search.hint': 'La búsqueda se ejecuta sobre datos sintéticos; no consulta el motor.',
        'search.hintApi': 'La búsqueda consulta el motor del proyecto activo y devuelve procedencia por fuente.',
        'search.openContext': 'Construir contexto con estos resultados',
        'context.title': 'Contexto recuperado',
        'context.build': 'Construir contexto',
        'context.empty': 'Ejecuta una búsqueda y construye el contexto con sus resultados.',
        'context.tokens': 'Tokens estimados',
        'context.truncated': 'Truncado',
        'context.considered': 'Fragmentos considerados',
        'context.citations': 'Citas',
        'context.failed': 'No se pudo construir el contexto',
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
        'operations.hostOnly': 'Las operaciones de escritura (ingesta, olvido, reindexación) no se ejecutan desde el panel: la API PA responde 403 y exige aprobación del host. Se lanzan con las herramientas lifecode_rag_*.',
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
        'diagnostics.pendingApi': 'Integridad, auditoría y versiones todavía no se leen de la API PA: esta vista muestra sólo los ámbitos efectivos del proyecto.',
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
        'connection.noticeLive': 'Conectado a la API del panel: el estado se lee del almacén del perfil y cualquier escritura sigue exigiendo aprobación del host.',
        'connection.serviceDetail': 'Servicio degradado: {missing} de {total} almacenes no disponible(s).',
        'history.title': 'Historial del proyecto',
        'history.unavailable': 'No disponible en esta versión',
        'history.why': 'La API no ha devuelto un historial para este proyecto. La vista no inventa entradas.',
        'history.route': 'No se inventa una ruta: la vista queda deshabilitada hasta que la API responda.',
        'history.simulated': 'Las operaciones de esta sesión se registran en la vista Operaciones, no aquí.',
        'history.subtitle': 'Cadena de auditoría del almacén del proyecto activo, de más reciente a más antigua.',
        'history.chainOk': 'Cadena verificada ({count} entradas)',
        'history.chainBroken': 'Cadena rota en la entrada {at} ({reason})',
        'history.empty': 'Este proyecto todavía no tiene operaciones auditadas.',
        'history.col.seq': 'N.º',
        'history.col.at': 'Fecha',
        'history.col.actor': 'Actor',
        'history.col.tool': 'Herramienta',
        'history.col.action': 'Acción',
        'history.col.target': 'Objetivo',
        'history.col.outcome': 'Resultado',
        'history.col.hash': 'Hash',
        'history.page': 'Página {page} de {pages}',
        'history.more': 'Cargar más',
        'history.total': 'Total',
        'history.toOperations': 'Ver operaciones simuladas',
        'notice.sameProject': 'Ese proyecto ya está seleccionado; no hubo cambios.',
        'notice.selected': 'Selección guardada en el perfil (revisión {revision}).',
        'notice.selectedFixture': 'Selección simulada: la revisión subió y el cambio quedó anotado en Operaciones.',
        'notice.selectionConflict': 'Otro panel cambió la selección antes: se recargó la revisión vigente y no se sobrescribió nada.',
        'notice.selectionFailed': 'No se pudo guardar la selección ({reason}); no se cambió nada.',
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
        'app.subtitle': 'Active project, libraries, sources and retrieval',
        'status.client': 'Client mounted',
        'status.api': 'API not mounted',
        'status.apiOk': 'API mounted',
        'status.data': 'Demo (fixtures)',
        'status.dataApi': 'Project data',
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
        'nav.projects': 'Projects',
        'nav.candidates': 'Candidates',
        'nav.overview': 'Overview',
        'nav.workspaces': 'Workspaces',
        'nav.tracking': 'Tracking',
        'nav.settings': 'Settings',
        'nav.projectsArea': 'Projects & context',
        'nav.advanced': 'Advanced',
        'app.module': 'Workspace Center',
        'app.tagline': 'Context for your projects, without touching anything of yours',
        'ux.a11y.area': 'Panel areas',
        'ux.a11y.subnav': 'Area sections',
        'ux.overview.sub': 'Everything important at a glance',
        'ux.overview.projects': 'Projects ready',
        'ux.overview.sources': 'Documents',
        'ux.overview.coverage': 'Coverage',
        'ux.overview.coverageHint': '{ready} of {total} projects with context',
        'ux.overview.tracking': 'Automatic tracking',
        'ux.overview.trackingOff': 'Not available in this version',
        'ux.overview.next': 'Next step',
        'ux.overview.nextNone': 'Nothing pending: every project has context.',
        'ux.overview.nextNoDocs': '"{name}" has no documents yet.',
        'ux.overview.nextNoProject': 'Register your first project to get started.',
        'ux.overview.empty': 'No projects with context yet',
        'ux.overview.emptyHint': 'Register a project or add a folder to get started.',
        'ux.overview.activity': 'Project activity',
        'ux.overview.selected': 'In this conversation',
        'ux.overview.noSelection': 'None selected',
        'ux.overview.open': 'Open',
        'ux.ws.title': 'Workspaces',
        'ux.ws.sub': 'What DeepSeek Harness has open and what RAG already knows',
        'ux.ws.fromHost': 'Detected by DSH',
        'ux.ws.col.project': 'Project',
        'ux.ws.col.path': 'Path',
        'ux.ws.col.state': 'State',
        'ux.ws.col.docs': 'Documents',
        'ux.ws.col.roots': 'Roots',
        'ux.ws.stReady': 'Ready',
        'ux.ws.stNoDocs': 'No documents',
        'ux.ws.stArchived': 'Archived',
        'ux.ws.stNoPath': 'No path',
        'ux.ws.action': 'Open',
        'ux.ws.add': 'Add folder (advanced)',
        'ux.ws.empty': 'No workspaces to show',
        'ux.ws.emptyHint': 'Register a project or add a folder.',
        'ux.ws.col.title': 'Name',
        'ux.ws.col.relation': 'Relation',
        'ux.ws.col.sessions': 'Sessions',
        'ux.ws.stOk': 'Found',
        'ux.ws.stMissing': 'Not found',
        'ux.ws.stUnknown': 'Not checked',
        'ux.ws.relExact': 'Project root',
        'ux.ws.relInside': 'Inside project',
        'ux.ws.refresh': 'Refresh',
        'ux.ws.refreshing': 'Refreshing…',
        'ux.ws.loading': 'Reading the workspaces the Host knows about…',
        'ux.ws.idle': 'Open this section again to read the Host list.',
        'ux.ws.offline': 'The Host list needs the API',
        'ux.ws.offlineHint': 'Demo mode does not invent workspaces: the data you see is synthetic.',
        'ux.ws.noRegistry': 'The Host does not provide its workspace registry',
        'ux.ws.noRegistryHint': 'This is not an empty list: there is nowhere to read from. Registered projects remain under Projects.',
        'ux.ws.err': 'Could not read the workspace list',
        'ux.ws.errCode': 'Reason',
        'ux.ws.retry': 'Retry',
        'ux.ws.countProject': 'With project',
        'ux.ws.truncated': 'Showing {returned} of {total} workspaces.',
        'ux.ws.noSessions': 'The Host did not provide its session service: live and historical sessions could not be separated.',
        'ux.ws.sessLive': '{live} live · {known} total',
        'ux.ws.sessHistorical': 'No open sessions · {known} historical',
        'ux.ws.sessUnknown': 'Could not check · {known} recorded',
        'ux.ws.whyTimeout': 'it did not answer in time',
        'ux.ws.whyError': 'the check failed',
        'ux.ws.whyBudget': 'the request ran out of time',
        'ux.ws.whyNoStatus': 'the Host does not publish its status',
        'ux.ws.readOnly': 'Read-only: this list does not authorize, index, or change anything in the Host.',
        'ux.track.title': 'Automatic tracking',
        'ux.track.sub': 'One single decision: let RAG keep context up to date for you',
        'ux.track.off': 'Not available in this version',
        'ux.track.offHint': 'Easy mode needs Host workspace detection and your authorization decisions. It arrives in a later phase; today tracking is manual.',
        'ux.track.step1': '1 · Read the workspace list',
        'ux.track.step1Hint': 'Name and path only; never the content.',
        'ux.track.step2': '2 · Read the folders you accept',
        'ux.track.step2Hint': 'One by one: authorizing a folder does not authorize its subfolders.',
        'ux.track.step3': '3 · Prepare the context',
        'ux.track.step3Hint': 'When you open the project, without you doing anything.',
        'ux.track.manual': 'Meanwhile: add folders from Projects and refresh context whenever you want.',
        'ux.set.title': 'Settings',
        'ux.projects.summary': 'Summary',
        'ux.state.active': 'Active',
        'ux.state.ok': 'OK',
        'ux.state.degraded': 'Degraded',
        'ux.set.docsHint': 'in the active project',
        'ux.set.coverageHint': 'of your projects',
        'ux.ws.current': 'Selected',
        'ux.ws.available': 'Available',
        'ux.track.easy': 'Easy mode',
        'ux.set.d.diagnostics': 'Stores, scopes and checks',
        'ux.set.d.connection': 'Adapter and authorization gate',
        'ux.set.d.history': 'Operation audit',
        'ux.set.d.operations': 'Ingest and reindex',
        'ux.set.d.candidates': 'Folders outside DSH',
        'ux.set.sub': 'Service status and technical tools',
        'ux.set.health': 'Health',
        'ux.set.advanced': 'Advanced',
        'ux.set.service': 'Service',
        'ux.set.api': 'Panel API',
        'ux.set.mode': 'Mode',
        'ux.set.apiMode': 'Connected',
        'ux.set.synthetic': 'Synthetic (fixtures)',
        'ux.set.audit': 'Audits',
        'ux.set.docs': 'Indexed documents',
        'ux.set.hint': 'Technical codes and API detail live in these sections.',
        'ux.state.ready': 'Ready',
        'ux.state.partial': 'With access',
        'ux.state.detected': 'Detected',
        'ux.state.missing': 'Not found',
        'ux.path.show': 'Show path',
        'ux.path.hide': 'Hide',
        'ux.path.copy': 'Copy path',
        'ux.path.copied': 'Copied',
        'ux.projects.sub': 'Registered projects and their context',
        'ux.projects.manage': 'Manage projects',
        'ux.projects.select': 'Use in this conversation',
        'ux.chip.soon': 'Coming soon',
        'ux.loading': 'Loading…',
        'admin.title': 'Project administration',
        'admin.hint': 'Create, rename, archive and restore projects, and manage their roots. These are human actions: the agent does not run them.',
        'admin.offline': 'The API is not responding: administration is unavailable.',
        'admin.active': 'Active',
        'admin.archived': 'Archived',
        'admin.create': 'Create project',
        'admin.name': 'Name',
        'admin.path': 'Path',
        'admin.pathHint': 'Optional: also register this path as the first root',
        'admin.rename': 'Rename',
        'admin.save': 'Save',
        'admin.cancel': 'Cancel',
        'admin.archive': 'Archive',
        'admin.restore': 'Restore',
        'admin.roots': 'Roots',
        'admin.addRoot': 'Add root',
        'admin.removeRoot': 'Remove',
        'admin.rootPath': 'Root path',
        'admin.rootsHint': 'Removing a root deletes no files or sources: it only stops resolving through it.',
        'admin.archiveHint': 'Archiving is logical: the store and sources are kept and it can be restored.',
        'admin.selectable': 'Selectable',
        'admin.blocked': 'No authorized root',
        'admin.emptyActive': 'No active projects.',
        'admin.emptyArchived': 'No archived projects.',
        'admin.busy': 'Saving…',
        'admin.confirmArchive': 'Archive “{name}”?',
        'admin.current': 'Selected',
        'admin.done.create': 'Project created.',
        'admin.done.update': 'Name updated.',
        'admin.done.archive': 'Project archived.',
        'admin.done.restore': 'Project restored.',
        'admin.done.rootAdd': 'Root added.',
        'admin.done.rootRemove': 'Root removed.',
        'admin.err.project-not-found': 'That project no longer exists in this profile.',
        'admin.err.root-overlap': 'That root overlaps another authorized root.',
        'admin.err.invalid-argument': 'Check the data: the path or the name is not valid.',
        'admin.err.source-not-found': 'That root no longer exists.',
        'admin.err.authorization-unavailable': 'The host is not authenticating this request.',
        'admin.err.unauthenticated': 'Session not authenticated.',
        'admin.err.generic': 'The operation could not be completed ({code}).',
        'candidates.title': 'Candidates',
        'candidates.hint': 'Discovery writes nothing: it shows what is there and you decide what to register.',
        'candidates.scan': 'Find candidates',
        'candidates.scanning': 'Scanning…',
        'candidates.root': 'Scanned root',
        'candidates.detected': 'Detected project',
        'candidates.registered': 'Registered',
        'candidates.register': 'Register',
        'candidates.registering': 'Registering…',
        'candidates.empty': 'No projects found under that root.',
        'candidates.needRoot': 'Give a path or pick a project with a single authorized root.',
        'candidates.done': 'Candidate registered.',
        'candidates.truncated': 'The scan hit the limit: there are more projects than shown.',
        'candidates.skipped': 'Skipped: {count}',
        'candidates.err.scope-unresolved': 'That root is not authorized for reading: add it to a project or authorize it with the CLI.',
        'candidates.err.invalid-argument': 'The path is not valid or is missing.',
        'candidates.err.generic': 'Scan failed ({code}).',
        'view.registerHint': 'This project is not registered in the profile. You can register it from Candidates or with the CLI command.',
        'view.goCandidates': 'Go to Candidates',
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
        'project.candidates': 'Projects',
        'project.project': 'Project',
        'project.selection': 'Selection',
        'project.source': 'Origin',
        'project.source.explicit': 'explicit',
        'project.source.cwd': 'working directory',
        'project.revision': 'Revision',
        'project.scopes': 'Available contexts',
        'project.service': 'Service',
        'project.current': 'current',
        'project.select': 'Select',
        'project.selectionCas': 'The change applies immediately. If another panel changes the selection at the same time, you are warned and your choice is never overwritten.',
        'libraries.title': 'Authorized libraries',
        'libraries.readonly': 'Read-only: the panel neither grants nor revokes libraries.',
        'libraries.allPresent': 'All stores available',
        'libraries.empty': 'No libraries granted for this project.',
        'libraries.gap': 'A revoked library disappears from this list; the cause is explained in the project view.',
        'sources.title': 'Project sources',
        'sources.empty': 'This project has no indexed sources.',
        'sources.showing': 'Showing {shown} of {total}',
        'sources.capped': 'The list loads the first {loaded} sources of {total}; the rest are reachable with the lifecode_rag_* tools.',
        'sources.filter': 'Read-only: ingestion runs through the agent tools, never from this panel.',
        'source.title': 'Source detail',
        'source.notFound': 'The source is no longer available.',
        'source.chunksShown': 'Showing {shown} of {total} chunks.',
        'source.chunksPending': 'The PA API does not expose chunk text yet: only source metadata is shown here.',
        'source.gap05': 'GAP-05: this version does not paginate chunks; detail is limited to the first ones.',
        'source.meta': 'Metadata',
        'search.title': 'Search',
        'search.placeholder': 'Text to search in the project',
        'search.run': 'Search',
        'search.running': 'Searching…',
        'search.limit': 'Results',
        'search.mode': 'Mode',
        'search.elapsed': 'Duration',
        'search.results': 'Results with provenance',
        'search.scope': 'Scope',
        'search.score': 'Score',
        'search.noResults': 'No results for that query.',
        'search.failed': 'Search failed',
        'search.hint': 'Search runs over synthetic data; it does not query the engine.',
        'search.hintApi': 'Search queries the active project engine and reports provenance per source.',
        'search.openContext': 'Build context from these results',
        'context.title': 'Retrieved context',
        'context.build': 'Build context',
        'context.empty': 'Run a search and build the context from its results.',
        'context.tokens': 'Estimated tokens',
        'context.truncated': 'Truncated',
        'context.considered': 'Chunks considered',
        'context.citations': 'Citations',
        'context.failed': 'Context could not be built',
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
        'operations.hostOnly': 'Write operations (ingest, forget, reindex) never run from this panel: the PA API answers 403 and the host must authorize them. They run through the lifecode_rag_* tools.',
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
        'diagnostics.pendingApi': 'Integrity, audit and versions are not read from the PA API yet: this view only shows the effective scopes of the project.',
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
        'connection.noticeLive': 'Connected to the panel API: state is read from the profile store and every write still needs the host to confirm it.',
        'connection.serviceDetail': 'Service degraded: {missing} of {total} stores unavailable.',
        'history.title': 'Project history',
        'history.unavailable': 'Not available in this version',
        'history.why': 'The API returned no history for this project. The view does not invent entries.',
        'history.route': 'No route is invented: the view stays disabled until the API answers.',
        'history.simulated': 'The operations of this session are logged in the Operations view, not here.',
        'history.subtitle': 'Audit chain of the active project store, newest first.',
        'history.chainOk': 'Chain verified ({count} entries)',
        'history.chainBroken': 'Chain broken at entry {at} ({reason})',
        'history.empty': 'This project has no audited operations yet.',
        'history.col.seq': 'No.',
        'history.col.at': 'Date',
        'history.col.actor': 'Actor',
        'history.col.tool': 'Tool',
        'history.col.action': 'Action',
        'history.col.target': 'Target',
        'history.col.outcome': 'Outcome',
        'history.col.hash': 'Hash',
        'history.page': 'Page {page} of {pages}',
        'history.more': 'Load more',
        'history.total': 'Total',
        'history.toOperations': 'View simulated operations',
        'notice.sameProject': 'That project is already selected; nothing changed.',
        'notice.selected': 'Selection saved to the profile (revision {revision}).',
        'notice.selectedFixture': 'Simulated selection: the revision went up and the change was logged in Operations.',
        'notice.selectionConflict': 'Another panel changed the selection first: the current revision was reloaded and nothing was overwritten.',
        'notice.selectionFailed': 'The selection could not be saved ({reason}); nothing changed.',
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

    /**
     * Traduce una operación de administración a su ruta de `pa/1.3.0`. El panel sólo envía lo que la
     * persona pidió: no hay reintentos automáticos ni operaciones implícitas.
     */
    async function adminRequest(op) {
      const post = (path, body) => request(path, { method: 'POST', body });
      switch (op.kind) {
        case 'create': return post('/projects', { name: op.name, ...(op.path ? { path: op.path } : {}) });
        case 'update': return request('/projects', { method: 'PATCH', body: { id: op.id, name: op.name } });
        case 'archive': return post('/projects/archive', { id: op.id });
        case 'restore': return post('/projects/restore', { id: op.id });
        case 'rootAdd': return post('/roots', { projectId: op.projectId, path: op.path });
        case 'rootRemove': return post('/roots/remove', { rootId: op.rootId });
        default: {
          const unknown = new Error('operación de administración desconocida');
          unknown.code = 'invalid-argument';
          throw unknown;
        }
      }
    }

    function paInitialState() {
      const fx = paFixtures();
      return {
        view: 'overview',
        mode: 'fixture',
        // Sin petición en curso. Explícito: el reducer distingue «libre» (null) de «ocupado» y una
        // clave ausente no es lo mismo que null al comparar.
        pending: null,
        session: fx.session,
        projects: fx.projects,
        libraries: fx.libraries,
        sources: fx.sources,
        sourcePage: { limit: PA_PAGE_LIMIT, offset: 0 },
        history: { entries: [], total: 0, nextCursor: null, integrity: null, pages: 1, loaded: false, error: null },
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
        // F4 · administración y descubrimiento. `archived` y `capabilities` vienen del snapshot
        // (aditivos en pa/1.3.0); `admin` y `candidates` son estado de la propia interfaz.
        archived: [],
        capabilities: null,
        admin: {
          busy: null,
          notice: null,
          error: null,
          draft: { name: '', path: '' },
          rootDraft: '',
          rootsFor: null,
          renaming: null,
          renameValue: '',
        },
        adminOp: null,
        // Raíces por proyecto (aditivo del snapshot pa/1.3.0): la interfaz necesita las rutas para
        // poder retirar una concreta; el recuento del proyecto no basta.
        roots: [],
        candidates: {
          loaded: false,
          loading: false,
          rows: [],
          root: null,
          error: null,
          truncated: false,
          skippedCount: 0,
          registering: null,
          scanPath: '',
        },
        // UX-2.1 · workspaces que conoce el Host (sólo lectura). `loaded` separa «todavía no se ha
        // pedido» de «se pidió y no hay ninguno»: sin esa diferencia, un fallo se pintaría como una
        // lista vacía legítima, que es justo lo que la fase prohíbe.
        workspaces: {
          loaded: false,
          loading: false,
          error: null,
          source: null,
          reason: null,
          items: [],
          counts: null,
          truncated: false,
          fetchedAt: null,
        },
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
        case 'hydrate': {
          const snapshot = action.snapshot || {};
          const rows = (snapshot.sources && snapshot.sources.rows) || [];
          // Las filas vienen de la API: se copia lo que la API entrega y nada más. Heredar campos del
          // fixture (colección, texto de fragmentos) sería inventar datos sobre un proyecto real.
          const fuentes = rows.map((r) => ({
            id: r.id,
            uri: r.uri,
            title: r.title,
            mime: r.mime,
            bytes: Number(r.bytes) || 0,
            chunks: Number(r.chunks) || 0,
            collection: r.collection || null,
            indexedAt: r.indexedAt ?? null,
            updatedAt: r.updatedAt ?? r.indexedAt ?? null,
            api: true,
          }));
          const scopesRaw = Array.isArray(snapshot.scopes) ? snapshot.scopes : [];
          const prjScopes = scopesRaw.filter((scope) => (scope.kind || 'prj') === 'prj');
          // CR-1: la lista de proyectos seleccionables viene del perfil (`snapshot.projects`), no sólo
          // del proyecto activo; si el servidor no la trae, se conserva la derivación anterior.
          const proyectos = Array.isArray(snapshot.projects) && snapshot.projects.length > 0
            ? snapshot.projects.map((row) => ({
                id: row.id,
                name: row.name || row.id,
                current: Boolean(row.current),
                rootCount: Number(row.roots) || 0,
                // F4: aditivos de pa/1.3.0. Si el servidor no los manda, se asume lo anterior
                // (activo y seleccionable sólo si tiene raíz autorizada).
                status: row.status || 'active',
                selectable: row.selectable === undefined ? (Number(row.roots) || 0) > 0 : Boolean(row.selectable),
                rootsTotal: Number.isFinite(Number(row.total)) ? Number(row.total) : (Number(row.roots) || 0),
              }))
            : (prjScopes.length > 0
              ? prjScopes.map((scope) => ({
                  id: scope.id,
                  name: scope.name || scope.id,
                  current: Boolean(snapshot.project) && scope.id === snapshot.project.id,
                  rootCount: Number(scope.roots) || 0,
                }))
              : (state.projects || []).map((p, index) => (index === 0 && snapshot.project
                  ? { ...p, id: snapshot.project.id, name: snapshot.project.name } : p)));
          const archivados = (Array.isArray(snapshot.archived) ? snapshot.archived : []).map((row) => ({
            id: row.id,
            name: row.name || row.id,
            rootCount: Number(row.roots) || 0,
            rootsTotal: Number.isFinite(Number(row.total)) ? Number(row.total) : (Number(row.roots) || 0),
            archivedAt: row.archivedAt ?? null,
          }));
          const totalFuentes = Number(snapshot.sources && snapshot.sources.total);
          const libraries = (Array.isArray(snapshot.libraries) ? snapshot.libraries : []).map((lib, index) => ({
            id: lib.id || ('lib_' + index),
            name: lib.name || lib.id || '—',
            permission: lib.permission || 'read',
            grantedAt: Number(lib.grantedAt) || 0,
            grantedBy: lib.grantedBy || null,
            store: lib.store || (Number(lib.roots) > 0 ? 'present' : 'missing'),
            roots: Number(lib.roots) || 0,
          }));
          const serviceStatus = snapshot.service || 'ok';
          const selection = state.session.session.selection;
          return {
            ...state,
            mode: 'api',
            pending: null,
            apiVersion: snapshot.version || state.apiVersion || null,
            error: null,
            libraries,
            projects: proyectos,
            archived: archivados,
            capabilities: snapshot.capabilities || state.capabilities,
            roots: (Array.isArray(snapshot.roots) ? snapshot.roots : []).map((row) => ({
              scopeId: row.scopeId,
              id: row.id,
              path: row.path,
              state: row.state || 'authorized',
            })),
            sources: fuentes,
            sourcesTotal: Number.isFinite(totalFuentes) ? totalFuentes : fuentes.length,
            sourcePage: { ...(state.sourcePage || {}), offset: 0 },
            session: {
              ...state.session,
              scopeCount: scopesRaw.length,
              project: snapshot.project
                ? { ...(state.session.project || {}), id: snapshot.project.id, name: snapshot.project.name, status: 'active' }
                : state.session.project,
              service: { ...(state.session.service || {}), status: serviceStatus },
              session: {
                ...state.session.session,
                // CR-1: la revisión que se muestra es la CONFIRMADA por el servidor, no una local.
                selection: snapshot.selection
                  ? {
                    ...selection,
                    projectId: snapshot.selection.projectId,
                    projectName: snapshot.selection.projectName ?? (snapshot.project ? snapshot.project.name : selection.projectName),
                    state: 'active',
                    source: snapshot.selection.source || 'explicit',
                    selectedBy: snapshot.selection.selectedBy ?? selection.selectedBy,
                    selectedAt: snapshot.selection.selectedAt ?? selection.selectedAt,
                    revision: snapshot.selection.revision,
                  }
                  : (snapshot.project
                    ? { ...selection, projectId: snapshot.project.id, projectName: snapshot.project.name, state: 'active', source: 'explicit' }
                    : selection),
              },
            },
            diagnostics: scopesRaw.length > 0
              ? { ...state.diagnostics, scopes: scopesRaw.map((scope) => ({
                  kind: scope.kind || 'prj',
                  id: scope.id,
                  name: scope.name || scope.id,
                  store: Number(scope.roots) > 0 ? 'present' : 'missing',
                  verified: true,
                })) }
              : state.diagnostics,
            health: { ...state.health, status: serviceStatus },
          };
        }
        case 'unavailable':
          return { ...state, mode: 'down', error: action.reason || 'unavailable' };
        case 'reset':
          return paInitialState();
        case 'nav': {
          const wantsHistory = action.view === 'history' && state.mode === 'api'
            && !state.history.loaded && state.pending === null;
          // UX-2.1: el registro de workspaces del Host no emite eventos de apertura ni de cierre, así
          // que la lista se refresca AL ENTRAR en la sección (y con «Actualizar»). Se conserva lo ya
          // pintado mientras llega la respuesta; `loading` no vacía las filas.
          const wantsWorkspaces = action.view === 'workspaces' && state.mode === 'api'
            && state.pending === null;
          return {
            ...state,
            view: action.view,
            notice: null,
            ...(wantsHistory ? { pending: 'history' } : {}),
            ...(wantsWorkspaces
              ? { pending: 'workspaces', workspaces: { ...state.workspaces, loading: true, error: null } }
              : {}),
          };
        }
        case 'select-project': {
          const current = state.session.session.selection;
          if (!action.projectId || action.projectId === current.projectId) {
            return { ...state, notice: { code: 'notice.sameProject' } };
          }
          const project = state.projects.find((row) => row.id === action.projectId);
          if (!project) return { ...state, notice: { code: 'notice.sameProject' } };
          // CR-1: en modo API la selección la confirma el servidor con CAS sobre la revisión. El
          // panel NO adelanta el cambio: hasta que la respuesta llega, se sigue pintando la última
          // revisión confirmada.
          if (state.mode === 'api') {
            return {
              ...state,
              notice: null,
              pending: 'selection',
              selectionPending: { projectId: project.id, projectName: project.name, expectedRevision: current.revision },
            };
          }
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
            notice: { code: 'notice.selectedFixture' },
          };
        }
        case 'selection-ok': {
          const confirmed = action.selection;
          const project = state.projects.find((row) => row.id === confirmed.projectId);
          const entry = paJournalEntry(state, 'selection', confirmed.projectName || (project ? project.name : confirmed.projectId));
          return {
            ...state,
            // Las fuentes del proyecto anterior NO valen en el nuevo: se vacían y se pide el snapshot
            // del proyecto confirmado (si no, se pintarían filas ajenas con el nombre nuevo).
            pending: 'snapshot',
            sources: [],
            sourcesTotal: 0,
            results: null,
            context: null,
            selectedSourceId: null,
            selectionPending: null,
            session: {
              ...state.session,
              session: {
                ...state.session.session,
                selection: {
                  ...state.session.session.selection,
                  projectId: confirmed.projectId,
                  projectName: confirmed.projectName || (project ? project.name : confirmed.projectId),
                  state: 'active',
                  source: confirmed.source || 'explicit',
                  selectedBy: confirmed.selectedBy ?? 'human',
                  selectedAt: confirmed.selectedAt ?? Date.now(),
                  revision: confirmed.revision,
                },
              },
            },
            projects: state.projects.map((row) => ({ ...row, current: row.id === confirmed.projectId })),
            clock: entry.clock,
            opSeq: entry.seq,
            journal: entry.journal,
            notice: { code: 'notice.selected', values: { revision: confirmed.revision } },
          };
        }
        case 'selection-error':
          return {
            ...state,
            pending: null,
            selectionPending: null,
            notice: {
              code: action.reason === 'revision-conflict' ? 'notice.selectionConflict' : 'notice.selectionFailed',
              values: { reason: action.reason || 'transport-error' },
            },
          };
        case 'history-ok': {
          const page = action.page || {};
          const entries = Array.isArray(page.entries) ? page.entries : [];
          const merged = action.append ? [...state.history.entries, ...entries] : entries;
          const limit = 50;
          return {
            ...state,
            pending: null,
            history: {
              entries: merged,
              total: Number.isFinite(page.total) ? page.total : merged.length,
              nextCursor: page.nextCursor ?? null,
              integrity: page.integrity ?? state.history.integrity,
              pages: Math.max(1, Math.ceil((Number.isFinite(page.total) ? page.total : merged.length) / limit)),
              loaded: true,
              error: null,
            },
          };
        }
        case 'history-error':
          return {
            ...state,
            pending: null,
            history: { ...state.history, loaded: true, error: action.reason || 'transport-error' },
          };
        case 'history-more':
          if (!state.history.nextCursor || state.pending) return state;
          return { ...state, pending: 'history' };
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
          // En modo api la búsqueda va al motor del proyecto: el resultado lo trae el efecto.
          if (state.mode === 'api') {
            return { ...state, view: 'search', results: null, context: null, searchInvalid: null, searchError: null, notice: null, pending: 'search' };
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
        case 'search-ok':
          return { ...state, pending: null, searchError: null, view: 'search', results: action.results,
            notice: action.results && action.results.results.length === 0 ? { code: 'notice.searchEmpty' } : null };
        case 'search-error':
          return { ...state, pending: null, results: null, searchError: action.reason || 'transport-error' };
        case 'retry-view':
          return { ...state, viewEpoch: (state.viewEpoch ?? 0) + 1, notice: null };
        case 'context': {
          if (state.mode === 'api') {
            return { ...state, view: 'context', contextError: null, pending: 'context' };
          }
          const context = state.results && state.results.results.length > 0 ? paBuildContext(state, state.results.results) : null;
          return { ...state, view: 'context', context, notice: context ? null : { code: 'notice.searchEmpty' } };
        }
        case 'context-ok':
          return { ...state, pending: null, contextError: null, view: 'context', context: action.context, notice: null };
        case 'context-error':
          return { ...state, pending: null, context: null, contextError: action.reason || 'transport-error' };
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

        /* ------------------------------------------------- F4 · administración */
        case 'admin-draft':
          return {
            ...state,
            admin: {
              ...state.admin,
              error: null,
              draft: { ...state.admin.draft, [action.field]: String(action.value ?? '') },
            },
          };
        case 'admin-rename': {
          if (state.pending) return state;
          const project = state.projects.find((row) => row.id === action.projectId);
          const already = state.admin.renaming === action.projectId;
          return {
            ...state,
            admin: {
              ...state.admin,
              renaming: already ? null : action.projectId,
              renameValue: already ? '' : String(project ? project.name : ''),
              error: null,
            },
          };
        }
        case 'admin-rename-value':
          return { ...state, admin: { ...state.admin, renameValue: String(action.value ?? '') } };
        case 'admin-root-path':
          return { ...state, admin: { ...state.admin, error: null, rootDraft: String(action.value ?? '') } };
        case 'admin-roots':
          return {
            ...state,
            admin: {
              ...state.admin,
              rootsFor: state.admin.rootsFor === action.projectId ? null : action.projectId,
              rootDraft: '',
              error: null,
            },
          };
        case 'admin-op': {
          // Toda escritura va al servidor: el panel no simula administración en modo API.
          if (state.mode !== 'api') {
            return { ...state, admin: { ...state.admin, error: 'offline', notice: null } };
          }
          if (state.pending) return state;
          return {
            ...state,
            pending: 'admin',
            adminOp: { ...action.op },
            admin: { ...state.admin, busy: action.op.kind, error: null, notice: null },
          };
        }
        case 'admin-ok': {
          const kind = action.op.kind;
          return {
            ...state,
            // Se relee el snapshot del servidor: la TRUE de lo que quedó en el registro no la
            // inventa el panel. Mientras llega, se conserva lo último confirmado.
            pending: 'snapshot',
            adminOp: null,
            admin: {
              ...state.admin,
              busy: null,
              error: null,
              draft: kind === 'create' ? { name: '', path: '' } : state.admin.draft,
              rootDraft: kind === 'rootAdd' || kind === 'rootRemove' ? '' : state.admin.rootDraft,
              notice: { code: 'admin.done.' + kind },
            },
          };
        }
        case 'admin-error':
          return {
            ...state,
            pending: null,
            adminOp: null,
            admin: { ...state.admin, busy: null, error: action.reason || 'transport-error' },
          };
        case 'candidates-path':
          return {
            ...state,
            candidates: { ...state.candidates, scanPath: String(action.value ?? ''), error: null },
          };
        case 'candidates-scan': {
          if (state.mode !== 'api') {
            return { ...state, candidates: { ...state.candidates, error: 'offline' } };
          }
          if (state.pending) return state;
          return {
            ...state,
            view: 'candidates',
            pending: 'candidates',
            candidates: { ...state.candidates, loading: true, error: null },
          };
        }
        case 'candidates-ok': {
          const page = action.page || {};
          const rows = (Array.isArray(page.candidates) ? page.candidates : []).map((row) => ({
            path: row.path,
            name: row.name || row.path,
            type: row.type || 'unknown',
            indicators: Array.isArray(row.indicators) ? row.indicators : [],
            depth: Number(row.depth) || 0,
            registered: Boolean(row.registered),
            action: row.action ?? null,
          }));
          return {
            ...state,
            pending: null,
            candidates: {
              ...state.candidates,
              loaded: true,
              loading: false,
              error: null,
              rows,
              root: page.root ?? null,
              truncated: Boolean(page.truncated),
              skippedCount: Array.isArray(page.skipped) ? page.skipped.length : 0,
            },
          };
        }
        case 'candidates-error': {
          const reason = action.reason || 'transport-error';
          const key = 'candidates.err.' + reason;
          return {
            ...state,
            pending: null,
            candidates: {
              ...state.candidates,
              loading: false,
              loaded: true,
              error: reason,
              // Se resuelve aquí para no dejar en la vista una clave incompleta; si el código no
              // tiene texto propio, se usa el genérico con el código entre paréntesis.
              errorText: paTranslate('es', key) === key ? null : key,
            },
          };
        }
        case 'candidates-register': {
          if (state.mode !== 'api') {
            return { ...state, candidates: { ...state.candidates, error: 'offline' } };
          }
          if (state.pending) return state;
          return {
            ...state,
            pending: 'register',
            candidates: { ...state.candidates, registering: action.path, error: null },
          };
        }
        case 'register-ok': {
          const path = action.path;
          return {
            ...state,
            pending: 'snapshot',
            candidates: {
              ...state.candidates,
              registering: null,
              error: null,
              rows: state.candidates.rows.map((row) => (row.path === path
                ? { ...row, registered: true, action: null }
                : row)),
              done: path,
            },
          };
        }
        case 'register-error':
          return {
            ...state,
            pending: null,
            candidates: { ...state.candidates, registering: null, error: action.reason || 'transport-error' },
          };

        /* ------------------------------------------------ UX-2.1 · workspaces del Host */
        case 'workspaces-refresh': {
          if (state.mode !== 'api') {
            return { ...state, workspaces: { ...state.workspaces, error: 'offline' } };
          }
          if (state.pending) return state;
          return {
            ...state,
            view: 'workspaces',
            pending: 'workspaces',
            workspaces: { ...state.workspaces, loading: true, error: null },
          };
        }
        case 'workspaces-ok': {
          const payload = action.payload || {};
          const items = (Array.isArray(payload.items) ? payload.items : []).map((row) => {
            const rawLive = row.sessions ? row.sessions.live : null;
            return {
              id: typeof row.id === 'string' ? row.id : null,
              path: String(row.path ?? ''),
              pathKey: typeof row.pathKey === 'string' ? row.pathKey : String(row.path ?? ''),
              title: String(row.title ?? row.path ?? ''),
              state: row.state === 'ok' || row.state === 'missing' ? row.state : 'unknown',
              stateReason: typeof row.stateReason === 'string' ? row.stateReason : null,
              sessions: {
                known: Number(row.sessions && row.sessions.known) || 0,
                // `null` es «no se pudo mirar» y se conserva: convertirlo en 0 sería mentir.
                live: rawLive === null || rawLive === undefined || !Number.isFinite(Number(rawLive))
                  ? null
                  : Number(rawLive),
              },
              project: row.project && typeof row.project === 'object' && typeof row.project.id === 'string'
                ? { id: row.project.id, name: String(row.project.name ?? row.project.id) }
                : null,
              relation: row.relation === 'exact' || row.relation === 'inside' ? row.relation : 'none',
            };
          });
          return {
            ...state,
            pending: null,
            workspaces: {
              loaded: true,
              loading: false,
              error: null,
              source: payload.source === 'host' ? 'host' : 'none',
              reason: typeof payload.reason === 'string' ? payload.reason : null,
              items,
              counts: payload.counts && typeof payload.counts === 'object' ? payload.counts : null,
              truncated: Boolean(payload.truncated),
              fetchedAt: Number(payload.asOf) || Date.now(),
            },
          };
        }
        case 'workspaces-error':
          // Un fallo deja la sección en error con su motivo: nunca en carga infinita ni en lista vacía.
          return {
            ...state,
            pending: null,
            workspaces: {
              ...state.workspaces,
              loaded: false,
              loading: false,
              items: [],
              error: action.reason || 'transport-error',
            },
          };
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
      return el('p', { className: 'lcr-pa-notice' }, t(state.notice.code, state.notice.values));
    }

    function paKpi(label, value, hint) {
      return el('div', { className: 'lcr-pa-kpi' },
        el('span', { className: 'lcr-pa-kpi__label' }, label),
        el('span', { className: 'lcr-pa-kpi__value' }, value),
        hint ? el('span', { className: 'lcr-pa-kpi__hint' }, hint) : null);
    }

    /** Error de administración traducido por código; si no hay clave, mensaje genérico. */
    function paAdminError(state, t) {
      const code = state.admin.error;
      if (!code) return null;
      const key = 'admin.err.' + code;
      const text = t(key);
      return el('p', { className: 'lcr-pa-hint', role: 'alert', 'data-admin-error': code },
        text === key ? t('admin.err.generic', { code }) : text);
    }

    function paAdminNotice(state, t) {
      const notice = state.admin.notice;
      if (!notice) return null;
      return el('p', { className: 'lcr-pa-notice', role: 'status', 'data-admin-notice': notice.code }, t(notice.code));
    }

    /** Raíces de un proyecto: se retira una raíz concreta, nunca un botón «borrar todo». */
    function paRootsPanel(state, t, dispatch, projectId) {
      const busy = Boolean(state.admin.busy);
      const roots = state.roots.filter((root) => root.scopeId === projectId);
      return paCard(t('admin.roots'),
        el('div', { className: 'lcr-pa-stack' },
          roots.length === 0
            ? paEmpty(t('admin.blocked'))
            : paTable(t('admin.roots'), [t('admin.rootPath'), t('common.status'), t('common.actions')],
              roots.map((root) => el('tr', { key: root.id },
                el('td', { className: 'lcr-pa-mono' }, root.path),
                el('td', null, paChip(root.state, root.state === 'authorized' ? 'ok' : 'warn')),
                el('td', null, el('button', {
                  type: 'button',
                  className: 'lcr-pa-btn lcr-pa-btn--ghost',
                  disabled: busy,
                  onClick: () => dispatch({ type: 'admin-op', op: { kind: 'rootRemove', rootId: root.id } }),
                }, t('admin.removeRoot')))))),
          el('form', {
            className: 'lcr-pa-form',
            onSubmit: (event) => {
              if (event && typeof event.preventDefault === 'function') event.preventDefault();
              const path = String(state.admin.rootDraft || '').trim();
              if (!path) return;
              dispatch({ type: 'admin-op', op: { kind: 'rootAdd', projectId, path } });
            },
          },
            el('label', { className: 'lcr-pa-field' }, t('admin.rootPath'),
              el('input', {
                className: 'lcr-pa-input',
                type: 'text',
                value: state.admin.rootDraft,
                placeholder: 'C:/ruta/al/proyecto',
                onChange: (event) => dispatch({ type: 'admin-root-path', value: event && event.target ? event.target.value : '' }),
              })),
            el('button', {
              type: 'submit',
              className: 'lcr-pa-btn',
              disabled: busy || String(state.admin.rootDraft || '').trim() === '',
            }, busy === 'rootAdd' ? t('admin.busy') : t('admin.addRoot'))),
          el('p', { className: 'lcr-pa-hint' }, t('admin.rootsHint'))));
    }

    function paViewProjects(state, t, dispatch) {
      const offline = state.mode !== 'api';
      const busy = state.admin.busy;
      const draft = state.admin.draft;
      const canCreate = !offline && !busy && String(draft.name || '').trim() !== '';

      const createCard = paCard(t('admin.create'),
        el('form', {
          className: 'lcr-pa-form',
          onSubmit: (event) => {
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            if (!canCreate) return;
            dispatch({
              type: 'admin-op',
              op: {
                kind: 'create',
                name: String(draft.name || '').trim(),
                path: String(draft.path || '').trim(),
              },
            });
          },
        },
          el('label', { className: 'lcr-pa-field' }, t('admin.name'),
            el('input', {
              className: 'lcr-pa-input',
              type: 'text',
              value: draft.name,
              disabled: offline || Boolean(busy),
              onChange: (event) => dispatch({ type: 'admin-draft', field: 'name', value: event && event.target ? event.target.value : '' }),
            })),
          el('label', { className: 'lcr-pa-field' }, t('admin.path'),
            el('input', {
              className: 'lcr-pa-input',
              type: 'text',
              value: draft.path,
              placeholder: 'C:/ruta/al/proyecto',
              disabled: offline || Boolean(busy),
              onChange: (event) => dispatch({ type: 'admin-draft', field: 'path', value: event && event.target ? event.target.value : '' }),
            })),
          el('button', { type: 'submit', className: 'lcr-pa-btn lcr-pa-btn--primary', disabled: !canCreate },
            busy === 'create' ? t('admin.busy') : t('admin.create'))),
        el('p', { className: 'lcr-pa-hint' }, t('admin.pathHint')));

      const activeRows = state.projects.map((project) => {
        const renaming = state.admin.renaming === project.id;
        const actions = el('div', { className: 'lcr-pa-row' },
          el('button', {
            type: 'button',
            className: 'lcr-pa-btn',
            disabled: offline || Boolean(busy) || project.current || !project.selectable,
            onClick: () => dispatch({ type: 'select-project', projectId: project.id }),
          }, t('project.select')),
          el('button', {
            type: 'button',
            className: 'lcr-pa-btn lcr-pa-btn--ghost',
            disabled: offline || Boolean(busy),
            onClick: () => dispatch({ type: 'admin-rename', projectId: project.id }),
          }, t('admin.rename')),
          el('button', {
            type: 'button',
            className: 'lcr-pa-btn lcr-pa-btn--ghost',
            disabled: offline || Boolean(busy),
            'aria-expanded': state.admin.rootsFor === project.id,
            onClick: () => dispatch({ type: 'admin-roots', projectId: project.id }),
          }, t('admin.roots')),
          el('button', {
            type: 'button',
            className: 'lcr-pa-btn lcr-pa-btn--ghost',
            disabled: offline || Boolean(busy),
            onClick: () => dispatch({ type: 'admin-op', op: { kind: 'archive', id: project.id } }),
          }, t('admin.archive')));
        return el('tr', { key: project.id },
          el('td', null,
            renaming
              ? el('form', {
                className: 'lcr-pa-form',
                onSubmit: (event) => {
                  if (event && typeof event.preventDefault === 'function') event.preventDefault();
                  const name = String(state.admin.renameValue || '').trim();
                  if (name === '') return;
                  dispatch({ type: 'admin-op', op: { kind: 'update', id: project.id, name } });
                },
              },
                el('input', {
                  className: 'lcr-pa-input',
                  type: 'text',
                  value: state.admin.renameValue,
                  'aria-label': t('admin.name'),
                  onChange: (event) => dispatch({ type: 'admin-rename-value', value: event && event.target ? event.target.value : '' }),
                }),
                el('button', {
                  type: 'submit',
                  className: 'lcr-pa-btn',
                  disabled: busy || String(state.admin.renameValue || '').trim() === '',
                }, busy === 'update' ? t('admin.busy') : t('admin.save')))
              : project.name),
          el('td', { className: 'lcr-pa-num' }, String(project.rootCount)),
          el('td', null, project.current
            ? paChip(t('admin.current'), 'ok')
            : (project.selectable ? paChip(t('admin.selectable'), 'ok') : paChip(t('admin.blocked'), 'warn'))),
          el('td', null, actions));
      });

      const archivedRows = state.archived.map((project) => el('tr', { key: project.id },
        el('td', null, project.name),
        el('td', { className: 'lcr-pa-num' }, String(project.rootCount)),
        el('td', null, project.archivedAt ? paTime(project.archivedAt) : '—'),
        el('td', null, el('button', {
          type: 'button',
          className: 'lcr-pa-btn',
          disabled: offline || Boolean(busy),
          onClick: () => dispatch({ type: 'admin-op', op: { kind: 'restore', id: project.id } }),
        }, busy === 'restore' ? t('admin.busy') : t('admin.restore')))));

      const rootsProject = state.admin.rootsFor
        ? state.projects.find((row) => row.id === state.admin.rootsFor)
          ?? state.archived.find((row) => row.id === state.admin.rootsFor)
        : null;

      return el('div', { className: 'lcr-pa-stack' },
        paSectionHead(t('admin.title'), t('ux.projects.sub')),
        el('p', { className: 'lcr-pa-hint' }, t('admin.hint')),
        offline ? el('p', { className: 'lcr-pa-hint', role: 'alert' }, t('admin.offline')) : null,
        createCard,
        paCard(t('admin.active'),
          el('div', { className: 'lcr-pa-stack' },
            state.projects.length === 0
              ? paEmpty(t('admin.emptyActive'))
              : paTable(t('admin.active'), [t('common.name'), t('common.roots'), t('common.status'), t('common.actions')], activeRows),
            el('p', { className: 'lcr-pa-hint' }, t('admin.archiveHint')))),
        rootsProject ? paRootsPanel(state, t, dispatch, rootsProject.id) : null,
        paCard(t('admin.archived'),
          state.archived.length === 0
            ? paEmpty(t('admin.emptyArchived'))
            : paTable(t('admin.archived'), [t('common.name'), t('common.roots'), t('common.updated'), t('common.actions')], archivedRows)),
        paAdminNotice(state, t),
        paAdminError(state, t),
        paNotice(state, t));
    }

    function paViewCandidates(state, t, dispatch) {
      const offline = state.mode !== 'api';
      const busy = Boolean(state.pending);
      const candidates = state.candidates;
      const rows = candidates.rows.map((row) => el('tr', { key: row.path },
        el('td', { className: 'lcr-pa-mono' }, row.path),
        el('td', null, row.name),
        el('td', null, row.type),
        el('td', { className: 'lcr-pa-num' }, String(row.indicators.length)),
        el('td', null, row.registered
          ? paChip(t('candidates.registered'), 'ok')
          : el('button', {
            type: 'button',
            className: 'lcr-pa-btn lcr-pa-btn--primary',
            disabled: offline || busy,
            onClick: () => dispatch({ type: 'candidates-register', path: row.path }),
          }, candidates.registering === row.path ? t('candidates.registering') : t('candidates.register')))));

      return el('div', { className: 'lcr-pa-stack' },
        paCard(t('candidates.title'),
          el('div', { className: 'lcr-pa-stack' },
            el('p', { className: 'lcr-pa-hint' }, t('candidates.hint')),
            el('form', {
              className: 'lcr-pa-form',
              onSubmit: (event) => {
                if (event && typeof event.preventDefault === 'function') event.preventDefault();
                if (offline || busy) return;
                dispatch({ type: 'candidates-scan' });
              },
            },
              el('label', { className: 'lcr-pa-field' }, t('admin.path'),
                el('input', {
                  className: 'lcr-pa-input',
                  type: 'text',
                  value: candidates.scanPath,
                  placeholder: 'C:/ruta/a/explorar',
                  disabled: offline || busy,
                  onChange: (event) => dispatch({ type: 'candidates-path', value: event && event.target ? event.target.value : '' }),
                })),
              el('button', { type: 'submit', className: 'lcr-pa-btn lcr-pa-btn--primary', disabled: offline || busy },
                candidates.loading ? t('candidates.scanning') : t('candidates.scan'))),
            offline ? el('p', { className: 'lcr-pa-hint', role: 'alert' }, t('admin.offline')) : null,
            candidates.error
              ? el('p', { className: 'lcr-pa-hint', role: 'alert', 'data-candidates-error': candidates.error },
                candidates.errorText ? t(candidates.errorText) : t('candidates.err.generic', { code: candidates.error }))
              : null,
            candidates.root ? el('p', { className: 'lcr-pa-hint' }, t('candidates.root') + ': ' + candidates.root) : null,
            candidates.loaded && candidates.rows.length === 0
              ? paEmpty(t('candidates.empty'))
              : null,
            candidates.loaded && candidates.rows.length > 0
              ? paTable(t('candidates.title'), [t('admin.path'), t('common.name'), '±', t('candidates.detected'), t('common.actions')], rows)
              : null,
            candidates.truncated ? el('p', { className: 'lcr-pa-hint' }, t('candidates.truncated')) : null,
            candidates.skippedCount > 0
              ? el('p', { className: 'lcr-pa-hint' }, t('candidates.skipped', { count: candidates.skippedCount }))
              : null,
            candidates.done ? el('p', { className: 'lcr-pa-notice', role: 'status' }, t('candidates.done')) : null)),
        paNotice(state, t));
    }

    function paViewProject(state, t, dispatch) {
      const selection = state.session.session.selection;
      const missingStores = state.diagnostics.scopes.filter((scope) => scope.store !== 'present').length;
      const missingLibraries = state.libraries.filter((library) => library.store !== 'present').length;
      const totalFuentes = Number.isFinite(state.sourcesTotal) ? state.sourcesTotal : state.sources.length;
      const pages = Math.max(1, Math.ceil(state.sources.length / PA_PAGE_LIMIT));
      const rows = state.projects.map((project) => el('tr', { key: project.id },
        el('td', null, project.name),
        el('td', { className: 'lcr-pa-num' }, String(project.rootCount)),
        el('td', null, project.current ? paStateChip(t('ux.ws.current'), 'ok') : paStateChip(t('ux.ws.available'), 'neutral')),
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
          paKpi(t('nav.sources'), paNum(totalFuentes), t('common.page', { page: 1, pages })),
          paKpi(t('connection.service'), state.session.service.status === 'ok' ? t('ux.state.ok') : state.session.service.status,
            missingStores > 0
              ? t('connection.serviceDetail', { missing: missingStores, total: state.diagnostics.scopes.length })
              : t('libraries.allPresent'))),
        el('div', { className: 'lcr-pa-split' },
          paCard(t('project.title'), el('div', { className: 'lcr-pa-stack' },
            paKv([
              [t('project.project'), selection.projectName],
              [t('project.selection'), selection.state === 'active' ? t('ux.state.active') : selection.state],
              [t('project.source'), selection.source === 'explicit' ? t('project.source.explicit') : t('project.source.cwd')],
              [t('project.scopes'), String(state.session.scopeCount)],
              [t('project.service'), state.session.service.status === 'ok' ? t('ux.state.ok') : state.session.service.status],
            ]),
            el('p', { className: 'lcr-pa-hint' }, t('project.selectionCas')))),
          paCard(t('project.candidates'),
            el('div', { className: 'lcr-pa-stack' },
              paTable(t('project.candidates'), [t('project.project'), t('common.roots'), t('common.status'), t('common.actions')], rows),
              el('button', {
                type: 'button',
                className: 'lcr-pa-btn',
                onClick: () => dispatch({ type: 'nav', view: 'projects' }),
              }, t('admin.title'))))),
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
      const totalProyecto = Number.isFinite(state.sourcesTotal) ? state.sourcesTotal : info.total;
      const pageRows = state.sources.slice(info.offset, info.offset + info.limit);
      const rows = pageRows.map((source) => el('tr', { key: source.id },
        el('td', null, source.title),
        el('td', null, el('span', { className: 'lcr-pa-mono lcr-pa-celluri', title: source.uri }, source.uri)),
        el('td', null, paChip(source.collection || '—', 'lib')),
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
                paChip(t('nav.sources') + ': ' + paNum(totalProyecto), 'lib'),
                el('span', { className: 'lcr-pa-muted' }, t('sources.showing', { shown: pageRows.length, total: totalProyecto })))),
            el('p', { className: 'lcr-pa-hint' }, t('sources.filter')),
            totalProyecto > info.total
              ? el('p', { className: 'lcr-pa-hint' }, t('sources.capped', { loaded: info.total, total: totalProyecto }))
              : null,
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
      // Una fuente hidratada desde la API no trae el texto de los fragmentos: no se inventa.
      const apiSource = source.api === true;
      const chunks = apiSource ? [] : paChunks(source);
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
              paChip(source.collection || '—', 'lib'),
              paChip(paNum(source.bytes) + ' B'),
              paChip(String(source.chunks) + ' ' + t('common.chunks')))),
          paKv([
            [t('common.uri'), source.uri],
            [t('common.collection'), source.collection || '—'],
            [t('common.bytes'), paNum(source.bytes)],
            [t('common.chunks'), String(source.chunks)],
            [t('common.indexed'), paTime(source.indexedAt)],
          ]),
          el('h3', { className: 'lcr-pa-subtitle' }, t('common.chunks')),
          apiSource
            ? el('p', { className: 'lcr-pa-hint' }, t('source.chunksPending'))
            : el('div', null,
                el('p', { className: 'lcr-pa-hint' }, t('source.chunksShown', { shown: shown.length, total: source.chunks })),
                paTable(t('common.chunks'), ['#', t('common.name'), 'charStart..charEnd', 'tokens', t('common.value')], rows, 'lcr-pa-tablewrap'),
                el('p', { className: 'lcr-pa-hint' }, t('source.gap05'))))));
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
          el('td', null, row.heading || row.uri || '—'),
          el('td', null, row.scopeName ? paChip(row.scopeName + ' · ' + row.scopeKind, row.scopeKind === 'lib' ? 'lib' : 'prj') : '—'),
          el('td', null, row.snippet || '—'),
          el('td', { className: 'lcr-pa-num' }, row.score === null || row.score === undefined ? '—' : Number(row.score).toFixed(3))))
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
            el('button', { type: 'button', className: 'lcr-pa-btn lcr-pa-btn--primary', disabled: state.pending === 'search', onClick: () => dispatch({ type: 'search' }) }, state.pending === 'search' ? t('search.running') : t('search.run'))),
          el('p', { className: 'lcr-pa-hint', id: 'lcr-pa-search-msg' }, message
            ?? (state.searchError ? t('search.failed') + ' · ' + state.searchError
              : (state.mode === 'api' ? t('search.hintApi') : t('search.hint'))))),
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
            paTable(t('search.results'), ['#', t('common.name'), t('common.value'), t('search.scope'), t('common.detail'), t('search.score')], rows, 'lcr-pa-tablewrap')))
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
              disabled: state.pending === 'context' || !(state.results && state.results.results.length > 0),
              onClick: () => dispatch({ type: 'context' }),
            }, t('context.build'))),
          state.contextError ? el('p', { className: 'lcr-pa-error__title' }, t('context.failed') + ' · ' + state.contextError) : null,
          context === null
            ? paEmpty(t('context.empty'), t('context.failClosed'))
            : el('div', { className: 'lcr-pa-stack' },
              el('div', { className: 'lcr-pa-kpis' },
                context.tokens === null || context.tokens === undefined ? null : paKpi(t('context.tokens'), String(context.tokens)),
                context.truncated === null || context.truncated === undefined ? null : paKpi(t('context.truncated'), context.truncated ? t('common.yes') : t('common.no')),
                context.considered === null || context.considered === undefined ? null : paKpi(t('context.considered'), String(context.considered))),
              el('h3', { className: 'lcr-pa-subtitle' }, t('context.text')),
              el('pre', { className: 'lcr-pa-context' }, context.text),
              el('h3', { className: 'lcr-pa-subtitle' }, t('context.citations')),
              paTable(t('context.citations'), ['#', t('common.name'), t('common.uri'), t('common.value'), 'ordinal', 'offsets'], rows, 'lcr-pa-tablewrap'),
              el('p', { className: 'lcr-pa-hint' }, t('context.failClosed'))))),
        paNotice(state, t));
    }

    function paViewOperations(state, t, dispatch) {
      // En modo api no hay operaciones simuladas que ofrecer: las de escritura exigen aprobación del
      // host y responden 403 desde la API. Se declara en vez de fingir botones que no escriben.
      if (state.mode === 'api') {
        return el('div', { className: 'lcr-pa-stack' },
          paCard(t('nav.operations'), el('div', { className: 'lcr-pa-stack' },
            el('p', { className: 'lcr-pa-hint' }, t('operations.hostOnly')))),
          paNotice(state, t));
      }
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
      // En modo api sólo los ámbitos vienen de la API; integridad, auditoría y versiones son del
      // fixture, así que no se pintan (nada de cifras inventadas bajo un panel conectado).
      if (state.mode === 'api') {
        return el('div', { className: 'lcr-pa-stack' },
          paCard(t('diagnostics.scopes'), paTable(t('diagnostics.scopes'), ['kind', 'id', t('common.name'), t('common.store'), t('diagnostics.verified')], scopeRows, 'lcr-pa-tablewrap')),
          el('p', { className: 'lcr-pa-hint' }, t('diagnostics.pendingApi')));
      }
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
      const mounted = state.mode === 'api';
      const missingStores = state.diagnostics.scopes.filter((scope) => scope.store !== 'present').length;
      // En modo api sólo se muestra lo que la API confirma; registry/storeRoot/legacy son del fixture
      // y no se pintan para no presentar datos inventados como estado real.
      const pairs = mounted
        ? [
            [t('connection.service'), health.status],
            [t('connection.api'), PA_API + (state.apiVersion ? ' · ' + state.apiVersion : '')],
            [t('connection.mode'), panelState.mode + (panelState.reason && panelState.reason !== panelState.mode ? ' · ' + panelState.reason : '')],
            [t('project.project'), state.session.session.selection.projectName],
            [t('project.scopes'), String(state.session.scopeCount)],
          ]
        : [
            [t('connection.service'), health.status],
            [t('connection.registry'), health.registry],
            [t('connection.storeRoot'), state.session.service.storeRoot],
            [t('connection.api'), t('connection.notMounted')],
            [t('connection.legacy'), health.legacy ? 'legacy' : 'no'],
            [t('connection.mode'), panelState.mode + ' · ' + panelState.reason],
          ];
      return el('div', { className: 'lcr-pa-stack' },
        paCard(t('connection.title'), el('div', { className: 'lcr-pa-stack' },
          el('div', { className: 'lcr-pa-toolbar' },
            el('span', { className: 'lcr-pa-toolbar__group' },
              paChip(t('status.client'), 'ok'),
              paChip(mounted ? t('status.apiOk') : t('status.api'), mounted ? 'ok' : 'warn'),
              paChip(mounted ? t('status.dataApi') : t('status.data'), mounted ? 'ok' : 'warn'),
              paChip(t('connection.service') + ': ' + health.status, health.status === 'ok' ? 'ok' : 'warn'))),
          paKv(pairs),
          el('p', { className: 'lcr-pa-hint' }, t(mounted ? 'connection.noticeLive' : 'connection.notice')),
          el('p', { className: 'lcr-pa-hint' }, missingStores > 0
            ? t('connection.serviceDetail', { missing: missingStores, total: state.diagnostics.scopes.length })
            : t('libraries.allPresent')))));
    }

    function paViewHistory(state, t, dispatch) {
      const history = state.history || { entries: [], total: 0, nextCursor: null, integrity: null, pages: 1, loaded: false, error: null };
      // Sin historial servible se conserva el estado honesto: no se fabrica ni una fila.
      if (!history.loaded || history.error !== null || (history.entries.length === 0 && history.integrity === null)) {
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
      const integrity = history.integrity || {};
      const chain = integrity.ok
        ? paChip(t('history.chainOk', { count: integrity.count ?? history.total }), 'ok')
        : paChip(t('history.chainBroken', { at: integrity.brokenAt ?? '?', reason: integrity.reason ?? '?' }), 'warn');
      const rows = history.entries.map((entry) => el('tr', { key: entry.seq },
        el('td', { className: 'lcr-pa-num' }, String(entry.seq)),
        el('td', null, paTime(entry.at)),
        el('td', null, entry.actor),
        el('td', null, el('span', { className: 'lcr-pa-mono' }, entry.tool)),
        el('td', null, entry.action),
        el('td', null, el('span', { className: 'lcr-pa-mono lcr-pa-celluri', title: entry.target || '' }, entry.target || '—')),
        el('td', null, paChip(entry.outcome, entry.outcome === 'ok' ? 'ok' : 'warn')),
        el('td', null, el('span', { className: 'lcr-pa-mono' }, entry.hash || '—'))));
      return paCard(t('history.title'), el('div', { className: 'lcr-pa-stack' },
        el('div', { className: 'lcr-pa-toolbar' },
          el('span', { className: 'lcr-pa-toolbar__group' },
            paChip(t('history.total') + ': ' + paNum(history.total), 'lib'),
            chain),
          history.nextCursor
            ? el('button', { type: 'button', className: 'lcr-pa-btn', onClick: () => dispatch({ type: 'history-more' }) }, t('history.more'))
            : null),
        el('p', { className: 'lcr-pa-hint' }, t('history.subtitle')),
        history.entries.length === 0
          ? paEmpty(t('history.empty'))
          : paTable(t('history.title'), [
            t('history.col.seq'), t('history.col.at'), t('history.col.actor'), t('history.col.tool'),
            t('history.col.action'), t('history.col.target'), t('history.col.outcome'), t('history.col.hash'),
          ], rows, 'lcr-pa-tablewrap')));
    }

    // ─── UX-1 · Fundaciones: áreas, componentes y vistas nuevas ────────────────────────────────
    // La navegación pasa de once pestañas planas a cinco áreas (D-UX-13). Ninguna vista se elimina:
    // las técnicas se pliegan en Ajustes y siguen accesibles (compatibilidad con pa/1.3.0).

    /** Áreas de primer nivel. `key` es la etiqueta i18n; el orden define el orden visual y de teclado. */
    const PA_AREAS = [
      { id: 'overview', key: 'nav.overview' },
      { id: 'workspaces', key: 'nav.workspaces' },
      { id: 'projects', key: 'nav.projectsArea' },
      { id: 'tracking', key: 'nav.tracking' },
      { id: 'settings', key: 'nav.settings' },
    ];

    /** Vistas que pertenecen a cada área. `source` (detalle de una fuente) vive en Fuentes. */
    const PA_AREA_VIEWS = {
      overview: ['overview'],
      workspaces: ['workspaces'],
      projects: ['project', 'sources', 'source', 'search', 'context', 'libraries', 'projects'],
      tracking: ['tracking'],
      settings: ['settings', 'diagnostics', 'connection', 'history', 'operations', 'candidates'],
    };

    /** Subnavegación de cada área, en orden. `admin: true` marca la vista de administración. */
    const PA_SUBNAV = {
      projects: [
        { id: 'project', key: 'ux.projects.summary' },
        { id: 'sources', key: 'nav.sources' },
        { id: 'search', key: 'nav.search' },
        { id: 'context', key: 'nav.context' },
        { id: 'libraries', key: 'nav.libraries' },
        { id: 'projects', key: 'ux.projects.manage', admin: true },
      ],
      settings: [
        { id: 'settings', key: 'nav.settings' },
        { id: 'diagnostics', key: 'nav.diagnostics' },
        { id: 'connection', key: 'nav.connection' },
        { id: 'history', key: 'nav.history' },
        { id: 'operations', key: 'nav.operations' },
        { id: 'candidates', key: 'nav.candidates' },
      ],
    };

    function paAreaOf(view) {
      const found = Object.keys(PA_AREA_VIEWS).find((area) => PA_AREA_VIEWS[area].indexOf(view) >= 0);
      return found || 'overview';
    }

    /**
     * Etiqueta visible de una vista, tal como la pinta la navegación: primero la subnavegación
     * (una vista puede tener un nombre distinto al de su área) y después el catálogo. La usan el
     * teclado y las pruebas para no duplicar listas de etiquetas.
     */
    function paViewLabel(id, t) {
      for (const area of Object.keys(PA_SUBNAV)) {
        const item = PA_SUBNAV[area].find((entry) => entry.id === id);
        if (item) return t(item.key);
      }
      const view = PA_VIEWS.find((entry) => entry.id === id);
      return view ? t(view.key) : id;
    }

    /** Selección vigente (CR-1): `{projectId, revision}` o null. No cambia nada, sólo lee. */
    function paSelectionOf(state) {
      const session = state.session && state.session.session;
      const selection = session && session.selection;
      if (!selection || !selection.projectId) return null;
      const name = (state.projects || []).find((p) => p.id === selection.projectId);
      return { projectId: selection.projectId, name: name ? name.name : selection.projectId, revision: selection.revision };
    }

    /** Métricas derivadas de datos reales del snapshot. `ready` = proyecto activo con raíz autorizada. */
    function paOverviewMetrics(state) {
      const active = (state.projects || []).filter((p) => (p.status || 'active') === 'active');
      const archived = (state.archived || []).length;
      const total = Number(state.sourcesTotal);
      const docs = Number.isFinite(total) ? total : (state.sources || []).length;
      const ready = active.filter((p) => (Number(p.rootCount) || 0) > 0).length;
      const selected = paSelectionOf(state);
      const next = active.find((p) => (Number(p.rootCount) || 0) === 0)
        || (selected && active.find((p) => p.id === selected.projectId && docs === 0) ? active.find((p) => p.id === selected.projectId) : null)
        || null;
      return { active, archived, docs, ready, total: active.length, selected, next };
    }

    function paStateChip(label, tone) {
      return el('span', { className: 'lcr-pa-chip lcr-pa-chip--' + tone }, label);
    }

    function paKpiCard(label, value, hint) {
      return el('div', { className: 'lcr-pa-kpi' },
        el('span', { className: 'lcr-pa-kpi__label' }, label),
        el('strong', { className: 'lcr-pa-kpi__value' }, value),
        hint ? el('span', { className: 'lcr-pa-kpi__hint' }, hint) : null);
    }

    function paSectionHead(title, sub) {
      return el('div', { className: 'lcr-pa-secthead' },
        el('h2', { className: 'lcr-pa-secthead__title' }, title),
        sub ? el('p', { className: 'lcr-pa-secthead__sub' }, sub) : null);
    }

    /** Ruta truncada con «mostrar» y «copiar» (D-UX-14). Componente con estado propio y mínimo. */
    function PaPath(props) {
      const [open, setOpen] = useState(false);
      const [copied, setCopied] = useState(false);
      const path = String(props.path || '');
      const t = props.t;
      if (!path) return el('span', { className: 'lcr-pa-muted' }, '—');
      const copy = () => {
        try {
          if (props.onCopy) props.onCopy(path);
          setCopied(true);
          if (typeof setTimeout === 'function') setTimeout(() => setCopied(false), 1500);
        } catch { setCopied(false); }
      };
      return el('span', { className: 'lcr-pa-path' },
        el('code', { className: 'lcr-pa-path__value', title: path }, open ? path : paShortPath(path)),
        el('button', {
          type: 'button',
          className: 'lcr-pa-path__btn',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => setOpen(!open),
        }, open ? t('ux.path.hide') : t('ux.path.show')),
        el('button', { type: 'button', className: 'lcr-pa-path__btn', onClick: copy }, copied ? t('ux.path.copied') : t('ux.path.copy')));
    }

    /** Acorta una ruta por el principio para que quepa, conservando el final (lo que identifica). */
    function paShortPath(path) {
      const text = String(path || '');
      if (text.length <= 46) return text;
      return '…' + text.slice(-34);
    }

    function paEmptyState(title, hint, actions) {
      return el('div', { className: 'lcr-pa-empty' },
        el('strong', { className: 'lcr-pa-empty__title' }, title),
        el('p', { className: 'lcr-pa-empty__hint' }, hint),
        actions ? el('div', { className: 'lcr-pa-row' }, actions) : null);
    }

    /** Estado de un proyecto en lenguaje de usuario, sin códigos (D-UX-13/UX-01). */
    function paProjectState(project, t) {
      if ((project.status || 'active') === 'archived') return { label: t('ux.ws.stArchived'), tone: 'neutral' };
      if ((Number(project.rootCount) || 0) === 0) return { label: t('ux.ws.stNoPath'), tone: 'warn' };
      return { label: t('ux.ws.stReady'), tone: 'ok' };
    }

    function paViewOverview(state, t, dispatch) {
      const m = paOverviewMetrics(state);
      const coverage = m.total > 0 ? Math.round((m.ready / m.total) * 100) : 0;
      const notice = state.notice && state.notice.kind === 'ok' ? state.notice : null;
      return el('section', { className: 'lcr-pa-stack', 'data-view': 'overview' },
        notice ? el('p', { className: 'lcr-pa-notice', role: 'status' }, notice.text) : null,
        paSectionHead(t('nav.overview'), t('ux.overview.sub')),
        el('div', { className: 'lcr-pa-kpis' },
          paKpiCard(t('ux.overview.projects'), String(m.ready), t('ux.overview.coverageHint', { ready: m.ready, total: m.total })),
          paKpiCard(t('ux.overview.sources'), paNum(m.docs), t('ux.set.docsHint')),
          paKpiCard(t('ux.overview.coverage'), coverage + '%', t('ux.set.coverageHint'))),
        el('div', { className: 'lcr-pa-grid2' },
          el('div', { className: 'lcr-pa-card' },
            el('div', { className: 'lcr-pa-card__head' },
              el('h3', { className: 'lcr-pa-card__title' }, t('ux.overview.tracking')),
              paStateChip(t('ux.overview.trackingOff'), 'neutral')),
            el('div', { className: 'lcr-pa-card__body' },
              el('p', { className: 'lcr-pa-hint' }, t('ux.track.manual')),
              el('button', { type: 'button', className: 'lcr-pa-btn', onClick: () => dispatch({ type: 'nav', view: 'tracking' }) }, t('nav.tracking')))),
          el('div', { className: 'lcr-pa-card' },
            el('div', { className: 'lcr-pa-card__head' },
              el('h3', { className: 'lcr-pa-card__title' }, t('ux.overview.next')),
              m.selected ? paChip(t('ux.overview.selected') + ': ' + m.selected.name, 'lib') : null),
            el('div', { className: 'lcr-pa-card__body' },
              m.total === 0
                ? el('div', { className: 'lcr-pa-stack' },
                    el('p', { className: 'lcr-pa-hint' }, t('ux.overview.nextNoProject')),
                    el('div', { className: 'lcr-pa-row' },
                      el('button', { type: 'button', className: 'lcr-pa-btn lcr-pa-btn--primary', onClick: () => dispatch({ type: 'nav', view: 'projects' }) }, t('ux.projects.manage'))))
                : (m.next
                    ? el('div', { className: 'lcr-pa-stack' },
                        el('p', { className: 'lcr-pa-hint' }, t('ux.overview.nextNoDocs', { name: m.next.name })),
                        el('div', { className: 'lcr-pa-row' },
                          el('button', { type: 'button', className: 'lcr-pa-btn lcr-pa-btn--primary', onClick: () => dispatch({ type: 'nav', view: 'projects' }) }, t('ux.projects.manage'))))
                    : el('p', { className: 'lcr-pa-hint' }, t('ux.overview.nextNone')))))),
        paCard(t('ux.overview.activity'),
          m.active.length === 0 && m.archived === 0
            ? paEmptyState(t('ux.overview.empty'), t('ux.overview.emptyHint'),
                el('button', { type: 'button', className: 'lcr-pa-btn lcr-pa-btn--primary', onClick: () => dispatch({ type: 'nav', view: 'projects' }) }, t('ux.projects.manage')))
            : el('div', { className: 'lcr-pa-stack' },
                el('p', { className: 'lcr-pa-hint' }, m.selected
                  ? t('ux.overview.selected') + ': ' + m.selected.name
                  : t('ux.overview.noSelection')),
                paTable(t('ux.overview.activity'), [t('ux.ws.col.project'), t('ux.ws.col.state'), t('ux.ws.col.docs'), ''],
                  (state.projects || []).map((p) => {
                    const st = paProjectState(p, t);
                    return el('tr', { key: p.id },
                      el('td', null, p.current ? el('strong', null, p.name) : p.name),
                      el('td', null, paStateChip(st.label, st.tone)),
                      // El perfil no publica el recuento de documentos por proyecto: sólo el activo lo
                      // tiene en el snapshot. Inventarlo para los demás sería mentir en la interfaz.
                      el('td', { className: 'lcr-pa-num' }, p.current ? paNum(m.docs) : '—'),
                      el('td', null, el('button', {
                        type: 'button',
                        className: 'lcr-pa-link',
                        onClick: () => dispatch({ type: 'nav', view: 'project' }),
                      }, t('ux.overview.open'))));
                  }), 'lcr-pa-tablewrap'))));
    }

    /** Estado de un workspace, en lenguaje de usuario y sin códigos (UX-2.1 §19). */
    function paWorkspaceState(state, t) {
      if (state === 'ok') return { label: t('ux.ws.stOk'), tone: 'ok' };
      if (state === 'missing') return { label: t('ux.ws.stMissing'), tone: 'warn' };
      return { label: t('ux.ws.stUnknown'), tone: 'neutral' };
    }

    /** Motivo legible de un `unknown`: el código del servidor, traducido si hay texto. */
    function paWorkspaceReason(reason, t) {
      const CLAVES = {
        timeout: 'ux.ws.whyTimeout',
        'status-error': 'ux.ws.whyError',
        budget: 'ux.ws.whyBudget',
        'no-status': 'ux.ws.whyNoStatus',
        'unexpected-status': 'ux.ws.whyError',
      };
      if (!reason) return null;
      return t(CLAVES[reason] || 'ux.ws.whyError');
    }

    /** Conteo de sesiones: distinguir «cero vivas» de «no se pudo mirar» es el punto de esta columna. */
    function paWorkspaceSessions(sessions, t) {
      if (!sessions || sessions.live === null) {
        return el('span', { className: 'lcr-pa-muted' }, t('ux.ws.sessUnknown', { known: paNum(sessions ? sessions.known : 0) }));
      }
      if (sessions.live === 0) return t('ux.ws.sessHistorical', { known: paNum(sessions.known) });
      return t('ux.ws.sessLive', { live: paNum(sessions.live), known: paNum(sessions.known) });
    }

    /**
     * UX-2.1 · Workspaces del Host (sólo lectura).
     *
     * Muestra lo que el registro de DeepSeek Harness conoce y cómo se cruza con los proyectos RAG.
     * No autoriza, no indexa, no archiva y no selecciona: con el Host sólo lee. Cada estado tiene su
     * pintura porque cada uno significa algo distinto: sin Host no hay lista (no es «ningún
     * workspace»), un fallo no es una lista vacía, y una fila `unknown` dice que no se pudo
     * comprobar, no que el directorio falte.
     */
    function paViewWorkspaces(state, t, dispatch) {
      const ws = state.workspaces || { loaded: false, loading: false, items: [], error: null };
      const head = paSectionHead(t('ux.ws.title'), t('ux.ws.sub'));
      const toolbar = el('div', { className: 'lcr-pa-toolbar' },
        el('span', { className: 'lcr-pa-toolbar__group' },
          ws.counts ? paChip(t('ux.ws.fromHost') + ': ' + paNum(ws.counts.total), 'lib') : null,
          ws.counts ? paChip(t('ux.ws.countProject') + ': ' + paNum(ws.counts.withProject), 'neutral') : null),
        el('span', { className: 'lcr-pa-toolbar__group' },
          el('button', {
            type: 'button',
            className: 'lcr-pa-btn',
            disabled: state.mode !== 'api' || Boolean(ws.loading),
            'data-ws-refresh': '1',
            onClick: () => dispatch({ type: 'workspaces-refresh' }),
          }, ws.loading ? t('ux.ws.refreshing') : t('ux.ws.refresh')),
          el('button', {
            type: 'button',
            className: 'lcr-pa-btn',
            onClick: () => dispatch({ type: 'nav', view: 'candidates' }),
          }, t('ux.ws.add'))));

      // 1 · Sin API (modo demostración): no se inventa una lista del Host.
      if (state.mode !== 'api') {
        return el('section', { className: 'lcr-pa-stack', 'data-view': 'workspaces', 'data-ws-state': 'offline' },
          head,
          paCard(t('ux.ws.title'), el('div', { className: 'lcr-pa-stack' },
            paEmptyState(t('ux.ws.offline'), t('ux.ws.offlineHint'), null))));
      }

      // 2 · Fallo de transporte o del servidor: motivo y salida, nunca carga infinita.
      if (ws.error) {
        return el('section', { className: 'lcr-pa-stack', 'data-view': 'workspaces', 'data-ws-state': 'error' },
          head,
          paCard(t('ux.ws.title'), el('div', { className: 'lcr-pa-stack' },
            toolbar,
            el('div', { className: 'lcr-pa-error', role: 'alert', 'data-ws-error': ws.error },
              el('p', { className: 'lcr-pa-error__title' }, t('ux.ws.err')),
              el('p', { className: 'lcr-pa-hint lcr-pa-mono' }, t('ux.ws.errCode') + ': ' + String(ws.error)),
              el('button', { type: 'button', className: 'lcr-pa-btn', onClick: () => dispatch({ type: 'workspaces-refresh' }) }, t('ux.ws.retry'))))));
      }

      // 3 · Cargando por primera vez (sin datos previos): se dice, no se deja en blanco.
      if (ws.loading && !ws.loaded) {
        return el('section', { className: 'lcr-pa-stack', 'data-view': 'workspaces', 'data-ws-state': 'loading' },
          head,
          paCard(t('ux.ws.title'), el('div', { className: 'lcr-pa-stack' },
            toolbar,
            el('p', { className: 'lcr-pa-hint', role: 'status' }, t('ux.ws.loading')))));
      }

      // 4 · El Host no ofrece su registro: se dice «no hay de dónde leer», no «no hay ninguno».
      if (ws.loaded && ws.source === 'none') {
        return el('section', { className: 'lcr-pa-stack', 'data-view': 'workspaces', 'data-ws-state': 'none' },
          head,
          paCard(t('ux.ws.title'), el('div', { className: 'lcr-pa-stack' },
            toolbar,
            paEmptyState(t('ux.ws.noRegistry'), t('ux.ws.noRegistryHint'), null),
            ws.reason
              ? el('p', { className: 'lcr-pa-hint lcr-pa-mono', 'data-ws-reason': ws.reason }, t('ux.ws.errCode') + ': ' + String(ws.reason))
              : null)));
      }

      // 5 · Registry presente pero sin workspaces: lista vacía legítima, con su salida.
      if (ws.loaded && ws.items.length === 0) {
        return el('section', { className: 'lcr-pa-stack', 'data-view': 'workspaces', 'data-ws-state': 'empty' },
          head,
          paCard(t('ux.ws.title'), el('div', { className: 'lcr-pa-stack' },
            toolbar,
            paEmptyState(t('ux.ws.empty'), t('ux.ws.emptyHint'), null))));
      }

      // 6 · Todavía sin pedir la lista (mode API recién montado): estado honesto.
      if (!ws.loaded) {
        return el('section', { className: 'lcr-pa-stack', 'data-view': 'workspaces', 'data-ws-state': 'idle' },
          head,
          paCard(t('ux.ws.title'), el('div', { className: 'lcr-pa-stack' },
            toolbar,
            el('p', { className: 'lcr-pa-hint' }, t('ux.ws.idle')))));
      }

      const rows = ws.items.map((row) => {
        const st = paWorkspaceState(row.state, t);
        const why = row.state === 'unknown' ? paWorkspaceReason(row.stateReason, t) : null;
        return el('tr', { key: row.pathKey || row.path, 'data-ws-path': row.pathKey || row.path },
          el('td', null, el('strong', null, row.title)),
          el('td', null, el(PaPath, { path: row.path, t, onCopy: state.copyText })),
          el('td', null,
            paStateChip(st.label, st.tone),
            why ? el('span', { className: 'lcr-pa-hint' }, ' · ' + why) : null),
          el('td', null, row.project ? row.project.name : el('span', { className: 'lcr-pa-muted' }, '—')),
          el('td', null, row.relation === 'exact'
            ? paChip(t('ux.ws.relExact'), 'ok')
            : (row.relation === 'inside'
              ? paChip(t('ux.ws.relInside'), 'lib')
              : el('span', { className: 'lcr-pa-muted' }, '—'))),
          el('td', null, paWorkspaceSessions(row.sessions, t)));
      });

      return el('section', { className: 'lcr-pa-stack', 'data-view': 'workspaces', 'data-ws-state': 'list' },
        head,
        paCard(t('ux.ws.title'), el('div', { className: 'lcr-pa-stack' },
          toolbar,
          ws.truncated && ws.counts
            ? el('p', { className: 'lcr-pa-hint' }, t('ux.ws.truncated', { returned: paNum(ws.counts.returned), total: paNum(ws.counts.total) }))
            : null,
          ws.reason === 'sessions-unavailable'
            ? el('p', { className: 'lcr-pa-hint' }, t('ux.ws.noSessions'))
            : null,
          paTable(t('ux.ws.title'), [
            t('ux.ws.col.title'), t('ux.ws.col.path'), t('ux.ws.col.state'),
            t('ux.ws.col.project'), t('ux.ws.col.relation'), t('ux.ws.col.sessions'),
          ], rows, 'lcr-pa-tablewrap'),
          el('p', { className: 'lcr-pa-hint' }, t('ux.ws.readOnly')))));
    }

    function paViewTracking(state, t, dispatch) {
      return el('section', { className: 'lcr-pa-stack', 'data-view': 'tracking' },
        paSectionHead(t('ux.track.title'), t('ux.track.sub')),
        el('div', { className: 'lcr-pa-grid2' },
          el('div', { className: 'lcr-pa-card' },
            el('div', { className: 'lcr-pa-card__head' },
              el('h3', { className: 'lcr-pa-card__title' }, t('ux.track.easy')),
              paStateChip(t('ux.track.off'), 'neutral')),
            el('div', { className: 'lcr-pa-card__body' },
              el('div', { className: 'lcr-pa-toggle' },
                el('span', { className: 'lcr-pa-toggle__label' }, t('ux.track.easy')),
                el('button', {
                  type: 'button',
                  className: 'lcr-pa-toggle__switch',
                  role: 'switch',
                  'aria-checked': 'false',
                  'aria-disabled': 'true',
                  disabled: true,
                  'aria-label': t('ux.track.title'),
                })),
              el('p', { className: 'lcr-pa-hint' }, t('ux.track.offHint')),
              el('ol', { className: 'lcr-pa-steps' },
                el('li', null, el('strong', null, t('ux.track.step1')), el('span', null, t('ux.track.step1Hint'))),
                el('li', null, el('strong', null, t('ux.track.step2')), el('span', null, t('ux.track.step2Hint'))),
                el('li', null, el('strong', null, t('ux.track.step3')), el('span', null, t('ux.track.step3Hint')))))),
          el('div', { className: 'lcr-pa-card' },
            el('div', { className: 'lcr-pa-card__head' },
              el('h3', { className: 'lcr-pa-card__title' }, t('ux.set.advanced'))),
            el('div', { className: 'lcr-pa-card__body' },
              el('p', { className: 'lcr-pa-hint' }, t('ux.track.manual')),
              el('button', { type: 'button', className: 'lcr-pa-btn', onClick: () => dispatch({ type: 'nav', view: 'projects' }) }, t('ux.projects.manage'))))));
    }

    function paViewSettings(state, t, dispatch) {
      const mounted = state.mode === 'api';
      const service = state.session && state.session.service ? state.session.service.status : 'unknown';
      const kpis = [
        [t('ux.set.service'), String(service), service === 'ok' ? 'ok' : 'warn'],
        [t('ux.set.api'), mounted ? (state.apiVersion || 'pa/1.x') : '—', mounted ? 'ok' : 'warn'],
        [t('ux.set.mode'), mounted ? t('ux.set.apiMode') : t('ux.set.synthetic'), mounted ? 'ok' : 'warn'],
        [t('ux.set.docs'), paNum(paOverviewMetrics(state).docs), 'neutral'],
      ];
      const technical = PA_SUBNAV.settings.filter((item) => item.id !== 'settings');
      const DESCRIPCIONES = {
        diagnostics: 'ux.set.d.diagnostics',
        connection: 'ux.set.d.connection',
        history: 'ux.set.d.history',
        operations: 'ux.set.d.operations',
        candidates: 'ux.set.d.candidates',
      };
      return el('section', { className: 'lcr-pa-stack', 'data-view': 'settings' },
        paSectionHead(t('ux.set.title'), t('ux.set.sub')),
        paCard(t('ux.set.health'),
          el('div', { className: 'lcr-pa-kv-grid' },
            kpis.map(([label, value, tone]) => el('div', { className: 'lcr-pa-kv-row', key: label },
              el('span', { className: 'lcr-pa-muted' }, label),
              paStateChip(value, tone))))),
        paCard(t('ux.set.advanced'),
          el('div', { className: 'lcr-pa-stack' },
            el('p', { className: 'lcr-pa-hint' }, t('ux.set.hint')),
            el('ul', { className: 'lcr-pa-links' },
              technical.map((item) => el('li', { key: item.id },
                el('button', {
                  type: 'button',
                  className: 'lcr-pa-link',
                  onClick: () => dispatch({ type: 'nav', view: item.id }),
                }, t(item.key)),
                el('span', { className: 'lcr-pa-muted' }, ' — ' + t(DESCRIPCIONES[item.id] || item.key))))))));
    }

    const PA_VIEWS = [
      { id: 'overview', key: 'nav.overview' },
      { id: 'workspaces', key: 'nav.workspaces' },
      { id: 'project', key: 'nav.project' },
      { id: 'sources', key: 'nav.sources' },
      { id: 'search', key: 'nav.search' },
      { id: 'context', key: 'nav.context' },
      { id: 'libraries', key: 'nav.libraries' },
      { id: 'projects', key: 'nav.projects' },
      { id: 'tracking', key: 'nav.tracking' },
      { id: 'settings', key: 'nav.settings' },
      { id: 'diagnostics', key: 'nav.diagnostics' },
      { id: 'connection', key: 'nav.connection' },
      { id: 'history', key: 'nav.history' },
      { id: 'operations', key: 'nav.operations' },
      { id: 'candidates', key: 'nav.candidates' },
    ];

    function paRenderView(state, t, dispatch) {
      switch (state.view) {
        case 'overview': return paViewOverview(state, t, dispatch);
        case 'workspaces': return paViewWorkspaces(state, t, dispatch);
        case 'tracking': return paViewTracking(state, t, dispatch);
        case 'settings': return paViewSettings(state, t, dispatch);
        case 'libraries': return paViewLibraries(state, t);
        case 'sources': return paViewSources(state, t, dispatch);
        case 'source': return paViewSource(state, t, dispatch);
        case 'search': return paViewSearch(state, t, dispatch);
        case 'context': return paViewContext(state, t, dispatch);
        case 'operations': return paViewOperations(state, t, dispatch);
        case 'diagnostics': return paViewDiagnostics(state, t);
        case 'connection': return paViewConnection(state, t);
        case 'history': return paViewHistory(state, t, dispatch);
        case 'projects': return paViewProjects(state, t, dispatch);
        case 'candidates': return paViewCandidates(state, t, dispatch);
        default: return paViewProject(state, t, dispatch);
      }
    }

    /**
     * Estado sin API. Antes se pintaban los fixtures de la vista con el rótulo de «no disponible»,
     * lo que dejaba al usuario sin salida cuando el motivo era un proyecto NO registrado (F2,
     * `scope-unresolved` + `action: register-project`). Aquí se declara el motivo y se ofrece el
     * camino: la sección Candidatos (registro explícito) y la CLI, que sigue disponible.
     */
    function paViewDown(state, t, dispatch) {
      const notRegistered = state.error === 'scope-unresolved';
      return el('section', { className: 'lcr-pa-card', 'data-view': 'down' },
        el('div', { className: 'lcr-pa-card__head' },
          el('h2', { className: 'lcr-pa-card__title' }, t('view.errorTitle'))),
        el('div', { className: 'lcr-pa-card__body' },
          el('div', { className: 'lcr-pa-error' },
            el('p', { className: 'lcr-pa-error__title' }, t('view.errorTitle')),
            el('p', { className: 'lcr-pa-hint lcr-pa-mono', 'data-api-error': state.error || 'unavailable' },
              String(state.error || 'unavailable')),
            el('p', { className: 'lcr-pa-hint' },
              notRegistered ? t('view.registerHint') : t('view.errorHint')),
            el('div', { className: 'lcr-pa-row' },
              notRegistered
                ? el('button', {
                  type: 'button',
                  className: 'lcr-pa-btn lcr-pa-btn--primary',
                  onClick: () => dispatch({ type: 'nav', view: 'candidates' }),
                }, t('view.goCandidates'))
                : null,
              el('button', {
                type: 'button',
                className: 'lcr-pa-btn',
                onClick: () => dispatch({ type: 'retry-view' }),
              }, t('view.retry'))))));
    }

    function paRenderViewSafe(state, t, dispatch, render) {
      const draw = typeof render === 'function' ? render : paRenderView;
      if (state.mode === 'down') return paViewDown(state, t, dispatch);
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
              // F2 devuelve `scope-unresolved` con `action: register-project` cuando el proyecto no
              // está registrado. Aquí eso deja de ser un callejón: se ofrece la sección Candidatos,
              // donde la persona registra de forma explícita (la CLI sigue disponible).
              el('p', { className: 'lcr-pa-hint' }, t('view.registerHint')),
              el('div', { className: 'lcr-pa-row' },
                el('button', {
                  type: 'button',
                  className: 'lcr-pa-btn lcr-pa-btn--primary',
                  onClick: () => dispatch({ type: 'nav', view: 'candidates' }),
                }, t('view.goCandidates')),
                el('button', {
                  type: 'button',
                  className: 'lcr-pa-btn',
                  onClick: () => dispatch({ type: 'retry-view' }),
                }, t('view.retry'))))));
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
      // LE-RAG-10: el componente REAL del slot negocia antes de pintar datos. Si el servidor no
      // confirma 'api', el estado pasa a 'down' con su razón (nunca lista vacía silenciosa).
      useEffect(() => {
        let alive = true;
        (async () => {
          await negotiateMode();
          if (!alive) return;
          if (panelState.mode !== 'api') {
            dispatch({ type: 'unavailable', reason: panelState.reason });
            return;
          }
          try {
            const snapshot = await request('/snapshot');
            if (alive) dispatch({ type: 'hydrate', snapshot });
          } catch (failure) {
            if (alive) dispatch({ type: 'unavailable', reason: (failure && failure.code) || 'transport-error' });
          }
        })();
        return () => { alive = false; };
      }, []);
      // LE-RAG-10: la red de las vistas vive en un efecto encadenado al estado (no en el manejador del
      // clic), así el reducer sigue siendo puro y un fallo de transporte se pinta como aviso en lugar
      // de tumbar el panel.
      useEffect(() => {
        const job = state.pending;
        if (!job) return undefined;
        let alive = true;
        (async () => {
          try {
            const query = String(state.query ?? '').trim();
            // El contrato identifica el proyecto por query string en POST (la cabecera de sesión está
            // BLOCKED). Sin esto, un perfil con más de un proyecto respondería scope-ambiguous.
            const projectId = state.session.session.selection.projectId;
            const suffix = projectId ? '?project=' + encodeURIComponent(projectId) : '';
            if (job === 'search') {
              const data = await request('/search' + suffix, { method: 'POST', body: { query, limit: state.limit } });
              if (alive) dispatch({ type: 'search-ok', results: paNormalizeSearch(data, state.sources, state.session.session.selection.projectName) });
              return;
            }
            if (job === 'context') {
              const data = await request('/context' + suffix, { method: 'POST', body: { query, budgetTokens: PA_CONTEXT_BUDGET } });
              if (alive) dispatch({ type: 'context-ok', context: paNormalizeContext(data, state.sources) });
            }
            if (job === 'history') {
              // Historial del proyecto activo: la API lo resuelve por la selección persistida.
              const append = state.history.loaded && Boolean(state.history.nextCursor);
              const suffixHistory = '?limit=50' + (append ? '&cursor=' + encodeURIComponent(state.history.nextCursor) : '');
              try {
                const page = await request('/history' + suffixHistory);
                if (alive) dispatch({ type: 'history-ok', page, append });
              } catch (failure) {
                if (alive) dispatch({ type: 'history-error', reason: (failure && failure.code) || 'transport-error' });
              }
              return;
            }
            if (job === 'snapshot') {
              const snapshot = await request('/snapshot?limit=200');
              if (alive) dispatch({ type: 'hydrate', snapshot });
              return;
            }
            if (job === 'admin') {
              const op = state.adminOp;
              if (!op) return;
              try {
                await adminRequest(op);
                if (alive) dispatch({ type: 'admin-ok', op });
              } catch (failure) {
                if (alive) dispatch({ type: 'admin-error', reason: (failure && failure.code) || 'transport-error' });
              }
              return;
            }
            if (job === 'workspaces') {
              // UX-2.1: una sola petición por entrada o por «Actualizar». El servidor resuelve el
              // estado de cada workspace; el panel no inventa nada si la respuesta no trae la fuente.
              try {
                const payload = await request('/workspaces');
                if (alive) dispatch({ type: 'workspaces-ok', payload });
              } catch (failure) {
                if (alive) dispatch({ type: 'workspaces-error', reason: (failure && failure.code) || 'transport-error' });
              }
              return;
            }
            if (job === 'candidates') {
              const path = String(state.candidates.scanPath || '').trim();
              try {
                const page = await request('/candidates' + (path ? '?path=' + encodeURIComponent(path) : ''));
                if (alive) dispatch({ type: 'candidates-ok', page });
              } catch (failure) {
                if (alive) dispatch({ type: 'candidates-error', reason: (failure && failure.code) || 'transport-error' });
              }
              return;
            }
            if (job === 'register') {
              const path = state.candidates.registering;
              const row = state.candidates.rows.find((item) => item.path === path);
              try {
                const data = await request('/projects/register', {
                  method: 'POST',
                  body: { path, ...(row ? { name: row.name } : {}) },
                });
                if (alive) dispatch({ type: 'register-ok', path, project: data.project });
              } catch (failure) {
                if (alive) dispatch({ type: 'register-error', reason: (failure && failure.code) || 'transport-error' });
              }
              return;
            }
            if (job === 'selection') {
              // CR-1: el cambio sólo se pinta cuando el servidor lo confirma con la revisión nueva.
              const target = state.selectionPending;
              if (!target) return;
              try {
                const data = await request('/selection', {
                  method: 'POST',
                  body: { projectId: target.projectId, expectedRevision: target.expectedRevision },
                });
                if (alive) dispatch({ type: 'selection-ok', selection: data.selection });
              } catch (failure) {
                const reason = (failure && failure.code) || 'transport-error';
                if (reason === 'revision-conflict') {
                  // Otro panel ganó: se recarga la revisión vigente y se avisa; no se reintenta solo.
                  try {
                    const snapshot = await request('/snapshot');
                    if (alive) dispatch({ type: 'hydrate', snapshot });
                  } catch { /* el aviso de conflicto ya es suficiente */ }
                }
                if (alive) dispatch({ type: 'selection-error', reason });
              }
            }
          } catch (failure) {
            if (alive) dispatch({ type: job + '-error', reason: (failure && failure.code) || 'transport-error' });
          }
        })();
        return () => { alive = false; };
      }, [state.pending]);
      const activeArea = paAreaOf(state.view);
      const subnav = PA_SUBNAV[activeArea] || null;
      const activeId = state.view === 'source' ? 'sources' : state.view;
      const goArea = (id) => dispatch({ type: 'nav', view: PA_AREA_VIEWS[id][0] });
      const onKeyDown = (event) => {
        if (!event) return;
        const ids = PA_AREAS.map((area) => area.id);
        const current = ids.indexOf(activeArea);
        let next = null;
        if (event.key === 'ArrowRight') next = ids[(current + 1) % ids.length];
        else if (event.key === 'ArrowLeft') next = ids[(current - 1 + ids.length) % ids.length];
        else if (event.key === 'Home') next = ids[0];
        else if (event.key === 'End') next = ids[ids.length - 1];
        if (!next) return;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        goArea(next);
      };
      const serviceStatus = state.session.service.status;
      const mounted = state.mode === 'api';
      return el('div', { className: 'lcr-pa-root', 'data-data-mode': panelState.mode },
        (panelState.mode === 'api' && !(typeof window !== 'undefined' && window.location && window.location.search.indexOf('lcrnobanner=1') >= 0)) ? null : el('div', { className: 'lcr-pa-banner', role: 'status', 'aria-atomic': 'true', 'aria-label': t('a11y.banner') },
          el('strong', null, SYNTHETIC_BANNER),
          el('span', { className: 'lcr-pa-banner__hint' }, t('banner.hint'))),
        el('header', { className: 'lcr-pa-head' },
          el('div', { className: 'lcr-pa-head__main' },
            el('div', { className: 'lcr-pa-brand' },
              el('span', { className: 'lcr-pa-mark', 'aria-hidden': 'true' },
                el('svg', {
                  viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none',
                  stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
                },
                  el('path', { d: 'M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z' }),
                  el('path', { d: 'M4 12.5 12 17l8-4.5' }),
                  el('path', { d: 'M4 17 12 21.5 20 17' }))),
              el('div', null,
                el('h1', { className: 'lcr-pa-head__title' },
                  t('app.title'),
                  el('span', { className: 'lcr-pa-head__module' }, ' · ' + t('app.module'))),
                el('p', { className: 'lcr-pa-head__sub' }, t('app.tagline')))),
            el('div', { className: 'lcr-pa-status', 'aria-label': t('a11y.status') },
              paStatusPill(t('connection.service') + ': ' + serviceStatus, serviceStatus === 'ok' ? 'ok' : 'warn'),
              paStatusPill(mounted ? t('ux.set.apiMode') : t('ux.set.synthetic'), mounted ? 'ok' : 'warn'))),
          el('div', { className: 'lcr-pa-head__actions' },
            mounted ? null : el('button', { type: 'button', className: 'lcr-pa-btn', onClick: () => dispatch({ type: 'reset' }) }, t('app.reset')))),
        el('div', { className: 'lcr-pa-layout' },
          el('nav', { className: 'lcr-pa-nav', role: 'tablist', 'aria-label': t('ux.a11y.area'), onKeyDown },
            ...PA_AREAS.map((area) => el('button', {
              key: area.id,
              type: 'button',
              role: 'tab',
              id: 'lcr-pa-tab-' + area.id,
              'data-area': area.id,
              className: 'lcr-pa-nav__item' + (activeArea === area.id ? ' lcr-pa-nav__item--active' : ''),
              'aria-selected': activeArea === area.id ? 'true' : 'false',
              'aria-controls': 'lcr-pa-panel-' + area.id,
              tabIndex: activeArea === area.id ? 0 : -1,
              onClick: () => goArea(area.id),
            }, t(area.key)))),
          el('div', { className: 'lcr-pa-main' },
            subnav ? el('div', { className: 'lcr-pa-subnav', role: 'tablist', 'aria-label': t('ux.a11y.subnav') },
              ...subnav.map((item) => el('button', {
                key: item.id,
                type: 'button',
                role: 'tab',
                id: 'lcr-pa-sub-' + item.id,
                className: 'lcr-pa-subnav__item' + (activeId === item.id ? ' lcr-pa-subnav__item--active' : ''),
                'aria-selected': activeId === item.id ? 'true' : 'false',
                tabIndex: activeId === item.id ? 0 : -1,
                onClick: () => dispatch({ type: 'nav', view: item.id }),
              }, t(item.key)))) : null,
            el('div', {
              className: 'lcr-pa-body',
              role: 'tabpanel',
              id: 'lcr-pa-panel-' + activeArea,
              'aria-labelledby': 'lcr-pa-tab-' + activeArea,
              'data-view': state.view,
            }, paRenderViewSafe(state, t, dispatch)))));
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
        /* UX-1 · fundaciones del sistema de diseño (aditivas: los tokens previos se conservan). */
        --pa-radius-lg: 14px;
        --pa-bg-elev: color-mix(in oklab, var(--pa-surface) 88%, transparent);
        --pa-text-2: color-mix(in oklab, var(--pa-text) 78%, var(--pa-muted));
        --pa-accent-soft: color-mix(in oklab, var(--pa-accent) 14%, transparent);
        --pa-ring: 0 0 0 3px color-mix(in oklab, var(--pa-accent) 30%, transparent);
        --pa-shadow-1: 0 6px 18px rgba(0, 0, 0, 0.28);
        --pa-space-1: 4px;
        --pa-space-2: 8px;
        --pa-space-3: 12px;
        --pa-space-4: 16px;
        --pa-space-5: 24px;
        --pa-space-6: 32px;
        --pa-fs-1: 11px;
        --pa-fs-2: 12.5px;
        --pa-fs-3: 14px;
        --pa-fs-4: 17px;
        --pa-fs-5: 22px;
        --pa-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
        --pa-dur-1: 120ms;
        --pa-dur-2: 200ms;
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
      .lcr-pa-banner, .lcr-pa-head, .lcr-pa-tabs, .lcr-pa-layout { flex: 0 0 auto; }
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
      /* ─── UX-1 · layout de áreas, componentes y estados ─────────────────────────────────────── */
      .lcr-pa-head__module { color: var(--pa-muted); font-weight: 500; font-size: 0.72em; }
      .lcr-pa-mark svg { display: block; }
      .lcr-pa-layout { display: grid; grid-template-columns: 208px minmax(0, 1fr); gap: var(--pa-space-4); align-items: start; flex: 1 0 auto; }
      .lcr-pa-nav { display: flex; flex-direction: column; gap: 2px; padding: 6px; border: 1px solid var(--pa-border); border-radius: var(--pa-radius); background: var(--pa-surface); flex: 0 0 auto; position: sticky; top: 0; }
      .lcr-pa-nav__item { appearance: none; display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--pa-muted); padding: 8px 10px; font: inherit; font-size: var(--pa-fs-2); cursor: pointer; transition: background var(--pa-dur-1) var(--pa-ease), color var(--pa-dur-1) var(--pa-ease); }
      .lcr-pa-nav__item:hover { color: var(--pa-text); background: color-mix(in oklab, var(--pa-surface-2) 60%, transparent); }
      .lcr-pa-nav__item--active { color: var(--pa-text); background: var(--pa-accent-soft); border-color: color-mix(in oklab, var(--pa-accent) 40%, transparent); font-weight: 600; }
      .lcr-pa-nav__item:focus-visible, .lcr-pa-subnav__item:focus-visible, .lcr-pa-path__btn:focus-visible { outline: 2px solid var(--pa-accent); outline-offset: 2px; }
      .lcr-pa-main { display: flex; flex-direction: column; gap: var(--pa-space-3); min-width: 0; }
      .lcr-pa-subnav { display: flex; gap: 2px; padding: 3px; border: 1px solid var(--pa-border); border-radius: var(--pa-radius-sm); background: var(--pa-surface); overflow-x: auto; scrollbar-width: thin; }
      .lcr-pa-subnav__item { appearance: none; flex: 0 0 auto; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--pa-muted); padding: 6px 11px; font: inherit; font-size: var(--pa-fs-2); cursor: pointer; white-space: nowrap; }
      .lcr-pa-subnav__item:hover { color: var(--pa-text); }
      .lcr-pa-subnav__item--active { color: var(--pa-text); background: var(--pa-surface-2); border-color: var(--pa-border-2); font-weight: 600; }
      .lcr-pa-secthead { display: flex; flex-direction: column; gap: 2px; }
      .lcr-pa-secthead__title { margin: 0; font-size: var(--pa-fs-5); font-weight: 650; letter-spacing: -0.01em; }
      .lcr-pa-secthead__sub { margin: 0; color: var(--pa-muted); font-size: var(--pa-fs-2); }
      .lcr-pa-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--pa-space-3); }
      .lcr-pa-kpi { display: flex; flex-direction: column; gap: 2px; padding: var(--pa-space-4); border: 1px solid var(--pa-border); border-radius: var(--pa-radius-lg); background: var(--pa-bg-elev); min-width: 0; }
      .lcr-pa-kpi__label { font-size: var(--pa-fs-1); text-transform: uppercase; letter-spacing: 0.05em; color: var(--pa-muted); font-weight: 650; }
      .lcr-pa-kpi__value { font-size: 26px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
      .lcr-pa-kpi__hint { font-size: var(--pa-fs-1); color: var(--pa-text-2); }
      .lcr-pa-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--pa-space-3); align-items: start; }
      .lcr-pa-card__title { margin: 0; font-size: var(--pa-fs-4); font-weight: 620; }
      .lcr-pa-path { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
      .lcr-pa-path__value { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: var(--pa-fs-1); color: var(--pa-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
      .lcr-pa-path__btn { appearance: none; border: 1px solid var(--pa-border); border-radius: 5px; background: var(--pa-surface-2); color: var(--pa-muted); font: inherit; font-size: 10.5px; padding: 2px 7px; cursor: pointer; }
      .lcr-pa-path__btn:hover { color: var(--pa-text); border-color: var(--pa-border-2); }
      .lcr-pa-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: var(--pa-space-5); border: 1px dashed var(--pa-border-2); border-radius: var(--pa-radius-lg); background: color-mix(in oklab, var(--pa-surface) 60%, transparent); }
      .lcr-pa-empty__title { font-size: var(--pa-fs-3); }
      .lcr-pa-empty__hint { margin: 0; color: var(--pa-muted); font-size: var(--pa-fs-2); max-width: 64ch; }
      .lcr-pa-kv-grid { display: flex; flex-direction: column; gap: 8px; }
      .lcr-pa-kv-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--pa-border-2); font-size: var(--pa-fs-2); }
      .lcr-pa-kv-row:last-child { border-bottom: 0; padding-bottom: 0; }
      .lcr-pa-steps { display: flex; flex-direction: column; gap: 10px; margin: 12px 0 0; padding: 0 0 0 16px; }
      .lcr-pa-steps li { display: flex; flex-direction: column; gap: 1px; font-size: var(--pa-fs-2); color: var(--pa-muted); }
      .lcr-pa-steps strong { color: var(--pa-text); font-weight: 600; }
      .lcr-pa-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; }
      .lcr-pa-toggle__label { font-size: var(--pa-fs-3); font-weight: 600; }
      .lcr-pa-toggle__switch { appearance: none; width: 40px; height: 22px; border-radius: 999px; border: 1px solid var(--pa-border-2); background: var(--pa-surface-2); position: relative; cursor: not-allowed; opacity: 0.55; }
      .lcr-pa-toggle__switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--pa-muted); }
      .lcr-pa-row--wrap { flex-wrap: wrap; }
      .lcr-pa-links { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: var(--pa-fs-2); }
      .lcr-pa-links li { display: flex; align-items: baseline; gap: 4px; flex-wrap: wrap; }
      .lcr-pa-chip--neutral { border-color: var(--pa-border-2); color: var(--pa-muted); background: color-mix(in oklab, var(--pa-surface-2) 50%, transparent); }
      @media (max-width: 1100px) {
        .lcr-pa-layout { grid-template-columns: 1fr; }
        .lcr-pa-nav { position: static; flex-direction: row; overflow-x: auto; scrollbar-width: thin; }
        .lcr-pa-nav__item { width: auto; white-space: nowrap; }
        .lcr-pa-grid2 { grid-template-columns: 1fr; }
      }
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
        panelState,
        request,
        negotiateMode,
        get DATA_MODE() { return panelState.mode; },
        SYNTHETIC_BANNER,
        PA_DICT,
        PA_VIEWS,
        PA_AREAS,
        PA_SUBNAV,
        PA_AREA_VIEWS,
        paAreaOf,
        paViewLabel,
        paOverviewMetrics,
        paProjectState,
        paShortPath,
        PaPath,
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
        paViewProjects,
        paViewCandidates,
        paViewWorkspaces,
        paWorkspaceState,
        paWorkspaceSessions,
        paWorkspaceReason,
        paAdminError,
        paReadLanguage,
        paChunks,
        paBuildSources,
        requestLegacy: request,
      },
    };
  },
});
;
//# sourceMappingURL=??@designerbyron/lifecode-rag/client.js.map&rev=c30d85c59345
