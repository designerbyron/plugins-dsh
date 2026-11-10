# R17 — Gates finales del Lead

> Batería ejecutada por el Lead sobre el árbol congelado, con exit codes reales.
> Log completo: [`r17-final-gates.log`](r17-final-gates.log). Runner reproducible: [`r17-run-gates.mjs`](r17-run-gates.mjs).
> Fecha: 2026-11-09 19:47–19:51 (America/Managua).

## 1. Snapshot medido

| Dato | Valor |
|---|---|
| HEAD | `3b295106e5263858c32bd4db4c110068a4bad687` |
| Rama | `feature/visual-operation-feedback` |
| `git status --porcelain -uall` | **1 440** entradas (36 ` M` + 1 404 `??`, 0 borrados) |
| `client.js` | 512 924 B (baseline R17: 454 594 B, **+12,8 %**) |
| `lib/activity.mjs` (nuevo) | 16 899 B |
| `lib/api.mjs` | 196 852 B |
| `index.js` | 31 694 B |
| Almacén real `center.json` | `9704ee160de8466a4ab6c99cae63b4279b6b5b49a67c1997019ff81b1aea28cc`, 52 063 B |
| Biblioteca de usuario | 173 ficheros intactos |

Sin `git add`, sin commit, sin push, sin reset/clean: sólo lectura de Git y de los almacenes.

## 2. Tabla de gates

| Gate | Resultado | Exit | Notas |
|---|---|---|---|
| `node --test` (suite completa) | **896/896 pass, 0 fail, 0 skipped** | 0 | 8 988 ms · 603 base + 293 `r16-*`/`r17-*` |
| `tools/check.mjs` | **411/411** | 0 | 6 926 ms · estático: manifiesto, sintaxis, pureza de `lib/`, UI por regex |
| `tools/e2e.mjs` | **19/19 PASS** | 0 | almacén real IDÉNTICO: `center.json` `9704ee16…`→`9704ee16…`, 52 063 B, 16 ficheros, 10 dirs, huella de árbol `9c5e849f992191a…` |
| `tools/e2e-autonomous.mjs` | **26/26 PASS** | 0 | incluye importación con `confirmed:true` y política fijada por persona |
| `tools/mutation.mjs` | **16/16 (100 %)**, críticos **13/13** | 0 | 151 669 ms |
| `tools/coverage.mjs` | línea **95,71 %** · rama **76,76 %** · funciones **83,37 %** (31 ficheros) | 0 | ver §4: oscilación entre pasadas |
| `tests/check-hermetic.mjs` | **896 pass** + **16** ficheros del centro + **173** de biblioteca intactos | 0 | 9 926 ms |
| `tools/r16-collision-matrix.mjs` | **6/6** | 0 | los 6 códigos con severidad correcta |
| `tools/r16-e2e.mjs` | **9/9 PASS**, 0 SKIP | 0 | ciclo completo del contrato R16 |
| `tools/r16-routing.mjs` | **18/18 PASS** | 0 | 13 checks de backend + 5 modos de compatibilidad del panel |
| `tools/r16-portability.mjs` | **29/29 PASS** | 0 | paquete, conflicto, no-escritura, original intacto |
| `tools/r17-perf.mjs` | **11/11 PASS** | 0 | escribe `r17-perf-after.json` |
| `tools/testquality.mjs` | **exit 1 PREEXISTENTE** | 1 | 1 alta (`tests/state.test.mjs:144`), 30 media, 13 baja · **ninguna alta nueva de R17** |

**Lectura del rojo:** `testquality.mjs` ya estaba rojo en la línea base de R16 (`_audit/r16-baseline-gates.md`: 1 alta/27 media/9 baja) y sigue en la misma única alta, en un test preexistente. No es una regresión de R17 y no se silenció: queda declarado aquí y en `R17-ACTIVITY-ACCEPTANCE.md`.

## 3. Composición de la suite (896)

| Bloque | Pruebas |
|---|---|
| Base previa a R16 | 603 |
| R16 (domain 28, api 28, ui 50, contract 42, security 10, e2e-sim 3, runtime 12, routing 9, coherence 12, bundle 14, bundle-contract 15) | 223 |
| R16.4.2 (verificador post-importación) | 14 |
| R17 (activity 15, api-activity 11, ui 17, contract 7, events 9, ux 7) | 66 |
| Otros (client/render/distribute-ui/state/… actualizados por R17) | resto |

