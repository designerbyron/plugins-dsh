# Verificación posterior a la publicación (Fase E) — preparada, **NO EJECUTADA**

Todo lo de este documento es **solo lectura** contra el registro. No ejecuta ninguna escritura, no mueve
dist-tags y no instala nada.

---

## 1. Valores esperados (los del artefacto aprobado)

| Dato | Valor esperado |
|---|---|
| Versión publicada | `1.3.0` |
| `dist-tags.latest` tras publicar | `1.3.0` (npm mueve `latest` a la versión recién publicada) |
| `dist.integrity` | `sha512-Q/EvDeGxJiTjcuoiB0iGn+gkapQA2bKQrcPJwl5dx3PH6EWpj4HSho1XwJTcqBzrtD/02dqR0CzznrqNFW6h1g==` |
| `dist.shasum` (sha1) | `26286f79a3ab742fb666971d55dfdc52186d1132` |
| `dist.fileCount` | **74** |
| `dist.unpackedSize` | `1078261` |
| SHA-256 del `.tgz` descargado del registro | `f848b73ed2a85d6cecffab694710f062bade3d13f912a52a7ab94b927d724ec3` |
| `package.json` dentro del publicado | `name: @designerbyron/lifecode-rag`, `version: 1.3.0`, `license: MIT` |
| Contrato de la API dentro del publicado | `PA_VERSION = 'pa/1.4.0'` |
| Herramientas declaradas | 7 (`lifecode_rag_context, forget, get, ingest, list, reindex, search`) |

## 2. Comandos de lectura (ejecutar sólo después de publicar)

```sh
# 1 · ¿existe la versión?
npm view @designerbyron/lifecode-rag@1.3.0 version

# 2 · integridad declarada por el registro
npm view @designerbyron/lifecode-rag@1.3.0 dist.integrity

# 3 · metadatos de contenido (discriminador de stub)
npm view @designerbyron/lifecode-rag@1.3.0 dist.fileCount dist.unpackedSize dist.shasum

# 4 · dist-tags
npm view @designerbyron/lifecode-rag dist-tags --json

# 5 · fuente primaria por HTTP (no cachea), para no depender del cliente
node -e "fetch('https://registry.npmjs.org/@designerbyron%2Flifecode-rag',{headers:{'cache-control':'no-cache'}}).then(r=>r.json()).then(d=>{const v=d.versions['1.3.0'];console.log(JSON.stringify({version:v&&v.version,integrity:v&&v.dist.integrity,fileCount:v&&v.dist.fileCount,tags:d['dist-tags'],time:(d.time||{})['1.3.0']},null,2));})"

# 6 · descargar el tarball publicado y comprobar que es EL MISMO fichero
curl -s -o registro-1.3.0.tgz https://registry.npmjs.org/@designerbyron/lifecode-rag/-/designerbyron-lifecode-rag-1.3.0.tgz
sha256sum registro-1.3.0.tgz          # debe dar f848b73e…
certutil -hashfile registro-1.3.0.tgz SHA256   # segunda vía independiente
tar -tzf registro-1.3.0.tgz | wc -l   # debe dar 74
tar -xzOf registro-1.3.0.tgz package/package.json | grep -E '"version"|"license"'
tar -xzOf registro-1.3.0.tgz package/lib/pa-api.mjs | grep "PA_VERSION ="
```

Notas de ejecución en Windows/git-bash:

- `tar` de MSYS lee `C:/…` como host remoto: con ruta nativa hace falta `--force-local`, y `-C <ruta Windows>`
  falla igualmente (se usa `cd` al directorio y rutas relativas).
- El `E404` de `npm view …@1.3.0` **antes** de publicar y el de después son distintos: leer el mensaje literal.

## 3. Criterio de aceptación (los cuatro juntos)

| # | Control | Esperado | Si falla |
|---|---|---|---|
| V1 | `npm view …@1.3.0 version` | `1.3.0` | si `E404`: la versión no llegó; **no republicar**, ver §4 |
| V2 | `dist.integrity` (cliente y HTTP) | `sha512-Q/EvDeGx…` | si difiere: **lo publicado no es el artefacto** → no instalar nada, investigar |
| V3 | `dist.fileCount` | `74` | si es distinto (p. ej. 2 de un stub): lo publicado es otra cosa |
| V4 | sha256 del `.tgz` descargado | `f848b73e…` | ídem V2: es la prueba de que el byte publicado es el probado |
| V5 | `dist-tags.latest` | `1.3.0` | si `latest` no se movió, **no tocar el tag a mano**: se reporta y se decide |

Un `200` en la metadata **no** demuestra nada por sí solo: un paquete puede existir con un stub. La prueba
es V2+V3+V4 juntos.

## 4. Propagación: `202` no es «disponible»

Tras un `202`, la metadata puede listar la versión mientras el tarball sigue en `404` durante unos minutos.
Procedimiento:

1. Anotar `time["1.3.0"]` del documento del registro y `date -u` en ese momento.
2. Sondear el tarball con espaciado (p. ej. 30 s, 60 s, 120 s, 240 s) hasta `200`.
3. **No republicar** por un `404`: se espera, se dice cuánto se esperó y se vuelve a medir.
4. Si tras un margen razonable (≥ 10 min) el tarball sigue en `404`, se reporta como incidente con las horas
   medidas; la decisión (soporte de npm, versión nueva) es del propietario.

## 5. Lo que NO se hará en la verificación

- No `npm dist-tag add/rm` ni ningún cambio de etiquetas.
- No `npm unpublish` ni sobrescritura de la versión.
- No instalación del paquete (ni local ni en DSH): la instalación exige su propia autorización.
- No commits, merges, tags ni pushes.

## 6. Estado de esta verificación

**NOT RUN** — no hay nada publicado que verificar. Los comandos están preparados y sus valores esperados
están fijados de antemano, que es lo que evita «verificar» comparando contra lo que salga.
