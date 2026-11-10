# R16 — Aceptación

Fecha: **2026-11-09**. Árbol de trabajo: `feature/visual-operation-feedback`,
`HEAD 3b295106` (sin commit ni staging, §13).

## 0. Veredicto

Los **17 criterios de aceptación de §12 se cumplen**. Cuatro lo hacen con una
salvedad explícita (3, 8, 10 y 16) que se detalla abajo; ninguna salvedad oculta un
control inerte ni un éxito falso. No quedan defectos críticos abiertos: los cuatro
defectos D1–D4 encontrados por la verificación independiente se corrigieron y se
re-verificaron (`_audit/R16-GATES.md`).

Gate final: **699/699 pruebas**, `check` 388/388, E2E 19/19 y autónomo 26/26,
mutación 13/13 críticos y 16/16 total, cobertura 95,27 % línea / 76,58 % rama /
83,44 % funciones, hermético con el centro real (14 ficheros) y la biblioteca de
usuario (173 ficheros) **intactos**, matriz de colisiones 6/6 y E2E R16 9/9.

## 1. Criterios de aceptación

### 1 — Refrescar inventario ejecuta una consulta real y ofrece feedback · PASS
`GET /api/projects` (y `/api/inventory`) se resuelven en el momento contra
`workspaceRegistry`, `skills.snapshot()` y las raíces declaradas; no hay caché
persistente (§D1). La UI muestra «Actualizando…», deshabilita el botón, impide el
doble envío y resume «N workspaces · M gestionados · K cambios · hora».
Evidencia: `tests/r16-ui.test.mjs` («refrescar está deshabilitado mientras corre y no
duplica la petición», «inventario parcial y truncado se distinguen del completo»,
«503 se informa como error»); `tools/e2e.mjs`; `tools/r16-e2e.mjs`.

### 2 — Abrir en DSH abre el workspace correcto o explica por qué no · PASS
La acción llama a `uiWorkspace.openWorkspace(workspaceId)` (servicio del panel, el
único contrato que existe) con el id de **su** tarjeta, y queda deshabilitada con
motivo cuando no hay panel o cuando `workspaceId` es `null`. El Host no expone
ninguna acción equivalente del lado servidor: por eso `POST open-workspace` devuelve
**501 `host-action-unsupported`** con `clientAction`, en vez de fingir que abre.
Evidencia: `tests/r16-ui.test.mjs`, `tests/r16-security.test.mjs` (501 sin efecto),
`_audit/R16-ARCHITECTURE.md` §1.3 y §6.

### 3 — Cada proyecto descubierto tiene una acción visible para gestionar su registro · PASS (salvedad)
Hay una acción de registro **global** («+ Registrar proyecto») que abre un diálogo
con un selector de los workspaces descubiertos, y cada tarjeta descubierta ofrece
«Gestionar proyecto» (`preflight` + confirmación) además de «Abrir en DSH» e
«Inspeccionar skills». La salvedad: no existe un botón «Registrar» *dedicado dentro
de cada tarjeta*; la acción es una sola y enumera cada descubierto, que es lo que
§2.4 pide (un único flujo, sin duplicar lógica). Evidencia:
`tests/r16-ui.test.mjs` («el botón superior usa el mismo diálogo…»).

### 4 — El usuario puede registrar explícitamente un proyecto · PASS
Dos pasos: prevalidación **sólo lectura** (identidad, ruta canónica, disponibilidad,
coincidencias, skills, conflictos, cobertura y operaciones permitidas/bloqueadas) y
confirmación humana. Sólo entonces `POST register-project` escribe el registro y su
manifiesto; nunca toca el proyecto. Evidencia: `tests/r16-ui.test.mjs`,
`tests/r16-contract.test.mjs` («el registro explícito crea la relación administrativa…»),
`tools/r16-e2e.mjs` pasos 1–3.

### 5 — Descubrir nunca registra ni modifica automáticamente · PASS
El descubrimiento es una proyección pura: `buildProjectsPayload`/`buildProjectDetail`
no escriben, y el endpoint de lectura no abre almacén en escritura. Probado con hash
del árbol antes/después y 0 ficheros escritos. Evidencia:
`tests/r16-contract.test.mjs` («descubrir un workspace NO crea registro ni escribe…»),
`tests/r16-domain.test.mjs` (pureza por hash de árbol), `tools/r16-e2e.mjs` paso 1.

