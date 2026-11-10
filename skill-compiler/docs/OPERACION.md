# Operación

Referencia de uso: herramientas, CLI, variables y qué hacer cuando algo no cuadra.

## Herramientas (las llama el modelo)

| Herramienta | Parámetros | Devuelve |
|---|---|---|
| `skill_propose` | `id`, `description`, `body` (obligatorios) · `whenToUse`, `evidence[]`, `tags[]` | `status`: `proposed` · `conflict` · `invalid` · `no-project`, con el resumen y, si las hay, las colisiones |
| `skill_vendor` | `url` (obligatorio) · `id`, `description`, `whenToUse`, `localNote`, `tags[]` | `status`: `proposed` · `blocked` · `conflict` · `needs-choice` · `bad-url` · `fetch-failed` · `invalid` · `no-project` |
| `skill_review` | ninguno | Las pendientes y las aprobadas **del proyecto actual**. Solo lectura: no aprueba |
| `skill_upstream_check` | `id` | `changed: true/false`, los dos SHA-256 y la URL |

El **ámbito no es un parámetro**: lo calcula el plugin desde el `cwd` de la sesión. Es lo que impide que
una skill aterrice en el proyecto equivocado.

## Comandos en el harness (los usas tú, dentro de la sesión)

Aquí vive **aprobar** cuando no quieres salir del harness: son comandos del compositor, corren contra el
agente **sin crear mensaje del modelo**, y su resultado se pinta en la interfaz sin entrar en el historial
del modelo. El registro de la sesión guarda cada ejecución.

Cada operación tiene **un nombre por idioma** y solo está registrado el del idioma activo: los nombres de abajo
son los del idioma `es`. Con `en` son los ingleses (`/skill-approve`, `/skill-proposals`, …). Se cambia con
`/skill-compiler-language --es|--en` y el menú `/` cambia sin reiniciar; `DSH_LANG` manda sobre la preferencia
guardada, y el idioma base es `en`.

### Cambiar el idioma, paso a paso

```
/skill-compiler-language              idioma activo, de donde sale (env | config | default) y los nombres de cada uno
/skill-compiler-language --es         pasa a español: registro y menú "/", sin reiniciar
/skill-compiler-language --en         vuelve al inglés (el base)
node bin/skill-compiler.mjs lang es   guarda la preferencia desde el terminal (o "lang" para consultarla)
DSH_LANG=es                           variable de entorno: manda sobre todo y no escribe nada
```

Qué comprobar después de cambiarlo:

- `doctor` dice **«16 operaciones y 16 filas en `<idioma>`»**; si `DSH_LANG` trae un valor que no es idioma, lo
  dice una vez y sigue con `en`.
- El nombre del otro idioma **no está registrado**: teclearlo responde «comando desconocido» y no toca el
  almacén. No es un alias; es el mismo comando con otro nombre.
- Un idioma que no se admite (`--fr`) es un error y **no escribe nada**.
- Las filas del menú siguen al idioma (`skill-aprobar-<id>` en `es`, `skill-approve-<id>` en `en`), y el id va
  detrás.
- Lo que **no** cambia: ids, banderas, códigos de resultado, formato del almacén, vocabulario del diario y el
  contenido de las skills. Si algo de eso cambia con el idioma, es un defecto: repórtalo.


```
/skill-propuestas              qué espera tu aprobación y qué está activo, en este proyecto
/skill-ver <id>                la propuesta entera (o la ya activa), con el veredicto de la puerta
/skill-aprobar [<id>] [--force]  activarla; SIN id, enseña lo que hay (y arma las filas)
/skill-rechazar <id>           apartarla sin borrarla
/skill-auto [activar|desactivar]  aprobar automáticamente en ESTA sesión
/skill-propiedad [dsh-only|machine]  quién manda en la creación de skills de este puesto
/skill-sistemas                los sistemas del puesto y los ids que viven en más de uno
```

### Elegir en el menú, en vez de escribir sintaxis

Además de los comandos de arriba, **cada pendiente se anuncia en el menú `/` con tres filas** —leer entera,
activar, apartar sin borrar— llamadas `skill-ver-<id>`, `skill-aprobar-<id>` y `skill-rechazar-<id>`. No
tienen argumentos a propósito: en el contrato del harness, un comando del host que no reclama argumentos se
ejecuta **en el acto** al elegirlo en el menú, así que seleccionar la fila **es** la decisión, sin recordar
ni teclear nada. Teclear el comando entero hace exactamente lo mismo: son los mismos comandos.

**Las filas son de una sesión, no de todas.** Se registran en el ámbito de **su** agente —bajo `agent.ctx`,
que el plugin obtiene del provider: el registro del harness lo llama con `{ cwd, agent }` en cada sesión que
pide su catálogo—, así que en una sesión aparecen las pendientes de su proyecto y ninguna de otro. Antes
se registraban en el global y el humano llegó a ver, en el menú de un proyecto, las pendientes de otro:
ofrecidas y condenadas a fallar, porque la puerta —que sí comprueba el ámbito— las rechazaba con razón.

Se recomponen cuando cambia el almacén (aprobada una pendiente, su fila deja de ofrecerse) y decidir en una
sesión **no** toca las filas de las demás. Al descargar el plugin no queda ninguna: el plugin conserva las
retiradas de cada agente, porque el harness avisa de que descargarse él no libera por su cuenta lo
registrado bajo `agent.ctx`.

**Y se montan por dos caminos, no por uno.** El primero es el provider de skills, que recibe cada sesión con su
agente cuando el harness le pide el catálogo. El segundo es **cualquier comando humano**: al ejecutarlo, el
plugin vuelve a intentar el montaje de esa sesión antes de responder. Hizo falta porque el montaje podía caerse
sin decirlo —la documentación prometía lo contrario— y el agente quedaba cacheado a medias, así que ningún
intento posterior lo arreglaba: la sesión se quedaba sin menú y el único rastro era «no hay filas que decidir
en el catálogo de esta sesión». Ahora, si el montaje no registra nada, `/skill-propuestas` **lo dice** con el
motivo, reintenta hasta tres veces y recuerda que las decisiones funcionan igual escribiendo el comando entero.

Dos cosas que no se delegan nunca: **la puerta de validación** (una propuesta que no la pase no se activa,
ni con el modo automático) y **el registro** (todo queda en el log de la sesión).

### Deshacer el aprendizaje: apagar y retirar

