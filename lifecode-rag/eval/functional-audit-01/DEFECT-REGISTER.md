# Registro de defectos

**Acto:** `HERMES-LCRAG-FUNCTIONAL-AUDIT-01` · **Fase:** F · **Fecha:** 2026-11-19
**Regla:** ningún defecto se corrige en esta auditoría. Cada ficha lleva reproducción, evidencia y
corrección propuesta. Los defectos funcionales van separados de las observaciones de diseño.

---

## 1. Resumen

| Severidad | Nº | Ids |
|---|---|---|
| P0 (exposición / bypass / destructivo) | **0** | — |
| P1 (función central incorrecta) | **0** | — |
| P2 (flujo importante roto o engañoso) | **0** | — |
| P3 (comportamiento menor o usabilidad) | **8** | FA-01, FA-02, FA-03, FA-05, FA-06, FA-10, FA-12, FA-14 |
| P4 (cosmético, para la fase de diseño) | **6** | FA-04, FA-07, FA-08, FA-09, FA-11, FA-13 |

Ningún defecto compromete datos ni seguridad: el panel no tiene acceso real, y los gates siguen intactos.

---

## 2. P3

### FA-01 · Diagnóstico muestra `common.yes` sin traducir
- **Vista:** Diagnóstico (columna `verified` de la tabla de ámbitos).
- **Reproducción:** abrir LifeCode RAG → pestaña Diagnóstico. Fila `prj_k1fx_01`: la columna `verified` muestra `common.yes`.
- **Esperado:** «Sí».
- **Real:** la clave literal.
- **Evidencia:** `screens/07-diagnostics.png`; el verificador de claves (`132` definidas, `common.yes` **no** entre ellas).
- **Archivos:** `client.js` (`PA_DICT`, `paViewDiagnostics`).
- **Causa:** la clave `common.yes` se usa en el render pero no existe en el diccionario; `paTranslate` cae a la clave.
- **Corrección propuesta:** añadir `common.yes` / `common.no` en ES y EN y usarlas también en el valor negativo.
- **Dependencias:** ninguna.
- **Prueba de regresión:** aserto que compare **todas** las claves usadas con las definidas y falle si falta alguna.

### FA-02 · Cabeceras `common.detail` sin traducir
- **Vistas:** Búsqueda (tabla de resultados) y Operaciones (registro).
- **Reproducción:** buscar cualquier término → la cabecera de la columna de detalle muestra `common.detail`. En Operaciones, tras una ingesta, la cabecera del registro también.
- **Esperado:** «Detalle».
- **Real:** la clave literal.
- **Evidencia:** verificador de claves; latente en las capturas porque no había resultados ni operaciones.
- **Archivos:** `client.js` (`PA_DICT`, `paViewSearch`, `paViewOperations`).
- **Corrección:** añadir `common.detail` (o reutilizar `common.value`).
- **Prueba:** la misma que FA-01.

### FA-03 · El formulario de búsqueda se apila y se alinea a la derecha
- **Vista:** Búsqueda.
- **Reproducción:** abrir la pestaña Búsqueda. El campo de texto, el selector «Resultados» y el botón «Buscar» aparecen apilados en el borde derecho; el ~65 % izquierdo de la tarjeta queda vacío.
- **Esperado:** una fila: campo (flexible) + selector de límite + botón, alineados a la izquierda.
- **Real:** columna, con los controles a la derecha y sin ocupar el ancho.
- **Evidencia:** `screens/04-search.png` y ampliación; comparación de reglas CSS.
- **Causa medida:** colisión de nombre de clase. El CSS heredado del Workspace v0.2 define
  `.lcr-form { display:flex; flex-direction:column; gap:10px }`; el CSS de K1 añade
  `.lcr-form { display:flex; flex-wrap:wrap; align-items:flex-end; gap:8px }`. Al no redefinir
  `flex-direction`, gana `column`, y `align-items:flex-end` alinea los controles al borde derecho.
- **Archivos:** `client.js` (CSS de K1 + `paViewSearch`).
- **Corrección propuesta:** nombres propios para el panel (`lcr-pa-form`, `lcr-pa-field`, `lcr-pa-input`) **o**,
  como mínimo, usar el modificador que ya existe en el CSS heredado: `class="lcr-form lcr-form--inline"`
  (`flex-direction: row; flex-wrap: wrap; align-items: center`).
- **Dependencias:** la fase de rediseño visual.
- **Prueba de regresión:** aserto de que el formulario usa una clase cuyo `flex-direction` resuelto es `row`
  (requiere DOM/CSSOM) o, en su defecto, prueba estática de que no se reutiliza `.lcr-form` sin modificador.

### FA-05 · Búsqueda vacía o de sólo espacios: sin validación y con pérdida de resultados
- **Vista:** Búsqueda.
- **Reproducción:** 1) buscar «normativa» (hay resultados); 2) borrar el texto; 3) pulsar «Buscar».
- **Esperado:** un aviso de validación («escribe algo») y conservar los resultados anteriores.
- **Real:** no se muestra nada y los resultados previos desaparecen.
- **Evidencia:** código del reducer (`paSearchResults` devuelve `null` con texto vacío; el reducer fija
  `results:null` y `notice:null`).
- **Archivos:** `client.js` (`paReduce`, `paSearchResults`, `paViewSearch`).
- **Corrección:** rechazar la consulta vacía con mensaje y no tocar `results`.
- **Prueba:** reducer: `search` con `query:''` mantiene `results` y produce aviso.

