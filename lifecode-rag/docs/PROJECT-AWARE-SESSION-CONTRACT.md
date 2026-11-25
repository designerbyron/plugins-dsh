# Contrato de sesión y selección de proyecto (PA0)

**Estado:** **implementado** en `1.3.0` (`lib/sessions.mjs`, `lib/resolve.mjs`). Cabecera corregida el 2026-11-23:
decía «especificación. No implementado» cuando el contrato ya estaba en producción (contradicción C2 de
`ESTADO-IMPLEMENTACION.md`).
**Decisiones incorporadas:** O-PAR-2 (selección por sesión), O-PAR-3 (bibliotecas anidadas prohibidas),
O-PAR-4 (registro por perfil), C8 (ciclo de vida de sesión), `D-UX22-05` (la selección de **perfil** `pa_selection`
es **de vista** del panel y no participa en la resolución de las herramientas).
**Pendiente, no implementado:** el escalón de **seguimiento** por workspace en la resolución (UX-2.2) — ver
[`UX-22-TRACKING-SPEC.md`](UX-22-TRACKING-SPEC.md). Su precedencia ya está **decidida** (`D-UX22-12 = A`):
`session_scope` explícita → workspace seguido **de la sesión actual** → `cwd` ∩ raíces → frontera de workspace → no
resuelto; `scope-conflict` **sólo** para el conflicto seguido-vs-`cwd`; `pa_selection` **no** participa.

## 1. Identidad de sesión

- La identidad la crea el **host**: `Session.id` (el mismo que usa DeepSeek Harness). LifeCode RAG no
  inventa identificadores ni usa nombres de conversación.
- `session_id` es opaco para el plugin: se compara, no se interpreta.
- Sin `Session.id` disponible → `session-invalid` (no se degrada a "sin proyecto").
- Une sesión a un proyecto mediante `session_scope(session_id PRIMARY KEY, project_id, …)`.
- Un `session_id` reutilizado con otro proyecto exige una fila nueva o una actualización explícita con
  `revision` incrementada; nunca se reutiliza una selección vieja en silencio.
- **Implementación PA2:** el adaptador `lib/session-identity.mjs` captura `agent.id` y la clave del perfil
  activo en ese momento. Una identidad capturada en otro perfil se rechaza con `session-invalid`
  (`reason: 'profile-mismatch'`) antes de tocar el registro. Un `session_id` sin esa atadura, o que no tiene
  fila, es indistinguible de una sesión nueva: no es un error por sí mismo; resuelve por `cwd` o falla
  `scope-unresolved`.

## 2. Ciclo de vida

| Evento | Comportamiento | Estado resultante |
|---|---|---|
| **Creación de sesión** | No hereda selección. Sin fila → resolución por cwd o `scope-unresolved` | sin selección |
| **Selección explícita** | Acción humana o del host (`selected_by IN ('human','host')`); se guarda `project_id`, `selection_source='explicit'`, `revision+1` | `active` |
| **Persistencia** | La fila vive en el registro del perfil; sobrevive al reinicio del host | `active` |
| **Recuperación tras reinicio** | Se relee por `session_id`; si el proyecto sigue `active` y la sesión no fue invalidada, se restaura | `active` |
| **Duplicación/clonación** | Un clon recibe **otro** `session_id`; no hereda la fila. Copiar una selección requiere una acción explícita y verificable | sin selección |
| **Terminación normal** | Se marca `expired` con `expires_at` (no se borra: se conserva para auditoría); una consulta posterior falla `session-expired` | `expired` |
| **Invalidación** | El host, una persona o una regla de autorización invalidan la selección: `state='invalidated'`, `invalidated_at`, `invalid_reason`; no es una expiración | `invalidated` |
| **Sesión huérfana** | `session_scope` con proyecto archivado o eliminado lógicamente → `invalidated` con motivo | `invalidated` |
| **Proyecto archivado** | Selección vigente pasa a `invalidated` con `project-archived`; se exige reselección | `invalidated` |
| **Selección inválida o revocada** | Proyecto o raíz revocada → `scope-forbidden`; no se cae a otro proyecto | `invalidated` |
| **Dos sesiones concurrentes** | Filas independientes; cambiar una no afecta a la otra; no hay selección global | ambas `active` |

### 2.1 Transiciones permitidas

