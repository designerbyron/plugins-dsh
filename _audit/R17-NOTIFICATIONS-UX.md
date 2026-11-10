# R17 — Notificaciones y centro de actividad (UX)

**Ronda:** R17 · **Tarea:** T36 · **Fecha:** 2026-11-09
**Ámbito:** `lifecode-skill-center` (panel del centro). Documenta lo implementado en el árbol congelado.
**Código de referencia:** `client.js` 519 032 B / 8 647 líneas; `lib/activity.mjs` 16 899 B / 363 líneas.
**Capturas:** `_audit/r17-after-*.png` y `r17-before-toast.png`. **No son el panel vivo**: son renders del
`client.js` real montado en `node:vm` con CSS real y fixtures sintéticos (`_audit/r17-render.mjs:1-2`).
La aceptación en GUI real es humana y está en `R17-ACTIVITY-ACCEPTANCE.md`.

**Nota de alcance (T42):** R17 describía el aviso dentro del panel; T42 añade el mismo aviso al slot global
`shell.overlay`, de modo que también aparece sobre una conversación. El mecanismo, los límites y la evidencia
están en `_audit/T42-CHAT-NOTIFICATIONS.md`; esta nota no altera ninguna cifra (las canónicas viven en
`_audit/FINAL-RELEASE-READINESS.md` §E).

---

## 1. Qué cambió, en una frase

Antes una operación terminaba con un aviso efímero de una sola línea, sin cierre, sin acción y sin
historial. Ahora cada operación persiste un evento consultable, el panel lo anuncia con una pila de
hasta tres avisos accionables y el usuario puede abrir «Actividad de LifeCode» para revisar qué se
creó, mejoró o conservó, con su evidencia y sin sondeo.

## 2. Antes (evidencia)

`_audit/r17-before-toast.png` (67 248 B): un único toast abajo a la derecha, sólo texto
(«Skill «Revisar un plugin de DSH» publicada»), sin botón de cierre ni acción; en la cabecera el
indicador dice «Estado no disponible». El aviso anterior era efímero (~4,2 s), no se apilaba, no se
agrupaba y no dejaba rastro en la UI. La captura es un render del cliente previo, no una foto del
GUI.

## 3. Piezas implementadas

| Pieza | Símbolo | Líneas | Papel |
|---|---|---|---|
| Tarjeta de aviso | `ToastCard` | `client.js:6864-6912` | Variante, título, meta, detalle, referencias, acción y cierre |
| Pila | `ToastStack` | `client.js:6914-6939` | Máximo 3, `aria-live`, Escape |
| Empuje/mezcla | `pushToast` | `client.js:7317-7388` | Agrupa por `correlationId` |
| Notificación pública | `notify` | `client.js:7391-7402` | Conserva la firma histórica; mapea tono |
| Indicador de cabecera | `ActivityIndicator` | `client.js:6941-6982` | 6 estados + punto de no leídas |
| Cajón | `ActivityDrawer` | `client.js:7030-7201` | Consulta, filtros, grupos, paginación, foco |
| Fila | `ActivityRow` | `client.js:6984-7028` | Detalle con evidencia |
| Integración de operaciones | `act` | `client.js:7988-8050` | Emite aviso sólo si la actividad persistió |

## 4. Avisos (toasts)

- **Máximo visible:** 3 (`TOAST_MAX_VISIBLE=3`, `client.js:6563`). Al entrar una cuarta se recorta la
  más antigua (`pushToast`, `:7362-7365`).
- **Variantes y duración:** success/info 6 000 ms, warning 8 000 ms; error **persistente**
  (`TOAST_DURATIONS`, `client.js:6564`; el error no programa temporizador, `:7378`). El mapeo de
  tono heredado (`ok/warn/bad`) a variante está en `toastKindOf`, `:6611-6616`.
- **Anatomía:** icono por variante, título, meta `Skill · Proyecto` cuando existe, detalle, referencias
  y una acción contextual; botón × en todas. Un error usa `role="alert"`; el resto, `role="status"` y
  `aria-atomic="true"` (`client.js:6864-6912`).
- **Agrupación:** si llega otro aviso con el mismo `correlationId`, no se apila: se incrementa el
  contador, se suman las referencias y se conserva la persistencia (`pushToast`, `:7330-7361`). Una
  operación con varias skills produce **un** aviso con contador, no N.
