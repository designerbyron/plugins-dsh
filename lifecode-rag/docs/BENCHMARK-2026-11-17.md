# Benchmark — LifeCode RAG v0.1.0

**Fecha:** 2026-11-17  
**Alcance:** recuperación léxica contra híbrida, y coste de contexto frente a cargar el corpus.  
**Entorno:** Windows 11, Node 24.21.0 (Electron 44.7.0 en modo Node), SQLite 3.53.4 con FTS5, embedder
`local-hash-v1` de 256 dimensiones. Almacén temporal; el almacén real no se toca.

## Cómo se reproduce

```sh
cd lifecode-rag
node tools/benchmark.mjs
```

El banco crea un almacén temporal, lo llena, mide y lo borra. No escribe en `$DSH_HOME`.

## Corpus y consultas

- 40 documentos sintéticos, 40 fragmentos, un tema por documento.
- 40 consultas **exactas** (una por documento, con su término distintivo).
- 1 consulta de **paráfrasis**: el documento dice `instalación`, la consulta dice `instalar`.
- 1 consulta **sin acento**: `instalacion`.
- Recuperación a Top-5; el contexto se mide con `budgetTokens = 2000` y `maxChunks = 12`.

## Resultados

| Estrategia | Recall@5 exactas | MRR@5 exactas | Latencia media (ms) | p95 (ms) |
|---|---:|---:|---:|---:|
| FTS (BM25) | 1.000 | 1.000 | 0.16 | 0.31 |
| Híbrido (FTS + vectores, RRF k=60) | 1.000 | 0.988 | 0.68 | 0.79 |

| Estrategia | Recall@5 paráfrasis (`instalar`) | Recall@5 sin acento (`instalacion`) |
|---|---:|---:|
| FTS (BM25) | 0.000 | 1.000 |
| Híbrido | 0.000 | 1.000 |

| Contexto | Valor |
|---|---:|
| Tokens medios con presupuesto 2000 | 1702 |
| Tokens del corpus completo (sin recuperación) | 13010 |
| Consultas truncadas | 0 / 40 |
| Ahorro frente a cargar el corpus | **86.9 %** |

Cifras de una ejecución representativa (`node tools/benchmark.mjs`, 2026-11-17); la latencia varía unos
pocos centésimas entre ejecuciones y no es una promesa de rendimiento. Recall y MRR son deterministas
para este corpus.

## Lectura honesta

1. **La ganancia de contexto es real y reproducible** en este corpus: 1702 frente a 13010 tokens
   estimados. Es la métrica que justifica el producto, y es la única que se afirma como ahorro.
2. **El híbrido no supera a BM25 en este corpus.** Empata en Recall@5 y pierde dos milésimas de MRR@5
   (0.988 frente a 1.000), costando ~4× por consulta (0.68 ms frente a 0.16 ms). Con 40 fragmentos, la
   búsqueda vectorial no aporta señal que el léxico no tenga ya. No se declara una mejora semántica que
   no se ha medido.
3. **`local-hash-v1` es léxico, no semántico.** Indexa tokens (con bigramas), no significado: la
   paráfrasis fuera del vocabulario no se recupera en ninguno de los dos modos. Un proveedor neuronal
   opt-in es la vía para cerrar esa brecha; queda fuera de v0.1.0 y no se simula.
4. **Los tokens son una estimación** (`ceil(caracteres / 4)`), no un conteo del tokenizador real del
   modelo. La columna se publica con esa procedencia; AC20 queda por tanto en estado parcial.

## Límites del banco

- Corpus sintético y pequeño; no representa documentación real de proyecto.
- No mide llamadas al modelo, ni su coste, ni la calidad de la respuesta final. AC26/AC28 quedan
  parciales por eso.
- MRR se mide a 5, no a 10 (AC27 parcial).
- La latencia incluye SQLite y el cálculo de embeddings locales; no incluye el arranque del proceso.
