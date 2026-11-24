# UX-2.2 — Especificación técnica del seguimiento persistente

**Estado:** especificación · **decisiones de producto:** `D-UX22-01…06` **APPROVED** (2026-11-23) · **implementación:** NO autorizada
**Base:** `plans/UX-02/UX-02-2.2-AUDIT-2026-11-23/INFORME-UX-2.2.md` · **Producto observado:** `1.3.0`, API `pa/1.4.0`
**Etiquetas:** `HECHO` · `INFERENCIA` · `PROPUESTA` · `PENDIENTE`

> **Aviso de lectura.** Nada de este documento está implementado. `D-UX22-01…06` están **aprobadas**; `D-UX22-07…13`
> y `BLOCKER-01` están **pendientes**. La forma concreta del SQL, de los endpoints y de los códigos nuevos es
> **propuesta**: el propietario declaró expresamente que no debe darse por aprobada (§4.5 del mandato).

---

## 0. Mandato y límites

**Aprobado por el propietario:** seguimiento **por perfil** (`01`) · resolución **sólo para la sesión actual** (`02`) ·
conflicto workspace/`cwd` → **`scope-conflict`**, nunca elección silenciosa (`03`) · workspace **sin proyecto se puede
seguir** pero no resuelve (`04`) · `pa_selection` queda como **selección visual** del panel (`05`) · seguimiento y
autorización **completamente independientes** (`06`).

### 0.1 Decisiones de detalle resueltas (mandato de resolución, 2026-11-23)

Todas con resolución **A**. Son **normativas** para el diseño: lo que sigue en este documento ya no las discute.

| ID | Resolución | Qué fija |
|---|---|---|
| `D-UX22-07` | **A** | Identidad primaria por **`path_key`**; `workspace_id` es alias auxiliar; un cambio de ruta **no** reasocia automáticamente; identidad o ubicación nueva exige **reconciliación explícita** |
| `D-UX22-08` | **A** | **Dos ejes independientes**: seguimiento (`on`/`off`/`paused`) y disponibilidad (`ok`/`missing`/`unknown`). `missing` ≠ `off`; `paused` no resuelve; la disponibilidad **no** cambia la preferencia humana |
| `D-UX22-09` | **A** | Reasociación **explícita y humana**, auditada con asociación anterior, nueva, actor y momento; **no** migra, fusiona ni reasigna conocimiento ya indexado; las fuentes conservan su proyecto de origen |
| `D-UX22-10` | **A** | API humana `GET/PUT/DELETE /pa/tracking`, mutaciones con **CAS**, protegidas por autenticación, autorización y **CSRF**, evolución **`pa/1.5.0`** aditiva; los contratos anteriores no se alteran |
| `D-UX22-11` | **A** | Acciones humanas auditables: **`enable`, `disable`, `pause`, `resume`, `reassociate`**; la reconciliación técnica de disponibilidad se **distingue** de las decisiones humanas y nunca se atribuye al usuario |
| `D-UX22-12` | **A** | Precedencia: `session_scope` → workspace seguido de la sesión → `cwd` ∩ raíces → frontera → no resuelto. La selección explícita **prevalece**; la discrepancia se audita/diagnostica; `scope-conflict` **sólo** para seguido-vs-`cwd`; `pa_selection` **no** participa |
| `D-UX22-13` | **A** (documental) | Opción A **limitada exactamente** a `<REPO_ROOT>`, al proyecto existente «LifeCode RAG»; **condicionada a aprobación humana previa** — ver [`UX-22-ROOT-PROPOSAL.md`](UX-22-ROOT-PROPOSAL.md) |

`D-UX22-13` **no autoriza nada**: es una decisión documental sobre qué se propondría y con qué límites. La operación
de raíz sigue **sin ejecutar** y exige aprobación específica.

**Fuera del alcance de UX-2.2:** modo fácil, seguimiento automático, ingesta o reindexado automáticos, conocimiento
compartido, cambios en el motor de búsqueda, modificación de grants existentes, ampliación automática de permisos,
dependencias entre plugins.

---

## 1. Vocabulario y ejes de estado

