# R17 (T35) — Verificación independiente de la capa de actividad/notificaciones

> Verificador: `verify-r16` (T5). Árbol congelado (`lib/`, `index.js`, `client.js` sin tocar).
> Fecha: 2026-11-09. Todo se midió con el código real en cajas temporales; el almacén real sólo se leyó.

## 1. Entregables

| Fichero | Contenido |
|---|---|
| `lifecode-skill-center/tests/r17-contract.test.mjs` | 7 pruebas: handler real `GET /api/activity`, 400/409/405, paginación por cursor, atribución por canal, payload saneado ≤40 KB, centro viejo |
| `lifecode-skill-center/tests/r17-events.test.mjs` | 9 pruebas: 1 operación ⇒ 1 evento, replay `operationId`, reintento sin escritura, bloqueo 409 sin `activity`, durabilidad `channel`/`operationId`, ids `kn-…`, cambio externo, orden, D1 feed==respuesta |
| `lifecode-skill-center/tests/r17-ux.test.mjs` | 7 pruebas: presupuesto de peticiones (0 arranque/inactividad, 1 al abrir, 0 cerrado), 20 ciclos sin fugas, `persisted:false`/replay sin aviso, payload inválido ≠ vacío, diálogo modal/Escape, sin polling nuevo, i18n + reduced motion |
| `lifecode-skill-center/tools/r17-perf.mjs` | Presupuesto R17-A medido con el panel real en `node:vm`; escribe `_audit/r17-perf-after.json`; exit = nº de fallos |
| `_audit/r17-perf-after.json` | Medición «después» comparable con `_audit/r17-perf-baseline.json` |

Resultado de mis ficheros: **23/23 pruebas PASS** y **11/11 comprobaciones de rendimiento PASS**.

## 2. Veredicto por punto (R17 §7 + directiva)

| # | Punto | Veredicto | Evidencia (prueba / medición) |
|---|---|---|---|
| 1 | Una operación ⇒ un evento ⇒ una entrada; replay no duplica; `activity:null` sin evento | **PASS** | `r17-events.test.mjs` «crear produce exactamente un evento y la respuesta trae su entrada», «el reintento con el mismo `operationId` no escribe ni duplica», «un reintento de create no duplica la skill…», «idempotencia …», «D1 feed==respuesta». Medido: `state.events.length===1`, `replayed:true, activity:null`, hash de `center.json` idéntico |
| 2 | Éxito sólo si el almacén cambió; bloqueo ⇒ cero escritura y sin `activity`; `persisted` coherente | **PASS** | `r17-events` «un bloqueo 409 no escribe y no publica activity» (hash igual, `blocked.activity===undefined`, `events.length` sin cambio); `r17-contract` «GET … es sólo lectura» (hash antes/después) |
| 3 | `GET /api/activity`: sólo lectura, limit 1..50, cursor base64url estable sin huecos, `category`, `nextBefore`, 400/409, knowledge parcial, POST 405, ≤40 KB sin secretos | **PASS** | `r17-contract` 4 pruebas: `?limit=0/51/x` ⇒ 400 `bad-request`; `category=otra` ⇒ 400; `before=basura` ⇒ 400 `invalid-cursor`; `center.json` roto ⇒ 409 `store-unreadable`; `knowledge.json` ilegible ⇒ 200 con `sources[1].status:'unreadable'`; POST ⇒ 405; paginación 7 entradas en páginas 3+3+1 sin repetir ni perder; `nextBefore` base64url round-trip con `encode/decodeActivityCursor`; payload de 50 eventos con nota secreta no publica `note`/`detail`/`body` ni `SECRETO-…`, ≤40 KB |
| 4 | Atribución `human`/`agent` por canal; legacy sin `channel` ⇒ evidencia `unknown`, nunca «la IA actualizó»; cambios externos «Cambio detectado» | **PASS** | `r17-contract` «la atribución sale del canal real…»: HTTP ⇒ `actor:'human'`, `actorEvidence.channel:'panel'`; evento `actor:'ai'` ⇒ `agent`/`tool`; evento sin `channel` ⇒ `actorEvidence.channel:'unknown'`, `confidence:'derived'`, `actor!=='agent'`; `project.moved` ⇒ `titleKey:'activity.title.change-detected'`. `r17-events` «un cambio externo…» + evento `external` de `knowledge.json` conserva su autoría |
| 5 | Compatibilidad: centro viejo abre sin migración, `SCHEMA_VERSION===2`, round-trip, ids `kn-…` deterministas | **PASS** | `r17-contract` «un centro viejo sin eventos abre sin migración…»: evento viejo sin `channel` se sirve con `eventId` intacto, hash de `center.json` idéntico, `loadState.integrity==='ok'`, `schemaVersion===2`, `saveState`+recarga conserva id y no añade `channel`; `r17-events` «un evento de knowledge.json recibe id determinista…» (dos eventos idénticos ⇒ ids distintos, `kn-…`) |
| 6 | Presupuesto R17-A: bytes, 0 peticiones al arranque/inactividad, 1 al abrir, 0 cerrado, 20 ciclos sin fugas, sin timers nuevos, `persisted:false` no notifica | **PASS** | `tools/r17-perf.mjs` **11/11 PASS exit 0** (ver §5): runtime `startup=0, idle=0, open=1, closed=1, cycles=1, longTimers=0`; `clientSetInterval===1` (el refresco preexistente de 20 s con skip en hidden), `clientRaf===0`, backend `setInterval===0`; `r17-ux` 20 aperturas/cierres no multiplican consultas ni dejan temporizadores; `persisted:false` y `replayed` no generan toast |
| 7 | §13 con efectos reales (creación/actualización/mejora/referencias/eventos/UX), `applyPlugin` real, centros temp, sin mocks | **PASS** | `r17-contract` monta el adaptador real (`apply` de `index.js`, ruta capturada de `webServer.register`); `r17-events` usa `runAction`/`withState`/`appendEvent` reales (crear, bloquear materialización, replay, knowledge, recarga); `r17-ux` monta el panel real en `node:vm` y mide las peticiones reales. Categorías del DTO cubiertas con el código real: `create` (skill.created), `update` (skill.version/project.moved), `improvement` (insight-*/improvement.proposed), `alert` (skill.rollback/detached) — además de los tests existentes `r17-activity`/`r17-api-activity`/`r17-ui` que cubren publicación y mejora |

