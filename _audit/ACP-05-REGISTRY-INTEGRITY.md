# ACP-05 — Integridad del registro

**Verificado:** 2026-11-22 05:13 UTC
**Método:** descarga directa del tarball público y comparación de hashes con el artefacto autorizado.

---

## 1. Comparación, byte a byte

| Dato | Artefacto autorizado (local) | Tarball del registro | ¿Igual? |
|---|---|---|---|
| Tamaño | 274 146 B | 274 146 B | ✅ |
| `sha256` | `595c6e19d592d730de65fd968a85fba7aa0869ae526cab596c279fdefbca1166` | `595c6e19d592d730de65fd968a85fba7aa0869ae526cab596c279fdefbca1166` | ✅ |
| `sha1` (shasum npm) | `b2c0f43d4b112eb711925df28eb39312aad82e27` | `b2c0f43d4b112eb711925df28eb39312aad82e27` | ✅ |
| `sha512` (integrity) | `sha512-DlyI70XCuChoKpM+EfefzwkmIMQErWlqwZs/2iW1s08zDc93GdPxEx3x1IQJ4lmhubE+0U06ZdJMkv6OZfdNyw==` | idéntico | ✅ |
| Ficheros | 73 | 73 | ✅ |
| `package.json` | `@designerbyron/lifecode-rag` 1.0.0 · MIT | idéntico | ✅ |
| `LICENSE` | `MIT License` / `Copyright (c) 2026 Byron Vanegas` | idéntico | ✅ |

El `sha256` del tarball descargado coincide con el del fichero local: no es sólo que el contenido sea
equivalente, es el **mismo fichero**.

## 2. Contenido del tarball publicado

```
tar -tzf reg.tgz | wc -l   → 73
```

| Grupo | Presencia |
|---|---|
| `index.js`, `client.js` | ✅ |
| `lib/*.mjs` (48 módulos) | ✅ |
| `bin/lifecode-rag.mjs` | ✅ |
| `cordis.patch.yml`, `icon.svg` | ✅ |
| `README.md`, `LICENSE` | ✅ |
| 13 documentos públicos en `docs/` | ✅ |

Y nada de esto:

```
grep -Ei "\.(db|sqlite3?|log|env|tgz)$|_audit|docs/release|tests/|tools/|eval/"
→ sin coincidencias
```

Sin bases de datos, sin logs, sin informes de auditoría, sin pruebas, sin fixtures y sin rutas personales.

## 3. Identidad del artefacto

| Comprobación | Resultado |
|---|---|
| Nombre del paquete | `@designerbyron/lifecode-rag` |
| Versión | `1.0.0` |
| Licencia | `MIT` |
| Dependencias declaradas | ninguna |
| `stub` | ausente (el placeholder era el otro) |

## 4. Veredicto

**PASS.** Integridad verificada por tres funciones de hash independientes y por comparación de contenido.
El artefacto publicado es exactamente el que se probó.
