# Reconciliación del número de vistas

## Veredicto

**Nueve secciones funcionales. Diez pantallas renderizables.**

- **Nueve** pestañas en `PA_VIEWS`, cada una con su función de vista.
- **Una** pantalla más, `source` (detalle de fuente), que **no es pestaña ni ruta**: es un estado interno
  (`state.view === 'source'`) al que se llega con «Abrir» desde Fuentes y del que se sale con «Volver».
- Cero rutas: el panel no tiene router; la navegación es estado en memoria (`data-view`).

La cifra «diez vistas» que aparece en documentos anteriores cuenta esa pantalla subordinada. No es un error de
implementación: es una forma imprecisa de contar. No se crea una décima pestaña para cuadrar el número.

## Matriz

| VIEW-ID | NAME | ROUTE | TAB | COMPONENT | TEST | HOST-VISIBLE | STATUS |
|---|---|---|---|---|---|---|---|
| V-01 | Proyecto | ninguna (estado) | sí (1) | `paViewProject` | `las diez vistas renderizan…`; `la cabecera distingue…` | **sí** (01-project.png) | IMPLEMENTED · VERIFIED HOST |
| V-02 | Bibliotecas | ninguna | sí (2) | `paViewLibraries` | `las diez vistas renderizan…` | **sí** (02-libraries.png) | IMPLEMENTED · VERIFIED HOST |
| V-03 | Fuentes | ninguna | sí (3) | `paViewSources` | `navegación: pestañas, paginación…`; FA-14; FA-07 | **sí** (03-sources.png) | IMPLEMENTED · VERIFIED HOST |
| V-04 | Detalle de fuente | ninguna | **no** (subordinada a V-03) | `paViewSource` | `navegación: … detalle y vuelta` | no capturada | IMPLEMENTED · TESTED LOCAL |
| V-05 | Búsqueda | ninguna | sí (4) | `paViewSearch` | `búsqueda y contexto…`; FA-05 | **sí** (04-search.png) | IMPLEMENTED · VERIFIED HOST |
| V-06 | Contexto | ninguna | sí (5) | `paViewContext` | `búsqueda y contexto…`; FA-12 | **sí** (05-context.png) | IMPLEMENTED · VERIFIED HOST |
| V-07 | Operaciones | ninguna | sí (6) | `paViewOperations` | `operaciones simuladas…`; error simulado | **sí** (06-operations.png) | IMPLEMENTED · VERIFIED HOST |
| V-08 | Diagnóstico | ninguna | sí (7) | `paViewDiagnostics` | FA-13; `la cabecera distingue…` | **sí** (07-diagnostics.png) | IMPLEMENTED · VERIFIED HOST |
| V-09 | Conexión | ninguna | sí (8) | `paViewConnection` | FA-13 | **sí** (08-connection.png) | IMPLEMENTED · VERIFIED HOST |
| V-10 | Historial | ninguna | sí (9) | `paViewHistory` | `historial se presenta como no disponible…` | **sí** (09-history.png) | IMPLEMENTED · VERIFIED HOST |

## Inventario de rutas

**Ninguna.** El panel no declara rutas: `apply()` registra dos slots (`sidebar.panellist` y `main`);
`PA_VIEWS` define las pestañas; `state.view` decide qué se pinta. La API Project-Aware (que tendría rutas)
**no está montada**. El historial no inventa ruta: declara que el contrato no expone listado de auditoría.

## Vistas que existen y no están en la navegación

- **V-04 `source`**: accesible sólo desde V-03. Correcto por diseño (detalle), pero no es sección.

## Código no alcanzable (vistas retiradas)

`client.js` conserva el **panel heredado v0.2** (`Panel`, líneas ~585-620) con siete pantallas propias
(`resumen`, `fuentes`, `buscar`, `contexto`, `metricas`, `configuracion`, `salud`). **No se registra en ningún
slot**: sólo `PaPanel` se monta en `main`. Es código muerto desde K1.

| Vista heredada | Estado |
|---|---|
| `resumen`, `fuentes`, `buscar`, `contexto`, `metricas`, `configuracion`, `salud` | IMPLEMENTED en fuente · **sin registro** · no visible en host |

Consecuencia: contar «vistas implementadas» sin distinguir montadas de no montadas daría 17. La cuenta que
importa es la de pantallas alcanzables: **10**.

## Diferencias entre documentos y código

| Documento | Texto | Realidad | Acción |
|---|---|---|---|
| `docs/K1-IMPLEMENTATION-PLAN/01` §142 | «las diez vistas Project-Aware» | 9 secciones + 1 detalle | errata E-01 |
| `docs/K1-IMPLEMENTATION-PLAN/03` §198, §221, §248 | «diez vistas» | idem | errata E-01 |
| `docs/K1-IMPLEMENTATION-PLAN/05` §53 | «Navegación entre las diez vistas» | idem | errata E-01 |
| `docs/K1-IMPLEMENTATION-PLAN/06` §43 | «diez vistas, estados, a11y» | idem | errata E-01 |
| `eval/functional-audit-01/EXECUTIVE-REPORT.md` §4 | «auditoría funcional de las diez vistas» | idem | no se toca (evidencia inmutable) |
| `eval/functional-audit-01/TEST-RESULTS.md` §35 | «10 vistas» | idem | no se toca |
| `eval/pa-ui-1/evidence/CAMBIOS.md` §65 | «9 pestañas + detalle de fuente (10 vistas)» | **correcto** | — |
| `eval/pa-ui-1/evidence/CRITERIOS.md` §28 | «las 10 vistas (9 pestañas + detalle)» | **correcto** | — |
| `tests/client.test.mjs` | `las diez vistas renderizan…` | 9 pestañas + `source`, verificado en el propio test | correcto con matiz |

## Errata propuesta (no aplicada)

> **E-01.** Donde dice «las diez vistas», léase «las nueve secciones y la pantalla de detalle de fuente».

No se aplica en este acto por dos razones: (a) los documentos de `docs/K1-IMPLEMENTATION-PLAN/` están sellados
en su manifiesto SHA-256 y editarlos lo invalidaría; (b) `eval/**` es evidencia histórica y no se reescribe.
Aplicarla exige un acto documental propio que regenere el manifiesto.
