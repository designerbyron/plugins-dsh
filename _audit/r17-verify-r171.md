# R17.1 — Verificación independiente (T40)

> Verificador: `verify-r16`. Árbol congelado: no se modificó `lib/`, `index.js`, `client.js`, `package.json`, `_audit/*.md` existentes ni datos reales.
> Fecha: 2026-11-09. Evidencia con ejecución real: backend con `loadState`/`buildActivityFeed`, cliente real en `node:vm`, centro real en sólo lectura.

## 1. Entregables

| Fichero | Contenido |
|---|---|
| `lifecode-skill-center/tests/r17-r171.test.mjs` | 8 pruebas independientes de R17.1 (claves semánticas y traducciones, histórico por tipo, centro real, etiquetas de conexión, sin escritura/polling) |
| `_audit/r17-verify-r171.md` | Este informe |

No se copiaron casos de `tests/r17-activity.test.mjs` (17) ni de `tests/r17-ui.test.mjs` (21); mi fichero cruza el backend con las tablas i18n reales, usa fixtures propias y aserciones distintas.

## 2. Veredicto por punto

| # | Punto | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Cada tipo tiene clave semántica; `skill.created` ⇒ «Skill creada» y `skill-imported` ⇒ «Skill importada» (clave `activity.title.skill-imported`, ES/EN) | **PASS** | Prueba 1: recorre `EVENT_MAP` completo (categoría, severidad y `activity.title.*` válidos); exige las dos claves corregidas y su presencia en las **dos** tablas i18n de `client.js` (ES «Skill «{skill}» creada/importada», EN “Skill … created/imported”). Cero claves del mapa huérfanas de traducción |
| 2 | Un evento histórico con `titleKey` incorrecto se pinta por su TIPO, sin escribir en `center.json` ni regenerar ids; `ev-e1d22376f174`→skill-created, `ev-4b5ef716129b`→skill-imported; 0 `titleKey` persistidos | **PASS** | Pruebas 2 y 3. `normalizeEvent` ignora un `titleKey` guardado erróneo (`skill-imported`+`title.skill-created` ⇒ `skill-imported`). Centro real: `loadState` sin escribir (sha256 `9704ee16…` idéntico antes/después), 29 eventos, ids intactos, ambos eventos con su clave derivada (`skill-created`/`skill-imported`; este último `category:'create'`, `origin:'import'`), y **0 eventos con `titleKey` persistido**. El script read-only `_audit/r17.1-recon/verify-history.mjs` re-ejecutado da lo mismo (`persistedTitleKeys: 0`) |
| 3 | Los demás tipos conservan traducción (mejoras propuestas/aprobadas/rechazadas, referencias, asignaciones, requests, insight/decision/policy) | **PASS** | Prueba 1: los 13 tipos exigidos no degradan al genérico y tienen exactamente una entrada ES y una EN. Prueba 4 añade las filas del mapa con severidad esperada (`improvement.rejected` alert/warning, `skill.assigned` update/info, etc.). `improvement.proposed` ⇒ `improvement-prepared` («Mejora preparada»), conforme a `_audit/R17-EVENT-CONTRACT.md:144` |
| 4 | /api/activity 200 con center+knowledge `ok` NO se presenta como «Sin conexión»; drawer «Centro disponible» y canal externo como capacidad aparte | **PASS** | Prueba 5: diálogo «Centro disponible», sin «Sin conexión» ni «con avisos», nota «Avisos externos no disponibles», punto `ok`; exactamente **1 GET** `/api/activity?limit=…` sin `before`; 0 POST al abrir el cajón |
| 5 | Fuente no legible ⇒ «Centro disponible con avisos: `<ids>`», nunca centro caído | **PASS** | Prueba 6: `knowledge: unreadable` ⇒ «Centro disponible con avisos: knowledge», sin «Sin conexión», sin fingir «Centro disponible» a secas |
| 6 | Abrir/consultar el drawer no escribe ni emite eventos (0 POST a /api/state; 1 GET acotado) | **PASS** | Prueba 5 (calls medidas desde que se abre el cajón: 1 GET, 0 POST) y prueba 8 (todos GET). El bootstrap del panel (`POST /api/state {action:'open'}`) ocurre al montar, antes de abrir el cajón, y no lo provoca el drawer |
| 7 | La indisponibilidad de canal externo no implica API caída; sin inventar estados sin evidencia; sin polling (`setInterval` exactamente 1 preexistente) | **PASS** | Pruebas 7 y 8: `sources: []` ⇒ «Estado no disponible» (no «Sin conexión», no «Centro disponible»); `client.js` tiene **1** `setInterval(` (refresco preexistente `client.js:6887`); el sandbox no define `setInterval` y el cajón no crea timers ≥10 s. Nota: la etiqueta del cajón sale de `sources`/error real, no del contrato (`ActivityIndicator` ya no recibe `compat`) |

**Defectos de producto: NINGUNO.** Las tres aserciones rojas que aparecieron al principio (`POST` del bootstrap contado al abrir, texto de error genérico del cajón y el detector de testquality con la forma `{skip}`) eran de mi prueba; corregidas sin tocar producto.

## 3. Gates (todos re-ejecutados)

