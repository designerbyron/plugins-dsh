# LE-RAG-11 · Alineación del contrato PA: POST en search y context

Laboratorio aislado: `C:\xampp\htdocs\lifecode-rag-lab\pa-dev`.
Sin commit, sin push, sin release. Repositorio original, perfil habitual y almacén real intactos.

## 1. Contrato final

| Ruta | Método | Request | Autorización |
|---|---|---|---|
| `/snapshot` | GET (HEAD admitido) | query `project`, `limit`, `cursor` | proyecto del registro con raíces autorizadas |
| `/config` | GET (HEAD admitido) | sin parámetros | ninguna (no abre proyecto) |
| `/search` | **POST** | body `{query, limit?}` + `?project=` opcional | proyecto con raíces autorizadas |
| `/context` | **POST** | body `{query, budgetTokens?}` + `?project=` opcional | proyecto con raíces autorizadas |
| `/actions` | cualquier | — | siempre `403 approval-required` |

`GET /search` y `GET /context` → `405 method-not-allowed` con `details.allow: ["POST"]`. No quedan dos
contratos para la misma operación (D-01).

**POST /search** responde:

```json
{
  "mode": "hybrid",
  "elapsedMs": 1.25,
  "results": [
    { "chunkKey": "…", "sourceId": "…", "uri": "politica-reembolsos.md", "title": "…",
      "heading": "…", "ordinal": 0, "rrf": 0.0655, "score": 1, "snippet": "…",
      "scopeId": "prj_…", "scopeKind": "prj", "scopeName": "…" }
  ],
  "scopes": [ { "id": "prj_…", "kind": "prj", "name": "…", "results": 2 } ]
}
```

**POST /context** responde:

```json
{
  "mode": "hybrid", "elapsedMs": 0.42,
  "text": "…texto que se serviría al modelo…",
  "citations": [ { "n": 1, "chunkKey": "…", "sourceId": "…", "uri": "politica-reembolsos.md",
                   "title": "…", "heading": "…", "ordinal": 0, "charStart": 0, "charEnd": 255, "score": 1 } ],
  "tokens": 162, "truncated": false, "considered": 2,
  "scopes": [ { "id": "prj_…", "kind": "prj", "name": "…", "results": 2 } ]
}
```

Reglas: `uri` relativizada contra las raíces autorizadas (nunca ruta absoluta); `scopeKind` siempre `prj`
porque el handler sólo abre el almacén del proyecto; `record: false` en toda consulta (una lectura no
escribe auditoría); cuerpo máximo 1 MiB → `413 too-large`.

Validación estricta del cuerpo, `400 invalid-argument` sin ejecutar la operación: `missing-body`,
`invalid-json`, `invalid-body`, `unknown-field` (+`fields`), `missing-field`, `invalid-field`,
`query-too-long` (512), `limit-too-large` (50), `unknown-parameter` (+`parameters`).

Diferencia asumida y documentada en el contrato: el proyecto viaja por `?project=` porque la cabecera de
sesión de PA01 está `BLOCKED`.

## 2. Archivos modificados

- `lib/pa-api.mjs` — POST con lectura y validación de cuerpo, 405 en GET, validación de parámetros de
  query, respuestas alineadas (§6.7/§6.8), `text`/`tokens`/`truncated`/`considered` reales, URIs
  relativizadas, `too-large` → 413.
- `client.js` — `request('/search', {method:'POST', body:{query, limit}})` y
  `request('/context', {method:'POST', body:{query, budgetTokens: PA_CONTEXT_BUDGET}})`.
  `PA_CONTEXT_BUDGET = 2000` (valor por defecto del contrato).
- `tests/pa-api.test.mjs` — el arnés acepta cuerpo; pruebas nuevas (abajo).
- `tests/client.test.mjs` — `loadModule` admite `fetch` y `AbortController`; prueba del POST del cliente.
- `docs/PA-UI-0-API-CONTRACT.md` — notas de implementación en §6.7 y §6.8 (transporte, validación,
  campos reales, proyecto por query).
- `docs/LE-RAG-10-PANEL-FIX-REPORT.md` — pendientes cerrados y decisión D-02.

Ningún endpoint nuevo. No se añadió ruta de fragmentos.

## 3. Pruebas añadidas

Servidor (`tests/pa-api.test.mjs`):
1. POST search correcto: campos contractuales, URI relativa, `scope*`, `scopes`, `elapsedMs`.
2. POST context correcto: `text`, `tokens`, `truncated`, `considered`, citas relativas, `scopes`.
3. GET/PUT sobre `/search` y `/context` → 405 con `allow`.
4. Cuerpo JSON inválido, vacío o que no es objeto → 400 con su `reason`, nunca `results: []`.
5. Campos ausentes, tipos, desconocidos y límites (10 casos) + nombres sin valores + parámetro de query.
6. Proyecto desconocido (403), ambiguo (403) y límites aceptados (1 y 50).
7. Seis consultas de lectura no mueven la cabeza de auditoría.
8. Snapshot: paginación, parámetro no declarado (400), ruta desconocida (404), sin proyecto (403).

