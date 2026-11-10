# R16 · Rediseño de la sección Proyectos (UX/UI)

| Campo | Valor |
|---|---|
| Ronda | R16 — descubrimiento, registro y administración de proyectos |
| Fecha de redacción | 2026-11-09 |
| Componente | `lifecode-skill-center/client.js` (5563 líneas; instantánea de las 12:15, 330405 B) |
| Modelo de datos | `GET /api/projects`, `GET /api/inventory` (`lib/api.mjs:1316-1456`, `:1005-1085`) |
| Capturas antes | `_audit/r16-before-projects-*.png` + `_audit/r16-capture/` |

El rediseño no cambia el lenguaje visual del panel: conserva pestañas, tarjetas, badges, botones y
diálogo modales con la misma jerarquía y densidad. Cambia **qué información se muestra, qué se puede
hacer desde cada sitio y qué pasa cuando el Host no puede confirmar algo**. La comprobación de
tokens/estilos CSS no forma parte de este informe (no verificado).

> **Nota de versionado.** Las líneas de `client.js` se midieron sobre la instantánea de las 12:15
> (330405 B). El fichero se siguió editando durante la redacción (arreglo de plural y ajustes de
> `ui-projects`), por lo que las referencias posteriores a `:350` se han desplazado. Cada cita va
> acompañada del nombre de la clave, función o componente para poder localizarla con `grep`; los
> números de línea identifican la instantánea documentada, no un árbol congelado.

---

## 1. Resumen: once indicadores que filtran

`PROJECT_CHIP_IDS` (`client.js:2452`) declara once indicadores. `projectChipPredicate`
(`client.js:2678-2693`) define para cada uno un predicado sobre la **entrada de proyecto**, y
`filterProjectEntries` (`client.js:2695-2698`) se aplica a Descubiertos (`:3082`) y a Gestionados
(`:3083`). Pulsar un chip vuelve a filtrar; volver a pulsarlo quita el filtro (`:2869`). La barra
expone `aria-pressed` y el texto de definición en el `title` (`:2867-2868`), y el conjunto incluye
«Quitar filtro» (`:2875`).

| # | Id | Etiqueta ES | Cuenta / predicado | Línea |
|---|---|---|---|---|
| 1 | `discovered` | descubiertos | entradas con `discoveredFlag` | `:2679` |
| 2 | `managed` | gestionados | entradas con registro gestionado | `:2681` |
| 3 | `available` | disponible | `availability === 'ok'` | `:2683` |
| 4 | `unavailable` | no disponible | `availability === 'missing-dir'` | `:2684` |
| 5 | `conflicts` | conflictos | entrada con conflicto | `:2685` |
| 6 | `partial` | inspección parcial | estado `partially-inspected` o inspección `incomplete` | `:2686` |
| 7 | `skills` | con skills detectadas | `skillStats.total > 0` | `:2687` |
| 8 | `own` | con skills propias | `skillStats.own > 0` | `:2688` |
| 9 | `external` | con skills externas | `skillStats.external > 0` | `:2689` |
| 10 | `unknown` | con skills de dueño desconocido | `skillStats.unknown > 0` | `:2690` |
| 11 | `collisions` | con colisiones | `entry.collisions.length > 0` | `:2691` |

**Hallazgo medido.** Los indicadores 1-6 usan `countWhere` sobre las entradas (`:2656-2662`), pero
7-11 usan recuentos **globales del inventario** (`:2663-2667`: total de skills, `skillCount(owner)`,
número de colisiones). El rótulo del chip pinta `summary[id]` (`:2859-2862`), así que para esos cinco
el número no es «cuántos proyectos cumplen el filtro» sino el total de skills/colisiones. El filtro sí
es por proyecto; el número no. No hay captura que lo demuestre (deducido del código).

## 2. Pestaña Descubiertos

Contenido: subtítulo «Descubrir no registra nada: sólo se puede abrir el workspace.»
(`projects.discover.subtitle`, `:186`), aviso de sólo lectura (`:194`), botón «Refrescar inventario»
(`:188`), estado de carga «Consultando el inventario…» (`:189`) y una tarjeta por workspace
(`ProjectCard`, `:2881-2995`).

Cada tarjeta muestra ruta, badges de disponibilidad (`:196-198`), sesiones (`:191`, con
`{n} sesiones` o «sesiones: no contado», `:307-308`), coincidencia legacy (`:193`) y el aviso de no
gestionado: **«Descubierto no está gestionado: abrirlo o inspeccionarlo no lo registra.»**
(`:332`). Acciones:

