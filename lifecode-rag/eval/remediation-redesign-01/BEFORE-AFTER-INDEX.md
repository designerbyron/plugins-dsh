# Índice antes / después

## Capturas «antes»

`screens-before/` — 10 capturas tomadas por el propietario **en el host** (1280×819) antes de este acto:
`01-project.png`, `02-libraries.png`, `03-sources.png`, `04-search.png`, `05-context.png`, `06-operations.png`,
`07-diagnostics.png`, `08-connection.png`, `09-history.png`, `10-fleet-reference.png`.

## Capturas «después»

`screens-after/` — render estático del componente real con su hoja de estilos, navegador Chromium:

| Archivo | Vista | Ventana |
|---|---|---|
| `project-1280.png` | Proyecto (KPIs + split) | 1280×900 |
| `libraries-1280.png` | Bibliotecas | 1280×900 |
| `sources-1280.png` | Fuentes (paginador en cabecera) | 1280×900 |
| `source-1280.png` | Detalle de fuente | 1280×900 |
| `search-1280.png` | Búsqueda con resultados | 1280×900 |
| `context-1280.png` | Contexto con citas | 1280×900 |
| `operations-1280.png` | Operaciones con una ingesta simulada | 1280×900 |
| `diagnostics-1280.png` | Diagnóstico con limitaciones | 1280×900 |
| `connection-1280.png` | Conexión | 1280×900 |
| `history-1280.png` | Historial no disponible | 1280×900 |
| `project-390.png` | Proyecto estrecho | 390×844 |
| `sources-390.png` | Fuentes estrecho | 390×844 |
| `search-390.png` | Búsqueda estrecho | 390×844 |
| `operations-390.png` | Operaciones estrecho | 390×844 |

## Qué mirar en cada comparación

| Vista | Antes | Después |
|---|---|---|
| Proyecto | kv suelto + tabla sin jerarquía | 4 KPI, tarjeta de proyecto y tarjeta de candidatos en split |
| Bibliotecas | tabla plana, `store` en texto crudo | chips de permiso/almacén, aviso de almacén ausente, nota de sólo lectura |
| Fuentes | paginador al final, URIs largas | contador + paginador en cabecera, tabla con scroll, URI truncable, chips de colección |
| Búsqueda | formulario apilado a la derecha (colisión CSS) | formulario destacado en una fila, chips de resultado, CTA al contexto |
| Contexto | kv + pre + tabla | 3 KPI, bloque de contexto, tabla de citas con scroll |
| Operaciones | dos formularios sueltos | tarjetas separadas con sello «Simulado», error explicado, diario |
| Diagnóstico | kv + tablas, `common.yes` visible | KPIs, ámbitos con `Verificado` y chips, versiones con nota de fixture, limitaciones GAP |
| Conexión | kv sin jerarquía | chips de los cuatro estados + kv + causa del `degraded` |
| Historial | texto de no disponible | estado vacío intencional con enlace a Operaciones |

## Aviso de comparación

Las capturas de antes vienen del host (con su chrome y su tema) y las de después de un render estático del
componente. **No son comparables píxel a píxel**: sirven para comparar composición, jerarquía y estados. La
verificación en host del rediseño queda `NOT TESTED` hasta que se reinicie Harness con autorización.

## Artefactos reproducibles

`preview/*.html` contiene las 10 vistas autocontenidas (markup + CSS del módulo). Se regeneran con:

```
node eval/remediation-redesign-01/tools/render-html.mjs eval/remediation-redesign-01/preview
```
