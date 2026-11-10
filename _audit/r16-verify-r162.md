# R16.2 — Verificación independiente (T20)

**Verificador:** `verify-r16` (T5) · **Fecha:** 2026-11-09 · **Árbol:** `C:\xampp\htdocs\plugins-dhs`
**Alcance:** task-20, verificación independiente de R16.2 (routing real, handshake versionado, cinco
estados de compatibilidad y gates). No se editó `lib/`, `index.js`, `client.js`, `package.json`, ni
`_audit/*.md` preexistentes.

**Veredicto global: PASS.** Los 17 puntos de §7 se demuestran con ejecución real; no se encontró ningún
defecto de producto nuevo. Dos salvedades de cobertura (no de producto) quedan declaradas en §4.

---

## 1. Entregables de esta ronda

| Fichero | Contenido | Pruebas/checks |
|---|---|---|
| `lifecode-skill-center/tests/r16-runtime.test.mjs` (nuevo) | Monta `apply` real, captura la ruta de `webServer.register` y despacha por su `handler` con req/res fake. Cubre prefijo único, handshake, dispatch, 404 ruta vs entidad, doble instancia, auth, reintento, concurrencia, señal positiva de legacy y guardarraíles del cliente. | **12/12 pass** |
| `lifecode-skill-center/tools/r16-routing.mjs` (nuevo) | Matriz ejecutable: 13 checks de backend por el handler registrado + los 5 modos reales de `_audit/r16-render.mjs --compat=…`. `PASS/FAIL` por línea y exit code real. | **18/18 PASS, exit 0** |
| `_audit/r16-verify-r162.md` (este informe) | Veredicto, evidencia y tabla de gates. | — |

No fue necesario ampliar `tests/r16-contract.test.mjs`: `tests/r16-routing.test.mjs` (9 pruebas, ya
existente) y el nuevo runtime cubren el despacho; el contrato HTTP/DTO se mantuvo intacto (42 pruebas).

---

## 2. Veredicto punto por punto (§7 de la directiva R16.2)

