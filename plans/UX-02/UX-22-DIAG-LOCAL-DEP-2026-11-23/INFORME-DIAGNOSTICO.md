# Diagnóstico — dependencia local LifeCode RAG 1.4.0 y actualizaciones de DSH

**Acto:** diagnóstico de sólo lectura (autorizado). **Fecha:** 2026-11-23, 12:51-13:05 local.
**Sin implementar nada.** No se ejecutó `pnpm`, ni se tocó el perfil, ni el registro, ni los datos.

---

## 1. Causa raíz demostrada

El perfil declara LifeCode RAG como **dependencia semver de registro**:

```json
"@designerbyron/lifecode-rag": "1.4.0"
```

pnpm resuelve cualquier dependencia cuyo `specifier` es una versión **contra el registro**. La versión `1.4.0`
**no existe en ningún registro**: medido hoy, `npm view @designerbyron/lifecode-rag versions` devuelve
`['0.0.0-stage', '1.0.0', '1.1.0', '1.2.0', '1.3.0']` y `latest = 1.3.0`.

Mientras **no** hay que resolver, todo funciona: el lock tiene una entrada para `1.4.0` con un `integrity` (que yo
escribí) y pnpm se salta la resolución (`Lockfile is up to date, resolution step is skipped`). En el momento en que
**cualquier** operación cambia el conjunto de dependencias, pnpm re-resuelve el grafo completo y vuelve a pedir
`@designerbyron/lifecode-rag@1.4.0` al registro → **`ERR_PNPM_NO_MATCHING_VERSION`**.

**Demostrado con los logs de las cinco operaciones** (`profiles/desktop/.plugin-manager/logs/operation-*/pnpm.log`):

| Hora | Operación | Resultado |
|---|---|---|
| 12:51:09 | `I7XDs6` | **OK** — «Lockfile is up to date, resolution step is skipped / Already up to date» · aplica `- lifecode-rag 1.3.0 + 1.4.0` y **`- dsh-data-quality 0.3.29`** |
| 12:51:11 | `nWrN66` | **FALLA** — `No matching version found for @designerbyron/lifecode-rag@1.4.0` desde `registry.npmjs.org` |
| 12:51:13 | `E9d45Z` | **FALLA** — idéntico, desde `registry.npmmirror.com` |
| 12:51:16 | `hZRmAO` | **FALLA** — idéntico, `registry.npmjs.org` |
| 12:51:17 | `NpBr8L` | **FALLA** — idéntico, `registry.npmmirror.com` (con `UND_ERR_DESTROYED` en peticiones de otros plugins) |

El mensaje de pnpm es explícito: *«This error happened while installing a direct dependency of
C:\Users\BYRON\.dsh\profiles\desktop · The latest release … is "1.3.0"»*. Es decir: **no es un problema de red ni del
complemento que se actualizaba; es nuestra entrada de manifiesto la que no se puede resolver.**

## 2. Estado actual de LifeCode RAG

| Dato | Valor |
|---|---|
| Paquete instalado | **1.4.0**, 75 ficheros, 75/75 idénticos al TAR aprobado (`7bbecb09…`) |
| Ubicación | `profiles/desktop/node_modules/@designerbyron/lifecode-rag` (directorio real, `hoisted`) |
| Cargado por el Host | Sí — `@designerbyron/lifecode-rag` presente en el grafo, sirve su `client.js` del paquete instalado |
| Manifiesto | `"1.4.0"` (semver) — **irresoluble en registro** |
| Lock | `'@designerbyron/lifecode-rag@1.4.0'` con `resolution: {integrity: sha512-mojAqR…}` — forma de paquete **de registro** (no de `file:`) |
| `.modules.yaml` | mapa hoisted `@designerbyron/lifecode-rag@1.4.0` |
| Exclusión de edad | `… || 1.4.0` en `pnpm-workspace.yaml` y en el estado de pnpm |

**Diagnóstico:** el paquete está instalado y sirviendo, pero su declaración es **insatisfacible**. El perfil queda en
un estado «instalado pero no resoluble»: sobrevive a arranques, no sobrevive a ninguna actualización de otro
complemento.

## 3. Estado de `dsh-data-quality` (lo que se perdió en el fallo)

| Dato | Valor | Estado |
|---|---|---|
| En `dependencies` | **ausente** | eliminado por la operación 12:51:09 |
| En `dsh.profile.bundles` | **ausente** | eliminado por la misma operación |
| En `node_modules` | **no existe** | el directorio fue retirado |
| En `pnpm-lock.yaml` | **sin entrada** | el lock pasó de 86 a 84 entradas |
| En `.modules.yaml` | **sin entrada** | — |
| `0.3.30` parcial | **no hay restos** (ni en `node_modules`, ni en `.pnpm`, ni en el lock) | nunca llegó a instalarse |
| En el grafo del Host | **AUSENTE** | el Host ya no lo compone |
| Recuperable | **sí** — `dsh-data-quality@0.3.29` (y 0.3.23/0.3.26/0.3.27/0.3.28) están en el store `pnpm/v11` (`index.db`), sin necesidad de red | verificado |

