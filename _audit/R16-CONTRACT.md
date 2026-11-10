# R16 — Contrato de dominio, inventario y preflight

**Para quien implementa.** Este documento es normativo: lo que aquí dice `[SUPUESTO]` es diseño
propio y se puede cambiar con revisión; todo lo demás está medido contra el asar del Host y citado.
La arquitectura y la evidencia viven en [`R16-ARCHITECTURE.md`](R16-ARCHITECTURE.md).
`EX/` = `_audit/r16-arch/extracted/dsh/node_modules/@deepseek-ai/`.

**Regla de oro de R16:** no se inventa una API del Host. Si el dato no está, se devuelve
`null` + `reasons[]` + `confidence`, nunca un valor plausible.

---

## 1. Modelo de dominio de proyectos

### 1.1 Identidad (ya existe, no se toca)

- `projectId = projectIdFor(cwd)` = `<slugId(basename(cwdKey),24)>-<sha1(cwdKey).hex[0..8]>`
  (`lifecode-skill-center/lib/format.mjs` L71-77). Estable: renombrar el proyecto **no** lo mueve.
- `cwdKey(cwd)` = `normalizeCwd(cwd).toLowerCase()` (`lib/format.mjs` L52-65): `\`→`/`, colapsa `//`,
  sin barra final, minúsculas.
- Registro durable: `state.projects[projectId]` con
  `{id, name, cwd, createdAt, updatedAt, note}` + campos de identidad v3 copiados sólo si existen:
  `uuid, manifestSha256, manifestRegisteredAt, adoptedAt, detachedFrom, detachedAt, detachedSha256,
  originalUuid, forkedFrom, forkOperationId, forkedAt, forkPreviousManifestSha256, forkArchivedFile`
  (`lib/state.mjs` L180-210).
- Manifiesto: `<dshHome>/lifecode-skill-center/projects/<projectId>/manifest.json`,
  `MANIFEST_SCHEMA = 'lifecode-skill-center/project'`, `MANIFEST_SCHEMA_VERSION = 1`,
  `MANIFEST_FIELDS = ['schema','schemaVersion','projectId','registeredAt']`
  (`lib/manifest-ops.mjs` L24-28).
- **Ningún estado se persiste.** Los siete estados de §1.2 son una función pura de la observación.

### 1.2 Estados (exactos, mutuamente excluyentes)

| Estado | Condición de cálculo | Escritura |
|---|---|---|
| `identity-conflict` | Cualquiera: dos `state.projects` con el mismo `cwdKey`; `manifest.projectId !== projectId`; `project.uuid` y `manifest.uuid` presentes y distintos; `project.manifestSha256` presente y distinto del sha real del manifiesto; dos workspaces del Host con la misma ruta canónica. | **prohibida** |
| `unavailable` | El `cwd` no es un directorio accesible (`stat` falla o no es directorio) **o** `workspace.status() === 'missing-dir'` y no hay otro proyecto que cubra la ruta. | **prohibida** salvo `detach`/`repair` de libro |
| `partially-inspected` | La inspección no terminó: fuente `error`, timeout, límite de entradas, `snapshot().complete === false`, o lectura del almacén no escribible (`canWrite(integrity) === false`). | **prohibida** (fail-closed) |
| `external-managed` | Existe manifiesto válido en disco para `projectIdFor(cwd)` y **no** existe `state.projects[projectId]`. | prohibida hasta adoptar |
| `managed` | Registrado (`state.projects` + manifiesto coherente) y al menos un `warn` en la inspección (p.ej. registro v2 sin `uuid`, asignación a versión inexistente, sesiones sin contar). | permitida con `warn` |
| `healthy` | Registrado, identidad coherente y **cero** findings `warn`/`block`. | permitida |
| `discovered` | Workspace del Host disponible, sin registro y sin manifiesto. | prohibida hasta registrar |

**Precedencia de cálculo** (gana el primero que aplique):
`identity-conflict` → `unavailable` → `partially-inspected` → `external-managed` → `healthy` →
`managed` → `discovered`.

> `managed` no es «todo bien»: es «registrado con alguna salvedad». `healthy` es el subconjunto limpio.
> La existencia del registro se informa **aparte**, en `registration.present`, para que un
> `partially-inspected` no oculte que el proyecto está registrado.

### 1.3 Transiciones válidas

| Desde | Operación | A | Precondición | Evidencia que lo demuestra |
|---|---|---|---|---|
| `discovered` | `register-project` | `managed`/`healthy` | preflight `allow`/`warn`; `projectId` derivado del `cwd` del Host, nunca del cliente | manifiesto nuevo + `state.projects[id]` |
| `external-managed` | `adopt-project` | `healthy` | `manifest.projectId === projectId`; `uuid` válido; directorio accesible | manifiesto leído + `adoptedAt` |
| `managed` | `repair-manifest` / `assign` | `healthy` | preflight sin `block` | `manifestSha256` + `uuid` recalculados |
| `healthy` | `assign-skill` | `healthy` | preflight `allow`/`warn` | asignación en `state.assignments` |
| `healthy`/`managed` | `materialize-project` | igual | preflight `allow`; inventario `complete` | vista materializada + hash |
| `*` | `detach-project` | `discovered` | confirmación humana explícita (regla 7 del repo) | `detachedFrom`/`detachedSha256` |
| `discovered`/`managed`/`healthy` | `unavailable` | `unavailable` | — (es observación, no acción) | `stat` fallido |
| `*` | `identity-conflict` | `identity-conflict` | — (observación) | dos evidencias divergentes |

Operaciones autorizadas por estado:

```js
const ALLOWED = {
  'identity-conflict': ['read', 'inspect', 'detach-project'],
  'unavailable':       ['read', 'inspect', 'detach-project', 'repair-manifest'],
  'partially-inspected': ['read', 'inspect'],
  'external-managed':  ['read', 'inspect', 'adopt-project', 'detach-project'],
  'discovered':        ['read', 'inspect', 'register-project'],
  'managed':           ['read', 'inspect', 'register-project', 'repair-manifest', 'assign-skill',
                        'materialize-project', 'rename-project', 'detach-project'],
  'healthy':           ['read', 'inspect', 'assign-skill', 'materialize-project',
                        'rename-project', 'repair-manifest', 'detach-project'],
  // 'open-workspace' NO está en ninguna lista: es acción del cliente (ver §7)
};
```

### 1.4 DTOs

`ProjectSummary` (siempre completo, sin `undefined`; usa `null`):

```json
{
  "projectId": "plugins-dhs-a1b2c3d4",
  "name": "plugins-dhs",
  "cwd": "C:/xampp/htdocs/plugins-dhs",
  "canonicalPath": "c:/xampp/htdocs/plugins-dhs",
  "state": "healthy",
  "registration": {
    "present": true,
    "uuid": "0f6c2a9e-6a1f-4f0e-9a59-2c3e2b7f1d10",
    "manifestSha256": "9c1e...64hex...",
    "registeredAt": "2026-09-12T18:04:11.000Z",
    "adoptedAt": null
  },
  "workspace": {
    "workspaceId": "ws_7Kq2",
    "title": "plugins-dhs",
    "path": "C:/xampp/htdocs/plugins-dhs",
    "availability": "ok"
  },
  "inspection": { "status": "complete", "inspectedAt": "2026-11-09T17:28:03.000Z", "reason": "" },
  "counts": { "assigned": 4, "active": 3, "materialized": 3 },
  "reasons": []
}
```

