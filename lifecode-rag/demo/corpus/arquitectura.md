# Arquitectura de LifeCode RAG v0.2

LifeCode RAG es un plugin independiente de DeepSeek Harness. Su conocimiento vive en un almacén
SQLite propio, bajo `$DSH_HOME/lifecode-rag`, y no comparte rutas, bases de datos ni código con
LifeCode Skill Center.

## Capas

El producto se organiza en cinco capas explícitas:

1. **Ingesta** (`lib/ingest.mjs`, `lib/extract.mjs`): lee ficheros de texto, valida rutas, extrae
   texto normalizado y calcula el digest de contenido. Nada se escribe hasta que el documento
   completo — texto, chunks y vectores — está preparado en memoria.
2. **Procesamiento** (`lib/chunk.mjs`): divide el texto en fragmentos con solapamiento, conserva
   posiciones de carácter, encabezado y una estimación de tokens.
3. **Indexación** (`lib/schema.mjs`, `lib/db.mjs`): una transacción `BEGIN IMMEDIATE` por fichero
   reemplaza la versión anterior. FTS5 es *external content* sobre `chunks`, con disparadores que
   mantienen el índice alineado; los vectores se guardan como BLOB y caen en cascada con su chunk.
4. **Recuperación** (`lib/search.mjs`): combina BM25 y similitud vectorial con RRF ponderado,
   aplica umbrales y límites por fuente, y devuelve un diagnóstico por consulta.
5. **Ensamblado** (`lib/context.mjs`, `lib/tools.mjs`): selecciona fragmentos con MMR, respeta el
   presupuesto de tokens y entrega citas verificables.

## Fronteras

La capa de API (`lib/server.mjs`) y la pestaña nativa (`client.js`) usan exactamente los mismos
módulos que las siete herramientas del modelo. La interfaz no tiene privilegios adicionales: para
olvidar una fuente o reindexar exige confirmación explícita, igual que la herramienta.

Las decisiones de arquitectura están registradas en `plans/DECISIONS-v0.2.0.md`. Las más
relevantes: la pestaña es nativa (no un WebView), la recuperación es híbrida y configurable, la
telemetría es agregada y la automatización nunca aprueba operaciones sensibles.

## Compatibilidad

El contrato público v0.1 —siete herramientas y sus esquemas— permanece congelado. v0.2 añade
motor asíncrono, métricas, API y automatización sin romper ese contrato.
