# Catálogo de herramientas

## 1 · Definiciones registradas por el plugin (7/7)

Obtenidas ejecutando `createToolDefinitions` con la configuración por defecto. Todas tienen `output.schema`.

| Herramienta | Parámetros | Obligatorio |
|---|---|---|
| `lifecode_rag_ingest` | `paths`, `collection`, `tags`, `force` | `paths` |
| `lifecode_rag_search` | `query`, `limit`, `collection`, `tags`, `tagMode` | `query` |
| `lifecode_rag_context` | `query`, `budgetTokens`, `maxChunks`, `collection`, `tags` | `query` |
| `lifecode_rag_get` | `ref`, `limit` | `ref` |
| `lifecode_rag_list` | `collection`, `tag`, `limit`, `offset` | — |
| `lifecode_rag_forget` | `ref` | `ref` |
| `lifecode_rag_reindex` | `operation` (`fts`/`vectors`/`all`) | `operation` |

## 2 · Registro en el plugin

`index.js`: `export const inject = ['tools']` y `ctx.tools.register(definition)` por cada definición. El
registro es **global** al proceso: cualquier agente del host que reciba el catálogo de herramientas del plugin
vería las siete.

## 3 · Carga en el host

- Plugin instalado por enlace en el perfil `desktop` (`package.json` → `exports["./client"]` presente).
- El panel se montó y fue visible en capturas del propietario (2026-11-19, 11:54-11:57): el host **carga** el
  plugin.
- El servidor del plugin registra las herramientas al activarse; no hay evidencia en contra.

## 4 · Catálogo efectivo del modelo

**`NOT TESTED`.** No hay superficie documentada para consultar, desde fuera del proceso, qué herramientas
recibe el modelo en una sesión concreta. Lo que se descartó:

| Vía intentada | Resultado |
|---|---|
| API del host | no existe comando de inspección de catálogo |
| Logs de sesión (`~/.dsh/sessions`) | 35 sesiones, ficheros `session.v4.jsonl.zstd` comprimidos; `grep` no lee el contenido |
| Auditoría del almacén | prueba **uso** de herramientas (`lifecode_rag_ingest` ×133), no el catálogo |

Conclusión: la disponibilidad para el modelo se confirma o se refuta **en el chat**, no desde el sistema de
ficheros.