Una skill aprobada no es para siempre, y el ciclo tiene dos gestos distintos a propósito:

| Gesto | Qué hace | ¿Se puede deshacer? |
|---|---|---|
| **Apagar** (`disable`, `/skill-deshabilitar <id>`) | Deja de servirse al modelo y sale de las activas. **Se conserva entera.** | Sí: `enable` / `/skill-habilitar <id>` |
| **Retirar** (`delete --yes`, `/skill-eliminar <id> --yes`) | La carpeta sale del almacén a un **respaldo fechado** con su huella. | Sí, con `restore <id>` desde el terminal |

Nada se borra nunca: retirar **mueve**. El respaldo vive en
`$DSH_HOME/backups/skills-eliminadas/<fecha>/<proyecto>/<id>/`, y `restore` lo devuelve a `approved/`
negándose si ese id ya existe (restaurar no puede destruir lo que hay). `retired` y `/skill-retiradas`
dicen qué está apagado y qué se retiró, con la fecha.

Tras apagar, encender o retirar, el plugin **avisa al catálogo** que sirve el dato: el registro de skills
cachea sin TTL, y sin ese aviso el agente seguía teniendo delante la skill apagada (pasó en vivo; el defecto
estaba sólo en las tres acciones nuevas, no en aprobar ni rechazar). `/skill-propuestas` muestra además la
lista de **apagadas**, con cómo devolver cada una.

**Límite que se declara**: la lista de *skills* del menú `/` la pinta el anfitrión con su propia caché de
sesión, y un plugin no puede invalidarla. Lo que desaparece al instante es lo que sirve el plugin —el
catálogo del agente—; del menú del compositor desaparece al reconectar la sesión.

En la tarjeta, las **casillas** deciden en lote: `Volver a encender las marcadas` y `Retirar las marcadas`,
con el paso de confirmación que dice cuántas son y que hay respaldo. El menú `/` ofrece una fila por cada
skill **apagada** (`skill-habilitar-<id>`, `skill-eliminar-<id>`): son pocas por definición —lo que acabas
de apagar— así que no llenan el menú, y es donde se decide su vuelta. Las pendientes siguen teniendo las
suyas (`skill-aprobar-<id>`, `skill-rechazar-<id>`, `skill-ver-<id>`).

### Cerrar un resultado

Los resultados de estos comandos se pintan en el flujo del chat con una **X** en la esquina derecha: eso lo
cierra. Colapsar y cerrar son cosas distintas —colapsar lo deja a un clic, cerrar lo quita de la vista
mientras dure la pestaña— y ninguna de las dos toca el log de la sesión ni el almacén del plugin. Dos
ejecuciones del mismo comando dejan dos bloques y se cierran por separado: cerrar uno no cierra el otro.

### Decidir en lote, desde la lista

La tarjeta de `/skill-propuestas` ofrece la lista **marcable**: una casilla por pendiente y una barra con
`Aprobar las marcadas (N)` / `Apartar las marcadas (N)`, más `marcar todas`. Marcar no decide: después hay
un **paso de confirmación** con el resumen de lo que se va a hacer (los ids, y que cada una pasa por la
misma puerta y queda registrado), y sólo entonces se ejecuta. Tras el lote, la tarjeta dice
`N aprobadas · M con fallo` —con el motivo de cada fallo— y cuántas pendientes quedan.

Las pendientes se leen del **catálogo del host**, donde cada una tiene su fila `skill-aprobar-<id>`, y cada
decisión se ejecuta **como el comando**, por el mismo camino que si lo tecleases: la misma puerta, el mismo
registro y el nodo en el flujo de la sesión. Si el anfitrión no dejara ejecutar comandos desde la pieza de
interfaz, la tarjeta lo dice con el motivo; entonces la vía es el menú `/` o el terminal, que funcionan
igual. La tarjeta de `/skill-ver` ofrece lo mismo sobre la propuesta que acabas de leer: `Aprobar esta` /
`Apartar esta`.

### Una lista que quedó atrás

El resultado de un comando es el registro de lo que pasó **cuando se ejecutó**, y no se reescribe. Por eso,
si después de una lista apruebas o apartas algo, ese bloque se marca: enseña una banda («Aprobaste algo
después de esta lista…») y se pliega solo, para que no siga describiendo un almacén que ya cambió. Sigue
ahí, desplegable, porque es lo que pasó; lo que no hace es fingir que sigue vigente.

El estado al día lo tienes en el bloque de la decisión, que termina siempre con `Pendientes de tu aprobación
(N)` y la lista.

### El modo de aprobación automática

`/skill-auto activar` hace que las skills y los parches que se propongan en esa sesión se activen solos.
El estado **no vive en memoria**: se pliega del log de la sesión (el `command/run` que deja el comando), así
que sobrevive a recargar el plugin o reiniciar la app, y deja rastro de quién lo activó. Se para cuando
quieras con `/skill-auto desactivar`.

Con el modo activo, lo que **sí** se delega es la confirmación caso por caso. Lo que **no**: la validación,
el anti-solapamiento (un conflicto no se aprueba), el bloqueo de orígenes con contenido peligroso y el
registro. La herramienta lo dice en su propio resumen («APROBADA AUTOMÁTICAMENTE…» o «no se ha aprobado:
…»), así que el modelo tampoco puede creerse otra cosa.

### Disponible sin reiniciar

Aprobar avisa al registro de skills, y el agente recibe el catálogo actualizado **en su siguiente paso**;
`/nombre` carga la skill en la misma sesión. Medido en vivo el 2026-10-13, en el log de la sesión de
`saas-corporative`: la aprobación quedó en `seq 8675` y el catálogo del paso siguiente, `seq 8688`, ya la
incluía — 34 skills antes, 35 después, sin reiniciar el harness. Lo que no está en manos del plugin es el **menú desplegable**
del compositor, que cachea por sesión: escribir el nombre funciona igual, y la lista sugerida puede tardar
hasta que la sesión cambie de preset o se reconecte.

**Las dos capas que componen ese catálogo están observadas** (desde 1.5.1): el almacén del plugin —que es
suyo y se crea si falta— y la **biblioteca curada** del harness (`$DSH_HOME/skills`), que es ajena: se
observa sólo si ya existe, porque vigilar no puede crear un directorio que no es nuestro. Un cambio en
cualquiera de las dos avisa al registro, que recompone el catálogo entero. Sin la segunda, mover o retirar
una skill de la capa global dejaría a las sesiones abiertas con la lista anterior.

