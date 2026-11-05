# MEMORY — estado vivo de la colección

Memoria durable del repositorio. No es el historial de una sesión: es lo que hay que saber al entrar.
Última actualización: 2026-11-04.

## Versión publicada

**v5.0.2** (2026-10-23, parche del panel: cero lecturas al listar, generacion en el store para que una lectura
vieja no pise la nueva, y la foto comun independiente del verbo de la tarjeta; + la guia de idiomas en la
documentacion) sobre **v5.0.1** (una sola foto de pendientes por sesion y ninguna propuesta ya decidida
ofreciendose otra vez) y **v5.0.0**, publicada ese mismo dia: tag anotado `v5.0.0` sobre el commit de cierre de
ese acto (`git rev-parse v5.0.0^{}`; la version y el CHANGELOG entran en `354e93a`) y release estable en
`designerbyron/plugins-dsh`. **902 pruebas en verde** en **224 suites** (889/220 al publicar la 5.0.0), suite
hermética en verde (huella del almacén real idéntica antes y después); i18n **938 claves por idioma** y 16
operaciones x 2 nombres; ASCII **8.289 medidos con tope 8.289** en **26/26** ficheros de primera parte. Cambio de
contrato de la 5.0.0: **un nombre de comando por operación en el idioma activo** y el modelo de alias, retirado.
El tag de la publicada es `v5.0.2` sobre `bbd5e38`, y `origin/main` apunta al mismo commit.

Antes, los 805/8.401/24 eran el estado de la rama `hardening/post-4.0.1` sola, y los 860/695/8.353 el del primer
candidato integrado.

### Historia de las versiones anteriores (registro, no estado de hoy)

**v4.0.1**, publicada el 2026-10-23: tag anotado `v4.0.1` sobre `8393977`, release estable en
`designerbyron/plugins-dsh`. Cierra el defecto que daba por bueno un almacén que no se podía leer (el
`ENOENT` de `projects/` es «todavía no hay», no «no pude leer»), y deja el contrato de verbos del panel
probado con cuatro arenas. **v4.0.0** (tag `v4.0.0`) fue la entrega del idioma ES/EN con el contrato del
modelo congelado, las puertas obligatorias y el contrato de resultado por elemento.

**v3.2.0**, en su día y sin commitear mientras se validaba: la propiedad con
**cuatro estados** (`ausente` · `declarada` · `invalida` · `ilegible`), el inventario que distingue
**inaccesible de inexistente** y declara el barrido incompleto, la identidad clasificada con procedencia
—la huella informa, no decide—, las rutas resueltas hasta el ancestro que existe, la escritura bajo el
**cerrojo compartido** (`lib/lock.mjs`), y `absolute-path` por contexto. **v3.1.0** en `origin/main`: la **propiedad del proceso de creación de skills** en el puesto (sólo DSH o todo el
PC) y la política frente a los demás sistemas —`/skill-propiedad`, `/skill-sistemas`, la puerta que mira fuera
al proponer, y las tres invariantes (nunca se escribe fuera, nunca se sobrescribe lo ajeno, una publicación no
es un choque)—. **v3.0.1** en `main` local: cierra los defectos que aparecieron al reparar el almacén real —
el motor preparaba correcciones que su propia puerta rechazaba (doble vara para el tope: bytes al preparar,
trozos al promocionar), `conservacion` medía el título de nivel 1 como conocimiento, un aviso de nivel 3
arrastraba a nivel humano la corrección de un error de nivel 2, y el montaje de las filas del menú se caía en
silencio dejando la sesión sin superficie de decisión. **v3.0.0** en `main` local: el veto de solapamiento mide
**tema** (no estilo), el **lote** permite que varias propuestas del mismo asunto convivan sin activarse a
medias, y el aviso del turno **cuenta por tipo y se retira**. **v2.0.0** publicada (`8ecd891`): la puerta de
calidad vigente, `audit`, `repair`/`promote` con los tres niveles de riesgo y la promoción automática
**apagada** por defecto.

## Almacén: el objetivo del `DIAGNOSTICO-2026-10-15`, alcanzado

Medido el 2026-10-16 sobre los estados **vivos** (`audit --estado approved,disabled,proposed,published`):
**30 skills · PASS 14 · WARN 16 · ERROR 0**. Al empezar el día eran 32 auditadas con **11 errores**. Las 11 se
cerraron así:

| Skill | Qué incumplía | Cómo se cerró |
|---|---|---|
| `design-taste-frontend`, `image-to-code`, `imagegen-frontend-web` | `body-max` | `repair` + `promote --nivel 2` (secciones enteras a `references/`, versión anterior en `superseded/`) |
| `nuxt-storefront-frontend` | `description-min`, `whenToUse-min`, `body-max` | Texto redactado y aprobado por el autor + `repair`/`promote` |
| `tenant-maintenance-update` | `description-max`, `whenToUse-min` | Ídem |
| `tenant-onboarding-provision`, `impeccable` | `whenToUse-min` | Ídem |
| `hostinger-tenant-release` | `whenToUse-min`, `personal-path` | Ídem, y la ruta personal pasa a `$DSH_HOME\secrets\` |
| `saas-corporative-gate-workflow` (apagada) | `description-min`, `whenToUse-min`, `body-max` | Ídem; la corrección se activó y la skill **se volvió a apagar** (su estado original) |
| `generated-images-to-project-assets` | `link-missing` | La frase aclara que la referencia es de la skill `ai-image-batch-generation`, donde el fichero sí existe |
| `saas-corporative-context-discipline` | `link-missing` ×2 | El aviso deja de citarlos como vínculos propios: el material está perdido y vive en `docs/133`/`docs/276` |

Copia previa de los ocho ficheros editados a mano: `$DSH_HOME/backups/skills-edicion-2026-10-16/`.

Queda **declarado, no escondido**: 16 `body-budget` (aviso, no error: cuerpos entre 8.000 y 24.000) y 1
`absolute-path` (aviso; el patrón casa con el `project:` del propio frontmatter y con escapes de código).

## Los dos defectos que salieron al medir el puesto (2026-10-16)

| Defecto | Cómo se midió | Estado |
|---|---|---|
| La guarda de material de `reparar` buscaba la propuesta con `projectKey(cwd)` en vez de con la clave recibida: con una skill cuyo `meta.project` apunta a otra ruta (o con `--project-key`) miraba otro proyecto, veía un árbol vacío, **acusaba a la propuesta de perder material** y devolvía `failed`… dejando la propuesta escrita | 11 de las 16 skills con `body-budget` daban `failed` **con la propuesta en su sitio**; con la clave correcta, 13 proponían | **Corregido** (la clave se pasa explícita) + 2 regresiones en `tests/repair.test.mjs` |
| El motor proponía una corrección de **forma** cuando lo único pendiente era el tamaño y el corte se había declarado imposible: la propuesta no arreglaba el hallazgo | `brandkit`: 20.461 bytes de cuerpo, la mayor sección de 5.646, el corte deja 11.050 — por encima del umbral | **Corregido**: se declara `blocked` con `body-sin-corte-posible` y lo que hace falta (partirlo a mano) |

**Trampa obsoleta corregida:** el `absolute-path` del almacén real **NO** lo disparaba el `project:` del
frontmatter (ese campo está en el frontmatter y la regla mide `description + whenToUse + body`), sino el
literal de una expresión regular **dentro de código en línea**, donde `\/` es una barra escapada. El aviso
era un falso positivo, y la regla ahora mide por contexto (prosa avisa; ejemplo y cita quedan como `info`;
barra duplicada es ambigua).

## Los 16 avisos `body-budget`, medidos en una copia de arena

Sin escribir ni una vez en el almacén real (se copia cada skill a una caja de arena y ahí se repara). Tras
corregir los dos defectos del motor, el reparto es **14 proponen · 2 bloqueadas** por el corte:

| Resultado | Cuántas | Detalle |
|---|---:|---|
| **Proponen y bajan del umbral** | **12** | cuerpos de 9.6k–21.8k → 5.2k–6.4k; `alcanzoObjetivo` y las nueve pruebas de regresión **en verde** |
| **Bloqueadas: el corte no cabe** | **2** | `brandkit` (20.287) e `image-to-code` (19.723): el material que no vive en ninguna sección no se puede mover, y el motor **no parte secciones**. Requieren criterio: dividir el cuerpo a mano |
| **Resueltas tras corregir el motor** | **2** | `design-taste-frontend` (19.017 → 6.604) e `imagegen-frontend-web` (19.067 → 6.917): creaban rutas que **ya existían** en su propio `references/` —11 y 6 secciones— y la puerta rechazaba la propuesta por ruta repetida. **Corregido**: el nombre se desambigua con la huella del título completo y se comprueba contra todo lo ocupado |

## Qué está verificado (con la evidencia)

| Afirmación | Cómo se comprobó |
|---|---|
| Una skill aprobada se usa **sin reiniciar** el harness | Log real de la sesión: catálogo de 34 skills (seq 6380) → aprobación (seq 8675) → 35 skills, con la nueva (seq 8688) |
| Las pruebas no tocan el almacén real | Suite hermética: huella del store antes y después |
| El ámbito es por proyecto | El store tiene una sola clave de proyecto y no aparece nada suyo en otros catálogos |
| Decidir dos veces la misma cosa no miente | Aprobar algo ya aprobado responde «Ya estaba activa» sin mover nada (repro contra el CLI real) |
| Los bloques de resultado se cierran con X y el cierre sobrevive | `localStorage` (el cliente de escritorio se sirve desde el origen estable `dsh-app://app`). **Verificado en vivo por el autor** el 2026-10-13: cerró un bloque, reinició la aplicación y no volvió a aparecer |
| Una sesión que aprende **varios temas** propone todos | Prueba de fuego con la **biblioteca real como corpus**: tres temas distintos → las tres propuestas (antes la 2ª y la 3ª se vetaban con 0,68). El veto mide tema: pares etiquetados, distintos **0,000** y mismo tema **0,500–1,000** (margen 0,500; era 0,06) |
| Un **lote** no se activa a medias, y la vía humana sigue libre | Probado con dos correcciones de nivel 1 reales: con una hermana sin proponer, la promoción automática **espera**; con el lote completo y verificado, promueve. `approve <id>` no la bloquea |
| La píldora cuenta lo que pasó por **tipo** | Congelado en `tests/aviso-del-turno.test.mjs`: creación + actualización dicen las dos, tres resultados se cuentan por tipo, y creación + rechazo **no** se resume como «no se creó ninguna» |
| **El montaje de las filas no se cae en silencio ni se rinde** | `tests/activation.test.mjs`: un comando humano monta las filas que el provider no montó, y cuando el `inject` del hijo no registra nada el resultado **lo declara** con el motivo y un intento posterior sí monta (el agente ya no queda cacheado a medias) |
| **El motor no prepara correcciones que su puerta rechace** | `tests/repair.test.mjs` + `tests/promote.test.mjs`: el tope se mide en bytes con la misma función en las dos partes; lo que el motor prepara cabe en su tope y deja el cuerpo bajo el umbral; `sin-ciclos` mide progreso; y el H1 de una skill editada a mano no impide promover |
| **El almacén queda sin errores vivos** | `audit --estado approved,disabled,proposed,published` → 30 skills · ERROR 0 (antes 11) |
| **El plugin ya no da por hecho que el puesto es suyo** | `tests/scope.test.mjs` (14): sin declarar avisa y no compite; `dsh-only` **rechaza** el id que ya vive fuera; `machine` avisa con el sitio; un id libre no genera ruido; una publicación no es un choque; un almacén declarado dos veces se cuenta una |
| **El plugin ya no da por hecho que el puesto es suyo, y no confunde lo que no pudo leer** | `tests/scope.test.mjs` (28), `tests/scope-concurrencia.test.mjs` (8): cuatro estados de la declaración, CAS al declarar, fuente inaccesible ⇒ barrido incompleto, identidad clasificada, rutas que no se salen, cerrojo compartido, idempotencia y el CLI real comparado con el comando |
| **El `absolute-path` del almacén real era un falso positivo** | `tests/audit-rutas.test.mjs` (9): el literal de la expresión regular ya no avisa; la ruta en prosa sí; ejemplo y cita son `info` |
| **El inventario no se inventa choques ni los esconde** | `systems` sobre el almacén real: 7 sistemas, 4 existentes, **0 choques**, 50 ids únicos |

