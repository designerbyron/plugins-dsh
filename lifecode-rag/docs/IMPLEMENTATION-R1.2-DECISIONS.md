# Implementación R1.2 — decisiones autónomas y matriz de trazabilidad

**Producto:** LifeCode RAG · **Base:** 1.5.11 (`release/lifecode-rag-1.5.11`, HEAD `36148704`, tag en C4 `25a9ab16`)
**Línea de desarrollo:** `feature/project-memory-lifecycle` · worktree aislado `<WORKTREE>`
**Estado:** decisiones autónomas tomadas al amparo del mandato de implementación de R1.2. No se reabren Q07–Q10.

Fuentes de verdad y hashes verificados al inicio:

| Fuente | SHA-256 |
|---|---|
| `docs/ARCHITECTURE-PROJECT-MEMORY-LIFECYCLE.md` (incluye Adenda R1.2) | `e5902139d19a749c0a3a8d45b54e9720a090b2fce0a566e574128a3f307a86f8` |
| `docs/UX-PROYECTO-DE-TRABAJO-Y-PROYECTO-DE-CONOCIMIENTO.md` | `af3a7b8bb6ada853571ba27a5c4976fc7e1ac2a7d4635ee9b397567e8bc9b62c` |

Estas decisiones se distinguen de las de producto ya aprobadas (Adenda A, Adenda B, Adenda R1.2). Las de
producto **no se reinterpretan**: se implementan. Las de aquí son técnicas y reversibles.

---

## D-01 · Q-06: contrato `pa/1.6.0`

**Contexto.** El toggle pasa de escribir una preferencia a provisionar memoria y ampliar la autorización de
lectura de la ruta exacta. La forma es aditiva (`intent` opcional, rutas nuevas), pero el **efecto** no es el
mismo que en `pa/1.5.0`.

**Alternativas.** (a) campo aditivo dentro de `pa/1.5.0`; (b) `pa/1.6.0`.

**Decisión.** `pa/1.6.0`. Un cliente antiguo que no envía `intent` conserva el comportamiento funcional de
1.5.0: mismas rutas, mismos campos y ninguna provisión por sorpresa. La compatibilidad es total salvo dos
límites que impone la migración v4 y que se declaran: el PUT heredado que intenta que dos workspaces compartan
una memoria responde `409 memory-exclusive` (antes no existía el índice) y un registro v3 con duplicados no
migra (`registry-migration-conflict`). Por eso el salto es *minor*, no *major*: ningún cliente antiguo correcto
cambia de comportamiento.

**Impacto.** `PA_VERSION` y las pruebas que fijan la versión literal. `intent` sólo admite `'provision'`.

**Riesgo.** Un cliente que envíe `intent` sin entender la respuesta `memory` no rompe: los campos son
aditivos. **Prueba:** `tests/pa-lifecycle-api.test.mjs` (contrato y compatibilidad sin `intent`).

## D-02 · Q-01: estado de provisión derivado, sin columna nueva

**Alternativas.** (a) `workspace_tracking.provision_state`; (b) derivar del journal y del disco.

**Decisión.** (b). El estado se deriva de `provision_intents`, `sync_requests`, `workspace_tracking` y
`scopeStoreExists()`. Una columna duplicaría una verdad que ya vive en el journal y podría desincronizarse
tras una caída. La respuesta `memory` publica: `state`, `projectId`, `association`, `store`, `operationId`,
`reused`, `canRevoke`, `canRevokeReason`, `index`.

**Límite declarado.** En lecturas (`GET`) el estado `ready` significa «asociación explícita + proyecto activo +
fichero del almacén presente»; **no** reabre el SQLite para verificar integridad (abrir un WAL puede crear
sidecars). La verificación completa ocurre en el acto de provisión y en cada apertura real del almacén.

**Prueba:** `tests/provisioning.test.mjs`, `tests/pa-lifecycle-api.test.mjs`.

## D-03 · Q-02: localizar la provisión en curso sin `LIKE`

**Decisión.** Tabla `provision_intents` (R1-3) con `path_key` como clave primaria, `operation_id` único,
`expected_revision` para *fencing*, `project_id` reservado, `state` (`open|done|abandoned`), procedencia
(`consent_trust_key`, `consent_root_id`) y `revoked_at` para que la revocación sea idempotente.

Una fila por workspace; encontrar la operación en curso es una búsqueda por clave primaria. No hay
`LIKE` sobre `operations.detail` en ningún camino.

**Prueba:** `tests/tracking-migration.test.mjs`, `tests/provisioning.test.mjs`.

## D-04 · Migración v4 aditiva, con preflight que aborta

**Decisión.** `REGISTRY_VERSION = 4`. Añade, dentro de `BEGIN IMMEDIATE`:

1. `provision_intents` + índice por estado.
2. `sync_requests` (ver D-07) + índice por estado.
3. `CREATE UNIQUE INDEX workspace_tracking_project_exclusive ON workspace_tracking(project_id) WHERE project_id IS NOT NULL`.

Antes del índice se ejecuta el preflight de duplicados. Si hay filas que lo violarían, la migración **aborta
con `registry-migration-conflict`** y la lista completa (proyecto, rutas, revisiones); no elige propietario,
no borra filas, no fusiona memorias y deja el registro en su versión de origen (v3 si venía de v3). Es
reintentable una vez resuelto a mano.

La migración es idempotente (`IF NOT EXISTS`), no reescribe filas y se verifica leyendo (`user_version`,
`sqlite_master`, preflight otra vez).

**Prueba:** `tests/tracking-migration.test.mjs` (v3→v4, idempotencia, conflicto, registro nuevo).

## D-05 · Q-05: reaparición de carpetas y contenido distinto

**Política, por caso:**

| Caso | Identidad | Comportamiento |
|---|---|---|
| Misma ruta reaparece, mismo contenido | la misma (`path_key`) | `sync_state` pasa `missing`→`present`; no se reindexa (hash igual); se cuenta `reappeared` |
| Misma ruta reaparece, contenido cambiado | la misma | sincronización incremental: sólo los ficheros con hash distinto se reingieren; los ausentes se marcan `missing`; nada se borra automáticamente |
| Ruta nueva con copia del contenido (clon) | **nueva** (`path_key` nuevo) | provisión normal: proyecto y almacén nuevos; no se adopta nada por parecido |
| Ruta vieja reaparece tras un movimiento | **sin identidad** (la fila se eliminó, Q09) | no se indexa ni se asocia; el journal conserva la traza del movimiento |

