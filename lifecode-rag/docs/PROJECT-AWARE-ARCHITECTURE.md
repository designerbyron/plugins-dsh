# Arquitectura Project-Aware RAG — PA0

**Estado:** especificación cerrada de PA0. **Nada implementado.** No se creó ninguna base de datos, no se
migró ningún almacén y no se instaló nada.
**Base:** LifeCode RAG v0.2.0 (M0—M5), almacén único por instalación.
**Contratos compañeros:** [datos](PROJECT-AWARE-DATA-CONTRACT.md) ·
[sesión](PROJECT-AWARE-SESSION-CONTRACT.md) · [errores](PROJECT-AWARE-ERROR-CONTRACT.md).
**Registro de decisiones:** `plans/PA0-DECISION-REGISTER.md`.

## 1. Decisiones que fija esta arquitectura

| ID | Decisión humana | Consecuencia arquitectónica |
|---|---|---|
| O-PAR-1 | Contrato **v0.3** para ampliaciones; v0.1 congelado | `<scope_id>:<source_id>` es propuesta v0.3, no se implementa; v0.1 no cambia |
| O-PAR-2 | Selección **por sesión** | `session_scope` en el registro; sin selección global; cwd solo como resolución inequívoca |
| O-PAR-3 | Bibliotecas **anidadas prohibidas** | Solo `Proyecto —  Biblioteca`; grants directos; sin herencia transitiva |
| O-PAR-4 | **Un registro por perfil** | Registro y ámbitos bajo la raíz de datos del perfil; sin acceso cruzado |
| O-PAR-5 | `missing` automático **sin borrado** | `sync_state` separa `present` / `missing` / `unreadable`; olvido definitivo sigue exigiendo aprobación |
| O-PAR-6 | Máximo **8 ámbitos** por consulta | 1 proyecto + hasta 7 bibliotecas; `scope-too-many` antes de abrir almacenes |
| C7 | Auditoría **por ámbito** | Registro audita registro/grants/sesiones; cada ámbito audita lo suyo; sin `audit.jsonl` global |
| C8 | Ciclo de vida de sesión formal | Contrato de sesión completo; la selección no la crea el modelo |

## 2. Modelo

```
Perfil DSH
———— registry.sqlite3                      proyectos, raíces, bibliotecas, grants,
    —                                     session_scope, sync_state, auditoría del registro
    ———— scopes/
        —S——— prj_<ULID>/rag.sqlite3        conocimiento del proyecto + auditoría propia
        ———— lib_<ULID>/rag.sqlite3        conocimiento de la biblioteca + auditoría propia
```

- **Proyecto**: unidad de trabajo y de aislamiento. Tiene una o más raíces autorizadas.
- **Biblioteca**: conocimiento compartido entre proyectos del **mismo** registro mediante grants.
- **Ámbito** (`scope`): la unidad que se abre para recuperar. Es un proyecto **o** una biblioteca, nunca una
  mezcla.
- **Grant**: permiso de lectura directo `proyecto —  biblioteca`, concedido por una persona o por el host.
- **SyncState**: estado observado de una fuente dentro de una raíz; no es una orden de borrado.

La separación física de almacenes es deliberada: el aislamiento se comprueba **abriendo solo los ficheros
permitidos**, no filtrando filas con un `WHERE`. Un error de consulta no puede alcanzar datos de otro
proyecto porque no tiene su fichero abierto.

## 3. Almacenamiento

### 3.1 Registro

Un `registry.sqlite3` por perfil. Contiene proyectos, raíces, bibliotecas, grants, selecciones de sesión,
estado de sincronización, operaciones coordinadas y la auditoría del registro. Su SQL normativo está en el
[contrato de datos](PROJECT-AWARE-DATA-CONTRACT.md) §3.

### 3.2 Almacenes de ámbito

Cada proyecto y cada biblioteca tienen su `rag.sqlite3` con el esquema v3 de v0.2 (fuentes, chunks, FTS5
externa, vectores, auditoría encadenada) **más** las claves de identidad en `meta`: `scope_id`, `scope_kind`,
`profile_id`, `schema_version`, `migration_version`, `store_state`, `created_at`.

Antes de leer contenido se comprueba: que el `scope_id` del fichero coincide con el solicitado, que el
`profile_id` es el del registro, que `store_state='ready'` y que la versión de esquema es la soportada. Si no,
`scope-store-corrupt` o `scope-forbidden`; nunca se "abre igualmente".

### 3.3 Ubicación

PA0 **no inventa** una ruta física. El contrato es abstracto (`<profile_data_root>/lifecode-rag/⬦`) y su
resolución real se verifica en PA1. `LIFECODE_RAG_ROOT` sigue siendo un override explícito de desarrollo y,
si se usa, el perfil se registra para impedir mezclas.

## 4. Identidad y rutas

Reglas completas en el [contrato de datos](PROJECT-AWARE-DATA-CONTRACT.md) §5. Resumen:

