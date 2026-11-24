# UX-2.2 — Plan de implementación (tracking persistente) · acto 2026-11-23

**Base:** `plugins-dhs-release/lifecode-rag` @ `7d7e839` + 27 modificados de 1.4.0 (sin commitear, se preservan).
**Rama de trabajo:** `feat/ux22-tracking` (local, creada desde `release/lifecode-rag-1.0.0` en el mismo commit; el worktree no se tocó: 54 entradas antes y después).
**Autorización:** mandato «Completación integral del producto» (2026-11-23), §1 y §7-FASE 2 → `D-UX22-01…12`.
**Fuera de alcance:** `D-UX22-13` (operación de raíz, `PENDING`), UX-3/4/5, publicación npm, push.

---

## 1. Baseline medido (no declarado)

| Dato | Valor | Cómo se midió |
|---|---|---|
| Suite de 1.4.0 | **563/563 PASS**, 0 fail, 52 416 ms, exit 0 | `node tools/hermetic.mjs` (2026-11-23 15:2x) |
| Almacén real intacto tras la suite | huella `f12e5ac62baa187e…`, **6 ficheros**, idéntica antes/después | misma salida (`✓ hermético`) |
| `tracking` en el núcleo | **0 coincidencias** en `lib/` e `index.js` | `grep -rn` |
| Rutas PA | 17 rutas GET/HEAD/POST; **ningún `PUT` ni `DELETE`** en `pa-api.mjs` | `grep -c PUT` = 0 |
| Registro | **v2**, 11 tablas `STRICT`, migración aditiva `REGISTRY_MIGRATIONS` ya preparada | `registry-schema.mjs:9,192` |
| Panel | vista `Seguimiento` = maqueta con `switch disabled` fijada por `client.test.mjs:1276` | lectura de `client.js:3730-3759` |

---

## 2. Decisiones técnicas del arquitecto (`D-IMPL-*`)

Formato del mandato §8. Todas son reversibles y ninguna amplía permisos.

### D-IMPL-01 — Forma exacta de `workspace_tracking` (resuelve `PROPUESTA-SQL`)

- **Situación:** la spec §5 propone un DDL que ninguna decisión fijó y que es internamente imposible en dos puntos (`path_key` PK vs «dos filas con la misma clave»; fila creada por el sistema con `bound_by CHECK('human')`).
- **Opciones:** (a) adoptar el DDL tal cual → estados irrepresentables; (b) PK compuesta `(path_key, kind)` → permite duplicados que rompen la identidad; (c) PK `path_key` + sin generación automática de filas.
- **Elegida: (c)**, con estos ajustes sobre la propuesta: se añade `path TEXT` (ruta literal de la última reconciliación, para la UI truncada de `D-UX-14`); `association` conserva los tres valores pero `'conflict'` **no es producible** en UX-2.2 (la ambigüedad de dos workspaces del Host con la misma clave se resuelve en proyección, no en la fila); índices `workspace_tracking_project` (`project_id`) y `workspace_tracking_state` (`state, last_status`).
- **Justificación:** `path_key` es la identidad (`D-UX22-07`); la ambigüedad es un hecho del Host, no del registro.
- **Impacto:** registro v3 (una tabla nueva), `REGISTRY_TABLES` + `REGISTRY_VERSION`.
- **Riesgo:** bajo. **Reversibilidad:** alta (tabla aislada, sin ALTER).

### D-IMPL-02 — El sistema no crea filas de seguimiento

- **Situación:** la spec dice que un movimiento «deja una fila nueva en `missing`», pero `bound_by` exige `'human'` y `bound_at` no admite nulos.
- **Elegida:** sólo `PUT /pa/tracking` (humano) crea filas. Un movimiento deja la fila antigua intacta en `missing` y la ruta nueva aparece **no seguida** hasta que una persona la reconcilie.
- **Justificación:** `D-UX22-09` prohíbe la asociación automática; crear filas desde el sistema contradiría el CHECK y el eje A.
- **Impacto:** la reconciliación sólo actualiza filas existentes. **Riesgo:** bajo.

### D-IMPL-03 — El eje B se reconcilia en la resolución, nunca en un `GET`

