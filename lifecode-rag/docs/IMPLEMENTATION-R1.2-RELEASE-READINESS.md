# LifeCode RAG 1.6.0 — Release readiness R1.2

**Fecha:** 2026-11-25 (America/Costa_Rica, UTC−06:00)
**Estado:** push y PR abiertos; HEAD `b2d8faf0442d6e2793eb3e4421d9a5387170bc14`; **sin tag, publicación, instalación ni despliegue**.
**Worktree:** `<WORKTREE>`
**Rama:** `feature/project-memory-lifecycle` · **HEAD:** `b2d8faf0442d6e2793eb3e4421d9a5387170bc14`
**Base:** LifeCode RAG 1.5.11 · **Contrato:** `pa/1.6.0` · **Registry:** v4
**Commits:** `67e7c8cbb0c96069f305f7514740ecd910e04e6c` (43 archivos) + `b2d8faf0442d6e2793eb3e4421d9a5387170bc14` (20 archivos)

> Este informe no declara verificaciones que no se hayan ejecutado. Las secciones marcadas
> **Auditorías completadas**; el candidato está empujado y con PR abierto; sin publicación npm.

## 1. Estado inicial y hashes

- Worktree antes de la integración: 43 entradas (31 modificadas y 12 no versionadas).
- Commits: `67e7c8cbb0c96069f305f7514740ecd910e04e6c` (43 archivos) + `b2d8faf0442d6e2793eb3e4421d9a5387170bc14` (20 archivos).
- Release `<RELEASE>`: rama
  `release/lifecode-rag-1.5.11`, HEAD `3614870`, árbol limpio.
- Documentos:
  - `IMPLEMENTATION-R1.2-DECISIONS.md`: `0033120050e763b10fd34ede1baa23a8458c9e124d1b6e222a7379993e726531`
  - `IMPLEMENTATION-R1.2-FINAL-ACCEPTANCE.md`: `95ad7b0f89abe4e440e6d99c4c87de863587815c598cc6a12dc4479b2cdfdeeb`
  - `IMPLEMENTATION-R1.2-CONTINUATION.md`: `88ee4f22fdd7841935ea7692ec3313fe433f163535bcb9041ead881ff80426d6`
- Freeze de referencia: `r12-freeze-2026-11-25-final3`, manifiesto 483/483 OK.
- Parche completo inicial: `r12-audit-full.patch`, sha256
  `d497f52c567bfed6d8b4aa4d0387e84c80240eda85a65f1c8fc77b54111fbbfd`; incluye los archivos
  no versionados.
- Diferencias posteriores al freeze `final3`: código de producción (`rekey` tras revocar, `owner_pid` de
  rekey/cleanup, workspace-missing, consent tras compensar, `addedAt`, cola running) además de pruebas y
  documentación. El freeze no representa el worktree actual; el parche final se regenera al cierre.

## 2. Revisión completa del diff

Revisión independiente de código (`deleg_5796782a`, solo lectura): **BLOCKED** sobre el candidato
congelado por **H-1** (mover después de revocar duplicaba fuentes); el resto de hallazgos H-3…H-10
se corrigieron. El delta de Host/UI de H-2 ya estaba en el worktree y no en el parche congelado.

Revisión independiente de documentación/contratos/pruebas: encontró el parche congelado obsoleto,
contradicciones de cierre, `user_version=3` en el SQL normativo, README con 1.5.8/697/54, razones
`cleanup-pending`/`rekey-pending` sin documentar, cola `running` reciente no reclamada al arrancar,
mensajes de panel para revocación idempotente/archivado y recuentos internos. Todo lo anterior se
corrigió o se documentó como cobertura; el parche final se regeneró.

Alcance revisado: los 43 archivos actuales (no sólo los principales); D-25, D-26, R-1/O-1; núcleo
host-agnostic; migraciones aditivas; compatibilidad 1.5.0; manifiesto/exports; ausencia de secretos y
rutas personales en el paquete. `git diff --check`: limpio.

## 3. Archivos incluidos y excluidos

### Incluidos en la integración (43)

**Funcionales (15)**

- `lib/lifecycle.mjs` *(nuevo)*
- `lib/provision-store.mjs` *(nuevo)*
- `lib/registry-schema.mjs`
- `lib/registry.mjs`
- `lib/tracking.mjs`
- `lib/tracking-store.mjs`
- `lib/trusted-roots.mjs`
- `lib/sync.mjs`
- `lib/sync-scheduler.mjs`
- `lib/pa-api.mjs`
- `lib/errors.mjs`
- `lib/config-resolve.mjs`
- `lib/profile.mjs`
- `index.js`
- `client.js`

