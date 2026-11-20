/**
 * M3: la telemetría es agregada y cerrada. No guarda texto de documentos, consultas ni respuestas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openDatabase } from '../lib/db.mjs';
import { ingestFiles } from '../lib/ingest.mjs';
import { METRICS, DIM_PATTERN } from '../lib/metrics.mjs';
import { DEFAULT_CONFIG } from '../lib/paths.mjs';
import { search } from '../lib/search.mjs';
import { tempRoot } from './helpers.mjs';

const SECRET = 'palabra-secreta-que-no-debe-filtrarse';

test('las métricas sólo usan el vocabulario cerrado y no guardan texto', async () => {
  const box = tempRoot('rag-metrics');
  try {
    const docs = join(box.root, 'docs');
    const store = join(box.root, 'almacen');
    const config = DEFAULT_CONFIG;
    writeFileSync(join(box.root, 'docs.txt'), '', 'utf8');
    // Un documento con una palabra única: si aparece en métricas, la prueba falla.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, 'a.md'), `# Documento\n\n${SECRET} aparece aquí.`, 'utf8');

    await ingestFiles({ root: store, files: [join(docs, 'a.md')], config });
    const opened = openDatabase({ root: store, create: false });
    try {
      await search(opened.db, { query: SECRET, config });
      const rows = opened.db.prepare('SELECT day, metric, dim, value FROM metrics_daily').all();
      assert.ok(rows.length > 0, 'la consulta deja métricas');
      const allowed = new Set(METRICS);
      for (const row of rows) {
        assert.ok(allowed.has(row.metric), `métrica no declarada: ${row.metric}`);
        assert.equal(typeof row.value, 'number');
        assert.equal(DIM_PATTERN.test(row.dim), true, `dimensión inválida: ${row.dim}`);
        assert.equal(JSON.stringify(row).includes(SECRET), false, 'ningún texto del documento en métricas');
      }
      // La tabla no tiene columnas libres donde esconder contenido.
      const columns = opened.db.prepare('PRAGMA table_info(metrics_daily)').all().map((column) => column.name);
      assert.deepEqual(columns.sort(), ['day', 'dim', 'metric', 'updated_at', 'value']);
    } finally {
      opened.db.close();
    }
  } finally {
    box.cleanup();
  }
});
