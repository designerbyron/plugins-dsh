# INFORME — reparación de dependencias (LifeCode RAG 1.4.0 local + `dsh-data-quality@0.3.29`)

**Fecha:** 2026-11-23, 14:2x-14:5x local. **Acto:** ejecución autorizada de `REPAIR-PLAN.md`.

---

## 1. Hashes autorizados y verificados

| Objeto | Hash | Verificación |
|---|---|---|
| Plan | `dbc3efdd3ae0a90a80c8fef121637f342bb6949b3f194ec0d4b4d58b3fc4ffe2` | verificado al empezar |
| Artefacto | `7bbecb09482dcc36290956a7623b2247414c99fc42cc1b58caf22ce8dbca132b` (317 530 B) | verificado en origen **y en `vendor/`** tras copiar |

## 2. Respaldo

| Dato | Valor |
|---|---|
| Ubicación | `C:\Users\BYRON\.dsh\backups\repair-1.4.0-20261123T1432` |
| Contenido | 7 ficheros de perfil · 75 del paquete 1.4.0 · `plugins-instalados.txt` (82 paquetes) · `lock-grafo-antes.txt` · `store.txt` |
| Manifiesto | **85 entradas**, `sha256sum -c` → **85/85 OK** |
| Paquete respaldado | `cmp` del `client.js` contra el instalado → idéntico |

## 3. Cambios exactos realizados

| # | Objeto | Cambio | Antes → después |
|---|---|---|---|
| 1 | `vendor/` | directorio nuevo + TAR (317 530 B) | no existía → `7bbecb09…` |
| 2 | `package.json` | spec `1.4.0` → `file:vendor/designerbyron-lifecode-rag-1.4.0.tgz` (1 coincidencia) | `85c53c16…` → **`b4db531a…`** |
| 3 | `package.json` | `dsh-data-quality: 0.3.29` en `dependencies` (tras `dsh-context`) | — |
| 4 | `package.json` | `dsh-data-quality` al final de `dsh.profile.bundles` (10 entradas) | — |
| 5 | `pnpm-lock.yaml` | reescrito por pnpm | `65e83297…` → **`a3281ff3…`** |
| 6 | `.modules.yaml` | reescrito por pnpm | `f5c600fb…` → **`c69f5c64…`** |
| 7 | `.pnpm-workspace-state-v1.json` | reescrito por pnpm | `0aa73e00…` → **`8d98a153…`** |
| 8 | `node_modules/` | `dsh-data-quality` 0.3.29 instalado; `lifecode-rag` recopiado desde el TAR | — |

`pnpm-workspace.yaml` **sin cambios** (`0a5f31d7…`). La edición de `package.json` se aplicó con **1 coincidencia por
patrón** y produjo **exactamente** el hash previsto en `EXPECTED-STATE.md` (`b4db531a…`, 1 054 B): la predicción se
cumplió al byte.

## 4. Registro efectivo

`https://registry.npmjs.org/` (medido: `npm config get registry`; el pnpm del Host no lo sobreescribe). **No** se pasó
`--registry` ni se alteró configuración global. El gestor del Host usa `npmmirror` con `--registry` explícito en sus
propias operaciones; eso no lo cambié.

## 5. Reconciliación

`pnpm install` con el pnpm del Host (**11.28.5**), desde el perfil, **sin `pnpm add`**:

```
✓ Lockfile passes supply-chain policies (verified 1h ago)
[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.
Packages: +3
dependencies:
+ dsh-data-quality 0.3.29
Done in 1.5s using pnpm v11.28.5
```

`exit 0`, `downloaded 0` (todo desde el store), 86 entradas verificadas por la política de cadena de suministro.
`--offline` no fue necesario → **C3 no aplica**.

## 6. Diferencias completas del grafo (C1)

Comparado el lock **antes** (respaldo) y **después**, entradas normalizadas (`pkg` = paquete+resolución, `snap` =
snapshot). Ver `graph-diff.txt`:

