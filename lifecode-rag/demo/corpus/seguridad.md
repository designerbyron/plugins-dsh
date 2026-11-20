# Seguridad y aprobaciones

LifeCode RAG falla en cerrado. Si una comprobación no puede completarse, la operación no se
ejecuta; nunca se degrada a "permitir por defecto".

## Rutas

- Sólo se indexan rutas dentro de las raíces autorizadas del proyecto, salvo aprobación humana
  explícita para una ruta externa.
- Las rutas de LifeCode Skill Center están prohibidas por segmento de nombre y por raíz canónica,
  incluso si alguien las añade como raíz extra.
- Se rechazan enlaces simbólicos, junctions de Windows y ficheros con más de un enlace duro.
- El propio almacén de RAG es zona prohibida: indexarlo crearía un bucle.

## Aprobaciones

`forget` y `reindex` siempre piden aprobación, con el identificador y la ruta exactos en el motivo.
La aprobación es de un solo uso (`allowed-once`); cualquier otra respuesta —rechazo, cancelación,
servicio ausente— se trata como denegación. La automatización no puede aprobar nada.

## Auditoría

Cada mutación escribe una fila en la tabla `audit` dentro de la misma transacción, encadenada por
hash. El fichero `audit.jsonl` es una exportación derivada y regenerable: si se edita o trunca, la
verificación lo detecta; si la base pierde la cola, no hay ancla externa que lo delate, y eso se
documenta como limitación en lugar de ocultarse.

## API

La API escucha sólo en loopback, valida `Host` y `Origin`, y exige la cabecera
`x-lifecode-rag: 1` más `content-type: application/json` para escribir. Esa cabecera no es
autenticación: protege contra CSRF y DNS rebinding, no contra un proceso local malicioso. Se
documenta así de claro en `WORKSPACE-API.md`.