Nunca se reasigna un almacén por contenido ni por nombre, y nunca se borra memoria al desaparecer la carpeta.
La evidencia de la decisión vive en `sync_state` (hash, `missing_since`) y en `operations`/`audit_registry`.

**Prueba:** `tests/provisioning.test.mjs` (clone con identidad y almacén nuevos; ruta vieja que reaparece sin
reintegrarse) y `tests/sync-lifecycle.test.mjs` (reaparición con y sin cambio de hash).

## D-06 · Primer pase tras el alta: encolado, nunca dentro del acto

**Alternativas.** (a) indexar dentro de la petición; (b) no hacer nada y dejarlo manual; (c) encolar una
operación `kind='sync'` independiente y drenarla fuera de la petición.

**Decisión.** (c). La provisión termina cuando la memoria, la identidad, el almacén, el consentimiento y la
asociación están verificados. Inmediatamente después se **encola** una sincronización incremental con
`reason='provision'` en `sync_requests`; el planificador la drena y la ejecuta como operación `kind='sync'`
aparte. La respuesta dice `memory.state='ready'` y `index.state='queued'`, y conserva literal
**«Memoria lista. Ya puedes indexar»**. Si el proceso muere antes de drenar, la fila sigue `queued` y se
drena al arrancar: la promesa es durable, no un `setImmediate` perdido.

**Por qué no (a):** una indexación puede agotar presupuesto y parar en `too-many-files`; la provisión no debe
durar eso ni fallar por ello. **Por qué no (b):** Q10 exige que reactivar mantenga la memoria operativa, y el
alta debe dejarla en el mismo camino.

**Prueba:** `tests/sync-lifecycle.test.mjs` (cola durable, coalescencia, reencolado de una petición `running`
huérfana al arrancar; el drenaje en sí lo ejerce el planificador).

## D-07 · OFF detiene la actividad automática por proyecto

**Decisión.** `activeSyncScopes` excluye un proyecto cuando su fila de `workspace_tracking` existe y su
`state` no es `'on'`. También excluye un proyecto **provisionado** (intención `done`) que ya no tiene fila:
borrar la fila no debe convertir la memoria en una indexación automática sin dueño. Las bibliotecas no se ven
afectadas. Un proyecto heredado sin intención de provisión y sin fila conserva el comportamiento anterior.
OFF **no** toca `session_scope`, no revoca permisos, no cambia `project_id` ni borra nada. La resolución por
seguimiento ya exigía `state='on'` (escalón 2): no se cambia la escalera.

**Prueba:** `tests/sync-lifecycle.test.mjs`, `tests/resolve-tracking.test.mjs` (sin cambios de contrato).

## D-08 · Revocación: sólo lo propio y demostrable

**Decisión.** `POST /tracking/revoke` es una acción avanzada independiente. Lee la última intención `done` (o
`abandoned` con procedencia: un acto que falló después de crear acceso también debe poder retirarlo) del
workspace y sólo retira:

- la entrada de `meta.trusted_roots` cuyo `pathKey` coincide con `consent_trust_key`; se retira por clave,
  sin exigir que la carpeta siga existiendo;
- la raíz `consent_root_id` si sigue existiendo, pertenece al proyecto y su ruta es la del workspace.

Nunca retira entradas preexistentes, del padre, de otro proyecto ni creadas por el Host. Si no puede demostrar
propiedad, **no escribe nada** y responde `revocation-not-proven` con el motivo. `addedBy` no se usa como
prueba. No borra proyecto, identidad, almacén, índices ni historial; no cambia `state`. Repetirla es
idempotente (`revoked_at`).

**Verdad de la respuesta (H1).** Si tras retirar lo propio queda otra raíz autorizada que cubre la misma ruta
—por ejemplo, una raíz de descubrimiento o del Host— la operación **no puede afirmar que el acceso cesó**.
Devuelve `complete:false` y `remaining` con esas raíces; el panel muestra «el acceso de lectura continúa». Un
`changed:true` con `complete:true` es la única respuesta que autoriza el mensaje de revocación total. Repetir
la acción (idempotente) vuelve a medir `remaining` y conserva `complete:false`: no convierte una revocación
parcial en total.

**Ubicación UX (decidida):** sección «Acciones avanzadas» de la fila de seguimiento, tras confirmación que
enumera exactamente las entradas propias; si no hay evidencia, el control se muestra deshabilitado con el
motivo real (`canRevokeReason`: ya revocado, en preparación, proyecto inactivo o sin prueba).

**Prueba:** `tests/provisioning.test.mjs` (revoca lo propio y sólo lo propio; sin evidencia no toca nada).

## D-09 · Movimiento: misma identidad, fila vieja eliminada, sin acceso residual propio

**Decisión.** `POST /tracking/move` con `{pathKey, newPath, expectedRevision}` y operación `kind='move'`.
Pasos: verificar revisión y estructura → detectar conflictos **antes de escribir** → consentimiento de la ruta
nueva → raíz del proyecto en la ruta nueva → **una transacción** que elimina la fila vieja e inserta la nueva
con el mismo `project_id` (Q09) → revocar sólo las entradas propias de la ruta vieja si ninguna otra
raíz/proyecto las necesita → encolar una sincronización de la ruta nueva. La traza durable guarda rutas,
revisiones, `project_id`, `operation_id` y resultado en `operations.detail` + `operation_steps`. La
recuperación **reanuda** si el `rebind` ya ocurrió y **compensa** la raíz/confianza de destino si la caída
fue antes (H-01); el propio `catch` del movimiento compensa un fallo de CAS antes de abandonar (H-01-R).

**Conflictos de preflight (H2/M2).** Si la ruta vieja tiene una raíz autorizada que el acto no creó
(`source-root-not-owned`), mover dejaría dos raíces sobre la misma memoria y la carpeta vieja seguiría
indexándose: se detiene antes de escribir. Si el destino contiene a la ruta vieja o está contenido en ella
(`containment`), el resultado sería una raíz que cubre hermanos que no son el workspace: también se rechaza.
Si el proyecto ya tiene raíces en otras carpetas (`project-has-other-roots`), el movimiento dejaría una
memoria con dos sitios: se rechaza. Un fallo al retirar el acceso viejo **después** del rebind no convierte
el movimiento en fallido: se audita `access.revoke.skipped` y la operación queda `committed` con la verdad
de lo que quedó.

