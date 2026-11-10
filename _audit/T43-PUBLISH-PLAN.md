# T43b — Plan de publicación de `lifecode-skill-center` para instalarlo desde GitHub

> Estado: **plan, no ejecutado**. Nada de este documento se ha aplicado: ni commit, ni push, ni cambio de
> `package.json`. La evidencia sale del árbol de trabajo de `C:\xampp\htdocs\plugins-dhs` en la instantánea
> S1 (HEAD `3b295106e5263858c32bd4db4c110068a4bad687`, rama `feature/visual-operation-feedback`).
> Este repo se edita en paralelo: cualquier cifra debe re-medirse antes de actuar.

## 1. Veredicto

**BLOCKED por publicación, no por contrato.** La forma instalable que el instalador real acepta existe y
está verificada:

```
github:designerbyron/plugins-dsh#path:/lifecode-skill-center
```

Hoy falla por un único motivo: **la carpeta del plugin no está en `main`** (ni en `origin/main`), así que
pnpm descarga un árbol donde ese subdirectorio no existe. Además hay **tres huecos de metadatos** (§4) que
no impiden instalar pero sí empeoran el resultado: el paquete se publica con `tests/`, `tools/`, `docs/images`
y un log ajeno; y declara como dependencia física un paquete que el Host ya provee en runtime.

El cambio mínimo es **publicar la carpeta + ajustar `package.json`**; no hay cambio de código de producto.
Ninguna de las dos cosas se ejecuta desde aquí: las aprueba y las aplica una persona.

## 2. Estado medido del repositorio (S1)

| Dato | Valor medido |
|---|---|
| `HEAD` | `3b295106e5263858c32bd4db4c110068a4bad687` en `feature/visual-operation-feedback` |
| `main` local | `707fb49` |
| `origin/main` | `bbd5e38` (**divergen**) |
| `git ls-tree main` / `origin/main` | `.dsh`, `.gitattributes`, `.gitignore`, `.htaccess`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `MEMORY.md`, `README.md`, `assets`, `docs`, `plans`, `skill-compiler` — **sin `lifecode-skill-center`** |
| `git status --porcelain -uall` | 2069 entradas: **39 `M` + 2030 `??`** |
| `git diff --stat` | 39 ficheros, +13 781 / −940 (trabajo de R16/R17, fuera del plugin) |
| Ficheros trackeados en el plugin | **48** |
| Ficheros sin trackear dentro del plugin | **113**: `tests/` 73, `lib/` 15, `tools/` 13, `docs/` 11, `CHANGELOG.md` 1 |
| `npm pack --dry-run` hoy (sin `files`) | **161 ficheros / 3 872 453 B** |

Consecuencia práctica: `lib/` tiene 15 módulos sin trackear (los de R16/R17: `inventory`, `projects`,
`collisions`, `preflight`, `distribute`, `activity`, `insights`…). **Publicar sólo lo trackeado rompe el
plugin**. El commit debe incluir la carpeta completa, no el índice actual.

## 3. Qué se publica exactamente

Sí (todo dentro de `lifecode-skill-center/`):

- `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md`, `cordis.patch.yml`, `icon.svg`
- `index.js`, `client.js`, `lib/**` (25 `.mjs`), `docs/**` (8 `.md` + `docs/images/` 8 PNG)
- `tests/**` y `tools/**` — se publican en el repo (historia y verificación), pero **no** deben entrar en el
  paquete instalado; para eso está `files` (§4.3).

No:

- `_audit/**` (1832 ficheros de investigación: este informe incluido), `"_audit/**` (77), `plans/**`,
  `skill-compiler/**`, `assets/**` de la raíz: no forman parte del plugin.
- `lifecode-skill-center/node_modules/**` (ignorado por `.gitignore`; el instalador resuelve en runtime).
- `lifecode-skill-center/exports/**` (salida runtime de `writeBundle`), `.dsh/**`.
- **`lifecode-skill-center/r161-contract.log`** (7548 B, sin trackear y **sin** entrar en `.gitignore`):
  hoy `npm pack` lo incluye. Debe excluirse del paquete; ver §4.3 y §10.

