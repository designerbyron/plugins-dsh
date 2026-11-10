# R16.4 — Verificación independiente de portabilidad de Skills (T30)

**Verificador:** verify-r16 · **Ronda:** T30 (task-30 rev.2) · **Fecha:** 2026-11-09
**Árbol:** congelado por el Lead para la verificación; el informe se cierra con la batería final pendiente
del último cambio de UI (T34), según la instrucción de esperar «ÁRBOL CONGELADO».
**Alcance escrito (sólo estos tres ficheros):**
`lifecode-skill-center/tests/r16-bundle-contract.test.mjs` (nuevo),
`lifecode-skill-center/tools/r16-portability.mjs` (nuevo) y este informe.
No se tocó `lib/`, `index.js`, `client.js`, `package.json`, datos reales ni `_audit/*.md` existentes.

---

## 1. Entregables y estado

| Fichero | Contenido | Estado medido |
|---|---|---|
| `lifecode-skill-center/tests/r16-bundle-contract.test.mjs` | 15 pruebas de contrato R16.4 §7 con código real, dos centros temporales, handler montado y `handleApiRequest` directo | `node --test tests/r16-bundle-contract.test.mjs` ⇒ **15/15 pass, exit 0** |
| `lifecode-skill-center/tools/r16-portability.mjs` | 29 comprobaciones reales sobre `lib/distribute.mjs` + `lib/state.mjs`: exportar, leer, importar entre dos centros, procedencia, conflictos, límites y cero escritura externa | `node tools/r16-portability.mjs` ⇒ **29/29 PASS, exit 0** |
| `_audit/r16-verify-r164.md` | este informe | — |

No se usó `~/.dsh`: todas las raíces son `mkdtempSync`; el script imprime al final que el almacén real no se usó.

---

## 2. Veredicto por punto (task-30, 20 puntos)

| # | Punto | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Exportar e importar una Skill propia en centro temporal | PASS | test §7.1-3; tool pasos 1-6 |
| 2 | Transferencia entre DOS centros con hash del original antes/después | PASS | test §7.1-3 compara `treeDigest`/`centerFile` del origen; tool ídem |
| 3 | Paquete válido: forma completa | PASS | test §7.3 (identidad, compatibilidad, integridad, conflictos, plan, preflight, checksum, schema) |
| 4 | Corrupto / JSON malformado | PASS | test §7.4-6: `{ roto` y objeto sin schema ⇒ 400 `invalid-bundle` |
| 5 | `schemaVersion` incompatible | PASS | test §7.4-6: `2` y `"2"` ⇒ 400 `unsupported-schema` (y salvedad §4: `"1"` se coacciona con `Number`) |
| 6 | Checksum inválido | PASS | test §7.4-6: cuerpo alterado ⇒ 400 `checksum-mismatch` |
| 7 | Identidad duplicada (mismo id) ⇒ sin escritura sin confirmación | PASS | test §7.7-8 (`conflicts.sameId`, `saved:false`, digest igual); test §7.4 (`confirmed` ausente ⇒ 400 `confirmation-required`) |
| 8 | Nombre duplicado | PASS | test §7.7-8: `sameName:[{id:'otra-skill',title:'Demo Skill'}]`, `nameInUse:true`, importa con su id sin tocar la homónima |
| 9 | Importación repetida ⇒ `already-imported` | PASS | test §7.9: segunda y tercera (tras remount) ⇒ `already-imported`, sin segunda escritura |
| 10 | No sobrescritura de la skill existente | PASS | test §7.7-8 y §7.10: original conserva versión/contenido; la copia es un id nuevo |
| 11 | No activación automática | PASS | test §7.11-12: sin asignaciones nuevas, sin política concedida, `registerProvider` una sola vez |
| 12 | No asignación automática | PASS | test §7.11-12: `assignments` vacío en destino |
| 13 | No escritura fuera de `root`/`exports` (refs `../`, absolutas) | PASS | test §7.13: 400 `invalid-references`, árbol externo idéntico; ruta absoluta en contenido ⇒ warning `absolute-path`, sin escritura |
| 14 | Recuperación ante interrupción/fallo de escritura | PASS | test §7.14: obstáculo real + `writeFile` inyectado con EACCES ⇒ `bundle-write-failed`, sin estado parcial, almacén legible y reintento correcto |
| 15 | Auditoría/trazabilidad (origen + checksum) | PASS | test §7.15: `origin.bundleChecksum/originalSkillId/originalVersion/importedAt` y evento `skill-imported` en `center.json`, sobreviven a `loadState` |
| 16 | `inspect-bundle` read-only | PASS | test §7.16: digest de centro y árbol idénticos antes/después, incluso con preview bloqueado |
| 17 | `preflight` block ⇒ cero escritura | PASS | test §7.17: dos materializados homónimos ⇒ 409 `preflight-blocked` con findings/reasons/evidence y `center.json`+árbol idénticos |
| 18 | Límite 512 KiB | PASS | test §7.18: lectura y `writeBundle` ⇒ `bundle-too-large`; no se crea `exports/` |
| 19 | Aviso `possible-secret` sin bloqueo | PASS | test §7.19: warning en `portability.warnings`, `portable:true`, no bloquea la vista previa; la importación sí la rechaza por la compuerta de calidad (salvedad §4) |
| 20 | Panel: pruebas UI + render `node:vm --html-only` | PASS | `node _audit/r16-render.mjs --html-only` ⇒ exit 0; nota de compuerta presente en `preview`/`conflict`/`done`; pruebas T34 en `tests/r16-ui.test.mjs:1883` (nota), `:1890` (sólo `copy` ofrece «Crear copia»), `:1922` (`evaluation-failed` muestra código y ningún éxito), `:1951` (renombrado una sola vez); capturas `preview` 110 596 B, `conflict` 114 545 B, `done` 107 987 B |