Tipos y nulabilidad:

| Campo | Tipo | Nulo |
|---|---|---|
| `projectId` | string (patrón `<slug>-<8hex>`) | no |
| `name` | string (puede ser `''`) | no |
| `cwd` | string con `/`, sin barra final | no (puede ser `''` si el Host no lo dio) |
| `canonicalPath` | string minúsculas | no |
| `state` | enum §1.2 | no |
| `registration.present` | boolean | no |
| `registration.uuid` / `manifestSha256` / `registeredAt` / `adoptedAt` | string \| null | sí |
| `workspace.workspaceId` / `path` | string \| null | sí |
| `workspace.title` | string | no (`''`)
| `workspace.availability` | `'ok' \| 'missing-dir' \| 'unknown'` | no |
| `inspection.status` | `'complete' \| 'incomplete' \| 'not-run' \| 'failed'` | no |
| `inspection.inspectedAt` | ISO string \| null | sí |
| `counts.*` | entero ≥ 0 | no |
| `reasons` | string[] (es, para la persona) | no |

`ProjectDetail` = `ProjectSummary` + :

```json
{
  "sources": [{ "id": "skills-registry", "status": "complete", "reason": "" }],
  "identity": { "projectId": "...", "uuid": null, "manifestSha256": "...", "state": "match" },
  "assignments": [{ "skillId": "x", "version": "1.2.0", "enabled": true, "pinnedAt": null,
                    "updatedAt": "2026-10-01T10:00:00.000Z", "by": "human" }],
  "skills": [{ "skillId": "x", "name": "x", "assignedVersion": "1.2.0",
               "host": { "provider": "lifecode-skill-center", "path": "...", "source": "lifecode-skill-center" },
               "shadowed": false }],
  "sessions": { "count": 12, "archived": 0, "source": "workspace" },
  "collisions": [{ "code": "name-shadowed", "severity": "warn", "key": "x" }],
  "findings": []
}
```

- `identity.state`: `'match' | 'missing' | 'mismatch' | 'not-recorded'`.
- `sessions.source`: `'workspace'` (usa `workspace.sessionIds`) | `'persistence'` (agrupa
  `sessionPersistence.list()` por `header.cwd`) | `'none'` (el adaptador no aportó `sessionCount`).
  **Nunca** se suman las dos fuentes; con `'none'`, `sessions.count` es `null`, no `0`.
- `skills[].host`: `null` si el nombre no está en el catálogo del Host (no cargaría).

`DiscoveredProject` (workspace del Host sin cruzar con el almacén):

```json
{ "workspaceId": "ws_7Kq2", "title": "plugins-dhs", "path": "C:/xampp/htdocs/plugins-dhs",
  "canonicalPath": "c:/xampp/htdocs/plugins-dhs", "sessionCount": 12,
  "availability": "ok", "projectId": "plugins-dhs-a1b2c3d4", "state": "discovered" }
```

`projectId` se **calcula** aquí para que la UI pueda ofrecer «registrar» sin escribir; no implica registro.
`sessionCount` sale de `workspace.sessionIds.length` (el Host no expone otra cuenta) y es `null` si el
adaptador no pudo resolver el workspace (§5.4), nunca `0` por defecto.

---

## 2. Modelo de inventario de Skill

### 2.1 Separación de ejes (no colapsarlos nunca)

| Eje | Campo | Pregunta que responde |
|---|---|---|
| Propietario | `owner` | ¿Quién lo sirve? (`lifecode` \| `plugin` \| `filesystem` \| `bundled` \| `runtime`) |
| Origen | `origin` | ¿De qué raíz o contrato salió? (`project-dsh`, `user-dsh`, `plugin-provider`, …) |
| Ubicación | `location` | ¿Dónde está físicamente (o si es virtual)? |
| Ámbito | `scope` | ¿A qué proyecto/usuario aplica? |
| Asociación | `association` | ¿El Host lo cargaría? ¿Quién gana el nombre? |
| Ejecución | `execution` | `modelInvocable` / `userInvocable` |

`owner.provider` es el `provider` que devuelve `skills.snapshot()`; `owner.pluginEntryId` es la entrada
del loader **si** se pudo mapear (heurístico, ver §2.4). Son campos separados a propósito.

### 2.2 DTO `SkillInventoryEntry`

```json
{
  "key": "filesystem:project-dsh:c:/repo/.dsh/skills/foo",
  "name": "foo",
  "canonicalName": "foo",
  "description": "…",
  "whenToUse": null,
  "owner": { "kind": "filesystem", "provider": "filesystem", "pluginEntryId": null },
  "origin": { "kind": "project-dsh", "label": "project-dsh" },
  "location": { "kind": "directory", "path": "C:/repo/.dsh/skills/foo/SKILL.md",
                "directory": "C:/repo/.dsh/skills/foo", "rootId": "project-dsh:c:/repo" },
  "scope": { "kind": "project", "projectRoot": "C:/repo", "cwd": "C:/repo" },
  "association": { "loadedByHost": true, "provider": "filesystem", "path": "C:/repo/.dsh/skills/foo/SKILL.md",
                   "shadowedBy": null },
  "execution": { "modelInvocable": true, "userInvocable": true },
  "identity": { "uuid": null, "version": null, "contentSha256": "…", "manifestSha256": null },
  "confidence": "manifest",
  "reasons": []
}
```

Reglas de forma:
- `name` puede ser `null` (fichero sin frontmatter); `canonicalName` es `null` si `name` no pasa
  `isHostSkillName` (§3.1).
- `location.kind ∈ {'file','directory','virtual'}`. `virtual` ⇒ `path`/`directory` `null` y
  `confidence ∈ {'plugin-contract','local-registry'}`.
- `association.shadowedBy`: `null` si gana o si el Host no lo ve; si pierde,
  `{provider, path, source}` del ganador.
- `identity.uuid`/`version`: **sólo** de nuestro catálogo v3 (`state.skills[id].uuid` / `currentVersion`).
  El Host no tiene UUID ni versión (arquitectura §6.3). Nunca se rellena con un hash disfrazado.

### 2.3 Niveles de confianza y prioridad

De mayor a menor:

