# LifeCode RAG — estado real de implementación

**Qué es este documento:** la única fuente para responder «¿esto existe?». Cada afirmación lleva **evidencia**
(archivo y línea, medición o acto documentado). Lo que no tenga evidencia va a §7 como inexistente o a §9 como
pendiente de verificar.

**Fecha de la revisión:** 2026-11-24 · **Producto observado:** paquete `1.5.11` · contrato de API del panel `pa/1.5.0`
**Repositorio:** `C:\xampp\htdocs\plugins-dhs-release` · rama `feat/ux22-tracking` · HEAD `7d7e839` (1.5.11 se construye sobre el árbol de trabajo, sin commit)

**Etiquetas:** `HECHO` (verificado en código o medición) · `CITADO` (viene de un acto anterior documentado) ·
`PENDIENTE` (sin verificar en este acto)

---

## 1. Paquete y contratos

| Elemento | Valor | Evidencia |
|---|---|---|
| Versión npm | `1.3.0` | `package.json` · `CITADO`: instalación verificada en DSH real |
| Contrato de las herramientas | `v0.1.0` (congelado, `O-PAR-1`) | `docs/CONTRATO-v0.1.md` |
| Contrato de la API del panel | `pa/1.4.0` | `lib/pa-api.mjs` (`PA_VERSION`) |
| Siete herramientas | `ingest, search, context, get, list, forget, reindex` | `lib/tools.mjs:105-361` |
| Suite de pruebas | **541 casos** | `CITADO`: README §Pruebas y acto de instalación (`541/541`). **No re-ejecutada** en este acto |

## 2. Lo que existe, con evidencia

| Capacidad | Estado | Evidencia |
|---|---|---|
| Un almacén `rag.sqlite3` **por ámbito** | HECHO | `lib/scope-stores.mjs` (un directorio por `scope_id`) |
| Registro **por perfil** (`O-PAR-4`) | HECHO | `lib/profile.mjs`; esquema v2 en `lib/registry-schema.mjs` |
| Resolución de ámbito: sesión → `cwd` → workspace de la sesión/que contiene el `cwd` | HECHO | `lib/resolve.mjs:129-264` |
| Exigencia de **raíz confiable** antes de abrir | HECHO | `lib/resolve.mjs:77-119`; `lib/trusted-roots.mjs` |
| Revalidación de raíz antes de abrir almacén y antes de devolver | HECHO | `lib/exec-context.mjs:113-120, 145-173` |
| Ámbitos efectivos = proyecto + bibliotecas con grant (máx. 8) | HECHO | `lib/resolve.mjs:266-292`; `lib/sessions.mjs:292-343` |
| Recuperación entre ámbitos con merge por score/RRF | HECHO | `lib/scope-ops.mjs:67-120` |
| `context` con presupuesto de tokens y citas | HECHO | `lib/scope-ops.mjs:123-166` |
| Contexto automático con **puerta léxica** (`D-PA6-02`) | HECHO | `lib/auto-context.mjs:157-223` |
| `ingest`/`forget`/`reindex` con **aprobación humana** obligatoria | HECHO | `lib/tools.mjs:38` y las tres definiciones |
| Egreso remoto con aprobación (embeddings) | HECHO | `docs/EMBEDDING-PROVIDERS.md`; `CITADO` |
| Sincronización por raíz con `present`/`missing`/`unreadable` (`O-PAR-5`) | HECHO | `docs/AUTOMATION-POLICIES.md`; `lib/registry*.mjs` |
| Auditoría por registro y por ámbito (`C7`) | HECHO | `lib/registry.mjs` (`audit_registry`), `verifyAuditChain` |
| API del panel: `/config`, `/snapshot`, `/history`, `/workspaces`, `/search`, `/context`, `/selection`, rutas de administración | HECHO | `lib/pa-api.mjs:44-55` y ramas |
| **Workspace Discovery** UX-2.1 (`GET /pa/workspaces`) | HECHO | `lib/workspaces-projection.mjs`; `lib/harness-workspaces.mjs:176-217` |
| Vista Workspaces **de sólo lectura** en el panel | HECHO | `client.js` (`paViewWorkspaces`) |
| Panel con cinco áreas (Resumen · Workspaces · Proyectos · Seguimiento · Ajustes) | HECHO | `README.md` §Interfaz |
| Modo REAL y DEMO del panel | HECHO | `client.js`; `README.md` §Modos |
| Instalación en DSH real `1.3.0` (74/74 ficheros idénticos) | CITADO | Acto de instalación 2026-11-23 (`plans/UX-02/UX-02-2.1-INSTALL-EXECUTION-2026-11-23/`) |

