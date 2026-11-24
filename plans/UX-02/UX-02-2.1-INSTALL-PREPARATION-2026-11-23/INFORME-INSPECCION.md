# Instalación de LifeCode RAG 1.3.0 en DSH real — Informe de inspección

**Acto:** preparación (sin ejecución). **Fecha:** 2026-11-23T03:44–03:47Z.
**Nada se ha instalado, enlazado, reiniciado ni escrito.** Todo lo de este informe es lectura.

Leyenda: **Observado** (visto en el entorno con comando y salida) · **Inferido** (conclusión apoyada en
lo observado, no medida directamente) · **Pendiente** (no se pudo medir o exige la fase de ejecución).

---

## 1. Perfil DSH activo y ubicación de su configuración

| Dato | Valor | Estado |
|---|---|---|
| Home del harness | `C:\Users\BYRON\.dsh` | Observado |
| Perfiles | `desktop/`, `headless/`, `web/` (+ `node_modules/` compartido del home) | Observado |
| Perfil que usa la app abierta | `desktop` — `--user-data-dir="C:\Users\BYRON\AppData\Roaming\@deepseek-ai/dsh-desktop"` en el renderer (pid 24224) | Observado |
| Configuración del perfil | `~/.dsh/profiles/desktop/`: `package.json`, `cordis.yml` (lista vacía: el árbol se compone por parches), `cordis.patch.yml` (89 líneas), `pnpm-workspace.yaml`, `pnpm-lock.yaml` (v9.0), `node_modules/` | Observado |
| Capa del home | `~/.dsh/cordis.patch.yml` (5 105 B) aplica a **todos** los perfiles | Observado — **no se ha leído su contenido**; contiene un Bearer de Lunascape MCP en claro según nota de operación previa |

## 2. Versión instalada y origen efectivo de la dependencia

| Dato | Valor | Estado |
|---|---|---|
| Dependencia declarada | `"@designerbyron/lifecode-rag": "1.2.0"` (exacta, sin rango) | Observado |
| Instalado en `node_modules` | **1.2.0**, en un **directorio real** (no enlace simbólico) | Observado |
| Ficheros del paquete instalado | **73** | Observado |
| Contrato de la API instalado | `PA_VERSION = 'pa/1.3.0'` | Observado |
| ¿Es el 1.2.0 publicado? | Descargado el tarball 1.2.0 del registro (`sha512-E+81ki…`, 73 ficheros) y comparado **fichero a fichero**: **73/73 con el mismo sha256**, 0 distintos, 0 sobrantes | Observado |
| Habilitación en el host | `dsh.profile.bundles` incluye `@designerbyron/lifecode-rag`; el paquete trae `cordis.patch.yml` con `- insert: [{id: lifecode-rag, name: '@designerbyron/lifecode-rag'}]` | Observado |

**Inferido:** el origen efectivo del 1.2.0 es el **registro npm**, no un `link:` ni un checkout local. Se
confirma por contenido, no por la cadena del manifiesto.

## 3. `link:` frente a instalación desde npm

| Dependencia | Tipo | Efecto |
|---|---|---|
| `@designerbyron/lifecode-rag@1.2.0` | **registro npm** (exacta) | es la que se va a sustituir por 1.3.0 |
| `@local/skill-compiler` | **`link:C:/xampp/htdocs/plugins-dhs/skill-compiler`** | apunta a un árbol de trabajo local: no se toca |
| `@local/lifecode-skill-center` | `github:designerbyron/plugins-dsh#827b84e…&path:/lifecode-skill-center` | fijada por commit y ruta |
| `@tuhengyu/dsh-full-life-memory`, `dsh-plugins-update` | `github:…` | fijadas por repositorio |
| `billion-context`, `dsh-context`, `dsh-data-quality` | versiones exactas del registro | — |

**Riesgo medido en la configuración:** `nodeLinker: hoisted` y **no existe `node_modules/.pnpm`** → el perfil
no usa store virtual. Un `pnpm install`/`pnpm add` rehace la resolución completa del árbol y puede mover
paquetes ajenos, incluidos los `link:` y los `github:`. Esto condiciona la estrategia (§4 del plan).

