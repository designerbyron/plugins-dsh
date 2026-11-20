# Pendientes y bloqueos

**Acto:** `HERMES-LCRAG-K1-END-TO-END-01` · **Fecha:** 2026-11-19
**Regla:** lo que no se midió se queda aquí, no se disuelve en el informe.

---

## 1. Bloqueos (lo que impide cerrar un criterio)

| # | Bloqueo | Qué impide | Qué lo desbloquea | Responsable |
|---|---|---|---|---|
| P-1 | **Reiniciar el host está prohibido** en esta autorización | verificar que el anfitrión compone el bundle y monta la fila (`A-2`, `A-4`, `A-5`, `A-8`) | autorización expresa de un reinicio controlado + evidencia de `__DSH_BOOT__.entries` y DOM | propietario |
| P-2 | G5 exige una sesión real y el slot de conversación | probar que el `sessionId` llega (direccionamiento, no identidad) | prueba en host con captura, en un acto autorizado | propietario |
| P-3 | K1-C es un gate del anfitrión | cualquier dato real | Ruta A demostrada o Ruta B (TI-1…TI-7) | propietario |
| P-4 | Q-06 / TI-7 sin responsable | que la Ruta B pueda declararse `DEMONSTRATED` | designación nominal | propietario |
| P-5 | El laboratorio DSH existe pero no tiene el plugin | usar un perfil de laboratorio para K1 (Q-04) | acto de aprovisionamiento del perfil del laboratorio | propietario |
| P-6 | `eval/` no está versionado | que la evidencia sobreviva a un borrado del árbol | decisión Q-07 + operación Git autorizada | propietario |

## 2. Pendientes documentales (propuestos, no aplicados)

| # | Pendiente | Estado |
|---|---|---|
| D-1 | `PA-UI-0-GAPS.md` cabecera cita «revisión 2» | propuesta registrada en `G3-AMENDMENT.md` §6; no aplicada |
| D-2 | GAP-01 describe `dsh.client.inject` como si fuera requisito | podría armonizarse en la misma revisión futura de GAPS |
| D-3 | `README.md` cita `docs/KNOWN-LIMITATIONS.md`, que no existe | deuda previa, no tocada |
| D-4 | `README.md` no indexa los documentos `PA-UI-0.*` ni la carpeta de evidencia | deuda previa |

## 3. Pendientes de producto (fuera de K1)

| # | Pendiente | Nota |
|---|---|---|
| P-7 | Modo `live` y API `/lifecode-rag/ui/api` | requieren G6 y K1-C; hoy no existen |
| P-8 | `ui.read` append-only fail-closed | `SECURITY` (G6b); no se escribe desde el panel |
| P-9 | Estados de carga reales | sólo tienen sentido con peticiones reales; en fixtures se declaran no aplicables |
| P-10 | Auditoría de accesibilidad con lector de pantalla | la actual es estructural |

## 4. Lo que **no** es un pendiente

- La suite: 305/305 en verde.
- El manifiesto: G3 verificado localmente por el gate.
- La ausencia de red en fixtures: probada con espías y con la puerta hermética.
- Los gates de seguridad: intactos a propósito, no «pendientes de arreglo».