## 4. Metadatos: las tres respuestas con evidencia

### 4.1 ¿`engines.dsh` es un campo real o el Host sólo exige `dsh.bundle.patch`?

**Es real y se aplica.** El único requisito *duro* para que algo sea bundle es `dsh.bundle.patch`
(`dsh-plugin-manager/lib/index.js:2842` → `not-bundle`, `:2845` carga de patches). Pero la compatibilidad se
evalúa con `engines.dsh`:

- `_audit/t43-arch/extracted/dsh-app-boot/lib/index.js:1070` — «Evaluate plugin dsh requirements
  (`engines.dsh`, else dsh peers) without importing plugin code».
- `:1089-1092` — el runtime es la versión de `@deepseek-ai/dsh-app-boot` = **`0.2.2-rc.1`**.
- `:1094-1095` — `satisfies(runtimeVersion, range) = range.trim() !== "" && semver.satisfies(..., {includePrerelease: true})`.
- `:1097-1116` — si el manifiesto declara `engines.dsh`, **ese rango decide solo** y los peers se ignoran;
  si no lo declara, se miran los peers `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`.
- `:1129-1143` — `evaluatePluginCompatibility(manifest, exemptions, runtimeVersion)`.
- `_audit/t43-arch/extracted/dsh-app-boot/README.md:52` lo documenta literalmente (rango inválido o
  `workspace:` en `engines.dsh` ⇒ incompatible); `@deepseek-ai/dsh/README.md:39` añade que instalación y
  arranque lo aplican contra `dsh --version`.
- En el instalador: `dsh-plugin-manager/lib/index.js:2843-2844` evalúa tras instalar y `:2848-2850` restaura
  `package.json` + `pnpm-lock.yaml` si falla (`incompatible-version`).

**Recomendación:** declararlo, con un rango que acepte el runtime actual y no prometa el futuro:

```json
"engines": { "dsh": ">=0.2.2-rc.1 <0.3.0" }
```

Efecto: en un Host más viejo el install falla limpio (y se revierte solo) en vez de romper en caliente.
Si se prefiere no declararlo, el comportamiento actual (sin `engines`) es válido; lo que **no** debe hacerse
es declarar un rango que no incluya `0.2.2-rc.1`.

### 4.2 ¿`private: true` afecta a `pnpm add github:...`?

**No.** En pnpm 11.28.5 (`resources/runtime/primary-runtime/dependencies/pnpm/dist/pnpm.mjs`) `private` sólo se
consulta en la ruta de publicación: `publish3` (`:361395-361402`) lanza `code: "EPRIVATE"`
(`This package has been marked as private`) y `selectUnpublishedPackages` (`:362519-362524`) lo filtra. No hay
comprobación en resolución ni en `add`. Los bundles git ya instalados en este perfil
(`dsh-plugins-update` 0.2.1, `@tuhengyu/dsh-full-life-memory` 0.7.1) tampoco lo declaran y funcionan.

**Recomendación:** conservar `"private": true` (impide publicar el paquete `@local/...` en un registro por
accidente; no afecta a instalar desde git).

### 4.3 ¿Es seguro un whitelist `files`? ¿Rompe algo?

**Es seguro, y además es efectivo en la instalación desde git**: el fetcher de git aplica el packlist antes de
guardar el paquete (`pnpm.mjs:143677` `const files = await packlist(pkgDir)`), así que `files` decide qué
ficheros acaban en `node_modules/@local/lifecode-skill-center`.

Reglas reales del packlist de pnpm (`pnpm.mjs:63405-63444`):

- Cada entrada de `files` se comprueba con **`lstat` literal** (`:63431`): si es fichero → requerido
  (`:63432-63434`); si es directorio → se ignoran sus ignores y entra el árbol (`:63435-63437`); si no existe →
  se ignora (`:63439-63441`). Sólo `x/*` se normaliza a `x/**` (`:63426-63428`). **Por eso hay que listar rutas
  literales, no globs** (`"docs"` sí; `"docs/**"` no).
