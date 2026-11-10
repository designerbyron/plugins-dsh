# Desarrollo

## Duplicados y estados de fork en la vista de identidad (D1 y D11)

El clasificador de identidad ya distinguía `uuid-duplicated`, `path-conflict` y los estados de fork, pero
`identityPayload` le pasaba un contexto con **sólo** `inventory`. Resultado: dos registros con el mismo UUID
aparecían como `linked` y la pestaña Identidad no podía decir lo que el producto sí sabía.

La corrección parte el recorrido en dos pasadas, porque la duplicidad es una propiedad del **conjunto**:

1. **Observar**: se lee el manifiesto, el rastro de fork y la disponibilidad de cada ruta conocida.
2. **Calcular contexto**: `duplicateRecords` (rutas registradas repetidas), `duplicateWorkspaces` (rutas del
   Host repetidas) y `uuidDuplicates` (UUID declarados por más de un workspace).
3. **Clasificar** cada observación con ese contexto; el clasificador mantiene su precedencia.

El payload publica además, para que la vista pueda agrupar sin recalcular:

- `uniqueness`: `ok` | `uuid-duplicated` | `path-conflict`.
- `duplicates.uuid` y `duplicates.path`: grupos con su valor y las rutas que lo comparten.
- `forks`: `{ total, byState }` contando los estados `fork-*`.

Regla que se mantiene: la vista **declara** los duplicados con sus rutas y **no elige ganador**; una persona
decide (y en v2 ni siquiera se puede operar sobre ellos, porque las acciones de identidad responden 409).

Trampa medida: la primera versión contaba el UUID **dos veces por proyecto** (registro y manifiesto), así que
un proyecto normal se declaraba duplicado de sí mismo y fallaron nueve pruebas de vista. Se cuenta una sola
vez por workspace, prefiriendo el registro.

Verificación: `tests/identity-view-projection.test.mjs` (3 casos) y `_audit/probe-d1-detects.mjs`, que mide
la vista con y sin el contexto de duplicados (`uuid-duplicated` frente a `linked`).
## Manifiesto ilegible y temporales de publicación (D2 y D3)

Dos defectos de la auditoría de identidad v3 que se cerraron juntos porque comparten criterio: **decir la
verdad sobre lo que no se pudo comprobar** y **no dejar basura cuando el programa sabe que falló**.

### D2 · `readManifest` distingue «ilegible» de «inválido»

- `readManifest(path)` devuelve `{ status: 'unreadable', path, reason: 'io:<CÓDIGO>' }` para cualquier error
  de lectura distinto de `ENOENT` (permisos, E/S, nombre ocupado por un directorio). Un JSON roto sigue
  siendo `invalid` con `reason: 'manifest-json'`: no es lo mismo un fichero mal formado que uno que no se
  puede abrir.
- `classifyWorkspace` mapea ese estado a `identity-unknown` con verificación `unverified`, sin inventar una
  identidad ni afirmar que el manifiesto esté corrupto.
- En la pestaña Identidad el inventario queda **incompleto** y la fila nombra `inventory-unreadable` y
  `inventory-incomplete`; la disponibilidad se declara `unknown`, nunca `ok`.
- Motivo de diseño: `lib/api.mjs` ya contemplaba `status === 'unreadable'` en tres sitios (inspección,
  inventario y aviso de ruta ilegible). Faltaba que el lector lo produjera, así que el panel nunca podía
  decirlo. Se corrigió el productor, no los consumidores.

### D3 · temporales: se limpia lo que no sirve y se conserva la evidencia

La regla que resuelve la tensión entre «no dejar basura» y «dejar prueba del fallo»:

| Fallo de `publishExclusive` | ¿Se retira el `.lifecode-tmp-*`? | Por qué |
|---|---|---|
| `temp-mismatch` (los bytes verificados no coinciden) | sí | se sabe que el contenido no sirve |
| `exists` (el destino ya existía) | sí | la publicación no ocurrió y el temporal no aporta nada |
| `publish-unsupported` / `link-failed` | sí | fallo determinista del programa |
| `escaped-after-publish` | sí | el enlace existe; el temporal es un resto |
| `temp-unverified` (falló la escritura o el `fsync`) | **no** | el contenido a medio escribir es la única evidencia del fallo |
| `temp-exists` de otra pasada | **no** | su contenido permite reanudar |

Se implementa con un `dropTemporary()` local que usa `rmSync(..., { force: true })` y no puede lanzar: el
fallo que importa es el que se devuelve, no el de la limpieza.

Verificación: `tests/identity-v3.test.mjs` (I3-03 e I3-23 actualizadas al contrato nuevo),
`tests/publish-temp-cleanup.test.mjs` (3 casos) y `_audit/probe-d3-detects.mjs`, que reconstruye el módulo
sin las llamadas de limpieza y comprueba que **el temporal sobrevive**; sin esa medición la prueba nueva no
demostraría nada.
## Recargar el adaptador del Host: `set_bundle` no basta

Medido en la ronda 4 (fase 9): tras cambiar `index.js` para pasar el servicio `workspaceRegistry` a la
comprobación del producto, `plugin_manager set_bundle({enabled: true})` respondió `application: applied` con
`changed: false` — y la comprobación siguió diciendo «el Host no expone workspaceRegistry» aunque la ruta nueva
ya existía. La explicación es que `changed: false` no vuelve a registrar la ruta: el `handler` en uso seguía
siendo el `apply()` anterior, mientras el módulo `lib/api.mjs` sí se había reimportado.

Regla operativa:

1. Cambios en `client.js` ⇒ basta recargar la página (el bundle se sirve del disco).
2. Cambios en `index.js` (registro de rutas, servicios inyectados, herramientas) ⇒ **desactivar y volver a
   activar** el bundle (dos llamadas, la segunda con `changed: true`), o reiniciar la aplicación.
3. Comprobar el efecto en la interfaz, no en la respuesta del gestor: «applied» describe el estado del bundle,
   no que el proceso haya reemplazado el adaptador.

## Comprobación del producto (fase 9, primera pieza)

La vista de Analítica puede decir si el centro está sano sin abrir cinco sitios: `GET /api/doctor` devuelve
`{ok, checks[], summary:{ok,warn,fail}}` y el panel lo pinta como «Comprobación del producto». Nueve
comprobaciones, todas de lectura:

| Comprobación | Qué mide | Umbral |
|---|---|---|
| `store-integrity` | integridad real del documento (bytes, sha) | fallo si no es `ok` |
| `schema-version` | versión dentro del rango que el producto entiende | aviso fuera de rango |
| `backup` | copia autoritativa verificada | aviso si falta, fallo si no verifica |
| `lock` | candado vivo o abandonado | aviso sólo si está vivo |
| `registry` | proyectos registrados | aviso si no hay ninguno |
| `materialized` | disco materializado vs asignaciones encendidas, proyecto por proyecto | aviso con la lista de derivas |
| `identity-inventory` | servicio `workspaceRegistry` del Host | aviso si no está |
| `improvements-pending` | propuestas esperando a una persona | aviso si hay alguna |
| `events` | diario con contenido | aviso si está vacío |

Decisiones que costaron una medición:

- **Sólo lectura.** El doctor informa; reparar es una acción humana (y sigue exigiendo la puerta de identidad
  cuando toca). Una prueba compara el sha del documento antes y después.
- **Un fallo apaga el `ok` global; un aviso no.** Si un aviso apagara el `ok`, el panel estaría en rojo de
  forma permanente en un centro sano pero sin copia.
- **El inventario del Host se pasa resuelto desde `index.js`.** El despacho puro no puede tocar `ctx`; si la
  ruta se llamara sin servicio, el renglón diría «no disponible» siendo falso. Medido: con el servicio, el
  renglón pasa a `ok` y dice cuántos workspaces hay.