## 3. Las siete herramientas en una línea cada una

Todas comparten prólogo: `withAuthorizedContext` (`lib/tools.mjs:121, 176, 226, 282, 304, 324, 348`). **Ninguna**
recibe proyecto por parámetro.

| Tool | Ámbito | Escribe | Nota |
|---|---|---|---|
| `ingest` | resuelto | almacén del proyecto (+ auditoría) | aprobación si sale de raíz o hay egreso |
| `search` | proyecto + bibliotecas | métricas (proyecto) | falla en cerrado si un ámbito autorizado no se puede leer |
| `context` | proyecto + bibliotecas | **métricas** (`scope-ops.mjs:148-153`) | citas verificables; `truncated` declarado |
| `get` | proyecto + bibliotecas | — | `ref` ambiguo → error, no se elige por orden |
| `list` | **sólo proyecto** | — | no lista bibliotecas |
| `forget` | proyecto | almacén + auditoría | aprobación humana obligatoria |
| `reindex` | proyecto | almacén | aprobación humana obligatoria |

Detalle completo (entradas, salidas, dependencias, límites fuera de DSH): informe de auditoría UX-2.2
(`plans/UX-02/UX-02-2.2-AUDIT-2026-11-23/INFORME-UX-2.2.md` §3).

## 4. Cómo se selecciona un proyecto **hoy** (hecho central)

Hay **dos** selecciones y **sólo una** alimenta a las herramientas:

| | `session_scope` | `pa_selection` |
|---|---|---|
| Granularidad | una fila por **sesión** | una fila por **perfil** |
| La escribe | `registerSelection` (`lib/sessions.mjs:67`) — **sólo el CLI** (`bin/lifecode-rag.mjs:350`) | `applySelection` (`lib/selection.mjs:88`) — **sólo la API** (`lib/pa-api.mjs:838`) |
| La lee | `resolveScope` → **las siete herramientas** | `/snapshot` → **el panel** |
| Efecto en las herramientas | **sí** | **ninguno** |

**Medido en el perfil `desktop`** (sólo lectura, 2026-11-23): `session_scope` = **1 fila**
(`session-c90d50d6-…` → `prj_01M7RBSRD33M26HGBEFW51WPP6`, `explicit`, rev 1); `pa_selection` = **1 fila**
(`profile` → el mismo proyecto, rev **5**, `selected_by='human'`); **3** proyectos; **3** raíces autorizadas;
`trusted_roots` = **1** → `C:\xampp\htdocs\plugins-dhs`.

`INFERENCIA` — Ambos apuntan al mismo proyecto, de ahí que la división no se hubiera notado: coincide por
casualidad, no por diseño.

## 5. Deuda conocida (defectos reales, no propuestas)

