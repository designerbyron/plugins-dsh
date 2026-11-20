# Resultados de accesibilidad

Medido sobre el render estático con consultas al DOM (no con lector de pantalla). Todo `TESTED LOCAL`.

## Estructura

| Comprobación | Resultado |
|---|---|
| Regiones vivas (`role="status"`) | **1** por vista (el banner sintético), `aria-atomic` y etiqueta propia |
| Tablist / tabs | 1 tablist, **9 tabs**, **1** con `aria-selected="true"`, **8** con `tabindex="-1"` |
| Tabpanel | 1, con `aria-labelledby` a la pestaña activa |
| Navegación por teclado en pestañas | flechas izquierda/derecha (manejador con `preventDefault`), tabulación entra sólo a la activa |
| Inputs y selects | 2 de 2 con etiqueta accesible (`aria-label` o `<label>`) |
| Cabeceras de tabla | **todas** con `scope="col"` |
| Captions | 1 por tabla, con clase `lcr-pa-sr` (visible sólo para tecnologías de asistencia) |
| Foco visible | `:focus-visible` con contorno 2 px del acento y separación, en pestañas, botones, inputs y enlaces |
| Estado inválido | `aria-invalid` + `aria-describedby` al mensaje de validación |
| Botones deshabilitados | atributo `disabled` real (no sólo opacidad): no reciben foco |
| Chips de estado | siempre con texto; el punto de color es `aria-hidden` |

## Contraste (WCAG 2.1, sRGB convertido con canvas)

| Elemento | Ratio | AA (4,5:1) |
|---|---|---|
| Título del panel | 14,50 | ✓ |
| Texto secundario | 6,19 | ✓ |
| Etiqueta de KPI | 6,19 | ✓ |
| Cabecera de tabla | 6,19 | ✓ |
| Pestaña activa | 11,52 | ✓ |
| Chip de aviso | 6,85 | ✓ |
| Botón primario | 6,87 | ✓ |
| Valor de KPI | 13,12 | ✓ |

## Preferencias del usuario

- `prefers-reduced-motion`: se anulan transiciones del panel.
- `forced-colors`: tarjetas, banner, avisos, vacíos y tablist fuerzan borde `CanvasText`.

## Semántica del contenido

- Cada vista tiene un título de tarjeta (`h2`) y las secciones internas usan `h3`.
- Las tablas no dependen del color: la colección y el almacén llevan texto («present», «missing», «normativa»).
- El aviso sintético está siempre en el árbol y es la única región viva, de modo que un cambio de vista no
  dispara anuncios inesperados.

## Limitaciones declaradas

- **No** se probó con NVDA, JAWS ni VoiceOver: `NOT TESTED`.
- **No** se ejecutó un auditor automático (axe/Lighthouse): las comprobaciones son estructurales y de contraste
  medido, no una certificación.
- El contraste depende de los tokens del tema del anfitrión; los valores medidos corresponden al tema oscuro
  con los respaldos del panel.