- ULID con prefijo (`prj_`, `lib_`, `rt_`, `op_`), nunca derivados de nombre o ruta.
- Ruta canónica con `realpathSync.native`; `path_key` plegada a minúsculas en Windows y **única global**.
- Rechazo de symlinks, junctions, reparse points, hardlinks de fichero y traversal.
- Raíces solapadas dentro del mismo proyecto —  `root-overlap`; no se elige una.
- Archivar no borra; borrar exige operación humana con aprobación y copia.

## 5. Sesión y resolución de ámbito

Contrato completo en [sesión](PROJECT-AWARE-SESSION-CONTRACT.md). Resumen normativo:

1. La identidad de sesión la aporta el host (`Session.id`); el plugin no la inventa.
2. La selección vive en el registro del perfil y sobrevive al reinicio.
3. Sin selección, el cwd puede resolver **solo** si coincide con exactamente una raíz registrada de un
   proyecto activo; si no, `scope-unresolved` / `scope-ambiguous`.
4. Nunca hay proyecto por defecto, último usado ni "el primero".
5. Un clon de sesión no hereda la selección.
6. Cambiar de proyecto en una sesión no afecta a las demás.

## 6. Bibliotecas y grants

- Permitido: `Proyecto —  Biblioteca` con grant directo y explícito.
- Prohibido: biblioteca dentro de biblioteca, proyecto dentro de biblioteca, proyecto— proyecto por grants,
  herencia transitiva. El esquema lo hace imposible (no existe `parent_*`).
- Los grants los crea una persona o el host; **nunca** una herramienta del modelo.
- **Punto único de autorización:** al inicio de cada consulta se resuelven sesión y proyecto, se leen los
  grants vigentes y se forma la **instantánea de autorización** (proyecto + bibliotecas permitidas). Esa
  instantánea es la que decide qué almacenes se abren; no se vuelve a consultar el registro a mitad.
- **Revocación durante una consulta:** los ámbitos ya abiertos terminan su recuperación local (la instantánea
  los autorizó); los ámbitos aún no abiertos se omiten con `grant-revoked`. En ambos casos la respuesta se
  marca `partial: true` con el error en `errors[]`; nunca se presenta éxito limpio.
- **Consultas posteriores:** la revocación es efectiva de inmediato; la biblioteca ya no entra en la
  instantánea y no se abre.
- Límite: 1 proyecto + 7 bibliotecas = **8 ámbitos**; se comprueba tras verificar grants y **antes** de abrir.
  Si se supera: `scope-too-many`; no se truncan bibliotecas ni se degrada a búsqueda global.

## 7. Recuperación entre ámbitos

Algoritmo normativo:

1. Resolver la sesión (`session-invalid` si no hay identidad).
2. Resolver el proyecto activo (selección —  cwd —  error).
3. Leer grants vigentes del proyecto.
4. Ordenar y aplicar el límite de 8; si se supera, `scope-too-many`.
5. Abrir **exclusivamente** los almacenes permitidos, verificando identidad y `store_state`.
6. Ejecutar la recuperación local de cada ámbito (FTS5 BM25 + vector + RRF interno de v0.2).
7. Fusionar los rankings de cada ámbito con RRF (k=60), pesos configurables.
8. Aplicar MMR sobre los candidatos fusionados.
9. Aplicar el presupuesto global de contexto.
10. Devolver resultados con procedencia completa.

Cada resultado conserva: `scope_kind`, `scope_id`, `source_id`, `uri`, `chunk_key`, `sha256`, `indexed_at`,
además de `score`, `rrf`, `snippet`.

**La fusión es de rankings separados, no un BM25 global.** Los `bm25` de almacenes distintos no son
comparables; solo se usa su orden dentro de cada ámbito. Esto se documenta para no vender una comparabilidad
inexistente.

Casos:

- Almacén del proyecto inaccesible —  falla la consulta (`scope-store-unavailable`): sin proyecto no hay
  contexto válido.
- Biblioteca inaccesible/corrupta —  **falla la consulta** (`scope-store-unavailable` / `scope-store-corrupt`
  con `details.scopeId`). Decisión D-PA4-F-01: el contrato v0.1 no puede expresar «resultado parcial», así
  que no se devuelve un resultado que parezca exhaustivo sin serlo.
- Duplicados entre ámbitos (mismo `sha256` y rango) —  se conserva uno y se anota `also_in[]` con los ámbitos
  restantes; no se duplica el contexto.
- Grant revocado durante la consulta: se aplica la garantía de PA4 (§17.2) — se revalida en puntos de control
  y, si un ámbito autorizado deja de estarlo antes de devolver, la operación falla con `grant-revoked` y **no
  entrega** nada de ese ámbito. La consulta siguiente ya no incluye la biblioteca.

Efecto del límite de 8 (medido en `eval/quality-hardening/TEST-RESULTS.md`; reconciliado 2026-11-18):
la latencia crece de forma aproximadamente lineal con el
número de almacenes abiertos; la memoria suma cachés de SQLite; el presupuesto de contexto se reparte entre
más ámbitos. La medición corresponde a PA3.

## 8. Sincronización

Implementado en PA5 (`lib/sync.mjs`, `lib/sync-scheduler.mjs`, CLI `sync run|status`) y probado localmente.

### 8.1 Ciclo por proyecto y raíz

