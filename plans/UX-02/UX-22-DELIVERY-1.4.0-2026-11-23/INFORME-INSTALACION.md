# INFORME DE INSTALACIÓN — LifeCode RAG 1.4.0 en DSH Desktop

**Acto:** ejecución de la instalación controlada autorizada (HANDOFF de ejecución, 2026-11-23).
**Estado:** instalación **aplicada**; verificación de contenido **completa**; verificación autenticada del Host
**parcial** (tres casillas requieren la sesión del propietario).

---

## 1. Artefacto utilizado

| Dato | Valor |
|---|---|
| Fichero | `designerbyron-lifecode-rag-1.4.0.tgz` (317 530 B) |
| SHA-256 medido al empezar | `7bbecb09482dcc36290956a7623b2247414c99fc42cc1b58caf22ce8dbca132b` — **coincide** con el autorizado |
| Ficheros | 75 |

No se regeneró, renombró ni sustituyó nada. El artefacto sustituido (`3fd6d2f9…`) no se usó.

## 2. Perfil y versión anterior

| Dato | Valor |
|---|---|
| Perfil | `C:\Users\BYRON\.dsh\profiles\desktop` (`DSH_HOME` no definido → `%USERPROFILE%\.dsh`) |
| Versión anterior | **1.3.0**, 74 ficheros · `index 23ed6951…`, `client ff8119dd…`, `pa-api 14ff188d…` |
| Ejecutable del Host | `0.2.2-rc.5` (medido en el `.exe`; `runtime.json` declara `0.2.2-rc.3`, es decir, el dato del expediente era el del runtime, no el del ejecutable) |
| Node / pnpm | 24.21.0 / 11.28.5 (runtime del Host) |
| `nodeLinker` | `hoisted`, paquete en **directorio real** |

## 3. Respaldo

| Dato | Valor |
|---|---|
| Ubicación | `C:\Users\BYRON\.dsh\backups\inst-1.4.0-20261123T1229` |
| Contenido | `perfil/` (7) · `home/cordis.patch.yml` (1) · `paquete-1.3.0/` (74) · `almacen/` (10, con sidecars) · `MANIFIESTO.sha256` |
| Manifiesto | **92 entradas**, `sha256sum -c` → **92/92 OK** |
| Bases | `quick_check` → `ok` en las tres copias (`registry`, ámbito principal, ámbito secundario) |
| Paquete | `import()` del `index.js` respaldado → carga sin dependencias externas |
| Comparación | `diff -r` del paquete copiado vs instalado → **idéntico**; `almacen/` difiere sólo en dos directorios `backups/` **vacíos** que el respaldo no crea |
| Extra | El directorio 1.3.0 **retirado del `node_modules`** se movió al respaldo como `paquete-1.3.0-retirado/` (74 ficheros, idéntico a `paquete-1.3.0/`); no entra en el manifiesto de 92 porque es duplicado del ya verificado |

## 4. Archivos y metadatos modificados

| Objeto | Cambio | Huella después |
|---|---|---|
| `profiles/desktop/package.json` | spec `1.3.0` → `1.4.0` | `439c0711deda9695` |
| `profiles/desktop/pnpm-lock.yaml` | 5 líneas: importers `specifier`+`version`, bloque `packages` (clave + `integrity`), bloque `snapshots` | `f7c1189866206742` |
| `profiles/desktop/pnpm-workspace.yaml` | exclusión de edad `1.1.0 \|\| 1.3.0` → `1.1.0 \|\| 1.3.0 \|\| 1.4.0` | `0a5f31d702917aec` |
| `node_modules/.pnpm-workspace-state-v1.json` | misma exclusión en `settings.minimumReleaseAgeExclude` | `0aa73e0000376470` |
| `node_modules/.modules.yaml` | mapa hoisted `@designerbyron/lifecode-rag@1.3.0` → `@1.4.0` | `ad2d6941da0cb535` |
| `node_modules/@designerbyron/lifecode-rag/` | reemplazo 74 → **75** ficheros | ver §7 |

Cada sustitución se aplicó con **exactamente 1 coincidencia** por patrón (aserción), y el lock resultante no contiene
ninguna referencia a `lifecode-rag@1.3.0`.

## 5. `minimumReleaseAge`

- Valor efectivo medido: **1440 min** (`node_modules/.pnpm-workspace-state-v1.json`).
- Exclusión ampliada a `1.4.0` en el YAML **y** en el estado de pnpm.
- **Evidencia real:** el verificador del pnpm del Host (11.28.5) ejecutado sobre una copia con el lock editado
  imprime `✓ Lockfile passes supply-chain policies (86 entries)`.
