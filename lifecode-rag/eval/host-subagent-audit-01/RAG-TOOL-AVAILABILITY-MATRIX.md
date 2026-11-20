# Disponibilidad de las herramientas RAG

## Registro

`lifecode-rag/index.js`:

```js
export const inject = ['tools'];
for (const definition of createToolDefinitions({ config, root: profile, services })) {
  ctx.tools.register(definition);
}
```

Las siete herramientas (`NAMESPACE` = `lifecode_rag_`) se registran en el **registro de herramientas del
host**, no en un ámbito por agente. `dsh-tools` lo documenta: «Registering a tool is enough to make it visible
— the registry feeds its schemas into the system-prompt assembly automatically» y `ctx.tools.restrict(filter)`
«applies an allow or deny mask to the **global tools** one agent inherits» (§31, §89).

Traducción: **todo agente del proceso ve las siete herramientas**, incluido un hijo, salvo que alguien aplique
una máscara. La única máscara que el subsistema aplica a un hijo es `toolFilter`, y sólo se rellena al
**reanudar en frío** un hijo histórico (`child-agent.ts`, `applyChildOverrides`); un hijo nuevo no la lleva.

## Matriz por herramienta

| Herramienta | Aprobación humana | Alcance | Visible para el principal | Visible para un hijo | Ejecutable por un hijo |
|---|---|---|---|---|---|
| `lifecode_rag_search` | no | proyecto/bibliotecas del ámbito | sí (por construcción) | sí (por construcción) | **sí**, lectura |
| `lifecode_rag_context` | no | idem | sí | sí | **sí**, lectura |
| `lifecode_rag_get` | no | idem | sí | sí | **sí**, lectura |
| `lifecode_rag_list` | no | idem | sí | sí | **sí**, lectura |
| `lifecode_rag_ingest` | no (rechaza rutas fuera del ámbito con `path-not-allowed`) | idem | sí | sí | **sí**, escribe en el almacén del perfil |
| `lifecode_rag_forget` | **sí** (`allowed-once`) | idem | sí | sí | **no**: el hijo fija `approval: never` → rechazo determinista |
| `lifecode_rag_reindex` | **sí** (`allowed-once`) | idem | sí | sí | **no**: idem |

Nota: `ingest` no pide aprobación pero **sí escribe** en el almacén del perfil (chunks, registro). No es una
operación de sólo lectura.

## Cómo se resuelve el ámbito

1. El host entrega `exec.agent`; `lib/session-identity.mjs` toma `agent.id` (SessionId) y lo valida contra el
   perfil activo (`profileKey`). El modelo no aporta identidad.
2. `session_scope` (SQLite del plugin) guarda `session_id → project_id, selection_source, revision`.
   `selection_source` es `explicit` o `cwd`.
3. Un hijo tiene **SessionId propio** → fila propia → selección propia. Si no hay selección explícita, se
   resuelve por `cwd`; `spawn` hereda el `cwd` del padre, así que caería en el **mismo proyecto** sin que nadie
   lo autorice explícitamente.

## Capacidades separadas (no confundirlas)

| Nivel | Estado en este host |
|---|---|
| 1. El hijo recibe instrucciones sobre RAG | n/a (no hay hijo) · si lo hubiera, sólo si el prompt las incluye |
| 2. Conoce el nombre de las herramientas | **sí** por construcción (esquemas en el prompt) |
| 3. Ve los esquemas | **sí** por construcción |
| 4. Puede invocarlas | **sí** (registro global) |
| 5. La ejecución está autorizada | **parcial**: lectura sí; `forget`/`reindex` no (aprobación `never`) |
| 6. Llega al proyecto correcto | depende de `session_scope` del hijo (por `cwd`, no por concesión) |
| 7. El backend revalida | sí para aprobaciones (`allowed-once`); **no** hay ACL de proyecto por agente |

## Lo que no se midió

No se inspeccionó la lista de herramientas que el modelo recibe en el host (**NOT TESTED**): las capturas no
la muestran y abrir DevTools queda fuera de este acto. La visibilidad es una conclusión del contrato del
registro, no una observación.
