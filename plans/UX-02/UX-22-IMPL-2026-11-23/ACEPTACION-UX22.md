# UX-2.2 — Matriz de aceptación (acto 2026-11-23)

**Rama:** `feat/ux22-tracking` · **Base:** 1.4.0 (`7d7e839` + 27 modificados preservados) · **API:** `pa/1.5.0`
**Suite:** **620/620 PASS**, 0 fail, 52 538 ms, exit 0 · **Hermética:** `✓ el almacén real no cambió (6 ficheros)` · **`check`:** verde

**Convención de evidencia (`criterio 15`):** `DOBLE` = probado con dobles (core, registro temporal y host simulado);
`HOST REAL` = exige el Host del propietario y una sesión autenticada. Ningún `DOBLE` se presenta como `HOST REAL`.

| # | Criterio del propietario (`UX-22-TRACKING-SPEC.md:289-307`) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | El toggle persiste tras reiniciar DSH | **DOBLE (registro) / BLOCKED (Host)** | `tracking-migration.test.mjs`: la fila sobrevive al cierre y reapertura del registro; el reinicio del Host no se ha ejecutado |
| 2 | El seguimiento no modifica `pa_selection` | **DOBLE · PASS** | `tracking-invariants.test.mjs`: volcado lógico de `pa_selection` idéntico antes/después de un ciclo completo |
| 3 | No modifica `session_scope` explícita | **DOBLE · PASS** | ídem, sobre `session_scope` |
| 4 | Resuelve sólo para su sesión | **DOBLE · PASS** | `resolve-tracking.test.mjs`: dos sesiones, `openProjects` compartido, cada una resuelve su proyecto |
| 5 | Dos sesiones con proyectos distintos quedan aisladas | **DOBLE · PASS** | ídem: `projectId` distintos y `source:'tracking'` en ambas |
| 6 | Conflicto workspace/`cwd` → `scope-conflict` | **DOBLE · PASS** | ídem: código exacto, `details` con `workspace_project_id`, `cwd_project_id`, `workspace_path`, `cwd` |
| 7 | Workspace sin proyecto se sigue pero no resuelve | **DOBLE · PASS** | ídem: `on` + `project_id NULL` → `scope-unresolved`/`tracking-not-resolving`; la fila se conserva |
| 8 | Workspace ausente conserva su seguimiento | **DOBLE · PASS** | `resolve-tracking.test.mjs` + `tracking-invariants.test.mjs`: `last_status='missing'` con `state='on'` intacto |
| 9 | Anidados respetan la raíz más específica | **DOBLE · PASS** | `workspaces-projection.test.mjs` («gana la clave más larga») + `mostSpecific` de `resolve.mjs`, sin cambios |
| 10 | Ninguna operación de seguimiento crea o modifica permisos | **DOBLE · PASS** | `tracking-invariants.test.mjs`: `roots`, `grants`, `projects`, `pa_selection`, `session_scope` y `meta.trusted_roots` idénticos |
| 11 | Las siete herramientas conservan contratos y controles | **DOBLE · PASS** | `check` (7 herramientas, orden y esquemas) + suite completa de integración y contrato v0.1 |
| 12 | El Core sigue funcionando sin DSH | **DOBLE · PASS** | `standalone.test.mjs` + `check` sin `@deepseek-ai/*`; `lib/tracking.mjs` sólo importa `errors.mjs` |
| 13 | La migración conserva registro y almacenes | **DOBLE · PASS** | `tracking-migration.test.mjs`: 11 tablas v2 con recuentos idénticos, `integrity_check`, `user_version` y `meta.registry_version` = 3, migración idempotente |
| 14 | Pruebas herméticas e integración en verde | **DOBLE · PASS** | 620/620 y `✓ hermético` (medido dos veces: 595 y 620) |
| 15 | La evidencia distingue dobles de pruebas reales | **PASS (este documento)** | columna Veredicto con `DOBLE` / `HOST REAL` / `BLOCKED` |
| 16 | Reasociar no mueve conocimiento | **DOBLE · PASS** | `tracking-invariants.test.mjs`: `roots` sin cambio de `scope_id`; `tracking-store` no importa ningún almacén de ámbito |
| 17 | La reconciliación no se atribuye a la persona | **DOBLE · PASS** | `resolve-tracking.test.mjs` + `tracking-invariants`: `tracking.reconcile` sólo con `actor='host'`; ninguna fila humana de reconciliación |

## Lo que queda en `HOST REAL` (no se puede cerrar sin el propietario)

1. **Criterio 1**: que el interruptor persista al reiniciar la aplicación (no sólo al reabrir el registro).
2. Panel montado contra el Host real: pintar, conmutar y ver el 409 de CAS en vivo.
3. `GET /pa/tracking` y `PUT`/`DELETE` con la credencial del Host (hoy probados con el host simulado de `pa-tracking.test.mjs`).

## Defectos encontrados y corregidos en el acto

| # | Defecto | Origen | Corrección |
|---|---|---|---|
| 1 | El panel no enviaba la ruta literal en `PUT`, así que la fila guardaba la clave canónica en minúsculas | integración panel↔API, detectado por revisión del arquitecto | `client.js`: el cuerpo lleva `path`; prueba `T-UX-16` actualizada |
| 2 | La especificación afirmaba que el código v2 «ignora» una tabla v3 (falso: `registry.mjs:181-185`) | documentación | `UX-22-TRACKING-SPEC.md` §5 corregido con el procedimiento real de vuelta atrás |
| 3 | `scope-conflict` no estaba en el contrato de errores | documentación | `PROJECT-AWARE-ERROR-CONTRACT.md` fila nueva con su mapa HTTP |
| 4 | `REGISTRY_DDL` (registro nuevo) no incluía la tabla; sólo la migración | implementación (detectado por el subagente) | una sola definición usada en DDL y migración |

## Pendiente declarado

- Documentación: §20 de `PA-UI-0-API-CONTRACT.md`, escalón nuevo en `PROJECT-AWARE-SESSION-CONTRACT.md`, y `ESTADO-IMPLEMENTACION.md`/`ROADMAP-UX.md`/`CONTINUIDAD*.md`.
- Deuda `P-UX22-01`: extender el fence CSRF a las mutaciones `POST` heredadas.
- Fases 3-6 del mandato (data-quality 0.3.30, correcciones, auditoría independiente, release candidate).