## La propiedad del puesto: declarada, y sin declarar por nadie todavía

Medido el 2026-10-16: este plugin **no es el único que escribe skills aquí** — 7 sistemas conocidos, 4 existen:

| Sistema | Almacén | Skills |
|---|---|---:|
| skill-compiler (nuestro) | `~/.dsh/skill-compiler/projects` | 29 |
| DSH · biblioteca curada | `~/.dsh/skills` | 22 (**2 nuestras, 20 ajenas**) |
| Hermes · perfil `byron-saas-corporative` | `~/AppData/Local/hermes/profiles/…/skills` | 1 |
| Hermes · perfil por defecto | `~/AppData/Local/hermes/skills` | 0 |

`node bin/skill-compiler.mjs systems` → **0 choques** de id entre sistemas, y los dos ids que viven en la curada
**y** en nuestro almacén (`dsh-local-mcp-integration`, `php-pdo-mariadb-local-contracts`) son nuestras propias
publicaciones: una sola copia efectiva.

**La declaración está PENDIENTE y es una decisión del autor, no del motor** (`ownership.json` no existe →
propiedad `null`): `/skill-propiedad dsh-only` o `/skill-propiedad machine` en cualquier sesión, o
`node bin/skill-compiler.mjs ownership dsh-only|machine` en el terminal. Mientras no se declare, el plugin lo
dice donde importa (al proponer, en `doctor` y en `/skill-propiedad`) y **no compite fuera de DSH**.

## Pendiente, con su estado

| Tema | Estado |
|---|---|
| Probar en vivo el **panel de decisiones en lote** (casillas + confirmación) en la tarjeta | Implementado en v1.5.0 y **reparado en v1.5.2**: el cliente declaraba `inject: ['slots', 'locale']` y le faltaba `'remote.commands'` (el path que el anfitrión exige, igual que su propio paquete de comandos), así que el panel no podía leer las pendientes y encima decía «no hay nada» — ahora dice el motivo y por dónde seguir. Requiere recargar el plugin para tomar efecto |
| Filas del menú por sesión | Implementado en v1.6.0: se montan bajo el `agent.ctx` de la sesión, con el agente que el provider recibe. **Verificado en vivo por el autor**: ya no aparecen pendientes de otros proyectos |
| **Deshabilitar y eliminar una skill** | **Implementado en v1.7.0** y **probado en vivo por el autor**: apagó una skill y el disco quedó correcto. Su prueba destapó el defecto que la v1.7.1 arregla: `skill-deshabilitar`/`skill-habilitar`/`skill-eliminar` movían la skill **sin avisar al catálogo**, así que el agente seguía viéndola ofrecida. Ahora toda acción que mueve avisa (una sola puerta, con suite que lo exige) y `/skill-propuestas` lista las apagadas con su vuelta |
| Ver en vivo el **aviso del turno**: la retirada a los 8 s / 30 s, la pausa con el foco, y la frase compuesta con una creación y un rechazo | Implementado y con su contrato probado (los dos tiempos declarados, el foco que pausa, el reloj fuera del plegado). **Falta verlo correr**: en este puesto no hay control de navegador. El autor lo verá al usar el plugin |
| La X en el resultado de una fila | Reparado en v1.6.1: el cliente aprende del catálogo los nombres de las filas y registra su tarjeta. La tarjeta **ya pintada** antes de aprender sigue sin X |
| Reducir el ruido del catálogo global | Medido el 2026-10-13: de las 20 skills de `~/.dsh/skills`, al prompt llegan 13. El motivo **no está medido** (candidatos: deduplicación por similitud o presupuesto). La composición por proyecto sí: 0 skills de otros proyectos en los tres casos |
| **Adiciones a tres skills de tenants** (`hostinger-tenant-release`, `tenant-onboarding-provision`, `tenant-maintenance-update`) | Contenido redactado, **sin aplicar**. Las tres viven ahora en `approved/` del proyecto `saas-corporative`, así que las adiciones se aplican **ahí** (ámbito del proyecto), no en la biblioteca compartida |
| **Cruces entre repos** | **Resuelto el 2026-10-13.** El cruce estaba fuera del plugin: cinco skills de proyecto en la biblioteca global y una nota del README de `prompt-doctor` que citaba la ruta de un proyecto. Ambas fuentes cerradas; evidencia en [`docs/AUDITORIA-2026-10-13-cruces-entre-repos.md`](docs/AUDITORIA-2026-10-13-cruces-entre-repos.md) |
| **Declarar la propiedad del puesto** | Implementado y probado, **sin declarar**: la respuesta es del autor. `ownership.json` no existe, así que la política activa es «sin declarar» (no compite fuera de DSH y lo dice). Un comando la declara |
| **16 skills con `body-budget` (aviso)** | Cuerpos entre 8.000 y 24.000 caracteres: aviso, no error — el motor sabe mover ese material a `references/` con `repair` + `promote --nivel 2`. **No se ha hecho**: es una tanda de 16 promociones y el objetivo del diagnóstico eran los errores. Se puede lanzar cuando el autor lo diga |
| **Un H1 que no coincide con la descripción no está en la auditoría** | El motor **compone** el H1 desde la descripción al escribir, así que la divergencia se normaliza en la siguiente corrección y ya no impide promoverla (era el defecto). Lo que no hay es una regla de auditoría que la señale por sí sola: una skill con el H1 cambiado y nada más no aparece en el informe |
| **El `absolute-path` casa con el `project:` del frontmatter** | El patrón `[A-Za-z]:\\…` encuentra la ruta del proyecto que el propio motor escribe en el `meta` de cada skill (y escapes de código, como `\n`). Hoy es un aviso por skill; si molesta, la regla debe excluir el frontmatter y los bloques de código —**medir antes** cuántos avisos eran falsos positivos |
| Capturas y tarjetas del menú `/` no admiten decoración por fila | Medido y cerrado: no se reintenta |

## Pendientes del harness (no del plugin)

| Tema | Estado |
|---|---|
| **`create_goal` choca con un objetivo pausado** | Reportado por el autor el 2026-10-13: el modelo respondió *«El create_goal chocó con el objetivo pausado, pero tu mensaje es la instrucción directa y sigo… tuvo que tomar otra ruta para no detenerse»*. **Auditado el 2026-10-14, y la interfaz queda descartada como defecto**: `Resume goal`/`Edit goal`/`Clear goal` son de la UI **oficial** de objetivos (`@deepseek-ai/dsh-client-ui-goal`, montada por los bundles `dsh-base` + `dsh-web-app`; el `cordis.patch.yml` del usuario no la menciona y la instalación está intacta). Aparecen porque las acciones **dependen de la fase**: el diccionario declara `phase.active` / `active.disarmed` / `paused` / `blocked` y, con el objetivo pausado, salen esas tres (nunca antes vistas porque nunca hubo uno pausado). Lo que sigue abierto es el **comportamiento**, no la interfaz: qué debe hacer el modelo cuando `create_goal` choca con un objetivo pausado — ¿reanudarlo, no dejar crear otro, o parar y preguntar antes de cambiar de ruta? Decisión del autor. Contexto disponible: el host trae `dsh-goal` + `dsh-goal-round-driver` (driver de rondas) y los objetivos viven en `$DSH_HOME/storages/` |

