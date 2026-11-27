/**
 * E5 / V10: preflight de curl y jq sin red, sin instalación y sin mutar el entorno.
 * El doble `run` sustituye a los binarios; por eso la prueba no depende de lo instalado en el host.
 */
import assert from 'node:assert/strict';
import { chmodSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { checkRuntimeDependencies, MIN_CURL_VERSION, MIN_JQ_VERSION } from '../lib/vendor.mjs';
import { tempRoot } from './helpers.mjs';

const runOk = (bin) => ({
  status: 0,
  stdout: bin.includes('curl') ? `curl 8.22.0 (Windows)` : 'jq-1.8.2',
  stderr: '',
});

test('V10 verde: versiones suficientes y mensaje que prohíbe instalación automática', () => {
  const result = checkRuntimeDependencies({ run: runOk });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'V10');
  assert.deepEqual(result.errors, []);
  assert.equal(result.curl.version, '8.22.0');
  assert.equal(result.jq.version, '1.8.2');
  assert.equal(result.messages.some((message) => message.includes('Sin instalación automática')), true);
  assert.equal(result.messages.some((message) => message.includes('PATH global')), true);
});

test('sin jq: error accionable, sin instalación y sin lanzar un instalador', () => {
  const launched = [];
  const result = checkRuntimeDependencies({
    run: (bin, args, options) => {
      launched.push(bin);
      if (bin === 'jq') return { status: 127, stdout: '', stderr: 'jq: command not found' };
      return runOk(bin, args, options);
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('DEPENDENCY_MISSING: jq')));
  assert.ok(result.errors.every((error) => error.includes('manually and retry') && error.includes('No installation was performed.')));
  assert.deepEqual(launched, ['curl', 'jq']);
});

test('curl antiguo o ausente se rechaza por versión mínima', () => {
  const old = checkRuntimeDependencies({
    run: (bin) => bin.includes('curl')
      ? { status: 0, stdout: 'curl 7.54.0', stderr: '' }
      : runOk(bin),
  });
  assert.equal(old.ok, false);
  assert.ok(old.errors.some((error) => error.includes(`curl >= ${MIN_CURL_VERSION}`)));
  const missing = checkRuntimeDependencies({
    run: (bin) => bin.includes('curl')
      ? { status: 127, stdout: '', stderr: 'curl: no encontrado' }
      : runOk(bin),
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.includes('DEPENDENCY_MISSING: curl')));
  assert.ok(MIN_JQ_VERSION.length > 0);
});

test('un intérprete declarado que falla bloquea', () => {
  const badShell = checkRuntimeDependencies({ run: (bin) => bin === 'bash-x' ? { status: 127, stdout: '' } : runOk(bin), shellBin: 'bash-x' });
  assert.equal(badShell.ok, false);
  assert.ok(badShell.errors.some((error) => error.includes('intérprete')));
});

test('un script ejecutable pasa el preflight', () => {
  const root = tempRoot('lsc-vendor-deps-ok');
  const script = join(root, 'context7.sh');
  writeFileSync(script, '#!/bin/bash\nprintf ok\n', 'utf8');
  chmodSync(script, 0o755);
  assert.equal(checkRuntimeDependencies({ run: runOk, scriptPath: script }).ok, true);
});

test('el preflight no muta PATH ni escribe en la raíz del centro', () => {
  const pathBefore = process.env.PATH;
  const root = tempRoot('lsc-vendor-deps-immutable');
  const before = new Set(children(root));
  checkRuntimeDependencies({ run: runOk });
  assert.equal(process.env.PATH, pathBefore);
  assert.deepEqual(new Set(children(root)), before);
});

function children(root) {
  return readdirSync(root).sort();
}