1. Comprobar que la raíz está autorizada y accesible (`assertScopeSyncable`: ámbito activo, al menos una raíz
   autorizada; si la pasada la inicia una sesión, su autorización vigente también se revalida).
2. Recorrerla de forma completa (si no se puede completar, error de sincronización y **no** se marca `missing`).
3. Comparar metadatos y hash con `sync_state` (y con `sources.sha256` como respaldo).
4. Ingerir de forma incremental, una transacción por fichero.
5. Registrar errores por fichero sin abortar el resto.
6. Actualizar `present` / `missing` / `unreadable`.
7. Respetar el límite por pasada y la cancelación entre ficheros.
8. Verificar el almacén tras aplicar (recuentos, huérfanos, vectores, FTS5) y fallar con
   `scope-store-corrupt` si quedó incoherente.
9. Registrar en auditoría del ámbito (`sync.run`) y del registro (`sync.run`, `sync.tick`) lo que corresponda,
   y dejar el ciclo en `operations`/`operation_steps` (`kind='sync'`: `observe`, `apply`, `verify`).

Una pasada interrumpida deja la fila `started`; la siguiente la cierra como `reconciled` sin repetir trabajo
(la sincronización es idempotente por hash, pero la fila no puede quedar mintiendo).

### 8.2 Estados y olvido

| Estado | Significado | ¿Borra? |
|---|---|---|
| `present` | Observado y con hash | No |
| `missing` | Observación **completa** de la raíz no lo encuentra | **No**; conserva fuentes, chunks, vectores, auditoría y grants |
| `unreadable` | Error de permisos, E/S o recorrido incompleto | No; no se interpreta como desaparición |
| Olvido definitivo | Acción humana aprobada | Sí, con la autorización existente de `forget` |

Reaparición: si el hash coincide, se restaura `present` sin duplicar; si cambió, se reindexa de forma
incremental. Un `missing` no revoca grants. Un renombrado se ve como `missing` del nombre viejo más alta del
nuevo (misma URI distinta); no se intenta adivinar renombrados por inodo.

### 8.3 Programación (límite declarado)

La automatización se activa con `automation.enabled` en `config.json` y usa el temporizador de Node
(`setInterval` con `unref`), que es lo único que existe en este entorno. **No** se asume ningún hook, evento ni
temporizador de DeepSeek Harness: comprobarlo y, si existe algo mejor, integrarlo corresponde a PA6. Mientras
tanto, el ciclo se ejecuta también a mano con `node bin/lifecode-rag.mjs sync run`.

## 9. Auditoría por ámbito (C7)

Estructura normativa:

- `registry.sqlite3`: auditoría del registro (perfil, proyectos, raíces, bibliotecas, grants, sesiones,
  migraciones, operaciones coordinadas).
- `scopes/prj_<id>/rag.sqlite3`: auditoría propia del proyecto (ingesta, olvido, reindexación, consultas que
  se registren, errores).
- `scopes/lib_<id>/rag.sqlite3`: auditoría propia de la biblioteca.

**No hay `audit.jsonl` global** que contradiga el aislamiento. Si se exporta JSONL, es por almacén y derivado.

Campos por evento (en cada almacén): `seq` (auto), `at`, `actor` (`human|host|model|automation`),
`session_id`, `action`, `target`, `outcome` (`ok|failed|denied|skipped`), `detail`, `prev_hash`, `hash`.

Cada almacén tiene su propia cadena; una cadena rota se detecta al abrir y produce `scope-store-corrupt` (o
`registry-corrupt`). No se repara sola.

**No hay atomicidad entre varios almacenes.** Las operaciones que tocan registro + ámbito (migración,
creación de ámbito, borrado con copia) se registran como **operaciones coordinadas** en
`operations(id, kind, state, started_at, finished_at, detail)` con estados `started —  committed | failed |
reconciled`, y sus pasos en `operation_steps(operation_id, step, state, effect_key, updated_at)`.

Reconciliación (normativa, sin ejecutarse en PA0):

1. **Detección:** al abrir el registro, toda fila `operations.state='started'` es una operación incompleta. No
   se ignora ni se borra: bloquea las operaciones nuevas hasta reconciliarse (o se reconcilia en la misma
   apertura, según PA1).
2. **Identificación de efectos:** cada paso tiene `effect_key` (por ejemplo `scope:prj_⬦:created`); antes de
   repetirlo se comprueba si el efecto ya existe. Las comprobaciones son de solo lectura.
3. **Idempotencia:** los pasos repetibles (crear directorio, copiar fichero verificado por hash, escribir
   metadatos) se reejecutan solo si su `effect_key` no está aplicado. Los pasos no idempotentes (borrar,
   mover) no se repiten a ciegas: si su estado es dudoso, la operación pasa a `failed` y se restaura desde la
   copia.
4. **Rollback:** si el paso fallido no puede completarse, se descarta lo nuevo y se conserva el original; el
   rollback también registra pasos y su propio `effect_key`, para que sea repetible.
5. **Cierre:** la operación termina en `committed` (todos los pasos `done`), `failed` (rollback aplicado) o
   `reconciled` (interrupción resuelta sin rollback). Cada transición escribe auditoría en el registro.