**Prueba:** `tests/provisioning.test.mjs` (identidad, exclusividad, journal, revocación de la vieja, colisión).

## D-10 · Reactivación: `PUT state:'on'` reutiliza y encola incremental

**Decisión.** Si la fila ya tiene `project_id` y el almacén existe, `state:'on'` no crea nada: actualiza la
revisión, reutiliza y encola `sync_requests` con `reason='reactivation'`. La cola coalesce: una fila por
ámbito, la petición más reciente gana y no se apilan trabajos. La sincronización corre como `kind='sync'`
independiente, con presupuesto y reanudación.

**Prueba:** `tests/sync-lifecycle.test.mjs`, `tests/provisioning.test.mjs`.

## D-11 · Concurrencia y recuperación

- Todas las escrituras del registro van en `BEGIN IMMEDIATE`; el CAS por `revision` sigue siendo la guarda.
- `workspace_tracking_project_exclusive` convierte 1:1:1 en propiedad del dato.
- Una intención `open` con revisión distinta de la actual y sin asociación ya escrita se marca `abandoned`
  (fencing) y su operación se cierra como `failed` con motivo; no escribe.
- `recoverLifecycle()` se ejecuta al cargar el plugin (y en las pruebas): reanuda pasos `done` y no repite
  efectos irreversibles a ciegas; un almacén con identidad ajena no se adopta nunca. La provisión normal
  resuelve sus intenciones inline; la recuperación de un movimiento **reanuda** si el `rebind` ya ocurrió y
  **compensa** la raíz/confianza de destino si la caída fue antes (H-01).
- Si una operación queda `started` con todos los pasos `done`, se cierra `committed` (no se re-ejecuta).

**Prueba:** `tests/provisioning.test.mjs` (caída simulada entre pasos, reanudación, fencing).

## D-12 · Núcleo autónomo

Todo lo nuevo vive en `lib/` y se prueba con `node --test`. `index.js` sólo conecta el planificador y el
arranque de la recuperación. Ningún módulo nuevo importa `@deepseek-ai/*` ni conoce DSH; `tools/check.mjs`
verifica los imports y el manifiesto. Que el host DSH monte el bundle no se demuestra aquí: es un acto de
laboratorio separado y se declara como no verificado.

## D-13 · Una memoria no se extiende a una segunda carpeta

**Contexto.** `PUT /tracking` conserva el campo `projectId` de 1.5.0 por compatibilidad. Un cliente
podría pedir asociar un workspace a un proyecto que ya tiene una raíz autorizada en otra ruta.

**Decisión.** La provisión **detiene** ese caso con `memory-exclusive`
(`reason:'project-has-other-roots'`) en vez de añadir una segunda raíz: sería mezclar dos carpetas en
una sola memoria, que es exactamente lo que 1:1:1 evita. La única excepción es que el proyecto ya cubra
la ruta exacta o sea su ancestro (misma memoria, misma carpeta); entonces se reutiliza sin escribir raíz.
El panel no usa `projectId` para elegir proyecto: sólo repite el que la fila ya tenía.

**Prueba:** `tests/provisioning.test.mjs` (reutilización por raíz exacta y exclusividad), `tests/pa-lifecycle-api.test.mjs` (la administración no amplía a otra carpeta; el PUT heredado responde 409).

## D-14 · Correcciones de la primera auditoría independiente

La auditoría de solo lectura (veredicto inicial: READY WITH CONDITIONS) encontró defectos reales. Se
corrigieron con regresión propia; no se cerró en verde sobre una promesa incumplida.

