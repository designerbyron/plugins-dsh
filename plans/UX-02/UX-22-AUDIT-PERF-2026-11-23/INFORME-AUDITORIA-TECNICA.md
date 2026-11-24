# Auditoría técnica comparativa — LifeCode RAG (referencia: PowerContext)

**Tipo:** auditoría de **sólo lectura** · **sin cambios** en código, datos, permisos ni git
**Repositorio:** `C:\xampp\htdocs\plugins-dhs-release` · rama `release/lifecode-rag-1.0.0` · **HEAD** `7d7e839d514cca27044d595218bf8c67ec5a1f7d`
**Producto:** paquete `1.3.0` · almacén esquema **v3** · registro **v2** · API `pa/1.4.0`
**Perfil medido:** `desktop` (aperturas `readOnly: true`)
**Fecha:** 2026-11-23

**Etiquetas:** `HECHO` (leído o medido) · `MEDIDO` (número tomado en este acto) · `INFERENCIA` · `PROPUESTA`
**Estados de la matriz:** `IMPLEMENTED_VERIFIED` · `IMPLEMENTED_PARTIAL` · `IMPLEMENTED_UNVERIFIED` · `MISSING` · `NOT_NEEDED` · `BLOCKED`

---

## 0. Resumen ejecutivo

**Lo que está bien y no hay que tocar.** El diseño es sólido donde más duele: atomicidad por fichero
(`ingest.mjs:179-198`), consistencia sources/chunks/vectores por transacción, FTS externa sin duplicar texto
(`schema.mjs:87-109`), fallo cerrado si una biblioteca autorizada no se puede leer
(`partial-results.test.mjs`), auditoría encadenada por hash, resolución de ámbito sin caché de autorización
(`exec-context.mjs:141-146`) y **964 vectores leídos y puntuados en 1,07 ms** — el coste vectorial hoy es
irrelevante. No hace falta ANN, ni pooling, ni caché entre llamadas: **no está demostrado y el aislamiento lo
haría peligroso**.

**Los cinco problemas reales, por orden de daño**

1. **No hay fallback de canal** (`search.mjs:254-269`): si el embedder falla, `search` y `context` **fallan
   enteros**, aunque FTS5 podría responder. Y el 100 % del contexto automático pasa por ahí
   (`auto-context.mjs:197`). Con `strategy: 'hybrid'` por defecto (`paths.mjs:25`), un proveedor remoto caído deja
   el producto sin recuperación.
2. **`context` vuelve a embeber los candidatos** (`context.mjs:135-148`) pese a que los vectores **ya están
   guardados** en la tabla `vectors`: egreso, latencia y coste duplicados en cada llamada y en cada turno del
   contexto automático.
3. **La identidad de una fuente ignora la colección**: `SELECT ... WHERE uri = ?` (`ingest.mjs:103`) contradice
   `UNIQUE (collection, uri)` (`schema.mjs:70`). Ingerir el mismo fichero en otra colección responde `unchanged`
   **sin moverlo**: la operación pedida no ocurre y nada lo dice.
4. **La apertura de cada almacén cuesta una comprobación de integridad completa**: `quick_check` **12,9 ms
   MEDIDOS** sobre 3,86 MB (`db.mjs:202`), una vez por almacén y por llamada. Con ocho ámbitos son ~103 ms de
   antesala antes de buscar nada.
5. **`sources` no tiene índice por `uri`**: `EXPLAIN QUERY PLAN` devuelve **SCAN sources** tanto para la
   deduplicación de `ingest` como para `getSource` (que además usa `id = ? OR uri = ?`, que anula la clave
   primaria). Se arregla **sin migración**.

**Lo que no hay que construir.** Nada de Atomic Memory, Handoff, Experience, Review Inbox ni Skills: es LifeCode
Brain. Tampoco herramientas nuevas: las siete cubren el ciclo y el problema es su comportamiento interno.

---

## 1. Baseline Git

