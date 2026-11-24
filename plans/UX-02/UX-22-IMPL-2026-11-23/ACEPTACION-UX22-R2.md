# UX-2.2 — Matriz de aceptación · revisión 2 (acto 2026-11-23)

> **Sustituye a `ACEPTACION-UX22.md` (revisión 1)**, que queda como histórico: sus cifras (620/620) y parte de
> sus filas eran anteriores a las correcciones F8-F15 y al cierre de `exec-context`. Esta revisión es la que rige.

**Rama:** `feat/ux22-tracking` · **Base:** 1.4.0 (`7d7e839` + 27 modificados del propietario, preservados) · **API:** `pa/1.5.0`
**Medición vigente:** **642/642 PASS**, 0 fail, **60 836 ms** · `✓ hermético: el almacén real no cambió (6 ficheros)` · `node tools/check.mjs` verde.
**Convención:** `DOBLE` = probado con dobles/registro temporal/host simulado · `HOST REAL` = exige el Host y una sesión autenticada del propietario. Nada `DOBLE` se presenta como `HOST REAL`.

| # | Criterio (`UX-22-TRACKING-SPEC.md` §10) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | El toggle persiste tras reiniciar DSH | **DOBLE parcial / HOST REAL pendiente** | `tracking-migration.test.mjs`: la fila sobrevive al cierre y reapertura del registro con sus campos; el reinicio de la **aplicación** no se ha ejecutado |
| 2 | No modifica `pa_selection` | **DOBLE · directa** | `tracking-invariants.test.mjs`: volcado completo con selección de panel sembrada |
| 3 | No modifica `session_scope` explícita | **DOBLE · directa (corregida)** | `tracking-invariants.test.mjs`: **se siembra una fila de sesión real** y se compara contenido (antes comparaba una tabla vacía — auditoría B3) |
| 4 | Resuelve sólo para su sesión | **DOBLE · directa** | `resolve-tracking.test.mjs` (dos sesiones, `openProjects` compartido) |
| 5 | Dos sesiones no ven fragmentos del otro proyecto | **DOBLE · directa (recuperación real)** | `tracking-isolation.test.mjs`: dos proyectos ingeridos con marcadores exclusivos, `searchScopes` con almacenes abiertos, **0 fragmentos cruzados**, `via === 'withAuthorizedContext'` |
| 6 | Conflicto workspace/`cwd` → `scope-conflict` | **DOBLE · directa** | `resolve-tracking.test.mjs` + `tracking-isolation.test.mjs` (cuatro claves de `details`) |
| 7 | Workspace sin proyecto se sigue pero no resuelve | **DOBLE · directa** | `resolve-tracking.test.mjs` (`on` + `project_id NULL` → `tracking-not-resolving`) |
| 8 | Workspace ausente conserva su seguimiento | **DOBLE · parcial** | `tracking-regressions.test.mjs` (F4) + `tracking-store.test.mjs`. En producción ningún camino escribe `missing` (**L1**) |
| 9 | Anidados: gana la raíz más específica | **DOBLE · directa con norma corregida** | `mostSpecific` gobierna `cwd` ∩ raíces (escalón 3); en el escalón 2, dos seguidos con proyectos distintos → `scope-conflict`. Spec §2 alineada (auditoría B4) |
| 10 | No crea ni modifica permisos | **DOBLE · directa** | `tracking-invariants.test.mjs`: seis superficies idénticas tras el ciclo completo |
| 11 | Las siete herramientas conservan contratos | **DOBLE · indirecta** | `check` + integración; bajo `source:'tracking'` se ejerce `search` por la compuerta real y las otras seis comparten el mismo `withAuthorizedContext` corregido |
| 12 | El Core sigue funcionando sin DSH | **DOBLE · directa** | `standalone.test.mjs` + `check`; `lib/tracking.mjs` sólo importa `errors.mjs` |
| 13 | La migración conserva registro y almacenes | **DOBLE · directa y fuerte** | `tracking-migration.test.mjs`: 11 tablas con recuentos idénticos, `integrity_check`, `foreign_key_check`, cadena e idempotencia |
| 14 | Suites verdes | **DOBLE · medida hoy** | 642/642 + hermética + `check` |
| 15 | La evidencia distingue dobles de reales | **PASS (este documento)** | lo pendiente de Host real va aparte y no se cuenta como cumplido |
| 16 | Reasociar no mueve conocimiento | **DOBLE · directa** | `tracking-isolation.test.mjs`: `sha256` y `chunkKeys` idénticos, A lo encuentra, B no, recuentos 2→2 y 1→1 |
| 17 | La reconciliación no se atribuye a la persona | **DOBLE · directa** | `resolve-tracking.test.mjs` + `tracking-invariants.test.mjs` (`actor='host'`, cero humanas) |