- **Control:** con el lock **original** el mismo comando imprime el mismo veredicto de política y falla después por
  `ERR_PNPM_NO_OFFLINE_TARBALL` (una dependencia de GitHub no está en el store) → el fallo de validación offline es
  **preexistente**, no del cambio.
- **Nota técnica:** `1.4.0` no existe en ningún registro (no se ha publicado), así que no tiene fecha de publicación
  que comparar; el perfil tiene `minimumReleaseAgeIgnoreMissingTime: true`. La exclusión se añade igualmente como
  defensa en profundidad para cualquier instalación futura que resolviera desde registro.
- **Criterio aplicado:** el éxito se midió por la **versión instalada y servida**, no por códigos de salida.

## 6. `.modules.yaml`

Reconciliado a `@designerbyron/lifecode-rag@1.4.0` (1 sustitución). Tras arrancar el Host, su hash **no cambió**
(`ad2d6941…`): el Host no lo reescribió. **No queda ninguna referencia `lifecode-rag@1.3.0`** en
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` ni `.modules.yaml` (grep = 0).

## 7. Puertas G1-G8

| Puerta | Resultado | Evidencia |
|---|---|---|
| G1 SHA-256 del artefacto | **PASS** | `7bbecb09…` exacto, 317 530 B |
| G2 Host cerrado y `-wal` a 0 B | **PASS** | 0 procesos electron/dsh; los tres `-wal` a 0 B antes de escribir |
| G3 Respaldo verificado | **PASS** | 92/92, `quick_check` ok ×3, import ok, `diff -r` idéntico |
| G4 Baseline de datos re-medido | **PASS** | 10 ficheros con los mismos hashes del expediente |
| G5 Lock validado en copia | **PASS con limitación** | política de cadena de suministro en verde; la resolución offline completa es imposible **incluso con el lock original** (control C1), por tarballs de GitHub ausentes del store |
| G6 Sustituciones 1:1 | **PASS** | 6 sustituciones, 1 coincidencia cada una (aserciones) |
| G7 Tras instalar: 75/75 y `package.json` 1.4.0 | **PASS** | `cmp` fichero a fichero: 75 idénticos, 0 distintos |
| G8 Matriz sin FAIL | **PARCIAL** | M1-M2, M5-M10, M12 en PASS; M3, M4 y M11 **BLOCKED** por falta de sesión (§9) |

## 8. Matriz M1-M12

| # | Prueba | Resultado | Evidencia medida |
|---|---|---|---|
| M1 | Carga del plugin | **PASS** | El Host arranca (5 procesos, escucha en `127.0.0.1:59598`) y sirve `plugins/??@designerbyron/lifecode-rag/client.js`: los primeros 243 913 B son **byte a byte** el `client.js` del paquete instalado (el resto es la cola `//# sourceMappingURL=…`, 84 B). Grafo con `rev 380bf9cd8a4c`, 84 entradas, `@designerbyron/lifecode-rag` presente (`rev 001bab98224a`) |
| M2 | Siete herramientas | **PARCIAL** | No enumerables sin sesión; el registro vive en `index.js`, **idéntico al de 1.3.0** donde ya estaban las siete, y la suite completa contra el paquete instalado pasa (§M12) |
| M3 | API PA | **BLOCKED** | `/lifecode-rag/pa/config`, `/snapshot`, `/workspaces` → **401** (compuerta de autenticación: un 401 no prueba existencia ni versión) |
| M4 | Autorización y aislamiento | **BLOCKED** | requiere llamada autenticada |
| M5 | Almacén v3 | **PASS** | `schema_version = 3` en ambos ámbitos (medido en copia) y `quick_check ok` |
| M6 | Registro v2 | **PASS** | `registry_version = 2`; auditoría intacta (`audit_head_seq 88`, hash `4c926da2…` en el respaldo) |
| M7 | Persistencia de datos | **PASS** | `registry 4b67cadc…`, ámbito principal `4dcf31c4…` (121/964/964), secundario `6130ecba…` (0/0/0), `config b15622c0…`: **idénticos al baseline** |
| M8 | Sin dependencias del Harness | **PASS** | 0 imports de `@deepseek-ai/*` o `cordis` en `index.js` y `lib/`; `index.js` instalado carga en Node aislado |
| M9 | Logs y errores | **PASS (con límite)** | No hay log de la sesión del Host; el único `crash-*.log` es del 2026-11-10. Sin evidencia de error de carga; el límite se declara |
| M10 | Coherencia de metadatos | **PASS** | paquete 1.4.0 / spec 1.4.0 / lock 1.4.0 con `sha512-mojAqR…` / `.modules.yaml` 1.4.0 / 0 referencias a 1.3.0 |
| M11 | Panel real | **BLOCKED** | requiere sesión (captura y consola) |
| M12 | Humo funcional | **PASS (fuerte)** | La **suite completa (563/563)** ejecutada **contra el paquete instalado** en un directorio temporal (copia del paquete + `tests/` del repo), 58,3 s |

