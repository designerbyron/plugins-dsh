/**
 * DDL del registro Project-Aware (PA1). Es la traducción literal del contrato de datos
 * `docs/PROJECT-AWARE-DATA-CONTRACT.md` §3. Cualquier cambio aquí debe reflejarse allí y en
 * `tests/tracking-migration.test.mjs` (recuentos por tabla y migración idempotente).
 */

export const REGISTRY_APPLICATION_ID = 1_279_480_402; // 'LCRR'
/**
 * v1: esquema inicial PA1.
 * v2: añade `pa_selection` (selección de proyecto persistida con revisión monotónica, CR-1).
 * v3: añade `workspace_tracking` (seguimiento de workspace por perfil, UX-2.2). Aditiva: ninguna
 *     tabla ni fila existente se toca; la vuelta atrás se documenta (no se hace `DROP`).
 */
export const REGISTRY_VERSION = 3;

/**
 * Tabla del seguimiento (UX-2.2, `D-IMPL-01`). Una fila por `path_key` —la identidad— y dos ejes
 * independientes con CHECK: `state` (decisión humana) y `last_status` (disponibilidad del Host).
 * `bound_by='human'` es deliberado: en UX-2.2 ni el Host ni el modelo crean filas.
 *
 * La forma es la misma en la creación de un registro nuevo y en la migración v2 → v3: una sola
 * definición evita que el esquema recién creado y el migrado divergan.
 */
const WORKSPACE_TRACKING_TABLE = `CREATE TABLE IF NOT EXISTS workspace_tracking (
  path_key      TEXT PRIMARY KEY,
  path          TEXT,
  workspace_id  TEXT,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  state         TEXT NOT NULL CHECK (state IN ('on','off','paused')),
  association   TEXT NOT NULL CHECK (association IN ('explicit','pending','conflict')),
  bound_by      TEXT NOT NULL CHECK (bound_by IN ('human')),
  bound_at      TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_seen_at  TEXT,
  last_status   TEXT CHECK (last_status IN ('ok','missing','unknown')),
  revision      INTEGER NOT NULL DEFAULT 1
) STRICT`;

const WORKSPACE_TRACKING_INDEXES = Object.freeze([
  `CREATE INDEX IF NOT EXISTS workspace_tracking_project ON workspace_tracking(project_id)`,
  `CREATE INDEX IF NOT EXISTS workspace_tracking_state ON workspace_tracking(state, last_status)`,
]);