6. **Evidencia:** el `detail` guarda ids, hashes y códigos; nunca contenido de documentos.

Un fallo a mitad deja estado parcial explícito; no se presenta como transacción única.

La auditoría no guarda prompts, respuestas completas ni contenido sensible de documentos; solo referencias
(ids, rutas relativas, hashes, códigos).

## 10. Errores

Contrato completo en [errores](PROJECT-AWARE-ERROR-CONTRACT.md): familias selección/autorización/integridad/
infraestructura/sincronización y 16 códigos, incluidos `scope-*`, `registry-*`, `scope-store-*`,
`session-*`, `grant-revoked` y `sync-root-unavailable`. Regla: nunca un error de seguridad convertido en
resultado vacío.

## 11. Compatibilidad y versionado

- Las **siete herramientas v0.1 no cambian**: mismos nombres, parámetros, salidas y semántica de `collection`.
- No se añaden parámetros a v0.1; el ámbito se resuelve internamente.
- `<scope_id>:<source_id>` es una **propuesta para v0.3**, no implementada. Cambia la forma de una referencia
  pública y por eso no puede colarse como compatible.
- v0.3 exigirá contrato propio, pruebas de compatibilidad y autorización posterior. PA0 no lo implementa ni
  afirma compatibilidad.
- El almacén v3 de v0.2 se conserva como formato de cada ámbito; no se cambia el esquema dentro de PA0.

## 12. Migración desde el almacén único v0.2 (solo especificación)

No se ejecuta en PA0. Pasos obligatorios para PA1:

1. **Inspección** del almacén v0.2 existente (apertura en solo lectura, `integrity_check`, recuentos).
2. **Copia de seguridad** verificada (hash) fuera del almacén operativo.
3. **Validación** de integridad de la copia.
4. **Recuentos** de `sources`, `chunks`, `vectors`, eventos de auditoría; comparación posterior.
5. **Creación explícita** de un proyecto por defecto (nombre y raíz confirmados por una persona).
6. **Autorización humana** de las raíces que se registrarán; ninguna raíz se deduce del contenido.
7. **Copia** de fuentes/chunks/vectores hacia el almacén del proyecto, conservando `chunk_key` y hashes.
8. **Verificación de igualdad** (criterios obligatorios, todos deben cumplirse): recuentos exactos de
   `sources`, `chunks`, `vectors` y eventos de auditoría; igualdad de `sha256` por fuente; igualdad del hash
   canónico del texto concatenado por `chunk_key`; `PRAGMA integrity_check` = `ok` en el destino; FTS con
   `integrity-check` = `ok` y mismo número de coincidencias de una consulta de control; cadena de auditoría
   verificada de extremo a extremo; `schema_version`/`application_id` coherentes. Cualquier diferencia — 
   rollback, no "aceptar casi igual".
9. **Conservación del original**; no se borra ni se mueve.
10. **Rollback** documentado: si falla la verificación, se descarta el almacén nuevo y se sigue usando el
    original intacto.

La migración no crea bibliotecas ni grants por su cuenta. Un almacén migrado queda con auditoría propia
iniciada y una entrada de operación `migrate` en el registro.

## 13. Lo que PA0 NO afirma

- En PA0 no estaba implementado: ni registro, ni ámbitos, ni resolución, ni grants, ni sincronización.
  (PA1 implementó registro y migración; PA2, identidad de sesión, `session_scope`, resolución y grants.)
- La matriz mantiene **0 PASS en host**; lo probado en PA1/PA2 es local, con raíces temporales.
- La ruta por perfil está resuelta en PA1, pero el perfil real se instaló en M6 **sin registro Project-Aware**: no se inventó proyecto ni raíz (reconciliado 2026-11-18).
- El temporizador permanente no está probado en el host.
- La inyección automática previa a la respuesta sigue **BLOCKED** por falta de hook del host.
- No se ha abierto, creado, migrado ni movido ningún almacén operativo.

## 14. Riesgos residuales

| Riesgo | Mitigación declarada |
|---|---|
| Escribir datos del plugin en una raíz de perfil no verificada | Contrato abstracto + verificación en PA1; override explícito para desarrollo |
| Crecimiento de latencia con 8 ámbitos | Presupuesto medido en PA3; límite duro y error explícito |
| Deriva entre registro y almacenes | Operaciones coordinadas + reconciliación + `integrity_check` |
| Complejidad de sesiones (clonado, reinicio) | Contrato de sesión con casos de prueba obligatorios en PA2 |
| Migración destructiva | Copia, verificación, conservación del original y rollback |
| Falsa sensación de semántica | El proveedor por defecto sigue siendo léxico; la matriz lo declara |

## 15. Decisiones abiertas para PA1/PA3

- **O-PA0-1**: **cerrada** en el contrato de datos §3: una única tabla `roots`, con la pertenencia garantizada
  por `CHECK` de prefijo, disparadores de existencia/inmutabilidad y una **FK compuesta** desde `sync_state`
  que fija el ámbito de cada fila al de su raíz. El borrado de ámbitos con raíces queda bloqueado por
  disparador (`scope-has-roots`).
