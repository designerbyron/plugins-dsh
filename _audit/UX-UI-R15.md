# UX/UI R15 — Analítica y revisión visual de LifeCode Skill Center

Snapshot: rama `feature/visual-operation-feedback`, `HEAD 3b29510`.
Alcance: ADDENDUM R15-A (auditoría y corrección visual) sobre el producto en
`C:\xampp\htdocs\plugins-dhs\lifecode-skill-center`. Sin cambios de lógica, API,
políticas ni datos.

## 1. Estado inicial

Analítica se abrió en la ventana real de DSH (`HWND 395352`, 1936×1048, panel en
el slot `main`). Estado «antes»: [ux-r15-before-05.png](ux-r15-before-05.png).

Lo que se vio y lo que se midió:

1. Las tarjetas de una misma fila de `.lsc-grid-2` no compartían altura. Con
   `align-items: start`, la tarjeta corta («Comparación de proyectos»,
   «Referencias entre versiones») terminaba antes que su pareja y dejaba un
   hueco vertical que se leía como composición rota.
2. El contador de «Skills menos utilizadas» se pintaba como `0 · 0` y se partía
   en dos líneas dentro de la columna estrecha (1.45fr / 1fr).
3. El hueco muerto bajo «Referencias entre versiones» era el más visible de la
   sección: entre esa tarjeta y `Bandeja de conocimiento`.

Causa raíz localizada en `client.js`:

- `.lsc-mono` (línea 1087) definía sólo `font-family` y `font-size`, sin
  `white-space`: cualquier contador con separador `·` podía envolver.
- `.lsc-grid-2` (línea 1073) usaba `align-items: start`.

## 2. Hallazgos por severidad

| # | Severidad | Hallazgo | Componente | Causa |
|---|---|---|---|---|
| H1 | MEDIO | Indicador `0 · 0` partido en dos líneas en «Skills menos utilizadas» | `.lsc-mono` + `InsightsSection` | falta `white-space: nowrap` |
| H2 | MEDIO | Huecos verticales bajo tarjetas cortas en las dos filas de `.lsc-grid-2` | `.lsc-grid-2` | `align-items: start` |
| H3 | BAJO | Títulos largos de skills truncados en «Calidad por versión» y «Skills menos utilizadas» | `.lsc-item`, `.lsc-row` | el truncado es intencional: el texto completo vive en el cajón de la skill |
| H4 | BAJO | Filtros de Analítica en dos filas con una línea de ayuda al final | barra de filtros | comportamiento esperado: mantiene la semántica y evita desbordes |

No se encontró ningún hallazgo CRÍTICO ni ALTO: contenido accesible, controles
utilizables y sin desbordamiento que impida operar.

## 3. Correcciones aplicadas

Archivo: `lifecode-skill-center/client.js` (2 reglas CSS, sin tocar JS de lógica).

1. `.lsc-mono { … white-space: nowrap; }` — el contador `0 · 0`, la versión y las
   cifras de proyectos dejan de partirse. Afecta a los mismos contadores de
   Biblioteca, Proyectos y Calidad, del mismo tipo.
2. `.lsc-grid-2 { … align-items: stretch; }` — las dos tarjetas de cada fila
   igualan altura; el hueco desaparece y la sección se lee como rejilla.

Sin cambios en: API, `lib/`, almacén, políticas, identidad, permisos, herramientas
ni datos de producción.

Captura «después»: [ux-r15-after-01.png](ux-r15-after-01.png) (parte alta) y
[ux-r15-after-03.png](ux-r15-after-03.png) (donde vive el `0 · 0`).

## 4. Matriz responsive

Ventana restaurada (no maximizada) y redimensionada; capturas en
`_audit/ux-r15-<ancho>.png`. Regla medida: **`MoveWindow` no surte efecto con la
ventana maximizada**, hay que `ShowWindow(SW_RESTORE)` antes.

| Ancho | Estado | Observación |
|---|---|---|
| 1920 | OK | 2 columnas, KPI en 4, sin cortes |
| 1600 | OK | 2 columnas, alturas iguales, `0 · 0` en una línea |
| 1440 | OK | 2 columnas, truncado con `…` y texto completo en el cajón |
| 1366 | OK | 2 columnas, sin desbordes |
| 1280 | OK | 2 columnas más estrechas, sin desbordes |
| 1024 | OK | una columna, rail de iconos, filtros apilados |
| 768 | OK | una columna, cabecera y rail adaptados |
| 430 / 390 | **no alcanzable** | la ventana de DSH impone un mínimo real de **536 px**: pedir 390/430 devuelve 536. Las capturas por debajo de 536 no son medidas válidas de la UI |
| 536 | OK | ancho mínimo real: una columna, cabecera en dos líneas, sin recorte de contenido |

Limitación declarada: los cortes de 430/390 del CSS existen y están cubiertos por
`tests/styles.test.mjs`, pero no se pueden validar por redimensionado de ventana
en este entorno; requeriría emulación de dispositivo en DevTools.

## 5. Revisión del resto del plugin

Inspección visual secundaria sin cambios de código: Resumen (ciclo de la skill y
cola de revisión), Biblioteca (peticiones, buscador, tabla), Proyectos
(descubiertos/gestionados/identidad), Mejoras (aprobada con versión), cajón de
skill (versiones, historial, proyectos, comparar), formulario de creación y
estados vacíos. Consistencia de padding, jerarquía y estados vacíos correcta; no
se identificaron incoherencias que justifiquen tocar estilos fuera de Analítica.

## 6. Pruebas

Ejecutadas tras las correcciones, sobre el mismo snapshot:

