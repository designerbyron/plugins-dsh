# Instalación en el perfil DSH (M6) — procedimiento

**Estado:** procedimiento preparado, **no ejecutado**. El mandato de ejecución no autoriza modificar el
perfil operativo; M6 requiere autorización específica del responsable del producto.

**Qué cambia si se ejecuta:** el perfil `desktop` gana la dependencia `@local/lifecode-rag` (`link:` al
checkout) y una fila en su `cordis.patch.yml` que carga el plugin. No se toca el Skill Center, ni la
biblioteca compartida, ni el almacén de RAG existente.

## Prerrequisitos verificados en este repositorio

- `lifecode-rag/package.json` con `dsh.bundle.patch: ./cordis.patch.yml`, `engines.dsh` que incluye
  `0.2.2-rc.3`, sin dependencias.
- `lifecode-rag/cordis.patch.yml`:
  ```yaml
  - insert:
      - id: lifecode-rag
        name: '@local/lifecode-rag'
  ```
- `node --test` 66/66, `node tools/check.mjs` verde, `node tools/hermetic.mjs` verde.
- Checkout en `C:\xampp\htdocs\plugins-dhs\lifecode-rag` (el instalador guarda `link:<ruta absoluta>`).

## Procedimiento propuesto

1. **Capturar el estado del perfil** (sin modificarlo):
   ```powershell
   Copy-Item "$env:DSH_PROFILE_DIR\package.json" "$env:TEMP\package.json.before-rag"
   Copy-Item "$env:DSH_PROFILE_DIR\cordis.patch.yml" "$env:TEMP\cordis.patch.yml.before-rag"
   ```
2. **Instalar el bundle** con la herramienta del host, no editando archivos a mano:
   `plugin_manager` → `install_bundle` con `target` = `C:\xampp\htdocs\plugins-dhs\lifecode-rag`.
   El gestor ejecuta `pnpm add link:<ruta>` en el perfil, valida el bundle y activa la fila del parche.
   Si algo falla, restaura `package.json` y `pnpm-lock.yaml` por sí mismo.
3. **Verificar la activación** sin reiniciar el host si el gestor lo permite; si no, reiniciar la app.
4. **Comprobar que las herramientas existen** en una sesión nueva: deben aparecer exactamente las siete
   `lifecode_rag_*` y ninguna más.
5. **Smoke test real** con un almacén temporal, para no escribir en el almacén del usuario:
   ```powershell
   $env:LIFECODE_RAG_ROOT = Join-Path $env:TEMP 'rag-smoke'
   node bin/lifecode-rag.mjs doctor
   ```
   Después, desde una sesión del host: ingestar un fichero del proyecto, buscar, pedir contexto y
   comprobar que las citas apuntan al fichero correcto.
6. **Auditoría legible:** `node bin/lifecode-rag.mjs audit export` y `audit verify`.

## Reversión

`plugin_manager` → `remove_bundle` con el nombre del bundle (o desactivar la fila y desinstalar). El
almacén `$DSH_HOME/lifecode-rag` es del usuario y **no** se borra al desinstalar; se conserva o se elimina
con autorización expresa.

## Evidencia que debe quedar

- Salida de `install_bundle` (versión instalada, filas del parche).
- `git diff` de `package.json` y `cordis.patch.yml` del perfil (sólo las líneas esperadas).
- Listado de herramientas de una sesión nueva.
- Salida del smoke test y de `audit verify`.
- Confirmación de que el almacén real del Skill Center no cambió (huella antes/después).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El gestor instala una versión distinta a la del checkout | `link:` a la ruta absoluta; comprobar la versión en el resultado |
| El plugin rompe el arranque del perfil | El gestor restaura `package.json`/`pnpm-lock.yaml` si `pnpm add` falla; reversión con `remove_bundle` |
| Herramientas duplicadas o ausentes | `check.mjs` garantiza los 7 nombres; verificar en sesión nueva |
| Escritura accidental en el almacén real durante el smoke | `LIFECODE_RAG_ROOT` apunta a `%TEMP%` en el paso 5 |
| Datos del usuario borrados al revertir | La desinstalación no toca `$DSH_HOME/lifecode-rag`; el borrado exige autorización aparte |
