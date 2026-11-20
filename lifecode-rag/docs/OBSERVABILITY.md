# LifeCode RAG — Observabilidad

**Fecha:** 2026-11-17 · **Estado:** diseño propuesto (sin instrumentación implementada)
**Principio:** métricas **agregadas**, con procedencia declarada; nunca contenido.

---

## 1. Límites de privacidad (no negociables)

No se persiste, bajo ninguna configuración:

- prompts del sistema o del usuario;
- respuestas del modelo;
- texto de las consultas;
- texto de los chunks recuperados como telemetría;
- conversaciones, sesiones, IDs de sesión o de agente como dimensión de métrica;
- credenciales, tokens o cabeceras.

Sí se persiste: contadores, latencias por cubo, conteos por colección y estrategia, y el resultado
`ok|error|zero-results` de una consulta. Una consulta con cero resultados incrementa un contador; su
texto se descarta al terminar la petición.

## 2. Catálogo de métricas

Cada fila declara **procedencia**: `medido` (instrumentado en el punto de ejecución) o
`derivado` (calculado a partir de medidos), y su **método**.

| Métrica | Definición | Procedencia | Punto |
|---|---|---|---|
| `queries.agent` | consultas servidas por `lifecode_rag_search`/`context` | medido | tool execute |
| `queries.lab` | consultas del Laboratorio (separadas) | medido | `POST /retrieval` |
| `queries.zero` | consultas con 0 resultados | medido | `search()` |
| `contexts.built` | contextos devueltos por `lifecode_rag_context` | medido | `assembleContext` |
| `contexts.truncated` | contextos que no cupieron en el presupuesto | medido | `assembleContext` |
| `tokens.served` | suma de `tokens` estimados de contextos servidos | derivado | `ceil(chars/4)` |
| `tokens.corpus` | tamaño del corpus indexado en tokens estimados | derivado | `ceil(chars/4)` |
| `latency.bucket` | histograma por estrategia (`fts`/`vector`/`hybrid`) | medido | `search()` |
| `ingest.files` / `ingest.chunks` / `ingest.errors` | volumen y fallos de ingesta | medido | `ingestFiles` |
| `vectors.coverage` | chunks con vector / chunks totales, por modelo | derivado | mantenimiento |
| `fts.coverage` | filas FTS / chunks | derivado | health check |
| `audit.events` | eventos por acción y resultado | medido | `appendAudit` |
| `maintenance.runs` | reindex/forget ejecutados y su duración | medido | `maintenance` |
| `approvals.asked` / `approvals.allowed` / `approvals.rejected` | decisiones del host | medido | tool wrapper |
| `storage.bytes` | tamaño de `rag.sqlite3` + `-wal` | medido | snapshot |
| `metrics.write_failures` | escrituras de métricas fallidas (contador en memoria, volcado best-effort) | derivado | borde de telemetría |

No se mide «calidad de respuesta generada»: no hay acceso a la respuesta del modelo y no se va a inventar.

## 3. Almacenamiento

**Una sola tabla.** Se evaluó una segunda tabla (día × métrica y otra por dimensión) y se descarta: la PK
`(day, metric, dim)` ya separa estrategias, cubos y colecciones, y una tabla extra duplicaría escrituras
sin resolver ninguna consulta que la primera no resuelva.

```sql
CREATE TABLE metrics_daily (
  day        TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  metric     TEXT NOT NULL,          -- enum cerrado (§3.1)
  dim        TEXT NOT NULL DEFAULT '', -- enum estructurado (§3.1)
  value      REAL NOT NULL,          -- contador o cubo; nunca texto
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, metric, dim)
) STRICT;
```

- Un `UPSERT` por incremento (`value = value + excluded.value`), dentro de la misma transacción que la
  operación cuando la operación ya escribe; si no, transacción propia de una fila.
- Escritura en lote por operación (una transacción por tool/llamada, no una por chunk).
- Latencia por cubos fijos (ms): `0-10, 10-25, 25-50, 50-100, 100-250, 250-500, 500-1000, 1000+`.
  Guardar cubos, no muestras, evita crecer con el uso.
- Retención por defecto **90 días** (`metrics.retentionDays`, 7–365), con la clasificación de purga de §7.
- No hay tabla de «uso por consulta»: el ahorro se deriva de `tokens.served`, `tokens.corpus` y
  `contexts.built`; guardar una fila por consulta crecería con el uso y acercaría el riesgo de perfilado.

Índices: la PK cubre `(day, metric, dim)`; serie = `WHERE metric=? AND day BETWEEN ? AND ? ORDER BY day`.

### 3.1 Enumeraciones cerradas

`metric` es una lista cerrada; cualquier otro valor se rechaza con `invalid-metric` antes de escribir:

