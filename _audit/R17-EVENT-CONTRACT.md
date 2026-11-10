# R17 — Contrato de eventos y actividad

> Contrato vinculante para task-36 (núcleo + ruta), task-37 (UI) y task-38 (verificación). Es **aditivo**: no
> cambia `SCHEMA_VERSION` (sigue en 2, `lib/state.mjs:28`), no crea almacén, no añade dependencias y no introduce
> temporizadores. Cada regla lleva su fuente; lo que no está medido va marcado **[PROPUESTA]**.

## 0. Principios

1. **Una fuente de derivación**: `lib/activity.mjs` (nuevo, puro: recibe `state`, `knowledge`, `now`) decide
   categoría, severidad, título, actor normalizado y cursor. Ni la ruta ni la UI re-derivan.
2. **Se guarda poco, se deriva mucho**: 2 campos durables nuevos (`channel`, `operationId`); los demás se
   calculan al leer. Menos peso y sin migración.
3. **Sin afirmaciones no demostradas**: la autoría se declara con evidencia de canal; lo observado no se
   presenta como provocado (§9 de la directiva).
4. **Lectura pura**: `GET /api/activity` no escribe ni invalida el catálogo; un fallo de la fuente secundaria no
   borra la principal.

## 1. DTO `ActivityEvent`

Núcleo (19 campos exigidos por la directiva):

| Campo | Tipo | Nulable | Origen | Default en evento legacy |
|---|---|---|---|---|
| `eventId` | string | no | `event.id`; si falta, `ev-<12hex>` (`state.mjs:1625`) | se genera al leer |
| `type` | string | no | `event.type` (el diario no valida vocabulario, `state.mjs:1621`) | — |
| `at` | string ISO-8601 UTC | no | `event.at` (`:1620`) | — |
| `actor` | `'human'\|'agent'\|'system'\|'external'\|'unknown'` | no | traducción de `event.actor` | `unknown` si el campo falta |
| `actorEvidence` | `{channel, stored}` | no | derivado del tipo y del canal (§3) | `{channel:'unknown', stored:actor}` |
| `origin` | `'panel'\|'tool'\|'catalog'\|'import'\|'reconcile'\|'maintenance'\|'unknown'` | no | derivado de `type`+`actor` | `unknown` |
| `source` | `'center.json'\|'knowledge.json'` | no | documento del que se leyó | — |
| `projectId` | string | sí (`null`) | `event.projectId` (almacén usa `''`) | `null` |
| `skillId` | string | sí | `event.skillId` | `null` |
| `skillTitle` | string | sí | `state.skills[skillId].title` en el momento de leer | `null` si la skill ya no existe |
| `versionBefore` | string | sí | versión previa derivada (§2.3) | `null` |
| `versionAfter` | string | sí | `event.version` cuando es versión publicada | `null` |
| `referencesAdded` | string[] | sí | `compareReferences` (`insights.mjs:189-196`) | `null` (≠ `[]`) |
| `referencesUpdated` | string[] | sí | idem | `null` |
| `referencesRemoved` | string[] | sí | idem | `null` |
| `correlationId` | string | sí | `state.operations` si existe; si no, derivado (§4) | `null` |
| `requestId` | string | sí | sólo si el adaptador lo midió al escribir | `null` |
| `outcome` | `'ok'\|'failed'\|'info'` | no | `eventResult(event)` (`insights.mjs:127-132`) | el derivado |
| `persisted` | boolean | no | `true` en el feed (lo leído está en disco); en respuesta de mutación, `saved` | `true` |
| `humanApprovalRequired` | boolean | no | `true` sólo para `improvement.proposed` y para errores `approval-required` | `false` |
| `confidence` | `'verified'\|'derived'\|'unknown'` | no | por campo (§2.2): el mínimo del evento | `derived` |

Proyección de notificación (4 campos, también derivados, no se guardan):

