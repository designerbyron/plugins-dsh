# FINAL-RELEASE-READINESS — LifeCode Skill Center 1.0.1 Stable

> Estado: **candidato a release, no publicado**. Este informe separa lo **verificado**, lo **preparado**
> y lo **pendiente de autorización o de una prueba que este agente no puede ejecutar solo**.
> Fecha: 2026-11-09. Batería final: `_audit/release-1.0.1-final-gates.log`.

## A. Estado del producto

| Campo | Valor |
|---|---|
| Versión | **1.0.1** (`lifecode-skill-center/package.json`; `capabilities` en vivo devuelve `plugin.version = 1.0.1`) |
| Paquete | `@local/lifecode-skill-center` (`private: true`, plugin local) |
| Rama local | `feature/visual-operation-feedback` |
| HEAD | `3b295106e5263858c32bd4db4c110068a4bad687` (sin commit de este trabajo) |
| Estado Git | snapshot congelado tras T44-M y la sanitización final: recuento exacto y desglose en §J (`_audit/COMMIT-CANDIDATES-R17.md`, regenerado); `_audit/` no forma parte del paquete |
| Alcance | R16 (proyectos, inventario, colisiones, portabilidad), R17/R17.1 (Activity Center, toasts del panel, clasificación), T42 (toast global sobre la conversación), T43 (distribución), T44 (docs + branding) |
| Producto (tamaños) | `client.js` 532 605 B · `index.js` 31 694 B · `lib/api.mjs` 198 448 B · `lib/tools.mjs` 24 938 B · `lib/activity.mjs` 16 892 B |

Preservado y **no modificado**: `MEMORY.md`, las 14 entradas preexistentes de `skill-compiler/`,
`center.json`/`knowledge.json` reales, la política `guarded-autonomous` de `plugins-dhs-7e085aaa`,
identidades, asignaciones y backups. `center.json` sigue con sha256
`9704ee160de8466a4ab6c99cae63b4279b6b5b49a67c1997019ff81b1aea28cc` (52 063 B) antes y después de la batería.

## B. Notificaciones durante la conversación (T42)

**Superficies medidas en el bundle del Host** (`_audit/T42-CHAT-NOTIFICATIONS.md`):

- `shell.overlay` — slot de lista, scope `root`, capa flotante sobre todo el marco, *click-through*: sólo
  las tarjetas reciben punteros. El host de toasts se registra en `apply(ctx)`, no dentro del panel.
- `conversation.session.header.actions` — slot de lista, scope `session`, recibe `sessionId` en sus
  standard props. Se registra un *probe* que renderiza `null` y reporta la sesión activa.

**Transporte (sin polling ni canal nuevo):** `ctx.get('sessions').binding(sessionId).eventSource` es un
`ObservableSnapshot<SessionEventWindow>` que el Host **ya** mantiene abierto para el navegador; suscribirse
no abre socket, ni fuente, ni temporizador, ni petición. Se observan `tool/call` (se recuerda el
`toolCallId` sólo si la tool empieza por `lifecode_`) y `tool/result` (se lee `event.data.meta.activity`).

**Persistencia del aviso:** `lib/tools.mjs` declara `output.presentationMeta` en las 3 tools de mutación
(`create` L214, `improve` L257, `insight` L384) devolviendo `{ activity }` con 9 claves
(`eventId, type, category, severity, titleKey, titleVars, persisted, replayed, at`). Es el hook oficial de
`@deepseek-ai/dsh-tools` («pure replayable presentation metadata»), persistido con el session log y
reproyectado en vivo y en replay; el cliente lee `data.meta.activity` y tolera además 4 formas heredadas.
Las tools de lectura no lo declaran.

**Reglas de emisión:** toast sólo con `persisted === true`; `replayed === true` no avisa; deduplicación por
`eventId` en tres capas (toolCallId, store, render); nunca se inspecciona texto libre del asistente; una
operación produce un aviso. **Una única pila**: el `ActivityDrawer` conserva el historial y `shell.overlay`
muestra los avisos efímeros; el panel sólo pinta su pila como *fallback* si el Host no ofrece `shell.overlay`.

**Límites declarados:** no hay notificación del sistema operativo ni push con el Harness cerrado; el canal
externo se declara no disponible, nunca se simula. La prueba real de 12 pasos (§14 de la directiva) queda
**pendiente de una persona**: exige reiniciar DSH (mitad Host nueva) y ejecutar una operación de IA en un
chat. Lo verificado aquí es el contrato, el transporte, la UI y su comportamiento en tests con mutación.

