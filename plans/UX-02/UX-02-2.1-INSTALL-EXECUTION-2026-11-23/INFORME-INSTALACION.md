# Informe de ejecución — instalación de LifeCode RAG 1.3.0 en el perfil `desktop`

**Fecha:** 2026-11-23T03:55Z – 04:04Z · **Procedimiento autorizado:** `62963ccd4d02b45c5a6f9e530ca6eaa8855141b0d39b1127ce5d2b2a9b140f56` (verificado, coincide)
**Artefacto:** `f848b73e…` · 310 675 B · 74 ficheros (verificado dos veces, `sha256sum` y `certutil`)
**Estado global:** instalación **hecha y verificada sin credenciales**. **PA01 pendiente** (lo ejecuta el propietario).
**Integración completa:** **NO declarada** — depende de PA01.

---

## 1. Resultado por paso

| # | Paso | Resultado | Evidencia |
|---|---|---|---|
| 1 | Hash del procedimiento y del artefacto | **PASS** | `evidence/paso-01-hashes.txt` |
| 2 | Respaldos completos | **PASS** — 90 ficheros: perfil (5), paquete 1.2.0 (73), almacén (6, con sidecars), estado lógico, inventario | `evidence/paso-02-respaldo.txt` |
| 3 | Verificación del respaldo | **PASS** — copia vs original **0 diferencias** (73/73 y 6/6), `integrity_check ok`, recuentos exactos, `MANIFIESTO.sha256` 90/90 | `evidence/paso-03-verificacion-respaldo.json`, `paso-03b-manifiesto-respaldo.txt` |
| 4 | Huellas iniciales | **PASS** — 3 bases + `config.json` + inventario de 84 paquetes | `evidence/inventario-node_modules-antes.txt` |
| 5 | Cierre limpio del host | **PASS con matiz** — `CloseMainWindow` → ventana cerrada; `taskkill /T` no pudo con 3 procesos; `Stop-Process -Force` con `-wal` a 0 B; resultado **0 procesos**, puerto libre, hashes iguales, `integrity_check ok` | `paso-05a…`, `paso-05b…`, `paso-05c…`, `paso-05d…` |
| 6 | Compuertas G1–G9 | **PASS** — 21 comprobaciones, 0 fallos → GO | `evidence/paso-06-compuertas.json` |
| 7 | Ensayo del lock en copia | **FAIL del criterio literal, causa preexistente demostrada** — ver §3.1 | `paso-07a…`, `paso-07b…`, `paso-07c…`, `paso-07c-bis…`, `paso-07d…` |
| 8 | Instalación quirúrgica | **PASS** — 74 ficheros, 74/74 idénticos al artefacto, `1.3.0`, `pa/1.4.0` | `evidence/paso-08a-extraccion.txt`, `paso-08b-instalacion.txt` |
| 9 | Verificación posterior | **PASS** — sólo `lifecode-rag` cambió (1.2.0 → 1.3.0) en 84 paquetes; datos y `config.json` intactos | `evidence/paso-09-verificacion.txt` |
| 10 | Comprobaciones no autenticadas | **PASS** — 7 tools, `pa/1.4.0`, `inject` completo, proyección correcta sobre fixture | `evidence/paso-10-no-autenticadas.txt` |
| 11 | Políticas de pnpm sobre el lock instalado | **PASS** — `✓ Lockfile passes supply-chain policies` | `evidence/paso-11-lock-politicas.txt` |

## 2. Estado final medido

