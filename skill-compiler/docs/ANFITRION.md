# El anfitrión: qué ofrece hoy, qué no, y cómo queda el plugin

Este documento declara **lo que el anfitrión (DeepSeek Harness) ofrece de verdad**, lo que no, y cómo el plugin
se comporta en cada caso. Todo lo de la primera tabla está medido contra la compilación instalada, no deducido
de la documentación.

## 0 · Qué versión es cada cosa

Cuatro números que no hay que confundir, porque una frase como «compatible con DSH», sin ellos, no dice nada:

| Qué | Valor en esta medición |
|---|---|
| **Plugin** (este paquete) | `5.0.2` — el de `package.json`, publicado como tag `v5.0.2` |
| **Anfitrión** (DSH instalado) | `0.2.1-rc.5`, build `d4db512a`, canal **nightly**, `app.asar` compilado el 2026-10-29 |
| **Dependencias del anfitrión** que instala este paquete | `0.2.0-rc.2`, clavadas a propósito: el motivo y el procedimiento de subida están en [`DEPENDENCIAS.md`](DEPENDENCIAS.md) |
| **Medición** | 2026-11-04, contra el anfitrión de la fila anterior |

`0.2.1-rc.5` es una compilación **nightly**, no una versión estable de DSH. Lo que aquí se declara es
compatibilidad con **esa** build, **medida ese día**: otra compilación no medida no queda cubierta, y la forma de
cubrirla es repetir las sondas de este documento sobre ella. Las filas que citan una compilación anterior llevan
su fecha y se conservan como historia; no se reescriben.

## 1 · Capacidades medidas

| Capacidad del anfitrión | Estado | Cómo se midió |
|---|---|---|
| Comandos humanos globales (`ctx.commands.register` desde el plugin raíz) | **sí** | los 16 comandos contestan, con el nombre del idioma activo (`/skill-aprobar` en `es`, `/skill-approve` en `en`) |
| Registro de comandos **por agente** (filas por propuesta en el menú «/») | **no** | tres caminos probados, tres motivos (abajo) |
| Ejecutar una orden desde la interfaz (`runCommand` con texto) | **sí**, con **texto con barra** | el panel aprobó 10 propuestas reales: 3 + 7, 0 fallos |
| Listar los comandos existentes (`listCommands`) | **sí** | el panel mide el efecto contra esa lista |
| Nombre del comando por idioma en el menú «/», con cambio en vivo | **sí** | el operador fijó `--es` en la `0.2.1-rc.2` (2026-10-23) y el menú pasó de `/skill-approve` a `/skill-aprobar` **sin reiniciar** (abajo) |
| Eventos de sesión (`session.snapshotEvents()`) | **sí** | `/skill-auto` se pliega de los `command/run` |
| Catálogo de skills por proyecto (`~/.dsh/skills`, `approved/`) | **sí** | 36 aprobadas, 4 publicadas y 1 apagada en la medición de la 4.0.0 (2026-10-23; 48 auditadas), servidas sin reiniciar |
| Herramientas del plugin registradas y visibles al modelo | **sí** | las cuatro (`skill_propose`, `skill_vendor`, `skill_review`, `skill_upstream_check`) en la lista de herramientas de una sesión real: 56 en total (2026-11-04) |
| Protocolo del plugin en el prompt de sistema | **sí** | presente en el `system/message` de esa misma sesión: 938 caracteres (2026-11-04) |
| Proyección registrada en el registro **real** | **sí** | `doctor`: el registro de proyecciones real proyecta la unidad sin lanzar, en snapshot y en lectura en frío (2026-11-04) |
| Filas de pendientes materializadas en el registro de comandos | **sí** | `doctor` desde un proyecto con dos propuestas: `2 pending -> 8 menu rows`, con sus cuatro verbos por pendiente (2026-11-04) |

### Lo que no ofrece: filas de comando por agente

La documentación de `@deepseek-ai/dsh-commands` describe la forma correcta («un plugin montado bajo `agent.ctx`
que declara su propio `inject: ['commands']`»). El plugin la intenta y **el anfitrión no la compone**:

| Camino | Resultado medido |
|---|---|
| `agent.ctx.inject(['commands'], cb)` | no llama a su callback |
| `agent.ctx.plugin({ inject: ['commands'], apply })` | el hijo no recibe el servicio |
| `agent.ctx.commands` | lanza `cannot get property "commands" without inject` |