| Dato | Valor |
|---|---|
| HEAD | `7d7e839d514cca27044d595218bf8c67ec5a1f7d` |
| Rama | `release/lifecode-rag-1.0.0` |
| Índice | vacío (0 en *staged*) |
| Worktree | **40 entradas sucias**: 18 `M` + 22 `??` |
| `M` fuera de `lifecode-rag/docs/` | **16**, todos preexistentes de UX-2.1 (`client.js`, `index.js`, `lib/*`, `tests/*`, `README.md`, `package.json`) |
| `M` en `lifecode-rag/docs/` | 2: `PA-UI-0-API-CONTRACT.md` (preexistente) y `PROJECT-AWARE-SESSION-CONTRACT.md` (acto documental previo) |
| `??` | 15 preexistentes + 7 documentos de continuidad/UX-2.2 |

Ninguna de esas entradas pertenece a esta auditoría: la auditoría no escribió en el worktree salvo este informe
(`plans/`, untracked).

---

## 2. Matriz de capacidades (obligatoria)

| ID | Capacidad | Estado actual | Evidencia | Limitación | Impacto | Recomendación |
|---|---|---|---|---|---|---|
| **PERF-01** | Batch queries | `IMPLEMENTED_PARTIAL` | `ingest.mjs:135-152` (statements preparados fuera del bucle; una transacción por fichero); `search.mjs:74` | No hay inserción por lotes multi-fichero: N transacciones con `synchronous=FULL` | Ingesta de 100 ficheros = 100 *commits* con fsync | No cambiar salvo medición; si molesta, agrupar por lotes de K ficheros manteniendo atomicidad por fichero |
| **PERF-02** | Reutilización de consultas | `IMPLEMENTED_PARTIAL` | `auto-context.mjs:186` + `:197` (dos recuperaciones por turno: puerta léxica y ensamblado) | El resultado de la puerta no se reutiliza | 2× FTS por turno con contexto automático | Reutilizar los `hits` léxicos de la puerta como entrada del ensamblado |
| **RET-01** | Recuperación híbrida | `IMPLEMENTED_VERIFIED` | `search.mjs:60-76` (BM25), `:79-102` (coseno), `:108-144` (RRF ponderada), `:243-248` (AND→OR); `search.test.mjs` | — | — | Ninguna |
| **RET-02** | Bounded retrieval | `IMPLEMENTED_PARTIAL` | `search.mjs:82,89-90,320` (`maxVectorScan` + `truncated`); `context.mjs:86-91,118` (presupuesto y `truncated`); `efficiency.test.mjs:67,70` | Por defecto `minScore: 0` y `maxPerSource: 0` (`paths.mjs:31-32`): se acota por número, **no por relevancia** | Ruido posible en los resultados | Fijar `minScore`/`maxPerSource` por configuración del perfil, no por código |
| **RET-03** | Diagnóstico de fallback | `MISSING` | `search.mjs:254-269` sin `try/catch` alrededor del embedder; `tools.mjs:191-211` no expone `diagnostics` | Si el canal semántico falla, no hay degradación a léxico; y el modelo no ve `truncated` ni los *hits* por canal | Fallo total de `search`/`context`/contexto automático con embedder caído | Fallback declarado (`mode:'lexical-fallback'`) + exponer `diagnostics` en la herramienta |
| **OBS-01** | Métricas de ingestión | `IMPLEMENTED_PARTIAL` | `ingest.mjs:190-196,225,231-233` (`ingest.documents/chunks/skipped/ms`, `errors` por código); `audit` por fuente (`:181-189`) | Sin tiempos por etapa (extracción, troceado, embeddings, escritura); sin tokens/coste de embeddings | Imposible saber dónde se va el tiempo en una ingesta lenta | Añadir `ingest.stage_ms` por etapa y `embed.tokens` cuando el proveedor lo declare |
| **OBS-02** | Diagnóstico por etapa | `IMPLEMENTED_PARTIAL` | `index_jobs` (`schema.mjs:34-42`) **no se escribe en ningún sitio**; `policies` sólo lo copia `recovery.mjs:233-235` | Dos tablas declaradas sin productor; el historial de trabajos sólo existe para automatización (`operations`/`operation_steps` del registro, `operations.mjs:24-40`) | Promesa de esquema no cumplida | O declarar `index_jobs` para la ingesta del modelo, o retirarla en una migración mayor |
| **ING-01** | Atomicidad | `IMPLEMENTED_VERIFIED` | `ingest.mjs:179-198` (una transacción por fichero: fuente + chunks + vectores + auditoría + métricas); `atomicity.test.mjs` («un fallo inyectado durante el reemplazo conserva la fuente anterior y su revisión»); `schema.mjs:69` (`indexed_at NOT NULL`) | — | — | Ninguna |
| **ING-02** | Idempotencia | `IMPLEMENTED_PARTIAL` | `ingest.mjs:103-116` (`sha256` + `unchanged`); `ingest.test.mjs:67` | La búsqueda del duplicado es **por `uri` sin colección** y contradice `UNIQUE (collection, uri)` | Ingerir a otra colección responde `unchanged` y no hace nada (defecto) | Consultar por `(collection, uri)` — arregla el defecto **y** usa el índice existente |
| **ING-03** | Reanudación | `IMPLEMENTED_PARTIAL` | Automatización: `operations.mjs:24-40,89-90` + `sync.mjs:306-327` (presupuesto, operaciones interrumpidas); herramienta: sólo idempotencia por `sha256` | La ingesta del modelo no registra lote ni pendientes; re-ejecutar es seguro pero no hay «quedan K de N» | Un lote cortado se reanuda a ciegas | Registrar lote (`index_jobs` o `operations`) y devolver `pending` en el resultado |
| **SEC-01** | Validación de Scope | `IMPLEMENTED_VERIFIED` | `exec-context.mjs:210-223` (reapertura revalida autorización), `:145-160` (`revalidate` sin caché); `revocation.test.mjs`, `partial-results.test.mjs`, `pa-auth.test.mjs` | — | — | Ninguna |
| **SEC-02** | Protección de secretos | `IMPLEMENTED_PARTIAL` | `policy.mjs:35-45` (denylist por nombre: `.env`, `secrets`, `credentials`), `:77-100` (symlink/junction, rutas protegidas, el propio almacén) | **No hay detección por contenido**; y las rutas absolutas se devuelven al modelo (`search.mjs:330`, `scope-ops.mjs:216-222`) | Un secreto con nombre inocente se indexa (declarado en `policy.mjs:27-29`) | Declararlo en el contrato; opcionalmente redactar `uri` a relativo en las respuestas de herramienta |
| **TOOL-01** | Eficiencia de las siete tools | `IMPLEMENTED_PARTIAL` | `tools.mjs:191-211` (proyección magra de `search`, **sin** `diagnostics`); `search.mjs:342` (`list` devuelve `s.*`: `sha256`, `metadata`, `char_count`); `tools.mjs:103,331,335` (`renderForget` global mutable) | Respuestas redundantes en `list`; `search` oculta su diagnóstico; `forget` comparte estado entre llamadas | Un agente no puede decidir si repetir la búsqueda; `list` gasta contexto; el recuento de `forget` puede ser de otra llamada | Proyectar `list`, exponer `diagnostics` en `search`, quitar el estado global de `forget` |

