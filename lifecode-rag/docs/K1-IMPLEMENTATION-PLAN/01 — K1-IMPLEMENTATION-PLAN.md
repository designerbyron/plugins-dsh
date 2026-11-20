# K1 — Plan de implementación de la interfaz Project-Aware de LifeCode RAG

**Tarea:** HERMES-LCRAG-K1-PLAN-01 · **Proyecto:** LifeCode RAG (`lifecode-rag/`)
**Host de referencia:** DeepSeek Harness **0.2.2-rc.5** (versión leída del `package.json` incluido en `resources/app.asar`)
**Modo:** planificación documental y lectura de repositorios · **Fecha:** 2026-11-19
**Autorización:** planificación K1 aprobada por el propietario · **Implementación: NO AUTORIZADA**
**Estado de los bloqueos:** PA01 `BLOCKED` · D-UI-03 `PENDING HUMAN DECISION` · G6 `BLOCKED` · Ruta A `BLOCKED` · Ruta B `NOT DEMONSTRATED`

> Este documento no implementa nada. Define qué se hará, en qué orden, con qué pruebas y con qué
> condiciones de parada. Ninguna afirmación de este plan sustituye a una medición de la fase que la
> implemente.

---

## 1. Resumen ejecutivo

K1 no es "hacer una interfaz". Es separar tres cosas que hoy están mezcladas en una sola frase:

1. **K1-A — que el cliente exista de verdad en el host.** Hoy `client.js` (751 líneas, 43 262 B) está en el
   árbol, pero **no puede cargarse**: el `package.json` declara `dsh.client` y no exporta `./client`, y el
   registro de slots usa una forma que ya no es la del anfitrión. Medido, no supuesto (§2.3).
2. **K1-B — que la interfaz muestre el modelo Project-Aware con datos controlados.** El contrato
   `pa-ui/0.1.0-draft` ya define nueve rutas, esquemas, errores y límites. K1-B se construye **contra
   fixtures**, sin abrir un solo almacén real, y muestra como limitación visible todo lo que el backend
   todavía no expone.
3. **K1-C — que exista una API con identidad y autorización.** Es un **gate**, no una tarea de interfaz.
   Mientras PA01 siga `BLOCKED`, el panel puede montarse y mostrar fixtures sintéticos, y **no** puede
   servir datos reales del RAG. Montar el panel **no** es tener una API segura.

El orden no es negociable: K1-A es requisito de K1-B (sin módulo cargado no hay dónde montar nada), y
K1-C no se desbloquea con K1-A ni con K1-B, porque su bloqueo es del anfitrión, no del plugin.

---

## 2. Estado medido del entorno (gate de integridad, 2026-11-19T06:08Z)

### 2.1 Repositorio y worktrees

Las cuatro rutas que la tarea llama "repositorios" son **worktrees de un solo repositorio**; todas
declaran el mismo `git-common-dir`: `C:/xampp/htdocs/plugins-dhs/.git`.

| Worktree | Rama | HEAD | `git status --porcelain` |
|---|---|---|---|
| `plugins-dhs` | `fix/t45-4-r17-acceptance` | `b6c0cd24621c8bc3282185d1821c60b7956f8a83` | 1153 entradas (25 ` M` + 1128 `??`) |
| `plugins-dhs-auto` | `feature/auto-learning-trigger` | `c2473a555cbd10764f8e4387e85b90c442610192` | 0 |
| `plugins-dhs-integracion` | `feature/learning-visual-integration` | `c2473a555cbd10764f8e4387e85b90c442610192` | 27 entradas |
| `plugins-dsh-lsc-pack` | `publish/lifecode-skill-center` | `0c73169619b528aca620971f2eb7ecf6a59d31c3` | 44 entradas |

- Sin `MERGE_HEAD`, `rebase-merge`, `rebase-apply` ni `CHERRY_PICK_HEAD`; `git stash list` vacío.
- El conteo de "entradas" no es el de ficheros: `--untracked-files=all` da **2545** entradas antes de este
  trabajo (25 ` M` + **2520** ficheros sin seguimiento), frente a las 1153 de `status` normal, porque un
  directorio sin seguimiento colapsa en una sola línea. Tras crear esta carpeta: **2553** entradas
  (25 ` M` + 2528 `??`), y el conteo normal **sigue en 1153** porque `lifecode-rag/` ya era una entrada.
