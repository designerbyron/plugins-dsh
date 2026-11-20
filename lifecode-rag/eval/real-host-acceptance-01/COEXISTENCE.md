# Coexistencia de proyectos y sesiones — resolución definitiva

**Decisión del propietario:** conservar `plugins-dhs` y `LifeCode RAG` como proyectos independientes, sin
archivar, sin borrar y sin tocar la selección existente.
**Preparación:** sin cambios en el perfil real. Todo se verificó sobre copias del registro (`readOnly` o
copia escribible), nunca sobre el original.

## 1 · Las reglas, tal como están implementadas

| Regla | Dónde vive | Comportamiento |
|---|---|---|
| **Proyectos independientes** | tabla `projects` + `roots` | Cada proyecto tiene su raíz y su almacén `scopes/<project_id>/rag.sqlite3` |
| **Selección explícita por sesión** | `session_scope` (una fila por `session_id`) | `resolveScope` la usa y audita `source: 'explicit'` |
| **`cwd` de otro proyecto ⇒ rechazo** | `lib/resolve.mjs` (rama de selección) | Si el `cwd` resuelve a un proyecto distinto del seleccionado: `scope-ambiguous` con `selected_project_id` y `candidates[]`. No se busca en el proyecto equivocado |
| **Confianza acotada** | `lib/trusted-roots.mjs` (`trustedRootFor`) | Sólo autoriza rutas **dentro** de una raíz confiada (`pathKey` igual o prefijo). Un hermano no está dentro |
| **Sin herencia** | `session_scope` no tiene `parent`/`clone`; `resolveScope` busca **por `session_id`** | Una sesión nueva no tiene fila: resuelve por `cwd` o falla `scope-unresolved`. Nunca lee la fila de otra |

## 2 · Evidencia: seis casos sobre copia del registro real

`coexistence-probe.json` (registro real del perfil `desktop`, workspaces reales):

| Caso | cwd | Sesión | Resultado |
|---|---|---|---|
| **A** | `…\plugins-dhs` | nueva, sin selección | **OK** · `cwd` → `plugins-dhs` (`prj_01M7TRDQ…`) · almacén **no existe** |
| **B** | `…\plugins-dhs\lifecode-rag` | nueva, sin selección | **OK** · `cwd` → `LifeCode RAG` (`prj_01M7RBSR…`) · almacén existe |
| **C** | `…\saas-corporative` | nueva | **DENEGADO** · `scope-unresolved` · `project-not-authorized` (hermano **no** autorizado) |
| **D** | `…\plugins-dhs` | con selección a LifeCode RAG | **DENEGADO** · `scope-ambiguous` (regla 3, conservada) |
| **E** | `…\plugins-dhs\lifecode-rag` | la **misma** sesión anterior | **OK** · `explicit` → `LifeCode RAG` |
| **F** | `…\plugins-dhs` | segunda sesión nueva | **OK** · `cwd` → `plugins-dhs` · **idéntica a A** (no hereda la selección de nadie) |

La tabla `session_scope` sigue con **una sola fila** después de los seis casos: las resoluciones por `cwd` no
persisten selección.

## 3 · Cada proyecto, su almacén

| Proyecto | Raíz autorizada | Almacén | Estado |
|---|---|---|---|
| `LifeCode RAG` · `prj_01M7RBSRD33M26HGBEFW51WPP6` | `…\plugins-dhs\lifecode-rag` | `scopes/prj_01M7RBSRD…/rag.sqlite3` | **existe** · 121 fuentes / 964 fragmentos / 964 vectores |
| `plugins-dhs` · `prj_01M7TRDQYRAPJR03QTM3PP6PX2` | `…\plugins-dhs` | `scopes/prj_01M7TRDQ…/rag.sqlite3` | **no existe** todavía (proyecto vacío) |

Comprobado con `scopeStoreExists` en los seis casos: A/F apuntan al almacén inexistente del proyecto nuevo;
B/E al almacén de LifeCode RAG. Ninguno resuelve el del otro.

## 4 · Permisos: no se amplía nada

- Raíces confiadas: **una** (`c:/xampp/htdocs/plugins-dhs`, `readAuthorization: true`).
- Autorizar un hermano exige que esté **dentro** de una raíz confiada; `saas-corporative` no lo está y el
  rechazo incluye el comando exacto que una persona tendría que ejecutar (`trust add --path …`). **No se
  ejecutó**.
