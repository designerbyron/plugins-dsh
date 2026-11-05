# Desarrollo

Cómo está organizado, cómo se amplía sin romperlo, y qué reglas hacen que esto siga siendo mantenible.

## Mapa de ficheros

| Fichero | Responsabilidad | ¿Se puede probar sin el harness? |
|---|---|---|
| `lib/compiler.mjs` | El núcleo: identidad de proyecto, validación, anti-solapamiento, composición del `SKILL.md`, escritura atómica, propuesta, aprobación, proveedor | **Sí**, es Node puro |
| `lib/vendor.mjs` | El vendorizado: análisis del enlace, descarga, análisis del contenido ajeno, adaptación, procedencia, comprobación del origen | **Sí**, con `fetch` inyectado |
| `lib/presentation.mjs` | El estado del feedback visual: el contrato del marcador y el plegado de eventos | **Sí**, es Node puro |
| `lib/projection.mjs` | La unidad de proyección: los esquemas **Zod** del estado y de la vista, y la comprobación del contrato del registro antes de registrarla | **Sí**, y contra el registro **real** del harness |
| `lib/catalog-signal.mjs` | La señal de catálogo: conserva la invalidación que el registro entrega al provider y la dispara por mutación propia **y** por observación del almacén | **Sí**, contra el registro real |
| `lib/commands.mjs` | Los comandos humanos: listar, leer, aprobar (o listar si falta el id), rechazar, habilitar, deshabilitar, globalizar, eliminar, retiradas, ámbito, el modo automático, y la **propiedad del puesto** con su inventario de sistemas — más las tres acciones compartidas que usan tanto el comando con argumentos como la fila del menú. Sobre `lib/compiler.mjs` y `lib/scope.mjs`, sin decisiones propias | **Sí**, camino por camino |
| `lib/pending-rows.mjs` | Las filas del menú `/`: una por pendiente y verbo, sin argumentos, con nombres que cumplen la gramática del registro de comandos y sin repetirse entre proyectos | **Sí**, con la gramática del contrato |
| `lib/localized-commands.mjs` | El **registro que sigue al idioma** (el mapa vive en `lib/operations.mjs`): id interno estable, nombre slash de cada idioma, descripción por idioma, un solo handler compartido, y el cambio en vivo (retira con los disposers de `register()` y registra el conjunto nuevo, altas antes que bajas). El comando estable `/skill-compiler-language` vive fuera del conjunto intercambiable | **Sí**, con el registro de comandos como contrato |
| `lib/operations.mjs` | El **mapa** de las 16 operaciones de sesión: el único sitio donde vive un nombre de comando (`en` y `es`), con su `definitionId`, su clave de descripción y su pista. Lo leen el registro (para poner e intercambiar nombres) y el catálogo (para que un mensaje cite `{cmd:approve}` o `{row:approve}` y no una copia del nombre). No importa nada: es dato | **Sí**, es Node puro |
| `lib/auto-approve.mjs` | El pliegue del modo «aprobar en esta sesión» desde los `command/run` del log | **Sí**, es Node puro |
| `lib/audit.mjs` | La auditoría de solo lectura: recorre el almacén entero, mide cada skill con la puerta y devuelve un informe reproducible, sin escribir nada | **Sí**, sobre una caja de arena |
| `lib/repair.mjs` | El motor de reparación: el catálogo cerrado de reparaciones por regla (con su nivel), las transformaciones mecánicas y la preparación de la propuesta | **Sí**, es Node puro |
| `lib/improve.mjs` | La auto-mejora de una skill viva: parches **por sección** (lo que no se nombra queda byte a byte), referencias nuevas o actualizadas, conservación del inventario de conocimiento antes de escribir y el informe por archivo (`patched` / `written` / `unchanged`). No abre una segunda vía de escritura: delega en `propose` | **Sí**, sobre una caja de arena |
| `lib/review.mjs` | La página local de revisión: sirve las pendientes con su validación y sus botones de aprobar y rechazar, sólo en `127.0.0.1` y con token de un solo uso | **Sí**, levantándola en una prueba |
| `lib/promote.mjs` | La promoción: las pruebas de regresión, el cerrojo por skill, la verificación por huella después de escribir, la reversión y el diario | **Sí**, sobre una caja de arena |
| `lib/lock.mjs` | El cerrojo por skill, **uno solo** en el puesto: lo comparten proponer, promocionar y publicar, porque dos mecanismos de exclusión serían dos verdades sobre lo mismo. `O_EXCL`, y no se rompe un cerrojo ajeno: se informa de quién lo dejó | **Sí**, abriendo el cerrojo dos veces |
| `lib/security.mjs` | La capa de seguridad: **el id es una ruta** (kebab-case, sin puntos, sin nombres reservados de Windows), el **escaneo del contenido** (credenciales, órdenes dirigidas al agente, operaciones destructivas, rutas sensibles) con dos niveles —bloqueo que nadie fuerza, aviso que decide un humano—, el **árbol** (nada de enlaces, huella para «lo validado es lo movido») y la **cadena del diario** (cada entrada encadena la anterior: editar o borrar se nota) | **No**, salvo `escanear` en las pruebas |
| `lib/auto-update.mjs` | El **medidor** de la actualización automática: compone las nueve pruebas de `promote` con nivel ≤2, evidencia comprobable, disparador sin cambios, seguridad 0/0 y diff presente, y devuelve un veredicto **con números** por medida. No decide: `promover` obedece el veredicto y el humano siempre puede aprobar a mano | **No**, salvo `medirAutoActualizacion` en las pruebas |
| `lib/scope.mjs` | La propiedad del proceso de creación de skills (sólo DSH o todo el PC), los sistemas del puesto y los choques de id entre ellos: mide, declara y **nunca escribe fuera** | **Sí**, con un puesto de mentira (`home` y almacenes declarados) |
| `lib/definitions.mjs` | El protocolo y las definiciones de las cuatro herramientas y del proveedor, como objetos planos | **Sí**, con un `exec` falso |
| `index.js` | El adaptador Cordis: elige los puntos de extensión y registra. **~120 líneas** | No: importa `@deepseek-ai/dsh-tools` |
| `client.js` | La pieza de interfaz del navegador (engranaje, píldora, idioma, estilos) | No: es un artefacto de navegador. Se comprueba su **forma**, no su dibujo |
| `bin/skill-compiler.mjs` | La CLI humana, incluido **aprobar** (y `audit`, `repair`, `promote`, `history`) | Sí, y también por el CLI real en las pruebas |
| `tools/ico-to-png.mjs` | Extrae el PNG de un `.ico` para usarlo como icono (el harness no acepta `.ico`) | Sí, manualmente |
| `package.json` · `cordis.patch.yml` | El bundle que instala el gestor de plugins, y la declaración del artefacto de cliente | — |

