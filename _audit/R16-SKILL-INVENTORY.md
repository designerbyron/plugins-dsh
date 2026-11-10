# R16 · Inventario global de Skills

| Campo | Valor |
|---|---|
| Ronda | R16 — inventario con procedencia, confianza y límites declarados |
| Fecha de redacción | 2026-11-09 |
| Núcleo | `lifecode-skill-center/lib/inventory.mjs` (1134 líneas) |
| Contrato | `_audit/R16-CONTRACT.md` §2 y Enmienda E1 (`:664-710`) |
| Censo de referencia | `_audit/r16-sources-inventory.md` + `_audit/r16-sources/20-skills.json` (244 entradas) |

El inventario no «adivina» qué skills existen: recorre fuentes con un ranking declarado, lee lo que
puede leer, marca lo que no y **nunca convierte una ausencia en un cero**. Este informe describe las
fuentes reales, el modelo de entrada, la escala de confianza y las limitaciones del Host.

---

## 1. Fuentes reales

`skillRootsFor` construye la lista ordenada por `rank` (`lib/inventory.mjs:115-254`). Las raíces del
cargador del Host y las de la Enmienda E1 conviven en la misma tabla:

| `source` | Rank | Ruta | Layout / regla |
|---|---|---|---|
| `project-dsh` | 100 | `<proyecto>/.dsh/skills` | profundidad 1 |
| `project-agents` | 200 | `<proyecto>/.agents/skills` | profundidad 1 |
| `custom` | 300 | directorios configurados | profundidad 1 |
| `user-dsh` | 400 | `<dshHome>/skills` | profundidad 1; salta `.system` |
| `user-agents` | 500 | `<agentsHome>/skills` | profundidad 1 |
| `bundled` | 600 | directorio empaquetado del Host | profundidad 1 |
| `compiler-projects` | 700 | `<dshHome>/skill-compiler/projects` | profundidad 3: `<proyecto>/<bucket>/<skill>/SKILL.md` |
| `compiler-global` | 701 | `<dshHome>/skill-compiler/global` | profundidad 1 |
| `materialized` | 702 | `<materializedRoot>` | profundidad 2: `<projectId>/<skillId>/SKILL.md` |
| `hermes-legacy` | — | `%LOCALAPPDATA%/hermes/skills` | **declarada fuera de `DSH_HOME`**: `unavailable`, `reason: outside-dsh-home`, `found: null` |
| `builtin-asar` | — | contenedor del Host | **opaca**: `unavailable`, `reason: opaque-container`, `found: null` |

Rankings en `lib/inventory.mjs:53-60`; fuentes declaradas no legibles en `lib/inventory.mjs:66-83`.
Los buckets vivos del compilador son `approved`, `published` y `disabled`; `superseded` es
**historia** y no genera entradas (`lib/inventory.mjs:115-254`).

## 2. Qué se lee y qué no

- **Sí** se leen `SKILL.md` de profundidad 1 (`<dir>/<nombre>/SKILL.md` y `<dir>/<nombre>.md`) y los
  layouts declarados por E1 (`lib/inventory.mjs:656-806`). No hay recursión en las raíces del Host.
- **No** se atraviesan symlinks ni junctions: se detectan con `dirent`, `lstat` y `realpath` y se
  descartan (`lib/inventory.mjs:571-591`; prueba `tests/r16-domain.test.mjs:300-330`).
- **No** se lee `hermes-legacy` fuera de `DSH_HOME`; se informa como fuente no disponible, con
  `found: null`, no como 0 (`lib/inventory.mjs:66-83`).
- **No** se lee el contenido de `builtin-asar`: 12 skills builtin se conocen sólo por el snapshot, con
  `contentSha256: null` y confianza de contrato de plugin.
- **No** se cuentan como entradas las 23 historias `approved`/`superseded` del compilador (misma
  carpeta de proyecto, versiones antiguas): son `sources[].history`, no colisiones.
- **Sí** se lee el `manifest.json` de la vista materializada para asignar `projectId` y versión
  (`lib/inventory.mjs:593-606`).

