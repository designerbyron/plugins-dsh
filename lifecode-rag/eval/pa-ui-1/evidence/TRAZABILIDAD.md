# Matriz de trazabilidad — requisito → implementación → prueba → evidencia

**Acto:** `HERMES-LCRAG-K1-END-TO-END-01` · **Fecha:** 2026-11-19

---

## 1. Fase 2 · K1-A (integración del cliente)

| Requisito del encargo | Implementación | Prueba | Evidencia |
|---|---|---|---|
| Exportación del bundle | `package.json` → `exports` | «el manifiesto exporta el cliente…»; `check.mjs` | `check.txt` |
| API de slots vigente | `client.js` → `ctx.slots.inject(SLOT, () => ctx.slots.register(...))` | «registra los slots con la API vigente…»; «apply registra locales y los dos slots…» | `node-test.txt` |
| Gestión de disposers y limpieza | `ctx.effect` para estilo y locale; registro dentro del callback | «apply … y todo se dispone al desmontar» | ídem |
| No depender de metadatos opcionales | sin `dsh.client.inject`; `ctx.locale` opcional con guarda | «sin servicio de locale, apply no revienta…»; manifiesto sin `inject` | ídem |
| Respetar el orden de inicialización | estilo → locale → slots, todo en `apply` | prueba de `apply` (efectos en orden, 2 disposers) | ídem |
| Evitar registros duplicados | un `<style id>` dentro de un efecto; locale con disposer | conteo de efectos y de estilo en la prueba de `apply` | ídem |
| Limpieza al desmontar | disposers devueltos por efecto y por registro | ídem (`style.removed === true`) | ídem |
| Errores si falta una capacidad | guardas `typeof locale.register === 'function'` | prueba sin locale | ídem |
| Localización sin textos duplicados | 132 claves ES/EN en un solo diccionario | paridad + `paTranslate` + `paReadLanguage` | ídem |
| Pruebas de exportación/carga/slots/registro | suite de 31 pruebas del módulo | `node --test tests/client.test.mjs` | `PRUEBAS.md` |
| Sin llamadas de red en pruebas sintéticas | espías en el sandbox + guarda `fixture-mode` | «ninguna interacción dispara red ni temporizadores»; «la capa heredada falla cerrada…» | `SIN-ACCESO-REAL.md` |
| Mocks sólo para contratos, no como seguridad | el sandbox simula `document` y React; no se declara seguridad | límites en `PRUEBAS.md` §4 y `SIN-ACCESO-REAL.md` §2 | ídem |

## 2. Fase 3 · K1-B (interfaz Project-Aware)

| Vista pedida | Implementación | Ruta contractual que representa | Prueba |
|---|---|---|---|
| 1 · Vista general del proyecto | `paViewProject` (+ selector de proyecto) | `GET /session`, `GET /projects` | navegación, reducer de selección |
| 2 · Estado de la biblioteca | `paViewLibraries` | `GET /libraries` (sólo lectura) | «las diez vistas renderizan» |
| 3 · Fuentes | `paViewSources` (50/página, total 121) | `GET /sources` | paginación |
| 4 · Búsqueda | `paViewSearch` | `POST /search` | búsqueda y contexto |
| 5 · Contexto | `paViewContext` (9 campos de cita) | `POST /context` | ídem |
| 6 · Detalle de fuente | `paViewSource` (fragmentos + GAP-05) | `GET /sources/:id` | navegación y detalle |
| 7 · Ingesta simulada | acción `ingest` + registro en memoria | **no existe** ruta de escritura: se declara simulada | operaciones |
| 8 · Reindexación simulada | acción `reindex` | **no existe** ruta: se declara simulada | operaciones |
| 9 · Diagnóstico | `paViewDiagnostics` | `GET /diagnostics` | «las diez vistas renderizan» |
| 10 · Conexión y disponibilidad | `paViewConnection` | `GET /health` + estado del servicio | ídem |
| Historial (limitación) | `paViewHistory` | **sin ruta**: se declara no disponible | «historial se presenta como no disponible» |

| Requisito de diseño | Implementación | Prueba |
|---|---|---|
| Coherencia visual | mismas tarjetas, tablas y tokens en todas las vistas | revisión de estructura + CSS único |
| Navegación clara | 9 pestañas + detalle con «Volver» | navegación, teclado |
| Estados vacío/error/éxito | `paEmpty`, `lcr-error`, avisos | búsqueda vacía; operación fallida; avisos de éxito |
| Indicador sintético permanente | banda `role="status"` con el texto exacto | «el panel monta el aviso sintético…» |
| Mensajes comprensibles | diccionarios ES/EN con frases de causa y acción | paridad + revisión |
| Adaptación a tamaños | `@media (max-width: 720px)`, `min-width: 0`, `overflow-wrap` | aserción estática |
| Accesibilidad y teclado | roles, `aria-*`, flechas, foco visible | teclado + región viva única |
| Sin polling en fixtures | cero temporizadores | espías en 0 |
| No simular conexiones reales | vista «Conexión» dice «no montada» y `legacy: false` | «las diez vistas renderizan» |
| Detección live no ejecutada | no existe rama `live` | gate `DATA_MODE` |
| Aviso inequívoco | `SYNTHETIC DATA MODE — NO REAL RAG DATA ACCESS` | cadena exacta |
| Sin botón/selector oculto a live | no hay control; constante en código | gate que falla si aparece `'live'` |
| Pruebas de UI (navegación, vistas, datos, vacío, error, a11y, responsive, operaciones, sin API, sin almacén) | 31 pruebas del módulo + 305 de la suite | `PRUEBAS.md` |

## 3. Fase 1 · Enmienda G3

| Requisito | Implementación | Verificación |
|---|---|---|
| Distinguir carga, `exports`, `dsh.client`, orden y activación | §L G3 + subsección nueva | `G3-AMENDMENT.md` §2 |
| Retirar `inject` como requisito universal | G3 reescrito; `check.mjs` lo prohíbe | `check.txt` |
| Resolver X-R-01 (revisión 2 vs 3) | referencia corregida con evidencia | `G3-AMENDMENT.md` §3 |
| No alterar otros criterios | diff de 4 hunks | `diffs/PA-UI-0-ACCEPTANCE.md.diff` |
| Hash antes/después y diff | registrados | `HASHES.txt` |

## 4. Fase 6 · Gates de seguridad

| Gate | Estado exigido | Estado real |
|---|---|---|
| GAP-20 | `OPEN / DOCUMENTED HOST LIMITATION` | igual |
| D-UI-03 | `PENDING HUMAN DECISION` | igual |
| Ruta A / B / C | `BLOCKED` / `NOT DEMONSTRATED` / `NOT ACCEPTED` | igual |
| PA01 / G6 | `BLOCKED` | igual |
| Q-06 / TI-7 | `PENDING DESIGNATION` | igual |