- **O-PA0-2**: **resuelta en PA1** con un mapeo verificable y sin rutas inventadas: `LIFECODE_RAG_ROOT`
  (anulación explícita) o `$DSH_HOME/lifecode-rag/profiles/<profileKey>/`, donde `profileKey` sale de
  `DSH_PROFILE` o del nombre de `DSH_PROFILE_DIR` (nunca de una ruta fija). Comprobado en el entorno real:
  `DSH_HOME` y `DSH_PROFILE_DIR` existen; `$DSH_HOME/lifecode-rag` no existe, así que **no se creó ningún
  registro en el perfil real** en PA1 (M6 no autorizado). La creación se probó con raíces temporales idénticas
  en esquema (`lib/profile.mjs`, `tests/registry.test.mjs`).
- **O-PA0-3**: retención de filas `session_scope` expiradas (propuesta: 90 días).
- **O-PA0-4**: transiciones válidas de `store_state` y quién puede moverlas.
- **O-PA0-5**: presupuesto de latencia y memoria para 8 ámbitos.

## 16. Estado de implementación (PA1 + PA2 + PA3)

| Pieza | Módulo | Estado |
|---|---|---|
| Raíz de perfil y rutas | `lib/profile.mjs` | Implementado, probado local |
| Registro (proyectos, bibliotecas, raíces, auditoría) | `lib/registry.mjs`, `lib/registry-schema.mjs` | Implementado, probado local |
| Migración reversible del almacén único | `lib/migrate.mjs` | Implementado, probado local (origen intacto) |
| Identidad de sesión | `lib/session-identity.mjs` | Implementado; `agent.id` + perfil; sin host real |
| Selección por sesión y ciclo de vida | `lib/sessions.mjs` | Implementado, probado local |
| Resolución fail-closed | `lib/resolve.mjs` | Implementado, probado local |
| Grants y límite de 8 ámbitos | `lib/sessions.mjs` | Implementado, probado local |
| Apertura de almacenes de ámbito y recuperación multi-ámbito | `lib/scope-stores.mjs`, `lib/scope-ops.mjs` | Implementado, probado local |
| Contexto de ejecución autorizado de las siete herramientas | `lib/exec-context.mjs` | Implementado, probado local; identidad de host real no ejercitada |
| Integración de las siete herramientas con el dominio | `lib/tools.mjs` | Implementado; contrato v0.1 sin cambios |
| Sincronización incremental | PA5 | **implementada y probada localmente** (reconciliado 2026-11-18) |

El adaptador de identidad es el único punto que depende de la forma de `Agent`; si el host cambia
`agent.id`, se ajusta ahí y el resto del dominio no cambia. La resolución **no** abre almacenes: devuelve
la selección efectiva con sus raíces y `withAuthorizedContext` decide qué abrir, en qué orden y qué
errores son parciales.

### 16.1 Integración PA3 (siete herramientas)

| Herramienta | Ámbitos | Escritura | Regla |
|---|---|---|---|
| `ingest` | sólo proyecto | sí | expande y clasifica antes de abrir; aprobación si la ruta cae fuera de las raíces del proyecto |
| `search` | proyecto + bibliotecas concedidas | no | agrega por `score`; si un ámbito autorizado no se puede consultar, la operación falla en cerrado (PA4-F) |
| `context` | proyecto + bibliotecas concedidas | no | mismo conjunto; presupuesto y MMR globales; citas con `scopeId`/`scopeKind` internos |
| `get` | todos los efectivos | no | `ref` debe resolver en **un** ámbito; 0 —  `source-not-found`, —0—2 —  `ambiguous-ref` |
| `list` | sólo proyecto | no | una biblioteca no se enumera como si fuera del proyecto |
| `forget` | sólo proyecto | sí | nunca borra una biblioteca; si `ref` vive allí —  `library-read-only`; aprobación con fuente y ámbito exactos |
| `reindex` | sólo proyecto | sí | reconstruye FTS/vectores del proyecto; aprobación siempre |

Cada `execute` pasa por `withAuthorizedContext`, que exige `exec.agent`, valida el perfil, resuelve la
sesión y los ámbitos, abre el registro y sólo entonces permite `ctx.open(scope)`. No hay ruta alternativa
que abra un almacén: `lib/tools.mjs` no importa `openDatabase` desde PA3.

## 17. PA4 — robustez operativa, revocación y recuperación

PA4 añade cuatro mecanismos al camino de ejecución, sin cambiar el contrato público v0.1.

### 17.1 Estados de almacén y recuperación

`lib/library-state.mjs` clasifica cada almacén antes de usarlo, en sólo lectura y sin crear ni migrar:

| Estado | Cómo se detecta | ¿Se puede servir? |
|---|---|---|
| `present` | fichero, `application_id`, versión e identidad correctos | sí |
| `missing` | no existe el directorio o el fichero | no (nunca equivale a «vacío») |
| `unreadable` | EACCES/EPERM, o la ruta es un enlace | no; no se cuarentena a ciegas |
| `corrupt` | no es SQLite, `quick_check`/`foreign_key_check` falla, identidad incoherente | no |
| `unavailable` | bloqueado por otra conexión, o `store_state='migrating'` | no, pero reintentable |
| `recovering` | hay un staging `.recovery-*` en curso | no |
| `recovered` | marcado tras una recuperación verificada | sí |

