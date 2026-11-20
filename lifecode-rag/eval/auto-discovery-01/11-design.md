# Diseño del descubrimiento automático

## Por qué

Una sesión nueva dentro de un proyecto ya registrado fallaba con `scope-unresolved` porque la
resolución por `cwd` sólo miraba raíces ya autorizadas, y la única raíz del perfil (`…/lifecode-rag`)
no contiene el workspace de la conversación (`…/plugins-dhs`). El usuario no debía registrar cada
proyecto a mano.

## Piezas

1. **Workspace confiable** (`lib/trusted-roots.mjs`): una persona confía una ubicación una vez
   (`trust add`). Se persiste en `meta.trusted_roots` con `path`, `pathKey`, `state`
   (`trusted`/`revoked`), `readAuthorization`, `addedBy` (`human`/`host`) y fechas. Idempotente por
   `pathKey`; `remove` revoca sin borrar proyectos. Audita `trust.add|trust.update|trust.remove`.
2. **Detección** (`lib/discovery.mjs`): indicadores conocidos (`.git`, `package.json`,
   `composer.json`, `artisan`, `*.sln`/`*.csproj`, `pyproject.toml`, `requirements.txt`, `go.mod`,
   `Cargo.toml`, `pom.xml`, `Gemfile`, `index.html`). Sólo `package.json` se lee (≤ 256 KiB) para
   clasificar Node/Vue/Nuxt/React/Angular/Svelte. Se saltan enlaces y directorios ignorados
   (`node_modules`, `vendor`, `dist`, `_audit`, cachés, secretos…).
3. **Registro idempotente** (`registerDiscoveredProject`): la identidad se ancla a la raíz
   registrada (`pathKey`). Si existe, se actualizan metadatos y se conservan `id`, almacén y
   fuentes. Si no, se crea proyecto + raíz con `allowNested` (necesario para monorepos) y se audita
   `project.discover`. Nunca se crea almacén al descubrir.
4. **Resolución** (`lib/resolve.mjs`): sin selección explícita, `cwd` → `findProjectBoundary`
   (sube hasta el workspace confiable; tolera directorios aún no creados) → auto-registro si hay
   `readAuthorization` → resolución normal. Con raíces anidadas gana la más específica
   (`mostSpecific`). La selección explícita prevalece. Sin workspace/autorización: `scope-unresolved`.

## Fronteras de seguridad

- Confiar ≠ indexar ≠ autorizar lectura: son cuatro estados distintos.
- La confianza no se infiere de que existan proyectos.
- No se autoriza nada fuera de una raíz confiable; el escaneo acotado (profundidad 4, 200 proyectos)
  no recorre el disco.
- Los secretos y binarios no se leen; las herramientas siguen excluyéndolos.
- Las sesiones no heredan selección; cada una resuelve su `cwd`.
