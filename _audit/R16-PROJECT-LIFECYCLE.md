# R16 · Ciclo de vida del proyecto

| Campo | Valor |
|---|---|
| Ronda | R16 — Proyectos: descubrimiento, registro y administración |
| Fecha de redacción | 2026-11-09 |
| Ámbito | `lifecode-skill-center` (núcleo `lib/`, adaptador `index.js`, panel `client.js`) |
| Contrato de referencia | `_audit/R16-CONTRACT.md` (incluye Enmienda E1) |
| Estado | Documenta lo implementado y medido; las divergencias se marcan expresamente |

Este informe describe el ciclo de vida **real** del proyecto: cómo se descubría antes, qué
controles no hacían lo que aparentaban, qué APIs del Host se usan ahora, cómo se calcula la
identidad, qué significan los siete estados y qué escribe —y qué no escribe— cada operación.

---

## 1. Lo que había antes (LSC-016)

La sección Proyectos anterior era un **descubrimiento pasivo**: en cada petición se resolvía el
registro de workspaces del Host y se pintaba lo que devolviera, sin registrar nada en el centro y
sin ficha de detalle. Los chips eran recuentos textuales y la lista no cambiaba al pulsarlos.

Evidencia recogida en `_audit/r16-baseline-gates.md:22-36` y `_audit/INFORME-LSC-016.md:8-92`:

- Pestañas «Descubiertos 7» / «Gestionados 3» / «Identidad 9»; chips «7 descubiertos»,
  «3 gestionados», «1 coincidencias legacy», «2 gestionados sin workspace»
  (`_audit/r16-baseline-gates.md:24-27`).
- Al pulsar un chip sólo se pintaba el borde de selección: las 7 filas de Descubiertos seguían
  visibles (`_audit/r16-baseline-gates.md:33`).
- El pie decía «Descubierto es sólo lectura: la vinculación con UUID llegará en un acto posterior.»
  y en Identidad «Las acciones de identidad se activan al migrar el almacén a v3 (requiere
  autorización humana).» (`_audit/r16-baseline-gates.md:25-30`).
- «Publicar manifiesto» se ofrecía en todas las filas de Identidad, incluso con «Carpeta:
  missing-dir» y con el almacén aún en v2 (`_audit/r16-baseline-gates.md:29-34`).
- «Registrar» aparecía atenuado con el campo vacío y no se probó ninguna acción de escritura
  (`_audit/r16-baseline-gates.md:35-36`).
- El cruce con los 3 registros existentes era por ruta canónica exacta; `plugins-dhs` quedaba como
  «coincidencia legacy» y los otros dos como «unmatched» (`_audit/INFORME-LSC-016.md:71-83`).

**Controles que no ejecutaban la operación esperada.** Los chips de recuento no filtraban
(`_audit/r16-baseline-gates.md:33`); «Publicar manifiesto» era una promesa de una fase no
implementada, no una escritura (`_audit/r16-baseline-gates.md:28-30`); el registro explícito no
existía; «Trabajar en este proyecto» cambiaba de proyecto pero no abría ni vinculaba un workspace;
las acciones de identidad estaban detrás de la migración v3. La ronda R16 sustituye esa superficie
por un ciclo explícito y verificable.

## 2. APIs reales que usa ahora

| API / servicio | Naturaleza | Dónde se usa | Para qué |
|---|---|---|---|
| `workspaceRegistry.list()` + `status()` | Host, lectura | `index.js:334-341` resuelve el servicio; `lib/api.mjs:752-807` (`workspacesPayload`) y `lib/api.mjs:1316-1456` (`projectsPayload`) lo consumen | Enumerar workspaces, su ruta, sesiones y disponibilidad |
| `workspaceRegistry.get()` | Host, lectura | No se invoca en esta ronda | — (**no verificado**: no aparece ninguna llamada en `lib/` ni en `index.js`) |
| `loader.entries()` (`getLoaderEntries`) | Host, lectura | Adaptador en `lib/api.mjs:892-921`; inventario en `lib/inventory.mjs:824-1039` | Saber qué plugins están cargados y con qué nombre de módulo |
| `skills.snapshot({ cwd })` | Host, lectura | `lib/api.mjs:892-921`; `lib/inventory.mjs:824-1039` | Verdad de carga: qué skill gana para un `cwd` |
| `sessionPersistence` | Host, lectura | `index.js:373-375`; conteo en `lib/projects.mjs:124-130` | `sessions.count` cuando la fuente existe |
| `uiWorkspace.openWorkspace(id)` | **Cliente** | `client.js:4779-4785` | Único camino para abrir un workspace; el Host no puede |
| `POST /lifecode-skill-center/api/state` | API propia | `client.js:4794-4814` | `inspect-project`, `register-project`, `adopt-project`, `materialize-project`… |
| `GET /api/projects?cwd`, `GET /api/inventory?cwd` | API propia | `client.js:4842-4843` | Lista de proyectos y censo de skills en paralelo |

