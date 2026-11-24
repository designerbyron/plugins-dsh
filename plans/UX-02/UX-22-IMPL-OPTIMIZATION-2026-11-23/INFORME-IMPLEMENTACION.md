# Implementación integral de optimización y confiabilidad — informe

**Mandato:** «HANDOFF — LifeCode RAG: Implementación integral de optimización y confiabilidad» (2026-11-23)
**Base:** `plans/UX-02/UX-22-AUDIT-PERF-2026-11-23/INFORME-AUDITORIA-TECNICA.md`
**Repositorio:** `C:\xampp\htdocs\plugins-dhs-release` · rama `release/lifecode-rag-1.0.0` · HEAD de referencia `7d7e839`
**Estado:** implementado y verificado en el árbol · **NO publicado** · **NO instalado** · Host sin tocar

> **Revisión posterior (mismo día).** El diff se revisó línea a línea en `REVISION-DIFF.md`: se corrigieron cinco
> defectos (diagnóstico del modo léxico, corte de `relativeToRoots`, lote mixto duplicando, lotes >100 rutas y ceros
> en `ingest.stage_ms`) y se hizo determinista una prueba de presupuesto que fallaba por la máquina. La suite pasó
> de 557 a **563** casos.

---

## 1. Diagnóstico final de cada hallazgo

| Hallazgo | Estado inicial | Estado final |
|---|---|---|
| P0-1 · sin fallback de canal (`RET-03`) | Si el embedder falla, `search`/`context` fallan enteros | **Corregido**: degradación declarada a léxico; sólo ante `embedding-failed`; el resto se propaga |
| P0-2 · `context` reembebe (`PERF-03`) | 1 + N embeddings por llamada | **Corregido**: reutiliza `vectors` del almacén; sólo embebe lo ausente |
| P0-3 · identidad sin colección (`ING-02`) | Mismo `uri` en otra colección → `unchanged` sin efecto | **Corregido**: identidad `(collection, uri)`; ids históricos intactos en `default` |
| P0-4 · `forget` con estado compartido (`TOOL-01c`) | Recuento en variable del cierre | **Corregido**: el recuento viaja en el valor |
| P1-1 · `quick_check` por apertura | 12,9 ms medidos por almacén | **No modificado — decisión razonada** (§3) |
| P1-2 · `sources` sin índice y `OR` que anula la PK | `SCAN` en deduplicación y en `getSource` | **Corregido sin migración**: dedupe por `(collection,uri)` usa el `UNIQUE`; `getSource` resuelve por `id` con índice y sólo cae a `uri` si hace falta |
| P1-3 · N+1 en `list` | Subconsulta correlacionada por fila | **Corregido**: agregado por JOIN |
| P1-4 · doble recuperación en contexto automático | 2 recuperaciones por turno | **No modificado — decisión con medición** (§3) |
| P1-5 · observabilidad por etapa | Sólo `ingest.ms` total | **Corregido**: `ingest.stage_ms` con `extract`/`chunk`/`embed`/`write` |
| P1-6 · reanudación de ingesta | Sin registro de lote | **Parcial por decisión**: idempotencia reforzada; ledger `index_jobs` no activado (§3) |
| P1-7 · secretos y rutas | Denylist por nombre; rutas absolutas siempre | **Mejorado**: advertencias de alta confianza sin bloquear + `relUri` aditivo en `get`/`list` |
| P2 · truncado con sesgo de orden | Orden de inserción al truncar | **No modificado** (no ocurre con 964 ≪ 20 000); documentado |

## 2. Decisión técnica adoptada por hallazgo

1. **Fallback**: lista **cerrada** de códigos recuperables (`RECOVERABLE_EMBEDDING_CODES = ['embedding-failed']`), `try/catch` sólo alrededor del bloque semántico, `mode='lexical-fallback'`, y **propagación del error original si el léxico tampoco devuelve nada** (no se convierte un fallo en un vacío). Estrategia `vector` explícita no degrada.
2. **Vectores**: `loadVectorsFor(ctx, rows, {model, dim})` consulta por `chunk_key IN (…)`, `model` y `dim` exactos; `assembleContextAsync` acepta un mapa prefabricado y sólo embebe los ausentes. Si no hay embedder del llamante, MMR usa vectores locales (sin egreso).
3. **Colecciones**: `sourceIdFor(uri, collection)` mantiene el id histórico para `default` y deriva otro para el resto; el lookup de duplicados es `WHERE collection = ? AND uri = ?` (usa el `UNIQUE`); `getSource` exige unicidad cuando busca por `uri`.
4. **SQL**: `getSource` por id → índice de PK; `listSources` con `LEFT JOIN (… GROUP BY source_id)`.
5. **`forget`**: `chunks` en el valor; `render` lo lee del valor de esa llamada.
6. **Métricas**: `ingest.stage_ms` (dims `extract|chunk|embed|write`) y `query.fallback` (dim = estrategia).
7. **Secretos**: cinco patrones de alta confianza (`private-key`, `aws-access-key`, `api-key`, `github-token`, `slack-token`) → `warnings[]`, nunca bloqueo.
8. **Rutas**: `relativeToRoots(uri, roots)` en `lib/paths.mjs`; expuesto como `relUri` en `get` y `list`.
9. **Sincronización**: `resolveBatchCollection` reutiliza la colección de lo ya indexado para no duplicar la misma ruta al automatizar.

