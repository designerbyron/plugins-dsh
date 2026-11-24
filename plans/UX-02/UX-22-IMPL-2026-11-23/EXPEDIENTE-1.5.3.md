# Expediente de aceptación — LifeCode RAG 1.5.3

**Fecha:** 2026-11-23/24 · **Rama:** `feat/ux22-tracking` (HEAD `7d7e839` + 27 ficheros del propietario, sin commitear)
**Dictamen del artefacto:** **APTO** (auditoría independiente, 8/8 comprobaciones, sin bloqueantes)

## 1. Artefacto

| Dato | Valor |
|---|---|
| Fichero | `designerbyron-lifecode-rag-1.5.3.tgz` |
| Directorio | `C:/xampp/htdocs/rc153-artifacts/` (fuera del árbol auditado) |
| Versión npm · contrato PA · registro | **1.5.3** · `pa/1.5.0` (sin cambios) · v3 |
| Tamaño · ficheros | **349 523 B** · **77** |
| SHA-256 | `e23105a61715d8b0e445e25043b8eac3713fa797fbb8ae3cfffdf2edb74cd5f5` |
| SHA-512 | `e076ef27bdb134d66e02f80ff1a0f44c9ba4e33bbdce8ed62620517323292e4ba2fcc0162efdb47a0d4e289dd446131bf5fbf03c993d1f1b3933ab3d6555a1ab` |
| Staging ↔ TAR | **77/77 byte a byte**, `package.json` incluido |
| Árbol ↔ TAR | 76/77 idénticos; único distinto `package.json` (sin `scripts`) |
| Delta 1.5.2 → 1.5.3 | **sólo** `client.js`, `package.json`, `README.md` — `lib/**`, `index.js`, `bin/`, `cordis.patch.yml`, `docs/**` intactos |

**Fuente reproducible:** `<REPO_ROOT>`. (`plugins-dhs/lifecode-rag` es un árbol obsoleto de 1.0.0: no usar.)

## 2. Puertas

| Puerta | Resultado |
|---|---|
| Suite | **674/674 PASS**, 0 fail |
| `tools/check.mjs` | verde |
| `test:hermetic` | `✓ el almacén real no cambió (6 ficheros)` |
| Ciclo de carga (18 pruebas) | 18/18 |
| Suite de seguimiento/contratos (158 pruebas) | 158/158 |

## 3. Criterio 1 de UX-2.2 — CERRADO con reinicio real

| Paso | Evidencia |
|---|---|
| Estado inicial | panel: `1 workspaces · Seguidos: 0 · Sin seguimiento: 1`, revisión 0 |
| Activación desde el panel | `Seguimiento actualizado (revisión 1)`; `Seguidos: 1`; fila `Seguido`, «sin proyecto asociado — no resolverá contexto» |
| Registro aislado (lectura) | `{path_key: c:/users/byron/documents/deepseek-harness/default-workspace, state: on, association: pending, project_id: null, bound_by: human, bound_at: 1795495285386, revision: 1}` |
| Reinicio del Host | procesos del laboratorio parados y relanzados (no reconexión SQLite) |
| Después del reinicio | panel: `Seguidos: 1`, fila `Seguido`, **revisión 1**; Resumen 0/0/0 % |

## 4. Defectos corregidos en esta cadena (1.4.0 → 1.5.3)

1. **Registro no inicializado** — todo abría con `create:false`; un perfil nuevo daba `registry-unavailable` en las cinco vistas. → `ensureRegistry` idempotente al cargar (`D-IMPL-12`).
2. **Fixture presentado como datos reales** — el panel se sembraba con el fixture y `hydrate` sólo aceptaba `projects` no vacío; decía «Servicio: ok» con cifras sintéticas. → estado inicial vacío, `projects` literal, demo sólo explícita y anunciada, procedencia visible.
3. **Spinner permanente en Seguimiento** — el efecto se mataba a sí mismo: despachaba `workspaces-ok` (`pending:null`, única dependencia) dentro de su propio ciclo, y la respuesta de `/tracking` se descartaba. → identidad de generación, `AbortController` + timeout 10 s, toda salida cierra `loading`.

## 5. Limitaciones conocidas (no bloqueantes)

- **L10** · Una llamada directa `request('/tracking')` en `client.js:4901` (recuperación tras CAS) no usa la ruta única ni es abortable; no puede reproducir el fallo (siempre despacha `tracking-mutation-error` → `loading:false`). Candidata a 1.5.4.
- **L11** · El código de fallo de transporte pasó de `transport-error` a `network`; se pinta como código, no como frase traducida.
- L1-L9 (eje B sólo escribe `ok`, seguimiento permanente, `paused` bloquea `cwd`, etc.) siguen vigentes: ver `ACEPTACION-UX22-R2.md`.
- **Aislamiento**: el `default-workspace` del laboratorio apunta a `C:\Users\BYRON\Documents\deepseek-harness\default-workspace` — carpeta del propietario. El **almacén** del plugin es aislado; para `ingest` hace falta un proyecto con raíz autorizada que no toque datos personales.

## 6. Pendiente

| # | Tarea | Estado |
|---|---|---|
| 1 | API real: GET/PUT/DELETE, CAS, CSRF, 409, `store-busy` | PUT ejercitado desde el panel (rev 0→1); negativos pendientes |
| 2 | Siete herramientas RAG en sesión autenticada | **bloqueado**: requiere proyecto con raíz autorizada sintética (decisión del propietario) |
| 3 | Persistencia tras reinicio | **hecho** (§3) |
| 4 | Actualizar matriz, estado, roadmap, continuidad, CHANGELOG | pendiente |
| 5 | Auditoría funcional final y cierre del expediente | pendiente |

## 7. Integridad

- Almacén real del propietario: 6 ficheros, hashes `b15622c0`, `4b67cadc`, `4dcf31c4`, `6130ecba`, `fd4c9fda`, `e3b0c442` — idénticos al inicio de la cadena. Sin instalación en el perfil `desktop`.
- Roots y grants: sin modificar. Sin operaciones destructivas. Sin publicación npm, sin push, sin commits.
- Laboratorio: `<LAB_ROOT>` con `DSH_HOME` y `--user-data-dir` propios; registro propio v3.