| ID | Defecto | Evidencia | Impacto |
|---|---|---|---|
| **P-01** | «Copiar ruta» **no copia**: `onCopy: state.copyText` en `client.js:3700` y `copyText` **nunca** se produce; cero llamadas a `clipboard`/`writeText`/`execCommand` | auditoría PA01 (`plans/UX-02/UX-02-2.1-PA01-DIAG-2026-11-23/`) | el botón dice «Copiada» y no escribe nada |
| **P-02** | «Mostrar ruta» **no cambia** el texto: `.lcr-pa-path__value` con `max-width:240px` + `overflow:hidden` + `text-overflow:ellipsis`; `paShortPath` no toca rutas ≤46 caracteres | ídem | cerrado y abierto pintan lo mismo |
| **P-03** | El texto de **Diagnóstico** dice que integridad, auditoría y versiones «todavía no se leen de la API» | `/snapshot` ya trae `audit.head` y `version`; `/history` trae `integrity` (`verifyAuditChain`) | infravalora lo implementado |
| **P-04** | La **selección del panel** no afecta a las herramientas y nada lo dice en la interfaz | §4 | expectativa equivocada del usuario |
| **P-05** | `context`/`search`/toda resolución **escriben** (métricas y auditoría) aunque se lean como lectura | `lib/scope-ops.mjs:148-153`; `lib/resolve.mjs:294-304` | no se pueden describir como «no escriben» |

## 6. Contradicciones documentales detectadas

| ID | Contradicción | Detalle | Resolución propuesta (no ejecutada) |
|---|---|---|---|
| **C1** | `PROJECT-AWARE-SESSION-CONTRACT.md:36` afirma «sin selección global», pero el registro v2 tiene `pa_selection` **de perfil** | `lib/registry-schema.mjs:111`; `lib/selection.mjs:4-14` | **RESUELTA** por `D-UX22-05` (2026-11-23): `pa_selection` es **selección visual** del panel y no participa en la resolución; la afirmación del contrato queda matizada en su cabecera |
| **C2** | `PROJECT-AWARE-SESSION-CONTRACT.md` llevaba en su cabecera «**Estado: especificación. No implementado.**» y el contrato **está implementado** | `lib/sessions.mjs`, `lib/resolve.mjs` | **RESUELTA** el 2026-11-23: cabecera corregida a «implementado en `1.3.0`» con referencia a `D-UX22-05` y a la especificación de UX-2.2 |
| **C3** | El panel llama «Seguimiento» a un área que dice que el modo fácil «no está disponible hasta su fase», pero no existe **ningún** seguimiento (ni manual) | `README.md` §Interfaz; §7 de este documento | **PENDIENTE**: «Seguimiento» hoy **declara** una fase; el manual es UX-2.2. Cambiar el texto del panel es código (`client.js`), no documentación |
| **C4** | `trusted_root` del perfil real = `C:\xampp\htdocs\plugins-dhs`, y el árbol de release es `…-release` (no cae dentro por prefijo de ruta + `/`) | medición §4 + `UX-22-TRACKING-SPEC.md` §12 + `UX-22-ROOT-PROPOSAL.md` | **DECIDIDA la propuesta (`D-UX22-13 = A`), PENDIENTE la operación**: raíz limitada exactamente a `…\plugins-dhs-release\lifecode-rag`; medido que es un *git worktree* del mismo repositorio y aun así otra raíz para RAG. Sin la aprobación de la operación, la lectura por `cwd` allí se deniega. No se tocó ninguna raíz |
| **C5** | `D-UX-19=B` y `D-INS-01` son decisiones vigentes que **no constan** en el repositorio | `DECISIONES.md` §2 | **PENDIENTE**: traer su texto a `docs/` en un acto aparte, o dejar de citarlas como documentación del producto |

## 7. Lo que **no** existe (para no confundirlo con lo diseñado)

| Elemento | Estado | Dónde está sólo como diseño |
|---|---|---|
| **Seguimiento** de workspaces (tabla, API, interruptor) | **IMPLEMENTADO en rama**, no instalado — ver §10 (esta tabla describe el producto **instalado**, 1.3.0) | `UX-22-TRACKING-SPEC.md`; `ROADMAP-UX.md` (UX-2.2) |
| Asociación persistida workspace → proyecto | **IMPLEMENTADA en rama** (`workspace_tracking`), no instalada — ver §10 | en el producto instalado sigue siendo efímera |
| **Modo fácil** (seguimiento automático) | **NO EXISTE** | `ROADMAP-UX.md` (UX-3) |
| Áreas de conocimiento compartido en el panel | **NO EXISTE** (el motor sí: `libraries` + `grants`) | `ROADMAP-UX.md` (UX-4) |
| Optimización de contexto por proveniencia / `scopes[]` en citas | **NO EXISTE** | `ROADMAP-UX.md` (UX-5) |
| Endpoint `/diagnostics` de la API PA | **NO EXISTE** | no hay ruta en `lib/pa-api.mjs`; `/snapshot` y `/history` cubren parte |
| Versión de plugin/host en la API PA | **NO EXISTE** | `pa/1.4.0` no expone versión de paquete |
| Copia real al portapapeles | **NO EXISTE** | P-01 |

