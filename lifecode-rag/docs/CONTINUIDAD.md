# LifeCode RAG — visión y continuidad del producto

**Estado:** fuente de continuidad · **Fecha:** 2026-11-24 · **Versión del producto:** paquete `1.5.11` (construido en el árbol de trabajo, **no publicado**), contrato de la API del panel `pa/1.5.0`
**Ámbito:** decisiones de producto, conceptos, invariantes y mapa documental. **No** es la especificación técnica:
para eso están [`PROJECT-AWARE-ARCHITECTURE.md`](PROJECT-AWARE-ARCHITECTURE.md) y los contratos enlazados al final.

> Este documento existe para que **otra sesión, otro agente o otra persona** entienda en cinco minutos qué es
> LifeCode RAG, qué está decidido, qué está implementado y qué no, sin repetir investigaciones ni reinterpretar
> acuerdos. Cuando aquí diga «aprobado», la fuente es el registro de decisiones
> ([`DECISIONES.md`](DECISIONES.md)); cuando diga «existe», la evidencia está en
> [`ESTADO-IMPLEMENTACION.md`](ESTADO-IMPLEMENTACION.md).

---

## 1. Qué es LifeCode RAG

**Un motor de conocimiento y memoria persistente por proyecto**, para que cualquier agente o IA recupere el
contexto relevante del trabajo en curso **sin depender de un proveedor de IA, de Hermes, de DSH ni de otro plugin**.

El objetivo **no** es buscar documentos. LifeCode RAG debe:

| # | Debe | Estado |
|---|---|---|
| 1 | Mantener conocimiento **independiente por proyecto** | implementado (un almacén por ámbito) |
| 2 | Conservar evolución, decisiones, documentación y contexto de cada proyecto | implementado (fuentes + historial + auditoría) |
| 3 | **Reconocer** los espacios de trabajo en los que se trabaja | implementado en lectura (UX-2.1) |
| 4 | Permitir **seguimiento persistente** de los proyectos | **aprobado, no existe** (UX-2.2: `D-UX22-01…06`, especificación entregada) |
| 5 | Mantener el conocimiento actualizado **dentro de los permisos** | implementado (sincronización con presupuesto) |
| 6 | Dar contexto relevante a **cualquier IA** mediante sus herramientas | implementado (7 tools host-agnostic) |
| 7 | Evitar que el conocimiento de proyectos independientes se mezcle | implementado (aislamiento por almacén) |
| 8 | Permitir **compartir conocimiento** con relación explícita y autorizada | parcial: `libraries` + `grants` existen; sin UX (UX-4) |
| 9 | **Optimizar el contexto** para reducir recuperación y tokens | parcial: presupuesto y MMR; sin UX-5 |

**Principio central (decisión de producto, `D-CONT-01`):**

> LifeCode RAG debe convertirse en la **memoria persistente y contextual del entorno de trabajo**, no solamente
> en un buscador de documentos.

`HECHO` — Los puntos 1, 2, 5, 6 y 7 están respaldados por código: un `rag.sqlite3` por ámbito
(`lib/scope-stores.mjs`), auditoría por ámbito y por registro, siete herramientas en `lib/tools.mjs` y el prólogo
`withAuthorizedContext` (`lib/exec-context.mjs`). Detalle y rutas: `ESTADO-IMPLEMENTACION.md`.

## 2. Las dos interfaces (decisión `D-CONT-02`)

El producto tiene **dos superficies con responsabilidades distintas**, y no deben solaparse:

### 2.1 Interfaz humana — el panel (DSH)

Administra el **comportamiento y la organización** del conocimiento:

- visualizar los workspaces que el Host conoce;
- activar o desactivar el **seguimiento** con un interruptor Sí/No (UX-2.2, **no implementado**);
- administrar proyectos de conocimiento y sus asociaciones con workspaces;
- administrar autorizaciones (raíces confiables y lectura);
- administrar **áreas de conocimiento compartido** (UX-4);
- configurar el **modo fácil** (UX-3);
- consultar estados, actividad y resultados del seguimiento.

`D-CONT-02` incluye una restricción: **el panel no duplica las herramientas de las IA.** Su trabajo es gobernar,
no buscar.

### 2.2 Interfaz de agentes — las siete herramientas

`ingest` · `search` · `context` · `get` · `list` · `forget` · `reindex` (`lib/tools.mjs`).

- **No** se reemplazan ni se multiplican sin necesidad técnica demostrada (`D-CONT-02`).
- El objetivo de las fases UX es que **estas mismas** herramientas trabajen mejor: mejor resolución del ámbito,
  mejor organización del conocimiento y del contexto.
- Cualquier IA compatible debe poder usarlas **sin DSH ni Hermes**.

## 3. Conceptos que no se confunden (`D-CONT-03`)

