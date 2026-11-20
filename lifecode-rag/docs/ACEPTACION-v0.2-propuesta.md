# LifeCode RAG — Matriz de aceptación v0.2.0 (propuesta)

**Fecha:** 2026-11-17 · **Estado:** propuesta; v0.2.0 no está implementada
**Regla:** `PASS` exige evidencia reproducible. Lo no construido es `NOT TESTED`, no un aprobado por silencio.

## Leyenda

| Estado | Significado |
|---|---|
| PASS | verificado con evidencia enlazada |
| PARTIAL | parte verificada, parte pendiente |
| NOT TESTED | no implementado o no ejecutado |
| BLOCKED | requiere autorización o capacidad externa |

## A. Arquitectura

| ID | Criterio | Método | Evidencia esperada | Estado hoy |
|---|---|---|---|---|
| ARCH-01 | Independencia total de Skill Center | `tools/check.mjs` (imports/rutas/deps) + revisión | salida del checker, 0 aciertos de `lifecode-skill-center` | PASS (v0.1.0) |
| ARCH-02 | Separación Core / Workspace | revisión de módulos: `client.js` solo HTTP | `client.js` sin `node:fs`/SQLite | PARTIAL (diseñado, no escrito) |
| ARCH-03 | Contratos internos definidos | existencia y revisión de docs | `ARCHITECTURE-v0.2.md` §§5–7 | PASS (documento) |
| ARCH-04 | Puertos con contrato mínimo | `EMBEDDING-PROVIDERS.md` + `ARCHITECTURE-v0.2.md` | interfaces y errores | PASS (documento) |
| ARCH-05 | Compatibilidad con el host demostrada | `Slots.listSubTree`, `webServer` API, precedente LSC | consultas y líneas citadas | PASS |
| ARCH-06 | Sin dependencias nuevas | `package.json` + `tools/check.mjs` | lista de deps vacía | PASS (v0.1.0; se re-verifica) |
| ARCH-07 | Las siete tools no cambian | `CONTRATO-v0.1.md` vs `lib/tools.mjs` | mismo schema; tests 66/66 | PASS |

## B. Workspace

| ID | Criterio | Método | Evidencia esperada | Estado hoy |
|---|---|---|---|---|
| WS-01 | Pestaña nativa registrada | abrir DSH y ver icono + panel | captura/consola sin errores | NOT TESTED |
| WS-02 | Seis secciones especificadas | revisión de `WORKSPACE-UX.md` | secciones §3.1–§3.6 | PASS (documento) |
| WS-03 | Estados reales (vacío/error/parcial/cargando) | prueba manual por sección | matriz de estados | NOT TESTED |
| WS-04 | Controles funcionales y persistentes | cambiar cada control y reiniciar | configuración leída de vuelta | NOT TESTED |
| WS-05 | Sin métricas ficticias | revisión de cada tarjeta | cada número con `source` y fecha | NOT TESTED |
| WS-06 | Accesibilidad | teclado + lector + `forced-colors` | checklist `WORKSPACE-UX.md` §6 | NOT TESTED |
| WS-07 | Adaptable a ancho de panel | 320/480/900 px | sin desbordes ni scroll horizontal | NOT TESTED |
| WS-08 | Fallo de UI aislado | forzar error de render | tools siguen respondiendo | NOT TESTED |
| WS-09 | Presupuesto de apertura | arnés de rendimiento | esqueleto ≤150 ms, lista ≤180 ms | NOT TESTED (objetivo propuesto) |

## C. Observabilidad

| ID | Criterio | Método | Evidencia esperada | Estado hoy |
|---|---|---|---|---|
| OBS-01 | Agregados, no eventos crudos | revisión de esquema | `metrics_daily` sin columnas de texto | NOT TESTED |
| OBS-02 | Sin prompts/respuestas/conversaciones | test que ingiere y consulta frases canario | 0 apariciones en la BD | NOT TESTED |
| OBS-03 | Procedencia por métrica | revisión de `/metrics/summary` | `source` medido/derivado/estimado | NOT TESTED |
| OBS-04 | Retención y purga | avanzar reloj / insertar días antiguos | filas >90 d eliminadas y auditadas | NOT TESTED |
| OBS-05 | Sin polución del benchmark | flags `lab`/`tool`/`bench` | consultas de laboratorio no cuentan | NOT TESTED |
| OBS-06 | Consulta de métricas barata | medir `metricsSummary` | ≤60 ms p95 con 90 días | NOT TESTED |

## D. Automatización y gobernanza

