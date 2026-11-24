# UX-2.2 — Auditoría de arquitectura y diseño del seguimiento persistente

**Modo:** investigación y diseño · **sin implementar** · sin escrituras en código, configuración ni bases
**Repositorio:** `C:\xampp\htdocs\plugins-dhs-release` · rama `release/lifecode-rag-1.0.0` · **HEAD** `7d7e839d514cca27044d595218bf8c67ec5a1f7d`
**Índice:** vacío · **worktree:** 32 entradas sucias (17 `M` + 15 `??`) — preexistentes, **intactas**
**Fecha:** 2026-11-23 · **Perfil observado:** `desktop` (lectura en sólo lectura)

**Etiquetas usadas:** `HECHO` (verificado en código o medición) · `INFERENCIA` · `PROPUESTA` · `PENDIENTE`

---

## 1. Inventario de lo inspeccionado

| Fichero | Líneas | SHA-256 (16) | Qué se miró |
|---|---|---|---|
| `lib/tools.mjs` | 364 | `2a3ac69b97a1f61f` | las siete definiciones, schemas, `execute`, `render` |
| `lib/exec-context.mjs` | 238 | `03e14543bc3924c1` | `withAuthorizedContext`: identidad → perfil → registro → resolución → ámbitos → apertura |
| `lib/resolve.mjs` | 318 | `3a6338a26b884691` | orden de resolución, `mostSpecific`, `probeCwdProject`, `effectiveScopesForProject` |
| `lib/sessions.mjs` | 343 | `f770ec230373e94b` | `session_scope`: `registerSelection`, `effectiveScopes`, expiración, invalidación, grants |
| `lib/selection.mjs` | 225 | `18b6f420638aa02f` | `pa_selection`: CAS por revisión, `readSelection`/`applySelection` |
| `lib/registry.mjs` | 606 | `9c8cc0b027535630` | apertura/migración del registro, `listProjects`, `listRoots`, auditoría |
| `lib/registry-schema.mjs` | — | `6e9bafd0bbe5c345` | DDL v2: 11 tablas e índices |
| `lib/harness-workspaces.mjs` | 217 | `6ca2b4671936ee38` | `listOpenProjects`, `openProjectForCwd/Session`, proyección UX-2.1 |
| `lib/workspaces-projection.mjs` | 189 | `0a79bdc5249aee75` | identidad por `pathKey`, relación `exact`/`inside`, estados, tope 200 |
| `lib/scope-ops.mjs` | 379 | `00fba8596920a249` | `searchScopes`, `contextScopes`, `getAcross`, `listProject`, `forget`, `reindex`, `planIngest` |
| `lib/auto-context.mjs` | 322 | `963c57cfc0a124b1` | `collectContext` (hook `agent/pre-step`), puerta léxica, presupuesto |
| `lib/trusted-roots.mjs` | 149 | `b4ec26c1974a2501` | `trusted` + `readAuthorization`, tabla `meta` |
| `lib/scope-stores.mjs` | 128 | `c7240f82d5f26f55` | un `rag.sqlite3` por ámbito en `scopes/<id>/` |
| `lib/pa-api.mjs` | 973 | `14ff188d2bb59daf` | rutas GET/POST, `/workspaces`, `/selection`, `/snapshot`, compuerta |
| `index.js` | 218 | `23ed69516f68774b` | servicios del host, registro de tools, handler PA, hook de contexto |
| `client.js` | 4 420 | `ff8119dde0c1a41e` | selección en el panel, vista Workspaces (sin seguimiento) |
| `docs/PROJECT-AWARE-SESSION-CONTRACT.md` | — | `c4927ea2eecbc218` | semántica de la selección |
| `docs/PA-UI-0-API-CONTRACT.md` | — | `c0e063bce6683f36` | contrato de la API PA (§19 incluido) |

**Estado real del registro del perfil `desktop`** (sólo lectura):

```
session_scope : 1 fila  (session-c90d50d6-… → prj_01M7RBSRD33M26HGBEFW51WPP6, active, explicit, rev 1)
pa_selection  : 1 fila  (profile → mismo proyecto, rev 5, selected_by human, principal owner)
projects      : 3 · roots autorizadas: 3
trusted_roots : 1 → C:\xampp\htdocs\plugins-dhs  (readAuthorization: true)
```

---

## 2. Flujo actual: workspace → proyecto → ámbito → herramienta