## Trampa de codificación (pagada dos veces)

`Set-Content -Encoding UTF8` de **PowerShell 5.1** lee un fichero UTF-8 **sin BOM** como ANSI y lo reescribe
doblemente codificado. La comprobación de daño hay que hacerla **con Node**, no con `Get-Content`: PowerShell
5.1 muestra como mojibake cualquier fichero UTF-8 correcto que contenga acentos, y un diagnóstico basado en eso
inventa 1 200 líneas corruptas donde no hay ninguna. Regla: los parches de texto se escriben con la herramienta
`write` (o un script Node creado así) y se leen con `readFileSync(..., 'utf8')`.

## Mapa

```text
index.js            adaptador Cordis (lo único que no se prueba antes de instalar)
client.js           panel completo; se carga con un arnés mínimo en tests/client.test.mjs
lib/format.mjs      identidad: slug, ids seguros, rutas, versiones, palabras
lib/skillfile.mjs   SKILL.md: render y parseo del subconjunto de YAML que el harness lee
lib/state.mjs       documento, carga tolerante, guardado atómico, diario de eventos
lib/evaluate.mjs    compuerta de calidad (bloqueantes y avisos, puntuación)
lib/operations.mjs  mutaciones: crear, publicar, mejorar, decidir, encender, apagar, volver, clonar
lib/detect.mjs      parecido entre skills (familias de palabras, identidad)
lib/sources.mjs     recorrido de disco de lo que ya existe (sólo lectura)
lib/materialize.mjs vista materializada por proyecto (SKILL.md + referencias + manifest)
lib/provider.mjs    proveedor de skills del harness
lib/analytics.mjs   telemetría derivada de eventos
lib/api.mjs         composición: snapshot + acciones + frontera de autorización
lib/tools.mjs       cuatro herramientas del agente, objetos planos
lib/watch.mjs       invalidación del catálogo (fs.watch + sondeo)
tools/check.mjs     comprobaciones estáticas de instalación y pureza
tests/              103 pruebas y la puerta hermética
```

## Reglas que no se rompen aquí

1. **Núcleo puro.** Nada de `lib/` importa el harness. Lo verifica `npm run check`.
2. **Las pruebas no tocan el almacén real.** Cada prueba recibe una raíz temporal; y no se confía en eso:
   `tests/check-hermetic.mjs` toma la huella del almacén real, corre la suite entera en un proceso hijo y
   compara. Cambio de tamaño o de sha256 ⇒ falla.
3. **La autorización es del borde.** `lib/operations.mjs` registra `actor` pero no decide permisos; la
   política vive en `lib/api.mjs`, que es el único camino de entrada. Así la regla está en un sitio y se
   puede leer de un vistazo.
4. **Un resultado nunca se rechaza por una clave de más.** Toda herramienta declara su salida como objeto
   abierto (`additionalProperties: true`): un campo nuevo no puede tumbar la respuesta entera.
5. **Nada se activa solo.** Ninguna función de este plugin enciende una skill por el agente, y ninguna
   herramienta se llama «approve» ni «activate».

## Cómo añadir una acción

1. La mutación, en `lib/operations.mjs`, pura y devolviendo `{ok:false, code, message}` cuando algo no se
   puede hacer.
2. El caso en `runAction` de `lib/api.mjs`, con su política de actor si cambia lo que el agente ve.
3. Si cambia el catálogo, añádela a `CHANGES_CATALOG` en `index.js` (invalidación inmediata).
4. Botón en `client.js` que llame a la acción, y claves en los dos diccionarios (`es` y `en`: el test exige
   que tengan exactamente las mismas).
5. Prueba en `tests/api.test.mjs` (comportamiento + autorización) y, si toca disco, en
   `tests/materialize.test.mjs` o `tests/operations.test.mjs`.

## Cómo añadir una comprobación de calidad

`lib/evaluate.mjs`: un `check` con `code`, `severity` (`block`/`warn`), `message`, y `ok: false` si no pasa.
La puntuación es 100 − 40 por bloqueante − 8 por aviso, sin bajar de 0. Prueba el caso que falla y el que no.

## Sincronización explícita de un proyecto (fase 6)

El pin de versión no se mueve solo: aprobar una versión nueva no cambia lo que ejecuta un proyecto (decisión de
S4). Para que una persona ponga al día un proyecto existe la acción `advance`:

- `advanceAssignments(state, { projectId, skillIds? })` en `lib/operations.mjs` recorre sólo las asignaciones
  ENCENDIDAS del proyecto indicado; si la versión fijada no es la vigente, mueve el pin y emite
  `skill.advanced` con `projectId` y `version`. Las apagadas y los demás proyectos no se tocan.
- La acción es humana: la IA recibe `approval-required`. `advance` está en `CHANGES_CATALOG`, así que invalida
  el catálogo del proveedor, y materializa el `SKILL.md` en el mismo acto (junto a `toggle` y `rollback`), para
  que el disco no quede en la versión vieja hasta la siguiente lectura.
- La instantánea calcula por proyecto `updates: [{skillId, title, from, to}]` y `updatesCount`; la tarjeta
  muestra el aviso y el botón «Actualizar» sólo cuando hay algo que avanzar.
- Medido en el panel real: `proyecto-b` (pin 1.0.0, vigente 1.1.0) mostró «1 actualización»; al pulsar el
  botón, el pin pasó a 1.1.0, el diario ganó `skill.advanced` con actor `human`, el `SKILL.md` materializado
  quedó en la versión 1.1.0 y el aviso desapareció. `plugins-dhs` (ya en 1.1.0) no mostró nada.

## Trampas ya pagadas (no repetirlas)

- `isObject` no sirve para arrays: un guard con `isObject(state.events)` convertía el diario en «el último
  evento» y borraba el resto. Es `Array.isArray`, y hay una prueba de regresión.
- El resultado del `manifest.json` se descartaba: `written`/`unchanged` mentían y una asignación nueva no se
  reflejaba. Ahora se escribe sólo si cambió la lista de skills.
- Jaccard exacto no ve la flexión española: `desplegar`/`despliega` daban 0.16 y la biblioteca propia
  quedaba invisible. Familia de palabras con cinco letras de prefijo, y plurales por prefijo corto.
- Un `POST` sin acción no puede contestar con el estado: esconde el fallo justo cuando se depura. Ahora 400.
- Un `ctx` de mentira en las pruebas tiene que desmontar lo que monta: el vigilante deja un asa abierta y
  `node --test` no termina. `teardown()` en `finally`.
- Una ruta `kind:'prefix'` registrada **con barra final** sólo casa la base exacta: `/api/` respondía 200 y
  `/api/state` caía en el 404 del fallback. La coincidencia es `path` o `path + '/'`, nunca `path + 'x'`:
  se registra sin barra final y se calcula la subruta a mano.
- `workingDirectory.get()` **necesita una sesión**: sin argumentos devuelve `undefined` y el panel abría sin
  proyecto actual. La carpeta se resuelve con `agents.list()` (la sesión viva más reciente) en cada petición.
- Reescribir ficheros con acentos desde PowerShell los dejó en mojibake (leer como cp1252 y guardar UTF-8).
  Los cambios de texto se hacen con un script de Node sobre `utf8` y se comprueba que no queda `Ã`.
- Una ruta registrada con `resource` **sólo contesta `GET`/`HEAD`**: el servidor devuelve 405 a
  cualquier `POST` *antes* de mirar la ruta, así que el panel no podía guardar nada. La API va con
  `handler` y este comprueba el método.
- Renombrar `center.json` encima mientras otro proceso lo lee falla en Windows con `EPERM`. Se reintenta
  el rename y, sobre todo, se escribe **bajo candado**: sin él, dos escritores concurrentes perdían
  escrituras (50 aperturas en paralelo dejaban 31 proyectos). El candado es un fichero `wx` con tiempo de
  espera y caducidad para que uno huérfano no bloquee el centro para siempre.
