# LifeCode RAG 1.0.0 · Informe final (ACP-01)

**Fecha:** 2026-11-21 (sesión única, 18:00 → 19:00 aprox.)
**Alcance ejecutado:** PA01 (autenticación del panel), CR-1 (selección con CAS), validación del panel, suite y
rendimiento, empaquetado y despliegue en el perfil habitual, aceptación de uso diario.
**Estado final:** `READY_FOR_DAILY_USE`

---

## 1. Qué cambió, en una frase por cosa

| # | Cambio | Evidencia |
|---|---|---|
| 1 | **PA01 cerrado.** La API del panel ya no está abierta: cada petición pasa por `ctx.connection.requestRejection` + `admit` antes de resolver la ruta; sin credencial del host → `401 unauthenticated`; sin servicio de conexión → cerrado (`503 authorization-unavailable`). | Medido en el host real: antes `GET /lifecode-rag/pa/health` → **200** sin cookie; ahora **401** en todas las rutas. `tests/pa-auth.test.mjs` (8 casos), `tests/host-adapter.test.mjs` (2). |
| 2 | **CR-1 implementado.** Selección de proyecto persistida en el perfil con revisión monotónica y compare-and-swap. Conflicto → `409 revision-conflict` con el estado vigente; el perdedor no pisa nada. Sobrevive a reinicio y a cierre de sesión. | `tests/selection-cas.test.mjs` (9 casos) + pulsación real en el panel: revisión 1 → 2 → 3 con aviso «Selección guardada en el perfil (revisión N)». |
| 3 | **El panel funciona en REAL con varios proyectos.** `GET /snapshot` expone `selection`, `projects` (todos los del perfil, con `current`) y `auth.principal`; el panel pide `limit=200` y muestra el total real (121) en vez de la página (50). | Capturas del panel en la instancia del propietario; `tests/pa-api.test.mjs`, `tests/client.test.mjs`. |
| 4 | **Cambio de proyecto sin fuga de datos.** Al confirmar una selección, el panel vacía las fuentes del proyecto anterior y pide el snapshot del nuevo. Antes del arreglo se pintaban 121 fuentes de *LifeCode RAG* bajo el nombre *plugins-dhs* (0 fuentes). | Reproducido y corregido; prueba de reducer + verificación en vivo (0 → 121 → 0). |
| 5 | **Registro v1 → v2 (aditivo).** Tabla `pa_selection` + `user_version=2`, migración dentro de `openRegistry` con `BEGIN IMMEDIATE`. Proyectos, raíces, concesiones y cadena de auditoría intactos. | `tests/registry.test.mjs` (migración + idempotencia) + migración real en el perfil (v1 → v2, 2 proyectos, 2 raíces, cadena `ok`). |
| 6 | **Suite determinista.** `node --test` corría ficheros en paralelo y la guarda de latencia de «ocho ámbitos» fallaba por contención (2151 ms frente a 1500). Se aisló la medición (`--test-concurrency=1`) **sin tocar el umbral**. | 433/433 en verde, tres veces; antes 1 fallo intermitente. |
| 7 | **`tools/benchmark.mjs` reparado.** Medía promesas: `ingestFiles` y `search` son asíncronas desde PA3 y se llamaban sin `await`; el banco fallaba y dejaba restos con EPERM. | `npm run bench` devuelve ahora cifras reales (abajo) y limpia. |
| 8 | **Despliegue.** Instantánea congelada `acp01-7f174851218a` (421 ficheros, 0 discrepancias) instalada por `link:` + junction en `~/.dsh/profiles/desktop`, con respaldo previo y reinicio ordenado. | `LIFECODE-RAG-1.0.0-DEPLOYMENT-REPORT.md` |

## 2. Medidas de la entrega

| Medida | Valor |
|---|---|
| Pruebas | **433 / 433 PASS** (`node --test --test-concurrency=1`, ~47 s) |
| `npm run check` | ✓ 7 herramientas, sin `@deepseek-ai/*`, manifiesto y parche correctos |
| `npm run test:hermetic` | ✓ el almacén real no cambió |
| Almacén real | `registry.sqlite3` v2, `quick_check=ok`, cadena de auditoría **ok** (73 entradas) |
| Datos del usuario | intocados: `scopes/prj_01M7RBSRD33…/rag.sqlite3` sha `4dcf31c4cb70…` (121 fuentes) y `scopes/prj_01M7TRDQYRAPJR03QTM3PP6PX2/rag.sqlite3` sha `0788ffb4c59c…` (0 fuentes) — **idénticos al baseline** |
| Búsqueda (banco, 40 docs) | Recall@5 1.000 (FTS e híbrido) · latencia media 0.20 ms / 0.88 ms · p95 0.23 / 1.25 ms |
| Contexto | 1702 tokens medios (presupuesto 2000) frente a 13010 del corpus: **86.9 % de ahorro**, 0/40 truncados |
| Panel (instancia real) | `data-mode=api`, sin banner sintético, 121 fuentes, «Página 1 de 3», proyecto activo y revisión reales |

## 3. Límites de la evidencia (lo que NO se re-ejercitó en vivo)

1. **Invocación de las siete herramientas por el modelo en esta sesión.** Están registradas (el panel monta
   desde el mismo `apply`) y probadas (`tool-golden`, `integration`, `concurrency`, `partial-results`…), pero no
   se repitió una llamada real del modelo en la ventana. Cerrarlo cuesta un prompt: «invoca `lifecode_rag_list`
   una vez».
2. **Tecleo dentro del panel.** La búsqueda y el contexto del panel se validaron por HTTP autenticado
   (`POST /search` y `POST /context`, con procedencia y presupuesto) y por las pruebas del cliente, no
   tecleando en la ventana: `computer_use` no puede inyectar texto en la clase `Chrome_WidgetWin_1` en segundo
   plano y la alternativa en primer plano roba el foco al propietario.
3. **DEMO visual.** El modo sintético se conserva y sus pruebas pasan; en esta sesión no se conmutó a DEMO en
   pantalla (el panel arranca en REAL por negociación con `/snapshot`).

Ninguno de los tres afecta a la corrección de lo desplegado; los tres se declaran para que no se lean como
verificados.

## 4. Riesgos residuales declarados

- **Cookie de 30 días.** La compuerta reutiliza la cookie del host: un proceso de la misma cuenta de Windows que
  la lea puede hablar con la API del panel. Es el límite del host, no del plugin (§3.5 del contrato).
- **Un solo `principal`.** El host sólo declara `owner`: el panel informa `principal: owner`, nunca un usuario
  inventado.
- **`engines.dsh` es declarativo.** La compatibilidad se demostró cargando el plugin en 0.2.2-rc.5, no leyendo el
  rango.
- **Tres instantáneas vivas** en el almacén (`655f03758fe1` original, `acp01-46d8d4a438e6` y
  `acp01-71ca6863ad63` superadas). Se conservan para volver atrás; no se borró nada.

## 5. Estado del repositorio (no commiteado)

Rama `fix/t45-4-r17-acceptance`, HEAD `655f037` **sin cambios**. Árbol: 41 `M` (25 preexistentes + 16 del acto) y
1144 `??`; índice **vacío**. No se ejecutó `git add`, `commit` ni `push`: el commit requiere autorización aparte
(ver `LIFECODE-RAG-1.0.0-CHANGE-MANIFEST.md`).
