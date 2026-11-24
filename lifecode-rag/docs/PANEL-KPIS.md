# KPIs del panel — qué mide cada cifra y con qué fórmula

Tres tarjetas del Resumen (`data-kpi="projects" | "documents" | "coverage"`). Este documento es la
definición de referencia: si el código y este texto discrepan, el defecto está en el código.

Reglas que valen para las tres:

1. **Cada cifra dice sólo lo que mide.** Una raíz autorizada es *configuración*; no es contexto
   documental, no es un documento y no se cuenta como cobertura.
2. **Ausencia ≠ cero.** Cuando el snapshot no certifica un dato, la tarjeta no pinta `0`: pinta `—` o
   «Sin datos». Un cero que nadie midió es una mentira con formato de número.
3. **Nada se infiere.** Ningún cálculo deduce documentos de una raíz, ni cobertura de una
   configuración.

Implementación: `paOverviewMetrics(state)` y `paDocumentalCoverage(projects)` en `client.js`
(pieza de interfaz); pintado en `paViewOverview`. Estado hidratado en `paReduce({type:'hydrate'})`.

---

## 1. Proyectos configurados

**Definición.** Número de proyectos **activos** del perfil que tienen **al menos una raíz
autorizada**. Mide configuración: que el proyecto esté registrado y pueda leerse.

**Fórmula exacta.**

```
activos      = { p ∈ state.projects : (p.status || 'active') = 'active' }
ready        = |{ p ∈ activos : (Number(p.rootCount) || 0) > 0 }|
configured   = ready
total        = |activos|                       ← el segundo número del subtítulo
subtítulo    = "{ready} de {total} proyectos con raíz autorizada"   (ES)
               "{ready} of {total} projects with an authorized root" (EN)
```

**Fuente de datos.** `snapshot.projects[]` → `status` (aditivo de `pa/1.3.0`; si falta se asume
`active`) y `roots` (raíces **autorizadas**), mapeados en `paReduce` a `p.status` y `p.rootCount`.
`state.archived` nunca entra. Función: `paOverviewMetrics` → `ready` (alias `configured`), `total`.

**Denominador.** Proyectos **activos** (`m.total`), no el total histórico: los archivados quedan
fuera del numerador y del denominador.

**Qué significa `null`.** No aplica: es un recuento entero. Sin proyectos activos vale `0`, y el
subtítulo lo declara («0 de 0 proyectos con raíz autorizada»).

**Cuando faltan datos.** Si el snapshot no trae `projects`, la lista queda vacía y la tarjeta dice
`0`; no se hereda la lista anterior ni se rellena con ámbitos (`scopes`). Un proyecto registrado sin
raíz autorizada cuenta en `total` y no en `ready`.

**Qué NO mide.** Documentos indexados, cobertura documental, si la ingesta corrió, si el proyecto
está seleccionado en esta conversación, ni si la recuperación funciona. Un `1 de 1` aquí **no**
significa que haya contexto: significa que hay una raíz autorizada y nada más.

---

## 2. Documentos indexados

**Definición.** Número de documentos indexados en el almacén del **proyecto activo**, tal como lo
certifica el snapshot.

**Fórmula exacta.**

```
docs      = Number.isFinite(Number(state.sourcesTotal))
              ? Number(state.sourcesTotal)
              : (state.sources ?? []).length
docsKnown = state.sourcesKnown !== false
valor     = docsKnown ? paNum(docs) : '—'
subtítulo = docsKnown ? "en el proyecto activo"          (ES)
                      : "sin recuento del proyecto activo"
```

En la hidratación: `state.sourcesTotal ← sources.total` si es finito, si no `sources.rows.length`;
`state.sourcesKnown ← Array.isArray(snapshot.sources.rows)`.

**Fuente de datos.** `snapshot.sources` del proyecto activo (`rows[]` y `total`);
`docs/sources/<id>` es del proyecto activo por construcción del contrato PA (§6.2). Función:
`paOverviewMetrics` → `docs`, `docsKnown`; valor pintado en la tarjeta `data-kpi="documents"`.

**Denominador.** Ninguno: es un recuento absoluto, no un cociente.

**Qué significa `null`.** No devuelve `null`; la ausencia se expresa con `docsKnown = false`, y la
tarjeta pinta `—` con «sin recuento del proyecto activo». `0` sólo se pinta cuando el snapshot
declaró la colección y está vacía.

**Cuando faltan datos.** Si el snapshot no trae `sources`, la tarjeta dice `—`, no `0`. Es la
diferencia entre «no hay documentos» y «no se preguntó».

**Qué NO mide.** Los documentos de los **demás** proyectos (la API no publica `docs` por proyecto;
ver §4), el tamaño del corpus en fragmentos (`chunks`), la frescura de la indexación, ni la calidad
del contenido.

---