| Hallazgo | Corrección | Regresión |
|---|---|---|
| H1: «acceso revocado» con una raíz preexistente aún autorizada | `complete`/`remaining` en la respuesta y aviso parcial en el panel | `provisioning.test.mjs` H1, `pa-lifecycle-api.test.mjs` H1, `client.test.mjs` T-R1.2-04 |
| H2: mover con raíz preexistente dejaba acceso residual | preflight `source-root-not-owned` antes de escribir | `provisioning.test.mjs` H2 |
| M2: mover a subcarpeta/padre ampliaba la raíz | conflicto `containment` | `provisioning.test.mjs` M2 |
| M2b: un proyecto con una segunda raíz se movía dejando dos sitios | conflicto `project-has-other-roots` | `provisioning.test.mjs` M2b |
| M3: `POST /roots` podía añadir otra carpeta a una memoria de workspace | guarda `project-is-workspace` (409), anclada a la intención durable aunque se borre la fila | `pa-lifecycle-api.test.mjs` (con y sin fila) |
| M4: el PUT heredado que compartía memoria respondía 500 | traducción del UNIQUE a `memory-exclusive` 409 | `pa-lifecycle-api.test.mjs` M4 |
| M5: una intención `abandoned` no permitía retirar el acceso que creó | `ownedConsentOf` acepta `done` y `abandoned` con procedencia | cubierto por H1/H2 y la saga |
| M6: `removeTrustedRoot` exigía que la carpeta existiera | variante `removeTrustedRootByKey` | `provisioning.test.mjs` (revocación/movimiento) |
| M7: una pasada parcial se marcaba `done` y no continuaba | `requeueSyncRequest` con avance; `failed` sólo sin avance | `sync-lifecycle.test.mjs` (parcial → reencolada) |
| M8: la recuperación cerraba operaciones `sync` ajenas | sólo `provision`/`move` huérfanas | `provisioning.test.mjs` (recuperación) |
| M9: un acto fallido dejaba trust/raíz creados | compensación auditada antes de abandonar | cubierto por la saga; `access.revoke.compensated` |
| M10: dos provisiones simultáneas podían ejecutar dos operaciones | adopción de la intención abierta; la propia se `reconciled` | `multiprocess-concurrency.test.mjs` (dos procesos) |
| M11: el recorrido se cortaba en 1.000 ficheros y no avanzaba | límite de observación 20.000, presupuesto de indexación aparte | `sync-lifecycle.test.mjs` M11 (1.201 ficheros) |
| L1: mover no encolaba sincronización de la ruta nueva | `enqueueSync(reason:'move')` | `pa-lifecycle-api.test.mjs` (mover) |
| L2: un tick podía solaparse con el drenaje | `tick` se salta si `draining` | `sync-scheduler` (status) |
| L3: el teardown anulaba la señal durante el drenaje | señal capturada al empezar | probe de auditoría; sin regresión de suite (declarado) |
| L4: quitar una raíz de biblioteca respondía 404 tras borrarla | `project:null` para ámbitos que no son proyecto | cubierto por la suite de administración |
| L5: el panel decía «no se cambió nada» sin releer | relectura en todo fallo y aviso con la fila real | `client.test.mjs` T-UX22-10 |
| L6: un fallo al revocar la ruta vieja marcaba `failed` un move ya hecho | `access.revoke.skipped` y operación `committed` | `provisioning.test.mjs` (movimiento) |
| H5 (auditoría 2/2): una provisión fallida dejaba la fila en `on` y un proyecto activo fantasma | compensación de la fila en la API y archivado del proyecto sin raíz | `pa-lifecycle-api.test.mjs` H5/H5b |
| M5 (auditoría 2/2): `PUT` con `intent` no exigía la compuerta del Host | 503 `authorization-unavailable` si no hay compuerta | `pa-lifecycle-api.test.mjs` (acciones avanzadas) |
| MEDIO (re-auditoría): la reserva de identidad del proyecto archivado envenenaba el `pathKey` | la compensación descarta `project_id`; el arranque sanea reservas muertas | `pa-lifecycle-api.test.mjs` H5 (fallo → reintento 200) |
| H-01 (auditoría 2/2): caída antes del `rebind` dejaba dos raíces y el planificador indexaba las dos | compensación del destino (raíz + confianza) y reintento posible | `provisioning.test.mjs` H-01 |
| H-01-R (auditoría final): un `revision-conflict` normal del `rebind` no compensaba en el `catch` | compensación en el `catch` de move antes de abandonar; si el rebind ya ocurrió, se cierra `committed` | `provisioning.test.mjs` H-01-R |
| H-01-R2 (auditoría final): ventana entre `addRoot` y `setIntentConsent` | raíz + procedencia (y confianza + procedencia) en una transacción | `provisioning.test.mjs` H-01-R2 |
| M-06 precedencia: `open` sin procedencia decía «no demostrable» | `provisioning` se evalúa antes que `no-provenance` | `client.test.mjs` T-R1.2-05 |
| F-01 (auditoría final): si la intención se cerraba entre pasos, la raíz se commiteaba sin procedencia | `setIntentConsent` debe devolver `true`; si no, la transacción revierte raíz/confianza | `provisioning.test.mjs` F-01/F-01b (move y provisión) |
| M-01: mover no pedía drenaje y la ruta nueva podía quedar en cola | `scheduler.drainSoon()` en la ruta de move | `pa-lifecycle-api.test.mjs` (mover) |
| M-06: el panel decía «no se puede demostrar» ya revocado o en preparación | `canRevokeReason` y textos ES/EN por motivo | `client.test.mjs` T-R1.2-05 |
| L5bis: la selección decía «no se cambió nada» sin releer | relectura del snapshot en todo fallo | sin regresión específica; T-R1.2-06 cubre la clase de aviso en acciones avanzadas |

**Segunda auditoría (2/2).** Confirmó H4 (revocar con la carpeta ausente fallaba con `source-unreadable`) y
H5, y encontró **H-01** (caída antes del `rebind`): veredicto inicial **BLOCKED**. La auditoría final
encontró H-01-R (fallo de CAS en el `rebind`), H-01-R2 (ventana raíz/procedencia) y F-01 (intención cerrada
entre pasos); todos corregidos con regresión. **F-02 quedó cerrado** con D-15: la obligación de retirar el
acceso anterior se persiste como operación `kind='cleanup'` en el journal existente, se reintenta al
arrancar y nunca toca entradas ajenas. No hay publicación ni migración real en esta fase.

## D-15 · F-02: limpieza durable del acceso anterior

**Problema.** Si una operación de E/S impedía el paso `revoke-old` después del `rebind`, el movimiento
quedaba `committed` (correcto) pero la raíz/confianza vieja podía sobrevivir; el journal sólo dejaba
`access.revoke.skipped` y la reconciliación dependía de una persona.

**Decisión.** No se inventa un segundo journal. La obligación se representa como una operación
`kind='cleanup'` en `operations`, con el `project_id`, `from_path_key`, `from_path`, `root_id` y
`trust_key` **exactos** que el acto creó. La recuperación de arranque (`recoverLifecycle`) la ejecuta con
`runAccessCleanup`, que:

1. conserva el `rebind` y la operación de movimiento como `committed`;
2. borra la raíz sólo si su `scope_kind='prj'`, `scope_id` y `path_key` coinciden con la procedencia;
3. retira la confianza sólo si la clave es la ruta exacta y sigue `trusted`;
4. trata las entradas ya ausentes como `already-absent` (idempotencia);
5. si una entrada existe pero no es de este proyecto/ruta, la deja intacta y lo registra como `not-owned`;
6. si el borrado vuelve a fallar, la operación sigue `started`, se audita `access.cleanup.retry` y se
   reintenta en el siguiente arranque; nunca se declara limpio lo que no se midió.

**Consecuencia visible.** `GET /tracking` publica `memory.cleanup.pending` y el panel muestra el aviso
correspondiente. Un fallo persistente queda diagnosticable; el movimiento no se convierte en una falsa
reversión.

**Prueba:** `tests/cleanup.test.mjs` (6 casos: raíz, confianza, fallo persistente, entradas ausentes,
detalle perdido y caída entre rebind y revoke-old), `tests/provisioning.test.mjs` (L6/movimiento) y
`tests/pa-lifecycle-api.test.mjs` (H5/H5b).

## D-16 · Movimiento: rekey del almacén, no duplicación de fuentes

**Problema medido en el host aislado.** Al mover un workspace ya indexado, el almacén conservaba la fuente
con la ruta vieja y el sync de la ruta nueva la insertaba como otra fuente: un fichero aparecía dos veces
en la misma memoria.

**Decisión.** `rekeyScopeAfterMove` cambia el prefijo `uri` de las fuentes del almacén del MISMO proyecto
(conserva `source_id`, chunks y vectores) y traslada las fuentes al nuevo `root_id`; el estado de `sync_state`
del root viejo se retira. Es un paso del journal (`rekey`) después del `rebind`; desde D-18, un fallo no se
pierde: se encola una operación `rekey` durable y la recuperación la reintenta. No toca fuentes fuera del
prefijo exacto de la ruta de origen ni fuentes de otro proyecto.

