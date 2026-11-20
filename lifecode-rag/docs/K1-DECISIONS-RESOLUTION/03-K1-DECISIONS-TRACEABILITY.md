# 03 — Trazabilidad de las decisiones K1

**Acto:** HERMES-LCRAG-K1-DECISIONS-RESOLUTION-01 · **Modo:** `DOCUMENTATION ONLY`
**Función:** relacionar lo aprobado (Q-01…Q-08) con lo ya decidido (D-UI-01…D-UI-11), con las propuestas
técnicas de K1 (K1-D-01…K1-D-08) y con los gates y GAP afectados — sin ascender ninguna propuesta a
decisión.

---

## 1. Clases de registro

| Clase | Significado |
|---|---|
| `DECISIÓN APROBADA` | el propietario la aprobó expresamente en este acto |
| `PROPUESTA TÉCNICA` | recomendación de K1 **no** aprobada como decisión; requiere autorización en su fase |
| `REGLA DERIVADA` | se deduce del contrato o del anfitrión; no es materia de aprobación, pero tampoco se inventó aquí |
| `PENDIENTE` | cuestión abierta, con estado literal |
| `ESTADO CONGELADO` | estado de bloqueo que este acto no altera |

---

## 2. Q-01…Q-08 · trazabilidad completa

| Q | Resolución aprobada (resumen) | D-UI relacionadas | K1-D relacionadas | Gates / GAP | Clase | Consecuencia por etapa |
|---|---|---|---|---|---|---|
| Q-01 | No aceptar el riesgo residual; D-UI-03 sigue pendiente | D-UI-02 `BLOCKED`, D-UI-03 `PENDING HUMAN DECISION`, D-UI-11 `NOT DEMONSTRATED` | — | PA01, G6, G6b; GAP-18, GAP-19, GAP-20 | `DECISIÓN APROBADA` + `PENDIENTE` | **A:** sin efecto · **B:** sin datos reales · **C:** sigue `BLOCKED` |
| Q-02 | Historial no disponible; no inventar rutas | — | — | hueco contractual (no hay ruta de listado de auditoría) | `DECISIÓN APROBADA` | **B:** V10 se pinta no disponible con causa |
| Q-03 | Bibliotecas informativas y de sólo lectura | — | — | contrato §6.4 (sólo lectura) | `DECISIÓN APROBADA` | **B:** V3 sin acciones de concesión/revocación |
| Q-04 | Preferir laboratorio; si no, perfil normal con banda | — | K1-D-04 (mecanismo de fixtures) | — | `DECISIÓN APROBADA` (entorno) + `PROPUESTA TÉCNICA` (mecanismo) | **A/B:** modo fixture con banda; laboratorio exige acto aparte |
| Q-05 | Opción A: coexistencia legacy, detección sólo en live | — | K1-D-06 | API v0.2 vs `/ui/api`; D-UI-01 | `DECISIÓN APROBADA` | **B:** sin sondeo en fixtures; **C:** el sondeo nace con `live` |
| Q-06 | `PENDING DESIGNATION` para TI-7 | D-UI-11 | — | Ruta B, TI-7 | `PENDIENTE` | **C:** B no puede pasar a `DEMONSTRATED` |
| Q-07 | Versionar `eval/pa-ui-1/evidence/` al crearla | — | K1-D-07 | ACCEPTANCE §M | `DECISIÓN APROBADA` (diferida) | **A/B:** evidencia con casa versionada cuando exista |
| Q-08 | Enmendar G3: `inject` no es requisito | — | K1-D-02 | **G3**, GAP-01 | `DECISIÓN APROBADA` como propuesta; `PENDIENTE DE APLICACIÓN` | **A:** el gate se lee con la nueva redacción cuando se aplique; hoy sigue igual |

---

## 3. K1-D-01…K1-D-08 · qué quedó aprobado y qué no

