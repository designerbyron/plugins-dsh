# Invariantes de seguridad

Comprobado después de la remediación y del rediseño. Ningún invariante cambió.

| # | Invariante | Cómo se comprobó | Resultado |
|---|---|---|---|
| 1 | Modo sintético fijado en código | `const DATA_MODE = 'fixture'` en `client.js`; `data-data-mode="fixture"` en la raíz | ✓ sin control en la interfaz |
| 2 | Sin red | espías de `fetch`/`setInterval`/`setTimeout` en el runtime de pruebas | **0 llamadas** en las 45 pruebas |
| 3 | Almacén real intacto | `tools/hermetic.mjs`: huella antes/después de la suite | **5 ficheros, misma huella** |
| 4 | API Project-Aware no montada | `index.js` sin registro de API; vista Conexión declara «no montada» | ✓ no se añadió ni una ruta |
| 5 | Sin datos reales en fixtures | prueba de higiene: rutas de usuario, `.dsh`, `.credentials`, `eyJ`, `sk-`, `Bearer ` | 0 coincidencias; ids `k1fx`, URIs `sintetico/` |
| 6 | Banner sintético visible | `role="status"` único, texto `SYNTHETIC DATA MODE — NO REAL RAG DATA ACCESS` | ✓ presente en las 9 vistas |
| 7 | Sin control de modo `live` | búsqueda de controles/acciones de activación | no existe |
| 8 | Sin autenticación ficticia | ninguna referencia a sesión, cookie, token o `agents.get` en el panel | no existe |
| 9 | Gates congelados | revisión de estados declarados | PA01 `BLOCKED` · D-UI-03 `PENDING HUMAN DECISION` · G6 `BLOCKED` · Ruta A `BLOCKED` · Ruta B `NOT DEMONSTRATED` · Ruta C `NOT ACCEPTED` · GAP-20 `OPEN` · Q-06 `PENDING DESIGNATION` |
| 10 | Sin cambios de topología | no se tocaron perfiles, `DSH_HOME`, puertos ni servicios; el host no se reinició | ✓ |
| 11 | Sin operaciones reales | ingesta y reindexación son reducers puros en memoria; el diario es local | ✓ |
| 12 | Aislamiento visual del panel | 72 clases `lcr-pa-*`; la hoja PA no define `.lcr-*` ni usa `!important` | ✓ prueba estática y dinámica |

## Lo que el panel no puede declarar

- No es una API segura: es una interfaz sobre fixtures.
- No prueba identidad de sesión: no hay transporte autenticado.
- Que la fila aparezca en la barra lateral no habilita ninguna lectura real.

## Operaciones prohibidas en este acto (verificadas como no ejecutadas)

`git add/commit/merge/rebase/push/checkout/reset/clean/stash`: **0**. Reinicio de Harness: **0**. Cambios en
`.dsh`: **0**. Instalación de plugins: **0**. Apertura de credenciales: **0**.