- Procesos vivos del anfitrión en el momento de la medición: `DeepSeek Harness.exe` PID 20708, 10688,
  24980, 20296, **16604** (el servidor citado en `PA-UI-0.4-ROUTE-B-EVALUATION.md` §2.3) y un `node.exe`
  PID 13744. No se tocó ninguno.

### 2.2 El plugin RAG no está versionado

| Hecho | Medición |
|---|---|
| Ficheros de `lifecode-rag/` con seguimiento en git | **0** (`git ls-files lifecode-rag` vacío) |
| Entradas sin seguimiento bajo `lifecode-rag/` | 136 |
| Commits que hayan tocado `lifecode-rag/` | **ninguno** (`git log -- lifecode-rag` vacío) |
| Composición | `lib/` 44 módulos, `tests/` 38 `*.test.mjs` + 3 helpers, `docs/` 26 documentos, `bin/` 1 CLI, `tools/` 5, `demo/` |

Consecuencia para el plan: cualquier implementación de K1 se hará sobre **trabajo sin commit**, y el
`git status` no servirá para distinguir lo nuevo de lo previo. La evidencia de K1 tiene que ser por
**hash de fichero**, no por diff.

### 2.3 Defectos medidos del cliente actual (K1-A)

| # | Hecho | Evidencia |
|---|---|---|
| A-1 | El manifiesto declara `dsh.client` (`platform: web`, `immediately: true`) y **no tiene campo `exports`** | `lifecode-rag/package.json`, 42 líneas, SHA-256 `a6447cae…cf9a` |
| A-2 | El anfitrión **rechaza** esa combinación con un error explícito: `client-modules: <paquete> declares dsh.client but exports no "./client" bundle` | `@deepseek-ai/dsh-client-modules/src/index.ts`, fuente incluido en `app.asar`, función `clientExportOf` y su llamada en la composición de la fila |
| A-3 | El cliente registra slots con `ctx.slots.inject(SLOT)` y después `.register(...)` | `client.js:732-747` |
| A-4 | La API vigente del anfitrión es `ctx.slots.inject(key, callback)`; su implementación devuelve **una función disposer**, no un registro | implementación embebida: `inject(key,callback){ … return()=>{disposeController()} }` |
| A-5 | Por tanto `sidebar.register` es `undefined` → `TypeError` determinista en `apply` | consecuencia de A-3 + A-4 |
| A-6 | Declara `locale: 'lifecode-rag'` en las dos filas y **no registra ningún diccionario** | `client.js:738,746`; no existe `lifecode-rag/locale/` |
| A-7 | Sondea cada 30 s con `setInterval` y sólo mira `document.visibilityState`; no usa `usePanelInfo` | `client.js:583-589`; contradice `docs/WORKSPACE-UX.md` §5.1–5.2 |
| A-8 | Su fuente de datos es la API **heredada** `/lifecode-rag/api` (v0.2), que `index.js` sólo monta si existe `rag.sqlite3` | `client.js:16`, `index.js:52-60` |
| A-9 | En un perfil Project-Aware el panel legacy responde con un error propio `panel-unavailable` | `client.js:40-49`; `tests/client.test.mjs:42-48` |

Ninguno de estos hechos se corrige en K1: se documentan para que la implementación no repita el
diagnóstico. Los dos primeros (A-1, A-3) son la causa completa de que la fila no aparezca.

### 2.4 Lo que sí está verificado en el anfitrión

