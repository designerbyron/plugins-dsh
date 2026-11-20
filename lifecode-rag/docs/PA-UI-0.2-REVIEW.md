# PA-UI-0.2 — Resolución documental de hallazgos cruzados

**Proyecto:** LifeCode RAG · **Fase:** PA-UI-0.2 (exclusivamente documental) · **Fecha:** 2026-11-18
**Documentos armonizados:** `PA-UI-0-API-CONTRACT.md`, `PA-UI-0-ACCEPTANCE.md`, `PA-UI-0-GAPS.md`, `PA-UI-0.1-REVIEW.md`
**Informe nuevo:** este documento
**Resultado:** **`COMPLETED`** (documental). PA01 sigue **`BLOCKED`**; G6 **sin demostrar**; **PA-UI-1 no iniciada.**

---

## 1. Resumen

PA-UI-0.2 corrige los cuatro hallazgos cruzados de la revisión independiente de PA-UI-0.1 y deja un único relato coherente entre contrato, aceptación y gaps:

1. **PA02 — auditoría append-only.** Se elimina la deduplicación de 5 s y el campo `detail.repeat` del contrato: exigían reescribir una fila ya encadenada, lo que contradice el carácter append-only del registro. Ahora cada lectura auditada produce **un evento nuevo e inmutable**; el volumen se contiene en el cliente (polling sólo con panel visible, 30 s) y no en la auditoría. Se define qué es una «lectura auditada» y cómo se relaciona con polling, refrescos y reintentos. Fail-closed se conserva.
2. **PA03 — actor.** `actor = human` para **todo** `ui.read`, definido como **origen del canal** (persona operando el panel), no como identidad autenticada. La UI nunca escribe `model`; las acciones del modelo siguen por las herramientas v0.1 con su propio `actor`. Se separa origen de la solicitud de autenticación de identidad.
3. **GAP-20 / RR-03.** La limitación del host se unifica como **`OPEN / DOCUMENTED HOST LIMITATION`** en los cuatro documentos. Se elimina todo lenguaje que la presentara como aceptada. Documentar no es aceptar: D-UI-03 queda **`BLOCKED / PENDING HUMAN DECISION`** y **no otorgada** por esta autorización.
4. **Aislamiento topológico (D-UI-11).** Se añade la ruta alternativa con criterios TI-1…TI-7 (contrato §3.6, gaps §4.2). Se declara **`NOT DEMONSTRATED`**: no se ejecutaron pruebas ni se cambió la topología. Se distingue expresamente de la autenticación de sesión: **reduce superficie, no autentica**.
5. **G6.** Se actualiza a dos rutas — **(A)** capacidad de sesión del host, o **(B)** aislamiento topológico demostrado (TI-1…TI-7) — y se aclara que la aceptación humana del riesgo es una decisión independiente que no sustituye a ninguna de las dos.

No se modificó ningún archivo fuera de los cuatro documentos autorizados y este informe. No se tocó código, manifiestos, perfiles, registry, almacenes ni Git.

---

## 2. Hallazgos y estado

| Hallazgo | Resolución documental | Estado |
|---|---|---|
| **PA02** — dedupe de `ui.read` vs append-only (H-12) | contrato §7.1 reescrita: un evento nuevo e inmutable por lectura; `repeat` eliminado; H-12/H-13 redefinidos; T14 y §8 actualizados | **RESOLVED DOCUMENTALLY** (implementación en PA-UI-1) |
| **PA03** — `actor` `human` vs `model` | contrato §7.1: `actor="human"` como origen del canal; H-09 corregido; GAPS §5 sin cambio de estado | **RESOLVED DOCUMENTALLY** |
| **GAP-20 / RR-03** — limitación del host | `OPEN / DOCUMENTED HOST LIMITATION` en contrato §3.5, gaps GAP-20/R-02/§4.1, review 0.1 RR-03; sin «aceptado» | **OPEN / DOCUMENTED HOST LIMITATION** |
| **Aislamiento topológico** | contrato §3.6 (TI-1…TI-7), gaps §4.2, D-UI-11; G6 ruta B | **NOT DEMONSTRATED** |
| **G6** | ACCEPTANCE §L: ruta A (capacidad del host) o ruta B (aislamiento demostrado); aceptación del riesgo separada y no otorgada | **BLOCKED** (ninguna ruta demostrada) |
| **PA01** | sin cambios de fondo: el host autentica autoridad, no sesión | **BLOCKED** |

