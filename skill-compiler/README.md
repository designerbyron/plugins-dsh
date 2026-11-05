# LifeCode Skill-Compiler

![Póster de LifeCode Skill-Compiler: la letra L como cinta blanca, azul y magenta dentro de un anillo neón, con el nombre LifeCode y el subtítulo Skill-Compiler for DeepSeek Harness](../assets/poster.png)

> El nombre técnico del plugin —el del paquete, la identidad del Loader y la carpeta del almacén— sigue
> siendo `skill-compiler`. **LifeCode Skill-Compiler** es el nombre comercial, y es el que se ve en la
> ficha del plugin. Se mantienen separados a propósito: renombrar un identificador que el arranque del
> perfil valida es un riesgo que no se corre antes de la primera instalación.

Convierte el conocimiento reutilizable de una tarea compleja en una **skill propuesta**, con ámbito de
proyecto, fuera de todo repositorio y sin solaparse con lo que ya existe. Y cuando le das **el enlace de
un repositorio**, crea **nuestra versión** de esa skill para este proyecto, guardando el original
verbatim y su procedencia. **No activa nada**: la aprobación es humana.

Mientras trabaja, la interfaz lo enseña: un engranaje girando durante el análisis, y al terminar si la
skill es **nueva** o si se **actualizó** una existente.

## Documentación

| Documento | Para qué |
|---|---|
| [`docs/DEPENDENCIAS.md`](docs/DEPENDENCIAS.md) | Las dependencias del harness: por qué existen, qué está declarado, cómo se instala y qué hacer cuando el harness se actualiza |
| [`docs/MANTENIMIENTO-2026-10-21-ownership-body-budget.md`](docs/MANTENIMIENTO-2026-10-21-ownership-body-budget.md) | El mantenimiento del 2026-10-21: propiedad «machine», los 17 avisos de presupuesto con su medición, las dos excepciones documentadas y la corrección del índice del material |
| [`docs/ANFITRION.md`](docs/ANFITRION.md) | El anfitrión medido: qué capacidades ofrece hoy, qué no (filas de comando por agente), qué se implementó para no depender de ellas y qué ocurrirá cuando lleguen |
| [`docs/FUNCIONAMIENTO.md`](docs/FUNCIONAMIENTO.md) | Cómo funciona por dentro: puntos de extensión, dónde guarda, recorrido de cada operación, ciclo de vida y reglas de validación |
| [`docs/FEEDBACK-VISUAL.md`](docs/FEEDBACK-VISUAL.md) | La píldora de la interfaz: qué se ve, de dónde sale el estado, las reglas de diseño que la sostienen y lo que **no** está verificado |
| [`docs/CONFIANZA.md`](docs/CONFIANZA.md) | El modelo de confianza: qué se controla ante contenido ajeno, qué **no** ocurre nunca, y el riesgo que no se puede mecanizar |
| [`docs/OPERACION.md`](docs/OPERACION.md) | Referencia de uso: herramientas, CLI, variables, qué se ve en la interfaz, y qué hacer cuando algo no cuadra |
| [`docs/DIAGNOSTICO-2026-10-15.md`](docs/DIAGNOSTICO-2026-10-15.md) | El diagnóstico medido de las 11 skills del almacén que no pasan la puerta: regla, valor observado, umbral, causa raíz, y quién tendría que firmar cada arreglo. **Diagnostica, no repara** |
| [`docs/POLITICA-DE-ACTUALIZACION.md`](docs/POLITICA-DE-ACTUALIZACION.md) | Los tres niveles de riesgo de una actualización automática, sus salvaguardas y **cómo se comprueba cada criterio**, con el catálogo de reglas y umbrales que aplica `audit`: la automatización sigue siendo especificación, y lo que ya está implementado se dice por su nombre |
| [`docs/PROPIEDAD-Y-COLISIONES.md`](docs/PROPIEDAD-Y-COLISIONES.md) | La propiedad del proceso de creación de skills en el puesto (sólo DSH o todo el PC) y la política frente a los demás sistemas: qué se mide, las tres invariantes, y qué decide la puerta ante un id que ya vive fuera |
- [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md) — la capa de seguridad: contrato de id, escaneo del contenido, árbol y diario encadenado, con lo que **no** cubre.
| [`docs/DESARROLLO.md`](docs/DESARROLLO.md) | Cómo ampliarlo sin romperlo: mapa de ficheros, cómo añadir reglas, herramientas y piezas de interfaz, pruebas, versionado |
| [`CHANGELOG.md`](../CHANGELOG.md) | Historial de versiones |
| [`plans/PLAN-2026-10-13-acciones-en-la-tarjeta.md`](../plans/PLAN-2026-10-13-acciones-en-la-tarjeta.md) | El plan de las acciones en la tarjeta del resultado y la decisión en lote (checkbox, paso a paso): el contrato que se midió y sus fases. **Implementado** entre 3.4.0 y 3.8.5; se conserva como registro de lo que se autorizó |

