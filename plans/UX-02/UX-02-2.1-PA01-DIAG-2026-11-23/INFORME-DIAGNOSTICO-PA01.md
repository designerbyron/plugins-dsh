# Diagnóstico PA01 — por qué los controles de Workspace Center no responden

**Modo:** sólo lectura · **sin cambios de código, configuración ni reinicio** · 2026-11-23T04:1xZ
**Sujeto:** `@designerbyron/lifecode-rag@1.3.0` instalado en `~/.dsh/profiles/desktop` (`client.js`, 4 420 líneas)
**Veredicto:** **dos defectos demostrados por código** en los botones de ruta, y **un tercio de la sección que nunca fue interactiva por diseño**. La hipótesis «el panel entero no responde» queda **descartada** salvo que la sonda (§6) diga lo contrario.

---

## 1. Qué se inspeccionó y con qué

| Inspección | Cómo | Resultado |
|---|---|---|
| Código del panel | lectura de `client.js` instalado (vistas, reducer, efectos, CSS) | idéntico al del repo (`diff` sin diferencias) |
| Enlazado de callbacks | `el(..., { onClick })` + `dispatch`/`setState` en cada control | todos los controles reales **tienen** handler |
| Delegación de eventos | React vía `window.__ModuleLoader__` + `require('react')` | React monta en la raíz del panel; no hay listeners manuales |
| Overlays / z-index | grep de `pointer-events`, `z-index`, `inset`, `position:fixed` | **un solo** overlay: `.lcr-modal` (sólo con diálogo de confirmación abierto) |
| Estado que deshabilite | `disabled: state.mode !== 'api' \|\| ws.loading` | con `mode='api'` y sin carga, **habilitado** |
| Implementación de mostrar/copiar | `PaPath` (líneas 3472-3494) y su CSS (4290-4292) | ver §2 y §3 |
| DOM en vivo | **no disponible sin reiniciar**: la app corre sin `--remote-debugging-port` y no hay `DevToolsActivePort` | requiere la sonda del §6 |

## 2. Causa raíz **A — demostrada**: «Copiar ruta» no puede copiar

`client.js:3700` → `el(PaPath, { path: row.path, t, onCopy: state.copyText })`

- `state.copyText` aparece **una sola vez en todo el fichero**: ahí, como consumidor. **Nunca se define** en el estado inicial ni lo produce ningún reducer.
- `PaPath.copy()` hace `if (props.onCopy) props.onCopy(path)` → con `undefined`, **no llama a nada**; sólo pone `copied=true` 1,5 s.
- En todo `client.js` **no existe ninguna llamada al portapapeles**: `clipboard`, `writeText` y `execCommand` dan **0 coincidencias**.

**Consecuencia medida:** pulsar «Copiar ruta» cambia la etiqueta a «Copiada» durante 1,5 s y **no escribe nada en el portapapeles**. No es un fallo de eventos: es que **la función de copiar nunca se implementó** en este panel. El defecto viene de origen (repo y tarball son idénticos), no de la instalación.

## 3. Causa raíz **B — demostrada en código**: «Mostrar ruta» no puede mostrar la ruta completa

Dos defectos que se suman:

1. **CSS** (4290): `.lcr-pa-path__value { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`
   Aunque `open` cambie el texto a la ruta completa, el elemento **sigue recortando a 240 px con puntos suspensivos**. La ruta completa sólo es accesible por el `title` (tooltip), no por el botón.
2. **Ruta corta** (3497-3501): `paShortPath` devuelve la ruta **sin tocar** si mide ≤ 46 caracteres.
   En ese caso, cerrado y abierto pintan **exactamente el mismo texto**: lo único que cambia es la etiqueta del botón, «Mostrar ruta» → «Ocultar» (10,5 px).

**Consecuencia:** con rutas cortas el botón parece muerto (sólo parpadea su etiqueta); con rutas largas cambia el principio del texto pero nunca se ve el final completo. En ambos casos el requisito «Mostrar» no se cumple.

## 4. Hipótesis diferenciadas sobre «los demás elementos no responden»

| # | Hipótesis | Estado | Cómo se distingue |
|---|---|---|---|
| H1 | **No son controles**: chips, celdas, conteos, pistas y filas no tienen handler | **Demostrada en código** (§5) | inventario de la matriz |
| H2 | La **etiqueta sí cambia** y el usuario no lo percibe por ser un cambio de 10,5 px | **Probable** | sonda §6 paso 6: `laEtiquetaCambio` |
| H3 | Los eventos **no llegan** al componente (montaje del host, overlay invisible, `inert`) | **Descartada por indicio fuerte, pendiente de confirmar** | sonda §6 pasos 3-4: `elementoEnElPunto`, `pointer-events` |

