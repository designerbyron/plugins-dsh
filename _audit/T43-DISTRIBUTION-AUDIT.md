# T43 — Auditoría del instalador real de DSH y de la instalabilidad del plugin

Fecha: 2026-11-09. Autor: `architect-contract` (task-44). Objetivo: determinar si
`lifecode-skill-center` puede instalarse desde GitHub con **Plugins → Add plugin**, con qué
forma exacta, y quién bloquea si no se puede.

Método: lectura del asar oficial extraído a `_audit/t43-arch/extracted/` (12 paquetes),
del bundle de `pnpm` que trae el launcher y del perfil `desktop`. **No se ejecutó ninguna
instalación**: todo lo que no es una lectura de código se marca como tal en §8.

## 0. Veredicto

1. **El contrato del instalador sirve.** Acepta una sola cadena de spec (§1) y una spec
   git pasa intacta, con su fragmento `#…`, hasta `pnpm add` (§2, §3).
2. **La forma instalable del plugin existe**:
   `github:designerbyron/plugins-dsh#path:/lifecode-skill-center`.
   `pnpm` 11.28.5 entiende `path:` y sirve el subdirectorio (§3); el instalador no lo estorba.
3. **BLOCKED de publicación, no de contrato.** La rama `main` publicada **no contiene**
   `lifecode-skill-center/` (§7): hoy esa spec falla al resolver el subdirectorio. Sin
   publicar la carpeta no hay URL instalable. El cambio mínimo es de publicación, no de código.
4. La URL que circuló, `https://github.com/designerbyron/plugins-dhs`, es un alias que
   redirige al repo real `plugins-dsh` (§7.1). Usar el nombre canónico.
5. Los metadatos del plugin no bloquean la instalación, pero tienen tres huecos
   (`files`, `engines`, versión de `dsh-tools`) que no impiden instalar hoy (§5).

## 1. Qué acepta el diálogo

El diálogo **no tiene campos separados**: tiene un único campo de spec y un selector de
registro. `dsh-client-ui-plugin-manager/README.md` L52-58: la acción «Install a third-party
plugin» abre el mismo diálogo «for a package name, Git repository, or local directory»; L65:
«Add plugin takes a package name with an optional version, a Git address, a tarball, or an
absolute local path; the dialog says a package name is what follows `dsh plugin add` in a
README». L191: «Only bundles are managed — a dependency without a bundle patch is refused
before it installs». L194: «No version picker — the spec is typed as pnpm accepts it».

El Host clasifica la cadena con `parseInstallSpec` (`dsh-plugin-manager/lib/types/install-spec.js`,
119 líneas), L58-87:

| Forma | Reconocida por | Ejemplo | Resultado |
|---|---|---|---|
| Nombre de registro | L19 `PACKAGE_NAME`, L78-86 | `@scope/pkg@1.2.3` | `{kind:'registry',name,range?}` |
| Ruta local | L62-67 (absoluta obligatoria) | `C:\xampp\htdocs\plugins-dhs\lifecode-skill-center` | `{kind:'path',path}` |
| Ruta `file:`/`link:` | L62-67 | `link:C:/…/lifecode-skill-center` | `{kind:'path',path}` |
| Tarball | L17, L66, L74-75 | `https://host/x.tgz` | `{kind:'tarball',host}` |
| Git shorthand | L9, L13-15, L70-72 | `github:owner/repo#ref` | `{kind:'git',spec,host}` |
| URL git | L10, L70-72 | `git+https://github.com/o/r.git#ref` | `{kind:'git',spec,host}` |
| URL de repo alojado | L11, L70-72 | `https://github.com/o/r` | `{kind:'git',spec,host}` |

Rechazos con mensaje literal: spec vacía ⇒ «the package spec must not be empty» (L61);
ruta relativa `./x` o `../x` ⇒ «a local path must be absolute» (L65, L68-69); URL http(s)
que no sea git ni tarball ⇒ «a URL must point at a git repository or a tarball» (L76);
nombre fuera de `PACKAGE_NAME` o >214 caracteres ⇒ «not a package name the registry accepts»
(L20, L81-83); `@` sin rango ⇒ «a version after @ must not be empty» (L84-85).

Consecuencia práctica: una URL de navegador con `/tree/<rama>/<subcarpeta>` **no** es una
spec válida (el tercer segmento de `HOSTED_REPOSITORY_URL` en L11 no admite `/`); cae en la
rama http(s) y se rechaza con el mensaje de L76.

