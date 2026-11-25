# LifeCode RAG R1.2 — Aceptación técnica final

**Fecha:** 2026-11-25 (America/Costa_Rica, UTC−06:00)
**Base:** LifeCode RAG 1.5.11 · commit `36148704e191d0689061b6b594135fe5e94d84bc`
**Línea:** `feature/project-memory-lifecycle` · worktree `<WORKTREE>`
**Contrato:** `pa/1.6.0` · registry v4
**Estado del árbol:** HEAD `b2d8faf0442d6e2793eb3e4421d9a5387170bc14`; commit R1.2 `67e7c8c…` + correcciones `b2d8faf…`; push y PR abiertos, sin publicación npm ni migración real.

## 1. Veredicto

**READY WITH CONDITIONS.**

La funcionalidad R1.2 está integrada y verificada en el núcleo y en un Host DSH aislado. F-02 quedó cerrado:
un movimiento confirmado conserva la obligación durable de retirar el acceso anterior y la recuperación la
reintenta sin tocar entradas ajenas. Quedan limitaciones concretas, declaradas en §8, que no invalidan la
aceptación técnica: **host y CLI no deben compartir simultáneamente el mismo perfil (M3)**; el ciclo de Host se hizo sobre un perfil sintético, no sobre el perfil real, y no se
publicó ni instaló nada.

## 2. F-02 — limpieza durable del acceso anterior

**Diseño.** La obligación no se guarda en un journal nuevo. Se representa como una operación
`kind='cleanup'` en `operations`, con `project_id`, `from_path_key`, `from_path`, `root_id` y `trust_key`
exactos, más la operación de movimiento que la originó. El rebind sigue siendo un hecho y la operación de
movimiento queda `committed`; la limpieza queda `started` hasta que se mide completa.

`runAccessCleanup` sólo borra una raíz cuyo `scope_kind='prj'`, `scope_id` y `path_key` coinciden con la
procedencia, y sólo retira la confianza de la ruta exacta que sigue `trusted` y conserva el mismo
`addedAt` (si se retiró y se volvió a crear, no es la misma concesión). Las entradas ausentes son
`already-absent`; una entrada que existe pero no es de ese proyecto/ruta queda intacta con `not-owned`. Un
fallo persistente conserva la operación abierta, audita `access.cleanup.retry` y se reintenta al arrancar.
La rama de recuperación que encuentra el rebind ya hecho usa la misma cola: si `revoke-old` vuelve a fallar,
el movimiento queda `committed` y la limpieza durable, nunca `failed`.

**Evidencia.** `tests/cleanup.test.mjs` pasa 6/6: fallo al borrar la raíz, fallo al retirar la confianza,
fallo persistente con reintento, entradas ya ausentes, operación sin detalle y **caída entre rebind y
revoke-old** con limpieza pendiente y rekey en la misma recuperación. El primer caso comprueba además que
la confianza preexistente del padre y la raíz de otro proyecto no se tocan. Las pruebas de
`tests/provisioning.test.mjs` y `tests/pa-lifecycle-api.test.mjs` cubren el movimiento que confirma con
limpieza pendiente y la compensación de una provisión fallida.

## 3. Movimiento sin duplicar fuentes

El Host aislado midió un defecto real que las pruebas de unidad no veían: al mover un workspace ya
indexado, el almacén conservaba la fuente con la ruta vieja y el sync de la ruta nueva la insertaba como
otra fuente. Se añadió el paso `rekey`: cambia el prefijo `uri` de las fuentes del mismo proyecto,
conserva `source_id`, chunks y vectores, y retira el `sync_state` del root viejo. Un fallo **no se
descarta**: se encola una operación durable `kind='rekey'` y la recuperación la reintenta antes del sync;
mientras está pendiente, `memory.rekey.pending` lo publica y el proyecto se excluye de
`activeSyncScopes`. El prefijo se compara con separador (`app` no arrastra `app-docs`) y una fuente ya
existente en la ruta nueva hace que se retire la vieja, sin duplicar.

Verificación en el Host: se provisionó `ws-fresh`, se sincronizó a 1 fuente y se movió a `ws-fresh-final`.
El almacén del proyecto `prj_01M88EGDFK1NNEJ5WWJ764MG7F` quedó con **una sola fila `sources`** y la URI
nueva. La regresión de `tests/provisioning.test.mjs` fija la conservación del `source_id`, el fallo de E/S
con obligación durable y que una fuente hermana (`app-docs`) no se toca.

