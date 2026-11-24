# Procedimiento definitivo — instalación de LifeCode RAG 1.3.0 en el perfil `desktop`

**Estado:** **PROCEDIMIENTO CERRADO, NO EJECUTADO.** Requiere autorización explícita del propietario (con el
hash de este documento) para pasar a ejecución.
**Decisiones aplicadas:** D-INS-01 **vía quirúrgica** · D-INS-02 **controles autenticados por el propietario**.
**Fecha:** 2026-11-23T03:5xZ · **Perfil:** `desktop` · **Host hoy:** 5 procesos, `127.0.0.1:57200`.

---

## 0. Alcance

| Se toca | No se toca |
|---|---|
| `~/.dsh/profiles/desktop/node_modules/@designerbyron/lifecode-rag` (sustitución del directorio) | ninguna otra entrada de `node_modules`, incluida **`@local/skill-compiler` (`link:`)**, `@local/lifecode-skill-center` (github) y las demás |
| `~/.dsh/profiles/desktop/package.json` (una línea: `1.2.0` → `1.3.0`) | `~/.dsh/cordis.patch.yml` (capa del home, con credenciales) |
| `~/.dsh/profiles/desktop/pnpm-lock.yaml` (tres entradas del mismo paquete) | `pnpm-workspace.yaml` **salvo** que un gate de edad lo exija (§5) |
| — | almacenes RAG, `rag.sqlite3`, `registry.sqlite3`, WAL/SHM, `config.json` del plugin |

**No se usa** `pnpm add`, `pnpm install` ni resolución general del árbol sobre el perfil real (D-INS-01).
`pnpm install --frozen-lockfile --offline` se ejecuta **sólo** sobre una **copia** del perfil.

## 1. Hashes de referencia (se re-miden en la ejecución)

| Elemento | Valor |
|---|---|
| Artefacto 1.3.0 aprobado | `plans/UX-02/UX-02-2.1-PACKAGE-1.3.0-2026-11-23/artifact/designerbyron-lifecode-rag-1.3.0.tgz` |
| SHA-256 del artefacto | `f848b73ed2a85d6cecffab694710f062bade3d13f912a52a7ab94b927d724ec3` |
| SHA-512 del artefacto | `43f12f0de1b12624e372ea220748869fe8246a9400d9b290adc3c9c25e5dc773c7e845a98f81d2868d57c094dca81cebb43ff4d9da91d02cf39eba8d156ea1d6` |
| Tamaño / ficheros | 310 675 B · **74** |
| `dist.integrity` publicado | `sha512-Q/EvDeGxJiTjcuoiB0iGn+gkapQA2bKQrcPJwl5dx3PH6EWpj4HSho1XwJTcqBzrtD/02dqR0CzznrqNFW6h1g==` |
| `package.json` del perfil | `50012c7fd12c3fdcd9f54d0c08e7c29ad6bb900eabb199ee49c1f15b53de248f` |
| `pnpm-lock.yaml` | `ff5ac0c9451dc45e04a5a0e3640ae45852632e2b0ef62ef9f5bb4d5d9da1c973` |
| `pnpm-workspace.yaml` | `5bcb2d94df3e88a5ba91d4a36dfc07ffbc70bf08bec64785f4b15ef36f76f8d7` |
| `cordis.patch.yml` del perfil | `fa644967234989e3392fab04000d1d11f7b4c0795a74312b813adac27e953834` |
| Paquete instalado 1.2.0 (4 hashes) | `package.json e966b23a…` · `lib/pa-api.mjs df7b74d6…` · `index.js c5c1bea6…` · `client.js 8144fe8c…` — **73 ficheros** |
| Datos: `registry.sqlite3` | `4b67cadc9afee8f6c24fb92ab9e1e4742429bd745b4ffb68c1fb1e11b3e45fae` (241 664 B) |
| Datos: `scopes/prj_01M7RBS…/rag.sqlite3` | `4dcf31c4cb7058bb37528ad2c35ec33faa171ff003ad1faffb3bfec8b2472ae5` (3 862 528 B) |
| Datos: `scopes/prj_01M7TRD…/rag.sqlite3` | `6130ecbae17b8e8241c792a036165ffa42902537dc838eeb649201e748ababcb` (126 976 B) |
| `config.json` del plugin | `b15622c0ab9f790f71a4e7a1c3d4ef3d3c8a61279d60dfc2cbdac2751d01353c` (998 B) |
| `~/.dsh/cordis.patch.yml` | se registra **sólo su sha256**, sin copiar contenido |