**Conclusión:** 20/20 puntos verificados con código real y cajas temporales; **ningún defecto de producto**.
El único gate rojo de la batería final era una **herramienta de verificación desactualizada**
(`tools/e2e-autonomous.mjs:436`), ya resuelta por el Lead sin tocar producto: **26/26 exit 0** (§7).

---

## 3. Triaje de los 5 fallos del primer run (evidencia de triaje)

El primer `node --test tests/r16-bundle-contract.test.mjs` dio **10 pass / 5 fail**. Los cinco fallos eran
**expectativa o fixture del test**, no defectos de producto. Tabla literal del triaje (el TAP completo no se
archivó; se conservan las líneas `AssertionError [ERR_ASSERTION]` y el esperado/actual de cada uno):

| Test (línea actual) | Acción/payload | Esperado en el test | Actual del backend | Clasificación |
|---|---|---|---|---|
| §7.3 (L248, assert L285) | `inspect-bundle` en el **mismo** centro que contenía la skill | `preview.conflicts.sameId.exists === false` | `true` (la identidad duplicada es real en ese centro) | **Fixture del test**: se inspecciona en el centro destino vacío |
| §7.4-6 (L325) | `schemaVersion:'1'` | 400 `unsupported-schema` | 200 (`Number('1')===1`) | **Expectativa del test**: el contrato documenta la coerción; se cambió a `'2'` con comentario |
| §7.7-8 (L365, assert L403) | `inspect-bundle` de paquete con `title` distinto del que usaba el fixture local | `sameName` con una fila | `[]` | **Fixture del test**: título tomado del JSON exportado (`JSON.parse(exported.json).skill.title`) |
| §7.14 (L580, assert L594) | exportar sobre `exports/<id>.json` que es DIRECTORIO | `bundle-write-failed` | `bundle-exists` (Windows: `wx` sobre directorio ⇒ EEXIST) | **Expectativa del test**: EEXIST⇒`bundle-exists` es contrato; se aceptan ambos y se añadió `writeFile` EACCES ⇒ `bundle-write-failed` |
| §7.19 (L678, assert L698) | `import-bundle` de paquete con `api_key = "..."` | `imported:true` | `ok:false`, `evaluation-failed`, `evaluation.checks[{code:'secret.assignment',severity:'block'}]` | **Test se pasaba de alcance**: el contrato sólo pide warning no bloqueante en la vista previa; la compuerta de calidad al importar es otro control (salvedad §4) |

Tras corregir **sólo** `tests/r16-bundle-contract.test.mjs`: **15/15 pass, 0 fail, exit 0** (407 ms).

---

## 4. Salvedades declaradas (no defectos)

1. **La vista previa no evalúa la compuerta de calidad.** `inspect-bundle` calcula portabilidad/warnings
   (`possibleSecretWarnings`, `lib/distribute.mjs:102`) y puede devolver `preflight.decision:'allow'` para un
   paquete con un secreto evidente. La importación **sí** aplica la compuerta fail-closed
   (`lib/evaluate.mjs:29`): `200 {ok:false, code:'evaluation-failed', evaluation.checks:[{code:'secret.assignment', severity:'block'}]}`
   y **cero escritura**. La UI debe anunciarlo (T34, nota honesta + códigos). Queda verificado el backend.