### 7.1 Estado de UX-2.2 en cuatro niveles (no confundirlos)

| Nivel | Estado | Evidencia |
|---|---|---|
| **Decisiones aprobadas** | `D-UX22-01…13` (todas con resolución **A**) | `DECISIONES.md` §1.1 y §1.2 |
| **Especificación documental** | **resuelta**: estados, identidad, asociación, precedencia, API, auditoría, interfaz, aceptación y límite de raíz | `UX-22-TRACKING-SPEC.md`; `UX-22-ROOT-PROPOSAL.md` |
| **Implementación** | **hecha en la rama `feat/ux22-tracking`**, sin instalar en el perfil; 642/642 pruebas | §10 de este documento |
| **Bloqueo de autorización de raíz** | **`D-UX22-13 (operación)` / `D-UX22-BLOCKER-01` = `PENDING`**: sin aprobación humana no se lee nada bajo `…\plugins-dhs-release\lifecode-rag` | `UX-22-ROOT-PROPOSAL.md` §10 |

## 8. Índice de evidencias

| Acto | Documento / carpeta |
|---|---|
| Auditoría y diseño UX-2.2 (investigación de las 7 tools, selección vs seguimiento, modelo propuesto) | `plans/UX-02/UX-02-2.2-AUDIT-2026-11-23/INFORME-UX-2.2.md` |
| **Especificación técnica de UX-2.2** (decisiones aprobadas, precedencia, registro v3, API, auditoría, mapa de aceptación, `BLOCKER-01`) | `docs/UX-22-TRACKING-SPEC.md` |
| **Propuesta de autorización de raíz** (`D-UX22-13 = A`, 10 puntos, sin ejecutar) | `docs/UX-22-ROOT-PROPOSAL.md` |
| **Optimización y confiabilidad (implementada, sin publicar)** — fallback léxico, vectores reutilizados, identidad por colección, SQL sin N+1, `forget` sin estado compartido, etapas y `relUri` | `plans/UX-02/UX-22-IMPL-OPTIMIZATION-2026-11-23/INFORME-IMPLEMENTACION.md`; `docs/CONTRATO-EXTENSIONES-1.4.md` |
| Evidencia de UX-2.1 (pruebas, matriz, auditoría de sólo lectura, smoke de API) | `plans/UX-02/UX-02-2.1-evidence-2026-11-23/` |
| Empaquetado 1.3.0 (tarball, hashes, 74 ficheros) | `plans/UX-02/UX-02-2.1-PACKAGE-1.3.0-2026-11-23/` |
| Preparación y ejecución de la instalación quirúrgica (gates G1-G9, rollback, respaldos 90/90) | `plans/UX-02/UX-02-2.1-INSTALL-PREPARATION-2026-11-23/`, `…-INSTALL-EXECUTION-2026-11-23/` |
| Diagnóstico PA01 (controles muertos, causas A y B, matriz de controles) | `plans/UX-02/UX-02-2.1-PA01-DIAG-2026-11-23/` |
| Preparación de publicación y verificación posterior | `plans/UX-02/UX-02-2.1-PUBLISH-PREPARATION-2026-11-23/` |
| Arquitectura, contratos y presupuestos | `docs/PROJECT-AWARE-ARCHITECTURE.md`, `docs/PROJECT-AWARE-DATA-CONTRACT.md`, `docs/PROJECT-AWARE-SESSION-CONTRACT.md`, `docs/PROJECT-AWARE-ERROR-CONTRACT.md`, `docs/CONTRATO-v0.1.md`, `docs/PA-UI-0-API-CONTRACT.md` |

