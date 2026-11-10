# R17 — Arquitectura de actividad, notificaciones y eventos

> Auditoría de sólo lectura sobre `lifecode-skill-center` (HEAD `3b29510`, árbol con cambios sin commit de
> R16/R16.4 en curso). Todas las cifras se midieron con los comandos del Apéndice y llevan fichero:línea.
> Este documento no propone código nuevo salvo donde dice **[PROPUESTA]**; lo demás es lo que el producto hace hoy.

## 0. Resumen y corrección de las premisas recibidas

Hay cuatro premisas del encargo que la lectura del código no sostiene. Se corrigen aquí porque cambian el diseño:

| # | Premisa | Lo medido | Consecuencia |
|---|---|---|---|
| P1 | Los tipos `insight-*`, `decision-recorded`, `policy-changed` viven en `center.json.events` | Viven en **otro documento**: `knowledge.json.events` (`lib/knowledge.mjs:20-21, :67, :279, :413-415`; emisores en `:426, :502, :544, :561-565`). `center.json.events` no los contiene | El feed R17 necesita **dos fuentes** o declararlas fuera de alcance (§1, decisión D2) |
| P2 | Existe un canal de notificaciones del Host hacia el plugin | `dsh-api-session-controller/.../notifier.js` es un `Notifier` interno que batchea **su** snapshot para sus `listeners` (`_audit/r17-notifier.txt:7-97`). No hay API pública host→cliente de notificaciones para plugins | La UI se alimenta del propio panel, no del Host (§4) |
| P3 | El enriquecimiento aditivo de eventos basta con «añadir campos al evento» | `normalizeState` reconstruye cada evento con **lista blanca** de 9 campos (`lib/state.mjs:310-346`); lo no listado **se descarta al recargar**. Existe una excepción ad hoc sólo para `skill-imported` (`:328-343`) | Sin whitelist nueva, todo campo añadido es efímero: es el P0 de R17 (§5, §7 D3) |
| P4 | Se puede afirmar autoría («la IA actualizó la Skill») | El diario colapsa cualquier actor desconocido a `human` (`lib/state.mjs:323`) y el `actor` no se lee del cuerpo ni de cabeceras (`lib/api.mjs:779-781`) | La UI sólo puede afirmar autoría **demostrada** por canal; lo demás es `unknown`/«cambio detectado» (§3) |

Además: `skill.loaded` es telemetría de **entrega** del catálogo, no de uso (`lib/provider.mjs:51-55`, `lib/insights.mjs:49-53`); y el panel ya refresca `/api/state` cada 20 s (`client.js:6880-6893`, `docs/DESARROLLO.md:591`), así que R17 **no puede añadir un segundo sondeo**.

## 1. Las fuentes de verdad (y sus límites)

| Fuente | Dónde | Qué contiene | Quién escribe | Límite real |
|---|---|---|---|---|
| Diario del centro | `center.json.events` | Eventos de operaciones, proyectos y catálogo | `operations/api/provider/distribute` dentro de `withState` | `MAX_EVENTS = 4000` (`lib/state.mjs:53`); recorte por delante (`:1636`) |
| Diario de conocimiento | `knowledge.json.events` | `insight-*`, `decision-recorded`, `policy-changed` | `lib/knowledge.mjs:426, :502, :544, :561` | `MAX_EVENTS = 4000` (`:283`); **sin `id`** (el append no lo genera, `:413-415`) |
| Foto del panel | `buildSnapshot` → `events` | 80 eventos más recientes, invertidos | Lectura de `state.events` | `slice(-80).reverse()` (`lib/api.mjs:1996`) |
| Analítica | `buildInsights` → `events.recent` | 200 filas del rango, con `status`/`result` derivados | Lectura de `state.events` | `MAX_EVENT_ROWS = 200` (`lib/insights.mjs:19`, bloque `:392-402`) |
| Aviso efímero | `client.js:6376-6382` | Un único toast, 4200 ms, sin pila ni historial | `notify()` en el cliente | Se pierde al cerrarse; no persiste |
| Host | — | Nada publicable | — | Sin canal (§0 P2) |

Vocabulario declarado de tipos: `EVENT_TYPES` (`lib/insights.mjs:22-40`), 17 tipos; el diario **no** valida contra esa lista (`appendEvent` acepta cualquier `type`, `lib/state.mjs:1621`).

## 2. Camino → evento → actor → persistencia (lo que existe hoy)