## Las dos vías, y en qué se diferencian

| | `skill_propose` | `skill_vendor` |
|---|---|---|
| Cuándo | Cerraste una tarea compleja y lo resuelto se reutilizará | El usuario te da un enlace y pide una skill de ahí |
| De dónde sale el contenido | Lo escribe el modelo, destilado | Del origen, **adaptado a este proyecto** |
| Qué se guarda | La skill | La skill **y el original verbatim** (`upstream/`) + `provenance.json` |
| Confianza | Se valida el texto (secretos, rutas, formato) | Además **se bloquea** ante secretos u órdenes dirigidas al agente |
| ¿Instala algo del origen? | — | **No**: ni clona, ni ejecuta, ni copia código |
| ¿Se activa sola? | No | No |

Y una tercera herramienta, de solo lectura: `skill_upstream_check` dice si el origen **se movió** desde
que se tomó, sin tocar nuestra versión (que está adaptada a propósito: sobrescribirla destruiría justo
lo que la hace útil).

## Vendorizar: nuestra versión de una skill externa

Le dices al agente, por ejemplo:

> crea una skill a partir de https://github.com/alguien/skills/tree/main/mi-skill

y ocurre esto, sin instalar nada del upstream:

1. **Resuelve el enlace**: un `.md` crudo, un `blob`/`tree` de GitHub, o la raíz de un repositorio.
2. **Descarga solo markdown**: el `SKILL.md` y hasta 10 `references/*.md`. Los binarios, scripts y
   carpetas se **declaran omitidos** — que una skill pueda llevar scripts no significa que este camino
   deba traerlos de internet.
3. **Analiza el contenido ajeno**, porque va a convertirse en guía que el modelo lee. Bloquea —no avisa—
   ante credenciales, órdenes dirigidas al agente («ignora las instrucciones anteriores», «no se lo
   digas al usuario», `curl | sh`, `sudo`) y caracteres invisibles.
4. **Guarda el original verbatim** en `upstream/` con su SHA-256: sin eso no se puede demostrar qué se
   tomó ni detectar que el origen cambió.
5. **Adapta a nuestra versión**: frontmatter del contrato DSH, descripción acotada a lo que el modelo
   puede leer, título normalizado, referencias reescritas a `upstream/references/`, y un banner que dice
   que es una versión local **no autoritativa**.
6. **Propone**, con la procedencia en `provenance.json` (URL, ref, SHA-256, fecha, ficheros omitidos,
   avisos y la licencia si el origen la declara).

Nada de esto se activa hasta que tú lo apruebas.

## Qué cambió respecto a la idea original

La idea era buena; cuatro de sus piezas no existen en DSH tal como se describían, y una quinta era un
riesgo. Esto es lo que se corrigió y por qué:

