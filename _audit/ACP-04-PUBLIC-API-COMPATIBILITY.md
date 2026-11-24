# ACP-04 — Compatibilidad de la API pública

**Verificado:** 2026-11-22 05:10 UTC
**Base de la verificación:** el artefacto autorizado `designerbyron-lifecode-rag-1.0.0-MIT.tgz`
(`sha256 595c6e19d592d730de65fd968a85fba7aa0869ae526cab596c279fdefbca1166`), instalado en un consumidor
nuevo. **No** sobre el registro, porque la versión 1.0.0 no está publicada.

---

## 1. Resolución del paquete

| Comprobación | Resultado |
|---|---|
| `require.resolve('@designerbyron/lifecode-rag')` | `<consumer>/node_modules/@designerbyron/lifecode-rag/index.js` |
| `require.resolve('@designerbyron/lifecode-rag/client')` | `…/client.js` |
| `…/lib/tools.mjs` (con extensión) | resuelve |
| `…/lib/tools` (sin extensión) | resuelve |
| `package.json` del paquete | `name`, `version 1.0.0`, `license MIT` |
| Dependencias declaradas | **ninguna** (ni `dependencies` ni `peerDependencies`) |

## 2. Superficie del punto de entrada

```json
"entryExports": ["apply", "inject", "name"],
"entryHasApply": true,
"entryInject": ["tools", "webServer", "connection"]
```

`inject` declara `connection` como dependencia del adaptador: si el host no ofrece servicio de conexión, la
compuerta del panel falla en cerrado (`503 authorization-unavailable`), tal como está documentado.

## 3. Las siete herramientas

| # | Herramienta | Presente |
|---|---|---|
| 1 | `lifecode_rag_ingest` | ✅ |
| 2 | `lifecode_rag_search` | ✅ |
| 3 | `lifecode_rag_context` | ✅ |
| 4 | `lifecode_rag_get` | ✅ |
| 5 | `lifecode_rag_list` | ✅ |
| 6 | `lifecode_rag_forget` | ✅ |
| 7 | `lifecode_rag_reindex` | ✅ |

`toolCount: 7`, sin altas ni bajas respecto al contrato `v0.1.0`.

## 4. Identificador interno

```yaml
# cordis.patch.yml del paquete instalado
- insert:
    - id: lifecode-rag
      name: '@designerbyron/lifecode-rag'
```

El id sigue siendo `lifecode-rag`; sólo cambió el nombre del paquete. Las rutas del panel siguen siendo
`/lifecode-rag/pa/*`.

## 5. Códigos y estados

| Comprobación | Resultado |
|---|---|
| Códigos catalogados en `RAG_CODES` | **52** |
| `httpStatusFor('unauthenticated')` | **401** |
| `httpStatusFor('revision-conflict')` | **409** |
| `httpStatusFor('authorization-unavailable')` | **503** |

Estos tres estados se midieron además contra un host real en ACP-03: `401` sin credencial en todas las
rutas PA, `409 revision-conflict` al repetir una revisión obsoleta, `503 authorization-unavailable` sin
servicio de conexión.

## 6. Independencia del host

```
grep de imports reales en lib/, index.js y client.js:
  sólo módulos internos (./, ../) y node:*  → ninguna importación de @deepseek-ai/*, cordis ni electron
```

Las cinco apariciones del texto `@deepseek-ai/*` en el paquete son **comentarios** que documentan
precisamente esa independencia (`lib/auto-context.mjs:136`, `lib/db.mjs:5`, `lib/session-identity.mjs:4`,
`index.js:4`, `client.js:4`). No hay dependencia obligatoria de DeepSeek Harness: el núcleo se importa y
se usa desde Node sin host, y la integración vive en `index.js`/`client.js`.

## 7. Lo que no se pudo verificar aquí

| Criterio | Estado | Motivo |
|---|---|---|
| Las siete herramientas desde el **paquete publicado** | FAIL | el registro sirve `0.0.0-stage` (stub de 2 ficheros) |
| Instalación desde el registro | FAIL | `E404 notarget` para `@1.0.0` |

Todo lo de §1-§6 está medido sobre el artefacto que se publicará; nada de ello procede del registro.

## 8. Veredicto

**PASS sobre el artefacto**, **FAIL sobre el registro**. La API pública es la contratada; el registro
todavía no la sirve.
