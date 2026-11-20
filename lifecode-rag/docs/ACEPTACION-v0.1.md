# Aceptación — LifeCode RAG v0.1.0

**Fecha:** 2026-11-17  
**Base documental:** `plans/PLAN-2026-11-17-lifecode-rag-v2.md` (§21 AC1–AC15),
`plans/RESOLUTION-2026-11-17-lifecode-rag-v2.1.md` (AC16–AC19),
`plans/AMENDMENT-2026-11-17-lifecode-rag-v2.2-efficiency-first.md` (AC20–AC29).  
**Entorno medido:** Windows 11, Node 24.21.0 (Electron 44.7.0 en modo Node), SQLite 3.53.4.
**Alcance:** paquete `lifecode-rag/` en el repositorio. No incluye instalación en el perfil (M6).

Estados: **PASS** verificado con prueba o medición reproducible · **PARTIAL** implementado con una
limitación declarada · **BLOCKED** requiere una autorización que este mandato no concede · **NOT TESTED**
no ejecutado.

## Matriz

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| AC1 | 7 herramientas `lifecode_rag_*`, ninguna otra | PASS | `tests/tools.test.mjs` + `tools/check.mjs` (assert exacto de los 7 nombres) |
| AC2 | Sin dependencias ni imports `@deepseek-ai/*` | PASS | `package.json` sin deps; `tools/check.mjs` escanea imports y manifiesto |
| AC3 | Almacén sólo en `$DSH_HOME/lifecode-rag` o `LIFECODE_RAG_ROOT`; Skill Center no se toca | PASS | `tests/paths.test.mjs` (precedencia, raíz en blanco fail-closed); `tests/policy.test.mjs` (segmento protegido, junction, hardlink); `tools/hermetic.mjs` |
| AC4 | `node --test` verde; hermético demuestra que el almacén real no cambia | PASS | `node --test` → **66/66**; `node tools/hermetic.mjs` → verde |
| AC5 | Round-trip real ingesta → búsqueda → contexto con citas | PASS | `tests/tools.test.mjs` (ingesta → búsqueda → contexto → `get` con citas); CLI `doctor`, `audit export` y `audit verify` sobre almacén temporal |
| AC6 | `forget` sin aprobación falla; con `allowed-once` borra y audita; `audit verify` pasa | PASS | `tests/tools.test.mjs`; `tests/audit-export.test.mjs`; CLI `audit verify` |
| AC7 | Una prueba por fila de §17 | PARTIAL | Cubiertas: aprobación ausente/denegada (`approval-unavailable`, `path-not-allowed`), `store-not-initialized`, versión no soportada, `path-escape`, `hardlink-refused`, `path-denied`, binario/vacío/límite, `store-busy` por `busy_timeout`, corrupción por app-id/versión. **No implementadas en v0.1.0:** `stale-approval`, `migration-failed`, `store-inconsistent` como código propio, `embedding-unavailable`, `degraded` (no hay proveedor remoto ni migraciones todavía) → no se declaran cumplidas |
| AC8 | FTS íntegra tras ingesta, reemplazo, forget, reindex y migración | PASS (migración n/a) | `tests/schema.test.mjs` (disparadores, huérfana detectada y reparada), `tests/atomicity.test.mjs`; `integrity-check` en `doctor` |
| AC9 | Fallo inyectado en el commit deja la versión anterior completa | PASS | `tests/atomicity.test.mjs` (trigger `RAISE(ABORT)`; fuente, chunks, FTS y `index_revision` intactos) |
| AC10 | Editar/borrar/truncar auditoría se detecta; regenerar no duplica | PASS | `tests/audit-export.test.mjs` (4 casos) + `verifyAuditChain` |
| AC11 | Junction, symlink y hardlink al Skill Center se rechazan; `allowedRoots` no la levanta | PASS | `tests/policy.test.mjs` (junction real de Windows, hardlink, raíz extra protegida) |
| AC12 | `install_bundle` instala y activa; parche válido | BLOCKED | No autorizado por el mandato (M6). Procedimiento en `docs/INSTALACION-M6.md` |
| AC13 | `doctor` diagnostica runtime, raíz, esquema, FTS, auditoría, proveedor, rutas; exit correcto | PASS | `tests/doctor.test.mjs` (3 casos) + CLI en almacén temporal (`warn` sin exportación, `ok` con ella, `fail` con JSONL manipulado) |
| AC14 | Documentación sin rutas absolutas de máquina; rutas desde env/`import.meta.url` | PASS | `lib/paths.mjs`, `tools/*.mjs` derivan la raíz de `LIFECODE_RAG_ROOT`/`DSH_HOME`/`os.homedir()`; auditoría de docs y código sin prefijos de ruta de esta máquina (2026-11-17, sin resultados) |
| AC15 | Instalación viva verificada en `desktop` | BLOCKED | Requiere autorización específica (M6) |
| AC16 | `source_tags` normalizada; any/all; límites; cambio de tags no re-trocea | PASS | `tests/search.test.mjs` (normalización, `invalid-tag`, filtros any/all, tags sin subir `index_revision`) |
| AC17 | `reindex fts` global y atómico; `vectors` por fuente; orden en `all` | PARTIAL | FTS global + `integrity-check` + auditoría en una transacción (`tests/tools.test.mjs`); vectores por fuente con corte por `signal`; invariante de cobertura implementada (`vector-index-incomplete`) pero **sin prueba unitaria dedicada**; purga de modelo ajeno no probada |
| AC18 | Una prueba por fila de la tabla de caídas; rollback revierte auditoría; regeneración no duplica; verify detecta truncación | PARTIAL | Export/verify/truncación/duplicado cubiertos; `ROLLBACK` revierte auditoría cubierto por transacción; no hay prueba por cada fila de la tabla de caídas |
| AC19 | Hardlink → `hardlink-refused`; junction/symlink → `path-escape` | PASS | `tests/policy.test.mjs` |
| AC20 | Presupuesto respetado; distingue estimación de tokens reales; cuenta citas/envolturas | PARTIAL | `tests/efficiency.test.mjs` (sin corte a mitad, ≤2000); los tokens son `ceil(chars/4)`, no el tokenizador real → estimación declarada, no conteo |
| AC21 | Filtros y límites antes de materializar; deduplicación no elimina evidencia distinta | PASS | `lib/search.mjs` (`filterSql`, `cap` antes de RRF); fusión por `chunk_key` |
| AC22 | Las 7 tienen límites; `search` no devuelve documentos completos; `get` lectura paginada | PARTIAL | `search` devuelve `snippet`, no texto completo; `list` pagina con `offset`; `get` aplica `limit` (50 por defecto, 200 máximo) pero **no** `offset` ni `includeText` |
| AC23 | Hashes, filtros, BM25, RRF, MMR, dedupe y citas no invocan modelo ni red | PASS | `tools/check.mjs` falla si aparece `fetch(` o `node:http|https|net|dns`; ningún módulo los usa |
| AC24 | Ingesta idempotente no recalcula; cambios relevantes invalidan | PASS | `tests/efficiency.test.mjs` (skip con `index_revision` intacta y auditoría `skipped`) |
| AC25 | Egress por llamada intacto: aprobado, denegado, no disponible | NOT TESTED | No existe proveedor remoto en v0.1.0; el camino de egress no está implementado ni simulado |
| AC26 | `bench` compara baseline y optimizado con corpus/config idénticos; procedencia de tokens | PARTIAL | `tools/benchmark.mjs` mide FTS vs híbrido sobre el mismo corpus; tokens estimados, procedencia declarada en `docs/BENCHMARK-2026-11-17.md` |
| AC27 | Recall@5, MRR@10, calidad y citas; sin regresión | PARTIAL | Recall@5 y MRR@5 publicados; MRR@10 no medido; calidad de respuesta final no medida (no hay llamada al modelo) |
| AC28 | Ahorro neto con llamadas, herramientas, tokens y latencia | PARTIAL | Latencia y tokens de contexto medidos; no se contabilizan llamadas al modelo ni coste por token |
| AC29 | Métricas sin contenido completo, prompts ni credenciales | PASS | `benchmark.mjs` sólo agrega; no persiste documentos ni prompts |

