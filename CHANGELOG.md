# Changelog

El formato sigue la idea de [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado
es semántico: `mayor` cuando cambia un contrato (herramientas o formato del almacén), `menor` cuando se
añade capacidad, `parche` cuando se corrige un defecto.

## [lifecode-skill-center 1.0.0] — 2026-11-08 · inicial

**Plugin nuevo, no una versión del compilador.** `lifecode-skill-center/` es el centro que administra el
conocimiento reutilizable: biblioteca persistente, compuerta de calidad, versiones inmutables con vuelta
atrás, **interruptor por skill y proyecto** y detección de lo que ya existe en disco. El compilador anterior
sigue siendo el que propone; este es el que decide qué se enciende y dónde.

Lo que entra:

- **Panel completo** en la barra lateral (clave propia en el slot `main`): Overview, Library, Projects,
  Improvements y Analytics, con cajón de skill, modal de creación y avisos. Se habla con el host por una ruta
  propia (`/lifecode-skill-center/api/`) porque los resultados de comando se normalizan a `{kind,text}`.
- **Cuatro herramientas** para el agente: `lifecode_skill_search`, `lifecode_skill_create`,
  `lifecode_skill_improve`, `lifecode_skill_status`. Ninguna aprueba ni activa.
- **Proveedor de skills** que sirve sólo lo encendido para la ruta que pregunta, con rango `160` (por debajo
  del compilador) y vista materializada en disco.
- **Invalidación real del catálogo**: cada acción del panel y el vigilante del almacén (`fs.watch` + sondeo)
  llaman a `control.invalidate()`; sin eso, encender una skill no se notaría hasta reiniciar.
- **Autorización en el borde**: `lib/api.mjs` devuelve `approval-required` a `actor:'ai'` para encender,
  volver de versión, decidir, publicar e importar.
- **Detección tolerante a la flexión** (`desplegar`/`despliega`), con umbrales distintos para biblioteca y
  disco externo.

Evidencia: **103 pruebas en verde**, puerta hermética con la huella del almacén real idéntica antes y después,
`npm run check` 100/100, y la promesa del producto medida de punta a punta en `tests/api.test.mjs` (crear con
`actor:'ai'`, servir en A y B, apagar en A y B sigue sirviendo).

Defectos reales encontrados y cerrados durante la construcción, no antes: el diario de eventos se reiniciaba
por un guard con `isObject` en vez de `Array.isArray`; el resultado del `manifest.json` se descartaba y una
asignación nueva no se reflejaba; un `POST` sin acción contestaba con el estado y escondía el fallo; la
detección exacta no veía la biblioteca propia.

## [5.0.2] — 2026-10-23 · parche

**Tres defectos mas del panel de pendientes, medidos con la 5.0.1 ya instalada y validados a mano por el
operador.** Es `parche`: no cambia el protocolo, ni los esquemas de las herramientas, ni el formato del almacen.
La documentacion de la feature de idiomas entra en este mismo acto (ver abajo).

1. **Un comando de lista dejaba un bloque de mas.** La 5.0.1 leia la foto al montar cada tarjeta, asi que
   `/skill-proposals` —que ya trae su lista— ejecutaba ademas un `/skill-pending` y dejaba dos bloques en el
   flujo. Ahora **no se lee al montar**: la tarjeta pinta la lista del comando que la abrio, y la foto se pide
   cuando hay algo que decidir (antes de mandar la orden) y cuando hay que medir el efecto (despues). Cero
   lecturas para listar.
2. **Una lectura forzada podia aceptar la foto de antes de la decision.** El single-flight devolvia la lectura
   en vuelo sin mirar cuando se habia pedido: si la tarjeta estaba leyendo cuando el humano decido, la
   comprobacion del efecto reutilizaba esa lectura vieja y podia decir «sigue pendiente» de algo ya publicado.
   Hay **generacion** en el store: `invalidar()` la sube, la lectura forzada arranca la suya, y una lectura de
   una generacion anterior que termina tarde **no escribe**. El single-flight se conserva dentro de la misma
   generacion.
3. **El lector compartido dependia de que tarjeta se pinto la ultima.** El respaldo leia las filas del menu con
   el verbo de la tarjeta (`approve`/`retire`), asi que dos tarjetas de la misma sesion con operaciones distintas
   podian dejar una foto con otro significado. Ahora la foto comun sale **solo** de `/skill-pending` —fuente
   independiente del verbo— y las filas del host se quedan como presentacion de cada tarjeta. Cuando la lectura
   no es medible no se juzga nada: no se abre la pantalla de avisos ni se declara que algo desaparecio.

### Documentacion — la feature de idiomas, con su metodo de uso

- `skill-compiler/README.md` gana la seccion **«Idiomas: que hay, como se cambia y que no cambia»**: las tres
  puertas para cambiarlo (`/skill-compiler-language --es|--en`, `lang es` en el CLI, `DSH_LANG`), la precedencia
  (`DSH_LANG` → preferencia guardada → `en`), la tabla de las **16 operaciones con su nombre en cada idioma**,
  lo que cambia y lo que **nunca** cambia (ids, banderas, codigos, formato del almacen, vocabulario del diario) y
  como comprobarlo con `doctor`.
- `docs/OPERACION.md` gana **«Cambiar el idioma, paso a paso»**, con lo que hay que verificar despues.
- Se corrige una afirmacion que ya era falsa: las **filas del menu siguen al idioma** (`skill-aprobar-<id>` en
  `es`), no son siempre inglesas; su nombre sale del mismo mapa que el de los comandos.

### Medido

- `tests/panel-pendientes.test.mjs`: **13 casos** (antes 9). Los nuevos: la lectura que empezo antes de decidir
  **no** puede ser la foto final (`invalidar` + `force` ejecutan su propio lector y la vieja no pisa la nueva —
  rojo antes del cambio, verde despues—), dos `force` de la misma generacion siguen compartiendo una ejecucion,
  dos tarjetas con operaciones distintas ven la foto nueva tras decidir en una, y el lector comun no menciona el
  verbo de la tarjeta.
- `npm run test:hermetic`: **902 pruebas, 902 pasan, 224 suites**; gates i18n (938 claves por idioma) y ASCII
  (8.289 con tope 8.289, 26/26) en verde; huella del almacen real **identica** antes y despues.
- Validacion manual del operador con DSH reiniciado (la que autoriza esta release): **un solo bloque** para
  `/skill-proposals`, la decision actualiza las tarjetas, y la skill aprobada sigue disponible en el ambito
  elegido.

Ojo al instalarlo: `client.js` lo carga el harness **al arrancar**, asi que el arreglo no esta vivo hasta
reiniciar DSH.

## [5.0.1] — 2026-10-23 · parche

**El panel preguntaba «¿qué está pendiente?» cinco veces por decisión, y una tarjeta seguía ofreciendo aprobar
lo ya publicado.** Es `parche` y no `menor`: no añade capacidad ni toca el protocolo, los esquemas de las
herramientas ni el formato del almacén; corrige un defecto de la superficie del panel (`client.js`).

### El defecto, medido

En una publicación real (`agent-team-specialized-delivery`, sesión del proyecto `nexusbusinesssuite`), la traza
de la sesión dio la secuencia exacta: **cuatro `/skill-pending` idénticos antes de decidir** (eventos 306-313) y
**uno después** (316-319), o sea cinco tarjetas de notificación para una sola decisión; y el bloque de la propia
orden de publicar seguía pintando la propuesta con su casilla y sus botones —«sigue disponible para aprobar»—
aunque arriba la tarjeta ya dijera «1 published · 0 failed · Pending now: 0». El almacén estaba bien: `proposed/`
vacío y la skill en `published/` y en la biblioteca. Era la interfaz, en dos capas:

1. **Cinco preguntas, cinco ejecuciones.** Para saber qué está pendiente el panel **ejecuta** `/skill-pending`
   (el anfitrión no ofrece canal de lectura) y lo hacía en cada paso: al leer los avisos previos, al comprobar
   que el id seguía vivo, y en cada vuelta del sondeo del efecto. Sin memoria entre llamadas, cada pregunta es
   una notificación en el flujo.
2. **Cada tarjeta con su foto.** El estado de pendientes vivía en el componente, así que la tarjeta que había
   leído antes de publicar conservaba su lista y ofrecía decidir sobre algo que ya no existía.

### La corrección

- **Un store de pendientes por sesión, compartido por todas las tarjetas** (`createPendingStore` en `client.js`):
  una sola lectura en vuelo (las llamadas concurrentes comparten la misma promesa), una foto con caducidad corta
  (1,5 s: dentro de la ventana, preguntar otra vez no ejecuta nada), `force` para comprobar el efecto de verdad,
  `invalidar()` para cuando algo cambia, y **suscriptores** para que la foto nueva la vean todas las tarjetas.
- **Una lectura antes de decidir y una después.** La de antes sirve para las dos cosas que se preguntaban por
  separado (los avisos que el humano tiene que leer y si el id sigue pendiente); la de después es la que mide el
  efecto, forzada, y es la que apaga el «sigue disponible» de las demás tarjetas.
- **Una propuesta suelta ya no se ofrece si no está pendiente**: si la foto dice que se decidió, el bloque queda
  como registro con su motivo (`bulk_decided`) y sin botones.
- **Un fallo de lectura no se convierte en «no hay nada»**: el error se declara, la foto anterior no se borra y
  la próxima lectura lo reintenta.

### Medido

- `npm test`: **898 pruebas, 898 pasan** en **223 suites** (antes 889/220; +9 casos, +3 suites).
- `tests/panel-pendientes.test.mjs` (nuevo): prueba el bloque del propio `client.js` y mide **cuántas
  ejecuciones cuesta el mismo dato** —1 para tres llamadas concurrentes o seguidas, 2 con `force`—, que todas
  las tarjetas suscritas ven la lista nueva tras decidir, y que un fallo de lectura no borra lo sabido.
- **Mutación controlada** (en una copia aislada, no en el árbol): quitar la ventana de la foto y el aviso a los
  suscriptores deja **6/9 con los tres casos que guardan los dos defectos en rojo**; restaurado, 9/9.
- Gates: i18n **938 claves por idioma**; ASCII **8.289 con tope 8.289** en 26/26 (la base bajó al pasar a ASCII
  las líneas nuevas del panel; ningún tope sube).
- Coste en el flujo: **una lectura al montar las tarjetas (compartida) + una antes de decidir + una después**,
  frente a las cinco de antes.

Ojo al instalarlo: `client.js` lo carga el harness **al arrancar**, así que el arreglo no está vivo hasta
reiniciar DSH.

## [5.0.0] — 2026-10-23 · contrato

**Las 16 operaciones de sesión pasan a tener un nombre por idioma, y el modelo de alias se retira.** Es `mayor`
porque los nombres de comando son superficie: quien invocaba `/skill-aprobar` en inglés deja de tener ese nombre
(ahora es `/skill-approve`), y el nombre del otro idioma **no se registra**. Entra además la deuda de idioma que
quedaba: toda la prosa humana del plugin sale del catálogo, en los dos idiomas.

### Cambiado — un nombre por operación, en el idioma activo

- **`lib/localized-commands.mjs`** declara las **16** operaciones: id interno estable, `definitionId`, nombre
  `en`, nombre `es`, clave de descripción y `input.hint`. El **handler se hereda** de la definición base, así que
  los dos nombres son la misma función y no pueden divergir. `skill-auto` mantiene el mismo nombre en los dos
  idiomas: una sola definición, con la descripción del idioma activo.
- **El registro sirve 16 filas, no 31.** El conjunto activo tiene un nombre por operación; el del otro idioma no
  se registra y **no es invocable**. Medido en la `0.2.1-rc.2`: `/skill-compiler-language --es` cambia el menú
  `/` de `/skill-approve` a `/skill-aprobar` **sin reiniciar** (altas antes que bajas sobre `commands/change`).

### Retirado — el modelo de alias

- Fuera `ALIAS_ESPERADOS`, `RETIRADA_DE_ALIAS`, `aliasProblems()`, `aliasSummary()`, los metadatos
  `aliasOf`/`deprecatedIn` y la clave `cmd.alias.deprecated`. Un nombre español ya no es «alias obsoleto» del
  inglés: es el nombre de la misma operación en español.
- **`tools/i18n-gate.mjs`**: la regla de los 15 alias pasa a la del mapa (16 operaciones × 2 nombres, un nombre
  válido y único por idioma, ninguna definición base huérfana, el único nombre sin traducir es `skill-auto`, y el
  modelo retirado no puede reaparecer en el código). Cinco pruebas negativas nuevas siembran cada defecto.
- **`doctor`** deja de decir «15 de 31 filas del menú (16 canónicos)» y dice lo que hay: `16 operaciones y 16
  filas en <idioma>`, construido desde el mapa.
- **`lib/presentation.mjs`**: `DECISION_OPERATIONS` se declara por id de operación y `decisionKindOf` resuelve el
  nombre en el mapa, así que reconoce `skill-aprobar` y `skill-approve` sin saberse ningún nombre de memoria.
- **`client.js`**: las listas de nombres y la composición de las órdenes del panel llevan los dos idiomas, y el
  nombre del comando sale del idioma del bloque que se decide. Antes componía siempre el nombre español, que sólo
  funcionaba por los alias: bajo `en` el botón de aprobar habría dejado de existir.
- **Los catálogos** ya no citan un comando que no existe en su idioma: la prosa española dice `/skill-aprobar`,
  `/skill-propuestas`, `/skill-propiedad`… (43 líneas).

### Cerrado — la prosa humana fuera del catálogo (la deuda que bloqueó el primer cierre)

El candidato integrado no pasaba la evaluación de idioma: con `DSH_LANG=en`, `audit` imprimía 9 líneas en
español y `security`, `check`, `repair`, `vendor`, `review` y `promote` tenían la misma deuda. Ahora:

- **Los hallazgos llevan su código.** `messageCode`/`messageParams`/`fixCode`/`fixParams` (y `detalleCode` en las
  pruebas de promoción) acompañan al `message`/`fix` crudo, que **se conserva como dato** porque viaja en
  `audit --json`, en `checkProposal.errors` y en las pruebas. `lib/audit.mjs` expone `fraseDeHallazgo`,
  `arregloDeHallazgo`, `estadoEnTexto` y `lineasDePuerta`; `lib/i18n/index.mjs`, `textoDeCodigo`, que centraliza
  la reserva (clave ausente → dato crudo, nunca una clave).
- **Una tabla por regla**: las ~45 reglas de calidad, seguridad y auditoría tienen su frase y su arreglo en los
  dos catálogos; las que tienen variantes (`security-tree`, `unreadable`, los motivos de los patrones) llevan
  código propio, y los motivos se resuelven en anidado (`motivoCode` → `security.motivo.*`) como ya hacía
  `fraseDeReparacion`.
- **La página de revisión** (`lib/review.mjs`) deja de tener frases fijas: cabeceras, botones y avisos salen del
  catálogo en el idioma efectivo, y las líneas de la puerta se componen de los hallazgos.
- **`promote`** añade `reasonCode`/`reasonParams` sin mover el `reason` (que es lo que se anota como `why` en el
  diario) y `ficherosQueDifieren` devuelve `[{ruta, cambio}]` en vez de una frase.
- **La capa del modelo no se toca a propósito**: `lib/definitions.mjs` es la superficie que lee el modelo (no
  varía por el idioma del humano) y su texto forma parte del contrato congelado. Se declara como tal.

### Medido en el candidato integrado

- `npm test`: **889 pruebas, 889 pasan** en **220 suites**.
- `npm run test:hermetic`: 889/889 y la huella del almacén real **idéntica** antes y después.
- `node tools/i18n-gate.mjs`: en orden, **938 claves por idioma**, 16 operaciones × 2 nombres.
- `node tools/ascii-gate.mjs`: **8.308 caracteres heredados con tope 8.308**, **26/26** ficheros de primera parte
  vigilados, 0 excluidos. Bajó de 8.401 al salir la prosa de los módulos; ningún tope sube.
- Salidas reales con el binario sobre una **copia fija** del almacén (para comparar los dos idiomas sin que el
  almacén se mueva): `audit` y `security` en `en` con **0 líneas de prosa española** (antes 11 y 25 caracteres no
  ASCII en prosa), y el mismo dato en los dos idiomas (44 skills en esa copia, PASS 43 · WARN 1 · ERROR 0, 32
  archivadas; mismos hallazgos, reglas y severidades por skill).
- Sobre el **almacén de la máquina** al cerrar (solo lectura, huella del árbol idéntica antes y después):
  `doctor` exit 0, `audit` 50 skills auditadas (PASS 49 · WARN 1 · ERROR 0, 32 archivadas) y `security` 45
  revisadas con 0 bloqueos, 0 avisos y cadena válida. El WARN es el `absolute-path` preexistente.
- `doctor` y los subcomandos de solo lectura (`audit`, `security`, `list`, `active`, `retired`, `systems`,
  `ownership`, `where`) en `en`: **0 prosa española** en la salida.
- `tests/update-real.e2e.test.mjs`: el último guion manual pasa a prueba descubierta, con mutación controlada
  (retirar la comprobación de integridad de la base pone en rojo el caso 4 y sólo ese; restaurado, 5/5).
- **Límite del anfitrión que sigue vigente**: `normalizeResult` recorta el resultado a `{kind, text}`, así que la
  reserva de prosa **no se retira por calendario**; se retira cuando una medición demuestre que `code`/`items`
  llegan al consumidor. Está declarado en `docs/ANFITRION.md` §5.

## [4.0.1] — 2026-10-23 · parche

**Dos rojos silenciosos del diagnóstico, y los dos son de la misma familia: una cifra escrita a mano y un
`catch` que convierte «no pude leer» en «no hay nada».** No añade capacidad —ni prompt, ni esquemas, ni formato
del almacén—, así que es `parche` y no `menor`.

### Corregido — `doctor` se ponía rojo con cualquier pendiente (G1)

- **Causa.** `bin/skill-compiler.mjs` daba el menú por bueno sólo si `filas === pendientes * 3`: un recuento
  clavado de cuando los verbos eran tres. `ROW_VERBS` (`lib/pending-rows.mjs`) tiene **cuatro** desde que
  publicar es una decisión propia —`show`, `approve`, `publish`, `reject`—, así que con UNA propuesta pendiente
  el diagnóstico se contradecía en dos líneas seguidas («1 pendientes -> 4 filas del menu» y acto seguido «cada
  pendiente ofrece sus tres verbos») y cerraba con «1 problema(s): con esto el plugin falla al activarse», exit
  1. La puerta de aceptación se ponía roja sobre un almacén sano en cuanto había algo que decidir, que es el
  estado normal del plugin.
- **Arreglo.** El esperado se **deriva** de `ROW_VERBS.length` —la lista que compone las filas, no una copia—,
  y el texto `cli.doctor.rows-verbs` toma `{n}` en los dos idiomas y nombra los cuatro verbos. El comentario de
  `ROW_VERBS` decía «los tres verbos» con cuatro en la lista, y se corrige ahí: un comentario que miente sobre
  su propio artefacto es la causa escrita al lado de la definición.

### Corregido — `security` salía en verde con un almacén que no pudo leer (G2)

- **Causa.** Los `catch { proyectos = [] }` y `catch { continue }` de `security` trataban **cualquier** error de
  lectura como «0 proyectos»: un `projects` que existe con otra forma (un fichero, `ENOTDIR`) o una carpeta sin
  permiso se presentaban como «0 skills revisadas · bloqueos: 0 · avisos: 0 · diarios: cadena valida · sin
  bloqueos y con el diario integro», con **exit 0**. Un lector que devuelve cero por un `catch` no distingue
  «no hay» de «no pude leer», que es exactamente lo que la regla del repositorio prohíbe.
- **Arreglo.** `ENOENT` sigue siendo «todavía no hay» (almacén recién instalado: válido, sin línea y sin rojo);
  `ENOTDIR`/`EACCES` en `projects/` produce la línea de lectura fallida con **ruta y código**
  (`cli.doctor.security-unreadable`, que ya existía en los dos idiomas, así que la paridad sigue en 566 claves)
  y **exit 1**; y un estado del proyecto que existe y no se puede leer entra como problema del diario en lugar
  de desaparecer del recuento.

### Medido

- **Suite: 777 pruebas en 192 suites, 0 fallos** (773 → 777 con este parche; +4 casos, contados por el delta
  del recuento y no por la existencia de los ficheros). Hermética en verde, con la huella del almacén real
  idéntica antes y después.
- **Cinco arenas por el binario**, con `stdio` no-tty y el exit real de cada una: sin `projects/` → 0;
  `projects/` vacío → 0; `projects` como fichero → **1** (`ENOTDIR`); `projects/<clave>/proposed` como fichero
  → **1**; almacén sembrado con una pendiente → `security` 0 (1 skill, 0 bloqueos, cadena válida), `audit` 0
  (1 PASS, 0 WARN, 0 ERROR) y `doctor` 0 (1 pendiente → 4 filas y «cada pendiente ofrece sus 4 verbos», donde
  antes cerraba en «1 problema(s)»).
- **Prueba del arreglo, no de la intención:** 6 de los 8 casos de los dos ficheros nuevos se ponen **rojos** al
  reintroducir los dos defectos en una copia temporal, y verdes en la rama; los 2 que siguen verdes son los
  estados legítimos (almacén ausente y `projects/` vacío).
- Gates obligatorios en verde: I18N **566 claves por idioma · 566 · 15 alias**; ASCII **7.579** caracteres
  heredados con tope 7.580 y ninguno nuevo. Sin cambio de contrato: el prompt, los esquemas y el formato del
  almacén siguen exactamente como en la 4.0.0.

## [4.0.0] — 2026-10-23 · release

**El plugin habla español e inglés, el contrato de lo que ve el modelo queda congelado y las puertas dejan de
depender de la memoria.** Esta versión no añade una función suelta: cierra las cuatro fases de la migración
—contrato, idioma, alias y cobertura—, el contrato de resultado por elemento del panel y las dos puertas
obligatorias. Y declara, con su medición, los dos límites que hoy impone el anfitrión.

### Cambiado — contrato y alias (F1.1)

- **Los comandos de sesión pasan a nombre inglés como canónico** (`/skill-proposals`, `/skill-pending`,
  `/skill-show`, `/skill-approve`, `/skill-publish`, `/skill-scope`, `/skill-disable`, `/skill-enable`,
  `/skill-retire`, `/skill-retired`, `/skill-ownership`, `/skill-systems` y `/skill-reject`, más `/skill-auto` y
  los tres de propiedad —`/skill-ownership-dsh-only` y `/skill-ownership-machine` incluidos—). Los **15 nombres
  españoles** siguen funcionando como alias del canónico —mismo handler, mismos
  argumentos, misma puerta y mismos efectos— hasta `5.0.0` (`RETIRADA_DE_ALIAS`). Renombrar un comando es
  cambiar el contrato: por eso esta entrega es **mayor**, no menor.
- **El alias se declara por metadatos** (`aliasOf`, `deprecatedIn`) y no por el texto de la descripción, para que
  una superficie pueda ocultarlo por **dato**. `aliasProblems()` mide nueve formas de mentir en silencio
  (destino inexistente, alias que no se registra, `aliasOf` cruzado, retirada que no es versión, handler ausente,
  descripción vacía, alias fuera de la tabla, nombre duplicado y alias de sí mismo) y `aliasSummary()` publica
  canónicos, alias y filas. `doctor` cuenta las **31 filas** del menú en voz alta
  (`15 de 31 filas del menu (16 canonicos)`), para que la tabla no pueda quedarse corta sin decirlo.

### Añadido — idioma ES/EN (F1.2, F1.3, F1.4)

- **F1.2 · catálogo por grupos.** El texto que presenta el plugin vive en `lib/i18n/{es,en}.mjs`: **566 claves
  por idioma** (34 al empezar la migración), con paridad **bidireccional** comprobada —claves de más y de menos,
  prohibición de clave cruda y reserva al idioma base—. No se movieron los `code` ni las líneas del lote
  (`ok    <id> — …` / `FALLO <id> — …`): el panel las parsea con `/^FALLO\s+(\S+)\s+—/`, así que son **protocolo**
  y se quedan literales aunque estén en español. Las aserciones de prosa que ya pasaban se conservaron fijando
  `DSH_LANG=es` por fichero, así que además prueban la traducción española.
- **F1.3 · la superficie visible al modelo, congelada sin texto.** `tests/fixtures/definitions-contract.json`
  fija la **estructura**: 4 herramientas (contadas en `index.js`), 16 comandos, 15 alias, el rango del proveedor
  (150) y la sección estática del prompt (orden 9000). El manifiesto **no guarda cadenas**, así que traducir no
  obliga a regenerarlo y una traducción no puede tapar un cambio de esquema; el texto se protege por propiedades
  (ASCII puro, idioma y lista de rutas que no pueden quedarse vacías). `tests/definitions-schema.test.mjs`:
  **18/18**. El texto visible al modelo quedó en ASCII puro: se retiraron 10 caracteres no ASCII —9 U+2014 y
  1 U+2026— en 8 rutas de `skill_propose`.
- **F1.4 · cobertura medida, no supuesta.** `tests/i18n-cobertura.test.mjs` (9 casos) ejecuta el idioma base `en`
  sin `DSH_LANG` en motor y binario, y compara los **31 comandos** en los dos idiomas exigiendo el **mismo
  `kind`, mismo `code` y mismos `params`**. El texto cambia en 20 o más —los que sólo devuelven datos no cambian,
  y eso es correcto—, los marcadores del lote viajan intactos, `unsafe-id` conserva su `params.id` y no queda ni
  una clave cruda ni un placeholder sin sustituir.

### Añadido — el contrato de resultados por elemento (F2)

- `aprobarLote` devuelve **`items: [{id, kind, code, state, params, text}]`**: un veredicto por elemento, con
  `state` derivado del `code` por tabla (`activated` → `approved`, `already-active` → `approved`,
  `updated-disabled` → `disabled`, `published` → `published`, `set-aside` → `rejected`, y un elemento fallido da
  `failed` con su `code`). Un código fuera de la tabla da `unknown`, **no un estado inventado**. No se quitó ni se
  renombró nada de lo que ya había, y el lote **no** emite un `code` global a propósito: un `batch-partial`
  global haría que el panel marcara un solo id de los varios que decidió.
- `client.js` prefiere `items` al `code` suelto y a la prosa, **ignora** los ids que no se pidieron y trata un
  `state` desconocido como **fallo visible**. La ventana de compatibilidad: un `code` reconocido manda siempre;
  uno desconocido no se convierte en éxito ni vuelve al regex; y `scope-ask`, `language-ask` y `pending-list` son
  neutros, no veredictos.
- La **reserva de prosa aprendió inglés** (`Active`, `Published`, `Set aside`, `Already active`, y `FALLO` acepta
  la raya del servidor o el guion ASCII). Sin eso, con el texto inglés —ya el idioma base— una aprobación
  correcta no se reconocía y el panel la contaba como fallo.
- **Límite declarado**: el anfitrión recorta el resultado. `normalizeResult` (`@deepseek-ai/dsh-commands`)
  reconstruye el objeto a `{kind, text}`, así que `code`, `params` e `items` **no llegan al panel en producción**:
  hoy decide la prosa como **reserva**, y se retira en **4.2.0** sólo si el anfitrión ya transporta el objeto del
  handler. Si sigue recortando, el panel tendrá que decir «no medible en este anfitrión» en vez de contar cero.
  El contrato completo, la condición y la fecha: [`skill-compiler/docs/ANFITRION.md`](skill-compiler/docs/ANFITRION.md).

### Añadido — puertas obligatorias (F3)

- `tools/gates-obligatorios.mjs` corre la puerta i18n y la ASCII en serie, devuelve distinto de cero si alguna
  falla y dice **cuál** (con `--json` para leerlo como dato). `pretest` lo cuelga de `npm test`, así que la suite
  no corre una sola prueba con una puerta en rojo, y `test:hermetic` corre las puertas **antes** de la suite.
  Una puerta que depende de la memoria no es una puerta.
- `tests/gates-obligatorios.test.mjs` (11 casos) siembra cada defecto en una **copia** del paquete —nunca en el
  árbol— y exige el rojo: clave que falta, código sin texto, placeholders inconsistentes, no-ASCII nuevo, alias
  con destino inválido, contrato de herramientas alterado por el esquema y la expectativa congelada con un
  parámetro de más, además del runner con una puerta en rojo y dos asertos de cableado.

### Corregido

- **`/skill-scope` llamaba a `ambito()` sin importarlo.** El `try` convertía el `ReferenceError` en «No se pudo
  completar: ambito is not defined», así que cambiar de ámbito desde la sesión **nunca funcionó** y ninguna prueba
  lo ejercitaba (la del motor probaba el motor). Arreglado, con un caso que ejecuta **el comando**.
- **`doctor` fallaba en un almacén recién instalado**: `readdirSync(<almacén>/projects)` sin guarda convertía el
  `ENOENT` de una carpeta de estado en «no pude leer». Un `ENOENT` es «todavía no hay»; `EACCES`/`ENOTDIR` sí son
  fallo y se declaran con su motivo.
- **Los avisos de una propuesta se leían vacíos**: `scanTree` devuelve la ruta del `SKILL.md`, no la de su
  carpeta, así que `join(fila.path, 'meta.json')` no existía y un `catch` mudo lo contaba como «0 avisos».
- **`deprecatedIn` decía `4.0.0` mientras la descripción del mismo objeto decía «se retira en 5.0.0»**: el
  metadato estaba clavado a mano en vez de salir de `RETIRADA_DE_ALIAS`. Publicar 4.0.0 así habría declarado
  retirado, en su propia versión, un alias que sigue vivo. Ahora se deriva de la constante y las pruebas comparan
  contra ese dato. **Y la regla de `i18n-gate` que lo daba por bueno también estaba clavada en `4.0.0`**: ahora
  lee `RETIRADA_DE_ALIAS` y exige que el metadato sea ella o su literal exacto, con un caso negativo que siembra
  el número viejo en una copia del paquete y exige el rojo (`gates-obligatorios.test.mjs`, 10 → 11 casos).

### Medido en esta entrega

- Suite **769/769** en **190 suites**, con `pretest` (puertas i18n y ASCII) en verde, y `npm run test:hermetic`
  con la huella del almacén real **idéntica** antes y después.
- Catálogos: **566 claves por idioma**, **15 alias**, paridad bidireccional.
- ASCII: **7580 caracteres heredados** con tope **7580** — no crece ni uno.
- `definitions-schema`: **18/18**; los fixtures del contrato, intactos.
- `audit`: **48 skills** · PASS 47 · WARN 1 · ERROR 0. El WARN es **preexistente** y ajeno a esta entrega:
  `absolute-path` (observado `/mnt/c`) en `approved/nexusbusinesssuite-3495896e/wsl2-red-espejo-y-toolchain-php`,
  una skill del almacén cuya decisión es de su humano — se resuelve localizándola o parametrizando la ruta, y no
  se toca desde aquí.
- `security`: **0 bloqueos · 0 avisos**, cadena del diario válida, 44 skills en 3 proyectos.

### Límites declarados (no se ocultan)

- **El menú `/` no puede ocultar un alias, y su dibujo no se puede observar desde este entorno.** Medido en la
  compilación instalada: `normalizeDefinition` publica un descriptor de lista cerrada
  `{definitionId?, name, description, input?}`; `aliasOf` y `deprecatedIn` tienen **0 apariciones** en todo el
  `app.asar`; y la única condición que oculta una fila es no declarar `hint` cuando el cursor no está al inicio.
  El plugin mide los alias (**15 de 31 filas**) y `doctor` los cuenta, pero **las filas visibles no se afirman**:
  aquí no hay navegador ni sesión interactiva.
- **El resultado viaja recortado a `{kind, text}`.** El contrato por elemento está escrito y probado en los dos
  lados y entra cuando el anfitrión transporte el objeto; mientras tanto decide la prosa. La condición que hay
  que mirar antes de retirarla en 4.2.0 está en `docs/ANFITRION.md`.
- Siguen en español, como **dato** y no como presentación, la prosa de `observado`/`umbral` de las medidas y los
  `motivo` de bloqueo de `repair`; `redaccion` del diario es vocabulario congelado por contrato y no se traduce
  nunca.

## [3.8.6] — 2026-10-21

**La prueba de que una decisión ocurrió es el veredicto del comando —la frase que ve el humano—, no el menú.**

### Corregido

El panel daba por buena una aprobación sólo si la pendiente desaparecía de la lista de **filas del menú**. En un
anfitrión que no anuncia filas, esa lista no existe: el efecto no se podía observar y **una aprobación correcta
se contaba como fallida**. Se midió en vivo: el panel aprobó dos propuestas («0 approved · 2 failed»), y al
escribir el comando el propio plugin contestó «Ya estaba activa» — estaban hechas desde el primer intento. Lo
que faltaba no era ejecutar, era **creer la evidencia correcta**.

- **Se lee el veredicto por id** del texto que devuelve el comando: `Activa: <id>`, `Ya estaba activa: <id>`,
  `Apartada: <id>` y el `ok <id> — …` / `FALLO <id> — …` del lote. Es la misma frase que ve el humano, así
  que no hay dos verdades. Las líneas de la puerta (`  FALLO  <regla> …`, sangradas y sin id) no cuentan.
- **Las filas quedan como comprobación de respaldo**, y su ausencia es un estado de primera clase
  (`medible: false`): si no hay filas, no se afirma nada. «Pendientes ahora» dice «no medible en este
  anfitrión» en vez de repetir el número de la tarjeta como si fuera el del almacén.
- **Un lote con resultados parciales no tira lo que sí ocurrió**: se cuenta lo que el comando dijo por id y
  sólo se reintenta lo que quedó sin veredicto.
- **Un error semántico no se reintenta con otras firmas**: si el comando contestó («tiene avisos», «no hay
  ninguna propuesta»), repetir tres veces sólo ensucia el motivo. Sólo un error de transporte justifica otra
  forma.

### Pruebas

- `tests/client-artifact.test.mjs`: el veredicto se **extrae del cliente y se ejecuta** con un corpus real
  (lote, `Ya estaba activa`, y la línea de la puerta que no debe confundirse). Se afirma que un
  `kind: 'success'` sin veredicto **no** es éxito, y que sin filas no se pinta una cifra. **48/48** en ese
  fichero; **593/593** en la suite, hermética verde.

## [3.9.3] — 2026-10-21

**Cambiar de ámbito deja rastro.** `ambito` movía la skill y no anotaba nada: tras localizar una publicación, el
diario seguía diciendo «publicada · global» mientras el almacén decía «local». El diario mentía por omisión.

### Corregido

- `ambito` anota `globalizada` / `localizada` con las huellas de origen y destino, por el escritor único del
  diario (el mismo de las aprobaciones), así que la cadena sigue verificándose.

### Documentado

- El ámbito lo decide el **origen de la operación** —el proyecto desde el que se dirigía el trabajo—, no el sitio
  donde acaba el artefacto. La propuesta guarda `project`/`projectKey` desde que nace; publicar es una decisión
  aparte.
- Cómo se repara un asiento que falta: con el escritor único, declarando el cierre en `nota`; nunca a mano. El
  hueco de la localización ejecutada antes de este arreglo quedó cerrado así (15 entradas, cadena válida).

**614/614** en verde y hermética verde.

## [3.9.2] — 2026-10-21

**La tarjeta pregunta antes de ejecutar, no después del fallo.** Los avisos de una propuesta valen para
**los dos ámbitos** —local y global—, y hasta ahora el panel los descubría mandando la orden y recibiendo una
negativa que el anfitrión pintaba como `failed`, un fallo que el humano no había provocado.

### Corregido

- **Los avisos se conocen de antemano.** `/skill-pendientes` añade `avisos: <id>=<n>` y una línea `aviso:` por
  cada uno, leídos del `meta.json` de la propuesta (sin ejecutar la puerta dos veces). Si alguno de los ids
  marcados tiene avisos, la tarjeta abre la pantalla de avisos **sin mandar nada**; al aceptar, la orden sale
  ya con `--force`. Ni una orden rechazada por el camino.
- `join(fila.path, 'meta.json')` apuntaba a `SKILL.md` (la fila trae el fichero, no el directorio): los avisos
  se leían vacíos. Corregido con `dirname`.

**613/613** en verde y hermética verde.

## [3.9.1] — 2026-10-21

**Decidir desde la tarjeta ya no termina en un callejón: los avisos se leen y se aceptan, y lo que ya no está
pendiente se dice.** Dos defectos medidos al pulsar «publicar para todos mis proyectos» en una propuesta real.

### Corregido

- **Una propuesta con avisos sólo ofrecía un error.** La puerta pedía una decisión explícita (`--force`) y el
  panel no tenía forma de darla: el humano veía «1 failed» con la primera línea del aviso cortada. Ahora la
  negativa por avisos se reconoce como **semántica** (no se reintenta con otras firmas), la tarjeta muestra el
  texto entero de los avisos y ofrece **«Acepto los avisos y continúo»**, que ejecuta la **misma** orden con
  `--force`. Sólo al pulsarlo: el panel no fuerza por su cuenta.
- **Una tarjeta desactualizada ofrecía decidir algo que el almacén ya no tiene.** El panel confiaba en los ids de
  la tarjeta; si la propuesta ya se había aprobado o vivía en otro proyecto, la orden fallaba con «no hay ninguna
  propuesta» —un error que el humano no podía arreglar—. Ahora, antes de ejecutar, se pregunta al plugin con el
  comando nuevo **`/skill-pendientes`** (ids en una línea, sólo lectura) y lo que ya no espera decisión se
  informa como tal: «ya no está pendiente en el almacén: la tarjeta estaba desactualizada».

### Añadido

- `/skill-pendientes`: los ids pendientes en una línea estable (`pendientes: N` · `ids: a,b,c`). Es la fuente que
  consulta la tarjeta y no depende de que el anfitrión anuncie filas del menú.

**611/611** en verde y hermética verde.

## [3.9.0] — 2026-10-21

**El cuerpo de una skill es también el índice de su material: mover una sección ya no deja referencias a la vista
de nadie.** Defecto medido durante el mantenimiento del almacén: `moverMaterialPesado` mueve secciones enteras, y
un enlace que vivía dentro de una sección movida **viaja con ella**; el cuerpo deja de listar referencias que sí
existen. En el caso real, `design-taste-frontend` pasó de 11 enlaces en el cuerpo a **1** y `imagegen-frontend-web`
de 6 a 5. El conocimiento seguía a dos saltos, pero la skill dejaba de decir dónde estaba.

### Añadido

- **Índice «Material consultable»**: tras mover, el cuerpo recibe una sección con las referencias que el texto
  **no** enlaza ya —la unión de las dos cosas es todo el material—, de modo que ninguna queda sólo alcanzable
  desde dentro de otra. Es una sola lista, no una por sección, y se refresca en cada pasada en vez de acumularse.
- **El bloque lleva marcadores propios** (`<!-- skill-compiler:indice:inicio -->` / `…:fin`), y sólo se reemplaza
  el bloque con esos marcadores y la forma exacta que escribe el motor. Antes se borraba desde cualquier
  `## Material consultable` hasta el final: el título lo puede usar el autor, y eso era borrar prosa legítima.
  Una sección del autor con ese nombre se **respeta** (no se mueve, no se duplica) y el aviso viaja a quien
  repara.
- **Migración del índice anterior**: se reconoce sólo si es exactamente su huella (última sección, frase fija,
  nada más que rutas). Cualquier otra cosa se conserva y se declara ambigua.
- **El presupuesto se mide sobre el cuerpo final real** —marcadores y lista incluidos—, no con una constante
  aproximada por referencia: con nombres largos, la constante se quedaba corta y el cuerpo salía del umbral en
  silencio.

### Añadido

- **`approve <id> --local --preserve-state`**: corrige una skill **apagada sin encenderla**. El estado se lee
  del origen y el flag se niega en una activa; la corrección vuelve a `disabled/` y la anterior se aparta. El
  diario la registra como `actualizada-apagada`.
- **Corrección de una skill global sin moverla**: `repair` toma como base la copia publicada (`base: published`)
  y `approve --global` republica; la versión anterior se archiva en nuestro almacén
  (`global/superseded/<id>-<fecha>`) y el proyecto sólo guarda `published/`. No se localiza ni cambia de ámbito.

### Corregido

- El índice se retiraba con una expresión que casaba en el primer salto de línea y dejaba los puntos colgando: cada
  pasada añadía otra lista y el cuerpo crecía en vez de bajar.

### Pruebas

- `tests/repair.test.mjs`: caso de arena con una sección que enlaza material previo — tras reparar, **toda**
  referencia de la skill es alcanzable desde el cuerpo y el cuerpo cabe. **592/592** y hermética verde.

## [3.8.5] — 2026-10-19 · release

**La auditoría deja de contar el archivo como si fueran skills a arreglar: 7 errores falsos desaparecen.**

### Corregido

- `superseded/` guarda la versión anterior con el nombre `<id>-<fecha>` —la convención **del propio archivo**— y
  con el cuerpo que se aprobó entonces. Al auditarlo con las reglas de hoy salían dos errores que no se pueden
  arreglar sin reescribir la evidencia: `security-id` (el nombre del archivo no es un id) y `body-max` (el
  cuerpo de entonces era más largo). En el almacén real eran **7 errores** de 51 fichas, todos en el archivo, y
  tapaban el estado verdadero. Ahora se **cuentan y se declaran aparte** («archivadas: N · no se auditan») y no
  entran en el total medido: 44 auditadas, PASS 27, WARN 17, **ERROR 0**.
- Vale igual para el archivo de la biblioteca global (`global-superseded`).

**592/592** en verde y hermética verde.

### Documentación

**`docs/ANFITRION.md`: el anfitrión medido, sus límites y la preparación.** Un solo sitio para lo que la
compilación instalada ofrece de verdad (comandos globales, `runCommand` con texto con barra, `listCommands`,
eventos de sesión y catálogo por proyecto) y lo que no (registro de comandos por agente: tres caminos, tres
motivos), qué se implementó para no depender de lo que falta —tres caminos de montaje con motivo, la orden
exacta en la lista, verificación por efecto, aviso mudo sin pendientes, huella de contenido y diario
encadenado— y qué ocurrirá cuando el anfitrión gane la capacidad: nada que tocar, porque ningún camino está
desactivado a mano y `tests/activation.test.mjs` monta un anfitrión falso por camino exigiendo filas sin aviso.
Cierra con las cinco limitaciones declaradas y qué las cierra a cada una.

## [3.8.4] — 2026-10-19

**El aviso del menú calla cuando no hay nada que anunciar.** Con cero pendientes seguía apareciendo en cada
consulta, y en ese estado no informa de nada: no hay propuestas que el menú pudiera ofrecer, así que tampoco hay
nada que se esté perdiendo. El aviso nació para explicar por qué una pendiente no aparecía en el menú «/»; sin
pendientes no hay pregunta que responder y sólo queda ruido en la respuesta.

Ahora la condición tiene dos partes: el montaje falló **y** hay pendientes. Con la lista vacía la salida es la
lista de activas y nada más; con pendientes, el aviso reaparece exactamente donde sirve —con la orden exacta
arriba y la nota de que no hay nada que corregir—. La prueba de activación lo fija de punta a punta: monta con
el `inject` roto, comprueba el aviso, arregla el `inject` y comprueba que desaparece, aparta la pendiente y
vuelve a listar para verificar que **tampoco** se avisa.

**592/592** en verde y hermética verde.

## [3.8.3] — 2026-10-19

**El plugin deja de depender del menú: la lista trae la orden exacta que decide todas.**

### Medido

Tres caminos probados contra el anfitrión real, tres motivos distintos y ninguno sirve: `agent.ctx.inject(['commands'])`
no llama a su callback; el hijo montado con `agent.ctx.plugin({ inject: ['commands'] })` tampoco recibe el servicio; y
`agent.ctx.commands` lanza `cannot get property "commands" without inject`. **El contexto del agente no compone
`commands` en esta compilación**, así que las filas por propuesta no se pueden montar ahí. Seguir intentándolo era
insistir en una API que el anfitrión no ofrece.

### Añadido

- **La orden exacta, siempre**: `/skill-propuestas` imprime, con las pendientes, una línea que las decide todas
  (`Una orden para todas: /skill-aprobar a,b,c --local`) y las variantes por id, por ámbito y con `--force`. Con
  filas o sin ellas — lo que decide no depende del menú, y no hay que recordar ningún identificador.
- **El aviso dice la verdad y no culpa a nadie**: «este anfitrión no anuncia filas por propuesta en el menú «/»»,
  con la nota de que no hay nada que corregir: la orden de arriba y el panel las deciden. Se retira el «conviene
  reportarlo», que ya está medido.

### Se conserva

Los tres intentos de montaje (cuestan nada y otro anfitrión puede ofrecerlos) y las filas cuando el host las
componga. Lo que **no** se hace es prometerlas.

**592/592** en verde y hermética verde.

## [3.8.2] — 2026-10-19

**Las filas del menú se montan con la forma que documenta el anfitrión: un hijo bajo `agent.ctx` que declara su
propio `inject`.**

### Corregido

- El aviso ya traía el motivo exacto (`cannot get property "commands" without inject`) y eso descartó las dos
  hipótesis anteriores: el servicio **no está** en el ámbito del contexto del agente tal cual, y leerlo directo
  lanza. El README de `@deepseek-ai/dsh-commands` dice la forma correcta —«un plugin montado bajo `agent.ctx`
  que declara su propio `inject` y registra un comando exacto de ese agente»—. Ahora el montaje lo hace así:
  `agent.ctx.plugin({ name, inject: ['commands'], apply })`, y ese hijo recibe el servicio (o queda esperándolo
  si aún no está) sin acceder nunca a una propiedad no inyectada.
- Se conservan como respaldo el `inject` suelto y el registro directo —cada uno en su `try`—, y el motivo final
  distingue los tres caminos agotados. El hijo se desmonta con el plugin: al descargarlo no queda nada colgando.

### Pruebas

- `tests/activation.test.mjs`: **dos más** — el hijo montado que recibe `commands` (monta, no avisa, y se
  desmonta al descargar) y el caso anterior del `inject` que no llama con registro directo disponible.
  **592/592** en verde y hermética verde.

## [3.8.1] — 2026-10-19

**Dos avisos de la sesión, atendidos: el montaje de filas no se rinde sin probar el registro directo, y el
panel deja de confundir «nada pendiente» con «no hay filas».**

### Corregido

- **El montaje de filas prueba el registro del propio contexto cuando `inject` no llama.** El aviso medido en
  la sesión («el anfitrión no expone el registro de comandos en el contexto del agente») se debía a que el
  `inject` del contexto del agente no ejecutaba su callback; el contexto **sí** tenía `commands`, y ningún
  código lo miraba. Ahora, si `inject` no llama, se usa `agent.ctx.commands` directamente —con la misma lógica
  de recomposición y retirada— y sólo si tampoco existe se declara el motivo, **distinguiendo** «no existe» de
  «existe sin `register()`». Una fila más de diagnóstico en vez de una acusación genérica al anfitrión.
- **«Nada pendiente» no es «no hay filas».** Con cero pendientes el panel decía «No hay filas que decidir…,
  escribe «/» y elige la fila», que manda a buscar algo que no existe. Ahora son dos estados con su mensaje y
  su tono: verde «Nada pendiente…» cuando la lectura salió bien y la lista vino vacía; ámbar con la pista del
  comando por id cuando había pendientes y el catálogo de la sesión no las anunció.

### Pruebas

- `tests/activation.test.mjs`: **una más** — agente cuyo `inject` nunca llama y cuyo `ctx.commands` sí registra:
  las filas se montan, `/skill-propuestas` no avisa, y al descargar el plugin no queda ninguna colgando.
- `tests/client-artifact.test.mjs`: las tres condiciones de estado (leyendo, nada, pendientes sin fila) y los
  dos textos nuevos. **591/591** en verde y hermética verde.

## [3.8.0] — 2026-10-18 · release

**El panel de decisiones se lee de un vistazo y se mueve lo justo.** Aprobado en vivo: el anfitrión ejecuta
`runCommand` con **texto con barra**, así que el panel aprobó de verdad —3 y luego las 7 restantes, 0 fallos,
pendientes a 0— y el lote va en una sola orden.

### Añadido

- **Un tono por significado** en el informe del panel, todos derivados de `currentColor` (el texto no baja del
  contraste que el anfitrión ya aprobó): **verde** cuando todo salió, **ámbar** cuando hubo mezcla o nada llegó a
  ejecutarse, **rojo** en los fallos, apagado en lo informativo. La fila que quedó hecha se atenúa y su marca se
  tiñe; la que falló, en rojo.
- **Microanimación de entrada** (170–200 ms, dos píxeles) en las líneas del informe y en las marcas de estado.
  Con `prefers-reduced-motion: reduce` no hay animación: sólo el estado final. El color no es el único aviso —el
  texto sigue diciendo qué pasó—, así que la información no depende de distinguir tonos.

### Documentado

- `docs/OPERACION.md`: qué significa cada tono y por qué el movimiento se apaga.
- La forma del anfitrión queda registrada en el propio informe («Host call shape that worked: texto con barra»),
  para que una actualización que la cambie no vuelva a fallar en silencio: el sondeo prueba y **verifica el
  efecto** antes de dar nada por hecho.

## [3.7.0] — 2026-10-18

**Toda aprobación deja rastro: el ciclo del aprendizaje se puede auditar de punta a punta.** El diario anotaba
las promociones del motor, y **no** las aprobaciones humanas ni las del modo automático —justo lo que convierte
una propuesta en conocimiento servido—. «Se aprobó» era una afirmación sin respaldo, y el camino que más lo
necesita (la herramienta que aprueba sola, con el modo encendido) era el único que no anotaba nada.

### Añadido

- **Un solo escritor encadenado** (`anotarEntradaEnDiario` en `lib/security.mjs`) usado por los **tres** caminos:
  promoción (`lib/promote.mjs`, misma API), aprobación humana (`/skill-aprobar`, `/skill-globalizar`, el panel y
  la CLI) y aprobación automática de la herramienta. Una cadena, no tres.
- **Cada decisión lleva lo que hace falta para auditarla**: `decision` (`aprobada`/`publicada`/`apartada`),
  `ambito` (`project`/`global`), `por` (`humano`/`auto`), `canal` (`comando`/`herramienta`), `hashAnterior` y
  `hashResultante` del **contenido**, `superseded` y los `avisos` con los que se aprobó. Con eso se responde
  «¿qué se aprobó, sobre qué contenido, y quién lo decidió?» sin mirar otra cosa.
- **El lote anota una entrada por elemento** (aprobar diez es diez decisiones, no una); `security` verifica la
  cadena entera, incluidos los diarios que sólo tenían promociones.

### Corregido

- **`skill-globalizar` ya no fuerza los avisos.** Llamaba con `force: true` incondicional: publicar para todos
  se saltaba los avisos de la puerta sin que nadie lo dijera. Ahora se pide `--force` explícito, como en la
  aprobación local, y queda registrado en la entrada.
- **La herramienta automática aprueba el contenido que validó**: pasa la huella del contenido a `approve`, así
  que la garantía de integridad cubre también ese camino (antes aprobaba sin comprobarla).
- **La CLI dejó de reimplementar la aprobación.** Tenía su propia copia de las comprobaciones y por eso era el
  único camino humano que no dejaba entrada en el diario ni verificaba el contenido. `approve <id>` y
  `approve --grupo` llaman ahora a la **misma** función que el comando y el panel: una regla, una
  implementación, un rastro. Comprobado de punta a punta desde la CLI en una caja de arena: propuesta → aprobada
  → entrada `aprobada/project/humano/comando` con las dos huellas iguales.

### Pruebas

- `tests/journal-aprobaciones.test.mjs`: **siete casos** — aprobación local con sus huellas, publicación global
  con su ámbito, lote con una entrada por elemento, apartar, la herramienta automática con `por: auto`, la
  cadena detectando una entrada editada y `skill-globalizar` exigiendo `--force`. **586/586** en verde y
  hermética verde; el almacén real, intacto.

## [3.6.0] — 2026-10-18

**Aprobar en lote es una orden del servidor, no diez llamadas al host.** El panel pedía N ejecuciones y el host
no las ejecutaba —ni un `command/run` en las trazas—, así que el lote nunca ocurrió: decía «N aprobadas · 0
fallos» y el almacén seguía igual. La auditoría descartó las dos explicaciones fáciles (código viejo, copia del
plugin) y encontró la real: **la forma de llamar a `runCommand` no es la del host**.

### Añadido

- **`/skill-aprobar <id1>,<id2>,… [--local|--global]`**: un lote es **una** orden. Cada id pasa por la misma
  puerta, se aprueba o falla por su cuenta, y el informe dice cuál fue cuál (`ok`/`FALLO` por línea). Si alguno
  falla, el comando devuelve error —un lote con un fallo necesita que alguien lo mire—; si todas estaban ya
  activas, es éxito («un acto ya hecho»). Sin ámbito pregunta **una vez** y no mueve nada. Los repetidos no se
  aprueban dos veces.
- **`aprobarLote()`** en `lib/commands.mjs`, exportada y testeable: la misma puerta que el singular, resultado
  por elemento, y un solo aviso al catálogo.
- **El panel usa la orden del lote** cuando hay más de una marcada (una llamada al host, un efecto que medir) y
  **cae a id a id** si el lote no obra; además **prueba las formas conocidas** de `runCommand` (texto con barra,
  nombre + args, objeto, texto solo) y **se queda con la que el almacén confirma**, reutilizándola en el resto.

### Corregido

- **El informe del panel se comprueba contra el efecto**: tras cada orden se relee la lista del host, y sólo se
  cuenta como hecha si el id deja de estar pendiente. Si ninguna forma ejecuta, el panel pinta el fallo con las
  firmas reales de `runCommand`/`listCommands` y las líneas exactas para pegar en el compositor.

### Pruebas

- Seis casos del lote (local, global, fallo de uno sin arrastrar, ya activo, sin ámbito, repetidos) y la puerta
  del artefacto ampliada a las formas del host y al lote como una sola orden. **579/579** en verde.

## [3.5.4] — 2026-10-18

**El panel dice qué props le entrega el host, para dejar de adivinar su contrato.** El asar del harness está
minificado y no contiene `listCommands` ni `runCommand` bajo esos nombres; el panel pide ejecutar y recibe
`undefined`. En vez de suponer, cuando un lote falla entero el panel pinta `host · say=function · node=object ·
sessionId=string · …` con **todos** los nombres y tipos que recibe: una sola pulsación basta para saber con qué
se habla. **567/567** en verde.

## [3.5.3] — 2026-10-18

**El panel vuelve a mentir menos de lo que mentía: si el host no ejecuta, se ve.** Tres veces seguidas el panel
dijo «N aprobadas · 0 fallos · Pendientes: 0» y el almacén siguió con las mismas diez pendientes; en las trazas
no hay **ni un** `command/run` de ese lote. La causa está fuera de este repositorio —el host no devuelve
resultado cuando el panel pide ejecutar—, y lo que sí se puede garantizar aquí es que el panel no lo cuente
como éxito.

### Corregido

- **Sin resultado del host no hay éxito**: un `undefined` caía en el «si no es error, hecho». Ahora es un fallo
  con motivo («el host no devolvió resultado: el comando no se ejecutó»).
- **El informe se comprueba contra el efecto**: tras el lote se vuelve a leer la lista del host y «Pendientes
  ahora» es lo que el host dice, no lo que el panel creía.
- **Si no se ejecutó nada, da la salida**: muestra las líneas exactas (`/skill-aprobar <id> --local`) para
  pegarlas en el compositor, que es la vía que sí funciona hoy.

### Pruebas

- Tres comprobaciones nuevas en la puerta del artefacto (sin resultado no hay éxito; relectura del host; líneas
  para pegar). **567/567** en verde y hermética verde.

## [3.5.2] — 2026-10-18

**El aviso de huella era un falso positivo en todas las aprobaciones, y el panel contaba como aprobado lo que
sólo era una pregunta.** Los dos salieron de un mismo acto real: once «aprobaciones» en el panel, diez skills
que seguían pendientes y un aviso de integridad que nadie podía interpretar.

### Corregido

- **El aviso de huella (`b8d97078ebe8 → 672ed05d2101`) no era una divergencia.** La comprobación medía el
  árbol entero, `meta.json` incluido, y el movimiento reescribe ese fichero a propósito (`state`,
  `approvedAt`, `supersededPrevious`). Medido en arena: `SKILL.md` idéntico byte a byte, solo el meta cambia.
  Ahora se mide la **huella del contenido** (`SKILL.md` y `references/`) y el movimiento la verifica **antes**
  de renombrar: una divergencia de contenido aborta sin mover y sin apartar la versión anterior. Queda una
  comprobación posterior que, si alguna vez no casara, devuelve la skill a `proposed` y declara la aprobación
  **fallida** — nunca un aviso con la skill activa.
- **El panel contaba como aprobado lo que no lo era.** «Approve the selected» ejecutaba `skill-aprobar <id>`
  sin ámbito; el comando, para no decidir por el humano, **pregunta** dónde vive la skill, y el panel leía esa
  pregunta como éxito. Ahora el botón manda `--local` (ámbito explícito) y, si aun así el comando respondiera
  preguntando, el panel lo cuenta como pendiente con su motivo. Contrato del lote en `docs/OPERACION.md`.
- **Un fallo al mover** (destino ocupado por un fichero, permisos) devuelve motivo en vez de excepción.

### Pruebas

- `tests/approval-integrity.test.mjs`: **ocho casos** — aprobación sin cambios (sin aviso), local y global con
  el mismo contenido, lote como N individuales, fallo de uno sin arrastrar al resto, cambio de contenido tras
  validar (no se mueve nada), transformación legítima del meta (la regresión del aviso), fallo al mover y
  divergencia que no queda activa.
- La puerta del artefacto de interfaz comprueba el `--local` y el marcador de la pregunta.
- **564/564** en verde y suite hermética verde (el almacén real, intacto).

## [3.5.1] — 2026-10-17

**La etiqueta del medidor en `/skill-propuestas` no se pintaba: faltaba el import.** El módulo existía y el
medidor funcionaba, pero `lib/commands.mjs` llamaba a `medirAutoActualizacion` sin importarlo; el `try` lo
capturaba y la fila decía «no se pudo medir». Lo destapó el listado real, no la suite — porque la prueba
comprobaba la marca de actualización y no la etiqueta. Ahora la prueba exige «auto-actualizable | exige
humano» y prohíbe «no se pudo medir», que es el síntoma que se había escapado. **553/553** en verde.

## [3.5.0] — 2026-10-17

**El medidor de la actualización automática: cuándo una corrección puede activarse sola, y cuándo no.** Era la
mitad que faltaba de la política: una skill **nueva** podía activarse sola con `/skill-auto`, y una **corrección**
de algo vivo nunca — «queda para una fase posterior, con su política de riesgo». Esta es esa fase, con números.

### Añadido

- **`lib/auto-update.mjs`** — `medirAutoActualizacion(id, key, { root, curated, cwd })` devuelve un veredicto
  con **una medida por condición** y su número: `es-actualizacion`, `nivel` ≤ 2, `evidencia-observada` (una
  ruta que exista en el proyecto, no una afirmación), `disparador` sin cambios, `seguridad` 0/0, `diff-medido`
  y las **nueve pruebas** de `promover`. **No medible no es pasar.**
- **`promover` obedece el veredicto**: si alguna medida falla, la propuesta espera y el diario anota
  `espera-medidor` con las medidas; si pasa, el nivel efectivo es el suyo, nunca por encima de 2.
- **`autoApproveIfAsked` usa el medidor para las correcciones**: con el modo encendido, una corrección medida y
  apta se activa sola; si no, el motivo que se devuelve es lo que midió. Las skills nuevas no cambian.
- **`auto [<id>]`** en la CLI (solo lectura) y **`/skill-propuestas`** etiqueta cada actualización
  («auto-actualizable» o «exige humano: …»), medidas con el mismo medidor que decide.

### Corregido

- **El tamaño del diff se medía en cero.** `propose` guarda `diff.lineas` como **número** y dos lectores pedían
  `.length`: la puerta de tamaño y la exigencia de justificar lo eliminado leían **cero líneas en toda
  propuesta guardada**. `cuentaDiff` acepta cuenta y lista. Caso real medido: 3 añadidas y 1 eliminada leídas
  como 0.
- **Una propuesta sin diff pasaba el tamaño por omisión**: ahora `diff-medido` lo exige.

### Pruebas

- `tests/auto-update.test.mjs`: **8 casos** — una corrección limpia es apta y se activa; y cada uno de los
  cinco motivos de rechazo (evidencia que es una afirmación, disparador cambiado, ruta sensible, nivel 3, base
  movida, diff enorme) deja la propuesta esperando con `espera-medidor`. **553/553** en verde.

## [3.4.0] — 2026-10-17

**Decidir desde el panel ya incluye el ámbito, y una pendiente que actualiza algo activo lo dice.** Dos cosas
medidas en uso real: el panel ofrecía «aprobar» y «apartar» pero no el ámbito —así que aprobar «para todos»
obligaba a teclear la sintaxis a mano—, y una **actualización** de una skill ya activa se listaba igual que
una skill nueva, con lo que el mismo id aparecía en «pendientes» y en «activas» y parecía que la aprobación
anterior no había servido (`fault-injection-by-category`: propuesta de las 15:48 sobre la versión aprobada de
las 15:08).

### Añadido

- **Tercera acción en el panel**: «Publicar para todos los proyectos», junto a «Aprobar las marcadas» y
  «Apartar las marcadas». Funciona con **varias marcadas** (una ejecución por id, como el resto), la
  confirmación dice el alcance y, para las que lo tienen, avisa de que se publican en la biblioteca de usuario
  y que la copia del proyecto queda archivada en `published/`. Textos en español e inglés.
- **`pending()` marca `updatesActive`**: una propuesta sobre algo que ya está aprobado, apagado o publicado es
  una **actualización**. Se dice en el listado de `/skill-propuestas` («· actualización de la versión activa»)
  y en la descripción de sus filas del menú («Actualiza una skill que ya está activa: si pasa la puerta, la
  sustituye y la anterior queda apartada»).

### Pruebas

- Dos nuevas de servidor (la actualización se anuncia; una propuesta nueva no se anuncia como actualización) y
  la puerta del artefacto de interfaz comprueba las tres acciones, los seis textos en los dos idiomas y que la
  confirmación lleve el alcance. **545/545** en verde y hermética verde.

## [3.3.0] — 2026-10-16

**Una capa de seguridad con contrato escrito, porque el plugin escribe texto que el modelo obedece.** Medido
sobre un día de uso real sin fallos, el punto débil no era el motor: era que un id podía ser una ruta, una
skill podía llevar una credencial o una orden dirigida al agente, un enlace dentro de una skill podía sacarla
de su carpeta, y el diario se podía editar sin que se notara. Nada de eso se presume ahora: se comprueba, se
declara y se prueba con casos adversarios.

### Añadido

- **`lib/security.mjs`** — la capa: contrato de id (`motivoDeIdInseguro`, con nombres reservados de Windows y
  el motivo concreto), escaneo del contenido en dos niveles (bloqueo / aviso), revisión del árbol (enlaces,
  dispositivos, tope de ficheros), huella de árbol y cadena del diario.
- **El escaneo vive en la puerta**, no en cada comando: `validateInput` y `auditarCarpeta` son las dos únicas
  entradas, así que proponer, aprobar y auditar leen el **mismo** juicio. Mira cuerpo, frontmatter y cada
  fichero de `references/`, con fichero y línea.
- **Credenciales y órdenes al agente son bloqueo**: no se escriben y no se aprueban ni con `--force`.
  Rutas sensibles y operaciones privilegiadas son **aviso**: las decide un humano, y la promoción automática
  no las toca.
- **El id se juzga donde se mueve**: `move` y `locate` rechazan un id que no es un id, así que la CLI, los
  comandos del harness y las filas del menú no tienen una segunda implementación donde colarse.
- **El árbol no lleva enlaces**: `revisarArbol` en `move`, y la huella del árbol se compara antes y después
  del movimiento para que «lo validado es lo movido» sea un dato y no una promesa.
- **La promoción automática sube a nivel humano** si el contenido levanta cualquier aviso de seguridad, por
  encima del nivel que declare el parche.
- **El diario encadena**: `huellaAnterior` y `huella` por entrada; editar, borrar o insertar se detecta, y las
  entradas anteriores al encadenado se declaran en vez de contarse como rotura.
- **`security`** en la CLI: recorre el almacén entero, verifica cada cadena y sale con 1 si hay algo. Y una
  línea en `doctor`.

### Documentación

- `docs/SEGURIDAD.md`: modelo de amenaza, contrato de id, los dos niveles, el árbol, la cadena, cómo se
  comprueba y **lo que la capa no hace** (no ejecuta, no es antivirus, no protege de un `--force` humano, no
  autentica el diario, no cifra).

### Pruebas

- `tests/security.test.mjs`: **17 casos adversarios** — ids que son rutas, credenciales en todas sus formas,
  órdenes al agente, destrucción, árbol con enlace, huella, cadena editada/borrada/antigua y la integración en
  la puerta y en la promoción automática.
- **540/540** en verde (523 + 17) y suite hermética verde. El almacén real: 31 skills, **0 bloqueos, 0
  avisos**, tres diarios con cadena válida (8 entradas anteriores al encadenado, declaradas).

## [3.2.1] — 2026-10-16

**Un id mal tecleado deja de ser un callejón sin salida.** Medido en uso real: `/skill-aprobar
dhs-nexus-protocol --local` —una letra cambiada de sitio— respondía «No hay ninguna propuesta
«dhs-nexus-protocol»» y ahí se acababa todo. Era verdad y no ayudaba: costaba una vuelta entera de mirar la
lista, teclear otra vez, y se leía como un fallo del plugin. Sin tag ni release (no autorizado).

### Añadido

- **`sugerenciaDeId(wanted, key, { root })`**: el id que el humano quería decir, si lo hay, con una vara
  determinista (≤ dos ediciones sobre los ids que existen en el ámbito del proyecto y en la biblioteca de
  usuario) y candidatos ordenados, así que un empate se resuelve siempre igual. **Sugiere, no aprueba**: no
  mueve ni valida nada por parecido.
- Los tres caminos que no encontraban el id —`/skill-ver`, `/skill-aprobar` y `/skill-rechazar`— pasan por
  una sola redacción: si huele a letra cambiada, dicen «¿Querías decir «…»?»; si no, siguen diciendo dónde
  mirar.

## [3.2.0] — 2026-10-16

**La propiedad se endurece, el inventario deja de confundir «no se pudo leer» con «no hay nada», y dos
defectos reales del motor salen a la luz al medir el puesto.** El motor preparaba correcciones de skills
cuyo `meta.project` apunta a otra ruta y las acusaba de perder material (`failed`) **dejando la propuesta
escrita**: 11 de las 16 skills con `body-budget` caían en ese falso fallo. Y el único aviso
`absolute-path` del almacén real era un falso positivo.

### Añadido

- **La declaración de propiedad tiene cuatro estados, no dos**: `ausente` (nadie ha respondido),
  `declarada`, `invalida` (JSON roto, valor fuera de contrato o **campos desconocidos**) e `ilegible` (existe
  y no se puede leer). `invalida` e `ilegible` **no se presumen**: se aplica la política segura y se declara
  el motivo y cómo arreglarlo. Antes los tres se leían igual —como «sin declarar»— y un JSON roto parecía una
  pregunta sin responder.
- **Declarar es compare-and-swap**: `declararPropiedad(..., { esperadaHuella })` se niega si el fichero
  cambió entre la lectura y la escritura, así que dos sesiones no se pisan la respuesta. La escritura sigue
  siendo atómica (temporal + `rename`) y se relee para comprobar que quedó como se escribió.
- **El inventario dice qué NO pudo leer**: `leerAlmacen` devuelve `accesible`, `parcial`, `inaccesible` o
  `inexistente` con su motivo, y `inventario` marca `completo: false` cuando una fuente configurada y
  existente no se pudo leer. **Sólo con el barrido completo se afirma que no hay choques**; si no, dice
  «sin choques COMPROBADOS» y lista las fuentes sin leer. Un enlace roto es un almacén inaccesible, no uno
  inexistente. La huella del inventario identifica lo leído.
- **La identidad se clasifica con evidencia, y la huella informa pero no decide**: `distinto-contenido`
  (choque real), `misma-copia` (**mismo contenido**: sigue siendo un choque declarado si nadie firma la
  procedencia) y `no-determinable`. Una publicación **nuestra** —la copia de la curada que lleva nuestro
  `origin`— se declara como tal y no es un choque. Dos nombres que sólo difieren en mayúsculas se declaran.
- **Rutas**: `resolverRuta` canóniza **hasta el ancestro que existe** y devuelve la cola sin resolver aparte
  (así un enlace que sale del ámbito se ve aunque el último tramo no exista), y `bajoRaiz` compara canónicas:
  `..` y los enlaces que apuntan fuera no pasan.
- **La escritura va bajo el cerrojo de la skill**, el **mismo** que usa la promoción (movido a
  `lib/lock.mjs`: dos mecanismos de exclusión serían dos verdades), y dentro se repiten las dos
  comprobaciones que sostienen la decisión: que la política no cambió y que el id no vive fuera. La propuesta
  guarda su alcance (`scope`: política, huella, sitios, y si el barrido fue completo) para poder auditarla
  después.
- **`absolute-path`, por contexto**: la ruta que se **usa** (prosa) avisa; la de un **bloque de código** es
  un ejemplo y la de **código en línea** una cita — las dos quedan como `info` en el informe y no engordan
  los avisos. Una ruta con la barra duplicada (como aparece dentro de un JSON) se declara **ambigua** en vez
  de callarse.

### Corregido

- **La guarda del material de `reparar` buscaba la propuesta con `projectKey(cwd)`** en vez de con la clave
  que recibió la función: con una skill cuyo `meta.project` apunta a otra ruta, o con `--project-key`, miraba
  un proyecto que no era, veía un árbol vacío, **acusaba a la propuesta de perder material** y devolvía
  `failed`… dejando la propuesta escrita en su sitio. Medido: 11 de las 16 skills con `body-budget`. La clave
  se pasa explícita, como en el resto de la API de almacén.
- **Un cuerpo que no cabe en un corte automático ya no produce una propuesta que no lo arregla**: si lo
  único pendiente es el tamaño y el movimiento se declara imposible, el motor **bloquea** con el motivo y
  lo que hace falta (`body-sin-corte-posible`) en vez de proponer una corrección de forma que deja el
  hallazgo donde estaba.
- **El detector de rutas dejó de avisar por una barra escapada**: el único aviso del almacén real era el
  literal de una expresión regular dentro de código en línea.
- **Los nombres de las referencias son únicos, legibles y estables.** El motor creaba `references/<slug>.md`
  mirando solo los ficheros de esa misma pasada, así que chocaba con el material que la skill **ya tenía**
  —medido: 11 secciones de `design-taste-frontend` y 6 de `imagegen-frontend-web`— y la puerta rechazaba la
  propuesta entera por «dos contenidos distintos en la misma ruta». Y cuando sí veía un choque, un `continue`
  **dejaba la sección sin mover en silencio**. Ahora el nombre se desambigua con la huella corta del título
  **completo** —estable entre ejecuciones, distinta para títulos distintos— y se comprueba contra todo lo
  ocupado (lo de la skill y lo de la pasada). Los dos casos reales pasan de bloqueados a reparables:
  `design-taste-frontend` 19.017 → 6.604 bytes y `imagegen-frontend-web` 19.067 → 6.917, con las nueve
  pruebas de regresión en verde.

### Pruebas

- `tests/scope.test.mjs` reescrito (28) con los cuatro estados, el inventario incompleto, la identidad y
  las rutas; `tests/scope-concurrencia.test.mjs` (8) con el cerrojo compartido, la idempotencia y la
  coherencia CLI/comando ejecutando el CLI real; `tests/audit-rutas.test.mjs` (9) con el falso positivo y lo
  que debe seguir bloqueándose; `tests/scope-procesos.test.mjs` (5) con **procesos independientes** y
  sincronización por condiciones; y ocho regresiones en `tests/repair.test.mjs` (nombres de referencia y los
  dos casos reales en arena). **Suite medida: 519/519** (506 antes de este cierre · 470 antes del acto),
  hermética en verde.

## [3.1.0] — 2026-10-16

**El plugin daba por hecho que el puesto era suyo.** Y no lo es: en esta máquina escriben skills también la
biblioteca curada del harness (22 carpetas, de las que **20 no las escribió este plugin**) y los almacenes de
otros agentes y editores. Nada declaraba quién manda sobre qué, así que el mismo id podía acabar en dos sitios
con contenido distinto — dos verdades sobre lo mismo y ninguna señal. Se añade la **propiedad del proceso de
creación de skills**, con dos respuestas y ninguna por defecto, y la política frente a los demás sistemas.

### Añadido

- **La propiedad del puesto, declarada y medida**: `dsh-only` (sólo se trabaja con DSH: escribe en su almacén y
  en la biblioteca curada, y **rechaza** un id que ya viva fuera) o `machine` (todo el PC: además **mira** los
  demás sistemas, avisa de cada choque con su sitio y puede traer lo ajeno como propuesta con procedencia).
  Vive en `<almacén>/ownership.json`. **Sin declarar, la propiedad es `null`** — elegir «todo el PC» solo no es
  una decisión del motor — y el plugin lo dice al proponer, en `/skill-propiedad` y en `doctor`/`ownership`.
- **`/skill-propiedad [dsh-only|machine]`** y sus dos filas de un clic en el menú `/`
  (`skill-propiedad-dsh-only`, `skill-propiedad-machine`); y en el CLI, `ownership [dsh-only|machine]`.
- **`/skill-sistemas`** y `node bin/skill-compiler.mjs systems`: inventario de sólo lectura —cada sistema con su
  ruta y sus skills, y **los ids que viven en más de uno**, con el sitio de cada copia—. Mide 7 sistemas
  conocidos y los que se declaren por `SKILL_COMPILER_SISTEMAS` (almacenes que el módulo no puede adivinar).
- **La puerta mira fuera, sólo al proponer algo nuevo**: con `dsh-only` un id que ya vive en otro sistema se
  rechaza con el sitio de la otra copia; con `machine` se propone con el aviso; sin declarar se avisa de que
  falta la respuesta. Actualizar lo nuestro nunca es una colisión.
- **`/skill-aprobar` sin id no es un error de sintaxis**: enseña lo que hay (y arma las filas). Pedir a un
  humano que recuerde un identificador para decidir era la nota al pie que este plugin venía evitando.

### Las tres invariantes

1. **Nunca se escribe en el almacén de otro sistema** — ni con `machine`: lo ajeno se lee, se cita y, como
   mucho, se copia **hacia dentro** con procedencia.
2. **Nunca se sobrescribe lo que no es nuestro**, tampoco dentro de la curada: sin nuestro `origin` no se toca.
3. **Una copia publicada no es una colisión**: la publicada vive en la curada y deja constancia en `published/`,
   y el inventario la lee como una sola copia efectiva. Medido en el almacén real: **0 choques**, y los dos ids
   que viven en ambos sitios son nuestras propias publicaciones.

### Corregido

- El inventario **no inventa un choque consigo mismo**: un almacén declarado dos veces se cuenta una sola vez
  (deduplicado por ruta), y una declaración ilegible no se finge — se lee como «sin declarar» y se vuelve a
  preguntar.
- El protocolo dice que la propiedad existe y cómo se declara, en una línea (1.121 caracteres · 281 tokens,
  contra el tope de 1.200 de `tests/definitions.test.mjs`).

### Pruebas

- `tests/scope.test.mjs`: **14 nuevas** (propiedad sin declarar / declarada / declaración ilegible; inventario y
  choques; la copia publicada que no es choque; el almacén declarado dos veces; y los tres casos de la puerta).
  Suite completa: **470/470**.

## [3.0.1] — 2026-10-16

**El motor preparaba correcciones que su propia puerta rechazaba.** Medido al reparar el almacén real: tres
skills con `body-max` prepararon propuestas que `promote` rechazó por `tamano` —16 secciones movidas cuando la
puerta admitía 3, y 6 cuando admitía 3—. La causa era una doble vara: `repair` movía material **hasta bajar del
umbral** (en bytes, sin límite) y `promote` acotaba la corrección contando **trozos** (`1 + exceso/5.000`). Dos
fórmulas para la misma regla producen, tarde o temprano, una propuesta condenada — y preparar algo que la
puerta va a rechazar no es preparar.

### Corregido

- **Una sola vara para el tope.** `topeDeMovimiento(bytesAntes, { umbral, objetivo, paso })` vive en
  `lib/repair.mjs` y la usan las dos partes: el motor al preparar y `pruebasDeRegresion` al promocionar. Se mide
  **en bytes** —el trabajo delegado al automático es el exceso, no su troceado— y cubre la distancia al objetivo
  (80% del umbral) más el trozo mayor disponible, porque una sección no se parte y con pasos discretos el
  exceso solo no cruza.
- **El motor no propone lo que quedaría por encima del umbral.** Si el movimiento no deja el cuerpo por debajo
  del techo, no se crea propuesta: se declara en `sinReparacion` con el motivo y lo dice el CLI. Es la
  garantía real, y no depende de que la fórmula acierte.
- **`sin-ciclos` mide progreso, no repeticiones.** Tres promociones seguidas del mismo arreglo **con el cuerpo
  bajando** ya no se confunden con un bucle: el ciclo es repetir sin avanzar, y el avance se mide (cada ronda
  parte de un cuerpo estrictamente menor). Un bucle de verdad —mismo arreglo, cuerpo clavado— se sigue parando.
- `meta.repair` publica la ronda: `topeBytes`, `paso`, `bytesMovidos`, `cuerpoTrasBytes` y `alcanzoObjetivo`; el
  diario anota `cuerpoBytes` en cada promoción.
- **`conservacion` mide sin el título de nivel 1**, igual que el resto del motor. El H1 lo compone
  `renderSkill` a partir de la descripción, así que no es contenido: medirlo contaba como conocimiento perdido
  y hacía **impromovible** cualquier corrección de una skill con el H1 editado a mano («desaparece rutas:
  Nuxt/Vue» con todo el material en su sitio). Y cuando la corrección normaliza un H1 que decía otra cosa, la
  revisión **lo declara** en vez de que desaparezca del diff.
- **Un aviso no arrastra a nivel humano la corrección de un error.** Si un aviso cuyo arreglo es de nivel 3
  (`absolute-path`) convive con un error de nivel 2 (`body-max`), la propuesta entera subía a nivel 3 y la
  corrección del error se quedaba esperando a una persona. Ahora se planifica lo que bloquea más los avisos que
  no suben el nivel; los demás se declaran en `sinReparacion` para que los decida quien puede.

### El montaje de las filas del menú: ni se cae en silencio, ni se rinde

Caso real medido en el almacén: las pendientes estaban, `/skill-propuestas` las listaba con sus doce filas…
pero el catálogo de esa sesión no tenía ninguna, así que el menú no ofrecía nada y la tarjeta se limitaba a
decir «no hay filas que decidir en el catálogo de esta sesión». El montaje se caía sin decirlo —y la
documentación prometía que el plugin «lo deja dicho en vez de fingir»— y el agente quedaba cacheado con el
montaje a medias, de modo que ningún intento posterior podía arreglarlo.

- **El comando humano monta las filas.** Cualquier comando ejecutado asegura antes las filas de **su** sesión:
  si el provider no las montó (o no llegó a montarlas), el humano es el otro camino que conoce al agente.
- **El fallo se declara donde se lee**: `/skill-propuestas` avisa con el motivo y recuerda que las decisiones
  funcionan igual escribiendo el comando entero.
- **Un montaje a medias no se cachea**: se reintenta (hasta tres veces, con el motivo del último intento) y los
  efectos retirados se sueltan todos, no sólo el primero.


### Pruebas

- `tests/repair.test.mjs`: el tope se mide en bytes y es cero por debajo del umbral; el movimiento no pasa del
  tope y declara que no llegó al objetivo; **lo que el motor prepara cabe en su tope y deja el cuerpo por debajo
  del umbral** (26 secciones pequeñas: el caso que la cuenta por trozos rechazaba).
- `tests/promote.test.mjs`: lo que el motor prepara pasa su propia puerta con el tope publicado en bytes; un
  parche que pasa del tope no se promociona; la puerta recalcula el tope con la misma función aunque el parche
  venga a mano; y los ciclos se miden por progreso (bajando pasa, clavado se para).

451 pruebas en verde · suite hermética con huella idéntica.

## [3.0.0] — 2026-10-16

**Una sesión que aprende varias cosas puede proponerlas todas, y la interfaz deja de contar eventos.** Preguntado
así: *«¿qué pasa si en una sesión la evaluación o reflexión debería crear más de una skill, o el conocimiento
revisado toca más de un tema y se deberían hacer patches en varios skills? ¿Cómo manejamos esos casos y cómo la
interfaz puede seguir dándonos el feedback correctamente?»*.

Es **`mayor`** por el criterio del repositorio, y no por el tamaño: la superficie visible al modelo cambia de
contrato —`skill_propose` gana un parámetro (`group`), gana campos en su esquema de salida (`group`, `siblings`),
su descripción cambia, la vista de la proyección gana `ids` y el frontmatter de las skills gana
`metadata.dsh.groupId`/`groupWhy` (formato del almacén)—. Que nada de lo que antes pasaba deje de pasar (salvo el
veto, que rechazaba lo que no debía) es lo que hace el cambio **compatible**, no lo que lo hace menor.

### El defecto, medido antes de tocar nada

Tres skills de temas **distintos** propuestas en la misma sesión: la 2ª y la 3ª se vetaban por «mismo-tema»
contra la 1ª (parecido 0,68). La huella comparaba descripción y disparador **completos**, así que medía el
**estilo** de redacción del mismo autor —presente en 8/8 skills de la biblioteca— y no el tema. Con los pares
etiquetados, el margen entre lo que debía vetarse (0,800–1,000) y lo que no (0,708–0,739) era de **0,06**.

### Cambiado

- **El veto de solapamiento mide tema y no estilo**: el peso de cada token sale de su frecuencia en la
  biblioteca (`log(1 + N/(1+df))`), y lo que aparece en casi todas (≥0,8 de ellas, con ≥6 skills para comparar)
  pesa cero. Las palabras funcionales del español también se ignoran: medido, bastaban para que dos asuntos sin
  nada en común superaran el umbral. Umbral nuevo **0,40**, calibrado con pares etiquetados y corpus neutral:
  temas distintos **0,000**, mismo tema **0,500–1,000** (margen 0,500).
- **El mismo tema con sinónimos se caza por la etiqueta declarada** (normalizada, sin acentos): un parecido de
  vocabulario no puede ver sinonimia, y no se le pide.
- **La píldora cuenta skills, no eventos**: la vista lleva los `ids` del turno; con varias skills distintas
  dice cuántas son (la lista en el `title`) y sólo marca `×N` cuando de verdad se repite la misma.
- **Las filas del menú dicen a qué lote pertenece cada propuesta** y con cuántas más va.
- La reparación **hereda el lote** de la skill viva: reparar un miembro no parte el lote.
- Un `catch` de `propuestasDelLote` que devolvía `[]` a cualquier error se estrecha a `ENOENT`: un fallo de
  programación no puede disfrazarse de «lote vacío» y dejar que la promoción siga creyendo que está completo.
- El comentario de `presentation.mjs` decía que los contadores de sesión **no** se reinician y el código los
  reiniciaba: manda el código, y el comentario ya lo dice.

### Añadido

- **`group` en `skill_propose`** (`id`, `motivo` obligatorio de ≥20 caracteres, `esperadas` opcional): declara
  que varias propuestas van juntas. Las hermanas de un lote **no se vetan** —el parecido se avisa, con la
  hermana y su puntuación— y sin lote el mismo parecido se veta igual que antes.
- **Un lote no se activa a medias**: la promoción automática exige `esperadas` declarado, todas las propuestas
  presentes y cada una pasando su regresión. Sin `esperadas` espera y lo dice. La **vía humana no la bloquea**:
  aprobar dos de tres es una decisión.
- **`--grupo` en la CLI**: `check --grupo`, `approve --grupo` (comprueba todas las puertas y sólo entonces
  aprueba; si una falla, no aprueba ninguna) y `history --grupo`.
- **`siblings` y `group` en el resultado** de la herramienta, y el diario anota el lote en todas sus entradas.
- **Aviso `tag-no-cánico`**: una etiqueta con acentos o mayúsculas se tolera y se avisa con su forma canónica.
- `tests/aprendizaje-en-lote.test.mjs`: **23 pruebas** — los once pares etiquetados del veto, el corpus con
  margen, el lote por la herramienta real (incluido `esperadas`, que el esquema tiene que declarar), el guardián
  de la promoción, la píldora por el flujo de eventos, la CLI y las filas del menú.

### El aviso del turno: qué dice y cuánto dura

- **La píldora cuenta por tipo, no por el último resultado.** Antes el estado guardaba un `outcome` único (el
  último resultado pisaba al anterior), así que un turno que creaba una skill y rechazaba otra decía «No se creó
  ninguna skill» — con la creación en el dato —, y «crea, actualiza, crea» se resumía como «×3» mezclando dos
  cosas distintas. Ahora hay un contador por tipo (`created`, `updated`, `rejected`, `blocked`) y la frase se
  compone: «1 nueva · 1 actualizada», «2 nuevas · 1 actualizada», «1 nueva · 1 rechazada». La frase de un solo
  resultado con una sola skill **no cambia**.
- **El id suelto sólo se pinta cuando el turno hizo una cosa con una skill**; con varias, la etiqueta son las
  cuentas y los nombres completos van al `title`. Se acaba el `×N` que mezclaba tipos.
- **El aviso se retira.** No había ningún temporizador: la píldora permanecía indefinidamente. Ahora
  **8 s** si es informativo — el doble del peor tiempo de lectura medido, 73 caracteres ≈ 3,9 s a 200 ppm — y
  **30 s** si pide atención (un rechazo, un origen bloqueado, que pueden exigir una decisión); **no** se retira
  mientras el foco o el puntero están encima (WCAG 2.2.1), y la retirada es sin transición (una animación más
  no informa de nada). El temporizador vive en el **cliente**: la proyección sigue siendo un plegado puro, sin
  reloj, reproducible al releer un punto de control. Retirarse no borra nada: el resultado queda en el chat y
  el `title` lleva la frase completa.
- `tests/aviso-del-turno.test.mjs`: **12 pruebas** — los cuatro casos medidos (creación + actualización, tres
  resultados mezclados, creación + rechazo, bloqueo), la frase simple que no cambia, y el contrato del tiempo
  (los dos números, la pausa por foco, el reloj fuera del plegado).
- La vista gana `rejected` y `blocked`; `STATE_VERSION` sube a 4 (el estado ganó dos campos).

## [2.0.0] — 2026-10-15

**Una skill nace optimizada, se corrige con evidencia y se puede auditar.** Pedido así: *«asegurarme que
desde que se propone una skill esta sea realmente optimizada, ya que estas deben ser fáciles de comprender y
no sobrecargar de contexto y tampoco perderlo, ya que el conocimiento tiene un costo y se paga por él»*, y
además *«el aprendizaje/update patches sea automático pero con buenos criterios, ya que en cierto momento el
modelo declara cosas que después admite que se equivocó, entonces debería poder corregirse y a la skill sin
problemas»*.

Es **`mayor`** por el criterio del repositorio, y por dos motivos a la vez: cambia el **contrato de una
herramienta** (`skill_propose`) y cambia el **formato del almacén** (aparecen `journal.jsonl`, `locks/` y el
bloque `repair` en `meta.json`).

**Nace bien: el contrato de una propuesta pide lo que hace útil a una skill.**

- **`whenToUse` pasa a ser obligatorio.** Es el campo con el que el harness decide *cuándo* aparece la skill
  ante el modelo; sin él, una skill existe y no se elige nunca. Las skills anteriores a esta versión no lo
  tienen, y eso es exactamente lo que la auditoría reporta hoy en seis de ellas (§ *Diagnóstico*).
- **El disparador exige evidencia concreta**: un contrato, una trampa ya pagada, un orden operativo o un valor
  exacto. «Podría reutilizarse» deja de ser motivo.
- **La puerta mide forma, no sólo longitud**: descripción ≥60 (que distinga, no que exista), ≥2 secciones para
  que el procedimiento se lea por partes, y **presupuesto**: aviso a 8.000 caracteres y error a 24.000, porque
  el cuerpo entero se paga en cada invocación. Lo pesado viaja en `references/` y el cuerpo lo enlaza.
- **El vínculo se comprueba de verdad**: una referencia que el cuerpo declara y no está es un **error**, y el
  material aportado se guarda con su huella. Un enlace roto es conocimiento que se pierde.
- **El protocolo del agente quedó en ~940 caracteres** (tope 1.200), sin perder ni uno de sus criterios de
  decisión: el detalle que no cabe se va a `references/`, que es donde se lee cuando hace falta.

**Se corrige con evidencia: `revision` y la versión base.**

- Un parche de una skill **viva** exige una justificación estructurada: qué afirmaba la skill, **qué evidencia
  concreta** la contradice, **con qué se midió** (hace falta un número o un comando, una opinión no vale) y
  qué dice a partir de ahora. Quitar algo exige decirlo y demostrar que sigue conservado.
- La propuesta identifica la **versión sobre la que se construyó**, por su huella. Si esa versión se movió
  mientras la propuesta esperaba, la aprobación se **rechaza** y se pide reconciliar: aplicar un cambio sobre
  algo que ya no existe es aplicar un cambio que nadie ha revisado.
- El diff es exacto —líneas y material, con sus huellas— y **una referencia que cambia después de proponerse
  es un error de integridad**, no un detalle.

**El motor repara y promociona, con la política por niveles como comportamiento real y no como documento.**

- **`bin/skill-compiler.mjs repair <id>`** mira lo que la auditoría encontró y **prepara** la corrección:
  nivel 1 (forma canónica: saltos, espacios finales, salto final — deterministas, idempotentes y comprobados
  como inocuos), nivel 2 (mover el material pesado a `references/`, entero y con su vínculo) o nivel 3
  (criterio humano: descripciones, disparadores, secretos, permisos). **Lo que exigiría inventar conocimiento
  no se repara**: una referencia que nadie escribió se declara, con el motivo.
- **`promote <id> --nivel 1,2`** es lo único que activa, y **por defecto no activa nada**: la lista de niveles
  autorizados está vacía y el nivel 3 no se puede autorizar por ahí ni pidiéndolo.
- Antes de activar corren **nueve pruebas**: la puerta, la vigencia de la base, la conservación del inventario
  del conocimiento, el alcance real de lo escrito, el tamaño del diff, que **no se pierda ni un fichero**, la
  reversibilidad, los ciclos sin progreso y la preservación del material retirado. Cada una puede parar la
  promoción, y todas quedan en el registro.
- **Un cerrojo por skill** impide que dos procesos actúen a la vez, y si está tomado lo dice con su dueño y su
  fecha en vez de esperar en silencio.
- **Verificación después de escribir**: la versión publicada se relee y se compara **por huella** con lo
  propuesto. Si no cuadra, se **deshace**: la versión que no cuadró se aparta —nunca se borra— y la anterior
  vuelve a su sitio **con su misma huella**, comprobada.
- **La decisión queda registrada** (`journal.jsonl`): nivel, reglas, base, diff, pruebas y resultado. Y
  `history` lo muestra. Un integrador puede añadir sus propias comprobaciones, pero **sólo pueden añadir
  problemas**: nada externo puede autorizar lo que el motor no autorizó. Tampoco el texto de una skill: sus
  instrucciones no cambian la política, y hay una prueba que lo demuestra con una skill que se declara
  autorizada a promocionarse sola.

**Y se puede auditar: `audit`, de solo lectura.**

- Recorre el almacén entero —todos los proyectos, todos sus estados y la biblioteca global— con **la misma
  puerta** que decide una aprobación, y devuelve por skill, por hallazgo: la regla, el valor observado, el
  umbral, la severidad y la corrección recomendada, con identificadores estables (`estado/proyecto/id`).
- **No escribe nada** (la prueba compara la huella del árbol entero antes y después), **es reproducible** (dos
  ejecuciones dan el mismo informe byte a byte: el orden lo pone la clave, no el disco, y no viaja ninguna
  fecha) y **no se cae**: una carpeta denegada o un `SKILL.md` ilegible son un hallazgo de esa skill, y un
  vínculo dentro de una carpeta que no se pudo leer se declara **no comprobable** en vez de «falta el
  fichero» —que sería afirmar algo que no se ha medido—.

**Lo medido**, porque ninguna de estas piezas se declara por existir:

- **395 pruebas en verde** (eran 276), la suite **hermética** con la huella del almacén idéntica antes y
  después, y `doctor` en verde.
- El **nivel 1 promociona** con la anterior apartada y su huella comprobada; el **nivel 2 mueve 25.000
  caracteres de material a `references/`** sin perder una línea del inventario; la **reversión** devuelve la
  versión anterior con su huella exacta cuando una comprobación posterior falla; el **cerrojo** rechaza la
  segunda operación; el **ciclo** se para a la cuarta vuelta idéntica.
- Las herramientas del modelo se ejecutan **de verdad** en las pruebas (con el `defineTool` del harness, no
  con un doble), y una propuesta inválida no deja **ni una carpeta**.
- **El almacén real no se ha tocado en ningún momento**: 26 skills auditadas, 8 conformes, 7 con avisos, 11 con
  error. El diagnóstico de esas 11 —causa raíz, y las dos con vínculos rotos una a una— está en
  [`skill-compiler/docs/DIAGNOSTICO-2026-10-15.md`](skill-compiler/docs/DIAGNOSTICO-2026-10-15.md). **Ninguna
  se ha reparado**: reparar en masa lo que no pasa la puerta confundiría conformidad estructural con
  comportamiento correcto, y reescribir descripciones y disparadores de skills que hoy se usan cambia cuándo
  aparecen y qué se elige.


## [1.8.0] — 2026-10-15

**El ámbito de una skill: local o global, y lo elige el humano.** Pedido así: *«necesita tener dos opciones al
momento de seleccionar una skill propuesta y preguntar antes de aprobar si desea que sea local o global»*.

- **«Global» es lo que el harness lee como global**, medido en su código: resuelve cuatro raíces de skills y
  una es la **biblioteca de usuario** (`$DSH_HOME/skills`), con rango 400. Publicar ahí no es inventar una
  carpeta nueva: es dejar la skill donde el harness ya mira en cualquier sesión. El provider del plugin **no**
  cambia —sigue sirviendo sólo el proyecto— y por eso no hay dos copias del mismo conocimiento.
- **Se elige, y si no se dice, se pregunta.** `/skill-aprobar <id>` sin ámbito responde con las dos opciones y
  el nombre de su fila; `--global` publica para todos los proyectos y `--local` en este. Las **filas del menú**
  son la misma elección con el ratón: `skill-aprobar-<id>` y `skill-globalizar-<id>`.
- **El defecto de la suite que era un hueco de verdad**: el veto de solapamiento trataba la biblioteca curada
  como territorio de nadie, así que el **mismo id** de una skill que ya habíamos publicado era un conflicto —
  publicada una vez, el modelo no podía mejorarla en ningún proyecto. Lo que decide no es *dónde* está la otra,
  sino **de quién es**: lo nuestro se actualiza (y se anuncia con `updatesPublished`); lo ajeno se veta, y al
  modelo se le dice que la vía es otro id. Y el campo nuevo va declarado también en `skill_vendor`: sin eso,
  `additionalProperties: false` rechaza el resultado entero (el mismo defecto que ya pasó con `updatesProposal`).
- **En aprobación automática, local.** Un gesto delegado no debe publicar a todos tus proyectos: el modo auto
  delega la confirmación, no la puerta **ni el alcance**.
- **La decisión tiene vuelta**: `/skill-ambito <id> --global|--local` mueve una ya aprobada en las dos
  direcciones, con aviso al catálogo y gesto inverso.
- **La biblioteca es compartida** (hoy tiene 21 skills que escribe Hermes), así que hay **puerta de identidad**:
  sólo se escribe si el destino no existe o si es nuestro (`metadata.dsh.origin: skill-compiler`). Una skill
  ajena con el mismo id **no se pisa**, y se dice.
- **El ciclo de vida entero vale para una global**: apagar (sale de la biblioteca a nuestro almacén),
  encender, retirar con respaldo fechado y huella, y restaurar con la huella comprobada. La constancia de que
  salió del proyecto queda en `published/`, y el provider no la sirve: una sola copia efectiva.
- **Toda publicación verifica la huella**: si la copia no coincide con el original, no se retira nada.

Medido en una **arena** (con `DSH_HOME` aparte, nunca la biblioteca real): proponer → publicar → apagar →
encender → traer a local → retirar → restaurar, con la huella idéntica al volver. La arena cazó dos defectos
propios (un `rename` sin crear el padre, y la constancia de publicación pisándose entre ámbitos) y uno más en
la idempotencia: `locate` devuelve `published`, y sin reconocerlo una segunda aprobación decía «no existe».

## [1.7.2] — 2026-10-14

**El adorno mudo, y la lista que no se veía.** Defectos medidos en vivo, con la sesión del autor delante.

- **La píldora nunca se animaba** (`resultText`). El marcador que el plugin escribe en el resultado
  (`[skill-compiler] created <id>`) no se leía, así que la proyección contaba **todos** los resultados como
  «ninguno»: sin engranaje, sin aviso de propuesta nueva y los contadores siempre a cero. La causa era una
  llave: el `else` colgaba del `if` **interno** del bucle, así que un bloque **plano** —`{type:'text', text}`,
  que es justo la forma que usa el harness— no se leía **nunca**. Ahora se recorre la forma entera (plana,
  anidada y varios bloques) con una función recursiva y no eligiendo una rama.
  **Y por qué la suite no lo cazó**: la prueba construía el resultado con la forma **anidada**, que el harness
  no produce. El helper usa ya la forma **real** medida y hay una prueba que exige las dos.
  Esto explica también lo reportado antes —«nunca ha sugerido ni actualizado una skill»—: las propuestas
  llegaban, pero el adorno no las contaba.
- **El resultado que no se veía** (la tarjeta). El cuerpo del bloque se plegaba cuando el bloque quedaba
  marcado como anterior a una decisión: se pedía la lista de pendientes y se veía «nada». Marcar que una lista
  quedó atrás es correcto —y se sigue avisando—, pero **no puede esconder el registro**: el texto de un
  resultado es lo que pasó.
- **El panel afirmaba «nada pendiente» cuando no encontraba filas**. El comando arma sus filas al correr
  (`onListed`) y el host puede tardar un instante en anunciarlas, así que el panel leía «nada» justo cuando
  acababa de llegar algo. Ahora reintenta una vez y, si sigue sin verlas, lo **dice** con el camino
  alternativo (el texto del resultado y el menú «/») en vez de afirmar que no hay nada.

276 pruebas en verde · suite hermética con huella idéntica · `doctor` verde.

## [1.7.1] — 2026-10-14 — **primera versión estable**

Esta versión queda declarada como la **primera estable** del repositorio, con criterios y con compromiso (ver
la sección de estado en el README): 255 pruebas en verde, suite hermética, contratos comprobados contra los
paquetes reales del harness, `doctor` verde y el ciclo completo probado en vivo. Lo que sigue abierto son
decisiones y límites declarados, no defectos.

Y dos correcciones de la documentación, con su puerta:

- **La ruta local de nadie, en ninguna parte**: la documentación escribía la ruta de la máquina donde se
  clonó el repositorio. La instalación se explica por la **URL del repositorio** y los ejemplos usan
  `<donde-clonaste-el-repo>`. En el **código** la ruta del CLI se **deriva** del propio fichero
  (`fileURLToPath`) en vez de escribirse: una ruta escrita caduca en cuanto el repositorio se mueve, y encima
  el plugin la enseña al humano como si fuera la buena.
- **La puerta**: `tests/repo-hygiene.test.mjs` — estricta en código (ninguna ruta absoluta) y precisa en
  documentación (prohíbe lo que identifica a una máquina o a una persona, porque hay ejemplos legítimos con
  marcador, como la tabla que documenta que esas rutas se rechazan). Demostrada en rojo.
- Excepciones **declaradas**, no agujeros: `plans/*.md` son artefactos autorizados por su SHA-256 y no se
  reescriben; los `cwd` de ejemplo de `tests/` son datos de la prueba.

## [1.7.1] — 2026-10-14

**Apagar una skill la apagaba, y el agente seguía viéndola.** Reportado por el autor tras probarlo en vivo:
deshabilitó `saas-corporative-gate-workflow`, el disco quedó correcto, pero en el menú seguía ofreciéndose.
Su lectura fue exacta —«debería mostrarme que está deshabilitado y darme un botón para activarla»— y su
generalización también: lo mismo vale para cualquier acción de gestión.

### Corregido

- **La causa, medida**: `skill-deshabilitar`, `skill-habilitar` y `skill-eliminar` movían la skill **sin
  avisar al catálogo**, mientras que aprobar y rechazar sí avisaban. El registro de skills cachea por sesión
  y **sin TTL**, así que el catálogo seguía sirviendo la versión anterior. Los datos estaban bien
  (`listForProject` sólo lee `approved/`, y el provider no servía la apagada): lo que fallaba era el aviso.
- **Un solo camino para el aviso**: las cinco acciones de mutación pasan por un envoltorio que notifica al
  catálogo cuando —y sólo cuando— la acción movió algo. Una acción futura no puede olvidarse de avisar sin
  que la suite lo diga.
- **El estado, a la vista**: `/skill-propuestas` lista también las **apagadas**, con cómo devolver cada una
  y cómo retirarla del todo. Antes, la única prueba de haber apagado algo era el resultado de aquel comando.

### Medido

- 251 pruebas (antes 243). Las ocho nuevas no enumeran comandos: exigen la **correspondencia** entre el aviso
  y lo que cambió en disco, así que un comando nuevo que mueva algo y no avise falla ahí.
- **Rojo demostrado con los handlers anteriores**: aprobar y rechazar avisaban; deshabilitar, habilitar y
  retirar **no**.
- Límite declarado, y no disimulado: la lista de *skills* del menú `/` la pinta el anfitrión con su propia
  caché de sesión y un plugin no puede invalidarla. Desaparece al instante del catálogo del agente; del menú
  del compositor, al reconectar la sesión.

### Y queda como contrato

La idea del autor, generalizada a regla del repositorio (reglas de oro 16 y de gobierno 6): **toda acción que
cambia un estado (1) avisa a quien sirve el dato, (2) lo refleja donde el humano mira y (3) ofrece el gesto
inverso en el mismo mensaje** — y no avisa si no movió nada.

## [1.7.0] — 2026-10-13

**El ciclo de vida completo: apagar y retirar.** Preguntado por el autor: *«¿qué pasa si ya no quiero una
skill, puedo eliminarla de mi proyecto?»*. Hasta aquí la respuesta era que no: sobre una aprobada el único
gesto era pedir una actualización. Ahora hay dos, y son distintos a propósito.

### Añadido

- **Apagar** (`disable` / `/skill-deshabilitar <id>`): estado nuevo `disabled/`. Deja de servirse al modelo,
  sale de las activas y **se conserva entera**; `enable` la devuelve. Reversible con un gesto.
- **Retirar** (`delete --yes` / `/skill-eliminar <id> --yes`): el único gesto irreversible, y por eso
  **no borra**: mueve la carpeta a `$DSH_HOME/backups/skills-eliminadas/<fecha>/<proyecto>/<id>/` con su
  huella, y dice cuál es la vuelta. Sin `--yes` no toca nada: enseña qué se movería y dónde.
- **Volver** (`restore <id>`): devuelve la skill del respaldo a `approved/`, negándose si ese id ya existe.
- **`retired` y `/skill-retiradas`**: qué está apagado y qué se retiró, con su fecha.
- **En lote, desde la tarjeta**: casillas y acciones por verbo —`Volver a encender las marcadas`,
  `Retirar las marcadas`— con el paso de confirmación. De paso se cerró un hueco: el verbo «rechazar» estaba
  declarado pero **sin botón**, así que rechazar en lote era inalcanzable.
- **Filas del menú para lo apagado** (`skill-habilitar-<id>`, `skill-eliminar-<id>`): son pocas por
  definición —lo que acabas de apagar—, así que no llenan el menú, y es donde se decide su vuelta.
- La huella de una skill **excluye `meta.json`** a propósito: ese fichero registra su ciclo de vida y cambia
  en cada decisión, así que incluirlo haría imposible comprobar que volvió lo mismo.

### Corregido

- `locate` no conocía `disabled`, así que apagar algo ya apagado no se reconocía como «ya estaba» y
  respondía con un error de movimiento en vez de con la verdad.
- El anti-solapamiento mira también lo apagado: sin eso, el modelo propondría como nueva una skill que el
  humano sólo apagó, y acabaríamos con dos versiones del mismo id.
- Aprobar con una versión **apagada** del mismo id la aparta en `superseded/`: no pueden quedar dos estados
  con el mismo id. Y se avisa (`updatesDisabled`) en vez de anunciarlo como «creada».

### Medido

- 243 pruebas (antes 236), hermética en verde, `doctor` en verde.
- **El ciclo completo, por el CLI real y en una arena**: proponer → aprobar → apagar → apagar otra vez
  (dice «ya estaba», exit 0) → `retired` → encender → `delete` sin `--yes` (avisa y no toca nada) →
  `delete --yes` (respaldo en disco, huella) → `restore` (vuelve) → `restore` otra vez (se niega).
- La prueba de idempotencia y la de que el respaldo es idéntico encontraron dos defectos propios por el
  camino (el `locate` y la huella con `meta.json`), que es exactamente para lo que están.

## [1.6.1] — 2026-10-13

**La X también en los resultados de una fila del menú.** Reportado por el autor: al elegir del menú una fila
(`skill-aprobar-<id>`), el resultado lo pintaba la tarjeta del anfitrión, **sin X**, y el bloque quedaba fijo
en la conversación. La causa: el slot keyed se registraba sólo para los cinco nombres fijos, y el de una fila
lleva el id dentro — no se puede enumerar de antemano.

### Corregido

- El cliente **aprende** los nombres de los comandos del plugin del catálogo del host —`commands.list`, la
  misma fuente estructurada que alimenta el panel— en cuanto tiene un `sessionId`, y registra el slot de cada
  uno. Los cinco nombres fijos se siguen fijando de arranque.
- Las retiradas de esos slots se guardan y se ejecutan al descargar el plugin, para no dejar un slot vivo
  apuntando a una pieza que ya no está.
- Tres pruebas anclaban la forma anterior (`key: command` en el bucle fijo); las anclas nuevas fijan el
  camino corregido.

### Medido

- 236 pruebas (antes 235). La nueva se demuestra **roja** contra el código anterior en las dos aserciones que
  importan: `ensureCard` no existía y no había filtro por prefijo.
- **Verificado en vivo por el autor**: en una sesión ya no aparecen las pendientes de otro proyecto (el
  arreglo de la v1.6.0, confirmado en su pantalla).
- Límite que se declara: una tarjeta **ya pintada** antes de que el cliente aprenda los nombres sigue siendo
  la del anfitrión, sin X. Las nuevas salen con su X.

### Anotado para el cierre

[`plans/PLAN-2026-10-13-gestion-de-skills.md`](plans/PLAN-2026-10-13-gestion-de-skills.md): deshabilitar
(reversible) y eliminar (con respaldo fechado y vuelta por `restore`), en lote y desde las cuatro
superficies. Hoy no existe ninguno de los dos.

## [1.6.0] — 2026-10-13

**Las filas de pendientes son de una sesión, no de todas.** Reportado por el autor: en una sesión de un
proyecto veía en el menú `/` las pendientes de otro —con su id y su proyecto en la descripción— y al
elegirlas la puerta las rechazaba con razón («está pendiente en duranspainting, no en esta sesión»). Una
oferta que no puede cumplirse es una mentira con forma de atajo.

### Corregido

- Las filas se registran **en el ámbito del agente de esa sesión**, bajo `agent.ctx`; antes se registraban
  en el global, donde las veían todas las sesiones. El agente llega por donde el plugin ya recibe cada
  sesión: **el provider recibe `{ cwd, agent }`** (medido contra el registro real, que además cachea por
  `(cwd, agente, revisión)`), así que el ámbito sale de la sesión que pide el catálogo y no de un rastro de
  ámbitos vistos. Se descartó el listener de `agent/created`: el contrato del harness lo emite con el
  *scope carrier* del agente, y que alcance al contexto raíz del plugin no está garantizado — una fila que
  no aparece no se distingue de una que no existe.
- El plugin **conserva las retiradas** de cada agente y las ejecuta al descargarse: el harness avisa de que
  descargar el plugin no libera por su cuenta lo registrado bajo `agent.ctx`.
- Decidir en una sesión ya no recompone las filas de las demás.
- Se retira el rastro de `cwd` conocidos en el provider: el ámbito sale del agente, y anotar ámbitos al
  servir el catálogo era justo lo que mezclaba proyectos.

### Medido

- 234 pruebas. La nueva fija la clase: dos agentes de proyectos distintos, cada uno con **sus** filas y
  ninguna del otro; el global sin filas; decidir en uno no toca al otro; y al descargar el plugin no queda
  ninguna colgando.
- Dos defectos de las propias pruebas, corregidos al verlas fallar: `scopeOf` se llamaba con el agente pelado
  en vez de con su `exec` (el montaje se caía en silencio) y el doble de `inject` no devolvía el disposer del
  hijo, con lo que una prueba no podía ver una fuga real de filas.

## [1.5.2] — 2026-10-13

**Actualizar una skill existente era posible y nadie lo sabía.** Reportado por el autor: «habiendo aprendido
cosas, nunca ha sugerido una skill nueva ni ha actualizado una ya creada». La capacidad estaba construida
—`checkOverlap` trata el mismo id del propio proyecto como actualización, y al aprobarla la versión anterior
se aparta en `superseded/`— con pruebas funcionales en verde; pero ni el protocolo ni la descripción de la
herramienta lo decían, y son lo único que el modelo lee. Una capacidad que nadie sabe que existe es una
capacidad que no existe.

### Corregido

- **Protocolo**: el criterio pasa de «tarea compleja, y solo entonces» a «si lo resuelto se reutilizará», y
  declara **tres** vías, no dos: conocimiento nuevo, **actualización de una skill del proyecto que esto
  supera o corrige** (`skill_propose` **con el mismo id**, y `skill_review` para ver qué hay antes) y
  vendorización de un repositorio ajeno. Se dice qué pasa con la versión anterior: queda apartada, nunca
  borrada.
- **Descripción de `skill_propose`**: declara que un id existente **actualiza** en vez de crear —la
  descripción es lo que el modelo lee para decidir si usa la herramienta— y se retira el «never for a simple
  query», que empujaba a no proponer nada de lo aprendido en tareas normales.
- El protocolo sigue **por debajo del límite que impone su propia prueba** (1175 < 1200 caracteres): entra
  en el prompt de cada sesión y se paga entero cada vez.
- La vía que se le indica al humano para aprobar es ahora la de la sesión (`/skill-aprobar <id>`, o su fila
  en el menú `/`), con el comando del terminal como alternativa; antes sólo se le daba esta última.
- Cuando una propuesta afina otra que ya estaba pendiente, el modelo lo ve dicho: «afina una propuesta que
  ya estaba pendiente: no crea una skill nueva».

### Medido

- 234 pruebas (antes 230). Las dos nuevas fijan el contrato de la guía y **se demuestran rojas** contra la
  versión anterior: el protocolo no decía «con el mismo id» y la descripción no decía «UPDATE it».
- El camino funcional ya estaba probado y sigue verde: proponer con el mismo id de una skill aprobada
  devuelve `updatesApproved`, y aprobarla deja la anterior en `superseded/`.

## [1.5.1] — 2026-10-13

**La frescura, también para la biblioteca curada.** El plugin observaba su propio almacén, pero no la capa
global de skills del harness — que compone **el mismo** catálogo que ve el agente. Mover, editar o retirar
algo de ahí dejaba a las sesiones abiertas con el catálogo anterior: la misma clase de defecto que la v1.3.0
cerró para el almacén propio, en la otra capa.

### Corregido

- `createCatalogSignal` acepta raíces `also` (ajenas) y las observa **además** del almacén propio. Un aviso
  por cualquiera de ellas invalida el catálogo del registro, que es lo que fuerza el re-snapshot completo.
- Las raíces ajenas se observan **sólo si ya existen**: vigilar nunca crea un directorio que no es nuestro.
  El almacén propio se sigue creando si falta, que es lo que hace que la primera aprobación por CLI no pase
  inadvertida.
- Una raíz que no se puede vigilar no impide vigilar las demás: la señal es tolerante por raíz.

### Medido

- `start()` dice si abrió alguna vigilancia; `roots()` dice cuáles (diagnóstico y pruebas).
- 230 pruebas (antes 228). Las dos nuevas prueban que la capa ajena se vigila en cuanto existe, que **no** se
  crea si no existe, que el almacén propio no se duplica en la lista, y que un aviso por la capa ajena
  invalida el catálogo y avisa a los suscriptores.
- **No es un rojo reproducido en vivo, y se dice**: el defecto se deduce del contrato del registro (el
  catálogo lo compone él, con todas las raíces) y su efecto —«la sesión abierta ve lo de antes»— no se puede
  reproducir sin una sesión del harness en marcha. Lo que sí está medido es el montaje completo, con el
  registro real y el provider real: registro real, aviso entregado.

### De dónde sale

De la auditoría de cruces entre repositorios (2026-10-13). Al devolver cinco skills de proyecto a su ámbito,
quedó al descubierto que retirarlas de la capa global no habría avisado a las sesiones abiertas.

## [1.5.0] — 2026-10-13

**Decidir en lote, dentro del bloque que lo pide.** Con más de una pendiente, aprobar era de a una: se
marcan varias, se lee el resumen de lo que se va a hacer y se confirman. Y el cierre de un bloque ahora
sobrevive al reinicio, que era el otro defecto reportado.

### Corregido — lo cerrado volvía a aparecer al reabrir la aplicación

- El cierre vivía en `sessionStorage`, que dura lo que dura la pestaña: cerró cuatro bloques, reinició y
  estaban otra vez. Pasa a `localStorage`, que aquí es fiable porque **el cliente de escritorio se sirve
  desde un origen estable** (`dsh-app://app`, medido en el contrato del shell) y no desde un puerto
  efímero: la clave del almacén no cambia de un arranque al siguiente.

### Añadido — el panel de decisiones en la tarjeta

- **Una casilla por pendiente** y una barra de acciones: `Aprobar las marcadas (N)` / `Apartar las marcadas
  (N)`, más `marcar todas` / `desmarcar`. Con cero marcadas no hay acción que pulsar.
- **Paso a paso de verdad**: marcar → **confirmación con el resumen** (los ids y qué se va a hacer) →
  ejecutar. Un clic no decide nada, y la confirmación dice que cada una pasa por la misma puerta que el
  comando y que queda registrado.
- **Las pendientes se leen del catálogo del host**, no se adivinan del texto del resultado: cada pendiente
  ya tiene su fila `skill-aprobar-<id>`, que es la misma fuente que alimenta el menú `/`. Se leen por
  `commands.list` y se ejecutan por `commands.execute` con el `sessionId` que entrega el kit de sesión.
- **Ejecutar es ejecutar el comando**, por el mismo remoto que usa el menú al elegir una fila: el host
  aplica la puerta, lo registra con `command/run`/`command/done` y el nodo aparece en el flujo de todas las
  pestañas. No hay atajo, y el modelo no alcanza esta superficie: aprobar sigue siendo un acto humano.
- Tras el lote: `N aprobadas · M con fallo`, el motivo de cada fallo, y `Pendientes ahora: M` — la lista de
  la propia tarjeta se mueve con lo que se ejecutó.
- En la tarjeta de `/skill-ver` (y de la fila `skill-ver-<id>`), el mismo panel ofrece `Aprobar esta` /
  `Apartar esta` sobre la propuesta que acabas de leer.
- Si el anfitrión no expusiera el remoto a un plugin de cliente, el panel lo dice **con el motivo** en vez
  de desaparecer en silencio.

### Medido

- 228 pruebas (antes 223), suite hermética en verde y `doctor` verde.
- `commands.list` devuelve un array de descriptores (nombre + descripción), ordenado por nombre: es el
  contrato del que el panel saca las pendientes.
- **Por verificar en vivo**: que este anfitrión exponga `commands.execute` a un plugin de cliente. El
  cliente de comandos lo usa (`dsh-client-ui-commands` → `ctx.remote.commands.execute`), pero que sea
  alcanzable desde un tercero se comprueba en la primera ejecución del panel: si no lo fuera, lo dirá.

## [1.4.1] — 2026-10-13

**Aprobar dos veces no es un fallo, y una lista no puede quedarse mintiendo.** Los dos defectos salieron de
usar el flujo: aprobó una skill con el bloque de `/skill-propuestas` delante, lo vio seguir ahí, volvió a
intentarlo y leyó `failed`.

### Corregido — el segundo intento decía «failed» donde había un acto ya hecho

- Aprobar algo que **ya está aprobado** responde `Ya estaba activa: <id>` y no mueve nada, en vez de
  «no existe una propuesta» (que el cliente pintaba como un fallo). Igual al revés: apartar algo ya
  apartado dice `Ya estaba apartada`.
- Y cuando lo que se intenta no encaja con el estado real, se dice cuál es: aprobar algo en `rejected/`, o
  apartar algo activo, explican qué pasa y por qué esa vía no se aplica.
- La misma corrección en las **dos superficies humanas**: los comandos del harness y el CLI. Una regla, una
  implementación: `locate(id, key, { root })` dice dónde está una skill ahora, y las dos la consultan.

### Añadido — el resultado de decidir trae la lista al día

- Aprobar o apartar termina con `Pendientes de tu aprobación (N)` y la lista (o «ninguna»). Así el humano ve
  el efecto de lo que acaba de hacer sin volver a ejecutar `/skill-propuestas` — que era exactamente lo que
  faltaba cuando el bloque de arriba seguía enseñando lo de antes.

### Añadido — una lista anterior a una decisión se marca, y no engaña

- El texto de un resultado es el registro de lo que pasó: no se reescribe. Lo que sí se puede saber —y es lo
  que la interfaz necesita— es que **hubo una decisión posterior**. La proyección pliega ahora `command/run`
  y `command/done` (emparejados por `commandId`, que es lo único que llevan en común) y expone
  `decisionKind` + `decisionSeq`.
- La tarjeta de `/skill-propuestas` y `/skill-ver` compara ese `seq` con el de su propio bloque: si la
  decisión es posterior, muestra una banda («Aprobaste algo después de esta lista…») y se **pliega sola**
  —sigue ahí, desplegable, pero no ocupa media pantalla describiendo un estado que ya no es—.
- `STATE_VERSION` sube a **2**. Los puntos de control de la versión anterior se descartan, y eso no pierde
  nada visible: el estado se recalcula de los eventos del log, así que la marca aparece también en las
  sesiones ya existentes.

### Medido

- **«Usable sin reiniciar», de punta a punta en el log real**: la aprobación quedó en `seq 8675` y el
  catálogo que recibió el agente en su paso siguiente, `seq 8688`, ya incluía la skill (34 skills antes,
  35 después). Es la promesa de la 1.3.0 medida por primera vez en vivo, no solo contra el registro real.
- 223 pruebas (antes 217), suite hermética en verde y `doctor` verde.
- El caso completo, reproducido contra el CLI real en una arena: la segunda aprobación responde «Ya estaba
  activa» con exit 0 y el estado no se mueve; `reject` sobre algo activo explica que esa vía no se aplica.

## [1.4.0] — 2026-10-13

**Decidir es elegir, no recordar sintaxis.** Medido con el usuario delante: `/skill-propuestas` enseñaba la
lista de pendientes y su respuesta fue *«no veo cómo seleccionar y aprobar la skill»*. El texto pedía teclear
`/skill-aprobar <id>`, y el compositor no ofrece ninguna lista pulsable para los argumentos de un comando del
host: el flujo de autorización existía, pero su superficie era una nota al pie.

### Añadido — el menú `/` como superficie de selección

- **Una fila por pendiente y verbo** (`lib/pending-rows.mjs`): leer entera, activar, apartar sin borrar. El
  nombre lleva el id (`skill-aprobar-<id>`) y la descripción el proyecto, así que la fila se lee sola.
- **Sin argumentos a propósito**: el contrato del harness ejecuta en el acto un comando del host «a secas»
  al elegirlo en el menú (`host bare → detached execute`), así que **elegir la fila es la decisión completa**.
  Y como sigue siendo un comando, también se puede teclear entero: dos formas, una implementación.
- Las filas se anuncian **cuando el harness pide el catálogo de la sesión** (el proveedor recibe el `cwd`) y
  se recomponen cuando cambia el almacén: aprobación desde aquí, CLI en otra terminal, edición a mano. Si el
  conjunto no cambió, no se re-registra nada — el menú no parpadea.
- El ámbito se comprueba **al ejecutar**, no al anunciar: una fila de otro proyecto falla diciendo de cuál
  es, en vez de aprobar en el proyecto equivocado.

### Añadido — leer antes de decidir

- `/skill-ver` (y la fila de leer) enseña el **veredicto de la puerta**: los fallos que impiden aprobar y los
  avisos que exigirán `--force`. Antes eso sólo se descubría al intentar aprobar.

### Añadido — un resultado se puede cerrar

- **La tarjeta del resultado, con una X en la esquina derecha.** Medido con el usuario delante: los bloques
  de `/skill-propuestas` y `/skill-ver` se podían colapsar, no cerrar, y se apilaban. Se registra una
  entrada **keyed** en `conversation.chat.commandview` —el slot que el nodo `command` del chat declara por
  nombre de comando—, que es la forma soportada por el contrato del cliente: sin reclamar el nodo entero
  (una clave tiene un solo ocupante) y sin tocar el DOM de nadie.
- El cierre es por **`commandId`** —dos ejecuciones del mismo comando se cierran por separado— y se
  recuerda en la sesión de la pestaña: es una preferencia de vista, no un dato, y no toca el log ni el
  almacén.
- La tarjeta es accesible: botón de verdad con `aria-label` y `title`, visible al puntero y al foco, con el
  foco dibujado; el resultado se pinta como texto, nunca como HTML.
- `@deepseek-ai/dsh-client-ui-chat` se declara en `dsh.client.inject`: es el paquete que declara el slot.

### Cambiado

- Las tres acciones (`viewProposal`, `approveProposal`, `rejectProposal`) viven en `lib/commands.mjs` y las
  usan las dos superficies: el comando con argumentos y la fila del menú. La puerta sigue siendo la misma, y
  una propuesta con avisos sigue exigiendo decirlo: la fila no aprueba nada con avisos.
- `/skill-propuestas` lista, bajo cada pendiente, los comandos exactos que la deciden.
- `lib/catalog-signal.mjs` gana `onChange`: hay cosas que dependen del almacén y no de la invalidación del
  catálogo (las filas), y el aviso tiene que llegarles igual, aunque no haya invalidación a la que avisar.
- `doctor`: 14 comprobaciones — añade la composición real de las filas del proyecto y ejecuta la puerta nueva.

### Medido

- 217 pruebas (antes 196), con la suite hermética en verde: las 8 del artefacto de interfaz cubren la
  tarjeta —registro keyed, accesibilidad de la X, memoria del cierre, texto y no HTML, y que su fallo no
  puede llevarse el registro de la píldora—, y `doctor` sigue verde con 14 comprobaciones.
- El registro de comandos devuelve el disposer exacto de cada alta y emite `commands/change` al registrar y
  al retirar: comprobado en el código que se envía y cubierto en `tests/activation.test.mjs` con un registro
  en miniatura que honra el disposer (las filas aparecen al pedir el catálogo, se retiran al aprobar, y se
  retiran al descargar el plugin).

## [1.3.0] — 2026-10-13

**Proponer, revisar, aprobar y usar: entero, dentro del harness y sin reiniciar.** Tres defectos
encadenados hacían que el último paso del flujo no existiera.

### Corregido — el campo que no estaba declarado y una respuesta que mentía

`skill_propose` devolvía `updatesProposal` en la rama `proposed`, y su esquema de salida no lo declaraba
(con `additionalProperties: false`). El validador del harness rechazaba **el resultado entero**:

```
"value.updatesProposal" is not a declared property (additionalProperties: false)
```

Y aquí está lo que hacía el daño peor: la herramienta escribe la propuesta en disco **antes** de devolver
el valor, así que el efecto sí ocurría y el modelo recibía un error — el usuario concluyó «no se ha creado
nada» cuando la propuesta estaba entera en el almacén. `skill_vendor` sí declaraba el campo: era un
esquema que se quedó atrás, no un error de concepto.

### Corregido — una skill aprobada no se podía usar hasta reiniciar

Registrábamos el proveedor de skills **ignorando la capacidad de invalidación que el registro entrega al
registrarse**. El registro de skills del harness cachea catálogos y **no tiene TTL**: sólo se limpia
cuando un provider llama a esa invalidación. Consecuencia: aprobar una skill no cambiaba nada hasta el
siguiente arranque, y el agente seguía viendo el catálogo viejo.

- El plugin **conserva esa capacidad** y avisa desde los dos sitios donde el catálogo puede cambiar: lo
  que muta su propio proceso (aprobar, rechazar) y lo que muta **fuera** (la CLI, la página de revisión,
  una edición a mano), que se detecta **vigilando el almacén** — el contrato del seam pide al provider su
  propio mecanismo de observación, y sin él «no hace falta reiniciar» sería cierto sólo para una vía.
- El agente recibe el catálogo de reemplazo en su **siguiente paso** y `/nombre` carga la skill en la
  misma sesión. Límite medido y declarado: el **menú desplegable** del compositor cachea por sesión y su
  invalidación no está en manos de un plugin; escribir el nombre funciona igual.

### Añadido — decidir desde el harness

- Cinco comandos humanos, que corren contra el agente **sin crear mensaje del modelo**:
  `/skill-propuestas`, `/skill-ver <id>`, `/skill-aprobar <id> [--force]`, `/skill-rechazar <id>` y
  `/skill-auto [activar|desactivar]`.
- Aprobar por comando aplica **la misma puerta** que la CLI (`checkProposal`, ahora en `lib/` porque una
  regla tiene que tener una sola implementación, y antes cualquier vía que no fuera la CLI era una vía sin
  puerta).
- **Modo de aprobación automática por sesión**: `/skill-auto activar` hace que las skills y los parches
  que se propongan en esa sesión se activen solos. El estado **se pliega del log de la sesión**
  (`command/run`), no de un flag en memoria: sobrevive a recargar el plugin o reiniciar la app, y deja
  rastro de quién lo activó. **No se delega la puerta**: con el modo activo, una propuesta que no pase la
  validación sigue pendiente, y un conflicto o un origen bloqueado no se aprueban.

### Añadido — puertas y diagnóstico

- `tests/output-contract.test.mjs` (23 pruebas): cada herramienta, **cada rama** de su `execute`, validada
  con `validateJsonSchemaValue` — el validador **del harness** — contra el esquema **compilado** por
  `defineTool`. Se demostró **roja** antes de arreglar: es la puerta que habría cazado el defecto.
- `tests/catalog-freshness.test.mjs` (4): contra el registro de skills **real**, y la primera prueba
  **demuestra el rojo** (sin aviso, el catálogo sigue cacheado).
- `tests/commands.test.mjs` (15) y `tests/auto-approve.test.mjs` (13): descriptor del harness, cinco
  caminos por comando, plegado del modo, y lo que no se delega.
- `doctor`: ejecuta las puertas reales en vez de reimplementarlas, y comprueba que los comandos se
  declaran. Total: **196 pruebas**.
- `@deepseek-ai/dsh-skill` entra como **dependencia de desarrollo**: es el registro real contra el que se
  mide la frescura.


## [1.2.0] — 2026-10-12

**La superficie de aprobación, sin depender del terminal.** Una página de revisión que el CLI sirve
**bajo demanda**: las propuestas pendientes con su resultado de validación y dos botones, aprobar y
rechazar.

### Añadido — revisión local

- `node bin/skill-compiler.mjs review [--port N]` sirve la página en `127.0.0.1` con un **token de un solo
  uso** que solo se imprime en la terminal. Sin él la página responde **403** y no revela ni que existe.
- La página enseña cada pendiente con su descripción, su `whenToUse`, el resultado de `check` (verde, o los
  avisos y errores concretos) y los botones de aprobar y rechazar. Aprobada la lista se actualiza.
- **La misma puerta que el terminal**: si una propuesta no pasa la validación **no hay botón de aprobar**, y
  si tiene avisos aprobar es un acto aparte («Aprobar con avisos»). La página no puede ser más permisiva
  que el comando.
- **El cliente nunca nombra una ruta**: las acciones solo aceptan un `id`, y ese `id` tiene que estar entre
  las pendientes de ese proyecto. Un `../../etc/passwd` responde 404 y no mueve nada.
- **Todo el texto dinámico se escapa**: una descripción la escribió un modelo, así que se pinta como texto.
- Sin dependencias nuevas (el `http` de Node), sin pipeline de compilación, y **nada en el camino crítico
  de las sesiones**.

### Documentado — por qué la bandeja no vive DENTRO de la aplicación

Se intentó diseñar y se descartó con el contrato delante: exponer un remoto exige `@Remote` (decoradores de
TypeScript procesados por el pipeline de `dsh-typert-protocol`), y este plugin escribe su artefacto de
navegador a mano, sin build. La proyección tampoco puede contar los pendientes —es un plegado puro de
eventos y no puede leer el almacén—, y si lo intentara mentiría en cuanto se aprobara algo por CLI, porque
la aprobación no emite ningún evento de sesión. Queda razonado en `docs/FEEDBACK-VISUAL.md`.

### Verificado

- **139 pruebas** (7 nuevas), y las de la página se hacen contra un **servidor real** en un puerto efímero,
  comprobando **el disco** —que la propuesta se movió de `proposed/` a `approved/`— y no solo la respuesta.
- Comprobado también a mano: la orden arranca, sin token responde 403, con token sirve la página y se cierra
  con el proceso.
- Aprobada `dsh-skill-library-authoring` por orden explícita del usuario; queda activa solo en el ámbito de
  `saas-corporative`.


## [1.1.2] — 2026-10-12

**El adorno visual dejaba el historial de sesiones sin cargar.** El harness respondía, al abrir el
historial de cualquier sesión:

```
Failed to load history: failed to project session "session-031083a5-…":
def.wire.viewSchema.parse is not a function
```

Es decir: no se podía abrir ninguna sesión. La causa no era el dibujo, sino **con qué esquemas se había
registrado la unidad de proyección**.

### Corregido — los esquemas del registro tienen que validar

- El plugin registraba su proyección con esquemas de **`@deepseek-ai/schemastery`**. Un esquema de
  schemastery **existe** y se resuelve llamándolo como función —`schema(valor)`—, pero **no tiene
  `parse`**. El contrato del registro de proyecciones es `ZodType`: la unidad declara `stateSchema` y
  `wire.viewSchema` y el harness los llama con `.parse(...)`.
- Lo que hizo el defecto silencioso y tardío: **`register()` no valida los esquemas que recibe.** Aceptó
  la unidad sin una queja, el plugin se activaba, las herramientas funcionaban y el fallo solo aparecía
  al **leer** una sesión —el camino que proyecta estado para el cliente—, donde ya no hay adorno que
  perder: se pierde el historial.
- Los esquemas son ahora **Zod**, y `zod` sustituye a `@deepseek-ai/schemastery` en `dependencies`
  (`^4.4.3`, el rango que declara el propio paquete del harness). Declarar la dependencia correcta no
  bastaba por sí solo; ver el punto siguiente.
- La unidad se muda de `index.js` a **`lib/projection.mjs`**, que sí se puede probar sin el harness: es
  la misma regla que gobierna el resto del plugin —lo que decide algo, en `lib/`—, y aquí decide los
  esquemas y el contrato de lectura.
- Se midió con el **registro real** y un punto de control real de la sesión que falló: antes,
  `restore(...)` lanzaba `def.wire.viewSchema.parse is not a function`; ahora proyecta.

### Añadido — la guarda que el registro no pone

- `projectionContractProblems()`: comprueba el contrato **antes** de registrar y, si la unidad no lo
  cumple, **no se registra**. Se pierde el adorno, nunca la lectura de sesiones. Comprueba que los
  esquemas validan con `parse`, que el estado inicial pasa su esquema, que un punto de control corrupto
  no lanza, que `apply` es síncrono y conserva la referencia para eventos ajenos, y que la vista es
  síncrona y valida incluso con un estado corrupto.
- El **estado** se repara (`.catch` por campo y una red final): viene del disco y `restore()` lo analiza
  sin red de seguridad, así que un dato raro se normaliza en vez de impedir abrir la sesión. La **vista**
  se exige estricta: la calcula el plugin, y un fallo ahí es un defecto que debe verse en las pruebas.

### Añadido — puertas y diagnóstico

- `tests/projection-contract.test.mjs` (8 pruebas), contra el **registro real** de proyecciones, no contra
  un doble: registra la unidad, proyecta una sesión, restaura desde un punto de control, prueba puntos de
  control corruptos y filas de otra versión, y comprueba que el guardián caza una unidad con esquemas que
  no validan. Es la puerta que habría cazado este defecto.
- `doctor` comprueba ahora **la proyección contra el registro real**: monta el registro, registra la unidad
  y proyecta (`snapshot` y lectura en frío). Antes solo compilaba las herramientas, y por eso decía `ok`
  con la proyección rota.
- `docs/DEPENDENCIAS.md` recoge la lección —«declarar no basta: el contrato»— y `docs/OPERACION.md` tiene
  una fila de diagnóstico para el síntoma exacto del historial sin cargar. Total: **132 pruebas**.


## [1.1.1] — 2026-10-12

**El plugin no se activaba al instalarlo.** Se instalaba bien —ficha, título, icono y versión correctos—
y al encenderlo el harness respondía `failed to import`. Detrás de ese error había dos defectos, y el
primero escondía al segundo.

### Corregido — la dependencia que nadie declaró

- El plugin importaba `@deepseek-ai/dsh-tools` **sin declararlo**. Funcionaba en la máquina donde se
  escribió y fallaba en cuanto se instalaba en un perfil: Node resuelve las importaciones desde la ruta
  real del módulo, y los paquetes del harness viven dentro del archivo de la aplicación. Los plugins que
  el harness trae dentro pueden importarlos porque son hermanos suyos ahí dentro; uno externo no.
- Se declaran ahora las **20 dependencias** del cierre completo, con versión exacta. No son tres: el
  propio `dsh-tools` importa en su primera línea paquetes que declara como *peers*, y el perfil de DSH
  trae `autoInstallPeers: false`, así que declarar solo las directas dejaría el plugin roto según qué
  gestor lo instalara. El cierre explícito funciona con cualquier gestor y cualquier política.
- `npm install` pasa a ser un paso **obligatorio y documentado** antes de instalar el bundle por ruta: al
  instalarse por ruta, el perfil enlaza la carpeta del repositorio, así que el plugin carga sus
  dependencias de ahí.
- Se evaluó y se descartó registrar la declaración sin `defineTool`: el registro acepta la declaración
  cruda, pero `defineTool` es quien convierte `parameters` en el esquema que ve el modelo. Habría
  funcionado con las herramientas **sin parámetros**. Queda escrito en `docs/DEPENDENCIAS.md`.

### Corregido — las herramientas que no se podían compilar

- Los esquemas de salida se construían solo al activarse el plugin, así que un esquema inválido se
  descubría instalando. Ahora `tests/harness-contracts.test.mjs` compila las cuatro definiciones con el
  **compilador real** del harness y comprueba los parámetros que el modelo verá, los obligatorios
  incluidos.

### Corregido — la activación que podía caerse sola

- El respaldo de la inyección **opcional** de la proyección podía terminar llamando a `register` sobre
  `undefined` y **lanzar dentro de `apply`**, lo que se lleva por delante la activación completa,
  herramientas incluidas. Ahora hay dos guardas: si el registro no está, se sale en silencio, y si
  rechaza la unidad, se captura. El adorno visual nunca puede costar el trabajo — que es lo que la
  documentación prometía y el código no cumplía.
- Lo encontró `tests/activation.test.mjs` en su primera ejecución.

### Añadido — puertas y diagnóstico

- `tests/harness-contracts.test.mjs` (5 pruebas): las herramientas compilan, el modelo ve los parámetros
  declarados, **toda importación de paquete está declarada como dependencia** —la regla que faltaba—, la
  familia `dsh-*` comparte una sola versión, y el cierre está instalado.
- `tests/activation.test.mjs` (4 pruebas): importa `index.js` y llama a `apply(ctx)` con un contexto
  doble, igual que hace el harness al activar el bundle, y comprueba que no lanza y que registra la
  sección, las cuatro herramientas y el proveedor. Total: **124 pruebas**.
- `node bin/skill-compiler.mjs doctor`: dice qué falta y con qué comando se arregla, y distingue «no está
  instalado» de «no se puede cargar», que son problemas distintos.
- `docs/DEPENDENCIAS.md`: el fallo contado entero, el experimento que lo aisló (enlace frente a copia),
  qué está declarado y por qué, y el procedimiento para subir versiones cuando el harness se actualice.


## [1.1.0] — 2026-10-12

Feedback visual: saber de un vistazo que el plugin está analizando, y si creó una skill **nueva** o
**actualizó** una existente.

### Añadido — interfaz

- `client.js`: artefacto de navegador que registra una píldora en `conversation.composer.dock` y lee el
  estado con `useProjection('skillCompiler')`. El `package.json` declara `dsh.client`
  (`platform: web`, `immediately: true`, `inject: ['@deepseek-ai/dsh-client-ui-conversation']`).
- **Engranaje multicolor** con degradado cónico girando despacio mientras el análisis está en marcha: la
  única animación continua, y solo porque es un indicador de carga.
- Al terminar, el resultado con su nombre: **nueva**, **actualizada**, sin cambios, no se creó, u origen
  bloqueado — y `×N` con el acumulado de la sesión cuando hubo varias.
- Iconos SVG en línea con `aria-hidden` (sin emoji), textos por el servicio de idioma con diccionarios
  `es`/`en` y reserva propia si el idioma no está, contenedor derivado de `currentColor` con `color-mix`
  (funciona en claro y en oscuro sin fijar tokens), y `prefers-reduced-motion` desactivando el movimiento.

### Añadido — estado

- `lib/presentation.mjs`: el contrato del marcador (`[skill-compiler] <resultado> <id>`) y el plegado
  `applyLearning`/`learningView` sobre eventos que **ya existen** (`tool/call`, `tool/result`, `turn/end`,
  `user/message`), sin añadir tipos de evento propios —prohibido por la guía, porque un evento
  desconocido sin marca `ignorable` impide reabrir la sesión—.
- Proyección `skillCompiler` (versión 1) registrada de forma **opcional y a prueba de fallos**: si el
  perfil no resuelve la biblioteca de esquemas, no se registra y el plugin conserva las herramientas.
- `skill_propose` y `skill_vendor` distinguen **crear** de **actualizar** (`updatesProposal`,
  `updatesApproved`), que es justo la diferencia que el usuario quiere ver.
- `tools/ico-to-png.mjs`: extrae sin recodificar la trama PNG de un `.ico` para usarla como icono (el
  harness acepta SVG, PNG, JPEG y WebP, y **no** `.ico`), avisando cuando el `.ico` es del formato
  antiguo de tramas BMP.

### Cambiado

- **Nomenclatura comercial: LifeCode Skill-Compiler** (familia de producto *LifeCode*). El nombre visible
  en la ficha del plugin es `LifeCode Skill-Compiler`; el identificador técnico sigue siendo
  `skill-compiler` —paquete, identidad del Loader, prefijo del marcador y carpeta del almacén—, porque
  renombrar algo que el arranque del perfil valida es un riesgo que no se corre antes de la primera
  instalación. Cuando la instalación esté verificada, el renombrado completo es un commit.
- El resultado de `skill_propose` y `skill_vendor` abre con la línea del marcador. Las dos herramientas de
  solo lectura (`skill_review`, `skill_upstream_check`) **no** lo llevan: no aprenden nada.
- El plegado dejó de atribuir un id a un resultado sin marcador: prefiere no decir de qué skill se trata
  antes que adivinarlo.

### Verificado

- 115 pruebas (32 nuevas), incluida la del contrato del marcador congelada contra el `render` real de las
  herramientas, y la del plegado: referencias estables, contadores, cierre de turno y retirada del
  resultado al prompt siguiente.
- Puerta de hermetismo en verde.
- Forma del artefacto de cliente comprobada: carga por `window.__ModuleLoader__`, `id` igual al paquete,
  slot existente, un solo `role="status"`, movimiento reducido presente, **cero emoji** y sin tocar
  `document.body`.
- `tests/client-artifact.test.mjs` (10 pruebas) convierte esa comprobación en puerta permanente, e incluye
  la regla de contraste que impide volver a pintar el texto con el acento. Se escribió **después** de que
  el propio artefacto incumpliera una de sus reglas: el acento `#b91c1c` del estado bloqueado se quedaba en
  2.93:1 sobre fondo oscuro, por debajo del 3:1 que se exige a un gráfico.

### No verificado, y se dice

- **El dibujo.** No hay control de navegador en este puesto: que la píldora se vea bien solo se comprueba
  instalando el plugin y mirándola. Lo verificado es que está construida según las reglas de diseño, no
  que el resultado guste.


## [1.0.0] — 2026-10-12

Primera versión funcional y probada de `skill-compiler`.

### Añadido — aprendizaje progresivo

- Protocolo estático en el prompt vía `ctx.systemPrompt.section()` (orden 9000, `interpolate: false`):
  entra una vez y no rompe el prompt caching.
- Herramienta `skill_propose`: convierte conocimiento propio en una skill **propuesta**.
- Herramienta `skill_review`: lectura de pendientes y aprobadas del proyecto actual. No aprueba nada.
- Proveedor de skills (`ctx.skills.registerProvider`) con rango 150: sirve **solo** las aprobadas del
  proyecto actual, de modo que una skill no se cargue en el lugar equivocado.
- Ámbito derivado del `cwd` de la sesión; el modelo no lo declara.

### Añadido — vendorizado

- Herramienta `skill_vendor`: crea **nuestra versión** de una skill publicada en un repositorio ajeno,
  guardando el original **verbatim** con su SHA-256 y una `provenance.json` auditable.
- Herramienta `skill_upstream_check`: informa de si el origen cambió, sin tocar nuestra versión.
- Resolución de enlaces: `.md` servido por https, `blob`/`tree` de GitHub, raíz de repositorio y API de
  contenidos. Solo `https`; solo markdown (hasta 10 `references/*.md`); techo de 512 KB y timeout de 15 s.
- `needs-choice` cuando el enlace apunta a una carpeta con varias skills: elige el humano, no la
  herramienta.
- Análisis del contenido ajeno con **bloqueo** (no aviso) ante credenciales, órdenes dirigidas al agente,
  tuberías a shell, escalada de privilegios y caracteres invisibles. Un bloqueo no escribe nada.
- Adaptación: frontmatter del contrato DSH, descripción acotada a lo que el modelo puede leer, título
  normalizado, referencias reescritas a `upstream/references/`, avisos de lo omitido y banner que declara
  que la copia local **no es la fuente autoritativa**.

### Añadido — operación y control

- CLI: `where`, `list`, `show`, `check`, `approve`, `reject`, `active`, `vendor`, `upstream`,
  `provenance`. **Aprobar es un acto humano**: no existe como herramienta del modelo.
- Puerta `check` antes de aprobar, y `--force` solo para avisos: nunca para un fallo.
- Idempotencia de la propuesta (reescritura atómica sin restos), supersesión de la versión anterior al
  aprobar una actualización, y rechazo sin borrado.
- Documentación: `docs/FUNCIONAMIENTO.md`, `docs/CONFIANZA.md`, `docs/OPERACION.md`,
  `docs/DESARROLLO.md`.

### Añadido — licencia

- **MIT** (Copyright (c) 2026 designerbyron): uso, modificación, redistribución y uso comercial libres,
  conservando el aviso de copyright. Texto estándar sin añadidos, para que GitHub y las herramientas de
  cumplimiento la reconozcan.
- La referencia al repositorio original queda como **petición destacada** en el README, declarada como
  tal: MIT no la exige, y ponerla en el `LICENSE` la habría sacado del estándar.

### Verificado

- 83 pruebas automáticas, todas en caja de arena, con `fetch` falso inyectado para el vendorizado.
- Puerta de hermetismo: huella del almacén real idéntica antes y después de la suite.
- Cadena completa contra la red real, 15/15: resolver → descargar → adaptar → proponer → aprobar →
  servir, con el original verbatim comprobado y el origen sin cambios.
- Propuesta real contra la biblioteca curada del puesto (25 skills): sin solapamiento.

### Añadido — identidad visual

- `skill-compiler/icon.png` (192×192, 56 KiB — muy por debajo del límite de 256 KiB que valida el
  manifiesto) declarado como `icon` de primer nivel en `package.json`, con ruta relativa al manifiesto.
- `assets/poster.png` en la raíz, mostrado en las portadas del repositorio y del plugin. Un solo
  fichero, dos referencias: los binarios no se duplican.
- El engranaje de la interfaz pasa a los **tonos de la marca** (cian → azul → violeta → magenta, tomados
  del póster). Se retira el ámbar que llevaba: no existe en la identidad.

### Corregido antes de la primera publicación

Ninguno de estos llegó a publicarse; se listan porque el historial de un defecto vale tanto como el
código que lo arregla.

- `bytes` contaba caracteres, no bytes UTF-8: un `’` multibyte hacía que la cuenta no cuadrara con el
  original guardado.
- Un `\b` mal colocado impedía detectar `exfiltrate the .env` en el análisis de contenido ajeno.
- La reescritura de referencias no reconocía las comillas invertidas, así que en la práctica no
  reescribía ninguna ruta de markdown.
- Las carpetas omitidas del origen (como `scripts/`) no se declaraban.
- Los avisos de una propuesta se calculaban y no llegaban al resumen (un aviso que no se lee no es un
  aviso), y la rama de conflicto devolvía la lista de colisiones vacía.
- Dos pruebas escribían en el almacén real por pasar `root: undefined`. Se cerró de raíz: `sandbox()`
  redirige `DSH_HOME` y `check-hermetic.mjs` lo **mide**.
- El mensaje de la CLI que indica cómo aprobar llevaba la ruta del repositorio incrustada, y se quedó
  obsoleta al mover el proyecto. Ahora el CLI **deriva su propia ruta** en tiempo de ejecución: una
  instrucción de aprobación que no funciona es peor que no darla.

### Pendiente

- **Instalación del bundle** en el perfil (no realizada todavía).
- **Primer `git push`**: el remoto está configurado, el envío no se ha ejecutado.
- Consolidación de las skills silenciadas de la biblioteca curada (fuera de este plugin).