- **Situación:** la spec §2 pide reconciliar «al listar workspaces», pero `GET /pa/workspaces` está contratado como no-escritor (`API:893-896`) y **dos pruebas vigentes lo fijan** (`pa-workspaces.test.mjs:267` «cero llamadas de escritura», `:282` «no cambia la auditoría»).
- **Opciones:** (a) escribir en el GET y reescribir las pruebas; (b) no reconciliar nunca (eje B muerto); (c) reconciliar donde ya se escribe.
- **Elegida: (c).** La reconciliación corre dentro de `resolveScope`, que **ya** escribe auditoría (`scope.resolve`) y que recibe `openProjects` del Host. Escribe sólo `last_seen_at`, `last_status`, `path` y audita `tracking.reconcile` con `actor='host'`.
- **Justificación:** conserva el contrato de lectura del panel y el invariante «la disponibilidad no cambia la preferencia humana» (`D-UX22-08`).
- **Riesgo:** la disponibilidad mostrada puede quedar desfasada hasta la siguiente resolución; la UI lo declara con `lastSeenAt`/`asOf`. **Reversibilidad:** alta.

### D-IMPL-04 — CAS uniforme y sin códigos nuevos de familia

- **Situación:** la propuesta deja `expectedRevision` opcional en `PUT` y sin CAS en `DELETE`; además propone `tracking-invalid`/`tracking-stale-revision`/`tracking-not-found` que duplican `invalid-argument`/`revision-conflict`/`not-found` ya existentes y catalogados con biyección (`error-codes.test.mjs:89`).
- **Elegida:** `expectedRevision` **obligatoria** en `PUT` (`0` = «espero que no exista» → crea) y en `DELETE` (query). Mismatch → `409 revision-conflict` con `details{expectedRevision,currentRevision}`; fila ausente → `404 not-found`; cuerpo inválido → `400 invalid-argument`. El **único** código nuevo es `scope-conflict` (409), que sólo se produce al resolver.
- **Justificación:** una sola familia por hecho, biyección intacta, CAS real en las dos mutaciones.

### D-IMPL-05 — CSRF en las rutas nuevas; retrofit declarado como deuda

- **Situación:** la API PA **no tiene** CSRF (`grep` de `x-lifecode-rag|origin|SameSite` en `pa-api.mjs` = 0); el cliente ya envía `x-lifecode-rag: 1` y el patrón existe en `lib/server.mjs:77-95`.
- **Elegida:** `PUT`/`DELETE /pa/tracking` exigen `content-type: application/json` y `x-lifecode-rag: 1`; se rechaza `403 forbidden` sin ellos. **No** se retrofitan las rutas `POST` existentes en esta fase.
- **Deuda declarada:** `P-UX22-01` — extender el mismo fence a `POST /pa/selection` (exige actualizar pruebas de `pa-api`), en Fase 4.

### D-IMPL-06 — Reversión v3→v2: corrección documental, no relajación de la guarda

- **Situación:** `UX-22-TRACKING-SPEC.md:204` afirma que el código v2 «ignora» una tabla nueva; **es falso**: `assertRegistry` lanza `store-version-unsupported` si `user_version > REGISTRY_VERSION` (`registry.mjs:181-185`), y `openRegistry` se llama en cada petición PA y en cada herramienta.
- **Elegida:** se mantiene la guarda tal cual (es una protección real) y se documenta el procedimiento exacto de vuelta atrás: cerrar el Host, restaurar el `registry.sqlite3` del respaldo **o** fijar `user_version=2` y `meta.registry_version=2` en el registro (sin `DROP TABLE`), y verificar `integrity_check`. Se corrige la afirmación en la spec.
- **Riesgo:** nulo para datos; el de operación queda escrito.

### D-IMPL-07 — Una sola canonicalización de ruta

- **Situación:** hay dos implementaciones con semántica distinta (`registry.mjs:pathKeyFor` con `realpath` si existe, y `workspaces-projection.mjs:pathKeyOf` léxico). En el caso `missing` (ruta inexistente) divergen.
- **Elegida:** la clave persistida se calcula **una vez, al escribir** (PUT): `pathKeyFor` (realpath si existe; si no, normalización léxica). La fila **congela** su clave y su `path`; la reconciliación compara con la clave léxica del Host normalizada igual (minúsculas, `/`, sin separador final) y nunca reescribe la clave.
- **Riesgo:** un `realpath` distinto al literal (junction) puede no casar con la clave del Host; se resuelve con el alias `workspace_id` cuando el Host lo entrega, y se declara en el informe de aceptación.

### D-IMPL-08 — `pa/1.5.0` aditiva, compatibilidad verificada

`PA_VERSION` sube a `pa/1.5.0`; las pruebas de compatibilidad `pa/1.3.0`/`pa/1.4.0` (`pa-admin.test.mjs:375`, `pa-workspaces.test.mjs:325`) deben seguir en verde sin cambios, y la forma de las filas de `/pa/workspaces` sólo gana campos (`tracked`, `trackingState`, `trackingProject`).

