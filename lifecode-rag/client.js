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
    /**
     * UX-2.2 · presupuesto propio de la lectura de seguimiento. Se declara aquí y no se hereda del
     * presupuesto general para que el contrato de la vista (10 s) no cambie en silencio si cambia
     * el de las demás rutas.
     */
    const TRACKING_TIMEOUT_MS = 10000;

    /** Presupuesto de contexto por defecto del contrato §8 (2000 tokens estimados). */
    const PA_CONTEXT_BUDGET = 2000;
    /** UX-2.2 · filtros de la vista de Seguimiento, en el orden en que se pintan. */
    const PA_TRACKING_FILTERS = ['all', 'followed', 'none', 'withProject', 'withoutProject'];
    /** Clave i18n de cada filtro. Explícita: el catálogo se analiza de forma estática (FA-02). */
    const PA_TRACKING_FILTER_KEYS = {
      all: 'ux.track.filter.all',
      followed: 'ux.track.filter.followed',
      none: 'ux.track.filter.none',
      withProject: 'ux.track.filter.withProject',
      withoutProject: 'ux.track.filter.withoutProject',
    };
    /**
     * UX-2.2 · cortes de anchura de la tabla de Seguimiento. Son el ÚNICO sitio donde están los
     * números: la hoja de estilos los interpola para sus `@media` y `paTrackingLayout` los usa para
     * decidir la variante, así que la decisión y el CSS no pueden separarse.
     *   - por encima del corte `compact`: fila de tabla con la columna de acciones propia;
     *   - `compact` o menos: la fila se apila como tarjeta (workspace y estado arriba, acciones debajo);
     *   - `mobile` o menos: la tarjeta se estrecha y las acciones ocupan el ancho completo.
     */
    const PA_TRACK_BREAKPOINTS = Object.freeze({ compact: 1100, mobile: 640 });
    const PANEL_ID = 'lifecode-rag';
    const SIDEBAR_SLOT = 'sidebar.panellist';
    const MAIN_SLOT = 'main';
    // Modo de datos del panel. 'connecting' = todavía no se negoció; 'api' = datos leídos del
    // registro del perfil; 'down' = el servicio no respondió (o negó la credencial) y se muestra su
    // razón; 'fixture' = demostración EXPLÍCITA (acción humana en Ajustes o prop `demo` del host).
    // LE-RAG-10: el modo se negocia con el servidor PA y sólo 'api' habilita la red. Un fallo NO se
    // convierte en demostración: se pinta el error real, nunca datos sintéticos.
    const panelState = { mode: 'connecting', reason: 'sin negociar', service: null, demo: false };
    let requestSeq = 0;
    const latestSeq = new Map();
    /**
     * UX-2.2 · identidad del ciclo de lectura del seguimiento. Cada ciclo de carga toma un número;
     * una respuesta (o una cancelación) de un ciclo anterior no puede pintar ni cerrar el vigente.
     */
    let trackingLoadGen = 0;

    /* ------------------------------------------------------------------ API */

    async function request(path, options = {}) {
      if (panelState.mode !== 'api') {
        const blocked = new Error('panel-not-connected: el panel no está conectado a la API PA');
        blocked.code = 'panel-not-connected';
        throw blocked;
      }
      const base = options.target === 'legacy' ? API : PA_API;
      const method = options.method || 'GET';
      const headers = { accept: 'application/json' };
      if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
        headers['x-lifecode-rag'] = '1';
      }
      // UX-2.2: `DELETE /pa/tracking` lleva sus argumentos en la query, sin cuerpo. La compuerta
      // del servidor exige las mismas cabeceras que en una mutación con cuerpo, así que se declaran
      // explícitamente en vez de depender de que `body` exista.
      if (options.mutation === true) {
        headers['content-type'] = 'application/json';
        headers['x-lifecode-rag'] = '1';
      }
      const key = method + ' ' + path;
      const seq = ++requestSeq;
      latestSeq.set(key, seq);
      const controller = new AbortController();
      // UX-2.2: el presupuesto es por petición. Un `AbortError` sólo es `timeout` si lo provocó
      // nuestro reloj; si lo provocó la cancelación del llamante, el motivo es `cancelled` y no un
      // error engañoso (la vista sale de carga sin pintar un fallo que no ocurrió).
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); },
        Number.isFinite(options.timeoutMs) ? options.timeoutMs : REQUEST_TIMEOUT_MS);
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
        failure.code = aborted ? (timedOut ? 'timeout' : 'cancelled') : 'network';
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
          panelState.demo = false;
          return panelState;
        }
        // Un fallo de servicio NUNCA se degrada a demostración: se informa con su código.
        panelState.mode = 'down';
        panelState.reason = (data && data.error && data.error.code) || ('http-' + response.status);
        panelState.service = 'down';
        panelState.demo = false;
      } catch (error) {
        panelState.mode = 'down';
        panelState.reason = (error && error.code) || 'transport-error';
        panelState.service = 'down';
        panelState.demo = false;
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
        'ux.overview.projects': 'Proyectos configurados',
        'ux.overview.sources': 'Documentos indexados',
        'ux.overview.coverage': 'Cobertura documental',
        'ux.overview.projectsHint': '{ready} de {total} proyectos con raíz autorizada',
        'ux.overview.coverageHint': '{withDocs} de {total} proyectos con documentos',
        'ux.overview.coverageNoData': 'Sin datos: no hay documentos indexados o falta el recuento de algún proyecto',
        'ux.overview.docsUnknown': 'sin recuento del proyecto activo',
        'ux.overview.noData': 'Sin datos',
        'ux.overview.tracking': 'Seguimiento',
        'ux.overview.trackingOff': 'No disponible en esta versión',
        'ux.overview.trackingManual': 'Manual por workspace',
        'ux.overview.next': 'Siguiente paso',
        'ux.overview.nextNone': 'Nada pendiente: todos tus proyectos tienen raíz autorizada.',
        'ux.overview.nextNoDocs': '«{name}» no tiene documentos todavía.',
        'ux.overview.nextNoProject': 'Registra tu primer proyecto para empezar.',
        'ux.overview.empty': 'Todavía no hay proyectos configurados',
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
        // «Configurado» y no «Listo»: este estado sólo certifica `status:'active'` + raíz autorizada
        // (`paProjectState`). No dice que haya documentos ni que la recuperación funcione.
        'ux.ws.stReady': 'Configurado',
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
        'ux.track.title': 'Seguimiento',
        'ux.track.sub': 'Qué workspaces sigues, cuáles están pausados y qué resuelven',
        'ux.track.off': 'No disponible en esta versión',
        'ux.track.offHint': 'El modo fácil necesita la detección de workspaces del Host y tus decisiones de autorización. Llegará en una fase posterior; hoy el seguimiento es manual.',
        'ux.track.step1': '1 · Leer la lista de workspaces',
        'ux.track.step1Hint': 'Sólo nombre y ruta; nunca el contenido.',
        'ux.track.step2': '2 · Leer las carpetas que aceptes',
        'ux.track.step2Hint': 'Una por una: autorizar una carpeta no autoriza a sus subcarpetas.',
        'ux.track.step3': '3 · Preparar el contexto',
        'ux.track.step3Hint': 'Al abrir el proyecto, sin que hagas nada.',
        'ux.track.manual': 'Sigue los workspaces que quieras desde esta sección; la autorización de lectura se administra aparte.',
        // UX-2.2 · los tres conceptos que no pueden confundirse: seguimiento (esta sección),
        // selección de perfil (`pa_selection`, «Seleccionado para administrar») y proyecto resuelto
        // por una sesión de IA (sólo si la API puede decirlo).
        'ux.track.stateOn': 'Seguido',
        'ux.track.statePaused': 'Pausado',
        'ux.track.stateOff': 'Sin seguimiento',
        'ux.track.stateUnknown': 'No se puede determinar desde el panel',
        'ux.track.onNoProject': 'Seguido · sin proyecto asociado — no resolverá contexto',
        'ux.track.selection': 'Seleccionado para administrar',
        'ux.track.sessionUnknown': 'No se puede determinar desde el panel',
        'ux.track.notAuthorized': 'Seguir un workspace no autoriza su lectura ni sus subcarpetas; la autorización se administra aparte',
        'ux.track.project': 'Proyecto asociado',
        'ux.track.noProject': 'Sin proyecto asociado',
        'ux.track.col.workspace': 'Workspace',
        'ux.track.tableCaption': 'Workspaces y su seguimiento',
        'ux.track.col.state': 'Seguimiento',
        'ux.track.col.project': 'Proyecto asociado',
        'ux.track.col.session': 'Proyecto de la sesión de IA',
        'ux.track.col.actions': 'Acciones',
        'ux.track.enable': 'Activar seguimiento',
        'ux.track.pause': 'Pausar',
        'ux.track.resume': 'Reanudar',
        'ux.track.disable': 'Dejar de seguir',
        'ux.track.remove': 'Quitar fila',
        'ux.track.toggle': 'Seguir este workspace',
        'ux.track.filters': 'Filtros de seguimiento',
        'ux.track.filter.all': 'Todos',
        'ux.track.filter.followed': 'Seguidos',
        'ux.track.filter.none': 'Sin seguimiento',
        'ux.track.filter.withProject': 'Con proyecto',
        'ux.track.filter.withoutProject': 'Sin proyecto',
        'ux.track.countTotal': '{total} workspaces',
        'ux.track.countFollowed': 'Seguidos: {count}',
        'ux.track.countPaused': 'Pausados: {count}',
        'ux.track.countNone': 'Sin seguimiento: {count}',
        'ux.track.revision': 'revisión {revision}',
        'ux.track.loading': 'Leyendo el seguimiento…',
        'ux.track.idle': 'Entra en la sección para leer el seguimiento.',
        'ux.track.offline': 'El seguimiento necesita la API',
        'ux.track.offlineHint': 'En modo demostración no se inventan seguimientos ni se escribe nada.',
        'ux.track.err': 'No se pudo leer el seguimiento',
        'ux.track.errCode': 'Motivo',
        'ux.track.retry': 'Reintentar',
        'ux.track.empty': 'No hay workspaces que seguir',
        'ux.track.emptyHint': 'El Host no conoce ningún workspace todavía. Cuando haya alguno, aparecerá aquí.',
        'ux.track.noRows': 'Este filtro no deja ningún workspace',
        'ux.track.noRowsHint': 'Cambia el filtro para ver otros.',
        'ux.track.availability': 'Disponibilidad',
        // R1.2 · eje de memoria (Q-01) y acciones avanzadas.
        'ux.track.memoryReady': 'Memoria lista',
        'ux.track.memoryProvisioning': 'Preparando memoria',
        'ux.track.memoryNone': 'Sin memoria todavía',
        'ux.track.memoryIncomplete': 'Asociación pendiente',
        'ux.track.memoryStoreMissing': 'Memoria no disponible',
        'ux.track.memoryArchived': 'Proyecto archivado',
        'ux.track.memoryUnknown': 'Memoria: no se puede determinar',
        'ux.track.index': 'Índice',
        'ux.track.cleanupPending': 'Limpieza de acceso pendiente; se reintenta al reiniciar.',
        'ux.track.rekeyPending': 'Ruta del índice pendiente; se reintenta al reiniciar.',
        'ux.track.indexQueued': 'en cola',
        'ux.track.indexRunning': 'indexando…',
        'ux.track.indexFailed': 'la última pasada falló',
        'ux.track.advanced': 'Avanzado',
        'ux.track.revoke': 'Revocar acceso de lectura',
        'ux.track.revokeScope': 'Se retirará el acceso de lectura que LifeCode RAG creó para esta carpeta. No se borra la memoria, ni el proyecto, ni el índice, ni el seguimiento.',
        'ux.track.revokeEntries': 'Entradas propias que se revisarán: {items}.',
        'ux.track.revokeTrust': 'confianza',
        'ux.track.revokeRoot': 'raíz',
        'ux.track.revokeNoEntries': 'no consta ninguna entrada propia verificable',
        'ux.track.revokeUnknown': 'No hay datos suficientes para demostrar la propiedad de este acceso; no se revoca desde aquí.',
        'ux.track.revokeUnproven': 'No se puede demostrar que LifeCode RAG creara ese acceso: no se revoca desde aquí.',
        'ux.track.revokeAlready': 'El acceso propio ya se revocó; la memoria sigue intacta.',
        'ux.track.revokeProvisioning': 'La memoria se está preparando; espera a que termine para revocar.',
        'ux.track.revokeInactive': 'El proyecto no está activo; no se revoca desde aquí.',
        'ux.track.revokeConfirm': 'Confirmar revocación',
        'ux.track.move': 'Mover carpeta',
        'ux.track.moveScope': 'La memoria, el proyecto y el índice se conservan. La ruta anterior deja de estar autorizada si ese acceso lo creó LifeCode RAG.',
        'ux.track.moveNewPath': 'Ruta nueva',
        'ux.track.moveConfirm': 'Mover la memoria',
        'ux.track.adminCancel': 'Cancelar',
        'ux.set.title': 'Ajustes',
        'ux.projects.summary': 'Resumen',
        'ux.state.active': 'Activa',
        'ux.state.ok': 'Correcto',
        // El almacén del proyecto nace con la primera ingesta: su ausencia es un estado normal, no
        // una avería. Se rotula aparte del servicio (docs/PANEL-KPIS.md §Estados).
        'ux.state.storePending': 'sin crear todavía',
        'ux.state.storePendingHint': 'el almacén del proyecto nace con la primera ingesta; todavía no hay documentos que indexar',
        'ux.state.degraded': 'Degradado',
        'ux.set.docsHint': 'en el proyecto activo',
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
        'ux.set.connecting': 'Cargando',
        'ux.set.offline': 'Sin conexión',
        'ux.set.source': 'Procedencia de los datos',
        'ux.set.sourceApi': 'Registro del perfil (API PA)',
        'ux.set.sourceFixture': 'Fixtures de demostración',
        'ux.set.demoService': 'Demo (sin servicio real)',
        'ux.set.demoTitle': 'Modo demostración',
        'ux.set.demoHint': 'La demostración pinta datos sintéticos y no lee tu registro. Sólo se activa desde aquí y la cabecera lo anuncia mientras esté encendida.',
        'ux.set.demoOn': 'Ver datos de demostración',
        'ux.set.demoOff': 'Salir del modo demostración',
        'ux.set.audit': 'Auditorías',
        'ux.set.docs': 'Documentos indexados',
        'ux.set.hint': 'Los códigos técnicos y el detalle de la API viven en estas secciones.',
        'ux.state.ready': 'Listo',
        'ux.state.none': 'Sin proyecto',
        'ux.state.partial': 'Con acceso',
        'ux.state.detected': 'Detectado',
        'ux.state.missing': 'No encontrado',
        'ux.path.show': 'Mostrar ruta',
        'ux.path.hide': 'Ocultar',
        'ux.path.copy': 'Copiar ruta',
        'ux.path.copied': 'Copiada',
        'ux.projects.sub': 'Proyectos registrados, sus raíces autorizadas y su estado documental',
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
        'diagnostics.noData': 'Sin datos del servicio todavía: no se muestran integridad, auditoría ni versiones.',
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
        // Capa 3 del estado (docs/PANEL-KPIS.md §Estados): el almacén de un proyecto concreto.
        'connection.store': 'Almacén del proyecto',
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
        'notice.selectionFailed': 'No se pudo guardar la selección ({reason}). Se recargó la selección: ese es el estado real.',
        'notice.selectionFailedUnreloaded': 'No se pudo guardar la selección ({reason}) y no se pudo releer: el estado mostrado puede estar desactualizado.',
        'notice.selectionConflictUnreloaded': 'Otro panel cambió la selección antes ({reason}) y no se pudo releer: el estado mostrado puede estar desactualizado.',
        'notice.ingest': 'Ingesta simulada completada: una fuente añadida al fixture.',
        'notice.reindex': 'Reindexación simulada completada: no se escribió nada.',
        'notice.reset': 'Datos sintéticos reiniciados.',
        'notice.searchEmpty': 'La búsqueda no devolvió resultados en el fixture.',
        'notice.emptyQuery': 'Escribe algo para buscar; no se cambió nada.',
        'notice.longQuery': 'La consulta supera el límite de 512 caracteres.',
        'notice.duplicateUri': 'Esa URI ya está en el fixture; no se añadió nada.',
        // UX-2.2 · seguimiento. El conflicto de revisión NO se reintenta solo: se recarga y se avisa.
        'notice.trackingSaved': 'Seguimiento actualizado (revisión {revision}).',
        'notice.trackingRemoved': 'Se quitó la fila de seguimiento; el workspace sigue en la lista del Host.',
        'notice.trackingReloaded': 'La respuesta no trajo la fila: se recargó el seguimiento desde el servidor.',
        'notice.trackingReloadFailed': 'La respuesta no trajo la fila y la relectura falló: el seguimiento mostrado puede estar desactualizado.',
        'notice.trackingConflict': 'Otro panel cambió el seguimiento antes: se recargó el estado vigente y no se sobrescribió nada.',
        'notice.trackingFailed': 'No se pudo completar el cambio ({reason}). Se recargó el seguimiento: esa es la fila real.',
        'notice.trackingFailedUnreloaded': 'No se pudo completar el cambio ({reason}) y tampoco se pudo releer el seguimiento: la vista puede estar desactualizada.',
        'notice.trackingConflictUnreloaded': 'Otro panel cambió el seguimiento antes ({reason}) y no se pudo releer: la vista puede estar desactualizada.',
        'notice.memoryReady': 'Memoria lista. Ya puedes indexar',
        'notice.memoryReused': 'Hemos reutilizado la memoria de este proyecto',
        'notice.trackingRevoked': 'Acceso de lectura revocado; la memoria sigue intacta.',
        'notice.trackingRevokeNoChange': 'No había acceso propio que retirar en este acto; no se cambió nada.',
        'notice.trackingRevokeNoChangeRemaining': 'No se retiró ningún acceso propio en este acto; quedan {count} autorizaciones preexistentes.',
        'notice.trackingRevokedPartial': 'Se retiró el acceso que creó LifeCode RAG, pero quedan {count} autorizaciones preexistentes: el acceso de lectura continúa.',
        'notice.trackingMoved': 'Memoria movida; la ruta anterior ya no está asociada.',
        'notice.trackingMoveNoItem': 'La respuesta no trajo la fila movida: actualiza el seguimiento antes de darlo por hecho.',
        'notice.trackingAdminFailed': 'No se pudo completar la acción ({reason}). Se recargó el seguimiento: esa es la fila real.',
        'notice.trackingAdminFailedUnreloaded': 'No se pudo completar la acción ({reason}) y no se pudo releer el seguimiento: la vista puede estar desactualizada.',
        'notice.trackingOffline': 'El seguimiento necesita la API: en modo demostración no se cambia nada.',
        'view.errorTitle': 'No se pudo mostrar esta vista',
        'view.errorHint': 'El resto del panel sigue disponible. Reintenta o cambia de sección.',
        'view.retry': 'Reintentar',
        'view.retrying': 'Reintentando…',
        // F-1 (1.5.11): varios proyectos activos sin selección. Es una decisión, no una avería.
        'view.selectTitle': 'Elige un proyecto',
        'view.selectHint': 'Hay {count} proyectos activos y ninguno seleccionado. Hasta que elijas uno, el panel no lee documentos de ninguno: no se selecciona nada por su cuenta.',
        'view.selectAria': 'Seleccionar {name}',
        'view.selecting': 'Seleccionando…',
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
        'ux.overview.projects': 'Configured projects',
        'ux.overview.sources': 'Indexed documents',
        'ux.overview.coverage': 'Document coverage',
        'ux.overview.projectsHint': '{ready} of {total} projects with an authorized root',
        'ux.overview.coverageHint': '{withDocs} of {total} projects with documents',
        'ux.overview.coverageNoData': 'No data: no indexed documents, or a project is missing its count',
        'ux.overview.docsUnknown': 'the active project does not publish its count',
        'ux.overview.noData': 'No data',
        'ux.overview.tracking': 'Tracking',
        'ux.overview.trackingOff': 'Not available in this version',
        'ux.overview.trackingManual': 'Manual per workspace',
        'ux.overview.next': 'Next step',
        'ux.overview.nextNone': 'Nothing pending: every project has an authorized root.',
        'ux.overview.nextNoDocs': '"{name}" has no documents yet.',
        'ux.overview.nextNoProject': 'Register your first project to get started.',
        'ux.overview.empty': 'No configured projects yet',
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
        // «Configured», not «Ready»: this state only certifies an active project with an authorized
        // root. It says nothing about documents or retrieval.
        'ux.ws.stReady': 'Configured',
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
        'ux.track.title': 'Tracking',
        'ux.track.sub': 'Which workspaces you follow, which are paused and what they resolve',
        'ux.track.off': 'Not available in this version',
        'ux.track.offHint': 'Easy mode needs Host workspace detection and your authorization decisions. It arrives in a later phase; today tracking is manual.',
        'ux.track.step1': '1 · Read the workspace list',
        'ux.track.step1Hint': 'Name and path only; never the content.',
        'ux.track.step2': '2 · Read the folders you accept',
        'ux.track.step2Hint': 'One by one: authorizing a folder does not authorize its subfolders.',
        'ux.track.step3': '3 · Prepare the context',
        'ux.track.step3Hint': 'When you open the project, without you doing anything.',
        'ux.track.manual': 'Follow the workspaces you want from this section; read authorization is managed separately.',
        'ux.track.stateOn': 'Followed',
        'ux.track.statePaused': 'Paused',
        'ux.track.stateOff': 'Not followed',
        'ux.track.stateUnknown': 'Cannot be determined from the panel',
        'ux.track.onNoProject': 'Followed · no associated project — it will not resolve context',
        'ux.track.selection': 'Selected for administration',
        'ux.track.sessionUnknown': 'Cannot be determined from the panel',
        'ux.track.notAuthorized': 'Following a workspace does not authorize reading it or its subfolders; authorization is managed separately',
        'ux.track.project': 'Associated project',
        'ux.track.noProject': 'No associated project',
        'ux.track.col.workspace': 'Workspace',
        'ux.track.tableCaption': 'Workspaces and their tracking',
        'ux.track.col.state': 'Tracking',
        'ux.track.col.project': 'Associated project',
        'ux.track.col.session': 'AI session project',
        'ux.track.col.actions': 'Actions',
        'ux.track.enable': 'Start following',
        'ux.track.pause': 'Pause',
        'ux.track.resume': 'Resume',
        'ux.track.disable': 'Stop following',
        'ux.track.remove': 'Remove row',
        'ux.track.toggle': 'Follow this workspace',
        'ux.track.filters': 'Tracking filters',
        'ux.track.filter.all': 'All',
        'ux.track.filter.followed': 'Followed',
        'ux.track.filter.none': 'Not followed',
        'ux.track.filter.withProject': 'With project',
        'ux.track.filter.withoutProject': 'Without project',
        'ux.track.countTotal': '{total} workspaces',
        'ux.track.countFollowed': 'Followed: {count}',
        'ux.track.countPaused': 'Paused: {count}',
        'ux.track.countNone': 'Not followed: {count}',
        'ux.track.revision': 'revision {revision}',
        'ux.track.loading': 'Reading tracking…',
        'ux.track.idle': 'Open the section to read tracking.',
        'ux.track.offline': 'Tracking needs the API',
        'ux.track.offlineHint': 'Demo mode invents no tracking and writes nothing.',
        'ux.track.err': 'Tracking could not be read',
        'ux.track.errCode': 'Reason',
        'ux.track.retry': 'Retry',
        'ux.track.empty': 'There are no workspaces to follow',
        'ux.track.emptyHint': 'The Host does not know any workspace yet. When there is one, it will appear here.',
        'ux.track.noRows': 'This filter leaves no workspace',
        'ux.track.noRowsHint': 'Change the filter to see others.',
        'ux.track.availability': 'Availability',
        // R1.2 · memory axis (Q-01) and advanced actions.
        'ux.track.memoryReady': 'Memory ready',
        'ux.track.memoryProvisioning': 'Preparing memory',
        'ux.track.memoryNone': 'No memory yet',
        'ux.track.memoryIncomplete': 'Association pending',
        'ux.track.memoryStoreMissing': 'Memory unavailable',
        'ux.track.memoryArchived': 'Project archived',
        'ux.track.memoryUnknown': 'Memory: cannot be determined',
        'ux.track.index': 'Index',
        'ux.track.cleanupPending': 'Access cleanup pending; it is retried on restart.',
        'ux.track.rekeyPending': 'Index path pending; it is retried on restart.',
        'ux.track.indexQueued': 'queued',
        'ux.track.indexRunning': 'indexing…',
        'ux.track.indexFailed': 'the last pass failed',
        'ux.track.advanced': 'Advanced',
        'ux.track.revoke': 'Revoke read access',
        'ux.track.revokeScope': 'The read access that LifeCode RAG created for this folder will be removed. Memory, project, index and tracking are not deleted.',
        'ux.track.revokeEntries': 'Own entries to review: {items}.',
        'ux.track.revokeTrust': 'trust',
        'ux.track.revokeRoot': 'root',
        'ux.track.revokeNoEntries': 'no verifiable own entry is recorded',
        'ux.track.revokeUnknown': 'There is not enough data to prove this access is ours; it is not revoked here.',
        'ux.track.revokeUnproven': 'LifeCode RAG cannot prove it created that access: it is not revoked here.',
        'ux.track.revokeAlready': 'The access it created was already revoked; memory is still intact.',
        'ux.track.revokeProvisioning': 'Memory is being prepared; wait for it to finish before revoking.',
        'ux.track.revokeInactive': 'The project is not active; it is not revoked here.',
        'ux.track.revokeConfirm': 'Confirm revocation',
        'ux.track.move': 'Move folder',
        'ux.track.moveScope': 'Memory, project and index are kept. The previous path stops being authorized if LifeCode RAG created that access.',
        'ux.track.moveNewPath': 'New path',
        'ux.track.moveConfirm': 'Move memory',
        'ux.track.adminCancel': 'Cancel',
        'ux.set.title': 'Settings',
        'ux.projects.summary': 'Summary',
        'ux.state.active': 'Active',
        'ux.state.ok': 'OK',
        // A project's store is born on first ingest: its absence is a normal state, not a breakdown.
        // It is labelled apart from the service (docs/PANEL-KPIS.md §Estados).
        'ux.state.storePending': 'not created yet',
        'ux.state.storePendingHint': "the project's store is born on first ingest; there are no documents to index yet",
        'ux.state.degraded': 'Degraded',
        'ux.set.docsHint': 'in the active project',
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
        'ux.set.connecting': 'Loading',
        'ux.set.offline': 'Not connected',
        'ux.set.source': 'Data source',
        'ux.set.sourceApi': 'Profile registry (PA API)',
        'ux.set.sourceFixture': 'Demo fixtures',
        'ux.set.demoService': 'Demo (no real service)',
        'ux.set.demoTitle': 'Demo mode',
        'ux.set.demoHint': 'The demo paints synthetic data and does not read your registry. It is enabled only here, and the header announces it while it is on.',
        'ux.set.demoOn': 'Show demo data',
        'ux.set.demoOff': 'Leave demo mode',
        'ux.set.audit': 'Audits',
        'ux.set.docs': 'Indexed documents',
        'ux.set.hint': 'Technical codes and API detail live in these sections.',
        'ux.state.ready': 'Ready',
        'ux.state.none': 'No project',
        'ux.state.partial': 'With access',
        'ux.state.detected': 'Detected',
        'ux.state.missing': 'Not found',
        'ux.path.show': 'Show path',
        'ux.path.hide': 'Hide',
        'ux.path.copy': 'Copy path',
        'ux.path.copied': 'Copied',
        'ux.projects.sub': 'Registered projects, their authorized roots and their document status',
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
        'diagnostics.noData': 'No service data yet: integrity, audit and versions are not shown.',
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
        // Layer 3 of the status reading (docs/PANEL-KPIS.md §Estados): one project's store.
        'connection.store': 'Project store',
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
        'notice.selectionFailed': 'The selection could not be saved ({reason}). The selection was reloaded: that is the real state.',
        'notice.selectionFailedUnreloaded': 'The selection could not be saved ({reason}) and it could not be reloaded: the view may be stale.',
        'notice.selectionConflictUnreloaded': 'Another panel changed the selection first ({reason}) and it could not be reloaded: the view may be stale.',
        'notice.ingest': 'Simulated ingestion complete: one source added to the fixture.',
        'notice.reindex': 'Simulated reindex complete: nothing was written.',
        'notice.reset': 'Synthetic data reset.',
        'notice.searchEmpty': 'The search returned no results in the fixture.',
        'notice.emptyQuery': 'Type something to search; nothing changed.',
        'notice.longQuery': 'The query exceeds the 512-character limit.',
        'notice.duplicateUri': 'That URI is already in the fixture; nothing was added.',
        'notice.trackingSaved': 'Tracking updated (revision {revision}).',
        'notice.trackingRemoved': 'The tracking row was removed; the workspace stays in the Host list.',
        'notice.trackingReloaded': 'The response did not include the row: tracking was reloaded from the server.',
        'notice.trackingReloadFailed': 'The response did not include the row and the reload failed: the tracking shown may be stale.',
        'notice.trackingConflict': 'Another panel changed tracking first: the current state was reloaded and nothing was overwritten.',
        'notice.trackingFailed': 'Tracking could not be changed ({reason}). Tracking was reloaded: that is the real row.',
        'notice.trackingFailedUnreloaded': 'The change failed ({reason}) and tracking could not be reloaded: the view may be stale.',
        'notice.trackingConflictUnreloaded': 'Another panel changed tracking first ({reason}) and it could not be reloaded: the view may be stale.',
        'notice.memoryReady': 'Memory ready. You can index now',
        'notice.memoryReused': 'This project’s memory was reused',
        'notice.trackingRevoked': 'Read access revoked; memory is still intact.',
        'notice.trackingRevokeNoChange': 'There was no access of our own to remove in this action; nothing changed.',
        'notice.trackingRevokeNoChangeRemaining': 'No access of our own was removed in this action; {count} pre-existing authorizations remain.',
        'notice.trackingRevokedPartial': 'The access LifeCode RAG created was removed, but {count} pre-existing authorizations remain: read access continues.',
        'notice.trackingMoved': 'Memory moved; the previous path is no longer associated.',
        'notice.trackingMoveNoItem': 'The response did not include the moved row: refresh tracking before taking it as done.',
        'notice.trackingAdminFailed': 'The action could not be completed ({reason}). Tracking was reloaded: that is the real row.',
        'notice.trackingAdminFailedUnreloaded': 'The action could not be completed ({reason}) and tracking could not be reloaded: the view may be stale.',
        'notice.trackingOffline': 'Tracking needs the API: demo mode changes nothing.',
        'view.errorTitle': 'This view could not be rendered',
        'view.errorHint': 'The rest of the panel is still available. Retry or switch section.',
        'view.retry': 'Retry',
        'view.retrying': 'Retrying…',
        'view.selectTitle': 'Choose a project',
        'view.selectHint': 'There are {count} active projects and none is selected. Until you pick one, the panel reads no documents from any of them: nothing is selected on your behalf.',
        'view.selectAria': 'Select {name}',
        'view.selecting': 'Selecting…',
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

    /**
     * Estado NEUTRO del panel: exactamente cero proyectos, cero bibliotecas, cero documentos y una
     * selección vacía. No hay un solo dato del fixture. `mode:'loading'` significa «aún no se
     * negoció ni se leyó nada»; el panel pide el snapshot al montarse y sólo entonces pinta el
     * registro real (vacío incluido). La demostración exige `{ demo: true }` de forma explícita.
     */
    function paInitialState(options) {
      if (options && options.demo === true) return paDemoState();
      return {
        view: 'overview',
        mode: 'loading',
        demo: false,
        // Procedencia visible de los datos: 'none' hasta que la API confirme; 'api' o 'fixture'.
        dataSource: 'none',
        // Sin petición en curso. Explícito: el reducer distingue «libre» (null) de «ocupado» y una
        // clave ausente no es lo mismo que null al comparar.
        pending: null,
        apiVersion: null,
        session: {
          api: null,
          contract: null,
          session: {
            id: null,
            profileKey: null,
            state: 'none',
            invalidReason: null,
            expiresAt: null,
            selection: {
              state: 'none',
              projectId: null,
              projectName: null,
              source: null,
              revision: 0,
              selectedBy: null,
              selectedAt: null,
              candidates: [],
            },
          },
          project: null,
          scopes: [],
          scopeCount: 0,
          service: { status: 'unknown', registry: 'unknown', storeRoot: 'unknown' },
        },
        projects: [],
        libraries: [],
        sources: [],
        sourcesTotal: 0,
        // `sourcesKnown` separa «cero documentos» de «el snapshot no lo dice»: sin snapshot no se
        // certifica nada, así que la cobertura documental se declara «Sin datos», no 0 % ni 100 %.
        sourcesKnown: false,
        sourcePage: { limit: PA_PAGE_LIMIT, offset: 0 },
        history: { entries: [], total: 0, nextCursor: null, integrity: null, pages: 1, loaded: false, error: null },
        selectedSourceId: null,
        query: '',
        limit: 8,
        ingestPath: PA_INGEST_PATHS[0],
        results: null,
        context: null,
        diagnostics: { scopes: [], grants: [], integrity: null, versions: null },
        health: { status: 'unknown', registry: 'unknown', legacy: false },
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
        // UX-2.2 · seguimiento por workspace. Mismo patrón que `workspaces`: `loaded` separa «no se
        // ha pedido» de «se pidió y no hay ninguna fila»; `items` sólo contiene filas de seguimiento
        // (la vista las cruza con la lista del Host para poder decir «Sin seguimiento»).
        tracking: {
          loaded: false,
          loading: false,
          error: null,
          items: [],
          counts: null,
          asOf: null,
          truncated: false,
          filter: 'all',
        },
        // Mutación en curso: `{pathKey, action, state, expectedRevision, projectId}`. Se guarda
        // completa para que el efecto no tenga que reconstruirla desde la vista.
        trackingOp: null,
        // R1.2 · acción avanzada pendiente de confirmación (`move`/`revoke`). Vive en el estado para
        // que el formulario no dependa de estado local del componente.
        trackingAdmin: null,
      };
    }

    /**
     * Estado de DEMOSTRACIÓN. Sólo se llega aquí con una activación explícita (acción humana en
     * Ajustes o prop `demo` del host): jamás como consecuencia de un fallo o de un registro vacío.
     * La cabecera anuncia el modo y el indicador de servicio no puede decir `ok`.
     */
    function paDemoState() {
      const fx = paFixtures();
      return {
        ...paInitialState(),
        mode: 'fixture',
        demo: true,
        dataSource: 'fixture',
        session: fx.session,
        projects: fx.projects,
        libraries: fx.libraries,
        sources: fx.sources,
        sourcesTotal: fx.sources.length,
        sourcesKnown: true,
        diagnostics: fx.diagnostics,
        health: fx.health,
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
          // del proyecto activo. Un array VACÍO es un dato: cero proyectos. Nunca se hereda la lista
          // anterior (que en modo demo sería el fixture) ni se inventa a partir de ella.
          const proyectos = Array.isArray(snapshot.projects)
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
                // Documentos indexados por proyecto: campo ADITIVO. Hoy el perfil sólo publica el del
                // proyecto activo, así que aquí llega `null` y la cobertura documental dice «Sin datos»
                // en vez de suponer. Si la API lo añade, se usa sin tocar nada más.
                docs: Number.isFinite(Number(row.docs)) ? Number(row.docs) : null,
              }))
            : (prjScopes.length > 0
              ? prjScopes.map((scope) => ({
                  id: scope.id,
                  name: scope.name || scope.id,
                  current: Boolean(snapshot.project) && scope.id === snapshot.project.id,
                  rootCount: Number(scope.roots) || 0,
                }))
              // Último recurso: el proyecto activo que el snapshot sí declara. Sin él, lista vacía.
              : (snapshot.project
                ? [{
                    id: snapshot.project.id,
                    name: snapshot.project.name || snapshot.project.id,
                    current: true,
                    rootCount: Number(snapshot.project.roots) || 0,
                  }]
                : []));
          const archivados = (Array.isArray(snapshot.archived) ? snapshot.archived : []).map((row) => ({
            id: row.id,
            name: row.name || row.id,
            rootCount: Number(row.roots) || 0,
            rootsTotal: Number.isFinite(Number(row.total)) ? Number(row.total) : (Number(row.roots) || 0),
            archivedAt: row.archivedAt ?? null,
          }));
          const totalFuentes = Number(snapshot.sources && snapshot.sources.total);
          // Ausencia ≠ cero: se declara si el snapshot trae `sources` para no pintar un 0 que nadie midió.
          const fuentesDeclaradas = Array.isArray(snapshot.sources && snapshot.sources.rows);
          const libraries = (Array.isArray(snapshot.libraries) ? snapshot.libraries : []).map((lib, index) => ({
            id: lib.id || ('lib_' + index),
            name: lib.name || lib.id || '—',
            permission: lib.permission || 'read',
            grantedAt: Number(lib.grantedAt) || 0,
            grantedBy: lib.grantedBy || null,
            store: lib.store || (Number(lib.roots) > 0 ? 'present' : 'missing'),
            roots: Number(lib.roots) || 0,
          }));
          const serviceStatus = snapshot.service || 'unknown';
          // F-1 (1.5.11): «hay varios proyectos y ninguno seleccionado» es una DECISIÓN pendiente, no
          // una avería. El snapshot lo dice con `needsProjectSelection` y trae los candidatos; el
          // panel pinta el selector en vez de «sin conexión» y no elige nada por su cuenta.
          const needsProjectSelection = snapshot.needsProjectSelection === true;
          const candidates = Array.isArray(snapshot.candidates)
            ? snapshot.candidates.map((row) => ({ id: row.id, name: row.name || row.id }))
            : [];
          const selection = (state.session.session && state.session.session.selection) || {};
          return {
            ...state,
            mode: 'api',
            demo: false,
            dataSource: 'api',
            pending: null,
            apiVersion: snapshot.version || state.apiVersion || null,
            error: null,
            libraries,
            projects: proyectos,
            needsProjectSelection,
            selectionCandidates: candidates,
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
            sourcesKnown: fuentesDeclaradas,
            sourcePage: { ...(state.sourcePage || {}), offset: 0 },
            session: {
              ...state.session,
              scopeCount: scopesRaw.length,
              project: snapshot.project
                ? { ...(state.session.project || {}), id: snapshot.project.id, name: snapshot.project.name, status: 'active' }
                // Sin proyecto resoluble (perfil vacío o varios sin selección) el retrato NO declara
                // proyecto: conservar el anterior pintaría como activo uno que la API no está mirando.
                : { ...(state.session.project || {}), id: null, name: null, status: 'none' },
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
                    // Perfil sin proyecto activo: la selección se declara vacía. Conservar el nombre
                    // anterior (p. ej. el del fixture) sería pintar una procedencia que no existe.
                    : {
                      ...selection,
                      state: 'none',
                      projectId: null,
                      projectName: null,
                      source: null,
                      selectedBy: null,
                      selectedAt: null,
                      revision: 0,
                    }),
              },
            },
            diagnostics: {
              ...state.diagnostics,
              // El snapshot es la fuente: cero scopes es cero, no «los que había antes».
              scopes: scopesRaw.map((scope) => ({
                kind: scope.kind || 'prj',
                id: scope.id,
                name: scope.name || scope.id,
                store: Number(scope.roots) > 0 ? 'present' : 'missing',
                verified: true,
              })),
            },
            health: { ...state.health, status: serviceStatus },
          };
        }
        case 'unavailable':
          // El servicio no respondió: se declara el error real y NO se conservan datos de una fuente
          // anterior (menos aún del fixture) como si fueran el estado actual.
          return {
            ...state,
            mode: 'down',
            demo: false,
            dataSource: 'none',
            error: action.reason || 'unavailable',
            // F-2 (1.5.11): el fallo CIERRA la carga. Sin esto, un reintento que vuelve a fallar
            // dejaba `pending` encendido para siempre: el efecto no volvía a dispararse y el botón
            // quedaba muerto. Nunca hay dos peticiones en vuelo.
            pending: null,
            needsProjectSelection: false,
            selectionCandidates: [],
            projects: [],
            libraries: [],
            sources: [],
            sourcesTotal: 0,
            sourcesKnown: false,
            archived: [],
            roots: [],
          };
        case 'demo-on':
          // Activación EXPLÍCITA de la demostración (botón de Ajustes). Anunciada por la cabecera.
          return paDemoState();
        case 'demo-off':
          // Salir de la demostración devuelve el estado neutro y obliga a releer el registro real.
          return { ...paInitialState(), pending: 'reload' };
        case 'reset':
          // Reiniciar conserva la demostración si estaba encendida; en modo real vuelve a leer el
          // registro (sin quedarse en un neutro del que nadie sale).
          return state.demo === true
            ? paInitialState({ demo: true })
            : { ...paInitialState(), pending: 'reload' };
        case 'nav': {
          const wantsHistory = action.view === 'history' && state.mode === 'api'
            && !state.history.loaded && state.pending === null;
          // UX-2.1: el registro de workspaces del Host no emite eventos de apertura ni de cierre, así
          // que la lista se refresca AL ENTRAR en la sección (y con «Actualizar»). Se conserva lo ya
          // pintado mientras llega la respuesta; `loading` no vacía las filas.
          const wantsWorkspaces = action.view === 'workspaces' && state.mode === 'api'
            && state.pending === null;
          // UX-2.2: el seguimiento también se refresca al entrar. Si la lista del Host aún no está
          // cargada, el efecto de `tracking` la pide antes de cruzar los datos.
          const wantsTracking = action.view === 'tracking' && state.mode === 'api'
            && state.pending === null;
          // UX-2.2 · salir de la sección con una lectura en vuelo cancela el ciclo: el efecto ve
          // cambiar la dependencia, aborta la petición y cierra la carga. Sin esto queda una
          // petición huérfana que puede llegar cuando ya no hay nadie mirando.
          const leavesTracking = action.view !== 'tracking' && state.pending === 'tracking';
          return {
            ...state,
            view: action.view,
            notice: null,
            ...(wantsHistory ? { pending: 'history' } : {}),
            ...(wantsWorkspaces
              ? { pending: 'workspaces', workspaces: { ...state.workspaces, loading: true, error: null } }
              : {}),
            ...(wantsTracking
              ? { pending: 'tracking', tracking: { ...state.tracking, loading: true, error: null } }
              : {}),
            ...(leavesTracking
              ? { pending: null, tracking: { ...state.tracking, loading: false } }
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
              code: action.reason === 'revision-conflict'
                ? (action.reloaded === true ? 'notice.selectionConflict' : 'notice.selectionConflictUnreloaded')
                : (action.reloaded === true ? 'notice.selectionFailed' : 'notice.selectionFailedUnreloaded'),
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
        case 'retry-view': {
          // F-2 (1.5.11): reintentar es una PETICIÓN NUEVA. Antes sólo se incrementaba `viewEpoch`, que
          // nadie consumía: el panel se quedaba en «down» hasta recargar la aplicación entera.
          // Reglas: si ya hay una petición en vuelo no se lanza otra; el aviso viejo se limpia; el
          // trabajo entra por la misma vía que el arranque (`pending: 'reload'` → negociar + snapshot),
          // de modo que cancelaciones y respuestas obsoletas las sigue resolviendo el `alive` del efecto.
          if (state.pending !== null && state.pending !== undefined) return state;
          return { ...state, pending: 'reload', error: null, notice: null, viewEpoch: (state.viewEpoch ?? 0) + 1 };
        }
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
            // F9 · un `trackingState` que no sea exactamente uno de los tres del contrato no se
            // interpreta: se conserva como `null` («no se puede determinar»). Antes, `tracked:true`
            // con un estado no reconocido se convertía en «on», que es inventar la decisión humana.
            const trackingState = row.trackingState === 'on' || row.trackingState === 'off'
              || row.trackingState === 'paused'
              ? row.trackingState
              : null;
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
              // UX-2.2 · campos aditivos de `/pa/workspaces`. La lista blanca anterior los descartaba
              // en silencio: la vista de Seguimiento se quedaba sin estado y sin asociación. `null` se
              // conserva como «la API no lo dijo»; nunca se convierte en `off` por comodidad.
              tracked: trackingState === 'on' || trackingState === 'paused',
              trackingState,
              trackingProject: row.trackingProject && typeof row.trackingProject === 'object'
                && typeof row.trackingProject.id === 'string'
                ? { id: row.trackingProject.id, name: String(row.trackingProject.name ?? row.trackingProject.id) }
                : null,
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

        /* ------------------------------------------------- UX-2.2 · seguimiento */
        case 'tracking-refresh': {
          if (state.mode !== 'api') {
            return { ...state, notice: { code: 'notice.trackingOffline' } };
          }
          if (state.pending) return state;
          return {
            ...state,
            view: 'tracking',
            pending: 'tracking',
            notice: null,
            tracking: { ...state.tracking, loading: true, error: null },
          };
        }
        case 'tracking-ok': {
          const payload = action.payload || {};
          const raw = Array.isArray(payload.items) ? payload.items : [];
          const items = raw.map(paNormalizeTrackingRow).filter(Boolean)
            .sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)));
          return {
            ...state,
            pending: null,
            tracking: {
              loaded: true,
              loading: false,
              error: null,
              items,
              // Se conserva lo que diga el servidor sin interpretarlo; la vista calcula sus propios
              // recuentos sobre el cruce con la lista del Host.
              counts: payload.counts && typeof payload.counts === 'object' ? payload.counts : null,
              asOf: typeof payload.asOf === 'number' || typeof payload.asOf === 'string' ? payload.asOf : null,
              truncated: payload.truncated === true,
              filter: state.tracking.filter,
            },
          };
        }
        case 'tracking-cancelled':
          // UX-2.2 · un ciclo cancelado (se salió de la sección, o llegó una petición nueva) cierra
          // su carga SIN error: la vista no puede quedarse en «Leyendo el seguimiento…» ni acusar un
          // fallo que no ocurrió. Sólo cierra el `pending` si el ciclo vigente es suyo.
          return {
            ...state,
            pending: state.pending === 'tracking' ? null : state.pending,
            tracking: { ...state.tracking, loading: false, error: null },
          };
        case 'tracking-error':
          // F9 · la fila no se toca: `items` se conserva. Un fallo de relectura tras una mutación no
          // puede borrar lo que la persona ya tenía delante ni fingir que no había seguimiento.
          return {
            ...state,
            pending: null,
            notice: state.notice?.code === 'notice.trackingReloaded'
              ? { code: 'notice.trackingReloadFailed' }
              : state.notice,
            tracking: {
              ...state.tracking,
              loaded: false,
              loading: false,
              error: action.reason || 'transport-error',
            },
          };
        case 'tracking-filter':
          return {
            ...state,
            tracking: {
              ...state.tracking,
              filter: PA_TRACKING_FILTERS.indexOf(action.filter) >= 0 ? action.filter : 'all',
            },
          };
        case 'tracking-op': {
          // En modo demostración no se escribe: se dice y se queda todo como estaba.
          if (state.mode !== 'api') {
            return { ...state, notice: { code: 'notice.trackingOffline' } };
          }
          if (state.pending) return state;
          const pathKey = typeof action.pathKey === 'string' ? action.pathKey : '';
          if (!pathKey) return state;
          const row = state.tracking.items.find((item) => item.pathKey === pathKey) || null;
          // Quitar una fila que no existe no es una operación: no se inventa una petición.
          if (action.action === 'remove' && !row) return state;
          return {
            ...state,
            notice: null,
            pending: 'tracking-mutation',
            // La revisión de la fila es la del CAS. Sin fila, 0 = crear (`expectedRevision: 0`).
            trackingOp: {
              action: action.action || 'enable',
              // R1.2: el toggle puede pedir provisión. Sólo `enable` la admite; el servidor lo
              // revalida (intent=provision exige state=on) antes de escribir nada.
              intent: action.intent === 'provision' && (action.action || 'enable') === 'enable' ? 'provision' : null,
              pathKey,
              path: action.path || (row ? row.path : ''),
              state: action.action === 'remove' ? null : (action.state || 'on'),
              projectId: action.projectId !== undefined
                ? action.projectId
                : (row && row.project ? row.project.id : null),
              expectedRevision: row && Number.isFinite(row.revision) ? row.revision : 0,
            },
          };
        }
        case 'tracking-mutation-ok': {
          const op = action.op || state.trackingOp || {};
          const data = action.data || {};
          let items = state.tracking.items;
          let revision = null;
          if (op.action === 'remove') {
            items = items.filter((item) => item.pathKey !== op.pathKey);
          } else {
            const fromServer = paNormalizeTrackingRow(data.item);
            if (!fromServer) {
              // F9 · el contrato del PUT devuelve `item`; si no viene, el panel no tiene una fila que
              // pintar y NO la sintetiza ni sube la revisión (`current + 1` era inventar el CAS de la
              // siguiente operación). Se relee `GET /tracking` y se deja un aviso neutro. Si la
              // relectura falla, `tracking-error` conserva las filas y muestra el error.
              // El DELETE del contrato responde `{changed:true}` sin `item`: esa rama no pasa por aquí.
              return {
                ...state,
                notice: { code: 'notice.trackingReloaded' },
                pending: 'tracking',
                trackingOp: null,
                tracking: { ...state.tracking, loading: true, error: null },
              };
            }
            const revisionNext = Number.isFinite(data.revision)
              ? data.revision
              : fromServer.revision;
            items = [...items.filter((item) => item.pathKey !== op.pathKey), { ...fromServer, revision: revisionNext }]
              .sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)));
            revision = revisionNext;
          }
          return {
            ...state,
            pending: null,
            trackingOp: null,
            tracking: { ...state.tracking, loaded: true, loading: false, error: null, items },
            notice: op.action === 'remove'
              ? { code: 'notice.trackingRemoved' }
              : (data.memory && typeof data.memory === 'object'
                ? { code: data.memory.reused === true ? 'notice.memoryReused' : 'notice.memoryReady' }
                : { code: 'notice.trackingSaved', values: { revision: revision ?? '—' } }),
          };
        }
        case 'tracking-mutation-error': {
          const conflict = action.conflict === true
            || action.reason === 'revision-conflict' || action.reason === 'tracking-stale-revision';
          return {
            ...state,
            pending: null,
            trackingOp: null,
            tracking: { ...state.tracking, loading: false },
            notice: {
              code: conflict
                ? (action.reloaded === true ? 'notice.trackingConflict' : 'notice.trackingConflictUnreloaded')
                : (action.reloaded === true ? 'notice.trackingFailed' : 'notice.trackingFailedUnreloaded'),
              values: { reason: action.reason || 'transport-error' },
            },
          };
        }
        /* ------------------------------------------- R1.2 · acciones avanzadas */
        case 'tracking-admin-open': {
          if (state.mode !== 'api') return { ...state, notice: { code: 'notice.trackingOffline' } };
          if (state.pending) return state;
          const row = state.tracking.items.find((item) => item.pathKey === action.pathKey);
          if (!row) return state;
          return {
            ...state,
            notice: null,
            trackingAdmin: {
              action: action.action === 'move' ? 'move' : 'revoke',
              pathKey: action.pathKey,
              path: action.path || row.path,
              revision: row.revision,
              consent: row.memory?.consent ?? null,
              newPath: '',
            },
          };
        }
        case 'tracking-admin-input':
          return state.trackingAdmin
            ? { ...state, trackingAdmin: { ...state.trackingAdmin, newPath: String(action.value ?? '') } }
            : state;
        case 'tracking-admin-cancel':
          return { ...state, trackingAdmin: null };
        case 'tracking-admin-confirm': {
          if (!state.trackingAdmin) return state;
          if (state.trackingAdmin.action === 'move'
            && String(state.trackingAdmin.newPath ?? '').trim() === '') return state;
          return { ...state, pending: 'tracking-admin', notice: null };
        }
        case 'tracking-admin-ok': {
          const admin = action.admin || {};
          const data = action.data || {};
          const item = paNormalizeTrackingRow(data.item);
          let items = state.tracking.items;
          if (item && admin.action === 'move') {
            items = [...items.filter((row) => row.pathKey !== admin.pathKey), item]
              .sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)));
          } else if (item) {
            items = items.map((row) => (row.pathKey === item.pathKey ? item : row));
          }
          return {
            ...state,
            pending: null,
            trackingAdmin: null,
            tracking: { ...state.tracking, loaded: true, loading: false, error: null, items },
            notice: admin.action === 'move'
              ? (item ? { code: 'notice.trackingMoved' } : { code: 'notice.trackingMoveNoItem' })
              : (data.changed !== true
                ? (Array.isArray(data.remaining) && data.remaining.length > 0
                  ? { code: 'notice.trackingRevokeNoChangeRemaining', values: { count: data.remaining.length } }
                  : { code: 'notice.trackingRevokeNoChange' })
                : (data.complete === true
                  ? { code: 'notice.trackingRevoked' }
                  : { code: 'notice.trackingRevokedPartial', values: { count: Array.isArray(data.remaining) ? data.remaining.length : 0 } })),
          };
        }
        case 'tracking-admin-error': {
          const conflict = action.conflict === true || action.reason === 'revision-conflict';
          return {
            ...state,
            pending: null,
            trackingAdmin: null,
            tracking: { ...state.tracking, loading: false },
            notice: {
              code: conflict
                ? (action.reloaded === true ? 'notice.trackingConflict' : 'notice.trackingConflictUnreloaded')
                : (action.reloaded === true ? 'notice.trackingAdminFailed' : 'notice.trackingAdminFailedUnreloaded'),
              values: { reason: action.reason || 'transport-error' },
            },
          };
        }
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

    /**
     * UX-2.2 · tabla de la vista Seguimiento.
     *
     * No reutiliza `paTable` a propósito: `paTable` envuelve la tabla en `.lcr-pa-scroll`
     * (`overflow: auto`), y con un reparto automático de columnas la última —la de acciones— se
     * quedaba fuera del contenedor y aparecía la barra de desplazamiento horizontal. Aquí el
     * contenedor NO tiene scroll, el reparto es `table-layout: fixed` (la tabla nunca es más ancha
     * que su contenedor) y cada columna lleva su clase: la de acciones tiene ancho propio y se queda
     * dentro; la información secundaria es la que se recorta con puntos suspensivos.
     *
     * Las celdas llevan `data-label`: es el rótulo que la hoja muestra cuando la fila se apila como
     * tarjeta en los anchos compactos (`paTrackingLayout`). Los roles ARIA son explícitos para que
     * apilar la tabla no le quite la semántica.
     */
    function paTrackingTable(caption, cols, rows) {
      return el('div', { className: 'lcr-pa-track' },
        el('table', { className: 'lcr-pa-track-table', role: 'table' },
          el('caption', { className: 'lcr-pa-sr' }, caption),
          el('thead', null, el('tr', { role: 'row' }, ...cols.map((col) => el('th', {
            key: col.key,
            scope: 'col',
            role: 'columnheader',
            className: 'lcr-pa-track-head lcr-pa-track-head--' + col.key,
          }, col.label)))),
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
      const service = paServiceReading(state, t);
      const missingStores = state.diagnostics.scopes.filter((scope) => scope.store !== 'present').length;
      const missingLibraries = state.libraries.filter((library) => library.store !== 'present').length;
      // La tarjeta nombra la capa que de verdad está en juego: el almacén del proyecto cuando aún no
      // existe (estado normal de un proyecto sin documentos), o el servicio cuando eso es lo que hay.
      const serviceKpiLabel = service.store ? t('connection.store') : t('connection.service');
      const serviceKpiHint = service.store
        ? (service.store.hint || t('libraries.allPresent'))
        : (missingStores > 0
          ? t('connection.serviceDetail', { missing: missingStores, total: state.diagnostics.scopes.length })
          : t('libraries.allPresent'));
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
          paKpi(serviceKpiLabel, service.store ? service.store.label : service.label, serviceKpiHint)),
        el('div', { className: 'lcr-pa-split' },
          paCard(t('project.title'), el('div', { className: 'lcr-pa-stack' },
            paKv([
              [t('project.project'), selection.projectName || t('ux.state.none')],
              [t('project.selection'), selection.state === 'active' ? t('ux.state.active')
                : (selection.projectId ? selection.state : t('ux.state.none'))],
              [t('project.source'), selection.source === null || selection.source === undefined ? '—'
                : (selection.source === 'explicit' ? t('project.source.explicit') : t('project.source.cwd'))],
              [t('project.scopes'), String(state.session.scopeCount)],
              [service.store ? t('connection.store') : t('project.service'), service.store ? service.store.label : service.label],
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
      // Sólo la DEMOSTRACIÓN pinta el bloque sintético de integridad/versiones. Un panel neutro, sin
      // conexión o con datos reales no tiene esas cifras y no las inventa.
      if (state.mode !== 'fixture') {
        return el('div', { className: 'lcr-pa-stack' },
          paCard(t('diagnostics.scopes'), paTable(t('diagnostics.scopes'), ['kind', 'id', t('common.name'), t('common.store'), t('diagnostics.verified')], scopeRows, 'lcr-pa-tablewrap')),
          el('p', { className: 'lcr-pa-hint' }, t(state.mode === 'api' ? 'diagnostics.pendingApi' : 'diagnostics.noData')));
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
      // La procedencia la declara el ESTADO de los datos, no una variable global de negociación: un
      // panel en demo o sin conexión no puede rotularse como «API montada».
      const modeText = state.mode + (state.dataSource && state.dataSource !== state.mode ? ' · ' + state.dataSource : '');
      const serviceText = mounted ? health.status : (state.mode === 'fixture' ? t('ux.set.demoService') : health.status);
      const pairs = mounted
        ? [
            [t('connection.service'), health.status],
            [t('connection.api'), PA_API + (state.apiVersion ? ' · ' + state.apiVersion : '')],
            [t('connection.mode'), modeText],
            [t('project.project'), state.session.session.selection.projectName || t('ux.state.none')],
            [t('project.scopes'), String(state.session.scopeCount)],
          ]
        : [
            [t('connection.service'), serviceText],
            [t('connection.registry'), health.registry ?? '—'],
            [t('connection.storeRoot'), state.session.service.storeRoot ?? '—'],
            [t('connection.api'), t('connection.notMounted')],
            [t('connection.legacy'), health.legacy ? 'legacy' : 'no'],
            [t('connection.mode'), modeText],
          ];
      return el('div', { className: 'lcr-pa-stack' },
        paCard(t('connection.title'), el('div', { className: 'lcr-pa-stack' },
          el('div', { className: 'lcr-pa-toolbar' },
            el('span', { className: 'lcr-pa-toolbar__group' },
              paChip(t('status.client'), 'ok'),
              paChip(mounted ? t('status.apiOk') : t('status.api'), mounted ? 'ok' : 'warn'),
              paChip(mounted ? t('status.dataApi') : t('status.data'), mounted ? 'ok' : 'warn'),
              paChip(t('connection.service') + ': ' + serviceText, !(state.mode === 'fixture') && health.status === 'ok' ? 'ok' : 'warn'))),
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

    /**
     * Cobertura documental. Definición explícita y verificable:
     *   universo    = proyectos activos con raíz autorizada. Es el conjunto que PUEDE tener documentos
     *                 —el denominador— y mide configuración, no documentación;
     *   numerador   = proyectos de ese universo con **al menos un documento indexado**;
     *   entrada     = `docs` (documentos indexados) de cada proyecto, certificado por el snapshot.
     * Devuelve `null` —la vista pinta «Sin datos»— en tres casos y sólo en tres: no hay proyectos con
     * raíz autorizada, falta el recuento de algún proyecto (no se completa con una suposición) o no hay
     * ni un documento indexado. Con cero documentos NUNCA se devuelve 0 % ni 100 %: un porcentaje sin
     * documentos no se sostiene.
     */
    function paDocumentalCoverage(projects) {
      const withContext = (projects || [])
        .filter((p) => (p.status || 'active') === 'active' && (Number(p.rootCount) || 0) > 0);
      if (withContext.length === 0) return null;
      const counts = withContext.map((p) => (Number.isFinite(p.docs) ? Number(p.docs) : null));
      if (counts.some((count) => count === null)) return null;
      const indexed = counts.reduce((sum, count) => sum + count, 0);
      if (indexed <= 0) return null;
      const withDocs = counts.filter((count) => count > 0).length;
      return { percent: Math.round((withDocs / counts.length) * 100), withDocs, total: counts.length, indexed };
    }

    /**
     * Métricas derivadas de datos reales del snapshot. Cada cifra mide sólo lo que su tarjeta dice
     * (ver `docs/PANEL-KPIS.md`):
     * - `ready`/`configured`: proyectos activos con raíz autorizada. Mide CONFIGURACIÓN, no documentación.
     * - `docs`: documentos indexados del proyecto activo. `docsKnown` distingue cero de ausencia: un
     *   snapshot sin `sources` no certifica cero, así que no se pinta un 0 que nadie midió.
     * - `coverage`: cobertura documental explícita (ver `paDocumentalCoverage`) o `null` = sin datos.
     */
    function paOverviewMetrics(state) {
      const active = (state.projects || []).filter((p) => (p.status || 'active') === 'active');
      const archived = (state.archived || []).length;
      const total = Number(state.sourcesTotal);
      const docs = Number.isFinite(total) ? total : (state.sources || []).length;
      const docsKnown = state.sourcesKnown !== false;
      const ready = active.filter((p) => (Number(p.rootCount) || 0) > 0).length;
      const selected = paSelectionOf(state);
      const next = active.find((p) => (Number(p.rootCount) || 0) === 0)
        || (selected && active.find((p) => p.id === selected.projectId && docs === 0) ? active.find((p) => p.id === selected.projectId) : null)
        || null;
      // El snapshot certifica el recuento del proyecto activo; si la API publica `docs` por proyecto
      // (aditivo) se usa tal cual. Lo que no llega queda `null` = desconocido, nunca cero.
      const withContext = active.map((p) => ({
        ...p,
        docs: p.current && docsKnown ? docs : (Number.isFinite(p.docs) ? Number(p.docs) : null),
      }));
      return {
        active, archived, docs, docsKnown, ready, configured: ready, total: active.length,
        selected, next, withContext, coverage: paDocumentalCoverage(withContext),
      };
    }

    function paStateChip(label, tone) {
      return el('span', { className: 'lcr-pa-chip lcr-pa-chip--' + tone }, label);
    }

    /** Tarjeta de métrica. `key` la hace localizable en las pruebas; `absent` marca «Sin datos». */
    function paKpiCard(label, value, hint, key, absent) {
      return el('div', { className: 'lcr-pa-kpi' + (absent ? ' lcr-pa-kpi--nodata' : ''), ...(key ? { 'data-kpi': key } : {}) },
        el('span', { className: 'lcr-pa-kpi__label' }, label),
        el('strong', { className: 'lcr-pa-kpi__value', 'data-kpi-value': key || null }, value),
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

    /**
     * Estado de un proyecto en lenguaje de usuario, sin códigos (D-UX-13/UX-01). Mide CONFIGURACIÓN
     * y nada más: `status:'active'` + al menos una raíz autorizada (`rootCount`, que viene de
     * `projectsIndex` → `roots` autorizadas). Por eso el rótulo es «Configurado» y no «Listo»: con
     * cero documentos el proyecto sigue «Configurado», y un almacén sin crear no cambia este estado.
     */
    function paProjectState(project, t) {
      if ((project.status || 'active') === 'archived') return { label: t('ux.ws.stArchived'), tone: 'neutral' };
      if ((Number(project.rootCount) || 0) === 0) return { label: t('ux.ws.stNoPath'), tone: 'warn' };
      return { label: t('ux.ws.stReady'), tone: 'ok' };
    }

    function paViewOverview(state, t, dispatch) {
      const m = paOverviewMetrics(state);
      // Cobertura documental: sólo con documentos reales y con el recuento de todos los proyectos.
      const coverage = m.coverage;
      const coverageValue = coverage ? coverage.percent + '%' : t('ux.overview.noData');
      const coverageHint = coverage
        ? t('ux.overview.coverageHint', { withDocs: coverage.withDocs, total: coverage.total })
        : t('ux.overview.coverageNoData');
      const notice = state.notice && state.notice.kind === 'ok' ? state.notice : null;
      return el('section', { className: 'lcr-pa-stack', 'data-view': 'overview' },
        notice ? el('p', { className: 'lcr-pa-notice', role: 'status' }, notice.text) : null,
        paSectionHead(t('nav.overview'), t('ux.overview.sub')),
        el('div', { className: 'lcr-pa-kpis' },
          paKpiCard(t('ux.overview.projects'), String(m.configured),
            t('ux.overview.projectsHint', { ready: m.configured, total: m.total }), 'projects'),
          paKpiCard(t('ux.overview.sources'), m.docsKnown ? paNum(m.docs) : '—',
            m.docsKnown ? t('ux.set.docsHint') : t('ux.overview.docsUnknown'), 'documents', !m.docsKnown),
          paKpiCard(t('ux.overview.coverage'), coverageValue, coverageHint, 'coverage', !coverage)),
        el('div', { className: 'lcr-pa-grid2' },
          el('div', { className: 'lcr-pa-card' },
            el('div', { className: 'lcr-pa-card__head' },
              el('h3', { className: 'lcr-pa-card__title' }, t('ux.overview.tracking')),
              paStateChip(t('ux.overview.trackingManual'), 'ok')),
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
                      el('td', { className: 'lcr-pa-num' }, p.current && m.docsKnown ? paNum(m.docs) : '—'),
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

    /* ------------------------------------------------- UX-2.2 · seguimiento */

    /**
     * Normaliza una fila de `GET /pa/tracking`. La identidad es `pathKey` (D-UX22-07): sin ella no
     * se puede emparejar con la lista del Host y la fila se descarta. Todo lo demás se conserva o se
     * deja en `null`; nunca se rellena con un valor inventado.
     */
    /**
     * R1.2 · Estado de memoria que publica la API (Q-01). Se normaliza con lista cerrada: lo que el
     * panel no reconoce no se pinta como si fuera un estado del producto.
     */
    function paNormalizeMemory(memory) {
      if (!memory || typeof memory !== 'object') return null;
      const state = ['ready', 'provisioning', 'none', 'incomplete', 'store-missing', 'archived']
        .includes(memory.state) ? memory.state : 'unknown';
      const rawIndex = memory.index && typeof memory.index === 'object' ? memory.index : null;
      const revokeReasons = ['no-intent', 'already-revoked', 'no-provenance', 'provisioning', 'project-inactive'];
      return {
        state,
        projectId: typeof memory.projectId === 'string' ? memory.projectId : null,
        association: typeof memory.association === 'string' ? memory.association : null,
        store: memory.store === 'present' ? 'present' : 'absent',
        canRevoke: memory.canRevoke === true,
        canRevokeReason: memory.canRevoke === true
          ? null
          : (revokeReasons.includes(memory.canRevokeReason) ? memory.canRevokeReason : 'unknown'),
        cleanup: {
          pending: memory.cleanup?.pending === true,
          operationId: typeof memory.cleanup?.operationId === 'string' ? memory.cleanup.operationId : null,
          fromPath: typeof memory.cleanup?.fromPath === 'string' ? memory.cleanup.fromPath : null,
        },
        rekey: {
          pending: memory.rekey?.pending === true,
          operationId: typeof memory.rekey?.operationId === 'string' ? memory.rekey.operationId : null,
          fromPath: typeof memory.rekey?.fromPath === 'string' ? memory.rekey.fromPath : null,
          toPath: typeof memory.rekey?.toPath === 'string' ? memory.rekey.toPath : null,
        },
        consent: memory.consent && typeof memory.consent === 'object'
          ? {
            trust: typeof memory.consent.trust === 'string' ? memory.consent.trust : null,
            root: typeof memory.consent.root === 'string' ? memory.consent.root : null,
            revokedAt: memory.consent.revokedAt ?? null,
          }
          : null,
        operationId: typeof memory.operationId === 'string' ? memory.operationId : null,
        index: rawIndex
          ? {
            state: ['idle', 'queued', 'running', 'done', 'failed'].includes(rawIndex.state) ? rawIndex.state : 'idle',
            sources: Number.isFinite(rawIndex.sources) ? rawIndex.sources : 0,
            lastFinishedAt: rawIndex.lastFinishedAt ?? null,
          }
          : null,
      };
    }

    function paNormalizeTrackingRow(row) {
      if (!row || typeof row !== 'object') return null;
      const path = String(row.path ?? '');
      const pathKey = typeof row.pathKey === 'string' && row.pathKey !== ''
        ? row.pathKey
        : (path ? path.replace(/\\/g, '/').toLowerCase() : '');
      if (!pathKey) return null;
      const project = row.project && typeof row.project === 'object' && typeof row.project.id === 'string'
        ? { id: row.project.id, name: String(row.project.name ?? row.project.id) }
        : null;
      // Campo aditivo que la API puede añadir más adelante. No se deduce de otra cosa: si no viene,
      // la vista declara que no se puede determinar desde el panel.
      const sessionProject = row.sessionProject && typeof row.sessionProject === 'object'
        && typeof row.sessionProject.id === 'string'
        ? { id: row.sessionProject.id, name: String(row.sessionProject.name ?? row.sessionProject.id) }
        : null;
      return {
        pathKey,
        path,
        workspaceId: typeof row.workspaceId === 'string' ? row.workspaceId : null,
        project,
        // F9 · `state` sólo puede ser uno de los tres del contrato. Cualquier otro valor es «no se
        // puede determinar»: `null`, nunca `off` (que afirmaría una decisión humana que no consta).
        state: row.state === 'on' || row.state === 'off' || row.state === 'paused' ? row.state : null,
        association: row.association === 'explicit' || row.association === 'pending' || row.association === 'conflict'
          ? row.association
          : null,
        lastStatus: row.lastStatus === 'ok' || row.lastStatus === 'missing' || row.lastStatus === 'unknown'
          ? row.lastStatus
          : null,
        lastSeenAt: typeof row.lastSeenAt === 'number' || typeof row.lastSeenAt === 'string' ? row.lastSeenAt : null,
        updatedAt: typeof row.updatedAt === 'number' || typeof row.updatedAt === 'string' ? row.updatedAt : null,
        revision: Number.isFinite(row.revision) && row.revision >= 0 ? row.revision : 0,
        // `resolves` sólo se usa si la API manda un booleano; el panel no deduce el veredicto.
        resolves: typeof row.resolves === 'boolean' ? row.resolves : null,
        relation: typeof row.relation === 'string' ? row.relation : null,
        // R1.2 · Q-01: estado de memoria derivado en el servidor. Ausente = el perfil no lo publica.
        memory: paNormalizeMemory(row.memory),
        sessionProject,
      };
    }

    /**
     * Cruce de la lista del Host con las filas de seguimiento. La lista manda para saber QUÉ
     * workspaces existen (así «Sin seguimiento» es un hecho y no una ausencia); la fila manda para
     * el estado, la revisión y el proyecto asociado. Una fila que el Host ya no lista se conserva:
     * el seguimiento es una preferencia humana y no desaparece porque el workspace no se liste.
     */
    function paTrackingRows(state) {
      const wsItems = (state.workspaces && state.workspaces.items) || [];
      const rows = new Map(((state.tracking && state.tracking.items) || []).map((row) => [row.pathKey, row]));
      const out = [];
      const seen = new Set();
      wsItems.forEach((item) => {
        const pathKey = item.pathKey || item.path;
        if (!pathKey) return;
        seen.add(pathKey);
        const row = rows.get(pathKey) || null;
        out.push({
          pathKey,
          path: row && row.path ? row.path : item.path,
          title: item.title || item.path,
          state: row ? row.state : 'off',
          hasRow: Boolean(row),
          project: row ? row.project : (item.trackingProject || null),
          revision: row ? row.revision : 0,
          association: row ? row.association : null,
          lastStatus: row ? row.lastStatus : (item.state || null),
          resolves: row ? row.resolves : null,
          sessionProject: row ? row.sessionProject : null,
          memory: row ? row.memory : null,
        });
      });
      rows.forEach((row, pathKey) => {
        if (seen.has(pathKey)) return;
        out.push({
          pathKey,
          path: row.path,
          title: row.path || pathKey,
          state: row.state,
          hasRow: true,
          project: row.project,
          revision: row.revision,
          association: row.association,
          lastStatus: row.lastStatus,
          resolves: row.resolves,
          sessionProject: row.sessionProject,
          memory: row.memory,
        });
      });
      return out;
    }

    function paTrackingCounts(rows) {
      return {
        total: rows.length,
        followed: rows.filter((row) => row.state === 'on').length,
        paused: rows.filter((row) => row.state === 'paused').length,
        none: rows.filter((row) => row.state === 'off').length,
        withProject: rows.filter((row) => Boolean(row.project)).length,
        withoutProject: rows.filter((row) => !row.project).length,
      };
    }

    /** Predicado del filtro. «Seguidos» incluye los pausados: la fila sigue existiendo y se sigue. */
    function paTrackingFilterRow(filter) {
      if (filter === 'followed') return (row) => row.state === 'on' || row.state === 'paused';
      if (filter === 'none') return (row) => row.state === 'off';
      if (filter === 'withProject') return (row) => Boolean(row.project);
      if (filter === 'withoutProject') return (row) => !row.project;
      return () => true;
    }

    /** Etiqueta del eje A. Tres estados distintos con tres textos; `null` no elige bando. */
    function paTrackingState(row, t) {
      if (row.state === 'on') return { label: t('ux.track.stateOn'), tone: 'ok' };
      if (row.state === 'paused') return { label: t('ux.track.statePaused'), tone: 'warn' };
      if (row.state === 'off') return { label: t('ux.track.stateOff'), tone: 'neutral' };
      // F9 · sin un estado reconocido no se pinta «Seguido» ni «Sin seguimiento».
      return { label: t('ux.track.stateUnknown'), tone: 'neutral' };
    }

    /** Eje B (disponibilidad), independiente del eje A: `missing` no es `off`. */
    function paTrackingAvailability(status, t) {
      if (status === 'ok') return { label: t('ux.ws.stOk'), tone: 'ok' };
      if (status === 'missing') return { label: t('ux.ws.stMissing'), tone: 'warn' };
      if (status === 'unknown') return { label: t('ux.ws.stUnknown'), tone: 'neutral' };
      return null;
    }

    /**
     * R1.2 · Eje de memoria: se pinta **aparte** de seguimiento y disponibilidad. `ready` describe la
     * memoria (identidad + almacén + asociación), nunca la indexación; el índice tiene su propio
     * rótulo para que nadie lea «memoria lista» como «documentos indexados».
     */
    function paMemoryState(memory, t) {
      if (!memory) return null;
      if (memory.state === 'ready') return { label: t('ux.track.memoryReady'), tone: 'ok' };
      if (memory.state === 'provisioning') return { label: t('ux.track.memoryProvisioning'), tone: 'warn' };
      if (memory.state === 'store-missing') return { label: t('ux.track.memoryStoreMissing'), tone: 'bad' };
      if (memory.state === 'incomplete') return { label: t('ux.track.memoryIncomplete'), tone: 'warn' };
      if (memory.state === 'archived') return { label: t('ux.track.memoryArchived'), tone: 'neutral' };
      if (memory.state === 'none') return { label: t('ux.track.memoryNone'), tone: 'neutral' };
      return { label: t('ux.track.memoryUnknown'), tone: 'neutral' };
    }

    function paMemoryIndexLabel(memory, t) {
      if (!memory || !memory.index) return null;
      if (memory.index.state === 'queued') return t('ux.track.indexQueued');
      if (memory.index.state === 'running') return t('ux.track.indexRunning');
      if (memory.index.state === 'failed') return t('ux.track.indexFailed');
      return null;
    }

    /**
     * UX-2.2 · variante de presentación de una fila de Seguimiento según la anchura disponible:
     * `'table'` (fila con columna de acciones propia), `'compact'` (tarjeta apilada) o `'mobile'`
     * (tarjeta estrecha con acciones a ancho completo).
     *
     * Los cortes son los de `PA_TRACK_BREAKPOINTS`, que la hoja CSS interpola en sus `@media`: la
     * función y el CSS dicen lo mismo por construcción. Sin una anchura medible devuelve `'table'`
     * —el reparto de la hoja sigue mandando—; nunca inventa una medida.
     */
    function paTrackingLayout(width) {
      const value = Number(width);
      if (!Number.isFinite(value) || value <= 0) return 'table';
      if (value <= PA_TRACK_BREAKPOINTS.mobile) return 'mobile';
      if (value <= PA_TRACK_BREAKPOINTS.compact) return 'compact';
      return 'table';
    }

    /**
     * Traduce una operación humana de seguimiento a la petición del contrato. PUT lleva el cuerpo
     * con CAS (`expectedRevision`); DELETE lleva `pathKey` y `expectedRevision` en la query y las
     * cabeceras de mutación explícitas, porque no tiene cuerpo.
     *
     * La lectura (`action: 'load'`, sin operación) tiene también su forma aquí: una sola ruta y un
     * solo presupuesto, para que el efecto de carga no invente su propia petición.
     */
    function paTrackingRequest(op) {
      if (!op || op.action === 'load') {
        return { path: '/tracking', options: { method: 'GET', timeoutMs: TRACKING_TIMEOUT_MS } };
      }
      const expected = Number.isFinite(op.expectedRevision) ? op.expectedRevision : 0;
      if (op.action === 'remove') {
        return {
          path: '/tracking?pathKey=' + encodeURIComponent(op.pathKey) + '&expectedRevision=' + expected,
          options: { method: 'DELETE', mutation: true },
        };
      }
      const body = { pathKey: op.pathKey, state: op.state, expectedRevision: expected };
      // La ruta literal la conoce el panel (viene de `/workspaces`): se envía para que la fila guarde la
      // ruta tal cual la ve la persona y no la clave canónica en minúsculas.
      if (op.path) body.path = op.path;
      if (op.projectId) body.projectId = op.projectId;
      // R1.2 · `pa/1.6.0`: el toggle que prepara memoria lo declara; sin él, el servidor conserva el
      // comportamiento de 1.5.0.
      if (op.intent === 'provision') body.intent = 'provision';
      return { path: '/tracking', options: { method: 'PUT', body } };
    }

    /**
     * UX-2.2 · Seguimiento por workspace.
     *
     * Tres conceptos que NO pueden confundirse y se pintan distinto: el seguimiento (`workspace_tracking`),
     * la selección de perfil (`pa_selection`, «Seleccionado para administrar») y el proyecto resuelto por
     * una sesión de IA (si la API no lo dice, se declara que no se puede saber desde el panel). Ningún
     * control de esta vista autoriza lectura, no toca raíces y no amplía permisos.
     */
    function paViewTracking(state, t, dispatch) {
      const tr = state.tracking || { loaded: false, loading: false, items: [], error: null, filter: 'all' };
      const ws = state.workspaces || { loaded: false, source: null, items: [] };
      // El contrato pa/1.6 añade `intent` y las rutas move/revoke. Un panel nuevo contra un 1.5
      // conocido no debe enviar campos ni rutas que ese servidor rechaza; la ausencia de versión se
      // trata como el contrato actual para no degradar un host que aún no la publica.
      const supportsLifecycle = !state.apiVersion || /^pa\/1\.6(?:\.|$)/.test(String(state.apiVersion));
      const head = paSectionHead(t('ux.track.title'), t('ux.track.sub'));
      // Texto obligatorio (§8 de la especificación): visible en todos los estados de la vista.
      const policy = el('p', { className: 'lcr-pa-hint lcr-pa-policy', 'data-tracking-policy': '1' },
        t('ux.track.notAuthorized'));
      const notice = state.notice
        ? el('p', { className: 'lcr-pa-notice', role: 'status', 'data-tracking-notice': state.notice.code },
          t(state.notice.code, state.notice.values))
        : null;
      // R1.2 · confirmación de una acción avanzada. No se ejecuta en el primer clic: mover y revocar
      // son actos humanos con consecuencia y se confirman con el alcance delante.
      const admin = state.trackingAdmin || null;
      const adminPanel = admin
        ? paCard(
          t(admin.action === 'move' ? 'ux.track.move' : 'ux.track.revoke'),
          el('div', { className: 'lcr-pa-stack', 'data-tracking-admin': admin.action },
            el('p', { className: 'lcr-pa-hint' },
              t(admin.action === 'move' ? 'ux.track.moveScope' : 'ux.track.revokeScope')),
            admin.action === 'move'
              ? el('label', { className: 'lcr-pa-field' },
                el('span', null, t('ux.track.moveNewPath')),
                el('input', {
                  type: 'text',
                  className: 'lcr-input lcr-mono',
                  value: admin.newPath,
                  placeholder: 'C:\\\\ruta\\\\nueva',
                  'data-tracking-move-input': '1',
                  onChange: (event) => dispatch({ type: 'tracking-admin-input', value: event.target.value }),
                }))
              : null,
            admin.action === 'revoke'
              ? el('p', { className: 'lcr-pa-hint lcr-pa-mono', 'data-tracking-admin-entries': '1' },
                t('ux.track.revokeEntries', {
                  items: [
                    admin.consent?.trust ? `${t('ux.track.revokeTrust')}: ${admin.consent.trust}` : null,
                    admin.consent?.root ? `${t('ux.track.revokeRoot')}: ${admin.consent.root}` : null,
                  ].filter(Boolean).join(' · ') || t('ux.track.revokeNoEntries'),
                }))
              : null,
            el('div', { className: 'lcr-pa-toolbar' },
              el('button', {
                type: 'button',
                className: 'lcr-pa-btn',
                'data-tracking-admin-confirm': '1',
                disabled: admin.action === 'move' && String(admin.newPath ?? '').trim() === '',
                onClick: () => dispatch({ type: 'tracking-admin-confirm' }),
              }, t(admin.action === 'move' ? 'ux.track.moveConfirm' : 'ux.track.revokeConfirm')),
              el('button', {
                type: 'button',
                className: 'lcr-pa-btn lcr-pa-btn--ghost',
                'data-tracking-admin-cancel': '1',
                onClick: () => dispatch({ type: 'tracking-admin-cancel' }),
              }, t('ux.track.adminCancel')))))
        : null;
      const selection = paSelectionOf(state);
      // `pa_selection` no participa en la resolución de contexto (D-UX22-05): se muestra aparte,
      // con su propio nombre, para que no se lea como si fuera seguimiento. El nombre viene de la
      // selección de la sesión; si no lo trae, `paSelectionOf` ya resolvió id/nombre del proyecto.
      const selectionName = selection
        ? (state.session.session.selection.projectName || selection.name)
        : null;
      const selectionChip = selection
        ? paChip(t('ux.track.selection') + ': ' + selectionName, 'lib')
        : null;

      if (state.mode !== 'api') {
        return el('section', { className: 'lcr-pa-stack', 'data-view': 'tracking', 'data-tracking-state': 'offline' },
          head,
          policy,
          paCard(t('ux.track.title'), el('div', { className: 'lcr-pa-stack' },
            paEmptyState(t('ux.track.offline'), t('ux.track.offlineHint'), null))));
      }

      // F9 · si la relectura falla después de una mutación, las filas ya cargadas se conservan: se
      // avisa del error sin borrar la tabla. Sin filas previas, el error ocupa la vista (sin cambios).
      const hasRows = Array.isArray(tr.items) && tr.items.length > 0;
      if (tr.error && !hasRows) {
        return el('section', { className: 'lcr-pa-stack', 'data-view': 'tracking', 'data-tracking-state': 'error' },
          head,
          policy,
          paCard(t('ux.track.title'), el('div', { className: 'lcr-pa-stack' },
            el('div', { className: 'lcr-pa-error', role: 'alert', 'data-tracking-error': tr.error },
              el('p', { className: 'lcr-pa-error__title' }, t('ux.track.err')),
              el('p', { className: 'lcr-pa-hint lcr-pa-mono' }, t('ux.track.errCode') + ': ' + String(tr.error)),
              el('button', { type: 'button', className: 'lcr-pa-btn', onClick: () => dispatch({ type: 'tracking-refresh' }) }, t('ux.track.retry'))))));
      }

      if (tr.loading && !tr.loaded && !hasRows) {
        return el('section', { className: 'lcr-pa-stack', 'data-view': 'tracking', 'data-tracking-state': 'loading' },
          head,
          policy,
          paCard(t('ux.track.title'), el('p', { className: 'lcr-pa-hint', role: 'status' }, t('ux.track.loading'))));
      }

      if (!tr.loaded && !hasRows) {
        return el('section', { className: 'lcr-pa-stack', 'data-view': 'tracking', 'data-tracking-state': 'idle' },
          head,
          policy,
          paCard(t('ux.track.title'), el('div', { className: 'lcr-pa-stack' },
            el('button', { type: 'button', className: 'lcr-pa-btn', onClick: () => dispatch({ type: 'tracking-refresh' }) },
              t('ux.track.idle')))));
      }

      const allRows = paTrackingRows(state);
      const counts = paTrackingCounts(allRows);
      const filter = PA_TRACKING_FILTERS.indexOf(tr.filter) >= 0 ? tr.filter : 'all';
      const visible = allRows.filter(paTrackingFilterRow(filter));

      const filterBar = el('div', { className: 'lcr-pa-filters', role: 'group', 'aria-label': t('ux.track.filters') },
        PA_TRACKING_FILTERS.map((id) => el('button', {
          key: id,
          type: 'button',
          className: 'lcr-pa-filter' + (filter === id ? ' lcr-pa-filter--active' : ''),
          'data-tracking-filter': id,
          'aria-pressed': filter === id ? 'true' : 'false',
          onClick: () => dispatch({ type: 'tracking-filter', filter: id }),
        }, t(PA_TRACKING_FILTER_KEYS[id]))));

      const toolbar = el('div', { className: 'lcr-pa-toolbar' },
        el('span', { className: 'lcr-pa-toolbar__group' },
          selectionChip,
          paChip(t('ux.track.countTotal', { total: paNum(counts.total) }), 'lib'),
          paChip(t('ux.track.countFollowed', { count: paNum(counts.followed) }), 'ok'),
          paChip(t('ux.track.countPaused', { count: paNum(counts.paused) }), 'warn'),
          paChip(t('ux.track.countNone', { count: paNum(counts.none) }), 'neutral')),
        el('span', { className: 'lcr-pa-toolbar__group' },
          el('button', {
            type: 'button',
            className: 'lcr-pa-btn',
            disabled: Boolean(tr.loading),
            'data-tracking-refresh': '1',
            onClick: () => dispatch({ type: 'tracking-refresh' }),
          }, tr.loading ? t('ux.track.loading') : t('ux.ws.refresh'))));

      const rows = visible.map((row) => {
        // F9 · `null` es «el servidor no dijo un estado válido». No se elige bando ni se muestra la
        // acción de «Dejar de seguir» (que presupondría que seguía): el control queda deshabilitado y
        // la fila se puede quitar o releer con «Actualizar».
        const known = row.state === 'on' || row.state === 'off' || row.state === 'paused';
        const st = paTrackingState(row, t);
        const av = paTrackingAvailability(row.lastStatus, t);
        const checked = row.state === 'on';
        const memory = row.memory || null;
        const memState = paMemoryState(memory, t);
        const memIndex = paMemoryIndexLabel(memory, t);
        // Activar un workspace sin memoria lista pide provisión; reactivar uno con memoria lista no
        // (el servidor encola la sincronización incremental por su cuenta). Un proyecto archivado
        // no se reprovisiona: el contrato dice «sin provisión» y el servidor lo rechazaría.
        const needsProvision = memory ? (memory.state !== 'ready' && memory.state !== 'archived') : true;
        // El interruptor mueve el eje A entre seguido y pausado; dejar de seguir es una acción
        // aparte y explícita, para que apagar el control no borre una decisión sin querer.
        const toggleAction = checked ? 'pause' : (row.state === 'paused' ? 'resume' : 'enable');
        const toggleLabel = !known
          ? t('ux.track.stateUnknown')
          : (checked ? t('ux.track.pause') : (row.state === 'paused' ? t('ux.track.resume') : t('ux.track.enable')));
        const base = { pathKey: row.pathKey, path: row.path, projectId: row.project ? row.project.id : null };
        const selected = selection && row.project && row.project.id === selection.projectId;
        // Rótulos de columna: en la fila de tabla los pone el `th`; cuando la fila se apila como
        // tarjeta, la hoja los muestra desde `data-label` para que ningún valor quede sin nombre.
        const label = {
          ws: t('ux.track.col.workspace'),
          state: t('ux.track.col.state'),
          project: t('ux.track.col.project'),
          session: t('ux.track.col.session'),
          actions: t('ux.track.col.actions'),
        };
        return el('tr', {
          key: row.pathKey,
          role: 'row',
          'data-tracking-path': row.pathKey,
          'data-tracking-state': known ? row.state : 'unknown',
        },
          // El nombre se recorta con puntos suspensivos; el texto íntegro queda en `title`.
          el('td', { className: 'lcr-pa-track-cell lcr-pa-track-cell--ws', role: 'cell', 'data-label': label.ws },
            el('strong', { className: 'lcr-pa-track-name', title: row.title }, row.title),
            el('div', { className: 'lcr-pa-track-path' }, el(PaPath, { path: row.path, t, onCopy: state.copyText }))),
          el('td', { className: 'lcr-pa-track-cell lcr-pa-track-cell--state', role: 'cell', 'data-label': label.state },
            paStateChip(st.label, st.tone),
            // R1.2 · eje de memoria, separado del seguimiento y de la disponibilidad.
            memState
              ? el('div', { className: 'lcr-pa-track-note lcr-pa-track-memory', 'data-tracking-memory': memory.state },
                paStateChip(memState.label, memState.tone))
              : null,
            memIndex
              ? el('div', { className: 'lcr-pa-track-note', 'data-tracking-index': memory.index.state },
                t('ux.track.index') + ': ' + memIndex)
              : null,
            memory?.cleanup?.pending
              ? el('div', { className: 'lcr-pa-track-note', 'data-tracking-cleanup': 'pending' },
                t('ux.track.cleanupPending'))
              : null,
            memory?.rekey?.pending
              ? el('div', { className: 'lcr-pa-track-note', 'data-tracking-rekey': 'pending' },
                t('ux.track.rekeyPending'))
              : null,
            av ? el('div', { className: 'lcr-pa-track-note' }, t('ux.track.availability') + ': ' + av.label) : null,
            row.state === 'on' && !row.project
              ? el('div', { className: 'lcr-pa-track-note', 'data-tracking-no-project': '1' }, t('ux.track.onNoProject'))
              : null),
          el('td', { className: 'lcr-pa-track-cell lcr-pa-track-cell--project', role: 'cell', 'data-label': label.project },
            row.project
              ? el('div', null, row.project.name)
              : el('span', { className: 'lcr-pa-muted' }, t('ux.track.noProject')),
            selected ? el('div', null, paChip(t('ux.track.selection'), 'lib')) : null),
          el('td', { className: 'lcr-pa-track-cell lcr-pa-track-cell--session', role: 'cell', 'data-label': label.session },
            row.sessionProject
              ? el('div', null, row.sessionProject.name)
              : el('span', { className: 'lcr-pa-muted', 'data-tracking-session': 'unknown' }, t('ux.track.sessionUnknown'))),
          // Columna de acciones: contenedor propio, fuera de cualquier zona con scroll. En la fila de
          // tabla los botones conservan su texto completo y se apilan si no caben en una línea; en la
          // tarjeta compacta ocupan el ancho de la columna, uno debajo de otro.
          el('td', { className: 'lcr-pa-track-cell lcr-pa-track-cell--actions', role: 'cell', 'data-label': label.actions },
            el('div', { className: 'lcr-pa-track-actions' },
              el('div', { className: 'lcr-pa-toggle lcr-pa-toggle--inline' },
                el('span', { className: 'lcr-pa-toggle__label' }, toggleLabel),
                el('button', {
                  type: 'button',
                  role: 'switch',
                  className: 'lcr-pa-toggle__switch' + (checked ? ' lcr-pa-toggle__switch--on' : ''),
                  'aria-checked': known ? (checked ? 'true' : 'false') : 'mixed',
                  'aria-disabled': known ? 'false' : 'true',
                  disabled: !known,
                  'aria-label': t('ux.track.toggle') + ': ' + row.title,
                  'data-tracking-toggle': row.pathKey,
                  onClick: known
                    ? () => dispatch({
                      type: 'tracking-op',
                      action: toggleAction,
                      state: checked ? 'paused' : 'on',
                      intent: (toggleAction === 'enable' || toggleAction === 'resume') && needsProvision && supportsLifecycle ? 'provision' : null,
                      ...base,
                    })
                    : undefined,
                })),
              row.hasRow && known
                ? el('button', {
                  type: 'button',
                  className: 'lcr-pa-btn lcr-pa-btn--ghost',
                  'data-tracking-op': 'disable',
                  onClick: () => dispatch({ type: 'tracking-op', action: 'disable', state: 'off', ...base }),
                }, t('ux.track.disable'))
                : null,
              row.hasRow
                ? el('button', {
                  type: 'button',
                  className: 'lcr-pa-btn lcr-pa-btn--ghost',
                  'data-tracking-op': 'remove',
                  onClick: () => dispatch({ type: 'tracking-op', action: 'remove', ...base }),
                }, t('ux.track.remove'))
                : null,
              // R1.2 · acciones avanzadas: revocar el acceso que creó LifeCode RAG y mover la carpeta
              // conservando la memoria. Revocar exige prueba de propiedad: sin ella el control queda
              // deshabilitado y se explica por qué.
              row.hasRow && row.project && supportsLifecycle
                ? el('details', { className: 'lcr-pa-advanced' },
                  el('summary', null, t('ux.track.advanced')),
                  el('div', { className: 'lcr-pa-advanced__body' },
                    el('button', {
                      type: 'button',
                      className: 'lcr-pa-btn lcr-pa-btn--ghost',
                      'data-tracking-revoke': row.pathKey,
                      disabled: !(memory && memory.canRevoke),
                      title: memory && memory.canRevoke ? t('ux.track.revoke')
                        : t(!memory ? 'ux.track.revokeUnknown'
                          : memory.canRevokeReason === 'already-revoked' ? 'ux.track.revokeAlready'
                            : memory.canRevokeReason === 'provisioning' ? 'ux.track.revokeProvisioning'
                              : memory.canRevokeReason === 'project-inactive' ? 'ux.track.revokeInactive'
                                : memory.canRevokeReason === 'unknown' ? 'ux.track.revokeUnknown'
                                  : 'ux.track.revokeUnproven'),
                      onClick: memory && memory.canRevoke
                        ? () => dispatch({
                          type: 'tracking-admin-open', action: 'revoke',
                          pathKey: row.pathKey, path: row.path, revision: row.revision,
                        })
                        : undefined,
                    }, t('ux.track.revoke')),
                    !memory || !memory.canRevoke
                      ? el('p', { className: 'lcr-pa-hint', 'data-tracking-revoke-unproven': '1' },
                        t(!memory ? 'ux.track.revokeUnknown'
                          : memory.canRevokeReason === 'already-revoked' ? 'ux.track.revokeAlready'
                            : memory.canRevokeReason === 'provisioning' ? 'ux.track.revokeProvisioning'
                              : memory.canRevokeReason === 'project-inactive' ? 'ux.track.revokeInactive'
                                : memory.canRevokeReason === 'unknown' ? 'ux.track.revokeUnknown'
                                  : 'ux.track.revokeUnproven'))
                      : null,
                    el('button', {
                      type: 'button',
                      className: 'lcr-pa-btn lcr-pa-btn--ghost',
                      'data-tracking-move': row.pathKey,
                      onClick: () => dispatch({
                        type: 'tracking-admin-open', action: 'move',
                        pathKey: row.pathKey, path: row.path, revision: row.revision,
                      }),
                    }, t('ux.track.move'))))
                : null,
              el('span', { className: 'lcr-pa-muted' }, t('ux.track.revision', { revision: paNum(row.revision) })))));
      });

      const list = allRows.length === 0
        ? paEmptyState(
          ws.loaded && ws.source === 'none' ? t('ux.ws.noRegistry') : t('ux.track.empty'),
          ws.loaded && ws.source === 'none' ? t('ux.ws.noRegistryHint') : t('ux.track.emptyHint'),
          null)
        : (visible.length === 0
          ? paEmptyState(t('ux.track.noRows'), t('ux.track.noRowsHint'), null)
          : paTrackingTable(t('ux.track.tableCaption'), [
            { key: 'ws', label: t('ux.track.col.workspace') },
            { key: 'state', label: t('ux.track.col.state') },
            { key: 'project', label: t('ux.track.col.project') },
            { key: 'session', label: t('ux.track.col.session') },
            { key: 'actions', label: t('ux.track.col.actions') },
          ], rows));

      return el('section', { className: 'lcr-pa-stack', 'data-view': 'tracking', 'data-tracking-state': 'list' },
        head,
        notice,
        adminPanel,
        // F9 · la relectura falló pero había filas: se avisa sin tocarlas.
        tr.error
          ? el('div', { className: 'lcr-pa-error', role: 'alert', 'data-tracking-error': tr.error },
            el('p', { className: 'lcr-pa-error__title' }, t('ux.track.err')),
            el('p', { className: 'lcr-pa-hint lcr-pa-mono' }, t('ux.track.errCode') + ': ' + String(tr.error)),
            el('button', { type: 'button', className: 'lcr-pa-btn', onClick: () => dispatch({ type: 'tracking-refresh' }) }, t('ux.track.retry')))
          : null,
        policy,
        paCard(t('ux.track.title'), el('div', { className: 'lcr-pa-stack' },
          toolbar,
          filterBar,
          tr.loading ? el('p', { className: 'lcr-pa-hint', role: 'status' }, t('ux.track.loading')) : null,
          list)));
    }

    function paViewSettings(state, t, dispatch) {
      const mounted = state.mode === 'api';
      const demo = state.mode === 'fixture';
      const service = state.session && state.session.service ? state.session.service.status : 'unknown';
      const modeLabel = mounted ? t('ux.set.apiMode') : (demo ? t('ux.set.synthetic')
        : (state.mode === 'down' ? t('ux.set.offline') : t('ux.set.connecting')));
      const overview = paOverviewMetrics(state);
      const kpis = [
        [t('ux.set.service'), demo ? t('ux.set.demoService') : String(service), !demo && service === 'ok' ? 'ok' : 'warn'],
        [t('ux.set.api'), mounted ? (state.apiVersion || 'pa/1.x') : '—', mounted ? 'ok' : 'warn'],
        [t('ux.set.mode'), modeLabel, mounted ? 'ok' : 'warn'],
        [t('ux.set.source'), mounted ? t('ux.set.sourceApi') : (demo ? t('ux.set.sourceFixture') : '—'), mounted ? 'ok' : 'warn'],
        [t('ux.set.docs'), overview.docsKnown ? paNum(overview.docs) : '—', 'neutral'],
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
        // La demostración es un modo EXPLÍCITO: se enciende y se apaga desde aquí, y la cabecera lo
        // anuncia mientras esté activa. Nunca se activa sola por un fallo del servicio.
        paCard(t('ux.set.demoTitle'),
          el('div', { className: 'lcr-pa-stack' },
            el('p', { className: 'lcr-pa-hint' }, t('ux.set.demoHint')),
            demo
              ? el('button', {
                type: 'button',
                className: 'lcr-pa-btn',
                'data-demo': 'off',
                onClick: () => dispatch({ type: 'demo-off' }),
              }, t('ux.set.demoOff'))
              : el('button', {
                type: 'button',
                className: 'lcr-pa-btn',
                'data-demo': 'on',
                onClick: () => dispatch({ type: 'demo-on' }),
              }, t('ux.set.demoOn')))),
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
                // F-2: mientras el reintento está en vuelo, el botón se apaga y lo dice. No hay dos
                // peticiones a la vez.
                disabled: state.pending === 'reload',
                'data-retry-view': '1',
                onClick: () => dispatch({ type: 'retry-view' }),
              }, state.pending === 'reload' ? t('view.retrying') : t('view.retry'))))));
    }

    /**
     * F-1 (1.5.11): el perfil tiene varios proyectos activos y ninguna selección explícita. No es un
     * fallo —la API contestó 200 con `needsProjectSelection: true`— sino una decisión que sólo puede
     * tomar la persona: aquí se ofrece el selector y NO se elige nada por su cuenta. El botón dispara
     * la misma ruta de siempre (`select-project` → `POST /selection` con CAS), así que la selección
     * sigue pasando por la compuerta del host y por las revisiones del registro.
     */
    function paViewSelection(state, t, dispatch) {
      const rows = (Array.isArray(state.selectionCandidates) && state.selectionCandidates.length > 0)
        ? state.selectionCandidates
        : (state.projects || []).filter((row) => (row.status || 'active') !== 'archived');
      const busy = state.pending === 'selection';
      const item = (row) => el('li', { key: row.id },
        el('span', { className: 'lcr-pa-name' }, row.name || row.id),
        el('button', {
          type: 'button',
          className: 'lcr-pa-btn lcr-pa-btn--primary',
          'data-select-project': row.id,
          disabled: busy,
          'aria-label': t('view.selectAria', { name: row.name || row.id }),
          onClick: () => dispatch({ type: 'select-project', projectId: row.id }),
        }, busy ? t('view.selecting') : t('project.select')));
      const notice = state.notice && state.notice.code && /selection/i.test(state.notice.code)
        ? el('p', { className: 'lcr-pa-hint', 'data-selection-notice': state.notice.code },
          t(state.notice.code, state.notice.values))
        : null;
      return el('section', { className: 'lcr-pa-card', 'data-view': 'selection', 'data-needs-project-selection': '1' },
        el('div', { className: 'lcr-pa-card__head' },
          el('h2', { className: 'lcr-pa-card__title' }, t('view.selectTitle'))),
        el('div', { className: 'lcr-pa-card__body' },
          el('p', { className: 'lcr-pa-hint', 'data-selection-count': String(rows.length) },
            t('view.selectHint', { count: rows.length })),
          el('ul', { className: 'lcr-pa-links lcr-pa-links--select' }, rows.map(item)),
          notice));
    }

    function paRenderViewSafe(state, t, dispatch, render) {
      const draw = typeof render === 'function' ? render : paRenderView;
      // F-1: antes que «sin conexión». La API está sana; lo que falta es elegir proyecto.
      if (state.mode === 'api' && state.needsProjectSelection === true) return paViewSelection(state, t, dispatch);
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
                  disabled: state.pending === 'reload',
                  'data-retry-view': '1',
                  onClick: () => dispatch({ type: 'retry-view' }),
                }, state.pending === 'reload' ? t('view.retrying') : t('view.retry'))))));
      }
    }

    /**
     * Lectura de la cabecera en las TRES capas que el snapshot mezcla en un solo campo `service`
     * (definición de referencia: docs/PANEL-KPIS.md §«Estados»):
     *
     *  1. **Conectividad con la API** — `state.mode === 'api'`: el retrato respondió 200 con sobre
     *     `{ok:true,data}`. El campo `service` NO la mide: `service:'degraded'` también llega por 200.
     *  2. **Registro del perfil** — el mismo hecho: el retrato salió del registro. Si el registro no
     *     abriera, `lib/pa-api.mjs` responde `503 registry-unavailable` y `negotiateMode` deja el
     *     panel en `mode:'down'`; aquí no se pinta un rótulo verde.
     *  3. **Almacén del proyecto** — es lo ÚNICO que hoy significa `service:'degraded'`:
     *     `lib/pa-api.mjs` lo emite con `service: store ? 'ok' : 'degraded'` cuando el proyecto existe
     *     en el registro con raíz autorizada y su almacén de ámbito aún no se creó (nace con la
     *     primera ingesta). No es una avería: se rotula en su propia píldora, sin el código crudo.
     *
     * El valor interno `service` no se toca; sólo se presenta por capas.
     */
    function paServiceReading(state, t) {
      const status = String((state.session && state.session.service && state.session.service.status) || 'unknown');
      const mounted = state.mode === 'api';
      const demo = state.mode === 'fixture';
      const hasProject = Boolean(state.session && state.session.session && state.session.session.selection.projectId);
      if (!mounted) {
        // Sin API no se certifica ninguna capa: ni servicio, ni registro, ni almacén.
        return {
          label: demo ? t('ux.set.demoService') : (state.mode === 'down' ? t('ux.set.offline') : t('ux.set.connecting')),
          tone: 'warn',
          store: null,
        };
      }
      // Conectado y registro leído: `ok` y `degraded` son ambos «la API contestó y el registro abrió».
      const label = status === 'ok' || status === 'degraded' ? 'ok' : status;
      const tone = status === 'ok' || status === 'degraded' ? 'ok' : 'warn';
      if (!hasProject) return { label, tone, store: null };
      if (status === 'degraded') {
        return {
          label,
          tone,
          store: { label: t('ux.state.storePending'), tone: 'muted', hint: t('ux.state.storePendingHint') },
        };
      }
      if (status === 'ok') return { label, tone, store: { label: 'ok', tone: 'ok', hint: null } };
      return { label, tone, store: { label: status, tone: 'warn', hint: null } };
    }

    function paStatusPill(label, tone, hint) {
      return el('span', { className: 'lcr-pa-status__item', ...(hint ? { title: hint } : {}) },
        el('span', { className: 'lcr-pa-dot lcr-pa-dot--' + tone, 'aria-hidden': 'true' }),
        label);
    }

    function PaPanel(props) {
      // La demostración sólo se pinta si venía pedida EXPLÍCITAMENTE (prop del host o interruptor
      // ya activado); en cualquier otro caso el panel arranca neutro y negocia.
      const demoAtMount = useRef(Boolean(props && props.demo) || panelState.demo === true);
      const [state, setState] = useState(() => (demoAtMount.current ? paDemoState() : paInitialState()));
      const t = props && typeof props.t === 'function' ? props.t : (key, vars) => paTranslate('es', key, vars);
      const dispatch = (action) => setState((previous) => paReduce(previous, action));
      // LE-RAG-10: el componente REAL del slot negocia antes de pintar datos. Si el servidor no
      // confirma 'api', el estado pasa a 'down' con su razón (nunca lista vacía silenciosa ni
      // sustitución por fixtures). En demostración explícita no se toca la red.
      useEffect(() => {
        if (demoAtMount.current) return undefined;
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
        // UX-2.2: el ciclo de seguimiento cancela su petición al desmontarse o al cambiar la
        // dependencia (salir de la sección). La cancelación cierra la carga sin error.
        let abort = null;
        (async () => {
          try {
            if (job === 'reload') {
              // Salir de la demostración: se vuelve a negociar y se pide el registro real.
              await negotiateMode();
              if (panelState.mode !== 'api') {
                if (alive) dispatch({ type: 'unavailable', reason: panelState.reason });
                return;
              }
              const snapshot = await request('/snapshot');
              if (alive) dispatch({ type: 'hydrate', snapshot });
              return;
            }
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
            if (job === 'tracking') {
              // UX-2.2: la vista cruza dos fuentes — la lista del Host (para saber qué workspaces
              // existen) y las filas de seguimiento. La lista sólo se pide si aún no está cargada;
              // un fallo de la lista no impide pintar las filas de seguimiento que sí llegaron.
              //
              // El ciclo tiene identidad propia (`trackingLoadGen`) y su propio AbortController: así
              // una respuesta o una cancelación de un ciclo anterior no pinta ni cierra el vigente.
              const generation = ++trackingLoadGen;
              const built = paTrackingRequest({ action: 'load' });
              const controller = new AbortController();
              abort = () => controller.abort();
              const stale = () => generation !== trackingLoadGen;
              const hostList = state.workspaces.loaded
                ? Promise.resolve(null)
                : request('/workspaces').then(
                  (payload) => ({ payload }),
                  (failure) => ({ failure }),
                );
              let payload = null;
              let reason = null;
              try {
                payload = await request(built.path, { ...built.options, signal: controller.signal });
              } catch (failure) {
                reason = (failure && failure.code) || 'network';
              }
              if (reason === null) {
                // La lista del Host se despacha ANTES que las filas para que la tabla nazca cruzada.
                // Su `pending: null` marca este efecto como dependencia cambiada, pero el cierre del
                // ciclo ya está hecho: no puede descartar la respuesta que ya tenemos en la mano.
                const list = await hostList;
                if (stale()) return;
                if (list && list.payload) dispatch({ type: 'workspaces-ok', payload: list.payload });
                else if (list && list.failure) {
                  dispatch({ type: 'workspaces-error', reason: (list.failure.code) || 'network' });
                }
              }
              if (stale()) return;
              // Cancelación y respuesta obsoleta cierran la carga sin error: no son fallos del
              // servidor y la vista no puede acusarlos. Cualquier otro motivo sí es un error real.
              if (reason === 'cancelled' || reason === 'stale-response') {
                dispatch({ type: 'tracking-cancelled' });
              } else if (reason) {
                dispatch({ type: 'tracking-error', reason });
              } else {
                dispatch({ type: 'tracking-ok', payload });
              }
              return;
            }
            if (job === 'tracking-mutation') {
              const op = state.trackingOp;
              if (!op) return;
              const built = paTrackingRequest(op);
              try {
                const data = await request(built.path, built.options);
                if (alive) dispatch({ type: 'tracking-mutation-ok', op, data });
              } catch (failure) {
                const reason = (failure && failure.code) || 'transport-error';
                const conflict = reason === 'revision-conflict' || reason === 'tracking-stale-revision';
                // Cualquier fallo puede haber dejado una escritura parcial (por ejemplo, la fila se
                // creó y la provisión falló). Se relee SIEMPRE el estado real antes de avisar; el
                // aviso no puede decir «no se cambió nada» sobre un estado que no se ha mirado.
                let reloaded = false;
                try {
                  const payload = await request('/tracking');
                  if (alive) dispatch({ type: 'tracking-ok', payload });
                  reloaded = true;
                } catch { /* el aviso de error ya explica lo ocurrido */ }
                if (alive) dispatch({ type: 'tracking-mutation-error', op, reason, conflict, reloaded });
              }
              return;
            }
            if (job === 'tracking-admin') {
              // R1.2 · acciones avanzadas: POST /tracking/move o /tracking/revoke. Llevan la revisión
              // de la fila (CAS de la vista) y pasan por la compuerta del host en el servidor.
              const admin = state.trackingAdmin;
              if (!admin) return;
              const route = admin.action === 'move' ? '/tracking/move' : '/tracking/revoke';
              const body = admin.action === 'move'
                ? {
                  pathKey: admin.pathKey,
                  newPath: String(admin.newPath ?? '').trim(),
                  expectedRevision: admin.revision,
                }
                : { pathKey: admin.pathKey, expectedRevision: admin.revision };
              try {
                const data = await request(route, { method: 'POST', body, mutation: true });
                if (alive) dispatch({ type: 'tracking-admin-ok', admin, data });
              } catch (failure) {
                const reason = (failure && failure.code) || 'transport-error';
                const conflict = reason === 'revision-conflict';
                // También aquí se relee siempre: un movimiento puede haber completado el rebind y
                // fallar después; el panel no puede afirmar «no se cambió nada» sin mirar.
                let reloaded = false;
                try {
                  const payload = await request('/tracking');
                  if (alive) dispatch({ type: 'tracking-ok', payload });
                  reloaded = true;
                } catch { /* el aviso de error ya explica lo ocurrido */ }
                if (alive) dispatch({ type: 'tracking-admin-error', reason, conflict, reloaded });
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
                // Cualquier fallo puede haber dejado la selección escrita; se relee el estado real
                // antes de avisar. Sólo un 409 de revisión es «otro panel» (misma regla que L5).
                let reloaded = false;
                try {
                  const snapshot = await request('/snapshot');
                  if (alive) dispatch({ type: 'hydrate', snapshot });
                  reloaded = true;
                } catch { /* el aviso de error ya explica lo ocurrido */ }
                if (alive) dispatch({ type: 'selection-error', reason, reloaded });
              }
            }
          } catch (failure) {
            if (alive) dispatch({ type: job + '-error', reason: (failure && failure.code) || 'transport-error' });
          }
        })();
        return () => { alive = false; if (abort) abort(); };
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
      const mounted = state.mode === 'api';
      const demo = state.mode === 'fixture';
      // El modo se etiqueta por el ESTADO de los datos, no por lo que diga el servicio del snapshot:
      // en demostración el indicador nunca puede decir 'ok'.
      const modeLabel = mounted ? t('ux.set.apiMode')
        : (demo ? t('ux.set.synthetic')
          : (state.mode === 'down' ? t('ux.set.offline') : t('ux.set.connecting')));
      // El estado se presenta por CAPAS (conectividad · registro · almacén del proyecto): el campo
      // `service` mezcla las tres y `degraded` sólo habla del almacén, no de una avería.
      const service = paServiceReading(state, t);
      return el('div', { className: 'lcr-pa-root', 'data-data-mode': state.mode, 'data-data-source': state.dataSource },
        demo ? el('div', { className: 'lcr-pa-banner', role: 'status', 'aria-atomic': 'true', 'aria-label': t('a11y.banner') },
          el('strong', null, SYNTHETIC_BANNER),
          el('span', { className: 'lcr-pa-banner__hint' }, t('banner.hint'))) : null,
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
              paStatusPill(t('connection.service') + ': ' + service.label, service.tone),
              service.store ? paStatusPill(t('connection.store') + ': ' + service.store.label, service.store.tone, service.store.hint) : null,
              paStatusPill(modeLabel, mounted ? 'ok' : 'warn'))),
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
      /* Estado normal pero no «verde»: el almacén del proyecto aún no existe (no es una avería). */
      .lcr-pa-dot--muted { background: var(--pa-muted); }
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
      .lcr-pa-kpi--nodata .lcr-pa-kpi__value { font-size: 16px; color: var(--pa-muted); }
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
      /* F-3 (1.5.11): área de interacción. Medido en el Host a 1280×800, el enlace-acción de la tabla
         («Abrir») salía 26×18 px: se podía pulsar, pero por debajo del objetivo de 24×24 de WCAG 2.5.8
         y muy lejos de lo cómodo en táctil. Se aumenta el ÁREA (no el texto) con caja propia, sin
         partir la etiqueta, y el foco visible ya lo cubre la regla de :focus-visible de arriba. */
      .lcr-pa-link { appearance: none; border: 0; background: none; color: var(--pa-accent); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px;
        display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
        min-height: 36px; min-width: 36px; padding: 8px 10px; white-space: nowrap; border-radius: 7px; }
      .lcr-pa-link:hover { background: color-mix(in oklab, var(--pa-accent) 10%, transparent); }
      .lcr-pa-links--select li { align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--pa-border-2); }
      .lcr-pa-links--select li:last-child { border-bottom: 0; }
      .lcr-pa-name { font-weight: 600; color: var(--pa-text); }
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
      .lcr-pa-kpi--nodata .lcr-pa-kpi__value { font-size: var(--pa-fs-4); color: var(--pa-muted); }
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
      .lcr-pa-toggle--inline { padding: 0; gap: 8px; justify-content: flex-start; }
      .lcr-pa-toggle__label { font-size: var(--pa-fs-3); font-weight: 600; }
      .lcr-pa-toggle__switch { appearance: none; width: 40px; height: 22px; border-radius: 999px; border: 1px solid var(--pa-border-2); background: var(--pa-surface-2); position: relative; cursor: not-allowed; opacity: 0.55; }
      .lcr-pa-toggle__switch:not([disabled]) { cursor: pointer; opacity: 1; }
      .lcr-pa-toggle__switch--on { background: color-mix(in oklab, var(--pa-accent) 55%, var(--pa-surface-2)); border-color: var(--pa-accent); }
      .lcr-pa-toggle__switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--pa-muted); transition: left 120ms ease; }
      .lcr-pa-toggle__switch--on::after { left: 20px; background: #fff; }
      .lcr-pa-filters { display: flex; flex-wrap: wrap; gap: 6px; }
      .lcr-pa-filter { appearance: none; border: 1px solid var(--pa-border-2); background: var(--pa-surface); color: var(--pa-text); border-radius: 999px; padding: 3px 10px; font-size: 11.5px; cursor: pointer; }
      .lcr-pa-filter--active { border-color: var(--pa-accent); color: var(--pa-accent); background: color-mix(in oklab, var(--pa-accent) 10%, transparent); font-weight: 600; }
      /* ─── UX-2.2 · tabla de Seguimiento: la columna de acciones manda ──────────────────────────
         Defecto medido en el Host (captura 1668×817): la tabla vivía en .lcr-pa-scroll
         (overflow: auto) con reparto AUTOMÁTICO de columnas. El nombre y la ruta del workspace se
         llevaban el ancho, la columna de estado se estrujaba y la de acciones —la última— quedaba
         fuera del contenedor: barra de desplazamiento horizontal y los botones cortados por el borde
         («Pausar (», «Dejar de», «Quitar fi»). Aquí el contenedor NO tiene scroll, el reparto es fijo
         (table-layout: fixed ⇒ la tabla nunca es más ancha que su contenedor) y la columna de
         acciones tiene ancho propio y mínimo. Lo único que se recorta es la información secundaria
         (nombre y ruta), con puntos suspensivos y el texto íntegro en el atributo title. */
      .lcr-pa-track { min-width: 0; }
      .lcr-pa-track-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; table-layout: fixed; }
      .lcr-pa-track-table th { text-align: left; font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--pa-muted); padding: 8px 10px; border-bottom: 1px solid var(--pa-border); background: var(--pa-surface); white-space: normal; line-height: 1.3; }
      .lcr-pa-track-table td { padding: 8px 10px; border-bottom: 1px solid var(--pa-border-2); vertical-align: top; }
      .lcr-pa-track-table tbody tr:hover td { background: color-mix(in oklab, var(--pa-surface-2) 45%, transparent); }
      .lcr-pa-track-table tbody tr:last-child td { border-bottom: 0; }
      /* Anchos por columna, con la de acciones PRIMERO en prioridad: en table-layout: fixed una
         anchura en píxeles no se encoge —cuando falta espacio se encogen las demás columnas, que
         recortan su texto con puntos suspensivos—. Medido en Edge/Chromium: 232px fijos dejan 210px
         útiles, donde «Dejar de seguir» (106px) y «Quitar fila» (78px) se apilan completos. El resto
         va en porcentaje, así que la suma nunca supera el 100% y la tabla JAMÁS es más ancha que su
         contenedor (no hay nada que desplazar en horizontal). */
      .lcr-pa-track-head--state { width: 17%; }
      .lcr-pa-track-head--project { width: 12%; }
      .lcr-pa-track-head--session { width: 13%; }
      .lcr-pa-track-head--actions { width: 232px; }
      /* El texto de estado se parte por palabras, nunca por caracteres. */
      .lcr-pa-track-cell { min-width: 0; white-space: normal; overflow-wrap: break-word; word-break: normal; }
      .lcr-pa-track-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lcr-pa-track-path { min-width: 0; margin-top: 2px; }
      .lcr-pa-track-path .lcr-pa-path { display: flex; flex-wrap: wrap; max-width: 100%; }
      .lcr-pa-track-path .lcr-pa-path__value { flex: 1 1 auto; max-width: 100%; }
      .lcr-pa-track-note { margin: 4px 0 0; color: var(--pa-muted); font-size: 11.5px; white-space: normal; overflow-wrap: break-word; word-break: normal; }
      /* La columna de acciones no se encoge y sus controles tampoco: se apilan, no se recortan. */
      .lcr-pa-track-actions { display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
      .lcr-pa-track-actions > * { flex: 0 0 auto; }
      .lcr-pa-track-actions .lcr-pa-toggle--inline { flex-wrap: wrap; }
      .lcr-pa-track-actions .lcr-pa-muted { white-space: normal; }
      /* R1.2: acciones avanzadas dentro de la columna de acciones. Se apilan y no recortan el texto. */
      .lcr-pa-advanced { flex: 1 0 100%; min-width: 0; }
      .lcr-pa-advanced > summary { cursor: pointer; font-size: 11px; color: var(--pa-muted); padding: 2px 0; }
      .lcr-pa-advanced__body { display: flex; flex-direction: column; gap: 6px; padding: 4px 0 0 10px; border-left: 2px solid var(--pa-border); margin-top: 4px; }
      .lcr-pa-advanced__body .lcr-pa-btn { width: 100%; text-align: center; }
      .lcr-pa-track-memory { margin-top: 4px; }
      /* Los cortes son los de PA_TRACK_BREAKPOINTS: los mismos números que decide paTrackingLayout,
         interpolados aquí para que la hoja y la función no puedan separarse. */
      @media (max-width: ${PA_TRACK_BREAKPOINTS.compact}px) {
        /* Fila → tarjeta apilada: workspace y estado arriba, acciones debajo y siempre visibles. */
        .lcr-pa-track-table, .lcr-pa-track-table thead, .lcr-pa-track-table tbody,
        .lcr-pa-track-table tr, .lcr-pa-track-table td { display: block; width: auto; }
        .lcr-pa-track-table { table-layout: auto; }
        .lcr-pa-track-table thead { display: none; }
        .lcr-pa-track-table tbody tr { margin: 0 0 10px; padding: 10px 12px; border: 1px solid var(--pa-border); border-radius: var(--pa-radius); background: color-mix(in oklab, var(--pa-surface-2) 28%, transparent); }
        .lcr-pa-track-table tbody tr:last-child { margin-bottom: 0; }
        .lcr-pa-track-table td { padding: 0 0 8px; border-bottom: 0; }
        .lcr-pa-track-table td::before { content: attr(data-label); display: block; margin-bottom: 2px; font-size: 10px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; color: var(--pa-muted); }
        .lcr-pa-track-table td:last-child { padding-bottom: 0; }
        .lcr-pa-track-name { white-space: normal; overflow: visible; text-overflow: clip; }
        .lcr-pa-track-cell--actions { padding-top: 8px; border-top: 1px solid var(--pa-border-2); }
        .lcr-pa-track-actions { flex-direction: column; align-items: stretch; gap: 6px; }
        .lcr-pa-track-actions > * { flex: 0 0 auto; }
        .lcr-pa-track-actions .lcr-pa-btn { width: 100%; text-align: center; }
        .lcr-pa-track-actions .lcr-pa-toggle--inline { justify-content: space-between; }
        .lcr-pa-track-actions .lcr-pa-muted { align-self: flex-start; }
        .lcr-pa-track-note { max-width: 60ch; }
      }
      @media (max-width: ${PA_TRACK_BREAKPOINTS.mobile}px) {
        .lcr-pa-track-table tbody tr { padding: 10px; }
        .lcr-pa-track-name { font-size: 13px; }
        .lcr-pa-track-note { max-width: none; }
      }
      .lcr-pa-policy { border-left: 2px solid var(--pa-warn); padding-left: 8px; }
      .lcr-pa-row--wrap { flex-wrap: wrap; }
      .lcr-pa-links { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: var(--pa-fs-2); }
      .lcr-pa-links li { display: flex; align-items: baseline; gap: 4px; flex-wrap: wrap; }
      .lcr-pa-chip--neutral { border-color: var(--pa-border-2); color: var(--pa-muted); background: color-mix(in oklab, var(--pa-surface-2) 50%, transparent); }
      @media (max-width: 1100px) {
        /* Una sola columna: el nav y el contenido quedan en DOS filas implícitas del mismo grid.
           Sin align-content, el reparto por defecto (stretch) estira esas filas cuando el
           contenido no llena el alto del panel: medido en el Host a 768×1024 y 834×1024, la fila
           del nav pasaba de 51 px a 141 px y dejaba una banda vacía de 90 px entre las pestañas y
           «Resumen». align-content: start deja cada fila con su alto real. */
        .lcr-pa-layout { grid-template-columns: 1fr; align-content: start; }
        .lcr-pa-nav { position: static; flex-direction: row; overflow-x: auto; scrollbar-width: thin; }
        .lcr-pa-nav__item { width: auto; white-space: nowrap; }
        .lcr-pa-grid2 { grid-template-columns: 1fr; }
      }
      .lcr-pa-banner + .lcr-pa-head { margin-top: 2px; }
      @media (max-width: 760px) {
        .lcr-pa-root { padding: 14px 12px 24px; }
        /* F-3: en móvil el objetivo táctil sube a 44×44 (el mínimo cómodo con el dedo). */
        .lcr-pa-link { min-height: 44px; min-width: 44px; padding: 10px 12px; }
        /* F-3: el área táctil ensancha la columna de acciones; para que la tabla de actividad siga
           entrando a 390 px se recorta el relleno horizontal de las celdas (8 celdas × 4 px = 32 px),
           no el área del botón. Medido: 346 → 331 de ancho de contenido. */
        .lcr-pa-table th, .lcr-pa-table td { padding-left: 6px; padding-right: 6px; }
        .lcr-pa-links--select li { flex-wrap: wrap; }
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
        paDocumentalCoverage,
        paProjectState,
        paServiceReading,
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
        paViewTracking,
        paNormalizeTrackingRow,
        paTrackingRows,
        paTrackingCounts,
        paTrackingState,
        paTrackingLayout,
        PA_TRACK_BREAKPOINTS,
        paTrackingRequest,
        PA_TRACKING_FILTERS,
        paAdminError,
        paReadLanguage,
        paChunks,
        paBuildSources,
        requestLegacy: request,
      },
    };
  },
});
