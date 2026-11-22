# PA-UI-0 — Contrato de API visual Project-Aware

**Proyecto:** LifeCode RAG · **Fase:** PA-UI-0 (diseño contractual, sin implementación)
**Versión del contrato de UI:** `pa-ui/0.1.0-draft` (revisión 3) · **Estado:** PROPOSED — pendiente de aprobación humana
**Contrato de herramientas vigente:** v0.1.0, **congelado** (`docs/CONTRATO-v0.1.md`, SHA-256 `a58db7d6cac0756e2711c5ef556111dc7d38cec206420021e2bc42e42b4068f1`)
**Host de referencia:** DeepSeek Harness 0.2.2-rc.5 · **Plugin:** `lifecode-rag/` 1.0.0
**Fecha:** 2026-11-18 · **Revisiones:** PA-UI-0.1 y PA-UI-0.2 (ver §13 y §14)

> **Resultado de la revisión PA-UI-0.1: `BLOCKED` en el punto PA01.** El host no ofrece hoy una primitiva verificada que ligue una petición HTTP a una sesión de conversación (evidencia en §3.4). Este contrato deja de presentar la cabecera de sesión como autenticación: la trata como **referencia de direccionamiento** sobre un peer ya autenticado por el host como `owner`, y declara el riesgo residual como decisión humana pendiente. Los demás puntos (PA02–PA05) quedan resueltos documentalmente. Ver `docs/PA-UI-0.1-REVIEW.md`.

> **Revisión PA-UI-0.2 (documental):** auditoría `ui.read` append-only sin dedupe (§7.1), `actor` de origen humano sin pretensión de identidad autenticada, GAP-20 como `OPEN / DOCUMENTED HOST LIMITATION` y ruta topológica `NOT DEMONSTRATED` (§3.6, D-UI-11). El resultado global sigue `BLOCKED`; PA-UI-1 no se inicia. Ver `docs/PA-UI-0.2-REVIEW.md`.

> Este documento **no implementa** nada. Define el contrato que PA-UI-1 deberá implementar.
> No modifica las siete herramientas públicas v0.1, ni `package.json`, ni `index.js`, ni `client.js`.
> Cada afirmación lleva su origen: `[IMPLEMENTED]` (existe en el código), `[VERIFIED HOST]` (demostrado en el host vivo), `[DOCUMENTED]` (está en documentación), `[PROPOSED]` (diseño nuevo), `[GAP]` (capacidad ausente), `[UNKNOWN]` (sin evidencia suficiente).

---

## 1. Objetivo y alcance

La interfaz visual Project-Aware permite a una persona, dentro de DeepSeek Harness:

1. ver el proyecto activo de su sesión y su estado de autorización;
2. seleccionar explícitamente un proyecto para esa sesión;
3. ver las bibliotecas concedidas y sus permisos efectivos;
4. listar y abrir las fuentes indexadas del proyecto;
5. buscar sobre los ámbitos efectivos;
6. ver el contexto recuperado con sus citas;
7. entender los errores de acceso y autorización.

**Fuera de alcance en este contrato:** ingesta, borrado, reindexación, configuración, métricas históricas, exportación de auditoría, cualquier escritura distinta de la selección de proyecto.

La UI es una **capa de lectura** sobre la misma arquitectura de autorización de las herramientas. No crea una segunda ruta de autorización: toda petición termina en `withAuthorizedContext` o en el mismo resolutor que usan las herramientas (`resolveScope`, `registerSelection`, `openRegistry`).

---

## 2. Principios de diseño

| # | Principio | Origen |
|---|---|---|
| P1 | La identidad de sesión la compone el host, nunca el navegador ni el modelo. | `[IMPLEMENTED]` `lib/session-identity.mjs` (`captureSession` usa sólo `agent.id`) |
| P2 | Antes de abrir un almacén se resuelve sesión, proyecto, grants y ámbitos. | `[IMPLEMENTED]` `lib/exec-context.mjs`, `lib/resolve.mjs` |
| P3 | Fallo cerrado: sin identidad, sin selección o con grant revocado no se devuelven datos. | `[IMPLEMENTED]` PA2/PA3 |
| P4 | Sin fallback al almacén único v0.2 ni a búsqueda global. | `[IMPLEMENTED]` `index.js` sólo monta la API v0.2 si existe `rag.sqlite3`; `[GAP]` no hay API Project-Aware |
| P5 | El navegador envía **referencias**, no pruebas de autorización. | `[PROPOSED]` (ver §4) |
| P6 | Los identificadores de otra sesión no son visibles, y los de ámbitos no autorizados no se aceptan. | `[PROPOSED]` (ver §9) |
| P7 | Una sola ruta de apertura de almacenes: `ctx.open(scope, {create:false})`. | `[IMPLEMENTED]` `lib/exec-context.mjs` |
| P8 | Toda lectura revalida cuando corresponde y cierra recursos en `finally`. | `[IMPLEMENTED]` `ctx.checkpoint`, `ctx.revalidate` |
| P9 | La selección de proyecto es una acción humana registrada y auditada. | `[IMPLEMENTED]` `lib/sessions.mjs` `registerSelection` (`selectedBy`, `actor`) |
| P10 | Las siete herramientas v0.1 no se tocan; la API visual es un contrato separado y aditivo. | `[DOCUMENTED]` orden PA-UI-0 §9 |

---

## 3. Identidad: cómo llega la sesión al backend

### 3.1 Cadena real (evidencia)

- El host expone `ctx.agents.get(id: SessionId): Agent | undefined` y `list(): Agent[]`; `Agent` es `{ readonly id: SessionId }` y el propio contrato dice que el id es **el id compartido de agente y sesión**. `[VERIFIED HOST]` (catálogo de servicios del host).
- El slot de cliente `conversation.session.header.actions` es de `scope: 'session'` y entre sus *standard props* entrega `sessionId: SessionId`, `useSession`, `useAccess`, `useChat`, entre otros. `[VERIFIED HOST]` (catálogo de slots del cliente).
- El plugin `lifecode-skill-center` ya usa exactamente ese mecanismo: registra un ocupante oculto `lifecode-skill-center.session-probe` (order 60) en ese slot y recibe el `sessionId` de la conversación; el probe «no pinta nada». `[VERIFIED HOST]` (ocupantes del slot) + `[IMPLEMENTED]` en `lifecode-skill-center/client.js` (`SESSION_ACTIONS_SLOT`, `SessionToastProbe`, `sessions.binding(id)`).
- El host entrega el `sessionId` al **cliente** como dato de presentación; no lo entrega al backend como prueba. Que el cliente conozca ese id no demuestra que la petición HTTP venga de esa pestaña.

### 3.2 Qué autentica realmente el host (evidencia PA-UI-0.1)

`[VERIFIED HOST]` (fuentes del host leídas en `app.asar`, sólo lectura):

| Hecho | Fuente |
|---|---|
| La autenticación del navegador es un **token de lanzamiento por proceso** canjeado por una cookie firmada ligada a la **autoridad** (host+puerto), con `issuedAt`/`expiresAt` (30 días por defecto) y sin operación de logout. | `@deepseek-ai/dsh-client-connection/src/browser-auth.ts` (`AUTH_RECORD_KEY`, payload `{version, authority, issuedAt, expiresAt}`, `cookieMaxAgeDays` default 30) |
| El *trust fence* comprueba `Host`, `Origin` y `sec-fetch-site`; su propio comentario dice: **«this fence never establishes identity»**. | `dsh-client-connection/src/api-request-trust.ts:12` |
| Todo el navegador autenticado comparte **un** `browserPeer` con `principal: { kind: 'owner' }`; no existe un nivel de autenticación por método ni por sesión. | `dsh-client-connection/README.md` líneas 41–51 |
| El `principal` de un `Peer` se fija en su construcción; un Peer in-process se crea con `createPeer({principal})`, no a partir de la petición. | `dsh-client-connection/src/peer.ts:16` |
| El control de acceso por rol (`remoteAccess`) **sólo se aplica a peers no-owner**; al owner nunca se le comprueba. | `dsh-api-remote-access/README.md` («The owner … is never checked») |
| Las propias APIs de sesión del host reciben el `sessionId` **como parámetro de direccionamiento** del llamante; el Gateway resuelve el recurso y aplica `remoteAccess` sólo a no-owner. | `dsh-api-session-controller/src/index.ts:85–104`, `:284`, `:298` |

**Conclusión de PA01:** no existe hoy en el host una primitiva verificada —token por sesión, capacidad efímera, cookie por pestaña, RPC con identidad de conversación— que permita a un plugin demostrar que una petición HTTP pertenece a una sesión concreta. Cualquier proceso local que obtenga la cookie del GUI (o el token de lanzamiento) puede hablar como `owner` y **nombrar** cualquier `sessionId` vivo. `ctx.agents.get(id)` sólo demuestra que ese agente existe; no demuestra quién llama. Por tanto **PA01 queda `BLOCKED`** y D-UI-03 no se declara resuelto.

### 3.3 Contrato de transporte: referencia de direccionamiento, no credencial

`[PROPOSED]` La mitad cliente de RAG registra su propio probe mudo en `conversation.session.header.actions`, recibe el `sessionId` y lo envía en la cabecera:

```
x-lifecode-rag-session: <sessionId>
x-lifecode-rag: 1            (obligatoria en POST)
content-type: application/json (obligatoria en POST)
```

Reglas no negociables (deterministas):