**Prueba:** `tests/provisioning.test.mjs` (movimiento conserva `source_id` y deja una sola fuente) y
verificación en el host aislado: tras mover `ws-fresh` a `ws-fresh-final`, `sources` contenía una única
fila con la URI nueva.

## D-17 · La recuperación también compensa la fila que creó la API

**Problema.** La API eliminaba la fila de seguimiento cuando `intent:'provision'` fallaba de forma no
reintentable, pero la recuperación de arranque de una operación adoptada no sabía si la fila la había
creado el acto; podía dejarla en `on` con asociación pendiente.

**Decisión.** La operación de provisión guarda `tracking_created` en su detalle durable. La API pasa
`trackingCreated: !previous`; la recuperación lee la marca y la pasa a la compensación. Sólo se retira una
fila sin `projectId` (nunca una asociación ya hecha ni una fila ajena).

**Prueba:** `tests/pa-lifecycle-api.test.mjs` H5 (operación adoptada por la recuperación, fila retirada y
reintento 200).

## D-18 · Rekey durable, no un efecto best-effort

La auditoría de hardening demostró dos huecos del rekey inicial: una caída entre `rebind` y `rekey` no
dejaba obligación, y un fallo de E/S del almacén sólo producía una auditoría `failed` con el índice viejo.
Se corrigió con una operación `kind='rekey'` en el mismo journal:

- `move` intenta el rekey; si falla, encola la operación con `project_id`, `from_path`, `to_path` y los
  `root_id` exactos, y el movimiento sigue `committed`.
- La recuperación ejecuta las operaciones `rekey` **antes** de la limpieza de acceso y antes del siguiente
  sync; un fallo deja la operación `started`, se audita `tracking.move.rekey.retry` y se reintenta.
- `activeSyncScopes` excluye un proyecto con rekey pendiente: la ruta nueva no se indexa mientras el
  almacén no esté reasignado.
- El prefijo se compara con separador (`app` no arrastra `app-docs`); si la ruta nueva ya tiene una fuente,
  se retira la vieja para no duplicar, conservando la nueva.
- `memory.rekey` publica `pending`, `operationId`, `fromPath` y `toPath`, y el panel muestra «Ruta del
  índice pendiente; se reintenta al reiniciar».

**Prueba:** `tests/provisioning.test.mjs` (fallo de E/S y reintento durable, fuente hermana intacta) y
`tests/cleanup.test.mjs` (caída tras el rebind: rekey y limpieza en la misma recuperación).

## D-19 · La recuperación no toca operaciones vivas

`recoverLifecycle` se ejecuta en cada carga del plugin. La auditoría midió que un segundo proceso podía
compensar el destino de un movimiento que el primero estaba ejecutando. Las operaciones de ciclo de vida
llevan `owner_pid` en el detalle durable; la recuperación comprueba que el PID no siga vivo antes de
adoptar, compensar o cerrar. `EPERM` cuenta como vivo; `ESRCH`/ausente, como huérfano. Las operaciones
creadas sin marca (pruebas o versiones anteriores) conservan el comportamiento de recuperación.

**Prueba:** `tests/provisioning.test.mjs` «no compensa una operación de movimiento que sigue viva».

## D-20 · `remaining` incluye `trusted_roots`

La auditoría midió que una confianza preexistente del padre mantenía la lectura (`trustedRootFor`) aunque
`remaining` sólo mirara `roots`, y la respuesta decía `complete:true`. `remainingAccess` mide ahora raíces
autorizadas **y** confianzas `trusted`/`readAuthorization` que cubren la ruta. `complete:true` exige que no
quede ninguna de las dos. La limpieza F-02 conserva además el `addedAt` de la concesión: si se retiró y se
volvió a crear, no se toca la nueva.

**Prueba:** `tests/provisioning.test.mjs` H1b; `tests/cleanup.test.mjs` (padre y otro proyecto intactos).

## D-21 · La ruta vieja puede volver a seguirse sin reclamar la memoria movida

Una intención `done` de la ruta vieja conservaba `project_id`; al volver a seguirla, la provisión moría en
`project-has-other-roots` de forma permanente. Si la intención `done` está revocada y la fila no tiene
proyecto, la provisión libera `project_id` y la procedencia antes de abrir una identidad nueva. La memoria
movida conserva su única raíz y la identidad vieja no se reutiliza.

**Prueba:** `tests/provisioning.test.mjs` «la ruta vieja puede volver a seguirse con una identidad nueva».

## D-22 · El perdedor de un doble movimiento no reabre la intención del ganador

`openProvisionIntent` acepta `reopenDone:false`. El movimiento lo usa: si la intención destino ya está
`done`, no se reabre ni se borran sus `consent_*`; la operación perdedora se cierra `reconciled` (o lanza
`revision-conflict` si otra operación sigue preparando el destino). Si la fila destino ya está asociada al
mismo proyecto, el acto es idempotente y devuelve la fila real. La prueba multiproceso exige ahora que la
intención destino quede `done` con `consent_root_id`, además de cero operaciones `started` y cero
intenciones `open`.

## D-23 · Una limpieza F-02 pendiente bloquea reprovisionar su ruta

Con una operación `cleanup` abierta, provisionar la ruta vieja crearía una tercera asociación y la
limpieza marcaría la intención nueva. `provisionWorkspaceMemory` comprueba la obligación por ruta
(`pendingCleanupForPath`) y por proyecto y responde `memory-exclusive` con `reason:'cleanup-pending'`
antes de escribir. La recuperación completa la limpieza y entonces la ruta puede volver a seguirse.

## D-24 · Verificación de la cadena de auditoría sin falsos `registry-corrupt`

La verificación leía las filas y después `audit_head_seq`; una escritura concurrente entre ambas lecturas
producía un falso `registry-corrupt` (preexistente, no una regresión R1.2). `verifyRegistryAudit` ejecuta
ambas lecturas dentro de una transacción de lectura, que da un snapshot coherente sin bloquear escritores.

**Prueba:** la suite multiproceso se ejecutó 8 veces consecutivas sin fallos de `openRegistry`; el
escenario de doble movimiento, 10 veces.

