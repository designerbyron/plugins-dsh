# Contrato de errores — Project-Aware RAG (PA0)

**Estado:** implementado y verificado en PA1–PA4 (probado local). Actualizado en PA4 con la semántica
**fail-closed** de la revocación durante una operación y con los códigos de raíces, recuperación y
operaciones interrumpidas.
**Regla transversal:** un error de seguridad, permisos o integridad **nunca** se convierte en un resultado
vacío aparentemente exitoso. Si no se puede demostrar que la consulta es válida y está autorizada, se falla
en cerrado con el código correspondiente.

## 1. Familias

| Familia | Qué significa | ¿Reintentable? |
|---|---|---|
| **Selección** | No hay proyecto resoluble o hay ambigüedad | Tras acción humana, sí |
| **Autorización** | El proyecto/ámbito no está permitido | No sin cambio de grants o selección |
| **Integridad** | Un almacén o el registro no son fiables | No; requiere intervención |
| **Infraestructura** | Falta el fichero, el perfil o el acceso | Sí, si se restaura el recurso |
| **Sincronización** | Una raíz no se puede observar de forma completa | Sí, en la siguiente pasada |

## 2. Códigos

| Código | Familia | Cuándo | `details` mínimos | Efecto |
|---|---|---|---|---|
| `scope-unresolved` | Selección | No hay selección y el cwd no coincide con una raíz registrada | `session_id`, `cwd` | Ninguna consulta; no se abre ningún almacén |
| `scope-ambiguous` | Selección | El cwd coincide con más de una raíz registrada | `session_id`, `candidates[]` | No se elige una; se pide selección explícita |
| `scope-conflict` | Selección (UX-2.2) | El workspace **seguido** de la sesión y el `cwd` resuelven **proyectos distintos** | `session_id`, `workspace_path`, `workspace_project_id`, `cwd`, `cwd_project_id` | No se elige, no se combinan ni se amplían ámbitos; no se abre ningún almacén |
| `scope-forbidden` | Autorización | Proyecto archivado, selección revocada o ámbito no permitido | `session_id`, `project_id?`, `reason` | No se abre el almacén |
| `scope-too-many` | Autorización | Tras verificar grants, hay más de 8 ámbitos | `project_id`, `libraries[]`, `limit: 8` | No se trunca ni se ignora ninguna; no se abre ninguna biblioteca |
| `path-excluded` | Autorización | Ruta dentro de una exclusión (Skill Center, almacén propio, `.git`, etc.) | `path`, `reason` | Se rechaza la operación completa |
| `hardlink-refused` | Autorización | Fichero con más de un enlace duro | `path`, `nlink` | Se rechaza ese fichero; la operación informa |
| `path-escape` | Autorización | symlink/junction/reparse que sale de la raíz | `path`, `target?` | Se rechaza |
| `root-overlap` | Autorización | Raíz solapada (padre/hijo) con otra autorizada del perfil, o duplicada global | `path`, `conflictsWith{scopeKind,scopeId,path,relation}` | No se registra la raíz |
| `root-symlink` | Autorización | La raíz es un enlace, junction o reparse point, o su ruta canónica no coincide con la registrada | `path`, `linkTarget?`, `canonical`, `reason` | No se registra la raíz |
| `root-changed` | Integridad | El destino real de una raíz registrada cambió (sustitución por junction/symlink, reparse del proveedor) | `path`, `expected?`, `actual` | Se falla en cerrado antes de usar la raíz |
| `registry-unavailable` | Infraestructura | No existe el registro del perfil o no se puede abrir | `profile_id`, `path?` | Ninguna operación |
| `registry-corrupt` | Integridad | `integrity_check` falla, `path_key` duplicado, cadena de auditoría rota | `profile_id`, `check`, `detail` | No se escribe; se informa |
| `scope-store-unavailable` | Infraestructura | Falta el `rag.sqlite3` de un ámbito, está ocupado por otra conexión o sigue migrando | `scope_id`, `scope_kind`, `reason`, `state`, `retryable` | Falla la operación completa: no se entrega un subconjunto que parezca exhaustivo |
| `scope-store-corrupt` | Integridad | Metadatos incoherentes, `schema_version` futura, `store_state` no `ready`, `integrity_check` o `foreign_key_check` fallan | `scope_id`, `scope_kind`, `check`, `findings?` | No se lee ni se entrega contenido; no se repara solo |
| `recovery-verification-failed` | Integridad | Una recuperación no pudo verificar recuentos, hashes, FTS5, vectores o auditoría | `scope_id`, `stage`, `check`, `detail` | El almacén en cuarentena queda intacto; no se sustituye |
| `operation-uncertain` | Integridad | Una operación destructiva quedó `started` (resultado desconocido) o se intenta confirmar con pasos sin completar | `operationId`, `kind`, `operations[]`/`steps[]` | No se repite el efecto; exige reconciliación explícita |
| `session-invalid` | Selección | `Session.id` ausente o no válido | `session_id?` | No se resuelve |
| `session-expired` | Selección | La sesión terminó y se conserva la fila `expired` | `session_id`, `project_id` | Se exige nueva selección |
| `grant-revoked` | Autorización | El grant estaba vigente al iniciar la operación y se revocó durante ella | `project_id`, `scopes[]`, `reason`, `guarantee` | La operación falla en cerrado: no se entrega ningún resultado de ningún ámbito |
| `sync-root-unavailable` | Sincronización | La raíz no existe, no es accesible o no se puede recorrer por completo | `root_id`, `path`, `code` | No se marca `missing`; se registra `unreadable` |

