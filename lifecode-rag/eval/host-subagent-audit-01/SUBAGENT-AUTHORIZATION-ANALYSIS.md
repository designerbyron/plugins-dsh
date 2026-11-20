# Análisis de autorización de subagentes

## Qué hace el host hoy

### Composición del hijo

`child-agent.ts` (`applyChildComposition`):

- Sin `agentPreset`: `childCtx.get('agentPresets')?.composeFrom(childCtx, parent.ctx)` → **el hijo hereda la
  composición del padre**. En este host no hay presets, así que hereda la del host.
- Con `agentPreset`: monta ese preset (sólo `spawn` lo admite).
- `applyChildOverrides`: añade el aviso de alcance, la persona histórica y, **sólo si existe**, el
  `toolFilter` del descriptor histórico → `ctx.tools.restrict(...)`.

`dsh-subagent-spawn-in-process/README.md`: «The child has its own registration scope below the inherited or
independently selected preset. **The parent's agent-local tool restrictions are not imported.**»

`dsh-subagent-fork-in-process/README.md`: «The seed carries conversation history only: the child still gets a
**fresh tool scope and none of the parent's authority**.»

Conclusión: **heredar contexto no es heredar autoridad**, pero heredar composición **sí es heredar
herramientas**. Las dos frases conviven: el hijo no hereda permisos *ad hoc* del padre, pero sí el catálogo de
herramientas del preset/host.

### Política de aprobación

`captureDelegatedPolicyOverrides` fija:

```ts
approvalPolicy: parent.ctx.get('approval') === undefined ? undefined : 'never'
```

Y `dsh-user-approval/README.md` §37: «`never` **rejects every request deterministically before interactive
dispatch**». §79: «The `never` policy is enforced inside the service before waterfall dispatch, so a listener
registered later with `prepend` cannot bypass the deterministic rejection.»

Consecuencia **verificable por contrato**: en un hijo, cualquier herramienta que llame a
`approval.request()` y espere `allowed-once` recibe un rechazo. En el plugin eso cubre `forget` y `reindex`
(`lib/tools.mjs` `requireApproval`), que además falla cerrado si el servicio no existe.

### Identidad y ámbito

- Identidad: `agent.id` (SessionId). No la aporta el modelo; la pone el host en `exec.agent`.
- Ámbito: tabla `session_scope` del plugin, por SessionId; `selection_source` `explicit` o `cwd`.
- Un hijo tiene SessionId propio: **no comparte la selección del padre**. Si el `cwd` coincide (spawn lo
  hereda), resolverá el mismo proyecto **por directorio**, no por concesión.

### Lo que el host NO hace

- No hay ACL por agente en el plugin: el ámbito es por sesión, no por rol.
- No hay comprobación de profundidad de delegación en las herramientas RAG (el `maxDepth` del host limita la
  creación de hijos, no el uso de herramientas).
- No hay identificador de delegación ni caducidad en la autorización de herramientas.
- No hay filtro de herramientas por proyecto.

## Modelo de autorización propuesto (a evaluar, no implementado)

Una autorización explícita y verificable necesitaría, como mínimo:

| Campo | Para qué |
|---|---|
| `principal` (SessionId del padre) | quién delega |
| `child` (SessionId del hijo) | a quién se delega |
| `projectId` | ámbito único de la delegación |
| `libraries[]` | bibliotecas concedidas, no todas las del proyecto |
| `operations[]` | `read` / `ingest` / `forget` / `reindex` |
| `depth` | profundidad restante (0 = no puede delegar) |
| `expiresAt` | caducidad |
| `delegationId` | trazabilidad de la cadena |
| `audit` | registro de cada uso |

Y el punto clave: **la comprobación debe ocurrir en el backend de cada herramienta**, no en el ocultamiento.
Hoy la única comprobación de backend es la aprobación (que rechaza escrituras en hijos); no hay comprobación
de proyecto/biblioteca por agente.

## Brecha entre «visible» y «autorizado»

| Nivel | Hoy |
|---|---|
| El hijo ve las herramientas | sí (global) |
| El hijo puede leer el proyecto del `cwd` | sí, sin concesión |
| El hijo puede leer otro proyecto | sólo si cambia su selección; no hay herramienta de selección en el plugin (**NOT DEMONSTRATED**) |
| El hijo puede escribir (ingest) | sí, en el almacén del perfil |
| El hijo puede borrar/reindexar | no (aprobación `never`) |
| El hijo puede delegar a otro | no: `maxDepth = 1` y sin herramientas de delegación |

## Riesgo residual principal

Si alguien habilita `tool-subagent` (una línea), el hijo verá y podrá usar `search/context/get/list/ingest`
sobre el proyecto que resuelva su `cwd`, **sin que el propietario haya concedido nada**. El control que hoy
impide eso no es de autorización: es que la herramienta no existe.