`lib/recovery.mjs` planifica (`none|blocked|rebuild|reinit`) y ejecuta en un directorio **staging**:
copia las tablas autoritativas (`sources`, `chunks`, `source_tags`, `audit`; también `metrics_daily` y
`policies`), regenera vectores (sólo con el embedder local determinista: con un proveedor remoto la
recuperación se rechaza en vez de pedir red), reconstruye FTS5 y lo comprueba, añade la entrada de auditoría
de la recuperación y **verifica la cadena ya con esa entrada**, compara digest de datos y recuentos, y sólo
entonces hace el intercambio: el original pasa a `<scopeDir>.quarantine-<stamp>` y el staging ocupa su sitio.
`rollbackRecovery` aparta el intento fallido a `.failed-<stamp>` y restaura la cuarentena. Nada se borra.

### 17.2 Revocación efectiva (garantía y latencia)

La autorización es una **instantánea** al abrir el contexto, y `ctx.revalidate()` la refresca en puntos
declarados: antes de abrir cada ámbito, antes de cada fichero de una ingesta, y **antes de devolver** el
resultado de `search`, `context`, `get`, `list`, `forget` y `reindex`. Si en ese punto un ámbito ya no está
autorizado, la operación falla con `grant-revoked` (`details.reason: 'revoked-during-operation'`) o con
`session-expired`/`scope-forbidden` y no devuelve nada.

**Latencia real:** la revocación se percibe como máximo en el siguiente punto de control, es decir al
terminar la consulta en curso o el fichero en curso. Un `embed` remoto lento o una consulta FTS larga no se
interrumpen desde otra conexión; SQLite no ofrece cancelación cruzada. La garantía es «no se entrega
resultado de un ámbito revocado», no «la consulta se aborta en el acto». `exec.signal` se comprueba en los
mismos puntos y en el bucle de vectores: una cancelación del host sí corta entre chunks.

**Límite de atomicidad:** lo ya confirmado no se revierte. Una ingesta de dos ficheros que pierde el grant en
el segundo deja el primero indexado (auditado como `ingest`) y no escribe el segundo; el error `grant-revoked`
lo declara. Repetir un efecto destructivo con resultado incierto está prohibido por `operation-uncertain`.

### 17.3 Raíces: protección estructural

`lib/roots-structure.mjs` canonicaliza con `realpathSync.native` (no sólo normalizando la cadena), rechaza
enlaces/junctions/reparse points (`root-symlink`), detecta duplicados y solapes padre/hijo al registrar
(`root-overlap`) y revisa las raíces ya registradas en `registryIntegrity` (`rootConflicts`). `addRoot`
valida antes de insertar, y `path_key` guarda la ruta canónica. `assertRootUnchanged` detecta que el destino
real cambió después del registro (`root-changed`).

**Límites declarados:** Node no distingue junction de enlace de directorio (`lstat.isSymbolicLink()` es
`true` en ambos), así que se rechazan los dos; un symlink de directorio requiere Developer Mode en Windows y
la prueba usa junctions. Los reparse points de proveedor (OneDrive/DFS) no son identificables con la API de
Node: se mitiga comparando la ruta canónica en cada uso y fallando en cerrado, no pretendiendo detectarlos.

### 17.4 Operaciones interrumpidas y retención

`lib/operations.mjs` usa el ledger PA0: `started` al empezar, pasos con `effect_key` idempotente, cierre
`committed` sólo si todos los pasos están `done` (si no, `operation-uncertain`). `assertNoInterruptedOperation`
bloquea repetir un efecto destructivo cuyo resultado se desconoce; `reconcileInterruptedOperations` **sólo
cierra la fila** con la conclusión documentada y nunca reejecuta el trabajo. La recuperación escribe su
operación `recovery` con pasos `inspect|stage|verify|swap`.

`lib/retention.mjs` es un **planificador** sin ninguna función de borrado: calcula candidatos
(`session_scope` expiradas, operaciones cerradas, métricas diarias) y lo que está protegido (sesiones activas,
operaciones abiertas, auditoría del registro), y exporta cortes verificados de la auditoría a JSONL con su
`sha256`. No se compacta ni se elimina auditoría en PA4.

### 17.5 Concurrencia medida (ocho ámbitos, host local Windows)

Windows 11, Node 24.21.0, SQLite 3.53.4, WAL, `busy_timeout=5000`, `synchronous=FULL`. Medido en
`lifecode-rag/tests/concurrency.test.mjs` (repetible con `node --test tests/concurrency.test.mjs`):

| Medida | Valor observado | Umbral de la prueba |
|---|---|---|
| Resolución de 8 ámbitos | —0—7—8 ms | < 500 ms |
| `search` sobre 8 ámbitos | —0—36—37 ms | < 4000 ms |
| Escritura bloqueada por otra conexión | falla como `store-busy` reintentable tras `busy_timeout` | < 20 s |
| Fuga de conexiones | 8/8 directorios borrables tras cerrar | sin excepciones |