Conclusión: en esta compilación, el servicio de comandos **no está en el ámbito del contexto del agente**. No es
un defecto del plugin y no hay variante de llamada que lo arregle.

### El menú «/» sirve lo que se registra, y por eso el nombre sigue al idioma

Composición medida en la compilación instalada, leyendo sus dos paquetes:

1. `ctx.commands.register({ name, description, input, handler })` pasa por `normalizeDefinition`, que construye
   el descriptor con **lista cerrada**: `{definitionId?, name, description, input?}`. Lo que no esté ahí no viaja.
2. La interfaz pide el catálogo con `ctx.remote.commands.list(sessionId)` (`CommandRuntime.list`, ordenado por
   nombre) y compone cada fila del menú con `name`, `description` e `input.hint`.
3. La única condición que oculta una fila es no declarar `hint` cuando el cursor no está al principio de la
   línea (`req.position === 'leading' || c.hint === undefined`). No hay campo de ocultación.

Consecuencia, y es la que cambió el modelo: como el anfitrión **no** filtra por metadatos, la única forma de que
el menú tenga **una fila por operación** es registrar **un solo nombre por operación**, y ese nombre es el del
idioma activo. `register()` devuelve el **disposer** de esa definición y cada alta o baja emite
`commands/change`, al que está suscrito el adaptador de UI (`dsh-client-ui-commands`), cuya invalidación es
**suave**: por eso el cambio de idioma da las altas **antes** que las bajas.

Eso se midió **en vivo** en la `0.2.1-rc.2` (2026-10-23): ejecutado `/skill-compiler-language --es`, el comando contestó
«Idioma fijado en es (antes en). El menu / ofrece /skill-aprobar» y, **sin reiniciar la app**, el menú `/` pasó
de `/skill-approve` a `/skill-aprobar` con su descripción en español. `doctor` dice el idioma activo y las filas
que sirve (`16 operaciones y 16 filas en <idioma>`), construidas desde el mapa y no desde un número escrito a
mano. Lo que sigue **sin verificar sin pantalla** es el dibujo del menú en sí: se infiere del evento y de la
invalidación, y se declara como tal.

**Cómo re-medirlo, con el registro de verdad y sin dobles:** `node scripts/vertical-idioma-real.mjs <dir>`,
donde `<dir>` es la carpeta `dsh/node_modules` extraída del `app.asar` instalado (con `scripts/asar-read.py`).
Levanta un `Context` real, monta el plugin de comandos del anfitrión, registra las 16 operaciones reales y las
invoca por `registry.execute()` —la ruta del humano, con `command/run`/`command/done`—: comprueba 16 filas por
idioma, que el nombre del otro idioma **no resuelve** (`execute` devuelve `undefined`), tres operaciones (lista,
lectura y aprobación de verdad, con `approved/` en disco) por cada nombre, y cinco cambios que no acumulan. No
lo corre `npm test`: necesita el build instalado, y la suite no depende de la máquina.

## 2 · Qué se implementó para no depender de esa capacidad

1. **Tres caminos de montaje con motivo distinto.** `inject`, hijo montado y registro directo; el aviso dice
   cuál se agotó. Si mañana cualquiera funciona, las filas se montan (ver §3).
2. **La orden exacta, siempre.** `/skill-propuestas` imprime, junto a las pendientes, una línea que las decide
   todas (`/skill-aprobar a,b,c --local`) y las variantes por id, por ámbito y con `--force`. No hay que
   recordar ningún identificador ni depende del menú.
3. **El panel verifica con el veredicto del comando**, que es la frase que ve el humano (`Activa: <id>`,
   `Ya estaba activa: <id>`, `ok <id> — …`). La lista de filas del anfitrión se usa como comprobación de
   respaldo **cuando existe**; si no, se declara «no medible» y no se inventa una cifra. Un `kind: 'success'`
   sin veredicto no cuenta. El lote va en **una** orden del servidor y admite resultados parciales.