## 2. Respaldos (antes de tocar nada)

**Destino:** `~/.dsh/backups/inst-1.3.0-<AAAAMMDDTHHMM>/` (se aborta si ya existe).

```
perfil/      package.json · pnpm-lock.yaml · pnpm-workspace.yaml · cordis.patch.yml · cordis.yml
paquete-1.2.0/                    copia íntegra (73 ficheros)
almacen/profiles/desktop/         config.json · registry.sqlite3 · scopes/*/rag.sqlite3 (+ sidecars tal cual)
inventario-node_modules-antes.txt nombre+versión de TODOS los paquetes instalados
ESTADO-LOGICO-ANTES.json          recuentos leídos en sólo lectura
MANIFIESTO.sha256                 LF, `hash *ruta`
```

Comandos (host ya cerrado, §3):

```sh
TS=$(date -u +%Y%m%dT%H%M)
BK="$HOME/.dsh/backups/inst-1.3.0-$TS"
test -e "$BK" && { echo "EXISTE: abortar"; exit 1; }
mkdir -p "$BK/perfil" "$BK/paquete-1.2.0" "$BK/almacen"
cp -p "$HOME/.dsh/profiles/desktop"/{package.json,pnpm-lock.yaml,pnpm-workspace.yaml,cordis.patch.yml,cordis.yml} "$BK/perfil/"
cp -a "$HOME/.dsh/profiles/desktop/node_modules/@designerbyron/lifecode-rag/." "$BK/paquete-1.2.0/"
cp -a "$HOME/.dsh/lifecode-rag/profiles/desktop/." "$BK/almacen/"      # incluye sidecars, SIN tocarlos
sha256sum "$HOME/.dsh/cordis.patch.yml" | awk '{print $1}' > "$BK/hash-cordis-home.txt"
```

**Verificación obligatoria del respaldo** (si falla, no se instala):

1. `sha256sum` de cada fichero copiado y comparación con el original (dos instrumentos: `sha256sum` y `certutil`).
2. Apertura en **sólo lectura** de las copias (`DatabaseSync(..., { readOnly: true })`).
3. `PRAGMA integrity_check` = `ok` en las tres bases copiadas.
4. Recuentos iguales: 3 proyectos · 3 raíces · selección rev. 5 · auditoría 88/88 ·
   **121 fuentes · 964 chunks · 964 vectores** · auditoría de ámbito 141.
5. `MANIFIESTO.sha256` generado y verificado con `sha256sum -c` desde `$BK`.

## 3. Cierre limpio del host (paso previo, con sus propias puertas)

```sh
# medida previa
tasklist | grep -i "DeepSeek Harness"                 # pids
netstat -ano | grep LISTENING | grep -E ":(57200)$"   # puerto del host
ls -l "$HOME/.dsh/lifecode-rag/profiles/desktop"/**.sqlite3-* 2>/dev/null   # sidecars y tamaños
```

1. `CloseMainWindow()` sobre el **pid principal** (hoy 11816; se re-mide).
2. `taskkill /PID <main> /T` **sin `/F`** (desde git-bash: `MSYS2_ARG_CONV_EXCL='*' cmd.exe /c "taskkill /PID <main> /T"`).
3. `Stop-Process -Id <main> -Force` **sólo si** todos los `-wal` están a **0 B**.
4. Comprobar: **0** procesos · puerto **libre** · hashes de los tres `.sqlite3` **iguales** a §1 ·
   `integrity_check ok` · sidecars presentes con su tamaño (si cambian, se anota; **no se recrean**).