| Camino (acción / disparador) | Evento(s) | `actor` que llega al diario | Evidencia |
|---|---|---|---|
| `create` (IA o humano) | `skill.created`, `version:'1.0.0'` | `ai` / `human` | `lib/operations.mjs:196` |
| `publish` | `skill.version` (sólo si publica) | `ai` / `human` | `:206-263`, evento `:261` |
| `improve` | `improvement.proposed` con `version: base` | `ai` / `human` | `:306` |
| `decide` → rechazo | `improvement.rejected` | `ai` / `human` | `:331` |
| `decide` → aprobación | `improvement.approved` con la versión resultante | `ai` / `human` | `:368` |
| `toggle` (encender/apagar) | `skill.assigned` / `skill.unassigned` (+`projectId`) | `human` (IA exige compuerta) | `:423-431`; sin cambio ⇒ sin evento `:405-407` |
| `rollback` | `skill.rollback` | `ai` / `human` | `:461` |
| `advance` | **un** `skill.advanced` por skill movida | `ai` / `human` | `:526-535` |
| `fork` | `skill.created` (delegado en `createSkill`) | `ai` / `human` | `:477-487` |
| `declare-application` | `skill.applied` + nota obligatoria | `human` / `ai` | `lib/api.mjs:3755` |
| `request-skill` / `request-fulfill` / `request-dismiss` | `skill.requested` / `skill.request-fulfilled` / `skill.request-dismissed` | `ai` / `human` | `:3898, :3919, :3925` |
| `register-project` (link/adopción) | `project.linked` / `project.adopted` | `human` / `ai` | `:3235` |
| reparación de manifiesto | `project.*` de reparación | igual | `:3161` |
| `move` / `reconcile` / `detach` / `relink` / fork de proyecto | `project.moved` / `project.reconciled` / `project.detached` / `project.relinked` / `project.forked` | igual | `:3298, :3348, :3395, :3456, :3542` |
| `import-bundle` | `skill-imported` + campos extra (`code`, `checksum`, `renamed`, `renamedFrom`, `originalSkillId`, `originalVersion`, `from`) | **`human` fijo** | `lib/distribute.mjs:419-437`; `actor` literal en `:424` |
| catálogo del proyecto (`provider.list`) | `skill.loaded`, máximo 1/día/skill/proyecto | `system` | `lib/provider.mjs:51-55`; dedupe `lib/state.mjs:1644-1651` |
| `insight` / `triage` / `decision` / `policy` | `insight-received`, `insight-<estado>`, `decision-recorded`, `policy-changed` | `ai` / `human` literales | `lib/knowledge.mjs:426, :502, :544, :561-565` |
| mantenimiento | `store.backup` / `store.restored` / `store.migrated` | `ai` / `human` | declarados en `lib/insights.mjs:37-39` |
| `export-skill`, `inspect-*`, `state`, `diff`, `skill`, `knowledge`, `doctor` | **ninguno** | — | sólo lectura o sin `appendEvent` |

Detalle que importa: el id del evento se genera al añadirlo (`ev-<12 hex>`, `lib/state.mjs:1625`) salvo para eventos diarios, cuyo id es `día-tipo-skill-proyecto` (`:1673`). No hay id de operación salvo en `state.operations` (`recordOperation`, `:1682`; usado por link/adopt/move/reconcile/detach/relink/fork).

## 3. Autoría: qué se puede afirmar y qué no

| Canal real | Actor en el diario | Qué prueba | Qué **no** prueba |
|---|---|---|---|
| `POST /state` del panel admitido | `human` fijo (`lib/api.mjs:779-781`) | Que la petición llegó por el canal humano admitido por el adaptador | Que la persona que está delante pulsó: no hay identidad de usuario |
| Herramientas del agente | `ai` fijo en el punto de entrada (`lib/tools.mjs:82, :105, :226, :266, :355`) | Que una herramienta del modelo invocó la operación | Que el modelo redactó eso mismo: no hay traza del turno |
| Catálogo del proyecto | `system` (`lib/provider.mjs:55`) | Que el Host pidió el catálogo y la skill se entregó | Que se aplicara (ver §0) |
| Reconciliación/identidad | el actor del despacho (`human`/`ai`) | Que se ejecutó la operación de identidad | Que el cambio externo lo hiciera alguien: el diario no distingue «observado» de «provocado» |
| Importación de paquete | `human` literal (`lib/distribute.mjs:424`) | Que el panel admitió la importación | Nada más: el `actor` original del paquete no existe |

**Prohibiciones que el contrato debe hacer cumplir** (son de producto, no de estilo):
1. No mostrar «la IA actualizó la Skill» para `project.reconciled` ni para diferencias de manifiesto: es «cambio detectado» (§9 de la directiva).
2. No presentar `improvement.proposed` como mejora aplicada: la Skill no cambió (`:306`).
3. No presentar `skill.loaded` como uso (es entrega).
4. Cualquier evento sin canal demostrable se muestra como autoría desconocida, nunca como humana por defecto — el colapso actual a `human` (`lib/state.mjs:323`) es la razón por la que el DTO necesita `actorEvidence`.

