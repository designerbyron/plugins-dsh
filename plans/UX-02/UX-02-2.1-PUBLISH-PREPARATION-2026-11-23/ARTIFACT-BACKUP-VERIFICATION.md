# Respaldo y verificación del artefacto (Fase A)

**Acto:** preparación de la publicación de `@designerbyron/lifecode-rag@1.3.0`
**Fecha:** 2026-11-23T02:56Z · **Artefacto autorizado:** `designerbyron-lifecode-rag-1.3.0.tgz`

---

## 1. Ubicaciones

| Rol | Ruta |
|---|---|
| **Original** (aprobado, no se reconstruye) | `plans/UX-02/UX-02-2.1-PACKAGE-1.3.0-2026-11-23/artifact/designerbyron-lifecode-rag-1.3.0.tgz` |
| **Respaldo** (copia del acto de publicación) | `plans/UX-02/UX-02-2.1-PUBLISH-PREPARATION-2026-11-23/artifact-backup/designerbyron-lifecode-rag-1.3.0.tgz` |

Rutas relativas a `C:\xampp\htdocs\plugins-dhs-release`.

## 2. Comprobación contra los hashes autorizados

| Dato | Autorizado en el mandato | Medido en el original | Medido en el respaldo | Estado |
|---|---|---|---|---|
| SHA-256 | `f848b73ed2a85d6cecffab694710f062bade3d13f912a52a7ab94b927d724ec3` | **idéntico** | **idéntico** | PASS |
| SHA-512 | `43f12f0de1b12624e372ea220748869fe8246a9400d9b290adc3c9c25e5dc773c7e845a98f81d2868d57c094dca81cebb43ff4d9da91d02cf39eba8d156ea1d6` | **idéntico** | **idéntico** | PASS |
| Tamaño | 310 675 bytes | **310 675** | **310 675** | PASS |

Verificado con **tres instrumentos independientes**: `sha256sum`/`sha512sum` (GNU coreutils),
`certutil -hashfile` (Windows) y —en el acto anterior— `node:crypto`. Los tres coinciden en ambos
ficheros. Logs: `evidence/fase-a-original.txt`, `evidence/fase-a-backup.txt`.

## 3. Copia byte a byte

| Control | Resultado | Estado |
|---|---|---|
| `cmp -s original respaldo` | sin diferencias (exit 0) | PASS |
| `cp -p` conserva la marca de tiempo | ambos `2026-11-22 20:18:37.632 -0600` | PASS |
| SHA-256/SHA-512 del respaldo = del original | sí | PASS |
| Respaldo legible tras protegerlo | sí, mismo hash | PASS |
| Respaldo marcado **solo lectura** (`attrib +R`) para que nadie lo sobrescriba | `A ... R ... designerbyron-lifecode-rag-1.3.0.tgz` (`evidence/fase-a-atributos.txt`) | PASS |

## 4. Protección de lo anterior

- El **original no se ha recreado, movido ni modificado**: su SHA-256 sigue siendo `f848b73e…` después de
  todas las consultas de este acto (`evidence/fase-c-codigos.txt`).
- No se ha tocado ningún worktree, ni datos RAG, ni sidecars SQLite.
- Las evidencias de los actos anteriores (UX-2.1 y paquete candidato) siguen intactas: este acto vive en
  un directorio **nuevo**.

## 5. Qué hacer si el respaldo y el original divergen en el acto de publicación

Si en el momento de publicar el hash del fichero a subir no es **exactamente**
`f848b73e…`, el acto se detiene: no se publica y se vuelve al paso de auditoría. El respaldo marcado como
solo lectura permite distinguir «el original cambió» de «la copia se corrompió».
