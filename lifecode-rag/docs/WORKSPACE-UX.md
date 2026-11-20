# LifeCode RAG — Workspace UX

**Fecha:** 2026-11-17 · **Estado:** diseño propuesto (sin UI implementada)
**Pestaña nativa:** `sidebar.panellist` id `lifecode-rag` → panel `main` clave `lifecode-rag`

---

## 1. Viabilidad nativa (evidencia, no suposición)

El host expone un slot de lista `sidebar.panellist` cuyo catálogo dice textualmente:

> «Global panel icons. Each list id addresses the matching main panel; the sidebar owns the button and
> resolves its label from list metadata.»

y un slot `main` de tipo keyed cuyo catálogo admite «any string the owner dispatches», con el valor
`conversation` ya tomado. LifeCode Skill Center ocupa exactamente ese par (`client.js:9148-9161`):
registra su icono en `sidebar.panellist` con `id = PANEL_ID` y el panel en `main` con `key = PANEL_ID`.
Por tanto **una pestaña nativa es posible sin WebView, sin iframe y sin tocar el perfil**: es el mismo
contrato que ya usa un plugin instalado y funcionando.

El icono recibe `{size, active}` del owner; el panel no recibe props de sesión (`scope: root`), así que
toda la data llega por HTTP. Esto es deliberado: el Workspace debe funcionar sin sesión abierta.

## 2. Lenguaje visual

Hereda la línea de LifeCode Skill Center, con estas reglas ya pagadas en ese proyecto:

- **Texto hereda el color**; el acento solo pinta marca, gráficos y estados. Nada de acentos en texto.
- **Tintes y bordes derivados** con `color-mix(in oklab, …)` del token del host.
- **Contenedores con tokens** `--dsw-alias-bg-layer-1/2`, `--dsw-alias-border-l1/l2`, texto
  `--dsw-alias-label-primary/secondary`. Nada de colores fijos en superficies.
- **Prefijo propio `lcr-`**; jamás se reutilizan clases del host ni se leen sus hojas.
- **SVG en línea, `aria-hidden`**; cero emoji.
- **Una sola región viva** por vista (resumen), atómica, con la frase completa.
- **Estilos en el árbol** de React, no en `document.head`; `forced-colors: active` respetado.
- **Idioma** por `ctx.locale` con diccionario es/en y reserva local; nunca una clave cruda.
- Movimiento: solo el indicador de carga; `prefers-reduced-motion` lo apaga.

Reutilizar el *estilo* no es reutilizar *código*: no se importa nada de `lifecode-skill-center`.

## 3. Información y navegación

Una barra superior fija (estado + acciones) y seis secciones en tabs internas. Las tabs no son rutas
del host: se recuerda la última en `sessionStorage` (no en el estado del motor).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ LifeCode RAG        ● Operativo   Local only   1.240 chunks · 38 fuentes     │
│                                    [Actualizar] [Diagnóstico]                │
├──────────────────────────────────────────────────────────────────────────────┤
│ Resumen │ Conocimiento │ Laboratorio │ Analítica │ Configuración │ Salud      │
├──────────────────────────────────────────────────────────────────────────────┤
│  (contenido de la sección)                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Resumen

Objetivo: responder en 5 segundos «¿está vivo y sirve?».

- **Franja de estado**: operativo / degradado / detenido, con la causa en una línea.
- **Cuatro cifras reales**: fuentes, chunks, consultas de agente (periodo), contextos construidos.
  Cada cifra con su fuente (`medido`/`derivado`) y su ventana temporal.
- **Ahorro de contexto** del periodo: tokens servidos vs tokens del corpus completo, con la fórmula
  visible al pasar el cursor y una nota de que es estimación (`ceil(chars/4)`).
- **Últimas 8 actividades** (ingesta, reindex, forget, error) enlazadas a su detalle.
- **Proveedores**: embeddings activos, dimensión, estado; si no hay semántico, se dice «léxico».
- **Consulta sin resultados** del periodo, como aviso accionable (lleva al Laboratorio).