### Actualizar una skill que se quedó corta

Una skill aprobada no es intocable. Cuando lo aprendido la supera o la corrige, el modelo propone **con el
mismo id** y eso es una actualización, no un duplicado: la propuesta queda pendiente como cualquier otra, y
al aprobarla la versión anterior **se aparta** en `superseded/<id>-<fecha>/` — nunca se borra, así que el
historial de lo que se sabía no se pierde. La tarjeta del resultado lo dice («updated» en vez de «created»),
y el protocolo pide al modelo mirar antes qué hay con `skill_review`.

Para el anti-solapamiento, lo que decide no es **dónde** está la otra skill, sino **de quién es**. Lo que
escribió este plugin —una propuesta, una aprobada, y también lo que publicó en la biblioteca de usuario— se
actualiza con el mismo id sin problema. Lo que escribió **otra herramienta** sí se veta: no se suplanta en
silencio, y el mensaje al modelo le dice que la vía es otro id, no «mejorar» algo que no es nuestro.

## El ámbito: en este proyecto, o para todos tus proyectos

Una skill aprendida sirve, por defecto, **sólo en el proyecto donde se aprendió**. Pero hay conocimiento que
no es de un proyecto: y al aprobar se elige dónde vive.

| Ámbito | Dónde vive | Quién lo sirve |
|---|---|---|
| **Local** (por defecto) | `$DSH_HOME/skill-compiler/projects/<clave>/approved/` | el plugin, sólo en ese proyecto · rango 150 |
| **Global** | `$DSH_HOME/skills/<id>/` | el **harness**, en cualquier sesión · rango 400 |

```sh
/skill-aprobar <id>                 # sin decir el ámbito, pregunta: no aprueba a ciegas
- **Un id mal tecleado no es un callejón**: si te equivocas en una letra, el comando responde con
  «¿Querías decir «…»?» y no mueve nada. La sugerencia es determinista y sólo sugiere: aprobar sigue siendo tuyo.

/skill-aprobar <id> --local         # sólo en este proyecto
/skill-aprobar <id> --global        # para todos tus proyectos (lo publica en la biblioteca de usuario)
/skill-globalizar <id>              # lo mismo, dicho de otra forma (es la fila del menú)
/skill-ambito <id> --global|--local # cambiar de sitio una que ya aprobaste, en las dos direcciones
```

Y las **filas del menú `»/»`** (cuando el anfitrión compone el registro de comandos en el contexto del agente; si
no, `/skill-propuestas` imprime la orden exacta que las decide — ver [`ANFITRION.md`](ANFITRION.md)): cada pendiente
ofrece las cuatro —`skill-ver-<id>`, `skill-aprobar-<id>`,
`skill-globalizar-<id>` y `skill-rechazar-<id>`— así que aprobar para todos es elegir la fila, sin recordar
ninguna sintaxis.

Tres cosas que conviene saber antes de publicar:

- **La biblioteca de usuario es compartida.** Ahí escriben también otras herramientas, así que el plugin
  **no pisa** nada que no sea suyo: si el id está ocupado por una skill ajena, lo dice y no toca el fichero.
- **Publicar no es copiar: es verificar.** La huella del destino tiene que coincidir con la del origen; si no
  coincidiera, no se retira el original y se avisa.
- **Una sola copia efectiva.** Publicar **mueve** la skill: la saca del proyecto (deja la constancia en
  `published/`) para que el mismo conocimiento no viaje dos veces al prompt con dos rangos distintos. Y si
  cambias de idea, `/skill-ambito` la trae de vuelta.

El resto del ciclo de vida vale igual para una global, con `--global` en la CLI: apagar (sale de la
biblioteca a nuestro almacén, reversible), encender, retirar (respaldo fechado con su huella) y restaurar.

**En aprobación automática, siempre local.** El modo de `/skill-auto` delega la confirmación, no la puerta
**ni el alcance**: un gesto delegado no publica en todos tus proyectos por su cuenta.

## CLI (la usas tú)

```sh
cd <donde-clonaste-el-repo>/skill-compiler
node bin/skill-compiler.mjs <comando> [argumentos] [opciones]
```

| Comando | Qué hace | Exit 1 cuando… |
|---|---|---|
| `where` | El ámbito de este directorio y dónde está el almacén | — |
| `ownership [dsh-only\|machine]` | La propiedad del proceso de creación de skills de este puesto: sin argumento la dice (o imprime la pregunta), con argumento la declara | No es una de las dos respuestas válidas |
| `systems` | **Sólo lectura**: los sistemas de skills del puesto, sus almacenes y los ids que viven en más de uno | — |
| `list` | Qué hay propuesto, aprobado y rechazado, por proyecto | — |
| `show <id>` | Imprime una propuesta entera, tal cual | No existe |
| `check [<id>]` | Pasa la puerta de validación a las pendientes (o a una) | Alguna falla |
| `check --grupo <lote>` | Pasa la puerta a **todas** las propuestas de un lote, una por una | Alguna falla |
| `approve <id>` | **Activa** la skill en su proyecto | No pasa `check`, o tiene avisos y falta `--force` |
| `approve --grupo <lote>` | Activa el lote entero: primero comprueba **todas** las puertas y sólo entonces aprueba. Si una falla, no se aprueba ninguna | Igual que `approve`, para cualquiera del lote |
| `reject <id>` | La aparta sin borrarla | No existe |
| `active` | Qué se está sirviendo de verdad en este directorio | — |
| `vendor <url>` | Nuestra versión de una skill externa | Bloqueado, conflicto, o el enlace pide elegir carpeta |
| `upstream <id>` | ¿Se movió el origen? | No se pudo comprobar, o no es vendorizada |
| `provenance <id>` | La procedencia guardada, entera | No es vendorizada |
| `doctor` | Comprueba que las dependencias del harness están declaradas, instaladas y **se cargan**, que las cuatro herramientas compilan, que la proyección cumple el contrato y proyecta contra el registro real, que los comandos se declaran, y **ejecuta las puertas de contrato** de las herramientas, la proyección, el catálogo y el modo automático | Algo falta, no carga, o una puerta se pone roja |
| `audit [--json] [--estado X] [--todo]` | **Audita el almacén entero en solo lectura**: todas las skills, en todos sus estados, medidas con la misma puerta que decide una aprobación. Dice por skill la regla que incumple, el valor observado, el umbral, la severidad y la corrección recomendada, con identificadores estables (`estado/proyecto/id`). Por defecto muestra lo que no pasa; `--todo` incluye también lo que pasa, `--estado` acota a uno o varios estados (separados por comas) y `--json` da el informe entero | Una skill tiene error o no se pudo leer (sale con 1; con 0, todo pasa). **No repara nada**: señala |
| `repair <id>` | **Prepara** la corrección de una skill viva a partir de lo que la auditoría encontró. Dice el nivel (1 mecánico · 2 semántico acotado · 3 criterio humano) y, si el motor no puede arreglar lo que bloquea, **no crea ninguna propuesta**. No activa nada | No hay versión viva con ese id, o la corrección bloquea en criterio humano |
| `promote <id> [--nivel 1,2] [--dry]` | **Activa** una corrección ya preparada, con nueve pruebas de regresión antes y verificación por huella después. Sin `--nivel` **no activa nada**; el 3 no se puede autorizar aquí. `--dry` corre las pruebas sin escribir | Alguna prueba falla (no activa), el cerrojo está tomado, o el nivel no está autorizado |
| `history [<id>] [--grupo <lote>]` | Qué se promocionó, con qué pruebas, de qué huella a cuál y por qué; y avisa de las correcciones repetidas (posibles ciclos). Con `--grupo`, sólo lo de ese lote | — |
| `review [--port N]` | **Sirve una página local** con las pendientes, su validación y botones de aprobar y rechazar. Escucha solo en `127.0.0.1` y exige un token de un solo uso que se imprime al arrancar | El puerto está ocupado, o falta el token |
| `where` | El ámbito de este directorio y dónde está el almacén | — |

