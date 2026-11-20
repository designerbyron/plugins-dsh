# LifeCode RAG — Workspace API v1

**Fecha:** 2026-11-17 · **Estado:** contrato propuesto (no implementado)
**Transporte:** `ctx.webServer.register({ kind: 'prefix', path: '/lifecode-rag/api/v1', handler })`
**Ámbito:** solo `127.0.0.1` (el host sirve la UI en loopback)

---

## 1. Reglas generales

- JSON UTF-8, `Content-Type: application/json; charset=utf-8`.
- Respuesta de error uniforme:

```json
{ "error": { "code": "invalid-argument", "message": "limit debe ser un entero entre 1 y 100", "details": { "field": "limit" } } }
```

- Códigos HTTP: `200` éxito, `400` entrada inválida, `404` recurso inexistente, `405` método no permitido,
  `409` conflicto de estado (p. ej. reindex en curso), `423` almacén bloqueado, `500` fallo interno con
  código `internal` (nunca stack ni rutas absolutas).
- **Sin autenticación de red**: la defensa es el bind de loopback del host. Aun así:
  - solo se aceptan peticiones con `Host` de loopback (`127.0.0.1`, `localhost`, `[::1]`);
  - los `POST` exigen `Content-Type: application/json` y la cabecera `x-lifecode-rag: 1`
    (un formulario cross-origin no puede enviar cabeceras personalizadas sin preflight);
  - no hay CORS: el navegador no recibe `Access-Control-Allow-Origin`;
  - la API no acepta cookies ni tokens en query.
- Límites: cuerpo ≤ 64 KiB; `limit` ≤ 100 (por defecto 50); profundidad de filtros fija.
- Sin paginación implícita: toda lista trae `{ items, total, limit, offset, hasMore }`.
- `ETag` en `GET /snapshot`, `GET /sources`, `GET /health`; `If-None-Match` → `304`.
- Cada respuesta incluye `x-lifecode-rag-version` (semver del plugin) y `x-lifecode-rag-api: v1`.

## 2. Superficie

| Método | Ruta | Propósito | Escritura |
|---|---|---|---|
| GET | `/health` | Liveness + versión + modo | no |
| GET | `/capabilities` | Handshake: rutas, límites, capacidades | no |
| GET | `/snapshot` | Agregado para Resumen y cabecera | no |
| GET | `/sources` | Lista paginada de fuentes | no |
| GET | `/sources/:id` | Detalle de fuente + chunks paginados | no |
| GET | `/sources/:id/chunks/:ordinal` | Un chunk (texto bajo demanda) | no |
| GET | `/metrics/summary?from&to` | Cifras del periodo | no |
| GET | `/metrics/series?metric&from&to&bucket` | Serie temporal | no |
| GET | `/activity?limit&before` | Actividad reciente | no |
| GET | `/config` | Configuración efectiva (sin secretos) | no |
| GET | `/health/checks` | Diagnóstico detallado | no |
| POST | `/retrieval` | Consulta del Laboratorio (no persiste texto) | no |
| POST | `/actions` | Acción con política/aprobación | sí |
| POST | `/config` | Cambio de configuración validado | sí |

No existe endpoint de SQL, de exportación masiva ni de lectura de `audit.jsonl` por HTTP.

## 3. Esquemas

### 3.1 `GET /snapshot`

```json
{
  "generatedAt": "2026-11-17T18:00:00.000Z",
  "engine": { "state": "operational", "reason": null, "version": "0.2.0", "schemaVersion": 2 },
  "counts": { "sources": 38, "chunks": 1240, "vectors": 1240, "collections": 4, "tags": 11 },
  "lastIndexedAt": "2026-11-17T17:42:11.000Z",
  "embedders": [{ "id": "local-hash-v1", "dim": 256, "kind": "local", "coverage": 1 }],
  "window": { "from": "2026-11-10T00:00:00.000Z", "to": "2026-11-17T18:00:00.000Z" },
  "usage": { "agentQueries": 42, "contexts": 12, "zeroResults": 3 },
  "context": { "tokensServed": 18450, "corpusTokens": 141300, "savingRatio": 0.869, "method": "estimate:ceil(chars/4)" },
  "activity": [
    { "at": "2026-11-17T17:42:11.000Z", "eventId": "e7", "action": "ingest", "target": "src_ab12", "outcome": "ok" }
  ],
  "checks": { "sqlite": "ok", "fts": "ok", "vectors": "ok", "audit": "ok" }
}
```

`engine.state` ∈ `operational | degraded | not-initialized | error`. `counts` son medidos; `context` es
estimado y lo declara. `activity` máx. 8.

### 3.2 `GET /sources`

Query: `collection`, `tag`, `q` (título/URI), `limit` (1–100), `offset`, `sort` ∈ `indexedAt|title|chunks`.

