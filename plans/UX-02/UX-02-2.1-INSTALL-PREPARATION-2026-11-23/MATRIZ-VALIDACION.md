# Matriz de validación posterior a la instalación

Cada fila define **qué se mide, con qué, y qué convierte el resultado en PASS o FAIL**. Donde el control
exige la sesión del navegador (compuerta PA01), se dice: el agente no la tiene ni la maneja, así que el
control queda **BLOCKED por credencial** salvo que lo ejecute el propietario o se valide en instancia aislada.

Leyenda de estado esperado en la fase de ejecución: `PASS` / `FAIL` / `BLOCKED` / `NOT RUN`.

---

## 1. Versión

| Control | Cómo se mide | PASS | FAIL |
|---|---|---|---|
| V-1.1 Paquete instalado | `node -e` del `package.json` de `node_modules/@designerbyron/lifecode-rag` | `1.3.0` | cualquier otra |
| V-1.2 Contenido instalado | recuento de ficheros + sha256 por fichero contra el tarball verificado | **74/74 idénticos** | un fichero distinto o de menos |
| V-1.3 Manifiestos | `package.json` del perfil y `pnpm-lock.yaml` | `specifier`/`version` = `1.3.0` en las tres entradas | cualquier `1.2.0` restante |
| V-1.4 Carga efectiva del host | log del host sin error de carga + `/lifecode-rag/pa/config` sin credencial | `401` y sin errores | `404` (plugin no montado) o error en log |
| V-1.5 Versión que reporta la API | `GET /pa/config` autenticado → `version` | `pa/1.4.0` | `pa/1.3.0` u otra · **BLOCKED** si no hay sesión |

## 2. API `pa/1.4.0`

| Control | Cómo se mide | PASS | FAIL |
|---|---|---|---|
| A-2.1 Ruta nueva presente | `GET /pa/workspaces` autenticado | 200 con `{ok:true,data}` | 404/405 · **BLOCKED** sin sesión |
| A-2.2 Forma del contrato | claves de primer nivel y del item (las de la §19 del contrato) | exactamente `asOf,counts,items,mode,reason,service,source,truncated,version` | falta o sobra una clave |
| A-2.3 Errores coherentes | `POST /pa/workspaces`, `?path=`, `?limit=201` | 405, 400 `unknown-parameter`, 400 `limit-too-large` | otra cosa |
| A-2.4 Compuerta intacta | sin credencial | `401` | `200` (sería un fallo de seguridad) |

## 3. Workspace Discovery desde el Host real

| Control | Cómo se mide | PASS | FAIL |
|---|---|---|---|
| W-3.1 `source` | `GET /pa/workspaces` (sesión del propietario) | `"host"` | `"none"` con motivo (`no-registry`) |
| W-3.2 Conteo | `counts.total` frente al registro real del host (`~/.dsh/storages/workspace.json`, lectura) | igual número de workspaces | distinto |
| W-3.3 Estados | `items[].state` | sólo `ok`/`missing`/`unknown`; `unknown` con `stateReason` | valores fuera del contrato |
| W-3.4 Relación y normalización | `items[].path`/`pathKey`/`relation`/`project` | ruta idéntica a la del host, `pathKey` normalizado, `exact`/`inside`/`none` | ruta reescrita o proyecto asignado por prefijo suelto |
| W-3.5 Anidados y duplicados | workspaces padre/hijo y títulos repetidos en el registro real | filas independientes, sin fusión | filas fusionadas o proyecto cruzado |

**Alternativa sin credenciales (equivalente en motor, no en integración):** ejecutar `projectWorkspaces` sobre
una **copia** del registro real de workspaces y del `registry.sqlite3` (sólo lectura). Prueba la proyección
sobre datos reales, pero **no** la integración con el host. Se declarará como tal.

## 4. Datos