```
                       ┌─────────────────────────── PANEL / API PA (humano) ───────────────────────────┐
                       │ POST /pa/selection → pa_selection (perfil, revision)                          │
                       │ GET  /pa/workspaces → proyección de workspaces del Host + roots autorizadas    │
                       └───────────────────────────────────────────────────────────────────────────────┘
                                                    │  (no toca las herramientas — ver §4)
┌────────── DSH Host ──────────┐
│ workspaceRegistry.list()     │  workspaces: id, path, título, sessionIds, status()
│ sessions.list() (ids vivos)  │
└──────────────┬───────────────┘
               │ servicios del adaptador (index.js:110-139)
               ▼
   ┌──────────────────────── withAuthorizedContext (exec-context.mjs:63) ────────────────────────┐
   │ 1 identidad: captureSession(exec.agent) + perfil esperado                                    │
   │ 2 registro abierto (create:false)                                                            │
   │ 3 listOpenProjects(services.workspaces)           ← señal, NO autorización (exec-context:98) │
   │ 4 resolveScope():                                                                           │
   │      a) session_scope activa  → proyecto explícito                                          │
   │      b) cwd ∩ roots autorizadas (mostSpecific) → proyecto                                   │
   │      c) workspace de la sesión (sessionIds) o que contiene el cwd → límite de proyecto       │
   │         + trustedRootFor(readAuthorization) → si no, `scope-unresolved`                      │
   │      d) 0 coincidencias → scope-unresolved · >1 → scope-ambiguous                            │
   │ 5 ámbitos: proyecto + bibliotecas con grant vigente (máx. 7 libs / 8 ámbitos)                │
   │ 6 assertRootUnchanged() por cada raíz autorizada                                             │
   │ 7 apertura perezosa: scopes/<scope_id>/rag.sqlite3                                           │
   └───────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                   ▼
            ingest · search · context · get · list · forget · reindex
```

`HECHO` — Cada paso está en `exec-context.mjs:63-233`; el orden en `resolve.mjs:129-264`; los ámbitos con
grants en `resolve.mjs:266-292` y `sessions.mjs:292-343`.

**Dos selecciones que no se hablan** (`HECHO`):

| | `session_scope` | `pa_selection` |
|---|---|---|
| Granularidad | una fila por **sesión** | una fila por **perfil** (`selection_key='profile'`) |
| La escribe | `registerSelection` (`sessions.mjs:67`) — **sólo la llama el CLI** (`bin/lifecode-rag.mjs:350`) | `applySelection` (`selection.mjs:88`) — **sólo la llama la API** (`pa-api.mjs:838`) |
| La lee | `effectiveScopes` → `resolveScope` → **las siete herramientas** | `/snapshot` (`pa-api.mjs:853`) → **el panel** |
| Revisión | `revision` por sesión | `revision` monotónica con CAS |
| Efecto en las herramientas | **sí** | **ninguno** |

`HECHO` — grep: `INSERT INTO session_scope` / `UPDATE session_scope` sólo aparecen en `lib/sessions.mjs`;
`readSelection`/`applySelection` sólo se importan en `lib/pa-api.mjs:29`.
`INFERENCIA` — Por eso nadie había notado la división: en el perfil real **ambas apuntan al mismo proyecto**
(`prj_01M7RBS…`), así que el resultado coincide por casualidad, no por diseño.

---

## 3. Matriz de las siete herramientas

Todas comparten el mismo prólogo: `withAuthorizedContext` (`tools.mjs:121, 176, 226, 282, 304, 324, 348`).
**Ninguna** recibe un proyecto por parámetro: el ámbito lo decide la resolución (§2).