## 3. Decisiones autónomas y su justificación (lo que **no** se implementó)

| Propuesta | Decisión | Justificación medida |
|---|---|---|
| Memoizar `quick_check` | **NO** | 12,9 ms por apertura, pero con WAL el fichero principal puede no cambiar mientras hay páginas confirmadas sin checkpoint; una memo por `(ruta,size,mtime)` podría saltarse una corrupción recién confirmada. El mandato prohíbe reducir garantías por latencia. Se conserva tal cual |
| Reutilizar la búsqueda de la puerta léxica | **NO** | MEDIDO: la puerta cuesta **0,40 ms** con `limit 1` y **1,00 ms** con `limit 24`. El ahorro no compensa cambiar qué se recupera |
| Activar `index_jobs` como ledger | **NO** | Exigiría estados, transiciones, recuperación y compatibilidad nuevas; la re-ejecución ya es segura y barata porque el salto es por `(colección, uri, sha256)`. Queda documentado como pendiente |
| `diagnostics` como campo del valor de `search` | **NO** (revertido) | Dos pruebas congelan el valor de v0.1: `tests/partial-results.test.mjs:133` (claves exactas `elapsedMs|mode|results`) y `tests/search-diversity.test.mjs:205` (8 claves por fila). Añadirlo rompía una garantía del contrato. Se entrega transparencia por **`mode='lexical-fallback'`** y la métrica **`query.fallback`** |
| Detección de secretos que bloquee | **NO** | Heurística débil: bloquearía documentación legítima. Se avisa |
| ANN / pooling / caché entre llamadas | **NO** | 964 vectores puntuados en 1,07 ms; el aislamiento depende de abrir/cerrar y revalidar por llamada |

## 4. Archivos modificados y motivo

| Archivo | Δ | Motivo |
|---|---|---|
| `lib/search.mjs` | +101/−… | Fallback declarado, código recuperable cerrado, métrica `query.fallback`, `getSource` id-first con ambigüedad, `listSources` sin N+1 |
| `lib/scope-ops.mjs` | +70 | Agregación de degradación por ámbito, `loadVectorsFor`, `relUri` en `get`/`list` |
| `lib/ingest.mjs` | +64 | Identidad por colección, `scanForSecrets`, tiempos por etapa, `warnings[]` |
| `lib/sync.mjs` | +25 | `resolveBatchCollection` |
| `lib/context.mjs` | +15/−… | Reutilización de vectores prefabricados |
| `lib/tools.mjs` | +12/−… | `forget` sin estado compartido (valor con `chunks`) |
| `lib/paths.mjs` | +19 | `relativeToRoots` |
| `lib/metrics.mjs` | +2 | `ingest.stage_ms`, `query.fallback` |
| `tests/reliability.test.mjs` | **nuevo** | 8 pruebas del fallback y de la reutilización de vectores |
| `tests/optimizations.test.mjs` | **nuevo** | 8 pruebas de colecciones, `getSource`, `forget`, etapas, secretos y `relUri` |
| `docs/CONTRATO-EXTENSIONES-1.4.md` | **nuevo** | Extensiones aditivas, correcciones y decisiones con evidencia |

Total: **8 ficheros de código, 261 inserciones / 47 borrados**, 2 ficheros de prueba y 1 documento nuevo.
Ningún fichero preexistente ajeno al alcance fue modificado.

## 5. Pruebas agregadas y resultados reales

**Línea base cerrada antes de la primera edición** (`baseline-test.log`): **541/541**, 51 636 ms, exit 0.

**Pruebas nuevas (22) y qué fijan** — las 16 del acto y 6 añadidas en la revisión del diff (`REVISION-DIFF.md` §B.3).