`HECHO` — Hoy el registro distingue conceptos que el seguimiento **no** puede reutilizar sin mezclarlos:
`session_scope` (selección de sesión), `pa_selection` (selección de perfil, visual), `roots` (pertenencia física
autorizada), `grants` (proyecto → biblioteca), `sync_state` (presencia por raíz).

**Normativo (`D-UX22-08 = A`)** — **dos ejes independientes** por workspace, con estos valores exactos:

**Eje A · decisión humana (`tracking.state`)**

| Valor | Significado | ¿Resuelve? |
|---|---|---|
| `on` | seguido | sí, si el resto de condiciones se cumple |
| `off` | no seguido (fila conservada como historia) | no |
| `paused` | seguido pero suspendido por la persona | no |

**Eje B · disponibilidad (`tracking.last_status`, medida por el Host)**

| Valor | Significado | ¿Resuelve? |
|---|---|---|
| `ok` | el Host lo listó en la última reconciliación | depende de A |
| `missing` | no está en el disco o no lo lista el Host | **no** (y **no** borra la fila) |
| `unknown` | no se pudo comprobar | **no** (nunca se pinta como «no seguido») |

**Normativo (`D-UX22-08 = A`)** — los dos ejes son **independientes y ninguno deriva del otro**:

- La desaparición temporal de un workspace **no** elimina su preferencia de seguimiento.
- **`missing` ≠ `off`**: `missing` es un hecho técnico; `off` es una decisión humana.
- Un workspace en **`paused`** **no** participa en la resolución automática de contexto.
- La **disponibilidad técnica no cambia** en silencio la preferencia humana: la reconciliación sólo escribe el eje B
  y sólo se registra como acción **del sistema** (`D-UX22-11`).
- Sólo una persona mueve el eje A: `on` → `off` → `on` (reactivación), `on` ⇄ `paused`.

---

## 2. Identidad del workspace y reconciliación — `D-UX22-07 = A` (decidido)

**Normativo:** la identidad persistente del seguimiento es **`path_key`** (ruta canónica normalizada, minúsculas en
win32). El `workspace_id` que entrega el Host es **alias o referencia auxiliar**, nunca identidad persistente. Un
**cambio de ruta no produce reasociación automática**: la fila anterior queda en `missing` y la ruta nueva es un
workspace **distinto** hasta que una persona los reconcilie explícitamente (`D-UX22-09`). La razón de usar `path_key`
y no el id del Host es que el id no es comparable entre versiones ni perfiles, y el Host puede no exponerlo.

Comportamiento por caso (derivado de `D-UX22-07` y `D-UX22-08`):

| Caso | Comportamiento | Efecto en el seguimiento |
|---|---|---|
| **Movimiento** (misma carpeta, otra ruta) | el `path_key` cambia → fila nueva en `missing` la vieja; `workspace_id` igual permite ofrecer «reasociar» | se conserva la vieja en `missing`; **nunca** se borra sola |
| **Renombrado** | idéntico a movimiento | ídem |
| **Cambio de mayúsculas** | normalización a minúsculas → **misma** fila | sin cambio |
| **Ruta inexistente** | `last_status='missing'` | no resuelve; la fila se conserva |
| **Id del Host cambiado** | se reconcilia por `path_key`; se actualiza el alias | sin cambio en la decisión |
| **Rutas duplicadas/ambiguas** (dos workspaces con el mismo `path_key`) | **no** se fusionan en silencio: se marca `ambiguo` y **no** resuelve hasta que la persona decida | requiere acción humana |
| **Anidados** (padre e hijo) | filas independientes. `mostSpecific` gobierna la resolución por **`cwd` ∩ raíces** (escalón 3). En el escalón 2, si la sesión está en dos workspaces seguidos con **proyectos distintos** (incluido padre/hijo), no se elige: `scope-conflict` (`D-UX22-02`) | ambas pueden estar seguidas; no se combinan |

**Normativo (`D-UX22-08` + `D-UX22-11`)** — la reconciliación corre en **lectura** (al listar workspaces) y **no
escribe el eje A**: sólo `last_seen_at` y `last_status`. Es una acción **del sistema**: se audita como
`tracking.reconcile` con `actor='host'` y **nunca** se atribuye a la persona.

---

