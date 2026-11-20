# Informe ejecutivo — remediación funcional y rediseño visual

**Acto:** `HERMES-LCRAG-REMEDIATION-REDESIGN-01` · **Proyecto:** LifeCode RAG · **Fecha:** 2026-11-19
**Alcance:** corregir los 14 defectos de la auditoría funcional y rediseñar el panel Project-Aware, sin
salir del modo sintético y sin tocar seguridad, API ni topología.

---

## Resultado

| Dimensión | Estado |
|---|---|
| Defectos corregidos | **14 de 14** (8 P3 + 6 P4) + **1 hallado en host** (V-07, pestañas comprimidas) |
| Suite completa | **320 / 320 pass** (antes 305) |
| Pruebas del cliente | **46 / 46 pass** (antes 31; +15 regresiones) |
| `tools/check.mjs` | **ok** — 7 herramientas, G3, sin dependencias |
| Hermético | **ok** — el almacén real no cambió (5 ficheros) |
| Red | **0 peticiones** en todo el recorrido (espías de `fetch` a 0) |
| Datos | **fixture** exclusivamente; `DATA_MODE` fijado en código |
| Gates de seguridad | **intactos** (PA01, D-UI-03, G6, Ruta A/B, GAP-20) |

## Qué cambió

**Un solo fichero de producción: `lifecode-rag/client.js`** (1 905 → 2 240 líneas, 769 líneas de diff).
Las pruebas del cliente crecieron de 556 a 745 líneas. No se tocó `package.json`, `index.js`, `lib/**`,
`tools/**`, documentación normativa ni el almacén.

- **Fase A (funcional):** dos claves de traducción que faltaban (`common.yes`, `common.detail` y las nuevas
  de estado/validación), espacio de nombres CSS propio (`lcr-pa-*`, 72 clases), validación de búsqueda
  (vacía, en blanco, >512 caracteres), rechazo de URIs duplicadas con normalización, frontera de error por
  vista con reintento, botón de contexto deshabilitado sin resultados, paginación en la cabecera con
  primera/última, captions accesibles no visibles, títulos coherentes con su colección, relleno real en las
  tarjetas y explicación del estado `degraded`.
- **Fase B (visual):** hoja de estilos propia del panel (deja de heredar `.lcr-*`), cabecera con marca y
  cuatro indicadores de estado veraces (cliente / API / datos / servicio), panel de proyecto con KPIs y dos
  tarjetas, bibliotecas con chips de permiso y almacén, fuentes con contador, paginador en cabecera y URIs
  truncables, búsqueda con formulario destacado en una fila, contexto con métricas y citas, operaciones con
  tarjetas separadas y sello «Simulado», diagnóstico con KPIs + ámbitos + versiones + limitaciones, conexión
  con matriz de estado explícita e historial con estado no disponible intencional y enlace a Operaciones.

## Verificación

- **Pruebas:** 320/320, incluidas 15 regresiones nuevas que fallan si el defecto vuelve (claves crudas,
  clases fuera de `lcr-pa-`, consulta vacía que borra resultados, duplicado de URI, botón de contexto activo,
  paginación sin primera/última, caption visible, título incoherente, pestañas comprimibles).
- **Aislamiento CSS:** prueba estática (la hoja PA no define selectores `.lcr-*` ni usa `!important`) y
  prueba dinámica (toda clase renderizada empieza por `lcr-pa-`, 9 vistas).
- **Responsive medido** en navegador real sobre el render del propio componente: **390, 768, 1024, 1440 px**
  sin desbordamiento horizontal en ninguna de las 10 vistas.
- **Contraste medido** (sRGB convertido con canvas): título 14,5:1; texto secundario 6,19:1; etiquetas 6,19:1;
  tabla 6,19:1; chip de aviso 6,85:1; botón primario **6,87:1** (se corrigió: era 3,22:1).

## Límites que se declaran

- El propietario cargó el panel rediseñado en el host y reportó un defecto que el render libre no mostraba:
  con **altura de slot restringida** la fila de pestañas se comprimía hasta 17 px (sólo la barra de scroll).
  Causa: la raíz no tenía scroll propio y las pestañas eran el único hijo con `min-height` resoluble a 0.
  Corregido en la hoja (`flex: 0 0 auto` en banner/cabecera/pestañas, `flex: 1 0 auto` en el cuerpo y
  `overflow: auto` en la raíz). Medido: **17,25 px → 40 px** con la raíz a altura fija; la raíz pasa a
  desplazarse (933 px de contenido sobre 910 de caja) en vez de recortar. Es el defecto **V-07**.
- Las capturas «después» son un **render estático** del árbol real del componente con su hoja de estilos, a
  ventana fija. **No** son capturas del host: Project y Fuentes están `VERIFIED HOST` sólo por las dos
  capturas del propietario, y el resto de vistas del rediseño sigue `NOT TESTED` en host.
- La captura de «Fuentes» en host corresponde al build **anterior** al arreglo V-07; hace falta recargar el
  plugin (reiniciar Harness) para verlo aplicado. No se reinició: está prohibido en este encargo.
- No hay prueba con lector de pantalla; la accesibilidad se midió por estructura (roles, etiquetas, foco,
  contraste), no por experiencia asistiva real.
- La API Project-Aware sigue **sin montar** y no se ha habilitado nada de datos reales.

## Estado final

```
FUNCTIONAL REMEDIATION: COMPLETED (14/14) · TESTED LOCAL
VISUAL REDESIGN: IMPLEMENTED · TESTED LOCAL (render estático)
HOST VERIFICATION AFTER CHANGE: NOT TESTED
API PROJECT-AWARE: NOT MOUNTED
DATA: FIXTURES ONLY · NETWORK: 0
PA01: BLOCKED · D-UI-03: PENDING HUMAN DECISION · G6: BLOCKED
ROUTE A: BLOCKED · ROUTE B: NOT DEMONSTRATED · ROUTE C: NOT ACCEPTED
```

Parada. No se inicia integración de API ni se solicita autorización implícita.