| Desde | Hacia | Condición | Marca temporal |
|---|---|---|---|
| — (sin fila) | `active` | Selección explícita humana/host | `selected_at`, `updated_at`; `revision=1` |
| `active` | `active` | Reselección explícita | `revision+1`, `updated_at`; `selected_by` requerido |
| `active` | `expired` | Fin normal de sesión o `expires_at` alcanzado | `expires_at` (obligatorio), `updated_at` |
| `active` | `invalidated` | Proyecto archivado, grant/raíz revocada, cambio de perfil, clonación, decisión administrativa | `invalidated_at`, `invalid_reason`, `updated_at` |
| `expired` | `active` | **Prohibida**: una sesión expirada no revive; se selecciona en una sesión nueva | — |
| `invalidated` | `active` | **Prohibida**; la reselección crea/actualiza una fila nueva de sesión, no reabre la invalidada | — |

`expires_at` y `invalidated_at` son excluyentes en la práctica: `expired` exige `expires_at` y prohíbe
`invalidated_at`; `invalidated` exige `invalidated_at` y `invalid_reason`, y no usa `expires_at`. El
`CHECK` del contrato de datos lo impone. `revision` se incrementa en cada escritura; nunca hay una
reselección incremental silenciosa sobre una fila `expired`/`invalidated`.

La selección **nunca** la crea una herramienta del modelo (ni `ingest`, ni `search`, ni `context`). Si una
herramienta necesita proyecto y no lo hay, devuelve error; no elige por su cuenta.

## 3. Resolución del ámbito

Orden normativo, sin atajos:

1. **Selección explícita activa** de la sesión → proyecto de esa fila.
2. Si no hay selección: **cwd de la sesión** (resuelto por el host) contra `roots.path_key` de
   proyectos `active` (`roots.scope_kind='prj'`, `roots.state='authorized'`). Debe coincidir con
   **exactamente una** raíz autorizada.
   - 0 coincidencias → `scope-unresolved`.
   - 2 o más coincidencias (raíces superpuestas o duplicadas) → `scope-ambiguous`.
3. **Nunca** se usa un proyecto "por defecto" global, el último usado, ni el primero del registro.
4. El cwd es un mecanismo de resolución, no una autorización: si la raíz no está registrada y autorizada,
   no vale.
5. Si la selección apunta a un proyecto cuyo estado ya no es `active` → `scope-forbidden`.

### 3.1 Escalón de seguimiento (UX-2.2, `pa/1.5.0`)

Orden normativo completo tras UX-2.2 (`D-UX22-12`), con el escalón nuevo **entre** la selección y el `cwd`:

```
0. identidad y perfil válidos
1. selección explícita ACTIVA de la sesión            (sin cambios; si existe, el seguimiento NO se consulta)
2. workspace SEGUIDO que corresponde a ESTA sesión    (escalón nuevo)
   · sólo con state='on', last_status='ok', project_id != NULL y proyecto activo
   · aporta SÓLO el proyecto; raíces y grants se evalúan igual
   · si el cwd resuelve un proyecto DISTINTO → scope-conflict (409)
   · si aplica y no resuelve → scope-unresolved con reason='tracking-not-resolving' (no se cae al cwd)
3. cwd ∩ raíces autorizadas                            (sin cambios)
4. workspace abierto que contiene el cwd + trusted      (sin cambios)
5. nada → scope-unresolved                              (sin cambios)
```

Reglas duras:

- **Sólo la sesión actual**: el escalón 2 usa el workspace cuya lista `sessionIds` contiene esta sesión; nunca «todos
  los seguidos».
- **`scope-conflict` ≠ `scope-ambiguous`**: el primero es seguido-vs-`cwd`; el segundo son dos proyectos en el mismo
  `cwd`. No se reutilizan.
- **`pa_selection` no participa**: sigue siendo selección visual del panel.
- **Reconciliación del eje B**: la disponibilidad (`ok`/`missing`/`unknown`) se mide al resolver, se escribe sólo en
  `workspace_tracking` y se audita como `tracking.reconcile` con `actor='host'`. `missing` no apaga el seguimiento.


## 4. Reglas de aislamiento

- Una sesión tiene **como máximo un** proyecto activo.
- Dos sesiones pueden estar en proyectos distintos a la vez; ninguna escritura de selección toca la otra.
- El registro es del perfil: una sesión de otro perfil no puede leer este registro, ni siquiera con el mismo
  `session_id` (el perfil forma parte del contrato de resolución; `profile_id` se comprueba al abrir).