## 4. Lo que no es observable (y por tanto no se puede prometer)

- **No hay evento de lectura**: abrir el panel, `inspect-project`, `state`, `diff`, `skill`, `knowledge`, `doctor` no escriben diario. La actividad será de cambios, no de visitas.
- **No hay evento de rechazo**: una acción bloqueada por preflight (`lib/preflight.mjs`), por autorización (`approval-required`) o por `evaluation-failed` no deja rastro en el diario; sólo viaja en la respuesta HTTP. Por eso el error se notifica con el objeto `activity` de la respuesta, no con el feed (§7 del contrato).
- **No hay evento de exportación** (`export-skill` escribe un fichero y devuelve `{file,bytes,sha256}` sin `appendEvent`).
- **No hay evento de evaluación repetida** (`evaluate` no emite; ver `EVENT_TYPES`).
- **No hay notificación del Host**: el plugin no puede suscribirse a nada del Host (§0 P2). El «push» sólo puede ser el refresco del propio panel.
- **No hay identidad de operación en la mayoría de eventos**: sólo `state.operations` para identidad de proyectos; las operaciones de skills no registran `operationId`, así que la idempotencia de R17 se apoya en `correlationId` derivado o en un `operationId` nuevo que viaje en la petición.
- **No hay correlación entre los dos diarios**: un `decision-recorded` (knowledge) no referencia el `skill.version` (center) que provocó; sólo comparte `skillId`/`version`.

## 5. Límites estructurales que condicionan el diseño

1. **Recorte**: 4000 eventos; un evento antiguo desaparece sin marca. El feed no puede prometer «historial completo».
2. **Foto de 80**: `buildSnapshot` ya envía 80; un endpoint paginado no puede apoyarse en ella ni sustituirla sin duplicar payload.
3. **Analítica de 200**: `events.recent` ya sirve 200 con `status`/`result`; el feed debe reutilizar `eventStatus`/`eventResult` (`lib/insights.mjs:118-132`) para no inventar una segunda semántica.
4. **Refresco de 20 s**: el panel ya sondea `/api/state` (`client.js:6880-6893`). Un endpoint nuevo con su propio `setInterval` sería el segundo sondeo que el adendum prohíbe.
5. **Sin índice**: filtrar por categoría obliga a recorrer el array; con 4000 filas es barato (una pasada), pero el endpoint no puede ordenar por nada que no sea `(at, id)` sin coste.
6. **Normalización destructiva**: el P0 de §0. Cualquier campo nuevo debe entrar en la lista blanca y demostrarse con un round-trip byte a byte.

## 6. Diagrama de flujo (hoy, con el añadido de R17 marcado)

```
operación pura (operations.mjs) / api.mjs / provider.mjs / distribute.mjs
        │  appendEvent(state, {…})            ← dentro de withState (una transacción)
        ▼
  center.json.events  ──────────────┐
  knowledge.json.events ────────────┤
                                    ├─► lectura 1: buildSnapshot (80)  → panel (eventos recientes)
                                    ├─► lectura 2: buildInsights (200) → Analítica (filtros, serie)
                                    └─► lectura 3 [R17]: GET /api/activity (≤50, cursor)
                                                  │
                                    toast único (4200 ms) ◄── respuesta de la mutación (activity)
                                                  │
                                    Activity Center (drawer, bajo demanda) ← no-leídas en localStorage
```

## 7. Decisiones arquitectónicas

**D1 — Un solo lector puro.** `lib/activity.mjs` (nuevo) concentra derivación y paginación; la ruta y el snapshot lo llaman. Ninguna vista calcula categoría ni severidad por su cuenta: si dos vistas derivan, dicen cosas distintas (precedente: `eventStatus` se centralizó en `insights.mjs:118`).

**D2 — Dos fuentes, una salida, con `source` explícito.** `center.json` es la fuente principal; `knowledge.json` se lee **en la misma llamada** y cada evento publica `source:'center.json'|'knowledge.json'`. Es lectura de un fichero existente, no un segundo almacén: no se escribe nada. Si `knowledge.json` no se puede leer, se sirven los del centro con `sources[1].status='unreadable'` y el motivo; nunca se finge que no hubo decisiones.

**D3 — Cero cambios de esquema, dos campos durables.** `SCHEMA_VERSION` sigue en 2 (`lib/state.mjs:28`). Sólo se añaden a la lista blanca del evento `channel` y `operationId` (más las referencias movidas, si se quieren durables); el resto de los 23 campos del DTO se **deriva** al leer (título de skill, versiones anterior/nueva, outcome, categoría, severidad). Menos dato guardado, menos peso y menos migración.