## 3. Asociación workspace → proyecto — `D-UX22-09 = A` (decidido)

**Normativo:** asociar o **reasociar** un workspace a otro proyecto es una **acción humana explícita**. Se registra
la **asociación anterior**, la **nueva**, el **actor** y el **momento**. La reasociación **no** migra, fusiona ni
reasigna el conocimiento ya indexado: **las fuentes existentes conservan su proyecto de origen** y el historial del
conocimiento no se reescribe. La asociación nueva afecta **sólo a la resolución futura** de contexto.

Comportamiento por situación:

| Situación | Comportamiento |
|---|---|
| **Asociación explícita** | la fija una persona (`PUT /pa/tracking` con `projectId`); auditada `actor='human'` |
| **Asociación pendiente** | `project_id = NULL`, `relation='unresolved'`; el workspace puede estar `on` y **no resuelve** (`D-UX22-04`) |
| **Cambio de proyecto asociado** | se permite; se audita `tracking.rebind` con **proyecto anterior y nuevo**; **no** se mueve ni se borra conocimiento |
| **Conflicto entre asociaciones** | si dos workspaces seguidos apuntan al mismo `path_key` con proyectos distintos → no se elige: se marca conflicto y no resuelve |
| **Asociación automática** | **prohibida** en UX-2.2 (sólo el modo fácil de UX-3 podría proponerla, y siempre con autorización válida) |
| **Proyecto archivado** | si el proyecto asociado deja de estar `active`, no resuelve (`scope-forbidden`), coherente con `resolve.mjs:169-175` |

`HECHO` — hoy la asociación es **efímera**: sale del workspace de la sesión (`sessionIds`) o del workspace que
contiene el `cwd`, y exige raíz confiable (`lib/resolve.mjs:77-119`). No hay nada persistido que diga «este
workspace pertenece a este proyecto».

---

## 4. Precedencia de resolución (formalizada)

`HECHO` (hoy, `lib/resolve.mjs:129-232`): 1) `session_scope` explícita (con `scope-ambiguous` si el `cwd` apunta a
otro proyecto, 176-189) → 2) `cwd` ∩ raíces → 3) workspace de la sesión o que contiene el `cwd` + raíz confiable →
4) `scope-unresolved`.

**Normativo (`D-UX22-12 = A`)** — orden de resolución de UX-2.2:

```
0. identidad y perfil válidos                        (sin cambios)
1. session_scope explícita ACTIVA
   └─ si el cwd resuelve otro proyecto → scope-ambiguous (código EXISTENTE, sin cambios)
2. workspace SEGUIDO correspondiente a ESTA sesión   ← escalón nuevo (D-UX22-02)
   · sólo si state='on', last_status='ok', project_id != NULL y proyecto activo
   · si el cwd resuelve un proyecto DISTINTO → scope-conflict (código NUEVO, D-UX22-03)
   · el seguimiento aporta SOLO el project_id; raíces y grants se evalúan igual
3. cwd ∩ raíces autorizadas                          (sin cambios)
4. workspace abierto que contiene el cwd + trusted   (sin cambios)
5. nada → scope-unresolved                            (sin cambios)
```

Reglas duras:

- **Precedencia conservada:** el escalón 2 **nunca** sustituye una selección explícita de sesión (`D-UX22-02`,
  precisión del propietario). Si hay selección explícita, el seguimiento **no se consulta**.
- **Sólo la sesión actual:** el escalón 2 usa **exclusivamente** el workspace que corresponde a la sesión; jamás
  «todos los seguidos» (`D-UX22-02`).
- **Conflicto explícito:** workspace seguido ≠ `cwd` → `scope-conflict`, con `details` que permitan corregir
  (`workspace_project_id`, `cwd_project_id`, `workspace_path`, `cwd`). Prohibido: elegir, combinar o ampliar ámbitos
  (`D-UX22-03`).
- **Sin proyecto → no resuelve** (`D-UX22-04`), sin caer al `cwd` como consuelo silencioso: se sigue al escalón 3
  sólo si el escalón 2 **no aplica** (no hay workspace seguido para la sesión). Si aplica y no resuelve, se informa.