- **Acción contextual:** `activityActionOf` (`client.js:6723-6734`) devuelve skill o proyecto;
  la etiqueta es «Ver diferencias» cuando hay `versionBefore` y `versionAfter` distintas, y «Abrir
  skill» en el resto. Al pulsarla se navega a la ficha existente (`onActivityAction`, `:7421-7427`);
  no hay una vista de diff propia (ver §11).
- **Ciclo de vida:** un `setTimeout` por tarjeta, cancelado al desmontar o al cerrar
  (`client.js:7370-7392`). No hay timers recurrentes.

## 5. Accesibilidad

- Pila: `aria-live="polite"`, `aria-relevant="additions text"` (`client.js:6914-6924`); los errores
  llevan `role="alert"` dentro de la tarjeta.
- Escape cierra el aviso más reciente de la pila (`ToastStack`, `:6916-6925`); el foco no se roba.
- Cajón: `role="dialog"`, `aria-modal="true"`, foco inicial en cerrar, trampa de foco con
  `trapDialogFocus`, Escape cierra y el foco vuelve al disparador (`client.js:7073-7086`).
- Movimiento reducido: `@media (prefers-reduced-motion: reduce)` con `animation: none` para la
  tarjeta (`client.js`, única aparición del media query; prueba `tests/r17-ui.test.mjs:225-229`).
- Contraste y tamaños: mismas variables de tema del panel (no se introducen colores nuevos).

## 6. Indicador de cabecera (6 estados)

Montado en la cabecera (`client.js:8430-8440`). Modo derivado en `:6942-6946`; texto en `:6949-6962`.

| Modo | Cuándo | Texto ES | Punto |
|---|---|---|---|
| `working` | Operación en curso | «Trabajando…» | work (morado) |
| `saving` | Guardando | «Guardando…» | work |
| `pending` | Hay propuestas pendientes | «N pendientes» | warn (ámbar) |
| `last` | Hay última actividad conocida | «Última actividad: {tiempo}» | ok (verde) |
| `connected` | Compatible y sin actividad | «Conectado» | ok |
| `unknown` | Sin handshake/compat | «Estado no disponible» | bad/neutro |

El modo `last` sólo aparece cuando la sesión ya recibió una actividad: `lastActivity` arranca vacío y
sólo lo fija `toastFromActivity` (`client.js:7435`, `:8439`); no se hidrata del snapshot. En la captura
`r17-after-indicator.png` el fixture lo fija a «Hace 2 min».

**No leídas:** se guarda `{v:1,lastSeenAt,ids[]}` en `localStorage` bajo
`lifecode-skill-center/activity-seen`, con un máximo de 200 ids (`client.js:6570-6571`, `:6573-6608`).
El botón muestra **punto** morado, no cifra: `unreadCount` está fijado a `0` y `hasUnread` compara
`lastActivity > lastSeenAt` (`client.js:8438-8439`). Abrir el cajón marca visto (`:7415-7419`).

## 7. Centro de actividad

- **Apertura:** botón del indicador (`onOpen: openActivity`). El cajón **sólo se monta abierto**
  (`client.js:8581-8589`), de modo que cerrado no existe ni consulta.
- **Una consulta al abrir:** `GET /api/activity?limit=20` (`client.js:7052-7055`); el `useEffect` de
  montaje llama una sola vez (`:7018-7022`). No hay polling ni intervalo propio.
- **Refrescar:** botón «Actualizar» repite la consulta con `before=''` y reemplaza la lista
  (`:6993`); «Cargar más» usa el `nextBefore` del servidor (`:7061-7069`) y mezcla sin duplicar
  (`mergeActivityEntries`). Reabrir el cajón reutiliza el feed vigente y **no** vuelve a consultar;
  para traer lo nuevo está «Actualizar» (salvedad medida por T35).
- **Filtros:** Todo, Creaciones, Actualizaciones, Self-improvement, Referencias, Alertas
  (`ACTIVITY_FILTERS`, `client.js:6565`; botones `:7189-7195`). Filtran en cliente sobre la página
  cargada; el servidor también acepta `category`.
- **Grupos temporales:** Ahora (<1 h), Hoy, Anteriores (`activityBucketOf`, `:6701-6710`; grupos
  `:7108-7112`).
