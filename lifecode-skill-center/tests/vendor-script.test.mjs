/**
 * K8-B5 · E4/E11 contra un adaptador sintético original, nunca contra el script de terceros.
 * Sin red, sin clave real y sin instalación: cada modo de fallo se inyecta por variables de entorno.
 */
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { validateHardenedScript } from '../lib/vendor.mjs';
import { SYNTHETIC_ADAPTER_SCRIPT } from './fixtures/synthetic-source.mjs';

const fixtureDir = fileURLToPath(new URL('fixtures/', import.meta.url));
const TEST_KEY = 'TEST-KEY-DO-NOT-USE';

function findBash() {
  const candidates = [
    process.env.LSC_BASH,
    'C:/Program Files/Git/bin/bash.exe',
    '/usr/bin/bash',
    '/bin/bash',
    'bash',
  ].filter((value) => typeof value === 'string' && value !== '');
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (probe.status === 0 && /GNU bash|bash, version/i.test(`${probe.stdout ?? ''}${probe.stderr ?? ''}`)) return candidate;
  }
  return null;
}

const BASH = findBash();

function sandbox(mode = 'ok', { body = undefined, withKey = false } = {}) {
  const root = join(tmpdir(), `lsc-vendor-script-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const adapter = join(root, 'synthetic-adapter.sh');
  writeFileSync(adapter, SYNTHETIC_ADAPTER_SCRIPT, { mode: 0o755 });
  copyFileSync(join(fixtureDir, 'fake-curl.sh'), join(bin, 'curl'));
  copyFileSync(join(fixtureDir, 'fake-jq.sh'), join(bin, 'jq'));
  chmodSync(join(bin, 'curl'), 0o755);
  chmodSync(join(bin, 'jq'), 0o755);
  const argvLog = join(root, 'argv.log');
  const headerLog = join(root, 'header.log');
  writeFileSync(argvLog, '');
  writeFileSync(headerLog, '');
  const env = {
    CURL_BIN: join(bin, 'curl'),
    JQ_BIN: join(bin, 'jq'),
    FAKE_CURL_LOG: argvLog,
    FAKE_CURL_HEADER_LOG: headerLog,
    FAKE_CURL_MODE: mode,
    FAKE_JQ_HELPER: join(fixtureDir, 'fake-jq-helper.mjs'),
    API_KEY: withKey ? TEST_KEY : '',
  };
  if (body !== undefined) env.FAKE_CURL_BODY = body;
  return {
    adapter, env, argvLog, headerLog, root,
    argv: () => readFileSync(argvLog, 'utf8'),
    headers: () => readFileSync(headerLog, 'utf8'),
  };
}

function run(box, args, options = {}) {
  assert.ok(BASH, 'este entorno no tiene bash; no se puede probar el adaptador');
  return spawnSync(BASH, [box.adapter, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, ...box.env, ...options.env },
  });
}

test('el adaptador sintético es válido y pasa la comprobación estática V11', () => {
  const box = sandbox();
  assert.ok(BASH);
  const syntax = spawnSync(BASH, ['-n', box.adapter], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  const source = readFileSync(box.adapter, 'utf8');
  assert.equal(validateHardenedScript(source, { original: source }).ok, true);
  assert.equal(/\beval\s/.test(source), false);
  assert.equal(/(^|[^A-Za-z])source\s/.test(source), false);
});

test('búsqueda correcta: la clave va por stdin, nunca en argv ni en la salida', () => {
  const box = sandbox('ok', { body: '{"results":[{"id":"/facebook/react","title":"React","totalSnippets":42,"benchmarkScore":9}]}', withKey: true });
  const result = run(box, ['search', 'react']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ID: \/facebook\/react/);
  assert.match(box.argv(), /query=react/);
  assert.equal(box.argv().includes(TEST_KEY), false);
  assert.match(box.headers(), new RegExp(`Authorization: Bearer ${TEST_KEY}`));
  assert.equal(result.stdout.includes(TEST_KEY), false);
});

test('4xx/5xx/timeout/DNS/cuerpo inválido tienen códigos deterministas y sin secretos', () => {
  const cases = [
    ['http4xx', 2, 'HTTP 404'],
    ['http5xx', 3, 'HTTP 503'],
    ['timeout', 4, 'timeout'],
    ['dns', 5, 'resolver o conectar'],
    ['invalid', 6, 'no es JSON'],
  ];
  for (const [mode, expected, message] of cases) {
    const box = sandbox(mode, { withKey: true });
    const result = run(box, ['search', 'react']);
    assert.equal(result.status, expected, `${mode}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, new RegExp(message));
    assert.equal(`${result.stdout}${result.stderr}`.includes(TEST_KEY), false, mode);
  }
});

test('entrada especial: query y topic codificados, segmentos del library-id conservados', () => {
  const searchBox = sandbox('ok', { body: '{"results":[]}' });
  const search = run(searchBox, ['search', 'a b&c']);
  assert.equal(search.status, 0, search.stderr);
  assert.match(searchBox.argv(), /query=a%20b%26c/);

  const docsBox = sandbox('ok', { body: 'documentación de prueba' });
  const docs = run(docsBox, ['docs', '/facebook/react', 'app router']);
  assert.equal(docs.status, 0, `${docs.stdout}\n${docs.stderr}`);
  assert.match(docsBox.argv(), /docs\/code\/facebook\/react\?type=txt&topic=app%20router/);
  assert.match(docs.stdout, /documentación de prueba/);
});

test('un library-id con escape se rechaza antes de construir la URL', () => {
  const box = sandbox('ok');
  const result = run(box, ['docs', '../secreto']);
  assert.equal(result.status, 64, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /library-id no válido/);
  assert.equal(box.argv(), '');
});

test('el modo sin clave no intenta cabecera de autorización', () => {
  const box = sandbox('ok');
  const result = run(box, ['search', 'react']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(box.headers(), '');
});