| # | Tool | Entrada (schema) | Salida (contrato) | ¿Cómo obtiene el ámbito? | Fuentes | Autorización/aislamiento | Escrituras | Dependencias del Host | Límites fuera de DSH |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `ingest` | `paths` (str\|str[]), `collection`, `tags[]`, `force` | `ingested[]`, `skipped[]`, `errors[]`, `approvedOutside` | `withAuthorizedContext` + `planIngest` | ficheros del disco, clasificados contra las raíces | fuera de raíz → aprobación humana; egreso remoto → aprobación | store del proyecto (fuentes, chunks, vectores) + auditoría + métricas | `approval`, `workingDirectory`, `env` | necesita aprobaciones y un directorio real |
| 2 | `search` | `query`, `limit`, `collection`, `tags[]`, `tagMode` | `results[]` (chunkKey, sourceId, uri, título, heading, ordinal, rrf, snippet), `mode`, `elapsedMs` | idem | todos los ámbitos efectivos | falla si un ámbito autorizado no se puede leer (no hay «parcial») | `search.mjs` puede escribir métricas del proyecto | `env`, embedder/egress | usable sin host si se le da identidad y ámbito |
| 3 | `context` | `query`, `budgetTokens`, `maxChunks`, `collection`, `tags[]` | `text`, `citations[]`, `tokens`, `truncated`, `considered` | idem | todos los ámbitos efectivos | checkpoint antes de devolver (`context:return`) | **sí**: métricas `context.builds`/`context.tokens` (`scope-ops.mjs:148-153`) | idem | idem |
| 4 | `get` | `ref`, `limit` | `source`, `chunks[]` | idem | todos los ámbitos | `ref` ambiguo entre ámbitos → error, no se elige por orden | ninguna | idem | idem |
| 5 | `list` | `collection`, `tag`, `limit`, `offset` | lista paginada | idem | **sólo el proyecto** (`listProject`) | isolation por store | ninguna | idem | idem |
| 6 | `forget` | `ref` | `forgotten`, `sourceId`, `uri` | idem | proyecto | aprobación humana obligatoria; nunca borra en bibliotecas | store del proyecto + auditoría | `approval` | necesita aprobación |
| 7 | `reindex` | `operation` (`fts`/`vectors`/`all`) | `operation`, `rebuiltChunks`/`rebuiltSources` | idem | proyecto | aprobación humana obligatoria | store del proyecto | `approval`, embedder | idem |

`HECHO` — Schemas y `render` en `tools.mjs:105-361`. `HECHO` — `list` va contra el proyecto únicamente
(`scope-ops.mjs:227`), mientras `search`/`context`/`get` recorren todos los ámbitos (`scope-ops.mjs:78, 126, 179`).

**Lo que les falta para usarse desde una IA fuera de DSH** (`HECHO` por lectura del prólogo): reciben
`exec.agent` (identidad del host) y `services.approval`/`workingDirectory`; sin esos servicios, `ingest`,
`forget` y `reindex` fallan en cerrado (`approval-unavailable`, `tools.mjs:38`) y la resolución sin `cwd`
ni selección acaba en `scope-unresolved`. El **núcleo** (`lib/**`) es agnóstico; lo que no es agnóstico es
**la identidad de sesión y el consentimiento**.

---

## 4. Diagnóstico: selección **no** es seguimiento

`HECHO`
1. **Seleccionar un proyecto** (panel) escribe una fila **de perfil** (`pa_selection`) con CAS por revisión.
   Es una decisión de *vista*: dice qué proyecto mirar y administrar en el panel.
2. **Las herramientas** no leen esa fila. Resuelven por `session_scope` (§2), por `cwd` o por el workspace de
   la sesión. En el perfil real hay **una** fila de sesión, creada por el CLI.
3. **`cwd` no es el workspace de origen**: `probeCwdProject` usa el workspace *que contiene* el `cwd` o el
   workspace *de la sesión*, y después exige raíz confiable (`resolve.mjs:77-119`). Un agente que corre en un
   subdirectorio hereda el proyecto del workspace; uno que corre fuera, no.
4. **Nada persiste «este workspace está seguido»**. El registro v2 no tiene tabla de seguimiento: tiene
   `session_scope`, `pa_selection`, `roots` (físicas, autorizadas), `grants` (proyecto→biblioteca) y
   `sync_state` (sincronización por raíz). Un workspace existe **sólo** dentro del host.

`INFERENCIA` — La confusión del usuario nace de que la interfaz llama «selección» a algo que se ve como
«proyecto activo» y que, en la práctica, **sólo cambia lo que el panel muestra**. La selección no alimenta al
modelo; el modelo se alimenta de la resolución por sesión/cwd/workspace.

**Qué piezas se pueden reutilizar** (`PROPUESTA`): `pathKeyFor` (identidad de ruta), `mostSpecific` (anidados),
`trusted-roots` (autorización de lectura), `grants` (conocimiento compartido), la proyección de workspaces
(UX-2.1) y el prólogo `withAuthorizedContext` (un único punto donde insertar el escalón nuevo).