### 6 — Los proyectos gestionados tienen una ficha clara de administración · PASS
Ficha con seis secciones: Resumen, Skills asociadas, Origen y propiedad, Conflictos,
Actividad e historial, Identidad y vinculación. `POST inspect-project` (sólo lectura)
devuelve `ProjectDetail` con `registration`, `assignments`, `skills[]` (con `host:null`
si el nombre no está en el catálogo), `sessions` con `null` cuando no se pudo contar,
`collisions` y `findings`. Evidencia: `tests/r16-ui.test.mjs`,
`tests/r16-contract.test.mjs` (200/404), `tests/r16-api.test.mjs`,
`tools/r16-e2e.mjs` pasos 4–5, captura `_audit/r16-after-project-detail.png`.

### 7 — Se identifican Skills propias, externas, globales y locales · PASS
El inventario separa `owner` (lifecode/plugin/filesystem/bundled/runtime), `origin`
(project-dsh, user-dsh, plugin-provider, compiler-projects, compiler-global,
materialized…), `location`, `scope`, `association` y `execution`; las raíces E1
añaden el compilador (legacy) y lo materializado (derivado). Lo que no se puede leer
se declara `unavailable`, nunca como inventario vacío. Evidencia:
`tests/r16-api.test.mjs` («fuentes completas, entradas propias/externas/globales/legacy
y sombreado»), `tests/r16-domain.test.mjs` (ranks 100–702), `lib/inventory.mjs`.

### 8 — Cada Skill muestra propietario, origen y confianza · PASS (salvedad)
La ficha muestra «Dueño», «Origen» y «Confianza» por entrada; el modelo tiene siete
niveles (`verified` > `manifest` > `plugin-contract` > `local-registry` >
`content-hash` > `name-only` > `unknown`) y `ambiguous` como veredicto de grupo. La
salvedad: el **valor** de confianza por fila está cubierto en el dominio (frontmatter,
hash, nombre inválido, dueño desconocido), pero no hay una prueba de UI que fije el
valor concreto de una fila renderizada. Evidencia: `tests/r16-domain.test.mjs`,
`tests/r16-ui.test.mjs`, `lib/collisions.mjs` (`canonicalSkillName`).

### 9 — La interfaz distingue inventario completo, parcial y no disponible · PASS
`complete:false`, `truncated` y las fuentes en `error`/`unavailable` se muestran como
«Inventario parcial»/«recortado», nunca como éxito; el 503 del Host se informa como
error con su código. Un `null` se pinta «sin comprobar»/«no contado», jamás 0.
Evidencia: `tests/r16-ui.test.mjs` (parcial, truncado, 503, fallo de una sola fuente),
`tests/r16-api.test.mjs`, `tests/r16-contract.test.mjs` (snapshot roto ⇒ complete:false).

### 10 — El motor detecta colisiones antes de publicar o asignar · PASS (salvedad)
Un único `preflight` puro, compartido por registro, adopción, reparación, materialize,
assign/enable, create-skill, publish-version e import. Con inventario y colisiones
reales; `block` ⇒ 409 `preflight-blocked` **sin escritura**; `warn` ⇒ ejecuta y
conserva los findings. Salvedad: el gate HTTP end-to-end se demuestra en
`register-project` y `materialize-project`; `publish`/`assign` están probados a nivel
de dominio y API, no con una sesión de Host completa. Evidencia:
`tools/r16-collision-matrix.mjs` 6/6, `tools/r16-e2e.mjs` pasos 6–7,
`tests/r16-domain.test.mjs`, `tests/r16-api.test.mjs`, `tests/r16-contract.test.mjs`.

### 11 — Una Skill externa jamás se modifica por una operación normal · PASS
Las escrituras viven en la raíz propia del centro (`materialized/<projectId>/…` y
`projects/<projectId>/manifest.json`); las Skills externas se leen y se muestran como
sólo lectura. Probado con sha256 de la SKILL.md externa antes/después de crear,
publicar, asignar y materializar, y con la biblioteca de usuario intacta (173
ficheros). Evidencia: `tests/r16-security.test.mjs`, `tests/check-hermetic.mjs`,
`tools/r16-e2e.mjs` paso 9.

### 12 — Se preservan relaciones, identidad y asignaciones existentes · PASS
Refrescar no pierde asociaciones; cuatro formas de la misma ruta producen un solo
`projectId`; un registro duplicado no duplica el proyecto; dos POST simultáneos
crean uno solo; dos `cwd` en minúsculas iguales se declaran `identity-conflict` en
lista y ficha (no se fusionan). Evidencia: `tests/r16-contract.test.mjs`,
`tests/r16-domain.test.mjs`, `tests/r16-api.test.mjs`, `tests/workspaces.test.mjs`.