| Hecho | Evidencia |
|---|---|
| La forma que funciona es `ctx.slots.inject(slot, () => ctx.slots.register({...}, Componente))`; el callback corre dentro de `ctx.effect` y se desmonta al colapsar la declaración | implementación embebida de `slots.inject`; `lifecode-skill-center/client.js:9123-9161` |
| `exports["./client"]` admite cadena o un objeto con `default` cadena | `clientExportOf`, fuente del anfitrión |
| El **id** de `window.__ModuleLoader__.load` es el nombre del paquete (`WebBootEntry.id`: "Entry name == package name") | `src/client/manifest.ts`, contrato del grafo de arranque |
| `dsh.client.inject` **no** es requisito de carga: son "package rows whose factories must arrive before this row materializes" (orden de activación) | `src/client/manifest.ts`, comentario de `WebBootEntry` |
| `platform: 'web'` es condición para que la fila sea de cliente | `src/index.ts`, `if (decl === undefined \|\| decl.platform !== 'web') return null` |
| El paquete instalado del Skill Center **no** es el del árbol: `client.js` instalado `2490839c…efd1d` ≠ `client.js` del worktree `fb1a8336…9b31` | `~/.dsh/profiles/desktop/node_modules/@local/lifecode-skill-center/` (copia de GitHub fijada a `827b84e`) |
| `lifecode-rag` sí está enlazado al árbol de trabajo (`link:`), así que sus cambios llegan al host al reiniciar | `~/.dsh/profiles/desktop/package.json` + symlink en `node_modules/@local/lifecode-rag` |

La última fila es la que hace viable K1-A: **no hace falta instalar nada**, sólo editar y reiniciar.

---

## 3. Arquitectura objetivo

```
┌──────────────────────────── cliente (navegador) ────────────────────────────┐
│ client.js  (módulo perezoso, id = @local/lifecode-rag, sin imports)          │
│   sidebar.panellist → fila (icono + etiqueta)                                │
│   main             → panel (vistas K1-B)                                     │
│   estado: sólo presentación. Ninguna decisión de autorización.               │
│   fuente de datos: (K1-A/B) fixtures · (futuro) /lifecode-rag/ui/api          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ HTTP (loopback, cookie del host)
┌──────────────────────────────────▼──────────────────────────────────────────┐
│ index.js (adaptador Cordis, 114 líneas)                                      │
│   tools: 7 herramientas v0.1 (intactas)                                      │
│   API v0.2 heredada: sólo si existe rag.sqlite3 (intacta)                     │
│   [K1-C, NO EXISTE] /lifecode-rag/ui/api → withAuthorizedContext              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                     lib/ (44 módulos, núcleo puro, sin @deepseek-ai/*)
```

Tres fronteras que el plan **no** cruza:

- **La UI no autoriza.** No hay ninguna ruta por la que el panel conceda acceso; toda petición futura
  termina en el mismo resolutor que usan las herramientas (`resolveScope`, `withAuthorizedContext`).
- **La UI no sustituye a la identidad.** Un `sessionId` enviado por el cliente es *direccionamiento*
  sobre un peer ya autenticado como `owner`; no es una prueba. El contrato lo dice en §3.3 y este plan lo
  repite en cada etapa que lo roza.
- **La UI no inventa datos.** Si una vista no tiene ruta contractual, se declara no disponible. No se
  rellena con ceros, ni con cálculos del cliente que el backend no hizo.

---

## 4. Separación de etapas

| Etapa | Qué entrega | Qué **no** hace | Depende de | Se puede declarar terminada sin |
|---|---|---|---|---|
| **K1-A** `CLIENT` | Manifiesto y cliente que cargan y montan, con locales y desmontaje limpio, sobre fixtures estáticos | No lee datos, no escribe, no audita | Nada | Ninguna condición de K1-C |
| **K1-B** `CLIENT` | Las diez vistas Project-Aware contra el contrato, con estados obligatorios y limitaciones visibles, sobre fixtures | No habilita la API real, no cambia el contrato, no escribe auditoría `ui.read` | K1-A | G6 |
| **K1-C** `SECURITY` | Evaluación y gate de las tres alternativas de identidad; runbook de lo que faltaría | No implementa autenticación, no crea instancias, no cambia topología, no firma decisiones | K1-A (G3/G4), G5 real | Nada: es un gate |

**Regla de oro:** K1-A y K1-B se prueban con datos sintéticos y **no** requieren que exista la API real.
K1-C no se aprueba porque el panel se vea bien.

---

## 5. Reglas transversales del plan

1. **No se rediseña el contrato.** Rutas, esquemas, códigos y límites salen de
   `docs/PA-UI-0-API-CONTRACT.md` (revisión 3, `pa-ui/0.1.0-draft`). Si una vista no tiene ruta, se
   declara; no se inventa una ruta nueva (§7 de este documento y `07`).