## D-25 · Compensación del perdedor caído, reencolado tras cleanup y fila restaurada

La auditoría final de los siete bloqueantes encontró un caso de la misma familia: dos movimientos a
destinos distintos, el ganador mueve y borra la fila de origen, y el perdedor cae después de crear su raíz
y confianza. `recoverMove` sólo compensaba si la fila de origen seguía existiendo; el estado
`unexpected-state` abandonaba el destino y dejaba dos raíces. Ahora esa rama llama a
`compensateMoveDestination` con la intención destino; si la compensación de E/S falla, encola una limpieza
durable. La rama «no rebind, origen existe» también captura el fallo de E/S: deja el move/intención
abiertos, audita y **no aborta la pasada de recuperación**; un fallo inesperado de `recoverMove` se aísla
en el bucle. El paso `root` revalida la exclusividad **dentro de la misma transacción inmediata** que
`addRoot`, para que dos movimientos no pasen ambos la comprobación.

La limpieza F-02 completada reencola una pasada de sync (`reason:'cleanup'`): la petición original pudo
consumirse como `scope-not-syncable` mientras había dos raíces. La guarda `cleanup-pending` lleva
`retryable:false`, de modo que la API restaura la fila de seguimiento que había escrito antes de la saga en
lugar de dejarla en `on`.

**Prueba:** `tests/provisioning.test.mjs` (perdedor caído a otro destino), `tests/cleanup.test.mjs`
(reencolado tras limpieza) y la suite completa.

## D-26 · Rekey encadenado, recuperación con sync, preflight y confianza recreada

La auditoría final independiente (`deleg_18dbbe0d`) encontró cinco defectos reales:

- **H-1:** un segundo movimiento con un `rekey` pendiente apuntaba la obligación vieja a una ruta
  hermana y duplicaba fuentes. `moveWorkspaceMemory` rechaza con `move-conflict`/`rekey-pending` antes
  de abrir la operación.
- **H-2:** la recuperación de un move con rebind hecho no encolaba una pasada. Ahora encola
  `reason:'recovery'` al cerrar la operación; el rekey completado también.
- **H-3:** los preflight no reintentables dejaban la fila de seguimiento en `on`. Llevan
  `retryable:false` y la API restaura la fila anterior (OFF) o elimina la nueva.
- **H-4:** la compensación podía retirar una confianza recreada por otro acto. El journal guarda
  `trust_added_at` y la compensación compara esa marca; reactivar una confianza revocada renueva
  `addedAt` para que la limpieza diferida no retire la nueva.
- **H-5:** si fallaba el INSERT de la operación `rekey`, el move quedaba `started` para siempre. Al
  completar el rekey, `finishSourceMoveAfterRekey` marca el paso `rekey` como `done` y cierra el
  move/intención si todos los pasos están completos.

La re-auditoría independiente de D-26 abrió **R-1**: si la recuperación no podía persistir su propia
obligación `rekey`, seguía, retiraba el acceso viejo y cerraba el move; el proyecto volvía al sync y el
siguiente pase duplicaba las fuentes. Ahora un fallo de `queueRekey` en la recuperación deja move e
intención abiertos, audita y **no continúa**. También se conserva `trust_added_at` al cerrar el move
(O-1), no sólo mientras está en vuelo.

**Prueba:** `tests/provisioning.test.mjs` (rekey pendiente, rebind con sync, fallo de INSERT de rekey,
R-1, confianza recreada, cierre con `trust_added_at`), `tests/pa-lifecycle-api.test.mjs` (H-3) y la
suite completa.

## D-27 · Revisión de release: revocar→mover, liveness de obligaciones y contratos

La revisión independiente de release encontró defectos que se corrigieron antes del staging:

- **Mover después de revocar** no hacía rekey porque `ownedConsentOf` devuelve `rootId=null` cuando la
  intención está revocada; el sync insertaba una segunda fuente. `rekeyScopeAfterMove` ahora rekeya por
  prefijo de ruta aunque no exista la raíz vieja, y conserva el borrado de `sync_state` sólo si hay root.
- **Rekey/cleanup sin `owner_pid`**: las obligaciones creadas por un move vivo no tenían marca de vida y
  otro proceso podía adoptarlas. Se añade `owner_pid`; las obligaciones creadas por la recuperación se
  crean sin dueño para ejecutarse en la misma pasada.
- **Carpeta ausente**: `workspace-missing` lleva `retryable:false` para que la API restaure la fila.
- **Procedencia tras compensar**: se limpian `consent_*` cuando la compensación retira las entradas.
- **Renovación de confianza**: `addedAt` se renueva también cuando cambia `readAuthorization`.
- **Cola `running` reciente**: el arranque reclama la petición aunque no hayan pasado 5 minutos; las
  peticiones antiguas sin dueño conservan la ventana.
- **Paquete**: los informes internos de implementación salen de `files` para no publicar rutas personales
  ni IDs de auditoría; el ejemplo de `PA-UI` se saneó. `INTENT_STATES` muerto se retiró.
- **Contratos/README**: `user_version=4`, 805 pruebas, 64 códigos y razones `cleanup-pending`/
  `rekey-pending` documentadas.

**Prueba:** `tests/provisioning.test.mjs` (mover tras revocar, carpeta ausente, compensación), `tests/
sync-lifecycle.test.mjs` (running reciente), `tests/client.test.mjs` (revocación parcial idempotente),
`npm pack --dry-run` sin informes internos; suite **805/805**.

## D-28 · Auditoría de seguridad: barra final y raíz de datos del perfil

La auditoría independiente de seguridad bloqueó el worktree por dos defectos reales:

- **H1:** tras revocar, `rekeyScopeAfterMove` usaba `fromPath` con separador final como prefijo y no
  encontraba las fuentes, por lo que el sync volvía a insertarlas. Se normalizan los separadores
  finales de `fromPath`/`toPath` antes de comparar y se añadió una prueba que mueve después de revocar
  con la misma ruta escrita con `sep` final; conserva una sola fuente.