## 4. Puertas antes de escribir (todas en verde o se para)

| # | Comprobación | Umbral |
|---|---|---|
| G1 | Artefacto local | `sha256 f848b73e…`, 310 675 B |
| G2 | Tarball del registro 1.3.0 | `dist.integrity sha512-Q/EvDeGx…`, `fileCount 74` |
| G3 | Perfil en estado inventariado | los tres hashes de §1 |
| G4 | `pnpm config get minimumReleaseAge` | anotar; si ≠ `undefined` → §5 |
| G5 | Huella de datos | los tres hashes de §1 |
| G6 | Host cerrado | 0 procesos, puerto libre, `-wal` 0 B |
| G7 | Respaldo verificado | §2 los cinco puntos |
| G8 | Espacio libre | ≥ 200 MB |
| G9 | Otros plugins inventariados | `inventario-node_modules-antes.txt` generado |

## 5. Instalación (quirúrgica)

```sh
PROF="$HOME/.dsh/profiles/desktop"; PKG="$PROF/node_modules/@designerbyron/lifecode-rag"
TMP=$(mktemp -d)   # fuera del perfil

# 5.1 · obtener el 1.3.0 EXACTO
cp "plans/UX-02/UX-02-2.1-PACKAGE-1.3.0-2026-11-23/artifact/designerbyron-lifecode-rag-1.3.0.tgz" "$TMP/1.3.0.tgz"
sha256sum "$TMP/1.3.0.tgz"                    # == f848b73e…   (si no, parar)
tar --force-local -xzf "$TMP/1.3.0.tgz" -C "$TMP"

# 5.2 · verificar el contenido ANTES de tocar el perfil
#   74 ficheros · package.json version=1.3.0 · PA_VERSION='pa/1.4.0' · existe lib/workspaces-projection.mjs
node -e "…(script de verificación del expediente, no escribe)…"

# 5.3 · apartar y sustituir
mv "$PKG" "$PKG.bak-1.2.0"        # no se borra: es el rollback de nivel 1
cp -a "$TMP/package" "$PKG"

# 5.4 · coincidencia exacta
#   comparar sha256 fichero a fichero: 74/74 idénticos; si no, ROLLBACK inmediato
```

**Lock y manifiesto (tres entradas + una línea):**

```yaml
# package.json
"@designerbyron/lifecode-rag": "1.3.0"

# pnpm-lock.yaml
importers:.dependencies['@designerbyron/lifecode-rag']: { specifier: 1.3.0, version: 1.3.0 }
packages['@designerbyron/lifecode-rag@1.3.0']:
    resolution: {integrity: sha512-Q/EvDeGxJiTjcuoiB0iGn+gkapQA2bKQrcPJwl5dx3PH6EWpj4HSho1XwJTcqBzrtD/02dqR0CzznrqNFW6h1g==}
    engines: {dsh: '>=0.2.2-rc.3 <0.3.0', node: '>=22.5.0'}
snapshots['@designerbyron/lifecode-rag@1.3.0']: {}
```

**Ensayo del lock en copia (obligatorio, D-INS-01):**

```sh
REH=$(mktemp -d)
cp -a "$PROF"/{package.json,pnpm-lock.yaml,pnpm-workspace.yaml} "$REH/"
cp -a "$PROF/node_modules" "$REH/node_modules"
cd "$REH" && pnpm install --frozen-lockfile --offline --ignore-scripts
# PASS = exit 0 y ninguna línea del lock reescrita; si pnpm se queja, se corrige EN LA COPIA
```

**Si G4 detecta un gate de edad** (`minimumReleaseAge` ≠ `undefined`): añadir **una** línea a
`minimumReleaseAgeExclude` en `$PROF/pnpm-workspace.yaml`, `'@designerbyron/lifecode-rag@1.3.0'`, y nada más.
No se modifica la política global ni `~/.npmrc`.

## 6. Arranque y comprobaciones sin credencial

