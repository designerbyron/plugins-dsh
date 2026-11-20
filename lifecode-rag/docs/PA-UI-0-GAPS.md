# PA-UI-0 — Capacidades existentes, derivables y ausentes (GAP)

**Proyecto:** LifeCode RAG · **Fase:** PA-UI-0 (diseño) · **Estado:** PROPOSED — pendiente de aprobación humana
**Contrato de referencia:** `docs/PA-UI-0-API-CONTRACT.md` (`pa-ui/0.1.0-draft`, revisión 2)
**Fecha:** 2026-11-18 · **Revisión PA-UI-0.1:** 2026-11-18
**Resultado de la revisión PA-UI-0.1:** `BLOCKED` por PA01 (GAP-03/GAP-19). Ver `docs/PA-UI-0.1-REVIEW.md` y §4.1.
**Revisión PA-UI-0.2 (documental):** GAP-20 unificado como `OPEN / DOCUMENTED HOST LIMITATION` (no «aceptado»); auditoría `ui.read` append-only; ruta de aislamiento topológico `NOT DEMONSTRATED` (§4.2). Ver `docs/PA-UI-0.2-REVIEW.md`.

> Este documento clasifica lo que **ya existe**, lo que se puede **derivar** sin tocar el dominio y lo que **falta** para la interfaz Project-Aware.
> Ninguna capacidad ausente se implementa aquí. Las contradicciones entre código y documentación se registran, no se corrigen (orden PA-UI-0 §10).

---

## 1. Método

Se inspeccionaron en el worktree real (`fix/t45-4-r17-acceptance`, HEAD `b6c0cd24621c8bc3282185d1821c60b7956f8a83`):

- `lifecode-rag/lib/`: `exec-context.mjs`, `resolve.mjs`, `sessions.mjs`, `registry.mjs`, `registry-schema.mjs`, `schema.mjs`, `errors.mjs`, `scope-ops.mjs`, `scope-stores.mjs`, `tools.mjs`, `server.mjs`, `readmodel.mjs`, `search.mjs`, `session-identity.mjs`, `library-state.mjs`, `maintenance.mjs`, `audit.mjs`;
- `lifecode-rag/index.js`, `client.js`, `package.json`, `cordis.patch.yml`;
- documentación: `CONTRATO-v0.1.md`, `PROJECT-AWARE-ARCHITECTURE.md`, `PROJECT-AWARE-SESSION-CONTRACT.md`, `PROJECT-AWARE-ERROR-CONTRACT.md`, `WORKSPACE-API.md`, `WORKSPACE-UX.md`;
- host vivo, sólo lectura: servicios `agents`, `connection`, `webServer`, `workingDirectory`, `approval`, `tools`; slots `sidebar.panellist`, `main`, `conversation.session.header.actions`; servicios de cliente `sessions`, `slots`, `locale`;
- diagnóstico previo `eval/pa3/evidence/D-UI-RAG-01-REPORT.md`.

Estados: **EXISTENTE** (código lo hace hoy), **DERIVABLE** (dato/función existe pero no está expuesto), **GAP** (no existe), **UNKNOWN** (sin evidencia).

---

## 2. Capacidades existentes

