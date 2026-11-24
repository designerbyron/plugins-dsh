# LifeCode RAG — registro de decisiones

**Estados:** `APPROVED` · `PROPOSED` · `PENDING` · `REJECTED` · `SUPERSEDED`
**Regla:** una propuesta **no** se convierte en decisión por aparecer aquí. Una decisión no se edita: se sustituye
(`SUPERSEDED`) por otra y se anota a qué sustituye. La columna **Fuente** dice de dónde sale; sin fuente no es
decisión.

**Última revisión:** 2026-11-23 (acto documental; ver §4).

---

## 1. Decisiones de producto aprobadas en el acto de continuidad

Origen: mandato «Documentación de continuidad del producto y arquitectura» (2026-11-23). Son decisiones de
**producto**; ninguna implica implementación.

| ID | Decisión | Estado | Justificación | Impacto | Fuente | Fecha |
|---|---|---|---|---|---|---|
| **D-CONT-01** | LifeCode RAG es un **motor de conocimiento y memoria persistente por proyecto**, no un buscador de documentos, y debe funcionar sin proveedor de IA, Hermes, DSH ni otros plugins | APPROVED | Fija el propósito y el criterio con el que se juzga cualquier propuesta | Todo diseño futuro se mide contra «memoria contextual», no contra «búsqueda» | Mandato §3 | 2026-11-23 |
| **D-CONT-02** | **Dos interfaces** con responsabilidades separadas: panel = administrar y gobernar; siete herramientas = trabajar para las IA. El panel no duplica herramientas; las siete no se reemplazan ni multiplican sin necesidad demostrada | APPROVED | Evita dos fuentes de acción sobre el mismo conocimiento | Cualquier fase nueva debe entrar por una de las dos superficies, no por ambas | Mandato §4 | 2026-11-23 |
| **D-CONT-03** | **Seis conceptos no equivalentes**: workspace · proyecto de conocimiento · seguimiento · autorización · indexación · selección. Selección ≠ seguimiento · Seguimiento ≠ autorización · Detección ≠ seguimiento (salvo modo fácil autorizado) · cerrar un workspace no borra conocimiento ni seguimiento · seguir un workspace no autoriza sus subcarpetas | APPROVED | Es la raíz de la confusión que UX-2.2 tiene que resolver | UX-2.2 no puede ser «un campo más de la selección»; exige identidad y tabla propias | Mandato §5 | 2026-11-23 |
| **D-CONT-04** | El **seguimiento** es independiente de la selección del proyecto activo | APPROVED | Sin esto, seguir un workspace obligaría a cambiar el proyecto de la sesión | Obliga a un almacén propio de seguimiento y a un escalón de resolución nuevo | Mandato §6 | 2026-11-23 |
| **D-CONT-05** | **Roadmap fijado**: UX-2.1 (Discover) → UX-2.2 (seguimiento manual) → UX-3 (modo fácil) → UX-4 (conocimiento compartido) → UX-5 (contexto inteligente) | APPROVED | Da orden y evita saltos de fase | UX-3/4/5 no se inician sin cerrar lo anterior y sin autorización | Mandato §11 | 2026-11-23 |
| **D-CONT-06** | **Doce invariantes arquitectónicos permanentes** (§10 del mandato): Core host-agnostic, `lib/**` sin DSH/Cordis/Electron, adaptador opcional, funciona sin DSH, sin dependencias entre plugins, autorización explícita, fronteras de anidados, ninguna automatización amplía permisos, cambios de API aditivos | APPROVED | Son restricciones, no objetivos | Cualquier propuesta que los vulnere se rechaza por sistema | Mandato §10 | 2026-11-23 |
| **D-CONT-07** | **UX-2.2 es la siguiente fase** y está **en diseño**; UX-2.1 está completada; UX-3/4/5 están aprobadas conceptualmente y **no autorizadas**. Ninguna fase se declara completada sin evidencia | APPROVED | Evita el «ya está hecho» sin respaldo | `ESTADO-IMPLEMENTACION.md` es la única fuente para decir qué existe | Mandato §11-12 | 2026-11-23 |

## 1.1 Decisiones de producto UX-2.2 aprobadas (mandato de resolución, 2026-11-23)

**Aprobadas por el propietario.** Numeración **del propietario**: no coincide con la numeración provisional que usó
el acto documental anterior (ver §3, nota de sustitución). No implican que el comportamiento exista.

