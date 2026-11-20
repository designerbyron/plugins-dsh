# Aceptación — LifeCode RAG v0.2.0

**Fecha:** 2026-11-17
**Ámbito:** implementación M0–M5 ejecutada en este árbol de trabajo.
**Repositorio:** `C:\xampp\htdocs\plugins-dhs` (rama `fix/t45-4-r17-acceptance`).
**Estado del producto:** funcional en entorno aislado; **no instalado** en el perfil de DeepSeek Harness (M6 no autorizado).

## Cómo leer esta matriz

Cada fila declara cuatro dimensiones independientes:

| Dimensión | Significado |
|---|---|
| **Diseñada** | Existe contrato o especificación aprobada. |
| **Implementada** | Existe código funcional en el árbol. |
| **Probada** | La prueba se ejecutó y su resultado se registró. |
| **Verificada** | Una comprobación independiente confirma el resultado (no el mismo mecanismo que lo produce). |

Estados: `NOT STARTED`, `IN PROGRESS`, `IMPLEMENTED`, `PASS`, `PARTIAL`, `FAIL`, `BLOCKED`, `NOT TESTED`.
`IMPLEMENTED` no es `PASS`: una fila puede tener código y no tener prueba ejecutada.

## Matriz

### M0 — Arnés y rendimiento

| ID | Funcionalidad | Diseñada | Implementada | Probada | Verificada | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| M0-01 | Corpus sintético determinista (semilla reproducible), fuera del repositorio | sí | sí | sí | sí | PASS | `tools/harness.mjs`; dos ejecuciones con la misma semilla producen los mismos documentos |
| M0-02 | Medición real a 1.000 chunks | sí | sí | sí | sí | PASS | R6: `harness-2026-11-18T02-04-29-255Z.json` (3 reps; ingesta 2.473,0 ms; FTS p50 0,387 ms; Recall@5 1,000) |
| M0-03 | Medición real a 5.000 chunks | sí | sí | sí | sí | PASS | R6 (ingesta 13.431,7 ms; 372,3 chunks/s; RSS 336,2 MB) |
| M0-04 | Medición real a 10.000 chunks | sí | sí | sí | sí | PASS | R6 (ingesta 39.844,3 ms; 251,0 chunks/s; DB 47,9 MB; rango 35,4–51,8 s) |
| M0-05 | Métricas separadas: medidas / estimadas | sí | sí | sí | parcial | PARTIAL | latencias medidas con `performance.now()`; percentiles **estimados por histograma** y así etiquetados |
| M0-06 | Sin truncamientos silenciosos en contexto | sí | sí | sí | sí | PASS | `tests/efficiency.test.mjs`: presupuesto mínimo devuelve texto vacío + `truncated:true` |

### M1 — Motor de recuperación

| ID | Funcionalidad | Diseñada | Implementada | Probada | Verificada | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| M1-01 | Estrategia `fts` (BM25) | sí | sí | sí | sí | PASS | `tests/search.test.mjs`; harness Recall@5 1,000 a 1k/5k/10k |
| M1-02 | Estrategia vectorial: similitud coseno sobre vectores; proveedor actual `local-hash-v1` (**léxico**, no neuronal) | sí | sí | sí | sí | PASS | `tests/search.test.mjs` (estrategia explícita); el mecanismo vectorial funciona aunque el proveedor no aporte semántica |
| M1-03 | Estrategia `hybrid` (RRF ponderado) | sí | sí | sí | sí | PASS | `tests/server.test.mjs` (`diagnostics.strategy==='hybrid'`); harness |
| M1-04 | Pesos RRF configurables | sí | sí | sí | sí | PASS | `lib/paths.mjs` validación; experimento de pesos en `eval/m5/harness` |
| M1-05 | Filtros por colección y etiquetas (`any`/`all`) | sí | sí | sí | sí | PASS | `tests/search.test.mjs` |
| M1-06 | `minScore` y `maxPerSource` | sí | sí | sí | no | PARTIAL | implementados y validados; sin prueba dedicada de su efecto en el ranking |
| M1-07 | Deduplicación de fragmentos y control de presupuesto | sí | sí | sí | sí | PASS | `lib/context.mjs`; `tests/efficiency.test.mjs` |
| M1-08 | Procedencia en cada cita (fuente, título, ordinal, rango) | sí | sí | sí | sí | PASS | `tests/tools.test.mjs`; captura `contexto.png` |
| M1-09 | Abstracción de proveedor de embeddings (local/remoto) | sí | sí | sí | sí | PASS | `lib/embedders.mjs`; `tests/embed.test.mjs` |
| M1-10 | Proveedor semántico real (neuronal) | sí | no | no | no | BLOCKED | no hay proveedor autorizado ni endpoint aprobado; M6/egress requieren autorización |
| M1-11 | Fallo del proveedor no rompe la consulta | sí | sí | sí | sí | PASS | `createEmbedder` lanza `embedding-failed`; `search` propaga error controlado |
| M1-12 | Corpus vacío y consultas sin resultados | sí | sí | sí | sí | PASS | `tests/search.test.mjs`; harness `emptyResultsMedian: 0` con corpus poblado |
| M1-13 | Calidad híbrida a escala (Recall@5) | sí | sí | sí | sí | PASS | 10k con pesos por defecto 3:1 → Recall@5 1,000 (FTS 1,000); con 1:1 → 0,692. Ver §Limitaciones |

