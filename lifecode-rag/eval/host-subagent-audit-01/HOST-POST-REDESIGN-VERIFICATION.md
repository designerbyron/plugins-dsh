# Verificación del rediseño en el host (post-reinicio)

**Evidencia:** nueve capturas del propietario, tomadas tras reiniciar DeepSeek Harness el 2026-11-19 a las
11:54–11:57, archivadas en `screens-host/`. Host **0.2.2-rc.5**, perfil `desktop`, ventana 1279×821.

## Checklist

| # | Comprobación | Resultado | Estado |
|---|---|---|---|
| 1 | Cliente registrado y fila visible en la barra lateral | «LifeCode RAG» activo en la barra | **VERIFIED HOST** |
| 2 | Panel montado en el slot principal | panel completo con cabecera, banner y pestañas | **VERIFIED HOST** |
| 3 | Navegación: nueve pestañas visibles y operativas | 9 pestañas en una fila, sin recorte; activa resaltada en cada captura | **VERIFIED HOST** |
| 4 | V-01 Proyecto | 4 KPI (3 ámbitos, 2 bibliotecas, 121 fuentes, degraded), tarjeta de proyecto y candidatos | **VERIFIED HOST** |
| 5 | V-02 Bibliotecas | 2 filas, chips `read`/`present`/`missing`, «1 de 2 almacenes no disponible(s)» | **VERIFIED HOST** |
| 6 | V-03 Fuentes | paginador en cabecera (Página 1 de 3 + «/Anterior/Siguiente/»), «Fuentes: 121», tabla con scroll propio | **VERIFIED HOST** |
| 7 | V-05 Búsqueda | formulario en una fila (input + «Resultados 8» + Buscar) | **VERIFIED HOST** |
| 8 | V-06 Contexto | estado vacío + «Construir contexto» deshabilitado | **VERIFIED HOST** |
| 9 | V-07 Operaciones | dos tarjetas con sello «Simulado», «Fuentes afectadas: 121», registro vacío | **VERIFIED HOST** |
| 10 | V-08 Diagnóstico | KPIs, tabla de ámbitos con `Verificado Sí/No`, versiones, nota de fixture, GAP-06/10/07 | **VERIFIED HOST** |
| 11 | V-09 Conexión | chips de estado + kv + causa del `degraded` | **VERIFIED HOST** |
| 12 | V-10 Historial | estado no disponible + enlace «Ver operaciones simuladas» | **VERIFIED HOST** |
| 13 | Ausencia de errores visibles | ninguna caja de error, ningún texto crudo de clave, banner intacto | **VERIFIED HOST (visual)** |
| 14 | Consola del navegador | no inspeccionada | **NOT TESTED** |
| 15 | DOM (duplicados, listeners, `.lcr-pa-root` único) | no inspeccionado | **NOT TESTED** |
| 16 | Desmontaje / cambio de workspace o sesión | no observado | **NOT TESTED** |
| 17 | API Project-Aware | «no montada» en Conexión; coherente con `index.js` | **VERIFIED HOST (declarado por la UI)** |

## Coherencia con el render local

| Aspecto | Render local (1280) | Host (panel ~960) | Diferencia |
|---|---|---|---|
| Cabecera y cuatro chips | presentes | presentes | idéntica |
| Banner sintético | una línea | una línea | idéntica |
| Rejilla de pestañas | una fila | una fila, sin scroll | idéntica |
| Proyecto: KPIs + split | sí | sí, split 2 columnas | idéntica |
| Fuentes: paginador en cabecera | sí | sí | idéntica |
| Fuentes: filas visibles | 9 con tope 540 px | 8 con scrollbar interno | esperado por ancho menor |
| Búsqueda: formulario en fila | sí | sí | input algo más estrecho por el ancho del panel |
| Diagnóstico: split | sí | sí | idéntica |
| Colores y contraste | tokens oscuros | tokens del host | coherente |

**Conclusión:** el diseño se comporta como en el render, con las diferencias esperables de ancho. No aparece
ninguno de los defectos corregidos (pestañas comprimidas, formulario apilado, claves crudas, caption visible,
paginador fuera de vista).

## Lo que estas capturas no demuestran

- Que no haya errores en consola o un segundo `role="status"`: hace falta abrir DevTools (**NOT TESTED**).
- Que el panel se desmonte sin residuos al cambiar de sesión (**NOT TESTED**).
- Que V-04 (detalle de fuente) se vea bien en host: no fue capturada (**TESTED LOCAL** por render).
- Que el comportamiento sea correcto a otros anchos del panel: sólo se observó ~960 px.

## Consecuencia para la clasificación

El rediseño pasa de `TESTED LOCAL` a **`VERIFIED HOST` en las nueve secciones capturadas**. La verificación en
host del **detalle de fuente**, de la consola y del DOM sigue pendiente y así se declara.
