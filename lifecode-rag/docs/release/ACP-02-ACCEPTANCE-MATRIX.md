# ACP-02 — Matriz de aceptación

Cada fila declara **cómo** se comprobó. `PASS` exige evidencia medida en la instalación normal, no
inferencia desde registro ni desde pruebas unitarias.

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | `lifecode_rag_list` invocada por el modelo | PASS | transcript turno 1 paso 2: `{"limit":5}` → `total: 1` |
| 2 | `lifecode_rag_search` invocada por el modelo | PASS | paso 3: `{"query":"reembolso","limit":3}` → 1 resultado, `rrf 0.06557`, 6 ms |
| 3 | `lifecode_rag_context` invocada por el modelo | PASS | paso 4: `{"query":"reembolso","budgetTokens":400}` → 1 cita, 386 tokens |
| 4 | `lifecode_rag_get` invocada por el modelo | PASS | paso 5: `{"ref":"src_8fd3518f8ae5b262"}` → 1 fragmento con marcador |
| 5 | `lifecode_rag_ingest` con fuente sintética aislada | PASS | paso 1 → `ingeridos:1 errores:0`; auditoría del scope registro `seq 3` |
| 6 | Procedencia de la fuente ingerida | PASS | `sha256` indexado = `049a0c1f4f3b8e1a5249fd10f43f0e7a` = disco |
| 7 | `forget` no ejecutado contra fuentes del usuario | PASS | no se invocó sobre `LifeCode RAG`; sólo sobre la sonda |
| 8 | `reindex` no ejecutado | PASS | no invocado en el acto |
| 9 | Escrituras exigen aprobación del host | PASS | `approval/asked` seq 61 → `approval/decided: rejected` seq 62; herramienta devuelve error accionable |
| 10 | Panel · Proyecto (selección y revisión) | PASS | «Proyecto activo LifeCode RAG», revisión 3; `Seleccionar` para `plugins-dhs` |
| 11 | Panel · Fuentes y paginación | PASS | 121 fuentes, «Página 1 de 1» |
| 12 | Panel · Búsqueda | PASS | «reembolso» → 8 resultados, modo híbrido, 11,0119 ms, URI + ámbito |
| 13 | Panel · Contexto y citas | PASS | 1.928 tokens, truncado Sí, 16 fragmentos, cita `[1] audit.mjs` |
| 14 | Panel · Conexión | PASS | `pa/1.2.0`, modo `api`, ámbitos 1, servicio ok |
| 15 | Panel · Historial | PASS | «Total: 141 · Cadena verificada (141 entradas)», cursor «Cargar más» |
| 16 | Panel · Operaciones | PASS | declara 403 del panel y remite a las herramientas |
| 17 | Panel · Diagnóstico | PASS | ámbito `prj_01M7RBSRD33M26HGBEFW51WPP6` presente y verificado; límite declarado |
| 18 | Panel · DEMO | **NO-PASS** | no ejercitado en vivo: exige tumbar la API. Cubierto por 56 pruebas de cliente. Instrucción manual en el informe final §5 |
| 19 | `RAG_CODES` exhaustivo | PASS | `tests/error-codes.test.mjs` 8/8; recorre el fuente y falla ante un código sin catalogar |
| 20 | Errores de seguridad no degradados | PASS | `isSecurityCode` + mapa HTTP único; prueba «un código desconocido no pasa por seguridad» |
| 21 | `/history` con paginación, ámbito y procedencia | PASS | `pa/1.2.0`; 141 entradas con `seq/actor/tool/action/target/outcome/hash` |
| 22 | `/history` sin credencial | PASS | `401 unauthenticated` |
| 23 | Ruptura de contrato público de las 7 herramientas | PASS | ninguna firma alterada; `npm run check` OK |
| 24 | Núcleo independiente del host | PASS | `check.mjs`: sin dependencias `@deepseek-ai/*` |
| 25 | Suite completa | PASS | `npm test` 448/448, 0 fail |
| 26 | Hermeticidad | PASS | `npm run test:hermetic` OK; huella del almacén real idéntica |
| 27 | Instalación en perfil normal | PASS | `dsh.profile.bundles` + `link:` a `acp01-576b8d836ad7`; panel y herramientas responden |
| 28 | Datos del usuario intactos | PASS | 121 fuentes en `LifeCode RAG`; `quick_check=ok`; registro v2 sin migración nueva |
| 29 | Rollback disponible | PASS | respaldo `acp02-2026-11-22T0250` + build anterior `655f03758fe1` abre el registro |
| 30 | Git preservado | PASS | HEAD `655f037`, índice vacío, 1.196 entradas dirty intactas |
| 31 | Limpieza de la sonda sintética | PASS | `forget` con `allowed-once` (seq 172-175): «eliminada … (1 chunks)»; `list` → `total: 0`; `LifeCode RAG` intacto por hash |

**Resumen:** 29 PASS, 1 NO-PASS no crítico (DEMO), 0 BLOCKED.
Ningún criterio crítico de uso diario en REAL queda abierto.
