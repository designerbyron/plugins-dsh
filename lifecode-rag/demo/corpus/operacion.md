# Operación e instalación

## Requisitos

- DeepSeek Harness Desktop 0.2.2-rc.3 o compatible.
- Node 22.16 o superior (22.16–22.x o ≥24; el host incluye Node 24).
- Windows, macOS o Linux. El producto se probó en Windows 11.

## Instalación (M6, requiere autorización)

La instalación es una decisión humana y no forma parte de esta entrega. El procedimiento preparado
es:

1. Revisar el manifiesto y el parche: `dsh.bundle.patch` apunta a `./cordis.patch.yml`, que inserta
   una fila `lifecode-rag` con el paquete `@local/lifecode-rag`.
2. Ejecutar el gestor de plugins del host con la ruta absoluta del directorio, nunca a mano sobre
   el perfil.
3. Verificar que la pestaña aparece en la barra lateral y que `/lifecode-rag/api/health` responde.
4. Comprobar el almacén: `node bin/lifecode-rag.mjs doctor`.

## Desinstalación

Desinstalar el bundle y, si se desea borrar el conocimiento, eliminar `$DSH_HOME/lifecode-rag`
después de una copia. La base contiene el índice y la auditoría; no contiene credenciales.

## Diagnóstico

`doctor` revisa runtime, raíz, configuración, determinismo del embedder y estado del almacén
(integridad FTS, cadena de auditoría y exportación JSONL). `audit verify` compara la base con el
fichero y explica la causa de una discrepancia.

## Variables

- `LIFECODE_RAG_ROOT`: raíz del almacén. Si está definida y vacía, el plugin falla; no cae
  silenciosamente a otra ruta.
- `DSH_HOME`: base del perfil; el valor por defecto es `~/.dsh`.