4. **El aviso calla cuando no hay nada que anunciar.** Sólo aparece si el montaje falló **y** hay pendientes.
5. **Integridad y rastro.** Se aprueba el contenido que se validó (huella de `SKILL.md` + `references/`), con
   rollback a `proposed` si no casa, y cada decisión queda en el diario encadenado
   (`decision`/`ambito`/`por`/`canal`/`hash*`), verificable con `security`.

Ninguna de estas piezas es un parche sobre el defecto del anfitrión: son la vía canónica (orden escrita, panel,
CLI) funcionando sin él.

## 3 · Qué ocurre cuando el anfitrión gane la capacidad

**Nada que tocar.** No hay ningún camino desactivado a mano:

- el montaje se reintenta en cada listado y en cada sesión que el provider observe;
- el primer camino que funcione registra las filas y **el aviso desaparece solo** (`montaje.ok`);
- el menú «/» ofrecería `skill-aprobar-<id>`, `skill-globalizar-<id>` y sus pares de ámbito;
- y si el anfitrión cambia la forma de `runCommand`, el panel sondea y **verifica el efecto** antes de dar nada
  por hecho, y escribe en el informe qué forma funcionó.

Esto no es una promesa: `tests/activation.test.mjs` monta tres anfitriones falsos —uno por camino— y exige, en
cada uno, que las filas aparezcan, que el aviso no salga y que al descargar el plugin no quede nada colgando.

### Un resultado de comando viaja recortado: `{kind, text}`

Medido en `@deepseek-ai/dsh-commands` (`normalizeResult`): el objeto que devuelve un handler se **reconstruye**
con lista cerrada antes de salir —`success` -> `{kind, text?, sourceEventSeq?}`, `error` -> `{kind, text}`— y
`execute()` devuelve `{commandId, result}` con ese objeto. Lo que el handler puso de mas (`code`, `params`,
`items`) no llega al panel por `runCommand`.

Consecuencias, dichas sin adornos:

- El panel **no puede** decidir por `code` en esta compilacion: su lectura de `code` es codigo defensivo que hoy
  no se ejecuta. Lo que decide es la reserva de prosa (por eso en 4.0.0 se le ensenaron los verbos de los dos
  idiomas) y, cuando el anfitrion lo transporte, el contrato por elemento (`items`).
- `items` esta escrito y probado en los dos lados —`aprobarLote` lo produce con `id`, `kind`, `code`, `state`,
  `params` y `text`; `client.js` lo prefiere y no inventa veredictos—: entra en cuanto el anfitrion transporte
  el objeto. Lo unico que falta es la compilacion.
- **La retirada de la prosa en 4.2.0 depende de esto.** Si 4.2.0 llega con un anfitrion que sigue recortando el
  resultado, el panel no podra medir nada por id y tendra que decirlo («no medible en este anfitrion») en vez de
  contar cero. Es el requisito que hay que mirar antes de tocar esa fecha.

## 4 · Limitaciones declaradas (hoy)

| Limitación | Alcance | Qué la cierra |
|---|---|---|
| Filas por propuesta en el menú «/» | cosmético: la decisión tiene tres vías sin menú | una compilación del anfitrión que componga `commands` en el contexto del agente |
| La forma de `runCommand` no está publicada | el panel la sondea y verifica con el veredicto por id del comando (las filas, si existen, como respaldo) | un contrato documentado por el anfitrión |
| Un resultado de comando viaja recortado a `{kind, text}` | el panel mide con la reserva de prosa; `code`, `params` e `items` esperan a que el anfitrión deje pasar el objeto del handler | una compilación que transporte el resultado completo |
| Los avisos `body-budget` de la auditoría | **histórico**: los 17 del mantenimiento del 2026-10-21 quedaron cerrados; la medición de la 4.0.0 da **0** de esa regla (48 skills · PASS 47 · WARN 1) | — (cerrado; el registro está en `docs/MANTENIMIENTO-2026-10-21-ownership-body-budget.md`) |
| `ownership.json` ausente | la propiedad del puesto no se presume | `ownership dsh-only` o `ownership machine` |
| **Leer** qué está pendiente ejecuta `/skill-pending` (el anfitrión no da un canal de lectura) | cada lectura deja una notificación en el flujo, y el panel preguntaba cinco veces por decisión | desde la 5.0.1 el panel comparte **una foto por sesión** (una lectura en vuelo, ventana de 1,5 s, `force` para medir el efecto) y pregunta **una vez antes y una después** de decidir; las demás tarjetas leen esa misma foto, y una propuesta ya decidida deja de ofrecerse | un canal de lectura del anfitrión que no ejecute el comando |