## Decisiones que no se vuelven a discutir

- **Zod, no schemastery**, para las proyecciones: el registro valida con `schema.parse(...)`.
- **Comprobar el contrato antes de registrar**: `register()` no valida los esquemas que recibe.
- **Aprobar no es una herramienta del modelo**; vive en `bin/` y en los comandos del compositor.
- **Una regla, una implementación**: la puerta se comparte entre CLI, comandos, interfaz y página.
- **El estado se repara, la vista se exige** estricta.
- **Nada se escribe dentro del repositorio del usuario**: lo aprendido vive en `$DSH_HOME` por proyecto.

## Cómo se compone el catálogo que ve el agente

Medido el 2026-10-13 leyendo el bloque `<available_skills>` del log de tres sesiones reales —la del plugin, la
de `saas-corporative` y la de `duranspainting`—:

| Origen | `plugins-dhs` | `saas-corporative` | `duranspainting` |
|---|---|---|---|
| Del proyecto (store del plugin, servido por `cwd`) | **0** | 17 | 2 |
| Biblioteca global (`~/.dsh/skills`, lo transversal) | 13 | 13 | 13 |
| Empaquetadas en la app (office-docx/pptx/xlsx, diagnose-windows-sandbox-acl) | 4 | 4 | 4 |
| Del workspace (`.dsh/skills` del repo, p. ej. `prompt-doctor`) | 0 | 1 | 0 |
| **De otro proyecto** | **0** | **0** | **0** |

El ámbito funciona: ningún proyecto ve skills de otro. Lo que se ve de más es lo global, que por diseño entra
en todas las sesiones.

## Trampas ya medidas

- El log de una sesión son **miles de frames zstd independientes**: hay que descomprimir desde cada cabecera
  mágica; descomprimir el fichero entero sólo lee el primero.
- Un plugin de cliente **no puede** reemplazar la tarjeta de una herramienta: el nodo `tool` no declara hijo
  keyed y su clave ya está ocupada.
- El cierre de un bloque se guarda en **`localStorage`**, no en `sessionStorage`: un `sessionStorage` moría con
  la ventana y el bloque volvía a aparecer al reiniciar (era la trampa de la v1.4.0, y está arreglada y
  verificada en vivo por el autor).
- Dentro de un *template literal*, un backtick en un comentario CSS rompe el fichero.

## Trampas de las pruebas con procesos independientes (medidas el 2026-10-16)

- **`exit` se emite UNA vez, y quien no estaba escuchando se lo pierde.** Un hijo que muere en el acto
  (el caso de «qué pasa si se cae con el cerrojo tomado») salía antes de que el padre se suscribiera, así
  que el padre esperaba 60 s a un proceso que ya había terminado. La salida se captura **al lanzar** el
  hijo (`hijo.salida = new Promise(...)`) y luego se espera esa promesa con un tope.
- **Dentro de un *template literal* —el guion del hijo, aquí— un backtick cierra la cadena, aunque esté en
  un comentario.** Pasó tres veces: «propose», «rename» y «extra». Se escribe con «» y se comprueba
  con `node --check` **después** de cada edición, no después de la tercera.
- **No midas la heurística que no estás probando.** Los hijos proponían skills de verdad y el veto de
  solapamiento (o el tope de 24.000 caracteres del cuerpo) decidía el resultado: la prueba hablaba del
  cerrojo y medía otra cosa. El cerrojo se mide con el cerrojo (`conCerrojo`), y lo que se comprueba de una
  escritura es su **firma** (quién la escribió), no que el fichero exista.
- **Sincronización por condición, nunca por tiempo**: marcadores que el otro espera (`arrancado`,
  `cerrojo-tomado`, `sigue`, `adelante`), con tope, y un **vigilante** dentro del hijo que lo mata si se
  atasca. Un `Atomics.wait` en bucle bloquea el hilo: los temporizadores del hijo no corren mientras gira.

## v3.2.1 — un id mal tecleado deja de ser un callejón (2026-10-16)

Medido en uso real: `/skill-aprobar dhs-nexus-protocol --local` (una letra cambiada de sitio) respondía «No
hay ninguna propuesta «dhs-nexus-protocol»» —verdad, y sin salida—. Ahora los tres caminos que buscan un id
(`/skill-ver`, `/skill-aprobar`, `/skill-rechazar`) ofrecen el más cercano con `sugerenciaDeId` (≤2 ediciones,
candidatos ordenados ⇒ empate determinista). **Sugiere, no aprueba**: nada se mueve por parecido. Sin tag ni
release: la autorización cubría el commit y el push, no una release adicional.

## v3.3.0 — la capa de seguridad (2026-10-16)

El día de uso real cerró sin fallos, y lo que faltaba no era el motor: era que **un id podía ser una ruta**, que
una skill podía llevar una credencial o una orden dirigida al agente, que un enlace dentro de una skill podía
sacarla de su carpeta y que el diario se podía editar sin que se notara. Ahora `lib/security.mjs` es el único
juicio, y vive en `validateInput` + `auditarCarpeta` (así proponer, aprobar y auditar no pueden divergir).

- **Bloqueo** (no se escribe, no se aprueba ni con `--force`): credenciales, órdenes al agente, destrucción de
  una unidad. **Aviso** (humano con `--force`, automático nunca): rutas sensibles y operaciones privilegiadas.
- `move`/`locate` juzgan el id; `revisarArbol` rechaza enlaces; la huella del árbol se compara antes y después
  del movimiento; la promoción automática sube a humano con cualquier aviso de seguridad.
- El diario encadena (`huellaAnterior` + `huella`, cubriendo el eslabón). Límite declarado: sin secreto local no
  hay firma, así que detecta la edición y no al atacante que recalcula la cadena.
- **540/540** (17 nuevos adversarios), hermética verde, almacén real 31 skills con 0 bloqueos y 0 avisos.
- `security` en la CLI (solo lectura, exit 1 si hay algo) y una línea en `doctor`.

## v3.4.0 — el ámbito se decide en el panel, y la actualización se anuncia (2026-10-17)

- El panel «Decide right here» ofrecía aprobar y apartar; el ámbito (`--global`) sólo se podía teclear. Ahora
  hay tres acciones y funcionan **con varias marcadas**: aprobar (este proyecto), publicar para todos, apartar.
  La confirmación dice el alcance.
- `pending()` marca `updatesActive`: una propuesta sobre algo ya activo es una **actualización**, y se dice en
  el listado y en la fila. Caso medido: `fault-injection-by-category`, propuesta 15:48 sobre la versión
  aprobada a las 15:08 — el mismo id en «pendientes» y «activas» se leía como una aprobación que no sirvió.

## v3.5.0 — el medidor de la actualización automática (2026-10-17)

- `medirAutoActualizacion` compone las nueve pruebas de `promover` + nivel ≤2 + evidencia comprobable +
  disparador intacto + seguridad 0/0 + diff presente. Devuelve medidas con números y `promover` las obedece
  (`espera-medidor` en el diario). `auto [<id>]` las pinta; `/skill-propuestas` etiqueta cada actualización.
- Defecto real destapado al medir: `propose` guarda `diff.lineas` como **cuenta**, y dos lectores pedían
  `.length` → la puerta de tamaño y la justificación de lo eliminado leían **0** en toda propuesta guardada.
  Corregido con `cuentaDiff`. Y `diff-medido`: sin diff no se pasa, porque «no medible» ≠ «pasa».
- Veredicto real de la actualización pendiente del usuario (`fault-injection-by-category`): **exige humano** —
  nivel sin declarar (3) y **cambia el disparador**; el resto de medidas en verde.

## v3.5.2 — el aviso de huella era falso, y el panel contaba preguntas como aprobaciones (2026-10-18)

- **El aviso «el árbol que se movió no es el que se validó» salía en TODAS las aprobaciones.** Medido en arena:
  `SKILL.md` idéntico byte a byte y solo `meta.json` distinto — y lo reescribe `move` a propósito (`state`,
  `approvedAt`, `supersededPrevious`). La comprobación medía el árbol; ahora mide la **huella del contenido**
  (`SKILL.md` + `references/`) y se verifica **antes** de renombrar: una divergencia aborta sin mover. La
  comprobación posterior, si no casara, devuelve la skill a `proposed` y la aprobación se declara fallida.
- **El panel contaba como aprobado lo que era una pregunta.** «Approve the selected» mandaba
  `skill-aprobar <id>` sin ámbito; el comando pregunta dónde vive la skill (correcto para un humano) y el panel
  leía esa pregunta como éxito: **11 «aprobadas», 10 pendientes** en el almacén. Ahora el botón manda
  `--local`, y si la respuesta empieza por «¿Dónde quieres que viva» el panel la cuenta como pendiente.
- Un fallo al mover devuelve motivo, no excepción. Contrato individual/lote documentado en `docs/OPERACION.md`.
- 564/564 en verde, hermética verde; almacén real intacto (10 propuestas · 3 aprobadas · 3 publicadas).

## v3.5.3 — el panel del lote no ejecutaba, y lo contaba como hecho (2026-10-18)

- Tres intentos seguidos del usuario: «N aprobadas · 0 fallos · Pendientes: 0», y el almacén con las mismas 10.
  En las trazas **no hay un solo `command/run`** de ese lote: el host no ejecuta lo que el panel le pide, y el
  panel contaba `undefined` como éxito.
- Arreglado lo que depende de este repo: sin resultado ⇒ fallo con motivo; el informe se relee del host; y si
  no se ejecutó nada, el panel pinta las líneas exactas para pegar en el compositor (vía que sí funciona).
