# Matriz de resolución de defectos

Estados: `IMPLEMENTED` (código), `TESTED LOCAL` (prueba ejecutada aquí), `PARTIAL`, `NOT TESTED`, `NOT APPLICABLE`.

| ID | Sev. | Síntoma original | Corrección | Prueba de regresión | Estado |
|---|---|---|---|---|---|
| **FA-01** | P3 | `common.yes` visible en la columna `verified` de Diagnóstico | clave añadida ES/EN | `FA-01/FA-02/FA-08: ninguna vista deja claves…` | IMPLEMENTED · TESTED LOCAL |
| **FA-02** | P3 | `common.detail` sin traducir en cabeceras | clave añadida y usada | `FA-02: el diccionario resuelve todas las claves…` | IMPLEMENTED · TESTED LOCAL |
| **FA-03** | P3 | formulario de búsqueda apilado a la derecha por colisión con `.lcr-form` heredado | espacio de nombres `lcr-pa-*` completo y hoja autosuficiente | `FA-03: el panel usa sólo su espacio de nombres…` | IMPLEMENTED · TESTED LOCAL |
| **FA-04** | P4 | `.lcr-error` heredaba estilos ajenos | clase propia `lcr-pa-error` | cubierta por `FA-03` (ninguna clase fuera del prefijo) | IMPLEMENTED · TESTED LOCAL |
| **FA-05** | P3 | búsqueda vacía devolvía «sin resultados» y borraba los previos | validación vacía/blanco/>512 sin tocar resultados; `aria-invalid` + mensaje | `FA-05: …no borra los resultados…` y `…fuera de límite…` | IMPLEMENTED · TESTED LOCAL |
| **FA-06** | P3 | ingesta aceptaba URIs duplicadas | normalización + rechazo con aviso y diario | `FA-06: la ingesta rechaza URIs duplicadas…` | IMPLEMENTED · TESTED LOCAL |
| **FA-07** | P4 | caption visible duplicaba el título de la tarjeta | caption con `lcr-pa-sr` | `FA-07: las tablas no muestran un caption duplicado…` | IMPLEMENTED · TESTED LOCAL |
| **FA-08** | P4 | cabecera `verified` en inglés | `Verificado` / `Verified` | incluida en `FA-01/FA-02/FA-08` | IMPLEMENTED · TESTED LOCAL |
| **FA-09** | P4 | «Guía de operación» aparecía en `normativa` | nombres por colección | `FA-09: el título de cada fuente declara la colección…` | IMPLEMENTED · TESTED LOCAL |
| **FA-10** | P3 | un fallo de vista rompía todo el panel | `paRenderViewSafe` + reintento | `FA-10: un fallo de una vista no derriba el panel…` | IMPLEMENTED · TESTED LOCAL |
| **FA-11** | P4 | tarjetas sin relleno interno | `lcr-pa-card__body` | `FA-11: las tarjetas envuelven su contenido…` | IMPLEMENTED · TESTED LOCAL |
| **FA-12** | P3 | «Construir contexto» activo sin resultados | `disabled` sin resultados válidos | `FA-12: construir contexto está deshabilitado…` | IMPLEMENTED · TESTED LOCAL |
| **FA-13** | P4 | `degraded` sin explicación | «1 de 3 almacenes no disponible(s)» en tres vistas | `FA-13: el diagnóstico explica por qué…` | IMPLEMENTED · TESTED LOCAL |
| **FA-14** | P3 | paginación al final de 50 filas, fuera de vista | paginador en la cabecera + primera/última | `FA-14: la paginación está en la cabecera…` | IMPLEMENTED · TESTED LOCAL |

**Resumen:** 14/14 resueltos. 0 diferidos, 0 justificados como no corregibles.

## Defectos visuales encontrados durante la fase B

| ID | Síntoma | Corrección | Estado |
|---|---|---|---|
| V-01 | `select` de límite crecía a 320 px de alto | selector a hijo directo | IMPLEMENTED · TESTED LOCAL |
| V-02 | KPI de bibliotecas contaba ámbitos | cuenta bibliotecas | IMPLEMENTED · TESTED LOCAL |
| V-03 | KPI de servicio mostraba la revisión | muestra la causa del `degraded` | IMPLEMENTED · TESTED LOCAL |
| V-04 | «Mostrando» duplicado | una sola línea | IMPLEMENTED · TESTED LOCAL |
| V-05 | botón primario 3,22:1 | 6,87:1 | IMPLEMENTED · TESTED LOCAL |
| V-06 | pestañas altas a 390 px | padding/tamaño reducidos | IMPLEMENTED · TESTED LOCAL |
| **V-07** | **en host**: con altura de slot restringida, la fila de pestañas se comprimía a 17 px (sólo scroll) | `flex: 0 0 auto` en banner/cabecera/pestañas, `flex: 1 0 auto` en el cuerpo, `overflow: auto` en la raíz | IMPLEMENTED · TESTED LOCAL (reproducido y medido: 17,25 → 40 px) |

## Cambios en pruebas existentes (deliberados, no para «poner verde»)

| Prueba | Cambio | Motivo |
|---|---|---|
| hoja de estilos cubre responsive | `720px` → `760px` | el breakpoint único pasó a 760 |
| `apply` registra locales y slots | `.lcr-banner` → `.lcr-pa-banner` | espacio de nombres nuevo (FA-03) |
| operación simulada falla | texto genérico → «Formato no soportado en el fixture» | el error ahora explica el código (FA-04/FA-13) |
| FA-14 (nueva de este acto) | se sustituyó la aserción de rango `1–50` por el recuento y las páginas | se eliminó la línea duplicada de «Mostrando» (V-04) |

Ninguna otra aserción existente se relajó; el resto del archivo (31 pruebas previas) sigue intacto salvo las
tres primeras filas de esta tabla.