| Campo | Tipo | Regla |
|---|---|---|
| `category` | `'create'\|'update'\|'improvement'\|'references'\|'alert'` | tabla §5 |
| `severity` | `'success'\|'info'\|'warning'\|'error'` | tabla §5 |
| `titleKey` | string | clave i18n estable, p. ej. `activity.title.skill-created` |
| `titleVars` | objeto plano | sólo nombres, contadores, versiones y `project`; nunca cuerpos ni rutas absolutas |

**Contrato de tipos**: ids ausentes se exponen `null` (el almacén guarda `''` por compatibilidad); arrays ausentes `null`; `titleVars` nunca contiene texto libre.

## 2. Derivación

**2.1 `actor`.** `'ai' → 'agent'`; `'system' → 'system'`; `'human' → 'human'`; ausente o desconocido `→ 'unknown'`.
**No se reescribe el almacén** (el `ai` histórico sigue en `center.json`, `state.mjs:323`); `actorEvidence.stored`
conserva el token original para auditoría.

**2.2 `confidence` por campo.** `verified`: valor presente en el evento (`eventId`, `type`, `at`, `actor`,
`projectId`, `skillId`, `versionAfter`). `derived`: calculado del estado (`skillTitle`, `versionBefore`, referencias,
`outcome`, `origin`, categoría, severidad). `unknown`: no hay base. El evento publica el **mínimo**.

**2.3 Versiones y referencias.** `versionBefore` se toma de la versión inmediatamente anterior de
`state.skills[skillId].versions` a la de `versionAfter`; si no hay historial, `null` (nunca se inventa
`1.0.0`). Referencias: `compareReferences(antes, después)` devuelve `{added, modified, removed}`
(`insights.mjs:189-196`); `modified` se publica como `referencesUpdated`. Para `skill.created`/`skill-imported`
todas las referencias de la versión son `referencesAdded`, y `Removed/Updated` son `[]`.

**2.4 `humanApprovalRequired`.** `true` sólo si `type === 'improvement.proposed'` o si la respuesta HTTP trae `code:'approval-required'`. Ningún otro caso.

**2.5 `persisted`.** En el feed, `true` siempre (se lee de disco). En la respuesta de una mutación: `true` sólo
si la operación devolvió `saved:true`; si se sirvió un resultado en memoria, `false` y la UI no anuncia éxito.

## 3. Almacenamiento aditivo (el P0)

`normalizeState` reconstruye cada evento con 9 campos (`lib/state.mjs:310-346`); lo que no esté ahí **se pierde
al recargar**. Ya existe el precedente de una excepción ad hoc para `skill-imported` (`:328-343`), que demuestra
el mecanismo y su deuda.

**R1.** Añadir a esa lista blanca, sólo si existen, `channel` (string de `actorEvidence.channel`) y
`operationId` (string no vacío). No se añaden más campos durables en R17.

**R2.** Sin cambio de esquema: `SCHEMA_VERSION` se queda en 2 y `MAX_SCHEMA_VERSION` en 3
(`state.mjs:28, :43`). Un `center.json` antiguo se lee igual: los campos faltantes son `null`/`unknown`.

**R3.** Prueba obligatoria de round-trip: `loadState → saveState → loadState` debe producir **bytes idénticos**
para un `center.json` con eventos enriquecidos y para uno sin ellos (compatibilidad en los dos sentidos).

**R4.** `knowledge.json` no se toca: sus eventos se leen y se les asigna un id sintético estable
`kn-<12hex>` = `shortHash(at|type|detail|skillId|projectId)`; si dos colisionan, sufijo `-2`, `-3` por orden de
aparición (determinista). No se le añade `id` al fichero.

**R5.** `operationId`: los llamadores pueden enviarlo en el cuerpo de una acción; el núcleo lo guarda con
`recordOperation` (`state.mjs:1682`) y lo copia al evento como `correlationId`. Si no llega, `correlationId` se
deriva de `shortHash(type|skillId|projectId|at)` y se publica; no se inventa un `operationId`.

## 4. Idempotencia

`appendEvent` **no deduplica** (`state.mjs:1616-1638`). La regla es de operación, no de evento:

