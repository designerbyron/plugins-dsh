# T42 — Avisos en el chat: el camino Host→cliente que ya existe

Fecha: 2026-11-09. Autor: `architect-contract` (task-44). Objetivo: documentar con evidencia
el mecanismo por el que una operación de LifeCode aparece como aviso dentro de la conversación,
sin polling y sin canal nuevo, y fijar el mapa operación→evento→toast con sus textos.

Fuente principal: código ya implementado en `lifecode-skill-center/client.js` (8965 líneas
en la instantánea), `lib/tools.mjs`, `lib/activity.mjs`, y el catálogo de slots del Host en
`_audit/t42-arch/extracted/`. El árbol está en movimiento: las líneas citadas son de la
instantánea de esta fecha.

## 0. Resumen

1. Hay **dos puntos de enganche oficiales**: el slot global `shell.overlay` (pila de avisos) y
   el slot de sesión `conversation.session.header.actions` (para saber qué sesión está abierta).
2. El **transporte ya existe**: el servicio de cliente `sessions` expone por sesión un
   `eventSource` observable con los eventos del Host, incluidos `tool/call` y `tool/result`.
   Suscribirse no abre socket, ni petición, ni fuente: lee el stream que el navegador ya recibe.
3. La actividad viaja **dentro del propio `tool/result`** (9 claves) y se pinta sólo si
   `persisted === true`; un `replayed` nunca se anuncia como hecho.
4. **No hay polling**: cero `setInterval`; los únicos timers son las caducidades de cada aviso
   (`client.js` L6560-6564 lo declara y L6977-6984 lo implementa).
5. **No hay notificaciones del sistema operativo** ni push con el Harness cerrado: si la ventana
   no está abierta, no hay aviso. El texto de la interfaz lo dice literalmente (L991/L2004).

## 1. Punto de enganche A — `shell.overlay`

`dsh-client-ui-layout/lib/client.js` L705-736 registra el árbol raíz:

```js
ctx.slots.register({ name:"root", locale:"common", children:{
  "sidebar":{kind:"single",scope:"root"}, "main":{kind:"keyed",scope:"root"},
  "rightbar":{kind:"single",scope:"root"}, "shell.bottom":{kind:"single",scope:"root"},
  "shell.overlay":{kind:"list",scope:"root"}, "shell.leading":{kind:"single",scope:"root"} }, …}, AppFrame)
```

L725-728 declara `shell.overlay` como **lista de scope raíz** (varios ocupantes conviven);
L346 lo pinta con `renderSlot("shell.overlay", {})` y L403 marca `data-shell-overlay` en el
contenedor. Es una capa flotante de marco completo, por encima de las columnas y fuera de sus
contenedores con scroll; los ocupantes la atraviesan al hacer clic fuera de sus tarjetas.

El plugin inyecta su pila ahí, no dentro del panel (`client.js` L8923-8928):

```js
ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
  name: OVERLAY_SLOT, id: `${PANEL_ID}.toasts`, order: 60, locale: NS }, ToastOverlayHost));
```

Constantes: `OVERLAY_SLOT='shell.overlay'` (L6952); `ToastOverlayHost` L7160-7185.

## 2. Punto de enganche B — `conversation.session.header.actions`

`dsh-client-ui-conversation/lib/client.js` L22916-22947 registra la cabecera de sesión; el slot
que nos interesa es L22924-22927, **`{kind:"list", scope:"session"}`**. Se pinta en L20895
(`renderSlot("conversation.session.header.actions", {})`). Al ser de scope `session`, sus
ocupantes reciben el `sessionId` de la sesión visible.

El plugin no pinta nada ahí: registra un **probe mudo** (`client.js` L8931-8937,
`SessionToastProbe` L7295-7301) que recibe `sessionId` y lo entrega al puente
(`onSession: id => sessionBridge.connect(id)`). Así no depende de `standardProps` ni de
suposiciones sobre el layout: el slot le dice qué sesión está delante.

## 3. El stream de la sesión

`dsh-api-session-controller/lib/types/client/sessions/service.js`:

- `get binding()` L107-110 y `binding(id) { return this.scopes.get(id)?.binding; }` L412-413.
- El binding se construye en L478: `{ sessionId: id, session, eventSource: session.eventSource, ctx }`.
- El `eventSource` es un `ObservableSnapshot<SessionEventWindow>`: `{entries, hasMore, revision, change}`
  con `change.kind` y `change.entries` (documentado en `_audit/t42-arch/HOST-CLIENT-PATH.md`,
  §2, y ejercitado abajo).

Eventos relevantes: `_audit/t42-arch/extracted/dsh-session/lib/types/known-event-types.js`
L21 `KNOWN_SESSION_EVENT_TYPES`, con `'tool/call'` en L74 y `'tool/result'` en L77.

No se abre nada: el puente sólo hace `ctx.get('sessions')`, `binding(id).eventSource`, y
`getSnapshot()` + `subscribe()` (L7256-7290).

## 4. Nuestro puente, paso a paso

`createSessionActivityBridge(ctx)` en `client.js` L7186-7292:

