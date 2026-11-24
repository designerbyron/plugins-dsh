# LifeCode RAG — roadmap UX (UX-2.1 → UX-5)

**Origen:** `D-CONT-05` y `D-CONT-07` ([`DECISIONES.md`](DECISIONES.md)). Fechas: 2026-11-23.
**Regla:** una fase **no** se declara completada sin evidencia en [`ESTADO-IMPLEMENTACION.md`](ESTADO-IMPLEMENTACION.md).

| Fase | Nombre | Objetivo | Estado |
|---|---|---|---|
| **UX-2.1** | Descubrimiento | Descubrir y **visualizar** los workspaces del Host, sin tocarlos | **COMPLETADA** |
| **UX-2.2** | Seguimiento manual | Interruptor Sí/No **persistente** por workspace, independiente de la selección | **CERRADA (2026-11-24)**: corte **1.5.11**, 714/714 pruebas, check y hermético verdes, auditoría del TAR 17/17, aceptación funcional en el Host real con las siete herramientas (`rc159-artifacts/EXPEDIENTE-ACEPTACION-UX22-1.5.9.md` y `rc159-artifacts/FASE-D.md`). Hallazgos F-1…F-4 corregidos y probados |
| **UX-3** | Modo fácil | Automatizar el seguimiento **autorizado** de workspaces abiertos | APROBADA conceptualmente · NO AUTORIZADA |
| **UX-4** | Conocimiento compartido | Conectar proyectos **sin fusionar** memorias | APROBADA conceptualmente · NO AUTORIZADA |
| **UX-5** | Contexto inteligente | Entregar contexto optimizado a cualquier IA | APROBADA conceptualmente · NO AUTORIZADA |

---

## UX-2.1 · Descubrimiento — COMPLETADA

**Alcance entregado:** `GET /pa/workspaces` (contrato `pa/1.4.0`, aditivo), proyección pura con identidad por
`pathKey`, relación `exact`/`inside`/`none` por la raíz más específica, estados `ok`/`missing`/`unknown`,
`live: null` cuando no se pudo mirar, tope 200, `source:'none'` con motivo, y vista de **sólo lectura** en el panel
con refresco al entrar y «Actualizar».

**Evidencia:** `ESTADO-IMPLEMENTACION.md` §1-2. **No** incluye escritura, autorización, indexación ni seguimiento
(`D-CONT-07`).

**Deuda conocida (no bloquea la fase):** P-03 — «Mostrar ruta» y «Copiar ruta» no cumplen su promesa; P-04 — el
texto de Diagnóstico infravalora lo que la API ya expone. Ver `ESTADO-IMPLEMENTACION.md` §5.

---

## UX-2.2 · Seguimiento manual — DECISIONES APROBADAS · ESPECIFICACIÓN ENTREGADA

**Decisiones de producto aprobadas** (`D-UX22-01…06`, ver [`DECISIONES.md`](DECISIONES.md) §1.1): seguimiento por
**perfil**; resolución **sólo para la sesión actual**; conflicto workspace/`cwd` → **`scope-conflict`**; workspace
**sin proyecto se puede seguir** pero no resuelve; `pa_selection` queda como **selección visual**; seguimiento y
autorización **independientes**.

**Especificación técnica:** [`UX-22-TRACKING-SPEC.md`](UX-22-TRACKING-SPEC.md) — vocabulario y estados, identidad y
reconciliación, asociación, precedencia formalizada, registro v3 propuesto, API propuesta, auditoría, interfaz,
mapa de aceptación (15 criterios → pruebas), plan de implementación por pasos y `BLOCKER-01`.

**Implementación:** **NO AUTORIZADA.** Requiere mandato propio y específico, con su plan y su hash.

**Objetivo:** que la persona **habilite o deshabilite** el seguimiento de cada workspace desde **Workspaces**, con
un interruptor Sí/No, y que esa decisión **persista** entre sesiones y reinicios.