| Fichero | Prueba | Comportamiento fijado |
|---|---|---|
| reliability | proveedor caído degrada y declara | `mode='lexical-fallback'`, `diagnostics.degraded`, `query.fallback=1` |
| reliability | el fallback no oculta nada más | `cancelled`, `egress-denied`, `session-invalid`, `scope-forbidden`, `store-corrupt`, `internal` se propagan |
| reliability | sin hits léxicos se propaga el fallo | `embedding-failed` |
| reliability | `vector` explícito no degrada | `embedding-failed` |
| reliability | la herramienta declara sin romper v0.1 | claves `elapsedMs|mode|results` y 8 claves por fila |
| reliability | egreso denegado no se degrada | `egress-denied` |
| reliability | `context` reutiliza vectores | **1** embedding (sólo la consulta) |
| reliability | modelo distinto → recalcula | >1 embeddings, sin fallo |
| optimizations | misma `uri` en dos colecciones | 2 fuentes, 2 ids |
| optimizations | repetición en la misma colección | `unchanged`, 1 fila |
| optimizations | id derivado por colección | `default` histórico; otro para el resto |
| optimizations | `getSource` ambiguo | `invalid-argument` con `reason='ambiguous-ref'` |
| optimizations | dos `forget` concurrentes | cada uno su `chunks` |
| optimizations | etapas de ingesta | dims `chunk|embed|extract|write` |
| optimizations | secreto de alta confianza | `warnings[].code='possible-secret'`, sin bloqueo |
| optimizations | `relUri` aditivo | `get`/`list` con relativa; `search` intacto |

**Resultado final (tras la revisión del diff):** `npm test` → **563/563**, exit 0 · `npm run check` → exit 0 · `npm run test:hermetic` → **563/563** y `✓ hermético: el almacén real no cambió (10 fichero(s))`.

## 6. Comparaciones antes/después (medidas)

| Medición | Antes | Después | Cómo |
|---|---|---|---|
| `getSource` con `id` | `SCAN sources` | `SEARCH sources USING INDEX sqlite_autoindex_sources_1 (id=?)` | `EXPLAIN QUERY PLAN` |
| `listSources` | `CORRELATED SCALAR SUBQUERY` por fila | `MATERIALIZE` del agregado + join | `EXPLAIN QUERY PLAN` |
| Embeddings por `context` | 1 + N (N = candidatos) | **1** | prueba con contador (`[1]`) |
| Búsqueda con proveedor caído | error total | resultados léxicos + `mode` declarado | pruebas 1-5 |
| Dedupe de ingesta | `SCAN sources` | índice `UNIQUE (collection, uri)` | `EXPLAIN` + prueba de colecciones |
| `quick_check` por apertura | 12,9 ms | 12,9 ms (**sin cambio**) | medición previa reutilizada |
| Puerta léxica del automático | 0,40 ms (`limit 1`) | 0,40 ms (**sin cambio**) | medida para decidir |
| Vectores 964 (256 dim) | 1,07 ms | 1,07 ms (sin cambio; no era el cuello) | banco con `blobToVector`+`cosine` |

## 7. Impacto sobre contratos y versiones

- **v0.1 sigue vigente.** Sin cambios en nombres, parámetros, orden de herramientas ni en el valor de `search`
  (congelado por dos pruebas que siguen en verde).
- **Aditivo**: `ingest.ingested[].warnings`, `get.source.relUri`, `list.rows[].relUri`, `forget.chunks`.
- **Valor nuevo en campo existente**: `search.mode = 'lexical-fallback'`.
- **Corrección de comportamiento**: identidad por colección (con ids históricos intactos en `default`).
- **Telemetría nueva**: `ingest.stage_ms`, `query.fallback`.
- **Sin cambios**: almacén v3, registro v2, API `pa/1.4.0`, códigos de error existentes. `package.json` **no** se
  tocó: la versión publicada sigue siendo `1.3.0` y estos cambios quedan como **1.4.0-draft** sin publicar.
- Documento de contrato: `docs/CONTRATO-EXTENSIONES-1.4.md`.

## 8. Riesgos residuales y limitaciones

1. **`getSource` por `uri` sigue recorriendo `sources`** (no hay índice por `uri`; el `UNIQUE` es `(collection, uri)`).
   Aceptable hoy (121 filas) y evitable con migración v4 si el volumen lo exige; no se hizo para no tocar el esquema
   sin necesidad demostrada. La ruta caliente (`id`) ya es indexada.