| Nivel | Significado measured | Requisito mínimo |
|---|---|---|
| `verified` | Host y disco coinciden: el ganador de `snapshot()` para ese nombre es nuestro proveedor **y** el `contentSha256` del fichero materializado coincide con el esperado por el manifiesto/asignación. | 2 evidencias independientes |
| `manifest` | `SKILL.md` con frontmatter válido (`name` + `description`) en una raíz conocida; el Host lo listó o la raíz es la canónica. | fichero + regla de raíz |
| `plugin-contract` | `snapshot()` lo lista, pero no hay fichero legible (proveedor virtual). | resumen del registro |
| `local-registry` | Existe en `state.skills` con `id` y versión, sin fichero materializado confirmado. | documento propio |
| `content-hash` | Fichero existe pero el frontmatter no se puede interpretar; identidad sólo por sha256. | bytes |
| `name-only` | Sólo hay nombre (de directorio o de un `provider`) sin descripción ni cuerpo. | 1 etiqueta |
| `unknown` | Sólo una ruta o un `source`; no se puede afirmar nada. | — |
| `ambiguous` | **Veredicto de grupo**, no de fila: dos evidencias independientes describen el mismo `canonicalName` o la misma ruta con propietarios/orígenes incompatibles. | — |

**Regla de prioridad:** la confianza de una fila es el **máximo nivel cuyos requisitos se cumplen**;
nunca se agrega por simpatía (dos `name-only` no hacen un `manifest`). Si dos filas reclaman el mismo
`canonicalName` con distinto `owner.kind`, `origin.kind` o `location.path` real, el grupo pasa a
`ambiguous` y **toda escritura que dependa de ese nombre se bloquea** (§4). `ambiguous` gana a
cualquier nivel de fila.

### 2.4 Dueño vs plugin (limitación declarada)

`snapshot()` da `provider` (string que el plugin elige, p.ej. `"filesystem"`, `"dsh-badge"`,
`"lifecode-skill-center"`). `ctx.loader.entries()` da `moduleName` (specifier del paquete) y `entryId`.
**No hay contrato que una ambos.** Por tanto:

- `owner.provider` se rellena siempre desde el registro (dato verificado).
- `owner.pluginEntryId` se rellena **sólo** si el `provider` casa de forma inequívoca con un
  `moduleName` conocido (tabla explícita y versionada, p.ej. `filesystem → @deepseek-ai/dsh-skill-filesystem`).
  Si no casa: `null` y `reasons: ["owner-plugin-unmapped"]`.
- La UI **no** debe mostrar «plugin X» si sólo hay heurística. `[SUPUESTO]` la tabla de mapeo.
- La evidencia del Host se pide siempre con `snapshot({ cwd })` **del proyecto observado** (§3.2): las
  raíces `project-dsh`/`project-agents` dependen de ese `cwd`, así que un snapshot sin `cwd` sólo ve la
  capa global y no sirve para afirmar nada sobre el proyecto.

---

## 3. Tipos de colisión y cómo se calculan

### 3.1 Normalización (alineada al cargador real)

```js
// idéntica a SKILL_NAME del registro (EX/dsh-skill/lib/index.js L17)
const HOST_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isHostSkillName(name) { return typeof name === 'string' && HOST_SKILL_NAME.test(name); }

// NUNCA iguala identidades: sólo sirve para comparar la MISMA cadena y detectar inválidos.
function canonicalSkillName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.normalize('NFKC').trim();     // sólo para medir, no para igualar
  return isHostSkillName(trimmed) ? trimmed : null; // el Host compara exacto
}
```

- **Nombres:** el merge del Host es por cadena exacta de `candidate.name`, y ese nombre debe cumplir
  `SKILL_NAME`. Mayúsculas, acentos, `_`, `.` o guiones dobles **no** son «el mismo nombre en otra
  forma»: son nombres que el Host rechaza (log `skill file <path> ignored: invalid skill name "<name>"`).
  Por eso `canonicalSkillName` devuelve `null` y el inventario emite `invalid-name` (`warn`), sin
  renombrar jamás. NFKC se aplica sólo para *diagnosticar* (comparar contra `slugId(raw)` y sugerir).
- **Rutas:** `cwdKey(normalizeCwd(p))` (minúsculas, `/`, sin barra final). Si se puede, comparar además
  `realpath`; si `realpath` falla ⇒ `unknown` y no se afirma igualdad.
- **UUID:** `String(u).trim().toLowerCase()`; para los nuestros exigir `isUuidV4` (`lib/manifest-ops.mjs`
  L44). Los ajenos se aceptan como cadena opaca comparada en minúsculas, con `confidence` menor.
- **Hashes:** `sha256Hex(bytes)` sobre los bytes exactos del fichero (sin normalizar saltos de línea ni
  Unicode), hex minúsculas.
- **Separadores:** sólo `/` en rutas canónicas. Nunca se comparan rutas con `\`.

### 3.2 Los seis tipos

| Código | Qué compara | Cálculo | Severidad |
|---|---|---|---|
| `identity-duplicate` | UUID | Agrupar entradas con `identity.uuid` no nulo; dos `projectId` distintos con el mismo uuid ⇒ colisión. En skills: mismo `uuid` en dos `skillId`. | `block` |
| `name-collision` | Nombre canónico | Agrupar por `canonicalName` no nulo; >1 fila con `owner.kind`/`origin.kind`/`location` distintos ⇒ `name-collision`. Si el Host lista ese nombre, el ganador es `association.provider` del ganador de `snapshot()`. | `warn` (si el ganador es nuestro y el resto es invisible) / `block` si dos filas nuestras reclaman el nombre |
| `path-collision` | Ruta canónica | Agrupar por `location.directory`/`manifest` resuelto con `cwdKey`; >1 fila con la misma ruta, o dos proyectos con el mismo `cwdKey`, o dos workspaces con la misma ruta. | `block` |
| `content-collision` | Hash | Agrupar por `identity.contentSha256`; mismo hash con `canonicalName` distinto ⇒ contenido duplicado bajo dos nombres. | `warn` |
| `assignment-shadowed` | Asignación | Para cada `assignment` habilitada: `snapshot()` contiene el nombre y su `provider !== 'lifecode-skill-center'` **o** `path !==` la ruta materializada esperada ⇒ el Host cargaría otro. | `block` para `materialize-project`; `warn` en lectura |
| `legacy-collision` | Legado | Filas bajo `<dshHome>/skill-compiler/projects` (el Host **no** las escanea, `EX/dsh-skill-filesystem`), manifiestos `.dsh` cuyo `projectId` no está en `state.projects`, y `.md` sueltos que duplican un `<dir>/SKILL.md`. | `warn` |

Cada colisión se emite como:

```json
{ "code": "assignment-shadowed", "severity": "block", "key": "x",
  "rows": [{ "key": "…", "owner": "filesystem", "location": "C:/repo/.dsh/skills/x/SKILL.md" }],
  "explanation": "El Host cargaría «x» desde filesystem (rank 100) y no la versión asignada.",
  "evidence": ["skills.snapshot({cwd})"] }