| ID | Criterio | Método | Evidencia esperada | Estado hoy |
|---|---|---|---|---|
| AUTO-01 | Tres niveles definidos | revisión `AUTOMATION-POLICIES.md` §3 | tabla de acciones | PASS (documento) |
| AUTO-02 | Aprobaciones preservadas | test: forget/egress/paths externos | `allowed-once` obligatorio; sin él, error | PASS (v0.1.0) |
| AUTO-03 | Políticas deniegan, no aprueban | revisión de `evaluate()` | sin retorno `allow` para `approve` | NOT TESTED |
| AUTO-04 | Cancelación y recuperación | cancelar reindex por fuente | `cancelled` y estado íntegro | PARTIAL (v0.1.0: señal entre fuentes) |
| AUTO-05 | Indexación automática acotada | activar en raíz de prueba | respeta raíces, presupuesto y pausa | NOT TESTED |
| AUTO-06 | Cambios de política auditados | cambiar y consultar auditoría | entrada con antes/después | NOT TESTED |

## E. Rendimiento

| ID | Criterio | Método | Evidencia esperada | Estado hoy |
|---|---|---|---|---|
| PERF-01 | Baseline documentado | `tools/bench.mjs` | JSON con 1k/5k/10k | PARTIAL (solo corpus sintético 40) |
| PERF-02 | Carga diferida | abrir pestaña y medir red | datos tras primer frame | NOT TESTED |
| PERF-03 | Sin polling oculto | pestaña cerrada, contar peticiones | 0 | NOT TESTED |
| PERF-04 | Memoria adicional | RSS antes/después de abrir y cerrar | ≤40 MB | NOT TESTED (objetivo) |
| PERF-05 | Recuperación tras fallo del host | reiniciar host con pestaña abierta | pestaña vuelve a estado sano | NOT TESTED |
| PERF-06 | Presupuesto de contexto | `context` con 2000 tokens | ≤2000 y 0 truncados con corpus de prueba | PASS (v0.1.0: 1702) |

## F. Recuperación y evaluación

| ID | Criterio | Método | Evidencia esperada | Estado hoy |
|---|---|---|---|---|
| RET-01 | Corpus v1 congelado | fichero + hash | 120 consultas, juicios previos | NOT TESTED |
| RET-02 | B0/B1/B2 reproducibles | un comando, 3 pasadas | informe ±1 punto | PARTIAL (B0/B2 sintético) |
| RET-03 | Calidad semántica medida | S1/S2 con proveedor candidato | NDCG@10 y latencia | BLOCKED (sin proveedor; no se instala) |
| RET-04 | Citas verificables | comparar `charStart/End` con fuente | 100 % dentro del rango | PARTIAL (estructura v0.1.0) |
| RET-05 | Sin afirmar mejora no medida | revisión de textos de UI | cada afirmación con informe | NOT TESTED |
| RET-06 | Held-out intacto | registro de uso | una sola evaluación por versión | NOT TESTED |

## G. Resumen

**40 criterios** (7 arquitectura + 9 Workspace + 6 Observabilidad + 6 Automatización + 6 Rendimiento +
6 Recuperación). Cada fila se contó individualmente; los estados no se alteraron para cuadrar el resumen.

| Grupo | PASS | PARTIAL | NOT TESTED | BLOCKED | Total |
|---|---:|---:|---:|---:|---:|
| Arquitectura | 6 | 1 | 0 | 0 | 7 |
| Workspace | 1 | 0 | 8 | 0 | 9 |
| Observabilidad | 0 | 0 | 6 | 0 | 6 |
| Automatización | 2 | 1 | 3 | 0 | 6 |
| Rendimiento | 1 | 1 | 4 | 0 | 6 |
| Recuperación | 0 | 2 | 3 | 1 | 6 |
| **Total** | **10** | **5** | **24** | **1** | **40** |

**Lectura:** 10 PASS son 6 documentales (diseño aprobado: ARCH-03/04, AUTO-01, WS-02 y la independencia
ARCH-01/05 verificable por checker) y 4 heredados de v0.1.0, que se identifican como tales en su fila
(ARCH-06, ARCH-07, AUTO-02, PERF-06). Todo lo que depende de construir la UI, el read model o las
políticas está `NOT TESTED`; la calidad semántica está `BLOCKED` por decisión explícita (no se descargan
modelos en esta fase). Un PASS heredado no acredita v0.2.0: solo dice que la base v0.1.0 ya lo cumplía.
La matriz se actualizará por milestone, no al final.
