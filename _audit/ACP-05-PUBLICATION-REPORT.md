# ACP-05 — Informe de publicación

**Verificado:** 2026-11-22 05:12–05:13 UTC (23:12 HAC)
**Paquete:** `@designerbyron/lifecode-rag@1.0.0`
**Resultado: PASS** — la 1.0.0 está publicada y es byte a byte el artefacto autorizado.

---

## 1. Preflight

| Comprobación | Resultado |
|---|---|
| `npm whoami` | `designerbyron` |
| HEAD del worktree de release | `7d7e839d514cca27044d595218bf8c67ec5a1f7d` (rama `release/lifecode-rag-1.0.0`) |
| `git status` del worktree | sólo `_audit/` sin commitear (documentación de cierre); ningún cambio funcional |
| `npm view … versions dist-tags` | `['0.0.0-stage','1.0.0']` · `latest: 1.0.0` |
| `npm view …@1.0.0 version` | `1.0.0` |

**La 1.0.0 ya estaba publicada cuando empezó este acto.** El registro la fecha en
`2026-11-22T05:08:00.539Z`. Por eso **no se ejecutó `npm publish`**: republicar la misma versión está
prohibido por el encargo y además el registro lo rechazaría. El objetivo del acto —que la 1.0.0 esté
publicada— ya estaba cumplido; lo que faltaba era demostrarlo.

## 2. Publicación, tal como consta en el registro

| Campo | Valor |
|---|---|
| Nombre | `@designerbyron/lifecode-rag` |
| Versión | `1.0.0` |
| Publicada | `2026-11-22T05:08:00.539Z` |
| Autor de la publicación (`_npmUser`) | `designerbyron` |
| Licencia | **MIT** |
| `dist.fileCount` | **73** |
| `dist.unpackedSize` | 925 614 B |
| `dist.tarball` | https://registry.npmjs.org/@designerbyron/lifecode-rag/-/lifecode-rag-1.0.0.tgz |
| `dist.integrity` | `sha512-DlyI70XCuChoKpM+EfefzwkmIMQErWlqwZs/2iW1s08zDc93GdPxEx3x1IQJ4lmhubE+0U06ZdJMkv6OZfdNyw==` |
| `dist.shasum` | `b2c0f43d4b112eb711925df28eb39312aad82e27` |

Consulta hecha **por HTTP directo**, sin el cliente npm y con `Cache-Control: no-cache`, para que no
interviniera ninguna caché local:

```
GET https://registry.npmjs.org/@designerbyron%2flifecode-rag
→ versions: [ '0.0.0-stage', '1.0.0' ]
→ 1.0.0: license MIT · fileCount 73 · integrity sha512-DlyI70XC… · shasum b2c0f43d…
→ publicado 2026-11-22T05:08:00.539Z · _npmUser designerbyron
```

## 3. El placeholder sigue ahí, y no molesta

`0.0.0-stage` (2 ficheros, stub) sigue publicado, pero **ya no es `latest`**: el `dist-tags.latest` apunta a
`1.0.0`. Ningún consumidor que instale sin versión recibe el stub.

## 4. Aclaración sobre ACP-04

ACP-04 registró cuatro FAIL porque `npm view` devolvió sólo `0.0.0-stage` a las `05:08:34Z`. El registro
fecha la publicación a las `05:08:00.539Z`, **34 segundos antes** de esa consulta, y la consulta HTTP
directa de ahora la ve. La explicación más probable —y no verificable a posteriori— es que el cliente npm
sirvió metadata de su caché local. Lo que sí está verificado: el registro tenía la 1.0.0 antes de la
consulta de ACP-04 y la tiene ahora. La evidencia de ACP-04 no se reescribe; su resolución queda aquí y en
la nota añadida a ese informe.

## 5. Veredicto

**PASS.** La versión 1.0.0 está publicada bajo el scope correcto, con licencia MIT, 73 ficheros, y una
integridad que coincide exactamente con el artefacto autorizado (`ACP-05-REGISTRY-INTEGRITY.md`).