| Id | Propuesta de K1 | ¿Aprobada en este acto? | Dónde vive ahora |
|---|---|---|---|
| K1-D-01 | Añadir `exports` al manifiesto | **No** — sólo se aprueba el *criterio* de que es requisito de carga (Q-08). El cambio de manifiesto pertenece a K1-A | `02` §4 (evidencia) + `04` (límite de autorización) |
| K1-D-02 | No añadir `dsh.client.inject` | **Sí en el criterio** (Q-08); la acción concreta de no añadirlo es parte del manifiesto que K1-A ejecutaría | `02` §5 |
| K1-D-03 | Locales inline ES/EN | **No** — sigue siendo propuesta técnica | `K1-IMPLEMENTATION-PLAN/02` §8 K1-A-04 |
| K1-D-04 | `DATA_MODE='fixture'` con corte de red | **Parcial**: el entorno se decide en Q-04; el mecanismo sigue siendo propuesta | `01` Q-04 + `03` §6 |
| K1-D-05 | `ui.read` no se escribe desde el panel | **Sí por derivación** del contrato §7.1 (`REGLA DERIVADA`) | `K1-IMPLEMENTATION-PLAN/03` y `04` |
| K1-D-06 | Coexistencia legacy (opción A) | **Sí** (Q-05) | `01` Q-05 |
| K1-D-07 | Carpeta de evidencia `eval/pa-ui-1/evidence/` | **Sí, diferida** (Q-07) | `01` Q-07 |
| K1-D-08 | Mantener nombres literales del plan K1 | **No decidida**; este acto no renombra nada. La carpeta nueva usa los nombres literales **de este acto** (`01-OWNER-DECISIONS.md`…), que no llevan guion largo: son dos encargos distintos y no se homologan retroactivamente | este documento, §3 |

Regla aplicada: una recomendación no se convierte en decisión por haber sido aceptada su premisa. Que el
propietario apruebe *que `exports` es requisito* no aprueba *editar `package.json`*.

---

## 4. D-UI-01…D-UI-11 · estado que este acto conserva

| Id | Decisión | Estado | ¿Alterada por este acto? |
|---|---|---|---|
| D-UI-01 | Prefijo `/lifecode-rag/ui/api` | CONFIRMADA | no |
| D-UI-02 | Transporte por cabecera + `agents.get` | **BLOCKED** | no |
| D-UI-03 | Riesgo residual | **PENDING HUMAN DECISION** | no (Q-01 lo mantiene) |
| D-UI-04 | `expectedRevision` obligatoria | RESUELTA DOCUMENTALMENTE | no |
| D-UI-05 | Candidatos = `cwd` ∪ actual | CONFIRMADA | no |
| D-UI-06 | Sin paginación de búsqueda | CONFIRMADA | no |
| D-UI-07 | `ui.read` append-only fail-closed | RESUELTA DOCUMENTALMENTE | no |
| D-UI-08 | Diagnóstico con rutas redactadas | CONFIRMADA | no |
| D-UI-09 | Límites clasificados | CONFIRMADA | no |
| D-UI-10 | `409 session-unavailable` | CONFIRMADA | no |
| D-UI-11 | Aislamiento topológico | **NOT DEMONSTRATED** | no (Q-06 lo deja sin responsable) |

---

## 5. GAP relevantes · sin cambios

| GAP | Qué es | Estado | Relación con este acto |
|---|---|---|---|
| GAP-01 | Manifiesto y registro de slots del cliente | REQUIRES IMPLEMENTATION | Q-08 corrige la **redacción del gate**, no el GAP |
| GAP-07 | Lecturas de UI sin auditar | REQUIRES IMPLEMENTATION | Q-01 lo mantiene como control obligatorio si algún día se aceptara el riesgo |
| GAP-09 | Selección sin concurrencia optimista | REQUIRES IMPLEMENTATION | sin cambio; sigue siendo `SECURITY` |
| GAP-18 / GAP-19 | Identidad de sesión / capacidad del host | **BLOCKED** | sin cambio |
| GAP-20 | Sin distinción entre «sin credencial» y «credencial inválida» | `OPEN / DOCUMENTED HOST LIMITATION` | sin cambio |