```text
queries.agent | queries.lab | queries.zero | contexts.built | contexts.truncated
tokens.served | tokens.corpus | latency.bucket
ingest.files | ingest.chunks | ingest.errors
vectors.coverage | fts.coverage | audit.events | maintenance.runs
approvals.asked | approvals.allowed | approvals.rejected
storage.bytes | metrics.write_failures
```

`dim` no es texto libre: se compone de un **tipo permitido** y un valor validado:

| Tipo | Valor permitido | Ejemplo |
|---|---|---|
| `strategy` | `fts` \| `vector` \| `hybrid` | `strategy:hybrid` |
| `bucket` | uno de los 8 cubos de latencia | `bucket:50-100` |
| `collection` | nombre de colección ya existente, `^[a-z0-9][a-z0-9._-]{0,63}$` | `collection:docs` |
| `model` | id de embedder, `^[a-z0-9][a-z0-9._-]{0,63}$` | `model:local-hash-v1` |
| `channel` | `agent` \| `lab` | `channel:lab` |
| `outcome` | `ok` \| `error` \| `zero` \| `allowed` \| `rejected` \| `asked` | `outcome:zero` |
| `action` | una acción de auditoría existente | `action:ingest` |

Reglas de validación (implementadas en `lib/metrics.mjs`, no en la UI):

1. `metric` debe estar en la lista; `dim` debe casar `^(strategy|bucket|collection|model|channel|outcome|action):…`.
2. `collection` y `model` se aceptan solo si ya existen en la base; si no, se descarta la métrica (no se
   crea una dimensión nueva desde una petición).