**Cómputo:** 14 con evidencia directa o fuerte · 1 parcial (8) · 1 con doble parcial y Host real pendiente (1) · 1 indirecta (11).
**No se declara el criterio 1 cumplido**: exige reiniciar la aplicación con el interruptor puesto.

## Bloqueantes de la segunda auditoría

| # | Bloqueante | Estado |
|---|---|---|
| B1 | Contrato §20 con cuatro inexactitudes (`path?`, `limit` 1..1000, sin `store-busy`, compatibilidad) | **CERRADO** — `path` obligatoria, tope 200, `store-busy` 503 documentado, cambio CSRF declarado en §20.8 |
| B2 | Matriz desfasada | **CERRADO** — esta revisión |
| B3 | Criterio 3 vacuo | **CERRADO** — fila de sesión sembrada y comparada |
| B4 | Criterio 9 sin prueba y contra la spec | **CERRADO** — norma corregida y cubierto por la prueba de dos workspaces |
| B5 | Alcance real del eje B | **CERRADO como declaración** (`D-IMPL-10`, L1) |
| B6 | `ESTADO-IMPLEMENTACION` se contradecía | **CERRADO** — §7 remite a §10; ROADMAP con cifras reales |

## Limitaciones que el release debe declarar (no bloquean)

- **L1 · El eje B sólo sabe decir `ok`.** Ningún camino de producción escribe `missing` ni `unknown`; la disponibilidad se mide al resolver y sólo promociona a `ok`. Un workspace desaparecido conserva su último estado hasta que exista un barrido (UX-2.1/UX-3). **No otorga acceso**: el escalón 2 exige que el Host liste el workspace. El panel puede mostrar un estado obsoleto.
- **L2 · El seguimiento es una decisión permanente.** Cualquier sesión que el Host sitúe en un workspace seguido usa su proyecto, aunque el workspace esté fuera de toda raíz autorizada. Es `D-UX22-09`; no amplía los datos a los que el proyecto ya tenía acceso.
- **L3 · `paused` bloquea el `cwd`** (no cae al escalón 3), conforme a la spec; `off` no bloquea.
- **L4 · Dos workspaces seguidos del mismo proyecto**: se toma el primero (benigno: mismos ámbitos).
- **L5 · `pathKeyFor` depende de `realpath`**: repuntar un junction deja la fila huérfana con su último `lastStatus`.
- **L6 · `GET /pa/tracking` no pagina**: tope 200 con `truncated:true` y sin cursor.
- **L7 · Las cinco mutaciones no registran `sessionId`/`principal`**; `/selection` sí.
- **L8 · `forget` devuelve `chunks`** (aditivo) — cambio del valor de una herramienta respecto a `CONTRATO-v0.1`.
- **L9 · CSRF retrofit**: 7 rutas `POST` heredadas pasan de atender a `403` sin cabecera (`D-IMPL-05-R1`).

## Pendiente de Host real (no cuenta como cumplido)

Reinicio de la aplicación con el interruptor puesto · panel montado contra el Host · `GET/PUT/DELETE /pa/tracking` con credencial real · las siete herramientas en una sesión autenticada (T6).

## Defectos encontrados y corregidos en el acto

F1 (`off` bloqueaba el `cwd`) · F2 (reconciliación antes de validar identidad) · F3 (dos workspaces, se elegía uno) · F4 (timeout como `missing`) · F5 (discrepancia sin auditar) · F6 (`D-IMPL-05` revisada → `D-IMPL-05-R1`) · F7 (`path` reescrita) · F8 (`path`/`pathKey` sin validar) · F9 (panel inventaba estado) · F10 (contención → 500) · F12 (contrato de datos v2) · F13 (`scope-conflict` fuera de la lista dinámica) · F14 (`cwd` ambiguo en el escalón 2) · F15 (recuentos truncados) · **bloqueante nuevo**: `exec-context` negaba las siete herramientas a una sesión resuelta por seguimiento.