**Pruebas (18)**

- `tests/cleanup.test.mjs` *(nuevo)*
- `tests/multiprocess-concurrency.test.mjs` *(nuevo)*
- `tests/provisioning.test.mjs` *(nuevo)*
- `tests/pa-lifecycle-api.test.mjs` *(nuevo)*
- `tests/sync-lifecycle.test.mjs` *(nuevo)*
- `tests/helpers/concurrency-worker.mjs` *(nuevo)*
- `tests/bootstrap.test.mjs`
- `tests/client.test.mjs`
- `tests/pa-admin.test.mjs`
- `tests/pa-tracking.test.mjs`
- `tests/pa-workspaces.test.mjs`
- `tests/panel-coverage.test.mjs`
- `tests/panel-selection-retry.test.mjs`
- `tests/panel-states.test.mjs`
- `tests/panel-tracking-layout.test.mjs`
- `tests/tracking-migration.test.mjs`
- `tests/tracking.test.mjs`
- `tests/profile-identity.test.mjs`

**Documentación y contratos (10)**

- `README.md`
- `package.json`
- `docs/PA-UI-0-API-CONTRACT.md`
- `docs/PROJECT-AWARE-DATA-CONTRACT.md`
- `docs/PROJECT-AWARE-ERROR-CONTRACT.md`
- `docs/PROJECT-AWARE-SESSION-CONTRACT.md`
- `docs/IMPLEMENTATION-R1.2-DECISIONS.md` *(nuevo)*
- `docs/IMPLEMENTATION-R1.2-FINAL-ACCEPTANCE.md` *(nuevo)*
- `docs/IMPLEMENTATION-R1.2-CONTINUATION.md` *(nuevo)*
- `docs/IMPLEMENTATION-R1.2-RELEASE-READINESS.md` *(este informe)*

> La lista exacta se fija en §13; los recuentos por categoría se ajustan allí si la revisión
> independiente excluye algún archivo.

### Excluidos

- `cache/scratch/**` (freeze, parches, cookies, laboratorio, capturas y sondas).
- Copias de laboratorio `<LAB>-*`, `ws-*` y almacenes sintéticos.
- Cualquier archivo del perfil real `<HOME>/.dsh` y del release 1.5.11.
- Artefactos de auditoría y logs; no se incorporan al paquete ni al commit.

## 4. Hallazgos y correcciones

- **R-1 / O-1** corregidos: fallo de persistencia del rekey no cierra ni deja indexar; `trust_added_at`
  se conserva al cerrar el move.
- **H-1…H-5** corregidos: rekey encadenado, sync de recuperación, preflight que restauraba la fila,
  confianza recreada y fallo del INSERT de rekey.
- **Hallazgo Host/UI:** un move ya `committed` con rekey pendiente no reencolaba sync al completar el
  rekey; corregido en `runRekeyOperation` con `enqueueSync(reason:'recovery')` y regresión. El
  escenario real terminó con una sola fuente y `sync_requests.state:'done'`.
- No se incorporó ningún cambio ajeno a R1.2.

## 5. Auditoría independiente

Auditoría independiente de seguridad (`deleg_77efb5ec`) **BLOCKED** inicialmente por H1/H2/H3/H4/M1/M2/B1/B2; corregidos en D-28/D-29 y reauditados: `deleg_7bbf2fd9` (H1/M2) **READY**, `deleg_5b443c45` (H2/H3/M1/B1/B2 y H4 inicial) **BLOCKED** por H4 residual, y `deleg_a864772f` (H4 sin `project_id`) **READY**. Revisión de código/documentación: `deleg_5796782a`, H-1/H-8 corregidos. Host/UI revalidado tras H-1/D-27 (mover tras revocar, 2 fuentes sin duplicar).

## 6. Host/UI ejecutados tras D-26/R-1

Laboratorio sintético `<LAB>`, con `DSH_HOME`, `LIFECODE_RAG_ROOT`, `DSH_PROFILE=desktop`,
`--user-data-dir` propios y el plugin actual enlazado por junction. No se usó el perfil real ni el
almacén real.

