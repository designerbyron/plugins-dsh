# ACP-04 — Verificación del registro npm

**Verificado:** 2026-11-22 05:08:34 UTC (23:08 HAC)
**Paquete consultado:** `@designerbyron/lifecode-rag`
**Resultado: FAIL para la versión 1.0.0** — el paquete existe en el registro, pero **la 1.0.0 no está
publicada**. Lo único publicado es un stub `0.0.0-stage`.

---

## 1. Lo que devuelve el registro

```
$ npm view @designerbyron/lifecode-rag@1.0.0
npm error code E404
npm error 404 No match found for version 1.0.0

$ npm view @designerbyron/lifecode-rag versions dist-tags
versions = '0.0.0-stage'
dist-tags = { latest: '0.0.0-stage' }
```

| Consulta | Respuesta |
|---|---|
| `@designerbyron/lifecode-rag@1.0.0` | `E404 No match found for version 1.0.0` |
| Versiones publicadas | **una**: `0.0.0-stage` |
| `dist-tags.latest` | `0.0.0-stage` |
| Mantenedor | `designerbyron <designerbyron@gmail.com>` |
| Creado / modificado | `2026-11-22T05:05:52.985Z` / `2026-11-22T05:05:53.044Z` |
| Licencia | no declarada (el stub no tiene campo `license`) |
| Descripción del paquete | «Temporary package placeholder for staged publishing» |

## 2. Qué es lo que sí está publicado

```
dist.tarball     https://registry.npmjs.org/@designerbyron/lifecode-rag/-/lifecode-rag-0.0.0-stage.tgz
dist.integrity   sha512-8/bzStSY6vXgSd4qqis6EvfZj6A6iTvogqzjmulHro8SN+rp3HocL9yjLoV9Wg/8VAS/HHOyyiKRtRILG2hdHg==
dist.shasum      8e62e22470112e00a2ed08a298678bb18b60b7aa
dist.fileCount   2
dist.unpackedSize 349 B
```

Descargado y listado: el tarball pesa 374 B y contiene exactamente dos ficheros,
`package/package.json` y `package/README.md`. El manifiesto es:

```json
{
  "name": "@designerbyron/lifecode-rag",
  "version": "0.0.0-stage",
  "stub": true,
  "description": "Temporary package placeholder for staged publishing"
}
```

El `sha1` del fichero descargado (`8e62e22470112e00a2ed08a298678bb18b60b7aa`) coincide con el `shasum`
del registro: lo que está publicado es ese stub, sin duda.

## 3. Contraste con el artefacto autorizado

| Dato | Stub publicado | Artefacto final (con MIT) |
|---|---|---|
| Versión | `0.0.0-stage` | `1.0.0` |
| Ficheros | 2 | **73** |
| Tamaño | 374 B | 274.146 B |
| Licencia | ninguna | **MIT** |
| `shasum` | `8e62e224…` | `b2c0f43d4b112eb711925df28eb39312aad82e27` |
| `integrity` | `sha512-8/bzStSY6…` | `sha512-DlyI70XCuChoK…dJMkv6OZfdNyw==` |
| Herramientas | 0 | 7 |

No hay correspondencia. **La publicación de la 1.0.0 no se produjo**; lo que se confirmó como «publicado»
es la reserva del nombre con un placeholder, creada a las 05:05:52Z.

## 4. Por qué pudo pasar

`npm publish` con el árbol actual fallaba con `E403` (2FA `auth-and-writes`). Al resolver el segundo
factor, lo que salió al registro fue un stub de dos ficheros — probablemente un paquete auxiliar o un
`npm publish` desde otro directorio —, no el tarball de 73 ficheros del worktree de release. El registro
no miente: una sola versión, dos ficheros.

## 5. Consecuencia

- El nombre `@designerbyron/lifecode-rag` **está reservado** por el titular correcto: nadie más puede
  tomarlo.
- La versión `1.0.0` sigue **disponible** para publicar (no está ocupada).
- Cualquier consumidor que ejecute `npm install @designerbyron/lifecode-rag` recibe hoy un stub que no
  contiene el plugin.

## 6. Veredicto

**FAIL** en el criterio «la versión 1.0.0 existe en el registro público». El resto de la cadena
(artefacto, pruebas, consumidor con el tarball local) está verificado en ACP-03 y se re-verifica en
`ACP-04-PUBLIC-API-COMPATIBILITY.md`.

No se ha ejecutado `npm publish`, conforme a la restricción del encargo.
