# Investigación — `dsh-app://app/plugins/??…/client.js` (404) y activación de módulos cliente

**Modo:** sólo lectura · host **no** reiniciado, cachés intactas, sin `pnpm`, sin cambios de configuración ni de Git
**Fecha:** 2026-11-23T04:45–04:52Z · **Host:** `0.2.2-rc.5` (commit `3f85d88`), backend pid **3208**, escucha en
`127.0.0.1:56798` (el puerto cambia en cada arranque: `57200` era el anterior)
**Artefacto de consola del propietario:** `Texto pegado(20261123-043538).txt` — **no está en disco** (busqué en
`Descargas`, `Escritorio` y `attachments`); trabajo con la descripción literal que diste y con medición propia.

**Veredicto:** los 404 **no** son un manifiesto roto ni ficheros ausentes. Son **una generación de módulos
obsoleta: el cliente pidió URLs con un `rev` que la composición actual ya no conoce**. El host sirve
correctamente los cinco bundles ahora mismo (`200`, byte a byte los instalados + cola de sourcemap). El `??` de la
URL **no es un fallo**: es la sintaxis de combo del propio DSH.

---

## 1. Cadena de resolución, con rutas exactas

`dsh-app://app/plugins/…` se atiende en **dos saltos**:

1. **Shell Electron** — `/lib/main.js` (dentro de `resources/app.asar`, 848 505 B), `protocol.handle('dsh-app', …)`
   en la línea 20 791:

   ```js
   if (url.hostname === "shell") → sirve documentos propios (renderer/, lib/welcome)
   if (url.hostname === "app") {
     if (pathname es "/", "/index.html", "/assets/*", "/favicon.svg", "/manifest.webmanifest")
        → sirve desde app.asar: dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist
     if (backend.host === undefined || hostUrl === undefined || hostCookie === undefined)
        → 503
     → forwardWebRequest(request, hostUrl, hostCookie)          // proxy al Host
   }
   → 404
   ```

   `forwardWebRequest` (línea 15 348) conserva **`pathname` y `search`** y añade la cookie del host. Es decir:
   un 404 en `/plugins/…` **lo produce el Host**, no el shell.

2. **Host** — paquete `@deepseek-ai/dsh-client-modules`, `lib/index.js`. Registra la ruta:

   ```js
   webCtx.webServer.register({ kind: "prefix", path: "/plugins", resource: r => this.fetchBundle(r) })
   ```

   y despacha en `bundleResource()` (línea 1 095). **Sólo hay tres formas de responder 200**:

   ```js
   const resourceUrl = `${requestUrl.pathname}${requestUrl.search}`;
   const response = this.responses.get(resourceUrl)          // combos anunciados por la composición ACTUAL
                 ?? this.previousBatchResponses.get(resourceUrl)  // UNA sola generación anterior
                 ?? this.chunkResponse(requestUrl);          // chunk de la revisión actual
   if (response) → 200 ; si no → 404
   ```

   Comentario del propio código sobre `previousBatchResponses` (línea 585):
   *«One prior graph generation covers a request racing the HMR recomposition that replaced its URL.»*

## 2. El `??` de la URL: sintaxis de combo, no corrupción

`lib/index.js`, líneas 261-268:

```js
function comboSearch(ids, rev, sourceMap = false) {
  return `??${ids.map((id) => `${id}/client.js${sourceMap ? ".map" : ""}`).join(",")}&rev=${rev}`;
}
function comboUrl(ids, rev, sourceMap = false) { return `${PLUGIN_ROUTE}/${comboSearch(ids, rev, sourceMap)}`; }
```

- Primer `?`: abre la query. Segundo `?`: **separador propio** para que el nombre del paquete conserve sus `/`
  (`@scope/nombre` ocupa dos segmentos).
- Varias entradas se concatenan con `,` en **una sola URL** (límite: `MAX_COMBO_URL_BYTES = 3·1024`).
- `&rev=` lleva un hash **sha1 recortado a 12 hex** (`HASH_REVISION_LENGTH = 12`), por entrada y por contenido.
- La respuesta es inmutable (`cache-control: public, max-age=31536000, immutable`) y **una revisión que no
  coincide no se sirve con bytes nuevos: se rechaza**.

**Consecuencia estructural:** si un combo agrupa varias entradas y su `rev` no está en los mapas, **todas** caen
juntas. Eso explica «dependencias omitidas después de un fallo previo»: no fallan cinco cosas, falla **un** URL.

## 3. Reproducción del 404 con una sola variable: el `rev`

Misma ruta, `GET` sin credenciales (la ruta `/plugins` **no** está tras la compuerta, a diferencia de `/`):

| URL | Resultado |
|---|---|
| `/plugins/??@designerbyron/lifecode-rag/client.js&rev=000000000000` | **404** |
| `/plugins/??@designerbyron/lifecode-rag/client.js&rev=c30d85c59345` | **200**, 243 997 B |

`000000000000` es el propio centinela del código (`COMBO_REVISION_PLACEHOLDER`). **El 404 se reproduce sin tocar
nada más que la revisión.**

