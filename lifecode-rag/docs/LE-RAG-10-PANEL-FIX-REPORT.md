# LE-RAG-10 · Panel PA visible con datos reales

Proyecto aislado: `C:\xampp\htdocs\lifecode-rag-lab\pa-dev`.
Referencia inmutable intacta: `dfe70f572291dc7dcb6939da7fee9cc89398782a` (HEAD del repo original, sin cambios en
`lifecode-rag/`).

## 1. Causa raíz (medida, no inferida)

`paReduce(state, action)` usa `previous` —variable inexistente— en las ramas `hydrate` y `unavailable`.
Cualquier `dispatch` posterior al montaje lanzaba:

```
ReferenceError: previous is not defined
  at paReduce (…/@local/lifecode-rag/client.js…)
slot entry crashed in 'main': | ReferenceError: previous is not defined
```

El *error boundary* del anfitrión se comía la excepción y el slot `main` quedaba vacío: el panel
«desaparecía». La captura de `console.error` con `Page.addScriptToEvaluateOnNewDocument` fue lo que lo
expuso; `window.onerror` seguía limpio.

Prueba de que el payload no era la causa: la variante no-op del reducer (`return { ...previous }`) también
dejaba el panel sin raíz, porque el `ReferenceError` ocurre antes de cualquier rama.

| Variante | root | body_len | marcas |
|---|---|---|---|
| efecto desactivado (F) | sí | 1091 | `v=F`, `e=disabled-F`, `n=none` |
| `D2` (dispatch no-op) | no | 19 | `neg=api`, `snap=ok` |
| `E`/`C`/`B`/completa | no | 19 | `neg=api`, `snap=ok` |

## 2. Cambios

`client.js`
- `paReduce`: `previous` → `state` en `hydrate` y `unavailable`. Se retiraron las variantes de bisect
  (`lcrvar`, A/B/C/D/D2/E/F) y todas las marcas `__lcr*` y `data-lcr-*`.
- `hydrate`: mapea sólo lo que la API entrega (fuentes, proyecto y candidatos desde `scopes`, bibliotecas,
  `service`, `scopeCount`, `diagnostics.scopes`). No hereda del fixture colección ni texto de fragmentos.
- Búsqueda y contexto reales: la red vive en un efecto encadenado a `state.pending`; el reducer sigue puro.
  `GET /pa/search?q=…&limit=…` y `GET /pa/context?q=…&maxTokens=800` (la API PA es de sólo lectura).
  Normalizadores `paNormalizeSearch`/`paNormalizeContext`: puntuación real (`score`), URI relativa del
  snapshot cuando la cita trae `sourceId` (no se filtra la ruta absoluta del disco).
- Vistas honestas en modo api: cabecera (API montada · Datos del proyecto), KPIs hidratados, Conexión sin
  cifras del fixture, Operaciones con el 403 del host, Diagnóstico sólo con ámbitos reales, detalle de fuente
  sin fragmentos inventados.

`index.js`
- Retirada la traza `apply` a fichero, el envoltorio y el sondeo `/lifecode-rag/pa-ping`
  (`LIFECODE_RAG_PA_PROBE`). Se conserva `inject: ['tools', 'webServer']`, que es el arreglo real del prefijo.

`tests/client.test.mjs`
- Dos pruebas nuevas: `hydrate` pasa a `api` y sustituye las fuentes por las filas del snapshot;
  `unavailable` deja el panel en `down` con su razón. Eran las dos ramas que la suite no cubría — por eso
  399 pruebas verdes convivían con el fallo.
- Ajustada una afirmación de texto que fijaba la cadena del fixture.

## 3. Evidencia (instancia final, `127.0.0.1:62825`)

- `data-data-mode="api"`, sin banner sintético, `__lcr*` ausente.
- Cabecera: `Cliente montado | API montada | Datos del proyecto | Servicio: ok`.
- Proyecto: `Laboratorio LE-RAG-09`, 1 ámbito efectivo, 0 bibliotecas, 2 fuentes.
- Fuentes: `guia-soporte.md` y `politica-reembolsos.md` (251 B y 263 B, 1 fragmento cada una).
- Búsqueda real `reembolso`: `politica-reembolsos.md` (1.000) y `guia-soporte.md` (0.246), modo `api`.
- Contexto real: 2 citas con URI relativa y 640 caracteres de texto del corpus.
- `GET /lifecode-rag/pa/snapshot` → 200 `mode:api`. `POST /lifecode-rag/pa/actions` → 403 `approval-required`.
  `GET /lifecode-rag/pa-ping` → 404 (sonda retirada).

## 4. Puertas

```
node --test            401/401
node tools/check.mjs   ✓ (7 herramientas, manifiesto, slots)
node tools/hermetic.mjs ✓ el almacén real no cambió (3 ficheros)
```

Almacén real `C:\Users\BYRON\.dsh\lifecode-rag`: huella `23fcfaf3b7fb4b3b…`, última escritura
`registry.sqlite3` 2026-11-20T00:03:49Z — anterior a esta sesión.

## 5. Lo que queda declarado, no resuelto

- `Diagnóstico` no lee integridad, auditoría ni versiones de la API: la vista lo dice y muestra sólo los
  ámbitos reales del snapshot.
- El detalle de una fuente no puede mostrar texto de fragmentos: la API PA no lo expone. **LE-RAG-11 (D-02)**
  decide diferir el endpoint de fragmentos: la vista muestra metadatos y declara que la inspección individual
  no está soportada todavía.
- El KPI de tokens del contexto aparecía vacío porque el servidor devolvía `tokensEstimate: null`. Resuelto en
  LE-RAG-11: `/context` publica `tokens`, `truncated` y `considered` reales.
- ~~La API PA es GET-only y el contrato documenta `POST /search` y `POST /context`.~~ Resuelto en LE-RAG-11:
  el servidor implementa POST con validación estricta y GET sobre esas rutas responde 405. Ver
  [`LE-RAG-11-POST-CONTRACT-REPORT.md`](LE-RAG-11-POST-CONTRACT-REPORT.md).
