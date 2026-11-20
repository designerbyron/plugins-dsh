# PA-UI-0.1 — Revisión documental del contrato Project-Aware UI

**Proyecto:** LifeCode RAG · **Fase:** PA-UI-0.1 (revisión documental) · **Fecha:** 2026-11-18
**Documentos revisados:** `PA-UI-0-API-CONTRACT.md`, `PA-UI-0-ACCEPTANCE.md`, `PA-UI-0-GAPS.md` (versión PA-UI-0 del 2026-11-18)
**Alcance:** exclusivamente documental. No se modificó código, manifiestos, perfiles, registry, almacenes ni Git.
**Resultado global:** **`BLOCKED`** por PA01 (identidad/autenticación de sesión). PA02, PA03, PA04 y PA05 quedan resueltos documentalmente. **PA-UI-1 sigue BLOQUEADA.**

> **Nota de revisión PA-UI-0.2 (2026-11-18, documental):** este informe se conserva como historial. PA-UI-0.2 corrigió tres puntos de lo aquí escrito: (1) la deduplicación de `ui.read` con `repeat` se **eliminó** (append-only estricto, contrato §7.1); (2) `actor` se fija en `human` como **origen del canal**, no como identidad autenticada; (3) el riesgo residual deja de describirse como «aceptado»: GAP-20/RR-03 pasan a **`OPEN / DOCUMENTED HOST LIMITATION`** y D-UI-03 queda **no otorgada**. Se añade además la ruta de aislamiento topológico (`NOT DEMONSTRATED`, contrato §3.6). Ver `docs/PA-UI-0.2-REVIEW.md`.

---

## 1. Resumen ejecutivo

La revisión confirma un hecho que PA-UI-0 había tratado como riesgo residual aceptable: **el host no ofrece ninguna primitiva que permita a un plugin demostrar que una petición HTTP pertenece a una sesión de conversación concreta**.

- El host autentica **autoridad** (host:puerto) mediante una cookie de GUI de 30 días, sin logout (`dsh-client-connection/src/browser-auth.ts`).
- Todas las conexiones de navegador comparten un único `browserPeer` con `principal: {kind:'owner'}` (`dsh-client-connection/README.md`, líneas 41–51).
- El "trust fence" de las peticiones API declara explícitamente que *nunca establece identidad* (`api-request-trust.ts`, línea 12).
- El controlador de sesiones recibe el `sessionId` como **parámetro de direccionamiento** del llamante y sólo aplica `remoteAccess` a peers no-owner (`dsh-api-session-controller`, `remoteAccess.allows`); el owner nunca se comprueba.
- `dsh-authorization` resuelve credenciales de proveedores, no capacidades de sesión para HTTP.

`ctx.agents.get(id)` demuestra que el agente **existe**, no **quién llama**. En consecuencia:

- D-UI-02 (transporte de identidad) y D-UI-03 (aceptar riesgo residual) → **`BLOCKED`**.
- La cabecera `x-lifecode-rag-session` se redefine como **direccionamiento**, no autenticación; el riesgo residual se documenta con sus mitigaciones y **no se declara aceptado** (requiere decisión humana).
- PA02 (`expectedRevision`), PA03 (`ui.read`), PA04 (criterios deterministas) y PA05 (clasificación de límites) quedan cerrados documentalmente.

Un proceso local que obtenga la cookie del GUI (o el token de lanzamiento) puede hablar como `owner` y nombrar cualquier sesión viva. Es el mismo modelo que las APIs de sesión nativas del harness: la frontera no está en el plugin, está en el host. **No se inventa ninguna API del host.**

---

## 2. Método y evidencia (sólo lectura)

| Fuente | Qué se leyó | Qué demuestra |
|---|---|---|
| `dsh-client-connection/src/browser-auth.ts` | registro de credencial `client-connection/browser-session`; token de lanzamiento por proceso; cookie firmada `dsh-auth-<sha256(authority)>` `{version,authority,issuedAt,expiresAt}`; `cookieMaxAgeDays` (30); `authorizeConnect` emite cookie v2 con `PeerId` | el sujeto es la **autoridad**, no la sesión; no hay logout (sólo borrar cookie/credencial y reiniciar) |
| `dsh-client-connection/src/api-request-trust.ts:12` | comentario y `isTrustedApiRequest` | la comprobación de Host/Origin/sec-fetch-site **no** establece identidad |
| `dsh-client-connection/README.md` (41–51) | `browserPeer` compartido, `owner`; no hay nivel por método; «There is no logout operation» | no existe peer por pestaña ni por conversación |
| `dsh-client-connection/src/peer.ts:16` | `PeerOptions.principal` fijo en construcción | un Peer no cambia de principal |
| `dsh-api-remote-access/README.md` | `allows()` sólo decide para peers no-owner | «The owner … is never checked» |
| `dsh-api-session-controller/src/index.ts:85–104, 284, 298` | `sessionId` como parámetro de direccionamiento; filtro `remoteAccess` sólo no-owner | la sesión se **nombra**, no se **prueba** |
| `dsh-authorization` | flujos OAuth/token de proveedores | no es una capacidad de sesión HTTP |