## 4. Concurrencia real entre procesos

`tests/multiprocess-concurrency.test.mjs` usa workers Node independientes sobre el mismo registry SQLite
de laboratorio; no son mocks de concurrencia. Pasa 7/7:

1. dos procesos provisionan el mismo workspace y queda una identidad y un almacén;
2. dos procesos asocian el mismo `project_id` a workspaces distintos y sólo uno gana;
3. dos procesos mueven el mismo workspace y queda un rebind con revisión coherente;
4. una operación antigua pierde contra una revisión humana posterior;
5. dos procesos drenan la misma cola y ejecutan un solo trabajo;
6. un proceso muere durante la operación y el otro recupera el estado;
7. dos procesos revocan el mismo consentimiento y sólo hay una revocación efectiva.

La guarda `concurrent-provision` devuelve `revision-conflict` con `reason:'concurrent-provision'` y
`retryable:true` al segundo escritor. La recuperación de arranque puede adoptar la operación porque sabe
que el proceso anterior ya no existe. `tests/pa-lifecycle-api.test.mjs` H5 comprueba además que la
recuperación compensa la fila de seguimiento que creó la API (`tracking_created` en el journal) y que el
reintento posterior responde 200.

La recuperación no toca operaciones vivas: cada operación de ciclo de vida guarda `owner_pid` y
`recoverLifecycle` comprueba que el proceso no exista antes de adoptar o compensar. Una prueba
determinista deja una operación `move` con el PID actual y verifica que la recuperación la salta. En el
doble movimiento, el que pierde el rebind se cierra `failed` y responde `revision-conflict` con
`reason:'move-superseded'`; la prueba multiproceso exige además **cero** operaciones `started` y **cero**
intenciones `open` al final. Tres corridas consecutivas del fichero dieron 7/7. La revocación mide en
`remaining` tanto raíces como confianzas que cubren la ruta; una confianza preexistente del padre impide
`complete:true` (H1b).

## 5. Ciclo completo del Host aislado (tras D-26/R-1)

**Entorno.** Perfil sintético copiado en
`<LAB>`;
`DSH_HOME=<lab>/home`, `LIFECODE_RAG_ROOT=<lab>/home/lifecode-rag`, `DSH_PROFILE=desktop` y
`--user-data-dir=<lab>/electron`, con el plugin enlazado al worktree actual. No se usó
`<HOME>/.dsh/profiles/desktop` ni el almacén real.

**Ciclo medido.**

1. El Host arrancó y cargó el plugin actual; `GET /lifecode-rag/pa/` respondió
   `version: "pa/1.6.0"`, `service: "ok"`. El registro sintético quedó en `user_version = 4`.
2. Se creó `ws-release` con dos documentos y se provisionó por `PUT /tracking` con
   `intent:'provision'`: memoria `ready`, identidad `prj_01M89XY1X3VN8NQ7JVT9NH7MH4`, primera
   sincronización `done`, **2 fuentes/2 chunks**, sin duplicados.
3. Se movió a `ws-release-moved` con `POST /tracking/move`: misma identidad, 2 fuentes con la URI
   nueva, 2 chunks, **0 fuentes duplicadas**, `source_id` conservados y rekey completado.
4. Tras revocar el acceso, se movió de nuevo a `ws-release-after-revoke` con la corrección D-27: las
   dos fuentes se movieron a la ruta nueva sin duplicarse aunque ya no existiera la raíz vieja; el
   rekey no dependió de `fromRootId`.
5. Se desactivó y reactivó: el `project_id` no cambió, la memoria siguió `ready`, la reactivación
   encoló una pasada incremental y las fuentes siguieron siendo 2.
6. Se revocó el acceso total: `changed:true`, `complete:true`, `remaining:[]`; la raíz y la confianza
   propias desaparecieron y el panel dejó de ofrecer la revocación. Con una confianza de padre
   preexistente, la revocación de otro workspace devolvió `complete:false` y `remaining` con esa
   confianza, sin mentir sobre el acceso restante.
