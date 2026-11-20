# Verificación de seguridad y del aislamiento de fixtures

**Acto:** `HERMES-LCRAG-FUNCTIONAL-AUDIT-01` · **Fase:** D · **Fecha:** 2026-11-19
**Advertencia:** esto **no** es una certificación de seguridad. Es una auditoría de lo que el panel hace
con los datos, con cuatro niveles de prueba separados.

---

## 1. Cuatro niveles, sin mezclarlos

| Nivel | Qué significa |
|---|---|
| **Probado por pruebas** | una prueba local ejecutada lo demuestra y falla si se rompe |
| **Inferido del código** | se deduce de la inspección estática; no hay ejecución que lo confirme |
| **Observado en el host** | visible en las capturas del propietario |
| **No verificado** | no hay medio autorizado para medirlo |

## 2. Las diez comprobaciones

| # | Comprobación | Estado | Evidencia |
|---|---|---|---|
| 1 | `DATA_MODE = 'fixture'` | **Probado** + **Observado** | prueba que falla si aparece `'live'`; captura de Conexión: `fixture` |
| 2 | La guarda bloquea la capa heredada | **Probado** | `requestLegacy()` rechaza con `code: 'fixture-mode'` y `fetch` sigue en 0 |
| 3 | No se ejecuta ningún `fetch` real | **Probado** | espías en todo el recorrido: `{ fetch: 0, setInterval: 0, setTimeout: 0, requestAnimationFrame: 0 }` |
| 4 | La UI no abre ningún almacén SQLite | **Inferido** | `client.js` no importa `node:fs` ni ningún driver; el navegador no puede abrir SQLite; el hermético confirma que el almacén real no cambió |
| 5 | No se invocan las herramientas reales del RAG | **Inferido** | no hay ruta HTTP ni llamada a `ctx.tools` desde el cliente; las herramientas son del servidor |
| 6 | El modo live no es alcanzable desde la UI | **Probado** + **Observado** | no hay control que cambie el modo; Conexión muestra `fixture` y «no puede activarla» |
| 7 | No hay ruta ni acción oculta que salte el modo | **Inferido** | único punto de mutación: `paReduce` (13 acciones, todas locales); único `fetch` está tras la guarda; `main` monta `PaPanel`, no el panel heredado |
| 8 | No se muestran credenciales ni ids de sesión reales | **Observado** + **Probado** | capturas: sólo ids `*_k1fx_*`; prueba de higiene sin `eyJ`, `sk-`, `.credentials` |
| 9 | Ningún contenido real se filtra a los fixtures | **Probado** | ids `src_k1fx_*`, URIs `sintetico/…`, sin rutas de usuario; prueba de higiene |
| 10 | No hay temporizadores ni polling inesperado | **Probado** + **Inferido** | espías en 0; el único `setInterval` del fichero vive en el componente heredado `Panel`, que **no** se monta (`main` registra `PaPanel`) |

## 3. Detalle de lo que sí está probado

- **31 pruebas** del módulo, entre ellas:
  - «ninguna interacción dispara red ni temporizadores» (recorre las 9 pestañas y pulsa reiniciar);
  - «la capa heredada falla cerrada antes de tocar la red»;
  - «el modo sintético es fijo y no hay ningún control que lo cambie»;
  - «los fixtures no contienen datos privados reales»;
  - «apply registra locales y los dos slots…» (y `main` monta `PaPanel`).
- **Puerta hermética:** suite completa con huella del almacén real antes/después; 5 ficheros, huella idéntica.
- **Gate estático:** `check.mjs` prohíbe imports del anfitrión, dependencias y red en rutas locales.

## 4. Lo que **no** se puede afirmar

- Que el host no registre eventos del panel: `ui.read` **no** existe (GAP-07).
- Que el panel sea seguro frente a otro proceso local: no hay autenticación de sesión (PA01).
- Que no haya efectos secundarios del host al montar el slot (no se instrumentó el DOM).
- Que el renderer no emita errores de consola (no hay acceso a la consola).
- Nada sobre aislamiento topológico ni capacidades del host.

## 5. Gates de seguridad (intactos)

| Gate | Estado |
|---|---|
| GAP-20 | `OPEN / DOCUMENTED HOST LIMITATION` |
| D-UI-03 | `PENDING HUMAN DECISION` |
| Ruta A | `BLOCKED` |
| Ruta B | `NOT DEMONSTRATED` |
| Ruta C | `NOT ACCEPTED` |
| PA01 | `BLOCKED` |
| G6 | `BLOCKED` |
| Q-06 / TI-7 | `PENDING DESIGNATION` |

Ninguno se ha modificado. El panel montado **no** cambia ninguno de estos estados: se verificó el cliente,
no la API.