Topes: 2000 entradas, 4 MiB de frontmatter por lectura y 500 entradas por raíz
(`lib/inventory.mjs:51`). Al truncar se marca `truncated: true` y se emite el warning
`inventory-truncated`; el corte por raíz no expone un flag propio (**no verificado** si el contrato
exige señalarlo: no encontré esa bandera en el código).

## 3. Modelo `SkillInventoryEntry`: ejes separados

La entrada no mezcla «de quién es» con «dónde está» ni con «quién la cargó». Campos y origen
(`lib/inventory.mjs:340-392` y `:413-457`):

| Eje | Campos | Regla |
|---|---|---|
| `owner` | `kind`, `provider`, `pluginEntryId` | `provider` sale del registro de raíces; `pluginEntryId` es **siempre `null`** en esta implementación (`:367`, `:429`, `:1110`) |
| `origin` | `kind`, `label` | `legacy`→`skill-compiler`, `derived`→`materialized`, `bundled`→`bundled`, resto `filesystem`; la etiqueta prioriza `metadata.dsh.origin` |
| `location` | `kind` (`file`/`directory`/`virtual`), `path`, `directory`, `rootId` | `virtual` sólo cuando no hay fichero real; `path` y `directory` quedan `null` |
| `scope` | `kind`, `projectRoot`, `cwd` | el `cwd` observado, no el del panel |
| `association` | `loadedByHost`, `provider`, `path`, `shadowedBy` | la rellena `mergeHostWinners`; `shadowedBy` es `null` o `{provider, path, source}` |
| `execution` | `modelInvocable`, `userInvocable` | del frontmatter: `disable-model-invocation !== true` y `user-invocable !== false` |
| `identity` | `uuid`, `version`, `contentSha256`, `manifestSha256` | `uuid`/`version` sólo del catálogo v3 propio; `contentSha256` es el SHA-256 de los bytes leídos |
| `confidence` | nivel | ver §4 |
| `reasons` | códigos | errores de frontmatter, `snapshot-without-path`, `manifest-missing`, etc. |

`name` puede ser `null`; `canonicalName` es `null` si el nombre no cumple la regex del Host
(`lib/inventory.mjs:271-301`). Un nombre inválido se conserva tal cual y **jamás** se normaliza para
igualar.

## 4. Escala de confianza

Orden de mayor a menor (`_audit/R16-CONTRACT.md:219-236`), con el punto real donde se asigna:

| Nivel | Requisito | Dónde se asigna |
|---|---|---|
| `verified` | El ganador del snapshot es nuestro proveedor **y** el SHA-256 de la vista materializada coincide | `lib/inventory.mjs:1099` (sólo en `addCatalogRows`) |
| `manifest` | Hay `manifest.json` de la vista y el frontmatter es legible | `lib/inventory.mjs:770` |
| `plugin-contract` | La skill sólo existe porque el snapshot la declara (sin fichero leído) | `lib/inventory.mjs:453` |
| `local-registry` | Asignación del catálogo v3 sin fichero confirmado | `lib/inventory.mjs:1099`, `:1122` |
| `content-hash` | El fichero existe y se pudo hashear, pero el frontmatter falla | `lib/inventory.mjs:389` |
| `name-only` | — | **No se emite**: no hay ninguna asignación de `name-only` en `lib/` ni en `client.js` |
| `unknown` | — | **No se emite** como `confidence`; sólo existe como disponibilidad/estado en otros dominios |
| `ambiguous` | Veredicto de **grupo** con dueños/procedencias incompatibles | `lib/collisions.mjs:215-236`; gana a nivel de fila y bloquea escrituras dependientes (`lib/preflight.mjs:323-333`) |

La prioridad es el **máximo nivel cuyos requisitos se cumplen**, nunca una media ni una suma. Dos
observaciones medidas:

- `entryFromCandidate` tiene una rama muerta: `path === null ? 'plugin-contract' : 'plugin-contract'`
  (`lib/inventory.mjs:453`). Toda fila de snapshot sin fichero leído queda en `plugin-contract`,
  incluso si trae `path`; el contrato la describe como nivel para entradas **virtuales**.
