# LifeCode RAG

Plugin independiente de recuperación aumentada para DeepSeek Harness. Indexa conocimiento local
(proyectos, documentación, decisiones) en almacenes **propios** —uno por ámbito— y lo devuelve al modelo en
fragmentos compactos, citables y con presupuesto de tokens.

No depende de `@deepseek-ai/*`, no usa el almacén del Skill Center y no comparte rutas privadas con él.

**Paquete:** `@designerbyron/lifecode-rag` · **versión 1.5.11** · contrato público de herramientas
**v0.1.0** (congelado) · API del panel `pa/1.5.0`.

Identificadores internos que **no** cambian con el nombre del paquete: id del plugin `lifecode-rag`,
herramientas `lifecode_rag_*` y rutas `/lifecode-rag/pa/*`.

**Requisitos:** Node.js ≥ 22.5 (usa `node:sqlite`) y DeepSeek Harness ≥ 0.2.2-rc.3 y < 0.3.0.

## Modelo Project-Aware

- **Perfil** → un registro `registry.sqlite3` con proyectos, bibliotecas, raíces autorizadas, grants,
  selecciones de sesión, operaciones y auditoría encadenada.
- **Ámbito** (`prj_…` proyecto, `lib_…` biblioteca) → su propio almacén `scopes/<id>/rag.sqlite3`.
- **Sesión** → selecciona un proyecto (explícita o por directorio de trabajo). Máximo **8 ámbitos**
  (1 proyecto + 7 bibliotecas) por selección.
- **Autorización** → se comprueba antes de abrir cada almacén y se revalida en puntos de control antes de
  devolver resultados. Si se revoca un grant a mitad de una operación, la operación **falla en cerrado**
  (`grant-revoked`) y no entrega contenido del ámbito revocado.
- **Ausencia ≠ vacío** → un almacén ausente o corrupto se declara y no se crea ni se sobrescribe solo.

Rutas por perfil (`<profile_root>` = `$DSH_HOME/lifecode-rag/profiles/<profile>`):

| Ruta | Contenido |
|---|---|
| `<profile_root>/registry.sqlite3` | registro Project-Aware del perfil |
| `<profile_root>/scopes/<scope_id>/rag.sqlite3` | almacén de un proyecto o biblioteca |
| `<profile_root>/config.json` | configuración efectiva (opcional; si falta se usan los valores por defecto sin escribir) |

El almacén **heredado v0.2** (`$DSH_HOME/lifecode-rag/rag.sqlite3`, o `LIFECODE_RAG_ROOT`) sigue
funcionando para quien ya lo tenga; el panel lateral sigue sirviendo ese almacén.

## Herramientas (contrato v0.1.0)

| Herramienta | Qué hace | Aprobación |
|---|---|---|
| `lifecode_rag_ingest` | Indexa ficheros o directorios de texto | Sólo si la ruta está fuera del proyecto |
| `lifecode_rag_search` | Búsqueda híbrida (FTS + vectores) | No |
| `lifecode_rag_context` | Contexto con MMR, presupuesto y citas | No |
| `lifecode_rag_get` | Lee una fuente y sus fragmentos | No |
| `lifecode_rag_list` | Lista fuentes | No |
| `lifecode_rag_forget` | Elimina una fuente | Siempre |
| `lifecode_rag_reindex` | Reconstruye el índice | Siempre |

Ninguna herramienta acepta `project_id`, `scope_id` ni `session_id`: la selección es humana y vive en la
sesión, no en el prompt.

## Instalación

Instalación desde el registro público, en el directorio del perfil de DSH:

```sh
npm install @designerbyron/lifecode-rag@1.5.11
```

`package.json` del perfil:

```json
{
  "dependencies": { "@designerbyron/lifecode-rag": "1.5.11" },
  "dsh": { "profile": { "bundles": ["lifecode-rag"] } }
}
```

Reinicia DeepSeek Harness: el plugin carga su `cordis.patch.yml`, registra las siete herramientas y monta
el panel lateral **LifeCode RAG**.

Para desarrollo se puede enlazar un checkout en lugar de instalar:

```sh
dsh plugin --profile <perfil> add "link:C:/ruta/al/checkout" --offline
```

Tras cambiar el código del plugin, basta recargarlo con el gestor de plugins (desactivar y activar) o
reiniciar la aplicación; no hace falta reinstalar.

## Primer proyecto

El registro del perfil se inicializa con `--create` (sin ese indicador la CLI **no** inventa un perfil):

```sh
# 1. Crear el proyecto (imprime el prj_…)
node bin/lifecode-rag.mjs project create --name "Mi proyecto" --create

# 2. Autorizar la carpeta de documentos como raíz del proyecto
node bin/lifecode-rag.mjs root add --project prj_… --path "C:/ruta/a/mi/proyecto"

# 3. (Opcional) Fijar la selección de una sesión concreta; sin selección, el proyecto
#    se resuelve por el directorio de trabajo de la sesión contra las raíces autorizadas
node bin/lifecode-rag.mjs select --session <session-id> --project prj_…

# Comprobación
node bin/lifecode-rag.mjs project list
node bin/lifecode-rag.mjs root list
node bin/lifecode-rag.mjs session show --session <session-id>
```