**Qué piezas confunden** (`HECHO`): el nombre `pa_selection` («selección») frente a `session_scope`; y el
panel mostrando «seleccionado» sobre un proyecto que las herramientas pueden no estar usando.

---

## 5. Auditoría de UX-2.1 (lo que existe de verdad)

`HECHO`
- `GET /pa/workspaces` (`pa-api.mjs:44-50` y rama propia): lee `listProjects(active)` + `listRoots`, llama
  `projectWorkspaces(services.workspaces, {sessions, projects, limit})` y responde `{mode, service, asOf,
  version, source, reason, items, counts, truncated}`.
- Identidad: `pathKey` normalizado (`workspaces-projection.mjs:40-43`), tope 200, estados `ok`/`missing`/
  `unknown` y `live: null` cuando no se pudo mirar.
- Relación: `exact` / `inside` / `none` por la raíz **más específica** (`workspaces-projection.mjs:62-79`).
- Anidados: filas independientes; nunca se fusionan.
- Errores: `source:'none'` con motivo (`no-registry`, `registry-error`, `registry-invalid`) — nunca lista vacía
  presentada como resultado; `status()` con timeout individual y presupuesto total (`harness-workspaces.mjs:130-207`).
- Refresco: al entrar en la sección y con «Actualizar» (`client.js`), sin caché.

**Seis cosas distintas que la interfaz no debe confundir** (`HECHO` por el modelo de datos):

| Concepto | Dónde vive hoy | Qué significa |
|---|---|---|
| Workspace **detectado** | registro del Host (en memoria/durable, no en RAG) | el Host lo conoce |
| Workspace **abierto** | `sessionIds` del workspace | alguna sesión lo tiene abierto |
| Workspace **seguido** | **no existe** | — (lo crea UX-2.2) |
| **Proyecto** de conocimiento | `projects` (registro RAG) | ámbito con almacén propio |
| **Raíz autorizada** | `roots` (`state='authorized'`) | zona física de la que se puede leer/indexar |
| **Fuente indexada** | `sources` del store del ámbito | documento ya ingerido |

`HECHO` — Límites de la API del Host: no hay `archived`, ni `lastActivityAt`, ni identificador estable de
sesión por workspace; `status()` puede no existir; el registro puede fallar y hay que decirlo.

---

## 6. Modelo de datos propuesto (sin migraciones)

`PROPUESTA` — Tabla nueva en el registro del perfil, **v3 aditiva** (nada se toca; como se hizo con
`pa_selection` en v2):

```sql
CREATE TABLE workspace_tracking (
  path_key      TEXT PRIMARY KEY,              -- identidad: ruta canónica normalizada (lowercase win32)
  workspace_id  TEXT,                          -- id del Host, sólo como alias de reconciliación (puede cambiar)
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  state         TEXT NOT NULL CHECK (state IN ('on','off','paused')),
  relation      TEXT NOT NULL CHECK (relation IN ('exact','inside','unresolved')),
  bound_by      TEXT NOT NULL CHECK (bound_by IN ('human','host')),
  bound_at      TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_seen_at  TEXT,                          -- última vez que el Host lo listó
  last_status   TEXT CHECK (last_status IN ('ok','missing','unknown'))
) STRICT;
CREATE INDEX workspace_tracking_project ON workspace_tracking(project_id);
CREATE INDEX workspace_tracking_state   ON workspace_tracking(state);
```

Decisiones del modelo:

1. **Identidad = `path_key`**, no el id del Host (`PROPUESTA`, `INFERENCIA` de que el id no es comparable entre
   versiones/perfiles). `workspace_id` se guarda como alias y sirve para reconciliar al listar.
2. **Sin clave foránea al Host** (no es nuestro): si el workspace desaparece, la fila **sobrevive** y se marca
   `missing`; el seguimiento queda inerte, no se borra solo (borrar solo decisiones del humano es peor).
3. **`project_id` puede ser `NULL`**: workspace sin proyecto conocido → `relation='unresolved'` y el toggle se
   puede encender, pero **no resuelve nada** hasta que haya proyecto (y la UI lo dice).
4. **`state`**: `on` (seguido), `off` (no seguido; la fila se conserva para historia), `paused` (seguido pero
   temporalmente sin resolver; p. ej. disco desconectado). `paused`/`missing` **no** resuelven.
5. **Nada de autorización aquí**: esta tabla no crea `roots` ni `grants`. Es una decisión de **alcance
   preferente**, no un permiso. Ver §10.