> Las evidencias de los actos viven en el **repositorio de desarrollo** y no se distribuyen en el paquete
> publicado (`files` excluye `tests/` y `tools/`; `plans/` no se publica).

## 9. Estado a fecha de esta revisión

- **Repositorio:** rama `release/lifecode-rag-1.0.0`, HEAD `7d7e839`, índice vacío, **32 entradas sucias**
  preexistentes. Sin commits, sin merges, sin tags, sin push.
- **Perfil `desktop`:** `@designerbyron/lifecode-rag@1.3.0` instalado (74 ficheros); respaldos `90/90` en
  `~\.dsh\backups\inst-1.3.0-20261123T0355` (`CITADO`).
- **Datos RAG reales:** `registry.sqlite3` `4b67cadc9afee8f6…`; ámbitos `4dcf31c4cb7058bb…` y
  `6130ecbae17b8e82…`; `config.json` `b15622c0ab9f790f…` — sin cambios tras las lecturas de este acto (`HECHO`,
  medido antes y después).
- **Pendiente de verificación en este acto:** recuento de la suite (541 `CITADO`), funcionamiento autenticado del
  panel (PA01 autenticado `PENDIENTE` del propietario: V-1.4, V-1.5, A-2.1…A-2.4, W-3.1…W-3.5, C-7.1…C-7.2).

---

## 10. UX-2.2 — estado a 2026-11-23 (rama `feat/ux22-tracking`)

**Qué es esta sección:** la revisión de §1-§9 describe el producto **instalado** (`1.3.0`/`pa/1.4.0`). Esta sección
describe lo que existe **en la rama de trabajo**, que no está instalado en el perfil del propietario.

**Medición:** `620/620` pruebas PASS (52 538 ms, exit 0), `✓ hermético: el almacén real no cambió (6 ficheros)`,
`node tools/check.mjs` en verde. Repetido tres veces en el acto (595 → 617 → 620) sobre el mismo árbol.

| Elemento | Estado | Evidencia |
|---|---|---|
| `lib/tracking.mjs` — núcleo puro (dos ejes, transiciones, `missing ≠ off`) | `HECHO` | `tests/tracking.test.mjs` |
| `lib/tracking-store.mjs` — CAS transaccional + 5 acciones humanas + reconciliación del sistema | `HECHO` | `tests/tracking-store.test.mjs` |
| Registro **v3** con `workspace_tracking` (aditivo, idempotente) | `HECHO` | `tests/tracking-migration.test.mjs` |
| Escalón 2 de resolución y `scope-conflict` (409) | `HECHO` | `tests/resolve-tracking.test.mjs` |
| API humana `GET/PUT/DELETE /pa/tracking`, `pa/1.5.0` | `HECHO` | `tests/pa-tracking.test.mjs` |
| Campos aditivos `tracked`/`trackingState`/`trackingProject` en `/pa/workspaces` | `HECHO` | `tests/pa-workspaces.test.mjs` |
| Panel `Seguimiento` real (interruptor, estados, filtros, aviso de CAS) | `HECHO` | `tests/client.test.mjs` |
| Invariante «seguir no autoriza nada» | `HECHO` | `tests/tracking-invariants.test.mjs` |
| Instalación en el perfil `desktop` | `PENDIENTE` | no ejecutada; exige acto propio con respaldo y plan |
| Persistencia tras reiniciar la aplicación · panel contra el Host real | `PENDIENTE` | requieren sesión del propietario |

**Deuda declarada:** `P-UX22-01` (extender el fence CSRF a las mutaciones `POST` heredadas) — en curso.
**Corrección documental:** `UX-22-TRACKING-SPEC.md` §5 afirmaba que el código v2 «ignora» una tabla v3; es falso
(`registry.mjs:181-185`). El procedimiento real de vuelta atrás queda escrito allí (`D-IMPL-06`).

