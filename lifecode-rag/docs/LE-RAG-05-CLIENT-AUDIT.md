# LE-RAG-05 · Auditoría de `lib/client.js` (341 líneas, leído completo)

Commit `fe3423967755823f8773b0f0da39034dde0c5472` · MIT · sin copiar código.

## 1 · Estructura e importaciones

`window.__ModuleLoader__.load({id:'dsh-plugin-rag', factory})` (l. 4-341) → **bundle de cliente del host**,
no un módulo Node. Único `require`: `react` (l. 11), servido por el host. **Cero** imports de `@deepseek-ai/*`
ni de Cordis: toda la integración ocurre por el contrato del *module loader* y por `ctx`.

CSS propio en l. 14-42, inyectado una sola vez en l. 43-51 (id `dsh-plugin-rag/styles`). Usa tokens del tema
del host (`--dsw-alias-*`), no variables propias.

## 2 · Eventos

No consume ni produce eventos. Es una tarjeta de ajustes: no hay suscripción a sesiones, ni cursores, ni
secuencias. **Punto 6 de la misión (cursores, replace, delete) no aplica a este archivo**: la captura de
eventos vive en el lado servidor (`lib/index.js`).

## 3 · HTTP

| Función | Método | Ruta | Cuerpo | Línea |
|---|---|---|---|---|
| `apiGetConfig` | GET | `/api/rag/config` | — | 117 |
| `apiSetConfig` | POST | `/api/rag/config` | objeto completo (enabled, provider, model, endpoint, topK, dataDir, includeToolResults, includeReasoning, maxChunkChars) | 118-124 |
| `apiReindex` | POST | `/api/rag/reindex` | — | 125-127 |

Cabeceras: sólo `Content-Type: application/json`. **Sin timeout, sin `AbortController`, sin reintentos.**
`apiGetConfig` y `apiSetConfig` hacen `.then(r => r.json())` **sin comprobar `r.ok`**: un 401/500 con cuerpo
JSON se trata como configuración válida. `reindex` sí mira `r.ok` **del cuerpo** (l. 195).

## 4 · Ciclo de vida

- `inject = ['slots','locale']` (l. 320).
- `ctx.effect(() => ctx.locale.register(...))` (l. 323) — el disposer lo gestiona el host.
- `ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({name, id:'rag', key:'rag', order:100, locale:NS}, ConfigCard))` (l. 329-334). La `key` debe coincidir con el namespace de ajustes que registra `lib/index.js`; sin ella la tarjeta no se pinta (comentario l. 325-328).
- `exports.apply` / `exports.inject` (l. 337-338). No hay `dispose` propio.

## 5 · Estado, concurrencia y cancelación

Cinco `useState` (l. 132-141): `open`, `state`, `msg`, `dirty`, `busy`. Carga al montar (l. 161-165);
`reload` (167-169); `save` (171-188); `reindex` (190-197); `set` marca `dirty` (206-209).

- Sin debounce ni cola: cada pulsación es un POST inmediato.
- `busy` sólo deshabilita **reindex** (l. 311); **Guardar** sigue activo (l. 313) → doble guardado posible.
- Sin cancelación al desmontar: un `fetch` en vuelo resolverá `setState` sobre un componente desmontado.
- Guardado = **reemplazo completo** del objeto de configuración, sin versión ni ETag → *last-write-wins*
  entre dos ventanas abiertas.

## 6 · Reintentos y errores

`save` → `.catch` muestra `card.saveFailed` (l. 187). `reload` → `.catch(function(){})` **silencioso** (l. 168):
un fallo de red al recargar no informa de nada. `reindex` → mensaje concatenado en inglés (l. 195-196), fuera
del sistema de i18n.

## 7 · Configuración, rutas, workspace y sesión

La tarjeta lee y escribe configuración por HTTP; no resuelve rutas ni conoce workspace ni sesión. `dataDir`
se muestra (l. 242) y **se envía en el POST** (l. 178): si el servidor confiara en ese valor sin validar,
la UI podría redirigir el almacén. La validación debe estar (y está, en nuestro caso) en el servidor.

## 8 · Secretos y aislamiento entre proyectos

La credencial es **sólo lectura**: se muestra `credentialRef` y si resuelve (`apiKeySet`), sin ningún campo
donde escribirla (l. 288-293). No hay token en el payload ni en el DOM. No hay datos de proyecto en la tarjeta
más allá de las estadísticas del índice (conteos, modelo, dimensión, `dataDir`).

## 9 · Clasificación

| Elemento | Clase |
|---|---|
| `window.__ModuleLoader__`, `require('react')` | **C** · contrato del Harness |
| `ctx.slots` / `ctx.locale` / `ctx.effect` | **C** · API del Harness |
| `settings.plugin.item` con `key:'rag'` | **C** · slot del Harness |
| Tokens CSS `--dsw-alias-*` | **C** · tema del Harness |
| Rutas `/api/rag/*` | **C** · API de su propio plugin |
| `dataDir` editable en el cliente | **Riesgo** (depende de validación del servidor) |
| Ausencia de comprobación de estado HTTP | **Riesgo** |
| Guardado sin versión | **Riesgo** |
| `Number()` sin validación (l. 177, 181) | **Riesgo menor** |

**Acoplamiento innecesario:** ninguno. No hay abstracción que sobre.

## 10 · Defectos y riesgos (ninguno bloqueante para nosotros)

- **F-1** · `apiGetConfig` no comprueba `r.ok`: un error con cuerpo JSON deja la tarjeta en estado «listo»
  con campos vacíos; un guardado posterior enviaría una configuración vacía. **Severidad media en su plugin.**
- **F-2** · Sin timeout ni abort: un `fetch` colgado deja la tarjeta en «…» indefinidamente.
- **F-3** · `dataDir` viaja en el POST; la seguridad depende por completo del servidor.
- **F-4** · `busy` no bloquea Guardar; sin versión, dos ventanas se pisan.
- **F-5** · `Number('')` → 0 y `Number('abc')` → `NaN` → `null` en JSON.
- **F-6** · Mensajes de error sin i18n (l. 195-196).

Ninguno afecta a LifeCode RAG: no compartimos su cliente y nuestro panel valida en el servidor, usa
`DATA_MODE='fixture'` mientras no haya transporte real y no guarda credenciales en la interfaz.

## Conclusión

`lib/client.js` es **adaptador puro del Harness**: no contiene lógica de recuperación, indexación ni
persistencia, y no exporta nada reutilizable para el core. La auditoría cierra el punto 3 de LE-RAG-01/02.
