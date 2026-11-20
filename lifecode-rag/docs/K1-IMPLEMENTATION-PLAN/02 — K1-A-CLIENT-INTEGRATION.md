# 02 — K1-A · Integración visual y montaje del cliente

**Clase:** `CLIENT` + `TESTING` + `HOST-INTEGRATION` · **Etapa:** K1-A
**Precondición:** G1/G2 aprobadas por el propietario · **Estado de partida:** el cliente **no carga**
**No implementa nada en K1.** Este documento es la especificación de la futura implementación.

---

## 1. Objetivo

Conseguir que DeepSeek Harness descubra, cargue y monte la mitad cliente de `@local/lifecode-rag`:
una fila en `sidebar.panellist` y una vista en `main`, con locales resueltos, desmontaje limpio y **sin
datos reales**. La primera prueba es visual y usa fixtures estáticos.

## 2. Alcance

Dentro:

- `package.json`: mapa `exports` (y nada más).
- `client.js`: registro de slots, locales, ciclo de vida, modo fixtures, corte de red.
- `tests/client.test.mjs` y `tools/check.mjs`: los gates que impiden la regresión.
- Una prueba visual en el host con reinicio.

Fuera:

- Cualquier ruta HTTP nueva, cualquier lectura de almacén, cualquier escritura.
- El panel legacy `/lifecode-rag/api` (se conserva tal cual, para perfiles con almacén v0.2).
- `index.js`, `lib/**`, el esquema SQLite, el perfil, el manifiesto del perfil.

## 3. Diagnóstico de partida (medido)

El cliente no aparece por **dos** causas independientes, y las dos tienen que corregirse:

1. **No se puede servir el bundle.** `package.json` declara `dsh.client` con `platform: 'web'` y no tiene
   `exports`. El anfitrión lanza, al componer la fila:
   `client-modules: @local/lifecode-rag declares dsh.client but exports no "./client" bundle`.
   La comprobación está en `@deepseek-ai/dsh-client-modules/src/index.ts` (fuente incluido en
   `app.asar` 0.2.2-rc.5): si `parseDshClient(...).platform !== 'web'` la fila no es de cliente; si lo es
   y `clientExportOf(pkg.exports)` devuelve `undefined`, lanza el error anterior.
2. **El registro de slots es de una API anterior.** `client.js:732-747` hace
   `const sidebar = ctx.slots.inject(SIDEBAR_SLOT); sidebar.register({...}, ICON);`. La implementación
   vigente es `inject(key, callback)` y **devuelve una función disposer**; el registro se crea dentro del
   callback (`() => ctx.slots.register(...)`), que corre en `ctx.effect`. Resultado: `.register` no existe
   → `TypeError` en `apply`.

Consecuencia: aunque se arregle sólo el manifiesto, el cliente cargaría y reventaría al aplicar. Aunque
se arregle sólo el registro, el bundle no llegaría al navegador. **Las dos correcciones son
independientes y ambas obligatorias.**

## 4. Patrón transferible vs. dominio del Skill Center

| Pieza del Skill Center | ¿Transferible? | Por qué |
|---|---|---|
| `exports` con `"."`, `"./client"`, `"./package.json"`, `"./lib/*"` | **Sí, literal** | Es el contrato del anfitrión, no del dominio |
| `window.__ModuleLoader__.load({ id: '<paquete>', factory(require) {…} })` | **Sí, literal** | El id debe ser el nombre del paquete |
| `inject: ['slots', 'locale']` en el objeto devuelto | **Sí, literal** | Sin `slots`, el guardián niega el servicio |
| `ctx.effect` para el `<style>` con `id` estable | **Sí** | Evita duplicados al remontar |
| `ctx.effect(() => locale.register(NS, DICTIONARIES))` | **Sí** | Es la forma medida; no hay ficheros de locale en este repo |
| `ctx.slots.inject(slot, () => ctx.slots.register(opts, C))` | **Sí, literal** | Es la API vigente |
| Franja de estado, tablas, tarjetas, tokens CSS `--dsw-*` | **Sí, como lenguaje visual** | Coherencia con el anfitrión |
| Puente de sesión (`conversation.session.header.actions` + probe mudo) | **Sólo para K1-C/G5** | Es direccionamiento; en K1-A/B no se necesita y añade superficie |
| Modelo de datos (skills, versiones, propuestas, activaciones) | **No** | Dominio exclusivo del Skill Center |
| Rutas `/lifecode-skill-center/api/*` y su estado | **No** | Otro producto |
| Aprobación humana de publicar/activar | **No** | El RAG no publica nada desde la UI |

