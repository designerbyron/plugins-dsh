> **Nota (2026-11-23):** este documento describe las extensiones introducidas en la versión **1.4.0**.
> Sigue vigente tal cual dentro de **1.5.0**: ninguna de ellas se retira ni cambia de forma.

# Extensiones y correcciones sobre el contrato v0.1 (borrador 1.4.0 — **no publicado**)

**Fecha:** 2026-11-23 · **Rama:** `release/lifecode-rag-1.0.0` · **Base:** paquete `1.3.0`, almacén v3, registro v2, API `pa/1.4.0`
**Estado:** **implementado en el árbol de trabajo y verificado por pruebas; NO publicado, NO instalado.**

> El contrato **v0.1 sigue vigente y congelado**. Este documento registra únicamente lo que cambia de forma
> **aditiva** o lo que se corrige, con su compatibilidad demostrada. `search` es el caso más delicado: su valor y
> sus filas **no ganan ni pierden campos** (hay dos pruebas que lo congelan y siguen en verde).

---

## 1. Cambios observables por herramienta

| Herramienta | Cambio | Tipo | Compatibilidad |
|---|---|---|---|
| `search` | `mode` puede valer **`lexical-fallback`** cuando el canal semántico falla por causa recuperable | valor nuevo en un campo existente | Las claves del valor siguen siendo `elapsedMs`, `mode`, `results`; las filas siguen teniendo 8 claves |
| `search` | La degradación se cuenta en la métrica **`query.fallback`** (`dim` = estrategia) | telemetría | No toca la respuesta |
| `ingest` | Cada fuente ingerida incluye `warnings[]` (`{code:'possible-secret', kind}`) | campo nuevo | Aditivo; nunca bloquea la ingesta |
| `ingest` | La identidad de una fuente incluye la **colección** (`UNIQUE (collection, uri)`) | corrección de comportamiento | Para `collection='default'` los identificadores son **los históricos**; sólo cambia que el mismo `uri` en otra colección ya no responde `unchanged` |
| `get` | `source.relUri` (ruta relativa a la raíz del ámbito) | campo nuevo | Aditivo; `uri` absoluta se conserva |
| `list` | Cada fila incluye `relUri` | campo nuevo | Aditivo; la consulta pasa de N+1 a un agregado |
| `forget` | El valor incluye `chunks` (recuento) | campo nuevo | Aditivo; el texto de respuesta es idéntico |
| `context` | Reutiliza los **vectores guardados** para MMR | interno | Mismo ranking; menos embeddings |
| `ingest` | Métrica `ingest.stage_ms` con `dim` ∈ `extract`/`chunk`/`embed`/`write` | telemetría | Aditivo |

**Sin cambios:** nombres y orden de las siete herramientas, parámetros (ninguno nuevo, ninguno eliminado),
`schema` del almacén (sigue v3), `application_id`, registro, API del panel (`pa/1.4.0`), códigos de error
existentes. `scope-conflict` **no** se introduce aquí: pertenece a UX-2.2 y sigue `PENDING`.

## 2. Correcciones de comportamiento

| # | Antes | Ahora | Por qué |
|---|---|---|---|
| 1 | Con el proveedor de embeddings caído, `search`/`context` fallaban enteros | Se sirve el canal léxico y se declara `mode='lexical-fallback'`; si el léxico tampoco tiene resultados, se propaga `embedding-failed` | Un canal opcional no puede tumbar la recuperación, pero tampoco puede disfrazar un vacío |
| 2 | `context` reembebía todos los candidatos para MMR | Reutiliza `vectors` del almacén (mismo `chunk_key`, `model` y `dim`); sólo calcula los ausentes | Coste y egreso duplicados |
| 3 | El mismo `uri` en otra colección se reportaba `unchanged` sin moverse | Se indexa en la colección pedida, con id propio | La identidad del esquema incluye la colección |
| 4 | `getSource` con `id = ? OR uri = ?` recorría la tabla | Primero por `id` (índice de la PK); por `uri` sólo si hace falta, y entonces exige que sea inequívoca | Plan medido: `SEARCH ... USING INDEX` en vez de `SCAN` |
| 5 | `list` hacía una subconsulta correlacionada por fila | Un agregado por JOIN | N+1 fuera; plan sin `CORRELATED` |
| 6 | `forget` guardaba el recuento en una variable del cierre | Viaja en el valor de la llamada | Dos `forget` concurrentes podían cruzar números |
| 7 | La sincronización ingería siempre en `default` | Reutiliza la colección de lo ya indexado (si el lote coincide en una) | Evita duplicar la misma ruta en dos colecciones |

## 3. Lo que **no** se cambió, y por qué (decisiones con evidencia)

| Propuesta de la auditoría | Decisión | Evidencia |
|---|---|---|
| Memoizar `quick_check` al abrir el almacén | **NO** | 12,9 ms medidos, pero con WAL el fichero principal puede no cambiar mientras hay páginas sin checkpoint: memoizar por `(ruta,size,mtime)` podría saltarse la detección de una corrupción recién confirmada. Se conserva la garantía actual |
| Reutilizar la búsqueda de la puerta léxica en el contexto automático | **NO** (de momento) | La puerta cuesta **0,40 ms** (`limit 1`) y **1,00 ms** (`limit 24`) medidos: el beneficio no paga el riesgo de cambiar qué se recupera |
| Activar `index_jobs` como ledger de ingesta | **NO** | Exigiría estados, transiciones y recuperación nuevas; hoy la re-ejecución es segura y barata porque el salto es por `(colección, uri, sha256)`. Queda documentado como pendiente |
| Detección de secretos por contenido | **Sólo advertencia** de alta confianza | Bloquear por heurística débil rompería documentación legítima; el `warnings[]` informa sin impedir |
| ANN / pooling / caché entre llamadas | **NO** | 964 vectores puntuados en 1,07 ms; el aislamiento depende de abrir/cerrar y revalidar por llamada |