Lectura hecha sobre el `app.asar` de la instalación actual con `DSH_INSTALL_DIR` + `ELECTRON_RUN_AS_NODE=1`; sin modificar la instalación. La instalación no se reinició ni se reinstaló.

---

## 3. Matriz de decisiones D-UI-01…10

| Id | Decisión | Estado PA-UI-0.1 | Evidencia / motivo |
|---|---|---|---|
| D-UI-01 | Prefijo `/lifecode-rag/ui/api` | CONFIRMADA | no colisiona con `/lifecode-rag/api` (v0.2, condicional) |
| D-UI-02 | Transporte por cabecera + `agents.get` | **BLOCKED** | la cabecera es direccionamiento; el host no autentica sesiones (§1) |
| D-UI-03 | Aceptar riesgo residual | **BLOCKED / PENDING HUMAN APPROVAL** | exige aceptación escrita; sin ella PA-UI-1 no cierra identidad |
| D-UI-04 | `expectedRevision` en `POST /selection` | **RESUELTA DOCUMENTALMENTE** | contrato §6.2: obligatoria, CAS atómico, `409 revision-conflict` sin escritura |
| D-UI-05 | Candidatos = `cwd` ∪ actual | CONFIRMADA | contrato §6.1/§6.2; sin descubrimiento global |
| D-UI-06 | Sin paginación de búsqueda | CONFIRMADA | límite 8/50; fuera de alcance paginar |
| D-UI-07 | Auditoría `ui.read` | **RESUELTA DOCUMENTALMENTE** | contrato §7.1: campos, exclusiones, fail-closed (el dedupe se eliminó en PA-UI-0.2) |
| D-UI-08 | Diagnóstico con rutas redactadas | CONFIRMADA | `/diagnostics` sólo conteo por ámbito |
| D-UI-09 | Límites provisionales clasificados | CONFIRMADA | contrato §8: CONTRATO / MEDIDO / PROVISIONAL / DECISIÓN UX |
| D-UI-10 | `session-unavailable` 409 | CONFIRMADA | contrato §7; antes 401 |

**Resultado:** `BLOCKED` por D-UI-02/D-UI-03.

---

## 4. Matriz de aceptación (criterios modificados)

Condición previa, acción, resultado esperado, HTTP, código y evidencia documental. Todos son reproducibles por dos evaluadores independientes.

