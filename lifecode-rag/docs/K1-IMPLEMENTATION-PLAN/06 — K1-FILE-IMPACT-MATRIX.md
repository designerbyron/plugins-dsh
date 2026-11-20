# 06 — K1 · Matriz de impacto de ficheros

**Clase:** `DOCUMENTATION` · **Aplica a:** K1 (creado) y a la implementación futura (proyectado)
**Estado del árbol:** `lifecode-rag/` tiene **0 ficheros con seguimiento**; todo el plugin es trabajo sin
commit (136 entradas `??` antes de crear esta carpeta; 144 después). La matriz distingue "modificar" de
"crear" porque `git diff` no sirve aquí.

---

## 1. Creado por K1 (esta planificación)

Ocho ficheros, todos nuevos, todos dentro de una carpeta nueva. **Ningún fichero existente se
sobrescribió.**

| Ruta | Tipo | Clase |
|---|---|---|
| `lifecode-rag/docs/K1-IMPLEMENTATION-PLAN/01 — K1-IMPLEMENTATION-PLAN.md` | nuevo | `DOCUMENTATION` |
| `…/02 — K1-A-CLIENT-INTEGRATION.md` | nuevo | `DOCUMENTATION` |
| `…/03 — K1-B-PROJECT-AWARE-UI.md` | nuevo | `DOCUMENTATION` |
| `…/04 — K1-C-API-SECURITY-GATES.md` | nuevo | `DOCUMENTATION` |
| `…/05 — K1-TEST-AND-ACCEPTANCE.md` | nuevo | `DOCUMENTATION` |
| `…/06 — K1-FILE-IMPACT-MATRIX.md` | nuevo | `DOCUMENTATION` |
| `…/07 — K1-DECISIONS-AND-OPEN-QUESTIONS.md` | nuevo | `DOCUMENTATION` |
| `…/08 — K1-PLAN-MANIFEST-SHA256.txt` | nuevo | `DOCUMENTATION` |

Nada fuera de esa carpeta. Ni un byte en `lib/`, `index.js`, `client.js`, `package.json`, el perfil o los
almacenes.

## 2. K1-A · cambios proyectados

| Fichero | Estado hoy | Acción | Detalle | Riesgo | Gate que lo vigila |
|---|---|---|---|---|---|
| `lifecode-rag/package.json` | sin seguimiento, 42 líneas, SHA `a6447cae…cf9a` | **modificar** | añadir `exports` (`"."`, `"./client"`, `"./package.json"`, `"./lib/*"`) | que `link:` deje de resolver | `tools/check.mjs` (G3) + arranque |
| `lifecode-rag/client.js` | sin seguimiento, 751 líneas, SHA `80c27a54…f56d5b` | **modificar** | slots, locales, ciclo de vida, `DATA_MODE` | TypeError/panel en blanco | `client.test.mjs` + prueba visual |
| `lifecode-rag/tests/client.test.mjs` | sin seguimiento, 49 líneas | **modificar** | CL-01…CL-07 | gate débil | revisión |
| `lifecode-rag/tools/check.mjs` | sin seguimiento, 77 líneas | **modificar** | gate de manifiesto (G3) | falso verde | el propio gate |
| `lifecode-rag/docs/K1-A-EVIDENCE.md` | no existe | **crear** | evidencia de la prueba visual | — | hashes |

## 3. K1-B · cambios proyectados

| Fichero | Estado hoy | Acción | Detalle |
|---|---|---|---|
| `lifecode-rag/client.js` | — | **modificar** | diez vistas, estados, a11y |
| `lifecode-rag/lib/ui-model.mjs` | no existe | **crear (recomendado)** | funciones puras de presentación, probables con `node --test` |
| `lifecode-rag/tests/ui-model.test.mjs` | no existe | **crear** | L1 |
| `lifecode-rag/tests/fixtures/ui/*.json` | no existe | **crear** | fixtures sintéticos (ids `k1fx`) |
| `lifecode-rag/tests/client.test.mjs` | — | **modificar** | higiene, estados, a11y estática |
| `lifecode-rag/docs/K1-B-EVIDENCE.md` | no existe | **crear** | matriz de vistas + capturas |

## 4. K1-C · cambios proyectados (sólo si el gate se abre)

Se listan para que la matriz sea completa, **no** porque estén autorizados.

| Fichero | Acción | Clase | Nota |
|---|---|---|---|
| `lifecode-rag/lib/ui-api.mjs` | crear | `BACKEND` | rutas §5 del contrato |
| `lifecode-rag/index.js` | modificar (mínimo) | `BACKEND` | registrar la ruta nueva; **no** tocar herramientas ni la API v0.2 |
| `lifecode-rag/lib/resolve.mjs` | modificar (exportar) | `BACKEND` | GAP-04: `projectsForCwd`/`matchingProjects`; cambio aditivo |
| `lifecode-rag/lib/search.mjs` | modificar (añadir) | `BACKEND` | GAP-05: `sourceChunks(db, id, {limit,offset})` |
| `lifecode-rag/lib/sessions.mjs` | modificar | **`SECURITY`** | GAP-09: `UPDATE … WHERE revision = ?` |
| `lifecode-rag/lib/audit.mjs` | modificar (añadir) | **`SECURITY`** | GAP-07: `ui.read` append-only, fail-closed |
| `lifecode-rag/lib/errors.mjs` | modificar (añadir) | `BACKEND` | `revision-conflict`, `audit-unavailable` |
| `lifecode-rag/tests/ui-api-*.test.mjs` | crear | `TESTING` | B/D/E/F/G/H/I |
| `eval/pa-ui-1/evidence/` | crear | `TESTING` | evidencia de PA-UI-1 |