**D4 — Cursor, no offset.** Orden estable `(at DESC, eventId DESC)` y `before` opaco (base64url de `at|eventId`). Un `offset` se rompe en cuanto entra un evento nuevo entre dos páginas, que es exactamente lo que pasa con el refresco de 20 s.

**D5 — Actor con evidencia.** El DTO expone `actor` normalizado (`human|agent|system|external|unknown`) y `actorEvidence` (`{channel, stored}`); la traducción `ai → agent` ocurre al leer, el almacén no se reescribe. Sin `actorEvidence`, la UI no puede distinguir «lo dijo el canal humano» de «no se sabe».

**D6 — Idempotencia por `operationId`, no por dedupe de eventos.** `appendEvent` no deduplica (`lib/state.mjs:1616-1638`). La regla es: si la petición trae `operationId` y ya está en `state.operations`, se devuelve el resultado previo con `replayed:true` y **no se escribe**; si no trae, `correlationId` se deriva del primer evento de la transacción. Una entrada por operación, éxito sólo tras `saveState`.

**D7 — Sin sondeo nuevo.** El feed se lee al abrir el Activity Center, tras una mutación (con el `activity` de la respuesta) y al recuperar el foco; nunca con un timer propio. El refresco de 20 s del panel sigue siendo el único.

**D8 — Payload acotado.** Sin cuerpos, sin contenido de referencias, sin rutas personales: sólo rutas `references/…` normalizadas, nombres y contadores. Límite duro de 50 filas y de ~40 KB por respuesta, verificado en la ruta, no en la vista.

**D9 — `persisted` es una afirmación, no un adorno.** En el feed vale `true` porque lo que se lee ya está en disco; en la respuesta de una mutación vale `true` sólo si `withState` guardó (`saved:true`) y `false` si se sirvió un resultado en memoria. La UI no anuncia éxito con `persisted:false`.

**D10 — ES literal, EN declarada.** Los textos de la taxonomía son literales de la directiva (ES). No hay texto EN canónico: la traducción EN es propia y se declara como tal en el contrato, nunca como «texto de la directiva».

## 8. Presupuesto anti-peso (adendum R17-A)

| Partida | Presupuesto | Cómo se mide |
|---|---|---|
| Dependencias nuevas | **0** | `package.json` sin cambios |
| Ficheros nuevos | `lib/activity.mjs` + tests | 1 módulo puro, sin I/O propio (recibe `state` y `knowledge` ya cargados) |
| Campos durables nuevos | **2** (`channel`, `operationId`) | round-trip `center.json` byte a byte |
| Payload del feed | ≤50 eventos, ≤40 KB | test con 4000 eventos sintéticos |
| Escrituras por lectura | **0** | test: hash de `center.json` y `knowledge.json` antes/después de `GET /api/activity` |
| Timers nuevos en cliente | **0** | grep `setInterval` en `client.js` no aumenta |
| Coste por evento en la foto | 0 campos nuevos | `buildSnapshot` sólo cambia si el contrato lo pide (no lo pide) |

## 9. Riesgos y lo que no se puede garantizar

1. **Recorte silencioso**: un evento de hace 4000 cambios no está; el feed no puede decir «no ocurrió».
2. **Autoría**: no hay identidad de persona ni de turno del modelo; `actorEvidence` documenta el canal, no al autor.
3. **Durabilidad**: con la lista blanca actual, cualquier campo nuevo fuera de ella se pierde al recargar (P0). Se mitiga con round-trip obligatorio en la suite.
4. **Coherencia entre diarios**: dos ficheros, dos candados; una decisión puede quedar registrada sin su versión (o al revés) si el segundo guardado falla. El feed debe mostrar ambos sin inventar una relación que no existe.
5. **Orden en empates**: dos eventos del mismo milisegundo se ordenan por id; el id actual es aleatorio (`shortHash(… Math.random())`, `lib/operations.mjs:25-27`), así que el orden entre empates es estable pero no cronológico.
6. **Notificaciones**: no hay push del Host; si el panel está cerrado no hay aviso. Ninguna promesa de «notificación del sistema» es sostenible con la API actual.

## Apéndice — cómo se reprodujo

```pwsh
# líneas y hashes citados
Get-Content lifecode-skill-center\lib\state.mjs      | Select-Object -Skip 1610 -First 30
Get-Content lifecode-skill-center\lib\knowledge.mjs  | Select-Object -Skip 405 -First 20
Get-Content lifecode-skill-center\lib\api.mjs        | Select-Object -Skip 1890 -First 115
Get-Content lifecode-skill-center\client.js          | Select-Object -Skip 6870 -First 25
Select-String -Path lifecode-skill-center\lib\*.mjs -Pattern 'appendEvent\(|recordDailyEvent|recordOperation'
git -C . rev-parse --short HEAD   # 3b29510
```