| Idea original | Realidad medida en DSH | Qué se hizo |
|---|---|---|
| `ctx.on('dsh/system-prompt:assemble', …)` para inyectar texto | La guía de DSH lo **prohíbe** para añadir texto («Do not listen to `system-prompt/assemble` to add or remove tools or text»). Lo correcto es `ctx.systemPrompt.section()`. | Se usa una **sección estática** con orden propio: entra una vez, ordenada, y protege el prompt caching. |
| Un bloque `[EMIT_NEW_SKILL]` con JSON en la respuesta | Obliga a un parser que debe **confiar en prosa**, cuesta tokens de salida en cada tarea y no valida nada. | Se sustituye por una **herramienta con esquema validado** (`skill_propose`). El runtime valida los argumentos antes de que nada toque el disco. |
| `export const name = '…'` (descartado de salida) | **Sí existe**: es la identidad del Loader, y los paquetes reales la exportan. | Se exporta `name`, más `inject` y `apply`. |
| «Revisa mentalmente» el solapamiento | La biblioteca de este puesto **ya tiene** un guardián mecánico y un registro de canónicos. | La comprobación es de código: parecido de tema por Jaccard contra la biblioteca curada **y** lo aprendido, con veto y explicación de con quién choca. |
| `runtime: node | python` y `matchTriggers` | El runtime solo importa para los scripts de una skill, y en DSH una skill se selecciona por su `description`, no por palabras clave. | Se eliminan: el idioma del plugin es Node, y el «disparador» es la descripción, que se valida por longitud y formato. |
| — | El objetivo real incluía algo que la idea no cubría: **que una skill no se cargue en el proyecto equivocado**. | El ámbito **lo calcula el plugin desde el cwd de la sesión**, nunca lo declara el modelo, y el proveedor sirve solo lo aprobado de ese proyecto. |

## Cómo funciona

Tres puntos de extensión, cada uno en el lugar que le corresponde:

1. **`ctx.systemPrompt.section({ name: 'skill-compiler:protocol', order: 9000 })`** — el protocolo:
   corto, estático y en español porque el trabajo de este puesto lo es.
2. **`ctx.tools.register(...)`** — dos herramientas: `skill_propose` (propone) y `skill_review` (lee).
   **Aprobar no es una herramienta.** Si lo fuera, el modelo podría auto-aprobarse y la revisión humana
   sería decorativa.
3. **`ctx.skills.registerProvider(...)`** — sirve **solo** las skills aprobadas del proyecto actual.
   Rango **150**: por encima de la biblioteca de usuario (400) y por debajo de las raíces del propio
   proyecto (100/200), de modo que lo aprendido gana a lo global pero **nunca suplanta** lo que el
   repositorio declara.

Los datos, fuera de todo repositorio y fuera de la biblioteca curada:

```
$DSH_HOME/skill-compiler/projects/<clave-de-proyecto>/
  proposed/<id>/   SKILL.md + meta.json     ← propuesto, NO servido al modelo
  approved/<id>/   SKILL.md + meta.json     ← aprobado, servido solo en su proyecto
  rejected/<id>/                            ← apartado sin borrar
  superseded/<id>-<fecha>/                  ← versión anterior de una skill reemplazada
```

La **clave de proyecto** sale del cwd (último tramo + hash corto de la ruta completa), así que dos
proyectos con la misma carpeta en sitios distintos no colisionan.

## Instalación

El plugin **no se instala solo**: escribirlo en el perfil es cosa del gestor de plugins del harness.

1. Autoriza el gestor. En el preset `standard` (el que hay aquí) la herramienta `plugin_manager` está
   **deshabilitada**; hace falta el modo Creator, o instalar desde la interfaz.
2. Desde la página **Plugins** de la interfaz de DSH, instala un bundle **por ruta absoluta**:

   ```
   <donde-clonaste-el-repo>/skill-compiler
   ```

   (También vale `install_bundle` con `target` = esa ruta absoluta.)
3. Comprueba en el resultado que `application` dice `applied`. Si dijera `restart-required`, reinicia el
   harness.
4. Verifica que las dos herramientas aparecen en el catálogo de herramientas y que el protocolo entra en
   el prompt.
5. **Declara de quién es el proceso de creación de skills de este puesto.** El harness no tiene un diálogo
   de instalación que un plugin pueda bloquear, así que la pregunta vive donde se ve y donde la respuesta
   tiene efecto: `node bin/skill-compiler.mjs doctor` y `ownership` la imprimen mientras no haya respuesta,
   `/skill-propiedad` la imprime entera y la declara con un argumento, y las filas
   `skill-propiedad-dsh-only` / `skill-propiedad-machine` del menú `/` la resuelven en un clic.

   Sin declarar, el plugin no compite con los demás sistemas y **lo dice**; con `machine` además mira los
   almacenes ajenos y avisa de cada choque de id —sin escribir nunca en ellos—. El detalle, en
   [`docs/PROPIEDAD-Y-COLISIONES.md`](docs/PROPIEDAD-Y-COLISIONES.md).