| Paso | Línea | Qué hace |
|---|---|---|
| `tool/call` | L7234-7241 | Guarda `callId → name` **sólo** si el nombre empieza por `lifecode_`; si no, olvida el callId. |
| `tool/result` | L7243-7251 | Deriva `callId` de `message.toolCallId`, `message.source.callId` o `data.callId`; si no está en el mapa, ignora. |
| Extracción | L7214-7230 | `data.meta.activity` → `data.activity` → `data.result.activity` → `data.message.activity` → bloque de texto JSON con `activity` o con `{eventId,persisted}`. |
| Dedupe | L7204-7212 | `seen` (máx. `SEEN_SESSION_MAX=200`, L6953) por `eventId`; si ya se vio, no se pinta. |
| Pintado | L7251 | `toastStore.pushActivity(activity, activity.replayed === true || data.replayed === true)`. |
| Suscripción | L7253-7290 | Busca sesión, `binding`, `getSnapshot().revision`, `subscribe()`; sólo acepta revisión secuencial (`next === prev+1`) y `change.kind === 'append'`; itera `change.entries` y procesa `entry.type==='event' ? entry.event : entry`. |
| Cambio de sesión | L7253-7259 | Si llega otro `sessionId`, `stop()` y reconecta; un `sessionId` vacío corta. |
| Cierre | L7194-7203, 8939-8944 | `unsubscribe`, limpieza de mapas y `dispose()` en `ctx.effect`. |

## 5. Contrato de `activity` en el `tool/result`

`lib/tools.mjs` L64-84 lo fija: **9 claves exactas** —`eventId`, `type`, `category`,
`severity`, `titleKey`, `titleVars`, `persisted`, `replayed`, `at`— y se omite si la mutación no
dejó evento (idempotente o bloqueada). Reglas:

- `persisted: projection.persisted === true && result.replayed !== true` (L80).
- `replayed: result.replayed === true` (L81).
- Sólo tres herramientas lo exponen: `lifecode_skill_create` (L173), `lifecode_skill_improve`
  (L274) y `lifecode_skill_insight` (L390). `search` y `status` son de lectura y no lo llevan.

## 6. Deduplicación: `eventId`, `replayed` y `operationId`

1. **`eventId`** es la clave. Tres capas: el `seen` del puente (L7204-7212), el almacén de
   avisos (`push` L6996-6999 devuelve el id existente si ya hay uno con ese `eventId`) y la marca
   persistida de leído (`pushActivity` L7075-7080 escribe en `localStorage`).
2. **`replayed`**: `pushActivity` retorna sin pintar si `replayed === true` (L7058), y
   `activityOf` degrada `persisted` a `false` en un replay (tools.mjs L80-81). Un replay no
   produce aviso ni marca como hecho algo que no se escribió.
3. **`operationId` no participa**: no está entre las 9 claves y el puente no lo lee. La
   idempotencia real se garantiza en el núcleo (`operationId` en `state.operations`, y
   `replayed` en la respuesta); el aviso se apoya en `eventId`. Si se quisiera dedupe por
   operación habría que **añadir la clave** al contrato — hoy no existe.
4. **`correlationId`** no deduplica pero agrupa: el almacén fusiona avisos con el mismo
   `correlationId`, suma `count` y referencias (L7011, L7022-7036).

## 7. Mapa operación → evento → aviso (nueve clases)

Textos tomados literalmente de los diccionarios: ES `client.js` L947-979, EN L1960-1992.
Categorías L941-945; duraciones L6567 (`success/info` 6000 ms, `warning` 8000 ms, `error`
persistente L7019); máximo visible 3 (L6566).

| # | Operación | Evento (`type`) | Categoría / severidad | `titleKey` | ES | EN |
|---|---|---|---|---|---|---|
| 1 | Crear skill | `skill.created` | create / success | `activity.title.skill-created` | «Skill «{skill}» creada» | “Skill “{skill}” created” |
| 2 | Importar paquete | `skill-imported` | create / success | `activity.title.skill-imported` | «Skill «{skill}» importada» | “Skill “{skill}” imported” |
| 3 | Publicar versión | `skill.version` | update / success | `activity.title.skill-version-saved` | «Guardada la versión {version} de «{skill}»» | “Saved version {version} of “{skill}”” |
| 4 | Asignar / desasignar | `skill.assigned` / `skill.unassigned` | update / success | `activity.title.skill-assigned` / `skill-unassigned` | «Skill «{skill}» asignada» / «desasignada» | “Skill “{skill}” assigned” / unassigned |
| 5 | Proponer mejora (tool) | `improvement.proposed` | improvement / warning | `activity.title.improvement-prepared` | «Mejora preparada para «{skill}»» | “Improvement prepared for “{skill}”” |
| 6 | Aprobar / aplicar mejora | `skill.applied` | improvement / success | `activity.title.self-improvement-completed` | «Self-improvement completado: {change}» | “Self-improvement completed: {change}” |
| 7 | Incorporar conocimiento | `insight-*` | references / success | `activity.title.knowledge-incorporated` | «Conocimiento incorporado a «{skill}»» | “Knowledge incorporated into “{skill}”” |
| 8 | Cambio detectado fuera del centro | `project.*` / detección externa | alert / warning | `activity.title.change-detected` | «Cambio detectado en {origin}» | “Change detected in {origin}” |
| 9 | Rechazo, reversión o bloqueo | `improvement.rejected`, `skill.rollback`, conflictos | alert / warning·error | `activity.title.improvement-rejected`, `change-reverted`, `write-rejected`, `evaluation-blocking`, `conflict-blocking`, `persistence-failed` | «Mejora rechazada para «{skill}»»; «Cambio revertido en «{skill}»»; «Escritura rechazada en «{skill}»»; «La compuerta de calidad bloqueó «{skill}»»; «Conflicto bloqueante en «{skill}»»; «No se pudo conservar el cambio de «{skill}»» | “Improvement rejected for “{skill}””; “Change reverted in “{skill}””; “Write rejected in “{skill}””; “The quality gate blocked “{skill}””; “Blocking conflict in “{skill}””; “The change to “{skill}” could not be preserved” |

