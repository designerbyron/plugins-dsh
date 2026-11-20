# 03 — K1-B · Interfaz Project-Aware y presentación de datos controlados

**Clase:** `CLIENT` + `TESTING` · **Etapa:** K1-B
**Contrato de referencia:** `docs/PA-UI-0-API-CONTRACT.md` · `pa-ui/0.1.0-draft` (revisión 3), SHA-256 `93422431…c68a`
**Precondición:** K1-A cerrado (módulo cargado y montado) · **Datos:** fixtures sintéticos, nunca el almacén real
**No implementa nada en K1.**

---

## 1. Objetivo

Construir la interfaz que permite a una persona, dentro del anfitrión: ver el proyecto activo de su
sesión y su estado de autorización, ver las bibliotecas concedidas, listar y abrir fuentes del proyecto,
buscar sobre los ámbitos efectivos, ver el contexto con sus citas y entender los errores de acceso — todo
ello **con datos controlados**, mostrando sin adornos lo que el backend todavía no expone.

## 2. Alcance

Dentro: panel y vistas, adaptador de datos con fixtures, estados obligatorios, accesibilidad, responsive,
pruebas de interfaz y de higiene de fixtures.

Fuera: la API real, cualquier escritura distinta de la selección de proyecto, la auditoría `ui.read`, el
almacén legado, el contrato (no se rediseña), las siete herramientas.

## 3. Tabla vista ↔ ruta contractual

Correspondencia obligatoria. Si una vista pedida no tiene ruta, se declara; no se inventa.

| # | Vista | Ruta contractual | Campos que se pueden mostrar | Carencias que hay que declarar en la vista |
|---|---|---|---|---|
| 1 | Resumen del proyecto | `GET /session` (+ `GET /projects` para el actual) | `session.state`, `invalidReason`, `selection.state/projectName/source/revision`, `scopes[]`, `scopeCount`, `service.status` | `selection.projectName` se resuelve con `getProject`; `service.status` es propuesto |
| 2 | Selector de proyecto | `GET /projects` + `POST /selection` | `projects[].{id,name,current,rootCount}`, `cwdKnown` | `expectedRevision` **no existe** hoy en `registerSelection` (GAP-09): sin él no hay `409` real |
| 3 | Bibliotecas autorizadas | `GET /libraries` | `id`, `name`, `permission`, `grantedAt`, `grantedBy`, `store`, `roots`, `effectiveScopes` | **Sólo lectura**: no hay ruta de concesión/revocación desde la UI |
| 4 | Explorador de fuentes | `GET /sources?limit&offset&collection&tag` | `total`, `limit`, `offset`, `rows[].{id,uri,title,collection,bytes,chunks,updatedAt,indexedAt,mime}` | `mime`/`indexedAt` son derivables (no proyectados hoy) |
| 5 | Detalle de documento | `GET /sources/:id` | `source` completa, `chunks[].{ordinal,heading,charStart,charEnd,tokenEst,text}`, `chunksTotal` | **GAP-05/GAP-16**: no hay helper de fragmentos paginados; sin él, `chunks` no pagina |
| 6 | Búsqueda semántica | `POST /search` | `mode`, `elapsedMs`, `results[]`, `scopes[]` | `limit` máx. 50; sin paginación (D-UI-06) |
| 7 | Resultados con procedencia | `POST /search` (mismos datos) | `scopeId`, `scopeKind`, `scopeName`, `uri`, `title`, `heading`, `ordinal`, `rrf`, `snippet` | La procedencia la añade la API visual; la herramienta la proyecta fuera |
| 8 | Vista de contexto | `POST /context` | `text`, `citations` (9 campos v0.1), `tokens`, `truncated`, `considered`, `scopes`, `elapsedMs` | Si un almacén falla: fail-closed, sin contexto parcial |
| 9 | Estado de indexación | `GET /diagnostics` | `scopes[].store`, `integrity.{registry,stores,auditHead}`, `versions`, `health.checks` | **GAP-06**: no hay composición multi-ámbito; **GAP-10**: no hay detalle por embedding; última sincronización no se expone |
| 10 | Historial de operaciones | **ninguna** | — | El contrato no expone listado de auditoría. La vista se pinta como **no disponible** con la causa, no con una tabla vacía |

## 4. Especificación por vista

### V1 · Resumen del proyecto
Franja de estado (`ok`/`degraded`) con la causa en una línea; proyecto activo y **de dónde salió** la
selección (`explicit` / `cwd`); número de ámbitos y su clase; estado del registro y de la raíz de
almacenes. Si `selection.state` es `unresolvable` o `ambiguous`, se explica la acción concreta
(«elige un proyecto»), no un error genérico.

