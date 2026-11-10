# R17 — Aceptación manual de actividad y notificaciones

**Ronda:** R17 · **Tarea:** T36 · **Fecha:** 2026-11-09
**Objetivo:** verificar en un DSH real que la actividad de R17 se persiste, se consulta y se anuncia sin
escribir por leer, sin sondeo y sin conceder nada por su cuenta.
**No sustituye** a la suite automática: la complementa con lo que sólo se ve en el panel vivo.

> **Requisito bloqueante:** reiniciar DSH completo es una **acción humana**. No se hace con
> `disable`→`enable` del plugin ni con recarga del renderer, porque el módulo servidor se evalúa una vez
> al arrancar. Sin reinicio, el backend sigue ejecutando el código anterior y `/api/activity` no existe.

---

## 1. Datos a anotar (antes y después)

| Dato | Cómo | Valor de referencia medido (2026-11-09) |
|---|---|---|
| HEAD | `git rev-parse HEAD` | `3b295106e5263858c32bd4db4c110068a4bad687` |
| Rama | `git branch --show-current` | `feature/visual-operation-feedback` |
| Estado | `git status --porcelain -uall` (sólo lectura) | 1 434 líneas en la medición de docs |
| Almacén | SHA-256 de `center.json` | `9704ee160de8466a4ab6c99cae63b4279b6b5b49a67c1997019ff81b1aea28cc` (52 063 B) |
| Conocimiento | SHA-256 de `knowledge.json` | `e028af3aa402ce84f834cf206ca9cd9c6d2e4dbaad7719fce4c5d1a557545cea` (6 802 B) |
| Política | `knowledge.json` → `policy.projects["plugins-dhs-7e085aaa"]` | `{mode:"guarded-autonomous", updatedAt:"2026-11-09T15:51:58.864Z", by:"human"}` |
| Plugin | `GET /lifecode-skill-center/api/health` | `{ok:true, apiVersion:1, auth:"host"}` |
| Backend | `GET .../api/capabilities` | plugin `1.0.1`, `contractVersion:2`, `implementation:"r16.2"` antes del reinicio |
| Proceso | hora de arranque anotada por la persona | — |

Guardar una copia de ambos JSON antes de tocar nada. Las lecturas no deben cambiar ninguno de los dos.

## 2. Procedimiento (12 pasos)

### A. Línea base (sin reiniciar)

**A1.** Anotar la tabla de §1. **PASS:** los cuatro SHA-256 coinciden con los medidos y el panel abre.

**A2.** Comprobar el discriminador de backend viejo:
`GET http://127.0.0.1:<puerto>/lifecode-skill-center/api/activity?limit=1` desde PowerShell con las
mismas credenciales que usa el panel.
**Esperado:** `404 {ok:false, code:"not-found", message:"esa ruta no es de la API
(/lifecode-skill-center/api)"}`. **PASS:** 404.

**A3.** Abrir el panel y, con DevTools → Network filtrado por `activity`, observar la carga inicial y
30 s de inactividad. **Esperado:** **0** peticiones a `/activity`; el cajón cerrado no consulta.
**PASS:** 0.

### B. Reinicio humano

**B1.** Cerrar DSH por completo (ventana y proceso; no basta recargar la página) y volver a abrirlo con
la misma instalación. **PASS:** la persona confirma el reinicio y anota la hora.

**B2.** Repetir `health` y `capabilities`; después repetir A2.
**Esperado:** `/api/activity?limit=1` responde **200** con `{ok:true, events:[...], nextBefore, total,
sources, ...}`. **PASS:** 200 con `events` array (puede estar vacío si no hay diario).
**Si sigue 404:** el backend no cargó el árbol; parar y no seguir (no es un fallo de R17).

### C. Aviso real de una operación

**C1.** Crear una skill de prueba con un id inequívoco (`aceptacion-r17-<aaaammdd>`), o publicar una
versión nueva de una skill de prueba. **PASS:** aparece un toast arriba a la derecha con título, skill y
botón de acción; **no** se dispara ninguna petición `/activity` (el aviso viene del `POST /state`).

**C2.** Repetir exactamente la misma operación para forzar un replay (doble clic contenido o repetición
del mismo `operationId` si la UI lo permite). **PASS:** no se duplica el aviso; si el backend responde
`replayed:true`, no hay segundo toast.

**C3.** Provocar un fallo controlado (p. ej. operación que exige confirmación/evidencia y se envía sin
ella). **PASS:** toast de error **persistente**, con código y motivo; no hay toast de éxito. Cerrar el
error a mano (× o Escape).

### D. Centro de actividad

**D1.** Abrir el botón de actividad. **Esperado:** **exactamente 1** `GET /activity?limit=20`; el drawer
se monta en ese momento. **PASS:** 1 petición y lista o vacío honesto.

**D2.** Comprobar la fila de la operación de C1: debe existir, con skill, tiempo relativo, y al
expandirla resultado, versión, actor, origen, fuente, confianza y evidencia. **PASS:** todos los campos
presentes salvo los que el evento no tenga; nunca «0» inventado.