| # | Capacidad | Dónde | Evidencia |
|---|---|---|---|
| E-01 | Identidad de sesión compuesta por el host (`agent.id`), validada por perfil | `lib/session-identity.mjs` | `captureSession`, `assertSessionId`, `assertProfile` |
| E-02 | Contexto autorizado único `withAuthorizedContext` con revalidación y cierre en `finally` | `lib/exec-context.mjs` | usado por las 7 herramientas |
| E-03 | Resolución determinista proyecto/selección/cwd, fail-closed, auditada | `lib/resolve.mjs` | `resolveScope`, `deny`, `succeed` |
| E-04 | Selección explícita idempotente, auditada, con `selectedBy human\|host` | `lib/sessions.mjs:67` | `registerSelection` |
| E-05 | Ciclo de vida de sesión (expire/invalidate/orphans) y motivos del contrato | `lib/sessions.mjs:144–220` | `INVALID_REASONS` |
| E-06 | Grants de lectura, revocación, un solo grant abierto por par | `registry-schema.mjs` `grants_one_open` | DDL + `grantLibrary`/`revokeGrant` |
| E-07 | Ámbitos efectivos = proyecto + bibliotecas concedidas, máx. 8 | `lib/sessions.mjs`, `lib/resolve.mjs` | `effectiveScopes`, `scope-too-many` |
| E-08 | Apertura autorizada de almacenes y verificación de identidad del store | `lib/scope-stores.mjs` | `openScopeStore`, `verifyStoreIdentity` |
| E-09 | Búsqueda multi-ámbito con fusión RRF y procedencia por fila | `lib/scope-ops.mjs` | `searchScopes` (`scopeId`, `scopeKind`) |
| E-10 | Contexto con citas y presupuesto global; fail-closed si un ámbito es ilegible | `lib/scope-ops.mjs`, `lib/context.mjs` | `contextScopes` |
| E-11 | Listado de fuentes del proyecto con paginación offset | `lib/scope-ops.mjs`, `lib/search.mjs:289` | `listProject`, `listSources` |
| E-12 | Lectura de una fuente por id o URI dentro de un almacén | `lib/search.mjs:282` | `getSource` |
| E-13 | Estado de almacén de biblioteca (present/missing/corrupt/unreadable/migrating) | `lib/library-state.mjs` | usado por diagnóstico PA3 |
| E-14 | Auditoría encadenada del registro y del almacén | `lib/audit.mjs`, `registry-schema.mjs` | `verifyAuditChain`, `audit_registry` |
| E-15 | Diagnóstico interno de un almacén (snapshot, actividad, salud) | `lib/readmodel.mjs` | `buildSnapshot`, `activityFeed` |
| E-16 | Servidor HTTP con guardas loopback/Host/Origin y cabecera de escritura | `lib/server.mjs` | `assertLoopback`, `assertWrite` |
| E-17 | Siete herramientas públicas v0.1 registradas y visibles en el host | `lib/tools.mjs`, `index.js` | `Tool.listTools` |
| E-18 | Slot de sesión del host entrega `sessionId` (patrón ya usado por skill-center) | host + `lifecode-skill-center/client.js` | ocupante `lifecode-skill-center.session-probe` |
| E-19 | Servicios host `agents.get(SessionId)`, `connection.requestRejection`, `webServer.register` | host | catálogo de servicios |
| E-20 | Migración/recovery de almacenes con rollback | `lib/migrate.mjs`, `lib/recovery.mjs` | pruebas PA1/PA4 |

---

## 3. Capacidades derivables (sin tocar el dominio)

| # | Capacidad | Cómo se deriva | Coste | Nota |
|---|---|---|---|---|
| D-01 | Proyectos seleccionables por cwd | `listRoots` + `pathKeyFor` + contención (`insideRoot`, hoy privada) | bajo | requiere exportar o replicar la comparación (GAP-04 menor) |
| D-02 | Nombre del proyecto en `/session` | `getProject(db, projectId)` | trivial | ya usado por `resolveScope` |
| D-03 | `mime`, `sha256`, `charCount`, `indexedAt` en `/sources` | columnas de `sources` no proyectadas por `listSourceRows` | bajo | ampliar proyección en la API, no en v0.1 |
| D-04 | Conteo de fragmentos por fuente | subconsulta ya usada por `listSources` (`chunks`) | trivial | — |
| D-05 | Estado del servicio (`ok/degraded`) | combinar `registryIntegrity` + `library-state` | bajo | definir regla (degradado si biblioteca concedida missing/corrupt) |
| D-06 | Salud de la sesión sin abrir almacenes | `openRegistry(create:false)` + `getSession` + `resolveScope` capturando códigos | bajo | las denegaciones ya se auditan |
| D-07 | Procedencia por ámbito en search/context | `searchScopes` ya devuelve `scopes[]` | trivial | la herramienta la elimina por proyección |
| D-08 | Actividad reciente acotada | `activityFeed(db,{limit})` sobre el store del proyecto | bajo | sólo proyecto, no bibliotecas |
| D-09 | Redacción de rutas | último segmento + conteo | bajo | política nueva, no existe helper |
| D-10 | `expectedRevision` (concurrencia optimista) | añadir condición `revision = ?` en `UPDATE session_scope` | medio | cambio de comportamiento PA2 (decisión D-UI-04) |

