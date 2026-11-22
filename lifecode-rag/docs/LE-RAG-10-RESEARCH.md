# LE-RAG-10 · Investigación y arquitectura del runtime PA

> **Registro histórico.** El transporte descrito aquí (`GET /pa/search?q=…`, `GET /pa/context?...`) fue
> sustituido por `POST` con cuerpo JSON en LE-RAG-11, siguiendo D-01. No usar este documento como contrato
> vigente.

Base: commit `dfe70f5` exportado a `C:\xampp\htdocs\lifecode-rag-lab\pa-dev` (405 ficheros).
Host inspeccionado: DeepSeek Harness **0.2.2-rc.5** (`resources/app.asar`).

## 1 · Hechos verificados (no supuestos)

- El servicio `webServer` **existe** y expone: `register`, `registerFallback`, `registerUpgrade`,
  `collectIndexInjections`, `getOrigin`, `readResource`, `listen`, y propiedades `host`, `port`, `protocol`.
- `index.js:72` ya monta un handler con `ctx.effect(() => webServer.register({ kind: 'prefix', path: API_PREFIX, handler }))`.
- `lib/server.mjs` implementa la API v0.2 bajo `API_PREFIX = '/lifecode-rag/api'` con rutas `/`,
  `/search`, `/retrieval`, `/context`, `/actions`, validación de `content-type`, comprobación del `Host`
  y `404` fuera del prefijo.
- **Causa raíz de «API no montada»**: el montaje está condicionado a `legacyStoreExists` y sirve el almacén
  **legacy**. En el laboratorio no hay almacén v0.2, así que no se registra nada.
- `client.js` fija `DATA_MODE = 'fixture'`, `request()` falla cerrada con `code:'fixture-mode'` y conoce
  exactamente **cinco rutas**: `/snapshot`, `/search`, `/context`, `/config`, `/actions`.

## 2 · Contrato que el panel ya espera

| Endpoint | Uso en el panel | Lectura/escritura |
|---|---|---|
| `GET /snapshot` | proyecto activo, ámbitos, bibliotecas, fuentes paginadas, estado del servicio, auditoría | lectura |
| `GET /search` | búsqueda con `query`, `limit`, modo | lectura |
| `GET /context` | contexto citado con `maxTokens` | lectura |
| `GET /config` | configuración efectiva y versión | lectura |
| `POST /actions` | `ingest` · `forget` · `reindex` | **escritura** |

## 3 · Arquitectura propuesta (ADR-10)

**Decisión 1 · Prefijo propio y almacén del perfil.** Nuevo handler PA montado en
`/lifecode-rag/pa` que resuelve sobre `profileRoot(env)` (no legacy) usando los módulos del core
(`resolve`, `scope-ops`, `scope-stores`, `resolveConfig`, `library-state`). El prefijo v0.2 se conserva
intacto para quien lo tenga.

**Decisión 2 · Lectura sí, escritura no.** En esta fase la API PA es **solo lectura**. Los tres `/actions`
responden `403 approval-required` con `details: { tool: 'lifecode_rag_<acción>' }` y el panel muestra «requiere
aprobación: pídelo al agente». Ninguna ruta HTTP puede invocar `ingest`/`forget`/`reindex` sin la aprobación
del host; así no hay forma de saltarse el contrato.

**Decisión 3 · Identidad de proyecto explícita y acotada.** El panel no tiene sesión de agente. `/snapshot`
devuelve solo ámbitos **presentes en el registro del perfil** y con raíz autorizada; `project` se acepta como
parámetro y se valida contra el registro. Nunca se resuelve una ruta arbitraria desde la URL.

**Decisión 4 · Estados honestos.** `/snapshot` incluye `mode: 'api'|'fixture'`, `service: ok|degraded|down`,
`asOf`, y un `reason` cuando falla. El cliente distingue vacío (`total:0`) de error (`5xx`), y el panel jamás
pinta un error de transporte como lista vacía.

**Decisión 5 · Límites.** Paginación por `cursor` con `limit` máximo 200; `search` limit máximo 50; respuesta
máxima 1 MB; timeout del cliente 8 s con `AbortController`; sin exponer rutas de usuario (solo `uri` de fuentes
y contadores; `dataRoot` se muestra como etiqueta y nunca la ruta completa del perfil).

**Decisión 6 · Cero dependencias del host en el core.** El handler vive en `lib/pa-api.mjs` **sin** importar
nada de DSH; `index.js` es quien lo conecta al `webServer`. `client.js` conmuta a `DATA_MODE='live'` solo si
`/snapshot` responde `mode:'api'`; en caso contrario sigue en fixture.

## 4 · Matriz de endpoints PA

| Método | Ruta | Respuesta | Errores |
|---|---|---|---|
| GET | `/lifecode-rag/pa/snapshot` | `{ mode, service, project, scopes[], libraries[], sources{rows,total,nextCursor}, audit{head}, versions }` | 403 `project-not-authorized` · 500 `store-unreadable` |
| GET | `/lifecode-rag/pa/search?q=&limit=` | `{ results[], mode, elapsedMs }` | 400 `invalid-argument` · 403 · 500 |
| GET | `/lifecode-rag/pa/context?q=&maxTokens=` | `{ citations[], tokensEstimate }` | 400/403/500 |
| GET | `/lifecode-rag/pa/config` | `{ config, sources{global,profile}, version }` | 500 `invalid-config` |
| POST | `/lifecode-rag/pa/actions` | `403 approval-required` (por diseño) | 403 siempre |

## 5 · Plan de implementación (siguiente fase)

1. `lib/pa-api.mjs` (nuevo, puro): `createPaHandler({ profileRoot, env, now })` con las 5 rutas y los estados.
2. `index.js`: montar el handler PA **siempre** (independiente de `legacyStoreExists`), en `ctx.effect`.
3. `client.js`: `request()` con `mode` negociado; estados loading/empty/error/degraded; badge «datos reales».
4. Pruebas: handler con `IncomingMessage` simulados (200/400/403/500), paginación, timeout/cancelación,
   proyecto no autorizado, `/actions` siempre 403, y suite completa sin regresiones.
5. Validación en el laboratorio: `DATA_MODE` live, panel mostrando `Laboratorio LE-RAG-09` con 2 fuentes.

## 6 · Riesgos

- `webServer.register` no documentado: se usa el mismo contrato ya en producción en `index.js`.
- El panel no tiene sesión: la lectura se acota al registro del perfil, no a la sesión del agente.
- Sin aprobación no hay escrituras desde el panel: es una decisión, no una carencia.

## 7 · Estado

Investigación y arquitectura: **completas y sustentadas en APIs verificadas**. Implementación: **no iniciada**.
