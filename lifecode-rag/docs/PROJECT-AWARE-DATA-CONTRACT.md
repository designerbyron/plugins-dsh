# Contrato de datos — Project-Aware RAG (PA0)

**Estado:** especificación documental. **No ejecutada.** Ninguna base de datos se creó ni se migró.
**Base:** LifeCode RAG v0.2.0 (esquema v3 por almacén único).
**Ámbito:** PA0. La implementación corresponde a PA1 (registro y migración) y PA3 (almacenes por ámbito).

Este documento fija el **modelo de datos normativo**: el SQL del registro por perfil, el contrato de
metadatos de cada almacén de ámbito y las reglas de identidad, rutas e integridad. El SQL es especificación:
se revisa aquí, se implementa en PA1.

## 1. Principios

1. **Un registro por perfil.** Cada perfil de DeepSeek Harness tiene su `registry.sqlite3`; ningún registro
   descubre ni abre almacenes de otro perfil.
2. **Un almacén por ámbito.** Proyecto y biblioteca tienen almacenes separados. El aislamiento se puede
   verificar abriendo únicamente los ficheros permitidos; no depende de un `WHERE project_id = ?`.
3. **Identidad lógica, no derivada.** `project_id` y `library_id` son ULID con prefijo, nunca el nombre ni
   la ruta.
4. **Integridad declarada.** Todo almacén declara qué ámbito es y a qué perfil pertenece; si no coincide con
   el registro, se falla en cerrado.
5. **Sin borrado por desaparición.** `missing` es un estado observado, no una orden de borrado.

## 2. Ubicación: contrato abstracto, no ruta inventada

PA0 **no fija una ruta física** porque no se ha verificado una API del host que la determine sin modificar el
entorno. El contrato es:

```
profile_data_root(profile)  →  raíz de datos del perfil (resuelta por el host)
registry_path(profile)      =  <profile_data_root>/lifecode-rag/registry.sqlite3
scope_path(profile, kind, id) = <profile_data_root>/lifecode-rag/scopes/<kind>_<id>/rag.sqlite3
```

- `kind` ∈ `prj | lib`; `<kind>_<id>` usa el identificador completo con prefijo (`prj_01J…`).
- `LIFECODE_RAG_ROOT` (v0.2) se conserva como **override explícito de desarrollo**; si está definido, el
  registro y los ámbitos cuelgan de él y el perfil queda registrado en `meta.profile_id` para impedir
  mezclas.
- **Pendiente PA1:** verificar cómo expone el host la raíz de datos por perfil (`DSH_PROFILE_DIR`,
  `storageDomain` u otro servicio) y si escribir ahí es admisible. Hasta entonces, la resolución es un
  contrato, no una afirmación.

Comportamiento ante perfil cambiado, eliminado o inaccesible: `registry-unavailable`; el registro no intenta
"adivinar" otro perfil.

## 3. SQL del registro (normativo)

**Decisión cerrada O-PA0-1 (2026-11-17):** una única tabla `roots`. Se elige sobre dos tablas
(`project_roots` + `library_roots`) porque la FK de `sync_state.root_id` no puede apuntar a dos tablas y
porque una sola fila por raíz impide por construcción un `root_id` cruzado. La pertenencia a proyecto o
biblioteca se valida con disparadores, no con FK (SQLite no tiene FK polimórfica); el precio es explícito y
está cubierto por pruebas en PA1.

