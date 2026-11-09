/* LifeCode Skill Center — panel del cliente.
 *
 * Reglas que este fichero respeta (las mismas que el resto de la casa):
 *  - Nada de paquetes del cliente del harness: React llega por `require('react')` del cargador y el
 *    resto es DOM propio con prefijo `lsc-`. Un `require` de un paquete del harness que no resuelva
 *    revienta el slot entero y deja la interfaz en blanco.
 *  - La fábrica no tiene efectos: estilos, locale y slots se registran dentro de `apply`, con su
 *    limpieza devuelta desde `ctx.effect`.
 *  - Todo el estado vive en el Host. Este panel es una vista: lee `GET /lifecode-skill-center/api/state`
 *    y escribe con `POST` a la misma ruta. No guarda nada en el navegador que no sea de presentación.
 *  - Aquí no se decide nada de negocio: aprobar y activar es de la persona; el Host ya rechaza a un
 *    actor `ai` que lo intente, y este panel muestra ese rechazo tal cual.
 */
window.__ModuleLoader__.load({
  id: '@local/lifecode-skill-center',
  factory(require) {
    const React = require('react');
    const e = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const PACKAGE = '@local/lifecode-skill-center';
    const NS = 'lifecode-skill-center';
    const PANEL_ID = 'lifecode-skill-center';
    const API = '/lifecode-skill-center/api';
    const MAIN_SLOT = 'main';
    const SIDEBAR_SLOT = 'sidebar.panellist';
    const STYLE_ID = 'lsc-styles';

    /* ------------------------------------------------------------------ textos */

    const DICTIONARIES = {
      es: {
        'app.title': 'LifeCode Skill Center',
        'app.subtitle': 'Biblioteca, activación y mejora de Skills por proyecto',
        'app.loading': 'Leyendo la biblioteca…',
        'app.retry': 'Reintentar',
        'app.refresh': 'Recargar',
        'app.new': 'Nueva skill',
        'app.project': 'Proyecto',
        'app.current': 'actual',
        'app.unregistered': 'sin registrar',
        'app.stored': 'Almacén',
        'app.empty': 'Todavía no hay nada aquí.',

        'nav.overview': 'Resumen',
        'nav.library': 'Biblioteca',
        'nav.projects': 'Proyectos',
        'nav.improvements': 'Mejoras',
        'nav.analytics': 'Analítica',
        'nav.settings': 'Diagnóstico',

        'kpi.skills': 'Skills',
        'kpi.published': 'Publicadas',
        'kpi.assignments': 'Activaciones',
        'kpi.projects': 'Proyectos',
        'kpi.pending': 'Propuestas',
        'kpi.quality': 'Calidad media',
        'kpi.versions': 'Versiones',
        'kpi.loads': 'Cargas',
        'kpi.of': 'de',

        'pipeline.title': 'Ciclo de la skill',
        'pipeline.library': 'Biblioteca',
        'pipeline.evaluated': 'Evaluadas',
        'pipeline.assigned': 'Activadas',
        'pipeline.loaded': 'Cargadas',
        'pipeline.improved': 'Mejoradas',
        'pipeline.hint': 'Una carga es que el catálogo la ofreció al modelo, no que la aplicara.',

        'activity.title': 'Actividad de los últimos 14 días',
        'activity.legend.created': 'Creadas',
        'activity.legend.assigned': 'Activaciones',
        'activity.legend.versions': 'Versiones',
        'activity.legend.loads': 'Cargas',
        'activity.empty': 'Sin actividad todavía.',

        'review.title': 'Cola de revisión',
        'review.hint': 'La IA propone; publicar y activar lo decide una persona.',
        'review.empty': 'No hay propuestas esperando.',
        'review.approve': 'Aprobar',
        'review.reject': 'Rechazar',
        'review.open': 'Ver detalle',
        'review.stale': 'La skill cambió desde que se propuso.',

        'external.title': 'Skills que ya existen fuera',
        'external.hint': 'Detectadas en la biblioteca del harness, en el compilador anterior o en la carpeta del proyecto.',
        'external.empty': 'Ninguna skill parecida fuera de este centro.',
        'external.import': 'Traer',
        'external.imported': 'Ya está en la biblioteca',
        'external.count': '{n} detectadas',
        'external.truncated': 'Se listan las primeras {n}.',
        'external.error': 'No se pudieron leer todas las carpetas: {n} errores.',
        'external.source': 'Origen',
        'external.shared': 'Coincide por: {why}',

        'library.title': 'Biblioteca',
        'library.search': 'Buscar por nombre, descripción o etiqueta…',
        'library.filter.all': 'Todas',
        'library.filter.published': 'Publicadas',
        'library.filter.deprecated': 'Retiradas',
        'library.count': '{n} skills',
        'library.countOne': '1 skill',
        'library.empty': 'La biblioteca está vacía. Crea la primera skill o trae una detectada.',
        'library.col.name': 'Skill',
        'library.col.version': 'Versión',
        'library.col.quality': 'Calidad',
        'library.col.projects': 'Proyectos',
        'library.col.updated': 'Actualizada',
        'library.origin.ai': 'IA',
        'library.origin.human': 'Humana',
        'library.origin.import': 'Importada',
        'library.origin.fork': 'Derivada',
        'library.detect': 'Buscar fuera',
        'library.detect.hint': 'Pega una descripción y te digo qué existe ya, dentro y fuera.',
        'library.detect.placeholder': 'p. ej. desplegar un plugin en un perfil de desarrollo',
        'library.detect.none': 'Nada parecido. Es una skill nueva.',
        'library.detect.library': 'Ya en la biblioteca',
        'library.detect.external': 'Fuera, sin importar',
        'library.detect.score': 'parecido {n}%',

        'projects.title': 'Proyectos',
        'projects.hint': 'Activar aquí una skill no la toca en los demás proyectos, y desactivarla no la borra.',
        'projects.empty': 'Ningún proyecto registrado. El proyecto actual del harness aparece aquí al abrir el panel.',
        'projects.add': 'Registrar proyecto',
        'projects.add.placeholder': 'C:\\ruta\\del\\proyecto',
        'projects.add.confirm': 'Registrar',
        'projects.active': '{n} activas',
        'projects.skills': 'Skills de este proyecto',
        'projects.none': 'Sin skills activas.',
        'projects.sync': 'Sincronizar disco',
        'projects.sync.done': '{n} ficheros escritos',
        'projects.sync.error': 'No se pudo sincronizar: {message}',
        'projects.this': 'Estás aquí',
        'projects.open': 'Trabajar en este proyecto',
        'projects.manifest': 'Materializado en {path}',
        'projects.version': 'Versión',

        'improvements.title': 'Mejoras',
        'improvements.hint': 'Una mejora siempre es una versión nueva con diferencia y vuelta atrás; el original no se toca.',
        'improvements.empty': 'No hay mejoras registradas.',
        'improvements.base': 'sobre {version}',
        'improvements.diff': '+{added} −{removed}',
        'improvements.diff.truncated': 'Diferencia recortada.',
        'improvements.approve': 'Aprobar y publicar',
        'improvements.reject': 'Rechazar',
        'improvements.approved': 'Aprobada',
        'improvements.rejected': 'Rechazada',
        'improvements.proposed': 'Propuesta',
        'improvements.rationale': 'Por qué',
        'improvements.result': 'Queda en {version}',

        'analytics.title': 'Analítica',
        'analytics.top': 'Skills más activas',
        'analytics.top.hint': '{n} proyectos la tienen activada',
        'analytics.top.empty': 'Sin activaciones todavía.',
        'analytics.quality': 'Distribución de calidad',
        'analytics.quality.pass': 'Correctas',
        'analytics.quality.warn': 'Con avisos',
        'analytics.quality.fail': 'No publicables',
        'analytics.quality.none': 'Sin medir',
        'analytics.diag': 'Diagnóstico del almacén',
        'analytics.diag.store': 'Centro',
        'analytics.diag.materialized': 'Vista materializada',
        'analytics.diag.exists': 'Existe',
        'analytics.diag.missing': 'Aún no existe',
        'analytics.diag.version': 'API',
        'analytics.diag.error': 'Último error del almacén: {message}',

        'drawer.close': 'Cerrar',
        'drawer.description': 'Para qué sirve',
        'drawer.when': 'Cuándo usarla',
        'drawer.body': 'Contenido de la versión {version}',
        'drawer.references': 'Referencias',
        'drawer.versions': 'Versiones',
        'drawer.use': 'Usar aquí',
        'drawer.projects': 'Proyectos',
        'drawer.evaluate': 'Reevaluar',
        'drawer.tags': 'Etiquetas',
        'drawer.origin': 'Origen',
        'drawer.created': 'Creada',
        'drawer.updated': 'Actualizada',
        'drawer.status.published': 'Publicada',
        'drawer.status.deprecated': 'Retirada',
        'drawer.check': 'Comprobación',
        'drawer.no.assignments': 'Todavía no está activada en ningún proyecto.',
        'drawer.fork': 'Derivar',
        'drawer.improve': 'Proponer mejora',

        'modal.title': 'Nueva skill',
        'modal.hint': 'Se publica en la biblioteca y no queda activa en ningún proyecto: eso lo decides después con los interruptores.',
        'modal.id': 'Identificador (opcional)',
        'modal.id.placeholder': 'se-deriva-del-título',
        'modal.name': 'Título',
        'modal.description': 'Descripción (una línea, 60–300 caracteres)',
        'modal.when': 'Cuándo usarla (20–200 caracteres)',
        'modal.body': 'Contenido (≥200 caracteres, con al menos dos secciones «## »)',
        'modal.tags': 'Etiquetas separadas por comas',
        'modal.create': 'Crear y evaluar',
        'modal.cancel': 'Cancelar',
        'modal.required': 'Faltan campos obligatorios.',
        'modal.creating': 'Creando…',

        'quality.pass': 'Correcta',
        'quality.warn': 'Con avisos',
        'quality.fail': 'No publicable',
        'quality.unmeasured': 'Sin medir',
        'quality.score': '{n}/100',

        'toast.created': 'Skill creada y evaluada.',
        'toast.imported': 'Skill importada a la biblioteca.',
        'toast.approved': 'Mejora aprobada y publicada.',
        'toast.rejected': 'Propuesta rechazada.',
        'toast.toggled.on': 'Activada solo en este proyecto.',
        'toast.toggled.off': 'Desactivada en este proyecto; sigue en los demás.',
        'toast.evaluated': 'Evaluación actualizada.',
        'toast.published': 'Versión publicada.',
        'toast.forked': 'Skill derivada.',
        'toast.project': 'Proyecto registrado.',
        'toast.version': 'Versión del proyecto actualizada.',
        'toast.blocked': 'No se puede desde la IA: {message}',
        'toast.failed': 'No se pudo completar: {message}',
        'auth.missing': 'Esta ventana no trae la credencial del Host. Recarga la página desde DeepSeek Harness; si sigue igual, reabre la aplicación.',
        'auth.forbidden': 'El Host no confía en esta petición: ábrela desde la ventana de DeepSeek Harness.',
        'auth.unavailable': 'Este harness no ofrece el servicio de conexión, así que el panel no puede autenticarse. Sin él no se lee ni se escribe nada.',

        'common.version': 'Versión',
        'common.projects': 'Proyectos',
        'common.close': 'Cerrar',
        'common.cancel': 'Cancelar',
        'common.none': '—',
        'common.by.human': 'persona',
        'common.by.ai': 'IA',
      },
      en: {
        'app.title': 'LifeCode Skill Center',
        'app.subtitle': 'Skill library, activation and improvement per project',
        'app.loading': 'Reading the library…',
        'app.retry': 'Retry',
        'app.refresh': 'Reload',
        'app.new': 'New skill',
        'app.project': 'Project',
        'app.current': 'current',
        'app.unregistered': 'not registered',
        'app.stored': 'Store',
        'app.empty': 'Nothing here yet.',

        'nav.overview': 'Overview',
        'nav.library': 'Library',
        'nav.projects': 'Projects',
        'nav.improvements': 'Improvements',
        'nav.analytics': 'Analytics',
        'nav.settings': 'Diagnostics',

        'kpi.skills': 'Skills',
        'kpi.published': 'Published',
        'kpi.assignments': 'Activations',
        'kpi.projects': 'Projects',
        'kpi.pending': 'Proposals',
        'kpi.quality': 'Average quality',
        'kpi.versions': 'Versions',
        'kpi.loads': 'Loads',
        'kpi.of': 'of',

        'pipeline.title': 'Skill lifecycle',
        'pipeline.library': 'Library',
        'pipeline.evaluated': 'Evaluated',
        'pipeline.assigned': 'Activated',
        'pipeline.loaded': 'Loaded',
        'pipeline.improved': 'Improved',
        'pipeline.hint': 'A load means the catalog offered it to the model, not that it applied it.',

        'activity.title': 'Activity, last 14 days',
        'activity.legend.created': 'Created',
        'activity.legend.assigned': 'Activations',
        'activity.legend.versions': 'Versions',
        'activity.legend.loads': 'Loads',
        'activity.empty': 'No activity yet.',

        'review.title': 'Review queue',
        'review.hint': 'The AI proposes; publishing and activating is a human decision.',
        'review.empty': 'Nothing waiting for you.',
        'review.approve': 'Approve',
        'review.reject': 'Reject',
        'review.open': 'Open',
        'review.stale': 'The skill changed since this was proposed.',

        'external.title': 'Skills that already exist outside',
        'external.hint': 'Found in the harness library, the previous compiler or the project folder.',
        'external.empty': 'No similar skill outside this center.',
        'external.import': 'Bring in',
        'external.imported': 'Already in the library',
        'external.count': '{n} found',
        'external.truncated': 'Showing the first {n}.',
        'external.error': 'Some folders could not be read: {n} errors.',
        'external.source': 'Source',
        'external.shared': 'Matches on: {why}',

        'library.title': 'Library',
        'library.search': 'Search by name, description or tag…',
        'library.filter.all': 'All',
        'library.filter.published': 'Published',
        'library.filter.deprecated': 'Deprecated',
        'library.count': '{n} skills',
        'library.countOne': '1 skill',
        'library.empty': 'The library is empty. Create the first skill or bring in a detected one.',
        'library.col.name': 'Skill',
        'library.col.version': 'Version',
        'library.col.quality': 'Quality',
        'library.col.projects': 'Projects',
        'library.col.updated': 'Updated',
        'library.origin.ai': 'AI',
        'library.origin.human': 'Human',
        'library.origin.import': 'Imported',
        'library.origin.fork': 'Forked',
        'library.detect': 'Search outside',
        'library.detect.hint': 'Paste a description and I will tell you what already exists, inside and outside.',
        'library.detect.placeholder': 'e.g. deploy a plugin into a development profile',
        'library.detect.none': 'Nothing similar. This is a new skill.',
        'library.detect.library': 'Already in the library',
        'library.detect.external': 'Outside, not imported',
        'library.detect.score': '{n}% match',

        'projects.title': 'Projects',
        'projects.hint': 'Turning a skill on here does not touch other projects, and turning it off does not delete it.',
        'projects.empty': 'No project registered yet. The harness current project shows up here when the panel opens.',
        'projects.add': 'Register project',
        'projects.add.placeholder': 'C:\\path\\to\\project',
        'projects.add.confirm': 'Register',
        'projects.active': '{n} active',
        'projects.skills': 'Skills in this project',
        'projects.none': 'No active skills.',
        'projects.sync': 'Sync to disk',
        'projects.sync.done': '{n} files written',
        'projects.sync.error': 'Could not sync: {message}',
        'projects.this': 'You are here',
        'projects.open': 'Work on this project',
        'projects.manifest': 'Materialized at {path}',
        'projects.version': 'Version',

        'improvements.title': 'Improvements',
        'improvements.hint': 'An improvement is always a new version with a diff and a way back; the original is left alone.',
        'improvements.empty': 'No improvements recorded.',
        'improvements.base': 'on {version}',
        'improvements.diff': '+{added} −{removed}',
        'improvements.diff.truncated': 'Diff truncated.',
        'improvements.approve': 'Approve and publish',
        'improvements.reject': 'Reject',
        'improvements.approved': 'Approved',
        'improvements.rejected': 'Rejected',
        'improvements.proposed': 'Proposed',
        'improvements.rationale': 'Why',
        'improvements.result': 'Becomes {version}',

        'analytics.title': 'Analytics',
        'analytics.top': 'Busiest skills',
        'analytics.top.hint': '{n} projects have it active',
        'analytics.top.empty': 'No activations yet.',
        'analytics.quality': 'Quality distribution',
        'analytics.quality.pass': 'Passing',
        'analytics.quality.warn': 'With warnings',
        'analytics.quality.fail': 'Not publishable',
        'analytics.quality.none': 'Unmeasured',
        'analytics.diag': 'Store diagnostics',
        'analytics.diag.store': 'Center',
        'analytics.diag.materialized': 'Materialized view',
        'analytics.diag.exists': 'Exists',
        'analytics.diag.missing': 'Not created yet',
        'analytics.diag.version': 'API',
        'analytics.diag.error': 'Last store error: {message}',

        'drawer.close': 'Close',
        'drawer.description': 'What it is for',
        'drawer.when': 'When to use it',
        'drawer.body': 'Content of version {version}',
        'drawer.references': 'References',
        'drawer.versions': 'Versions',
        'drawer.use': 'Use here',
        'drawer.projects': 'Projects',
        'drawer.evaluate': 'Re-evaluate',
        'drawer.tags': 'Tags',
        'drawer.origin': 'Origin',
        'drawer.created': 'Created',
        'drawer.updated': 'Updated',
        'drawer.status.published': 'Published',
        'drawer.status.deprecated': 'Deprecated',
        'drawer.check': 'Check',
        'drawer.no.assignments': 'Not active in any project yet.',
        'drawer.fork': 'Fork',
        'drawer.improve': 'Propose improvement',

        'modal.title': 'New skill',
        'modal.hint': 'It is published in the library and active nowhere: you decide that later with the switches.',
        'modal.id': 'Identifier (optional)',
        'modal.id.placeholder': 'derived-from-title',
        'modal.name': 'Title',
        'modal.description': 'Description (one line, 60–300 characters)',
        'modal.when': 'When to use it (20–200 characters)',
        'modal.body': 'Content (≥200 characters, at least two «## » sections)',
        'modal.tags': 'Comma-separated tags',
        'modal.create': 'Create and evaluate',
        'modal.cancel': 'Cancel',
        'modal.required': 'Required fields are missing.',
        'modal.creating': 'Creating…',

        'quality.pass': 'Passing',
        'quality.warn': 'With warnings',
        'quality.fail': 'Not publishable',
        'quality.unmeasured': 'Unmeasured',
        'quality.score': '{n}/100',

        'toast.created': 'Skill created and evaluated.',
        'toast.imported': 'Skill imported into the library.',
        'toast.approved': 'Improvement approved and published.',
        'toast.rejected': 'Proposal rejected.',
        'toast.toggled.on': 'Active in this project only.',
        'toast.toggled.off': 'Off in this project; still on in the others.',
        'toast.evaluated': 'Evaluation updated.',
        'toast.published': 'Version published.',
        'toast.forked': 'Skill forked.',
        'toast.project': 'Project registered.',
        'toast.version': 'Project version updated.',
        'toast.blocked': 'The AI cannot do this: {message}',
        'toast.failed': 'Could not complete: {message}',
        'auth.missing': 'This window has no Host credential. Reload the page from DeepSeek Harness; if it stays the same, reopen the app.',
        'auth.forbidden': 'The Host does not trust this request: open it from the DeepSeek Harness window.',
        'auth.unavailable': 'This harness does not offer the connection service, so the panel cannot authenticate. Without it nothing is read or written.',

        'common.version': 'Version',
        'common.projects': 'Projects',
        'common.close': 'Close',
        'common.cancel': 'Cancel',
        'common.none': '—',
        'common.by.human': 'person',
        'common.by.ai': 'AI',
      },
    };

    function normalizeLang(value) {
      return String(value ?? '').toLowerCase().startsWith('en') ? 'en' : 'es';
    }

    function translate(lang, key, vars) {
      const table = DICTIONARIES[lang] ?? DICTIONARIES.es;
      const text = table[key] ?? DICTIONARIES.es[key] ?? key;
      if (vars === undefined) return text;
      return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
    }

    function readLanguage(locale) {
      if (locale === null || locale === undefined) return 'es';
      try {
        if (typeof locale.getSnapshot === 'function') {
          const snapshot = locale.getSnapshot();
          const value = snapshot?.locale ?? snapshot?.lang ?? snapshot?.id ?? snapshot?.name;
          if (value !== undefined && value !== null) return normalizeLang(value);
        }
        if (typeof locale.getLocale === 'function') return normalizeLang(locale.getLocale());
      } catch {
        /* el locale es presentación: si falla, seguimos en español */
      }
      return 'es';
    }

    /* -------------------------------------------------------------------- estilos */

    const CSS = `
.lsc-root {
  --lsc-accent: #7c5cff;
  --lsc-accent-soft: rgba(124, 92, 255, 0.16);
  --lsc-cyan: #22d3ee;
  --lsc-ok: #22c55e;
  --lsc-warn: #f59e0b;
  --lsc-bad: #ef4444;
  --lsc-radius: 12px;
  --lsc-mono: ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, Consolas, monospace;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base, #0b1020);
  color: var(--dsw-alias-label-primary, #e8ecf5);
  font-size: 13px;
  line-height: 1.45;
  overflow: hidden;
}
.lsc-root *, .lsc-root *::before, .lsc-root *::after { box-sizing: border-box; }
.lsc-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(148, 163, 184, 0.18));
  background: var(--dsw-alias-bg-layer-1, #111a2e);
  flex: none;
}
.lsc-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.lsc-brand-mark { width: 30px; height: 30px; flex: none; }
.lsc-brand-text { display: flex; flex-direction: column; min-width: 0; }
.lsc-brand-title { font-weight: 650; font-size: 14px; letter-spacing: 0.2px; }
.lsc-brand-sub { font-size: 11px; color: var(--dsw-alias-label-secondary, #93a1b8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lsc-header-spacer { flex: 1; }
.lsc-project-picker {
  display: flex; align-items: center; gap: 6px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.2));
  border-radius: 10px; padding: 4px 8px;
  background: var(--dsw-alias-bg-layer-2, #16213a);
  max-width: 360px;
}
.lsc-project-picker select {
  background: transparent; color: inherit; border: 0; outline: none;
  font-size: 12px; max-width: 300px; cursor: pointer;
}
.lsc-project-picker select option { background: #111a2e; color: #e8ecf5; }
.lsc-btn {
  display: inline-flex; align-items: center; gap: 6px;
  border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.22));
  background: var(--dsw-alias-bg-layer-2, #16213a); color: inherit;
  padding: 6px 10px; font-size: 12px; font-weight: 550; cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
}
.lsc-btn:hover:not(:disabled) { border-color: var(--lsc-accent); background: var(--lsc-accent-soft); }
.lsc-btn:disabled { opacity: 0.5; cursor: default; }
.lsc-btn.primary { background: var(--lsc-accent); border-color: transparent; color: #fff; }
.lsc-btn.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--lsc-accent); }
.lsc-btn.ghost { background: transparent; }
.lsc-btn.danger { border-color: rgba(239,68,68,0.5); color: #fca5a5; }
.lsc-btn.small { padding: 3px 8px; font-size: 11px; }

.lsc-body { display: flex; flex: 1; min-height: 0; }
.lsc-rail {
  flex: none; width: 196px; padding: 14px 10px; display: flex; flex-direction: column; gap: 3px;
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.16));
  background: var(--dsw-alias-bg-layer-1, #0f1728);
  overflow-y: auto;
}
.lsc-rail-item {
  display: flex; align-items: center; gap: 9px;
  border: 0; border-radius: 9px; background: transparent; color: var(--dsw-alias-label-secondary, #93a1b8);
  padding: 8px 9px; font-size: 12.5px; font-weight: 550; cursor: pointer; text-align: left;
}
.lsc-rail-item:hover { background: rgba(148,163,184,0.09); color: var(--dsw-alias-label-primary, #e8ecf5); }
.lsc-rail-item.active { background: var(--lsc-accent-soft); color: #c4b5fd; }
.lsc-rail-item svg { flex: none; opacity: 0.85; }
.lsc-rail-count { margin-left: auto; font-size: 10.5px; opacity: 0.75; font-variant-numeric: tabular-nums; }
.lsc-rail-sep { height: 1px; margin: 10px 4px; background: var(--dsw-alias-border-l1, rgba(148,163,184,0.16)); }
.lsc-rail-note { padding: 2px 9px; font-size: 10.5px; color: var(--dsw-alias-label-secondary, #93a1b8); }

.lsc-content { flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden; padding: 18px 22px 40px; }
.lsc-content-inner { max-width: 1280px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.lsc-page-head { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.lsc-page-title { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: 0.2px; }
.lsc-page-sub { margin: 3px 0 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #93a1b8); max-width: 720px; }
.lsc-page-head .lsc-spacer { flex: 1; }

.lsc-card {
  border: 1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.16));
  border-radius: var(--lsc-radius);
  background: var(--dsw-alias-bg-layer-1, #111a2e);
  padding: 14px 16px;
  min-width: 0;
}
.lsc-card-title { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 650; margin: 0 0 2px; }
.lsc-card-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, #93a1b8); margin: 0 0 12px; }

.lsc-kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.lsc-kpi {
  border: 1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.16));
  border-radius: 11px; background: linear-gradient(180deg, rgba(124,92,255,0.08), rgba(17,26,46,0.4));
  padding: 11px 12px; min-width: 0;
}
.lsc-kpi-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--dsw-alias-label-secondary, #93a1b8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lsc-kpi-value { font-size: 22px; font-weight: 680; margin-top: 4px; font-variant-numeric: tabular-nums; }
.lsc-kpi-hint { font-size: 10.5px; color: var(--dsw-alias-label-secondary, #93a1b8); margin-top: 2px; }

.lsc-pipeline { display: flex; align-items: stretch; gap: 8px; flex-wrap: wrap; }
.lsc-step {
  flex: 1 1 130px; border: 1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.16));
  border-radius: 10px; padding: 9px 11px; background: rgba(148,163,184,0.04);
}
.lsc-step-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-step-value { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
.lsc-arrow { display: flex; align-items: center; color: var(--dsw-alias-label-secondary, #93a1b8); opacity: 0.5; font-size: 14px; }

.lsc-grid-2 { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.lsc-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-items: start; }

.lsc-pill {
  display: inline-flex; align-items: center; gap: 5px;
  border-radius: 999px; padding: 1px 8px; font-size: 10.5px; font-weight: 600;
  border: 1px solid transparent; white-space: nowrap;
}
.lsc-pill.ok { color: #86efac; background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.3); }
.lsc-pill.warn { color: #fcd34d; background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.32); }
.lsc-pill.bad { color: #fca5a5; background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.3); }
.lsc-pill.info { color: #a5b4fc; background: rgba(124,92,255,0.14); border-color: rgba(124,92,255,0.3); }
.lsc-pill.mute { color: var(--dsw-alias-label-secondary, #93a1b8); background: rgba(148,163,184,0.1); border-color: rgba(148,163,184,0.2); }

.lsc-mono { font-family: var(--lsc-mono); font-size: 11px; }
.lsc-dim { color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-nowrap { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lsc-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.lsc-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.lsc-spacer { flex: 1; }

.lsc-table { display: flex; flex-direction: column; }
.lsc-thead, .lsc-trow {
  display: grid; grid-template-columns: minmax(0, 1fr) 74px 96px 92px 108px;
  gap: 10px; align-items: center; padding: 8px 6px;
}
.lsc-thead { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--dsw-alias-label-secondary, #93a1b8); border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.16)); }
.lsc-trow { border-bottom: 1px solid rgba(148,163,184,0.09); cursor: pointer; border-radius: 8px; }
.lsc-trow:hover { background: rgba(124,92,255,0.07); }
.lsc-trow:last-child { border-bottom: 0; }
.lsc-tname { font-weight: 600; font-size: 12.5px; }
.lsc-tdesc { font-size: 11px; color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.lsc-input, .lsc-select, .lsc-textarea {
  border: 1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.22));
  background: var(--dsw-alias-bg-layer-2, #16213a); color: inherit;
  border-radius: 9px; padding: 6px 9px; font-size: 12px; font-family: inherit; outline: none; min-width: 0;
}
.lsc-input:focus, .lsc-select:focus, .lsc-textarea:focus { border-color: var(--lsc-accent); }
.lsc-input.search { flex: 1 1 220px; }
.lsc-textarea { width: 100%; resize: vertical; line-height: 1.5; }
.lsc-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.lsc-label { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-hint { font-size: 10.5px; color: var(--dsw-alias-label-secondary, #93a1b8); }

.lsc-switch { position: relative; display: inline-flex; width: 34px; height: 18px; flex: none; }
.lsc-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; z-index: 2; }
.lsc-switch-track { position: absolute; inset: 0; border-radius: 999px; background: rgba(148,163,184,0.28); transition: background 130ms ease; }
.lsc-switch-thumb { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform 130ms ease; }
.lsc-switch input:checked + .lsc-switch-track { background: var(--lsc-accent); }
.lsc-switch input:checked ~ .lsc-switch-thumb { transform: translateX(16px); }
.lsc-switch input:disabled { cursor: default; }
.lsc-switch input:disabled + .lsc-switch-track { opacity: 0.5; }

.lsc-list { display: flex; flex-direction: column; gap: 7px; }
.lsc-item {
  border: 1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.14)); border-radius: 9px;
  padding: 9px 11px; background: rgba(148,163,184,0.03); min-width: 0;
}
.lsc-item-title { font-size: 12px; font-weight: 600; }
.lsc-item-meta { font-size: 10.5px; color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-empty { padding: 26px 14px; text-align: center; color: var(--dsw-alias-label-secondary, #93a1b8); font-size: 12px; border: 1px dashed rgba(148,163,184,0.22); border-radius: 10px; }

.lsc-project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 12px; }
.lsc-project-head { display: flex; align-items: flex-start; gap: 8px; }
.lsc-project-name { font-size: 13px; font-weight: 650; }
.lsc-project-path { font-family: var(--lsc-mono); font-size: 10px; color: var(--dsw-alias-label-secondary, #93a1b8); word-break: break-all; }
.lsc-skill-row { display: flex; align-items: center; gap: 9px; padding: 6px 0; border-top: 1px solid rgba(148,163,184,0.1); }
.lsc-skill-row:first-child { border-top: 0; }

.lsc-diff { font-family: var(--lsc-mono); font-size: 10.5px; border-radius: 8px; overflow: hidden; border: 1px solid rgba(148,163,184,0.16); max-height: 220px; overflow-y: auto; }
.lsc-diff-line { padding: 0 8px; white-space: pre-wrap; word-break: break-word; }
.lsc-diff-line.added { background: rgba(34,197,94,0.12); color: #86efac; }
.lsc-diff-line.removed { background: rgba(239,68,68,0.12); color: #fca5a5; }
.lsc-diff-line.same { color: var(--dsw-alias-label-secondary, #93a1b8); }

.lsc-bars { width: 100%; height: 128px; display: block; }
.lsc-legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
.lsc-legend-item { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-swatch { width: 8px; height: 8px; border-radius: 2px; }

.lsc-overlay { position: absolute; inset: 0; background: rgba(4, 8, 18, 0.62); display: flex; justify-content: flex-end; z-index: 40; }
.lsc-drawer {
  width: min(620px, 92%); height: 100%; overflow-y: auto;
  background: var(--dsw-alias-bg-base, #0b1020); border-left: 1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.25));
  padding: 16px 18px 28px; display: flex; flex-direction: column; gap: 12px;
}
.lsc-drawer-head { display: flex; align-items: flex-start; gap: 10px; }
.lsc-drawer-title { font-size: 16px; font-weight: 680; }
.lsc-pre {
  margin: 0; font-family: var(--lsc-mono); font-size: 11px; white-space: pre-wrap; word-break: break-word;
  background: rgba(148,163,184,0.06); border: 1px solid rgba(148,163,184,0.14); border-radius: 9px;
  padding: 10px 12px; max-height: 340px; overflow: auto; line-height: 1.5;
}

.lsc-modal-wrap { position: absolute; inset: 0; background: rgba(4, 8, 18, 0.66); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.lsc-modal {
  width: min(720px, 100%); max-height: 100%; overflow-y: auto;
  background: var(--dsw-alias-bg-base, #0b1020); border: 1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.25));
  border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 10px;
}
.lsc-modal-title { font-size: 15px; font-weight: 680; }

.lsc-toast-wrap { position: absolute; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 60; }
.lsc-toast {
  border-radius: 9px; padding: 8px 12px; font-size: 12px;
  background: var(--dsw-alias-bg-overlay, #1b2740); border: 1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.3));
  box-shadow: 0 8px 24px rgba(0,0,0,0.35); max-width: 380px;
}
.lsc-toast.ok { border-color: rgba(34,197,94,0.5); }
.lsc-toast.bad { border-color: rgba(239,68,68,0.55); }

.lsc-banner { border: 1px solid rgba(239,68,68,0.45); background: rgba(239,68,68,0.1); color: #fca5a5; border-radius: 9px; padding: 8px 11px; font-size: 12px; display: flex; align-items: center; gap: 10px; }
.lsc-busy { position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--lsc-accent), transparent); animation: lsc-slide 1.1s linear infinite; z-index: 70; }
@keyframes lsc-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
.lsc-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--dsw-alias-label-secondary, #93a1b8); font-size: 13px; }
.lsc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

@media (max-width: 1080px) {
  .lsc-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .lsc-grid-2, .lsc-grid-3 { grid-template-columns: minmax(0, 1fr); }
  .lsc-rail { width: 60px; padding: 12px 6px; }
  .lsc-rail-item span.lsc-rail-label, .lsc-rail-count, .lsc-rail-note { display: none; }
  .lsc-rail-item { justify-content: center; }
}
`;

    /* ------------------------------------------------------------------- utilidades */

    function cx(...parts) {
      return parts.filter((part) => typeof part === 'string' && part !== '').join(' ');
    }

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function text(value) {
      return value === null || value === undefined || value === '' ? '' : String(value);
    }

    function plural(lang, count, one, many) {
      return count === 1 ? one : many;
    }

    function formatDate(value, lang) {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '—';
      try {
        return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
      } catch {
        return date.toISOString().slice(0, 10);
      }
    }

    function formatDayLabel(day, lang) {
      const date = new Date(`${day}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime())) return day.slice(5);
      try {
        return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: '2-digit' });
      } catch {
        return day.slice(5);
      }
    }

    function qualityTone(status) {
      if (status === 'pass') return 'ok';
      if (status === 'warn') return 'warn';
      if (status === 'fail') return 'bad';
      return 'mute';
    }

    function qualityOf(evaluation) {
      return evaluation === null || evaluation === undefined ? null : evaluation;
    }

    function skillsOf(snapshot) {
      return asArray(snapshot?.skills);
    }

    function projectsOf(snapshot) {
      return asArray(snapshot?.projects);
    }

    function assignmentOf(snapshot, projectId, skillId) {
      return snapshot?.assignments?.[projectId]?.[skillId] ?? null;
    }

    function activeProjectCount(snapshot, skillId) {
      let total = 0;
      for (const project of projectsOf(snapshot)) {
        if (assignmentOf(snapshot, project.id, skillId)?.enabled === true) total += 1;
      }
      return total;
    }

    function findSkill(snapshot, skillId) {
      return skillsOf(snapshot).find((skill) => skill.id === skillId) ?? null;
    }

    function samePath(left, right) {
      const norm = (value) => String(value ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      return norm(left) !== '' && norm(left) === norm(right);
    }

    function pickCwd(snapshot) {
      return text(snapshot?.project?.cwd ?? snapshot?.cwd ?? snapshot?.hostCwd ?? '');
    }

    /**
     * Lee una respuesta del servidor sin romper el panel por un cuerpo vacío o ilegible.
     *
     * `response.json()` lanza `Unexpected end of JSON input` y el panel entero se quedaba con un
     * mensaje en inglés del navegador. Encontrado midiendo el harness vivo: la ruta contestaba 405
     * sin cuerpo cuando el registro era un `resource` y no un `handler`.
     */
    async function readJson(response) {
      let raw = '';
      try {
        raw = await response.text();
      } catch {
        raw = '';
      }
      if (text(raw) === '') {
        return { ok: false, data: null, message: `HTTP ${response.status} · respuesta vacía` };
      }
      try {
        return { ok: true, data: JSON.parse(raw), message: '' };
      } catch {
        return { ok: false, data: null, message: `HTTP ${response.status} · respuesta ilegible` };
      }
    }

    /* ---------------------------------------------------------------------- iconos */

    function Icon({ size = 16 }) {
      return e(
        'svg',
        { width: size, height: size, viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': 'true' },
        e('path', {
          d: 'M16 3.2 27 9.6v12.8L16 28.8 5 22.4V9.6L16 3.2Z',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinejoin: 'round',
          opacity: 0.9,
        }),
        e('path', { d: 'M11.4 16.2l3.2 3.3 6-6.6', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    function NavIcon({ name, size = 15 }) {
      const paths = {
        overview: e('path', { d: 'M3 3h6v6H3zM11 3h6v4h-6zM3 11h6v4H3zM11 9h6v6h-6z', fill: 'currentColor', opacity: 0.85 }),
        library: e('path', {
          d: 'M4 3h5v12H4zM10.5 3h3.4v12h-3.4zM15.4 4l2.8-0.7 2.4 11.4-2.8.6z',
          fill: 'currentColor',
          opacity: 0.85,
        }),
        projects: e('path', { d: 'M3 4.5h5.2l1.4 1.8H17v7.2H3zM3 13.5h11.5v2H3z', fill: 'currentColor', opacity: 0.85 }),
        improvements: e('path', {
          d: 'M10 3.2l6.4 3.7v7.4L10 18l-6.4-3.7V6.9L10 3.2Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          fill: 'none',
          opacity: 0.9,
        }),
        analytics: e('path', { d: 'M3 15.5h3.2V8H3zM8.4 15.5h3.2V3.5H8.4zM13.8 15.5h3.2v-5h-3.2z', fill: 'currentColor', opacity: 0.85 }),
      };
      return e('svg', { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' }, paths[name] ?? paths.overview);
    }

    /* ---------------------------------------------------------------- piezas de UI */

    function Pill({ tone = 'mute', children }) {
      return e('span', { className: cx('lsc-pill', tone) }, children);
    }

    function QualityPill({ t, evaluation }) {
      if (evaluation === null || evaluation === undefined) return e(Pill, { tone: 'mute' }, t('quality.unmeasured'));
      return e(Pill, { tone: qualityTone(evaluation.status) }, `${t(`quality.${evaluation.status}`)} · ${evaluation.score}`);
    }

    function Switch({ checked, disabled, onChange, label }) {
      return e(
        'label',
        { className: 'lsc-switch', title: label },
        e('input', { type: 'checkbox', checked: checked === true, disabled: disabled === true, onChange: (event) => onChange(event.target.checked) }),
        e('span', { className: 'lsc-switch-track' }),
        e('span', { className: 'lsc-switch-thumb' }),
      );
    }

    function Kpi({ label, value, hint }) {
      return e('div', { className: 'lsc-kpi' }, e('div', { className: 'lsc-kpi-label' }, label), e('div', { className: 'lsc-kpi-value' }, value), hint ? e('div', { className: 'lsc-kpi-hint' }, hint) : null);
    }

    function Empty({ children }) {
      return e('div', { className: 'lsc-empty' }, children);
    }

    function Section({ title, hint, action, children }) {
      return e(
        'section',
        { className: 'lsc-card' },
        e('div', { className: 'lsc-row' }, e('h2', { className: 'lsc-card-title' }, title), e('div', { className: 'lsc-spacer' }), action ?? null),
        hint ? e('p', { className: 'lsc-card-hint' }, hint) : null,
        children,
      );
    }

    /* ---------------------------------------------------------------------- gráfico */

    const SERIES = [
      { key: 'created', color: '#7c5cff', labelKey: 'activity.legend.created' },
      { key: 'assigned', color: '#22d3ee', labelKey: 'activity.legend.assigned' },
      { key: 'versions', color: '#22c55e', labelKey: 'activity.legend.versions' },
      { key: 'loads', color: '#94a3b8', labelKey: 'activity.legend.loads' },
    ];

    function ActivityChart({ t, lang, series }) {
      const days = asArray(series);
      const totals = days.map((day) => SERIES.reduce((sum, entry) => sum + (Number(day[entry.key]) || 0), 0));
      const max = Math.max(1, ...totals);
      const height = 118;
      const width = 560;
      const gap = 4;
      const slot = days.length > 0 ? width / days.length : width;
      const barWidth = Math.max(4, slot - gap);
      const empty = totals.every((value) => value === 0);
      return e(
        'div',
        null,
        e(
          'svg',
          { className: 'lsc-bars', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img' },
          e('line', { x1: 0, y1: height - 1, x2: width, y2: height - 1, stroke: 'rgba(148,163,184,0.28)', strokeWidth: 1 }),
          empty
            ? null
            : days.map((day, index) => {
                let y = height - 2;
                const nodes = [];
                for (const entry of SERIES) {
                  const value = Number(day[entry.key]) || 0;
                  if (value <= 0) continue;
                  const barHeight = (value / max) * (height - 14);
                  y -= barHeight;
                  nodes.push(
                    e('rect', {
                      key: `${day.day}-${entry.key}`,
                      x: index * slot + gap / 2,
                      y,
                      width: barWidth,
                      height: barHeight,
                      rx: 1.5,
                      fill: entry.color,
                      opacity: 0.92,
                    }),
                  );
                }
                return e('g', { key: day.day }, nodes, e('title', null, `${formatDayLabel(day.day, lang)}: ${totals[index]}`));
              }),
        ),
        e('div', { className: 'lsc-legend' }, SERIES.map((entry) => e('span', { key: entry.key, className: 'lsc-legend-item' }, e('span', { className: 'lsc-swatch', style: { background: entry.color } }), t(entry.labelKey)))),
      );
    }

    /* ---------------------------------------------------------------------- vistas */

    function OverviewView({ t, lang, snapshot, onOpen, onNavigate, onImport, onDecide, busy, actionPending }) {
      const skills = skillsOf(snapshot);
      const analytics = snapshot?.analytics ?? {};
      const published = skills.filter((skill) => skill.status === 'published').length;
      const projects = projectsOf(snapshot);
      const activeAssignments = skills.reduce((sum, skill) => sum + activeProjectCount(snapshot, skill.id), 0);
      const pending = asArray(snapshot?.improvements).filter((entry) => entry.status === 'proposed');
      const quality = analytics?.quality ?? {};
      const evaluated = skills.filter((skill) => qualityOf(skill?.current?.evaluation) !== null);
      const average = evaluated.length === 0 ? '—' : String(Math.round(evaluated.reduce((sum, skill) => sum + Number(skill.current.evaluation.score ?? 0), 0) / evaluated.length));
      const series = asArray(analytics?.series);
      const loads = Number(analytics?.loads ?? 0);
      const improved = Number(analytics?.improvements?.approved ?? 0);
      const external = asArray(snapshot?.external?.candidates);
      const events = asArray(snapshot?.events).slice(0, 7);

      return e(
        'div',
        { className: 'lsc-content-inner' },
        e(
          'div',
          { className: 'lsc-page-head' },
          e('div', null, e('h1', { className: 'lsc-page-title' }, t('nav.overview')), e('p', { className: 'lsc-page-sub' }, snapshot?.project ? `${snapshot.project.name} · ${snapshot.project.cwd}` : t('app.empty'))),
          e('div', { className: 'lsc-spacer' }),
        ),

        e('div', { className: 'lsc-kpis' },
          e(Kpi, { label: t('kpi.skills'), value: skills.length, hint: `${published} ${t('kpi.published').toLowerCase()}` }),
          e(Kpi, { label: t('kpi.assignments'), value: activeAssignments, hint: `${projects.length} ${t('kpi.projects').toLowerCase()}` }),
          e(Kpi, { label: t('kpi.pending'), value: pending.length, hint: t('review.title') }),
          e(Kpi, { label: t('kpi.quality'), value: average === '—' ? '—' : `${average}/100`, hint: `${evaluated.length}/${skills.length}` }),
          e(Kpi, { label: t('kpi.loads'), value: loads, hint: t('pipeline.hint').split(',')[0] }),
          e(Kpi, { label: t('kpi.versions'), value: Number(analytics?.skills?.versions ?? 0), hint: t('improvements.title') }),
        ),

        e(Section, { title: t('pipeline.title'), hint: t('pipeline.hint') },
          e('div', { className: 'lsc-pipeline' },
            e('div', { className: 'lsc-step' }, e('div', { className: 'lsc-step-label' }, t('pipeline.library')), e('div', { className: 'lsc-step-value' }, skills.length)),
            e('div', { className: 'lsc-arrow' }, '›'),
            e('div', { className: 'lsc-step' }, e('div', { className: 'lsc-step-label' }, t('pipeline.evaluated')), e('div', { className: 'lsc-step-value' }, evaluated.length)),
            e('div', { className: 'lsc-arrow' }, '›'),
            e('div', { className: 'lsc-step' }, e('div', { className: 'lsc-step-label' }, t('pipeline.assigned')), e('div', { className: 'lsc-step-value' }, activeAssignments)),
            e('div', { className: 'lsc-arrow' }, '›'),
            e('div', { className: 'lsc-step' }, e('div', { className: 'lsc-step-label' }, t('pipeline.loaded')), e('div', { className: 'lsc-step-value' }, loads)),
            e('div', { className: 'lsc-arrow' }, '›'),
            e('div', { className: 'lsc-step' }, e('div', { className: 'lsc-step-label' }, t('pipeline.improved')), e('div', { className: 'lsc-step-value' }, improved)),
          ),
        ),

        e('div', { className: 'lsc-grid-2' },
          e(Section, { title: t('activity.title') },
            series.length === 0 || series.every((day) => SERIES.every((entry) => !day[entry.key]))
              ? e(Empty, null, t('activity.empty'))
              : e(ActivityChart, { t, lang, series }),
          ),
          e(Section, {
            title: t('review.title'),
            hint: t('review.hint'),
            action: e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: () => onNavigate('improvements') }, t('nav.improvements')),
          },
            pending.length === 0
              ? e(Empty, null, t('review.empty'))
              : e('div', { className: 'lsc-list' }, pending.slice(0, 4).map((entry) =>
                  e('div', { key: entry.id, className: 'lsc-item' },
                    e('div', { className: 'lsc-row' },
                      e('span', { className: 'lsc-item-title lsc-nowrap' }, entry.skillTitle ?? entry.skillId),
                      e('span', { className: 'lsc-spacer' }),
                      entry.summary ? e(Pill, { tone: qualityTone(entry.evaluation?.status) }, entry.summary) : null,
                    ),
                    e('div', { className: 'lsc-item-meta' }, t('improvements.base', { version: entry.baseVersion }), entry.rationale ? ` · ${entry.rationale}` : ''),
                    e('div', { className: 'lsc-row', style: { marginTop: 6 } },
                      e('button', { type: 'button', className: 'lsc-btn primary small', disabled: busy || actionPending === entry.id, onClick: () => onDecide(entry.id, 'approve') }, t('review.approve')),
                      e('button', { type: 'button', className: 'lsc-btn small', disabled: busy || actionPending === entry.id, onClick: () => onDecide(entry.id, 'reject') }, t('review.reject')),
                      e('span', { className: 'lsc-spacer' }),
                      e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: () => onOpen(entry.skillId) }, t('review.open')),
                    ),
                  ),
                )),
          ),
        ),

        external.length > 0
          ? e(Section, {
              title: t('external.title'),
              hint: t('external.hint'),
              action: e(Pill, { tone: 'info' }, t('external.count', { n: external.length })),
            },
              e('div', { className: 'lsc-list' }, external.slice(0, 5).map((candidate, index) => {
                const alreadyInLibrary = skills.some((skill) => skill.id === candidate.id);
                return e('div', { key: `${candidate.path}-${index}`, className: 'lsc-item' },
                  e('div', { className: 'lsc-row' },
                    e('div', { className: 'lsc-col', style: { minWidth: 0 } },
                      e('span', { className: 'lsc-item-title lsc-nowrap' }, candidate.name ?? candidate.id),
                      e('span', { className: 'lsc-item-meta lsc-nowrap' }, `${t('external.source')}: ${candidate.source ?? candidate.origin} · ${candidate.path}`),
                    ),
                    e('span', { className: 'lsc-spacer' }),
                    alreadyInLibrary
                      ? e(Pill, { tone: 'mute' }, t('external.imported'))
                      : e('button', { type: 'button', className: 'lsc-btn small', disabled: busy, onClick: () => onImport(candidate.path) }, t('external.import')),
                  ),
                );
              })),
              snapshot?.external?.truncated === true ? e('p', { className: 'lsc-hint', style: { marginTop: 8 } }, t('external.truncated', { n: external.length })) : null,
            )
          : null,

        events.length > 0
          ? e(Section, { title: t('nav.analytics') },
              e('div', { className: 'lsc-list' }, events.map((event) =>
                e('div', { key: event.id, className: 'lsc-row', style: { fontSize: 11.5 } },
                  e('span', { className: 'lsc-dim lsc-mono', style: { minWidth: 108 } }, formatDate(event.at, lang)),
                  e('span', { style: { fontWeight: 600, minWidth: 150 } }, event.type),
                  e('span', { className: 'lsc-dim lsc-nowrap' }, [event.skillId, event.projectId, event.actor].filter(Boolean).join(' · ')),
                ),
              )),
            )
          : null,
      );
    }

    function LibraryView({ t, lang, snapshot, onOpen, onNew, onDetect, detect, busy }) {
      const [query, setQuery] = useState('');
      const [filter, setFilter] = useState('all');
      const skills = skillsOf(snapshot);
      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return skills.filter((skill) => {
          if (filter !== 'all' && skill.status !== filter) return false;
          if (needle === '') return true;
          const haystack = [skill.id, skill.title, skill.description, ...asArray(skill.tags)].join(' ').toLowerCase();
          return haystack.includes(needle);
        });
      }, [skills, query, filter]);

      return e('div', { className: 'lsc-content-inner' },
        e('div', { className: 'lsc-page-head' },
          e('div', null, e('h1', { className: 'lsc-page-title' }, t('library.title')), e('p', { className: 'lsc-page-sub' }, t('projects.hint'))),
          e('div', { className: 'lsc-spacer' }),
          e('button', { type: 'button', className: 'lsc-btn primary', onClick: onNew }, `+ ${t('app.new')}`),
        ),

        e(Section, { title: t('library.detect'), hint: t('library.detect.hint') },
          e('div', { className: 'lsc-row' },
            e('input', {
              className: 'lsc-input search',
              placeholder: t('library.detect.placeholder'),
              value: detect.text,
              onChange: (event) => onDetect.change(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') onDetect.run(); },
            }),
            e('button', { type: 'button', className: 'lsc-btn', disabled: busy || detect.text.trim() === '', onClick: onDetect.run }, t('library.detect')),
          ),
          detect.result === null
            ? null
            : e('div', { style: { marginTop: 10 } },
                asArray(detect.result.matches).length === 0
                  ? e(Empty, null, t('library.detect.none'))
                  : e('div', { className: 'lsc-list' }, asArray(detect.result.matches).map((match) =>
                      e('div', { key: `${match.inLibrary ? 'lib' : 'ext'}-${match.id}-${match.path ?? ''}`, className: 'lsc-item' },
                        e('div', { className: 'lsc-row' },
                          e('span', { className: 'lsc-item-title lsc-nowrap' }, match.title ?? match.name ?? match.id),
                          e('span', { className: 'lsc-spacer' }),
                          e(Pill, { tone: match.inLibrary === true ? 'info' : 'mute' }, match.inLibrary === true ? t('library.detect.library') : t('library.detect.external')),
                          e(Pill, { tone: 'mute' }, t('library.detect.score', { n: Math.round((match.score ?? 0) * 100) })),
                        ),
                        e('div', { className: 'lsc-item-meta' }, match.why ?? ''),
                      ),
                    )),
              ),
        ),

        e(Section, {
          title: t(filtered.length === 1 ? 'library.countOne' : 'library.count', { n: filtered.length }),
          action: e(Pill, { tone: 'mute' }, t(skills.length === 1 ? 'library.countOne' : 'library.count', { n: skills.length })),
        },
          e('div', { className: 'lsc-toolbar' },
            e('input', { className: 'lsc-input search', placeholder: t('library.search'), value: query, onChange: (event) => setQuery(event.target.value) }),
            e('select', { className: 'lsc-select', value: filter, onChange: (event) => setFilter(event.target.value) },
              e('option', { value: 'all' }, t('library.filter.all')),
              e('option', { value: 'published' }, t('library.filter.published')),
              e('option', { value: 'deprecated' }, t('library.filter.deprecated')),
            ),
          ),
          filtered.length === 0
            ? e(Empty, null, skills.length === 0 ? t('library.empty') : t('app.empty'))
            : e('div', { className: 'lsc-table' },
                e('div', { className: 'lsc-thead' },
                  e('span', null, t('library.col.name')),
                  e('span', null, t('library.col.version')),
                  e('span', null, t('library.col.quality')),
                  e('span', null, t('library.col.projects')),
                  e('span', null, t('library.col.updated')),
                ),
                filtered.map((skill) =>
                  e('div', { key: skill.id, className: 'lsc-trow', role: 'button', tabIndex: 0, onClick: () => onOpen(skill.id), onKeyDown: (event) => { if (event.key === 'Enter') onOpen(skill.id); } },
                    e('div', { className: 'lsc-col', style: { minWidth: 0 } },
                      e('div', { className: 'lsc-row' },
                        e('span', { className: 'lsc-tname lsc-nowrap' }, skill.title ?? skill.id),
                        skill.origin?.kind && skill.origin.kind !== 'human' ? e(Pill, { tone: 'info' }, t(`library.origin.${skill.origin.kind}`)) : null,
                        skill.status === 'deprecated' ? e(Pill, { tone: 'warn' }, t('drawer.status.deprecated')) : null,
                      ),
                      e('span', { className: 'lsc-tdesc lsc-nowrap' }, skill.id),
                    ),
                    e('span', { className: 'lsc-mono' }, skill.currentVersion ?? '—'),
                    e(QualityPill, { t, evaluation: skill?.current?.evaluation ?? null }),
                    e('span', { className: 'lsc-mono' }, String(activeProjectCount(snapshot, skill.id))),
                    e('span', { className: 'lsc-dim', style: { fontSize: 11 } }, formatDate(skill.updatedAt, lang)),
                  ),
                ),
              ),
        ),
      );
    }

    function ProjectsView({ t, snapshot, onToggle, onVersion, onSync, onAdd, onSelect, onOpen, cwd, busy }) {
      const [adding, setAdding] = useState(false);
      const [path, setPath] = useState('');
      const projects = projectsOf(snapshot);
      const skills = skillsOf(snapshot);
      const current = text(cwd) !== '' ? cwd : pickCwd(snapshot);
      const pendingKey = snapshot?.project?.id;

      return e('div', { className: 'lsc-content-inner' },
        e('div', { className: 'lsc-page-head' },
          e('div', null, e('h1', { className: 'lsc-page-title' }, t('projects.title')), e('p', { className: 'lsc-page-sub' }, t('projects.hint'))),
          e('div', { className: 'lsc-spacer' }),
          e('button', { type: 'button', className: 'lsc-btn', onClick: () => setAdding((value) => !value) }, `+ ${t('projects.add')}`),
        ),

        adding
          ? e(Section, { title: t('projects.add') },
              e('div', { className: 'lsc-row' },
                e('input', { className: 'lsc-input search', placeholder: t('projects.add.placeholder'), value: path, onChange: (event) => setPath(event.target.value) }),
                e('button', { type: 'button', className: 'lsc-btn primary', disabled: busy || path.trim() === '', onClick: async () => { await onAdd(path.trim()); setPath(''); setAdding(false); } }, t('projects.add.confirm')),
              ),
            )
          : null,

        projects.length === 0
          ? e(Empty, null, t('projects.empty'))
          : e('div', { className: 'lsc-project-grid' }, projects.map((project) => {
              const active = skills.filter((skill) => assignmentOf(snapshot, project.id, skill.id)?.enabled === true);
              const isCurrent = samePath(project.cwd, current) || project.id === pendingKey;
              return e(Section, { key: project.id, title: project.name ?? project.id },
                e('div', { className: 'lsc-project-head' },
                  e('div', { className: 'lsc-col', style: { minWidth: 0, flex: 1 } },
                    e('span', { className: 'lsc-row' }, e('span', { className: 'lsc-project-name lsc-nowrap' }, project.name ?? project.id), isCurrent ? e(Pill, { tone: 'info' }, t('projects.this')) : null),
                    e('span', { className: 'lsc-project-path' }, project.cwd),
                  ),
                ),
                e('div', { className: 'lsc-row', style: { margin: '8px 0' } },
                  e(Pill, { tone: active.length > 0 ? 'ok' : 'mute' }, t('projects.active', { n: active.length })),
                  e('span', { className: 'lsc-spacer' }),
                  !isCurrent ? e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: () => onSelect(project.cwd) }, t('projects.open')) : null,
                  e('button', { type: 'button', className: 'lsc-btn ghost small', disabled: busy, onClick: () => onSync(project.id) }, t('projects.sync')),
                ),
                skills.length === 0
                  ? e(Empty, null, t('projects.none'))
                  : e('div', null, skills.map((skill) => {
                      const assignment = assignmentOf(snapshot, project.id, skill.id);
                      const enabled = assignment?.enabled === true;
                      const versions = asArray(skill.versions);
                      const selected = assignment?.version ?? skill.currentVersion ?? '';
                      return e('div', { key: skill.id, className: 'lsc-skill-row' },
                        e('div', { className: 'lsc-col', style: { minWidth: 0, flex: 1 } },
                          e('button', { type: 'button', className: 'lsc-btn ghost small', style: { padding: 0, border: 0, textAlign: 'left', fontWeight: 600 }, onClick: () => onOpen(skill.id) }, skill.title ?? skill.id),
                          e('span', { className: 'lsc-hint lsc-nowrap' }, skill.id),
                        ),
                        enabled
                          ? e('select', {
                              className: 'lsc-select',
                              style: { fontSize: 10.5, padding: '2px 5px' },
                              value: selected,
                              title: t('projects.version'),
                              onChange: (event) => onVersion(project.id, skill.id, event.target.value),
                            }, (versions.length === 0 ? [skill.currentVersion] : versions.map((version) => version.version)).filter(Boolean).map((version) => e('option', { key: version, value: version }, version)))
                          : null,
                        e(Switch, {
                          checked: enabled,
                          disabled: busy,
                          label: enabled ? t('toast.toggled.off') : t('toast.toggled.on'),
                          onChange: (value) => onToggle(project.id, skill.id, value, skill.currentVersion),
                        }),
                      );
                    })),
              );
            })),
      );
    }

    function ImprovementsView({ t, lang, snapshot, onDecide, onOpen, busy, actionPending }) {
      const entries = asArray(snapshot?.improvements);
      const proposed = entries.filter((entry) => entry.status === 'proposed');
      const settled = entries.filter((entry) => entry.status !== 'proposed');

      const renderDiff = (entry) => {
        const diff = entry.diff;
        if (!diff || (diff.added === 0 && diff.removed === 0)) return e('p', { className: 'lsc-hint' }, t('common.none'));
        return e('div', { className: 'lsc-diff' },
          asArray(diff.preview).map((line, index) => e('div', { key: index, className: cx('lsc-diff-line', line.kind === 'added' ? 'added' : line.kind === 'removed' ? 'removed' : 'same') }, `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '} ${line.text}`)),
          diff.truncated ? e('div', { className: 'lsc-diff-line same' }, t('improvements.diff.truncated')) : null,
        );
      };

      return e('div', { className: 'lsc-content-inner' },
        e('div', { className: 'lsc-page-head' }, e('div', null, e('h1', { className: 'lsc-page-title' }, t('improvements.title')), e('p', { className: 'lsc-page-sub' }, t('improvements.hint')))),

        proposed.length === 0 && settled.length === 0
          ? e(Empty, null, t('improvements.empty'))
          : null,

        proposed.map((entry) => e(Section, {
          key: entry.id,
          title: entry.skillTitle ?? entry.skillId,
          hint: `${t('improvements.base', { version: entry.baseVersion })} · ${formatDate(entry.createdAt, lang)}`,
          action: e('div', { className: 'lsc-row' },
            entry.summary ? e(Pill, { tone: qualityTone(entry.evaluation?.status) }, entry.summary) : null,
            e(Pill, { tone: 'info' }, t('improvements.diff', { added: entry.diff?.added ?? 0, removed: entry.diff?.removed ?? 0 })),
          ),
        },
          entry.rationale ? e('p', { className: 'lsc-hint', style: { marginBottom: 8 } }, `${t('improvements.rationale')}: ${entry.rationale}`) : null,
          renderDiff(entry),
          e('div', { className: 'lsc-row', style: { marginTop: 10 } },
            e('button', { type: 'button', className: 'lsc-btn primary small', disabled: busy || actionPending === entry.id, onClick: () => onDecide(entry.id, 'approve') }, t('improvements.approve')),
            e('button', { type: 'button', className: 'lsc-btn small', disabled: busy || actionPending === entry.id, onClick: () => onDecide(entry.id, 'reject') }, t('improvements.reject')),
            e('span', { className: 'lsc-spacer' }),
            e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: () => onOpen(entry.skillId) }, t('review.open')),
          ),
        )),

        settled.length > 0
          ? e(Section, { title: t('improvements.title') },
              e('div', { className: 'lsc-list' }, settled.map((entry) =>
                e('div', { key: entry.id, className: 'lsc-item' },
                  e('div', { className: 'lsc-row' },
                    e('span', { className: 'lsc-item-title lsc-nowrap' }, entry.skillTitle ?? entry.skillId),
                    e('span', { className: 'lsc-spacer' }),
                    e(Pill, { tone: entry.status === 'approved' ? 'ok' : 'mute' }, t(`improvements.${entry.status}`)),
                    entry.version ? e(Pill, { tone: 'info' }, entry.version) : null,
                  ),
                  e('div', { className: 'lsc-item-meta' }, `${formatDate(entry.decidedAt ?? entry.createdAt, lang)} · ${entry.decidedBy ?? 'human'}`),
                ),
              )),
            )
          : null,
      );
    }

    function AnalyticsView({ t, lang, snapshot }) {
      const skills = skillsOf(snapshot);
      const analytics = snapshot?.analytics ?? {};
      const series = asArray(analytics?.series);
      const top = asArray(analytics?.topSkills);
      const maxTop = Math.max(1, ...top.map((entry) => Number(entry.projects) || 0));
      const distribution = { pass: 0, warn: 0, fail: 0, none: 0 };
      for (const skill of skills) {
        const evaluation = skill?.current?.evaluation ?? null;
        if (evaluation === null) distribution.none += 1;
        else if (evaluation.status === 'pass') distribution.pass += 1;
        else if (evaluation.status === 'warn') distribution.warn += 1;
        else distribution.fail += 1;
      }
      const total = Math.max(1, skills.length);

      const bar = (key, color, labelKey) =>
        e('div', { key, style: { marginBottom: 8 } },
          e('div', { className: 'lsc-row', style: { fontSize: 11 } }, e('span', null, t(labelKey)), e('span', { className: 'lsc-spacer' }), e('span', { className: 'lsc-mono' }, String(distribution[key]))),
          e('div', { style: { height: 6, borderRadius: 999, background: 'rgba(148,163,184,0.16)', marginTop: 3 } },
            e('div', { style: { height: '100%', width: `${(distribution[key] / total) * 100}%`, borderRadius: 999, background: color } }),
          ),
        );

      return e('div', { className: 'lsc-content-inner' },
        e('div', { className: 'lsc-page-head' }, e('div', null, e('h1', { className: 'lsc-page-title' }, t('analytics.title')), e('p', { className: 'lsc-page-sub' }, t('pipeline.hint')))),

        e('div', { className: 'lsc-kpis', style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } },
          e(Kpi, { label: t('kpi.skills'), value: skills.length }),
          e(Kpi, { label: t('kpi.loads'), value: Number(analytics?.loads ?? 0) }),
          e(Kpi, { label: t('kpi.pending'), value: Number(analytics?.improvements?.proposed ?? 0) }),
          e(Kpi, { label: t('kpi.quality'), value: Number(analytics?.quality?.average ?? 0) > 0 ? `${Math.round(analytics.quality.average)}/100` : '—', hint: `${analytics?.quality?.measured ?? 0} ${t('quality.pass').toLowerCase()}` }),
        ),

        e('div', { className: 'lsc-grid-2' },
          e(Section, { title: t('activity.title') }, series.length === 0 ? e(Empty, null, t('activity.empty')) : e(ActivityChart, { t, lang, series })),
          e(Section, { title: t('analytics.quality') },
            bar('pass', '#22c55e', 'analytics.quality.pass'),
            bar('warn', '#f59e0b', 'analytics.quality.warn'),
            bar('fail', '#ef4444', 'analytics.quality.fail'),
            bar('none', '#94a3b8', 'analytics.quality.none'),
          ),
        ),

        e('div', { className: 'lsc-grid-2' },
          e(Section, { title: t('analytics.top') },
            top.length === 0
              ? e(Empty, null, t('analytics.top.empty'))
              : e('div', { className: 'lsc-list' }, top.map((entry) =>
                  e('div', { key: entry.id, className: 'lsc-item' },
                    e('div', { className: 'lsc-row' }, e('span', { className: 'lsc-item-title lsc-nowrap' }, entry.title ?? entry.id), e('span', { className: 'lsc-spacer' }), e('span', { className: 'lsc-mono' }, String(entry.projects))),
                    e('div', { style: { height: 5, borderRadius: 999, background: 'rgba(148,163,184,0.14)', marginTop: 5 } },
                      e('div', { style: { height: '100%', width: `${(Number(entry.projects) / maxTop) * 100}%`, background: 'var(--lsc-accent)', borderRadius: 999 } }),
                    ),
                    e('div', { className: 'lsc-item-meta', style: { marginTop: 4 } }, t('analytics.top.hint', { n: entry.projects })),
                  ),
                )),
          ),
          e(Section, { title: t('analytics.diag') },
            e('div', { className: 'lsc-list' },
              e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.store')), e('div', { className: 'lsc-mono lsc-nowrap' }, text(snapshot?.storePath))),
              e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.version')), e('div', { className: 'lsc-mono' }, String(snapshot?.apiVersion ?? '—'))),
              e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.exists')), e('div', { className: 'lsc-mono' }, snapshot?.storeExists === true ? t('analytics.diag.exists') : t('analytics.diag.missing'))),
              snapshot?.storeError ? e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.error', { message: snapshot.storeError }))) : null,
            ),
          ),
        ),
      );
    }

    /* -------------------------------------------------------------------- drawer */

    function SkillDrawer({ t, lang, snapshot, skillId, onClose, onToggle, onVersion, onEvaluate, onImprove, busy }) {
      const skill = findSkill(snapshot, skillId);
      if (skill === null) {
        return e('div', { className: 'lsc-overlay', onClick: onClose }, e('div', { className: 'lsc-drawer', onClick: (event) => event.stopPropagation() }, e(Empty, null, t('app.empty'))));
      }
      const current = skill.current ?? {};
      const evaluation = current.evaluation ?? null;
      const versions = asArray(skill.versions);
      const projects = projectsOf(snapshot);
      // El proyecto del panel es el de la sesión: sirve para ofrecer «usar esta versión aquí» sin
      // depender del desplegable nativo, que no se puede accionar desde fuera de la app.
      const currentProject = projects.find((project) => samePath(project.cwd, pickCwd(snapshot))) ?? null;
      const hereAssignment = currentProject === null ? null : assignmentOf(snapshot, currentProject.id, skill.id);
      const hereEnabled = hereAssignment?.enabled === true;

      return e('div', { className: 'lsc-overlay', onClick: onClose },
        e('div', { className: 'lsc-drawer', onClick: (event) => event.stopPropagation() },
          e('div', { className: 'lsc-drawer-head' },
            e('div', { className: 'lsc-col', style: { minWidth: 0, flex: 1 } },
              e('div', { className: 'lsc-drawer-title' }, skill.title ?? skill.id),
              e('div', { className: 'lsc-mono lsc-dim' }, skill.id),
            ),
            e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: onClose }, t('drawer.close')),
          ),
          e('div', { className: 'lsc-row', style: { flexWrap: 'wrap' } },
            e(Pill, { tone: skill.status === 'published' ? 'ok' : 'warn' }, t(`drawer.status.${skill.status}`)),
            e('span', { className: 'lsc-mono' }, skill.currentVersion),
            e(QualityPill, { t, evaluation }),
            skill.origin?.kind ? e(Pill, { tone: 'info' }, t(`library.origin.${skill.origin.kind}`)) : null,
            skill.origin?.from ? e(Pill, { tone: 'mute' }, `${t('drawer.origin')}: ${skill.origin.from}`) : null,
          ),

          e('div', null, e('div', { className: 'lsc-label' }, t('drawer.description')), e('div', null, text(skill.description) || t('common.none'))),
          e('div', null, e('div', { className: 'lsc-label' }, t('drawer.when')), e('div', null, text(skill.whenToUse) || t('common.none'))),
          asArray(skill.tags).length > 0
            ? e('div', null, e('div', { className: 'lsc-label' }, t('drawer.tags')), e('div', { className: 'lsc-row', style: { flexWrap: 'wrap' } }, asArray(skill.tags).map((tag) => e(Pill, { key: tag, tone: 'mute' }, tag))))
            : null,

          e('div', { className: 'lsc-row', style: { fontSize: 11 } },
            e('span', { className: 'lsc-dim' }, `${t('drawer.created')}: ${formatDate(skill.createdAt, lang)}`),
            e('span', { className: 'lsc-dim' }, `${t('drawer.updated')}: ${formatDate(skill.updatedAt, lang)}`),
            e('span', { className: 'lsc-spacer' }),
            e('button', { type: 'button', className: 'lsc-btn small', disabled: busy, onClick: () => onEvaluate(skill.id, skill.currentVersion) }, t('drawer.evaluate')),
          ),

          evaluation !== null && asArray(evaluation.findings).length > 0
            ? e('div', { className: 'lsc-list' }, asArray(evaluation.findings).map((finding, index) =>
                e('div', { key: index, className: 'lsc-item' },
                  e('div', { className: 'lsc-row' }, e(Pill, { tone: finding.severity === 'block' ? 'bad' : finding.severity === 'warn' ? 'warn' : 'mute' }, finding.severity), e('span', { className: 'lsc-mono lsc-dim' }, finding.code)),
                  e('div', { style: { fontSize: 11.5, marginTop: 3 } }, finding.message),
                ),
              ))
            : null,

          e('div', null,
            e('div', { className: 'lsc-label' }, t('drawer.body', { version: skill.currentVersion })),
            e('pre', { className: 'lsc-pre' }, text(current.body)),
          ),

          asArray(current.references).length > 0
            ? e('div', null, e('div', { className: 'lsc-label' }, t('drawer.references')), e('div', { className: 'lsc-list' }, asArray(current.references).map((reference) => e('div', { key: reference, className: 'lsc-item lsc-mono' }, reference))))
            : null,

          e('div', null,
            e('div', { className: 'lsc-label' }, t('drawer.versions')),
            e('div', { className: 'lsc-list' }, versions.map((version) =>
              e('div', { key: version.version, className: 'lsc-row', style: { padding: '4px 0', fontSize: 11.5 } },
                e('span', { className: 'lsc-mono', style: { minWidth: 58 } }, version.version),
                e('span', { className: 'lsc-dim' }, formatDate(version.createdAt, lang)),
                e('span', { className: 'lsc-spacer' }),
                version.status ? e(Pill, { tone: qualityTone(version.status) }, `${version.status} ${version.score ?? ''}`) : null,
                hereEnabled && currentProject !== null && version.version !== hereAssignment?.version
                  ? e('button', { type: 'button', className: 'lsc-btn ghost small', disabled: busy, onClick: () => onVersion(currentProject.id, skill.id, version.version) }, t('drawer.use'))
                  : null,
              ),
            )),
          ),

          e('div', null,
            e('div', { className: 'lsc-label' }, t('drawer.projects')),
            projects.length === 0
              ? e('p', { className: 'lsc-hint' }, t('drawer.no.assignments'))
              : e('div', { className: 'lsc-list' }, projects.map((project) => {
                  const assignment = assignmentOf(snapshot, project.id, skill.id);
                  const enabled = assignment?.enabled === true;
                  return e('div', { key: project.id, className: 'lsc-skill-row' },
                    e('div', { className: 'lsc-col', style: { minWidth: 0, flex: 1 } },
                      e('span', { style: { fontSize: 12, fontWeight: 600 } }, project.name ?? project.id),
                      e('span', { className: 'lsc-project-path' }, project.cwd),
                    ),
                    enabled
                      ? e('select', { className: 'lsc-select', style: { fontSize: 10.5, padding: '2px 5px' }, value: assignment?.version ?? skill.currentVersion, onChange: (event) => onVersion(project.id, skill.id, event.target.value) },
                          versions.map((version) => e('option', { key: version.version, value: version.version }, version.version)))
                      : null,
                    e(Switch, { checked: enabled, disabled: busy, onChange: (value) => onToggle(project.id, skill.id, value, skill.currentVersion) }),
                  );
                })),
          ),
        ),
      );
    }

    /* --------------------------------------------------------------------- modal */

    const EMPTY_FORM = { id: '', title: '', description: '', whenToUse: '', body: '', tags: '' };

    function CreateModal({ t, onSubmit, onClose, busy }) {
      const [form, setForm] = useState(EMPTY_FORM);
      const [error, setError] = useState('');
      const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
      const submit = async () => {
        if (form.description.trim() === '' || form.whenToUse.trim() === '' || form.body.trim() === '') {
          setError(t('modal.required'));
          return;
        }
        setError('');
        const payload = {
          description: form.description.trim(),
          whenToUse: form.whenToUse.trim(),
          body: form.body,
          tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        };
        if (form.id.trim() !== '') payload.id = form.id.trim();
        if (form.title.trim() !== '') payload.title = form.title.trim();
        await onSubmit(payload, setError);
      };
      return e('div', { className: 'lsc-modal-wrap', onClick: onClose },
        e('div', { className: 'lsc-modal', onClick: (event) => event.stopPropagation() },
          e('div', { className: 'lsc-modal-title' }, t('modal.title')),
          e('p', { className: 'lsc-hint' }, t('modal.hint')),
          error !== '' ? e('div', { className: 'lsc-banner' }, error) : null,
          e('div', { className: 'lsc-field' }, e('label', { className: 'lsc-label' }, t('modal.name')), e('input', { className: 'lsc-input', value: form.title, onChange: update('title') })),
          e('div', { className: 'lsc-field' }, e('label', { className: 'lsc-label' }, t('modal.id')), e('input', { className: 'lsc-input lsc-mono', placeholder: t('modal.id.placeholder'), value: form.id, onChange: update('id') })),
          e('div', { className: 'lsc-field' }, e('label', { className: 'lsc-label' }, t('modal.description')), e('input', { className: 'lsc-input', value: form.description, onChange: update('description') })),
          e('div', { className: 'lsc-field' }, e('label', { className: 'lsc-label' }, t('modal.when')), e('input', { className: 'lsc-input', value: form.whenToUse, onChange: update('whenToUse') })),
          e('div', { className: 'lsc-field' }, e('label', { className: 'lsc-label' }, t('modal.tags')), e('input', { className: 'lsc-input', value: form.tags, onChange: update('tags') })),
          e('div', { className: 'lsc-field' }, e('label', { className: 'lsc-label' }, t('modal.body')), e('textarea', { className: 'lsc-textarea', rows: 10, value: form.body, onChange: update('body') })),
          e('div', { className: 'lsc-row', style: { justifyContent: 'flex-end' } },
            e('button', { type: 'button', className: 'lsc-btn ghost', onClick: onClose }, t('modal.cancel')),
            e('button', { type: 'button', className: 'lsc-btn primary', disabled: busy, onClick: submit }, busy ? t('modal.creating') : t('modal.create')),
          ),
        ),
      );
    }

    /* --------------------------------------------------------------------- panel */

    function createPanel(ctx) {
      const locale = ctx?.locale ?? ctx?.get?.('locale') ?? null;

      function useLanguage() {
        const [lang, setLang] = useState(() => readLanguage(locale));
        useEffect(() => {
          if (locale === null || typeof locale.subscribe !== 'function') return undefined;
          const dispose = locale.subscribe(() => setLang(readLanguage(locale)));
          return typeof dispose === 'function' ? dispose : undefined;
        }, []);
        return lang;
      }

      /**
       * El texto de una negativa de autenticación, o `''` si el estado no habla de credenciales.
       *
       * El servidor ya contesta 401/403/503 con su propio mensaje técnico; en la ventana hace falta algo
       * que se pueda accionar. Se traduce aquí, y no con el `t` de la vista, porque `load` y `openPanel`
       * se memoizan una sola vez.
       */
      function authMessageFor(status) {
        const key =
          Number(status) === 401 ? 'auth.missing' : Number(status) === 403 ? 'auth.forbidden' : Number(status) === 503 ? 'auth.unavailable' : '';
        return key === '' ? '' : translate(readLanguage(locale), key);
      }

      return function Panel() {
        const lang = useLanguage();
        const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);

        const [view, setView] = useState('overview');
        const [cwd, setCwd] = useState('');
        const [snapshot, setSnapshot] = useState(null);
        const [error, setError] = useState('');
        const [busy, setBusy] = useState(false);
        const [toast, setToast] = useState(null);
        const [drawerId, setDrawerId] = useState(null);
        const [modalOpen, setModalOpen] = useState(false);
        const [actionPending, setActionPending] = useState('');
        const [detectText, setDetectText] = useState('');
        const [detectResult, setDetectResult] = useState(null);
        const toastTimer = useRef(null);
        const cwdRef = useRef('');
        cwdRef.current = cwd;

        const notify = useCallback((message, tone = 'ok') => {
          if (toastTimer.current !== null) clearTimeout(toastTimer.current);
          setToast({ message, tone });
          toastTimer.current = setTimeout(() => setToast(null), 4200);
        }, []);

        useEffect(() => () => { if (toastTimer.current !== null) clearTimeout(toastTimer.current); }, []);

        const load = useCallback(async (options = {}) => {
          const target = options.cwd !== undefined ? options.cwd : cwdRef.current;
          setBusy(true);
          setError('');
          try {
            const params = new URLSearchParams();
            if (target !== '') params.set('cwd', target);
            if (options.scan === false) params.set('scan', '0');
            const query = params.toString();
            const response = await fetch(`${API}/state${query === '' ? '' : `?${query}`}`, { headers: { accept: 'application/json' } });
            const parsed = await readJson(response);
            const data = parsed.data;
            if (!parsed.ok || !data || data.ok !== true) {
              setError(authMessageFor(response.status) || data?.message || parsed.message);
              return null;
            }
            // La recarga rápida (sin barrido) no vuelve a caminar el disco: conservamos lo último
            // detectado para que la lista no parpadee con cada interruptor.
            setSnapshot((previous) => {
              if (options.scan === false && previous?.external !== undefined && data.external?.candidates?.length === 0) {
                return { ...data, external: previous.external };
              }
              return data;
            });
            if (cwdRef.current === '') {
              const next = pickCwd(data);
              cwdRef.current = next;
              setCwd(next);
            }
            return data;
          } catch (failure) {
            setError(String(failure?.message ?? failure));
            return null;
          } finally {
            setBusy(false);
          }
        }, []);

        // Abrir el panel es un acto humano: registra la vista del proyecto actual en el centro (un
        // avistamiento, no un permiso) y devuelve el retrato. Sin esto, el proyecto real aparecía en
        // la cabecera como «sin registrar» y la vista Proyectos decía que no había ninguno.
        const openPanel = useCallback(async () => {
          setBusy(true);
          setError('');
          try {
            const response = await fetch(`${API}/state`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'open', payload: {}, cwd: cwdRef.current }),
            });
            const parsed = await readJson(response);
            const data = parsed.data;
            if (!parsed.ok || !data || data.ok !== true) {
              setError(authMessageFor(response.status) || data?.message || parsed.message);
              return;
            }
            setSnapshot(data);
            if (cwdRef.current === '') {
              const next = pickCwd(data);
              cwdRef.current = next;
              setCwd(next);
            }
          } catch (failure) {
            setError(String(failure?.message ?? failure));
          } finally {
            setBusy(false);
          }
        }, []);

        useEffect(() => { openPanel().catch(() => {}); }, [openPanel]);

        // El centro también cambia desde fuera del panel: la IA crea o propone, otra ventana mueve un
        // interruptor, el vigilante del almacén invalida el catálogo. Sin refrescar, la vista se queda
        // con el retrato del montaje — en la auditoría Mejoras decía «no hay mejoras» con una propuesta
        // ya registrada, y Proyectos mostraba un solo proyecto cuando había dos.
        const firstView = useRef(true);
        useEffect(() => {
          if (firstView.current) {
            firstView.current = false;
            return undefined;
          }
          load({ scan: false }).catch(() => {});
          return undefined;
        }, [view, load]);

        useEffect(() => {
          if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
          const refresh = () => {
            const state = typeof document !== 'undefined' ? document?.visibilityState : 'visible';
            if (state === 'hidden') return;
            load({ scan: false }).catch(() => {});
          };
          const timer = typeof setInterval === 'function' ? setInterval(refresh, 20000) : null;
          window.addEventListener('focus', refresh);
          return () => {
            if (timer !== null) clearInterval(timer);
            window.removeEventListener?.('focus', refresh);
          };
        }, [load]);

        const act = useCallback(async (action, payload = {}) => {
          setBusy(true);
          try {
            const response = await fetch(`${API}/state`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action, payload, cwd: cwdRef.current }),
            });
            const parsed = await readJson(response);
            const result = parsed.data;
            if (!parsed.ok || !result || result.ok === false) {
              const message = authMessageFor(response.status) || result?.message || parsed.message;
              notify(t('toast.failed', { message }), 'bad');
              setError(message);
              return null;
            }
            await load({ scan: false });
            return result;
          } catch (failure) {
            notify(t('toast.failed', { message: String(failure?.message ?? failure) }), 'bad');
            return null;
          } finally {
            setBusy(false);
          }
        }, [load, notify, t]);

        const selectProject = useCallback(async (nextCwd) => {
          cwdRef.current = nextCwd;
          setCwd(nextCwd);
          await load({ cwd: nextCwd, scan: false });
        }, [load]);

        const onToggle = useCallback(async (projectId, skillId, enabled, version) => {
          setActionPending(`${projectId}:${skillId}`);
          const payload = { projectId, skillId, enabled };
          if (version) payload.version = version;
          const result = await act('toggle', payload);
          setActionPending('');
          if (result !== null) notify(enabled ? t('toast.toggled.on') : t('toast.toggled.off'));
        }, [act, notify, t]);

        const onVersion = useCallback(async (projectId, skillId, version) => {
          setActionPending(`${projectId}:${skillId}`);
          const result = await act('rollback', { projectId, skillId, version });
          setActionPending('');
          if (result !== null) notify(t('toast.version'));
        }, [act, notify, t]);

        const onSync = useCallback(async (projectId) => {
          const result = await act('sync', projectId ? { projectId } : {});
          if (result !== null) {
            const written = asArray(result.results).reduce((sum, entry) => sum + asArray(entry.written).length, 0);
            notify(t('projects.sync.done', { n: written }));
          }
        }, [act, notify, t]);

        const onDecide = useCallback(async (improvementId, decision) => {
          setActionPending(improvementId);
          const result = await act('decide', { improvementId, decision });
          setActionPending('');
          if (result !== null) notify(decision === 'approve' ? t('toast.approved') : t('toast.rejected'));
        }, [act, notify, t]);

        const onImport = useCallback(async (path) => {
          const result = await act('import', { path });
          if (result !== null) notify(t('toast.imported'));
        }, [act, notify, t]);

        const onEvaluate = useCallback(async (skillId, version) => {
          const result = await act('evaluate', { skillId, version });
          if (result !== null) notify(t('toast.evaluated'));
        }, [act, notify, t]);

        const onAddProject = useCallback(async (path) => {
          const result = await act('register-project', { cwd: path });
          if (result !== null) {
            notify(t('toast.project'));
            await selectProject(path);
          }
        }, [act, notify, selectProject, t]);

        const onCreate = useCallback(async (payload, setError) => {
          setBusy(true);
          try {
            const response = await fetch(`${API}/state`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'create', payload, cwd: cwdRef.current }),
            });
            const parsed = await readJson(response);
            const result = parsed.data;
            if (!parsed.ok || !result || result.ok === false) {
              const message = result?.message ?? parsed.message;
              if (typeof setError === 'function') setError(asArray(result?.findings).map((finding) => finding.message).join(' · ') || message);
              return;
            }
            setModalOpen(false);
            await load({ scan: false });
            setDrawerId(result.id ?? null);
            notify(t('toast.created'));
          } catch (failure) {
            if (typeof setError === 'function') setError(String(failure?.message ?? failure));
          } finally {
            setBusy(false);
          }
        }, [load, notify, t]);

        const runDetect = useCallback(async () => {
          if (detectText.trim() === '') return;
          const result = await act('detect', { text: detectText.trim() });
          if (result !== null) setDetectResult(result);
        }, [act, detectText]);

        // Un solo objeto para el cuadro de detección: `LibraryView` lo recibe por `detect` (texto y
        // resultado) y por `onDetect` (cambiar y buscar). Compartir la referencia evita que las dos
        // vistas del contrato se separen otra vez, que es lo que dejó «Biblioteca» en blanco.
        const detectState = useMemo(
          () => ({ text: detectText, result: detectResult, change: setDetectText, run: runDetect }),
          [detectText, detectResult, runDetect],
        );

        const nav = useMemo(() => {
          const pending = asArray(snapshot?.improvements).filter((entry) => entry.status === 'proposed').length;
          const externalCount = asArray(snapshot?.external?.candidates).length;
          return [
            { id: 'overview', label: t('nav.overview'), icon: 'overview' },
            { id: 'library', label: t('nav.library'), icon: 'library', count: skillsOf(snapshot).length },
            { id: 'projects', label: t('nav.projects'), icon: 'projects', count: projectsOf(snapshot).length },
            { id: 'improvements', label: t('nav.improvements'), icon: 'improvements', count: pending > 0 ? pending : null },
            { id: 'analytics', label: t('nav.analytics'), icon: 'analytics', count: externalCount > 0 ? externalCount : null },
          ];
        }, [snapshot, t]);

        if (snapshot === null) {
          return e('div', { className: 'lsc-root' },
            busy ? e('div', { className: 'lsc-busy' }) : null,
            e('div', { className: 'lsc-loading' }, error === '' ? t('app.loading') : `${error} · ${t('app.retry')}`),
            error !== '' ? e('div', { style: { position: 'absolute', bottom: 24, left: 0, right: 0, textAlign: 'center' } }, e('button', { type: 'button', className: 'lsc-btn', onClick: () => load() }, t('app.retry'))) : null,
          );
        }

        const projects = projectsOf(snapshot);
        const currentCwd = cwd !== '' ? cwd : pickCwd(snapshot);
        const currentProject = snapshot.project ?? projects.find((project) => samePath(project.cwd, currentCwd)) ?? null;
        const pickerValue = currentProject?.cwd ?? currentCwd;

        return e('div', { className: 'lsc-root' },
          busy ? e('div', { className: 'lsc-busy' }) : null,

          e('header', { className: 'lsc-header' },
            e('div', { className: 'lsc-brand' },
              e('div', { className: 'lsc-brand-mark' }, e(Icon, { size: 30 })),
              e('div', { className: 'lsc-brand-text' }, e('span', { className: 'lsc-brand-title' }, t('app.title')), e('span', { className: 'lsc-brand-sub' }, t('app.subtitle'))),
            ),
            e('div', { className: 'lsc-header-spacer' }),
            e('label', { className: 'lsc-project-picker', title: currentCwd },
              e('span', { className: 'lsc-hint' }, t('app.project')),
              e('select', {
                value: pickerValue,
                onChange: (event) => {
                  const value = event.target.value;
                  if (value === '__register__') { setView('projects'); return; }
                  selectProject(value);
                },
              },
                currentProject === null ? e('option', { value: pickerValue }, `${t('app.project')}: ${pickerValue}`) : null,
                projects.map((project) => e('option', { key: project.id, value: project.cwd }, project.name ?? project.id)),
                currentProject !== null && !projects.some((project) => project.id === currentProject.id)
                  ? e('option', { value: currentProject.cwd }, `${currentProject.name ?? currentProject.id} (${t('app.unregistered')})`)
                  : null,
              ),
            ),
            e('button', { type: 'button', className: 'lsc-btn ghost', title: t('app.refresh'), disabled: busy, onClick: () => load() }, '⟳'),
            e('button', { type: 'button', className: 'lsc-btn primary', onClick: () => setModalOpen(true) }, `+ ${t('app.new')}`),
          ),

          error !== '' ? e('div', { style: { padding: '8px 18px' } }, e('div', { className: 'lsc-banner' }, e('span', null, error), e('span', { className: 'lsc-spacer' }), e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: () => load() }, t('app.retry')))) : null,

          e('div', { className: 'lsc-body' },
            e('nav', { className: 'lsc-rail' },
              nav.map((item) => e('button', {
                key: item.id,
                type: 'button',
                className: cx('lsc-rail-item', view === item.id && 'active'),
                onClick: () => setView(item.id),
              },
                e(NavIcon, { name: item.icon }),
                e('span', { className: 'lsc-rail-label' }, item.label),
                item.count ? e('span', { className: 'lsc-rail-count' }, String(item.count)) : null,
              )),
              e('div', { className: 'lsc-rail-sep' }),
              e('div', { className: 'lsc-rail-note' }, currentProject === null ? t('app.empty') : `${currentProject.name ?? currentProject.id}`),
            ),

            e('main', { className: 'lsc-content' },
              view === 'overview' ? e(OverviewView, { t, lang, snapshot, onOpen: setDrawerId, onNavigate: setView, onImport, onDecide, busy, actionPending }) : null,
              view === 'library' ? e(LibraryView, {
                t, lang, snapshot, busy,
                onOpen: setDrawerId,
                onNew: () => setModalOpen(true),
                // `LibraryView` lee el cuadro de detección por `detect` y los manejadores por `onDetect`:
                // pasar sólo uno de los dos dejaba la vista en blanco (encontrado en la auditoría).
                detect: detectState,
                onDetect: detectState,
              }) : null,
              view === 'projects' ? e(ProjectsView, { t, snapshot, cwd, busy, onToggle, onVersion, onSync, onAdd: onAddProject, onSelect: selectProject, onOpen: setDrawerId }) : null,
              view === 'improvements' ? e(ImprovementsView, { t, lang, snapshot, onDecide, onOpen: setDrawerId, busy, actionPending }) : null,
              view === 'analytics' ? e(AnalyticsView, { t, lang, snapshot }) : null,
            ),
          ),

          drawerId !== null ? e(SkillDrawer, { t, lang, snapshot, skillId: drawerId, onClose: () => setDrawerId(null), onToggle, onVersion, onEvaluate, busy }) : null,
          modalOpen ? e(CreateModal, { t, onSubmit: onCreate, onClose: () => setModalOpen(false), busy }) : null,
          toast !== null ? e('div', { className: 'lsc-toast-wrap' }, e('div', { className: cx('lsc-toast', toast.tone) }, toast.message)) : null,
        );
      };
    }

    /* ---------------------------------------------------------------------- apply */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.id = STYLE_ID;
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => { style.remove(); };
        });

        const locale = ctx.locale ?? ctx.get?.('locale') ?? null;
        if (locale !== null && typeof locale.register === 'function') {
          ctx.effect(() => {
            const dispose = locale.register(NS, DICTIONARIES);
            return typeof dispose === 'function' ? dispose : undefined;
          });
        }

        // Icono del rail lateral: el mismo id que la clave del panel, así el botón y la vista se
        // direccionan con un solo identificador.
        ctx.slots.inject(SIDEBAR_SLOT, () => ctx.slots.register({
          name: SIDEBAR_SLOT,
          id: PANEL_ID,
          order: 30,
          label: () => translate(readLanguage(locale), 'app.title'),
          locale: NS,
        }, Icon));

        ctx.slots.inject(MAIN_SLOT, () => ctx.slots.register({
          name: MAIN_SLOT,
          key: PANEL_ID,
          order: 50,
          locale: NS,
        }, createPanel(ctx)));
      },
    };
  },
});
