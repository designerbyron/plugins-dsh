# LifeCode RAG — Presupuestos de rendimiento

**Fecha:** 2026-11-17 · **Estado:** baseline medido + objetivos propuestos
**Regla:** ningún límite se inventa. Primero se mide el baseline; después se fija el objetivo y se
verifica con el mismo arnés.

---

## 1. Baseline medido hoy (v0.1.0)

> **Actualización v0.2.0:** las mediciones vigentes del motor v0.2 (1k/5k/10k chunks, con pesos RRF 3:1)
> están en [`eval/m5/INFORME-M5.md`](../../eval/m5/INFORME-M5.md) §2. La tabla siguiente se conserva como
> baseline histórico del banco de 42 consultas; no describe el motor actual.

Arnés: `node tools/benchmark.mjs` — 40 documentos sintéticos, 40 chunks, y **42 consultas**:
40 exactas (una por documento), **1 paráfrasis** (`instalar` frente a `instalación` en el corpus) y
**1 sin acento** (`instalacion`). No son 40 paráfrasis: ese banco no existe todavía y el documento no debe
sugerir que se midió. Almacén temporal, en este host (Windows 11, Electron 44.7 / Node 24.21).

| Medición | FTS5 | Híbrida (FTS+vector+RRF) |
|---|---|---|
| Recall@5 (40 exactas) | 1.000 | 1.000 |
| MRR@5 (40 exactas) | 1.000 | 0.988 |
| Recall@5 (1 paráfrasis) | 0.000 | 0.000 |
| Recall@5 (1 sin acento) | 1.000 | 1.000 |
| Latencia media | 0.16 ms | 0.68 ms |
| Latencia p95 | 0.31 ms | 0.79 ms |

Contexto (presupuesto 2000 tokens): 1702 tokens servidos frente a 13 010 del corpus completo,
**86.9 % de ahorro**, 0/40 truncados. Es una estimación `ceil(chars/4)`, no tokens reales.

**Límite honesto:** el corpus es pequeño (40 documentos) y el embedder `local-hash-v1` es léxico. Una sola
consulta de paráfrasis no estima la calidad semántica: el 0.000 dice «este caso falla», no «el sistema
falla en paráfrasis». Los presupuestos de §3 son objetivos de v0.2.0, no resultados.

### 1.1 Qué es baseline, qué es objetivo y qué exige arnés nuevo

| Dato | Origen | Válido para presupuestar |
|---|---|---|
| Recall/MRR/latencia de §1 | medido en v0.1.0 con 42 consultas | no; solo como referencia |
| Ahorro 86.9 % | medido en v0.1.0, estimación `ceil(chars/4)` | no; referencia |
| Umbrales de §3 | **propuesta** v0.2.0 sin medir | no hasta M0 |
| 120 consultas de `RETRIEVAL-EVALUATION.md` | especificación | no existe todavía |
| 1k/5k/10k chunks | requiere `tools/bench.mjs` (M0) | no hasta M0 |

No se puede inferir de 40 documentos el comportamiento con 10 000 chunks, ni de una paráfrasis la calidad
semántica. Cualquier tabla futura dirá escala, número de consultas y si el almacén estaba caliente.

## 2. Qué falta medir antes de fijar presupuestos

| Dimensión | Por qué no se puede presupuestar aún | Cómo se medirá |
|---|---|---|
| Búsqueda con 10k chunks | solo hay 40 | corpus sintético escalado (1k/5k/10k), mediana de 5 pasadas |
| Escritura/ingesta | no hay benchmark de ingesta | 200 ficheros, 20 MB, medir p50/p95 y memoria |
| Arranque del plugin | el host arranca el módulo, no la pestaña | `performance.now()` del host desde `apply` hasta registro |
| Apertura de pestaña | no hay UI aún | marca en el slot: montaje → primer esqueleto → primer snapshot |
| Memoria del Workspace | no hay UI | `process.memoryUsage().rss` antes/después de 10 aperturas |
| CPU en reposo | no hay polling aún | 5 min con pestaña oculta y visible, `os.loadavg` no sirve en Windows → CPU del proceso |
| Coste en tokens de una respuesta | requiere modelo | contar `context.tokens` + longitud de la respuesta, en benchmark de tarea |

