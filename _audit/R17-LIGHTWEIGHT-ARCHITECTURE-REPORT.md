# R17 — Arquitectura ligera de actividad y notificaciones

**Ronda:** R17 · **Tarea:** T36 · **Fecha:** 2026-11-09
**Pregunta:** ¿qué coste real añade el centro de actividad al panel, y qué reutiliza en vez de inventar?
**Código medido:** `client.js` 512 924 B / 8 555 líneas; `lib/activity.mjs` 16 899 B / 363 líneas;
`lib/api.mjs` 196 852 B / 4 211 líneas; `index.js` 31 694 B / 741 líneas.

---

## 1. Resultado en una frase

R17 añade un módulo puro (`lib/activity.mjs`), una ruta de lectura y una UI de notificaciones sin
dependencias nuevas, sin timers nuevos, sin escrituras por lectura y con sólo dos campos durables por
evento; el arnés de rendimiento confirma 0 peticiones en arranque/inactividad y 1 al abrir el cajón.

## 2. Presupuesto de diseño (R17-A)

| Regla | Cómo se cumple | Evidencia |
|---|---|---|
| 0 dependencias nuevas | `activity.mjs` sólo importa módulos internos | `lib/activity.mjs:19-20` (`format.mjs`, `insights.mjs`); `package.json` sigue con una sola dependencia |
| 0 timers nuevos | Sólo el refresco de 20 s preexistente | `client.js:7882`; prueba `tests/r17-ui.test.mjs:219-223` |
| 0 escrituras por lectura | GET de actividad es puro | `lib/api.mjs:653-655`, `:937-976`; pruebas `tests/r17-api-activity.test.mjs:38-71` |
| 2 campos durables | `channel` y `operationId` | `lib/state.mjs:1658-1663`; `appendEvent` `:1666+` |
| Sin caché ni índice | Derivación en memoria por consulta | `lib/activity.mjs:303-341` |

## 3. Qué se reutiliza

| Activo | Uso en R17 | Límite |
|---|---|---|
| `center.json.events` | Fuente principal del feed | 4 000 eventos (`lib/state.mjs:53`) |
| `knowledge.json.events` | Segunda fuente, `source:'knowledge.json'` | 4 000 eventos (`lib/knowledge.mjs:283`) |
| `snapshot.events` del `/state` | Últimos 80 para el resumen existente | `lib/api.mjs:2089` |
| `notify` existente | Se conserva la firma; se sustituye el render por la pila | `client.js:7301-7314`; 39 llamadas siguen funcionando |
| Handshake `capabilities` | El cajón sólo se activa con contrato 2 | `client.js:2127-2149`; `lib/api.mjs:560-587` |
| Rutas del mismo prefijo | `/api/activity` entra por el registro único | `lib/api.mjs:653`, `index.js:722` |
| localStorage | Nueva clave de vistos, mismo patrón defensivo | `client.js:6547-6582` |

No se reutiliza el evento `skill.loaded` para actividad: está excluido (`lib/activity.mjs:21-32`),
porque una carga no es un cambio de conocimiento.

## 4. Ficheros nuevos y modificados

| Fichero | Tamaño | Papel |
|---|---|---|
| `lib/activity.mjs` | 363 líneas / 16 899 B | Derivación pura DTO + feed + cursor |
| `lib/api.mjs` | 4 211 líneas / 196 852 B | `activityPayload`, ruta GET, `activity` en mutaciones, whitelist |
| `lib/state.mjs` | 1 757 líneas / 78 249 B | `preserveActivityFields`, round-trip del diario |
| `index.js` | 741 líneas / 31 694 B | Paso de `hostCwd` y contexto a la ruta |
| `client.js` | 8 555 líneas / 512 924 B | Pila, indicador, cajón, integración `act`, i18n |
| `tests/r17-*.test.mjs` | 6 ficheros + arnés | Contrato, eventos, actividad, API, UI, UX |
| `tools/r17-perf.mjs` | 6 548 B | Medición de peticiones/timers |

## 5. Una sola derivación

`normalizeEvent` (`lib/activity.mjs:283-288`) → `dtoOf` (`:233-277`) → `buildActivityFeed`
(`:303-341`). El módulo **no lee ni escribe ficheros** (cabecera `:1-18`). La ruta carga estado y
conocimiento, llama al feed y devuelve:

```
{ok, apiVersion, generatedAt, sources[{id,status}], events[], nextBefore, total, truncated}
```

(`lib/api.mjs:966-975`). `sources` distingue `center` siempre legible de `knowledge` (si falla, queda
`unreadable` y no se convierte en lista vacía, `:955-960`). Si el centro no es legible, **409** en vez de
actividad sobre datos dudosos (`:946-952`).

## 6. Persistencia mínima y round-trip

- Sólo sobreviven `channel` y `operationId` (`lib/state.mjs:1658-1663`); el resto del DTO se recalcula
  al leer y no se guarda. Un evento viejo se relee byte a byte igual (prueba
  `tests/r17-activity.test.mjs:290-297`).