```

`name-collision` **no** se calcula sólo con nuestro escaneo: se confirma contra
`ctx.skills.snapshot({ cwd })`, la única evidencia de lo que el Host realmente carga
(`EX/dsh-skill/lib/index.js` L234). El `cwd` es **el del proyecto observado**, no el global ni el que
mande el cliente: las raíces `project-dsh`/`project-agents` del cargador dependen de él
(`EX/dsh-skill-filesystem/lib/index.js` L595-628). Sin `snapshot()` para ese `cwd` no hay veredicto:
`catalog-unverified` (`warn`, §4.2) — y si la acción lo exige, `evidence-incomplete` (`block`). Nunca
«sin colisiones».

**Un nombre inválido no es un nombre.** Si `isHostSkillName(raw)` es falso, la fila se emite con
`invalid-name` (`warn`) y `canonicalName: null`; **jamás** se compara con otro nombre ni se iguala
normalizando. Ejemplo: `"café"` y `"cafe" + U+0301` (NFD) son la misma cadena tras NFC/NFKC, pero el Host
rechaza ambas porque no cumplen `SKILL_NAME`: la normalización sirve para *explicar* el rechazo, no para
igualar identidades. Dos nombres que el Host sí distingue: `"pdf-tools"` (válido) y `"pdf--tools"`
(inválido por guion doble); el segundo no es «el mismo en otra forma», se ignora con
`skill file <path> ignored: invalid skill name "pdf--tools"`.

---

## 4. Contrato del motor de preflight

### 4.1 Función única

```js
preflight({
  action,        // enum PREFLIGHT_ACTIONS
  root,          // raíz del centro (para manifiestos y almacén)
  state,         // state normalizado (sólo lectura)
  inventory,     // { entries, sources, complete, generatedAt }
  collisions,    // { collisions, ambiguousNames }
  projectId,     // string | null
  skillId,       // string | null
  target,        // { path?, version? } | null
  now,           // ISO string inyectable (tests)
}) → {
  decision: 'allow' | 'warn' | 'block',
  findings: [{ code, severity: 'block'|'warn'|'info', message, subject? }],
  reasons: string[],                       // es, para la persona
  evidence: {
    generatedAt, preflightVersion: 1,
    sources: [{ id, status: 'complete'|'incomplete'|'unavailable'|'error', reason }],
    inventoryHash, collisionsHash, stateSha256
  }
}
```

### 4.2 Algoritmo (fail-closed donde importa)

1. `required = requiredSources(action)`; `optional = optionalSources(action)`.
2. Si alguna fuente de `required` no está `complete` ⇒ `decision = 'block'`, finding
   `evidence-incomplete` (severity `block`), `reasons` con el nombre de la fuente y su `reason`.
   **Nunca se degrada a `warn`.**
3. Si una fuente de `optional` no está disponible o no está completa ⇒ finding
   `catalog-unverified` (`warn`) y **no** se afirma «sin colisiones». No bloquea.
4. Si existe algún `ambiguousNames` que afecte al sujeto ⇒ `block` (`ambiguous-identity`).
5. Cualquier finding `block` ⇒ `block`. Si no, cualquier `warn` ⇒ `warn`. Si no ⇒ `allow`.
6. `allow` con `findings: []` es el único caso en que la operación puede escribir sin mostrar nada.

**Por qué REQUIRED/OPTIONAL y no todo fail-closed (medido en este repo):** si `workspace-registry` o
`skills-registry` fueran obligatorias para `register-project`/`assign-skill`, cualquier contexto sin esos
servicios (API pura, pruebas existentes, Host sin panel montado) pasaría a `block` y rompería un registro
legítimo por ruta. Fail-closed se reserva para donde la escritura puede pisar contenido ajeno; donde la
falta sólo impide confirmar el catálogo y la escritura es local y reversible, se avisa.

`PREFLIGHT_ACTIONS`, fuentes requeridas y opcionales (`[SUPUESTO]` el mapa, `verified` las fuentes):

```js
const REQUIRED = {
  'register-project':   ['state', 'filesystem-project'],
  'adopt-project':      ['state', 'manifest', 'filesystem-project'],
  'repair-manifest':    ['state', 'manifest', 'filesystem-project'],
  'detach-project':     ['state', 'manifest', 'filesystem-project'],
  'assign-skill':       ['state', 'manifest'],
  'enable-skill':       ['state', 'manifest'],
  'materialize-project':['state', 'manifest', 'skills-registry', 'filesystem-view'],
  'create-skill':       ['state', 'manifest'],
  'publish-version':    ['state', 'manifest'],
};

// No bloquean: su ausencia emite catalog-unverified (warn).
const OPTIONAL = {
  'register-project':   ['workspace-registry', 'manifest'], // manifiesto, si existe, se compara; si no, manifest-missing
  'assign-skill':       ['skills-registry'],                // disponible + assignment-shadowed ⇒ block
  'enable-skill':       ['skills-registry'],
};
// resto de acciones: []
```

- `materialize-project` **sí** exige `skills-registry`: escribir la vista materializada sin catálogo
  confirmado podría dejar ficheros que el Host no cargaría (o cargaría desde otro proveedor).
- `assign-skill`/`enable-skill` sin `skills-registry` escriben el registro local, pero el resultado **no**
  puede declararse «sin colisiones»: `catalog-unverified` y `association` del skill en `null`.
- `register-project`: `workspace-registry` es opcional porque la identidad sale del `cwd`; si el registro
  viene de un workspace, se adjunta `workspaceId`, y si no, `workspace: null` sin bloquear.

`SOURCE_IDS` (estables para la UI): `state`, `workspace-registry`, `skills-registry`, `loader`,
`filesystem-project`, `manifest`, `filesystem-view`, `sessions`.
Cada una se reporta con `{id, status, reason}`; `status` es del **hecho**, no del deseo:
`skills-registry: unavailable` cuando `ctx.get('skills')` no tiene `snapshot`.

### 4.3 Códigos de finding

| Código | Sev. | Cuándo |
|---|---|---|
| `evidence-incomplete` | block | fuente **requerida** no `complete` (§4.2) |
| `catalog-unverified` | warn | fuente **opcional** no disponible: el catálogo del Host no se pudo confirmar (§4.2) |
| `ambiguous-identity` | block | nombre/ruta con dos evidencias incompatibles |
| `identity-duplicate` | block | uuid repetido (§3.2) |
| `name-collision` | block/warn | nombre reclamado por dos filas (§3.2) |
| `path-collision` | block | misma ruta canónica |
| `assignment-shadowed` | block/warn | el Host cargaría otro proveedor |
| `content-collision` | warn | mismo sha256 con nombres distintos |
| `legacy-collision` | warn | raíz legacy o manifiesto huérfano |
| `invalid-name` | warn | nombre que el Host ignoraría |
| `project-not-registered` | info | discovered |
| `project-unavailable` | block | directorio ausente |
| `manifest-missing` | warn | registrado sin manifiesto |
| `manifest-mismatch` | block | sha/uuid no cuadran |
| `store-unreadable` | block | `canWrite(integrity) === false` |

---

## 5. Módulos nuevos y cambios mínimos

Todos los módulos son **puros** (sin importar Cordis) salvo el pegamento que recibe adaptadores.
Se prueban con `node --test`; el adaptador sólo resuelve servicios.

### 5.1 `lib/inventory.mjs`

```js
export const INVENTORY_VERSION = 1;
export const SOURCE_IDS = ['state','workspace-registry','skills-registry','loader',
                           'filesystem-project','manifest','filesystem-view','sessions'];