---

## 3. Secciones modificadas

| Documento | Secciones | Cambio |
|---|---|---|
| `PA-UI-0-API-CONTRACT.md` | cabecera (revisión 3 + banner 0.2); §3.4 (D/E); §3.5 (estado GAP-20); **§3.6 nueva** (TI-1…TI-7); §7.1 (append-only, sin `repeat`, `actor` de origen); §8 (fila de polling; sin ventana de dedupe); §9.2 (T14); §11 (D-UI-03/07, **D-UI-11**); §14 nueva (registro 0.2); §13 conservado | PA02, PA03, GAP-20, topología, G6 |
| `PA-UI-0-ACCEPTANCE.md` | cabecera (revisiones + banner 0.2); H-09, H-10, H-11, **H-12**, **H-13 nueva**; §L G2/G6/G6b y párrafo de aceptación separada; §N (GAP-20 + fila de aislamiento) | PA02, PA03, G6 |
| `PA-UI-0-GAPS.md` | cabecera; GAP-03, GAP-18, GAP-19, **GAP-20**; §4.1 (GAP-07/20); **§4.2 nueva** (TI-1…TI-7); §5 (D-UI-03/07/11); R-02; §9 (paso 0: rutas A/B/aceptación); §10 | GAP-20, topología, G6 |
| `PA-UI-0.1-REVIEW.md` | nota de revisión al inicio; §4 H-12 marcado como histórico; §5 D-UI-07; §6 D/E; §7 RR-01/RR-03; §8 marcado como histórico | coherencia con 0.2, sin borrar historial |

No se eliminó ningún registro de decisión anterior: §13 del contrato y el contenido de `PA-UI-0.1-REVIEW.md` se conservan; las correcciones se añadieron como revisión (contrato §14, notas de historial).

---

## 4. Estado de las decisiones

| Decisión | Estado PA-UI-0.2 |
|---|---|
| D-UI-01 prefijo `/lifecode-rag/ui/api` | CONFIRMADA |
| D-UI-02 transporte de identidad | **BLOCKED** |
| D-UI-03 riesgo residual | **BLOCKED / PENDING HUMAN DECISION — no otorgada** |
| D-UI-04 `expectedRevision` | RESUELTA DOCUMENTALMENTE |
| D-UI-05 candidatos cwd ∪ actual | CONFIRMADA |
| D-UI-06 sin paginación de búsqueda | CONFIRMADA |
| D-UI-07 auditoría `ui.read` | RESUELTA DOCUMENTALMENTE (append-only, revisada) |
| D-UI-08 diagnóstico redactado | CONFIRMADA |
| D-UI-09 límites clasificados | CONFIRMADA |
| D-UI-10 `session-unavailable` 409 | CONFIRMADA |
| D-UI-11 aislamiento topológico | **NOT DEMONSTRATED** |
| G6 ruta A (capacidad del host) | **BLOCKED** — no existe hoy |
| G6 ruta B (aislamiento demostrado) | **BLOCKED** — TI-1…TI-7 sin evidencia |
| Aceptación humana del riesgo | **NO OTORGADA** (decisión independiente, no inferida) |

---

## 5. Inconsistencias residuales

Búsqueda cruzada de `append-only`, `repeat`, `actor`, `human`, `model`, `GAP-20`, `RR-03`, `ACCEPTED`, `BLOCKED`, `G6`, `isolation`, `session` en los cuatro documentos: no queda ninguna contradicción conocida.

- Las menciones a `repeat` que subsisten son explícitamente históricas («se retiró», «no existe») o parte del registro de revisión; no describen comportamiento vigente.
- `PA-UI-0.1-REVIEW.md` conserva filas de su versión original (H-12) marcadas como históricas y remite a este informe; no se presenta como contrato vigente.
- Se conservan las contradicciones código ↔ documentación X-01…X-05 (son hallazgos registrados, no deuda de esta fase).
- **No se declara GAP-20 aceptado en ningún documento.**

---

## 6. Riesgos abiertos