## 4. Pruebas que sostienen esta extensión

- `tests/reliability.test.mjs` (8): degradación declarada, errores no recuperables propagados, vacío léxico,
  estrategia vectorial, forma congelada de `search`, egreso denegado, reutilización de vectores, modelo distinto.
- `tests/optimizations.test.mjs` (8): dos colecciones sin colisión, idempotencia por colección, id derivado,
  `getSource` ambiguo, `forget` concurrente, etapas de ingesta, advertencia de secreto, `relUri` aditivo.
- Congelados que siguen en verde: `tests/partial-results.test.mjs:133` (valor de `search` sin campos de
  parcialidad) y `tests/search-diversity.test.mjs:205` (ocho claves por fila, sin `score`/`cosine`/`via`).

---

# Extensiones de 1.5.11 (F-1 y F-4)

**Fecha:** 2026-11-24 · **Base:** contrato v0.1 congelado, API `pa/1.5.0`, almacén v3, registro v3.
Las dos entradas son **aditivas**: ningún campo existente cambia de forma, de tipo ni de significado, y
ningún error existente cambia de código. Ambas nacen de defectos medidos en la aceptación funcional de
1.5.9 (expediente de aceptación funcional del propietario, fuera del árbol: no viaja en el paquete).

## 5. `get` acepta el `chunkKey` que devuelve `search` (F-4)

**Defecto medido.** `lifecode_rag_search` publica en cada resultado su `chunkKey`
(`<sourceId>#<ordinal>`, p. ej. `src_b3be94d572069f33#0`). `lifecode_rag_get` resolvía sólo `id`, `uri`
y título, así que la referencia que la herramienta anterior acababa de entregar respondía
`no existe una fuente con esa referencia en los ámbitos autorizados`. En la sesión real el modelo tuvo
que traducir el `chunkKey` a `sourceId` por su cuenta.

| Aspecto | Antes (1.5.9) | Ahora (1.5.11) |
|---|---|---|
| `ref` aceptadas | `id`, `uri` | `id`, `uri`, **`chunkKey`** |
| Respuesta con `chunkKey` | error | `source` (propietaria) + **ese** fragmento + `matched: {by:'chunk-key', ordinal}` |
| Respuesta con `id`/`uri` | `source` + todos los fragmentos | igual, sin `matched` |
| Fuente existe pero el ordinal no | — | `source-not-found` con `details.reason='chunk-not-found'`, `details.sourceId`, `details.ordinal` |
| Referencia malformada o ajena | `source-not-found` | igual |

**Orden de resolución (probado):** primero `id` exacto (un id nunca contiene `#`), después la forma de
`chunkKey` (`/^src_[A-Za-z0-9_-]+#\d+$/`), y sólo si ninguna casa se sigue con `uri`. Un fichero cuya
ruta contenga `#` no se confunde con un fragmento (`tests/get-chunk-key.test.mjs`).

**Lo que NO cambia:** el nombre de la herramienta, sus parámetros (`ref`, `limit`), el `source` que
devuelve y el significado de sus campos. `matched` es un campo **nuevo** que sólo aparece cuando la
referencia fue un `chunkKey`.

**Lo que `get` sigue sin aceptar (declarado, no olvidado):** el **título** no es una referencia válida
en `getSource`; nunca lo fue. Si se quiere resolver por título, es otra extensión y otra prueba.

Pruebas: `tests/get-chunk-key.test.mjs` (6) — `search`→`get` directo, ordinal por fragmento, id/URI
intactos, ordinal inexistente, referencias malformadas y ruta con `#`.

## 6. `/snapshot` publica `needsProjectSelection` (F-1)

**Defecto medido.** Con dos proyectos activos y ninguna selección, `/` y `/snapshot` respondían
`403 scope-ambiguous`; el panel lo presentaba como «Servicio: Sin conexión» y no ofrecía forma de
elegir: callejón sin salida con el servicio sano.

| Aspecto | Antes (1.5.9) | Ahora (1.5.11) |
|---|---|---|
| `GET /` y `GET /snapshot` con varios activos y sin selección | `403 scope-ambiguous` | `200` con `needsProjectSelection: true` |
| `project` | — | `null` (**sigue sin elegirse ninguno en silencio**) |
| `candidates` | — | `[{id, name}]` de los activos |
| `needsProjectSelectionReason` | — | `'scope-ambiguous'` |
| `service` | — | `'ok'` (la API y el registro están sanos) |
| `sources`, `scopes` | — | vacíos |
| Resto de rutas (`/search`, `/context`, `/history`) | `403/4xx` sin proyecto | **igual**: la ambigüedad no se resuelve sola en ninguna ruta |
| Perfil vacío | `200` con retrato vacío | igual, más `needsProjectSelection: false` |
| Proyecto resoluble | `200` | igual, más `needsProjectSelection: false` |

La decisión la sigue tomando la persona con `POST /selection` (CAS sobre la revisión, compuerta CSRF y
autorización del host intactas). `candidates` y `needsProjectSelectionReason` sólo aparecen en el
retrato ambiguo.

Pruebas: `tests/pa-api.test.mjs` (4 de F-1: dos activos sin selección, elección y aislamiento de
documentos, un solo proyecto, perfil sin activos), `tests/selection-cas.test.mjs` (CR-1 reescrito: la
ambigüedad no elige y las rutas de contenido siguen cerradas), `tests/panel-selection-retry.test.mjs`
(selector visible, elección con CAS, nunca «sin conexión»).