- `mergeHostWinners` marca el ganador como cargado y a las homónimas como `shadowedBy`, pero **no
  sube** la confianza a `verified` (`lib/inventory.mjs:481-524`). `verified` sólo nace en
  `addCatalogRows`.

## 5. Un nombre no es una identidad global

El censo real (`_audit/r16-sources-inventory.md`, fixtures `_audit/r16-sources/20-skills.json`) mide
244 entradas en 12 fuentes: 190 gestionadas, 26 copias upstream, 14 sombras, 2 derivadas y 12
opacas del asar. Medido:

- **33 grupos** comparten `name` entre fuentes distintas; **15** comparten SHA-256; **0** comparten
  UUID.
- **8 grupos** tienen hash idéntico entre fuentes vivas (p. ej. `agent-team-specialized-delivery`
  `4a863f2f96a9`, `powershell-colon-variable-trap` `1e4dbfe2049b`).
- **4 grupos** tienen una copia `.archive` idéntica.
- **10 grupos** documentados como «mismo nombre con contenido divergente»: `authorized-plan-artifacts`,
  `data-backup-and-restore`, `deepseek-usage-monitor`, `deepseek-workwindow`,
  `guard-and-check-verification`, `ui-ux-pro-max`, `windows-git-bash-commands`,
  `dsh-local-mcp-integration`, `nuxt-storefront-frontend` y `saas-corporative-gate-workflow`. El
  documento resumen dice «9 grupos» pero enumera 10: **divergencia del censo**, no del código.
- **23 grupos** son historia intra-fuente (`approved`/`superseded`): no son colisión.
- **65 casos** tienen `name` distinto de la carpeta (24 copias upstream, 41 superseded con
  timestamp).
- **0 UUID** en toda la máquina.

Conclusión operativa: la identidad de una entrada es `(fuente, id)` más su hash de contenido; el
`name` sólo sirve para detectar colisiones **con contexto**, no para fusionar filas.

## 6. `complete` es fail-closed

`collectInventory` calcula `complete` así (`lib/inventory.mjs:1003-1005`):

```js
const COMPLETENESS_CRITICAL = ['state', 'filesystem-project', 'filesystem-view', 'skills-registry'];
complete = !truncated
  && sources.every((source) => source.status !== 'error')
  && sources.every((source) => !COMPLETENESS_CRITICAL.includes(source.id) || source.status === 'complete');
```

Es decir: si el estado no se pudo leer, si la vista materializada no responde, si el `cwd` no se pudo
inspeccionar o si el snapshot de skills falta o viene incompleto, `complete` es `false` aunque las
demás fuentes estén bien. El preflight lo convierte en `block evidence-incomplete` cuando la acción
exige esa fuente (`lib/preflight.mjs:251-261`); si la fuente era opcional, degrada a
`warn catalog-unverified` sin afirmar que no hay colisiones (`lib/preflight.mjs:262-273`).

Pruebas: snapshot que lanza deja `complete:false` y nunca un éxito falso al materializar
(`tests/r16-contract.test.mjs:251-271`); adaptador que falla deja la fuente en `error`
(`tests/r16-domain.test.mjs:395-417`); sin `skills.snapshot` la API responde 503
(`lib/api.mjs:1005-1085`, prueba `tests/r16-api.test.mjs:179-210`).

## 7. `null` nunca es 0

- `sessions.count` es `null` si la fuente no existe o no da un entero; nunca 0
  (`lib/projects.mjs:124-130`; prueba `tests/r16-contract.test.mjs:387-428`).
- `hermes-legacy` y `builtin-asar` devuelven `found: null` (`lib/inventory.mjs:66-83`).
- `summary.own/external/unknown` del inventario son `null` si el inventario no está disponible
  (`lib/api.mjs:1005-1085`), y el panel no los pinta como 0 (`client.js:2663-2667`).
- `sessions.source` distingue `workspace`/`persistence`/`none`; con `none` el conteo es `null`.

## 8. Ofrecida, asignada, cargada, aplicada

