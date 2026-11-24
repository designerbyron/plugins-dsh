# UX-2.2 · Propuesta de autorización de raíz — `D-UX22-13 = A`

> ## ⚠️ Este documento **no es una autorización**
> Es la **propuesta independiente** que el mandato exige **antes** de cualquier lectura real. No se ha ejecutado
> nada: no se creó ni modificó ninguna raíz, `trusted_roots`, grant, proyecto ni permiso. La operación de §10 no se
> ejecuta hasta que la persona la apruebe **de forma específica**.

**Base:** `D-UX22-13 = A` (opción A limitada a **una** ruta exacta) · `UX-22-TRACKING-SPEC.md` §12
**Fecha:** 2026-11-23 · **Perfil:** `desktop` · **Medición:** sólo lectura

---

## 1. Ruta exacta que se pretende autorizar

```
<REPO_ROOT>
```

`HECHO` — Existe, es un directorio real, y su `realpath` coincide con el literal literal (no hay enlace, junction ni
reparse point en el último componente). **No** se propone ninguna otra ruta: ni `…\plugins-dhs-release`, ni
`…\plugins-dhs`, ni ninguna raíz superior.

## 2. Proyecto al que se asociaría

**Proyecto existente** — no se crea ninguno:

| Campo | Valor |
|---|---|
| Nombre | **LifeCode RAG** |
| `id` | `prj_01M7RBSRD33M26HGBEFW51WPP6` |
| `status` | `active` |
| Raíz que ya tiene | `C:\xampp\htdocs\plugins-dhs\lifecode-rag` (`rt_01M7RBSRD4G6977PYBNPM8WGW5`, `authorized`, `added_by='human'`) |

Resultado: el proyecto pasaría a tener **dos raíces autorizadas** (árbol de desarrollo y árbol de release).

## 3. Identificador y registro que se modificaría

**Una sola tabla, una sola fila añadida:** `roots` del registro del perfil
(`<DSH_HOME>\lifecode-rag\profiles\desktop\registry.sqlite3`).

| Columna | Valor que tomaría |
|---|---|
| `id` | `rt_…` (nuevo, generado por `newId`) |
| `scope_kind` | `prj` |
| `scope_id` | `prj_01M7RBSRD33M26HGBEFW51WPP6` |
| `path` | ruta **canónica** según `realpathSync.native` |
| `path_key` | `<REPO_ROOT>` |
| `state` | `authorized` |
| `added_at` | instante de la operación |
| `added_by` | `human` (lo fuerza el CLI) |

**No se modifica** ninguna otra fila: ni `projects`, ni `session_scope`, ni `pa_selection`, ni `libraries`, ni
`grants`, ni `meta.trusted_roots`, ni `sync_state`.

## 4. Mecanismo concreto de autorización que usa hoy el sistema

Hay **dos mecanismos distintos**, y sólo uno hace falta aquí:

| Mecanismo | Dónde vive | Para qué sirve | Cómo se escribe |
|---|---|---|---|
| **Raíz autorizada** | tabla `roots` (`state='authorized'`) | **pertenencia** de una zona física a un ámbito; es lo que habilita leer/ingerir y lo que usa la resolución por `cwd` | CLI `node bin/lifecode-rag.mjs root add --project <prj> --path <ruta absoluta>` · panel `POST /pa/roots {projectId, path}` (ruta de administración, con compuerta del host) |
| **Raíz confiable** | `meta.trusted_roots` (JSON) | sólo el **sondeo de frontera** de workspace: autoriza leer un workspace que **no** está cubierto por ninguna raíz | CLI `node bin/lifecode-rag.mjs trust add --path <ruta> [--read true\|false]` |