**D3.** Probar «Actualizar» (1 petición más, reemplaza), «Cargar más` si `nextBefore` no está vacío
(1 petición con `before=`), y los filtros Todo/Creaciones/Actualizaciones/Self-improvement/
Referencias/Alertas. **PASS:** no hay duplicados ni huecos; el vacío de filtro dice «Ningún resultado
con este filtro», no «sin actividad».

**D4.** Cerrar con Escape y con ×. **PASS:** el foco vuelve al botón de actividad y no queda listener
activo (reabrir sigue consultando una vez).

### E. No leídas y ámbito

**E1.** Antes de abrir el cajón tras C1, comprobar el punto morado del botón. **PASS:** hay punto;
después de abrir, desaparece.

**E2.** En DevTools → Application → Local Storage, verificar
`lifecode-skill-center/activity-seen` = `{v:1,lastSeenAt,ids:[…]}` con ≤200 ids; recargar el panel y
comprobar que la marca persiste. **PASS:** el panel no reescribe `center.json` por abrir el cajón.

### F. Cierre y comparación

**F1.** Volver a calcular SHA-256 de `center.json` y `knowledge.json`. **Esperado:** cambian **sólo** si
se creó/publicó la skill de prueba; las lecturas y el cajón no los tocan. **PASS:** el cambio se explica
por la operación de C1 y por nada más.

**F2.** Anotar PASS/FAIL por paso, la hora de reinicio y el id de la skill de prueba. Si se creó una skill
de prueba, **decidir humanamente** si se retira con la herramienta que el centro ofrezca; si no hay
borrado, dejarla declarada. No borrar a mano ficheros del almacén.

## 3. Criterios PASS (resumen)

| # | Criterio | Evidencia |
|---|---|---|
| 1 | Backend viejo: `/activity` 404 | A2 |
| 2 | 0 peticiones en arranque/inactividad; 0 con cajón cerrado | A3 |
| 3 | Tras reinicio: `/activity` 200 con `events[]` | B2 |
| 4 | Operación real ⇒ 1 toast, sin fetch de actividad | C1 |
| 5 | Sin duplicado en replay | C2 |
| 6 | Error persistente con código; sin éxito falso | C3 |
| 7 | Abrir cajón ⇒ 1 consulta | D1 |
| 8 | Fila con evidencia y sin ceros inventados | D2 |
| 9 | Paginación/filtros sin duplicados ni huecos | D3 |
| 10 | Escape/× devuelven foco; sin listeners residuales | D4 |
| 11 | Punto de no leídas aparece y se limpia; localStorage correcto | E1/E2 |
| 12 | Almacén sólo cambia por la operación de prueba | F1 |

## 4. Qué NO prueba esta aceptación

- **No prueba push del Host:** no existe canal público Host→plugin; con el panel cerrado no hay aviso.
- **No prueba notificaciones del sistema operativo** ni entre ventanas/perfiles.
- **No prueba autoría criptográfica:** el actor se deriva del canal (`human/agent/system/external/
  unknown`), no de una firma; un cliente que mienta en el canal puede falsearla.
- **No prueba orden estable** entre eventos del mismo milisegundo (se desempata por `eventId`).
- **No prueba rendimiento:** eso es `tools/r17-perf.mjs` + `r17-perf-after.json` (task-38), no esta guía.
- **No prueba concurrencia multi-proceso** ni migraciones; el recorte a 4000 eventos por diario sigue.
- **No prueba el modo legacy/incompatible:** el cajón depende del handshake; sin contrato 2 el panel
  muestra el aviso de compatibilidad, no actividad.

## 5. Cómo distinguir una notificación real de un fixture

| Señal | Real | Fixture/captura |
|---|---|---|
| Origen | La provoca una acción del usuario en el panel | Render `node:vm` con eventos sintéticos |
| Persistencia | El `eventId` aparece en `center.json.events` y en el cajón tras recargar | No toca el almacén |
| Datos | Skill/proyecto reales de la biblioteca | `skill-demo`, `centro-a`, fechas fijas |
| Red | `POST /state` seguido del toast; **sin** `GET /activity` | Sin red: HTML estático |
| Repetición | Repetir la acción produce un evento nuevo | Las capturas no cambian |
| Alcance | Sólo en este panel | No hay notificación con el panel cerrado |

Las capturas `_audit/r17-{before-toast,after-toast,after-drawer,after-indicator}.png` son **renders**,
no el panel vivo; su procedencia está declarada en `_audit/r17-render.mjs:1-2` y en
`R17-NOTIFICATIONS-UX.md` §12.

## 6. Plantilla de resultado

```
Fecha/hora:
HEAD / rama:
Reinicio (hora, quién):
center.json antes/después:
knowledge.json antes/después:
Política antes/después:
Backend antes: implementation=... contractVersion=...
Backend después: implementation=... contractVersion=...
A1..F2: PASS/FAIL + nota
Skill de prueba (id):            destino: retirada / declarada
Observaciones:
```