export function sourceDefinition({ id, dshHome, agentsHome, projectRoot, bundledDir, customDirs })
export function skillRootsFor({ cwd, dshHome, agentsHome, customDirs, bundledDir, projectRoot })
// → [{rootId, kind, dir, rank, source}]; ranks 100..600 del Host (EX/dsh-skill-filesystem);
//   projectRoot explícito o ancestro .git más cercano; sin .git, cwd
export function parseSkillFrontmatter(bytes)          // → {name,description,whenToUse,metadata,invocation} | {error}
export function entryFromCandidate(candidate, context)   // SkillSummary → SkillInventoryEntry
export function entryFromFile({ path, root, bytes, cwd, projectRoot }) // → SkillInventoryEntry
export function mergeHostWinners({ entries, snapshot })  // rellena association + shadowedBy
export function collectInventory({ adapters, root, cwd, state, now, limits })
/* adapters = {
     listSkills({ cwd })  → { skills, complete } | throw        // = ctx.skills.snapshot({ cwd })
     getLoaderEntries()   → [{ entryId, moduleName, enabled, fiberPhase }] | null
     readdir(dir)         → [{ name, isDirectory() }] | throw   // IMPRESCINDIBLE: profundidad 1
     stat(path)           → { isDirectory, size } | throw       // availability
     readFile(path)       → Buffer | throw                      // frontmatter + hashes
     realpath?(path)      → string | throw                      // opcional; sin él la igualdad de rutas = unknown
     loadState(root)      → estado normalizado | throw
   } */
// → { entries, sources, complete, generatedAt, warnings, truncated }
```

Reglas de `collectInventory`:
- Escanear las raíces de `skillRootsFor` con **la regla del Host**: profundidad 1,
  `<dir>/<nombre>/SKILL.md` y `<dir>/<nombre>.md`. No recursión libre (eso era el defecto de `sources.mjs`).
  Sin `adapters.readdir` esta regla **no se puede cumplir**: el inventario degrada a
  `sources[].status = 'incomplete'` en vez de caminar el árbol por su cuenta.
- La igualdad de rutas usa `adapters.realpath` cuando existe; si falta o falla, la relación queda
  `unknown` (no se afirma `path-collision`) y `filesystem-project` pasa a `incomplete`.
- Añadir las filas del catálogo propio (`state.skills` × `state.assignments`) con `confidence`
  `local-registry` o `verified`.
- Cruzar con `adapters.listSkills({cwd})` (que es `ctx.skills.snapshot({cwd})`) y marcar
  `association.loadedByHost`/`shadowedBy`.
- `complete: false` si cualquier adaptador lanza, si `snapshot.complete === false`, o si se supera
  `limits.maxEntries` (defecto 2000) / `limits.maxBytes` (defecto 4 MiB de frontmatter).
- Nunca lanza: degrada a `sources[].status = 'error'` y `complete:false`.

### 5.2 `lib/collisions.mjs`

```js
export const COLLISION_CODES = ['identity-duplicate','name-collision','path-collision',
                                'content-collision','assignment-shadowed','legacy-collision'];
export function canonicalSkillName(raw)
export function detectCollisions({ entries, projects, assignments, state })
// → { collisions, ambiguousNames: string[], byKey: Map<string, Collision[]> }
```

Orden de salida determinista: por `severity` (block primero), luego `code`, luego `key`.

### 5.3 `lib/preflight.mjs`

```js
export const PREFLIGHT_VERSION = 1;
export const PREFLIGHT_ACTIONS = Object.keys(REQUIRED);
export function requiredSources(action)   // → string[] (bloquean)
export function optionalSources(action)   // → string[] (sólo catalog-unverified)
export function preflight(input)   // firma y salida en §4.1; puro, sin E/S
```

### 5.4 `lib/projects.mjs`

```js
export const PROJECT_STATES = ['discovered','external-managed','managed','healthy',
                               'unavailable','identity-conflict','partially-inspected'];
export function projectObservation({ workspace, record, manifest, availability, inspection, sessions })
export function classifyProject(observation)        // → {state, reasons, findings}
export function allowedOperations(state)            // → string[]

// Puros y SÍNCRONOS: reciben los workspaces YA resueltos por el adaptador.
export function buildProjectsPayload({ workspaces, state, hostCwd, inventory, sources, now })
// → { sources, projects, discovered, current, summary, generatedAt, complete }
export function buildProjectDetail({ projectId, workspaces, state, inventory, sources, now })
// workspaces: [{ workspaceId, title, path, sessionCount: number|null, status: 'ok'|'missing-dir' }]
// sessionCount = workspace.sessionIds.length, resuelto por el adaptador (o null si no lo dio).
```

**Regla de pureza:** el módulo puro no puede `await` nada. `registry.list()` es síncrono pero
`workspace.status()` es `Promise`, así que el adaptador (`index.js`/`api.mjs`) resuelve
`list()` + `await Promise.all(...status())` y pasa el array ya materializado. Igual para sesiones: el
conteo sale de `workspaces[].sessionCount`; si el adaptador no lo dio,
`sessions = { count: null, archived: 0, source: 'none' }` — **nunca un 0 inventado**.

`classifyProject` implementa la tabla §1.2 y la precedencia; es la **única** fuente del campo `state`
(la API y la UI no lo recalculan).

### 5.5 Cambios mínimos en ficheros existentes

| Fichero | Cambio | Por qué |
|---|---|---|
| `lib/api.mjs` | añadir `inventoryPayload({root, registry, skills, loader, hostCwd, now})` y `projectsPayload(...)`; despachar `route === 'inventory'` / `route === 'projects'`; en `handleApiRequest`, ejecutar `preflight()` antes de `register-project`, `adopt-project`, `assign/enable` y `materialize`; devolver `409` con `findings` cuando `decision === 'block'`. | el despacho ya es único (`handleApiRequest`) y las acciones ya existen; sólo se les pone puerta |
| `index.js` | añadir `resolveSkillsRegistry(ctx)`, `resolveLoader(ctx)`, `resolveSessions(ctx)` con el mismo patrón perezoso que `resolveWorkspaceRegistry` (L328-335) y pasarlos a los payloads. Registrar nada nuevo en `webServer` (la ruta es `kind:'prefix'`, L481). | mantener el adaptador delgado y no cachear `undefined` |
| `lib/state.mjs` | **sin cambios de esquema**. Sólo exportar `PROJECT_IDENTITY_FIELDS` si hace falta reutilizarlo. | los campos v3 ya existen (L180-210); R16 no añade dato durable |
| `lib/sources.mjs` | deprecar `scanExternalSkills` a favor de `inventory.mjs`; conservar la export con aviso para no romper pruebas | hoy ve de más y de menos (arquitectura §2.3) |
| `lib/workspaces.mjs` | no se borra: `workspacesPayload` pasa a ser alias de `projectsPayload` con `apiVersion` 1 y `deprecated: true` | compatibilidad del panel actual |

**Compatibilidad:** `GET /api/workspaces` sigue devolviendo la forma actual (`workspaces`, `managed`,
`current`, `summary`, `identity`). Los campos nuevos son **aditivos**. Cualquier consumidor que ignore
`state`/`sources` sigue funcionando.

---

## 6. Contrato HTTP

Prefijo: `/lifecode-skill-center/api` (`lib/api.mjs:112`). Toda respuesta lleva `ok`, y si es correcta
`apiVersion` + `generatedAt`. Errores: `{ok:false, code, message, requestId}` (patrón ya usado en
`index.js` L395-396). Desde R16.2 el contrato es versionado de forma **aditiva**: `apiVersion` sigue
siendo `1` y las respuestas de datos añaden `contractVersion: 2`; el handshake se documenta en §6.5.

### 6.1 `GET /api/inventory?cwd=<path>&limit=<n>`

- `cwd` opcional: si falta, se usa `resolveHostCwd(ctx)`; **nunca** una ruta del cliente como identidad
  de proyecto (sólo como ámbito de lectura).
- 200:

```json
{ "ok": true, "apiVersion": 1, "generatedAt": "2026-11-09T17:28:03.000Z",
  "complete": true, "truncated": false,
  "sources": [{ "id": "skills-registry", "status": "complete", "reason": "" }],
  "entries": [ /* SkillInventoryEntry[] */ ],
  "collisions": [ /* §3.2 */ ],
  "summary": { "total": 14, "byOwner": { "filesystem": 9, "lifecode": 4, "plugin": 1 },
               "shadowed": 1, "ambiguous": 0, "invalidNames": 0 } }