**`doctor` es el primer comando que hay que ejecutar cuando el plugin no se activa.** Distingue tres cosas
que se ven iguales desde fuera y se arreglan distinto: que falte una dependencia (`npm install`), que no se
pueda cargar por un *peer* sin instalar, y que un esquema de herramienta no compile. El porqué de todo
esto, en [`DEPENDENCIAS.md`](DEPENDENCIAS.md).

### Que necesita `doctor` del entorno, y que no

El almacen que `doctor` mide es `$DSH_HOME\skill-compiler` —sin `DSH_HOME`, `%USERPROFILE%\.dsh\skill-compiler`—, y
cada skill vive en `projects\<clave>\<estado>\<id>\`. De ahi salen las precondiciones reales:

- **El almacen puede no existir todavia.** Una instalacion nueva no tiene `projects/`, porque no hay nada
  propuesto: es el estado inicial, y `doctor` lo dice («capa de seguridad: nada que revisar todavia») **sin**
  contarlo como problema. Un almacen vacio no impide activar el plugin.
- **Un almacen que existe y no se puede leer si es un problema**, y sigue saliendo con 1: si `projects` es un
  fichero (`ENOTDIR`) o falta el permiso (`EACCES`), no se sabe que hay dentro, y responder «0 revisadas» seria
  afirmar algo que no se miro. El mensaje dice el error real y el remedio.
- **La biblioteca curada** (`%USERPROFILE%\.dsh\skills`, rango 400) **es ajena**: se lee para comparar y para
  detectar choques, y solo se observa si existe. No es una precondicion, y el plugin no la crea ni la toca.

La distincion —**«no hay»** frente a **«no pude leer»**— vive en `leerProyectosDelAlmacen` (`lib/compiler.mjs`), que
devuelve el estado de la lectura junto a la lista, y la fija `tests/doctor-almacen.test.mjs` ejecutando el binario
en las tres arenas: sin `projects/`, con `projects/` vacio, y con `projects` sustituido por un fichero.

El ciclo entero, en tres comandos: **`audit`** dice qué incumple cada skill → **`repair`** prepara la corrección que el motor sabe hacer (y se calla cuando lo que falta es criterio humano) → **`promote`** la activa si su nivel está autorizado y todo pasa, con la versión anterior apartada y la vuelta atrás comprobada. `history` cuenta lo que pasó.

**`audit` es el primer comando que hay que ejecutar cuando hay que decidir qué se corrige.** No arregla
nada —ni normaliza, ni aprueba, ni toca un `meta.json`—: escribe el diagnóstico y deja el almacén exactamente
como estaba, así que se puede ejecutar tantas veces como haga falta. Es reproducible: dos ejecuciones del
mismo estado dan el mismo informe byte a byte (sin fechas, y con el orden puesto por la clave de cada skill,
no por el recorrido del disco). Y **no se cae**: una carpeta denegada o un `SKILL.md` ilegible son un
hallazgo de esa skill; las demás se auditan igual. Los detalles de qué mide cada regla y con qué umbral, en
[`POLITICA-DE-ACTUALIZACION.md`](POLITICA-DE-ACTUALIZACION.md).

## La propiedad del puesto, y los choques entre sistemas

Este plugin **no es el único que escribe skills en la máquina**: comparte puesto con la biblioteca curada del
harness y con los almacenes de otros agentes y editores. Nadie declaraba quién manda sobre qué, y el mismo
id podía acabar en dos sitios con contenido distinto sin que nadie lo dijera.

Se declara **una vez**, con dos respuestas posibles y **ninguna por defecto**:

```
/skill-propiedad                      # estado, o la pregunta si nadie ha respondido
/skill-propiedad dsh-only             # sólo se trabaja con DSH: no compite fuera
/skill-propiedad machine              # todo el PC: mira los demás, avisa de cada choque, no sobrescribe nada ajeno
```

En el menú `/` están las filas `skill-propiedad-dsh-only` y `skill-propiedad-machine`: seleccionarlas **es**
declararlo, sin teclear nada. Y desde el terminal: `node bin/skill-compiler.mjs ownership [dsh-only|machine]`.

La declaración tiene **cuatro estados**, y no se leen igual: `ausente` (nadie ha respondido), `declarada`,
`invalida` (JSON roto, valor fuera de contrato o campos desconocidos) e `ilegible` (existe y no se puede leer).
Con `invalida` o `ilegible` **no se presume política**: se aplica la segura y se dice el motivo y cómo
arreglarlo — no es lo mismo que una pregunta sin responder, y no se disfraza de eso.

Sin respuesta útil, el plugin **lo dice** —al proponer, en `/skill-propiedad` y en `doctor`/`ownership`— y
sigue sin competir fuera. Con `dsh-only`, un id que ya viva en otro sistema **se rechaza** al proponerlo, con
el sitio de la otra copia. Con `machine`, se propone con un aviso que dice dónde más vive.

El inventario (`/skill-sistemas`, `systems`) dice además **qué no pudo leer**: una fuente inaccesible no es
«cero skills». Si alguna fuente configurada y existente no se pudo leer, el barrido se declara **incompleto**
y **no se afirma que no haya choques**. Y la escritura de una propuesta va bajo el **mismo cerrojo por skill**
que usa la promoción (`<almacén>/locks`): dos operaciones sobre el mismo id no se pisan.

**Nunca se escribe en el almacén de otro sistema**, ni importando: lo ajeno se lee y, como mucho, se copia
**hacia dentro** como propuesta con procedencia. La política entera, con lo medido y las tres invariantes, en
[`PROPIEDAD-Y-COLISIONES.md`](PROPIEDAD-Y-COLISIONES.md).

## Qué se ve en la interfaz

Una píldora en la zona del compositor que aparece **solo cuando hay algo que decir**:

- **Engranaje girando** mientras `skill_propose` o `skill_vendor` están en vuelo.
- **Al terminar**: «Nueva skill», «Skill actualizada», «Sin cambios», «No se creó» u «Origen bloqueado»,
  con el nombre de la skill y, si en la sesión hubo varias, un `×N` con el acumulado.

El estado se deriva de la traza de la sesión, no de un registro aparte, así que **se ve igual al reabrir
una sesión antigua**. Los detalles de diseño y sus límites están en
[`FEEDBACK-VISUAL.md`](FEEDBACK-VISUAL.md).

Opciones: `--project-key <clave>` (actuar sobre otro proyecto sin cambiar de directorio), `--force`
(aprobar con avisos; **nunca** si `check` falla), `--id <id>`, `--note "<texto>"` (solo en `vendor`).

Ejemplos:

```sh
# proponer desde el modelo, revisar y aprobar
node bin/skill-compiler.mjs list
node bin/skill-compiler.mjs show measured-decision-check
node bin/skill-compiler.mjs check
node bin/skill-compiler.mjs approve measured-decision-check