| ID | Decisión | Estado | Consecuencia | Fuente | Fecha |
|---|---|---|---|---|---|
| **D-UX22-01** | El **seguimiento pertenece al perfil** DSH, no a una conversación; persiste entre sesiones y reinicios, y varios agentes comparten el estado | APPROVED | Obliga a almacén propio por perfil en el registro de LifeCode RAG | Mandato §2 | 2026-11-23 |
| **D-UX22-02** | La **resolución se limita a la sesión actual**: sólo el workspace seguido que corresponde a esa sesión; nunca «todos los seguidos». La precedencia de `session_scope` se conserva | APPROVED | El seguimiento no sustituye una selección explícita | Mandato §2 | 2026-11-23 |
| **D-UX22-03** | Conflicto entre workspace seguido y `cwd` → **`scope-conflict`**; prohibido elegir, combinar o ampliar ámbitos | APPROVED | Código de error nuevo, auditado e identificable | Mandato §2 | 2026-11-23 |
| **D-UX22-04** | Un workspace **sin proyecto puede seguirse**, pero **no resuelve** contexto hasta asociarse; la interfaz distingue «seguido» de «utilizable» | APPROVED | `project_id` puede ser `NULL`; nunca se crean proyectos automáticamente | Mandato §2 | 2026-11-23 |
| **D-UX22-05** | **`pa_selection` se conserva como selección visual** del panel; no es seguimiento, ni autorización, ni selección para todas las sesiones, ni garantía de lo que usan las herramientas | APPROVED | Resuelve la contradicción C1: la selección de perfil es de vista | Mandato §2 | 2026-11-23 |
| **D-UX22-06** | **Seguimiento y autorización completamente independientes**: activar seguimiento no crea raíces, no toca `trusted_roots`, no crea grants, no autoriza subcarpetas, no lee, no ingiere, no reindexa | APPROVED | Prueba negativa obligatoria en la aceptación | Mandato §2 | 2026-11-23 |

## 1.2 Decisiones de detalle UX-2.2 aprobadas (mandato de resolución, 2026-11-23)

Todas con resolución **A**. Son normativas para el diseño; **ninguna** es una implementación.