### Si la fila falla al activarse

El paquete declara sus dependencias del harness (`@deepseek-ai/dsh-tools`, `zod` y el cierre que ambas
necesitan), así que se resuelven desde la carpeta del plugin, que es la que el perfil enlaza. Si algo no
está en su sitio, el síntoma es concreto: la fila `skill-compiler` aparece como `failed` y las herramientas
no existen. Diagnóstico, desde la carpeta del plugin:

```sh
node bin/skill-compiler.mjs doctor
```

Dice qué falta —dependencia sin declarar, sin instalar, que no carga, o una proyección que no cumple el
contrato— y con qué comando se arregla. El motivo completo, en [`docs/DEPENDENCIAS.md`](docs/DEPENDENCIAS.md).

Para el caso en que se instale por **nombre** en vez de por ruta, el cierre va declarado, así que el gestor
lo instala al añadir el paquete. No se ha añadido un plan B silencioso a propósito: un plugin que activa
con una herramienta a medio construir es peor que uno que falla y lo dice.

## Uso

El modelo propone; tú decides.

### Desde el harness, sin salir de la sesión

Los comandos de sesión tienen **un nombre por idioma**: `/skill-approve` en inglés, `/skill-aprobar` en
español. No son dos comandos ni un alias: es la **misma operación**, con el mismo handler, la misma puerta y
los mismos efectos, y el registro tiene **una fila por operación** —la del idioma activo—.

## Idiomas: qué hay, cómo se cambia y qué no cambia

**Qué hay.** Dieciséis operaciones, dos idiomas (`en` es el base, `es` el alternativo) y **un solo nombre
registrado por operación**: el del idioma activo. El del otro idioma **no está registrado y no es invocable**
—teclearlo responde «comando desconocido», no aprueba nada—. `skill-auto` es la excepción de forma: se llama
igual en los dos idiomas, porque «auto» no se traduce.

**Cómo se cambia** (tres puertas, una sola verdad):

| Vía | Cómo | Cuándo usarla |
| --- | --- | --- |
| En la sesión | `/skill-compiler-language --es` · `/skill-compiler-language --en` | lo normal: cambia el registro y el menú `/` **sin reiniciar** |
| En la sesión, sin argumentos | `/skill-compiler-language` | dice el idioma activo, de dónde sale, y los nombres de cada idioma |
| En el terminal | `node bin/skill-compiler.mjs lang es` · `lang en` · `lang` | para dejar la preferencia guardada sin abrir sesión |
| Variable de entorno | `DSH_LANG=es` | automatización y pruebas: **manda sobre todo lo demás** |

También vale `en`/`es` sin los guiones (`/skill-compiler-language es`), y una etiqueta con región se normaliza
(`es-ES`, `es_419`, `ES` → `es`; `en-US`, `en_GB` → `en`).

**Precedencia** (la primera que exista manda):

1. `DSH_LANG` — variable de entorno.
2. `config.json` del almacén — la preferencia guardada por el comando.
3. `en` — el idioma base.

Si `DSH_LANG` impone un idioma, el comando **no finge** que ha cambiado la preferencia: dice que el entorno
manda y no escribe nada. Un valor explícito no admitido (`--fr`) es un error y **no escribe**; un `DSH_LANG`
inválido no rompe nada (se usa `en`) y `doctor` lo dice **una** vez.

**Qué cambia con el idioma** — solo la presentación y el nombre público:

- el nombre de los 16 comandos de sesión y las filas del menú `/` (`skill-approve-<id>` / `skill-aprobar-<id>`);
- las descripciones del menú, la ayuda del CLI, los mensajes y diagnósticos, la página de `review`;
- el texto del panel de pendientes (sigue el idioma efectivo).

**Qué NO cambia nunca** — es dato, no presentación:

- los ids, los parámetros y las banderas (`--local`, `--global`, `--force`, `--preserve-state`, `--yes`);
- los códigos de resultado (`activated`, `with-warnings`, `pending-list`…) y los `kind`;
- el formato del almacén (`projects/<clave>/{proposed,approved,published,disabled,rejected,superseded}`,
  `global/`, `SKILL.md` con su frontmatter);
