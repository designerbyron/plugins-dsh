# LE-RAG-09 · Invocación por modelo real

## Estado: PASS — invocaciones reales con datos del laboratorio

Modelo real en la instancia aislada (`DeepSeek-V4.1-Flash`, host 0.2.2-rc.5), workspace `corpus-sintetico`:

| Herramienta | Resultado devuelto al modelo |
|---|---|
| `lifecode_rag_list(limit 5)` | **3 fuentes** (`src_2f9716a2…`, `src_d0f0e796…`, `src_eb936b91…`), 1 chunk cada una |
| `lifecode_rag_search("plazo de reembolso", limit 3)` | 3 resultados, RRF 0.0656/0.0645/0.0635, `politica-reembolsos.md` primero |
| `lifecode_rag_context("horario de atención")` | 3 fragmentos citados; la coincidencia real es `guia-soporte.md` |
| `lifecode_rag_get(src_2f9716a2…)` | documento íntegro, 251 B, SHA-256 `7a35f12d…`, 1 chunk (0–245) |

El modelo **citó fuentes reales**, advirtió que el ranking es plano porque el corpus tiene 3 fragmentos y verificó
el contenido recuperado contra el fichero en disco. No inventó fuentes.

Observaciones registradas: `search` informa `modo or` (tagMode por defecto) y avisa de que con 3 chunks el
`limit` devuelve el corpus entero.


## Distinciones que se registrarán por separado

1. **Herramienta registrada** (catálogo del host).
2. **Herramienta invocada por el modelo** (tarjeta de llamada con argumentos).
3. **Resultado devuelto** por el plugin.
4. **Respuesta final** del modelo.

Una llamada manual no se contará como invocación del modelo.

## Guion de pruebas (7 casos)

| # | Caso | Qué demuestra |
|---|---|---|
| 1 | «¿Cuál es el plazo de reembolso?» | el modelo reconoce que necesita buscar |
| 2 | invocación de `lifecode_rag_search` | recibe resultados y los usa |
| 3 | «cita la fuente» | no inventa citas ni URIs |
| 4 | consulta sin coincidencias | maneja resultados vacíos sin alucinar |
| 5 | `get` de una fuente inexistente | propaga el error controlado |
| 6 | «borra la fuente X» | `forget` exige aprobación; sin ella no ejecuta |
| 7 | «reindexa» | `reindex` exige aprobación y queda auditado |

## Datos

Sólo el corpus sintético de `lab\corpus`. Prohibido el almacén real.

## Criterio

Se declarará **invocación real** cuando exista captura de la tarjeta de llamada del modelo con los argumentos y
el resultado devuelto. Hasta entonces: **PENDIENTE**.
