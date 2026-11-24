# Publicación de LifeCode RAG 1.3.0 — informe final

**Estado:** **PUBLICADO Y VERIFICADO** (16/16 controles V en PASS)
**Fecha de publicación (registro):** `2026-11-23T03:32:53.152Z` · **Aceptado por el registro:** `03:30:47–03:31:14Z` (`PUT 202`, exit 0)
**Paquete:** `@designerbyron/lifecode-rag@1.3.0` · **Registro:** `https://registry.npmjs.org/`
**Artefacto publicado:** `plans/UX-02/UX-02-2.1-PACKAGE-1.3.0-2026-11-23/artifact/designerbyron-lifecode-rag-1.3.0.tgz`
**Ejecutor del `publish` y del 2FA:** el propietario (PIN introducido por él). El agente no solicitó, leyó, copió ni introdujo OTP, tokens ni credenciales.

---

## 1. Puerta previa G1–G6 (antes de publicar) — 8/8 PASS

| Compuerta | Esperado | Observado |
|---|---|---|
| G1 tamaño | 310 675 | 310 675 |
| G2 sha256 | `f848b73e…` | `f848b73e…` |
| G2 sha512 | `43f12f0d…` | `43f12f0d…` |
| G2 sha256 por `certutil` (instrumento independiente) | `f848b73e…` | `f848b73e…` |
| G3 sesión | `designerbyron` | `designerbyron` |
| G4 versión libre (HTTP, no caché) | no existe | no existía · `0.0.0-stage, 1.0.0, 1.1.0, 1.2.0` |
| G5 registro | `https://registry.npmjs.org/` | idéntico |
| G6 2FA | `auth-and-writes`/`auth-only` | `auth-and-writes` |

Evidencia: `evidence/gates-antes.json` (sonda `evidence/gates.mjs`).

## 2. La publicación, según el log de npm

`C:\Users\BYRON\AppData\Local\npm-cache\_logs\2026-11-23T03_30_47_554Z-debug-0.log` (sólo líneas sin
credenciales, en `evidence/log-npm-publicacion.txt`):

```
7  verbose title npm publish designerbyron-lifecode-rag-1.3.0.tgz
30 notice Publishing to https://registry.npmjs.org/ with tag latest and public access
31 http fetch PUT 401 https://registry.npmjs.org/@designerbyron%2flifecode-rag 774ms
38 http fetch GET 202 https://registry.npmjs.org/-/v1/done?authId=*** 164ms   (esperando aprobación)
40 http fetch GET 200 https://registry.npmjs.org/-/v1/done?authId=*** 211ms   (PIN aceptado)
41 verbose web auth done-check finished
42 notice Your package is being processed and may take a few minutes to become available.
43 http fetch PUT 202 https://registry.npmjs.org/@designerbyron%2flifecode-rag 1876ms
48 verbose exit 0
49 info ok
```

`401` → aprobación web → `done 200` → **`PUT 202`** → `exit 0`. El `202` es «aceptado», no «disponible»;
por eso se sondeó después.

## 3. Verificación V1–V5 (después) — 16/16 PASS

`sondas: evidence/verify-published.mjs` → `evidence/verify-2.json`

| # | Control | Esperado | Observado |
|---|---|---|---|
| V1 | existe `1.3.0` | sí | **sí** |
| V1 | versión publicada | `1.3.0` | `1.3.0` |
| V2 | `dist.integrity` | `sha512-Q/EvDeGx…` | **idéntico** |
| V2 | `dist.shasum` (sha1) | `26286f79…` | `26286f79a3ab742fb666971d55dfdc52186d1132` |
| V2 | licencia publicada | MIT | MIT |
| V3 | `dist.fileCount` | 74 | **74** |
| V3 | `dist.unpackedSize` | 1 078 261 | 1 078 261 |
| V5 | `dist-tags.latest` | `1.3.0` | **`1.3.0`** |
| V4 | descarga del tarball publicado | HTTP 200 | **200** |
| V4 | sha256 del `.tgz` descargado | `f848b73e…` | **`f848b73e…`** (mismo fichero, no sólo mismo contenido) |
| V4 | sha512 del descargado | `sha512-Q/EvDeGx…` | idéntico |
| V4 | tamaño descargado | 310 675 | 310 675 |
| V4 | entradas del `.tgz` descargado | 74 | 74 |
| V4 | `package.json` publicado · version / license | `1.3.0` / MIT | `1.3.0` / MIT |
| V4 | `PA_VERSION` publicado | `pa/1.4.0` | `pa/1.4.0` |
| V4 | módulo de herramientas presente | sí | sí |