2. **No se tocan las siete herramientas.** `lib/tools.mjs` y `lib/exec-context.mjs` quedan idénticos
   (criterio K-06 de la aceptación). Cualquier helper nuevo va en módulos nuevos.
3. **No se toca el esquema SQLite.** `ui.read` (K1-C/G6b) usa la tabla `audit_registry` existente; no
   añade tablas, columnas ni triggers.
4. **No se toca el almacén real en ninguna prueba.** `mkdtemp` + `tools/hermetic.mjs` antes/después.
5. **No se toca `lifecode-skill-center/` ni `skill-compiler/`.** Se leen como referencia; no se copian
   ni se modifican.
6. **No se toca el perfil ni se reinstala.** El plugin ya está enlazado; K1-A sólo necesita reinicio
   (acto humano).
7. **Fail-closed se conserva.** Ninguna etapa introduce un camino que devuelva datos cuando la
   autorización no se pudo resolver.
8. **Un identificador de interfaz no es una credencial.** Ninguna etapa acepta `sessionId` por cuerpo,
   query o cookie.

---

## 6. Plan de trabajo (resumen por etapa)

Las actividades detalladas viven en `02`, `03` y `04`; aquí sólo el orden y la clase.

| Id | Etapa | Clase | Actividad | Bloquea a |
|---|---|---|---|---|
| K1-A-01 | A | `DOCUMENTATION` | Congelar línea base (hashes, versión de host, defectos A-1…A-9) | K1-A-02 |
| K1-A-02 | A | `CLIENT` | `exports` del paquete (espejo del Skill Center) | K1-A-03 |
| K1-A-03 | A | `CLIENT` | Registro de slots con la forma vigente | K1-A-04 |
| K1-A-04 | A | `CLIENT` | Locales ES/EN y textos por diccionario | K1-A-05 |
| K1-A-05 | A | `CLIENT` | Ciclo de montaje/desmontaje y sin temporizadores | K1-A-06 |
| K1-A-06 | A | `CLIENT` | Modo fixtures con corte de red | K1-A-07 |
| K1-A-07 | A | `TESTING` | Extender `tests/client.test.mjs` (contrato estático) | K1-A-08 |
| K1-A-08 | A | `TESTING` | Extender `tools/check.mjs` (gate de manifiesto, G3) | K1-A-09 |
| K1-A-09 | A | `HOST-INTEGRATION` | Prueba visual en el host + reinicio | Cierre A |
| K1-A-10 | A | `TESTING` | No regresión (`node --test`, hermético, 7 herramientas) | Cierre A |
| K1-B-01 | B | `DOCUMENTATION` | Tabla vista ↔ ruta contractual (y las que no tienen) | K1-B-02 |
| K1-B-02 | B | `CLIENT` | Adaptador de datos con `DATA_MODE` y fixtures | K1-B-03 |
| K1-B-03 | B | `CLIENT` | Vistas 1-5 (proyecto, selección, bibliotecas, fuentes, detalle) | K1-B-04 |
| K1-B-04 | B | `CLIENT` | Vistas 6-8 (búsqueda, procedencia, contexto) | K1-B-05 |
| K1-B-05 | B | `CLIENT` | Vistas 9-10 (indexación, historial) con limitaciones declaradas | K1-B-06 |
| K1-B-06 | B | `CLIENT` | Estados obligatorios, accesibilidad y responsive | K1-B-07 |
| K1-B-07 | B | `TESTING` | Pruebas de fixtures, navegación, estados y a11y | Cierre B |
| K1-C-00 | C | `SECURITY` | Verificar que G3/G4/G5 son reales antes de evaluar nada | K1-C-01 |
| K1-C-01 | C | `SECURITY` | Alternativa A: capacidad de sesión del host | K1-C-03 |
| K1-C-02 | C | `SECURITY` | Alternativa B: aislamiento topológico (TI-1…TI-7) | K1-C-03 |
| K1-C-03 | C | `SECURITY` | Alternativa C: aceptación explícita del riesgo residual | Decisión humana |
| K1-C-04 | C | `DOCUMENTATION` | Informe del gate con estados sin alterar | — |