1. El backend **no** acepta `sessionId` en query string, cuerpo JSON ni cookies; si aparece en el cuerpo, la petición se rechaza con `400 invalid-argument` `reason: unknown-field` (PA02).
2. La cabecera es **obligatoria** en toda ruta de datos. Ausente o con forma inválida (`^[\x20-\x7e]{1,200}$`) → `401 session-invalid`. Un valor válido no se interpreta nunca como prueba de autorización.
3. El backend comprueba que exista un **agente vivo** con `ctx.agents.get(sessionId)`; si no existe → `409 session-unavailable`. La comprobación es de *direccionamiento* (¿hay algo que atender en esa dirección?), no de identidad.
4. Con el `Agent` en mano se construye `exec = { agent, callId, signal }` y se llama a `withAuthorizedContext({ services, exec }, work)`; la identidad efectiva sigue siendo `agent.id`, jamás el string recibido. `[IMPLEMENTED]`
5. La API **no afirma** en ningún documento, mensaje ni cabecera que la sesión esté autenticada. El único sujeto autenticado es el peer `owner` del host; la sesión es el **recurso direccionado**.
6. La autorización real (proyecto, grants, ámbitos, almacenes) la sigue decidiendo `resolveScope`/`withAuthorizedContext`; la cabecera no concede nada por sí sola.

### 3.4 Alternativas evaluadas para PA01 (y por qué no resuelven)

| # | Alternativa | Viabilidad con el host actual | Veredicto |
|---|---|---|---|
| A | Capacidad/token **emitido por el host** por sesión, validable en backend, revocable al cerrar | No existe API: `browser-auth` sólo emite cookies por autoridad; `agents` no emite capacidades; `connection` no expone token por peer a plugins | **BLOQUEADA** — requeriría cambio del host |
| B | Capacidad **emitida por el plugin** al cargar el panel, ligada a `sessionId` | El endpoint que la emitiría corre sobre el mismo canal `owner`; cualquier proceso local puede pedir una para otra sesión. No distingue pestañas ni demuestra propiedad | **RECHAZADA** — no añade garantía, sólo complejidad |
| C | Ligar la capacidad al `peer.id` de la cookie v2 (`/connect`) | El peer se crea con el token de lanzamiento; el plugin no puede saber qué pestaña es. `peer.id` es del peer, no de la conversación | **RECHAZADA** |
| D | Aislar por topología: instancia de host / `DSH_HOME` / perfil dedicados, sin otras sesiones en el proceso | Reduce la superficie (no hay otras sesiones a las que direccionar), pero **no** aporta una prueba de identidad del emisor | **MITIGACIÓN DE SUPERFICIE** — sólo válida si se demuestran los criterios TI-1…TI-7 de §3.6; hoy `NOT DEMONSTRATED` |
| E | Mantener la cabecera como direccionamiento + auditoría + fence del host, con el riesgo documentado | Es lo único compatible sin tocar el host; el riesgo residual es idéntico al de las APIs de sesión del propio host | **ÚNICA VÍA DISPONIBLE**, supeditada a una decisión humana explícita e independiente (D-UI-03), **no otorgada** por PA-UI-0.2 |

### 3.5 Riesgo residual (documentado, no oculto)

El peer HTTP del navegador es siempre `principal: { kind: 'owner' }` y el host no transporta identidad de sesión. `[VERIFIED HOST]` (`connection.browserPeer`; `remoteAccess` sólo para no-owner). Consecuencias, sin adornos:

- Cualquier proceso local con la cookie del GUI o el token de lanzamiento puede **direccionar** otra sesión viva. La API visual no puede impedirlo por sí sola.
- Este riesgo es **el mismo** que tienen las APIs de sesión nativas del host (reciben `sessionId` del llamante owner); no es una regresión introducida por RAG, pero tampoco desaparece por repetir que existe.
- Mitigaciones obligatorias en PA-UI-1: admisión del host (`connection.requestRejection`), `assertLoopback` (Host/Origin loopback), cabecera personalizada + `content-type: application/json`, ausencia de CORS, `ui.read` auditado (PA03), y mensajes de error que no permitan enumerar sesiones/proyectos.
- **Estado:** `BLOCKED` para autenticación de sesión (PA01). La limitación del host queda **`OPEN / DOCUMENTED HOST LIMITATION`**: no hay aceptación humana del riesgo, y documentarla no equivale a aceptarla. `PENDING HUMAN DECISION` para D-UI-03. Sin esa decisión, PA-UI-1 no puede declarar la parte de identidad como cumplida.

### 3.6 Ruta alternativa de mitigación: aislamiento topológico (no es autenticación)

`[PROPOSED]` Esta ruta se documenta porque puede **reducir la superficie** de PA01 sin tocar el host. No se presenta en ningún caso como autenticación ni como capacidad de sesión, y **no se ha ejecutado ni verificado** en PA-UI-0.2.

**Distinción obligatoria**, que debe repetirse en todos los documentos:

| Concepto | Qué es | Qué no es |
|---|---|---|
| Autenticación/capacidad de sesión | prueba verificable de que el emisor está autorizado para actuar sobre **esa** sesión | no existe hoy en el host (PA01) |
| Aislamiento topológico | separación operativa del proceso y de sus sesiones para que no haya otras sesiones a las que direccionar | **no** demuestra quién envía una petición; no sustituye a la autenticación |

Criterios mínimos para poder declarar la ruta como **DEMOSTRADA** (todos, con evidencia reproducible y responsable de verificación):

| # | Criterio |
|---|---|
| TI-1 | Proceso Harness **dedicado** al entorno RAG (una instancia, un `DSH_HOME`/perfil, sin plugins de terceros innecesarios). |
| TI-2 | **Ausencia** de otras conversaciones/sesiones no autorizadas dentro de ese mismo proceso (listado de agentes del proceso = sólo las autorizadas). |
| TI-3 | Evidencia verificable de que las solicitudes del plugin **no pueden direccionar** sesiones de otros procesos o instancias (p. ej. el proceso aislado no comparte el bus/almacén de sesiones con el resto). |
| TI-4 | Ausencia de mecanismos compartidos que permitan saltar la frontera (misma cookie/token de GUI reutilizable contra la instancia aislada, mismo puerto expuesto, proxy común, almacén de sesiones compartido). |
| TI-5 | Procedimiento operativo documentado: iniciar, mantener, cerrar y **verificar** el aislamiento (incluye qué hacer si se abre una segunda instancia). |
| TI-6 | Prueba reproducible de que una sesión externa no puede ser alcanzada desde el proceso aislado (o de que no existe). |
| TI-7 | Evidencia y **responsable de la verificación** registrados; revisión humana de la frontera. |

**Estado: `NOT DEMONSTRATED`.** No se ha ejecutado ninguna prueba de aislamiento (PA-UI-0.2 es documental) y no se ha modificado la topología. Un perfil dedicado, un `DSH_HOME` separado o una instalación aparte **no** demuestran por sí solos TI-1…TI-7. La ruta sólo puede pasar a `DEMONSTRATED` con evidencia de los siete criterios; hasta entonces, G6 sigue `BLOCKED` (§L de `PA-UI-0-ACCEPTANCE.md`).

---

## 4. Flujo de autorización de una petición

```
HTTP request
  → host: cookie del GUI / trust fence (Host, Origin, sec-fetch-site)      [VERIFIED HOST] (401 si no autenticado)
  → connection.requestRejection(req)                                        [VERIFIED HOST]
  → assertLoopback (Host + Origin loopback)                                 [IMPLEMENTED] patrón de lib/server.mjs
  → x-lifecode-rag-session header → assertSessionId                         [IMPLEMENTED]
      · ausente o inválida → 401 session-invalid
  → ctx.agents.get(sessionId) → Agent vivo | 409 session-unavailable        [VERIFIED HOST] API
  → abrir auditoría de lectura: correlationId = UUID, t0 = now()            [PROPOSED] (PA03)
  → openRegistry({create:false})                                           [IMPLEMENTED]
      · store-not-initialized → 503 registry-unavailable (no crea nada)
  → getSession / resolveScope (denegaciones ya auditadas)                  [IMPLEMENTED]
  → withAuthorizedContext({services, exec}, work)                          [IMPLEMENTED]
      · scopes efectivos, revalidación, apertura perezosa autorizada
  → ctx.open(scope, {create:false}) por ámbito autorizado                  [IMPLEMENTED]
  → operación de lectura (searchScopes / contextScopes / listProject / getSource)
  → ctx.checkpoint(...) antes de devolver                                  [IMPLEMENTED]
  → ui.read: appendRegistryAudit({action:'ui.read', outcome, durationMs})  [PROPOSED] (PA03; fail-closed)
  → respuesta + cabecera x-lifecode-rag-request: <correlationId>
  → finally: cierre de cada almacén abierto y del registro                 [IMPLEMENTED]
```

La selección (`POST /selection`) es la única escritura: pasa por `registerSelection`, que ya valida perfil, sesión y proyecto, y audita `session.select` / `session.reselect`. `[IMPLEMENTED]`

Aclaración de comportamiento `[IMPLEMENTED]` `lib/resolve.mjs`:

- Sin selección y sin `cwd` → `scope-unresolved`.
- Sin selección y `cwd` fuera de toda raíz → `scope-unresolved`.
- `cwd` dentro de varias raíces → `scope-ambiguous`.
- Selección explícita + `cwd` que cae en **otro** proyecto → `scope-ambiguous`.
- Selección explícita + `cwd` fuera de toda raíz → se acepta la selección (el `cwd` no restringe).
- Proyecto archivado → `scope-forbidden` `reason: project-archived`.
- Sesión expirada / invalidada → `session-expired` / `scope-forbidden`.