Los umbrales son de regresión, no objetivos de producto: se fijan muy por encima de lo medido para detectar
un cambio de orden de magnitud (una apertura por ámbito que pase de perezosa a eager, un N+1 de consultas),
no para afirmar un rendimiento.

---

## 18. PA6 — integración con el host real

Esta sección fija con qué interfaces del host cuenta la integración y cuáles **no** existen en esta
instalación. Todo lo afirmado aquí está verificado contra DeepSeek Harness `0.2.2-rc.3`
(`cordis_inspect_query` y la documentación dentro de `app.asar`), no supuesto.

### 18.1 Interfaces verificadas

| Capacidad | Interface |
|---|---|
| Identidad de sesión | `Agent.id: SessionId`, disponible en `agent/pre-step` y en `ToolRunContext.agent` |
| Directorio de trabajo | `workingDirectory.get(session)`, `.ensure(agent, signal)`, `.set(agent, path, signal)` |
| Herramientas | `ctx.tools.register(definition)` (devuelve disposer); `ToolRunContext` con `callId`, `agent`, `signal` |
| Cancelación | `exec.signal` / `payload.signal` (AbortSignal) |
| Aprobaciones | `approval.request({agent, toolName, callId, reason, signal})` —  `allowed-once` \| `rejected` \| `cancelled` \| `unavailable` |
| Temporizador | `ctx.timer.interval(callback, delay)` —  disposer |
| API del Workspace | `webServer.register({kind:'prefix', path, handler})` |
| Eventos | `agent/created`, `agent/pre-step`, `agent/turn-stopping`, `tools/pre-execute`, `tools/post-execute` |

### 18.2 Contexto antes de la respuesta

El plugin usa `agent/pre-step` porque es el único punto que **entra en la petición en curso** y trae
identidad de sesión. `agent.inject()` está documentado como «next pre-step» y puede perderse la
petición actual (`docs/subsystems/core.md:135-143`); `ctx.systemPrompt.context()` sólo recibe
`{scope, signal}`, sin sesión, y no permite resolver el ámbito sin inventar correlación.

Reglas del hook:

- sólo `payload.step === 1`, y sólo si el último mensaje es un prompt humano (`source.kind === 'user'`);
- dedupe por `(sessionId, turn, digest)` con 64 turnos por sesión, sin estado compartido entre sesiones;
- puerta léxica antes de recuperar: `searchScopes(..., {limit:1, strategy:'fts'})`; sin coincidencia
  léxica no se construye contexto;
- el mensaje es `{id: uuid, role:'user', content:[{type:'text',text}], source:{kind:'lifecode-rag', form:'recall'}}`,
  construido sin importar `@deepseek-ai/*`;
- cualquier error se captura: el turno continúa sin contexto.

`config.autoContext` nace **desactivado** (`enabled:false`) para no alterar el comportamiento público
v0.1 de forma silenciosa; al activarlo, `budgetTokens` no puede superar el presupuesto de `context`.

### 18.3 Bridge de hooks Claude-Code

No está operativo en esta instalación: `include:hooks-claude-code` aparece `enabled:true` con
`fiberPhase:null`, y en un perfil gestionado por CLI falla al importar
(`ERR_MODULE_NOT_FOUND`). No se instala ni se emula; si el usuario lo activa en el futuro, convivirá
con `agent/pre-step` sin duplicar, porque el estado de dedupe es por sesión y turno.

### 18.4 Programación de la sincronización

`index.js` obtiene `ctx.get('timer')` y pasa `interval = (cb, ms) => timer.interval(cb, ms)` a
`createSyncScheduler`. El planificador usa `setInterval(...).unref()` únicamente cuando no hay host.
`statusSnapshot().timer` distingue `host:ctx.timer.interval` de `node:setInterval`, así que la
diferencia es observable y no se declara como si fuera lo mismo.

### 18.5 Ciclo de vida y convivencia con v0.2

La automatización del almacén único v0.2 sólo se monta si `rag.sqlite3` ya existe en la raíz del
perfil (`existsSync(storePaths(root).database)`): un perfil Project-Aware nuevo no recibe un almacén
legado vacío y no compite con la sincronización por ámbitos.

### 18.6 Lo que PA6 no afirma

- No hay verificación con turno real del modelo: el CLI no tiene credencial
  (`MISSING_CREDENTIAL`) y exportarla usaría el secreto del usuario fuera de su store. Esa prueba se
  ejecuta en M6 sobre el perfil de la aplicación.
- El tick del temporizador dentro del escritorio y la cancelación real del host se verifican en M6.
- El bridge de hooks Claude-Code no existe aquí; no se declara como integrado.

## 19. Hardening de calidad (2026-11-18)

Revisión integral de PA0–PA6/M6 con auditoría delegada y correcciones con regresión. Decisiones que
cambian contratos internos (ADR en `eval/quality-hardening/AUDIT-REPORT.md`):

- **D-PA6-09 — una sola raíz de datos.** Las herramientas y el programador de sincronización usan
  `profileRoot(env)`; la raíz heredada (`ragRoot`) queda sólo para la automatización v0.2 y su API,
  que además sólo se registra si existe el almacén legado. Antes, el scheduler buscaba el registro en
  la raíz legada y la API servía otro almacén que las herramientas.
