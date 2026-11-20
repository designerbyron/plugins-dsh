# Observaciones visuales (insumo para el rediseño)

**Acto:** `HERMES-LCRAG-FUNCTIONAL-AUDIT-01` · **Fase:** G · **Fecha:** 2026-11-19
**Regla:** **no se cambió nada.** Ni CSS, ni layout, ni tipografía, ni colores, ni tokens. Esto es una lista
de observaciones para la fase siguiente.

---

## 1. Método y límites

- Base: las 9 capturas del panel (1280 × 819) y la captura de Flota como **referencia de calidad**.
- No hubo inspección en vivo del DOM ni del CSSOM; las conclusiones visuales son de imagen + lectura del CSS.
- No se midió responsive real (390 px): sólo se leyó la regla `@media (max-width: 720px)`.

## 2. Lo que funciona bien y no debe perderse

| Elemento | Por qué conservarlo |
|---|---|
| Banner ámbar de modo sintético | Inequívoco, visible en las 9 pantallas, con texto en dos niveles |
| Pestañas horizontales con subrayado activo | Navegación clara, 9 destinos sin ambigüedad |
| Tarjetas con cabecera y borde | Agrupan bien; el lenguaje visual encaja con el anfitrión |
| Cifras alineadas a la derecha y en tabular | Tablas legibles |
| Estados vacíos con frase y acción | No hay callejones sin salida |
| Lenguaje sobrio (sin adornos) | Coherente con un panel de diagnóstico |

## 3. Observaciones por aspecto

### Jerarquía
- Tres niveles visibles: título del panel (18 px), título de tarjeta (13-14 px), cuerpo (12-13 px). El salto
  entre el título del panel y el resto es pequeño; la vista no tiene un encabezado propio que diga «dónde
  estoy» más allá de la pestaña activa.
- Las etiquetas de `paKv` y los valores tienen **el mismo peso**; cuesta recorrer la ficha del proyecto.

### Densidad y uso del espacio
- Las tarjetas ocupan todo el ancho disponible y el contenido no tiene padding de cuerpo: el texto queda
  pegado al borde izquierdo (FA-11) mientras la tarjeta es enorme.
- En Búsqueda, ~65 % de la tarjeta está vacío y los controles se apiñan a la derecha (FA-03).
- En Contexto, el botón «Construir contexto» está arriba a la derecha y el estado vacío en el centro: la
  acción y su resultado están lejos.
- Fuentes: la tabla supera la altura visible; sin cabecera fija ni paginación visible (FA-14).

### Tarjetas y agrupación
- La cabecera y el contenido no están separados por padding, sólo por la línea del header.
- El `<caption>` de cada tabla repite el título de la tarjeta y se lee como una segunda cabecera (FA-07).
- En Operaciones, dos tarjetas lado a lado con alturas distintas; el registro ocupa el ancho completo.

### Navegación
- Clara y consistente. Sin iconos, pero legible.
- No hay indicación de la vista actual más allá del subrayado; en pantallas grandes el ojo puede perderlo.
- La pestaña activa no se anuncia visualmente en el encabezado (no hay breadcrumb ni subtítulo).

### Tipografía
- Tamaños pequeños (12-13 px) y contraste medio para el texto secundario; legible en las capturas, justo en
  pantallas con escalado.
- Números con separador de miles correcto; fechas `YYYY-MM-DD HH:MM` sin zona ni relatividad.

### Tablas
- Separadores finos, cabeceras en gris, filas altas (~59 px en Fuentes): aireadas, pero con 7 columnas el
  ancho se reparte desigual (URI y título compiten).
- La columna de acciones repite un botón «Abrir» por fila; correcto pero ruidoso en listas largas.
- La tabla de Diagnóstico muestra `common.yes` y una cabecera en inglés (FA-01, FA-08).

### Estados vacíos
- El patrón (borde discontinuo + título + explicación) funciona y es consistente.
- En Operaciones el vacío del registro es una caja grande centrada; en Contexto, una caja con botón lejano.