- Las referencias se aceptan como mapa **o** como lista `[{path, content}]`. La lista se descartaba en
  silencio y la skill se publicaba sin sus ficheros: ahora una referencia inválida devuelve
  `invalid-references` en vez de desaparecer.
- `skill.loaded` lo produce el harness pidiendo el catálogo, no una persona: el actor `system` se conserva.
  Colapsarlo a `human` falseaba la telemetría.
- El popup de un `<select>` nativo no se puede accionar desde fuera del proceso (ni clics ni teclas), así que
  la versión fijada se cambia con el botón «Usar aquí» del cajón, no con el desplegable.
- Fijar una versión tiene que **escribir el `SKILL.md` en el mismo acto**: si no, la asignación dice 1.1.0 y
  el disco sigue en 1.0.0 hasta que alguien pide el catálogo.

## Estado de las pruebas

```sh
npm test                 # 119 · pass 119
npm run test:hermetic    # lo anterior + huella del almacén real intacta
npm run check            # 100/100 comprobaciones
```


## Operaciones de identidad (S6-B y S6-C)

Decisiones medidas que gobiernan el disco y la autorización:

1. **La publicación es un `link`**, no un `rename`: `renameSync` sobre un destino existente sobrescribe en
   silencio (medido), mientras que `linkSync` falla con `EEXIST` y deja una sola publicación en una carrera
   de dos procesos.
2. **Antes de publicar se archiva por enlace duro y se retira el nombre canónico**: copiar dejaba el destino
   ocupado para siempre (`EEXIST` eterno) y el canónico viejo ganaba siempre.
3. **El candado es por operación**, no por ejecución: el nombre del fichero identifica el trabajo
   (`.lifecode-tmp-lock-repair`) y el identificador de ejecución vive dentro. Un candado más viejo que 120 s se
   considera abandonado y se retira dejándolo dicho.
4. **El `operationId` se deriva del contenido** (rama + huella del manifiesto + workspace): reintentar la misma
   operación reutiliza su temporal y su comprobante en vez de dejar restos nuevos. Medido: cinco de los seis
   puntos de interrupción dejan cero temporales; el sexto (`afterLink`) los deja limpios tras separar el
   observador del enlace.
5. **Un gancho posterior al enlace no puede convertir un éxito en un fallo**: la publicación ya ocurrió y lo que
   falla es el observador. Por eso `afterLink` vive fuera del `try` del `linkSync`.
6. **La cuarentena se verifica por SHA y por identidad física** (`dev`+`ino`): un fichero nuevo con el mismo
   nombre obtiene otro `ino` (medido), así que la evidencia no se puede confundir con un reemplazo.
7. **Las operaciones de identidad tienen nombres propios** (`identity-link`, `identity-adopt`, `identity-fork`,
   …): `fork` a secas ya significaba clonar una skill desde el MVP y reutilizar el nombre habría convertido ese
   clonado en un `409` de migración.
8. **La política va antes que la autorización** y ambas antes de la implementación: en v2 toda operación de
   identidad responde `409 migration-required` sin escribir; en v3 la IA recibe `approval-required`.
9. **Adoptar no crea identidad**: publica el manifiesto de una identidad ya registrada (y le asigna UUID si aún
   no tenía). Un manifiesto dañado no se pisa: se repara por su rama explícita.
10. **Bifurcar archiva una identidad que existe**: sin manifiesto legible, o con el de otra identidad, la
    operación para (`fork-source-missing`, `fork-source-mismatch`). La identidad nueva no hereda asignaciones.
11. **Sin registro de workspaces el inventario nunca es completo**, así que la puerta de identidad no puede
    afirmar unicidad de UUID y responde `inventory-incomplete` con `inventory-no-registry`.

## Analítica con filtros (fase 8)

`summarize(state, { now, days, projectId, skillId })` acota **la misma** contabilidad: filtra asignaciones
(también dentro de cada fila), mejoras y eventos, y deja que el resto del cálculo no cambie. Reglas decididas y
probadas:

- Sin filtro, «skills» es la biblioteca entera. Con proyecto, son las skills **asignadas** a ese proyecto.
- Con una skill pedida, su ficha se describe igual aunque el proyecto consultado no la tenga: el filtro de
  proyecto acota asignaciones y eventos, no borra lo que el usuario está mirando.
- Un proyecto inexistente devuelve cifras vacías (y calidad `null`), nunca las globales.
- La ventana (`days`) se acota en el servidor entre 7 y 90 antes de llegar al DOM.
- El panel manda `days` y `project` por la ruta de estado y los guarda en una ref: `load` no se redefine al
  cambiar un filtro.

Trampa pagada: filtrar por skill y dejar la fila de asignaciones entera contaba asignaciones de **otras** skills
(3 en vez de 2); hay que recortar también dentro de la fila.


## Vista de identidad en el panel (S6-F)

La pestaña **Identidad** de Proyectos enseña una fila por carpeta conocida (registros del centro + workspaces del
Host) con el estado canónico, la disponibilidad, la verificación y los motivos. Se calcula en
`identityPayload({ root, registry })` y no escribe nada: clasificar no vincula.

Dos defectos reales corregidos en esta costura, ambos medidos con sondas antes de la interfaz:

- **La proyección de registros ocultaba la huella.** `identityInventory` recortaba cada proyecto a
  `{projectId, cwd, uuid, forkedFrom}`, así que el clasificador nunca veía `manifestSha256`: todo proyecto
  correctamente vinculado salía como `identity-unknown` con el motivo `inventory-incomplete`, y el inventario
  sí era completo. La proyección conserva ahora huella, fecha de registro, adopción, detach y fork.
- **Un `null` copiado a la fuerza cambiaba el estado.** Al rellenar los campos ausentes con `null`, la
  comprobación `record.forkedFrom !== undefined` se cumplía en cualquier proyecto y todos aparecían como
  `fork-registered`. La proyección copia **sólo** las claves que existen.

Además, la dimensión de verificación ya no sale `verified` cuando la carpeta está ausente: con `missing-dir` no
hay nada que verificar aunque el inventario se haya recorrido entero.


## Identidad portable (v3) — decisiones de S6-A y S6-B

Estas decisiones se tomaron al implementar las fases S6-A y S6-B de la directiva de ejecución autónoma, con la
medición delante (no por preferencia):

1. **El centro sigue escribiendo v2.** `SCHEMA_VERSION` es 2 (lo que produce la migración existente) y
   `MAX_SCHEMA_VERSION` es 3 (lo que este código puede **leer**). `IDENTITY_SCHEMA_VERSION = 3` es el requisito
   de las operaciones de identidad: en v2 responden `409 migration-required` y no escriben ni un byte. Así la
   migración productiva sigue siendo una decisión humana y no un efecto lateral de usar la API.
2. **La política va antes que la autorización.** Una operación de identidad rechazada por política (v2,
   inventario incompleto, conflicto abierto) devuelve el mismo código para una persona y para la IA; sólo cuando
   la política permite se comprueba `actor`. Si no, la IA recibiría `approval-required` y ocultaría el motivo
   real.
3. **`repair` no exige el inventario global.** Repara un manifiesto concreto en una ruta que la persona acaba de
   indicar: no crea identidad ni elige entre proyectos. Se ejecuta con `audit: 'audit-gap'` cuando la unicidad
   no se pudo comprobar, y deja constancia en el comprobante.
4. **Comprobantes durables `operations`, no eventos.** El diario se compacta (4 000 entradas); un comprobante
   debe sobrevivir. Se escriben en la **misma** `withState()` que el evento `project.manifest-anchored`, para que
   nunca exista uno sin el otro, y nunca llevan rutas absolutas.
