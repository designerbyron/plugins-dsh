# LifeCode RAG

Plugin independiente de recuperación aumentada para DeepSeek Harness. Indexa conocimiento local
(proyectos, documentación, decisiones) en almacenes **propios** —uno por ámbito— y lo devuelve al modelo en
fragmentos compactos, citables y con presupuesto de tokens.

No depende de `@deepseek-ai/*`, no usa el almacén del Skill Center y no comparte rutas privadas con él.

**Versión 1.0.0** · contrato público de herramientas **v0.1.0** (congelado).

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

Perfil gestionado por la aplicación (`desktop`): con la herramienta de plugins del host, instalando el
bundle local como enlace.

```
plugin_manager  install_bundle  target=link:C:/xampp/htdocs/plugins-dhs/lifecode-rag
```

Perfiles gestionados por CLI: `dsh plugin --profile <perfil> add "link:<ruta>" --offline`. El lanzador
invoca `pnpm` desde `PATH`; si no está, exporta antes el shim oficial del runtime.

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
node --test                  # suite completa, sin tocar el almacén real
npm run test:hermetic        # la suite + huella del almacén real antes/después
npm run check                # estructura, cero dependencias, red acotada
node ../eval/pa0/sql-check.mjs   # esquema SQL en memoria
```

## Documentación

- [`docs/PROJECT-AWARE-ARCHITECTURE.md`](docs/PROJECT-AWARE-ARCHITECTURE.md) — arquitectura y decisiones.
- [`docs/PROJECT-AWARE-DATA-CONTRACT.md`](docs/PROJECT-AWARE-DATA-CONTRACT.md) — esquema y rutas.
- [`docs/PROJECT-AWARE-SESSION-CONTRACT.md`](docs/PROJECT-AWARE-SESSION-CONTRACT.md) — sesión y selección.
- [`docs/PROJECT-AWARE-ERROR-CONTRACT.md`](docs/PROJECT-AWARE-ERROR-CONTRACT.md) — códigos y semántica.
- [`docs/CONTRATO-v0.1.md`](docs/CONTRATO-v0.1.md) — contrato público de las siete herramientas.
- [`docs/AUTOMATION-POLICIES.md`](docs/AUTOMATION-POLICIES.md) — sincronización y presupuesto.
- [`docs/ACEPTACION-project-aware-propuesta.md`](docs/ACEPTACION-project-aware-propuesta.md) — matriz de aceptación.
- [`docs/PA-UI-0-API-CONTRACT.md`](docs/PA-UI-0-API-CONTRACT.md) — contrato `pa-ui/0.1.0-draft` del panel.
- [`docs/PA-UI-0-ACCEPTANCE.md`](docs/PA-UI-0-ACCEPTANCE.md) — criterios G1…G8 del panel y su estado.
- [`docs/PA-UI-0-GAPS.md`](docs/PA-UI-0-GAPS.md) — GAP-01…GAP-20, incluidos los límites del anfitrión.
- [`docs/PA-UI-0.4-ROUTE-B-EVALUATION.md`](docs/PA-UI-0.4-ROUTE-B-EVALUATION.md) — evaluación de la Ruta B (aislamiento).
- [`docs/WORKSPACE-UX.md`](docs/WORKSPACE-UX.md) — reglas de interfaz del workspace.

Evidencia por acto (no es documentación de uso):

- `docs/K1-IMPLEMENTATION-PLAN/` — plan K1 (sellado con manifiesto propio).
- `docs/K1-DECISIONS-RESOLUTION/` — resoluciones del propietario y enmienda de G3.
- `eval/pa-ui-1/evidence/` — implementación del panel Project-Aware.
- `eval/functional-audit-01/` — auditoría funcional y registro de defectos.
- `eval/remediation-redesign-01/` — remediación y rediseño con capturas.
- `eval/host-subagent-audit-01/` — aceptación en host y auditoría de subagentes.
- `eval/product-readiness-01/` — matriz de promesas y aceptación de las siete herramientas.