```sql
PRAGMA application_id = 1279480402;  -- 'LCRR' (registro Project-Aware); el almacén de ámbito conserva 'LCRG'
PRAGMA user_version = 1;
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

-- Una fila por perfil; profile_id es el identificador estable del perfil del host.
INSERT INTO meta(key, value) VALUES
  ('registry_version', '1'),
  ('profile_id', :profile_id),
  ('created_at', :now);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY
              CHECK (substr(id, 1, 4) = 'prj_' AND length(id) = 30
                     AND substr(id, 5) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT,
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
) STRICT;

CREATE TABLE libraries (
  id          TEXT PRIMARY KEY
              CHECK (substr(id, 1, 4) = 'lib_' AND length(id) = 30
                     AND substr(id, 5) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT,
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
) STRICT;

-- Una raíz pertenece a UN ámbito. `scope_kind`/`scope_id` son la identidad del ámbito; el prefijo debe
-- coincidir con el tipo (CHECK). La existencia del ámbito la garantizan los disparadores de §3.1.
CREATE TABLE roots (
  id          TEXT PRIMARY KEY
              CHECK (substr(id, 1, 3) = 'rt_' AND length(id) = 29
                     AND substr(id, 4) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
  scope_kind  TEXT NOT NULL CHECK (scope_kind IN ('prj','lib')),
  scope_id    TEXT NOT NULL,
  path        TEXT NOT NULL CHECK (length(path) > 0),
  path_key    TEXT NOT NULL UNIQUE,   -- ruta canónica; minúsculas en Windows; única en TODO el registro
  state       TEXT NOT NULL DEFAULT 'authorized' CHECK (state IN ('authorized','revoked')),
  added_at    TEXT NOT NULL,
  added_by    TEXT NOT NULL CHECK (added_by IN ('human','host')),
  revoked_at  TEXT,
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK ((scope_kind = 'prj' AND substr(scope_id, 1, 4) = 'prj_')
      OR (scope_kind = 'lib' AND substr(scope_id, 1, 4) = 'lib_')),
  -- Clave candidata para que `sync_state` pueda referenciar la raíz CON su ámbito. Sin ella, una FK
  -- compuesta no podría demostrar que el ámbito de `sync_state` es el de su raíz.
  UNIQUE (id, scope_kind, scope_id)
) STRICT;

CREATE TRIGGER roots_scope_insert
BEFORE INSERT ON roots
WHEN (NEW.scope_kind = 'prj' AND NOT EXISTS (SELECT 1 FROM projects  WHERE id = NEW.scope_id))
  OR (NEW.scope_kind = 'lib' AND NOT EXISTS (SELECT 1 FROM libraries WHERE id = NEW.scope_id))
BEGIN
  SELECT RAISE(ABORT, 'root-scope-missing');
END;

-- El ámbito de una raíz no se reasigna: se revoca y se crea otra.
CREATE TRIGGER roots_scope_immutable
BEFORE UPDATE OF scope_kind, scope_id ON roots
BEGIN
  SELECT RAISE(ABORT, 'root-scope-immutable');
END;

-- Borrar un ámbito con raíces dejaría raíces huérfanas y `sync_state` colgado. El borrado de ámbitos no
-- forma parte de PA0; si se define, exigirá una operación coordinada con auditoría. Mientras tanto, se
-- prohíbe en la base, no solo en la aplicación.
CREATE TRIGGER projects_roots_guard
BEFORE DELETE ON projects
WHEN EXISTS (SELECT 1 FROM roots WHERE scope_kind = 'prj' AND scope_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'scope-has-roots');
END;

CREATE TRIGGER libraries_roots_guard
BEFORE DELETE ON libraries
WHEN EXISTS (SELECT 1 FROM roots WHERE scope_kind = 'lib' AND scope_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'scope-has-roots');
END;

-- Un grant es directo proyecto → biblioteca. No hay herencia ni anidamiento.
CREATE TABLE grants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
  library_id  TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL DEFAULT 'read' CHECK (permission = 'read'),
  granted_at  TEXT NOT NULL,
  granted_by  TEXT NOT NULL CHECK (granted_by IN ('human','host')),
  revoked_at  TEXT,
  revoked_by  TEXT,
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
) STRICT;

CREATE UNIQUE INDEX grants_one_open
  ON grants(project_id, library_id)
  WHERE revoked_at IS NULL;

CREATE TABLE session_scope (
  session_id       TEXT PRIMARY KEY
                   CHECK (length(session_id) BETWEEN 1 AND 200 AND session_id NOT GLOB '*[^ -~]*'),
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  state            TEXT NOT NULL DEFAULT 'active'
                   CHECK (state IN ('active','expired','invalidated')),
  selection_source TEXT NOT NULL CHECK (selection_source IN ('explicit','cwd')),
  selected_by      TEXT NOT NULL CHECK (selected_by IN ('human','host')),
  selected_at      TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  expires_at       TEXT,
  invalidated_at   TEXT,
  invalid_reason   TEXT CHECK (invalid_reason IS NULL OR invalid_reason IN
                     ('project-archived','grant-revoked','root-revoked','profile-changed',
                      'admin','session-cloned')),
  cwd              TEXT,
  clone_of         TEXT,
  revision         INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (state <> 'active'      OR (invalidated_at IS NULL AND invalid_reason IS NULL)),
  CHECK (state <> 'expired'     OR (expires_at IS NOT NULL AND invalidated_at IS NULL
                                    AND invalid_reason IS NULL)),
  CHECK (state <> 'invalidated' OR (invalidated_at IS NOT NULL AND invalid_reason IS NOT NULL
                                    AND expires_at IS NULL))
) STRICT;

-- Estado de sincronización por raíz y fuente; sirve para missing/unreadable sin borrar.
-- La FK es COMPUESTA: el ámbito de `sync_state` debe ser exactamente el de su raíz. Una raíz de proyecto
-- no puede tener filas de sincronización de biblioteca, ni al revés, aunque el `root_id` exista.
CREATE TABLE sync_state (
  scope_kind   TEXT NOT NULL CHECK (scope_kind IN ('prj','lib')),
  scope_id     TEXT NOT NULL,
  root_id      TEXT NOT NULL,
  source_key   TEXT NOT NULL,               -- uri relativa o clave estable dentro de la raíz
  status       TEXT NOT NULL CHECK (status IN ('present','missing','unreadable')),
  last_seen_at TEXT,
  last_hash    TEXT,
  missing_since TEXT,
  error_code   TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (scope_kind, scope_id, root_id, source_key),
  CHECK ((scope_kind = 'prj' AND substr(scope_id, 1, 4) = 'prj_')
      OR (scope_kind = 'lib' AND substr(scope_id, 1, 4) = 'lib_')),
  FOREIGN KEY (root_id, scope_kind, scope_id)
    REFERENCES roots(id, scope_kind, scope_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE audit_registry (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  actor     TEXT NOT NULL CHECK (actor IN ('human','host','model','automation')),
  session_id TEXT,
  action    TEXT NOT NULL,
  target    TEXT NOT NULL,
  outcome   TEXT NOT NULL CHECK (outcome IN ('ok','failed','denied','skipped')),
  detail    TEXT,
  prev_hash TEXT NOT NULL,
  hash      TEXT NOT NULL
) STRICT;

CREATE TABLE operations (
  id          TEXT PRIMARY KEY
              CHECK (substr(id, 1, 3) = 'op_' AND length(id) = 29
                     AND substr(id, 4) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
  kind        TEXT NOT NULL,                -- grant, revoke, migrate, archive, delete-scope
  state       TEXT NOT NULL CHECK (state IN ('started','committed','failed','reconciled')),
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  detail      TEXT,
  CHECK ((state IN ('committed','failed','reconciled')) = (finished_at IS NOT NULL))
) STRICT;

CREATE TABLE operation_steps (
  operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  step         TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('pending','done','failed')),
  effect_key   TEXT,                        -- clave idempotente del efecto ya aplicado
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (operation_id, step)
) STRICT;

-- Un `effect_key` no se repite dentro de la misma operación: si ya está registrado, el efecto se aplicó.
CREATE UNIQUE INDEX operation_steps_effect
  ON operation_steps(operation_id, effect_key)
  WHERE effect_key IS NOT NULL;

CREATE INDEX projects_status            ON projects(status);
CREATE INDEX roots_scope                ON roots(scope_kind, scope_id, state);
CREATE INDEX grants_project_open       ON grants(project_id) WHERE revoked_at IS NULL;
CREATE INDEX session_scope_project     ON session_scope(project_id, state);
CREATE INDEX session_scope_expiry      ON session_scope(state, expires_at);
CREATE INDEX sync_state_status         ON sync_state(scope_kind, scope_id, status);
CREATE INDEX audit_registry_at         ON audit_registry(at);
```