- **`scope-conflict` es código nuevo** y debe entrar en `PROJECT-AWARE-ERROR-CONTRACT.md` con su mapa HTTP.
  `scope-ambiguous` **no** se reutiliza: significa otra cosa (dos proyectos en el mismo `cwd`).
`D-UX22-12 = A` — reglas adicionales, **normativas**:

- Un `session_scope` **explícito y activo** tiene **precedencia** sobre el seguimiento del workspace.
- Si el proyecto explícito de la sesión y el workspace seguido **discrepan**, **prevalece el `session_scope`**; la
  discrepancia debe poder **auditarse o diagnosticarse** (`scope.resolve` con la discrepancia en `detail`). **No** es
  un error para la sesión, pero **sí** queda registrada.
- `scope-conflict` se reserva **exclusivamente** al conflicto entre el proyecto resuelto **desde el workspace
  seguido** y el resuelto **desde el `cwd`**.
- **No** confundir `scope-conflict` con `scope-ambiguous` (dos proyectos en el mismo `cwd`, `resolve.mjs:250-259`).
- **No** fusionar silenciosamente proyectos ni ámbitos, en ningún escalón.
- **`pa_selection` no participa** en la resolución de contexto de las herramientas: sigue siendo selección **visual**
  del panel (`D-UX22-05`).

---

## 5. Persistencia — registro v3 aditiva

`PROPUESTA` (forma **no aprobada**, §4.5 del mandato):

```sql
CREATE TABLE IF NOT EXISTS workspace_tracking (
  path_key      TEXT PRIMARY KEY,
  workspace_id  TEXT,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  state         TEXT NOT NULL CHECK (state IN ('on','off','paused')),
  association   TEXT NOT NULL CHECK (association IN ('explicit','pending','conflict')),
  bound_by      TEXT NOT NULL CHECK (bound_by IN ('human')),
  bound_at      TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_seen_at  TEXT,
  last_status   TEXT CHECK (last_status IN ('ok','missing','unknown')),
  revision      INTEGER NOT NULL DEFAULT 1            -- para CAS (D-UX22-10)
) STRICT;
```

Decisiones de diseño propuestas: **sin FK al Host** (no es nuestro; la fila sobrevive al workspace); `project_id`
nullable con `ON DELETE SET NULL` (borrar un proyecto no borra la decisión humana, la deja «pendiente»);
`revision` para CAS; `bound_by='human'` **forzado por CHECK** en UX-2.2 (el `host` llegará con UX-3, y exigirá
cambiar el CHECK en un acto propio, no por la puerta de atrás).

**Migración (propuesta):** `PRAGMA user_version` 2 → 3 con `CREATE TABLE IF NOT EXISTS` **sólo**; `registry_version`
sube tras verificar `integrity_check`. **Nunca** `ALTER` sobre tablas existentes, **nunca** reescribir filas.
**Reversión — corrección medida (2026-11-23, `D-IMPL-06`):** la afirmación anterior («código v2 la ignora») es
**falsa**: `lib/registry.mjs:181-185` lanza `store-version-unsupported` cuando `user_version > REGISTRY_VERSION`, y
`openRegistry` se ejecuta en cada petición PA y en cada herramienta. Un registro v3 **no** lo abre un binario 1.4.0.
La vuelta atrás real es: cerrar el Host, restaurar `registry.sqlite3` del respaldo del acto (o, sin respaldo, fijar
`user_version=2` y `meta.registry_version=2` y verificar `integrity_check`), **sin** `DROP TABLE`. Se documenta que la
reversión **no es automática** y que exige una operación explícita. Pruebas exigidas: integridad antes/después, recuento por tabla idéntico en las
once tablas v2, apertura con el código anterior, y huella de los `rag.sqlite3` de ámbito sin cambio.

---

## 6. API — `D-UX22-10 = A` (decidido)

**Normativo:** la API de seguimiento es **humana** y consta de tres rutas:

| Método | Ruta |
|---|---|
| GET | `/lifecode-rag/pa/tracking` |
| PUT | `/lifecode-rag/pa/tracking` |
| DELETE | `/lifecode-rag/pa/tracking?pathKey=…` |