Ninguna actividad `SECURITY` se agrupa dentro de una tarea visual, y ninguna actividad `CLIENT` puede
cerrar un criterio de seguridad.

---

## 7. Huecos del contrato detectados al planificar (no se corrigen aquí)

La lista de vistas pedida por la tarea y la superficie contractual **no coinciden en tres puntos**. Se
registran porque implementarlas "como si existieran" sería exactamente lo que la tarea prohíbe.

| Vista pedida | Ruta contractual | Estado real |
|---|---|---|
| Historial de operaciones | **ninguna** | El contrato §5 no expone listado de auditoría; `/diagnostics` sólo devuelve `integrity.auditHead`. La vista se declara **no disponible**. |
| Selector de bibliotecas | `GET /libraries` | Lectura de grants; **no** existe escritura de grants en el contrato. El "selector" es informativo. |
| Estado de indexación | `GET /diagnostics` | Cubre estado de almacén e integridad por ámbito; **no** cubre última sincronización ni detalle por embedding (GAP-06, GAP-10). |

Esto no invalida el contrato: confirma que la tarea pedía más de lo que el contrato ofrece. La decisión
de ampliarlo es del propietario (`07`, Q-03).

---

## 8. Criterios de aceptación globales (los que K1 puede tocar)

| Gate | Qué exige | Etapa que lo puede cerrar | Estado hoy |
|---|---|---|---|
| G1 | Aprobación humana de los tres documentos PA-UI-0 | Humano | No consta |
| G2 | D-UI-01…11 resueltas o aplazadas | Humano | Parcial (D-UI-02/03 bloqueadas) |
| G3 | Manifiesto cargable (`exports["./client"]`) | **K1-A** | **No cumple** (A-1) |
| G4 | Slots con `ctx.slots.inject(key, cb)` | **K1-A** | **No cumple** (A-3/A-5) |
| G5 | `sessionId` obtenible del slot de conversación en prueba real | K1-A (sonda) / K1-C | No probado |
| G6 | Ruta A o ruta B demostradas | **K1-C** | `BLOCKED` / `NOT DEMONSTRATED` |
| G6b | `ui.read` fail-closed | K1-C | No implementado |
| G7 | Sin fallback al almacén legado en la API nueva | K1-C | No aplica (no hay API) |
| G8 | Suite RAG verde y hermética | K1-A (no regresión) | No ejecutada en K1 (ver §10) |

K1-A cierra G3 y G4; **no** cierra G5 (esa prueba exige el slot de conversación y una sesión real, y su
resultado es direccionamiento, no identidad). G6 sigue fuera del alcance de K1.

---

## 9. Riesgos

| Id | Riesgo | Prob. | Impacto | Control |
|---|---|---|---|---|
| R-K1-01 | Añadir `exports` rompe la resolución del paquete en el perfil (`link:`) | Media | Alto | Espejo exacto del mapa del Skill Center; `node tools/check.mjs` + arranque real antes de seguir |
| R-K1-02 | El cliente carga y el panel queda en blanco por una prop o un `require` que no resuelve | Media | Alto | Componente con frontera de error propia; evidencia del grafo de arranque, no sólo captura |
| R-K1-03 | El panel de K1-B parece "producto" y alguien asume que la API está segura | Alta | Crítico | Banner permanente de datos sintéticos + este plan + estados `BLOCKED` repetidos en la UI |
| R-K1-04 | Se reutiliza el panel legacy y se sirve el almacén v0.2 en un perfil PA | Baja | Crítico | `DATA_MODE` cerrado por defecto; ningún `fetch` sin modo explícito |
| R-K1-05 | Alguien "arregla" la auditoría escribiendo `ui.read` desde el panel | Media | Crítico | K1-B no escribe auditoría; `ui.read` es K1-C/G6b |
| R-K1-06 | Las pruebas tocan el perfil real (registro 212 992 B, almacén 3,8 MB) | Baja | Crítico | `mkdtemp` obligatorio + `tools/hermetic.mjs` |
| R-K1-07 | `node --test` desde la raíz dispara suites ajenas | Alta si se hace mal | Alto | Ejecutar sólo dentro de `lifecode-rag/` |
| R-K1-08 | El árbol cambia durante la implementación (1128 entradas sin seguimiento) | Alta | Medio | Evidencia por hash; sin `git clean`, sin `reset`, sin `stash` |
| R-K1-09 | Se instala o reinicia el host sin autorización | Baja | Alto | Reinicio = acto humano explícito |

