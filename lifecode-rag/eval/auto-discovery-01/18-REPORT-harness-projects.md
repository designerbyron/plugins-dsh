# Harness Open Projects — informe de la corrección de alcance

**Fecha:** 2026-11-19 · **Ámbito:** `lifecode-rag` · **Orden:** corrección de alcance de
auto-discovery (no confiar `C:\xampp\htdocs`; trabajar con los proyectos abiertos en Harness).
**Git de escritura:** ninguno. Rama `fix/t45-4-r17-acceptance`, HEAD `b6c0cd24621c8bc3282185d1821c60b7956f8a83`.

## 1. Qué señales reales expone DSH

- `ctx.workspaceRegistry` (servicio host): registro durable de workspaces con `id`, `path`
  canónico (`fs.realpath`), `title`, `sessionIds` y `status(): 'ok' | 'missing-dir'`.
  `list()` es una proyección síncrona; `resolveByPath(path)` no crea nada.
- `ctx.workingDirectory.get(session)` / `ensure(agent, signal)`: el `cwd` efectivo de la sesión.
- `ctx.agents.get(id)` / `list()`: agentes vivos; el `SessionId` es el mismo id que usa el host
  para la sesión.
- Cliente: slot `conversation.session.header.actions` entrega `sessionId`; servicio `workspaces`
  publica el snapshot de workspaces.
- La proyección durable se puede leer sin mutar: `$DSH_HOME/storages/workspace.json`
  (SHA-256 `862479eceb8fef269746309dfef39161db951f34589ad9df3e09db3d8abf6872` en esta sesión).

**Lo que el host NO da:** una credencial por sesión para HTTP. El `peer` del navegador es único y
con principal `owner`; `cwd` y `agent.id` no son autorización. Por eso el workspace abierto se usa
como **contexto**, nunca como permiso.

## 2. ¿Puede detectar varios proyectos abiertos?

Sí. En este host hay **7** workspaces registrados y la proyección se lee completa:

| Proyecto abierto | Sesiones |
|---|---|
| `C:\xampp\htdocs\businesssuite` | 1 |
| `C:\xampp\htdocs\carlosdiaz` | 1 |
| `C:\xampp\htdocs\edgartreelawnservices` | 1 |
| `C:\xampp\htdocs\nexusbusinesssuite` | 37 |
| `C:\xampp\htdocs\duranspainting` | 2 |
| `C:\xampp\htdocs\plugins-dhs` | 7 (incluye la sesión actual) |
| `C:\xampp\htdocs\saas-corporative` | 22 |

## 3. Cómo se identifica el proyecto de cada sesión

1. `openProjectForSession(openProjects, sessionId)` — el workspace cuyas `sessionIds` contienen la
   sesión (así la actual, `session-de66bc5f-…`, queda ligada a `plugins-dhs`).
2. `openProjectForCwd(openProjects, cwdKey)` — el workspace más específico que contiene el `cwd`.
3. Si el proyecto abierto es hijo del `cwd` (caso `htdocs` → `plugins-dhs`), la resolución va
   directa a su `projectId` en lugar de exigir coincidencia por prefijo.
4. Sin proyecto abierto, se conserva el camino anterior: `cwd` dentro de un `trusted root` +
   `findProjectBoundary`.

## 4. Qué autorización requiere cada proyecto

`trust add --path <ruta exacta del proyecto> --read true`. Es por proyecto: abrir `plugins-dhs` no
registra `businesssuite` ni ningún hermano, y confiar `htdocs` no es necesario (ni aconsejado).
Sin ese trust, la llamada falla en cerrado:

```
scope-unresolved · reason: project-not-authorized
command: node bin/lifecode-rag.mjs trust add --path "C:\xampp\htdocs\plugins-dhs"
```

Repetir la autorización no duplica: `addTrustedRoot` es idempotente por `pathKey`.

## 5. ¿El caso actual `plugins-dhs` funciona?

- **Local (código nuevo):** sí. `tests/harness-projects.test.mjs` 7/7 y la prueba de forma real
  (`16-harness-shape.txt`) demuestran: sin trust → rechazo con comando; con trust sólo de
  `plugins-dhs` → resuelve `plugins-dhs` con `cwd C:\xampp\htdocs`; hermanos: ninguno.
- **Host vivo:** **todavía no**, por dos motivos independientes y no simulados:
  1. el registro real no tiene `trusted_roots` (`trust_meta=NULL`), así que la política correcta
     es rechazar;
  2. el proceso del host arrancó a las `14:13:14` y `lib/harness-workspaces.mjs` se escribió
     después: el código en ejecución aún es el anterior, que resuelve por `cwd` contra trust.
  La llamada real `lifecode_rag_search("project-aware")` de esta sesión devolvió
  `Error: el directorio de trabajo no está dentro de ninguna raíz autorizada`, coherente con el
  estado real; no se forcejeó la respuesta.

## 6. Qué prueba real se ejecutó

1. `node --test` completo: **346/346 PASS** (`15-tests-full-after-harness.txt`, 26,4 s).
2. `tests/harness-projects.test.mjs`: 7/7 (`14-tests-harness-projects.txt`).
3. `scripts-harness-shape.mjs` sobre una **copia** del registro real (`VACUUM INTO`), con los
   proyectos abiertos leídos de `workspace.json`: rechazo sin trust, resolución con trust exacto,
   hermanos no registrados, `EXIT 0` (`16-harness-shape.txt`). Hashes del registro y del almacén
   reales idénticos antes y después.
4. Sonda de sólo lectura (`17-harness-live-state.txt`): 1 proyecto, 1 raíz, 0 bibliotecas,
   0 grants, `trust_meta=NULL`, almacén 121 fuentes / 964 fragmentos / 964 vectores / 141 auditorías.
5. Llamada real a la herramienta RAG: fallo cerrado, sin escritura de datos.

## 7. Limitaciones que siguen existiendo

- Falta la **autorización humana inicial** del proyecto `plugins-dhs` en el registro real
  (una sola orden). No se ejecutó: modifica datos reales.
- Falta la **recarga del host** para que el proceso use el módulo nuevo. No se solicitó reinicio.
- El panel sigue en modo demostración claramente etiquetado: no hay API con datos reales porque
  DSH no ofrece autenticación por sesión (PA-UI-0, BLOCKED). No simula datos reales.
- Los subagentes no reciben acceso: resuelven por su propia sesión/`cwd`, y sin trust no hay ámbito.
- La autorización es por proyecto abierto; abrir un proyecto nuevo requerirá su primer `trust add`
  (idempotente después).

## Archivos de esta corrección

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `lib/harness-workspaces.mjs` (nuevo) | 3 279 | `fd3a8f761b5134899d4501ebd618698a49dbb843b15c9af1f2714e666e89818e` |
| `lib/resolve.mjs` | 12 482 | `4ec92b48b2a56cc17ee63017993e0f0327ce52873f05fdd3d1d5b633c801016c` |
| `lib/exec-context.mjs` | 10 460 | `03e14543bc3924c13293508a5187c4a6b544b2011373da48d20dc04e24c1e8df` |
| `index.js` | 6 215 | `9becb19d3cc05c578163c0ab5e34679215d550bb6e74f0d6c6c93a097f4055a8` |
| `tests/harness-projects.test.mjs` (nuevo) | 8 858 | `dd684755fdef66e0deed0b112bc5de4e5741f0b853fa768873a5d466c79d1330` |
| `docs/AUTO-DISCOVERY.md` | 6 570 | `206bb3bfb3ba79826a7ab39707784571b38bfa2c6404783a6f06b4a121b23072` |
