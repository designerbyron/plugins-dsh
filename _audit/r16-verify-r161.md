# R16.1 — Verificación independiente (task-16)

Verificador: `verify-r16` (T5). Fecha: 2026-11-09. Árbol: `C:\xampp\htdocs\plugins-dhs\lifecode-skill-center`.
Alcance escrito: sólo `tests/r16-contract.test.mjs`, `tests/r16-security.test.mjs`, `tests/r16-e2e-sim.test.mjs`,
`tools/r16-e2e.mjs`, `tools/r16-collision-matrix.mjs` y este informe. No se tocó `lib/`, `index.js`, `client.js`,
`_audit/*.md` existentes, `package.json` ni datos reales; sin git de escritura.

## Veredicto global: PASS (sin defectos de producto abiertos)

Ninguna operación normal escribe en el filesystem externo, ningún bloqueo deja huella en el árbol, y las 9 rutas
con compuerta miden el inventario real antes de despachar. Los únicos puntos rojos de gates son preexistentes y
están documentados abajo (`testquality`).

## Veredicto por punto

### 1. Traza de evidencia por spy en las rutas de escritura — PASS
Prueba: `tests/r16-contract.test.mjs` → «R16.1: las nueve rutas con compuerta miden el catálogo antes de escribir».
El fixture `mountedHost` monta el adaptador real (`apply(ctx,{root,dshHome,agentsHome})`), intercepta
`skills.snapshot` y registra `{store:treeHash(root), dsh:treeHash(dshHome)}` **antes** de devolver el catálogo.
Las 9 rutas (`create`, `publish`, `toggle`, `materialize-project`, `import`, `register-project`, `adopt-project`,
`repair-manifest`, `detach-project`) llaman exactamente 1 vez a la medición y el hash del almacén en ese instante
es idéntico al previo a la acción: la compuerta no mide después de escribir.
Pruebas que fallan si el inventario llega vacío o se ignora: create/publish con Skill externa homónima,
publish con proveedor externo distinto, nombre ambiguo, asignación sombreada (toggle 200 + `assignment-shadowed`
warn; materialize 409 block), herramienta IA `lifecodeSkillCreate` con `evidence` espía, import.
Salvedad de contrato: `register-project`/`adopt-project`/`repair-manifest`/`detach-project` no incluyen
`skills-registry` entre sus fuentes requeridas (§4), así que su decisión no depende del catálogo; la traza confirma
que aun así se mide una sola vez antes del despacho. `repair-manifest` y `detach-project` siguen respondiendo
`unknown-action` sin escribir: hueco declarado y aceptado fuera de R16.1.

### 2. Política create/publish — PASS
- `publish-version` sin `skills-registry` ⇒ **409** `preflight-blocked` / `evidence-incomplete`, con
  `findings[].subject`, `reasons` y `evidence.preflightVersion===1`; cero escritura (hash idéntico).
- `create-skill` sin catálogo ⇒ **200**, finding `catalog-unverified` warn, sin afirmar «sin colisiones», y sí
  escribe (la operación no está bloqueada por diseño).
- `materialize-project` estricto: con evidencia incompleta no devuelve 200 y no crea `root/materialized/<id>`.

### 3. Las 7 pruebas de regresión del usuario, con fixtures propias — PASS
1) Skill externa homónima al crear ⇒ `name-collision` warn, externa intacta (sha256 antes/después).
2) Publicar un nombre servido por otro proveedor ⇒ 409 `name-collision` block.
3) Catálogo no disponible ⇒ block `evidence-incomplete` en publish; warn `catalog-unverified` en create.
4) Proveedor externo ≠ propietario ⇒ 409 block (`inventory` fabricado).
5) Nombre ambiguo (dos copias materializadas) ⇒ 409 `ambiguous-identity` block.
6) Asignación a Skill sombreada ⇒ warn al habilitar, block al materializar.
7) Materialización con evidencia incompleta ⇒ no 200 y vista materializada ausente.
En los 4 casos de bloqueo el `treeHash(root)` es idéntico antes/después.

### 4. Rutas heredadas y filesystem externo — PASS
Prueba de fuente: `lib/*.mjs` no usa `process.env.DSH_HOME` y `lib/sources.mjs` deriva raíces con `skillRootsFor`.
Toda ruta HTTP de escritura de `GATED_ACTIONS` (`index.js:404`) pasa por el handler (POST index.js:638-646) y por
`actionPreflight`; `lifecodeSkillCreate` recibe `evidence` (`index.js:483,495`, `lib/tools.mjs:101`) y falla con
`ambiguous-identity` cuando el catálogo mide ambigüedad, sin escribir. Ningún test observó escritura en la caja
externa: hash de la Skill externa y de la carpeta importada idénticos.

