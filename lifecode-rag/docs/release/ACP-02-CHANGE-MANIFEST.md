# ACP-02 — Manifiesto de cambios

**Base:** HEAD `655f037` (rama `fix/t45-4-r17-acceptance`). Sin commits, sin push, sin reset, sin clean.
**Snapshot instalado:** `acp01-576b8d836ad7` en `C:/xampp/htdocs/dsh-plugins-store/lifecode-rag/`.

## 1. Ficheros tocados en este acto

| Fichero | sha256 (16) | Bytes | Qué cambió |
|---|---|---|---|
| `lifecode-rag/lib/errors.mjs` | `d04fa385cddcb163` | 6.897 | `RAG_CODES` completo; `HTTP_STATUS` único; `SECURITY_CODES`, `FAIL_CLOSED_CODES`; `RagError.catalogued` |
| `lifecode-rag/lib/pa-api.mjs` | `81e9d495e553d990` | 25.367 | `GET /history` con cursor, total e integridad; `PA_VERSION='pa/1.2.0'` |
| `lifecode-rag/client.js` | `9af3c748c23da6be` | 157.062 | Vista Historial, i18n ES/EN, hidratación de `/history` |
| `lifecode-rag/tests/error-codes.test.mjs` | `6ce0a35f70a0f416` | 8.583 | Nuevo: exhaustividad del catálogo y del mapa HTTP |
| `lifecode-rag/tests/pa-history.test.mjs` | `a80307fd531b4a69` | 7.106 | Nuevo/reparado: contrato de `/history` |
| `lifecode-rag/tests/client.test.mjs` | `dcef271db7cb3b49` | 46.244 | 56 casos; historial y selección |
| `lifecode-rag/docs/PA-UI-0-API-CONTRACT.md` | `a616db92c6fc4a46` | 68.601 | §6.11, §16, nota de versión |

Sin cambios en este acto: `index.js` (`c5c1bea60d0bc1a6`), `lib/selection.mjs` (`436ec0cc7aedd905`),
`tests/pa-auth.test.mjs` (`f2d34c118f3d484d`), `tests/selection-cas.test.mjs` (`7f84405421e04248`).

## 2. Ficheros creados fuera del plugin

| Fichero | Para qué | Estado |
|---|---|---|
| `plugins-dhs/ACP02-INGEST-PROBE.md` | Sonda sintética de la prueba de ingesta (473 B, marcador `ACP02-PROBE-2026-11-22`) | Temporal; su fuente sigue indexada (ver §4) |
| `_audit/ACP-02-FINAL-REPORT.md` | Informe final | Entregado |
| `_audit/ACP-02-ACCEPTANCE-MATRIX.md` | Matriz de 31 criterios | Entregado |
| `_audit/ACP-02-TEST-EVIDENCE.md` | Evidencia reproducible | Entregado |
| `_audit/ACP-02-CHANGE-MANIFEST.md` | Este fichero | Entregado |

Scripts de apoyo en `…/hermes/…/cache/scratch/`: `read-session.mjs` (lector multiframe del transcript),
`acp02-send3.ps1` (envío verificado de un prompt a la ventana), `acp02-prompt*.txt`.

## 3. Estado del despliegue

- `~/.dsh/profiles/desktop/package.json`: `link:C:/xampp/htdocs/dsh-plugins-store/lifecode-rag/acp01-576b8d836ad7`.
- Junction `node_modules/@local/lifecode-rag` al mismo destino.
- `dsh.profile.bundles` incluye el plugin.
- Respaldo previo del perfil y del almacén: `C:/Users/BYRON/.dsh/backups/acp02-2026-11-22T0250`.
- Vuelta atrás documentada en `_audit/LIFECODE-RAG-1.0.0-ROLLBACK-GUIDE.md`; build anterior
  `655f03758fe1` intacto (407 ficheros) y capaz de abrir el registro.

## 4. Estado de datos

- Proyecto `LifeCode RAG`: 121 fuentes, sin cambios en este acto (sólo lecturas: búsqueda, contexto).
- Proyecto `plugins-dhs`: la fuente sintética (`src_8fd3518f8ae5b262`, 473 B) que creó la prueba de
  ingesta fue **eliminada** por la vía oficial el 2026-11-22 (aprobación `allowed-once`); el proyecto
  quedó con 0 fuentes. Detalle en `ACP-02-CLEANUP-REPORT.md`. El fichero `ACP02-INGEST-PROBE.md` sigue en
  disco, sin indexar.
- Registro: `user_version = 2`, `quick_check = ok`; sin migración nueva en este acto.
- Ningún `-wal` con contenido tras las comprobaciones.

## 5. Desviaciones de arquitectura

Ninguna. La compuerta sigue en el adaptador (`index.js`), el CAS y el historial viven en `lib/` sin
dependencias del host, y el cliente no recibe credenciales.