---

## 3. Hallazgos P0 (necesarios)

### P0-1 · Sin fallback cuando el canal semántico falla — `RET-03`

- **Archivo:** `lib/search.mjs:254-269`; afecta a `lib/scope-ops.mjs:67-120`, `lib/context.mjs` vía `scope-ops`, y al contexto automático (`lib/auto-context.mjs:197`).
- **Comportamiento observado:** en `hybrid` (valor por defecto, `paths.mjs:25`) se ejecuta FTS y después `await provider.embed(...)`. No hay `try/catch`: cualquier error del embedder (red, aprobación denegada, proveedor no disponible) **propaga** y `search`/`context` fallan enteros. `mode` sólo distingue `and`/`or`/`none`, nunca «léxico por caída del semántico».
- **Evidencia de tests:** **no hay** prueba de embedder que falla en `search.test.mjs` (grep sin coincidencias; `integration.test.mjs` menciona `embedder` pero no este caso). El comportamiento no está cubierto.
- **Limitación:** un canal opcional se comporta como requisito.
- **Impacto:** con proveedor remoto, una caída deja sin recuperación a las tres rutas (búsqueda, contexto y automático). Es el mayor riesgo de disponibilidad del producto.
- **Recomendación (mínima):** envolver el bloque semántico y, si falla, continuar con los resultados léxicos añadiendo `mode: 'lexical-fallback'` y `diagnostics.semantic.error` (código del error, sin mensaje crudo). Si el canal léxico tampoco devuelve nada, error como hoy.
- **Riesgo de regresión:** bajo. Cambia el contrato de `mode` (valor nuevo) → **aditivo**; `tool-golden.test.mjs` habría que ampliarlo.
- **Prueba propuesta:** «embedder que lanza → `search` devuelve resultados léxicos y `mode='lexical-fallback'`»; «embedder que lanza y sin hits léxicos → error del contrato, no resultado vacío».