| Concepto | Qué es | Dónde vive | Qué **no** es |
|---|---|---|---|
| **Workspace** | espacio de trabajo detectado o abierto en DSH; *dónde* se trabaja | registro del Host (no del plugin) | no es un proyecto de conocimiento |
| **Proyecto de conocimiento** | unidad lógica que conserva la memoria persistente | `projects` del registro del perfil | no es una carpeta |
| **Seguimiento** | decisión de administrar un workspace como fuente de trabajo de un proyecto | **aprobado** (`D-UX22-01…06`), **no existe** en código (UX-2.2) | no es selección, no es permiso |
| **Autorización** | permiso explícito y verificable sobre raíces, fuentes o contenidos | `roots` (`state='authorized'`), `meta.trusted_roots`, `grants` | no se hereda por cercanía ni por seguimiento |
| **Indexación** | incorporar o actualizar información en el conocimiento | `sources`/`chunks`/`vectors` del almacén del ámbito | no es descubrimiento (descubrir no lee documentos) |
| **Selección de proyecto** | proyecto que una persona o sesión usa **en la interfaz** | `session_scope` (por sesión) y `pa_selection` (por perfil) | **no** habilita seguimiento |

Reglas asociadas, todas aprobadas:

1. **Selección ≠ seguimiento.** Seleccionar un proyecto no lo sigue ni lo deja de seguir.
2. **Seguimiento ≠ autorización.** Seguir un workspace no concede lectura, indexación ni escritura.
3. **Detección ≠ seguimiento.** Descubrir un workspace no lo sigue, salvo en modo fácil y con autorización válida.
4. **Cerrar un workspace no borra** su conocimiento ni elimina su seguimiento persistente.
5. **Autorizar o seguir un workspace no autoriza sus subcarpetas**; las fronteras de workspaces anidados se
   conservan.

`HECHO` — Hoy la selección existe en **dos almacenes que no se comunican**: `session_scope` (por sesión, la que
leen las herramientas) y `pa_selection` (por perfil, la que lee el panel). Está documentado con archivos y líneas
en `ESTADO-IMPLEMENTACION.md` §4. Es la razón principal de que UX-2.2 no pueda ser «un campo más en la selección».

## 4. Invariantes arquitectónicos (permanentes, `D-CONT-06`)

1. El **Core** es host-agnostic.
2. `lib/**` **no** depende de DSH, Cordis ni Electron.
3. La integración con DSH vive en un **adaptador opcional** (`index.js`).
4. LifeCode RAG **funciona sin DSH**.
5. LifeCode RAG **no depende** de LifeCode Skill Center ni de otros plugins.
6. Los plugins LifeCode conservan **independencia de código, estado y persistencia**.
7. Las integraciones entre plugins se hacen por **contratos públicos y adaptadores explícitos**.
8. La **autorización es explícita y verificable** (no se cachea; se relee antes de abrir y antes de devolver).
9. Las **fronteras de workspaces anidados** se conservan.
10. **Ninguna automatización amplía permisos** de forma implícita.
11. Las operaciones que **alteran conocimiento** respetan los controles de autorización existentes.
12. Los cambios de API son **compatibles y aditivos** cuando corresponda.

`HECHO` (verificación de los invariantes 1-4 hoy): ningún módulo de `lib/tools.mjs`, `lib/exec-context.mjs`,
`lib/resolve.mjs`, `lib/sessions.mjs`, `lib/selection.mjs` ni `lib/scope-ops.mjs` importa del harness; los
servicios entran como parámetros. El único módulo que conoce el Host es `lib/harness-workspaces.mjs`, y lo recibe
por parámetro. El adaptador es `index.js`.

## 5. Fases (resumen; detalle en [`ROADMAP-UX.md`](ROADMAP-UX.md))

| Fase | Nombre | Estado |
|---|---|---|
| UX-2.1 | Descubrimiento | **completada** (con evidencia) |
| UX-2.2 | Seguimiento manual (toggle persistente) | **decisiones documentales resueltas (`D-UX22-01…13`) · implementación no autorizada · autorización de raíz pendiente** |
| UX-3 | Modo fácil | aprobada conceptualmente, **no autorizada** |
| UX-4 | Conocimiento compartido | aprobada conceptualmente, **no autorizada** |
| UX-5 | Contexto inteligente | aprobada conceptualmente, **no autorizada** |

`D-CONT-05` fija el roadmap; `D-CONT-07` fija que **UX-2.2 es la siguiente fase** y que no se declara fase
completada sin evidencia.

## 6. Mapa documental (qué documento manda en qué)

