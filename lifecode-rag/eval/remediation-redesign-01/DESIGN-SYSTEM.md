# Sistema de diseño del panel Project-Aware

Autocontenido en `CSS_PA` (una sola etiqueta `<style id="lcr-styles">`). Sin dependencias, sin `!important`,
sin selectores fuera de `.lcr-pa-*`.

## Tokens

Se declaran en `.lcr-pa-root` y toman el tema del anfitrión con respaldo:

| Token | Origen | Respaldo |
|---|---|---|
| `--pa-bg` | `--dsw-alias-bg-base` | `#17181c` |
| `--pa-surface` | `--dsw-alias-bg-layer-1` | `#202127` |
| `--pa-surface-2` | `--dsw-alias-bg-layer-2` | `#2a2b32` |
| `--pa-border` | `--dsw-alias-border-l1` | `#2c2d33` |
| `--pa-border-2` | `--dsw-alias-border-l2` | `#34353d` |
| `--pa-text` | `--dsw-alias-label-primary` | `#e8e8ea` |
| `--pa-muted` | `--dsw-alias-label-secondary` | `#a0a0aa` |
| `--pa-accent` | `--dsw-alias-brand-primary` | `#4f8cff` |
| `--pa-ok` | `--dsw-alias-state-success-primary` | `#2fbf71` |
| `--pa-warn` | `--dsw-alias-state-warn-primary` | `#d6a100` |
| `--pa-err` | `--dsw-alias-state-error-primary` | `#e5484d` |

Radios: `--pa-radius: 10px` (tarjetas), `--pa-radius-sm: 7px` (banner, notice, chips de contenedor, pre).

## Tipografía

| Rol | Tamaño / peso |
|---|---|
| Título del panel | 20 px / 650, `letter-spacing -0.01em` |
| Subtítulo | 12 px / normal, color muted |
| Título de tarjeta | 12,5 px / 650 |
| Sección interna | 11 px / 650, mayúsculas, `letter-spacing .05em` |
| Cuerpo | 13 px / 1.5 |
| Tabla | 12 px; cabecera 10,5 px mayúsculas |
| KPI: etiqueta / valor / pista | 10,5 px / 21 px 650 / 11 px |
| Monoespaciado | ids, URIs, offsets, contexto |

## Espaciado y superficies

- Ritmo base 14 px entre bloques; 12–14 px dentro de tarjetas; 8–10 px en formularios.
- Tres niveles: fondo (`--pa-bg`) → tarjeta (`--pa-surface`) → control (`--pa-surface-2`).
- Tarjeta: borde 1 px, radio 10, sin sombra; cabecera con borde inferior y tinte del 35 % del nivel 2.

## Estados

- `chip--ok` verde, `chip--warn` ámbar, `chip--err` rojo, `chip--lib` acento, neutro con borde.
- Cada chip lleva texto, no sólo color.
- Punto de estado (`.lcr-pa-dot`) sólo decorativo (`aria-hidden`), acompañado siempre de texto.

## Tablas

- `border-collapse: separate` con `border-spacing: 0` para permitir cabecera fija.
- `th` pegajoso, mayúsculas, 10,5 px, una línea; `td` 8/10 px, borde inferior suave, hover de fila.
- Números a la derecha con `font-variant-numeric: tabular-nums`.
- Contenedor con `max-height: 540px` y scroll propio; en móvil, sin tope de altura.
- URIs largas: `max-width` + elipsis + `title` (nunca rompen la tabla).

## Formularios y foco

- Inputs con borde propio, 12,5 px, alto cómodo (7/9 px de relleno).
- `:focus-visible` con contorno de 2 px del acento y 2 px de separación en pestañas, botones, inputs y enlaces.
- Estado inválido: `aria-invalid="true"` + borde de error + mensaje asociado por `aria-describedby`.

## Breakpoints

- Único corte en **760 px**: cabecera en columna, KPIs en 2 columnas, split a una columna, formularios a ancho
  completo, tabla sin tope de altura, pestañas con menos relleno.
- Por encima: rejillas `auto-fit` (tarjetas ≥260 px, KPIs ≥150 px) y split 1,15/0,85.

## Contraste medido

Medido sobre el render real con conversión a sRGB (canvas) y fórmula WCAG 2.1:

| Par | Ratio |
|---|---|
| Título sobre fondo | **14,50 : 1** |
| Texto secundario (`muted`) | **6,19 : 1** |
| Etiqueta de KPI | **6,19 : 1** |
| Cabecera de tabla | **6,19 : 1** |
| Pestaña activa | **11,52 : 1** |
| Chip de aviso | **6,85 : 1** |
| Botón primario | **6,87 : 1** |

Todos ≥ 4,5:1 (AA para texto normal). El botón primario partía de 3,22:1 y se corrigió oscureciendo el fondo
del acento un 28 %.
