# LifeCode RAG — Políticas y automatización

**Fecha:** 2026-11-17 · **Estado:** diseño propuesto (no implementado)
**Regla madre:** la automatización nunca concede lo que una persona no autorizó; el motor de políticas
puede denegar, nunca aprobar.

---

## 1. Tres niveles

| Nivel | Quién decide | Ejemplos | Efecto si falta el permiso |
|---|---|---|---|
| **Automático** | Política vigente | recuperar, contar métricas, diagnosticar, exportar auditoría, indexar dentro de raíces ya autorizadas | se ejecuta o se omite; nunca pide |
| **Confirmación** | Persona, en el host o la UI | cambiar proveedor de embeddings, ampliar raíces, reindexado `all`, bajar retención de métricas | no se ejecuta; queda como propuesta |
| **Aprobación** | `ctx.approval.request` (solo `allowed-once`) | `forget`, acceso a rutas fuera de raíces, egress, purga masiva, operaciones destructivas | `approval-required` / `approval-unavailable` |

La desactivación de RAG no borra nada. La desinstalación no borra el almacén.

## 2. Qué es automático de verdad

### 2.1 Recuperación automática — límite real del host

**Corregido en PA6 (reconciliado 2026-11-18):** el host sí expone `agent/pre-step` y el plugin Project-Aware inyecta contexto con él (`lifecode-rag/index.js`, `lib/auto-context.mjs`). La v0.2 sigue sin inyectar porque su recuperación es de otro almacén. Texto original conservado por trazabilidad: no existía un punto de extensión verificado que permitiera **inyectar texto recuperado antes de
cada llamada al modelo**. `systemPrompt.section` añade instrucciones, no contenido por turno; escuchar
`system-prompt/assemble` está desaconsejado por la guía del host. Por tanto:

- **v0.2 no promete recuperación automática invisible.** Prometerla sin un hook sería mentir.
- Lo que sí se ofrece: una sección de prompt **opt-in** (`autoRetrieval.enabled=false` por defecto) que
  instruye al agente a usar `lifecode_rag_search`/`lifecode_rag_context` cuando la pregunta toque
  conocimiento del proyecto, con un presupuesto declarado.
- El agente sigue decidiendo la consulta; el motor no adivina.

Esta limitación se revisa en cada actualización del host; si aparece un hook (`agent.beforeModelCall` o
equivalente), se documenta y se evalúa con benchmark.

### 2.2 Indexación automática

Permitida solo dentro de `roots` ya autorizadas y con presupuesto:

```json
{
  "version": 1,
  "roots": ["C:/proyecto/docs"],
  "autoIndex": { "enabled": false, "intervalMinutes": 15, "maxFilesPerRun": 50, "maxBytesPerRun": 10485760 },
  "autoRetrieval": { "enabled": false, "budgetTokens": 1200, "maxChunks": 6 },
  "retention": { "metricsDays": 90 },
  "workspace": { "refreshSeconds": 30 }
}
```

- Se ejecuta **como mucho** cada `intervalMinutes`, y solo si no hay turno abierto (`agents.turnBoundaryOf`)
  y hay sesión activa. Si el host no permite saberlo, **no indexa**: la duda no autoriza.
- Compara `(size, mtime)` y digest antes de leer: un fichero sin cambios no se re-extrae.
- Un fallo por fichero se registra y no aborta el lote; el lote termina con `{ingested, skipped, errors}`.
- Nunca amplía raíces: una ruta nueva fuera de `roots` exige confirmación y, si está fuera del proyecto,
  aprobación por llamada como en la tool.
- Cancelación: `signal` del host o botón de la UI; se comprueba entre ficheros.

### 2.3 Diagnóstico y mantenimiento

- `doctor` y comprobación de integridad FTS: automáticos, solo lectura.
- `reindex fts`: automático si la integridad falla (reconstrucción derivada, no destruye datos).
- `reindex vectors`: confirmación; recorre todos los vectores y puede tardar.
- `forget`: siempre aprobación con alcance exacto (`sourceId`, URI, nº de chunks).
- Exportación de auditoría: automática (fichero derivado, regenerable).

## 3. Evaluador

```js
/**
 * @returns {{decision:'allow'|'confirm'|'approve'|'deny', reason:string, code?:string, scope?:object}}
 */
evaluate(action, context)
```

`action` — `retrieve | ingest | reindex | forget | config.change | root.add | egress | purge`.
`context` = `{actor:'model'|'human'|'automation', sessionId, agentId, insideRoots, isProtected, egress, destructive}`.

### 3.1 Clasificación de purgas (única fuente; `OBSERVABILITY.md` §7 la referencia)

