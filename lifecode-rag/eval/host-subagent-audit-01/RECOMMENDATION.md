# Recomendación

## Qué hacer ahora (sin implementar)

1. **Mantener la delegación desactivada** en el perfil de escritorio. Es el control que hoy impide el acceso, y
   no cuesta nada.
2. **No presentar la ausencia de herramienta como autorización.** En documentación y en el panel, la frase
   correcta es: «un subagente no puede consultar el RAG porque la herramienta de delegación no está montada»,
   no «está prohibido».
3. **Aplicar la errata E-01** («nueve secciones y la pantalla de detalle») en un acto documental que regenere
   el manifiesto del plan K1; no se aplica aquí.
4. **Archivar esta auditoría** como línea base: si algún día se habilita `tool-subagent`, las pruebas S2…S10
   dicen exactamente qué medir.

## Qué haría falta para permitir subagentes con RAG

| Paso | Contenido | Requiere |
|---|---|---|
| 1 | Decisión del propietario sobre el modelo (A, B o C) | decisión humana |
| 2 | Esquema `delegation` (proyecto, bibliotecas, operaciones, depth, expiresAt, delegationId) | autorización de K1-C |
| 3 | Validación en las 7 herramientas antes de resolver ámbito | implementación |
| 4 | Máscara por defecto para hijos (ocultar RAG salvo sobre) | implementación |
| 5 | Pruebas S2…S10 ejecutadas con evidencia de backend | laboratorio |
| 6 | Revisor de seguridad designado (Q-06 / TI-7) | designación humana |

## Lo que no recomiendo

- **No** habilitar `tool-subagent` «para probar» en el perfil real: un hijo vería y podría usar `ingest` sobre
  el almacén del perfil sin concesión.
- **No** confiar en el aviso de alcance del hijo (`SUBAGENT_DELEGATION_CONTEXT`): es texto para el modelo, no
  un control.
- **No** usar `fork` para «pasar contexto» del RAG: el seed es historial de conversación y no se filtra por
  ámbito (T9).

## Estado de gates (sin cambios)

```
PA01: BLOCKED · D-UI-03: PENDING HUMAN DECISION · G6: BLOCKED
ROUTE A: BLOCKED · ROUTE B: NOT DEMONSTRATED · ROUTE C: NOT ACCEPTED
GAP-20: OPEN / DOCUMENTED HOST LIMITATION · Q-06 / TI-7: PENDING DESIGNATION
```

Ninguna recomendación de este documento autoriza implementación.
