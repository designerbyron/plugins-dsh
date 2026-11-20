# Evidencia K1 — índice

**Acto:** `HERMES-LCRAG-K1-END-TO-END-01` · **Fecha:** 2026-11-19
**Carpeta:** `lifecode-rag/eval/pa-ui-1/evidence/` (creada en este acto; el plugin no la publica: no está en `files`)

## Correspondencia con los entregables exigidos

| # | Entregable exigido | Fichero |
|---|---|---|
| 1 | Informe ejecutivo | `INFORME-EJECUTIVO.md` |
| 2 | Registro de cambios | `CAMBIOS.md` |
| 3 | Estado de cada criterio de aceptación | `CRITERIOS.md` |
| 4 | Resultados de pruebas | `PRUEBAS.md` + `node-test.txt` + `check.txt` + `hermetic.txt` |
| 5 | Evidencia de ausencia de llamadas reales | `SIN-ACCESO-REAL.md` |
| 6 | Capturas (si proceden sin reiniciar) | `CAPTURAS.md` — **ninguna**, con la razón |
| 7 | SHA-256 de creados y modificados | `HASHES.txt` |
| 8 | Diff de los cambios | `diffs/` (5 diffs unificados) |
| 9 | Defectos corregidos | `DEFECTOS-CORREGIDOS.md` |
| 10 | Pendientes y bloqueos | `PENDIENTES-Y-BLOQUEOS.md` |
| 11 | Trazabilidad requisito → implementación → prueba | `TRAZABILIDAD.md` |

## Anexos

| Fichero | Contenido |
|---|---|
| `G3-AMENDMENT.md` | Enmienda de G3 aplicada: justificación, X-R-01 y X-R-02 |
| `before/` | Copias **verbatim** de los 5 ficheros antes del cambio (`.txt` para no entrar en el gate de red) |
| `after/` | Copias verbatim después del cambio |
| `diffs/` | Diferencias unificadas de los 5 ficheros |

## Estado en una línea

K1-A y K1-B **implementados y probados en local** (305/305, hermético intacto); montaje en el anfitrión
**NO PROBADO** por prohibición de reinicio; gates de seguridad **intactos**.
