# Verificación de integridad

## Método

El almacén real **no se abrió**. Antes de cualquier consulta se copiaron sus ficheros:

```
cp -p  ~/.dsh/lifecode-rag/profiles/desktop/registry.sqlite3                    → snapshot/
cp -rp …/scopes/prj_01M7RBSRD33M26HGBEFW51WPP6                                 → snapshot/scopes/
```

Todas las lecturas se hicieron contra la copia (`readOnly: true`). Así el almacén real no puede cambiar ni por
el fichero `-shm` de WAL, que es lo que se toca al abrir una base en modo WAL aunque sólo se lea.

## Huellas

| Fichero | Tamaño | Antes = Después |
|---|---|---|
| `config.json` | 998 B | sí |
| `registry.sqlite3` | 212 992 B | sí |
| `scopes/prj_…/rag.sqlite3` | 3 862 528 B | sí |
| `scopes/prj_…/rag.sqlite3-shm` | 32 768 B | sí |
| `scopes/prj_…/rag.sqlite3-wal` | 0 B | sí |

- `before.sha256` vs `after.sha256`: **0 líneas de diferencia** (`diff.sha256` vacío).
- `before.files.tsv` vs `after.files.tsv` (tamaño y `mtime` con nanosegundos): **0 líneas de diferencia**
  (`diff.files.tsv` vacío).

No es que no haya cambios *visibles*: los cinco ficheros son **byte a byte** los mismos y conservan su marca de
tiempo. Nada los abrió.

## Contadores

| Métrica | Antes | Después |
|---|---|---|
| Fuentes | 121 | 121 |
| Fragmentos | 964 | 964 |
| Vectores | 964 | 964 |
| Entradas de auditoría (almacén) | 141 | 141 |
| Entradas de auditoría (registro) | 41 | 41 |
| `index_revision` | 133 | 133 |
| `quick_check` | `ok` | `ok` |

## Qué no se tocó

- Documentos originales: no se escribió en `C:\xampp\htdocs\plugins-dhs\lifecode-rag`.
- Selección de proyecto: la fila `session-c90d50d6-…` conserva `revision 1` y `updated_at` original.
- Configuración del perfil: `config.json` con la misma huella (`automation=off`, `autoContext=off`).
- Índices FTS y vectoriales: `-wal` vacío y `-shm` con la marca de tiempo previa a esta misión.

## Advertencia registrada

Abrir el almacén en modo lectura con `node:sqlite` **puede** tocar el `-shm` si la base está en WAL. Por eso la
inspección se hizo sobre copia. Cualquier verificación futura que abra el original debe asumir ese efecto y
declararlo antes, no después.
