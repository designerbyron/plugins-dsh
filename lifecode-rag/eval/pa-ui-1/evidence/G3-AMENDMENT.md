# Enmienda documental de G3 — registro y justificación

**Acto:** `HERMES-LCRAG-K1-END-TO-END-01` · **Fase:** 1 · **Fecha:** 2026-11-19
**Documento modificado:** `lifecode-rag/docs/PA-UI-0-ACCEPTANCE.md`

---

## 1. Huella del cambio

| Momento | Bytes | SHA-256 |
|---|---|---|
| Antes | 22 268 | `d32a4912f6b75b8b97c4b7e82790fd3067bf759a96d867265a07932ccdd547f9` |
| Después | 24 568 | `aa7fe63598146360ed4dad8a9c736491336da08f543968a25199f34ed718de30` |

Diff unificado completo: `diffs/PA-UI-0-ACCEPTANCE.md.diff` (48 líneas, 4 hunks). Ningún otro criterio se tocó:
G4, G5, G6, G6b, G7, G8 y §N conservan su texto.

## 2. Los cuatro cambios

1. **Cabecera · referencia al contrato:** `revisión 2` → `revisión 3` (ver §3).
2. **Cabecera · revisiones:** `PA-UI-0.1 y PA-UI-0.2` → `PA-UI-0.1, PA-UI-0.2 y K1 (enmienda de G3)`.
3. **Cabecera · nueva nota K1:** declara qué cambia y qué **no** (G5, G6, G6b, PA01 y D-UI-03 intactos).
4. **§L · G3 reescrito + subsección «G3 — precisión de la enmienda K1»:** separa cinco conceptos —
   disponibilidad del bundle, `exports["./client"]` (requisito), `dsh.client` (declaración),
   `dsh.client.inject` (orden, no requisito) y activación/inicialización (se mide en G4) — y cita la
   evidencia del host.

## 3. X-R-01 — revisión 2 vs 3: resuelta con evidencia, no por elección

La contradicción era real: la cabecera de `PA-UI-0-ACCEPTANCE.md` citaba el contrato como «revisión 2»,
mientras el contrato se declara «revisión 3» y `PA-UI-0-GAPS.md` §10 habla de «revisión 3».

**Evidencia examinada:**

| Fuente | Qué dice |
|---|---|
| `PA-UI-0-API-CONTRACT.md` línea 4 | «`pa-ui/0.1.0-draft` (revisión **3**)» — cabecera del propio contrato |
| `PA-UI-0.2-REVIEW.md` §3 «Secciones modificadas» | el contrato cambió su **cabecera a «revisión 3 + banner 0.2»** en PA-UI-0.2 |
| `PA-UI-0.2-REVIEW.md` §8 «Integridad documental» | «Los tres documentos citan la misma versión (`pa-ui/0.1.0-draft`, revisión **3**)» |
| `PA-UI-0-GAPS.md` §10 | «este documento + contrato + aceptación, revisión **3**» |
| `PA-UI-0.1-REVIEW.md` línea 151 | dice «revisión 2», pero es un registro **histórico** de PA-UI-0.1 |

**Conclusión:** cuando PA-UI-0.2 subió el contrato a revisión 3, la cabecera de aceptación quedó sin
actualizar (su nota de revisión sí se actualizó). La referencia correcta es **3**; `PA-UI-0.1-REVIEW.md`
conserva «revisión 2» porque describe el estado de PA-UI-0.1 y se mantiene como historial.

**Lo que no se tocó:** `PA-UI-0-ACCEPTANCE.md` línea 238 («contrato cerrado en revisión 2») se deja como
está: describe **cuándo** se cerró la regla de `expectedRevision`, no la versión vigente. Reescribirla
habría borrado historial.

## 4. X-R-02 — G3 exigía `dsh.client.inject`; el anfitrión no

**Resuelto por la enmienda.** El texto anterior mezclaba dos categorías. La evidencia (host 0.2.2-rc.5,
`@deepseek-ai/dsh-client-modules`):

- `exports["./client"]` es **requisito**: sin él el compositor lanza
  `client-modules: <paquete> declares dsh.client but exports no "./client" bundle`.
- `dsh.client.inject` son «package rows whose factories must arrive before this row materializes»: **orden
  de activación**, opcional (`inject?: string[]`).

El gate nuevo exige lo primero y trata lo segundo como condicional. Además, `tools/check.mjs` **prohíbe**
declarar `dsh.client.inject` mientras no exista una dependencia real de slot: declarar un paquete no
montado deja el plugin en `pending`.

## 5. Verificación

| Comprobación | Resultado |
|---|---|
| Diff acotado a 4 hunks (cabecera y §L) | sí (`diffs/PA-UI-0-ACCEPTANCE.md.diff`) |
| G4/G5/G6/G6b/G7/G8 sin cambios | sí (no aparecen en el diff) |
| Estados de seguridad sin cambios | sí: PA01 `BLOCKED`, D-UI-03 `PENDING`, G6 `BLOCKED`, Ruta A `BLOCKED`, Ruta B `NOT DEMONSTRATED` |
| Hash antes/después registrado | sí (§1) |
| Documento aplicado, no propuesto | sí: el fichero del repositorio contiene el texto nuevo |

## 6. Pendiente documental (no aplicado)

`PA-UI-0-GAPS.md` cabecera (línea 4) también cita «revisión 2». **No se modificó**: el encargo lo excluye
salvo necesidad imprescindible, y no lo es para G3. Propuesta para un acto documental futuro: alinear esa
cita y, de paso, revisar si GAP-01 debe mencionar `dsh.client.inject` como descriptivo o eliminarlo. No se
aplica aquí.
