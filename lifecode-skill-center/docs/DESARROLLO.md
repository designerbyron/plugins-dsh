# Desarrollo

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
  Los cambios de texto se hacen con un script de Node sobre `utf8` y se comprueba que no queda `Ã`.- Una ruta registrada con `resource` **sólo contesta `GET`/`HEAD`**: el servidor devuelve 405 a
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