## La regla que sostiene todo: núcleo puro, adaptador fino

`index.js` es el **único** fichero que no se puede probar antes de instalar, porque solo existe dentro del
harness. Por eso no decide nada: envuelve definiciones con `defineTool`, las registra y registra el
proveedor. Todo lo que decide algo vive en `lib/`, y `lib/` se prueba con `node --test`.

Si alguna vez tienes que elegir entre poner lógica en `index.js` o en `lib/`: **en `lib/`**. Un plugin que
rompe el arranque de todas las sesiones del perfil es el peor fallo posible, y este reparto es lo que lo
hace improbable.

## Cómo ampliarlo

### Añadir una regla de validación

1. En `lib/compiler.mjs`, dentro de `validateInput`, añade el patrón a `SECRET_SHAPES`,
   `PERSONAL_PATH_SHAPES` o `ABSOLUTE_PATH_SHAPES`, o una comprobación propia.
2. Decide si es **error** (rechaza) o **aviso** (viaja con la propuesta). La regla: un aviso para lo que
   el humano puede juzgar con contexto; un error para lo que no debe existir nunca.
3. Añade la prueba en `tests/compiler.test.mjs`. Una regla sin prueba es una regla que se romperá.
4. Si la regla debe bloquear también un origen ajeno, replícala en `lib/vendor.mjs` (`scanUpstream`) —
   son listas distintas a propósito: vender contenido ajeno es más grave que proponer el propio.

