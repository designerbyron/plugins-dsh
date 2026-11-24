# ACP-05 — Consumidor limpio desde npm

**Verificado:** 2026-11-22 05:13 UTC
**Directorio:** `C:\Users\BYRON\AppData\Local\Temp\lifecode-rag-acp05-consumer` (nuevo, sin relación con el repo)
**Instalación:** `npm install @designerbyron/lifecode-rag@1.0.0` **desde el registro público**

---

## 1. Instalación

```
$ npm init -y
$ npm install @designerbyron/lifecode-rag@1.0.0
added 1 package in 1s

$ node -e "…package.json…"
@designerbyron/lifecode-rag 1.0.0 license=MIT stub=false

$ npm ls --depth=0
lifecode-rag-acp05-consumer@1.0.0
└── @designerbyron/lifecode-rag@1.0.0
```

Un solo paquete, ninguna dependencia transitiva, `stub: false`. Sin `npm link` y sin tarball local.

## 2. Superficie del paquete instalado

| Comprobación | Resultado |
|---|---|
| `require.resolve('@designerbyron/lifecode-rag')` | `…/node_modules/@designerbyron/lifecode-rag/index.js` |
| `…/client` | `…/client.js` |
| `…/lib/tools.mjs` y `…/lib/tools` | ambos resuelven |
| Exports del punto de entrada | `apply`, `inject`, `name` |
| `inject` | `["tools","webServer","connection"]` |
| Id del cargador en `client.js` | `@designerbyron/lifecode-rag` |

## 3. Las siete herramientas

```json
["lifecode_rag_context","lifecode_rag_forget","lifecode_rag_get","lifecode_rag_ingest",
 "lifecode_rag_list","lifecode_rag_reindex","lifecode_rag_search"]
```

`toolCount: 7`.

## 4. Contratos y códigos

| Comprobación | Resultado |
|---|---|
| Códigos catalogados | **52** |
| `unauthenticated` | **401** |
| `revision-conflict` | **409** |
| `authorization-unavailable` | **503** |

## 5. Identificador interno e independencia del host

```yaml
# cordis.patch.yml del paquete instalado desde npm
- insert:
    - id: lifecode-rag
      name: '@designerbyron/lifecode-rag'
```

El id interno sigue siendo `lifecode-rag`; las rutas del panel siguen siendo `/lifecode-rag/pa/*`.

```
grep de imports externos en lib/, index.js → ninguna coincidencia
```

Sólo imports relativos y `node:*`. Sin `@deepseek-ai/*`, sin `cordis`, sin `electron`: el núcleo se importa
y se usa desde Node sin host.

## 6. Tamaño instalado

1,1 MB en disco, 73 ficheros. Sin ficheros de desarrollo.

## 7. Lo que no se ejecutó

- No se tocó el almacén RAG real ni ninguno de sus proyectos.
- No se lanzó un host DSH con esta instalación: la carga del plugin en un host ya se verificó en ACP-03 con
  el mismo tarball (`sha256 595c6e19…`), y este acto confirma que el del registro es el mismo fichero.

## 8. Veredicto

**PASS.** Un consumidor limpio instala la 1.0.0 desde npm y obtiene el plugin completo: exports, siete
herramientas, contratos, códigos, id interno y núcleo independiente.