Los 23 tests del verificador R17 (`r17-contract`, `r17-events`, `r17-ux`) están incluidos en los 896 y no tocan producto.

## 4. Diferencia de cobertura entre pasadas

`coverage.mjs` mide un árbol que incluye tests nuevos y su propia instrumentación: entre pasadas de la misma tarde dio **96,54 / 76,77 / 83,37** (verify-r16, 19:43) y **95,71 / 76,76 / 83,37** (Lead, 19:50). La oscilación (~0,8 pp de línea) no cambia ninguna conclusión y no hay pérdida de cobertura de producto; el umbral del proyecto no se rebasó. Se declara en lugar de fijar un número que no es estable.

## 5. Presupuesto de rendimiento (R17-A)

Medido por `tools/r17-perf.mjs` (11/11) contra `_audit/r17-perf-baseline.json`:

| Métrica | Antes | Después | Veredicto |
|---|---|---|---|
| `client.js` | 454 594 B | 512 924 B | +58 330 B (**+12,8 %**), bajo los topes de +60 KB y +20 % |
| `lib/api.mjs` | 189 722 B | 196 852 B | +7 130 B |
| Ficheros de `lib/` | 28 | 29 (`activity.mjs`) | +1, sin dependencias npm |
| `fetch` en cliente | 12 | 13 | la consulta del drawer, bajo demanda |
| `setInterval` en cliente | 1 (preexistente, `client.js:6888`, refresh 20 s con skip en pestaña oculta) | 1 | **cero polling nuevo** |
| `setTimeout` / `requestAnimationFrame` | 2 / 0 | 2 / 0 | sin timers nuevos |
| Peticiones al arrancar | 0 | 0 | PASS |
| Peticiones en inactividad | 0 | 0 | PASS |
| Consultas al abrir el drawer | — | 1 | PASS |
| Consultas con el drawer cerrado | — | 0 | PASS |
| Abrir/cerrar 20 veces | — | 1 consulta, 0 listeners acumulados | PASS |
| Timers largos / intervalos de backend | 0 / 0 | 0 / 0 | PASS |

## 6. Integridad

- `center.json`: `9704ee16…` antes y después de toda la batería; 52 063 B; 16 ficheros; 10 directorios; huella `9c5e849f992191a…`.
- Biblioteca `~/.dsh/skills`: 173 ficheros intactos (hermetic).
- Política `guarded-autonomous` de `plugins-dhs-7e085aaa`: sin cambios (verificado en el e2e autónomo y en `knowledge.json`, `e028af3a…`).
- `MEMORY.md`, `skill-compiler/` (14 entradas preexistentes), proyectos productivos y backups: no tocados.
- Los gates abren sus propias cajas temporales; el almacén real se mide antes/después y coincide.

## 7. Lo que estos gates NO prueban

- **El panel vivo**: la app en ejecución sirve un módulo de servidor anterior a R17 (`/api/activity` dará 404 hasta reiniciar). Los gates prueban el árbol, no la instancia viva. Procedimiento y criterios: [`R17-ACTIVITY-ACCEPTANCE.md`](R17-ACTIVITY-ACCEPTANCE.md).
- **Notificaciones nativas del sistema o con el panel cerrado**: el Host no ofrece ese contrato; quedó fuera de alcance (Nivel 3) y se declara en [`R17-LIGHTWEIGHT-ARCHITECTURE-REPORT.md`](R17-LIGHTWEIGHT-ARCHITECTURE-REPORT.md).
- **Autenticidad del paquete** importado: sin firma ni cifrado; el checksum detecta corrupción, no suplantación.
- **DOBLE instancia**: el e2e cubre una instancia; no se simuló un segundo proceso sirviendo el mismo centro.
- **Aceptación estética humana**: las capturas `r17-after-*.png` son renders `node:vm` del `client.js` real, no capturas del GUI.

## 8. Reproducción

```sh
cd lifecode-skill-center
node --test
node tools/check.mjs
node tools/e2e.mjs
node tools/e2e-autonomous.mjs
node tools/mutation.mjs
node tools/coverage.mjs
node tests/check-hermetic.mjs
node tools/r16-collision-matrix.mjs && node tools/r16-e2e.mjs && node tools/r16-routing.mjs && node tools/r16-portability.mjs
node tools/r17-perf.mjs
node tools/testquality.mjs   # rojo preexistente declarado
# o la batería completa del Lead:
node ../_audit/r17-run-gates.mjs
```