### 13 — Las políticas no se heredan ni se modifican automáticamente · PASS
`human-approved` sigue siendo el valor por defecto; registrar/descubrir no concede
autonomía; la concesión humana de `plugins-dhs-7e085aaa`
(`guarded-autonomous`, by `human`) sigue intacta en `knowledge.json` y las pruebas
comparan el hash del almacén de conocimiento. Evidencia:
`tests/r16-contract.test.mjs` («§12.13: registrar un proyecto no hereda la política de
otro ni toca la concesión»), `tests/policy-provenance.test.mjs`.

### 14 — Las operaciones tienen trazabilidad y manejo de errores · PASS
Códigos cerrados 400/401/403/404/409/501/503/500 con `code` estable y mensaje; el
409 de `preflight-blocked` conserva `findings`/`reasons`/`evidence` dentro del
diálogo; cada operación administrativa deja evento en el diario y la ficha tiene
«Actividad e historial». Evidencia: `tests/r16-api.test.mjs`,
`tests/r16-ui.test.mjs`, `tests/r16-contract.test.mjs`.

### 15 — Los controles de la interfaz tienen pruebas funcionales · PASS
17 pruebas de UI que ejecutan el panel con DOM y `fetch` reales (no sólo comprueban
que exista el botón): filtrado por chips (3→1→3), refresco, abrir, inspeccionar,
gestionar, confirmar, 409, ficha, plural, atribución por frontera de ruta. Además
`tools/r16-e2e.mjs` (9 pasos) y `tests/r16-e2e-sim.test.mjs` (3). Evidencia:
`tests/r16-ui.test.mjs`, `tests/r16-e2e-sim.test.mjs`.

### 16 — La experiencia de escritorio y responsive es coherente · PASS (salvedad)
`tests/styles.test.mjs` 4/4 verifica los cortes 1080/760/430, que no queden rejillas
de 6 columnas ni barras fijas en móvil, el cuerpo apilado y el rail sin 196 px;
capturas a 1440×900 y 1024×768 sin recortes. Salvedad: es coherencia de reglas CSS y
render, **no** una prueba visual con navegador real (no se puede reiniciar el GUI en
esta sesión). Evidencia: `tests/styles.test.mjs`,
`_audit/r16-after-projects-1024.png`, `_audit/R16-UX-UI.md`.

### 17 — No existen regresiones en el sistema actual · PASS
Las 603 pruebas históricas siguen verdes; `check` sube de 359 a 388 sin relajar
reglas; E2E y autónomo intactos; mutación 100 %; el almacén real y la biblioteca de
usuario no cambian; `skill-compiler/` no se tocó; `MEMORY.md` no se tocó.
Evidencia: `_audit/R16-GATES.md` §1–2.

## 2. Respuestas del §11 (resumen; detalle en los informes)

1. **Cómo funcionaba antes**: un `GET /api/workspaces` de sólo lectura con 7 filas y
   3 gestionados; sin inventario de Skills, sin estados de proyecto, sin ficha, sin
   preflight; «Registrar» escribía directo con un input de ruta y los chips de
   recuento no filtraban.
2. **Qué controles no ejecutaban la operación esperada**: chips de filtrado inertes;
   «Publicar manifiesto» ofrecido en filas sin carpeta; el preflight de las acciones
   se evaluaba con inventario y colisiones **vacíos** (detectado y corregido: ahora
   la evidencia real viaja del adaptador al gate).
3. **Qué APIs reales se usan**: `workspaceRegistry.list/get`, `Workspace.status()`,
   `skills.snapshot({cwd})`, `uiWorkspace.openWorkspace(id)` (cliente),
   `workingDirectory.get`, `sessionPersistence`, `loader.entries()` (no documentado,
   marcado como tal). Ver `R16-ARCHITECTURE.md` §1–4 y Apéndice A del contrato.
4. **Cómo se registra y administra un proyecto**: preflight puro → confirmación
   humana → `withState` atómico con manifiesto uuid; estados calculados como
   proyección (`identity-conflict` → `unavailable` → `partially-inspected` →
   `external-managed` → `healthy` → `managed` → `discovered`).
5. **Cómo se descubre la procedencia**: ejes separados (dueño, origen, ubicación,
   ámbito, asociación, ejecución) + prioridad de evidencia + confianza graduada;
   nunca se infiere dueño por nombre de fichero.
6. **Cómo se previenen colisiones**: seis tipos, orden determinista, `ambiguousNames`,
   y un único `preflight` fail-closed (REQUIRED bloquea; OPTIONAL ausente ⇒
   `catalog-unverified` warn, nunca «sin colisiones»).