### P0-2 · `context` re-embebe los candidatos aunque los vectores estén guardados — `PERF-03`

- **Archivo:** `lib/context.mjs:135-148` (`assembleContextAsync`), llamado desde `lib/scope-ops.mjs:141-147`.
- **Comportamiento observado:** para MMR, si hay `embedder` se llama `embedder.embed(candidates.map(text))`. Los vectores de esos mismos chunks **ya existen** en la tabla `vectors` del almacén (misma `model`), y `search` acaba de leerlos.
- **Evidencia de tests:** `context-lossless.test.mjs` y `budget-exhaustion.test.mjs` cubren formato y presupuesto, **no** el número de llamadas al embedder.
- **Limitación:** se paga dos veces por el mismo contenido.
- **Impacto:** con proveedor remoto, cada `context` (y cada turno del automático) hace **1 + N** embeddings en lugar de 1; con `maxChunks=12` y 3× candidatos, hasta 37 textos. Coste, latencia y egreso.
- **Recomendación:** leer de `vectors` por `chunk_key` y `model`; embeber sólo los que falten (p. ej. tras cambiar de modelo). Fallback al comportamiento actual si no hay fila.
- **Riesgo de regresión:** bajo; el resultado de MMR puede cambiar ligeramente si los vectores guardados son de otra versión de modelo → usar `model` exacto y `dim`.
- **Prueba propuesta:** «`context` con todos los vectores presentes llama al embedder **una** vez (la consulta)»; «si falta un vector, lo calcula y no falla».

### P0-3 · La identidad de fuente ignora la colección — `ING-02`

- **Archivo:** `lib/ingest.mjs:103` (`SELECT id, sha256 FROM sources WHERE uri = ?`) frente a `lib/schema.mjs:57-71` (`UNIQUE (collection, uri)`).
- **Comportamiento observado:** con el mismo `uri` ya indexado en `collection='default'`, una ingesta a `collection='otra'` encuentra la fila existente; si el `sha256` coincide y las etiquetas no cambian devuelve `{skipped:true, reason:'unchanged'}` **sin tocar la colección**. El fichero no entra en la colección pedida y la respuesta dice que todo está bien.
- **Evidencia de tests:** `ingest.test.mjs:67` prueba `unchanged` con la misma colección; **no hay** caso de dos colecciones (grep `collection` sólo devuelve la comprobación del valor por defecto, `:44`).
- **Limitación:** la intención del esquema (identidad por colección) no es la del código.
- **Impacto:** defecto silencioso; filtros por `collection` no ven lo que el usuario cree haber ingerido.
- **Recomendación:** consultar por `(collection, uri)` — dos cambios: la consulta y (si se quiere conservar el comportamiento actual) un caso explícito de «existe en otra colección» en el resultado.
- **Riesgo de regresión:** **medio** — cambia la semántica para quien dependiera de que un `uri` fuera único en el almacén. Hoy ningún test lo asume.
- **Prueba propuesta:** «mismo fichero en dos colecciones → dos fuentes, dos `id`, y `list` lo ve en ambas»; «misma colección, mismo contenido → `unchanged`» (regresión).

### P0-4 · Estado mutable compartido en `forget` — `TOOL-01c`

- **Archivo:** `lib/tools.mjs:103` (declaración), `:331` (asignación) y `:335` (lectura en `render`).
- **Comportamiento observado:** el recuento de chunks se guarda en una variable de **módulo** y el `render` lo lee después. Dos llamadas concurrentes en el mismo proceso pueden cruzar el número: la respuesta dice «eliminada X (N chunks)» con el N de otra fuente.
- **Evidencia de tests:** ninguno cubre concurrencia de `forget` (el nombre de la herramienta aparece en `tool-golden`, no en `concurrency.test.mjs`).
- **Impacto:** dato incorrecto en una respuesta que el humano usa para confirmar un borrado.
- **Recomendación:** devolver el recuento dentro del valor (campo adicional del contrato v0.3) o pasarlo por el contexto de la llamada, nunca por variable de módulo.
- **Riesgo de regresión:** bajo.
- **Prueba propuesta:** «dos `forget` solapados informan cada uno de su propio recuento».

