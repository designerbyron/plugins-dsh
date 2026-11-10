# R16 · Matriz de colisiones y preflight

| Campo | Valor |
|---|---|
| Ronda | R16 — motor central de colisiones + preflight |
| Fecha de redacción | 2026-11-09 |
| Motor | `lifecode-skill-center/lib/collisions.mjs` (452 líneas) |
| Compuerta | `lifecode-skill-center/lib/preflight.mjs` (357 líneas) |
| Contrato | `_audit/R16-CONTRACT.md` §3 y §4 (`:286-423`) |
| Sonda reproducible | `lifecode-skill-center/tools/r16-collision-matrix.mjs` (131 líneas) |

El motor no decide por su cuenta: `detectCollisions` produce colisiones con severidad y
`preflight` las convierte en una decisión `allow`/`warn`/`block` para una acción concreta. La misma
colisión puede ser `warn` al leer y `block` al materializar.

---

## 1. Salida del motor

`detectCollisions({ entries, projects, assignments, workspaces, manifests })`
(`lib/collisions.mjs:424-451`) devuelve:

```js
{ collisions, ambiguousNames, byKey }
```

Cada colisión es `{ code, severity, key, rows: [{ key, owner, location }], explanation, evidence }`.
`SEVERITY_RANK` es `{ block: 0, warn: 1, info: 2 }` (`lib/collisions.mjs:25`). `byKey` indexa las
colisiones por `key` para que el preflight encuentre las que afectan a un proyecto o skill.

## 2. Normalización de nombres y rutas

- La regex del Host se replica exactamente: `HOST_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`
  (`lib/collisions.mjs:23`).
- `canonicalSkillName` **sólo** hace `trim()` y comprueba la regex; si no cumple, devuelve `null`
  (`lib/collisions.mjs:36-40`). No hay NFKC para igualar: el comentario `:32-35` lo dice y
  `diagnoseSkillName` aplica NFKC únicamente para explicar por qué un nombre no es canónico
  (`lib/collisions.mjs:46-52`).
- Consecuencia: `pdf-tools` y `pdf--tools` **no** colisionan; `Pdf-Tools` tampoco. Un nombre
  inválido nunca se normaliza para convertirlo en otro (`tests/r16-domain.test.mjs:269-290`,
  `tests/r16-contract.test.mjs:565-580`).