- **Pendiente de decidir (fuera del repo)**: el contrato real del `runCommand` del host para el lote. El asar
  está minificado y no se pudo extraer; si vuelve a hacer falta, el camino es la consola del renderer, no grep.
## v3.5.4 — el diagnóstico del contrato del host

- `listCommands` y `runCommand` **no existen** en el asar del harness: sus nombres son otros, y el panel pide
  ejecutar contra claves que el host no tiene (`undefined`). Hasta saber el contrato real, el panel pinta
  `host · nombre=tipo · …` con todo lo que recibe cuando un lote falla. Una pulsación lo resuelve.
- Nunca más adivinar: instrumentar la superficie es más rápido que 182 MB de asar minificado.

## v3.6.0 — el lote es una orden del servidor (2026-10-18)

- `/skill-aprobar a,b,c --local|--global`: una orden, N ids, resultado por elemento, error si alguno falla.
  `aprobarLote()` exportada y probada (6 casos). El panel la usa cuando hay varias marcadas y cae a id a id.
- El panel **prueba las formas** de `runCommand` (texto con barra, nombre+args, objeto, texto solo) y se queda
  con la que el **almacén** confirma; si ninguna obra, pinta las firmas reales y las líneas para pegar.
- Auditoría: descartadas «código viejo» (la app es 3.5.4 y el cliente está enlazado) y «copia del plugin» (no
  hay ninguna). La causa es la forma de llamar; el efecto es la única prueba aceptada.

## v3.7.0 — el ciclo del aprendizaje queda auditado entero (2026-10-18)

- El diario sólo anotaba promociones: las **aprobaciones** (humano y auto) no dejaban rastro. Ahora hay un solo
  escritor encadenado en `security.mjs` y los tres caminos anotan `decision/ambito/por/canal/hash*/avisos`.
- `skill-globalizar` **forzaba** los avisos (`force: true`); ahora pide `--force`. Y la herramienta automática
  pasa la huella del contenido a `approve` (antes aprobaba sin comprobarla).
- 7 pruebas nuevas (local, global, lote, apartar, auto, cadena manipulada, --force). 586/586 y hermética verde.

## v3.8.0 · release — el panel aprobó en vivo (2026-10-18)

- **Forma del anfitrión confirmada por el usuario**: `runCommand` con **texto con barra** (`/skill-aprobar …`).
  El panel aprobó 3 y luego 7, 0 fallos, pendientes 0. El lote va en una sola orden.
- Añadidos tonos por significado (ok/warn/error/muted, derivados de currentColor) y una entrada de 170–200 ms
  que se apaga con movimiento reducido; 4 pruebas de artefacto nuevas (47 en ese fichero).
- Trampa repetida: backtick dentro del template literal del CSS (`currentColor`) rompió `client.js`; `node
  --check` lo cazó antes de seguir. Ya estaba anotada y aun así cayó — comprobar SIEMPRE tras editar `client.js`.

## v3.8.1 — los dos avisos de la sesión del 19-10 (2026-10-19)

- **Filas sin anunciar**: el `inject(['commands'])` del contexto del agente no llamaba a su callback; el
  contexto sí tenía `commands`. Ahora se prueba el registro directo antes de declarar el motivo, y el motivo
  distingue «no existe» de «no tiene register()».
- **Panel**: «Nada pendiente» (verde) ≠ «no hay filas» (ámbar + comando por id). Eran el mismo mensaje.
- 591/591 y hermética verde; una prueba de activación nueva y el artefacto de interfaz ampliado.

## v3.8.2 — la forma real del montaje por agente (2026-10-19)

- `agent.ctx.commands` **lanza** sin inject («cannot get property "commands" without inject») y el `inject`
  suelto desde el plugin raíz no llama: el servicio no está en el ámbito del agente tal cual.
- La forma documentada por `@deepseek-ai/dsh-commands` (README dentro de app.asar) es un **hijo montado bajo
  `agent.ctx`** con `inject: ['commands']` propio. Implementado con `agent.ctx.plugin({...})`; el hijo se
  desmonta con el plugin.
- Para leer docs del anfitrión sin extraer 180 MB: parsear el header del asar (JSON en offset 12, offsets como
  string) y leer sólo el README que interesa.

## v3.8.3 — el menú no compone filas en este anfitrión (2026-10-19)

- Medido tres veces: `inject` no llama, el hijo montado no recibe `commands`, y `agent.ctx.commands` lanza.
  **No hay filas por agente en esta compilación**; se deja de prometerlas y de depender de ellas.
- `/skill-propuestas` imprime la orden exacta (`Una orden para todas: /skill-aprobar a,b,c --local`) — esa vía,
  el panel y la CLI no dependen del menú.
- El aviso ya no dice «conviene reportarlo»: está medido, y lo que hay que hacer está en la línea de arriba.

## v3.8.6 — la evidencia del panel es el veredicto del comando (2026-10-21)

- Defecto medido: el panel aprobó dos propuestas y reportó «0 approved · 2 failed» porque **sólo** aceptaba como
  prueba que la fila desapareciera del menú — y este anfitrión no anuncia filas. El comando sí contestó
  («Ya estaba activa» al reintentar).
- Ahora se lee el veredicto por id del texto del comando (`Activa:`, `Ya estaba activa:`, `ok <id> —`), las
  filas son respaldo con `medible:false`, el lote admite parciales y un error semántico no se reintenta.
- La forma que funciona en este host es la **primera**: `runCommand(sessionId, '/comando args')`.

## v4.0.0 (en curso) — i18n ES/EN: contrato congelado y grupo 1 migrado (2026-10-23)

- **F1.3 cerrada.** El inventario medido son cuatro capas, no cuatro nombres: 4 herramientas
  (`ctx.tools.register` leídas de `index.js`), 16 comandos, 15 alias, el proveedor (rango 150) y la sección
  estática del prompt (orden 9000). Todo eso se congela en `tests/fixtures/definitions-contract.json`
  (`superficie` + por herramienta: `params`, `params_arbol`, `output_estructura` sin texto,
  `texto_obligatorio` y `contrato` con permisos/efectos/seguridad).
- El manifiesto **no guarda texto**: el esquema de salida se congela sin cadenas, así que traducir no obliga a
  reescribir la expectativa y una traducción no puede tapar un cambio de esquema. El texto se protege por sus
  propiedades: ASCII puro, inglés y ninguna ruta obligatoria vacía (`tests/definitions-schema.test.mjs`, 18 casos).
- Las herramientas de solo lectura se prueban **por huella del almacén** (SHA-256 antes y después), no por su
  descripción; y ningún parámetro se llama force/skip/bypass/override.
- Texto visible al modelo: 10 caracteres no ASCII (9 U+2014, 1 U+2026) en 8 rutas de `skill_propose` → ASCII.
  Las otras tres herramientas ya estaban limpias. Línea base ASCII 8.624 → 8.614.
- **F1.2 grupo 1 hecho** (proposals/pending/show + ayudantes compartidos): catálogo 34 → 74 claves por idioma.
  El inglés nuevo es ASCII. Las aserciones de prosa existentes se conservan fijando `DSH_LANG=es` en sus seis
  ficheros: así cada una prueba también la traducción española.
- Pendiente de F1.2: grupos 3 a 5 (reject/disable/enable/retire/retired · ownership/systems/auto · `bin/`).

## v4.0.0 (en curso) — grupo 2: approve, publish y scope (2026-10-23, `4f3a0d3`)

- Catalogo **74 -> 131 claves**. No se movieron los `code` ni las líneas del lote (`ok`/`FALLO` + `—`): la
  tarjeta las parsea con `/^FALLO\s+(\S+)\s+—/`, son marcadores técnicos y traducirlas la rompería en silencio.
- **Defecto real**: `/skill-scope` llamaba a `ambito()` sin importarlo. El `guarded` lo convertía en «No se
  pudo completar: ambito is not defined», así que el cambio de ámbito desde la sesión **nunca funcionó** y
  ninguna prueba lo ejercitaba (`ambito.test.mjs` prueba el motor, no el comando). Arreglado y con prueba.
- Lección: un `try` alrededor de una función no importada convierte un fallo de código en un aviso de datos;
  la única prueba que lo ve es la que ejecuta **el comando**, no la función.

## Acto 2026-10-23 — el falso fallo de `doctor` y las seis deudas de idioma

- **Causa demostrada, no hipótesis.** `doctor` cerraba con «1 problema(s): con esto el plugin falla al
  activarse» en un almacén **recién instalado**: su capa de seguridad hacía `readdirSync(<almacén>/projects)`
  sin guarda, y el `ENOENT` de un `projects/` que todavía no existe caía en el `catch` como si fuera un fallo de
  lectura. No faltaban `skills/` ni el almacén: faltaba distinguir **«no hay»** de **«no pude leer»**.
- **Reproducido en tres arenas, con el binario y `DSH_LANG=en`**: sin `projects/` → exit 1 y la línea
  `FAIL security layer: it could not be reviewed (ENOENT … scandir '<arena>\skill-compiler\projects')`;
  con `projects/` creado a mano → exit 0 y 16 ok; con `projects` sustituido por un **fichero** (`ENOTDIR`) →
  exit 1, que es lo correcto.
- **Arreglo en la raíz**: `leerProyectosDelAlmacen(root)` (lib/compiler.mjs) devuelve `{estado, proyectos, ruta,
  motivo}` — `inexistente` sólo con `ENOENT`, `ilegible` con cualquier otro error—, `listProjects` delega en él,
  y `doctor` informa «nada que revisar todavía» sin contarlo como problema pero **sigue fallando** con una ruta
  ilegible. Un `ENOENT` por carpeta de estado es «no hay»; otro código se declara en vez de revisar menos en
  silencio. Regresión: `tests/doctor-almacen.test.mjs` (4 casos, rojo antes del arreglo).
