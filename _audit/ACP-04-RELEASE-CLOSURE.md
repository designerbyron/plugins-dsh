# ACP-04 — Cierre del release

**Verificación:** 2026-11-22 05:08–05:11 UTC (23:08–23:11 HAC)
**Paquete:** `@designerbyron/lifecode-rag` · **versión objetivo:** `1.0.0`
**Estado: `RELEASE_BLOCKED`** — el registro público no sirve la 1.0.0; sirve un stub `0.0.0-stage`.

---

## 1. Hecho central

La confirmación de que «la publicación se realizó correctamente» no se sostiene contra el registro. Lo
publicado a las `05:05:52Z` es:

```json
{ "name": "@designerbyron/lifecode-rag", "version": "0.0.0-stage", "stub": true,
  "description": "Temporary package placeholder for staged publishing" }
```

Dos ficheros, 374 B, `fileCount: 2`. La `1.0.0` responde `E404 No match found for version 1.0.0`.

No es un fallo del producto: el nombre está **reservado por el titular correcto** (`designerbyron`) y la
versión `1.0.0` sigue **libre**. El artefacto con el producto existe, está probado y no se ha subido.

## 2. Datos del registro

| Campo | Valor |
|---|---|
| URL del paquete | https://www.npmjs.com/package/@designerbyron/lifecode-rag |
| Versiones | `0.0.0-stage` (única) |
| `dist-tags.latest` | `0.0.0-stage` |
| Mantenedor | `designerbyron <designerbyron@gmail.com>` |
| Creado | `2026-11-22T05:05:52.985Z` |
| URL del tarball | https://registry.npmjs.org/@designerbyron/lifecode-rag/-/lifecode-rag-0.0.0-stage.tgz |
| `dist.integrity` | `sha512-8/bzStSY6vXgSd4qqis6EvfZj6A6iTvogqzjmulHro8SN+rp3HocL9yjLoV9Wg/8VAS/HHOyyiKRtRILG2hdHg==` |
| `dist.shasum` | `8e62e22470112e00a2ed08a298678bb18b60b7aa` |

## 3. Artefacto que debería estar publicado

| Dato | Valor |
|---|---|
| Fichero | `designerbyron-lifecode-rag-1.0.0.tgz` (274.146 B) |
| Ficheros | 73 (código, CLI, docs públicos, `LICENSE`, `README`) |
| Licencia | **MIT** · `Copyright (c) 2026 Byron Vanegas` |
| `sha256` | `595c6e19d592d730de65fd968a85fba7aa0869ae526cab596c279fdefbca1166` |
| `shasum` (SHA1) | `b2c0f43d4b112eb711925df28eb39312aad82e27` |
| `integrity` (SHA-512) | `sha512-DlyI70XCuChoK…dJMkv6OZfdNyw==` |
| Commit | `7d7e839` (licencia MIT) sobre `02d37ec` |
| Ubicación | `C:/Users/BYRON/AppData/Local/Temp/designerbyron-lifecode-rag-1.0.0-MIT.tgz` |

**La integridad publicada no coincide con la del artefacto**, como era de esperar: el publicado es otro
contenido (stub). La reconciliación de ACP-03 se mantiene válida para el artefacto; el registro no tiene
nada que reconciliar porque no subió el producto.

## 4. Matriz de criterios

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | El paquete existe en el registro público | PASS | `npm view` devuelve metadata del scope correcto |
| 2 | La versión publicada es exactamente `1.0.0` | **FAIL** | `E404 No match found for version 1.0.0` |
| 3 | La licencia publicada es MIT | **FAIL** | la 1.0.0 no existe; el stub no declara licencia |
| 4 | Existe URL pública de tarball | PASS | la del `0.0.0-stage` |
| 5 | Integridad y SHA1 disponibles | PASS | `sha512-8/bzStSY6…` / `8e62e224…` |
| 6 | Consultable sin ficheros locales | PASS | `npm view` desde el registro |
| 7 | Scope y nombre correctos | PASS | `@designerbyron/lifecode-rag`, mantenedor correcto |
| 8 | Instalación limpia de 1.0.0 desde npm | **FAIL** | `npm error notarget` |
| 9 | Exports públicos resuelven | BLOCKED | no instalable; PASS sobre el artefacto |
| 10 | Las siete tools disponibles | BLOCKED | ídem; PASS sobre el artefacto (`toolCount: 7`) |
| 11 | Id interno `lifecode-rag` | PASS (artefacto) | `cordis.patch.yml` del paquete instalado |
| 12 | Estados 401 / 409 / 503 | PASS (artefacto) | `httpStatusFor` + medición en host de ACP-03 |
| 13 | Núcleo host-agnostic | PASS (artefacto) | sin imports de `@deepseek-ai/*`, `cordis` ni `electron` |
| 14 | Reconciliación integridad registro ↔ ACP-03 | **FAIL** | publicada `sha512-8/bzStSY6…` ≠ autorizada `sha512-DlyI70XC…` |
| 15 | Repositorio original intacto | PASS | HEAD `655f03758fe1`, índice vacío, 1219 entradas dirty |
| 16 | Sin push, sin merge, sin cherry-pick | PASS | no ejecutados |
| 17 | Sin republicar | PASS | `npm publish` no ejecutado en este acto |
| 18 | Informes generados en `_audit/` del worktree | PASS | 4 informes + manifiesto |

