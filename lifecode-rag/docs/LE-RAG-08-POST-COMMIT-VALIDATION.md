# LE-RAG-08 · Verificación post-commit

## Commit verificado

| | |
|---|---|
| SHA | `dfe70f572291dc7dcb6939da7fee9cc89398782a` |
| Padre | `b6c0cd24621c8bc3282185d1821c60b7956f8a83` (uno, sin merge) |
| Mensaje | `feat(lifecode-rag): incorporar el núcleo independiente, configuración por perfiles y diversidad documental` |
| Autor | designerbyron `<designerbyron@users.noreply.github.com>` · 2026-11-19 19:16:17 -0600 |
| Archivos | **405** · 58 341 inserciones · **0 borrados** · **0 fuera de `lifecode-rag/`** |
| Árbol | `git ls-tree -r HEAD lifecode-rag/` → 405 entradas |

Comprobado con salidas NUL-delimitadas (`-z`): los 8 «fuera» que da un conteo ingenuo son rutas con guion
largo `—` que git cita entre comillas. Reales: **0**.

## Correspondencia con LE-RAG-07

Comparación blob por blob (`git cat-file blob` vs árbol de trabajo vs manifiesto de LE-RAG-07):

- **338** blobs idénticos al árbol de trabajo.
- **67** difieren **sólo por CRLF→LF** (normalización de git al confirmar).
- **0** difieren en contenido real.
- **1** archivo del commit no figura en el manifiesto: el propio `LE-RAG-07-FILE-MANIFEST.md` (no se lista a sí mismo).

## Reproducción desde Git

`git archive HEAD lifecode-rag | tar -x` en un directorio fuera del repositorio:

- **405 archivos**, ninguno no versionado, **cero logs** (los 9 excluidos no entraron), **sin `node_modules`**.
- `package.json`: `@local/lifecode-rag` v1.0.0, `engines.node >=22.5.0`, `engines.dsh >=0.2.2-rc.3 <0.3.0`,
  **`dependencies` vacío**. Node utilizado: v24.21.0.
- Contenido exacto del commit; ninguna dependencia de archivos locales no versionados.

## Validación funcional (copia limpia)

| Prueba | Resultado |
|---|---|
| Suite completa | **396/396 pass · 0 fail · 0 skipped · 0 todo** |
| `tools/check.mjs` | verde (7 herramientas, sin `@deepseek-ai/*`, manifiesto y parche correctos) |
| Zero Harness (gate) | verde dentro de la suite; motor y persistencia sin DSH y sin `node_modules` |
| Siete herramientas (`eval/product-readiness-01/smoke-tools.mjs`) | **13 pasos, ok**: list, search, context, get, get-inexistente, search-vacía, ingest, ingest-duplicado, reindex, forget, aislamiento-get, aislamiento-list, sesión-invalidada |
| `tools/hermetic.mjs` | «el almacén real no cambió (3 fichero(s))» |
| Ranking `fragment`/`source` | cubierto por `tool-golden` y `search-diversity` dentro de la suite |
| Configuración (resolvedor, perfiles, trabajadores) | 15 pruebas dentro de la suite |

## Seguridad y aislamiento

- El core corre sin DSH, sin Cordis y sin dependencias instaladas.
- `lib/**` no importa el adaptador; el adaptador (`index.js`, `client.js`) sí importa el core (dirección correcta).
- Escrituras destructivas: 3 ficheros de pruebas cubren `approval-unavailable`/`approval-required`; sin servicio
  de aprobación la operación se rechaza (fallo cerrado).
- Sin credenciales en el core: no hay lectura ni escritura de tokens; el filtro de `metadata` descarta claves
  con pinta de secreto.
- Almacén real: `4dcf31c4cb7058bb…` **antes y después** de toda la validación.
- Los almacenes de prueba viven en `mkdtemp` y se eliminan; ninguno apunta al perfil real.

## Diferencias respecto a LE-RAG-07

Ninguna funcional. La única diferencia es de **finales de línea** en 67 archivos (git normaliza a LF al
confirmar). Los 405 caminos, los tamaños lógicos y el contenido coinciden.

## Riesgos residuales

1. Un `git checkout` posterior entregará esos 67 archivos en LF (contenido idéntico, diffs de línea).
2. El commit no incluye los dos documentos de LE-RAG-08 (se crean después, sin tocar el commit).
3. Sin prueba con modelo real ni activación en DSH (ver plan).