2. **`schemaVersion` en texto numérico.** `readBundle` compara con `Number(...)` (`lib/distribute.mjs:294`):
   `"1"`/`1.0` se aceptan; `"2"`/`2` ⇒ 400 `unsupported-schema`. Está documentado en
   `_audit/R16.4-PACKAGE-PORTABILITY.md:380-382`; no es defecto.
3. **`bundle-exists` vs `bundle-write-failed`.** `flag:'wx'` sobre un directorio existente produce EEXIST en
   Windows y el código lo rotula `bundle-exists`; no hay sobrescritura ni pérdida. El fallo real de escritura
   (EACCES inyectado) sí da `bundle-write-failed`.
4. **Tamaño de la vista previa.** El «tamaño» del preview es la re-serialización canónica, no los bytes del
   fichero (hueco G14 ya declarado en `_audit/R16.4-PACKAGE-PORTABILITY.md:333-334`).
5. **Sin firma/cifrado.** El checksum cubre `{body,description,whenToUse,tags}`; autenticidad y
   confidencialidad no están garantizadas (declarado en el contrato y en la aceptación §3).
6. **`identity-adopt/repair/identity-unlink`** pasan por `identityActionGate` (identidad v3): hueco declarado y
   aceptado fuera de R16.4; no se cuenta como defecto de esta ronda.

---

## 5. Panel (punto 20) y pruebas UI existentes

- `node _audit/r16-render.mjs --html-only` (raíz del repo, árbol congelado tras T34) ⇒ **exit 0**. Variantes
  de portabilidad emitidas y validadas por las aserciones del render (ficheros en `_audit/r16-capture/`):
  `render-portability-collapsed.html` 30 325 B · `preview.html` 35 359 B · `conflict.html` 35 664 B ·
  `done.html` 35 758 B. La nota «La compuerta de calidad se evalúa al importar; si rechaza el contenido, no
  se creará ninguna copia» aparece en `preview`, `conflict` y `done` (1 ocurrencia por estado; el HTML
  guardado muestra mojibake de acentos por codificación del volcado, el árbol de React se verifica en la
  prueba UI).
  El render exige: sección plegada sin importador; validar ⇒ `inspect-bundle` y **no** `import-bundle`;
  conflicto ⇒ «Identidad duplicada» + «Crear copia con otro id» sin importar; éxito ⇒ id creado, «Renombrada
  desde», «Abrir en Biblioteca» y `confirmed:true` exactamente una vez.
- Pruebas UI de portabilidad: `node --test tests/r16-bundle-contract.test.mjs tests/r16-ui.test.mjs` ⇒
  **65/65 pass** (15 mías + 50 de UI). T34: `tests/r16-ui.test.mjs:1883` (nota de compuerta),
  `:1890` («Crear copia con otro id» sólo con `sameId.exists` y `plan.action==='copy'`; no en
  `already-imported`/`blocked`), `:1922` (`evaluation-failed` muestra el código y ningún éxito),
  `:1951` (renombrado avisado una sola vez). Capturas regeneradas: `r16-after-portability-preview.png`
  110 596 B · `-conflict.png` 114 545 B · `-done.png` 107 987 B.

---

## 6. Gates finales (árbol congelado tras T34, 2026-11-09)

| Gate | Resultado | Exit |
|---|---|---|
| `node --test` (suite completa) | **826/826 pass, 0 fail** (7.5 s) | **0** |
| `node tools/check.mjs` | 398/398 comprobaciones | **0** |
| `node tools/e2e.mjs` | 19/19 PASS; almacén real `d431f763…` → `d431f763…` SIN CAMBIOS | **0** |
| `node tools/e2e-autonomous.mjs` | **26/26 PASS** tras la resolución del gate (§7); mi primera pasada dio 25/26 por deriva de la herramienta | **0** (final) |
| `node tools/mutation.mjs` | 16/16 (críticos 13/13, 100 %) | **0** |
| `node tools/coverage.mjs` | línea 95.46 % · rama 76.39 % · funciones 83.16 % (30 ficheros — batería del Lead); mi pasada: 95.5/76.58/83.16 | **0** |
| `node tests/check-hermetic.mjs` | centro 14 ficheros + biblioteca 173 skills intactos | **0** |
| `node tools/r16-collision-matrix.mjs` | 6/6 códigos con severidad/decisión esperadas | **0** |
| `node tools/r16-e2e.mjs` | 9/9 PASS, 0 SKIP, 0 FAIL | **0** |
| `node tools/r16-routing.mjs` | 18/18 PASS | **0** |
| `node tools/r16-portability.mjs` | 29/29 PASS | **0** |
| `node _audit/r16-render.mjs --html-only` | exit 0; nota de compuerta en preview/conflict/done; `evaluation-failed` cubierto por UI `:1922` | **0** |
| `node --test tests/r16-bundle-contract.test.mjs tests/r16-ui.test.mjs` | 65/65 pass (15 + 50) | **0** |
| `node tools/testquality.mjs` | **1 alta / 29 media / 13 baja** — rojo **preexistente**; alta `tests/state.test.mjs:144` («nombre/promete-atomicidad»), ajena a R16.4. No se toca | **1** |