7. Se forzó un fallo de E/S durante el rekey de un move ya indexado: el movimiento quedó `committed`,
   el rekey pendiente visible, el proyecto fuera del sync y la fuente en la ruta vieja. Se reinició el
   Host: el rekey se completó, quedó **una sola fuente**, el sync se encoló con `reason:'recovery'` y
   el scheduler lo ejecutó; no se duplicaron fuentes ni chunks.
8. Se revisó el panel real por CDP y captura: 9 workspaces (6 seguidos, 3 sin seguimiento), filas con
   «Seguido»/«Memoria lista», acciones completas y sin recortes horizontales; el estado
   «Índice: la última pasada falló» de una fila de laboratorio antigua se mostró tal cual, sin
   convertirlo en éxito.
9. El Host se apagó de forma controlada (`taskkill /T /F`); no queda proceso de laboratorio ni puerto
   de la instancia.

**Hallazgo del Host y corrección.** El ciclo real encontró que un move ya `committed` con rekey
pendiente no volvía a encolar sync al completarse el rekey (la petición anterior había quedado
`scope-not-syncable`). Se añadió `enqueueSync(reason:'recovery')` en `runRekeyOperation`, con regresión
en la prueba de rekey; el escenario repetido en el Host terminó con una sola fuente y
`sync_requests.state:'done'`, `reason:'recovery'`.

No se abrió ni migró el almacén real.

## 6. Regresión, esquema y hermeticidad

- Suite completa: `node --test --test-concurrency=1` → **811 tests, 811 pass, 0 fail, 0 skipped**,
  74.601 s.
- Base original 1.5.11: **714/714**. Checkpoint previo: **769/769**. La diferencia neta son las pruebas
  nuevas de `cleanup`, rekey durable, liveness, `remaining` con confianzas, ruta vieja, multiproceso,
  ciclo de vida y API. La cobertura automatizada cubre los criterios de núcleo/API; las ramas de
  Host/UI y de cleanup `not-owned`/`recreated` se documentan como evidencia de laboratorio o quedan
  como cobertura no automatizada, no como pruebas que no existen.
- `node tools/check.mjs`: limpio; 7 herramientas, sin dependencias de `@deepseek-ai/*`, manifiesto y
  parche correctos, `exports["./client"]` resoluble y cliente con la API de slots vigente.
- `node tools/hermetic.mjs`: **811 pass**, 0 fail, y el mensaje `hermético: el almacén real no cambió
  (6 fichero(s))`.
- Migración v4 sobre una **copia** del registro real v3: `user_version` 3→4, 3 proyectos, 3 raíces,
  1 seguimiento, 98 auditorías, 0 duplicados, datos idénticos antes/después. El registro real no se abrió
  para esta prueba.

## 7. Integridad y Git

- HEAD del worktree: `b2d8faf` (base `3614870…`), rama
  `feature/project-memory-lifecycle`.
- `git status --porcelain=v1`: **38 entradas** (28 modificadas y 10 no versionadas) al medir el
  informe original; **43** al añadir `IMPLEMENTATION-R1.2-CONTINUATION.md` y
  `IMPLEMENTATION-R1.2-RELEASE-READINESS.md`. Se preservaron todas;
  no se hizo commit, reset, clean, stash, rebase, tag, push ni instalación.
- Documentos de arquitectura/producto del propietario, leídos sin escribir:
  - `ARCHITECTURE-PROJECT-MEMORY-LIFECYCLE.md` =
    `e5902139d19a749c0a3a8d45b54e9720a090b2fce0a566e574128a3f307a86f8`
  - `UX-PROYECTO-DE-TRABAJO-Y-PROYECTO-DE-CONOCIMIENTO.md` =
    `af3a7b8bb6ada853571ba27a5c4976fc7e1ac2a7d4635ee9b397567e8bc9b62c`
- Artefactos de la línea:
  - `docs/IMPLEMENTATION-R1.2-DECISIONS.md` (D-01…D-26) y este informe.
  - `lib/lifecycle.mjs`, `lib/provision-store.mjs`, `lib/registry-schema.mjs`, `lib/pa-api.mjs`,
    `client.js`.
  - `tests/cleanup.test.mjs`, `tests/multiprocess-concurrency.test.mjs`,
    `tests/provisioning.test.mjs`, `tests/pa-lifecycle-api.test.mjs`, `tests/sync-lifecycle.test.mjs`.