### M2 — Workspace nativo

| ID | Funcionalidad | Diseñada | Implementada | Probada | Verificada | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| M2-01 | Icono en `sidebar.panellist` y panel en `main` (clave `lifecode-rag`) | sí | sí | sí | sí (estática) | PASS | `client.js`; `tests/client.test.mjs` |
| M2-02 | API HTTP `/lifecode-rag/api` (GET/POST) | sí | sí | sí | sí | PASS | `tests/server.test.mjs` |
| M2-03 | Seguridad: Host loopback, cabecera de escritura, Content-Type | sí | sí | sí | sí | PASS | `tests/server.test.mjs` (Host ajeno → 403) |
| M2-04 | Alta de fuentes (fichero o carpeta) desde el panel | sí | sí | sí | sí | PASS | `POST /actions {ingest}`; captura `fuentes.png` |
| M2-05 | Listado, detalle y fragmentos de fuentes | sí | sí | sí | sí | PASS | `GET /sources`, `/sources/:id`; demo |
| M2-06 | Baja de fuente con confirmación explícita | sí | sí | sí | sí | PASS | 409 sin `confirm:true`; 200 con confirmación |
| M2-07 | Reindexación con confirmación | sí | sí | sí | sí | PASS | `POST /actions {reindex}` |
| M2-08 | Configuración editable desde el panel | sí | sí | sí | sí | PASS | `POST /actions {config}`; auditoría `config.update` |
| M2-09 | Panel real cargado en el host | sí | sí | no | no | NOT TESTED | requiere instalación (M6) o perfil de desarrollo; no autorizado |
| M2-10 | Demostración aislada navegable con 8 capturas | sí | sí | sí | sí | PASS | `demo/`; `eval/m5/capturas/*.png` (1280×920, PNG reales) |

### M3 — Observabilidad

| ID | Funcionalidad | Diseñada | Implementada | Probada | Verificada | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| M3-01 | Métricas agregadas en `metrics_daily` | sí | sí | sí | sí | PASS | `tests/metrics.test.mjs`; captura `metricas.png` |
| M3-02 | Vocabulario cerrado de métricas y dimensiones | sí | sí | sí | sí | PASS | `lib/metrics.mjs` `METRICS`, `DIM_PATTERN`; prueba de privacidad |
| M3-03 | Sin prompts, respuestas ni texto de documentos | sí | sí | sí | sí | PASS | `tests/metrics.test.mjs` (token secreto ausente; columnas fijas) |
| M3-04 | Latencias con histograma y percentiles etiquetados | sí | sí | sí | sí | PASS | `estimatePercentile`; etiqueta «estimado por histograma» en el panel |
| M3-05 | Series temporales por métrica y dimensión | sí | sí | sí | sí | PASS | `GET /metrics/series`; `points` |
| M3-06 | Retención y purga por política | sí | sí | sí | parcial | PARTIAL | `purgeMetrics` + `retentionCutoff`; prueba unitaria de cálculo; sin prueba de purga programada en host |

### M4 — Automatización

| ID | Funcionalidad | Diseñada | Implementada | Probada | Verificada | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| M4-01 | Indexación automática por `watchRoots` | sí | sí | sí | sí | PASS | `tests/automation.test.mjs` |
| M4-02 | Detección de cambios (hash) y omisión de duplicados | sí | sí | sí | sí | PASS | re-ejecución omite; fichero modificado se reindexa |
| M4-03 | Límite `maxFilesPerRun` | sí | sí | sí | sí | PASS | 2 → 1 en dos pasadas |
| M4-04 | Cancelación por señal entre ficheros | sí | sí | sí | sí | PASS | auditoría con 0 fuentes |
| M4-05 | Deshabilitado sin raíces / sin permiso | sí | sí | sí | sí | PASS | motivo explícito, sin escrituras |
| M4-06 | Temporizador en el host (arranque/parada por `ctx.effect`) | sí | sí | sí | no | PARTIAL | el adaptador lo arranca; el ciclo real del temporizador no se verificó en el host |
| M4-07 | Recuperación automática antes de responder | sí | no | no | no | BLOCKED | el host no ofrece hook previo a la generación; no se inventa |

