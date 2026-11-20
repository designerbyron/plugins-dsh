# Aceptación — Project-Aware RAG (PA0 + PA1 + PA2 + PA3 + PA4 + PA5 + PA6)

**Estado:** PA0 documental cerrado; **PA1 ejecutado** (registro + migración); **PA2 ejecutado** (identidad de
sesión, `session_scope`, resolución y grants); **PA3 ejecutado** (las siete herramientas operan dentro del
contexto autorizado, con almacén por ámbito); **PA4 ejecutado** (estados de biblioteca, recuperación
verificable y reversible, revocación efectiva durante la operación, ledger de operaciones interrumpidas,
protección estructural de raíces, concurrencia con ocho ámbitos y cierre en falso ante resultados parciales);
**PA5 ejecutado** (motor de sincronización por ámbito con `sync_state`, ciclo de vida `present`/`missing`/
`unreadable` no destructivo, reconciliación de pasadas interrumpidas y programación periódica);
**PA6 ejecutado** (integración con las interfaces reales del host: contexto automático por `agent/pre-step`,
temporizador `ctx.timer.interval` y carga verificada del bundle con el mecanismo oficial).
Verificación en host (M6, 2026-11-17): plugin instalado y `fiberPhase: active`; dos herramientas invocadas en vivo. Con datos: 0 capacidades verificadas (no existe registro en el perfil real).
**Recuento (33 filas, nomenclatura canónica desde 2026-11-18):** 28 TESTED LOCAL — PAR-01…PAR-05, PAR-08…PAR-13, PAR-15…PAR-19 y PAR-22…PAR-33 —, 5 PARTIAL — PAR-06 y PAR-07 (perfil real instalado sin registro), PAR-14 (denegación de permisos no forzable en Windows), PAR-20 (hook probado en local, sin datos en host) y PAR-21 (programación del host ejercitada con timer inyectado) —, 0 DESIGNED, 0 BLOCKED, 0 NOT TESTED. Ver `eval/quality-hardening/ACCEPTANCE-MATRIX.md`: ninguna fila se declara VERIFIED HOST por haberse probado en un perfil temporal.
Una fila no pasa a PASS por tener contrato, SQL o pruebas propuestas: **0 PASS en host**.
Las limitaciones que dependen del host (cancelación cruzada de una consulta SQLite en curso, hook previo a la
respuesta, temporizador continuo) se declaran dentro de la fila y en `eval/pa4/PA4-REPORT.md` §24 y
`eval/pa5/PA5-REPORT.md` §16.
**Nomenclatura canónica (2026-11-18):** TESTED LOCAL · VERIFIED HOST · PARTIAL · DESIGNED · BLOCKED · NOT TESTED. «TESTED LOCAL» nunca implica VERIFIED HOST. Ver `eval/quality-hardening/ACCEPTANCE-MATRIX.md`.

**Dimensiones:** D = diseñado · I = implementado · P = probado · V = verificado en host.

### 1.1 Cómo leer esta matriz

Cada dimensión responde a una pregunta distinta y **no se sustituyen entre sí**:

| Dimensión | Pregunta | Quién la puede elevar |
|---|---|---|
| **D — Diseñado** | ¿Existe una especificación revisable del requisito? | PA0 (documentación) |
| **I — Implementado** | ¿Existe código real que lo ejecute? | Hito con orden propia (PA1+) |
| **P — Probado** | ¿Se ejecutó una prueba reproducible? | Hito que ejecute la prueba |
| **V — Verificado en host** | ¿Se comprobó en el escritorio real, no en un `ctx` simulado? | Solo ejecución en host |

**Disponibilidad del host** es una quinta pregunta, independiente: si la capacidad del host *existe*. No es
una dimensión de la fila; se declara en la evidencia cuando es la causa del bloqueo. Un requisito puede estar
bien diseñado (D=sí) y aun así no poder implementarse porque el host no ofrece el punto de extensión: eso es
`BLOQUEADO`, nunca `PASS`.

