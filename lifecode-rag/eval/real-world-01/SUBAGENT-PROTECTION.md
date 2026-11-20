# Protección frente a subagentes

## Estado real

| Capa | Estado | Evidencia |
|---|---|---|
| Delegación en el perfil | **desactivada** (`tool-subagent`, `tool-subagent-fork`, `tool-subagent-control`) | `dsh-web-app/cordis.patch.yml` §586-601 |
| Registro de las herramientas RAG | **global** en el proceso (`ctx.tools.register`) | `lifecode-rag/index.js` |
| Autorización por herramienta | **por sesión y proyecto**, revalidada en cada llamada | humo de aceptación, paso `sesión invalidada → scope-forbidden` |
| Señal de linaje en `exec` | **no existe** (`agent.id` y nada más) | `dsh-agent` |

Consecuencia: hoy **no hay subagentes** en el perfil, y por tanto no hay ruta por la que un hijo llegue a las
herramientas. La protección efectiva es la ausencia de delegación, no un control del plugin.

## Lo que he evitado hacer

- **No he implementado** un «modo hijo» basado en heurísticas (sesión nueva, id distinto, `cwd` heredado). Un
  control así denegaría también a la primera sesión legítima o dejaría pasar a un hijo con suerte; en ambos
  casos produce una falsa sensación de seguridad.
- **No he habilitado** delegación en ningún perfil.
- **No he expuesto** HTTP sin autenticación.

## Lo que sí está garantizado hoy

1. Un subagente no existe (delegación desactivada en la capa del perfil web).
2. Si se habilitara, heredaría la composición del padre y vería las siete herramientas (registro global).
3. En ese escenario, `forget`/`reindex` seguirían **fallando cerradas**: el host crea hijos con
   `approval: never`, así que la concesión `allowed-once` no se puede obtener.
4. La lectura no tendría barrera adicional: el hijo resolvería proyecto por su `cwd`.

## Requisito para cerrarlo de verdad

Que el host exponga al plugin el descriptor de la sesión en `exec` (`origin`, `delegationDepth`,
`parentSessionId`) o un servicio de lectura equivalente. Con esa señal, la regla es de tres líneas en
`resolveScope`:

```
si (linaje no es raíz) y (no hay concesión activa para childSessionId/proyecto/operación) → denegar
```

El diseño completo (tabla `delegation`, emisión humana, revocación, expiración, profundidad) está en
`../product-readiness-01/SUBAGENT-AUTHORIZATION.md`. No se implementa hasta tener la señal: sin ella no sería
ejecutable.

## Mientras tanto

- Mantener la delegación desactivada en los perfiles donde RAG tenga datos reales.
- Si se necesita delegación para otras tareas, ocultar `lifecode_rag_*` a los hijos con `ctx.tools.restrict`
  (mecanismo ya existente en el host).