# nuestra versión de una skill de un repositorio, con nota de adaptación
node bin/skill-compiler.mjs vendor https://github.com/alguien/skills/tree/main/mi-skill \
     --note "adaptada a los gates de este repositorio"

# auditar una vendorizada
node bin/skill-compiler.mjs provenance mi-skill
node bin/skill-compiler.mjs upstream mi-skill
```

## Variables de entorno

| Variable | Para qué | Por defecto |
|---|---|---|
| `DSH_HOME` | Dónde está el almacén (`$DSH_HOME/skill-compiler`) y la biblioteca curada (`$DSH_HOME/skills`) | `~/.dsh` |
| `SKILL_COMPILER_CLI` | Sólo si el CLI vive **fuera** del paquete: la ruta que el plugin le dice al usuario para aprobar | *(vacío)* — se deriva de la ruta del propio plugin |
| `SKILL_COMPILER_SISTEMAS` | Almacenes de skills **ajenos** que este módulo no puede adivinar, separados por el delimitador del sistema (`;`). Se miran para avisar de choques; jamás se escriben | *(vacío)* |

`SKILL_COMPILER_CLI` existe porque el plugin instalado vive en el perfil y no puede deducir dónde está el
repositorio. En otra máquina, expórtala tras clonar.

## Dónde está todo

```
$DSH_HOME/skill-compiler/ownership.json    la propiedad declarada del puesto (o no existe: sin declarar)
$DSH_HOME/skill-compiler/locks/            el cerrojo por skill (proponer, promocionar, publicar)
$DSH_HOME/skill-compiler/projects/<clave>/
  proposed/<id>/   SKILL.md · meta.json · provenance.json · upstream/
  approved/<id>/   lo que el proveedor sirve
  rejected/<id>/   apartado
  superseded/<id>-<fecha>/   versión anterior
  superseded/proposals/<id>/<revision>/   candidata sustituida (SKILL.md · meta.json · references/)