- **Abrir en DSH**: sólo se renderiza si `workspaceId != null` y el panel expone
  `uiWorkspace.openWorkspace` (`:2883-2886`); si falta, el botón queda deshabilitado con el motivo
  (`:345-346`) y no se llama a la API (`r16-ui.test.mjs:604-614`).
- **Inspeccionar skills**: abre la ficha en modo sólo lectura (`:344`, `:2921-2928`).
- **Gestionar proyecto**: abre el diálogo único de registro (`:342`, `:2929-2934`).

La tarjeta nunca registra por sí sola: registrar exige confirmar el diálogo
(`tests/r16-contract.test.mjs:133-148`).

## 3. Pestaña Gestionados y ficha

Gestionados lista los proyectos con registro y sus asignaciones (`:3183-3201`): contadores
«{n} activas / asignadas / entregas» (`:348-350`), nota «Encender una skill la asigna a este
proyecto; cambiar la versión mueve el pin.» (`:351`) y acciones «Trabajar en este proyecto» /
«Abrir ficha» (`:2935-2943`, `:2992`).

La ficha (`ProjectDetailDialog`, `:3248-3461`) tiene **seis secciones** renderizadas en
`:3448-3453`, en este orden: `summary`, `skills`, `origin`, `conflicts`, `activity`, `identity`.
Incluye las mismas acciones de abrir/inspeccionar/gestionar (`:3414-3430`). La identidad de la ficha
muestra `projectId`, UUID, hash del manifiesto y el estado `match`/`missing`/`mismatch`/
`not-recorded` (`projects.ficha.identity`, `:453-465`).

## 4. Pestaña Identidad (separada)

`IdentityView` (`:3023-3069`) mantiene la clasificación en pestaña propia, con subtítulo «Qué
identidad tiene cada carpeta: registro del centro, manifiesto en disco y si se pudo verificar.»
(`:167`), campos UUID / Carpeta / Verificación / Motivos (`:169-172`) y estado vacío «No hay carpetas
que clasificar todavía.» (`:168`).

Las acciones de identidad (`Publicar manifiesto`, `Reparar manifiesto`, `Revincular`, `Desvincular`,
`:174-177`) están **bloqueadas** mientras el almacén no migre a v3: `identity.available` falso deja el
aviso «Las acciones de identidad se activan al migrar el almacén a v3 (requiere autorización
humana).» (`:178`, render `:3066-3067`). La pestaña es de sólo lectura y lo dice: «Clasificar no
escribe: vincular, adoptar o mover son acciones humanas que llegan después.» (`:184`).

## 5. Diálogo único: prevalidación + confirmación

Un solo componente (`ProjectDialog`, `:3471-3618`) sirve para **descubiertos** («Gestionar
proyecto»/«+ Registrar proyecto») y para el botón superior «+ Registrar proyecto» (`:3156`). El
subtítulo fija la promesa: «Prevalidación de sólo lectura: no se escribe nada hasta que confirmes.»
(`:359`). Pasos: **Revisar** y **Confirmar** (`:360-361`), con selección de workspace
(`:3484-3521`) y revisión de identidad, coincidencias, skills, conflictos, cobertura y operaciones
(`:3523-3570`). En modo `manage` sólo se puede cerrar (`:3598-3599`).

`buildPreflight(view, dialog)` (`:2774-2798`) es una prevalidación **local** y de sólo lectura sobre
el payload ya cargado: calcula operaciones permitidas (`projectOperations`, `:2778`), bloqueos por
estado / ruta ausente / ya registrado (`:2780-2782`) y `canConfirm` (`:2796`). No sustituye al
preflight del servidor: la escritura la decide `POST /api/state` y puede volver `409`.

Envío (`confirmProjectRegister`, `:4941-4977`): guarda contra doble envío (`busy`, `:4943-4948`),
payload `{cwd, name?, projectId?}` (`:4957-4959`), `POST register-project` (`:4960`). Si va bien,
cierra, avisa y recarga (`:4961-4965`); si falla, **conserva el diálogo** y muestra
`{code, status, reasons, findings, sources}` (`:4967-4975`).

## 6. Estados: texto exacto