### Añadir una herramienta

1. Escribe la definición en `lib/definitions.mjs` como función que devuelve un objeto plano
   (`{ name, description, parameters, output, execute }`). `parameters` usa la forma del harness:
   `required: true` **en la propiedad**, no un array `required`.
2. Prueba su `execute` con un `exec` falso (`tests/helpers.mjs` → `fakeExec`), incluido el caso en que no
   hay `cwd`.
3. Regístrala en `index.js`: `ctx.tools.register(defineTool(tuDefinicion({ root })))`.
4. Si escribe algo, que pase por el mismo pipeline (`propose`), y que **no se active**.
5. Añade el contrato al protocolo solo si el modelo necesita saber cuándo llamarla, y **midiendo el
   coste**: el protocolo se paga entero en cada turno (`tests/definitions.test.mjs` fija el techo).

### Añadir un comando de sesión (con nombre por idioma)

1. La **definición base** va en `lib/commands.mjs`, dentro de `skillCommands()`, con el nombre del idioma
   base (`en`) y su handler. Ahí no se declara ninguna traducción.
2. La **operación** va en `LOCALIZED_OPERATIONS` (`lib/localized-commands.mjs`): id interno estable,
   `definitionId` (`skill-compiler.<id>`), `source` (el nombre base), `descriptionKey`, los dos nombres
   (`names.en` / `names.es`) y, si el comando toma argumentos, `hint` (una cadena para los dos idiomas, o
   `{ en, es }` cuando las palabras son idioma, como `skill-auto`). El handler **no** se escribe ahí: se hereda,
   y por eso los dos nombres no pueden divergir.
3. Añade las dos descripciones al catálogo (`lib/i18n/en.mjs` y `es.mjs`, ASCII) y, si el comando emite
   códigos nuevos, su texto `code.<codigo>` en los dos.
4. La puerta lo comprueba sola: `tools/i18n-gate.mjs` exige 16 operaciones (el recuento está en el gate),
   un nombre válido y único por idioma, que no quede **ninguna definición base sin operación** ni al revés, y
   que el único nombre sin traducir sea `skill-auto`. `npm test` incluye las dos pruebas verticales
   (`tests/menu-localizado.test.mjs` y `tests/localized-commands.test.mjs`).
5. Si es una **decisión** (mueve el almacén), añade su id a `DECISION_OPERATIONS` (`lib/presentation.mjs`) y
   revisa `lib/pending-rows.mjs` si además merece una fila en el menú. Los nombres de **fila** son siempre los
   ingleses (`skill-approve-<id>`): son marcador de máquina, no prosa.
6. Los nombres de la CLI y los flags siguen en inglés y no se localizan: la CLI es superficie de terminal,
   no del menú.

### Añadir un comando a la CLI

1. `bin/skill-compiler.mjs`: un `case` más, con lectura estricta de flags (los `--` desconocidos fallan).
2. Reutiliza `lib/`: la CLI y el plugin **comparten implementación**, y así las reglas no pueden
   divergir entre lo que el modelo puede proponer y lo que tú puedes aprobar.
3. Documenta el comando en `docs/OPERACION.md` y en la cabecera del propio fichero.

### Añadir o cambiar una pieza de interfaz

1. La lógica va en `lib/` (como `presentation.mjs`), **nunca** en `client.js`: el artefacto de navegador
   no se puede probar antes de instalar, así que solo dibuja lo que ya viene calculado.
