# Arquitectura

Tres niveles, como pidió el plan: **interfaz** (panel), **inteligencia** (agente y herramientas), **registro**
(almacén, versiones, asignaciones, métricas). El registro manda; la interfaz y el agente son dos clientes de
la misma composición.

## De qué depende cada pieza

```text
client.js  ──fetch──▶  /lifecode-skill-center/api/   (index.js, ruta de webServer)
                              │
                              ▼
                        lib/api.mjs  ──▶ lib/operations.mjs ──▶ lib/state.mjs (center.json)
                              │                    │
                              │                    └──▶ lib/evaluate.mjs, lib/skillfile.mjs
                              ├──▶ lib/detect.mjs + lib/sources.mjs  (lo que ya existe en disco)
                              ├──▶ lib/materialize.mjs               (vista que el harness carga)
                              └──▶ lib/analytics.mjs                 (derivado de eventos)
lib/tools.mjs ──▶ lib/api.mjs   (mismas acciones que el panel, con actor:'ai')
index.js
  ├─ ctx.systemPrompt.section   (protocolo corto)
  ├─ ctx.tools.register         (cuatro herramientas)
  ├─ ctx.skills.registerProvider(lib/provider.mjs)  ──▶ lib/materialize.mjs
  └─ ctx.webServer.register     (prefijo /lifecode-skill-center/api/)
lib/watch.mjs  (fs.watch + sondeo) ──▶ control.invalidate() del registro de skills
```

Regla: **el núcleo puro no importa nada del harness** (`node:` y relativos, nada más). Por eso 103 pruebas
corren con `node --test` antes de instalar el plugin. `index.js` es el único fichero que conoce Cordis.

## El documento de estado

Un solo `center.json`, versión de esquema 1, escritura atómica (temporal + rename):

```text
{ schemaVersion, createdAt, updatedAt,
  skills:    { <id>: { id, title, description, whenToUse, tags[], status, currentVersion,
                       origin{kind,from,fromVersion,note}, versions[] } },
  projects:  { <projectId>: { id, name, cwd, note } },
  assignments: { <projectId>: { <skillId>: { enabled, version, updatedAt, by } } },
  improvements: { <imp-id>: { skillId, baseVersion, body, rationale, status, evaluation } },
  events:    [ { id, at, type, skillId, projectId, version, actor, note } ] }
```

Una versión guarda `{version, description, whenToUse, tags[], body, references{path:content}, createdAt,
checksum, notes, evaluation}`. El cuerpo y las referencias viven dentro del documento: una versión publicada
no depende de ficheros sueltos que alguien pueda editar por detrás.

`projectId` se deriva de la ruta (`<slug del nombre>-<sha1 corto>`), así que dos proyectos con el mismo
nombre no se pisan.

## Asignar es apuntar a una versión exacta

Decisión de diseño con consecuencia visible: aprobar `1.1.0` **no cambia** lo que un proyecto carga si tenía
`1.0.0`. El panel tiene un selector de versión por skill y proyecto (acción `rollback`, que en realidad es
«pon esta versión»). Es el comportamiento seguro por defecto: un proyecto en producción no cambia de código
porque alguien apruebe una mejora.

Al apagar una skill se conserva la versión apuntada, de modo que volver a encenderla devuelve exactamente lo
que había. Está probado en [`tests/operations.test.mjs`](../tests/operations.test.mjs).

## El catálogo que el harness ve

`lib/provider.mjs` implementa el contrato de proveedor de skills: `list({cwd})` y `get(candidate)`.
`list` resuelve el proyecto por ruta, toma **sólo** lo encendido y apunta cada candidato a un `SKILL.md` real
en la vista materializada. `get` lee ese fichero; si la vista quedó atrás la rehace una vez; si aun así no
puede, compone el texto en memoria —quedarse sin la skill por un fallo de disco sería peor que servirla sin
referencias.

Rango `160`: por debajo del compilador anterior (`150`), así que si los dos sirven el mismo nombre gana el
que ya estaba. Es deliberado: el centro no secuestra skills existentes.

`skill.loaded` se anota en `list`, dentro de un `try/catch`: la telemetría nunca puede costar el catálogo. Y
significa «el catálogo la entregó», no «el modelo la aplicó».

## La invalidación, que es la diferencia entre funcionar y funcionar mañana

El registro de skills del harness cachea los catálogos y sólo los tira cuando el proveedor llama a
`control.invalidate()`. Se dispara por dos vías:

1. cada acción del panel que cambia el catálogo (`CHANGES_CATALOG` en `index.js`), y
2. `lib/watch.mjs`, que vigila el almacén con `fs.watch` **y** sondeo de mtime a 4 s, con antirrebote,
   porque `fs.watch` no es fiable en todas las rutas y el sondeo cubre también lo que muta otro proceso.

## La detección de lo que ya existe

Dos mitades: `lib/sources.mjs` recorre el disco (biblioteca de usuario, compilador anterior, `.dsh/skills`
del proyecto) sin escribir nada; `lib/detect.mjs` puntúa. La puntuación cuenta familias de palabras
(`desplegar`/`despliega` comparten cinco letras de prefijo) y da más peso a un id repetido: un id igual es la
misma skill con otro contenido. Umbral 0.16 en biblioteca, 0.22 en externos.

## La compuerta de calidad

`lib/evaluate.mjs` puntúa de 0 a 100 y separa **bloqueantes** de **avisos**: descripción y `whenToUse`
obligatorios, cuerpo con al menos dos secciones, referencias declaradas que existan y guardadas que se
enlacen, rutas sin `..`, tope de 64 KiB, y patrones de secreto (clave privada, `sk-…`, `ghp_…`, `AKIA…`,
`password=…`). Lo que bloquea no se publica; está medido caso por caso en
[`tests/evaluate.test.mjs`](../tests/evaluate.test.mjs).
