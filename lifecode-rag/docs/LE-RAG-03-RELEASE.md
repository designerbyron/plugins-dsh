# LE-RAG-03 · Candidato y evidencia

Prueba funcional y benchmark sobre una **copia** del almacén real (`rag.sqlite3`, sólo lectura).
El almacén original no se abrió para escritura en ningún momento.

## Benchmark real (copia)

Corpus: 121 fuentes · 964 fragmentos · 964 vectores · 3862528 B · columnas de vectores: chunk_key, model, dim, vec.

| Medida | p50 (ms) | p95 (ms) | n |
|---|---|---|---|
| real:fts | 0.486 | 1.034 | 20 |
| real:hybrid:fragment | 9.796 | 11.011 | 20 |
| real:hybrid:source | 10.305 | 15.095 | 20 |
| real:vector-only | 8.924 | 9.915 | 20 |

Calentamiento: 5 · Node v24.21.0 · win32 · RSS 55.2 → 108.2 MB.

Consulta `proyecto aware`, límite 8, `record:false`. Sin escrituras. Sin optimizaciones aplicadas.

## Prueba funcional

`eval/le-rag-03/functional.mjs`: determinismo, límite, primera aparición por fuente, RRF intacto (mismas puntuaciones por fragmento entre `fragment` y `source`) y paridad resolvedor ↔ diagnóstico. Resultado en `eval/le-rag-03/functional-report.json`.
