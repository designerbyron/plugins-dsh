# PA-UI-0 — Criterios de aceptación de la API visual Project-Aware

**Proyecto:** LifeCode RAG · **Fase:** PA-UI-0 (diseño) · **Aplica a:** PA-UI-1 (implementación)
**Contrato de referencia:** `docs/PA-UI-0-API-CONTRACT.md` (`pa-ui/0.1.0-draft`, revisión 3)
**Estado:** PROPOSED — pendiente de aprobación humana · **Fecha:** 2026-11-18 · **Revisiones:** PA-UI-0.1, PA-UI-0.2 y K1 (enmienda de G3)
**Resultado de la revisión PA-UI-0.1:** `BLOCKED` (PA01/identidad de sesión). Los criterios B-08a–d, C-06, C-07, C-11, C-12 y H-09…H-13 se reescriben para ser deterministas; ver `docs/PA-UI-0.1-REVIEW.md`.
**Revisión PA-UI-0.2:** auditoría `ui.read` append-only (H-09…H-13, sin dedupe ni `repeat`), `actor="human"` como origen del canal, y G6 con dos rutas (capacidad del host / aislamiento topológico demostrado). Ambas siguen sin demostración: PA-UI-1 continúa **BLOQUEADA**. Ver `docs/PA-UI-0.2-REVIEW.md`.
**Revisión K1 (2026-11-19, exclusivamente documental):** se corrige **G3** (§L) para separar la **carga** del bundle (`exports["./client"]`, requisito) del **orden de activación** (`dsh.client.inject`, arista opcional); la referencia al contrato pasa a `revisión 3` para coincidir con su cabecera y con `PA-UI-0.2-REVIEW.md` §3 y §8 (X-R-01). Ningún otro criterio cambia y ningún estado de seguridad se altera: G5, G6, G6b, PA01 y D-UI-03 conservan su estado.

> Este documento define **cómo se demuestra** que PA-UI-1 cumple el contrato. No implementa nada.
> Ningún criterio se declara cumplido sin evidencia ejecutada y archivada. Un criterio no ejecutado se reporta como **NO PROBADO**, nunca como PASS.
> Todas las pruebas se ejecutan sobre perfiles y almacenes temporales (`mkdtemp`), nunca sobre `%USERPROFILE%\.dsh`.

---

## 0. Convenciones

- **Precondición**: estado de fixtures necesario.
- **Acción**: petición o función ejecutada.
- **Esperado**: resultado observable exacto (código HTTP, `error.code`, campos, conteos).
- **Evidencia**: artefacto que debe quedar en `eval/pa-ui-1/evidence/` (salida de comando, JSON de respuesta, hash).
- Estados finales por criterio: `PASS` / `FAIL` / `NO PROBADO` / `BLOQUEADO` (con causa) / `PARCIAL` (con qué falta).
- Prohibido en la fase de pruebas: `node --test` desde la raíz del repositorio (dispara `_audit/*-test.mjs`), perfiles reales, almacén legado, red, nuevas dependencias.

---

## A. Contrato y compatibilidad

| Id | Precondición | Acción | Esperado | Evidencia |
|---|---|---|---|---|
| A-01 | repo limpio de artefactos de prueba | comparar `git diff --stat` de `lifecode-rag/lib` y `package.json` antes/después de PA-UI-1 | las siete herramientas y `package.json` no cambian de esquema ni de versión salvo el `exports`/`dsh.client` aprobado en D-UI | `git-diff.txt`, `sha256` de `lib/tools.mjs`, `package.json` |
| A-02 | — | calcular SHA-256 de `docs/CONTRATO-v0.1.md` | `a58db7d6cac0756e2711c5ef556111dc7d38cec206420021e2bc42e42b4068f1` | `hashes.txt` |
| A-03 | contrato cargado | `GET /health` | `200`, `api: "pa-ui/0.1.0-draft"`, `contract: "0.1.0"`, `legacy: false` | `health.json` |
| A-04 | almacén legado ausente (perfil temporal) | arrancar API visual y llamar a `/lifecode-rag/api/health` | `404` (la API v0.2 no se monta) | `legacy-absent.txt` |
| A-05 | contrato de herramientas registrado | `Tool.listTools` del host | exactamente las 7 herramientas `lifecode_rag_*` con los esquemas v0.1 de `CONTRATO-v0.1.md`, sin parámetros nuevos | `tools.json` + diff |
| A-06 | — | revisar nombres de rutas | ninguna ruta contiene `project_id`, `scope_id` ni `session_id` como parámetro de las herramientas públicas | `grep` sin coincidencias |

