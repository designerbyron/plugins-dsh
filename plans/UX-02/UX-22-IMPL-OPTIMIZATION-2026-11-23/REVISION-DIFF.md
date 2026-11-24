# Revisión técnica del diff — implementación 1.4.0-draft

**Encargo:** revisar el diff efectivo, corregir defectos dentro del mandato y dictaminar aptitud para empaquetar
**Fecha:** 2026-11-23 · **Rama:** `release/lifecode-rag-1.0.0` · **HEAD:** `7d7e839`
**Alcance:** los 8 ficheros de código, las 3 suites tocadas y los 2 documentos del acto. **Sin** commits, empaquetado,
publicación, instalación ni cambios en el Host.

---

## A. Archivos revisados y cambios efectivos

| Archivo | Δ | Qué hace de verdad (verificado en el diff y en ejecución) |
|---|---|---|
| `lib/search.mjs` | +104/−16 | `RECOVERABLE_EMBEDDING_CODES` cerrado; `try/catch` **sólo** del canal semántico; degradación a léxico con `mode='lexical-fallback'`; propaga si no hay léxico; métrica `query.fallback`; `getSource` id-first con ambigüedad; `listSources` con agregado |
| `lib/scope-ops.mjs` | +74/−3 | Agrega degradación por ámbito (`fallbacks[]`); `loadVectorsFor` por `chunk_key`+`model`+`dim`; `relUri` en `get`/`list` |
| `lib/ingest.mjs` | +73/−8 | `sourceIdFor(uri, collection)` con id histórico en `default`; lookup por `(collection, uri)`; `scanForSecrets`; tiempos `extract/chunk/embed`; `warnings[]` en ingeridos **y** omitidos |
| `lib/sync.mjs` | +53/−24 | `resolveCollections`: consulta en tramos de 80 y agrupa **por fichero**; el lote se ingiere por grupos |
| `lib/context.mjs` | +13/−9 | Acepta vectores prefabricados y sólo embebe los ausentes |
| `lib/tools.mjs` | +6/−6 | `forget` devuelve `chunks` en el valor; se elimina el estado del cierre |
| `lib/paths.mjs` | +21 | `relativeToRoots` (corte por clave normalizada) |
| `lib/metrics.mjs` | +2 | `query.fallback`, `ingest.stage_ms` |
| `tests/reliability.test.mjs` | 9 pruebas | fallback, propagación, vacío, vectorial puro, modo léxico, forma v0.1, egreso, reutilización de vectores, modelo ajeno |
| `tests/optimizations.test.mjs` | 12 pruebas | colecciones, id histórico, `getSource`, `forget` + render, etapas, secretos (ingerido y omitido), `relUri`, raíz con barra final, `resolveCollections`, `get` ambiguo |
| `tests/sync.test.mjs` | +1 prueba | lote mixto extremo a extremo |
| `docs/CONTRATO-EXTENSIONES-1.4.md`, `plans/…/INFORME-IMPLEMENTACION.md` | nuevos | contrato aditivo y evidencia del acto |

## B. Hallazgos

### B.1 Correcto (verificado por ejecución, no por nombre)

| # | Comprobación | Evidencia |
|---|---|---|
| 1 | Sólo `embedding-failed` degrada; `cancelled`, `egress-denied`, `session-invalid`, `scope-forbidden`, `store-corrupt` e `internal` se propagan | `reliability.test.mjs` (6 códigos) |
| 2 | Sin resultados léxicos el fallo se propaga: no se convierte en «vacío» | ídem |
| 3 | `strategy='vector'` explícito no degrada | ídem |
| 4 | Vectores reutilizados sólo con `model`+`dim`+`chunk_key` exactos; otro modelo recalcula | `[1]` embeddings y prueba de modelo ajeno |
| 5 | `loadVectorsFor` lee del **almacén de cada ámbito**; sin cruce entre scopes | por construcción (`ctx.scopes.find` + `openForRead`) |
| 6 | `(collection, uri)` permite dos fuentes; id histórico intacto en `default` | `optimizations` (2 pruebas + id) |
| 7 | `getSource` resuelve por `id` con índice y exige unicidad por `uri` | `EXPLAIN`: `SEARCH … USING INDEX sqlite_autoindex_sources_1 (id=?)`; prueba de ambigüedad (unidad y herramienta) |
| 8 | `forget` concurrente: valores **y textos** propios | prueba con `Promise.all` y `render` diferido |
| 9 | `relativeToRoots` no cruza a un hermano del mismo prefijo textual | prueba con `C:/proyecto-a-otro` |
| 10 | `warnings[]` sólo lleva `{code, kind}`, nunca el texto coincidente | código + prueba |
| 11 | Métricas: `query.fallback` se escribe sólo al degradar; `ingest.stage_ms` sólo si hubo ficheros preparados | pruebas |
| 12 | Atomicidad intacta: `atomicity.test.mjs` y `concurrency.test.mjs` en verde; el lote sigue siendo una transacción por fichero | suite |
| 13 | Sin dependencias nuevas; `check` en verde | `npm run check` |

