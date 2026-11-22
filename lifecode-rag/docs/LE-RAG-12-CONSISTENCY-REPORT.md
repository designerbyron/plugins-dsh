# LE-RAG-12 · Auditoría de consistencia del contrato y cierre

Laboratorio: `C:\xampp\htdocs\lifecode-rag-lab\pa-dev`. Sin commit, sin push, sin release, sin instalación
productiva.

## 1. Las cuatro discrepancias y su resolución

### D-01 · Límite de `/snapshot`

**Antes:** `sourcesPage` acotaba con `Math.min(limit, 200)` y `limit=99999` respondía 200; §8 dice que por
encima del máximo se responde 400 `invalid-argument`.

**Ahora:** `queryParams` (`lib/pa-api.mjs:67-70`) rechaza `limit > 200` con
`400 · reason: "limit-too-large" · field: "limit" · max: 200`. El acotado de `sourcesPage` se conserva como
segunda defensa. La paginación válida no cambia: `limit` ausente → 50, `limit=200` → 200, `cursor` intacto.

Se distinguió requisito normativo (§8, tabla CONTRATO) de ejemplo: no se tocó el resto de la tabla.

### D-02 · Sobre de respuesta

**Antes:** las respuestas eran el payload plano (`{mode, project, sources…}`) y los errores `{error:{…}}`;
§5 define `{ok:true,data}` / `{ok:false,error}` como el sobre documentado.

**Ahora:** `writeJson` (`lib/pa-api.mjs:43`) emite el sobre; `respond`/`failWith` (líneas 224-225) son las
únicas salidas del handler. Se preservó todo lo demás: códigos HTTP por código de error, forma de `error`
(`code`, `message`, `details`), claves de cada payload y rutas.

El cliente se adaptó **en un solo punto** (`request`, `client.js:89` y `:106`): desenvuelve `data`, y trata
`ok:false` como fallo aunque llegue con 200 (nunca degrada a datos vacíos). `negotiateMode` (`:117`) lee el
payload envuelto, para que un sobre no lo deje en modo `fixture`.

### D-03 · `response-too-large`

**Antes:** `send()` emitía `{error:{code:'response-too-large'}}` con el status original —podía ser un 200—
y el código no estaba en el catálogo público.

**Ahora:** `lib/errors.mjs:32` lo incorpora a `RAG_CODES`. La respuesta se emite con `500`, `ok:false` y
`details.limit`; el cuerpo que excede el tope no se sirve nunca. No se sustituyó por `too-large` (ese es el
del cuerpo de la petición, 413). El cliente lo reconoce por `code` y lo propaga como fallo de transporte.

### D-04 · §6.7 y `searchScopes`

**Antes:** el contrato atribuía `scopeId`/`scopeKind` a `searchScopes`. Esa función **no existe** en este
build (verificado con `grep` sobre `lib/`).

**Ahora:** §6.7 dice que los campos son de la API visual, que el handler los **deriva del único ámbito que
abre** (el proyecto autorizado) y que `scopeKind` es siempre `prj`; y declara explícitamente que no hay
dependencia de `searchScopes`. No se introdujo ninguna.

## 2. Archivos y líneas