---

## 3. Orden de trabajo y propiedad de ficheros

Sin dos agentes en el mismo fichero. Dependencias en serie donde la clave primaria o el esquema condicionan lo demás.

| # | Incremento | Ficheros (propietario único) | Depende de | Puerta |
|---|---|---|---|---|
| 1 | Núcleo puro del seguimiento | `lib/tracking.mjs` (nuevo), `tests/tracking.test.mjs` | — | TDD: transiciones de eje A/B, `missing ≠ off`, `paused` no resuelve |
| 2 | Esquema v3 + tabla | `lib/registry-schema.mjs`, `lib/registry.mjs` (`REGISTRY_TABLES`, `REGISTRY_VERSION`, migración `3`), `tests/tracking-migration.test.mjs` | 1 | integridad antes/después, recuento de las 11 tablas v2 igual, apertura del registro v3 |
| 3 | Almacén transaccional + auditoría | `lib/tracking-store.mjs` (nuevo), `tests/tracking-store.test.mjs` | 2 | CAS con `BEGIN IMMEDIATE`; 5 acciones; `reassociate` con anterior/nueva; `tracking.reconcile` sólo eje B |
| 4 | Escalón 2 y `scope-conflict` | `lib/resolve.mjs`, `lib/errors.mjs`, `docs/PROJECT-AWARE-ERROR-CONTRACT.md`, `tests/resolve-tracking.test.mjs` | 3 | precedencia intacta; sólo la sesión actual; aislamiento A/B |
| 5 | Proyección aditiva | `lib/workspaces-projection.mjs`, `lib/harness-workspaces.mjs`, `tests/pa-workspaces.test.mjs` (ampliar, no reescribir) | 3 | forma actual intacta; campos nuevos aditivos |
| 6 | API `/pa/tracking` | `lib/pa-api.mjs`, `tests/pa-tracking.test.mjs` | 3,5 | GET/PUT/DELETE, CAS, CSRF, 400/404/409, `pa/1.5.0`, compatibilidad 1.3/1.4 |
| 7 | Panel | `client.js`, `tests/client.test.mjs` | 6 | tres estados distintos, filtros, texto «seguir no autoriza»; se reescribe el test que fija el switch deshabilitado |
| 8 | Contratos | `docs/PA-UI-0-API-CONTRACT.md` (§20), `PROJECT-AWARE-SESSION-CONTRACT.md`, `UX-22-TRACKING-SPEC.md` (§204 corregido), `CONTRATO-EXTENSIONES-1.4.md` | 6 | contrato y código dicen lo mismo |
| 9 | Evidencia | `plans/UX-02/UX-22-IMPL-2026-11-23/` | 1-8 | `npm run check`, `test:hermetic` con la huella, matriz de 17 criterios |

**Reparto para subagentes** (cuando se delegue): AGENT-02 → incrementos 1-3 (núcleo y registro); AGENT-03 → 5-7 (proyección, API, panel); AGENT-04 → pruebas de aceptación; AGENT-05 → auditoría independiente al cerrar. Nadie toca `lib/resolve.mjs` salvo el incremento 4, que ejecuta el arquitecto o un único agente.

---

## 4. Criterios de aceptación (los 17 del propietario)

Se copian de `UX-22-TRACKING-SPEC.md:289-307` y cada uno se marca `DOBLE` o `HOST REAL`. Los que exigen Host real (toggle persistente tras reiniciar, dos sesiones aisladas, panel) quedan **BLOCKED** hasta la sesión autenticada del propietario; el resto se cierra con la suite.

## 5. Riesgos abiertos

1. **Downgrade**: un registro v3 no lo abre 1.4.0 (`D-IMPL-06`). Mitigación: la migración sólo ocurre en el acto de instalación, con respaldo verificado.
2. **Reconciliación diferida** (`D-IMPL-03`): la disponibilidad puede no estar al día en el panel hasta la siguiente resolución.
3. **CSRF parcial** (`D-IMPL-05`): las mutaciones heredadas siguen sin fence.
4. **`scope-conflict` cambia la resolución** de sesiones que hoy caen a `scope-unresolved` cuando no hay selección: sólo aplica si hay una fila seguida `on`+`ok` para esa sesión; ninguna existe hoy (0 filas), por lo que el comportamiento actual no cambia hasta que una persona active seguimiento.

## 6. Estado

Plan **ejecutable**, aprobado por el arquitecto bajo mandato §1.7. Baseline cerrado. Implementación en curso desde el incremento 1.