`PROPUESTA` — Operaciones (todas en el registro, transaccionales y auditadas en `audit_registry` con
`actor='human'`): `trackWorkspace(pathKey, projectId?)`, `untrackWorkspace`, `pauseWorkspace`,
`resumeWorkspace`, `reconcile(workspacesDelHost)` (actualiza `last_seen_at`/`last_status` y marca `missing`
sin cambiar `state`).

---

## 7. Contrato API propuesto (sin implementar)

`PROPUESTA` — Sólo rutas humanas, detrás de la misma compuerta que el resto (`authorize` de `index.js:152`) y
con la cabecera anti-CSRF que ya usa el panel (`x-lifecode-rag`). **Nunca** una herramienta del modelo.

| Método | Ruta | Cuerpo | Respuesta | Notas |
|---|---|---|---|---|
| GET | `/pa/tracking` | — | `{items:[{pathKey, workspaceId, project, state, relation, lastSeenAt, lastStatus}], counts}` | sólo lee |
| PUT | `/pa/tracking` | `{pathKey, state, projectId?, expectedRevision?}` | `{changed, item, revision}` | idempotente; CAS opcional por revisión de la tabla |
| DELETE | `/pa/tracking?pathKey=…` | — | `{changed}` | apaga el seguimiento (no borra el workspace del Host) |

`PROPUESTA` — `/pa/workspaces` gana tres campos aditivos por fila (`tracked`, `trackingState`, `trackingProject`)
sin cambiar los existentes: `pa/1.5.0` aditivo, conservando `pa/1.4.0`.

`HECHO` (contraste) — hoy `POST_FIELDS` sólo admite `/search`, `/context`, `/selection` (`pa-api.mjs:51-55`);
añadir `/tracking` exige declararlo y decidir si es `ADMIN_ROUTES` (con compuerta de administración) o ruta
humana normal.

---

## 8. Propuesta de interfaz (Workspaces + seguimiento)

`PROPUESTA`
1. **Columna «Seguimiento»** en la tabla de Workspaces: interruptor Sí/No por fila, con su estado real
   (`Seguido` · `Pausado` · `Sin seguimiento` · `No se pudo determinar`).
2. **Chips de filtro**: «Todos · Seguidos · Sin seguimiento · Con proyecto · Sin proyecto».
3. **Columna proyecto** ya existe (UX-2.1). Si el workspace no tiene proyecto, el interruptor **no se bloquea**:
   se enciende y la fila dice «sin proyecto asociado — no resolverá contexto».
4. **Nada de selección**: encender el seguimiento **no** cambia el proyecto activo del panel ni el de la sesión.
   Texto explícito en la vista (ya hay una pista de «sólo lectura»; se amplía).
5. **Estados honestos**: `unknown` (no se pudo comprobar) nunca se pinta como «no seguido»; `missing` ofrece
   «volver a asociar» cuando el workspace reaparezca con la misma ruta.
6. **Nunca** un botón de autorizar/indexar en esta vista: seguimiento ≠ permiso (`§10`).

---

## 9. Diseño de resolución de contexto para las IA

`PROPUESTA` — Un escalón nuevo en `resolveScope`, y **sólo uno**:

```
1. session_scope explícita (sin cambios)                      ← sigue ganando
2. workspace SEGUIDO de la sesión      (nuevo)                ← sessionIds ∩ tracking(state='on', status='ok')
3. cwd ∩ roots autorizadas             (sin cambios)
4. workspace abierto que contiene el cwd + trusted root (sin cambios)
5. nada → scope-unresolved
```

Reglas que sostienen el aislamiento:

- **Cada paso sigue exigiendo autorización**: el escalón 2 sólo entrega un `project_id`; las raíces se
  revalidan igual (`assertRootUnchanged`) y los ámbitos salen de `effectiveScopesForProject`. Seguir un
  workspace **no** autoriza su carpeta.
- **Conflicto explícito** (`PENDIENTE`, decisión del propietario): si el proyecto del workspace seguido y el
  que resuelve el `cwd` difieren, propongo **`scope-conflict`** (fallar y decirlo) en vez de elegir por orden.
  Alternativa: gana el seguido y se audita. Ninguna de las dos se implementa sin su decisión.