export const REGISTRY_DDL = Object.freeze([
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`,

  `CREATE TABLE projects (
    id          TEXT PRIMARY KEY
                CHECK (substr(id,1,4)='prj_' AND length(id)=30
                       AND substr(id,5) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
    name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    archived_at TEXT,
    CHECK ((status='archived') = (archived_at IS NOT NULL))
  ) STRICT`,

  `CREATE TABLE libraries (
    id          TEXT PRIMARY KEY
                CHECK (substr(id,1,4)='lib_' AND length(id)=30
                       AND substr(id,5) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
    name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    archived_at TEXT,
    CHECK ((status='archived') = (archived_at IS NOT NULL))
  ) STRICT`,

  `CREATE TABLE roots (
    id          TEXT PRIMARY KEY
                CHECK (substr(id,1,3)='rt_' AND length(id)=29
                       AND substr(id,4) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
    scope_kind  TEXT NOT NULL CHECK (scope_kind IN ('prj','lib')),
    scope_id    TEXT NOT NULL,
    path        TEXT NOT NULL CHECK (length(path) > 0),
    path_key    TEXT NOT NULL UNIQUE,
    state       TEXT NOT NULL DEFAULT 'authorized' CHECK (state IN ('authorized','revoked')),
    added_at    TEXT NOT NULL,
    added_by    TEXT NOT NULL CHECK (added_by IN ('human','host')),
    revoked_at  TEXT,
    CHECK ((state='revoked') = (revoked_at IS NOT NULL)),
    CHECK ((scope_kind='prj' AND substr(scope_id,1,4)='prj_')
        OR (scope_kind='lib' AND substr(scope_id,1,4)='lib_')),
    UNIQUE (id, scope_kind, scope_id)
  ) STRICT`,

  `CREATE TRIGGER roots_scope_insert BEFORE INSERT ON roots
   WHEN (NEW.scope_kind='prj' AND NOT EXISTS (SELECT 1 FROM projects  WHERE id=NEW.scope_id))
     OR (NEW.scope_kind='lib' AND NOT EXISTS (SELECT 1 FROM libraries WHERE id=NEW.scope_id))
   BEGIN SELECT RAISE(ABORT,'root-scope-missing'); END`,

  `CREATE TRIGGER roots_scope_immutable BEFORE UPDATE OF scope_kind, scope_id ON roots
   BEGIN SELECT RAISE(ABORT,'root-scope-immutable'); END`,

  `CREATE TRIGGER projects_roots_guard BEFORE DELETE ON projects
   WHEN EXISTS (SELECT 1 FROM roots WHERE scope_kind='prj' AND scope_id=OLD.id)
   BEGIN SELECT RAISE(ABORT,'scope-has-roots'); END`,

  `CREATE TRIGGER libraries_roots_guard BEFORE DELETE ON libraries
   WHEN EXISTS (SELECT 1 FROM roots WHERE scope_kind='lib' AND scope_id=OLD.id)
   BEGIN SELECT RAISE(ABORT,'scope-has-roots'); END`,

  `CREATE TABLE grants (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
    library_id  TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    permission  TEXT NOT NULL DEFAULT 'read' CHECK (permission='read'),
    granted_at  TEXT NOT NULL,
    granted_by  TEXT NOT NULL CHECK (granted_by IN ('human','host')),
    revoked_at  TEXT,
    revoked_by  TEXT,
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
  ) STRICT`,

  `CREATE UNIQUE INDEX grants_one_open ON grants(project_id, library_id) WHERE revoked_at IS NULL`,

  `CREATE TABLE session_scope (
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
  ) STRICT`,

  `CREATE TABLE pa_selection (
    selection_key    TEXT PRIMARY KEY CHECK (selection_key='profile'),
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision         INTEGER NOT NULL CHECK (revision >= 1),
    selection_source TEXT NOT NULL CHECK (selection_source IN ('explicit','cwd')),
    selected_by      TEXT NOT NULL CHECK (selected_by IN ('human','host')),
    principal        TEXT NOT NULL DEFAULT 'owner',
    selected_at      TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  ) STRICT`,

  WORKSPACE_TRACKING_TABLE,

  `CREATE TABLE sync_state (
    scope_kind   TEXT NOT NULL CHECK (scope_kind IN ('prj','lib')),
    scope_id     TEXT NOT NULL,
    root_id      TEXT NOT NULL,
    source_key   TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('present','missing','unreadable')),
    last_seen_at TEXT,
    last_hash    TEXT,
    missing_since TEXT,
    error_code   TEXT,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (scope_kind, scope_id, root_id, source_key),
    CHECK ((scope_kind='prj' AND substr(scope_id,1,4)='prj_')
        OR (scope_kind='lib' AND substr(scope_id,1,4)='lib_')),
    FOREIGN KEY (root_id, scope_kind, scope_id)
      REFERENCES roots(id, scope_kind, scope_id) ON DELETE CASCADE
  ) STRICT`,

  `CREATE TABLE audit_registry (
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
  ) STRICT`,

  `CREATE TABLE operations (
    id          TEXT PRIMARY KEY
                CHECK (substr(id,1,3)='op_' AND length(id)=29
                       AND substr(id,4) NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
    kind        TEXT NOT NULL,
    state       TEXT NOT NULL CHECK (state IN ('started','committed','failed','reconciled')),
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    detail      TEXT,
    CHECK ((state IN ('committed','failed','reconciled')) = (finished_at IS NOT NULL))
  ) STRICT`,

  `CREATE TABLE operation_steps (
    operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    step         TEXT NOT NULL,
    state        TEXT NOT NULL CHECK (state IN ('pending','done','failed')),
    effect_key   TEXT,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (operation_id, step)
  ) STRICT`,

  `CREATE UNIQUE INDEX operation_steps_effect
     ON operation_steps(operation_id, effect_key) WHERE effect_key IS NOT NULL`,

  `CREATE INDEX projects_status        ON projects(status)`,
  `CREATE INDEX roots_scope            ON roots(scope_kind, scope_id, state)`,
  `CREATE INDEX grants_project_open   ON grants(project_id) WHERE revoked_at IS NULL`,
  `CREATE INDEX session_scope_project ON session_scope(project_id, state)`,
  `CREATE INDEX session_scope_expiry  ON session_scope(state, expires_at)`,
  `CREATE INDEX pa_selection_project  ON pa_selection(project_id)`,
  ...WORKSPACE_TRACKING_INDEXES,
  `CREATE INDEX sync_state_status     ON sync_state(scope_kind, scope_id, status)`,
  `CREATE INDEX audit_registry_at     ON audit_registry(at)`,
]);

/**
 * Migraciones aditivas del registro, por versión de destino. Sólo crean estructuras nuevas: ninguna
 * toca filas existentes, así que un registro v1 se abre y sigue sirviendo con los mismos datos.
 * La versión se fija con `PRAGMA user_version` y `meta.registry_version` en la misma transacción.
 */
export const REGISTRY_MIGRATIONS = Object.freeze({
  2: Object.freeze([
    `CREATE TABLE IF NOT EXISTS pa_selection (
      selection_key    TEXT PRIMARY KEY CHECK (selection_key='profile'),
      project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      revision         INTEGER NOT NULL CHECK (revision >= 1),
      selection_source TEXT NOT NULL CHECK (selection_source IN ('explicit','cwd')),
      selected_by      TEXT NOT NULL CHECK (selected_by IN ('human','host')),
      principal        TEXT NOT NULL DEFAULT 'owner',
      selected_at      TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    ) STRICT`,
    `CREATE INDEX IF NOT EXISTS pa_selection_project ON pa_selection(project_id)`,
  ]),

  // v3 · UX-2.2: sólo crea la tabla del seguimiento y sus índices. Nunca `ALTER`, nunca reescribe
  // filas; un registro v2 sigue siendo legible tras migrar porque nada existente cambia.
  3: Object.freeze([
    WORKSPACE_TRACKING_TABLE,
    ...WORKSPACE_TRACKING_INDEXES,
  ]),
});