---

## B. Identidad de sesión

| Id | Precondición | Acción | Esperado | Evidencia |
|---|---|---|---|---|
| B-01 | sesión viva con selección | `GET /session` con cabecera correcta | `200`; `session.id` = id real de la sesión; `profileKey` = perfil de la prueba | `session-ok.json` |
| B-02 | — | `GET /session` **sin** cabecera | `401`, `error.code = "session-invalid"`, `details.reason = "missing-header"`; ningún dato de sesión en el cuerpo | `no-header.json` |
| B-03 | — | `GET /session` con cabecera vacía, `\n`, 201 caracteres, `null` | `401 session-invalid` en todos; sin abrir almacén (verificar con contador de aperturas del fixture) | `bad-ids.txt` |
| B-04 | id sintácticamente válido pero sin agente vivo | `GET /session` | `409 session-unavailable`; no se crea fila en `session_scope`; no se abre registro | `dead-session.json` + consulta al registro |
| B-05 | identidad capturada con un `profileKey` distinto del servicio (guardia de frontera; no construible desde la cabecera HTTP) | `withAuthorizedContext` con esa identidad | `session-invalid` `reason: "profile-mismatch"`; registro intacto; la cabecera HTTP **no** puede fijar `profileKey` | `foreign-profile.json` |
| B-06 | dos sesiones vivas con proyectos A y B | `GET /session` en ambas | cada una ve sólo su proyecto y sus ámbitos; sin intersección | `two-sessions.json` |
| B-07 | sesión A cambia de proyecto | `POST /selection` A→B, luego `GET /session` en A y B | A ve B; B sigue viendo B; ninguna lectura devuelve datos de A | `switch.json` |
| B-08a | sesión **expirada** (`expireSession`) | `GET /session` | `409 session-expired`; `details.reason = "session-expired"`; no se sirven datos; auditoría `ui.read` con `outcome: "denied"` (si la auditoría precede a la denegación) | `expired.json` + auditoría |
| B-08b | id válido, **sin agente vivo** y sin fila en `session_scope` | `GET /session` | `409 session-unavailable`; `details.reason = "agent-unavailable"`; no se sirve nada | `no-agent.json` |
| B-08c | **sin cookie de GUI** (peer no autenticado) | `GET /session` | El host responde `401` **antes** de la ruta del plugin; el cuerpo es del host (forma `[UNKNOWN]`); cero datos RAG; no se escribe auditoría del plugin | `no-cookie.txt` |
| B-08d | cookie de GUI **inválida o caducada** | `GET /session` | Igual que B-08c (`401` del host); la distinción entre «sin credencial» y «credencial inválida» **no** es observable por el plugin (`[GAP-20]`) | `bad-cookie.txt` |

---

## C. Selección de proyecto

