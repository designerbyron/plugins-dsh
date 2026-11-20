# Aceptación de las siete herramientas

**Método:** mundo PA aislado (`tests/pa3-helpers.mjs` → `makeWorld`), sin tocar `~/.dsh`. Cada llamada pasa
por la definición real de la herramienta (`createToolDefinitions`) con la identidad de sesión que entrega el
host. Registro completo en `smoke-tools.log`.

## Resultado del humo (13 pasos)

| # | Paso | Resultado observado | Veredicto |
|---|---|---|---|
| 1 | `list` | `{total:1, rows:[a.md]}` | PASS |
| 2 | `search` «alfa» | 1 resultado con `uri` y `snippet` | PASS |
| 3 | `context` | `text`, 1 cita, 15 tokens | PASS |
| 4 | `get` por id | fuente + 1 fragmento | PASS |
| 5 | `get` inexistente | `source-not-found` | PASS (fallo cerrado) |
| 6 | `search` con «   » | `invalid-argument` | PASS (no inventa resultados) |
| 7 | `ingest` de un fichero | 1 ingerida, 1 fragmento, 0 errores | PASS |
| 8 | `ingest` duplicado | 0 ingeridas, 1 omitida con `{id, uri, chunks, title}` | PASS (no duplica) |
| 9 | `reindex` `fts` | `{operation, rebuiltChunks}` | PASS |
| 10 | `forget` | `{forgotten, sourceId, uri}`; la fuente borrada **no** vuelve a aparecer | PASS |
| 11 | sesión B pide id de A | `source-not-found` | PASS (aislamiento) |
| 12 | `list` de B | sólo `proyecto-b/b.md` | PASS (aislamiento) |
| 13 | sesión invalidada | `scope-forbidden` | PASS (autorización revalidada en la herramienta) |

## Sonda de borrado (qué queda tras `forget`)

Antes: `sources=1`, `chunks=1`, `chunks_fts=1`. Después: **`sources=0`, `chunks=0`, `chunks_fts=0`**.
El borrado arrastra fragmentos e índice léxico; la búsqueda posterior no devuelve la fuente eliminada.

## Comportamiento observado que conviene documentar

- `search` es híbrida: una consulta puede devolver fuentes relacionadas por **similitud vectorial** aunque no
  contengan literalmente el término. No es una fuga (cada resultado respeta el ámbito), pero explica
  resultados「anchos」.
- Los nombres de campo de las respuestas no son los que un lector ingenuo supone: `list` devuelve
  `{total, rows}`, `ingest` devuelve `{ingested, skipped, errors, approvedOutside}`, `forget` devuelve
  `{forgotten, sourceId, uri}`, `reindex` sólo devuelve lo reconstruido. Documentado en
  `docs/CONTRATO-v0.1.md`; conviene reflejarlo en el README de uso.
- `ingest` de un fichero ya indexado devuelve `skipped` con `reason: 'unchanged'` (antes el motivo era
  implícito). Si sólo cambian las etiquetas, devuelve `ingested` con `chunks: 0` y `reason: 'tags-updated'`,
  sin re-trocear. Corregido en este acto con su regresión en `tests/ingest.test.mjs`.

## Cobertura por la suite existente

320 pruebas en `tests/` (pa3, pa4, pa5, integration, host-adapter, recovery, hermetic) cubren esquemas,
errores, aislamiento, revocación, aprobaciones, concurrencia optimista y recuperación. El humo añade la
verificación de que las **definiciones registradas** (no sólo las funciones internas) funcionan de extremo a
extremo.