---

## 5. Superficie de la API

Prefijo propuesto: **`/lifecode-rag/ui/api`** `[PROPOSED]`. No se reutiliza `/lifecode-rag/api` (API v0.2 heredada, DOCUMENTED) ni se monta cuando no hay almacén legado.

Envoltorio de respuesta (mismo sobre que la API v0.2, para no introducir un tercer estilo) `[DOCUMENTED]` `lib/server.mjs`:

```json
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "code": "scope-forbidden", "message": "…", "details": { } } }
```

> **Implementación LE-RAG-12.** `lib/pa-api.mjs` produce ese sobre en `writeJson`: el payload de cada ruta
> viaja dentro de `data` y los fallos dentro de `error`, sin `data` y con el status del código. El cliente
> (`client.js`) lo desenvuelve en un solo punto (`request`) y trata `ok:false` como fallo **aunque llegue con
> 200**, para que un defecto del servidor no se degrade a datos vacíos. Un cuerpo que excede el tope no se
> sirve: se responde `500 response-too-large`.

### 5.1 Resumen de rutas

| Método | Ruta | Autorización | Escritura | Propósito |
|---|---|---|---|---|
| GET | `/health` | ninguna (sin datos de sesión) | no | Estado del servicio y versiones |
| GET | `/session` | cabecera de sesión | no | Sesión, selección, proyecto, ámbitos, estado |
| GET | `/projects` | cabecera de sesión | no | Proyectos seleccionables por esta sesión |
| POST | `/selection` | cabecera de sesión | **sí** (selección) | Registrar selección explícita |
| GET | `/libraries` | cabecera de sesión | no | Bibliotecas concedidas + estado de almacén |
| GET | `/sources` | cabecera de sesión | no | Fuentes del proyecto activo (paginado) |
| GET | `/sources/:id` | cabecera de sesión | no | Fuente + fragmentos (proyecto activo) |
| POST | `/search` | cabecera de sesión | no | Búsqueda en ámbitos efectivos |
| POST | `/context` | cabecera de sesión | no | Contexto recuperado + citas |
| GET | `/diagnostics` | cabecera de sesión | no | Diagnóstico redactado de la sesión |

> **Implementado en `pa/1.1.0` (ACP-01, §15).** La superficie viva de este build es
> `GET /lifecode-rag/pa/snapshot`, `GET /config`, `POST /search`, `POST /context`, `POST /selection` y
> `POST /actions` (siempre 403). Las rutas `/session`, `/projects`, `/libraries`, `/sources`,
> `/sources/:id`, `/diagnostics` y `/health` de esta tabla siguen siendo **diseño**: no hay contrato
> implementado y el panel no las consume. La autorización no es una cabecera de sesión (§3.2, PA01):
> es la credencial del host, verificada por `ctx.connection` en el adaptador.

Todas las rutas de datos exigen `x-lifecode-rag-session`. `POST` exige además `x-lifecode-rag: 1` y `content-type: application/json` (patrón ya usado por la API v0.2, `[IMPLEMENTED]` `assertWrite`).

Reglas transversales de la superficie (PA02/PA03):

- **Campos desconocidos = rechazo.** Todo `POST` valida su esquema de forma estricta: una clave no declarada produce `400 invalid-argument` con `reason: "unknown-field"` y `details.fields: ["…"]` (sólo nombres, nunca valores) y **no se ejecuta la operación**. Aplica a `/selection`, `/search` y `/context`.
- **Parámetros de query desconocidos = rechazo.** `GET` acepta sólo los parámetros declarados por ruta; cualquier otro (`projectId`, `scope`, `sessionId`, …) produce `400 invalid-argument` con `reason: "unknown-parameter"` y `details.parameters` (nombres). No se ignora nada en silencio.
- **Correlación.** El servidor genera un `correlationId` (UUID v4) por petición, lo devuelve en la cabecera de respuesta `x-lifecode-rag-request` y lo usa como `call_id` del evento `ui.read`. La persona puede citarlo al reportar un problema; nunca se acepta uno enviado por el cliente.
- **Sin CORS.** La API no emite cabeceras `Access-Control-Allow-*`; un `Origin` de otra autoridad se rechaza antes de entrar (H-01/H-02).
- **Cuerpo máximo.** 1 MiB (PA05); por encima, `413 too-large` sin leer el resto.

---

## 6. Esquemas por capacidad

Convención: `EXISTENTE` = campo que ya produce el código; `DERIVABLE` = dato en el modelo pero no proyectado hoy; `GAP` = no existe.

### 6.1 `GET /session`

Devuelve el estado **sin abrir almacenes** cuando no hay selección, y con ámbitos cuando la hay.

```json
{
  "api": "pa-ui/0.1.0-draft",
  "contract": "0.1.0",
  "session": {
    "id": "session-…",
    "profileKey": "desktop",
    "state": "active | expired | invalidated | none",
    "invalidReason": "project-archived | grant-revoked | root-revoked | profile-changed | admin | session-cloned | null",
    "expiresAt": null,
    "selection": {
      "state": "active | none | unresolvable | ambiguous",
      "projectId": "prj_…",
      "projectName": "…",
      "source": "explicit | cwd",
      "revision": 3,
      "selectedBy": "human | host",
      "selectedAt": 1763…,
      "candidates": [{ "projectId": "prj_…", "path": "<redactado>" }]
    }
  },
  "project": { "id": "prj_…", "name": "…", "status": "active" },
  "scopes": [
    { "kind": "prj", "id": "prj_…", "name": "…", "roots": 1, "store": "present | missing | migrating | corrupt" },
    { "kind": "lib", "id": "lib_…", "name": "…", "roots": 1, "store": "present | missing | corrupt", "permission": "read" }
  ],
  "scopeCount": 3,
  "service": { "status": "ok | degraded", "registry": "ok | unavailable | corrupt", "storeRoot": "ready | missing" }
}
```

Origen por bloque: `session.state/invalidReason` = `session_scope` `[EXISTENTE]`; `selection.*` = `session_scope` `[EXISTENTE]` (la fila no guarda `projectName`: se resuelve con `getProject`) `[EXISTENTE]`; `scopes[].roots` = `effectiveScopes` `[EXISTENTE]`; `store` = `library-state` / `scopeStoreExists` `[EXISTENTE]`; `service.registry/storeRoot` = comprobaciones de `openRegistry` + `profileRoot` `[EXISTENTE]`; `service.status` = `[PROPOSED]` (degradado si alguna biblioteca concedida está `missing`/`corrupt`).

`unresolvable` / `ambiguous` se obtienen capturando `scope-unresolved` / `scope-ambiguous` de `resolveScope` — que **ya audita la denegación** — sin convertir el error en datos de otro proyecto. `[PROPOSED]` (hoy `withAuthorizedContext` propaga el error).

### 6.2 `POST /selection`

Esquema **estricto** de petición (PA02):

```json
{ "projectId": "prj_…", "expectedRevision": 3 }
```

| Campo | Tipo | Obligatorio | Regla |
|---|---|---|---|
| `projectId` | string `prj_…` | sí | Debe existir, estar `active` y ser candidato (§6.3). |
| `expectedRevision` | entero ≥ 0 | sí | Revisión que el cliente cree vigente. `0` = «no hay selección todavía». |

Cualquier otra clave → `400 invalid-argument` `reason: "unknown-field"` (§5); en particular un `sessionId` en el cuerpo **nunca** se usa como identidad y se rechaza.

Respuesta `200`: el bloque `session` de §6.1, más `changed: true|false` y `revision` resultante.

Comportamiento determinista (control de concurrencia optimista):

1. El backend lee la selección actual de la sesión (`session_scope`, campo `revision`). `GET /session` ya la expone en `selection.revision`; si no hay selección, el cliente envía `0`.
2. **Coincide** (`expectedRevision === revision actual`): se aplica la selección con una única sentencia condicional (`UPDATE … WHERE session_id = ? AND revision = ?`). Si el proyecto no cambia, `changed:false` y la revisión **no** sube (idempotente). Si cambia, `changed:true`, `revision = revisión + 1`, auditoría `session.reselect` con el `revision` nuevo.
3. **No coincide**: no se escribe **nada**; respuesta `409 revision-conflict` con `details: { "expectedRevision": <enviada>, "currentRevision": <actual> }`. El cliente debe releer `GET /session` y reintentar; la UI no reintenta sola.
4. **Carrera entre dos pestañas**: la condición `revision = ?` es atómica dentro de `BEGIN IMMEDIATE`; exactamente una gana y la otra recibe `409 revision-conflict`. Nunca «la última gana» en silencio.
5. `expectedRevision` no entero, negativo o ausente → `400 invalid-argument` (`reason: "invalid-field"`).
6. `selectedBy` es siempre `human`/`host`; la API no acepta `actor`, `sessionId`, `source` ni `scope` en el cuerpo. `[IMPLEMENTED]` (`registerSelection` rechaza `selectedBy` distinto de `human|host`) + `[PROPOSED]` (condición de revisión).

Invalidaciones (sin escritura): `session-expired` (409), `scope-forbidden` con `reason` de invalidación (403), `scope-forbidden` `reason: "project-unavailable"` si el proyecto no existe, está archivado o no es candidato (una sola respuesta, C-07), `invalid-argument` si el id no es `prj_…`.