## C. Instalación desde GitHub (T43)

**Contrato del instalador** (`_audit/inspector real: plugin-manager`, ver `_audit/T43-DISTRIBUTION-AUDIT.md`):
un único campo de *spec* + selector de registro. Acepta nombre de paquete con versión opcional, dirección
Git (`owner/repo`, URL, `git+https` con fragmento), tarball o ruta local absoluta. El fragmento git se
conserva intacto hasta `pnpm add`; **`#path:` está soportado** por el pnpm empaquetado (11.28.5). Una URL
`/tree/...` **no** es spec válida.

**Especificación exacta** (la que debe pegarse en *Complementos → Añadir complemento*):

```
github:designerbyron/plugins-dsh#path:/lifecode-skill-center
github:designerbyron/plugins-dsh#<sha40>&path:/lifecode-skill-center    (pineada; la recomendada)
```

**Estado: `BLOCKED — requiere publicar la referencia autorizada`.** La carpeta `lifecode-skill-center/`
existe en el árbol de trabajo (48 ficheros trackeados + 113 sin trackear dentro del plugin), pero **no está
en `main` ni en `origin/main`** (`origin/main` = `bbd5e38`); un `pnpm add` de la spec anterior descarga un
árbol sin el subdirectorio. Las dos vías de publicación, sin `git add -A`, están en
`_audit/T43-PUBLISH-PLAN.md` (§5-§7): rama `publish/lifecode-skill-center` + PR, o rama desde `origin/main`
con `git checkout <commit> -- lifecode-skill-center`. **Ninguna se ha ejecutado**: requieren autorización humana.

**Metadatos del paquete — aplicados y verificados** (`lifecode-skill-center/package.json`, 1 558 B):

| Campo | Valor | Motivo verificado |
|---|---|---|
| `version` | `1.0.1` | alineada con `capabilities.plugin.version` y `CHANGELOG.md` |
| `engines.dsh` | `>=0.2.2-rc.1 <0.3.0` | campo real: `dsh-app-boot` lo evalúa con `semver.satisfies(...,{includePrerelease:true})`; si existe, decide solo |
| `files` | `index.js`, `client.js`, `lib`, `cordis.patch.yml`, `icon.svg`, `README.md`, `CHANGELOG.md`, `docs` | whitelist con rutas **literales** (el packlist hace `lstat` literal, no globs); imprescindible el parche del bundle |
| `@deepseek-ai/dsh-tools` | `peerDependencies: ">=0.2.0-0 <0.3.0"` + `devDependencies: 0.2.0-rc.2` | el Host provee el paquete en runtime; una copia física puede preceder al runtime y romper la identidad de clases |
| `private: true` | se conserva | sólo impide publicar en un registro; no afecta a `pnpm add github:…` |

**Empaquetado real:** `npm pack --dry-run --json` ⇒ **52 ficheros**, entra `index.js`, `client.js`, `lib/**.mjs`
(28), `cordis.patch.yml`, `icon.svg`, 2 README de docs y `docs/**` con los 8 PNG; **no** entran `tests/`,
`tools/`, `node_modules/` ni `r161-contract.log`. `@deepseek-ai/dsh-tools@0.2.0-rc.2` existe en el registro
público de npm (consultado), por lo que la resolución de la dependencia de desarrollo no bloquea la instalación.

**Procedimiento de prueba (pendiente de persona, perfil aislado — nunca el productivo):** fijar el SHA,
crear perfil temporal (`DSH_HOME` aislado), añadir la spec con el diálogo real, habilitar, verificar que
Host y cliente cargan (`/api/health`, `/api/capabilities` con `plugin.version = 1.0.1` y `activity`),
abrir el panel, crear una Skill, comprobar el aviso en un chat, reiniciar el perfil y repetir; después probar
la actualización con un SHA nuevo y la desinstalación. Criterio PASS: el instalador **descargó, resolvió,
activó y ejecutó** desde la referencia remota real. Hoy: **no ejecutado**.

## D. Documentación y branding (T44)

**Documentación** (sin cifras de gates dentro; remiten a este §E):