Regla: se copia **la forma de montar**, nunca el modelo de negocio. Un `require('@deepseek-ai/…')` en el
cliente es un fallo, no una dependencia.

## 5. Archivos que probablemente deberán modificarse

| Archivo | Acción | Detalle |
|---|---|---|
| `lifecode-rag/package.json` | modificar | añadir `exports`; **no** tocar `files`, `engines`, `dsh.bundle`, `dsh.client.platform`, `dsh.client.immediately` |
| `lifecode-rag/client.js` | modificar | registro de slots, locales, ciclo de vida, `DATA_MODE` |
| `lifecode-rag/tests/client.test.mjs` | modificar | contrato estático ampliado |
| `lifecode-rag/tools/check.mjs` | modificar | gate de manifiesto (G3) |
| `lifecode-rag/docs/` | crear | evidencia de K1-A (documento nuevo, sin sobrescribir) |

## 6. Archivos que deben permanecer intactos

`index.js` · `lib/**` (44 módulos, incluidos `tools.mjs` y `exec-context.mjs`) · `bin/**` · `tools/hermetic.mjs`
· `cordis.patch.yml` · `icon.svg` · `docs/PA-UI-0-*.md` · `docs/CONTRATO-v0.1.md` · `lifecode-skill-center/**`
· `skill-compiler/**` · el `package.json` del perfil · el `cordis.patch.yml` del perfil · cualquier fichero
bajo `~/.dsh`.

## 7. Dependencias

- G1/G2 aprobadas (documentos y decisiones).
- Autorización explícita del cambio de manifiesto.
- Autorización del reinicio para la prueba visual (K1-A-09).
- Host 0.2.2-rc.5 en ejecución, con `@local/lifecode-rag` ya enlazado en el perfil `desktop`
  (medido: `link:C:/xampp/htdocs/plugins-dhs/lifecode-rag`, presente en `bundles`).

## 8. Secuencia de tareas

### K1-A-01 · `DOCUMENTATION` · Línea base

Registrar: versión del host, hashes de `package.json`/`client.js`/`index.js`, y los defectos A-1…A-9.
**Salida:** tabla de línea base con `sha256` (los valores de hoy están en `01` §2.3).

### K1-A-02 · `CLIENT` · Manifiesto

Añadir a `package.json`:

```json
"exports": {
  ".": "./index.js",
  "./client": "./client.js",
  "./package.json": "./package.json",
  "./lib/*": "./lib/*.mjs"
}
```

- No añadir `dsh.client.inject`: medido, es orden de activación, no requisito de carga (ver `07` K1-D-02).
- Comprobar con Node que `require.resolve('@local/lifecode-rag/client')` resuelve, y que la entrada
  principal sigue siendo `index.js`.

### K1-A-03 · `CLIENT` · Registro de slots

Sustituir las dos llamadas por la forma vigente, dentro de `apply`:

```js
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist', id: PANEL_ID, order: 35,
  label: () => t('app.title'), locale: NS,
}, Icon));

ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main', key: PANEL_ID, order: 55, locale: NS,
}, Panel));
```

`PANEL_ID` sigue siendo `lifecode-rag` (coincide con la clave del panel y con el `id` de la fila).
El registro no se hace a mano fuera del callback: si el slot no existe todavía, el anfitrión espera.

### K1-A-04 · `CLIENT` · Locales

- `NS = 'lifecode-rag'`; diccionarios ES y EN **inline** (como el Skill Center), con paridad clave por clave.
- Registro dentro de `ctx.effect`, con `dispose` devuelto.
- Todo texto visible sale de `t(...)`; ningún literal en el cuerpo del componente.
- La etiqueta de la fila usa el mismo diccionario.