## 4. Hallazgos P1 (importantes)

### P1-1 · `quick_check` en cada apertura — `PERF-01`

- **Archivo:** `lib/db.mjs:202` (dentro de `openDatabase`), usado por `withDatabase` (`:302-308`) y por `ctx.open` (`exec-context.mjs:218`).
- **MEDIDO:** `PRAGMA quick_check` = **12,90 ms** de media en 20 ejecuciones sobre el almacén real del proyecto «LifeCode RAG» (3 862 528 B, 121 fuentes, 964 chunks, 964 vectores). `tableNames` = 0,017 ms (despreciable). Un almacén por llamada → ~13 ms; ocho ámbitos → **~103 ms** antes de leer.
- **Evidencia de tests:** `efficiency.test.mjs` («ocho ámbitos: se abren, se leen y se cierran sin dejar asas» y «resolución y búsqueda con ocho ámbitos quedan dentro de los umbrales medidos») ya mide umbrales; `recovery.test.mjs` cubre el caso corrupto.
- **Limitación:** el chequeo íntegro es O(base) y se paga en cada llamada, incluidas las de sólo lectura.
- **Impacto:** hoy ~13 ms por herramienta (con 1 ámbito efectivo: 0 bibliotecas, 0 grants); proporción alta frente al coste real de puntuar el almacén completo (**1,07 ms MEDIDOS**: decodificar 964 BLOB de 256 dimensiones cuesta 0,79 ms y añadir el coseno sube a 1,07 ms, mejor de 5 pasadas). No es el cuello de botella aún, pero escala con el tamaño del almacén.
- **Recomendación:** memoizar el resultado de `quick_check` **por proceso y por (ruta, tamaño, mtime)** con invalidación en `mtime`/`size` distintos, manteniendo `assertAuditHead` (que es O(1) con el índice de `seq`) en cada apertura. No cachear autorización: eso ya está bien resuelto y no se toca.
- **Riesgo de regresión:** medio si la memoización se olvida invalidar (una corrupción aparecida con el fichero abierto no se detectaría hasta la siguiente). Mitigación: comparar `size` y `mtime` en cada apertura.
- **Prueba propuesta:** «segunda apertura con el mismo fichero no repite `quick_check`»; «tocar el fichero invalida la memoización»; «un fichero corrupto se sigue rechazando».

### P1-2 · `sources` sin índice por `uri`, y `OR` que anula la clave primaria — `PERF-02`

- **Archivo:** `lib/ingest.mjs:103`; `lib/search.mjs:330` (`getSource`: `WHERE id = ? OR uri = ?`); `lib/schema.mjs:57-71`.
- **MEDIDO (EXPLAIN QUERY PLAN, conexión `readOnly`):**
  - `SELECT id, sha256 FROM sources WHERE uri = ?` → **`SCAN sources`**
  - `SELECT * FROM sources WHERE id = ? OR uri = ?` → **`SCAN sources`**
  - `SELECT ... FROM vectors WHERE model = ?` → `SEARCH v USING INDEX vectors_model (model=?)`
- **Evidencia de tests:** `ingest.test.mjs` y `search.test.mjs` cubren corrección, no plan.
- **Impacto:** hoy 121 filas (trivial); con miles de fuentes, cada fichero ingerido y cada `get` recorre la tabla entera.
- **Recomendación:** (a) `ingest`: consultar por `(collection, uri)` — usa el `UNIQUE` y arregla P0-3; (b) `getSource`: `SELECT ... WHERE id = ? UNION ALL SELECT ... WHERE uri = ?` para que cada rama use su índice. **Sin migración de esquema.**
- **Riesgo de regresión:** bajo; el `UNION ALL` cambia el orden de preferencia si un id coincide con otra uri (imposible en la práctica: `id` es `src_…`).
- **Prueba propuesta:** «plan de `getSource` usa índice en ambas ramas» (aserción sobre `EXPLAIN QUERY PLAN`) y «`get` por id y por uri devuelven lo mismo».

