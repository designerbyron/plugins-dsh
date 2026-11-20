# Modelo de amenazas — acceso de subagentes a LifeCode RAG

## Activos

| Activo | Dónde vive |
|---|---|
| Contenido del RAG (fuentes, fragmentos, vectores) | almacén del perfil (`DSH_HOME`/perfil), SQLite + ficheros |
| Selección de proyecto por sesión | tabla `session_scope` |
| Registro de auditoría | cadena del plugin |
| Credenciales del proveedor de embeddings | almacén de credenciales del host |

## Actores

- **Principal**: el agente del usuario, con las herramientas del host.
- **Hijo `spawn`**: sesión nueva, sin historial, composición heredada.
- **Hijo `fork`**: sesión nueva con turnos completados del padre.
- **Hijo externo** (ACP/SDK): proceso distinto, permisos propios.
- **Modelo**: no es de fiar por diseño; puede intentar cualquier llamada.

## Vectores y estado

| # | Vector | Control presente | Estado |
|---|---|---|---|
| T1 | El modelo del principal lee datos reales | la API PA no está montada; las herramientas apuntan al almacén del perfil, no a un RAG remoto | **riesgo aceptado por diseño del producto** (las herramientas son el canal legítimo) |
| T2 | Un hijo lee el RAG sin autorización | **no hay control de autorización**; hoy no hay hijo porque la herramienta está desactivada | **MITIGADO POR AUSENCIA** (frágil) |
| T3 | Un hijo escribe (`ingest`) en el proyecto | idem: visible y ejecutable | **ABIERTO si se habilita delegación** |
| T4 | Un hijo borra (`forget`) o reindexa | aprobación del hijo fijada a `never` → rechazo determinista | **CONTROLADO** (por contrato, fail-closed) |
| T5 | Un hijo cambia de proyecto para ampliar alcance | no hay herramienta de selección en el plugin; la selección es por sesión y por `cwd` | **PARCIAL**: puede caer en otro proyecto si su `cwd` es otro |
| T6 | Un hijo delega a un nieto | `maxDepth = 1` y sin herramientas de delegación | **CONTROLADO** |
| T7 | Un hijo externo hereda acceso por compartir proceso | los externos tienen su propio entorno; no montados | **NO APLICA** hoy |
| T8 | El ocultamiento de herramientas se confunde con autorización | documentado: visibilidad ≠ autoridad | **RIESGO DE GOBERNANZA** |
| T9 | Un `fork` arrastra datos del padre al hijo | el seed es historial de conversación; podría contener fragmentos ya citados | **ABIERTO**: el historial no se filtra por ámbito |
| T10 | Ingesta fuera del proyecto | `planIngest` rechaza rutas fuera del ámbito | **CONTROLADO** (`path-not-allowed`) |

## Controles que existen y quién los aplica

| Control | Aplicado por | Alcance |
|---|---|---|
| Aprobación `allowed-once` | `dsh-user-approval` + `requireApproval` | `forget`, `reindex`, egress de embeddings |
| Rechazo determinista con `never` | servicio de aprobación, antes del despacho | todo hijo |
| `maxDepth` | `dsh-tool-subagent` / host | creación de hijos |
| Filtro de herramientas | `ctx.tools.restrict` | sólo si existe `toolFilter` (reanudación en frío) |
| Ámbito por ruta | `planIngest` | ingesta |
| Identidad de sesión | `session-identity.mjs` + perfil | todas las herramientas |

## Controles que faltan

1. **ACL por agente**: nadie comprueba que el SessionId del hijo tenga derecho al proyecto.
2. **Identificador de delegación**: no hay vínculo auditable padre→hijo en el plugin.
3. **Caducidad**: no existe.
4. **Filtro por defecto para hijos**: el hijo hereda el catálogo completo.
5. **Separación lectura/escritura por agente**: `ingest` no pide aprobación.

## Riesgo residual declarado

Con la configuración actual: **bajo** para lectura/escritura por subagentes (no hay subagentes), **alto** si se
habilita la delegación sin añadir autorización: un hijo podría leer y escribir en el almacén del perfil sin
concesión explícita, con el único freno de la aprobación para `forget`/`reindex`.