| Comprobación | Resultado |
|---|---|
| Arranque real del Host y carga del bundle | OK |
| `pa/1.6.0` | `version:"pa/1.6.0"`, `service:"ok"` |
| Registry sintético v4 | `user_version=4` |
| Provisión de workspace nuevo | `ws-release`, memoria `ready`, identidad propia |
| Primera sincronización | 2 fuentes, 2 chunks, sin duplicados |
| Movimiento de workspace indexado | misma identidad, 2 fuentes con URI nueva, 0 duplicadas |
| Mover después de revocar (D-27) | 2 fuentes movidas a la ruta nueva sin duplicar; no dependió de `fromRootId` |
| Rekey | `source_id` conservado; 2 fuentes/2 chunks |
| Fuentes hermanas | no modificadas (`sub/note.md` y fuentes del proyecto) |
| Cleanup y procedencia | sin cleanup pendiente tras move/revoke; revocación total `complete:true` |
| Desactivación/reactivación | mismo `project_id`, memoria `ready`, reactivación encolada |
| Revocación total | `changed:true`, `complete:true`, `remaining:[]` |
| Revocación parcial | `complete:false`, `remaining` con confianza preexistente; no se anunció revocación total |
| Rekey pendiente | visible; proyecto fuera del sync; fuente en ruta vieja |
| Reinicio real | rekey completado; una sola fuente; sync `reason:'recovery'` y `done`; sin duplicados |
| Scheduler | no duplicó trabajos; petición coalescente |
| Panel real (CDP + captura) | 9 workspaces, 6 seguidos, 3 sin seguimiento; filas y acciones completas; sin recortes horizontales |
| Apagado | `taskkill /T /F`; sin proceso ni puerto de laboratorio |

**Escenarios de error no repetidos en Host:** cleanup pendiente con E/S y confianza preexistente se
cubren en pruebas de núcleo/API; la confianza preexistente sí se probó en Host mediante una confianza
de padre (revocación parcial). No se declara más de lo medido.

## 7. Suite completa

```text
node --test --test-concurrency=1
811 tests, 811 pass, 0 fail, 0 skipped
74.601 s
```

Base 1.5.11: 714/714. La diferencia son las pruebas nuevas de ciclo de vida, cleanup/rekey,
multiproceso, API y panel.

## 8. Hermeticidad

```text
node tools/check.mjs   → limpio: 7 herramientas, manifiesto/exports correctos
node tools/hermetic.mjs → 811 pass, 0 fail
                          ✓ hermético: el almacén real no cambió (6 fichero(s))
```

Los 6 ficheros del gate son 4 datos (`config.json`, `registry.sqlite3`, dos `rag.sqlite3`) más los
sidecars `-shm` y `-wal`; no se abrió el almacén real para escritura.

## 9. Seguridad e integridad

Auditoría independiente de seguridad (`deleg_77efb5ec`): **BLOCKED** por H1, H2, H3, H4, M1, M2, B1 y B2; H1/M2 se reauditaron en `deleg_7bbf2fd9` (**READY**), H2/H3/M1/B1/B2 en `deleg_5b443c45`, y el residuo H4 sin `project_id` en `deleg_a864772f` (**READY**). Comprobaciones propias:

- Sin coincidencias de `token`, `api_key`, `secret`, `password`, `bearer` o clave privada en el diff
  funcional ni en los archivos nuevos.
- Sin rutas personales de laboratorio en `lib/`, `tests/`, `index.js`, `client.js` o `package.json`;
  `npm pack --dry-run` produce **80 archivos** y no incluye informes internos.
- `git diff --check`: limpio.
- El release 1.5.11 y el almacén real no se modificaron; hermética 810 con 6 ficheros intactos.
- H1 (rekey Unicode/barra final) y M2 (`LIFECODE_RAG_DATA`/perfil) verificados con sondas en `mkdtemp`;
  la API, el scheduler y las herramientas comparten `dataRoot`/`profileKey`.

## 10. Parche actualizado

**Integración:** `r12-audit-full-final.patch`, sha256 `f68fbc7706a7adfb15bcb4f8c4cc08430a0f9e1180f808771629c3157195f722`, generado tras la última medición
con los 43 archivos del commit. Este parche corresponde al árbol comprometido; las actualizaciones
posteriores de este informe y del punto de continuación no forman parte del commit.

## 11. Mensaje de commit propuesto

```text
feat(lifecode-rag): R1.2 memoria por proyecto y recuperación durable (pa/1.6.0)

- registry v4, provisión, movimiento, revocación y cleanup/rekey durables
- recuperación de operaciones, liveness y concurrencia multiproceso
- API pa/1.6.0, panel de seguimiento y contratos
- pruebas, migración v4 y aceptación técnica R1.2
```

## 12. Descripción del PR propuesta

**Título:** LifeCode RAG 1.6.0 — R1.2 project memory lifecycle

**Resumen:** implementa el ciclo de memoria por proyecto de trabajo sobre la base 1.5.11:
provisión con consentimiento de ruta exacta, movimiento sin duplicar fuentes, revocación demostrable,
cleanup/rekey durables, recuperación al arranque, concurrencia multiproceso y panel de seguimiento.
Contrato `pa/1.6.0` aditivo, registry v4 aditivo, cliente compatible con 1.5.0.