> **Estado de implementación (ACP-01, `pa/1.1.0`): CERRADO.** `POST /lifecode-rag/pa/selection` aplica
> este contrato con estas precisiones, todas medidas por `tests/selection-cas.test.mjs`:
>
> - **Alcance de la selección:** una fila por perfil (`pa_selection`, `selection_key='profile'`), no por
>   `session_scope`. El motivo es PA01: el host no ofrece identidad de sesión al plugin (§3.2), y atar la
>   selección del panel a un `SessionId` sin autenticar sería inventar identidad. Consecuencia buscada:
>   la selección **sobrevive al cierre de sesión y al reinicio**.
> - **Petición:** `{ "projectId": "prj_…", "expectedRevision": 0 }`, esquema estricto; cualquier otra clave
>   → `400 invalid-argument` (`unknown-field`).
> - **Respuesta 200:** `{ changed, revision, selection: {projectId, projectName, revision, source, selectedBy,
>   principal, selectedAt, updatedAt}, project: {id, name} }`. No se implementa `GET /session`, así que la
>   respuesta devuelve el bloque de selección ya resuelto en vez de la sesión completa.
> - **Conflicto:** `409 revision-conflict` con `details: { reason: "revision-mismatch", expectedRevision,
>   currentRevision, current: { projectId, projectName, revision } }`. No se escribe nada.
> - **Proyecto inválido o ajeno:** `403 project-not-authorized` (el código `scope-forbidden` de §7 no existe
>   en `RAG_CODES` de este build; `project-not-authorized` es el que ya usa toda la API PA para ese hecho).
> - **Idempotencia:** mismo proyecto con la revisión vigente → `changed:false` y la revisión **no** sube.
> - **Carrera entre dos paneles:** `BEGIN IMMEDIATE` + condición de revisión; exactamente uno confirma y el
>   otro recibe `409`, que el panel traduce en recarga de la revisión vigente y aviso, sin reintento automático.
> - **Auditoría:** cada cambio confirmado escribe `selection.select` / `selection.reselect` en la cadena del
>   registro (`actor:'human'`, `detail.revision`, `detail.previous`, `detail.principal`).
>
> El reducer del panel no adelanta la revisión: `select-project` en modo API deja `pending:'selection'` y sólo
> pinta el cambio al recibir `selection-ok` con la revisión confirmada (`tests/client.test.mjs`).

### 6.11 `GET /history` (ACP-02)

Historial de auditoría del **proyecto activo**, de sólo lectura. Implementado en `pa/1.2.0`.

```json
{
  "scope": { "id": "prj_…", "kind": "prj", "name": "…" },
  "total": 141,
  "entries": [
    {
      "seq": 141, "at": 1795043069763, "actor": "automation",
      "tool": "lifecode_rag_sync", "action": "sync.run",
      "target": "prj_…", "outcome": "ok",
      "hash": "5bc176a33fa5cc11", "details": null
    }
  ],
  "nextCursor": "91",
  "integrity": { "ok": true, "count": 141 }
}
```

| Regla | Detalle |
|---|---|
| Ámbito | Estructural: las filas salen del almacén **del proyecto activo** (`audit` del scope store). No hay `where` de ámbito que se pueda olvidar, porque otro proyecto es otro fichero |
| Paginación | `?limit=` (1–200, por defecto 50) y `?cursor=<seq>` (devuelve entradas con `seq` menor). `nextCursor` es `null` al final |
| Procedencia | `seq`, `hash` (16 hex) y `integrity` (verificación de la cadena completa con el código del plugin) |
| Redacción | `target` se relativiza a las raíces autorizadas (nunca ruta absoluta); `details` pasa por **lista blanca**: `sourceId, chunks, bytes, code, revision, replace, embedding, skipped`. Nada de `sessions`, `paths` ni mensajes de error con trayectorias |
| Autenticación | La misma compuerta del host que el resto (§3, PA01); sin credencial → `401` |
| Errores | `400 invalid-argument` (cursor o límite inválidos, parámetro no declarado), `403 project-not-authorized`, `503 authorization-unavailable` |

> Si la API no puede servirlo, el panel mantiene el estado «no disponible» y **no** pinta filas: un historial
> vacío y un historial inaccesible se distinguen (`entries: []` con `integrity.ok` frente a error de
> transporte).

### 6.3 `GET /projects`

Devuelve **sólo** proyectos seleccionables por esa sesión:

1. el proyecto actualmente seleccionado (si existe y está activo);
2. proyectos activos con alguna raíz autorizada que contenga el `cwd` de la sesión.

No devuelve el catálogo global. `[PROPOSED]`, construido sobre `matchingProjects` (`[IMPLEMENTED]` pero privada en `lib/resolve.mjs`) y `listRoots` + `pathKeyFor` (`[IMPLEMENTED]` `lib/registry.mjs`). Ver GAP-04.

```json
{ "projects": [ { "id": "prj_…", "name": "…", "current": true, "rootCount": 2 } ], "cwdKnown": true }
```

Si el `cwd` no está disponible y no hay selección, la lista es vacía y `GET /session` informa `unresolvable`. No se auto-selecciona nada.

### 6.4 `GET /libraries`

```json
{
  "libraries": [
    { "id": "lib_…", "name": "…", "permission": "read",
      "grantedAt": 1763…, "grantedBy": "human | host",
      "store": "present | missing | corrupt | unreadable | migrating",
      "roots": 1 }
  ],
  "effectiveScopes": 3
}
```

Sólo aparecen grants abiertos (`revoked_at IS NULL`) de bibliotecas activas, tal como los calcula `effectiveScopes`/`effectiveScopesForProject` (`[IMPLEMENTED]`). Una biblioteca revocada **desaparece** de la lista; su revocación se explica en `/session` (`invalidReason`). No se enumeran bibliotecas globales. El estado del almacén se obtiene con la capa `library-state` (`[IMPLEMENTED]`) **después** de que el ámbito esté autorizado.

### 6.5 `GET /sources?limit=50&offset=0&collection=&tag=`

Proyecto activo **exclusivamente** (misma semántica que `lifecode_rag_list`, `[IMPLEMENTED]` `listProject`).

```json
{
  "total": 121, "limit": 50, "offset": 0,
  "rows": [ { "id": "src_…", "uri": "docs/x.md", "title": "X", "collection": "default",
              "bytes": 1234, "chunks": 8, "updatedAt": 1763…,
              "indexedAt": 1763…, "mime": "text/markdown" } ]
}
```

`rows[]` base = `listSourceRows` `[EXISTENTE]` (`id, uri, title, collection, bytes, chunks, updatedAt`); `mime`, `indexedAt`, `sha256`, `charCount` están en la tabla `sources` pero no se proyectan hoy → `[DERIVABLE]`.

### 6.6 `GET /sources/:id`

Proyecto activo únicamente; el `:id` se resuelve con `getSource(db, ref)` (acepta **id o URI**, `[IMPLEMENTED]` `lib/search.mjs:282`). Si no existe → `404 source-not-found`.

```json
{
  "source": { "id": "…", "uri": "…", "title": "…", "mime": "…", "sha256": "…", "bytes": 0,
              "charCount": 0, "collection": "default", "metadata": {},
              "createdAt": 0, "updatedAt": 0, "indexedAt": 0 },
  "chunks": [ { "ordinal": 0, "heading": "…", "charStart": 0, "charEnd": 0,
                "tokenEst": 0, "text": "…" } ],
  "chunksTotal": 8
}
```

`source` = fila completa de `sources` `[EXISTENTE]`; `chunks` = filas de `chunks` (`ordinal, heading, char_start, char_end, token_est, text`) `[EXISTENTE]` en tabla, pero no hay hoy una función exportada que liste fragmentos por fuente → `[GAP]` pequeño (ver GAP-05). `text` se recorta al límite de §8.

### 6.7 `POST /search`

```json
{ "query": "…", "limit": 8 }
```

Semántica idéntica a `lifecode_rag_search` sobre los ámbitos efectivos (`[IMPLEMENTED]` `searchScopes`), con dos campos añadidos **sólo en la API visual** (no en la herramienta): `scopeKind` y `scopeName`, para que la UI muestre procedencia.

```json
{
  "mode": "hybrid | lexical | vector",
  "elapsedMs": 42,
  "results": [
    { "chunkKey": "…", "sourceId": "…", "uri": "…", "title": "…", "heading": "…",
      "ordinal": 3, "rrf": 0.031, "snippet": "…",
      "scopeId": "prj_…|lib_…", "scopeKind": "prj|lib", "scopeName": "…" }
  ],
  "scopes": [ { "id": "prj_…", "kind": "prj", "name": "…", "results": 7 } ]
}
```

`scopeId`, `scopeKind` y `scopeName` existen **sólo** en la API visual: la herramienta v0.1 los elimina por proyección (`[IMPLEMENTED]` `lib/tools.mjs`) y el motor de búsqueda de un solo almacén no los devuelve. En la implementación actual (`lib/pa-api.mjs`) **se derivan del único ámbito que el handler abre**: el proyecto autorizado. Por eso `scopeKind` es siempre `"prj"` y `scopeName`/`scopeId` son los del proyecto activo; no hay ámbitos de biblioteca que repartir mientras el handler no abra sus almacenes. No existe una función `searchScopes` en este build: no se documenta como dependencia.