- `node --check client.js` — OK.
- `node --test tests/styles.test.mjs tests/render.test.mjs tests/client.test.mjs`
  — 30/30.
- `node --test` (suite completa) — **603/603**, exit 0.
- `node tools/check.mjs` — **359/359**, exit 0.
- `tests/testquality-audit.test.mjs` — actualizado en la misma ronda porque el
  hallazgo alto esperado `fragil/ruta-de-usuario|tests/backup.test.mjs`
  desapareció al neutralizar una ruta personal; se retiró esa entrada (no se bajó
  ninguna expectativa).

## 7. Archivos modificados por esta auditoría

| Archivo | Cambio | Justificación |
|---|---|---|
| `lifecode-skill-center/client.js` | `.lsc-mono` con `white-space: nowrap`; `.lsc-grid-2` con `align-items: stretch` | H1 y H2 |
| `lifecode-skill-center/tests/backup.test.mjs` | ruta real del almacén derivada de `homedir()` con respaldo `emptyState` | seguridad del paquete (R15 §3.1), no visual |
| `lifecode-skill-center/tests/testquality-audit.test.mjs` | retirada la entrada ya corregida de `EXPECTED_HIGH` | mantener la línea base del auditor coherente |
| `_audit/UX-UI-R15.md`, `_audit/ux-r15-*.png`, `_audit/r15-*.mjs`, `_audit/r15-responsive.json` | evidencias y utilidades de esta ronda | evidencia verificable |

## 8. Decisiones pendientes de una persona

1. Validar 430/390 px con emulación de dispositivo si se quiere cubrir el corte
   más estrecho del CSS.
2. Decidir si el truncado con `…` de títulos largos debe ir acompañado de
   `title` nativo (mejora de accesibilidad, no aplicada para no cambiar la API
   de componentes en una ronda de revisión).

## 9. Complemento R15.1 — espacios, mosaico y verificación posterior

La segunda pasada encontró una causa adicional de las franjas vacías que no
estaba en el informe original: la clase `.lsc-stack` se usaba en el contenedor
de la sección (`client.js:2409`) **sin ninguna regla CSS**. Sin
`display: flex` ni `gap`, los bloques se apilaban como elementos de bloque sin
ritmo vertical y las franjas se leían como huecos de composición.

### 9.1 Correcciones añadidas

| Cambio | Detalle | Motivo |
|---|---|---|
| `.lsc-stack` | `display: flex; flex-direction: column; gap: 16px;` | la clase existía sin regla; fija el ritmo vertical de la sección |
| `.lsc-cols` / `.lsc-cols > *` | `column-count: 2`, `column-gap: 14px`, `break-inside: avoid`, `margin: 0 0 14px` | mosaico de cuatro tarjetas de altura natural (Proyectos, Calidad por versión, Referencias, Skills menos utilizadas), sin bandas entre filas |
| media query estrecha | `.lsc-cols { column-count: 1; }` | una columna en móvil, igual que `.lsc-grid-2` |
| pareja «Skills más activas» + «Diagnóstico del almacén» | pasa de `.lsc-grid-2` a `.lsc-stack` | sus alturas son muy dispares: estirarlas dejaba un hueco interno grande; apiladas, cada una conserva su altura |

`align-items: stretch` se mantiene en `.lsc-grid-2` para la pareja
gráfico/distribución, que sí tiene alturas comparables.

### 9.2 Verificación posterior (app reiniciada)

Capturas con la ventana restaurada y el rectángulo real medido en cada paso
(`_audit/r151-responsive-after.json`):

| Ancho pedido | Ancho real | Archivo | Resultado |
|---|---|---|---|
| 1920 | 1920 | `r151-after-1920.png` | KPI en 4, gráfico y distribución a la misma altura |
| 1600 | 1600 | `r151-after-1600.png` | dos columnas, sin cortes |
| 1440 | 1440 | `r151-after-1440.png` | truncado con `…`, sin desbordes |
| 1366 | 1366 | `r151-after-1366.png` | dos columnas |
| 1280 | 1280 | `r151-after-1280.png` | dos columnas estrechas |
| 1024 | 1024 | `r151-after-1024.png` | una columna, rail de iconos |
| 768 | 768 | `r151-after-768.png` | una columna |
| 536 | 536 | `r151-after-536.png` | ancho mínimo real de la ventana DSH |

430 y 390 siguen **sin verificarse visualmente**: la ventana no baja de 536 px,
así que sólo están cubiertos por las pruebas de CSS, no por captura. No se
declaran como verificados.

### 9.3 Estado del mosaico

Con `.lsc-cols` el orden de lectura es por columnas y cada tarjeta conserva su
altura: desaparece la banda horizontal entre «Comparación de proyectos» y
«Referencias entre versiones». Captura: `r151-after-mosaic.png`.

### 9.4 Incidente durante la verificación

La recarga de la página tras alternar el bundle dejó el arranque web en fallo
(`404` del bundle de cliente) y la aplicación mostró su pantalla de
recuperación. No hubo pérdida de datos: los almacenes conservaron su huella
SHA-256 y el panel volvió a abrirse tras reiniciar. Detalle completo, evidencia y
reglas en [INCIDENTE-2026-11-09-web-boot.md](INCIDENTE-2026-11-09-web-boot.md).

### 9.5 Pruebas de la segunda pasada

- `node --check client.js` — OK.
- `node --test tests/styles.test.mjs tests/render.test.mjs tests/client.test.mjs`
  — **30/30**.
- `node --test` completo y `node tools/check.mjs` — resultados en la entrega de
  R15.1.