Desde ese momento el agente usa las siete herramientas con datos reales: `ingest` sobre esa carpeta,
`search`, `context`, `get`, `list`, y `forget`/`reindex` con aprobación.

## Administración de proyectos

Desde la 1.1.0 los proyectos se administran de forma explícita: crear, renombrar, archivar, restaurar y
gestionar sus raíces. Desaparece el registro automático —resolver un directorio ya **no** crea un
proyecto—, de modo que un candidato y un proyecto registrado nunca se confunden.

```sh
node bin/lifecode-rag.mjs project create --name "Mi proyecto" --create
node bin/lifecode-rag.mjs project list
node bin/lifecode-rag.mjs root add --project prj_… --path "C:/ruta"
node bin/lifecode-rag.mjs root list
node bin/lifecode-rag.mjs discover scan --path "C:/workspace"   # sólo lee
node bin/lifecode-rag.mjs discover register --path "C:/workspace/app"
```

Cuando el agente resuelve un proyecto que no está registrado, devuelve `scope-unresolved` con
`action: register-project` y el comando exacto que hay que ejecutar. Nada se registra solo.

El panel añade dos secciones —**Proyectos** y **Candidatos**—. Cubre las mismas operaciones, más la
retirada de una raíz concreta, que hoy sólo está en el panel y en la API. El descubrimiento sólo corre
cuando se pide, y registrar es un botón que pulsa una persona. Archivar es lógico: el almacén y las
fuentes se conservan y el proyecto se puede restaurar.

Rutas de administración (`pa/1.3.0`): `POST|PATCH /pa/projects`, `POST /pa/projects/archive`,
`POST /pa/projects/restore`, `POST /pa/roots`, `POST /pa/roots/remove`, `GET /pa/candidates`,
`POST /pa/projects/register`. Todas exigen la compuerta del host: sin credencial responden `401` y sin
servicio de conexión `503`. **No existe ninguna ruta que borre proyectos, raíces, archivos o almacenes.**

La lista de workspaces del Host se lee por `GET /pa/workspaces` (`pa/1.5.0`): ruta de **sólo lectura**
que no exige proyecto activo y no escribe nada en el Host (contrato §19 de
[`docs/PA-UI-0-API-CONTRACT.md`](docs/PA-UI-0-API-CONTRACT.md)).

## Diagnóstico

```sh
node bin/lifecode-rag.mjs diagnose          # perfil, registro, almacenes, sincronización y auditoría
node bin/lifecode-rag.mjs diagnose --json   # lo mismo, para scripts
node bin/lifecode-rag.mjs doctor            # runtime, configuración y almacén heredado
node bin/lifecode-rag.mjs library status    # estado de los almacenes por ámbito
node bin/lifecode-rag.mjs sync status       # filas de sincronización por ámbito
node bin/lifecode-rag.mjs sync report       # últimas pasadas y ticks auditados
```

Todo el diagnóstico es de **sólo lectura**: no repara, no crea y no migra nada.

## Sincronización

Manual por defecto: `sync run [--scope <id>] [--dry-run] [--limit n]`. La sincronización periódica está
**desactivada** (`automation.enabled=false`) y, cuando se activa, corre con presupuesto por tick
(`tickBudgetMs`, 2 000 ms por defecto) y límite de ficheros (`maxFilesPerRun`, 25). Nunca borra fuentes:
una desaparición se marca `missing` y se revierte si el fichero vuelve con el mismo hash. Los secretos
evidentes (`.env`, claves, `.pem`, `secrets.json`…) se excluyen por nombre.

## Contexto automático

Desactivado por defecto (`autoContext.enabled=false`). Si se activa, el hook `agent/pre-step` añade un
mensaje con contexto recuperado, sólo en el primer paso de un turno con prompt humano, con presupuesto de
tiempo (2 000 ms), sin egreso de red y sin compartir estado entre sesiones.

## Modos del panel: REAL y DEMO

- **REAL** (`Modo de datos: api`) — el panel lee `/lifecode-rag/pa/*` del host. Toda cifra mostrada sale
  del almacén del perfil. Si la API no responde, el panel **no inventa**: pasa a DEMO y lo dice.
- **DEMO** (`Modo de datos: demo`) — fixtures sintéticos, marcados como tales en la cabecera; nunca
  muestra datos del proyecto real ni cifras del almacén.
- Las escrituras (ingesta, olvido, reindexación) **no** se ejecutan desde el panel: la API responde `403`
  y remite a las herramientas, que pasan por la aprobación del host.

## Interfaz · Workspace Center

El panel se organiza en cinco áreas y una sola pregunta por pantalla:

| Área | Qué responde |
|---|---|
| **Resumen** | Cuántos proyectos tienen contexto, cuántos documentos hay y qué toca hacer ahora |
| **Workspaces** | Qué espacios de trabajo conoce DeepSeek Harness, en qué estado está cada uno y con qué proyecto RAG se relacionan (sólo lectura) |
| **Proyectos y contexto** | Proyecto activo, fuentes, búsqueda, contexto y bibliotecas; administración aparte |
| **Seguimiento** | Qué autoriza el modo fácil (declarado no disponible hasta su fase) |
| **Ajustes** | Salud del servicio y herramientas técnicas: diagnóstico, conexión, historial, operaciones y candidatos |

Lo técnico no desaparece: se pliega en **Ajustes → Avanzado**. Las rutas se muestran abreviadas con
«Mostrar ruta» y «Copiar ruta». La navegación se recorre con flechas, `Home` y `End`, y cada área declara
su estado con una palabra, no sólo con un color.

## Seguridad

- La autorización no se cachea: cada apertura y cada punto de control releen el registro.
- `forget` y `reindex` exigen aprobación humana; una aprobación denegada o no disponible falla en cerrado.
- Enlaces duros, enlaces simbólicos y rutas fuera de las raíces autorizadas se rechazan al registrar y al
  ingerir.
- La ingesta es atómica por fichero: si falla la sustitución, la versión anterior queda intacta.
- Las auditorías (registro y almacén) son cadenas SHA-256 verificables; se comprueban al abrir y en el
  diagnóstico.

## Pruebas

```sh
npm test                 # node --test --test-concurrency=1
npm run test:hermetic    # la suite + huella del almacén real antes y después
npm run check            # estructura, cero dependencias, red acotada
```

Las pruebas y las herramientas de desarrollo viven en el repositorio, no en el paquete publicado
(`files` excluye `tests/` y `tools/`). La suite de la rama que produce esta 1.5.8 tiene **697 casos** y cubre
las siete herramientas, la administración por API, los workspaces del Host, el seguimiento de workspaces, la
interfaz y los 54 códigos de error con su mapa HTTP. Los comandos `npm test` y `npm run check` **sólo existen
en el repositorio**: el manifiesto empaquetado no lleva `scripts`, así que en una instalación desde el TAR se
ejecutan con `node --test` y `node tools/check.mjs` sobre la copia de origen.

## Documentación

- [`docs/PROJECT-AWARE-ARCHITECTURE.md`](docs/PROJECT-AWARE-ARCHITECTURE.md) — arquitectura y decisiones.
- [`docs/PROJECT-AWARE-DATA-CONTRACT.md`](docs/PROJECT-AWARE-DATA-CONTRACT.md) — esquema y rutas.
- [`docs/PROJECT-AWARE-SESSION-CONTRACT.md`](docs/PROJECT-AWARE-SESSION-CONTRACT.md) — sesión y selección.
- [`docs/PROJECT-AWARE-ERROR-CONTRACT.md`](docs/PROJECT-AWARE-ERROR-CONTRACT.md) — códigos y semántica.
- [`docs/CONTRATO-v0.1.md`](docs/CONTRATO-v0.1.md) — contrato público de las siete herramientas.
- [`docs/PA-UI-0-API-CONTRACT.md`](docs/PA-UI-0-API-CONTRACT.md) — contrato de la API del panel.
- [`docs/PANEL-KPIS.md`](docs/PANEL-KPIS.md) — qué mide cada KPI del panel y con qué fórmula.
- [`docs/AUTO-DISCOVERY.md`](docs/AUTO-DISCOVERY.md) — descubrimiento automático.
- [`docs/AUTOMATION-POLICIES.md`](docs/AUTOMATION-POLICIES.md) — sincronización y presupuesto.
- [`docs/EMBEDDING-PROVIDERS.md`](docs/EMBEDDING-PROVIDERS.md) — proveedores de embeddings.
- [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) — métricas y trazas.
- [`docs/PERFORMANCE-BUDGETS.md`](docs/PERFORMANCE-BUDGETS.md) — presupuestos medidos.
- [`docs/WORKSPACE-API.md`](docs/WORKSPACE-API.md) — API del espacio de trabajo.
- [`docs/ARCHITECTURE-v0.2.md`](docs/ARCHITECTURE-v0.2.md) — arquitectura del almacén heredado.
- [`docs/CONTRATO-EXTENSIONES-1.4.md`](docs/CONTRATO-EXTENSIONES-1.4.md) — extensiones aditivas y correcciones de la 1.4.

La evidencia de cada acto de ingeniería (planes K1, auditorías `eval/`, matrices de aceptación) vive en
el repositorio de desarrollo y **no** se distribuye en el paquete.

## Licencia

**MIT** — Copyright (c) 2026 Byron Vanegas.

Se concede permiso, de forma gratuita, a cualquier persona que obtenga una copia de este software y de
sus ficheros de documentación, para usarlo, copiarlo, modificarlo, fusionarlo, publicarlo, distribuirlo,
sublicenciarlo y/o vender copias, con la única condición de incluir este aviso de copyright y esta
licencia en todas las copias o partes sustanciales del software. El software se entrega «tal cual», sin
garantía de ningún tipo. Texto completo en [`LICENSE`](LICENSE).