## 1. Criterios nuevos (PA0)

| ID | Criterio | D | I | P | V | Estado | Método de prueba previsto (hito) |
|---|---|---|---|---|---|---|---|
| PAR-01 | Un proyecto tiene ámbito propio y almacén propio | sí | sí | sí | no | TESTED LOCAL | `integration.test.mjs`: dos proyectos con almacenes separados; `ingest` en A es invisible para B y cada consulta abre sólo los ficheros de los ámbitos resueltos (PA3) |
| PAR-02 | La selección de proyecto es por sesión, no global | sí | sí | sí | no | TESTED LOCAL | `sessions.test.mjs`: dos sesiones con proyectos distintos, cada una resuelve el suyo; sin selección y sin `cwd` → `scope-unresolved` (PA2) |
| PAR-03 | Cambiar de proyecto en una sesión no afecta a otra | sí | sí | sí | no | TESTED LOCAL | `sessions.test.mjs`: cambiar A sube su `revision` y B conserva proyecto y revisión; dos conexiones simultáneas no se pisan (PA2) |
| PAR-04 | La selección sobrevive al reinicio del host | sí | sí | sí | no | TESTED LOCAL | `sessions.test.mjs`: cerrar y reabrir el registro conserva la fila y la resolución explícita. Reinicio real del escritorio: NO PROBADO (PA2) |
| PAR-05 | Clonar una sesión no hereda la selección | sí | sí | sí | no | TESTED LOCAL | `sessions.test.mjs`: una sesión sin fila no ve la selección de la origen; el clon empieza en `revision` 1 con su propia fila. Clon real del host: NO PROBADO (PA2) |
| PAR-06 | Un registro por perfil | sí | sí | sí | parcial | PARTIAL | `registry.test.mjs`: un `registry.sqlite3` por raíz de perfil; `profileRoot` deriva de `DSH_PROFILE`. En M6 el plugin quedó instalado y activo en el perfil `desktop` (`fiberPhase:active`, total 217 entradas) y la ruta resuelta es `C:\Users\<USER>\.dsh\lifecode-rag\rag.sqlite3`, pero **no se creó registro**: la orden §6.4 prohíbe inventar proyecto o raíz iniciales. Queda pendiente de datos humanos (`eval/m6/M6-REPORT.md` §6) |
| PAR-07 | Aislamiento entre perfiles | sí | sí | sí | parcial | PARTIAL | `registry.test.mjs` y `migrate.test.mjs`: dos raíces de perfil producen registros independientes; en host, M6 instaló sólo en `desktop` y `headless` quedó restaurado con `node_modules/@local` presente (`eval/pa6/evidence/host-headless-restored.txt`), por lo que el aislamiento entre perfiles no se probó con datos
| PAR-08 | Bibliotecas compartidas solo con grant directo | sí | sí | sí | no | TESTED LOCAL | `sessions.test.mjs`: sin grant la biblioteca no entra en los ámbitos; con grant entra como segundo ámbito (PA2) |
| PAR-09 | Anidamiento prohibido (biblioteca→biblioteca, proyecto→proyecto) | sí | sí | sí | no | TESTED LOCAL | `migrate.test.mjs`: dos ámbitos con rutas hermanas, no anidadas; el esquema no modela bibliotecas dentro de bibliotecas |
| PAR-10 | Revocación inmediata del grant | sí | sí | sí | no | TESTED LOCAL | `sessions.test.mjs`: revocar y resolver de nuevo excluye la biblioteca. `revocation.test.mjs` (PA4): revocar **durante** `search`, `context`, `get` e `ingest` falla en cerrado con `grant-revoked` y `details.reason='revoked-during-operation'`; lo ya confirmado no se deshace y una escritura confirmada queda auditada. La revocación se percibe en el siguiente punto de control, no en el acto (PA4 §17.2) |
| PAR-11 | Límite de 8 ámbitos con error explícito | sí | sí | sí | no | TESTED LOCAL | `sessions.test.mjs`: 7 bibliotecas concedidas → 8 ámbitos; la octava concesión falla con `scope-too-many` y no se trunca. Concesión con `grantedBy='model'` rechazada (PA2) |
| PAR-12 | Auditoría por ámbito, cadena propia | sí | sí | sí | no | TESTED LOCAL | `migrate.test.mjs`: alterar un evento en el ámbito A rompe sólo su cadena; B sigue verificando |
| PAR-13 | `missing` no borra fuentes, chunks, vectores ni auditoría | sí | sí | sí | no | TESTED LOCAL | `sync.test.mjs`: borrar el fichero de la raíz y sincronizar deja la fuente, sus chunks y su auditoría intactos; `sync_state` pasa a `missing` con `missing_since` (PA5) |
| PAR-14 | `unreadable` no se confunde con `missing` | sí | sí | sí | no | PARTIAL | `sync.test.mjs`: un recorrido incompleto (raíz ausente) **no** marca desapariciones y lo ya observado sigue `present`; `probeFile` distingue `source-missing`, `source-unreadable` y `path-unsupported`. **Límite:** Windows no permite forzar una denegación de lectura de forma hermética sin tocar ACL, así que la ruta `EACCES` real no se ejercita (PA5) |
| PAR-15 | Reconciliación al reaparecer (hash igual / cambiado) | sí | sí | sí | no | TESTED LOCAL | `sync.test.mjs`: reaparición con el mismo hash restaura `present` sin reindexar ni duplicar; con hash distinto se reindexa y queda una sola fuente; un renombrado se ve como `missing` + alta (PA5) |
| PAR-16 | Migración reversible desde el almacén único v0.2 | sí | sí | sí | no | TESTED LOCAL | `migrate.test.mjs`: copia + verificación (cuentas, hashes, FTS, auditoría), rollback ante FK rota, origen con SHA-256 intacto |
| PAR-17 | Integridad del registro (FK, `path_key` único, auditoría) | sí | sí | sí | no | TESTED LOCAL | `registry.test.mjs`: `path_key` duplicado, ámbito inexistente, borrado con raíces y cadena editada se rechazan; `registryIntegrity` limpio |
| PAR-18 | Contrato v0.1 intacto; v0.3 solo especificado | sí | sí | sí | no | TESTED LOCAL | Suite sin cambios de contrato: **236/236** en `lifecode-rag` tras PA6; `integration.test.mjs` comprueba nombres, parámetros y orden de las 7 herramientas y que no aceptan `project_id`/`scope_id`/`session_id`; `tools/check.mjs` sigue viendo 7 herramientas y cero dependencias de `@deepseek-ai/*` |
| PAR-19 | Errores de seguridad nunca se convierten en resultado vacío | sí | sí | sí | no | TESTED LOCAL | `sessions.test.mjs`: resolución sin selección, `cwd` fuera, ambigüedad, proyecto archivado, sesión terminada/invalidada y perfil ajeno fallan con código explícito y auditoría `denied`; ninguna devuelve lista vacía como éxito (PA2) |
| PAR-20 | Recuperación automática previa a la respuesta | sí | sí | sí | no | TESTED LOCAL | El bridge de hooks Claude-Code **no está operativo** en esta instalación (`fiberPhase:null`; en el perfil `headless` falla con `ERR_MODULE_NOT_FOUND`), así que el punto de extensión real es el evento en proceso `agent/pre-step`. `auto-context.test.mjs` (11 pruebas) y `host-adapter.test.mjs` (6) cubren: inyección sólo en el paso 1 y sólo con prompt humano, aislamiento por sesión, dedupe por turno, `AbortSignal` abortado y fallo del contexto sin romper el turno. `autoContext` nace **desactivado** (D-PA6-03). Turno real del modelo: M6 |
| PAR-21 | Temporizador permanente de sincronización en host | parcial | sí | sí | no | PARTIAL | `sync-scheduler.test.mjs`: `automation.enabled` respeta el apagado, una pasada sincroniza los tres ámbitos del perfil temporal y audita `sync.tick`, y el temporizador arranca y se detiene sin dejar asas. Tras PA6 el intervalo es `ctx.timer.interval(callback, delay)` del host, inyectado desde `index.js`, y `statusSnapshot().timer` distingue `host:ctx.timer.interval` de `node:setInterval`. **Límite:** el tick real dentro del escritorio se verifica en M6 |
| PAR-30 | El bundle se carga con el mecanismo oficial del host | sí | sí | sí | no | TESTED LOCAL | `dsh plugin --profile headless add link:…` añade la dependencia y el bundle (`dsh.profile.bundles`), `--dump-config` muestra `- id: lifecode-rag`, y el perfil arranca importando el plugin; después se retiró y el perfil quedó idéntico. Perfil `desktop`: M6 | (reconciliado 2026-11-18: `host-headless-restored.txt` muestra `node_modules/@local` presente tras retirar el plugin; el perfil quedó sin dependencias `lifecode` en `package.json`)
| PAR-31 | El contexto inyectado no filtra entre sesiones ni turnos | sí | sí | sí | no | TESTED LOCAL | `auto-context.test.mjs`: sesión sin resolución → `null`, dedupe dentro del turno, reinyección en otro turno, pasos posteriores → `null`; el mensaje lleva `source.kind='lifecode-rag'` y un UUID propio (D-PA6-02) |
| PAR-32 | `autoContext` desactivado por defecto | sí | sí | sí | no | TESTED LOCAL | `paths.test.mjs` + `auto-context.test.mjs`: `enabled:false` produce `null` sin abrir registro; `validateConfig` acota `maxChars`/`maxChunks`/`budgetTokens` y exige `autoContext.budgetTokens <= context.budgetTokens` |
| PAR-33 | Sin dependencias del harness ni secretos nuevos | sí | sí | sí | no | TESTED LOCAL | `tools/check.mjs` sale en verde: ninguna importación `@deepseek-ai/*`, `dependencies` vacío, manifiesto y parche correctos; el adaptador usa sólo `ctx` y la API web del host |
| PAR-22 | Estados de biblioteca explícitos: `present`, `missing`, `unreadable`, `corrupt`, `unavailable`, `recovering`, `recovered` | sí | sí | sí | no | TESTED LOCAL | `library-state.test.mjs`: cada estado se fuerza sobre un almacén real temporal; la ausencia nunca se lee como biblioteca vacía (`reason: 'library-missing'`), la corrupción conserva el fichero, un almacén de otro ámbito o perfil no se abre y `migrating` es reintentable (PA4) |
| PAR-23 | Recuperación de almacén verificable y reversible | sí | sí | sí | no | TESTED LOCAL | `recovery.test.mjs`: staging, copia de tablas autoritativas, vectores regenerados, FTS5 reconstruida y comprobada, auditoría verificada con su entrada, digest y recuentos iguales, `operations.state='committed'` con 4 pasos; rollback restaura la cuarentena y deja `.failed-<stamp>`; el original queda byte a byte (PA4) |
| PAR-24 | Revocación efectiva durante una operación | sí | sí | sí | no | TESTED LOCAL | `revocation.test.mjs`: revocación antes de abrir, durante `search` multi-ámbito, `context`, `get`, cancelación por `AbortSignal`, `session-expired`, invalidez administrativa y escritura ya confirmada. Garantía: no se entrega resultado de un ámbito revocado; latencia = siguiente punto de control. **Cancelación cruzada de una consulta SQLite en curso: PARCIAL (limitación del host/SQLite)** (PA4) |
| PAR-25 | Operaciones interrumpidas recuperables o marcadas inciertas | sí | sí | sí | no | TESTED LOCAL | `partial-results.test.mjs`: fila `started` → `operation-uncertain` con sus pasos; `committed` exige todos los pasos `done`; `effect_key` no se reutiliza entre pasos; reconciliar sólo cierra la fila y no reejecuta el efecto (PA4) |
| PAR-26 | Raíces ambiguas rechazadas estructuralmente | sí | sí | sí | no | TESTED LOCAL | `roots-structure.test.mjs`: duplicado y solape padre/hijo rechazados al registrar (`root-overlap` con `conflictsWith`), junction rechazada (`root-symlink`), traversal resuelto, cambio de destino detectado (`root-changed`), `registryIntegrity` informa solapes heredados. **Límite declarado:** Node no distingue junction de symlink y no identifica reparse points de proveedor (PA4) |
| PAR-27 | Concurrencia con los 8 ámbitos máximos | sí | sí | sí | no | TESTED LOCAL | `concurrency.test.mjs` (11 pruebas): 8 almacenes abiertos/leídos/cerrados sin asas, 2 sesiones aisladas, lectura con escritura sin confirmar, escrituras concurrentes, reindexación concurrente, bloqueo → `store-busy` reintentable, `migrating` reintentable, reapertura íntegra, resolución ≈8 ms y búsqueda 8 ámbitos ≈36 ms (umbrales de regresión) (PA4) |
| PAR-28 | Resultados parciales nunca presentados como completos | sí | sí | sí | no | TESTED LOCAL | `partial-results.test.mjs`: biblioteca ausente, corrupta o revocada → `search`/`context`/`get` fallan en cerrado; `list` del proyecto sigue sirviendo; el valor de `search` mantiene exactamente `{results, mode, elapsedMs}` sin `partial` ni `errors`. Propuesta v0.3 documentada, no ejecutada (PA4) |
| PAR-29 | Auditoría conserva integridad; retención no destructiva | sí | sí | sí | no | TESTED LOCAL | `retention.mjs` no expone ninguna función de borrado: sólo planifica candidatos y exporta cortes verificados (`sha256`) tras comprobar la cadena; `_audit/` intacto y la auditoría del registro no se compacta (PA4) |