**Por qué H3 está casi descartada:** la vista inicial del panel es `overview` (`client.js:1814`) y el propietario llegó a **Workspaces** y a **Diagnóstico**. Esos cambios de vista sólo ocurren con `dispatch({type:'nav'})`, es decir, con **clics que sí funcionaron**. Si los clics funcionan en la subnavegación, el mismo `onClick` de los botones de ruta también se dispara.

## 5. Matriz de controles de la sección Workspaces

| Elemento | ¿Es control? | Handler | Verdicto |
|---|---|---|---|
| Subnavegación de áreas (Resumen · Workspaces · Seguimiento · Ajustes) | sí | `dispatch({type:'nav'})` | **funciona** (llegó a las vistas) |
| **Actualizar** | sí | `dispatch({type:'workspaces-refresh'})` | **funciona**, salvo `mode≠api` o carga en curso (entonces aparece `disabled`) |
| **Añadir carpeta** | sí | `dispatch({type:'nav', view:'candidates'})` | **funciona** (navega a Candidatos) |
| **Mostrar ruta** (por fila) | sí | `setOpen(!open)` local | **no cumple** lo que promete — causa **B** |
| **Copiar ruta** (por fila) | sí | `props.onCopy` → **`undefined`** | **no copia nunca** — causa **A** |
| Chip «Detectados por DSH: N» · «Con proyecto: M» | **no** | — | visual por diseño (`paChip` → `<span>`) |
| Columna Título | **no** | — | texto (`<strong>`) |
| Columna Estado (chip + motivo) | **no** | — | visual (`paStateChip`) |
| Columna Proyecto · Relación · Sesiones | **no** | — | texto/chips |
| Fila completa (`<tr data-ws-path>`) | **no** | — | tiene atributo de datos, **sin** `onClick`: no es clicable |
| Pista al pie («Sólo lectura…») | **no** | — | texto |

> Conclusión de §5: en la sección hay **cuatro** cosas que se pueden pulsar, no diez. Todo lo demás es información.

## 6. Evidencia de consola y eventos (requiere un pegado del propietario)

Sin `--remote-debugging-port` no puedo leer el DOM ni la consola sin reiniciar la app, y reiniciar está prohibido. Sonda preparada y **validada sintácticamente** (`node --check` OK):
`evidence/PA01-probe-consola.js`

1. En la app: **Ctrl+Shift+I** → pestaña **Console**.
2. Pegar el contenido completo del fichero y Enter.
3. Devuelve un JSON. Los tres campos que deciden:
   - `6_clic_sintetico.laEtiquetaCambio` — si es `true`, los eventos llegan (**causa B**); si es `false`, no llegan (**hipótesis H3**).
   - `3_hit_test.tapaAlgo` / `elementoEnElPunto` — si hay algo encima del botón.
   - `2_controles.botonActualizar.deshabilitado` — si está atenuado por estado.
4. Copiar el objeto (botón derecho → *Copy object*) y pegarlo aquí.

La sonda **no** pulsa «Actualizar» (haría una petición), no escribe nada y sólo dispara un clic sintético en «Mostrar ruta» (estado local puro).

## 7. Diagnóstico vs API `pa/1.4.0` — el texto del panel se queda corto

La vista dice: *«Integridad, auditoría y versiones todavía no se leen de la API PA: esta vista muestra sólo los ámbitos efectivos del proyecto.»*

**Es cierto que la vista no los lee; es impreciso que la API no los dé.** Medido en el código instalado:

| Dato | ¿Está en la API? | Dónde |
|---|---|---|
| Ámbitos efectivos | sí | `/snapshot` → `scopes` (**se pinta**) |
| Cabeza de auditoría (`audit.head`) | **sí** | `/snapshot` → `audit.head` |
| Versión del contrato (`pa/1.4.0`) | **sí** | `/snapshot` → `version` |
| Integridad de la cadena de auditoría | **sí** | `/history` → `integrity` (`verifyAuditChain`) |
| Versión del plugin / del host | **no** | no hay ruta que las publique |
| Ruta `/diagnostics` | **no existe** | `GET_ROUTES` = `/`, `/snapshot`, `/history`, `/workspaces` |

Propuesta de texto honesto: «Ámbitos efectivos (de la API). La cabeza de auditoría y la versión están disponibles pero esta vista aún no las pinta; la integridad de la cadena viaja en el historial; la versión del plugin vive en el `package.json` instalado, no en la API.»

## 8. Dónde se ven las siete tools

**No en el panel.** Las siete herramientas son cara al modelo: se registran con `ctx.tools.register` en `index.js` (`inject: ['tools','webServer','connection']`) y se construyen con `createToolDefinitions`. El sitio donde se comprueban es el **catálogo de herramientas del host** o preguntándole al modelo (§C5 de las instrucciones PA01). Medido aparte sobre el paquete instalado: **7** herramientas (`context, forget, get, ingest, list, reindex, search`).

## 9. Propuesta mínima de corrección (sin implementar)