| Elemento | Antes | Después |
|---|---|---|
| Paquete instalado | `1.2.0` · 73 ficheros | **`1.3.0` · 74 ficheros** (`74/74` idénticos al tarball) |
| `PA_VERSION` del código instalado | `pa/1.3.0` | **`pa/1.4.0`** |
| `package.json` del perfil | `50012c7f…` | `9da3f005…` (sólo la línea de versión) |
| `pnpm-lock.yaml` | `ff5ac0c9…` | `c96f684e…` (3 entradas del mismo paquete) |
| `pnpm-workspace.yaml` | `5bcb2d94…` | `48395d64…` (una línea: exclusión de 1.3.0) |
| Otros 83 paquetes | — | **idénticos** (diff del inventario: sólo la línea de lifecode-rag) |
| `registry.sqlite3` | `4b67cadc…` | **`4b67cadc…`** |
| `scopes/prj_01M7RBS…/rag.sqlite3` | `4dcf31c4…` | **`4dcf31c4…`** |
| `scopes/prj_01M7TRD…/rag.sqlite3` | `6130ecba…` | **`6130ecba…`** |
| `config.json` del plugin | `b15622c0…` | **`b15622c0…`** |
| Recuentos | 3 proyectos · selección rev. 5 · 88/88 · 121 fuentes · 964 chunks · 964 vectores · 141 | **sin cambios** (leídos en sólo lectura) |

## 3. Incidencias y desviaciones (todas documentadas, ninguna ocultada)

### 3.1 El ensayo del lock **no puede** pasar en este perfil, y no es culpa de nuestro cambio

`pnpm install --frozen-lockfile --offline` falló con `ERR_PNPM_OUTDATED_LOCKFILE`:
*«local dependency `@local/skill-compiler` at `…/plugins-dhs/skill-compiler` is outdated»*.

**Experimento de control:** una copia **limpia**, con el lock **original** (sin ninguna edición nuestra),
falla **con el mismo error**. Por tanto el desfase es **preexistente**: el árbol enlazado de
`skill-compiler` cambió sin que el perfil regenerase su lock.

**Qué se hizo en su lugar** (y por qué es equivalente o mejor):
1. `pnpm install --lockfile-only --offline` en la copia: pnpm **aceptó** el lock editado y **no cambió ninguna
   de nuestras cuatro entradas** (importer, `packages` con la integridad, `snapshots`); sólo reescribió la ruta
   relativa del `link:` —artefacto de la profundidad del directorio de la copia—.
2. Sobre el estado **instalado**: `pnpm install --lockfile-only --offline` en otra copia →
   `✓ Lockfile passes supply-chain policies`, y de nuevo sólo la ruta relativa del `link:` difiere.
3. Conclusión medida: **nuestras cuatro entradas son exactamente las que pnpm generaría**.

### 3.2 El gate de edad **sí estaba activo**: mi instrumento anterior dio un falso negativo

`pnpm config get minimumReleaseAge` devuelve `undefined`, y en la preparación lo interpreté como «no bloquea».
Es **falso**: pnpm 12.15.0 aplica un mínimo por defecto de **24 h**, y lo comprobé con su propio verificador:

```
✗ Lockfile failed supply-chain policy check (86 entries)
  @designerbyron/lifecode-rag@1.2.0 was published at 2026-11-22T19:59:55.529Z,
  within the minimumReleaseAge cutoff (2026-11-22T04:00:54.955Z)
```

Es decir: **el 1.2.0 que estaba instalado tampoco pasaba la política hoy**. Consecuencia aplicada: se añadió
**una línea** a `minimumReleaseAgeExclude` del perfil, `'@designerbyron/lifecode-rag@1.3.0'`, junto a la de
`1.1.0` que ya existía (procedimiento §5, «excepción por versión exacta en este perfil»). No se tocó política
global ni `~/.npmrc`. Tras ello, `paso-11` confirma **PASS** de políticas con el lock instalado.

**Riesgo residual declarado:** sin esa exclusión, cualquier operación futura de pnpm en este perfil habría
fallado hasta que 1.3.0 cumpliese 24 h. Con ella, funciona. El desfase de `skill-compiler` (§3.1) **sigue ahí**
y es ajeno a este acto.

### 3.3 El 1.2.0 aparcado se movió fuera de `node_modules`

El procedimiento preveía dejarlo en `node_modules/@designerbyron/lifecode-rag.bak-1.2.0`. Al estar **dentro**
de `node_modules`, podía ser enumerado como paquete por cualquier herramienta del host. Se movió a
`~/.dsh/backups/inst-1.3.0-20261123T0355/paquete-1.2.0-aparcado/` (73 ficheros). La vuelta atrás no pierde nada:
hay **dos** copias verificadas del 1.2.0 (`paquete-1.2.0/` y `paquete-1.2.0-aparcado/`), ambas 73/73 con el mismo
hash que el publicado.