### P1-3 · N+1 en `list` — `PERF-04`

- **Archivo:** `lib/search.mjs:341-343`.
- **MEDIDO (EXPLAIN):** `SCAN s` + **`CORRELATED SCALAR SUBQUERY`** + `SEARCH c USING COVERING INDEX chunks_source` + `USE TEMP B-TREE FOR ORDER BY`.
- **Impacto:** una subconsulta por fila (hasta 200) y una ordenación temporal; y `list` devuelve `s.*`.
- **Recomendación:** `LEFT JOIN (SELECT source_id, COUNT(*) n FROM chunks GROUP BY source_id)` y proyección explícita de columnas.
- **Riesgo:** bajo. **Prueba:** «`list` con 200 fuentes hace una sola consulta de agregado» (contar sentencias con un espía) y «mismo resultado que hoy».

### P1-4 · Doble recuperación en el contexto automático — `PERF-02`

- **Archivo:** `lib/auto-context.mjs:186` (búsqueda léxica de la puerta) y `:197` (ensamblado, que vuelve a buscar en híbrido).
- **Impacto:** 2× FTS y un embedding de consulta extra por turno; con P0-2 encima, es el camino más caro del producto y el más frecuente (cada turno con señal léxica).
- **Recomendación:** que la puerta devuelva los `hits` y el ensamblado los reutilice cuando la estrategia efectiva sea léxica; si es híbrida, al menos reutilizar el `queryVector`.
- **Riesgo:** medio (cambia qué se recupera). **Prueba:** «una sola consulta FTS por turno» + «el texto inyectado no cambia para la misma consulta y corpus».

### P1-5 · Observabilidad: falta el desglose por etapa y el coste — `OBS-01`

- **Archivo:** `lib/ingest.mjs:190-196,225,231-233`; `lib/metrics.mjs`; `lib/embedders.mjs`.
- **Observado:** hay `ingest.documents`, `ingest.chunks`, `ingest.skipped`, `ingest.ms`, `errors` (nombre sin prefijo `ingest.`, inconsistente), `query.*`, `context.*`, `automation.*`. **No** hay tiempos por etapa ni tokens/coste de embeddings (el proveedor local `local-hash-v1` no los tiene; uno remoto sí podría declararlos).
- **Impacto:** no se puede responder «¿dónde se fue el tiempo de esta ingesta?» sin instrumentar.
- **Recomendación:** `ingest.stage_ms` con `dim` ∈ {extract, chunk, embed, write} y `embed.requests`/`embed.tokens` si el proveedor lo expone. Aditivo; no toca el contrato de herramientas.
- **Riesgo:** bajo (métricas ya tolerantes a fallo, `search.mjs:200-212`).

### P1-6 · Reanudación de la ingesta del modelo — `ING-03`

- **Archivo:** `lib/ingest.mjs:155-239` frente a `lib/operations.mjs:24-40` y `lib/sync.mjs:306-327`.
- **Observado:** la automatización tiene *ledger* (`operations`/`operation_steps`) con presupuesto y listado de interrumpidas; la herramienta `ingest` no registra lote: sólo deja cada fichero confirmado.
- **Impacto:** tras un corte, el agente no sabe qué falta; re-ejecutar es seguro (idempotente) pero recorre todo.
- **Recomendación:** registrar el lote (reutilizando `index_jobs`, hoy sin uso) y devolver `pending` con los ficheros no procesados.
- **Riesgo:** bajo. **Prueba:** «lote de 5 con fallo en el 3 → `pending` contiene 4 y 5; segunda pasada no duplica».

### P1-7 · Secretos por contenido y rutas absolutas — `SEC-02`

- **Archivo:** `lib/policy.mjs:27-45` (denylist por nombre), `:77-100` (symlink/junction, rutas protegidas, el propio almacén); `lib/search.mjs:330` y `lib/scope-ops.mjs:216-222` (uri absoluta en el resultado).
- **Observado:** la protección es **por nombre**, y el propio módulo lo declara como límite (`policy.mjs:27-29`). No hay inspección de contenido (claves PEM, tokens con forma conocida).
- **Impacto:** un `.md` con una clave pegada se indexa y se sirve al modelo.
- **Recomendación:** no bloquear (falsos positivos caros); **declararlo** en el contrato y en la UI, y opcionalmente una comprobación de patrones de alta confianza (`-----BEGIN … PRIVATE KEY-----`, `sk-…`) que **avise** en el resultado de `ingest` sin impedir la operación.
- **Riesgo:** bajo si sólo avisa.