- **Deudas de idioma, clasificadas antes de tocar**: `textoDeMedidas` y el prefijo de alias eran (a) texto
  visible → catálogo; `motivoDeIdInseguro`, `reason` de `repair` y `estadoLegible` eran (c) dato interno
  consumido por otra función → **el valor no se toca** y su representación se compone en el punto de
  presentación (códigos nuevos `reasonCode`/`reasonParams`, `diagnosticoDeId`, y `cli.audit.state.*`); los
  comentarios de `bin/` eran (b) comentario → ASCII sin tocar sintaxis, ejemplos ni ayuda. `f1-contrato`
  verificaba una **frase** del prefijo de alias: ahora verifica `aliasOf`, `deprecatedIn`, invocabilidad,
  mismo efecto y que el canónico viaje intacto **en los dos idiomas**.
- Catalogo **527 → 562 claves** por idioma (35 nuevas, paridad y puerta `i18n-gate` en verde).
- Suite **725 → 730** (4 de `doctor` + 1 de alias bilingüe), hermética en verde. ASCII **8120 → 7580**
  (`bin/` a 0; `security.mjs` −15, `compiler.mjs` −2); la línea base **no se tocó**.
- **Queda pendiente**: la prosa de `observado`/`umbral` de las medidas y los `motivo` de los bloqueos de
  `repair` siguen siendo reporte en español (viajan como dato); `redaccion` del diario intacta por contrato.
  El prefijo de alias se retira en 5.0.0, no antes.
## Acto 2026-10-23 (tarde) — F1.1, F1.4, F2 y F3 cerradas; el anfitrion recorta los resultados

- **El menu `/` no puede filtrar los alias, y no es un defecto nuestro.** Medido en el build instalado:
  `normalizeDefinition` (`@deepseek-ai/dsh-commands`) publica un descriptor de **lista cerrada**
  `{definitionId?, name, description, input?}`; `normalizeResult` reconstruye el resultado a `{kind, text?}`; y
  `dsh-client-ui-commands` compone cada fila con `name` + `description` + `input.hint`, ocultando solo las filas
  con `hint` cuando el cursor no esta al inicio. Consecuencia doble: `aliasOf`/`deprecatedIn` (0 apariciones en
  todo el `app.asar`) **no llegan al menu** —se anuncian las 31 filas y la descripcion del alias es lo unico que
  lo distingue—, y `code`/`params`/`items` **no llegan al panel**, asi que su lectura por codigo es hoy codigo
  defensivo y decide la reserva de prosa. **Antes de retirar la prosa en 4.2.0 hay que mirar esto**: si el
  anfitrion sigue recortando el resultado, el panel no puede medir por id y debe decir «no medible», no contar
  cero.
- Lo que si se implemento: `aliasProblems()` y `aliasSummary()` (destino invalido, retirada que no es version,
  handler ausente, alias fuera de la tabla, nombre duplicado y alias de si mismo) y la linea de `doctor` que
  cuenta las 31 filas. `tests/alias-menu.test.mjs` (9 casos).
- **F1.4 · cobertura**: base `en` sin `DSH_LANG` (motor y binario), los 31 comandos con el MISMO `kind`, `code`
  y `params` en los dos idiomas, avisos, lote parcial con sus marcadores de maquina, preguntas neutras,
  `unsafe-id`, cero claves crudas ni placeholders sin sustituir, catalogos completos.
  `tests/i18n-cobertura.test.mjs` (9 casos).
- **F2 · contrato por elemento**: `aprobarLote` devuelve `items: [{id, kind, code, state, params, text}]` sin
  quitar nada de lo actual y sin emitir un `code` global (un `batch-partial` global haria que el panel marcara un
  solo id). El panel lo prefiere: ignora ids no pedidos y trata un `state` desconocido como fallo visible. Sin
  `items` queda la prosa, que **aprendio ingles**: las frases del veredicto singular estaban solo en espanol y con
  el texto ingles —ya el idioma base— una aprobacion correcta se contaba como fallo.
  `tests/resultados-por-elemento.test.mjs` (10 casos).
- **F3 · puertas obligatorias**: `tools/gates-obligatorios.mjs` corre i18n y ASCII; `pretest` lo cuelga de
  `npm test` y `test:hermetic` aborta **antes** de la suite. `tests/gates-obligatorios.test.mjs` (10 casos)
  siembra cada defecto en una COPIA del paquete y exige el rojo: clave que falta, codigo sin texto, placeholders
  inconsistentes, no-ASCII nuevo, alias invalido y contrato de herramientas alterado (esquema y expectativa).
- Suite **730 -> 768**, catalogos **562 -> 566** claves por idioma, ASCII **7580 sin crecer**,
  `definitions-schema` 18/18 y los fixtures del contrato intactos.
- **Sigue pendiente**: la version 4.0.0, su entrada del CHANGELOG, el README con el recuento real y la
  etiqueta/release (F4); la prosa de `observado`/`umbral` y los `motivo` de bloqueo de `repair`; y la
  verificacion visual del menu, que este entorno no puede ver.
## Acto 2026-10-23 — F4 publicada: v4.0.0

- **Version 4.0.0 declarada** en `package.json` y en `package-lock.json` (la raiz del lock llevaba en `1.2.0`
  desde hace veinticinco versiones: ahora dice lo mismo que el manifiesto), con la entrada del `CHANGELOG` en el
  MISMO commit —10.047 caracteres, por fase—; `coherencia.test.mjs` en verde sin tocarlo.
- **Portada refrescada desde el binario, no de memoria**: `v4.0.0` y **769 pruebas en 190 suites** (medido con
  `npm test`), en el README del repo y en el del plugin; la historia se conserva como historia (1.7.1 con 276 y
  3.9.3 con 730), no se reescribe como estado de hoy.
- **Defecto corregido y declarado**: `deprecatedIn` decia `4.0.0` mientras la descripcion del MISMO objeto decia
  «se retira en 5.0.0». Publicar 4.0.0 asi declaraba retirado en su propia version un alias que sigue vivo.
  Ahora sale de `RETIRADA_DE_ALIAS` y las pruebas comparan contra el dato (no contra un literal suelto).
- **Frases de estado de `docs/` barridas**: `ANFITRION.md` tenia la fila de etiqueta caducada («sin etiqueta por
  encima de v3.8.0, el tree va en 3.8.4»), el catalogo medido en el 19-10, `body-budget` (cerrado en el
  mantenimiento: hoy 0 de esa regla) y una ventana de prosa que decia que el panel decide por codigo —cuando el
  anfitrion recorta el resultado y hoy decide la reserva—. Corregido, con la condicion de 4.2.0 declarada.
- **Referencia viva del README del plugin arreglada**: los ejemplos declaran que los canonicos son ingleses y los
  espanoles alias hasta 5.0.0, y las filas del menu son `skill-show-<id>` / `skill-approve-<id>` /
  `skill-reject-<id>` (decia `skill-ver` / `skill-aprobar` / `skill-rechazar`, que no existen como fila).
- **Verificado en el commit candidato**: `npm test` 769/769 con `pretest` (gates i18n 566 claves por idioma y
  ASCII 7580 con tope 7580), `npm run test:hermetic` verde, `gates-obligatorios` verde, `definitions-schema`
  18/18, `audit` 48 skills (PASS 47, WARN 1 **preexistente** `absolute-path` en
  `approved/nexusbusinesssuite-3495896e/wsl2-red-espejo-y-toolchain-php`), `security` 0 bloqueos / 0 avisos con
  cadena valida.
- **Publicado**: tag **anotado** `v4.0.0` sobre el commit validado y release estable (ni borrador ni
  prerelease) en `designerbyron/plugins-dsh`. Sin `--force`, sin reescribir historia, sin mover etiquetas.
- **Queda abierto**: la verificacion visual del menu (este entorno no la puede ver; el plugin mide los alias y
  `doctor` cuenta 31 filas); la prosa de `observado`/`umbral` y los `motivo` de bloqueo de `repair` (viajan como
  DATO); y las dos retiradas declaradas —alias en 5.0.0, prosa del panel en 4.2.0 **condicionada** a que el
  anfitrion transporte el resultado completo.

## Acto 2026-10-23 (cierre) — endurecimiento posterior a la 4.0.1

Rama **`hardening/post-4.0.1`**, creada desde `8393977` (el commit del tag `v4.0.1`): **local, sin push, sin
release**, y los tags `v4.0.0` y `v4.0.1` sin mover. Cuatro commits de endurecimiento (ASCII, catalogo,
e2e, anfitrion) y uno documental: este, sin una linea de codigo.

- **La puerta ASCII tenia una lista cerrada y nada la comparaba con el arbol.** `lib/vendor.mjs` (546),
  `lib/catalog-signal.mjs` (214) y `lib/review.mjs` (75) se entregaron fuera de la puerta. Ahora todo fichero
  de primera parte (`lib/` y `bin/` recursivos, `index.js`, `client.js`) tiene que estar en `FICHEROS` o en
  `EXCLUIDOS` **con su motivo**; un modulo nuevo sin clasificar es rojo (`ascii-sin-clasificar`) y un fichero
  que la linea base vigilaba y ya no existe tambien (`ascii-ausente`). `--update` no sube un tope existente
  sin `--allow-raise`.
- **El tope sube por cobertura, no por deuda**: de 7.580 (sobre 7.579 medidos: habia 1 de holgura en
  `pending-rows.mjs`, 306 contra 305) a **8.414 exactos**. +835 son exactamente los caracteres que YA
  existian en los tres modulos no vigilados (546+214+75) y -1 la holgura retirada. Cero caracteres nuevos.
