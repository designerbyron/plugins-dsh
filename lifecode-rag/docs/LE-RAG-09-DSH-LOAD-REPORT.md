# LE-RAG-09 · Carga del plugin en DSH

## Estado: PARCIAL — registrado en el perfil del laboratorio; falta re-interrogar al modelo

### Causa raíz de la NO carga inicial (evidencia directa)

Antes de registrar el paquete, el inventario de herramientas que el propio modelo declaró en el chat no contenía
**ninguna** `lifecode_rag_*`: `ask_user_question, create_goal, edit, get_goal, glob, grep, job_kill, job_list,
job_output, list_agents, list_subagent_models, load_workspace_dependencies, plugin_manager, present, pwsh, read,
read_image, schedule_*, send_message, skill, subagent, subagent_fork, todo_write, update_goal, wait_agent,
web_fetch, web_search, workflow, working_directory, write`. El modelo intentó `grep lifecode_rag_list` y luego
`plugin_manager · list_plugins` (quedó esperando aprobación).

Comparación que lo explica: el perfil habitual tiene `"@local/lifecode-rag": "link:C:/xampp/htdocs/plugins-dhs/lifecode-rag"`
en `dependencies` y en `dsh.profile.bundles`; el del laboratorio tenía `dependencies: {}` y sólo `dsh-base` +
`dsh-web-app`. **En 0.2.2-rc.5 el host no descubre plugins locales por abrir su carpeta como workspace: los carga
desde el perfil.**

### Corrección aplicada (sólo laboratorio)

1. `lab\home\profiles\desktop\package.json` → `link:` al plugin **exportado del commit** (`lab\plugins\lifecode-rag`)
   y `@local/lifecode-rag` en `bundles`. Copia: `package.json.bak`.
2. `junction` en `lab\home\profiles\desktop\node_modules\@local\lifecode-rag` → `lab\plugins\lifecode-rag`
   (el host no ejecutó `pnpm install`).
3. Reinicio del laboratorio (PID 25492) con las mismas variables; el host creó la sesión
   `--C-xampp-htdocs-plugins-dhs--/session-80d3819a…`.

### Pendiente

Re-interrogar al modelo en la ventana del laboratorio (el token del servidor web cambió con el reinicio y la
pestaña quedó desconectada). Prueba mínima: «usa lifecode_rag_list con limit 5».

**No se declara carga real.** `registry.sqlite3` del laboratorio conserva mtime 19:26: el plugin aún no ha abierto
el almacén desde el host.

## Contrato verificado en el código evaluado (`dfe70f5`)

| Elemento | Valor |
|---|---|
| `name` | `lifecode-rag` |
| `inject` | `['tools']` (obligatorio); `approval`, `workingDirectory`, `webServer`, `timer` opcionales vía `ctx.get` |
| Registro | `ctx.tools.register(definition)` para las 7 herramientas |
| Paquete | `dsh.bundle.patch = ./cordis.patch.yml`, `dsh.client = { platform: 'web', immediately: true }` |
| Versión | `@local/lifecode-rag` 1.0.0, `engines.dsh >=0.2.2-rc.3 <0.3.0` |

## Qué se comprobará tras el login

1. Que el host descubre `lifecode-rag` y ejecuta su punto de entrada sin errores de importación.
2. Que `tools` está disponible y que los servicios opcionales se resuelven (o se degradan sin romper).
3. Que se registran **7** herramientas con prefijo `lifecode_rag_`: `ingest`, `search`, `context`, `get`,
   `list`, `forget`, `reindex`.
4. Nombres y descripciones que recibe el host (captura literal).
5. Que el panel de configuración carga (si `client` está habilitado).

## Evidencia que se recogerá

- Captura de la lista de herramientas del host.
- Log de arranque del host (sin secretos).
- Captura de la tarjeta de configuración.
- Hash del perfil habitual antes/después de la sesión.

## Criterio

Sólo se declarará **carga real** cuando exista evidencia del host mostrando las 7 herramientas registradas en la
sesión del laboratorio. Hasta entonces: **PENDIENTE**.
