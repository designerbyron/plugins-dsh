# LE-RAG-09 · Laboratorio aislado (preparado)

## Host

| | |
|---|---|
| Instalación | `C:\Users\BYRON\AppData\Local\Programs\DeepSeek Harness` |
| Versión | **0.2.2-rc.5** (leída de `resources/app.asar`) |
| Rango declarado del plugin | `>=0.2.2-rc.3 <0.3.0` → **compatible** |
| `DSH_HOME` | presente en el bundle del host (no inventado) |
| `--user-data-dir` | modificador estándar de Electron (lo procesa el binario, no el asar) |
| Node | v24.21.0 |

## Rutas del laboratorio (disjuntas de las habituales)

```
lab            C:\xampp\htdocs\lifecode-rag-lab
home           …\lab\home        (DSH_HOME)
electron       …\lab\electron    (--user-data-dir)
data           …\lab\data        (LIFECODE_RAG_DATA)
plugins        …\lab\plugins\lifecode-rag  (del commit dfe70f5, 405 archivos)
corpus         …\lab\corpus      (3 documentos sintéticos)
evidence       …\lab\evidence    (manifest-lab.sha256, 413 ficheros)
logs           …\lab\logs
```

Solape con `C:\Users\BYRON\.dsh`: **ninguno** (comprobado con `realpath`).

## Datos del laboratorio

- Registro: `lab\data\profiles\lab\registry.sqlite3`.
- Proyecto: `prj_01M7V9066GPS47SFXKE9NY0ZJA` (**Laboratorio LE-RAG-09**).
- Raíz autorizada: `rt_01M7V9066JJDNPEQQBQ4HGH3XT` → `lab\corpus` (`authorized`, añadida por `human`).
- Configuración: `lab\data\config.json` y `lab\data\profiles\lab\config.json` con `strategy hybrid`, `limit 8`,
  `diversity fragment`, `maxPerSource 0`.
- Corpus: `politica-reembolsos.md`, `guia-soporte.md`, `notas-proyecto.md` (contenido 100 % sintético).

## Arranque

```
"C:\Users\BYRON\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" ^
  --user-data-dir="C:\xampp\htdocs\lifecode-rag-lab\electron"
```
con el entorno:
```
DSH_HOME=C:\xampp\htdocs\lifecode-rag-lab\home
LIFECODE_RAG_DATA=C:\xampp\htdocs\lifecode-rag-lab\data
LIFECODE_RAG_PROFILE=lab
```

**Requisito de login:** la autenticación la hace el propietario en la ventana del laboratorio. Sin ella no se
puede observar la carga del plugin y **no se declara activación**.

### Detalle a verificar en vivo

El host descubre plugins locales por workspace y el registro de herramientas es global. Para que coincidan
plugin y ámbito, el laboratorio prevé **dos workspaces**: el repositorio (para que descubra `lifecode-rag`) y
`lab\corpus` (para que el `cwd` resuelva la raíz autorizada). Si el host no registra las herramientas en la
sesión del corpus, se anotará como hallazgo con evidencia (no se simulará).

## Hallazgo real (no bloqueante para el laboratorio)

`bin/lifecode-rag.mjs` (`project`, `root`, `select`) resuelve su registro en `<ragRoot>/registry.sqlite3`,
mientras el plugin y las herramientas usan `<profileRoot>/registry.sqlite3`. Con `LIFECODE_RAG_ROOT` apunta al
laboratorio, pero a un registro distinto del que leen las herramientas. Por eso el laboratorio se sembró con la
API de `lib/registry.mjs`, no con la CLI. Es un defecto de coherencia ya señalado en LE-RAG-02/04 y **no se
corrige aquí** (versión bajo evaluación congelada en `dfe70f5`).

## Integridad de lo habitual

- Almacén real: `4dcf31c4cb7058bb…` antes y después.
- `config.json` del perfil `desktop`: `b15622c0ab9f790f…` sin cambios.
- Perfil habitual y credenciales: no abiertos, no copiados, no reutilizados.