```json
{
  "items": [{
    "sourceId": "src_ab12", "uri": "file:///C:/proyecto/docs/a.md", "title": "a.md",
    "collection": "default", "tags": ["docs"], "chunks": 12, "bytes": 20480,
    "indexedAt": "2026-11-17T17:42:11.000Z", "digest": "9f2c1d4e"
  }],
  "total": 38, "limit": 50, "offset": 0, "hasMore": false
}
```

### 3.3 `GET /sources/:id`

Metadatos completos + `chunks: [{ordinal, heading, charStart, charEnd, tokenEst}]` paginados.
El texto **no** viaja aquí; se pide a `/sources/:id/chunks/:ordinal`.

### 3.4 `POST /retrieval`

```json
{ "query": "cómo se aprueba un plan", "strategy": "hybrid", "limit": 8,
  "collection": null, "tags": [], "tagMode": "any", "includeContext": true, "budgetTokens": 2000 }
```

Respuesta:

```json
{
  "mode": "hybrid", "elapsedMs": 1.4, "truncated": false,
  "vectors": { "scanned": 1240, "truncated": false },
  "results": [{ "rank": 1, "chunkKey": "src_ab12#3", "sourceId": "src_ab12", "uri": "…",
                "title": "a.md", "heading": "Aprobación", "ordinal": 3,
                "snippet": "…", "bm25": -1.2, "cosine": 0.71, "rrf": 0.032 }],
  "context": { "text": "…", "tokens": 1702, "truncated": false,
               "citations": [{ "n": 1, "chunkKey": "src_ab12#3", "uri": "…", "charStart": 0, "charEnd": 1200 }] }
}
```

Reglas: `strategy` ∈ `fts|vector|hybrid`; el Laboratorio no escribe métricas de uso de agente (solo
contadores `labQueries`, separados); el texto de la consulta **no** se persiste.

### 3.5 `POST /actions`

Envelope único:

```json
{ "action": "reindex", "payload": { "operation": "fts" } }
```

| Acción | Payload | Política |
|---|---|---|
| `reindex` | `{operation: "fts"\|"vectors"\|"all"}` | confirmación + aprobación si `all`/vectores |
| `forget` | `{ref}` | aprobación humana obligatoria |
| `ingestPaths` | `{paths, collection?, tags?, force?}` | igual que la tool (aprobación si fuera de raíz) |
| `doctor` | `{full?: true}` | automático |
| `exportAudit` | `{}` | automático (solo escribe `audit.jsonl` derivado) |

Respuesta `200` con el resultado de la operación; `409` si hay otra operación de mantenimiento en curso;
`403`/`approval-required` si la política exige aprobación y no se concedió. La UI **no** aprueba: muestra
«requiere aprobación en el host» y refresca cuando el host resuelve.

### 3.6 `POST /config`

```json
{ "patch": { "search": { "limit": 8 }, "context": { "budgetTokens": 2400 } }, "expectedVersion": 7 }
```

Validación con `validateConfig` (mismas reglas que el motor); `expectedVersion` implementa concurrencia
optimista (`409` si cambió). Cambios de proveedor/raíces exigen confirmación; `localOnly` no se puede
desactivar desde la UI si el host fijó `LIFECODE_RAG_LOCAL_ONLY=1`.

## 4. Modelo de lectura y rendimiento

`lib/query.mjs` es el único módulo que consulta para la UI. Reutiliza la conexión abierta por el plugin
(sin abrir una segunda conexión: en Windows, dos `DatabaseSync` sobre el mismo fichero pueden bloquearse).

Presupuestos por endpoint (objetivo a medir en M3, no medido aún):

| Endpoint | p95 objetivo | Notas |
|---|---|---|
| `/snapshot` | ≤ 60 ms con 10 000 chunks | agregados con índices; sin `COUNT(*)` sobre texto |
| `/sources` | ≤ 40 ms | índice `sources_collection`, paginación real |
| `/sources/:id` | ≤ 25 ms | chunks por `chunks_source` |
| `/retrieval` | ≤ 250 ms | FTS + scan vectorial acotado |
| `/metrics/*` | ≤ 50 ms | tablas agregadas, no cálculo sobre eventos crudos |

Si se supera, la respuesta incluye `partial: true` y la UI lo dice; no se recorta en silencio.

## 5. Modelo de seguridad

### 5.1 Qué protege y qué no

La API **no autentica procesos locales**. Cualquier proceso que corra bajo el mismo usuario Windows puede
abrir `http://127.0.0.1:<puerto>/lifecode-rag/api/v1/…` y llamarla. Eso es aceptable solo si se declara:

- **Sí protege** frente a páginas web de terceros (CSRF), DNS rebinding y formularios cross-origin.
- **No protege** frente a malware o a otro proceso del mismo usuario; para eso no hay mecanismo en el host
  y no se va a inventar uno en v0.2.