Ninguna derivación puede alterar la salida pública de las herramientas v0.1.

---

## 4. GAP (capacidades ausentes)

| Id | GAP | Impacto | Severidad | Resolución propuesta | Fase |
|---|---|---|---|---|---|
| **GAP-01** | **La mitad cliente no existe en el host**: `package.json` sin `exports["./client"]`, sin `dsh.client.inject`; `client.js` usa la API obsoleta `ctx.slots.inject(slot)` + `.register` (contra `inject(slot, cb) → disposer`) y no hay diccionarios de locale | **No hay panel ni UI posible** | **Bloqueante** | Corregir manifiesto y registro de slots; añadir locale; verificar con el catálogo de slots del host | PA-UI-1 |
| **GAP-02** | No existe API Project-Aware: `index.js` sólo monta `/lifecode-rag/api` si existe `rag.sqlite3` legado | No hay backend visual | **Bloqueante** | Implementar el contrato §5 bajo `/lifecode-rag/ui/api` | PA-UI-1 |
| **GAP-03** | El peer HTTP no transporta identidad de sesión (sólo `principal: owner`); el host autentica **autoridad**, no sesión | Identidad sólo por cabecera + lookup en agentes vivos; riesgo residual no eliminable | **Alta → BLOCKED** | Cabecera de sesión + `agents.get` + admisión `connection.requestRejection`; el riesgo **no** está aceptado (GAP-20/D-UI-03) | PA-UI-1 (sólo con G6) |
| **GAP-04** | No hay función pública «proyectos para un cwd» (`matchingProjects` es privada; `listProjects` no existe) | `GET /projects` requiere exportar o replicar | Media | Exportar `matchingProjects` o añadir `projectsForCwd(db, cwdKey)` en `resolve.mjs` | PA-UI-1 |
| **GAP-05** | No hay función exportada que liste fragmentos de una fuente (la tabla existe; `getAcross` es multi-ámbito y por `ref`) | `GET /sources/:id` necesita helper de lectura | Baja | Añadir `sourceChunks(db, sourceId, {limit, offset})` en `search.mjs` | PA-UI-1 |
| **GAP-06** | No hay read-model multi-ámbito para diagnóstico (`buildSnapshot` asume una raíz única) | `/diagnostics` debe componer estados por ámbito | Media | Componer desde `ctx.scopes` + `library-state` + `readmodel` acotado al proyecto | PA-UI-1 |
| **GAP-07** | Las lecturas de UI no se auditan (sólo resoluciones y escrituras) | Sin trazabilidad de acceso | Media | Política `ui.read` cerrada en el contrato §7.1; implementarla con la tabla `audit` existente | PA-UI-1 (REQUIRES IMPLEMENTATION) |
| **GAP-08** | No hay diccionarios de locale del plugin | Textos de UI sin i18n | Baja | Añadir `locale/` y `ctx.effect(() => locale.register(NS, dicts))` | PA-UI-1 |
| **GAP-09** | `registerSelection` no soporta concurrencia optimista (última escritura gana) | Dos pestañas pueden pisarse | Media | `expectedRevision` obligatoria con `UPDATE … WHERE revision = ?` (contrato §6.2) | PA-UI-1 (REQUIRES IMPLEMENTATION) |
| **GAP-10** | No hay métricas/estado por biblioteca expuestos a UI | El diagnóstico no puede mostrar salud por biblioteca | Baja | Derivar de `library-state` + `registryIntegrity` | PA-UI-1 |
| **GAP-11** | No hay política de expiración de sesiones (`expires_at` queda `null`) | Sesiones inmortales hasta invalidación | Media | Decisión humana sobre TTL; no inventar | PA-UI-2 |
| **GAP-12** | PA2 permite seleccionar **cualquier** proyecto activo por id; no exige que el proyecto sea alcanzable desde el cwd | Un humano podría seleccionar un proyecto cuyas raíces no ve | Media | Restringir candidatos a cwd ∪ actual en la API (D-UI-05), sin tocar PA2 | PA-UI-1 |
| **GAP-13** | No hay helper de redacción de rutas/sensibles | Riesgo de fuga en `/diagnostics` | Baja | Redactor explícito en la capa UI | PA-UI-1 |
| **GAP-14** | Los ids de fuente son locales al almacén; no hay id público con ámbito | Ambigüedad en enlaces profundos entre ámbitos | Baja | Compuesto `scopeId + sourceId` en la API | PA-UI-1 |
| **GAP-15** | No hay eventos/streaming para la UI (sólo petición-respuesta) | Refresco por polling | Baja | Polling 30 s con panel activo (modelo UX) | PA-UI-2 |
| **GAP-16** | No hay endpoint de fragmentos paginados ni búsqueda por ordinal en UI | Detalle limitado | Baja | `chunks` con `limit/offset` | PA-UI-1 |
| **GAP-17** | `searchScopes` devuelve siempre `partial:false` y `errors:[]` | La UI no puede mostrar «parcial» | Baja | Documentar fail-closed (PA4-F) como comportamiento definitivo | PA-UI-0 |
| **GAP-18** | No hay verificación de que el `sessionId` de cabecera corresponda a la pestaña que lo envía | Suplantación local | **Alta → BLOCKED** | No existe primitiva; auditar toda lectura (append-only) y mantener el riesgo como limitación documentada hasta decisión humana (D-UI-03) | PA-UI-2 (sin vía hoy) |
| **GAP-19** | El host no emite ninguna capacidad/credencial ligada a una sesión de conversación: la cookie de GUI se liga a la **autoridad**, dura 30 días y no tiene logout (`dsh-client-connection/src/browser-auth.ts`); `browserPeer` es único y `owner` | No puede probarse propiedad de sesión en HTTP | **Alta → BLOCKED** | Documentar (no inventar API); mitigación por aislamiento topológico **no demostrada** (§4.2) | sin fase (host) |
| **GAP-20** | El plugin no puede distinguir «petición sin credencial» de «credencial inválida»: ambas las rechaza el host antes de la ruta | Los estados del cliente no pueden ser exactos | Baja | El cliente trata ambos como «no autenticado»; estado **`OPEN / DOCUMENTED HOST LIMITATION`** (documentar no es aceptar) | PA-UI-1 |