| Operación | Nivel | Alcance obligatorio | Nota |
|---|---|---|---|
| purga rutinaria > `metricsDays` | automático | `{kind:'retention'}` | dentro de la retención ya autorizada; solo métricas |
| bajar `metricsDays` | confirmación | `{from,to}` | no borra hasta confirmar |
| purga anticipada de métricas | confirmación | `{before}` | conserva lo que quede dentro de la nueva retención |
| purgar todo el histórico de métricas | aprobación | `{all:true}` | auditoría con recuento borrado |
| borrar el almacén | aprobación | `{store:true}` | exige copia previa verificable |

Una purga **nunca** toca `sources`, `chunks`, `vectors` ni la auditoría: esas filas no son telemetría.

### 3.2 Orden de evaluación (fail-closed)

1. ¿Ruta protegida (Skill Center, almacén propio)? —  `deny` `path-denied`.
2. ¿Ruta fuera de raíces? —  `approve` (una vez) o `deny` si no hay servicio de aprobación.
3. ¿Purga? —  nivel de §3.1; `scope` obligatorio; sin `scope` es `deny`, no una aprobación genérica.
4. ¿Acción destructiva? —  `approve` con `scope` obligatorio.
5. ¿Cambio de proveedor/raíz? —  `confirm`.
6. ¿Dentro de política automática y presupuesto? —  `allow`.
7. Cualquier duda —  `deny`.

El evaluador **no** llama a `approval`; devuelve la decisión y el llamador (tool/ruta) pide la aprobación.
Así una ruta HTTP no puede aprobar por sí misma.

## 4. Integración con el host

- `ctx.approval.request({agent, toolName, reason, callId})`; solo `allowed-once` concede.
- Sin `approval` disponible —! `approval-unavailable` (fail-closed), nunca «seguir sin permiso».
- La UI muestra el estado «pendiente de aprobación»; no tiene botón de aprobar.
- Toda decisión (pedida/concedida/rechazada) se audita con `action`, `target`, `outcome`.

## 5. Auditoría de políticas

Cambiar `policies.json` es una escritura sensible:

- validación completa antes de escribir (desconocido —! `invalid-config`; nunca se ignora en silencio);
- escritura atómica (tmp + fsync + rename) y `updated_at`;
- evento `policy.change` en la cadena de auditoría con el diff de claves (no valores secretos);
- la configuración efectiva se puede leer por `GET /config`, sin secretos.

## 6. Presupuestos y degradación

- La indexación automática tiene techo por ejecución; al alcanzarlo para y reporta `truncated`.
- La recuperación automática tiene presupuesto de tokens; si no cabe, devuelve vacío con `truncated`
  (nunca recorta un chunk a la mitad).
- Si el almacén está bloqueado (`store-busy`), la automatización reintenta una vez y desiste; no martillea.
- Si el proveedor de embeddings falla, la recuperación híbrida degrada a FTS y lo declara en `mode`.

## 7. Matriz de pruebas

| Caso | Esperado |
|---|---|
| Ruta con segmento `lifecode-skill-center` | `path-denied`, sin abrir almacén |
| Ruta fuera de raíz sin aprobación | `approval-required`, sin escritura |
| `forget` sin `scope` | error de validación, no aprobación genérica |
| `reindex all` sin confirmación | `confirm` (no ejecuta) |
| Automatización con presupuesto agotado | `truncated:true`, sin excepción |
| `approval` ausente | `approval-unavailable` |
| Cambio de config con clave desconocida | `invalid-config`, fichero intacto |
| Política con `roots` que incluye Skill Center | rechazo al guardar, no al usar |
| Purga rutinaria dentro de retención | `allow`, solo `metrics_daily` |
| Bajar `metricsDays` | `confirm`, sin borrar hasta confirmación |
| Purga total de métricas sin `scope` | `deny`, sin borrado |
| Borrar almacén | `approve` + copia previa; sin copia, `deny` |
| Purga con `sources` en el alcance | `deny` (no es telemetría) |

## 8. Sincronización periódica (M6.7)

El programador de `lib/sync-scheduler.mjs` sustituye a la automatización v0.2 sólo cuando el perfil
tiene registro Project-Aware. Se apoya **exclusivamente** en `ctx.timer.interval` del host.

### 8.1 Interruptor

- `automation.enabled` se lee al arrancar el programador y en cada tick, desde
  `<profileRoot>/config.json`.
- Cambiar el fichero con el plugin ya cargado **no arranca ni detiene** el temporizador: hay que
  recargar el plugin (`plugin_manager` con `enabled:false` y luego `true`) para que `apply` vuelva a
  ejecutarse. Es el procedimiento de activación y desactivación soportado.