- Siempre incluidos: `package.json`, `readme*`, `license*`, `copying*`, `main`, `browser`, `bin`
  (`:63408-63419`, `:63445-63455`).
- Siempre excluidos: `.git`, `node_modules`, `.npmrc`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`,
  `bun.lockb` (`:63413-63419`).

Riesgo real: **omitir** `cordis.patch.yml` hace fallar la instalación (se carga después, `dsh-plugin-manager/lib/index.js:2845`,
y el fallo revierte todo, `:2848-2850`); **omitir** `client.js` no falla la instalación pero deja el panel sin UI
(es `exports["./client"]`, lo que carga el Host); **omitir** `lib` rompe el arranque. Ninguno de los tres ocurre
con el array propuesto.

**Array propuesto (rutas literales):**

```json
"files": [
  "index.js",
  "client.js",
  "lib",
  "cordis.patch.yml",
  "icon.svg",
  "README.md",
  "CHANGELOG.md",
  "docs"
]
```

Con él, `npm pack --dry-run` debe dejar de incluir `tests/`, `tools/` y `r161-contract.log`, y seguir incluyendo
`index.js`, `client.js`, `lib/**` (25 `.mjs`), `cordis.patch.yml`, `icon.svg`, `docs/**`. `package-lock.json` se
excluye solo por packlist y no hace falta listarlo.

### 4.4 `@deepseek-ai/dsh-tools`: de dependencia física a peer

Hoy `package.json` declara `"dependencies": { "@deepseek-ai/dsh-tools": "0.2.0-rc.2" }` (versión **anterior** a
la del Host: `_audit/t43-arch/extracted/dsh-tools/package.json` = `0.2.2-rc.1`) y el plugin trae su copia en
`node_modules/`. Esto instala una copia física que puede preceder a la del runtime y romper la identidad de
clases (`defineTool` de dos copias distintas). El Host ya provee `@deepseek-ai/dsh-tools` en runtime
(`dsh-app-boot/README.md:69` «installs the runtime resolution… without creating fallback links»; `:136` peers
del runtime ganan; `:140` las entradas del runtime ocupan su nombre en `$DSH_HOME/profiles/node_modules`), y el
perfil está configurado con `autoInstallPeers: false` (`~/.dsh/profiles/desktop/pnpm-workspace.yaml`), así que un
peer no se autoinstala ni se duplica. El patrón canónico medido en un bundle instalado
(`~/.dsh/profiles/desktop/node_modules/dsh-data-quality/package.json`) es exactamente ése: `dependencies` sólo
`zod`, y los `@deepseek-ai/*` como `peerDependencies`.

**Cambio propuesto en `package.json`:**

```json
"peerDependencies": { "@deepseek-ai/dsh-tools": ">=0.2.0-0 <0.3.0" },
"devDependencies": { "@deepseek-ai/dsh-tools": "0.2.0-rc.2" },
"engines": { "dsh": ">=0.2.2-rc.1 <0.3.0" },
"files": ["index.js", "client.js", "lib", "cordis.patch.yml", "icon.svg", "README.md", "CHANGELOG.md", "docs"]
```

(se elimina `dependencies`; `devDependencies` mantiene la copia local para `npm test` en este repo).
Aviso: con `engines.dsh` presente, los peers dejan de decidir la compatibilidad (`:1097-1116`); el peer queda
como declaración de resolución, no como puerta.

## 5. Publicación: dos opciones, sin `git add -A`

Antes de cualquiera: congelar el árbol (nadie más edita mientras se publica) y re-medir §2. Todos los comandos
se ejecutan desde `C:\xampp\htdocs\plugins-dhs`. Nunca `git add -A` ni `git add .`; el commit debe tocar **sólo**
`lifecode-skill-center/`.

### Opción A (recomendada) — rama de publicación + PR/merge

```powershell
cd C:\xampp\htdocs\plugins-dhs
git status --porcelain -uall | Select-String -NotMatch '^.. lifecode-skill-center/'

# 1) rama de publicación desde la rama de trabajo (contiene los 15 lib/ y 113 ficheros sin trackear)
git switch -c publish/lifecode-skill-center

# 2) alta selectiva: SOLO la carpeta del plugin
git add -- lifecode-skill-center
#    comprobar que lo preparado es exactamente esa carpeta y nada más:
git status --porcelain | Select-String -NotMatch '^.. lifecode-skill-center/'
git diff --cached --name-only | Select-String -NotMatch '^lifecode-skill-center/'

# 3) excluir el log ajeno (no debe publicarse)
git restore --staged -- lifecode-skill-center/r161-contract.log

# 4) commit (ver §6) y push de la rama
git commit -m "feat(lifecode-skill-center): publicar el plugin y sus metadatos para instalarlo desde GitHub"
git push -u origin publish/lifecode-skill-center
```

Después: PR `publish/lifecode-skill-center → main` y merge (squash o merge, decisión humana). Ningún otro
fichero del repo viaja en esa rama porque nace del working tree actual y el commit está limitado por ruta.

### Opción B — commit selectivo directo a `main`

`main` local y `origin/main` divergen, así que **no** se hace merge de la rama de trabajo: se crea una rama
desde `origin/main` y se le trae únicamente la carpeta.

```powershell
cd C:\xampp\htdocs\plugins-dhs
git fetch origin

# 1) commit en la rama de trabajo (igual que A, pasos 1-4) para tener un objeto árbol con la carpeta
git switch -c publish/lifecode-skill-center
git add -- lifecode-skill-center
git restore --staged -- lifecode-skill-center/r161-contract.log
git commit -m "feat(lifecode-skill-center): publicar el plugin y sus metadatos para instalarlo desde GitHub"

# 2) rama desde origin/main y traer SÓLO esa carpeta de ese commit
git switch -c publish/lsc-to-main origin/main
git checkout publish/lifecode-skill-center -- lifecode-skill-center
git status --porcelain | Select-String -NotMatch '^.. lifecode-skill-center/'
git commit -m "feat(lifecode-skill-center): añadir el plugin para instalarlo desde GitHub"
git push origin HEAD:main
```

Riesgo de B: escribe en `main` sin revisión. Si se elige, hacerlo con el repo congelado y verificando en el
paso 2 que el índice sólo contiene `lifecode-skill-center/`.

## 6. Mensaje de commit

```
feat(lifecode-skill-center): publicar el plugin y sus metadatos para instalarlo desde GitHub

La carpeta no existía en main, así que `github:designerbyron/plugins-dsh#path:/lifecode-skill-center`
no resolvía. Se publica el plugin completo (lib/ de R16/R17 incluido).

Metadatos:
- files: sólo lo que el Host carga (index, client, lib, patch, icon, docs).
- engines.dsh: >=0.2.2-rc.1 <0.3.0 (runtime medido de dsh-app-boot).
- @deepseek-ai/dsh-tools pasa a peer + devDependency: el Host lo provee en runtime.

Sin cambios de comportamiento; sin tocar _audit/ ni el resto del repo.
```

## 7. Comprobaciones previas (obligatorias)

```powershell
cd C:\xampp\htdocs\plugins-dhs
git diff --check                                  # sin errores de espacios
git diff --cached --check
git status --porcelain -uall | Measure-Object     # comparar contra §2 (39 M + 2030 ??)

cd lifecode-skill-center
npm pack --dry-run --json > ..\_audit\t43-arch\pack-after.json
# debe contener: index.js, client.js, cordis.patch.yml, icon.svg, package.json, lib\*.mjs (25), docs\**
# NO debe contener: tests\, tools\, r161-contract.log, package-lock.json
(Get-Content ..\_audit\t43-arch\pack-after.json | ConvertFrom-Json)[0].files.Count

# hashes de activos (mismos que S1)
Get-FileHash icon.svg -Algorithm SHA256
Get-FileHash cordis.patch.yml -Algorithm SHA256
Get-FileHash package.json -Algorithm SHA256
```

Referencia S1: `icon.svg` `974CE3D6…A5A9D4E`, `cordis.patch.yml` `BF63F1D1…54941E39`,
`package.json` `946BE6C9…100ADA7` (los dos primeros deben seguir iguales; `package.json` cambiará por §4).
Además: `cordis.patch.yml` debe insertar `id: lifecode-skill-center` con `name: '@local/lifecode-skill-center'`,
que es el `name` del manifiesto instalado.

## 8. Spec final (para pegar en Complementos → Agregar complemento)

Con commit fijo (recomendado, reproducible):

```
github:designerbyron/plugins-dsh#<sha-de-main-de-40-hex>&path:/lifecode-skill-center
```

Sin SHA (sigue la rama; menos reproducible):

```
github:designerbyron/plugins-dsh#path:/lifecode-skill-center
```

Notas verificadas:

- `#path:` lo entiende pnpm: `parseGitParams` (`pnpm.mjs:139568`) separa por `&` y `path:` → `resolution.path`;
  `safeJoinPath` (`:130193`) recorta la barra inicial, así que `/lifecode-skill-center` es válido.
- El diálogo acepta «package name, Git repository o local directory» y el parser conserva el fragmento íntegro
  (`dsh-plugin-manager/lib/types/install-spec.js:70-72`); el pre-chequeo GitHub recorta `#…` para el
  `git ls-remote` (`dsh-plugin-manager/lib/index.js:1284-1288`).
- **No** pegar una URL `/tree/...`: `HOSTED_REPOSITORY_URL` (`install-spec.js:11`) no admite más segmentos y el
  parser la rechaza como spec.
- Esperado en la pantalla de check: para un spec git, `inspect` **no** puede decir nombre/versión/bundle antes de
  instalar (`dsh-plugin-manager/README.md:50`); mostrará forma y host, y «bundle» se decide tras instalar.

## 9. Prueba real, primero en perfil temporal (sin tocar el perfil productivo)

Con `DSH_HOME` apuntando a una carpeta de trabajo, el launcher crea allí el perfil y no toca `~/.dsh`:

```powershell
$root = 'C:\xampp\htdocs\plugins-dhs\_audit\t43-verify'
New-Item -ItemType Directory -Force $root | Out-Null
$env:DSH_HOME = Join-Path $root 'dshhome'
$dsh = '$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'

& $dsh plugin --profile t43 add "github:designerbyron/plugins-dsh#<sha>&path:/lifecode-skill-center"

# comprobaciones
Get-Content "$env:DSH_HOME\profiles\t43\package.json"
Get-ChildItem "$env:DSH_HOME\profiles\t43\node_modules\@local\lifecode-skill-center" -Recurse -File |
  ForEach-Object { $_.FullName.Substring(($env:DSH_HOME).Length) }
& $dsh --profile t43 --dump-config | Out-File (Join-Path $root 'dump-config.json') -Encoding utf8
Select-String -Path (Join-Path $root 'dump-config.json') -Pattern 'lifecode'
```

Evidencias a capturar: código de salida de cada comando; `dsh.profile.bundles` con
`@local/lifecode-skill-center`; en `node_modules\@local\lifecode-skill-center` **sólo** los ficheros del array
(`index.js`, `client.js`, `lib\`, `cordis.patch.yml`, `icon.svg`, `README.md`, `CHANGELOG.md`, `docs\`); el dump
con la fila del plugin; y ausencia de `not-a-bundle`/`incompatible-version`/`GIT_FETCH_FAILED`. Si
`--dump-config` no puede componer el árbol por el perfil mínimo, se captura el error y se pasa la prueba a §9.2
(el dump no sustituye a la UI).

### 9.2 Prueba en el perfil real de la Desktop (requiere persona + copia)

1. Copiar (no mover) `~/.dsh/profiles/desktop/package.json` y `pnpm-lock.yaml` a un backup fechado.
2. Complementos → Agregar complemento → pegar la spec con SHA → instalar (la app pedirá reinicio).
3. Tras reiniciar: el panel aparece en la barra lateral; `GET http://127.0.0.1:<puerto>/lifecode-skill-center/api/capabilities`
   devuelve 200 con `plugin.version` = `1.0.1`; `…/api/health` 200; `…/api/inventory` 200.
4. Capturar: diálogo y check, resultado de instalación, reinicio, panel abierto, respuesta de `capabilities`,
   y `node_modules\@local\lifecode-skill-center` con el contenido esperado.
5. Reversión: desinstalar desde la UI (o `& $dsh plugin --profile desktop remove @local/lifecode-skill-center`)
   y comprobar que el panel desaparece y el perfil queda como el backup (salvo `pnpm-lock.yaml`, que puede
   conservar el registro).

## 10. Verificación de lo publicado

```powershell
git fetch origin
git ls-tree -r --name-only origin/main -- lifecode-skill-center | Measure-Object -Line   # ≈ 48+trackeados
git status --porcelain -uall | Measure-Object -Line                                      # mismo estado que antes
npm pack --dry-run --json                                                               # repetir §7
```

Y comparar el tarball publicado con el árbol local: `git diff --stat origin/main -- lifecode-skill-center` debe
salir vacío justo después del merge, y los hashes de §7 deben coincidir.

## 11. Riesgos y pendientes

- **Divergencia de `main`** (local `707fb49` vs `origin/main` `bbd5e38`): publicar desde una rama creada en
  `origin/main`; nunca `git push --force`.
- **2030 ficheros sin trackear**: el riesgo no es publicar de más, es publicar de menos; el commit debe llevar
  la carpeta completa (15 `lib/`, 73 `tests/`, 13 `tools/`, 11 `docs/`, `CHANGELOG.md`).
- **39 ficheros `M` fuera del plugin** (R16/R17): no entran en el commit; quedan en la rama de trabajo.
- **`r161-contract.log`**: es un artefacto de sesión; excluirlo del commit (y, si se quiere, añadirlo a
  `.gitignore` o borrarlo: decisión humana).
- **Specs git y versión**: `inspect` no resuelve versión antes de instalar; el panel de check no puede prometer
  «1.0.1» de antemano.
- **Sin red o mirror**: el fallo de GitHub se muestra como «Cannot access GitHub» y el mirror chino no sirve
  repos GitHub (`dsh-client-ui-plugin-manager/README.md:69`): no hay mitigación automática.
- **Sin rollback automático de código**: si el plugin rompe el arranque, la recuperación es desinstalar desde la
  UI o `dsh plugin --profile desktop remove …`; de ahí el backup de §9.2.
- **Cambios de metadatos**: los aplica una persona (Lead), no el agente; este informe sólo los especifica.

## Apéndice — comandos de reproducción de la auditoría

```powershell
# estado del repo
git rev-parse HEAD; git branch --show-current; git rev-parse main origin/main
git ls-tree --name-only main -- lifecode-skill-center
git status --porcelain -uall | Measure-Object -Line
git ls-files lifecode-skill-center | Measure-Object -Line

# contrato del instalador (asar extraído en _audit/t43-arch/extracted)
# - dsh-plugin-manager/lib/types/install-spec.js
# - dsh-plugin-manager/lib/index.js (installBundle, checkGithubConnection, namedSpecManifest)
# - dsh-app-boot/lib/index.js (unmetRequirements, evaluatePluginCompatibility)
# - @deepseek-ai/dsh/README.md y lib/plugin-*.js (dsh plugin --profile …)
# pnpm: resources/runtime/primary-runtime/dependencies/pnpm/dist/pnpm.mjs
#   parseGitParams, safeJoinPath, prepareFetchedPackage, packlist
```
