# R16 — Gates finales del árbol de trabajo

Fecha de medición: **2026-11-09, 12:20–12:30 (America/Managua)**.
Árbol congelado durante la medición: no se editó código entre pasadas; sólo se
escribieron ficheros de `_audit/`.

- `HEAD`: `3b295106e5263858c32bd4db4c110068a4bad687` (sin commit, sin staging: §13).
- Rama: `feature/visual-operation-feedback`.
- Estado del árbol al cerrar: 1303 entradas en `git status --porcelain -uall`
  (línea base: 1214). 36 ficheros rastreados modificados (los 35 preexistentes del
  baseline + `lifecode-skill-center/lib/sources.mjs`), 1267 no rastreados (los 1214
  del baseline + 53 nuevos de R16), **0 borrados inesperados**.
- Los 92 candidatos del compilador y las 14 entradas preexistentes de
  `skill-compiler/` siguen intactos: `skill-compiler/` no se tocó en R16 (sus 9
  ficheros modificados son del baseline).
- `MEMORY.md` no se modificó.

Registro crudo de esta pasada: `_audit/r16-final-gates.log`. Salidas completas de
cada comando en `_audit/tmp-<gate>.txt` (no versionadas como entregable; se pueden
borrar sin perder el informe).

## 1. Comparación contra la línea base

Línea base: `_audit/r16-baseline-gates.md` (medida antes de tocar código, mismo
árbol, 2026-11-09 ~11:38).

| Gate | Comando | Línea base | Final R16 | Exit final |
|---|---|---|---|---|
| Suite unitaria/integración | `node --test` | 603/603 | **699/699** | 0 |
| Chequeos estáticos | `node tools/check.mjs` | 359/359 | **388/388** | 0 |
| E2E humano | `node tools/e2e.mjs` | 19/19 | **19/19** | 0 |
| E2E autónomo | `node tools/e2e-autonomous.mjs` | 26/26 | **26/26** | 0 |
| Mutación (críticos) | `node tools/mutation.mjs` | 13/13 | **13/13 (100 %)** | 0 |
| Mutación (total) | `node tools/mutation.mjs` | 16/16 | **16/16 (100 %)** | 0 |
| Cobertura | `node tools/coverage.mjs` | 95,9 % / 76,4 % / 81,9 % | **95,27 % / 76,58 % / 83,44 %** | 0 |
| Calidad de pruebas | `node tools/testquality.mjs` | exit 1 (1 alta/27 media/9 baja) | **exit 1 (1 alta/27 media/13 baja)** | 1 (preexistente) |
| Hermético | `node tests/check-hermetic.mjs` | 603/603, 14+173 intactos | **699/699, 14+173 intactos** | 0 |
| Matriz de colisiones R16 | `node tools/r16-collision-matrix.mjs` | no existía | **6/6 códigos** | 0 |
| E2E simulado R16 | `node tools/r16-e2e.mjs` | no existía | **9/9 pasos, 0 skip** | 0 |

Lectura de la comparación:

- Las **603 pruebas históricas siguen pasando**; las 96 nuevas son 22 de dominio
  (`tests/r16-domain.test.mjs`), 17 de UI (`tests/r16-ui.test.mjs`), 16 de API
  (`tests/r16-api.test.mjs`), 28 de contrato (`tests/r16-contract.test.mjs`), 10 de
  seguridad (`tests/r16-security.test.mjs`) y 3 de E2E simulado
  (`tests/r16-e2e-sim.test.mjs`). Los dos ficheros de `tools/` son gates de
  ejecución, no pruebas de `node --test`.
- Cobertura: la línea baja 0,63 puntos porque entran ~1 400 líneas nuevas de
  decisión (`inventory`, `collisions`, `preflight`, `projects`, rutas HTTP); rama y
  funciones **suben**. El umbral de cobertura del proyecto se cumple.
- `testquality.mjs` **ya estaba en rojo antes de R16** por un hallazgo alto
  preexistente en `tests/state.test.mjs:144`; los 4 hallazgos nuevos son de
  severidad baja (3 `catch` de pruebas de contrato y el `t.skip` justificado del
  junction en Windows) y están listados abajo.
- La intermitencia medida en la línea base (`tests/concurrency.test.mjs:37` falló 1
  de 3 pasadas) no reapareció en las pasadas finales: suite y hermético en verde en
  todas las ejecuciones de esta sesión.

## 2. Evidencia de integridad del almacén real

| Comprobación | Antes | Después |
|---|---|---|
| `~/.dsh/lifecode-skill-center/center.json` sha256 | `d431f76337f236486245af563775ae18036311f87559b11ff08a885d9375dfce` | **igual** |
| Tamaño / mtime | 44 522 B / 2026-11-09T07:01:55Z | igual |
| Proyectos / skills / schema | 3 (`plugins-dhs-7e085aaa`, `proyecto-b-47c64e02`, `proyecto-b-movido-3fa000d0`) / 7 / 2 | igual |
| Árbol del centro | 14 ficheros, 9 dirs, huella `7097912d2e5003ca` | igual |
| Biblioteca de usuario `~/.dsh/skills` | 173 ficheros | **173 ficheros intactos** |
| `knowledge.json` → `policy.projects['plugins-dhs-7e085aaa']` | `{mode:'guarded-autonomous', by:'human', updatedAt:'2026-11-09T15:51:58.864Z'}` | **intacta** |