## 4. El grafo actual (evidencia en vivo, canal SSE sin credencial)

`GET /plugins/events` (SSE de `dsh-client-hmr`) responde **200** y publica el grafo vigente. Capturado en
`evidence/grafo-actual.sse` / `grafo-actual.json`:

- `rev` global del grafo: **`1e3caec0cf41`** · release `0.2.2-rc.5` (`3f85d88`) · **83 entradas**.
- **Exactamente 5 entradas externas** (las del perfil); el resto son módulos del runtime.

## 5. Resultado de resolución de los cinco plugins (pedidas las URLs que el host anuncia)

| Plugin | `rev` anunciada | HTTP | bytes servidos | bytes en disco | delta | sha256 en disco |
|---|---|---|---|---|---|---|
| `@designerbyron/lifecode-rag` | `c30d85c59345` | **200** | 243 997 | 243 913 | +84 | `ff8119dde0c1…` |
| `@local/lifecode-skill-center` | `3575352e6f83` | **200** | 539 243 | 539 158 | +85 | `2490839c737d…` |
| `@tuhengyu/dsh-full-life-memory` | `c4fd5f2ed225` | **200** | 38 945 | 38 858 | +87 | `87b5495797c9…` |
| `dsh-plugins-update` | `4e1882cdc67f` | **200** | 64 565 | 64 490 | +75 | `231ade53b057…` |
| `billion-context` | `2d5cfe723194` | **200** | 34 259 | 34 187 | +72 | `a3f762e8759b…` |

El delta es **exactamente la cola** `;\n//# sourceMappingURL=??<id>/client.js.map&rev=<rev>\n`. Comprobado byte a
byte para lifecode-rag: **los primeros 243 913 bytes son idénticos** al `client.js` instalado, y el bundle
contiene los marcadores de 1.3.0 (`paViewWorkspaces`, `ux.ws.refresh`, `diagnostics.pendingApi`,
`lcr-pa-path__value`, `copyText`).

## 6. «Manifiesto vs archivos instalados»: no hay desajuste

- `dsh/desktop-runtime.json` (4 738 750 B, sha256 `bc7390d0088b9a4e…`): `sharedPackages` **336**, `files` **20 563**
  con `bytes` y `sha256`. Describe **el runtime empaquetado**; un plugin externo **no aparece ahí por diseño**
  (se compone en caliente desde el perfil). Buscar `lifecode` en él y no encontrarlo **no es un defecto**.
- Los cinco paquetes externos declaran `exports["./client"]` y el fichero existe en todos:
  `lifecode-rag/client.js`, `lifecode-skill-center/client.js`, `full-life-memory/client.js`,
  `dsh-plugins-update/lib/client.js`, `billion-context/dist/agent/dsh-native-client.js`.
- `require.resolve('<id>/client')` funciona en los cinco; `require.resolve('<id>/client.js')` falla en los cinco
  (`ERR_PACKAGE_PATH_NOT_EXPORTED`) — irrelevante: el `/client.js` de la **URL** es ruta de ruta, no especificador
  de módulo; el servidor lee el fichero ya resuelto en la composición.

## 7. Logs y causalidad

**Gestor de plugins** (`%APPDATA%\@deepseek-ai\dsh-desktop\plugin-operations\operations.jsonl`, 72 695 B):

```
04:23:06.800Z remove  dsh-context 0.87.0  started
04:23:10.289Z remove  dsh-context 0.87.0  settled applied changed
04:23:10.290Z install dsh-context 0.87.1  enabled:false  started
04:23:14.358Z install dsh-context 0.87.1  enabled:false  settled applied changed
04:23:28.790Z remove  dsh-data-quality 0.3.28  started
04:23:33.506Z install dsh-data-quality 0.3.29 enabled:false settled applied changed
```

**Procesos del host** (hora local): main `20324` y backend `3208` desde **22:04:57**; segundo renderer `26148`
desde **22:21:55**; los dos «install» a las **22:23:06–22:23:33**; consola del propietario a las **22:35:38**
(= `043538Z`).

**Lectura causal:** las dos instalaciones ocurren **dentro** del mismo proceso que sirve el grafo actual. Como
`dsh-context` y `dsh-data-quality` se instalaron **deshabilitados** (`enabled:false`) y `dsh-data-quality` no
declara cliente (`dsh.client: null`), **no añadieron ni quitaron entradas al grafo** (comprobado: `dsh-context` no
está entre las 83; el conjunto externo sigue siendo 5). Es decir, el índice de módulos **no cambió** por esa vía.

## 8. ¿Pudo el `pnpm install` del actualizador alterar artefactos o el índice?

**No, medido:**

- `@designerbyron/lifecode-rag` no fue tocado: **74 ficheros**, `client.js` `ff8119dd…` (idéntico al tarball
  `f848b73e…`), `lib/pa-api.mjs` `14ff188d…`.
- El grafo vigente lo incluye con su `rev` y sirve su bundle con **200** (tabla §5).
- Los dos paquetes que sí cambió son ajenos y quedaron deshabilitados; `dsh-data-quality` no tiene cliente.

