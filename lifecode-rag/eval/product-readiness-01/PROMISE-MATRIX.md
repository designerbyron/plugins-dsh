# Matriz de promesas — LifeCode RAG

Verificado el 2026-11-19 sobre `fix/t45-4-r17-acceptance` @ `b6c0cd2`, suite **320/320** y humo end-to-end de
13 pasos (`smoke-tools.log`). Estados: `IMPLEMENTED`, `TESTED LOCAL`, `PARTIAL`, `BLOCKED`, `NOT TESTED`.

| Elemento | Estado actual | Implementación faltante | Prueba requerida | Resultado |
|---|---|---|---|---|
| **Herramientas (7)** | Registro en `ctx.tools` (`index.js` §49) + contrato v0.1 con esquemas y errores tipados | nada identificado | suite + humo end-to-end | **PASS (TESTED LOCAL)** |
| **Proyecto activo** | Registro con proyectos, selección por sesión (`session_scope`), revisión y origen (`explicit`/`cwd`) | selección desde la interfaz real (el panel está en fixtures) | tests de selección + selección real en host | **PARTIAL**: backend PASS, UI BLOCKED por gate |
| **Bibliotecas** | `libraries`, `grants` por proyecto, revocación, `effectiveScopes`, prohibición de borrar fuentes de biblioteca | — | tests de concesión/revocación | **PASS (TESTED LOCAL)** |
| **Ingesta** | `planIngest` con clasificación de rutas, deduplicación, metadatos, auditoría; rechaza rutas fuera del ámbito | — | humo: 1 fuente, duplicado omitido | **PASS (TESTED LOCAL)** |
| **Búsqueda** | Híbrida léxica+vectorial con RRF, snippet, filtros por colección/etiqueta; consulta vacía → `invalid-argument` | — | humo: resultados con procedencia | **PASS (TESTED LOCAL)** |
| **Contexto** | MMR + presupuesto de tokens + citas verificables (`text`, `citations`, `tokens`, `truncated`) | — | humo: 1 cita, 15 tokens | **PASS (TESTED LOCAL)** |
| **Recuperación (`get`)** | Por id/clave/URI dentro del ámbito; `source-not-found` si no existe o es de otro proyecto | — | humo: get + aislamiento | **PASS (TESTED LOCAL)** |
| **Eliminación (`forget`)** | Aprobación `allowed-once`, segunda comprobación antes del COMMIT, nunca borra en bibliotecas, purga chunks+FTS | — | humo + sonda: tras borrar, la fuente desaparece de `sources`, `chunks` y `chunks_fts` | **PASS (TESTED LOCAL)** |
| **Reindexación (`reindex`)** | `fts`/`vectors`/`all` con aprobación humana y reconstrucción verificable | — | humo: `rebuiltChunks` | **PASS (TESTED LOCAL)** |
| **Interfaz Project-Aware** | 9 secciones + detalle, rediseño verificado en host, **datos de fixture** | transporte autenticado por sesión para datos reales | — | **BLOCKED** (D-UI-03 / PA01) |
| **Subagentes** | Sin delegación habilitada en el perfil; sin control de linaje en el backend | concesión explícita + señal de linaje del host | escenarios 1-10 | **BLOCKED** (host) |
| **Seguridad** | Identidad `agent.id`, autorización por sesión y proyecto en cada herramienta, fallo cerrado sin aprobación, auditoría | ACL por agente para hijos | tests de sesión invalidada, aislamiento, aprobación | **PARTIAL**: sesión PASS, subagente BLOCKED |
| **Integración DSH** | `index.js` con `inject: ['tools']`, siete definiciones, API legacy condicionada; host carga el plugin (panel visible) | verificación de la lista de herramientas del modelo y del desmontaje | sonda de host | **PARTIAL**: servidor PASS, host NOT TESTED |

## Lo que NO se toca para «cuadrar» la matriz

- No se retira ninguna promesa.
- No se convierte el panel en «real» con datos de fixture.
- No se declara la delegación de subagentes como resuelta: no lo está.