---

## 11. Corte 1.5.11 — cierre de F-1, F-2, F-3 y F-4 (2026-11-24)

**Producto:** paquete `1.5.11` · contrato de la API del panel `pa/1.5.0` · almacén v3 · registro v3.
**Evidencia de partida:** aceptación funcional de 1.5.9 en `C:\xampp\htdocs\rc159-artifacts\`
(`EXPEDIENTE-ACEPTACION-UX22-1.5.9.md`, `FASE-D.md`, `auditoria/`). Los cuatro hallazgos se midieron
allí contra el Host real antes de corregirse.

| Hallazgo | Estado | Cambio | Evidencia |
|---|---|---|---|
| **F-1** · dos activos sin selección → el panel decía «Sin conexión» sin selector | `HECHO` | `/` y `/snapshot` responden `200` con `needsProjectSelection: true` + `candidates`; `paViewSelection` pinta el selector y la elección sigue por `POST /selection` con CAS | `lib/pa-api.mjs` (rama `awaitingSelection`), `client.js` (`paViewSelection`), `tests/pa-api.test.mjs` (4), `tests/panel-selection-retry.test.mjs` (2) |
| **F-2** · «Reintentar» no recuperaba la vista | `HECHO` | `retry-view` encola `pending:'reload'` (petición nueva), no duplica si hay una en vuelo y `unavailable` cierra `pending` para que un segundo fallo no deje el botón muerto | `client.js` (`retry-view`, `unavailable`), `tests/panel-selection-retry.test.mjs` (3) |
| **F-3** · «Abrir» medía 26×18 px | `HECHO` | `.lcr-pa-link` con área mínima 36×36 en escritorio y 44×44 en móvil, `white-space: nowrap`, foco visible conservado | `client.js` (hoja `CSS_PA`), `tests/panel-selection-retry.test.mjs` (1), medición en el Host en el expediente de 1.5.11 |
| **F-4** · `search` daba `chunkKey` y `get` no lo aceptaba | `HECHO` | `getSource` resuelve `chunkKey` (id → chunkKey → uri), `get` devuelve ESE fragmento con `matched:{by,ordinal}`; ordinal inexistente → `source-not-found`/`chunk-not-found` | `lib/search.mjs`, `lib/scope-ops.mjs`, `tests/get-chunk-key.test.mjs` (6) |

**Puertas de este corte:** `npm test` **714/714** · `npm run check` ✓ · `npm run test:hermetic` ✓
(almacén vivo de `~/.dsh` sin cambios) · auditoría independiente del TAR con el mismo guion que 1.5.9.

**Por qué el corte se entrega como `1.5.11` y no como `1.5.10`.** El encargo nombró 1.5.10, pero al
reinstalar el artefacto corregido en el laboratorio npm devolvió el tarball **anterior** desde su caché
por `name@version`: el `client.js` instalado no era el del artefacto auditado (huella distinta y sin el
arreglo del relleno móvil). Es exactamente el fallo que documenta la regla de la casa —mismo nombre y
versión, contenido distinto—, así que el contenido autorizado se entregó como **1.5.11**. Los dos
tarballs de 1.5.10 que llegaron a generarse se conservan en `rc1510-artifacts/descartado/` y **nunca**
se publicaron ni quedaron instalados.

**Compatibilidad:** las dos extensiones son aditivas y están registradas en
[`CONTRATO-EXTENSIONES-1.4.md`](CONTRATO-EXTENSIONES-1.4.md) §5 y §6. El contrato v0.1 sigue congelado;
ninguna herramienta cambia de nombre, parámetros ni campos existentes.

**Alcance cerrado:** este corte no abre incrementos nuevos. UX-3, UX-4 y UX-5 siguen **NO
AUTORIZADAS** (ver [`ROADMAP-UX.md`](ROADMAP-UX.md)).
