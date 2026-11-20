# Herramientas del modelo

LifeCode RAG expone siete herramientas con el prefijo `lifecode_rag_`. Son el contrato público
v0.1 y permanecen congeladas.

| Herramienta | Para qué sirve |
|---|---|
| `lifecode_rag_ingest` | Indexa ficheros o carpetas; acepta colección, etiquetas y `force`. |
| `lifecode_rag_search` | Busca y devuelve resultados compactos con fragmento y puntuación. |
| `lifecode_rag_context` | Ensambla contexto con presupuesto de tokens y citas. |
| `lifecode_rag_get` | Recupera una fuente completa y sus fragmentos. |
| `lifecode_rag_list` | Lista fuentes con filtros y paginación. |
| `lifecode_rag_forget` | Elimina una fuente; siempre con aprobación. |
| `lifecode_rag_reindex` | Reconstruye FTS, vectores o ambos; siempre con aprobación. |

## Cuándo usar cada una

Para responder una pregunta con conocimiento del proyecto: `search` primero; si hace falta más
contexto, `context` con un presupuesto razonable. Para auditar qué hay indexado, `list` o `get`.
Para mantener el índice al día, `ingest` con `force` sólo cuando el contenido cambió fuera del
digest.

## Qué no hacen

No inventan conocimiento: si no hay resultados, lo dicen. No llaman a proveedores externos sin
aprobación. No exponen rutas internas del almacén ni credenciales. No aprueban nada por sí mismas.
