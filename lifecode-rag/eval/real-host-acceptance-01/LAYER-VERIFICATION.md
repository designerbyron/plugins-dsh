# Verificación por capas (proceso actual)

Fecha: 2026-11-19 · DSH arrancado a las **14:26:43** (pid 12780; host `dsh-desktop-host` pid 2024).
Sin reinicio, sin cambios de selección, permisos ni configuración.

## Capas

| Capa | Pregunta | Resultado | Cómo se comprobó |
|---|---|---|---|
| **1. Módulo en disco** | ¿Existe `lib/harness-workspaces.mjs`? | **SÍ** — 3 279 B, `mtime` 14:15 | `ls`; importado por `resolve.mjs`, `exec-context.mjs`, `tests/harness-projects.test.mjs` |
| **2. Módulo cargado en el proceso** | ¿Lo cargó esta instancia? | **INFERIDO, no medido** | DSH arrancó **después** del `mtime` y **ningún** fichero del plugin cambió tras el arranque (0 resultados en `find -newermt`). Sin inspector ni CDP en el proceso → no se puede leer el heap |
| **3. Workspace detectado** | ¿`workspaceRegistry.list()` devuelve abiertos? | **SÍ, a nivel de registro durable** | `~/.dsh/storages/workspace.json`: 7 workspaces; `plugins-dhs` → `C:\xampp\htdocs\plugins-dhs`, 7 sesiones, **incluye `session-c90d50d6-…`**. El objeto vivo no es invocable desde fuera |
| **4a. Proyecto resuelto (sesión actual)** | ¿Qué proyecto? | **`LifeCode RAG`** (`prj_01M7RBSRD33M26HGBEFW51WPP6`), origen **`explicit`**, raíz `…\plugins-dhs\lifecode-rag` | `resolveScope` real sobre copia del registro con los openProjects reales |
| **4b. Proyecto resuelto (sesión sin selección)** | ¿Auto-descubre `plugins-dhs`? | **SÍ** — proyecto `plugins-dhs`, raíz `…\plugins-dhs`, origen **`cwd`** (workspace abierto + trusted root) | misma función, sesión sintética, copia del registro |
| **5. Herramienta invocada** | ¿`search`/`get` reales? | **`NOT TESTED` en el proceso vivo**; **PASS sobre copia** (list 121 · search 3 · get 10 fragmentos · context 3 citas) | camino completo de herramienta con `services.workspaces` reales y `cwd` real |

## Dato clave

El workspace está **confiado** (`meta.trusted_roots` = `c:/xampp/htdocs/plugins-dhs`, `trusted`,
`readAuthorization: true`). Por tanto la auto-descubierta funciona.

Pero la sesión actual tiene **selección explícita** a `LifeCode RAG`: la selección manda sobre el `cwd`. Esa
sesión buscará en el proyecto **LifeCode RAG** (121 fuentes, con URIs del repositorio), no en un proyecto
llamado `plugins-dhs`.

## Qué pasa si se resuelve `plugins-dhs`

La primera llamada de una sesión sin selección desde `C:\xampp\htdocs\plugins-dhs` **crea** proyecto, raíz y
almacén de ámbito (escritura). Por eso se demostró sobre copia: en el registro real eso no se ha ejecutado.

## Identificadores reales observados (copia)

- Proyecto actual: `prj_01M7RBSRD33M26HGBEFW51WPP6` — 121 fuentes / 964 fragmentos.
- Búsqueda `project-aware` (modo `and`, 34 ms):
  - `src_a26afe7725768150` · `docs/PROJECT-AWARE-ERROR-CONTRACT.md` §2 «Códigos»
  - `src_c3f912136c2f1107` · `docs/PROJECT-AWARE-ARCHITECTURE.md` §18.5
  - `src_c3f912136c2f1107` · `docs/PROJECT-AWARE-ARCHITECTURE.md` (tercer fragmento)
- `get` sobre `src_a26afe7725768150`: 10 fragmentos, título «Contrato de errores — Project-Aware RAG (PA0)».
- `context`: 3 citas, 772 tokens, truncado por presupuesto de 900.

## Línea base: el perfil cambió a las 14:23 (explicado)

El manifiesto del acto anterior ya no coincide con el registro real. La causa está medida, no supuesta:

| Dato | Valor |
|---|---|
| `mtime` del registro real | **2026-11-19 14:23:03** (antes del arranque de DSH, 14:26:43) |
| Entradas de auditoría | **41 → 44**; la última, `seq 44`, escrita a las 14:23:03 |
| Proyectos / raíces / sesiones | 1 / 1 / 1 — **sin cambios** |
| Trusted root | `c:/xampp/htdocs/plugins-dhs`, `trusted`, `readAuthorization: true` |

Es decir: a las 14:23 se registró el **workspace confiable** (tres entradas de auditoría) y el registro se
reescribió. No lo escribió esta misión: todas las sondas corrieron sobre copias y la única apertura directa fue
`readOnly`, tras la cual el manifiesto siguió idéntico (`sin_cambios=si`).

Nueva línea base para futuras comprobaciones: `baseline-1423.sha256` y `baseline-1423.files.tsv`.

