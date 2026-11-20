/** LE-RAG-03 · El core funciona sin DSH: imports, rutas y motor. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase, closeDatabase } from '../lib/db.mjs';
import { ftsSearch, search } from '../lib/search.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { resolveConfig } from '../lib/config-resolve.mjs';
import { insertChunk, insertSource } from './helpers.mjs';

const LIB = new URL('../lib/', import.meta.url);
const forbidden = [
  /from\s+['"]@deepseek-ai\//,
  /import\(\s*['"]@deepseek-ai/,
  /require\(\s*['"]@deepseek-ai/,
  /from\s+['"]cordis['"]/,
];
// Las menciones en comentarios son documentación, no acoplamiento: se descartan antes de medir.
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('ningún módulo del core importa el Harness (estático ni dinámico)', () => {
  const offenders = [];
  for (const file of readdirSync(LIB).filter((f) => f.endsWith('.mjs'))) {
    const code = stripComments(readFileSync(new URL(file, LIB), 'utf8'));
    if (forbidden.some((rx) => rx.test(code))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'el core debe estar libre de imports del host');
});

test('el motor arranca con una raíz propia y sin variables del Harness', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lcr-standalone-'));
  const prev = { ...process.env };
  try {
    writeFileSync(join(root, 'config.json'), JSON.stringify({ search: { diversity: 'source', limit: 4 } }), 'utf8');
    delete process.env.DSH_PROFILE;
    delete process.env.LIFECODE_RAG_ROOT;
    process.env.LIFECODE_RAG_DATA = root;

    const config = resolveConfig({ dataRoot: root, profileKey: 'ninguno' }).config;
    assert.equal(config.search.diversity, 'source');
    assert.equal(config.search.limit, 4);

    const { db } = openDatabase({ root: join(root, 'store'), create: true });
    insertSource(db, { id: 's1', uri: 'C:/x/s1.md', title: 'S1' });
    insertChunk(db, { sourceId: 's1', ordinal: 0, text: 'alpha beta gamma', title: 'S1' });
    const embedder = { model: 'test', dim: 4, embed: async (t) => t.map(() => new Float32Array(4)) };
    assert.ok(ftsSearch(db, { query: 'alpha', limit: 5 }).length >= 1);
    const out = await search(db, { query: 'alpha', limit: 5, config: validateConfig({}), embedder, strategy: 'hybrid', record: false, diversity: 'source' });
    assert.ok(out.results.length >= 1);
    closeDatabase(db);
  } finally {
    process.env = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

test('la persistencia no exige el home del Harness', () => {
  const root = mkdtempSync(join(tmpdir(), 'lcr-store-'));
  try {
    const { db } = openDatabase({ root: join(root, 'db'), create: true });
    insertSource(db, { id: 'x', uri: 'C:/x/x.md', title: 'X' });
    insertChunk(db, { sourceId: 'x', ordinal: 0, text: 'contenido local', title: 'X' });
    closeDatabase(db);
    const reopened = openDatabase({ root: join(root, 'db') });
    assert.equal(ftsSearch(reopened.db, { query: 'contenido', limit: 3 }).length, 1);
    closeDatabase(reopened.db);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
