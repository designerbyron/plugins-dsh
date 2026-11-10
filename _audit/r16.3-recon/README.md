# R16.3 — evidencia del inventario real (`_audit/r16.3-recon/`)

Esta carpeta contiene la evidencia reproducible de la ronda R16.3 (reconciliación del
inventario vivo). Nada de aquí se escribe durante la ejecución del plugin: son capturas y
réplicas de sólo lectura.

## Ficheros que entran en la entrega

| Fichero | Origen | Qué contiene |
|---|---|---|
| `live-api.json` | Navegador (DevTools del panel real, 2026-11-09T20:53Z) | Respuestas **reales** de `GET /api/capabilities`, `/api/projects`, `/api/workspaces` y `/api/inventory` con sus `status`. Saneado: las rutas de perfil se sustituyen por `<home>`. |
| `live-summary.txt` | `analyze-live.mjs` sobre la captura | Resumen legible: 85 entradas, 55 colisiones, `byOwner`, fuentes, listado de colisiones y de proyectos descubiertos/gestionados. Saneado. |
| `case-selfshadow.json` | `extract-case.mjs` sobre la captura | Las dos entradas y las dos colisiones del caso `revisar-un-plugin-de-dsh-antes-de-instalarlo` (misma skill materializada en dos proyectos + `assignment-shadowed` cruzado). Saneado. |
| `capture.mjs` | Código del propio plugin | Réplica offline: ejecuta el **mismo** `lib/api.mjs` contra el almacén real (`~/.dsh/lifecode-skill-center`), `dshHome`, `agentsHome` y un `snapshot` de catálogo inyectado. No es un mock de las reglas: son las reglas reales con los datos reales. |
| `catalog-snapshot.json` | Captura del catálogo del Host | Las 8 filas virtuales necesarias para reproducir las 85 entradas del panel (7 `office*` + `diagnose-windows-sandbox-acl`). |
| `analyze-live.mjs` | Script de análisis | Sanea y resume la captura del navegador; escribe `live-api.json` y `live-summary.txt`. No codifica ningún nombre de usuario. |
| `extract-case.mjs` | Script de análisis | Extrae el caso de auto-sombreado desde una captura ya saneada; escribe `case-selfshadow.json`. |
| `sanitize-r163.mjs` | Script de saneado | Genera los ficheros saneados y comprueba con `--check` que no queda ninguna ruta de perfil. |

## Saneado

La captura original se tomó del panel real y traía rutas de perfil completas. La primera
versión de `analyze-live.mjs` sólo sustituía la ruta exacta de `USERPROFILE` comparando
literalmente mayúsculas y separadores; la captura usaba minúsculas y barras en el prefijo,
así que el saneado **no se aplicó**. Por eso los ficheros antiguos se llamaban «sanitized» sin
estarlo.

Ahora `sanitize-r163.mjs` sustituye por `<home>` cualquier prefijo de perfil con estas
variantes, en JSON y TXT:

- unidad + `Users` + nombre de usuario, con separador simple, doble (JSON escapado) o barra;
- cualquier combinación de mayúsculas/minúsculas;
- sirve igual para las rutas de `.dsh`, `.agents` y del centro materializado.

Control reproducible (debe salir `OK: 0 rutas personales` y exit 0):

```sh
node _audit/r16.3-recon/sanitize-r163.mjs --check
```

### Ficheros crudos, FUERA de la entrega

Se conservan para auditar, pero no deben publicarse ni entrar en el commit:

| Fichero | Por qué queda fuera |
|---|---|
| `live-api-sanitized.json` | Volcado crudo del navegador con rutas de perfil completas (el nombre antiguo es engañoso). |
| `live-inventory-snapshot.json` | Salida cruda de `capture.mjs` con rutas completas. |
| `live-inventory-builtin.json`, `live-inventory-office.json` | Variantes crudas de la réplica, con rutas completas. |
| `live-inventory-empty.json`, `live-inventory-none.json` | Estados de reproducción (inventario vacío/ausente), con rutas completas. |
| `evidence-selfshadow.json` | Volcado crudo del caso de auto-sombreado. |
| `_entries.tsv` | Tabla cruda de entradas, con rutas completas. |
| `live-summary.raw.txt`, `case-selfshadow.raw.json` | Copias crudas previas al saneado. |