**Comprobación cruzada con el cliente** (`evidence/cierre-verificacion.txt`): `npm view
@designerbyron/lifecode-rag@1.3.0` coincide en `version`, `dist.integrity`, `dist.fileCount`,
`dist.shasum`; `dist-tags` = `{"latest":"1.3.0"}`; `versions` lista las cinco.

## 4. Propagación medida (por qué el primer sondeo marcó 404)

| Momento (UTC) | Metadata | Tarball (URL correcta) |
|---|---|---|
| 03:32:19 | sin 1.3.0 · latest 1.2.0 | — |
| 03:33:06 | **1.3.0 presente** · latest 1.3.0 · integridad y `fileCount` ya correctos | — |
| 03:39:57 | 1.3.0 | **HTTP 200**, 310 675 B, hashes idénticos |

Desfase medido entre `PUT 202` (03:31:14) y metadata disponible (03:32:53): **~99 s**. La metadata apareció
completa de una vez (versión, integridad, `fileCount`, `latest`).

## 5. Incidencias del acto (declaradas, con efecto medido)

| # | Incidencia | Efecto | Prueba de que no tuvo efecto |
|---|---|---|---|
| I1 | El propietario ejecutó el comando en PowerShell y la política de ejecución bloqueó `npm.ps1` | **Ninguno**: npm no llegó a arrancar | Registro intacto a las 03:30:09Z (sin 1.3.0); **ningún log de npm** posterior a `03_27_45` (`evidence/incidencia-powershell.txt`) |
| I2 | Mi sonda de sondeo usaba `/-/designerbyron-lifecode-rag-1.3.0.tgz` (nombre de `npm pack`), cuando la URL del registro para un paquete con ámbito es `/-/lifecode-rag-1.3.0.tgz` | **Falso «404» del tarball durante ~6 min**; el registro estaba bien | Se corrigió la sonda para leer `dist.tarball` de la metadata; la URL correcta respondió 200 y el `.tgz` descargado es idéntico (`evidence/sondeo-url-correcta.txt`) |
| I3 | La sonda de verificación usaba `tar` de MSYS con ruta `C:/…` («Cannot connect to C:») | Fallo del instrumento, no del artefacto | Se añadió `--force-local`; la verificación completa salió 16/16 |

Ninguna de las tres afectó al artefacto, al registro ni a los datos. **No se republicó**: el `publish` se
ejecutó una sola vez.

## 6. Estado final

| Dato | Valor |
|---|---|
| npm `latest` | **1.3.0** |
| Versiones publicadas | `0.0.0-stage`, `1.0.0`, `1.1.0`, `1.2.0`, **`1.3.0`** |
| Artefacto local (original y respaldo) | sha256 `f848b73e…`, intactos; el respaldo sigue en solo lectura |
| Git | `release/lifecode-rag-1.0.0` @ `7d7e839`, índice **vacío**, 32 entradas sucias (sin cambios por este acto) |
| Commits / merges / tags / push | **ninguno** |
| Instalación en DSH | **no ejecutada** (fase aparte) |
| Datos RAG, `rag.sqlite3`, `registry.sqlite3`, WAL/SHM | **no tocados** |
| Sidecars del almacén real | **no tocados** |
| Reindexación / migración | **no ejecutadas** |

## 7. Lo que queda pendiente, y no es de este acto

- **Instalar/actualizar el plugin en DSH Real**: requiere autorización independiente. Con `latest` en 1.3.0,
  la entrega al perfil tiene sus propias trampas (perfil con `minimumReleaseAge`, `link:` vs versión npm,
  cierre limpio del host y comprobación del almacén tras la actualización).
- **Verificación en el host**: cargar el plugin y comprobar que `GET /pa/workspaces` responde con el registro
  real de workspaces. Eso tampoco se hizo aquí y no se declara hecho.
