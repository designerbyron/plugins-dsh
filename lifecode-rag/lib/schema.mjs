/**
 * Esquema del almacén de LifeCode RAG (versión 2, con el delta de la resolución v2.1).
 *
 * Reglas que este módulo fija y ninguna migración puede romper:
 * - `chunks_fts` es **externa**: no duplica texto, lee de `chunks`, y se mantiene con disparadores.
 * - `audit` es la fuente autoritativa; `audit.jsonl` es una exportación derivada y regenerable.
 * - `sources` no guarda estados parciales: una fila existe sólo si está indexada (`indexed_at NOT NULL`).
 * - `source_tags` es normalizada, no JSON: el filtro se hace en SQL antes de materializar resultados.
 */

/** Identificador de aplicación SQLite: 0x4C435247 = 'LCRG'. Un fichero sin él no es de este plugin. */
export const APPLICATION_ID = 1_279_480_391;

/** Versión de esquema. `PRAGMA user_version` manda; una mayor no se abre. */
export const SCHEMA_VERSION = 3;

/**
 * Delta v0.2 (esquema 3). Se aplica a almacenes 2 y se crea con el resto en almacenes nuevos.
 * `metrics_daily` guarda **agregados** por día, métrica y dimensión cerrada: nunca texto de consultas.
 * `index_jobs` es el histórico de trabajos de automatización; `policies` la política vigente.
 */
export const DDL_V3 = Object.freeze([
  `CREATE TABLE metrics_daily (
    day        TEXT NOT NULL,
    metric     TEXT NOT NULL,
    dim        TEXT NOT NULL DEFAULT '',
    value      REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (day, metric, dim)
  ) STRICT`,

  `CREATE INDEX metrics_daily_metric ON metrics_daily(metric, day)`,

  `CREATE TABLE index_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          INTEGER NOT NULL,
    kind        TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('queued','running','ok','failed','cancelled')),
    detail      TEXT NOT NULL DEFAULT '{}',
    started_at  INTEGER,
    finished_at INTEGER
  ) STRICT`,

  `CREATE TABLE policies (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT`,
]);

export const DDL = Object.freeze([
  `CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT`,

  `CREATE TABLE sources (
    id          TEXT PRIMARY KEY,
    collection  TEXT NOT NULL DEFAULT 'default',
    uri         TEXT NOT NULL,
    title       TEXT NOT NULL,
    mime        TEXT,
    sha256      TEXT NOT NULL,
    bytes       INTEGER NOT NULL,
    char_count  INTEGER NOT NULL,
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    indexed_at  INTEGER NOT NULL,
    UNIQUE (collection, uri)
  ) STRICT`,

  `CREATE TABLE chunks (
    id          INTEGER PRIMARY KEY,
    chunk_key   TEXT NOT NULL UNIQUE,
    source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    heading     TEXT,
    text        TEXT NOT NULL,
    char_start  INTEGER NOT NULL,
    char_end    INTEGER NOT NULL,
    token_est   INTEGER NOT NULL,
    UNIQUE (source_id, ordinal)
  ) STRICT`,

  `CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text, title, heading,
    content = 'chunks',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
  )`,

  `CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text, title, heading)
    VALUES (new.id, new.text, new.title, new.heading);
  END`,

  `CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text, title, heading)
    VALUES ('delete', old.id, old.text, old.title, old.heading);
  END`,

  `CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text, title, heading)
    VALUES ('delete', old.id, old.text, old.title, old.heading);
    INSERT INTO chunks_fts(rowid, text, title, heading)
    VALUES (new.id, new.text, new.title, new.heading);
  END`,

  `CREATE TABLE source_tags (
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    tag       TEXT NOT NULL,
    PRIMARY KEY (source_id, tag)
  ) STRICT`,

  `CREATE INDEX source_tags_tag ON source_tags(tag, source_id)`,

  `CREATE TABLE vectors (
    chunk_key TEXT NOT NULL REFERENCES chunks(chunk_key) ON DELETE CASCADE,
    model     TEXT NOT NULL,
    dim       INTEGER NOT NULL,
    vec       BLOB NOT NULL,
    PRIMARY KEY (chunk_key, model)
  ) STRICT`,

  `CREATE TABLE audit (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    actor      TEXT NOT NULL,
    session_id TEXT,
    call_id    TEXT,
    tool       TEXT NOT NULL,
    action     TEXT NOT NULL,
    target     TEXT,
    outcome    TEXT NOT NULL CHECK (outcome IN ('ok','failed','denied','skipped')),
    details    TEXT NOT NULL DEFAULT '{}',
    prev_hash  TEXT NOT NULL,
    hash       TEXT NOT NULL
  ) STRICT`,

  `CREATE INDEX chunks_source ON chunks(source_id)`,
  `CREATE INDEX sources_collection ON sources(collection)`,
  `CREATE INDEX vectors_model ON vectors(model)`,
  ...DDL_V3,
]);

/** Claves iniciales de `meta`. `audit_head_hash` vacío significa «sin auditoría todavía». */
export function initialMeta(now) {
  return [
    ['schema_version', String(SCHEMA_VERSION)],
    ['created_at', String(now)],
    ['index_revision', '0'],
    ['embedding_model', 'local-hash-v1'],
    ['audit_head_seq', '0'],
    ['audit_head_hash', ''],
    ['audit_exported_seq', '0'],
  ];
}

/** Todas las tablas que el esquema declara, para comprobaciones de integridad. */
export const EXPECTED_TABLES = Object.freeze([
  'audit',
  'chunks',
  'chunks_fts',
  'index_jobs',
  'meta',
  'metrics_daily',
  'policies',
  'source_tags',
  'sources',
  'vectors',
]);
