/**
 * Abstracción de proveedores de embeddings (M1).
 *
 * Dos implementaciones reales:
 * - `local-hash-v1`: hashing léxico determinista, sin red. Es el valor por defecto y **no** se presenta
 *   como semántico.
 * - `remote`: cualquier endpoint compatible con `POST {input:[...], model}` que devuelva
 *   `{data:[{embedding:[...]}]}` (forma OpenAI). Sólo se usa si la configuración lo declara y la capa que
 *   llama obtiene aprobación de egreso; este módulo no aprueba nada por sí mismo.
 *
 * El contrato es asíncrono desde el principio aunque el proveedor local resuelva en microtarea: así el
 * motor no queda atado a que todos los proveedores sean síncronos.
 */

import { RagError } from './errors.mjs';
import { embedText, LOCAL_PROVIDER } from './embed.mjs';

function localEmbedder({ dim }) {
  return {
    id: LOCAL_PROVIDER,
    model: LOCAL_PROVIDER,
    dim,
    kind: 'lexical',
    async embed(texts) {
      return texts.map((text) => embedText(text, { provider: LOCAL_PROVIDER, dim }));
    },
  };
}

function remoteEmbedder({ dim, remote }, { fetchImpl, credential }) {
  const model = `remote:${remote.model}`;
  return {
    id: 'remote',
    model,
    dim,
    kind: 'semantic',
    async embed(texts) {
      const vectors = [];
      for (let offset = 0; offset < texts.length; offset += remote.batchSize) {
        const batch = texts.slice(offset, offset + remote.batchSize);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), remote.timeoutMs);
        let response;
        try {
          response = await fetchImpl(remote.endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(credential ? { authorization: `Bearer ${credential}` } : {}),
            },
            body: JSON.stringify({ model: remote.model, input: batch }),
            signal: controller.signal,
          });
        } catch (cause) {
          throw new RagError('embedding-failed', 'no se pudo contactar con el proveedor de embeddings', { cause });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          throw new RagError('embedding-failed', `el proveedor respondió ${response.status}`, {
            details: { status: response.status },
          });
        }
        let payload;
        try {
          payload = await response.json();
        } catch (cause) {
          throw new RagError('embedding-failed', 'el proveedor no devolvió JSON válido', { cause });
        }
        const data = Array.isArray(payload?.data) ? payload.data : null;
        if (!data || data.length !== batch.length) {
          throw new RagError('embedding-failed', 'el proveedor devolvió un número de vectores inesperado', {
            details: { expected: batch.length, received: data?.length ?? null },
          });
        }
        for (const item of data) {
          const embedding = item?.embedding;
          if (!Array.isArray(embedding) || embedding.length !== dim) {
            throw new RagError('embedding-failed', 'vector con dimensión incorrecta', {
              details: { expected: dim, received: Array.isArray(embedding) ? embedding.length : null },
            });
          }
          vectors.push(Float32Array.from(embedding, Number));
        }
      }
      return vectors;
    },
  };
}

/**
 * Construye el proveedor declarado por la configuración. `fetchImpl` y `credential` se inyectan desde el
 * llamador: los tests no salen a la red y el egress sólo ocurre con autorización explícita.
 */
export function createEmbedder(config, { fetchImpl = globalThis.fetch, credential = null } = {}) {
  const embedding = config.embedding;
  if (embedding.provider === LOCAL_PROVIDER) return localEmbedder({ dim: embedding.dim });
  if (embedding.provider === 'remote') {
    if (embedding.remote === null) throw new RagError('invalid-config', 'falta embedding.remote');
    return remoteEmbedder({ dim: embedding.dim, remote: embedding.remote }, { fetchImpl, credential });
  }
  throw new RagError('invalid-config', `proveedor de embeddings desconocido: ${embedding.provider}`);
}