### K1-A-05 · `CLIENT` · Ciclo de montaje y desmontaje

- Un solo `useEffect` de arranque por vista; su `return` limpia intervalo, `AbortController`, listeners y
  cualquier nodo propio.
- **Sin temporizadores en K1-A** (no hay datos que refrescar).
- El `<style>` vive en un `ctx.effect` con `id` fijo: al remontar no se duplica.
- El panel no escribe en `document.body` ni fuera de su contenedor.

### K1-A-06 · `CLIENT` · Modo fixtures y corte de red

- Constante de compilación `DATA_MODE = 'fixture'` en K1-A/B. En ese modo:
  - `request()` lanza `Error('fixture-mode')` **antes** de tocar `fetch`;
  - el panel pinta el fixture estático;
  - una banda visible dice «Datos sintéticos · sin acceso al almacén» con `role="status"`.
- Ningún camino de K1-A/B puede leer `/lifecode-rag/api` ni `/lifecode-rag/ui/api`.
- El modo `live` **no existe** hasta que K1-C se cierre y se autorice.

### K1-A-07 · `TESTING` · Contrato estático del cliente

Ampliar `tests/client.test.mjs` (hoy 49 líneas, 5 pruebas) con:

1. `window.__ModuleLoader__.load` presente y `id === require('../package.json').name`.
2. Cero `from '@deepseek-ai/` y cero `require('@deepseek-ai/`.
3. `ctx.slots.inject(SLOT, () =>` presente para los dos slots; **ausente** la forma `inject(SLOT)` seguida
   de `.register`.
4. `locale.register` presente y paridad de claves ES/EN.
5. `DATA_MODE` presente y `request()` con guarda previa a `fetch`.
6. Sin `innerHTML` con datos; sin `setInterval` en K1-A.
7. `key: PANEL_ID` en `main` y `id: PANEL_ID` en `sidebar.panellist`.

### K1-A-08 · `TESTING` · Gate de manifiesto (G3)

Extender `tools/check.mjs` (hoy 77 líneas: sin dependencias, sin red, patch correcto, 7 herramientas con
parámetros y salida). Añadir:

- `exports['./client']` es cadena o `{ default: string }`;
- `exports['.'] === './index.js'`;
- `dsh.client.platform === 'web'`;
- `dsh.bundle.patch === './cordis.patch.yml'`;
- el `id` del loader en `client.js` es igual a `package.json.name`;
- existen diccionarios ES y EN y tienen las mismas claves.

Salida esperada: una línea con el número de herramientas (7) y los gates nuevos en verde.

### K1-A-09 · `HOST-INTEGRATION` · Prueba visual

1. Reiniciar el host (**acto humano autorizado**).
2. `window.__DSH_BOOT__.entries` contiene una fila con `id: '@local/lifecode-rag'` y `url` servida.
3. La fila aparece en la barra lateral **con la barra desplegada** (condición conocida; una fila que no se
   ve en la pantalla de inicio no está rota).
4. Al pulsarla, el panel se monta en `main`; `document.querySelectorAll('.lcr-root').length === 1`.
5. Al cambiar a otra vista, `.lcr-root` vuelve a `0` y `#lcr-styles` no se duplica.
6. Consola: sin `TypeError`, sin `slot entry crashed in '…'`.
7. Cambio de idioma del anfitrión: los textos siguen resolviéndose (ES y EN).
8. Segundo reinicio: el panel vuelve, sin duplicar filas.

### K1-A-10 · `TESTING` · No regresión

- `node --test` **dentro de** `lifecode-rag/` (38 ficheros de prueba).
- `node tools/hermetic.mjs`: huella del almacén real antes y después.
- `node tools/check.mjs`: 7 herramientas con sus esquemas.
- A-05 de la aceptación: el listado de herramientas del host sigue teniendo exactamente las siete
  `lifecode_rag_*`, sin parámetros nuevos.

## 9. Pruebas unitarias