1. El propietario abre la app; el host vuelve a escuchar (puerto puede cambiar: se re-mide).
2. `node -e` del `package.json` instalado → **1.3.0**; recuento **74**; `PA_VERSION 'pa/1.4.0'`.
3. `GET /lifecode-rag/pa/config` sin credencial → **401** `unauthenticated` (**sólo** prueba la compuerta).
4. Log del host sin errores de carga del plugin.
5. Datos: los tres hashes de §1 **sin cambios**; `config.json` **sin cambios**; sin acciones nuevas en
   `audit_registry` ni en el `audit` del ámbito.

## 7. Controles autenticados (D-INS-02)

El propietario los ejecuta en el panel; instrucciones exactas y qué reportar: **`CONTROLES-PA01-INSTRUCCIONES.md`**.
El agente no pide ni recibe cookies, tokens ni acceso a la sesión, y **no** interpreta un `401` como prueba de
nada.

## 8. Las nueve condiciones de parada (confirmadas)

| # | Condición | Cómo se evalúa |
|---|---|---|
| 1 | Artefacto distinto del aprobado | G1/G2 |
| 2 | Respaldo no verificable | §2 los cinco puntos |
| 3 | Host no cerrado / puerto ocupado / `-wal` ≠ 0 B | G6 |
| 4 | Huella de datos cambió antes de empezar, o aparece auditoría no atribuible | G5 y §6.5 |
| 5 | Perfil distinto del inventariado, o ensayo del lock falla | G3 y §5 ensayo |
| 6 | Cambia cualquier paquete ajeno en `node_modules` | inventario antes/después |
| 7 | Tras instalar, la versión no es 1.3.0 o el recuento no es 74 | §6.2 |
| 8 | El paso exige tocar `~/.dsh/cordis.patch.yml`, credenciales, política global, otro plugin, datos RAG o sidecars | revisión del paso |
| 9 | Un control autenticado sin propietario presente | D-INS-02 → `BLOCKED` |

Cualquier condición cumplida = **detenerse**, documentar y no continuar.

## 9. Rollback (criterios y comandos)

Se aplica si falla §6, si el propietario reporta un FAIL en §7, o si aparece cualquier condición de parada.

- **Nivel 1 (preferente, sin red):** `mv "$PKG" "$PKG.fallida-1.3.0"` · `mv "$PKG.bak-1.2.0" "$PKG"` ·
  restaurar `package.json` y `pnpm-lock.yaml` desde `$BK/perfil/` · verificar los cuatro hashes de referencia y
  los 73 ficheros · reabrir el host.
- **Nivel 2:** restaurar `paquete-1.2.0/` desde `$BK` y comparar con el tarball 1.2.0 del registro
  (`sha512-E+81ki…`): 73/73.
- **Nivel 3 (datos, sólo si la huella cambió):** parar, atribuir por la cadena de auditoría antes de restaurar
  nada; si procede, restaurar **la base afectada** desde `$BK/almacen/…` con el host cerrado y verificar
  `integrity_check` + recuentos.

Criterio de éxito del rollback: `1.2.0`, 73 ficheros, los cuatro hashes, datos idénticos, host cargando el
plugin.

## 10. Evidencia a entregar al cerrar la ejecución

Hashes antes/después (datos, perfil, paquete), inventario de `node_modules` antes/después, salida del ensayo
del lock, versión instalada y `PA_VERSION`, resultado de los controles del propietario, `npm test` + herramientas
del repo, y estado de Git (sin cambios). Con PASS/FAIL/BLOCKED/NOT RUN por control.

## 11. Autorización solicitada

Se solicita autorización para ejecutar **§2 a §6** y aplicar el rollback si procede, con este documento como
referencia vinculante. Los controles de §7 los ejecuta el propietario y el agente sólo los registra.

**Lo que NO se hará ni con esa autorización:** `pnpm add`, resolución general del árbol, cambios en
`~/.dsh/cordis.patch.yml`, credenciales o política global, tocar otros plugins, abrir bases en escritura,
reindexar, ingerir, manipular sidecars, ni operaciones Git.