- Que un workspace esté abierto **no** autoriza: el caso C lo demuestra.

## 5 · Cómo abrir una sesión de cada proyecto

### Sesión de `plugins-dhs`
1. En DSH, abrir un chat **en el workspace existente** `plugins-dhs` (`C:\xampp\htdocs\plugins-dhs`).
2. No hace falta seleccionar nada: el `cwd` resuelve el proyecto `plugins-dhs` en la primera llamada.
3. Estado esperado hoy: proyecto **vacío** → `list` 0 fuentes, `search` 0 resultados (`mode: 'empty'`),
   `context` 0 citas. Si algún día se ingiere, aparecerán.

### Sesión de `LifeCode RAG`
1. En DSH, abrir un **workspace nuevo** apuntando a `C:\xampp\htdocs\plugins-dhs\lifecode-rag`.
   (Esa carpeta ya es la raíz autorizada del proyecto y está dentro de la raíz confiada: no hace falta
   autorizar nada nuevo.)
2. Abrir un chat en ese workspace. El `cwd` resuelve `LifeCode RAG` directamente.
3. Alternativa sin abrir workspace: usar la sesión que **ya** tiene la selección explícita
   (`session-c90d50d6-…`), pero sólo si su `cwd` está dentro de `…\lifecode-rag`. Desde la raíz del workspace
   `plugins-dhs` esa sesión da `scope-ambiguous` (caso D).
4. **No** sirve seleccionar `LifeCode RAG` desde el workspace `plugins-dhs`: el `cwd` pertenece a otro
   proyecto y la regla 3 lo rechaza a propósito.

## 6 · Dos pruebas de aceptación

### Prueba A — sesión de `plugins-dhs`
Prompt exacto en el chat de ese workspace:

```
Usa lifecode_rag_search con query "project-aware" y luego lifecode_rag_list.
Muéstrame el número de resultados y de fuentes, y ningún identificador inventado.
```

Esperado: **0 resultados**, `mode: 'empty'`, **0 fuentes**. Si devolviera 3 resultados del contrato de errores,
estaría leyendo el proyecto equivocado: sería **FAIL** de aislamiento.

### Prueba B — sesión de `LifeCode RAG`
Prompt exacto en el chat del workspace `…\lifecode-rag`:

```
Usa lifecode_rag_search con query "project-aware", muéstrame los dos primeros uri y sourceId,
y después usa lifecode_rag_get con el sourceId del primero. No modifiques nada.
```

Esperado (ya medido con la herramienta real, no inventado):

| # | `sourceId` | `uri` |
|---|---|---|
| 1 | `src_a26afe7725768150` | `…\lifecode-rag\docs\PROJECT-AWARE-ERROR-CONTRACT.md` |
| 2 | `src_c3f912136c2f1107` | `…\lifecode-rag\docs\PROJECT-AWARE-ARCHITECTURE.md` |

`get` debe devolver 10 fragmentos del «Contrato de errores — Project-Aware RAG (PA0)».

## 7 · Cómo distinguir invocación del modelo vs llamada de Hermes

| Evidencia | Invocación del modelo en DSH | Llamada desde Hermes |
|---|---|---|
| Tarjeta de herramienta en el chat con nombre y argumentos | **sí** | **no existe**: Hermes no escribe en el chat de DSH |
| Respuesta del asistente citando `uri`/`sourceId` devueltos | sí | no |
| Fila `scope.resolve` en `audit_registry` con `actor: host` | sí | **también** (mi ejecución dejó 4 filas) |
| Métrica `query.*` actualizada | sí | **también** |

Conclusión: la auditoría y las métricas **no** distinguen el origen; sólo la **tarjeta de herramienta y la
respuesta del chat** lo hacen. Por eso:

- **No declaro la integración del modelo como PASS.** Sigue `NOT TESTED`.
- Si me pasas los `sourceId` que muestre el chat, los contrasto contra el almacén con SQL sobre copia
  (verificación de que no son inventados) sin tocar nada.

## 8 · Estado del perfil real tras esta preparación

Sin cambios: las seis resoluciones y las pruebas de herramienta corrieron sobre copias. El registro real
conserva sus 2 proyectos, 2 raíces, 1 selección y su `mtime` de 14:40.
