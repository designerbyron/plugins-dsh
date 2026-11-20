# Pruebas de lectura sobre datos reales

Ejecutadas sobre una **copia** del almacén del proyecto (`…/cache/scratch/lcr-host-snapshot`), con conexión
`readOnly: true` y las funciones de producción que sólo leen: `ftsSearch`, `getSource`, `assembleContext`.
Nada de esto escribe métricas ni auditoría, a diferencia de la herramienta `search`, que sí registra.

## Prueba A — Inventario

| Dato | Valor |
|---|---|
| Fuentes | **121** |
| Fragmentos | **964** |
| Vectores | **964** |
| Colecciones | `default` (121) |
| Tipos | `text/plain` 92 · `text/markdown` 26 · `text/html` 1 · `application/yaml` 1 · `application/json` 1 |
| Indexadas entre | `1795040340334` y `1795042888870` |
| `index_revision` | 133 |

Ejemplos reales del inventario (metadatos, sin contenido):

- `docs/PROJECT-AWARE-ARCHITECTURE.md` → `src_c3f912136c2f1107`, 37 656 B, `text/markdown`
- `docs/PROJECT-AWARE-SESSION-CONTRACT.md` → `src_46fdaaf8229a2e0e`
- `tests/roots-structure.test.mjs` → `src_fee873de0e1e4c53`

## Prueba B — Búsqueda léxica

Consulta: `proyecto` · resultado: **5 aciertos** (límite 5), ordenados por BM25.

| # | Fuente | Sección | BM25 | Fragmento |
|---|---|---|---|---|
| 1 | `docs/PROJECT-AWARE-ARCHITECTURE.md` | «16. Estado de implementación (PA1 + PA2 + PA3)» | −2,905 | «… de las raíces del [proyecto] \| `search` \| [proyecto] + bibliotecas concedidas \| no \| agrega por …» |
| 2 | `tests/roots-structure.test.mjs` | — | −2,903 | «… normalizeKey('C:\\datos\\[proyecto]') …» |
| 3 | `docs/PROJECT-AWARE-SESSION-CONTRACT.md` | «3. Resolución del ámbito» | −2,814 | «Si la selección apunta a un [proyecto] cuyo estado ya no es …» |

Los tres fragmentos citan literalmente el término consultado en documentos que existen en el repositorio: la
coincidencia está respaldada por el contenido, no inferida.

**Modo de recuperación:** léxico (FTS5). La búsqueda híbrida de producción añade la rama vectorial y **escribe
métricas diarias**: `lib/scope-ops.mjs` pasa `record: scope.kind === 'prj'` y `recordMetrics` escribe en la
misma transacción. Por la prohibición de modificar SQLite se usó sólo la rama léxica, que es la que decide los
aciertos exactos.

## Prueba C — Contexto con citas

`assembleContext` sobre los aciertos anteriores, presupuesto 1 200 tokens:

| Dato | Valor |
|---|---|
| Citas | **1** (deduplicada por fuente) |
| Tokens | 289 |
| Truncado | no |
| Fuente citada | `docs/PROJECT-AWARE-ARCHITECTURE.md` |

La cita corresponde a un fragmento real del documento y su texto reconstruido mide 288 tokens estimados: sin
truncamiento inesperado.

## Prueba D — Recuperación de una fuente

`getSource('src_c3f912136c2f1107')` + consulta de sus fragmentos en la copia:

| Dato | Valor |
|---|---|
| URI | `docs/PROJECT-AWARE-ARCHITECTURE.md` |
| Título | «Arquitectura Project-Aware RAG — PA0» |
| MIME / bytes | `text/markdown` / 37 656 |
| Fragmentos | **37** |
| Primer fragmento | «# Arquitectura Project-Aware RAG — PA0 … **Estado:** especificación cerrada de PA0…» (1 108 B) |
| Segundo | «1. Decisiones que fija esta arquitectura» (952 B) |
| Tercero | «2. Modelo» (1 186 B) |

El contenido recuperado coincide con el documento del repositorio; no se ha copiado el documento completo a la
evidencia, sólo encabezados y un inicio acotado.

## Qué no se ejecutó

`ingest`, `forget`, `reindex`, `select`, `sync`, ni `/doctor` con reparación. Ninguna escritura. El detalle de la
integridad, en `INTEGRITY-VERIFICATION.md`.