| | Entradas |
|---|---|
| Antes | 168 (84 `pkg` + 84 `snap`) |
| Después | 172 (86 + 86) |
| Comunes | **166** |

**Retiradas (2):** `pkg @designerbyron/lifecode-rag@1.4.0` (forma de registro) · `snap @…@1.4.0`.

**Añadidas (6):**
- `pkg @designerbyron/lifecode-rag@file:vendor/designerbyron-lifecode-rag-1.4.0.tgz` con
  `resolution: {integrity: sha512-mojAqR…, tarball: file:vendor/…}` y `version: 1.4.0`;
- `pkg dsh-data-quality@0.3.29` con `integrity: sha512-UV7aTA…`;
- `pkg zod@4.6.6` (**transitiva nueva** de `dsh-data-quality`; la 3.25.76 que ya había sigue igual);
- los tres `snap` correspondientes.

**Ninguna otra entrada cambió de versión, resolución ni integridad.** Paquetes instalados: 82 → 83, **0 retirados,
1 añadido** (`dsh-data-quality@0.3.29`).

## 7. Estado de LifeCode RAG

| Dato | Valor |
|---|---|
| Versión | **1.4.0** |
| Ficheros | **75**, **75/75 idénticos** al TAR (comparado tras la instalación) |
| Declaración | **`file:vendor/designerbyron-lifecode-rag-1.4.0.tgz`** — ninguna referencia semver `1.4.0` en el lock |
| Resolución | `integrity: sha512-mojAqR…` + `tarball: file:vendor/…` (mismo `integrity` que el artefacto) |
| PA API | `PA_VERSION = 'pa/1.4.0'` (idéntico al instalado antes) |
| Servicio | El Host sirve `client.js` desde el paquete instalado: primeros 243 913 B **byte a byte** idénticos (cola de 84 B = `sourceMappingURL`) |
| Siete herramientas | registradas por `index.js` (idéntico al que ya las registraba); pendiente confirmación autenticada (§9) |

## 8. Estado de `dsh-data-quality`

| Dato | Valor |
|---|---|
| Versión | **0.3.29** exacta (no `latest` 0.3.30) |
| Ficheros | 980 (incluye su `node_modules` con `zod@4.6.6`), `cordis.patch.yml` presente |
| `dependencies` | ✓ |
| `bundles` | ✓ (10 entradas) |
| `pnpm-lock.yaml` | ✓ `dsh-data-quality@0.3.29` + snapshot `(…schemastery@3.18.5)` |
| `.modules.yaml` | ✓ `dsh-data-quality@0.3.29(@deepseek-ai/schemastery@3.18.5)` |
| Grafo de clientes | **no aplica** — el plugin **no declara `dsh.client`** (es server-only); es el único bundle del perfil sin cliente, y el grafo `/plugins/events` sólo lista módulos cliente. **No** es prueba de fallo |
| Carga | El perfil se compone sin error (Host arriba, resto de bundles compone) y su patch monta la fila `dsh-data-quality`. Sus tres tools (`data_profile`, `data_clean`, `data_verify`) requieren sesión para confirmarse |

## 9. Pruebas (T1-T12)