> **Implementación LE-RAG-11 (laboratorio PA).** `lib/pa-api.mjs` sirve `/search` y `/context`
> **sólo por POST**; `GET` sobre ellas devuelve `405 method-not-allowed` con `details.allow: ["POST"]`.
> Como la cabecera de sesión de este contrato está `BLOCKED` (PA01), el proyecto se indica con el
> parámetro `?project=prj_…` en la query del POST: es el único parámetro admitido en esas rutas y
> cualquier otro produce `400 invalid-argument` `reason: "unknown-parameter"`.
>
> El handler abre únicamente el almacén del proyecto activo, así que **todas** las filas llevan
> `scopeKind: "prj"`, `scopeId` y `scopeName` del proyecto: no inventa ámbitos de biblioteca.
> Además de `rrf` (peso de fusión, tal como figura arriba) la respuesta incluye `score` normalizado
> `0..1`, que es el valor que pinta el panel. `uri` se relativiza contra las raíces autorizadas del
> proyecto: nunca sale una ruta absoluta del disco.
>
> Validación estricta del cuerpo (todas las ramas responden `400 invalid-argument` **sin ejecutar** la
> operación; el error nunca se degrada a una lista de resultados vacía):
>
> | Caso | `details` |
> |---|---|
> | cuerpo vacío | `reason: "missing-body"` |
> | JSON inválido | `reason: "invalid-json"` |
> | cuerpo que no es objeto | `reason: "invalid-body"` |
> | campo no declarado | `reason: "unknown-field"`, `fields: ["…"]` |
> | falta `query` | `reason: "missing-field"`, `field: "query"` |
> | `query` no es texto, vacío o sólo espacios | `reason: "invalid-field"`, `field: "query"` |
> | `query` de más de 512 caracteres | `reason: "query-too-long"`, `field: "query"`, `max: 512` |
> | `limit` no entero o menor que 1 | `reason: "invalid-field"`, `field: "limit"` |
> | `limit` mayor que 50 | `reason: "limit-too-large"`, `field: "limit"`, `max: 50` |
> | `budgetTokens` no entero o menor que 1 | `reason: "invalid-field"`, `field: "budgetTokens"` |
> | parámetro de query no declarado | `reason: "unknown-parameter"`, `parameters: ["…"]` |
>
> Cuerpo mayor de 1 MiB → `413 too-large`. Las consultas se ejecutan con `record: false`: una lectura
> no añade eventos de auditoría.

### 6.8 `POST /context`

```json
{ "query": "…", "budgetTokens": 2000 }
```

Salida idéntica a `lifecode_rag_context` (`text`, `citations` con los 9 campos de v0.1, `tokens`, `truncated`, `considered`) **más** `scopes` (procedencia por ámbito) y `elapsedMs`. `[IMPLEMENTED]` `contextScopes` + `assembleContextAsync`; los campos de cita se toman de `CONTRATO-v0.1.md` sin cambios.

> **Implementación LE-RAG-11.** Mismo transporte que `/search`: sólo POST con `{"query","budgetTokens"}`,
> proyecto por `?project=prj_…`, `GET` → `405`. El `budgetTokens` omitido usa el valor de configuración
> (`config.context.budgetTokens`, 2000 por defecto). `text` es el texto que se serviría al modelo;
> `citations[].uri` se relativiza contra las raíces autorizadas (sin rutas absolutas) y cada cita añade
> `chunkKey`, `sourceId` y `score` a los campos de v0.1. `assembleContextAsync` devuelve `tokens`,
> `truncated` y `considered` reales: la implementación anterior publicaba `tokensEstimate` (siempre
> `null`) y omitía `text`, lo que se corrige aquí.

Si alguna biblioteca concedida tiene almacén ilegible, la operación **falla cerrada** con `scope-store-unavailable`/`scope-store-corrupt` (comportamiento PA4-F, `[IMPLEMENTED]`): no se devuelve contexto parcial con datos de otros ámbitos.

### 6.9 `GET /diagnostics`

Información mínima y redactada:

```json
{
  "session": { "id": "…", "profileKey": "…", "state": "active" },
  "selection": { "projectId": "…", "source": "explicit", "revision": 3 },
  "scopes": [ { "kind": "prj|lib", "id": "…", "name": "…", "store": "present|missing|corrupt", "verified": true } ],
  "grants": [ { "libraryId": "…", "permission": "read", "grantedAt": 0, "state": "open" } ],
  "integrity": { "registry": "ok|denied", "stores": "ok|degraded", "auditHead": 0 },
  "versions": { "plugin": "1.0.0", "contract": "0.1.0", "api": "pa-ui/0.1.0-draft", "host": "0.2.2-rc.5" },
  "health": { "status": "ok|degraded", "checks": [ { "id": "registry", "ok": true } ] }
}
```

Reglas: `roots` se muestran como **conteo** y, si hace falta un nombre, el último segmento; nunca rutas absolutas de proyectos ni de otros perfiles. `registryIntegrity`/`verifyAuditChain` (`[IMPLEMENTED]`) pueden ejecutarse en modo lectura y devolver `ok/denied` sin detalle interno. Sin credenciales, sin `home` del host, sin rutas de almacén, sin SQL, sin trazas.

### 6.10 `GET /health`

```json
{ "api": "pa-ui/0.1.0-draft", "contract": "0.1.0", "status": "ok|degraded", "registry": "ok|unavailable", "legacy": false }
```

`legacy:false` documenta explícitamente que **no** se está sirviendo la API v0.2 ni su almacén.

---

## 7. Errores

Se reutilizan los códigos de `lib/errors.mjs` (`[IMPLEMENTED]`), mapeados a HTTP y a un mensaje seguro para la persona. La UI nunca muestra `details` crudos: muestra `message` + un `hint` fijo por código.

| Código RAG | HTTP | Significado | Mensaje visible (ES) | Nunca revelar |
|---|---|---|---|---|
| `unauthenticated` `[IMPLEMENTED · PA01]` | 401 | el host no reconoce el peer: sin cookie de GUI o cookie inválida/caducada (se emite **antes** de entrar a la ruta del plugin) | «Vuelve a abrir DeepSeek Harness desde el enlace que imprime `dsh web`.» | si faltaba la cookie, si era inválida o si caducó |
| `session-invalid` | 401 | cabecera `x-lifecode-rag-session` ausente o mal formada | «No hay una sesión válida para esta ventana.» | patrón interno, id recibido |
| `session-unavailable` | 409 | no hay agente vivo con ese id (o el id no existe) | «La sesión ya no está activa; recarga la ventana.» | si el id existió alguna vez, existencia de otras sesiones |
| `session-expired` | 409 | sesión terminada (`expireSession`) | «La sesión terminó; abre una nueva.» | `expires_at` ajeno |
| `scope-unresolved` | 409 | sin selección y sin cwd resoluble | «Elige un proyecto para esta sesión.» | raíces de otros proyectos |
| `scope-ambiguous` | 409 | selección y cwd incompatibles, o varias raíces | «El directorio de trabajo no coincide con el proyecto; elige explícitamente.» | candidatos ajenos completos (sólo id/nombre) |
| `scope-forbidden` | 403 | proyecto archivado, sesión invalidada, ámbito fuera de la instantánea | «No tienes acceso a este proyecto en esta sesión.» | `invalid_reason` interno si es sensible |
| `scope-too-many` | 409 | >8 ámbitos | «La selección supera el máximo de ámbitos.» | lista de scopes no autorizados |
| `grant-revoked` | 403 | grant revocado durante la operación | «El acceso a una biblioteca cambió; vuelve a consultar.» | nombre de la biblioteca ajena |
| `invalid-argument` | 400 | parámetro o campo inválido/desconocido | «La solicitud no es válida.» | valores internos |
| `revision-conflict` `[IMPLEMENTED · CR-1]` | 409 | `expectedRevision` no coincide con la revisión actual | «Otra pestaña cambió el proyecto; recarga y reintenta.» | revisión de otras sesiones |
| `forbidden` `[IMPLEMENTED · PA01]` | 403 | la compuerta del host rechaza la petición pese a estar bien formada (trust/`Origin`) | «Esta ventana no está autorizada a leer el panel.» | motivo del rechazo en el host |
| `authorization-unavailable` `[IMPLEMENTED · PA01]` | 403 / 503 | el host no ofrece `ctx.connection` (403) o la compuerta falló al decidir (503): la API PA queda cerrada | «La autenticación del host no está disponible; el panel está cerrado.» | detalle interno del servicio |
| `audit-unavailable` `[PROPOSED]` | 503 | no se pudo escribir el evento `ui.read`; la lectura **no** se sirve | «No se pudo registrar el acceso; la operación no se completó.» | detalle del fallo de escritura, SQL, rutas |
| `source-not-found` | 404 | fuente inexistente en el proyecto | «La fuente no existe en este proyecto.» | si existe en otro proyecto |
| `store-not-initialized` | 503 | perfil sin registro | «El perfil aún no está inicializado.» | rutas del perfil |
| `registry-unavailable` | 503 | registro no disponible | «El registro del proyecto no está disponible.» | ruta del registro |
| `registry-corrupt` | 500 | registro corrupto | «El registro del proyecto está dañado.» | detalle SQL/fichero |
| `scope-store-unavailable` | 503 | almacén de biblioteca ausente/cargando | «Una biblioteca concedida no está disponible ahora mismo.» (puede incluir `Retry-After`) | rutas |
| `scope-store-corrupt` | 500 | almacén ilegible | «Una biblioteca concedida está dañada.» | detalle SQLite |
| `store-busy` | 503 | bloqueo transitorio | «El almacén está ocupado; reintenta.» | rutas |
| `fts-integrity` | 500 | índice FTS incoherente | «El índice de búsqueda está dañado.» | detalle |
| `vector-index-incomplete` | 500 | vectores incompletos | «El índice vectorial está incompleto.» | detalle |
| `too-large` | 413 | petición demasiado grande | «La solicitud es demasiado grande.» | límites internos exactos |
| `response-too-large` | 500 | la respuesta excedería el tope de 1 MiB y no se sirve | «La respuesta es demasiado grande para servirla.» | tamaño exacto del payload |
| `approval-required` | 409 | acción destructiva sin aprobación (no aplica a PA-UI-0) | «Esta acción requiere aprobación humana.» | — |
| `approval-unavailable` | 503 | sin servicio de aprobación | «No se puede pedir aprobación en este entorno.» | — |
| `egress-denied` | 403 | embedder remoto denegado | «El proveedor de embeddings no está autorizado.» | endpoint del proveedor |
| `embedding-failed` | 502 | fallo del embedder | «La búsqueda semántica no está disponible.» | mensaje del proveedor |
| `cancelled` | 499 `[PROPOSED]`/408 | petición abortada | «Consulta cancelada.» | — |
| `operation-uncertain` | 409 | resultado de escritura incierto | «La operación quedó en estado incierto; revisa el diagnóstico.» | — |
| `recovery-verification-failed` | 500 | verificación de recuperación fallida | «La recuperación no superó la verificación.» | — |
| `sync-root-unavailable` | 503 | raíz de sincronización no disponible | «Una raíz del proyecto no está accesible.» | ruta |
| `internal` | 500 | error no clasificado | «Error interno del servicio RAG.» | stack, SQL, rutas |