- Un `session_id` de otro perfil se trata como inexistente en este; no se "repara" copiando filas.

## 5. Proyecto archivado o eliminado

- Archivar: `projects.status='archived'`, `archived_at`; no borra almacén, raíces, `sync_state` ni auditoría.
- Las sesiones con ese proyecto quedan `invalidated` con `invalid_reason='project-archived'`.
- Consultar con una sesión invalidada → `scope-forbidden`; el mensaje incluye el proyecto y el motivo, sin
  revelar contenido.
- Borrado definitivo de un proyecto es una operación humana con aprobación y copia previa; no ocurre por
  automatización.

## 6. Interacción con herramientas (contrato futuro v0.3)

- Las siete herramientas v0.1 **no cambian** y no aceptan `project_id` ni `scope_id`.
- La resolución ocurre dentro del adaptador, antes de abrir almacenes.
- Para v0.3 se propone una referencia pública `<scope_id>:<source_id>`; su semántica se define en el
  contrato v0.3, no aquí. PA0 no la implementa.
- Si en el futuro existe una acción de selección expuesta al usuario, será una acción de interfaz o del
  host, nunca una herramienta invocable por el modelo sin aprobación.

## 7. Persistencia y límites

- La tabla no crece sin control: las filas `expired`/`invalidated` se conservan N días (propuesta: 90) y
  luego se purgan con auditoría; el proyecto y sus datos no se tocan.
- La selección no se guarda en `localStorage` ni en el cliente: el cliente no es fuente de verdad.
- Si el registro no está disponible: `registry-unavailable`; no se usa una copia en memoria como sustituto
  silencioso.

## 8. Casos que deben probarse en PA2

| Caso | Resultado esperado |
|---|---|
| Sesión A selecciona P1; sesión B selecciona P2 | Cada una ve solo su proyecto; sin interferencia |
| Reinicio del host con sesiones activas | Ambas selecciones se recuperan |
| Clonar una sesión | El clon no hereda selección |
| Sesión termina y vuelve a consultar | `session-expired` |
| Proyecto archivado | `scope-forbidden` con motivo |
| cwd dentro de dos raíces registradas | `scope-ambiguous` |
| cwd fuera de toda raíz | `scope-unresolved` |
| `session_id` de otro perfil | Tratado como inexistente → `scope-unresolved` |
| Sesión expirada que intenta reactivarse | Rechazado; se exige sesión nueva (`session-expired`) |
| Selección revocada mientras corre una consulta | La consulta en curso termina con la instantánea de autorización; la siguiente falla `scope-forbidden` |
| Grant revocado mientras corre una consulta | Ámbitos ya abiertos terminan; los no abiertos se omiten con `grant-revoked`; respuesta `partial:true` |

## 9. Registro de revisión R1.2 — OFF, reactivación y provisión (`pa/1.6.0`, 2026-11-24)

**La escalera de §3 no cambia.** Ni el orden ni la precedencia: selección explícita de sesión → seguimiento
`on` → cwd ∩ raíces → workspace abierto con trust → nada. R1.2 no introduce un modo de resolución nuevo.

| Cambio | Efecto en la resolución |
|---|---|
| El alta provisiona memoria y escribe consentimiento | El escalón de seguimiento pasa a tener `project_id` y raíz/trust reales: una sesión nueva resuelve sin `select --session` |
| OFF (Q07) | El escalón de seguimiento no resuelve (`state` deja de ser `on`) y la fila muestra «Sin seguimiento»; la resolución cae al `cwd` (o a la selección explícita), sin error de permisos. `tracking-not-resolving` se reserva a `paused`/disponibilidad, no a OFF |
| Reactivación (Q10) | Misma fila, mismo `project_id`; se encola una sincronización incremental como operación `kind='sync'` aparte |
| `session_scope` | No se toca: no lo creó el toggle. Una sesión con selección explícita sigue mandando aunque el seguimiento esté OFF |
| `pa_selection` | Sigue sin participar en la resolución; es selección visual del panel |

**Provisionar no crea selección.** El acto escribe consentimiento de la ruta exacta, proyecto de
conocimiento, almacén y asociación; no `session_scope` ni `pa_selection`. La autorización de lectura sigue
siendo independiente: revocarla (Q08) no apaga el seguimiento y apagarlo no la revoca.