5. **Publicación con `link`, no con `rename`.** Medido en NTFS: `rename` sobre un destino existente
   **sobrescribe en silencio** y, en carrera, dos procesos ganan (`WON`/`WON`); `link` falla con `EEXIST` y en
   carrera sólo uno gana. La publicación es: temporal `wx` + `fsync` + verificación de huella + un único
   `linkSync`. Sin `link` disponible ⇒ `publish-unsupported` y no se publica nada.
6. **El bloqueo identifica la operación, no la ejecución.** `.lifecode-tmp-lock-<operation>`; el id de la
   ejecución va dentro del contenido y del temporal. Poner el id en el nombre creaba un candado distinto por
   llamada y no excluía nada.
7. **La cuarentena es un enlace duro + retirada del canónico.** Copiar el archivo inválido y dejarlo en su sitio
   hacía imposible publicar (`EEXIST` eterno). El enlace conserva los bytes y la identidad física, se verifica el
   SHA y el `dev`/`ino`, y sólo entonces se retira el nombre canónico.
8. **La reanudación es por huella.** Si el manifiesto ya publicado tiene el SHA que se iba a publicar, la
   operación se considera completada (`resumed: true`) y no crea una segunda cuarentena ni un segundo evento.

Archivos: `lib/paths.mjs` (nombres y contención), `lib/identity.mjs` (19 estados, precedencia y puerta),
`lib/manifest-ops.mjs` (publicación exclusiva, bloqueo, cuarentena, reparación y fork), `lib/state.mjs`
(v3 legible, `PROJECT_IDENTITY_FIELDS`, `operations`, `recordOperation`/`operationOf`).

## Matriz de adopción (fase 8, cierre)

- **Qué resuelve**: ver de un vistazo, sin abrir proyecto por proyecto, dónde está cada skill y con qué
  versión la tiene fijada cada proyecto. Era la vista de «biblioteca global» que faltaba: la biblioteca es
  compartida, pero lo que cada proyecto ejecuta depende de su pin.
- **Datos**: la instantánea publica `skills[].adoption` con una fila por **todo** proyecto que tenga la skill,
  encendida o no: `{projectId, enabled, version, by, updatedAt}`, ordenada por proyecto. Se calcula de
  `state.assignments` dentro de `buildSnapshot`, no de contadores agregados: la celda tiene que mostrar la
  versión fijada y eso no se reconstruye desde los totales.
- **Decisiones**: incluye las apagadas (esconderlas daría una matriz mentirosa: un proyecto puede tener la skill
  desactivada y seguir importando a la persona); pinta en ámbar la versión que va **por detrás** de la vigente
  (el pin no se mueve solo, decisión de S4); y no es interactiva — leer no cambia nada, los interruptores viven
  en Proyectos y la sincronización tiene su propio botón con intención explícita.
- **Trampa pagada**: la prueba nueva usó nombres locales que chocaban con funciones del propio fichero
  (`projectA`) y con identificadores no importados (`tmpdir`, `randomUUID`); el síntoma se leía como «la matriz
  sólo ve un proyecto» cuando el toggle recibía `projectId: undefined`. Lección: en pruebas, los datos de una
  matriz se llaman por su rol (`rowA`, `rowB`), no como la función que los crea.
- **Verificación**: `tests/api.test.mjs` («la matriz de adopción publica encendidas, apagadas y las que van por
  detrás de la vigente»), suite **369/369**, `check` **153/153**, hermética verde; en DSH real la sección
  «Adopción por proyecto» muestra una columna por proyecto y «apagada» en las desactivadas, sin que el almacén
  cambie (`d431f763…`, 44 522 B).


## Peticiones humanas a la IA (fase 7)

El Host no expone a los plugins ningún servicio de completion: se comprobó en el catálogo de servicios
(`agentLoop`, `subagents` y `translator` existen; «genera texto» no). Por eso la creación por lenguaje
natural no se hace dentro del plugin: se hace donde sí hay un modelo —la sesión del agente— y el panel
actúa como **buzón durable**.

- La persona escribe la necesidad en «Pedir a la IA»; se guarda en `center.json` → `requests` (v2
  aditivo) con `{id, text, createdAt, status, skillId, fulfilledAt, by}`.
- El agente la ve en `lifecode_skill_status` (`requests.pending` + `items`).
- Al crear la skill con `lifecode_skill_create` y `requestId`, la herramienta llama a `request-fulfill` en el
  mismo acto: la petición queda `fulfilled` y enlazada.
- Descartar es humano; abrir una petición también (`approval-required` si el actor es `ai`).

Decisiones y trampas medidas:

1. **No fingir un modelo en la interfaz.** El panel no puede redactar la skill: sólo guarda la petición y
   muestra su estado. La alternativa (un botón que dijera «la IA lo está pensando») sería mentira.
2. **`requestId` es lo que cierra el círculo.** Sin él, la skill se crea pero la petición sigue pendiente y
   la persona cree que nadie la leyó. La creación y el enlace van en el mismo acto.
3. **Una petición sin texto no se puede guardar.** `normalizationLosses` la denuncia y `checkStoreShape`
   marca el documento `invalid-shape`: es mejor rechazar la escritura que guardar trabajo irresoluble.
4. **Duplicado idempotente.** La misma frase con una petición pendiente devuelve la existente
   (`duplicate: true`), no crea ruido en la cola.
5. **La cola ordena por llegada** (`pendingRequests`, la más antigua primero) para que el agente atienda por
   orden y no por lo que le resulte más cómodo.

## Acciones de identidad y resincronización (S6-G)

- La pestaña **Identidad** no es sólo de lectura: cada fila ofrece la acción que le corresponde
  (`manifest-missing`/`unmanaged`/`legacy-manifest-only` ⇒ **Publicar manifiesto**; `manifest-invalid` ⇒
  **Reparar manifiesto**; `detached-manifest` ⇒ **Revincular**; `linked`/`adopted` ⇒ **Desvincular**).
- Mientras el almacén esté en **v2**, el botón no queda muerto: al pulsarlo explica el bloqueo («las acciones de
  identidad se activan al migrar el almacén a v3, requiere autorización humana») y no escribe nada. Un botón
  deshabilitado sin explicación es peor que uno que cuenta la verdad.
- Cuando el almacén esté en v3, la misma pulsación abre un **diálogo de confirmación** que dice qué se escribe y
  que las asignaciones no se tocan; sólo entonces se llama a la acción (una sola vez, con `runIdentityAction`).
- **Comprobación del producto**: botón **Resincronizar vista**, que ejecuta `sync` sobre la vista materializada.
  Medido en vivo: reescribió sólo el `manifest.json` desincronizado (mtime nuevo) y **no** tocó `center.json`
  (mismo SHA y mtime), con el aviso «Vista materializada resincronizada.».
- Regla que se mantiene: leer y diagnosticar nunca escriben; sincronizar escribe la **vista derivada**, no el
  documento del centro.

## Comparación de versiones (fase 8, cierre)

- Ruta nueva `GET /lifecode-skill-center/api/diff?id=&from=&to=` que devuelve `{from, to, added, removed, preview, truncated}`
  usando **el mismo LCS** que decide si una mejora se puede publicar (`diffBodies` de `lib/operations.mjs`).
- El servidor compara: el panel no trae dos cuerpos de skill para pintar un diff. La comparación **no escribe**
  (probado con SHA antes/después) y con el centro ilegible responde **409** en vez de inventar líneas.
- En el cajón, cada versión publicada que no es la vigente tiene **Comparar con la vigente**; el resultado se pinta
  con el sello `from → to`, `+N/−N` y las líneas del preview.
