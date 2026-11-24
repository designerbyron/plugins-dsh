# Plan de instalación de LifeCode RAG 1.3.0 en DSH real — **NO EJECUTADO**

Objetivo: sustituir `@designerbyron/lifecode-rag@1.2.0` del perfil `desktop` por la **versión publicada
1.3.0**, sin tocar datos RAG, sin mover otros plugins y con vuelta atrás verificable.

Artefacto de referencia: el `.tgz` aprobado y publicado
(`sha256 f848b73e…`, `dist.integrity sha512-Q/EvDeGx…`, 74 ficheros, 310 675 B). **No se reconstruye**: se
descarga del registro y se comprueba contra esos valores, o se usa el fichero local ya verificado (idéntico
byte a byte).

---

## 1. Precondiciones (si alguna falla, se para)

| # | Comprobación | Comando | Criterio |
|---|---|---|---|
| P1 | El artefacto local sigue intacto | `sha256sum plans/UX-02/UX-02-2.1-PACKAGE-1.3.0-2026-11-23/artifact/designerbyron-lifecode-rag-1.3.0.tgz` | `f848b73e…` |
| P2 | El registro sirve 1.3.0 con esa integridad | HTTP a `registry.npmjs.org/@designerbyron%2Flifecode-rag` → `versions["1.3.0"].dist.integrity` | `sha512-Q/EvDeGx…`, `fileCount 74` |
| P3 | Perfil en el estado inventariado | `sha256sum ~/.dsh/profiles/desktop/{package.json,pnpm-lock.yaml,pnpm-workspace.yaml}` | `50012c7f…` / `ff5ac0c9…` / `5bcb2d94…` |
| P4 | Paquete instalado = 1.2.0 publicado | `node -e "…package.json.version"` + recuento 73 | `1.2.0`, 73 |
| P5 | Huella de datos capturada | `sha256sum ~/.dsh/lifecode-rag/profiles/desktop/registry.sqlite3 …/scopes/*/rag.sqlite3` | `4b67cadc…` / `4dcf31c4…` / `6130ecba…` |
| P6 | `minimumReleaseAge` re-medido | `pnpm config get minimumReleaseAge` | anotar valor (hoy `undefined`) |
| P7 | Espacio libre suficiente | `df -h /c` | ≥ 200 MB libres |
| P8 | Sin sesión de agente en curso sobre el perfil | 0 procesos `DeepSeek Harness.exe` tras §2 | 0 |

## 2. Cierre limpio del host

DSH **no termina al cerrar la ventana**: pasa a segundo plano y deja
`AppData\Roaming\@deepseek-ai\dsh-desktop\background-close-confirmed`. Secuencia (probada en este proyecto):

1. **Medir antes**: `tasklist` (pids), `netstat -ano | grep LISTENING` (puerto `127.0.0.1:57200`), hashes de
   las bases, **tamaño de los `-wal`**. Un `-wal` a `0 B` significa que no queda transacción sin confirmar.
2. `CloseMainWindow()` sobre el **pid principal** (hoy 11816; se re-mide). La ventana desaparece; el proceso sigue.
3. `taskkill /PID <main> /T` **sin `/F`** (terminación ordenada del árbol). Fallará en principales/host/renderer.
4. `Stop-Process -Id <main> -Force` **sólo si** el paso 1 dejó los `-wal` a `0 B`.
5. **Comprobar después**: `0` procesos, puerto `57200` libre, **mismos hashes** de las bases, `integrity_check`
   `ok` en las tres, y los sidecars **presentes y con el mismo tamaño** (si el cierre los retira, se anota el
   cambio de sidecars; **no se recrean ni se borran a mano**).

Desde git-bash, `taskkill` necesita `MSYS2_ARG_CONV_EXCL='*' cmd.exe /c "taskkill /PID … /T"` o el `//PID`
llega literal.

## 3. Respaldo

Se ejecuta el procedimiento de `MANIFIESTO-RESPALDOS-PROPUESTOS.md` (copia del perfil lógico, del paquete
1.2.0 instalado y del almacén RAG completo **incluidos los sidecars tal cual**), con verificación por hash y
por apertura en sólo lectura de las copias. **Sin respaldo verificado no se instala nada.**

## 4. Estrategia de instalación

### 4.1 Recomendada: instalación quirúrgica (sin pnpm)

Motivo medido: `nodeLinker: hoisted`, **sin** `node_modules/.pnpm`, con dependencias `link:` y `github:` en el
mismo perfil. `pnpm add` rehace la resolución completa y puede mover paquetes ajenos (incluido el `link:` del
skill-compiler). La vía quirúrgica toca **un solo** directorio y tres líneas del lock.

Pasos (con el host cerrado):

```sh
PROF="$HOME/.dsh/profiles/desktop"
PKG="$PROF/node_modules/@designerbyron/lifecode-rag"
TMP="$(mktemp -d)"   # fuera del perfil

# 1 · Bajar el tarball publicado y verificarlo contra el artefacto aprobado
node -e "…fetch dist.tarball de 1.3.0 → escribe $TMP/1.3.0.tgz…"
sha256sum "$TMP/1.3.0.tgz"        # debe ser f848b73e…
tar --force-local -xzf "$TMP/1.3.0.tgz" -C "$TMP/x"

# 2 · Verificar el contenido extraído ANTES de tocar nada
node -e "…recorrer $TMP/x/package y comprobar: 74 ficheros, package.json version=1.3.0,
         PA_VERSION=pa/1.4.0 en lib/pa-api.mjs, presencia de lib/workspaces-projection.mjs…"

# 3 · Apartar el 1.2.0 (no se borra: es el rollback más rápido)
mv "$PKG" "$PKG.bak-1.2.0"

# 4 · Colocar 1.3.0
cp -a "$TMP/x/package" "$PKG"

# 5 · Coincidencia exacta con el tarball
node -e "…comparar sha256 fichero a fichero: 74/74 idénticos…"   # si no, ROLLBACK inmediato
```

