# Observabilidad

Las métricas son agregadas. Nunca se guardan prompts, respuestas completas, contenido recuperado
ni credenciales. Cada evento aporta un contador a una tabla `metrics_daily(day, metric, dim, value)`
con clave primaria y UPSERT aditivo.

## Qué se mide

- Consultas: número, latencia y cuántas quedaron vacías.
- Contexto: construcciones, tokens entregados y truncamientos.
- Ingesta: documentos, chunks, omitidos y duración.
- Errores: por código.
- Automatización: pasadas, indexados y fallidos.

## Percentiles

La latencia se agrupa en ocho cubos (`≤5`, `≤10`, `≤25`, `≤50`, `≤100`, `≤250`, `≤500`, `≤1000`,
`>1000` ms). El p50 y el p95 se estiman a partir del histograma y se etiquetan como **estimado por
histograma**, con una precisión declarada de ±ancho de cubo. No se presentan como mediciones
exactas.

## Retención

La purga elimina sólo días anteriores al corte configurado (90 días por defecto). Nunca toca
fuentes, chunks, vectores ni auditoría. La purga rutinaria es automática; cambiar la retención o
adelantar una purga exige confirmación; borrar el historial completo exige aprobación humana y una
copia previa.

## Fallos de telemetría

Si una escritura de métricas falla, el fallo se registra en memoria y se informa por `stderr`; no se
vuelve a llamar al mismo mecanismo de métricas para evitar recursión. Una consulta nunca falla
porque falle su métrica.