Reglas transversales: los errores de autorización **se auditan** en el registro (`appendRegistryAudit`, `[IMPLEMENTED]`); los de almacén siguen el contrato de errores PA2 (`[DOCUMENTED]` `docs/PROJECT-AWARE-ERROR-CONTRACT.md`). La API visual nunca responde con `200 { ok:false }`: usa el sobre de error con el status indicado. La diferenciación de errores no puede servir para enumerar: proyecto inexistente y proyecto no autorizado comparten respuesta (`403 scope-forbidden`, `reason: "project-unavailable"`); sesión desconocida y agente caído comparten `409 session-unavailable`.

### 7.1 Auditoría de lecturas: `ui.read` (PA03, revisado en PA-UI-0.2)

**Regla única (append-only estricto):** cada lectura auditada escribe **exactamente un evento nuevo e inmutable** en la cadena de auditoría del registro (`appendRegistryAudit`, hash-chain existente, `[IMPLEMENTED]`), sin cambios de esquema (`audit_registry`: `seq, at, actor, session_id, call_id, tool, action, target, outcome, detail`).

1. **Un evento por lectura.** No hay actualización de eventos, ni deduplicación, ni contadores que se incrementen después. Un evento escrito **nunca** se modifica (ni `detail`, ni `outcome`, ni `repeat`); la cadena `prev_hash`/`hash` lo impide por construcción.
2. **No existe `detail.repeat`.** Se retiró del contrato en PA-UI-0.2 (PA02) porque exigía mutar un evento ya escrito.
3. **Lectura auditada** = toda petición HTTP a una ruta de datos de §5 (todas salvo `/health`) que devuelva o modifique datos de sesión/proyecto, con independencia de que sea la primera, un refresco manual o un polling automático. Cada petición cuenta como una lectura y genera su fila.
4. **Polling y refrescos.** El control de volumen es de diseño de cliente, no de auditoría: el panel no hace polling si no está visible (WORKSPACE-UX §5), y el mínimo es 30 s. Ese polling, cuando ocurre, **sí** genera un evento por petición; no se suprime ni se agrega. Una petición repetida en el mismo segundo produce dos filas distintas, con `seq`, `at` y `call_id` propios.
5. **Reintentos.** Un reintento del cliente es una lectura nueva y genera su propio evento. No se reutiliza el `call_id` de la petición fallida.
6. **Fail-closed.** Si no se puede escribir el evento, la lectura **no** se sirve y se responde `503 audit-unavailable`. Excepción: `/health` (no auditado, no devuelve datos de sesión). No se sirve «sin dejar rastro».
7. **Sin esquema nuevo.** Se usa la tabla y la cadena existentes; no se añaden triggers, tablas, columnas ni ficheros.

| Campo del evento | Valor |
|---|---|
| `at` | epoch ms del inicio de la operación (no del final) |
| `actor` | `human` — **origen de la solicitud** (canal de interfaz operado por una persona), **no** una identidad autenticada. El host no prueba identidad humana (§3.2); el registro no debe leerse como «persona autenticada». La UI nunca escribe `model`: las acciones del modelo van por las herramientas v0.1 y conservan su propio `actor`. |
| `session_id` | **identidad efectiva** = `agent.id` resuelto (§3.3), nunca el string crudo de la cabecera |
| `call_id` | `correlationId` (UUID v4 generado por el servidor, devuelto en `x-lifecode-rag-request`) |
| `tool` | `lifecode_rag_ui` (constante; distingue el canal visual de las herramientas v0.1) |
| `action` | `ui.read` |
| `target` | operación lógica, una de: `session`, `projects`, `libraries`, `sources`, `source`, `search`, `context`, `selection` (sólo en lectura previa), `diagnostics` |
| `outcome` | `ok` \| `denied` \| `failed` |
| `detail` | JSON **redactado**: `{ "operation": "<target>", "status": <HTTP>, "durationMs": <entero>, "projectId": "prj_…" \| null, "scopeCount": <entero> }` — máximo 512 bytes serializados. Lista cerrada: cualquier otra clave es un fallo de contrato. |

**Exclusiones obligatorias del evento** (ni en `target`, ni en `detail`, ni en mensajes): texto de consulta (`query`), texto recuperado, snippets, títulos, URIs, nombres de fichero, rutas absolutas, cabeceras, cookies/tokens, cuerpos de petición o respuesta, `sessionId` de otras sesiones, ids de ámbitos (`scopeId`/`libraryId`), errores SQL y stacks. `projectId` sí se registra: es el proyecto activo de la propia sesión auditada.

**Redacción:** cualquier valor que no sea uno de los campos enumerados no se escribe; no hay «modo verboso». Un fallo al construir `detail` no impide el evento: se escribe `detail: {}` y `outcome` correcto.

**Por qué no hay deduplicación (decisión PA02):** la deduplicación con `repeat` exigía reescribir una fila ya encadenada, lo que contradice el carácter append-only del registro y permitía que un evento cambiara después de ser leído como prueba. Se elimina por completo: la auditoría gana en integridad y la contención de volumen se resuelve en el cliente (polling sólo con panel visible, 30 s).

**Append-only:** el evento se escribe **después** de la operación y **antes** de enviar el cuerpo; si el cliente aborta después, el evento queda con el `status` que se iba a enviar (`ok` para 2xx). La escritura es una transacción corta (`BEGIN IMMEDIATE`) sobre el registro, nunca sobre el almacén de ámbito.

---

## 8. Paginación, límites y rendimiento

Clasificación de PA05. Ningún valor de esta tabla se presenta como rendimiento medido si no lo está:

- **CONTRATO** — fijado por `CONTRATO-v0.1.md` o por el esquema ya implementado; cambiarlo rompería v0.1.
- **MEDIDO (motor)** — medido en el banco de eficiencia local, **no** sobre HTTP.
- **PROVISIONAL** — valor de diseño sin medición; se revisa con el banco de PA-UI-1.
- **PENDIENTE HOST** — depende de una capacidad o del comportamiento del host; no verificable en PA-UI-0.
- **DECISIÓN UX** — política de producto/interfaz, no límite técnico.

| Recurso | Valor | Clase | Origen / nota |
|---|---|---|---|
| Fuentes por página | 50 por defecto; máximo 200 | CONTRATO | `listSources` (50) y `listProject` (200) `[IMPLEMENTED]`; por encima, `400 invalid-argument` — en la API PA lo aplica `queryParams` de `lib/pa-api.mjs` (`reason: "limit-too-large"`) |
| Desplazamiento de fuentes | entero ≥ 0, acotado por `total` | CONTRATO | `LIMIT ? OFFSET ?` `[IMPLEMENTED]` |
| Resultados de búsqueda | 8 por defecto; máximo 50 | CONTRATO | `CONTRATO-v0.1.md`; `limit: 51` → `400` |
| Presupuesto de contexto | 2000 tokens por defecto | CONTRATO | `config.context` `[IMPLEMENTED]` |
| Fragmentos por fuente | 200 por defecto; máximo 500 | 200 CONTRATO / 500 PROVISIONAL | `getAcross` (200) `[IMPLEMENTED]`; 500 es diseño |
| Texto por fragmento | 1200 caracteres en detalle | CONTRATO | tamaño de chunk de v0.1 |
| `snippet` en búsqueda | 240 caracteres | PROVISIONAL | sin medición; recorte de presentación |
| Consulta | 512 caracteres | PROVISIONAL | no hay límite medido del motor; por encima, `400` (nunca recorte silencioso) |
| Respuesta | 1 MiB | PROVISIONAL | cuerpos mayores → `413 too-large` |
| Tiempo por operación | 10 s | PROVISIONAL | el motor mide 32–45 ms en banco local (`[IMPLEMENTED]` `tests/efficiency.test.mjs`), **no** el canal HTTP |
| Polling de la UI | 30 s mínimo; sólo con panel visible | DECISIÓN UX | §7.1 + WORKSPACE-UX §5; no hay dedupe de auditoría |
| Tamaño de cuerpo de petición | 1 MiB | PROVISIONAL | §5 |

Paginación: **offset** es suficiente y compatible con el modelo actual. No se introduce cursor en PA-UI-1. La búsqueda no pagina (el motor devuelve top-k; ampliar `limit` es la vía, acotada a 50) — decisión D-UI-06 confirmada.