## 2. Resolución de `github:owner/repo#ref`

1. **Parseo**: L70-72 devuelve `{kind:'git', spec, host: gitHost(spec)}`; `gitHost` (L40-48)
   sólo deriva el host (shorthand, `git@host:` o `new URL(...).host`). El fragmento `#…`
   **se conserva íntegro** dentro de `spec`: el parser no lo interpreta.
2. **Pre-chequeo de red**: `installBundle` llama a `checkGithubConnection`
   (`dsh-plugin-manager/lib/index.js` L2746; función en L1284). Sólo actúa para
   `spec.kind==='git'` y sólo para hosts `github.com`/`*.github.com`; recorta el fragmento
   con `spec.spec.replace(/#.*$/s,'')`, normaliza el shorthand a `https://github.com/…` y
   ejecuta `git -c credential.helper= ls-remote -- <repo> HEAD` con timeout
   `githubConnectionTimeoutMs` (5000 ms). Sólo `network`/`timeout` abortan, y lo hacen con
   `failedAt:'spec-host'` (L2760-2773). Para el resto de hosts no hay chequeo.
3. **Transporte**: `chooseGitTransport` (L2775) puede cambiar a SSH si sólo SSH puede leer.
4. **Instalación**: la spec (ya resuelta por el transporte) entra literal en
   `pnpm add <installSpec> [--save-exact]` (L2801-2806).
5. **Identificación posterior**: tras el run, el paquete instalado se deduce del diff del
   manifiesto del perfil — `installed = Object.keys(after).filter(n => before[n] !== after[n])`
   (L2831-2832), y si el diff está vacío se recurre a `specPackageName` (L2833-2836). Con más
   de un nombre ⇒ `ambiguous-install` (L2838).
6. **Límite conocido**: `namedSpecManifest` (L500) devuelve `undefined` para git y tarball;
   `specPackageName` (L1675) para git sólo acierta si la dependencia guardada es **exactamente**
   la misma spec (`dependencySpec`, L104). Por eso un git/tarball «se juzga después de instalar»
   (`dsh-plugin-manager/README.md` L50 y L77-83) y el atajo `already-installed` con HMR no
   protege (L2733 exige `known !== undefined`).

## 3. Subdirectorio: `#path:`

`pnpm` 11.28.5 que trae el launcher
(`…\resources\runtime\primary-runtime\dependencies\pnpm\dist\pnpm.mjs`, 15 896 609 B) lo
soporta de forma explícita:

- `parseGitParams(committish)` (F:~139568): parte el fragmento por `&`; `semver:<rango>` ⇒
  `gitRange`; `path:<sub>` ⇒ `result.path`; el resto es `gitCommittish`.
- `prepareFetchedPackage(...)` (F:~143743) pasa `resolution.path ?? ""` como `subDir` a
  `preparePackage(opts, tempLocation, subDir)` (F:~130125), que hace
  `pkgDir = safeJoinPath(gitRootDir, subDir)`.
- `safeJoinPath(root, sub)` (F:~130193): `const normalizedSub = sub.replace(/^[/\\]+/, "")`
  antes de `path.join`, con guardas de escape (`path.relative` + `realpath`). Por eso
  `#path:/lifecode-skill-center` y `#path:lifecode-skill-center` son equivalentes y válidos.
- `packageShouldBeBuilt` (F:~130181): no hay build si el manifiesto no declara
  `prepare`/`prepublish` (nuestro paquete no los tiene) o si el `main` ya existe. Es decir,
  **la ausencia de `prepare` no rompe nada**.
- El path entra en la identidad del paquete (`createGitHostedPkgId` añade `#path:…`), lo que
  permite convivir con otra instalación del mismo repo sin subcarpeta.

Composición del fragmento: los parámetros se separan con `&`, de modo que una referencia fija
más subcarpeta se escribe `#<committish>&path:/lifecode-skill-center`.

El instalador no interfiere: conserva el fragmento (§2.1) y sólo lo recorta para el
`ls-remote` de GitHub (§2.2). Por tanto la spec de §6 llega a `pnpm` sin pérdida.

## 4. Requisitos reales de activación

1. **El paquete debe declarar `dsh.bundle`**: si no, `not-bundle`
   (`dsh-plugin-manager/lib/index.js` L2842; también L2340 con el mensaje
   «declares no dsh.bundle»).
