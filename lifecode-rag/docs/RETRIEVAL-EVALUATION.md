# LifeCode RAG — Evaluación de recuperación

**Fecha:** 2026-11-17 · **Estado:** protocolo propuesto; corpus aún no construido
**Principio:** la calidad se mide contra un corpus congelado y reproducible. Sin corpus, no hay afirmación.

---

## 1. Qué se evalúa y qué no

| Capa | Se evalúa aquí | Método |
|---|---|---|
| Recuperación | sí | ranking contra juicios de relevancia |
| Contexto | sí | presupuesto, truncado, diversidad, citas correctas |
| Respuesta generada | **no** | requeriría juzgar texto del modelo; no se hace en v0.2 |

No se atribuye a RAG una mejora en la respuesta si no se midió la respuesta. Se puede medir que el
contexto contiene la evidencia y que la cita apunta al chunk correcto; eso es todo.

## 2. Corpus

120 consultas sobre un corpus de ~120 documentos (texto, markdown, algo de código y CSV), en español e
inglés, con solapamiento deliberado y contradicciones controladas.

| Categoría | N | Qué prueba |
|---|---|---|
| Exacta | 30 | el término aparece literal |
| Paráfrasis | 30 | mismo significado, otras palabras (`instalar` vs `instalación`) |
| Sinónimo | 20 | vocabulario distinto (`desplegar` vs `publicar`) |
| Ambigua | 15 | dos documentos plausibles; el ranking debe separarlos |
| Bilingüe | 10 | consulta en un idioma, documento en otro |
| Documento largo | 10 | el chunk correcto está lejos del inicio |
| Contradicción | 5 | dos documentos dicen cosas opuestas; ambos deben aparecer |

Cada consulta lleva: `id`, `texto`, `idioma`, `categoría`, `relevantes[]` (chunk keys o URIs+offsets),
`grado` (0/1/2 para NDCG) y una nota de por qué es relevante. Los juicios se escriben **antes** de mirar
resultados, para no ajustar el corpus al sistema.

## 3. Métricas

Con `R_k` = relevantes en el top-k y `N` = consultas:

- **Recall@K** = (Σ |R_k| / |relevantes|) / N. K ∈ {5, 10}.
- **MRR@K** = (Σ 1/rank del primer relevante, o 0) / N. K ∈ {5, 10}.
- **Precision@K** = (Σ |R_k| / K) / N.
- **NDCG@10** con ganancia `2^g − 1` y descuento `log2(rank+1)`; ideal por consulta.
- **Calidad de cita** = citas cuyo `(uri, charStart..charEnd)` cae dentro de un relevante / citas totales.
- **Latencia** p50/p95 por estrategia, medidas en el mismo proceso.
- **Tokens de contexto** p50/p95 y ratio frente al corpus (estimación declarada).

Toda tabla publica N, mediana de 3 pasadas y rango, no solo la media.

## 4. Matriz de configuraciones

| ID | Estrategia | Embedder | MMR | Notas |
|---|---|---|---|---|
| B0 | FTS5 | — | no | línea base léxica |
| B1 | vectorial | `local-hash-v1` | no | mide el hash solo |
| B2 | híbrida RRF | `local-hash-v1` | no | actual |
| B3 | híbrida RRF | `local-hash-v1` | sí (λ=0.7) | actual + contexto |
| S1 | híbrida RRF | candidato semántico | no | tras M6 |
| S2 | híbrida RRF | candidato semántico | sí | tras M6 |

Sin proveedor semántico, S1/S2 no existen y la tabla lo dice: `NOT TESTED`, no un cero.

## 5. Resultados v0.1.0 (baseline real)

Del arnés `tools/benchmark.mjs`, corpus sintético de 40 docs / 40 chunks (no es el corpus de 120) y
**42 consultas**: 40 exactas + 1 de paráfrasis (`instalar`) + 1 sin acento (`instalacion`):

| Config | Recall@5 exactas | MRR@5 exactas | Recall@5 paráfrasis (1) | Recall@5 sin acento (1) | Latencia media |
|---|---|---|---|---|---|
| B0 FTS | 1.000 | 1.000 | 0.000 | 1.000 | 0.16 ms |
| B2 Híbrida | 1.000 | 0.988 | 0.000 | 1.000 | 0.68 ms |

Lectura honesta: el sistema recupera bien lo literal y **no** resuelve paráfrasis. Una sola consulta de
paráfrasis no estima calidad semántica; el 0.000 documenta un caso que falla, no una tasa. Eso es
exactamente lo que el corpus de evaluación debe exponer, no ocultar.

## 6. Protocolo

1. Congelar corpus y juicios con SHA-256 (fichero `eval/corpus-v1.json` + `.sha256`).
2. Ejecutar cada configuración 3 veces con almacén reconstruido desde cero.
3. Publicar `eval/report-<fecha>-<config>.json` con: commit/versión, host, node/electron, corpus hash,
   métricas por categoría, latencias y tamaños.
4. La promoción de un cambio de recuperación exige: sin regresión > 2 puntos en exactas, mejora ≥ 5
   puntos en paráfrasis/NDCG@10, y latencia p95 dentro del presupuesto.
5. Un cambio que no cumple no se promociona aunque "parezca mejor".

## 7. Anti-overfitting

- Conjunto de **desarrollo** (80 consultas) y **held-out** (40) separados desde el inicio; el held-out se
  toca una vez por versión.
- Prohibido ajustar chunking/K/λ mirando el held-out.
- Si se cambia el corpus, se versiona (`corpus-v2`) y se vuelve a medir todo, incluida la línea base.
- Los informes guardan el hash del corpus para que no se pueda "mejorar" editándolo.

## 8. Formato del informe

```json
{
  "version": "0.2.0",
  "corpus": { "id": "corpus-v1", "sha256": "…", "queries": 120, "docs": 118 },
  "config": { "id": "B2", "strategy": "hybrid", "embedder": "local-hash-v1", "mmr": false },
  "metrics": {
    "recall@5": 0.71, "recall@10": 0.83, "mrr@5": 0.62, "mrr@10": 0.66, "ndcg@10": 0.69,
    "citation": 0.94,
    "byCategory": { "exact": { "recall@5": 0.97 }, "paraphrase": { "recall@5": 0.31 } }
  },
  "latency": { "p50": 0.9, "p95": 2.4, "unit": "ms" },
  "tokens": { "p50": 1600, "p95": 1990, "method": "ceil(chars/4)" },
  "host": { "os": "Windows 11", "node": "24.21.0", "electron": "44.7.0" }
}
```

Los números del ejemplo son **formato**, no resultados.

## 9. Criterios de aceptación propuestos

- AC-R1: el corpus v1 existe, está congelado y su hash está publicado.
- AC-R2: B0/B1/B2 se reproducen con un comando y coinciden ±1 punto con el informe anterior.
- AC-R3: cada afirmación de mejora en la UI cita el informe y la configuración exacta.
- AC-R4: el held-out no se usó para tuning (declaración + fechas).
- AC-R5: sin proveedor semántico, S1/S2 figuran `NOT TESTED`, nunca con números inventados.