7. **Qué fuentes no se pueden consultar**: `hermes-legacy` (fuera de `DSH_HOME`),
   asar (opaco), evidencia técnica de aplicación (`machine_verified`), lista de
   proveedores/sombreados del Host, UUID/versión del cargador.
8. **Qué requiere autorización humana**: registro, adopción, reparación/detach de
   manifiesto, materializar, asignar/encender, publicar, avanzar pin, cambios de
   política, adoptar una skill externa, y reiniciar la aplicación para ver el panel.
9. **Qué pruebas se ejecutaron**: ver `R16-GATES.md` (699 unitarias/integración, 388
   chequeos, 19 E2E, 26 autónomas, 16 mutantes, 6 colisiones, 9 pasos E2E R16,
   hermético).
10. **Qué riesgos residuales quedan**: §4 abajo.

## 3. Lo que el sistema se niega a prometer

- Abrir un workspace desde el servidor: **no existe** en el Host; sólo el panel.
- Saber si una skill se *aplicó*: el Host no publica evidencia técnica.
- Distinguir «sin permiso» de «no existe» al medir `Workspace.status()`.
- Enumerar los proveedores de skills del Host o si un nombre está sombreado: sólo se
  infiere comparando el catálogo con el disco, y se marca como heurística.
- Contar sesiones de un proyecto cuando el workspace desapareció: se devuelve `null`,
  nunca 0.

## 4. Riesgos residuales

| Riesgo | Estado | Mitigación |
|---|---|---|
| El GUI vivo sigue sirviendo el bundle anterior | abierto (acción humana) | reiniciar la app; capturas DESPUÉS se generan con el `client.js` real en `node:vm` y se declara |
| `testquality.mjs` con 1 hallazgo alto preexistente (`tests/state.test.mjs:144`) | abierto, no de R16 | documentado en la línea base y en `R16-GATES.md` §5; no se silenció el analizador |
| Intermitencia histórica de `tests/concurrency.test.mjs:37` (1 de 3 en la línea base) | no reproducida en las pasadas finales | sigue siendo la prueba de concurrencia de escritura; vigilada |
| `lib/api.mjs` conserva `scanExternalSkills({dshHome: process.env.DSH_HOME ?? ''})` en 3 rutas heredadas (import/adopción antiguas) | riesgo declarado | la UI y las rutas nuevas no dependen de ellas; candidato a limpieza en una ronda futura |
| `adopt-project` exige manifiesto/uuid v3 válidos y puede rechazar proyectos legacy | por diseño | devuelve 409 `not-adoptable`/`identity-conflict` con motivo; no se migra nada automáticamente |
| Fuentes reales fuera de `DSH_HOME` (hermes 70 skills) no se inventarían | declarado | `unavailable` con motivo, nunca «vacío» |

## 5. Entregables

Informes (`_audit/`): `R16-ARCHITECTURE.md`, `R16-CONTRACT.md`,
`R16-PROJECT-LIFECYCLE.md`, `R16-SKILL-INVENTORY.md`, `R16-COLLISION-MATRIX.md`,
`R16-UX-UI.md`, `R16-GATES.md`, `R16-ACCEPTANCE.md`, más `r16-sources-inventory.md`,
`r16-baseline-gates.md`, `r16-after-captures.md`, `r16-final-gates.log`.

Código: `lifecode-skill-center/lib/{inventory,collisions,preflight,projects}.mjs`
(nuevos), `lib/api.mjs`, `lib/tools.mjs`, `lib/sources.mjs`, `index.js`, `client.js`.

Pruebas/gates: `tests/r16-{domain,ui,api,contract,security,e2e-sim}.test.mjs`,
`tools/r16-{e2e,collision-matrix}.mjs`, `_audit/r16-render.mjs` (capturas
reproducibles).

Capturas ANTES: `_audit/r16-before-projects-{discovered,managed,identity}.png`.
Capturas DESPUÉS: `_audit/r16-after-projects-{discovered,managed,1440,1024}.png`,
`r16-after-project-detail.png`, `r16-after-preflight.png`,
`r16-capture-dialog-409.png`.

## 6. Cómo re-verificar

```powershell
cd C:\xampp\htdocs\plugins-dhs\lifecode-skill-center
node --test                       # 699/699
node tools/check.mjs              # 388/388
node tools/r16-collision-matrix.mjs
node tools/r16-e2e.mjs
node tests/check-hermetic.mjs
cd ..
node _audit/r16-render.mjs        # capturas DESPUÉS
```