| Estado | Texto (ES) | Clave / línea |
|---|---|---|
| Sin proyectos | «Ningún proyecto registrado. El proyecto actual del harness aparece aquí al abrir el panel.» | `projects.empty` `:134` |
| Descubiertos vacío | «El Host no devolvió ningún workspace.» | `:190` |
| Sin descubiertos | «El Host no devolvió workspaces descubiertos.» | `:352` |
| Sin gestionados | «Todavía no hay proyectos gestionados. Registra o adopta uno desde Descubiertos.» | `:353` |
| Filtro sin resultados | «Ningún proyecto coincide con el filtro «{label}».» | `:354` |
| Inventario no disponible | «Inventario no disponible» | `:195` |
| Sin panel de workspaces | «Este harness no tiene el panel de workspaces cargado: no puedo abrirlo desde aquí.» | `:346` |
| Proyecto sin workspace | «Este proyecto no tiene un workspace de DSH vinculado: no hay nada que abrir.» | `:345` |
| Disponibilidad desconocida | «No se pudo comprobar la disponibilidad: el Host no informa si la carpeta existe.» | `:355` |
| Inventario parcial | «Inventario parcial: el Host no pudo confirmar todas las fuentes. Lo que falta no se cuenta.» | `:285` |
| Cobertura parcial | «Parcial: falta al menos una fuente; lo que no se pudo comprobar no se cuenta.» | `:384-385` |
| Inventario recortado | «Inventario recortado por el límite de entradas: los recuentos de skills pueden ser menores que la realidad.» | `:286` |
| Inventario heredado | «El Host todavía no publica /api/projects ({status}); se muestra el inventario antiguo de /workspaces. Los recuentos nuevos quedan sin comprobar.» | `:289` |
| Fallo de refresco | «No se pudo refrescar» | `:284` |
| Fallo de proyectos | «Falló la consulta de proyectos» | `:291` |
| Fallo de inventario | «Falló la consulta del inventario de skills» | `:292` |
| Error de operación | «La operación no se completó» + «código: {code}» | `:294-295` |
| Proyecto desaparecido | «Ese proyecto ya no existe en el registro» | `:296` |
| Registro bloqueado | «Registro bloqueado por la prevalidación» | `:299` |
| Evidencia incompleta | «No se escribió nada: la inspección no pudo completarse ({reason}).» | `:300` |

## 7. Carga, doble envío y 409

- **Carga**: «Consultando el inventario…» (`:189`), «Actualizando inventario…» (`:278`), «Abriendo…»
  (`:339`), «Inspeccionando…» (`:340`), «Registrando…» (`:398`). El botón de refresco se deshabilita
  mientras corre y no duplica la petición (`r16-ui.test.mjs:670-693`).
- **Anti doble envío**: los botones del diálogo llevan
  `disabled: busy || preflight.canConfirm !== true` (`:3604`, `:3611`) y el handler comprueba `busy`
  antes de enviar (`:4943-4948`).
- **409 con findings**: el diálogo no se cierra; muestra «Registro bloqueado por la prevalidación»
  (`:299`), los motivos del servidor (`:302`), los hallazgos (`:303`) y las fuentes consultadas
  (`:304`). Prueba: `tests/r16-ui.test.mjs:762-795`. El caso `evidence-incomplete` conserva las
  fuentes y no se presenta como éxito (`r16-ui.test.mjs:711-733`).

## 8. i18n ES/EN

`DICTIONARIES` (`client.js:31`), bloque `es` desde `:32`, bloque `en` desde `:734`, `translate`
`:1442`, registro `locale.register(NS, DICTIONARIES)` `:5539`. Medición con el patrón
`^\s+'[^']+':` sobre cada bloque: **672 claves ES y 672 EN**, sin claves exclusivas de un idioma.
La paridad es exacta, incluidos los textos de estado, error y diálogo.

## 9. Capturas antes

| Captura | Qué muestra |
|---|---|
| ![Antes · Descubiertos](r16-before-projects-discovered.png) | Pestaña «Descubiertos 7»: «+ Registrar proyecto», «Refrescar inventario», cuatro chips («7 descubiertos», «3 gestionados», «1 coincidencias legacy», «2 gestionados sin workspace») y siete filas con badge y «Abrir en DSH» |
| ![Antes · Gestionados](r16-before-projects-managed.png) | «Gestionados 3»: tarjetas `plugins-dhs`, `proyecto-b`, `proyecto-b-movido`, «N activas», «Trabajar en este proyecto», «Sincronizar disco», lista de skills con interruptores y selector de versión |
| ![Antes · Identidad](r16-before-projects-identity.png) | «Identidad 9»: badges `manifest-missing`/`unmanaged`, «UUID: sin UUID», «Motivos», «Carpeta: ok/missing-dir», «Verificación» y «Publicar manifiesto» en todas las filas |