Condiciones **obligatorias**: las mutaciones usan **control de concurrencia CAS**; los tres endpoints están
protegidos por los mecanismos de **autenticación, autorización y CSRF** correspondientes; la evolución se documenta
como **`pa/1.5.0`, aditiva** respecto de `pa/1.4.0`; **no** se elimina ni altera retroactivamente ningún contrato
anterior. Estas rutas siguen siendo **especificación, no implementación realizada**.

Forma concreta de cuerpos y campos (`PROPUESTA`, no decidida):

| Método | Ruta | Cuerpo | Respuesta | Compuerta |
|---|---|---|---|---|
| GET | `/lifecode-rag/pa/tracking` | — | `{items, counts, asOf, version}` | lectura PA |
| PUT | `/lifecode-rag/pa/tracking` | `{pathKey, state, projectId?, expectedRevision?}` | `{changed, item, revision}` | **humana** (misma que `/selection`) |
| DELETE | `/lifecode-rag/pa/tracking?pathKey=…` | — | `{changed}` | **humana** |

Cambios aditivos en `/pa/workspaces` (por fila): `tracked` (bool), `trackingState`, `trackingProject`, sin alterar
los campos de UX-2.1. Códigos de error propuestos: `tracking-not-found` (404), `tracking-stale-revision` (409),
`tracking-invalid` (400), `scope-conflict` (409 en herramientas, con `details`).

**Nunca** una herramienta del modelo escribe seguimiento: no hay tool nueva (`D-CONT-02`). Si `expectedRevision` no
coincide → 409 y **no** se escribe.

---

## 7. Auditoría — `D-UX22-11 = A` (decidido)

**Normativo:** se registran como **acciones humanas auditables** exactamente estas cinco:

`enable` · `disable` · `pause` · `resume` · `reassociate`

Cada una en `audit_registry` con `actor='human'`, el `path_key` afectado y, en `reassociate`, la **asociación
anterior y la nueva** (`D-UX22-09`).

**La reconciliación técnica de disponibilidad se distingue** de las decisiones humanas: se registra como
`tracking.reconcile` con `actor='host'` y modificando **sólo** el eje B. **Nunca** se atribuye al usuario una acción
generada automáticamente por el sistema, ni se presenta en el panel como si la persona la hubiera hecho.

Además, `scope.resolve` sigue auditando cada resolución (ya existe, `resolve.mjs:294-304`) y `scope-conflict` se
registra como resultado de error, no como acción humana.

---

## 8. Interfaz — tres cosas que deben verse distintas (`D-UX22-05`)

`PROPUESTA`

1. **Proyecto seleccionado en el panel** — etiqueta `Seleccionado para administrar` (fuente `pa_selection`).
2. **Workspace seguido** — interruptor + `Seguido` / `Pausado` / `Sin seguimiento` (fuente `workspace_tracking`).
3. **Proyecto resuelto por una sesión de IA** — no se inventa en el panel: se muestra sólo si la API puede decirlo;
   si no, se declara «no se puede determinar desde el panel».

Texto obligatorio en la vista: *seguir un workspace no autoriza su lectura ni su subcarpetas; la autorización se
administra aparte*. Estado de un workspace seguido **sin proyecto**: `Seguido · sin proyecto asociado — no resolverá
contexto` (`D-UX22-04`).

Filtros propuestos: `Todos · Seguidos · Sin seguimiento · Con proyecto · Sin proyecto`.

---

## 9. Invariantes que la implementación debe respetar (`D-UX22-06`)

Activar seguimiento **no** puede: crear raíces autorizadas · modificar `trusted_roots` · crear o ampliar grants ·
autorizar subcarpetas · leer contenido no autorizado · ingerir o reindexar · cambiar permisos existentes.

Además (`D-CONT-06`): Core host-agnostic · `lib/**` sin DSH/Cordis/Electron · adaptador único · funciona sin DSH ·
sin dependencias entre plugins · cambios de API aditivos.

---

## 10. Mapa de aceptación → pruebas