3. Se rechaza cualquier `dim` que contenga `/`, `\`, `:` extra, espacios, longitud > 96 o el texto de la
   consulta (comparación con la cadena de la petición antes de descartarla).
4. Nunca se usa la ruta de un fichero, un id de sesión/agente, una cabecera ni un token como dimensión.

### 3.2 Agregado de `tokens.corpus`

`tokens.corpus` **no** se recalcula escaneando todos los chunks en `/snapshot`. Se mantiene un agregado
persistido en `meta`:

| Clave | Contenido |
|---|---|
| `tokens_corpus_estimate` | suma de `ceil(length(text)/4)` de los chunks vigentes |
| `tokens_corpus_chunks` | número de chunks usados en la suma |
| `tokens_corpus_seq` | `index_revision` en el momento del cálculo |

Actualización, siempre en la **misma transacción** que la mutación:

- ingesta nueva: `+= estimate(chunks insertados)`; reemplazo: `-= estimate(chunks borrados)` y `+=` los
  nuevos (se hace con los valores leídos antes del `DELETE`, no después);
- `forget`: `-= estimate(chunks de la fuente)`;
- `reindex all`/`fts`: recalcula al final de la transacción global porque rebuild no cambia textos, pero sí
  verifica;
- `reindex vectors`: no cambia textos → no toca el agregado.

Reconstrucción si queda inconsistente (p. ej. caída entre mutación y agregado, o edición manual):
`SELECT SUM((length(text)+3)/4), COUNT(*) FROM chunks` dentro de una transacción, y `writeMeta` con los tres
valores. Se ejecuta en `doctor` cuando `tokens_corpus_chunks != COUNT(*)` o
`tokens_corpus_seq != sources.index_revision` agregado; el resultado se marca en `/health` como
`tokens.corpus: reconstruido`. La UI muestra `≈` y la fórmula; nunca lo presenta como tokens reales.

## 4. Instrumentación

Un único módulo `lib/metrics.mjs` con API mínima:

```js
recordMetric(db, { metric, value = 1, dim = '', at = Date.now() })
withTiming(db, { metric, dim }, fn)        // mide y registra aunque fn lance
readSummary(db, { from, to })
readSeries(db, { metric, from, to, bucket = 'day' })
```

Reglas:

- **Nunca lanza** hacia el camino de negocio: la operación continúa aunque la métrica falle. El fallo se
  contabiliza en un contador **en memoria** (`telemetryFailures`) y se escribe una sola vez, en un `try`
  independiente, como `metrics.write_failures`. Si esa escritura también falla, **no se intenta registrar
  el fallo del registro** (no hay recursión): queda el contador en memoria y una línea en `stderr`, y la
  operación de negocio termina igual. `metrics.write_failures` jamás se cuenta a través de `recordMetric`.
- La telemetría no abre transacciones anidadas: si la operación ya escribió y la métrica falla, se pierde
  la métrica, no la operación.
- El reloj se inyecta (`at`) para pruebas deterministas.
- Se llama en el borde (tools, rutas, mantenimiento), no dentro de bucles de chunk.
- Un test verifica que ninguna tabla de métricas contiene texto de consulta: se ejecuta una consulta con
  una cadena única y se comprueba que esa cadena no aparece en ningún fichero del almacén.

## 5. Derivaciones y honestidad

La UI debe poder responder «¿de dónde sale este número?». Cada tarjeta de Analítica muestra:

1. definición en una frase;
2. procedencia (`medido`/`derivado`);
3. ventana temporal;
4. si es estimado, la fórmula.

`tokens.served` y `tokens.corpus` son **estimaciones** (`ceil(chars/4)`), no tokens reales del modelo.
Se etiquetan como tales en la UI y en el benchmark. La estimación se sustituirá por conteo real cuando
exista un contrato de tokenizer en el host; hoy no lo hay.

## 6. Consultas de lectura

`lib/query.mjs` expone:

- `metricsSummary(db, {from, to})` → `{window, queries, zeroRate, contexts, tokens, latencyP50, latencyP95, topCollections}`;
- `metricsSeries(db, {metric, from, to})` → `[{day, value}]`;
- `metricsHealth(db)` → cobertura FTS/vectores, última escritura, filas de métricas, retención.

`latencyP50/P95` se calculan a partir de los cubos con el método de §6.1; no son valores exactos.

### 6.1 Percentiles a partir de cubos

Algoritmo (determinista, sin muestras):

1. `N` = suma de valores de los 8 cubos de la ventana.
2. Para `q ∈ {0.50, 0.95}`, objetivo `t = q·N`; se acumulan cubos hasta que el acumulado `≥ t`.
3. Sea el cubo `[lo, hi)` con acumulado previo `a` y ancho `w`; la estimación es
   `p = lo + w · (t − a) / count(cubo)`.
4. El cubo abierto `1000+` se trata como `[1000, ∞)`: se devuelve `≥1000` y **no** se extrapola un valor
   puntual.
5. La precisión publicada es «± ancho del cubo»: p. ej. con `250-500` la estimación puede desviarse hasta
   250 ms. La UI muestra `≈` y el texto «estimado por histograma».

Consecuencia honesta: p95 no sirve para afirmar «cumplimos 250 ms» si el cubo que lo contiene es ancho. Para
el presupuesto de recuperación se mide con el arnés (muestras reales), no con el histograma.

## 7. Retención y purga: clasificación única

| Operación | Quién | Requisito |
|---|---|---|
| Purga rutinaria dentro de la retención (90 d) | automática al abrir/cerrar mantenimiento | ninguna; auditada |
| Cambio de `retentionDays` (7–365) | persona desde Configuración | confirmación explícita |
| Purga anticipada (borrar antes de la retención) | persona | confirmación + motivo; auditada |
| Purga de todo el histórico | persona | **aprobación humana** por el motor de políticas |
| Borrado del almacén completo | persona | **aprobación humana** + copia previa ofrecida |

La UI no puede aprobar nada: `POST /actions` con `purgeMetrics`/`purgeAll` devuelve `approval-required` y
el host pide la aprobación con su propio diálogo. Ninguna purga se ejecuta por una ruta HTTP sin ese paso.

### 7.1 Exportación, opt-out y desinstalación

- `metrics export` (CLI) escribe un JSON con las series; no incluye contenido.
- Desactivar analítica (`usageAnalytics: false`) detiene la escritura de `queries.*`, `tokens.*` y
  `latency.*`; mantiene salud e integridad, que son diagnóstico, no uso.
- Desinstalar el plugin no borra el almacén: la UI de DSH no ejecuta borrados; se documenta la ruta.

## 8. Pruebas exigidas (M-v0.2.0)

1. Incremento y lectura por día/cubo; idempotencia dentro de la misma transacción.
2. Fallo de métrica no altera el resultado de la operación.
3. Fallo del propio `metrics.write_failures` no produce recursión ni excepción (contador en memoria).
4. `metric`/`dim` fuera del enum se rechazan y no crean filas.
5. Sin texto de consulta en el fichero SQLite ni en `-wal` tras una consulta única (test de privacidad).
6. Purga respeta retención y deja auditoría; purga total sin aprobación devuelve `approval-required`.
7. Series con huecos devuelven días sin dato como `null`, no como 0.
8. `usageAnalytics:false` no escribe métricas de uso pero sí de salud.
9. `tokens.corpus` sobrevive a ingesta/reemplazo/forget; tras corromper `meta` a mano, `doctor` reconstruye
   y marca `reconstruido`.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Métricas que se convierten en perfilado | Sin texto, sin sesión, sin agente; retención corta; opt-out |
| Coste de escritura por consulta | UPSERT de una fila; cubos en vez de muestras |
| Números que la UI presenta como exactos | Sello `medido/derivado/estimado` obligatorio en el contrato |
| Divergencia UI/motor | El cálculo vive en `metrics.mjs`/`query.mjs`, no en el cliente |
