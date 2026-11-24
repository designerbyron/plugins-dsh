# DELIVERY-PLAN — instalación controlada de LifeCode RAG 1.4.0

**Naturaleza:** plan **documental**. Nada de este documento se ha ejecutado. La ejecución será un acto separado con
autorización humana explícita.
**Artefacto:** ver `ARTIFACT-MANIFEST.md`. SHA-256 `7bbecb09482dcc36290956a7623b2247414c99fc42cc1b58caf22ce8dbca132b`.

Todas las rutas y cifras de este plan son **medidas en este equipo** el 2026-11-23, no supuestas.

---

## 1. Perfil DSH de destino

| Dato | Valor medido | Cómo se midió |
|---|---|---|
| `DSH_HOME` | **no definido** en el shell → se usa el valor por defecto `C:\Users\BYRON\.dsh` | `echo $DSH_HOME` + existencia del directorio |
| Perfiles presentes | `desktop`, `headless`, `web` | `ls ~/.dsh/profiles` |
| Perfil del producto | **`C:\Users\BYRON\.dsh\profiles\desktop`** | su `package.json` declara el paquete y su bundle; el almacén registra `profile_root = C:\Users\BYRON\.dsh\lifecode-rag\profiles\desktop` |
| Otros perfiles | `headless` y `web` **no** tienen LifeCode RAG instalado | `node_modules/@designerbyron/…` ausente en ambos |

**A comprobar de nuevo antes de escribir** (el perfil es del Host y se mueve solo): que el proceso real del Host se
lance sin `--user-data-dir` alternativo y que `DSH_HOME` siga sin definir. Si el Host arranca con un `DSH_HOME`
distinto, el perfil de destino **no** es éste y el acto se detiene.

## 2. Instalación actual

| Dato | Valor medido |
|---|---|
| Versión instalada | **`1.3.0`** (`node_modules/@designerbyron/lifecode-rag/package.json`) |
| Ficheros | **74** |
| `index.js` | `23ed6951…` (idéntico al del TAR 1.4.0) |
| `client.js` | `ff8119dde0c1a41e…` (idéntico) |
| `lib/pa-api.mjs` | `14ff188d…` · `PA_VERSION = 'pa/1.4.0'` (idéntico) |
| Forma del `node_modules` | **directorio real**, no symlink (`lstat` + `realpath`) |
| `nodeLinker` | **`hoisted`** (`node_modules/.modules.yaml`) |
| `node_modules/.pnpm` | existe, **sin entrada** para este paquete (se usa para otros) |
| Entrada en el paquete del perfil | `"@designerbyron/lifecode-rag": "1.3.0"` (spec **exacta**) y en `dsh.profile.bundles` |
| Host | `desktopVersion 0.2.2-rc.3`, node `24.21.0`, pnpm `11.28.5` (`dsh-runtimes/dsh-primary-runtime/runtime.json`) |
| `engines` del paquete | `node >=22.5.0`, `dsh >=0.2.2-rc.3 <0.3.0` → **cumple**, en el límite inferior exacto |
| Estado del Host ahora | **no hay proceso electron/dsh** en ejecución (medido) |

## 3. Qué se modificaría exactamente

| Objeto | Cambio | Tamaño/huella actual |
|---|---|---|
| `profiles/desktop/package.json` | `"1.3.0"` → `"1.4.0"` (1 línea) | 1 011 B · `ed9e1426dc55f207` |
| `profiles/desktop/pnpm-lock.yaml` | importers `specifier`+`version`, bloque `packages` (clave + `integrity`), bloque `snapshots` | 30 297 B · `6f97fe2b89ce2501` |
| `profiles/desktop/pnpm-workspace.yaml` | añadir `|| 1.4.0` a la exclusión de `@designerbyron/lifecode-rag` | 346 B · `03c867f7dac62530` |
| `node_modules/.pnpm-workspace-state-v1.json` | reflejar la exclusión (pnpm lo reescribe; hoy `minimumReleaseAge: 1440` y la lista **sin 1.4.0**) | 1 249 B · `b952038fe02750f2` |
| `node_modules/.modules.yaml` | su mapa hoisted dice `@designerbyron/lifecode-rag@1.3.0` → debe decir `1.4.0` | 7 457 B · `3c55c109bf24455c` |
| `node_modules/@designerbyron/lifecode-rag/` | reemplazo del directorio: 74 → **75** ficheros | — |
| **Datos** | **ninguno** (esquema v3 y registro v2 no cambian; el código 1.4.0 no migra) | ver §5 |

**No se toca:** `cordis.patch.yml` del home (82 líneas, `8ab9f8f0c3f561b8`), `profiles/desktop/cordis.patch.yml`
(2 344 B) ni `cordis.yml`, proveedores (`config.json` del almacén: `embedding.provider = local-hash-v1`,
`dim 256`, `remote = null` → **sin egreso ni credenciales**), roots, grants, bibliotecas ni auditoría.

## 4. Respaldo verificable

Procedimiento completo, alcance y verificación: **`BACKUP-AND-ROLLBACK.md`**. Antes de cualquier escritura debe
existir el respaldo con su manifiesto `sha256sum -c` en verde.

## 5. Cómo se instalaría (actualización quirúrgica)

Se mantiene el método probado en 1.3.0 (**no** `pnpm install` genérico): el paquete es un directorio real en un
`node_modules` hoisted, y un install completo puede mover paquetes ajenos.