### 3.1 Por qué la pertenencia se valida con disparadores

`roots.scope_id` apunta a `projects` **o** a `libraries` según `scope_kind`. SQLite no admite una FK
polimórfica, así que el modelo hace lo siguiente, y nada más:

- `CHECK` de prefijo: `prj_` ↔ `scope_kind='prj'`, `lib_` ↔ `scope_kind='lib'` (impide la asociación
  incompatible evidente).
- Disparador de inserción: aborta si el `scope_id` no existe en la tabla que indica `scope_kind`
  (`root-scope-missing`). Esto convierte la pertenencia en una invariante real, no en una convención.
- Disparador de actualización: prohíbe reasignar una raíz a otro ámbito (`root-scope-immutable`); se revoca y
  se crea otra.
- `DELETE` de proyecto/biblioteca con raíces: **protegido por disparador** (`scope-has-roots`), no solo por la
  aplicación. El borrado de ámbitos **no forma parte de PA0**; si se define, exigirá código de error propio,
  operación coordinada y auditoría.
- `sync_state`: la FK compuesta `(root_id, scope_kind, scope_id) → roots(id, scope_kind, scope_id)` demuestra
  que el ámbito de la fila es el de su raíz. No hay `CHECK` con subconsulta: SQLite no garantiza el orden de
  evaluación de `CHECK` frente a la FK, y la FK ya cubre la existencia.

