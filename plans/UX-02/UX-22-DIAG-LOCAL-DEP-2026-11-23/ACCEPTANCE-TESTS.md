# ACCEPTANCE-TESTS — pruebas de aceptación de la reparación

Cada prueba indica **qué se mide**, **cómo**, **qué evidencia se conserva** y **qué se hace si falla**.
Ninguna se ha ejecutado: son el contrato de aceptación del acto de reparación.

---

| # | Prueba | Resultado esperado | Método de verificación | Evidencia | Condición de fallo | Acción |
|---|---|---|---|---|---|---|
| **T1** | El TAR local es el autorizado | 317 530 B · SHA-256 `7bbecb09…` | `sha256sum` del artefacto **en la ruta de origen** y **en `vendor/`** después de copiar | Dos salidas de `sha256sum` (origen y destino) | Cualquier hash distinto | **Abortar**; no copiar ni editar nada |
| **T2** | LifeCode RAG se declara por `file:` | `"@designerbyron/lifecode-rag": "file:vendor/designerbyron-lifecode-rag-1.4.0.tgz"` en `dependencies`, y **ninguna** spec semver del paquete | lectura de `package.json` + `node -e` que imprime la spec; hash del fichero = `b4db531a…` (con las dos ediciones exactas) | `sha256sum package.json` + salida de la spec | Spec semver, o hash distinto con la edición aplicada | Abortar antes de ejecutar pnpm; corregir la edición |
| **T3** | El lock resuelve por tarball | `specifier` con `file:` y resolución que **apunta al tarball**; sin `integrity` de registro para `1.4.0` | `grep -A3 "lifecode-rag" pnpm-lock.yaml` y lectura del bloque `packages` | Extracto literal del lock | Entrada con `integrity` de registro o spec semver | Revertir (§4 de `BACKUP-AND-ROLLBACK.md`) |
| **T4** | `dsh-data-quality@0.3.29` instalado | `node_modules/dsh-data-quality/package.json` con versión **0.3.29** y directorio completo | `node -e require(...).version` + listado de ficheros | Versión + recuento | Otra versión (p. ej. `latest` 0.3.30) o directorio incompleto | Revertir; corregir la spec a `0.3.29` y repetir |
| **T5** | `dsh-data-quality` registrado | Presente en `dependencies`, en `bundles`, en `.modules.yaml` y en el grafo del Host | `grep` en los tres ficheros + grafo SSE (`/plugins/events`) | Salidas de grep y la entrada del grafo | Ausente en cualquiera de los cuatro | Revertir |
| **T6** | Las siete herramientas de LifeCode RAG funcionan | `ingest, search, context, get, list, forget, reindex` operativas | Con sesión: `lifecode_rag_list` y `lifecode_rag_get` sobre una fuente conocida (1.4.0 devuelve `source.relUri`). Sin sesión: suite 563/563 contra el paquete instalado + presencia en el grafo | Salidas de las llamadas (o log de la suite) | Una herramienta falla, o el valor no trae `relUri` | Revertir si es del paquete; si es de autorización, investigar antes |
| **T7** | Las actualizaciones de otros **no** buscan 1.4.0 en el registro | Un intento de re-resolución no produce `ERR_PNPM_NO_MATCHING_VERSION` para `@designerbyron/lifecode-rag` | (a) estático: spec `file:` + resolución por tarball (T2/T3). (b) dinámico: copia del perfil en temporal y `pnpm install --lockfile-only --offline`; el fallo permitido es el **preexistente** de tarballs de GitHub (`ERR_PNPM_NO_OFFLINE_TARBALL`), nunca un 404 de LifeCode RAG | Log de la corrida en la copia + el log del fallo original para comparar | Aparece `NO_MATCHING_VERSION` para LifeCode RAG | Abortar: el `file:` no se aplicó; revisar T2/T3 |
| **T8** | Lock y `.modules.yaml` sin contradicciones | Una sola entrada de LifeCode RAG (la del tarball), una de `dsh-data-quality@0.3.29`; sin duplicados ni restos semver | `grep -c` de cada patrón + comparación de claves `name@version` del lock nuevo contra el respaldo | Conteos y diff de claves | Duplicados, o queda una entrada `@1.4.0` de registro | Revertir |
| **T9** | Los demás complementos conservan sus versiones | `dsh-context 0.87.1`, `billion-context 0.1.216`, `dsh-plugins-update 0.2.5`, `@tuhengyu/dsh-full-life-memory 0.8.0`, `@local/lifecode-skill-center 1.0.1`, `@local/skill-compiler 5.0.2` | lectura de cada `package.json` y `diff` contra `plugins-instalados.txt` del respaldo | Tabla antes/después | Cualquier versión distinta | Revertir y declarar el delta |
| **T10** | Datos, roots, grants y permisos intactos | Almacén con `4b67cadc…` (registro), `4dcf31c4…` (ámbito principal), `6130ecba…` (ámbito secundario), `b15622c0…` (config); registro v2 con 3 proyectos, 3 raíces, 0 grants | `sha256sum` de contenido (sin abrir el almacén) y, si el Host arrancó, recuento lógico | Hashes y recuentos | Cualquier hash distinto sin explicación de la cadena de auditoría | **Detener**: es pérdida de datos → restaurar del respaldo |
| **T11** | El paquete instalado sigue siendo el aprobado | 75 ficheros, 75/75 idénticos al TAR | extracción del TAR en temporal + `cmp` fichero a fichero | `idénticos=75 distintos=0` | Cualquier diferencia | Revertir y reinstalar |
| **T12** | El Host carga el perfil sin errores | Arranca, compone el grafo, incluye los dos plugins, sin `crash-*.log` nuevo | arranque + `/plugins/events` + listado de logs | Grafo y fecha del último `crash-*.log` | Error de carga o plugin ausente | Revertir |

## Criterio de cierre

- T1-T5, T8-T12 en **PASS** obligatorio.
- T6 y T7: PASS con la evidencia disponible; si falta sesión, **`PASS (sin sesión)`** para el registro de las
  herramientas y **PENDIENTE** para el `relUri`, exactamente como se cerró el acto de instalación.
- Cualquier FAIL de T9 o T10 detiene el acto y activa la reversión, sin excepciones.

## Nota sobre la prueba T7 (la del mandato)

La prueba correcta **no** es «actualizar otro complemento y ver si funciona» (sería una operación destructiva sobre
el perfil). Se descompone en dos evidencias seguras:

1. **Estática:** la spec es `file:` y la resolución del lock apunta al tarball. Con eso, la re-resolución no tiene
   ninguna razón para consultar el registro por ese paquete.
2. **Dinámica en copia:** el mismo comando de resolución que falló el 12:51 (`pnpm install`, en modo `--lockfile-only`)
   ejecutado sobre una **copia temporal** del perfil con el lock reparado: debe dejar de producir
   `ERR_PNPM_NO_MATCHING_VERSION` para LifeCode RAG. El único fallo admitido es el preexistente de los tarballs de
   GitHub que no están en el store.

Y hay una tercera, la definitiva: **la primera actualización real de otro complemento** que el propietario haga
después. Ese evento queda registrado en `.plugin-manager/logs/` y se revisa en el siguiente acto.