### V2 · Selector de proyecto
Lista **sólo** de candidatos (`projects[]`); el actual marcado; `cwdKnown` visible. La selección se envía
con `expectedRevision` leído de `GET /session`; un `409 revision-conflict` se muestra tal cual y **no se
reintenta solo**. Mientras GAP-09 no esté implementado, la vista declara: «la selección aún no protege
contra dos pestañas». No se auto-selecciona nada.

### V3 · Bibliotecas autorizadas
Sólo grants abiertos de bibliotecas activas. Una biblioteca revocada **desaparece**; la revocación se
explica en V1 (`invalidReason`). El estado de almacén (`present`/`missing`/`corrupt`) se muestra como
dato, no como alarma. Sin botones de concesión: no existen.

### V4 · Explorador de fuentes
Tabla paginada en servidor (50 por defecto, máximo 200). `total` siempre visible; paginación por
`offset`. Filtros: colección, etiqueta, texto sobre título/URI (nunca sobre contenido). Estado vacío con
la acción que lo resuelve (ingerir desde la herramienta, no desde aquí).

### V5 · Detalle de documento
Cabecera con `uri`, `title`, `mime`, `bytes`, `charCount`, `sha256` (8 caracteres + copiar),
`indexedAt`. Fragmentos con ordinal, encabezado, offsets y texto recortado al límite del contrato
(1 200 caracteres). Si `chunksTotal > chunks.length`, se dice: «se muestran N de M; esta versión no pagina
fragmentos» (GAP-05/GAP-16). Nunca se presenta el recorte como si fuera el documento completo.

### V6 · Búsqueda semántica
Campo de consulta (≤512 caracteres, sin recorte silencioso), `limit` (8 por defecto, 50 máximo),
`mode` y `elapsedMs` visibles. Estados: sin resultados (con explicación), error de motor (código +
reintentar), índice vectorial incompleto (`vector-index-incomplete`) tratado como estado del motor, no
como fallo de red.

### V7 · Resultados con procedencia
Cada fila: ámbito (`scopeKind` + `scopeName`), título, encabezado, ordinal, snippet, `rrf`. Dos filas de
ámbitos distintos con la misma `uri` **no se fusionan**. La procedencia se pinta como texto, nunca como
color solo.

### V8 · Vista de contexto
Texto que se serviría al modelo, `tokens` (estimación, etiquetada como tal), `truncated`, `considered`,
citas numeradas `[n]` con sus 9 campos. Si un ámbito concedido falla: banner de fallo cerrado y **sin**
contexto parcial. El botón «ver fragmento» abre V5 en el `charStart..charEnd` de la cita.

### V9 · Estado de indexación
Por ámbito: `kind`, `id`, `name`, `store`, `verified`. Integridad: registro, almacenes, cabeza de
auditoría (número de secuencia, no contenido). Versiones: plugin, contrato, api, host. Se declara lo que
no hay: sin última sincronización, sin métricas por embedding (GAP-10), sin composición multi-ámbito
completa (GAP-06).

### V10 · Historial de operaciones
Estado **no disponible** con la causa exacta («el contrato `pa-ui/0.1.0-draft` no expone listado de
auditoría; `/diagnostics` sólo devuelve la cabeza de la cadena»). Enlaza a V9. No se pinta una tabla
vacía ni se leen eventos del almacén por otra vía.

## 5. Limitaciones que deben quedar visibles

| GAP | Cómo se ve en la interfaz | Dónde |
|---|---|---|
| GAP-05 · fragmentos sin paginar | «se muestran N de M; sin paginación de fragmentos en esta versión» | V5 |
| GAP-06 · diagnóstico multi-ámbito | «el diagnóstico se compone por ámbito; la vista global está limitada» | V9 |
| GAP-07 · auditoría de lecturas | «las lecturas del panel aún no se auditan» (visible, sin dramatizar) | V9 / pie del panel |
| GAP-09 · concurrencia optimista | «la selección no protege contra dos pestañas» | V2 |
| GAP-10 · estado detallado de embeddings | «sin detalle por embedding; cobertura global únicamente» | V9 |

Regla: una limitación se muestra **en la vista donde importa**, con una frase que diga qué falta y qué
consecuencia tiene. No se esconde en un «Acerca de».

## 6. Mecanismo de fixtures

