# Alternativas de arquitectura de acceso RAG para subagentes

Ninguna se implementa en este acto. Comparación sobre el estado real del host.

## A — Sin acceso RAG para subagentes

Ocultar las siete herramientas a cualquier hijo (máscara por defecto) y no habilitar delegación.

| Criterio | Valoración |
|---|---|
| Seguridad | **máxima**: el hijo no ve el RAG |
| Complejidad | baja: una máscara en la composición del hijo o mantener la herramienta desactivada |
| Rendimiento | mejor: menos esquemas en el prompt del hijo (~7 herramientas menos) |
| Tokens | menor coste por hijo |
| Trazabilidad | trivial: no hay accesos que auditar |
| Mantenimiento | bajo, pero **frágil**: depende de que nadie habilite `tool-subagent` |

**Problema:** hoy el control es ausencia de herramienta, no política. Un cambio de una línea en un bundle
ajeno lo revierte.

## B — Acceso explícito y limitado por proyecto y biblioteca

El padre concede, por delegación, un sobre firmado con: `projectId`, `libraries[]`, `operations[]`, `depth`,
`expiresAt`, `delegationId`. Cada herramienta RAG valida el sobre contra su `agent.id` **antes** de resolver el
ámbito. Sin sobre, el hijo no ve ni ejecuta RAG.

| Criterio | Valoración |
|---|---|
| Seguridad | **alta**: autorización explícita, revocable, verificada en backend |
| Complejidad | media-alta: tabla de delegaciones + validación en las 7 herramientas + emisión desde el padre |
| Rendimiento | un `SELECT` por llamada (indexado por `session_id`) |
| Tokens | coste del sobre en el contexto (~100-200 tokens) o fuera del prompt si se inyecta por sesión |
| Trazabilidad | **alta**: `delegationId` en cada registro de auditoría |
| Mantenimiento | medio: un módulo nuevo (`lib/delegation.mjs`) y pruebas por herramienta |

Encaja con lo que ya existe: `session_scope` ya es por sesión; faltaría `delegation` (padre, ámbito, caducidad)
y la comprobación en `tools.mjs`.

## C — Acceso heredado controlado con restricciones verificadas por backend

El hijo hereda el catálogo, pero cada herramienta comprueba en el backend que el proyecto del hijo está
autorizado por el padre (herencia con verificación), sin sobre explícito.

| Criterio | Valoración |
|---|---|
| Seguridad | **media**: hereda por defecto; el control es la comprobación, no la concesión |
| Complejidad | media: comprobación de linaje (padre→hijo) en el backend |
| Rendimiento | similar a B |
| Tokens | **cero coste extra**: el hijo ya tiene los esquemas |
| Trazabilidad | media: el linaje se deduce del árbol, no de un identificador de delegación |
| Mantenimiento | medio |

**Problema:** «heredado por defecto» es exactamente lo que hoy ocurre sin control. Añadir verificación lo
mejora, pero la postura por defecto sigue siendo permisiva.

## Comparación

| Criterio | A | B | C |
|---|---|---|---|
| Postura por defecto | denegar | denegar | permitir |
| Autorización explícita | no aplica | **sí** | no (derivada) |
| Revocación | n/a | **sí** (borrar el sobre) | difícil |
| Caducidad | n/a | **sí** | no |
| Coste en tokens | **0** | bajo | 0 |
| Complejidad | **baja** | alta | media |
| Trazabilidad | n/a | **alta** | media |
| Frágil ante cambios del host | **sí** | no | no |

## Recomendación

**B, en dos pasos.** Primero **A como estado por defecto** (no habilitar delegación y, cuando se habilite,
máscara que oculte `lifecode_rag_*` a los hijos), porque es gratis y cierra el riesgo hoy. Después, si el
producto necesita subagentes que consulten el RAG, **B** con alcance por proyecto y biblioteca, caducidad y
`delegationId` auditado.

C no se recomienda como primer paso: su postura por defecto es la que ya tenemos y no resuelve el problema de
fondo (nadie concede nada; se hereda).

## Condiciones para implementar B (acto futuro, no autorizado)

1. Decisión del propietario sobre D-UI-03 y el modelo de autorización.
2. Esquema de delegaciones y migración (hoy el esquema está congelado por K1-C).
3. Validación en las 7 herramientas + pruebas negativas S2…S10 ejecutadas.
4. Auditoría de cada uso con `delegationId`.
5. Revisión de seguridad independiente (Q-06 / TI-7 sigue `PENDING DESIGNATION`).