## 3. Cobertura documental

**Definición.** Porcentaje de proyectos con raíz autorizada que tienen **al menos un documento
indexado**.

**Fórmula exacta.** (`paDocumentalCoverage`)

```
universo  = { p ∈ state.projects : (p.status || 'active') = 'active' ∧ (Number(p.rootCount) || 0) > 0 }
docs(p)   = (p.current ∧ docsKnown) ? docs : (Number.isFinite(Number(p.docs)) ? Number(p.docs) : null)
withDocs  = |{ p ∈ universo : docs(p) > 0 }|
indexed   = Σ docs(p)        sobre el universo
percent   = round(100 · withDocs / |universo|)
devuelve  = null  si  |universo| = 0
                 o   algún docs(p) = null        (recuento desconocido: no se supone)
                 o   indexed ≤ 0                 (cero documentos: ni 0 % ni 100 %)
          = { percent, withDocs, total: |universo|, indexed }   en cualquier otro caso
subtítulo = "{withDocs} de {total} proyectos con documentos"
```

**Fuente de datos.** `docs(p)` sale de `sources.total` para el proyecto activo y del campo
**aditivo** `docs` por proyecto si la API llegara a publicarlo (hoy no lo hace). Función:
`paDocumentalCoverage(projects)`, invocada desde `paOverviewMetrics` → `coverage`. Tarjeta
`data-kpi="coverage"`; `data-kpi-value` lleva `percent + '%'` o el texto «Sin datos».

**Denominador.** Proyectos activos **con raíz autorizada** (`total` del objeto de cobertura): el
conjunto que *puede* tener documentos. Es configuración y por eso la cobertura no puede ser 100 %
por el mero hecho de tener raíces: exige documentos.

**Qué significa `null`.** «Sin datos»: el panel escribe el texto de `ux.overview.coverageNoData`
—«Sin datos: no hay documentos indexados o falta el recuento de algún proyecto»— y **jamás** un
porcentaje. Marca además la tarjeta como `lcr-pa-kpi--nodata`.

**Cuando faltan datos.** Falta el recuento de un solo proyecto → `null` (no se completa con una
suposición). Cero documentos en todo el universo → `null` (un porcentaje sobre cero documentos no se
sostiene: ni 0 % ni 100 %). Sin proyectos con raíz → `null` (no hay denominador).

**Qué NO mide.** Proporción de documentos indexados sobre documentos existentes (la unidad es el
**proyecto**, no el fichero), ni calidad, frescura, recuperabilidad, ni si el proyecto está
seleccionado. `100 %` con `withDocs = total` significa «todos los proyectos configurados tienen al
menos un documento», nada más.

---

## 4. Lo que la API no certifica (y por eso no se inventa)

`GET /pa/snapshot` publica los proyectos con `id`, `name`, `status`, `roots` (autorizadas), `total`,
`current` y `selectable` — ver `lib/pa-api.mjs` → `projectsIndex`. **No publica `docs` por
proyecto.** El único recuento de documentos que el snapshot certifica es `sources` del proyecto
**activo** (§6.2 del contrato PA).

Consecuencias, declaradas en voz alta:

- Con **un** proyecto activo, la cobertura se puede calcular (su `docs` sale de `sources.total`), y
  con cero documentos da «Sin datos».
- Con **varios** proyectos activos, el recuento de los no activos es `null`, así que la cobertura da
  «Sin datos» hasta que la API publique `docs` por proyecto. El panel acepta ese campo aditivo sin
  cambios, pero no lo supone.
- La tarjeta de **Proyectos configurados** no se ve afectada: cuenta raíces, que sí están
  certificadas.

---

## 5. Estados: cuatro cosas distintas que la interfaz no puede confundir

La pantalla mostraba `Listo · 0 documentos` en «Actividad de proyectos» y `Servicio: degraded ·
Conectado` en la cabecera. Ninguno de los dos rótulos era falso en su origen, pero los dos se leían
como algo que no eran: «Listo» prometía documentos que no existen, y `degraded` se leía como avería
cuando el registro estaba sano y lo único que faltaba era el almacén de un proyecto vacío.

Aquí quedan separadas las cuatro capas. **Ningún valor interno (`projects[].status`,
`projects[].selectable`, `snapshot.service`) cambia: esto es vocabulario y presentación.**

### 5.1 Estado del proyecto — «Configurado»

- **Fuente.** `snapshot.projects[]` → `status`, `roots` (raíces **autorizadas**) y `selectable`,
  emitidos por `projectsIndex(db, currentId)` en `lib/pa-api.mjs` (`selectable: Number(row.roots) > 0`).
  El panel los mapea en `paReduce({type:'hydrate'})` a `status`, `rootCount`, `selectable` y
  `docs` (`client.js`, hidratación del snapshot).
