# Inventario de proveedores de subagentes

Fuente: `app.asar` del host **0.2.2-rc.5** (`…\Programs\DeepSeek Harness\resources\app.asar`), leído por
cabecera ASAR y extracción selectiva. Rutas internas citadas tal cual.

## Servicio y backends

| Pieza | Paquete | Montaje en `dsh-base` | Estado en `desktop` |
|---|---|---|---|
| Servicio de subagentes | `@deepseek-ai/dsh-subagent` | fila `subagent` (línea 364) | montado |
| Backend `spawn` | `@deepseek-ai/dsh-subagent-spawn-in-process` | fila `subagent-spawn-in-process`, `providerName: spawn` (375) | instalado y registrado |
| Backend `fork` | `@deepseek-ai/dsh-subagent-fork-in-process` | fila `subagent-fork-in-process`, `providerName: fork` (380) | instalado y registrado |
| Herramienta de delegación `subagent` | `@deepseek-ai/dsh-tool-subagent` | fila `tool-subagent`, `provider: spawn` (392) | **desactivada** en `dsh-web-app` |
| Herramienta de delegación `subagent_fork` | `@deepseek-ai/dsh-tool-subagent` | fila `tool-subagent-fork`, `provider: fork` (402) | **desactivada** en `dsh-web-app` |
| Herramientas de control (`send_message`, `list_agents`, `wait_agent`) | `@deepseek-ai/dsh-tool-subagent-control` | fila `tool-subagent-control`, `interrupt: false` (387) | **desactivada** en `dsh-web-app` |
| Tablero de equipo | `@deepseek-ai/dsh-agent-team` + `dsh-tool-agent-team` | filas 367-373 | montado (4 herramientas de tareas, sin creación de agentes) |

**La desactivación está en el bundle web**, no en el perfil:

```yaml
# @deepseek-ai/dsh-web-app/cordis.patch.yml  (§586-601)
# The subagent registry and its backends belong in the host composition: browser
# prompt and interrupt requests share its runtime … Presets select the delegation
# tools visible to each Agent.
- id: tool-subagent-control
  disabled: true
- id: tool-subagent
  disabled: true
- id: tool-subagent-fork
  disabled: true
- id: workflow-ptc
  disabled: true
- id: tool-workflow
  disabled: true
```

Ni el perfil (`~/.dsh/profiles/desktop/cordis.patch.yml`) ni la capa del home (`~/.dsh/cordis.patch.yml`)
vuelven a habilitarlas: no contienen ninguna fila `tool-subagent*`.

## Backends externos

| Backend | Paquete presente | Montado en `desktop` |
|---|---|---|
| ACP | `@deepseek-ai/dsh-acp` (app ACP, perfil propio) | **no** (sin fila en base ni web) |
| DSH SDK | no se encontró paquete de backend de subagente | **no** |
| Codex | no se encontró backend | **no** |
| Claude Code | no se encontró backend | **no** |

## Presets

`dsh-base` **no** monta `agent-preset-registry`; el perfil tampoco declara presets de agente. Por tanto:

- No hay presets con nombre que un hijo pueda montar.
- Un hijo (si se creara) usaría la **composición del host**: exactamente los plugins del perfil, incluido
  `@local/lifecode-rag`.

## Parámetros vigentes

| Parámetro | Valor | Origen |
|---|---|---|
| `subagent.maxDepth` | **1** (sólo hijos directos) | `dsh-subagent/README.md` |
| `maxActiveSubagents` | **8** por árbol | idem |
| `interrupt` | `false` | `dsh-base` fila 387 |
| Política de aprobación del hijo | **`never`** (rechazo determinista) | `child-agent.ts` `captureDelegatedPolicyOverrides` |
| Sandbox del hijo | hereda el override explícito del padre, si lo hay | idem |

## Conclusión del inventario

**Hay servicio y backends, pero no hay herramienta con la que crear un hijo desde el escritorio.** El modelo
no ve `subagent` ni `subagent_fork`; el usuario tampoco tiene un botón de creación (la UI de subagentes muestra
linaje y un compositor de sólo lectura). En este perfil, un subagente **no puede existir**.

Esto es un control **por ausencia de herramienta**, no una autorización. Una sola línea
(`disabled: false`) lo cambiaría, y entonces el hijo heredaría la composición del host y vería las siete
herramientas RAG.
