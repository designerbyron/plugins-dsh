/**
 * AC16: etiquetas normalizadas, filtros any/all y cambio de etiquetas sin re-trocear.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { search } from '../lib/search.mjs';
import { normalizeTags, normalizeTag } from '../lib/tags.mjs';
import { tempRoot } from './helpers.mjs';

async function seed(box, files, tags) {
  const cwd = join(box.root, 'proyecto');
  mkdirSync(cwd, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(cwd, name), body, 'utf8');
  const store = join(box.root, 'almacen');
  const result = await ingestFiles({ root: store, files: Object.keys(files).map((name) => join(cwd, name)), tags, now: 1, config: validateConfig({}) });
  return { store, result, cwd };
}

test('normaliza a minúsculas, recorta y rechaza formas inválidas', () => {
  assert.equal(normalizeTag('  Docs '), 'docs');
  assert.deepEqual(normalizeTags(['Docs', 'docs', 'rag-2026']), ['docs', 'rag-2026']);
  assert.throws(() => normalizeTag('-mal'), (error) => error.code === 'invalid-tag');
  assert.throws(() => normalizeTag('con espacio'), (error) => error.code === 'invalid-tag');
  assert.throws(() => normalizeTags(Array.from({ length: 21 }, (_, i) => `t${i}`)), (error) => error.code === 'invalid-tag');
});

test('una etiqueta inválida falla antes de crear el almacén', async () => {
  const box = tempRoot('rag-tags');
  try {
    const cwd = join(box.root, 'proyecto');
    mkdirSync(cwd, { recursive: true });
    const path = join(cwd, 'a.md');
    writeFileSync(path, 'contenido', 'utf8');
    await assert.rejects(() => ingestFiles({ root: join(box.root, 'almacen'), files: [path], tags: ['mal tag'], now: 1, config: validateConfig({}) }),
      (error) => error.code === 'invalid-tag',
    );
    assert.throws(() => openDatabase({ root: join(box.root, 'almacen'), create: false }), (error) => error.code === 'store-not-initialized');
  } finally {
    box.cleanup();
  }
});

test('los filtros any/all usan las etiquetas normalizadas', async () => {
  const box = tempRoot('rag-tags');
  try {
    const { store } = await seed(box, { 'a.md': '# A\n\nalfa comparte', 'b.md': '# B\n\nbeta comparte' }, ['Docs']);
    const opened = openDatabase({ root: store, create: false });
    try {
      const config = validateConfig({});
      const any = await search(opened.db, { query: 'comparte', tags: ['docs', 'otra'], tagMode: 'any', config });
      assert.equal(any.results.length, 2);
      const all = await search(opened.db, { query: 'comparte', tags: ['docs', 'otra'], tagMode: 'all', config });
      assert.equal(all.results.length, 0);
      await assert.rejects(() => search(opened.db, { query: 'comparte', tags: ['no vale'], config }), (error) => error.code === 'invalid-tag');
    } finally {
      closeDatabase(opened.db);
    }
  } finally {
    box.cleanup();
  }
});

test('cambiar sólo etiquetas no re-trocea ni sube la revisión', async () => {
  const box = tempRoot('rag-tags');
  try {
    const { store, result } = await seed(box, { 'a.md': '# A\n\nestable' }, ['uno']);
    assert.equal(result.ingested[0].tagsUpdated, false);
    const before = openDatabase({ root: store, create: false });
    const revision = before.db.prepare("SELECT value FROM meta WHERE key = 'index_revision'").get().value;
    const chunks = before.db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
    closeDatabase(before.db);

    const again = await ingestFiles({
      root: store, files: [join(box.root, 'proyecto', 'a.md')], tags: ['dos'], now: 2, config: validateConfig({}),
    });
    assert.equal(again.skipped.length, 0);
    assert.equal(again.ingested[0].tagsUpdated, true);

    const after = openDatabase({ root: store, create: false });
    try {
      assert.equal(after.db.prepare("SELECT value FROM meta WHERE key = 'index_revision'").get().value, revision);
      assert.equal(after.db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n, chunks);
      const tags = after.db.prepare('SELECT tag FROM source_tags ORDER BY tag').all().map((row) => row.tag);
      assert.deepEqual(tags, ['dos']);
    } finally {
      closeDatabase(after.db);
    }
  } finally {
    box.cleanup();
  }
});