```

- 503 `skills-registry-unavailable` si `ctx.get('skills')?.snapshot` no existe (el inventario sin el
  catálogo del Host no es evidencia). 409 `store-unreadable`. 400 `bad-request` si `limit` no es entero.

### 6.2 `GET /api/projects?cwd=<path>`

- 200: `{ok, apiVersion, generatedAt, readable, complete, sources, discovered: [DiscoveredProject],
  projects: [ProjectSummary], current, summary}`.
- `current = {cwd, workspaceId, workspaceTitle, projectId, confidence: 'session'|'default'|'unknown', via}`.
  `confidence: 'default'` cuando `workingDirectory.get()` devolvió su `defaultDirectory` y no una
  decisión de sesión (`EX/dsh-working-directory/lib/index.js` L80-82).
- 503 `workspace-registry-unavailable` si `ctx.get('workspaceRegistry')?.list` no existe.

### 6.3 `POST /api` (JSON `{action, ...}`)

| `action` | Cuerpo | Efecto | Respuestas |
|---|---|---|---|
| `inspect-project` | `{projectId}` | **sólo lectura**: detalle + fuentes + colisiones | 200 `ProjectDetail`; 404 `project-not-found`; 409 `evidence-incomplete` (con `sources`) |
| `register-project` | `{cwd?, projectId?, name?}` | escribe manifiesto + registro, **sólo** si preflight ≠ block | 200 `{ok, project: ProjectSummary, findings}`; 409 `preflight-blocked` / `evidence-incomplete` / `project-exists`; 400 `invalid-cwd` |
| `adopt-project` | `{projectId}` | adopta manifiesto existente | 200 `{ok, project}`; 409 `not-adoptable` |
| `materialize-project` | `{projectId}` | sincroniza la vista | 200 `{ok, materialized: n, findings}`; 409 `preflight-blocked` |
| `open-workspace` | — | **NO EXISTE** | 501 `host-action-unsupported` con `{clientAction:'uiWorkspace.openWorkspace', workspaceId}` |

`register-project` no acepta `cwd` del cliente cuando hay sesión viva: se usa `hostCwd` y se rechaza
(`400 identity-from-client`) si el cuerpo intenta imponer otra ruta. La regla ya está escrita en
`lib/workspaces.mjs` L17 («Ningún valor del cliente decide identidad»).

### 6.4 Códigos de error (cerrados)

| HTTP | `code` | Significado |
|---|---|---|
| 400 | `bad-request` | cuerpo/params inválidos |
| 400 | `invalid-cwd` / `invalid-id` / `identity-from-client` | ruta o id mal formados, o identidad impuesta por el cliente |
| 401/403 | `unauthorized` / `cross-origin` | puerta del Host (ya existente, `index.js` L409-424) |
| 404 | `not-found` / `project-not-found` / `skill-not-found` | ruta o entidad ausente |
| 405 | `method-not-allowed` | verbo no admitido |
| 409 | `store-unreadable` | almacén ilegible: no se escribe (`unreadableResult`, `api.mjs` L399) |
| 409 | `preflight-blocked` | preflight `block`; incluye `findings[]` |
| 409 | `evidence-incomplete` | falta evidencia requerida; incluye `sources[]` |
| 409 | `identity-conflict` / `project-exists` / `not-adoptable` | estado incompatible |
| 501 | `host-action-unsupported` | el Host no ofrece la capacidad (§7) |
| 503 | `workspace-registry-unavailable` / `skills-registry-unavailable` / `loader-unavailable` | servicio del Host ausente |
| 500 | `internal` | fallo inesperado (se registra y se dice) |

### 6.5 Handshake de capacidades y contrato versionado (R16.2)

R16.1 estrenó `/api/projects` y `/api/inventory`, pero el panel no podía saber con qué backend hablaba: el
proceso DSH conserva el módulo servidor evaluado al arrancar y sirve el bundle cliente por revisión desde
disco. El estado mixto produjo 404 en las rutas nuevas y un fallback heredado activado por heurística.
R16.2 cierra el hueco con un contrato versionado aditivo (`API_CONTRACT_VERSION = 2`,
`lib/api.mjs:89`; `apiVersion` sigue en `1`, `lib/api.mjs:82`) y un handshake servido en el mismo prefijo
y por el mismo registro que el resto de la API (`index.js:722`).

**`GET /api/capabilities`** (también `HEAD`):

- Se sirve **antes de la admisión** y antes del 503 por falta de `connection`; es la segunda y última
  superficie sin credencial, después de `/health` (`index.js:562-589`). Motivo: si quedara detrás de la
  puerta, un 401/503 sería indistinguible de un backend antiguo.
- Es un documento **estático**: no lee almacén, filesystem ni servicios, y no devuelve rutas de disco,
  recuentos ni datos del usuario (`lib/api.mjs:552-558`; `index.js:570-576`).
- Forma (`lib/api.mjs:560-587`):

```json
{ "ok": true, "kind": "capabilities",
  "plugin": { "id": "lifecode-skill-center", "version": "<package.json>" },
  "apiVersion": 1, "contractVersion": 2, "implementation": "r16.2",
  "contract": { "name": "lifecode-skill-center/api",
                "prefix": "/lifecode-skill-center/api",
                "minClientContract": 2, "maxClientContract": 2 },
  "capabilities": ["capabilities","projects","inventory","inspect-project",
                   "register-project","adopt-project","materialize-project",
                   "preflight","legacy-workspaces"],
  "routes": { "GET /api/capabilities": "capabilities",
              "GET /api/workspaces": "legacy-workspaces",
              "GET /api/inventory": "inventory", "GET /api/projects": "projects",
              "POST /api#inspect-project": "inspect-project",
              "POST /api#register-project": "register-project",
              "POST /api#adopt-project": "adopt-project",
              "POST /api#materialize-project": "materialize-project" },
  "generatedAt": "<ISO>" }