### B.2 Correcto con limitación documentada

| # | Limitación | Por qué se acepta |
|---|---|---|
| L1 | `getSource` por `uri` recorre `sources` (no hay índice por `uri`; el `UNIQUE` es `(collection, uri)`) | La ruta caliente (`id`) ya es indexada. Crear índice exigiría migración v4 sin necesidad demostrada (121 filas). Documentado en el informe |
| L2 | `context` con el proveedor caído **y** vectores ausentes falla con `embedding-failed` | MMR necesita vectores; usar otros distintos cambiaría el ranking en silencio. El caso normal (vectores completos) sí degrada |
| L3 | `relUri` sólo en `get` y `list`; `search` conserva `uri` absoluta | El valor y las filas de `search` están congelados por dos pruebas de contrato |
| L4 | La reingesta de un fichero sin cambios **recalcula embeddings** antes de descubrir que no cambió | Comportamiento **preexistente** (no introducido aquí): `prepareDocument` va antes de `writeDocument`. Ahora además queda medido en `ingest.stage_ms` |
| L5 | Lote de sincronización: un fichero cuya `uri` exista en **dos** colecciones va a `default` | Ambiguo por definición; la alternativa sería elegir una en silencio |
| L6 | Las advertencias de secretos son heurísticas (5 patrones de alta confianza) | Bloquear por heurística débil rompería documentación legítima |

### B.3 Defecto corregido **en esta revisión**