- **Detalle:** pulsar una fila la expande (`aria-expanded`, `:6984-6992`); muestra resultado, versión,
  referencias, actor, origen, fuente, confianza, evidencia (canal · almacenado), correlación y, si
  aplica, «no persistido» (`:6993-7028`).
- **Fuente parcial:** si el payload trae `sources[].status='unreadable'` se pinta un aviso ámbar
  «Parte de la actividad no está disponible» (`activitySourceUnreadable`, `:6626-6628`; render
  `:7116-7118`). No se convierte en vacío.
- **Error y 409:** aviso rojo con el mensaje y botón «Reintentar» (`:7119-7124`); un 409 de almacén
  ilegible cae aquí y no finge lista vacía.
- **Vacío:** texto distinto para «sin actividad» y «sin resultados con este filtro» (`:7125-7127`).
- **Footer:** «Las marcas de leído se guardan sólo en este navegador.» (`activity.seen`, ES `:992`).

### Captura del cajón

`_audit/r17-after-drawer.png` (74 053 B, render): título «Actividad de LifeCode», subtítulo
«Conocimiento creado, mejorado y conservado.», «Actualizar», aviso «Sin conexión con el centro»
(fixture con `connected:false`), filtros con Todo activo, grupo AHORA y dos filas con acciones
«Ver diferencias» y «Abrir detalle».

## 8. Control antes → ahora → prueba

| Control | Antes | Ahora | Prueba |
|---|---|---|---|
| Aviso de operación | Toast único, sin cierre ni acción, efímero | Pila de 3, variantes, acción, cierre, agrupación | `tests/r17-ui.test.mjs:33-63` |
| Duración | ~4,2 s uniforme | 6 s/8 s; error persistente | `tests/r17-ui.test.mjs:64-74` |
| Operación con varias skills | N avisos o uno pobre | Un aviso con contador por `correlationId` | `tests/r17-ui.test.mjs:75-88` |
| Replay tras recarga | Sin control | No duplica aviso | `tests/r17-ui.test.mjs:89-99` |
| Historial | Inexistente | Cajón con consulta, filtros y paginación | `tests/r17-ui.test.mjs:113-163` |
| Fuente ilegible | Silencio | Aviso parcial explícito | `tests/r17-ui.test.mjs:203-218` |
| Error de consulta | — | Mensaje + Reintentar, sin vacío falso | `tests/r17-ui.test.mjs:188-202` |
| Atajo/teclado | — | Escape + trampa de foco | `tests/r17-ui.test.mjs:179-187` |
| Timers | — | 1 solo `setInterval` (refresco preexistente) | `tests/r17-ui.test.mjs:219-223` |
| i18n | Sólo textos del panel | 885 claves ES = 885 EN | `tests/r17-ui.test.mjs:231-247` |

## 9. Integración con operaciones

`act()` hace `POST /state`; si la respuesta falla, pinta un toast **error persistente** con código,
findings y reasons (`client.js:8014-8031`). Si tiene éxito, recarga sin reescanear y llama a
`toastFromActivity(result.activity, result.replayed === true)` (`:7950-7953`). `toastFromActivity`:

- exige `activity !== null`, `activity.persisted === true` y `replayed !== true`
  (`client.js:7431-7439`); un replay no vuelve a notificar;
- marca visto el `eventId` y fija `lastActivity` (`:7352-7353`);
- **no hace fetch**: el aviso se construye con el `activity` que devolvió la operación.

Una operación bloqueada (`ok:false`) no genera toast de éxito: sigue la rama de error. `quiet` suprime
el aviso pero no la recarga (`:7950-7952`).

## 10. i18n

- **885 claves en ES y 885 en EN**, paridad exacta (bloques ES `client.js:32-1043`, EN `:1045-2063`;
  comprobado en `tests/r17-ui.test.mjs:231-247`).
- Textos nuevos: `activityFeed.title` «Actividad de LifeCode» (`:925`), subtítulo (`:926`), filtros
  (`:935-940`), títulos (`:947-968`), grupos (`:969-971`), vacíos (`:972-974`), error/reintento
  (`:975-977`), conectado (`:978-979`), indicador (`:981-986`), resultado (`:987-994`), fila
  (`:995-1004`), referencias (`:1005-1007`), acciones (`:1008-1010`), tiempos (`:1011-1016`), aviso
  de ámbito (`:992`).