---

## 4.1 Estado de cada GAP tras PA-UI-0.1

Clasificación exigida por PA-UI-0.1: `RESOLVED DOCUMENTALLY` (el contrato lo cierra; falta implementarlo), `OPEN`, `BLOCKED` (necesita una capacidad inexistente), `REQUIRES IMPLEMENTATION`, `REQUIRES HOST EVIDENCE`.

| GAP | Estado PA-UI-0.1 | Motivo |
|---|---|---|
| GAP-01 | REQUIRES IMPLEMENTATION | manifiesto y slots: contrato claro, sin evidencia de carga (G3/G4) |
| GAP-02 | REQUIRES IMPLEMENTATION | API definida en §5–§8; no existe |
| GAP-03 | **BLOCKED** | evidencia de host: sin identidad de sesión en el peer (b30) |
| GAP-04 | REQUIRES IMPLEMENTATION | helper `matchingProjects`/`projectsForCwd` |
| GAP-05 | REQUIRES IMPLEMENTATION | helper `sourceChunks` |
| GAP-06 | REQUIRES IMPLEMENTATION | composición de diagnóstico |
| GAP-07 | RESOLVED DOCUMENTALLY + REQUIRES IMPLEMENTATION | política `ui.read` §7.1 cerrada (append-only, sin dedupe, revisada en PA-UI-0.2) |
| GAP-08 | REQUIRES IMPLEMENTATION | locale |
| GAP-09 | RESOLVED DOCUMENTALLY + REQUIRES IMPLEMENTATION | §6.2 con CAS y `409 revision-conflict` |
| GAP-10 | REQUIRES IMPLEMENTATION | métricas por biblioteca |
| GAP-11 | OPEN | TTL: decisión humana pendiente (GAP-11 real) |
| GAP-12 | RESOLVED DOCUMENTALLY | D-UI-05: candidatos = cwd ∪ actual |
| GAP-13 | REQUIRES IMPLEMENTATION | redactor |
| GAP-14 | REQUIRES IMPLEMENTATION | id público `scopeId:sourceId` |
| GAP-15 | OPEN | polling definido; streaming no |
| GAP-16 | REQUIRES IMPLEMENTATION | paginación de fragmentos |
| GAP-17 | RESOLVED DOCUMENTALLY | fail-closed PA4-F es el comportamiento definitivo |
| GAP-18 | **BLOCKED** | no hay primitiva de propiedad de sesión (GAP-19) |
| GAP-19 | **BLOCKED** | capacidad del host inexistente; fuera del alcance del plugin |
| GAP-20 | **OPEN / DOCUMENTED HOST LIMITATION** | limitación del host documentada; **no** aceptada |