**R6.** Al entrar en una acción mutable: si `operationId` no vacío y `operationOf(state, operationId)` existe
(`state.mjs:1699-1703`), se devuelve `{ok:true, replayed:true, activity:<la de la operación original si consta>}`
y **no se escribe**. Sin `operationId`, no hay replay.

**R7.** éxito ⇒ una sola entrada nueva en el diario por operación. `replayed:false` en la respuesta normal.

**R8.** Nada se anuncia antes de persistir: `activity` viaja en la misma respuesta que `saved:true`; si
`withState` devolvió `saved:false` (sin cambios) o lanzó, `activity:null` y no se marca nada como hecho.

## 5. Taxonomía (textos literales de la directiva)

**Lectura vinculante**: `A` = creación, `B` = actualización, `C` = self-improvement (dos estados), `D` =
referencias y conocimiento. Los textos siguientes son **literales** de m03632. La traducción EN es propia y se
declara así (`[PROPUESTA i18n]`), no como texto de la directiva.

| Categoría de la directiva | Texto literal (ES) | Cuándo se muestra | Severidad |
|---|---|---|---|
| A · Creación | «Nueva Skill creada» | `skill.created`, `skill-imported` | `success` |
| B · Actualización | «Skill actualizada» | `skill.version` con versión previa | `success` |
| B · Actualización (variante §5.2) | «Nueva versión guardada» | `skill.version` (toast corto) | `success` |
| C · Propuesta | «Mejora preparada · Pendiente de aprobación» | `improvement.proposed` (la Skill **no** cambió) | `warning` |
| C · Completado | «Self-improvement completado» | `improvement.approved`, `skill.applied` | `success` |
| C · Rechazo | «Mejora rechazada» **[PROPUESTA: texto propio, no literal]** | `improvement.rejected` | `warning` |
| C · Reversión | «Cambio revertido» **[PROPUESTA]** | `skill.rollback` | `warning` |
| D · Conocimiento | «Conocimiento incorporado» | referencias persistidas en una versión nueva | `success` |
| D · Detectado | «Conocimiento detectado» (§5.2, info) | referencias sólo detectadas, sin publicar | `info` |
| — · Externo (§9) | «Cambio detectado en una Skill» | reconciliación/observación externa; **nunca** «La IA actualizó la Skill» | `info` |
| — · Variantes §5.2 | «Propuesta de mejora», «Inspección finalizada» | `skill.requested`, `store.backup/restored/migrated` | `info` |
| — · Variantes §5.2 | «Aprobación humana pendiente», «Conflicto de identidad», «Referencias pendientes de verificación», «Fuente no disponible» | gates, conflictos, referencias sin validar, fuente caída | `warning` |
| — · Variantes §5.2 | «Escritura rechazada», «Evaluación bloqueante», «Conflicto que impide la operación», «Fallo de persistencia» | códigos de error de la respuesta (no del diario) | `error` |

Mapeo vinculante `type → category/severity/titleKey`:

| `type` | `category` | `severity` | `titleKey` |
|---|---|---|---|
| `skill.created` | `create` | `success` | `activity.title.skill-created` (A) |
| `skill-imported` | `create` | `success` | `activity.title.skill-imported` («Skill importada»; `titleVars.origin='import'`) |
| `skill.version` | `update` | `success` | `activity.title.skill-updated` (B; «Nueva versión guardada» si `versionBefore===null`) |
| `skill.assigned` / `skill.unassigned` / `skill.advanced` | `update` | `info` | `activity.title.skill-assigned` / `.skill-unassigned` / `.skill-advanced` |
| `improvement.proposed` | `improvement` | `warning` | `activity.title.improvement-prepared` (C, `humanApprovalRequired:true`) |
| `improvement.approved` | `improvement` | `success` | `activity.title.self-improvement-completed` (C) |
| `skill.applied` | `improvement` | `success` | `activity.title.self-improvement-completed` (C; es declaración, no verificación) |
| `improvement.rejected` | `alert` | `warning` | `activity.title.improvement-rejected` |
| `skill.rollback` | `alert` | `warning` | `activity.title.change-reverted` |
| `skill.requested` / `skill.request-fulfilled` / `skill.request-dismissed` | `improvement` | `info` | `activity.title.skill-requested` / `.skill-request-fulfilled` / `.skill-request-dismissed` |
| `project.registered` / `linked` / `adopted` / `forked` | `create` | `success` | `activity.title.project-linked` |
| `project.moved` / `reconciled` / `relinked` | `update` | `info` | `activity.title.change-detected` (§9; autoría `external`/`unknown`) |
| `project.detached` | `alert` | `warning` | `activity.title.project-detached` |
| `store.backup` / `restored` / `migrated` | `update` | `info` | `activity.title.inspection-finished` (§5.2) |
| `insight-received` / `insight-origin-verified` / `decision-recorded` / `policy-changed` | `improvement` | `info` | `activity.title.insight-received` / `.insight-origin-verified` / `.decision-recorded` / `.policy-changed` |
| `skill.loaded` | — | — | **excluido del feed** (telemetría diaria; vive en Analítica) |