- El evento se construye con `channel` del canal de admisión y `operationId` sólo si no está vacío
  (`lib/api.mjs:2612-2626`).
- Los eventos de `knowledge.json` no tienen id: se les asigna uno sintético determinista
  `kn-<12hex>` con sufijo ante colisión (`lib/activity.mjs:291-293`, `:319-331`).
- `activityForResult` devuelve la proyección de la operación recién persistida
  (`lib/activity.mjs:344-363`) y se usa en mutaciones genéricas (`lib/api.mjs:4083`) y en
  `import-bundle` (`:3082`).

## 7. Eventos y disponibilidad real del Host

`_audit/r17-notifier.txt` documenta el `Notifier` que usa `dsh-api-session-controller` (3 078 B): es un
**batch interno** de microtasks/frames de `dsh-client-store` para sus propios listeners. No hay API
pública Host→plugin, no hay suscripción para plugins y no hay push cuando el panel está cerrado.

Consecuencias de diseño:

1. El aviso nace de la **respuesta real** de la operación (`POST /state`), no de un bus de eventos
   (`client.js:7943-7946`). Si el panel no hizo la operación, no hay toast.
2. El cajón **consulta al abrirse** (`GET /activity`), no escucha.
3. No se añadió una capacidad `activity` al handshake (contrato 2 sigue igual,
   `lib/api.mjs:94-104`): la ruta es aditiva y un cliente R17 contra backend R16.2 recibe 404 hasta el
   reinicio. El discriminador está en la aceptación.
4. Un panel cerrado no recibe nada; al abrirlo ve el diario persistido. Es un límite del Host, no una
   regresión.

## 8. Consultas adicionales y cuándo

| Momento | Peticiones nuevas |
|---|---|
| Arranque del panel | **0** (`expectedStartupRequests:0` en baseline) |
| Inactividad con cajón cerrado | **0**; el cajón ni se monta (`client.js:8488-8496`) |
| Abrir cajón | **1** `GET /activity?limit=20` (`:7011-7015`) |
| «Actualizar» | **1** con `before=''` (`:6986`) |
| «Cargar más» | **1** con `before=<nextBefore>` (`:7054-7062`) |
| Operación con aviso | **0** de actividad: usa la respuesta del `POST /state` (`:7341-7361`) |
| Indicador de cabecera | **0**: se deriva de estado en memoria/compat |

## 9. Ausencia de sondeo, timers y workers (evidencia)

| Patrón | `client.js` | Nota |
|---|---|---|
| `setInterval(` | **1** | Sólo el refresco de 20 s preexistente, `:7882`; baseline = 1 |
| `setTimeout` | 2 reales | Caducidad de toast `:7290` y abort de petición `:7544` |
| `requestAnimationFrame` | 0 | — |
| `Worker` | 0 | — |
| `serviceWorker` | 0 | — |
| `EventSource` | 0 | — |
| `WebSocket` | 0 | — |

Prueba que fija el baseline: `tests/r17-ui.test.mjs:219-223` (exactamente un `setInterval(`).

## 10. Carga perezosa y limpieza

- El cajón se monta condicionalmente (`client.js:8488-8496`); cerrado no existe ni consulta.
- Una consulta al montar; `requestRef` descarta respuestas viejas (`:6972-6998`).
- El listener de teclado del cajón se retira en el cleanup y devuelve el foco (`:6997-7009`).
- Cada toast cancela su temporizador al desmontar o cerrar (`:7280-7299`); no hay temporizador global.
- La marca de visto se escribe una vez por apertura/aviso (`:7316-7329`), no en cada render.

## 11. Rendimiento antes/después

Baseline medido antes de R17 (`_audit/r17-perf-baseline.json`) y medición posterior de task-38
(`_audit/r17-perf-after.json`, `measuredAt 2026-11-10T01:38:21Z`, `stage:"after-r17"`):

| Métrica | Baseline | Después | Δ |
|---|---|---|---|
| `clientBytes` | 454 594 | 512 924 | +58 330 (+12,8 %) |
| `indexBytes` | 31 694 | 31 694 | 0 |
| `apiBytes` | 189 722 | 196 852 | +7 130 (+3,8 %) |
| `libFiles` / `libBytes` | 28 / 671 740 | 29 / 699 006 | +1 fichero, +27 266 |
| `clientFetch` | 12 | 13 | +1 (la consulta del cajón) |
| `clientSetInterval` | 1 | 1 | 0 |
| `clientSetTimeout` | 2 | 2 | 0 |
| `notifyCallers` | 39 | 39 | 0 |

**Runtime medido por el arnés (no por el GUI):** `startupRequests 0`, `idleRequests 0`,
`openRequests 1`, `closedRequests 1` acumulada, `longTimers 0`. Los once checks de
`r17-perf-after.json` pasan: arranque/inactividad 0, abrir ⇒ 1, cerrado no consulta, 20
aperturas/cierres no multiplican, sin temporizadores de 20 s nuevos, un solo `setInterval`, sin
`requestAnimationFrame`, sin `setInterval` en backend, y crecimiento del cliente < 60 KB y < 20 %.