**Rendimiento no medido:** PA-UI-0 no ejecutó el canal HTTP. Los criterios J-01/J-02 (p95) son objetivos de PA-UI-1, no resultados. Cualquier cifra de latencia HTTP citada en otro documento sin evidencia de PA-UI-1 es una previsión, no una medida.

---

## 9. Seguridad

### 9.1 Requisitos no negociables

1. **Autenticación del peer = la del host** (cookie de GUI, principal `owner`). La sesión es direccionamiento, no credencial (§3.2–3.3). La API **no** afirma en ningún sitio que autentica una sesión. `[VERIFIED HOST]` + `[IMPLEMENTED · PA01]`: el adaptador llama a `ctx.connection.requestRejection` y `admit` en **cada** petición, antes de resolver la ruta; sin `ctx.connection` niega (`503 authorization-unavailable`). Medido: `tests/pa-auth.test.mjs` (8 casos) y `tests/host-adapter.test.mjs`.
2. Resolución de sesión/proyecto antes de cualquier dato (§4).
3. Grants validados en cada operación; revalidación antes de devolver (`ctx.checkpoint`). `[IMPLEMENTED]`
4. Apertura de almacenes sólo vía `ctx.open`. `[IMPLEMENTED]`
5. Cierre garantizado en `finally`. `[IMPLEMENTED]`
6. Sin fallback al almacén heredado: la API visual no consulta `rag.sqlite3`. `[IMPLEMENTED]` (hoy ni existe)
7. Sin acceso global: `GET /projects` acotado a cwd/selección; `/sources` y `/sources/:id` sólo proyecto.
8. Bibliotecas en lectura; la API visual no expone ninguna escritura salvo `/selection`.
9. Denegación por defecto: cabecera ausente → `401 session-invalid`; sin selección → `409`; biblioteca sin grant → no listada.
10. **Escritura mínima estricta:** `POST /selection` acepta **exactamente** `projectId` + `expectedRevision`; cualquier otro campo → `400 invalid-argument` (rechazo, no ignorar). `[PROPOSED]` (PA02)
11. Redacción de diagnóstico (§6.9) y de auditoría (§7.1).
12. Render seguro en cliente: todo texto va como nodo de texto (nunca `innerHTML` con datos del motor).
13. **Auditoría de lectura obligatoria y fail-closed:** si no se puede escribir `ui.read`, no se sirve el dato (`503 audit-unavailable`). `[PROPOSED]` (PA03)
14. **Sin CORS** y `x-lifecode-rag: 1` obligatoria en `POST`; `Origin`/`Host` loopback verificados.
15. **Sin enumeración por errores:** proyecto inexistente ≡ no autorizado; sesión desconocida ≡ agente caído (§7).

### 9.2 Matriz de amenazas

| # | Amenaza | Vector | Control | Estado |
|---|---|---|---|---|
| T1 | Suplantar otra sesión enviando su `sessionId` | cabecera HTTP | lookup en agentes vivos + loopback + token del GUI + auditoría por lectura | **NO MITIGABLE por el plugin** → BLOCKED (D-UI-03) |
| T2 | Pedir un ámbito ajeno en query/body | `?scope=`, `?project=` | parámetros inexistentes; sólo `projectId` en `/selection`, validado contra candidatos | diseñado |
| T3 | Acceso cruzado entre proyectos | refs de fuente | `getSource` se ejecuta **dentro** del almacén del proyecto autorizado; ids de otro proyecto no resuelven | diseñado |
| T4 | Biblioteca sin grant | `/libraries`, search | sólo `effectiveScopes`; store ni se abre | implementado (PA3) |
| T5 | Fallback al almacén v0.2 | ruta API | prefijo distinto; `legacy:false`; sin lectura de `rag.sqlite3` | implementado |
| T6 | Fuga de datos en error | mensajes 5xx | catálogo cerrado de mensajes; `details` nunca se envían | diseñado |
| T7 | Exposición de rutas absolutas | `/diagnostics` | sólo conteos/final de ruta | diseñado |
| T8 | XSS en títulos/snippets | contenido indexado | render como texto; CSP del GUI | diseñado (PA-UI-1) |
| T9 | CSRF desde una página local | POST | cabecera `x-lifecode-rag`, JSON, Origin loopback, token del host | diseñado |
| T10 | Inyección SQL | parámetros | consultas ya parametrizadas; la API no concatena SQL | implementado (motor) |
| T11 | DoS por consultas costosas | search loop | límites §8 + `maxVectorScan` del motor | implementado (motor) |
| T12 | Selección automática por el modelo | UI | `/selection` exige actor humano; ninguna herramienta llama a la API | diseñado |
| T13 | Proceso local con la cookie del GUI se hace pasar por `owner` y direcciona otra sesión | cookie/token del host | Ninguno disponible en el plugin; es el modelo del host (owner no se comprueba); mismo riesgo que las APIs de sesión nativas | **BLOCKED (host)** — D-UI-03 |
| T14 | Inundación de la auditoría por polling | UI | `/health` no auditado; polling acotado en cliente (30 s, sólo visible); una fila **inmutable** por petición (sin dedupe) | diseñado (PA03/PA02) |
| T15 | Enumeración de sesiones/proyectos por diferencias de error | respuestas | `403 project-unavailable` único; `409 session-unavailable` único; sin distinguir existencia | diseñado (PA04) |
| T16 | Fuga de datos a través de la auditoría | cadena de auditoría | `detail` con lista cerrada de campos, máximo 512 B, sin texto/URIs/rutas | diseñado (PA03) |
| T17 | Inyección por campos desconocidos en el cuerpo | `POST` | esquema estricto → `400 invalid-argument`; nunca se usa `sessionId` del cuerpo | diseñado (PA02) |

---

## 10. Compatibilidad

- **Herramientas v0.1:** sin cambios de nombre, esquema, semántica ni salida. La API visual es un contrato separado (`pa-ui/0.1.0-draft`).
- **`CONTRATO-v0.1.md`:** intacto (SHA-256 arriba).
- **API v0.2 (`/lifecode-rag/api`):** no se reutiliza; sigue montándose sólo si existe el almacén heredado, para quien lo tenga (`[IMPLEMENTED]` `index.js`).
- **Almacenes:** sólo bajo la raíz de datos RAG (`$DSH_HOME/lifecode-rag` o `LIFECODE_RAG_ROOT`): `profiles/<perfil>/registry.sqlite3` y `profiles/<perfil>/scopes/<scope>/rag.sqlite3`; sin almacén legado como respaldo.
- **Host:** contrato de slots/servicios de DSH 0.2.2-rc.5; cualquier versión fuera de `>=0.2.2-rc.3 <0.3.0` queda fuera del contrato (`engines.dsh` del plugin).

---

## 11. Decisiones y estado tras PA-UI-0.1 (actualizado en PA-UI-0.2)

| Id | Decisión | Estado | Resolución |
|---|---|---|---|
| D-UI-01 | Nombre y prefijo de la API: `/lifecode-rag/ui/api` | **CONFIRMADA** | Prefijo distinto de la API v0.2; sin cambios. |
| D-UI-02 | Transporte de identidad | **BLOCKED** (antes «cabecera + lookup») | La cabecera es direccionamiento; el host no autentica sesiones. No se declara resuelta (§3.2–3.4). |
| D-UI-03 | Riesgo residual de suplantación local | **BLOCKED / PENDING HUMAN DECISION** | **No otorgada.** Requiere decisión humana explícita e independiente. Documentar la limitación no es aceptarla (§3.5). |
| D-UI-04 | `expectedRevision` en selección | **RESUELTA DOCUMENTALMENTE** | Contrato §6.2: obligatoria, `409 revision-conflict`, sin escritura en conflicto. Implementación pendiente (GAP-09). |
| D-UI-05 | Candidatos = cwd ∪ actual | **CONFIRMADA** | Sin descubrimiento global; `/projects` acotado. |
| D-UI-06 | Sin paginación de búsqueda; offset en fuentes | **CONFIRMADA** | §8. |
| D-UI-07 | Auditar lecturas `ui.read` | **RESUELTA DOCUMENTALMENTE** (revisada en PA-UI-0.2) | §7.1: un evento inmutable por lectura, sin dedupe ni `repeat`, `actor` de origen, fail-closed. Implementación pendiente (GAP-07). |
| D-UI-08 | Diagnóstico con rutas redactadas | **CONFIRMADA** | §6.9: conteo + último segmento; nunca ruta absoluta. |
| D-UI-09 | Cifras 512 / 1 MiB / 10 s / 240 / 500 | **CLASIFICADAS** | §8: PROVISIONAL salvo las marcadas CONTRATO; ninguna medida HTTP. |
| D-UI-10 | `session-unavailable` como código propio, 409 | **RESUELTA** | §7: `409 session-unavailable` (antes 401). |
| D-UI-11 | Vía alternativa de mitigación por aislamiento topológico | **NOT DEMONSTRATED** (nueva en PA-UI-0.2) | §3.6: criterios TI-1…TI-7; no es autenticación; no se ha ejecutado ninguna prueba. |

**Resultado global de PA-UI-0.1: `BLOCKED`** por PA01/D-UI-03. PA-UI-1 sigue sin autorización. PA-UI-0.2 no cambia el resultado: ordena la auditoría (PA02), fija `actor` (PA03), unifica GAP-20 como `OPEN / DOCUMENTED HOST LIMITATION` y añade la ruta topológica como mitigación **no demostrada**.