Cliente (`tests/client.test.mjs`):
9. `request` envía POST a `/lifecode-rag/pa/search` y `/lifecode-rag/pa/context` con
   `content-type: application/json`, `x-lifecode-rag: 1` y los cuerpos `{query, limit}` y
   `{query, budgetTokens}`.

## 4. Suite y puertas

```
node --test              406/406   (eran 401; +5)
node tools/check.mjs     ✓ 7 herramientas, manifiesto, slots vigentes
node tools/hermetic.mjs  ✓ el almacén real no cambió (3 ficheros)
```

## 5. Evidencia HTTP real

Instancia `127.0.0.1:53744` (DSH 0.2.2-rc.5, laboratorio).

| Petición | Respuesta |
|---|---|
| `POST /search` `{query:"reembolso",limit:5}` | 200 · `politica-reembolsos.md` 1.000 · `guia-soporte.md` 0.246 · `mode:"hybrid"` |
| `GET /search?q=reembolso` | 405 · `allow:["POST"]` |
| `POST /context` `{query:"reembolso",budgetTokens:800}` | 200 · 2 citas · `tokens:162` · `truncated:false` · `considered:2` |
| `GET /context?q=reembolso&maxTokens=800` | 405 · `allow:["POST"]` |
| `POST /search` `{nope` | 400 · `invalid-json` |
| `POST /snapshot` `{}` | 405 · `allow:["GET","HEAD"]` |
| `GET /sources/src_…` | 404 · `not-found` (no existe endpoint de fragmentos) |
| `GET /chunks?sourceId=…` | 404 · `not-found` |
| `POST /actions` | 403 · `approval-required` |

## 6. Evidencia de búsqueda y contexto en el panel

Con la instrumentación de red del navegador, el panel emitió exactamente:

```
GET  /lifecode-rag/pa/snapshot
POST /lifecode-rag/pa/search?project=prj_01M7VATGG8MZKW6FC2EA8HJN0J   {"query":"reembolso","limit":8}
POST /lifecode-rag/pa/context?project=prj_01M7VATGG8MZKW6FC2EA8HJN0J  {"query":"reembolso","budgetTokens":2000}
```

El `project` sale del snapshot ya hidratado: sin él, un perfil con varios proyectos respondería
`scope-ambiguous` y el panel lo diría.

Y pintó: `data-data-mode="api"`, 2 fuentes reales, resultados con `Modo: hybrid`, chip de ámbito
`Laboratorio LE-RAG-09 · prj`, y en Contexto `TOKENS ESTIMADOS 162 · TRUNCADO No · FRAGMENTOS
CONSIDERADOS 2` con 640 caracteres de texto del corpus.

Prueba negativa: con GET rechazado por el servidor, un panel que siguiera usando GET mostraría
`La búsqueda falló · method-not-allowed`; no es lo que se ve.

## 7. `/actions`

`403 approval-required` antes y después del cambio, con `details.tools` = ingest · forget · reindex.
No se tocó su comportamiento.

## 8. Endpoint de fragmentos

No añadido (D-02). El detalle de fuente sigue mostrando metadatos y declara que la inspección individual de
fragmentos no está soportada (`source.chunksPending`). `GET /sources/:id` y `GET /chunks` responden 404.

## 9. Integridad

| Objeto | Estado |
|---|---|
| Repo original | HEAD `dfe70f572291dc7dcb6939da7fee9cc89398782a`, `lifecode-rag/` sin cambios registrados |
| Almacén real | `~/.dsh/lifecode-rag` · huella `23fcfaf3…` · última escritura 2026-11-19 18:03 |
| Perfil habitual | instancia del propietario con su `user-data-dir` de Roaming, intacta |
| Laboratorio | su propio `DSH_HOME` y `user-data-dir`; sólo se reinició esa instancia |

## 10. Contradicciones detectadas y no corregidas en esta entrega

> **Resueltas en LE-RAG-12** (`docs/LE-RAG-12-CONSISTENCY-REPORT.md`): límite de `/snapshot` con 400,
> sobre `{ok,data}`/`{ok,false}` en todas las respuestas, `response-too-large` en `RAG_CODES` con 500, y
> §6.7 corregido (los ámbitos se derivan del proyecto, no de `searchScopes`).

1. §8 dice que por encima de 200 fuentes por página se responde 400; el handler acotaba el `limit` y había
   una prueba que fijaba el acotado (`limit=99999` → 200). **Corregido**: ahora responde 400
   `reason: "limit-too-large"`.
2. §5 dibuja el sobre `{ok:false, error:{…}}`; la implementación devolvía `{error:{…}}` sin `ok` en todas
   las rutas. **Corregido**: `writeJson` emite `{ok:true,data}` y `{ok:false,error}`, y el cliente desenvuelve.
3. `send()` usaba el código `response-too-large`, que no estaba en `RAG_CODES`. **Corregido**: está en el
   catálogo y se documenta como `500`.
4. §6.7 atribuía los campos de ámbito a `searchScopes`, función que no existe en este build. **Corregido**:
   el contrato explica que se derivan del proyecto autorizado y que `scopeKind` es `prj`.