Pruebas obligatorias en PA1: insertar raíz con `scope_kind='prj'` y `scope_id` de biblioteca → falla;
insertar raíz con `scope_id` inexistente → falla; actualizar `scope_id` → falla; insertar dos raíces con el
mismo `path_key` → falla; insertar `sync_state` con `root_id` de otro ámbito → falla; borrar proyecto con
raíces → falla (`scope-has-roots`); insertar raíz válida → pasa.

### 3.2 Identificadores: qué valida SQLite y qué no

| Identificador | Forma | Lo que valida el `CHECK` | Lo que **no** valida |
|---|---|---|---|
| `projects.id` | `prj_` + 26 ULID = 30 | prefijo, longitud exacta, alfabeto Crockford (`0-9A-HJKMNP-TV-Z`), sin `I/L/O/U` | que sea un ULID real (timestamp + aleatoriedad), monotonicidad, unicidad global (la da la PK) |
| `libraries.id` | `lib_` + 26 = 30 | ídem | ídem |
| `roots.id` | `rt_` + 26 = 29 | ídem | ídem |
| `operations.id` | `op_` + 26 = 29 | ídem | ídem |
| `session_scope.session_id` | cadena del host | longitud 1–200 y ASCII imprimible | que sea un ID de sesión vivo del host (lo verifica la resolución en PA2) |

El `CHECK` **no** demuestra que el ULID sea válido: sólo demuestra forma. La aplicación (PA1) debe además
decodificar el ULID y rechazar los que no lo sean; se documenta como validación de aplicación, no de esquema.
Pruebas: carácter fuera del alfabeto (`I`, `L`, `O`, `U`, `-`), longitud 29/31, prefijo equivocado, minúsculas;
cada caso debe fallar en inserción directa.

**Unicidad global de identidad:** `projects.id`, `libraries.id`, `roots.id`, `operations.id` son PK; no hay
dos filas con el mismo identificador. **Unicidad global de ruta:** `roots.path_key` es `UNIQUE` para todas
las filas (incluidas revocadas). Reactivar una ruta revocada se hace actualizando esa fila (`state`,
`revoked_at = NULL`), no insertando otra.

Reglas adicionales:

- Una misma ruta física no puede pertenecer a dos proyectos ni a un proyecto y una biblioteca: lo impide
  `path_key UNIQUE`.
- Raíces solapadas dentro del mismo ámbito (una contenida en otra) se rechazan con `root-overlap`; el registro
  no intenta deducir la intención.
- `libraries` nunca referencia `projects`; `projects` solo se relaciona con `libraries` mediante `grants`.
- No hay `parent_library_id` ni `parent_project_id`: el anidamiento es imposible por esquema.

## 4. Contrato de metadatos de cada almacén de ámbito

Cada `rag.sqlite3` de ámbito conserva el esquema v3 de v0.2 y añade estas claves obligatorias en `meta`:

| Clave | Valor | Regla |
|---|---|---|
| `scope_id` | `prj_…` o `lib_…` | Debe coincidir con el directorio y con el registro; si no, `scope-store-corrupt` |
| `scope_kind` | `project` \| `library` | Coherente con el prefijo |
| `profile_id` | el del registro | Distinto → `scope-forbidden` (no se abre) |
| `schema_version` | entero | Mayor que el soportado → `scope-store-corrupt` (fail closed) |
| `migration_version` | entero | Trazabilidad de migraciones |
| `store_state` | `ready` \| `migrating` \| `corrupt` | `migrating`/`corrupt` → no se consulta |
| `created_at` | ISO-8601 | — |