- **D-PA6-10 — presupuesto del contexto automático.** `autoContext.timeoutMs` (2 000 ms por
  defecto, 100–15 000) y carrera con `signal`: el hook abandona y devuelve `null` en vez de
  bloquear el turno. El trabajo abandonado termina por su propio timeout; es un límite declarado.
- **D-PA6-11 — sin egreso desde el hook.** El contexto automático sólo usa `local-hash-v1`; con
  proveedor remoto degrada a FTS y MMR local. El egreso sigue exigiendo aprobación por llamada en las
  herramientas.
- **D-PA5-A-13 — `sync_state` se publica después de ingerir.** Antes se marcaba `present` dentro
  del callback de autorización: un corte dejaba el hash nuevo sin fuente y la pasada siguiente lo
  trataba como «sin cambios». El resultado se reconcilia con el almacén si la ingesta se interrumpe.
- **D-PA4-C-06 — identidad de perfil inyectiva.** `profileKey` añade un sufijo `sha256` cuando el
  saneado pierde información; dos perfiles no pueden compartir directorio, registro ni auditoría.
- **D-PA0-11 — auditoría del registro transaccional.** `appendRegistryAudit` escribe cabeza, hash,
  evento y `meta` dentro de una transacción `IMMEDIATE`; dos conexiones ya no rompen la cadena.

Límites vigentes: la revocación no es instantánea (se garantiza en los puntos de control), el
contexto automático no se ha ejercitado con datos reales, y la programación periódica se verificó con
el temporizador del host inyectado, no con un tick observado en producción.

## 20. M6.7 — sincronización periódica controlada

El programador Project-Aware vive en `lib/sync-scheduler.mjs` y sólo se apoya en el temporizador del
host: `ctx.timer.interval(callback, delay)`. Dentro del host no hay respaldo a `setInterval` global,
porque un intervalo global sobrevive al teardown del plugin y seguiría escribiendo después de una
recarga. Si el servicio `timer` no existe, `start()` devuelve `{started:false, reason:'no-timer'}` y
`status().lastError` lo refleja; nunca se finge un programador activo.

### 20.1 Política efectiva

| Parámetro | Valor | Límite | Por qué |
|---|---:|---|---|
| `intervalMs` | 900 000 (15 min) | 5 000–3 600 000 | cadencia operativa |
| `tickBudgetMs` | 2 000 | 250–120 000 | el tick corre en el proceso del host |
| `maxFilesPerRun` | 25 | 1–1 000 | pasada acotada y reanudable |
| Ámbitos | `activeSyncScopes` del perfil | — | sólo proyectos y bibliotecas activos |
| Concurrencia | 1 por ámbito | — | guarda `running` + `skippedTicks` |
| Reintentos | 0 inmediatos | — | backoff exponencial hasta 8 intervalos |

### 20.2 Presupuesto y finalización

El presupuesto se comprueba **entre ficheros** (`authorize` lanza `cancelled` con
`details.reason = 'budget-exhausted'`), nunca dentro de una transacción: lo confirmado queda y lo no
empezado no se marca. `summary.stop_reason` ∈ `complete | file-limit | budget | cancelled | error`, y
`summary.outcome` ∈ `ok | partial | skipped | failed`. El ledger escribe `committed` cuando hay efectos
confirmados aunque la pasada sea parcial —alcanzar el límite o el presupuesto no es un fallo— y
`failed` sólo con error real o cancelación; `detail.complete` conserva la distinción.

### 20.3 Exclusiones por nombre (M6.7 §5.1)

`lib/policy.mjs#isSensitiveName` añade una defensa en profundidad por patrón de nombre
(`.env*`, `*.pem|key|pfx|p12|jks|keystore`, `id_rsa`, `secrets.*`, `credentials.*`, `.npmrc`,
`.netrc`, `.pgpass`). Se excluye **antes de leer** y se cuenta como `sensitive`; no se marca
`unreadable` ni se reintenta. No sustituye a la medición de M6.5 ni es un gestor de secretos: es una
lista corta, comparada en minúsculas y sin mirar contenido.

### 20.4 Observabilidad

`status()` devuelve `enabled`, `running`, `ticks`, `skippedTicks`, `lastTickAt`, `nextTickAt`,
`starts`, `stops`, `timerType` (`host` o `node`) y `effective` (intervalo, presupuesto y límite).
La auditoría `sync.tick` guarda recuentos (`unsupported`, `sensitive`, `partial`, `budget_exhausted`,
`budget_ms`, `max_files`) y `sync.run` el resultado por ámbito. No se registra contenido.
`bin/lifecode-rag.mjs sync report` lee esas entradas del registro sin abrir los almacenes.

### 20.5 Lo que M6.7 no cambia

Contrato público v0.1.0 intacto (siete herramientas, mismas firmas y salidas). `autoContext` sigue
apagado por defecto. La sincronización periódica no ejecuta `forget`, no borra fuentes `missing` y no
crea proyectos, raíces ni grants.