## 3. Objetivos propuestos (a verificar en M0/M3; no son promesas)

| Superficie | Objetivo | Condición |
|---|---|---|
| `GET /snapshot` | p95 ≤ 60 ms | 10 000 chunks, conexión caliente |
| `GET /sources` | p95 ≤ 40 ms | 10 000 fuentes, página 50 |
| `POST /retrieval` (híbrida) | p95 ≤ 250 ms | 10 000 chunks, scan vectorial completo |
| `POST /retrieval` (FTS) | p95 ≤ 60 ms | misma base |
| Montaje de pestaña | esqueleto ≤ 150 ms | tras primer clic, módulo ya cargado |
| Primer dato real | ≤ 400 ms | snapshot en caliente |
| Memoria adicional | ≤ 40 MB RSS | con 6 secciones visitadas |
| CPU en reposo | ~0 % (sin intervalo cuando oculta) | pestaña oculta 5 min |
| Refresco visible | ≤ 1 petición / 30 s | ETag evita cuerpo completo |

Si un objetivo no se cumple, se documenta el número real y se decide: optimizar, paginar más o degradar
la función. No se ajusta el objetivo al resultado sin decirlo.

## 4. Reglas de diseño que sostienen los presupuestos

1. **Una conexión.** El plugin abre SQLite una vez; el read model la reutiliza. En Windows una segunda
   conexión sobre el mismo fichero puede bloquearse (`store-busy`), y abrir/cerrar por petición mata la latencia.
2. **Agregados, no escaneos.** `metrics_daily` evita calcular series sobre eventos crudos.
3. **Paginación real en SQL.** `LIMIT/OFFSET` con índices; nunca cargar todo y cortar en JS.
4. **Texto bajo demanda.** La lista no trae `chunk.text`; el detalle lo pide por chunk.
5. **Sin trabajo pesado en el hilo de UI.** Agregaciones grandes y exportaciones van al hilo del host;
   el cliente solo pinta lo recibido. Si en M3 una consulta bloquea > 50 ms, se mueve a `worker_threads`
   (disponible en el host, ya probado).
6. **Sin polling oculto.** El intervalo vive en el panel y se activa solo si
   `usePanelInfo(info => info.activePanelId === 'lifecode-rag')` **y** `document.visibilityState === 'visible'`;
   al cambiar de panel o minimizar, se limpia. `visibilityState` no sustituye la señal de panel activo (§5
   de `WORKSPACE-UX.md`).
7. **Cancelación.** Toda operación larga acepta `AbortSignal` y se comprueba entre unidades (fichero,
   fuente), nunca a mitad de una transacción.
8. **Cierre limpio.** Desmontar la pestaña libera intervalos, listeners y gráficos; no deja procesos.

## 5. Medición reproducible

- `tools/bench.mjs` (nuevo en M0) con modos `--scale 1000|5000|10000`, `--seed`, `--runs 5`, salida JSON
  y markdown; mismo corpus semilla para comparar versiones.
- Cada informe declara: máquina, versión de Node/Electron, tamaño del corpus, número de pasadas,
  y si el almacén estaba caliente o frío.
- La UI mide con `performance.mark/measure` y envía un resumen agregado **solo** si la analítica está
  activa; sin texto.

## 6. Degradación segura

| Situación | Comportamiento |
|---|---|
| Almacén bloqueado | `423 store-busy`, reintento único con backoff corto, mensaje claro |
| Consulta demasiado amplia | `limit` acotado; `partial:true` si se recorta |
| Vector scan > techo | `truncated:true` en `vectors`, la UI lo muestra |
| Memoria alta | el Workspace descarta series largas y pide buckets mayores |
| UI lenta | esqueleto primero; secciones bajo demanda; nunca bloquear el hilo |

## 7. Criterio de aceptación de rendimiento

Un criterio solo pasa si: (a) existe el número medido en el informe, (b) el arnés es reproducible con el
comando publicado, (c) la cifra se midió en este host, no en otro. Si no, queda `PARTIAL`.