El registro guarda, por ámbito, la ruta esperada del almacén para poder detectar un `scope_id` que apunta a
otro sitio. La comprobación es **previa a cualquier lectura de contenido**.

## 5. Identidad y rutas

- ULID Crockford (26 caracteres, sin `I`, `L`, `O`, `U`), prefijo `prj_` / `lib_`; los IDs de raíz usan
  `rt_` y los de operación `op_`. No se derivan del nombre ni de la ruta. El esquema valida forma; la
  validez real del ULID la comprueba la aplicación (§3.2).
- Canonicalización: `realpathSync.native`, después plegado a minúsculas para `path_key` en Windows; se
  conserva la forma original en `path` para mostrarla.
- Se rechazan symlinks, junctions y reparse points en raíces y ficheros; los hardlinks de fichero se
  rechazan con `hardlink-refused` (regla heredada de v0.1).
- Traversal: toda ruta relativa se resuelve contra la raíz autorizada y se comprueba que el resultado sigue
  dentro; `..`, rutas absolutas y unidades distintas se rechazan.
- Dos raíces con el mismo `path_key` → `registry-corrupt` (no se elige una "ganadora").
- Archivar un proyecto no borra su almacén ni sus raíces; solo impide seleccionarlo.

## 6. Integridad y recuperación

- `PRAGMA integrity_check` antes de confiar en un almacén; fallo → `registry-corrupt` o
  `scope-store-corrupt` según el fichero.
- La auditoría encadenada se verifica por almacén; una cadena rota no se repara automáticamente: se marca
  `corrupt` y se informa.
- Copia de seguridad previa a cualquier migración; el original se conserva (ver contrato de migración en la
  arquitectura).
- El registro no se reconstruye "a ojo" desde los directorios: si falta, `registry-unavailable`; si existe
  pero no cuadra, `registry-corrupt`.
- Las operaciones multicontenedor usan `operations` + `operation_steps`; una operación `started` al abrir el
  registro es una **operación incompleta** y se reconcilia antes de aceptar nuevas (§3.3 del contrato de
  arquitectura).

### 6.1 Idempotencia y efectos ya aplicados

El problema real: un paso puede aplicar su efecto y el proceso caer antes de persistir `state='done'`. Al
reconciliar, no se puede saber por el `state` si el efecto ocurrió.

1. **Clave de efecto única por operación.** `operation_steps(operation_id, effect_key)` es único (índice
   parcial `WHERE effect_key IS NOT NULL`). Insertar el `effect_key` es el acto que registra el efecto; un
   segundo intento con la misma clave falla por unicidad y se interpreta como "ya aplicado".
2. **Comprobación previa de efecto, no de estado.** Antes de aplicar un paso, se comprueba el efecto en su
   destino: ¿existe el grant?, ¿está la raíz revocada?, ¿coincide el hash del almacén? Si el efecto ya está,
   se marca `done` sin repetirlo.
3. **Pasos destructivos con resultado incierto no se repiten.** Si no se puede comprobar el efecto (fichero
   ilegible, error de E/S), el paso pasa a `failed` y la operación a `failed`/`reconciled` con `detail`; nunca
   se reintenta a ciegas un borrado o una migración.
4. **Rollback repetible.** Cada paso de rollback lleva su propio `effect_key`; repetirlo es seguro por la
   misma unicidad y comprobación previa.
5. **Auditoría.** Cada transición (`pending → done`, `done → rollback`, `failed`) se audita con
   `operations.id` y `step`, sin contenido de usuario.

`effect_key` es una cadena estable derivada del paso y su destino (por ejemplo `revoke:<grant_id>`), no un
timestamp: dos intentos distintos del mismo efecto deben producir la misma clave.

## 7. Lo que este contrato NO afirma

- No afirma que la ruta por perfil esté verificada (pendiente PA1).
- No afirma que el esquema se haya creado o migrado.
- No afirma que los disparadores se hayan probado: son especificación; sus pruebas pertenecen a PA1.
- No afirma atomicidad entre registro y almacenes: las operaciones multicontenedor se documentan como
  coordinadas, con estado parcial y reconciliación (`operations`).