| Id | Precondición | Acción | Esperado | Evidencia |
|---|---|---|---|---|
| C-01 | sin selección, cwd dentro de raíz A | `GET /session` | `200` con `selection.state` = `active`, `source: "cwd"`, proyecto A; **no** se persiste selección | `cwd-selection.json` + fila `session_scope` ausente |
| C-02 | sin selección, cwd fuera de toda raíz | `GET /session` | `200` con `selection.state: "unresolvable"`; `GET /sources` → `409 scope-unresolved`; **no** búsqueda global | `unresolved.json` |
| C-03 | cwd dentro de dos raíces | `GET /session` | `selection.state: "ambiguous"` con candidatos (id/nombre); `GET /sources` → `409 scope-ambiguous` | `ambiguous.json` |
| C-04 | selección A, cwd en B | `GET /session` | `ambiguous`; `POST /selection` A no «corrige» el estado | `conflict.json` |
| C-05 | sin selección (revisión 0), cwd en A | `POST /selection` `{projectId: A, expectedRevision: 0}` | `200 changed:true`; `revision: 1`; auditoría `session.select` con `actor: "human"`; `GET /session` refleja `source: "explicit"` | `select.json` + `audit_registry` |
| C-06 | sesión con A (revisión 1) | `POST /selection` `{projectId: B, expectedRevision: 1}` (B activo, fuera de candidatos) | `403 scope-forbidden`, `reason: "project-unavailable"`; A intacto; auditoría de la denegación | `not-candidate.json` |
| C-07 | — | `POST /selection` con `{projectId: "prj_inexistente", expectedRevision: 0}` | `403 scope-forbidden`, `reason: "project-unavailable"`; **cuerpo de error idéntico a C-06** (salvo `correlationId` de cabecera); sin escritura | `missing-project.json` + diff |
| C-08 | proyecto archivado | `POST /selection` | `403 scope-forbidden reason: "project-unavailable"` (no se distingue de inexistente); sin escritura | `archived.json` |
| C-09 | sesión invalidada | `POST /selection` | `403 scope-forbidden` con `reason` de invalidación (`project-archived`/`grant-revoked`/`root-revoked`/`profile-changed`/`admin`/`session-cloned`); sin escritura | `invalidated.json` |
| C-10 | sesión con A, revisión 2 | `POST /selection` `{projectId: A, expectedRevision: 2}` | `200 changed:false`; `revision: 2` (no sube); no nueva fila de auditoría de escritura | `idempotent.json` |
| C-11 | — | `POST /selection` con `{projectId, expectedRevision, sessionId: "otra"}` | `400 invalid-argument`, `reason: "unknown-field"`, `details.fields: ["sessionId"]`; sin escritura; el valor **nunca** se usa | `body-session-id.json` |
| C-12 | dos pestañas, misma sesión, `expectedRevision: 1` y otro ya seleccionó (revisión 2) | `POST /selection` | `409 revision-conflict` con `details {expectedRevision: 1, currentRevision: 2}`; selección intacta (sigue la del ganador); reintento con `expectedRevision: 2` → `200` | `revision.json` |
| C-13 | — | `GET /session?projectId=prj_x` | `400 invalid-argument`, `reason: "unknown-parameter"`, `details.parameters: ["projectId"]`; jamás selecciona ámbito | `unknown-param.json` |
| C-14 | — | `POST /selection` sin `expectedRevision` o con `-1`/`"x"` | `400 invalid-argument`, `reason: "invalid-field"`; sin escritura | `no-revision.json` |

---

## D. Bibliotecas, grants y ámbitos

| Id | Precondición | Acción | Esperado | Evidencia |
|---|---|---|---|---|
| D-01 | proyecto A con biblioteca L1 concedida | `GET /libraries` | contiene L1 con `permission: "read"`, `store: "present"` | `libraries.json` |
| D-02 | L1 concedida a B, no a A | `GET /libraries` en A | L1 **no** aparece; ningún nombre ni id de L1 | `no-grants.json` |
| D-03 | L1 revocado en A | `GET /libraries` en A | L1 desaparece; `GET /session` informa caída a ámbitos restantes (5 s) o `scope-forbidden` si el proyecto lo requiere | `revoked.json` |
| D-04 | 7 bibliotecas + proyecto | `GET /session` | `scopeCount: 8` | `max-scopes.json` |
| D-05 | 8 bibliotecas concedidas | `GET /session` | `409 scope-too-many` con `limit: 8`; nunca truncamiento silencioso | `too-many.json` |
| D-06 | biblioteca con almacén ausente | `GET /libraries` | `store: "missing"`; `GET /sources` sigue sirviendo el proyecto | `lib-missing.json` |
| D-07 | biblioteca con almacén corrupto | `GET /libraries` | `store: "corrupt"`; `POST /search` → `409/500 scope-store-corrupt` (fail-closed) | `lib-corrupt.json` |
| D-08 | biblioteca de otro perfil en disco | `GET /libraries` en esta sesión | no aparece; no se abre (verificar contador) | `foreign-store.json` |
| D-09 | grant revocado entre `/session` y `/search` | `POST /search` | `403 grant-revoked` o resultados sin L1; nunca datos de L1 | `mid-op-revoke.json` |