| Control | Cómo se mide | PASS | FAIL |
|---|---|---|---|
| D-4.1 Huella de datos | sha256 de los 3 `.sqlite3` antes/después | idénticos (`4b67cadc…`, `4dcf31c4…`, `6130ecba…`) | cualquiera distinto |
| D-4.2 Configuración del plugin | sha256 de `config.json` | `b15622c0…` | distinto |
| D-4.3 Estado lógico | lectura en sólo lectura | 3 proyectos, 3 raíces, selección rev. 5, auditoría 88/88, **121 fuentes · 964 chunks · 964 vectores**, 141 de ámbito | cualquier recuento distinto |
| D-4.4 Sin migración ni reindexación | `audit_registry` y `audit` del ámbito: acciones nuevas | **ninguna** acción nueva | `schema.migrate`, `ingest`, `reindex`, `sync.run`… |
| D-4.5 Sidecars | listado con tamaños | presentes y sin manipular; `-wal` a 0 B | sidecar borrado o «reconstruido» |

## 5. Herramientas (siete)

| Control | Cómo se mide | PASS | FAIL |
|---|---|---|---|
| T-5.1 Registro | catálogo del host o `createToolDefinitions` del paquete instalado | exactamente 7, nombres congelados | falta o sobra alguna |
| T-5.2 Invocación segura | `lifecode_rag_list` / `lifecode_rag_get` sobre un **perfil temporal**, nunca el real | responden con datos del perfil temporal | tocan el real o fallan |
| T-5.3 Tools de escritura | `ingest`/`forget`/`reindex` | **NOT RUN deliberado**: exigen datos reales o aprobación; se prueban con fixtures | invocarlas contra el almacén real |

## 6. Headless

| Control | Cómo se mide | PASS | FAIL |
|---|---|---|---|
| H-6.1 CLI sin host | `LIFECODE_RAG_ROOT=<tmp> node …/bin/lifecode-rag.mjs diagnose --json` | exit 0, JSON completo, 0 residuos | error o escribe fuera del temporal |
| H-6.2 Núcleo sin harness | `import(lib/tools.mjs)` con `services:{}` | 7 herramientas, sin tocar `ctx` | necesita DSH |
| H-6.3 Independencia | `tools/check.mjs` | sin dependencias `@deepseek-ai/*` | cualquier import del harness en `lib/` |

## 7. Compatibilidad `pa/1.3.0`

| Control | Cómo se mide | PASS | FAIL |
|---|---|---|---|
| C-7.1 Snapshot | `GET /snapshot` autenticado | conserva sus 16 claves | falta una · **BLOCKED** sin sesión |
| C-7.2 Rutas antiguas | `/config`, `/history`, `/search`, `/context`, `/selection`, `/actions` | mismo comportamiento; sólo cambia el valor `version` | cualquier cambio de forma |
| C-7.3 Suite | `npm test` en el worktree de release | 541/541 | cualquier fallo |

## 8. Persistencia

Cubierta por §4 (D-4.1 … D-4.5). Añadido: comprobar que **no** se ha creado ningún `rag.sqlite3` nuevo ni
un `scopes/<id>` nuevo tras cargar el plugin.

## 9. Regresión

| Control | Cómo se mide | PASS |
|---|---|---|
| R-9.1 Suite completa | `npm test` (raíces `mkdtemp`) | 541/541 |
| R-9.2 Puerta hermética | `npm run test:hermetic` | suite verde y almacén real sin cambios **durante la corrida** |
| R-9.3 Estructura | `npm run check` | verde (7 herramientas, sin dependencias del harness) |
| R-9.4 Otros plugins | inventario `node_modules` antes/después | mismas versiones de todos los demás |

## 10. Rollback

| Control | Cómo se mide | PASS |
|---|---|---|
| B-10.1 Procedimiento definido | `PLAN-ROLLBACK.md` con tres niveles y criterios | existe y es ejecutable sin red |
| B-10.2 Reversible sin reconstruir | el 1.2.0 aparcado y el respaldo coinciden con el publicado | 73/73 hashes |
| B-10.3 Ensayo | en directorio temporal, instalar y deshacer | vuelve a 1.2.0 con los mismos hashes y el lock aceptado |

---

## Condiciones de bloqueo de la matriz

- Un `401` en `/pa/config` **no** es PASS de versión: es PASS de compuerta. La versión se mide en el
  `package.json` instalado y, si hay sesión, en el cuerpo de `/pa/config`.
- Un `200` sin comprobar el cuerpo **no** es PASS de contrato.
- Un control que exige sesión y no la tiene se cierra como **BLOCKED**, no como PASS ni como FAIL.
- Si D-4.1 falla, **no** se sigue: se pasa al Nivel 3 del rollback y se investiga antes de tocar nada.