## 9. Versión efectivamente cargada

**Instalada: `1.4.0` (75/75 idénticos al TAR).** El Host se arrancó **después** de la instalación y sirve el bundle
del cliente desde ese directorio (§M1). Lo que **no** se puede afirmar sin sesión es que el proceso servidor esté
ejecutando el código nuevo, porque ambas versiones declaran `PA_VERSION = 'pa/1.4.0'` y el `client.js` es idéntico:
la diferencia está en `lib/` (ocho módulos).

**Prueba de cierre (30 segundos, con sesión):** llamar `lifecode_rag_get` sobre una fuente conocida y comprobar que
la respuesta trae `source.relUri`; en 1.3.0 ese campo no existe. Alternativa: `lifecode_rag_forget` no aplica aquí
(escribe); `ingest` devolvería `warnings`. Con el campo `relUri` presente, M2/M3/M4/M11 se cierran.

## 10. Estado final del Host y del almacén

- Host **en ejecución**: 5 procesos `DeepSeek Harness`, escucha en `127.0.0.1:59598`, grafo `rev 380bf9cd8a4c`
  (84 entradas; en la sesión anterior se midieron 83 — delta no atribuido, no relacionado con el paquete).
- Al arrancar, el Host **abrió y cerró** las bases: desaparecieron cuatro sidecars (`-shm`/`-wal` de `registry` y del
  ámbito principal). Los **cuatro ficheros de datos conservan exactamente su hash**: el inventario pasa de 10 a 6
  ficheros y **no hay pérdida** (los `-wal` estaban a 0 B antes de arrancar).
- Otros plugins: **mismas versiones** que el baseline (`dsh-context 0.87.1`, `dsh-data-quality 0.3.29`,
  `billion-context 0.1.216`, `dsh-plugins-update 0.2.5`, `dsh-full-life-memory 0.8.0`, `lifecode-skill-center 1.0.1`,
  `skill-compiler 5.0.2`). El Host **no** lanzó ningún `pnpm install` (los cuatro ficheros del perfil conservan su
  hash; sólo cambió su `mtime`).

## 11. Reversión

**No fue necesaria.** Está disponible y verificada: `BACKUP-AND-ROLLBACK.md` §5 con el respaldo de
`inst-1.4.0-20261123T1229`.

## 12. Estado Git y cambios preexistentes

| | Antes del acto | Después |
|---|---|---|
| HEAD | `7d7e839d514cca27044d595218bf8c67ec5a1f7d` | **idéntico** |
| Índice | vacío | **vacío** |
| `git status` | 54 (27 M / 27 ??) | **54 (27 M / 27 ??)** |

Sin commit, merge, rebase, push, reset, clean ni stash. El worktree no se tocó: los ficheros de este acto entran en
`plans/UX-02/…`, que ya era una entrada no rastreada.

## 13. Dictamen

- **Artefacto:** el autorizado por hash. **Cumple.**
- **Instalación:** aplicada, 75/75 idénticos, metadatos coherentes, sin referencias residuales a 1.3.0. **Cumple.**
- **Respaldo:** verificado y restaurable. **Cumple.**
- **Integridad de datos:** registro v2 y almacenes v3 con hashes idénticos; sin pérdida. **Cumple.**
- **Núcleo:** independiente del Harness; suite 563/563 sobre el paquete instalado. **Cumple.**
- **Host:** arranca, carga la entrada del plugin y sirve su bundle desde el paquete instalado. **Cumple** en lo
  observable sin sesión.
- **Pendiente de tu sesión (no es un fallo):** M3 (API PA), M4 (autorización/aislamiento) y M11 (panel), y con ellas
  la confirmación de que el **código servidor** es el de 1.4.0 (campo `relUri` en `get`).

**Dictamen técnico:** instalación **ejecutada y aplicada**, con verificación de contenido completa y tres casillas
de la matriz propias de una sesión autenticada. No se declara el ciclo cerrado al 100 % hasta que esas tres se
ejecuten con tu sesión; el paquete, los datos y el perfil están en el estado previsto.