---

## E. Fuentes

| Id | Precondición | Acción | Esperado | Evidencia |
|---|---|---|---|---|
| E-01 | proyecto A con 3 fuentes | `GET /sources` | `total: 3`; filas con `id, uri, title, collection, bytes, chunks, updatedAt` | `sources.json` |
| E-02 | 121 fuentes | `GET /sources?limit=50&offset=100` | 21 filas; `total: 121`; orden `updated_at DESC, id` | `paging.json` |
| E-03 | límite > 200 | `GET /sources?limit=1000` | `400 invalid-argument` o recorte documentado a 200; nunca 1000 | `limit.json` |
| E-04 | fuente de A | `GET /sources/<id>` | `200` con `source` y `chunks`; `text` recortado al límite | `source.json` |
| E-05 | uri repetida en proyecto y biblioteca | `GET /sources/<uri-de-biblioteca>` | `404 source-not-found` (sólo se resuelve en el almacén del proyecto) | `scope-local.json` |
| E-06 | id de fuente de otro proyecto | `GET /sources/<id-B>` | `404`; sin filtración de existencia | `foreign-id.json` |
| E-07 | fuente con 500 fragmentos | `GET /sources/<id>?limit=200` | 200 fragmentos, `chunksTotal: 500` | `chunks-limit.json` |

---

## F. Búsqueda y contexto

| Id | Precondición | Acción | Esperado | Evidencia |
|---|---|---|---|---|
| F-01 | A con fuente A1; B con B1 | `POST /search` en A | resultados de A; **ninguno** con `uri` de B ni `scopeId` de B | `search-a.json` |
| F-02 | idem en B | `POST /search` en B | resultados de B; ninguno de A | `search-b.json` |
| F-03 | L1 concedida | `POST /search` en A | resultados pueden venir de L1 con `scopeKind: "lib"` y `scopeName` | `search-lib.json` |
| F-04 | — | `POST /search` sin `query` o `query: ""` | `400 invalid-argument` | `search-empty.json` |
| F-05 | — | `POST /search` `{limit: 51}` | `400 invalid-argument` (máximo 50) | `search-limit.json` |
| F-06 | — | `POST /search` con consulta de 513 caracteres | `400` o recorte documentado (según D-UI-09) | `search-long.json` |
| F-07 | biblioteca corrupta concedida | `POST /context` | `409/500 scope-store-*`; **no** contexto parcial | `context-failclosed.json` |
| F-08 | — | `POST /context` | claves exactas de v0.1: `text, citations, tokens, truncated, considered` (+ `scopes`), y 9 campos por cita | `context-shape.json` |
| F-09 | dos ámbitos con la misma uri | `POST /search` | dos filas distinguibles por `scopeId`; sin fusión | `two-scopes.json` |
| F-10 | — | `POST /search` sin cabecera de sesión | `401`; no se ejecuta el motor (contador de búsquedas en 0) | `search-noauth.txt` |

---

## G. Errores y diagnóstico

| Id | Precondición | Acción | Esperado | Evidencia |
|---|---|---|---|---|
| G-01 | registro ausente | `GET /session` | `503 registry-unavailable`; el directorio del perfil **no** se crea | `registry-missing.json` + `Test-Path` |
| G-02 | registro corrupto | `GET /session` | `500 registry-corrupt`; sin detalle SQL | `registry-corrupt.json` |
| G-03 | error 500 simulado | cualquier ruta | cuerpo sin `stack`, sin rutas absolutas, sin SQL; `details` ausente o redactado | `error-shape.txt` |
| G-04 | — | `GET /diagnostics` | claves §6.9; `roots` como conteo; sin `home`, sin rutas de almacén, sin credenciales | `diagnostics.json` |
| G-05 | — | `GET /diagnostics` sin sesión | `401`; sin datos de otras sesiones | `diag-noauth.json` |
| G-06 | — | revisar mensajes de todos los códigos §7 | cada uno con mensaje seguro y HTTP declarado | `error-table.txt` |