```

- `capabilities[]` es la lista cerrada `CAPABILITY_IDS` (`lib/api.mjs:92-102`). Las acciones POST se
  identifican como `POST /api#<action>`.
- La versión del plugin se lee de `package.json`; si no se puede leer viaja vacía y el handshake sigue
  respondiendo (`index.js:155-171`).

**Aditividad del contrato.** `GET /api/inventory` devuelve `contractVersion: 2` (`lib/api.mjs:1161`);
`GET /api/projects` también (`lib/api.mjs:1552`) y conserva `identity` para el panel anterior
(`lib/api.mjs:1561-1562`). Ninguna ruta ni campo previo se elimina: un cliente R16.1 sigue leyendo las
rutas que ya conocía. `/api/workspaces` incorpora la marca `deprecated` (contrato nuevo); el cliente viejo
la ignora.

**Compatibilidad cliente/backend.** El cliente exige `contractVersion >= 2` **y** que
`capabilities[]` incluya `projects` e `inventory` para entrar en `compatible-r16`
(`client.js:5347-5353`). Los cinco estados posibles son:

| Estado | Condición | Efecto |
|---|---|---|
| `compatible-r16` | handshake válido, contrato ≥ 2, publica `projects` + `inventory` | rutas nuevas y panel completo |
| `legacy-compatible` | `/capabilities` 404/405 **y** `/workspaces` con señal positiva | aviso ámbar; no se consultan rutas nuevas |
| `backend-incompatible` | handshake inválido/versión menor, o 404/405 sin señal positiva | banner rojo; operaciones R16 detenidas |
| `backend-unavailable` | red, 5xx o timeout | banner rojo con reintento |
| `authentication-error` | 401/403 en handshake o en rutas de datos | banner de autorización; sin recuentos |

La señal positiva de legacy es obligatoria: `/api/workspaces` con `ok:true`, `workspaces[]` y `managed[]`
válidos, filas con `title` o `path`, y **ausencia** de `deprecated` en el documento y de `state` en cada
fila (`client.js:2138-2149`). **Un 404 de `/api/projects` no es señal de legacy**: el despacho viejo
responde 404 tanto a una ruta que no conoce (código `not-found`, `lib/api.mjs:479-481`) como a una entidad
inexistente (código `project-not-found`, `lib/api.mjs:125`). La compatibilidad se decide sólo por el
handshake y por la señal positiva.

En modo no compatible el cliente **no llama** a las rutas nuevas (`client.js:5401-5424`) y deshabilita las
acciones R16 con motivo (`client.js:2154-2156`, texto `projects.compat.actions.blocked`). El banner de
compatibilidad es el único sitio donde se explica el modo y en legacy no produce banners rojos de las
rutas nuevas (`client.js:3061-3108`). Un 401/403 en las rutas de datos dentro de `compatible-r16`
reclasifica a `authentication-error` (`client.js:5430-5446`).

**Errores relacionados** (además de §6.4): 503 `auth-unavailable` cuando el harness no ofrece
`connection` o `admit` (`index.js:253-301`); el handshake sigue respondiendo 200. 403 `cross-origin` para
un `Origin` ajeno (`index.js:591-601`). 401 `unauthorized` / 403 `forbidden` cuando la admisión rechaza
(`index.js:282-292`). 405 `method` para verbos no admitidos (`lib/api.mjs:733-735`). El 404 de ruta
conserva el mensaje «esa ruta no es de la API (<prefijo>)».

**Trazabilidad.** Detalle completo en `_audit/R16.2-ROUTING-CONTRACT.md`; el ciclo de vida que motiva el
handshake, en `_audit/R16.2-LIFECYCLE.md`; aceptación viva, en `_audit/R16.2-ACCEPTANCE.md`. Pruebas:
`tests/r16-routing.test.mjs:134-396` (capabilities por la ruta registrada, 404 de ruta, admisión, HEAD) y
`tests/r16-runtime.test.mjs:152-430` (una sola ruta prefix, dos versiones, 404 ruta ≠ entidad,
concurrencia); compatibilidad de cliente en `tests/r16-ui.test.mjs:1233-1368`.

---

## 7. Operaciones bloqueadas y textos exactos de UI

| Operación | Estado | Vía real | Texto es | Texto en |
|---|---|---|---|---|
| Abrir un workspace desde el Host o la API | **BLOQUEADA** | ninguna; sólo el panel con `ctx.uiWorkspace.openWorkspace(id)` | «Abrir un workspace sólo puede hacerlo el panel: el Host no expone esa acción. Usa «Abrir» en la ficha, que abre o reutiliza una sesión en blanco de ese workspace.» | “Opening a workspace is panel-only: the Host exposes no such action. Use “Open” on the card, which opens or reuses that workspace’s blank session.” |
| Abrir un workspace sin UI montada | **BLOQUEADA** | detectar `typeof ctx?.uiWorkspace?.openWorkspace !== 'function'` | «Este harness no tiene el panel de workspaces cargado: no puedo abrirlo desde aquí.» | “This harness has no workspace panel loaded, so it cannot be opened from here.” |
| Enumerar proveedores de skills registrados | **BLOQUEADA** | no hay API (`skills` sólo expone register/list/snapshot/get) | «El registro de skills no publica la lista de proveedores; sólo puedo decir qué proveedor sirve cada nombre que el Host carga.» | “The skill registry does not publish its provider list; it can only report which provider serves each name the Host loads.” |
| Ver un skill sombreado (perdedor del merge) | **BLOQUEADA por el Host** | sólo se ve si está en disco; el Host lo oculta (`README` L140) | «Esta skill no aparece en el catálogo del Host: la sirve otro proveedor con más prioridad. El motivo exacto no es consultable; se muestra lo que hay en disco.» | “This skill is absent from the Host catalog: another provider outranks it. The exact reason is not queryable; what is on disk is shown instead.” |
| Mapear proveedor → plugin instalado | **PARCIAL / heurística** | `loader.entries()` + tabla de mapeo | «El dueño del skill es el proveedor «{provider}». No puedo afirmar de qué plugin instalado viene sin una tabla de equivalencias.» | “The skill is owned by provider “{provider}”. Its installed plugin cannot be asserted without an equivalence table.” |
| Leer UUID/versión de un skill del Host | **NO EXISTE** | el cargador no tiene UUID ni versión | «El Host identifica un skill por su nombre y su ruta; el UUID y la versión son de esta biblioteca, no del cargador.» | “The Host identifies a skill by name and path; the UUID and version belong to this library, not to the loader.” |
| Contar sesiones por proyecto con exactitud | **PARCIAL** | `workspace.sessionIds` o `sessionPersistence.list()` (no paginado) | «El conteo sale de {fuente}. El Host no da un total exacto por proyecto; «cd» dentro de una sesión puede desviarlo.» | “The count comes from {source}. The Host provides no exact per-project total; a session `cd` can skew it.” |
| Escribir con evidencia incompleta | **BLOQUEADA** | `preflight` `decision:'block'` | «No se escribió nada: la inspección no pudo completarse ({reason}).» | “Nothing was written: inspection could not complete ({reason}).” |