- **Cuatro cadenas visibles mas al catalogo**: las descripciones de `skill-proposals`, `skill-pending` y
  `skill-show` (el texto del menu `/`) y las tres lineas del error de la fila de otro proyecto.
  **566 -> 572 claves** por idioma. El español del catalogo es ASCII, asi que `commands.mjs` baja de 583 a 570
  y el total ASCII de 8.414 a **8.401** (la linea base se ajusto a lo medido: es lo unico que puede hacer).
- **Los dos `.e2e` ya no son guiones sin aserciones.** `propose-real.e2e.test.mjs` propone el cuerpo real
  (guardado en `tests/fixtures/propose-real-body.md`) y afirma la propuesta en disco, la huella, el cuerpo
  entero, la aprobacion y el servicio byte a byte, en arena. `vendor-real.e2e.test.mjs` usa un `fetch`
  inyectado con la forma de GitHub y recorre `parseSource -> fetchSource -> propose -> approve ->
  upstreamStatus` mirando el disco, no el resultado que devuelve la funcion. **Mutaciones controladas de las
  dos**: quitar el cuerpo del `SKILL.md` compuesto -> rojo («lineas del cuerpo que no llegaron»); quitar la URL
  del origen de `provenance.json` -> rojo en dos casos; restaurado, verde.
- **Los tres limites del anfitrion, reafirmados con su condicion de salida** en `docs/ANFITRION.md` §5:
  recorte de `code`/`items` por `normalizeResult`, respaldo de prosa activo y su retirada condicionada a una
  medicion, y alias invocables y visibles sin mecanismo de ocultacion. No se toco el `app.asar`, no se retiro
  la prosa y no se anadio ningun regex ni texto centinela.
- **Medido con el binario en una copia del almacen real** (`DSH_HOME` de arena, stdio sin tty): `audit` 44
  skills - PASS 43 - WARN 1 (`absolute-path` x1, el preexistente) - ERROR 0, con 32 archivadas fuera del
  recuento; `security` 0 bloqueos - 0 avisos y cadena valida; `doctor` exit 0, «everything in place».
- **Suite 777 -> 805** (196 suites). `definitions-schema` 18/18. Gates en verde: i18n 572 claves e ASCII
  8.401 con tope 8.401.
- **Sigue abierto**: la verificacion visual del menu (este puesto no tiene navegador), la prosa de
  `observado`/`umbral` y los `motivo` de bloqueo de `repair` (viajan como DATO), las dos retiradas declaradas
  (alias en 5.0.0; prosa del panel en 4.2.0, condicionada a que el anfitrion transporte el resultado) y
  `tests/update-real.e2e.mjs`, que entonces seguia siendo un guion manual (ya no: en el candidato v5.0.0 es
  `tests/update-real.e2e.test.mjs`, descubierta por el runner y con mutacion demostrada).

## Prototipo 2026-10-23 - registro dinamico por idioma, en rama (NO publicado)

Rama local `proto/i18n-live-commands` desde el tag `v4.0.1` (`8393977`). `main` intacto, sin push, sin mover
etiquetas. El arbol de trabajo vuelve a `main` al cerrar: el plugin esta instalado por `link:` y lo que se
cargue en el proximo arranque es el codigo publicado. Informe autorizable: `plans/PLAN-2026-10-23-idioma-en-vivo.md`.

- **El contrato del host instalado (0.2.1-rc.2) se midio antes de disenar**: `register()` devuelve el disposer
  de ESA definicion (`dsh-commands/lib/index.js:266-269` + `dsh-scope/lib/index.js:211-215`), alta y baja emiten
  `commands/change` (`dsh-commands/lib/index.js:426-436`), y el adaptador de UI instalado se suscribe
  (`dsh-client-ui-commands/lib/client.js:1435-1437`). No hizo falta parchear el `app.asar`.
- **La actualizacion del menu es SUAVE**: `invalidateAll` no degrada una foto ya lista (`client.js:858`,
  `:903-916`) y `ensureReady` sirve la foto anterior mientras la repoblacion vuela (`:927-937`). Por eso el
  cambio da las ALTAS antes que las BAJAS: la ventana muestra dos nombres y **nunca cero** (medido).
- **El registro real recorta el resultado a `{kind,text}`** (`normalizeResult`, `dsh-commands/lib/index.js:183-204`).
  Medido en la ruta real del comando: `campos=kind,text`; `code` y `params` no llegan al consumidor. Los codigos
  nuevos siguen siendo contrato del plugin y de sus pruebas, no de la interfaz.
- **Medido con el registro real** (paquete extraido del asar, `Context` real, almacen en arena): arranque EN con
  `/skill-approve` y sin `/skill-aprobar`; cambio por `/skill-compiler-language --es` con **2 avisos**, 31 filas,
  el nombre retirado devuelve `undefined` (no invocable), **el handler es el mismo objeto**, la aprobacion por el
  nombre espanol deja `approved/` en disco; cinco vueltas dejan 31 filas, 20 avisos y 1 disposer vivo.
- **Transicion**: idioma invalido no escribe ni toca el registro; persistencia rota devuelve el conjunto anterior;
  con `DSH_LANG` imponiendo el idioma no se escribe nada y el comando lo dice. El comando estable vive fuera del
  conjunto intercambiable y sobrevive a todos los cambios.
- **Numeros**: `npm test` **796/796** (777 -> 796), hermetico verde, i18n 576 claves por idioma, ASCII 7579 con
  tope 7579 y 22 ficheros (el nuevo `lib/localized-commands.mjs` entra con 0 de deuda).
- **Quedaba abierto** — y lo cerro el acto de migracion completa (siguiente seccion): `doctor` contaba la tabla
  vieja («15 of 31 menu rows (16 canonical)», medido) porque la migracion era de una operacion, y
  `decisionKindOf('skill-aprobar')` devolvia `''` (`lib/presentation.mjs:42-47`), asi que el pliegue no contaba
  esa decision con el nombre espanol. Sigue abierto, y no se declara resuelto: la comprobacion VISUAL del menu
  (este entorno no la ve; el refresco esta inferido por codigo y medido por evento, y el operador lo vio en la
  app, pero no hay captura en el repo).
- **Trampa nueva**: `propose` veta por TEMA tambien contra lo ya aprobado en el mismo almacen, asi que una
  segunda propuesta de prueba con el mismo asunto que una aprobada sale `status:"conflict"`. Un almacen por
  idioma aisla la medicion del efecto.

## Migracion completa 2026-10-23 — las 16 operaciones, y el modelo de alias retirado (rama, NO publicado)

Rama `proto/i18n-live-commands`, desde `v4.0.1`. Sin push, sin release, sin mover etiquetas; al cerrar, el
arbol vuelve a `main` y la rama queda para revision. Criterio de decision del mandato: el prototipo ya estaba
validado de extremo a extremo en la app real (el operador ejecuto `/skill-compiler-language --es` y el menu paso
de `/skill-approve` a `/skill-aprobar` **sin reiniciar**), asi que se autorizo migrar las 16.

- **Las 16 operaciones viven en un solo mapa** (`lib/localized-commands.mjs`): id interno estable, `definitionId`,
  nombre `en`, nombre `es`, `descriptionKey` y `input.hint`. El **handler se hereda** de la definicion base de
  `lib/commands.mjs`, asi que los dos nombres son la misma funcion por construccion, no por cuidado. `skill-auto`
  declara **el mismo nombre** en los dos idiomas (31 nombres distintos, 16 filas por idioma).
- **El alias ya no existe como modelo**: fuera `ALIAS_ESPERADOS`, `RETIRADA_DE_ALIAS`, `aliasProblems()`,
  `aliasSummary()`, `aliasOf`/`deprecatedIn` y `cmd.alias.deprecated`. Un nombre espanol es **el nombre de su
  operacion en espanol**; el otro idioma no se registra y **no es invocable**.
- **La puerta cambio de regla** (`tools/i18n-gate.mjs`, regla 5): 16 operaciones × 2 nombres, nombre valido y
  unico por idioma, ninguna definicion base huerfana ni operacion sin base, el unico nombre sin traducir es
  `skill-auto`, y el modelo retirado no puede reaparecer en `lib/`, `index.js`, `client.js` ni los catalogos.
  Importa los modulos en vez de leer el texto: una tabla de nombres copiada mide la memoria de quien la copio.
  Cinco pruebas negativas nuevas en `tests/i18n-gate.test.mjs` y dos en `tests/gates-obligatorios.test.mjs`.
- **`doctor`** dice `16 operaciones y 16 filas en <idioma>` (construido desde el mapa), en los dos idiomas.
- **`decisionKindOf` se declara por id de operacion** (`DECISION_OPERATIONS`) y resuelve el nombre en el mapa:
  reconoce `skill-aprobar` y `skill-approve` sin saberse ningun nombre de memoria.
- **Trampa que costo el acto: `client.js` componia SIEMPRE el nombre espanol** (`skill-aprobar`, `skill-globalizar`…)
  y funcionaba porque el alias existia en los dos idiomas. Al retirar el alias, bajo `en` el boton de aprobar
  habria dejado de existir. El panel ahora lleva los dos nombres y el idioma viaja con el bloque que se decide
  (`VERB_COMMANDS` + `idiomaDe(node.name)`), y el `bulk` reconoce la lista en los dos idiomas.
- **Los catalogos citaban comandos que solo existian por el alias**: 43 lineas de prosa espanola con
  `/skill-proposals`, `/skill-show`… ahora dicen `/skill-propuestas`, `/skill-ver`… Un texto que manda teclear
  un comando inexistente es un callejon, no una traduccion.
- **Trampa medida: la suite leia el `config.json` del almacen REAL.** `tests/i18n-cobertura.test.mjs` resolvia el
  idioma con `resolveLang({ fresh: true })` sin `root`, asi que el `--es` que el operador fijo en vivo puso en
  rojo «sin DSH_LANG el motor habla ingles» (796 pruebas, 1 roja). Ahora resuelve en su arena: una prueba que
  mide el defecto no puede depender del estado de la maquina.