- Rutas: se comparan por `cwdKey` (normaliza `\`, colapsa `//`, quita barra final, minúsculas;
  `lib/collisions.mjs:80-90`). En Windows, mayúsculas y `\` frente a `/` son la misma ruta.
- UUID: se comparan en minúsculas y sin espacios (`lib/collisions.mjs:175-213`).
- Hash: sólo un SHA-256 hexadecimal de 64 caracteres cuenta como contenido comparable
  (`lib/collisions.mjs:287-309`).

## 3. Los seis tipos

| Código | Clave de agrupación | Cálculo | Severidad |
|---|---|---|---|
| `identity-duplicate` | `identity.uuid` | Mismo UUID en más de una entrada; el contrato lo quiere `block` (mismo UUID con contenido distinto). El código exige además que los **nombres** difieran | `block` |
| `name-collision` | `canonicalName` | ≥2 entradas con el mismo nombre canónico y al menos 2 firmas distintas (`owner.kind|origin.kind|location|provider`). Si dos filas son nuestras y reclaman ubicaciones distintas (o ninguna), `block`; si el ganador es nuestro y el resto es invisible, `warn` | `block` / `warn` |
| `path-collision` | `locationKey` (ruta canónica) | ≥2 entradas en la misma ruta, dos proyectos con el mismo `cwdKey` o dos workspaces con la misma ruta | `block` |
| `content-collision` | `identity.contentSha256` | Mismo hash en entradas con nombres canónicos distintos | `warn` |
| `assignment-shadowed` | `projectId:skillId` | La asignación está `enabled` y el snapshot carga otro provider, o el ganador tiene `shadowedBy` | `warn` al leer; `block` al materializar |
| `legacy-collision` | nombre / `rootId|name` | Cualquier entrada bajo `/skill-compiler/projects/`, un `<dir>/SKILL.md` con su `<dir>.md` suelto, o un manifiesto huérfano | `warn` |

Implementación: `identityDuplicates` `:175-213`, `nameCollisions` `:215-236`, `pathCollisions`
`:238-285`, `contentCollisions` `:287-309`, `assignmentShadowed` `:311-355`, `legacyCollisions`
`:357-411`.

**Por qué `block` o `warn`.** Se bloquea cuando la operación **escribiría o pisaría** contenido
ajeno o cuando dos entidades se disputan la misma identidad (UUID, ruta, dos propios con el mismo
nombre). Se avisa cuando la ambigüedad es informativa y la operación no cambia el ganador: contenido
duplicado bajo otro nombre, historia del compilador, sombra en lectura. `assignment-shadowed` es el
caso mixto: leer avisa (el Host ya eligió), materializar bloquea (escribiría una vista que no se
cargaría).

## 4. Orden determinista

`compareCollisions` ordena por severidad (`block` primero), luego `code` ascendente y luego `key`
ascendente (`lib/collisions.mjs:413-418`). `ambiguousNames` sale ordenado. El orden es estable y no
depende del orden de lectura del sistema de ficheros. Prueba:
`tests/r16-domain.test.mjs:418-484`.

## 5. Matriz escenario → decisión

La columna «prueba» cita el test real. `tests/r16-collision-matrix.test.mjs` **no existe**; la matriz
ejecutable es `tools/r16-collision-matrix.mjs`.

| Escenario | Entrada | Código | Severidad | Operación bloqueada | Prueba |
|---|---|---|---|---|---|
| Mismo UUID con nombres distintos | 2 entradas, mismo `uuid`, nombres A/B | `identity-duplicate` | `block` | Cualquier escritura con preflight (la decisión es `block`) | `tests/r16-contract.test.mjs:460-477` |
| Dos filas nuestras con el mismo nombre | 2 entradas `owner.kind: 'lifecode'`, ubicaciones distintas | `name-collision` | `block` | `materialize-project`, `assign-skill` | `tests/r16-contract.test.mjs:447-459` |
| Nuestro nombre y una copia externa | 1 nuestra + 1 filesystem, mismo `canonicalName` | `name-collision` | `warn` | Ninguna; la operación sigue con aviso | `tests/r16-contract.test.mjs:429-446` |
| Dos dueños en la misma ruta | 2 entradas con el mismo `locationKey` | `path-collision` | `block` | Escrituras sobre ese proyecto | `tests/r16-contract.test.mjs:478-484` |
| Dos proyectos con el mismo `cwdKey` | `state.projects` con dos ids equivalentes | `identity-conflict` (proyecto) | `block` | Registro y administración del proyecto | `tests/r16-domain.test.mjs:765-785` |
| Mismo contenido, nombres distintos | 2 SHA-256 iguales, `canonicalName` distinto | `content-collision` | `warn` | Ninguna (advisory) | `tests/r16-contract.test.mjs:485-496` |
| Asignación sombreada, lectura | asignación `enabled` y ganador de otro provider | `assignment-shadowed` | `warn` | Ninguna al leer | `tests/r16-contract.test.mjs:497-530` |
| Asignación sombreada, materializar | misma entrada, `action: materialize-project` | `assignment-shadowed` | `block` | `materialize-project` | `tests/r16-contract.test.mjs:497-530` |
| Entrada bajo el compilador anterior | ruta contiene `/skill-compiler/projects/` | `legacy-collision` | `warn` | Ninguna | `tests/r16-domain.test.mjs:418-484` |
| `SKILL.md` + `.md` suelto | misma raíz y nombre en dos formas | `legacy-collision` | `warn` | Ninguna | Sin prueba dedicada; código `lib/collisions.mjs:357-411` |
| Manifiesto huérfano | `manifests` con `projectId` fuera de `state.projects` | `legacy-collision` | `warn` | Ninguna | Sin prueba dedicada; código `:357-411` |
| Nombre no canónico | `name: 'Pdf--Tools'`, `canonicalName: null` | `invalid-name` | `warn` | Ninguna; nunca se iguala | `tests/r16-domain.test.mjs:269-290` |
| Grupo ambiguo que afecta al sujeto | `ambiguousNames` contiene el `skillId`/target | `ambiguous-identity` | `block` | `materialize-project`, `assign-skill` | `tests/r16-domain.test.mjs:559-574` |
| Fuente requerida incompleta | falta `state`/`filesystem-project`/`manifest`/`skills-registry` | `evidence-incomplete` | `block` | La acción entera | `tests/r16-domain.test.mjs:485-502` |
| Fuente opcional ausente | falta `workspace-registry` o `skills-registry` opcional | `catalog-unverified` | `warn` | Ninguna; no se afirma «sin colisiones» | `tests/r16-domain.test.mjs:503-558` |
| Manifiesto incoherente | `identity.state: 'mismatch'`, acción de manifiesto | `manifest-mismatch` | `block` | `repair-manifest`, `detach-project` | `tests/r16-domain.test.mjs:575-642` |
| Proyecto no registrado | `projectId` sin registro, acción administrativa | `project-not-registered` | `info` | Ninguna | `lib/preflight.mjs:314-318` (sin prueba dedicada) |
| Proyecto no disponible | `availability: 'missing-dir'` | `project-unavailable` | `block` | `materialize-project`, `repair-manifest` | `lib/preflight.mjs:283-291` |
| Colisión de contenido en el flujo real | dos entradas, mismo sha256, nombres `uno`/`dos`, `skillId: demo-skill` | `content-collision` | `warn` esperado; **`allow` real** | Ninguna | `tools/r16-collision-matrix.mjs` (falla 5/6) |

## 6. Acciones × fuentes (preflight)

`REQUIRED` (`lib/preflight.mjs:16-26`), `OPTIONAL` (`:28-38`) y las fuentes que el adaptador mide
`ACTION_SOURCES` (`lib/api.mjs:1173-1183`). `R` = requerida, `O` = opcional, `M` = medida por el
adaptador aunque no sea requerida.

| Acción | `state` | `manifest` | `filesystem-project` | `skills-registry` | `filesystem-view` | `workspace-registry` | `sessions` |
|---|---|---|---|---|---|---|---|
| `register-project` | R | O | R | — | — | O | — |
| `adopt-project` | R | R | R | — | — | — | — |
| `repair-manifest` | R | R | R | — | — | — | — |
| `detach-project` | R | R | R | — | — | — | — |
| `materialize-project` | R | R | — | R | R | — | — |
| `assign-skill` / `enable-skill` | R | R | — | O | — | — | — |
| `create-skill` / `publish-version` | R | R | — | — | — | — | — |

Regla fail-closed: si una `R` no está `complete`, la decisión es `block` con `evidence-incomplete`
(aunque el resto esté bien); si falla una `O`, es `warn catalog-unverified` y **nunca** se afirma que
no hay colisiones (`lib/preflight.mjs:251-273`). Una acción desconocida no inventa decisión: el
adaptador devuelve `null` y la acción sigue su curso (`lib/api.mjs:1189-1194`).

## 7. Códigos de finding

| Código | Severidad | Cuándo lo emite `preflight` | Línea |
|---|---|---|---|
| `evidence-incomplete` | `block` | acción vacía, required no `complete`, o excepción interna | `:242-249`, `:251-261`, `:349-356` |
| `catalog-unverified` | `warn` | opcional no disponible | `:262-273` |
| `store-unreadable` | `block` | integridad `unreadable`/`invalid-shape`/`future-version` | `:275-278` |
| `project-unavailable` | `block` | acción de proyecto con `missing-dir` o estado `unavailable` | `:283-291` |
| `manifest-missing` | `warn` | registro sin `manifestSha256` para assign/enable/materialize/repair/detach | `:293-304` |
| `manifest-mismatch` | `block` | `identity.state === 'mismatch'` en acción de manifiesto | `:305-313` |
| `project-not-registered` | `info` | acción administrativa sobre proyecto sin registro | `:314-318` |
| `invalid-name` | `warn` | `skillId` no canónico | `:319-321` |
| `ambiguous-identity` | `block` | `ambiguousNames` afecta al sujeto | `:323-333` |
| `identity-duplicate` | `block` | colisión de UUID relevante | `:175-211` |
| `name-collision` | `block` / `warn` | nombre canónico repetido | `:175-211` |
| `path-collision` | `block` | misma ruta o mismo `cwdKey` | `:175-211` |
| `content-collision` | `warn` | mismo hash con nombres distintos; la relevancia se compara contra el `key` (que es el sha), así que con el detector real no se emite | `:179-188` |
| `assignment-shadowed` | `warn` / `block` | sombra relevante; `block` sólo si `action === 'materialize-project'` | `:190-200` |
| `legacy-collision` | `warn` | entrada legacy relevante | `:175-211` |

`classifyProject` emite además `identity-conflict`, `external-managed`, `legacy-record` y
`availability-unknown` (`lib/projects.mjs:197-239`). **No están en la tabla §4.3 del contrato**
(`_audit/R16-CONTRACT.md:405-423`), que es una lista cerrada de 15 códigos.

## 8. Divergencias medidas

1. **`content-collision` no puede llegar a la decisión con el detector real.** El contrato dice
   `warn` para «mismo sha256 con nombres distintos» (`_audit/R16-CONTRACT.md:416`) y
   `tests/r16-domain.test.mjs:575-592` lo afirma, pero ese test **fabrica** la colisión con
   `key: 'mismo-uno'` (un nombre de skill). El detector real usa el SHA-256 como `key`
   (`lib/collisions.mjs:303`), y `collisionFindings` comprueba relevancia con
   `canonicalSkillName(collision.key)` —que sobre un hash devuelve `null`— o con
   `collision.key === skillId`, que nunca ocurre porque `skillId` es un nombre
   (`lib/preflight.mjs:179-182`). Resultado: la colisión de contenido se descarta siempre y la
   decisión queda `allow`. La sonda `tools/r16-collision-matrix.mjs` lo demuestra: 5/6, con
   `content-collision` esperado `warn/warn` y obtenido `warn/allow`, y sale con código 1.
2. **`identity-duplicate` exige nombres distintos.** El contrato lo define por UUID con contenido
   distinto; el código agrupa por UUID y sólo marca `block` si `names.size > 1`
   (`lib/collisions.mjs:175-213`). Un mismo UUID con el mismo nombre y contenido distinto no se
   reporta.
3. **Cuatro códigos fuera del contrato.** §4.3 no incluye `identity-conflict`, `external-managed`,
   `legacy-record` ni `availability-unknown`, que el clasificador sí emite.
4. **`OPTIONAL` del contrato es más estrecho.** El contrato sólo enumera `register`/`assign`/`enable`
   en `OPTIONAL`; el código declara todas las acciones con `[]` para las demás
   (`lib/preflight.mjs:28-38`). Funcionalmente equivalente, pero la tabla no coincide.
5. **Fichero de test inexistente.** `tests/r16-collision-matrix.test.mjs` no existe; la evidencia
   ejecutable es `tools/r16-collision-matrix.mjs` (creado en esta ronda, 12:15:32) y la prueba de
   dominio.

## 9. Cómo reproducir

```sh
cd lifecode-skill-center
node tools/r16-collision-matrix.mjs          # matriz de las 6 severidades; exit 1 si alguna falla
node --test --test-name-pattern='detectCollisions' tests/r16-domain.test.mjs
node --test --test-name-pattern='preflight' tests/r16-domain.test.mjs
node --test tests/r16-contract.test.mjs
```

A la hora de redactar, la sonda devuelve `5/6` por el punto 1; el resto de la matriz coincide con el
contrato.