Reglas de presentación:
- Todo `block` muestra `reasons[]` del preflight, no un mensaje genérico.
- `warn` muestra la operación permitida **y** la lista de `findings` con su `code`.
- `null` nunca se pinta como «0», «—» o «desconocido» sin decirlo: `availability:'unknown'` ⇒
  «no se pudo comprobar», `sessions.count:null` ⇒ «no contado».
- La UI **no** ofrece «Abrir» si `workspace.workspaceId === null` (no hay nada que abrir).

---

## Apéndice A — Trazabilidad

| Afirmación | Fuente |
|---|---|
| `workspaceRegistry.list()` síncrono; sin `open/focus/activate` | `EX/dsh-workspace/lib/index.js` (39257 B) |
| item `{id,path,title,createdAt,updatedAt,sessionIds,status()}` | `EX/dsh-workspace/lib/types/entity.js` (156 líneas) |
| `uiWorkspace.openWorkspace(id)` abre sesión blank | `EX/dsh-client-ui-workspace/lib/client.js` L1382 + `README.md` L86 |
| `SKILL_NAME` kebab-case ASCII | `EX/dsh-skill/lib/index.js` L17 |
| merge por capa + rank + providerOrder + first-wins | `EX/dsh-skill/lib/index.js` L298-325, L520 |
| sin API de proveedores ni de sombreados | `EX/dsh-skill/README.md` L139-140 |
| raíces/ranks y profundidad 1 del cargador | `EX/dsh-skill-filesystem/lib/index.js` + `README.md` |
| sin UUID ni versión en frontmatter | `EX/dsh-skill-filesystem/lib/index.js` `parseSkillFile` |
| `pluginInventory` Remote-only | `EX/dsh-host-plugin-inventory/lib/index.js` |
| `ctx.loader.entries()` real pero no documentado | `EX/cordis-plugin-loader/lib/index.js` L216-221, L726 |
| `workingDirectory.get(session)` sin E/S | `EX/dsh-working-directory/lib/index.js` L80-82 |
| `list()` de sesiones no paginado | `EX/dsh-session-persistence/README.md` «Known Limitations» |
| precedencia `$DSH_HOME` y `~/.agents` | `EX/dsh-home-paths/README.md` L34-52 |
| id de proyecto y `cwdKey` | `lifecode-skill-center/lib/format.mjs` L52-77 |
| campos v3 y normalización | `lifecode-skill-center/lib/state.mjs` L124-224 |
| manifiesto y operaciones | `lifecode-skill-center/lib/manifest-ops.mjs` L24-28 |
| rutas/acciones HTTP actuales | `lifecode-skill-center/lib/api.mjs` L85, L386-391, L665-713 |

## Apéndice B — Cómo reproducir la extracción

```powershell
cd C:\xampp\htdocs\plugins-dhs
node _audit/r16-arch/extract.mjs dsh-workspace dsh-skill dsh-skill-filesystem `
  dsh-host-plugin-inventory cordis-plugin-loader dsh-client-ui-workspace `
  dsh-working-directory dsh-session-persistence dsh-home-paths dsh-skill-badge
```

El extractor casa por `entry.path.includes('/<paquete>/')`: hay que pasar nombres exactos
(`dsh-session` no extrae `dsh-session-persistence`).

---

## Enmienda E1 — Raíces observables fuera del cargador (2026-11-09, Lead)

Motivo: el censo empírico de esta máquina (`_audit/r16-sources-inventory.md`, 244 `SKILL.md`
medidos en 12 fuentes) demuestra que §5.1, tal como quedó escrita, sólo espeja las raíces del Host
y a profundidad 1; con eso el inventario perdería 85 de las 190 skills gestionadas reales y no
podría responder «¿qué Skills tiene asociadas cada proyecto?» para las del compilador. Esta
enmienda **no cambia firmas ni el resto del contrato**: amplía `skillRootsFor` y las reglas de
`collectInventory` sobre raíces que el Host no escanea.

### Raíces añadidas (además de las del Host, que siguen a profundidad 1)

| `rootId` | `dir` | `kind` | `hostScanned` | `layout` | `owner` |
|---|---|---|---|---|---|
| `compiler-projects` | `<dshHome>/skill-compiler/projects` | `legacy` | `false` | profundidad 3, `<project>/<bucket>/<skill>/SKILL.md`; `buckets.live=['approved','published','disabled']`, `buckets.history=['superseded']`, `skipDirs=['upstream']` | `filesystem` |
| `compiler-global` | `<dshHome>/skill-compiler/global` | `legacy` | `false` | profundidad 1 | `filesystem` |
| `materialized` | `<materializedRoot>` | `derived` | `false` | profundidad 2, `<projectId>/<skillId>/SKILL.md`; identidad por `manifest.json` | `lifecode` |

Fuentes **declaradas y no inspeccionadas** (nunca «vacías»): `hermes-legacy`
(`%LOCALAPPDATA%/hermes/skills`, fuera de `DSH_HOME` ⇒ `status:'unavailable'`,
`reason:'outside-dsh-home'`, `found:null`) y `builtin-asar` (las 12 builtin sólo se ven por
`snapshot()` con `contentSha256:null` porque el contenedor es opaco).

### Reglas

1. `collectInventory` sólo hace `readdir` de subdirectorios en los `layout` declarados; para el
   resto, la profundidad 1 estricta del Host.
2. Entradas de raíces `hostScanned:false` ⇒ `association.loadedByHost:false`, salvo que
   `snapshot({cwd})` contenga el mismo `name` **y** `path` (entonces `true`; confianza `verified`
   si además el hash casa). `origin.kind` = `'skill-compiler'` | `'materialized'`.
3. `superseded/` y `upstream/` **no son entradas**: se cuentan en `sources[].history` y no
   participan en colisiones. El nombre que se repite entre `approved/` y `superseded/` es
   historia de versiones (23 grupos reales), no `content-collision`.
4. `status` de una raíz: `'complete'` si `readdir` respondió, con `present:false, found:0` cuando
   el directorio no existe (ENOENT **no** es error); `'error'` sólo en fallo real. Tope por raíz
   500 entradas y 4 MiB de frontmatter global.
5. `metadata.dsh.*` / `metadata.hermes.*` del frontmatter son **procedencia** (`origin.label`),
   nunca prueba de propiedad. En esta máquina hay **0 UUID**: `identity.uuid` sólo puede venir del
   catálogo v3 propio. `checksum` del centro = sha256 del **cuerpo** truncado a 12 hex; no es el
   hash del fichero materializado (el render no lo reproduce; la identidad la sostiene
   `manifest.json`).

### Consecuencias observables (para pruebas de integración simulada)

Con `dshHome` real y `cwd` = repo, las entradas observables son ≈ 27 de usuario + 83 de
`compiler-projects` + 2 de `compiler-global` + 2 materializadas + 12 builtin por `snapshot()`, y la
mayoría de los `name` repetidos entre fuentes son divergencias legítimas de procedencia (9 grupos
medidos) o historia (23). Los tests propios deben usar fixtures, nunca rutas reales.