1. **Puertas previas** (G1-G8, §9). Host cerrado y `-wal` a `0 B`; respaldo verificado.
2. **Re-verificar el artefacto**: `sha256sum` = `7bbecb09…`. Si no, parar.
3. **Validar el lock editado en una copia** (temporal, fuera del perfil): `package.json`, `pnpm-lock.yaml`,
   `pnpm-workspace.yaml`, `node_modules` copiados, y allí `pnpm install --lockfile-only --offline`. Si el ensayo
   fallara por un `link:` ajeno desfasado, se repite con el lock **original** en copia limpia para demostrar que el
   desfase es preexistente (así se resolvió en 1.3.0) antes de dar el ensayo por fallido.
4. **Editar los tres ficheros** del perfil con sustituciones de coincidencia única (5 líneas en el lock: 12, 13, 47-48
   y 420), y la exclusión de edad en el YAML **y** en el estado de pnpm.
5. **Reemplazar el directorio del paquete** por la extracción del TAR (75 ficheros), sin tocar nada más del
   `node_modules`. Retirar el directorio anterior al respaldo (no dejarlo dentro de `node_modules`).
6. **Reconciliar `.modules.yaml`** para que el mapa hoisted apunte a `1.4.0`, o dejar que lo reescriba el primer
   `pnpm install` del Host y verificarlo entonces (queda como control explícito en la matriz).
7. **Arrancar el Host** y ejecutar la matriz de `POST-INSTALL-VALIDATION.md`.

**Sobre `minimumReleaseAge`:** el valor efectivo en este perfil es **1440 min (24 h)**, y la lista de exclusiones
sólo cubre `1.1.0 || 1.3.0`. Sin añadir `1.4.0`, un install real puede fallar con
`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` **o quedarse en la versión anterior sin fallar**. El criterio de éxito es la
**versión instalada y servida**, nunca el código de salida.

## 6. Verificar que el Host reconoce el plugin

- El paquete debe estar en `dsh.profile.bundles` (ya está, no cambia) y en `dependencies` con `1.4.0`.
- Señal fuerte de carga: el grafo del Host sirve `client.js` y el plugin responde en su prefijo PA.
- **No vale** un `401` como prueba de existencia (la compuerta de autenticación responde antes de mirar la ruta): se
  exige `200`/`405`/`400` con sesión, o lectura del registro del Host.

## 7. Siete herramientas

`lifecode_rag_ingest`, `search`, `context`, `get`, `list`, `forget`, `reindex` — nombres, orden y esquemas **sin
cambios** entre 1.3.0 y 1.4.0 (el valor de `search` y sus filas siguen congelados por contrato v0.1). Se verifican
por el registro de herramientas del Host y por `GET` de la API del panel que las enumere.

## 8. API PA y autorización

- Prefijo `PA_PREFIX = '/lifecode-rag/pa'`, versión **`pa/1.4.0`** (la misma en ambas versiones).
- Rutas de sólo lectura: `/config`, `/snapshot`, `/history`, `/workspaces`, `/selection`; mutaciones por `POST|PATCH`
  con CAS y CSRF.
- Autorización: se revalida en cada operación; raíces del registro (3), `grants` 0, `libraries` 0. **Nada de esto se
  modifica** en la entrega.

## 9. Puertas y criterios de aborto

| Puerta | Condición de paso |
|---|---|
| G1 | SHA-256 del artefacto = `7bbecb09…` |
| G2 | Host cerrado, `registry.sqlite3-wal` y `rag.sqlite3-wal` a **0 B**, 0 procesos electron/dsh |
| G3 | Respaldo completo + `sha256sum -c` en verde + `quick_check ok` en las copias |
| G4 | Baseline de datos re-medido e igual al anotado en el expediente |
| G5 | Lock editado validado en copia (`--lockfile-only --offline`) |
| G6 | Sustituciones con exactamente 1 coincidencia por patrón |
| G7 | Tras instalar: 75/75 ficheros idénticos al TAR, `package.json` 1.4.0 |
| G8 | Matriz de validación posterior sin ningún FAIL |

**Aborto inmediato** si: el hash no coincide; el host está vivo y no puede cerrarse; el respaldo no verifica; el
`-wal` no llega a 0 B; una sustitución coincide 0 o ≥2 veces; tras instalar hay ficheros distintos del TAR.

## 10. Pruebas de humo sin datos reales

El humo se ejecuta sobre el **laboratorio aislado** (`lifecode-rag-lab` / `skill-compiler-lab-2026-11-05`), no sobre
el perfil: ingest de un fixture, `search`, `context`, `get`, `list`, `forget`, `reindex`, y la ruta `/pa/workspaces`.
En el perfil real sólo se hacen comprobaciones **de lectura** (versión, herramientas, rutas PA, recuentos del
almacén).

## 11. Reversión

Ver `BACKUP-AND-ROLLBACK.md` §5. Resumen: restaurar el directorio del paquete 1.3.0 desde el respaldo y devolver
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` y el estado de pnpm a sus huellas; **los datos no se tocan**
(no hay migración que deshacer).

## 12. Lo que este plan NO puede confirmar (y se cierra en la ejecución)

| Cuestión | Por qué no se puede ahora | Cómo se cierra |
|---|---|---|
| Que el Host cargue la 1.4.0 en caliente | el Host está cerrado; la carga ocurre al arrancar | matriz M1-M2 con el Host vivo |
| Que el panel muestre los estados nuevos | `client.js` es idéntico al instalado, pero la prueba es visual | matriz M3 sobre el panel real |
| Que `pnpm` reescriba `.modules.yaml` con `1.4.0` | depende de que el Host lance un install | matriz M10 |
| Que el `401` de las rutas nuevas sea realmente `401` de auth y no de ruta ausente | requieren sesión | matriz M4 con sesión del propietario |