- **Función que lo traduce.** `paProjectState(project, t)` en `client.js`:
  `archived` → `ux.ws.stArchived` · `rootCount = 0` → `ux.ws.stNoPath` · resto → `ux.ws.stReady`.
- **Clave i18n.** `ux.ws.stReady` = **«Configurado»** (ES) / **«Configured»** (EN). Antes decía
  «Listo» / «Ready».
- **Qué significa.** El proyecto está **activo** en el registro y tiene **al menos una raíz
  autorizada**: es configuración y nada más.
- **Qué NO significa.** Que haya documentos indexados, que el almacén exista, que la ingesta haya
  corrido, ni que la búsqueda devuelva algo. Con `docs = 0` el proyecto sigue «Configurado»; por eso
  el rótulo dejó de decir «Listo».

### 5.2 Conectividad con la API — «Servicio: ok / sin conexión» y «Conectado»

- **Fuente.** `state.mode === 'api'`: el retrato respondió `200` con el sobre del contrato §5
  (`{ok:true,data}`). Lo fija `negotiateMode()` en `client.js`, que sólo acepta `payload.mode ===
  'api'`; cualquier otro desenlace deja `panelState.mode = 'down'` con su código y **nunca** se
  degrada a demostración.
- **Qué NO implica.** Un `200` **no** dice que el almacén del proyecto exista: `service:'degraded'`
  también llega por `200`. Tampoco dice que haya documentos, ni que el almacén sea legible.

### 5.3 Registro del perfil — disponible o `registry-unavailable`

- **Fuente.** El mismo hecho que la conectividad, con su fallo propio: si
  `openRegistry({root, create:false})` no encuentra el registro, `lib/pa-api.mjs` responde
  `503 registry-unavailable` (`failWith(res, 503, 'registry-unavailable', …)` con `profileKey`,
  `profileRoot`, la ruta del registro y el orden de resolución del perfil). El panel lo ve como
  `mode:'down'` con `reason:'registry-unavailable'`.
- **Qué NO implica.** Un registro disponible **no** implica almacenes: el registro guarda proyectos
  y raíces; los almacenes viven aparte, uno por ámbito.

### 5.4 Almacén del proyecto — «Almacén del proyecto: ok / sin crear todavía»

- **Fuente.** `snapshot.service` **sólo cuando vale `ok` o `degraded`**. `lib/pa-api.mjs` lo emite
  como `service: store ? 'ok' : 'degraded'` en la rama de retrato (`/` y `/snapshot`), después de
  tolerar `store-not-initialized` para esas dos rutas. Ese código lo produce `openStore()`
  (`throw new RagError('store-not-initialized', 'el proyecto no tiene almacén')`) cuando
  `openScopeStore({create:false})` devuelve `null` porque el fichero del almacén del ámbito no
  existe (`lib/scope-stores.mjs`: `if (!create && !existsSync(file)) return null;`).
- **Función que lo traduce.** `paServiceReading(state, t)` en `client.js`: con `mode:'api'` y
  `service:'degraded'` devuelve servicio `ok` (capas 5.2 y 5.3 sanas) **y** la capa de almacén con
  `ux.state.storePending`.
- **Claves i18n.** `connection.store` = «Almacén del proyecto» / «Project store»;
  `ux.state.storePending` = «sin crear todavía» / «not created yet». La cabecera pinta
  `Almacén del proyecto: sin crear todavía` con punto **neutro** (`.lcr-pa-dot--muted`).
- **Qué significa.** El proyecto está registrado con raíz autorizada y **su** almacén aún no se creó.
  Es el estado normal de un proyecto sin documentos: el almacén nace con la primera ingesta.
- **Qué NO significa.** Ni avería, ni corrupción, ni pérdida de datos, ni panel desconectado. Las
  rutas que necesitan contenido (`/history`, `/search`, `/context`) siguen respondiendo
  `store-not-initialized`, que es la verdad de ese proyecto hasta que se ingiera algo.

### 5.5 Cómo se leen juntas en la cabecera

| Situación | Píldoras de la cabecera | Valores internos |
|---|---|---|
| API sana, proyecto con almacén | `Servicio: ok` · `Almacén del proyecto: ok` · `Conectado` | `service:'ok'`, `mode:'api'` |
| API sana, proyecto sin almacén todavía | `Servicio: ok` · `Almacén del proyecto: sin crear todavía` · `Conectado` | `service:'degraded'`, `mode:'api'` |
| Registro del perfil ausente | `Servicio: sin conexión` · `Sin conexión` | `reason:'registry-unavailable'`, `mode:'down'` |
| Demostración explícita | `Servicio: Demo (sin servicio real)` · `Sintético (fixtures)` | `mode:'fixture'` |