- `DATA_MODE = 'fixture'`: el adaptador devuelve objetos **congelados** con la forma exacta de §6 del
  contrato (mismos nombres de campo, mismos enums).
- Los fixtures viven en `tests/fixtures/ui/` (a crear en K1-B, no en K1) y se cargan en el cliente como
  módulo local; **no** se sirven por HTTP.
- Ids sintéticos con prefijo `k1fx`: `prj_k1fx_01`, `lib_k1fx_01`, `src_k1fx_0001`. Ningún id con forma
  ULID (`^prj_[0-9A-HJKMNP-TV-Z]{26}$`), que es la de los ids reales.
- Cero rutas absolutas, cero `C:\Users\…`, cero `.dsh`, cero URIs de documentos reales, cero cookies,
  cero tokens, cero JWT.
- El panel muestra la banda «Datos sintéticos · sin acceso al almacén» mientras `DATA_MODE === 'fixture'`.
- Prueba de higiene obligatoria (§ `05`, UI-13): escanear fixtures y cliente contra una lista de
  patrones prohibidos y fallar si aparece uno.

## 7. Estados obligatorios por vista

Tomados de `docs/WORKSPACE-UX.md` §4, sin inventar:

| Estado | Tratamiento |
|---|---|
| Cargando | esqueleto con la forma del contenido, sin spinner a pantalla completa |
| Vacío | qué falta y la acción concreta que lo resuelve |
| Error de red | tarjeta con código y «Reintentar»; no se pierde el último dato bueno |
| Error del motor | código del catálogo §7 + mensaje seguro; acciones peligrosas deshabilitadas |
| Datos parciales | banda «datos de hace X» con el instante de la última lectura correcta |
| Sin permiso | la sección se muestra; las acciones se explican y quedan deshabilitadas |
| Degradado | estado global ámbar con causa |

## 8. Ciclo de vida y frescura

- La señal de panel activo es `usePanelInfo(info => info.activePanelId === 'lifecode-rag')`, **no**
  `document.visibilityState` (que sólo distingue ventana oculta).
- Polling: **cero** si el panel no está activo o la ventana está oculta; mínimo 30 s cuando lo está.
- Un refresco inmediato al volver a activarse, deduplicado si ya hay uno en vuelo (`AbortController` +
  bandera `inFlight`).
- Cambiar de sección no repite peticiones con datos frescos (<15 s).
- En K1-B (fixtures) no hay polling en absoluto: no hay nada que refrescar. El ciclo de vida se
  implementa igual para que la conexión a la API futura no cambie la estructura.

## 9. Accesibilidad y responsive

- Navegación por teclado completa, foco visible en cada control.
- Pestañas con `role="tablist"`, `aria-selected`, flechas izquierda/derecha.
- Tablas con `caption` y `th scope="col"`; cifras con unidad y contexto.
- **Una sola región viva** por vista (`role="status"`, `aria-atomic="true"`, `aria-live="polite"`); los
  errores se asocian al control con `aria-describedby`, no sólo con un toast.
- Contraste por tokens del anfitrión; acento sólo en marca/estado.
- `prefers-reduced-motion` y `forced-colors` (bordes `CanvasText`, fondo `Canvas`).
- 390 px: `max-width: 100%`, `min-width: 0`, `overflow-wrap: anywhere`; un id largo se parte.

## 10. Archivos que probablemente deberán modificarse

| Archivo | Acción |
|---|---|
| `lifecode-rag/client.js` | vistas, adaptador, estados (crece; considerar partir en `lib/` puro y el cliente como vista) |
| `lifecode-rag/tests/fixtures/ui/*.json` | crear |
| `lifecode-rag/tests/client.test.mjs` | ampliar (higiene de fixtures, estados, a11y estática) |
| `lifecode-rag/docs/WORKSPACE-UX.md` | **no** modificar; si algo cambia, documento nuevo en la carpeta K1 |

Si el cliente crece por encima de ~1 500 líneas, la separación recomendada es: `lib/ui-model.mjs`
(funciones puras de presentación, probables con `node --test`) + `client.js` (sólo React y slots). Eso
respeta «núcleo puro, adaptador fino» sin añadir dependencias.

## 11. Archivos que deben permanecer intactos

`docs/PA-UI-0-API-CONTRACT.md`, `docs/PA-UI-0-ACCEPTANCE.md`, `docs/PA-UI-0-GAPS.md`,
`docs/PA-UI-0.4-ROUTE-B-EVALUATION.md`, `docs/CONTRATO-v0.1.md`, `lib/tools.mjs`, `lib/exec-context.mjs`,
`index.js`, el esquema SQLite, `lifecode-skill-center/**`, `skill-compiler/**`, el perfil del host.

