# Panel Project-Aware: por qué sigue en fixtures

## Lo que hay

- Nueve secciones + detalle de fuente, rediseño verificado en el host (`eval/remediation-redesign-01/`).
- `DATA_MODE = 'fixture'` fijado en código, sin control en la interfaz.
- La capa heredada de red está cerrada con `fixture-mode` antes de construir ninguna petición.

## Por qué no puede leer datos reales todavía

| Intento | Resultado |
|---|---|
| API HTTP del plugin | Sólo existe la del workspace v0.2, y se registra **únicamente** si hay almacén legacy (`index.js`). En Project-Aware no hay API montada. |
| Montar una API nueva | El host no demuestra la identidad de la sesión que hace la petición HTTP: cualquier proceso local podría llamarla. Es PA01 (`BLOCKED`) y D-UI-03 (`PENDING HUMAN DECISION`). |
| Llamar a las herramientas desde el cliente | El cliente no ejecuta herramientas; son superficie del modelo. |
| Proyecciones del host (`useProjection`) | Canal host→renderer por sesión, sin HTTP: **prometedor y no explorado**. Requeriría que el plugin registre una unidad de proyección con el estado del proyecto. No implementado: falta verificar la API real y su coste. |

## Decisión

No se ha convertido el panel en «real» con datos de fixture ni se ha inventado un endpoint. El panel sigue
siendo una **interfaz de demostración** que declara su modo en la cabecera, y el producto real se usa por las
siete herramientas del agente.

## Qué haría falta para cerrarlo

1. Resolver D-UI-03 (aceptar o rechazar el riesgo del transporte) **o** implementar la vía sin transporte: una
   proyección de sesión que el host inyecte en el renderer, con los datos ya filtrados por ámbito.
2. Si se elige HTTP: capacidad de sesión emitida por el host, efímera y revocable (Ruta A, hoy `BLOCKED`).
3. Pruebas de DOM/consola y de montaje/desmontaje en host (`NOT TESTED`).

La opción 1 es la única que no depende de una decisión de riesgo: no hay canal que autenticar porque no hay
canal. Merece un acto propio de investigación antes de escribir código.