---

## 10. Lo que K1 **no** verificó (declarado, no implicado)

- **No** se ejecutó `node --test`, `tools/check.mjs` ni `tools/hermetic.mjs`: la autorización es
  documental y el árbol está en uso por procesos vivos. Todos los estados de prueba de este plan son
  **NO PROBADOS**.
- **No** se abrió ningún almacén real, ni el registro del perfil, ni el fichero de credenciales.
- **No** se modificó la topología, ni se creó una instancia, ni se cambió `DSH_HOME`.
- **No** se verificó visualmente el panel en esta sesión: la afirmación "el panel no aparece" se apoya en
  el código del anfitrión (A-1, A-3, A-5) y en el diagnóstico previo `eval/pa3/evidence/D-UI-RAG-01-REPORT.md`,
  no en una captura tomada hoy.

---

## 11. Evidencias que entregará la implementación (cuando se autorice)

| Evidencia | Formato | Etapa |
|---|---|---|
| Hashes antes/después de los ficheros tocados | `sha256sum` en texto | A, B, C |
| Gate de manifiesto en verde | salida de `node tools/check.mjs` | A |
| Grafo de arranque con la fila del plugin | JSON de `window.__DSH_BOOT__.entries` | A |
| Montaje/desmontaje | conteo DOM (`.lcr-root`, `#lcr-styles`) antes y después de cambiar de panel | A |
| Consola sin `TypeError` ni `slot entry crashed` | captura de consola | A |
| Reinicio | misma evidencia tras reiniciar, con hora | A |
| No regresión | `node --test` + `node tools/hermetic.mjs` (huella antes/después) | A, B |
| Matriz de vistas | una fila por vista con ruta, estado y limitación | B |
| Higiene de fixtures | escaneo sin rutas de usuario, tokens ni ids reales | B |
| Gate de seguridad | informe con estados sin alterar | C |

Carpeta propuesta: `eval/pa-ui-1/evidence/` (hoy **no existe**; su creación pertenece al acto de
implementación autorizado, no a K1).

---

## 12. Condiciones de parada

Detenerse y pedir autorización si, en cualquier etapa:

1. hace falta **instalar**, **reinstalar**, **reiniciar** el host o cambiar el perfil;
2. hace falta **tocar un almacén real**, el registro del perfil o `.credentials.yaml`;
3. una prueba sólo pasa si se usa el almacén legado o un dato real;
4. el cierre de un criterio exigiría **cambiar el contrato** (ruta, esquema, código de error);
5. aparece un `TypeError` del que no se conoce la causa en el código del anfitrión;
6. se descubre que dos worktrees compiten por el mismo fichero;
7. la única forma de avanzar es declarar una ruta de K1-C como demostrada sin evidencia.

---

## 13. Autorización humana requerida

| Acto | Quién | Cuándo |
|---|---|---|
| Aprobar G1/G2 (documentos y decisiones D-UI) | Propietario | Antes de K1-A |
| Autorizar el cambio de manifiesto (`exports`) | Propietario | Antes de K1-A-02 |
| Autorizar el reinicio del host para la prueba visual | Propietario | K1-A-09 |
| Decidir sobre las vistas sin ruta (historial, selector de bibliotecas) | Propietario | Antes de K1-B-05 |
| Decidir D-UI-03 (riesgo residual) | Propietario, por escrito | Antes de cualquier dato real |
| Autorizar K1-C como evaluación con acceso a configuración del host | Propietario | Antes de K1-C-00 |

---

## 14. Estado final esperado de este plan

```
K1 PLANNING: COMPLETED
K1 IMPLEMENTATION: NOT STARTED
PA01: BLOCKED
D-UI-03: PENDING HUMAN DECISION
G6: BLOCKED
```

Documentos: `01`…`08` de esta carpeta. `08` contiene los hashes; cualquier cambio posterior en un
entregable exige regenerarlo.