La apertura de workspace es la limitación estructural: `uiWorkspace.openWorkspace` es un servicio
del cliente que abre una sesión en blanco, no una operación del Host
(`_audit/R16-ARCHITECTURE.md`, sección de workspace). Por eso el POST `open-workspace` responde
`501 host-action-unsupported` con `clientAction`
(`lib/api.mjs:98-109`, prueba `tests/r16-api.test.mjs:434`) y el botón «Abrir en DSH» sólo se
habilita si el workspace tiene id y el panel ofrece el servicio (`client.js:2883-2886`,
`client.js:5449`).

## 3. Contrato de identidad

`projectIdFor(cwd)` es determinista y **no necesita escribir nada**:

1. `normalizeCwd(cwd)`: recorta, cambia `\` por `/`, colapsa `//` y quita la barra final
   (`lib/format.mjs:52-65`).
2. `cwdKey = normalizeCwd(cwd).toLowerCase()` (`lib/format.mjs:66-68`).
3. `projectId = <slugId(basename(cwdKey), 24) || 'proyecto'> + '-' + sha1(cwdKey).hex[0..8]`
   (`lib/format.mjs:71-77`).

Consecuencias verificadas:

- Mayúsculas, `\` frente a `/` y barra final producen **el mismo** `projectId`
  (`tests/r16-contract.test.mjs:194-214`).
- Dos rutas distintas con el mismo `cwdKey` producen colisión de identidad, no dos proyectos
  (`lib/projects.mjs:207-210`; prueba `tests/r16-domain.test.mjs:765-784`).
- El Host **no** da un UUID de proyecto: el UUID lo genera el centro al registrar
  (`lib/api.mjs:847-878`, `lib/manifest-ops.mjs:44-46`). El manifiesto guarda ese UUID en su campo
  `projectId` (`lib/manifest-ops.mjs:24-28`).
- El registro durable vive en `state.projects[projectId]` con `{ id, name, cwd, createdAt,
  updatedAt, note }` más los campos de identidad v3 opcionales (`uuid`, `manifestSha256`,
  `manifestRegisteredAt`, `adoptedAt`, `detached*`, `originalUuid`, `fork*`), copiados sólo si son
  cadenas no vacías (`lib/state.mjs:180-210`). El estado del proyecto **no se persiste**: se
  clasifica en cada lectura (`lib/projects.mjs:179-243`).

## 4. Los siete estados y su precedencia

`classifyProject` es la única fuente del estado (`lib/projects.mjs:179-243`); `buildProjectsPayload`
no lo recalcula por su cuenta (`lib/projects.mjs:372-509`).

| Estado | Condición (código) | Operaciones permitidas (`lib/projects.mjs:22-30`) |
|---|---|---|
| `identity-conflict` | manifiesto con SHA/UUID distinto, dos registros con el mismo `cwdKey` o dos workspaces con la misma ruta (`:197-214`) | `read`, `inspect`, `detach-project` |
| `unavailable` | `availability === 'missing-dir'` o registro con `cwd` vacío (`:215-218`) | `read`, `inspect`, `detach-project`, `repair-manifest` |
| `partially-inspected` | inspección `incomplete`/`failed`, almacén no escribible o error de fuentes (`:219-222`) | `read`, `inspect` |
| `external-managed` | manifiesto válido sin registro en `state.projects` (`:224-226`) | `read`, `inspect`, `adopt-project`, `detach-project` |
| `healthy` | registrado, identidad coherente, cero findings (`:242`) | `read`, `inspect`, `assign-skill`, `materialize-project`, `rename-project`, `repair-manifest`, `detach-project` |
| `managed` | registrado y con al menos un `warn` (`:240`) | ídem `healthy` + `register-project` |
| `discovered` | workspace del Host disponible, sin registro ni manifiesto (`:228`) | `read`, `inspect`, `register-project` |

Precedencia: `identity-conflict` → `unavailable` → `partially-inspected` → `external-managed` →
`healthy` → `managed` → `discovered`. `registration.present` se informa aparte
(`lib/projects.mjs:300-345`), de modo que un proyecto puede estar «registrado» y aun así aparecer
`external-managed` si el registro no es coherente.

Transiciones reales:

- `discovered` → `register-project` → `managed` o `healthy` (según findings).
- `external-managed` → `adopt-project` → `healthy`.
- `managed` → `repair-manifest` / `assign-skill` → puede pasar a `healthy`.
- `healthy`/`managed` → `materialize-project` (escribe la vista derivada, no el proyecto).
- `*` → `detach-project` → `discovered`, con confirmación humana.
- Observaciones: un proyecto borrado del disco pasa a `unavailable`; un manifiesto incoherente pasa a
  `identity-conflict`.

## 5. Prevalidación de sólo lectura

Hay **dos** capas y ninguna escribe:

1. **Cliente** (`client.js:2774-2798`): `buildPreflight` calcula, con el payload ya cargado, las
   operaciones permitidas, los bloqueos (`state`, `noPath`, `alreadyRegistered`) y si la cobertura
   del inventario está completa. Pinta el paso 1 del diálogo y decide si «Revisar y continuar» se
   habilita (`client.js:3604`).
2. **Servidor** (`lib/api.mjs:1212-1308`): antes de abrir el almacén, `actionPreflight` mide las
   fuentes reales (estado, manifiesto, ruta, vista materializada, registro de workspaces,
   `skills.snapshot`) y llama a `preflight` (`lib/preflight.mjs:217-356`). Si falta una fuente
   **requerida** para la acción, devuelve `block` con `evidence-incomplete`; si falta una opcional,
   `warn catalog-unverified`. El resultado `block` se convierte en
   `409 preflight-blocked` con `findings`, `reasons` y `evidence`
   (`lib/api.mjs:2856-2876`).

El diálogo lo dice con texto exacto: «Prevalidación de sólo lectura: no se escribe nada hasta que
confirmes.» (`client.js:359`). La cobertura se muestra como completa o parcial
(`client.js:384-385`) y las fuentes ausentes se listan con su estado (`client.js:3555-3563`).

## 6. Registro explícito: escribe el centro, no el proyecto

`POST /api/state` con `action: 'register-project'` (`lib/api.mjs:3053-3076`):

1. Resuelve la ruta objetivo: `data.cwd ?? cwd`; si el cliente manda un `cwd` distinto del `hostCwd`
   cuando hay sesión viva, la petición se rechaza con `400 identity-from-client` antes de tocar el
   almacén (`lib/api.mjs:691-699`, prueba `tests/r16-api.test.mjs:399-413`).
2. `ensureProject` crea o actualiza el registro **en memoria** (`lib/operations.mjs:75-95`). No hay
   escritura dentro del proyecto.
3. `writeCenterManifest` crea `<centro>/projects/<projectId>/manifest.json` con `uuid` v4, esquema
   `lifecode-skill-center/project`, versión 1 y `registeredAt` UTC (`lib/api.mjs:847-878`,
   `lib/manifest-ops.mjs:24-53`). Si ya hay un manifiesto válido y el UUID es v4, lo reutiliza; si el
   manifiesto existe pero no es válido, devuelve `identity-conflict`; escribe con `flag: 'wx'` y
   resuelve la carrera releyendo el ganador (`lib/api.mjs:851-874`).
4. Si el manifiesto falla y el registro era nuevo, se deshace el registro en memoria
   (`lib/api.mjs:3061-3065`).

Evidencia de que el proyecto no se toca: `treeHash(cwd)` idéntico antes y después y el almacén del
centro byte a byte igual al descubrir (`tests/r16-contract.test.mjs:133-169`). El registro es
idempotente y no pierde asignaciones (`:171-192`, `:233-247`), y el manifiesto queda con UUID v4 y
SHA-256 de 64 hex (`:160-162`).

## 7. `unavailable` y relink: nada se borra automáticamente

- Un proyecto cuya carpeta desapareció se clasifica `unavailable`; **no se recrea** en disco
  (`tests/r16-contract.test.mjs:216-231`). La UI deja de ofrecer «Abrir» y muestra «carpeta ausente»
  (`client.js:196-198`, `client.js:2883-2886`).
- El desvínculo real no es `detach-project`: es `identity-unlink` (`lib/api.mjs:2655-2699`). Escribe
  `detachedFrom`, `detachedAt` y `detachedSha256`, registra `project.detached` y **conserva** el
  registro y las asignaciones.
- El relink es `identity-relink` (`lib/api.mjs:2703-2760`): reescribe o repara el manifiesto y borra
  los tres campos `detached*`. Está detrás de la fase de identidad v3: si no está disponible, la
  acción cae en `identity-operation-pending` sin escribir (`lib/api.mjs:2849-2853`).
- La materialización sólo borra dentro de la vista derivada `<centro>/materialized/<projectId>/...`,
  nunca en el proyecto (`lib/materialize.mjs:47-90`).

## 8. Qué queda bloqueado

| Operación | Estado real | Evidencia |
|---|---|---|
| Abrir workspace desde el Host o la API | Imposible por diseño; sólo el panel con `uiWorkspace.openWorkspace` | `lib/api.mjs:98-109`; `tests/r16-api.test.mjs:434-443`; contrato §7 `_audit/R16-CONTRACT.md:606-624` |
| Migración productiva del almacén a v3 | Política viva pero implementación por fases; el centro v2 rechaza con `migration-required` sin escribir | `lib/api.mjs:117-122` |
| Herencia de autonomía en `fork` | El proyecto bifurcado nace **sin** asignaciones heredadas | `lib/api.mjs:2764-2765` |
| UUID o versión dados por el Host | El Host no los expone; sólo el catálogo v3 propio | `lib/inventory.mjs:340-392`; contrato E1 `_audit/R16-CONTRACT.md:664-710` |
| `inspect-project` por API | **No implementado**: cae en `unknown-action` y responde HTTP 200 | `lib/api.mjs:3212-3213`; contraste con contrato `_audit/R16-CONTRACT.md:577` |
| `detach-project` como acción de API | Declarada en `ACTION_SOURCES` y en las operaciones permitidas, pero sin rama en `runAction` | `lib/api.mjs:1177`; `lib/projects.mjs:22-30`; `lib/api.mjs:3212-3213` |

## 9. Decisiones que requieren autorización humana

1. **Registrar** un proyecto: crea relación administrativa en el centro y un manifiesto; el diálogo
   exige confirmación explícita (`client.js:359`, `client.js:3608-3614`).
2. **Adoptar** un `external-managed`: el manifiesto ya existe, pero el registro no; adoptar lo
   incorpora y fija `adoptedAt` (`lib/api.mjs:3077-3114`).
3. **Desvincular** (`identity-unlink`): no borra el proyecto, pero rompe la relación con el
   manifiesto; requiere confirmación humana (regla 7 de `AGENTS.md`).
4. **Revincular/reparar** un manifiesto: reescribe un fichero del centro; sólo procede con
   autorización y con la fase v3 disponible.
5. **Bifurcar** un proyecto: crea un proyecto nuevo sin asignaciones heredadas; la decisión de qué
   copiar es humana (`lib/api.mjs:2764+`).
6. **Materializar**: escribe la vista derivada que el proveedor entrega al agente; aunque no toca el
   proyecto, sí cambia lo que el agente carga.
7. **Migrar el almacén a v3**: fuera de esta ronda; cualquier migración productiva necesita
   autorización explícita y no se ejecuta desde el panel.

## 10. Riesgos residuales

| Riesgo | Evidencia | Efecto |
|---|---|---|
| `inspect-project` devuelve 200 `unknown-action` | `lib/api.mjs:3212-3213`; contrato `_audit/R16-CONTRACT.md:577` | El panel pide la ficha, recibe un error disfrazado de 200 y la presenta como error de carga; los tests de UI lo enmascaran porque su mock responde 200 (`tests/r16-ui.test.mjs:423`, `:700`, `:714`, `:816`, `:962`) |
| `detach-project` se anuncia pero no existe | `lib/projects.mjs:22-30` frente a `lib/api.mjs:3212-3213` | Un cliente que confíe en `allowedOperations` puede ofrecer una acción que termina en «la acción no existe» |
| Abrir workspace depende del panel | `client.js:4779-4785`; `lib/api.mjs:98-109` | Sin panel montado no hay apertura posible; se informa con texto exacto (`client.js:346`) |
| Conteo de sesiones heurístico | `lib/projects.mjs:124-130`; `client.js:408` | `sessions.count` puede ser `null`; nunca se pinta como 0 |
| `DSH_HOME` con dos criterios | `lib/state.mjs:57` frente a `lib/api.mjs:983`, `:1582`, `:2260` | Rutas del centro y del Host podrían discrepar si `DSH_HOME` está vacío |
| Carrera de registro | `lib/api.mjs:851-874` (flag `wx` + relectura) | Mitigada, pero el ganador lo decide el sistema de ficheros; no hay lock distribuido |
| Evidencia de gates del encargo | «650/650 y check 383/383» no reproducible a la hora de redactar (ver informe final) | El estado verde debe re-medirse cuando el árbol deje de estar en edición |

## 11. No verificado

- Que `workspaceRegistry.get()` se use en algún punto de R16: no aparece ninguna llamada.
- Que `inspect-project` exista en una rama posterior a la lectura (`lib/api.mjs` con fecha
  12:02:51): a esa versión no existe.
- El número final de pruebas y el resultado de `tools/check.mjs`: el árbol estaba siendo editado
  mientras se redactaba; se reporta la medición en el mensaje final, no aquí.
