# R16.3 / T24 — Verificación independiente de coherencia

- **Fecha:** 2026-11-09 (árbol congelado a las 15:14 por core-wiring; no hubo cambios de `lib/`, `index.js` ni tests durante esta ronda)
- **Verificador:** `verify-r16` (T5), independiente de la implementación
- **Alcance:** los 9 puntos de `task-24` + los dos extra pedidos por el Lead (10 tri-estado `loadedByHost`, 11 `explanation` de `name-collision`)
- **Ficheros escritos en esta ronda:** `lifecode-skill-center/tests/r16-coherence.test.mjs` (nuevo, 12 pruebas) y este informe. No se escribió `tools/r16-coherence.mjs` (el fichero de pruebas ya demuestra cada invariante con código real; un tool habría duplicado la evidencia).
- **Datos reales:** intactos. Toda fixture vive en cajas `mkdtempSync`; la captura congelada se re-ejecutó **sólo a un fichero temporal** de `%TEMP%`, borrado al terminar.

## §1 Entregables

| Fichero | Contenido |
|---|---|
| `lifecode-skill-center/tests/r16-coherence.test.mjs` | 12 pruebas independientes (fixtures propias, sin copiar las de `r16-domain`/`r16-ui`), sobre `collectInventory`, `mergeHostWinners`, `detectCollisions`, `preflight`, `countOwners`, `buildProjectsPayload`, `buildProjectDetail` y las etiquetas de `client.js` |
| `_audit/r16-verify-r163.md` | este informe |

Ejecución aislada: `node --test tests/r16-coherence.test.mjs` ⇒ **12/12 pass, 0 fail, exit 0**.

## §2 Veredicto punto por punto

**Veredicto global: PASS en los 11 puntos. Sin defectos de producto.**

| # | Punto exigido | Veredicto | Evidencia (prueba / medición) |
|---|---|---|---|
| 1 | La suma de categorías de propietario es el total; `unknown` va aparte | **PASS** | `§7.1` — `countOwners([...])` con `lifecode/plugin/bundled/filesystem/host/undefined` ⇒ suma de `own+external+host+filesystem` = entradas conocidas, `unknown` cuenta las de `owner.kind` desconocido y **no** se suma a las demás. La captura congelada da `own 4 + external 0 + filesystem 73 + host 8 + unknown 0 = 85 = total` (ver §3). |
| 2 | Una Skill presente en varias fuentes no se duplica (una fila por identidad lógica, procedencias preservadas) | **PASS** | `§7.2` — disco `user-dsh` + snapshot del Host con el mismo nombre y la misma ruta de `SKILL.md` ⇒ `mergeHostWinners` deja **1** fila con `association.loadedByHost:true` (no 2). Y dos materializadas de proyectos distintos con el mismo nombre y mismo `contentSha256` ⇒ **2** filas legítimas, sin `name-collision` ni entradas en `ambiguousNames` (`isSameSkillAcrossProjects`, `lib/collisions.mjs:127-140`). |
| 3 | La identidad no se fusiona sin evidencia | **PASS** | `§7.3` — mismo `identity.uuid`, mismo nombre canónico y `contentSha256` **distinto** ⇒ `identity-duplicate` con `severity:'block'`; con el **mismo** hash y mismo nombre ⇒ ni `identity-duplicate` ni `content-collision` (`lib/collisions.mjs:225-255`). La captura real no presenta ningún `identity-duplicate`, coherente con `ambiguous:7` de solo `name-collision`. |
| 4 | Un proyecto sin inspeccionar no es un proyecto vacío | **PASS** | `§7.4` — `buildProjectsPayload` produce `inspection:{status:'not-run', inspectedAt:null, reason}` y `reasons` del estado, sin inventar `skills`/`counts`; `discovered` no lleva `inspection` (no se puede fingir). `§7.4b` — `client.js` rotula «sin inspeccionar» y no «ninguna»; las pruebas UI `r16-ui.test.mjs:1345/:1389` ya cubren que no se pintan ceros no verificados. |
| 5 | Fuente no disponible ≠ inventario vacío | **PASS** | `§7.5` — `collectInventory` con un snapshot que lanza: la fila `skills-registry` queda `unavailable`/`error` con su `reason`, `complete:false`, `warnings` con `skills-registry-unavailable`, y **las 2 entradas de disco siguen** en `entries`. No hay borrado por fallo de fuente. |
| 6 | Conflictos globales no atribuidos a todos los proyectos | **PASS** | `§7.6` — `buildProjectDetail` de p1 y p2 con una colisión que solo tiene filas de p1: p1 = 1 colisión, p2 = 0; una colisión global (sin `rows[].projectId` y con `key` ajeno) no aparece en ninguna ficha (`lib/projects.mjs:601-604`). |
| 7 | Filtros y conteos de colisiones particionan | **PASS** | `§7.7` — por `code` y por `severity` los subconjuntos suman el total, sin solape ni pérdida; los conteos de la captura (1 legacy + 7 name = 8) coinciden con el total de `collisions`. La UI real de filtros ya está cubierta en `r16-ui.test.mjs:1547` (contador `n de total`). |
| 8 | Los findings de preflight usan la severidad del motor | **PASS** | `§7.8` — para las mismas filas DTO: `name-collision` block ⇒ finding block; `content-collision` ⇒ finding **warn** siempre; `legacy-collision` ⇒ warn; `assignment-shadowed` ⇒ block solo en `materialize-project` y warn en `assign`/`enable` (`lib/preflight.mjs:225-271`). Coincide con `detectCollisions` y con la matriz `tools/r16-collision-matrix.mjs` (6/6). |
| 9 | `legacy-collision` agrupada: 1 por raíz con N filas, sin inflar el KPI | **PASS** | `§7.9` — 46 entradas de `/skill-compiler/projects/` con nombres distintos y el mismo `location.rootId` ⇒ **1** colisión `legacy-collision`, `severity:'warn'`, `count:46`, `rows.length:46`; **0** `name-collision` generadas por esas 46 y `ambiguousNames` sin ellas (`lib/collisions.mjs:504-525`). La captura congelada reproduce exactamente `legacy-collision=1, count=46`. |
| 10 | Tri-estado `loadedByHost` con los cinco casos | **PASS** | `§7.10` — `true` (match nombre+ruta ganadora); `false` por sombreado de **otro** proveedor (con `association.shadowedBy`); `false` por raíz `hostScanned:false` (reason `host-scan-out-of-scope`); `null` cuando el ganador es del mismo proveedor (reason `association-scope-global`); `null` sin evidencia de ámbito. Las filas propias nunca pasan a `false` por otra copia propia. Captura: `true=9 / false=46 / null=30`. |
| 11 | `explanation` de `name-collision` nombra procedencias distintas sin repetir etiqueta | **PASS** | `§7.11` — colisión entre `user-dsh` y `compiler-projects`: la explicación cita «biblioteca de usuario» y «compilador anterior», cada etiqueta **una vez**, y no repite el mismo label; `describeProvenance` añade la ruta solo cuando la etiqueta se repite (`lib/collisions.mjs:336-347`). |