Auxiliares en `_audit/r16-capture/`: `window-00.png` (ventana antes de abrir el panel),
`window-01-after-sidebar-click.png` (Resumen: 7 skills, 2 activaciones, 0 propuestas),
`identity-scroll1.png`, `identity-scroll2.png`, `discovered-pill-workspace-click.png`,
`discovered-pill-legacy-click.png`, `discovered-pill-nohover.png`, `registrar-modal.png`,
`registrar-toggle-close.png`.

## 10. Capturas después (banco de pruebas, no panel vivo)

**Procedencia.** Estas capturas **no** son el panel vivo: el GUI sigue sirviendo el bundle anterior y
reiniciar la aplicación es una acción humana (`_audit/INCIDENTE-2026-11-09-web-boot.md`). Son el
`client.js` real renderizado en `node:vm` con fixtures, es decir, la interfaz construida por este
código pero no servida aún por el Host. Se documentan como evidencia del rediseño, no como captura
del panel en producción.

| Fichero | Qué muestra | Bytes |
|---|---|---|
| ![Después · Descubiertos](r16-after-projects-discovered.png) | Descubiertos con la barra de indicadores, el chip activo y las tarjetas con «Abrir en DSH / Inspeccionar skills / Gestionar proyecto» y el aviso de no gestionado | 128710 |
| ![Después · Gestionados](r16-after-projects-managed.png) | Gestionados con tarjetas y contadores `activas`/`asignadas`/`entregas` | 112268 |
| ![Después · Ficha](r16-after-project-detail.png) | Ficha con las seis secciones: resumen, skills, procedencia, conflictos, actividad e identidad | 202760 |
| ![Después · Preflight](r16-after-preflight.png) | Diálogo único en el paso «Revisar» con identidad, cobertura y operaciones | 139336 |

También existen `_audit/r16-after-projects-1024.png` (87470 B) y
`_audit/r16-after-projects-1440.png` (128710 B), variantes de ancho.

### 10.1 Defecto de plural, detectado en captura

La captura de Gestionados (12:17:09) muestra **«1 entregas»**. La causa era la clave
`projects.counts.materialized: '{n} entregas'`, con forma plural fija, pintada con
`t('projects.counts.materialized', { n })` en tarjeta y ficha. El helper
`plural(lang, count, one, many)` ya existía pero no se usaba. Es un defecto de texto, no de conteo: el
número era correcto, la concordancia no.

**Arreglo, ya en el árbol (12:20:36).** La clave se partió en
`projects.counts.materialized.one: '{n} entrega'` (`client.js:350`) y
`projects.counts.materialized.many: '{n} entregas'` (`:351`); `materializedLabel`
(`client.js:1851-1858`) elige por `count` y se usa en la tarjeta (`:3001`) y en la ficha (`:3315`).
La regresión está en `tests/r16-ui.test.mjs:999-1073`, con los casos 0/1/N y la aserción explícita
`doesNotMatch(..., /1 entregas/)` (`:1057`, `:1065`). La captura es anterior al arreglo: acredita el
defecto encontrado, no el estado final; no se rehizo.

### 10.2 Aviso de coincidencias al gestionar un proyecto ya registrado

En el diálogo «Gestionar proyecto» abierto sobre un proyecto **ya registrado**, la sección
Coincidencias dice «Ninguna coincidencia: la ruta no está registrada.»
(`projects.dialog.matches.none`, `client.js:378`). La causa está en `dialogTarget`
(`client.js:2773`): el listado de coincidencias filtra `candidate !== entry`
(`client.js:2783`), es decir, excluye la propia entrada que se está gestionando; si no hay otro
registro con la misma ruta, la lista queda vacía y el texto afirma que la ruta no está registrada
aunque sí lo esté.

**Alcance**: es una inconsistencia de texto/estado del diálogo, no un fallo de registro.
«Gestionar proyecto» se ofrece en las tarjetas de **Descubiertos**; un proyecto gestionado ofrece
«Abrir ficha» (`client.js:2992`), así que el flujo real no recorre este estado. Queda documentado
porque la captura lo alcanza al abrir el diálogo sobre un gestionado, y porque el texto es engañoso si
se llega por esa vía.