Ningún GAP pasa a `RESOLVED` por reformulación: los `RESOLVED DOCUMENTALLY` siguen exigiendo implementación y prueba en PA-UI-1.

---

## 4.2 Ruta alternativa: aislamiento topológico (D-UI-11, `NOT DEMONSTRATED`)

El contrato §3.6 define la única mitigación de superficie distinta de la aceptación del riesgo. **No es autenticación de sesión**: no demuestra quién envía la petición; sólo reduce el conjunto de sesiones a las que se podría direccionar.

| Criterio | Qué exige | Estado en PA-UI-0.2 |
|---|---|---|
| TI-1 | proceso Harness dedicado al entorno RAG | NOT TESTED |
| TI-2 | sin otras conversaciones/sesiones no autorizadas en ese proceso | NOT TESTED |
| TI-3 | las solicitudes del plugin no pueden direccionar sesiones de otros procesos/instancias | NOT TESTED |
| TI-4 | sin mecanismos compartidos que salten la frontera (cookie/token reutilizable, puerto, proxy, bus de sesiones) | NOT TESTED |
| TI-5 | procedimiento operativo de inicio, mantenimiento, cierre y verificación | NOT DEMONSTRATED (no escrito) |
| TI-6 | prueba reproducible de que una sesión externa no es alcanzable | NOT TESTED |
| TI-7 | evidencia y responsable de la verificación | NOT DEMONSTRATED |

**Estado global de la ruta: `NOT DEMONSTRATED`.** Un perfil dedicado, un `DSH_HOME` separado o una instalación aparte **no** demuestran por sí solos los criterios. No se han ejecutado pruebas ni cambios de topología en PA-UI-0.2. Hasta que TI-1…TI-7 se demuestren con evidencia reproducible y revisión humana, G6 ruta B sigue `BLOCKED`.

**La aceptación humana del riesgo** es una decisión separada: puede registrarse, pero no convierte esta ruta en demostrada ni sustituye a la autenticación.

---

## 5. Decisiones D-UI-01…D-UI-11 (estado tras PA-UI-0.2)

| Id | Decisión | Estado PA-UI-0.2 |
|---|---|---|
| D-UI-01 | Prefijo `/lifecode-rag/ui/api` | CONFIRMADA |
| D-UI-02 | Transporte por cabecera `x-lifecode-rag-session` + `agents.get` + `requestRejection` | **BLOCKED** (no prueba propiedad de sesión; GAP-19) |
| D-UI-03 | Riesgo residual de suplantación | **BLOCKED / PENDING HUMAN DECISION — no otorgada** |
| D-UI-04 | `expectedRevision` obligatoria en `POST /selection` | RESUELTA DOCUMENTALMENTE (§6.2; REQUIRES IMPLEMENTATION) |
| D-UI-05 | Candidatos = `cwd` ∪ proyecto actual | CONFIRMADA (sin descubrimiento global) |
| D-UI-06 | Sin paginación de búsqueda | CONFIRMADA |
| D-UI-07 | Auditoría `ui.read` append-only y fail-closed | RESUELTA DOCUMENTALMENTE (§7.1 revisado; REQUIRES IMPLEMENTATION) |
| D-UI-08 | Diagnóstico con rutas redactadas | CONFIRMADA |
| D-UI-09 | Límites provisionales clasificados | CONFIRMADA (clasificación §8 del contrato) |
| D-UI-10 | `409 session-unavailable` | CONFIRMADA |
| D-UI-11 | Mitigación por aislamiento topológico | **NOT DEMONSTRATED** (contrato §3.6; §4.2) |

