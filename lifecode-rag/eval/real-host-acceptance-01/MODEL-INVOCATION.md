# Invocación por el modelo — `NOT TESTED`

## Por qué no está probado

Hermes no controla el agente de DeepSeek Harness: no puede enviar un turno al chat del host ni leer su
respuesta. Tampoco existe una superficie para consultar el catálogo efectivo de herramientas de una sesión:

- `~/.dsh/sessions/--C-xampp-htdocs-plugins-dhs--/` contiene 35 sesiones, pero los ficheros son
  `session.v4.jsonl.zstd` (comprimidos): `grep` no ve el contenido.
- No hay comando del host que liste las herramientas de una sesión.

Por tanto: **no se declara PASS**. La evidencia indirecta (133 ingestas auditadas con nombre de herramienta)
prueba que la herramienta se ha usado contra este almacén, no que el modelo la reciba hoy.

## Instrucción exacta para el propietario

Abrir el chat de DSH en el workspace `C:\xampp\htdocs\plugins-dhs` y enviar este turno:

```
Usa lifecode_rag_search para buscar "project-aware" en mi proyecto,
muéstrame los dos primeros resultados con su uri y su sourceId,
y después usa lifecode_rag_get sobre el sourceId del primero.
No modifiques nada.
```

## Evidencia que debe capturarse

1. **Captura de la tarjeta de llamada** de `lifecode_rag_search` con los argumentos (`query: "project-aware"`).
2. **Captura del resultado**: dos filas con `uri` y `sourceId` (los `sourceId` empiezan por `src_`).
3. **Captura de la llamada** `lifecode_rag_get` con ese `ref` y su resultado.
4. Si el modelo responde «no tengo esa herramienta» o pide otra cosa: capturar también; eso convertiría el
   punto en **FAIL** (registro no expuesto al modelo) y habría que revisar el `dsh.client`/tool scope del
   perfil.

## Cómo se leerá el resultado

| Observación | Clasificación |
|---|---|
| Aparecen las dos llamadas y devuelven fuentes reales del repositorio | **PASS** |
| El modelo dice que no dispone de la herramienta | **FAIL** |
| Responde sin llamar a la herramienta (inventando) | **FAIL** de fundamentación |
| No se puede probar (sin acceso al chat) | **NOT TESTED** |

## Nota

Una vez exista esa captura, `TOOL-CATALOG.md` §4 y la matriz de `EXECUTIVE-REPORT.md` se actualizan con la
evidencia; hoy dicen `NOT TESTED` y así deben quedarse.
