/**
 * Utilidades de prueba: cajas temporales, nunca el almacén real.
 *
 * Las pruebas de LifeCode RAG no tocan `~/.dsh/lifecode-rag`: cada una recibe una raíz nueva y la borra
 * al terminar. La suite hermética comprueba además, desde fuera, que el almacén vivo no cambió.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Raíz temporal única. Devuelve también `cleanup`. */
export function tempRoot(prefix = 'lifecode-rag') {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return {
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Inserta una fuente mínima válida. */
export function insertSource(db, overrides = {}) {
  const now = overrides.now ?? 1_700_000_000_000;
  const source = {
    id: 'src-1',
    collection: 'default',
    uri: 'C:/proyectos/demo/README.md',
    title: 'README',
    mime: 'text/markdown',
    sha256: 'a'.repeat(64),
    bytes: 10,
    char_count: 10,
    metadata: '{}',
    created_at: now,
    updated_at: now,
    indexed_at: now,
    ...overrides,
  };
  db.prepare(`INSERT INTO sources (id, collection, uri, title, mime, sha256, bytes, char_count, metadata, created_at, updated_at, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    source.id, source.collection, source.uri, source.title, source.mime, source.sha256,
    source.bytes, source.char_count, source.metadata, source.created_at, source.updated_at, source.indexed_at,
  );
  return source;
}

/** Inserta un chunk y devuelve su `id` (rowid) y su `chunk_key`. */
export function insertChunk(db, { sourceId = 'src-1', ordinal = 0, text = 'alpha original', title = 'README', heading = null } = {}) {
  const chunkKey = `${sourceId}#${ordinal}`;
  const result = db.prepare(`INSERT INTO chunks (chunk_key, source_id, ordinal, title, heading, text, char_start, char_end, token_est)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    chunkKey, sourceId, ordinal, title, heading, text, 0, text.length, 3,
  );
  return { id: Number(result.lastInsertRowid), chunkKey };
}

/** Cuenta coincidencias FTS para un término. */
export function ftsMatches(db, term) {
  return db.prepare('SELECT COUNT(*) AS n FROM chunks_fts WHERE chunks_fts MATCH ?').get(term).n;
}