| # | Resultado | Evidencia |
|---|---|---|
| T1 artefacto | **PASS** | hash en origen y en `vendor/` |
| T2 spec `file:` | **PASS** | `package.json` = `b4db531a…` (hash previsto) |
| T3 lock por tarball | **PASS** | `resolution: {integrity: …, tarball: file:vendor/…}` |
| T4 data-quality 0.3.29 | **PASS** | `package.json` del paquete + 980 ficheros |
| T5 registro en manifiesto/bundles/lock/modules | **PASS** | cuatro grep con 1 coincidencia cada uno; grafo N/A (§8) |
| T6 siete herramientas | **PARCIAL** | suite 563/563 sobre el paquete instalado (acto anterior) + grafo; `relUri` requiere sesión |
| T7 no se busca 1.4.0 en el registro | **PASS** | copia del perfil + `pnpm install --lockfile-only --offline`: el error es el **preexistente** de tarballs de GitHub (`ERR_PNPM_NO_OFFLINE_TARBALL`), **0 menciones** a lifecode; el lock conserva `tarball: file:vendor/…` |
| T8 sin contradicciones | **PASS** | 2 entradas de lifecode (packages + snapshots, misma clave), 2 de data-quality, 1 en `.modules.yaml` cada uno, **0** referencias semver `1.4.0` |
| T9 demás plugins | **PASS** | 82 → 83 paquetes, 0 retirados, 1 añadido; versiones directas idénticas |
| T10 datos/roots/grants | **PASS** | `4b67cadc…`, `4dcf31c4…`, `6130ecba…`, `b15622c0…` idénticos |
| T11 paquete = aprobado | **PASS** | 75/75 |
| T12 Host sin errores | **PASS (con límite)** | Host arriba (5 procesos, puerto `54803`, grafo `rev f445234b55f8`); no hay log de sesión y el `crash-*.log` más reciente es del 2026-11-10 |

## 10. Integridad de datos y configuraciones

Registro (`4b67cadc…`), ámbito principal (`4dcf31c4…`), secundario (`6130ecba…`) y `config.json` (`b15622c0…`)
**sin cambios**. Registro v2, 3 proyectos, 3 raíces, 0 grants, auditoría intacta. `roots`, `grants` y permisos no se
tocaron. `cordis.patch.yml` (home y perfil) sin cambios.

## 11. Estado del Host

En ejecución (5 procesos `DeepSeek Harness`, escucha en `127.0.0.1:54803`). Arrancado por mí para validar; el perfil
**no** lo modificó (sus cinco hashes son los posteriores a mi instalación). Rutas PA: `401` sin sesión (compuerta de
autenticación, no prueba de existencia).

**Nota de honestidad:** reinicié el Host dos veces (validación y un intento de capturar su salida, que no produjo log:
Electron no escribe a stdout al lanzarse así). Ningún dato ni hash del perfil cambió entre reinicios.

## 12. Reversión

**No fue necesaria.** El procedimiento está en el expediente del plan y el respaldo (85/85) permite volver al estado
exacto anterior, incluida la ausencia de `dsh-data-quality`.

## 13. Estado Git

| | Antes | Después |
|---|---|---|
| HEAD | `7d7e839d514cca27044d595218bf8c67ec5a1f7d` | **idéntico** |
| Índice | vacío | **vacío** |
| `git status` | 54 (27 M / 27 ??) | **54 (27 M / 27 ??)** |

Sin commit, merge, rebase, push, reset, clean ni stash. Nada del worktree se tocó; la evidencia de este acto entra en
`plans/UX-02/UX-22-REPAIR-1.4.0-2026-11-23/`, dentro de la entrada no rastreada `plans/UX-02/`.

## 14. Dictamen

- Causa raíz eliminada: **LifeCode RAG se resuelve desde el TAR local**, no desde el registro.
- **`dsh-data-quality@0.3.29` recuperado** y coherente en los cuatro registros.
- Grafo completo: **sólo** los cambios previstos (forma de lifecode, alta de data-quality y su transitiva `zod@4.6.6`).
- Datos, roots, grants y permisos intactos; ningún otro complemento cambió.
- Pendiente de sesión (no es un fallo): confirmar las siete herramientas de LifeCode RAG (`relUri`) y los tres tools
  de `dsh-data-quality`.

**REPARACIÓN COMPLETADA — LifeCode RAG 1.4.0 local y dsh-data-quality 0.3.29 recuperado.**

Publicación npm: **no ejecutada**. No se inician mejoras del plugin en este acto.