2. El estado se pliega de **eventos existentes**. No añadas un tipo de evento propio: el registro de
   sesiones rechaza reabrirse con un evento desconocido sin marca `ignorable`, y esa marca no se puede
   poner al escribir.
3. Si necesitas un dato nuevo del Host, amplía la vista de la proyección en `lib/projection.mjs` (estado y
   esquema de vista) y el plegado en `lib/presentation.mjs`, y **mantén la vista en primitivos** (cadenas y
   números): el esquema que valida cada lectura es donde menos conviene arriesgar. El esquema es **Zod**,
   porque es lo que el registro del harness llama con `parse(...)`; `projectionContractProblems()` avisa en
   cuanto deje de serlo.
4. En el cliente: `ctx.locale.register` dentro de `ctx.effect`, estilos como elementos de React (al
   desmontar se van), y **un solo** `role="status"` atómico con la frase completa.
5. Comprueba la forma del artefacto, que es lo que sí se puede comprobar sin navegador: carga por
   `window.__ModuleLoader__`, que el `id` coincide con el paquete, que el slot existe, que respeta
   `prefers-reduced-motion`, que no usa emoji como icono y que no toca `document.body`.
6. **Di que el dibujo no está verificado** hasta que alguien lo mire instalado. Un adorno sin ver no es
   un adorno terminado.

## Pruebas

```sh
npm install           # OBLIGATORIO antes de nada: el plugin declara sus dependencias del harness
npm test              # las puertas (i18n + ASCII) y, si pasan, las 902 pruebas
npm run test:hermetic # lo mismo + huella del almacén real antes y después
npm run gate          # solo las puertas: para un cambio de texto o de catálogo
```

Las dos puertas son **obligatorias por construcción**, no por costumbre: `pretest` las corre antes que
`node --test`, y `test:hermetic` aborta si alguna está en rojo —y aborta **antes** de la suite, no después—.
Una puerta que se pudiera olvidar no sería una puerta. `tests/gates-obligatorios.test.mjs` siembra cada
defecto (clave que falta, código sin texto, placeholders inconsistentes, no-ASCII nuevo, una operación sin
nombre en un idioma, dos operaciones con el mismo nombre, el modelo de alias reintroducido, contrato de
herramientas alterado) en una **copia** del paquete y exige que la puerta se ponga roja.

- `tests/output-contract.test.mjs` — **el valor de cada herramienta contra el esquema que el harness
  valida**, en todas las ramas de su `execute`, con `validateJsonSchemaValue` (el juez real) y el esquema
  compilado por `defineTool`. Nació del defecto de la 1.3.0: `skill_propose` devolvía un campo no declarado y
  el harness rechazaba el resultado entero —con la propuesta ya escrita en disco—; la prueba se demostró
  **roja** antes de arreglarlo.
- `tests/commands.test.mjs` — los cinco comandos humanos: descriptor que el registro acepta, y los cinco
  caminos de cada uno (sin argumento, id inexistente, propuesta que no pasa la puerta, aprobación, rechazo),
  más que ningún camino raro lanza.
- `tests/auto-approve.test.mjs` — el modo «aprobar en esta sesión»: plegado desde el log (incluidos los
  eventos que no deben cambiar nada y un log corrupto), el comando, la delegación real en las dos vías
  (skill nueva y parche) y **lo que no se delega** (la puerta y el anti-solapamiento).
- `tests/catalog-freshness.test.mjs` — contra el registro de skills **real**: la primera prueba demuestra el
  rojo (sin aviso, el catálogo sigue cacheado), y las demás cubren el aviso explícito y la vigilancia del
  almacén para lo que muta fuera del proceso.
- `tests/activation.test.mjs` — **ejecuta la activación de verdad**: importa `index.js` y llama a
  `apply(ctx)` con un contexto doble, y comprueba que no lanza y que registra la sección, las cuatro
  herramientas (con los parámetros que verá el modelo) y el proveedor. Nació de un fallo real: el respaldo
  de la inyección opcional podía lanzar dentro de `apply` y llevarse por delante la activación entera.
  Lo que no cubre: el contexto es un doble, así que valida el camino del plugin, no los servicios reales.
  Esa carencia es justo lo que cubre la puerta siguiente.