**Comportamiento esperado (mandato §6)**
- cada workspace detectado puede estar seguido o no;
- la decisión persiste;
- se puede pausar, reanudar y retirar;
- el seguimiento **no** autoriza lectura ni indexación;
- la asociación workspace → proyecto es **explícita** cuando no pueda determinarse con seguridad;
- el cierre temporal del workspace no borra su estado;
- un workspace ausente, movido o eliminado se maneja **sin perder silenciosamente** su conocimiento;
- los workspaces anidados respetan las fronteras de autorización;
- seguir un workspace **no** autoriza sus subcarpetas.

**Diseño propuesto (no implementado)** — resumen; detalle en el informe de auditoría:
- tabla `workspace_tracking` en el registro del perfil (**v3 aditiva**), identidad por `path_key`, `project_id`
  opcional, `state` (`on`/`off`/`paused`), `bound_by`, `last_status`;
- un **escalón nuevo** en `resolveScope` entre la selección explícita y el `cwd`: «workspace seguido de la sesión»;
- `GET/PUT/DELETE /pa/tracking` (rutas **humanas**, tras la compuerta), y `/pa/workspaces` ampliado de forma aditiva;
- interruptor + filtros en la tabla de Workspaces, sin tocar la selección.

**Dependencias:** UX-2.1 (hecha) · registro v2 (hecho) · `trusted-roots` (hecho) · `mostSpecific` (hecho).

**Riesgos:** seguimiento leído como permiso · identidad por ruta ante rename/move · anidados · ruido de contexto ·
escritura no auditada · desfase con `pa_selection`.

**Decisiones de detalle resueltas** (`D-UX22-07…13 = A`, ver [`DECISIONES.md`](DECISIONES.md) §1.2): identidad por
`path_key` sin reasociación automática; dos ejes (seguimiento y disponibilidad) independientes; reasociación explícita
y auditada sin migrar conocimiento; API humana con CAS (`pa/1.5.0`); cinco acciones humanas auditables; precedencia
con `session_scope` primero y `scope-conflict` sólo para seguido-vs-`cwd`; y raíz limitada exactamente a
`<REPO_ROOT>`.

**Único pendiente de autorización:** la **operación** de raíz de `D-UX22-13` — propuesta de 10 puntos en
[`UX-22-ROOT-PROPOSAL.md`](UX-22-ROOT-PROPOSAL.md) (`D-UX22-13 (operación)` / `D-UX22-BLOCKER-01`, ambos `PENDING`).
Sin esa aprobación **no se lee nada** bajo esa ruta.

**Criterios de aceptación propuestos**
1. El interruptor persiste y se lee tras reiniciar el host.
2. Alternarlo **no** crea ni modifica raíces, grants ni selección (prueba negativa explícita).
3. Las siete herramientas resuelven por el workspace seguido **sin** cambiar la selección del panel.
4. Un workspace `missing` no resuelve, informa y **no** pierde su fila.
5. Anidados: padre e hijo seguidos → gana la raíz más específica; sin fusión.
6. El aislamiento entre proyectos independientes sigue probado (no se mezcla conocimiento).
7. Toda escritura del seguimiento queda en `audit_registry` con `actor='human'`.
8. Suite hermética en verde y almacenes reales sin cambios.

**Fuera de alcance:** autorización implícita · ingesta o reindexado automático · seguimiento de workspaces nunca
abiertos · cambios en el motor de búsqueda.

---

## UX-3 · Modo fácil — APROBADA conceptualmente, NO AUTORIZADA

**Objetivo:** automatizar el seguimiento de los workspaces **abiertos o detectados**, reduciendo la administración
manual, **sin eliminar las decisiones de seguridad**.

**Comportamiento esperado:** detectar → reconocer los existentes → identificar asociación con proyecto → habilitar
seguimiento **sólo** con asociación y autorización válidas → pedir intervención humana ante ambigüedad o falta de
autorización → mantener el conocimiento dentro de los permisos → **no borrar** conocimiento al cerrar un workspace.
Si el usuario lo desactiva, el descubrimiento puede continuar pero el seguimiento vuelve a ser manual.

**Dependencias:** UX-2.2 cerrada (tabla, API, escalón de resolución, auditoría).

