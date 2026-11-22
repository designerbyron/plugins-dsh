# LifeCode RAG 1.0.0 · Informe de despliegue

Perfil destino: `C:\Users\BYRON\.dsh\profiles\desktop` · Host: DeepSeek Harness `0.2.2-rc.5` (Electron 44.7.0).

## 1. Punto de partida (medido, no supuesto)

- El plugin **ya estaba instalado** y congelado en `C:/xampp/htdocs/dsh-plugins-store/lifecode-rag/655f03758fe1`
  (407 ficheros, el commit `655f037`), unido por junction y declarado en `dependencies` y en
  `dsh.profile.bundles`. No era una instalación desde cero: era un cambio de fuente.
- **La instancia del propietario estaba viva** (PID 10056, `--user-data-dir=Roaming\@deepseek-ai/dsh-desktop`,
  arrancada a las 12:23; sin actividad de sesión desde entonces). El laboratorio también tenía una instancia
  (PID 11008) con el build anterior.
- Almacén real: registro v1 (2 proyectos, 2 raíces, 70 entradas de auditoría) y dos bases de ámbito, todas con
  `-wal` a 0 B.

## 2. Respaldo previo (`C:/Users/BYRON/.dsh/backups/acp01-2026-11-21T1842`)

`MANIFEST.json` con `path | bytes | sha256` de 9 ficheros, `quick_check` de cada copia y el destino de la
junction:

| Grupo | Ficheros |
|---|---|
| perfil | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `cordis.yml`, `cordis.patch.yml` |
| almacén | `registry.sqlite3` (+ su `-wal` a 0 B), `scopes/prj_01M7RBSRD33…/rag.sqlite3`, `scopes/prj_01M7TRDQYRAPJR03QTM3PP6PX2/rag.sqlite3` |

Verificación: 0 faltantes, `quick_check=ok` en las tres bases, `user_version=1`, 2 proyectos, junction
registrada → `655f03758fe1`.

## 3. Empaquetado

Congelador determinista (`freeze-lifecode-rag.mjs`): copia el árbol validado excluyendo `node_modules` y los 9
artefactos ignorados (`demo/.store`, `eval/real-world-01/store/**`, 5 `*.log`), calcula el tag con
`sha256` de la lista `ruta|sha256` y verifica la copia completa.

| Instantánea | Contenido | Estado |
|---|---|---|
| `655f03758fe1` | commit `655f037` (407 ficheros) | original, **intacta**, objetivo de rollback |
| `acp01-46d8d4a438e6` | primer build del acto (421) | **superada** por la siguiente (le faltaban `projects` y el refresco tras cambio de selección) |
| `acp01-71ca6863ad63` | segundo build (421) | **superada** (le faltaba vaciar fuentes al cambiar de selección) |
| **`acp01-7f174851218a`** | build final (421 ficheros, 0 discrepancias) | **instalada** |

Manifiesto: `C:/xampp/htdocs/dsh-plugins-store/lifecode-rag/acp01-7f174851218a.manifest.json` (421 entradas).

## 4. Escrituras en el perfil (atómicas por fichero, prevalidadas en conjunto)

`install-profile.mjs` deriva la fuente actual del propio `package.json` (no la recuerda), exige que sea un
`link:` al almacén, valida las ocurrencias exactas en `package.json` (1) y `pnpm-lock.yaml` (2: `specifier` y
`version`), valida el JSON resultante y escribe con temporal + `rename`, verificando el hash del destino.

| Fichero | Antes | Después |
|---|---|---|
| `package.json` | sha `4f61768b8fde…`, `link:…/655f03758fe1` | sha `02a6d18fd34e…`, `link:…/acp01-7f174851218a` |
| `pnpm-lock.yaml` | sha `24d9c82fbf89…` | sha `c5a36c24029f…` (mismas dos líneas de `lifecode-rag`) |

Junction: `node_modules/@local/lifecode-rag` → `acp01-7f174851218a` (borrada con `(Get-Item).Delete()`, **no**
`rm -rf`; recreada con `New-Item -ItemType Junction`; destino verificado y `lib/selection.mjs` visible).
`pnpm install` **no** se ejecutó.

## 5. Reinicios

Tres cierres ordenados y tres arranques, siempre con el marcador de cada instancia
(`--user-data-dir` + línea de comandos), nunca por nombre de proceso ni `CloseMainWindow()` a ciegas:

1. **Laboratorio** (PID 11008): cerrado y relanzado con el build nuevo para medir PA01/CR-1 en host real.
2. **Perfil del propietario** (PID 10056): pre-cierre con WAL a 0 B → `CloseMainWindow()` → `taskkill /T`
   (falla en el principal, como documenta la skill) → `Stop-Process -Force` → **0 procesos**, puerto libre,
   hashes del almacén idénticos. Relanzado sin variables de laboratorio (`env -u DSH_HOME -u LIFECODE_RAG_ROOT…`).
3. **Segundo reinicio del perfil** tras instalar el build final (mismo procedimiento).

La instancia del laboratorio que quedó viva se cerró al terminar; la del propietario **queda en marcha** con el
build nuevo.

## 6. Verificación posterior (instancia real, puerto 64423)

| Comprobación | Resultado |
|---|---|
| Plugin cargado | panel montado; `GET /lifecode-rag/pa/snapshot` → `200`, `version: pa/1.1.0` |
| Autenticación | sin cookie → `401 unauthenticated`; con cookie del host → `200`, `auth.principal: owner` |
| Registro | v1 → **v2**, 12 tablas, `quick_check=ok`, cadena de auditoría `ok` (73) |
| Proyectos / raíces | 2 / 2 (sin cambios) |
| Selección | `pa_selection` rev 3 (`prj_01M7RBSRD33…`), persistida tras reinicio |
| Datos de usuario | bases de ámbito con sha256 **idénticos** al baseline: `4dcf31c4cb70…` (121 fuentes) y `0788ffb4c59c…` (0 fuentes) |
| WAL | ausente / 0 B tras cerrar conexiones |
| Panel | `data-mode=api`, sin banner sintético, 121 fuentes «Página 1 de 3», cambio de proyecto con revisión 2 → 3 y aviso de guardado |

## 7. Incidencias declaradas

1. **Forma de `inject`.** La primera versión del acto declaró `inject = { required: [...], optional: [...] }`.
   Con ella **el plugin no se cargó** en el laboratorio (prefijo PA → 404 con cuerpo vacío). Se cambió a la
   lista `['tools','webServer','connection']` y el plugin cargó y sirvió 401. Atribución: la forma de objeto no
   es la que aplica el cargador de este build; el código del host no se inspeccionó para confirmarlo, así que se
   declara como **observación empírica**, no como causa demostrada.
2. **Tres instantáneas.** Los dos builds intermedios se conservan y se marcan superados; ninguna se borró y no
   se sobrescribió ningún directorio existente.
3. **Orden de la migración.** El registro v2 lo escribe el build nuevo; un build anterior que abra ese registro
   respondería `store-version-unsupported`. Por eso migración y despliegue se hicieron en el mismo acto, sin
   dejar el perfil a medias.

## 8. Estado final de procesos

| Instancia | Estado |
|---|---|
| Perfil habitual (`Roaming\@deepseek-ai/dsh-desktop`) | **en marcha** (build `acp01-7f174851218a`), sesión restaurada |
| Laboratorio (`lifecode-rag-lab/electron`) | cerrado |
| Logs con token de lanzamiento | eliminados (`normal-acp*.log` del directorio scratch) |