Sin gráficos en esta sección: un gráfico decorativo aquí es ruido.

### 3.2 Conocimiento

- Tabla paginada (50/página) con: título, URI (recortada con `title` completo), colección, etiquetas,
  chunks, tamaño, `indexed_at`, digest (8 chars + copiar).
- Filtros: colección, etiqueta, texto (sobre título/URI, no sobre contenido), rango de fecha.
- Fila expandible: chunks con ordinal, encabezado, offsets y un botón «ver texto» (bajo demanda).
- Acciones por fila: **Reindexar** (confirmación) y **Olvidar** (aprobación humana). La confirmación
  muestra el alcance exacto (`sourceId`, URI, nº de chunks) y nunca un «sí a todo».
- Estado vacío: explica cómo ingerir (comando/tool) y enlaza a Configuración.
- Estado de error: tarjeta con código `RagError` y «Reintentar», sin volcar stack.

### 3.3 Laboratorio de recuperación

Separado visualmente del uso real (banner «Entorno de prueba»).

- Campo de consulta + filtros (colección, etiquetas, K, estrategia).
- Comparación en columnas: **BM25**, **Vectorial**, **Híbrida**. Cada columna con su latencia.
- Resultado por fila: rank, título, encabezado, snippet resaltado, puntuaciones (`bm25`, `coseno`, `rrf`).
- Panel de contexto: texto que se serviría al modelo, tokens, truncado sí/no, citas `[n]`.
- «Verificar cita»: abre el chunk original y resalta `charStart..charEnd`.
- Las consultas del Laboratorio **no** cuentan como uso de agente y no se persisten como texto.

### 3.4 Analítica e impacto

Cada tarjeta declara definición, fuente y método. Nunca datos sintéticos presentados como reales.

- Consultas por día (barras), serie de 30 días, con selector 7/30/90.
- Tasa de consultas sin resultados y su evolución.
- Colecciones y fuentes más recuperadas (top 10, con «otras»).
- Latencia p50/p95 por estrategia.
- Calidad de recuperación: solo si existe una ejecución de evaluación registrada; si no, estado vacío
  «sin evaluación» en lugar de un cero engañoso.
- Eficiencia: tokens de contexto vs corpus, media y p95; ahorro estimado con nota metodológica.

### 3.5 Configuración

Controles con estado real y validación en el servidor. Cada uno: etiqueta, descripción de una línea,
valor actual, «disponible / no disponible en esta versión» y qué requiere para activarse.

| Control | Tipo | Efecto | Disponibilidad v0.2 |
|---|---|---|---|
| RAG habilitado | interruptor | tools responden o `store-not-initialized` | sí |
| Recuperación híbrida | interruptor | RRF vs solo FTS | sí |
| Búsqueda semántica | interruptor | requiere proveedor | no, hasta proveedor evaluado |
| Citas en contexto | interruptor | incluye bloque de citas | sí |
| Optimización de contexto (MMR) | interruptor | λ configurable | sí |
| Solo local | candado | impide proveedores remotos | sí (siempre visible) |
| Indexación automática | interruptor + raíces | políticas de escaneo | propuesto |
| Analítica de uso | interruptor | métricas agregadas on/off | sí |
| Presupuesto de contexto | número | 200–8000 tokens | sí |

Cambios sensibles (raíces, proveedor, desactivar analítica) piden confirmación; ninguno borra datos.

### 3.6 Salud

Orden: anomalías primero. Cada chequeo con nombre, estado (`ok`/`warn`/`fail`), evidencia y acción.

- SQLite: apertura, `quick_check`, `application_id`, versión de esquema.
- FTS5: integridad del índice externo y cobertura (chunks vs filas FTS).
- Vectores: cobertura por modelo (`vector-index-incomplete` si falta).
- Auditoría: cadena válida, secuencia exportada vs cabeza, JSONL derivado (regenerable).
- Indexación: última ejecución, errores por fichero, raíces no disponibles.
- Proveedores: determinismo del embedder local; remoto no configurado.
- Botón «Diagnóstico completo» = `runDoctor` + verificación FTS + auditoría, con salida copiable.