---

## H. Seguridad operativa

| Id | Precondición | Acción | Esperado | Evidencia |
|---|---|---|---|---|
| H-01 | servidor con API visual | petición con `Origin: http://evil.example` | `403` por `requestRejection`/`assertLoopback` | `origin.json` |
| H-02 | — | petición con `Host` no loopback | `403` | `host.json` |
| H-03 | — | `POST /selection` sin `x-lifecode-rag: 1` | `403 forbidden-write`; sin escritura | `write-guard.json` |
| H-04 | — | `POST` con `content-type: text/plain` | `415 unsupported-media-type`; sin escritura | `content-type.json` |
| H-05 | — | `?projectId=`/`?scope=` en cualquier ruta | `400 invalid-argument` `reason: "unknown-parameter"`; jamás seleccionan ámbito | `params.json` |
| H-06 | sesión X viva | `GET /session` con la cabecera de X desde otra pestaña del mismo navegador | sirve X (el canal no distingue pestañas: límite T1 declarado); nunca devuelve datos de una tercera sesión | `cookie.json` + nota |
| H-07 | — | renderizar título/snippet con `<script>` en el cliente | se muestra como texto; sin ejecución | captura `xss.png` |
| H-08 | — | dos peticiones concurrentes de sesiones distintas | sin cruce de datos (10 iteraciones) | `concurrent.json` |
| H-09 | API visual operativa | cualquier lectura de §5 | exactamente **un** evento `ui.read` **nuevo** por petición servida, con `tool="lifecode_rag_ui"`, `action="ui.read"`, `actor="human"` (origen del canal, no identidad autenticada), `session_id` efectivo, `target` de la lista cerrada, `outcome` y `detail` con `{operation,status,durationMs,projectId?,scopeCount?}` ≤512 B y **sin** `repeat` | `audit-read.jsonl` |
| H-10 | — | revisar el evento `ui.read` | **no** contiene query, texto recuperado, URIs, rutas, cookies ni ids de ámbito internos; `details` cumple la lista cerrada (comparación con esquema) | `audit-schema.json` |
| H-11 | almacén de auditoría en solo lectura | `GET /session` | `503 audit-unavailable`; **no** se sirve la lectura (fail-closed) | `audit-fail.json` |
| H-12 | — | 3 peticiones idénticas en <5 s | **tres** filas independientes, con `seq`, `at` y `call_id` propios; ninguna fila se modifica ni se agrega; la cadena `prev_hash`/`hash` sigue válida | `audit-append.jsonl` |
| H-13 | tras H-12 | releer las filas y recalcular la cadena | los hashes de las tres filas son los mismos que al escribirse; ninguna actualización posterior (comprobar que no existe `UPDATE` en el flujo) | `audit-immutable.json` |

---

## I. Aislamiento y revocación

| Id | Precondición | Acción | Esperado | Evidencia |
|---|---|---|---|---|
| I-01 | fixtures A/B completos | todas las rutas de lectura en A y B | ninguna respuesta de A contiene `prj_B`, `lib_B`, URIs de B ni `scopeId` de B (y viceversa) | `isolation.json` |
| I-02 | A con L1; L1 revocado | `GET /libraries`, `POST /search`, `GET /session` | L1 desaparece; búsqueda sin L1; `scopeCount` baja | `revocation.json` |
| I-03 | revocación **durante** una búsqueda (hook en `searchScopes`) | `POST /search` | `403 grant-revoked`; sin resultados de L1 | `mid-search.json` |
| I-04 | revocación durante `context` | `POST /context` | `403`; sin texto de L1 | `mid-context.json` |
| I-05 | scope añadido a mitad de operación | `POST /search` | la instantánea no se amplía; el nuevo scope no aparece | `added-scope.json` |
| I-06 | error de resolución | `GET /sources` sin selección | `409 scope-unresolved`; **nunca** búsqueda global | `no-global.json` |
| I-07 | almacén de A borrado en caliente | `GET /sources` | proyecto vacío (`total: 0`) o `scope-store-unavailable`; sin crash | `store-gone.json` |
| I-08 | conexiones abiertas | fin de cada petición | `openedScopes` se cierra; WAL liberado (sin `-wal` huérfano) | `handles.json` |

