# Matriz de procedencia de datos

**Acto:** `HERMES-LCRAG-FUNCTIONAL-AUDIT-01` · **Fase:** C · **Fecha:** 2026-11-19
**Pregunta que responde:** ¿de dónde sale cada dato visible y qué le pasa antes de pintarse?

---

## 1. Cadena única

Todo lo que se ve nace de `paFixtures()` y `paBuildSources(121)` en `client.js`, se transforma con funciones
puras (`paReduce`, `paSearchResults`, `paBuildContext`, `paChunks`, `paNum`, `paTime`) y se pinta con
`paRenderView` → `PaPanel`. **No hay ninguna otra fuente**: no hay `fetch`, ni almacén, ni IPC, ni
configuración del host.

| Etapa | Implementación | Persistencia |
|---|---|---|
| Origen | `paFixtures()` (constantes + generador determinista) | ninguna: se reconstruye al montar |
| Estado | `paInitialState()` en `useState` | memoria del componente |
| Mutación | `paReduce(state, action)` puro | sólo en memoria |
| Render | `paRenderView(state, t, dispatch)` | — |
| Reinicio | acción `reset` → `paInitialState()` | borra todo lo simulado |
| Desmontaje | se pierde el estado (no hay almacenamiento) | — |

## 2. Vista por vista

### Proyecto
| Dato visible | Origen | Transformación | Componente | Acción que lo cambia |
|---|---|---|---|---|
| Nombre del proyecto | `session.session.selection.projectName` | — | `paViewProject` → `paKv` | `select-project` |
| Selección / origen / revisión | `selection.state/source/revision` | `source` → etiqueta ES | `paViewProject` | `select-project` (revisión +1) |
| Ámbitos efectivos | `session.scopeCount` | — | `paKv` | — |
| Servicio | `session.service.status` | — | `paKv` | — |
| Candidatos, raíces, actual | `projects[]` | chip si `current` | `paTable` | `select-project` |
| Nota GAP-09 | clave `project.gap09` | — | `<p class="lcr-hint">` | — |

### Bibliotecas
| Dato | Origen | Transformación | Componente |
|---|---|---|---|
| Nombre, permiso, almacén, raíces | `libraries[]` | — | `paTable` |
| Concedido | `grantedAt` (epoch) | `paTime` → ISO `YYYY-MM-DD HH:MM` | `paTable` |
| Nota de sólo lectura y de revocadas | claves `libraries.readonly` / `libraries.gap` | — | `<p>` |

### Fuentes
| Dato | Origen | Transformación |
|---|---|---|
| Total y página | `sources.length`, `sourcePage` | «Mostrando {shown} de {total}», «Página {page} de {pages}» |
| Título, URI, colección, fragmentos | `paBuildSources` | — |
| Bytes | `bytes` | `paNum` (separador de miles) |
| Actualizado | `updatedAt` | `paTime` |
| Filas por página | `PA_PAGE_LIMIT = 50` | `slice(offset, offset+limit)` |

### Detalle
| Dato | Origen | Transformación |
|---|---|---|
| Metadatos | fila de `sources` | `paKv` |
| Fragmentos | `paChunks(source)` | texto sintético + offsets `ordinal*1200..+1100` |
| «Se muestran N de M» | `chunks.slice(0,8)` vs `source.chunks` | — |

### Búsqueda
| Dato | Origen | Transformación |
|---|---|---|
| Resultados | `paSearchResults` sobre `sources` + una fila de biblioteca | filtro por subcadena en título/URI/colección; `rrf = 0.031 - 0.001·n` |
| Procedencia | `scopeId/scopeKind/scopeName` fijos por fila | chip «nombre · kind» |
| Modo y duración | constantes del generador | `hybrid`, `8 + (len % 11)` ms |
| Límite | `state.limit` (8/20/50) | `slice(0, limit)` |

