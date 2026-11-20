# PA-UI-0.3 — Corrección de G6 y armonización final

**Proyecto:** LifeCode RAG · **Fase:** PA-UI-0.3 (exclusivamente documental) · **Fecha:** 2026-11-18
**Documento modificado:** `PA-UI-0-GAPS.md` (§9 y §10)
**Documento nuevo:** este informe
**Resultado:** **`COMPLETED`** (documental). G6 sigue **`BLOCKED`**; D-UI-03 **no otorgada**; **PA-UI-1 `NOT AUTHORIZED / NOT STARTED`.**

---

## 1. Objetivo y autorización

PA-UI-0.3 se autoriza únicamente para corregir una contradicción de `PA-UI-0-GAPS.md` §9 respecto a las condiciones para satisfacer G6 y armonizar las referencias estrictamente necesarias. No autoriza implementar PA-UI-1, aceptar D-UI-03, ejecutar pruebas topológicas, cambiar la arquitectura ni tocar código, perfiles, registry, almacenes o Git de escritura.

## 2. Contradicción identificada en PA-UI-0.2

- `PA-UI-0-ACCEPTANCE.md` §L (G6) exige **al menos una de dos rutas técnicas**: (A) capacidad de sesión del host, o (B) aislamiento topológico demostrado con TI-1…TI-7.
- `PA-UI-0-GAPS.md` §9 presentaba en el **paso 0** tres opciones —A, B **o** «aceptación explícita del riesgo (D-UI-03)»— y en el **paso 3** cerraba G6 «por A, B **o** decisión de riesgo registrada».
- Eso convertía de facto la aceptación del riesgo en una tercera vía de G6 y contradecía la regla normativa de ACCEPTANCE §L.

## 3. Texto anterior y regla corregida

**Paso 0 anterior (resumen):** «una persona debe elegir una vía: (A) …; (B) …; o registrar una aceptación explícita del riesgo (D-UI-03) … Sin una de las tres, PA-UI-1 backend queda BLOQUEADA.»

**Paso 3 anterior:** «… y cerrar G6 por A, B o decisión de riesgo registrada.»

**Regla corregida (vigente en §9):**

- **Ruta A — capacidad de sesión del host.** Capacidad verificable, ligada al emisor y a la sesión, que permita comprobar que la petición está autorizada para actuar sobre esa sesión. Estado: **`BLOCKED`**.
- **Ruta B — aislamiento topológico demostrado.** Cumplimiento de **todos** los criterios TI-1…TI-7 (contrato §3.6, gaps §4.2), con evidencia reproducible y revisión humana. Estado: **`NOT DEMONSTRATED`**. Reduce superficie, **no autentica**.
- **D-UI-03 — aceptación humana del riesgo.** Decisión independiente y por escrito. **No es una tercera ruta de G6**, no sustituye a A ni B, no convierte una capacidad inexistente en demostrada, no demuestra aislamiento y **no permite declarar G6 `PASS`**.
- **Paso 3 corregido:** la confirmación del `sessionId` del slot (G5) es **necesaria pero no suficiente**; G6 sólo se cierra con A o B demostradas y evidencia reproducible (ACCEPTANCE §L).

No se modificaron los criterios TI-1…TI-7 ni su alcance.

## 4. Referencias exactas a las secciones modificadas

| Documento | Sección | Cambio |
|---|---|---|
| `lifecode-rag/docs/PA-UI-0-GAPS.md` | **§9, paso 0** (líneas 211–215) | Reescrito: sólo rutas técnicas A o B; D-UI-03 como decisión independiente, no tercera ruta |
| `lifecode-rag/docs/PA-UI-0-GAPS.md` | **§9, paso 3** (línea 218) | Reescrito: G5 necesario pero no suficiente; G6 se cierra sólo con A o B |
| `lifecode-rag/docs/PA-UI-0-GAPS.md` | **§10** | Añadida línea de la revisión 0.3 y precisión de archivos escritos |

No se modificó ningún otro documento. No se consideró necesaria ninguna referencia cruzada adicional en contrato o aceptación: sus textos ya expresaban la regla correcta.

## 5. ACCEPTANCE §L sigue siendo la regla normativa

`PA-UI-0-ACCEPTANCE.md` §L no se tocó en esta fase y sigue estableciendo, sin ambigüedad, que G6 requiere la ruta A **o** la ruta B con evidencia reproducible, que la ruta B reduce superficie pero no autentica, y que la aceptación humana del riesgo es una decisión independiente que no sustituye a ninguna de las dos. §9 de gaps ahora **reproduce esa misma regla**; no la amplía ni la relaja.

## 6. D-UI-03 es independiente y no es una tercera ruta

La aceptación del riesgo, si alguna vez se produce por escrito, sólo resuelve la decisión de aceptar o rechazar el riesgo residual. Las condiciones técnicas de G6 (A o B demostradas) siguen siendo independientes y no se modifican por esa decisión. Ningún texto de los documentos permite ya inferir lo contrario.