**Traducción:** el intento de actualización **desinstaló** `dsh-data-quality` y no llegó a poner la versión nueva.
Ahora mismo tu DSH funciona **sin** ese complemento. No lo he tocado.

## 4. Archivos y referencias responsables

| Fichero | Referencia responsable |
|---|---|
| `profiles/desktop/package.json` línea 5 | `"@designerbyron/lifecode-rag": "1.4.0"` ← **el origen del fallo** |
| `pnpm-lock.yaml` líneas 11-13 (importers) | `specifier: 1.4.0` · `version: 1.4.0` |
| `pnpm-lock.yaml` línea 44-46 (packages) | clave `@1.4.0` + `resolution: {integrity: …}` (forma de registro) |
| `pnpm-lock.yaml` línea ~402 (snapshots) | clave `@1.4.0` |
| `node_modules/.modules.yaml` línea 14 | `"@designerbyron/lifecode-rag@1.4.0"` |
| `pnpm-workspace.yaml` línea 10 | exclusión de edad (irrelevante para este fallo: aplica a registro) |

**No hay** `file:`, `link:` ni `workspace:` para LifeCode RAG (medido: 0 referencias `file:`, 1 `link:` — la de
skill-compiler —, 0 `workspace:`). **No hay** `pnpm.overrides` ni catálogos configurados.

## 5. Por qué pnpm ignoró el paquete local

Porque **no hay ninguna declaración que lo señale**. El paquete llegó a `node_modules` por reemplazo directo del
directorio (método quirúrgico del acto de instalación), no por una resolución de pnpm. Para pnpm, `@…/lifecode-rag@1.4.0`
es un paquete **de registro** con un `integrity` conocido: si el lock está al día, lo da por instalado; si tiene que
resolver, pregunta al registro y no lo encuentra. No hay caché de decisión que lo salve: la especificación nunca
apuntó a un origen local.

Detalle relevante del store: ya existe un precedente medido de `file:` en esta máquina —
`file:../../../../../xampp/htdocs/plugins-dhs-release/plans/UX-02/UX-02-2.1-PACKAGE-1.3.0-2026-11-23/artifact/designerbyron-lifecode-rag-1.3.0.tgz`
(instalación de 1.3.0). pnpm 11.28.5 lo procesó sin problema.

## 6. Alternativas

| Criterio | **A. `file:` a TAR.GZ persistente** | **B. Bundle local «gestionado por DSH»** | **C. Overrides / catálogo pnpm** | **D. Publicar 1.4.0** |
|---|---|---|---|---|
| Compatible DSH 0.2.2-rc.5 | Sí — el bundle sigue siendo un nombre resuelto en `node_modules` | **No resuelve nada**: el Host compone bundles **por nombre** y el paquete debe estar instalado igualmente; un `pnpm install` lo poda si no es dependencia | Sí | Sí |
| Compatible pnpm 11.28.5 | Sí (precedente medido del 1.3.0 en el store) | — | Sí (`overrides` en `package.json`) | Sí |
| Actualizaciones de otros complementos | **No bloquean**: la resolución del grafo lee el tarball, no el registro | Sigue dependiendo de un paquete presente | Igual que A, con una capa extra | No bloquean |
| Persistencia del lockfile | `resolution: {tarball: file:vendor/….tgz}` + `integrity` del tarball | — | Igual que A | Igual que hoy |
| Coherencia de `.modules.yaml` | pnpm lo escribe al instalar | — | Igual | Igual |
| Integridad del paquete | pnpm verifica el `integrity` del lock contra el tarball | — | Igual | Firma del registro |
| Portabilidad del perfil | El tarball debe viajar con el perfil (ruta relativa) | — | Igual | Total |
| Resolución duplicada | Ninguna: una sola spec local | — | Riesgo si se mezcla override con spec semver | Ninguna |
| Reversión | Restaurar spec + lock del respaldo | — | Igual | N/A |
| Coste/riesgo | Cambio de 1 línea + fichero en el perfil | No sirve | +1 capa de indirección | Requiere publicar (fuera de alcance) |

**B no es una solución**: los `bundles` del perfil son **nombres de paquete**, y el paquete sólo existe si está
declarado como dependencia (o si se copia a mano, que es lo que se rompe en la primera resolución). C es A con
indirección: mantiene un spec semver mentiroso en `dependencies` y añade un override que hay que recordar.
**D** es el camino definitivo, pero requiere publicar y hoy está expresamente fuera de alcance.

## 7. Solución recomendada

**A — dependencia `file:` a un TAR.GZ persistente dentro del perfil**, p. ej.:

```json
"@designerbyron/lifecode-rag": "file:vendor/designerbyron-lifecode-rag-1.4.0.tgz"
```
con el artefacto copiado a `C:\Users\BYRON\.dsh\profiles\desktop\vendor\designerbyron-lifecode-rag-1.4.0.tgz`
(SHA-256 `7bbecb09…`).

Motivos, en orden:
1. **Elimina la causa raíz**: pnpm deja de consultar el registro para este paquete; las actualizaciones de los demás
   vuelven a funcionar.
2. **Es el mecanismo más simple** que cumple el requisito (el mandato pide la solución más simple, no la más
   sofisticada).
3. **Tiene precedente medido** en esta misma máquina y con el mismo pnpm.
4. **Sobrevive a `pnpm install`**: pnpm reinstala/copia desde el tarball con su `integrity`, así que el paquete deja
   de depender del reemplazo manual.
5. **Reversible en una línea** y con el respaldo ya existente.

Después de A, **recuperar `dsh-data-quality@0.3.29`** (está en el store; reinstalable sin red) y, cuando 1.4.0 se
publique, **volver al spec semver** (D) y retirar el tarball del perfil.

## 8. Riesgos y reversión

| Riesgo | Mitigación |
|---|---|
| `file:` copia el paquete en cada install (no lo enlaza) | Es el comportamiento actual (directorio real); sin cambio efectivo |
| El tarball se pierde o se mueve | Va dentro del perfil, en `vendor/`; el lock lo referencia por ruta relativa; el respaldo lo incluye |
| pnpm valida el `integrity` del tarball y falla si cambia | El tarball es inmutable por hash; si se reemplaza, nuevo hash y nuevo lock |
| Portabilidad a otro equipo | Copiar el perfil completo (incluye `vendor/`) |
| Reversión | Restaurar `package.json`, `pnpm-lock.yaml` y `.modules.yaml` del respaldo `inst-1.4.0-20261123T1229`; el paquete 1.3.0 está íntegro en `paquete-1.3.0/` |

## 9. Operaciones que requeriría la implementación (no ejecutadas)

1. Copiar el artefacto a `profiles/desktop/vendor/` y verificar su SHA-256 (`7bbecb09…`).
2. Cambiar la spec en `package.json` a `file:vendor/designerbyron-lifecode-rag-1.4.0.tgz`.
3. Re-añadir `dsh-data-quality: 0.3.29` en `dependencies` **y** en `bundles` (orden: después del paso 2, porque el
   install que lo recupera ya no debe toparse con la spec irresoluble).
4. Reconciliar el lock con una resolución real (`pnpm install`), que ahora **sí** puede completarse, y verificar:
   `resolution: {tarball: …}` para lifecode-rag, entrada de `dsh-data-quality@0.3.29`, y `.modules.yaml` con ambos.
5. Arrancar el Host y comprobar: `dsh-data-quality` de vuelta en el grafo, `lifecode-rag` 1.4.0 servido desde el
   perfil, siete herramientas, PA `pa/1.4.0`.
6. Respaldo del perfil **antes** de tocar nada (nuevo, con manifiesto LF) y reversión probada.

**Orden crítico:** primero A, después la recuperación; al revés, el install de recuperación vuelve a fallar por la
misma spec irresoluble.

## 10. Evidencia de que no modifiqué nada

- **Perfil**, hashes al empezar y al cerrar el acto: `package.json 85c53c165e479994`, `pnpm-lock.yaml
  65e8329750acacf2`, `pnpm-workspace.yaml 0a5f31d702917aec`, `.modules.yaml f5c600fb06b3bd24`,
  `.pnpm-workspace-state-v1.json 0aa73e0000376470` — **idénticos** antes y después.
- **Sin `pnpm`**: no se ejecutó ningún comando de pnpm (ni install, ni store, ni lockfile-only). Las consultas fueron
  `grep`/`sed`/`node:sqlite` en modo `readOnly` sobre **copias** o sobre índices del store.
- **Registro**: consultas HTTP de metadatos (`npm view … versions`), sin autenticación y sin publicación.
- **Datos, registro RAG, roots y grants**: no abiertos; ninguna escritura.
- **Host**: no se reinició ni se actualizó ningún complemento.
- **Git** (`plugins-dhs-release`): HEAD `7d7e839`, índice vacío, 54 entradas (27 M / 27 ??) — sin cambios; este
  informe entra en `plans/UX-02/`, que ya era una entrada no rastreada.

## Conclusión

La instalación local de 1.4.0 **no es incompatible con DSH**; lo incompatible es **declararla por versión y no
tenerla en el registro**. La actualización de cualquier otro complemento obliga a re-resolver y ahí salta. La salida
durable sin publicar es una **dependencia `file:` con el TAR.GZ dentro del perfil**; la salida definitiva es
publicar. Y queda un daño colateral que hay que reparar en el mismo acto: **`dsh-data-quality` está desinstalado**
(no actualizado) y su tarball sí está en el store.