| Gate | Resultado | Exit |
|---|---|---|
| `node --test tests/r17-r171.test.mjs` | **8/8 pass** | **0** |
| `node --test tests/r17-activity.test.mjs tests/r17-ui.test.mjs tests/r17-contract.test.mjs tests/r17-r171.test.mjs` | **54/54 pass** | **0** |
| `node --test tests/testquality-audit.test.mjs` | **7/7 pass** (sólo queda la alta preexistente `tests/state.test.mjs:144`) | **0** |
| `node --test` | **911/911 pass, 0 fail, 0 skipped** | **0** |
| `node tools/check.mjs` | **412/412** | **0** |
| `node tools/e2e.mjs` | 19/19 PASS; `center.json` `9704ee16…` → `9704ee16…` **SIN CAMBIOS** | **0** |
| `node tools/r17-perf.mjs` | **10/11 PASS**, `client.js` 454 594 → **518 967 B**: pasa «<20 %» (+14,2 %) pero **falla «<60 KB» (+64 373 B)** | **1** |
| `node tools/testquality.mjs` | 1 alta (preexistente `tests/state.test.mjs:144`), 30 media, 13 baja | **1** (preexistente) |

## 4. Hallazgo abierto (gate de rendimiento, no producto)

**P1 · Media — presupuesto R17-A excedido por el delta de R17.1.** `node tools/r17-perf.mjs` falla la comprobación «client.js crece menos de 60 KB»: baseline `_audit/r17-perf-baseline.json` = 454 594 B; tras R17 = 512 924 B; tras R17.1 (tablas i18n nuevas + cambios de `ActivityIndicator`/`ActivityDrawer`) = **518 967 B**, es decir **+64 373 B** sobre el baseline (el umbral es +61 440 B). El porcentaje (<20 %) sigue pasando.

- Acción: el árbol está congelado; **no lo he tocado**. Decide el Lead: (a) revisar el umbral absoluto a 65 KB para el alcance acumulado R17+R17.1, o (b) abrir delta de reducción si el presupuesto es contractual.
- Efecto colateral declarado: `node tools/r17-perf.mjs` reescribió `_audit/r17-perf-after.json` (es su salida normal) con los valores nuevos; `_audit/r17-perf-baseline.json` **no** se tocó.

## 5. Riesgos residuales y notas

1. **Deriva documental menor:** `_audit/R17-EVENT-CONTRACT.md:149/154` aún asocia requests/`insight-*`/decision/policy a `activity.title.improvement-proposed`, mientras el mapa vigente les da claves propias (`skill-requested`, `insight-received`, …), que es lo que el Lead declaró y lo que verifican mis pruebas. El producto es coherente con la indicación del Lead; el documento de contrato no.
2. **`improvement.proposed`** se rotula «Mejora preparada» (`improvement-prepared`, `humanApprovalRequired:true`), no «Mejora propuesta»; coincide con `R17-EVENT-CONTRACT.md:144`. La clave `activity.title.improvement-proposed` existe pero no la usa el mapa.
3. **`testquality`** sigue rojo preexistente por `tests/state.test.mjs:144`; mi fichero no aporta altas (se comprobó con el detector tras corregir la forma del test).
4. La lectura del centro real se hizo con `loadState` (sólo lectura) y se verificó por hash antes/después; no se ejecutó ninguna mutación ni se regeneraron capturas.
5. `tests/r17-ui-runtime.mjs` (arnés ajeno) tiene `unmount()` defectuoso (`style.remove`), documentado desde R17; no afecta a estas pruebas porque no se usa.

## 6. Reproducción

```sh
cd lifecode-skill-center
node --test tests/r17-r171.test.mjs        # 8/8, exit 0
node --test tests/testquality-audit.test.mjs  # 7/7, exit 0
node --test                                # 911/911, exit 0
node tools/check.mjs                       # 412/412, exit 0
node tools/e2e.mjs                         # 19/19, center.json 9704ee16… sin cambios
node tools/r17-perf.mjs                    # 10/11, exit 1 → P1 resuelto: ver §4 y §7
node ../_audit/r17.1-recon/verify-history.mjs  # ev-e1d22376f174 / ev-4b5ef716129b, persistedTitleKeys 0
```

## 7. Observación menor — cerrada (post-verificación)

- **P1 (presupuesto) cerrado** por el Lead con presupuesto por tramos 60 KiB (R17) + 8 KiB (R17.1) = **68 KiB** en `tools/r17-perf.mjs`. Re-medido: `node tools/r17-perf.mjs` ⇒ **11/11 PASS, exit 0** (454 594 → 519 032 B, +64 438 B, 63,0 KiB; el gate relativo «<20 %» sigue PASS).
- **Regresión de tipo desconocido cerrada**: `client.js` `activityTitle` (~L6696-6716) prueba `event.titleKey` cuando la clave derivada del tipo no existe en i18n. Reproducido con el harness real (`node:vm`): `type:'skill.unknown'` + `titleKey:'activity.title.change-detected'`, `titleVars:{origin:'reconcile'}` ⇒ **«Cambio detectado en reconcile»** (antes «Creación»). Sin `titleKey` sigue degradando honestamente a la categoría («Creación»), sin inventar texto. Los tipos vigentes siguen resolviéndose por tipo.
- **Exit codes re-medidos:** `node --test tests/r17-r171.test.mjs` ⇒ **8/8, exit 0**; `node tools/r17-perf.mjs` ⇒ **11/11, exit 0**.

Veredicto **PASS 1-7** sin cambios con el árbol actual.