Alertas adicionales ya traducidas: `approval-pending` («Pendiente de aprobación: «{skill}»»),
`identity-conflict` («Conflicto de identidad en «{skill}»»), `references-unverified`
(«Referencias de «{skill}» sin verificar»), `source-unavailable` («Fuente no disponible: {origin}»).

## 8. Textos y tonos

- Categorías: `create` «Creación», `update` «Actualización», `improvement` «Mejora del propio
  centro», `references` «Cambio de referencias», `alert` «Alerta» (L941-945).
- Severidad→tono del aviso: `success`/`info`/`warning`/`error`; `error` es persistente y no
  caduca (L7019).
- Accesibilidad: `ToastCard` usa `role="alert"` **sólo** para `error` y `role="status"` para
  el resto (L6882-6885); la pila declara `aria-live="polite"` (L6930-6933); el indicador usa
  `role="status"` + `aria-live="polite"` (L7327-7329).
- Límite del canal, literal y ya en el producto: ES L991 «Avisos externos no disponibles: el
  Host no expone un canal de notificación; la actividad se muestra dentro del panel.»; EN
  L2004 «External alerts unavailable: the Host exposes no notification channel; activity is
  shown inside the panel.»

## 9. Lo que este mecanismo NO puede hacer

1. **Sin notificaciones del SO**: no hay API del Host para ello; el aviso vive en el DOM.
2. **Sin push con el Harness cerrado**: si no hay página, no hay `eventSource` ni pila.
3. **Sin canal de notificación del Host para plugins**: el `Notifier` del session-controller es
   interno (batchea su propio snapshot para sus listeners); no es un bus público.
4. **Sólo operaciones con herramienta**: el puente ignora `tool/result` cuyo `callId` no venga
   de un `tool/call` con nombre `lifecode_*` (L7239). Las acciones del panel no pasan por el
   stream: usan la respuesta HTTP (`toastFromActivity(result.activity, result.replayed)`,
   L8327).
5. **Ventana observable acotada**: el `eventSource` entrega una `SessionEventWindow` con
   `hasMore`; sólo se procesa `change.kind === 'append'` y revisión secuencial (L7276-7283).
   Un salto de revisión (reconexión, compactación) no se reproduce: se pierde el aviso, no se
   duplica.
6. **Un solo `persisted`**: si el estado no se pudo escribir, no hay aviso de éxito (L7057).

## 10. Lo no verificado / riesgos

- El catálogo vivo de slots no se pudo re-medir con `cordis_inspect` (timeout de 10 s); las
  definiciones se citan del bundle extraído y de `_audit/t42-arch/HOST-CLIENT-PATH.md`.
- El árbol cambia en paralelo (task-36 edita `distribute.mjs`/`api.mjs`; task-37/29 editan
  `client.js`): las líneas citadas valen para la instantánea de esta fecha.
- `change.entries` se trata como unión `{type:'event'}`/`{type:'transient'}`; si el Host
  añadiera otra forma, el puente la ignora silenciosamente (no rompe).
- No hay prueba de que el `eventSource` sobreviva a un cambio de vista sin `binding`: el puente
  reconecta en cada `sessionId` recibido y limpia al cambiar.

## 11. Reproducción

```powershell
# slots del Host (extraídos del asar)
Select-String -Path _audit\t42-arch\extracted\dsh-client-ui-layout\lib\client.js -Pattern 'shell.overlay'
Select-String -Path _audit\t42-arch\extracted\dsh-client-ui-conversation\lib\client.js -Pattern 'conversation.session.header.actions'
Select-String -Path _audit\t42-arch\extracted\dsh-session\lib\types\known-event-types.js -Pattern "tool/call|tool/result"

# puente y contrato en el plugin
Select-String -Path lifecode-skill-center\client.js -Pattern 'createSessionActivityBridge|pushActivity|OVERLAY_SLOT'
Select-String -Path lifecode-skill-center\lib\tools.mjs -Pattern 'activityOf'
```