---

## J. Rendimiento y límites

| Id | Precondición | Acción | Esperado | Evidencia |
|---|---|---|---|---|
| J-01 | 8 ámbitos, 121 fuentes | 100 `POST /search` secuenciales | p95 < 500 ms `[PROPUESTA]`; sin crecimiento de memoria desmedido | `bench-search.json` |
| J-02 | — | 20 `GET /sources` | p95 < 100 ms `[PROPUESTA]` | `bench-sources.json` |
| J-03 | — | respuesta de 50 resultados | tamaño < 1 MiB | `size.json` |
| J-04 | — | petición abortada (`AbortSignal`) | `499/408`; recursos cerrados | `abort.json` |
| J-05 | — | 10 peticiones concurrentes | sin errores `SQLITE_BUSY` no gestionados; `retryable` donde aplique | `busy.json` |

Las cifras marcadas `[PROPUESTA]` son decisiones pendientes (D-UI-09), no capacidades observadas. Las medidas locales del banco de eficiencia (32–45 ms) son referencia del motor, no del canal HTTP.

---

## K. No regresión

| Id | Precondición | Acción | Esperado | Evidencia |
|---|---|---|---|---|
| K-01 | — | `node --test` en `lifecode-rag/` | toda la suite en verde (279 pruebas al cierre de PA3) | `node-test.txt` |
| K-02 | — | `node tools/hermetic.mjs` | almacén real sin cambios | `hermetic.txt` |
| K-03 | — | `node tools/check.mjs` | 7 herramientas, sin dependencias, manifiesto correcto | `check.txt` |
| K-04 | — | `node eval/pa0/sql-check.mjs` | 13/13 PASS | `pa0-sql.txt` |
| K-05 | — | `node eval/pa1/link-check.mjs` | 0 enlaces rotos | `pa1-links.txt` |
| K-06 | — | comparar `lib/tools.mjs`, `lib/exec-context.mjs`, `lib/resolve.mjs` | SHA-256 idénticos a PA3 salvo cambios aprobados y documentados | `hashes.txt` |

---

## L. Puertas de aprobación para PA-UI-1

PA-UI-1 no puede comenzar hasta que se cumplan **todas**:

| Gate | Condición | Verificación |
|---|---|---|
| G1 | Los tres documentos PA-UI-0 aprobados por una persona | firma/registro humano |
| G2 | D-UI-01…D-UI-11 resueltas o explícitamente aplazadas | contrato §11 |
| G3 | La mitad cliente puede cargarse: `package.json` con `exports["./client"]` resoluble (**requisito de carga**) y `dsh.client.platform === "web"`. Las aristas `dsh.client.inject` **no** son requisito de carga: sólo ordenan la activación y se exigen únicamente si el panel consume un slot de otro paquete (GAP-01) | `node tools/check.mjs` extendido: `exports["./client"]` (cadena o `{ "default": "…" }`), `platform === "web"` y, si hay aristas, que el paquete inyectado esté montado |
| G4 | El cliente registra slots con la API vigente `ctx.slots.inject(key, cb)` (GAP-01) | prueba de slot en host |
| G5 | Identidad de sesión obtenible desde el slot de conversación (patrón skill-center) en una prueba real | prueba en host con captura |
| G6 | **Al menos una** de las dos rutas: **(A)** capacidad de sesión del host (verificable, ligada a sesión y emisor, con validación y rechazo de capacidades inválidas/expiradas/de otra sesión); o **(B)** aislamiento topológico **demostrado** con TI-1…TI-7 (contrato §3.6), con evidencia reproducible y revisión humana. La ruta B **reduce superficie, no autentica sesión**. Si ninguna se demuestra, G6 sigue `BLOCKED`. | registro técnico (A) o evidencia TI-1…TI-7 + revisión (B) |
| G6b | `ui.read` implementado, fail-closed y verificado con H-09…H-13 | H-09…H-13 en verde |
| G7 | No hay fallback al almacén legado en la nueva API | prueba A-04 + revisión |
| G8 | Suite RAG verde, hermética verde, sin cambios en v0.1 | K-01…K-06 |

