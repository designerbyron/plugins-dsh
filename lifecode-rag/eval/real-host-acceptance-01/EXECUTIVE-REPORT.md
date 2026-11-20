# Aceptación en host real — LifeCode RAG

**Misión:** `REAL-HOST-ACCEPTANCE-01` · **Modo:** sólo lectura · **Perfil:** `desktop`
**Proyecto:** `LifeCode RAG` (`prj_01M7RBSRD33M26HGBEFW51WPP6`) · **Fecha:** 2026-11-19
**Método:** el almacén real **no se abrió**. Se copiaron `registry.sqlite3` y `scopes/…/rag.sqlite3` a
`…/cache/scratch/lcr-host-snapshot` y se inspeccionó la copia con conexiones `readOnly: true`.

## Resultado

| Punto | Resultado |
|---|---|
| Perfil y proyecto | **PASS** — `desktop`, proyecto `LifeCode RAG` activo |
| Selección de sesión | **PASS** — `session-c90d50d6-…`, `active`, `explicit/human`, revisión 1 |
| Raíz autorizada | **PASS** — `C:\xampp\htdocs\plugins-dhs\lifecode-rag` (`human`) |
| Almacén | **PASS** — 121 fuentes / 964 fragmentos / 964 vectores / 141 auditorías · `quick_check=ok` |
| Inventario (`list`) | **PASS** — 121 fuentes del proyecto |
| Búsqueda (`search`) | **PASS** — 5 aciertos reales, con procedencia y snippet |
| Contexto (`context`) | **PASS** — 1 cita, 289 tokens, sin truncar |
| Recuperación (`get`) | **PASS** — metadatos + 37 fragmentos del documento real |
| Catálogo del **modelo** | **NOT TESTED** — no inspeccionable desde aquí |
| Invocación por el modelo | **NOT TESTED** — no se pilotó el agente del host |
| Integridad final | **PASS** — almacén byte a byte idéntico, `mtime` incluido |

## Lo que sí demuestra esta misión

1. El perfil real está **operativo y con datos**: 121 documentos del propio proyecto, indexados y buscables.
2. Las consultas leen documentos reales (no fixtures): los aciertos apuntan a
   `docs/PROJECT-AWARE-ARCHITECTURE.md`, `docs/PROJECT-AWARE-SESSION-CONTRACT.md`,
   `tests/roots-structure.test.mjs`.
3. La auditoría del almacén registra **133 `lifecode_rag_ingest`** y **8 `lifecode_rag_sync`**: las
   herramientas de escritura se han usado contra este almacén (por el agente o por sincronización manual).
4. **No se modificó nada**: huellas SHA-256 y `mtime` de los 5 ficheros, idénticos antes y después.

## Lo que no demuestra

- Que el **modelo** reciba las siete herramientas y las invoque. El catálogo efectivo vive en el proceso de
  DSH y no hay superficie para consultarlo desde fuera; los logs de sesión están comprimidos (`zstd`).
- Que las lecturas pasen por la herramienta `lifecode_rag_search` y no por la misma capa de lectura usada aquí
  (`ftsSearch`, `assembleContext`, `getSource` — las funciones de producción que sólo leen).

Para cerrar ambos puntos hace falta **una interacción real en el chat de DSH**; la instrucción exacta está en
`MODEL-INVOCATION.md`.

## Hallazgo de diseño: leer por herramienta escribe

`search` (y `context`, que busca por dentro) registran métricas en el almacén del proyecto:
`lib/scope-ops.mjs` pasa `record: scope.kind === 'prj'` y `recordMetrics` escribe en la misma transacción. Es
decir, **hoy no existe "invocación de lectura con cero escrituras"**: la observabilidad forma parte del
contrato. No es un defecto, pero conviene saberlo antes de pedir pruebas «sin tocar nada» — la única lectura
estrictamente inocua es la que se hizo aquí (SQL/FTS sobre una copia).

## Estado de las herramientas

| Herramienta | Registro local | Catálogo del modelo | Invocación real | Resultado |
|---|---|---|---|---|
| ingest | sí | `NOT TESTED` | no usada en esta misión (prohibida) | **PASS** (definición) |
| search | sí | `NOT TESTED` | no observada por el modelo | **PASS** (lectura equivalente) |
| context | sí | `NOT TESTED` | no observada por el modelo | **PASS** (lectura equivalente) |
| get | sí | `NOT TESTED` | no observada por el modelo | **PASS** (lectura equivalente) |
| list | sí | `NOT TESTED` | no observada por el modelo | **PASS** (inventario directo) |
| forget | sí | `NOT TESTED` | prohibida | **BLOCKED** por el encargo |
| reindex | sí | `NOT TESTED` | prohibida | **BLOCKED** por el encargo |

## Respuestas

1. **¿El modelo recibe las siete herramientas?** `NOT TESTED`. El plugin las registra (7/7 definiciones) y el
   host lo carga (panel montado en capturas), pero el catálogo efectivo no es inspeccionable desde aquí.
2. **¿Puede invocarlas?** `NOT TESTED` por la misma razón. Hay evidencia indirecta de uso: 133 ingestas
   auditadas con nombre de herramienta.
3. **¿Las consultas llegan al almacén real?** **Sí** — leído sobre copia del almacén real del perfil.
4. **¿Se recuperan fuentes del proyecto?** **Sí** — documentos del propio repositorio, con `sourceId`.
5. **¿El contexto incluye citas válidas?** **Sí** — 1 cita verificada contra el fragmento real.
6. **¿El aislamiento se conserva?** **Sí** — una única raíz autorizada y una única selección; el ámbito
   resuelto es el del proyecto.
7. **¿El almacén terminó como comenzó?** **Sí, exactamente** — 0 diferencias en SHA-256 y metadatos.
8. **¿Qué queda sin probar?** Catálogo del modelo, invocación real, `forget`/`reindex` (prohibidas aquí) y
   persistencia tras reinicio de DSH.

**Veredicto:** `READ-ONLY HOST ACCEPTANCE — DATA PATH PASS · MODEL INVOCATION NOT TESTED`.
