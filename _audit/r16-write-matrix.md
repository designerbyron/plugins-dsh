# R16.1 — Matriz de caminos de escritura y su compuerta

Fecha: 2026-11-09. Alcance: los diez caminos que el contrato de R16.1 §2 pone bajo preflight.
Todo lo que sigue está medido sobre el código de este árbol (`lib/api.mjs`, `lib/preflight.mjs`,
`lib/tools.mjs`, `index.js`), no sobre una intención.

## 0. Cómo se mide la evidencia (común a todos)

| Pieza | Dónde | Qué hace |
|---|---|---|
| `GATED_ACTIONS` | `index.js:404` | acciones POST para las que el adaptador mide **antes** del despacho: `register-project`, `adopt-project`, `repair-manifest`, `detach-project`, `materialize-project`, `toggle`, `create`, `publish`, `import` |
| `resolvePreflightEvidence` | `index.js:430` | `await inventoryEvidence(...)`: `collectInventory` real + `detectCollisions` real, con `dshHome`, `agentsHome`, `materializedRoot` inyectados |
| `HOST_MEASURED_SOURCES` | `index.js:421` | sólo `skills-registry`, `loader` y `sessions` pisan la compuerta; `state`, `manifest` y `filesystem-*` los vuelve a leer la compuerta sobre el almacén real (`index.js:459`) |
| handler POST | `index.js:638-646` | si la acción está en `GATED_ACTIONS`, mide y pasa `inventory`, `collisions`, `hostSources` a `handleApiRequest` |
| `toolEvidence` | `index.js:483` | misma medición para la herramienta `lifecode_skill_create` (`centerTools({root, evidence})`, `index.js:495`) |
| `ACTION_SOURCES` | `lib/api.mjs:1189` | fuentes que se adjuntan a cada acción canónica; una fuente de otra operación no puede bloquear ésta |
| `preflightActionOf` | `lib/api.mjs:1205` | `toggle` → `assign-skill`/`enable-skill`; `create`/`import` → `create-skill`; `publish` → `publish-version`; el resto se busca en `ACTION_SOURCES` |
| `actionPreflight` | `lib/api.mjs:1228` | arma filas de fuente y la foto, y llama al preflight **sync puro**; no escribe |
| compuerta | `lib/api.mjs:2984` | se ejecuta **antes** de `const mutation = withState(...)` (`lib/api.mjs:3003`) |
| persistencia | `lib/state.mjs:661` (`saveState`) y `lib/state.mjs:823` (`withState`) | única escritura de `center.json`; `lib/materialize.mjs:47` escribe la vista materializada |
| preflight puro | `lib/preflight.mjs:21` (`REQUIRED`), `:34` (`OPTIONAL`), `:191` (`ownerFindings`), `:225` (`collisionFindings`), `:399` (decisión) | `block` > `warn` > `allow`; nunca escribe |

Regla de la compuerta (`lib/api.mjs:2984-3001`): `block` ⇒ 409 `preflight-blocked` con
`findings/reasons/evidence` y **cero** `withState`; `warn` ⇒ ejecuta y devuelve `findings`; `allow` ⇒
ejecuta. Sin foto de inventario ni fila de fuente, `create`/`publish` no fingen una decisión
(`actionPreflight` devuelve `null`, `lib/api.mjs:1249-1250`): la llamada núcleo heredada se ejecuta como antes,
mientras que HTTP y herramienta siempre traen foto o fila `skills-registry` (fail-closed honesto).

## 1. Las diez rutas

