# LE-RAG-10 · Informe de implementación (C1, C2, C5)

> **Superado en el transporte por LE-RAG-11.** Las rutas de búsqueda y contexto pasaron de `GET` con
> parámetros a `POST` con cuerpo JSON contractual. Lo vigente está en
> `docs/PA-UI-0-API-CONTRACT.md` §6.7/§6.8 y en `docs/LE-RAG-11-POST-CONTRACT-REPORT.md`; este informe se
> conserva como registro de la entrega LE-RAG-10.

Entorno: `C:\xampp\htdocs\lifecode-rag-lab\pa-dev` (export de `dfe70f5`). Repositorio original intacto.

## C1 · `lib/pa-api.mjs` (nuevo, núcleo puro)

Cinco contratos, sin importar nada del harness:

| Ruta | Comportamiento |
|---|---|
| `GET /lifecode-rag/pa/snapshot` | proyecto (validado contra el registro), ámbitos con raíces autorizadas, fuentes paginadas (`limit` ≤200, `cursor`), `chunks` por subconsulta, cabeza de auditoría, config efectiva |
| `GET /lifecode-rag/pa/search?q=&limit=` | `search()` del core con el embedder local; `limit` ≤50; `record:false` |
| `GET /lifecode-rag/pa/context?q=&maxTokens=` | `search()` + `assembleContextAsync()` del core (sin duplicar lógica) |
| `GET /lifecode-rag/pa/config` | configuración efectiva (resolvedor perfil > global > defaults) |
| `POST /lifecode-rag/pa/actions` | **403 `approval-required`** siempre; `details.tools` con las tres herramientas de escritura |

Seguridad: rutas fuera del prefijo → 404; métodos no GET → 405; `q` vacío → 400; proyecto desconocido o ambiguo → 403;
registro ausente → 503; `uri` de fuentes **relativizada** contra la raíz autorizada (sin rutas personales);
respuesta limitada a 1 MB; `resolveConfig` aplica la validación única y falla cerrado.

## C2 · `index.js`

- El prefijo PA se registra **siempre** que `webServer` exista:
  `ctx.effect(() => webServer.register({ kind: 'prefix', path: PA_PREFIX, handler: paHandler }))`.
- La API heredada v0.2 sigue condicionada a `legacyStoreExists` (sin cambios de semántica).
- El desmontaje va por `ctx.effect`.

## C5 · Pruebas

- `tests/pa-api.test.mjs` (3): cinco endpoints, errores controlados (400/403/404/405), paginación y límites.
- Adaptadas 3 pruebas del adaptador para reflejar el nuevo contrato: la API **heredada** sigue sin montarse sin
  almacén legado, y la **PA** sí; se comprueban ambos prefijos y los efectos (4 con legado, 2 sin él).
- **Suite completa: 399/399 pass · 0 fail.**

## Pendiente (C3 y validación en vivo)

- `client.js` sigue con `DATA_MODE = 'fixture'`: no se ha conmutado a `live` ni negociado el modo. El panel
  continuará mostrando el fixture hasta implementarlo.
- Sin validación en el laboratorio con el panel conectado (requiere C3 + reinicio del host del laboratorio).
- Sin `DATA_MODE` live no se ha ejercitado `/snapshot` contra el perfil del laboratorio desde el panel; sí
  desde las pruebas del handler sobre el mundo aislado.

## Criterio de finalización

No se declara LE-RAG-10 terminado: falta C3 y la validación real del panel con datos del laboratorio.
