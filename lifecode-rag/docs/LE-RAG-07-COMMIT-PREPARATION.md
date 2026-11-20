# LE-RAG-07 · Preparación del primer commit de LifeCode RAG

## Estado

| | Antes | Después |
|---|---|---|
| Branch | `fix/t45-4-r17-acceptance` | igual |
| HEAD | `b6c0cd24621c8bc3282185d1821c60b7956f8a83` | igual |
| Índice | vacío (0 staged) | **405** entradas, todas bajo `lifecode-rag/` |
| Fuera de `lifecode-rag/` | sin cambios desde LE-RAG-06 | **sin cambios** (diff de manifiesto vacío) |
| `git ls-files lifecode-rag` | 0 | 0 hasta el commit |

No había staging previo que preservar. No se usó `add -A`, `add .`, `reset`, `clean`, `checkout` ni `restore`.

## Criterios de inclusión

- **Incluido:** código (A), pruebas (B), documentación (C), evidencia reproducible y benchmarks (D).
- **Excluido:** logs de ejecución y almacenes locales (`demo/.store/`, `eval/real-world-01/store/`, 5 `*.log`) por `.gitignore`; ningún dato real, credencial ni perfil.
- **Sin clases E/F/G activas:** no hay artefactos temporales ni secretos entre los 412 archivos; no se excluyó evidencia por tamaño (el mayor pesa < 200 KB).

## Normalización de rutas

31 archivos de evidencia/documentación/scripts de `eval/` normalizados:

- `C:\Users\BYRON\…` y variantes → `<USER_HOME>`
- `BYRON` → `<USER>` (sólo en `docs/`, `eval/`, `bench/`, `README.md`)

**No se tocaron** `lib/`, `tests/`, `tools/`, `bin/` (fixtures sintéticas; ninguna contiene el nombre de usuario real). No se alteró ninguna cifra, hash, parámetro ni metodología. Los dos `.log` que aún contienen el nombre están ignorados y no se versionan.

## Licencias

- Raíz del repositorio: **MIT License © 2026 designerbyron** — cubre el árbol, incluido `lifecode-rag/`.
- `lifecode-rag/` **no tiene LICENSE propio**. Decisión documentada (no inventada): para uso interno la licencia del repositorio aplica; **si se publica por separado, debe añadirse un `LICENSE` copiando el MIT del repositorio**, y revisarse los avisos de terceros.
- Dependencia declarada `@deepseek-ai/dsh-tools`: no se empaqueta ni se copia; la aporta el anfitrión.
- Referencia externa auditada (`mervyn-teo/dsh-plugin-rag`, MIT): no se copió código.

## .gitignore creado en `lifecode-rag/`

`node_modules/`, `*.log`, `*.tmp*`, `*.sqlite3` (+ sidecars), `*.db`, `.store/`, ficheros de sistema. Justificación: nunca versionar almacenes locales ni logs.

## Validación

- Suite completa **396/396 pass** ejecutada **después** de la normalización.
- `tools/check.mjs` en verde (sin dependencias de `@deepseek-ai/*`).
- Diff staged: **403 archivos, 57 848 inserciones**; `git diff --cached --check` devuelve **45 avisos de espacios/EOF en blanco**, todos en documentación y evidencia **preexistente**; **cero marcadores de conflicto**, cero binarios raros. No se reescribió evidencia histórica por estilo.
- Revisión de secretos sobre el índice: `sk-`, `Bearer`, claves privadas → **sin coincidencias**.

## Riesgos pendientes

1. **CRLF→LF:** git avisa de que normalizará finales de línea al confirmar (63 archivos). No altera contenido lógico, pero el primer checkout puede mostrarlos en LF.
2. **Avisos de `--check`:** 45, preexistentes; se dejan como están.
3. **LICENSE propio ausente** en el paquete (decisión arriba).
4. **`lifecode-rag` entra completo en un solo commit** (~58 k líneas): el diff es revisable por directorios, pero es grande por naturaleza (primera incorporación).
5. Sin prueba con el modelo real de DSH.

## Commit propuesto

```
feat(lifecode-rag): incorporar el núcleo independiente, configuración por perfiles y diversidad documental

- core sin dependencias del Harness: configuración propia, eventos de conversación, trabajadores con contexto explícito
- precedencia perfil > global > defaults, validación única y fallo cerrado
- ranking por fragmento (default) y por fuente, RRF intacto
- 396 pruebas, benchmarks sintéticos y sobre copia real del almacén
- evidencia y ADR de LE-RAG-01 a LE-RAG-06
```

**HEAD actual:** `b6c0cd24621c8bc3282185d1821c60b7956f8a83`. **Sin commit, sin push, sin instalación.**
