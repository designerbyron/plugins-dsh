# Estado de cada criterio

**Acto:** `HERMES-LCRAG-K1-END-TO-END-01` · **Fecha:** 2026-11-19
**Vocabulario:** `IMPLEMENTED` · `TESTED LOCAL` · `VERIFIED HOST` · `PARTIAL` · `BLOCKED` · `NOT TESTED`
**Regla:** `VERIFIED HOST` no aparece en ninguna fila porque **no se reinició el host** (prohibido). Lo
único que se midió es el módulo y la suite, en local.

---

## 1. K1-A · integración del cliente

| Id | Criterio | Estado | Evidencia / límite |
|---|---|---|---|
| A-1 | El paquete declara `exports["./client"]` y `dsh.client.platform === "web"` | **TESTED LOCAL** | `check.txt`; prueba «el manifiesto exporta el cliente…» |
| A-2 | El anfitrión descubre y carga el módulo | **NOT TESTED** | exige reiniciar el host y leer `__DSH_BOOT__.entries` |
| A-3 | Sin `TypeError` por APIs obsoletas | **PARTIAL** | la forma `inject(slot)` + `.register` ya no existe (prueba estática y de `apply`); el montaje real no se ejecutó |
| A-4 | La fila aparece en `sidebar.panellist` | **NOT TESTED** | requiere host |
| A-5 | La vista se monta en `main` | **NOT TESTED** | requiere host |
| A-6 | Desmontaje limpio (disposers, estilo, locale) | **PARTIAL** | probado en local (`apply … y todo se dispone al desmontar`); el desmontaje real del slot no |
| A-7 | Locales ES/EN resueltos | **TESTED LOCAL** | 132 claves, paridad exacta, `paReadLanguage` con snapshot/getLocale |
| A-8 | La carga sobrevive a un reinicio | **NOT TESTED** | requiere host |
| A-9 | Las siete herramientas siguen registradas | **TESTED LOCAL** | `check.txt`: 7 herramientas, esquemas intactos |

## 2. K1-B · interfaz Project-Aware (modo sintético)

| Id | Criterio | Estado | Evidencia / límite |
|---|---|---|---|
| B-1 | Navegación entre las 10 vistas (9 pestañas + detalle) | **TESTED LOCAL** | pruebas de navegación, teclado y «las diez vistas renderizan» |
| B-2 | Estados de carga, vacío, error y éxito | **PARTIAL** | vacío (`search`, `operations`), error (`unsupported-format`) y éxito (avisos) sí; **carga** no aplica: los fixtures son síncronos y no se finge un spinner |
| B-3 | Fuentes paginadas (50/página, total 121) | **TESTED LOCAL** | «Mostrando 50 de 121», «Página 2 de 3» |
| B-4 | Procedencia de resultados visible | **TESTED LOCAL** | chip `Normativa interna · lib` y `Proyecto Sintético Alfa · prj` |
| B-5 | Accesibilidad básica | **TESTED LOCAL** (estructural) | `tablist`/`tab`/`tabpanel`, `aria-selected`, una sola `role="status"`, flechas, foco visible por CSS; **no** auditada con lector de pantalla |
| B-6 | Responsive (390 px) | **PARTIAL** | CSS con `@media (max-width: 720px)`, `overflow-wrap:anywhere`, `min-width:0`; no medido en navegador real |
| B-7 | Fixtures sin datos privados reales | **TESTED LOCAL** | ids `*_k1fx_*`, URIs `sintetico/…`, sin rutas de usuario ni tokens; prueba de higiene |
| B-8 | Limitaciones visibles (GAP-05/06/07/09/10) | **TESTED LOCAL** | frases en fuente, proyecto y diagnóstico |
| B-9 | Historial no disponible, sin ruta inventada | **TESTED LOCAL** | vista con causa contractual |
| B-10 | Ninguna petición real en modo fixtures | **TESTED LOCAL** | espías: 0 `fetch`, 0 temporizadores |
| B-11 | Ingesta y reindexación simuladas | **TESTED LOCAL** | registro en memoria, sin escritura; caso de error incluido |
| B-12 | Aviso permanente `SYNTHETIC DATA MODE — NO REAL RAG DATA ACCESS` | **TESTED LOCAL** | cadena exacta + una sola región viva |
| B-13 | Sin control oculto para pasar a `live` | **TESTED LOCAL** | `DATA_MODE` constante; el gate falla si aparece `'live'` |

## 3. Criterios de aceptación existentes (PA-UI-0)

| Id | Criterio | Estado en este acto |
|---|---|---|
| A-01 | Las 7 herramientas y `package.json` sin cambios salvo `exports`/`dsh.client` aprobados | **PASS local**: `check.txt`; solo se añadió `exports` |
| A-02 | SHA-256 de `CONTRATO-v0.1.md` intacto | **PASS local** (no se tocó) |
| A-03/A-04 | `/health` de la API visual; ausencia de la API v0.2 | **NOT TESTED** (no hay API visual) |
| A-05 | Listado de herramientas del host | **NOT TESTED** en host; `check.mjs` confirma las 7 |
| A-06 | Rutas sin `project_id`/`scope_id`/`session_id` | **PASS local** (no hay rutas nuevas) |
| K-01 | `node --test` en `lifecode-rag/` | **PASS local**: 305/305 |
| K-02 | `node tools/hermetic.mjs` | **PASS local**: almacén intacto |
| K-03 | `node tools/check.mjs` | **PASS local**: 7 herramientas + gates G3 |
| K-06 | Hashes de `tools.mjs`/`exec-context.mjs`/`resolve.mjs` | **PASS local** (no se tocaron) |
| G3 | El bundle del cliente puede cargarse | **TESTED LOCAL** (gate + manifiesto); host `NOT TESTED` |
| G4 | Slots con `ctx.slots.inject(key, cb)` | **TESTED LOCAL** (módulo); host `NOT TESTED` |
| G5 | `sessionId` real desde el slot de conversación | **NOT TESTED** |
| G6 / G6b | Rutas A/B; `ui.read` | **BLOCKED** (sin cambios) |

## 4. Estados de seguridad (sin tocar)

| Elemento | Estado |
|---|---|
| GAP-20 | `OPEN / DOCUMENTED HOST LIMITATION` |
| D-UI-03 | `PENDING HUMAN DECISION` |
| Ruta A | `BLOCKED` |
| Ruta B | `NOT DEMONSTRATED` |
| Ruta C | `NOT ACCEPTED` |
| PA01 | `BLOCKED` |
| G6 | `BLOCKED` |
| Q-06 / TI-7 | `PENDING DESIGNATION` |

## 5. Recuento

Sobre las tablas de §1 y §2 (22 criterios):

- **VERIFIED HOST:** 0
- **TESTED LOCAL:** 14 (K1-A: A-1, A-7, A-9 · K1-B: B-1, B-3, B-4, B-5, B-7, B-8, B-9, B-10, B-11, B-12, B-13)
- **PARTIAL:** 4 (A-3, A-6, B-2, B-6)
- **NOT TESTED:** 4 (A-2, A-4, A-5, A-8)
- **BLOCKED:** 1 (G6/G6b, sin cambios)

Las tablas de §3 son otra vista de los mismos hechos (criterios de aceptación existentes), no un segundo
recuento. Un `PARTIAL` no es un `PASS`: en todos los casos falta la mitad que exige el host o el navegador
real, y se dice cuál.
