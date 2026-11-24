# REPAIR-PLAN — reparación de dependencias y recuperación de `dsh-data-quality`

**Acto:** HANDOFF de preparación (2026-11-23). **Nada de este plan se ha ejecutado.**
**Alcance de esta entrega:** investigación, diseño, cálculo de cambios, validación previa y documentación.
**Ejecución:** requiere autorización humana posterior, atada al hash de este plan y al del artefacto.

---

## 1. Objetivo

1. LifeCode RAG **1.4.0** sigue instalado desde un **artefacto local** (`file:`), no desde el registro.
2. Las actualizaciones de otros complementos **dejan de intentar resolver** `1.4.0` en npm.
3. `dsh-data-quality@0.3.29` vuelve a estar instalado y registrado.
4. Lock y `.modules.yaml` coherentes.
5. Operación reversible; sin tocar datos, roots, grants ni permisos.
6. LifeCode RAG sigue siendo independiente del Harness (el `file:` no introduce ninguna dependencia nueva).

## 2. Objetos autorizados

| Objeto | Valor |
|---|---|
| Artefacto | `designerbyron-lifecode-rag-1.4.0.tgz` · **SHA-256 `7bbecb09482dcc36290956a7623b2247414c99fc42cc1b58caf22ce8dbca132b`** · 317 530 B · 75 ficheros |
| Destino | `C:\Users\BYRON\.dsh\profiles\desktop\vendor\` (no existe hoy; se crea en la ejecución) |
| Spec nueva | `"@designerbyron/lifecode-rag": "file:vendor/designerbyron-lifecode-rag-1.4.0.tgz"` |
| Recuperación | `dsh-data-quality@0.3.29` (publicada 2026-11-22T08:00Z; `latest` es 0.3.30 — **no se usa**) |

## 3. Estado de partida medido (2026-11-23, 13:0x)

| Elemento | Valor |
|---|---|
| `package.json` | `85c53c165e479994` · deps: 7 (sin `dsh-data-quality`) · bundles: 9 (sin `dsh-data-quality`) |
| `pnpm-lock.yaml` | `65e8329750acacf2` · 84 entradas · `lifecode-rag@1.4.0` con `resolution: {integrity: sha512-mojAqR…}` |
| `pnpm-workspace.yaml` | `0a5f31d702917aec` · `nodeLinker: hoisted` · exclusión `dsh-data-quality@0.3.28 \|\| 0.3.29` · exclusión `lifecode-rag@1.1.0 \|\| 1.3.0 \|\| 1.4.0` |
| `.modules.yaml` | `f5c600fb06b3bd24` · mapa hoisted con `lifecode-rag@1.4.0`, **sin** `dsh-data-quality` |
| Estado de pnpm | `0aa73e0000376470` · `minimumReleaseAge: 1440` · exclusiones sin `dsh-data-quality` en el estado (el YAML sí la tiene) |
| Paquete instalado | `node_modules/@designerbyron/lifecode-rag` 1.4.0, 75/75 idénticos |
| `dsh-data-quality` | **ausente** de manifiesto, lock, `.modules.yaml`, `node_modules` y grafo |
| Store pnpm | `dsh-data-quality@0.3.29` indexada con `sha512-UV7aTAWA/xIhs7gT79n6Bs3eAy2kS4WwGbgIMR8r8j/apmUkHQFmbCJJ3xs8tHtjAhQfrftVWGGwBIB7NPWrvA==` |

## 4. Mecanismo elegido y por qué

**Dependencia `file:` a un TAR.GZ dentro del perfil.** Es la única opción que cumple los seis objetivos con un cambio
de una línea:

- pnpm resuelve el paquete **del tarball**, sin consultar el registro → las actualizaciones de otros complementos
  vuelven a funcionar.
- Mantiene la integridad: pnpm registra y verifica el `integrity` del tarball.
- No añade dependencias al núcleo del plugin ni acopla LifeCode RAG al Harness.
- Reversible restaurando cuatro ficheros.

Descartadas en el diagnóstico: bundle «local» (los `bundles` se componen por nombre y el paquete debe estar
instalado igualmente), `overrides` (misma solución con una capa más y un spec semver mentiroso), publicar (fuera de
alcance; es el camino definitivo).

## 5. Cómo se evita que DSH vuelva a la referencia semver (medido en su código)

| Hecho medido | Consecuencia |
|---|---|
| El instalador del Host ejecuta `pnpm add <spec> …` con el nombre y la versión pulsados (`lib/index.js:478-487` de `dsh-plugins-update`) | Instalar/actualizar **otro** paquete **no reescribe** la spec de LifeCode RAG: `pnpm add` sólo toca el paquete nombrado |
| La comprobación de actualización usa `compareSemver(info.version, currentVersion) > 0` (`lib/index.js:791`) | Con el registro en `1.3.0` y el instalado en `1.4.0`, **no ofrecerá actualización** de LifeCode RAG (1.3.0 no es mayor) |
| El «retirar» del fallo quitó `dsh-data-quality` de `dependencies` y `bundles` | El Host sí reescribe **el paquete que se está instalando/retirando**; por eso la regla es no operar sobre LifeCode RAG desde el gestor |

**Reglas de operación que el plan deja escritas:**
1. **No** usar «Actualizar» ni «Instalar» sobre `@designerbyron/lifecode-rag` mientras el artefacto no esté publicado.
2. Las actualizaciones de los demás son seguras (medido: no tocan su spec).
3. Si alguna vez se reescribe la spec a semver, el sistema falla exactamente como hoy: se restaura el respaldo.
4. Cuando 1.4.0 se publique: cambiar la spec a `1.4.0`, ejecutar la reconciliación y retirar `vendor/`.

## 6. Secuencia (no ejecutada)

**G0 — Puertas previas** (todas obligatorias): artefacto con su SHA-256; Host cerrado con `-wal` a 0 B; respaldo
nuevo verificado; hashes del perfil re-medidos e iguales a §3.

1. **Verificar el artefacto**: `sha256sum` = `7bbecb09…` y 317 530 B. Si no, detener.
2. **Respaldo nuevo** (ver `BACKUP-AND-ROLLBACK.md`): 5 ficheros del perfil + `node_modules/@designerbyron/lifecode-rag`
   (75) + inventario de plugins directos con versiones + notas del store + manifiesto LF. Verificar `N/N`.
3. **Incorporar el artefacto**: crear `profiles/desktop/vendor/` y copiar el TGZ; **re-verificar el SHA-256 en el
   destino** (copia, no movimiento: el artefacto de `plans/` se conserva).
4. **Cambiar la spec**: `"1.4.0"` → `"file:vendor/designerbyron-lifecode-rag-1.4.0.tgz"` (una sola coincidencia).
   Hash esperado del fichero resultante: **`b4db531a…`** tras el paso 5 (ver `EXPECTED-STATE.md`).
5. **Recuperar `dsh-data-quality`**: añadir `"dsh-data-quality": "0.3.29"` en `dependencies` (tras `dsh-context`) y
   `"dsh-data-quality"` al final de `dsh.profile.bundles`.
6. **Reconciliación controlada**: con el pnpm del Host (11.28.5), desde el perfil y con el Host cerrado:
   `pnpm install` (sin `--frozen-lockfile`, porque el manifiesto cambió). Registro efectivo: `https://registry.npmjs.org/`
   (medido por defecto) o el que el Host tenga configurado. Debe: resolver el tarball local, instalar
   `dsh-data-quality@0.3.29` desde registro/store, reescribir `pnpm-lock.yaml` y `.modules.yaml`.
   - Si la red falla y el store tiene lo necesario: `pnpm install --offline`.
   - **No** usar `pnpm add` (reescribiría la spec con `@version`).