### Contexto
| Dato | Origen | Transformación |
|---|---|---|
| Texto | primeros 3 resultados | líneas `[n] título — heading` + snippet |
| Citas | mismos 3 | 9 campos; `charStart=0`, `charEnd=snippet.length` |
| Tokens | texto | `ceil(caracteres/4)` |
| Truncado | constante | `false` |

### Operaciones
| Dato | Origen | Transformación |
|---|---|---|
| URI a ingerir | `PA_INGEST_PATHS` | desplegable |
| Éxito/error | `ingest` según extensión | aviso + `lastError` |
| Fuentes afectadas | `sources.length` | número |
| Registro | `journal[]` | `op-k1fx-00N`, hora `PA_BASE_AT + 60 s·n` |

### Diagnóstico
| Dato | Origen | Transformación |
|---|---|---|
| Registro / almacenes / cabeza | `diagnostics.integrity` | — |
| Ámbitos y `verified` | `diagnostics.scopes` | `verified ? t('common.yes') : 'no'` (**clave ausente: FA-01**) |
| Versiones | `diagnostics.versions` | constantes del fixture |

### Conexión
| Dato | Origen | Transformación |
|---|---|---|
| Servicio, registro | `health` | — |
| Raíz de almacenes | `session.service.storeRoot` | — |
| API Project-Aware | constante de presentación | «no montada» |
| API heredada | `health.legacy` | `false` → `no` |
| Modo | `DATA_MODE` | `fixture` |

### Historial
| Dato | Origen |
|---|---|
| Estado no disponible y causa | claves `history.*` (texto fijo) |

## 3. Inconsistencias encontradas

| # | Inconsistencia | Comprobación | Severidad |
|---|---|---|---|
| C-1 | El título de una fuente no concuerda con su colección («Guía de operación» en `normativa`) | dos módulos distintos (`PA_DOC_NAMES` 8 elementos, `PA_COLLECTIONS` 3) sobre el mismo índice | **FA-09** (P4) |
| C-2 | Diagnóstico muestra `common.yes` en la columna `verified` | clave ausente en `PA_DICT`; visible en la captura | **FA-01** (P3) |
| C-3 | Cabeceras de tabla con `common.detail` | clave ausente; se ve en cuanto haya resultados u operaciones | **FA-02** (P3) |
| C-4 | La versión del anfitrión que muestra Diagnóstico es un **dato del fixture**, no una lectura del host | `versions.host = '0.2.2-rc.5'`; coincide con el host real por casualidad mantenida | observación O-02 |
| C-5 | ¿Proyecto activo en una vista y no disponible en otra? | el proyecto activo aparece igual en Proyecto y en el diagnóstico (mismo `projectId`) | sin inconsistencia |
| C-6 | ¿Biblioteca presente en una vista y ausente en otra? | `lib_k1fx_02` es `missing` en Bibliotecas, en Proyecto y en Diagnóstico | coherente |
| C-7 | ¿Conteos distintos entre Diagnóstico y Fuentes? | Diagnóstico no muestra conteo de fuentes; Operaciones sí (121) y coincide | sin inconsistencia |
| C-8 | ¿Operación con éxito sin entrada en el registro? | cada acción escribe su entrada en el mismo reducer | sin inconsistencia |
| C-9 | ¿Acción simulada que persiste tras reiniciar datos? | `reset` reconstruye el estado; el journal vuelve a vacío | coherente |
| C-10 | ¿API mostrada como conectada sin estarlo? | Conexión dice `no montada` y `fixture`; banner en las 9 capturas | sin inconsistencia |
| C-11 | Banner de datos sintéticos en todas las pantallas | presente en las 9 capturas del RAG | coherente |
| C-12 | `Servicio degraded` en Proyecto y en Conexión | mismo campo `health.status` | coherente |

## 4. Persistencia

No hay ninguna. Todo vive en el estado del componente: al desmontar el panel se pierde, y al pulsar
«Reiniciar datos sintéticos» vuelve al fixture original. Eso es coherente con el modo sintético y con el
hecho de que la UI no escribe en el RAG.