| # | Acción | Endpoint / herramienta | Función de dominio | Evidencia (origen) | REQUIRED / OPTIONAL | identityState | Colisiones que la afectan | Preflight → escritura | Fuente ausente |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `create` (create-skill) | `POST /api` `{action:'create'}`; tool `lifecode_skill_create` | `runAction` `case 'create'` (`lib/api.mjs:3005`); `createSkill` | `inventoryEvidence` en `index.js:638` y `toolEvidence` `index.js:483` | `state`,`manifest` / `skills-registry` | no aplica (skill, no proyecto) | `name-collision`, `ambiguous-identity`, proveedor dueño (`ownerFindings`) ⇒ **warn** si el nombre lo sirve otro proveedor | gate `:2984` → `withState` `:3003` → `saveState` `lib/state.mjs:661` | sin catálogo: `warn` `catalog-unverified` y escribe; `state`/`manifest` rotos: `block` |
| 2 | `import` | `POST /api` `{action:'import'}` | `case 'import'` (`lib/api.mjs:3277`): `scanExternalSkills` + `createSkill` | misma que create; el origen se lee, **nunca** se escribe | `state`,`manifest` / `skills-registry` | no aplica | igual que create | gate `:2984` → `withState` `:3003` | sin catálogo: `warn` y escribe; origen no escaneado ⇒ `not-scanned`; nunca `fs.write` sobre la ruta origen |
| 3 | `publish` (publish-version) | `POST /api` `{action:'publish'}` | `case 'publish'` (`lib/api.mjs:3073`) | `inventoryEvidence` (adaptador) | `state`,`manifest`,`skills-registry` / — | no aplica | `name-collision` por proveedor ⇒ **block** (`ownerFindings`, `lib/preflight.mjs:191`); colisiones conocidas ⇒ block/warn según severidad | gate `:2984` → `withState` `:3003` | sin catálogo ⇒ `block` `evidence-incomplete`; jamás «sin colisiones» sin foto |
| 4 | `toggle` (enable) | `POST /api` `{action:'toggle',payload:{enabled:true}}` | `case 'toggle'` (`lib/api.mjs:3114`) → `toggleAssignment` | foto del adaptador | `state`,`manifest` / `skills-registry` | `identity-conflict`/`unavailable` del proyecto bloquean (`PROJECT_ACTIONS`) | `assignment-shadowed` ⇒ **warn** | gate `:2984` → `withState` `:3003` | sin catálogo: `warn` (OPTIONAL); `manifest` roto ⇒ `block` |
| 5 | `toggle` (assign) | mismo endpoint con `enabled:false` | `case 'toggle'` | foto del adaptador | `state`,`manifest` / `skills-registry` | igual | `assignment-shadowed` ⇒ **warn** | gate `:2984` → `withState` `:3003` | igual |
| 6 | `materialize-project` | `POST /api` `{action:'materialize-project',projectId}` | `case 'materialize-project'` (`lib/api.mjs:3246`): `syncProject` (`lib/materialize.mjs:47`) | foto del adaptador + `materializedRoot(root)` | `state`,`manifest`,`skills-registry`,`filesystem-view` / — | `identity-conflict`/`unavailable` bloquean | `assignment-shadowed` ⇒ **block**; `name`/`content` relevantes ⇒ block | gate `:2984` → `withState` `:3003` | catálogo incompleto ⇒ `block` `evidence-incomplete`; **no se relaja** |
| 7 | `register-project` | `POST /api` `{action:'register-project',cwd}` | `case 'register-project'` (`lib/api.mjs:3178`): `ensureProject` + `writeCenterManifest` (`lib/api.mjs:848`) | `state`, `filesystem-project`, `workspace-registry`, `manifest` medidos en la compuerta | `state`,`filesystem-project` / `workspace-registry`,`manifest` | no aplica (alta) | `path-collision`/`identity-duplicate` del projectId ⇒ **block** | gate `:2984` → `withState` `:3003` → `writeCenterManifest` (`mkdir`+`writeFile` `wx`) | sin workspace-registry: `warn` `workspace-unlisted`; `filesystem-project` ausente ⇒ `block`; `manifest` rotó ⇒ `incomplete` |
| 8 | `adopt-project` | `POST /api` `{action:'adopt-project',projectId}` | `case 'adopt-project'` (`lib/api.mjs:3208`): lee manifiesto y ancla uuid sin crearlo | compuerta (`manifest`, `filesystem-project`) | `state`,`manifest`,`filesystem-project` / — | uuid anclado distinto ⇒ `identity-conflict` (409) | `identity-duplicate`/`path-collision` ⇒ block | gate `:2984` → `withState` `:3003` | manifiesto ausente/inválido ⇒ `not-adoptable`/`evidence-incomplete`; nunca crea manifiesto |
| 9 | `repair-manifest` | `POST /api` (contrato de identidad; ver §3) | `repairManifest` (`lib/api.mjs:2567`) dentro del bloque de identidad | `identityActionGate` (`lib/api.mjs:2530`), **no** `actionPreflight` | `state`,`manifest`,`filesystem-project` (mapa) / — | `identity-conflict` bloquea el gate de identidad | no aplica al manifiesto del proyecto | gate de identidad `:2530` → `repairManifest` `:2567` | manifiesto inválido ⇒ rechazo de identidad; no escribe si no puede reparar |
| 10 | `detach-project` | `POST /api` (contrato de identidad; ver §3) | `detachManifest` (`lib/api.mjs:2793`) | `identityActionGate` | `state`,`manifest`,`filesystem-project` (mapa) / — | igual | no aplica | gate de identidad `:2530` → `detachManifest` `:2793` | sin manifiesto ⇒ rechazo; no escribe si no hay nada que desvincular |