## Resumen

- **PASS:** AC1–AC6, AC8–AC11, AC13, AC14, AC16, AC19, AC21, AC23, AC24, AC29 (18 criterios).
- **PARTIAL:** AC7, AC17, AC18, AC20, AC22, AC26, AC27, AC28 (8).
- **BLOCKED por autorización:** AC12, AC15 (2).
- **NOT TESTED:** AC25 (1).

Conciliación: 18 + 8 + 2 + 1 = **29 criterios** (AC1–AC29). La cifra «22» que aparecía antes en esta
misma línea no cuadraba con la lista ni con la matriz; se corrigió en la reconciliación documental del
2026-11-17 sin cambiar ningún estado.

Ningún criterio se declara PASS por ausencia de error visible: cada PASS apunta a una prueba concreta o a
una medición reproducible en este repositorio.

## Desviaciones del contrato de herramientas (§16 de v2)

v0.1.0 implementa el **subconjunto mínimo** de cada herramienta. Son omisiones declaradas, no un contrato
cumplido:

| Herramienta | v2 §16 | v0.1.0 |
|---|---|---|
| `ingest` | `paths[]` \| `text`, `title`, `mode` | `paths[]` (fichero o directorio), `collection`, `tags[]`; sin `text` ni `mode` |
| `search` | `collections[]`, `minScore`, `mode` | `collection`, `tags[]`, `tagMode`, `limit`; sin `minScore` ni `mode` |
| `context` | `collections[]`, `format` | `budgetTokens`, `maxChunks`; sin `format` |
| `get` | `sourceId` \| `chunkKey`, `includeText`, `limit`, `offset` | `ref` (sourceId o uri), `limit`; sin `offset` ni `includeText` |
| `list` | `kind`, `collection`, `limit`, `offset` | `collection`, `tag`, `limit`, `offset`; sin `kind` |
| `forget` | `sourceIds[]`, `collection`, `all`, `confirm` | una fuente por `sourceId`/`uri` |
| `reindex` | `scope`, `embeddings`, `collection`, `sourceIds[]` | `operation: fts\|vectors\|all` (alineado con v2.1 §3, que sustituye el parámetro de v2) |

Ampliar los argumentos es trabajo de M7 o de una versión siguiente; no cambia la seguridad ni los
invariantes ya verificados.

## Cómo reproducir

```sh
cd lifecode-rag
node --test              # 66/66
node tools/check.mjs     # estructura, dependencias, red
node tools/hermetic.mjs  # suite + huella del almacén real
node tools/benchmark.mjs # tabla del benchmark
node bin/lifecode-rag.mjs doctor
```
