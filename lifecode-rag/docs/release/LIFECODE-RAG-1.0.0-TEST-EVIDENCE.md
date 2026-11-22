# LifeCode RAG 1.0.0 · Evidencia de pruebas

Todo lo de este documento se ejecutó en el equipo del propietario el 2026-11-21. Los números son salida de
comando, no estimaciones.

## 1. Suite completa (código del acto)

```
$ cd C:/xampp/htdocs/plugins-dhs/lifecode-rag
$ npm test          # node --test --test-concurrency=1
ℹ tests 433
ℹ pass 433
ℹ fail 0
ℹ duration_ms 47103
```

433 = 410 previos + **23 nuevos**:

| Fichero | Casos | Qué fija |
|---|---|---|
| `tests/pa-auth.test.mjs` | 8 | Sin credencial: 401 en `/`, `/snapshot`, `/config`, `/search`, `/context`, `/selection`, `/actions` y ruta inventada. Con credencial: 200 y `auth.principal=owner`. `/actions` sigue 403. Compuerta que falla o no decide → 403/503. Rutas fuera del prefijo: 404 **sin** consultar la compuerta. Cabeceras `x-user`/`x-principal`/`authorization: Bearer` → 401. La respuesta no repite cookie ni emite `set-cookie` |
| `tests/selection-cas.test.mjs` | 9 | Selección válida (rev 1 + auditoría), revisión obsoleta (409 sin escribir), dos clientes (200 + 409, revisión avanza una vez), duplicado idempotente (`changed:false`), ausencia/valores inválidos de `expectedRevision` (400), proyecto inexistente o de otro perfil (403), persistencia tras caducar sesiones y tras reiniciar, ambigüedad sin selección (403) |
| `tests/host-adapter.test.mjs` | +2 | La compuerta del adaptador con `requestRejection`+`admit` (401 sin cookie, 200 con cookie) y **fail closed** sin `ctx.connection` (503 + aviso en el log) |
| `tests/client.test.mjs` | +4 | Hidratación toma la revisión del servidor (no la del fixture); en modo API la selección no se adelanta; conflicto no cambia nada; el cambio de proyecto vacía las fuentes del anterior y pide snapshot; `projects`/`sourcesTotal` |
| `tests/pa-api.test.mjs` | +1 | El snapshot declara los proyectos seleccionables del perfil con `current` |
| `tests/registry.test.mjs` | +1 | Migración v1 → v2 aditiva (crea `pa_selection`, conserva proyectos y cadena de auditoría, idempotente al reabrir) |

Ajustadas sin perder cobertura: `adapter.test.mjs` (`inject` pasa a `['tools','webServer','connection']`) y la
aserción del reducer que ahora espera `pending:'snapshot'` tras confirmar.

## 2. Puertas del proyecto

```
$ npm run check
✓ 7 herramientas, sin dependencias de @deepseek-ai/*, manifiesto y parche correctos
  (G3: exports["./client"] resoluble, cliente con la API de slots vigente)

$ npm run test:hermetic
almacén vivo: C:\Users\BYRON\.dsh\lifecode-rag
huella previa: 10 fichero(s) 9fb9…
✓ hermético: el almacén real no cambió (10 fichero(s))
ℹ tests 433 · pass 433 · fail 0
```

## 3. Cambio del instrumento: la guarda de latencia

Antes del acto, con `node --test` en paralelo:

```
✖ ocho ámbitos: se abren, se leen y se cierran sin dejar asas
  AssertionError: abrir ocho ámbitos tardó 2151ms   (umbral 1500)
```

Repetido **en solitario** tres veces: 249 ms, 251 ms, 1191 ms → verde. La causa es contención de disco entre
ficheros de prueba: la guarda medía la máquina. Corrección aplicada: `--test-concurrency=1` en `scripts.test` y
en el lanzador de `tools/hermetic.mjs`. **El umbral no se tocó.**

## 4. Banco de rendimiento (`npm run bench`, 40 documentos, Top-5)

