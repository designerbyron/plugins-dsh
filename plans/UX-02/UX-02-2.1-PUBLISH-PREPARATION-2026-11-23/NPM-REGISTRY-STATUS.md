# Estado del registro npm (Fase C)

**Acto:** preparación de la publicación de `@designerbyron/lifecode-rag@1.3.0`
**Medido:** 2026-11-23T02:57Z · **Registro:** `https://registry.npmjs.org/`
**Fuente primaria:** HTTP directo a `https://registry.npmjs.org/@designerbyron%2Flifecode-rag` con
`Cache-Control: no-cache` (`evidence/fase-c-registry.json`). **Fuente cruzada:** el cliente npm
(`npm view`), que puede servir caché.

---

## 1. Paquete

| Dato | Valor | Estado |
|---|---|---|
| Existe | **sí** (HTTP 200) | PASS |
| Nombre | `@designerbyron/lifecode-rag` | PASS |
| Visibilidad | **`public`** (`npm access get status`) | PASS |
| Mantenedores | `designerbyron` (único) | PASS |
| `dist-tags` | `{ "latest": "1.2.0" }` — **no modificado** | PASS |
| Última modificación del paquete | `2026-11-22T19:59:55.679Z` | — |

## 2. Versiones publicadas

| Versión | Fecha de publicación (UTC) | Licencia | `dist.fileCount` |
|---|---|---|---|
| `0.0.0-stage` | 2026-11-22T05:05:52.985Z | (sin campo) | — |
| `1.0.0` | 2026-11-22T05:08:00.539Z | MIT | — |
| `1.1.0` | 2026-11-22T14:07:22.109Z | MIT | — |
| **`1.2.0`** (`latest`) | 2026-11-22T19:59:55.529Z | MIT | **73** |

Integridad publicada de `latest`:
`sha512-E+81kiagjYjMnEX0MhZWE8+Z1Te3VlOxN39/bapGb7CHAF7QQtyqoE3jaAUzxRCV7mE1JjOpap7rOof4lIM9kw==`

## 3. ¿Existe ya la 1.3.0?

| Control | Resultado | Estado |
|---|---|---|
| Versión `1.3.0` en el documento del registro | **no aparece** (4 versiones, ninguna es 1.3.0) | PASS |
| `npm view @designerbyron/lifecode-rag@1.3.0 version` | **exit 1 (E404: no match for version)** | PASS (confirma ausencia) |
| `npm view @designerbyron/lifecode-rag@1.2.0 version` (control positivo) | exit 0 → `1.2.0` | PASS |
| **Conflicto de versión** | **ninguno**: 1.3.0 está libre | PASS |

> El `E404` del cliente **no se usa como prueba única**: la ausencia se comprobó en la fuente HTTP, y se
> cruzó la hora (`date -u` 02:57:35Z frente a `modified` 19:59:55Z del día anterior). Aquí coinciden, así
> que no hay lugar a la confusión caché/fuente.

## 4. Comparación con el artefacto a publicar

| Dato | Registro (`1.2.0`) | Artefacto aprobado (`1.3.0`) | Comentario |
|---|---|---|---|
| `dist.fileCount` | 73 | **74** | +1: el módulo nuevo `lib/workspaces-projection.mjs`. Coherente con el cambio |
| `dist.integrity` | `sha512-E+81ki…` | **`sha512-Q/EvDeGxJiTjcuoiB0iGn+gkapQA2bKQrcPJwl5dx3PH6EWpj4HSho1XwJTcqBzrtD/02dqR0CzznrqNFW6h1g==`** | distinto por diseño: es otra versión. El valor de 1.3.0 se usará para verificar tras publicar |
| Licencia | MIT (en 0.0.0-stage sin campo; en 1.0.0/1.1.0/1.2.0 MIT) | **MIT** (`package.json` y `LICENSE` del tarball: «MIT License · Copyright (c) 2026 Byron Vanegas») | **consistente**: publicar 1.3.0 no cambia la licencia del paquete |
| Versión del contrato de la API | `pa/1.3.0` en 1.2.0 | **`pa/1.4.0`** | el README las presenta por separado (npm 1.3.0 ≠ contrato pa/1.4.0) |

## 5. Conflictos y riesgos detectados

| Riesgo | Medición | Mitigación en el procedimiento |
|---|---|---|
| Republicar una versión existente | 1.3.0 no existe | si el `publish` devuelve `E409`/`EPUBLISHCONFLICT`, **no se fuerza nada**: se para y se investiga |
| Publicar un stub desde otro directorio | el paquete ya tuvo un `0.0.0-stage` (reserva de nombre) | se publica el **tarball explícito** y se verifica por contenido (`fileCount` 74 + integridad + descarga del `.tgz`) |
| Cambiar `latest` sin querer a una versión no deseada | `latest` = 1.2.0 | un `publish` de 1.3.0 mueve `latest` a 1.3.0 por defecto (comportamiento esperado y documentado en el procedimiento); no se tocan dist-tags a mano |
| Licencia inmutable | MIT coherente en registro y artefacto | ninguna acción necesaria |

**No** se ha modificado ningún dist-tag, versión ni metadato del registro: todas las consultas de esta
fase son de lectura.