```

La `<clave>` de proyecto se deriva del `cwd`: `<último-tramo>-<hash8>`. Para saber la de un directorio:
`node bin/skill-compiler.mjs where`.

## Cuando algo no cuadra

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El plugin no aparece y la fila dice `failed` | Casi siempre, una dependencia: o no está declarada, o no está instalada, o no se puede cargar | **`node bin/skill-compiler.mjs doctor`** desde la carpeta del plugin. Dice qué falta y con qué comando se arregla. Casi siempre es `npm install` |
node bin/skill-compiler.mjs security   # capa de seguridad: ids, contenido, árboles y cadena del diario (solo lectura; exit 1 si hay algo)
node bin/skill-compiler.mjs auto [<id>]  # ¿puede actualizarse sola? cada medida con su número (solo lectura; exit 1 si alguna exige humano)
| El diálogo de instalación dice `Installed` pero al encender dice `failed to import` | El bundle se instaló **enlazando** la carpeta del repositorio, y las dependencias del plugin no están ahí | `npm install` en la carpeta del plugin y vuelve a encenderlo. El motivo completo, en [`DEPENDENCIAS.md`](DEPENDENCIAS.md) |
| Cambié el código y el comportamiento no cambia | El perfil puede tener **su propia copia** del paquete, o conservar el módulo cargado | Si se instaló por ruta, el perfil enlaza el repositorio y el cambio es inmediato tras un ciclo de encendido; si no, reinstala el bundle y reinicia cuando el resultado diga `restart-required` |
| Cambié el código del **navegador** (`client.js`) y no se ve | El artefacto de interfaz lo carga la página | Recarga la página (F5) después de cambiar el fichero |
| La apruebo y el modelo no la ve | No es su proyecto, o hay una skill curada con el mismo nombre que gana por rango | `node bin/skill-compiler.mjs active` desde el directorio del proyecto; `where` para comprobar la clave |
| `vendor` dice `needs-choice` | El enlace apunta a una carpeta con varias skills | Llama otra vez con el enlace a la subcarpeta concreta |
| `vendor` dice `fetch-failed` con HTTP 403 | Límite de peticiones de GitHub sin autenticar (60/hora) | Espera, o usa el enlace `raw` del fichero, que no pasa por la API |
| `vendor` dice `blocked` | El origen trae credenciales, órdenes al agente o texto invisible | **No hay forma de saltarlo desde la CLI, a propósito.** Sanea el origen (o usa otro `ref`) y vendoriza una versión limpia |
| `propose` o `vendor` dice `conflict` | Ya existe ese id o ese tema | Mejora esa skill, o elige otro tema; si es una versión mejorada de la existente, se decide como actualización |
| `check` falla en una propuesta que escribí a mano | Una edición posterior rompió el contrato | El propio `check` dice qué regla; edita y repite |
| El veto rechaza la segunda skill de una sesión que aprendió dos cosas | El tema es parecido **a propósito**: van juntas | Proponla declarando el mismo `group` (con su `motivo`): dentro de un lote el parecido se avisa y no veta |
| `promote` no activa una corrección de un lote y dice que espera | El lote no está completo o alguna hermana no pasa su regresión: un lote no se activa a medias | Completa el lote, o activa a mano lo que quieras con `approve <id>` (la vía humana no la bloquea el lote) |
| `upstream` dice que cambió y quiero la versión nueva | Nuestra versión está adaptada | Vendoriza otra vez con el mismo id: se propone como actualización y, al aprobar, la anterior se aparta en `superseded/` |
| La píldora del feedback visual no aparece nunca | El perfil no resolvió `zod`, o el servicio de proyección no está, o la unidad no cumplió el contrato (entonces **no se registra**) | `node bin/skill-compiler.mjs doctor`: dice si la proyección cumple el contrato y si el registro real proyecta. Con las herramientas funcionando, es un adorno ausente, no una avería |
| Veo la lista de pendientes pero no encuentro cómo elegir una | El comando con argumentos hay que escribirlo entero, y el compositor no ofrece lista pulsable para los argumentos de un comando del host | Escribe `/` y elige la fila `skill-aprobar-<id>` (o `skill-ver-…`, `skill-rechazar-…`). `/skill-propuestas` las anuncia por su nombre exacto y, si las filas no estaban montadas en tu sesión, **las monta al ejecutarlo** |
| La tarjeta dice «no hay filas que decidir en el catálogo de esta sesión» | El montaje de las filas de esa sesión no llegó a registrar nada (el `inject` del hijo de un agente no siempre corre, y el agente podía quedar cacheado a medias) | Ejecuta `/skill-propuestas`: reintenta el montaje —hasta tres veces— y, si no lo consigue, **dice el motivo**. Las decisiones funcionan igual escribiendo el comando entero. Si se repite, es un fallo del montaje: repórtalo con el motivo que muestre |
| La tarjeta dice que no pudo leer las pendientes | El anfitrión no expone `commands.list` a la pieza de interfaz, o la sesión no está abierta | El motivo exacto lo dice el propio panel. La vía es el menú `/` o el terminal: la aprobación funciona igual y pasa por la misma puerta |
| Apruebo algo y sigue apareciendo como pendiente | El bloque que tienes delante se pintó antes de la decisión: su texto es lo que había entonces | El bloque de la decisión trae la lista al día al final. Si el bloque viejo no se marcó como anterior, es que la decisión llegó por una vía que no pasa por el log de la sesión (el CLI en otra terminal, o una aprobación automática): vuelve a ejecutar `/skill-propuestas` |
| Aprobar dos veces dice que ya está activa | No es un fallo: es idempotente a propósito | Nada que hacer. El mensaje dice también cómo queda la lista |
| El resultado de un comando no tiene la X para cerrarlo | El anfitrión no declara el slot `conversation.chat.commandview`, o la pieza de cliente no se recargó | Recarga la página (F5). Si sigue sin X, esa versión del harness pinta la tarjeta sin cierre —el resultado se lee igual— y `doctor` confirma que la pieza declara sus dos dependencias de cliente |
| Los comandos `/skill-*` no aparecen en el compositor | El perfil no monta el registro de comandos (`dsh-commands`), o el plugin no se activó | `dsh --profile web --dump-config` debe listar `- id: commands`. Con el plugin activo y ese servicio presente, los comandos se registran; sin él, el plugin sigue sirviendo skills y herramientas |
| Apruebo una skill y el agente no la ve | La invalidación del catálogo no llegó: el registro de skills **cachea y no tiene TTL** | Es lo que cubre 1.3.0 (aviso al aprobar + vigilancia del almacén). Si reaparece: `/skill-propuestas` dice qué está activo, y `doctor` ejecuta la puerta de frescura contra el registro real |
| La skill recién aprobada no sale en el menú al escribir `/` | El **cliente** cachea el catálogo por sesión y su invalidación no está en manos de un plugin | Escribe `/nombre` a mano: la resolución la hace el host y funciona ya. El menú se refresca al cambiar de preset, reconectar o recargar la página |
| Con `/skill-auto activar`, una propuesta no se aprobó | No pasó la puerta de validación, o es un conflicto | Lo dice el propio resultado de la herramienta, con el motivo. No es un fallo del modo: es la puerta funcionando |
| **El historial de sesiones no carga**, con `Failed to load history: failed to project session … def.wire.viewSchema.parse is not a function` | Una unidad de proyección registrada con esquemas que **no validan** (no son Zod). El registro no valida lo que recibe, así que el fallo aparece al leer sesiones | Es el defecto que cerró la 1.1.2: no puede volver desde este plugin, porque la unidad se comprueba antes de registrarse. Si reaparece, **otro** bundle está registrando una unidad con esquemas que no validan: `node bin/skill-compiler.mjs doctor` y revisa el `wire.viewSchema` del bundle sospechoso |
| La píldora se queda en «Analizando…» | Una llamada quedó sin resultado (cancelada). Un `turn/end` la cierra; si no, el siguiente prompt humano la retira | Es el estado real de la traza, no un fallo de dibujo |

## Revertir

- **Una aprobación**: no hay «desaprobar»; la versión anterior está en `superseded/`. Para retirar una
  skill del catálogo, la vía limpia es silenciarla (`disable-model-invocation: true`) o retirar su
  carpeta de `approved/` y volver a proponerla.
- **Todo**: borrar `$DSH_HOME/skill-compiler/`. No toca la biblioteca curada ni ningún repositorio.

## Comprobaciones de salud

```sh
npm test                # puertas (i18n + ASCII) y las 902 pruebas, en caja de arena
npm run test:hermetic   # lo mismo + huella del almacén real antes y después
npm run gate            # solo las puertas: para un cambio de texto o de catálogo
```

`npm test` ejecuta antes `tools/gates-obligatorios.mjs` (por `pretest`): si una puerta falla, la suite no
llega a correr. Ninguna de las tres necesita red ni toca tus datos.

## La capa de seguridad, en dos frases

Un **bloqueo** —credencial, orden dirigida al agente, destrucción de una unidad— no se escribe y no se aprueba
ni con `--force`. Un **aviso** —ruta sensible, operación privilegiada— lo decide un humano con `--force`, y la
promoción automática nunca lo toca: el nivel sube a humano por encima del nivel que declare el parche. El
contrato completo, con lo que la capa **no** hace, está en `docs/SEGURIDAD.md`.

## Qué se actualiza solo

Una **skill nueva** no: la confirma un humano (el modo `/skill-auto` delega la confirmación, nunca la puerta).
Una **corrección** de algo vivo se activa sola sólo si el medidor lo dice: nivel ≤ 2, evidencia comprobable,
disparador intacto, seguridad en 0/0, diff presente y las nueve pruebas de `promover` en verde. El listado de
`/skill-propuestas` lo enseña por cada actualización («auto-actualizable» o «exige humano: …»), y `auto <id>`
da la tabla completa. Contrato en `docs/POLITICA-DE-ACTUALIZACION.md`.

## Aprobación individual y en lote: el contrato real

**No hay un comando «batch».** El panel «Decide right here» ejecuta **una aprobación por id** —
`skill-aprobar <id> --local` (este proyecto) o `skill-globalizar <id>` (biblioteca de usuario)— y pinta el
resultado de cada una: cuántas se aprobaron, cuántas fallaron y el motivo de cada fallo. Si un elemento falla,
los demás siguen: no hay una transacción que arrastre al resto.

Garantías de integridad:

- Se verifica la huella del **contenido** —`SKILL.md` y `references/`—, no la del árbol: el movimiento reescribe
  `meta.json` a propósito (`state`, `approvedAt`, `supersededPrevious`), y medirlo producía un aviso en
  **todas** las aprobaciones (medido: `b8d97078ebe8 → 672ed05d2101` con el contenido idéntico).
- La comprobación ocurre **antes** de mover: una divergencia aborta sin apartar la versión anterior y sin
  activar nada; si aun así el contenido activado no casara, la skill vuelve a `proposed` y la aprobación se
  declara fallida (no un aviso).
- Un fallo al mover (destino ocupado, permisos) es un motivo, no una excepción.
- Una respuesta que **pregunta** el ámbito no es una aprobación: el panel la cuenta como pendiente, no como
  aprobada.

## Aprobar en lote (plural)

Una orden para varias: separa los ids con comas o espacios, y di el ámbito **una vez**.

```
/skill-aprobar id1,id2,id3 --local     # este proyecto
/skill-aprobar id1,id2,id3 --global    # biblioteca de usuario
```

Cada id pasa por la misma puerta que en singular y el informe da una línea por elemento (`ok` / `FALLO` con su
motivo). No es una transacción: los que fallan no se mueven y los demás sí. Si alguno falla, el comando entero
devuelve error para que se mire. El panel «Decide right here» usa esta misma orden cuando hay varias marcadas, y
si el host no la ejecuta cae a una por una y lo declara.

## El rastro del aprendizaje (diario)

Cada decisión sobre una skill queda en `projects/<clave>/journal.jsonl`, **encadenada** (cada entrada lleva la
huella de la anterior) y con lo necesario para auditarla:

| Campo | Qué dice |
|---|---|
| `decision` | `aprobada` · `publicada` · `apartada` · `promovida` · `espera-medidor` · `rechazada-por-regresion` |
| `ambito` | `project` (este proyecto) o `global` (biblioteca de usuario) |
| `por` / `canal` | `humano` + `comando` (comando, panel, CLI) o `auto` + `herramienta` (modo automático) |
| `hashAnterior` / `hashResultante` | el contenido que se validó y el que quedó activo: si difieren, algo se movió por el camino |
| `superseded` | la versión anterior, apartada (nunca borrada) |
| `avisos` | con qué avisos se aprobó, si alguno |

`node bin/skill-compiler.mjs security` recorre los diarios y verifica la cadena: una entrada editada, borrada o
insertada se detecta (`journal-tamper` / `journal-chain`). Las entradas anteriores a la cadena se declaran
(`sinHuella`) y no cuentan como rotura.

### Los colores del panel

El informe del panel usa **un tono por significado** —verde (todo salió), ámbar (mezcla o nada ejecutado), rojo
(fallos), apagado (informativo)—, siempre mezclado con `currentColor` para no bajar del contraste del tema. La
información **no** depende del color: el texto dice lo mismo. Las líneas entran con una animación de dos píxeles
que desaparece con `prefers-reduced-motion: reduce`.

### Si el menú «/» no anuncia las filas

Las filas por propuesta (`skill-aprobar-<id>`, `skill-rechazar-<id>`, los ámbitos) se registran en el contexto
del **agente**, no en el global —una fila global se le ofrece a todas las sesiones—. El montaje prueba dos
caminos: el `inject` del servicio `commands` y, si no llama, el registro del propio contexto. Si ninguno existe,
`/skill-propuestas` lo dice con el motivo exacto y las decisiones siguen funcionando tecleando el comando
entero (`/skill-aprobar <id> --local`), que es la vía que nunca depende del menú.

El montaje, en orden: (1) `agent.ctx.inject(['commands'], …)`; (2) un **hijo** montado con
`agent.ctx.plugin({ inject: ['commands'], apply })`, que es la forma documentada por `@deepseek-ai/dsh-commands`
y la que recibe el servicio de verdad; (3) el registro directo, sólo si leer la propiedad no lanza. Los tres
motivos son distintos en el aviso, así que un fallo futuro dice **cuál** de los tres se agotó.

### Decidir sin el menú (la vía canónica)

> El detalle medido de por qué, y qué ocurre cuando el anfitrión componga el registro, en
> [`ANFITRION.md`](ANFITRION.md).


En las compilaciones del anfitrión medidas, el contexto del agente **no compone** el servicio `commands`, así que
las filas por propuesta no se pueden montar y el menú «/» no las anuncia. No es un fallo del plugin ni algo que
el humano deba reportar: `/skill-propuestas` imprime, junto a las pendientes, la **orden exacta** que las decide
(`/skill-aprobar a,b,c --local`), y su panel las marca y las ejecuta. Las tres formas —orden escrita, panel y
CLI— funcionan sin el menú; las filas son una comodidad cuando el anfitrión las ofrece.

### Qué audita `audit` y qué no

Se audita **todo lo que puede llegar a servirse o decidirse**: `proposed`, `approved`, `disabled`, `rejected`,
`published` y la biblioteca global. El **archivo** (`superseded/`, `global-superseded/`) no se audita: guarda la
versión anterior con el nombre `<id>-<fecha>` y el cuerpo que se aprobó entonces, y medirlo con las reglas de
hoy produce errores que sólo se arreglarían reescribiendo la evidencia. Se cuenta y se declara en el informe
(`archivadas: N · no se auditan`), para que su ausencia del total no parezca un olvido.

### Reparar el presupuesto: qué mueve y qué queda

`repair` mueve secciones **enteras** a `references/` y deja el enlace en su sitio. Como el cuerpo es también el
índice del material, la reparación añade una sección **«Material consultable»** con las referencias que el texto
no enlaza ya: un enlace que viaja dentro de una sección movida no puede dejar de estar a la vista. El índice
cuenta en el presupuesto del movimiento, y no se acumula: se refresca en cada pasada.

El bloque es **del motor** y va marcado:

```markdown
## Material consultable
<!-- skill-compiler:indice:inicio -->
- `references/lo-que-no-se-enlaza-arriba.md`
<!-- skill-compiler:indice:fin -->
```

Sólo se reemplaza un bloque con esos marcadores y con esa forma. **Una sección del autor llamada «Material
consultable» no se toca**: no se mueve a `references/`, no se duplica y el reparador lo declara como aviso. Los
índices escritos por la versión anterior (sin marcadores) se reconocen sólo si son exactamente su huella —
última sección del cuerpo, frase fija y nada más que rutas —; si no, se conservan.

Si el peso está donde el motor no mira —un preámbulo largo antes de la primera sección, o secciones en `#` de
primer nivel cuando el motor sólo parte por `##`—, la corrección automática se **bloquea** con
`body-sin-corte-posible`. Eso no es un fallo: es el límite entre lo mecánico y lo que exige criterio, y se
resuelve normalizando la estructura (bajar los encabezados de nivel, o llevar el preámbulo a `references/`) y
volviendo a ejecutar `repair`.

