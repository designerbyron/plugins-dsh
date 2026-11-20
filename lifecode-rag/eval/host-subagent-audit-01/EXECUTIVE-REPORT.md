# Informe ejecutivo — aceptación en host y auditoría de acceso de subagentes

**Acto:** `HERMES-LCRAG-HOST-AND-SUBAGENT-AUDIT-01` · **Proyecto:** LifeCode RAG · **Fecha:** 2026-11-19
**Modo:** auditoría y diseño. Sin implementación, sin reinicio, sin datos reales.

---

## Resultado en tres frases

1. **Son nueve secciones, no diez**: nueve pestañas y una pantalla subordinada (detalle de fuente) que no es
   ruta ni pestaña. La cifra «diez vistas» de la documentación contaba esa pantalla; queda reconciliada y con
   errata propuesta.
2. **El rediseño está montado en el host** con las nueve pestañas visibles y coherentes con el render local;
   consola, DOM y desmontaje siguen **no inspeccionados**.
3. **En este perfil, un subagente no puede existir**: el bundle web desactiva las tres herramientas de
   delegación. Si se habilitaran, un hijo vería las siete herramientas RAG (registro global) y podría leer,
   pero `forget`/`reindex` seguirían rechazados por la política de aprobación fijada a `never`.

## Hallazgos que cambian decisiones

| # | Hallazgo | Evidencia |
|---|---|---|
| H-1 | El bundle `dsh-web-app` **desactiva** `tool-subagent`, `tool-subagent-fork` y `tool-subagent-control` | `dsh-web-app/cordis.patch.yml` §586-601 |
| H-2 | Los backends `spawn` y `fork` **sí** están montados en el host (`dsh-base`), con profundidad por defecto 1 | `dsh-base/cordis.patch.yml` §364-409; `dsh-subagent/README.md` |
| H-3 | Las herramientas del plugin se registran en el **registro global** de herramientas y las hereda cualquier agente del proceso | `index.js` §49; `dsh-tools/README.md` §89 |
| H-4 | Un hijo recibe el **preset del padre** (o el host), no sus restricciones locales | `child-agent.ts` `applyChildComposition`; `spawn/README.md` |
| H-5 | La política de aprobación del hijo se fija a **`never`**, que rechaza toda petición antes del despacho | `child-agent.ts` `captureDelegatedPolicyOverrides`; `dsh-user-approval/README.md` §37, §79 |
| H-6 | La identidad que usan las herramientas es `agent.id` (SessionId del host), no un dato del modelo | `lib/session-identity.mjs` |
| H-7 | No hay `agent-preset-registry` en este perfil: un hijo usaría la composición del host | `dsh-base/cordis.patch.yml` (sin filas de preset); `~/.dsh/profiles/desktop/cordis.patch.yml` |

## Estados finales

```
VIEW COUNT: 9 SECCIONES + 1 PANTALLA SUBORDINADA (10 pantallas renderizables)
HOST POST-REDESIGN: VERIFIED HOST (9 vistas) · CONSOLE/DOM: NOT TESTED
SUBAGENT PROVIDERS INSTALLED: spawn, fork · ENABLED IN DESKTOP TOOLS: NONE
RAG TOOLS FOR CHILDREN: NOT APPLICABLE (no child creatable) · IF ENABLED: VISIBLE, READ ALLOWED, WRITE APPROVAL-BLOCKED
PA01: BLOCKED · D-UI-03: PENDING HUMAN DECISION · G6: BLOCKED
ROUTE A: BLOCKED · ROUTE B: NOT DEMONSTRATED · ROUTE C: NOT ACCEPTED
GAP-20: OPEN / DOCUMENTED HOST LIMITATION · Q-06 / TI-7: PENDING DESIGNATION
```

## Lo que este acto no hizo

- No habilitó delegación ni acceso RAG para subagentes.
- No modificó perfiles, `cordis.patch.yml`, código, pruebas ni documentación histórica.
- No reinició el host ni abrió el panel por su cuenta.
- No ejecutó operaciones RAG ni consultó almacenes reales.

Parada. La recomendación de arquitectura queda en `RECOMMENDATION.md` y **no** está autorizada.