| Id | Qué fija |
|---|---|
| CL-01 | El `id` del loader es el nombre del paquete |
| CL-02 | El cliente no importa paquetes del anfitrión |
| CL-03 | Los dos slots usan la forma `inject(key, cb)` y `register` dentro del callback |
| CL-04 | El diccionario ES y el EN tienen las mismas claves y ninguna vacía |
| CL-05 | En modo fixture, `request()` no llama a `fetch` |
| CL-06 | No hay `setInterval` ni `document.body.appendChild` en K1-A |
| CL-07 | `main.key` y `sidebar.id` valen `PANEL_ID` |

## 10. Pruebas de integración

| Id | Qué fija |
|---|---|
| CI-01 | `require.resolve('@local/lifecode-rag/client')` resuelve al `client.js` del paquete |
| CI-02 | `createToolDefinitions` sigue devolviendo 7 definiciones con la misma forma |
| CI-03 | `cordis.patch.yml` sigue insertando `id: lifecode-rag` / `name: '@local/lifecode-rag'` |
| CI-04 | `index.js` no monta la API v0.2 cuando no hay `rag.sqlite3` (comportamiento intacto) |

## 11. Pruebas en el anfitrión

Las de K1-A-09, más una prueba negativa: **quitar temporalmente** `exports['./client']` en una copia
desechable debe reproducir el error del compositor. Esa prueba demuestra que el gate muerde y que la
causa diagnosticada es la real, no una coincidencia. No se ejecuta sobre el árbol de trabajo en uso.

## 12. Riesgos

| Id | Riesgo | Control |
|---|---|---|
| R-A-01 | `exports` rompe la resolución en el perfil enlazado | mapa espejo del Skill Center + arranque real |
| R-A-02 | El panel monta pero queda en blanco (prop o `require` no resuelto) | frontera de error propia + evidencia del grafo |
| R-A-03 | Duplicación de estilos o de locales al remontar | `<style>` con `id` y `ctx.effect` con disposer |
| R-A-04 | Se "arregla" el TypeError con un `try/catch` | el gate CL-03 prohíbe la forma antigua; un `try` no la reintroduce |
| R-A-05 | La prueba visual se da por buena sin reinicio | evidencia con hora y grafo de arranque post-reinicio |

## 13. Criterios de aceptación de K1-A

| Id | Criterio | Cómo se demuestra |
|---|---|---|
| A-1 | El paquete declara correctamente su cliente | `tools/check.mjs` (exports, platform, patch, id) |
| A-2 | Harness descubre y carga el módulo | `__DSH_BOOT__.entries` + ausencia de error de composición |
| A-3 | Sin `TypeError` por APIs obsoletas | consola limpia + CL-03 |
| A-4 | La fila aparece en `sidebar.panellist` | captura + conteo DOM de la fila |
| A-5 | La vista se monta en `main` | `.lcr-root === 1` |
| A-6 | La interfaz se desmonta | `.lcr-root === 0`, `#lcr-styles === 1` tras volver |
| A-7 | Los locales se resuelven | textos ES y EN; paridad de claves |
| A-8 | La carga funciona tras reiniciar | evidencia repetida tras reinicio |
| A-9 | No se rompe el registro de las siete herramientas | `tools/check.mjs` + listado del host |

**K1-A no cierra** ningún criterio de identidad, de API ni de auditoría.

## 14. Condiciones de parada

- Hace falta instalar, reinstalar o cambiar el perfil.
- Hace falta reiniciar sin autorización (o el usuario no está delante).
- El bundle carga pero el panel no monta y la causa exige tocar `index.js` o `lib/**`.
- El gate de manifiesto no puede pasar sin cambiar `dsh.client` más allá de `exports`.
- Aparece un error del compositor distinto del diagnosticado.

## 15. Requisitos de autorización humana

| Acto | Autorización |
|---|---|
| Modificar `package.json` y `client.js` | explícita, por escrito, con el alcance de §5 |
| Reiniciar el host | explícita, en el momento |
| Ejecutar la prueba negativa del compositor | explícita (toca una copia de `package.json`) |
| Cualquier paso hacia datos reales | **no** autorizado en K1-A |

---

**Estado final esperado de K1-A:** `CLIENT MOUNTED (fixtures)` — con G3 y G4 cerrados, G5 `NO PROBADO`,
G6 `BLOCKED`, PA01 `BLOCKED`. El panel visible **no** implica API segura.
