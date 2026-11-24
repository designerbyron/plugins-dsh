# POST-INSTALL-VALIDATION — LifeCode RAG 1.4.0

Matriz de aceptación para el acto de instalación. **Ninguna casilla está ejecutada**: este documento sólo define
prueba, esperado, método, evidencia, fallo y reversión.

Convención: `PASS` exige medida con el Host vivo y evidencia conservada en el expediente del acto. Un `401` **no** es
prueba de que una ruta exista (la compuerta de autenticación responde antes de mirar la ruta).

| # | Prueba | Resultado esperado | Método de verificación | Evidencia a conservar | Condición de fallo | Acción de reversión |
|---|---|---|---|---|---|---|
| **M1** | Carga del plugin | El Host compone el bundle `@designerbyron/lifecode-rag` y sirve su `client.js`; sin error de carga en el arranque | Grafo de plugins del Host (SSE `/plugins/events`) con la revisión del momento + `GET` del bundle `client.js` | Grafo (JSON), `rev` del bundle, tamaño y sha256 del `client.js` servido | El plugin no aparece en el grafo, o el arranque registra error del plugin | Restaurar paquete 1.3.0 + los 3 ficheros de perfil (`BACKUP-AND-ROLLBACK.md` §5) |
| **M2** | Registro de las siete herramientas | `ingest, search, context, get, list, forget, reindex` registradas, mismo esquema que 1.3.0 | Listado de herramientas del Host (o `GET` de la API del panel que las enumera) y comparación de nombres/orden | Listado completo (7) + diff contra la captura previa | Falta alguna, sobra alguna o cambia el orden | Reversión completa |
| **M3** | API PA | `PA_VERSION = 'pa/1.4.0'`; `/pa/config`, `/pa/snapshot`, `/pa/history`, `/pa/workspaces`, `/pa/selection` responden `200` con sesión | `curl` con credencial del propietario (nunca impresa) o desde el panel | Códigos + cuerpos resumidos (sin secretos) | `404` con sesión válida, o versión distinta de `pa/1.4.0` | Reversión completa |
| **M4** | Autorización y aislamiento | Las 7 herramientas resuelven sólo el proyecto autorizado; una ruta no autorizada (p. ej. `…\plugins-dhs-release\lifecode-rag`) devuelve `scope-unresolved`/`project-not-authorized`; **no** se amplía el ámbito | `list`/`search` con `cwd` autorizado y con `cwd` no autorizado, comparando resultado | Salidas de ambas llamadas + proyecto resuelto (`projectId`) | Se resuelve un proyecto sin raíz autorizada, o se mezclan dos proyectos | Reversión + incidencia |
| **M5** | Compatibilidad del almacén v3 | `schema_version = 3` en ambos ámbitos; `PRAGMA quick_check = ok`; sin migración ni tabla nueva | Lectura **en copia** del almacén (nunca abrir el real: crearía `-shm`) | Salida de `meta` y `quick_check` de las copias | Cambia `schema_version`, aparece tabla nueva o `quick_check` falla | Reversión + restaurar almacén del respaldo (sólo si hubo escritura) |
| **M6** | Compatibilidad del registro v2 | `registry_version = 2`; la auditoría **continúa** desde `seq 88` (no se reinicia, no se pierde) | Lectura en copia de `meta` y `audit_registry` (últimos `seq`/`actor`/`action`) | Tabla de los últimos 5 registros + hash de encadenamiento | `registry_version ≠ 2`, o la auditoría se reinicia | Reversión + restaurar registro del respaldo |
| **M7** | Persistencia de datos existentes | 3 proyectos, 3 raíces, 0 grants, 0 bibliotecas; ámbito principal 121 fuentes / 964 chunks / 964 vectores; ámbito secundario 0/0/0; `config.json` con `embedding.provider = local-hash-v1` | Recuentos por SQL en copia + comparación con el baseline del expediente | Tabla de recuentos antes/después con hashes de fichero | Cambia cualquier recuento sin explicación de la cadena de auditoría | Detener: es pérdida de datos → restaurar del respaldo |
| **M8** | Ausencia de dependencias obligatorias del Harness | Ningún import de `@deepseek-ai/*`; `index.js` y `lib/**` cargan sin el Host | `import('file:///…/index.js')` sobre el paquete instalado + `grep` de imports | Salida del import y del grep | Falla el import o aparece una dependencia del harness en el núcleo | Reversión completa |
| **M9** | Logs de errores y advertencias | Sin errores del plugin en el arranque ni en las llamadas de M2-M4; advertencias nuevas sólo las declaradas (p. ej. la métrica `query.fallback` si se fuerza una degradación) | Log del Host del acto (ventana de tiempo acotada) + `/pa/history` | Extracto del log filtrado por `lifecode` y el `head` de auditoría | Excepción no capturada, `internal`, o error repetido | Reversión + incidencia |
| **M10** | Coherencia de metadatos | `package.json` del paquete = `1.4.0`; spec del perfil = `1.4.0`; lock con `integrity` `sha512-mojAqRJhh6…`; `.modules.yaml` menciona `1.4.0` (o el Host lo reescribe y se anota) | Lectura de los 4 ficheros + `grep` de la versión | Huellas de los 4 ficheros | Cualquier versión residual `1.3.0` en spec o lock | Reversión completa |
| **M11** | Panel real | La pestaña del plugin abre sin excepciones en consola; biblioteca, proyectos y workspaces se pintan con datos reales | Captura del panel + consola del renderer (sin errores) | Captura PNG + extracto de consola | Pantalla en blanco, excepción en consola o datos cruzados entre proyectos | Reversión completa |
| **M12** | Humo funcional (laboratorio, no perfil) | Las 7 herramientas responden sobre un fixture: ingesta, búsqueda híbrida, contexto con presupuesto, `get`, `list`, `forget`, `reindex`; degradación léxica declarada si se fuerza un fallo de embedding recuperable | Ejecución en el laboratorio aislado con `DSH_HOME` propio | Log del humo + recuentos del almacén de laboratorio | Cualquier herramienta falla o devuelve forma distinta del contrato v0.1 | No afecta al perfil; se corrige y se repite |

## Criterio de cierre del acto de instalación

- Las 12 casillas en `PASS`, o `BLOCKED` justificado en las que dependan del propietario (M3/M11 requieren su sesión).
- Ninguna casilla en `FAIL`: si hay un `FAIL`, **se revierte** y se cierra el acto con la causa.
- Evidencia archivada en `plans/UX-02/UX-22-DELIVERY-1.4.0-2026-11-23/evidence/` del acto de ejecución.
- El almacén real **no** se abre en ningún momento por el auditor: todas las lecturas se hacen sobre copias, y el
  delta de los hashes del almacén se explica por la operación (lecturas no escriben; si algo escribe, se atribuye por
  la cadena de auditoría antes de firmar).

## Nota sobre las pruebas nuevas de 1.4.0

Las capacidades nuevas (fallback léxico declarado, `warnings` de secretos, `relUri`, `forget` con `chunks`, etapas de
ingesta en métricas) **no cambian la forma del valor de las herramientas** salvo campos aditivos. Su verificación
funcional pertenece a M12 (laboratorio); en el perfil sólo se comprueba que **nada de lo existente se rompe** (M2-M7).