- `tests/projection-contract.test.mjs` — la puerta que faltaba, contra el **registro real** de proyecciones:
  registra la unidad, proyecta una sesión (`snapshot`) y restaura desde un punto de control. Nació del
  defecto de la 1.1.2: la unidad se registraba con esquemas de schemastery —que no tienen `parse`— y el
  registro, que no valida lo que recibe, lo aceptaba; el fallo aparecía mucho después, al **leer** sesiones
  (`def.wire.viewSchema.parse is not a function`). Aquí se prueban además puntos de control corruptos, filas
  de otra versión, y que el guardián del contrato caza una unidad con esquemas que no validan.
- `tests/compiler.test.mjs` — el núcleo.
- `tests/definitions.test.mjs` — el protocolo y las definiciones ejecutadas con un `exec` falso.
- `tests/harness-contracts.test.mjs` — los contratos con el harness, y la puerta que habría cazado el
  defecto de la primera instalación: **toda importación de paquete tiene que estar declarada como
  dependencia**. Compila además las cuatro herramientas con el compilador **real** (esquemas y parámetros
  que verá el modelo), exige que la familia `dsh-*` comparta una sola versión, y comprueba que el cierre
  declarado esté instalado. Por eso la suite **necesita `npm install`**: sin él, esta puerta no puede
  cargar el compilador, que es justo lo que hace el arranque del plugin.
- `tests/vendor.test.mjs` — vendorizado con un `fetch` **falso inyectado**: sin red y capaz de provocar
  un secreto en el origen, una orden al agente, texto invisible, un 404 o una respuesta gigante.
- `tests/presentation.test.mjs` — el estado del feedback visual: el contrato del marcador congelado contra
  el `render` real de las herramientas, y el plegado de eventos.
- `tests/client-artifact.test.mjs` — la **forma** del artefacto de interfaz, que es lo único comprobable sin
  navegador: identidad igual al paquete, misma clave de proyección que el Host, el texto hereda el color y
  el acento pinta solo la marca, una sola región viva, movimiento reducido, sin emoji y sin tocar el
  documento. Un cambio que rompa cualquiera de esos contratos se pone rojo aquí, no en la interfaz.
- `tests/propose-real.e2e.mjs`, `tests/vendor-real.e2e.mjs` — guiones contra la red real. No los recoge
  `node --test` (necesitan un tercero), se ejecutan a mano.
- `tests/check-hermetic.mjs` — la puerta que mide que la suite no tocó el almacén real.

### Escribir una prueba hermética

```js
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);          // borra las cajas de arena

const s = sandbox();              // raíz temporal + DSH_HOME redirigido ahí
propose(goodInput(), { root: s.root, curated: s.curated, cwd: 'C:\\un\\proyecto' });
```

Dos garantías que conviene no romper:

1. **`sandbox()` redirige `DSH_HOME`.** Es una guarda estructural: una prueba que olvide pasar `root`
   escribe en la caja de arena, no en el almacén real. Ya ocurrió una vez —dos fixtures entraron en el
   almacén real y ninguna prueba se puso roja—, y por eso existe también `check-hermetic.mjs`, que lo
   **mide** en lugar de confiar.
2. **Toda dependencia externa se inyecta.** `fetchImpl` en vendorizado, `now` donde importe el tiempo,
   `root` y `curated` siempre. Una prueba que dependa de la red o del reloj deja de ser una prueba.

## Versionado y publicación

- La versión vive en `package.json` y su entrada en [`CHANGELOG.md`](../CHANGELOG.md).
- **Tras cambiar el código hay que reinstalar el bundle**: el perfil guarda su propia copia del paquete.
  Si el resultado de la instalación dice `restart-required`, reinicia el harness.