## 11. Simplificado y fuera de alcance (Nivel 3)

| Decisión | Qué hay realmente | Consecuencia |
|---|---|---|
| Contador de no leídas | Punto, no número (`unreadCount:0`) | No se promete una cifra que no se calcula |
| «Última actividad» al cargar | Sólo se fija al recibir un aviso en la sesión | Tras recargar el indicador dice «Conectado», no la fecha |
| Ids vistos | Se guardan ≤200 pero no se cuentan | Sirven de marca, no de bandeja |
| Persistencia de toasts | No; sólo la actividad | Cerrar el panel pierde el aviso, no el evento |
| Acciones por aviso | Una | No hay «deshacer» ni navegación múltiple |
| Filtros | Por categoría, en cliente | Sin búsqueda libre ni filtro por proyecto/skill |
| «Ver diferencias» | Abre la ficha de la Skill | No hay diff dedicado |
| Push del Host | No existe canal público | Sin panel abierto no hay notificación |
| Notificaciones del sistema | No | Sólo dentro del panel |
| Confianza | `derived`/`unknown` (`lib/activity.mjs:160-165`) | No se marca `verified` |
| Ids de knowledge | Sintéticos `kn-<12hex>` | Estables por evento, no del diario original |
| Ventanas | 4000 eventos por diario, 80 en snapshot, 50 por página | Lo anterior se recorta |

## 12. Límites y no verificado

- **No verificado en GUI real:** estas capturas son `node:vm`; la prueba viva exige reiniciar DSH para
  que el backend cargue `lib/api.mjs` de R17 y aceptar humanamente (ver `R17-ACTIVITY-ACCEPTANCE.md`).
  T35 verificó el contrato y la UX en `node:vm` (PASS 7/7), no en navegador.
- **Verificado por T35** (`_audit/r17-verify-r17.md`, 113 líneas): 23/23 pruebas propias y 11/11
  comprobaciones de rendimiento; suite **896/896** (873 base + 23 de verify) y check **411/411**
  (407 + 4) en ese momento. No es una re-medición mía.
- **Verificado por T40** (`_audit/r17-verify-r171.md`, 68 líneas): 8/8 pruebas propias, 54/54 en el
  cruce de cuatro ficheros, suite **912/912** y check **412/412**; 7/7 puntos PASS y **0 defectos de
  producto**; el centro real se leyó sin escribir (`9704ee16…` idéntico antes/después). El árbol
  creció con las 8 pruebas de T40 y una comprobación de check respecto a las cifras previas del Lead
  (902/411); no es un fallo. La prueba posterior del tipo desconocido deja el árbol congelado en **912/912** (`r17-ui` 23/23).
- **Salvedad de autoría:** un actor `external` que se persiste en `center.json` se colapsa a `human`
  (`lib/state.mjs:323`, `:1687`); `external` sólo sobrevive si llega desde `knowledge.json`. No hay
  emisor de eventos externos en el centro.
- **Medido con arnés, no con GUI:** `_audit/r17-perf-after.json` confirma 0 peticiones en arranque,
  0 en inactividad, 1 al abrir el cajón y 0 con el cajón cerrado (`openRequests 1`,
  `startupRequests 0`, `idleRequests 0`); no es una medición del panel vivo.
- **No verificado:** el detalle de `unmount()` del arnés (T35 declara que falla por `style` simulado;
  no afecta al producto).
- **No verificado:** que «Actualizar» mantenga el scroll/foco con listas largas (no hay prueba).
- **Límite real:** el backend vivo (implementation `r16.2`) responde 404 a `/api/activity` hasta el
  reinicio; el discriminador está en la aceptación.

## 13. Pruebas que lo acreditan

