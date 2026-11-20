# LE-RAG-01 · Arquitectura, configuración, ranking y auditoría externa

Documento de la copia aislada `plugins-dhs-le-rag-01` (no forma parte del worktree original).

## 1 · Zero Harness Dependencies

**[H] Estado del core:** `lib/**` no importa ningún módulo `@deepseek-ai/*`, ni `cordis`, ni APIs de DSH.
La frontera es `index.js`, que recibe `ctx` del host y lo traduce a los servicios que el core necesita
(`approval`, `workingDirectory`, `workspaces`, `env`). `client.js` es la pieza de interfaz, también en la
frontera.

**[H] Dependencia implícita corregida:** la configuración se leía de `ragRoot(process.env)`, una ruta derivada
del home del host. Ahora el core puede fijar su raíz con **`LIFECODE_RAG_DATA`** y su perfil con
**`LIFECODE_RAG_PROFILE`**; sin ellas se conserva la raíz histórica (compatibilidad), pero el core ya no la
necesita.

**[P] Contratos genéricos evaluados:** `SessionEventSource`, `ConversationSource`,
`WorkspaceContextProvider`, `ToolRegistrar`, `LifecycleProvider`. Sólo se ha implementado el contrato de
**eventos de conversación** (§4); los demás no resuelven hoy un acoplamiento real y quedan como propuesta.

## 2 · Configuración (implementada en la copia)

`lib/config-resolve.mjs`:

```
<dataRoot>/config.json                        global (opcional)
<dataRoot>/profiles/<profileKey>/config.json  perfil (opcional)
```

Precedencia **por clave**: perfil > global > defaults. Mezcla en crudo, **una sola** validación
(`validateConfig`), por lo que el resultado es exactamente lo que aplican las herramientas.

- `resolveDataRoot(env)` / `resolveProfileKey(env)` — propias, con fallback histórico.
- `resolveConfig({ dataRoot, profileKey })` — devuelve `{config, sources:{global,profile}, paths}`.
- Fichero existente inválido → `invalid-config` con la ruta en `details`; **sin** fallback silencioso.
- No registra valores ni secretos: sólo booleanos de presencia y rutas.

Consumidores cableados: `index.js` (plugin), `lib/tools.mjs` (default), `lib/diagnose.mjs` (informa la
configuración efectiva como `effectiveSearch`). **Pendientes de cablear** (declarados): `bin` (doctor/audit),
`lib/doctor.mjs`, `lib/readmodel.mjs`, `lib/server.mjs`, `automation`/`sync-scheduler`.

## 3 · Ranking: golden de herramienta

**[M]** `lifecode_rag_search({limit:8})` pide al motor `cap = 16` (`searchScopes` usa 2×). El golden debe
fijarse en la cadena pública, no en el motor. `tests/tool-golden.test.mjs` congela: la herramienta devuelve
los 8 primeros del pool de 16 y en modo `source` las tres primeras posiciones son de fuentes distintas.

## 4 · Contrato de eventos de conversación (implementado, sin integración real)

`lib/conversation-events.mjs`:

```
ConversationEvent { eventId, conversationId, sequence, role, content, timestamp, metadata, operation }
```

- Roles indexables: `user`, `assistant`, `tool`. Rechazados `system`/`reasoning`/`developer`.
- `operation`: `append` | `replace` | `delete` (delete admite contenido vacío).
- `eventId` + contenido idéntico = no-op (idempotencia); `sequence` duplicada con otro `eventId` →
  `sequence-conflict`; `replace` sobre evento desconocido → error (no se inventa el original).
- `cursor` = última secuencia aplicada; reanudar con él no reprocesa nada.
- `metadata` filtra claves con pinta de secreto (`apiKey`, `authorization`, `token`, …).
- Retención con `maxEvents`.

Sin conexión a eventos reales de ningún host. La integración futura sería un adaptador que traduzca los
eventos del host a este contrato.

## 5 · Auditoría externa — `mervyn-teo/dsh-plugin-rag`

**Commit examinado:** `fe3423967755823f8773b0f0da39034dde0c5472` (rama `master`, v0.1.2, último push
2026-08-23). **Licencia MIT.** No se ha copiado código; sólo se han estudiado patrones.

| Patrón | Clasificación |
|---|---|
| Extracción por evento: sólo `user/message` con `source.kind==='user'`, texto final de `assistant/message`, `tool/result` opcional; se descarta razonamiento | **A** — adoptable en el core/adaptador de conversación |
| Cursor por sesión (último `seq` procesado) para reanudar sin reprocesar | **A** — ya cubierto por nuestro `cursor` de eventos |
| Baja por `seq` cuando compactación/pruning reemplaza contenido | **A** — encaja con `operation: replace/delete` |
| Escritura atómica `tmp` + `rename` | **A** — ya es nuestra política de `writeConfig` |
| Embeddings vía `fetch` a cualquier endpoint OpenAI-compatible, con reintentos por 408/429/5xx y abort | **A** — refuerza nuestro diseño de proveedor |
| Estado del índice (chunks, sesiones, dimensión, modelo) | **A** — informativo para diagnóstico |
| Suscripción a `session/created` / `session/event` / `session/flush` y patch de Cordis | **B** — debe vivir en un adaptador DSH, nunca en el core |
| Panel `client.js` sobre slots de DSH y ajustes en `settings.yaml`/`.env` | **C** — específico del host |
| Índice en un único JSON con fuerza bruta de coseno | **D** — no escala a nuestro corpus (FTS + vectores + auditoría en SQLite) |
| Reconstrucción completa al cambiar de modelo | **D** — nosotros versionamos por `model`/`dim` |

## 6 · Límites de esta entrega

- La implementación vive **sólo** en la copia; el worktree original no se ha tocado.
- No se ha cableado el 100 % de los consumidores ni se ha ejecutado una prueba con el modelo real.
- Sin dependencias npm nuevas.