## 5. Hallazgos P2 (opcionales) y NOT_REQUIRED

| ID | Hallazgo | Estado | Por qué no es P0/P1 |
|---|---|---|---|
| `PERF-05` | Con `maxVectorScan` superado, el escaneo recorre los vectores **en orden de inserción** (el plan usa `vectors_model`, índice `(model, rowid)`), así que se descarta lo más **nuevo** y `truncated` sólo avisa | MEDIDO (EXPLAIN) + INFERENCIA | Hoy 964 ≪ 20 000; no ocurre. Recomendación: orden explícito y documentar el sesgo |
| `OBS-02` | `index_jobs` no se escribe nunca; `policies` sólo lo copia `recovery.mjs` | HECHO | No afecta comportamiento; sí a la promesa del esquema |
| `RET-02a` | `minScore: 0` y `maxPerSource: 0` por defecto: sin corte por relevancia | HECHO (`paths.mjs:31-32`) | Decisión de producto; se ajusta en configuración |
| `TOOL-01a` | `search` no expone `diagnostics` (sí `mode` y `elapsedMs`) | HECHO (`tools.mjs:191-211`) | Una línea de contrato aditivo; se agrupa con P0-1 |
| `TOOL-01b` | `list` devuelve `s.*` (`sha256`, `metadata`, `char_count`) | HECHO (`search.mjs:342`) | Gasto de contexto, no corrección |
| `NOT_REQUIRED` | Atomic Memory · Handoff · Experience · Review Inbox · Skills | — | Son de **LifeCode Brain** (mandato §2) |
| `NOT_REQUIRED` | ANN / índice vectorial externo | — | 964 vectores puntuados en **1,07 ms MEDIDOS**: no hay problema que resolver |
| `NOT_REQUIRED` | Pooling de conexiones entre llamadas | — | El aislamiento se apoya en abrir/cerrar por llamada y revalidar autorización en cada reapertura (`exec-context.mjs:141-146,213-216`); cachear handles entre llamadas abriría una ventana que hoy no existe |
| `NOT_REQUIRED` | Herramientas nuevas | — | Las siete cubren el ciclo; el trabajo es interno |

---

## 6. Impacto en las siete herramientas

| Tool | Impacto de las mejoras propuestas | Cambio de contrato |
|---|---|---|
| `search` | **P0-1** (fallback) y **TOOL-01a** (diagnóstico) | Aditivo: `mode:'lexical-fallback'` y `diagnostics` |
| `context` | **P0-2** (no re-embeber) reduce latencia/coste; hereda el fallback de `search` | Ninguno |
| `get` | **P1-2** (índice en `getSource`, sin `OR`) | Ninguno |
| `list` | **P1-3** (N+1) y **TOOL-01b** (proyección) | Posible: dejar de devolver `metadata`/`sha256` → **v0.3**, no en v0.1 |
| `ingest` | **P0-3** (colección), **P1-5** (etapas), **P1-6** (`pending`) | Aditivo en el resultado (`pending`), cambio de semántica en colecciones |
| `forget` | **P0-4** (estado global) | Aditivo (recuento en el valor) |
| `reindex` | Sin hallazgos propios; comparte apertura (**P1-1**) | Ninguno |

---

## 7. Propuesta de optimización mínima (una sola tanda)

Ordenada por daño/beneficio, **todo interno**, sin tocar arquitectura:

1. `ingest.mjs:103` → consultar por `(collection, uri)` *(1 línea; corrige P0-3 y usa el índice)*.
2. `search.mjs` → `try/catch` del bloque semántico con `mode:'lexical-fallback'` y `semantic.error` en `diagnostics`; exponer `diagnostics` en `tools.mjs`.
3. `context.mjs:135-148` → leer vectores de `vectors` por `chunkKey`+`model`; embeber sólo lo que falte.
4. `search.mjs:330` → `UNION ALL` en vez de `OR`.
5. `tools.mjs:310` → quitar el estado de módulo de `forget`.
6. `db.mjs:202` → memo de `quick_check` por `(ruta, size, mtime)`.