| Archivo | Líneas | Cambio |
|---|---|---|
| `lib/pa-api.mjs` | 43-60 | `writeJson`: sobre + tope de respuesta con 500 `response-too-large` |
| `lib/pa-api.mjs` | 67-70 | `limit > 200` → 400 `limit-too-large` |
| `lib/pa-api.mjs` | 79-92 | `readJsonBody` con tope configurable |
| `lib/pa-api.mjs` | 222-226 | `maxBody` + `respond`/`failWith`/`methodNotAllowed` |
| `lib/errors.mjs` | 32 | `response-too-large` en `RAG_CODES` |
| `client.js` | 86-106 | fallo por `ok:false`, desenvuelve `data` |
| `client.js` | 113-119 | `negotiateMode` lee el payload envuelto |
| `tests/pa-api.test.mjs` | 40-64, 114 | aserciones al sobre `data` |
| `tests/pa-api.test.mjs` | 206-239 | límites de `/snapshot` (§8): válido, 200, 201, negativo, no numérico, ausente |
| `tests/pa-api.test.mjs` | 241-279 | sobre positivo y negativo en las cuatro rutas + `/actions` |
| `tests/pa-api.test.mjs` | 281-297 | `response-too-large` con 500 y tope por instancia |
| `tests/client.test.mjs` | 566-584 | el cliente desenvuelve y trata `ok:false` con 200 como fallo |
| `docs/PA-UI-0-API-CONTRACT.md` | §5, §6.7, §7, §8 | sobre implementado, ámbitos derivados, `response-too-large`, límite aplicado |
| `docs/LE-RAG-11-POST-CONTRACT-REPORT.md` | §10 | las cuatro discrepancias marcadas como resueltas |

## 3. Pruebas de regresión

Nuevas: 4 (tres de servidor, una de cliente). Ajustadas: 25 aserciones al sobre y la que fijaba el acotado
silencioso. Total del proyecto: **410**.

## 4. Tres puertas

```
node --test              410/410
node tools/check.mjs     ✓ 7 herramientas, manifiesto, slots vigentes
node tools/hermetic.mjs  ✓ el almacén real no cambió (3 ficheros)
```

## 5. Evidencia HTTP (instancia `127.0.0.1:56738`, tras el reinicio justificado)

| Petición | Respuesta |
|---|---|
| `GET /snapshot` | 200 · `{"ok":true,"data":{"mode":"api",…}}` |
| `GET /config` | 200 · sobre |
| `POST /search {query:"reembolso",limit:5}` | 200 · `{"ok":true,"data":{"mode":"hybrid",…}}` |
| `POST /context {query:"reembolso",budgetTokens:800}` | 200 · `{"ok":true,"data":{"text":"…",…}}` |
| `POST /actions` | 403 · `{"ok":false,"error":{"code":"approval-required",…}}` |
| `GET /search?q=x` · `GET /context?q=x` | 405 · `allow:["POST"]` |
| `GET /snapshot?limit=201` | 400 · `limit-too-large`, `max:200` |
| `GET /snapshot?limit=200` | 200 |

Panel: `data-data-mode="api"`, sin banner, `Cliente montado · API montada · Datos del proyecto · Servicio: ok`,
2 fuentes reales, `POST /search?project=…` y `POST /context?project=…` en la red, resultados con
`Modo: hybrid`, y contexto con `162` tokens, `No` truncado, `2` considerados y 640 caracteres de texto.

## 6. Disponibilidad del laboratorio

`127.0.0.1:62386` se mantuvo en pie durante toda la fase de cambios. El reinicio se ejecutó **una sola vez,
al final**, como necesidad técnica declarada: el sobre y los límites viven en el servidor del plugin, que
sólo se recarga al arrancar la instancia, y la validación exigida en el gate es en vivo. La instancia
disponible ahora es **`http://127.0.0.1:56738/?token=…`** con el código nuevo.

## 7. Integridad

| Objeto | Estado |
|---|---|
| Repo original | HEAD `dfe70f572291dc7dcb6939da7fee9cc89398782a`; `lifecode-rag/` sin cambios registrados |
| Almacén real | `~/.dsh/lifecode-rag` · huella `23fcfaf3…` · última escritura 2026-11-19 18:03 |
| Perfil habitual | instancia del propietario con su `user-data-dir` de Roaming, intacta |
| Laboratorio | `DSH_HOME` y `electron/` propios; sólo se reinició esa instancia |

## 8. Git y producción

Ninguna operación Git (ni commit, ni push, ni merge, ni tag). Ninguna instalación productiva: todo el trabajo
está en `pa-dev`, la copia del laboratorio sin `.git`.
