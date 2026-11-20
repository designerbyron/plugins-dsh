# Resultado vista por vista

**Acto:** `HERMES-LCRAG-FUNCTIONAL-AUDIT-01` · **Fase:** B · **Fecha:** 2026-11-19
**Fuentes:** capturas del anfitrión (`screens/`), código (`client.js`), pruebas locales (`tests/client.test.mjs`), fixture.
**Regla:** `VERIFIED HOST` sólo cuando la captura lo muestra; lo demás es `TESTED LOCAL`, `IMPLEMENTED`, `PARTIAL`, `NOT TESTED` o `NOT APPLICABLE`.

---

## B1 · Proyecto

| Comprobación | Estado | Evidencia |
|---|---|---|
| Información del proyecto activo | **VERIFIED HOST** | «Proyecto Sintético Alfa» |
| Estado de selección | **VERIFIED HOST** | `active` |
| Origen de la selección | **VERIFIED HOST** | `explícita` |
| Revisión | **VERIFIED HOST** | `3` |
| Ámbitos efectivos | **VERIFIED HOST** | `3` |
| Proyectos candidatos | **VERIFIED HOST** | 2 filas |
| Raíces por proyecto | **VERIFIED HOST** | 2 y 1 |
| Indicador de proyecto actual | **VERIFIED HOST** | chip verde «actual» en Alfa; «—» en Beta |
| Botón de selección, comportamiento | **TESTED LOCAL** | el reducer cambia `projectId`, sube revisión a 4 y anota la operación en el registro simulado |
| Estado deshabilitado del actual | **VERIFIED HOST** | ampliación de la captura: el botón de Alfa está atenuado; el de Beta, no |
| Error al no poder seleccionar | **PARTIAL** | el único camino es «mismo proyecto» → aviso; no hay simulación de fallo |
| ¿Cambia estado o sólo lo visual? | **TESTED LOCAL** | cambia estado real del fixture (proyecto, revisión, journal); en host `NOT TESTED` |
| GAP-09 representado | **VERIFIED HOST** | texto «la selección todavía no protege contra dos pestañas» |

## B2 · Bibliotecas

| Comprobación | Estado | Evidencia |
|---|---|---|
| Listado | **VERIFIED HOST** | 2 bibliotecas |
| Permisos | **VERIFIED HOST** | `read` en ambas |
| Estado de almacén | **VERIFIED HOST** | `present` y `missing` |
| Raíces | **VERIFIED HOST** | 1 y 1 |
| Marcas de concesión | **VERIFIED HOST** | 2025-11-13 00:13 / 00:15 |
| Sólo lectura | **VERIFIED HOST** + **IMPLEMENTED** | nota visible; no hay controles de concesión en el markup |
| Almacén ausente representado | **VERIFIED HOST** | `missing` |
| Biblioteca revocada | **NOT APPLICABLE** | el fixture no incluye una revocada |
| Sin controles de grant/revoke | **VERIFIED HOST** | ninguna acción en la tabla |

## B3 · Fuentes

| Comprobación | Estado | Evidencia |
|---|---|---|
| Conteo inicial | **VERIFIED HOST** | «Mostrando 50 de 121» |
| Tamaño de página | **VERIFIED HOST** | 50 |
| Paginación | **PARTIAL** | los botones existen y están probados (`TESTED LOCAL`); en la captura no se ven: quedan por debajo del borde inferior |
| Orden estable | **TESTED LOCAL** | el fixture se genera en orden de `updatedAt` descendente; la captura lo respeta |
| URI y título coherentes | **PARTIAL** | URI y colección concuerdan; el **título** no siempre (ver FA-09) |
| Colección y fragmentos | **VERIFIED HOST** | columnas presentes y con valores |
| Bytes y actualización | **VERIFIED HOST** | con separador de miles |
| Acción abrir/detalle | **TESTED LOCAL** | abre la fuente y vuelve; en host `NOT TESTED` |
| Estado vacío | **TESTED LOCAL** | no alcanzable con 121 fuentes: `NOT APPLICABLE` en host |
| Fuente inexistente | **TESTED LOCAL** | vista «La fuente ya no está en el fixture» |

## B4 · Búsqueda

