# Continuidad en una página

**Para quien llega nuevo** (otra sesión, otro agente, otra persona). Si algo de aquí contradice al código, manda
el código y hay que corregir este documento. Si contradice a [`DECISIONES.md`](DECISIONES.md), manda
`DECISIONES.md`. **Última revisión:** 2026-11-23.

**1 · Qué es.** Un motor de conocimiento y **memoria persistente por proyecto**: cualquier IA recupera el contexto
del trabajo en curso sin depender de un proveedor, de Hermes, de DSH ni de otro plugin. No es un buscador de
documentos (`D-CONT-01`).

**2 · Qué problema resuelve.** Que el conocimiento de cada proyecto viva en su almacén, se mantenga al día dentro
de los permisos y llegue al modelo con el contexto justo — sin mezclar proyectos independientes y sin obligar a
la persona a reexplicar el trabajo en cada sesión.

**3 · Decisiones aprobadas** (detalle y fuentes en [`DECISIONES.md`](DECISIONES.md)): visión y principios
(`D-CONT-01`); dos interfaces —panel administra, herramientas trabajan— (`D-CONT-02`); seis conceptos que no se
confunden, con **selección ≠ seguimiento ≠ autorización** (`D-CONT-03`); seguimiento independiente de la selección
(`D-CONT-04`); roadmap (`D-CONT-05`); doce invariantes (`D-CONT-06`); UX-2.2 como siguiente fase (`D-CONT-07`).
De antes siguen vigentes `O-PAR-1…6`, `C7`, `C8`, `CR-1` y las `D-PA6-*`. **Y desde el 2026-11-23** las seis de
UX-2.2: `D-UX22-01…06` — seguimiento **por perfil**, resolución **sólo para la sesión actual**, conflicto
workspace/`cwd` → **`scope-conflict`**, workspace **sin proyecto se puede seguir** pero no resuelve, `pa_selection`
es **selección visual**, y **seguimiento ≠ autorización**. **Y las siete de detalle** (`D-UX22-07…13`, todas
resolución **A**): identidad por **`path_key`** sin reasociación automática · dos ejes independientes (seguimiento y
disponibilidad) · reasociación **explícita y auditada** que no migra conocimiento · API humana con **CAS** y
`pa/1.5.0` · cinco acciones humanas auditables · **`session_scope` primero**, `scope-conflict` sólo para
seguido-vs-`cwd` · raíz limitada a **una ruta exacta**.

**4 · Arquitectura obligatoria.** Core host-agnostic: `lib/**` sin DSH/Cordis/Electron; el adaptador (`index.js`)
es la única pieza que habla con el Host; un almacén `rag.sqlite3` por ámbito; un registro por perfil; autorización
explícita y **no cacheada** (se relee antes de abrir y antes de devolver); máximo 8 ámbitos por consulta; cambios de
API aditivos. Nada de dependencias entre plugins.

**5 · Qué existe de verdad.** Siete herramientas (`ingest, search, context, get, list, forget, reindex`), registro
por perfil, resolución por sesión → `cwd` → workspace, raíces confiables, bibliotecas con grants, aprobaciones
humanas para `ingest`/`forget`/`reindex`, auditoría por registro y por ámbito, sincronización con `missing` sin
borrado, panel con cinco áreas, y **Workspace Discovery** (UX-2.1) de sólo lectura con `GET /pa/workspaces`
(`pa/1.4.0`). Con evidencia: [`ESTADO-IMPLEMENTACION.md`](ESTADO-IMPLEMENTACION.md) §2.

**6 · Fases completadas.** Sólo **UX-2.1 (Descubrimiento)**, con evidencia en
`plans/UX-02/UX-02-2.1-evidence-2026-11-23/`.

**7 · Fases pendientes.** **UX-2.2** (seguimiento manual con interruptor persistente): **decisiones documentales
resueltas (`D-UX22-01…13`) y especificación entregada ([`UX-22-TRACKING-SPEC.md`](UX-22-TRACKING-SPEC.md));
implementación no autorizada; autorización de raíz pendiente** · **UX-3** (modo fácil), **UX-4** (conocimiento
compartido), **UX-5** (contexto inteligente): aprobadas conceptualmente y **no autorizadas**. Orden y criterios:
[`ROADMAP-UX.md`](ROADMAP-UX.md).

**8 · Investigación en curso.** UX-2.2: auditoría entregada el 2026-11-23
(`plans/UX-02/UX-02-2.2-AUDIT-2026-11-23/INFORME-UX-2.2.md`), **especificación técnica** en
[`UX-22-TRACKING-SPEC.md`](UX-22-TRACKING-SPEC.md) y **propuesta de raíz** en
[`UX-22-ROOT-PROPOSAL.md`](UX-22-ROOT-PROPOSAL.md). **No implementado.** Bloqueo medido:
**`D-UX22-BLOCKER-01`** — `plugins-dhs-release` es un *git worktree* del mismo repositorio pero **otra raíz** para
RAG, y **no** está en `trusted_roots`. `D-UX22-13 = A` propone **una sola** raíz, exactamente

```
<REPO_ROOT>
```

al proyecto «LifeCode RAG». **Prohibido leer esa ruta** (ni ingerir, ni indexar, ni probar acceso) hasta que la
persona apruebe esa operación concreta. La propuesta **no** autoriza el worktree completo ni `plugins-dhs`.

**9 · Evidencia del estado.** `ESTADO-IMPLEMENTACION.md` (§2 existente, §5 deuda, §6 contradicciones, §7 lo que no
existe, §8 índice). Hechos que conviene saber de memoria: (a) hay **dos selecciones** —`session_scope` por sesión,
que es la que ven las herramientas, y `pa_selection` por perfil, que sólo ve el panel— y hoy coinciden por
casualidad; (b) `context` y `search` **escriben** métricas, y toda resolución escribe auditoría; (c) «Copiar ruta»
no copia y «Mostrar ruta» no cambia nada (P-01, P-02).

**10 · Autorizaciones.** Vigentes: ninguna ampliación de alcance. **No** están autorizadas la implementación de
UX-2.2, la publicación npm, la instalación o actualización en DSH, ni cambios en datos RAG reales, ni **leer,
ingerir o indexar** la ruta propuesta de `D-UX22-13` (`…\plugins-dhs-release\lifecode-rag`) mientras su operación
siga `PENDING`. Toda ejecución exige mandato propio; lo destructivo, autorización por hash exacto. Los actos de
documentación fueron **sólo documentales**.

---

**Cómo empezar a trabajar sin repetir errores:** lee esta página, luego `ESTADO-IMPLEMENTACION.md` §4-§7, luego
`DECISIONES.md` §3 (lo que está abierto). Parte del código real, cita archivo y línea, y separa *hecho* de
*propuesta*. Detente al final del alcance autorizado.
