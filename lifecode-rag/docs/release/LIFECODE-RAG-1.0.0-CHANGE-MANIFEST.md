# LifeCode RAG 1.0.0 · Manifiesto de cambios

HEAD de partida y de llegada: `655f037` (rama `fix/t45-4-r17-acceptance`). **Nada se commiteó**: índice vacío al
cerrar. Los hashes son `sha256` del fichero en disco (prefijo de 16), medidos el 2026-11-21.

## 1. Ficheros nuevos (3)

| Ruta | Bytes | sha256 (16) |
|---|---:|---|
| `lib/selection.mjs` | 6416 | `436ec0cc7aedd905` |
| `tests/pa-auth.test.mjs` | 9165 | `f2d34c118f3d484d` |
| `tests/selection-cas.test.mjs` | 10590 | `7f84405421e04248` |

## 2. Ficheros modificados del plugin (16)

| Ruta | Bytes | sha256 (16) | Cambio |
|---|---:|---|---|
| `index.js` | 9759 | `c5c1bea60d0bc1a6` | PA01: `hostGate` (`requestRejection`+`admit`), `inject` con `connection` |
| `lib/pa-api.mjs` | 22620 | `022f06d892c197e0` | Compuerta antes de resolver ruta, `POST /selection` con CAS, `projects`, `selection`, `auth`, `pa/1.1.0`, mapeo 401/403/409 |
| `lib/errors.mjs` | 1886 | `491b8822cdf2debb` | Códigos `unauthenticated`, `forbidden`, `authorization-unavailable`, `revision-conflict` |
| `lib/registry-schema.mjs` | 9618 | `6e9bafd0bbe5c345` | v2: DDL de `pa_selection`, índice, `REGISTRY_MIGRATIONS` |
| `lib/registry.mjs` | 16507 | `34631566ad356152` | `migrateRegistry` aditivo en `openRegistry`, `pa_selection` en tablas esperadas |
| `client.js` | 151181 | `cff8310a51f7a6af` | Selección real (pendiente → confirmación), refresco del snapshot, vaciado de fuentes al cambiar, `projects`/`sourcesTotal`, avisos ES/EN, textos corregidos (GAP-09 → CR-1, Conexión, Historial) |
| `package.json` | 1696 | `a9e4e062eec7905a` | `test` con `--test-concurrency=1` |
| `tools/hermetic.mjs` | 2245 | `bb1643e2fed1882c` | Lanza la suite con la misma concurrencia |
| `tools/benchmark.mjs` | 8866 | `3e4a141096b6f1b2` | `await` en `ingestFiles` y `search`; error del cuerpo no enmascarado; limpieza con reintentos |
| `tests/adapter.test.mjs` | 2808 | `4818619a32223452` | `inject` esperado |
| `tests/host-adapter.test.mjs` | 14501 | `9f3e3fe7e18de8e7` | +2 casos de compuerta (200 con cookie, fail closed sin `connection`) |
| `tests/pa-api.test.mjs` | 15586 | `f499f3c8022a996a` | +1 caso de `projects` en el snapshot |
| `tests/registry.test.mjs` | 8549 | `e99611ee8b8e2b5e` | +1 caso de migración v1→v2; versión desde la constante |
| `tests/client.test.mjs` | 44237 | `f0037feac0d7c8b6` | +4 casos CR-1 (hidratación, pendiente, conflicto, fuentes/proyectos) |
| `docs/PA-UI-0-API-CONTRACT.md` | 65156 | `e53ed5421b5eb347` | §5.1 nota de superficie viva, §6.2 contrato implementado, §7 códigos, §9.1, §15 registro ACP-01 |
| `docs/PROJECT-AWARE-DATA-CONTRACT.md` | 22385 | `cd265bfd56be3997` | §3 DDL de `pa_selection`, `user_version=2`, §8 registro de revisión |

## 3. Ficheros no tocados que se conservan

- Los 11 documentos `docs/LE-RAG-08..12*.md` siguen sin rastrear (ya lo estaban).
- Ningún almacén, log ni artefacto de `eval/` se añadió ni se borró.

## 4. Árbol del repositorio

| Medida | Antes del acto | Después |
|---|---|---|
| `git status --porcelain` | 1164 (25 `M` + 1139 `??`) | **1184** (41 `M` + 1144 `??`) |
| `M` en `lifecode-rag/` | 0 | **16** |
| `??` en `lifecode-rag/` | 11 | **14** (11 previos + 3 nuevos) |
| Índice | vacío | **vacío** |
| HEAD | `655f037` | `655f037` |

El delta es exactamente el del acto: **+16 `M` y +3 ficheros nuevos** dentro de `lifecode-rag/`, más los
documentos de este paquete en `_audit/` (no rastreado).

Fuera del plugin sólo se añadió una sección fechada a **`MEMORY.md`** (memoria durable del repositorio, ya
estaba `M` de antes): «ACP-01 — PA01 + CR-1 y despliegue del build nuevo (2026-11-21)». Sin ese apunte, el
siguiente que entre no sabría que el perfil ya no apunta al árbol de trabajo y que el registro está en v2.

## 5. Fuera del repositorio (perfil y almacén)

| Objeto | Antes | Después |
|---|---|---|
| `~/.dsh/profiles/desktop/package.json` | `4f61768b8fde…` | `02a6d18fd34e…` (link a `acp01-7f174851218a`) |
| `~/.dsh/profiles/desktop/pnpm-lock.yaml` | `24d9c82fbf89…` | `c5a36c24029f…` |
| Junction `node_modules/@local/lifecode-rag` | `655f03758fe1` | `acp01-7f174851218a` |
| `~/.dsh/lifecode-rag/profiles/desktop/registry.sqlite3` | v1, sha `80d64e0a749d…` | v2, sha `028252a31b7b…` (migración aditiva + 3 entradas de auditoría) |
| `scopes/prj_01M7RBSRD33…/rag.sqlite3` | `4dcf31c4cb70…` | **`4dcf31c4cb70…`** (sin cambios) |
| `scopes/prj_01M7TRDQYRAPJR03QTM3PP6PX2/rag.sqlite3` | `0788ffb4c59c…` | **`0788ffb4c59c…`** (sin cambios) |
| Instantánea instalada | `acp01-46d8d4a438e6` → `acp01-71ca6863ad63` → **`acp01-7f174851218a`** | 421 ficheros, `index.js` `c5c1bea60d0bc1a6`, `client.js` `cff8310a51f7a6af` |
| Respaldo | — | `~/.dsh/backups/acp01-2026-11-21T1842/` (9 ficheros + `MANIFEST.json`) |

## 6. Autorización pendiente

El commit y el push **no** están hechos ni autorizados. Para prepararlos:

1. Revisar `git status --porcelain -- lifecode-rag` (16 `M` + 3 nuevos) y confirmar que ese es el alcance.
2. `git add` **con rutas explícitas** (nunca `-A`): los 19 ficheros de las tablas §1 y §2.
3. Los documentos `_audit/LIFECODE-RAG-1.0.0-*.md` y `_audit/ACP-00-STATE-REPORT.md` se deciden aparte: citan
   rutas locales del equipo, así que es razonable dejarlos fuera del commit del plugin.