## 4. `minimumReleaseAge` y su efecto sobre 1.3.0

| Dato | Valor | Estado |
|---|---|---|
| `pnpm config get minimumReleaseAge` | **`undefined`** | Observado |
| `minimumReleaseAge` en `pnpm-workspace.yaml` | **no está** (sólo `minimumReleaseAgeExclude`) | Observado |
| Exclusión existente | `'@designerbyron/lifecode-rag@1.1.0'` (y `dsh-context`, `billion-context`, `dsh-data-quality`) | Observado |
| Mención en el host | El esquema del gestor de plugins describe: «pnpm's `minimumReleaseAge` can make it older than the newest release» | Observado (texto del paquete `dsh-plugin-manager`) |
| ¿Bandera/var del host? | **No aparece** ninguna variante `minimumReleaseAge=`, `minimum-release-age`, `releaseAge` ni `minimum_release_age` en `app.asar` | Observado |
| pnpm / node / npm | `pnpm 12.15.0` · `node v24.21.0` · `npm 11.19.0` | Observado |

**Efecto hoy sobre 1.3.0:** **ninguno**. Sin `minimumReleaseAge` configurado, pnpm instala una versión
publicada hace minutos. **Pero** la nota de operación del proyecto registra que el gate llegó a estar activo
(24 h) y que instalando a mano **no se añade la excepción**, con el fallo apareciendo semanas después al
actualizar **otro** plugin. Por eso el plan trata el gate como **condición a re-medir en la ejecución**, y la
excepción se añade —si hace falta— **por versión exacta y sólo en este perfil**.

**Inferido:** las entradas `minimumReleaseAgeExclude` las escribió el gestor del host en instalaciones
anteriores; la lista es inerte mientras `minimumReleaseAge` siga sin definir.

## 5. Estado del host y cierre limpio

| Dato | Valor | Estado |
|---|---|---|
| Procesos `DeepSeek Harness.exe` | **5** (pids 11816 main, 24120 gpu, 1424 network, 24224 renderer, 10308 utility con `--expose-internals`) | Observado |
| Padre del main | pid 7560 | Observado |
| Puerto de escucha del host | **`127.0.0.1:57200`** (pid 10308) | Observado |
| Marcador de cierre a segundo plano | `AppData\Roaming\@deepseek-ai\dsh-desktop\background-close-confirmed` **presente** | Observado |
| API PA montada | `GET /lifecode-rag/pa/config` → **401**; `GET /lifecode-rag/pa/workspaces` → **401**; `/nada` → **404** | Observado |

**Lectura correcta del 401:** demuestra que el prefijo está montado y que la compuerta del host (PA01)
responde. **No** distingue una ruta existente de una inventada: el host rechaza antes de mirar la ruta. Por
tanto `401` en `/workspaces` **no** prueba que la 1.2.0 (sin esa ruta) la tenga.

**Cierre limpio:** el procedimiento conocido y probado en este proyecto (ventana → señal ordenada → forzado
sólo si los WAL están a 0 B → verificación de 0 procesos, puerto libre y hashes iguales) está en el
`PLAN-INSTALACION.md` §2. **No se ha ejecutado**: parar el host está prohibido en esta fase.

## 6. Almacenes: ubicación y estado

| Fichero | Bytes | sha256 (12) |
|---|---|---|
| `~/.dsh/lifecode-rag/profiles/desktop/registry.sqlite3` | 241 664 | `4b67cadc9afe` |
| `…/scopes/prj_01M7RBSRD33M26HGBEFW51WPP6/rag.sqlite3` | 3 862 528 | `4dcf31c4cb70` |
| `…/scopes/prj_01M7TRDQYRAPJR03QTM3PP6PX2/rag.sqlite3` | 126 976 | `6130ecbae17b` |
| `…/profiles/desktop/config.json` | 998 | `b15622c0ab9f` |
| `…/prj_01M7TRD…/rag.sqlite3-shm` | 32 768 | (sidecar, **no se toca**) |
| `…/prj_01M7TRD…/rag.sqlite3-wal` | **0** | (sidecar, **no se toca**) |