### Formularios y acciones
- Único formulario real: Búsqueda, roto por la colisión de CSS (FA-03). Es el mayor problema visual del panel.
- Botones sin jerarquía: «Reiniciar datos sintéticos», «Buscar», «Abrir», «Seleccionar» comparten estilo.
- El botón deshabilitado del proyecto actual **sí** se distingue (atenuado) — bien.

### Responsive
- Sólo se puede afirmar que existe un punto de corte a 720 px con grillas a una columna y tabs con scroll.
  `NOT TESTED` en navegador real.

### Banner y semántica de estado
- El banner es el elemento de mayor peso visual de todas las pantallas. Cumple su función, pero compite con
  el contenido en cada vista; en el rediseño conviene un tratamiento más compacto sin perder el texto.
- Los estados (`degraded`, `missing`, `ok`, `present`) se muestran como **texto plano**. No hay color, icono
  ni agrupación que distinga un estado sano de uno degradado; sólo el chip «actual» tiene color.

## 4. La referencia de Flota (calidad esperada)

Se usa **sólo** como vara de calidad, no como plantilla:

| Rasgo de Flota | Qué enseña | Aplicable a RAG |
|---|---|---|
| Cuatro métricas en chips arriba a la derecha | Jerarquía de un vistazo | sí: fuentes, fragmentos, ámbitos, estado |
| Tarjetas con cabecera + contador + acción | Denso sin desorden | sí |
| Columnas de distinta anchura según contenido | Uso del espacio | sí (Fuentes/Contexto) |
| Estados vacíos dentro de la tarjeta, con borde discontinuo y texto centrado | Ya implementado | mantener |
| Tipografía 12-13 px consistente y mucho contraste de pesos | Legibilidad | sí |
| Dos columnas en escritorio, una en móvil | Uso de pantallas anchas | sí |

No se copia su estructura (es otro dominio), ni sus componentes.

## 5. Lista de problemas visuales para la fase de rediseño

| Id | Problema | Severidad de diseño | Defecto asociado |
|---|---|---|---|
| V-01 | Formulario de búsqueda apilado y a la derecha | alta | FA-03 |
| V-02 | Contenido de tarjeta sin padding (pegado al borde) | alta | FA-11 |
| V-03 | `<caption>` duplica el título de la tarjeta | media | FA-07 |
| V-04 | Estados sin semántica visual (todo texto plano) | media | — |
| V-05 | Acción y resultado separados en Contexto | media | FA-12 |
| V-06 | Tabla de Fuentes sin cabecera fija y con paginación fuera de vista | media | FA-14 |
| V-07 | Ficha del proyecto sin jerarquía etiqueta/valor | media | — |
| V-08 | Botones sin jerarquía (primario/secundario) | baja | — |
| V-09 | Cabeceras y valores sin traducir (`verified`, `common.yes`) | baja | FA-01, FA-08 |
| V-10 | Banner dominante en todas las vistas | baja | — |
| V-11 | Columnas de tabla descompensadas (URI vs título) | baja | — |
| V-12 | Sin iconos ni agrupación en la navegación | baja | — |
| V-13 | Sin indicación de la vista actual fuera de la pestaña | baja | — |
| V-14 | Fechas sin contexto (zona/relatividad) | baja | — |

## 6. Restricciones que el rediseño no puede romper

1. El aviso `SYNTHETIC DATA MODE — NO REAL RAG DATA ACCESS` debe seguir visible y en **una sola** región viva.
2. No puede aparecer ningún control que active `live`.
3. Las limitaciones (GAP-05/06/07/09/10) deben seguir visibles en la vista donde importan.
4. La vista Historial debe seguir declarando que no hay ruta contractual.
5. La accesibilidad ya cubierta (roles, teclado, foco visible, contraste por tokens) no puede retroceder.
6. Nada de dependencias nuevas: React del anfitrión y DOM propio.