| Fichero | Líneas | Bytes |
|---|---|---|
| `README.md` (raíz, EN + ES) | 219 | 10 918 |
| `lifecode-skill-center/README.md` | 565 | 30 091 |
| `lifecode-skill-center/docs/INSTALLATION.md` | 177 | 8 702 |
| `lifecode-skill-center/docs/ARCHITECTURE.md` | 232 | 13 067 |
| `lifecode-skill-center/docs/SECURITY.md` | 139 | 8 231 |
| `lifecode-skill-center/docs/TROUBLESHOOTING.md` | 159 | 9 976 |
| `lifecode-skill-center/CHANGELOG.md` | 115 | 7 701 |

Honestidad aplicada: notificaciones sólo dentro de DSH; sin push ni SO; `skill.loaded` = oferta/carga, no
aplicación; atribución según evidencia; sin aprendizaje de fondo; autonomía no automática; historial con
retención/paginación; **instalación desde GitHub marcada NO VERIFICADA / PENDIENTE**, con la spec candidata
y la advertencia sobre `/tree/...`; repo canónico `designerbyron/plugins-dsh` en todos los enlaces.

**Capturas públicas** en `lifecode-skill-center/docs/images/` (fixture neutral, sin datos del usuario;
verificadas con `read_image` y grep de privacidad):

| PNG | Dimensiones | Bytes | SHA-256 (12) |
|---|---|---|---|
| `projects-discovered.png` | 1440×1120 | 105 385 | `e5e2f1829e7e` |
| `project-detail.png` | 1440×1260 | 168 098 | `7735cb85…` |
| `collisions.png` | 1440×1080 | 106 509 | `3e457862…` |
| `skill-detail.png` | 1440×1260 | 133 136 | `696799c0…` |
| `activity-center.png` | 1440×960 | 126 032 | `8e83ca71…` |
| `activity-toast.png` | 1440×900 | 47 529 | `ca94b0a5…` |
| `activity-chat.png` | 1280×800 | 32 275 | `b7c7b2ca…` |
| `portability.png` | 1440×1120 | 107 004 | `4bd04926…` |

**Identidad visual** en `assets/lifecode-skill-center/` (y `lifecode-skill-center/icon.svg` = maestro):
`app-icon.svg` 3 486 B (`974ce3d662f6b788…`), `app-icon-512.png` 512×512 131 098 B, `app-icon-transparent.png`
1024×1024 con alfa 429 336 B, `github-social-preview.png` **1280×640**, **922 868 B**, sha256
`cd6e11a281d79000c0338daad9b8098c9efb77748895fcfd43187cade2e12e6d`, 2:1, < 1 MB y sin metadatos
(arte corregido por el usuario; reoptimizado sin pérdida, sin cambios visuales, original de 1 104 356 B
conservado fuera de candidatos). `package.json.icon`
apunta a `./icon.svg`, que existe y es el maestro (no se inventó ningún campo). Método reproducible en
`_audit/t44-assets/README.md` (Edge headless + Pillow; los intermedios viven en `_audit/`, no en assets).
**Pendiente manual:** subir el social preview y el icono en GitHub *Settings* (sin acceso desde aquí); la
configuración de nombre/descripción/topics queda redactada, no aplicada.

## E. Gates de la batería final

Ejecutada sobre el árbol congelado; log completo (UTF-8) en `_audit/release-1.0.1-final-gates.log`.
Script reproducible: `_audit/release-run-gates.mjs`.

| Gate | Resultado | Exit |
|---|---|---|
| `node --test` (suite completa) | **935/935 PASS**, 0 fail | 0 |
| `tests/t42-ui.test.mjs` | 12/12 PASS | 0 |
| `tests/t42-tools-activity.test.mjs` | 11/11 PASS | 0 |
| `tools/check.mjs` | **420/420** | 0 |
| `tools/e2e.mjs` | **19/19 PASS**; `center.json` `9704ee16…` → igual, 52 063 B, 16 ficheros/10 dirs, huella `9c5e849f…` | 0 |
| `tools/e2e-autonomous.mjs` | **26/26 PASS** | 0 |
| `tools/mutation.mjs` | **críticos 13/13 (100 %)**, total **16/16 (100 %)** | 0 |
| `tools/coverage.mjs` | línea **96,56 %** · rama **76,42 %** · funciones **83,58 %** (31 ficheros) | 0 |
| `tests/check-hermetic.mjs` | 935 pass; **centro 16 ficheros intactos**; **biblioteca 173 ficheros intactos** | 0 |
| `tools/r16-collision-matrix.mjs` | 6/6 | 0 |
| `tools/r16-e2e.mjs` | 9/9 PASS, 0 SKIP | 0 |
| `tools/r16-routing.mjs` | 18/18 PASS | 0 |
| `tools/r16-portability.mjs` | 29/29 PASS | 0 |
| `tools/r17-perf.mjs` | **11/11 PASS**; `client.js` 454 594 → 532 605 B (+78 011 B = 76,2 KiB; +17,2 %) | 0 |
| `tools/testquality.mjs` | **exit 1 — ROJO PREEXISTENTE**: 1 alta (`tests/state.test.mjs:144`), 30 media, 13 baja | 1 (declarado) |