2. **Identidad por colección cambia la semántica** para `collection ≠ default`: dos fuentes con el mismo fichero.
   Es lo que declara el esquema, pero un consumidor que asumiera unicidad global de `uri` debe saberlo
   (documentado). En la práctica evita el `unchanged` silencioso.
3. **`resolveBatchCollection`** usa la colección común del lote si es única; con lotes de colecciones mezcladas cae
   a `default` (evita duplicados, puede crear uno nuevo en `default` para un fichero ya clasificado). Límite
   declarado: lotes de más de 100 rutas no consultan (usan `default`).
4. **Advertencias de secretos** son heurísticas: falsos negativos posibles (un secreto sin patrón conocido) y
   falsos positivos posibles (un ejemplo en documentación). No bloquean.
5. **`relUri` sólo en `get`/`list`**: en `search` no se añadió porque su forma está congelada; la ruta absoluta
   sigue expuesta ahí.
6. **Sin ledger de ingesta**: un corte a mitad de lote deja lo confirmado; la reanudación es re-ejecutar
   (idempotente). No hay «quedan K de N».

## 9. Hallazgos descartados y evidencia

- **`renderForget` era «variable de módulo»** — *corrección propia*: está declarada dentro de
  `createToolDefinitions` (`lib/tools.mjs:103` antes del cambio), es decir, estado del cierre por instancia. El
  defecto de concurrencia es real (una instancia sirve a todas las sesiones), la descripción del informe no lo era.
  Se corrigió igualmente y queda anotado.
- **«search envía texto completo»** — descartado: la herramienta proyecta a `snippet` (8 claves). El hallazgo
  apuntaba a la capa equivocada.
- **`index_jobs` y `policies` sin productor** — confirmado como deuda de esquema; no se activan en este acto.
- **Sesgo de orden al truncar (>20 000 vectores)** — real pero inalcanzable con el tamaño actual; se documenta.

## 10. Confirmación de invariantes

| Invariante | Estado |
|---|---|
| Core host-agnostic; `lib/**` sin DSH/Cordis/Electron | **CUMPLE**: ningún import nuevo fuera de `node:*` y módulos propios |
| Sin dependencias obligatorias de harness | **CUMPLE** (`npm run check` en verde: «sin dependencias de @deepseek-ai/*») |
| Independencia de Skill Center / Brain / otros plugins | **CUMPLE** |
| Node.js + SQLite | **CUMPLE** |
| Aislamiento de proyectos, colecciones y scopes | **CUMPLE**; la colección ahora **separa** de verdad |
| Autorización revalidada en cada operación | **CUMPLE** (no se tocó `exec-context`) |
| Atomicidad de ingesta | **CUMPLE** (`atomicity.test.mjs` en verde) |
| Auditoría íntegra | **CUMPLE** (cadena verificada en hermético) |
| Sin ANN, pooling ni complejidad no justificada | **CUMPLE** |
| Sin responsabilidades de memoria operativa/Handoff/Experience/Skills | **CUMPLE** |

## 11. Estado Git (antes → después)

| | Antes | Después |
|---|---|---|
| HEAD | `7d7e839d514cca27044d595218bf8c67ec5a1f7d` | **idéntico** |
| Índice | vacío | **vacío** |
| `git status` | 40 entradas (18 M / 22 ??) | **52 (27 M / 25 ??)** |
| Delta | — | **+9 M** (8 ficheros de código + `tests/sync.test.mjs`), **+3 ??** (2 pruebas + 1 doc) |

Cambios preexistentes (16 M de UX-2.1 + 2 M de docs + 15 ?? previos + `plans/UX-02/`) **preservados**: no se
limpió, restauró ni descartó nada. Sin commits, merges, rebase, tags, push, reset, checkout, stash ni clean.

## 12. Confirmación final

- **No se publicó** ningún paquete (`npm publish` no se ejecutó; `package.json` intacto).
- **No se modificó el Host**: ni perfil DSH, ni `cordis.patch.yml`, ni instalaciones.
- **No se tocaron datos reales**: `registry.sqlite3` `4b67cadc9afee8f6…`, ámbitos `4dcf31c4cb7058bb…` y
  `6130ecbae17b8e82…`, `config.json` `b15622c0ab9f790f…` — idénticos antes y después; hermético lo confirma
  («el almacén real no cambió»).
- **No se añadieron** roots, grants ni permisos. La raíz de UX-2.2 sigue `PENDING` y no se leyó por esta vía.