### 3.4 Los sidecars `-shm`/`-wal` aparecen y desaparecen por la propia medición

Al abrir una base en **sólo lectura** con `node:sqlite`, SQLite crea/adjunta `-shm` y `-wal` (siempre con `-wal`
a **0 B**). Los vaivenes de sidecars que anoté en actos anteriores son de mi instrumento, **no** escrituras del
plugin. Hoy, tras el cierre limpio, los sidecars desaparecieron y volvieron a aparecer al leer; el respaldo los
conserva tal cual y **no se ha borrado ni recreado ninguno**.

### 3.5 Un fixture mío estaba mal y lo corregí

La primera demo de `projectWorkspaces` usó `projects`/`sessionsByWorkspace` en vez del contrato real
(`roots` / `sessionIds` / `liveIds`), y salió «todo `unknown`». Rehecha con el contrato correcto: exact/inside,
proyecto por raíz **más específica**, títulos duplicados **sin fusión**, `liveIds:null` → `vivas:null` (no cero),
entradas inválidas contadas como `skipped`. El módulo se comportó según diseño; el error era del fixture.

### 3.6 Un error de lectura propio, ya corregido en preparación

En la fase previa anoté «exit 0» del `diagnose` leyendo el estado de un `| head`. Re-medido: **exit 1** sin
registro (correcto) y **0** con registro. Corregido en `INFORME-INSPECCION.md` §8.

## 4. Respaldos

- **Directorio:** `C:\Users\BYRON\.dsh\backups\inst-1.3.0-20261123T0355`
- **Verificación:** `MANIFIESTO.sha256` LF, **90/90 OK**; copia vs original **0 diferencias**; las tres bases
  copiadas abren en sólo lectura con `integrity_check = ok` y recuentos idénticos.
- **Contenido:** `perfil/` (5 manifiestos), `paquete-1.2.0/` (73), `paquete-1.2.0-aparcado/` (73),
  `almacen/` (6, con sidecars tal cual), `inventario-node_modules-antes.txt`, `ESTADO-LOGICO-ANTES.json`,
  `hash-cordis-home.txt` (hash de `cordis.patch.yml`, **sin** copiar su contenido).

## 5. Rollback disponible (no ejecutado)

| Nivel | Acción | Verificación |
|---|---|---|
| 1 | `mv` del 1.3.0 a `.fallida` + `cp -a` desde `paquete-1.2.0-aparcado/` + restaurar `package.json`, `pnpm-lock.yaml` y `pnpm-workspace.yaml` del respaldo | 73 ficheros y los 4 hashes de referencia (`e966b23a…`, `df7b74d6…`, `c5c1bea6…`, `8144fe8c…`) |
| 2 | `cp -a` desde `paquete-1.2.0/` | 73/73 contra el tarball publicado del 1.2.0 (`sha512-E+81ki…`) |
| 3 | Datos: sólo si cambiara su hash — no ha cambiado | `integrity_check` + recuentos |

## 6. Pendiente: PA01 (bloquea «integración completa»)

El host está **cerrado** y el plugin **instalado**. Falta abrir la app y hacer los seis controles del panel
(`CONTROLES-PA01-INSTRUCCIONES.md`). Hasta entonces:

- **V-1.4** (carga efectiva del host) → `NOT RUN`
- **V-1.5** (versión servida por la API) → `NOT RUN`
- **A-2.1 … A-2.4** (contrato de la ruta nueva, errores, compuerta) → `NOT RUN`
- **W-3.1 … W-3.5** (Workspace Discovery desde el Host real) → `NOT RUN`
- **C-7.1 … C-7.2** (compatibilidad `pa/1.3.0` con sesión) → `NOT RUN`

Lo que **sí** está medido sin credencial: versión y contenido instalados, `PA_VERSION`, las 7 tools, `inject`,
la proyección pura con su contrato, la ausencia de datos tocados y el paso de políticas de pnpm.