La **aceptación humana explícita del riesgo** (D-UI-03) es una decisión independiente: puede registrarse, pero **no** sustituye a la evidencia técnica de la ruta A ni a la demostración de la ruta B, y **no** se considera otorgada por PA-UI-0.2.

Si G3–G6 no se cumplen, PA-UI-1 debe declararse **BLOQUEADO** en su parte de cliente y **PARCIAL** en la de backend, nunca PASS. Hoy G3–G6 **no** se cumplen: PA-UI-0.1 y PA-UI-0.2 cierran en `BLOCKED`.

### G3 — precisión de la enmienda K1 (2026-11-19)

G3 distingue cinco cosas que no son la misma, y sólo las dos primeras son requisito de carga:

| Concepto | Qué es | ¿Requisito de carga? |
|---|---|---|
| Disponibilidad del bundle | existe un `client.js` construido y servible | condición previa (no basta) |
| `exports["./client"]` | el manifiesto **resuelve** ese bundle; sin él el compositor del host lanza `client-modules: <paquete> declares dsh.client but exports no "./client" bundle` | **sí** |
| `dsh.client` | declaración de la mitad de navegador (`platform: "web"`); sin ella el paquete no es fila de cliente | **sí** (declaración) |
| `dsh.client.inject` | aristas de **orden**: paquetes cuyas fábricas deben llegar antes de materializar esta fila | **no**; sólo si hay dependencia real de slot |
| Activación e inicialización | registro de slots con la API vigente, locales y disposición de efectos | se mide en **G4**, no en G3 |

La redacción anterior exigía `dsh.client.inject` como condición universal; eso convertía una arista opcional en un requisito y podía dejar el plugin en `pending (waiting for service: …)` al declarar como dependencia un paquete no montado. La evidencia del host (0.2.2-rc.5) y la justificación completa están en `lifecode-rag/eval/pa-ui-1/evidence/G3-AMENDMENT.md`.

G3 acredita que el paquete **puede cargarse**; no acredita que el cliente se monte. Eso se demuestra en G4 y en la prueba visual de la fase.

---

## M. Evidencia obligatoria

- Carpeta: `eval/pa-ui-1/evidence/` (creada en PA-UI-1).
- Por criterio: comando ejecutado (texto literal), salida cruda, y el JSON de respuesta si aplica.
- Un resumen `ACCEPTANCE-RESULTS.md` con una fila por criterio y su estado final, y `hashes.txt` con SHA-256 de los artefactos.
- Los estados `NO PROBADO`/`BLOQUEADO`/`PARCIAL` se listan aparte con la causa concreta; no se promedian con los `PASS`.

---

## N. Criterios no verificables en PA-UI-0

| Criterio | Motivo | Cómo se declara |
|---|---|---|
| Carga real del cliente y ocupación de slots | la mitad cliente no existe hoy (GAP-01) | BLOQUEADO hasta G3/G4 |
| Identidad de sesión de extremo a extremo por HTTP | no hay canal de identidad en el peer (GAP-03); el host autentica autoridad, no sesión (GAP-19) | **BLOCKED** (PA01); GAP-20 `OPEN / DOCUMENTED HOST LIMITATION` |
| p95 de rendimiento | cifras propuestas, no medidas en HTTP | NO PROBADO hasta banco en PA-UI-1 |
| Concurrencia optimista de selección | `registerSelection` no la soporta (GAP-09) | REQUIRES IMPLEMENTATION; contrato cerrado en revisión 2 |
| Aislamiento topológico (G6 ruta B) | no se ejecutan pruebas ni se cambia topología en fase documental (contrato §3.6) | **NOT DEMONSTRATED** |
