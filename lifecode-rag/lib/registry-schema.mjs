/**
 * DDL del registro Project-Aware (PA1). Es la traducción literal del contrato de datos
 * `docs/PROJECT-AWARE-DATA-CONTRACT.md` §3. Cualquier cambio aquí debe reflejarse allí y en
 * `eval/pa0/sql-check.mjs`.
 */

export const REGISTRY_APPLICATION_ID = 1_279_480_402; // 'LCRR'
export const REGISTRY_VERSION = 1;

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
  `CREATE INDEX sync_state_status     ON sync_state(scope_kind, scope_id, status)`,
  `CREATE INDEX audit_registry_at     ON audit_registry(at)`,
]);