### Correspondencia con los puntos 1-9 de `task-24`

1. suma de categorías = total → §7.1 · 2. dedupe multi-fuente → §7.2 · 3. identidad sin fusión → §7.3 · 4. no inspeccionado ≠ vacío → §7.4/§7.4b · 5. fuente no disponible ≠ vacío → §7.5 · 6. conflictos globales no atribuidos → §7.6 · 7. filtros/conteos → §7.7 · 8. severidades motor↔preflight → §7.8 · 9. legacy agrupada → §7.9. Extras 10 → §7.10, 11 → §7.11.

## §3 Reproducción independiente de la captura congelada

Comando ejecutado (desde la raíz del repo, salida a `%TEMP%`, borrada después):

```powershell
node _audit/r16.3-recon/capture.mjs --catalog=_audit/r16.3-recon/catalog-snapshot.json --out=$env:TEMP\r163-check-<guid>.json
```

`exit 0`. Lectura del JSON resultante (`inventory.body`, HTTP 200):

| Métrica | Declarada por core-wiring | Medida en esta ronda | Coincide |
|---|---|---|---|
| `entries` | 85 | **85** | ✅ |
| `complete` | `true` | **`true`** | ✅ |
| `collisions` totales | 8 | **8** | ✅ |
| `legacy-collision` | 1, warn, `count:46` | **1, warn, count=46, rows=46** | ✅ |
| `name-collision` | 7, warn | **7** | ✅ |
| `summary.ambiguous` | 7 | **7** | ✅ |
| `summary.invalidNames` / `shadowed` | — | **0 / 0** | ✅ |
| `byOwner` | own 4, external 0, filesystem 73, host 8, unknown 0 | **4 / 0 / 73 / 8 / 0** (suma 85) | ✅ |
| `association.loadedByHost` | true 9 / false 46 / null 30 | **9 / 46 / 30** | ✅ |

No se regeneró ningún artefacto del repo: la única escritura fue el JSON temporal. El estado real de `~/.dsh` no se tocó (lo confirma `tests/check-hermetic.mjs`).