Sin defectos de producto encontrados. Las tres desviaciones observadas son salvedades declaradas (§4), no fallos del contrato.

## 3. Gates (medidos en esta ronda, árbol congelado)

| Gate | Comando | Resultado | Exit |
|---|---|---|---|
| Suite completa | `node --test` | **896/896 pass, 0 fail, 0 skipped** (873 congeladas + 23 mías) | **0** |
| Checks del plugin | `node tools/check.mjs` | **411/411** comprobaciones | **0** |
| E2E | `node tools/e2e.mjs` | **19/19 PASS**, almacén real `9704ee16…` → `9704ee16…` sin cambios | **0** |
| E2E autónomo | `node tools/e2e-autonomous.mjs` | **26/26 PASS**, «almacén real intacto» | **0** |
| Mutación | `node tools/mutation.mjs` | **16/16** (críticos **13/13**, 100 %) | **0** |
| Cobertura | `node tools/coverage.mjs` | «Suite en verde», línea **96.54 %**, rama **76.77 %**, funciones **83.37 %** (31 ficheros) | **0** |
| Hermético | `node tests/check-hermetic.mjs` | centro **16 ficheros** + biblioteca **173 skills** intactos | **0** |
| Matriz colisiones | `node tools/r16-collision-matrix.mjs` | **6/6** | **0** |
| E2E R16 | `node tools/r16-e2e.mjs` | **9/9 PASS**, 0 SKIP, 0 FAIL | **0** |
| Routing R16.2 | `node tools/r16-routing.mjs` | **18/18 PASS** | **0** |
| Presupuesto R17-A | `node tools/r17-perf.mjs` | **11/11 PASS** | **0** |
| Calidad de tests | `node tools/testquality.mjs` | **1 alta / 30 media / 13 baja** — alta preexistente `tests/state.test.mjs:144` | **1** (preexistente, no R17) |

Nota de conteo: `check` pasó de 407 a 411 (+1 por cada fichero de prueba nuevo: 3 ficheros + 1 por el tool) y la suite de 873 a 896 (+23). El baseline declarado por el Lead se cumple; el delta es exactamente mi aportación.

## 4. Defectos y salvedades

**Defectos de producto: NINGUNO.**

Salvedades declaradas (comportamiento observado y documentado, no incumplimiento):

1. **`external` en el centro se colapsa a `human` al persistir.** `appendEvent` (`lib/state.mjs:1687`) y `normalizeState` (`lib/state.mjs:323`) sólo conservan `ai`/`system`; cualquier otro actor guardado queda `human`. El DTO sí distingue `external` cuando el evento llega de `knowledge.json` (verificado). No hay ningún emisor de eventos `external` en el centro y la directiva exige «nunca atribuirlo a la IA», que se cumple; se documenta para que nadie asuma autoría externa durable en `center.json`.
2. **Reabrir el drawer reutiliza el feed vigente** (no vuelve a consultar); con el drawer abierto hay botón «Actualizar» explícito. El presupuesto medido se mantiene en **1 consulta por apertura inicial**, 0 en inactividad y 0 al cerrar; 20 aperturas/cierres consecutivas no multiplican peticiones.
3. **Arnés de UI:** `createPanelHarness().unmount()` falla con `style.remove is not a function` (`client.js:8525` espera un `style` de DOM real que el sandbox no modela). Es una limitación del arnés de pruebas, no del producto: no se usa `unmount` en las pruebas y el panel real no se ve afectado. No se tocó el arnés (no es mío).
4. **`testquality` sigue rojo preexistente** (1 alta en `tests/state.test.mjs:144`, ajena a R17; 30 media / 13 baja). No aparece ninguna alta nueva en mis ficheros.