### FA-06 · Ingesta con URI duplicada sin aviso
- **Vista:** Operaciones.
- **Reproducción:** ingestar `sintetico/nuevo/acta-de-reunion.md` dos veces.
- **Esperado:** rechazo o marca de duplicado (en un backend real sería un conflicto).
- **Real:** se añade una segunda fuente con la misma URI y distinto id; el registro muestra dos entradas correctas.
- **Evidencia:** `paReduce('ingest')` no comprueba duplicados; el estado resultante tiene dos `uri` iguales.
- **Archivos:** `client.js`.
- **Corrección:** comparar la URI contra `state.sources` y responder con error simulado `duplicate-uri`.
- **Prueba:** reducer: dos ingestas de la misma URI → 1 fuente y aviso de duplicado.

### FA-10 · Sin frontera de error por vista
- **Vista:** todas.
- **Reproducción:** no reproducible hoy (no hay excepción conocida); se deduce del código.
- **Esperado:** un error de una vista se contiene y muestra una tarjeta de error sin tumbar el panel.
- **Real:** no hay `ErrorBoundary`; una excepción durante el render propaga y el host documenta que un slot
  que lanza queda en blanco («slot entry crashed»).
- **Evidencia:** ausencia de componente de frontera en `client.js`; comportamiento del host en su
  documentación de slots.
- **Archivos:** `client.js`.
- **Corrección:** envolver `paRenderView` en una frontera de error que pinte un estado de error de la vista.
- **Prueba:** render de una vista forzada a lanzar → la frontera muestra el error y el resto del panel sigue.

### FA-12 · «Construir contexto» habilitado sin resultados
- **Vista:** Contexto.
- **Reproducción:** abrir Contexto sin haber buscado y pulsar «Construir contexto».
- **Esperado:** botón deshabilitado o aviso claro de que falta una búsqueda.
- **Real:** el botón está habilitado; produce un aviso y el contexto sigue vacío.
- **Evidencia:** `screens/05-context.png` (botón activo con estado vacío) + código.
- **Corrección:** deshabilitar con `disabled={!state.results?.results.length}`.
- **Prueba:** render: sin resultados, el botón tiene `disabled`.

### FA-14 · Paginación de Fuentes: controles fuera del área visible
- **Vista:** Fuentes.
- **Reproducción:** abrir Fuentes con la ventana del tamaño de las capturas.
- **Esperado:** controles «Anterior / Página 1 de 3 / Siguiente» visibles o alcanzables con scroll.
- **Real:** en la captura, la tabla se corta en la fila 9 y los controles no aparecen; no se pudo comprobar
  si el panel hace scroll (`NOT TESTED`: sin acceso al DOM).
- **Evidencia:** `screens/03-sources.png`.
- **Archivos:** `client.js` (CSS de alturas) — **pendiente de confirmar**.
- **Corrección propuesta:** si se confirma el recorte, mover la paginación a la cabecera de la tarjeta o dar
  al cuerpo `max-height` con scroll propio.
- **Prueba:** medición en host (DOM) — no disponible en esta auditoría.

---

## 3. P4 (cosmético / fase de diseño)

| Id | Vista | Descripción | Evidencia | Corrección propuesta |
|---|---|---|---|---|
| FA-04 | Operaciones | `.lcr-error` colisiona con la regla heredada (`display:flex; align-items:center`) y el bloque de error se pinta en fila | CSS heredado línea 681 vs CSS de K1 | renombrar a `lcr-pa-error` |
| FA-07 | Todas las tablas | El `<caption>` repite el título de la tarjeta («Proyectos candidatos», «Fuentes del proyecto», «Bibliotecas autorizadas», «Ámbitos») | 4 capturas | caption sólo para lectores de pantalla (visualmente oculto) o quitar el `<h2>` |
| FA-08 | Diagnóstico | Cabecera `verified` en inglés y valores `no` en minúscula | `screens/07-diagnostics.png` | traducir cabecera y valores |
| FA-09 | Fuentes | El título no concuerda con la colección («Guía de operación» en `normativa`) | `screens/03-sources.png` + generador (8 nombres × 3 colecciones) | derivar el nombre de la colección o desacoplar el título del índice |
| FA-11 | Todas | Las tarjetas no usan `.lcr-card__body`: el contenido va pegado al borde (sin padding) | 4 capturas | envolver el contenido en el cuerpo de la tarjeta |
| FA-13 | Diagnóstico | «Almacenes: degraded» sin decir cuál falla (la tabla lo aclara más abajo) | `screens/07-diagnostics.png` | texto «1 de 3 almacenes no disponible» |

---

## 4. Observaciones (no son defectos)

| Id | Observación | Estado |
|---|---|---|
| O-01 | El panel no muestra estados de carga: los fixtures son síncronos | `NOT APPLICABLE` por diseño, ya declarado |
| O-02 | La versión del anfitrión que muestra Diagnóstico es un dato del fixture, no una lectura del host | Coincide con la real (0.2.2-rc.5) pero no se lee de ella; documentar |
| O-03 | La reindexación muestra «fuentes afectadas» pero no el total de fragmentos | Cobertura funcional incompleta del requisito B6 |
| O-04 | El límite de resultados no se aplica hasta pulsar «Buscar» | Comportamiento de formulario normal |
| O-05 | El registro simulado y el historial real conviven con nombres parecidos | La vista Historial remite a Operaciones; correcto, pero conviene reforzar la distinción en el rediseño |

---

## 5. Qué se corrige antes del rediseño

Los defectos FA-01, FA-02, FA-05, FA-06 y FA-12 son de **comportamiento/texto** y no dependen del diseño:
conviene corregirlos antes o junto con el rediseño. FA-03, FA-04, FA-07, FA-08, FA-09, FA-11 y FA-13 son de
presentación y pertenecen a la fase de rediseño. FA-10 (frontera de error) y FA-14 (paginación) requieren
decisión y medición.