## §4 Gates (árbol congelado, esta ronda)

| Gate | Comando | Exit | Conteo / resultado |
|---|---|---|---|
| Suite completa | `node --test` | **0** | **783/783 pass**, 0 fail (771 congelados + 12 del fichero nuevo), 7.2 s |
| Coherencia aislada | `node --test tests/r16-coherence.test.mjs` | **0** | **12/12 pass** |
| Check de instalación/pureza | `node tools/check.mjs` | **0** | **393/393** (392 congelados + 1 por el test nuevo) |
| E2E base | `node tools/e2e.mjs` | **0** | **19/19 PASS**, 0 FAIL; almacén real sin cambios (`_audit/E2E-REPORT.md`) |
| E2E autónomo | `node tools/e2e-autonomous.mjs` | **0** | **26/26 PASS**, almacén real intacto |
| Mutación | `node tools/mutation.mjs` | **0** | **16/16** (críticos **13/13**, 100%) |
| Cobertura | `node tools/coverage.mjs` | **0** | «Suite en verde»; línea **96.15 %**, rama **76.86 %**, funciones **84.2 %** (`_audit/COBERTURA.md`) |
| Hermético | `node tests/check-hermetic.mjs` | **0** | 173 ficheros de `~/.dsh/skills` intactos; la suite corrió sin tocar nada real |
| Matriz de colisiones | `node tools/r16-collision-matrix.mjs` | **0** | **6/6** códigos con severidad/decisión esperadas |
| E2E R16 | `node tools/r16-e2e.mjs` | **0** | **9/9 PASS**, 0 SKIP, 0 FAIL |
| Routing R16.2 | `node tools/r16-routing.mjs` | **0** | **18/18 PASS** (13 backend + 5 modos de render, incluido `auth`) |
| Testquality | `node tools/testquality.mjs` | **1** (preexistente) | 1 alta / 27 media / 13 baja; la alta sigue siendo `tests/state.test.mjs:144` (`nombre/promete-atomicidad`). **No forma parte de R16.3 y no se tocó.** |

## §5 Defectos

**Ninguno de producto en R16.3.** No se encontró ninguna incoherencia entre motor, payloads, preflight y captura.

Salvedades (no defectos, declaradas para que el informe final no las cuente como PASS rotundo):

- **S1 — testquality rojo preexistente.** `exit 1` por la misma alta de `tests/state.test.mjs:144` documentada desde R16.1; sin relación con coherencia ni con R16.3. Se documenta y no se toca, según la tarea.
- **S2 — deltas de conteo esperados.** 783 vs 771 y 393 vs 392 son exactamente el fichero nuevo (12 pruebas, 1 comprobación de check). No es una divergencia del árbol congelado.
- **S3 — punto 4 sin render dinámico.** La etiqueta «sin inspeccionar» se verificó por lectura de la cadena de `client.js` dentro de la prueba y por las pruebas UI existentes; no se montó un render `node:vm` del panel en esta ronda. El payload sí se verifica de punta a punta.
- **S4 — captura sobre fixture congelada.** Se reprodujo la captura con el `catalog-snapshot.json` congelado (determinista), no contra el navegador vivo. Es lo que exige el punto: verificar la coherencia del motor, no el entorno del Host.
- **S5 — `legacy-collision` sigue siendo warn.** 46 filas del compilador anterior quedan agrupadas en 1 aviso; no bloquean, y así está en el contrato §3/§4 y en la matriz. Coherente, aunque el informe final debe decir que ese histórico sigue visible como warn, no como error.

## §6 Qué no prueba este informe

- No re-ejecuta la captura contra el proceso DSH vivo del navegador (fuera del alcance de T24; la referencia histórica es `_audit/r16.3-recon/live-api.json`).
- No prueba concurrencia de dos procesos sobre el mismo almacén (cubierto en `tests/r16-contract.test.mjs` de rondas anteriores).
- No valida visualmente el panel renderizado; la coherencia de etiquetas del cliente se apoya en las pruebas UI ya existentes, citadas.

## §7 Comandos de reproducción

```powershell
cd C:\xampp\htdocs\plugins-dhs\lifecode-skill-center
node --test tests\r16-coherence.test.mjs
node --test
node tools/check.mjs
node tools/r16-collision-matrix.mjs
node tools/r16-routing.mjs
node tools/r16-e2e.mjs
node tests/check-hermetic.mjs

cd C:\xampp\htdocs\plugins-dhs
node _audit/r16.3-recon/capture.mjs --catalog=_audit/r16.3-recon/catalog-snapshot.json --out=$env:TEMP\r163-check.json
```
