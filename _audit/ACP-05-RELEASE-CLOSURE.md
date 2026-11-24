# ACP-05 — Cierre del release

**Verificación:** 2026-11-22 05:12–05:14 UTC (23:12–23:14 HAC)
**Paquete:** `@designerbyron/lifecode-rag@1.0.0`

# Estado definitivo: `RELEASED`

---

## 1. Resumen

LifeCode RAG 1.0.0 está publicado en npm bajo el scope del propietario, con licencia MIT, y el tarball que
sirve el registro es **byte a byte** el artefacto que se probó. Un consumidor limpio lo instala desde npm y
obtiene las siete herramientas, los contratos y el núcleo independiente del host.

## 2. Datos del registro

| Campo | Valor |
|---|---|
| URL del paquete | https://www.npmjs.com/package/@designerbyron/lifecode-rag |
| Versión | **1.0.0** (`dist-tags.latest`) |
| Publicada | 2026-11-22T05:08:00.539Z |
| Publicó | `designerbyron` |
| Licencia | **MIT** |
| URL del tarball | https://registry.npmjs.org/@designerbyron/lifecode-rag/-/lifecode-rag-1.0.0.tgz |
| `integrity` | `sha512-DlyI70XCuChoKpM+EfefzwkmIMQErWlqwZs/2iW1s08zDc93GdPxEx3x1IQJ4lmhubE+0U06ZdJMkv6OZfdNyw==` |
| `shasum` (SHA1) | `b2c0f43d4b112eb711925df28eb39312aad82e27` |
| Ficheros | 73 (925 614 B descomprimidos) |

## 3. Artefacto

| Dato | Valor |
|---|---|
| Fichero autorizado | `designerbyron-lifecode-rag-1.0.0-MIT.tgz` (274 146 B) |
| `sha256` | `595c6e19d592d730de65fd968a85fba7aa0869ae526cab596c279fdefbca1166` |
| Coincidencia con el tarball descargado del registro | **idéntica** en tamaño y en los tres hashes |
| Commit | `7d7e839` (licencia MIT) sobre `02d37ec` |
| Id interno | `lifecode-rag` |

## 4. Matriz de criterios

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Identidad npm = `designerbyron` | PASS | `npm whoami` |
| 2 | Versión 1.0.0 existe en el registro | PASS | HTTP directo: `versions [0.0.0-stage, 1.0.0]` |
| 3 | `latest` apunta a 1.0.0 | PASS | `dist-tags = { latest: '1.0.0' }` |
| 4 | Licencia MIT publicada | PASS | `license = MIT` + `LICENSE` dentro del tarball |
| 5 | URL pública de tarball | PASS | descarga 200, 274 146 B |
| 6 | Integridad SHA-512 coincide con el autorizado | PASS | `sha512-DlyI70XC…` en ambos |
| 7 | SHA1 coincide | PASS | `b2c0f43d…` en ambos |
| 8 | 73 ficheros publicados | PASS | `dist.fileCount 73`, `tar -tzf` 73 |
| 9 | Sin datos privados ni informes en el paquete | PASS | grep de `db/sqlite/log/env/_audit/tests/tools/eval` → vacío |
| 10 | Instalación limpia desde npm | PASS | `npm install @designerbyron/lifecode-rag@1.0.0` |
| 11 | Versión instalada = 1.0.0 | PASS | `package.json` del consumidor |
| 12 | Exports públicos resuelven | PASS | `.`, `./client`, `./package.json`, `./lib/*` |
| 13 | Siete herramientas presentes | PASS | `toolCount: 7`, nombres exactos |
| 14 | Id interno `lifecode-rag` | PASS | `cordis.patch.yml` del paquete instalado |
| 15 | 401 / 409 / 503 | PASS | `httpStatusFor` sobre el paquete instalado |
| 16 | 52 códigos catalogados | PASS | `RAG_CODES.length` |
| 17 | Núcleo host-agnostic | PASS | sin imports de `@deepseek-ai/*`, `cordis` ni `electron` |
| 18 | Sin dependencias accidentales | PASS | `npm ls --depth=0`: sólo el paquete |
| 19 | No se republicó la versión | PASS | `npm publish` no ejecutado en este acto |
| 20 | No se reconstruyó el producto | PASS | worktree en `7d7e839`, sin cambios funcionales |
| 21 | Repositorio original intacto | PASS | HEAD `655f03758fe1`, índice vacío, 1224 dirty intactas |
| 22 | Sin push, merge, rebase ni cherry-pick | PASS | no ejecutados |

**Recuento (contado del fichero):** 22 PASS · 0 FAIL · 0 BLOCKED.

## 5. Incidente de ACP-04, resuelto

ACP-04 declaró `RELEASE_BLOCKED` con 4 FAIL porque `npm view` devolvía sólo `0.0.0-stage` a las 05:08:34Z.
El registro fecha la 1.0.0 a las **05:08:00.539Z**, 34 segundos antes, y una consulta HTTP directa con
`no-cache` la ve sin problema. La causa más probable es caché de metadata del cliente npm; no es
verificable a posteriori, así que se registra como explicación probable, no como hecho. La evidencia de
ACP-04 se conserva tal cual y su resolución queda documentada aquí.

**Ningún FAIL de ACP-04 sigue abierto.**

## 6. Limitaciones reales

1. No se lanzó un host DSH contra la instalación del registro en este acto: la carga en host se verificó en
   ACP-03 con el mismo `sha256`, y aquí se comprobó que el fichero publicado es el mismo. Queda como
   comprobación redundante no repetida, no como hueco.
2. `reindex` sobre datos de usuario sigue sin ejecutarse nunca, por mandato.
3. La transición DEMO → REAL en caliente dentro del mismo renderer no se observó (sí el reinicio).

## 7. Git y preservación

| Dato | Valor |
|---|---|
| Repositorio original | HEAD `655f03758fe1f723175b0d6437a49c7644b359ef`, índice vacío, 1224 entradas dirty intactas |
| Worktree de release | `C:/xampp/htdocs/plugins-dhs-release`, rama `release/lifecode-rag-1.0.0`, HEAD `7d7e839d514cca27044d595218bf8c67ec5a1f7d` |
| Cambios sin commitear en el worktree | los informes de `_audit/` (ACP-04 y ACP-05) y sus manifiestos; no se commitean sin autorización |
| Push / merge / rebase / cherry-pick | no ejecutados |

## 8. Documentos de este acto

| Fichero | Contenido |
|---|---|
| `ACP-05-PUBLICATION-REPORT.md` | preflight y datos de la publicación |
| `ACP-05-REGISTRY-INTEGRITY.md` | comparación de integridad artefacto ↔ registro |
| `ACP-05-CLEAN-CONSUMER-VERIFICATION.md` | instalación desde npm y verificación de contratos |
| `ACP-05-RELEASE-CLOSURE.md` | este informe |
| `ACP-05-DELIVERABLES.sha256` | huellas SHA-256 de los cuatro |
