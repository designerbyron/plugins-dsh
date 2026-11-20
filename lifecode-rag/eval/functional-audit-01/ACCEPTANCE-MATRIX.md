# Matriz de aceptación de la auditoría

**Acto:** `HERMES-LCRAG-FUNCTIONAL-AUDIT-01` · **Fecha:** 2026-11-19
**Criterio:** las condiciones de §11 del encargo, con el estado real de cada una.

---

## 1. Condiciones de aceptación

| # | Condición | Estado | Evidencia |
|---|---|---|---|
| 1 | Las diez vistas examinadas | **CUMPLIDA** | 9 pestañas auditadas con captura (`VIEW-BY-VIEW-RESULTS.md` B1-B9) + detalle de fuente por código (B3) + navegación compartida (B10); la captura de Flota se usa sólo como referencia |
| 2 | Montaje del cliente clasificado con evidencia post-reinicio | **CUMPLIDA** | `HOST-VERIFICATION.md` §2: montaje visible `VERIFIED HOST`; DOM y consola `NOT TESTED` |
| 3 | Montaje de la API clasificado por separado | **CUMPLIDA** | `HOST-VERIFICATION.md` §4: API Project-Aware **no montada**; panel visible ≠ API |
| 4 | Cada acción de usuario con comportamiento conocido | **CUMPLIDA** | §2 de este documento (13 acciones) |
| 5 | Procedencia de fixtures documentada | **CUMPLIDA** | `DATA-PROVENANCE-MATRIX.md` |
| 6 | Fronteras de seguridad comprobadas sin exponer datos | **CUMPLIDA** | `SECURITY-AND-FIXTURE-VERIFICATION.md` (4 niveles separados) |
| 7 | Resultados de regresión reproducibles | **CUMPLIDA** | `TEST-RESULTS.md` + `logs/` |
| 8 | Defectos priorizados | **CUMPLIDA** | `DEFECT-REGISTER.md` (14 defectos, 0 P0/P1/P2) |
| 9 | Mejoras visuales documentadas aparte | **CUMPLIDA** | `VISUAL-OBSERVATIONS.md` (14 problemas visuales) |
| 10 | Hashes de la evidencia verificados | **CUMPLIDA** | `HASHES.txt` (verificado con `sha256sum -c`) |

## 2. Las 13 acciones de usuario

| Acción | Dónde | Comportamiento real | Estado | Evidencia |
|---|---|---|---|---|
| Seleccionar proyecto | Proyecto | cambia `projectId`, revisión +1, entrada en el registro; el actual está deshabilitado | **TESTED LOCAL** + deshabilitado `VERIFIED HOST` | reducer + captura ampliada |
| Anterior / Siguiente | Fuentes | mueve `offset` de 50 en 50, acotado a 0…100 | **TESTED LOCAL** | pruebas de paginación |
| Abrir fuente | Fuentes | cambia a la vista de detalle con fragmentos | **TESTED LOCAL** | prueba de navegación |
| Volver | Detalle | vuelve a Fuentes | **TESTED LOCAL** | ídem |
| Buscar | Búsqueda | filtra el fixture; con consulta vacía no avisa y borra resultados (**FA-05**) | **TESTED LOCAL** | reducer |
| Cambiar límite | Búsqueda | cambia `limit` (8/20/50); se aplica al buscar | **TESTED LOCAL** + valor `VERIFIED HOST` | captura + reducer |
| Construir contexto | Contexto | toma los 3 primeros resultados; sin resultados avisa pero el botón sigue activo (**FA-12**) | **TESTED LOCAL** | prueba de contexto |
| Elegir URI de ingesta | Operaciones | cambia la ruta simulada | **VERIFIED HOST** (desplegable) + **IMPLEMENTED** | captura |
| Ingesta simulada | Operaciones | añade fuente; `.pdf` → error simulado; duplicado sin aviso (**FA-06**) | **TESTED LOCAL** | pruebas de operaciones |
| Reindexación simulada | Operaciones | añade entrada al registro con el número de fuentes | **TESTED LOCAL** | ídem |
| Reiniciar datos sintéticos | Cabecera | vuelve al estado inicial (journal y fuentes incluidos) | **TESTED LOCAL** | prueba de reset |
| Cambiar de pestaña | Navegación | cambia de vista sin recargar; conserva el estado | **VERIFIED HOST** (9 capturas) + **TESTED LOCAL** | capturas + prueba de teclado |
| Descartar aviso de error | Operaciones | limpia `lastError` y el aviso | **TESTED LOCAL** | prueba de error simulado |

## 3. Estados usados

| Estado | Nº de filas | Dónde |
|---|---|---|
| `VERIFIED HOST` | 40 | montaje, valores de las vistas, banner, botón deshabilitado |
| `TESTED LOCAL` | 26 | reducer, vistas, navegación, aislamiento |
| `PARTIAL` | 6 | paginación visible, foco, affordance, error de selección, título/colección, detalle en host |
| `NOT TESTED` | 5 | DOM, consola, listeners, navegación repetida, disposición |
| `NOT APPLICABLE` | 8 | caminos que el fixture no tiene (revocada, URI inválida, error de búsqueda, truncado, carga) |
| `BLOCKED` | 8 | los gates de seguridad |

No se usa `PASS` en ningún criterio que no se haya ejecutado.

## 4. Lo que la auditoría **no** acepta

- No acepta el montaje del cliente como seguridad: son capas distintas.
- No acepta una captura como prueba de DOM, consola o listeners.
- No acepta el estado `degraded` del fixture como si fuera una lectura del host.
- No cierra G5, G6, PA01 ni D-UI-03.