| Estrategia | Recall@5 exactas | MRR@5 | Latencia media | p95 |
|---|---:|---:|---:|---:|
| FTS (BM25) | 1.000 | 1.000 | 0.20 ms | 0.23 ms |
| Híbrido | 1.000 | 1.000 | 0.88 ms | 1.25 ms |

Paráfrasis (`instalar`): FTS 0.000 · híbrido 1.000. Sin acento (`instalacion`): 1.000 en ambos.
Contexto: 1702 tokens medios (presupuesto 2000) frente a 13010 del corpus completo → **86.9 % de ahorro**,
0/40 truncados.

> El banco **estaba roto** antes del acto: `ingestFiles` y `search` son asíncronas desde PA3 y se llamaban sin
> `await`; fallaba con `TypeError` y dejaba restos que no se podían borrar (EPERM). Corregido: `await` en las
> tres llamadas, error del cuerpo ya no lo enmascara la limpieza, y `rmSync` con reintentos.

## 5. Evidencia HTTP en el host real

### 5.1 Antes (build 655f037, dos instancias: laboratorio 64565 y perfil 54255)

| Petición | Resultado |
|---|---|
| `GET /` | 401 (compuerta del host) |
| `GET /api/nope` | 401 |
| `GET /lifecode-rag/pa/config` | **200 sin credencial** ← defecto PA01 |
| `GET /lifecode-rag/pa/health` | **200 sin credencial** |

### 5.2 Después (build `acp01-7f174851218a`), laboratorio 53649 y perfil 64423

| Petición | Resultado |
|---|---|
| `GET /pa/config`, `/pa/snapshot`, `/pa/health` sin cookie | `401 {"ok":false,"error":{"code":"unauthenticated"}}` |
| `GET /pa/snapshot` con cookie del host | `200`, `pa/1.1.0`, `auth.principal=owner`, `projects` con `current`, `sources.total=121` |
| `POST /pa/selection {projectId, expectedRevision:0}` | `200 changed:true`, `selection.revision=1` |
| Repetición con la revisión vigente | `200 changed:false`, revisión **no** sube |
| Revisión obsoleta | `409 revision-conflict`, `details:{expectedRevision, currentRevision, current}` |
| `POST /pa/selection` sin cookie | `401 unauthenticated` |
| `POST /pa/actions` autenticado | `403 approval-required` |
| `GET /pa/search` (método incorrecto) | `405` con `allow:["POST"]` |
| `GET /pa/snapshot?limit=201` | `400 limit-too-large` (max 200) |
| `POST /pa/search {query:"reembolso",limit:3}` | `200 hybrid`, 3 resultados con URI relativa y `scopeKind=prj` |
| `POST /pa/context {query:"reembolso",budgetTokens:300}` | `200`, 289 tokens, `truncated:false`, 3 citas |

### 5.3 Migración del registro en el perfil real

| Antes | Después |
|---|---|
| `user_version=1`, 11 tablas, `registry.sqlite3` sha `80d64e0a749d…`, 70 entradas de auditoría | `user_version=2`, 12 tablas (con `pa_selection`), sha `028252a31b7b…`, 73 entradas, `quick_check=ok`, cadena `ok` |
| 2 proyectos, 2 raíces | 2 proyectos, 2 raíces (sin cambios) |
| `pa_selection` inexistente | 1 fila (`prj_01M7RBSRD33…`, revisión 3, `human`, `owner`) |

## 6. Ensayo de vuelta atrás (respaldo restaurado)

```
respaldo: quick_check ok | user_version 1 | proyectos 2
build anterior (655f03758fe1): abre el respaldo → proyectos 2, tablas 11
instantánea anterior intacta: 407 ficheros, index.js sha a8430e2c19a9…
hashes restaurados: 80d64e0a749d (registro) · 4dcf31c4cb70 · 0788ffb4c59c (ámbitos)  ← iguales al manifiesto
```

## 7. Lo que no se ejecutó

- Invocación de las siete herramientas por el modelo en la ventana (una vez, tras desplegar).
- Tecleo en el panel (búsqueda/contexto) — sustituido por HTTP autenticado y pruebas del cliente.
- Conmutación visual a DEMO.
- `git add`/`commit`/`push`: fuera de autorización.
