# Descubrimiento automático de proyectos y resolución por sesión

**Fecha:** 2026-11-19 · **Estado:** implementado y probado en local · **Ámbito:** `lifecode-rag`

## Qué problema resuelve

Antes, una sesión nueva sin selección explícita fallaba con `scope-unresolved` aunque su `cwd`
estuviera dentro de un proyecto real ya registrado, y el panel mostraba datos sintéticos como si
fueran el proyecto activo. Ahora el plugin puede **descubrir** proyectos dentro de una ubicación de
trabajo en la que el usuario confía, **registrarlos** de forma idempotente y **resolver** el proyecto
de la sesión por su `cwd`, sin exigir selección manual y sin ampliar por su cuenta el ámbito de lectura.

## Los cuatro conceptos (no son sinónimos)

| Concepto | Qué significa | Dónde vive |
|---|---|---|
| Workspace confiable | Ubicación de trabajo que una persona confió una vez (`trusted_roots`, máx. 32) | `meta.trusted_roots` del registro |
| Proyecto descubierto | Proyecto detectado por indicadores dentro de un workspace confiable | resultado de `scanWorkspace` |
| Proyecto registrado | Proyecto con identidad estable (`prj_…`) y raíz autorizada | tablas `projects`/`roots` |
| Proyecto indexado | Proyecto con almacén de ámbito y fuentes | `profiles/<perfil>/scopes/<id>/rag.sqlite3` |

Descubrir **no** indexa, **no** lee documentos y **no** autoriza lectura. La única autorización que
abre la puerta es `trust add --path <abs>` (por defecto con autorización de lectura) ejecutada por una
persona o por un mecanismo del host. Sin `readAuthorization`, la resolución automática no registra nada.

## Indicadores reconocidos

`artisan` (Laravel), `composer.json` (PHP), `package.json` (Node, clasificado por dependencias en
nuxt/next/vue/react/angular/svelte), `*.sln`/`*.csproj` (.NET), `pyproject.toml`/`requirements.txt`
(Python), `go.mod`, `Cargo.toml`, `pom.xml`, `Gemfile`, `.git` (Git), `index.html` (web). Sólo se lee
`package.json` (≤ 256 KiB) para clasificar; nunca ficheros de secretos (`.env*`, claves, `.npmrc`,
`credentials.json`, …).

Se excluyen `.git`, `node_modules`, `vendor`, `dist`, `build`, `out`, `target`, `bin`, `obj`,
`.next`, `.nuxt`, `__pycache__`, `.venv`, `venv`, `cache`, `tmp`, `.idea`, `.vscode`, `secrets`,
`.ssh`, y los enlaces simbólicos (se registran como `skipped`, no se recorren).

## Registro idempotente

`registerDiscoveredProject` se apoya en la raíz registrada (`roots.path_key`): si el proyecto ya
existe se actualizan sólo los metadatos (`project_discovery:<id>`: tipo, indicadores, primera/última
detección, raíz registrada) y se **conservan** el `id`, el almacén y las fuentes. Un cambio de ruta
crea una entrada nueva de descubrimiento, no reescribe el proyecto histórico. Nunca se crea un
almacén por descubrir.

## Resolución por sesión

1. Identidad del host (`exec.agent.id`) y perfil.
2. Selección explícita si existe (prevalece, incluidas raíces anidadas: gana la más específica).
3. Si no hay selección: `cwd` → `findProjectBoundary` (sube desde el `cwd` hasta el workspace
   confiable, tolera directorios aún no creados) → auto-registro si hay autorización de lectura →
   `resolveScope` normal.
4. Sin workspace confiable, sin autorización o fuera de toda raíz: `scope-unresolved` (nunca una
   búsqueda global, nunca un proyecto por defecto).

## CLI

```sh
node bin/lifecode-rag.mjs trust add --path C:\xampp\htdocs\plugins-dhs --read true
node bin/lifecode-rag.mjs trust list
node bin/lifecode-rag.mjs discover scan --path C:\xampp\htdocs\plugins-dhs
node bin/lifecode-rag.mjs discover register --path C:\xampp\htdocs\plugins-dhs --read true
node bin/lifecode-rag.mjs discover show --project prj_…
node bin/lifecode-rag.mjs trust remove --path C:\xampp\htdocs\plugins-dhs
```

`trust remove` revoca la confianza sin borrar proyectos ni almacenes.

## Límites conocidos

- El panel sigue siendo **informativo** (fixtures de demostración claramente etiquetados): no hay API
  con datos reales porque DSH no ofrece autenticación por sesión (PA-UI-0, BLOCKED). Las herramientas
  del agente sí usan datos reales.
- La confianza se guarda en `meta` para no migrar el esquema; el día que haya tabla propia se migrará
  con procedimiento reversible.
- No se descubren proyectos por red ni en unidades no confiadas; el escaneo es local y acotado
  (`maxDepth` 4, `maxProjects` 200).

## Harness Open Projects (2026-11-19)

DeepSeek Harness mantiene un registro durable de *workspaces* (`ctx.workspaceRegistry`): ruta
canónica, título y sesiones que lo tienen abierto. El plugin lo usa como la señal de **qué
proyectos tiene abiertos la persona**, en vez de deducirlo de `cwd` o de confiar en una carpeta
contenedora:

- `lib/harness-workspaces.mjs` normaliza los workspaces vivos (`listOpenProjects`) y resuelve el
  proyecto de una sesión (`openProjectForSession`) o el que contiene un `cwd`
  (`openProjectForCwd`). Los workspaces cuyo directorio ya no existe (`status() !== 'ok'`) se
  omiten.
- Si la sesión pertenece a un proyecto abierto, ese proyecto es el candidato aunque su `cwd`
  apunte a la carpeta contenedora. Abrir `plugins-dhs` **no** registra `businesssuite`,
  `carlosdiaz` ni ningún hermano.
- Abrir un proyecto **no es autorizar**: la lectura sigue exigiendo `trust add` sobre la ruta del
  proyecto. Sin esa autorización la llamada falla en cerrado con `scope-unresolved`,
  `reason: "project-not-authorized"` y el comando exacto en `details.command`.
- Cuando el proyecto abierto es hijo del `cwd`, la resolución va directa a su id en lugar de
  exigir una coincidencia por prefijo.

La prueba de forma real (`eval/auto-discovery-01/scripts-harness-shape.mjs`) copia el registro
real con `VACUUM INTO`, lee `$DSH_HOME/storages/workspace.json` y demuestra: sin trust →
`project-not-authorized`; con trust sólo de `plugins-dhs` → resuelve ese proyecto con `cwd`
`C:\xampp\htdocs`; ningún hermano registrado; el registro y el almacén reales no cambian
(hashes antes/después en `16-harness-shape.txt`).

### Límite de esta entrega

El agente que atiende esta sesión ejecuta el código cargado en el arranque del host. Este módulo y
la resolución por proyectos abiertos se escribieron **después** de ese arranque, así que la
verificación en vivo del host queda pendiente de la próxima recarga; las pruebas locales y la
prueba de forma real están en verde. El registro real tampoco tiene todavía un `trusted root` para
`plugins-dhs`, de modo que una llamada real sigue fallando en cerrado a propósito.