## 11. Control antes → comportamiento antes → comportamiento ahora → prueba

| Control | Antes | Ahora | Prueba |
|---|---|---|---|
| Pestañas Descubiertos/Gestionados/Identidad | Contador en la etiqueta, sin cambiar el conjunto mostrado | Pestañas separadas; el contador se calcula por entrada (`:3102-3107`, `:3162-3166`) | `tests/r16-ui.test.mjs:555-567`, `:807-827` |
| Chips de recuento | Sólo pintaban borde de selección; la lista seguía con las 7 filas | 11 chips con predicado por proyecto; filtran de verdad y exponen `aria-pressed` (`:2678-2698`, `:3082-3083`) | `tests/r16-ui.test.mjs:569-587` |
| «Abrir en DSH» | Presente en todas las filas | Sólo con `workspaceId` y panel cargado; si no, deshabilitado con motivo y sin llamada | `tests/r16-ui.test.mjs:589-614` |
| «Publicar manifiesto» | Ofrecido incluso con «Carpeta: missing-dir» y pie que decía que llegaría con v3 | Acciones de identidad bloqueadas hasta v3, con el aviso de autorización humana (`:178`, `:3066-3067`) | Texto en `client.js`; sin captura después (no verificado) |
| «Registrar» | Botón atenuado con campo vacío, sin explicación | Diálogo único con prevalidación, cobertura y `canConfirm`; nada se envía sin confirmar | `tests/r16-ui.test.mjs:735-760`, `:797-804` |
| Registro de un proyecto | No existía como operación de UI | «+ Registrar proyecto» y «Gestionar proyecto» abren el mismo diálogo; un `POST register-project` al confirmar | `tests/r16-ui.test.mjs:735-760`; `tests/r16-contract.test.mjs:150-169` |
| Ficha del proyecto | No había ficha | Seis secciones en `ProjectDetailDialog` (`:3448-3453`) | `tests/r16-ui.test.mjs:807-827` |
| Aviso de no gestionado | No existía | «Descubierto no está gestionado: abrirlo o inspeccionarlo no lo registra.» (`:332`) | `tests/r16-ui.test.mjs:569-587` |
| Inventario parcial/truncado | No se distinguía | Barra de estado con parcial, recortado y desactualizado (`:285-287`) | `tests/r16-ui.test.mjs:649-669` |
| Error de API | Podía leerse como éxito | 503 y 409 se muestran con código y fuentes; un fallo de catálogo no produce éxito | `tests/r16-ui.test.mjs:616-628`, `:711-733`; `tests/r16-security.test.mjs:230-256` |

## 12. Riesgos y límites de esta capa

1. **«Inspeccionar skills» no tiene backend real.** El cliente llama `POST inspect-project`
   (`:4889-4908`), pero `runAction` no tiene esa rama: cae en `unknown-action` con HTTP 200
   (`lib/api.mjs:3212-3213`, `:722-724`). El mock de `r16-ui.test.mjs:423` responde 200 con un
   `ProjectDetail`, así que la UI se prueba verde contra un contrato que el Host no cumple. En uso
   real la ficha se abre con datos del payload, no de una inspección nueva.
2. **Cinco contadores no cuentan proyectos.** El número de los chips `skills/own/external/unknown/
   collisions` es global (`:2663-2667`) y el filtro es por proyecto (`:2687-2691`): el rótulo puede
   decir «19 con skills propias» y dejar 3 tarjetas.
3. **`inspect.readonly` y el estado «no disponible»** dependen del payload de `/api/projects`; si el
   Host devuelve `503` se muestra el error, no una lista vacía (`r16-ui.test.mjs:616-628`).
4. **Las capturas después no son el panel vivo**: el bundle servido por el GUI es el anterior y
   reiniciar la app es acción humana. La evidencia visual es del `client.js` actual en un banco
   `node:vm` con fixtures, no del Host en ejecución (ver §10).
5. **Concordancia de plural**: corregida en el árbol a las 12:20:36 con la prueba
   `tests/r16-ui.test.mjs:999-1073`. La captura de las 12:17:09 es anterior y conserva «1 entregas»:
   no se rehízo, así que no acredita el estado final.
