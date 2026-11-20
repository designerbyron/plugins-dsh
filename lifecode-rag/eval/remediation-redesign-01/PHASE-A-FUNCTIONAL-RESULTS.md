# Fase A — resultados funcionales

**Puerta de aceptación funcional.** Se ejecutó antes del rediseño de composición y se repitió al cerrar.
Todos los estados son `TESTED LOCAL`: pruebas ejecutadas en este equipo, sin host.

## A1 · Traducciones (FA-01, FA-02, FA-08)

| Qué | Antes | Después |
|---|---|---|
| `common.yes` | ausente: la columna `verified` mostraba `common.yes` | `Sí` / `Yes` |
| `common.detail` | ausente: cabecera de tabla mostraba `common.detail` | `Detalle` / `Detail` |
| `verified` | literal en inglés en la cabecera | `Verificado` / `Verified` |

Diccionario: 132 → **154 claves** con paridad ES/EN. Pruebas: `FA-01/FA-02/FA-08: ninguna vista deja claves
de traducción sin resolver` recorre las nueve vistas y falla si aparece un patrón `seccion.clave`;
`FA-02: el diccionario resuelve todas las claves que el panel usa` extrae del fuente todas las llamadas
`t('literal')` y exige que existan en ES y EN, con listas de claves idénticas.

## A2 · Aislamiento CSS (FA-03)

- Espacio de nombres propio: **72 clases `lcr-pa-*`**; el panel ya no usa ninguna clase `.lcr-*` heredada.
- Hoja `CSS_PA` reescrita y autosuficiente: define tipografía, color, caja, tarjetas, tablas, formularios y
  estados. Sin `!important`. Sin selectores fuera del prefijo.
- Prueba estática: `CSS_PA` no contiene `.lcr-` sin prefijar ni `!important`.
- Prueba dinámica: al recorrer las 9 vistas, **toda** clase renderizada empieza por `lcr-pa-` (>20 clases
  distintas ejercitadas).
- Causa raíz del defecto original: `.lcr-form { flex-direction: column }` heredado + `align-items:flex-end`
  del panel → formulario apilado a la derecha. Al dejar de compartir clases, la colisión desaparece por
  diseño, no por parche.

## A3 · Validación de búsqueda (FA-05)

| Caso | Comportamiento |
|---|---|
| Consulta válida | busca y pinta resultados |
| Consulta vacía | no busca; aviso `Escribe algo para buscar`; **conserva** los resultados anteriores |
| Sólo espacios | igual que vacía (`trim`) |
| Consulta > 512 caracteres | rechazo con mensaje; `aria-invalid="true"`; sin resultados falsos |
| Repetir la misma consulta | idempotente |
| Sin resultados | estado vacío, no tabla vacía |
| Error de búsqueda | **NOT APPLICABLE**: el fixture no tiene fuente de error; el camino de error se ejerce en Operaciones |

Prueba: `FA-05: una consulta vacía o en blanco no borra los resultados` y `FA-05: una consulta fuera de
límite se rechaza con mensaje y sin red`.

## A4 · URIs duplicadas (FA-06)

- Normalización: `trim` → barras invertidas a `/` → colapsar `//` → minúsculas.
- Si la URI normalizada ya existe: no se inserta nada, se registra el intento en el diario y se muestra
  `URI duplicada` con el código `duplicate-uri`.
- Afecta también a mayúsculas y espacios (` SINTETICO/Nuevo/Acta.MD ` no crea un duplicado).
- Prueba: `FA-06: la ingesta rechaza URIs duplicadas y conserva el fixture` (comprueba longitud de fuentes
  antes/después y la normalización exacta).

## A5 · Frontera de error por vista (FA-10)

- `paRenderViewSafe(state, t, dispatch, render?)` envuelve el dibujo de la vista en `try/catch`.
- Si una vista lanza: tarjeta de error con título, explicación, botón **Reintentar** (`retry-view`) y
  `data-view-error`; el resto del panel (cabecera, pestañas, navegación) sigue vivo.
- No se expone el mensaje interno ni la pila.
- Prueba: `FA-10: un fallo de una vista no derriba el panel y ofrece reintento` (lanza `boom interno` y
  verifica que el texto no aparece y que el reintento despacha).

## A6 · Acción de contexto (FA-12)

- «Construir contexto» está **deshabilitado** mientras no haya resultados válidos, tanto en Búsqueda como en
  Contexto.
- Con resultados se habilita y construye el contexto sin inventar nada (`paBuildContext` sólo usa los
  resultados presentes).
- Prueba: `FA-12: construir contexto está deshabilitado mientras no haya resultados` (incluye el camino
  habilitado y que el contexto se construye).

## A7 · Paginación (FA-14)

- Controles movidos a la **cabecera de la tarjeta**: página actual/total, primera (`«`), anterior, siguiente
  y última (`»`), siempre visibles aunque la tabla sea larga.
- La tabla tiene altura máxima con scroll interno; el paginador nunca queda debajo de 50 filas.
- Se conserva la página al abrir un detalle y volver (`sourcePage.offset` no se toca).
- Decisión de producto (la menos sorprendente): al cambiar de página no se conserva la selección de fila
  porque no existe tal selección; el offset sí se conserva.
- Prueba: `FA-14: la paginación está en la cabecera y llega a la primera y a la última página`.

## A8 · Resto de P4

| Defecto | Corrección |
|---|---|
| FA-04 `.lcr-error` colisionaba | clase propia `lcr-pa-error` con borde y fondo propios |
| FA-07 caption duplicado | `caption` visualmente oculto (`lcr-pa-sr`); el título va en la cabecera de la tarjeta |
| FA-08 `verified` en inglés | traducido (ver A1) |
| FA-09 título/colección incoherentes | nombres por colección; prueba que ningún título vive en dos colecciones |
| FA-11 tarjetas sin relleno | `paCard` envuelve el contenido en `lcr-pa-card__body` con relleno; prueba estructural |
| FA-13 `degraded` sin explicación | `1 de 3 almacenes no disponible(s)` en Diagnóstico, Proyecto y Conexión |

## A9 · Puerta funcional

```
node --test                 → 319 tests, 319 pass, 0 fail
node tests/client.test.mjs  →  45 tests,  45 pass, 0 fail
node tools/check.mjs        →  ok (7 herramientas, G3)
node tools/hermetic.mjs     →  319/319 + almacén real sin cambios (5 ficheros)
fetch en el recorrido       →  0 (espías del runtime de pruebas)
```

Registro completo en `logs/`. **Puerta superada** antes de la fase visual.