| Pregunta | Documento |
|---|---|
| Qué es el producto y por qué | **este documento** |
| Qué está decidido y con qué estado | [`DECISIONES.md`](DECISIONES.md) |
| Qué fases hay y en qué orden | [`ROADMAP-UX.md`](ROADMAP-UX.md) |
| Qué existe realmente y con qué evidencia | [`ESTADO-IMPLEMENTACION.md`](ESTADO-IMPLEMENTACION.md) |
| Cómo se implementa el seguimiento (UX-2.2) | [`UX-22-TRACKING-SPEC.md`](UX-22-TRACKING-SPEC.md) |
| Qué raíz se propone, con qué límite y qué operación se pide aprobar | [`UX-22-ROOT-PROPOSAL.md`](UX-22-ROOT-PROPOSAL.md) |
| Resumen de una página para empezar | [`CONTINUIDAD-BREVE.md`](CONTINUIDAD-BREVE.md) |
| Arquitectura técnica y decisiones PA | [`PROJECT-AWARE-ARCHITECTURE.md`](PROJECT-AWARE-ARCHITECTURE.md) |
| Modelo de datos y rutas | [`PROJECT-AWARE-DATA-CONTRACT.md`](PROJECT-AWARE-DATA-CONTRACT.md) |
| Sesión y selección | [`PROJECT-AWARE-SESSION-CONTRACT.md`](PROJECT-AWARE-SESSION-CONTRACT.md) |
| Errores y su mapa HTTP | [`PROJECT-AWARE-ERROR-CONTRACT.md`](PROJECT-AWARE-ERROR-CONTRACT.md) |
| Contrato de las siete herramientas | [`CONTRATO-v0.1.md`](CONTRATO-v0.1.md) |
| API del panel | [`PA-UI-0-API-CONTRACT.md`](PA-UI-0-API-CONTRACT.md) |

**Regla de precedencia:** ante contradicción, manda el **contrato** para el comportamiento observable, y
`DECISIONES.md` para el rumbo del producto. Si un contrato contradice una decisión aprobada, se registra como
contradicción en `ESTADO-IMPLEMENTACION.md` §6 y se resuelve con una decisión nueva — nunca editando el pasado.

## 7. Cómo debe trabajar una sesión nueva

1. Leer [`CONTINUIDAD-BREVE.md`](CONTINUIDAD-BREVE.md).
2. Consultar [`ESTADO-IMPLEMENTACION.md`](ESTADO-IMPLEMENTACION.md) antes de afirmar que algo existe.
3. Consultar [`DECISIONES.md`](DECISIONES.md) antes de proponer un cambio de rumbo.
4. Partir del **código real**; citar archivo y línea.
5. Distinguir **HECHO VERIFICADO** · **INFERENCIA** · **PROPUESTA** · **PENDIENTE DE VERIFICACIÓN**.
6. No presentar pruebas con dobles como pruebas contra el Host real.
7. No declarar implementado lo que sólo está diseñado.
8. Detenerse al terminar el alcance autorizado.

**Pendiente de decisión (no ejecutado):** enlazar estos cinco documentos desde `README.md` y añadirlos a `files`
de `package.json` los haría viajar en el paquete publicado. No se hizo aquí para no cambiar el manifiesto de
publicación dentro de un acto documental; queda como decisión aparte (`PENDIENTE`).

---

## 8. Estado del corte 1.5.11 (2026-11-24) — candidato de cierre funcional

**Qué es:** el corte que cierra la aceptación funcional de UX-2.2. No abre producto nuevo.

- **Aceptación ejecutada en el Host real** (Electron 44.7.0 / DSH 0.2.2-rc.5, perfil del laboratorio,
  proyecto sintético `prj_01M85YFJDMX4QWHWM8ZETM191P` con raíz en `rc150-lab\fixtures`): las siete
  herramientas se ejercitaron de verdad en una sesión con `DeepSeek-V4.1-Flash` — `ingest` (2 documentos),
  `list` (`relUri` y `sha256` iguales a disco), `search` (chunkKey + rrf + snippet), `context` (citas y
  fuentes), `get` (fuente + fragmentos), `reindex` (`rebuiltChunks:2`, 0 duplicados, con aprobación
  humana) y `forget` (fuera del índice, fichero intacto, con la aprobación del propietario; restituido).
  Los ficheros de origen conservan su `sha256` y su `mtime`. Evidencia: `rc159-artifacts/FASE-D.md`.
- **Cuatro hallazgos cerrados en 1.5.11:** F-1 (selector de proyecto en vez de «sin conexión»), F-2
  («Reintentar» hace una petición nueva), F-3 (área del enlace-acción 36×36 / 44×44) y F-4 (`get` acepta
  el `chunkKey` de `search`). Detalle y pruebas: [`ESTADO-IMPLEMENTACION.md`](ESTADO-IMPLEMENTACION.md) §11.
- **Artefacto:** 1.5.11, instalado **sólo** en el laboratorio. **No publicado en npm, sin push.** El
  perfil personal del propietario (`~/.dsh`) no se toca: la puerta hermética lo mide en cada corte.
- **Siguiente paso si alguien retoma esto:** no abrir UX-3/UX-4/UX-5 (siguen NO AUTORIZADAS). Lo que queda
  es decisión del propietario sobre publicar 1.5.11 en npm.

**Punto de reanudación detallado (fuera del árbol):** `C:\xampp\htdocs\rc1511-artifacts\CONTINUIDAD-1.5.11.md`
— estado del laboratorio medido al cerrar, hashes, qué queda pendiente y las trampas pagadas en la sesión
(caché de npm por `name@version`, intercepción CDP para fallos reales, origen `dsh-app://` de la API del panel).