- **Numeros**: `npm test` **804/804** (antes 796, con 1 roja por lo anterior); `test:hermetic` 804/804 con la
  huella del almacen real identica; i18n 578 claves por idioma y 16×2 nombres; ASCII 7565 con tope 7565 (bajo de
  7579 al mudar tres descripciones al catalogo en ASCII) y 22 ficheros; `definitions-schema` 18/18 con el
  manifiesto congelado pasado de `alias` a `nombres`.
- **Lo que NO queda demostrado**: el dibujo del menu `/` (no hay captura; el cambio en vivo lo vio el operador en
  la app y aqui se mide por evento y por registro); `lib/scope.mjs` sigue devolviendo su prosa en espanol en los
  dos idiomas (lo ven `/skill-propiedad` y `systems`, y por eso `skill-ownership` es una de las dos operaciones
  cuyo texto no cambia con el idioma: deuda declarada, con su fichero); y los nombres de **fila**
  (`skill-approve-<id>`) seguian en ingles en los dos idiomas a proposito (marcador de maquina del panel).
  **Corregido el 2026-10-23 (trampa caducada)**: con las 16 operaciones migradas, **las filas siguen al idioma**
  (`skill-ver-<id>`, `skill-aprobar-<id>`, `skill-globalizar-<id>`, `skill-rechazar-<id>` en `es`), porque su
  nombre sale del mismo mapa (`rowNameOf`). Lo que sigue siendo marcador de maquina es el **texto** de la linea
  del lote (`ok`/`FALLO`), no el nombre de la fila.

## Candidato 2026-10-23 — estado intermedio de la v5.0.0 (historia: lo cerró el acto siguiente)

Rama local desde `main` (`8393977`, el commit del tag `v4.0.1`); `main` y `origin/main` intactos, sin push, sin
mover etiquetas, sin release. **Al cerrar el acto el arbol vuelve a `main`** (`8393977`): el plugin esta instalado
por `link:` a esta carpeta, asi que lo que arrancara es el codigo publicado y no el candidato; la rama
`release/v5.0.0` queda para revision.

- **Los dos frentes estan integrados, sin perder nada**: `hardening/post-4.0.1` entro limpio (fast-forward
  conceptual, sin conflictos) y `proto/i18n-live-commands` entro con diez conflictos, resueltos uno a uno con su
  motivo escrito en el mensaje del merge. El criterio no fue «un lado»: los tests de endurecimiento y el test que
  sustituye al del alias conviven; los del alias no vuelven porque el modelo esta retirado y la puerta ya no mide
  esa regla.
- **La cobertura ASCII estaba a medias en las dos ramas**: el endurecimiento vigilaba 24 ficheros y el prototipo
  habia anadido dos modulos (`lib/localized-commands.mjs`, `lib/operations.mjs`) que **ninguna de las dos listas
  clasificaba**. La puerta endurecida los caza como `ascii-sin-clasificar`; al clasificarlos, la linea base se
  recalculo a lo medido: **8.353 con tope 8.353, 26/26**. Los 8.401 y 7.565 que circulaban eran estados
  distintos, no una suma.
- **Dos pruebas median un literal que el codigo ya no debe tener**: el `24` de ficheros vigilados y el numero de
  clave del catalogo. Se cambiaron para que el numero **salga de la lista que lo gobierna**
  (`primeraParte(RAIZ)`), y el texto esperado de las descripciones se lee del catalogo (`t(clave)`) en vez de
  copiarse en la prueba.
- **`update-real.e2e.mjs` deja de ser un guion manual**: cinco casos descubiertos por el runner, arena por caso,
  CLI real y estado en disco; mutacion controlada (retirar la comprobacion de integridad de la base) pone en rojo
  el caso 4 y solo ese; restaurado, 5/5.
- **Medido**: `npm test` **860/860 en 209 suites** (855 al terminar el merge, +5 del e2e); `test:hermetic`
  860/860 con huella del almacen real identica; i18n **695 claves por idioma** y 16 operaciones x 2 nombres.
  `doctor` verde sobre una copia del almacen real (exit 0, «everything in place»). `audit`/`security` en solo
  lectura sobre la misma copia: 44 skills,
  PASS 43, WARN 1 (`absolute-path`, el preexistente), ERROR 0; `security` 0 bloqueos y cadena valida.
- **Lo que entonces impedía el PASS (§5E del mandato, medido, no supuesto; cerrado después)**: la prosa humana
  que vive fuera del catalogo seguia en espanol fijo. `audit` bajo `DSH_LANG=en` imprimía **9 lineas en espanol** (cabecera
  «skills auditadas», «archivadas … no se auditan», los nombres de estado, los `fixes:` y el detalle de la regla);
  la misma deuda esta en `lib/security.mjs`, en los mensajes de integridad de `lib/compiler.mjs` (`check`),
  `lib/vendor.mjs`, `lib/promote.mjs`, `lib/review.mjs` y `lib/projection.mjs`, y en la capa del modelo
  (`lib/definitions.mjs`). Los catalogos no tienen ni una clave `audit.*`, `security.*`, `vendor.*`, `promote.*`
  ni `review.*`. **Sin PASS no hay 5.0.0, ni tag, ni release.**
- **Siguiente operacion exacta**: migrar esa prosa por audiencia y por modulo, empezando por `lib/audit.mjs`
  (cabecera, estados, `fixes` y detalle) y `lib/security.mjs` (detalle y `fix` de cada regla), conservando el
  DATO (`rule`, `observed`, `fix` como valor y el vocabulario del diario) y traduciendo solo en el punto de
  presentacion, con la prueba en los dos idiomas sobre el texto real del binario.

## Parche 2026-10-23 — v5.0.2: leer solo cuando hay que decidir, y la guia de idiomas

El operador valido a mano la 5.0.1 (un solo bloque por comando) y su captura destapo un defecto mas: con **un**
`/skill-proposals` salian **dos** bloques, porque la tarjeta leia la foto al montar y eso ejecuta `/skill-pending`.

- **Cero lecturas al montar.** La tarjeta pinta la lista del comando que la abrio; la foto se pide **antes de
  decidir** (avisos + ¿sigue pendiente?) y **despues** (para medir el efecto). Listar ya no ejecuta nada.
- **Generacion en el store.** El single-flight devolvia la lectura en vuelo sin mirar cuando se habia pedido: si
  la tarjeta estaba leyendo cuando el humano decido, la comprobacion del efecto podia aceptar una foto **anterior
  a la decision** y decir «sigue pendiente» de algo ya publicado. `invalidar()` sube la generacion; la lectura
  forzada arranca la suya y la vieja que termina tarde **no escribe**. Dentro de la misma generacion, el
  single-flight se conserva (dos `force` concurrentes = una ejecucion).
- **La foto comun no depende del verbo de la tarjeta.** El respaldo usaba `listVerbFor(node.name)`
  (`approve`/`retire`), asi que dos tarjetas de la misma sesion con operaciones distintas podian dejar una foto
  con otro significado: la ultima en pintarse ganaba el lector. Ahora la foto sale **solo** de `/skill-pending` y
  las filas del host quedan como presentacion de cada tarjeta. Si la lectura no es medible, no se juzga nada.
- **Pruebas**: 13 casos en `tests/panel-pendientes.test.mjs` (antes 9). El de la carrera estaba **rojo** con el
  store anterior (1 ejecucion y foto vieja como final) y pasa despues; hay un caso que exige que el single-flight
  siga vivo dentro de la generacion, otro con dos tarjetas de operaciones distintas, y un aserto de que el lector
  comun no menciona el verbo. Dos asertos del artefacto se alinearon con el contrato nuevo (medible solo si
  `/skill-pending` contesto).
- **Documentacion de la feature de idiomas** (lo que pidio el operador): `skill-compiler/README.md` estrena
  «Idiomas: que hay, como se cambia y que no cambia» —tres puertas, precedencia, tabla de las 16 operaciones con
  su nombre en cada idioma, lo que cambia y lo que nunca cambia— y `docs/OPERACION.md` la receta paso a paso.
  **Trampa caducada corregida**: las filas del menu **siguen al idioma** (`skill-aprobar-<id>` en `es`); el
  marcador de maquina es el texto `ok`/`FALLO` del lote, no el nombre de la fila.
- **Medido**: `npm test` hermetico **902/902 en 224 suites**; i18n 938 claves por idioma; ASCII **8.289 con tope
  8.289** en 26/26; huella del almacen real identica. Publicado como **v5.0.2** con tag anotado y release estable;
  rama `fix/panel-lecturas-concurrentes` conservada como evidencia (`4f2e233`).

## Parche 2026-10-23 — v5.0.1: el panel deja de preguntar cinco veces y de ofrecer lo ya decidido

Defecto reportado por el operador con una decisión real y reproducido en la traza de la sesión
(`nexusbusinesssuite`, eventos 306-319): **cuatro `/skill-pending` idénticos antes de publicar y uno después** —cinco
tarjetas de notificación por una decisión— y el bloque de la orden seguía ofreciendo aprobar la propuesta ya
publicada, mientras la tarjeta de arriba decía «1 published · 0 failed · Pending now: 0». El almacén estaba bien:
`proposed/` vacío, la skill en `published/` y en la biblioteca.

- **Causa 1: cinco preguntas, cinco ejecuciones.** Para saber qué está pendiente el panel **ejecuta**
  `/skill-pending` (no hay canal de lectura) y lo hacía en cada paso, sin memoria entre llamadas.
- **Causa 2: cada tarjeta con su foto.** El estado vivía en el componente, así que la tarjeta que leyó antes de
  publicar conservaba la lista vieja y ofrecía decidir sobre algo que ya no existía.