- el vocabulario del diario (`aprobada`, `publicada`, `globalizada`, `localizada`…), que se verifica sobre la
  cadena de auditoría y se lee en las series históricas: se traduce su etiqueta en pantalla, nunca el valor;
- los nombres de fichero y de ruta, y el contenido de las skills.

**Cómo comprobar que está bien**:

```sh
node bin/skill-compiler.mjs lang          # idioma efectivo y su fuente (env | config | default)
node bin/skill-compiler.mjs doctor        # "16 operaciones y 16 filas en <idioma>" + aviso si DSH_LANG no vale
/skill-compiler-language --es             # y el menú "/" pasa a los nombres españoles, sin reiniciar
```

**Lo que el anfitrión impone** (medido el 2026-11-04 sobre DSH `0.2.1-rc.5`, build `d4db512a`, canal nightly):
el cambio se hace dando las altas antes que las bajas sobre `commands/change`, así que la ventana muestra dos
nombres y **nunca cero**; la visibilidad del menú no se puede medir sin pantalla, y se informa aparte de la
invocabilidad y del registro. Qué versión es del plugin, cuál del anfitrión, cuál de las dependencias y qué se
comprobó exactamente: [`docs/ANFITRION.md`](docs/ANFITRION.md).

### Los comandos, con su nombre en cada idioma

Los ejemplos usan los nombres **españoles** (idioma `es`); al lado, el nombre inglés de la misma operación.

| Español | Inglés | Qué hace |
| --- | --- | --- |
| `/skill-propuestas` | `/skill-proposals` | qué espera tu decisión y qué está activo, en este proyecto |
| `/skill-pendientes` | `/skill-pending` | los ids pendientes en una línea (lo que consulta la tarjeta) |
| `/skill-ver <id>` | `/skill-show <id>` | leer una propuesta entera antes de decidir |
| `/skill-aprobar <id>` | `/skill-approve <id>` | activarla donde digas (`--local`/`--global`; con avisos exige `--force`; `--preserve-state` corrige una apagada sin encenderla) |
| `/skill-globalizar <id>` | `/skill-publish <id>` | publicarla para todos tus proyectos |
| `/skill-ambito <id>` | `/skill-scope <id>` | cambiarla de sitio una vez aprobada (`--global`/`--local`) |
| `/skill-deshabilitar <id>` | `/skill-disable <id>` | apagarla (deja de servirse; se conserva entera) |
| `/skill-habilitar <id>` | `/skill-enable <id>` | volver a servirla |
| `/skill-eliminar <id>` | `/skill-retire <id>` | retirarla a un respaldo con fecha (nunca borra) |
| `/skill-retiradas` | `/skill-retired` | qué hay retirado y cómo volver |
| `/skill-rechazar <id>` | `/skill-reject <id>` | apartar una propuesta sin borrarla |
| `/skill-auto activar\|desactivar` | `/skill-auto on\|off` | aprobar automáticamente en ESTA sesión |
| `/skill-propiedad` | `/skill-ownership` | de quién es el proceso de creación de skills en este puesto |
| `/skill-propiedad-dsh-only` | `/skill-ownership-dsh-only` | declararlo de DSH |
| `/skill-propiedad-machine` | `/skill-ownership-machine` | declararlo de toda la máquina |
| `/skill-sistemas` | `/skill-systems` | los sistemas del puesto y los ids que viven en más de uno |

Y cada pendiente aparece además en el menú `/` como **filas elegibles** —leer, activar, publicar, apartar—,
sin argumentos que escribir: `skill-ver-<id>`, `skill-aprobar-<id>`, `skill-globalizar-<id>`,
`skill-rechazar-<id>` en español; `skill-show-<id>`, `skill-approve-<id>`, `skill-publish-<id>`,
`skill-reject-<id>` en inglés. **Las filas siguen el idioma activo** (su nombre sale del mismo mapa que el de
los comandos) y el id las hace inequívocas. **Elegir la fila es la decisión completa**; teclear el comando
entero hace exactamente lo mismo. Después de aprobar, la fila desaparece del menú: una pendiente que ya no lo
está no se sigue ofreciendo.


