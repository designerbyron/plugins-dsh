# Fase B — resultados visuales

**Dirección:** dashboard de gestión de conocimiento, preciso y sobrio, integrado en el anfitrión (tokens del
tema, sin dependencias nuevas), no una página externa embebida.

**Verificación:** `TESTED LOCAL (render estático)`. Se renderiza el árbol real del componente con su hoja de
estilos y se captura con un navegador real a ventana fija. **No** es verificación en host: el panel
rediseñado no se ha cargado todavía en DeepSeek Harness.

## Shell

- **Marca + título + subtítulo** a la izquierda; botón de reinicio a la derecha.
- **Cuatro indicadores veraces**: `Cliente montado` (verde), `API no montada` (ámbar), `Datos sintéticos`
  (ámbar), `Servicio: degraded` (ámbar). Ningún indicador verde de «conectado».
- **Banner sintético** conservado y compactado: una sola región viva (`role="status"`) con
  `SYNTHETIC DATA MODE — NO REAL RAG DATA ACCESS`.
- **Navegación segmentada** de 9 pestañas con patrón ARIA de tablist (una activa, resto `tabindex=-1`,
  flechas izquierda/derecha).

## Vistas

| Vista | Composición |
|---|---|
| **Proyecto** | 4 KPI (ámbitos, bibliotecas, fuentes, servicio) + tarjeta de proyecto activo (kv) + tarjeta de candidatos con acción |
| **Bibliotecas** | tabla con chips de permiso y de almacén (`present` verde / `missing` ámbar), recuento de raíces y aviso si falta algún almacén |
| **Fuentes** | contador en chip, «Mostrando 50 de 121», paginador en cabecera, tabla densa con URI mono truncable (`title` con la URI completa), chip de colección, bytes y fragmentos a la derecha, acción «Abrir» |
| **Detalle de fuente** | toolbar con «Volver» y chips (colección, bytes, fragmentos), kv, tabla de fragmentos con scroll y aviso GAP-05 |
| **Búsqueda** | formulario destacado en una fila (input ancho + límite + Buscar), chips de modo/tiempo/resultados, tabla con procedencia por ámbito, CTA primaria al contexto |
| **Contexto** | 3 KPI (tokens, truncado, considerados), bloque de texto monoespaciado, tabla de citas, aviso de fallo cerrado |
| **Operaciones** | tarjetas separadas de ingesta y reindexación con sello «Simulado», bloque de error con código y descarte, diario en tabla o estado vacío |
| **Diagnóstico** | 3 KPI (registro, almacenes, cabeza de auditoría), tabla de ámbitos con `Verificado` traducido y chips de almacén, versiones con nota de que son datos del fixture, lista de limitaciones GAP-06/10/07 |
| **Conexión** | chips de estado + kv (servicio, registro, raíz, API no montada, legacy, modo) + explicación del `degraded` |
| **Historial** | estado no disponible intencional, motivo contractual, enlace a Operaciones; sin rutas inventadas |

Estados cubiertos por vista: carga (no aplica: fixtures síncronos, declarado), vacío, error, deshabilitado.

## Capturas

`screens-after/`: 10 vistas a 1280×900 y 4 a 390×844 (`project`, `sources`, `search`, `operations`).
`screens-before/`: las 10 capturas del propietario tomadas en el host antes de este acto (1280×819).

**No son comparables píxel a píxel**: las de antes son del host (tema y chrome del anfitrión) y las de
después son del render estático (sin chrome del host). La comparación válida es de composición, jerarquía y
estado, no de color exacto.

## Defectos visuales corregidos en el proceso

| # | Detectado al revisar | Corrección |
|---|---|---|
| V-01 | El `select` de límite heredaba `flex: 1 1 320px` dentro de una columna y crecía 320 px de alto | la regla pasa a hijo directo (`>`), el select mide una línea |
| V-02 | KPI de bibliotecas decía «1 de 3 almacenes» mezclando bibliotecas con ámbitos | cuenta bibliotecas: «1 de 2 almacenes no disponible(s)» |
| V-03 | KPI de servicio usaba «Revisión N» como pista | muestra la explicación del `degraded` |
| V-04 | «Mostrando» duplicado (chip y línea) | una sola línea de recuento + paginador |
| V-05 | Botón primario con 3,22:1 de contraste | fondo oscurecido con el acento: **6,87:1** |
| V-06 | Pestañas demasiado altas a 390 px | padding y tamaño reducidos en el breakpoint |
| **V-07** | **Host**: la fila de pestañas desaparecía en Fuentes (quedaba una línea con scrollbar) | la raíz no tenía scroll propio y las pestañas eran el único hijo comprimible (`min-height` a 0 por `overflow-x`). Ahora banner/cabecera/pestañas son `flex: 0 0 auto`, el cuerpo `flex: 1 0 auto` y la raíz `overflow: auto`; medido 17,25 → 40 px con altura fija |

## Lo que no se hizo

- No se cambió comportamiento para «que se vea mejor»: cada cambio visual va con la prueba funcional verde.
- No se añadieron dependencias, iconos ni fuentes externas.
- No se introdujo ningún control de modo `live` ni de conexión.
