# Contrato de herramientas — LifeCode RAG v0.1.0

**Estado:** CONGELADO el 2026-11-17. Este documento fija la superficie pública de la versión 0.1.0:
siete herramientas `lifecode_rag_*`, sus entradas, salidas, permisos, límites y errores. Cambiar
cualquiera de esos puntos exige una versión nueva y su propia matriz de aceptación; no se amplía el
alcance por acumulación.

Base verificable: `node --test` (66/66), `node tools/check.mjs` (estructura, cero dependencias, cero
red) y `node tools/hermetic.mjs` (la suite no toca el almacén real). La matriz de aceptación
AC1–AC29 y sus estados viven en [`ACEPTACION-v0.1.md`](ACEPTACION-v0.1.md).

## Reglas comunes

- **Sólo herramientas, sin UI y sin sección de system prompt.** La superficie pública son las siete
  herramientas; el plugin no registra paneles, rutas web ni texto de sistema.
- **Cero dependencias.** `package.json` no declara dependencias, peerDependencies ni optionalDependencies,
  y ningún fuente importa `@deepseek-ai/*`.
- **Cero red.** Ningún módulo usa `fetch`, `node:http(s)`, `node:net` ni `node:dns`; el comprobador
  `tools/check.mjs` lo verifica y falla si aparece.
- **Almacén propio.** SQLite en `$DSH_HOME/lifecode-rag/rag.sqlite3` (o `LIFECODE_RAG_ROOT`); nunca
  lee ni escribe el almacén del Skill Center.
- **Fallo en cerrado.** Una aprobación denegada, ausente o no disponible, una ruta protegida, un
  enlace duro, un enlace simbólico o un índice inconsistente producen error; nunca una escritura
  parcial ni una respuesta "vacía pero correcta".
- **Resultado de herramienta.** El valor devuelto es un objeto JSON serializable; el adaptador lo
  renderiza como un bloque de texto legible con la misma información. Un fallo llega como
  `{ isError: true, error: { message, info? } }` y el mensaje empieza por el código estable
  (`path-denied: …`), para que el modelo y las pruebas puedan distinguir la causa.

### Códigos de error estables

Fuente única de verdad: `RAG_CODES` en `lib/errors.mjs` declara **25** códigos. De ellos, **20** se emiten
hoy, **5** están reservados (declarados y sin emisión) y **3** se emiten sin estar declarados: una deuda
interna registrada, no un cambio de contrato. En total, el código emite **23** códigos distintos.

**Emitidos (23)**

`invalid-argument`, `invalid-config`, `invalid-tag`, `store-not-initialized`, `store-not-rag`,
`store-version-unsupported`, `store-corrupt`, `fts-integrity`, `source-not-found`, `source-unreadable`,
`path-denied`, `path-not-allowed`, `path-unsupported`, `path-escape`, `hardlink-refused`, `too-large`,
`too-many-files`, `binary-file`, `approval-required`, `approval-unavailable`, `vector-index-incomplete`,
`cancelled`, `internal`.

**Reservados, sin emisión (5)**

`store-busy` (el almacén espera con `busy_timeout` en vez de fallar), `path-outside-root` y
`path-protected` (sustituidos en la práctica por `path-not-allowed` y `path-denied`),
`egress-denied` y `embedding-failed` (no hay proveedor remoto en v0.1.0).

**Deuda registrada:** `path-escape`, `hardlink-refused` y `vector-index-incomplete` se lanzan desde
`lib/policy.mjs` y `lib/maintenance.mjs` pero no figuran en `RAG_CODES`. El contrato los documenta porque
el código los emite; alinearlos en la constante exige tocar código y queda para la siguiente versión
(no se hace en una reconciliación documental).

`codigo: detalle` es el formato del mensaje; los detalles no son contrato y pueden precisarse.

### Límites por defecto

| Límite | Valor | Dónde se cambia |
|---|---|---|
| Tamaño máximo por fichero | 2 000 000 bytes | `config.json` → `maxFileBytes` |
| Ficheros por llamada de ingesta | 200 | `maxFilesPerIngest` |
| Chunk objetivo / máximo / solape | 1200 / 2000 / 120 caracteres | `chunk.*` |
| Resultados de búsqueda | 8 (máximo 50) | `search.limit`, `search.maxLimit` |
| Presupuesto de contexto | 2000 tokens estimados | `context.budgetTokens` |
| Chunks por contexto | 12 | `context.maxChunks` |
| Diversidad MMR | 0.7 | `context.mmrLambda` |
| Embedder local | `local-hash-v1`, 256 dimensiones | `embedding.provider`, `embedding.dim` |

Los tokens son una **estimación** (`ceil(caracteres / 4)`), no un conteo del tokenizador del modelo;
la matriz lo declara como límite conocido (AC20, PARTIAL).

## Herramientas

### `lifecode_rag_ingest`

Indexa ficheros o directorios de texto del proyecto. Acepta rutas relativas al directorio de la
sesión o absolutas.

| Parámetro | Tipo | Obligatorio | Significado |
|---|---|---|---|
| `paths` | string \| string[] | sí | Ficheros o directorios a indexar |
| `collection` | string | no | Agrupa fuentes para filtrar después |
| `tags` | string[] | no | Etiquetas normalizadas (máx. 20) |
| `force` | boolean | no | Reindexa aunque el contenido no haya cambiado |

- Recorre directorios omitiendo `.git`, `node_modules`, `.dsh`, `dist`, `build`, `coverage`, enlaces
  simbólicos y junctions.
- Clasifica **todas** las rutas antes de abrir el almacén: si una sola está protegida, la llamada
  entera falla sin escribir nada.