---

## 7. Defectos y hallazgos

**Producto: ninguno.** Los cinco fallos iniciales quedaron clasificados como expectativa/fixture del test
(§3) y corregidos sólo en mi fichero.

**Herramienta de gate desactualizada (no producto), resuelta:** `tools/e2e-autonomous.mjs:436` llamaba
`act('import-bundle', { bundle, from: 'e2e-autonomo' })` **sin `confirmed:true`**. Desde T28 el contrato
exige confirmación humana (`lib/api.mjs:2851-2860`: `confirmed !== true ⇒ 400 confirmation-required`), así
que el paso 24 fallaba con «importar falló: confirmation-required» (`_audit/E2E-AUTONOMO.md`). La conducta
del backend era **correcta** (fail-closed, sin escritura); el script era anterior al requisito.

### §7 Gate autónomo — resolución

- **Causa:** deriva de la herramienta de verificación tras R16.4. El paso 24 importaba un paquete sin
  `confirmed` (y sin resolver el conflicto de identidad), por lo que el backend respondía
  `confirmation-required`/`conflict` **sin escribir**; no era un fallo de producto.
- **Cambio aplicado (sólo herramienta, no producto):** el Lead actualizó
  `tools/e2e-autonomous.mjs:436-441` para llamar
  `import-bundle` con `{ bundle, from: 'e2e-autonomo', confirmed: true, onConflict: 'copy' }` y añadió
  `assert(imported.imported !== false)`.
- **Resultado:** `node tools/e2e-autonomous.mjs` ⇒ **26/26 PASS, exit 0** (`_audit/E2E-AUTONOMO.md`
  actualizado).
- **Producto intacto:** el arreglo no tocó `lib/`, `index.js`, `client.js`, `package.json` ni tests; la
  suite (826/826), `check` (398/398), e2e real (almacén `d431f763…` intacto), hermético (14+173) y el resto
  de gates siguen en verde.

Salvedades declaradas: §4.

---

## 8. Inventario de lo que esta verificación NO cubre

- **No prueba autenticidad ni confidencialidad**: el checksum cubre `{body,description,whenToUse,tags}` y el
  JSON viaja en claro; sin firma ni cifrado (declarado en el contrato).
- **No prueba concurrencia** entre dos paneles importando a la vez.
- **No prueba el panel vivo en DSH**: los renders son `node:vm` del `client.js` real, no el Host; la
  aceptación viva es `_audit/R16.4-ACCEPTANCE.md`.
- **No prueba recuperación ante caída del proceso** a mitad de escritura (sólo error de escritura inyectado y
  reintento; el guardado es atómico por `saveState`, no se simula kill -9).
- **No prueba compatibilidad con centros de versiones anteriores** más allá de `schemaVersion:1`.
- **No prueba que la UI del centro real anuncie `evaluation-failed`**: lo prueba la suite UI con backend
  simulado (`tests/r16-ui.test.mjs:1922`), no un servidor real.
- `tools/testquality.mjs` sigue rojo por un hallazgo **preexistente** ajeno a esta ronda.

---

## 9. Reproducción

```powershell
cd C:\xampp\htdocs\plugins-dhs\lifecode-skill-center
node --test                                            # 826/826, exit 0
node tools/check.mjs                                   # 398/398, exit 0
node tools/e2e.mjs                                     # 19/19, exit 0 (almacén real sin cambios)
node tools/e2e-autonomous.mjs                          # 26/26, exit 0 (tras §7 resolución)
node tools/mutation.mjs                                # 16/16, exit 0
node tools/coverage.mjs                                # exit 0
node tests/check-hermetic.mjs                          # exit 0
node tools/r16-collision-matrix.mjs                    # 6/6, exit 0
node tools/r16-e2e.mjs                                 # 9/9, exit 0
node tools/r16-routing.mjs                             # 18/18, exit 0
node tools/r16-portability.mjs                         # 29/29, exit 0
node --test tests/r16-bundle-contract.test.mjs         # 15/15, exit 0
cd ..
node _audit/r16-render.mjs --html-only                 # exit 0
```

Todas las pruebas y herramientas usan `mkdtempSync` y borran la caja; el digest del almacén real no se toca.