### 5. Consistencia de payloads, 409 y cero escritura — PASS
- `GET /api/inventory` con snapshot que lanza ⇒ 200 `complete:false`, fila `skills-registry` con status de error y
  `reason`, `entries` array: nunca «inventario vacío» como éxito.
- `GET /api/projects` no confunde descubierto con registrado: `projects` sólo el registrado (`healthy`,
  `cwd` comparado por `cwdKey`) y `discovered` sólo el otro (`state:'discovered'`).
- Entrada de inventario declara `owner.kind/provider`, `origin.kind`, `location.kind/path`, `scope.kind`,
  `confidence`, `reasons`.
- 409 conserva `findings` + `reasons` + `evidence`; todo block medido deja hash idéntico.

### 6. Panel en blanco — PASS
Pruebas ui-projects (`tests/r16-ui*.test.mjs`) 20/20 exit 0. Render reproducible desde la raíz del repo:
- `node _audit/r16-render.mjs --html-only --stale-host --state-file=r16-capture/live-state.json` ⇒ exit 0,
  «LEGACY banner heredado visible y panel con contenido», 39 977 B de HTML.
- `node _audit/r16-render.mjs --html-only --force-error` ⇒ exit 0, «BOUNDARY tarjeta visible con el mensaje real;
  «Reintentar» recupera el panel», 22 996 B; contiene «El panel no pudo dibujarse», «Mensaje fallo simulado».
  El stack en stderr es la excepción forzada esperada. No se regeneraron capturas ni perfiles.

### 7. Gates — PASS salvo testquality preexistente

| Gate | Comando | Resultado | Exit |
|---|---|---|---|
| Suite completa | `node --test` | 725/725 pass, 0 fail | 0 |
| Fichero de contrato | `node --test tests/r16-contract.test.mjs` | 42/42 pass | 0 |
| UI + runtime | `node --test tests/r16-ui.test.mjs tests/r16-ui-runtime.test.mjs` | 20/20 pass | 0 |
| Check | `node tools/check.mjs` | 389/389 | 0 |
| E2E migración | `node tools/e2e.mjs` | 19/19 PASS · almacén real `d431f76…` sin cambios | 0 |
| E2E autónomo | `node tools/e2e-autonomous.mjs` | 26/26 PASS | 0 |
| Mutación | `node tools/mutation.mjs` | 16/16 (13/13 críticos) | 0 |
| Cobertura | `node tools/coverage.mjs` | línea 95.59 % · rama 76.73 % · funciones 83.8 % · «Suite en verde» | 0 |
| Hermético | `node tests/check-hermetic.mjs` | 14 ficheros del centro + 173 skills intactos | 0 |
| Matriz R16 | `node tools/r16-collision-matrix.mjs` | 6/6 códigos con severidad esperada | 0 |
| E2E R16 | `node tools/r16-e2e.mjs` | 9/9 PASS, 0 SKIP, 0 FAIL; hash temp 0→3 ficheros | 0 |
| Testquality | `node tools/testquality.mjs` | 1 alta + 27 media + 13 baja | 1 (preexistente) |

Nota de cobertura: la primera ejecución salió 1 con «Suite con fallos» porque corría en paralelo con la suite
completa (interferencia entre dos `node --test`); en solitario, exit 0 y suite verde.
Testquality: el hallazgo alto es `tests/state.test.mjs:144` («nombre/promete-atomicidad»), ajeno a R16 y declarado
preexistente en el encargo; no se tocó. `tests/testquality-audit.test.mjs` (7/7) sí pasa.

## Observación (no defecto, sin bloqueo)
`POST import` devuelve 200 con `{ok, id, skill}` y **no** incluye `findings` en la raíz, aunque el gate de
create-skill puede producir avisos (p. ej. `catalog-unverified`/`name-collision` warn). La compuerta sí mide el
catálogo antes de copiar (spy) y el origen queda intacto; si el contrato exige exponer los warns también en
import, convendría unificarlo con `create`. Ruta: `lib/api.mjs:3295-3304` (resultado de `import` = `createSkill`).

## Defectos de producto
Ninguno abierto. Hueco aceptado fuera de R16.1: `identity-adopt/repair/identity-unlink` pasan por
`identityActionGate` (identidad v3); `repair-manifest`/`detach-project` responden `unknown-action` sin escribir.