- **Conocimiento compartido** (UX-4): lo que ya existe es `libraries` + `grants` (proyecto→biblioteca, con
  revocación y tope de 7/8). Se propone exponerlo como «áreas de conocimiento» en la UI, sin cambiar el motor:
  el proyecto consulta primero su almacén y después las bibliotecas concedidas —**hoy ya lo hace así**
  (`scope-ops.mjs:78`), el orden está garantizado por `effectiveScopes` (proyecto primero) y el merge es por
  score/RRF (`scope-ops.mjs:106`), no por ámbito.
- **Proveniencia**: cada fragmento ya lleva `scopeId`/`scopeKind` (`scope-ops.mjs:98`), pero el contrato v0.1
  **no los expone**. Para UX-5 propongo exponerlos como campo aditivo opcional (`scopes[]` por cita), sin
  romper el contrato.
- **Sin DSH**: el escalón 2 necesita `workspaces` (servicio del host). Sin él, la resolución queda exactamente
  como hoy: selección, `cwd`, o error. El núcleo no cambia; el que cambia es el adaptador.

---

## 10. Compatibilidad con el núcleo host-agnostic

`HECHO` — `lib/tools.mjs`, `lib/resolve.mjs`, `lib/sessions.mjs`, `lib/selection.mjs` y `lib/scope-ops.mjs` no
importan nada del harness; los servicios entran como parámetros (`tools.mjs:98`, `exec-context.mjs:63`). El
único módulo que conoce el host es `lib/harness-workspaces.mjs` (recibe el registro por parámetro) y el
adaptador `index.js`.

`PROPUESTA` — UX-2.2 respeta esa frontera si:
1. la tabla y sus operaciones viven en `lib/tracking.mjs` (nuevo, puro: recibe `db` y objetos planos);
2. el escalón 2 de §9 se calcula en `resolve.mjs` con una lista de workspaces **ya normalizados** (como hoy
   con `openProjects`), sin importar el host;
3. el adaptador sigue siendo el único que resuelve `ctx.get('workspaceRegistry')`.
Ninguna dependencia de LifeCode Skill Center ni de otros plugins: el seguimiento es del propio registro.

---

## 11. Riesgos, contradicciones y decisiones pendientes

**Contradicciones detectadas**

| # | Contradicción | Evidencia | Qué hacer |
|---|---|---|---|
| C1 | El contrato dice «no hay selección global» (`PROJECT-AWARE-SESSION-CONTRACT.md:36`) pero el registro v2 tiene `pa_selection` **de perfil** | `registry-schema.mjs:111`, `selection.mjs:4-14` | Decidir qué es: ¿vista del panel, o «proyecto por defecto de sesiones nuevas»? Hoy es sólo vista |
| C2 | La selección del panel **no** afecta a las herramientas | §2 y §4 | Declararlo en la UI o sincronizarlo — nunca dejarlo implícito |
| C3 | `context` y `search` **escriben** (métricas, auditoría) aunque se lean como de sólo lectura | `scope-ops.mjs:148-153`, `resolve.mjs:294-304` | Documentarlo; no contar como «no escribe» |
| C4 | El `trusted_root` del perfil real es `C:\xampp\htdocs\plugins-dhs`, y el repo de trabajo es `…-release` (no cae dentro por prefijo) | medición §1 | Un workspace de `…-release` quedaría **denegado**; esperar `project-not-authorized` y no confundirlo con un fallo de seguimiento |

**Riesgos de UX-2.2**

| Riesgo | Detalle | Mitigación propuesta |
|---|---|---|
| Seguimiento leído como permiso | encender el toggle y creer que autoriza leer/indexar | el toggle **no** toca `roots`/`grants`; la UI lo dice; prueba negativa en la suite |
| Identidad por ruta | renombrar/mover el workspace deja la fila huérfana | `missing` + «volver a asociar»; `workspace_id` como alias |
| Anidados | padre e hijo seguidos, dos proyectos | `mostSpecific` ya existe; probar el caso |
| Ruido de contexto | muchos workspaces seguidos → contexto mezclado | el escalón 2 sólo resuelve **el de la sesión**, no todos los seguidos |
| Escrituras silenciosas | el toggle es una escritura del humano: debe auditarse | `audit_registry` con `actor='human'` y `action='tracking.enable'` |
| Migración v2→v3 | tocar el registro de datos del propietario | tabla nueva + `IF NOT EXISTS`, como v1→v2; nunca reescribir filas |