**Verificación:** 811/811, `check` limpio, hermético 811 con almacén real intacto (6 ficheros),
migración v4 sobre copia, Host/UI sintético con dos ciclos de reinicio y rekey pendiente.

**Riesgos:** instalación/publicación fuera de alcance; Host/UI probado sólo en laboratorio sintético;
rekey durable puede dejar una ventana visible hasta completar la obligación.

## 13. Archivos exactos para staging futuro

**43 archivos**, uno por uno y nunca `git add -A`:

**Funcionales (15)**
```
lifecode-rag/lib/lifecycle.mjs
lifecode-rag/lib/provision-store.mjs
lifecode-rag/lib/registry-schema.mjs
lifecode-rag/lib/registry.mjs
lifecode-rag/lib/tracking.mjs
lifecode-rag/lib/tracking-store.mjs
lifecode-rag/lib/trusted-roots.mjs
lifecode-rag/lib/sync.mjs
lifecode-rag/lib/sync-scheduler.mjs
lifecode-rag/lib/pa-api.mjs
lifecode-rag/lib/errors.mjs
lifecode-rag/lib/config-resolve.mjs
lifecode-rag/lib/profile.mjs
lifecode-rag/index.js
lifecode-rag/client.js
```

**Pruebas (18)**
```
lifecode-rag/tests/cleanup.test.mjs
lifecode-rag/tests/multiprocess-concurrency.test.mjs
lifecode-rag/tests/provisioning.test.mjs
lifecode-rag/tests/pa-lifecycle-api.test.mjs
lifecode-rag/tests/sync-lifecycle.test.mjs
lifecode-rag/tests/helpers/concurrency-worker.mjs
lifecode-rag/tests/bootstrap.test.mjs
lifecode-rag/tests/client.test.mjs
lifecode-rag/tests/pa-admin.test.mjs
lifecode-rag/tests/pa-tracking.test.mjs
lifecode-rag/tests/pa-workspaces.test.mjs
lifecode-rag/tests/panel-coverage.test.mjs
lifecode-rag/tests/panel-selection-retry.test.mjs
lifecode-rag/tests/panel-states.test.mjs
lifecode-rag/tests/panel-tracking-layout.test.mjs
lifecode-rag/tests/tracking-migration.test.mjs
lifecode-rag/tests/tracking.test.mjs
lifecode-rag/tests/profile-identity.test.mjs
```

**Documentación, contratos y manifiesto (10)**
```
lifecode-rag/README.md
lifecode-rag/package.json
lifecode-rag/docs/PA-UI-0-API-CONTRACT.md
lifecode-rag/docs/PROJECT-AWARE-DATA-CONTRACT.md
lifecode-rag/docs/PROJECT-AWARE-ERROR-CONTRACT.md
lifecode-rag/docs/PROJECT-AWARE-SESSION-CONTRACT.md
lifecode-rag/docs/IMPLEMENTATION-R1.2-DECISIONS.md
lifecode-rag/docs/IMPLEMENTATION-R1.2-FINAL-ACCEPTANCE.md
lifecode-rag/docs/IMPLEMENTATION-R1.2-CONTINUATION.md
lifecode-rag/docs/IMPLEMENTATION-R1.2-RELEASE-READINESS.md
```

**Excluidos del staging:** `cache/scratch/**`, freeze/parches, laboratorios `<LAB>-*`, capturas,
cookies, `<HOME>/.dsh/**`, el árbol sucio del propietario, el release 1.5.11, `node_modules`,
`*.sqlite3`, logs y `tools/`/`demo/`/`eval/`/`bench/` no versionados.

## 14. Estado Git final

- Commits: `67e7c8cbb0c96069f305f7514740ecd910e04e6c` (padre `3614870…`) + `b2d8faf0442d6e2793eb3e4421d9a5387170bc14` (padre `67e7c8c…`).
- 43 archivos en el commit, lista idéntica a la del apartado 13.
- Inmediatamente tras el commit: árbol limpio, release 1.5.11 limpio.
- Sin push, tag, PR, publicación, instalación, despliegue, reset, clean, stash ni rebase.
- Actualizaciones posteriores de este informe y del punto de continuación quedan sin commit por diseño (documentación post-commit); el commit `b2d8faf` es el HEAD empujado.


**Restricción operativa M3:** host y CLI no deben compartir simultáneamente el mismo perfil; la cola reclama peticiones `running` sin marca de dueño al arrancar.