| # | Punto | Veredicto | Evidencia ejecutada |
|---|---|---|---|
| 1 | Registro real del prefijo API por el handler capturado de `webServer.register` (no sólo funciones) | **PASS** | `tests/r16-runtime.test.mjs:152` — `apply` registra **una** ruta `{kind:'prefix', path:'/lifecode-skill-center/api', handler:function}`; `tools/r16-routing.mjs` check 1 |
| 2 | `GET /api/projects` y `GET /api/inventory` sobre ese handler | **PASS** | `tests/r16-runtime.test.mjs:211` (200, `apiVersion:1`, `contractVersion:2` aditivo, arrays); routing checks 3-6 |
| 3 | `POST inspect-project` y `POST register-project` por el mismo handler | **PASS** | `tests/r16-runtime.test.mjs:276` (register 200 uuid, cwd normalizado, árbol del proyecto idéntico; inspect 200 `action`/`projectId`/`registration.uuid`; sin tocar el proyecto) |
| 4 | 404 de ruta vs 404 de entidad, códigos distintos | **PASS** | `tests/r16-runtime.test.mjs:255` — ruta ⇒ `code:'not-found'`; entidad ⇒ `code:'project-not-found'`; routing checks 9-10 |
| 5 | Un 404 de ruta **no** activa legacy | **PASS** | `tests/r16-runtime.test.mjs:234` (workspaces nuevo con `deprecated:true` no es señal vieja); `tests/r16-runtime.test.mjs:425` (legacy exige probar `/workspaces` y validar forma vieja; probe inválido ⇒ `backend-incompatible`); `tests/r16-ui.test.mjs:1280` (404 sin señal positiva ⇒ banner «Backend incompatible», sin legacy) |
| 6 | Cliente con backend compatible: handshake 200 contrato 2 | **PASS** | `tests/r16-ui.test.mjs:1271` (una sola petición a `/capabilities`, sin banner); `_audit/r16-render.mjs --compat=compatible` ⇒ exit 0 «banner de estado verificado · rojos 0»; routing check 14 |
| 7 | Cliente con backend legacy identificado **positivamente** (workspaces sin claves nuevas) | **PASS** | `tests/r16-ui.test.mjs:1233` (banner «Modo compatibilidad heredada», 0 rojos, sin `/projects` ni `/inventory`); `--compat=legacy` ⇒ exit 0; routing check 15 |
| 8 | Cliente con backend incompatible | **PASS** | `tests/r16-ui.test.mjs:1253` y `:1280` (banner «Backend incompatible» + «Copiar diagnóstico», acciones detenidas); `--compat=incompatible` ⇒ exit 0; routing check 16 |
| 9 | Backend sin capabilities ⇒ **incompatible**, no legacy | **PASS** (salvedad S1) | `tests/r16-ui.test.mjs:1280` (404 de capabilities sin señal positiva ⇒ incompatible); `tests/r16-runtime.test.mjs:425` fija el guardarraíl exacto: `asLegacyWorkspacesPayload` rechaza `deprecated` no nulo y filas con `state` (`client.js:2136-2147`), y `loadCompat` sólo devuelve `legacy-compatible` con `legacyPayload !== null` (`client.js:5357-5371`) |
| 10 | Servidor no disponible | **PASS** | `tests/r16-ui.test.mjs:1307` (banner «Backend no disponible» + «Reintentar», sin legacy); `--compat=unavailable` ⇒ exit 0; `tests/r16-runtime.test.mjs:188` (sin `connection`: capabilities 200, datos 503 `auth-unavailable`) |
| 11 | Doble instancia / revisión antigua: dos handlers, gana el actual | **PASS** | `tests/r16-runtime.test.mjs:334` — `routes=[oldHandler, current]`; el vigente (`routes.at(-1)`) responde contrato 2 y el viejo queda con su 404 `not-found` |
| 12 | Error de autenticación 401/403 | **PASS** | `tests/r16-runtime.test.mjs:188` (capabilities sin credencial 200 y JSON saneado), `:304` (sin cookie 401 `unauthorized`; `Origin` ajeno 403 `cross-origin`; POST sin credencial 401 sin escribir); `--compat=auth` ⇒ exit 0 |
| 13 | Reintento tras recuperación | **PASS** | `tests/r16-runtime.test.mjs:374` — `connection` ausente ⇒ 503 `auth-unavailable`; al restaurarlo ⇒ 200 y el digest del almacén no cambia |
| 14 | Ausencia de doble envío | **PASS** (salvedad S2) | Backend: `tests/r16-runtime.test.mjs:394` — dos `POST register-project` concurrentes ⇒ ambos 200, **un** proyecto, sin asignaciones inventadas. Cliente: `client.js:5529-5537` (guard `busy === true` antes del POST y salida temprana; `compatActionsEnabled` línea 5530 impide registrar fuera del contrato 2) |
| 15 | Ausencia de escritura cuando el contrato no es compatible | **PASS** (salvedad S3) | `tools/r16-routing.mjs`: digest de `centerFile(root)` antes/después del handshake y de todas las lecturas ⇒ `missing`/idéntico; en legacy el cliente no llama `/projects` ni `/inventory` (`tests/r16-ui.test.mjs:995-996`); las 5 variantes de render se ejecutan contra el fake en memoria, no tocan el almacén real |
| 16 | TODOS los gates con exit code | **PASS** | Tabla §3, 12 gates medidos en esta ronda |
| 17 | Contraste con `_audit/R16.1-GATES.md` y defectos | **PASS** | §3 y §4: suite 725 → **755**, check 389 → **392**, cobertura línea 95,92 → **96,01**; `testquality` sigue exit 1 preexistente sin cambios (1 alta/27 media/13 baja) |

---

## 3. Gates ejecutados (exit code real, 2026-11-09)

| Gate | Resultado | Exit |
|---|---|---|
| `node --test` (suite completa) | **755/755 pass, 0 fail** (8,5 s) | **0** |
| `node tools/check.mjs` | **392/392 comprobaciones** | **0** |
| `node tools/e2e.mjs` | **19/19 PASS** · almacén real `d431f763…` → `d431f763…` **SIN CAMBIOS** | **0** |
| `node tools/e2e-autonomous.mjs` | **26/26 PASS** · almacén real intacto | **0** |
| `node tools/mutation.mjs` | **13/13 críticos (100 %) · 16/16 total (100 %)** | **0** |
| `node tools/coverage.mjs` | línea **96,01 %** · rama **76,65 %** · funciones **83,6 %** (30 ficheros), «Suite en verde» | **0** |
| `node tests/check-hermetic.mjs` | 14 ficheros del centro + 173 de la biblioteca **intactos**; «la suite entera corrió sin tocar nada real» | **0** |
| `node tools/r16-collision-matrix.mjs` | **6/6** códigos con severidad/decisión esperadas | **0** |
| `node tools/r16-e2e.mjs` | **9/9 PASS, 0 SKIP, 0 FAIL**; hash del almacén temp 3 ficheros `868a2723…` | **0** |
| `node tools/r16-routing.mjs` (nuevo) | **18/18 PASS, 0 FAIL** | **0** |
| `node --test tests/r16-runtime.test.mjs` (nuevo) | **12/12 pass** | **0** |
| `node tools/testquality.mjs` | 1 alta / 27 media / 13 baja — **preexistente, sin cambios** (alta en `tests/state.test.mjs:144`) | **1** (conocido) |