Nota adicional (sin cambio de contrato de auditoría): `actor="human"` en `ui.read` identifica el **origen del canal** (persona ante el panel), **no** prueba por sí solo que una persona autenticada haya originado la petición. La política append-only de §7.1 y la ausencia de `detail.repeat` se conservan intactas.

## 7. Estado de los elementos

| Elemento | Estado |
|---|---|
| GAP-20 | `OPEN / DOCUMENTED HOST LIMITATION` |
| D-UI-03 | `BLOCKED / PENDING HUMAN DECISION` — **no otorgada** |
| D-UI-11 (aislamiento topológico) | `NOT DEMONSTRATED` |
| PA01 | `BLOCKED` |
| G6-A (capacidad del host) | `BLOCKED` |
| G6-B (TI-1…TI-7) | `BLOCKED` / no demostrada |
| G6 | `BLOCKED` |
| PA-UI-1 | `NOT AUTHORIZED / NOT STARTED` |

## 8. Archivos modificados y nuevos

- Modificado: `lifecode-rag/docs/PA-UI-0-GAPS.md`.
- Nuevo: `lifecode-rag/docs/PA-UI-0.3-REVIEW.md` (este informe).
- Sin cambios: `PA-UI-0-API-CONTRACT.md`, `PA-UI-0-ACCEPTANCE.md`, `PA-UI-0.1-REVIEW.md`, `PA-UI-0.2-REVIEW.md` (historial intacto).

## 9. Hashes y tamaños finales

| Documento | Bytes | SHA-256 |
|---|---|---|
| `PA-UI-0-API-CONTRACT.md` | 55545 | `934224310e10006d0ab3dbc2fec18b5a418a9e7c5e0f68f2570ee544e468c68a` |
| `PA-UI-0-ACCEPTANCE.md` | 22268 | `d32a4912f6b75b8b97c4b7e82790fd3067bf759a96d867265a07932ccdd547f9` |
| `PA-UI-0-GAPS.md` | 23565 | `bae5139187138aaa5805ee89140ec9edd1326ee9a1c39bc36b62987151b4d19b` |
| `PA-UI-0.1-REVIEW.md` | 15154 | `4a3894179f6bd9815c6b831eb863c28a327233941ab2591b0fb8901fa12d7732` |
| `PA-UI-0.2-REVIEW.md` | 10343 | `268771a2f43e159c3d469219225e9b33db4699a94b72b205ad4206f640602d42` |

Los hashes de contrato, aceptación y revisiones 0.1/0.2 coinciden con los del cierre de PA-UI-0.2: **no se modificaron**. El hash de `PA-UI-0-GAPS.md` cambia por la corrección (`bae51391…`, 23 565 B); este informe no puede contener su propio hash sin invalidarlo y lo reporta en la entrega.

## 10. Verificación de enlaces relativos

Comprobados todos los enlaces de los cinco documentos: **0 destinos rotos**, **0 rutas absolutas nuevas**. Las referencias `§L`, `§3.6`, `§4.2`, `§9` y `§10` existen en los documentos citados.

## 11. Evidencia de integridad del entorno

| Comprobación | Antes | Después |
|---|---|---|
| Rama | `fix/t45-4-r17-acceptance` | `fix/t45-4-r17-acceptance` |
| HEAD | `b6c0cd24621c8bc3282185d1821c60b7956f8a83` | idéntico |
| `git status --porcelain` (líneas) | 1151 | 1151 (mismo conjunto; sólo cambia el contenido de un archivo ya no versionado y se añade uno nuevo bajo `docs/`) |
| Hashes de referencia PA-UI-0.2 | 5/5 MATCH | sin cambios salvo GAPS, corregido a propósito |
| Archivos ejecutables / manifiestos modificados | 0 | 0 |
| Perfil `desktop` (`package.json`), `cordis.patch.yml` | intactos | intactos |
| `registry.sqlite3`, almacenes RAG, `-wal`/`-shm` | sin cambios | sin cambios |
| Operaciones Git de escritura / instalación / reinicio / pruebas | ninguna | ninguna |

## 12. Limitaciones de las comprobaciones

- Fase exclusivamente documental: **no se ejecutaron pruebas** de código ni operativas (`NOT TESTED` por diseño).
- El aislamiento topológico (TI-1…TI-7) no se probó: sigue `NOT DEMONSTRATED`.
- La capacidad de sesión del host no existe hoy: G6-A queda `BLOCKED`; no se simuló ninguna verificación.
- La comprobación de coherencia es textual (búsqueda de `G6`, `D-UI-03`, `PA01`, `TI-1`, `TI-7`, «tercera ruta», «decisión de riesgo»), no semántica automática.
- El hash de este informe sólo puede fijarse después de escribirlo; se reporta en la respuesta de cierre.