**Garantías del mecanismo, ya implementadas** (`lib/registry.mjs:255-285`, `lib/roots-structure.mjs`):
- la ruta debe ser **absoluta**, existir y poder leerse (`source-unreadable` si no);
- se canonicaliza con `realpathSync.native` (comparación insensible a mayúsculas en win32, acepta `\` y `/`);
- se **rechazan** enlaces simbólicos, junctions y reparse points (`root-symlink`);
- se **rechazan** solapamientos padre/hijo y duplicados (`root-overlap`, `invalid-argument`), incluso dentro del
  mismo ámbito: la misma carpeta no puede ser dos raíces;
- `assertRootUnchanged` **revalida** el destino real en cada apertura y falla en cerrado (`root-changed`) si cambió;
- `root add` **no** crea el almacén del ámbito, **no** indexa y **no** lee documentos: sólo registra la fila.

**Consecuencia medida (corrige una afirmación previa):** con una raíz autorizada que cubra el `cwd`, la resolución
termina en el escalón «`cwd` ∩ raíces» (`lib/resolve.mjs:203-263`) y **no** consulta `trusted_roots`. Por eso esta
propuesta **no incluye** un `trust add`. Se comprobó además que la confianza **sin** raíz tampoco resuelve: el sondeo
devuelve `projectId: null` (`resolve.mjs:116-118`).

## 5. Alcance efectivo de lectura resultante

`HECHO` — la ruta propuesta cubre **únicamente** el directorio del plugin en el árbol de release:

| Dato | Valor medido |
|---|---|
| Ficheros en el árbol | **455** (sin `node_modules`, que no existe ahí) |
| Tamaño | **9 MB** |
| Subdirectorios de primer nivel | `bench/ bin/ demo/ docs/ eval/ lib/ tests/ tools/` + ficheros raíz (`client.js`, `index.js`, `package.json`, `README.md`) |
| Qué habilita | leer e ingerir ficheros **por debajo** de esa ruta, en el ámbito del proyecto «LifeCode RAG» |

## 6. Comprobación de que **no** se extiende a hermanos, otros plugins ni el worktree completo

`HECHO` — así queda el reparto de rutas:

| Ruta | ¿Cubierta por la raíz propuesta? |
|---|---|
| `…\plugins-dhs-release\lifecode-rag\lib`, `\docs`, `\tests`, `\bin`, `\bench`, `\demo`, `\eval`, `\tools` | **sí** (están dentro) |
| `…\plugins-dhs-release\lifecode-skill-center` | **no** (hermano) |
| `…\plugins-dhs-release\skill-compiler` | **no** (hermano) |
| `…\plugins-dhs-release\plans`, `\docs`, `\assets`, `\_audit` | **no** (hermanos) |
| `…\plugins-dhs-release` (worktree completo) | **no** |
| `…\plugins-dhs` y todo el árbol de desarrollo | **no** (otra ruta, ya es raíz de otro proyecto) |

La comprobación no es una promesa: el `path_key` es un prefijo **con barra**, de modo que
`…/plugins-dhs-release/lifecode-rag` **no** contiene `…/plugins-dhs-release/lifecode-rag-otro` ni ningún hermano. Y
`…/plugins-dhs-release` **no** contiene `…/plugins-dhs` (ni al revés), así que la relación Git entre ambos árboles
**no** concede autorización sobre ninguno.

## 7. Riesgo de duplicación de fuentes respecto de `plugins-dhs`

**Es real y está medido en el código**, no es hipotético:

- `HECHO` — La identidad de una fuente es su **`uri`** (`SELECT id, sha256 FROM sources WHERE uri = ?`,
  `lib/ingest.mjs:103`), y el `id` se deriva del `uri` (`sourceIdFor`).
- `HECHO` — El `uri` por defecto es la **ruta absoluta** (`uri: uri ?? absolutePath`, `lib/ingest.mjs:84`); la
  herramienta `ingest` **no** expone un parámetro `uri`.
- **Consecuencia:** el mismo fichero en los dos árboles produce **dos `uri` distintos → dos fuentes → dos juegos de
  chunks y vectores**, en el **mismo** ámbito, con `sha256` idéntico.
- `HECHO` y agravante — la API presenta el `uri` **relativo a las raíces** (`relUri`, `lib/pa-api.mjs:254-264`). Con
  la nueva raíz, ambas copias se mostrarían como `lib/resolve.mjs`: **dos resultados con el mismo nombre visible** y
  `id` distinto. La duplicación sería invisible en el panel.

**Lo que hoy NO existe:** ninguna deduplicación por contenido entre raíces, ni chequeo de «mismo `sha256` con otro
`uri`». El registro **acepta** la segunda raíz sin advertir de este riesgo (los dos árboles son hermanos, así que
`root-overlap` no se dispara).

## 8. Evidencia de cómo se impediría la duplicación (propuestas, no implementadas)

| # | Medida | Qué garantiza | Estado |
|---|---|---|---|
| **M1** | **No ingerir** desde el árbol de release: usarlo sólo para **resolución de contexto** | cero duplicación; el conocimiento del mismo código ya vive en el árbol de desarrollo | **recomendada para UX-2.2** · depende de disciplina, no de código |
| **M2** | Ingesta con `collection` distinta por árbol (p. ej. `release`) | separa por filtro, pero **no** evita las dos filas ni los dos `uri` | propuesta |
| **M3** | Regla: rechazar una ingesta cuyo `sha256` ya exista en el ámbito con **otro** `uri` | impide la duplicación **por código** | propuesta nueva; no existe hoy |
| **M4** | Declarar **un solo árbol canónico** por proyecto y no seguir el otro | decisión de producto; cero código | propuesta |

`INFERENCIA` — Para el objetivo real de `D-UX22-13` (que el contexto **resuelva** en el árbol de release) basta con
`M1`: la raíz habilita la resolución; no hay que ingerir para ello. Si algún día hay que ingerir, `M3` es la única
medida que lo impide por código.

## 9. Estado actual y estado propuesto, lado a lado

| Elemento | **AHORA** (medido) | **PROPUESTO** (si se aprueba §10) |
|---|---|---|
| Raíces del proyecto «LifeCode RAG» | 1: `…\plugins-dhs\lifecode-rag` | 2: la anterior **+** `…\plugins-dhs-release\lifecode-rag` |
| Raíces del proyecto «plugins-dhs» | 1: `…\plugins-dhs` | igual (sin cambios) |
| Proyecto «lifecode-brain» | 1: `…\lifecode-brain` | igual (sin cambios) |
| `meta.trusted_roots` | 1: `…\plugins-dhs` (`readAuthorization: true`) | **igual** (no se propone tocar) |
| Grants / bibliotecas | sin cambios | **igual** |
| `pa_selection` / `session_scope` | `profile` rev 5 y 1 fila de sesión | **igual** |
| Resolución por `cwd` en `…\plugins-dhs-release\lifecode-rag` | ninguna raíz coincide → sondeo de frontera → sin confianza → **denegado** (`scope-unresolved`, `reason:'project-not-authorized'`) | coincide con raíz autorizada → **proyecto «LifeCode RAG»** (`source:'cwd'`) |
| Resolución por `cwd` en otros directorios de `-release` | denegada | **denegada** (no cubiertos) |
| Discovery (`GET /pa/workspaces`) para el workspace de esa ruta | `relation: none`, sin proyecto | `relation: exact`, proyecto «LifeCode RAG» |
| Conocimiento indexado | sólo desde el árbol de desarrollo | **igual** mientras se respete `M1`; si se ingiere desde release, duplica (§7) |
| Ficheros que se pueden leer | nada bajo `-release` | los 455 ficheros del plugin en `-release` (9 MB) |

## 10. Operación exacta que se solicita aprobar

**Sólo la creación de una fila en `roots`.** Sin `trust add`, sin `--create`, sin ingesta, sin reindexado:

```sh
node bin/lifecode-rag.mjs root add \
  --project prj_01M7RBSRD33M26HGBEFW51WPP6 \
  --path "<REPO_ROOT>"
```

Equivalente por el panel (misma fila, con compuerta del host):
`POST /lifecode-rag/pa/roots` con `{"projectId":"prj_01M7RBSRD33M26HGBEFW51WPP6","path":"<REPO_ROOT>"}`.

**Verificación que acompañaría la ejecución** (para el acto autorizado, no ahora): copia previa del registro con
`sha256`; `root list` antes y después; `PRAGMA integrity_check`; recuento por tabla para probar que **sólo** cambia
`roots` (+1 fila); confirmación de que no se creó ningún `scopes/<id>/rag.sqlite3` nuevo y de que ningún almacén
existente cambió de huella.

**Reversión:** el CLI **no** tiene `root remove`; la retirada se hace por el panel
(`POST /lifecode-rag/pa/roots/remove` con `rootId`, `projectId` y `path`, y `allowEmpty` cuando corresponda). Debe
constar en la autorización, porque una operación sin vuelta atrás conocida no se autoriza a ciegas.

**Lo que esta propuesta NO pide:** no autoriza `…\plugins-dhs-release` completo, ni `…\plugins-dhs`, ni ninguna raíz
superior; no toca `trusted_roots`; no ingiere ni indexa; no modifica grants, selección ni sesión; y no se apoya en la
relación Git entre los dos worktrees.

**Estado:** `PENDING` — a la espera de aprobación humana específica (`D-UX22-13 (operación)` / `D-UX22-BLOCKER-01`).