- **M2:** `profileRoot` ignoraba `LIFECODE_RAG_DATA` y `LIFECODE_RAG_PROFILE`, mientras la API usaba
  `resolveProfileKey` y el scheduler `profileKey`; en un despliegue sin DSH la API y el scheduler
  podían apuntar a perfiles distintos. `profileKey` respeta `LIFECODE_RAG_PROFILE` y `profileRoot`
  resuelve `<LIFECODE_RAG_DATA>/profiles/<perfil>`; `resolveProfileKey` sanea la identidad igual que
  el host (Unicode/espacios) para que API, scheduler y rutas coincidan; la API y el scheduler reciben
  `dataRoot` para leer la misma capa global/perfil que las herramientas; `pa-api` pasa `profileKey` a
  move/revoke. La clave saneada rechaza `.`/`..` para no escapar de `profiles/`. Prueba en
  `profile-identity.test.mjs` y `probe-m2-api.mjs`.
- **H1 Unicode/grafías:** la consulta de rekey usaba `lower()` de SQLite, que sólo pliega ASCII; con
  `WÖRK` frente a `wörk` no movía la fuente. Ahora compara en JS (`toLowerCase`) y normaliza la
  grafía léxica (`.` y separadores duplicados) además del separador final antes de comparar.

**Prueba:** focal 56/56, `profile-identity` 6/6, suite **805/805**; check limpio; hermética 805 con el
almacén real intacto.

## D-29 · Segunda ronda de seguridad: sync, raíces, compensación y UI

La auditoría de seguridad completa encontró, además de H1/M2:

- **H2 (sync en vuelo lee la raíz vieja):** un move se rechaza con `sync-in-progress` mientras haya
  una pasada viva del mismo proyecto; además, el sync revalida la raíz por fichero y justo antes de
  `sync_state`, y reubica las fuentes del lote bajo la raíz nueva si el move ganó la carrera. Sondas
  `probe-h2-fresh/changed/changed-collections`: no quedan URIs viejas ni contenido perdido.
- **H3 (junction):** `sync` llama a `assertRootUnchanged` antes de recorrer y por fichero, y además
  comprueba que el `realpath` de cada fichero siga dentro de la raíz; una raíz o subcarpeta sustituida
  no se recorre/ingiere y la pasada falla en cerrado (`root-changed`/`file-outside-root`). Sondas
  `probe-root-junction` y `probe-h3-junction`: sin contenido de la otra zona.
- **H4 (compensación que falla):** si el borrado de raíz/confianza falla, se encola una limpieza
  durable (`kind='cleanup'`) y el proyecto queda fuera de `activeSyncScopes`; en una reanudación se
  leen `consent_*` de la intención, y si la fila de tracking desapareció antes del arranque la
  recuperación encola y ejecuta la limpieza antes de abandonar; la rama fenced (OFF/revisión cambiada)
  hace lo mismo. Si ni la obligación se puede persistir, el intent/operación quedan abiertos para
  recuperación. Pruebas F-04 y sondas `probe-compensation-failure`, `probe-h4-resume`,
  `probe-h4-recovery-abandon`, `probe-h4-fenced-off`.
- **M1 (`/roots` con provisión abierta):** se rechaza con `memory-exclusive`/`reason:'provision-open'`
  mientras exista una intención `open` (sonda `probe-roots-open-intent`: una sola raíz).
- **B1 (mensaje de UI):** `changed:false` con `remaining>0` usa
  `trackingRevokeNoChangeRemaining`; ya no afirma que se retiró acceso. Regresión T-R1.2-04b.
- **B2 (migración):** `application_id` se verifica antes de `journal_mode=WAL` y de cualquier DDL;
  un fichero sin tablas con `user_version` distinto de 0 también se rechaza sin sidecars ni cambios.

**M3 (reclaim de una petición running sin `operation_id`) se mantiene como ventana intencional del
perfil único**: el perfil no admite dos hosts; si se compartiera host+CLI habría que añadir una marca
de dueño a `sync_requests`. Se documenta como condición, no como verificación.**

**Prueba:** suite **805/805**; `probe-sync-move-race`, `probe-root-junction`,
`probe-compensation-failure` y `probe-roots-open-intent` sobre el código actual; check y hermética
805.

---

## D-30 · Correcciones de distribución: Node/FTS5, doctor no invasivo y presupuesto

La revisión de distribución encontró defectos que la suite de 805 no cubría:

- **Node/FTS5:** el rango `>=22.13 <23 || >=23.4` era falso: Node 22.13–22.15, 23.0–23.11 no incluyen
  FTS5 y `CREATE VIRTUAL TABLE ... USING fts5` falla con `no such module: fts5`; Node 22.16–22.xx y
  Node 24 sí. El rango corregido es `>=22.16.0 <23.0.0 || >=24.0.0`, y `doctor` aplica la misma
  condición. Se ejecutó la suite completa en Node 22.16.0 (**811/811**, 75.175 s) y Node 24.21.0
  (**811/811**, 74.601 s); Node 22.5/22.12/23.4 se rechazan por importación o FTS5.
- **Doctor no invasivo:** `doctor` ya no abre el almacén original. Copia el `.sqlite3` y sus sidecars
  a un directorio temporal, inspecciona la copia y ejecuta FTS sobre ella; una versión anterior se
  informa como `store-migration-required` y **no se migra**. La prueba compara contenido, hashes y
  `mtime` recursivos del almacén y del JSONL antes/después; no se crean `-wal`/`-shm`.
- **Presupuesto de auto-contexto:** `withBudget` creaba un `Promise` de aborto sin señal que quedaba
  pendiente; se elimina para el caso sin señal y se retira el listener al terminar. La prueba de
  presupuesto usa un servicio que responde fuera del plazo, no una promesa pendiente.
- **Higiene:** se sustituyeron rutas locales y nombres de perfil por marcadores neutros en los
  documentos de R1.2 y en los fixtures de las pruebas. No se modificaron perfiles, stores ni el
  release 1.5.11.

**Prueba:** `tests/doctor.test.mjs` (9/9), `tests/auto-context.test.mjs` (14/14), suite **811/811** en
Node 22.16 y 24; `check` limpio; hermética **810**, almacén real intacto (6 ficheros); `npm pack`
80 archivos sin informes internos.

---

## Matriz de trazabilidad