Si hace falta regenerarlos: `capture.mjs` escribe `live-inventory-snapshot.json`; el volcado
del navegador se guarda **fuera** del repo y se pasa a `analyze-live.mjs`. Después:

```sh
node _audit/r16.3-recon/sanitize-r163.mjs
```

## Cómo reproducir

```sh
node _audit/r16.3-recon/capture.mjs --catalog=_audit/r16.3-recon/catalog-snapshot.json --out=_audit/r16.3-recon/live-inventory-snapshot.json
node _audit/r16.3-recon/analyze-live.mjs <ruta-al-volcado-del-navegador>
node _audit/r16.3-recon/sanitize-r163.mjs
node _audit/r16.3-recon/sanitize-r163.mjs --check
```

`extract-case.mjs` se ejecuta sobre `live-api.json` para regenerar el caso:

```sh
node _audit/r16.3-recon/extract-case.mjs _audit/r16.3-recon/live-api.json _audit/r16.3-recon/case-selfshadow.json
```

## Qué NO es

- No es el panel vivo: la captura del navegador sí lo es; `capture.mjs` es su réplica offline.
- No usa fixtures inventados para el inventario: los datos salen del almacén real y del catálogo real.
- No modifica `center.json`, `knowledge.json`, la biblioteca del usuario ni ningún proyecto.
- No se guardan tokens, correos ni cuerpos de Skills.

## Limitaciones declaradas

- La captura corresponde al backend `contractVersion 2` / `implementation r16.2` servido tras
  el reinicio del 9/11; si el plugin cambia, hay que recapturarla.
- La réplica offline no tiene servicios del Host (`workspace-registry`, `sessions`, `loader`
  real): esas fuentes aparecen como `unavailable` con su motivo, salvo que se inyecten.
  Precisamente por eso R16.3 exige que `/api/inventory` reciba esos servicios cuando los hay.
- El saneado sustituye el prefijo por `<home>`; no reconstruye el nombre de usuario ni el
  disco original. Es suficiente para publicar, no para reejecutar sobre la máquina original
  sin volver a capturar.

## Fixture del catálogo (`catalog-snapshot.json`)

El catálogo del Host no se puede leer fuera del proceso, así que se inyecta un fixture **con procedencia declarada** en la clave `_provenance`:

- **8 filas `bundled`** (`office*` y `diagnose-windows-sandbox-acl`): catálogo virtual del Host tal como lo publica `skills.snapshot()`; sin `path`, porque el Host no lo entrega para builtins.
- **1 fila `lifecode-skill-center`**: la materializada ganadora, tomada de la captura real del navegador (`live-api.json`, entrada con `association.loadedByHost === true` y `path` en `materialized/plugins-dhs-7e085aaa/...`). Es la única fila añadida a mano; sin ella la réplica offline daría `true 8 / false 46 / null 31`, porque no habría ningún `path` que demostrara el match de la materializada ganadora.

La ruta de esa fila usa `<home>` para no fijar el perfil de una máquina; `capture.mjs` lo expande a `os.homedir()` al cargar el catálogo.

Comando exacto (sólo lectura; escribe dentro de `_audit/r16.3-recon/`):

```sh
node _audit/r16.3-recon/capture.mjs --catalog=_audit/r16.3-recon/catalog-snapshot.json --out=live-inventory-snapshot.json
```

Resultado esperado y verificado: 85 entradas, 8 colisiones (1 `legacy-collision` warn con `count` 46 + 7 `name-collision` warn), `ambiguous` 7, `byOwner {own:4,external:0,filesystem:73,host:8,unknown:0}` y reparto del tri-estado `loadedByHost {true:9,false:46,null:30}`.