Comparación con R16.1: suite 725 → 755 (+30 pruebas nuevas del árbol), check 389 → 392, e2e 19/19,
e2e-autonomous 26/26, mutation 13/13·16/16, hermético 725 → 755 + 14 + 173. `testquality` sigue rojo
por el mismo hallazgo ajeno a R16.2; no se tocó.

---

## 4. Defectos y salvedades

**Defectos de producto nuevos: NINGUNO.** No hay bloqueo para congelar el árbol.

- **S1 (cobertura, no defecto).** La combinación exacta «`/capabilities` 404 **y** `/workspaces` con
  forma nueva (`deprecated:true`) ⇒ `backend-incompatible`» está verificada por código y por guardarraíl
  (`client.js:2136-2147` rechaza `deprecated` y filas con `state`; `client.js:5357-5371` sólo entra en
  legacy con `legacyPayload` válido) y por el caso funcional equivalente 404 sin señal positiva
  (`tests/r16-ui.test.mjs:1280`). No hay prueba funcional del par exacto en mis ficheros porque exigiría
  editar `tests/r16-ui.test.mjs` (fuera de mi alcance de escritura).
- **S2 (cobertura, no defecto).** El doble envío del diálogo se demuestra en backend (idempotencia
  concurrente) y por el guard de `busy` (`client.js:5529-5537`); no hay prueba funcional de doble clic en
  mis ficheros. La aceptación de campo lo cubre en A10.
- **S3 (efecto de la propia verificación).** Los gates `tools/e2e.mjs`, `tools/e2e-autonomous.mjs` y
  `tools/coverage.mjs` **regeneran** sus informes no versionados (`_audit/E2E-REPORT.md`,
  `_audit/E2E-AUTONOMO.md`, `_audit/COBERTURA.md`). No es edición manual ni afecta datos reales; se
  declara para que el manifiesto de commits sepa que son artefactos de gate.
- **Observación O1.** Cobertura de rama baja de 76,73 a 76,65 porque los ficheros nuevos
  (`tests/r16-runtime.test.mjs`, `tools/r16-routing.mjs`) no son producto; línea y funciones de producto
  se mantienen (96,01 %). No es regresión.

---

## 5. Reproducción

```powershell
cd C:\xampp\htdocs\plugins-dhs\lifecode-skill-center
node --test
node --test tests/r16-runtime.test.mjs
node tools/check.mjs
node tools/e2e.mjs
node tools/e2e-autonomous.mjs
node tools/mutation.mjs
node tools/coverage.mjs
node tests/check-hermetic.mjs
node tools/r16-collision-matrix.mjs
node tools/r16-e2e.mjs
node tools/r16-routing.mjs
node tools/testquality.mjs   # exit 1 preexistente (documentado)
```

## 6. Qué NO prueba esta ronda

- No reinicia el proceso DSH real ni mide el PID/StartTime del Host vivo: eso es la aceptación de campo
  (`_audit/R16.2-ACCEPTANCE.md`, pasos 0-7). Aquí se prueba que el módulo **actual** registra y despacha
  por su handler, y que el cliente clasifica correctamente los cinco estados.
- No regenera capturas ni perfiles de navegador (prohibido por el encargo); usa las variantes
  `--html-only` de `_audit/r16-render.mjs`, que montan el panel real en memoria.

---

# 7. Addendum — delta de pulido (árbol congelado)

**Fecha:** 2026-11-09 · **Alcance del delta:** `client.js` + `tests/r16-ui.test.mjs` (ui-projects):
(1) el cuerpo del banner heredado ya no repite su título ES/EN; (2) en modo NO compatible la tarjeta
declara la identidad como «sin comprobar (backend heredado)» en vez de afirmar «sin UUID»;
(3) dos pruebas nuevas; (4) capturas regeneradas. No se editó implementación durante esta verificación.

## 7.1 Gates re-ejecutados tras el delta