La etiqueta de release vigente es **`v5.0.2`** —la que declara los contratos de este documento—; el historial de
versiones está en [`CHANGELOG.md`](../../CHANGELOG.md).

Lo que **no** es una limitación y conviene no confundir: el aprendizaje funciona de punta a punta —proponer,
decidir, activar, servir, auditar— sin el menú. El menú es comodidad.

## 5 · Los tres límites que este acto NO toca

Esta sección se reafirma en la rama de endurecimiento posterior a la 4.0.1, y lo primero es lo que **no** se ha
hecho: no se ha tocado el `app.asar` del anfitrión, no se ha retirado la reserva de prosa, y no se ha añadido ni
un regex ni un texto centinela para «detectar» el recorte. Los tres límites siguen donde estaban, cada uno con la
condición que lo cerraría y que **no** es una fecha.

| # | Límite (lo que hace hoy el anfitrión) | Qué hace el plugin mientras tanto | Condición de salida, medida |
|---|---|---|---|
| 1 | `normalizeResult` **recorta** el resultado del handler a `{kind, text}`: `code`, `params` y `items` no llegan al panel | el panel decide con la reserva de prosa; el contrato estructurado está escrito y probado en los dos lados | una compilación que transporte el objeto del handler, **comprobada con una sonda que lea `code`/`items` en el consumidor**; no se retira nada por número de versión |
| 2 | El **respaldo textual sigue activo**, y hoy es lo que decide en producción | se conserva entero y en los dos idiomas; un `code` reconocido manda, uno desconocido es fallo visible, y `scope-ask`/`language-ask`/`pending-list` son neutros | se retira **sólo** cuando la medición del límite 1 demuestre transporte real; si la 4.2.0 llega con el recorte, **no se retira** y el panel declara «no medible en este anfitrión» en vez de contar cero |
| 3 | El anfitrión **no interpreta** `aliasOf`/`deprecatedIn` (0 apariciones en el `app.asar`) y el menú sólo oculta filas con `hint` | desde la 5.0.0 **no hay alias**: se registra **un nombre por operación en el idioma activo** y el conjunto entero se cambia al cambiar de idioma, con lo que el menú se reescribe sin reiniciar (observado en pantalla). Los metadatos de obsolescencia ya no se usan | un descriptor con marca de ocultación o un menú que lea esos metadatos; mientras tanto, la visibilidad del menú no se puede medir sin pantalla y se informa aparte de la invocabilidad y del registro, que sí se miden |

La regla que comparten los tres: **una reserva no se retira por calendario ni por número de versión; se retira
cuando una medición demuestra que ya no hace falta.** Y el día que se cierre alguno, el cambio entra con su
prueba y con la medición que lo autoriza —no antes, y nunca «porque tocaba»—.

## Ventana de compatibilidad del veredicto por prosa

El contrato es el **código estable** que devuelve el comando (`activated`, `with-warnings`, `scope-ask`…) y, por
elemento, el `items` descrito arriba. La lectura de la prosa es la **reserva**: sirve para un anfitrión que no
transporte `code`, y hoy es el caso medido —`normalizeResult` recorta el resultado a `{kind, text}`, así que en
producción decide la prosa y el código es el contrato que entra cuando el anfitrión deje pasar el objeto—:

| Versión | Comportamiento |
|---|---|
| 4.0.0 – 4.1.x | Si no llega `code` —hoy, en producción, siempre—, el panel sigue leyendo el texto (compatibilidad). |
| **4.2.0** | Se **retira** la lectura de prosa: un resultado sin `code` no se interpreta. Condicionado a que el anfitrión transporte el objeto del handler; si sigue recortando, el panel dice «no medible en este anfitrión» en vez de contar cero. |

Reglas que no cambian en ninguna de las dos:

- Un `code` **reconocido** manda siempre; el `text` no se analiza.
- Un `code` **desconocido** es un fallo visible: no se convierte en éxito ni se recurre a la prosa.
- `scope-ask`, `language-ask` y `pending-list` son neutros: no se clasifican como éxito ni como fallo.