## 5. Protegidos (no se tocan en ninguna etapa de K1)

| Ruta | Por qué | Cómo se vigila |
|---|---|---|
| `lib/tools.mjs` | contrato público v0.1 de las siete herramientas | K-06: hash idéntico a PA3 |
| `lib/exec-context.mjs` | contexto autorizado con cierre en `finally` | K-06 |
| `lib/policy.mjs`, `lib/scope-stores.mjs`, `lib/registry-schema.mjs` | semántica de autorización y esquema | revisión + K-01 |
| `docs/CONTRATO-v0.1.md` | contrato congelado (`a58db7d6…68f1`) | A-02: hash |
| `docs/PA-UI-0-API-CONTRACT.md` | contrato de UI (`93422431…c68a`) | hash |
| `docs/PA-UI-0-ACCEPTANCE.md` | criterios (`d32a4912…47f9`) | hash |
| `docs/PA-UI-0-GAPS.md` | catálogo (`bae51391…d19b`) | hash |
| `docs/PA-UI-0.4-ROUTE-B-EVALUATION.md` | evaluación Ruta B (`0bb29725…4d19b`) | hash |
| `docs/WORKSPACE-UX.md` | UX de referencia (`c895fec4…b1b`) | revisión |
| `lifecode-rag/index.js` | adaptador; sólo cambia en K1-C (una línea de registro) | revisión |
| `lifecode-rag/cordis.patch.yml` | id del plugin = dirección del perfil | `tools/check.mjs` |
| `lifecode-skill-center/**` | otro producto | prohibición explícita |
| `skill-compiler/**` | otro producto | prohibición explícita |
| `~/.dsh/**` (perfil, registro, credenciales, almacenes) | datos del usuario | prohibición explícita |

## 6. Fuera del repositorio (nunca en K1)

| Elemento | Estado | Regla |
|---|---|---|
| `~/.dsh/profiles/desktop/package.json` | `@local/lifecode-rag` en `link:` y en `bundles` | no se toca; **no** hace falta instalar |
| `~/.dsh/profiles/desktop/node_modules/@local/lifecode-skill-center` | copia de GitHub `827b84e` (`client.js` `2490839c…`) | sólo lectura; **no** es el árbol de trabajo |
| `~/.dsh/lifecode-rag/profiles/desktop/registry.sqlite3` | 212 992 B | sólo lectura; ninguna prueba escribe |
| `~/.dsh/lifecode-rag/profiles/desktop/scopes/prj_…/rag.sqlite3` | 3 862 528 B | sólo lectura |
| `~/.dsh/.credentials.yaml` | 727 B | no se lee, no se copia, no se cita |
| Almacén legado `…/rag.sqlite3` | ausente | no se crea |

## 7. Deuda documental registrada (no corregida)

| # | Hecho | Evidencia | Efecto |
|---|---|---|---|
| D-01 | `README.md` cita `KNOWN-LIMITATIONS.md`, que **no existe** | `lifecode-rag/docs/` (26 `.md`, ninguno con ese nombre) | referencia rota |
| D-02 | `ACCEPTANCE.md` §M fija `eval/pa-ui-1/evidence/`; esa carpeta **no existe** | `ls eval/` (pa0…pa6, sin `pa-ui-1`) | la evidencia aún no tiene casa |
| D-03 | `README.md` cita `eval/quality-hardening/m6-initial-project/tools/bootstrap-project.mjs`; existe, pero `eval/` no está versionado | `eval/` es `??` | el bootstrap no viaja con el repo |
| D-04 | El índice del `README.md` no lista ningún documento `PA-UI-0.*` (ni la revisión 0.3, que existe) | `README.md` §Documentación; `docs/` | hueco de índice |
| D-05 | La tarea pide "repositorios" y son **worktrees** de uno solo | `git rev-parse --git-common-dir` | atribución de cambios entre ramas |

## 8. Análisis de colisión

| Recurso | Valor | Colisión posible | Resolución |
|---|---|---|---|
| Id de panel | `lifecode-rag` (ya usado por el panel legacy) | dos paneles con el mismo id | un solo panel: el legacy se conserva para perfiles con almacén v0.2; el PA se decide en `07` K1-D-06 |
| Slot `main` | `key: 'lifecode-rag'` | debe coincidir con el `id` de la fila | invariante verificado por CL-07 |
| Namespace de locale | `lifecode-rag` | ninguno (el Skill Center usa `lifecode-skill-center`) | mantener |
| Prefijo HTTP | `/lifecode-rag/api` (v0.2) vs `/lifecode-rag/ui/api` (PA) | confundirlos y servir el almacén equivocado | prefijos distintos; A-04 lo prueba |
| Id de estilo | `lcr-styles` | duplicación al remontar | `ctx.effect` + aserto de conteo |
| Carpeta de evidencia | `eval/pa-ui-1/` | ninguna existente | se crea sólo en el acto autorizado |

## 9. Regla de cierre de la matriz

Cualquier fichero que una implementación necesite tocar y no esté en §2–§4 se **añade aquí antes** de
tocarlo, con su clase y su gate. Un cambio fuera de la matriz es un cambio no autorizado, aunque el
código compile.