| # | Criterio del propietario (§7) | Prueba propuesta |
|---|---|---|
| 1 | el toggle persiste tras reiniciar DSH | escribir, cerrar y reabrir el registro; leer la fila |
| 2 | el seguimiento no modifica `pa_selection` | hash de la fila antes/después de todo el ciclo |
| 3 | no modifica `session_scope` explícita | ídem sobre las filas de sesión |
| 4 | resuelve sólo para su sesión | dos sesiones, un seguido cada una → proyectos distintos |
| 5 | dos sesiones con proyectos distintos quedan aisladas | búsqueda no devuelve fragmentos del otro proyecto |
| 6 | conflicto workspace/`cwd` → `scope-conflict` | `cwd` en proyecto B, seguido en A → código exacto y `details` |
| 7 | workspace sin proyecto se sigue pero no resuelve | `on` + `project_id NULL` → no resuelve, informa |
| 8 | workspace ausente conserva su seguimiento | `missing` → fila intacta, eje A intacto |
| 9 | anidados respetan la raíz más específica | padre e hijo seguidos → gana el hijo; sin fusión |
| 10 | ninguna operación de seguimiento crea o modifica permisos | hash de `roots`/`meta.trusted_roots`/`grants` antes/después |
| 11 | las siete herramientas conservan contratos y controles | suite de contratos intacta; aprobaciones sin cambio |
| 12 | el Core sigue funcionando sin DSH | pruebas del núcleo con servicios falsos (no son pruebas contra el Host) |
| 13 | la migración conserva registro y almacenes | `integrity_check` + recuentos por tabla + hashes de ámbitos |
| 14 | pruebas herméticas e integración autorizadas pasan | `npm test` + `npm run test:hermetic` |
| 15 | la evidencia distingue dobles de pruebas reales | cada informe marca `DOBLE` / `HOST REAL` por prueba |
| 16 | reasociar **no** mueve conocimiento (`D-UX22-09`) | las fuentes y chunks del proyecto anterior intactos (mismo `sha256` por fuente e `id` inalterados); sólo cambia la fila de seguimiento y la auditoría |
| 17 | la reconciliación **no** se atribuye a la persona (`D-UX22-11`) | con `last_status` cambiado por el sistema, el eje A intacto y la cadena de auditoría con `actor='host'`, sin ninguna entrada `actor='human'` |

`HECHO` — el criterio 15 es el más fácil de incumplir: el proyecto ya tiene la costumbre de separarlo
(`ACEPTACION-*.md` usa estados `TESTED LOCAL` / `OBSERVED`), y UX-2.2 debe seguirla.

---

## 11. Propuesta de implementación (no autorizada)

Orden propuesto, cada paso con su puerta:

1. **`lib/tracking.mjs`** (nuevo, puro): proyección y transiciones del eje A/B, sin base de datos propia; recibe filas
   planas. Pruebas unitarias primero (TDD).
2. **`lib/registry-schema.mjs`**: tabla v3 + `user_version` (aditivo, pruebas de migración y reversión).
3. **`lib/tracking-store.mjs`** (o funciones en `registry.mjs`): CRUD transaccional + auditoría.
4. **`lib/resolve.mjs`**: escalón 2 y `scope-conflict`; el resto del orden, intacto.
5. **`lib/workspaces-projection.mjs`** / `harness-workspaces.mjs`: campos `tracked` sin romper la salida actual.
6. **`lib/pa-api.mjs`**: rutas `/tracking` + campos aditivos en `/workspaces`; `pa/1.5.0`.
7. **`client.js`**: interruptor, estados, filtros y los tres textos distintos.
8. **Contratos**: `PA-UI-0-API-CONTRACT.md` (§20), `PROJECT-AWARE-ERROR-CONTRACT.md` (`scope-conflict`),
   `PROJECT-AWARE-SESSION-CONTRACT.md` (escalón nuevo), `CONTRATO-v0.1.md` (sin cambios: las tools no cambian).
9. **Evidencia**: suite completa, hermética, y un acto de instalación **aparte** con su propio hash de plan.

**Puertas**: G1 registro v2 íntegro antes de migrar · G2 migración aditiva verificada y revertible · G3 ninguna
escritura en `roots`/`trusted_roots`/`grants`/`pa_selection`/`session_scope` por parte del seguimiento · G4 suite y
hermética en verde · G5 el Host real no se toca sin acto propio.

---

