# Resultados responsive

Medido en navegador real (Chromium) sobre el render estático del panel, con `Emulation.setDeviceMetricsOverride`
a cuatro anchos. Métrica: `documentElement.scrollWidth − innerWidth`. **≤ 0 significa sin desbordamiento
horizontal** (el negativo es la barra de desplazamiento vertical).

## Desbordamiento por vista y ancho

| Vista | 390 px | 768 px | 1024 px | 1440 px |
|---|---|---|---|---|
| Proyecto | −15 | 0 | 0 | 0 |
| Bibliotecas | −15 | −15 | −15 | −15 |
| Fuentes | −15 | −15 | −15 | −15 |
| Detalle de fuente | −15 | −15 | −15 | −15 |
| Búsqueda | −15 | −15 | 0 | 0 |
| Contexto | −15 | −15 | −15 | −15 |
| Operaciones | −15 | −15 | −15 | −15 |
| Diagnóstico | −15 | −15 | −15 | −15 |
| Conexión | −15 | −15 | −15 | −15 |
| Historial | −15 | −15 | −15 | −15 |

**Cero desbordamientos en 40 combinaciones (10 vistas × 4 anchos).**

## Altura del contenido

| Vista | 1280 px de ancho | 390 px de ancho |
|---|---|---|
| Proyecto | 900 | 1 227 |
| Fuentes | 933 | 3 447 |
| Búsqueda | 900 | 1 741 |
| Operaciones | 900 | 1 124 |

El panel está pensado para ocupar el ancho disponible del slot, no el viewport completo: a 1280 el contenido
cabe en una pantalla salvo Fuentes (933 px, 33 px por debajo del pliegue, con scroll propio en la tabla).

## Comportamiento por componente

- **Pestañas:** a 390 px la barra tiene 269 px de desbordamiento interno y se desplaza horizontalmente
  (patrón habitual de tablist); a partir de 768 no hay scroll (0 px).
- **Tablas:** contenedor con scroll propio y cabecera pegajosa; a ≤760 px se quita el tope de altura para no
  crear dos scrolls verticales anidados. Las URIs largas se truncan con elipsis y `title`.
- **Tarjetas:** rejilla `auto-fit` (≥260 px) que colapsa a una columna; KPIs a 2 columnas por debajo de 760.
- **Split** (proyecto, diagnóstico): 1,15/0,85 en escritorio, una columna en móvil.
- **Formularios:** input a ancho completo y controles apilados por debajo de 760; sin desbordamiento.
- **Cabecera:** marca y botón se apilan; los cuatro chips envuelven sin cortarse.

## Altura restringida (defecto V-07, observado en host)

El slot del host no da altura libre: entrega una caja de altura fija. Medido sobre el render, forzando la
raíz a 860 px:

| Antes del arreglo | Después |
|---|---|
| pestañas **17,25 px** (sólo la barra de scroll) | pestañas **40 px** |
| raíz recortaba el contenido | raíz con `overflow: auto`: 933 px de contenido sobre 910 de caja |

Causa: en una columna flex con altura fija, el navegador reparte la falta de espacio encogiendo los hijos; la
fila de pestañas era el único con `min-height` resoluble a 0 (por `overflow-x: auto`). Corregido con
`flex: 0 0 auto` en banner, cabecera y pestañas, `flex: 1 0 auto` en el cuerpo y scroll en la raíz.

## Limitaciones

- No se probó con el chrome real del anfitrión ni con paneles muy estrechos (<390 px).
- No se probaron alturas extremas (p. ej. 400 px de alto): el layout es de flujo vertical con scroll, no
  dependiente de la altura.
- Las capturas a 390 px corresponden a cuatro vistas; el resto se midió sin captura.
