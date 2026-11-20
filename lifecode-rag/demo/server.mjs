/**
 * Servidor de demostración aislado del Workspace.
 *
 * No instala nada en el perfil ni toca el almacén real: usa `demo/.store` y sirve la misma API que
 * consume la pestaña nativa, de modo que lo que se ve en las capturas es el motor real.
 */

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ingestFiles } from '../lib/ingest.mjs';
import { loadConfig, storePaths } from '../lib/paths.mjs';
import { API_PREFIX, createApiHandler } from '../lib/server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '.store');
const CORPUS = join(HERE, 'corpus');
const PORT = Number(process.env.LCR_DEMO_PORT || 7333);
const EMPTY = process.argv.includes('--empty');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function seed() {
  if (EMPTY) return { ingested: 0, skipped: 0, errors: [] };
  const files = existsSync(CORPUS)
    ? readFileSync(join(CORPUS, 'indice.txt'), 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).map((name) => join(CORPUS, name))
    : [];
  return ingestFiles({
    root: ROOT,
    files,
    collection: 'demostracion',
    tags: ['demo', 'documentacion'],
    force: false,
    config: loadConfig(ROOT).config,
  });
}

const api = createApiHandler({ root: ROOT, env: process.env });

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith(API_PREFIX)) {
      await api(req, res);
      return;
    }

    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (path === '/index.html') {
      const html = readFileSync(join(HERE, 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    const file = join(HERE, path);
    if (!file.startsWith(HERE)) {
      res.writeHead(403).end('fuera del directorio de demostración');
      return;
    }
    const type = MIME[extname(file)] || 'application/octet-stream';
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('no encontrado');
      return;
    }
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error?.stack || error));
  }
});

mkdirSync(ROOT, { recursive: true });
const result = seed();
const { database } = storePaths(ROOT);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[demo] http://127.0.0.1:${PORT}`);
  console.log(`[demo] almacén ${database}`);
  console.log(`[demo] siembra: ${JSON.stringify({ ingested: result.ingested, skipped: result.skipped, errors: (result.errors || []).length })}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