- **Corrección estructural**, no un parche: `createPendingStore` en `client.js` — un store **por sesión**, con una
  lectura en vuelo compartida, ventana de 1,5 s, `force`, `invalidar()` y suscriptores. Una lectura antes de decidir
  (sirve para los avisos y para saber si el id sigue vivo) y una forzada después; la foto nueva la ven todas las
  tarjetas. Una propuesta suelta que ya no está pendiente deja de ofrecerse (`bulk_decided`).
- **Probado midiendo ejecuciones, no prosa**: `tests/panel-pendientes.test.mjs` extrae el bloque del propio
  `client.js` y comprueba que tres llamadas seguidas o concurrentes cuestan **una** ejecución, que `force` cuesta
  dos, que las tarjetas suscritas ven la lista nueva tras decidir y que un fallo de lectura no borra lo sabido.
  **Mutación**: quitar la ventana y el aviso a los suscriptores deja 6/9 con los tres casos que guardan los dos
  defectos en rojo; restaurado, 9/9.
- **Medido**: `npm test` **898/898 en 223 suites**; `test:hermetic` verde; i18n 938 claves por idioma; ASCII
  **8.289 con tope 8.289** en 26/26 (la base bajó al pasar a ASCII las líneas nuevas del panel).
- **Aviso de instalación**: `client.js` lo carga el harness al arrancar; el arreglo no está vivo hasta reiniciar DSH.

## Cierre 2026-10-23 — v5.0.0 publicada

El acto que cerró el bloqueo anterior, con lo medido al publicar:

- **La prosa humana salió del catalogo**, por módulos y sin mover el DATO: `lib/audit.mjs` y `lib/security.mjs`
  (tabla `PROSA_DE_REGLA`, `messageCode`/`fixCode`, `estadoEnTexto`, `lineasDePuerta`), `lib/compiler.mjs`
  (reglas de calidad y la integridad que imprime `check`), `lib/projection.mjs`, `lib/vendor.mjs` (etiquetas de
  los patrones con código, avisos `{code, params, text}`), `lib/review.mjs` (la página entera), `lib/promote.mjs`
  (`reasonCode`/`detalleCode` sin mover el `reason`) y los marcadores de `ficherosQueDifieren`
  (`[{ruta, cambio}]`). `lib/i18n/index.mjs` gana `textoDeCodigo`, el único sitio donde se decide la reserva
  (clave ausente → dato crudo, nunca una clave).
- **La capa del modelo no se migra a propósito**: `lib/definitions.mjs` es la superficie que lee el modelo y su
  texto forma parte del contrato congelado; `client.js` resuelve su texto por el servicio `locale` del
  anfitrion. Las dos se declaran como tales, no como deuda.
- **Medido**: `npm test` **889/889 en 220 suites**; `test:hermetic` verde con huella identica; i18n **938 claves
  por idioma**; ASCII **8.308 con tope 8.308** en **26/26** (bajó de 8.353 al salir la prosa de los módulos).
  Con el binario y `DSH_LANG=en` sobre una copia fija del almacén: `audit`, `security`, `doctor`, `list`,
  `active`, `retired`, `systems`, `ownership` y `where` con **0 prosa española**; el JSON de `audit` es **el mismo
  dato** en los dos idiomas (44 skills en esa copia, PASS 43 · WARN 1 · ERROR 0, 32 archivadas, mismas reglas y
  severidades). Sobre el **almacén de la máquina**, solo lectura y con la huella del árbol idéntica antes y
  después: `doctor` exit 0, `audit` 50 auditadas (PASS 49 · WARN 1 · ERROR 0) y `security` 45 revisadas con 0
  bloqueos y cadena válida.
- **Lo que NO se toca y sigue declarado**: el recorte de `normalizeResult` a `{kind, text}` en el anfitrion, con
  la reserva de prosa activa y su retirada condicionada a una medición (no a una versión); la visibilidad del
  menu `/` no se puede medir sin pantalla y se informa aparte de la invocabilidad y del registro.
- **Publicación**: `package.json` y `package-lock.json` a 5.0.0, entrada `[5.0.0]` en el CHANGELOG, portada y
  `docs/` con los números medidos, tag anotado `v5.0.0` sobre el commit de cierre y release estable en
  `designerbyron/plugins-dsh`. Las releases `v4.0.0` y `v4.0.1` quedan intactas y el historial no se reescribió.

## Acto 2026-11-04 — coherencia documental y compatibilidad medida del anfitrión

Acto **sin versión nueva**: no cambia comportamiento, contratos ni datos. Cierra contradicciones documentales y
deja el anfitrión declarado con su fecha.

- **Portada**: la tabla de plugins decía `v4.0.1 · 777 pruebas` mientras el mismo README declaraba la `5.0.2` con
  **902 pruebas**. Corregida a la versión del manifiesto, y añadida la regla de que un recuento de pruebas es una
  medición fechada, no una cifra prometida.
- **`docs/ANFITRION.md`**: gana la ficha de las cuatro versiones (plugin / anfitrión / dependencias / medición) y
  la medición del **2026-11-04** sobre **DSH `0.2.1-rc.5`** (build `d4db512a`, canal nightly, `app.asar` del
  2026-10-29): las cuatro herramientas en la lista de una sesión real (56 herramientas), el protocolo en el prompt
  de sistema (938 caracteres), la proyección aceptada por el registro **real** y las filas de pendientes
  materializadas (`2 pending -> 8 menu rows` desde un proyecto con dos propuestas). La etiqueta vigente pasa de
  `v5.0.1` a `v5.0.2`.
- **`MEMORY.md`**: la sección «Versión publicada» abría con la `v4.0.1`; ahora abre con la `v5.0.2` sobre
  `bbd5e38`, y la `v4.0.1` se conserva como historia.
- **Dependencias: sin cambios, y con motivo medido.** `0.2.1-rc.5` **no** satisface `^0.2.0-rc.2` con las reglas
  por defecto de SemVer 7.7.4 (`satisfies` devuelve `false`; solo con `includePrerelease: true`). Un rango no
  habría seguido al anfitrión: habría dejado de fijar la versión sin acercarse a la del runtime. El pin exacto se
  queda, como ya documenta `docs/DEPENDENCIAS.md`.
- **Lo que no se toca**: `app.asar`, el almacén real, las propuestas pendientes y la release `v5.0.2`.

## Acto 2026-11-04/05 — motor de auto-mejora (rama de trabajo, sin versión)

Acto **funcional y sin versión nueva**: añade una quinta herramienta y un motor. No se publica nada, no se mueve
ningún tag y la superficie aprobada de `skill_propose`/`approve` queda intacta.

- **`lib/improve.mjs`** (nuevo): mejora una skill **viva** por secciones. `partirCuerpo` separa preámbulo y
  secciones `##`; `aplicarParches` sustituye por clave de título (sin el número) e inserta las nuevas con
  `despuesDe`; `mejorar` compone la candidata, crea o actualiza referencias, compara el inventario de reglas de la
  versión viva contra el de la candidata y pasa **la misma puerta que `propose`**. Lo que no se nombra queda byte a
  byte. No abre una segunda vía de escritura y no mueve la versión activa: deja la revisión en `proposed/`.
- **`skill_improve`**: quinta herramienta, registrada en `index.js`. Parámetros: `id`, `operacion`
  (`patch`/`enhance`/`reorganize`/`no_change`/`new`), `parches` (por sección y por referencia), `revision`
  (claim/evidence/measurement/change/removed), `perdidasJustificadas`, `retirarSecciones`, `evidencia`.
- **Informe `Self-improvement review`**: una línea por archivo con lo que **de verdad** pasó en disco
  (`patched`/`written`/`unchanged`), más el recuento de reglas antes y después y las pérdidas justificadas. Los
  números salen del resultado, no de una estimación.
- **Conservación**: una regla del inventario que desaparece sin justificar **bloquea la escritura**. Se comprobó
  con el caso real: 92 reglas frente a 38, y las cinco secciones de la versión activa presentes literalmente.
- **Caso de aceptación `shell-and-source-editing-traps`**: candidata de **12 secciones** y 8.236 B en
  `saas-corporative-a3c393fa/proposed/` (base: activa `e45cc88…`, que sigue intacta y sirviendo). Integra las
  cinco reglas de la activa y las seis de la propuesta del 14-oct, ordenadas por momento de uso. Cuatro pérdidas
  declaradas: los cuatro encabezados que cambian de número al reordenar.
- **Medición propia de la sección de shell** (Windows 11, PowerShell 5.1.26100): `*>` no crea la carpeta, el
  comando no llega a ejecutarse y `$LASTEXITCODE` conserva el valor anterior; `Get-ExecutionPolicy` = `Restricted`.
- **Suite**: **921 pruebas en 226 suites** (17 nuevas en `tests/improve.test.mjs`), hermética verde, i18n y ASCII
  en verde con **8.289 caracteres heredados en 27/27** ficheros de primera parte (el módulo nuevo entra con 0 de
  deuda no ASCII).
- **Deudas que este acto deja dichas**:
  1. Publicar exigirá versión **mayor** (superficie visible nueva) con su entrada de `CHANGELOG` y la portada.
  2. El motor **no toca el frontmatter**: un `whenToUse` mejorado no se puede aplicar por esta vía (hoy queda
     fuera del alcance o se declara en la revisión).
  3. `propose` **reemplaza** la propuesta existente del mismo id sin archivar la anterior (`superseded/` no
     existe para propuestas). En este acto eso sobrescribió el texto literal de la propuesta del 14-oct —su
     contenido temático quedó integrado y verificado, pero el original no se conserva—. Un `superseded/` por id
     eliminaría el riesgo.