---

## 12. Trazabilidad de este documento

- Código inspeccionado: `lib/exec-context.mjs`, `lib/resolve.mjs`, `lib/sessions.mjs`, `lib/registry-schema.mjs`, `lib/schema.mjs`, `lib/errors.mjs`, `lib/scope-ops.mjs`, `lib/tools.mjs`, `lib/server.mjs`, `lib/readmodel.mjs`, `lib/search.mjs`, `lib/session-identity.mjs`, `index.js`, `client.js`, `package.json`.
- Host inspeccionado en vivo (sólo lectura): `agents`, `connection`, `webServer`, `workingDirectory`, `approval`, `tools`; slots `sidebar.panellist`, `main`, `conversation.session.header.actions`; servicios de cliente `sessions`, `slots`, `locale`.
- Fuentes del host leídas en `app.asar` (sólo lectura, PA-UI-0.1): `@deepseek-ai/dsh-client-connection/src/browser-auth.ts`, `src/api-request-trust.ts`, `src/peer.ts`, `README.md`; `@deepseek-ai/dsh-api-remote-access/README.md`; `@deepseek-ai/dsh-api-session-controller/src/index.ts`; `@deepseek-ai/dsh-authorization/src/index.ts` (flujos de obtención de credenciales OAuth/token, no identidad de sesión).
- Diagnóstico previo: `eval/pa3/evidence/D-UI-RAG-01-REPORT.md` (UI actual = BLOCKED; herramientas = VERIFIED HOST).
- Este documento **no** afirma que la UI exista: la UI Project-Aware está **NO IMPLEMENTADA** (`[GAP]`).

---

## 13. Registro de revisión PA-UI-0.1 (2026-11-18)

Cambios de esta revisión, exclusivamente documentales:

1. **§3 reescrita.** Separación explícita entre *autenticación del peer* (host, `owner`) y *direccionamiento de sesión* (cabecera). Añadidas las tablas de evidencia del host (§3.2) y de alternativas evaluadas (§3.4). PA01 → `BLOCKED`.
2. **§4** incorpora la auditoría de lectura y la cabecera `x-lifecode-rag-request`; el agente vivo pasa a `409 session-unavailable`.
3. **§5** añade rechazo estricto de campos/parámetros desconocidos, correlación y cuerpo máximo.
4. **§6.2** convierte `expectedRevision` en obligatoria con `409 revision-conflict` y escritura condicional atómica (PA02).
5. **§7** distingue `unauthenticated` (host), `session-invalid` (401), `session-unavailable`/`session-expired` (409), y añade `revision-conflict` y `audit-unavailable`; §7.1 define `ui.read` completo (PA03).
6. **§8** clasifica cada límite en CONTRATO / MEDIDO / PROVISIONAL / DECISIÓN UX (PA05).
7. **§9** elimina la afirmación de que el host transporta identidad; matriz con T13–T17.
8. **§11** registra el estado de D-UI-01…10.

Sin cambios en: código (`lib/`, `index.js`, `client.js`), `package.json`, esquemas, endpoints, slots, perfiles, registro, almacenes, `CONTRATO-v0.1.md`, `skill-compiler/`, `_audit/`, `lifecode-skill-center/`, `MEMORY.md`, `AGENTS.md`. Sin instalación, sin reinicio, sin `node --test` raíz, sin operaciones Git de escritura.

**Resultado:** `BLOCKED` (PA01/D-UI-03). Los demás puntos, resueltos documentalmente. Detalle y matrices en `docs/PA-UI-0.1-REVIEW.md`.

---

## 14. Registro de revisión PA-UI-0.2 (2026-11-18)

Cambios, exclusivamente documentales:

1. **§7.1 reescrita (PA02).** Append-only estricto: un evento **nuevo e inmutable** por lectura; se elimina la deduplicación de 5 s y el campo `detail.repeat` porque exigían mutar filas ya encadenadas. Se define «lectura auditada» (toda petición a rutas de datos, incluido polling y refresco) y se traslada la contención de volumen al cliente (sin polling si el panel no está visible; mínimo 30 s). Fail-closed se mantiene.
2. **§7.1 `actor` (PA03).** `actor = human` para todo `ui.read`, definido como **origen del canal** (persona operando el panel), no como identidad autenticada; se prohíbe escribir `model` por la UI. Se distingue origen de solicitud de autenticación de identidad.
3. **§3.4/§3.5 (GAP-20).** La limitación del host pasa a `OPEN / DOCUMENTED HOST LIMITATION`; se elimina el lenguaje de «riesgo aceptado»; D-UI-03 queda `BLOCKED / PENDING HUMAN DECISION` y **no otorgada**.
4. **§3.6 nueva (ruta topológica).** Criterios TI-1…TI-7 para una mitigación por aislamiento; se declara `NOT DEMONSTRATED`, se distingue expresamente de la autenticación de sesión y no se ejecutó ninguna prueba.
5. **§11** añade D-UI-11 y actualiza D-UI-03/D-UI-07.
6. **§13** se conserva íntegro como historial.

Ver `docs/PA-UI-0.2-REVIEW.md` para la tabla de hallazgos y la verificación.

---

## 15. Registro de revisión ACP-01 (2026-11-21)

Cambios de implementación (con su documentación):

1. **PA01 — autenticación del panel (§3, §7, §9.1).** La API PA estaba **abierta**: `webServer.register`
   no pasa por la compuerta del host y `GET /lifecode-rag/pa/health` respondía 200 sin credencial. Ahora
   `createPaHandler` recibe una `authorize` opcional y el adaptador la construye con
   `ctx.connection.requestRejection({headers})` + `admit({headers})`. La compuerta se evalúa **antes** de
   resolver la ruta (una ruta inventada y una real responden lo mismo sin credencial), el principal se toma
   del `Peer` del host (`owner`) y ninguna cabecera del renderer concede identidad. Sin servicio de conexión
   se falla cerrado. Códigos nuevos en `RAG_CODES`: `unauthenticated`, `forbidden`,
   `authorization-unavailable`.
2. **CR-1 — selección con CAS (§6.2).** Implementada según lo descrito arriba; esquema del registro
   **v2** con tabla aditiva `pa_selection` (`lib/registry-schema.mjs`, `lib/selection.mjs`) y migración
   aditiva dentro de `openRegistry` (un registro v1 se abre, se migra y conserva datos y auditoría).
3. **Snapshot.** `GET /snapshot` devuelve `selection` (proyección de `pa_selection`), `projects` (los
   proyectos **activos** del perfil con `id`, `name`, `roots`, `authorized` y `current`: es la lista que el
   panel necesita para cambiar de proyecto) y `auth.principal` (sólo el principal del host, nunca
   credenciales). Con varios proyectos y sin selección sigue siendo `403 scope-ambiguous`: no se elige un
   proyecto «por defecto» a la callada.
   El panel pide `?limit=200` (el máximo de §8) para que la lista cargada coincida con el total del perfil;
   si el proyecto tiene más de 200 fuentes, la vista lo declara (`sources.capped`) en vez de presentar la
   página como si fuera el total.
4. **Versión de la API:** `PA_VERSION = 'pa/1.1.0'` (en ACP-02 sube a `pa/1.2.0` por §6.11).
5. **Pruebas.** `tests/pa-auth.test.mjs` (8 casos de PA01), `tests/selection-cas.test.mjs` (9 casos de CR-1),
   dos casos de compuerta en `tests/host-adapter.test.mjs`, tres de reducer en `tests/client.test.mjs` y la
   migración v1→v2 en `tests/registry.test.mjs`.

Sin cambios en: contratos de las siete herramientas, almacenes de ámbito, DEMO/fixtures, motor de búsqueda,
embeddings y presupuesto de contexto.

---

## 16. Registro de revisión ACP-02 (2026-11-22)

1. **Catálogo de errores completo y único (`lib/errors.mjs`).** `RAG_CODES` pasa de 34 a 52 códigos: se
   añadieron los 18 que el código lanzaba sin catalogar —entre ellos los de autorización (`scope-forbidden`,
   `grant-revoked`, `session-invalid`, `session-expired`, `project-not-authorized`, `scope-ambiguous`,
   `scope-too-many`, `scope-unresolved`) y los de ruta (`path-escape`, `hardlink-refused`, `root-overlap`,
   `sequence-conflict`, `vector-index-incomplete`, `registry-*`, `scope-store-*`, `sync-root-unavailable`)—.
   El catálogo y el mapa `HTTP_STATUS` son el mismo conjunto (biyección probada) y **un solo mapa** alimenta
   las dos APIs: `pa-api` y el servidor heredado (`LEGACY_HTTP_OVERRIDES` declara las tres diferencias de la
   v0.2). Un `RagError` con código no catalogado conserva el código (`catalogued:false`) en vez de convertirse
   en `internal` en silencio.
2. **Clasificación explícita de seguridad.** `SECURITY_CODES` (decisiones: siempre 4xx, probado que nunca
   5xx) y `FAIL_CLOSED_CODES` (`approval-unavailable`, `authorization-unavailable`: 503 porque el fallo es del
   servicio, no una decisión). Invariante probada por status: todo `401`/`403` del catálogo está clasificado.
3. **`GET /history` (§6.11)** implementado con paginación, ámbito estructural y redacción; el panel estrena la
   pestaña **Historial** con cadena verificada en lugar del «no disponible».
4. **Pruebas:** `tests/error-codes.test.mjs` (8 casos, recorren el fuente) y `tests/pa-history.test.mjs`
   (5 casos). Total del proyecto: **448**.