**Pendiente declarado:** `_audit/r17-verify-r17.md` (task-38) aún no existe; las cifras de suite
citadas son las canónicas del Lead, no una re-medición propia.

## 12. Funciones simplificadas y fuera de alcance

| Decisión | Implementación real | Motivo |
|---|---|---|
| Contador de no leídas | Punto, no número (`unreadCount:0`) | No calcular una cifra que no se usa |
| «Última actividad» | Sólo sesión (`lastActivity` vacío al cargar) | Evitar afirmar una fecha que el snapshot no dice |
| Ids vistos | Se guardan ≤200, no se cuentan | Marca de lectura, no bandeja |
| Filtros | Por categoría, en cliente | Evitar consultas por filtro |
| «Ver diferencias» | Abre la ficha de la Skill | No hay vista de diff propia |
| Confianza | `derived`/`unknown` (`lib/activity.mjs:160-165`) | No hay verificación independiente |
| Autoría externa durable | En `center.json` sólo sobreviven `ai`/`system`; el resto se colapsa a `human` (`lib/state.mjs:323`, `:1687`) | `external` sólo llega desde `knowledge.json`; no hay emisor en el centro |
| Ids de knowledge | Sintéticos deterministas | El diario original no tiene id |
| Push del Host | No existe | El `Notifier` es interno (ver §7) |
| Ventanas | 4 000/80/50/≈40 KB | Mantener payload acotado |

## 13. Límites reales de DSH

- El backend se evalúa al arrancar: un árbol nuevo no está activo hasta reiniciar DSH (por eso la
  aceptación lo exige y lo declara humano).
- No hay canal de notificación Host→plugin; no se puede prometer aviso con el panel cerrado.
- `workingDirectory` y otros servicios exigen sesión viva; la actividad no los necesita porque lee del
  almacén.
- Dos diarios (`center` y `knowledge`) no comparten correlación: `correlationId` se deriva por
  `operationId` o por hash corto, no por una transacción común.
- La autoría se deriva del canal de admisión; no hay firma ni identidad criptográfica. Además, un
  actor `external` que se persiste en `center.json` se colapsa a `human` (`lib/state.mjs:323`, `:1687`):
  sólo `knowledge.json` conserva `external`, y no hay emisor de ese tipo en el centro.
- El desempate de eventos del mismo milisegundo es por `eventId`, no por orden de escritura.

## 14. Pruebas y gates

| Fichero | Bloque |
|---|---|
| `tests/r17-activity.test.mjs` (15) | DTO, taxonomía, autoría, cursor, total, round-trip |
| `tests/r17-api-activity.test.mjs` (11) | GET, 400/405/409, fuentes, mutación, replay, 50 filas |
| `tests/r17-ui.test.mjs` (17) | Pila, cajón, filtros, accesibilidad, timers, i18n |
| `tests/r17-contract.test.mjs` | Contrato (verify) |
| `tests/r17-events.test.mjs` | Semántica de eventos y persistencia (verify) |
| `tests/r17-ux.test.mjs` | Recorrido de UI y estados (verify) |
| `tests/r17-ui-runtime.mjs` | Arnés `node:vm` |

Cifras finales congeladas (gate canónico del Lead, `_audit/R17-GATES.md` 6 889 B, sha256
`355f815604d2c9d8e1edcc186090a66283b2256d15bc21e1f735752d3df2b049`): suite **896/896** (base 873 +
23 de verify), check **411/411** (407 + 4), e2e 19/19 con `center.json 9704ee16…` intacto, autónomo
26/26, mutación 16/16 (críticos 13/13), cobertura **95,71/76,76/83,37** (31 ficheros, cifra canónica),
hermético 16+173, matriz 6/6, r16-e2e 9/9, routing 18/18, portabilidad 29/29, presupuesto R17-A 11/11.
La pasada de `r17-verify-r17.md` (7/7 PASS) midió la misma suite con cobertura **96,54/76,77/83,37**:
es oscilación de instrumentación (±0,8 pp), no una regresión; se documentan ambas y manda la del gate.
`testquality` exit 1 preexistente (1 alta en `tests/state.test.mjs:144`, 30 media / 13 baja; ninguna
alta nueva de R17). El baseline de T36 era 873/873 y 407/407.

## 15. Riesgos residuales

1. **Deriva de tamaño del cliente:** +12,8 % de bytes; no hay presupuesto automático que falle si sigue
   creciendo.
2. **Notificación sólo con panel abierto:** un usuario que cierra el panel no ve el aviso; el diario sí
   queda.
3. **Recorte de 4 000 eventos:** actividad antigua desaparece sin aviso; no hay exportación del diario.
4. **Autoría por canal:** un cliente que falsee el canal puede atribuir a `human` o `agent`; y
   `external` no es durable en `center.json` (se colapsa a `human`).
5. **Sin prueba viva todavía:** falta la aceptación humana; las capturas son `node:vm`, el
   rendimiento se midió con arnés y el informe de verify (PASS 7/7) tampoco abrió un navegador real.