**Composición de la suite:** 935 = 603 base + 332 de la línea R16–T42. Comparación con R17.1: 912 → **935**
tests y 412 → **420** comprobaciones de `check.mjs` (los 6 chequeos nuevos del manifiesto).

**Presupuesto de rendimiento (R17-A):** tramos documentados en `tools/r17-perf.mjs` — 60 KiB R17 +
8 KiB R17.1 + 16 KiB T42 = 84 KiB, con el delta medido de T42 (+13,6 KiB) dentro del tramo y el gate
relativo `< 20 %` intacto. Los 10 checks de conducta siguen verdes: 0 consultas en arranque, 0 en
inactividad, 1 al abrir el cajón, 1 con el cajón cerrado tras 20 ciclos, 1 solo `setInterval` (refresco
preexistente), 0 `requestAnimationFrame`, 0 `setInterval` en backend, 0 temporizadores de 20 s.

## F. Riesgos residuales (reales)

1. **Publicación pendiente:** la instalación desde GitHub no puede probarse hasta que una persona publique
   la carpeta en `main`/una referencia fija. El plan está escrito; la acción no se ejecutó.
2. **Aceptación viva de T42 pendiente:** el toast global está verificado por contrato, transporte y pruebas
   con mutación; falta la prueba de 12 pasos en un DSH reiniciado con una operación de IA real. El backend
   vivo actual es anterior a T42 (proceso arrancado antes del código), así que la comprobación exige reinicio.
3. **`testquality.mjs` rojo preexistente:** 1 hallazgo alto en `tests/state.test.mjs:144` (catch que no
   verifica). No es regresión de esta línea; se declara y no se silencia.
4. **Presupuesto de bundle agotado:** el tramo T42 deja 2,7 KiB de margen; cualquier crecimiento adicional
   exige aprobación explícita y medición propia.
5. **Secretos heurísticos:** el aviso `possible-secret` es heurístico; la compuerta de calidad de la
   importación bloquea el caso más obvio (`secret.assignment`), pero no promete detección exhaustiva.
6. **Fuentes no consultables:** `hermes-legacy` (fuera de `DSH_HOME`) y `builtin-asar` (contenedor opaco)
   siguen `unavailable`; nunca se presentan como inventario vacío. Concurrencia y `kill -9` sólo están
   cubiertos parcialmente (candado y respaldo, no transacciones del sistema de ficheros).
7. **Conflicto de terceros corregido fuera del repo:** `dsh-plugins-update` necesitó un parche local
   (`_audit/patches/`); si el paquete se reinstala, hay que reaplicarlo hasta que su autor devuelva el
   *disposer* del slot.
8. **Doble capa de deduplicación (R1 de T52):** el `eventId` se filtra en el puente y en el store; quitar
   sólo una capa no rompe ninguna prueba (quitar ambas sí). Es defensa en profundidad, no un defecto, pero
   la capa del puente no está fijada por un test unitario propio.
9. **Fallback de texto en el puente (R2 de T52):** `client.js:7221-7229` aún intenta parsear JSON del texto
   del mensaje si no hay `meta.activity`. La ruta normal es `presentationMeta` y está probada; el fallback
   se conserva por compatibilidad con resultados anteriores a T50 y no tiene prueba propia.
10. **Evidencia interna con rutas de perfil (R5 de T52), mitigada:** `_audit/r16.3-recon/*.json` conserva
    `c:/users/<perfil>` en claves internas y **está excluido** del manifiesto (crudas y duplicados anidados).
    Los candidatos que contenían identificadores de perfil se sanearon antes del congelado:
    `tests/evaluate.test.mjs` (fixture adversaria con nombre genérico `example`),
    `tests/testquality-analyzer.test.mjs` (fixture con `example`), `_audit/T43-PUBLISH-PLAN.md`
    (ruta absoluta → `$env:LOCALAPPDATA\...`) y `_audit/release-verify.md` (referencias redactadas).
    Quedan dos fixtures adversariales con nombres genéricos (`example`, `alguien`) que no son datos de
    perfil; T45 los clasificó como publicables. El paquete npm nunca incluye `_audit/` ni `tests/`.