1. **Copiar de verdad** (`PaPath.copy`): `navigator.clipboard.writeText(path)` y, si rechaza o no existe, `textarea` oculto + `document.execCommand('copy')`. `copied` sólo a `true` **si** la escritura se confirma; si falla, «No se pudo copiar» (clave i18n nueva ES/EN). Quitar el prop muerto `onCopy: state.copyText`.
2. **Mostrar de verdad**: no pintar el botón cuando `path.length ≤ 46` (no hay nada truncado) y, con `open`, aplicar una clase modificadora que anule el recorte: `.lcr-pa-path__value--open { max-width: none; white-space: normal; overflow-wrap: anywhere; }`.
3. **Diagnóstico**: sustituir `diagnostics.pendingApi` por el texto del §7 y, si se quiere completo, consumir `audit.head` y `version` de `/snapshot` y `integrity` de `/history` (los tres ya existen; ninguno es escritura).
4. Nada de esto toca la API, el almacén, la configuración ni el host: es `client.js` + dos claves de i18n.

## 10. Pruebas de regresión necesarias

| # | Prueba | Criterio |
|---|---|---|
| R1 | Reducer/función de copia con doble de `clipboard` | con éxito → estado «Copiada»; con rechazo → «No se pudo copiar», nunca mentira |
| R2 | Render de `PaPath` con ruta de 40 y de 120 caracteres | 40 → sin botón «Mostrar»; 120 → con botón y, abierto, texto completo (`scrollWidth === clientWidth`) |
| R3 | i18n ES/EN | claves nuevas presentes en los dos idiomas, sin literales sueltos |
| R4 | Sección Workspaces | sigue pintando 8 filas, chips y estado; «Actualizar» y «Añadir carpeta» intactos |
| R5 | Sólo lectura | hashes de las 3 bases y `config.json` idénticos antes/después de la prueba manual |
| R6 | Compatibilidad `pa/1.3.0` | `/snapshot` y las rutas antiguas sin cambios de forma |

## 11. Lo que se tocó

**Nada, por mi parte.** Este diagnóstico es lectura de ficheros instalados y del repo. Verificado al cerrar: los
tres `.sqlite3` y `config.json` conservan sus hashes (`4b67cadc…`, `4dcf31c4…`, `6130ecba…`, `b15622c0…`), la app
sigue corriendo sin reinicio y GIT sigue en `7d7e839` con el índice vacío.

**Corrección de una afirmación mía:** al cerrar escribí que el perfil seguía igual que tras la instalación. **Ya no
era cierto en ese momento, y no por mi mano**: ver §12.

## 12. El host modificó el perfil después de la instalación (04:23Z) — y no fui yo

Medido al verificar este mismo informe: a las **04:23:32Z** (22:23:32 local), ~20 min después de la instalación,
cambiaron `package.json`, `pnpm-lock.yaml` y `pnpm-workspace.yaml` del perfil. El diff contra las copias que dejé:

| Cambio | Quién | Efecto |
|---|---|---|
| `dsh-context` 0.87.0 → **0.87.1** | el actualizador del host (`dsh-plugins-update`) | plugin ajeno actualizado |
| `dsh-data-quality` 0.3.28 → **0.3.29** | ídem | plugin ajeno actualizado |
| `link:` de `@local/skill-compiler` reescrito de 6 a **5** `../` | esa misma ejecución de pnpm | **corrige** el desfase que hacía fallar `--frozen-lockfile` (§3.1 del informe de instalación) |
| exclusiones `@1.1.0` y `@1.3.0` fusionadas en `'@designerbyron/lifecode-rag@1.1.0 \|\| 1.3.0'` | pnpm, normalizando | la exclusión **sobrevive** |

**Lo importante:** ese `pnpm install` real **aceptó nuestro lock quirúrgico**. Comprobado después:

- `@designerbyron/lifecode-rag` sigue en **1.3.0** con nuestra `integrity` (`sha512-Q/EvDeGx…`) en el lock;
- el paquete instalado sigue con **74 ficheros** y es **byte a byte el artefacto** (`package.json 1b87ca7c…`,
  `lib/pa-api.mjs 14ff188d…`, `client.js ff8119dd…`);
- los almacenes RAG **no cambiaron** (`4b67cadc…`, `4dcf31c4…`, `6130ecba…`).

Es decir: la instalación quirúrgica no sólo pasó mis comprobaciones, **pasó también un `pnpm install` posterior
ejecutado por el propio host**, que es la prueba que el ensayo `--frozen-lockfile` no podía dar en ese perfil.
Los dos plugins actualizados son ajenos a este acto y no los he tocado ni revertido.

**Estado del perfil ahora:** `package.json` `c5d94a03…`, `pnpm-lock.yaml` `6f97fe2b…`,
`pnpm-workspace.yaml` —medido tras el cambio del host—; versiones ajenas 0.87.1 / 0.3.29.


Queda **pendiente de autorización independiente** cualquier corrección del §9.