- Versión del paquete: `1.6.0`; contrato `pa/1.6.0`.

## 8. Riesgos y límites residuales

1. **Host sintético, no perfil real.** El ciclo se ejecutó sobre la copia de laboratorio y un
   `--user-data-dir` propio. No se probó el perfil real del propietario ni una instalación real; la
   aceptación técnica no equivale a instalación ni publicación.
2. **Rekey durable, con ventana de E/S visible.** Si el almacén del proyecto está bloqueado o ilegible
   justo después del rebind, la operación `rekey` queda `started`, el proyecto se excluye del sync y se
   reintenta al arrancar; el movimiento sigue `committed` y `memory.rekey.pending` lo muestra. No hay
   pérdida de conocimiento ni duplicación silenciosa, pero la ruta nueva no se indexa hasta que la
   obligación se complete. Se forzó un fallo de E/S en el ciclo de laboratorio; no se observó de forma espontánea.
3. **Ciclo de vida sin servidor real de producción.** La compuerta del Host se probó con el adaptador real
   en el laboratorio, pero no contra el servidor público de un despliegue. Las pruebas multiproceso usan
   SQLite y procesos Node reales, no una red DSH real.
4. **Sin publicación.** No se hizo `npm publish`, instalación en el perfil real, commit, tag ni push. La
   distribución queda fuera de esta aceptación.
5. **Datos reales.** El almacén real se protegió con la puerta hermética y una copia para la migración; no
   se modificó, migró ni abrió por la implementación.
6. **Host/UI validados sólo en sintético.** El ciclo actual se repitió tras D-26/R-1 en un perfil y
   almacén sintéticos, con el plugin actual; no se ejecutó sobre el perfil real ni sobre datos reales.
   La aceptación técnica sigue sin equivaler a instalación o publicación.

## 9. Diferencia entre aceptación técnica, instalación y publicación

- **Aceptación técnica:** el código de esta línea, con sus pruebas y el ciclo de laboratorio, cumple el
  alcance R1.2 y F-02 con la evidencia anterior.
- **Instalación:** montar `@designerbyron/lifecode-rag` 1.6.0 en un perfil DSH real, migrar su registro y
  operar con datos reales. No se hizo.
- **Publicación:** `npm publish` y distribución. No se hizo y no se autoriza por este documento.

## 10. Auditorías independientes

- `deleg_925ea3c9`: READY WITH CONDITIONS; encontró H1 (revocación que no medía una raíz preexistente).
- `deleg_d17b1cea`: re-auditoría de correcciones con árbol congelado.
- `deleg_e4a88096`: BLOCKED por H-01-R y H-01-R2; ambos corregidos con regresión.
- `deleg_ee805223`: READY WITH CONDITIONS; verificó H-01-R, H-01-R2, M-06 y D-07, y abrió F-01/F-02.
- **Auditoría final de hardening:** `deleg_3d3f4407`, dos subagentes de solo lectura. Veredicto **BLOCKED**
  por tres defectos reales —F-02 perdido en la recuperación, rekey sin obligación durable y recuperación
  que podía compensar un movimiento vivo— y hallazgos medios de revocación/renovación de confianza. Todos
  se corrigieron con D-18…D-21 y regresiones; la medición posterior es **788/788**.
- **Re-auditoría de cierre:** `deleg_2ba154c0`, dos subagentes de solo lectura sobre D-18…D-21. Veredicto
  **BLOCKED** por el perdedor tardío del doble move, la duplicación con cleanup pendiente, el rekey con
  rutas no canónicas, la reprovisión con cleanup, el cierre con pasos `failed`, la confianza reactivada y
  la carrera de `openRegistry`. Todos se corrigieron con D-22…D-24 y regresiones; la medición posterior es
  **798/798**.
- **Auditoría final de los siete bloqueantes:** `deleg_c0ea5bec`, solo lectura. Los siete pasaron; encontró
  un residual de la misma familia: perdedor caído hacia otro destino con raíz/confianza huérfanas. Corregido
  con D-25 y regresión (`tests/provisioning.test.mjs`, `tests/cleanup.test.mjs`); la medición posterior es
  **798/798**.