## G. Acciones humanas pendientes

| # | Acción | Consecuencia si no se hace |
|---|---|---|
| 1 | Autorizar y ejecutar la publicación (rama + commit selectivo + push/PR; tag `v1.0.1` opcional) según `_audit/T43-PUBLISH-PLAN.md` | la instalación desde GitHub sigue BLOCKED |
| 2 | Reiniciar DSH (cerrar ventana/procesos y reabrir; **nunca** disable→enable) y hacer la prueba de 12 pasos del toast en un chat | el aviso global no se ve en producción aunque el código esté listo |
| 3 | Probar la instalación en un perfil temporal aislado con la spec pineada | instalación no verificada (seguirá marcada como tal en docs) |
| 4 | Subir social preview + icono y fijar nombre/descripción/topics en GitHub Settings | branding del repo incompleto (los assets ya están en el árbol) |
| 5 | Decidir sobre los `COMMIT-CANDIDATES/PLAN` y el log de gates (`*.log` excluido por `.gitignore`) | el paquete de entrega queda sin commit |

## H. Aceptación de la directiva (10 criterios)

| # | Criterio | Estado |
|---|---|---|
| 1 | Avisos globales durante la conversación, de operaciones reales, sin duplicados | **VERIFICADO en pruebas/contrato; aceptación viva PENDIENTE** |
| 2 | Activity Center intacto tras T42 | **VERIFICADO** (935/935, r17-ui, drawer sin cambios) |
| 3 | Sin procesos nuevos, polling ni temporizadores | **VERIFICADO** (`r17-perf` 11/11) |
| 4 | Instalable/activable desde GitHub con el Add plugin real | **BLOCKED** (referencia no publicada) |
| 5 | Instalación limpia sin rutas del desarrollador | **PREPARADO** (`files`, sin rutas en docs; prueba pendiente) |
| 6 | Documentación correcta y honesta | **VERIFICADO** (enlaces, privacidad, marcas de no verificado) |
| 7 | Icono y social preview terminados | **VERIFICADO** (assets y dimensiones); **configuración GitHub PENDIENTE** |
| 8 | Gates previos verdes salvo el hallazgo declarado | **VERIFICADO** (14 gates verdes; testquality preexistente) |
| 9 | Informe que distingue verificado/preparado/pendiente | **ESTE DOCUMENTO** |
| 10 | Sin git de escritura ni datos reales alterados | **VERIFICADO** (`center.json`/`knowledge.json` y biblioteca intactos) |

## I. Reproducción

```powershell
cd lifecode-skill-center
node --test                       # 935/935
node tools/check.mjs              # 420/420
node tools/e2e.mjs                # 19/19, centro real intacto
node tools/r17-perf.mjs           # 11/11
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" pack --dry-run --json   # 52 ficheros
cd ..
node _audit\release-run-gates.mjs # batería completa → _audit/release-1.0.1-final-gates.log
```

Verificación independiente asociada: `_audit/release-verify.md` (T52).
## J. Manifiesto y plan de commits (final)

Los dos documentos se **regeneran al congelar el árbol** (después de T44-M y de la sanitización final); sus
cifras, hashes y desglose de control son la fuente de verdad del snapshot de publicación:

- `_audit/COMMIT-CANDIDATES-R17.md` — rutas candidatas con bytes y SHA-256, excluidos con motivo,
  preexistentes de `skill-compiler/` y suma de control contra `git status --porcelain -uall`.
- `_audit/COMMIT-PLAN-R17.md` — commits atómicos con `git add --` por ruta (sin `git add -A`), grupos
  cerrados, manifiestos en un commit final separado fuera de las rutas candidatas, y verificación de
  unicidad y cobertura 1:1.

Si el árbol cambia después de generar el manifiesto, el manifiesto queda obsoleto y debe regenerarse: la
auditoría T45 bloquea la publicación en ese caso (`_audit/T45-PREPUBLICATION-AUDIT.md`, condición B1/B5).
- Capturas: sólo los 8 PNG públicos (`docs/images/`) y sus 8 originales byte a byte; las capturas crudas de `_audit/r16*` y `_audit/r17*` quedan excluidas por nombres de proyecto privados. `T43-PUBLISH-PLAN.md` y `release-verify.md` se conservan con la marca «revisar antes de publicar».