| ID | Decisión | Estado | Fuente |
|---|---|---|---|
| **D-UX22-07** | Identidad primaria por **`path_key`**; `workspace_id` = alias auxiliar; cambio de ruta **no** reasocia automáticamente; identidad/ubicación nueva exige reconciliación explícita | APPROVED (A) | Mandato §2 |
| **D-UX22-08** | **Dos ejes independientes** — seguimiento `on/off/paused` y disponibilidad `ok/missing/unknown`; `missing` ≠ `off`; `paused` no resuelve; la disponibilidad **no** cambia la preferencia humana | APPROVED (A) | Mandato §2 |
| **D-UX22-09** | Reasociación **explícita y humana**, auditada (anterior, nueva, actor, momento); **no** migra, fusiona ni reasigna conocimiento; las fuentes conservan su proyecto de origen | APPROVED (A) | Mandato §2 |
| **D-UX22-10** | API humana `GET/PUT/DELETE /pa/tracking`, mutaciones con **CAS**, con autenticación/autorización/**CSRF**, evolución **`pa/1.5.0`** aditiva; contratos anteriores intactos | APPROVED (A) | Mandato §2 |
| **D-UX22-11** | Acciones humanas auditables **`enable`, `disable`, `pause`, `resume`, `reassociate`**; la reconciliación técnica se distingue y **nunca** se atribuye al usuario | APPROVED (A) | Mandato §2 |
| **D-UX22-12** | Precedencia: `session_scope` → workspace seguido de la sesión → `cwd` ∩ raíces → frontera → no resuelto. La selección explícita **prevalece** y la discrepancia se audita; `scope-conflict` **sólo** seguido-vs-`cwd`; `pa_selection` **no** participa | APPROVED (A) | Mandato §2 |
| **D-UX22-13** | Opción A **limitada exactamente** a `<REPO_ROOT>` → proyecto existente «LifeCode RAG»; **condicionada a aprobación humana de la operación** | APPROVED (A) · operación **PENDING** | Mandato §3; `UX-22-ROOT-PROPOSAL.md` |

## 2. Decisiones anteriores vigentes (no se reabren)

| ID | Decisión | Estado | Impacto / nota | Fuente |
|---|---|---|---|---|
| **O-PAR-1** | Contrato **v0.3** para ampliaciones; **v0.1 congelado** | APPROVED | Las ampliaciones no rompen v0.1 | `PROJECT-AWARE-ARCHITECTURE.md` §1 |
| **O-PAR-2** | Selección **por sesión** (`session_scope`); sin selección global; `cwd` sólo como resolución inequívoca | APPROVED | **Vigente para la resolución de las herramientas.** `CR-1` añadió después una selección **de perfil** para el panel: no la sustituye (ver contradicción C1 en `ESTADO-IMPLEMENTACION.md` §6) | ídem |
| **O-PAR-3** | **Bibliotecas anidadas prohibidas**: sólo `Proyecto — Biblioteca`, grants directos, sin herencia transitiva | APPROVED | Fija la forma de UX-4 | ídem |
| **O-PAR-4** | **Un registro por perfil**; sin acceso cruzado entre perfiles | APPROVED | Cada perfil es un mundo | ídem |
| **O-PAR-5** | `missing` automático **sin borrado**; el olvido definitivo exige aprobación | APPROVED | Base de UX-2.2 para workspace ausente | ídem |
| **O-PAR-6** | Máximo **8 ámbitos** por consulta (1 proyecto + 7 bibliotecas) | APPROVED | `scope-too-many` antes de abrir almacenes | ídem |
| **C7** | **Auditoría por ámbito** (registro audita registro/grants/sesiones; cada ámbito lo suyo; sin `audit.jsonl` global) | APPROVED | Toda escritura nueva debe auditarse donde corresponde | ídem |
| **C8** | **Ciclo de vida de sesión formal**; la selección no la crea el modelo | APPROVED | El modelo nunca selecciona proyecto | ídem |
| **O-PA0-1** | **Cerrada** en el contrato de datos §3: una sola tabla `roots` con pertenencia por `CHECK`, disparadores y FK compuesta desde `sync_state` | APPROVED | Esquema vigente | `PROJECT-AWARE-ARCHITECTURE.md` §15 |
| **O-PA0-2** | **Resuelta**: raíz del perfil = `LIFECODE_RAG_ROOT` o `$DSH_HOME/lifecode-rag/profiles/<profileKey>/` | APPROVED | Ubicación del registro | ídem |
| **CR-1** | Selección de proyecto **persistida con CAS por revisión** (una fila por perfil, `revision` monotónica) | APPROVED · **implementada** | Es la selección del **panel**; las herramientas no la leen | `lib/selection.mjs:2-14`, `lib/registry-schema.mjs:111` |
| **D-PA6-02** | **Puerta léxica** del contexto automático: sin señal léxica no se inyecta contexto | APPROVED · implementada | Evita ruido y gasto de tokens | `lib/auto-context.mjs:181-195` |
| **D-PA6-04** | En un perfil Project-Aware **no se crea** el almacén legado v0.2 | APPROVED · implementada | Dos almacenes distintos confundirían al modelo | `index.js:209-217` |
| **D-PA6-09** | **Una sola raíz de datos**: herramientas y programador usan la raíz del perfil | APPROVED · implementada | Evita el `no-registry` silencioso | `PROJECT-AWARE-ARCHITECTURE.md:510` |
| **D-UX-13** | Ninguna vista del panel se elimina al añadir otra | APPROVED · implementada | Continuidad de la interfaz | `client.js` (comentarios de las vistas) |
| **D-UX-14** | Rutas de workspace **truncadas con «Mostrar ruta» y «Copiar ruta»** | APPROVED · implementada con defectos conocidos | Ver P-03: la copia no escribe en el portapapeles y el recorte CSS no se anula | `client.js` (`PaPath`), auditoría PA01 |
| **D-UX-19=B** | El **recorrido recursivo y las reglas de frontera de ingesta** quedan **fuera** de UX-2.1 y pertenecen a UX-2.2 | APPROVED | Delimita el alcance de UX-2.1 | Mandato UX-2.1 (**no consta en el repositorio**) |
| **D-INS-01** | Entrega al perfil por **vía quirúrgica** (tarball verificado + directorio + tres entradas del lock), sin `pnpm add` | APPROVED · ejecutada | Cómo se instala en DSH real | Mandato de instalación (**no consta en el repositorio**) |

## 3. Decisiones abiertas (no decididas)

| ID | Cuestión | Estado | Propuesta (no aprobada) | Fuente |
|---|---|---|---|---|
| **O-PA0-3** | Retención de filas `session_scope` expiradas | PENDING | 90 días | `PROJECT-AWARE-ARCHITECTURE.md` §15 |
| **O-PA0-4** | Transiciones válidas de `store_state` y quién puede moverlas | PENDING | — | ídem |
| **O-PA0-5** | Presupuesto de latencia y memoria para 8 ámbitos | PENDING | — | ídem |
| **D-DOC-01** | ¿Se enlazan estos documentos de continuidad desde `README.md` y se añaden a `files` del paquete? | PENDING | sí, en un acto de publicación aparte (cambia el manifiesto) | Acto documental 2026-11-23 |

### 3.1 Numeración provisional anterior — SUSTITUIDA

El acto documental del 2026-11-23 registró **cuatro** preguntas abiertas con los identificadores `D-UX22-01…04` y
temas distintos a los que el propietario asignó después. Esa numeración queda **`SUPERSEDED`**: no se borra para
que nadie cite de memoria un identificador con el significado equivocado.

| Uso provisional (acto documental) | Sustituido por (mandato del propietario) |
|---|---|
| `D-UX22-01` = conflicto seguido vs `cwd` | **`D-UX22-03`** (APPROVED: `scope-conflict`) |
| `D-UX22-02` = seguir un workspace sin proyecto | **`D-UX22-04`** (APPROVED: se puede, no resuelve) |
| `D-UX22-03` = ¿perfil o sesión? | **`D-UX22-01`** + **`D-UX22-02`** (APPROVED: perfil para el estado, sesión para la resolución) |
| `D-UX22-04` = papel de `pa_selection` | **`D-UX22-05`** (APPROVED: selección visual) |

### 3.2 Lo que sigue pendiente en UX-2.2 (nada de esto está decidido)

| ID | Pregunta | Estado | Nota |
|---|---|---|---|
| **D-UX22-13 (operación)** | Aprobar o rechazar la **operación exacta** de raíz: `root add --project prj_01M7RBSRD33M26HGBEFW51WPP6 --path "<REPO_ROOT>"` | **PENDING** | propuesta de 10 puntos en `UX-22-ROOT-PROPOSAL.md`; **bloquea toda lectura real** en esa ruta |
| **D-UX22-BLOCKER-01** | Verificación y autorización de la raíz `plugins-dhs-release` | **PENDING** | mismo objeto que lo anterior; medido: dos árboles del mismo repositorio git, una sola raíz confiable (`plugins-dhs`), y `…-release` **sin** raíz de proyecto |
| **PROPUESTA-SQL** | Forma exacta de la tabla `workspace_tracking` (registro v3) | PROPUESTA | `UX-22-TRACKING-SPEC.md` §5; ninguna decisión la fijó |
| **D-UX22-08 (detalle)** | Si `missing` puede volver a `ok` en la misma reconciliación | PROPUESTA | deriva de `08 = A`; se concretará al escribir las pruebas |

## 4. Historial del registro

| Fecha | Cambio |
|---|---|
| 2026-11-23 | Creación del registro. Se incorporan las decisiones de producto del mandato de continuidad (`D-CONT-01…07`) y se recogen las decisiones previas con su fuente, **sin reinterpretarlas**. Se añaden las abiertas de UX-2.2 (`D-UX22-01…04`) como `PENDING`, con propuesta explícitamente no aprobada. |
| 2026-11-23 | **Resolución del propietario**: `D-UX22-01…06` **APPROVED** (§1.1) con numeración propia. La numeración provisional de cuatro preguntas queda `SUPERSEDED` (§3.1). Se abren `D-UX22-07…13` y `D-UX22-BLOCKER-01` como `PENDING`. Se crea `UX-22-TRACKING-SPEC.md` con la especificación y los detalles aún no aprobados. |
| 2026-11-23 | **Segunda resolución**: `D-UX22-07…13 = A` **APPROVED** (§1.2), integradas como normativas en la especificación. `D-UX22-13` queda decidida **sólo como propuesta documental** y su **operación** sigue `PENDING` con la propuesta de 10 puntos en `UX-22-ROOT-PROPOSAL.md`. Sólo quedan abiertas la operación de raíz, `BLOCKER-01` y la forma exacta del SQL. |
| 2026-11-23 | **Auditoría independiente de UX-2.2 (dictamen NO APTO)**. Se sustituye `D-IMPL-05` por **`D-IMPL-05-R1`** (fence CSRF en todas las mutaciones), se **cierra `P-UX22-01`** con evidencia en `tests/pa-api.test.mjs`, y se añade **`D-IMPL-09`** (la reconciliación sólo anota lo medido). Las correcciones F1-F7 y F14 quedan registradas en `plans/UX-02/UX-22-IMPL-2026-11-23/ACEPTACION-UX22.md` §Defectos |

> **Nota de honestidad documental:** `D-UX-19=B` y `D-INS-01` provienen de mandatos del propietario que **no están
> en el repositorio**. Se registran con esa advertencia para que nadie los cite como si fueran documentación del
> producto. Si se quieren consolidar, hay que traer su texto a `docs/` en un acto aparte.

---

## 5. Decisiones técnicas de implementación — UX-2.2 (acto 2026-11-23)

Tomadas por el arquitecto bajo el mandato «Completación integral del producto» (§1, §7-FASE 2, §8). **Resuelven**
huecos que la especificación dejaba abiertos; ninguna reabre una decisión del propietario (`D-CONT-*`, `D-UX22-*`).
Detalle y justificación completa en `plans/UX-02/UX-22-IMPL-2026-11-23/IMPLEMENTATION-PLAN.md` §2.

| ID | Decisión | Estado | Sustituye / cierra | Impacto |
|---|---|---|---|---|
| **D-IMPL-01** | Forma exacta de `workspace_tracking`: PK `path_key`, `path TEXT` añadido para la UI, `association` con tres valores pero `'conflict'` no producible en UX-2.2, índices por `project_id` y `(state,last_status)` | APPROVED | `PROPUESTA-SQL` (§3.2) | Registro v3 aditivo |
| **D-IMPL-02** | El **sistema nunca crea filas** de seguimiento; sólo `PUT` humano. Un movimiento deja la fila antigua en `missing` y la ruta nueva sin seguimiento | APPROVED | Contradicción `UX-22-TRACKING-SPEC.md:90` vs `bound_by CHECK('human')` | Conserva `D-UX22-09` |
| **D-IMPL-03** | El eje B se reconcilia **en la resolución** (`resolveScope`, que ya audita), **nunca en un `GET`**; `GET /pa/workspaces` sigue siendo no-escritor | APPROVED | `SPEC:98-100` (contradecía `API:893-896` y dos pruebas vigentes) | Disponibilidad con desfase declarado |
| **D-IMPL-04** | CAS **obligatorio** en `PUT` (`0` = crear) y en `DELETE`; códigos `revision-conflict`/`not-found`/`invalid-argument` reutilizados; el único código nuevo es `scope-conflict` | APPROVED | `SPEC:220-231` (CAS opcional/imposible y tres códigos duplicados) | Biyección de `error-codes` intacta |
| **D-IMPL-05** | `PUT`/`DELETE /pa/tracking` exigen `content-type` JSON + `x-lifecode-rag: 1`; las mutaciones heredadas no se retrofitean en esta fase (`P-UX22-01`) | **SUPERSEDED por `D-IMPL-05-R1`** (2026-11-23) | `SPEC:221-222` (exigía CSRF sin artefacto) | CSRF parcial, declarado |
| **D-IMPL-05-R1** | El fence CSRF (`content-type` JSON + `x-lifecode-rag: 1`) se aplica a **todas** las mutaciones humanas de la API PA: `/tracking` (PUT/DELETE) y los `POST` heredados (`/selection`, `/projects`, `/projects/archive`, `/projects/restore`, `/roots`, `/roots/remove`, `/projects/register`). `/search` y `/context` quedan fuera por ser lecturas (`POST_READ_ROUTES`). `PATCH /projects` queda fuera: un navegador no puede emitirlo sin preflight CORS | APPROVED | `SPEC:221-222`; auditoría independiente F6 | **Cambio de comportamiento declarado** en rutas `pa/1.4.0`: sin cabecera pasan de atender a `403 forbidden` con `details.reason='csrf'`. Las pruebas previas se ajustaron añadiendo la cabecera al *fixture*, nunca debilitando el fence. Orden: autenticación → CSRF → validación → operación |
| **D-IMPL-06** | Se **mantiene** la guarda `store-version-unsupported`; la vuelta atrás v3→v2 se documenta (restaurar respaldo o fijar los dos marcadores de versión). Se corrige la afirmación de `SPEC:204` | APPROVED | `SPEC:204-205` (afirmaba que v2 ignora v3: es falso) | Reversión no automática, documentada |
| **D-IMPL-07** | Una sola canonicalización de ruta: se calcula al escribir, se **congela** con la fila y la reconciliación nunca la reescribe | APPROVED | Doble semántica `pathKeyFor` vs `pathKeyOf` | `missing` no deriva |
| **D-IMPL-11** | El artefacto con UX-2.2 se publica como **1.5.0**, no como 1.4.0: el 1.4.0 aprobado (`7bbecb09…`, 75 ficheros) es **inmutable** y este contenido cambia el contrato PA (`pa/1.4.0 → pa/1.5.0`) y el registro (v2 → v3). Mismo nombre no puede identificar dos artefactos | APPROVED | Auditoría del artefacto (B1) | El 1.4.0 aprobado no se toca ni se reempaqueta; el perfil instalado sigue en 1.4.0 hasta el acto de instalación de 1.5.0 |
| **D-IMPL-10** | El eje B (disponibilidad) se mide **sólo al resolver** y en producción únicamente promociona a `ok`: ningún camino escribe `missing` ni `unknown` hasta que exista un barrido (UX-2.1/UX-3). Se declara como limitación del release (L1), no como capacidad | APPROVED | Auditoría B5/N1 | El panel puede mostrar un estado obsoleto de disponibilidad; **no** otorga acceso, porque el escalón 2 exige que el Host liste el workspace |
| **D-IMPL-09** | La reconciliación de disponibilidad **sólo anota lo que midió**: la lista del Host omite los workspaces cuyo `status()` falla, así que la ausencia en ella **no** prueba ausencia en disco. En la resolución sólo se escribe `ok`; `missing` exige una medición propia (proyección de UX-2.1 o barrido explícito) | APPROVED | Auditoría F4 (`D-UX22-08`: `unknown` = no se pudo comprobar) | Elimina el falso `missing` por timeout transitorio; `path` tampoco se reescribe al reconciliar (`D-IMPL-07`, F7) |
| **D-IMPL-08** | `pa/1.5.0` aditiva; compatibilidad `pa/1.3.0` y `pa/1.4.0` verificada por las pruebas existentes | APPROVED | — | Contratos anteriores intactos |
| **P-UX22-01** | Deuda: extender el fence CSRF a las mutaciones heredadas | **CERRADA (2026-11-23)** | `D-IMPL-05-R1` | Absorbida por `D-IMPL-05-R1`; evidencia en `tests/pa-api.test.mjs` (7 mutaciones, orden auth→CSRF→validación, `/search` y `/context` fuera) |
| **D-IMPL-12** | El **registro se garantiza al cargar el plugin**: `apply()` llama una vez a `ensureRegistry({ root })` (`lib/registry.mjs`), que abre con `create: true` idempotente, lo cierra y devuelve `{ path, created, tables, version }`; se ejecuta **antes** de registrar herramientas y rutas. Crea el **contenedor**, nunca contenido: ni proyectos, ni bibliotecas, ni raíces, ni filas de seguimiento — un perfil nuevo pasa a v3 **sin datos**. Si falla de verdad (permisos, corrupción, versión más nueva) el error se propaga a `apply`, que lo registra y sigue cargando: el fallo se sigue viendo en la API | APPROVED | Defecto de inicialización: en un perfil recién instalado `registry.sqlite3` no existía y **todos** los caminos abren con `create: false` (`lib/exec-context.mjs`, `lib/pa-api.mjs`, `lib/sync-scheduler.mjs`), así que las cinco vistas del panel y las siete herramientas respondían `registry-unavailable` (503) para siempre; sólo `lib/migrate.mjs` creaba registro y no se ejecuta al instalar | El registro deja de depender de un perfil heredado o de ejecutar la CLI de migración. Idempotencia medida (segunda llamada no reescribe el fichero, no añade tablas, no cambia `user_version`), contenido previo intacto, y el síntoma fijado de punta a punta (`GET /pa/tracking`: 503 → 200 con `items` vacíos) en `tests/bootstrap.test.mjs` |