`tools/e2e.mjs` y `tests/check-hermetic.mjs` comparan estas huellas dentro de la
propia suite: un cambio real del almacén hace fallar el gate, no se declara verde.

## 3. Matriz de colisiones (gate nuevo)

`node tools/r16-collision-matrix.mjs` — exit 0:

| Código | Severidad esperada | Decisión de preflight | Obtenido |
|---|---|---|---|
| `identity-duplicate` | block | block | block/block |
| `name-collision` | block | block | block/block |
| `path-collision` | block | block | block/block |
| `content-collision` | warn | warn | warn/warn |
| `assignment-shadowed` | warn (lectura) / block (materializar) | warn / block | warn/block |
| `legacy-collision` | warn | warn | warn/warn |

La matriz usa la salida **real** de `detectCollisions` sobre fixtures de
`_audit/r16-sources/`, no tablas escritas a mano.

## 4. E2E simulado del ciclo de vida (gate nuevo)

`node tools/r16-e2e.mjs` — exit 0, 9/9 pasos:

1. descubrir no registra; 2. preflight de registro `allow`; 3. registro crea
`proyecto-726eb2e4` con uuid + manifiesto; 4. ficha de dominio coincide con la
lista (`healthy`, `sessions.count:null`); 5. `inspect-project` 200 con ficha y 404
`project-not-found`; 6. materializar con `name-collision` ⇒ 409
`preflight-blocked` con findings; 7. el bloqueo **no escribió** la vista; 8. al
quitar el bloqueo materializa 1 fichero; 9. el proyecto externo queda idéntico
(sha256 `24f6e887…`).

El almacén temporal del E2E pasa de 0 ficheros (`e3b0c442…`) a 3
(`a26471a9…`): todo lo escrito vive en la caja temporal, no en el centro real.

## 5. Hallazgos de `testquality.mjs` (rojo preexistente, no regresión)

- **Alta (1, preexistente, no de R16)**: `tests/state.test.mjs:144`.
- Media (27): todas preexistentes.
- Baja (13): 9 preexistentes + 4 nuevas de R16, todas justificadas:
  - `tests/r16-contract.test.mjs:651` — `t.skip` del caso junction cuando Windows
    no permite crearla (el caso se ejerce en `tests/r16-api.test.mjs` cuando sí).
  - `tests/r16-contract.test.mjs:659`, `:667` — `catch` que sólo comprueba que la
    operación no deja escritura; la aserción fuerte (hash del árbol) va aparte.
  - `tools/e2e.mjs:634` — preexistente del baseline (aserciones sobre texto).
- No se silenció ni se modificó el analizador para ponerlo en verde: se documenta
  como deuda preexistente, igual que en la línea base.

## 6. Lo que estos gates NO prueban

- **El panel vivo**. El GUI sigue sirviendo el bundle anterior: los cambios de
  `index.js`/`lib/` necesitan **reinicio de la aplicación** y eso es una acción
  humana (§13 no permite reiniciar/desplegar por mi cuenta). Las capturas DESPUÉS
  son el `client.js` real evaluado en `node:vm` con React mínimo y fixtures
  (`_audit/r16-render.mjs`), no una captura del proceso vivo; está declarado en
  `_audit/r16-after-captures.md` y en `R16-UX-UI.md`.
- **Un navegador real**. La coherencia responsive se mide sobre las reglas CSS
  (`tests/styles.test.mjs` 4/4) y sobre el render a 1440/1024 px, no con un
  navegador instrumentado.
- **Publicar/asignar end-to-end**. El gate HTTP end-to-end se demuestra en
  `register-project` y `materialize-project`; para `publish`/`assign` el preflight
  está probado a nivel de dominio (`tests/r16-domain.test.mjs`) y de API
  (`tests/r16-api.test.mjs`), no con una sesión de Host completa.
- **Fuentes fuera de `DSH_HOME`**. `hermes-legacy` se declara no disponible; no se
  lee. El asar es opaco. No hay evidencia de aplicación real de una skill
  (`machine_verified` sigue sin implementarse, como en rondas anteriores).

## 7. Reproducción

```powershell
cd C:\xampp\htdocs\plugins-dhs\lifecode-skill-center
node --test
node tools/check.mjs
node tools/e2e.mjs
node tools/e2e-autonomous.mjs
node tools/mutation.mjs          # ~131 s
node tools/coverage.mjs
node tools/testquality.mjs       # exit 1 conocido (hallazgo alto preexistente)
node tests/check-hermetic.mjs
node tools/r16-collision-matrix.mjs
node tools/r16-e2e.mjs
cd ..
node _audit/r16-render.mjs       # capturas DESPUÉS reproducibles
```