- Trampa pagada: el manejador del cajón leía `skill?.currentVersion` en las **dependencias** de un `useCallback`
  colocado antes de declarar `skill` ⇒ TDZ, `slot entry crashed` y panel en blanco. Regla: en un componente, las
  dependencias de un hook no pueden referirse a una constante declarada más abajo; se resuelve dentro del cuerpo.

## Cajón, hooks y recarga del bundle de cliente

El cajón de detalle es el único componente del panel que monta y desmonta con estado propio, y ahí
se pagó un defecto caro: **la salida temprana quedó antes de dos hooks**. Con `if (skill === null) return`
en medio, React veía menos hooks que en el render anterior y el `ReferenceError: Cannot access 'skill'
before initialization` tumbaba el slot `main` entero: el panel se quedaba congelado en el último
fotograma y dejaba de aceptar clics, mientras el resto de la aplicación seguía viva.

Regla que queda escrita: **en un componente con estado, todos los hooks van antes de cualquier salida
temprana**; el estado nulo se resuelve *dentro* del efecto, no devolviendo antes de declararlo. La
prueba del panel lo comprueba sobre el cuerpo del componente (ningún `useState`/`useEffect`/
`useCallback` después de la salida), no sobre una cadena concreta.

Segunda lección, del entorno: **cambiar `client.js` exige dos pasos, no uno**. El host construye el
bundle de cliente al cargar el plugin y lo sirve con un identificador de contenido; recargar la página
no lo reconstruye. La secuencia medida es: `plugin_manager set_bundle(@local/lifecode-skill-center,
enabled:false)` → `enabled:true` → recargar la página. Y para recargar de forma fiable en esta
ventana, abrir *Herramientas de desarrollo* desde el menú **Solicitud** y recargar desde ahí: los
atajos `Ctrl+R`/`F5` enviados por automatización no siempre llegan a la página.

## Informe del centro exportable (fase 9)

- Acción nueva `export` (sólo humana) que escribe `reports/center-<stamp>.md` dentro de la raíz del centro:
  resumen, biblioteca con la nota de la versión vigente, histórico por skill, matriz de asignaciones, mejoras,
  peticiones, los 20 eventos más recientes y el diagnóstico recibido. Devuelve `file`, `bytes` y `sha256`.
- El informe es **derivado**: no se vuelve a leer para decidir, y exportar no toca `center.json` (hash y tamaño
  idénticos antes y después, probado con tres exportaciones seguidas).
- Tres decisiones que evitan sorpresas: la carpeta `reports/` se crea si falta; el fichero se abre con `flag:'wx'`
  para que dos exportaciones en la misma marca de tiempo no se pisen (nombre con milisegundos); y con el almacén
  ilegible la acción responde `store-unreadable` en vez de escribir un informe vacío que pareciera un centro sano.
- La IA no exporta: deja un fichero en disco y eso lo decide una persona (`approval-required`).
- Trampa pagada: el documento guarda la nota dentro de `evaluation.score`, no en la raíz de la versión. El primer
  cableado leía `version.score` y la columna de calidad salía con «—» en todas las filas mientras la interfaz decía
  100/100. La prueba sembraba la forma equivocada, así que no lo veía; ahora siembra `evaluation:{status,score}` y
  exige la nota en la tabla y en el histórico.

## Autonomía protegida y registro de conocimiento (ADDENDUM A)

La IA dejó de ser sólo proponente: con evidencia suficiente decide y ejecuta operaciones del ciclo de
vida. Lo que la hace segura no es una promesa, son tres piezas separadas.

1. **Registro propio.** `lib/knowledge.mjs` guarda hallazgos de subagentes, decisiones y política por
   proyecto en `knowledge.json`, con esquema propio (1), candado `knowledge.json.lock` (`wx`, abandonado
   a los 20 s) y `rename` atómico. No toca el esquema v2 de `center.json`. Leer no escribe; un documento
   ilegible no se sobrescribe (`store-unreadable`); recibir dos veces el mismo `insightId` es idempotente.
2. **Compuertas.** `lib/decisions.mjs` evalúa `policy`, `evidence`, `project`, `skill`, `evaluation` y
   `human-veto`, y devuelve **todas** con su detalle más un `reason` que dice por qué se rechazó
   (`policy-human-approved`, `insufficient-evidence`, `human-decision`, `gate-failed`). Preparar
   (`create`/`improve`) pide evidencia débil porque no cambia lo que ejecuta ningún proyecto; publicar,
   activar y avanzar el pin piden fuerte y evaluación `pass` ≥ 90.
3. **Registro de decisiones.** `autonomousDecision()` en `lib/api.mjs` registra la decisión antes de
   ejecutarla, con `decisionId`, evidencia, compuertas y `rollback`. Sin registro no hay ejecución: si
   `knowledge.json` no se puede escribir, la acción se rechaza. `recordDecision` rechaza `actor:'human'`.

**Lecciones de implementación.** (a) El registro exige que las constantes estén declaradas antes de su
uso: un `const MAX_EVENTS` colocado después de la función que lo usa tumba la suite entera con un TDZ, y
el síntoma no señala al fichero nuevo si la primera prueba que falla es otra. (b) La compuerta de
existencia de Skill aplica a todo **menos** a preparar; si se aplica a `improve`, una propuesta sobre un
id inexistente devuelve `approval-required` en vez del `missing-skill` preciso que el producto ya decía.
(c) La precedencia del `code` que se devuelve es deliberada: `human-veto` manda, para que un rechazo por
veto humano no se confunda con uno por falta de evidencia. (d) Los escenarios de prueba deben separar
«nunca asignada», «encendida por una persona» y «apagada por una persona»: mezclarlos hace que la prueba
mida la compuerta equivocada.

**Dos reglas de producto que salieron de aquí.** Publicar el mismo contenido devuelve `unchanged` sin
gastar un número de versión (antes se podía crear una 1.1.0 con el mismo checksum y diff vacío). Y pedir
el estado de asignación que ya está puesto devuelve `unchanged: true` sin duplicar el evento del diario.

Detalle operativo, tabla de compuertas y cómo revertir una decisión: `_audit/AUTONOMIA.md`.

## Política de autonomía y pruebas de render

La autonomía tiene un techo explícito y comprobable: la política. Se guarda en `knowledge.json`, no en
`center.json`, y sólo la cambia una persona.

- Acción `policy`: rechaza `actor !== 'human'` con `approval-required` **antes** de tocar disco y valida el
  modo contra `POLICY_MODES` (`policy-mode-unknown`), sin caer al valor por defecto.
- `knowledgeView` publica `policy.projects` y `modes`, así que la interfaz puede ofrecer exactamente los
  modos que el núcleo acepta.
- Panel: bloque «Política por proyecto» dentro de la bandeja de conocimiento. Los botones están
  deshabilitados para el modo vigente y delegan en `onPolicy(projectId, mode)`; la sección no habla con la
  API y no ejecuta acciones de decisión.
- Regla que hace la compuerta doble: `setPolicy` vuelve a comprobar el actor. La IA no se concede autonomía
  ni llamando a la capa de conocimiento directamente.

### Probar el render sin navegador

`tests/render.test.mjs` extrae un componente de `client.js` contando llaves (no busca el siguiente
`function`, que cortaría en una función anidada) y lo ejecuta con dobles de `e`, `Pill`, `t` y compañía.
Con eso, un fallo de ámbito o un dato con otra forma aparece como excepción con nombre en `node --test`
en vez de como un slot congelado en la ventana. Cubre `KnowledgeSection` (con política por proyecto y
almacén ilegible) y `AnalyticsView` con una foto realista.


Puertas al cerrar esta ronda: `node --test` **466/466**, `node tools/check.mjs` **208/208**,
hermética verde (`✓ centro de skills`, `✓ biblioteca de usuario: 173`, `✓ hermético`), E2E **16/16** y
mutación **14/14 (100 %)**, con 11/11 mutantes críticos detectados.