| Gate | Resultado | Exit |
|---|---|---|
| `node --test` | **757/757 pass, 0 fail** (8 646 ms) — 755 previas + las 2 pruebas nuevas | **0** |
| `node --test tests/r16-ui.test.mjs` | **29/29 pass** — incluye `:1253` (banner/identidad no compatible) y `:1288` (compatible sí «sin UUID») | **0** |
| `node --test tests/r16-runtime.test.mjs` | **12/12 pass** | **0** |
| `node tools/check.mjs` | **392/392 comprobaciones · todo en orden** | **0** |
| `node tools/r16-routing.mjs` | **18/18 PASS · 0 FAIL** (los 5 modos `--compat` siguen estables, sin blanco) | **0** |
| `node tools/e2e.mjs` | **19/19 PASS**; `center.json` `d431f763…` → `d431f763…` **SIN CAMBIOS** (14 ficheros, 44 522 B) | **0** |
| `node tests/check-hermetic.mjs` | 14 ficheros del centro + 173 de la biblioteca **intactos**; «la suite entera corrió sin tocar nada real» | **0** |

## 7.2 Verificación por lectura de código

**(i) El cuerpo del banner no repite el título.**
`projects.compat.legacy.body` ES (`client.js:213`) empieza «Este backend no publica /api/projects ni
/api/inventory…» y no contiene «Modo compatibilidad heredada»; EN (`client.js:955`) tampoco contiene
«Legacy compatibility mode». El banner heredado pinta el título una sola vez
(`client.js:3073-3078`: `<strong>` título + `<p>` cuerpo + hint de refresco), y las variantes
incompatible/unavailable/auth usan títulos (`:215`, `:220`, `:222`) y cuerpos (`:216`, `:221`, `:223`)
sin redundancia entre sí. Las pruebas nuevas lo fijan: `r16-ui.test.mjs:1266-1267` (ES: el título
aparece 1 vez y no existe el patrón «título:») y `:1283-1284` (EN, lo mismo).

**(ii) En legacy/incompatible/unavailable/auth no se pinta «sin UUID» ni un UUID en la tarjeta.**
`projects.card.identityUnknown` existe ES (`client.js:375`) y EN (`:1117`). `identityUnchecked` es
parámetro explícito de `ProjectCard` (`:3192`) y decide en `:3208-3214`: con `true` la línea es
«sin comprobar (backend heredado)»; `uuid`/`projectId`/`uuidNone` sólo se evalúan con `false`.
`ProjectCardGrid` lo reenvía (`:3324`, `:3335`) y `ProjectsView` lo cablea con `identityUnchecked:
!actionsAllowed` en las dos rejillas (`:3525` descubiertos, `:3544` gestionados), donde
`actionsAllowed = compatActionsEnabled(compat)` (`:3412`) y `compatActionsEnabled` sólo es cierto para
`state === 'compatible-r16'` (`client.js:2155`). Por tanto los cuatro estados no compatibles fuerzan
`true` y nunca muestran `uuidNone`. La ficha de administración conserva su `uuidNone` (`:3758`), pero en
esos modos no es alcanzable: el botón de ficha está deshabilitado (`:3316-3318`) y los handlers
`handleInspect`/`openRegister` cortan con `!actionsAllowed` (`:3436`, `:3440`).

**(iii) En compatible el comportamiento es el de antes.**
En `compatible-r16`, `actionsAllowed` es `true` ⇒ `identityUnchecked:false` ⇒ rama original de
`:3210-3214` (UUID si existe, si no `projectId`, si no «sin UUID»). La prueba `:1288` lo demuestra sobre
la tarjeta `gamma` del payload verificado. El banner no se renderiza en compatible
(`client.js:3062`), y `client.js:2155`/`:3412` no cambiaron de contrato.

**Regresiones detectadas: ninguna.** Los conteos de UI y la suite completa suben exactamente por las dos
pruebas nuevas; `routing` 18/18 confirma que los cinco modos siguen produciendo un panel con contenido.

## 7.3 Veredicto del delta

**PASS.** El delta de pulido no introduce defectos de producto, no altera el contrato de compatibilidad y
no toca el almacén real (e2e + hermético). El árbol es apto para congelar y generar el manifiesto.

*Salvedad de método:* esta verificación usa el arnés de UI con host fake (HTML renderizado en memoria),
no una captura de navegador; las capturas `r16-after-compat-legacy.png` (116 244 B) y
`r16-after-compat-compatible.png` (128 727 B) son el artefacto de ui-projects, no una medición mía.