| Comprobación | Estado | Evidencia |
|---|---|---|
| Validación de entrada | **DEFECTO FA-05** | consulta vacía o sólo espacios: no hay mensaje; pulsar «Buscar» borra los resultados previos sin explicar |
| Consulta vacía | **DEFECTO FA-05** | ídem |
| Consulta de sólo espacios | **DEFECTO FA-05** | ídem (`trim()` la convierte en vacía) |
| Ejecución | **TESTED LOCAL** | busca en título/URI/colección del fixture |
| Límite de resultados | **VERIFIED HOST** (8) + **TESTED LOCAL** (8/20/50) | selector de la captura |
| Orden de resultados | **TESTED LOCAL** | `rrf` descendente por construcción |
| Campos de ranking | **TESTED LOCAL** | columna `rrf`; en la captura no hay resultados que mostrar |
| Sin resultados | **TESTED LOCAL** | estado vacío con frase propia |
| Estado de error | **NOT APPLICABLE** | el fixture no tiene camino de error de búsqueda |
| Búsqueda repetida | **TESTED LOCAL** | recalcula y reinicia contexto |
| Persistencia al cambiar de pestaña | **TESTED LOCAL** | el estado no se pierde al navegar |
| Sólo datos sintéticos | **TESTED LOCAL** + **IMPLEMENTED** | 0 `fetch` con espías |

## B5 · Contexto

| Comprobación | Estado | Evidencia |
|---|---|---|
| No se construye sin resultados válidos | **PARTIAL** | el resultado es correcto (contexto vacío + aviso), pero el botón sigue **habilitado**: affordance engañosa (FA-12) |
| Consume el conjunto buscado | **TESTED LOCAL** | toma los tres primeros resultados |
| Estructura de citas | **TESTED LOCAL** | 9 campos de `CONTRATO-v0.1` |
| Referencias a fuente y fragmento | **TESTED LOCAL** | `sourceId`, `uri`, `ordinal`, offsets |
| Conteo de tokens | **TESTED LOCAL** | `ceil(caracteres/4)`, etiquetado como estimación |
| Truncado | **NOT APPLICABLE** | en fixture nunca trunca (`truncated:false` fijo) |
| Contexto vacío | **VERIFIED HOST** | «Ejecuta una búsqueda y construye el contexto con sus resultados.» |
| Estado de error | **NOT APPLICABLE** | sólo existe la nota estática de fallo cerrado |
| Reinicio tras nueva búsqueda | **TESTED LOCAL** | `context: null` al buscar |

## B6 · Operaciones

### Ingesta simulada

| Comprobación | Estado | Evidencia |
|---|---|---|
| Validación de entrada | **NOT APPLICABLE** | la URI se elige de un desplegable; no hay texto libre |
| URI válida | **VERIFIED HOST** (desplegable) + **TESTED LOCAL** | `sintetico/nuevo/acta-de-reunion.md` |
| URI inválida | **NOT APPLICABLE** | no hay camino de entrada libre |
| URI duplicada | **DEFECTO FA-06** | cada ingesta crea otra fuente con la misma URI, sin aviso |
| Resultado de éxito | **TESTED LOCAL** | aviso + fuente al principio de la lista |
| Error simulado | **TESTED LOCAL** | `.pdf` → «No se pudo completar la operación simulada» (`unsupported-format`) |
| Entrada en el registro | **TESTED LOCAL** | `op-k1fx-001`, con hora sintética |
| Sólo estado del fixture | **TESTED LOCAL** + hermético | no escribe ficheros ni almacenes |

### Reindexación simulada

| Comprobación | Estado | Evidencia |
|---|---|---|
| Número de fuentes | **VERIFIED HOST** | «Fuentes afectadas: 121» |
| Número de fragmentos | **NO EXPUESTO** | la vista no muestra el total de fragmentos (observación O-03) |
| Resultado de éxito | **TESTED LOCAL** | aviso «Reindexación simulada completada» |
| Fallo simulado | **NOT APPLICABLE** | no hay camino de fallo para reindexar |
| Registro | **TESTED LOCAL** | nueva entrada `op-…` |
| Ejecución repetida | **TESTED LOCAL** | añade entradas, no duplica fuentes |

| Comprobación transversal | Estado |
|---|---|
| La pantalla declara que no se accede a ficheros ni almacenes | **VERIFIED HOST** |

## B7 · Diagnóstico