### Corregir una skill sin cambiar su estado ni su ámbito

- **Apagada**: `repair <id>` prepara la corrección y `approve <id> --local --preserve-state` la coloca en
  `disabled/` —el estado del que salió—, apartando la anterior en `superseded/`. El flag se **niega** en una
  skill activa: el estado se lee del origen, no se declara a mano, así que no hay forma de encenderla sin querer.
  En el diario la decisión queda como `actualizada-apagada`.
- **Global**: `repair <id>` toma como base la copia **publicada** (`base: published`) y `approve <id> --global`
  vuelve a publicar en la biblioteca. La versión anterior se aparta en `<almacén>/global/superseded/<id>-<fecha>`
  —dentro de nuestro almacén, no en la biblioteca— y el proyecto sólo guarda la constancia en `published/`: la
  skill no se localiza ni cambia de ámbito.

Qué garantiza cada puerta: `check` valida la propuesta contra la puerta de calidad; `approve` verifica la
**huella del contenido** antes y después de mover; `promote` exige además las nueve pruebas y su guarda de
tamaño; `audit` mide el almacén (sin tocar nada); `security` revisa ids, contenido, árboles y la cadena del
diario y **distingue «no hay» de «no pude leer»**: un almacén que aún no existe sale en verde, y uno que no
se puede leer sale con el error real y **exit 1**, nunca como «0 revisadas»; `doctor` comprueba dependencias, comandos y propiedad. Preparar una propuesta no la activa; aprobarla la
activa en su ámbito; publicarla la pone en la biblioteca compartida; y `--preserve-state` la deja apagada.

