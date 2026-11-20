# LifeCode RAG — Proveedores de embeddings

**Fecha:** 2026-11-17 · **Estado:** contrato propuesto + alternativas a evaluar
**Restricción de esta fase:** no se descarga ningún modelo, no se instala ninguna dependencia y no se
activa ningún proveedor remoto. Este documento diseña la decisión; no la toma.

---

## 1. Situación actual

`lib/embed.mjs` implementa `local-hash-v1`: bolsa de tokens con hash SHA-256 a 256 dimensiones, signo por
bucket, `1+log1p(count)`, bigramas con peso 0.5 y L2. Es **léxico**, no semántico.

Consecuencia medida (benchmark v0.1.0): una paráfrasis como `instalar` contra un corpus que dice
`instalación` obtiene Recall@5 = 0.000, tanto en FTS como en híbrida. No es un defecto del código: es el
límite del modelo. La corrección es un proveedor semántico, no más magia léxica.

El valor de `local-hash-v1` sigue siendo real: cero dependencias, determinista, offline, rápido, y sirve
como red de seguridad cuando el semántico no está disponible.

## 2. Contrato `EmbeddingProvider`

```js
/**
 * @typedef {Object} EmbeddingProvider
 * @property {string} id        // 'local-hash-v1' | 'onnx-multilingual-minilm-v1' | ...
 * @property {number} dim
 * @property {'local'|'remote'} kind
 * @property {string} [license] // licencia del código y, si aplica, del modelo
 * @property {(texts: string[], opts?: {signal?: AbortSignal}) => Promise<Float32Array[]>} embedBatch
 */
```

Requisitos:

- **Determinista**: mismo texto ⇒ mismo vector, mismo `id`, mismo `dim`.
- **Normalizado** (L2 = 1) o se normaliza en el adaptador; el coseno no debe depender del proveedor.
- **Lotes**: `embedBatch` acepta N textos; el adaptador decide el tamaño real.
- **Cancelable**: `signal` comprobado entre lotes.
- **Sin red por defecto**: `kind:'remote'` exige aprobación por llamada y `localOnly=false`.
- **Errores**: cualquier fallo se normaliza a `RagError('embedding-failed')`; nunca se escribe un vector
  a medias.
- **Identidad versionada**: `id` incluye versión (`...-v1`). Cambiar de modelo es un `id` nuevo, no un
  cambio silencioso del anterior.

## 3. Almacenamiento y migración

La tabla `vectors` ya guarda `(chunk_key, model, dim, vec)` con `model` en la PK lógica por chunk. Reglas:

- Un chunk puede tener vectores de varios modelos (migración en caliente).
- La búsqueda usa **un** modelo: el activo en configuración; si no hay cobertura completa, se declara
  `vector-index-incomplete` y la híbrida degrada a FTS.
- `reindex vectors` con un modelo nuevo es una operación de confirmación (puede tardar y ocupar CPU).
- Borrar el modelo antiguo es explícito (`reindex vectors --prune`), nunca automático.
- El esquema no cambia para añadir un proveedor: solo `model`/`dim` y la política de cuál está activo.

## 4. Alternativas (a verificar en M6, sin instalar ahora)

| Opción | Ventajas | Costes/riesgos | Español | Estado |
|---|---|---|---|---|
| **A. ONNX Runtime + modelo multilingüe pequeño** (p. ej. familia MiniLM/E5 multilingüe, ONNX) | CPU, offline, ecosistema maduro; `onnxruntime-node` con binarios Windows | dependencia nativa (~decenas de MB), modelo 80–120 MB, licencia del modelo aparte de la del runtime; hay que verificar compatibilidad Electron/ABI | sí (modelos multilingües) | **no probado en este host** |
| **B. transformers.js (ONNX) en proceso** | JS puro sobre ONNX, sin compilar | memoria y arranque; descarga de modelo desde hub si no se vendoriza; versión de ONNX Runtime | sí | **no probado** |
| **C. node-llama-cpp + GGUF** | buenos embeddings, CPU/GPU, modelos pequeños | binario nativo, compilación/ABI, licencia del modelo; consumo de memoria | depende del modelo | **no probado** |
| **D. Windows ML / DirectML** | aceleración en Windows | API y empaquetado propios; dependencia de versión de Windows | depende | **no probado** |
| **E. API remota compatible OpenAI** (`/v1/embeddings`) | cero binarios, calidad alta | egress, coste, latencia, privacidad; requiere aprobación por llamada | sí | contrato ya previsto |
| **F. Seguir solo léxico** | cero deps | no resuelve paráfrasis | n/a | actual |

Ninguna opción se elige por intuición. La decisión es un resultado de medición, no una preferencia.

## 5. Protocolo de evaluación (M6)

1. Corpus congelado de `RETRIEVAL-EVALUATION.md` (120 consultas, es/en).
2. Línea base: `local-hash-v1` (ya medida).
3. Para cada candidato: mismo corpus, mismo chunking, mismos K; medir Recall@5/10, MRR@5/10, NDCG@10,
   latencia p50/p95 de `embedBatch` y de consulta, RAM pico, tiempo de arranque.
4. Repetir 3 veces; publicar mediana y dispersión.
5. Criterio de promoción: mejora **medida** en Recall@10 ≥ 10 puntos absolutos sobre la paráfrasis sin
   degradar latencia p95 de consulta por encima de +50 ms ni RAM por encima de +150 MB.
6. Si ningún candidato cumple, se queda `local-hash-v1` y se dice.

## 6. Empaquetado y licencias

- El proveedor debe poder instalarse **como dependencia opcional** del bundle, no obligatoria: quien no
  la tenga sigue funcionando en modo léxico.
- Un modelo pesado no entra en el paquete npm del plugin; se vendoriza o se descarga con consentimiento
  explícito y checksum publicado. `tools/check.mjs` seguirá fallando si aparece una descarga implícita.
- Se documentan dos licencias: la del **código** del runtime y la del **modelo**. Una licencia permisiva
  del runtime no implica licencia del modelo.
- Sin telemetría del proveedor; sin llamadas de "comprobación de versión".

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| ABI nativa incompatible con Electron 44 | probar carga en el proceso host antes de comprometerse; si falla, opción B |
| Modelo que alucina similitud en español | evaluar con corpus es antes de promover |
| Aumento de tamaño del bundle | opcional + vendorizado fuera del paquete |
| Migración a medias | `model` por vector + cobertura obligatoria antes de activar |
| Egress accidental | `localOnly` por defecto; el proveedor remoto no se activa por config sin aprobación |

## 8. Decisión pendiente

`DECISIONS-v0.2.0.md` ADR-06 fija: **no se adopta proveedor en v0.2.0; se implementa el puerto y el
arnés de evaluación**. La adopción ocurre en v0.2.1 con números. Esta es una decisión deliberada para no
vender "semántico" sin evidencia.