**Lo que queda fuera de la tanda, a propósito:** N+1 de `list`, doble recuperación del automático, `index_jobs`,
métricas por etapa, `pending` de ingesta. Son P1/P2 y merecen su propio acto con medición previa.

**Coste estimado:** los seis puntos son locales, sin migración de esquema ni cambio de contrato obligatorio; el
único cambio de comportamiento es el de colecciones (P0-3), que es el defecto.

---

## 8. Pruebas que deberían existir (y hoy no)

| # | Prueba | Cubre |
|---|---|---|
| 1 | embedder que lanza → `search` responde léxico con `mode='lexical-fallback'` | P0-1 |
| 2 | embedder que lanza y sin hits léxicos → error del contrato | P0-1 |
| 3 | `context` con vectores presentes llama al embedder **una** vez | P0-2 |
| 4 | mismo fichero en dos colecciones → dos fuentes | P0-3 |
| 5 | dos `forget` solapados → recuentos propios | P0-4 |
| 6 | plan de `getSource` usa índice (aserción sobre EXPLAIN) | P1-2 |
| 7 | segunda apertura no repite `quick_check`; fichero tocado lo invalida | P1-1 |
| 8 | `list` con 200 fuentes: una sola consulta agregada | P1-3 |
| 9 | una consulta FTS por turno en el automático | P1-4 |
| 10 | lote con fallo parcial → `pending` correcto y reanudable | P1-6 |

---

## 9. Invariantes arquitectónicos: confirmación

| Invariante | Estado | Evidencia |
|---|---|---|
| Core Node independiente | **CUMPLE** | `lib/**` sólo importa `node:*` y módulos propios; `node:sqlite` es del host, no dependencia |
| Persistencia y separación por proyectos/scopes | **CUMPLE** | un `rag.sqlite3` por ámbito (`scope-stores.mjs`), `scope_id` en `meta` |
| SQLite y mecanismos existentes | **CUMPLE** | nada de lo propuesto cambia el motor ni el esquema |
| Las siete herramientas | **CUMPLE** | `tools.mjs:105-361`; ninguna propuesta añade ni quita herramientas |
| Contratos PA | **CUMPLE** | `pa/1.4.0` intacto; los cambios propuestos son aditivos o de versión mayor |
| Autorización por roots y grants | **CUMPLE y se refuerza** | `exec-context.mjs:141-160,210-223` |
| Procedencia y trazabilidad | **CUMPLE** | `sha256`, `uri`, `charStart/charEnd`, auditoría encadenada |
| Independencia de DSH | **CUMPLE** | probado por `standalone.test.mjs` |
| Independencia de Skill Center y otros plugins | **CUMPLE** | cero imports cruzados |
| Sin Atomic Memory/Handoff/Experience/Skills | **CUMPLE** | no existen en el código |

---

## 10. Confirmación de no modificación

- **Código y configuración:** sin escribir. Los 16 `M` + 1 `M` en docs son preexistentes (UX-2.1 y actos
  documentales); las ocho huellas de código medidas coinciden con el inventario de la auditoría UX-2.2
  (`resolve 3a6338a2…`, `pa-api 14ff188d…`, `client ff8119dd…`, `tools 2a3ac69b…`, `exec-context 03e14543…`,
  `sessions f770ec23…`, `selection 18b6f420…`, `index 23ed6951…`).
- **Bases de datos:** abiertas **sólo** con `readOnly: true` y consultas `SELECT`/`PRAGMA`. Sin `INSERT`,
  `UPDATE`, `DELETE`, `VACUUM`, `ANALYZE` ni checkpoint.
- **Permisos:** no se tocaron `roots`, `trusted_roots`, grants ni `pa_selection`.
- **Git:** sin commits, merges, tags, push, reset, checkout, stash ni clean. HEAD y índice idénticos antes/después.
- **Alcance de la raíz de UX-2.2:** esta auditoría **no** se usó para resolverla; no se leyó nada bajo
  `…\plugins-dhs-release\lifecode-rag` por esa vía.
- **Único fichero escrito:** este informe, en `plans/UX-02/UX-22-AUDIT-PERF-2026-11-23/` (evidencia, untracked).
