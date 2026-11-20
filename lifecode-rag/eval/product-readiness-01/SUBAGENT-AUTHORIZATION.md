# Subagentes: autorización explícita (diseño y estado real)

## Qué hay hoy, verificado

| Pieza | Estado | Evidencia |
|---|---|---|
| Herramientas de delegación en el perfil desktop | **desactivadas** | `dsh-web-app/cordis.patch.yml` §586-601: `tool-subagent`, `tool-subagent-fork` y `tool-subagent-control` con `disabled: true` |
| Backends `spawn`/`fork` | instalados en el host | `dsh-base/cordis.patch.yml` §364-409 |
| Herramientas RAG | registro **global**: las ve cualquier agente del proceso | `index.js` §49; `dsh-tools/README.md` §31, §89 |
| Autorización de las herramientas | **por sesión y proyecto** (`session_scope` → `effectiveScopes`), revalidada en cada llamada | `lib/revocation.mjs`, `lib/resolve.mjs`; humo pasos 11-13 |
| Identidad | `agent.id` (SessionId del host), ligada al perfil | `lib/session-identity.mjs` |
| Apronación en hijos | el host fija `approval: never` → rechazo determinista | `child-agent.ts`; `dsh-user-approval/README.md` §37 |

**Consecuencia medida:** sin delegación no hay hijo. Si se habilitara, un hijo **vería** las siete
herramientas (registro global) y podría leer el proyecto que resuelva su `cwd`; `forget`/`reindex` seguirían
rechazados por la aprobación fijada a `never`.

## El eslabón que falta

El plugin **no puede saber** si quien llama es un hijo. `exec.agent` sólo expone `id`; no hay padre, ni
`delegationDepth`, ni `origin`. El descriptor del hijo sí los lleva (`child-agent.ts`: `origin: 'subagent'`,
`delegationDepth`), pero viven en el log de la sesión, al que el plugin no accede por la API estable
(`eventAt`/`snapshotEvents` están marcados como obsoletos para código nuevo).

Sin esa señal, cualquier regla del tipo «deniega a los hijos» sería en realidad «deniega a toda sesión sin
fila de selección», lo que rompería la primera llamada legítima de una sesión raíz nueva. **Por eso no se ha
implementado un control que no puede aplicarse**: sería un falso positivo de seguridad.

## Diseño propuesto (no implementado)

### Modelo

```
delegation(
  delegation_id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL,
  child_session_id  TEXT NOT NULL,
  project_id        TEXT NOT NULL,
  libraries_json    TEXT NOT NULL,   -- subconjunto de las concedidas al padre
  operations_json   TEXT NOT NULL,   -- read | ingest | forget | reindex
  depth             INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,
  state             TEXT NOT NULL,   -- active | revoked | expired
  created_at        INTEGER NOT NULL
)
```

Invariantes:

1. **Sin fila activa para el `child_session_id` ⇒ sin acceso RAG.** Ni lectura.
2. `project_id` debe ser el del padre; `libraries_json` ⊆ concesiones del padre.
3. `depth < padre.depth - 1`; un hijo sin profundidad restante no puede delegar (el host ya limita a 1).
4. `expires_at` se comprueba en **cada** llamada, no al crear.
5. `state='revoked'` surte efecto inmediato (igual que `revocation.mjs` hoy).
6. La comprobación va en `resolveScope`, antes de abrir almacén: es el único punto que ya usan las siete.

### Emisión

Ni el modelo ni el hijo pueden emitir concesiones. La emisión es del **propietario** (CLI `bin/`) o de un
futuro panel con datos reales, y requiere sesión padre viva, proyecto y bibliotecas explícitos.

### Señal de linaje necesaria

La forma menos invasiva: que DSH exponga al plugin, en `exec`, el descriptor de la sesión
(`origin`, `delegationDepth`, `parentSessionId`) o un servicio `ctx.get('sessions')` de lectura. Con eso:

```js
const lineage = services.lineage?.(exec.agent) ?? { root: true };
if (!lineage.root) requireActiveGrant(db, { sessionId: exec.agent.id, projectId, operation });
```

## Cambio mínimo en DSH (propuesta, no aplicada)

1. Habilitar `tool-subagent` **sólo** en un perfil de laboratorio (`disabled: false` en una capa de ese
   perfil, no en el home).
2. Añadir un preset que **oculte** `lifecode_rag_*` a los hijos (`ctx.tools.restrict`) — es el control más
   barato y ya existe en el host.
3. Exponer linaje al plugin (punto anterior) para poder aplicar la concesión fina.

Sin (3), la opción segura es (2): ocultar el RAG a los hijos por completo (alternativa A del informe de
arquitectura). Con (3) se puede ofrecer la alternativa B (concesión por proyecto y biblioteca).

## Escenarios de aceptación (diseñados, no ejecutados)

1. Hijo sin concesión → `search`: denegado.
2. Hijo sin concesión → `ingest`: denegado.
3. Hijo con lectura → `search`: permitido.
4. El mismo hijo → `ingest`: denegado.
5. Hijo con escritura → `ingest`: permitido.
6. Hijo → otro proyecto: denegado.
7. Concesión vencida: denegada.
8. Concesión revocada: denegada.
9. Hijo que intenta delegar más allá de la profundidad: denegado.
10. Padre e hijo no comparten permisos implícitos.

Estado: **BLOCKED / NOT TESTED**. No hay hijo que probar en este perfil, y una prueba unitaria del validador
no demostraría la integración con el host. Se documenta como pendiente y **no** se declara resuelto.