Estado lógico (leído en otro acto con `readOnly: true`, sigue vigente): 3 proyectos, 3 raíces, selección
rev. 5, `audit_registry` 88/88, **121 fuentes · 964 chunks · 964 vectores**, auditoría del ámbito 141,
`integrity_check: ok` en las tres bases.

**Observado y relevante:** los sidecars **se mueven** entre bases según qué conexión las abrió (hoy están en
`prj_01M7TRD…`; hace unas horas, en `prj_01M7RBS…`), siempre con `-wal` a 0 B. Por eso la huella de datos se
calcula **sobre los `.sqlite3`**, y los sidecars se **copian tal cual**, nunca se borran.

## 7. Carga, registro y exposición de las siete tools

| Pieza | Cómo está | Estado |
|---|---|---|
| Entrada al plugin | `index.js` → `apply(ctx)`; `export const inject = ['tools', 'webServer', 'connection']` | Observado |
| Herramientas | `createToolDefinitions({config, root, services})` → `ctx.tools.register(definition)` para cada una | Observado |
| Recuento sin host | 7 herramientas desde el **paquete publicado 1.3.0** extraído: `lifecode_rag_context, forget, get, ingest, list, reindex, search` | Observado |
| API del panel | `createPaHandler({profileRoot, profileKey, env, authorize, services})`; `webServer.register({kind:'prefix', path: PA_PREFIX})` | Observado |
| Compuerta | `hostGate` con `ctx.connection.requestRejection` + `admit`; sin `connection`, **niega** | Observado |
| Bundle | `cordis.patch.yml` del paquete: `insert: [{id: lifecode-rag, name: '@designerbyron/lifecode-rag'}]` | Observado |

## 8. Ejecución headless, sin DSH ni otros plugins

| Prueba | Comando | Resultado | Estado |
|---|---|---|---|
| CLI con raíz temporal **sin** registro | `LIFECODE_RAG_ROOT=<tmp> DSH_PROFILE=prueba node …/bin/lifecode-rag.mjs diagnose --json` | **exit 1**, `ok:false`, `problems: ["el perfil no tiene registro Project-Aware (todavía no hay proyecto registrado)"]`, **0 residuos** | Observado |
| CLI con raíz temporal **con** registro (creado en el temporal) | ídem | **exit 0**, `ok:true`, `problems: []` | Observado |
| Núcleo puro sin host | `import(file:///…/lib/tools.mjs)` → `createToolDefinitions({config, root, services:{}})` | **7 herramientas**; `PA_VERSION = pa/1.4.0`; `inject = ['tools','webServer','connection']` | Observado |
| Dependencias del núcleo | `tools/check.mjs` del repo: «sin dependencias de @deepseek-ai/*» | verde (acto anterior) | Observado |

> **Corrección de una medición propia.** En la primera pasada anoté «exit 0» para el caso A: el `exit=$?`
> leía el estado de un `| head`, no el de `node`. Re-medido sin tubería: **exit 1**, que es lo correcto
> (hay un problema declarado: no hay registro). El núcleo funciona igual; lo que estaba mal era mi lectura
> del código de salida. Los dos casos quedan así: sin registro, `diagnose` **avisa y sale con 1**; con
> registro, **sale con 0**.

**Inferido:** el núcleo no necesita DSH; el adaptador (`index.js`) es lo único que toca `ctx`, y sin
`webServer`/`connection` el plugin sigue sirviendo por CLI y por librería.

## 9. Lo que queda pendiente de medir (y por qué)

| Pendiente | Por qué no se midió | Cómo se cerrará |
|---|---|---|
| Versión que **carga** el host tras instalar | exige reiniciar el host (prohibido aquí) | fase de ejecución: `package.json` instalado + log del host + panel |
| `GET /pa/workspaces` **autenticado** sobre el registro real | la compuerta del host no se puede superar sin la sesión del navegador (PA01), y el agente no las maneja | lo abre el propietario, o se valida en una instancia aislada con su login |
| Contenido de `~/.dsh/cordis.patch.yml` | contiene un token en claro; no se imprime | se comprueba **por hash** y por `grep -c` de la línea, sin volcarla |
| Gate de edad mínima **en el momento** de instalar | la configuración puede cambiar | G4 del plan: re-medir `pnpm config get minimumReleaseAge` justo antes |