## 12. BLOCKER-01 — identidad y autorización de la raíz `plugins-dhs-release`

**Estado: `PENDING`** · **Medido el 2026-11-23, sólo lectura.**

### 12.1 Rutas e identidad (HECHO)

| Dato | `C:\xampp\htdocs\plugins-dhs` | `C:\xampp\htdocs\plugins-dhs-release` |
|---|---|---|
| Existencia | directorio real | directorio real (realpath idéntico al literal) |
| `.git` | **directorio** | **fichero** → `gitdir: C:/xampp/htdocs/plugins-dhs/.git/worktrees/plugins-dhs-release` |
| Repositorio git | propio | **worktree del mismo repositorio** (`--git-common-dir` = `C:/xampp/htdocs/plugins-dhs/.git`) |
| Rama / HEAD | `fix/t45-4-r17-acceptance` / `655f037` | `release/lifecode-rag-1.0.0` / `7d7e839` |
| Contención mutua (regla de prefijo + `/`) | no contiene al otro | **no** está dentro del otro |

`INFERENCIA` — Son **el mismo repositorio** en identidad git y **dos árboles físicos distintos** en identidad de
sistema de ficheros. Para RAG (que identifica por `path_key`) son **dos raíces distintas**; para git son la misma
historia. Ninguna de las dos cosas es un error: es la naturaleza de `git worktree`.

### 12.2 Autorización actual en el perfil `desktop` (HECHO, registro en sólo lectura)

**Proyectos (3):**

| Proyecto | Raíz autorizada | Añadida por |
|---|---|---|
| `prj_01M7RBSRD33M26HGBEFW51WPP6` «LifeCode RAG» | `C:\xampp\htdocs\plugins-dhs\lifecode-rag` | `human` |
| `prj_01M7TRDQYRAPJR03QTM3PP6PX2` «plugins-dhs» | `C:\xampp\htdocs\plugins-dhs` | **`host`** |
| `prj_01M82G7A9MGTQMRW15F0R5RVDP` «lifecode-brain» | `C:\xampp\htdocs\lifecode-brain` | `human` |

**Raíces confiables (`meta.trusted_roots`):** una sola — `C:\xampp\htdocs\plugins-dhs`, `state='trusted'`,
`readAuthorization=true`, `addedBy='human'`.

### 12.3 Consecuencia (HECHO + INFERENCIA)

- `HECHO` — `c:/xampp/htdocs/plugins-dhs-release` **no** cae dentro de `c:/xampp/htdocs/plugins-dhs/` por la regla de
  prefijo con barra; tampoco hay raíz registrada para él.
- `INFERENCIA` — Un workspace en `…-release` aparecerá en Discovery con relación **`none`** (detectado, sin
  proyecto). Al resolver por `cwd`, `matchingProjects` no devuelve nada (`resolve.mjs:203`) y se pasa al sondeo de
  frontera, que exige raíz confiable sobre el workspace (`resolve.mjs:96-112`) y una raíz registrada **exactamente**
  en esa frontera (`resolve.mjs:116-118`). Ni una ni otra existen para `-release` → `scope-unresolved` con
  `reason:'project-not-authorized'`.
- `HECHO` — El proyecto «LifeCode RAG» apunta al árbol **`plugins-dhs\lifecode-rag`**, no al de release: hoy el
  conocimiento del plugin vive en el árbol de desarrollo, no en el árbol de la rama de publicación.

### 12.4 Solución mínima: qué habría que aprobar (PROPUESTA, no ejecutada)

> **Corrección de una afirmación propia anterior.** La auditoría dijo que hacían falta «dos capas» (raíz **y**
> confianza). Leyendo `lib/resolve.mjs:203-263` se comprueba que es **inexacto**: si el `cwd` cae dentro de una raíz
> **autorizada**, la resolución termina ahí y **no** consulta `trusted_roots`; la confianza sólo se exige en el
> sondeo de frontera, al que se llega **cuando ninguna raíz cubre el `cwd`** (`resolve.mjs:96-112`). Además, con
> confianza pero **sin** raíz registrada en la frontera, el sondeo devuelve `projectId: null` y **tampoco resuelve**
> (`resolve.mjs:116-118`). Conclusión corregida: **la raíz es la que habilita; la confianza por sí sola no habilita
> nada.**

