# 02 — Propuesta de enmienda documental de G3

**Acto:** HERMES-LCRAG-K1-DECISIONS-RESOLUTION-01 · **Modo:** `DOCUMENTATION ONLY`
**Base:** Q-08 aprobada — *«Enmendar documentalmente G3 para retirar `dsh.client.inject` como requisito
obligatorio, conservando la evidencia técnica y distinguiendo carga del cliente de orden de activación.»*
**Estado de esta propuesta:** `PROPUESTA` — **no aplicada**. El documento normativo conserva su texto.

---

## 1. Documento normativo afectado

| Campo | Valor |
|---|---|
| Documento | `lifecode-rag/docs/PA-UI-0-ACCEPTANCE.md` |
| SHA-256 actual | `d32a4912f6b75b8b97c4b7e82790fd3067bf759a96d867265a07932ccdd547f9` |
| Sección | §L «Puertas de aprobación para PA-UI-1» |
| Fila | **G3** |
| Estado del documento | PROPOSED — criterios de aceptación de la fase PA-UI-1 |

**No** se modifica aquí. La aplicación exige una fase documental expresamente autorizada sobre ese
fichero, con su propio antes/después de hash.

---

## 2. Texto vigente (citado literalmente)

> `| G3 | La mitad cliente puede cargarse: package.json con exports["./client"] y dsh.client.inject (GAP-01) | node tools/check.mjs extendido o inspección |`

El defecto de la redacción es de **categoría**: mezcla una condición de carga (`exports["./client"]`) con
una arista de orden de activación (`dsh.client.inject`) bajo la misma exigencia. Cumplirla al pie de la
letra puede impedir que el anfitrión arranque, que es lo contrario de lo que el gate quiere garantizar.

---

## 3. Texto propuesto

> `| G3 | La mitad cliente puede cargarse: package.json con exports["./client"] resoluble (requisito de carga) y dsh.client.platform === "web". Las aristas dsh.client.inject no son requisito de carga: sólo ordenan la activación y se exigen únicamente si el panel consume un slot de otro paquete (GAP-01) | node tools/check.mjs extendido: exports["./client"] (cadena o {default: "…"}), platform === "web" y, si hay aristas, que el paquete inyectado esté montado |`

Y, como nota bajo la tabla §L (propuesta, opcional):

> `G3 acredita que el paquete puede cargarse; no acredita que el cliente se monte. Eso se demuestra en G4 (registro de slots con la API vigente) y en la prueba visual de la fase.`

### Diferencia, en una línea

| Antes | Después |
|---|---|
| `exports["./client"]` **y** `dsh.client.inject` | `exports["./client"]` **obligatorio**; `inject` **condicional** (sólo si hay dependencia de slot), y con la comprobación de que el paquete inyectado exista |

Nada más cambia: G4, G5, G6, G6b, G7 y G8 conservan su redacción y su fuerza.

---

## 4. Por qué `exports["./client"]` **sí** es requisito de carga

### 4.1 Evidencia del anfitrión 0.2.2-rc.5

Versión leída del `package.json` incluido en
`C:\Users\<USER>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`.

| Hecho | Fuente en el artefacto instalado |
|---|---|
| El compositor lee el manifiesto del paquete activo y su declaración `dsh.client`; si `platform !== 'web'`, la fila no es de cliente | `@deepseek-ai/dsh-client-modules/src/index.ts`, composición de la fila |
| Si declara `dsh.client` y **no** hay `exports["./client"]`, **lanza**: `client-modules: <paquete> declares dsh.client but exports no "./client" bundle` | `src/index.ts`, llamada a `clientExportOf` en la composición |
| `exports["./client"]` admite cadena o un objeto de una nivel con `default` cadena | `clientExportOf`: *«Resolve `exports["./client"]` to a relative path, accepting the string and one-level conditional forms»* |
| El bundle se sirve bajo `/plugins` y el navegador lo carga como fábrica perezosa | README del paquete: *«an available Web carrier serves each bundle over `/plugins`»* |
| La declaración de cliente exige el export: *«declares `dsh.client` in its `package.json` with `platform: 'web'`, exports a `./client` bundle, and lists any non-baseline module requests under `dsh.client.external`»* | README del paquete, §«Declaring a client plugin» |