## Guardas de identidad: D4, D5 y D6

La auditoría de identidad v3 (fixtures) encontró tres formas de dañar un proyecto. Las tres se cerraron
estrechando lo que aceptan las operaciones, no añadiendo pasos nuevos:

- **D4 — reparar no sustituye un manifiesto válido.** La rama A de `repairManifest` exige que el canónico sea
  inválido (o que falte). Si es `ok` y no es el contenido que se iba a publicar, devuelve
  `repair-branch-mismatch`: escribir el manifiesto idéntico sigue siendo una reanudación `ok`.
  Además, la evidencia en cuarentena tiene que tener el prefijo de su **propia** huella en el nombre y, si su
  contenido es válido, declarar el mismo `projectId` que el manifiesto que se publica.
- **D5 — retirar exige contención.** `detachManifest` valida `dirname`/`basename` contra el `.dsh` con
  `checkProjectedFile` antes de tocar disco; un `manifestPath` externo devuelve un `path-*` y no se archiva
  ni se borra nada.
- **D6 — el fork tampoco sale del workspace.** `forkProjectManifest` hace la misma comprobación antes de
  escribir la intención, archivar por enlace duro o retirar el nombre canónico.

La regresión vive en `tests/identity-repair-guards.test.mjs` (5 pruebas). Además de pasar con el código
corregido, se midió que **detectan** el defecto: al restaurar temporalmente el código anterior, 4 de las 5
fallan (`_audit/probe-guards-detect.mjs`). El control final demuestra que las tres operaciones siguen
funcionando dentro del workspace.

## Frontera de autorización y evidencia de aplicación

**La compuerta concede y registra; la operación pura comprueba que la autorización exista.**
El QA adversarial encontró que `toggleAssignment(state, {...}, { actor: 'ai' })` devolvía `ok:true`: la
comprobación vivía sólo en `runAction`, así que cualquier llamador de `lib/operations.mjs` podía encender o
apagar sin evidencia ni registro. Ahora las tres operaciones reciben `authorized` (por defecto `false`) y
`refusesUnauthorizedAi()` devuelve `approval-required` cuando firma la IA: `toggleAssignment`,
`rollbackAssignment` y `advanceAssignments`. El borde pasa `authorized: gate.allowed === true`, de modo que
la decisión y el registro siguen en un solo sitio y la operación pura no puede quedarse abierta por olvido.

**Una entrega no es una aplicación, y la diferencia no se estima: se declara.**
`skill.loaded` lo produce el catálogo (el proyecto recibió la skill); `skill.applied` lo declara alguien con
una nota obligatoria (mínimo 10 caracteres) mediante `declare-application`. Los indicadores publican
`applications { total, bySkill[] }` y `deliveries.withoutDeclaration` = entregas de skills que nadie declaró,
no «entregas menos declaraciones»: restar dos cosas distintas inventaría un número que nadie midió.
La definición viaja con el resultado (`definitions.applications.limits`) y dice que es una declaración, no una
verificación: si la aplicación no se declaró, el panel no la cuenta.

| Señal | Quién la produce | Qué prueba | Qué no prueba |
|---|---|---|---|
| `skill.loaded` | el catálogo del proyecto | que la skill se ofreció al modelo | que se aplicara |
| `skill.applied` | una persona o el agente, con nota | que alguien declara haberla aplicado | que la declaración sea cierta |
| `deliveries.withoutDeclaration` | el indicador | entregas sin ninguna declaración | cuántas veces se aplicó de verdad |

## Interfaz en 390/768/1280/1440: cortes, prueba y trampas

El panel se revisa en cuatro anchos y los cortes viven en `client.js`, dentro del bloque de estilos:
`@media (max-width: 1080px)` (tres tarjetas KPI por fila), `@media (max-width: 760px)` (dos por fila,
riel en fila, tabla con desplazamiento propio) y `@media (max-width: 430px)` (una por fila, cabecera que
envuelve, cajón a ancho completo).

**Lo que se mide** (`tests/styles.test.mjs`):

- Los tres cortes existen y cada uno apila las rejillas que corresponden.
- **Ningún selector de un `@media` puede apuntar a una clase que no existe.** La prueba cuenta cada clase
  y exige que aparezca al menos dos veces (la regla y un `className`); una regla sobre `.lsc-shell` o
  `.lsc-table-scroll` pasaba el resto de comprobaciones y no hacía absolutamente nada.
- En tableta y en móvil **el cuerpo se apila** (`.lsc-body { flex-direction: column; }`) y el riel pierde
  su ancho fijo.

**Trampa medida en la ventana real**: a 430 px el contenido seguía cortado a la derecha porque se apiló
`.lsc-wrap` (que ya era una columna) en lugar de `.lsc-body`, que es la fila que pone el riel al lado del
contenido. El síntoma era una tarjeta cortada por el borde y el riel conservando sus 196 px.

Evidencia: `_audit/ux-430.png` (riel en fila, tarjetas dentro del ancho), `_audit/ux-768.png` y
`_audit/ux-1280.png`; las capturas se toman reabriendo el panel **antes** de redimensionar, porque el
panel no se abre con un clic fiable cuando la ventana es estrecha.

## Descubrimiento de proyectos sin sondeo (directiva §7)

El registro de workspaces del Host se consulta **a petición**, con dos reglas que una prueba fija
(`tests/discovery-contract.test.mjs`, cuatro casos):

1. **La foto del panel no lo toca.** `/api/state` se refresca cada 20 s, así que si el inventario viajara en
   esa foto cada panel abierto estaría sondeando el registro del Host veinte veces por minuto sin que nadie
   lo pidiera. La prueba pasa un registro falso que cuenta llamadas y exige cero.
2. **Una petición, una lectura del registro.** Al abrir la pestaña de proyectos, el inventario lista el
   registro una vez y pregunta `status()` una vez por workspace; la vista de identidad reutiliza esa misma
   lectura (`identityPayload({ root, registry, workspaceItems })`) en lugar de volver a listar.

Descubrir **no escribe**: la prueba compara los bytes de `center.json` y su `mtime` antes y después de
construir el inventario, y el despacho puro de `/api/workspaces` contesta `503 workspace-registry-unavailable`
en vez de fingir un inventario que no puede resolver (el adaptador es el que sí tiene el servicio).

La capacidad de identidad (v3) se **declara** en la foto (`identity.available`, `requiredSchemaVersion`), pero
no se ejecuta al descubrir: en un centro v2 las nueve acciones siguen bloqueadas con `409 migration-required`.

## Creación por IA: idempotencia por petición y duplicados (directiva §9)

Dos reglas, medidas en `tests/create-idempotency.test.mjs`:

1. **Reintentar no duplica.** Si el agente crea con un `requestId` cuya petición ya está cumplida, la
   respuesta es la skill que ya existe (`{ ok, idempotent: true, id, message }`), la biblioteca sigue con
   una sola copia y no se escribe nada nuevo. Sin esa puerta, un reintento por timeout dejaba dos skills
   iguales y una petición huérfana.
2. **Consultar la biblioteca no es opcional.** Al crear, `similarSkills` compara el título normalizado, las
   etiquetas en común y el solape de descripciones; si encuentra parecido, la respuesta trae
   `duplicates: [{ id, title, reasons }]` con la razón escrita («mismo título», «etiquetas en común: …»).
   No bloquea: crear una variante puede ser legítimo, pero el agente y la persona lo ven antes de publicar.

La herramienta `lifecode_skill_create` lo refleja en su resumen (`Possible duplicates in the library: …`) y
marca el reintento como `already-created`, para que el modelo no anuncie una creación que no ocurrió.

## Elector de operación y cobertura medida (criterios 2, 13 y 20)