- **Auditoría del residual D-25:** `deleg_cd614f1a`, solo lectura. **READY WITH CONDITIONS**; verificó los
  seis puntos de D-25 y abrió una condición en la rama «no rebind» (un fallo de E/S abortaba la pasada) y
  una nota TOCTOU en `root`. Ambas corregidas: captura por rama, aislamiento del bucle y revalidación
  dentro de la transacción de `addRoot`. Medición posterior: **798/798**.
- **Auditoría final independiente (fuente congelada):** `deleg_18dbbe0d`, solo lectura. Veredicto
  **BLOCKED** por H-1 (rekey encadenado duplicaba fuentes), H-2 (recuperación con rebind no encolaba
  sync), H-3 (preflight dejaba la fila ON), H-4 (compensación retiraba confianza recreada) y H-5
  (fallo del INSERT de rekey dejaba el move atascado). Corregidos con D-26 y regresiones; la medición
  posterior es **798/798**.
- **Re-auditoría independiente de D-26:** `deleg_31d3f311`, solo lectura sobre la fuente congelada.
  **READY WITH CONDITIONS**: H-1…H-5 pasaron; abrió **R-1** —si la recuperación no podía persistir su
  obligación `rekey`, seguía y el sync duplicaba fuentes— y **O-1** —`trust_added_at` se perdía al
  cerrar el move. Ambos corregidos y con regresión; la medición posterior es **805/805**.
- **Re-auditoría final de R-1/O-1:** `deleg_673e0f9c`, solo lectura. **READY WITH CONDITIONS**; R-1 y
  O-1 pasan con reproducción real y control negativo, y no hay regresión de H-1…H-5, D-25, TOCTOU,
  cleanup, rekey durable ni liveness. Sus condiciones eran de expediente (C1: parche con los no
  versionados), documentación (C2: D-26, fecha y 798 histórico) y cobertura (C3: acceso viejo y una
  sola fuente). C1 se cerró generando `r12-audit-full.patch` con los 39 diffs (hash en el
  expediente de cierre); C2 está corregido y C3 se
  amplió en la regresión R-1. Suite final: **805/805**.
- **Hallazgo del ciclo Host/UI posterior:** un move ya `committed` con rekey pendiente no reencolaba
  sync al completarse el rekey (la petición anterior quedaba `scope-not-syncable`). Se corrigió en
  `runRekeyOperation` con `enqueueSync(reason:'recovery')` y regresión; el escenario repetido terminó
  con una sola fuente y `sync_requests.state:'done'`. La suite se repitió: **805/805**.
- **Auditoría independiente de seguridad (`deleg_77efb5ec`):** **BLOCKED** por **H1** (mover tras
  revocar con separador final no rekeyaba y duplicaba fuentes) y **M2** (la API y el scheduler resolvían
  perfiles distintos con `LIFECODE_RAG_DATA`/`LIFECODE_RAG_PROFILE`). Corregidos en D-28 con pruebas
  focalizadas; suite **811/811**, hermética 811. Reauditoría de las correcciones (`deleg_7bbf2fd9`):
  **READY**; H1 Unicode/M2/configuración de `dataRoot` verificados, worktree intacto (43 entradas).
- **Auditoría de seguridad completa (`deleg_77efb5ec`):** además de H1/M2, documentó H2 (sync en vuelo
  contra la raíz vieja), H3 (junction), H4 (compensación fallida), M1 (`/roots` con provisión abierta),
  B1 (mensaje falso con `changed:false`) y B2 (DDL antes de `application_id`). Corregidos en D-29 con
  sondas y prueba F-04; M3 queda documentado como ventana intencional de perfil único. La reauditoría
  del residuo H4 (`deleg_a864772f`) es **READY**. Suite 805/805.
- **Revisión independiente de release:** `deleg_5796782a` bloqueó el candidato por mover después de
  revocar (duplicaba fuentes) y la revisión documental encontró contratos/README/cola running. Se
  corrigieron con D-27 (rekey por prefijo sin root, `owner_pid`, workspace-missing, consent,
  `addedAt`, cola reciente, paquete sin informes internos, docs) y regresiones; suite **811/811**.

## 11. Reproducción mínima

```sh
cd <WORKTREE>/lifecode-rag
node --test --test-concurrency=1
node tools/check.mjs
node tools/hermetic.mjs
```

Las pruebas con estado usan `mkdtemp`; las de Host usan el perfil de laboratorio copiado, nunca
`<HOME>/.dsh`.