Regla de precedencia: si un mismo evento cae en dos filas, gana la más específica (la de `type` exacto).
El mapa vigente es `lib/activity.mjs:37-69`: manda el `type` del evento, no el `titleKey` guardado; por
eso un histórico con clave incorrecta se pinta bien sin reescribir el almacén. `improvement.proposed`
se rotula «Mejora preparada» (`activity.title.improvement-prepared`), no «Mejora propuesta». El
«conocimiento incorporado» es una **vista** del `skill.version` que además trae `referencesAdded.length > 0`;
no es un tipo nuevo.

## 6. `GET /api/activity`

**Ruta**: `GET` (y `HEAD`) `GET /lifecode-skill-center/api/activity`; se añade al despacho GET de
`handleApiRequest` (`lib/api.mjs:602`) antes del `notFound()` de `:735`. Sólo lectura: no `withState`, no
`acquireLock`, no `invalidate`.

| Parámetro | Tipo | Regla |
|---|---|---|
| `limit` | entero 1..50 | defecto 20; fuera de rango ⇒ 400 `bad-request` |
| `before` | cursor opaco | base64url de `${at}|${eventId}`; inválido ⇒ 400 `bad-request` (`reason:'invalid-cursor'`) |
| `category` | `all\|create\|update\|improvement\|references\|alert` | defecto `all`; otro valor ⇒ 400 |

**Orden**: `(at DESC, eventId DESC)`, total y estable. `nextBefore` es el cursor del último evento devuelto si
quedan más; `null` si no.

```json
{
  "ok": true, "apiVersion": 1, "generatedAt": "2026-11-09T19:10:00.000Z",
  "sources": [ { "id": "center", "status": "ok", "reason": null },
               { "id": "knowledge", "status": "unreadable", "reason": "integrity:invalid-shape" } ],
  "events": [ {
    "eventId": "ev-1a2b3c4d5e6f", "type": "improvement.proposed", "at": "2026-11-09T18:44:12.031Z",
    "actor": "agent", "actorEvidence": { "channel": "tool", "stored": "ai" }, "origin": "tool", "source": "center.json",
    "projectId": "plugins-dhs-0f3a1c2b", "skillId": "r17-activity", "skillTitle": "R17 Activity",
    "versionBefore": "1.0.0", "versionAfter": null,
    "referencesAdded": null, "referencesUpdated": null, "referencesRemoved": null,
    "correlationId": "op-7d1e", "requestId": null, "outcome": "ok", "persisted": true,
    "humanApprovalRequired": true, "confidence": "derived", "category": "improvement", "severity": "warning",
    "titleKey": "activity.title.improvement-prepared", "titleVars": { "skill": "R17 Activity", "version": "1.0.0" } } ],
  "nextBefore": "MjAyNi0xMS0wOVQxODo0NDoxMi4wMzFafGV2LTFhMmIzYzRkNWU2Zg", "total": 1732, "truncated": true
}
```

