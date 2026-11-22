# ACP-02 — Informe final

**Plugin:** `@local/lifecode-rag` 1.0.0 · PA `pa/1.2.0`
**Perfil:** `C:\Users\BYRON\.dsh\profiles\desktop` · fuente `C:/xampp/htdocs/dsh-plugins-store/lifecode-rag/acp01-576b8d836ad7`
**Fecha del acto:** 2026-11-22
**Estado final:** `READY_FOR_DAILY_USE` (con dos criterios no críticos en NO-PASS/BLOCKED, ver §4)

---

## 1. Qué se cerró en este acto

| Área | Antes (ACP-01) | Ahora |
|---|---|---|
| Invocación real de herramientas por el modelo | Inferida (registro + tests) | **Ejercitada** en sesión real: 5 llamadas con argumentos y resultados medidos |
| `RAG_CODES` vs códigos usados | 18 códigos lanzados sin catalogar (entre ellos de autorización) | Catálogo completo (60 códigos), mapa HTTP único y prueba que recorre el fuente |
| Historial en el panel | «No disponible» (verdadero) | `GET /history` con paginación, integridad y procedencia; 141 entradas en la UI |
| Panel, 9 áreas | 5 verificadas | 8 de 9 verificadas en vivo; DEMO pendiente de una comprobación manual de 30 s |
| Suite | 433 | **448 tests, 448 pass, 0 fail** |

## 2. Cambios de código

1. `lib/errors.mjs` (6.897 B, `d04fa385cddcb163`): `RAG_CODES` completo; `HTTP_STATUS` como único mapa de status para las dos APIs; `SECURITY_CODES` y `FAIL_CLOSED_CODES`; `RagError` conserva el código no catalogado en vez de degradarlo a `internal` y lo marca con `catalogued`.
2. `lib/pa-api.mjs` (25.367 B, `81e9d495e553d990`): `GET /history` (paginación por `cursor`, `total`, `integrity`, `nextCursor`); `PA_VERSION = 'pa/1.2.0'`.
3. `client.js` (157.062 B, `9af3c748c23da6be`): vista «Historial del proyecto» con total, integridad de cadena, cursor y tabla; i18n ES/EN.
4. `tests/error-codes.test.mjs` (8.583 B, `6ce0a35f70a0f416`): 8 casos, incluido el recorrido del fuente para impedir que vuelva a desincronizarse.
5. `tests/pa-history.test.mjs` (7.106 B, `a80307fd531b4a69`) y `tests/client.test.mjs` (46.244 B, `dcef271db7cb3b49`, 56 casos).
6. `docs/PA-UI-0-API-CONTRACT.md` (68.601 B, `a616db92c6fc4a46`): §6.11 `/history`, §16 ACP-02, nota de versión.

Sin cambios en el contrato público de las siete herramientas. `lib/**` sigue sin importar DSH, Cordis ni Electron (`npm run check` lo verifica).

## 3. Evidencia medida

- **Herramientas, invocadas por el modelo** (transcript `session-ecd9d513-…/session.v4.jsonl.zstd`, turno 1):
  `ingest{paths}` → `ingeridos: 1, omitidos: 0, errores: 0`; `list{limit:5}` → `total: 1`;
  `search{query:"reembolso",limit:3}` → 1 resultado, `rrf 0.06557`, 6 ms;
  `context{query:"reembolso",budgetTokens:400}` → 1 cita, 386 tokens;
  `get{ref:"src_8fd3518f8ae5b262"}` → 1 fragmento con el marcador.
- **Procedencia:** el `sha256` indexado (`049a0c1f4f3b8e1a5249fd10f43f0e7a`) coincide con el del fichero en disco.
- **Panel** (ventana del propietario, pid 5088): Búsqueda 8 resultados híbridos en 11,0119 ms con URI y ámbito; Contexto 1.928 tokens, truncado, 16 fragmentos, cita `[1]`; Fuentes 121 con paginación; Conexión `pa/1.2.0` modo `api`; Historial «Total: 141 · Cadena verificada (141 entradas)»; Operaciones declara 403; Diagnóstico muestra el ámbito real y su límite; Proyecto activo con revisión 3.
- **Suite:** `npm test` 448/448; `npm run check` OK; `npm run test:hermetic` OK (huella del almacén real idéntica antes y después).

## 4. Criterios no cerrados

1. **DEMO en vivo — NO-PASS (no crítico).** El modo DEMO sólo aparece si la API del panel no responde; forzarlo exige tumbar el servicio del host. Verificado por pruebas del cliente (56 casos), no en la ventana. Instrucción manual en el informe de aceptación.
2. **Limpieza de la sonda — CERRADO (PASS, ACP-02-CLEANUP).** `lifecode_rag_forget` sobre `src_8fd3518f8ae5b262` se ejecutó el 2026-11-22 con aprobación `allowed-once` del propietario; el proyecto `plugins-dhs` quedó con 0 fuentes y `LifeCode RAG` verificado intacto por hash. Detalle en `ACP-02-CLEANUP-REPORT.md`. El fichero `ACP02-INGEST-PROBE.md` sigue en disco (el `forget` retira la entrada del índice, no el documento).

## 5. Acciones manuales exactas (2 minutos)

**Borrar la sonda — ya hecho.** La fuente `src_8fd3518f8ae5b262` se eliminó el 2026-11-22 con aprobación
`allowed-once` en la sesión `58adcd06` (Modo estándar); `plugins-dhs` quedó con `total: 0`. Sólo queda el
fichero `ACP02-INGEST-PROBE.md` en disco, ya sin indexar, que puedes borrar cuando quieras.

**Ver DEMO.** Cerrar el panel, detener el host de DSH (o abrir el panel con el plugin desinstalado) y volver a abrirlo: debe mostrarse la banda de modo DEMO con datos sintéticos etiquetados y sin cifras del proyecto real.

## 6. Veredicto

`READY_FOR_DAILY_USE`. El uso diario es REAL: proyecto, fuentes, búsqueda, contexto, historial y compuerta de escritura están ejercitados sobre el almacén real. Los dos puntos abiertos no bloquean ese uso: uno es una comprobación de degradación y el otro una limpieza de 473 B que necesita una aprobación que no puedo dar yo.