## 5. Presupuesto R17-A — comparación baseline/después

`_audit/r17-perf-after.json` (medido 2026-11-10T01:42:15.692Z) frente a `_audit/r17-perf-baseline.json`:

| Métrica | Baseline | Después | Δ |
|---|---|---|---|
| `client.js` | 454 594 B | **512 924 B** | +58 330 B (+12.8 %) |
| `lib/api.mjs` | 189 722 B | 196 852 B | +7 130 B |
| `index.js` | 31 694 B | 31 694 B | 0 |
| `lib` | 28 ficheros / 671 740 B | 29 / 699 006 B | +1 fichero (`activity.mjs`) |
| `clientFetch` | 12 | 13 | +1 (lectura del feed) |
| `clientSetInterval` | 1 | **1** | 0 (refresco preexistente `client.js:6887`) |
| `clientSetTimeout` | 2 | 2 | 0 |
| `clientRaf` | 0 | 0 | 0 |
| `setInterval` en `index.js`/`lib/api.mjs` | 0/0 | 0/0 | 0 |
| `notify` callers | 39 | 39 | 0 |
| Peticiones al arrancar / inactividad | — | **0 / 0** | — |
| Peticiones al abrir / cerrado | — | **1 / 1** | — |
| 20 aperturas/cierres | — | **1 consulta total**, 0 timers ≥20 s | — |
| Almacén real | 29 eventos / 8 skills / 3 proyectos | igual (sólo lectura) | 0 |

Checks: `arranque`, `inactividad`, `abrir=1`, `cerrado`, `ciclos`, `longTimers`, `setInterval`, `raf`, `backend intervals`, `crecimiento <60 KB`, `crecimiento <20 %` ⇒ **11/11 PASS**.

## 6. Verificación de los arreglos de calidad de tests del Lead

Los cuatro tests corregidos **pueden fallar** si la conducta se rompe (mutación en memoria, sin editar producto):

- `tests/client.test.mjs:279` asevera `const currentVersion = String(findSkill(snapshot, skillId)`. Partiendo de `client.js` real contiene la invariante; sustituyéndola en memoria por `String(otraCosa(skillId)` la comprobación **deja de encontrarla**. Igual con la dependencia `[skillId, snapshot]` (`client.js:6079`): presente en el árbol, ausente al mutarla a `[skillId]`. Los dos tests homónimos ya no colisionan (nombres distintos, uno por hook y otro por manejador).
- `tests/render.test.mjs:385`: `renderText(tree)` devuelve `true` con la hoja real `analytics.applications.withoutDeclaration{"n":"3"}` y **`false`** si el árbol mutado trae `n:'2'`; ya no es una búsqueda sobre `JSON.stringify` (que nunca contenía el texto).
- `tests/render.test.mjs:387`: `handlerSource(tree)` devuelve `false` en un árbol de datos y **`true`** si un manejador llama a `act('/api/x')`; la comprobación «no habla con la API» ya no es tautológica.

Resultado: los arreglos conservan la fuerza de la aserción y son sensibles a la conducta.

## 7. Reproducción

```sh
cd lifecode-skill-center
node --test tests/r17-contract.test.mjs tests/r17-events.test.mjs tests/r17-ux.test.mjs   # 23/23
node tools/r17-perf.mjs                                                                      # 11/11, escribe _audit/r17-perf-after.json
node --test                                                                                  # 896/896
node tools/check.mjs                                                                        # 411/411
node tools/e2e.mjs && node tools/e2e-autonomous.mjs                                         # 19/19 · 26/26
node tools/mutation.mjs && node tools/coverage.mjs                                          # 16/16 · 96.54/76.77/83.37
node tests/check-hermetic.mjs                                                               # 16 + 173 intactos
node tools/r16-collision-matrix.mjs && node tools/r16-e2e.mjs && node tools/r16-routing.mjs # 6/6 · 9/9 · 18/18
```

## 8. Qué NO prueba esta ronda

- No se abrió el panel en un navegador real: el runtime del panel se ejecuta en `node:vm` sobre `client.js` real, con peticiones contadas y DOM simulado. La coherencia visual (CSS/animaciones) se apoya en `tests/styles.test.mjs` y `tests/r17-ui.test.mjs`.
- El entorno del Host se simula con el mismo contrato de servicios que `tests/index.test.mjs` (webServer, skills, workspaceRegistry, workingDirectory, agents, connection); no se arrancó un DSH real.
- El almacén real sólo se leyó (29 eventos) para el tamaño del payload; `check-hermetic` confirma que la suite entera corrió sin tocarlo.