Aprobar algo que ya está aprobado no es un fallo: responde «Ya estaba activa» y no mueve nada. Y cada
decisión termina con la lista de pendientes al día, así que no hace falta volver a pedirla. Si un bloque de
`/skill-propuestas` quedó antes de una decisión, se marca como anterior y se pliega solo.

### Nunca te quedas con una skill que ya no quieres

Se puede **apagar** (reversible: deja de servirse y se conserva entera) y **retirar** (se mueve a un
respaldo con fecha y huella, nunca se borra), y volver atrás con `enable` y `restore`. En la tarjeta, con
casillas y confirmación, para hacerlo de una vez. El detalle, en
[`docs/OPERACION.md`](docs/OPERACION.md#deshacer-el-aprendizaje-apagar-y-retirar).

### Decidir en lote, sin salir del bloque

La tarjeta de `/skill-propuestas` **se puede marcar**: una casilla por pendiente, `marcar todas`, y una
barra para `Aprobar las marcadas` o `Apartar las marcadas`. Con el paso de confirmación por medio, que dice
qué se va a hacer antes de hacerlo. Tras el lote, la tarjeta informa del resultado y de cuántas quedan. La
tarjeta de `/skill-ver` ofrece `Aprobar esta` / `Apartar esta` sobre la propuesta que estás leyendo. El
análisis y las fases, en [`plans/PLAN-2026-10-13-acciones-en-la-tarjeta.md`](../plans/PLAN-2026-10-13-acciones-en-la-tarjeta.md).

### Cerrar un resultado

Cada resultado de estos comandos se puede **cerrar**: la tarjeta lleva una **X** en la esquina derecha. Lo
cerrado se recuerda mientras dure la pestaña —es una preferencia de vista: no borra nada del log ni del
almacén— y dos ejecuciones del mismo comando se cierran por separado. Colapsar sigue estando, y el cierre
es aparte: colapsar no era lo que faltaba. El contrato del slot y las decisiones de aspecto, en
[`docs/FEEDBACK-VISUAL.md`](docs/FEEDBACK-VISUAL.md).

Aprobar desde aquí deja la skill **disponible en el acto**: el agente la ve en su siguiente paso y
`/nombre` la carga, sin reiniciar el harness. Y no cambia la regla de fondo: los comandos los escribe una
persona, el modelo no puede invocarlos ni saltarse la validación.

### Desde el terminal (la misma puerta)

```sh
# ¿qué ámbito tiene este directorio?
node "<donde-clonaste-el-repo>/skill-compiler/bin/skill-compiler.mjs" where

# qué hay propuesto, aprobado y rechazado
node ".../bin/skill-compiler.mjs" list

# leer una propuesta entera antes de decidir
node ".../bin/skill-compiler.mjs" show <id>

# nuestra versión de una skill de un repositorio
node ".../bin/skill-compiler.mjs" vendor https://github.com/alguien/skills/tree/main/mi-skill --note "adaptada a los gates de este repo"

# ¿se movió el origen?
node ".../bin/skill-compiler.mjs" upstream <id>

# procedencia guardada, entera
node ".../bin/skill-compiler.mjs" provenance <id>

# la puerta: valida la propuesta (frontmatter, secretos, rutas personales)
node ".../bin/skill-compiler.mjs" check

# aprobar (exige que `check` pase; con avisos pide --force)
node ".../bin/skill-compiler.mjs" approve <id>

# apartar sin borrar
node ".../bin/skill-compiler.mjs" reject <id>

# qué se está sirviendo de verdad en este proyecto
node ".../bin/skill-compiler.mjs" active

# cambiar de ámbito una ya aprobada (publicar o traer al proyecto)
node ".../bin/skill-compiler.mjs" scope <id> --global|--local

# reparar el cuerpo de una skill viva: deja propuesta, no cambia estado ni ámbito
node ".../bin/skill-compiler.mjs" repair <id>

# el almacén, sin tocarlo: salud, seguridad, propiedad y sistemas
node ".../bin/skill-compiler.mjs" audit
node ".../bin/skill-compiler.mjs" security
node ".../bin/skill-compiler.mjs" ownership
node ".../bin/skill-compiler.mjs" systems
node ".../bin/skill-compiler.mjs" doctor
```

El resto de la CLI —`disable`, `enable`, `delete`, `retired`, `restore`, `promote`, `history`, `auto`,
`review`— está descrito en [`docs/OPERACION.md`](docs/OPERACION.md).

`--project-key <clave>` actúa sobre otro proyecto sin cambiar de directorio.

La misma puerta que usa `approve` la puedes correr antes de decidir: una skill aprobada es una
herramienta de trabajo, y no se activa con un secreto dentro ni con una ruta personal hardcodeada.

## Lo que el compilador rechaza, y por qué

| Rechazo | Motivo |
|---|---|
| `id` que no es kebab-case | DSH exige `name` en kebab-case; una skill con un nombre inválido no aparece y no avisa. |
| Descripción de menos de 12 o más de 300 caracteres, o multilínea | Es lo único que el modelo lee para elegir una skill. |
| Cuerpo de menos de 200 caracteres | Una skill es un procedimiento, no un titular. |
| Credenciales de cualquier forma (`sk-…`, `password=`, JWT, PEM, Bearer) | Una skill no lleva secretos nunca. Se **veta**, no se enmascara. |
| Rutas personales (`C:\Users\<alguien>\…`, `/home/<alguien>/…`) | Acoplan la skill a un puesto, no a un proyecto. |
| Rutas absolutas en general | **Aviso**, no veto: documentar una herramienta del puesto es legítimo. |
| Id ya ocupado en la biblioteca curada | Una skill aprendida no suplanta en silencio a una curada. |
| Tema ya cubierto en el mismo proyecto | Un tema = una skill que el modelo puede elegir. |
| Mismo tema en **otro** proyecto | **No se veta**: se informa. Cada proyecto tiene su ámbito. |
| Sin cwd | Sin proyecto no hay ámbito, y sin ámbito una propuesta aterrizaría en el lugar equivocado. |
| **Vendorizar**: credencial en el origen | Se guardaría verbatim una copia más de esa credencial. No se escribe nada y se dice qué línea y qué forma. |
| **Vendorizar**: orden dirigida al agente, o texto invisible | El contenido va a leerse como guía. Se bloquea y se nombra, **sin reproducir** el contenido. |
| **Vendorizar**: un enlace a una carpeta con varias skills | Devuelve `needs-choice` con los nombres. Traerse el repositorio entero no es una decisión de la herramienta. |
| **Vendorizar**: binarios, scripts, carpetas | Se omiten y se declaran. Solo markdown. |
| **Vendorizar**: `http://` o un enlace que no sabe leer | Se rechaza: un `http` permitiría que un tercero cambie el contenido por el camino. |
| **Vendorizar**: ya existe una skill con ese id o ese tema | Conflicto, sin escribir nada. O es otro tema, o es una actualización — y eso lo decide el humano. |

**No hay parámetro para saltarse un bloqueo**, ni en la herramienta ni en la CLI. Es deliberado: si el
modelo pudiera desactivar la puerta que vigila contenido ajeno, la puerta no existiría. Saneas el origen
y vendorizas una versión limpia, o no se vendoriza.

## Pruebas

```sh
cd "<donde-clonaste-el-repo>/skill-compiler"   # donde lo hayas clonado
npm test              # las 902 pruebas (con las puertas i18n y ASCII antes)
npm run test:hermetic # las 902 pruebas + huella del store real antes y después
```

902 pruebas en 224 suites, todas contra raíces **temporales**: no leen ni escriben la biblioteca real de la
máquina. `pretest` corre las puertas de idioma y ASCII: con una en rojo, no se ejecuta ni una prueba.

- `tests/compiler.test.mjs` — validación, composición del `SKILL.md`, solapamiento, idempotencia,
  aislamiento por proyecto, aprobación/rechazo/supersesión, inventario.
- `tests/definitions.test.mjs` — el protocolo, y las definiciones de las herramientas y del proveedor
  **ejecutadas** con un `exec` falso: propuesta, conflicto, inválida, sin ámbito, aviso de reemplazo,
  tema en otro proyecto, y la forma de los candidatos que el registro de skills espera.
- `tests/vendor.test.mjs` — vendorizado con un `fetch` **falso inyectado**: formas de enlace, descarga,
  referencias, 404 y límite de peticiones, techo de tamaño, bloqueo por secreto/inyección/texto
  invisible, adaptación, procedencia, snapshot verbatim, y que un bloqueo no deja rastro en disco.
- `tests/propose-real.e2e.mjs` y `tests/vendor-real.e2e.mjs` — no son pruebas automáticas: son los
  guiones que se usaron **contra la red real** (una URL pública) para comprobar la cadena entera:
  resolver, descargar, adaptar, proponer, aprobar, servir, y que el origen no se movió. El segundo mide
  además la huella del store real antes y después.
- `tests/repair.test.mjs` — el índice del material: se reemplaza solo su bloque delimitado, una sección del
  autor con el mismo título sobrevive, la migración del formato anterior exige procedencia inequívoca y el
  presupuesto se mide sobre el cuerpo final.
- `tests/security.test.mjs` y `tests/journal-aprobaciones.test.mjs` — ids y contenido, árboles de los sistemas
  del puesto, y el rastro encadenado de **toda** decisión (aprobación, publicación, cambio de ámbito,
  auto-aprobación y promoción del motor), con la cadena verificada.
- `tests/commands.test.mjs` y `tests/client-artifact.test.mjs` — los comandos y la pieza de interfaz como
  artefacto: veredictos que el panel reconoce, lote como una orden, avisos que se preguntan antes de ejecutar.
- `tests/cli-integracion.test.mjs` — la CLI **de verdad**, por subproceso sobre una arena: reparar y seguir
  apagada, negarse a `--preserve-state` en una activa, y corregir una global sin moverla de ámbito.
- `tests/check-hermetic.mjs` — la puerta de hermetismo. **Existe porque el error ya se cometió**: dos
  pruebas con `root: undefined` cayeron al store real y escribieron dos fixtures sin que nada se pusiera
  rojo. Ahora `sandbox()` redirige `DSH_HOME`, y esta puerta **mide** que el store real no cambió.

**Lo que las pruebas no cubren, dicho claro**: `index.js` no se puede importar fuera del harness, así
que es el único fichero sin cobertura directa. Por eso es deliberadamente fino —registrar la sección, las
cuatro herramientas, el proveedor y el adorno, y elegir bien qué hacer cuando el adorno no puede estar— y
todo lo que decide algo vive en `lib/`.

## Límites conocidos

- **Nada se activa solo.** Es una decisión de diseño, no una carencia: quien aprueba responde de lo que
  entra en el catálogo de todas las sesiones de ese proyecto.
- **El guardián de la biblioteca curada no ve lo aprendido.** Son dos ámbitos: `check-skill-overlaps.mjs`
  protege `$DSH_HOME/skills`, y este plugin protege lo aprendido. El cruce se comprueba al proponer
  (veto contra la curada), no al aprobar.
- **El conocimiento se propone, no se descubre solo.** El modelo tiene que decidir que merece la pena;
  si no lo hace, no hay skill. El protocolo lo empuja, no lo obliga.
- **No consolida**: si dos skills aprendidas se solapan con el tiempo, el veto actúa en la propuesta
  siguiente, no reescribe las anteriores.
- **El CLI se referencia por una ruta de este equipo.** El aviso de «apruébala así» necesita decir una
  ruta concreta, y el plugin instalado no puede deducir dónde está el repositorio. Se resuelve con
  `SKILL_COMPILER_CLI` y un valor por defecto; en otra máquina, exporta esa variable tras clonar. No se
  usa `Config` del harness para esto porque obligaría a importar otro paquete del que depende la
  resolución de módulos del perfil: un riesgo real a cambio de una comodidad.
- **La X de cerrar cubre los comandos con nombre fijo**, no las filas de pendientes (`skill-aprobar-<id>`):
  el slot del anfitrión despacha por nombre exacto y esos nombres llevan el id, que el cliente no conoce de
  antemano. Esas filas escriben una línea y usan la tarjeta del anfitrión.
- **La versión vive en este repositorio**, con el detalle en `docs/` y el historial en `CHANGELOG.md`.
  El árbol de trabajo está bajo el docroot de Apache, así que el repositorio lleva un `.htaccess` que
  deniega todo — incluido `.git/`, que servido por HTTP es una fuga clásica.