| Opción | Qué se autoriza | Ventaja | Coste / riesgo |
|---|---|---|---|
| **A** | `root add` de `…\plugins-dhs-release\lifecode-rag` **al proyecto existente** «LifeCode RAG» — **DECIDIDA (`D-UX22-13 = A`), limitada a esa ruta exacta y pendiente de aprobación humana de la operación** | mínimo: **un** acto humano, sin proyecto nuevo, sin tocar `trusted_roots` | duplicación de fuentes si se ingiere el mismo contenido desde los dos árboles (ver `UX-22-ROOT-PROPOSAL.md` §7-8) |
| **B** | proyecto nuevo «LifeCode RAG (release)» + su raíz | aislamiento limpio, sin duplicados | la memoria se parte en dos; hay que decidir cuál es canónica |
| **C** | raíz de todo `…\plugins-dhs-release` (como el proyecto «plugins-dhs» hace con su árbol) | coherente con el uso existente del árbol completo | ámbito enorme (todos los plugins + `plans/` + evidencias) |
| **D** | no autorizar nada y seguir trabajando en `plugins-dhs` | cero permisos nuevos | el árbol de release no se puede ingerir ni resolver por `cwd` |

`HECHO` — La rama de **selección explícita** de sesión tampoco exige raíz confiable (`lib/resolve.mjs:150-194`): se
apoya sólo en `roots` autorizadas (`resolve.mjs:266-292`). Es decir: con una selección explícita válida, `-release`
funcionaría **si** tuviera raíz; sin raíz, no hay ámbito que abrir.

`D-UX22-13 = A` (**decidido, documental**) — la opción A queda **limitada exactamente** a:

```
<REPO_ROOT>
```

asociada al proyecto **existente** «LifeCode RAG» (`prj_01M7RBSRD33M26HGBEFW51WPP6`).

**Prohibiciones explícitas:** no autorizar todo `plugins-dhs-release`; no autorizar todo `plugins-dhs`; no autorizar
una raíz superior que incluya otros plugins o proyectos; no modificar `roots`, `trusted_roots`, grants ni permisos
en este acto; no ejecutar lecturas reales, ingestas, indexaciones ni pruebas de acceso; **no inferir** que la
relación Git entre `plugins-dhs` y `plugins-dhs-release` concede autorización sobre ambas rutas; **no duplicar**
conocimiento por existir dos worktrees físicos del mismo repositorio.

**Condición de aprobación humana previa:** antes de cualquier lectura real se presenta la propuesta independiente de
[`UX-22-ROOT-PROPOSAL.md`](UX-22-ROOT-PROPOSAL.md) —ruta, proyecto, registro afectado, mecanismo, alcance efectivo,
no extensión a hermanos, riesgo de duplicación y su mitigación, estado actual vs propuesto y operación exacta— y se
**espera aprobación específica**. **No ejecutado.**

---

## 13. Estado de las decisiones y lo que sigue pendiente

**Resueltas (`A`) y normativas en este documento:** `D-UX22-07` · `08` · `09` · `10` · `11` · `12` (§0.1) y `13`
(limitada a una ruta exacta, §12.4). **Ninguna es una implementación.**

Lo que sigue **sin decidir** —y no puede darse por aprobado—:

| ID | Qué queda | Estado |
|---|---|---|
| `D-UX22-13 (operación)` | Aprobar (o rechazar) la **operación exacta** de raíz de `UX-22-ROOT-PROPOSAL.md` §10 | **PENDING — bloquea cualquier lectura real en esa ruta** |
| `D-UX22-BLOCKER-01` | Mismo objeto que lo anterior: verificación y autorización de la raíz `plugins-dhs-release` | **PENDING** |
| `PROPUESTA-SQL` | La forma exacta de `workspace_tracking` (§5) sigue siendo **propuesta**: ningún decision la fijó | PROPUESTA |
| `D-UX22-08 (detalle)` | Si `missing` puede volver a `ok` en la misma reconciliación o exige una posterior: **deriva de `A`** y se resolverá al escribir las pruebas | PROPUESTA |