| Id | Condición previa | Acción | Esperado | HTTP | Código | Evidencia |
|---|---|---|---|---|---|---|
| B-02 | — | `GET /session` sin cabecera | no sirve datos de sesión | 401 | `session-invalid` `reason: missing-header` | contrato §3.3, §7 |
| B-04 | id válido, sin agente | `GET /session` | `session-unavailable`; no crea fila | 409 | `session-unavailable` | contrato §4, §7 |
| B-05 | identidad capturada con otro `profileKey` | `withAuthorizedContext` | `profile-mismatch`; cabecera no fija perfil | — | `session-invalid` | contrato §3.3; resolver PA2 |
| B-08a | sesión expirada | `GET /session` | `session-expired`; sin datos | 409 | `session-expired` | contrato §7 |
| B-08b | id válido, sin agente y sin fila | `GET /session` | `session-unavailable`; sin datos | 409 | `session-unavailable` | contrato §7 |
| B-08c | sin cookie de GUI | `GET /session` | 401 del host; cero datos RAG | 401 | `unauthenticated` `[HOST]` | contrato §7 (fila host) |
| B-08d | cookie inválida/caducada | `GET /session` | idéntico a B-08c; indistinguible | 401 | `unauthenticated` `[HOST]` | GAP-20 |
| C-05 | sin selección | `{projectId:A, expectedRevision:0}` | `changed:true`, `revision:1` | 200 | — | contrato §6.2 |
| C-06 | sesión con A, rev. 1 | `{projectId:B, expectedRevision:1}` | `project-unavailable` | 403 | `scope-forbidden` | contrato §6.2, §7 |
| C-07 | — | `{projectId:"prj_inexistente", expectedRevision:0}` | **cuerpo idéntico a C-06** | 403 | `scope-forbidden` `reason: project-unavailable` | contrato §7 (no enumeración) |
| C-08 | proyecto archivado | `POST /selection` | igual que C-07 | 403 | `scope-forbidden` | contrato §7 |
| C-10 | sesión con A, rev. 2 | misma selección, `expectedRevision:2` | `changed:false`; no sube revisión | 200 | — | contrato §6.2 |
| C-11 | — | `{projectId, expectedRevision, sessionId:"x"}` | `unknown-field`, sin escritura, valor no usado | 400 | `invalid-argument` | contrato §5 |
| C-12 | dos pestañas, rev. desfasada | `POST /selection` | conflicto sin escritura; reintento correcto | 409 | `revision-conflict` | contrato §6.2 |
| C-13 | — | `GET /session?projectId=…` | `unknown-parameter` | 400 | `invalid-argument` | contrato §5 |
| C-14 | — | sin `expectedRevision` / negativa / no entera | `invalid-field` | 400 | `invalid-argument` | contrato §6.2 |
| H-03 | — | `POST` sin `x-lifecode-rag: 1` | `forbidden-write`, sin escritura | 403 | `forbidden-write` | contrato §9.1 |
| H-04 | — | `POST` con `text/plain` | `unsupported-media-type` | 415 | `unsupported-media-type` | contrato §5 |
| H-05 | — | query desconocida en cualquier ruta | `unknown-parameter` | 400 | `invalid-argument` | contrato §5 |
| H-06 | sesión X viva | cabecera X desde otra pestaña | sirve X (límite T1 declarado); nunca una tercera sesión | — | — | contrato §9.2 (T1) |
| H-09 | API operativa | cualquier lectura | un evento `ui.read` por petición con campos cerrados | — | — | contrato §7.1 |
| H-10 | — | inspeccionar el evento | sin query/texto/URIs/rutas/cookies/ids internos | — | — | contrato §7.1 |
| H-11 | auditoría en sólo lectura | `GET /session` | fail-closed | 503 | `audit-unavailable` | contrato §7.1 |
| H-12 | — | 3 peticiones idénticas <5 s | *(histórico PA-UI-0.1; reemplazado en PA-UI-0.2: tres filas independientes, H-12 vigente en ACCEPTANCE)* | — | — | contrato §7.1 |

Los criterios no modificados (A, D, E, F, G, I, J, K) se conservan tal cual; los afectados indirectamente (F-06 por `ui.read`, K-06 por no tocar v0.1) ya exigían auditoría/compatibilidad y no cambian de resultado.

---

## 5. Matriz de gaps

El detalle por GAP está en `PA-UI-0-GAPS.md` §4.1. Recuento:

| Estado | GAP |
|---|---|
| `BLOCKED` | GAP-03, GAP-18, GAP-19 |
| `RESOLVED DOCUMENTALLY` (+ implementación pendiente) | GAP-07, GAP-09, GAP-12, GAP-17 |
| `REQUIRES IMPLEMENTATION` | GAP-01, GAP-02, GAP-04, GAP-05, GAP-06, GAP-08, GAP-10, GAP-13, GAP-14, GAP-16 |
| `OPEN` | GAP-11 (TTL: decisión humana), GAP-15 (streaming), GAP-20 (limitación del host; estado PA-UI-0.2: `OPEN / DOCUMENTED HOST LIMITATION`, no aceptada) |

Nuevos: **GAP-19** (el host no emite capacidad por sesión) y **GAP-20** (el plugin no distingue «sin credencial» de «credencial inválida»). Ningún GAP se cierra por reformulación.

---

## 6. Alternativas evaluadas para PA01

| # | Alternativa | Veredicto |
|---|---|---|
| A | Capacidad/credencial emitida por el host por sesión | **No existe** en 0.2.2-rc.5; no verificable; no se inventa |
| B | Token emitido por el plugin al cargar el panel | Rechazada: viaja por el mismo canal `owner`; una pestaña podría reutilizarlo; no liga a sesión |
| C | Ligar la petición a `peer.id` | Rechazada: `browserPeer` es único y compartido; el `PeerId` de `/connect` no identifica conversación |
| D | Aislar por topología (host/`DSH_HOME`/perfil dedicado, loopback) | **Mitigación de superficie**, no autenticación; sólo sirve si se demuestran TI-1…TI-7 (contrato §3.6). Hoy `NOT DEMONSTRATED` |
| E | Cabecera como direccionamiento + auth de host + auditoría `ui.read` + decisión humana sobre el riesgo | **Única vía compatible hoy**; queda `BLOCKED` hasta que una persona decida (D-UI-03 / G6). PA-UI-0.2 **no** la otorga |