- Fuera del proyecto (y de las raíces permitidas) exige aprobación humana con la lista exacta.
- Formatos: `md`, `txt`, `html`, `json`, `jsonl`, `csv`, `tsv`, `yaml`, `xml`, `logs` y código.
- Devuelve `{ ingested, skipped, errors, approvedOutside }`; `skipped` son fuentes cuyo contenido no
  cambió (mismo `sha256` y sin `force`), no un fallo.
- Reingerir el mismo contenido con etiquetas distintas actualiza sólo las etiquetas y **no** sube
  `index_revision` (auditoría `ingest.tags`).

### `lifecode_rag_search`

Búsqueda híbrida: FTS5 léxica + similitud de vectores, fusionadas con Reciprocal Rank Fusion (k=60).
Devuelve fragmentos compactos; el texto completo se pide con `lifecode_rag_get`.

| Parámetro | Tipo | Obligatorio | Significado |
|---|---|---|---|
| `query` | string | sí | Consulta en lenguaje natural |
| `limit` | number | no | Resultados (1–50; por defecto 8) |
| `collection` | string | no | Filtra por colección |
| `tags` | string[] | no | Filtra por etiquetas |
| `tagMode` | `any` \| `all` | no | Cualquiera (por defecto) o todas |

- Devuelve `{ results, mode, elapsedMs }` con `results[] = { chunkKey, sourceId, uri, title, heading,
  ordinal, rrf, snippet }`. `mode` indica `hybrid` o `fts`.
- Nunca devuelve el texto completo del chunk: sólo un `snippet` de hasta 240 caracteres.
- La recuperación es léxica de base; `local-hash-v1` **no** es un modelo semántico y el contrato no
  promete paráfrasis. La medición está en [`BENCHMARK-2026-11-17.md`](BENCHMARK-2026-11-17.md).

### `lifecode_rag_context`

Ensambla contexto listo para el modelo con diversificación MMR y citas numeradas verificables.

| Parámetro | Tipo | Obligatorio | Significado |
|---|---|---|---|
| `query` | string | sí | Consulta |
| `budgetTokens` | number | no | Presupuesto estimado (por defecto 2000) |
| `maxChunks` | number | no | Fragmentos máximos (por defecto 12) |
| `collection` | string | no | Filtra por colección |
| `tags` | string[] | no | Filtra por etiquetas |

- Devuelve `{ text, citations, tokens, truncated, considered }`.
- `citations[] = { n, chunkKey, sourceId, uri, title, heading, ordinal, charStart, charEnd }`.
- Si el primer fragmento no cabe en el presupuesto, devuelve `text` vacío y `truncated: true`; no
  corta un chunk a la mitad ni presenta un contexto incompleto como completo.

### `lifecode_rag_get`

Lee una fuente indexada y sus fragmentos completos, para verificar una cita.

| Parámetro | Tipo | Obligatorio | Significado |
|---|---|---|---|
| `ref` | string | sí | `sourceId` (`src_…`) o URI indexada |
| `limit` | number | no | Fragmentos a devolver |

Devuelve la fuente normalizada (título, uri, colección, etiquetas, hash, fechas, `index_revision`) y
sus chunks en orden. `source-not-found` si la referencia no existe.

### `lifecode_rag_list`

Lista fuentes con filtros y paginación.

| Parámetro | Tipo | Obligatorio | Significado |
|---|---|---|---|
| `collection` | string | no | Filtra por colección |
| `tag` | string | no | Filtra por etiqueta |
| `limit` | number | no | Tamaño de página |
| `offset` | number | no | Desplazamiento |

Devuelve `{ total, rows }` con una fila por fuente y su número de chunks.

### `lifecode_rag_forget`

Elimina una fuente y todo lo indexado de ella (chunks, vectores, etiquetas, FTS por cascada).

| Parámetro | Tipo | Obligatorio | Significado |
|---|---|---|---|
| `ref` | string | sí | `sourceId` o URI |

- **Siempre** exige aprobación humana; el motivo incluye el `sourceId` y la URI exactos.
- Si la aprobación falta, se deniega o no hay respondiente: `approval-required` /
  `approval-unavailable`, sin borrar nada.
- Devuelve `{ forgotten: true, sourceId, uri }`.

### `lifecode_rag_reindex`

Reconstruye el índice de texto, los vectores o ambos.

| Parámetro | Tipo | Obligatorio | Significado |
|---|---|---|---|
| `operation` | `fts` \| `vectors` \| `all` | sí | Qué reconstruir |

- **Siempre** exige aprobación humana. `all` ejecuta primero FTS y después vectores.
- `fts` es una transacción global: `rebuild`, verificación de integridad, subida de
  `index_revision` y asiento de auditoría, todo o nada.
- `vectors` va por fuente, con transacción propia, y comprueba entre fuentes si la operación fue
  cancelada (`cancelled`). Al terminar exige que cada chunk tenga su vector
  (`vector-index-incomplete` si falta alguno).
- Devuelve `{ operation, rebuiltChunks?, rebuiltSources? }`.

## Fuera del contrato v0.1.0

No forman parte de esta versión y no deben anunciarse como disponibles: ingesta de PDF/DOCX,
embeddings neuronales, egress remoto, UI/panel, sección de system prompt, búsqueda por `minScore`,
 formato de contexto alternativo, `list` por tipo de fuente, `forget` por lote, historial de
versiones de un documento y exportación/importación del almacén. La tabla de desviaciones completa
está en [`ACEPTACION-v0.1.md`](ACEPTACION-v0.1.md), sección «Desviaciones del contrato de herramientas
(§16 de v2)».