2. **El patch debe existir y cargar**: `loadOverlayPatches("dsh", file)` por cada
   `bundlePatchPaths(dir, manifest.dsh.bundle)` (L2845); la ruta de instalación oficial exige
   además que el fichero exista y sea regular (L1038). Un patch declarado e inexistente
   aborta la instalación y restaura `package.json`+`pnpm-lock.yaml` (L2848-2850).
3. **El `name` del patch debe coincidir con el nombre del paquete instalado**. Éste se lee del
   manifiesto del subdirectorio (L2840-2841), no del nombre del repo.
4. **Compatibilidad post-instalación**: `evaluatePluginCompatibility` (L2843-2844) rechaza con
   `incompatible-version` y restaura; se puede eximir en `compatibility.json` con
   `acceptRisk` (`dsh-plugin-manager/README.md` L77-83).
5. **Sólo bundles**: una dependencia sin patch se rechaza antes de instalar
   (`dsh-client-ui-plugin-manager/README.md` L191).
6. **`pnpm` debe existir**: `dsh-plugin-manager/README.md` L33 exige `pnpm` en `PATH` o un
   `pnpmCommand` explícito, con precedencia para el gestor que provee el launcher. El
   passthrough de este escritorio lo cumple: `…\resources\runtime\versions.json` declara
   `{node:"24.21.0", pnpm:"11.28.5"}` y el binario está en
   `…\runtime\primary-runtime\dependencies\pnpm\` (no hay `pnpm` en `PATH`).

## 5. Auditoría de `lifecode-skill-center/package.json`

45 líneas. Campos con consecuencia real:

| Campo | Valor | Consecuencia |
|---|---|---|
| `name` | `@local/lifecode-skill-center` | Es el nombre que pnpm guardará como dependencia y el que debe citar el patch. `@local/` no es un scope publicado: no hay registro de por medio, que es lo que queremos. |
| `version` | `1.0.1` | Queda fijada en el lockfile del perfil; sin selector de versión (UI README L194). |
| `private` | `true` | No impide instalar desde git; impide publicar en un registro. Correcto para este uso. |
| `repository.directory` | `lifecode-skill-center` | Correcto **si** la carpeta se publica en esa ruta del repo. Hoy no está (§7). |
| `icon`, `exports`, `type`, `dsh.client` | `./icon.svg`, `./`,`./client`,`./package.json`,`./lib/*`, `web`, `immediately:true`, `inject:[dsh-client-ui-conversation]` | Contrato de bundle correcto; el `client` se resuelve por `exports`. |
| `dsh.bundle.patch` | `./cordis.patch.yml` | Existe en el repo y su `insert` usa `name: '@local/lifecode-skill-center'`, que coincide con el manifiesto. |
| `dependencies` | `@deepseek-ai/dsh-tools: 0.2.0-rc.2` | Existe en el registro (la instalación desde git resuelve la dependencia con pnpm). El Host trae `0.2.2-rc.1`; el plugin carga su propia copia porque `~/.dsh/profiles/desktop/node_modules/@deepseek-ai` sólo contiene `cosmokit` y `schemastery`. |
| `files` | **ausente** | El tarball que pnpm construye desde git incluye todo lo no ignorado: `tests/`, `docs/`, `package-lock.json`, logs. No rompe, pero engorda y publica ruido. |
| `prepare` | **ausente** | Irrelevante: `packageShouldBeBuilt` (F:~130181) da `false` sin scripts de build. |
| `engines.dsh` / peers DSH | **ausentes** | No hay puerta de compatibilidad: una futura versión de DSH incompatible no se detectará al instalar (§4.4). |

`node_modules/` está en `.gitignore`, así que no viaja en el tarball; la dependencia
`@deepseek-ai/dsh-tools` la instala pnpm desde el registro. Forma canónica de referencia: el
bundle de terceros ya instalado `~/.dsh/profiles/desktop/node_modules/dsh-plugins-update/package.json`
declara `files` explícito con `lib`, `cordis.patch.yml`, `locale`, `icon.svg` y READMEs, y
`dsh.bundle.patch` + `dsh.client.inject`; es el patrón que a este paquete le falta en `files`.

## 6. Especificaciones exactas

Instalables hoy (sin tocar el repo):

```text
# ruta local absoluta — la única que funciona sin publicar
C:\xampp\htdocs\plugins-dhs\lifecode-skill-center
```

Instalable **en cuanto se publique la carpeta** (§7):

```text
# rama por defecto, siempre la última
github:designerbyron/plugins-dsh#path:/lifecode-skill-center

# fijada por commit (reproducible)
github:designerbyron/plugins-dsh#bbd5e38abae7a8817668615e1ba1be22b3e68d23&path:/lifecode-skill-center

# forma URL equivalente
git+https://github.com/designerbyron/plugins-dsh.git#path:/lifecode-skill-center
```

No usar:

- `https://github.com/designerbyron/plugins-dsh/tree/main/lifecode-skill-center` — rechazada
  por el parser (mensaje de L76).
- `designerbyron/plugins-dsh` sin `github:` ni `https://` — se leería como nombre de registro.
- `@local/lifecode-skill-center` — nombre de registro; no está publicado.

## 7. BLOCKED: qué falta exactamente

### 7.1 Evidencia de publicación

- `git ls-remote --symref https://github.com/designerbyron/plugins-dsh HEAD` ⇒
  `ref: refs/heads/main` + `bbd5e38abae7a8817668615e1ba1be22b3e68d23`; **sólo existe `main`**.
- `GET https://api.github.com/repos/designerbyron/plugins-dsh/contents?ref=main` ⇒ raíz con
  `.dsh`, `.gitattributes`, `.gitignore`, `.htaccess`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`,
  `MEMORY.md`, `README.md`, `assets/`, `docs/`, `plans/`, `skill-compiler/`.
  **No aparece `lifecode-skill-center/`.**
- `GET https://api.github.com/repos/designerbyron/plugins-dhs/contents?ref=main` resuelve al
  mismo repositorio (`/repositories/1416213899/…`) con contenido idéntico: `plugins-dhs` es un
  alias/redirección, no un repo distinto.
- En local: `git ls-files lifecode-skill-center` ⇒ 48 ficheros trackeados; rama actual
  `feature/visual-operation-feedback`; `git status --porcelain lifecode-skill-center` ⇒ 128
  entradas. Esa rama no está publicada.

Efecto: `pnpm` resolvería el repo, descargaría el tarball de `main` y no encontraría
`path:/lifecode-skill-center` ⇒ falla el run y el instalador restaura manifiesto y lockfile
(L2848-2850).

### 7.2 Cambio mínimo (NO aplicado)

1. Commit de `lifecode-skill-center/` (48 ficheros, sin `node_modules`) y push a `main`; o
   push de la rama actual y uso de `#<rama>&path:/lifecode-skill-center`.
2. Reintentar la instalación con la spec de §6.
3. Opcional, no bloqueante: añadir `files` (como el bundle de §5), decidir si se fija
   `engines.dsh`, y alinear `@deepseek-ai/dsh-tools`.

No se ha ejecutado nada de esto: requiere autorización del Lead.

## 8. Riesgos y lo no verificado

- **No se probó una instalación real** (restricción de la tarea). Todo el comportamiento de
  `pnpm` con `path:` se deduce del código del bundle (F:~139568, ~143743, ~130125, ~130193) y
  de que la máquina ya tiene installs desde GitHub (`github:` → tarball de codeload) en
  `~/.dsh/profiles/desktop/pnpm-lock.yaml`.
- Un repo privado cambiaría el análisis (credenciales, `git ls-remote` con auth): no es el caso.
- `#path:` sobre `main` es móvil: una publicación posterior cambia lo instalado. Para
  reproducibilidad, fijar commit — pero el commit debe contener la carpeta.
- Actualizaciones: el bundle instalado desde git/path/link no muestra sección Versions
  (UI README L73) y no hay selector de versión (L194); actualizar = reinstalar.
- El alias `plugins-dhs` funciona hoy por redirección de GitHub, pero no debe usarse en
  documentación ni en la spec.

## 9. Reproducción

```powershell
# extracción (ya hecha): paquetes del asar
node _audit/t43-arch/list.mjs plugin-manager
node _audit/t43-arch/extract.mjs dsh-plugin-manager dsh-client-ui-plugin-manager

# repo publicado
git ls-remote --symref https://github.com/designerbyron/plugins-dsh HEAD
(Invoke-RestMethod 'https://api.github.com/repos/designerbyron/plugins-dsh/contents?ref=main').name

# pnpm del launcher
Get-Content "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\versions.json"
Select-String -Path "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\pnpm\dist\pnpm.mjs" -Pattern 'function parseGitParams|function safeJoinPath|function preparePackage'
```
