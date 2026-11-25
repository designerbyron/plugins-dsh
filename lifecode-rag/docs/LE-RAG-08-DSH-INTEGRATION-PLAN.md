# LE-RAG-08 · Plan de integración DSH (aislado)

**Estado: PROCEDIMIENTO PREPARADO, NO EJECUTADO.** No se ha instalado en el DSH habitual, no se ha
reiniciado, no se ha tocado ningún perfil real.

## Requisitos

| | |
|---|---|
| Node | `>=22.16.0 <23.0.0 || >=24.0.0` (usa `node:sqlite`) |
| DSH | `>=0.2.2-rc.3 <0.3.0` (probado contra 0.2.2-rc.5) |
| Dependencias npm | **ninguna** (`dependencies` vacío) |
| Almacén | SQLite propio; `schema_version 3`, sin migraciones pendientes |

## Contrato de carga

- `export const name = 'lifecode-rag'` · `export const inject = ['tools']`.
- Servicios opcionales vía `ctx.get`: `approval`, `workingDirectory`, `webServer`, `timer`. Sin ellos el plugin
  arranca, las lecturas funcionan y las escrituras fallan cerradas (`approval-unavailable`).
- Registro: `ctx.tools.register(definition)` para las 7 herramientas con prefijo `lifecode_rag_`.
- Paquete: `dsh.bundle.patch = ./cordis.patch.yml`; `dsh.client = { platform: 'web', immediately: true }` y
  `exports['./client']` con la API de slots vigente (lo exige el gate G3).
- API v0.2 opcional sobre `webServer` con `API_PREFIX` propio, configuración y escrituras en **su** raíz legacy.

## Configuración inicial

1. `<dataRoot>/config.json` (global, opcional): `search.strategy`, `search.limit`, `search.diversity` (`fragment`|`source`), `search.maxPerSource`, `automation.*`.
2. `<dataRoot>/profiles/<profileKey>/config.json` (perfil, opcional): mismas claves; gana sobre la global.
3. Sin ficheros: defaults de fábrica (`hybrid`, `limit 8`, `diversity fragment`).
4. Fichero inválido → `invalid-config` con la ruta; **no** hay fallback silencioso.

`<dataRoot>` = `$DSH_HOME/lifecode-rag` por defecto; se puede fijar con `LIFECODE_RAG_DATA` y el perfil con
`LIFECODE_RAG_PROFILE`.

## Directorio de datos y permisos

- Lectura: raíces de proyecto declaradas y confiadas.
- Escritura: **sólo** bajo `<dataRoot>` (registro, almacenes por proyecto, auditoría) y el índice.
- Prohibido por política: ingerir rutas dentro del propio almacén (`path-denied`).
- Herramientas destructivas (`forget`, `reindex`) exigen aprobación del host.

## Activación en un entorno aislado (procedimiento, no ejecutado)

Existe un laboratorio permanente en `<WORKSPACE>/skill-compiler-lab-2026-11-05` con `home/` y
`electron/` propios. Para LifeCode RAG:

1. Crear `<WORKSPACE>/lifecode-rag-lab/home` y `…/electron` (nuevos, vírgenes).
2. Copiar el plugin **desde el commit**, no del árbol de trabajo:
   `git archive dfe70f5 lifecode-rag | tar -x -C <lab>/plugins` (o apuntar el workspace al repo y dejar que el
   host lo cargue desde el árbol).
3. Arrancar con `DSH_HOME=<lab>/home` y `--user-data-dir=<lab>/electron`.
4. Iniciar sesión con una cuenta de prueba (paso manual del propietario; sin credenciales no hay panel).
5. Verificar: que aparecen las 7 herramientas; que `lifecode_rag_list` responde; que la configuración se lee
   de `<lab>/home/lifecode-rag`; que el almacén real **no** se abre.
6. Cerrar la instancia y comparar hashes del perfil real antes/después.

**Por qué no se ejecutó:** el arranque aislado exige una sesión interactiva que solo el propietario puede
iniciar (no hay credenciales de prueba disponibles) y abrir una segunda instancia gráfica del host sin su
intervención queda fuera de esta misión. No se simula una instalación correcta.

## Verificación tras activar

```
node bin/lifecode-rag.mjs doctor         # requisitos y rutas
node bin/lifecode-rag.mjs diagnose       # configuración efectiva del perfil
node tools/check.mjs                     # gate del paquete
node tools/hermetic.mjs                  # la suite no toca el almacén real
```

Y, desde el host: `lifecode_rag_list` (lectura), `lifecode_rag_search` (recuperación), `lifecode_rag_get`
(documento). Las escrituras deben pedir aprobación.

## Rollback

1. Detener el host.
2. Retirar el plugin del workspace/perfil de prueba (el árbol del repo no se toca).
3. Conservar `<dataRoot>` (los datos no se destruyen).
4. Reabrir y comprobar que las 7 herramientas ya no aparecen.

## Actualización

Sustituir el directorio del plugin por la nueva versión y mantener `<dataRoot>`. El esquema no requiere
migración entre 1.0.0 y esta evolución (misma `schema_version`). Si se cambia de modelo de embeddings, el
índice debe reconstruirse (`reindex`), operación con aprobación.

## Desinstalación

Quitar el plugin; los datos quedan en `<dataRoot>`. Borrarlos es una operación destructiva: exige copia de
seguridad y autorización explícita del propietario.

## Riesgos pendientes

1. **Sin activación real verificada**: el registro de las 7 herramientas en el host está probado sólo por
   contrato y por pruebas sintéticas.
2. **Versión del host**: el rango declarado es `>=0.2.2-rc.3 <0.3.0`; un salto de minor puede cambiar la API
   de slots o de herramientas.
3. **`immediately: true`** en el cliente: el panel se carga con el host; un error del cliente se vería en la
   consola del host (no verificada).
4. **Sin prueba con modelo real**: la invocación por el modelo sigue siendo criterio posterior.
5. **Herramientas globales**: las 7 se registran en un namespace común; dos instalaciones simultáneas
   colisionarían.
