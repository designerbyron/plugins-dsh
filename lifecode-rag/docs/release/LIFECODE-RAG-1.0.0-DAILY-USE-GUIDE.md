# LifeCode RAG 1.0.0 · Guía de uso diario

## 1. Dónde está y cómo se abre

- Panel: barra lateral de DeepSeek Harness → **LifeCode RAG** (ya fijado en el perfil `desktop`).
- No hay que arrancar nada aparte: el plugin vive en el perfil
  (`link:C:/xampp/htdocs/dsh-plugins-store/lifecode-rag/acp01-7f174851218a`) y se carga con DSH.
- Datos: `C:\Users\BYRON\.dsh\lifecode-rag\profiles\desktop\` (registro + un almacén por proyecto).

## 2. Lo primero: el proyecto activo

- La pestaña **Proyecto** muestra el proyecto activo, su revisión y los **proyectos candidatos** del perfil.
- Para cambiar: botón **Seleccionar** en la fila del proyecto. La selección se guarda en el perfil con una
  **revisión** que sube de uno en uno, y el panel lo confirma («Selección guardada en el perfil (revisión N)»).
- La selección **sobrevive a reiniciar DSH**. Si dos ventanas cambian el proyecto a la vez, la segunda recibe un
  conflicto, el panel recarga la revisión vigente y **no pisa** el cambio de la otra: no se pierde nada, sólo hay
  que volver a pulsar.
- Proyectos actuales del perfil: **LifeCode RAG** (121 fuentes) y **plugins-dhs** (0 fuentes).

## 3. Qué hace cada pestaña

| Pestaña | Qué muestra | Fuente |
|---|---|---|
| Proyecto | KPIs (ámbitos, bibliotecas, fuentes, servicio), proyecto activo y candidatos | `/snapshot` |
| Bibliotecas | Bibliotecas concedidas (hoy no hay ninguna) o estado vacío explícito | `/snapshot` |
| Fuentes | Fuentes del proyecto con URI relativa, fragmentos, bytes y fecha; paginación | `/snapshot` |
| Búsqueda | Búsqueda en el proyecto activo, con procedencia por fuente | `POST /search` |
| Contexto | Texto listo para el modelo + citas, con tokens y truncado | `POST /context` |
| Operaciones | Explica que escribir se hace con las herramientas `lifecode_rag_*` y aprobación del host | estático |
| Diagnóstico | Ámbitos efectivos y estado del almacén; declara lo que aún no lee | `/snapshot` |
| Conexión | Servicio, versión `pa/1.1.0`, modo y principal del host (`owner`) | `/snapshot` |
| Historial | No disponible: el contrato no expone listado de auditoría (se dice, no se inventa) | — |

## 4. Escribir (ingerir, olvidar, reindexar)

- **Nunca** desde el panel: el botón de escritura no existe y `POST /actions` responde `403 approval-required`.
- Se hace pidiéndoselo al agente en el chat, que invoca `lifecode_rag_ingest`, `lifecode_rag_forget` o
  `lifecode_rag_reindex`. La operación destructiva pide **aprobación en la tarjeta del host**; esa tarjeta la
  pulsas tú.
- El panel no concede permisos ni aprueba nada por ti.

## 5. Seguridad: qué cambió y qué te toca a ti

- La API del panel **exige la credencial del host**: cualquier proceso local sin la cookie de DSH recibe `401`.
  Antes recibía `200` y podía leer tu índice. Si alguna vez ves `401` en el panel, es que la sesión del
  navegador del host caducó: cierra y abre DSH desde el acceso normal.
- La cookie del host caduca a los 30 días; el plugin no la gestiona.
- El panel informa `principal: owner` porque es lo único que el host declara. No hay «usuarios» por proyecto.

## 6. Modo DEMO vs REAL

- REAL es el modo normal: el panel negocia con `/snapshot` y, si responde `mode:'api'`, pinta datos del proyecto
  y **desaparece el banner sintético**.
- DEMO (fixtures) sólo aparece si la API no responde; entonces el panel lo dice en el banner y en Conexión. Los
  datos sintéticos nunca se mezclan con los reales: al hidratar, el estado se reemplaza entero.

## 7. Problemas típicos

| Síntoma | Causa | Qué hacer |
|---|---|---|
| Panel con banner «SYNTHETIC DATA MODE» | la API no respondió (plugin no cargado o sesión caducada) | reinicia DSH; si sigue, revisa Conexión |
| «Otro panel cambió la selección antes…» | dos ventanas cambiaron de proyecto | vuelve a pulsar **Seleccionar**; la revisión ya está recargada |
| `403 scope-ambiguous` en una llamada HTTP | perfil con varios proyectos y sin selección | selecciona el proyecto desde el panel (una vez) |
| Fuentes 121 pero vacío el listado de otro proyecto | cada proyecto tiene su propio almacén | es correcto: `plugins-dhs` no tiene fuentes indexadas |
| `403 approval-required` al pedir un borrado | política del host | acepta o rechaza la tarjeta de aprobación |

## 8. Dónde mirar si algo no cuadra

- Panel → **Diagnóstico** (ámbitos y almacenes) y **Conexión** (servicio, versión, modo).
- Herramientas del agente: `lifecode_rag_list` (fuentes), `lifecode_rag_get` (detalle), `lifecode_rag_search`.
- CLI del plugin: `node bin/lifecode-rag.mjs doctor` desde `C:\xampp\htdocs\plugins-dhs\lifecode-rag`.
- Informes de este acto en `C:\xampp\htdocs\plugins-dhs\_audit\LIFECODE-RAG-1.0.0-*.md`.