**Recuento (contado del fichero):** 12 PASS · 4 FAIL · 2 BLOCKED · 18 filas, sin huecos.

## 5. Veredicto

**`RELEASE_BLOCKED`.** El criterio obligatorio «la versión 1.0.0 está publicada y es instalable desde el
registro» no se supera, y no puede superarse sin una publicación que este encargo prohíbe ejecutar.

No hay defecto funcional: sobre el artefacto autorizado, las siete herramientas, los contratos, los
códigos y la independencia del host están verificados (ver `ACP-04-PUBLIC-API-COMPATIBILITY.md`).

## 6. Lo único que falta, y cómo cerrarlo

En una terminal con tu OTP delante:

```sh
cd C:/xampp/htdocs/plugins-dhs-release/lifecode-rag
npm publish --access public
```

Comprobación inmediata de que esta vez subió lo correcto:

```sh
npm view @designerbyron/lifecode-rag@1.0.0 dist.integrity dist.fileCount license
# esperado: sha512-DlyI70XCuChoK…  ·  73  ·  MIT
```

Si `dist.integrity` no es `sha512-DlyI70XCuChoK…` o `fileCount` no es 73, se subió otro contenido: parar y
avisar. En cuanto coincida, ejecuto la instalación limpia desde el registro y cierro con `RELEASED`.

## 7. Estado del worktree y del repositorio

| Dato | Valor |
|---|---|
| Worktree de release | `C:/xampp/htdocs/plugins-dhs-release`, rama `release/lifecode-rag-1.0.0` |
| HEAD del worktree | `7d7e839d514cca27044d595218bf8c67ec5a1f7d` |
| Cambios sin commitear en el worktree | los 4 informes de `_audit/` + su manifiesto (no se commitean sin autorización) |
| Repositorio original | HEAD `655f03758fe1f723175b0d6437a49c7644b359ef`, índice vacío, 1219 entradas dirty intactas |
| Push | no ejecutado |

## 8. Documentos de este acto

| Fichero | Contenido |
|---|---|
| `ACP-04-NPM-REGISTRY-VERIFICATION.md` | lo que dice el registro, campo a campo |
| `ACP-04-CLEAN-CONSUMER-INSTALLATION.md` | instalación limpia: `notarget` para 1.0.0 |
| `ACP-04-PUBLIC-API-COMPATIBILITY.md` | exports, tools, códigos, id interno y host-agnostic sobre el artefacto |
| `ACP-04-RELEASE-CLOSURE.md` | este informe |
| `ACP-04-DELIVERABLES.sha256` | huellas SHA-256 de los cuatro |

---

## 9. Resolución posterior (ACP-05)

Este informe se conserva sin cambios: sus cuatro FAIL describían con exactitud lo que `npm view` devolvió a
las **05:08:34Z**. La resolución vive en `ACP-05-RELEASE-CLOSURE.md`:

- El registro fecha la 1.0.0 a las **05:08:00.539Z**, 34 segundos antes de esa consulta.
- Una consulta HTTP directa con `Cache-Control: no-cache` ve la 1.0.0, con `integrity`
  `sha512-DlyI70XCuChoKpM+EfefzwkmIMQErWlqwZs/2iW1s08zDc93GdPxEx3x1IQJ4lmhubE+0U06ZdJMkv6OZfdNyw==` y
  `shasum b2c0f43d…`, idénticos al artefacto autorizado.
- Ningún criterio de este informe queda abierto. Estado final: **`RELEASED`**.
