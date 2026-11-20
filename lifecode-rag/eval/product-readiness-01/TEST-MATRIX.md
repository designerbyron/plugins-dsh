# Matriz de pruebas y aceptación

Leyenda: `PASS` · `FAIL` · `BLOCKED` · `NOT TESTED`.

## A · Herramientas

| Prueba | Resultado |
|---|---|
| Las siete funcionan de extremo a extremo (definiciones reales) | **PASS** (13 pasos, `smoke-tools.log`) |
| Aislamiento por proyecto (B no lee A) | **PASS** (pasos 11-12) |
| Escritura/borrado respetan autorización | **PASS** (paso 13: sesión invalidada → `scope-forbidden`; `forget`/`reindex` exigen `allowed-once`) |
| Errores tipados en entradas inválidas | **PASS** (`invalid-argument`, `source-not-found`) |

## B · Proyecto y bibliotecas

| Prueba | Resultado |
|---|---|
| Seleccionar ámbito y registrar revisión | **PASS** (suite pa3/pa4) |
| Incorporar fuentes | **PASS** (humo 7-8) |
| Buscar / contexto / consultar / eliminar / reindexar | **PASS** (humo 2-4, 9-10) |
| Conceder y revocar bibliotecas | **PASS** (suite; revocación en caliente) |
| Todo lo anterior **desde la interfaz** | **BLOCKED** (panel en fixtures, D-UI-03) |

## C · Interfaz

| Prueba | Resultado |
|---|---|
| Diez pantallas alcanzables (9 + detalle) | **PASS** (render local; 9 en host por captura) |
| Botones inertes | **PASS** (revisión: contexto deshabilitado sin resultados; acciones simuladas se declaran) |
| Errores de consola | **NOT TESTED** |
| Montaje/desmontaje y cambio de sesión | **NOT TESTED** |
| Filtraciones entre sesiones | **NOT TESTED** |
| Sin desbordamiento a 390/768/1024/1440 | **PASS** (40 combinaciones medidas) |
| ES/EN completos | **PASS** (paridad de claves en la suite) |

## D · Subagentes

| Escenario | Resultado |
|---|---|
| 1-10 (sin concesión, lectura, escritura, otro proyecto, vencida, revocada, profundidad, no herencia) | **BLOCKED / NOT TESTED**: no existe herramienta de delegación habilitada en el perfil, y el plugin no recibe señal de linaje |

## E · Regresión

| Prueba | Resultado |
|---|---|
| Suite previa | **PASS** 320/320 |
| Almacén hermético intacto | **PASS** (5 ficheros, misma huella) |
| Sin red inesperada | **PASS** (0 `fetch` en el recorrido; `check.mjs` ok) |
| Sin escrituras fuera del entorno de prueba | **PASS** (humo sobre temporal; `world.cleanup()`) |
| Otros plugins sin tocar | **PASS** (sólo `README.md` del plugin modificado en este acto) |

## F · Host real

| Prueba | Resultado |
|---|---|
| Panel montado en DSH | **PASS (VERIFIED HOST)** por capturas del propietario |
| Herramientas visibles para el modelo | **NOT TESTED** (no se inspeccionó la lista de herramientas) |
| Desmontaje limpio | **NOT TESTED** |
| Subagente real | **BLOCKED** |

## Resumen

- **PASS**: 7 herramientas end-to-end, aislamiento, autorización por sesión, 320 pruebas, hermético, responsive, i18n, panel montado.
- **BLOCKED**: panel con datos reales (D-UI-03/PA01), subagentes (host sin delegación ni linaje).
- **NOT TESTED**: consola/DOM/desmontaje/sesión en host, lista de herramientas del modelo.