- **Parecido en un solo sitio**: `lib/similarity.mjs` (`normalizeText`, `wordOverlap`, `similarSkills`)
  alimenta el aviso de duplicados y el elector. Antes había dos copias del criterio y podían divergir.
- **Elector**: `chooseOperation` en `lib/decisions.mjs` responde `create-skill` o `improve-skill` con
  `skillId` y razones escritas; la acción `plan` de la API lo expone en **sólo lectura** (no crea ni
  escribe) y responde `candidate-required` sin título y descripción.
- **Enlace con el hallazgo**: `create` acepta `insightId`; la respuesta trae `insightLink` y el hallazgo
  pasa a `triaged` con `appliedSkillId`. **No** se marca `acted-on`: eso exige decisión en el ledger.
  Si el hallazgo no existe, la skill se crea igual y se informa `code:'insight-not-found'`.
- **Cobertura**: `tools/coverage.mjs` usa la cobertura nativa de Node (`--experimental-test-coverage`,
  sin dependencias) limitada a `lib/**`, `index.js` y `client.js`, y escribe `_audit/COBERTURA.md`.
  Medido: **línea 95,86 % · rama 75,51 % · funciones 80,92 %** sobre 26 ficheros de producto.

## Distribución visible en el panel (directiva §8)

`ImportSection` pega un paquete en la biblioteca (`act('import-bundle')`) y el cajón exporta la
versión abierta (`act('export-skill')`, botón junto a Cerrar). Ambas acciones son humanas en el
servidor: la interfaz no habla con la API a mano, pasa por `act`, que ya fija el canal.

## Distribución entre centros: paquete portable e importación aislada (directiva §8)

La biblioteca de un centro es global para ese centro: un almacén, varios proyectos. Distribuir una skill a
otro centro es un acto distinto y tiene su propio contrato, en `lib/distribute.mjs`:

- **Paquete con huella.** `skillBundle(state, skillId, { version })` produce
  `schema: lifecode-skill-center/skill-bundle`, `schemaVersion: 1`, la versión concreta (por defecto la vigente)
  con cuerpo, referencias y metadatos, y `checksum` = sha256 del JSON canónico de lo que un proyecto ejecuta.
  `readBundle` recalcula esa huella: un fichero tocado a mano se rechaza con `checksum-mismatch`.
- **Exportar no pisa ni escribe el almacén.** `writeBundle` escribe `exports/<id>-<version>.json` con
  `flag: 'wx'`; la segunda exportación de la misma versión devuelve `bundle-exists` en vez de reemplazar un
  artefacto que quizá ya se distribuyó. La prueba compara los bytes de `center.json` antes y después.
- **Importar es crear una copia aislada.** Si el id ya existe en el destino, se importa como `<id>-copia`,
  `<id>-copia-2`…, con `origin.kind: 'import'` y `origin.from`; la skill existente y sus asignaciones no se
  tocan (la prueba compara el JSON de la original antes y después y exige `assignments === {}`).
- **La calidad no se salta al importar**: la copia entra por `createSkill`, con su evaluación y su versión
  inmutable. Un paquete manipulado o de otro esquema no entra (`invalid-bundle`, `unsupported-schema`).
- **Quién puede**: exportar e importar son actos de una persona (`approval-required` para la IA); la
  importación escribe con el candado y la copia de seguridad del resto de actos (`withState`).

Lo que este contrato **no** hace, y se dice para no confundirlo: no sincroniza dos centros, no resuelve
conflictos entre copias ni elige cuál es la buena. Eso es de un acto humano, con las dos versiones delante.

## Filtros de estado y resultado, y del gráfico a los eventos (directiva §5)

El diario no guarda «estado» ni «resultado»: guarda `type`, `actor`, `at` y notas. Por eso dos filtros
pedidos por la directiva se derivan en el núcleo (`lib/insights.mjs`) con una regla única y explicable:

- `eventStatus(event)` → `pending` (mejora propuesta), `approved`, `rejected`, `applied` (`skill.applied`) u
  `other`.
- `eventResult(event)` → `failed` si el tipo termina en `.failed`/`.error`/`-failed`, `ok` para los tipos
  que describen algo que ocurrió (crear, cargar, aprobar, avanzar, revertir, exportar…), `info` el resto.
- `EVENT_STATUSES` y `EVENT_RESULTS` se publican en `insights.options`, y el panel pinta sus desplegables a
  partir de ahí: la vista no mantiene su propia lista de estados.
- Los elementos de `events.recent` llevan también `status` y `result`, así que la lista de eventos y los
  filtros hablan del mismo dato.

**Del gráfico a los eventos**: `ActivityChart` acepta `onPick(day)`; los días con actividad son pulsables
(`cursor: pointer`, `title` que lo dice en palabras) y `AnalyticsView` los traduce a
`onFilters({ from: day, to: day })`, es decir al **mismo filtro del servidor**. La lista «Eventos del rango»
responde a ese rango y a los filtros de estado/resultado. Se probó con un recorrido recursivo del árbol de
render (`tests/render.test.mjs`), no con una captura: el doble de `e` guarda los hijos en `node.children`
y buscar manejadores en el JSON no sirve porque `JSON.stringify` descarta las funciones.

## Reversiones de pin y aviso de duplicados en la interfaz (ADDENDUM A)

El ADDENDUM pide que la interfaz muestre «acciones automáticas, pins movidos, rollback» y los «duplicados».
Las dos piezas que faltaban ya están:

- **Reversiones de pin** (`lib/insights.mjs`): `rollbacks` se calcula del diario filtrado
  (`event.type === 'skill.rollback'`) y publica `{ total, latestAt, bySkill: [{ skillId, title, count }] }`.
  La definición declara su fuente (`events:skill.rollback`) y su límite: **cuenta reversiones, no éxitos**
  ni dice por qué se revirtió — eso vive en la decisión del ledger. El panel (`InsightsSection`) lo pinta
  con un total, la fecha de la última y una fila por skill; sin datos muestra su vacío en vez de un cero seco.
- **Aviso de duplicados al crear** (`client.js`): cuando `create` devuelve `duplicates`, la notificación
  `toast.duplicates` nombra hasta tres ids y el número de parecidos. El aviso no bloquea la creación: la
  regla de la casa es **decidir con la persona informada**, no impedir el trabajo.

Comprobaciones asociadas (`tools/check.mjs`): la definición sale de `skill.rollback`, se cuenta por skill,
el panel tiene su vacío y su «última», y la biblioteca usa `result.duplicates`.

## Rendimiento y seguridad de las rutas que se refrescan (directiva §12)

### El defecto que encontró la medición

`buildSnapshot` barría las skills externas del proyecto y de la biblioteca del usuario **en cada lectura**,
y `/api/state` se refresca solo cada 20 s. Con una biblioteca de 200 skills y 4 000 eventos, el perfil de CPU
mostraba `readFileUtf8` al 48 % y `readdir` al 15 % del tiempo: nadie miraba esos candidatos en ese refresco.

| Ruta | antes | después |
|---|---|---|
| `buildSnapshot` (200 skills, 4 000 eventos) | 101 ms | **34 ms** |
| `GET /api/state` | 108 ms | **31 ms** |
| `buildInsights` (sobre el estado ya leído) | 3 ms | 3 ms |

Medido con `node tools/perf.mjs` sobre un almacén temporal; el informe completo vive en `_audit/RENDIMIENTO.md`.

La regla que queda: **el barrido del disco se pide, no se hereda.** `buildSnapshot({ scan: false })` por
defecto, `/api/state` sólo barre con `scan=1`, y abrir el panel tampoco barre. El panel pide candidatos con la
acción `detect` cuando una persona pulsa «Buscar fuera». `tests/state-scan-contract.test.mjs` lo mide con una
skill externa real en el proyecto: sin pedirla no aparece, con `scan: true` sí, y abrir el panel deja el total a 0.

