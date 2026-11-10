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
        'library.import': 'Importar paquete',
        'library.import.hint': 'Pega el paquete de otro centro: entra como copia aislada y no toca la skill original.',
        'library.import.placeholder': '{ "schema": "lifecode-skill-center/skill-bundle", … }',
        'library.import.ready': 'El paquete trae la skill «{title}» v{version}.',
        'library.import.invalid': 'El paquete no se ha podido leer: {code}.',
        'library.import.done': 'Importada como «{id}»{renamed}.',
  'library.import.warn': 'Aviso: {n} referencia(s) con ruta absoluta; no son portables a otro proyecto tal cual.',
        'library.import.renamed': ' (renombrada porque el id ya existía)',
        'drawer.export': 'Exportar paquete',
        'drawer.export.done': 'Paquete escrito en {file} ({bytes} B).',
  'drawer.export.warn': 'Aviso: {n} referencia(s) con ruta absoluta; no son portables a otro proyecto tal cual.',
        'portability.title': 'Portabilidad de Skills',
        'portability.badge': 'Función avanzada',
        'portability.subtitle': 'Transfiere Skills entre instalaciones de LifeCode Skill Center de forma segura',
        'portability.help': 'Importar un paquete nunca escribe al pegarlo ni al elegirlo: primero se valida en lectura, se muestra qué trae y qué conflictos tiene, y sólo una confirmación explícita crea la copia. Exportar no modifica la biblioteca.',
        'portability.notFor': 'Esto no es Detectar ni Adoptar: Detectar busca skills existentes y Adoptar vincula un proyecto. Aquí sólo se mueven paquetes entre centros.',
        'portability.export.title': 'Exportar Skill',
        'portability.export.skill': 'Skill',
        'portability.export.skillPlaceholder': 'Elige una skill…',
        'portability.export.version': 'Versión',
        'portability.export.noVersion': 'sin versiones registradas',
        'portability.export.current': 'actual',
        'portability.export.generate': 'Generar paquete',
        'portability.export.generateHere': 'Exportar en la ficha',
        'portability.export.working': 'Generando…',
        'portability.export.failed': 'No se pudo exportar ({code}).',
        'portability.export.ready': 'Paquete listo',
        'portability.export.bytes': '{n} bytes',
        'portability.export.checksum': 'checksum {sha}',
        'portability.export.portable': 'Portable',
        'portability.export.notPortable': 'Con rutas absolutas',
        'portability.export.copy': 'Copiar JSON',
        'portability.export.copied': 'JSON copiado',
        'portability.export.download': 'Descargar .json',
        'portability.import.title': 'Importar Skill',
        'portability.import.file': 'Archivo JSON',
        'portability.import.paste': '…o pega el paquete aquí',
        'portability.import.selected': 'Archivo elegido: {name}',
        'portability.import.readFailed': 'No se pudo leer el archivo: {message}',
        'portability.import.limit': 'Máximo {size}; por encima se rechaza sin leer.',
        'portability.import.never': 'Pegar o elegir un archivo no importa nada: primero se valida en lectura.',
        'portability.validate': 'Validar paquete',
        'portability.validate.working': 'Validando…',
        'portability.revalidate': 'Volver a validar',
        'portability.preview.unnamed': 'El paquete no declara nombre',
        'portability.preview.description': 'Descripción',
        'portability.preview.origin': 'Origen',
        'portability.preview.exportedAt': 'Exportado',
        'portability.preview.from': 'Desde',
        'portability.preview.identity': 'Identidad',
        'portability.preview.bytes': 'Tamaño',
        'portability.preview.schema': 'Esquema',
        'portability.preview.supported': 'compatible',
        'portability.preview.unsupported': 'no compatible',
        'portability.preview.integrity': 'Integridad',
        'portability.preview.checksumOk': 'checksum correcto',
        'portability.preview.checksumBad': 'checksum no coincide',
        'portability.preview.portability': 'Portabilidad',
        'portability.preview.conflicts': 'Conflictos',
        'portability.preview.sameId': 'Mismo id: {id} (versión {version})',
        'portability.preview.sameId.label': 'Mismo id',
        'portability.preview.sameName': 'Mismo nombre: {names}',
        'portability.preview.already': 'Ya importada: {ids}',
        'portability.preview.noConflicts': 'Sin conflictos detectados',
        'portability.preview.plan': 'Plan',
        'portability.preview.preflight': 'Comprobación previa',
        'portability.preview.compatibility': 'Compatibilidad',
        'portability.preview.plan.create': 'Crear',
        'portability.preview.plan.copy': 'Crear copia con otro id',
        'portability.preview.plan.blocked': 'Bloqueado',
        'portability.preview.plan.unknown': 'desconocido ({value})',
        'portability.preview.decision.allow': 'Permitido',
        'portability.preview.decision.warn': 'Advertencia',
        'portability.preview.decision.block': 'Bloqueado',
        'portability.preview.decision.unknown': 'desconocido ({value})',
        'portability.severity.block': 'bloqueante',
        'portability.severity.warn': 'aviso',
        'portability.severity.info': 'informativo',
        'portability.preview.findings': 'Hallazgos',
        'portability.preview.qualityGateNote': 'La compuerta de calidad se evalúa al importar; si rechaza el contenido, no se creará ninguna copia.',
        'portability.preview.reasons': 'Motivos',
        'portability.status.valid': 'Válido',
        'portability.status.invalid-format': 'Formato no válido',
        'portability.status.evaluation-failed': 'La compuerta de calidad rechazó el contenido',
        'portability.status.unsupported-version': 'Esquema no soportado',
        'portability.status.bad-integrity': 'Integridad rota',
        'portability.status.duplicate-identity': 'Identidad duplicada',
        'portability.status.name-conflict': 'Conflicto de nombre',
        'portability.status.incomplete-provenance': 'Procedencia incompleta',
        'portability.status.already-imported': 'Ya importada',
        'portability.status.blocked': 'Bloqueado',
        'portability.status.store-unreadable': 'Almacén ilegible',
        'portability.status.too-large': 'Demasiado grande',
        'portability.detail': 'Detalle',
        'portability.noMessage': 'sin mensaje',
        'portability.notRecorded': 'no registrado',
        'portability.confirm': 'Importar una copia',
        'portability.confirm.copy': 'Crear copia con otro id',
        'portability.cancel': 'Cancelar',
        'portability.done.id': 'Importada con el id «{id}».',
        'portability.done.renamed': 'Renombrada desde «{from}» para no pisar la existente.',
        'portability.done.open': 'Abrir en Biblioteca',
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
        'projects.updates.pill': '{n} actualización',
        'projects.updates.pillMany': '{n} actualizaciones',
        'projects.updates.advance': 'Actualizar',
        'ask.title': 'Pedir a la IA',
        'ask.hint': 'Escribe qué necesitas y la IA de este proyecto lo convierte en una skill. No se activa sola: la enciendes tú.',
        'ask.placeholder': 'p. ej. necesito una comprobación de que un plugin no escribe fuera de su carpeta',
        'ask.send': 'Enviar a la IA',
        'ask.sent': 'Petición guardada. La IA la verá en su próxima consulta del centro.',
        'ask.duplicate': 'Ya había una petición igual esperando',
        'ask.pending': 'esperando a la IA',
        'ask.fulfilled': 'cumplida',
        'ask.dismissed': 'descartada',
        'ask.dismiss': 'Descartar',
        'ask.open': 'Ver skill',
        'ask.empty': 'No hay peticiones todavía.',
        'projects.updates.done': 'Proyecto sincronizado con la biblioteca.',
        'projects.updates.none': 'Ya estaba al día.',
        'projects.sync.error': 'No se pudo sincronizar: {message}',
        'projects.this': 'Estás aquí',
        'projects.open': 'Trabajar en este proyecto',
        'projects.manifest': 'Materializado en {path}',
        'projects.version': 'Versión',
        'projects.tab.discovered': 'Descubiertos',
        'projects.tab.identity': 'Identidad',
        'projects.identity.subtitle': 'Qué identidad tiene cada carpeta: registro del centro, manifiesto en disco y si se pudo verificar.',
        'projects.identity.empty': 'No hay carpetas que clasificar todavía.',
        'projects.identity.uuid': 'UUID',
        'projects.identity.availability': 'Carpeta',
        'projects.identity.verification': 'Verificación',
        'projects.identity.reasons': 'Motivos',
        'projects.identity.none': 'sin UUID',
        'projects.identity.action.adopt': 'Publicar manifiesto',
        'projects.identity.action.repair': 'Reparar manifiesto',
        'projects.identity.action.relink': 'Revincular',
        'projects.identity.action.unlink': 'Desvincular',
        'projects.identity.action.locked': 'Las acciones de identidad se activan al migrar el almacén a v3 (requiere autorización humana).',
        'projects.identity.action.done': 'Manifiesto actualizado ({branch}). Revisa la pestaña Identidad.',
        'projects.identity.action.confirmTitle': 'Confirmar acción de identidad',
        'projects.identity.action.confirm': 'Escribir manifiesto',
        'projects.identity.action.cancel': 'Cancelar',
        'projects.identity.action.dialog': 'Esta acción escribe un manifiesto en el proyecto, se registra con su identificador de operación y no toca las asignaciones.',
        'projects.identity.readonly': 'Clasificar no escribe: vincular, adoptar o mover son acciones humanas que llegan después.',
        'projects.tab.managed': 'Gestionados',
        'projects.discover.subtitle': 'DSH reconoce estos espacios de trabajo. Descubrir no registra nada: sólo se puede abrir el workspace.',
        'projects.discover.hint': 'Inventario de sólo lectura del registro de workspaces del Host.',
        'projects.discover.refresh': 'Refrescar inventario',
        'projects.discover.loading': 'Consultando el inventario…',
        'projects.discover.empty': 'El Host no devolvió ningún workspace.',
        'projects.discover.sessions': '{n} sesiones',
        'projects.discover.open': 'Abrir en DSH',
        'projects.discover.legacyProject': 'coincide con {id}',
        'projects.discover.readonly': 'Descubierto es sólo lectura: la vinculación con UUID llegará en un acto posterior.',
        'projects.discover.unavailable': 'Inventario no disponible',
        'projects.availability.ok': 'disponible',
        'projects.availability.missing': 'carpeta ausente',
        'projects.availability.unknown': 'sin verificar',
        'projects.link.discovered': 'descubierto',
        'projects.link.legacy': 'coincidencia legacy',
        'projects.link.conflict': 'conflicto',
        'projects.summary.discovered': '{n} descubiertos',
        'projects.summary.managed': '{n} gestionados',
        'projects.summary.legacy': '{n} coincidencias legacy',
        'projects.summary.without': '{n} gestionados sin workspace',
        'projects.summary.conflicts': '{n} conflictos',
        'projects.managed.unmatched': 'sin workspace de DSH',
        'projects.managed.linked': 'workspace {title}',
        'projects.dsh.unavailable': 'Este harness no ofrece abrir workspaces desde el panel.',
      'projects.tab.collisions': 'Colisiones',
      'projects.owner.title': 'Inventario global (todas las fuentes)',
      'projects.owner.count.total': '{n} skills',
      'projects.owner.pending.total': 'skills sin comprobar',
      'projects.owner.count.own': '{n} propias',
      'projects.owner.count.external': '{n} externas',
      'projects.owner.count.filesystem': '{n} en disco sin propietario',
      'projects.owner.count.host': '{n} del Host',
      'projects.owner.count.unknown': '{n} con propietario desconocido',
      'projects.owner.pending.own': 'propias: sin comprobar',
      'projects.owner.pending.external': 'externas: sin comprobar',
      'projects.owner.pending.filesystem': 'en disco: sin comprobar',
      'projects.owner.pending.host': 'del Host: sin comprobar',
      'projects.owner.pending.unknown': 'propietario desconocido: sin comprobar',
      'projects.owner.def.own': 'Skills de esta biblioteca en el inventario global. Este recuento es de skills, no de proyectos.',
      'projects.owner.def.external': 'Skills que sirve un plugin u otro proveedor, en el inventario global. Sólo lectura.',
      'projects.owner.def.filesystem': 'Skills que existen en disco pero cuyo propietario no es esta biblioteca ni un plugin: se declaran como tales, no como «desconocidas».',
      'projects.owner.def.host': 'Skills empaquetadas o servidas por el propio Host (catálogo/carga), no por un proyecto.',
      'projects.owner.def.unknown': 'Skills cuyo propietario no se puede afirmar con la evidencia disponible.',
      'projects.owner.reason.partial': 'el inventario está incompleto o una fuente no respondió',
      'projects.owner.reason.undetermined': 'el backend no publica esta categoría',
      'projects.owner.host': 'del Host',
      'projects.owner.hint': 'Estos conteos son del inventario global y no se reparten por proyecto. Las colisiones globales ({collisions}) no son «proyectos con conflicto» ({conflicts}): se consultan en la pestaña Colisiones.',
      'projects.card.skills.notRun': 'sin inspeccionar todavía: no se ejecutó ninguna inspección',
      'projects.card.skills.empty': 'inspección completa: 0 en el ámbito de este proyecto · el inventario global tiene {global}',
      'projects.card.skills.partial': 'inspección parcial: puede haber skills que no se listaron',
      'projects.card.skills.failed': 'la inspección falló: no se pudo comprobar',
      'projects.collisions.subtitle': 'Colisiones del inventario global, en sólo lectura. No se atribuyen a proyectos: el contador de conflictos por proyecto cuenta otra cosa.',
      'projects.collisions.unchecked': 'No se pudo comprobar: en este modo el backend no entrega el inventario de skills.',
      'projects.collisions.empty': 'Inventario consultado: no hay colisiones.',
      'projects.collisions.readonly': 'Sólo lectura: esta vista no borra, adopta ni reasigna nada.',
      'projects.collisions.count': '{n} de {total} colisiones',
      'projects.collisions.openSkill': 'Abrir la ficha de esta skill',
      'projects.collisions.filter.code': 'Tipo de colisión',
      'projects.collisions.filter.codeAll': 'Todos los tipos',
      'projects.collisions.filter.severity': 'Severidad',
      'projects.collisions.filter.severityAll': 'Todas las severidades',
      'projects.collisions.filter.owner': 'Propietario',
      'projects.collisions.filter.ownerAll': 'Todos los propietarios',
      'projects.collisions.filter.empty': 'Ninguna colisión coincide con los filtros.',
      'projects.collisions.severity.block': 'bloqueante',
      'projects.collisions.severity.warn': 'aviso',
      'projects.collisions.severity.info': 'informativa',
      'projects.collisions.groupCount': '{n} entradas agrupadas',
      'projects.collisions.legacyLabel': 'historia del compilador: no es un conflicto actual',
      'projects.collisions.moreRows': '… y {n} filas más (agrupadas para no repetir la lista)',
      'projects.skill.identity': 'Identidad e integridad',
      'projects.skill.identityHint': 'Sólo se muestra lo que el inventario declara.',
      'projects.skill.notRecorded': 'no registrado',
      'projects.skill.manifestSha': 'SHA del manifiesto',
      'projects.skill.ownerHint': 'Propietario, origen y confianza tal como los declara el inventario.',
      'projects.skill.ownerKind': 'Clase de propietario',
      'projects.skill.readonly': 'Skill externa o de propietario desconocido: se muestra en sólo lectura.',
      'projects.skill.host': 'Asociación con el Host',
      'projects.skill.hostHint': 'Si el cargador la sirve y con qué proveedor; el Host identifica skills por nombre y ruta.',
      'projects.skill.loadedByHost': 'Cargada por el Host',
      'projects.skill.loadedShadowed': 'sombreada por {provider}',
      'projects.skill.loadedUnknown': 'carga no determinada (el registro no lo declara)',
      'projects.skill.yes': 'sí',
      'projects.skill.no': 'no',
      'projects.skill.execution': 'Ejecución',
      'projects.skill.modelInvocable': 'invocable por el modelo',
      'projects.skill.userInvocable': 'invocable por la persona',
      'projects.skill.shadowed': 'El catálogo del Host la sirve otro proveedor con más prioridad ({provider}).',
      'projects.skill.collisions': 'Conflictos que la tocan',
      'projects.skill.collisionsHint': 'Colisiones del inventario en las que aparece esta entrada.',
      'projects.skill.collisionsNone': 'Ninguna colisión del inventario implica esta skill.',
      'projects.skill.canonical': 'Nombre canónico: {name}',
      'projects.ficha.skills.versionLabel': 'Versión',
      'projects.ficha.origin.hostIdentity': 'El Host identifica un skill por su nombre y su ruta; el UUID y la versión son de esta biblioteca, no del cargador.',

        // Handshake de compatibilidad: el modo lo decide `GET /api/capabilities`, nunca un 404 suelto.
        'projects.compat.legacy.title': 'Modo compatibilidad heredada',
        'projects.compat.legacy.body': 'Este backend no publica /api/projects ni /api/inventory; se muestra el inventario de /workspaces. Las acciones de registro, ficha, inspección y colisiones no están disponibles hasta reiniciar DSH.',
        'projects.compat.legacy.refresh': 'Refrescar en este modo sólo vuelve a leer /workspaces; las rutas nuevas no se consultan.',
        'projects.compat.incompatible.title': 'Backend incompatible',
        'projects.compat.incompatible.body': 'El cliente espera el contrato R16.2 y el backend no lo cumple. Las operaciones administrativas están detenidas para no escribir con supuestos equivocados.',
        'projects.compat.revision': 'Cliente: contrato {client} · Backend: {backend}',
        'projects.compat.unknownVersion': 'revisión desconocida',
        'projects.compat.http': 'HTTP {status}{code}',
        'projects.compat.unavailable.title': 'Backend no disponible',
        'projects.compat.unavailable.body': 'No se pudo completar el handshake de compatibilidad ({reason}). Reintenta cuando el Host responda.',
        'projects.compat.auth.title': 'Autorización pendiente',
        'projects.compat.auth.body': 'El Host rechazó la petición de compatibilidad (HTTP {status}). Revisa la autorización y reintenta.',
        'projects.compat.actions.blocked': 'Esta operación necesita el contrato R16.2 y el handshake no lo confirmó.',
        'projects.compat.copy': 'Copiar diagnóstico',
        'projects.compat.copied': 'Diagnóstico copiado al portapapeles.',
        'projects.compat.copyUnavailable': 'No se pudo copiar: el portapapeles no está disponible.',
        'projects.card.skills.unknown': 'sin comprobar (backend heredado)',
        'projects.inspection.unknown': 'no se pudo comprobar',

        // Frontera de error: si el panel lanza, el slot quedaría en blanco. La tarjeta explica el
        // fallo con el mensaje real, la primera línea del stack y el paso, y permite reintentar.
        'projects.boundary.title': 'El panel no pudo dibujarse',
        'projects.boundary.hint': 'Nada se ha modificado. Este panel se ha protegido para que el error sea visible en vez de dejar el área en blanco.',
        'projects.boundary.message': 'Mensaje',
        'projects.boundary.stack': 'Primera línea del stack',
        'projects.boundary.noStack': '(el error no trae stack)',
        'projects.boundary.step': 'Dónde falló',
        'projects.boundary.step.mount': 'montaje',
        'projects.boundary.step.render': 'render',
        'projects.boundary.retry': 'Reintentar',
        'projects.boundary.copy': 'Copiar diagnóstico',
        'projects.boundary.copied': 'Diagnóstico copiado.',
        'projects.boundary.copyUnavailable': 'Este harness no ofrece portapapeles: el diagnóstico se puede leer aquí.',
        'projects.refresh.legacy.invalid': 'El Host respondió a las rutas nuevas con algo que no es el contrato: se muestra el inventario heredado.',
        'projects.refresh.legacy.route': 'El Host todavía no publica /api/projects: se muestra el inventario heredado de /workspaces.',

        'projects.state.identity-conflict': 'conflicto de identidad',
        'projects.state.unavailable': 'no disponible',
        'projects.state.partially-inspected': 'inspección parcial',
        'projects.state.external-managed': 'gestionado externo',
        'projects.state.managed': 'gestionado',
        'projects.state.healthy': 'saludable',
        'projects.state.discovered': 'descubierto',
        'projects.state.unknown': 'estado no informado',

        'projects.op.read': 'leer',
        'projects.op.inspect': 'inspeccionar',
        'projects.op.detach-project': 'desvincular proyecto',
        'projects.op.repair-manifest': 'reparar manifiesto',
        'projects.op.adopt-project': 'adoptar proyecto',
        'projects.op.register-project': 'registrar proyecto',
        'projects.op.materialize': 'materializar',
        'projects.op.materialize-project': 'materializar',
        'projects.op.assign': 'asignar skills',
        'projects.op.rename': 'renombrar',

        'projects.inspection.complete': 'inspección completa',
        'projects.inspection.incomplete': 'inspección parcial',
        'projects.inspection.failed': 'inspección fallida',
        'projects.inspection.not-run': 'sin inspeccionar',
        'projects.inspection.reason': 'motivo: {reason}',

        'projects.chip.group': 'Filtros de proyectos',
        'projects.chip.hint': 'Pulsa un indicador para filtrar la lista. Cada proyecto se cuenta una sola vez, en una única vista normalizada.',
        'projects.chip.pending': 'sin comprobar',
        'projects.chip.pendingReason': 'sin comprobar: el inventario está incompleto o una fuente no respondió',
        'projects.chip.definition': 'Filtro activo: {definition}',
        'projects.chip.clear': 'Quitar filtro',
        'projects.chip.discovered.one': '{n} descubierto',
        'projects.chip.discovered.many': '{n} descubiertos',
        'projects.chip.discovered.def': 'Espacio de trabajo que el Host conoce y este centro todavía no ha registrado. Descubrir no crea nada.',
        'projects.chip.managed.one': '{n} gestionado',
        'projects.chip.managed.many': '{n} gestionados',
        'projects.chip.managed.def': 'Proyecto registrado en este centro, con manifiesto o adopción.',
        'projects.chip.available.one': '{n} disponible',
        'projects.chip.available.many': '{n} disponibles',
        'projects.chip.available.def': 'La carpeta del proyecto existe y se puede leer ahora mismo.',
        'projects.chip.unavailable.one': '{n} no disponible',
        'projects.chip.unavailable.many': '{n} no disponibles',
        'projects.chip.unavailable.def': 'La carpeta registrada ya no existe en disco; el proyecto sigue en el centro hasta que se repare.',
        'projects.chip.conflicts.one': '{n} con conflicto',
        'projects.chip.conflicts.many': '{n} con conflicto',
        'projects.chip.conflicts.def': 'Proyecto con conflicto de identidad propio o con colisiones atribuibles a su ámbito. No cuenta las colisiones globales del inventario.',
        'projects.chip.partial.one': '{n} con inspección parcial',
        'projects.chip.partial.many': '{n} con inspección parcial',
        'projects.chip.partial.def': 'La última inspección no pudo consultar todas las fuentes; lo que falta se dice, no se cuenta como cero.',
        'projects.chip.skills.one': '{n} con skills detectadas',
        'projects.chip.skills.many': '{n} con skills detectadas',
        'projects.chip.skills.def': 'Proyecto con al menos una skill detectada en fuentes consultables.',
        'projects.chip.own.one': '{n} con skills propias',
        'projects.chip.own.many': '{n} con skills propias',
        'projects.chip.own.def': 'Proyecto con skills de esta biblioteca.',
        'projects.chip.external.one': '{n} con skills externas',
        'projects.chip.external.many': '{n} con skills externas',
        'projects.chip.external.def': 'Proyecto con skills que sirve un plugin u otro proveedor; se muestran en sólo lectura.',
        'projects.chip.unknown.one': '{n} con skills de dueño desconocido',
        'projects.chip.unknown.many': '{n} con skills de dueño desconocido',
        'projects.chip.unknown.def': 'Proyecto con skills cuyo dueño no se puede afirmar.',
        'projects.chip.collisions.one': '{n} con colisiones',
        'projects.chip.collisions.many': '{n} con colisiones',
        'projects.chip.collisions.def': 'Proyecto con colisiones del inventario atribuibles a su ámbito. Las colisiones globales (que no se atribuyen a proyectos) se abren en la pestaña Colisiones y se cuentan aparte.',

        'projects.refresh.title': 'Refrescar inventario',
        'projects.refresh.updating': 'Actualizando…',
        'projects.refresh.loading': 'Actualizando inventario…',
        'projects.refresh.never': 'Inventario sin refrescar en esta sesión',
        'projects.refresh.success': '{workspaces} workspaces · {managed} gestionados · {changes}',
        'projects.refresh.change.one': '{n} cambio',
        'projects.refresh.change.many': '{n} cambios',
        'projects.refresh.at': 'hora {time}',
        'projects.refresh.failed': 'No se pudo refrescar',
        'projects.refresh.partial': 'Inventario parcial: el Host no pudo confirmar todas las fuentes. Lo que falta no se cuenta.',
        'projects.refresh.truncated': 'Inventario recortado por el límite de entradas: los recuentos de skills pueden ser menores que la realidad.',
        'projects.refresh.stale': 'Inventario desactualizado: la hora del Host es anterior a la última operación.',
        'projects.refresh.legacy.title': 'Inventario heredado',
        'projects.refresh.legacy': 'El Host todavía no publica /api/projects ({status}); se muestra el inventario antiguo de /workspaces. Los recuentos nuevos quedan sin comprobar.',
        'projects.refresh.legacy.state': 'Inventario heredado (sin recuentos nuevos)',
        'projects.refresh.error.projects': 'Falló la consulta de proyectos',
        'projects.refresh.error.inventory': 'Falló la consulta del inventario de skills',

        'projects.error.action': 'La operación no se completó',
        'projects.error.code': 'código: {code}',
        'projects.error.notFound': 'Ese proyecto ya no existe en el registro',
        'projects.error.unknown': 'sin detalle',

        'projects.register.blocked': 'Registro bloqueado por la prevalidación',
        'projects.register.evidence': 'No se escribió nada: la inspección no pudo completarse ({reason}).',
        'projects.register.exists': 'Ese proyecto ya está registrado',
        'projects.register.reasons': 'Motivos del servidor',
        'projects.register.findings': 'Hallazgos',
        'projects.register.sources': 'Fuentes consultadas',
        'projects.register.confirmHint': 'Al confirmar se registra este proyecto en el centro. Nada se escribe dentro del proyecto.',

        'projects.sessions.value': '{n} sesiones',
        'projects.sessions.unknown': 'sesiones: no contado',

        'projects.source.complete': 'completa',
        'projects.source.incomplete': 'incompleta',
        'projects.source.unavailable': 'no disponible',
        'projects.source.error': 'error',
        'projects.source.unknown': 'sin estado',
        'projects.source.reason': 'motivo: {reason}',

        'projects.card.path': 'ruta',
        'projects.card.identity': 'identidad',
        'projects.card.skills': 'skills detectadas',
        'projects.card.skills.none': 'ninguna en fuentes consultables',
        'projects.card.skills.values': '{total} detectadas · {own} propias · {external} externas · {unknown} desconocidas',
        'projects.card.inspection': 'inspección',
        'projects.card.inspectedAt': 'última inspección {at}',
        'projects.card.detected': 'última detección {at}',
        'projects.card.detectedUnknown': 'no informada',
        'projects.card.source': 'fuente: {source}',
        'projects.card.source.record': 'registro del centro',
        'projects.card.source.workspace': 'workspaces del Host',
        'projects.card.source.legacy': 'inventario heredado',
        'projects.card.registered': 'registrado',
        'projects.card.unmanaged': 'sin registrar',
        'projects.card.unmanagedHint': 'Descubierto no está gestionado: abrirlo o inspeccionarlo no lo registra.',
        'projects.card.conflicts': '{n} conflictos',
        'projects.card.derived': 'Este estado se deriva del inventario heredado: el Host no informa el estado nuevo.',
        'projects.card.derivedShort': 'estado derivado',
        'projects.card.uuid': 'UUID {uuid}',
        'projects.card.uuidNone': 'sin UUID',
        'projects.card.identityUnknown': 'sin comprobar (backend heredado)',
        'projects.card.projectId': 'projectId {id}',
        'projects.card.opening': 'Abriendo…',
        'projects.card.inspecting': 'Inspeccionando…',
        'projects.card.inspect': 'Inspeccionar skills',
        'projects.card.manage': 'Gestionar proyecto',
        'projects.card.detail': 'Abrir ficha',
        'projects.inspect.readonly': 'Sólo lectura: esta acción consulta, no escribe.',
        'projects.open.noWorkspace': 'Este proyecto no tiene un workspace de DSH vinculado: no hay nada que abrir.',
        'projects.open.noPanel': 'Este harness no tiene el panel de workspaces cargado: no puedo abrirlo desde aquí.',

        'projects.counts.active': '{n} activas',
        'projects.counts.assigned': '{n} asignadas',
        'projects.counts.materialized.one': '{n} entrega',
        'projects.counts.materialized.many': '{n} entregas',
        'projects.assigned.hint': 'Encender una skill la asigna a este proyecto; cambiar la versión mueve el pin.',
        'projects.empty.discovered': 'El Host no devolvió workspaces descubiertos.',
        'projects.empty.unchecked': 'No se pudo comprobar: el backend no entrega el inventario de proyectos en este modo.',
        'projects.empty.managed': 'Todavía no hay proyectos gestionados. Registra o adopta uno desde Descubiertos.',
        'projects.filter.empty': 'Ningún proyecto coincide con el filtro «{label}».',
        'projects.availability.unknownLong': 'No se pudo comprobar la disponibilidad: el Host no informa si la carpeta existe.',

        'projects.dialog.title.register': 'Registrar proyecto',
        'projects.dialog.title.manage': 'Gestionar proyecto',
        'projects.dialog.subtitle': 'Prevalidación de sólo lectura: no se escribe nada hasta que confirmes.',
        'projects.dialog.step.review': 'Revisar',
        'projects.dialog.step.confirm': 'Confirmar',
        'projects.dialog.pick': 'Workspace descubierto',
        'projects.dialog.pickPlaceholder': 'Elige un workspace…',
        'projects.dialog.pickEmpty': 'No hay workspaces descubiertos: escribe la ruta a mano.',
        'projects.dialog.path': 'Ruta del proyecto',
        'projects.dialog.pathPlaceholder': 'C:\\ruta\\del\\proyecto',
        'projects.dialog.path.canonical': 'Ruta canónica',
        'projects.dialog.name': 'Nombre',
        'projects.dialog.namePlaceholder': 'Nombre visible',
        'projects.dialog.identity': 'Identidad detectada',
        'projects.dialog.identity.workspace': 'workspace',
        'projects.dialog.identity.projectId': 'projectId',
        'projects.dialog.identity.uuid': 'UUID',
        'projects.dialog.identity.none': 'no consta',
        'projects.dialog.availability': 'Disponibilidad',
        'projects.dialog.matches': 'Coincidencias con proyectos registrados',
        'projects.dialog.matches.none': 'Ninguna coincidencia: la ruta no está registrada.',
        'projects.dialog.skills': 'Skills detectadas',
        'projects.dialog.skills.values': '{total} detectadas · {own} propias · {external} externas · {unknown} desconocidas',
        'projects.dialog.skills.unavailable': 'El inventario de skills no se pudo leer: no puedo afirmar cuántas hay.',
        'projects.dialog.conflicts': 'Conflictos',
        'projects.dialog.conflicts.none': 'Sin conflictos detectados.',
        'projects.dialog.coverage': 'Cobertura del inventario',
        'projects.dialog.coverage.complete': 'Completa: todas las fuentes respondieron.',
        'projects.dialog.coverage.partial': 'Parcial: falta al menos una fuente; lo que no se pudo comprobar no se cuenta.',
        'projects.dialog.ops': 'Operaciones',
        'projects.dialog.ops.allowed': 'Permitidas',
        'projects.dialog.ops.blocked': 'Bloqueadas',
        'projects.dialog.ops.none': 'Ninguna bloqueada.',
        'projects.dialog.ops.reason.state': 'El estado «{state}» no permite registrar.',
        'projects.dialog.ops.reason.noPath': 'Falta la ruta del proyecto.',
        'projects.dialog.ops.reason.alreadyRegistered': 'Esa ruta ya está registrada en el centro.',
        'projects.dialog.back': 'Atrás',
        'projects.dialog.cancel': 'Cancelar',
        'projects.dialog.close': 'Cerrar',
        'projects.dialog.continue': 'Revisar y continuar',
        'projects.dialog.confirm': 'Registrar proyecto',
        'projects.dialog.confirming': 'Registrando…',
        'projects.dialog.confirmSummary': 'Qué se va a registrar',

        'projects.ficha.title': 'Ficha del proyecto',
        'projects.ficha.inspectTitle': 'Inspección del proyecto',
        'projects.ficha.close': 'Cerrar',
        'projects.ficha.loading': 'Cargando la ficha…',
        'projects.ficha.summaryOnly': 'Sólo hay resumen: el detalle no se pudo cargar.',
        'projects.ficha.summary': 'Resumen',
        'projects.ficha.sessions': 'Sesiones',
        'projects.ficha.sessions.hint': '{source}. El Host no da un total exacto por proyecto; «cd» dentro de una sesión puede desviarlo.',
        'projects.ficha.sessionSource.workspace': 'El conteo sale del registro de workspaces',
        'projects.ficha.sessionSource.persistence': 'El conteo sale de la persistencia de sesiones',
        'projects.ficha.sessionSource.none': 'El Host no informa sesiones de este proyecto',
        'projects.ficha.skills': 'Skills asociadas',
        'projects.ficha.skills.own': 'propia',
        'projects.ficha.skills.external': 'externa',
        'projects.ficha.skills.unknownOwner': 'dueño desconocido',
        'projects.ficha.skills.ownCount': '{n} propias',
        'projects.ficha.skills.externalCount': '{n} externas',
        'projects.ficha.skills.unknownCount': '{n} desconocidas',
        'projects.ficha.skills.globalCount': '{n} globales',
        'projects.ficha.skills.localCount': '{n} locales',
        'projects.ficha.skills.legacyCount': '{n} legacy',
        'projects.ficha.skills.disabledCount': '{n} asignadas deshabilitadas',
        'projects.ficha.skills.conflictsCount': '{n} con conflictos',
        'projects.ficha.skills.assignedCount': '{n} asignaciones',
        'projects.ficha.skills.enabled': 'encendida',
        'projects.ficha.skills.disabled': 'apagada',
        'projects.ficha.skills.version': 'versión {version}',
        'projects.ficha.skills.provider': 'proveedor {provider}',
        'projects.ficha.skills.shadowed': 'sombreada',
        'projects.ficha.skills.readonly': 'Las skills externas y ambiguas se muestran en sólo lectura: no puedo asignarlas desde aquí.',
        'projects.ficha.skills.unavailable': 'El inventario de skills no se pudo leer: no puedo afirmar qué hay detectado.',
        'projects.ficha.skills.noneInSource': 'No se detectaron skills en las fuentes consultables.',
        'projects.ficha.skills.partial': 'La inspección fue parcial: puede haber skills que no se pudieron consultar.',
        'projects.ficha.origin': 'Origen y propiedad',
        'projects.ficha.origin.owner': 'Dueño',
        'projects.ficha.origin.provider': 'Proveedor',
        'projects.ficha.origin.origin': 'Origen',
        'projects.ficha.origin.location': 'Ubicación',
        'projects.ficha.origin.scope': 'Ámbito',
        'projects.ficha.origin.confidence': 'Confianza',
        'projects.ficha.origin.reasons': 'Motivos',
        'projects.ficha.origin.none': 'no consta',
        'projects.ficha.origin.noProvider': 'el registro no publica proveedor',
        'projects.ficha.origin.noProviders': 'El registro de skills no publica la lista de proveedores; sólo puedo decir qué proveedor sirve cada nombre que el Host carga.',
        'projects.ficha.origin.unmapped': 'El dueño del skill es el proveedor «{provider}». No puedo afirmar de qué plugin instalado viene sin una tabla de equivalencias.',
        'projects.ficha.origin.empty': 'Sin skills detectadas: no hay origen que mostrar.',
        'projects.ficha.conflicts': 'Conflictos',
        'projects.ficha.conflicts.none': 'Sin conflictos detectados.',
        'projects.ficha.conflicts.rows': '{n} filas implicadas',
        'projects.ficha.activity': 'Actividad e historial',
        'projects.ficha.activity.empty': 'El snapshot actual no trae actividad de este proyecto.',
        'projects.ficha.activity.event': 'evento',
        'projects.ficha.identity': 'Identidad y vinculación',
        'projects.ficha.identity.projectId': 'projectId',
        'projects.ficha.identity.uuid': 'UUID',
        'projects.ficha.identity.uuidNone': 'sin UUID',
        'projects.ficha.identity.sha': 'sha del manifiesto',
        'projects.ficha.identity.workspace': 'workspace',
        'projects.ficha.identity.workspaceNone': 'sin workspace',
        'projects.ficha.identity.state': 'Verificación',
        'projects.ficha.identity.stateUnknown': 'sin verificar',
        'projects.ficha.identity.none': 'no consta',
        'projects.ficha.identity.allowed': 'Permitidas: {ops}',
        'projects.ficha.identity.blocked': 'Bloqueadas: {ops}',
        'projects.ficha.identity.noBlocked': 'Ninguna operación bloqueada.',

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

                'analytics.filter.days': 'Ventana: {n} días',
        'analytics.filter.from': 'Desde',
        'analytics.filter.to': 'Hasta',
        'analytics.filter.anySkill': 'Cualquier skill',
        'analytics.filter.anyType': 'Cualquier evento',
        'analytics.filter.clear': 'Quitar filtros',
        'analytics.filter.range': 'Del {from} al {to} · {n} evento(s) dentro del filtro.',
        'analytics.pins': 'Pins por detrás de la vigente',
        'analytics.pins.on': 'encendida',
        'analytics.pins.off': 'apagada',
        'analytics.pins.empty': 'Ningún proyecto va por detrás: todos los pins apuntan a la versión vigente.',
        'analytics.projects': 'Comparación de proyectos',
        'analytics.projects.hint': 'Lo que cada proyecto tiene encendido, apagado y entregado al catálogo.',
        'analytics.projects.detail': '{active} encendidas · {paused} apagadas · {loads} entrega(s) al catálogo',
        'analytics.projects.empty': 'Sin proyectos con asignaciones todavía.',
        'analytics.qualityPerVersion': 'Calidad por versión',
        'analytics.qualityPerVersion.empty': 'Sin versiones evaluadas todavía.',
        'analytics.references': 'Referencias entre versiones',
        'analytics.references.detail': '{added} añadidas · {removed} quitadas · {modified} cambiadas',
        'analytics.references.empty': 'Ninguna versión cambió sus referencias.',
        'activity.hint': 'Pulsa un día para ver los eventos que lo forman.',
        'activity.pick': 'ver eventos de este día',
        'analytics.events': 'Eventos del rango',
        'analytics.events.hint': 'Lo que el diario guardó en las fechas y filtros elegidos. Pulsa un día del gráfico para acotarlo.',
        'analytics.events.empty': 'Ningún evento cae en este rango con estos filtros.',
        'analytics.events.truncated': 'Se muestran los más recientes; el rango tiene más eventos.',
        'analytics.filter.anyStatus': 'Cualquier estado',
        'analytics.filter.anyResult': 'Cualquier resultado',
        'analytics.filter.status.pending': 'pendiente',
        'analytics.filter.status.approved': 'aprobada',
        'analytics.filter.status.rejected': 'rechazada',
        'analytics.filter.status.applied': 'aplicada',
        'analytics.filter.status.other': 'otro',
        'analytics.filter.result.ok': 'salió bien',
        'analytics.filter.result.failed': 'falló',
        'analytics.filter.result.info': 'informativo',
        'analytics.rollbacks': 'Reversiones de pin',
        'analytics.rollbacks.total': 'Reversiones registradas',
        'analytics.rollbacks.latest': 'Última: {at}',
        'analytics.rollbacks.empty': 'Ninguna asignación se ha revertido todavía.',
        'toast.duplicates': 'La biblioteca ya tiene algo parecido: {list} (aviso {n}). Revísalo antes de seguir.',
        'analytics.least': 'Skills menos utilizadas',
        'analytics.least.hint': '{projects} proyecto(s) la tienen encendida · {loads} entrega(s) al catálogo',
        'analytics.applications': 'Aplicaciones declaradas',
    'analytics.applications.declared': 'Apliqué la skill (por una persona o el agente)',
    'analytics.applications.withoutDeclaration': '{n} entrega(s) del catálogo sin declaración de uso',
    'analytics.applications.empty': 'Sin entregas ni declaraciones todavía.',
    'analytics.definitions': 'Cada bloque declara qué mide. {n} skill(s) en la biblioteca y {events} evento(s) dentro del filtro.',
        'analytics.knowledge': 'Bandeja de conocimiento',
        'analytics.knowledge.hint': 'Lo que descubrieron los agentes, con su evidencia. Un hallazgo no decide nada: el motor de decisiones o una persona lo usan.',
        'analytics.knowledge.unreadable': 'El registro de conocimiento no se puede leer; no se muestran cifras.',
        'analytics.knowledge.mode': 'Modo de autonomía: {mode}',
        'analytics.knowledge.policy': 'Política por proyecto',
        'analytics.knowledge.policy.hint': 'Qué puede decidir la IA en cada proyecto lo fija una persona; la IA nunca se concede autonomía.',
        'analytics.knowledge.policy.autonomous': 'Autónoma',
        'analytics.knowledge.policy.human': 'Requiere persona',
        'analytics.knowledge.policy.empty': 'No hay proyectos registrados todavía.',
        'analytics.knowledge.policy.done': 'Política de {project} actualizada a {mode}.',
  'analytics.knowledge.origin.verified': 'origen verificado por el host',
  'analytics.knowledge.origin.declared': 'origen declarado (sin verificar)',
  'analytics.knowledge.origin.verify': 'Verificar origen',
  'analytics.knowledge.origin.done': 'Origen del hallazgo verificado por el host.',
  'analytics.knowledge.origin.notDeclared': 'El hallazgo no declara la sesión que lo produjo: no hay nada que verificar.',
  'analytics.knowledge.origin.notVerified': 'El host no reconoce ese origen: el hallazgo sigue siendo una declaración.',
  'analytics.knowledge.origin.failed': 'No se pudo verificar el origen: {code}.',
  'analytics.knowledge.settled.ok': 'ejecutada',
  'analytics.knowledge.settled.failed': 'fallida: {detail}',
  'analytics.knowledge.settled.pending': 'autorizada, sin resultado',
  'analytics.knowledge.evidence': 'evidencia {level}',
  'analytics.knowledge.actedOn': 'cerrado con {operation}',
        'analytics.knowledge.pending': '{n} hallazgo(s) esperando triaje',
        'analytics.knowledge.inbox': 'Hallazgos',
        'analytics.knowledge.empty': 'Sin hallazgos registrados.',
        'analytics.knowledge.confidence': 'evidencia',
        'analytics.knowledge.pendingSettlements': 'Decisiones autorizadas sin resultado',
        'analytics.knowledge.pendingSettlements.hint': 'Si una ejecución se interrumpió, aquí queda el rastro para recuperarla: no se borra ni se reescribe.',
        'analytics.knowledge.pendingSettlements.empty': 'Todas las decisiones autorizadas tienen su resultado.',
        'analytics.knowledge.decisions': 'Decisiones registradas',
        'analytics.knowledge.decisions.empty': 'Sin decisiones registradas.',
        'analytics.knowledge.contradictions': 'Contradicciones',
        'analytics.knowledge.contradictions.empty': 'Sin contradicciones.',
        'analytics.filter.all': 'Todos los proyectos',
        'analytics.filter.hint': 'Filtrar no cambia ninguna cifra guardada: sólo acota lo que se resume.',
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
        'analytics.adoption': 'Adopción por proyecto',
        'analytics.adoption.skill': 'Skill',
        'analytics.adoption.hint': 'Dónde está cada skill y con qué versión la tiene fijada cada proyecto. Leer no cambia nada.',
        'analytics.adoption.off': 'apagada',
        'analytics.adoption.empty': 'Hace falta al menos una skill y un proyecto registrado para ver la matriz.',
        'analytics.adoption.legend': 'Punto: el proyecto no tiene esa skill. Apagada: la tiene desactivada. Un número es la versión fijada; en ámbar si va por detrás de la vigente.',
        'analytics.diag.store': 'Centro',
        'analytics.diag.materialized': 'Vista materializada',
        'analytics.diag.exists': 'Existe',
        'analytics.diag.missing': 'Aún no existe',
        'analytics.diag.version': 'API',
        'analytics.diag.schema': 'Esquema',
        'analytics.diag.backup': 'Copia',
        'analytics.diag.backupYes': 'verificada',
        'analytics.diag.backupNo': 'sin crear',
        'analytics.diag.backupUnverified': 'no verificable',
        'analytics.diag.backupLegacy': 'copia antigua sin publicar',
        'analytics.diag.backupGeneration': 'Generación',
        'analytics.diag.backupReason': 'Motivo',
        'analytics.diag.backupSize': 'Tamaño',
        'analytics.diag.backupSha': 'SHA-256',
        'analytics.doctor': 'Comprobación del producto',
        'analytics.doctor.hint': 'Lo que este centro comprueba de sí mismo. Sólo se lee: nada de esto cambia el almacén.',
        'analytics.doctor.ok': 'correcto',
        'analytics.doctor.warn': 'aviso',
        'analytics.doctor.fail': 'fallo',
        'analytics.doctor.error': 'No se pudo completar la comprobación.',
        'analytics.doctor.run': 'Volver a comprobar',
        'analytics.doctor.resync': 'Resincronizar vista',
  'analytics.export': 'Exportar informe',
  'analytics.export.done': 'Informe escrito en {file} ({bytes} B).',
  'analytics.export.failed': 'No se pudo exportar el informe',
        'analytics.doctor.resynced': 'Vista materializada resincronizada.',
        'analytics.diag.error': 'Último error del almacén: {message}',
        'schema.title': 'Administración del esquema',
        'schema.current': 'Esquema actual',
        'schema.target': 'Esquema de destino',
        'schema.integrity': 'Integridad del almacén',
        'schema.integrity.ok': 'correcta',
        'schema.integrity.bad': 'dañado: no se migra',
        'schema.backup': 'Copia autoritativa',
        'schema.entities': 'Entidades',
        'schema.entitiesValue': '{skills} skills · {versions} versiones · {projects} proyectos · {assignments} asignaciones · {improvements} mejoras · {events} eventos',
        'schema.state': 'Estado de la migración',
        'schema.state.ready': 'lista para migrar',
        'schema.state.done': 'migrada a v{schema}{date}',
        'schema.state.blocked': 'no disponible',
        'schema.action': 'Migrar esquema v1 → v2',
        'schema.busy': 'Migrando…',
        'schema.hint': 'Sólo una persona desde este panel puede migrar el almacén. La interfaz no ejecuta nada hasta que confirmes.',
        'schema.blocker.store-unreadable': 'el almacén está dañado: consérvalo y restaura una copia antes de migrar',
        'schema.blocker.future-version': 'el documento es más nuevo que este código: no se degrada',
        'schema.blocker.already-migrated': 'ya está en la versión de esquema de este código',
        'schema.blocker.backup-required': 'no hay una copia autoritativa verificable: sin punto de vuelta no se migra',
        'schema.blocker.backup-stale': 'la copia no coincide con el documento actual: crea una nueva antes de migrar',
        'schema.blocker.store-busy': 'hay otro escritor trabajando en el almacén: espera y vuelve a consultar',
        'schema.result.ok': 'Migración completada y verificada: las entidades y los pins se conservan.',
        'schema.result.kept': 'entidades antes: {before} · después: {after}',
        'schema.result.failed': 'La migración no se completó ({code}): {message}',
        'schema.dialog.title': 'Migrar el almacén a v2',
        'schema.dialog.lead': 'Vas a modificar el almacén productivo de LifeCode Skill Center. Esto no se puede deshacer sin restaurar la copia.',
        'schema.dialog.writes': 'Se escribirá `center.json` con el esquema v2 (una sola vez).',
        'schema.dialog.backup': 'Antes se creará una generación de copia nueva con motivo «migration»; la generación v1 actual se conserva para volver atrás.',
        'schema.dialog.adds': 'Se añadirán `schemaMeta` y `pinnedAt` (derivado de la fecha de cada asignación).',
        'schema.dialog.keeps': 'Skills, versiones, referencias, proyectos, asignaciones, pins, mejoras y eventos deben conservarse exactamente.',
        'schema.dialog.rollback': 'Si algo falla, el panel dice el código y no afirma éxito; la copia verificada queda para restaurar.',
        'schema.dialog.cancel': 'Cancelar',
        'schema.dialog.confirm': 'Confirmar migración',

        'drawer.close': 'Cerrar',
        'drawer.description': 'Para qué sirve',
        'drawer.when': 'Cuándo usarla',
        'drawer.body': 'Contenido de la versión {version}',
        'drawer.references': 'Referencias',
                'drawer.history': 'Historial y métricas',
        'drawer.history.empty': 'El diario no tiene eventos de esta skill.',
        'drawer.history.error': 'No se pudo leer el detalle.',
        'drawer.history.versions': 'versiones',
        'drawer.history.active': 'proyectos activos',
        'drawer.history.loads': 'ofertas del catálogo',
        'drawer.history.delta': 'calidad',
        'drawer.versions': 'Versiones',
        'drawer.use': 'Usar aquí',
        'drawer.diff': 'Comparar con la vigente',
        'drawer.diff.title': 'Diferencias frente a la vigente',
        'drawer.diff.none': 'Sin diferencias en el texto.',
        'drawer.diff.truncated': 'Texto muy largo: se muestra el recuento, no las líneas.',
        'drawer.diff.error': 'No se pudo comparar.',
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
        'toast.migrated': 'Esquema migrado y verificado.',
        'toast.published': 'Versión publicada.',
        'toast.forked': 'Skill derivada.',
        'toast.project': 'Proyecto registrado.',
        'toast.version': 'Versión del proyecto actualizada.',
        'toast.blocked': 'No se puede desde la IA: {message}',
        'integrity.title': 'Centro ilegible',
        'integrity.body': 'El archivo del centro no se puede leer, así que no hay biblioteca que mostrar. Los datos originales están preservados: este panel no ha escrito nada encima.',
        'integrity.future': 'El archivo lo escribió una versión más nueva de este centro. Se deja intacto: esta versión no lo migra ni lo degrada.',
        'integrity.invalid': 'El archivo es JSON válido pero no tiene la forma de un almacén de este centro.',
        'integrity.size': 'Tamaño',
        'integrity.hash': 'SHA-256',
        'integrity.diag': 'Diagnóstico',
        'integrity.restore': 'La restauración es humana y explícita: elige un archivo de copia, se comprueba su hash y el original dañado se conserva antes de instalar nada.',
        'integrity.restorePath': 'Ruta del archivo de copia',
        'integrity.restoreHash': 'SHA-256 esperado (opcional)',
        'integrity.restoreGo': 'Restaurar',
        'integrity.restored': 'Centro restaurado desde {file}',
        'integrity.preserved': 'El original quedó preservado en {file}',
        'toast.failed': 'No se pudo completar: {message}',
        'toast.close': 'Cerrar aviso',
        'activityFeed.title': 'Actividad de LifeCode',
        'activity.subtitle': 'Conocimiento creado, mejorado y conservado.',
        'activity.button.title': 'Ver la actividad del centro',
        'activity.button.unread': 'Actividad: {n} sin leer',
        'activity.button.unread.dot': 'Actividad: puede haber novedades sin leer',
        'activity.close': 'Cerrar actividad',
        'activity.refresh': 'Actualizar',
        'activity.refreshing': 'Actualizando…',
        'activity.loadMore': 'Cargar más',
        'activity.filters': 'Filtrar actividad',
        'activity.filter.all': 'Todo',
        'activity.filter.create': 'Creaciones',
        'activity.filter.update': 'Actualizaciones',
        'activity.filter.improvement': 'Self-improvement',
        'activity.filter.references': 'Referencias',
        'activity.filter.alert': 'Alertas',
        'activity.category.create': 'Creación',
        'activity.category.update': 'Actualización',
        'activity.category.improvement': 'Mejora del propio centro',
        'activity.category.references': 'Cambio de referencias',
        'activity.category.alert': 'Alerta',
        'activity.valueUnknown': 'sin dato',
        'activity.title.skill-created': 'Skill «{skill}» creada',
        'activity.title.skill-imported': 'Skill «{skill}» importada',
        'activity.title.skill-updated': 'Skill «{skill}» actualizada',
        'activity.title.skill-assigned': 'Skill «{skill}» asignada',
        'activity.title.skill-unassigned': 'Skill «{skill}» desasignada',
        'activity.title.skill-advanced': 'Skill «{skill}» avanzada de versión',
        'activity.title.skill-requested': 'Petición de Skill registrada',
        'activity.title.skill-request-fulfilled': 'Petición de Skill atendida',
        'activity.title.skill-request-dismissed': 'Petición de Skill descartada',
        'activity.title.policy-changed': 'Política de autonomía actualizada',
        'activity.title.decision-recorded': 'Decisión registrada',
        'activity.title.insight-received': 'Conocimiento recibido',
        'activity.title.insight-origin-verified': 'Origen del conocimiento verificado',
        'activity.title.skill-version-saved': 'Guardada la versión {version} de «{skill}»',
        'activity.title.improvement-prepared': 'Mejora preparada para «{skill}»',
        'activity.title.improvement-proposed': 'Mejora propuesta para «{skill}»',
        'activity.title.self-improvement-completed': 'Self-improvement completado: {change}',
        'activity.title.knowledge-incorporated': 'Conocimiento incorporado a «{skill}»',
        'activity.title.knowledge-detected': 'Conocimiento detectado en «{project}»',
        'activity.title.change-detected': 'Cambio detectado en {origin}',
        'activity.title.improvement-rejected': 'Mejora rechazada para «{skill}»',
        'activity.title.change-reverted': 'Cambio revertido en «{skill}»',
        'activity.title.project-linked': 'Proyecto «{project}» vinculado',
        'activity.title.project-detached': 'Proyecto «{project}» desvinculado',
        'activity.title.inspection-finished': 'Inspección terminada en «{project}»',
        'activity.title.approval-pending': 'Pendiente de aprobación: «{skill}»',
        'activity.title.identity-conflict': 'Conflicto de identidad en «{skill}»',
        'activity.title.references-unverified': 'Referencias de «{skill}» sin verificar',
        'activity.title.source-unavailable': 'Fuente no disponible: {origin}',
        'activity.title.write-rejected': 'Escritura rechazada en «{skill}»',
        'activity.title.evaluation-blocking': 'La compuerta de calidad bloqueó «{skill}»',
        'activity.title.conflict-blocking': 'Conflicto bloqueante en «{skill}»',
        'activity.title.persistence-failed': 'No se pudo conservar el cambio de «{skill}»',
        'activity.group.now': 'Ahora',
        'activity.group.today': 'Hoy',
        'activity.group.earlier': 'Días anteriores',
        'activity.loading': 'Leyendo la actividad…',
        'activityFeed.empty': 'Todavía no hay actividad registrada.',
        'activity.filter.empty': 'Ninguna entrada coincide con este filtro.',
        'activity.error': 'No se pudo leer la actividad: {message}',
        'activity.error.invalid': 'el registro de actividad no tiene la forma esperada',
        'activity.retry': 'Reintentar',
        'activity.connected': 'Centro disponible',
        'activity.connected.partial': 'Centro disponible con avisos: {sources}',
        'activity.channel.unavailable': 'Avisos externos no disponibles: el Host no expone un canal de notificación; la actividad se muestra dentro del panel.',
        'activity.disconnected': 'Sin conexión con el centro',
        'activity.connected.label': 'Conectado',
        'activity.indicator.connected': 'Conectado',
        'activity.indicator.working': 'Trabajando…',
        'activity.indicator.saving': 'Guardando…',
        'activity.indicator.pending': 'Pendiente de aprobación ({n})',
        'activity.indicator.last': 'Última actividad: {time}',
        'activity.indicator.unknown': 'Estado no disponible',
        'activity.outcome.ok': 'Aplicado',
        'activity.outcome.info': 'Informativo',
        'activity.notPersisted': 'no conservado',
        'activity.partial.sources': 'una fuente no es legible',
        'activity.partial': 'Parte de la actividad no está disponible ({sources}). El resto se muestra igual.',
        'activity.seen.scope': 'Las marcas de leído se guardan sólo en este navegador.',
        'activity.outcome.pending': 'Pendiente de aprobación',
        'activity.outcome.failed': 'Falló',
        'activity.row.result': 'Resultado',
        'activity.row.actor': 'Actor',
        'activity.row.origin': 'Origen',
        'activity.row.source': 'Fuente',
        'activity.row.confidence': 'Confianza',
        'activity.row.actorEvidence': 'Evidencia del actor',
        'activity.row.correlation': 'Correlación',
        'activity.row.code': 'Código',
        'activity.row.version': 'Versión',
        'activity.row.references': 'Referencias',
        'activity.refs.added': '{n} añadidas',
        'activity.refs.updated': '{n} actualizadas',
        'activity.refs.removed': '{n} retiradas',
        'activity.action.skill': 'Abrir detalle',
        'activity.action.project': 'Revisar',
        'activity.action.diff': 'Ver diferencias',
        'activity.time.now': 'Ahora',
        'activity.time.minute.one': 'Hace {n} min',
        'activity.time.minute.many': 'Hace {n} min',
        'activity.time.hour.one': 'Hace {n} h',
        'activity.time.hour.many': 'Hace {n} h',
        'activity.time.unknown': 'hora no registrada',
        'activity.toast.title': 'Actividad registrada',
        'activity.toast.failed': 'No se pudo completar la operación',
        'activity.toast.blocked': 'Operación bloqueada',
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
        'library.import': 'Import bundle',
        'library.import.hint': 'Paste a bundle from another center: it lands as an isolated copy and never touches the original skill.',
        'library.import.placeholder': '{ "schema": "lifecode-skill-center/skill-bundle", … }',
        'library.import.ready': 'The bundle carries the skill «{title}» v{version}.',
        'library.import.invalid': 'The bundle could not be read: {code}.',
        'library.import.done': 'Imported as «{id}»{renamed}.',
  'library.import.warn': 'Warning: {n} reference(s) with an absolute path; not portable to another project as they are.',
        'library.import.renamed': ' (renamed because the id already existed)',
        'drawer.export': 'Export bundle',
        'drawer.export.done': 'Bundle written to {file} ({bytes} B).',
  'drawer.export.warn': 'Warning: {n} reference(s) with an absolute path; not portable to another project as they are.',
        'portability.title': 'Skill portability',
        'portability.badge': 'Advanced feature',
        'portability.subtitle': 'Move Skills between LifeCode Skill Center installations safely',
        'portability.help': 'Importing a bundle never writes when you paste it or pick the file: it is validated read-only first, showing what it contains and which conflicts it has, and only an explicit confirmation creates the copy. Exporting does not modify the library.',
        'portability.notFor': 'This is neither Detect nor Adopt: Detect looks for existing skills and Adopt links a project. Here only bundles move between centers.',
        'portability.export.title': 'Export Skill',
        'portability.export.skill': 'Skill',
        'portability.export.skillPlaceholder': 'Pick a skill…',
        'portability.export.version': 'Version',
        'portability.export.noVersion': 'no recorded versions',
        'portability.export.current': 'current',
        'portability.export.generate': 'Generate bundle',
        'portability.export.generateHere': 'Export from the detail',
        'portability.export.working': 'Generating…',
        'portability.export.failed': 'Could not export ({code}).',
        'portability.export.ready': 'Bundle ready',
        'portability.export.bytes': '{n} bytes',
        'portability.export.checksum': 'checksum {sha}',
        'portability.export.portable': 'Portable',
        'portability.export.notPortable': 'With absolute paths',
        'portability.export.copy': 'Copy JSON',
        'portability.export.copied': 'JSON copied',
        'portability.export.download': 'Download .json',
        'portability.import.title': 'Import Skill',
        'portability.import.file': 'JSON file',
        'portability.import.paste': '…or paste the bundle here',
        'portability.import.selected': 'Selected file: {name}',
        'portability.import.readFailed': 'Could not read the file: {message}',
        'portability.import.limit': 'Up to {size}; anything larger is rejected unread.',
        'portability.import.never': 'Pasting or picking a file imports nothing: it is validated read-only first.',
        'portability.validate': 'Validate bundle',
        'portability.validate.working': 'Validating…',
        'portability.revalidate': 'Validate again',
        'portability.preview.unnamed': 'The bundle declares no name',
        'portability.preview.description': 'Description',
        'portability.preview.origin': 'Origin',
        'portability.preview.exportedAt': 'Exported',
        'portability.preview.from': 'From',
        'portability.preview.identity': 'Identity',
        'portability.preview.bytes': 'Size',
        'portability.preview.schema': 'Schema',
        'portability.preview.supported': 'supported',
        'portability.preview.unsupported': 'unsupported',
        'portability.preview.integrity': 'Integrity',
        'portability.preview.checksumOk': 'checksum matches',
        'portability.preview.checksumBad': 'checksum mismatch',
        'portability.preview.portability': 'Portability',
        'portability.preview.conflicts': 'Conflicts',
        'portability.preview.sameId': 'Same id: {id} (version {version})',
        'portability.preview.sameId.label': 'Same id',
        'portability.preview.sameName': 'Same name: {names}',
        'portability.preview.already': 'Already imported: {ids}',
        'portability.preview.noConflicts': 'No conflicts detected',
        'portability.preview.plan': 'Plan',
        'portability.preview.preflight': 'Preflight',
        'portability.preview.compatibility': 'Compatibility',
        'portability.preview.plan.create': 'Create',
        'portability.preview.plan.copy': 'Create a copy with a different id',
        'portability.preview.plan.blocked': 'Blocked',
        'portability.preview.plan.unknown': 'unknown ({value})',
        'portability.preview.decision.allow': 'Allowed',
        'portability.preview.decision.warn': 'Warning',
        'portability.preview.decision.block': 'Blocked',
        'portability.preview.decision.unknown': 'unknown ({value})',
        'portability.severity.block': 'blocking',
        'portability.severity.warn': 'warning',
        'portability.severity.info': 'informational',
        'portability.preview.findings': 'Findings',
        'portability.preview.qualityGateNote': 'The quality gate is evaluated during import; if it rejects the content, no copy is created.',
        'portability.preview.reasons': 'Reasons',
        'portability.status.valid': 'Valid',
        'portability.status.invalid-format': 'Invalid format',
        'portability.status.evaluation-failed': 'The quality gate rejected the content',
        'portability.status.unsupported-version': 'Unsupported schema',
        'portability.status.bad-integrity': 'Broken integrity',
        'portability.status.duplicate-identity': 'Duplicate identity',
        'portability.status.name-conflict': 'Name conflict',
        'portability.status.incomplete-provenance': 'Incomplete provenance',
        'portability.status.already-imported': 'Already imported',
        'portability.status.blocked': 'Blocked',
        'portability.status.store-unreadable': 'Unreadable store',
        'portability.status.too-large': 'Too large',
        'portability.detail': 'Detail',
        'portability.noMessage': 'no message',
        'portability.notRecorded': 'not recorded',
        'portability.confirm': 'Import a copy',
        'portability.confirm.copy': 'Create a copy with another id',
        'portability.cancel': 'Cancel',
        'portability.done.id': 'Imported with id «{id}».',
        'portability.done.renamed': 'Renamed from «{from}» so the existing one is not overwritten.',
        'portability.done.open': 'Open in Library',
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
        'projects.updates.pill': '{n} update',
        'projects.updates.pillMany': '{n} updates',
        'projects.updates.advance': 'Update',
        'ask.title': 'Ask the AI',
        'ask.hint': 'Write what you need and the AI of this project turns it into a skill. It is not enabled by itself: you switch it on.',
        'ask.placeholder': 'e.g. I need a check that a plugin does not write outside its folder',
        'ask.send': 'Send to the AI',
        'ask.sent': 'Request saved. The AI will see it on its next read of the center.',
        'ask.duplicate': 'An identical request was already waiting',
        'ask.pending': 'waiting for the AI',
        'ask.fulfilled': 'fulfilled',
        'ask.dismissed': 'dismissed',
        'ask.dismiss': 'Dismiss',
        'ask.open': 'Open skill',
        'ask.empty': 'No requests yet.',
        'projects.updates.done': 'Project synced with the library.',
        'projects.updates.none': 'Already up to date.',
        'projects.sync.error': 'Could not sync: {message}',
        'projects.this': 'You are here',
        'projects.open': 'Work on this project',
        'projects.manifest': 'Materialized at {path}',
        'projects.version': 'Version',
        'projects.tab.discovered': 'Discovered',
        'projects.tab.identity': 'Identity',
        'projects.identity.subtitle': 'What identity each folder has: centre record, manifest on disk and whether it could be verified.',
        'projects.identity.empty': 'No folders to classify yet.',
        'projects.identity.uuid': 'UUID',
        'projects.identity.availability': 'Folder',
        'projects.identity.verification': 'Verification',
        'projects.identity.reasons': 'Reasons',
        'projects.identity.none': 'no UUID',
        'projects.identity.action.adopt': 'Publish manifest',
        'projects.identity.action.repair': 'Repair manifest',
        'projects.identity.action.relink': 'Relink',
        'projects.identity.action.unlink': 'Unlink',
        'projects.identity.action.locked': 'Identity actions unlock after migrating the store to v3 (needs human authorization).',
        'projects.identity.action.done': 'Manifest updated ({branch}). Check the Identity tab.',
        'projects.identity.action.confirmTitle': 'Confirm identity action',
        'projects.identity.action.confirm': 'Write manifest',
        'projects.identity.action.cancel': 'Cancel',
        'projects.identity.action.dialog': 'This action writes a manifest into the project, records its operation id and does not touch assignments.',
        'projects.identity.readonly': 'Classifying writes nothing: linking, adopting or moving are human actions that come later.',
        'projects.tab.managed': 'Managed',
        'projects.discover.subtitle': 'DSH knows these workspaces. Discovering registers nothing: the workspace can only be opened.',
        'projects.discover.hint': 'Read-only inventory of the Host workspace registry.',
        'projects.discover.refresh': 'Refresh inventory',
        'projects.discover.loading': 'Reading the inventory…',
        'projects.discover.empty': 'The Host returned no workspaces.',
        'projects.discover.sessions': '{n} sessions',
        'projects.discover.open': 'Open in DSH',
        'projects.discover.legacyProject': 'matches {id}',
        'projects.discover.readonly': 'Discovered is read-only: UUID linking arrives in a later act.',
        'projects.discover.unavailable': 'Inventory unavailable',
        'projects.availability.ok': 'available',
        'projects.availability.missing': 'folder missing',
        'projects.availability.unknown': 'unverified',
        'projects.link.discovered': 'discovered',
        'projects.link.legacy': 'legacy match',
        'projects.link.conflict': 'conflict',
        'projects.summary.discovered': '{n} discovered',
        'projects.summary.managed': '{n} managed',
        'projects.summary.legacy': '{n} legacy matches',
        'projects.summary.without': '{n} managed without workspace',
        'projects.summary.conflicts': '{n} conflicts',
        'projects.managed.unmatched': 'no DSH workspace',
        'projects.managed.linked': 'workspace {title}',
        'projects.dsh.unavailable': 'This harness cannot open workspaces from the panel.',
      'projects.tab.collisions': 'Collisions',
      'projects.owner.title': 'Global inventory (all sources)',
      'projects.owner.count.total': '{n} skills',
      'projects.owner.pending.total': 'skills not checked',
      'projects.owner.count.own': '{n} own',
      'projects.owner.count.external': '{n} external',
      'projects.owner.count.filesystem': '{n} on disk without owner',
      'projects.owner.count.host': '{n} from the Host',
      'projects.owner.count.unknown': '{n} with unknown owner',
      'projects.owner.pending.own': 'own: not checked',
      'projects.owner.pending.external': 'external: not checked',
      'projects.owner.pending.filesystem': 'on disk: not checked',
      'projects.owner.pending.host': 'Host: not checked',
      'projects.owner.pending.unknown': 'unknown owner: not checked',
      'projects.owner.def.own': 'Skills from this library in the global inventory. This counts skills, not projects.',
      'projects.owner.def.external': 'Skills served by a plugin or another provider in the global inventory. Read-only.',
      'projects.owner.def.filesystem': 'Skills that exist on disk but belong neither to this library nor to a plugin: they are declared as such, not as “unknown”.',
      'projects.owner.def.host': 'Skills packaged or served by the Host itself (catalog/loading), not by a project.',
      'projects.owner.def.unknown': 'Skills whose owner cannot be asserted with the available evidence.',
      'projects.owner.reason.partial': 'the inventory is incomplete or a source did not answer',
      'projects.owner.reason.undetermined': 'the backend does not publish this category',
      'projects.owner.host': 'from the Host',
      'projects.owner.hint': 'These counts are global and are not split per project. Global collisions ({collisions}) are not “projects with a conflict” ({conflicts}): see the Collisions tab.',
      'projects.card.skills.notRun': 'not inspected yet: no inspection has run',
      'projects.card.skills.empty': 'inspection complete: 0 in this project scope · the global inventory has {global}',
      'projects.card.skills.partial': 'inspection partial: some skills may not have been listed',
      'projects.card.skills.failed': 'inspection failed: could not be checked',
      'projects.collisions.subtitle': 'Collisions in the global inventory, read-only. They are not attributed to projects: the per-project conflict counter means something else.',
      'projects.collisions.unchecked': 'Could not check: in this mode the backend does not serve the skill inventory.',
      'projects.collisions.empty': 'Inventory checked: no collisions.',
      'projects.collisions.readonly': 'Read-only: this view deletes, adopts and reassigns nothing.',
      'projects.collisions.count': '{n} of {total} collisions',
      'projects.collisions.openSkill': 'Open this skill’s details',
      'projects.collisions.filter.code': 'Collision type',
      'projects.collisions.filter.codeAll': 'All types',
      'projects.collisions.filter.severity': 'Severity',
      'projects.collisions.filter.severityAll': 'All severities',
      'projects.collisions.filter.owner': 'Owner',
      'projects.collisions.filter.ownerAll': 'All owners',
      'projects.collisions.filter.empty': 'No collision matches the filters.',
      'projects.collisions.severity.block': 'blocking',
      'projects.collisions.severity.warn': 'warning',
      'projects.collisions.severity.info': 'informational',
      'projects.collisions.groupCount': '{n} grouped entries',
      'projects.collisions.legacyLabel': 'compiler history: not a live conflict',
      'projects.collisions.moreRows': '… and {n} more rows (grouped so the list is not repeated)',
      'projects.skill.identity': 'Identity and integrity',
      'projects.skill.identityHint': 'Only what the inventory declares is shown.',
      'projects.skill.notRecorded': 'not recorded',
      'projects.skill.manifestSha': 'Manifest SHA',
      'projects.skill.ownerHint': 'Owner, origin and confidence as declared by the inventory.',
      'projects.skill.ownerKind': 'Owner class',
      'projects.skill.readonly': 'External or unknown-owner skill: shown read-only.',
      'projects.skill.host': 'Host association',
      'projects.skill.hostHint': 'Whether the loader serves it and through which provider; the Host identifies skills by name and path.',
      'projects.skill.loadedByHost': 'Loaded by the Host',
      'projects.skill.loadedShadowed': 'shadowed by {provider}',
      'projects.skill.loadedUnknown': 'load undetermined (the registry does not declare it)',
      'projects.skill.yes': 'yes',
      'projects.skill.no': 'no',
      'projects.skill.execution': 'Execution',
      'projects.skill.modelInvocable': 'model-invocable',
      'projects.skill.userInvocable': 'user-invocable',
      'projects.skill.shadowed': 'The Host catalog serves it through another provider with higher priority ({provider}).',
      'projects.skill.collisions': 'Conflicts touching it',
      'projects.skill.collisionsHint': 'Inventory collisions this entry appears in.',
      'projects.skill.collisionsNone': 'No inventory collision involves this skill.',
      'projects.skill.canonical': 'Canonical name: {name}',
      'projects.ficha.skills.versionLabel': 'Version',
      'projects.ficha.origin.hostIdentity': 'The Host identifies a skill by its name and path; the UUID and version belong to this library, not to the loader.',

        // Compatibility handshake: the mode is decided by `GET /api/capabilities`, never by a bare 404.
        'projects.compat.legacy.title': 'Legacy compatibility mode',
        'projects.compat.legacy.body': 'This backend does not publish /api/projects or /api/inventory; the inventory from /workspaces is shown. Registration, detail, inspection and collision actions are unavailable until DSH restarts.',
        'projects.compat.legacy.refresh': 'Refresh in this mode only re-reads /workspaces; the new routes are not queried.',
        'projects.compat.incompatible.title': 'Incompatible backend',
        'projects.compat.incompatible.body': 'The client expects contract R16.2 and the backend does not satisfy it. Administrative operations are stopped so nothing is written on wrong assumptions.',
        'projects.compat.revision': 'Client: contract {client} · Backend: {backend}',
        'projects.compat.unknownVersion': 'unknown revision',
        'projects.compat.http': 'HTTP {status}{code}',
        'projects.compat.unavailable.title': 'Backend unavailable',
        'projects.compat.unavailable.body': 'The compatibility handshake could not be completed ({reason}). Retry when the Host answers.',
        'projects.compat.auth.title': 'Authorization pending',
        'projects.compat.auth.body': 'The Host rejected the compatibility request (HTTP {status}). Check authorization and retry.',
        'projects.compat.actions.blocked': 'This operation needs contract R16.2 and the handshake did not confirm it.',
        'projects.compat.copy': 'Copy diagnostics',
        'projects.compat.copied': 'Diagnostics copied to the clipboard.',
        'projects.compat.copyUnavailable': 'Could not copy: the clipboard is unavailable.',
        'projects.card.skills.unknown': 'not checked (legacy backend)',
        'projects.inspection.unknown': 'could not be checked',

        // Error boundary: if the panel throws, the slot would stay blank. The card explains the real
        // failure with its message, the first stack line and the step, and offers a retry.
        'projects.boundary.title': 'The panel could not be drawn',
        'projects.boundary.hint': 'Nothing has been modified. This panel is guarded so the error is visible instead of leaving the area blank.',
        'projects.boundary.message': 'Message',
        'projects.boundary.stack': 'First stack line',
        'projects.boundary.noStack': '(the error carries no stack)',
        'projects.boundary.step': 'Where it failed',
        'projects.boundary.step.mount': 'mount',
        'projects.boundary.step.render': 'render',
        'projects.boundary.retry': 'Retry',
        'projects.boundary.copy': 'Copy diagnostics',
        'projects.boundary.copied': 'Diagnostics copied.',
        'projects.boundary.copyUnavailable': 'This harness offers no clipboard: the diagnostics can be read here.',
        'projects.refresh.legacy.invalid': 'The Host answered the new routes with something that is not the contract: the legacy inventory is shown.',
        'projects.refresh.legacy.route': 'The Host does not publish /api/projects yet: the legacy inventory from /workspaces is shown.',

        'projects.state.identity-conflict': 'identity conflict',
        'projects.state.unavailable': 'unavailable',
        'projects.state.partially-inspected': 'partially inspected',
        'projects.state.external-managed': 'externally managed',
        'projects.state.managed': 'managed',
        'projects.state.healthy': 'healthy',
        'projects.state.discovered': 'discovered',
        'projects.state.unknown': 'state not reported',

        'projects.op.read': 'read',
        'projects.op.inspect': 'inspect',
        'projects.op.detach-project': 'detach project',
        'projects.op.repair-manifest': 'repair manifest',
        'projects.op.adopt-project': 'adopt project',
        'projects.op.register-project': 'register project',
        'projects.op.materialize': 'materialize',
        'projects.op.materialize-project': 'materialize',
        'projects.op.assign': 'assign skills',
        'projects.op.rename': 'rename',

        'projects.inspection.complete': 'inspection complete',
        'projects.inspection.incomplete': 'inspection partial',
        'projects.inspection.failed': 'inspection failed',
        'projects.inspection.not-run': 'not inspected',
        'projects.inspection.reason': 'reason: {reason}',

        'projects.chip.group': 'Project filters',
        'projects.chip.hint': 'Press an indicator to filter the list. Each project is counted once, in a single normalized view.',
        'projects.chip.pending': 'not checked',
        'projects.chip.pendingReason': 'not checked: the inventory is incomplete or a source did not answer',
        'projects.chip.definition': 'Active filter: {definition}',
        'projects.chip.clear': 'Clear filter',
        'projects.chip.discovered.one': '{n} discovered',
        'projects.chip.discovered.many': '{n} discovered',
        'projects.chip.discovered.def': 'A workspace the Host knows about that this center has not registered yet. Discovering creates nothing.',
        'projects.chip.managed.one': '{n} managed',
        'projects.chip.managed.many': '{n} managed',
        'projects.chip.managed.def': 'A project registered in this center, through a manifest or adoption.',
        'projects.chip.available.one': '{n} available',
        'projects.chip.available.many': '{n} available',
        'projects.chip.available.def': 'The project folder exists and can be read right now.',
        'projects.chip.unavailable.one': '{n} unavailable',
        'projects.chip.unavailable.many': '{n} unavailable',
        'projects.chip.unavailable.def': 'The registered folder is gone from disk; the project stays in the center until it is repaired.',
        'projects.chip.conflicts.one': '{n} with a conflict',
        'projects.chip.conflicts.many': '{n} with a conflict',
        'projects.chip.conflicts.def': 'A project with its own identity conflict or collisions attributable to its scope. Global inventory collisions are not counted here.',
        'projects.chip.partial.one': '{n} partially inspected',
        'projects.chip.partial.many': '{n} partially inspected',
        'projects.chip.partial.def': 'The last inspection could not query every source; what is missing is said, never counted as zero.',
        'projects.chip.skills.one': '{n} with skills detected',
        'projects.chip.skills.many': '{n} with skills detected',
        'projects.chip.skills.def': 'A project with at least one skill detected in queryable sources.',
        'projects.chip.own.one': '{n} with own skills',
        'projects.chip.own.many': '{n} with own skills',
        'projects.chip.own.def': 'A project with skills from this library.',
        'projects.chip.external.one': '{n} with external skills',
        'projects.chip.external.many': '{n} with external skills',
        'projects.chip.external.def': 'A project with skills served by a plugin or another provider; they are shown read-only.',
        'projects.chip.unknown.one': '{n} with skills of unknown owner',
        'projects.chip.unknown.many': '{n} with skills of unknown owner',
        'projects.chip.unknown.def': 'A project with skills whose owner cannot be asserted.',
        'projects.chip.collisions.one': '{n} with collisions',
        'projects.chip.collisions.many': '{n} with collisions',
        'projects.chip.collisions.def': 'A project with inventory collisions attributable to its scope. Global collisions (not attributed to projects) open in the Collisions tab and are counted separately.',

        'projects.refresh.title': 'Refresh inventory',
        'projects.refresh.updating': 'Updating…',
        'projects.refresh.loading': 'Updating inventory…',
        'projects.refresh.never': 'Inventory not refreshed in this session',
        'projects.refresh.success': '{workspaces} workspaces · {managed} managed · {changes}',
        'projects.refresh.change.one': '{n} change',
        'projects.refresh.change.many': '{n} changes',
        'projects.refresh.at': 'at {time}',
        'projects.refresh.failed': 'Refresh failed',
        'projects.refresh.partial': 'Partial inventory: the Host could not confirm every source. What is missing is not counted.',
        'projects.refresh.truncated': 'Inventory truncated by the entry limit: skill counts may be lower than reality.',
        'projects.refresh.stale': 'Inventory out of date: the Host timestamp predates the last operation.',
        'projects.refresh.legacy.title': 'Legacy inventory',
        'projects.refresh.legacy': 'The Host does not publish /api/projects yet ({status}); the old /workspaces inventory is shown. The new counts stay unchecked.',
        'projects.refresh.legacy.state': 'Legacy inventory (no new counts)',
        'projects.refresh.error.projects': 'The projects query failed',
        'projects.refresh.error.inventory': 'The skill inventory query failed',

        'projects.error.action': 'The operation did not complete',
        'projects.error.code': 'code: {code}',
        'projects.error.notFound': 'That project no longer exists in the registry',
        'projects.error.unknown': 'no detail',

        'projects.register.blocked': 'Registration blocked by preflight',
        'projects.register.evidence': 'Nothing was written: the inspection could not complete ({reason}).',
        'projects.register.exists': 'That project is already registered',
        'projects.register.reasons': 'Server reasons',
        'projects.register.findings': 'Findings',
        'projects.register.sources': 'Sources queried',
        'projects.register.confirmHint': 'Confirming registers this project in the center. Nothing is written inside the project.',

        'projects.sessions.value': '{n} sessions',
        'projects.sessions.unknown': 'sessions: not counted',

        'projects.source.complete': 'complete',
        'projects.source.incomplete': 'incomplete',
        'projects.source.unavailable': 'unavailable',
        'projects.source.error': 'error',
        'projects.source.unknown': 'no status',
        'projects.source.reason': 'reason: {reason}',

        'projects.card.path': 'path',
        'projects.card.identity': 'identity',
        'projects.card.skills': 'skills detected',
        'projects.card.skills.none': 'none in queryable sources',
        'projects.card.skills.values': '{total} detected · {own} own · {external} external · {unknown} unknown',
        'projects.card.inspection': 'inspection',
        'projects.card.inspectedAt': 'last inspected {at}',
        'projects.card.detected': 'last detected {at}',
        'projects.card.detectedUnknown': 'not reported',
        'projects.card.source': 'source: {source}',
        'projects.card.source.record': 'center registry',
        'projects.card.source.workspace': 'Host workspaces',
        'projects.card.source.legacy': 'legacy inventory',
        'projects.card.registered': 'registered',
        'projects.card.unmanaged': 'not registered',
        'projects.card.unmanagedHint': 'Discovered is not managed: opening or inspecting it does not register it.',
        'projects.card.conflicts': '{n} conflicts',
        'projects.card.derived': 'This state is derived from the legacy inventory: the Host reports no new state.',
        'projects.card.derivedShort': 'derived state',
        'projects.card.uuid': 'UUID {uuid}',
        'projects.card.uuidNone': 'no UUID',
        'projects.card.identityUnknown': 'not checked (legacy backend)',
        'projects.card.projectId': 'projectId {id}',
        'projects.card.opening': 'Opening…',
        'projects.card.inspecting': 'Inspecting…',
        'projects.card.inspect': 'Inspect skills',
        'projects.card.manage': 'Manage project',
        'projects.card.detail': 'Open details',
        'projects.inspect.readonly': 'Read-only: this action queries, it does not write.',
        'projects.open.noWorkspace': 'This project has no linked DSH workspace: there is nothing to open.',
        'projects.open.noPanel': 'This harness has no workspace panel loaded, so it cannot be opened from here.',

        'projects.counts.active': '{n} active',
        'projects.counts.assigned': '{n} assigned',
        'projects.counts.materialized.one': '{n} delivered',
        'projects.counts.materialized.many': '{n} delivered',
        'projects.assigned.hint': 'Turning a skill on assigns it to this project; changing the version moves the pin.',
        'projects.empty.discovered': 'The Host returned no discovered workspaces.',
        'projects.empty.unchecked': 'Could not check: the backend does not serve the project inventory in this mode.',
        'projects.empty.managed': 'No managed projects yet. Register or adopt one from Discovered.',
        'projects.filter.empty': 'No project matches the «{label}» filter.',
        'projects.availability.unknownLong': 'Availability could not be checked: the Host does not say whether the folder exists.',

        'projects.dialog.title.register': 'Register project',
        'projects.dialog.title.manage': 'Manage project',
        'projects.dialog.subtitle': 'Read-only preflight: nothing is written until you confirm.',
        'projects.dialog.step.review': 'Review',
        'projects.dialog.step.confirm': 'Confirm',
        'projects.dialog.pick': 'Discovered workspace',
        'projects.dialog.pickPlaceholder': 'Pick a workspace…',
        'projects.dialog.pickEmpty': 'No discovered workspaces: type the path by hand.',
        'projects.dialog.path': 'Project path',
        'projects.dialog.pathPlaceholder': 'C:\\path\\to\\project',
        'projects.dialog.path.canonical': 'Canonical path',
        'projects.dialog.name': 'Name',
        'projects.dialog.namePlaceholder': 'Display name',
        'projects.dialog.identity': 'Detected identity',
        'projects.dialog.identity.workspace': 'workspace',
        'projects.dialog.identity.projectId': 'projectId',
        'projects.dialog.identity.uuid': 'UUID',
        'projects.dialog.identity.none': 'not recorded',
        'projects.dialog.availability': 'Availability',
        'projects.dialog.matches': 'Matches with registered projects',
        'projects.dialog.matches.none': 'No match: the path is not registered.',
        'projects.dialog.skills': 'Skills detected',
        'projects.dialog.skills.values': '{total} detected · {own} own · {external} external · {unknown} unknown',
        'projects.dialog.skills.unavailable': 'The skill inventory could not be read: I cannot assert how many there are.',
        'projects.dialog.conflicts': 'Conflicts',
        'projects.dialog.conflicts.none': 'No conflicts detected.',
        'projects.dialog.coverage': 'Inventory coverage',
        'projects.dialog.coverage.complete': 'Complete: every source answered.',
        'projects.dialog.coverage.partial': 'Partial: at least one source is missing; what could not be checked is not counted.',
        'projects.dialog.ops': 'Operations',
        'projects.dialog.ops.allowed': 'Allowed',
        'projects.dialog.ops.blocked': 'Blocked',
        'projects.dialog.ops.none': 'None blocked.',
        'projects.dialog.ops.reason.state': 'The «{state}» state does not allow registering.',
        'projects.dialog.ops.reason.noPath': 'The project path is missing.',
        'projects.dialog.ops.reason.alreadyRegistered': 'That path is already registered in the center.',
        'projects.dialog.back': 'Back',
        'projects.dialog.cancel': 'Cancel',
        'projects.dialog.close': 'Close',
        'projects.dialog.continue': 'Review and continue',
        'projects.dialog.confirm': 'Register project',
        'projects.dialog.confirming': 'Registering…',
        'projects.dialog.confirmSummary': 'What is going to be registered',

        'projects.ficha.title': 'Project details',
        'projects.ficha.inspectTitle': 'Project inspection',
        'projects.ficha.close': 'Close',
        'projects.ficha.loading': 'Loading details…',
        'projects.ficha.summaryOnly': 'Only the summary is available: the detail could not be loaded.',
        'projects.ficha.summary': 'Summary',
        'projects.ficha.sessions': 'Sessions',
        'projects.ficha.sessions.hint': '{source}. The Host gives no exact per-project total; «cd» inside a session can skew it.',
        'projects.ficha.sessionSource.workspace': 'The count comes from the workspace registry',
        'projects.ficha.sessionSource.persistence': 'The count comes from session persistence',
        'projects.ficha.sessionSource.none': 'The Host reports no sessions for this project',
        'projects.ficha.skills': 'Associated skills',
        'projects.ficha.skills.own': 'own',
        'projects.ficha.skills.external': 'external',
        'projects.ficha.skills.unknownOwner': 'unknown owner',
        'projects.ficha.skills.ownCount': '{n} own',
        'projects.ficha.skills.externalCount': '{n} external',
        'projects.ficha.skills.unknownCount': '{n} unknown',
        'projects.ficha.skills.globalCount': '{n} global',
        'projects.ficha.skills.localCount': '{n} local',
        'projects.ficha.skills.legacyCount': '{n} legacy',
        'projects.ficha.skills.disabledCount': '{n} assigned disabled',
        'projects.ficha.skills.conflictsCount': '{n} with conflicts',
        'projects.ficha.skills.assignedCount': '{n} assignments',
        'projects.ficha.skills.enabled': 'on',
        'projects.ficha.skills.disabled': 'off',
        'projects.ficha.skills.version': 'version {version}',
        'projects.ficha.skills.provider': 'provider {provider}',
        'projects.ficha.skills.shadowed': 'shadowed',
        'projects.ficha.skills.readonly': 'External and ambiguous skills are shown read-only: I cannot assign them from here.',
        'projects.ficha.skills.unavailable': 'The skill inventory could not be read: I cannot assert what is detected.',
        'projects.ficha.skills.noneInSource': 'No skills were detected in the queryable sources.',
        'projects.ficha.skills.partial': 'The inspection was partial: some skills may not have been queryable.',
        'projects.ficha.origin': 'Origin and ownership',
        'projects.ficha.origin.owner': 'Owner',
        'projects.ficha.origin.provider': 'Provider',
        'projects.ficha.origin.origin': 'Origin',
        'projects.ficha.origin.location': 'Location',
        'projects.ficha.origin.scope': 'Scope',
        'projects.ficha.origin.confidence': 'Confidence',
        'projects.ficha.origin.reasons': 'Reasons',
        'projects.ficha.origin.none': 'not recorded',
        'projects.ficha.origin.noProvider': 'the registry publishes no provider',
        'projects.ficha.origin.noProviders': 'The skill registry publishes no provider list; I can only say which provider serves each name the Host loads.',
        'projects.ficha.origin.unmapped': 'The skill owner is the «{provider}» provider. I cannot assert which installed plugin it comes from without an equivalence table.',
        'projects.ficha.origin.empty': 'No skills detected: there is no origin to show.',
        'projects.ficha.conflicts': 'Conflicts',
        'projects.ficha.conflicts.none': 'No conflicts detected.',
        'projects.ficha.conflicts.rows': '{n} rows involved',
        'projects.ficha.activity': 'Activity and history',
        'projects.ficha.activity.empty': 'The current snapshot carries no activity for this project.',
        'projects.ficha.activity.event': 'event',
        'projects.ficha.identity': 'Identity and linking',
        'projects.ficha.identity.projectId': 'projectId',
        'projects.ficha.identity.uuid': 'UUID',
        'projects.ficha.identity.uuidNone': 'no UUID',
        'projects.ficha.identity.sha': 'manifest sha',
        'projects.ficha.identity.workspace': 'workspace',
        'projects.ficha.identity.workspaceNone': 'no workspace',
        'projects.ficha.identity.state': 'Verification',
        'projects.ficha.identity.stateUnknown': 'not verified',
        'projects.ficha.identity.none': 'not recorded',
        'projects.ficha.identity.allowed': 'Allowed: {ops}',
        'projects.ficha.identity.blocked': 'Blocked: {ops}',
        'projects.ficha.identity.noBlocked': 'No blocked operations.',

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

                'analytics.filter.days': 'Window: {n} days',
        'analytics.filter.from': 'From',
        'analytics.filter.to': 'To',
        'analytics.filter.anySkill': 'Any skill',
        'analytics.filter.anyType': 'Any event',
        'analytics.filter.clear': 'Clear filters',
        'analytics.filter.range': 'From {from} to {to} · {n} event(s) inside the filter.',
        'analytics.pins': 'Pins behind the current version',
        'analytics.pins.on': 'enabled',
        'analytics.pins.off': 'paused',
        'analytics.pins.empty': 'No project is behind: every pin points at the current version.',
        'analytics.projects': 'Project comparison',
        'analytics.projects.hint': 'What each project has enabled, paused and delivered to the catalog.',
        'analytics.projects.detail': '{active} enabled · {paused} paused · {loads} catalog delivery(ies)',
        'analytics.projects.empty': 'No project has assignments yet.',
        'analytics.qualityPerVersion': 'Quality per version',
        'analytics.qualityPerVersion.empty': 'No evaluated versions yet.',
        'analytics.references': 'References across versions',
        'analytics.references.detail': '{added} added · {removed} removed · {modified} changed',
        'analytics.references.empty': 'No version changed its references.',
        'activity.hint': 'Click a day to see the events behind it.',
        'activity.pick': 'see events for this day',
        'analytics.events': 'Events in range',
        'analytics.events.hint': 'What the journal recorded under the chosen dates and filters. Click a chart day to narrow it.',
        'analytics.events.empty': 'No event falls in this range with these filters.',
        'analytics.events.truncated': 'Showing the most recent; the range holds more events.',
        'analytics.filter.anyStatus': 'Any status',
        'analytics.filter.anyResult': 'Any result',
        'analytics.filter.status.pending': 'pending',
        'analytics.filter.status.approved': 'approved',
        'analytics.filter.status.rejected': 'rejected',
        'analytics.filter.status.applied': 'applied',
        'analytics.filter.status.other': 'other',
        'analytics.filter.result.ok': 'went well',
        'analytics.filter.result.failed': 'failed',
        'analytics.filter.result.info': 'informational',
        'analytics.rollbacks': 'Pin reversions',
        'analytics.rollbacks.total': 'Recorded reversions',
        'analytics.rollbacks.latest': 'Latest: {at}',
        'analytics.rollbacks.empty': 'No assignment has been reverted yet.',
        'toast.duplicates': 'The library already has something similar: {list} (warning {n}). Review it before continuing.',
        'analytics.least': 'Least used skills',
        'analytics.least.hint': '{projects} project(s) have it enabled · {loads} catalog delivery(ies)',
        'analytics.applications': 'Declared applications',
    'analytics.applications.declared': 'I applied the skill (by a person or the agent)',
    'analytics.applications.withoutDeclaration': '{n} catalog delivery/deliveries with no usage declared',
    'analytics.applications.empty': 'No deliveries or declarations yet.',
    'analytics.definitions': 'Every block states what it measures. {n} skill(s) in the library and {events} event(s) inside the filter.',
        'analytics.knowledge': 'Knowledge inbox',
        'analytics.knowledge.hint': 'What the agents found, with its evidence. A finding decides nothing: the decision engine or a person use it.',
        'analytics.knowledge.unreadable': 'The knowledge store cannot be read; no numbers are shown.',
        'analytics.knowledge.mode': 'Autonomy mode: {mode}',
        'analytics.knowledge.policy': 'Per-project policy',
        'analytics.knowledge.policy.hint': 'A person decides what the AI may do in each project; the AI never grants itself autonomy.',
        'analytics.knowledge.policy.autonomous': 'Autonomous',
        'analytics.knowledge.policy.human': 'Needs a person',
        'analytics.knowledge.policy.empty': 'No projects registered yet.',
        'analytics.knowledge.policy.done': 'Policy for {project} set to {mode}.',
  'analytics.knowledge.origin.verified': 'origin verified by the host',
  'analytics.knowledge.origin.declared': 'declared origin (unverified)',
  'analytics.knowledge.origin.verify': 'Verify origin',
  'analytics.knowledge.origin.done': 'The finding origin was verified by the host.',
  'analytics.knowledge.origin.notDeclared': 'The finding does not declare the session that produced it: there is nothing to verify.',
  'analytics.knowledge.origin.notVerified': 'The host does not know that origin: the finding stays a declaration.',
  'analytics.knowledge.origin.failed': 'The origin could not be verified: {code}.',
  'analytics.knowledge.settled.ok': 'executed',
  'analytics.knowledge.settled.failed': 'failed: {detail}',
  'analytics.knowledge.settled.pending': 'authorized, no result',
  'analytics.knowledge.evidence': '{level} evidence',
  'analytics.knowledge.actedOn': 'closed with {operation}',
        'analytics.knowledge.pending': '{n} finding(s) waiting for triage',
        'analytics.knowledge.inbox': 'Findings',
        'analytics.knowledge.empty': 'No findings recorded.',
        'analytics.knowledge.confidence': 'evidence',
        'analytics.knowledge.pendingSettlements': 'Authorized decisions without a result',
        'analytics.knowledge.pendingSettlements.hint': 'If an execution was interrupted, its trace stays here so it can be recovered: nothing is deleted or rewritten.',
        'analytics.knowledge.pendingSettlements.empty': 'Every authorized decision has its result.',
        'analytics.knowledge.decisions': 'Recorded decisions',
        'analytics.knowledge.decisions.empty': 'No decisions recorded.',
        'analytics.knowledge.contradictions': 'Contradictions',
        'analytics.knowledge.contradictions.empty': 'No contradictions.',
        'analytics.filter.all': 'All projects',
        'analytics.filter.hint': 'Filtering changes no stored figure: it only narrows what is summarised.',
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
        'analytics.adoption': 'Adoption by project',
        'analytics.adoption.skill': 'Skill',
        'analytics.adoption.hint': 'Where each skill lives and which version each project has pinned. Reading changes nothing.',
        'analytics.adoption.off': 'off',
        'analytics.adoption.empty': 'At least one skill and one registered project are needed to show the matrix.',
        'analytics.adoption.legend': 'Dot: the project does not have that skill. Off: it has it disabled. A number is the pinned version; amber when it is behind the current one.',
        'analytics.diag.store': 'Center',
        'analytics.diag.materialized': 'Materialized view',
        'analytics.diag.exists': 'Exists',
        'analytics.diag.missing': 'Not created yet',
        'analytics.diag.version': 'API',
        'analytics.diag.schema': 'Schema',
        'analytics.diag.backup': 'Backup',
        'analytics.diag.backupYes': 'verified',
        'analytics.diag.backupNo': 'none yet',
        'analytics.diag.backupUnverified': 'unverifiable',
        'analytics.diag.backupLegacy': 'old copy, not published',
        'analytics.diag.backupGeneration': 'Generation',
        'analytics.diag.backupReason': 'Reason',
        'analytics.diag.backupSize': 'Size',
        'analytics.diag.backupSha': 'SHA-256',
        'analytics.doctor': 'Product self-check',
        'analytics.doctor.hint': 'What this centre checks about itself. Read-only: none of it changes the store.',
        'analytics.doctor.ok': 'ok',
        'analytics.doctor.warn': 'warning',
        'analytics.doctor.fail': 'failure',
        'analytics.doctor.error': 'The check could not be completed.',
        'analytics.doctor.run': 'Check again',
        'analytics.doctor.resync': 'Resync view',
  'analytics.export': 'Export report',
  'analytics.export.done': 'Report written to {file} ({bytes} B).',
  'analytics.export.failed': 'The report could not be exported',
        'analytics.doctor.resynced': 'Materialized view resynced.',
        'analytics.diag.error': 'Last store error: {message}',
        'schema.title': 'Schema administration',
        'schema.current': 'Current schema',
        'schema.target': 'Target schema',
        'schema.integrity': 'Store integrity',
        'schema.integrity.ok': 'intact',
        'schema.integrity.bad': 'damaged: not migrating',
        'schema.backup': 'Authoritative backup',
        'schema.entities': 'Entities',
        'schema.entitiesValue': '{skills} skills · {versions} versions · {projects} projects · {assignments} assignments · {improvements} improvements · {events} events',
        'schema.state': 'Migration state',
        'schema.state.ready': 'ready to migrate',
        'schema.state.done': 'migrated to v{schema}{date}',
        'schema.state.blocked': 'unavailable',
        'schema.action': 'Migrate schema v1 → v2',
        'schema.busy': 'Migrating…',
        'schema.hint': 'Only a person, from this panel, can migrate the store. The interface does nothing until you confirm.',
        'schema.blocker.store-unreadable': 'the store is damaged: keep it and restore a copy before migrating',
        'schema.blocker.future-version': 'the document is newer than this code: it is not downgraded',
        'schema.blocker.already-migrated': 'it is already on this code\'s schema version',
        'schema.blocker.backup-required': 'no verifiable authoritative backup: without a way back, no migration',
        'schema.blocker.backup-stale': 'the backup does not match the current document: create a new one first',
        'schema.blocker.store-busy': 'another writer is working on the store: wait and refresh',
        'schema.result.ok': 'Migration completed and verified: entities and pins are preserved.',
        'schema.result.kept': 'entities before: {before} · after: {after}',
        'schema.result.failed': 'The migration did not complete ({code}): {message}',
        'schema.dialog.title': 'Migrate the store to v2',
        'schema.dialog.lead': 'You are about to modify the production store of LifeCode Skill Center. This cannot be undone without restoring the backup.',
        'schema.dialog.writes': '`center.json` will be written with schema v2 (once).',
        'schema.dialog.backup': 'A new backup generation is created first with reason "migration"; the current v1 generation is kept for rollback.',
        'schema.dialog.adds': '`schemaMeta` and `pinnedAt` (derived from each assignment date) will be added.',
        'schema.dialog.keeps': 'Skills, versions, references, projects, assignments, pins, improvements and events must be preserved exactly.',
        'schema.dialog.rollback': 'If anything fails the panel reports the code and claims no success; the verified backup remains to restore.',
        'schema.dialog.cancel': 'Cancel',
        'schema.dialog.confirm': 'Confirm migration',

        'drawer.close': 'Close',
        'drawer.description': 'What it is for',
        'drawer.when': 'When to use it',
        'drawer.body': 'Content of version {version}',
        'drawer.references': 'References',
                'drawer.history': 'History and metrics',
        'drawer.history.empty': 'The journal has no events for this skill.',
        'drawer.history.error': 'The detail could not be read.',
        'drawer.history.versions': 'versions',
        'drawer.history.active': 'active projects',
        'drawer.history.loads': 'catalogue offers',
        'drawer.history.delta': 'quality',
        'drawer.versions': 'Versions',
        'drawer.use': 'Use here',
        'drawer.diff': 'Compare with current',
        'drawer.diff.title': 'Differences against the current version',
        'drawer.diff.none': 'No differences in the text.',
        'drawer.diff.truncated': 'Very long text: only the count is shown, not the lines.',
        'drawer.diff.error': 'The comparison failed.',
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
        'toast.migrated': 'Schema migrated and verified.',
        'toast.published': 'Version published.',
        'toast.forked': 'Skill forked.',
        'toast.project': 'Project registered.',
        'toast.version': 'Project version updated.',
        'toast.blocked': 'The AI cannot do this: {message}',
        'integrity.title': 'Unreadable center',
        'integrity.body': 'The center file cannot be read, so there is no library to show. The original data is preserved: this panel has not written over it.',
        'integrity.future': 'A newer version of this center wrote that file. It is left untouched: this version does not migrate or downgrade it.',
        'integrity.invalid': 'The file is valid JSON but does not have the shape of this center document.',
        'integrity.size': 'Size',
        'integrity.hash': 'SHA-256',
        'integrity.diag': 'Diagnostic',
        'integrity.restore': 'Restoring is human and explicit: pick a backup file, its hash is checked and the damaged original is preserved before anything is installed.',
        'integrity.restorePath': 'Path of the backup file',
        'integrity.restoreHash': 'Expected SHA-256 (optional)',
        'integrity.restoreGo': 'Restore',
        'integrity.restored': 'Center restored from {file}',
        'integrity.preserved': 'The original was preserved at {file}',
        'toast.failed': 'Could not complete: {message}',
        'toast.close': 'Close notice',
        'activityFeed.title': 'LifeCode Activity',
        'activity.subtitle': 'Knowledge created, improved and preserved.',
        'activity.button.title': 'View the center activity',
        'activity.button.unread': 'Activity: {n} unread',
        'activity.button.unread.dot': 'Activity: there may be unread news',
        'activity.close': 'Close activity',
        'activity.refresh': 'Refresh',
        'activity.refreshing': 'Refreshing…',
        'activity.loadMore': 'Load more',
        'activity.filters': 'Filter activity',
        'activity.filter.all': 'All',
        'activity.filter.create': 'Creations',
        'activity.filter.update': 'Updates',
        'activity.filter.improvement': 'Self-improvement',
        'activity.filter.references': 'References',
        'activity.filter.alert': 'Alerts',
        'activity.category.create': 'Creation',
        'activity.category.update': 'Update',
        'activity.category.improvement': 'Center self-improvement',
        'activity.category.references': 'Reference change',
        'activity.category.alert': 'Alert',
        'activity.valueUnknown': 'no data',
        'activity.title.skill-created': 'Skill “{skill}” created',
        'activity.title.skill-imported': 'Skill “{skill}” imported',
        'activity.title.skill-updated': 'Skill “{skill}” updated',
        'activity.title.skill-assigned': 'Skill “{skill}” assigned',
        'activity.title.skill-unassigned': 'Skill “{skill}” unassigned',
        'activity.title.skill-advanced': 'Skill “{skill}” advanced in version',
        'activity.title.skill-requested': 'Skill request recorded',
        'activity.title.skill-request-fulfilled': 'Skill request fulfilled',
        'activity.title.skill-request-dismissed': 'Skill request dismissed',
        'activity.title.policy-changed': 'Autonomy policy updated',
        'activity.title.decision-recorded': 'Decision recorded',
        'activity.title.insight-received': 'Knowledge received',
        'activity.title.insight-origin-verified': 'Knowledge origin verified',
        'activity.title.skill-version-saved': 'Saved version {version} of “{skill}”',
        'activity.title.improvement-prepared': 'Improvement prepared for “{skill}”',
        'activity.title.improvement-proposed': 'Improvement proposed for “{skill}”',
        'activity.title.self-improvement-completed': 'Self-improvement completed: {change}',
        'activity.title.knowledge-incorporated': 'Knowledge incorporated into “{skill}”',
        'activity.title.knowledge-detected': 'Knowledge detected in “{project}”',
        'activity.title.change-detected': 'Change detected in {origin}',
        'activity.title.improvement-rejected': 'Improvement rejected for “{skill}”',
        'activity.title.change-reverted': 'Change reverted in “{skill}”',
        'activity.title.project-linked': 'Project “{project}” linked',
        'activity.title.project-detached': 'Project “{project}” detached',
        'activity.title.inspection-finished': 'Inspection finished in “{project}”',
        'activity.title.approval-pending': 'Pending approval: “{skill}”',
        'activity.title.identity-conflict': 'Identity conflict in “{skill}”',
        'activity.title.references-unverified': 'References of “{skill}” unverified',
        'activity.title.source-unavailable': 'Source unavailable: {origin}',
        'activity.title.write-rejected': 'Write rejected in “{skill}”',
        'activity.title.evaluation-blocking': 'The quality gate blocked “{skill}”',
        'activity.title.conflict-blocking': 'Blocking conflict in “{skill}”',
        'activity.title.persistence-failed': 'The change to “{skill}” could not be preserved',
        'activity.group.now': 'Now',
        'activity.group.today': 'Today',
        'activity.group.earlier': 'Earlier days',
        'activity.loading': 'Reading activity…',
        'activityFeed.empty': 'No activity recorded yet.',
        'activity.filter.empty': 'No entry matches this filter.',
        'activity.error': 'Could not read activity: {message}',
        'activity.error.invalid': 'the activity log does not have the expected shape',
        'activity.retry': 'Retry',
        'activity.connected': 'Center available',
        'activity.connected.partial': 'Center available with warnings: {sources}',
        'activity.channel.unavailable': 'External alerts unavailable: the Host exposes no notification channel; activity is shown inside the panel.',
        'activity.disconnected': 'No connection to the center',
        'activity.connected.label': 'Connected',
        'activity.indicator.connected': 'Connected',
        'activity.indicator.working': 'Working…',
        'activity.indicator.saving': 'Saving…',
        'activity.indicator.pending': 'Pending approval ({n})',
        'activity.indicator.last': 'Last activity: {time}',
        'activity.indicator.unknown': 'Status unavailable',
        'activity.outcome.ok': 'Applied',
        'activity.outcome.info': 'Informational',
        'activity.notPersisted': 'not preserved',
        'activity.partial.sources': 'a source is unreadable',
        'activity.partial': 'Part of the activity is unavailable ({sources}). The rest is shown anyway.',
        'activity.seen.scope': 'Read marks are stored only in this browser.',
        'activity.outcome.pending': 'Pending approval',
        'activity.outcome.failed': 'Failed',
        'activity.row.result': 'Result',
        'activity.row.actor': 'Actor',
        'activity.row.origin': 'Origin',
        'activity.row.source': 'Source',
        'activity.row.confidence': 'Confidence',
        'activity.row.actorEvidence': 'Actor evidence',
        'activity.row.correlation': 'Correlation',
        'activity.row.code': 'Code',
        'activity.row.version': 'Version',
        'activity.row.references': 'References',
        'activity.refs.added': '{n} added',
        'activity.refs.updated': '{n} updated',
        'activity.refs.removed': '{n} removed',
        'activity.action.skill': 'Open detail',
        'activity.action.project': 'Review',
        'activity.action.diff': 'View differences',
        'activity.time.now': 'Now',
        'activity.time.minute.one': '{n} min ago',
        'activity.time.minute.many': '{n} min ago',
        'activity.time.hour.one': '{n} h ago',
        'activity.time.hour.many': '{n} h ago',
        'activity.time.unknown': 'time not recorded',
        'activity.toast.title': 'Activity recorded',
        'activity.toast.failed': 'The operation could not complete',
        'activity.toast.blocked': 'Operation blocked',
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

    /**
     * Servicio opcional `uiWorkspace` del panel de workspaces.
     *
     * En producción el `ctx` que recibe el cliente es un proxy de servicios: leer `ctx.uiWorkspace`
     * sin haberlo declarado en `inject` **lanza** (`cannot get property "uiWorkspace" without
     * inject`) y mataba el panel entero al montar. El servicio es opcional (un harness puede no
     * tener panel de workspaces), así que no se puede añadir a `inject`: se consulta por `ctx.get`
     * y, sólo como compatibilidad con los `ctx` planos de las pruebas, por propiedad. Todo va
     * protegido: si no está, la UI deshabilita «Abrir» con su motivo en vez de romperse.
     */
    function uiWorkspaceService(ctx) {
      if (ctx === null || ctx === undefined) return null;
      try {
        if (typeof ctx.get === 'function') {
          const service = ctx.get('uiWorkspace');
          if (service !== undefined && service !== null) return service;
        }
      } catch {
        /* el servicio no está montado en este harness */
      }
      try {
        const service = ctx.uiWorkspace;
        return service === undefined || service === null ? null : service;
      } catch {
        /* ctx de producción sin el servicio declarado: no hay panel de workspaces */
        return null;
      }
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

.lsc-content { flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden; padding: 18px 22px 40px; position: relative; z-index: 0; }
.lsc-content-inner { max-width: 1280px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.lsc-stack { display: flex; flex-direction: column; gap: 16px; }
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

.lsc-grid-2 { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: 14px; align-items: stretch; }
.lsc-cols { column-count: 2; column-gap: 14px; }
.lsc-cols > * { break-inside: avoid; margin: 0 0 14px; }
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

.lsc-mono { font-family: var(--lsc-mono); font-size: 11px; white-space: nowrap; }
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

/* Proyectos: resumen con chips que filtran, tarjetas de descubrimiento y ficha.
   Se reutilizan los tokens y radios del resto del panel; nada de medidas nuevas. */
.lsc-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.lsc-chip {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.22));
  background: transparent; color: inherit; border-radius: 999px;
  padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.lsc-chip:hover { border-color: var(--dsw-alias-border-l2, rgba(148,163,184,0.34)); }
.lsc-chip[aria-pressed="true"] { background: var(--lsc-accent-soft, rgba(124,92,255,0.18)); border-color: var(--lsc-accent); }
.lsc-chip[disabled] { opacity: 0.6; cursor: default; }
.lsc-chip-count { font-family: var(--lsc-mono); font-size: 11px; }
.lsc-chip.pending .lsc-chip-count { font-family: inherit; font-weight: 500; }
.lsc-chip:focus-visible, .lsc-btn:focus-visible, .lsc-tab:focus-visible { outline: 2px solid var(--lsc-accent); outline-offset: 2px; }
.lsc-summary-def { margin: 0 0 10px; font-size: 10.5px; color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-project-card.unmanaged .lsc-card { border-style: dashed; }
.lsc-project-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 10.5px; color: var(--dsw-alias-label-secondary, #93a1b8); margin: 6px 0; }
.lsc-project-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.lsc-project-actions .lsc-btn { white-space: nowrap; }
.lsc-ficha { width: min(980px, 100%); }
.lsc-ficha-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; align-items: start; }
.lsc-ficha-body .lsc-card { margin: 0; }
.lsc-ficha-wide { grid-column: 1 / -1; }
.lsc-kv { display: grid; grid-template-columns: minmax(84px, auto) minmax(0, 1fr); gap: 3px 10px; margin: 0; font-size: 11px; }
.lsc-kv dt { color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-kv dd { margin: 0; min-width: 0; word-break: break-word; }
.lsc-collision-row { border-top: 1px solid rgba(148,163,184,0.12); padding: 6px 0; font-size: 11px; }
.lsc-collision-row:first-child { border-top: 0; }
.lsc-finding-row { display: flex; gap: 8px; align-items: flex-start; font-size: 11px; padding: 4px 0; border-top: 1px solid rgba(148,163,184,0.1); }
.lsc-finding-row:first-child { border-top: 0; }
.lsc-steps { display: flex; gap: 14px; margin-bottom: 6px; }
.lsc-step { display: inline-flex; gap: 6px; align-items: center; font-size: 11px; color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-step.active { color: var(--dsw-alias-label-primary); font-weight: 600; }
.lsc-step b { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; border: 1px solid currentColor; font-size: 10px; }
.lsc-skill-line { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; padding: 4px 0; border-top: 1px solid rgba(148,163,184,0.1); }
.lsc-skill-line:first-child { border-top: 0; }

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

      .lsc-tab {
        appearance: none;
        border: 1px solid var(--dsw-alias-border-l1);
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        border-radius: 999px;
        padding: 5px 12px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .lsc-tab.active {
        background: var(--lsc-accent-soft, rgba(124, 92, 255, 0.18));
        border-color: var(--lsc-accent);
        color: var(--dsw-alias-label-primary);
      }
      .lsc-item-current { border-color: var(--lsc-accent); }
      .lsc-notice {
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        padding: 10px 12px;
        margin-bottom: 10px;
        font-size: 11.5px;
      }
      .lsc-notice.bad { border-color: var(--lsc-bad); background: rgba(239, 68, 68, 0.08); }
      .lsc-notice strong { display: block; margin-bottom: 3px; }
      .lsc-notice p { margin: 0; color: var(--dsw-alias-label-secondary); }

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
/* R17 — pila de avisos: como máximo 3, esquina superior derecha, cierre manual y acción contextual.
   El error/bloqueo no caduca: sólo se va con la ×, con Escape o con su acción. */
.lsc-toast-stack { position: fixed; top: 72px; right: 20px; z-index: 400; display: flex; flex-direction: column; gap: 8px; width: min(390px, calc(100% - 32px)); pointer-events: none; }
/* Pila global (Slot «shell.overlay»): cubre la ventana sin interceptar clicks; sólo las tarjetas los reciben.
   Los tokens se repiten porque el overlay vive fuera de «.lsc-root» y no hereda sus variables. */
.lsc-toast-overlay { --lsc-accent: #7c5cff; --lsc-cyan: #22d3ee; --lsc-ok: #22c55e; --lsc-warn: #f59e0b; --lsc-bad: #ef4444; --lsc-radius: 12px; position: fixed; inset: 0; z-index: 500; pointer-events: none; }
.lsc-toast-overlay .lsc-toast-stack { position: absolute; top: calc(var(--dsh-frame-overlay-top, var(--dsh-frame-top-clearance, 56px)) + 12px); right: 20px; }
.lsc-toast-card { pointer-events: auto; display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: start; gap: 8px; padding: 10px 12px; border: 1px solid rgba(148,163,184,0.22); border-left: 3px solid var(--lsc-accent); border-radius: var(--lsc-radius); background: rgba(13,18,33,0.97); box-shadow: 0 18px 40px rgba(2,6,18,0.5); color: #e8ecf5; animation: lsc-toast-in 160ms ease-out; }
.lsc-toast-card.success { border-left-color: var(--lsc-ok); }
.lsc-toast-card.info { border-left-color: var(--lsc-cyan); }
.lsc-toast-card.warning { border-left-color: var(--lsc-warn); }
.lsc-toast-card.error { border-left-color: var(--lsc-bad); }
.lsc-toast-icon { color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-toast-card.success .lsc-toast-icon { color: var(--lsc-ok); }
.lsc-toast-card.info .lsc-toast-icon { color: var(--lsc-cyan); }
.lsc-toast-card.warning .lsc-toast-icon { color: var(--lsc-warn); }
.lsc-toast-card.error .lsc-toast-icon { color: var(--lsc-bad); }
.lsc-toast-title { display: flex; align-items: baseline; gap: 6px; font-size: 12px; font-weight: 650; line-height: 1.35; }
.lsc-toast-count { flex: none; padding: 0 5px; border-radius: 8px; background: var(--lsc-accent-soft, rgba(124,92,255,0.18)); color: #c4b5fd; font-size: 10px; font-weight: 600; }
.lsc-toast-meta { margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-secondary, #93a1b8); overflow-wrap: anywhere; }
.lsc-toast-detail { margin-top: 4px; font-size: 11px; color: #c7d2e5; overflow-wrap: anywhere; }
.lsc-toast-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.lsc-toast-close { width: 20px; height: 20px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #93a1b8); font-size: 14px; line-height: 18px; cursor: pointer; }
.lsc-toast-close:hover { background: rgba(148,163,184,0.14); color: #e8ecf5; }
.lsc-toast-close:focus-visible { outline: 2px solid var(--lsc-accent); outline-offset: 1px; }
@keyframes lsc-toast-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
/* Indicador compacto: punto + texto, nunca sólo color. */
.lsc-activity-cluster { display: flex; align-items: center; gap: 8px; min-width: 0; }
.lsc-activity-indicator { display: inline-flex; align-items: center; gap: 6px; max-width: 240px; padding: 3px 8px; border: 1px solid rgba(148,163,184,0.2); border-radius: 999px; font-size: 11px; color: var(--dsw-alias-label-secondary, #93a1b8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lsc-activity-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: #64748b; }
.lsc-activity-dot.ok { background: var(--lsc-ok); }
.lsc-activity-dot.work { background: var(--lsc-cyan); }
.lsc-activity-dot.warn { background: var(--lsc-warn); }
.lsc-activity-dot.bad { background: var(--lsc-bad); }
.lsc-activity-button { position: relative; }
.lsc-activity-badge { position: absolute; top: -5px; right: -5px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--lsc-accent); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
.lsc-activity-badge.dot { min-width: 8px; width: 8px; height: 8px; padding: 0; line-height: 0; }
/* Drawer de actividad: se monta sólo al abrirse; sin consultas ni timers propios en reposo. */
.lsc-activity-drawer-wrap { position: absolute; inset: 0; z-index: 80; display: flex; justify-content: flex-end; background: rgba(4,8,18,0.56); }
.lsc-activity-drawer { display: flex; flex-direction: column; width: min(460px, 100%); height: 100%; background: #0d1221; border-left: 1px solid rgba(148,163,184,0.18); box-shadow: -24px 0 60px rgba(2,6,18,0.5); }
.lsc-activity-head { display: flex; align-items: flex-start; gap: 10px; padding: 14px 16px 10px; border-bottom: 1px solid rgba(148,163,184,0.14); }
.lsc-activity-title { margin: 0; font-size: 15px; font-weight: 680; }
.lsc-activity-sub { margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-activity-toolbar { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px 8px; }
.lsc-activity-filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 10px; }
.lsc-activity-filter { flex: none; padding: 3px 9px; border: 1px solid rgba(148,163,184,0.2); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary, #93a1b8); font-size: 11px; cursor: pointer; }
.lsc-activity-filter[aria-pressed="true"] { border-color: var(--lsc-accent); background: var(--lsc-accent-soft, rgba(124,92,255,0.18)); color: #e8ecf5; }
.lsc-activity-filter:focus-visible { outline: 2px solid var(--lsc-accent); outline-offset: 1px; }
.lsc-activity-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 16px 16px; }
.lsc-activity-group-title { margin: 12px 0 6px; font-size: 10.5px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; color: #7d8aa0; }
.lsc-activity-row { margin-bottom: 6px; padding: 8px 10px; border: 1px solid rgba(148,163,184,0.14); border-radius: 10px; background: rgba(148,163,184,0.03); }
.lsc-activity-row-main { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.lsc-activity-row-main:focus-visible { outline: 2px solid var(--lsc-accent); outline-offset: 3px; }
.lsc-activity-row-title { font-size: 12px; font-weight: 600; }
.lsc-activity-row-meta { margin-top: 2px; font-size: 10.5px; color: var(--dsw-alias-label-secondary, #93a1b8); overflow-wrap: anywhere; }
.lsc-activity-evidence { display: grid; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(148,163,184,0.2); font-size: 11px; }
.lsc-activity-kv { display: grid; grid-template-columns: minmax(90px, 140px) minmax(0, 1fr); gap: 8px; }
.lsc-activity-kv span:first-child { color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-activity-kv span:last-child { overflow-wrap: anywhere; }
@media (prefers-reduced-motion: reduce) {
  .lsc-toast-card { animation: none; }
}
.lsc-banner { border: 1px solid rgba(239,68,68,0.45); background: rgba(239,68,68,0.1); color: #fca5a5; border-radius: 9px; padding: 8px 11px; font-size: 12px; display: flex; align-items: center; gap: 10px; }
.lsc-busy { position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--lsc-accent), transparent); animation: lsc-slide 1.1s linear infinite; z-index: 70; }
@keyframes lsc-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
.lsc-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--dsw-alias-label-secondary, #93a1b8); font-size: 13px; }
.lsc-diagnostic { margin: auto; width: min(720px, calc(100% - 32px)); display: flex; flex-direction: column; gap: 10px; padding: 20px; border-radius: var(--lsc-radius); border: 1px solid var(--lsc-bad); background: var(--dsw-alias-bg-layer-1, #111a2e); }
.lsc-diagnostic-title { font-size: 15px; font-weight: 650; color: var(--dsw-alias-label-primary, #e8ecf5); }
.lsc-diagnostic-hint { font-size: 12px; color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-diagnostic-row { display: grid; grid-template-columns: minmax(130px, 190px) minmax(0, 1fr); gap: 10px; align-items: start; font-size: 12px; }
.lsc-diagnostic-label { color: var(--dsw-alias-label-secondary, #93a1b8); }
.lsc-diagnostic-code { font-family: var(--lsc-mono); color: var(--dsw-alias-label-primary, #e8ecf5); overflow-wrap: anywhere; }
.lsc-diagnostic-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px; }
.lsc-portability { padding: 10px 12px; }
.lsc-portability-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.lsc-portability-toggle { text-align: left; }
.lsc-portability-subtitle { display: block; margin: 4px 0 0; }
.lsc-portability-body { margin-top: 10px; }
.lsc-portability-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; margin-top: 8px; }
.lsc-portability-block { min-width: 0; border: 1px solid rgba(148,163,184,0.14); border-radius: var(--lsc-radius); padding: 10px 12px; }
.lsc-portability-title { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #e8ecf5); }
.lsc-export-result { margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(148,163,184,0.2); }
.lsc-bundle-preview { margin-top: 10px; padding: 10px 12px; border: 1px solid rgba(148,163,184,0.18); border-radius: var(--lsc-radius); background: rgba(148,163,184,0.04); }
.lsc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

@media (max-width: 1080px) {
  .lsc-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .lsc-grid-2, .lsc-grid-3 { grid-template-columns: minmax(0, 1fr); }
  .lsc-cols { column-count: 1; }
  .lsc-rail { width: 60px; padding: 12px 6px; }
  .lsc-rail-item span.lsc-rail-label, .lsc-rail-count, .lsc-rail-note { display: none; }
  .lsc-rail-item { justify-content: center; }
}

@media (max-width: 760px) {
  /* Tableta: dos tarjetas por fila, una sola columna de contenido y la barra lateral como tira. */
  .lsc-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lsc-wrap { flex-direction: column; }
  /* El cuerpo es el que pone el rail al lado del contenido: en tableta se apila. */
  .lsc-body { flex-direction: column; }
  .lsc-rail { width: auto; flex-direction: row; overflow-x: auto; padding: 8px; gap: 6px; }
  .lsc-rail-item { flex: none; }
  .lsc-content { padding: 14px 14px 32px; }
  .lsc-content-inner { max-width: 100%; }
  /* La tarjeta de diagnóstico apila etiqueta y valor: en pantalla estrecha no caben en dos columnas. */
  .lsc-diagnostic-row { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  /* Las tablas anchas (adopción) se desplazan en su propio carril en vez de romper la página. */
  /* La matriz de adopción tiene cinco columnas fijas: en tableta se desplaza ella sola. */
  .lsc-table { overflow-x: auto; }
  .lsc-toast-stack { top: auto; right: 12px; bottom: 12px; left: 12px; width: auto; }
  .lsc-activity-indicator { display: none; }
  .lsc-activity-drawer { width: 100%; border-left: 0; }
}

@media (max-width: 430px) {
  /* Móvil: una tarjeta por fila, sin sombras grandes y el cajón a pantalla completa. */
  .lsc-kpis { grid-template-columns: minmax(0, 1fr); }
  .lsc-body { flex-direction: column; }
  .lsc-content { padding: 10px 10px 28px; }
  .lsc-brand-text { display: none; }
  .lsc-header { flex-wrap: wrap; gap: 8px; height: auto; min-height: 52px; }
  .lsc-drawer { max-width: 100%; width: 100%; }
  .lsc-item-title { white-space: normal; }
}
`;

    /* ------------------------------------------------------------------- utilidades */

    function cx(...parts) {
      return parts.filter((part) => typeof part === 'string' && part !== '').join(' ');
    }

    function shortSha(value) {
      const texto = typeof value === 'string' ? value : '';
      return texto.length >= 12 ? `${texto.slice(0, 12)}…` : texto || '—';
    }

    function formatBytes(value) {
      const size = Number(value);
      if (!Number.isFinite(size) || size <= 0) return '—';
      if (size < 1024) return `${size} B`;
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    /** Tres estados y ninguno se disfraza de otro: nunca «sin crear» cuando hay algo que no verifica. */
    function backupLabel(t, backup) {
      const status = backup?.status;
      if (status === 'verified') return t('analytics.diag.backupYes');
      if (status === 'unverified') return backup?.legacy === true ? t('analytics.diag.backupLegacy') : t('analytics.diag.backupUnverified');
      return t('analytics.diag.backupNo');
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

    // «entregas» necesita singular propio: usar `plural` evita el literal «1 entregas» que
    // pintaban la tarjeta y la ficha. Cualquier conteo ausente se trata como 0, no como null.
    function materializedLabel(t, lang, count) {
      const value = Number.isFinite(count) ? count : 0;
      return plural(
        lang,
        value,
        t('projects.counts.materialized.one', { n: value }),
        t('projects.counts.materialized.many', { n: value }),
      );
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

    /** Tono de un contador: con algo dentro informa, con cero queda en segundo plano. */
    function baseTone(value) {
      return typeof value === 'number' && value > 0 ? 'info' : 'mute';
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

    /**
     * Validación estricta de los payloads del contrato R16.
     *
     * Un Host anterior no conoce `/api/projects` ni `/api/inventory` y puede contestar 200 con el
     * documento de `/api/state`; sin esta comprobación, la vista pintaba «0 workspaces · N
     * gestionados» como si el inventario nuevo existiera, y un payload con otra forma podía dejar
     * `projectsData` con datos que ninguna vista sabe leer. Aquí se exige la forma completa: la
     * validación devuelve el payload sólo si cumple y `loadProjects` degrada al inventario heredado
     * cuando no. Los shapes están en `_audit/R16-CONTRACT.md` §6.1/§6.2 y §5.5.
     */
    function isPlainRecord(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isRecordArray(value, requiredKey) {
      if (!Array.isArray(value)) return false;
      return value.every((entry) => isPlainRecord(entry) && (requiredKey === null || text(entry[requiredKey]) !== ''));
    }

    function asProjectsPayload(value) {
      if (!isPlainRecord(value) || value.ok !== true || value.apiVersion !== 1) return null;
      if (!isRecordArray(value.projects, 'projectId')) return null;
      // Un descubierto sin `workspaceId` es legítimo (el Host lo trae sin id abrible): la tarjeta
      // deshabilita «Abrir en DSH» con su motivo. La forma que se exige es la de registro, no un id.
      if (!isRecordArray(value.discovered, null)) return null;
      if (!isRecordArray(value.sources, null)) return null;
      return value;
    }

    function asInventoryPayload(value) {
      if (!isPlainRecord(value) || value.ok !== true || value.apiVersion !== 1) return null;
      if (!isRecordArray(value.entries, null)) return null;
      if (!isRecordArray(value.sources, null)) return null;
      if (value.collisions !== undefined && value.collisions !== null && !isRecordArray(value.collisions, null)) return null;
      return value;
    }

    function asWorkspacesPayload(value) {
      // §5.5: la ruta heredada mantiene su forma vieja. Puede no traer `apiVersion`; si lo trae,
      // tiene que ser la del contrato. Sin `workspaces`/`managed` no hay nada que enseñar.
      if (!isPlainRecord(value) || value.ok !== true) return null;
      if (value.apiVersion !== undefined && value.apiVersion !== 1) return null;
      if (!isRecordArray(value.workspaces, 'workspaceId')) return null;
      if (!isRecordArray(value.managed, null)) return null;
      return value;
    }

    /**
     * Handshake de compatibilidad (`GET /api/capabilities`, contrato R16.2 §6.0).
     *
     * El handshake es la ÚNICA fuente del modo. Un 404 suelto de `/api/projects` no dice nada: el
     * despacho viejo responde 404 a rutas que no conoce y también lo hace a una entidad inexistente.
     * Por eso `legacy-compatible` exige, además del 404 de capabilities, una señal POSITIVA del
     * backend heredado: `/api/workspaces` con la forma vieja y SIN las claves nuevas (`deprecated`
     * en el documento, `state` en cada fila). Si la señal no aparece, el backend es incompatible.
     */
    function asCapabilitiesPayload(value) {
      if (!isPlainRecord(value) || value.ok !== true) return null;
      if (value.apiVersion !== undefined && value.apiVersion !== 1) return null;
      const version = Number(value.contractVersion);
      if (!Number.isFinite(version)) return null;
      if (!Array.isArray(value.capabilities) || !value.capabilities.every((entry) => typeof entry === 'string')) return null;
      if (value.plugin !== undefined && value.plugin !== null && !isPlainRecord(value.plugin)) return null;
      if (value.contract !== undefined && value.contract !== null && !isPlainRecord(value.contract)) return null;
      return value;
    }

    function asLegacyWorkspacesPayload(value) {
      if (!isPlainRecord(value) || value.ok !== true) return null;
      if (value.apiVersion !== undefined && value.apiVersion !== 1) return null;
      // Claves nuevas ⇒ no es el backend heredado. `deprecated` es la marca del contrato nuevo en
      // `/api/workspaces`; una fila con `state` también lo delata.
      if (Object.prototype.hasOwnProperty.call(value, 'deprecated') && value.deprecated !== undefined && value.deprecated !== null) return null;
      if (!isRecordArray(value.workspaces, 'workspaceId')) return null;
      if (!isRecordArray(value.managed, null)) return null;
      if (value.workspaces.some((row) => Object.prototype.hasOwnProperty.call(row, 'state'))) return null;
      if (!value.workspaces.every((row) => text(row.title) !== '' || text(row.path) !== '')) return null;
      return value;
    }

    const CLIENT_CONTRACT_VERSION = 2;

    /** ¿Puede la UI R16 ejecutar operaciones que dependen del contrato nuevo? */
    function compatActionsEnabled(compat) {
      return isPlainRecord(compat) && compat.state === 'compatible-r16';
    }

    /** JSON saneado del handshake: diagnóstico copiable, sin rutas del usuario ni secretos. */
    function compatDiagnosticsPayload(compat, report) {
      const record = isPlainRecord(compat) ? compat : {};
      return {
        generatedAt: new Date().toISOString(),
        client: { name: PACKAGE, contractVersion: CLIENT_CONTRACT_VERSION },
        compatibility: {
          state: text(record.state) !== '' ? record.state : 'unknown',
          http: Number.isFinite(record.http) ? record.http : 0,
          code: text(record.code),
          message: text(record.message),
          contractVersion: Number.isFinite(record.contractVersion) ? record.contractVersion : null,
          backendVersion: text(record.backendVersion),
          capabilities: asArray(record.capabilities).map((entry) => String(entry)),
          legacyProbe: isPlainRecord(record.legacyProbe) ? {
            status: Number.isFinite(record.legacyProbe.status) ? record.legacyProbe.status : 0,
            code: text(record.legacyProbe.code),
          } : null,
          checkedAt: text(record.checkedAt),
        },
        inventory: {
          legacy: report?.legacy === true,
          http: Number.isFinite(report?.legacyStatus) ? report.legacyStatus : 0,
        },
        requests: asArray(report?.errors).map((failure) => ({
          id: text(failure?.id),
          status: Number.isFinite(failure?.status) ? failure.status : 0,
          code: text(failure?.code),
          message: text(failure?.message),
        })),
      };
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

    function ActivityChart({ t, lang, series, onPick }) {
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
                const pickable = typeof onPick === 'function' && totals[index] > 0;
                return e(
                  'g',
                  {
                    key: day.day,
                    style: pickable ? { cursor: 'pointer' } : undefined,
                    onClick: pickable ? () => onPick(day.day) : undefined,
                  },
                  nodes,
                  e('title', null, `${formatDayLabel(day.day, lang)}: ${totals[index]}${pickable ? ` · ${t('activity.pick')}` : ''}`),
                );
              }),
        ),
        e('div', { className: 'lsc-legend' }, SERIES.map((entry) => e('span', { key: entry.key, className: 'lsc-legend-item' }, e('span', { className: 'lsc-swatch', style: { background: entry.color } }), t(entry.labelKey)))),
      );
    }

    /* ---------------------------------------------------------------------- vistas */

    function IntegrityBand({ t, integrity, onRestore, busy }) {
  const [path, setPath] = useState('');
  const [hash, setHash] = useState('');
  const status = String(integrity?.status ?? 'unknown');
  const explanation = status === 'future-version' ? t('integrity.future') : status === 'invalid-shape' ? t('integrity.invalid') : t('integrity.body');
  const submit = async () => {
    if (path.trim() === '') return;
    const result = await onRestore({ path: path.trim(), sha256: hash.trim() });
    if (result !== null) {
      setPath('');
      setHash('');
    }
  };
  return e('div', { style: { margin: '0 0 14px', padding: '14px 16px', borderRadius: 12, border: '1px solid var(--lsc-bad)', background: 'rgba(239, 68, 68, 0.10)' } },
    e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 } },
      e('span', { style: { fontSize: 15, fontWeight: 700, color: 'var(--lsc-bad)' } }, t('integrity.title')),
      e('span', { className: 'lsc-pill bad' }, status),
    ),
    e('p', { style: { margin: '0 0 10px', lineHeight: 1.5 } }, explanation),
    e('dl', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', margin: '0 0 12px', fontSize: 12 } },
      e('dt', { className: 'lsc-hint' }, t('integrity.size')),
      e('dd', { style: { margin: 0 } }, integrity?.size === null || integrity?.size === undefined ? '—' : String(integrity.size)),
      e('dt', { className: 'lsc-hint' }, t('integrity.hash')),
      e('dd', { style: { margin: 0, fontFamily: 'monospace', wordBreak: 'break-all' } }, integrity?.sha256 ?? '—'),
      e('dt', { className: 'lsc-hint' }, t('integrity.diag')),
      e('dd', { style: { margin: 0 } }, integrity?.error ?? '—'),
    ),
    e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } },
      e('input', { value: path, placeholder: t('integrity.restorePath'), onChange: (event) => setPath(event.target.value), style: { flex: '1 1 320px', minWidth: 220 } }),
      e('input', { value: hash, placeholder: t('integrity.restoreHash'), onChange: (event) => setHash(event.target.value), style: { flex: '0 1 260px' } }),
      e('button', { type: 'button', className: 'lsc-btn primary small', disabled: busy === true || path.trim() === '', onClick: submit }, t('integrity.restoreGo')),
    ),
    e('p', { className: 'lsc-hint', style: { margin: '8px 0 0' } }, t('integrity.restore')),
  );
}

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

    /**
     * Buzón de peticiones: la persona describe la necesidad y el agente —que sí tiene un modelo— la
     * convierte en skill. La lista muestra lo pendiente sin spinners eternos: si no hay nada, lo dice.
     */
    function AskSection({ t, snapshot, ask }) {
      const requests = snapshot?.requests ?? { pending: 0, items: [] };
      const items = asArray(requests.items);
      const toneOf = (status) => (status === 'fulfilled' ? 'ok' : status === 'dismissed' ? 'idle' : 'warn');
      const labelOf = (status) =>
        status === 'pending' ? t('ask.pending') : status === 'fulfilled' ? t('ask.fulfilled') : t('ask.dismissed');
      return e(Section, { title: t('ask.title'), hint: t('ask.hint') },
        e('div', { className: 'lsc-row' },
          e('input', {
            className: 'lsc-input search',
            placeholder: t('ask.placeholder'),
            value: ask.text,
            maxLength: 2000,
            onChange: (event) => ask.change(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter' && ask.text.trim() !== '') ask.send(ask.text.trim()); },
          }),
          e('button', { type: 'button', className: 'lsc-btn', disabled: ask.text.trim() === '', onClick: () => ask.send(ask.text.trim()) }, t('ask.send')),
        ),
        items.length === 0
          ? e('div', { style: { marginTop: 10 } }, e(Empty, null, t('ask.empty')))
          : e('div', { className: 'lsc-list', style: { marginTop: 10 } }, items.map((entry) =>
              e('div', { key: entry.id, className: 'lsc-item' },
                e('div', { className: 'lsc-row' },
                  e('span', { className: 'lsc-item-title' }, entry.text),
                  e('div', { className: 'lsc-spacer' }),
                  e(Pill, { tone: toneOf(entry.status) }, labelOf(entry.status)),
                ),
                e('div', { className: 'lsc-item-sub' }, entry.createdAt),
                e('div', { className: 'lsc-row', style: { marginTop: 6 } },
                  entry.status === 'fulfilled' && entry.skillId !== '' ? e('button', { type: 'button', className: 'lsc-btn small', onClick: () => ask.open(entry.skillId) }, t('ask.open')) : null,
                  entry.status === 'pending' ? e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: () => ask.dismiss(entry.id) }, t('ask.dismiss')) : null,
                ),
              ))),
      );
    }

    // --- Portabilidad de Skills (R16.4) ---------------------------------------------------------
    // Exportar/importar un paquete es una operación de ADMINISTRACIÓN, no de descubrimiento: vive en
    // un bloque plegado y nunca escribe al pegar ni al elegir un fichero. El flujo obligatorio es
    // fichero/pegado → «Validar paquete» (read-only) → vista previa → confirmación explícita.
    const PORTABILITY_MAX_BYTES = 512 * 1024;
    // El plegado se recuerda dentro de la sesión (no es un dato del almacén ni una preferencia del
    // Host): si la persona lo abre, sigue abierto al volver de otra vista.
    let portabilityExpanded = false;

    const BUNDLE_ERROR_STATUS = {
      'invalid-bundle': 'invalid-format',
      'invalid-references': 'invalid-format',
      'unsupported-schema': 'unsupported-version',
      'unsupported-version': 'unsupported-version',
      'checksum-mismatch': 'bad-integrity',
      'bundle-too-large': 'too-large',
      'too-large': 'too-large',
      'store-unreadable': 'store-unreadable',
      conflict: 'duplicate-identity',
      'already-imported': 'already-imported',
      'confirmation-required': 'blocked',
    };

    function bundleStatusOf(result) {
      const preview = result?.preview ?? null;
      if (result === null || result === undefined) return null;
      if (result.ok !== true) return BUNDLE_ERROR_STATUS[text(result.code)] ?? 'invalid-format';
      if (preview === null || typeof preview !== 'object') return 'invalid-format';
      const preflight = preview.preflight ?? {};
      const conflicts = preview.conflicts ?? {};
      if (text(preflight.decision) === 'block' || preview?.plan?.action === 'blocked') return 'blocked';
      if (asArray(conflicts.alreadyImported).length > 0) return 'already-imported';
      if (conflicts?.sameId?.exists === true) return 'duplicate-identity';
      if (asArray(conflicts.sameName).length > 0) return 'name-conflict';
      const origin = preview.origin ?? {};
      const identity = preview.identity ?? {};
      if (text(origin.app) === '' || text(origin.skillId) === '' || text(origin.version) === '' || text(identity.checksum) === '') {
        return 'incomplete-provenance';
      }
      if (text(preview?.integrity?.checksum) !== 'ok') return 'bad-integrity';
      return 'valid';
    }

    function bundleStatusTone(status) {
      if (status === 'valid') return 'ok';
      if (status === 'blocked' || status === 'bad-integrity' || status === 'invalid-format'
        || status === 'unsupported-version' || status === 'store-unreadable' || status === 'too-large') return 'bad';
      return 'warn';
    }

    function importedIdOf(result) {
      const imported = result?.imported;
      if (imported !== null && typeof imported === 'object') return text(imported.id) || text(imported.skillId);
      return text(result?.id) || text(result?.skill?.id) || text(result?.skillId);
    }

    function copyPlainText(value) {
      // Portapapeles protegido: en un entorno sin API (o sin permiso) no se rompe el panel.
      try {
        if (typeof navigator === 'object' && navigator !== null && navigator.clipboard
          && typeof navigator.clipboard.writeText === 'function') {
          return Promise.resolve(navigator.clipboard.writeText(String(value)))
            .then(() => true)
            .catch(() => false);
        }
      } catch {
        return Promise.resolve(false);
      }
      return Promise.resolve(false);
    }

    function downloadJsonFile(name, content) {
      // Descarga con Blob + anchor; si el entorno no los tiene (tests, render), no hace nada.
      try {
        if (typeof document !== 'object' || document === null || typeof document.createElement !== 'function') return false;
        if (typeof Blob !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
        const blob = new Blob([String(content)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = String(name);
        if (typeof anchor.click === 'function') anchor.click();
        if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
        return true;
      } catch {
        return false;
      }
    }

    function ExportResultBox({ t, data }) {
      if (data === null || data === undefined) return null;
      if (data.ok !== true) {
        return e('p', { className: 'lsc-hint', style: { color: 'var(--lsc-bad)' } },
          t('portability.export.failed', { code: text(data.code) || t('projects.error.unknown') }));
      }
      const json = typeof data.json === 'string' ? data.json : JSON.stringify(data.json ?? {}, null, 2);
      const warnings = asArray(data.warnings);
      const [copied, setCopied] = useState(false);
      const copy = async () => {
        const done = await copyPlainText(json);
        setCopied(done);
      };
      return e('div', { className: 'lsc-export-result' },
        e('div', { className: 'lsc-row', style: { flexWrap: 'wrap' } },
          e(Pill, { tone: 'ok' }, t('portability.export.ready')),
          e('span', { className: 'lsc-mono' }, t('portability.export.bytes', { n: String(data.bytes ?? 0) })),
          e('span', { className: 'lsc-mono' }, t('portability.export.checksum', { sha: shortSha(data.checksum ?? data.sha256 ?? '') })),
          e(Pill, { tone: data.portable === false ? 'warn' : 'ok' }, data.portable === false ? t('portability.export.notPortable') : t('portability.export.portable')),
        ),
        warnings.length === 0
          ? null
          : e('div', { className: 'lsc-col', style: { marginTop: 6, gap: 2 } },
              warnings.map((warning, index) => e('p', { key: index, className: 'lsc-hint', style: { margin: 0, color: 'var(--lsc-warn)' } },
                `${text(warning.path) || text(warning.reason) || 'warning'} · ${text(warning.reason)}`))),
        e('div', { className: 'lsc-row', style: { marginTop: 8, flexWrap: 'wrap' } },
          e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: copy }, copied ? t('portability.export.copied') : t('portability.export.copy')),
          e('button', {
            type: 'button',
            className: 'lsc-btn ghost small',
            onClick: () => downloadJsonFile(`${text(data.skillId) || 'skill'}-${text(data.version) || 'version'}.json`, json),
          }, t('portability.export.download')),
        ),
      );
    }

    function ExportSkillBox({ t, skills, fixedSkillId, onExport, busy }) {
      const fixed = text(fixedSkillId);
      const [skillId, setSkillId] = useState(fixed);
      const [version, setVersion] = useState('');
      const [result, setResult] = useState(null);
      const [working, setWorking] = useState(false);
      const options = asArray(skills);
      const selected = options.find((skill) => text(skill?.id) === (fixed !== '' ? fixed : text(skillId))) ?? null;
      const versions = asArray(selected?.versions);
      const currentVersion = text(selected?.currentVersion);
      const effectiveVersion = text(version) !== '' ? version : currentVersion;
      const chosen = text(fixed !== '' ? fixed : skillId);
      const run = async () => {
        if (chosen === '' || effectiveVersion === '' || working || busy === true) return;
        setWorking(true);
        try {
          const outcome = await onExport(chosen, effectiveVersion);
          setResult(outcome ?? { ok: false, code: 'failed' });
        } catch (failure) {
          setResult({ ok: false, code: String(failure?.message ?? failure) });
        } finally {
          setWorking(false);
        }
      };
      return e('div', { className: 'lsc-col', style: { gap: 8 } },
        fixed === ''
          ? e('label', { className: 'lsc-field' },
              e('span', { className: 'lsc-label' }, t('portability.export.skill')),
              e('select', {
                className: 'lsc-select',
                value: skillId,
                onChange: (event) => { setSkillId(event.target.value); setVersion(''); setResult(null); },
              },
                e('option', { value: '' }, t('portability.export.skillPlaceholder')),
                options.map((skill) => e('option', { key: skill.id, value: skill.id }, `${skill.title ?? skill.id} · ${skill.id}`)),
              ))
          : null,
        e('label', { className: 'lsc-field' },
          e('span', { className: 'lsc-label' }, t('portability.export.version')),
          e('select', {
            className: 'lsc-select',
            value: effectiveVersion,
            disabled: versions.length === 0,
            onChange: (event) => { setVersion(event.target.value); setResult(null); },
          },
            versions.length === 0
              ? e('option', { value: currentVersion }, currentVersion === '' ? t('portability.export.noVersion') : currentVersion)
              : versions.map((entry) => e('option', { key: entry.version, value: entry.version },
                  `${entry.version}${entry.version === currentVersion ? ` · ${t('portability.export.current')}` : ''}`)),
          )),
        e('div', { className: 'lsc-row' },
          e('button', {
            type: 'button',
            className: 'lsc-btn small',
            disabled: chosen === '' || effectiveVersion === '' || working || busy === true,
            onClick: run,
          }, working ? t('portability.export.working') : (fixed === '' ? t('portability.export.generate') : t('portability.export.generateHere'))),
        ),
        e(ExportResultBox, { t, data: result }),
      );
    }

    // Traduce los valores técnicos del contrato a texto accesible (R16.4 §6).
    function portabilityPlanText(t, value) {
      const key = text(value);
      if (key === '') return t('portability.preview.plan.unknown', { value: '?' });
      const translated = t('portability.preview.plan.' + key);
      return translated === 'portability.preview.plan.' + key ? t('portability.preview.plan.unknown', { value: key }) : translated;
    }

    function portabilityDecisionText(t, value) {
      const key = text(value);
      if (key === '') return t('portability.preview.decision.unknown', { value: '?' });
      const translated = t('portability.preview.decision.' + key);
      return translated === 'portability.preview.decision.' + key ? t('portability.preview.decision.unknown', { value: key }) : translated;
    }

    function BundlePreviewBox({ t, response }) {
      const preview = response?.preview ?? null;
      const status = bundleStatusOf(response);
      if (preview === null && response !== null && response !== undefined && response.ok !== true) {
        const code = text(response.code) || 'unknown';
        return e('div', { className: 'lsc-notice bad', role: 'alert' },
          e('div', null, t(`portability.status.${status}`)),
          e('p', { className: 'lsc-hint', style: { margin: '4px 0 0' } },
            t('portability.detail', { code, message: text(response.message) || t('portability.noMessage') })),
        );
      }
      if (preview === null) return null;
      const origin = preview.origin ?? {};
      const identity = preview.identity ?? {};
      const compatibility = preview.compatibility ?? {};
      const integrity = preview.integrity ?? {};
      const portability = preview.portability ?? {};
      const conflicts = preview.conflicts ?? {};
      const plan = preview.plan ?? {};
      const preflight = preview.preflight ?? {};
      const row = (key, label, value) => e('div', { key, className: 'lsc-row' },
        e('span', { className: 'lsc-hint', style: { minWidth: 108, flex: '0 0 auto' } }, label),
        e('span', { style: { fontSize: 11, minWidth: 0, wordBreak: 'break-word' } }, value));
      const sameName = asArray(conflicts.sameName);
      const importedBefore = asArray(conflicts.alreadyImported);
      const findings = asArray(preflight.findings);
      const reasons = asArray(preflight.reasons);
      return e('div', { className: 'lsc-bundle-preview' },
        e('div', { className: 'lsc-row', style: { flexWrap: 'wrap' } },
          e(Pill, { tone: bundleStatusTone(status) }, t(`portability.status.${status}`)),
          e('span', { className: 'lsc-item-title' }, text(preview.name) || text(preview.slug) || t('portability.preview.unnamed')),
          e('span', { className: 'lsc-mono lsc-dim' }, `v${text(preview.version) || '?'}`),
        ),
        e('div', { className: 'lsc-col', style: { gap: 3, marginTop: 8 } },
          row('bundle:description', t('portability.preview.description'), text(preview.description) || t('common.none')),
          row('bundle:origin', t('portability.preview.origin'), `${text(origin.app) || '?'} · ${text(origin.skillId) || '?'} · v${text(origin.version) || '?'}`),
          row('bundle:exportedAt', t('portability.preview.exportedAt'), text(origin.exportedAt) || t('portability.notRecorded')),
          row('bundle:from', t('portability.preview.from'), text(origin.from) || t('portability.notRecorded')),
          row('bundle:identity', t('portability.preview.identity'), `${text(identity.skillId) || '?'} · ${shortSha(identity.checksum ?? '') || t('portability.notRecorded')}`),
          row('bundle:bytes', t('portability.preview.bytes'), String(identity.bytes ?? '?')),
          row('bundle:schema', t('portability.preview.schema'), `${text(compatibility.schema) || '?'} · v${text(compatibility.schemaVersion) || '?'}`),
          row('bundle:compatibility', t('portability.preview.compatibility'), compatibility.supported === true ? t('portability.preview.supported') : t('portability.preview.unsupported')),
          row('bundle:integrity', t('portability.preview.integrity'), text(integrity.checksum) === 'ok' ? t('portability.preview.checksumOk') : t('portability.preview.checksumBad')),
          row('bundle:portability', t('portability.preview.portability'), `${portability.portable === false ? t('portability.export.notPortable') : t('portability.export.portable')} · ${asArray(portability.warnings).length}`),
          row('bundle:conflicts', t('portability.preview.conflicts'),
            [
              conflicts?.sameId?.exists === true ? t('portability.preview.sameId', { id: text(conflicts?.sameId?.id) || text(identity.skillId) || '?', version: text(conflicts?.sameId?.currentVersion) || '?' }) : null,
              sameName.length === 0 ? null : t('portability.preview.sameName', { n: sameName.length }),
              importedBefore.length === 0 ? null : t('portability.preview.already', { n: importedBefore.length }),
            ].filter(Boolean).join(' · ') || t('portability.preview.noConflicts')),
          row('bundle:plan', t('portability.preview.plan'), `${portabilityPlanText(t, plan.action)}${text(plan.targetIdCandidate) === '' ? '' : ` → ${plan.targetIdCandidate}`}`),
          row('bundle:preflight', t('portability.preview.preflight'), `${portabilityDecisionText(t, preflight.decision)}${findings.length === 0 ? '' : ` · ${t('portability.preview.findings', { n: findings.length })}`}${reasons.length === 0 ? '' : ` · ${t('portability.preview.reasons', { n: reasons.length })}`}`),
          e('p', { className: 'lsc-hint', style: { margin: '4px 0 0' } }, t('portability.preview.qualityGateNote')),
        ),
        findings.length === 0 && reasons.length === 0
          ? null
          : e('div', { className: 'lsc-col', style: { gap: 2, marginTop: 6 } },
              reasons.map((reason, index) => e('p', { key: `reason-${index}`, className: 'lsc-hint', style: { margin: 0, color: 'var(--lsc-warn)' } }, `· ${text(reason) || '?'}`)),
              findings.map((finding, index) => e('p', { key: `finding-${index}`, className: 'lsc-hint', style: { margin: 0 } },
                `${text(finding.severity) || '?'} · ${text(finding.code) || '?'}${text(finding.message) === '' ? '' : ` · ${finding.message}`}`))),
      );
    }

    // ImportSection se extrae y se monta aislada por las pruebas de distribución: no puede referirse
    // a ningún ayudante del módulo, sólo a `e`, `t` y los hooks. Toda la escritura sigue delegada en
    // `onImport`; este bloque sólo valida (lectura), muestra la vista previa y pide confirmación.
    function ImportSection({ t, onImport }) {
      const [draft, setDraft] = useState('');
      const [fileName, setFileName] = useState('');
      const [tooLarge, setTooLarge] = useState(false);
      const [response, setResponse] = useState(null);
      const [result, setResult] = useState(null);
      const [busy, setBusy] = useState(false);
      const [failed, setFailed] = useState('');
      const limit = 512 * 1024;
      const planText = (value) => {
        const key = str(value);
        if (key === '') return t('portability.preview.plan.unknown', { value: '?' });
        const translated = t('portability.preview.plan.' + key);
        return translated === 'portability.preview.plan.' + key ? t('portability.preview.plan.unknown', { value: key }) : translated;
      };
      const severityText = (value) => {
        const key = str(value);
        if (key === '') return '';
        const label = t('portability.severity.' + key);
        return label === 'portability.severity.' + key ? key : label;
      };
      const decisionText = (value) => {
        const key = str(value);
        if (key === '') return t('portability.preview.decision.unknown', { value: '?' });
        const translated = t('portability.preview.decision.' + key);
        return translated === 'portability.preview.decision.' + key ? t('portability.preview.decision.unknown', { value: key }) : translated;
      };
      const str = (value) => (value === null || value === undefined ? '' : String(value));
      const listOf = (value) => (Array.isArray(value) ? value : []);
      const importedIdOf = (payload) => str(payload?.id)
        || str(payload?.imported?.id)
        || str(payload?.skill?.id)
        || str(payload?.importedId);
      const statusOf = (payload) => {
        if (payload === null || payload === undefined) return '';
        const code = str(payload.code).toLowerCase();
        if (payload.ok === true) {
          if (payload.imported === false || code === 'conflict' || code === 'already-imported') {
            return payload.imported === false && code === 'conflict' ? 'blocked' : 'already-imported';
          }
          const view = payload.preview;
          if (!view) return '';
          // El estado se deriva del contenido de la vista previa, no de que la petición fuese 200:
          // un paquete con checksum roto o conflicto de id sigue siendo un 200 y NO es válido.
          if (view.compatibility?.supported === false) return 'unsupported-version';
          if (str(view.integrity?.checksum) !== '' && str(view.integrity?.checksum) !== 'ok') return 'bad-integrity';
          if (Array.isArray(view.conflicts?.alreadyImported) && view.conflicts.alreadyImported.length > 0) return 'already-imported';
          if (view.conflicts?.sameId?.exists === true) return 'duplicate-identity';
          if (Array.isArray(view.conflicts?.sameName) && view.conflicts.sameName.length > 0) return 'name-conflict';
          if (str(view.preflight?.decision) === 'block') return 'blocked';
          if (Array.isArray(view.preflight?.reasons) && view.preflight.reasons.length > 0 && str(view.preflight?.decision) !== 'allow') return 'incomplete-provenance';
          return 'valid';
        }
        if (code === 'bundle-too-large') return 'too-large';
        if (code === 'unsupported-schema') return 'unsupported-version';
        if (code === 'checksum-mismatch') return 'bad-integrity';
        if (code === 'invalid-references' || code === 'invalid-bundle') return 'invalid-format';
        if (code === 'store-unreadable') return 'store-unreadable';
        if (code === 'evaluation-failed') return 'evaluation-failed';
        return 'invalid-format';
      };
      const readFile = async (file) => {
        setTooLarge(false);
        setFailed('');
        if (!file) return;
        if (Number(file.size) > limit) { setTooLarge(true); setDraft(''); setFileName(str(file.name)); return; }
        try {
          let body = '';
          if (typeof file.text === 'function') body = await file.text();
          else if (typeof FileReader === 'function') {
            body = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result ?? ''));
              reader.onerror = () => reject(reader.error ?? new Error('read-failed'));
              reader.readAsText(file);
            });
          }
          setDraft(body);
          setFileName(str(file.name));
          setResponse(null);
          setResult(null);
        } catch (failure) {
          setFailed(str(failure?.message ?? failure));
        }
      };
      const validate = async () => {
        if (busy === true) return;
        if (str(draft).trim() === '') return;
        if (draft.length > limit) { setTooLarge(true); return; }
        setBusy(true);
        setFailed('');
        setResult(null);
        try {
          const outcome = await onImport(draft);
          setResponse(outcome ?? null);
          if (!outcome || outcome.ok !== true) setFailed(str(outcome?.code) || 'failed');
          else if (!outcome.preview && importedIdOf(outcome) !== '') setResult(outcome);
        } catch (failure) {
          setFailed(str(failure?.message ?? failure));
        } finally {
          setBusy(false);
        }
      };
      const importNow = async (options) => {
        if (busy === true) return;
        setBusy(true);
        setFailed('');
        try {
          const outcome = await onImport(draft, options);
          setResult(outcome ?? null);
          if (outcome?.preview) setResponse(outcome);
          if (!outcome || outcome.ok !== true) setFailed(str(outcome?.code) || 'failed');
        } catch (failure) {
          setFailed(str(failure?.message ?? failure));
        } finally {
          setBusy(false);
        }
      };
      const status = statusOf(response);
      const preview = response?.preview ?? null;
      const valid = preview !== null && response?.ok === true && status === 'valid';
      const conflictual = status === 'blocked' || status === 'duplicate-identity' || status === 'name-conflict' || status === 'already-imported';
      // El servidor sólo acepta la copia cuando el plan la declara y el id está ocupado (lib/api.mjs).
      // En already-imported o preflight bloqueado volvería a rechazar: sólo se ofrece cerrar.
      const copyAllowed = preview !== null
        && preview.conflicts?.sameId?.exists === true
        && str(preview.plan?.action) === 'copy'
        && status !== 'already-imported'
        && status !== 'blocked';
      const failedResult = result !== null && result.ok !== true ? result : null;
      const errorStatus = failedResult === null ? status : statusOf(failedResult);
      const failureChecks = listOf(failedResult?.evaluation?.checks ?? result?.evaluation?.checks);
      const row = (key, labelKey, value) => e('div', { key, className: 'lsc-row' },
        e('span', { className: 'lsc-hint', style: { minWidth: 96, flex: '0 0 auto' } }, t(labelKey)),
        e('span', { style: { fontSize: 11, minWidth: 0, wordBreak: 'break-word' } }, str(value) === '' ? t('portability.notRecorded') : value),
      );
      const previewBox = preview === null ? null : e('div', { className: 'lsc-bundle-preview' },
        e('div', { className: 'lsc-row', style: { gap: 6, flexWrap: 'wrap' } },
          e('span', { className: 'lsc-pill ' + (status === 'valid' ? 'ok' : status === 'invalid-format' || status === 'bad-integrity' || status === 'blocked' || status === 'store-unreadable' || status === 'too-large' || status === 'evaluation-failed' ? 'bad' : 'warn') }, t('portability.status.' + (status || 'valid'))),
          e('strong', { style: { fontSize: 13 } }, str(preview.name) === '' ? t('portability.preview.unnamed') : preview.name),
        ),
        str(preview.description) === '' ? null : e('p', { className: 'lsc-hint', style: { margin: '4px 0' } }, preview.description),
        row('preview:version', 'portability.export.version', str(preview.version) === '' ? t('portability.notRecorded') : preview.version),
        row('preview:origin', 'portability.preview.origin', [str(preview.origin?.app), str(preview.origin?.skillId), str(preview.origin?.version)].filter((part) => part !== '').join(' · ')),
        row('preview:exported', 'portability.preview.exportedAt', preview.origin?.exportedAt),
        row('preview:from', 'portability.preview.from', preview.origin?.from),
        row('preview:identity', 'portability.preview.identity', str(preview.identity?.skillId)),
        row('preview:checksum', 'portability.export.checksum', preview.identity?.checksum),
        row('preview:bytes', 'portability.preview.bytes', preview.identity?.bytes),
        row('preview:schema', 'portability.preview.schema', `${str(preview.compatibility?.schema) || '?'} · v${str(preview.compatibility?.schemaVersion) || '?'}`),
        row('preview:supported', 'portability.preview.compatibility', preview.compatibility?.supported === true ? t('portability.preview.supported') : t('portability.preview.unsupported')),
        row('preview:integrity', 'portability.preview.integrity', str(preview.integrity?.checksum) === 'ok' ? t('portability.preview.checksumOk') : t('portability.preview.checksumBad')),
        row('preview:portable', 'portability.preview.portability', preview.portability?.portable === true ? t('portability.export.portable') : t('portability.export.notPortable')),
        row('preview:plan', 'portability.preview.plan', planText(preview.plan?.action)),
        row('preview:preflight', 'portability.preview.preflight', decisionText(preview.preflight?.decision)),
        e('p', { className: 'lsc-hint', style: { margin: '4px 0 0' } }, t('portability.preview.qualityGateNote')),
        preview.conflicts?.sameId?.exists === true ? row('preview:sameId', 'portability.preview.sameId.label', [str(preview.conflicts?.sameId?.id) || str(preview.identity?.skillId), str(preview.conflicts?.sameId?.currentVersion)].filter((part) => part !== '').join(' v')) : null,
        listOf(preview.conflicts?.sameName).length === 0 ? null : row('preview:sameName', 'portability.preview.sameName', listOf(preview.conflicts?.sameName).map((entry) => str(entry?.title) || str(entry?.id)).join(' · ')),
        listOf(preview.conflicts?.alreadyImported).length === 0 ? null : row('preview:already', 'portability.preview.already', listOf(preview.conflicts?.alreadyImported).map((entry) => str(entry?.id)).join(' · ')),
        listOf(preview.preflight?.reasons).length === 0 ? null : e('div', null,
          e('p', { className: 'lsc-hint', style: { margin: '4px 0 0' } }, t('portability.preview.reasons')),
          e('ul', { style: { margin: '2px 0 0 16px', padding: 0, fontSize: 11 } }, listOf(preview.preflight?.reasons).map((reason, index) => e('li', { key: 'reason:' + index }, str(reason)))),
        ),
        listOf(preview.preflight?.findings).length === 0 ? null : e('div', null,
          e('p', { className: 'lsc-hint', style: { margin: '4px 0 0' } }, t('portability.preview.findings')),
          e('ul', { style: { margin: '2px 0 0 16px', padding: 0, fontSize: 11 } }, listOf(preview.preflight?.findings).map((finding, index) => e('li', { key: 'finding:' + index }, [severityText(finding?.severity), str(finding?.code)].filter((part) => part !== '').join(' · ') + (str(finding?.message) === '' ? '' : ' — ' + str(finding.message)))),
        ),
        ),
        valid
          ? e('div', { className: 'lsc-row', style: { marginTop: 8, gap: 8 } },
            e('button', { type: 'button', className: 'lsc-btn primary small', disabled: busy === true, onClick: () => importNow({ mode: 'import', confirmed: true }) }, t('portability.confirm')),
          )
          : null,
        conflictual
          ? e('div', { className: 'lsc-row', style: { marginTop: 8, gap: 8, flexWrap: 'wrap' } },
            copyAllowed
              ? e('button', { type: 'button', className: 'lsc-btn primary small', disabled: busy === true, onClick: () => importNow({ mode: 'import', confirmed: true, onConflict: 'copy' }) }, t('portability.confirm.copy'))
              : null,
            e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: () => { setResponse(null); setResult(null); setDraft(''); setFileName(''); } }, t('portability.cancel')),
          )
          : null,
      );
      const successId = result !== null && result.ok === true ? importedIdOf(result) : '';
      return e('div', { className: 'lsc-col', style: { gap: 8 } },
        e('p', { className: 'lsc-hint', style: { margin: 0 } }, t('library.import.hint')),
        e('input', {
          type: 'file',
          accept: '.json,application/json',
          onChange: async (event) => { await readFile(event?.target?.files?.[0] ?? null); },
        }),
        fileName === '' ? null : e('p', { className: 'lsc-hint', style: { margin: 0 } }, t('portability.import.selected', { name: fileName })),
        e('textarea', {
          className: 'lsc-input',
          rows: 5,
          placeholder: t('library.import.placeholder'),
          value: draft,
          onChange: (event) => { setDraft(str(event?.target?.value)); setTooLarge(false); setResponse(null); setResult(null); },
        }),
        tooLarge ? e('div', { className: 'lsc-notice bad' }, t('portability.status.too-large')) : null,
        e('p', { className: 'lsc-hint', style: { margin: 0 } }, t('portability.import.limit', { size: '512 KiB' })),
        e('button', {
          type: 'button',
          className: 'lsc-btn small',
          disabled: busy === true || str(draft).trim() === '',
          onClick: () => validate(),
        }, busy === true ? t('portability.validate.working') : (response === null ? t('portability.validate') : t('portability.revalidate'))),
        failed === '' ? null : e('div', { className: 'lsc-notice bad' }, t('portability.status.' + (errorStatus || 'invalid-format')) + ' · ' + failed),
        failureChecks.length === 0 ? null : e('ul', { style: { margin: '4px 0 0 16px', padding: 0, fontSize: 11 } },
          failureChecks.map((check, index) => e('li', { key: 'check:' + index },
            [severityText(check?.severity), str(check?.code)].filter((part) => part !== '').join(' · ')
              + (str(check?.message) === '' ? '' : ' — ' + str(check.message))))),
        previewBox,
        successId === '' ? null : e('div', { className: 'lsc-notice', style: { marginTop: 8 } },
          e('p', { style: { margin: 0 } }, t('portability.done.id', { id: successId })),
          result.renamed === true ? e('p', { className: 'lsc-hint', style: { margin: '2px 0 0' } }, t('portability.done.renamed', { from: str(result.renamedFrom) })) : null,
          e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: () => onImport('', { mode: 'open', id: successId }) }, t('portability.done.open')),
        ),
        e('p', { className: 'lsc-hint', style: { margin: 0 } }, t('portability.import.never')),
      );
    }


    function PortabilitySection({ t, snapshot, onExport, onInspect, onImport: onImportAction, onOpenSkill, busy }) {
      const [open, setOpen] = useState(portabilityExpanded);
      const skills = skillsOf(snapshot);
      // El bloque de importar sólo conoce un delegado: validar (read-only), confirmar o abrir.
      // Así la sección no habla con la API y toda la escritura sigue pasando por el Panel.
      const onImport = useCallback((bundle, options) => {
        const mode = text(options?.mode) || 'inspect';
        if (mode === 'open') {
          if (typeof onOpenSkill === 'function') onOpenSkill(text(options?.id));
          return Promise.resolve({ ok: true, imported: false });
        }
        if (mode === 'import') return onImportAction(bundle, options);
        return onInspect(bundle);
      }, [onImportAction, onInspect, onOpenSkill]);
      const toggle = () => {
        setOpen((value) => {
          portabilityExpanded = !value;
          return !value;
        });
      };
      return e('section', { className: 'lsc-card lsc-portability' },
        e('div', { className: 'lsc-portability-head' },
          e('button', {
            type: 'button',
            className: 'lsc-btn ghost small lsc-portability-toggle',
            'aria-expanded': open === true ? 'true' : 'false',
            onClick: toggle,
          }, `${open === true ? '[-]' : '[+]'} ${t('portability.title')}`),
          e(Pill, { tone: 'info' }, t('portability.badge')),
        ),
        e('p', { className: 'lsc-hint lsc-portability-subtitle' }, t('portability.subtitle')),
        open === false
          ? null
          : e('div', { className: 'lsc-portability-body' },
              e('p', { className: 'lsc-hint', style: { marginTop: 0 } }, t('portability.help')),
              e('p', { className: 'lsc-hint', style: { marginTop: 0 } }, t('portability.notFor')),
              e('div', { className: 'lsc-portability-grid' },
                e('div', { className: 'lsc-portability-block' },
                  e('h3', { className: 'lsc-portability-title' }, t('portability.export.title')),
                  e(ExportSkillBox, { t, skills, fixedSkillId: '', onExport, busy }),
                ),
                e('div', { className: 'lsc-portability-block' },
                  e('h3', { className: 'lsc-portability-title' }, t('portability.import.title')),
                  e(ImportSection, { t, onImport }),
                ),
              ),
            ),
      );
    }

    function LibraryView({ t, lang, snapshot, onOpen, onNew, onDetect, detect, ask, busy, onImport, onInspect, onExport, onOpenSkill }) {
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

        e(AskSection, { t, snapshot, ask }),

        e(PortabilitySection, { t, snapshot, onExport, onInspect, onImport, onOpenSkill }),

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

    /* ------------------------------------------------------- Proyectos: modelo normalizado
     *
     * Un proyecto se cuenta UNA vez. La lista normalizada fusiona las filas de `/api/projects`
     * (registros del centro), los workspaces descubiertos y —si el Host todavía no publica esa ruta—
     * el inventario heredado de `/api/workspaces`. Los recuentos del resumen salen de esa lista, nunca
     * de sumar dos payloads. Lo que el payload no trae se queda en `null` y la vista lo dice con texto:
     * nunca se pinta un «0» para representar «no se pudo comprobar».
     */

    const PROJECT_STATE_TEXT = {
      'identity-conflict': 'projects.state.identity-conflict',
      'unavailable': 'projects.state.unavailable',
      'partially-inspected': 'projects.state.partially-inspected',
      'external-managed': 'projects.state.external-managed',
      'managed': 'projects.state.managed',
      'healthy': 'projects.state.healthy',
      'discovered': 'projects.state.discovered',
    };

    const PROJECT_STATE_TONE = {
      'identity-conflict': 'bad',
      'unavailable': 'warn',
      'partially-inspected': 'warn',
      'external-managed': 'info',
      'managed': 'info',
      'healthy': 'ok',
      'discovered': 'mute',
    };

    // §1.3 del contrato: lo que cada estado permite. La UI no inventa permisos, sólo los muestra.
    const PROJECT_OPERATIONS = {
      'identity-conflict': ['read', 'inspect', 'detach-project'],
      'unavailable': ['read', 'inspect', 'detach-project', 'repair-manifest'],
      'partially-inspected': ['read', 'inspect'],
      'external-managed': ['read', 'inspect', 'adopt-project', 'detach-project'],
      'discovered': ['read', 'inspect', 'register-project'],
      'managed': ['read', 'inspect', 'register-project', 'repair-manifest', 'assign', 'materialize', 'rename', 'detach-project'],
      'healthy': ['read', 'inspect', 'assign', 'materialize', 'rename', 'repair-manifest', 'detach-project'],
    };

    const PROJECT_CHIP_IDS = ['discovered', 'managed', 'available', 'unavailable', 'conflicts', 'partial', 'skills', 'own', 'external', 'unknown', 'collisions'];

    function projectStateKey(state) { return PROJECT_STATE_TEXT[state] !== undefined ? PROJECT_STATE_TEXT[state] : 'projects.state.unknown'; }
    function projectStateTone(state) { return PROJECT_STATE_TONE[state] !== undefined ? PROJECT_STATE_TONE[state] : 'mute'; }
    function projectOperations(state) {
      const allowed = PROJECT_OPERATIONS[state];
      return Array.isArray(allowed) && allowed.length > 0 ? allowed : ['read', 'inspect'];
    }

    function normalizePath(value) {
      const raw = typeof value === 'string' ? value.trim() : '';
      if (raw === '') return '';
      return raw.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    }

    // Una ruta pertenece a un proyecto sólo si coincide exacta o si el proyecto es un prefijo
    // delimitado por separador. Comparar por subcadena (`includes`) atribuía `/repo/plugins-dhs-extra`
    // a `plugins-dhs` y duplicaba skills, colisiones y actividad entre proyectos con prefijo común.
    function pathContains(value, target) {
      const candidate = normalizePath(value);
      const wanted = normalizePath(target);
      if (candidate === '' || wanted === '') return false;
      return candidate === wanted || candidate.startsWith(wanted + '/') || candidate.endsWith('/' + wanted);
    }

    function belongsToProject(record, project) {
      const target = project?.canonicalPath ?? project?.cwd ?? '';
      if (text(target) === '') return false;
      const wanted = normalizePath(target);
      const candidates = [record?.scope?.projectRoot, record?.scope?.cwd, record?.location?.directory, record?.location?.path];
      return candidates.some((value) => {
        const candidate = normalizePath(value);
        return candidate !== '' && wanted !== '' && (candidate === wanted || candidate.startsWith(wanted + '/'));
      });
    }

    function rowBelongsToProject(row, project) {
      const target = project?.canonicalPath ?? project?.cwd ?? '';
      if (text(target) === '') return false;
      return [row?.location, row?.owner, row?.key].some((value) => pathContains(typeof value === 'string' ? value : value?.id, target));
    }

    function skillOwnerClass(record) {
      const kind = record?.owner?.kind;
      if (kind === 'lifecode') return 'own';
      if (kind === 'plugin') return 'external';
      return 'unknown';
    }

    function emptySkillStats() { return { total: 0, own: 0, external: 0, unknown: 0, shadowed: 0 }; }

    function skillStatsOf(records) {
      const stats = emptySkillStats();
      for (const record of asArray(records)) {
        stats.total += 1;
        stats[skillOwnerClass(record)] += 1;
        if (record?.association?.shadowedBy) stats.shadowed += 1;
      }
      return stats;
    }

    // Clasificación global del propietario de una skill. No es la misma que `skillOwnerClass`,
    // que colapsa filesystem/host en «desconocido» para el ámbito de un proyecto: aquí se
    // distinguen las cuatro categorías que el resumen del inventario declara por separado.
    function globalOwnerClass(record) {
      const kind = record?.owner?.kind;
      if (kind === 'lifecode') return 'own';
      if (kind === 'plugin') return 'external';
      if (kind === 'filesystem') return 'filesystem';
      if (kind === 'bundled' || kind === 'runtime') return 'host';
      return 'unknown';
    }

    function ownerByKey(summary, keys) {
      const byOwner = summary?.byOwner;
      if (!isPlainRecord(byOwner)) return null;
      for (const key of keys) if (Number.isFinite(byOwner[key])) return byOwner[key];
      return null;
    }

    // Recuento global por propietario. La fuente es SIEMPRE `summary.byOwner` del servidor: el
    // backend es quien decide qué categoría tiene cada skill (T22 publica
    // `own/external/filesystem/host/unknown`). La UI no re-clasifica por su cuenta, porque
    // hacerlo mandaba filesystem y host a «desconocido» y contradecía el total del propio payload.
    // Una categoría ausente es `null` ⇒ «sin comprobar»; nunca 0. Se toleran las claves heredadas
    // (`lifecode/plugin/local/materialized`) para no romper con un backend anterior.
    function skillOwnerSummary(inventoryData) {
      const sources = asArray(inventoryData?.sources);
      const degraded = sources.some((source) => {
        const status = text(source?.status);
        return status === 'unavailable' || status === 'error' || status === 'incomplete';
      });
      const complete = inventoryData?.complete === true && degraded === false;
      const summary = inventoryData?.summary;
      const total = Number.isFinite(summary?.total) ? summary.total : null;
      if (!isPlainRecord(summary)) {
        return { total, own: null, external: null, filesystem: null, host: null, unknown: null, partial: true, reason: 'partial' };
      }
      const value = (keys) => ownerByKey(summary, keys);
      return {
        total,
        own: value(['own', 'lifecode', 'local']),
        external: value(['external', 'plugin']),
        filesystem: value(['filesystem']),
        host: value(['host', 'bundled', 'materialized']),
        unknown: value(['unknown']),
        partial: complete !== true,
        reason: complete === true ? '' : 'partial',
      };
    }

    // Estado de inspección de un proyecto, con las distinciones que R16.3 exige: no ejecutada,
    // completa sin resultados, parcial/fuente no disponible, fallida y con skills detectadas.
    // «Sin resultados» sólo se afirma con una inspección completa y un inventario completo.
    function projectInspectionState(entry, flags) {
      if (entry.skillStats === null || entry.skillStats === undefined) return 'unknown';
      if (entry.skillStats.total > 0) return 'detected';
      const status = text(entry.inspection?.status);
      if (status === 'failed') return 'failed';
      if (flags.inventoryPartial || status === 'incomplete' || entry.state === 'partially-inspected') return 'partial';
      if (status === 'complete') return 'empty';
      return 'not-run';
    }

    function buildProjectView({ projectsData, inventoryData, legacy }) {
      const entries = [];
      const index = new Map();
      const push = (entry) => {
        if (index.has(entry.key)) return index.get(entry.key);
        index.set(entry.key, entry);
        entries.push(entry);
        return entry;
      };

      for (const project of asArray(projectsData?.projects)) {
        push({
          key: 'record:' + text(project.projectId ?? project.canonicalPath ?? project.cwd),
          origin: 'record',
          projectId: project.projectId ?? null,
          name: text(project.name) !== '' ? project.name : text(project.projectId) !== '' ? project.projectId : text(project.cwd),
          cwd: text(project.cwd) !== '' ? project.cwd : text(project.canonicalPath),
          canonicalPath: text(project.canonicalPath) !== '' ? project.canonicalPath : text(project.cwd),
          state: text(project.state) !== '' ? project.state : null,
          registration: project.registration ?? null,
          workspace: project.workspace ?? null,
          inspection: project.inspection ?? null,
          counts: project.counts ?? null,
          reasons: asArray(project.reasons),
          discoveredFlag: false,
          discovered: null,
          managedRecord: true,
          registered: project.registration?.present === true,
          record: project,
        });
      }

      for (const row of asArray(projectsData?.discovered)) {
        const match = entries.find((entry) => (entry.workspace?.workspaceId !== null && entry.workspace?.workspaceId !== undefined && entry.workspace.workspaceId === row.workspaceId)
          || (row.projectId !== null && row.projectId !== undefined && entry.projectId === row.projectId)
          || (text(entry.canonicalPath) !== '' && samePath(entry.canonicalPath, row.canonicalPath)));
        if (match) {
          match.discoveredFlag = true;
          match.discovered = row;
          if (match.workspace === null || match.workspace === undefined) {
            match.workspace = { workspaceId: row.workspaceId ?? null, title: row.title ?? '', path: row.path ?? null, availability: row.availability ?? 'unknown' };
          }
          if (match.sessionCount === undefined || match.sessionCount === null) match.sessionCount = row.sessionCount ?? null;
          if (text(match.name) === '') match.name = text(row.title) !== '' ? row.title : text(row.workspaceId);
          continue;
        }
        push({
          key: 'discovered:' + text(row.workspaceId ?? row.canonicalPath),
          origin: 'discovered',
          projectId: row.projectId ?? null,
          name: text(row.title) !== '' ? row.title : text(row.workspaceId),
          cwd: text(row.path) !== '' ? row.path : text(row.canonicalPath),
          canonicalPath: text(row.canonicalPath) !== '' ? row.canonicalPath : text(row.path),
          state: 'discovered',
          registration: null,
          workspace: { workspaceId: row.workspaceId ?? null, title: row.title ?? '', path: row.path ?? null, availability: row.availability ?? 'unknown' },
          inspection: null,
          counts: null,
          reasons: [],
          discoveredFlag: true,
          discovered: row,
          managedRecord: false,
          registered: false,
          record: null,
          sessionCount: row.sessionCount ?? null,
        });
      }

      if (legacy !== null && legacy !== undefined) {
        for (const row of asArray(legacy?.workspaces)) {
          push({
            key: 'workspace:' + text(row.workspaceId ?? row.path),
            origin: 'legacy',
            projectId: row.projectId ?? null,
            name: text(row.title) !== '' ? row.title : text(row.workspaceId),
            cwd: text(row.path) !== '' ? row.path : '',
            canonicalPath: text(row.canonicalPath) !== '' ? row.canonicalPath : text(row.path),
            state: 'discovered',
            registration: null,
            workspace: {
              workspaceId: row.workspaceId ?? null,
              title: row.title ?? '',
              path: row.path ?? null,
              availability: row.status === 'ok' ? 'ok' : row.status === 'missing-dir' ? 'missing-dir' : 'unknown',
            },
            inspection: null,
            counts: null,
            reasons: text(row.reason) !== '' ? [row.reason] : [],
            discoveredFlag: true,
            discovered: row,
            managedRecord: false,
            registered: false,
            record: null,
            sessionCount: Number.isFinite(row.sessionCount) ? row.sessionCount : null,
            legacyRow: row,
            derivedState: true,
          });
        }
        for (const row of asArray(legacy?.managed)) {
          push({
            key: 'legacy-managed:' + text(row.projectId ?? row.cwd ?? row.path),
            origin: 'legacy-managed',
            projectId: row.projectId ?? null,
            name: text(row.name) !== '' ? row.name : text(row.projectId ?? row.cwd),
            cwd: text(row.cwd) !== '' ? row.cwd : text(row.path),
            canonicalPath: text(row.cwd) !== '' ? row.cwd : text(row.path),
            state: 'managed',
            registration: null,
            workspace: { workspaceId: row.workspaceId ?? null, title: row.workspaceTitle ?? row.title ?? '', path: row.path ?? null, availability: 'unknown' },
            inspection: null,
            counts: null,
            reasons: [],
            discoveredFlag: false,
            discovered: null,
            managedRecord: true,
            registered: true,
            record: row,
            legacyRow: row,
            derivedState: true,
          });
        }
      }

      const inventoryEntries = asArray(inventoryData?.entries);
      const inventoryCollisions = asArray(inventoryData?.collisions);
      const currentWorkspaceId = text(projectsData?.current?.workspaceId) !== '' ? projectsData.current.workspaceId : null;
      // Modo heredado: el backend no publica inventario, así que la UI no atribuye skills, colisiones
      // ni conflictos. Esos valores se quedan en `null` y la vista escribe «sin comprobar».
      const legacyMode = projectsData === null || projectsData === undefined;
      const inventoryComplete = inventoryData !== null && inventoryData !== undefined && inventoryData.complete !== false;
      const inventoryTruncated = inventoryData?.truncated === true;
      const inspectionFlags = { inventoryPartial: !legacyMode && (inventoryComplete === false || inventoryTruncated === true) };
      for (const entry of entries) {
        entry.availability = entry.workspace?.availability ?? 'unknown';
        if (entry.sessionCount === undefined) entry.sessionCount = entry.discovered?.sessionCount ?? null;
        entry.skills = legacyMode ? [] : inventoryEntries.filter((record) => belongsToProject(record, entry));
        entry.skillStats = legacyMode ? null : skillStatsOf(entry.skills);
        entry.collisions = legacyMode ? [] : inventoryCollisions.filter((collision) => asArray(collision.rows).some((row) => rowBelongsToProject(row, entry)));
        entry.hasConflict = legacyMode ? false : entry.state === 'identity-conflict' || entry.collisions.length > 0;
        entry.managedRecord = entry.origin === 'record' || entry.origin === 'legacy-managed';
        entry.isCurrent = entry.workspace?.workspaceId !== null && entry.workspace?.workspaceId !== undefined && currentWorkspaceId !== null && entry.workspace.workspaceId === currentWorkspaceId;
        entry.inspectionStatus = text(entry.inspection?.status) !== '' ? entry.inspection.status : 'not-run';
        entry.inspectionState = projectInspectionState(entry, inspectionFlags);
      }
      entries.sort((left, right) => String(left.name).localeCompare(String(right.name)));

      const countWhere = (predicate) => entries.filter(predicate).length;
      const inventoryAvailable = !legacyMode && inventoryData !== null && inventoryData !== undefined;
      const ownerSummary = inventoryAvailable ? skillOwnerSummary(inventoryData) : null;
      // Sin handshake compatible y sin inventario heredado no se cargó NADA: los recuentos de
      // proyectos tampoco se pueden afirmar, así que se informan como «sin comprobar», no como 0.
      const noDataMode = (projectsData === null || projectsData === undefined) && (legacy === null || legacy === undefined);
      const summary = {
        discovered: noDataMode ? null : countWhere((entry) => entry.discoveredFlag === true),
        managed: noDataMode ? null : countWhere((entry) => entry.managedRecord === true),
        available: noDataMode ? null : countWhere((entry) => entry.availability === 'ok'),
        unavailable: noDataMode ? null : countWhere((entry) => entry.availability === 'missing-dir'),
        unknownAvailability: noDataMode ? null : countWhere((entry) => entry.availability === 'unknown'),
        conflicts: legacyMode ? null : countWhere((entry) => entry.hasConflict === true),
        partial: legacyMode ? null : countWhere((entry) => entry.state === 'partially-inspected' || entry.inspection?.status === 'incomplete'),
        skills: ownerSummary === null ? null : ownerSummary.total,
        own: ownerSummary === null ? null : ownerSummary.own,
        external: ownerSummary === null ? null : ownerSummary.external,
        unknown: ownerSummary === null ? null : ownerSummary.unknown,
        collisions: inventoryAvailable ? inventoryCollisions.length : null,
        complete: legacyMode ? null : projectsData.complete === true,
        truncated: inventoryAvailable ? inventoryData.truncated === true : false,
        generatedAt: projectsData?.generatedAt ?? inventoryData?.generatedAt ?? null,
        sources: { projects: asArray(projectsData?.sources), inventory: asArray(inventoryData?.sources) },
        legacy: legacy !== null && legacy !== undefined,
        inventoryAvailable,
        legacyMode,
        // Recuento global por propietario (propias / externas / en disco / host / desconocidas).
        // Es global, no por proyecto: la vista lo declara así para no mezclar ambas escalas.
        ownerSummary,
      };
      return {
        entries,
        summary,
        inventoryAvailable,
        generatedAt: summary.generatedAt,
        inventory: {
          available: inventoryAvailable,
          complete: inventoryAvailable ? inventoryComplete : null,
          truncated: inventoryAvailable ? inventoryTruncated : null,
          sources: asArray(inventoryData?.sources),
          entries: inventoryEntries,
          collisions: inventoryCollisions,
          ownerSummary: inventoryAvailable ? skillOwnerSummary(inventoryData) : null,
        },
      };
    }

    function projectChipPredicate(id) {
      switch (id) {
        case 'discovered': return (entry) => entry.discoveredFlag === true;
        case 'managed': return (entry) => entry.managedRecord === true;
        case 'available': return (entry) => entry.availability === 'ok';
        case 'unavailable': return (entry) => entry.availability === 'missing-dir';
        case 'conflicts': return (entry) => entry.hasConflict === true;
        case 'partial': return (entry) => entry.state === 'partially-inspected' || entry.inspection?.status === 'incomplete';
        case 'skills': return (entry) => (entry.skillStats?.total ?? 0) > 0;
        case 'own': return (entry) => (entry.skillStats?.own ?? 0) > 0;
        case 'external': return (entry) => (entry.skillStats?.external ?? 0) > 0;
        case 'unknown': return (entry) => (entry.skillStats?.unknown ?? 0) > 0;
        case 'collisions': return (entry) => asArray(entry.collisions).length > 0;
        default: return null;
      }
    }

    function filterProjectEntries(entries, filter) {
      const predicate = projectChipPredicate(filter);
      return predicate === null ? entries : entries.filter(predicate);
    }

    function projectSignature(state) {
      const map = new Map();
      for (const project of asArray(state?.projectsData?.projects)) {
        map.set('r:' + text(project.projectId ?? project.canonicalPath), [project.state, project.registration?.present, project.workspace?.availability].join('|'));
      }
      for (const row of asArray(state?.projectsData?.discovered)) {
        map.set('d:' + text(row.workspaceId ?? row.canonicalPath), String(row.availability));
      }
      return map;
    }

    function countProjectChanges(previous, next) {
      if (previous === null || previous === undefined || (previous.projectsData === null && previous.inventoryData === null)) return 0;
      const before = projectSignature(previous);
      const after = projectSignature(next);
      let changes = 0;
      for (const [key, value] of after) if (!before.has(key) || before.get(key) !== value) changes += 1;
      for (const key of before.keys()) if (!after.has(key)) changes += 1;
      const skillsBefore = previous.inventoryData?.summary?.total;
      const skillsAfter = next.inventoryData?.summary?.total;
      if (Number.isFinite(skillsBefore) && Number.isFinite(skillsAfter) && skillsBefore !== skillsAfter) changes += Math.abs(skillsAfter - skillsBefore);
      const collisionsBefore = asArray(previous.inventoryData?.collisions).length;
      const collisionsAfter = asArray(next.inventoryData?.collisions).length;
      if (collisionsBefore !== collisionsAfter) changes += Math.abs(collisionsAfter - collisionsBefore);
      return changes;
    }

    function formatClock(value, lang) {
      if (value === null || value === undefined || value === '') return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      try {
        return date.toLocaleTimeString(lang === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch (failure) {
        return '';
      }
    }

    function sessionText(t, count) {
      return count === null || count === undefined ? t('projects.sessions.unknown') : t('projects.sessions.value', { n: count });
    }

    function inspectionText(t, status, reason) {
      const key = status === 'complete' ? 'projects.inspection.complete'
        : status === 'incomplete' ? 'projects.inspection.incomplete'
          : status === 'failed' ? 'projects.inspection.failed'
            : 'projects.inspection.not-run';
      const label = t(key);
      return text(reason) === '' ? label : label + ' · ' + t('projects.inspection.reason', { reason });
    }

    function sourceStatusText(t, status) {
      if (status === 'complete') return t('projects.source.complete');
      if (status === 'incomplete') return t('projects.source.incomplete');
      if (status === 'unavailable') return t('projects.source.unavailable');
      if (status === 'error') return t('projects.source.error');
      return t('projects.source.unknown');
    }

    function dialogTarget(view, dialog) {
      const entries = asArray(view?.entries);
      let entry = null;
      if (text(dialog?.workspaceId) !== '') {
        entry = entries.find((candidate) => candidate.workspace?.workspaceId === dialog.workspaceId || candidate.discovered?.workspaceId === dialog.workspaceId) ?? null;
      }
      if (entry === null && text(dialog?.cwd) !== '') {
        entry = entries.find((candidate) => samePath(candidate.canonicalPath, dialog.cwd) || samePath(candidate.cwd, dialog.cwd)) ?? null;
      }
      const cwd = text(dialog?.cwd) !== '' ? dialog.cwd : (entry?.canonicalPath ?? '');
      const matches = entries.filter((candidate) => candidate.managedRecord === true && candidate !== entry
        && (samePath(candidate.canonicalPath, cwd) || (text(dialog?.projectId) !== '' && candidate.projectId === dialog.projectId)));
      return { entry, cwd, matches };
    }

    function buildPreflight(view, dialog) {
      const target = dialogTarget(view, dialog);
      const entry = target.entry;
      const state = entry?.state ?? 'discovered';
      const allowed = projectOperations(state);
      const blocked = [];
      if (!allowed.includes('register-project')) blocked.push({ reason: 'state', state });
      if (target.cwd === '') blocked.push({ reason: 'noPath' });
      if (target.matches.length > 0) blocked.push({ reason: 'alreadyRegistered' });
      const sources = [...asArray(view?.summary?.sources?.projects), ...asArray(view?.summary?.sources?.inventory)];
      const coverageComplete = view?.summary?.complete === true && view?.inventoryAvailable === true
        && sources.every((source) => source.status === 'complete');
      return {
        target,
        entry,
        state,
        allowed,
        blocked,
        skills: entry?.skillStats ?? emptySkillStats(),
        collisions: entry?.collisions ?? [],
        sources,
        coverageComplete,
        canConfirm: blocked.length === 0 && target.cwd !== '',
      };
    }

    /**
     * Banner del handshake. Es el ÚNICO sitio donde se explica el modo: en `legacy-compatible` no
     * hay banners rojos de `/api/projects` ni de `/api/inventory` porque esas rutas no se consultan.
     */
    function CompatBanner({ t, compat, busy, onRetry, onCopyDiagnostics }) {
      if (!isPlainRecord(compat) || compat.state === 'compatible-r16') return null;
      const state = compat.state;
      const retry = typeof onRetry === 'function'
        ? e('button', {
            type: 'button',
            className: 'lsc-btn ghost small',
            disabled: busy === true,
            title: busy === true ? t('projects.refresh.loading') : t('projects.refresh.title'),
            onClick: () => { if (busy === true) return; onRetry(); },
          }, t('projects.boundary.retry'))
        : null;
      if (state === 'legacy-compatible') {
        return e('div', { className: 'lsc-notice', role: 'status' },
          e('strong', null, t('projects.compat.legacy.title')),
          e('p', null, t('projects.compat.legacy.body')),
          e('p', { className: 'lsc-hint' }, t('projects.compat.legacy.refresh')),
        );
      }
      const title = state === 'backend-incompatible' ? t('projects.compat.incompatible.title')
        : state === 'authentication-error' ? t('projects.compat.auth.title')
          : t('projects.compat.unavailable.title');
      const body = state === 'backend-incompatible' ? t('projects.compat.incompatible.body')
        : state === 'authentication-error' ? t('projects.compat.auth.body', { status: compat.http })
          : t('projects.compat.unavailable.body', { reason: text(compat.code) !== '' ? compat.code : 'HTTP ' + compat.http });
      const details = [];
      if (state === 'backend-incompatible') {
        const backend = text(compat.backendVersion) !== ''
          ? compat.backendVersion + (Number.isFinite(compat.contractVersion) ? ' (contrato ' + compat.contractVersion + ')' : '')
          : (Number.isFinite(compat.contractVersion) ? 'contrato ' + compat.contractVersion : t('projects.compat.unknownVersion'));
        details.push(e('p', { key: 'revision' }, t('projects.compat.revision', { client: CLIENT_CONTRACT_VERSION, backend })));
      }
      if (Number.isFinite(compat.http) && compat.http > 0) {
        details.push(e('p', { key: 'http', className: 'lsc-hint' }, t('projects.compat.http', {
          status: compat.http,
          code: text(compat.code) === '' ? '' : ' · ' + t('projects.error.code', { code: compat.code }),
        })));
      }
      const copy = state === 'backend-incompatible' && typeof onCopyDiagnostics === 'function'
        ? e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: () => onCopyDiagnostics() }, t('projects.compat.copy'))
        : null;
      return e('div', { className: 'lsc-notice bad', role: 'alert' },
        e('strong', null, title),
        e('p', null, body),
        ...details,
        (copy !== null || retry !== null) ? e('div', { className: 'lsc-row', style: { gap: 8, flexWrap: 'wrap' } }, copy, retry) : null,
      );
    }

    function ProjectStatusBar({ t, lang, report, summary, busy, onRefresh }) {
      const rows = [];
      if (report !== null && report !== undefined) {
        for (const failure of asArray(report.errors)) {
          rows.push(e('div', { key: 'error:' + failure.id, className: 'lsc-notice bad' },
            e('strong', null, t(failure.id === 'inventory' ? 'projects.refresh.error.inventory' : 'projects.refresh.error.projects')),
            e('p', null, `HTTP ${failure.status} · ${t('projects.error.code', { code: failure.code })}${text(failure.message) === '' ? '' : ' · ' + failure.message}`),
          ));
        }
        if (report.errors.length === 0 && report.complete === false) {
          rows.push(e('div', { key: 'partial', className: 'lsc-notice' }, e('p', null, t('projects.refresh.partial'))));
        }
        if (report.truncated === true) {
          rows.push(e('div', { key: 'truncated', className: 'lsc-notice' }, e('p', null, t('projects.refresh.truncated'))));
        }
        if (report.stale === true) {
          rows.push(e('div', { key: 'stale', className: 'lsc-notice' }, e('p', null, t('projects.refresh.stale'))));
        }
      }
      let status = t('projects.refresh.never');
      let tone = 'mute';
      if (busy === true) { status = t('projects.refresh.loading'); tone = 'info'; }
      else if (report !== null && report !== undefined) {
        if (report.legacy === true) { status = t('projects.refresh.legacy.state'); tone = 'warn'; }
        else if (text(report.compat) !== '' && report.compat !== 'compatible-r16') {
          status = report.compat === 'backend-incompatible' ? t('projects.compat.incompatible.title')
            : report.compat === 'authentication-error' ? t('projects.compat.auth.title')
              : t('projects.compat.unavailable.title');
          tone = 'bad';
        }
        else if (report.errors.length > 0) { status = t('projects.refresh.failed'); tone = 'bad'; }
        else {
          const changes = report.changes === 1 ? t('projects.refresh.change.one', { n: 1 }) : t('projects.refresh.change.many', { n: report.changes });
          status = t('projects.refresh.success', { workspaces: summary.discovered, managed: summary.managed, changes });
          if (text(formatClock(report.at, lang)) !== '') status += ' · ' + t('projects.refresh.at', { time: formatClock(report.at, lang) });
          tone = 'ok';
        }
      }
      const sourceRows = [];
      for (const source of asArray(report?.sourceRows)) sourceRows.push(source);
      return e('div', null,
        e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 8, marginBottom: 8 } },
          e('span', { className: 'lsc-hint' }, t('projects.discover.hint')),
          e('span', { className: 'lsc-spacer' }),
          e(Pill, { tone }, status),
          e('button', {
            type: 'button',
            className: 'lsc-btn small',
            disabled: busy === true,
            title: busy === true ? t('projects.refresh.loading') : t('projects.refresh.title'),
            onClick: () => { if (busy === true) return; onRefresh(); },
          }, busy === true ? t('projects.refresh.loading') : t('projects.discover.refresh')),
        ),
        rows,
      );
    }

    function ProjectChipBar({ t, summary, active, onFilter, onOpenCollisions }) {
      return e('div', null,
        e('div', { className: 'lsc-chip-row', role: 'group', 'aria-label': t('projects.chip.group') }, PROJECT_CHIP_IDS.map((id) => {
          const count = summary[id] === undefined ? null : summary[id];
          const pressed = active === id;
          const label = count === null ? t('projects.chip.pending') : t('projects.chip.' + id + (count === 1 ? '.one' : '.many'), { n: count });
          return e('button', {
            key: id,
            type: 'button',
            className: cx('lsc-chip', count === null ? 'pending' : null),
            'aria-pressed': pressed ? 'true' : 'false',
            disabled: count === null,
            title: t('projects.chip.' + id + '.def') + (count === null ? ' · ' + t('projects.chip.pendingReason') : ''),
            onClick: () => {
              if (count === null) return;
              // El indicador de conflictos de proyecto además abre la vista global de colisiones:
              // son dos escalas distintas y la vista lo explica.
              if (id === 'collisions' && typeof onOpenCollisions === 'function') onOpenCollisions();
              onFilter(pressed ? null : id);
            },
          }, label);
        })),
        e(ProjectInventoryBar, { t, summary }),
        active !== null
          ? e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 8, marginBottom: 8 } },
              e('span', { className: 'lsc-summary-def' }, t('projects.chip.definition', { definition: t('projects.chip.' + active + '.def') })),
              e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: () => onFilter(null) }, t('projects.chip.clear')),
            )
          : e('p', { className: 'lsc-summary-def' }, t('projects.chip.hint')),
      );
    }

    // Resumen del inventario GLOBAL. Se pinta aparte de los filtros porque cuenta skills, no
    // proyectos: mezclar ambas escalas era el defecto que hacía parecer vacío un inventario de 85
    // skills. Una categoría que el payload no publica se declara «sin comprobar», nunca 0.
    const OWNER_SUMMARY_IDS = ['own', 'external', 'filesystem', 'host', 'unknown'];
    function ProjectInventoryBar({ t, summary }) {
      const owners = summary?.ownerSummary;
      if (!isPlainRecord(owners)) return null;
      const total = Number.isFinite(owners.total) ? owners.total : null;
      const chips = OWNER_SUMMARY_IDS.map((id) => {
        const count = Number.isFinite(owners[id]) ? owners[id] : null;
        // Un 0 sólo se pinta cuando la categoría está determinada. Si falta, el chip lo dice y su
        // `title` explica por qué: inventario parcial/fuentes caídas o categoría no publicada.
        const reason = owners.partial === true ? t('projects.owner.reason.partial') : t('projects.owner.reason.undetermined');
        return e('span', {
          key: id,
          className: cx('lsc-pill', count === null ? 'mute' : 'info'),
          title: count === null ? t('projects.owner.def.' + id) + ' · ' + reason : t('projects.owner.def.' + id),
        }, count === null ? t('projects.owner.pending.' + id) : t('projects.owner.count.' + id, { n: count }));
      });
      return e('div', { className: 'lsc-inventory-bar' },
        e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
          e('strong', { className: 'lsc-inventory-title' }, t('projects.owner.title')),
          total === null ? e(Pill, { tone: 'mute' }, t('projects.owner.pending.total')) : e(Pill, { tone: 'mute' }, t('projects.owner.count.total', { n: total })),
          e('span', { className: 'lsc-spacer' }),
          chips,
        ),
        e('p', { className: 'lsc-hint' }, t('projects.owner.hint', { collisions: summary.collisions === null || summary.collisions === undefined ? '?' : summary.collisions, conflicts: summary.conflicts === null || summary.conflicts === undefined ? '?' : summary.conflicts })),
      );
    }

    function ProjectCard({ t, lang, entry, mode, openWorkspaceAvailable, r16ActionsEnabled, blockedReason, identityUnchecked, globalSkills, opening, inspecting, onOpenWorkspace, onInspect, onManage, onDetail, onWork, onOpenSkill }) {
      const workspaceId = entry.workspace?.workspaceId ?? null;
      const canOpen = workspaceId !== null && workspaceId !== undefined && openWorkspaceAvailable === true;
      const openReason = workspaceId === null || workspaceId === undefined
        ? t('projects.open.noWorkspace')
        : (openWorkspaceAvailable === true ? '' : t('projects.open.noPanel'));
      const openBusy = opening === entry.key;
      const inspectBusy = inspecting === entry.key;
      const disabledOpen = openBusy || !canOpen;
      const uuid = entry.registration?.uuid ?? null;
      const stateLabel = entry.state === null || entry.state === undefined ? t('projects.state.unknown') : t(projectStateKey(entry.state));
      const availabilityLabel = entry.availability === 'ok' ? t('projects.availability.ok')
        : entry.availability === 'missing-dir' ? t('projects.availability.missing')
          : t('projects.availability.unknown');
      // Con backend heredado no se consultó la identidad: afirmar «sin UUID» sería inventar un dato
      // no consultado, así que la tarjeta lo declara como no comprobado.
      const identityLine = identityUnchecked === true
        ? t('projects.card.identityUnknown')
        : (uuid !== null && uuid !== undefined && String(uuid) !== ''
          ? t('projects.card.uuid', { uuid: shortSha(String(uuid)) })
          : (entry.projectId !== null && entry.projectId !== undefined && text(entry.projectId) !== ''
            ? t('projects.card.projectId', { id: String(entry.projectId) })
            : t('projects.card.uuidNone')));
      const detected = entry.discovered?.detectedAt ?? entry.record?.detectedAt ?? null;
      const inspectedAt = entry.inspection?.inspectedAt ?? null;
      const sourceLabel = entry.origin === 'record' ? t('projects.card.source.record')
        : entry.origin === 'legacy-managed' ? t('projects.card.source.legacy')
          : entry.origin === 'legacy' ? t('projects.card.source.legacy')
            : t('projects.card.source.workspace');
      const actionsAllowed = r16ActionsEnabled === true;
      const actionReason = actionsAllowed ? '' : text(blockedReason);
      const globalTotal = Number.isFinite(globalSkills) ? globalSkills : null;
      // Una inspección no ejecutada NUNCA se pinta como «ninguna encontrada»: son estados
      // distintos y confundirlos era el defecto que hacía parecer vacío un inventario global.
      const skillsLine = entry.inspectionState === 'unknown' || entry.inspectionState === undefined
        ? t('projects.card.skills.unknown')
        : entry.inspectionState === 'detected'
          ? t('projects.card.skills.values', { total: entry.skillStats.total, own: entry.skillStats.own, external: entry.skillStats.external, unknown: entry.skillStats.unknown })
          : entry.inspectionState === 'partial'
            ? t('projects.card.skills.partial')
            : entry.inspectionState === 'failed'
              ? t('projects.card.skills.failed')
              : entry.inspectionState === 'empty'
                ? t('projects.card.skills.empty', { global: globalTotal === null ? '?' : globalTotal })
                : t('projects.card.skills.notRun');

      const actions = [];
      if (mode === 'discovered') {
        actions.push(e('button', {
          key: 'open',
          type: 'button',
          className: 'lsc-btn ghost small',
          disabled: disabledOpen,
          title: openReason,
          onClick: () => { if (disabledOpen) return; onOpenWorkspace(entry, workspaceId); },
        }, openBusy ? t('projects.card.opening') : t('projects.discover.open')));
      }
      actions.push(e('button', {
        key: 'inspect',
        type: 'button',
        className: 'lsc-btn ghost small',
        disabled: inspectBusy || !actionsAllowed,
        title: !actionsAllowed ? actionReason : (inspectBusy ? t('projects.card.inspecting') : t('projects.inspect.readonly')),
        onClick: () => { if (inspectBusy || !actionsAllowed) return; onInspect(entry); },
      }, inspectBusy ? t('projects.card.inspecting') : t('projects.card.inspect')));
      actions.push(e('button', {
        key: 'manage',
        type: 'button',
        className: 'lsc-btn small',
        disabled: !actionsAllowed,
        title: actionsAllowed ? '' : actionReason,
        onClick: () => { if (!actionsAllowed) return; onManage(entry); },
      }, t('projects.card.manage')));
      if (mode === 'managed') {
        if (entry.isCurrent !== true && typeof onWork === 'function') {
          actions.push(e('button', {
            key: 'work',
            type: 'button',
            className: 'lsc-btn ghost small',
            onClick: () => onWork(entry),
          }, t('projects.open')));
        }
        actions.push(e('button', {
          key: 'open',
          type: 'button',
          className: 'lsc-btn ghost small',
          disabled: disabledOpen,
          title: openReason,
          onClick: () => { if (disabledOpen) return; onOpenWorkspace(entry, workspaceId); },
        }, openBusy ? t('projects.card.opening') : t('projects.discover.open')));
      }

      return e('div', { className: cx('lsc-project-card', mode === 'discovered' ? 'unmanaged' : null), key: entry.key },
        e(Section, { title: entry.name, hint: entry.cwd },
          e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 5 } },
            e(Pill, { tone: projectStateTone(entry.state) }, stateLabel),
            e(Pill, {
              tone: entry.availability === 'ok' ? 'ok' : entry.availability === 'missing-dir' ? 'warn' : 'mute',
              title: entry.availability === 'unknown' ? t('projects.availability.unknownLong') : '',
            }, availabilityLabel),
            entry.registered === true
              ? e(Pill, { tone: 'info' }, t('projects.card.registered'))
              : e(Pill, { tone: 'warn' }, t('projects.card.unmanaged')),
            entry.hasConflict ? e(Pill, { tone: 'bad' }, t('projects.card.conflicts', { n: entry.collisions.length })) : null,
            entry.isCurrent ? e(Pill, { tone: 'info' }, t('projects.this')) : null,
            entry.derivedState ? e(Pill, { tone: 'mute', title: t('projects.card.derived') }, t('projects.card.derivedShort')) : null,
          ),
          e('div', { className: 'lsc-project-path', style: { margin: '3px 0 2px' } }, entry.cwd),
          e('div', { className: 'lsc-project-meta' },
            e('span', null, sessionText(t, entry.sessionCount)),
            e('span', null, t('projects.card.source', { source: sourceLabel })),
            e('span', { title: text(detected) === '' ? t('projects.card.detectedUnknown') : '' }, t('projects.card.detected', { at: text(detected) === '' ? t('projects.card.detectedUnknown') : formatDate(detected, lang) })),
          ),
          e('div', { className: 'lsc-project-meta' },
            e('span', null, t('projects.card.identity') + ': ' + identityLine),
            e('span', null, t('projects.card.skills') + ': ' + skillsLine),
          ),
          e('div', { className: 'lsc-project-meta' },
            e('span', { className: 'lsc-nowrap' }, t('projects.card.inspection') + ': ' + (entry.derivedState === true && (entry.inspection === null || entry.inspection === undefined) ? t('projects.inspection.unknown') : inspectionText(t, entry.inspectionStatus, entry.inspection?.reason))),
            text(inspectedAt) === '' ? null : e('span', null, t('projects.card.inspectedAt', { at: formatDate(inspectedAt, lang) })),
          ),
          (entry.counts !== null && entry.counts !== undefined)
            ? e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 5, marginTop: 4 } },
                e(Pill, { tone: baseTone(entry.counts.active) }, t('projects.counts.active', { n: entry.counts.active ?? 0 })),
                e(Pill, { tone: baseTone(entry.counts.assigned) }, t('projects.counts.assigned', { n: entry.counts.assigned ?? 0 })),
                e(Pill, { tone: baseTone(entry.counts.materialized) }, materializedLabel(t, lang, entry.counts.materialized)),
              )
            : null,
          e('div', { className: 'lsc-project-actions' }, actions),
          mode === 'discovered' ? e('p', { className: 'lsc-hint', style: { marginTop: 8 } }, t('projects.card.unmanagedHint')) : null,
          mode === 'managed' ? e('div', { style: { marginTop: 8 } }, e('button', {
            type: 'button',
            className: 'lsc-btn ghost small',
            disabled: !actionsAllowed,
            title: actionsAllowed ? '' : actionReason,
            onClick: () => { if (!actionsAllowed) return; onDetail(entry); },
          }, t('projects.card.detail'))) : null,
        ),
      );
    }

    function ProjectCardGrid({ t, lang, entries, mode, empty, openWorkspaceAvailable, r16ActionsEnabled, blockedReason, identityUnchecked, globalSkills, opening, inspecting, onOpenWorkspace, onInspect, onManage, onDetail, onWork, onOpenSkill }) {
      if (entries.length === 0) return e(Empty, null, empty);
      return e('div', { className: 'lsc-project-grid' }, entries.map((entry) => e(ProjectCard, {
        key: entry.key,
        t,
        lang,
        entry,
        mode,
        openWorkspaceAvailable,
        r16ActionsEnabled,
        blockedReason,
        identityUnchecked,
        globalSkills,
        opening,
        inspecting,
        onOpenWorkspace,
        onInspect,
        onManage,
        onDetail,
        onWork,
        onOpenSkill,
      })));
    }

    const COLLISION_CODE_LIST = ['identity-duplicate', 'name-collision', 'path-collision', 'content-collision', 'assignment-shadowed', 'legacy-collision'];
    const COLLISION_SEVERITY_LIST = ['block', 'warn', 'info'];

    function collisionOwnerLabel(row) {
      const owner = row?.owner;
      if (typeof owner === 'string' && owner !== '') return owner;
      return text(owner?.kind);
    }

    // Vista global de colisiones del inventario: sólo lectura. Las colisiones son globales y no se
    // atribuyen a proyectos, por eso viven aquí y no en el contador de conflictos por proyecto.
    function CollisionsView({ t, lang, inventory, onOpenSkill }) {
      const [code, setCode] = useState('');
      const [severity, setSeverity] = useState('');
      const [owner, setOwner] = useState('');
      const collisions = asArray(inventory?.collisions);
      const available = inventory?.available === true;
      if (!available) {
        return e(Section, { title: t('projects.tab.collisions'), hint: t('projects.collisions.subtitle') }, e(Empty, null, t('projects.collisions.unchecked')));
      }
      const owners = [...new Set(collisions.flatMap((collision) => asArray(collision.rows).map(collisionOwnerLabel)).filter((value) => value !== ''))].sort();
      const filtered = collisions.filter((collision) => (code === '' || collision.code === code)
        && (severity === '' || collision.severity === severity)
        && (owner === '' || asArray(collision.rows).some((row) => collisionOwnerLabel(row) === owner)));
      // Agrupación por código: el backend puede devolver decenas de colisiones del mismo tipo
      // (46 `legacy-collision` en el Host real). La vista cuenta por grupo y no repite una fila
      // por cada entrada: primero se ve el tipo, luego sus casos.
      const groupCounts = new Map();
      for (const collision of filtered) {
        const id = text(collision.code);
        groupCounts.set(id, (groupCounts.get(id) ?? 0) + 1);
      }
      const ROW_LIMIT = 8;
      const select = (value, onChange, options, label) => e('select', {
        className: 'lsc-select',
        style: { fontSize: 11, padding: '3px 6px' },
        value,
        title: label,
        onChange: (event) => onChange(event.target.value),
      }, options.map((item) => e('option', { key: item.value, value: item.value }, item.label)));
      const severityTone = (value) => (value === 'block' ? 'bad' : value === 'warn' ? 'warn' : 'mute');
      return e(Section, { title: t('projects.tab.collisions'), hint: t('projects.collisions.subtitle') },
        e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 6, marginBottom: 8 } },
          select(code, setCode, [
            { value: '', label: t('projects.collisions.filter.codeAll') },
            ...COLLISION_CODE_LIST.map((id) => ({ value: id, label: id })),
          ], t('projects.collisions.filter.code')),
          select(severity, setSeverity, [
            { value: '', label: t('projects.collisions.filter.severityAll') },
            ...COLLISION_SEVERITY_LIST.map((id) => ({ value: id, label: t('projects.collisions.severity.' + id) })),
          ], t('projects.collisions.filter.severity')),
          select(owner, setOwner, [
            { value: '', label: t('projects.collisions.filter.ownerAll') },
            ...owners.map((id) => ({ value: id, label: id })),
          ], t('projects.collisions.filter.owner')),
          e('span', { className: 'lsc-spacer' }),
          e(Pill, { tone: 'info' }, t('projects.collisions.count', { n: filtered.length, total: collisions.length })),
        ),
        collisions.length === 0
          ? e(Empty, null, t('projects.collisions.empty'))
          : filtered.length === 0
            ? e(Empty, null, t('projects.collisions.filter.empty'))
            : e('div', null,
              e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 6, marginBottom: 8 } },
                [...groupCounts.entries()].map(([id, count]) => e(Pill, {
                  key: 'group:' + id,
                  tone: id === 'legacy-collision' ? 'mute' : severityTone(asArray(filtered.find((collision) => text(collision.code) === id)?.severity)),
                }, id + ' · ' + count)),
              ),
              filtered.map((collision) => {
                const rows = asArray(collision.rows);
                const visibleRows = rows.slice(0, ROW_LIMIT);
                return e('div', { key: text(collision.code) + ':' + text(collision.key), className: 'lsc-collision-row' },
                  e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
                    e(Pill, { tone: severityTone(collision.severity) }, t('projects.collisions.severity.' + (text(collision.severity) !== '' ? collision.severity : 'info'))),
                    e('span', { className: 'lsc-mono', style: { fontSize: 11 } }, text(collision.code)),
                    e('span', { style: { fontSize: 11, fontWeight: 600, wordBreak: 'break-word' } }, text(collision.key)),
                    text(collision.code) === 'legacy-collision'
                      ? e(Pill, { tone: 'mute' }, t('projects.collisions.legacyLabel'))
                      : null,
                    (() => {
                      const declared = Number.isFinite(collision.count) && collision.count > rows.length ? collision.count : rows.length;
                      return declared > ROW_LIMIT ? e(Pill, { tone: 'mute' }, t('projects.collisions.groupCount', { n: declared })) : null;
                    })(),
                  ),
                  text(collision.explanation) === '' ? null : e('p', { className: 'lsc-hint', style: { margin: '4px 0' } }, collision.explanation),
                  visibleRows.length === 0 ? null : e('div', { className: 'lsc-col', style: { gap: 2 } }, visibleRows.map((row, index) => {
                    const label = [collisionOwnerLabel(row), text(row?.location)].filter((part) => part !== '').join(' · ');
                    return typeof onOpenSkill === 'function' && text(row?.key) !== ''
                      ? e('button', {
                          key: 'row:' + text(row?.key ?? index),
                          type: 'button',
                          className: 'lsc-btn ghost small',
                          style: { padding: 0, border: 0, textAlign: 'left', fontSize: 11 },
                          title: t('projects.collisions.openSkill'),
                          onClick: () => onOpenSkill(row.key),
                        }, label === '' ? text(row?.key) : label)
                      : e('span', { key: 'row:' + index, className: 'lsc-hint' }, label === '' ? text(row?.key) : label);
                  })),
                  rows.length > visibleRows.length
                    ? e('p', { className: 'lsc-hint', style: { margin: '4px 0 0' } }, t('projects.collisions.moreRows', { n: rows.length - visibleRows.length }))
                    : null,
                );
              })),
        e('p', { className: 'lsc-hint', style: { marginTop: 8 } }, t('projects.collisions.readonly')),
      );
    }

    // Ficha de una skill del inventario, en sólo lectura. Muestra el dato real de cada campo y
    // declara «no registrado» cuando el Host no publica UUID/versión (son de la biblioteca, no del
    // cargador). No inventa propietario: si el plugin no está mapeado, lo dice.
    function SkillDetailDialog({ t, lang, entry, collisions, onClose, onExport }) {
      // Los hooks van antes del early return: si el diálogo aparece y desaparece, React exige que el
      // orden de hooks sea el mismo en cada render de esta posición.
      const [exportResult, setExportResult] = useState(null);
      const [exportBusy, setExportBusy] = useState(false);
      if (entry === null || entry === undefined) return null;
      const owner = entry.owner ?? {};
      const origin = entry.origin ?? {};
      const location = entry.location ?? {};
      const scope = entry.scope ?? {};
      const association = entry.association ?? {};
      const execution = entry.execution ?? {};
      const identity = entry.identity ?? {};
      const reasons = asArray(entry.reasons);
      const touching = asArray(collisions);
      const ownerClass = globalOwnerClass(entry);
      const ownerLabel = ownerClass === 'own' ? t('projects.ficha.skills.own')
        : ownerClass === 'external' ? t('projects.ficha.skills.external')
          : ownerClass === 'filesystem' ? t('projects.owner.count.filesystem', { n: 1 })
            : ownerClass === 'host' ? t('projects.owner.host')
              : t('projects.ficha.skills.unknownOwner');
      const kv = (key, label, value) => e('div', { key, className: 'lsc-row' },
        e('span', { className: 'lsc-hint', style: { minWidth: 96, flex: '0 0 auto' } }, label),
        e('span', { style: { fontSize: 11, minWidth: 0, wordBreak: 'break-word' } }, value),
      );
      const hasUuid = text(identity.uuid) !== '';
      const hasVersion = text(identity.version) !== '';
      return e('div', { className: 'lsc-modal-wrap' },
        e('div', { className: 'lsc-modal lsc-ficha' },
          e('div', { className: 'lsc-row', style: { alignItems: 'flex-start', gap: 8 } },
            e('div', { className: 'lsc-col', style: { minWidth: 0 } },
              e('h2', { className: 'lsc-ficha-title', style: { margin: 0 } }, text(entry.name) !== '' ? entry.name : text(entry.key)),
              e('p', { className: 'lsc-hint', style: { margin: '2px 0 0' } }, text(entry.canonicalName) !== '' && entry.canonicalName !== entry.name ? t('projects.skill.canonical', { name: entry.canonicalName }) : text(entry.key)),
            ),
            e('span', { className: 'lsc-spacer' }),
            e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: onClose }, t('projects.ficha.close')),
          ),
          e('div', { className: 'lsc-row', style: { margin: '6px 0 0', flexWrap: 'wrap', gap: 8 } },
            e('button', {
              type: 'button',
              className: 'lsc-btn ghost small',
              disabled: exportBusy === true,
              onClick: async () => {
                if (exportBusy === true || typeof onExport !== 'function') return;
                setExportBusy(true);
                try {
                  const version = text(identity.version);
                  const result = await onExport(text(entry.key), version === '' ? undefined : version);
                  setExportResult(result ?? { ok: false, code: 'failed' });
                } finally {
                  setExportBusy(false);
                }
              },
            }, exportBusy === true ? t('portability.export.working') : t('portability.export.generateHere')),
          ),
          exportResult === null ? null : e(ExportResultBox, { t, data: exportResult }),
          e('div', { className: 'lsc-ficha-body' },
            e(Section, { title: t('projects.skill.identity'), hint: t('projects.skill.identityHint') },
              e('div', { className: 'lsc-col', style: { gap: 3 } },
                kv('skill:uuid', 'UUID', hasUuid ? String(identity.uuid) : t('projects.skill.notRecorded')),
                kv('skill:version', t('projects.ficha.skills.versionLabel'), hasVersion ? String(identity.version) : t('projects.skill.notRecorded')),
                kv('skill:content', 'SHA-256', text(identity.contentSha256) === '' ? t('projects.skill.notRecorded') : String(identity.contentSha256)),
                kv('skill:manifest', t('projects.skill.manifestSha'), text(identity.manifestSha256) === '' ? t('projects.skill.notRecorded') : String(identity.manifestSha256)),
                !hasUuid || !hasVersion ? e('p', { className: 'lsc-hint', style: { margin: '4px 0 0' } }, t('projects.ficha.origin.hostIdentity')) : null,
              ),
            ),
            e(Section, { title: t('projects.ficha.origin'), hint: t('projects.skill.ownerHint') },
              e('div', { className: 'lsc-col', style: { gap: 3 } },
                kv('skill:ownerClass', t('projects.ficha.origin.owner'), ownerLabel),
                kv('skill:ownerKind', t('projects.skill.ownerKind'), text(owner.kind) === '' ? t('projects.ficha.origin.none') : owner.kind),
                kv('skill:provider', t('projects.ficha.origin.provider'), text(owner.provider) === '' ? t('projects.ficha.origin.noProvider') : owner.provider),
                kv('skill:origin', t('projects.ficha.origin.origin'), [text(origin.kind), text(origin.label)].filter((part) => part !== '').join(' · ') || t('projects.ficha.origin.none')),
                kv('skill:location', t('projects.ficha.origin.location'), text(location.path) !== '' ? location.path : (text(location.directory) !== '' ? location.directory : t('projects.ficha.origin.none'))),
                kv('skill:scope', t('projects.ficha.origin.scope'), text(scope.kind) === '' ? t('projects.ficha.origin.none') : scope.kind),
                kv('skill:confidence', t('projects.ficha.origin.confidence'), text(entry.confidence) === '' ? t('projects.ficha.origin.none') : entry.confidence),
                reasons.length === 0 ? null : kv('skill:reasons', t('projects.ficha.origin.reasons'), reasons.join(' · ')),
                ownerClass === 'external' || ownerClass === 'unknown' ? e('p', { className: 'lsc-hint', style: { margin: '4px 0 0' } }, t('projects.skill.readonly')) : null,
                owner.kind === 'plugin' && (owner.pluginEntryId === null || owner.pluginEntryId === undefined)
                  ? e('p', { className: 'lsc-hint' }, t('projects.ficha.origin.unmapped', { provider: text(owner.provider) === '' ? '?' : owner.provider }))
                  : null,
                e('p', { className: 'lsc-hint', style: { margin: 0 } }, t('projects.ficha.origin.noProviders')),
              ),
            ),
            e(Section, { title: t('projects.skill.host'), hint: t('projects.skill.hostHint') },
              e('div', { className: 'lsc-col', style: { gap: 3 } },
                kv('skill:loaded', t('projects.skill.loadedByHost'), (() => {
                  // Tri-estado: `null` = no determinado (vista global o snapshot sin ruta). `false`
                  // sólo significa «sombreada» cuando el payload dice quién la sirve; pintarlo como
                  // «no cargada» sin `shadowedBy` afirmaría más de lo que el Host declara.
                  const loaded = association.loadedByHost;
                  if (loaded === true) return t('projects.skill.yes');
                  if (loaded === false && text(association.shadowedBy) !== '') return t('projects.skill.loadedShadowed', { provider: association.shadowedBy });
                  return t('projects.skill.loadedUnknown');
                })()),
                kv('skill:hostProvider', t('projects.ficha.origin.provider'), text(association.provider) === '' ? t('projects.ficha.origin.none') : association.provider),
                kv('skill:hostPath', t('projects.ficha.origin.location'), text(association.path) === '' ? t('projects.ficha.origin.none') : association.path),
                kv('skill:execution', t('projects.skill.execution'), [execution.modelInvocable === true ? t('projects.skill.modelInvocable') : null, execution.userInvocable === true ? t('projects.skill.userInvocable') : null].filter(Boolean).join(' · ') || t('projects.ficha.origin.none')),
                text(association.shadowedBy) === '' ? null : e('p', { className: 'lsc-hint', style: { color: 'var(--lsc-warn)' } }, t('projects.skill.shadowed', { provider: association.shadowedBy })),
              ),
            ),
            e(Section, { title: t('projects.skill.collisions'), hint: t('projects.skill.collisionsHint') },
              touching.length === 0
                ? e(Empty, null, t('projects.skill.collisionsNone'))
                : e('div', { className: 'lsc-col', style: { gap: 4 } }, touching.map((collision) => e('div', { key: text(collision.code) + ':' + text(collision.key), className: 'lsc-collision-row' },
                    e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 6 } },
                      e(Pill, { tone: collision.severity === 'block' ? 'bad' : 'warn' }, text(collision.severity) !== '' ? collision.severity : 'info'),
                      e('span', { className: 'lsc-mono', style: { fontSize: 11 } }, text(collision.code)),
                    ),
                    text(collision.explanation) === '' ? null : e('p', { className: 'lsc-hint', style: { margin: '3px 0 0' } }, collision.explanation),
                  ))),
            ),
          ),
          e('div', { className: 'lsc-row', style: { marginTop: 10 } },
            e('span', { className: 'lsc-spacer' }),
            e('button', { type: 'button', className: 'lsc-btn', onClick: onClose }, t('projects.ficha.close')),
          ),
        ),
      );
    }

    function identityTone(state) {
      if (state === 'fork-conflict' || state === 'uuid-duplicated' || state === 'path-conflict' || state === 'identity-unknown') return 'bad';
      if (state === 'linked' || state === 'adopted' || state === 'fork-registered' || state === 'moved-manifest') return 'ok';
      if (state === 'manifest-missing' || state === 'manifest-only' || state === 'legacy-manifest-only') return 'warn';
      return 'mute';
    }

    function IdentityView({ t, identity, available, busy, onAction }) {
      const items = asArray(identity?.items);
      const actionFor = (state) => (state === 'manifest-missing' || state === 'manifest-only' || state === 'unmanaged' || state === 'legacy-manifest-only'
        ? 'identity-adopt'
        : state === 'manifest-invalid'
          ? 'repair'
          : state === 'detached-manifest'
            ? 'identity-relink'
            : state === 'linked' || state === 'adopted'
              ? 'identity-unlink'
              : null);
      const actionLabel = (action) => (action === 'identity-adopt' ? t('projects.identity.action.adopt')
        : action === 'repair' ? t('projects.identity.action.repair')
          : action === 'identity-relink' ? t('projects.identity.action.relink')
            : t('projects.identity.action.unlink'));
      if (items.length === 0) return e(Empty, null, t('projects.identity.empty'));
      return e(Section, { title: t('projects.tab.identity') },
        e('p', { className: 'lsc-hint', style: { marginTop: 0 } }, t('projects.identity.subtitle')),
        e('div', { className: 'lsc-list' }, items.map((item, index) => e('div', { key: item.path + ':' + index, className: 'lsc-item' },
          e('div', { className: 'lsc-col', style: { minWidth: 0, flex: 1 } },
            e('span', { className: 'lsc-row' },
              e('span', { className: 'lsc-nowrap', style: { fontWeight: 600 } }, item.path),
              e(Pill, { tone: identityTone(item.identity) }, item.identity),
            ),
            e('span', { className: 'lsc-meta' }, t('projects.identity.uuid') + ': ' + (text(item.uuid) === '' ? t('projects.identity.none') : String(item.uuid).slice(0, 8))),
            asArray(item.reasons).length === 0 ? null : e('span', { className: 'lsc-meta' }, t('projects.identity.reasons') + ': ' + item.reasons.join(', ')),
          ),
          e('div', { className: 'lsc-col', style: { alignItems: 'flex-end', gap: 4 } },
            e(Pill, { tone: item.availability === 'ok' ? 'ok' : item.availability === 'missing-dir' ? 'bad' : 'warn' }, t('projects.identity.availability') + ': ' + item.availability),
            e(Pill, { tone: item.verification === 'verified' ? 'ok' : 'warn' }, t('projects.identity.verification') + ': ' + item.verification),
            (() => {
              const action = actionFor(item.identity);
              if (action === null) return null;
              return e('button', {
                type: 'button',
                className: 'lsc-btn small',
                disabled: busy === true,
                title: available === true ? t('projects.identity.action.dialog') : t('projects.identity.action.locked'),
                onClick: () => onAction(action, { projectId: item.projectId, cwd: item.path, branch: item.identity === 'manifest-invalid' ? 'invalid' : 'missing' }),
              }, actionLabel(action));
            })(),
          ),
        ))),
        available === true ? null : e('p', { className: 'lsc-hint', style: { color: 'var(--lsc-warn)' } }, t('projects.identity.action.locked')),
        e('p', { className: 'lsc-hint' }, t('projects.identity.readonly')),
      );
    }

    function ProjectsView({ t, lang, snapshot, workspaces, workspacesError, workspacesBusy, projectView, projectsBusy, projectsReport, compat, onCompatRetry, onCopyDiagnostics, onWorkspacesRefresh, onProjectsRefresh, openWorkspaceAvailable, onOpenWorkspace, onInspectProject, onOpenDetail, onOpenPreflight, onOpenRegister, onOpenSkill, cwd, busy, onToggle, onVersion, onSync, onAdvance, onSelect, onOpen, identityBusy, onIdentityAction }) {
      const [tab, setTab] = useState('discovered');
      const [filter, setFilter] = useState(null);
      const [opening, setOpening] = useState('');
      const [inspecting, setInspecting] = useState('');
      const projects = projectsOf(snapshot);
      const skills = skillsOf(snapshot);
      const current = text(cwd) !== '' ? cwd : pickCwd(snapshot);
      const view = projectView ?? buildProjectView({ projectsData: null, inventoryData: null, legacy: workspaces ?? null });
      const summary = view.summary;
      const entries = view.entries;
      const actionsAllowed = compatActionsEnabled(compat);
      const blockedReason = t('projects.compat.actions.blocked');
      const discoveredEntries = filterProjectEntries(entries.filter((entry) => entry.discoveredFlag === true), filter);
      const managedEntries = filterProjectEntries(entries.filter((entry) => entry.managedRecord === true), filter);
      const filterLabel = filter === null ? '' : t('projects.chip.' + filter + '.many');
      // Un 0 sólo es honesto si el recuento se pudo comprobar; si no, la pestaña no inventa cifras.
      const tabCount = (value) => (value === null || value === undefined ? '?' : value);
      const uncheckedEmpty = t('projects.empty.unchecked');
      const emptyDiscovered = filter !== null
        ? t('projects.filter.empty', { label: filterLabel })
        : (summary.discovered === null || summary.discovered === undefined ? uncheckedEmpty : t('projects.empty.discovered'));
      const emptyManaged = filter !== null
        ? t('projects.filter.empty', { label: filterLabel })
        : (summary.managed === null || summary.managed === undefined ? uncheckedEmpty : t('projects.empty.managed'));
      const currentRecord = projects.find((project) => samePath(project.cwd, current)) ?? null;

      const operationPending = text(opening) !== '' || text(inspecting) !== '';
      const handleOpen = async (entry, workspaceId) => {
        const id = workspaceId ?? entry?.workspace?.workspaceId ?? null;
        if (id === null || id === undefined || openWorkspaceAvailable !== true) return;
        setOpening(entry?.key ?? '');
        try { await onOpenWorkspace(id); } finally { setOpening(''); }
      };
      const handleInspect = async (entry) => {
        if (!actionsAllowed || text(entry.projectId) === '') return;
        setInspecting(entry.key);
        try { await onInspectProject(entry); } finally { setInspecting(''); }
      };
      const openRegister = () => { if (!actionsAllowed) return; onOpenRegister(); };

      const tabButton = (id, label, count) => e('button', {
        type: 'button',
        className: cx('lsc-tab', tab === id ? 'active' : null),
        'aria-pressed': tab === id ? 'true' : 'false',
        onClick: () => setTab(id),
      }, `${label}${count === undefined ? '' : ` ${count}`}`);

      const assignments = currentRecord === null ? null : e(Section, { title: t('projects.skills'), hint: `${currentRecord.name ?? currentRecord.id} · ${currentRecord.cwd}` },
        e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 6, marginBottom: 6 } },
          e(Pill, { tone: 'mute' }, t('projects.active', { n: skills.filter((skill) => assignmentOf(snapshot, currentRecord.id, skill.id)?.enabled === true).length })),
          e('span', { className: 'lsc-spacer' }),
          (currentRecord.updatesCount ?? 0) > 0 ? e(Pill, { tone: 'warn' }, t(currentRecord.updatesCount === 1 ? 'projects.updates.pill' : 'projects.updates.pillMany', { n: currentRecord.updatesCount })) : null,
          (currentRecord.updatesCount ?? 0) > 0 ? e('button', { type: 'button', className: 'lsc-btn primary small', disabled: busy, onClick: () => onAdvance(currentRecord.id) }, t('projects.updates.advance')) : null,
          e('button', { type: 'button', className: 'lsc-btn ghost small', disabled: busy, onClick: () => onSync(currentRecord.id) }, t('projects.sync')),
        ),
        skills.length === 0
          ? e(Empty, null, t('projects.none'))
          : e('div', null, skills.map((skill) => {
              const assignment = assignmentOf(snapshot, currentRecord.id, skill.id);
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
                      onChange: (event) => onVersion(currentRecord.id, skill.id, event.target.value),
                    }, (versions.length === 0 ? [skill.currentVersion] : versions.map((version) => version.version)).filter(Boolean).map((version) => e('option', { key: version, value: version }, version)))
                  : null,
                e(Switch, {
                  checked: enabled,
                  disabled: busy,
                  label: enabled ? t('toast.toggled.off') : t('toast.toggled.on'),
                  onChange: (value) => onToggle(currentRecord.id, skill.id, value, skill.currentVersion),
                }),
              );
            })),
        e('p', { className: 'lsc-hint', style: { marginTop: 8 } }, t('projects.assigned.hint')),
      );

      return e('div', { className: 'lsc-content-inner' },
        e('div', { className: 'lsc-page-head' },
          e('div', null,
            e('h1', { className: 'lsc-page-title' }, t('projects.title')),
            e('p', { className: 'lsc-page-sub' }, t('projects.discover.subtitle')),
          ),
          e('div', { className: 'lsc-spacer' }),
          e('button', {
            type: 'button',
            className: 'lsc-btn',
            disabled: !actionsAllowed,
            title: actionsAllowed ? '' : blockedReason,
            onClick: openRegister,
          }, `+ ${t('projects.add')}`),
        ),

        e(CompatBanner, { t, compat, busy: projectsBusy, onRetry: onCompatRetry, onCopyDiagnostics }),
        e(ProjectStatusBar, { t, lang, report: projectsReport, summary, busy: projectsBusy, onRefresh: onProjectsRefresh }),
        e(ProjectChipBar, {
          t,
          summary,
          active: filter,
          onFilter: setFilter,
          onOpenCollisions: () => setTab('collisions'),
        }),

        e('div', { className: 'lsc-row', style: { marginBottom: 12, flexWrap: 'wrap' } },
          tabButton('discovered', t('projects.tab.discovered'), tabCount(summary.discovered)),
          tabButton('managed', t('projects.tab.managed'), tabCount(summary.managed)),
          tabButton('collisions', t('projects.tab.collisions'), tabCount(summary.collisions)),
          tabButton('identity', t('projects.tab.identity'), asArray(workspaces?.identity?.items).length),
        ),

        tab === 'discovered'
          ? e(ProjectCardGrid, {
              t,
              lang,
              entries: discoveredEntries,
              mode: 'discovered',
              empty: emptyDiscovered,
              openWorkspaceAvailable,
              r16ActionsEnabled: actionsAllowed,
              blockedReason,
              identityUnchecked: !actionsAllowed,
              globalSkills: summary.skills,
              opening,
              inspecting,
              onOpenWorkspace: handleOpen,
              onInspect: handleInspect,
              onManage: onOpenPreflight,
              onDetail: onOpenDetail,
              onOpenSkill,
            })
          : tab === 'managed'
            ? e('div', null,
                e(ProjectCardGrid, {
                  t,
                  lang,
                  entries: managedEntries,
                  mode: 'managed',
                  empty: emptyManaged,
                  openWorkspaceAvailable,
                  r16ActionsEnabled: actionsAllowed,
                  blockedReason,
                  identityUnchecked: !actionsAllowed,
                  globalSkills: summary.skills,
                  opening,
                  inspecting,
                  onOpenWorkspace: handleOpen,
                  onInspect: handleInspect,
                  onManage: onOpenPreflight,
                  onDetail: onOpenDetail,
                  onWork: (entry) => onSelect(entry.cwd),
                }),
                assignments === null ? null : e('div', { style: { marginTop: 14 } }, assignments),
              )
            : tab === 'collisions'
              ? e(CollisionsView, { t, lang, inventory: view.inventory, onOpenSkill })
              : e('div', null,
                text(workspacesError) !== '' ? e('div', { className: 'lsc-notice bad' }, e('strong', null, t('projects.discover.unavailable')), e('p', null, workspacesError), e('button', { type: 'button', className: 'lsc-btn ghost small', style: { marginTop: 6 }, onClick: onWorkspacesRefresh }, t('projects.discover.refresh'))) : null,
                e(IdentityView, { t, identity: workspaces?.identity, available: workspaces?.identity?.available === true, busy: identityBusy, onAction: onIdentityAction }),
              ),

        operationPending ? e('p', { className: 'lsc-hint', style: { marginTop: 10 } }, t('projects.card.opening')) : null,
      );
    }

    function ActionErrorNotice({ t, error }) {
      if (error === null || error === undefined) return null;
      const code = text(error.code) !== '' ? error.code : 'unknown';
      let title = t('projects.error.action');
      if (code === 'preflight-blocked') title = t('projects.register.blocked');
      else if (code === 'evidence-incomplete') title = t('projects.register.evidence', { reason: text(error.reason) !== '' ? error.reason : (text(error.message) !== '' ? error.message : t('projects.error.unknown')) });
      else if (code === 'project-exists') title = t('projects.register.exists');
      else if (code === 'project-not-found') title = t('projects.error.notFound');
      const findings = asArray(error.findings);
      const sources = asArray(error.sources);
      const reasons = asArray(error.reasons);
      return e('div', { className: 'lsc-notice bad' },
        e('strong', null, title),
        e('p', null, `${t('projects.error.code', { code })}${error.status ? ` · HTTP ${error.status}` : ''}${text(error.message) === '' ? '' : ` · ${error.message}`}`),
        reasons.length === 0 ? null : e('div', null,
          e('div', { className: 'lsc-label', style: { marginTop: 8 } }, t('projects.register.reasons')),
          reasons.map((reason, index) => e('div', { key: 'reason:' + index, className: 'lsc-finding-row' }, e('span', null, typeof reason === 'string' ? reason : JSON.stringify(reason)))),
        ),
        findings.length === 0 ? null : e('div', null,
          e('div', { className: 'lsc-label', style: { marginTop: 8 } }, t('projects.register.findings')),
          findings.map((finding, index) => e('div', { key: 'finding:' + index, className: 'lsc-finding-row' },
            e('span', { className: 'lsc-mono' }, String(finding?.code ?? '')),
            e('span', null, String(finding?.severity ?? '')),
            e('span', null, String(finding?.message ?? '')),
          )),
        ),
        sources.length === 0 ? null : e('div', null,
          e('div', { className: 'lsc-label', style: { marginTop: 8 } }, t('projects.register.sources')),
          sources.map((source, index) => e('div', { key: 'source:' + index, className: 'lsc-finding-row' },
            e('span', { className: 'lsc-mono' }, String(source?.id ?? '')),
            e('span', null, sourceStatusText(t, source?.status)),
            e('span', null, text(source?.reason) === '' ? '' : t('projects.source.reason', { reason: source.reason })),
          )),
        ),
      );
    }

    function ProjectDetailDialog({ t, lang, snapshot, detail, view, openWorkspaceAvailable, onClose, onInspect, onManage, onOpenWorkspace, onOpenSkill }) {
      if (detail === null || detail === undefined || detail.open !== true) return null;
      const entry = detail.entry ?? {};
      const data = detail.data ?? null;
      const workspace = data?.workspace ?? entry.workspace ?? null;
      const registration = data?.registration ?? entry.registration ?? null;
      const inspection = data?.inspection ?? entry.inspection ?? null;
      const counts = data?.counts ?? entry.counts ?? null;
      const workspaceId = workspace?.workspaceId ?? null;
      const canOpen = workspaceId !== null && workspaceId !== undefined && openWorkspaceAvailable === true;
      const openReason = workspaceId === null || workspaceId === undefined ? t('projects.open.noWorkspace') : (openWorkspaceAvailable === true ? '' : t('projects.open.noPanel'));
      const detected = asArray(entry.skills);
      const assigned = asArray(data?.assignments);
      const detailSkills = asArray(data?.skills);
      const collisions = data?.collisions !== undefined ? asArray(data.collisions) : asArray(entry.collisions);
      const findings = asArray(data?.findings);
      const sessions = data?.sessions ?? null;
      const identity = data?.identity ?? null;
      const stats = entry.skillStats ?? skillStatsOf(detected);
      const disabledAssigned = assigned.filter((item) => item?.enabled !== true).length;
      const projectId = text(data?.projectId) !== '' ? data.projectId : entry.projectId;
      const state = data?.state ?? entry.state;
      const allowed = projectOperations(state);
      const blocked = ['detach-project', 'repair-manifest', 'adopt-project', 'materialize-project', 'assign', 'rename'].filter((operation) => allowed.includes(operation) === false);
      const eventRows = asArray(snapshot?.events).filter((event) => (text(projectId) !== '' && event?.projectId === projectId)
        || (text(entry.canonicalPath) !== '' && pathContains(event?.cwd ?? event?.path, entry.canonicalPath))).slice(0, 12);
      const sessionSource = text(sessions?.source) !== '' ? sessions.source : 'none';
      const sessionSourceLabel = sessionSource === 'workspace' ? t('projects.ficha.sessionSource.workspace')
        : sessionSource === 'persistence' ? t('projects.ficha.sessionSource.persistence')
          : t('projects.ficha.sessionSource.none');

      const kv = (key, label, value) => e('div', { key, className: 'lsc-row' },
        e('span', { className: 'lsc-hint', style: { minWidth: 88, flex: '0 0 auto' } }, label),
        e('span', { style: { fontSize: 11, minWidth: 0, wordBreak: 'break-word' } }, value),
      );
      const opList = (operations) => operations.length === 0 ? t('projects.dialog.ops.none') : operations.map((operation) => t('projects.op.' + operation)).join(', ');

      const summarySection = e(Section, { title: t('projects.ficha.summary') },
        e('div', { className: 'lsc-col', style: { gap: 4 } },
          e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 5 } },
            e(Pill, { tone: projectStateTone(state) }, t(projectStateKey(state))),
            e(Pill, { tone: entry.availability === 'ok' ? 'ok' : entry.availability === 'missing-dir' ? 'warn' : 'mute', title: entry.availability === 'unknown' ? t('projects.availability.unknownLong') : '' }, entry.availability === 'ok' ? t('projects.availability.ok') : entry.availability === 'missing-dir' ? t('projects.availability.missing') : t('projects.availability.unknown')),
            registration?.present === true ? e(Pill, { tone: 'info' }, t('projects.card.registered')) : e(Pill, { tone: 'warn' }, t('projects.card.unmanaged')),
            entry.derivedState ? e(Pill, { tone: 'mute' }, t('projects.card.derivedShort')) : null,
            entry.hasConflict ? e(Pill, { tone: 'bad' }, t('projects.card.conflicts', { n: collisions.length })) : null,
          ),
          kv('summary:path', t('projects.card.path'), entry.cwd ?? ''),
          kv('summary:inspection', t('projects.card.inspection'), inspectionText(t, text(inspection?.status) !== '' ? inspection.status : 'not-run', inspection?.reason)),
          kv('summary:sessions', t('projects.ficha.sessions'), sessionText(t, sessions?.count ?? entry.sessionCount)),
          e('p', { className: 'lsc-hint', style: { margin: 0 } }, t('projects.ficha.sessions.hint', { source: sessionSourceLabel })),
          counts === null || counts === undefined ? null : e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 5, marginTop: 2 } },
            e(Pill, { tone: baseTone(counts.active) }, t('projects.counts.active', { n: counts.active ?? 0 })),
            e(Pill, { tone: baseTone(counts.assigned) }, t('projects.counts.assigned', { n: counts.assigned ?? 0 })),
            e(Pill, { tone: baseTone(counts.materialized) }, materializedLabel(t, lang, counts.materialized)),
          ),
          asArray(entry.reasons).length === 0 ? null : kv('summary:reasons', t('projects.identity.reasons'), asArray(entry.reasons).join(' · ')),
        ),
      );

      const skillRows = [];
      for (const item of assigned.slice(0, 10)) {
        skillRows.push(e('div', { key: 'assigned:' + text(item?.skillId ?? skillRows.length), className: 'lsc-skill-line' },
          e('span', { style: { fontWeight: 600 } }, text(item?.name) !== '' ? item.name : text(item?.skillId)),
          e(Pill, { tone: item?.enabled === true ? 'ok' : 'mute' }, item?.enabled === true ? t('projects.ficha.skills.enabled') : t('projects.ficha.skills.disabled')),
          text(item?.version) === '' ? null : e('span', { className: 'lsc-hint' }, t('projects.ficha.skills.version', { version: item.version })),
        ));
      }
      for (const record of detected.slice(0, 10)) {
        const skillName = text(record?.name) !== '' ? record.name : text(record?.key);
        const skillKey = text(record?.key) === '' ? text(record?.name) : text(record.key);
        skillRows.push(e('div', { key: 'detected:' + (skillKey !== '' ? skillKey : skillRows.length), className: 'lsc-skill-line' },
          typeof onOpenSkill === 'function' && skillKey !== ''
            ? e('button', {
                type: 'button',
                className: 'lsc-btn ghost small',
                style: { fontWeight: 600, padding: '0 4px', fontSize: 11.5 },
                title: t('projects.collisions.openSkill'),
                onClick: () => onOpenSkill(skillKey),
              }, skillName)
            : e('span', { style: { fontWeight: 600 } }, skillName),
          e(Pill, { tone: skillOwnerClass(record) === 'own' ? 'info' : skillOwnerClass(record) === 'external' ? 'warn' : 'mute' },
            t(skillOwnerClass(record) === 'own' ? 'projects.ficha.skills.own' : skillOwnerClass(record) === 'external' ? 'projects.ficha.skills.external' : 'projects.ficha.skills.unknownOwner')),
          record?.association?.shadowedBy ? e(Pill, { tone: 'bad' }, t('projects.ficha.skills.shadowed')) : null,
          text(record?.owner?.provider) === '' ? null : e('span', { className: 'lsc-hint' }, t('projects.ficha.skills.provider', { provider: record.owner.provider })),
        ));
      }
      const skillsSection = e(Section, { title: t('projects.ficha.skills') },
        e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 5, marginBottom: 6 } },
          e(Pill, { tone: 'mute' }, t('projects.ficha.skills.ownCount', { n: stats.own })),
          e(Pill, { tone: 'mute' }, t('projects.ficha.skills.externalCount', { n: stats.external })),
          e(Pill, { tone: 'mute' }, t('projects.ficha.skills.unknownCount', { n: stats.unknown })),
          e(Pill, { tone: 'mute' }, t('projects.ficha.skills.globalCount', { n: detected.filter((record) => record?.scope?.kind !== 'projectRoot').length })),
          e(Pill, { tone: 'mute' }, t('projects.ficha.skills.localCount', { n: detected.filter((record) => record?.scope?.kind === 'projectRoot').length })),
          e(Pill, { tone: 'mute' }, t('projects.ficha.skills.legacyCount', { n: detected.filter((record) => record?.origin?.kind === 'legacy').length })),
          e(Pill, { tone: baseTone(disabledAssigned) }, t('projects.ficha.skills.disabledCount', { n: disabledAssigned })),
          e(Pill, { tone: baseTone(collisions.length) }, t('projects.ficha.skills.conflictsCount', { n: collisions.length })),
          detailSkills.length === 0 ? null : e(Pill, { tone: 'info' }, t('projects.ficha.skills.assignedCount', { n: detailSkills.length })),
        ),
        view?.inventoryAvailable !== true
          ? e('p', { className: 'lsc-hint' }, t('projects.ficha.skills.unavailable'))
          : stats.total === 0
            ? e('p', { className: 'lsc-hint' }, entry.inspectionStatus === 'incomplete' ? t('projects.ficha.skills.partial') : t('projects.ficha.skills.noneInSource'))
            : null,
        skillRows.length === 0 ? null : e('div', null, skillRows),
        e('p', { className: 'lsc-hint', style: { marginTop: 8 } }, t('projects.ficha.skills.readonly')),
      );

      const originRows = detected.slice(0, 6).map((record) => {
        const owner = record?.owner ?? {};
        const origin = record?.origin ?? {};
        const location = record?.location ?? {};
        const scope = record?.scope ?? {};
        const rows = [
          kv('origin:owner:' + text(record?.key), t('projects.ficha.origin.owner'), text(owner.kind) === '' ? t('projects.ficha.origin.none') : owner.kind),
          kv('origin:provider:' + text(record?.key), t('projects.ficha.origin.provider'), text(owner.provider) === '' ? t('projects.ficha.origin.noProvider') : owner.provider),
          kv('origin:origin:' + text(record?.key), t('projects.ficha.origin.origin'), [text(origin.kind), text(origin.label)].filter((part) => part !== '').join(' · ') || t('projects.ficha.origin.none')),
          kv('origin:location:' + text(record?.key), t('projects.ficha.origin.location'), text(location.path) !== '' ? location.path : (text(location.directory) !== '' ? location.directory : t('projects.ficha.origin.none'))),
          kv('origin:scope:' + text(record?.key), t('projects.ficha.origin.scope'), text(scope.kind) === '' ? t('projects.ficha.origin.none') : scope.kind),
          kv('origin:confidence:' + text(record?.key), t('projects.ficha.origin.confidence'), text(record?.confidence) === '' ? t('projects.ficha.origin.none') : record.confidence),
        ];
        if (asArray(record?.reasons).length > 0) rows.push(kv('origin:reasons:' + text(record?.key), t('projects.ficha.origin.reasons'), asArray(record.reasons).join(' · ')));
        if (owner.kind === 'plugin' && (owner.pluginEntryId === null || owner.pluginEntryId === undefined)) {
          rows.push(e('p', { key: 'origin:unmapped:' + text(record?.key), className: 'lsc-hint' }, t('projects.ficha.origin.unmapped', { provider: text(owner.provider) === '' ? '?' : owner.provider })));
        }
        return e('div', { key: 'origin:' + text(record?.key), style: { padding: '6px 0', borderTop: '1px solid rgba(148,163,184,0.1)' } },
          e('div', { className: 'lsc-skill-line', style: { fontWeight: 600, fontSize: 11 } }, text(record?.name) !== '' ? record.name : text(record?.key)),
          e('div', { className: 'lsc-col', style: { gap: 2 } }, rows),
        );
      });
      const originSection = e(Section, { title: t('projects.ficha.origin') },
        originRows.length === 0 ? e('p', { className: 'lsc-hint' }, t('projects.ficha.origin.empty')) : e('div', null, originRows),
        e('p', { className: 'lsc-hint', style: { marginTop: 6 } }, t('projects.ficha.origin.noProviders')),
      );

      const conflictRows = collisions.map((collision, index) => e('div', { key: 'collision:' + index, className: 'lsc-collision-row' },
        e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', gap: 6 } },
          e('span', { className: 'lsc-mono' }, String(collision?.code ?? '')),
          e(Pill, { tone: collision?.severity === 'block' ? 'bad' : 'warn' }, String(collision?.severity ?? '')),
          e('span', { className: 'lsc-spacer' }),
          e('span', { className: 'lsc-hint' }, t('projects.ficha.conflicts.rows', { n: asArray(collision?.rows).length })),
        ),
        text(collision?.explanation) === '' ? null : e('div', { className: 'lsc-hint', style: { marginTop: 3 } }, collision.explanation),
      ));
      const findingRows = findings.map((finding, index) => e('div', { key: 'detail-finding:' + index, className: 'lsc-finding-row' },
        e('span', { className: 'lsc-mono' }, String(finding?.code ?? '')),
        e('span', null, String(finding?.severity ?? '')),
        e('span', null, String(finding?.message ?? '')),
      ));
      const conflictsSection = e(Section, { title: t('projects.ficha.conflicts') },
        conflictRows.length === 0 && findingRows.length === 0
          ? e('p', { className: 'lsc-hint' }, t('projects.ficha.conflicts.none'))
          : e('div', null, conflictRows, findingRows),
      );

      const activitySection = e(Section, { title: t('projects.ficha.activity') },
        eventRows.length === 0
          ? e('p', { className: 'lsc-hint' }, t('projects.ficha.activity.empty'))
          : e('div', null, eventRows.map((event, index) => e('div', { key: 'event:' + index, className: 'lsc-skill-line' },
              e('span', { className: 'lsc-hint' }, formatDate(event?.at ?? event?.createdAt ?? event?.time, lang)),
              e('span', null, text(event?.type ?? event?.action) === '' ? t('projects.ficha.activity.event') : String(event.type ?? event.action)),
              text(event?.skillId) === '' ? null : e('span', { className: 'lsc-mono' }, String(event.skillId)),
              text(event?.status) === '' ? null : e(Pill, { tone: 'mute' }, String(event.status)),
            ))),
      );

      const identityRows = [
        kv('id:project', t('projects.ficha.identity.projectId'), text(projectId) === '' ? t('projects.ficha.identity.none') : String(projectId)),
        kv('id:uuid', t('projects.ficha.identity.uuid'), registration?.uuid !== null && registration?.uuid !== undefined && String(registration.uuid) !== '' ? shortSha(String(registration.uuid)) : t('projects.ficha.identity.uuidNone')),
        kv('id:sha', t('projects.ficha.identity.sha'), registration?.manifestSha256 !== null && registration?.manifestSha256 !== undefined && String(registration.manifestSha256) !== '' ? shortSha(String(registration.manifestSha256)) : t('projects.ficha.identity.none')),
        kv('id:workspace', t('projects.ficha.identity.workspace'), workspaceId === null || workspaceId === undefined ? t('projects.ficha.identity.workspaceNone') : `${text(workspace?.title) === '' ? workspaceId : workspace.title} · ${workspaceId}`),
        kv('id:verification', t('projects.ficha.identity.state'), text(identity?.state) === '' ? t('projects.ficha.identity.stateUnknown') : identity.state),
      ];
      const identitySection = e(Section, { title: t('projects.ficha.identity') },
        e('div', { className: 'lsc-col', style: { gap: 2 } }, identityRows),
        e('p', { className: 'lsc-hint', style: { marginTop: 6 } }, t('projects.ficha.identity.allowed', { ops: opList(allowed) })),
        e('p', { className: 'lsc-hint' }, blocked.length === 0 ? t('projects.ficha.identity.noBlocked') : t('projects.ficha.identity.blocked', { ops: opList(blocked) })),
        e('div', { className: 'lsc-project-actions' },
          e('button', {
            type: 'button',
            className: 'lsc-btn ghost small',
            disabled: canOpen !== true || detail.busy === true,
            title: openReason,
            onClick: () => { if (canOpen !== true || detail.busy === true) return; onOpenWorkspace(workspaceId); },
          }, t('projects.discover.open')),
          e('button', {
            type: 'button',
            className: 'lsc-btn ghost small',
            disabled: detail.busy === true || text(projectId) === '',
            title: detail.busy === true ? t('projects.card.inspecting') : t('projects.inspect.readonly'),
            onClick: () => { if (detail.busy === true || text(projectId) === '') return; onInspect(); },
          }, detail.busy === true ? t('projects.card.inspecting') : t('projects.card.inspect')),
          e('button', { type: 'button', className: 'lsc-btn small', onClick: onManage }, t('projects.card.manage')),
        ),
      );

      const title = detail.mode === 'inspect' ? t('projects.ficha.inspectTitle') : t('projects.ficha.title');
      return e('div', { className: 'lsc-modal-wrap' },
        e('div', { className: 'lsc-modal lsc-ficha', role: 'dialog', 'aria-label': title },
          e('div', { className: 'lsc-row', style: { alignItems: 'flex-start' } },
            e('div', { className: 'lsc-col', style: { minWidth: 0 } },
              e('span', { className: 'lsc-modal-title' }, title),
              e('span', { className: 'lsc-hint lsc-nowrap' }, `${text(entry.name) === '' ? t('projects.ficha.identity.none') : entry.name} · ${text(entry.cwd)}`),
            ),
            e('span', { className: 'lsc-spacer' }),
            e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: onClose }, t('projects.ficha.close')),
          ),
          detail.busy === true ? e(Empty, null, t('projects.ficha.loading')) : null,
          e(ActionErrorNotice, { t, error: detail.error }),
          data === null || data === undefined ? e('p', { className: 'lsc-hint', style: { margin: 0 } }, t('projects.ficha.summaryOnly')) : null,
          e('div', { className: 'lsc-ficha-body' },
            summarySection,
            skillsSection,
            originSection,
            conflictsSection,
            activitySection,
            e('div', { className: 'lsc-ficha-wide' }, identitySection),
          ),
          e('div', { className: 'lsc-row', style: { marginTop: 4 } },
            e('span', { className: 'lsc-spacer' }),
            e('button', { type: 'button', className: 'lsc-btn small', onClick: onClose }, t('projects.ficha.close')),
          ),
        ),
      );
    }

    function projectDialogBlockedText(t, blocked) {
      return blocked.map((item) => item.reason === 'state'
        ? t('projects.dialog.ops.reason.state', { state: item.state ?? '?' })
        : item.reason === 'noPath'
          ? t('projects.dialog.ops.reason.noPath')
          : t('projects.dialog.ops.reason.alreadyRegistered')).join(' · ');
    }

    function ProjectDialog({ t, lang, view, dialog, onClose, onField, onStep, onConfirm }) {
      if (dialog === null || dialog === undefined) return null;
      const preflight = buildPreflight(view, dialog);
      const candidates = asArray(view?.entries).filter((entry) => entry.discoveredFlag === true);
      const blockedText = projectDialogBlockedText(t, preflight.blocked);
      const title = dialog.mode === 'manage' ? t('projects.dialog.title.manage') : t('projects.dialog.title.register');
      const errorNotice = e(ActionErrorNotice, { t, error: dialog.error });
      const busy = dialog.busy === true;
      const steps = e('div', { className: 'lsc-steps' },
        e('span', { className: cx('lsc-step', dialog.step === 1 ? 'active' : null) }, e('b', null, '1'), t('projects.dialog.step.review')),
        e('span', { className: cx('lsc-step', dialog.step === 2 ? 'active' : null) }, e('b', null, '2'), t('projects.dialog.step.confirm')),
      );

      const picker = dialog.mode === 'manage'
        ? e('div', { className: 'lsc-col', style: { gap: 2, marginBottom: 10 } },
            e('span', { className: 'lsc-hint' }, t('projects.dialog.identity') + ': ' + (text(preflight.target.entry?.name) === '' ? t('projects.dialog.pickEmpty') : preflight.target.entry.name)),
            e('span', { className: 'lsc-project-path' }, text(preflight.target.cwd) === '' ? t('projects.dialog.ops.reason.noPath') : preflight.target.cwd),
          )
        : e('div', null,
            e('div', { className: 'lsc-field' },
              e('label', { className: 'lsc-label' }, t('projects.dialog.pick')),
              candidates.length === 0
                ? e('span', { className: 'lsc-hint' }, t('projects.dialog.pickEmpty'))
                : e('select', {
                    className: 'lsc-select',
                    value: dialog.workspaceId,
                    onChange: (event) => onField({ workspaceId: event.target.value, cwd: '', error: null }),
                  },
                    e('option', { value: '' }, t('projects.dialog.pickPlaceholder')),
                    candidates.map((entry) => e('option', { key: entry.key, value: entry.workspace?.workspaceId ?? '' }, `${entry.name} · ${entry.cwd}`)),
                  ),
            ),
            e('div', { className: 'lsc-field' },
              e('label', { className: 'lsc-label' }, t('projects.dialog.path')),
              e('input', {
                className: 'lsc-input',
                placeholder: t('projects.dialog.pathPlaceholder'),
                value: dialog.cwd,
                onChange: (event) => onField({ cwd: event.target.value, error: null }),
              }),
            ),
            e('div', { className: 'lsc-field' },
              e('label', { className: 'lsc-label' }, t('projects.dialog.name')),
              e('input', {
                className: 'lsc-input',
                placeholder: t('projects.dialog.namePlaceholder'),
                value: dialog.name,
                onChange: (event) => onField({ name: event.target.value, error: null }),
              }),
            ),
          );

      const review = e('div', null,
        picker,
        e(Section, { title: t('projects.dialog.identity') },
          e('div', { className: 'lsc-col', style: { gap: 2 } },
            e('div', { className: 'lsc-row' }, e('span', { className: 'lsc-hint', style: { minWidth: 88 } }, t('projects.dialog.path.canonical')), e('span', { className: 'lsc-mono', style: { minWidth: 0, wordBreak: 'break-all' } }, text(preflight.target.cwd) === '' ? t('projects.dialog.ops.reason.noPath') : preflight.target.cwd)),
            e('div', { className: 'lsc-row' }, e('span', { className: 'lsc-hint', style: { minWidth: 88 } }, t('projects.dialog.identity.workspace')), e('span', { style: { fontSize: 11 } }, preflight.entry?.workspace?.workspaceId ?? t('projects.dialog.identity.none'))),
            e('div', { className: 'lsc-row' }, e('span', { className: 'lsc-hint', style: { minWidth: 88 } }, t('projects.dialog.identity.projectId')), e('span', { style: { fontSize: 11 } }, preflight.entry?.projectId ?? t('projects.dialog.identity.none'))),
            e('div', { className: 'lsc-row' }, e('span', { className: 'lsc-hint', style: { minWidth: 88 } }, t('projects.dialog.identity.uuid')), e('span', { style: { fontSize: 11 } }, preflight.entry?.registration?.uuid ?? t('projects.dialog.identity.none'))),
            e('div', { className: 'lsc-row' }, e('span', { className: 'lsc-hint', style: { minWidth: 88 } }, t('projects.dialog.availability')), e('span', null, e(Pill, { tone: preflight.entry?.availability === 'ok' ? 'ok' : preflight.entry?.availability === 'missing-dir' ? 'warn' : 'mute' }, preflight.entry?.availability === 'ok' ? t('projects.availability.ok') : preflight.entry?.availability === 'missing-dir' ? t('projects.availability.missing') : t('projects.availability.unknown')))),
          ),
        ),
        e(Section, { title: t('projects.dialog.matches') },
          preflight.target.matches.length === 0
            ? e('p', { className: 'lsc-hint' }, t('projects.dialog.matches.none'))
            : e('div', null, preflight.target.matches.map((match) => e('div', { key: 'match:' + match.key, className: 'lsc-skill-line' },
                e('span', { style: { fontWeight: 600 } }, match.name),
                e('span', { className: 'lsc-mono' }, text(match.projectId) === '' ? '—' : String(match.projectId)),
              ))),
        ),
        e(Section, { title: t('projects.dialog.skills') },
          view?.inventoryAvailable !== true
            ? e('p', { className: 'lsc-hint' }, t('projects.dialog.skills.unavailable'))
            : e('p', { className: 'lsc-hint' }, t('projects.dialog.skills.values', { total: preflight.skills.total, own: preflight.skills.own, external: preflight.skills.external, unknown: preflight.skills.unknown })),
        ),
        e(Section, { title: t('projects.dialog.conflicts') },
          preflight.collisions.length === 0
            ? e('p', { className: 'lsc-hint' }, t('projects.dialog.conflicts.none'))
            : e('div', null, preflight.collisions.map((collision, index) => e('div', { key: 'pf-collision:' + index, className: 'lsc-collision-row' },
                e('span', { className: 'lsc-mono' }, String(collision?.code ?? '')),
                e('span', { className: 'lsc-hint' }, ' · ' + String(collision?.severity ?? '')),
              ))),
        ),
        e(Section, { title: t('projects.dialog.coverage') },
          e('p', { className: 'lsc-hint' }, preflight.coverageComplete ? t('projects.dialog.coverage.complete') : t('projects.dialog.coverage.partial')),
          preflight.sources.length === 0
            ? null
            : e('div', null, preflight.sources.map((source, index) => e('div', { key: 'coverage:' + index, className: 'lsc-finding-row' },
                e('span', { className: 'lsc-mono' }, String(source?.id ?? '')),
                e('span', null, sourceStatusText(t, source?.status)),
                e('span', null, text(source?.reason) === '' ? '' : t('projects.source.reason', { reason: source.reason })),
              ))),
        ),
        e(Section, { title: t('projects.dialog.ops') },
          e('p', { className: 'lsc-hint' }, `${t('projects.dialog.ops.allowed')}: ${preflight.allowed.map((operation) => t('projects.op.' + operation)).join(', ')}`),
          e('p', { className: 'lsc-hint' }, blockedText === '' ? t('projects.dialog.ops.none') : `${t('projects.dialog.ops.blocked')}: ${blockedText}`),
        ),
        errorNotice,
      );

      const confirmation = e('div', null,
        e(Section, { title: t('projects.dialog.confirmSummary') },
          e('div', { className: 'lsc-col', style: { gap: 2 } },
            e('div', { className: 'lsc-row' }, e('span', { className: 'lsc-hint', style: { minWidth: 88 } }, t('projects.dialog.path.canonical')), e('span', { className: 'lsc-mono', style: { minWidth: 0, wordBreak: 'break-all' } }, preflight.target.cwd)),
            e('div', { className: 'lsc-row' }, e('span', { className: 'lsc-hint', style: { minWidth: 88 } }, t('projects.dialog.name')), e('span', { style: { fontSize: 11 } }, text(dialog.name) === '' ? (text(preflight.target.entry?.name) === '' ? t('projects.dialog.identity.none') : preflight.target.entry.name) : dialog.name)),
          ),
        ),
        e('p', { className: 'lsc-hint' }, t('projects.register.confirmHint')),
        errorNotice,
      );

      return e('div', { className: 'lsc-modal-wrap' },
        e('div', { className: 'lsc-modal', role: 'dialog', 'aria-label': title },
          e('div', { className: 'lsc-row' },
            e('span', { className: 'lsc-modal-title' }, title),
            e('span', { className: 'lsc-spacer' }),
            e('button', { type: 'button', className: 'lsc-btn ghost small', disabled: busy, onClick: () => { if (busy) return; onClose(); } }, t('projects.dialog.close')),
          ),
          e('p', { className: 'lsc-hint', style: { margin: 0 } }, t('projects.dialog.subtitle')),
          steps,
          dialog.step === 1 ? review : confirmation,
          e('div', { className: 'lsc-row', style: { marginTop: 4 } },
            e('span', { className: 'lsc-spacer' }),
            dialog.step === 2
              ? e('button', { type: 'button', className: 'lsc-btn ghost small', disabled: busy, onClick: () => { if (busy) return; onStep(1); } }, t('projects.dialog.back'))
              : e('button', { type: 'button', className: 'lsc-btn ghost small', disabled: busy, onClick: () => { if (busy) return; onClose(); } }, t('projects.dialog.cancel')),
            dialog.mode === 'manage'
              ? e('button', { type: 'button', className: 'lsc-btn small', disabled: busy, onClick: () => { if (busy) return; onClose(); } }, t('projects.dialog.close'))
              : dialog.step === 1
                ? e('button', {
                    type: 'button',
                    className: 'lsc-btn primary small',
                    disabled: busy || preflight.canConfirm !== true,
                    title: preflight.canConfirm === true ? '' : blockedText,
                    onClick: () => { if (busy || preflight.canConfirm !== true) return; onStep(2); },
                  }, t('projects.dialog.continue'))
                : e('button', {
                    type: 'button',
                    className: 'lsc-btn primary small',
                    disabled: busy || preflight.canConfirm !== true,
                    title: preflight.canConfirm === true ? '' : blockedText,
                    onClick: () => { if (busy || preflight.canConfirm !== true) return; onConfirm(); },
                  }, busy ? t('projects.dialog.confirming') : t('projects.dialog.confirm')),
          ),
        ),
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

    function IdentityDialog({ t, busy, onCancel, onConfirm }) {
      return e('div', { className: 'lsc-modal-wrap', onClick: (event) => { if (event.target === event.currentTarget && busy !== true) onCancel(); } },
        e('div', { className: 'lsc-modal', style: { maxWidth: 520 } },
          e('div', { className: 'lsc-modal-head' },
            e('h2', null, t('projects.identity.action.confirmTitle')),
            e('button', { type: 'button', className: 'lsc-btn ghost small', disabled: busy === true, onClick: onCancel }, t('projects.identity.action.cancel')),
          ),
          e('p', { className: 'lsc-hint', style: { marginTop: 0 } }, t('projects.identity.action.dialog')),
          e('div', { className: 'lsc-row', style: { justifyContent: 'flex-end', marginTop: 16 } },
            e('button', { type: 'button', className: 'lsc-btn', disabled: busy === true, onClick: onCancel }, t('projects.identity.action.cancel')),
            e('button', { type: 'button', className: 'lsc-btn primary', disabled: busy === true, onClick: onConfirm }, t('projects.identity.action.confirm')),
          ),
        ),
      );
    }

    function DoctorSection({ t, report, error, busy, onRun, onResync, onExport }) {
  if (error !== '') {
    return e(Section, { title: t('analytics.doctor') }, e('p', { className: 'lsc-hint' }, `${t('analytics.doctor.error')} ${error}`));
  }
  if (report === null) {
    return e(Section, { title: t('analytics.doctor') }, e('p', { className: 'lsc-hint' }, busy === true ? '…' : t('analytics.doctor.hint')));
  }
  const tone = (status) => (status === 'ok' ? 'ok' : status === 'warn' ? 'warn' : 'bad');
  return e(Section, {
    title: t('analytics.doctor'),
    action: e('div', { className: 'lsc-row' },
      e(Pill, { tone: report.summary.fail > 0 ? 'bad' : report.summary.warn > 0 ? 'warn' : 'ok' }, `${report.summary.ok} ok · ${report.summary.warn} · ${report.summary.fail}`),
      e('button', { type: 'button', className: 'lsc-btn ghost small', disabled: busy === true, onClick: onRun }, t('analytics.doctor.run')),
      typeof onExport === 'function'
        ? e('button', { type: 'button', className: 'lsc-btn ghost small', disabled: busy === true, onClick: onExport }, t('analytics.export'))
        : null,
          typeof onResync === 'function'
            ? e('button', { type: 'button', className: 'lsc-btn small', disabled: busy === true, onClick: onResync }, t('analytics.doctor.resync'))
            : null,
    ),
  },
    e('p', { className: 'lsc-hint', style: { marginBottom: 8 } }, t('analytics.doctor.hint')),
    e('div', { className: 'lsc-list' }, asArray(report.checks).map((check) => e('div', { key: check.id, className: 'lsc-row', style: { padding: '3px 0', fontSize: 11.5 } },
      e('span', { className: 'lsc-mono lsc-nowrap', style: { minWidth: 150 } }, check.id),
      e(Pill, { tone: tone(check.status) }, t(`analytics.doctor.${check.status}`)),
      e('span', { className: 'lsc-spacer' }),
      e('span', { className: 'lsc-dim', style: { textAlign: 'right' } }, check.detail),
    ))),
  );
}

// Matriz de adopción: una fila por skill, una columna por proyecto registrado. No cambia nada al pulsar
// (los interruptores viven en Proyectos); sirve para ver de un vistazo dónde está cada skill y qué versión
// tiene fijada cada proyecto, que es distinto de la versión vigente de la biblioteca.
function AdoptionSection({ t, snapshot }) {
  const skills = skillsOf(snapshot);
  const projects = projectsOf(snapshot);
  if (skills.length === 0 || projects.length === 0) {
    return e(Section, { title: t('analytics.adoption') }, e('p', { className: 'lsc-hint' }, t('analytics.adoption.empty')));
  }
  const cellOf = (skill, projectId) => {
    const rows = asArray(skill?.adoption);
    return rows.find((row) => row.projectId === projectId) ?? null;
  };
  return e(Section, { title: t('analytics.adoption') },
    e('div', { className: 'lsc-hint', style: { marginBottom: 8 } }, t('analytics.adoption.hint')),
    e('div', { className: 'lsc-table', style: { overflowX: 'auto' } },
      e('div', { className: 'lsc-row lsc-table-head', style: { gap: 8, alignItems: 'flex-start' } },
        e('span', { style: { minWidth: 220, flex: 1 } }, t('analytics.adoption.skill')),
        projects.map((project) => e('span', { key: project.id, className: 'lsc-mono lsc-nowrap', style: { minWidth: 96, textAlign: 'center' } }, project.name ?? project.id)),
      ),
      skills.map((skill) => e('div', { key: skill.id, className: 'lsc-row', style: { gap: 8, alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
        e('span', { style: { minWidth: 220, flex: 1, minHeight: 1 } },
          e('div', { className: 'lsc-item-title lsc-wrap' }, skill.title ?? skill.id),
          e('div', { className: 'lsc-mono lsc-dim lsc-nowrap' }, `v${skill.currentVersion ?? '—'}`),
        ),
        projects.map((project) => {
          const row = cellOf(skill, project.id);
          if (row === null) return e('span', { key: project.id, className: 'lsc-dim', style: { minWidth: 96, textAlign: 'center' } }, '·');
          if (row.enabled !== true) return e('span', { key: project.id, className: 'lsc-dim', style: { minWidth: 96, textAlign: 'center' } }, t('analytics.adoption.off'));
          const behind = row.version !== null && row.version !== skill.currentVersion;
          return e('span', { key: project.id, style: { minWidth: 96, textAlign: 'center' } },
            e(Pill, { tone: behind ? 'warn' : 'ok' }, String(row.version ?? '—')),
          );
        }),
      )),
    ),
    e('div', { className: 'lsc-hint', style: { marginTop: 8 } }, t('analytics.adoption.legend')),
  );
}

/**
 * Bandeja de conocimiento y decisiones de la IA. Es la pieza que hace auditable la autonomía: qué se
 * descubrió, con qué evidencia, qué decidió la máquina y qué sigue esperando a una persona.
 */
function KnowledgeSection({ t, knowledge, projects, onPolicy, onVerifyOrigin }) {
  const data = knowledge ?? {};
  const readable = data.ok === true;
  const summary = data.summary ?? {};
  const insights = asArray(data.insights);
  const decisions = asArray(data.decisions);
  const contradictions = asArray(data.contradictions);
  const mode = String(data.policy?.mode ?? summary.mode ?? "");
  const pending = Number(summary.pending ?? 0);

  const header = e("div", { className: "lsc-card-head" },
    e("div", null,
      e("div", { className: "lsc-card-title" }, t("analytics.knowledge")),
      e("div", { className: "lsc-hint" }, readable
        ? t("analytics.knowledge.hint")
        : t("analytics.knowledge.unreadable")),
    ),
    e(Pill, { tone: pending === 0 ? "ok" : "warn" }, t("analytics.knowledge.pending", { n: pending })),
  );

  const modeLine = readable && mode !== ""
    ? e("div", { className: "lsc-hint" }, t("analytics.knowledge.mode", { mode }))
    : null;

  const rows = insights.map((insight) => e("div", { className: "lsc-item", key: String(insight.insightId) },
    e("div", { className: "lsc-item-title" }, String(insight.title ?? insight.insightId)),
    e("div", { className: "lsc-item-meta" },
      e(Pill, { tone: insight.confidence === "strong" ? "ok" : insight.confidence === "moderate" ? "warn" : "" },
        t("analytics.knowledge.confidence") + ": " + String(insight.confidence ?? "?")),
      " · " + String(insight.state ?? ""),
      insight.projectId ? " · " + String(insight.projectId) : "",
    ),
    insight.suggestedAction ? e("div", { className: "lsc-hint" }, String(insight.suggestedAction)) : null,
    e("div", { className: "lsc-item-meta" },
      e(Pill, { tone: insight.origin?.verified === true ? "ok" : "warn" },
        insight.origin?.verified === true
          ? t("analytics.knowledge.origin.verified")
          : t("analytics.knowledge.origin.declared")),
      insight.origin?.verified !== true && typeof onVerifyOrigin === "function"
        ? e("button", {
          type: "button",
          className: "lsc-btn ghost small",
          onClick: () => onVerifyOrigin(String(insight.insightId ?? "")),
        }, t("analytics.knowledge.origin.verify"))
        : null,
      insight.actedOn ? " · " + t("analytics.knowledge.actedOn", { operation: String(insight.actedOn.operation ?? "") }) : "",
    ),
  ));

  const settledPill = (decision) => {
    if (!decision.settled) return e(Pill, { tone: "warn" }, t("analytics.knowledge.settled.pending"));
    return decision.settled.ok === true
      ? e(Pill, { tone: "ok" }, t("analytics.knowledge.settled.ok"))
      : e(Pill, { tone: "bad" }, t("analytics.knowledge.settled.failed", { detail: String(decision.settled.detail ?? "") }));
  };
  // RT-D3: lo que se autorizó y no llegó a firmarse es visible y recuperable, no un hueco silencioso.
  const pendingSettlements = asArray(data.pendingSettlements);
  const pendingRows = pendingSettlements.slice(0, 6).map((item) => e("div", { className: "lsc-item", key: String(item.decisionId) },
    e("div", { className: "lsc-item-title" }, String(item.decisionId) + " · " + String(item.operation ?? "")),
    e("div", { className: "lsc-hint" }, String(item.projectId ?? "") + (item.ageMs === null ? "" : " · hace " + String(Math.round(item.ageMs / 1000)) + " s")),
  ));

  const decisionRows = decisions.slice(0, 6).map((decision) => e("div", { className: "lsc-item", key: String(decision.decisionId) },
    e("div", { className: "lsc-item-title" }, String(decision.outcome ?? "") + (decision.skillId ? " · " + String(decision.skillId) : "")),
    e("div", { className: "lsc-item-meta" },
      String(decision.at ?? decision.createdAt ?? "") + (decision.actor ? " · " + String(decision.actor) : "") + (decision.projectId ? " · " + String(decision.projectId) : ""),
      " ",
      settledPill(decision),
    ),
    decision.evidenceLevel ? e("div", { className: "lsc-hint" }, t("analytics.knowledge.evidence", { level: String(decision.evidenceLevel) })) : null,
  ));

  const contradictionRows = contradictions.map((entry, index) => e("div", { className: "lsc-item", key: String(entry.location) + String(index) },
    e("div", { className: "lsc-item-title" }, String(entry.location ?? "")),
    e("div", { className: "lsc-item-meta" }, asArray(entry.results).map((row) => String(row.result ?? "")).join("  ·  ")),
  ));

  const policyProjects = asArray(projects);
  const policyOf = (projectId) => {
    const entry = data.policy && data.policy.projects ? data.policy.projects[projectId] : undefined;
    const value = entry && typeof entry.mode === "string" ? entry.mode : mode;
    return value === "" ? "guarded-autonomous" : value;
  };
  const policyRows = readable && typeof onPolicy === "function"
    ? policyProjects.map((project) => {
        const id = String(project.id ?? "");
        const current = policyOf(id);
        const button = (label, value) => e("button", {
          key: id + value,
          className: "lsc-btn ghost" + (current === value ? " on" : ""),
          type: "button",
          disabled: current === value,
          onClick: () => onPolicy(id, value),
        }, label);
        return e("div", { className: "lsc-item", key: id },
          e("div", { className: "lsc-row" },
            e("span", { className: "lsc-item-title lsc-nowrap" }, String(project.name ?? id)),
            e("span", { className: "lsc-spacer" }),
            e(Pill, { tone: current === "guarded-autonomous" ? "ok" : "warn" }, current),
          ),
          e("div", { className: "lsc-row", style: { marginTop: 6, gap: 8 } },
            button(t("analytics.knowledge.policy.autonomous"), "guarded-autonomous"),
            button(t("analytics.knowledge.policy.human"), "human-approved"),
          ),
        );
      })
    : [];

  return e("section", { className: "lsc-card" },
    header,
    modeLine,
    e("div", { className: "lsc-card-title", style: { marginTop: 12 } }, t("analytics.knowledge.policy")),
    e("div", { className: "lsc-hint" }, t("analytics.knowledge.policy.hint")),
    policyRows.length === 0 ? e("div", { className: "lsc-hint" }, t("analytics.knowledge.policy.empty")) : e("div", null, policyRows),
    e("div", { className: "lsc-card-title", style: { marginTop: 12 } }, t("analytics.knowledge.pendingSettlements")),
    e("div", { className: "lsc-hint" }, t("analytics.knowledge.pendingSettlements.hint")),
    pendingRows.length === 0
      ? e("div", { className: "lsc-hint" }, t("analytics.knowledge.pendingSettlements.empty"))
      : e("div", null, pendingRows),
    e("div", { className: "lsc-card-title", style: { marginTop: 12 } }, t("analytics.knowledge.decisions")),
    decisionRows.length === 0 ? e("div", { className: "lsc-hint" }, t("analytics.knowledge.decisions.empty")) : e("div", null, decisionRows),
    e("div", { className: "lsc-card-title", style: { marginTop: 12 } }, t("analytics.knowledge.contradictions")),
    contradictionRows.length === 0 ? e("div", { className: "lsc-hint" }, t("analytics.knowledge.contradictions.empty")) : e("div", null, contradictionRows),
    e("div", { className: "lsc-card-title", style: { marginTop: 12 } }, t("analytics.knowledge.inbox")),
    rows.length === 0 ? e("div", { className: "lsc-hint" }, readable ? t("analytics.knowledge.empty") : t("analytics.knowledge.unreadable")) : e("div", null, rows),
  );
}
/**
 * Indicadores con fuente declarada. Cada bloque dice qué mide y de dónde sale: la analítica que enseña un
 * número sin decir qué cuenta acaba sirviendo para justificar cualquier cosa.
 */
function InsightsSection({ t, insights, onOpen }) {
  const data = insights ?? {};
  const pins = asArray(data.pinsBehind);
  const projects = asArray(data.projects);
  const quality = asArray(data.qualityPerVersion);
  const references = data.references ?? { totals: {}, changes: [] };
  const skillsRow = asArray(data.skills);
  const least = asArray(data.leastUsed);
  const definitions = data.definitions ?? {};
  const applications = data.applications ?? { total: 0, bySkill: [] };
  const deliveries = data.deliveries ?? { total: 0, withoutDeclaration: 0 };
  const definitionOf = (key) => (typeof definitions?.[key]?.definition === 'string' ? definitions[key].definition : '');
  return e('div', { className: 'lsc-stack' },
    e(Section, { title: t('analytics.applications'), hint: definitionOf('applications') },
      e('div', { className: 'lsc-list' },
        e('div', { className: 'lsc-item' },
          e('div', { className: 'lsc-row' },
            e('span', { className: 'lsc-item-title' }, t('analytics.applications.declared')),
            e('span', { className: 'lsc-spacer' }),
            e(Pill, { tone: applications.total > 0 ? 'ok' : 'muted' }, String(applications.total)),
          ),
          e('div', { className: 'lsc-item-meta' }, t('analytics.applications.withoutDeclaration', { n: String(deliveries.withoutDeclaration ?? 0) })),
        ),
        asArray(applications.bySkill).map((entry) =>
          e('div', { key: String(entry.skillId), className: 'lsc-item', style: { cursor: 'pointer' }, onClick: () => onOpen(entry.skillId) },
            e('div', { className: 'lsc-row' },
              e('span', { className: 'lsc-item-title lsc-nowrap' }, entry.title ?? entry.skillId),
              e('span', { className: 'lsc-spacer' }),
              e(Pill, { tone: 'ok' }, String(entry.declarations)),
            ),
            e('div', { className: 'lsc-item-meta' }, String(entry.skillId)),
          ),
        ),
      ),
      applications.total === 0 && deliveries.total === 0 ? e(Empty, null, t('analytics.applications.empty')) : null,
    ),
    e(Section, { title: t('analytics.events'), hint: t('analytics.events.hint') },
      asArray(data.events?.recent).length === 0
        ? e(Empty, null, t('analytics.events.empty'))
        : e('div', { className: 'lsc-list' },
            asArray(data.events.recent).slice(0, 12).map((event) =>
              e('div', { key: String(event.id ?? event.at), className: 'lsc-item' },
                e('div', { className: 'lsc-row' },
                  e('span', { className: 'lsc-item-title lsc-nowrap' }, String(event.type ?? '')),
                  e('span', { className: 'lsc-spacer' }),
                  e(Pill, { tone: event.result === 'failed' ? 'bad' : event.result === 'ok' ? 'ok' : 'muted' }, String(event.status ?? 'other')),
                ),
                e('div', { className: 'lsc-item-meta' }, `${String(event.at ?? '')} · ${String(event.actor ?? '—')}${event.skillId ? ` · ${event.skillId}` : ''}`),
              ),
            ),
            data.events?.truncated === true ? e('div', { className: 'lsc-hint' }, t('analytics.events.truncated')) : null,
          ),
    ),
    e(Section, { title: t('analytics.rollbacks'), hint: definitionOf('rollbacks') },
      asArray(data.rollbacks?.bySkill).length === 0
        ? e(Empty, null, t('analytics.rollbacks.empty'))
        : e('div', { className: 'lsc-list' },
            e('div', { className: 'lsc-item' },
              e('div', { className: 'lsc-row' },
                e('span', { className: 'lsc-item-title' }, t('analytics.rollbacks.total')),
                e('span', { className: 'lsc-spacer' }),
                e(Pill, { tone: 'warn' }, String(data.rollbacks.total ?? 0)),
              ),
              e('div', { className: 'lsc-item-meta' }, t('analytics.rollbacks.latest', { at: String(data.rollbacks.latestAt ?? '—') })),
            ),
            asArray(data.rollbacks.bySkill).map((entry) =>
              e('div', { key: String(entry.skillId), className: 'lsc-item', style: { cursor: 'pointer' }, onClick: () => onOpen(entry.skillId) },
                e('div', { className: 'lsc-row' },
                  e('span', { className: 'lsc-item-title lsc-nowrap' }, entry.title ?? entry.skillId),
                  e('span', { className: 'lsc-spacer' }),
                  e(Pill, { tone: 'warn' }, String(entry.count)),
                ),
                e('div', { className: 'lsc-item-meta' }, String(entry.skillId)),
              ),
            ),
          ),
    ),
    e(Section, { title: t('analytics.pins'), hint: definitionOf('pinsBehind') },
      pins.length === 0
        ? e(Empty, null, t('analytics.pins.empty'))
        : e('div', { className: 'lsc-list' }, pins.map((pin) =>
            e('div', { key: pin.projectId + '-' + pin.skillId, className: 'lsc-item', style: { cursor: 'pointer' }, onClick: () => onOpen(pin.skillId) },
              e('div', { className: 'lsc-row' },
                e('span', { className: 'lsc-item-title lsc-nowrap' }, pin.title ?? pin.skillId),
                e('span', { className: 'lsc-spacer' }),
                e(Pill, { tone: pin.enabled === true ? 'warn' : 'muted' }, pin.enabled === true ? t('analytics.pins.on') : t('analytics.pins.off')),
              ),
              e('div', { className: 'lsc-item-meta' }, String(pin.projectId) + ' · ' + String(pin.version) + ' → ' + String(pin.currentVersion)),
            ),
          )),
    ),
    e('div', { className: 'lsc-cols' },
      e(Section, { title: t('analytics.projects'), hint: t('analytics.projects.hint') },
        projects.length === 0
          ? e(Empty, null, t('analytics.projects.empty'))
          : e('div', { className: 'lsc-list' }, projects.map((project) =>
              e('div', { key: project.projectId, className: 'lsc-item' },
                e('div', { className: 'lsc-row' },
                  e('span', { className: 'lsc-item-title lsc-nowrap' }, project.name ?? project.projectId),
                  e('span', { className: 'lsc-spacer' }),
                  e('span', { className: 'lsc-mono' }, String(project.active) + '/' + String(project.skills)),
                ),
                e('div', { className: 'lsc-item-meta' }, t('analytics.projects.detail', { active: project.active, paused: project.paused, loads: project.loads })),
              ),
            )),
      ),
      e(Section, { title: t('analytics.qualityPerVersion'), hint: definitionOf('qualityPerVersion') },
        quality.length === 0
          ? e(Empty, null, t('analytics.qualityPerVersion.empty'))
          : e('div', { className: 'lsc-list' }, quality.slice(-8).reverse().map((entry) =>
              e('div', { key: entry.skillId + '-' + entry.version, className: 'lsc-item', style: { cursor: 'pointer' }, onClick: () => onOpen(entry.skillId) },
                e('div', { className: 'lsc-row' },
                  e('span', { className: 'lsc-item-title lsc-nowrap' }, String(entry.title) + ' · ' + String(entry.version)),
                  e('span', { className: 'lsc-spacer' }),
                  e(Pill, { tone: entry.delta === null ? 'muted' : entry.delta > 0 ? 'ok' : entry.delta < 0 ? 'warn' : 'muted' }, String(entry.score) + '/100' + (entry.delta === null ? '' : ' (' + (entry.delta > 0 ? '+' : '') + String(entry.delta) + ')')),
                ),
              ),
            )),
      ),
      e(Section, { title: t('analytics.references'), hint: definitionOf('references') },
        e('div', { className: 'lsc-row', style: { gap: 8, marginBottom: 8 } },
          e(Pill, { tone: 'ok' }, '+' + String(Number(references?.totals?.added ?? 0))),
          e(Pill, { tone: 'warn' }, '-' + String(Number(references?.totals?.removed ?? 0))),
          e(Pill, { tone: 'muted' }, '~' + String(Number(references?.totals?.modified ?? 0))),
        ),
        asArray(references.changes).length === 0
          ? e(Empty, null, t('analytics.references.empty'))
          : e('div', { className: 'lsc-list' }, asArray(references.changes).slice(-6).reverse().map((change) =>
              e('div', { key: change.skillId + '-' + change.to, className: 'lsc-item' },
                e('div', { className: 'lsc-item-title lsc-nowrap' }, String(change.title) + ' · ' + String(change.from) + ' → ' + String(change.to)),
                e('div', { className: 'lsc-item-meta' }, t('analytics.references.detail', { added: asArray(change.added).length, removed: asArray(change.removed).length, modified: asArray(change.modified).length })),
              ),
            )),
      ),
      e(Section, { title: t('analytics.least'), hint: definitionOf('top') },
        least.length === 0
          ? e(Empty, null, t('analytics.top.empty'))
          : e('div', { className: 'lsc-list' }, least.map((entry) =>
              e('div', { key: entry.skillId, className: 'lsc-item', style: { cursor: 'pointer' }, onClick: () => onOpen(entry.skillId) },
                e('div', { className: 'lsc-row' }, e('span', { className: 'lsc-item-title lsc-nowrap' }, entry.title ?? entry.skillId), e('span', { className: 'lsc-spacer' }), e('span', { className: 'lsc-mono' }, String(entry.enabledProjects) + ' · ' + String(entry.loads))),
                e('div', { className: 'lsc-item-meta' }, t('analytics.least.hint', { projects: entry.enabledProjects, loads: entry.loads })),
              ),
            )),
      ),
    ),
    e('div', { className: 'lsc-hint' }, t('analytics.definitions', { n: skillsRow.length, events: Number(data?.events?.matched ?? 0) })),
  );
}

function AnalyticsView({ t, lang, snapshot, onMigrate, migrationBusy, migrationResult, filters, onFilters, onOpen, doctor, doctorError, doctorBusy, onDoctor, onResync, onExport, onPolicy, onVerifyOrigin }) {
      const skills = skillsOf(snapshot);
      // Navegación gráfico → eventos: pulsar un día acota el rango a ese día y la lista de eventos
      // responde. Se hace con el mismo filtro del servidor, no con una copia local de los eventos.
      const onPickDay = (day) => onFilters({ from: String(day), to: String(day) });
      const analytics = snapshot?.analytics ?? {};
      const insights = snapshot?.insights ?? {};
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

        e('div', { className: 'lsc-row', style: { marginBottom: 8, flexWrap: 'wrap', gap: 8 } },
          e('select', {
            className: 'lsc-input select',
            value: filters?.project ?? '',
            onChange: (event) => onFilters({ project: event.target.value }),
          },
            e('option', { value: '' }, t('analytics.filter.all')),
            asArray(snapshot?.projects).map((project) => e('option', { key: project.id, value: project.id }, project.name ?? project.id)),
          ),
          e('select', {
            className: 'lsc-input select',
            value: String(filters?.days ?? 14),
            onChange: (event) => onFilters({ days: Number(event.target.value) }),
          },
            [7, 14, 30, 90].map((value) => e('option', { key: value, value: String(value) }, t('analytics.filter.days', { n: value }))),
          ),
          e('input', {
            className: 'lsc-input',
            type: 'date',
            title: t('analytics.filter.from'),
            value: String(filters?.from ?? ''),
            onChange: (event) => onFilters({ from: event.target.value }),
          }),
          e('input', {
            className: 'lsc-input',
            type: 'date',
            title: t('analytics.filter.to'),
            value: String(filters?.to ?? ''),
            onChange: (event) => onFilters({ to: event.target.value }),
          }),
          e('select', {
            className: 'lsc-input select',
            value: String(filters?.skill ?? ''),
            onChange: (event) => onFilters({ skill: event.target.value }),
          },
            e('option', { value: '' }, t('analytics.filter.anySkill')),
            skills.map((skill) => e('option', { key: skill.id, value: skill.id }, skill.title ?? skill.id)),
          ),
          e('select', {
            className: 'lsc-input select',
            value: String(filters?.type ?? ''),
            onChange: (event) => onFilters({ type: event.target.value }),
          },
            e('option', { value: '' }, t('analytics.filter.anyType')),
            asArray(insights?.eventTypes ?? snapshot?.insights?.eventTypes).map((type) => e('option', { key: type, value: type }, type)),
          ),
          e('select', {
            className: 'lsc-input select',
            value: String(filters?.status ?? ''),
            onChange: (event) => onFilters({ status: event.target.value }),
          },
            e('option', { value: '' }, t('analytics.filter.anyStatus')),
            asArray(insights?.options?.statuses).map((status) => e('option', { key: status, value: status }, t(`analytics.filter.status.${status}`))),
          ),
          e('select', {
            className: 'lsc-input select',
            value: String(filters?.result ?? ''),
            onChange: (event) => onFilters({ result: event.target.value }),
          },
            e('option', { value: '' }, t('analytics.filter.anyResult')),
            asArray(insights?.options?.results).map((result) => e('option', { key: result, value: result }, t(`analytics.filter.result.${result}`))),
          ),
          (filters?.from ?? '') !== '' || (filters?.to ?? '') !== '' || (filters?.skill ?? '') !== '' || (filters?.type ?? '') !== '' || (filters?.status ?? '') !== '' || (filters?.result ?? '') !== ''
            ? e('button', { className: 'lsc-btn ghost', type: 'button', onClick: () => onFilters({ from: '', to: '', skill: '', type: '', status: '', result: '', version: '' }) }, t('analytics.filter.clear'))
            : null,
          e('span', { className: 'lsc-hint', style: { margin: 0 } }, t('analytics.filter.hint')),
        ),
        e('div', { className: 'lsc-hint', style: { marginBottom: 10 } }, t('analytics.filter.range', { from: String(insights?.window?.from ?? '—'), to: String(insights?.window?.to ?? '—'), n: String(insights?.events?.matched ?? 0) })),

        e('div', { className: 'lsc-kpis', style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } },
          e(Kpi, { label: t('kpi.skills'), value: skills.length }),
          e(Kpi, { label: t('kpi.loads'), value: Number(analytics?.loads ?? 0) }),
          e(Kpi, { label: t('kpi.pending'), value: Number(analytics?.improvements?.proposed ?? 0) }),
          e(Kpi, { label: t('kpi.quality'), value: Number(analytics?.quality?.average ?? 0) > 0 ? `${Math.round(analytics.quality.average)}/100` : '—', hint: `${analytics?.quality?.measured ?? 0} ${t('quality.pass').toLowerCase()}` }),
        ),

        e('div', { className: 'lsc-grid-2' },
          e(Section, { title: t('activity.title'), hint: t('activity.hint') }, series.length === 0 ? e(Empty, null, t('activity.empty')) : e(ActivityChart, { t, lang, series, onPick: onPickDay })),
          e(Section, { title: t('analytics.quality') },
            bar('pass', '#22c55e', 'analytics.quality.pass'),
            bar('warn', '#f59e0b', 'analytics.quality.warn'),
            bar('fail', '#ef4444', 'analytics.quality.fail'),
            bar('none', '#94a3b8', 'analytics.quality.none'),
          ),
        ),

        e('div', { className: 'lsc-stack' },
          e(Section, { title: t('analytics.top') },
            top.length === 0
              ? e(Empty, null, t('analytics.top.empty'))
              : e('div', { className: 'lsc-list' }, top.map((entry) =>
                  e('div', { key: entry.id, className: 'lsc-item', style: { cursor: 'pointer' }, onClick: () => onOpen(entry.id) },
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
      e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.schema')), e('div', { className: 'lsc-mono' }, `v${snapshot?.schemaVersion ?? '—'}`)),
      e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.backup')), e('div', { className: 'lsc-mono' }, backupLabel(t, snapshot?.backup))),
        snapshot?.backup?.status === 'verified' ? e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.backupSha')), e('div', { className: 'lsc-mono lsc-nowrap' }, shortSha(snapshot.backup.sha256))) : null,
        snapshot?.backup?.status === 'verified' ? e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.backupGeneration')), e('div', { className: 'lsc-mono' }, String(snapshot.backup.generation ?? '—'))) : null,
        snapshot?.backup?.status === 'verified' ? e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.backupSize')), e('div', { className: 'lsc-mono' }, `${formatBytes(snapshot.backup.size)} · ${String(snapshot.backup.createdAt ?? '').slice(0, 10)}`)) : null,
        snapshot?.backup?.status === 'unverified' && snapshot.backup.error ? e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.backupReason')), e('div', { className: 'lsc-small lsc-wrap' }, String(snapshot.backup.error))) : null,
              e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.exists')), e('div', { className: 'lsc-mono' }, snapshot?.storeExists === true ? t('analytics.diag.exists') : t('analytics.diag.missing'))),
              snapshot?.storeError ? e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-item-meta' }, t('analytics.diag.error', { message: snapshot.storeError }))) : null,
            ),
          ),
        ),

        e(InsightsSection, { t, insights, onOpen }),

        e(KnowledgeSection, { t, knowledge: snapshot.knowledge, projects: snapshot.projects, onPolicy, onVerifyOrigin }),

        e(AdoptionSection, { t, snapshot }),

        e(DoctorSection, { t, report: doctor, error: doctorError, busy: doctorBusy, onRun: onDoctor, onResync, onExport }),

        e(MigrationSection, { t, snapshot, onMigrate, busy: migrationBusy, result: migrationResult }),
      );
    }

    /* -------------------------------------------------------------------- drawer */

    function SkillDrawer({ t, lang, snapshot, skillId, onClose, onToggle, onVersion, onEvaluate, onImprove, onExport, busy }) {
      // El cajón es un componente con estado: TODOS los hooks van antes de cualquier salida
      // temprana. Con la salida en medio, React veía menos hooks y el slot `main` se caía
      // (ReferenceError de la constante declarada más abajo), dejando el panel congelado en el
      // último fotograma y sin aceptar clics. La skill nula se resuelve dentro del efecto.
      const skill = findSkill(snapshot, skillId);
      const skillVersion = String(skill?.currentVersion ?? '');
      const [diff, setDiff] = useState(null);
      const [diffError, setDiffError] = useState('');
      const [diffBusy, setDiffBusy] = useState('');
      const [detail, setDetail] = useState(null);
      const [detailError, setDetailError] = useState('');
      const [exportResult, setExportResult] = useState(null);
      const [exportBusy, setExportBusy] = useState(false);

      const compareWithCurrent = useCallback(async (version) => {
        setDiffBusy(version);
        setDiffError('');
        try {
          // La versión vigente se resuelve DENTRO del manejador: el cajón puede seguir abierto
          // cuando llega un snapshot nuevo, y la comparación debe usar la foto del clic.
          const currentVersion = String(findSkill(snapshot, skillId)?.currentVersion ?? '');
          const query = new URLSearchParams({ id: skillId, from: version, to: currentVersion });
          const response = await fetch(`${API}/diff?${query.toString()}`);
          const parsed = await readJson(response);
          if (!parsed.ok || !parsed.data || parsed.data.ok !== true) {
            setDiff(null);
            setDiffError(parsed.data?.message || parsed.message || String(response.status));
            return;
          }
          setDiff(parsed.data);
        } catch (failure) {
          setDiff(null);
          setDiffError(String(failure?.message ?? failure));
        } finally {
          setDiffBusy('');
        }
      }, [skillId, snapshot]);

      // Historial y métricas se piden a su propia ruta: el retrato del panel es la foto de la
      // biblioteca y no lleva la línea de tiempo de cada skill. Si la skill desaparece del
      // retrato, el efecto no pide nada y el cajón cae en su estado vacío.
      useEffect(() => {
        if (skill === null) {
          setDetail(null);
          setDetailError('');
          return undefined;
        }
        let alive = true;
        setDetail(null);
        setDetailError('');
        fetch(`${API}/skill?id=${encodeURIComponent(skillId)}`, { headers: { accept: 'application/json' } })
          .then((response) => readJson(response))
          .then((parsed) => {
            if (alive !== true) return;
            if (parsed.ok !== true || parsed.data?.ok !== true) {
              setDetailError(parsed.data?.message ?? parsed.message);
              return;
            }
            setDetail(parsed.data);
          })
          .catch((failure) => { if (alive === true) setDetailError(String(failure?.message ?? failure)); });
        return () => { alive = false; };
      }, [skill, skillId]);

      if (skill === null) {
        return e('div', { className: 'lsc-overlay', onClick: onClose },
          e('div', { className: 'lsc-drawer', onClick: (event) => event.stopPropagation() }, e(Empty, null, t('app.empty'))));
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
            e('button', {
              type: 'button',
              className: 'lsc-btn ghost small',
              disabled: busy || exportBusy === true || typeof onExport !== 'function',
              onClick: async () => {
                if (exportBusy === true || typeof onExport !== 'function') return;
                setExportBusy(true);
                try {
                  const result = await onExport(skillId, skillVersion);
                  setExportResult(result ?? { ok: false, code: 'failed' });
                } finally {
                  setExportBusy(false);
                }
              },
            }, exportBusy === true ? t('portability.export.working') : t('drawer.export')),
            e('button', { type: 'button', className: 'lsc-btn ghost small', onClick: onClose }, t('drawer.close')),
          ),
          exportResult === null ? null : e(ExportResultBox, { t, data: exportResult }),
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
                version.version !== skill.currentVersion
                  ? e('button', { type: 'button', className: 'lsc-btn ghost small', disabled: diffBusy !== '', onClick: () => compareWithCurrent(version.version) }, t('drawer.diff'))
                  : null,
              ),
            )),
            diffError !== ''
              ? e('p', { className: 'lsc-hint', style: { color: 'var(--lsc-bad)' } }, `${t('drawer.diff.error')} ${diffError}`)
              : null,
            diff === null
              ? null
              : e('div', { style: { marginTop: 10 } },
                  e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', marginBottom: 6 } },
                    e('span', { className: 'lsc-label', style: { margin: 0 } }, `${t('drawer.diff.title')}: ${diff.from.version} → ${diff.to.version}`),
                    e('span', { className: 'lsc-spacer' }),
                    e(Pill, { tone: 'ok' }, `+${diff.added}`),
                    e(Pill, { tone: 'bad' }, `-${diff.removed}`),
                  ),
                  diff.preview.length === 0
                    ? e('p', { className: 'lsc-hint' }, diff.truncated ? t('drawer.diff.truncated') : t('drawer.diff.none'))
                    : e('pre', { className: 'lsc-pre' }, diff.preview.map((line) => `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '} ${line.text}`).join('\n')),
                  diff.truncated ? e('p', { className: 'lsc-hint' }, t('drawer.diff.truncated')) : null,
                ),
          ),

          e('div', null,
            e('div', { className: 'lsc-label' }, t('drawer.history')),
            detailError !== ''
              ? e('p', { className: 'lsc-hint' }, `${t('drawer.history.error')} ${detailError}`)
              : detail === null
                ? e('p', { className: 'lsc-hint' }, '…')
                : e('div', null,
                    e('div', { className: 'lsc-row', style: { flexWrap: 'wrap', marginBottom: 8 } },
                      e(Pill, { tone: 'mute' }, `${detail.metrics.versions} ${t('drawer.history.versions')}`),
                      e(Pill, { tone: 'ok' }, `${detail.metrics.projectsActive} ${t('drawer.history.active')}`),
                      e(Pill, { tone: 'info' }, `${detail.metrics.loads} ${t('drawer.history.loads')}`),
                      detail.metrics.quality.delta === null
                        ? null
                        : e(Pill, { tone: detail.metrics.quality.delta >= 0 ? 'ok' : 'bad' }, `${t('drawer.history.delta')} ${detail.metrics.quality.delta >= 0 ? '+' : ''}${detail.metrics.quality.delta}`),
                    ),
                    asArray(detail.timeline).length === 0
                      ? e('p', { className: 'lsc-hint' }, t('drawer.history.empty'))
                      : e('div', { className: 'lsc-list' }, detail.timeline.slice(0, 12).map((event, index) => e('div', { key: `${event.at}-${index}`, className: 'lsc-row', style: { padding: '3px 0', fontSize: 11.5 } },
                          e('span', { className: 'lsc-mono', style: { minWidth: 132 } }, formatDate(event.at, lang)),
                          e('span', { className: 'lsc-item-title' }, event.type),
                          e('span', { className: 'lsc-spacer' }),
                          e('span', { className: 'lsc-dim' }, event.actor),
                        ))),
                  ),
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

    /* --------------------------------------------------------------- migración */

    const MIGRATION_BLOCKERS = ['store-unreadable', 'future-version', 'already-migrated', 'backup-required', 'backup-stale', 'store-busy'];

    /**
     * Administración del esquema: una persona ve el estado y decide.
     *
     * El panel NO decide si se puede migrar: `snapshot.migration` viene calculado del servidor, que
     * vuelve a comprobarlo al ejecutar. Aquí sólo se pinta y se deshabilita el botón.
     */
    function MigrationSection({ t, snapshot, onMigrate, busy, result }) {
      const status = snapshot?.migration ?? null;
      const counts = snapshot?.counts ?? {};
      const from = status?.from ?? snapshot?.schemaVersion ?? null;
      const to = status?.to ?? null;
      const blocker = status?.blocker && MIGRATION_BLOCKERS.includes(status.blocker) ? status.blocker : null;
      const done = from !== null && to !== null && from === to;
      const migratedAt = String(snapshot?.schemaMeta?.migratedAt ?? '');
      const canMigrate = status?.canMigrate === true && busy !== true;
      const entityText = t('schema.entitiesValue', {
        skills: String(counts.skills ?? 0),
        versions: String(counts.versions ?? 0),
        projects: String(counts.projects ?? 0),
        assignments: String(counts.assignments ?? 0),
        improvements: String(counts.improvements ?? 0),
        events: String(counts.events ?? 0),
      });
      const row = (key, label, value, mono = true) =>
        e('div', { key, className: 'lsc-item' },
          e('div', { className: 'lsc-item-meta' }, label),
          e('div', { className: mono ? 'lsc-mono lsc-wrap' : 'lsc-small lsc-wrap' }, value),
        );
      return e(Section, { title: t('schema.title') },
        e('div', { className: 'lsc-list' },
          row('current', t('schema.current'), `v${from ?? '—'}`),
          row('target', t('schema.target'), `v${to ?? '—'}`),
          row('integrity', t('schema.integrity'), snapshot?.integrity?.status === 'ok' ? t('schema.integrity.ok') : t('schema.integrity.bad')),
          row('backup', t('schema.backup'), `${backupLabel(t, snapshot?.backup)}${snapshot?.backup?.generation ? ` · ${snapshot.backup.generation}` : ''}`),
          snapshot?.backup?.status === 'verified'
            ? row('backupSha', t('analytics.diag.backupSha'), shortSha(snapshot.backup.sha256))
            : null,
          row('entities', t('schema.entities'), entityText, false),
          row(
            'state',
            t('schema.state'),
            done
              ? t('schema.state.done', { schema: String(from), date: migratedAt === '' ? '' : ` · ${migratedAt.slice(0, 10)}` })
              : blocker === null
                ? t('schema.state.ready')
                : `${t('schema.state.blocked')}: ${t(`schema.blocker.${blocker}`)}`,
            false,
          ),
        ),
        done ? null : e('div', { className: 'lsc-row', style: { marginTop: 10, gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
          e('button', {
            type: 'button',
            className: 'lsc-btn primary',
            disabled: !canMigrate,
            onClick: onMigrate,
            title: blocker === null ? '' : t(`schema.blocker.${blocker}`),
          }, busy === true ? t('schema.busy') : t('schema.action')),
          e('span', { className: 'lsc-small lsc-meta lsc-wrap' }, t('schema.hint')),
        ),
        result ? e('div', {
          className: 'lsc-small lsc-wrap',
          style: { marginTop: 10, color: result.ok === true ? 'var(--lsc-ok)' : 'var(--lsc-bad)' },
        }, result.text) : null,
      );
    }

    /** Confirmación humana: explica qué se toca y qué se conserva antes de escribir nada. */
    function MigrateDialog({ t, busy, result, onCancel, onConfirm }) {
      return e('div', { className: 'lsc-modal-wrap', onClick: busy === true ? undefined : onCancel },
        e('div', { className: 'lsc-modal', onClick: (event) => event.stopPropagation() },
          e('div', { className: 'lsc-modal-title' }, t('schema.dialog.title')),
          e('p', { className: 'lsc-hint' }, t('schema.dialog.lead')),
          e('div', { className: 'lsc-list' },
            e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-small lsc-wrap' }, t('schema.dialog.writes'))),
            e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-small lsc-wrap' }, t('schema.dialog.backup'))),
            e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-small lsc-wrap' }, t('schema.dialog.adds'))),
            e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-small lsc-wrap' }, t('schema.dialog.keeps'))),
            e('div', { className: 'lsc-item' }, e('div', { className: 'lsc-small lsc-wrap' }, t('schema.dialog.rollback'))),
          ),
          result ? e('div', {
            className: 'lsc-small lsc-wrap',
            style: { marginTop: 10, color: result.ok === true ? 'var(--lsc-ok)' : 'var(--lsc-bad)' },
          }, result.text) : null,
          e('div', { className: 'lsc-row', style: { justifyContent: 'flex-end', marginTop: 14 } },
            e('button', { type: 'button', className: 'lsc-btn ghost', disabled: busy === true, onClick: onCancel }, t('schema.dialog.cancel')),
            e('button', { type: 'button', className: 'lsc-btn primary', disabled: busy === true, onClick: onConfirm }, busy === true ? t('schema.busy') : t('schema.dialog.confirm')),
          ),
        ),
      );
    }

    /* ------------------------------------------------------- frontera de error */
    // El sistema de slots del harness no pinta los errores de render: si el componente lanza, el
    // ocupante del slot queda inactivo y el área se ve vacía. Esta frontera convierte cualquier
    // excepción en una tarjeta visible y reintentable. Es una clase porque React sólo reconoce
    // `getDerivedStateFromError` en componentes de clase.
    const BaseComponent = typeof React.Component === 'function'
      ? React.Component
      : class {
        constructor(props) { this.props = props; this.state = {}; }
        setState(next) {
          const patch = typeof next === 'function' ? next(this.state) : next;
          this.state = { ...this.state, ...(patch ?? {}) };
          if (typeof this.forceUpdate === 'function') this.forceUpdate();
        }
      };

    function firstStackLine(error) {
      const raw = text(error?.stack);
      if (raw === '') return '';
      return raw.split('\n').map((line) => line.trim()).filter((line) => line !== '')[0] ?? '';
    }

    function diagnosticText(error, step) {
      return [
        'LifeCode Skill Center · diagnóstico',
        `paso: ${step}`,
        `mensaje: ${text(error?.message) || text(error) || 'error de render sin mensaje'}`,
        `stack: ${firstStackLine(error) || '(sin stack)'}`,
      ].join('\n');
    }

    function PanelDiagnosticCard({ t, error, step, onRetry }) {
      const [copyState, setCopyState] = useState('');
      const clipboard = typeof navigator !== 'undefined' && navigator !== null ? navigator.clipboard : null;
      const canCopy = clipboard !== null && clipboard !== undefined && typeof clipboard.writeText === 'function';
      const stack = firstStackLine(error);
      const copy = () => {
        if (canCopy !== true) return;
        try {
          const done = clipboard.writeText(diagnosticText(error, step));
          if (done !== null && done !== undefined && typeof done.then === 'function') {
            done.then(() => setCopyState('ok'), () => setCopyState('failed'));
          } else {
            setCopyState('ok');
          }
        } catch {
          setCopyState('failed');
        }
      };
      return e('div', { className: 'lsc-root' },
        e('div', { className: 'lsc-diagnostic', role: 'alert' },
          e('div', { className: 'lsc-diagnostic-title' }, t('projects.boundary.title')),
          e('div', { className: 'lsc-diagnostic-hint' }, t('projects.boundary.hint')),
          e('div', { className: 'lsc-diagnostic-row' },
            e('span', { className: 'lsc-diagnostic-label' }, t('projects.boundary.message')),
            e('span', { className: 'lsc-diagnostic-code' }, text(error?.message) || String(error)),
          ),
          e('div', { className: 'lsc-diagnostic-row' },
            e('span', { className: 'lsc-diagnostic-label' }, t('projects.boundary.stack')),
            e('span', { className: 'lsc-diagnostic-code' }, stack === '' ? t('projects.boundary.noStack') : stack),
          ),
          e('div', { className: 'lsc-diagnostic-row' },
            e('span', { className: 'lsc-diagnostic-label' }, t('projects.boundary.step')),
            e('span', { className: 'lsc-diagnostic-code' }, t(step === 'render' ? 'projects.boundary.step.render' : 'projects.boundary.step.mount')),
          ),
          e('div', { className: 'lsc-diagnostic-actions' },
            e('button', { type: 'button', className: 'lsc-btn primary', onClick: onRetry }, t('projects.boundary.retry')),
            e('button', {
              type: 'button',
              className: 'lsc-btn ghost',
              disabled: canCopy !== true,
              title: canCopy === true ? '' : t('projects.boundary.copyUnavailable'),
              onClick: copy,
            }, t('projects.boundary.copy')),
            copyState === 'ok' ? e('span', { className: 'lsc-hint' }, t('projects.boundary.copied')) : null,
            copyState === 'failed' ? e('span', { className: 'lsc-hint' }, t('projects.boundary.copyUnavailable')) : null,
          ),
        ),
      );
    }

    class PanelErrorBoundary extends BaseComponent {
      constructor(props) {
        super(props);
        this.state = { error: null, step: 'mount' };
        this.mounted = false;
        this.handleRetry = this.handleRetry.bind(this);
      }

      static getDerivedStateFromError(error) {
        return { error: error === undefined || error === null ? new Error('render error') : error };
      }

      componentDidMount() { this.mounted = true; }

      componentDidCatch(error) {
        try {
          if (typeof console !== 'undefined' && console !== null && typeof console.error === 'function') {
            console.error('[lifecode-skill-center] panel error', error);
          }
        } catch {
          /* la consola es diagnóstico: si no existe, la tarjeta sigue siendo el diagnóstico */
        }
        this.setState({ step: this.mounted === true ? 'render' : 'mount' });
      }

      handleRetry() {
        this.setState({ error: null, step: this.mounted === true ? 'render' : 'mount' });
      }

      render() {
        if (this.state.error !== null && this.state.error !== undefined) {
          return e(PanelDiagnosticCard, {
            t: this.props.t,
            error: this.state.error,
            step: this.state.step,
            onRetry: this.handleRetry,
          });
        }
        return this.props.children === undefined ? null : this.props.children;
      }
    }

    /* ------------------------------------------------------- avisos y actividad (R17) */

    // Adendum R17-A: aquí NO hay polling ni timers recurrentes. Los únicos `setTimeout` son los
    // de caducidad de cada aviso (uno por aviso, se limpia al cerrarlo). El drawer de actividad
    // sólo pide al abrirse, al pulsar «Actualizar» o «Cargar más».

    const TOAST_MAX_VISIBLE = 3;
    const TOAST_DURATIONS = { success: 6000, info: 6000, warning: 8000 };
    const ACTIVITY_FILTERS = ['all', 'create', 'update', 'improvement', 'references', 'alert'];
    const ACTIVITY_PAGE_SIZE = 20;
    const ACTIVITY_CATEGORIES = ACTIVITY_FILTERS.filter((id) => id !== 'all');
    // Preferencia de interfaz, no dato del centro: recuerda qué eventos ya se vieron en ESTE
    // navegador. Nunca se escribe en center.json ni se envía al Host.
    const ACTIVITY_SEEN_KEY = 'lifecode-skill-center/activity-seen';
    const ACTIVITY_SEEN_MAX = 200;

    function readActivitySeen() {
      const empty = { v: 1, lastSeenAt: '', ids: [] };
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return empty;
        const raw = localStorage.getItem(ACTIVITY_SEEN_KEY);
        if (typeof raw !== 'string' || raw === '') return empty;
        const parsed = JSON.parse(raw);
        if (!isPlainRecord(parsed)) return empty;
        const ids = asArray(parsed.ids).filter((id) => typeof id === 'string' && id !== '').slice(0, ACTIVITY_SEEN_MAX);
        return { v: 1, lastSeenAt: text(parsed.lastSeenAt), ids };
      } catch (failure) {
        // Un JSON corrupto es una preferencia perdida, no un error del panel.
        return empty;
      }
    }

    function writeActivitySeen(value) {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return;
        localStorage.setItem(ACTIVITY_SEEN_KEY, JSON.stringify({
          v: 1,
          lastSeenAt: text(value?.lastSeenAt),
          ids: asArray(value?.ids).filter((id) => typeof id === 'string' && id !== '').slice(0, ACTIVITY_SEEN_MAX),
        }));
      } catch (failure) {
        // Sin almacenamiento local el badge se queda en «punto»: es una preferencia, no un dato.
      }
    }

    function activitySeenWith(previous, ids, lastSeenAt) {
      const next = new Set(asArray(previous?.ids));
      for (const id of asArray(ids)) {
        const value = text(id);
        if (value !== '') next.add(value);
      }
      return { v: 1, lastSeenAt: text(lastSeenAt) || text(previous?.lastSeenAt), ids: Array.from(next).slice(-ACTIVITY_SEEN_MAX) };
    }

    function toastKindOf(tone) {
      if (tone === 'ok' || tone === 'success') return 'success';
      if (tone === 'warn' || tone === 'warning') return 'warning';
      if (tone === 'bad' || tone === 'error') return 'error';
      return 'info';
    }

    function asActivityPayload(value) {
      if (!isPlainRecord(value) || value.ok !== true) return null;
      if (value.apiVersion !== undefined && value.apiVersion !== 1) return null;
      if (!Array.isArray(value.events)) return null;
      if (!value.events.every((event) => isPlainRecord(event))) return null;
      return value;
    }

    function activitySourceUnreadable(payload) {
      return asArray(payload?.sources).some((source) => text(source?.status) === 'unreadable');
    }

    function activityCategoryOf(event) {
      const category = text(event?.category).toLowerCase();
      if (ACTIVITY_CATEGORIES.indexOf(category) !== -1) return category;
      const type = text(event?.type).toLowerCase();
      if (severityKindOf(event) === 'error') return 'alert';
      if (/self[-_ ]?improve|improve/.test(type)) return 'improvement';
      if (/reference|link|attach/.test(type)) return 'references';
      if (/creat|materiali[sz]|import|adopt|register/.test(type)) return 'create';
      return 'update';
    }

    function activityGroupOf(event) {
      return activityCategoryOf(event);
    }

    function severityKindOf(event) {
      const severity = text(event?.severity).toLowerCase();
      if (severity === 'success' || severity === 'info' || severity === 'warning' || severity === 'error') return severity;
      if (text(event?.outcome) === 'failed') return 'error';
      if (event?.humanApprovalRequired === true) return 'warning';
      return 'info';
    }

    function activityGlyph(event) {
      const group = activityCategoryOf(event);
      if (group === 'create') return 'create';
      if (group === 'improvement') return 'spark';
      if (group === 'references') return 'link';
      if (group === 'alert') return 'alert';
      return 'update';
    }

    // El TIPO manda sobre el `titleKey` que traiga el payload: si un backend anterior clasificó
    // mal un evento (p. ej. `skill-imported` como «creada»), la lectura lo corrige sin tocar
    // el almacén ni regenerar ids. Sólo se enumeran las DESVIACIONES del mapa canónico del
    // servidor (`activity.title.<tipo>` es la regla); así no hay dos tablas completas que driften.
    const ACTIVITY_TYPE_TITLE_EXCEPTIONS = {
      'skill.version': 'skill-updated',
      'skill.rollback': 'change-reverted',
      'improvement.proposed': 'improvement-prepared',
      'improvement.approved': 'self-improvement-completed',
      'skill.applied': 'self-improvement-completed',
      'project.registered': 'project-linked',
      'project.linked': 'project-linked',
      'project.adopted': 'project-linked',
      'project.forked': 'project-linked',
      'project.moved': 'change-detected',
      'project.reconciled': 'change-detected',
      'project.relinked': 'change-detected',
      'project.renamed': 'change-detected',
      'project.materialized': 'change-detected',
      'store.backup': 'inspection-finished',
      'store.restored': 'inspection-finished',
      'store.migrated': 'inspection-finished',
    };

    function activityTitleKeyOf(event) {
      const type = text(event?.type);
      if (type === '') return text(event?.titleKey);
      if (type.startsWith('insight-')) return 'activity.title.insight-received';
      const exception = ACTIVITY_TYPE_TITLE_EXCEPTIONS[type];
      if (exception !== undefined) return `activity.title.${exception}`;
      // Las claves i18n usan guiones: `skill.created` → `activity.title.skill-created`.
      return `activity.title.${type.replace(/\./g, '-')}`;
    }

    function activityTitle(t, event) {
      const key = activityTitleKeyOf(event);
      const fallback = t('activity.category.' + activityCategoryOf(event));
      if (key === '') return fallback;
      const source = isPlainRecord(event?.titleVars) ? event.titleVars : {};
      const vars = {};
      for (const name of ['skill', 'project', 'version', 'versionBefore', 'count', 'references', 'origin', 'change', 'renamed']) {
        const value = source[name];
        vars[name] = value === undefined || value === null || value === '' ? t('activity.valueUnknown') : String(value);
      }
      const translated = t(key, vars);
      // Si la clave no existe o el idioma no la trae, se degrada a la categoría: nunca se
      // enseña una clave cruda ni se inventa el dato que faltaba.
      if (translated !== key && translated !== '') return translated;
      // Tipo no mapeado (sin clave derivable): el DTO puede traer la clave del backend, que
      // manda los desconocidos a `change-detected`. Se usa antes de degradar a la categoría.
      const stored = text(event?.titleKey);
      if (stored !== '' && stored !== key) {
        const storedText = t(stored, vars);
        if (storedText !== stored && storedText !== '') return storedText;
      }
      return fallback;
    }

    function activitySkillId(event) {
      return text(event?.skillId);
    }

    function activitySkillLabel(event) {
      const title = text(event?.skillTitle);
      const id = activitySkillId(event);
      return title !== '' ? title : id;
    }

    function activityActionOf(t, event) {
      const skillId = activitySkillId(event);
      const versionBefore = text(event?.versionBefore);
      const versionAfter = text(event?.versionAfter);
      if (skillId !== '') {
        const differs = versionBefore !== '' && versionAfter !== '' && versionBefore !== versionAfter;
        return { kind: 'skill', id: skillId, label: t(differs ? 'activity.action.diff' : 'activity.action.skill') };
      }
      const projectId = text(event?.projectId);
      if (projectId !== '') return { kind: 'project', id: projectId, label: t('activity.action.project') };
      return null;
    }

    function activityOutcomeText(t, event) {
      const outcome = text(event?.outcome).toLowerCase();
      if (event?.humanApprovalRequired === true && outcome !== 'ok') return t('activity.outcome.pending');
      if (outcome === 'failed') return t('activity.outcome.failed');
      if (outcome === 'info') return t('activity.outcome.info');
      return t('activity.outcome.ok');
    }

    function activityRelativeText(t, lang, value, now) {
      const time = Date.parse(text(value));
      if (!Number.isFinite(time)) return t('activity.time.unknown');
      const delta = Math.max(0, (now === undefined ? Date.now() : now) - time);
      const minute = 60 * 1000;
      if (delta < minute) return t('activity.time.now');
      if (delta < 60 * minute) {
        const n = Math.max(1, Math.round(delta / minute));
        return plural(lang, n, t('activity.time.minute.one', { n }), t('activity.time.minute.many', { n }));
      }
      if (delta < 24 * 60 * minute) {
        const n = Math.max(1, Math.round(delta / (60 * minute)));
        return plural(lang, n, t('activity.time.hour.one', { n }), t('activity.time.hour.many', { n }));
      }
      return `${formatDate(value, lang)} · ${formatClock(value, lang)}`;
    }

    function activityBucketOf(entry, now) {
      const time = Date.parse(text(entry?.at));
      if (!Number.isFinite(time)) return 'earlier';
      const stamp = now === undefined ? Date.now() : now;
      if (stamp - time < 60 * 60 * 1000) return 'now';
      const left = new Date(time);
      const right = new Date(stamp);
      if (left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()) return 'today';
      return 'earlier';
    }

    function activityReferenceCounts(event) {
      return {
        added: Array.isArray(event?.referencesAdded) ? event.referencesAdded.length : 0,
        updated: Array.isArray(event?.referencesUpdated) ? event.referencesUpdated.length : 0,
        removed: Array.isArray(event?.referencesRemoved) ? event.referencesRemoved.length : 0,
      };
    }

    function activityReferencesText(t, event) {
      const added = Array.isArray(event?.referencesAdded) ? event.referencesAdded.length : 0;
      const updated = Array.isArray(event?.referencesUpdated) ? event.referencesUpdated.length : 0;
      const removed = Array.isArray(event?.referencesRemoved) ? event.referencesRemoved.length : 0;
      if (added + updated + removed === 0) return '';
      const parts = [];
      if (added !== 0) parts.push(t('activity.refs.added', { n: added }));
      if (updated !== 0) parts.push(t('activity.refs.updated', { n: updated }));
      if (removed !== 0) parts.push(t('activity.refs.removed', { n: removed }));
      return parts.join(' · ');
    }

    function pendingApprovalCount(snapshot) {
      if (!isPlainRecord(snapshot)) return 0;
      const candidates = [snapshot.pending, snapshot.proposals, snapshot.improvements?.pending, snapshot.knowledge?.pending];
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate.length;
        if (Number.isFinite(candidate)) return Number(candidate);
      }
      return 0;
    }

    function mergeActivityEntries(previous, incoming) {
      const seen = new Set();
      const merged = [];
      for (const event of asArray(previous).concat(asArray(incoming))) {
        const id = text(event?.eventId);
        const key = id !== '' ? id : `${text(event?.at)}|${text(event?.type)}|${text(event?.correlationId)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(event);
      }
      return merged;
    }

    function trapDialogFocus(event, container) {
      if (event.key !== 'Tab' || container === null || container === undefined || typeof container.querySelectorAll !== 'function') return;
      const focusables = Array.prototype.slice.call(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((node) => node.disabled !== true && node.getAttribute('tabindex') !== '-1');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }

    // Devuelve el primer nodo conectado y enfocable de la lista. Comprobar la conexión evita
    // enfocar nodos desmontados (el invocador puede desaparecer mientras el cajón está abierto)
    // y permite no depender de `document.activeElement` durante el montaje.
    function focusTargetOf(candidates) {
      for (const candidate of asArray(candidates)) {
        if (candidate === null || candidate === undefined) continue;
        if (candidate.isConnected !== true) continue;
        if (typeof candidate.focus !== 'function') continue;
        return candidate;
      }
      return null;
    }

    // Restaura el foco a un destino válido. Si no hay ninguno no se enfoca nada: nunca se roba
    // el foco a otro elemento de la página por un cierre (Escape, ×, acción del cajón).
    function restoreFocus(candidates) {
      const target = focusTargetOf(candidates);
      if (target === null) return false;
      try {
        target.focus();
        return true;
      } catch (failure) {
        return false;
      }
    }

    // Aviso persistente de una mutación fallida. Un único lugar produce título y detalle para que
    // la ruta genérica (`act`) y la creación directa muestren el mismo mensaje y conserven el
    // código real del Host (R17: el error no caduca; se cierra a mano).
    function activityFailureToast(failure, status, labels = {}) {
      const code = text(failure?.code);
      const message = text(failure?.message);
      const codeLabel = text(labels.code) || 'code';
      const failedLabel = text(labels.failed) || 'failed';
      const blockedLabel = text(labels.blocked) || 'blocked';
      const findingText = asArray(failure?.findings).slice(0, 3)
        .map((item) => (isPlainRecord(item) ? [text(item.code), text(item.message)].filter((part) => part !== '').join(': ') : text(item)))
        .filter((part) => part !== '').join(' · ');
      const reasonText = asArray(failure?.reasons).slice(0, 3).map((item) => text(item)).filter((part) => part !== '').join(' · ');
      const detail = [
        `${codeLabel}: ${code !== '' ? code : String(status)}`,
        findingText,
        reasonText,
      ].filter((part) => part !== '').join(' · ');
      return {
        title: message !== '' ? message : failedLabel,
        detail: `${blockedLabel} · ${detail}`,
      };
    }

    function ActivityGlyph({ name, size = 16, className = '' }) {
      const paths = {
        create: 'M12 5v14M5 12h14',
        update: 'M4 12a8 8 0 0 1 13.7-5.7M20 12a8 8 0 0 1-13.7 5.7M17 3v4h-4M7 21v-4h4',
        spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
        link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
        alert: 'M12 3 2 21h20L12 3zM12 9v5M12 17h.01',
        success: 'M20 6 9 17l-5-5',
        info: 'M12 8h.01M11 12h1v6',
        warning: 'M12 3 2 21h20L12 3zM12 9v5M12 17h.01',
        error: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6',
        activity: 'M3 12h4l2 6 4-14 2 8h6',
      };
      return e('svg', {
        className: cx('lsc-toast-icon', className),
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        'aria-hidden': 'true',
        focusable: 'false',
      }, e('path', {
        d: paths[name] ?? paths.info,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }));
    }

    function ToastCard({ t, toast, onClose, onAction, newest, showActions }) {
      const count = Number.isFinite(toast.count) ? toast.count : 1;
      const meta = [text(toast?.skill?.title) || text(toast?.skillTitle), text(toast?.project?.name) || text(toast?.projectId)]
        .filter((part) => part !== '').join(' · ');
      const refs = isPlainRecord(toast?.references) ? (() => {
        const added = Number.isFinite(toast.references.added) ? toast.references.added : 0;
        const updated = Number.isFinite(toast.references.updated) ? toast.references.updated : 0;
        const removed = Number.isFinite(toast.references.removed) ? toast.references.removed : 0;
        const parts = [];
        if (added !== 0) parts.push(t('activity.refs.added', { n: added }));
        if (updated !== 0) parts.push(t('activity.refs.updated', { n: updated }));
        if (removed !== 0) parts.push(t('activity.refs.removed', { n: removed }));
        return parts.join(' · ');
      })() : activityReferencesText(t, toast?.event);
      const isError = toast.kind === 'error';
      return e('div', {
        className: cx('lsc-toast-card', toast.kind),
        role: isError ? 'alert' : 'status',
        'aria-atomic': 'true',
        'data-newest': newest === true ? 'true' : undefined,
      },
        e(ActivityGlyph, { name: toast.kind, size: 18 }),
        e('div', { className: 'lsc-toast-body' },
          e('div', { className: 'lsc-toast-title' },
            e('span', null, toast.title),
            count > 1 ? e('span', { className: 'lsc-toast-count' }, `×${count}`) : null,
          ),
          meta !== '' ? e('div', { className: 'lsc-toast-meta' }, meta) : null,
          text(toast.detail) !== '' ? e('div', { className: 'lsc-toast-detail' }, toast.detail) : null,
          refs !== '' ? e('div', { className: 'lsc-toast-meta' }, refs) : null,
          toast.action !== null && toast.action !== undefined && showActions !== false
            ? e('div', { className: 'lsc-toast-actions' },
              e('button', {
                type: 'button',
                className: 'lsc-btn small',
                onClick: () => onAction(toast.action),
              }, toast.action.label),
            )
            : null,
        ),
        e('button', {
          type: 'button',
          className: 'lsc-toast-close',
          title: t('toast.close'),
          'aria-label': t('toast.close'),
          onClick: () => onClose(toast.id),
        }, '×'),
      );
    }

    function ToastStack({ t, toasts, onClose, onAction, showActions }) {
      const items = asArray(toasts);
      const onKeyDown = useCallback((event) => {
        if (event.key !== 'Escape' || items.length === 0) return;
        event.preventDefault();
        onClose(items[0].id);
      }, [items, onClose]);
      useEffect(() => {
        if (items.length === 0 || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined;
        document.addEventListener('keydown', onKeyDown);
        return () => { document.removeEventListener('keydown', onKeyDown); };
      }, [items.length, onKeyDown]);
      if (items.length === 0) return null;
      return e('div', {
        className: 'lsc-toast-stack',
        'aria-live': 'polite',
        'aria-relevant': 'additions text',
      }, items.map((item, index) => e(ToastCard, {
        key: item.id,
        t,
        toast: item,
        newest: index === 0,
        onClose,
        onAction,
        showActions,
      })));
    }

    /* ------------------------------------------------- avisos globales (R17.1) */
    // Una única pila para todo el cliente. El panel escribe aquí (`notify`, acciones) y el Slot
    // global `shell.overlay` la pinta encima de la conversación. Cuando ese Slot no existe (hosts sin
    // overlay o arneses de prueba) el panel pinta un fallback enganchado al mismo store.

    const TOAST_STORE_MAX = 3;
    const SESSION_ACTIONS_SLOT = 'conversation.session.header.actions';
    const OVERLAY_SLOT = 'shell.overlay';
    const SEEN_SESSION_MAX = 200;

    // Traducción viva para los avisos que nacen fuera del panel (stream de sesión).
    let toastTranslate = (key, vars) => translate('es', key, vars);

    function createToastStore() {
      let items = [];
      let lastActivity = '';
      let lastEventId = '';
      let sequence = 0;
      const listeners = new Set();
      const timers = new Map();

      const snapshot = () => ({ items, lastActivity, lastEventId });
      const emit = () => {
        const value = snapshot();
        for (const listener of Array.from(listeners)) {
          try { listener(value); } catch (failure) { /* un oyente roto no puede tumbar la pila */ }
        }
      };
      const clearTimer = (id) => {
        const timer = timers.get(id);
        if (timer !== undefined) { clearTimeout(timer); timers.delete(id); }
      };
      const schedule = (item) => {
        if (item.persistent === true || timers.has(item.id)) return;
        if (typeof setTimeout !== 'function') return;
        const duration = Number.isFinite(item.duration) && item.duration > 0
          ? item.duration
          : (TOAST_DURATIONS[item.kind] ?? 6000);
        timers.set(item.id, setTimeout(() => dismiss(item.id), duration));
      };
      function dismiss(id) {
        const next = items.filter((item) => item.id !== id);
        clearTimer(id);
        if (next.length === items.length) return;
        items = next;
        emit();
      }
      function push(entry) {
        const source = isPlainRecord(entry) ? entry : {};
        const kind = ['success', 'info', 'warning', 'error'].includes(source.kind) ? source.kind : 'info';
        const eventId = text(source.eventId) || text(source.event?.eventId);
        if (eventId !== '') {
          const existing = items.find((item) => item.eventId === eventId);
          if (existing !== undefined) return existing.id;
        }
        const built = {
          id: `lsc-toast-${sequence += 1}`,
          kind,
          title: text(source.title),
          detail: text(source.detail),
          skill: isPlainRecord(source.skill) ? source.skill : null,
          project: isPlainRecord(source.project) ? source.project : null,
          skillTitle: text(source.skillTitle),
          projectId: text(source.projectId),
          event: isPlainRecord(source.event) ? source.event : null,
          eventId,
          correlationId: text(source.correlationId),
          count: Number.isFinite(source.count) && source.count > 1 ? source.count : 1,
          references: isPlainRecord(source.references)
            ? source.references
            : (isPlainRecord(source.event) ? activityReferenceCounts(source.event) : null),
          action: isPlainRecord(source.action) ? source.action : null,
          at: text(source.at),
          duration: Number.isFinite(source.duration) ? source.duration : 0,
          persistent: kind === 'error' || source.persistent === true,
        };
        let next;
        if (built.correlationId !== '') {
          const existing = items.find((item) => item.correlationId === built.correlationId);
          if (existing !== undefined) {
            const merged = {
              ...existing,
              id: existing.id,
              kind: built.kind === 'error' ? 'error' : existing.kind,
              title: built.title !== '' ? built.title : existing.title,
              detail: built.detail !== '' ? built.detail : existing.detail,
              skill: built.skill ?? existing.skill,
              project: built.project ?? existing.project,
              count: existing.count + built.count,
              references: {
                added: (existing.references?.added ?? 0) + (built.references?.added ?? 0),
                updated: (existing.references?.updated ?? 0) + (built.references?.updated ?? 0),
                removed: (existing.references?.removed ?? 0) + (built.references?.removed ?? 0),
              },
              action: built.action ?? existing.action,
              at: built.at !== '' ? built.at : existing.at,
              persistent: existing.persistent || built.persistent,
            };
            next = [merged, ...items.filter((item) => item.id !== existing.id)];
          }
        }
        if (next === undefined) next = [built, ...items];
        next = next.slice(0, TOAST_STORE_MAX);
        const kept = new Set(next.map((item) => item.id));
        for (const id of Array.from(timers.keys())) { if (!kept.has(id)) clearTimer(id); }
        items = next;
        schedule(built);
        emit();
        return built.id;
      }
      // Un evento del stream de sesión: misma pila, misma traducción y misma marca de leído.
      function pushActivity(activity, replayed) {
        if (!isPlainRecord(activity) || activity.persisted !== true) return '';
        if (replayed === true) return '';
        const at = text(activity.at) || new Date().toISOString();
        const eventId = text(activity.eventId);
        lastActivity = at;
        if (eventId !== '') lastEventId = eventId;
        const t = (key, vars) => toastTranslate(key, vars);
        const id = push({
          kind: severityKindOf(activity),
          title: activityTitle(t, activity),
          skill: activitySkillId(activity) === '' ? null : { id: activitySkillId(activity), title: activitySkillLabel(activity) },
          project: text(activity.projectId) === '' ? null : { id: text(activity.projectId), name: '' },
          correlationId: text(activity.correlationId),
          action: activityActionOf(t, activity),
          at,
          event: activity,
          eventId,
        });
        if (eventId !== '' && id !== '') {
          try {
            const next = activitySeenWith(readActivitySeen(), [eventId], at);
            writeActivitySeen(next);
          } catch (failure) { /* la marca de leído nunca puede impedir el aviso */ }
        }
        return id;
      }
      function noteActivity(at, eventId) {
        const stamp = text(at);
        if (stamp === '') return;
        lastActivity = stamp;
        if (text(eventId) !== '') lastEventId = text(eventId);
        emit();
      }
      function subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      }
      function dispose() {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
        listeners.clear();
        items = [];
        lastActivity = '';
        lastEventId = '';
      }
      return {
        push,
        pushActivity,
        noteActivity,
        dismiss,
        subscribe,
        getSnapshot: snapshot,
        dispose,
      };
    }

    const toastStore = createToastStore();

    // Presencia del overlay y puente hacia la navegación del panel: el aviso global puede ofrecer
    // «Ver Skill» sólo si hay un panel montado que sepa abrir la ficha.
    function createFlagStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => value,
        set(next) {
          if (value === next) return;
          value = next;
          for (const listener of Array.from(listeners)) { try { listener(value); } catch (failure) {} }
        },
        subscribe(listener) {
          if (typeof listener !== 'function') return () => {};
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        dispose() { listeners.clear(); },
      };
    }

    const toastOverlayPresence = createFlagStore(false);
    const toastActionBridge = {
      handler: null,
      listeners: new Set(),
      available() { return this.handler !== null; },
      set(handler) {
        const next = typeof handler === 'function' ? handler : null;
        if (this.handler === next) return;
        this.handler = next;
        for (const listener of Array.from(this.listeners)) { try { listener(next !== null); } catch (failure) {} }
      },
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
      },
      run(action) {
        if (this.handler === null) return false;
        try { this.handler(action); return true; } catch (failure) { return false; }
      },
      dispose() { this.handler = null; this.listeners.clear(); },
    };

    function ToastOverlayHost({ t }) {
      const tr = typeof t === 'function' ? t : (key, vars) => translate('es', key, vars);
      const [snapshot, setSnapshot] = useState(() => toastStore.getSnapshot());
      useEffect(() => {
        toastTranslate = tr;
        toastOverlayPresence.set(true);
        const unsubscribeStore = toastStore.subscribe(setSnapshot);
        return () => {
          toastOverlayPresence.set(false);
          unsubscribeStore();
        };
      }, []);
      const items = asArray(snapshot?.items);
      if (items.length === 0) return null;
      return e('div', { className: 'lsc-toast-overlay' },
        e(ToastStack, {
          t: tr,
          toasts: items,
          showActions: true,
          onClose: (id) => toastStore.dismiss(id),
          onAction: (action) => toastActionBridge.run(action),
        }));
    }

    // Puente del stream: guarda toolCallId→nombre de `lifecode_*` y, en `tool/result`, lee la
    // `activity` que el tool ya publicó. Suscribirse al `eventSource` no abre fuente ni pide datos.
    function createSessionActivityBridge(ctx) {
      let sessionId = '';
      let source = null;
      let unsubscribe = null;
      let revision = -1;
      const calls = new Map();
      const seen = new Set();

      const stop = () => {
        if (unsubscribe !== null) {
          try { unsubscribe(); } catch (failure) { /* el Host ya puede haber cerrado la ventana */ }
          unsubscribe = null;
        }
        source = null;
        sessionId = '';
        revision = -1;
        calls.clear();
      };
      const markSeen = (eventId) => {
        if (eventId === '') return true;
        if (seen.has(eventId)) return false;
        seen.add(eventId);
        if (seen.size > SEEN_SESSION_MAX) {
          const oldest = seen.values().next().value;
          if (oldest !== undefined) seen.delete(oldest);
        }
        return true;
      };
      const activityFromData = (data) => {
        if (!isPlainRecord(data)) return null;
        if (isPlainRecord(data.meta?.activity)) return data.meta.activity;
        if (isPlainRecord(data.activity)) return data.activity;
        if (isPlainRecord(data.result?.activity)) return data.result.activity;
        if (isPlainRecord(data.message?.activity)) return data.message.activity;
        const message = isPlainRecord(data.message) ? data.message : null;
        for (const block of asArray(message?.content)) {
          if (!isPlainRecord(block) || block.type !== 'text' || typeof block.text !== 'string') continue;
          let parsed = null;
          try { parsed = JSON.parse(block.text); } catch (failure) { continue; }
          if (!isPlainRecord(parsed)) continue;
          if (isPlainRecord(parsed.activity)) return parsed.activity;
          if (typeof parsed.eventId === 'string' && typeof parsed.persisted === 'boolean') return parsed;
        }
        return null;
      };
      const ingest = (event) => {
        if (!isPlainRecord(event)) return;
        const data = event.data;
        if (event.type === 'tool/call') {
          if (!isPlainRecord(data)) return;
          const callId = text(data.callId);
          const name = text(data.name);
          if (callId === '') return;
          if (name.startsWith('lifecode_')) calls.set(callId, name);
          else calls.delete(callId);
          return;
        }
        if (event.type !== 'tool/result') return;
        const message = isPlainRecord(data?.message) ? data.message : null;
        const callId = text(message?.toolCallId) || text(message?.source?.callId) || text(data?.callId);
        if (callId === '' || !calls.has(callId)) return;
        calls.delete(callId);
        const activity = activityFromData(data);
        if (activity === null) return;
        if (!markSeen(text(activity.eventId))) return;
        toastStore.pushActivity(activity, activity.replayed === true || data?.replayed === true);
      };
      const connect = (nextId) => {
        if (typeof nextId !== 'string' || nextId === '') { stop(); return; }
        if (nextId === sessionId && unsubscribe !== null) return;
        stop();
        let sessions = null;
        try { sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : null; } catch (failure) { sessions = null; }
        const binding = sessions !== null && typeof sessions.binding === 'function' ? sessions.binding(nextId) : null;
        const eventSource = binding?.eventSource ?? null;
        if (eventSource === null || typeof eventSource.subscribe !== 'function') return;
        sessionId = nextId;
        source = eventSource;
        try {
          const initial = typeof eventSource.getSnapshot === 'function' ? eventSource.getSnapshot() : null;
          revision = Number.isFinite(initial?.revision) ? initial.revision : -1;
        } catch (failure) { revision = -1; }
        try {
          unsubscribe = eventSource.subscribe(() => {
            if (source === null) return;
            let window = null;
            try { window = typeof source.getSnapshot === 'function' ? source.getSnapshot() : null; } catch (failure) { window = null; }
            if (!isPlainRecord(window)) return;
            const nextRevision = Number.isFinite(window.revision) ? window.revision : revision;
            if (nextRevision === revision) return;
            const sequential = nextRevision === revision + 1;
            revision = nextRevision;
            if (!sequential || !isPlainRecord(window.change) || window.change.kind !== 'append') return;
            for (const entry of asArray(window.change.entries)) {
              if (!isPlainRecord(entry)) continue;
              if (entry.type === 'event') ingest(entry.event);
              else ingest(entry);
            }
          });
        } catch (failure) {
          unsubscribe = null;
          source = null;
          sessionId = '';
        }
      };
      return { connect, stop, dispose: stop };
    }

    // El probe no pinta nada: recibe el `sessionId` del slot de la conversación y lo reporta.
    function SessionToastProbe({ sessionId, onSession }) {
      const next = text(sessionId);
      useEffect(() => {
        if (typeof onSession === 'function') onSession(next);
      }, [next, onSession]);
      return null;
    }

    function ActivityIndicator({ t, lang, apiAvailable, busy, actionPending, pendingCount, lastActivity, unreadCount, hasUnread, onOpen, triggerRef }) {
      const mode = busy === true ? 'working'
        : actionPending === true ? 'saving'
          : pendingCount > 0 ? 'pending'
            : lastActivity !== '' ? 'last'
              : 'connected';
      const apiKnown = apiAvailable === true || apiAvailable === false;
      const dotTone = mode === 'working' ? 'work'
        : mode === 'saving' || mode === 'pending' ? 'warn'
          : apiAvailable === false ? 'bad'
            : mode === 'connected' || mode === 'last' ? (apiAvailable === true ? 'ok' : 'warn')
              : 'bad';
      let textValue = t('activity.indicator.connected');
      if (mode === 'working') textValue = t('activity.indicator.working');
      else if (mode === 'saving') textValue = t('activity.indicator.saving');
      else if (mode === 'pending') textValue = t('activity.indicator.pending', { n: pendingCount });
      else if (mode === 'last') textValue = t('activity.indicator.last', { time: activityRelativeText(t, lang, lastActivity) });
      // La disponibilidad del centro se deriva de la última lectura real de la API, no del contrato:
      // un backend heredado sigue siendo un centro disponible. Sólo la falta de evidencia es «unknown».
      if (!apiKnown && mode !== 'working' && mode !== 'saving' && mode !== 'pending') textValue = t('activity.indicator.unknown');
      if (apiAvailable === false && mode !== 'working' && mode !== 'saving' && mode !== 'pending') textValue = t('activity.disconnected');
      const unread = Number.isFinite(unreadCount) && unreadCount > 0 ? unreadCount : 0;
      const showDot = unread === 0 && hasUnread === true;
      return e('div', { className: 'lsc-activity-cluster' },
        e('span', { className: 'lsc-activity-indicator', role: 'status', 'aria-live': 'polite' },
          e('span', { className: cx('lsc-activity-dot', dotTone), 'aria-hidden': 'true' }),
          e('span', null, textValue),
        ),
        e('button', {
          type: 'button',
          ref: triggerRef === undefined ? null : triggerRef,
          className: 'lsc-btn ghost lsc-activity-button',
          title: t('activity.button.title'),
          'aria-label': unread > 0 ? t('activity.button.unread', { n: unread }) : (showDot ? t('activity.button.unread.dot') : t('activity.button.title')),
          onClick: onOpen,
        },
          e(ActivityGlyph, { name: 'activity', size: 16 }),
          unread > 0
            ? e('span', { className: 'lsc-activity-badge' }, String(unread))
            : (showDot ? e('span', { className: 'lsc-activity-badge dot', 'aria-hidden': 'true' }) : null),
        ),
      );
    }

    function ActivityRow({ t, lang, event, expanded, onToggle, onAction }) {
      const title = activityTitle(t, event);
      const skillName = activitySkillLabel(event);
      const projectName = text(event?.projectId);
      const meta = [skillName, projectName, activityRelativeText(t, lang, event?.at)].filter((part) => part !== '').join(' · ');
      const version = text(event?.versionBefore) !== '' || text(event?.versionAfter) !== ''
        ? `${text(event.versionBefore) || t('activity.valueUnknown')} → ${text(event.versionAfter) || t('activity.valueUnknown')}`
        : '';
      const refs = activityReferencesText(t, event);
      const action = activityActionOf(t, event);
      const evidence = isPlainRecord(event?.actorEvidence)
        ? [text(event.actorEvidence.channel), text(event.actorEvidence.stored)].filter((part) => part !== '').join(' · ')
        : text(event?.actorEvidence);
      return e('div', { className: 'lsc-activity-row' },
        e('button', {
          type: 'button',
          className: 'lsc-activity-row-main',
          'aria-expanded': expanded === true ? 'true' : 'false',
          onClick: onToggle,
        },
          e(ActivityGlyph, { name: activityGlyph(event), size: 16 }),
          e('span', { style: { minWidth: 0 } },
            e('span', { className: 'lsc-activity-row-title' }, title),
            meta !== '' ? e('span', { className: 'lsc-activity-row-meta', style: { display: 'block' } }, meta) : null,
          ),
        ),
        action === null ? null : e('div', { className: 'lsc-activity-evidence' },
          e('button', { type: 'button', className: 'lsc-btn small', onClick: () => onAction(action) }, action.label),
        ),
        expanded === true
          ? e('div', { className: 'lsc-activity-evidence' },
            e('div', { className: 'lsc-activity-kv' }, e('span', null, t('activity.row.result')), e('span', null, activityOutcomeText(t, event))),
            version !== '' ? e('div', { className: 'lsc-activity-kv' }, e('span', null, t('activity.row.version')), e('span', null, version)) : null,
            refs !== '' ? e('div', { className: 'lsc-activity-kv' }, e('span', null, t('activity.row.references')), e('span', null, refs)) : null,
            text(event?.actor) !== '' ? e('div', { className: 'lsc-activity-kv' }, e('span', null, t('activity.row.actor')), e('span', null, text(event.actor))) : null,
            text(event?.origin) !== '' ? e('div', { className: 'lsc-activity-kv' }, e('span', null, t('activity.row.origin')), e('span', null, text(event.origin))) : null,
            text(event?.source) !== '' ? e('div', { className: 'lsc-activity-kv' }, e('span', null, t('activity.row.source')), e('span', null, text(event.source))) : null,
            text(event?.confidence) !== '' ? e('div', { className: 'lsc-activity-kv' }, e('span', null, t('activity.row.confidence')), e('span', null, text(event.confidence))) : null,
            evidence !== '' ? e('div', { className: 'lsc-activity-kv' }, e('span', null, t('activity.row.actorEvidence')), e('span', null, evidence)) : null,
            text(event?.correlationId) !== '' ? e('div', { className: 'lsc-activity-kv' }, e('span', null, t('activity.row.correlation')), e('span', null, text(event.correlationId))) : null,
            event?.persisted === false ? e('div', { className: 'lsc-activity-kv' }, e('span', null, t('activity.row.code')), e('span', null, t('activity.notPersisted'))) : null,
          )
          : null,
      );
    }

    function ActivityDrawer({ t, lang, apiAvailable, onClose, onAction, returnFocusRef, fallbackFocusRef }) {
      const drawerRef = useRef(null);
      const closeRef = useRef(null);
      // El cierre se lee por referencia: el efecto de foco no depende de la identidad de `onClose`
      // (el panel la recrea en cada render) y aun así Escape usa siempre la última versión.
      const onCloseRef = useRef(onClose);
      onCloseRef.current = onClose;
      const requestRef = useRef(0);
      const [status, setStatus] = useState('loading');
      const [events, setEvents] = useState([]);
      const [page, setPage] = useState({ nextBefore: '', complete: false });
      const [error, setError] = useState('');
      const [partial, setPartial] = useState(false);
      // Estado real de cada fuente tal como lo publica la respuesta; null = aún sin respuesta.
      // La etiqueta de conexión se deriva de aquí, nunca del contrato del cliente.
      const [sources, setSources] = useState(null);
      const [filter, setFilter] = useState('all');
      const [expanded, setExpanded] = useState('');

      const loadActivity = useCallback(async (options = {}) => {
        const before = options.before === undefined ? '' : text(options.before);
        requestRef.current += 1;
        const requestId = requestRef.current;
        setStatus(events.length === 0 ? 'loading' : 'refreshing');
        setError('');
        try {
          const params = new URLSearchParams();
          params.set('limit', String(ACTIVITY_PAGE_SIZE));
          if (before !== '') params.set('before', before);
          const response = await fetch(`${API}/activity?${params.toString()}`, { headers: { accept: 'application/json' } });
          const parsed = await readJson(response);
          if (!parsed.ok) throw new Error(parsed.message || `HTTP ${response.status}`);
          const payload = asActivityPayload(parsed.data);
          if (payload === null) throw new Error(t('activity.error.invalid'));
          if (requestRef.current !== requestId) return;
          setEvents((previous) => (before === '' ? payload.events : mergeActivityEntries(previous, payload.events)));
          setPage({ nextBefore: text(payload.nextBefore), complete: payload.complete === true || text(payload.nextBefore) === '' });
          setPartial(activitySourceUnreadable(payload));
          setSources(asArray(payload.sources));
        } catch (failure) {
          if (requestRef.current !== requestId) return;
          setError(String(failure?.message ?? failure));
        } finally {
          if (requestRef.current === requestId) setStatus('idle');
        }
      }, [events.length, t]);

      useEffect(() => {
        if (closeRef.current !== null && typeof closeRef.current.focus === 'function') closeRef.current.focus();
        const onKeyDown = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
          trapDialogFocus(event, drawerRef.current);
        };
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('keydown', onKeyDown);
        return () => {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('keydown', onKeyDown);
          // Destinos explícitos: el invocador y, si ya no existe, el contenedor del panel. Sin
          // destino válido no se toca el foco (nunca `document.activeElement`, que puede ser BODY
          // o un nodo interno del propio cajón).
          restoreFocus([
            returnFocusRef === undefined || returnFocusRef === null ? null : returnFocusRef.current,
            fallbackFocusRef === undefined || fallbackFocusRef === null ? null : fallbackFocusRef.current,
          ]);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // Una sola consulta al montar (el drawer sólo existe cuando está abierto): sin polling.
      useEffect(() => {
        loadActivity();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      const now = Date.now();
      const visible = asArray(events).filter((event) => filter === 'all' || activityGroupOf(event) === filter);
      // Tres hechos distintos, nunca mezclados: la API respondió y sus fuentes están bien; respondió
      // con alguna fuente no legible; o no hay respuesta. El canal externo es una capacidad aparte.
      const connection = (() => {
        if (error !== '' && events.length === 0) return { tone: 'bad', text: t('activity.disconnected') };
        const list = asArray(sources);
        if (list.length === 0) return { tone: 'warn', text: t('activity.indicator.unknown') };
        const unreadable = list.filter((source) => text(source?.status) !== 'ok');
        if (unreadable.length === 0) return { tone: 'ok', text: t('activity.connected') };
        return {
          tone: 'warn',
          text: t('activity.connected.partial', { sources: unreadable.map((source) => text(source?.id) || '?').join(', ') }),
        };
      })();
      const groups = [
        { id: 'now', title: t('activity.group.now'), rows: visible.filter((event) => activityBucketOf(event, now) === 'now') },
        { id: 'today', title: t('activity.group.today'), rows: visible.filter((event) => activityBucketOf(event, now) === 'today') },
        { id: 'earlier', title: t('activity.group.earlier'), rows: visible.filter((event) => activityBucketOf(event, now) === 'earlier') },
      ].filter((group) => group.rows.length > 0);

      const body = [];
      if (status === 'loading') body.push(e('div', { className: 'lsc-empty', key: 'loading' }, t('activity.loading')));
      if (partial === true && status !== 'loading') {
        body.push(e('div', { className: 'lsc-notice', role: 'status', key: 'partial' }, t('activity.partial', { sources: t('activity.partial.sources') })));
      }
      if (error !== '') {
        body.push(e('div', { className: 'lsc-notice bad', role: 'alert', key: 'error' },
          e('span', null, t('activity.error', { message: error })),
          e('button', { type: 'button', className: 'lsc-btn small', onClick: () => loadActivity() }, t('activity.retry')),
        ));
      }
      if (status !== 'loading' && error === '' && visible.length === 0) {
        body.push(e('div', { className: 'lsc-empty', key: 'empty' }, t(filter === 'all' ? 'activityFeed.empty' : 'activity.filter.empty')));
      }
      for (const group of groups) {
        body.push(e('div', { className: 'lsc-activity-group-title', key: `g-${group.id}` }, group.title));
        for (const event of group.rows) {
          const id = text(event.eventId);
          body.push(e(ActivityRow, {
            key: `row-${id || `${group.id}-${text(event.at)}-${text(event.type)}`}`,
            t,
            lang,
            event,
            expanded: expanded !== '' && expanded === id,
            onToggle: () => setExpanded((previous) => (previous === id ? '' : id)),
            onAction,
          }));
        }
      }
      if (status !== 'loading' && error === '' && page.complete === false && page.nextBefore !== '') {
        body.push(e('button', {
          key: 'more',
          type: 'button',
          className: 'lsc-btn',
          style: { marginTop: '8px' },
          disabled: status === 'refreshing',
          onClick: () => loadActivity({ before: page.nextBefore }),
        }, t('activity.loadMore')));
      }

      return e('div', { className: 'lsc-activity-drawer-wrap' },
        e('aside', {
          className: 'lsc-activity-drawer',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('activityFeed.title'),
          ref: drawerRef,
        },
          e('div', { className: 'lsc-activity-head' },
            e('div', { style: { flex: 1, minWidth: 0 } },
              e('h2', { className: 'lsc-activity-title' }, t('activityFeed.title')),
              e('div', { className: 'lsc-activity-sub' }, t('activity.subtitle')),
            ),
            e('button', {
              type: 'button',
              className: 'lsc-btn ghost small',
              ref: closeRef,
              title: t('activity.close'),
              'aria-label': t('activity.close'),
              onClick: onClose,
            }, '×'),
          ),
          e('div', { className: 'lsc-activity-toolbar' },
            e('button', {
              type: 'button',
              className: 'lsc-btn small',
              disabled: status === 'loading' || status === 'refreshing',
              onClick: () => loadActivity(),
            }, status === 'refreshing' ? t('activity.refreshing') : t('activity.refresh')),
            e('span', { className: cx('lsc-hint', `lsc-activity-connection ${connection.tone}`), style: { alignSelf: 'center' } },
              connection.text,
            ),
          ),
          e('p', { className: 'lsc-hint lsc-activity-channel', style: { margin: '6px 12px 0' } }, t('activity.channel.unavailable')),
          e('div', { className: 'lsc-activity-filters', role: 'group', 'aria-label': t('activity.filters') },
            ACTIVITY_FILTERS.map((id) => e('button', {
              key: id,
              type: 'button',
              className: 'lsc-activity-filter',
              'aria-pressed': filter === id ? 'true' : 'false',
              onClick: () => setFilter(id),
            }, t(`activity.filter.${id}`))),
          ),
          e('div', { className: 'lsc-activity-list' }, body),
          e('p', { className: 'lsc-hint', style: { margin: '8px 12px 0' } }, t('activity.seen.scope')),
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

      function Panel() {
        const lang = useLanguage();
        const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);
        // Servicio opcional y protegido: en producción leer `ctx.uiWorkspace` sin `inject` lanza y
        // dejaba el panel en blanco (el slot desactiva el ocupante que falla). Ver `uiWorkspaceService`.
        const uiWorkspace = uiWorkspaceService(ctx);

        const [view, setView] = useState('overview');
        const [cwd, setCwd] = useState('');
        const [snapshot, setSnapshot] = useState(null);
        const [error, setError] = useState('');
        const [busy, setBusy] = useState(false);
        const [drawerId, setDrawerId] = useState(null);
        const [modalOpen, setModalOpen] = useState(false);
        const [actionPending, setActionPending] = useState('');
        const [detectText, setDetectText] = useState('');
        const [detectResult, setDetectResult] = useState(null);
        const [askText, setAskText] = useState('');
        // Migración del esquema: el diálogo se abre a mano, la operación se confirma a mano y el estado
        // de «en curso» no es la barrera contra duplicados (el servidor revalida y la segunda llamada
        // responde `already-migrated`); sólo evita un doble clic accidental.
        const [migrateOpen, setMigrateOpen] = useState(false);
      const [doctor, setDoctor] = useState(null);
      const [doctorError, setDoctorError] = useState('');
      const [doctorBusy, setDoctorBusy] = useState(false);
      const [identityBusy, setIdentityBusy] = useState("");
      const [identityConfirm, setIdentityConfirm] = useState(null);
      const loadDoctor = useCallback(() => {
        setDoctorBusy(true);
        setDoctorError('');
        fetch(`${API}/doctor`, { headers: { accept: 'application/json' } })
          .then((response) => readJson(response))
          .then((parsed) => {
            if (parsed.ok !== true || parsed.data?.ok === undefined) {
              setDoctorError(parsed.data?.message ?? parsed.message);
              setDoctor(null);
              return;
            }
            setDoctor(parsed.data);
          })
          .catch((failure) => { setDoctorError(String(failure?.message ?? failure)); setDoctor(null); })
          .finally(() => setDoctorBusy(false));
      }, []);
        const [migrateBusy, setMigrateBusy] = useState(false);
        const [migrateResult, setMigrateResult] = useState(null);
        // Inventario de workspaces: se pide aparte porque necesita el servicio del Host y no forma parte
        // del documento del centro. null = aún no se ha pedido; error visible cuando el Host no lo da.
        const [workspaces, setWorkspaces] = useState(null);
        const [workspacesError, setWorkspacesError] = useState('');
        const [workspacesBusy, setWorkspacesBusy] = useState(false);
        // Inventario nuevo del contrato R16: `/api/projects` + `/api/inventory`. Se guardan por separado
        // del snapshot para no mezclar el documento del centro con el catálogo de skills del Host.
        const [projectsData, setProjectsData] = useState(null);
        const [inventoryData, setInventoryData] = useState(null);
        const [legacyProjects, setLegacyProjects] = useState(null);
        const [projectsBusy, setProjectsBusy] = useState(false);
        const [projectsReport, setProjectsReport] = useState(null);
        // Handshake de compatibilidad: decide el modo con `GET /api/capabilities`, nunca con un 404 suelto.
        const [compat, setCompat] = useState(null);
        const [projectDetail, setProjectDetail] = useState(null);
        const [projectDialog, setProjectDialog] = useState(null);
        // Ficha de skill: modal de nivel de panel, resuelta contra el inventario global ya cargado.
        const [skillDetailKey, setSkillDetailKey] = useState('');
        const projectsBusyRef = useRef(false);
        const projectsRef = useRef({ projectsData: null, inventoryData: null });
        // R17.1: la pila de avisos vive en un store de módulo compartido con el overlay global.
        // El panel sólo la pinta como fallback cuando el Host no ofrece `shell.overlay`.
        const [toastSnapshot, setToastSnapshot] = useState(() => toastStore.getSnapshot());
        const [overlayMounted, setOverlayMounted] = useState(() => toastOverlayPresence.getSnapshot());
        const [activityOpen, setActivityOpen] = useState(false);
        const [activitySeen, setActivitySeen] = useState(() => readActivitySeen());
        const activityOpenRef = useRef(false);
        activityOpenRef.current = activityOpen;
        // Destinos reales de foco al cerrar el cajón: el botón que lo abrió y la raíz del panel
        // (respaldo cuando ese botón ya no está montado). No se consulta `document.activeElement`.
        const activityTriggerRef = useRef(null);
        const activityRootRef = useRef(null);
        const activitySeenRef = useRef(activitySeen);
        activitySeenRef.current = activitySeen;
        const cwdRef = useRef('');
        cwdRef.current = cwd;
        const toasts = toastSnapshot.items;
        const lastActivity = toastSnapshot.lastActivity;

        useEffect(() => {
          const unsubscribeStore = toastStore.subscribe((next) => {
            setToastSnapshot(next);
            // Otro emisor (el stream de sesión) pudo sellar la marca de leído: el panel la relee.
            setActivitySeen(readActivitySeen());
          });
          const unsubscribeOverlay = toastOverlayPresence.subscribe(setOverlayMounted);
          return () => { unsubscribeStore(); unsubscribeOverlay(); };
        }, []);

        const dismissToast = useCallback((id) => { toastStore.dismiss(id); }, []);
        const pushToast = useCallback((entry) => toastStore.push(entry), []);

        const notify = useCallback((message, tone = 'ok', extra = null) => {
          const info = extra !== null && typeof extra === 'object' ? extra : {};
          return pushToast({
            kind: text(info.kind) !== '' ? info.kind : toastKindOf(tone),
            title: String(message ?? ''),
            detail: info.detail ?? '',
            skill: info.skill ?? null,
            project: info.project ?? null,
            correlationId: info.correlationId ?? '',
            references: info.references ?? null,
            action: info.action ?? null,
            at: info.at ?? '',
          });
        }, [pushToast]);

        const markActivitySeen = useCallback((ids = [], at = '') => {
          const stamp = text(at) || new Date().toISOString();
          setActivitySeen((previous) => {
            const next = activitySeenWith(previous, ids, stamp);
            writeActivitySeen(next);
            return next;
          });
        }, []);

        const openActivity = useCallback(() => {
          setActivityOpen(true);
          // Abrir el drawer sella la marca de leído de este navegador; pedir datos nunca la toca.
          markActivitySeen([], new Date().toISOString());
        }, [markActivitySeen]);

        const onActivityAction = useCallback((action) => {
          if (!isPlainRecord(action)) return;
          setActivityOpen(false);
          if (action.kind === 'skill') { setDrawerId(text(action.id)); return; }
          if (action.kind === 'project') { setView('projects'); return; }
          setView('library');
        }, []);

        // Convierte la `activity` persistida de una acción en un aviso. No pide nada al servidor:
        // el toast se construye con la respuesta que ya trajo la acción y entra en el store común.
        const toastFromActivity = useCallback((activity, replayed) => {
          if (!isPlainRecord(activity) || activity.persisted !== true) return '';
          if (replayed === true) return '';
          const at = text(activity.at) || new Date().toISOString();
          const id = toastStore.pushActivity(activity, false);
          markActivitySeen([text(activity.eventId)], at);
          return id;
        }, [markActivitySeen]);

        // El aviso global sólo puede ofrecer su acción si hay panel montado que sepa ejecutarla.
        useEffect(() => {
          toastActionBridge.set(onActivityAction);
          return () => { toastActionBridge.set(null); };
        }, [onActivityAction]);

        // Seam de pruebas: sólo existe si el Host de pruebas pasa un objeto `__lscTest` en el ctx.
        // En producción esa propiedad no existe (y el proxy de servicios puede lanzar al leerla),
        // por eso va en try/catch: nunca puede romper el panel.
        try {
          const probe = ctx === null || ctx === undefined ? null : ctx['__lscTest'];
          if (isPlainRecord(probe)) {
            probe.notify = notify;
            probe.toastFromActivity = toastFromActivity;
            probe.focusTargetOf = focusTargetOf;
            probe.restoreFocus = restoreFocus;
            probe.activityFailureToast = activityFailureToast;
            probe.setLastActivity = (value) => toastStore.noteActivity(text(value), '');
            probe.seen = () => activitySeenRef.current;
            probe.state = () => {
              const snapshot = toastStore.getSnapshot();
              return { toasts: snapshot.items, activityOpen, lastActivity: snapshot.lastActivity };
            };
          }
        } catch (failure) {
          // ctx de producción con guardia de servicios: no hay seam de pruebas.
        }

        // Filtros de la vista Analítica. Viven en una ref porque `load` recorre el almacén y no debe
        // redefinirse cada vez que alguien cambia la ventana o el proyecto.
        const emptyAnalyticsFilter = () => ({ project: '', days: 14, from: '', to: '', skill: '', type: '', status: '', version: '' });
        const analyticsFilterRef = useRef(emptyAnalyticsFilter());
        const [analyticsFilter, setAnalyticsFilter] = useState(emptyAnalyticsFilter());

        const load = useCallback(async (options = {}) => {
          const target = options.cwd !== undefined ? options.cwd : cwdRef.current;
          setBusy(true);
          setError('');
          try {
            const params = new URLSearchParams();
            if (target !== '') params.set('cwd', target);
            if (options.scan === false) params.set('scan', '0');
            if (analyticsFilterRef.current.days !== 14) params.set('days', String(analyticsFilterRef.current.days));
            if (analyticsFilterRef.current.project !== '') params.set('project', analyticsFilterRef.current.project);
            // Los filtros viajan al servidor: el recorte ocurre donde está el registro, no en la vista.
            for (const key of ['from', 'to', 'skill', 'type', 'status', 'version']) {
              if (analyticsFilterRef.current[key] !== '') params.set(key, analyticsFilterRef.current[key]);
            }
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

        const applyAnalyticsFilter = (next) => {
          // Se conservan los filtros que no vienen en el cambio: si cada control reescribiera el objeto
          // entero, mover un desplegable borraría la fecha que la persona acababa de escribir.
          const value = { ...analyticsFilterRef.current, ...(next ?? {}) };
          value.days = Number(value.days ?? 14);
          analyticsFilterRef.current = value;
          setAnalyticsFilter(value);
          load({ scan: false });
        };

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

        // El inventario se pide al Host en cada refresco: no se cachea en el almacén ni se persiste.
        const loadWorkspaces = useCallback(async () => {
          setWorkspacesBusy(true);
          try {
            const response = await fetch(`${API}/workspaces`, { headers: { accept: "application/json" } });
            const parsed = await readJson(response);
            const data = parsed.data;
            if (!parsed.ok || !data) {
              setWorkspacesError(authMessageFor(response.status) || parsed.message);
              return null;
            }
            if (data.ok !== true) {
              setWorkspaces(null);
              setWorkspacesError(text(data.message) !== '' ? data.message : t('projects.discover.unavailable'));
              return null;
            }
            setWorkspacesError('');
            setWorkspaces(data);
            return data;
          } catch (failure) {
            setWorkspacesError(String(failure?.message ?? failure));
            return null;
          } finally {
            setWorkspacesBusy(false);
          }
        }, [t]);

        // Abrir un workspace en DSH es una acción del cliente sobre el Host: no toca el centro de LifeCode.
        const openWorkspaceInDsh = useCallback(async (workspaceId) => {
          const ui = uiWorkspaceService(ctx);
          if (!ui || typeof ui.openWorkspace !== "function") {
            notify(t('projects.dsh.unavailable'), 'warn');
            return;
          }
          try {
            await ui.openWorkspace(workspaceId);
          } catch (failure) {
            notify(t('toast.failed', { message: String(failure?.message ?? failure) }), 'bad');
          }
        }, [ctx, notify, t]);

        // Despacho de acciones de proyecto sin toast genérico: el diálogo y la ficha muestran el `code`,
        // los `findings` y las `sources` tal como los devuelve el servidor (409/503 incluidos). Se
        // reutiliza el mismo contrato que `act` (POST /state con action/payload/cwd) para no inventar rutas.
        const postProjectAction = useCallback(async (action, payload = {}) => {
          try {
            const response = await fetch(`${API}/state`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action, payload, cwd: cwdRef.current }),
            });
            const parsed = await readJson(response);
            const body = parsed.data ?? null;
            const failure = body?.error ?? body ?? {};
            return {
              status: response.status,
              ok: response.ok === true && parsed.ok === true && body?.ok !== false,
              data: body,
              code: text(failure?.code) !== '' ? text(failure.code) : (text(body?.code) !== '' ? text(body.code) : ''),
              message: text(failure?.message) !== '' ? text(failure.message) : parsed.message,
            };
          } catch (failure) {
            return { status: 0, ok: false, data: null, code: 'network-error', message: String(failure?.message ?? failure) };
          }
        }, []);

        // GET con timeout opcional. El contexto de pruebas puede no tener AbortController ni timers
        // reales: en ese caso se pide sin cancelación en vez de romper.
        const getApi = useCallback(async (url, timeoutMs) => {
          const controller = typeof AbortController === 'function' ? new AbortController() : null;
          let timer = null;
          if (controller !== null && Number.isFinite(timeoutMs) && timeoutMs > 0 && typeof setTimeout === 'function') {
            timer = setTimeout(() => { try { controller.abort(); } catch { /* ya abortado */ } }, timeoutMs);
          }
          try {
            const options = { headers: { accept: 'application/json' } };
            if (controller !== null) options.signal = controller.signal;
            const response = await fetch(url, options);
            const parsed = await readJson(response);
            const body = parsed.data ?? null;
            const failure = body?.error ?? body ?? {};
            return {
              status: response.status,
              ok: response.ok === true && parsed.ok === true && body?.ok !== false,
              data: body,
              code: text(failure?.code) !== '' ? text(failure.code) : (text(body?.code) !== '' ? text(body.code) : ''),
              message: text(failure?.message) !== '' ? text(failure.message) : parsed.message,
            };
          } catch (failure) {
            const aborted = failure?.name === 'AbortError';
            return { status: 0, ok: false, data: null, code: aborted ? 'timeout' : 'network-error', message: String(failure?.message ?? failure) };
          } finally {
            if (timer !== null) clearTimeout(timer);
          }
        }, []);

        /**
         * Handshake de compatibilidad (contrato R16.2). Cinco estados:
         *  - `compatible-r16`: `/api/capabilities` válido, contrato >= 2 y publica projects+inventory.
         *  - `legacy-compatible`: capabilities 404 **y** una señal POSITIVA en `/api/workspaces`
         *    (200, `ok:true`, filas del contrato viejo, sin `deprecated`). Un 404 solo no basta.
         *  - `backend-incompatible`: capabilities inválido/versión menor, o 404 sin señal heredada.
         *  - `backend-unavailable`: red, 5xx o timeout.
         *  - `authentication-error`: 401/403.
         */
        const loadCompat = useCallback(async () => {
          const result = await getApi(`${API}/capabilities`, 6000);
          const checkedAt = new Date().toISOString();
          const next = (state, extra) => Object.assign({
            state, http: result.status, code: result.code, message: result.message,
            contractVersion: null, backendVersion: '', capabilities: [], checkedAt, legacyProbe: null,
          }, extra ?? {});
          const payload = result.ok === true ? asCapabilitiesPayload(result.data) : null;
          if (payload !== null) {
            const capabilities = asArray(payload.capabilities);
            const version = payload.contractVersion;
            if (version >= 2 && capabilities.includes('projects') && capabilities.includes('inventory')) {
              setCompat(next('compatible-r16', {
                contractVersion: version,
                backendVersion: text(payload.plugin?.version),
                capabilities,
              }));
              return 'compatible-r16';
            }
            setCompat(next('backend-incompatible', {
              contractVersion: Number.isFinite(version) ? version : null,
              backendVersion: text(payload.plugin?.version),
              capabilities,
            }));
            return 'backend-incompatible';
          }
          if (result.status === 401 || result.status === 403) {
            setCompat(next('authentication-error'));
            return 'authentication-error';
          }
          if (result.status === 404 || result.status === 405) {
            const probe = await getApi(`${API}/workspaces`, 6000);
            // `/capabilities` se sirve sin admisión, así que el 401/403 aparece en la ruta de datos.
            if (probe.status === 401 || probe.status === 403) {
              setCompat(next('authentication-error', { http: probe.status, code: probe.code, legacyProbe: { status: probe.status, ok: false } }));
              return 'authentication-error';
            }
            const legacyPayload = probe.ok === true ? asLegacyWorkspacesPayload(probe.data) : null;
            if (legacyPayload !== null) {
              setLegacyProjects(legacyPayload);
              setCompat(next('legacy-compatible', { legacyProbe: { status: probe.status, ok: true } }));
              return 'legacy-compatible';
            }
            setCompat(next('backend-incompatible', { legacyProbe: { status: probe.status, ok: probe.ok === true, code: probe.code } }));
            return 'backend-incompatible';
          }
          setCompat(next(result.status === 0 ? 'backend-unavailable' : 'backend-unavailable'));
          return 'backend-unavailable';
        }, [getApi]);

        // Refresco real del inventario nuevo: las dos rutas van en paralelo y cada fallo se informa con
        // su propio código. Nunca se declara éxito si una petición falló o devolvió `ok:false`. El
        // payload heredado de `/workspaces` sólo se muestra cuando el handshake lo demuestra.
        const loadProjects = useCallback(async () => {
          if (projectsBusyRef.current === true) return null;
          projectsBusyRef.current = true;
          setProjectsBusy(true);
          const get = (url) => getApi(url);
          const finish = () => { projectsBusyRef.current = false; setProjectsBusy(false); };
          let mode = '';
          try {
            mode = await loadCompat();
          } catch {
            mode = 'backend-unavailable';
          }
          if (mode !== 'compatible-r16') {
            // La UI no llama rutas que el backend no publica: ni banner rojo por 404 ni ceros fingidos.
            const legacy = mode === 'legacy-compatible';
            if (!legacy) setLegacyProjects(null);
            projectsRef.current = { projectsData: null, inventoryData: null };
            setProjectsData(null);
            setInventoryData(null);
            setProjectsReport({
              at: new Date().toISOString(),
              errors: [],
              changes: 0,
              complete: null,
              truncated: false,
              stale: false,
              legacy,
              legacyReason: legacy ? 'handshake' : '',
              legacyStatus: 0,
              contract: false,
              compat: mode,
              sourceRows: [],
            });
            finish();
            return { projectsData: null, inventoryData: null, errors: [], legacy, compat: mode };
          }
          const cwdValue = encodeURIComponent(text(cwdRef.current));
          const [projectsResult, inventoryResult] = await Promise.all([
            get(`${API}/projects?cwd=${cwdValue}&limit=500`),
            get(`${API}/inventory?cwd=${cwdValue}&limit=500`),
          ]);
          // En `compatible-r16` la autorización se comprueba en las rutas de datos: si una responde
          // 401/403 el banner es de autorización, no de contrato roto, y no se pinta ningún recuento.
          const authFailure = [projectsResult, inventoryResult].find((result) => result.status === 401 || result.status === 403) ?? null;
          if (authFailure !== null) {
            setCompat({ state: 'authentication-error', http: authFailure.status, code: authFailure.code, message: authFailure.message, contractVersion: 2, backendVersion: '', capabilities: [], checkedAt: new Date().toISOString(), legacyProbe: null });
            projectsRef.current = { projectsData: null, inventoryData: null };
            setProjectsData(null);
            setInventoryData(null);
            setLegacyProjects(null);
            setProjectsReport({
              at: new Date().toISOString(), errors: [], changes: 0, complete: null, truncated: false,
              stale: false, legacy: false, legacyReason: '', legacyStatus: 0, contract: false,
              compat: 'authentication-error', sourceRows: [],
            });
            finish();
            return { projectsData: null, inventoryData: null, errors: [], legacy: false, compat: 'authentication-error' };
          }
          const errors = [];
          // Validación estricta: un 200 con otra forma NO es el contrato nuevo y ahora tampoco es
          // legacy: el handshake ya dijo que la ruta existe, así que se informa el contrato roto.
          const projectsPayload = projectsResult.ok === true ? asProjectsPayload(projectsResult.data) : null;
          const inventoryPayload = inventoryResult.ok === true ? asInventoryPayload(inventoryResult.data) : null;
          if (projectsPayload === null) {
            errors.push({ id: 'projects', status: projectsResult.status, code: projectsResult.ok === true ? 'projects-contract-missing' : (projectsResult.code || 'projects-unavailable'), message: projectsResult.message });
          }
          if (inventoryPayload === null) {
            const code = inventoryResult.ok === true ? 'inventory-contract-missing' : (inventoryResult.code || 'inventory-unavailable');
            errors.push({ id: 'inventory', status: inventoryResult.status, code, message: inventoryResult.message });
          }
          setLegacyProjects(null);
          const next = { projectsData: projectsPayload, inventoryData: inventoryPayload };
          const changes = countProjectChanges(projectsRef.current, next);
          projectsRef.current = next;
          setProjectsData(projectsPayload);
          setInventoryData(inventoryPayload);
          setProjectsReport({
            at: projectsPayload?.generatedAt ?? inventoryPayload?.generatedAt ?? new Date().toISOString(),
            errors,
            changes,
            complete: projectsPayload !== null ? projectsPayload.complete !== false : null,
            truncated: inventoryPayload?.truncated === true,
            stale: projectsPayload !== null && projectsPayload.readable === false,
            legacy: false,
            legacyReason: '',
            legacyStatus: 0,
            contract: projectsPayload !== null,
            compat: mode,
            sourceRows: [...asArray(projectsPayload?.sources), ...asArray(inventoryPayload?.sources)],
          });
          finish();
          return { projectsData: projectsPayload, inventoryData: inventoryPayload, errors, legacy: false, compat: mode };
        }, [getApi, loadCompat]);

        const loadProjectDetail = useCallback(async (entry, mode) => {
          if (!compatActionsEnabled(compat)) return null;
          const target = entry ?? null;
          const detailMode = mode === 'inspect' ? 'inspect' : 'detail';
          setProjectDetail({ open: true, mode: detailMode, entry: target, data: null, busy: true, error: null });
          if (target === null || text(target.projectId) === '') {
            setProjectDetail({ open: true, mode: detailMode, entry: target, data: null, busy: false, error: { code: 'project-not-found', message: t('projects.error.notFound') } });
            return null;
          }
          const result = await postProjectAction('inspect-project', { projectId: String(target.projectId) });
          const failure = result.ok === true ? null : {
            code: result.code || 'inspect-failed',
            status: result.status,
            message: result.message,
            reasons: asArray(result.data?.reasons ?? result.data?.error?.reasons),
            findings: asArray(result.data?.findings ?? result.data?.error?.findings),
            sources: asArray(result.data?.sources ?? result.data?.error?.sources),
          };
          setProjectDetail((previous) => previous === null ? previous : ({ ...previous, busy: false, data: result.ok === true ? result.data : null, error: failure }));
          return result;
        }, [compat, postProjectAction, t]);

        const openProjectDetail = useCallback((entry) => { loadProjectDetail(entry, 'detail').catch(() => {}); }, [loadProjectDetail]);
        const inspectProject = useCallback((entry) => { loadProjectDetail(entry, 'inspect').catch(() => {}); }, [loadProjectDetail]);

        const openProjectPreflight = useCallback((entry) => {
          if (!compatActionsEnabled(compat)) return;
          setProjectDialog({
            mode: 'manage',
            step: 1,
            workspaceId: text(entry?.workspace?.workspaceId) !== '' ? entry.workspace.workspaceId : '',
            cwd: text(entry?.canonicalPath) !== '' ? entry.canonicalPath : text(entry?.cwd),
            name: text(entry?.name) !== '' ? entry.name : '',
            projectId: text(entry?.projectId) !== '' ? entry.projectId : '',
            busy: false,
            error: null,
          });
        }, [compat]);

        const openProjectRegister = useCallback(() => {
          if (!compatActionsEnabled(compat)) return;
          setProjectDialog({ mode: 'register', step: 1, workspaceId: '', cwd: '', name: '', projectId: '', busy: false, error: null });
        }, [compat]);

        const updateProjectDialog = useCallback((patch) => {
          setProjectDialog((previous) => previous === null ? previous : ({ ...previous, ...(patch ?? {}) }));
        }, []);

        const closeProjectDialog = useCallback(() => { setProjectDialog(null); }, []);

        const projectView = useMemo(
          () => buildProjectView({ projectsData, inventoryData, legacy: legacyProjects }),
          [projectsData, inventoryData, legacyProjects],
        );

        // Ficha de skill: la entrada y sus colisiones salen del inventario global, sin inventar datos.
        const skillDetailEntry = text(skillDetailKey) === ''
          ? null
          : (asArray(inventoryData?.entries).find((record) => text(record?.key) === text(skillDetailKey)
            || text(record?.canonicalName) === text(skillDetailKey)
            || text(record?.name) === text(skillDetailKey)) ?? null);
        const skillDetailCollisions = skillDetailEntry === null
          ? []
          : asArray(inventoryData?.collisions).filter((collision) => text(collision?.key) === text(skillDetailEntry.canonicalName ?? skillDetailEntry.name)
            || asArray(collision?.rows).some((row) => text(row?.key) === text(skillDetailEntry.key)));

        const confirmProjectRegister = useCallback(async () => {
          if (!compatActionsEnabled(compat)) return null;
          let currentDialog = null;
          setProjectDialog((previous) => {
            currentDialog = previous;
            if (previous === null || previous.busy === true) return previous;
            return { ...previous, busy: true, error: null };
          });
          if (currentDialog === null || currentDialog.busy === true) return null;
          // Al elegir un workspace descubierto no se escribe la ruta a mano: se resuelve la canónica del
          // mismo inventario que muestra la prevalidación, para que confirmar y revisar hablen de lo mismo.
          const resolvedCwd = dialogTarget(projectView, currentDialog).cwd;
          const cwdValue = text(currentDialog.cwd) !== '' ? currentDialog.cwd : resolvedCwd;
          if (cwdValue === '') {
            setProjectDialog((previous) => previous === null ? previous : ({ ...previous, busy: false }));
            return null;
          }
          const payload = { cwd: cwdValue };
          if (text(currentDialog.name) !== '') payload.name = currentDialog.name;
          if (text(currentDialog.projectId) !== '') payload.projectId = currentDialog.projectId;
          const result = await postProjectAction('register-project', payload);
          if (result.ok === true) {
            setProjectDialog(null);
            notify(t('toast.project'), 'ok');
            await loadProjects();
            return result;
          }
          const failure = {
            code: result.code || 'register-failed',
            status: result.status,
            message: result.message,
            reasons: asArray(result.data?.reasons ?? result.data?.error?.reasons),
            findings: asArray(result.data?.findings ?? result.data?.error?.findings),
            sources: asArray(result.data?.sources ?? result.data?.error?.sources),
          };
          setProjectDialog((previous) => previous === null ? previous : ({ ...previous, busy: false, error: failure }));
          return result;
        }, [compat, loadProjects, notify, postProjectAction, projectView, t]);

        // «Copiar diagnóstico» del modo incompatible: JSON saneado, sin rutas de usuario ni payloads
        // completos. Si el portapapeles no existe, se dice; nunca se finge que copió.
        const copyCompatDiagnostics = useCallback(async () => {
          const payload = compatDiagnosticsPayload(compat, projectsReport);
          const serialized = JSON.stringify(payload, null, 2);
          try {
            if (typeof navigator === 'undefined' || navigator === null || navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== 'function') {
              notify(t('projects.compat.copyUnavailable'), 'warn');
              return false;
            }
            await navigator.clipboard.writeText(serialized);
            notify(t('projects.compat.copied'), 'ok');
            return true;
          } catch {
            notify(t('projects.compat.copyUnavailable'), 'warn');
            return false;
          }
        }, [compat, notify, projectsReport, t]);

        const retryCompat = useCallback(() => {
          loadProjects().catch(() => {});
        }, [loadProjects]);

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
          if (view === 'projects') {
            loadWorkspaces().catch(() => {});
            loadProjects().catch(() => {});
          }
          if (view === 'analytics' && doctor === null) loadDoctor();
          return undefined;
        }, [view, loadWorkspaces, loadProjects, loadDoctor, doctor]);

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

        // La última actividad conocida puede venir ya en el snapshot: es sólo una pista para el
        // indicador de cabecera, nunca una consulta extra.
        useEffect(() => {
          if (lastActivity !== '') return;
          const seed = text(snapshot?.activity?.last?.at) || text(snapshot?.activity?.at);
          if (seed !== '') setLastActivity(seed);
        }, [lastActivity, snapshot]);

        const act = useCallback(async (action, payload = {}, options = null) => {
          // `quiet` es para las acciones que pintan su propio error en el diálogo (paquetes): no deben
          // convertir un 409 en un toast genérico ni perder el código, los findings o la vista previa.
          const quiet = options !== null && typeof options === 'object' && options.quiet === true;
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
              const failure = result !== null && typeof result?.error === 'object' ? result.error : result;
              const code = String(failure?.code ?? '');
              const message = authMessageFor(response.status) || failure?.message || parsed.message;
              if (quiet) {
                return {
                  ...(result !== null && typeof result === 'object' ? result : {}),
                  ok: false,
                  status: response.status,
                  code,
                  message,
                };
              }
              // Aviso de error/bloqueo con el código y lo que el servidor explicó. El error no caduca:
              // se cierra a mano (×, Escape o su acción). No se pide nada más al servidor.
              const toast = activityFailureToast(failure, response.status, {
                failed: t('activity.toast.failed'),
                blocked: t('activity.toast.blocked'),
                code: t('activity.row.code'),
              });
              notify(toast.title, 'bad', { kind: 'error', title: toast.title, detail: toast.detail });
              setError(message);
              return null;
            }
            // Éxito: sólo se anuncia lo que la acción declara como persistido. Si no hay `activity`,
            // no se inventa un aviso de éxito (las llamadas antiguas a `notify` siguen siendo su voz).
            await load({ scan: false });
            if (!quiet) toastFromActivity(result.activity, result.replayed === true);
            return result;
          } catch (failure) {
            if (quiet) {
              return { ok: false, status: 0, code: 'network', message: String(failure?.message ?? failure) };
            }
            notify(t('activity.toast.failed'), 'bad', {
              kind: 'error',
              detail: `${t('activity.toast.blocked')} · ${String(failure?.message ?? failure)}`,
            });
            return null;
          } finally {
            setBusy(false);
          }
        }, [load, notify, t, toastFromActivity]);

        const onIdentityAction = useCallback((action, payload) => {
          if (workspaces && workspaces.identity && workspaces.identity.available !== true) {
            notify(t('projects.identity.action.locked'), 'warn');
            return;
          }
          setIdentityConfirm({ action, payload });
        }, [notify, t, workspaces]);

        const runIdentityAction = useCallback(async () => {
          const pending = identityConfirm;
          if (pending === null) return;
          setIdentityConfirm(null);
          const key = String(pending.payload && pending.payload.cwd ? pending.payload.cwd : pending.action);
          setIdentityBusy(key);
          const result = await act(pending.action, pending.payload);
          setIdentityBusy('');
          if (result !== null) {
            notify(t('projects.identity.action.done', { branch: String(result.branch == null ? pending.action : result.branch) }));
            await loadWorkspaces();
          }
        }, [act, identityConfirm, loadWorkspaces, notify, t]);

        const onExport = useCallback(async () => {
          const result = await act('export', {});
          if (result === null) return;
          notify(t('analytics.export.done', { file: String(result.file ?? ''), bytes: String(result.bytes ?? 0) }));
        }, [act, notify, t]);

        // La verificación de origen la hace el Host (subagents.listChildren) a petición de una persona: el panel
  // sólo pide la comprobación y cuenta lo que el Host conteste. Un subagente no puede declararse verificado.
  const onVerifyOrigin = useCallback(async (insightId) => {
    try {
      const response = await fetch(API + "/origin-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ insightId: String(insightId ?? "") }),
      });
      const result = await response.json();
      // El servidor publica `origin.verified`, no `verified` en la raíz: leer el campo equivocado hacía que
      // la bandeja dijera «no se pudo verificar» justo cuando el Host sí lo había verificado.
      const verified = result?.origin?.verified === true || result?.verified === true;
      if (response.ok && verified) notify(t("analytics.knowledge.origin.done"));
      else if (response.ok && String(result?.code ?? "") === "origin-not-declared") notify(t("analytics.knowledge.origin.notDeclared"));
      else if (response.ok) notify(t("analytics.knowledge.origin.notVerified"));
      else notify(t("analytics.knowledge.origin.failed", { code: String(result.code ?? response.status) }));
      await load({});
    } catch (error) {
      notify(t("analytics.knowledge.origin.failed", { code: String(error?.message ?? "network") }));
    }
  }, [load, notify, t]);

  const onPolicy = useCallback(async (projectId, mode) => {
          const result = await act('policy', { projectId: String(projectId ?? ''), mode: String(mode ?? '') });
          if (result === null) return;
          notify(t('analytics.knowledge.policy.done', { project: String(projectId || '—'), mode: String(mode) }));
          await load({});
        }, [act, load, notify, t]);

        const onResync = useCallback(async () => {
          const result = await act('sync', {});
          if (result === null) return;
          notify(t('analytics.doctor.resynced'));
          await loadDoctor();
          await loadWorkspaces();
        }, [act, loadDoctor, loadWorkspaces, notify, t]);

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

        // Pedir a la IA: la petición se guarda en el centro y el agente la ve por su herramienta de
        // estado. Aquí no hay modelo: fingir que lo hay sería mentir en la interfaz.
        const onAsk = useCallback(async (text) => {
          const result = await act('request-skill', { text });
          if (result === null) return;
          setAskText('');
          notify(result.duplicate === true ? t('ask.duplicate') : t('ask.sent'));
        }, [act, notify, t]);

        const onDismissRequest = useCallback(async (requestId) => {
          const result = await act('request-dismiss', { requestId });
          if (result !== null) notify(t('ask.dismissed'));
        }, [act, notify, t]);

        const onAdvance = useCallback(async (projectId) => {
        const result = await act('advance', { projectId });
        if (result?.ok !== true) {
          notify(result?.message ?? t('review.error'));
          return;
        }
        const count = asArray(result.updated).length;
        notify(count === 0 ? t('projects.updates.none') : `${t('projects.updates.done')} ${count}`);
        await load({ scan: false });
      }, [act, notify, load, t]);

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

        // Importar un **paquete** de otro centro es otro acto que importar una skill detectada en disco:
        // el paquete entra como copia aislada y nunca toca la skill que ya existe con ese id.
        // Exportar escribe un fichero portable en exports/: lo pide una persona y el panel dice dónde quedó.
        const onExportBundle = useCallback(async (skillId, version) => {
          const payload = { skillId: String(skillId ?? '') };
          if (String(version ?? '') !== '') payload.version = String(version);
          const result = await act('export-skill', payload);
          if (result === null) return { ok: false, code: 'failed' };
          if (result.ok === true) {
            notify(t('drawer.export.done', { file: String(result.file ?? ''), bytes: String(result.bytes ?? '') }));
            // El paquete puede llevar rutas privadas del proyecto de origen: se avisa, no se bloquea.
            if (Array.isArray(result.warnings) && result.warnings.length > 0) {
              notify(t('drawer.export.warn', { n: String(result.warnings.length) }));
            }
            await load();
          }
          return result;
        }, [act, load, notify, t]);

        // Validar es lectura pura: no escribe, no registra y no toca el almacén.
        const onInspectBundle = useCallback(async (bundle) => {
          const result = await act('inspect-bundle', { bundle: String(bundle ?? ''), from: 'panel' }, { quiet: true });
          if (result === null) return { ok: false, code: 'failed' };
          return result;
        }, [act]);

        const onImportBundle = useCallback(async (bundleText, options) => {
          const payload = {
            bundle: String(bundleText ?? ''),
            from: 'panel',
            confirmed: options?.confirmed === true,
          };
          if (String(options?.onConflict ?? '') !== '') payload.onConflict = String(options.onConflict);
          const result = await act('import-bundle', payload, { quiet: true });
          if (result === null) return { ok: false, code: 'failed' };
          const imported = result.imported !== null && typeof result.imported === 'object' ? result.imported : null;
          const importedId = String(result.id ?? imported?.id ?? (typeof result.imported === 'string' ? result.imported : ''));
          if (result.ok === true && result.imported !== false && importedId !== '') {
            notify(t('library.import.done', { id: importedId, renamed: '' }));
            if (Array.isArray(result.warnings) && result.warnings.length > 0) {
              notify(t('library.import.warn', { n: String(result.warnings.length) }));
            }
            await load();
          }
          return result;
        }, [act, load, notify, t]);

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
              const failure = result !== null && typeof result === 'object' ? result : { message: parsed.message };
              const toast = activityFailureToast(failure, response.status, {
                failed: t('activity.toast.failed'),
                blocked: t('activity.toast.blocked'),
                code: t('activity.row.code'),
              });
              notify(toast.title, 'bad', { kind: 'error', title: toast.title, detail: toast.detail });
              if (typeof setError === 'function') setError(asArray(result?.findings).map((finding) => text(finding?.message)).join(' · ') || toast.title);
              return;
            }
            setModalOpen(false);
            await load({ scan: false });
            setDrawerId(result.id ?? null);
            notify(t('toast.created'));
            const duplicates = asArray(result.duplicates);
            if (duplicates.length > 0) {
              notify(t('toast.duplicates', {
                list: duplicates.slice(0, 3).map((entry) => String(entry.id ?? '')).join(', '),
                n: String(duplicates.length),
              }));
            }
          } catch (failure) {
            const toast = activityFailureToast({ code: 'network', message: String(failure?.message ?? failure) }, 0, {
              failed: t('activity.toast.failed'),
              blocked: t('activity.toast.blocked'),
              code: t('activity.row.code'),
            });
            notify(toast.title, 'bad', { kind: 'error', title: toast.title, detail: toast.detail });
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

        const onRestore = useCallback(async (payload) => {
          const result = await act('restore', payload);
          if (result !== null) {
            notify(t('integrity.restored', { file: result.restoredFrom }));
            if (result.archivedAs) notify(t('integrity.preserved', { file: result.archivedAs }));
          }
          return result;
        }, [act, notify, t]);

        /**
         * Abrir el diálogo no escribe nada: sólo explica lo que pasará si se confirma.
         *
         * Se revalida la elegibilidad antes de abrirlo para no ofrecer un diálogo que el servidor va a
         * rechazar; aun así el servidor comprueba todo otra vez al ejecutar.
         */
        const onMigrateRequest = useCallback(() => {
          if (migrateBusy === true) return;
          if (snapshot?.migration?.canMigrate !== true) {
            notify(t('schema.state.blocked'), 'bad');
            return;
          }
          setMigrateResult(null);
          setMigrateOpen(true);
        }, [migrateBusy, notify, snapshot, t]);

        const countText = (counts) => (counts === null || counts === undefined
          ? '—'
          : `${counts.skills}·${counts.versions}·${counts.projects}·${counts.assignments}·${counts.improvements}·${counts.events}`);

        /**
         * Confirmar la migración: una sola petición, sin reintentos automáticos.
         *
         * No se usa `act` porque aquí hace falta el código de fallo tal cual (`backup-stale`,
         * `store-busy`, `migration-unverified`…) y porque el éxito trae su propia instantánea.
         */
        const onMigrateConfirm = useCallback(async () => {
          if (migrateBusy === true) return;
          const before = snapshot?.counts ?? null;
          setMigrateBusy(true);
          setMigrateResult(null);
          try {
            const response = await fetch(`${API}/state`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'migrate', payload: {}, cwd: cwdRef.current }),
            });
            const parsed = await readJson(response);
            const result = parsed.data ?? null;
            if (!parsed.ok || result === null) {
              const message = authMessageFor(response.status) || parsed.message || `HTTP ${response.status}`;
              setMigrateResult({ ok: false, text: t('schema.result.failed', { code: `HTTP ${response.status}`, message }) });
              return;
            }
            if (result.ok !== true) {
              setMigrateResult({ ok: false, text: t('schema.result.failed', { code: String(result.code ?? 'error'), message: String(result.message ?? '') }) });
              await load({ scan: false });
              return;
            }
            const after = result.snapshot?.counts ?? null;
            setMigrateResult({
              ok: true,
              text: `${t('schema.result.ok')} ${t('schema.result.kept', { before: countText(before), after: countText(after) })}`,
            });
            notify(t('toast.migrated'));
            setMigrateOpen(false);
            await load({ scan: false });
          } catch (failure) {
            setMigrateResult({ ok: false, text: t('schema.result.failed', { code: 'network', message: String(failure?.message ?? failure) }) });
          } finally {
            setMigrateBusy(false);
          }
        }, [authMessageFor, cwdRef, load, migrateBusy, notify, snapshot, t]);

        const nav = useMemo(() => {
          const pending = asArray(snapshot?.improvements).filter((entry) => entry.status === 'proposed').length;
          const externalCount = asArray(snapshot?.external?.candidates).length;
          // Con el centro ilegible no se pintan recuentos: un «0» ahí sería una biblioteca vacía falsa.
          if (snapshot?.readable === false) {
            return [
              { id: 'overview', label: t('nav.overview'), icon: 'overview' },
              { id: 'library', label: t('nav.library'), icon: 'library' },
              { id: 'projects', label: t('nav.projects'), icon: 'projects' },
              { id: 'improvements', label: t('nav.improvements'), icon: 'improvements' },
              { id: 'analytics', label: t('nav.analytics'), icon: 'analytics' },
            ];
          }
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
        const pendingCount = pendingApprovalCount(snapshot);
        // Evidencia de disponibilidad del centro: la última lectura de `/api/state` funcionó, o falló.
        // Se pasa al indicador y al cajón para no confundir un backend heredado con un centro caído.
        const activityApiAvailable = error === '' ? true : false;

        return e('div', { className: 'lsc-root', ref: activityRootRef, tabIndex: -1 },
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
            e(ActivityIndicator, {
              t,
              lang,
              apiAvailable: activityApiAvailable,
              busy: busy === true || projectsBusy === true,
              actionPending: actionPending !== '',
              pendingCount,
              lastActivity,
              unreadCount: 0,
                  hasUnread: lastActivity !== '' && (activitySeen.lastSeenAt === '' || lastActivity > activitySeen.lastSeenAt),
              onOpen: openActivity,
              triggerRef: activityTriggerRef,
            }),
            e('button', { type: 'button', className: 'lsc-btn ghost', title: t('app.refresh'), disabled: busy, onClick: () => load() }, '⟳'),
            e('button', { type: 'button', className: 'lsc-btn primary', disabled: snapshot.readable === false, title: snapshot.readable === false ? t('integrity.title') : '', onClick: () => setModalOpen(true) }, `+ ${t('app.new')}`),
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
              snapshot.readable === false ? e(IntegrityBand, { t, integrity: snapshot.integrity ?? {}, onRestore, busy }) : null,
              snapshot.readable === false
                ? (view === 'analytics' ? e(AnalyticsView, { t, lang, snapshot, onMigrate: onMigrateRequest, migrationBusy: migrateBusy, migrationResult: migrateResult, filters: analyticsFilter, onFilters: applyAnalyticsFilter, onOpen: setDrawerId, doctor, doctorError, doctorBusy, onDoctor: loadDoctor, onResync, onExport, onPolicy, onVerifyOrigin }) : null)
                : view === 'overview' ? e(OverviewView, { t, lang, snapshot, onOpen: setDrawerId, onNavigate: setView, onImport, onDecide, busy, actionPending }) : null,
              snapshot.readable === false ? null : view === 'library' ? e(LibraryView, {
                t, lang, snapshot, busy,
                onOpen: setDrawerId,
                onNew: () => setModalOpen(true),
                ask: { text: askText, change: setAskText, send: onAsk, dismiss: onDismissRequest, open: setDrawerId },
                // `LibraryView` lee el cuadro de detección por `detect` y los manejadores por `onDetect`:
                // pasar sólo uno de los dos dejaba la vista en blanco (encontrado en la auditoría).
                detect: detectState,
                onDetect: detectState,
                onImport: onImportBundle,
                onInspect: onInspectBundle,
                onExport: onExportBundle,
                onOpenSkill: (id) => setDrawerId(id),
              }) : null,
              snapshot.readable === false ? null : view === 'projects' ? e(ProjectsView, {
          t,
          lang,
          snapshot,
          workspaces,
          workspacesError,
          workspacesBusy,
          projectView,
          projectsBusy,
          projectsReport,
          compat,
          onCompatRetry: retryCompat,
          onCopyDiagnostics: copyCompatDiagnostics,
          onWorkspacesRefresh: loadWorkspaces,
          onProjectsRefresh: loadProjects,
          openWorkspaceAvailable: Boolean(uiWorkspace && typeof uiWorkspace.openWorkspace === 'function'),
          onOpenWorkspace: openWorkspaceInDsh,
          onInspectProject: inspectProject,
          onOpenDetail: openProjectDetail,
          onOpenPreflight: openProjectPreflight,
          onOpenRegister: openProjectRegister,
          onOpenSkill: (key) => setSkillDetailKey(text(key)),
          cwd,
          busy,
          onToggle,
          onVersion,
          onSync,
          onAdvance,
          onSelect: selectProject,
          onOpen: setDrawerId,
          identityBusy: identityBusy !== '',
          onIdentityAction,
        }) : null,
              snapshot.readable === false ? null : view === 'improvements' ? e(ImprovementsView, { t, lang, snapshot, onDecide, onOpen: setDrawerId, busy, actionPending }) : null,
              snapshot.readable === false ? null : view === 'analytics' ? e(AnalyticsView, { t, lang, snapshot, onMigrate: onMigrateRequest, migrationBusy: migrateBusy, migrationResult: migrateResult, filters: analyticsFilter, onFilters: applyAnalyticsFilter, onOpen: setDrawerId, doctor, doctorError, doctorBusy, onDoctor: loadDoctor, onResync, onExport, onPolicy, onVerifyOrigin }) : null,
            ),
          ),

          drawerId !== null ? e(SkillDrawer, { t, lang, snapshot, skillId: drawerId, onClose: () => setDrawerId(null), onToggle, onVersion, onEvaluate, onExport: onExportBundle, busy }) : null,

          identityConfirm !== null
            ? e(IdentityDialog, { t, busy: identityBusy !== '', onCancel: () => setIdentityConfirm(null), onConfirm: runIdentityAction })
            : null,
          modalOpen && snapshot.readable !== false ? e(CreateModal, { t, onSubmit: onCreate, onClose: () => setModalOpen(false), busy }) : null,
          migrateOpen ? e(MigrateDialog, {
            t,
            busy: migrateBusy,
            result: migrateResult,
            onCancel: () => {
              if (migrateBusy === true) return;
              setMigrateOpen(false);
              setMigrateResult(null);
            },
            onConfirm: onMigrateConfirm,
          }) : null,
          projectDetail !== null
            ? e(ProjectDetailDialog, {
              t,
              lang,
              snapshot,
              detail: projectDetail,
              view: projectView,
              openWorkspaceAvailable: Boolean(uiWorkspace && typeof uiWorkspace.openWorkspace === 'function'),
              onClose: () => setProjectDetail(null),
              onInspect: () => { loadProjectDetail(projectDetail.entry, 'inspect').catch(() => {}); },
              onManage: () => {
                const entry = projectDetail.entry ?? null;
                setProjectDetail(null);
                if (entry !== null) openProjectPreflight(entry);
              },
              onOpenWorkspace: openWorkspaceInDsh,
              onOpenSkill: (key) => setSkillDetailKey(text(key)),
            })
            : null,
          projectDialog !== null
            ? e(ProjectDialog, {
              t,
              lang,
              view: projectView,
              dialog: projectDialog,
              onClose: closeProjectDialog,
              onField: updateProjectDialog,
              onStep: (step) => updateProjectDialog({ step }),
              onConfirm: confirmProjectRegister,
            })
            : null,
          skillDetailEntry === null
            ? null
            : e(SkillDetailDialog, {
              t,
              lang,
              entry: skillDetailEntry,
              collisions: skillDetailCollisions,
              onClose: () => setSkillDetailKey(''),
              onExport: onExportBundle,
            }),
          overlayMounted === true ? null : e(ToastStack, { t, toasts, onClose: dismissToast, onAction: onActivityAction }),
          activityOpen
            ? e(ActivityDrawer, {
              t,
              lang,
              apiAvailable: activityApiAvailable,
              onClose: () => setActivityOpen(false),
              onAction: onActivityAction,
              returnFocusRef: activityTriggerRef,
              fallbackFocusRef: activityRootRef,
            })
            : null,
        );
      }

      // Cáscara registrada en el slot: la frontera envuelve TODO el panel, así un fallo de cualquier
      // vista se ve como tarjeta de diagnóstico en vez de dejar el área del harness vacía. El
      // `Reintentar` re-monta el panel desde cero (los datos se vuelven a pedir).
      //
      // React sólo reconoce una frontera de error en una CLASE, y la clase necesita `React.Component`.
      // Los arneses mínimos de las pruebas no lo traen: allí se registra el panel directo para no
      // cambiar la forma del árbol que esas pruebas inspeccionan. El React real siempre lo trae.
      if (typeof React.Component !== 'function') return Panel;
      return function SkillCenterPanel() {
        const lang = useLanguage();
        const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);
        return e(PanelErrorBoundary, { t }, e(Panel));
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

        // R17.1: puente del stream de la sesión activa (sólo lectura del `eventSource` ya abierto).
        const sessionBridge = createSessionActivityBridge(ctx);

        // La pila de avisos se pinta en el Slot global, encima de la conversación, no dentro del panel.
        ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
          name: OVERLAY_SLOT,
          id: `${PANEL_ID}.toasts`,
          order: 60,
          locale: NS,
        }, ToastOverlayHost));

        // Probe mudo: recibe el `sessionId` de la conversación y se lo pasa al puente.
        ctx.slots.inject(SESSION_ACTIONS_SLOT, () => ctx.slots.register({
          name: SESSION_ACTIONS_SLOT,
          id: `${PANEL_ID}.session-probe`,
          order: 60,
          locale: NS,
          inject: () => ({ onSession: (id) => sessionBridge.connect(id) }),
        }, SessionToastProbe));

        ctx.effect(() => () => {
          sessionBridge.dispose();
          toastActionBridge.dispose();
          toastOverlayPresence.dispose();
          toastStore.dispose();
        });

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