> `tar` de MSYS lee `C:/…` como host remoto: `--force-local` es obligatorio; el destino de `-C` se pasa como
> ruta relativa o `cd` previo.

### 4.2 Actualización del manifiesto y del lock

```sh
# package.json: una sola línea
#   "dependencies": { "@designerbyron/lifecode-rag": "1.2.0" }  →  "1.3.0"

# pnpm-lock.yaml: las tres entradas de §4 del inventario
#   importer.specifier 1.2.0 → 1.3.0
#   importer.version   1.2.0 → 1.3.0
#   packages['@designerbyron/lifecode-rag@1.2.0'] → @1.3.0 con resolution.integrity = sha512-Q/EvDeGx…
#   snapshots['@designerbyron/lifecode-rag@1.2.0'] → @1.3.0
```

**Verificación de consistencia sin tocar el perfil real:** copiar `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml` **y el `node_modules` completo** a un directorio temporal y ejecutar allí

```sh
pnpm install --frozen-lockfile --offline --ignore-scripts
```

Debe terminar en verde y **sin cambios** en el árbol. Si el lock no cuadra, se corrige en la copia y **no se
aplica** hasta que cuadre. (Esta prueba es la que evita el fallo clásico: un lock editado a mano que pnpm
rechaza y que deja el perfil a medias.)

### 4.3 Alternativa: `pnpm add` (sólo si la quirúrgica no fuese aceptable)

```sh
cd "$HOME/.dsh/profiles/desktop"
pnpm add @designerbyron/lifecode-rag@1.3.0 --save-exact
```

Con guardas: (a) inventario **completo** de versiones de todos los paquetes de `node_modules` antes y después,
y comparación —si se mueve uno ajeno, ROLLBACK—; (b) `--offline` si el store ya tiene 1.3.0, para no
re-resolver de red; (c) nunca `pnpm install` a secas.

## 5. `minimumReleaseAge`

- Hoy **no está definido** (`undefined`), así que no bloquea 1.3.0. Se **vuelve a medir** en la ejecución (P6).
- **Si apareciera un valor** (p. ej. `1440`), pnpm podría quedarse en una versión más antigua **sin fallar**:
  el propio host documenta que el gate «puede hacer que la instalada sea más vieja que la última release». En
  ese caso:
  1. Se añade **una** entrada a `minimumReleaseAgeExclude` en `~/.dsh/profiles/desktop/pnpm-workspace.yaml`:
     `'@designerbyron/lifecode-rag@1.3.0'` — **por versión exacta y sólo en este perfil**.
  2. **No** se toca la política global, ni `~/.npmrc`, ni PNPM a nivel de máquina.
  3. Se documenta el cambio y se revierte al terminar si no era necesario para nada más.
- Y siempre se **verifica la versión instalada**, no el código de salida: instalar «con éxito» la 1.2.0 no es
  instalar 1.3.0.

## 6. Reinicio y comprobación de carga

1. Arrancar la app (el propietario). Esperar a que el host escuche: `netstat -ano | grep LISTENING` → `127.0.0.1:57200` (o el puerto que toque en ese arranque).
2. `GET /lifecode-rag/pa/config` sin credencial → **401** (compuerta viva; **no** prueba versión).
3. Comprobación de la versión **cargada**: `node -e` del `package.json` instalado (**1.3.0**) + recuento 74 +
   ausencia de `lib/workspaces-projection.mjs` en 1.2.0 y presencia en 1.3.0 + log del host sin errores de carga.
4. Verificación funcional **con sesión** (propietario en el panel, o instancia aislada): `GET /pa/config` →
   `version: "pa/1.4.0"`; `GET /pa/workspaces` → 200 con `source: "host"` y los workspaces del registro real.
5. Matriz completa: `MATRIZ-VALIDACION.md`.

## 7. Evidencia antes/después

Se guardan, con marca de tiempo: huella de datos (`.sqlite3`), huella del perfil, versión instalada, recuento
de ficheros, hashes de los ficheros clave, listado de sidecars con tamaños, estado lógico del almacén
(proyectos, raíces, selección, auditoría, fuentes/chunks/vectores, `integrity_check`) **leído siempre en sólo
lectura**, y el resultado de la suite (`npm test` + `tools/hermetic.mjs`) en el worktree de release.

## 8. Lo que este plan **no** hace

- No instala nada por sí solo: cada comando se ejecuta en la fase autorizada, con su puerta previa.
- No modifica `~/.dsh/cordis.patch.yml` (capa del home, con credenciales), ni la política global, ni otros plugins.
- No borra, mueve ni «limpia» sidecars WAL/SHM.
- No abre ninguna base en modo escritura, no reindexa, no ingiere, no olvida fuentes.
- No hace commits, merges, tags ni push.