- La cabecera `x-lifecode-rag: 1` **no autentica**: solo obliga a preflight y descarta formularios simples.
  Se documenta así para no vender una seguridad que no existe.

### 5.2 Modelo de amenazas

| Amenaza | Vector | Mitigación | Límite |
|---|---|---|---|
| CSRF desde una web | `POST` con formulario cross-origin | JSON + cabecera personalizada (preflight) + `Origin` exacto | no aplica a procesos locales |
| DNS rebinding | dominio atacante resuelto a 127.0.0.1 | `Host` debe ser **exactamente** el origen del host (`getOrigin()`), no «cualquier loopback» | — |
| Fuga de contenido | `GET /sources/:id/chunks/:ordinal` | solo `sourceId` validado; sin rutas del almacén | un proceso local ya puede leer los ficheros originales |
| Escritura no autorizada | `POST /config`, `/actions` | validación + `expectedVersion` + política/aprobación + auditoría | la aprobación la da el host, no la UI |
| DoS local | cuerpo gigante, consultas caras | 64 KiB, límites, `AbortSignal`, 429 por concurrencia | un proceso local puede saturar igual |
| Fuga por errores | stack, SQL, rutas | códigos públicos; log interno | — |

### 5.3 Respuestas a las preguntas de la orden

1. **¿Todo proceso local es confiable?** No. Se trata como *no autenticado*; la frontera real es la
   aprobación del host para acciones sensibles y la validación de configuración.
2. **¿Qué puede hacer un proceso local?** Leer metadatos y chunks (que ya están en disco), lanzar
   `GET`, y pedir acciones. Las sensibles quedan en `approval-required` hasta que la persona apruebe en el
   host; no puede aprobar por HTTP.
3. **¿Cómo se protegen las escrituras de configuración?** Esquema cerrado (`validateConfig`), rangos,
   `expectedVersion` (409 si cambió), auditoría con antes/después, y confirmación explícita para
   proveedor/raíces/analítica.
4. **¿Qué exige confirmación o aprobación aunque venga de la UI?** `forget`, `purgeMetrics` total,
   `ingestPaths` fuera de raíz, cambio de raíces/proveedor, egress y cualquier operación destructiva. La
   UI nunca llama a `approval.request`; devuelve el estado y espera.
5. **¿CSRF y DNS rebinding?** Sin CORS, `Content-Type: application/json` obligatorio, cabecera
   personalizada, `Origin` (si existe) igual al origen del host, y `Host` **exacto** al `host:port` del
   host. Un `OPTIONS` no devuelve cabeceras CORS.
6. **¿Cómo se valida `Host`/`Origin`?** `Host` se compara con `new URL(ctx.webServer.getOrigin()).host`;
   `Origin`, cuando llega, con el origen completo; discrepancias → `403 host-not-allowed`. No se acepta
   `localhost` comodín ni puertos distintos.
7. **¿Rutas de solo lectura?** `GET /health`, `/capabilities`, `/snapshot`, `/sources*`, `/metrics/*`,
   `/activity`, `/config`, `/health/checks`. `POST /retrieval` tampoco escribe contenido (solo contadores
   de laboratorio). Las únicas escrituras son `/actions` y `/config`.

### 5.4 Pruebas de seguridad reproducibles

1. `Host: evil.example` → `403 host-not-allowed`, sin cuerpo de datos.
2. `POST /actions` sin `x-lifecode-rag` → `403` y **cero** mutaciones (verificar auditoría y filas).
3. `POST /config` con `Origin: https://evil.example` → `403`.
4. `OPTIONS /actions` → `405`/`204` sin `Access-Control-Allow-*`.
5. Cuerpo > 64 KiB → `413`, conexión cerrada sin leer el resto.
6. `POST /config` con `expectedVersion` viejo → `409`, configuración intacta.
7. `POST /actions {action:'forget'}` sin aprobación → `403 approval-required`, fuente sigue existiendo.
8. `GET /sources/:id/chunks/:ordinal` con id inventado → `404`, sin filtrar rutas.
9. `GET /sources` con `limit=1000` → `400 invalid-argument`.
10. Tras todas las pruebas, `audit` no contiene cuerpos ni rutas absolutas.

### 5.5 Por qué no se añade autenticación ahora

Un token en `localStorage` no protege de otro proceso local (puede leerlo o llamar igual), añade estado y
complica el arranque. Un socket con nombre/OS auth exigiría capacidad del host no verificada. Se declara
como limitación y, si se necesita, se decide en una orden aparte con coste y compatibilidad.


## 6. Versionado

- `v1` en la ruta; cambios incompatibles ⇒ `v2`, con `v1` servida durante al menos una versión menor.
- `capabilities` declara `{api: "v1", tools: "0.1.0", features: ["workspace","metrics","policies"]}`.
- El cliente exige `api: "v1"`; si no coincide, muestra una tarjeta de incompatibilidad y no rompe.