**Riesgos:** escrituras automáticas sin humano · ruido de contexto · privacidad (workspaces ajenos al trabajo) ·
confusión con la sincronización existente (`sync_state`).

**Decisiones necesarias:** qué significa «abierto» (¿`sessionIds` no vacío?) · cadencia de reconciliación · qué se
hace cuando hay dos workspaces abiertos de proyectos distintos · límite de seguimientos automáticos.

**Criterios de aceptación propuestos:** todo seguimiento automático es **reversible** y auditado con
`actor='host'`; sólo afecta a workspaces autorizados; se puede apagar por workspace y globalmente; desactivarlo
devuelve el control manual sin perder estado.

**Fuera de alcance:** indexar sin autorización · seguir workspaces que nunca se abrieron · sustituir UX-2.2.

---

## UX-4 · Conocimiento compartido — APROBADA conceptualmente, NO AUTORIZADA

**Objetivo:** capa lógica de conocimiento compartido entre proyectos **relacionados**, conservando memorias
independientes.

**Requisitos (mandato §8):** identidad propia · membresía explícita de proyectos · permisos definidos ·
procedencia conservada · referencias a conocimiento de otros proyectos · evitar duplicaciones · **no** mezclar
memorias privadas · una IA recupera **sólo** lo compartido autorizado.

**Invariante del mandato:** *compartir conocimiento **no** significa compartir bases de datos privadas, persistencia
interna, módulos ni dependencias entre plugins.*

**Lo que ya existe y se puede reutilizar:** `libraries` + `grants` (`project_id → library_id`, con
`revoked_at`, tope de 7 bibliotecas / 8 ámbitos), y la consulta ordenada proyecto-primero
(`lib/scope-ops.mjs:78`). **No** hay interfaz ni flujo de concesión en el panel.

**Dependencias:** UX-2.2 (para que el ámbito sea estable sin selección).

**Riesgos:** grants percibidos como fusión de memorias · duplicación de contenido · que un plugin dependa de otro.

**Criterios de aceptación propuestos:** un proyecto ve **sólo** lo concedido; revocar corta al instante (ya probado
en PA4); la procedencia del fragmento es visible; el conocimiento de un proyecto **no** aparece en otro sin grant.

**Fuera de alcance:** bases de datos compartidas entre plugins · herencia transitiva (prohibida por `O-PAR-3`).

---

## UX-5 · Contexto inteligente — APROBADA conceptualmente, NO AUTORIZADA

**Objetivo:** que **las mismas siete herramientas** entreguen contexto optimizado a cualquier IA.

**Orden conceptual de recuperación (mandato §9):** (1) conocimiento del proyecto actual → (2) conocimiento
compartido autorizado y pertinente → (3) fuentes adicionales autorizadas cuando hagan falta.

**Debe considerar:** workspace de origen cuando sea fiable · proyecto correspondiente · identidad y procedencia de
las fuentes · relevancia semántica · estado y actualidad del conocimiento · autorizaciones · relaciones compartidas ·
presupuesto de contexto y tokens.

**Reglas:** no mezclar proyectos independientes · ante contradicción entre fuentes, **conservar procedencia y
señalar el conflicto** (nunca resolverlo en silencio) · **no** depender del proyecto seleccionado en una interfaz ·
funcionar en integraciones externas y headless.

**Dependencias:** UX-2.2 (ámbito estable) · UX-4 (compartido con procedencia).

**Riesgos:** cambio de contrato · pérdida de citas verificables · latencia · sobre-recuperación.

**Criterios de aceptación propuestos:** contrato **aditivo** (v0.1 intacto); `context` sigue citando verificable;
ningún fragmento de un proyecto sin relación; el orden proyecto → compartido se respeta y se puede auditar.

**Fuera de alcance:** cambiar el motor de búsqueda o el formato de citas existente.

---

## Lo que este roadmap NO autoriza

Ninguna de estas fases está autorizada por este documento. `D-CONT-07` fija el orden y el estado; la ejecución de
cada una exige **mandato propio**, y el cierre de cada fase exige **evidencia**, no una captura ni un diseño.