| Requisito R1.2 | Decisión | Módulo | Prueba |
|---|---|---|---|
| 1:1:1 por dato | D-04, D-11 | `registry-schema.mjs`, `provision-store.mjs` | `tracking-migration.test.mjs` |
| Provisión al activar | 6.1, D-01 | `lifecycle.mjs`, `pa-api.mjs` | `provisioning.test.mjs`, `pa-lifecycle-api.test.mjs` |
| Consentimiento exacto + procedencia | B.2, R1.1-B, D-08 | `lifecycle.mjs` | `provisioning.test.mjs` |
| «Memoria lista. Ya puedes indexar» literal | 6.1, R1.1-C | `lifecycle.mjs`, `pa-api.mjs` | `pa-lifecycle-api.test.mjs` |
| OFF detiene automatismo sin borrar | Q07, D-07 | `sync.mjs` | `sync-lifecycle.test.mjs` |
| Revocación independiente y demostrable | Q08, D-08 | `lifecycle.mjs`, `pa-api.mjs` | `provisioning.test.mjs` |
| Movimiento conserva identidad y borra fila | Q09, D-09 | `lifecycle.mjs` | `provisioning.test.mjs` (incl. H-01) |
| Reactivación encola incremental | Q10, D-10 | `lifecycle.mjs`, `sync-scheduler.mjs`, `pa-api.mjs` | `pa-lifecycle-api.test.mjs` |
| Primer pase tras el alta | 6.6, D-06 | `lifecycle.mjs`, `sync-scheduler.mjs`, `pa-api.mjs` | `pa-lifecycle-api.test.mjs`, `sync-lifecycle.test.mjs` |
| Q-01 estado derivado | D-02 | `provision-store.mjs` | `pa-lifecycle-api.test.mjs` |
| Q-02 sin `LIKE` | D-03 | `provision-store.mjs` (clave primaria por `path_key`) | `tracking-migration.test.mjs` (esquema) |
| 1:1:1 en la puerta de administración | M3/D-13 | `pa-api.mjs` | `pa-lifecycle-api.test.mjs` (con y sin fila) |
| Q-05 reaparición | D-05 | `sync.mjs` (existente) | `sync-lifecycle.test.mjs` |
| Q-06 versión de contrato | D-01 | `pa-api.mjs` | `pa-lifecycle-api.test.mjs` |
| Migración v4 segura | D-04 | `registry.mjs`, `registry-schema.mjs` | `tracking-migration.test.mjs` |
| F-02 limpieza durable tras el rebind | D-15 | `lifecycle.mjs` | `cleanup.test.mjs`, `provisioning.test.mjs` (L6) |
| Movimiento sin duplicar fuentes | D-16 | `lifecycle.mjs` | `provisioning.test.mjs` (rekey) |
| Recuperación compensa fila creada por la API | D-17 | `lifecycle.mjs`, `pa-api.mjs` | `pa-lifecycle-api.test.mjs` H5 |
| Rekey durable y reintentable | D-18 | `lifecycle.mjs`, `sync.mjs` | `provisioning.test.mjs`, `cleanup.test.mjs` |
| Recuperación no toca operaciones vivas | D-19 | `lifecycle.mjs` | `provisioning.test.mjs` (owner_pid) |
| `complete` mide roots y trusted_roots | D-20 | `lifecycle.mjs` | `provisioning.test.mjs` H1b |
| Ruta vieja reprovisionable | D-21 | `lifecycle.mjs` | `provisioning.test.mjs` (identidad nueva) |
| Perdedor no reabre intención ajena | D-22 | `provision-store.mjs`, `lifecycle.mjs` | `multiprocess-concurrency.test.mjs` |
| Limpieza pendiente bloquea reprovisión | D-23 | `lifecycle.mjs` | `provisioning.test.mjs` (cleanup-pending) |
| Auditoría sin carrera de lectura | D-24 | `registry.mjs` | `multiprocess-concurrency.test.mjs` (8 corridas) |
| Perdedor caído compensa su destino; cleanup reencola | D-25 | `lifecycle.mjs` | `provisioning.test.mjs`, `cleanup.test.mjs` |
| Rekey encadenado rechazado y recuperación con sync | D-26 | `lifecycle.mjs` | `provisioning.test.mjs` (rekey-pending, recovery) |
| Preflight restaura la fila OFF | D-26 | `lifecycle.mjs`, `pa-api.mjs` | `pa-lifecycle-api.test.mjs` (H-3) |
| Confianza recreada no se compensa | D-26 | `lifecycle.mjs`, `trusted-roots.mjs` | `provisioning.test.mjs` (trust recreada) |
| Fallo del INSERT de rekey no deja move atascado | D-26 | `lifecycle.mjs` | `provisioning.test.mjs` (rekey insert) |
| Fallo de persistencia del rekey no cierra ni indexa | D-26 | `lifecycle.mjs` | `provisioning.test.mjs` (R-1) |
| Mover después de revocar sin duplicar | D-27 | `lifecycle.mjs` | `provisioning.test.mjs` (mover tras revocar) |
| Liveness de rekey/cleanup | D-27 | `lifecycle.mjs` | `provisioning.test.mjs`, `cleanup.test.mjs` |
| Carpeta ausente restaura fila | D-27 | `lifecycle.mjs`, `pa-api.mjs` | `provisioning.test.mjs` |
| Running reciente al arrancar | D-27 | `provision-store.mjs`, `sync-scheduler.mjs` | `sync-lifecycle.test.mjs` |
| Paquete sin rutas internas | D-27 | `package.json`, `tools/pack.mjs` | `npm pack --dry-run` |
| Barra final en rekey tras revocar | D-28 | `lifecycle.mjs` | `provisioning.test.mjs` |
| Raíz PA con `LIFECODE_RAG_DATA`/`LIFECODE_RAG_PROFILE` | D-28 | `profile.mjs` | `profile-identity.test.mjs` |
| Sync no lee raíz revocada en vuelo | D-29 | `sync.mjs` | `probe-sync-move-race.mjs` |
| Junction no se recorre | D-29 | `sync.mjs` | `probe-root-junction.mjs` |
| Compensación fallida deja limpieza durable | D-29 | `lifecycle.mjs` | `provisioning.test.mjs` F-04 |
| `/roots` con provisión abierta | D-29 | `pa-api.mjs` | `probe-roots-open-intent.mjs` |
| UI no miente con `changed:false` | D-29 | `client.js` | `client.test.mjs` T-R1.2-04b |
| Migración antes de DDL | D-29 | `registry.mjs` | suite v4 |
| Concurrencia real entre procesos | D-12 | núcleo + journal | `multiprocess-concurrency.test.mjs` (7 casos) |

| Núcleo agnóstico | D-12 | todos | `tools/check.mjs` |