`session-invalid`, `session-expired`, `registry-*` y `scope-store-*` son códigos nuevos de la etapa
Project-Aware; no existen en v0.1/v0.2 y no se añaden a la superficie pública congelada.

**Distinción de sesión:** `session-invalid` = no hay identidad utilizable, o la identidad fue capturada en
otro perfil (`reason: 'profile-mismatch'`, comprobado por el adaptador antes de abrir el registro);
`session-expired` = la fila existe en estado `expired`; una selección `invalidated`
(proyecto archivado, grant/raíz revocada, cambio de perfil, clonación) se informa como `scope-forbidden` con
`reason`, nunca como `session-invalid`. Un `session_id` sin fila y sin atadura de perfil es indistinguible de
una sesión nueva: no es inválido; resuelve por `cwd` o falla `scope-unresolved`. No se reutiliza una fila
`expired`/`invalidated`: se exige una selección nueva.

**Revocación durante una operación (semántica única, PA4):** la autorización se fija al inicio como
**instantánea**, y cada ámbito se revalida antes de abrirse y antes de devolver nada. Si un ámbito pierde la
autorización durante la operación —grant revocado, sesión expirada o invalidada, proyecto archivado,
selección cambiada— la operación **falla en cerrado** con `grant-revoked`, `session-expired` o
`scope-forbidden` y **no entrega ningún resultado**, ni siquiera el parcial de los ámbitos que sí seguían
autorizados. Motivo: el sobre público de v0.1 (`search`→`{results, mode, elapsedMs}`) no tiene campo donde
declarar `partial`, y devolver un subconjunto sin declararlo lo haría pasar por exhaustivo (§3, prohibición 3
de §4). El ámbito afectado y la garantía aplicada viajan en `details.scopes` y `details.guarantee`.

Un almacén que se abre con `create: true` porque el proyecto aún no existía es la única creación automática:
la ausencia de una **biblioteca** nunca se convierte en una biblioteca vacía ni en creación silenciosa; se
informa `scope-store-unavailable` con `state: 'missing'` y `retryable: false`.

## 3. Clasificación de resultado y visibilidad

- **Fallo total:** error propagado; sin resultados parciales. Es el único desenlace posible en v0.1 cuando
  un ámbito autorizado no se puede consultar o pierde la autorización a mitad.
- **Fallo parcial:** no existe en el sobre público de v0.1. `search` devuelve exactamente
  `{results, mode, elapsedMs}`; `context` devuelve `{text, citations, tokens, truncated, considered}`. No hay
  campo `partial`/`errors` y PA4 **no lo añade**. Internamente el orquestador sigue acumulando el error de
  cada ámbito para auditoría y diagnóstico, pero la operación no devuelve resultados cuando uno falla.
- **Denegación:** `scope-forbidden`, `path-excluded`, `grant-revoked`; se audita como `denied`.
- **Estado observado, no error:** que una fuente o una raíz esté `missing` es un estado, no un error de la
  operación. La ausencia de un **almacén de biblioteca** sí es un error de operación (§2).
- **Propuesta para v0.3 (no implementada, no autorizada):** añadir al sobre de `search` un campo
  `partial: {scopes[], errors[]}` y convertir el fallo total en fallo parcial declarado. Requiere evolución
  del contrato público congelado; queda documentada en `eval/pa4/PA4-DECISIONS.md` (D-PA4-F-01).

## 4. Prohibiciones explícitas

1. Convertir `scope-*` en lista vacía.
2. Devolver resultados de otro proyecto como "recuperación parcial".
3. Truncar bibliotecas hasta 8 sin decirlo.
4. Reintentar con un proyecto distinto cuando el seleccionado falla.
5. Reparar automáticamente un registro o almacén corrupto.
6. Tratar una lectura fallida como fuente desaparecida (`missing` solo con observación completa).

## 5. Correspondencia futura (no implementada)

- En la API v0.3, cada familia tendrá un estado HTTP estable (`400` selección, `403` autorización,
  `409`/`422` integridad, `503` infraestructura); se definirá en el contrato de API.
- En las herramientas, el error llegará como fallo con `code` en `details`, sin cambiar el sobre actual de
  v0.1 (que no se toca).
- La UI mostrará el código y un texto humano; nunca un "sin resultados" cuando hubo un error.

## 6. Verificación ejecutada (PA2–PA4)

- Prueba por código: se fuerza la condición y se comprueba `code`, `details` y que no se abrió ningún almacén
  cuando el error es de selección/autorización.
- Prueba de cierre en falso: una biblioteca corrupta, ausente o revocada a mitad hace fallar `search`,
  `context` y `get` sin devolver los resultados del proyecto como si fueran la respuesta completa
  (`lifecode-rag/tests/partial-results.test.mjs`, `lifecode-rag/tests/revocation.test.mjs`).
- Prueba de no borrado: detectar `missing` no reduce `sources`/`chunks`/`vectors`/auditoría; la recuperación
  conserva el original en cuarentena y valida antes de sustituir
  (`lifecode-rag/tests/recovery.test.mjs`).
- Prueba de operación incierta: una fila `started` bloquea con `operation-uncertain` y la reconciliación sólo
  cierra la fila (`lifecode-rag/tests/partial-results.test.mjs`).