| Id | Riesgo | Estado |
|---|---|---|
| RR-01 | Proceso local con cookie/token del GUI direcciona otra sesión | abierto; no mitigable por el plugin |
| RR-02 | Sin logout por sesión; cookie de 30 días | abierto (host) |
| RR-03 | 401 indistinguible entre «sin credencial» y «credencial inválida» | `OPEN / DOCUMENTED HOST LIMITATION` (GAP-20) |
| RR-04 | `ui.read` fail-closed degrada la UI si el registro está en sólo lectura | diseñado; H-11 lo mide |
| RR-05 | UI con identidad no demostrada si se implementa sin G6 | mitigado por gate G6 y este cierre |
| RR-06 | Auditoría sin dedupe puede crecer con polling | acotado en cliente (30 s, panel visible); sin agregación que rompa append-only |

---

## 7. Decisiones que requieren autorización humana posterior

1. **D-UI-03** — aceptar o no el riesgo residual de suplantación (decisión independiente, por escrito). No se otorga aquí.
2. **G6 ruta A** — aportar/verificar una capacidad de sesión del host (hoy inexistente).
3. **G6 ruta B** — autorizar y ejecutar la demostración de TI-1…TI-7 en un entorno controlado (fuera de fase documental).
4. **GAP-11** — política de expiración de sesiones (TTL).
5. **PA-UI-1** — autorización explícita; no concedida.

---

## 8. Integridad documental

Tamaños y SHA-256 tras la última edición (2026-11-18):

| Documento | Bytes | SHA-256 |
|---|---|---|
| `lifecode-rag/docs/PA-UI-0-API-CONTRACT.md` | 55545 | `934224310e10006d0ab3dbc2fec18b5a418a9e7c5e0f68f2570ee544e468c68a` |
| `lifecode-rag/docs/PA-UI-0-ACCEPTANCE.md` | 22268 | `d32a4912f6b75b8b97c4b7e82790fd3067bf759a96d867265a07932ccdd547f9` |
| `lifecode-rag/docs/PA-UI-0-GAPS.md` | 22519 | `d5bd492fd72eab511ddce814dcdb2a1d0ecd419be7ff64a49dbe75e4daeaeb89` |
| `lifecode-rag/docs/PA-UI-0.1-REVIEW.md` | 15154 | `4a3894179f6bd9815c6b831eb863c28a327233941ab2591b0fb8901fa12d7732` |

- Los tres documentos citan la misma versión (`pa-ui/0.1.0-draft`, revisión 3), los mismos códigos y las mismas rutas.
- `§7.1` del contrato es la única definición de `ui.read`; ACCEPTANCE H-09…H-13 y GAPS §4.1 la referencian.
- Enlaces relativos: comprobados sin destinos rotos ni rutas absolutas nuevas.
- Este informe se hashea en la entrega; su contenido no puede incluir su propio hash final sin invalidarlo.

---

## 9. Integridad del entorno

| Comprobación | Antes | Después |
|---|---|---|
| Rama | `fix/t45-4-r17-acceptance` | `fix/t45-4-r17-acceptance` |
| HEAD | `b6c0cd24621c8bc3282185d1821c60b7956f8a83` | `b6c0cd24621c8bc3282185d1821c60b7956f8a83` |
| `git status --porcelain` (líneas) | 1151 (25 ` M` + 1126 `??`) | 1151 |
| Archivos ejecutables modificados | 0 | 0 |
| Perfil / `DSH_HOME` / configuración del host | sin cambios | sin cambios |
| Registry / almacenes RAG / sesiones | sin cambios (mtimes 18/11 18:43–18:55) | sin cambios |
| Operaciones Git de escritura | ninguna | ninguna |

- Ficheros escritos por esta tarea: los cuatro documentos autorizados y este informe, todos bajo `lifecode-rag/docs/`.
- No se ejecutaron pruebas, migraciones, instalaciones ni reinicios (`NOT TESTED` por diseño de la fase).
- No se modificaron `skill-compiler/`, `_audit/`, `lifecode-skill-center/`, `MEMORY.md`, `AGENTS.md` ni `CONTRATO-v0.1.md`.

---

## 10. Cierre

**PA-UI-0.2: `COMPLETED`** en su alcance documental.

- PA02 (append-only), PA03 (`actor`), GAP-20 (`OPEN / DOCUMENTED HOST LIMITATION`), topología (`NOT DEMONSTRATED`) y G6 (dos rutas) quedan resueltos y coherentes.
- **PA01 sigue `BLOCKED`**; G6 sin demostrar; la aceptación del riesgo **no** se ha otorgado.
- **PA-UI-1 no fue iniciada** y no se continuará sin autorización humana explícita.
