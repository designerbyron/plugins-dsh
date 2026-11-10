# Verificación independiente del candidato release 1.0.1 (T52)

- **Árbol verificado:** `C:\xampp\htdocs\plugins-dhs\` con `lifecode-skill-center/` **congelado** (no se editó producto).
- **Fecha de medición:** 2026-11-09 (hora local), tras T42–T44.
- **Alcance de escritura de esta ronda:** sólo este informe; mutaciones en copia temporal `%TEMP%\lsc-rel\plugin`.
- **Veredicto corto: PASS como candidato Stable de 1.0.1.** Publicación (npm/GitHub) **pendiente de autorización humana**; la ruta de instalación por GitHub sigue **NO VERIFICADA** por diseño y así está declarada.
- Suite final: **935/935 pass, 0 fail, 0 skipped (exit 0)**. `center.json` real: `9704ee160de8466a4ab6c99cae63b4279b6b5b49a67c1997019ff81b1aea28cc` **antes y después** (52 063 B).

## 1. Paquete real (`npm pack --dry-run --json`) — PASS

Comando (desde `lifecode-skill-center/`):

```sh
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" pack --dry-run --json
```

- exit **0**; **52 ficheros**, tarball estimado **1 144 185 B**, contenido desplegado **2 233 385 B**.
- Incluye lo exigido: `index.js`, `client.js`, `lib/**` (29 `.mjs`), `cordis.patch.yml`, `icon.svg`, `README.md`, `CHANGELOG.md`, `docs/**` con las **8 PNG** (`docs/images/{activity-center,activity-chat,activity-toast,collisions,portability,project-detail,projects-discovered,skill-detail}.png`), más `package.json` (npm lo incluye siempre).
- NO incluye: `tests/`, `tools/`, `node_modules/`, `r161-contract.log`, `_audit/`. La whitelist `files` (`package.json:19-28`) es literal y no usa negaciones.
- Manifiesto: versión `1.0.1` (`package.json:3`), `private: true` (`:4`, bloquea publicación al registro pero no `pnpm add` por ruta/git), `engines.dsh: ">=0.2.2-rc.1 <0.3.0"` (`:29-31`), `@deepseek-ai/dsh-tools` como **peer** (`:43-45`) + **dev** (`:46-48`) y **sin** clave `dependencies` (no hay dependencia física empaquetada).
- `engines.dsh` es real, no decorativo: el Host lo evalúa; el esquema del DSH instalado describe `requirements` «keyed `engines.dsh` or by DSH peer package name» y el estado `incompatible-version` (`app.asar`, offset ~21 544 103 del fichero). La aplicación *end-to-end* del rango contra un Host viejo es responsabilidad del Host y no se puede simular aquí (ver riesgo R3).

## 2. Capabilities — PASS

Montando el adaptador real y despachando por el handler de `webServer.register` (sonda propia en `%TEMP%`, sin almacén real): `GET /lifecode-skill-center/api/capabilities` ⇒ **200** `{contractVersion: 2, plugin:{id:'lifecode-skill-center', version:'1.0.1'}, …}`, `capabilities` incluye **`activity`** y `routes` contiene **`GET /api/activity`** (además de capabilities/workspaces/inventory/projects y los 4 POST). `GET /api/health` sin credencial ⇒ **200** `{ok:true, apiVersion:1, auth:'unavailable'}`. Código: `lib/api.mjs` `API_CONTRACT_VERSION=2`, `CAPABILITY_IDS` con `activity`; `index.js` sirve capabilities **antes** de la admisión.

## 3. T42 — mutaciones reales contra los tests (PASS con una salvedad)

Copia temporal completa del plugin (`%TEMP%\lsc-rel\plugin`, con `node_modules`), baseline **23/23 pass** (`tests/t42-ui.test.mjs` 13 + `tests/t42-tools-activity.test.mjs` 10), restaurada y re-verificada **23/23** tras cada caso:

| # | Mutación aplicada (sólo en la copia) | Resultado | Test(s) que caen |
|---|---|---|---|
| a | Quitar `presentationMeta` de la tool `lifecode_skill_create` (`lib/tools.mjs:214`) | **exit 1 · 21 pass / 2 fail** | `T50: create publica meta.activity y el pipeline normalizado lo conserva (eventId real)` (`tests/t42-tools-activity.test.mjs:177`) y `T50: bloqueo e idempotencia no llevan activity persistida en el meta` (`:231`) |
| b | El puente acepta `persisted:false` (guard de `client.js:7058`) | **exit 1 · 22 pass / 1 fail** | `sin persisted no hay aviso: el resultado del tool no basta` (`tests/t42-ui.test.mjs:43`) |
| c | Quitar **una** capa de dedupe por `eventId` (`client.js:7210`, `markSeen`) | **exit 0 · 23/23 pass** | **ninguno** — ver salvedad |
| c2 | Quitar **las dos** capas de dedupe (`client.js:7210` y `client.js:6999`) | **exit 1 · 22 pass / 1 fail** | `el mismo eventId no se duplica aunque lleguen dos resultados` (`tests/t42-ui.test.mjs:56`) |
| d | No registrar el overlay global; dejarlo sólo dentro del panel (se elimina `ctx.slots.inject(OVERLAY_SLOT, …)`, `client.js:8924-8929`) | **exit 1 · 11 pass / 12 fail** | entre otros `el overlay se monta sin panel: la pila es global, no del panel` (`tests/t42-ui.test.mjs:101`); los 12 fallos son los tests que montan el overlay en el arnés |

**Salvedad (no defecto, sí hueco de fijación):** la deduplicación por `eventId` está implementada **dos veces** — puente (`markSeen`, `client.js:7205-7214`) y store de toasts (`client.js:6996-6999`). Quitar sólo la capa del puente no se detecta porque el store sigue deduplicando; el test sí detecta la pérdida total (c2). Recomendación: dejar constancia o añadir una prueba unitaria del puente, no tocar producto para el release.

Método reproducible: `node %TEMP%\mutate-t52.mjs` (script propio sobre la copia; el árbol real no se modificó). En todos los casos la copia se restauró desde los ficheros del árbol real antes del caso siguiente.

## 4. Transporte `meta.activity` — PASS (con una ruta defensiva a vigilar)

- Proyección pública de **9 claves exactas**: `eventId, type, category, severity, titleKey, titleVars, persisted, replayed, at` (`lib/tools.mjs:70-84`; `persisted` sólo `true` si hubo escritura real y no es replay).
- `output.presentationMeta` se declara **sólo en las 3 tools de mutación**: create (`lib/tools.mjs:214`), improve (`:257`), insight (`:384`); devuelve `{ activity }` (`presentationMetaOf`, `:92-94`). Las tools de lectura (`lifecode_skill_search` `:106`, `lifecode_skill_status` `:294`) **no** la llevan; la prueba `T50: la tool de lectura no declara presentationMeta` (`tests/t42-tools-activity.test.mjs:264`) lo fija.
- Cliente: el puente lee **primero** `data.meta.activity` (`client.js:7217`) antes que `data.activity`, `data.result.activity` o `data.message.activity`; propaga `replayed` (`:7252`) y `pushActivity` no emite si `persisted !== true` o `replayed === true` (`:7057-7059`), igual que `toastFromActivity` (`:7727-7729`).
- **Riesgo R2:** el puente conserva un fallback que **parsea JSON desde el texto del mensaje** (`client.js:7221-7229`). No es la ruta normal (T50 viaja por `meta.activity`), pero contradice el «no depender del texto libre» si un `tool/result` ajeno trae ese JSON. Ningún test T42 lo cubre; lo dejo como riesgo, no como bloqueo.

## 5. Rendimiento R17-A — PASS

`node tools/r17-perf.mjs` ⇒ **11/11 PASS, exit 0** (`_audit/r17-perf-after.json` reescrito por el propio gate). Medido: `client.js` **454 594 → 532 605 B** (+78 011 B = 76,2 KiB; +17,2 %), dentro del presupuesto por tramos **60 + 8 + 16 = 84 KiB** (`tools/r17-perf.mjs:117-126`) y del gate relativo **<20 %** (`:128`). Runtime: `startupRequests=0`, `idleRequests=0`, `openRequests=1`, `closedRequests=1`, `cyclesRequests=1`, `longTimers=0`; `setInterval` del cliente **1** (refresco de 20 s preexistente, `client.js:6887`), `clientRaf=0`, backend `setInterval` 0. El tramo T42 (+13 573 B medidos por el propio gate) queda con 2,7 KiB de margen; el acumulado usa 76,2 de 84 KiB.

## 6. Documentación y assets — PASS (con observaciones de higiene)

- **9 Markdown**: 7 documentos de contenido (`ARCHITECTURE`, `ARQUITECTURA`, `DESARROLLO`, `INSTALLATION`, `OPERACION`, `SECURITY`, `TROUBLESHOOTING`) + `docs/README.md` + `lifecode-skill-center/README.md`. **32 enlaces locales, 0 rotos** (script propio que resuelve cada `](ruta)` contra el disco); las 8 PNG de `docs/images/` existen y se enlazan.
- **0 `C:\Users` en docs**; no hay rutas de perfil ni nombres reales. Las apariciones de `designerbyron` son el **handle público** del autor/repositorio (`README.md:141,286-288`, `INSTALLATION.md:29,36,130,133,141,145`, `SECURITY.md:134-135`), no un dato privado. Excepción interna: `tests/evaluate.test.mjs:73` usa `C:\Users\nombre\…` como **entrada adversaria** para comprobar la detección de rutas privadas (no es fuga, no se empaqueta).
- **GitHub claramente no verificado:** `README.md:137,279`; `docs/INSTALLATION.md:6` («Status of GitHub installation: not verified») y `:145-146` («None of the candidates has been exercised; PENDIENTE»). Cumple lo exigido: la afirmación no se presenta como hecha.
- **CHANGELOG declara 1.0.1** con fecha (`CHANGELOG.md:9`, `## [1.0.1]`).
- **Assets** (`assets/lifecode-skill-center/`): `app-icon.svg` 3 486 B; `app-icon-512.png` **512×512**, RGBA (alfa, colorType 6), 131 098 B; `app-icon-transparent.png` **1024×1024**, RGBA, 429 336 B; `github-social-preview.png` **1280×640**, 526 964 B (**<1 MB**). `package.json.icon` ⇒ `./icon.svg` existe y es **idéntico** (sha256 `974ce3d662f6b78804ead08d5839f1d48d67cc2c017fdac928c3ea752a5a9d4e`) a `assets/lifecode-skill-center/app-icon.svg`: un solo maestro, sin deriva.
- **Higiene interna (no empaquetada):** `_audit/r16.3-recon/*.json` (raw y «sanitized») conservan rutas de perfil en minúsculas (`c:/users/<perfil>/.dsh/…`) en los `key`/`id` de las entradas; `_audit/` no entra en el paquete, pero conviene no publicar esos artefactos sin sanear del todo (riesgo R5).

## 7. Gates con exit code — PASS (salvo testquality preexistente)

Ejecutados desde `lifecode-skill-center/` (árbol congelado):

| Gate | Resultado | Exit |
|---|---|---|
| `node --test` | **935/935 pass, 0 fail, 0 skipped** | **0** |
| `node tools/check.mjs` | **420/420** comprobaciones | **0** |
| `node tests/check-hermetic.mjs` | centro 16 ficheros + biblioteca 173 skills intactos; «la suite entera corrió sin tocar nada real» | **0** |
| `node tools/e2e.mjs` | PASS **19/19 pasos**, 0 FAIL | **0** |
| `node tools/e2e-autonomous.mjs` | **26/26 PASS** | **0** |
| `node tools/r16-collision-matrix.mjs` | **6/6** códigos con severidad/decisión esperadas | **0** |
| `node tools/r16-e2e.mjs` | **9/9 PASS**, 0 SKIP, 0 FAIL | **0** |
| `node tools/r16-routing.mjs` | **18/18 PASS** | **0** |
| `node tools/r16-portability.mjs` | **29/29 PASS**, sólo raíces temporales | **0** |
| `node tools/r17-perf.mjs` | **11/11 PASS** | **0** |
| `node tools/testquality.mjs` | **rojo preexistente**: 1 alta / 30 media / 13 baja; alta `tests/state.test.mjs:144` | **1** (documentado, no se toca) |

`center.json` real (sólo lectura): sha256 `9704ee160de8466a4ab6c99cae63b4279b6b5b49a67c1997019ff81b1aea28cc`, 52 063 B, **idéntico antes/después** de toda la batería. Los gates e2e/cobertura regeneran sus informes de `_audit/` como artefactos esperados del propio gate; no se editó ningún `.md` a mano.

## 8. Riesgos residuales (3–6, reales)

- **R1 — Dedupe con dos capas y prueba que no fija la del puente.** Quitar sólo `markSeen` no rompe ningún test (c). Riesgo de que una refactorización futura elimine la capa del puente sin señal; el comportamiento sigue protegido por el store. Mitigación: prueba del puente o comentario de contrato. **No bloquea 1.0.1.**
- **R2 — Fallback del puente que parsea JSON del texto del mensaje** (`client.js:7221-7229`). Ruta legada/defensiva no cubierta por T42; podría aceptar una `activity` embebida en texto en lugar de `meta.activity`. **No bloquea**, pero es la primera ruta a cerrar en 1.0.2.
- **R3 — `engines.dsh` sólo se hace cumplir en el Host.** Está declarado (`package.json:29-31`) y el Host tiene el esquema (`app.asar`), pero este repositorio no prueba el rechazo `incompatible-version` contra un DSH viejo; se verifica en instalación real. **Preparado, no verificado end-to-end.**
- **R4 — testquality en rojo preexistente** (`tests/state.test.mjs:144`, alta). No es de T42/T44 y no se arregla aquí; el resto de la suite está verde.
- **R5 — Artefactos de auditoría con rutas de perfil** en `_audit/r16.3-recon/*.json` (minúsculas). Fuera del paquete (`npm pack` excluye `_audit/`), pero no deben publicarse sin sanear.
- **R6 — Publicación pendiente / ruta GitHub no verificada.** `private:true` impide publicar al registro npm; la instalación por GitHub está declarada como no verificada (`README.md:137,279`, `INSTALLATION.md:6,145-146`). Cualquier anuncio público de «instalable desde GitHub» sería prematuro.

## Veredicto

| Estado | Contenido |
|---|---|
| **VERIFICADO** | Paquete (52 ficheros, contenido/exclusiones, manifiesto), capabilities 1.0.1 + `activity` + contract 2, transporte `meta.activity` de 9 claves, tests T42 (mutaciones a–d/c2), rendimiento 11/11 y presupuesto, docs/enlaces/assets/CHANGELOG, batería completa de gates, `center.json` intacto. |
| **PREPARADO** | `engines.dsh` y `files` whitelist listos para que el Host/registro los aplique; assets maestros listos para el anuncio. |
| **PENDIENTE** | Autorización humana de publicación y prueba real de instalación por GitHub en un perfil temporal (`INSTALLATION.md:116-146`). |

**¿Es seguro declarar 1.0.1 Stable como candidato?** Sí, **con la publicación pendiente de autorización humana** y con R2/R3 documentados como trabajo de 1.0.2/instalación real. No se encontró ningún defecto bloqueante de producto ni de paquete en esta verificación.

## Reproducción

```sh
cd lifecode-skill-center
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" pack --dry-run --json   # 52 ficheros, exit 0
node --test                                                                             # 935/935, exit 0
node tools/check.mjs                                                                    # 420/420, exit 0
node tests/check-hermetic.mjs                                                           # exit 0
node tools/e2e.mjs && node tools/e2e-autonomous.mjs                                     # 19/19 y 26/26, exit 0
node tools/r16-collision-matrix.mjs && node tools/r16-e2e.mjs                           # 6/6 y 9/9, exit 0
node tools/r16-routing.mjs && node tools/r16-portability.mjs                            # 18/18 y 29/29, exit 0
node tools/r17-perf.mjs                                                                 # 11/11, exit 0
node tools/testquality.mjs                                                              # rojo preexistente, exit 1
# Mutaciones T42: copia temporal del plugin + los 4 casos del §3 (árbol real intacto).
```