Notas de la tabla:

- `publish` y `create` comparten mapa de evidencia, pero **no** la severidad: publicar cambia la resolución
  del Host (block sin catálogo), crear es local y reversible (warn `catalog-unverified` sin catálogo).
  `import` hereda create tal cual.
- `materialize-project` no se relaja: su `filesystem-view` y `skills-registry` son REQUIRED.
- El `cwd` de `register-project` se valida con `trustedCwd` (`lib/api.mjs`, junto a
  `normalizeInventoryLimit`): sólo absoluta normalizada (unidad o UNC), si no 400 `invalid-cwd` antes de
  escribir.

## 2. Prueba de orden (evidencia real antes de cualquier escritura)

Test: `tests/r16-api.test.mjs` → «R16.1: el adaptador mide el catálogo ANTES de despachar las cinco
acciones con compuerta».

- Monta `applyPlugin` de `index.js` con un `ctx` mínimo y un `skills.snapshot` **espiado** que anota
  `fileDigest(centerFile(root))` en cada llamada.
- Despacha POST `create`, `publish`, `toggle`, `materialize-project`, `import` por la ruta real.
- Exige para cada uno `observed.length > 0` y que `observed[0]` sea el hash del almacén **antes** de la
  primera escritura: la foto se mide antes de que `runAction` toque `center.json`.
- Los ocho tests de política de `tests/r16-api.test.mjs` demuestran además `block` ⇒ 409 y hash del árbol
  del centro/la vista/proyecto sin cambios.

`node --test tests/r16-api.test.mjs` → **25/25 pass** (24 con la compuerta y evidencia + orden).

## 3. Consolidación de `scanExternalSkills` (D)

`lib/sources.mjs` ya no tiene una segunda detección con reglas propias:

- `legacyRoots` (`lib/sources.mjs:44`) se deriva de `skillRootsFor` de `lib/inventory.mjs` y conserva las
  etiquetas heredadas (`proyecto actual`, `biblioteca de usuario`, `compilador anterior`,
  `vista materializada`).
- `walkRoot` (`:94`) respeta los layouts centrales (depth 3 con buckets `approved|published|disabled`,
  depth 2, plano) y valida con `parseSkillFrontmatter` + `candidateFromSkillFile`, las mismas reglas del
  inventario.
- `scanExternalSkills` (`:158`) conserva el contrato público `{candidates, roots, errors, truncated}` y
  ahora acepta `materializedRoot`; todas las llamadas de `lib/api.mjs` (`:1764`, `:2493`, `:3280`) le pasan
  `dshHome`/`agentsHome`/`materializedRoot` resueltos por el adaptador: no queda `process.env.DSH_HOME`
  dentro de `lib/`, ni escritura sobre el origen (import sólo lee).
- Pruebas: `import` con catálogo ausente ⇒ 200 con `warn` y hash del fichero de origen intacto;
  `scanExternalSkills no atraviesa symlinks fuera de una raíz autorizada` (junction en caja temporal).

## 4. Hueco declarado (no silenciado)

La vista de identidad heredada del panel despacha `identity-adopt`, `repair` y `identity-unlink`, que
escriben el manifiesto **del proyecto** y pasan por `identityActionGate` (`lib/api.mjs:2530`), no por
`actionPreflight`. El contrato §6 de R16 no define endpoints HTTP `repair-manifest`/`detach-project`; los
nombres existen en `ACTION_SOURCES` para el día en que se cableen y hoy un POST con esos nombres pasaría el
gate y terminaría en `unknown-action` (200) sin escribir. Se deja explícito aquí para que el Lead decida si
esa vista heredada entra en el alcance de R16.2; no se ha tocado `client.js`.