| Concepto | Fuente de verdad | Código |
|---|---|---|
| **Ofrecida** | catálogo de skills del Host/centro (`snapshot`) | `lib/inventory.mjs:824-1039` |
| **Asignada** | `state.assignments[projectId][skillId]` con `enabled` y versión | `lib/operations.mjs:544+`; `lib/projects.mjs:300-345` |
| **Cargada** | lo que el proveedor entrega al agente para un `cwd` | `lib/provider.mjs:80-127` |
| **Aplicada** | **no se mide**: `skill.loaded` es telemetría de entrega, no prueba de uso | `lib/provider.mjs:13-15` |

Esta separación es la que permite decir «asignada pero sombreada» sin confundirla con «cargada», y
la que impide presentar una skill como «aplicada» sin evidencia.

## 9. Limitaciones del Host

1. El cargador no expone UUID ni versión de skill: sólo nombre, ruta, descripción, invocación y
   procedencia (`lib/inventory.mjs:413-457`; contrato §2.4).
2. No hay API para enumerar skills **sombreadas**: el Host devuelve sólo el ganador por nombre; las
   demás se reconstruyen comparando snapshot y disco (`lib/inventory.mjs:481-524`).
3. `pluginInventory` sólo existe en remoto; el `loader.entries()` real no está documentado como API
   estable (`_audit/R16-ARCHITECTURE.md`, limitaciones).
4. El estado de un workspace colapsa «no existe» y «sin permiso» en `missing-dir`; el inventario no
   puede distinguirlos y lo dice como «carpeta ausente».
5. Los nombres inválidos se ignoran en silencio en el cargador; el inventario los conserva con
   `canonicalName: null` y `invalid-name` para que no desaparezcan.
6. `metadata.dsh.*` y `hermes.*` son **procedencia**, no prueba de propiedad: no elevan confianza.

## 10. Divergencias contrato → código (inventario)

| Contrato | Código real | Evidencia |
|---|---|---|
| `owner.pluginEntryId` se rellena si el mapeo proveedor→módulo es inequívoco; si no, `null` + `reasons: ['owner-plugin-unmapped']` (`_audit/R16-CONTRACT.md` §2.4) | `pluginEntryId` es siempre `null` y `owner-plugin-unmapped` no existe en el código | `lib/inventory.mjs:367`, `:429`, `:1110` |
| Nivel `name-only` en la escala (`_audit/R16-CONTRACT.md:219-236`) | Nunca se asigna: el frontmatter roto cae en `content-hash` | `lib/inventory.mjs:389`; búsqueda sin resultados en `lib/` |
| `verified` como evidencia de «snapshot + disco coinciden» (§2.3) | Sólo se asigna en `addCatalogRows`; `mergeHostWinners` no lo eleva | `lib/inventory.mjs:1099`, `:481-524` |

## 11. Resumen del censo

| Grupo de fuente | Entradas observadas |
|---|---|
| `user-skills` | 27 (de 29 `SKILL.md`) |
| `compiler-projects` | 83 (de 107) |
| `compiler-global` | 2 (de 2) |
| `workspace:saas-corporative` | 1 |
| `center-materialized` | 2 |
| `center-catalog` | 7 documentos JSON |
| `hermes-skills` | 70 (de 83) |
| `builtin-runtime-office` | 7 |
| `builtin-asar` | 12 ilegibles |
| `update-backups` | 1 |
| `.system`, plugins con skills, fixture del repo | 0 / 0 / 1 |
| **Total** | **244** |

Fuente: `_audit/r16-sources-inventory.md`; fixtures `_audit/r16-sources/10-sources.json` y
`20-skills.json`. Las cifras de esta tabla son del censo, no de una ejecución del inventario en vivo.

## 12. No verificado

- Que exista una bandera de truncamiento por raíz (`maxRootEntries`): el código corta en silencio
  (`lib/inventory.mjs:656-806`) y no encontré un `truncated` por raíz.
- Que el nivel `name-only` se emita desde otro módulo: busqué en `lib/` y `client.js` y no aparece.
- El estado final de los gates del encargo; el árbol estaba en edición concurrente.