### Seguridad de la distribución

El id de una skill viaja desde fuera y se usaba para nombrar el fichero del paquete: un id como `../../otro`
escribía fuera de `exports/`. Cerrado en `lib/distribute.mjs`:

- `isSafeBundlePart` valida la forma (`/^[a-z0-9][a-z0-9-]{0,63}$/` para el id, `/^\d+\.\d+\.\d+$/` para
  la versión). `bundlePath` devuelve `null` si no cuadra y `writeBundle` responde `unsafe-bundle-name` **antes**
  de crear la carpeta; la prueba comprueba que `exports/` ni siquiera llega a existir.
- `readBundle` no parsea más de `MAX_BUNDLE_BYTES` (512 KB): un paquete gigante devuelve `bundle-too-large`.

## Ronda 11: ciclo de vida del conocimiento, origen verificado y E2E autónomo

El conocimiento que aporta un subagente entra como **declaración**, no como verdad. `lib/knowledge.mjs` guarda
`origin { declared, verified, verifiedBy, verifiedAt, note }`: el subagente declara `sourceAgent`/`parentRunId`/`sessionId`
y sólo una prueba del Host (`subagents.listChildren` desde la ruta `origin-verify`, canal humano) eleva `verified` a `true`.
Ningún hallazgo se ejecuta como instrucción: se lee, se comprueba y se decide.

El ciclo `received → triaged → validated → decided → acted-on` tiene una guarda dura: `acted-on` exige `decisionId` y
`action.ok === true`. Leer, enlazar una skill o decidir no cierra el ciclo; un fallo deja el hallazgo pendiente con su motivo.
Los estados `merged`, `documented`, `deferred`, `rejected` y `contradicted` están disponibles, y una contradicción se
preserva (las dos fuentes se muestran) en vez de fusionarse.

Dos caminos separados: una persona conserva las confirmaciones del camino humano; el camino autónomo pasa por
`autonomousDecision()` y sus compuertas, sin desactivar `approval-required`. La evidencia **fuerte** sólo cuenta hallazgos
**citados** por la operación (y sólo huellas distintas): preparar puede apoyarse en el registro, activar o publicar no.
El `payload` no puede firmar `explicitRequest` ni elegir la skill a evaluar; el servidor deriva ambos del almacén.

`tools/e2e-autonomous.mjs` recorre 24 pasos por las rutas públicas (no sólo funciones internas) sobre un almacén temporal:
casos A–E, aislamiento entre proyectos, veto humano, publicar sin mover el pin, avance autorizado, rollback autónomo que
conserva la versión problemática, `acted-on` y contradicciones. `tools/mutation.mjs` sólo cuenta un mutante como detectado
si además hay pruebas fallando, y sale con código 1 cuando sobrevive alguno.
## Ronda 12: el asiento dice si se ejecutó, y la IA opera en su carpeta

Dos huecos del Red Team que afectaban a la confianza del ciclo autónomo:

- **RT-D3 — autorizar no es ejecutar.** El asiento de la decisión se escribía en la compuerta y nunca se sabía si la
  operación había terminado. Ahora `settleDecision(document, { decisionId, ok, detail }, now)` cierra el asiento con
  `settled { ok, detail, at }` y el evento `decision-settled`; `settleGate()` lo llama en las siete ramas autónomas
  (crear, publicar, mejorar, aprobar, alternar, revertir, avanzar). Un rechazo del producto también se anota como
  fallido, porque para el registro autorizar y no ejecutar es distinto de ejecutar. La normalización del documento
  **conserva** el campo: sin eso se habría escrito y perdido al leer, que es la peor forma de tener registro.
- **RT-D5 — la carpeta manda.** La IA podía mandar `projectId` de un proyecto que no era el de su `cwd`. Ahora
  `bindAiProject(state, data, cwd, actor)` deduce el proyecto de la carpeta, rechaza con `project-mismatch` cuando el
  payload nombra otro, y la compuerta recibe el proyecto ligado (no el del payload) en `toggle`, `rollback` y
  `advance-pin`. Una persona no pasa por la ligadura: en el panel sí cambia proyectos a propósito.

Pruebas: `tests/autonomy-binding.test.mjs` (5 casos, incluido el control de que una persona sigue pudiendo alternar
cualquier proyecto). Medido contra el código anterior, neutralizando `bindAiProject` y las siete llamadas a
`settleGate`, fallan 4 de 5 y el control sigue verde.

## Ronda 13: defectos residuales, política por proyecto y documentación honesta

### Política de autonomía: qué se comprobó y qué queda abierto

`setPolicy` exige `actor === 'human'` (la IA no puede concederse autonomía), la política se guarda por proyecto (`document.policy.projects[id]`) y `policyFor` no la hereda entre proyectos: devuelve `source: 'project'` o `source: 'global'`. La compuerta de las decisiones lee el modo efectivo.

Se intentó endurecer el defecto a `human-approved` (un proyecto sin concesión explícita no sería autónomo). Medido: **215 de 576 pruebas fallaron**, porque la suite entera simula decisiones de IA sobre almacenes temporales sin conceder política. Se revirtió y se declara como **riesgo residual**: hoy un proyecto sin política propia hereda el modo global `guarded-autonomous`. El plan de cierre es doble: (1) sembrar concesión humana explícita en los escenarios de fixture mediante un helper, (2) cambiar el defecto y la compuerta a `source === 'project'`. No se hizo a medias.

### Pruebas engañosas sustituidas (ronda 13)

| Prueba | Antes | Ahora | Cómo se probó que detecta |
|---|---|---|---|
| `tests/paths.test.mjs` T6/T10 | `ok(true, 'junction no disponible')` contaba verde | `tc.skip(...)` | sin junctions la suite informa `skipped 1` |
| `tests/render.test.mjs` aplicaciones | `flat.includes('3')` | ancla `withoutDeclaration{"n":"3"}` y caso con 7 | clavando `n: '3'` en `client.js` la prueba cae |
| `tests/repair-api.test.mjs` fallo de publicación | toleraba éxito y fallo | `ok === false` + `code === 'exists'` + bytes intactos | mutando la publicación para que gane siempre, la prueba cae |
| `tests/migrate-control.test.mjs` | leía `client.js` como texto | ejecuta `onMigrateRequest`/`onMigrateConfirm` con dobles | quitando la guarda `canMigrate` la prueba cae |

### Codificación

`tests/fixtures/writer.mjs` estaba doblemente codificado y además llevaba tres bytes U+FFFD que rompían `node --check`; se reparó con round-trip latin1→utf8 y se quitaron los bytes. La codificación se comprueba con Node (`readFileSync(…, 'utf8')` y búsqueda de U+FFFD), nunca con `Get-Content` de PowerShell 5.1.

## Ronda 14: procedencia de la política, recuperación y ataques

- La política global heredada se clasifica `legacy-unverified`: `policyFor()` devuelve `mode:'human-approved'` y
  `storedMode` con el valor original, y la compuerta no la acepta. Una concesión global sólo cuenta con
  `policy.granted = { at, by }` escrito por una persona (`setPolicy` rechaza a la IA).
- `unsettledDecisions()` y `knowledgeView.pendingSettlements` permiten recuperar una ejecución interrumpida;
  `settleDecision` devuelve `settled-conflict` antes que reescribir un resultado.
- Nueve ataques §7 en `tests/autonomy-attacks.test.mjs`; once escenarios de procedencia en
  `tests/policy-provenance.test.mjs`; cinco de recuperación en `tests/settlement-recovery.test.mjs`.
- Trampa medida: un `Date` pasado como `now` se convertía en cadena vacía al normalizar (`text()` sólo admite
  cadenas) y la concesión desaparecía del disco; se añadió `toIso()` y se aplicó en `withKnowledge` y `setPolicy`.