El código crudo `degraded` **no se pinta** en la cabecera ni en la vista «Perfil»: ahí el rótulo que
manda es el del almacén (`Almacén del proyecto: sin crear todavía`, con su motivo en el `title` y en
el subtítulo de la tarjeta). Sólo Ajustes → **Conexión** y **Diagnóstico** conservan el valor del
payload a propósito: son las vistas donde el operador compara la API con lo que ve.

### 5.6 Falta elegir proyecto — «Elige un proyecto» (1.5.11)

- **Fuente.** `snapshot.needsProjectSelection === true` (con `candidates` y `project: null`) y
  `POST /selection` para resolverlo. Contrato: `docs/CONTRATO-EXTENSIONES-1.4.md` §6.
- **Antes.** Con dos proyectos activos y ninguna selección, `/snapshot` respondía `403
  scope-ambiguous` y el panel caía en `mode:'down'`: «Servicio: Sin conexión» + «No se pudo mostrar
  esta vista · scope-ambiguous», sin ofrecer el selector. Callejón sin salida con el servicio sano.
- **Ahora.** `paViewSelection` pinta una tarjeta «Elige un proyecto» con un botón por candidato; la
  elección viaja por `select-project` → `POST /selection` con CAS. No se pinta «sin conexión» ni
  ningún código crudo, y el panel **no** elige por su cuenta.
- **Qué NO significa.** No es avería, ni pérdida de datos, ni cobertura cero: es una decisión
  pendiente. Las píldoras dicen «Servicio: ok» y «Conectado» porque la API y el registro sí
  respondieron.

### 5.7 «Reintentar» reintenta (1.5.11)

El botón de la tarjeta de error sólo incrementaba `viewEpoch`, que nadie consumía: la vista no se
recuperaba hasta recargar la aplicación (F-2). Ahora despacha `retry-view`, que pone `pending:'reload'`
y entra por la misma vía que el arranque (negociar + `/snapshot`). Dos reglas medidas por pruebas: con
una petición en vuelo no se lanza otra, y un fallo vuelve a dejar el botón disponible (antes
`unavailable` no cerraba `pending`, así que el segundo fallo lo dejaba muerto).

---

## 6. Vocabulario fijado en la interfaz (ES / EN)

| Clave | ES | EN |
|---|---|---|
| `ux.overview.projects` | Proyectos configurados | Configured projects |
| `ux.overview.projectsHint` | `{ready} de {total} proyectos con raíz autorizada` | `{ready} of {total} projects with an authorized root` |
| `ux.overview.sources` | Documentos indexados | Indexed documents |
| `ux.overview.docsUnknown` | sin recuento del proyecto activo | the active project does not publish its count |
| `ux.overview.coverage` | Cobertura documental | Document coverage |
| `ux.overview.coverageHint` | `{withDocs} de {total} proyectos con documentos` | `{withDocs} of {total} projects with documents` |
| `ux.overview.coverageNoData` | Sin datos: no hay documentos indexados o falta el recuento de algún proyecto | No data: no indexed documents, or a project is missing its count |
| `ux.overview.empty` | Todavía no hay proyectos configurados | No configured projects yet |
| `ux.overview.nextNone` | Nada pendiente: todos tus proyectos tienen raíz autorizada. | Nothing pending: every project has an authorized root. |
| `ux.projects.sub` | Proyectos registrados, sus raíces autorizadas y su estado documental | Registered projects, their authorized roots and their document status |
| `ux.ws.stReady` | Configurado | Configured |
| `ux.ws.stNoPath` | Sin ruta | No path |
| `connection.store` | Almacén del proyecto | Project store |
| `ux.state.storePending` | sin crear todavía | not created yet |

Prohibido en estas tarjetas: «proyectos con contexto» / «projects with context» para raíz
autorizada. La palabra «contexto» queda reservada para la recuperación real (`nav.context`,
`context.*`) y para el denominador de la cobertura, que se describe aquí como «proyectos con raíz
autorizada».

---

## 7. Evidencia

- `tests/panel-states.test.mjs` — «Configurado» en la actividad de proyectos (sin «Listo»/«Ready»,
  ES y EN), cabecera con `service:'degraded'` que nombra el almacén pendiente sin decir «avería» ni
  pintar el código crudo, cabecera con `service:'ok'` que sigue diciendo «ok», perfil sin proyecto
  que no inventa capa de almacén, y «Sin datos» sin porcentaje en las dos variantes. El valor interno
  `session.service.status` se comprueba intacto.
- `tests/panel-coverage.test.mjs` — definición de `paDocumentalCoverage`, «Sin datos» con cero
  documentos, retrato real de un perfil sin almacén, y la prueba de texto de las tres tarjetas
  (ES/EN, 0/1/varios proyectos).
- `tests/panel-provenance.test.mjs` — un perfil vacío no hereda métricas ni pinta porcentajes.
- `tests/client.test.mjs` — el panel real con datos del Host.