**Traducción operativa:** sin `exports["./client"]` no hay bundle servido; sin bundle servido no hay
módulo que registrar; sin módulo no hay panel. El error es determinista y localizable, no un fallo de
render.

### 4.2 El caso concreto que motivó el gate

| Hecho | Medición |
|---|---|
| `lifecode-rag/package.json` | 42 líneas, SHA-256 `a6447caeaa554ca7e145a71cf8d79c5a314187c3e2c9c78f83ee6626c204cf9a` |
| Declara `dsh.client` | `{ "platform": "web", "immediately": true }` |
| Campo `exports` | **ausente** |
| Efecto | el compositor no puede resolver el bundle; el panel no llega a existir |
| `client.js` | existe (751 líneas, SHA-256 `80c27a543333cd4afbbb892864d196459534bbe21b9535c1be11846f64056d5b`) y **no carga** |

Que el fichero exista no cambia nada: el anfitrión no adivina rutas. Ese es el punto que el gate debe
medir.

---

## 5. Por qué `dsh.client.inject` **no** es requisito de carga

### 5.1 Semántica declarada por el anfitrión

| Hecho | Fuente |
|---|---|
| `inject` nombra paquetes cuyas fábricas deben **llegar antes** de que esta fila se materialice: es orden de llegada/activación | `src/client/manifest.ts`, comentario de `WebBootEntry`: *«`inject` names package rows whose factories must arrive before this row materializes, while Cordis separately uses the same package edges to compose entries»* |
| El campo es **opcional** en el tipo (`inject?: string[]`) | `WebBootEntry` |
| `immediately` sí es una marca de precarga (fase uno), distinta de `inject` | mismo tipo: *«`immediately` marks stage-one prefetch»* |
| La declaración mínima que describe el README no menciona `inject`; menciona `platform`, `./client` y `external` | README §«Declaring a client plugin» |

### 5.2 Riesgo de exigirlo

Medido en la casa sobre `0.2.2-rc.1` y registrado en la referencia de slots: declarar en
`dsh.client.inject` el paquete dueño de un slot que no está anunciado como servicio montado deja el plugin
en `pending (waiting for service: …)` y la aplicación no arranca. **No re-medido hoy sobre `0.2.2-rc.5`**;
se cita como evidencia previa, no como medición de esta sesión.

Conclusión: `inject` no puede ser un requisito de carga sin convertir el gate en una trampa. Su uso
correcto es: **sólo si el panel necesita consumir un slot de otro paquete**, y en ese caso la forma
preferida medida es `ctx.slots.inject('<slot>', () => ctx.slots.register(...))`, que espera al slot en vez
de exigir el servicio del vecino.

---

## 6. Qué NO cambia con esta enmienda

- G4 sigue exigiendo el registro de slots con la API vigente (`ctx.slots.inject(key, cb)`).
- G5 sigue exigiendo la obtención real del `sessionId` desde el slot de conversación.
- G6, G6b, G7 y G8 conservan su redacción y su estado (`BLOCKED` / no cumplidos).
- GAP-01 sigue siendo el GAP que describe el defecto; la enmienda no lo cierra ni lo reescribe.
- El contrato `pa-ui/0.1.0-draft` no se toca.

## 7. Observaciones para el acto que aplique la enmienda

1. **Hash de entrada y de salida** del documento modificado, con `sha256sum` antes y después.
2. La cabecera de `PA-UI-0-ACCEPTANCE.md` declara «`pa-ui/0.1.0-draft`, revisión **2**», mientras el
   contrato se titula revisión **3**. Si ese acto toca el fichero, es la ocasión de armonizar la
   referencia; si no se autoriza, se deja como está y se registra la contradicción.
3. `PA-UI-0-GAPS.md` (GAP-01) menciona `dsh.client.inject` de forma **descriptiva**, no como gate. No exige
   cambio; armonizarlo sería un segundo documento y otra autorización.
4. La enmienda no se aplica «de paso» en una implementación: es documental y va antes o después, nunca
   mezclada con código.

## 8. Estado de esta propuesta

| Elemento | Estado |
|---|---|
| Propuesta redactada | sí (este documento) |
| Aplicada al documento normativo | **no** |
| `PA-UI-0-ACCEPTANCE.md` modificado | **no**; hash `d32a4912…47f9` intacto |
| Autorización para aplicarla | pendiente de una fase documental expresa |