## 12. Secuencia de tareas

| Id | Clase | Tarea |
|---|---|---|
| K1-B-01 | `DOCUMENTATION` | Congelar la tabla §3 y las frases de limitación (§5) |
| K1-B-02 | `CLIENT` | Adaptador con `DATA_MODE`, fixtures congelados y banda de modo |
| K1-B-03 | `CLIENT` | V1-V5 |
| K1-B-04 | `CLIENT` | V6-V8 |
| K1-B-05 | `CLIENT` | V9-V10 con las limitaciones declaradas |
| K1-B-06 | `CLIENT` | Estados obligatorios, `usePanelInfo`, a11y, 390 px |
| K1-B-07 | `TESTING` | Pruebas UI-01…UI-14 y de higiene |

## 13. Pruebas

**Unitarias (modelo puro):** paginación (`offset`/`total`), recorte de fragmentos, procedencia por
ámbito, mapeo de códigos de error a mensajes seguros, ningún cero inventado cuando el dato es `null`.

**De interfaz (con fixtures):** navegación entre las diez vistas; cada estado obligatorio; `409` de
selección sin reintento automático; resultados paginados; procedencia visible; sin datos reales.

**En el anfitrión:** montaje y desmontaje (heredado de K1-A), cambio de panel (cero polling), 390 px,
teclado, `forced-colors`.

Matriz completa en `05 — K1-TEST-AND-ACCEPTANCE.md` (UI-01…UI-14).

## 14. Riesgos

| Id | Riesgo | Control |
|---|---|---|
| R-B-01 | Se pinta una vista como operativa sin ruta que la sostenga | tabla §3 + V10 no disponible |
| R-B-02 | Los fixtures arrastran datos reales | prueba de higiene UI-13 |
| R-B-03 | El panel hace polling invisible y multiplica futuras filas `ui.read` | `usePanelInfo` + cero polling en fixtures |
| R-B-04 | Se escribe auditoría desde el panel para «cumplir» GAP-07 | K1-B no escribe auditoría; `ui.read` es K1-C |
| R-B-05 | Un cero se lee como dato medido | `null` → «sin datos», nunca `0` |
| R-B-06 | El cliente crece sin pruebas unitarias | separación `lib/ui-model.mjs` si supera ~1 500 líneas |

## 15. Criterios de aceptación de K1-B

| Id | Criterio |
|---|---|
| B-1 | Se navega entre las diez vistas sin recargar el panel |
| B-2 | Cada vista tiene estados de carga, vacío y error |
| B-3 | Los resultados paginan con `total`/`limit`/`offset` correctos |
| B-4 | La procedencia (`scopeId`/`scopeKind`/`scopeName`) es visible y no se fusiona |
| B-5 | Accesibilidad básica: teclado, roles, una región viva, contraste por token |
| B-6 | 390 px sin desbordamiento horizontal |
| B-7 | Los fixtures no contienen datos privados reales |
| B-8 | Las cinco limitaciones (GAP-05/06/07/09/10) son visibles donde importan |
| B-9 | V10 se muestra como no disponible, con causa |
| B-10 | Ninguna petición sale del cliente en modo fixture |

## 16. Evidencias

Capturas por vista (claro/oscuro si aplica, y 390 px), matriz de estados con una fila por vista, salida
del escaneo de fixtures, y el conteo DOM de montaje/desmontaje. Todo con hash del `client.js` usado.

## 17. Condiciones de parada

- Una vista exige una ruta que el contrato no tiene (se detiene y se pregunta; no se inventa).
- Un fixture necesita un dato real para verse bien.
- El panel exige escribir auditoría o tocar el registro.
- La accesibilidad obliga a cambiar tokens del anfitrión (no se tocan).

## 18. Autorización humana

| Acto | Autorización |
|---|---|
| Reescribir `client.js` con las diez vistas | explícita, con el alcance de §10 |
| Decidir sobre V10 (historial) y V3 (selector) | previa, `07` Q-02/Q-03 |
| Cualquier conexión a la API real | **no** autorizada |

---

**Estado final esperado de K1-B:** `UI PROJECT-AWARE (fixtures)` — todas las vistas navegables con datos
sintéticos, limitaciones visibles, **cero** acceso a almacenes. PA01 sigue `BLOCKED`.