**Decisiones que necesito del propietario** (`PENDIENTE`)
1. Conflicto seguido vs `cwd`: ¿`scope-conflict` (fallar) o gana el seguido con auditoría?
2. ¿Un workspace sin proyecto puede quedar «seguido»? (propongo que sí, en estado inerte y visible).
3. ¿El seguimiento es por **perfil** (como `pa_selection`) o por **sesión**? (propongo perfil: el workspace es
   del perfil, no de la conversación).
4. ¿`pa_selection` debe seguir existiendo como «vista» o pasa a ser el proyecto por defecto de sesiones nuevas?

---

## 12. Plan por fases (sin implementar)

| Fase | Alcance | Dependencias | Riesgos | Criterios de aceptación | Fuera de alcance |
|---|---|---|---|---|---|
| **UX-2.2** seguimiento manual | tabla `workspace_tracking` (v3), `lib/tracking.mjs`, `GET/PUT/DELETE /pa/tracking`, escalón 2 en `resolve.mjs`, toggle en la tabla de Workspaces | UX-2.1 (hecho), registro v2 | C1-C4, migración, ruido | toggle persiste sin tocar `roots`/`grants`/`pa_selection`; las 7 tools resuelven por workspace seguido; `missing` no resuelve y no rompe; aislamiento entre proyectos probado; suite hermética en verde | autorización implícita, ingesta automática, reindexado |
| **UX-3** modo fácil | seguimiento **automático** de workspaces abiertos (opt-in), usando `sessions.list()` | UX-2.2 | escrituras sin humano, ruido, privacidad | el automático es reversible y auditado; sólo workspaces autorizados; se puede apagar por workspace | seguimiento de workspaces nunca abiertos |
| **UX-4** áreas compartidas | UI de `libraries` + `grants` (ya existen), límites 7/8, revocación visible | UX-2.2 | mezcla de conocimiento, grants implícitos | un proyecto ve sólo lo concedido; revocar corta al instante (ya probado en PA4) | dependencias entre plugins |
| **UX-5** resolución de contexto | ranking por proveniencia, presupuestos por ámbito, dedupe entre proyectos, `scopes[]` aditivo en citas | UX-2.2/3/4 | cambios de contrato | contrato aditivo; `context` sigue citando verificable; sin mezclar proyectos independientes | cambiar el motor de búsqueda |

---

## 13. Cierre: las siete preguntas del encargo

1. **Cómo se selecciona hoy un proyecto** — `HECHO`: desde el panel (`POST /pa/selection` → `pa_selection`,
   CAS por revisión) o desde el CLI (`registerSelection` → `session_scope`). Son dos almacenes distintos.
2. **Cómo se determina hoy el contexto de las herramientas** — `HECHO`: `withAuthorizedContext` →
   `resolveScope`: selección de **sesión** → `cwd` contra raíces autorizadas → workspace de la sesión o que
   contiene el `cwd` (exigiendo raíz confiable). Sin selección ni `cwd`: `scope-unresolved`.
3. **Qué falta para asociar un workspace seguido con su proyecto** — `PROPUESTA`: una tabla de seguimiento con
   `path_key` como identidad y `project_id` como asociación, más un escalón de resolución que la consulte. Hoy
   la asociación existe sólo de forma efímera (workspace de la sesión + raíz confiable) y no se persiste.
4. **Cómo persistir el seguimiento sin mezclarlo con selección** — `PROPUESTA`: tabla propia en el registro
   (v3), escrita sólo por acciones humanas auditadas; `pa_selection` y `session_scope` no se tocan.
5. **Cómo preservar el aislamiento** — `HECHO` (lo que ya hay): un `rag.sqlite3` por ámbito, `scope_id` grabado
   en `meta`, `assertRootUnchanged` antes de abrir, fallo cerrado si un ámbito autorizado no se puede leer, y
   `ref` ambiguo rechazado. `PROPUESTA`: el escalón nuevo **sólo elige proyecto**, no amplía ámbitos.
6. **Cómo introducir conocimiento compartido sin dependencias entre plugins** — `PROPUESTA`: reutilizar
   `libraries` + `grants` del propio registro (ya existen, con revocación y topes), expuestos como «áreas».
7. **Qué cambios requiere cada fase** — `§12`.

**Estado:** auditoría y diseño **completos**. **No** se implementó nada, **no** se modificó código,
documentación existente, configuración ni bases; el único fichero escrito es este informe (nuevo, sin seguimiento
en git). **Me detengo a la espera de revisión y autorización.**