---

## 6. Consecuencias por etapa

### K1-A · integración visual

- **Habilitado por este acto:** nada. Sigue `NOT AUTHORIZED`.
- **Preparado para una autorización posterior:** manifiesto (`exports`), registro de slots con la forma
  vigente, locales, ciclo de vida, modo fixture con corte de red, gates (`client.test.mjs`,
  `tools/check.mjs`), prueba visual con reinicio.
- **Condicionado:** Q-04. El laboratorio preferido existe pero **no tiene el plugin**; habilitarlo exige
  un acto de aprovisionamiento aparte. Mientras no exista, perfil normal + banda.
- **Fuera aunque se autorice K1-A:** modo `live`, datos reales, `ui.read`, cambios de perfil,
  reinstalación, pruebas de seguridad.

### K1-B · interfaz Project-Aware

- **Requisito:** K1-A cerrado (módulo cargado y montado). Sin eso no hay dónde montar.
- **Fijado por Q-02/Q-03:** V10 no disponible; V3 de sólo lectura.
- **Fijado por Q-04:** fixtures con banda permanente.
- **Fijado por Q-05:** el sondeo legacy no se implementa en K1-B.
- **Sin cambios:** las cinco limitaciones (GAP-05/06/07/09/10) siguen visibles; la accesibilidad y el 390 px
  siguen siendo criterio.

### K1-C · gate de seguridad

- **Sin cambios:** Ruta A `BLOCKED`; Ruta B `NOT DEMONSTRATED` (y ahora con TI-7 explícitamente sin
  responsable); Ruta C **no aceptada**; PA01 `BLOCKED`; G6 `BLOCKED`; GAP-20 `OPEN / DOCUMENTED HOST
  LIMITATION`.
- **Q-01** impide cualquier atajo: no se acepta el riesgo, así que no hay camino documental a datos reales.
- **Q-08** no toca seguridad: sólo cambia cómo se lee un gate de carga de cliente.

---

## 7. Contradicciones registradas (no resueltas)

| # | Contradicción | Evidencia | Efecto |
|---|---|---|---|
| X-R-01 | `PA-UI-0-ACCEPTANCE.md` se declara «`pa-ui/0.1.0-draft`, revisión **2**» en su cabecera, mientras el contrato se titula revisión **3** y `PA-UI-0-GAPS.md` §10 habla de «revisión 3» | cabeceras de los dos documentos | ninguno operativo; se armoniza, si se autoriza, en el acto que aplique la enmienda de G3 |
| X-R-02 | G3 exige `dsh.client.inject` como requisito de carga; el anfitrión lo describe como orden de activación opcional | `02` §4–§5 | queda cubierta por la propuesta de enmienda (Q-08), pendiente de aplicación |
| X-R-03 | El laboratorio DSH existe, pero su perfil no incluye `@local/lifecode-rag` | `skill-compiler-lab-2026-11-05/home/profiles/desktop/package.json` | Q-04 no puede aplicarse en su primera mitad sin un acto de aprovisionamiento |

Heredadas de K1 y aún abiertas: X-01 (GAP-01 dice «no existe» y el cliente existe pero no carga), X-03
(`WORKSPACE-UX` §5.1 vs `client.js`), X-06 (`eval/pa-ui-1/` no existe). No se tocan.

---

## 8. Lo que esta trazabilidad no puede afirmar

- Que K1-A esté autorizado, ni que el panel funcione.
- Que se hayan ejecutado pruebas de K1 (no se ejecutó ninguna).
- Que los fixtures prueben seguridad (no prueban nada de seguridad).
- Que exista responsable de TI-7 (no existe: `PENDING DESIGNATION`).
- Que la Ruta B haya avanzado (sigue `NOT DEMONSTRATED`).
