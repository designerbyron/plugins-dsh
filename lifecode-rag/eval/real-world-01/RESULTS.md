# Datos reales: resultados de la aceptación

**Acto:** `REAL-WORLD-ENABLEMENT-01` · 2026-11-19 · rama `fix/t45-4-r17-acceptance` @ `b6c0cd2`
**Almacén de aceptación:** `eval/real-world-01/store` (SQLite real en disco, perfil `real-world-01`).
**Documentos:** tres ficheros reales en `eval/real-world-01/docs` (reembolsos, turno, borrador). Sin datos
personales.

## 1 · Lo que se ha implementado

| Cambio | Qué resuelve |
|---|---|
| CLI `project create` / `project list` | Alta de proyecto sin script externo; inicializa el registro sólo con `--create`. |
| CLI `root add` / `root list` | Autorización explícita de una carpeta como raíz del proyecto, con `pathKey` canónico. |
| CLI `select` / `session show` | Selección explícita por sesión (`selection_source='explicit'`, `selected_by='human'`), idempotente. |
| `ingest` devuelve `reason` | Un duplicado ya no es opaco: `unchanged` / `tags-updated`. |
| README | Procedimiento real de alta y uso; índice de documentación y evidencia. |

Nada de esto toca el panel ni habilita subagentes.

## 2 · Flujo de aceptación (12 pasos del encargo)

| # | Paso | Resultado | Evidencia |
|---|---|---|---|
| 1 | Registrar proyecto | `prj_01M7TMQESBYX8MZY4X13PFFAP3` | `project-id.txt` |
| 2 | Autorizar raíz | `pathKey=…/eval/real-world-01/docs` | `root.json` |
| 3 | Seleccionar proyecto | **no usado en la corrida**: el proyecto se resuelve por `cwd` (mecanismo del agente). `select` probado aparte en la suite CLI | `tests/cli-registry.test.mjs` |
| 4 | Incorporar documentos | 3 fuentes, 3 fragmentos, 0 errores | `ingest.log` |
| 5 | Buscar | `ZX-4471` → 3 resultados, primero `politica-reembolsos.md` | `ingest.log` |
| 6 | Construir contexto | 3 citas, 402 tokens | `ingest.log` |
| 7 | Recuperar documento | `get` → 1 fragmento con el código | `ingest.log` |
| 8 | Listar | `{total:3}` con las tres URIs | `ingest.log` |
| 9 | Eliminar fuente de prueba | `forget` → `borrador-temporal.md` | `ingest.log` |
| 10 | Ya no aparece | `list {total:2}`; la fuente borrada no está en resultados | `ingest.log` |
| 11 | Reindexar | `{operation:'fts', rebuiltChunks:2}`; búsqueda posterior sigue funcionando | `ingest.log` |
| 12 | Persistencia en otro proceso | proceso nuevo: `list {total:2}`, `ZX-4471` → `politica-reembolsos.md`, `contieneCodigo=true`, almacén 147 456 B | `verify.log` |

**Los pasos 4-11 corren en un proceso; el 12 en otro.** Lo que ve `verify` lo leyó del disco.

## 3 · Aislamiento

Proyecto B (`docs-b/otro-proyecto.md`) registrado con raíz propia:

- `list` en B antes de ingerir: 0 fuentes.
- `get` cruzado de una fuente de A: **`source-not-found`**.
- `search` de `ZX-4471` desde B: sólo devuelve `otro-proyecto.md`.

`isolation.log`. Sin fugas.

## 4 · Estado de las siete herramientas con datos reales

| Herramienta | Resultado | Clasificación |
|---|---|---|
| `ingest` | 3 fuentes; duplicado → `skipped/unchanged` | **PASS** |
| `search` | aciertos con procedencia; `mode` honesto | **PASS** |
| `context` | citas verificables y presupuesto | **PASS** |
| `get` | fuente + fragmento; código presente | **PASS** |
| `list` | 3 → 2 tras borrar | **PASS** |
| `forget` | fuente eliminada de resultados | **PASS** |
| `reindex` | reconstruyó 2 fragmentos sin corromper | **PASS** |

## 5 · Defecto observado y no corregido (P3)

`search` es híbrida: devuelve aciertos **vectoriales** aunque no haya coincidencia léxica. En la corrida,
tras borrar `borrador-temporal.md`, la consulta `BORRAME-9988` devolvió **2 fuentes sin snippet** con
`mode: 'none'`. No es una fuga —no aparece la fuente borrada y cada resultado respeta el ámbito— pero es ruido
para el agente.

- El resultado ya declara `mode: 'none'` (sin coincidencia léxica) y esas filas no traen `snippet`.
- El embedder local es determinista, no semántico: su similitud no debe interpretarse como relevancia.
- **No se cambia el ranking en este acto**: hacerlo altera el comportamiento de búsqueda sin decisión del
  propietario y podría vaciar búsquedas que hoy funcionan. Opciones medidas para un acto posterior: umbral de
  coseno para aciertos sólo-vectoriales, o exponer `strategy: 'fts'` en la herramienta.

## 6 · Perfil real `desktop` (comprobación de sólo lectura)

`DSH_PROFILE=desktop node bin/lifecode-rag.mjs diagnose` — **sin modificar nada**:

| Dato | Valor |
|---|---|
| Registro | 212 992 B · `quick_check=ok` · FK=0 · auditoría 41 enlaces OK · 0 operaciones sin cerrar |
| Proyecto | `LifeCode RAG` (`prj_01M7RBSRD33M26HGBEFW51WPP6`), `present` |
| Raíz autorizada | `C:\xampp\htdocs\plugins-dhs\lifecode-rag` (`human`) |
| Contenido | **121 fuentes / 964 fragmentos / 964 vectores** · sincronización `present=121` |
| Selección | `session-c90d50d6-…`: `active`, `explicit/human`, revisión 1 |
| Configuración | `automation=off`, `autoContext=off` |

Es decir: **el perfil real ya está inicializado y con datos**, y su diagnóstico no encuentra problemas. El
almacén de aceptación (`eval/real-world-01/store`) se usó para demostrar el ciclo completo sin tocar ese
perfil.

## 7 · Lo que NO está verificado

| Punto | Estado | Motivo |
|---|---|---|
| El modelo invoca las herramientas dentro de DSH | **NOT TESTED** | No puedo pilotar el agente del host; se probó la ruta de código que el host usa. |
| Reinicio de DSH y persistencia posterior | **NOT TESTED** (host) | Persistencia probada entre procesos; el reinicio añade la carga del plugin, ya verificada en capturas. |
| Sesiones hijas sin acceso | **BLOCKED** | Delegación desactivada; el plugin no recibe linaje (ver `SUBAGENT-PROTECTION.md`). |
| Panel con datos reales | **BLOCKED** | Sin API de proyección en el host extraído (ver `PANEL-STATE.md`). |

## 8 · Pruebas

- `node --test`: **323/323** (320 previas + 3 de la CLI).
- `tools/check.mjs`: ok (7 herramientas, G3).
- `tools/hermetic.mjs` con el entorno limpio: **almacén real sin cambios (5 ficheros)**.
- Aceptación real: `ingest.log`, `verify.log`, `isolation.log`, `probe.mjs` (sonda del ruido vectorial).

> Aviso operativo: `LIFECODE_RAG_ROOT` exportado en la shell desvía también `hermetic.mjs` al almacén de
> pruebas. La verificación hermética final se hizo con el entorno limpio (5 ficheros, huella estable).
