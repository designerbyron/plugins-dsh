# Informe de candidata — LifeCode RAG

**Acto:** preparación de versión candidata y aceptación funcional · **Fecha:** 2026-11-19
**Base:** `fix/t45-4-r17-acceptance` @ `b6c0cd2`, sin commit ni push.

## Las doce preguntas

**1 · ¿LifeCode RAG ya se puede utilizar para trabajar?**
**Sí, como plugin de agente.** Las siete herramientas funcionan de extremo a extremo sobre un almacén aislado
(13 pasos, 320 pruebas). **No** como producto de escritorio completo: el panel sigue siendo demostración con
fixtures y los subagentes no tienen acceso.

**2 · ¿Cuáles de las siete herramientas funcionan realmente?**
Las siete: `ingest`, `search`, `context`, `get`, `list`, `forget`, `reindex`, con autorización por sesión y
aislamiento por proyecto verificados en el humo.

**3 · ¿El panel utiliza datos reales o fixtures?**
**Fixtures.** `DATA_MODE='fixture'` en código; la capa de red falla cerrada. El motivo no es técnico del
plugin: no hay transporte que el host pueda autenticar por sesión (PA01/D-UI-03).

**4 · ¿La integración DSH está operativa?**
**Parcial.** El host carga el plugin y monta el panel (verificado por capturas). El registro de las siete
herramientas en `ctx.tools` está implementado y probado en local; la lista de herramientas del modelo en el
host **no se ha inspeccionado**.

**5 · ¿Los subagentes pueden acceder de forma segura?**
**No.** En este perfil no hay herramientas de delegación (desactivadas en el bundle web) y el plugin no recibe
señal de linaje para distinguir un hijo. Sin esa señal, cualquier control sería falso. Diseño y cambio mínimo
en `SUBAGENT-AUTHORIZATION.md`.

**6 · ¿Se ha probado una delegación real?**
**No.** `BLOCKED`. No se declara resuelto.

**7 · ¿Qué gates siguen bloqueando funcionalidades?**
PA01, D-UI-03, Ruta A, G6 (panel con datos reales); Ruta B y Q-06/TI-7 (aislamiento y revisor); GAP-20
(limitación del host, documentada). Ruta C no aceptada.

**8 · ¿Qué defectos permanecen?**
Abiertos por diseño: el panel no ejecuta operaciones reales (gate humano); el historial no existe (sin ruta
contractual); el detalle de fuente no pagina fragmentos (GAP-05). Corregido en este acto: el duplicado de
`ingest` ahora explica el motivo (`reason: 'unchanged'`).

**9 · ¿Qué pruebas se ejecutaron y cuáles pasaron?**
`node --test`: **320/320**. `tools/check.mjs`: ok. `tools/hermetic.mjs`: almacén intacto (5 ficheros). Humo de
13 pasos: 13/13. Responsive: 40/40 sin desbordamiento. Paridad ES/EN: PASS. Consola/DOM/desmontaje en host:
`NOT TESTED`.

**10 · ¿Qué cambios se realizaron?**
`lib/ingest.mjs`: `skipped`/`tags-updated` ahora exponen `reason` (los duplicados explicaban el motivo sólo de
forma implícita), con su regresión en `tests/ingest.test.mjs`. `README.md`: índice de documentación completo
(faltaban los `PA-UI-0.*`, `WORKSPACE-UX` y las carpetas de evidencia). Nada más: la auditoría no encontró
defectos en las siete herramientas que justificaran tocar su lógica.

**11 · ¿Qué queda pendiente de una decisión humana?**
D-UI-03 (riesgo del transporte del panel), elección de vía para datos reales (proyección de sesión vs
capacidad), y Q-06/TI-7 (revisor de la Ruta B). Y, si se quiere delegación, autorizar el cambio de perfil del
laboratorio y la exposición de linaje.

**12 · ¿Cuál es el procedimiento exacto para empezar a usar el producto?**
1. El plugin ya está instalado por enlace en el perfil `desktop` (verificado en capturas).
2. Diagnóstico: `node bin/lifecode-rag.mjs doctor` (el CLI cubre doctor, auditoría, bibliotecas y
   sincronización; **no** crea proyectos).
3. Proyecto y raíces: se registran en el registro del perfil y se seleccionan por sesión antes de la primera
   llamada. Esa selección hoy la hace el host; el panel en fixtures no la emite.
4. Uso desde el agente: `ingest` → `search` → `context` → `get` → `list`; `forget` y `reindex` exigen
   aprobación humana (`allowed-once`).
5. Comprobación: `node bin/lifecode-rag.mjs audit verify` sobre la cadena de auditoría del perfil.

## Tabla final

| Capacidad | Implementada | Probada | Host verificado | Estado |
|---|---|---|---|---|
| ingest | sí | sí (humo 7-8) | no | **PASS (local)** |
| search | sí | sí (humo 2, 6) | no | **PASS (local)** |
| context | sí | sí (humo 3) | no | **PASS (local)** |
| get | sí | sí (humo 4-5, 11) | no | **PASS (local)** |
| list | sí | sí (humo 1, 12) | no | **PASS (local)** |
| forget | sí | sí (humo 10 + sonda) | no | **PASS (local)** |
| reindex | sí | sí (humo 9) | no | **PASS (local)** |
| Project-Aware | sí (fixtures) | sí (render + 9 capturas host) | parcial | **BLOCKED** para datos reales |
| Persistencia | sí (SQLite por perfil) | sí (suite + hermético) | sí (almacén real intacto) | **PASS** |
| Subagentes seguros | diseño | no | no | **BLOCKED** |
| Integración DSH | sí (registro) | sí (local) | parcial | **PARTIAL** |

## Veredicto

**Candidata utilizable como plugin de agente; no como producto de escritorio con datos reales.** La brecha que
queda no es de código del plugin: es el transporte autenticado (decisión humana) y el linaje de subagentes
(cambio de host).

## Bloqueos restantes

1. D-UI-03 / PA01 — panel con datos reales.
2. Subagentes — habilitación controlada + linaje.
3. Host — verificación de consola, DOM, desmontaje y lista de herramientas.

## Instalación y comprobación

```sh
cd lifecode-rag
npm install
npm test                 # 320/320
npm run test:hermetic    # almacén intacto
node tools/check.mjs     # estructura y G3
node eval/product-readiness-01/smoke-tools.mjs   # humo de las 7 herramientas
```

No se ha hecho push, merge ni release. Sin autorización específica, no se hará.
