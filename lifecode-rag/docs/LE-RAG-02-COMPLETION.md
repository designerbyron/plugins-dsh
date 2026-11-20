# LE-RAG-02 · Completitud e independencia

Continuación de LE-RAG-01 sobre la copia aislada `C:\xampp\htdocs\plugins-dhs-le-rag-01`.
El worktree original (`plugins-dhs`) permanece intacto: los 130 ficheros de su manifiesto siguen
idénticos a `BASELINE-ORIGEN.sha256`.

## 1 · Configuración

Cadena única: `<dataRoot>/config.json` (global) → `<dataRoot>/profiles/<key>/config.json` (perfil) →
defaults, **fusión por clave**, **una validación** (`validateConfig`), **fail closed** (fichero inválido →
`invalid-config` con ruta). Raíz y perfil se pueden fijar con `LIFECODE_RAG_DATA` / `LIFECODE_RAG_PROFILE`;
sin ellas se conserva la ruta histórica del host.

| Consumidor | Estado |
|---|---|
| `index.js` (plugin) | **integrado** — `resolveConfig()` |
| `lib/tools.mjs` (7 herramientas) | **integrado** — default `effectiveConfig()` |
| `lib/diagnose.mjs` | **integrado** — informa `profile.config.effectiveSearch` |
| `lib/doctor.mjs` | **integrado** — resuelve sobre el `root` que recibe (la CLI le pasa `ragRoot`) |
| `bin` → `doctor` | hereda el anterior |
| `bin` → `audit` | sin cambios (opera sobre el almacén legacy) |
| `lib/readmodel.mjs`, `lib/server.mjs` | sin cambios — **API v0.2 legacy**, con su propio `config.json` y sus escrituras |
| `lib/automation.mjs`, `lib/sync-scheduler.mjs` | sin cambios — reciben un `root` explícito (perfil) y leen su `config.json`; no aplican la herencia global |

Pruebas: `tests/config-resolve.test.mjs` (7) y `tests/config-consumers.test.mjs` (3). La segunda
comprueba dos perfiles (`desktop` = `fragment`, `laboratory` = `source`), herencia de la global, defaults,
aislamiento (cambiar un perfil no toca al otro) y paridad entre resolvedor, diagnóstico y doctor.

## 2 · Zero Harness Dependencies

- El core (`lib/**`) no importa `@deepseek-ai/*`, `cordis` ni APIs del host; lo verifica `tools/check.mjs`
  (gate existente, en verde) además de la revisión manual de imports estáticos/dinámicos.
- La raíz de datos es propia (`LIFECODE_RAG_DATA`), no derivada del home del Harness.
- Los tests crean sus propias cajas temporales; no instalan ni ejecutan DSH.
- Frontera: `index.js` (traduce `ctx` → servicios) y `client.js` (interfaz). Sin ellos el motor, la CLI y
  la persistencia siguen funcionando.
- **No** se ha añadido un gate nuevo: el existente cubre la prohibición de dependencias del host.

## 3 · Auditoría externa (`mervyn-teo/dsh-plugin-rag`, `fe34239…`, MIT)

Leídos en esta fase: `lib/index.js` (completo, descargado) y `lib/client.js` (descargado). Confirmado en
`lib/index.js`: suscripción a eventos de sesión con cola y *debounce*, `flushNow`, cursor por sesión,
`removeBySeq` para contenido reemplazado, bandera `disposed` para el desmontaje, registro de la herramienta
`rag_search` y rutas HTTP de estado/configuración. Clasificación sin cambios respecto a LE-RAG-01:
patrones **A** (extracción por evento, cursor, baja por secuencia, escritura atómica, embeddings por
`fetch` con reintentos) adoptables en el core; **B** (suscripciones, patch de Cordis) en adaptador;
**C** (panel y ajustes del host) específico; **D** (JSON único con fuerza bruta, reconstrucción total por
cambio de modelo) rechazado. No se copió código.

## 4 · Perfiles

`tests/config-consumers.test.mjs` cubre: configuración independiente, precedencia, herencia, defaults,
ausencia de contaminación, recarga tras reescribir un perfil y coherencia con el diagnóstico. Todo sobre
`dataRoot` temporales; el home real de DSH no se toca.

## 5 · Memoria conversacional

Defectos corregidos en esta fase:

1. **`replace` reordenaba el historial** — ahora conserva la secuencia original del evento.
2. **`append` con el mismo `eventId` y otro contenido se aceptaba en silencio** — ahora exige `replace`
   (`invalid-argument`).

Cubiertos con pruebas: idempotencia, cursor por conversación, eventos tardíos, cursor por delante del
contenido (no inventa), `delete` + replay, duplicados, conflictos de secuencia y conversaciones mezcladas
(`tests/conversation-events-edge.test.mjs`, 7). La reducción es pura: un reinicio a mitad de operación no
deja estado a medias; la concurrencia se resuelve en el adaptador con `sequence` + `sequence-conflict`.

## 6 · Benchmarks (`bench/bench.mjs`, `bench/last-run.json`)

Fixtures sintéticos (30 fuentes × 10 fragmentos = 300), `record:false`, 5 de calentamiento + 30 medidas.
Node v24.21.0 · win32 · 16 CPU.

| Medida | p50 (ms) | p95 (ms) |
|---|---|---|
| FTS léxico | 0,306 | 0,462 |
| Híbrido `fragment` | 0,464 | 0,850 |
| Híbrido `source` | 0,443 | 0,741 |
| Resolución de configuración | 0,046 | 0,073 |
| Reducción de 100 eventos | 0,036 | 0,132 |

Sin datos reales. No se midió memoria ni tamaño en disco; no se introdujo ninguna optimización.

## 7 · Suite

**388/388 pass · 0 fail · 0 skipped · 0 todo** (363 base + 25 nuevas). `tools/check.mjs` en verde.
`tools/hermetic.mjs`: «el almacén real no cambió (3 fichero(s))».

## 8 · Límites declarados

- `automation`/`sync-scheduler` no heredan la configuración global (leen el `root` que reciben).
- La API v0.2 (`server`/`readmodel`) mantiene su configuración legacy y sus escrituras.
- Benchmarks sólo sintéticos; sin copia del almacén de 964 fragmentos en esta pasada.
- Sin prueba con el modelo real, sin integración de memoria real, sin cambios en el repositorio original.
