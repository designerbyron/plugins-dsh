# ARTIFACT-MANIFEST — LifeCode RAG 1.4.0

**Acto:** HANDOFF T3 — expediente de entrega (documental). **Fecha:** 2026-11-23.
**Estado del artefacto:** **aprobado por el propietario** e **inmutable** para este acto: no se regenera, renombra ni
sustituye.

## 1. Identidad

| Dato | Valor | Estado |
|---|---|---|
| Nombre | `@designerbyron/lifecode-rag` | medido |
| Versión | `1.4.0` | medido |
| Fichero | `designerbyron-lifecode-rag-1.4.0.tgz` | medido |
| Tamaño | `317 530` B (descomprimido `1 097 503` B) | medido |
| SHA-256 | `7bbecb09482dcc36290956a7623b2247414c99fc42cc1b58caf22ce8dbca132b` | **verificado** hoy |
| SHA-512 (base64) | `sha512-mojAqRJhh6Hy+MLKNTK9VT+Je3VPtdZl7/vxvahQmPoIo6mzJMO2Wuaaj0TqgvYzfFPN9loR5l8RBM/PTsloBQ==` | medido |
| SHA-1 (`shasum`) | `9261d2f50a994b0fb2f4d896a5f58d5fcc54a401` | medido |
| Ficheros | `75` | medido |
| Ubicación exacta | `C:\xampp\htdocs\plugins-dhs-release\plans\UX-02\UX-22-PACKAGE-1.4.0-2026-11-23\artifact\designerbyron-lifecode-rag-1.4.0.tgz` | observado |

Verificación de este acto: `sha256sum` del fichero en esa ruta devuelve **exactamente** el SHA-256 autorizado. Si en
la instalación futura no coincide, se **detiene** (no se sustituye por otro paquete).

## 2. Manifiesto de integridad

- Manifiesto del acto de empaquetado (8 entradas, formato `hash *ruta`, LF):
  `…\UX-22-PACKAGE-1.4.0-2026-11-23\DELIVERABLES.sha256` — verificado `8/8 OK`.
- Inventario completo del contenido: `…\UX-22-PACKAGE-1.4.0-2026-11-23\INVENTARIO-PAQUETE.txt` (75 líneas).
- Artefacto sustituido (conservado, **no usar**): `artifact/superseded/…-manifiesto-v1.tgz`,
  SHA-256 `3fd6d2f93ef70969e7a9799834c07327aaee42c2bb659e7540f45a5629eb330d`.

## 3. Inventario (75)

| Grupo | N | Contenido |
|---|---|---|
| Raíz | 7 | `index.js`, `client.js`, `package.json`, `cordis.patch.yml`, `icon.svg`, `README.md`, `LICENSE` |
| `lib/` | 53 | módulos del núcleo (todos los del árbol) |
| `bin/` | 1 | `bin/lifecode-rag.mjs` |
| `docs/` | 14 | los 13 de 1.3.0 + **`docs/CONTRATO-EXTENSIONES-1.4.md`** |

**No incluye** (por diseño, y verificado): `tests/`, `tools/`, `demo/`, `bench/`, `eval/`, `plans/`, `_audit/`,
`node_modules/`, ni `.sqlite3/.log/.tmp/.bak/.wal/.shm/.tgz`. El manifiesto publicado **no declara `scripts`**: el
paquete no anuncia ningún comando que no pueda ejecutarse dentro de él (corrección del acto de empaquetado v2).

## 4. Auditoría independiente

| Comprobación del auditor | Resultado | Autoridad |
|---|---|---|
| SHA-256 / SHA-512 coinciden | conforme | **reportado** por el propietario; SHA-256 **re-verificado** aquí |
| 75/75 ficheros coinciden con el inventario | conforme | reportado |
| Contrato 1.4 incluido | conforme | reportado y **observado** aquí |
| Importación de `index.js` correcta | conforme | reportado; **re-medido** aquí sobre extracción temporal |
| Sin rutas inseguras ni artefactos de desarrollo | conforme | reportado; **re-medido** (0 coincidencias) |
| Inconsistencia de `scripts` en el manifiesto | **hallazgo** → corregido en el artefacto v2 | reportado y corregido |

## 5. Delta frente a lo instalado (1.3.0)

Comparado el contenido del TAR.GZ contra
`C:\Users\BYRON\.dsh\profiles\desktop\node_modules\@designerbyron\lifecode-rag` (74 ficheros):

- **63 idénticos** (incluye `index.js`, `client.js`, `lib/pa-api.mjs`: **la API y el panel no cambian**).
- **11 cambiados**: `lib/context.mjs`, `lib/ingest.mjs`, `lib/metrics.mjs`, `lib/paths.mjs`, `lib/scope-ops.mjs`,
  `lib/search.mjs`, `lib/sync.mjs`, `lib/tools.mjs`, `package.json`, `README.md`,
  `docs/PROJECT-AWARE-SESSION-CONTRACT.md`.
- **1 nuevo**: `docs/CONTRATO-EXTENSIONES-1.4.md`.
- **0 eliminados**.

Consecuencia: el cambio efectivo en runtime son **ocho módulos del núcleo**; el adaptador (`index.js`), el panel
(`client.js`) y la capa PA (`lib/pa-api.mjs`) son byte a byte los ya instalados y auditados en 1.3.0.
`PA_VERSION` sigue siendo **`pa/1.4.0`** en ambas versiones: **no hay salto de contrato de API**.