| Situación | HTTP | Cuerpo |
|---|---|---|
| OK (aunque `knowledge` falle) | 200 | el de arriba, con `sources[1].status:'unreadable'` |
| `center.json` ilegible | **409** | `{ok:false, code:'store-unreadable', message:'el almacén del centro no se puede leer: no se publica actividad sobre datos dudosos', integrity:{…}}` (mismo criterio que `api.mjs:690-694`) |
| Parámetro inválido | 400 | `{ok:false, code:'bad-request', message, reason}` |
| Otro verbo | 405 | `{ok:false, code:'method', message:'usa GET para la actividad'}` |
| Adapter sin admisión | 401/403/503 | los del handler actual (`index.js`), sin cambios |

**R9.** `total` cuenta el total filtrado por categoría (una pasada sobre ≤4000+4000 eventos); no se pagina el
recuento ni se guarda índice.

**R10.** El payload no incluye `note` crudo de eventos de conocimiento (puede traer texto libre de una persona);
sí `titleVars` acotado. Ninguna respuesta supera 50 filas ni ~40 KB.

## 7. `activity` en respuestas mutantes

Toda acción mutable exitosa devuelve, junto al resultado actual:

```json
"activity": { "eventId": "ev-…", "type": "skill.created", "category": "create", "severity": "success",
              "titleKey": "activity.title.skill-created",
              "titleVars": { "skill": "…", "project": "…", "version": "1.0.0" },
              "actor": "agent", "at": "2026-…", "persisted": true },
"replayed": false
```

Reglas: `activity:null` si no se escribió evento (p. ej. `toggle` sin cambio, `:405-407`); `persisted:false` si
`withState` no guardó; nunca se devuelve `activity` de una operación bloqueada (para eso está `findings`); con
`replayed:true` no se crea evento nuevo.

## 8. No-leídas (cliente)

**R11.** Sólo `localStorage`, nunca `center.json`: clave `lifecode-skill-center/activity-seen`, valor
`{ "v": 1, "lastSeenAt": "<ISO>", "ids": ["ev-…", …] }`, máximo 200 ids (se recortan los más antiguos). Se
marca visto al abrir el Activity Center y al mostrar un toast; **nunca** al pedir datos. JSON corrupto ⇒ se
ignora y se reescribe; jamás rompe el panel. Ámbito declarado en la UI: «este navegador», sin sincronización
entre equipos ni entre perfiles.

## 9. Redacción y seguridad

**R12.** `titleVars` sólo lleva: nombre de skill, nombre de proyecto, versiones, contadores y banderas
(`origin`, `change`, `renamed`). Prohibido: cuerpos, contenido de referencias, rutas absolutas, rutas del
usuario, notas libres, secretos (los patrones de `lib/evaluate.mjs:26-30` se aplican también aquí). Un evento de
conocimiento publica su `detail` sólo si pasa esos patrones; si no, se degrada a `titleVars` vacío.

## 10. Checklist de aceptación (task-38)

1. `GET /api/activity` no cambia el `sha256` ni el `mtime` de `center.json` ni de `knowledge.json`.
2. `limit` 0/51/`abc` ⇒ 400; `before` corrupto ⇒ 400; `category` desconocida ⇒ 400; `POST` ⇒ 405.
3. 4000 eventos: respuesta ≤50 filas, ≤40 KB, orden estable, `nextBefore` recorre el feed sin huecos ni repetidos.
4. Round-trip byte a byte con y sin `channel`/`operationId` (R3).
5. Replay con el mismo `operationId` ⇒ una sola entrada en el diario y `replayed:true`.
6. `skill.loaded` no aparece en el feed; sí en Analítica.
7. `knowledge.json` ilegible ⇒ 200 con `sources[1].status:'unreadable'`; `center.json` ilegible ⇒ 409.
8. Ningún `titleVars` contiene cuerpos ni rutas absolutas; regresión de secretos en rojo.
9. Sin `setInterval` nuevo en `client.js`; el drawer lee una vez al abrir y tras cada mutación.
10. ES/EN con paridad de claves; EN declarada `[PROPUESTA i18n]`.