7. **Verificar lock y `.modules.yaml`**: `specifier: file:vendor/…`; resolución por tarball; `dsh-data-quality@0.3.29`
   con su `integrity`; mapa hoisted con ambos; **0** referencias a `lifecode-rag@1.4.0` como paquete de registro.
8. **Verificar ambos complementos**: 75/75 de LifeCode RAG contra el TAR; `dsh-data-quality` con `package.json`
   0.3.29 y sus ficheros completos; ambos presentes en el grafo del Host tras arrancarlo.
9. **Verificar el resto del grafo**: los siete plugins directos restantes con sus versiones de §3; ninguna otra
   entrada del lock cambia de versión.
10. **Documentar la reversión** y el estado final (hashes nuevos) en el informe del acto.

## 7. Reversión (resumen; detalle en `BACKUP-AND-ROLLBACK.md`)

Restaurar `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.modules.yaml` y el estado de pnpm desde el
respaldo; retirar `vendor/`; restaurar el directorio del paquete desde el respaldo si hiciera falta. Lo datos no se
tocan: la reparación no abre ningún almacén.

## 8. Criterios de aborto

- El artefacto no coincide con su SHA-256, o el `vendor/` copiado no coincide.
- El respaldo no verifica (`N/N OK`), o no incluye alguno de los cinco ficheros del perfil.
- El Host está vivo y no puede cerrarse, o algún `-wal` no llega a 0 B.
- Una sustitución de texto coincide 0 o ≥2 veces.
- Tras `pnpm install`: aparece `ERR_PNPM_NO_MATCHING_VERSION` para LifeCode RAG (el `file:` no se aplicó), o cualquier
  otro plugin directo cambia de versión.
- `dsh-data-quality` no queda en 0.3.29 exacto.

## 9. Lo que este plan NO hace

No publica, no cambia registros de raíces ni grants, no toca almacenes ni `config.json`, no modifica otros plugins,
no cambia `minimumReleaseAge`, no actualiza `dsh-data-quality` a 0.3.30, no altera la independencia del núcleo.