### Decidir desde la tarjeta: avisos y tarjetas desactualizadas

- **La puerta pide decisión, no un reintento.** Si la propuesta tiene avisos, `approve`/`approve --global` se
  niegan y dicen cuáles. La tarjeta muestra el texto íntegro y ofrece **«Acepto los avisos y continúo»**, que
  ejecuta la misma orden con `--force`: la aceptación es del humano que acaba de leerlos.
- **Antes de ejecutar, se pregunta al almacén.** La tarjeta consulta `/skill-pendientes` (ids en una línea, sólo
  lectura) y descarta lo que ya no espera decisión, con el motivo «la tarjeta estaba desactualizada». Sin esa
  comprobación, una tarjeta vieja producía un fallo del comando que el humano no podía resolver.

### Avisos: valen para los dos ámbitos, y se preguntan antes

`approve` (local) y `approve --global` comparten la misma puerta: una propuesta con avisos se niega en **ambos**
sin `--force`. La tarjeta no espera a la negativa: `/skill-pendientes` publica `avisos: <id>=<n>` y las líneas
`aviso:` leídas del `meta.json`, y si alguno de los ids marcados los tiene, abre la pantalla de avisos antes de
mandar la orden. Aceptar ejecuta la misma orden con `--force`; cancelar no ejecuta nada.

### El ámbito lo decide el origen, no el destino del artefacto

Una skill aprendida mientras se dirigía trabajo en un proyecto **pertenece a ese proyecto**, aunque el artefacto
acabe en otro sitio: publicarla o localizarla es una decisión aparte, posterior, y no cambia de quién es el
conocimiento. Por eso la propuesta guarda `project` y `projectKey` desde que nace, y por eso el cambio de ámbito
(`ambito`, `/skill-ambito`, `scope`) deja asiento en el diario con las dos huellas: sin él, el diario diría
«publicada» mientras el almacén dice «local», y la evidencia mentiría.

### Un asiento que falta se repara con el escritor, nunca a mano

Si una operación cambió el almacén sin dejar asiento —un defecto del motor, como el de `ambito` antes de la
3.9.3—, la reparación tiene tres pasos: leer la última entrada del diario, calcular la huella del contenido
actual y escribir **una** entrada con `anotarEntradaEnDiario`, que encadena sola, declarando en `nota` que es un
cierre. Nunca se edita el `.jsonl` a mano: `security` verifica la cadena y una línea retocada la rompe. Después,
`security` debe decir `cadena válida` y el recuento de entradas sube exactamente en uno.