## 9. `deepseek-account profile` — investigado aparte, sin atribución

`deepseek-account` corresponde al paquete **empaquetado** `@deepseek-ai/dsh-deepseek-account` (versión
`0.2.2-rc.5`), cuyo dominio son **cuenta, credenciales y notificaciones** de DeepSeek: emite eventos
`deepseek-account/session-expired` y `deepseek-account/model-sign-in-required` (vistos en
`@deepseek-ai/dsh-api-remotes/lib/index.js`). **No hay ninguna relación demostrada con LifeCode RAG** ni con la
ruta `/plugins`. Sin el texto exacto del error no se puede ir más allá: queda **sin diagnosticar**, no atribuido.

## 10. ¿Afecta a la activación real de LifeCode RAG 1.3.0?

- **Ahora mismo, no.** El host anuncia su entrada (`rev c30d85c59345`, `immediately:true`) y sirve su bundle con
  **200** e idéntico al instalado.
- **Mientras dura la ventana de generación obsoleta, sí puede impedir que el módulo se active**: si el cliente
  pide el combo con un `rev` anterior, recibe 404, `__ModuleLoader__` no registra el id y el panel **no aparece**
  (no «aparece muerto»: **no aparece**). El frontend lo trata como **opcional**: sólo lanza error si falla una
  entrada *requerida*; por eso viste `warning: 5 entries did not activate` y no un fallo de arranque.
- El síntoma de clics muertos que diagnosticamos antes es **independiente** y ya está demostrado
  (`state.copyText` inexistente y recorte CSS a 240 px).

## 11. Hechos frente a hipótesis

| # | Afirmación | Estado |
|---|---|---|
| F1 | `dsh-app://app/*` se reenvía al Host salvo `/`, `/index.html`, `/assets/*`, favicon y manifest | **hecho** (main.js 20 791-20 800) |
| F2 | `/plugins/…` lo sirve `client-modules`; el 404 nace ahí, no en el shell | **hecho** |
| F3 | `??` es sintaxis de combo (`comboSearch`) | **hecho** (código, líneas 261-268) |
| F4 | `rev` = sha1 de 12 hex por contenido; revisión ajena ⇒ no se sirve | **hecho** |
| F5 | Sólo se conserva **una** generación anterior | **hecho** (línea 585) |
| F6 | Con `rev` correcta: 200; con `rev` centinela: 404 | **hecho** (reproducido) |
| F7 | Las 5 externas se sirven ahora, byte a byte + cola de sourcemap | **hecho** (tabla §5) |
| F8 | Manifiesto del runtime no incluye plugins externos **por diseño** | **hecho** |
| F9 | El `pnpm install` del actualizador no alteró lifecode-rag ni el índice de módulos | **hecho** |
| H1 | El 404 de las 22:35 fue por **rev/generación obsoleta** en el cliente | **hipótesis fuerte** (mecanismo + reproducción + F5), **no probada** para ese instante |
| H2 | El manifiesto está roto | **refutada** (F8) |
| H3 | Faltan ficheros de los plugins | **refutada** (F7: los cinco existen y se sirven) |
| H4 | El `pnpm install` rompió el índice | **refutada** (F9) |
| H5 | Fallo de dependencias en cascada por un combo roto | **consistente** con «5 entries» + «dependencias omitidas» |

**El único dato que cierra H1 al 100 %** es la línea literal de la consola con la URL completa (`rev=` incluida) y
las líneas `did not activate` con su motivo (`pending (waiting for service: …)` / `failed: …`). Sin el fichero y
sin poder leer el DOM/consola (la app no arranca con `--remote-debugging-port` y reiniciar está prohibido), no lo
invento: queda como hipótesis con mecanismo demostrado.

## 12. Transitorio, caché, manifiesto, resolución o ausencia: clasificación final

- **Transitorio por generación/revisión**, con dos ingredientes del propio diseño: (a) sólo se guarda una
  generación anterior; (b) el shell **quita** a propósito `cache-control: no-store` de los bundles de plugin para
  que Chromium no acumule bundles inútiles entre arranques — con la contrapartida de que una página que sobrevive
  a un cambio de generación puede quedar pidiendo `rev` viejas.
- **No** es manifiesto roto, **no** es ausencia de ficheros, **no** es resolución de paquetes, y **no** lo provocó
  el `pnpm install` del actualizador.

## 13. Límites respetados y una corrección propia

No reinicié, no limpié caché, no reconstruí bundles, no reinstalé, no modifiqué manifiestos, no ejecuté `pnpm`, no
toqué bases RAG, no hice cambios Git. Las únicas escrituras son los ficheros de evidencia de este acto.

**Corrección:** la primera lectura del `app.asar` con mi índice antiguo iba **3 bytes desplazada** (usaba
`16 + u32@12` como inicio de datos en vez de `8 + u32@4`), lo que producía «sin coincidencias» falsas. Corregido
en `evidence/asar-read.mjs`, que construye el índice desde la cabecera del propio fichero. Los datos de este
informe vienen de la lectura corregida.
