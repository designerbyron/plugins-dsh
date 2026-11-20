# LE-RAG-04 · Decisiones y especificación multi-Harness

## ADR-01 · Configuración efectiva en los trabajadores

**Problema.** Sustituir `loadConfig(root)` por `workerConfig()` en `sync-scheduler` y `automation` hacía
fallar siete pruebas del programador.

**Causa raíz (medida).** `lib/sync-scheduler.mjs` importa `profileKey` de `./profile.mjs` (una función) y
la invoca en `runOnce()` (`profileKey: profileKey(env)`). El parámetro nuevo `profileKey` **sombreaba** esa
función: `TypeError: profileKey is not a function` en la línea 164. No era un problema de resolución ni de
orden de inicialización.

**Alternativas evaluadas.** (a) renombrar el parámetro; (b) eliminar el parámetro y dejar que el contexto
resuelva la clave desde `env`; (c) un contexto inmutable por trabajador.

**Decisión.** (b) + contexto explícito `{ config, dataRoot, root, env }` en `lib/worker-context.mjs`, con
tres niveles: config inyectada → `dataRoot` + perfil (resolvedor único) → `root/config.json` histórico.

**Consecuencias.** Los trabajadores aceptan configuración efectiva sin depender de `.dsh` y sin romper su
contrato; el camino histórico sigue siendo el de por defecto. `profileKey` se resuelve dentro del contexto
(desde `env`), nunca como parámetro que pueda colisionar con un import.

**Pruebas.** `tests/worker-context.test.mjs` (5): niveles, inyección en el scheduler (status refleja el
intervalo inyectado y `stop()` cierra el temporizador), y `automation` por `dataRoot`, por `root` y por
config inyectada. Suite histórica del programador: 13/13.

## ADR-02 · Configuración de la API v0.2

**Problema.** `server.mjs` y `readmodel.mjs` operan con su propia raíz y escriben configuración en ella.

**Decisión.** Se mantiene su contrato: la API v0.2 lee y escribe **su** `config.json` (raíz legacy). No se
le aplica el resolvedor de perfiles porque sus escrituras cambiarían de destino (riesgo de escribir en el
archivo equivocado). La separación queda explícita: configuración global, configuración de perfil,
configuración de la API (legacy), configuración de trabajadores (ADR-01), y datos.

**Consecuencias.** El panel no puede escribir en el archivo global por accidente: escribe en la raíz que
recibe. Ninguna ruta de la API toca `profiles/<key>/config.json`.

## ADR-03 · Ingesta en pruebas sobre copia

**Problema.** Al ingerir un fixture **dentro** de la copia del perfil, el motor lo rechaza con
`path-denied` («la ruta pertenece al propio almacén»).

**Decisión.** El rechazo es correcto y se conserva: un fixture vive **fuera** del almacén (directorio
temporal) y la ingesta escribe en la copia. No se relaja la política para las pruebas.

## Especificación multi-Harness

### Contratos necesarios

| Contrato | Estado | Responsabilidad |
|---|---|---|
| `ConversationEvent` | **implementado** | unidad mínima: `eventId`, `conversationId`, `sequence`, `role`, `content`, `timestamp`, `metadata`, `operation` |
| `ConversationSource` | **especificado** | entrega eventos al core; declara `conversationId` y la secuencia monótona |
| `SessionEventSource` | **especificado** | suscripción a los eventos de una sesión del host; traduce a `ConversationEvent` |
| `WorkspaceContextProvider` | **no necesario hoy** | el core ya recibe `workingDirectory` y la raíz explícitos |
| `ToolRegistrar` | **no necesario hoy** | el adaptador registra las definiciones; el core no conoce el registro |
| `LifecycleProvider` | **no necesario hoy** | los trabajadores reciben temporizador y señales por parámetro |

Evitar los tres últimos evita abstracciones prematuras: hoy no resuelven ningún acoplamiento real.

### Reglas del contrato de eventos

- Roles indexables: `user`, `assistant`, `tool`. Rechazados: `system`, `reasoning`, `developer`.
- `eventId` es la identidad; repetir el mismo evento con el mismo contenido es un no-op.
- `sequence` es monótona por conversación; dos `eventId` distintos con la misma secuencia →
  `sequence-conflict`.
- `cursor` = última secuencia aplicada. Reanudar con él no reprocesa ni devuelve lo anterior.
- `replace` cambia contenido y **conserva la secuencia** del evento original; sobre un evento desconocido
  falla (`invalid-argument`).
- `delete` vacía el contenido y elimina el mensaje; un replay con cursor anterior vuelve a aplicarlo sin
  resucitar nada.
- Compactación: `replace`/`delete` según lo que el host declare; el core no deduce compactaciones.
- Retención: `maxEvents` recorta por la cola (los más recientes).
- Privacidad: `metadata` descarta claves con pinta de secreto; el razonamiento interno no entra.
- Errores estables: `invalid-argument`, `sequence-conflict`, `invalid-config`.

### Responsabilidades

- **Adaptador:** suscribirse al host, filtrar eventos, traducir a `ConversationEvent`, persistir el cursor
  del host, decidir cuándo compactar, aportar `workingDirectory` y aprobaciones.
- **Core:** reducir eventos, mantener el cursor propio, garantizar idempotencia y orden, y nunca importar
  APIs del host.

## Validación de las siete herramientas (copia del perfil real)

| Herramienta | Resultado |
|---|---|
| `list` | 121 fuentes, primera página de 5 |
| `search` | 5 resultados, 4 fuentes |
| `context` | 6 citas, 1 775 tokens |
| `get` | 10 fragmentos del documento pedido |
| `ingest` | 1 fuente, 1 fragmento, 0 errores (fixture fuera del almacén) |
| `ingest` duplicado | omitida, motivo `unchanged` |
| `reindex` | `rebuiltChunks` |
| `forget` | fuente borrada; ya no aparece en `search` |
| `get` inexistente | `source-not-found` |
| sesión desconocida | autorizada por el `cwd` del proyecto (modelo documentado: la sesión desambigua, el trust es por proyecto) |
| auditoría | 145 → 149 filas (4 operaciones registradas) |

Escrituras sólo en la copia. El almacén real conserva su hash (`4dcf31c4…`).