| # | Defecto | Cómo se manifestaba | Corrección | Prueba que lo fija |
|---|---|---|---|---|
| C1 | `diagnostics.lexical.mode` se pisaba con `'none'` al degradar | El diagnóstico decía «modo léxico none» con `hits > 0`: información falsa para quien depura | Se captura `lexicalMode` antes de reescribir `mode` | `reliability`: «la degradación no falsea el modo léxico» |
| C2 | `relativeToRoots` cortaba por `base.length` con raíz de barra final | `C:\docs\` + `C:\docs\sub\a.md` devolvía `ub/a.md` | Corte por `baseKey.length` (clave normalizada) | `optimizations`: barra final y hermanos |
| C3 | `resolveBatchCollection` resolvía **una** colección por lote | Lote mixto: los ficheros ya indexados en otra colección se duplicaban en `default` (la duplicación que la propia auditoría señaló) | `resolveCollections`: consulta en tramos y agrupa **por fichero**; el lote se ingiere por grupos | `sync`: «un lote mixto no duplica lo ya indexado» + unidad con 101 rutas |
| C4 | Lotes de **más de 100 rutas** ni siquiera consultaban la colección | Se forzaba `default` → duplicación silenciosa | Tramos de 80 parámetros, sin límite de tamaño | `optimizations`: `resolveCollections` con 101 rutas |
| C5 | `ingest.stage_ms` escribía ceros cuando ningún fichero se preparó (ingesta vacía o todo fallido) | Ruido en `metrics_daily` | Se emiten las etapas sólo si `preparedCount > 0` | `optimizations`: etapas (y ausencia con cero) |
| C6 | **Fragilidad de verificación** (no del producto): la prueba de presupuesto usaba reloj real y un `setTimeout` simulado | Bajo la suite completa falló una vez con `ingeridos=0`: la observación consumía los 60 ms y el presupuesto vencía **antes del primer fichero**. Medido: **8/8 en aislado**, 1 fallo en la corrida completa | Se usa el reloj monotónico **inyectado** que el producto ya ofrece: el presupuesto se agota por ficheros (25 unidades cada uno), no por la velocidad del disco. Sin `setTimeout` | `sync`: misma prueba, **10/10** determinista |

### B.4 Defecto pendiente

**Ninguno conocido.** Las limitaciones L1-L6 no son defectos: no hay comportamiento incorrecto, hay un margen
declarado. No se abre ninguno como pendiente de corrección.

## C. Evidencia de pruebas

| Ejecución | Resultado |
|---|---|
| Línea base (antes de editar, acto anterior) | **541/541**, 51 636 ms |
| `npm test` tras la corrección de la revisión | **563/563**, exit 0 (541 + 22 nuevas) |
| `npm run check` | exit 0 — 7 herramientas, sin dependencias de `@deepseek-ai/*` |
| `npm run test:hermetic` | **563/563** + `✓ hermético: el almacén real no cambió (10 ficheros)` |
| Suites dirigidas | `reliability` 9/9 · `optimizations` 12/12 · `sync` 26/26 |
| Prueba de presupuesto, repetida | **10/10** tras hacerla determinista (antes: 8/8 en aislado y 1 fallo bajo carga) |
| `EXPLAIN QUERY PLAN` | `id` → `SEARCH … USING INDEX`; `list` → `MATERIALIZE` + join (sin `CORRELATED`) |
| Comparaciones | embeddings por `context`: 1 + N → **1**; `quick_check` y puerta léxica: **sin cambio** (12,9 ms y 0,40/1,00 ms medidos) |

**Nota de disciplina de evidencia.** Al leer la prueba que contiene una clave PEM, el visor mostró
`[REDACTED PRIVATE KEY]` en lugar del texto real. Se comprobó con `git diff` que el fichero **está intacto** (y la
prueba que detecta el patrón pasa); no se «arregló» nada a partir de una salida redactada.

## D. Compatibilidad de contratos

- **v0.1 intacto**: dos pruebas congelan el valor de `search` (`elapsedMs|mode|results`) y las ocho claves de cada
  fila; siguen en verde y **no** se añadió `diagnostics` al valor.
- **Aditivo**: `ingest[].warnings`, `get.source.relUri`, `list.rows[].relUri`, `forget.chunks`.
- **Valor nuevo en campo existente**: `search.mode='lexical-fallback'`.
- **Corrección**: identidad por colección, con ids históricos preservados en `default`.
- **Consumidores revisados**: `maintenance.forgetSource`, `getAcross`, `findInLibraries`, `server.mjs` (`GET /sources/:id`,
  `forget`), `listProject`. Ninguno asumía unicidad global de `uri`; el nuevo error de ambigüedad es
  `invalid-argument` (400 en el mapa existente) y **falla en cerrado**.
- **Sin cambios**: esquema v3, registro v2, API `pa/1.4.0`, nombres/parámetros/orden de las siete herramientas,
  `package.json` (sigue `1.3.0`).

## E. Estado Git

| | Antes de la revisión | Después |
|---|---|---|
| HEAD | `7d7e839d514cca27044d595218bf8c67ec5a1f7d` | **idéntico** |
| Índice | vacío | **vacío** |
| `git status` | 51 (26 M / 25 ??) | **52 (27 M / 25 ??)** |
| Delta de la revisión | — | **+1 `M`** (`tests/sync.test.mjs`, antes limpio); **0 ficheros nuevos**; se corrigieron 4 ficheros ya modificados (`search`, `paths`, `sync`, `ingest`), se ampliaron 2 suites untracked (`reliability`, `optimizations`) y se ajustó `tests/sync.test.mjs` |

Desglose de los **27 `M`**: **18 preexistentes** (16 de UX-2.1 + `docs/PA-UI-0-API-CONTRACT.md` +
`docs/PROJECT-AWARE-SESSION-CONTRACT.md`) · **8 míos** (`lib/context`, `ingest`, `metrics`, `paths`, `scope-ops`,
`search`, `sync`, `tools`) · **1 mío** (`tests/sync.test.mjs`).
Los **25 `??`** incluyen los 15 previos más `plans/`, los documentos de continuidad y los tres ficheros nuevos del
acto (2 suites + `CONTRATO-EXTENSIONES-1.4.md`).

Sin commits, merges, rebases, stash, checkout ni clean. Los `M` preexistentes no se tocaron: sus huellas de código
siguen siendo las del inventario de la auditoría (`resolve 3a6338a2…`, `pa-api 14ff188d…`, `client ff8119dd…`,
`tools 2a3ac69b…`, `exec-context 03e14543…`, `sessions f770ec23…`, `selection 18b6f420…`, `index 23ed6951…`).

**Cambios preexistentes (ajenos a este acto), intactos:** 16 `M` de UX-2.1 (`client.js`, `index.js`, `lib/errors.mjs`,
`lib/harness-workspaces.mjs`, `lib/pa-api.mjs`, `lib/registry.mjs`, `lib/resolve.mjs`, `lib/selection.mjs`,
`lib/server.mjs`, `package.json`, `README.md`, 5 de `tests/`), `docs/PA-UI-0-API-CONTRACT.md`,
`docs/PROJECT-AWARE-SESSION-CONTRACT.md` y los `??` previos (7 documentos de continuidad, `plans/`, `_audit/`).
Sin commits, merges, rebases, stash, checkout ni clean.

## F. Dictamen

**APTO para empaquetar 1.4.0-draft.**

Cumple el mandato en los diez puntos revisados, los cinco defectos encontrados en esta revisión están corregidos y
fijados por prueba, no queda ningún defecto conocido y las limitaciones están declaradas con su porqué. La suite
completa y la puerta hermética están en verde, los datos reales no cambiaron y los contratos v0.1 siguen intactos.

**Condiciones del dictamen** (no son defectos, son el estado esperado):
1. Al empaquetar, el paquete debe incluir `docs/CONTRATO-EXTENSIONES-1.4.md` y subir versión; hoy `package.json`
   sigue en `1.3.0` a propósito.
2. L1 (recorrido por `uri`) y L4 (reembebido al reingerir sin cambios) son candidatos naturales al siguiente ciclo,
   con su propia medición; no bloquean.