Resultado global de la revisión: **BLOCKED** por D-UI-02/D-UI-03 (PA01).

---

## 6. Riesgos técnicos

| Id | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | La UI se implementa pero el cliente no carga (manifiesto/slots) | Alta si no se corrige GAP-01 | Alto | Gate G3/G4 antes de PA-UI-1 |
| R-02 | El canal HTTP no puede probar identidad de sesión | Alta (confirmada) | Alto | Cabecera + `agents.get` + auditoría `ui.read`; riesgo residual **no eliminable** con el host actual (GAP-19/GAP-20) y **no aceptado**: estado `OPEN / DOCUMENTED HOST LIMITATION`; alternativas: G6 ruta A (capacidad del host) o ruta B (aislamiento demostrado, §4.2) |
| R-03 | Dos pestañas pisan la selección | Media | Medio | D-UI-04 (CAS con `expectedRevision`) |
| R-04 | Diagnóstico filtra rutas locales | Media | Medio | Redactor + revisión de seguridad |
| R-05 | Regresión de v0.1 al añadir helpers | Baja | Alto | A-01/A-05/A-06 + suite K |
| R-06 | Cambios de cliente alteran el panel de skill-center | Baja | Alto | No tocar `lifecode-skill-center/`; cambios limitados a `lifecode-rag/client.js` |
| R-07 | Pruebas tocan el perfil real (store 3,8 MB, registry 213 KB) | Baja | Crítico | `mkdtemp` obligatorio + hermético |
| R-08 | `node --test` raíz dispara `_audit/*-test.mjs` y reescribe tests ajenos | Alta si se ejecuta mal | Alto | Ejecutar sólo desde `lifecode-rag/` o `lifecode-skill-center/` |

---

## 7. Dependencias de fases posteriores

| Fase | Depende de | Qué aporta |
|---|---|---|
| PA-UI-1 (implementación backend + cliente) | G1–G8 de `PA-UI-0-ACCEPTANCE.md` §L | API, panel, identidad, pruebas |
| PA-UI-2 (endurecimiento) | PA-UI-1 + D-UI-03/04/07 | token por sesión o auditoría completa, TTL, concurrencia |
| PA-UI-3 (operaciones) | UI-1 estable | ingesta/forget/reindex desde UI con aprobación humana (fuera de PA-UI-0) |

---

## 8. Contradicciones código ↔ documentación (registradas, no corregidas)

| # | Documento dice | Código hace | Estado |
|---|---|---|---|
| X-01 | `CONTRATO-v0.1.md` «Reglas comunes» describe el almacén único `$DSH_HOME/lifecode-rag/rag.sqlite3` | el runtime Project-Aware usa `profiles/<perfil>/registry.sqlite3` + `scopes/<id>/rag.sqlite3`; el contrato de superficie no cambió | contradicción documental (el contrato de herramientas sigue válido) |
| X-02 | `WORKSPACE-API.md` presenta «Workspace API v1» como API del producto | sólo se monta si existe el almacén legado; en Project-Aware no existe | documentación histórica (v0.2) |
| X-03 | `README.md` «el panel lateral sigue sirviendo ese almacén» | cierto sólo con almacén legado; en Project-Aware el panel no tiene API | correcto pero fácil de malinterpretar |
| X-04 | `WORKSPACE-UX.md` «diseño propuesto (sin UI implementada)» | `client.js` existe pero nunca se registra (GAP-01) | coherente con el diagnóstico D-UI-RAG-01 |
| X-05 | `PROJECT-AWARE-ARCHITECTURE.md` línea 454 lista la API del Workspace | esa API es la v0.2, no una API Project-Aware | documentación de arquitectura, no de estado |

---

## 9. Qué falta, en orden, para que la UI sea usable