- Criterio de versión: `mayor` cuando cambia el contrato de una herramienta o el formato del almacén;
  `menor` cuando se añade capacidad; `parche` cuando se corrige un defecto.
- Antes de publicar: `npm run test:hermetic` en verde —corre las puertas i18n y ASCII y, si pasan, la
  suite—, `CHANGELOG.md` al día, y ningún secreto en el árbol (`git diff --check` no comprueba eso: míralo tú).
- **Una versión publicada se etiqueta**, y la etiqueta no se mueve nunca: se crea en el commit donde la versión
  queda **cerrada y coherente** —`package.json`, su entrada del CHANGELOG y las docs sin afirmaciones
  desfasadas—, con mensaje que resuma el alcance, y se empuja (`git push origin <etiqueta>`). Etiquetar un
  commit cuya documentación describe el comportamiento anterior deja un release que se contradice a sí mismo. Si una versión se publicó sin etiqueta, la etiqueta **no se inventa después**:
  se declara el hueco y se etiqueta desde la siguiente. (`v3.4.0`–`v3.7.0` se publicaron sin etiqueta: es un
  hueco declarado, no una serie de releases retroactivas.)
- **Los recuentos de pruebas que citan los README y esta documentación se actualizan al cerrar la
  versión**: un número desfasado es una afirmación falsa, no un detalle. La entrada histórica del
  CHANGELOG no se toca: allí el número viejo era verdad, y un historial que se reescribe deja de ser un
  historial.

## Deliberadamente fuera de alcance

No son olvidos; son decisiones, y cada una tiene su motivo:

| No se hace | Por qué |
|---|---|
| `git clone` del origen | Ejecuta hooks y trae código. Se descarga markdown por HTTPS y nada más |
| Fusionar automáticamente cuando el origen cambie | Nuestra versión está adaptada a propósito: una fusión automática destruiría la adaptación |
| Aprobar desde una herramienta del modelo | Si el modelo pudiera auto-aprobarse, la revisión humana sería decorativa |
| Una bandeja con estado propio dentro de la aplicación | Una proyección es un plegado puro de eventos y no puede leer el almacén; un remoto exigiría una cadena de compilación de cliente. Lo que sí existe, desde 1.4.0, es la decisión **dentro** de la sesión: comandos, una fila por pendiente en el menú `/` y tarjeta propia para el resultado. El análisis completo está en [`plans/PLAN-2026-10-13-acciones-en-la-tarjeta.md`](../../plans/PLAN-2026-10-13-acciones-en-la-tarjeta.md) |
| Consolidar skills solapadas automáticamente | Reescribir prosa sin pruebas y sin humano delante es cómo se pierde conocimiento |

## Estado conocido

- **Hecho (3.4.0 → 3.8.5)**: las acciones dentro de la tarjeta del resultado —casilla por pendiente, tres
  acciones con su ámbito, confirmación con alcance, y el lote como **una** orden del servidor—, con el
  informe verificado por el **veredicto por id del comando** —la frase que ve el humano— con las filas del menú como respaldo cuando el anfitrión las ofrece, y teñido por significado. Las filas por pendiente en el menú «/» dependen de
  que el anfitrión componga el registro de comandos en el contexto del agente: en las compilaciones medidas
  **no lo hace**, y el plugin no depende de ellas (ver [`ANFITRION.md`](ANFITRION.md)).
- **Pendiente real**: los 16 avisos `body-budget` de la auditoría (14 proponibles; 2 exigen criterio humano,
  `brandkit` entre ellas) y la propiedad del puesto, que sigue sin declarar (`ownership.json` ausente).
- `index.js` no tiene cobertura directa (no se puede importar fuera del harness). Es la razón de que sea
  fino; su verificación es la instalación real y el arranque del perfil.
- Las pruebas no cubren el comportamiento del **harness** (que la sección entre en el prompt, que el
  proveedor se consulte, que la herramienta se presente al modelo). Eso se comprueba instalando y
  observando, y queda declarado en cada entrega.