| Comprobación | Estado | Evidencia |
|---|---|---|
| Estado del registro | **VERIFIED HOST** | `ok` |
| Estado de almacenes | **VERIFIED HOST** | `degraded` |
| Cabeza de auditoría | **VERIFIED HOST** | `42` |
| Lista de ámbitos | **VERIFIED HOST** | 3 filas (`prj` + 2 `lib`) |
| Distinción proyecto / biblioteca | **VERIFIED HOST** | columna `kind` |
| Presencia de almacén | **VERIFIED HOST** | `present`, `present`, `missing` |
| Estado de verificación | **DEFECTO FA-01** | la columna muestra `common.yes` (clave sin traducir) y `no` |
| Versión del plugin | **VERIFIED HOST** (valor de fixture) | `1.0.0` |
| Versión de contrato | **VERIFIED HOST** (valor de fixture) | `0.1.0` |
| Versión de API | **VERIFIED HOST** (valor de fixture) | `pa-ui/0.1.0-draft` |
| Versión del anfitrión | **VERIFIED HOST** (valor de fixture) | `0.2.2-rc.5` — coincide con el host real medido, pero el dato **no** se lee del host |
| Mensajes de GAP | **VERIFIED HOST** | GAP-06, GAP-10, GAP-07 |
| Combinación engañosa `ok/degraded/ready/missing` | **NO** | `degraded` de almacenes concuerda con una biblioteca `missing`; `ready` es la raíz de almacenes, no el estado |

## B8 · Conexión

| Comprobación | Estado | Evidencia |
|---|---|---|
| Servicio | **VERIFIED HOST** | `degraded` |
| Registro | **VERIFIED HOST** | `ok` |
| Raíz de almacenes | **VERIFIED HOST** | `ready` |
| API Project-Aware | **VERIFIED HOST** | `no montada` |
| API heredada v0.2 | **VERIFIED HOST** | `no` |
| Modo de datos | **VERIFIED HOST** | `fixture` |
| Conectividad real | **VERIFIED HOST** | «No hay conexión real: el panel no habla con ninguna API y no puede activarla.» |
| ¿Implica conexión real? | **NO** | el texto y el banner lo impiden |

## B9 · Historial

| Comprobación | Estado | Evidencia |
|---|---|---|
| Estado explícito de no disponible | **VERIFIED HOST** | «No disponible en esta versión» |
| Explicación de la ruta ausente | **VERIFIED HOST** | cita el contrato y `/diagnostics` |
| Sin historial fabricado | **VERIFIED HOST** | no hay tabla ni filas |
| Sin enlaces/controles engañosos | **VERIFIED HOST** | ninguno |
| Distinción con el registro simulado | **VERIFIED HOST** | remite a Operaciones |

## B10 · Navegación e interacción compartida

| Comprobación | Estado | Evidencia |
|---|---|---|
| Cambio de pestaña | **VERIFIED HOST** | 9 capturas, 9 pestañas |
| Indicación de pestaña activa | **VERIFIED HOST** | subrayado bajo la pestaña |
| Navegación por teclado | **TESTED LOCAL** | flechas izquierda/derecha |
| Foco | **PARTIAL** | `:focus-visible` en CSS; no observado en host |
| Navegación repetida | **NOT TESTED** | no se operó el host |
| Duplicación de listeners | **NOT TESTED** | requiere DOM |
| Reinicio de estado | **TESTED LOCAL** | «Reiniciar datos sintéticos» vuelve al estado inicial |
| Aislamiento de errores entre vistas | **DEFECTO FA-10** | no hay frontera de error por vista: una excepción pinta en blanco el slot entero (comportamiento documentado del host) |
| Sin excepciones no capturadas | **TESTED LOCAL** | 31 pruebas, 0 lanzamientos |

---

## Resumen de la fase B

- **VERIFIED HOST:** 38 comprobaciones.
- **TESTED LOCAL:** 22.
- **PARTIAL:** 6 (paginación visible, título/colección, affordance de contexto, foco, botón de contexto, error de selección).
- **NOT TESTED:** 3 (navegación repetida, listeners, detalle de fuente en host).
- **NOT APPLICABLE:** 8 (por diseño del fixture).
- **DEFECTOS:** 5 (FA-01, FA-05, FA-06, FA-10, FA-12).