## 4. Estados obligatorios por vista

| Estado | Tratamiento |
|---|---|
| Cargando | esqueleto con la forma del contenido, sin spinner de pantalla completa |
| Vacío | explica qué falta y la acción concreta que lo resuelve |
| Error de red | tarjeta con «Reintentar» y código; no se pierde el último dato bueno |
| Error del motor | código `RagError` + mensaje; acciones peligrosas deshabilitadas |
| Datos parciales | banner «datos de hace X» con instante de la última lectura correcta |
| Sin permiso | la sección se muestra, las acciones se explican y quedan deshabilitadas |
| Degradado | estado global ámbar con causa (p. ej. FTS reconstruible) |

## 5. Rendimiento, frescura y ciclo de vida del panel

### 5.1 Señal verificada

El host inyecta `usePanelInfo` como prop estándar del slot `main` (`dsh-client-ui-layout`,
`src/client/service.ts`):

```ts
export interface PanelInfo { readonly activePanelId: MainPanelId | null } // null = Conversación
export interface ILayout { readonly panelInfo: HostObservable<PanelInfo> /* … */ }
```

y `usePanelInfo(info => info.activePanelId === 'lifecode-rag')` suscribe **independientemente del padre**.
Esa es la señal de panel activo; no se usa `document.visibilityState` como sustituto. La visibilidad de la
ventana solo distingue minimizada/oculta.

### 5.2 Comportamiento por estado

| Estado | Comportamiento |
|---|---|
| Workspace activo (`activePanelId === 'lifecode-rag'`), DSH visible | refresco cada 30 s si hubo actividad (ETag/`updatedAt`) |
| Workspace inactivo (otro panel, DSH visible) | **cero polling**: el intervalo se detiene |
| Ventana minimizada/oculta | **cero polling**, aunque el panel siga seleccionado |
| Workspace vuelve a activarse | un refresco inmediato; se deduplica si ya hay uno en vuelo |
| Panel desmontado | `useEffect` limpia intervalo, `AbortController`, listeners y SVG; `usePanelInfo` se desuscribe |

Implementación prevista: un solo `useEffect` que combina `active` (hook) y `document.visibilityState`, con
un `AbortController` y una bandera `inFlight`; `setInterval` se crea solo cuando `active && visible`, y el
callback comprueba la bandera antes de pedir.

### 5.3 Reglas de datos

- Snapshot al abrir, al volver a ser activo y cada 30 s solo en las condiciones de §5.2.
- Cambiar de sección no vuelve a pedir lo que ya está fresco (< 15 s).
- Tablas paginadas en servidor; listas largas virtualizadas si superan 200 filas.
- Gráficos solo en Analítica y bajo demanda; SVG propio (sin librería nueva).
- Cerrar la pestaña o cambiar de panel no interrumpe ninguna operación del motor: la UI no posee trabajos.
- Si la UI falla, las siete tools siguen funcionando (frontera de error + cero acoplamiento).

## 6. Accesibilidad

- Navegación por teclado completa; foco visible en cada control.
- Tabs con `role="tablist"`, `aria-selected`, flechas izquierda/derecha.
- Tablas con `caption` y encabezados `th scope="col"`; cifras con unidad y contexto.
- Contraste: texto siempre por token; acento solo en marca/estado, con 3:1 mínimo.
- `prefers-reduced-motion` y `forced-colors`.
- Mensajes de error asociados al control (`aria-describedby`), no solo un toast.

## 7. Qué no hará el Workspace

- No muestra prompts, respuestas del modelo ni conversaciones.
- No presenta métricas inventadas ni ceros cuando no hay datos: dice «sin datos».
- No permite aprobar desde la UI en nombre del modelo: la aprobación sigue siendo del host.
- No escribe SQL ni conoce el esquema; si el read model no lo expone, la UI no lo muestra.
- No descarga modelos, no abre red y no instala nada.