### M5 — Integración y aceptación

| ID | Funcionalidad | Diseñada | Implementada | Probada | Verificada | Estado | Evidencia |
|---|---|---|---|---|---|---|---|
| M5-01 | Flujo A: alta → índice → estado → búsqueda → fragmentos | sí | sí | sí | sí | PASS | `tests/server.test.mjs`; `demo/`; capturas `fuentes.png`, `buscar.png` |
| M5-02 | Flujo B: consulta → resultados → contexto → procedencia | sí | sí | sí | sí | PASS | `tests/tools.test.mjs`; `contexto.png` |
| M5-03 | Flujo C: operaciones → métricas → sin texto sensible | sí | sí | sí | sí | PASS | `tests/metrics.test.mjs`; `metricas.png` |
| M5-04 | Flujo D: automatización con límites y permisos | sí | sí | sí | sí | PASS | `tests/automation.test.mjs` |
| M5-05 | Regresión del contrato v0.1 (7 herramientas) | sí | sí | sí | sí | PASS | `tests/tools.test.mjs`, `tests/adapter.test.mjs` |
| M5-06 | Suite completa | sí | sí | sí | sí | PASS | `node --test` (ver informe de regresión para cifra final) |
| M5-07 | Dependencias: cero `@deepseek-ai/*` | sí | sí | sí | sí | PASS | `tools/check.mjs` |
| M5-08 | Hermético: el almacén real no cambia | sí | sí | sí | sí | PASS | `tools/hermetic.mjs` (el almacén real no existe) |
| M5-09 | Capturas reales de la interfaz | sí | sí | sí | sí | PASS | 8 PNG 1280×920 en `eval/m5/capturas/`, verificados por cabecera IHDR |
| M5-10 | Instalación en el perfil real | sí | no | no | no | BLOCKED | M6 no autorizado |

## Terminología: vectorial ≠ semántico

Tres cosas distintas que este documento no debe confundir:

1. **Estrategia vectorial** — mecanismo implementado: cada fragmento tiene un vector y la consulta se compara por similitud coseno; ese ranking se fusiona con BM25. Está implementado y probado (`tests/search.test.mjs`).
2. **Proveedor local `local-hash-v1`** — genera esos vectores a partir de hashes de tokens (con bigramas). Es **léxico**: no hay modelo neuronal, no entiende paráfrasis ni significado. Que la estrategia vectorial funcione **no** convierte al proveedor en semántico.
3. **Proveedor semántico neuronal** — no implementado ni autorizado. Estado **BLOCKED** (M1-10) hasta que exista autorización, un modelo evaluado y una medición reproducible de calidad.

Por eso la fila M1-02 se llama «estrategia vectorial» y no «embeddings semánticos», y ninguna captura o tabla afirma comprensión de paráfrasis.

## Limitaciones declaradas (honestas)

1. **El proveedor por defecto es léxico, no semántico.** `local-hash-v1` es un hash de tokens con vector normalizado: sirve para toda la infraestructura (almacenamiento, fusión, migración, privacidad) pero **no** aporta semántica neuronal. Con él, la fusión 1:1 degrada la calidad a escala (Recall@5 0,692 a 10.000 chunks); por eso los pesos por defecto son **3:1** (léxico:vectorial), medidos a 1k, 5k y 10k. Cuando exista un proveedor neural aprobado, la comparación de calidad deberá repetirse y los pesos reajustarse; el valor por defecto no debe interpretarse como una afirmación semántica.
2. **El panel nativo no se ha cargado en el host.** El `client.js` cumple el contrato de slots (verificado estáticamente) y la experiencia se demuestra con el panel aislado; la integración real requiere M6.
3. **La automatización se prueba llamando a `runOnce`.** El temporizador se arranca en el adaptador, pero su ciclo real no se verificó en el host.
4. **Los percentiles son estimaciones por histograma**, no cuantiles exactos; el panel lo dice.
5. **La API no autentica procesos locales.** Su modelo de amenaza es CSRF/DNS-rebinding, no un adversario local con acceso al bucle; está documentado en `WORKSPACE-API.md` §5.
6. **No hay hook de recuperación automática previa a la respuesta** en el host; no se simula.
7. **Métricas `context.*` y `query.*` se registran de forma best-effort**: un fallo de telemetría no invalida la consulta.