- Al descargar el plugin, el `ctx.effect` ejecuta `stop()`: cierra el disposer del temporizador y
  aborta la pasada en curso por el `AbortSignal` propio del programador.

### 8.2 Presupuesto y degradación

| Situación | Respuesta |
|---|---|
| Presupuesto del tick agotado | corte entre ficheros, `stop_reason='budget'`, `outcome='partial'` |
| Límite de ficheros alcanzado | `stop_reason='file-limit'`, resto para la pasada siguiente |
| Tick solapado | no se ejecuta; `skippedTicks+1`, `lastSkipReason='already-running'` |
| Fallo de una pasada | `consecutiveFailures`, backoff `2^(n-1)` hasta 8 intervalos |
| Sin registro en el perfil | `{skipped:true, reason:'no-registry'}`, sin ruido por tick |
| Sin temporizador del host | `start()` devuelve `no-timer`; no hay respaldo global |

Un fallo no detiene el host ni desactiva el programador: se cuenta, se audita y se reintenta con
backoff. El reintento nunca repite efectos destructivos inciertos (el ledger y `effect_key` siguen
mandando).

### 8.3 Aprobaciones

La sincronización periódica no pide aprobación por fichero: trabaja dentro de raíces ya autorizadas y
su compuerta es la autorización por ámbito (`assertScopeSyncable`) y la revocación entre ficheros. La
egreso sigue cerrado: sin proveedor remoto, o `egress-denied`. Ninguna ejecución automática ejecuta
`forget`, `reindex` ni `ingest` con rutas fuera de raíz.

## 9. M6.8 — medición del presupuesto y observabilidad del backoff

Dos ajustes operativos salidos de M6.8. No cambian el contrato ni la política: cambian cómo se mide el
tiempo y qué se puede ver del scheduler.

### 9.1 El presupuesto se mide con reloj monotónico

`automation.tickBudgetMs` se compara ahora contra `performance.now()` (reloj monotónico de
`node:perf_hooks`), no contra `Date.now()`. Motivo: un ajuste de hora (NTP, cambio de zona, suspensión
del equipo) podía alargar un tick sin límite —si el reloj retrocede, la condición de fin no se cumple— o
cortarlo antes de tiempo.

- El corte sigue ocurriendo **entre ficheros**, en dos puntos: antes de abrir el lote de pendientes y
  dentro de `authorize`, que corre antes de preparar y escribir cada fichero. Nunca dentro de una
  transacción.
- El reloj de pared se usa **solo** para marcas persistidas (`operation_steps`, `sync_state`, auditoría)
  y para el campo informativo `ms`.
- `syncScope`/`syncScopes` aceptan `monotonic` como dependencia opcional para pruebas; el scheduler lo
  propaga.

### 9.2 El backoff se puede observar

`status()` expone ahora, además de lo anterior:

| Campo | Significado |
|---|---|
| `consecutiveFailures` | Fallos consecutivos del tick (no de un fichero) |
| `lastError` | Último error (`code`, mensaje), o `null` |
| `nextAttemptAt` | Instante del próximo intento tras un fallo, o `null` |
| `backoffFactor` | `min(2**(n-1), 8)`; `0` sin fallos |
| `backoffRemainingMs` | Milisegundos que faltan hasta `nextAttemptAt` |
| `skippedTicks` / `lastSkipReason` | Ticks omitidos y por qué (`already-running`, `backoff`, `disabled`) |
| `effective` | Política aplicada: intervalo, ficheros por pasada y presupuesto |

Fórmula: `nextAttemptAt = lastAttemptAt + intervalMs * min(2**(n-1), 8)`. El primer fallo ya espera ×2:
no hay reintento inmediato. Un fallo **de fichero** no es un fallo **de tick** y no activa backoff.

### 9.3 Desactivar surte efecto inmediato

Si `automation.enabled` pasa a `false` durante un backoff, el siguiente tick lo detecta antes de
comprobar la espera, la cancela y resetea contador y `nextAttemptAt`. `stop()` hace lo mismo. No queda
una espera preparada para el siguiente arranque.

### 9.4 Límites declarados

- El backoff y el corte por presupuesto están probados de forma determinista con reloj y temporizador
  inyectados, pero **no** se han provocado en el host real: exigía romper la configuración del perfil o
  un árbol artificial dentro de la raíz autorizada.
- El scheduler sigue siendo de una sola instancia por proceso; no hay lease entre host y CLI (ver
  `RISK-REGISTER.md`, R-02).
