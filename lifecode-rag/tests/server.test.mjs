/**
 * API del Workspace: conversación real por HTTP contra el handler puro.
 *
 * Cubre el contrato de seguridad (Host/Origin/cabecera), lectura agregada, búsqueda real,
 * acciones mutantes con confirmación y escritura de configuración.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ingestFiles } from '../lib/ingest.mjs';
import { closeDatabase, openDatabase } from '../lib/db.mjs';
import { validateConfig } from '../lib/paths.mjs';
import { API_PREFIX, createApiHandler } from '../lib/server.mjs';
import { tempRoot } from './helpers.mjs';

async function startApi(root) {
  const handler = createApiHandler({ root });
  const server = createServer((req, res) => { handler(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, port, base: `http://127.0.0.1:${port}${API_PREFIX}` };
}

function post(base, path, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lifecode-rag': '1', ...headers },
    body: JSON.stringify(body),
  });
}

test('GET /health y /capabilities responden sin mutar', async () => {
  const box = tempRoot('rag-api');
  const api = await startApi(box.root);
  try {
    const health = await fetch(`${api.base}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.ok, true);
    // La versión publicada por la API es la del paquete, no una copia que pueda desincronizarse.
  const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.equal(healthBody.data.version, packageVersion);

    const capabilities = await (await fetch(`${api.base}/capabilities`)).json();
    assert.deepEqual(capabilities.data.strategies, ['hybrid', 'fts', 'vector']);
    assert.equal(capabilities.data.toolsFrozen.length, 7);
  } finally {
    api.server.close();
    box.cleanup();
  }
});

test('rechaza Host no loopback, falta de cabecera y JSON inválido', async () => {
  const box = tempRoot('rag-api');
  const api = await startApi(box.root);
  try {
    const { request } = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: api.port, path: `${API_PREFIX}/search`, method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end('{}');
    });
    assert.equal(status, 403);

    const noHeader = await fetch(`${api.base}/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"x"}' });
    assert.equal(noHeader.status, 403);

    // Host loopback + cabecera, pero cuerpo inválido.
    const badJson = await fetch(`${api.base}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lifecode-rag': '1' },
      body: '{',
    });
    assert.equal(badJson.status, 400);
  } finally {
    api.server.close();
    box.cleanup();
  }
});

test('snapshot, fuentes y búsqueda usan el motor real', async () => {
  const box = tempRoot('rag-api');
  const api = await startApi(box.root);
  try {
    const cwd = join(box.root, 'proyecto');
    mkdirSync(cwd, { recursive: true });
    const path = join(cwd, 'guia.md');
    writeFileSync(path, '# Guía\n\nLa instalación usa el comando init.\n', 'utf8');
    const config = validateConfig({});
    await ingestFiles({ root: box.root, files: [path], config });

    const snapshot = (await (await fetch(`${api.base}/snapshot`)).json()).data;
    assert.equal(snapshot.counts.sources, 1);
    assert.equal(snapshot.store.initialized, true);
    assert.equal(snapshot.health.ok, true);

    const sources = (await (await fetch(`${api.base}/sources`)).json()).data;
    assert.equal(sources.total, 1);
    assert.equal(sources.rows[0].chunks, 1);

    const found = (await (await post(api.base, '/search', { query: 'instalación', limit: 3 })).json()).data;
    assert.ok(found.results.length >= 1);
    assert.match(found.results[0].text, /instalación/i);
    assert.equal(found.diagnostics.strategy, 'hybrid');
    assert.ok(found.elapsedMs >= 0);
  } finally {
    api.server.close();
    box.cleanup();
  }
});

test('ingesta por panel, forget con confirmación y config persistida', async () => {
  const box = tempRoot('rag-api');
  const store = join(box.root, 'almacen');
  const api = await startApi(store);
  try {
    const cwd = join(box.root, 'proyecto');
    mkdirSync(cwd, { recursive: true });
    const path = join(cwd, 'a.md');
    writeFileSync(path, 'contenido para el panel', 'utf8');

    const ingested = await post(api.base, '/actions', { action: 'ingest', payload: { paths: [path], cwd, tags: ['panel'] } });
    assert.equal(ingested.status, 200);
    const ingestedBody = await ingested.json();
    assert.equal(ingestedBody.data.ingested.length, 1);
    const id = ingestedBody.data.ingested[0].id;

    const forgetRefused = await post(api.base, '/actions', { action: 'forget', payload: { ref: id } });
    assert.equal(forgetRefused.status, 409);

    const forget = await post(api.base, '/actions', { action: 'forget', payload: { ref: id }, confirm: true });
    assert.equal(forget.status, 200);
    const sources = (await (await fetch(`${api.base}/sources`)).json()).data;
    assert.equal(sources.total, 0);

    const configured = await post(api.base, '/actions', { action: 'config', patch: { search: { strategy: 'fts' } } });
    assert.equal(configured.status, 200);
    const after = (await (await fetch(`${api.base}/config`)).json()).data;
    assert.equal(after.config.search.strategy, 'fts');

    const opened = openDatabase({ root: store, create: false });
    try {
      assert.ok(opened.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE actor = 'ui'").get().n >= 2);
    } finally {
      closeDatabase(opened.db);
    }
  } finally {
    api.server.close();
    box.cleanup();
  }
});