| Fichero | Qué cubre |
|---|---|
| `tests/r17-ui.test.mjs` (23) | Pila, duraciones, agrupación, replay, acción, cajón, filtros, Escape, 409, parcial, timers, reduced-motion, i18n, conexión y tipo (R17.1) |
| `tests/r17-activity.test.mjs` (17) | DTO, taxonomía, autoría, cursor, total, límites, round-trip, título por tipo (R17.1) |
| `tests/r17-r171.test.mjs` (8) | Claves semánticas ES/EN sin huérfanas, histórico por tipo, centro real sin escritura, etiquetas de conexión, sin polling (T40) |
| `tests/r17-api-activity.test.mjs` (11) | GET, 400/405/409, fuentes, mutación con `activity`, replay, 50 filas |
| `tests/r17-contract.test.mjs` (13 313 B) | Contrato de actividad (task-38) |
| `tests/r17-events.test.mjs` (8 660 B) | Semántica de eventos y persistencia (task-38) |
| `tests/r17-ux.test.mjs` (6 748 B) | Recorrido de UI y estados (task-38) |
| `tests/r17-ui-runtime.mjs` | Arnés `node:vm` usado por las capturas y las pruebas de UI |
| `tools/r17-perf.mjs` (6 548 B) | Medición de peticiones y timers (task-38) |

**Estado global (cierre de R17.1):** suite **912/912**, check **412/412**; verificador independiente
7/7 PASS, 0 defectos de producto. El gate del Lead daba **902/902** y **411/411** antes de que T40
añadiera `tests/r17-r171.test.mjs` (8 pruebas) y su comprobación extra de check; ambas cifras son
ciertas en su momento y la diferencia está explicada, no oculta.
`testquality` sigue exit 1 preexistente (1 alta en `tests/state.test.mjs:144`, 30 media / 13 baja).

## 14. R17.1 — clasificación de eventos y estado de conexión

Parche de dos defectos reportados sobre el panel real, corregidos sin migrar ni reescribir nada.

### 14.1 Causa raíz

1. **Título incorrecto.** `EVENT_MAP` tenía `'skill-imported': ['create','success',T('skill-created')]`
   —una copia de la fila de `skill.created`—, así que el evento histórico `ev-4b5ef716129b`
   (importación) se pintaba como «Skill creada». Además había claves imprecisas: `skill.assigned`,
   `skill.unassigned` y `skill.advanced` compartían «actualizada»; `skill.requested`,
   `skill.request-fulfilled` y los `insight-*`/`decision-recorded`/`policy-changed` caían en
   «mejora propuesta». La corrección está en `lib/activity.mjs:37-69`: cada tipo tiene su clave
   (`skill-imported` → `activity.title.skill-imported` L39; `skill-assigned` L41; `skill-unassigned`
   L42; `skill-advanced` L43; requests L49-51; insight/decision/policy L65-68). El `titleKey` **no se
   persiste**: `dtoOf` lo deriva del `type` con `mapOf(type)` (`lib/activity.mjs:247`), y
   `normalizeEvent` (`:283-288`) no lee el `titleKey` guardado; por eso los históricos se corrigen al
   leer y no hace falta tocar el almacén (`persistedTitleKeys: 0` medido).
2. **«Sin conexión» falso.** El cajón derivaba el estado de `compat?.state` (compatibilidad de
   contrato), no de la respuesta real: con `/api/activity` 200 y `sources.center.status='ok'` /
   `sources.knowledge.status='ok'` seguía diciendo «desconectado». Ahora la etiqueta sale de `sources`
   del payload (`client.js:7097-7107`): sin respuesta y sin filas → «Sin conexión con el centro»
   (`:7098`); payload sin `sources` → «Estado no disponible» (`:7100`); todas `ok` → «Centro
   disponible» (`:7102`); alguna no legible → «Centro disponible con avisos: <ids>»
   (`:7105-7106`). El indicador de cabecera usa la disponibilidad real de la API, no el contrato
   (`:6960-6961`). El canal externo se declara aparte como capacidad ausente
   (`activity.channel.unavailable`, ES `:991`, render `:7187`), sin inventar un push que el Host no
   ofrece.

### 14.2 Evidencia (sólo lectura)

`node _audit/r17.1-recon/verify-history.mjs --out _audit/r17.1-recon/history-evidence.json` lee el
centro real con `loadState` y deriva el feed con `buildActivityFeed`; no escribe en el almacén:
`ev-e1d22376f174` (`skill.created`, panel) → `activity.title.skill-created`;
`ev-4b5ef716129b` (`skill-imported`, import) → `activity.title.skill-imported`;
`center.json` 52 063 B sha256 `9704ee16…` sin cambios; `persistedTitleKeys: 0`.
`node _audit/r17.1-recon/render-check.mjs --out _audit/r17.1-recon/render-evidence.json` monta el
cliente real en `node:vm` con los dos eventos (uno con `titleKey` incorrecto a propósito): renderiza
cada fila por su tipo, `connected:true`, `disconnected:false`, canal externo declarado,
`requestCount:1`, `writes:0`.

