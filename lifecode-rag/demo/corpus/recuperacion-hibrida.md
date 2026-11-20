# Recuperación híbrida

La recuperación de LifeCode RAG combina dos señales y las fusiona con Reciprocal Rank Fusion.

## Señales

- **Léxica**: FTS5 con `tokenize='unicode61 remove_diacritics 2'`. Tolera acentos y mayúsculas,
  pero no entiende sinónimos ni paráfrasis.
- **Vectorial**: embeddings del proveedor configurado. Por defecto `local-hash-v1`, que es un
  hashing léxico determinista: sirve para infraestructura y pruebas, **no** es semántica neuronal.
  Un proveedor remoto compatible con OpenAI puede habilitarse con autorización explícita por
  llamada; sin ella, no sale ningún dato del equipo.

## Fusión

Cada lista se ordena y se puntúa con `peso / (k + posición)`, con `k = 60` por defecto y pesos
configurables. Después se normaliza la puntuación a `[0,1]` para que la interfaz y las herramientas
muestren una escala comparable.

## Diagnóstico

Cada respuesta incluye `diagnostics`: estrategia efectiva, aciertos léxicos y su latencia, aciertos
vectoriales y si el escaneo se truncó, y los parámetros de fusión aplicados. Esto permite explicar
por qué una consulta devolvió lo que devolvió, en lugar de tratarlo como una caja negra.

## Límites honestos

El benchmark sintético mide consultas exactas y una paráfrasis: la recuperación léxica acierta el
100 % de las exactas y falla la paráfrasis. La híbrida, con el proveedor local, obtiene los mismos
resultados. No se declara superioridad semántica sin un proveedor real y un corpus de evaluación
cegado.
