# Uso diario

Requisitos: plugin cargado en DSH (perfil con el enlace a `lifecode-rag`), siete herramientas registradas.

## 1 · Alta (una vez por proyecto)

```sh
node bin/lifecode-rag.mjs project create --name "Operaciones" --create   # imprime prj_…
node bin/lifecode-rag.mjs root add --project prj_… --path "C:/documentos/operaciones"
```

La raíz debe existir y ser absoluta. El registro vive en el perfil del plugin (`~/.dsh/lifecode-rag/profiles/<perfil>`).

## 2 · Selección de proyecto

Dos caminos:

- **Por directorio de trabajo** (por defecto): si la sesión no tiene selección, el proyecto se resuelve por el
  `cwd` de la sesión contra las raíces autorizadas. Es lo que hace el agente sin intervención.
- **Selección explícita** (fija la sesión a un proyecto, sobrevive a cambios de `cwd`):

```sh
node bin/lifecode-rag.mjs select --session <session-id> --project prj_…
node bin/lifecode-rag.mjs session show --session <session-id>
```

## 3 · Trabajar desde el agente

```
ingest  paths: ["C:/documentos/operaciones"]        # o ficheros concretos
search  query: "plazo de reembolso"
context query: "plazo de reembolso", budgetTokens: 1200
get     ref: src_…                                   # o la URI
list                                                 # fuentes del proyecto
forget  ref: src_…                                   # pide aprobación
reindex operation: "fts" | "vectors" | "all"         # pide aprobación
```

`forget` y `reindex` exigen una aprobación humana previa (`allowed-once`). Sin aprobación fallan cerradas.

## 4 · Diagnóstico y verificación

```sh
node bin/lifecode-rag.mjs diagnose            # registro, almacenes, auditoría, selecciones
node bin/lifecode-rag.mjs diagnose --json
node bin/lifecode-rag.mjs library status
node bin/lifecode-rag.mjs audit verify
```

## 5 · Errores frecuentes

| Código | Significado | Qué hacer |
|---|---|---|
| `scope-unresolved` | el `cwd` no cae en ninguna raíz autorizada | `root add` del proyecto correcto, o `select` |
| `scope-ambiguous` | el `cwd` cae en dos raíces | dejar una sola raíz o seleccionar explícitamente |
| `source-not-found` | el id/URI no existe **o es de otro proyecto** | comprobar proyecto activo; no es un fallo de disco |
| `approval-unavailable` | no hay servicio de aprobación | operar desde el host, no desde un script |
| `invalid-argument` | consulta vacía, límite inválido… | corregir la entrada |

## 6 · Limitaciones conocidas

- `search` es híbrida: puede devolver aciertos sin coincidencia léxica (`mode: 'none'`, sin snippet). Para
  códigos exactos, verificar el snippet antes de citar.
- El panel Project-Aware es **demostrativo**: no opera datos reales.
- Los subagentes no tienen acceso RAG (delegación desactivada).
- El historial del panel no existe todavía.