### 14.3 Qué NO se toca

`center.json` (ni eventos, ni ids, ni `titleKey` persistido, ni historia), evaluaciones, políticas,
asignaciones, proyectos ni la biblioteca. La captura `r17-after-drawer.png` es anterior al parche: su
«Sin conexión» venía de un fixture sin respuesta, que sigue siendo un estado válido; la evidencia del
estado conectado es `render-evidence.json`.

### 14.4 Pruebas

`tests/r17-activity.test.mjs:335-357` (cada tipo de skill con su clave semántica propia, incluido
`skill-imported`) y `:359-369` (un `titleKey` guardado incorrecto no manda: el tipo clasifica el
histórico); `tests/r17-ui.test.mjs:256` (200 + fuentes ok ⇒ «Centro disponible», no
«Sin conexión»), `:266` (fuente no legible ⇒ parcial sin declarar caído el centro), `:286` (el
indicador usa la API, no el contrato), `:299` (el tipo manda sobre un `titleKey` incorrecto, sin
escribir), `:325` (abrir/consultar no escribe ni emite eventos).

### 14.5 Verificación independiente y gate de rendimiento

`_audit/r17-verify-r171.md` (T40, 68 líneas) da **7/7 puntos PASS y 0 defectos de producto**; sus 8
pruebas son independientes de `r17-activity` y `r17-ui` (no copian casos) y cruzan el backend con las
tablas i18n reales. Re-ejecutó todo: 8/8 propias, 54/54 en el cruce de cuatro ficheros, **912/912**
de suite, **412/412** de check, e2e 19/19 con `center.json` `9704ee16…` sin cambios y testquality en
su rojo preexistente.

**P1 (media) queda cerrado por decisión del Lead, sin tocar producto:** el presupuesto de
`tools/r17-perf.mjs` pasó de un umbral único de 60 KiB a un presupuesto **por tramos**: 60 KiB para
R17 y 8 KiB para R17.1 (68 KiB acumulados), porque el delta de R17.1 son tablas i18n y estados de
conexión, no crecimiento estructural. Medición: `client.js` 454 594 → **518 628 B**, es decir
**+64 034 B (+14,1 %)**, dentro de los 68 KiB y del gate relativo (<20 %); los 10 checks de runtime
siguen intactos. La cifra anterior (+64 373 B sobre 518 967 B) era del árbol previo al último
compactado del mapa de títulos.

Riesgos residuales declarados por verify: `_audit/R17-EVENT-CONTRACT.md:149/154` sigue asociando
requests/`insight-*`/`decision-recorded`/`policy-changed` a «mejora propuesta» (documento
desactualizado; el mapa y las pruebas usan claves propias); `improvement.proposed` se rotula «Mejora
preparada» (`improvement-prepared`, `humanApprovalRequired:true`), que es lo que fija
`R17-EVENT-CONTRACT.md:144`; y el `unmount()` del arnés ajeno sigue defectuoso sin afectar al
producto.

---

## Corrección medida — T45.4-B (2026-11-10)

La línea «Reabrir el cajón reutiliza el feed vigente y **no** vuelve a consultar» describía el
comportamiento esperado, no el implementado. El cajón se monta sólo mientras está abierto
(`client.js`: montaje condicional) y su efecto de carga corre en cada montaje («Una sola consulta
al montar (el drawer sólo existe cuando está abierto)»), de modo que **cada apertura hace
exactamente una consulta** y cerrar no consulta: 20 aperturas/cierres = 20 GET (una por apertura,
sin multiplicación ni temporizadores).

Esto coincide con la medición viva de T45.3 (3 aperturas del cajón = 3 GET) y con la prueba
`tests/r17-ux.test.mjs` ajustada en T45.4-B. Para traer eventos nuevos sin cerrar está «Actualizar».
La afirmación anterior se conserva arriba como registro de la expectativa original.