## 2. Capacidades heredadas de v0.2 (no cuentan como logro de PA0)

| Capacidad | Estado heredado | Evidencia |
|---|---|---|
| Ingesta atómica por fichero | IMPLEMENTED / TESTED | `tests/atomicity.test.mjs`, M5 |
| Exclusión de Skill Center, almacén propio, symlink/hardlink | IMPLEMENTED / TESTED | `tests/policy.test.mjs`, M5 |
| Olvido definitivo con aprobación humana | IMPLEMENTED / TESTED | `tests/tools.test.mjs` |
| Reindexación FTS/vectores | IMPLEMENTED / TESTED | `tests/maintenance` (vía tools), M5 |
| Métricas agregadas sin texto | IMPLEMENTED / TESTED | `tests/metrics.test.mjs` |
| `runOnce` de sincronización | IMPLEMENTED / TESTED | `tests/automation.test.mjs` (v0.2) |
| Temporizador continuo en host | IMPLEMENTED / TESTED (local) | PA6: `ctx.timer.interval` inyectado en `sync-scheduler.mjs`; tick real del escritorio en M6 (PAR-21) |

Estas capacidades **no** cubren ámbito de proyecto, sesión, grants ni registro: son la base sobre la que PA1+
construye, no evidencia de Project-Aware.

## 3. Recuento

| Estado | Filas |
|---|---:|
| PASS nuevos | **0** |
| TESTED LOCAL | 29 |
| PARTIAL | 4 |
| DISEÑADO | 0 |
| BLOQUEADO | 0 |
| NO PROBADO | 0 |
| Total | 33 |

## 4. Reglas de ascenso de estado

- **D → I** exige código real en `lib/` y una prueba que lo ejercite; lo autoriza un hito con orden propia.
- **I → P** exige la prueba ejecutada con salida reproducible.
- **P → V** exige ejecución en el host real (perfil, panel, temporizador), no en un `ctx` simulado.
- Una fila `BLOQUEADO` no puede ascender por documentación; requiere que exista el hook del host.
- PA0 no cambia ninguna fila a PASS.