---

## 7. Riesgos residuales

| Id | Riesgo | Estado |
|---|---|---|
| RR-01 | Proceso local con cookie/token del GUI direcciona otra sesión (T1/T13) | abierto; no mitigable por el plugin; exige decisión humana |
| RR-02 | Sin logout por sesión; la cookie dura 30 días | abierto (host) |
| RR-03 | El plugin no distingue 401 por ausencia vs por cookie inválida | **`OPEN / DOCUMENTED HOST LIMITATION`** (GAP-20); documentado, **no** aceptado |
| RR-04 | `ui.read` fail-closed puede degradar la UI si el registro está en sólo lectura | diseñado; H-11 lo mide |
| RR-05 | Implementar PA-UI-1 sin resolver RR-01 produciría una UI con identidad no demostrada | mitigado por gate G6 y cierre BLOCKED |

---

## 8. Integridad documental (estado en PA-UI-0.1, histórico)

> Los tamaños y hashes de esta sección son los de la entrega PA-UI-0.1. PA-UI-0.2 modificó los tres documentos: los valores vigentes están en `docs/PA-UI-0.2-REVIEW.md` §8.

| Documento | Bytes | SHA-256 |
|---|---|---|
| `lifecode-rag/docs/PA-UI-0-API-CONTRACT.md` | 49251 | `00032ec15ea0322a87df154482184ce54d7e48cfbf45cb22a6ac4ec379b6d3ca` |
| `lifecode-rag/docs/PA-UI-0-ACCEPTANCE.md` | 20852 | `607777eed77196b80079dee8259e387ecf3e7356f39ca33aa1ed134f14e8ec4c` |
| `lifecode-rag/docs/PA-UI-0-GAPS.md` | 19996 | `93533be461abb69ec7cd508dfb56be8309d732b28f2d5fba390fe3083c66cc35` |

- Los tres documentos citan el mismo contrato (`revisión 2`), los mismos códigos de error y las mismas rutas; no queda ninguna contradicción conocida sobre `expectedRevision`, campos desconocidos, 403/409 ni `session-unavailable`.
- `PA-UI-0-API-CONTRACT.md` §7.1 es la única definición de `ui.read`; ACCEPTANCE H-09…H-12 y GAPS §4.1 la referencian sin duplicar reglas.
- Los enlaces relativos de los tres documentos apuntan a ficheros existentes; no se introdujeron rutas absolutas nuevas.
- Este informe (`PA-UI-0.1-REVIEW.md`) se hashea en la entrega; su propio contenido no puede contener su hash final sin invalidarlo.

---

## 9. Integridad del repositorio

| Comprobación | Antes | Después |
|---|---|---|
| Rama | `fix/t45-4-r17-acceptance` | `fix/t45-4-r17-acceptance` |
| HEAD | `b6c0cd24621c8bc3282185d1821c60b7956f8a83` | `b6c0cd24621c8bc3282185d1821c60b7956f8a83` |
| `git status --porcelain` (líneas) | 1151 | 1151 |
| Ficheros modificados por esta tarea | — | los tres documentos PA-UI-0 + este informe |

No se ejecutó `git add`, commit, merge, rebase, push ni cambio de rama. No se limpió ni restauró ningún cambio preexistente. `_audit/`, `skill-compiler/`, `lifecode-skill-center/`, `MEMORY.md`, `AGENTS.md`, perfiles, registry y almacenes no se tocaron.

---

## 10. Cierre

**Estado de PA-UI-0.1: `BLOCKED`.**

- PA02, PA03, PA04 y PA05: resueltos documentalmente y verificables en PA-UI-1.
- PA01: bloqueado por una limitación demostrada del host, no por falta de análisis.
- PA-UI-1 **no autorizada**. No se inicia.

Para desbloquear PA01 hace falta una de estas tres cosas, y sólo una persona puede decidirla:

1. **Aceptación escrita del riesgo** (D-UI-03/G6) con las mitigaciones de §6-D/§7 y la auditoría `ui.read`; o
2. **Cambio de topología** (host/perfil/`DSH_HOME` dedicado, sin otras sesiones en el mismo proceso) que haga que «direccionar otra sesión» no tenga a qué apuntar; o
3. **Una primitiva del host** (versión futura) que ligue petición HTTP y sesión; hoy no existe.

Hasta entonces, la UI Project-Aware permanece **BLOQUEADA** y las siete herramientas v0.1 siguen siendo la única vía de uso verificada.