0. **Resolver PA01 (G6).** G6 sólo se satisface por una de las **dos rutas técnicas** siguientes, y sólo con evidencia reproducible:
   - **Ruta A — capacidad de sesión del host.** Una capacidad verificable, ligada al emisor y a la sesión, que permita comprobar que la petición está autorizada para actuar sobre esa sesión. Estado actual: **`BLOCKED`** (no disponible ni demostrada).
   - **Ruta B — aislamiento topológico demostrado.** Cumplimiento de **todos** los criterios TI-1…TI-7 (§4.2, contrato §3.6), con evidencia reproducible y revisión humana. Estado actual: **`NOT DEMONSTRATED`**. Reduce la superficie de exposición, pero **no autentica la sesión**.

   La **aceptación humana del riesgo residual (D-UI-03)** es una decisión independiente y por escrito: **no es una tercera ruta de G6**, no sustituye a A ni B, no convierte una capacidad inexistente en demostrada, no demuestra aislamiento topológico y **no permite declarar G6 `PASS`**. Mientras ninguna ruta técnica esté demostrada, PA01 y G6 siguen `BLOCKED` y el backend de PA-UI-1 queda **BLOQUEADO**.
1. **Aprobación humana** de los tres documentos y de D-UI-01…11 (G1/G2).
2. **Arreglar el manifiesto y el registro de slots del cliente** (GAP-01) y verificar que el ocupante aparece en `sidebar.panellist`/`main` del host (G3/G4).
3. **Confirmar el `sessionId` del slot de conversación** en una prueba real (G5). Esa confirmación es **necesaria pero no suficiente**: G6 sólo se cierra cuando la ruta A o la ruta B estén demostradas con evidencia reproducible (ACCEPTANCE §L). La aceptación del riesgo (D-UI-03), si se produjera, **no** sustituye esas pruebas.
4. **Implementar la API** `/lifecode-rag/ui/api` según §5–§8 del contrato, con `withAuthorizedContext`, `ui.read` append-only y fail-closed, y sin fallback (G7/G6b).
5. **Derivar/crear los helpers** GAP-04, GAP-05, GAP-06 (mínimos) y la redacción GAP-13.
6. **Panel**: proyecto activo, bibliotecas, fuentes, búsqueda, contexto, diagnóstico, estados obligatorios de `WORKSPACE-UX.md`.
7. **Pruebas** §A–§K con fixtures temporales y evidencia en `eval/pa-ui-1/evidence/`.
8. **PA-UI-2**: TTL de sesión, concurrencia optimista, endurecimiento.

---

## 10. Estado

- **Revisión PA-UI-0.1:** COMPLETA — `BLOCKED` por PA01 (identidad de sesión).
- **Revisión PA-UI-0.2:** COMPLETA — documental; `BLOCKED` se mantiene. Auditoría `ui.read` append-only, `actor` de origen, GAP-20 `OPEN / DOCUMENTED HOST LIMITATION`, ruta topológica `NOT DEMONSTRATED`.
- **Revisión PA-UI-0.3:** COMPLETA — documental; §9 armonizado con ACCEPTANCE §L: G6 sólo por ruta A o B demostradas, D-UI-03 independiente y no otorgada.
- **Contrato de API visual:** DISEÑADO (este documento + `PA-UI-0-API-CONTRACT.md` + `PA-UI-0-ACCEPTANCE.md`, revisión 3).
- **API visual:** NO IMPLEMENTADA (`GAP-02`).
- **Mitad cliente:** NO FUNCIONAL (`GAP-01`); UI Project-Aware **BLOQUEADA** hasta G3/G4.
- **Backend de herramientas v0.1:** VERIFIED HOST (las 7 herramientas registradas y visibles; D-UI-RAG-01).
- **Host identity end-to-end:** **BLOCKED** (el host autentica autoridad, no sesión; GAP-03/GAP-18/GAP-19/GAP-20); el riesgo **no** está aceptado.
- **Sin cambios en código, `package.json`, `index.js`, `client.js`, perfiles, registry, almacenes, `_audit/`, `skill-compiler/` ni `lifecode-skill-center/`.** La revisión PA-UI-0.3 sólo modificó este documento (`§9` y esta sección) y creó `PA-UI-0.3-REVIEW.md`; los demás documentos no se tocaron.
