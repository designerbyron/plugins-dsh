import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { centerFile, loadState } from '../lib/state.mjs';
import { tempRoot } from './helpers.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WRITER = join(HERE, 'fixtures', 'writer.mjs');

function runWriter(root, base, tag, rounds) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRITER, root, base, tag, String(rounds)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

test('dos procesos escribiendo a la vez no se pisan: no se pierde ninguna escritura', async () => {
  const root = tempRoot('lsc-concurrente');
  const base = tempRoot('lsc-concurrente-cwd');
  const rounds = 8;

  const [left, right] = await Promise.all([
    runWriter(root, base, 'a', rounds),
    runWriter(root, base, 'b', rounds),
  ]);

  assert.equal(left.code, 0, `el escritor a falló: ${left.err}`);
  assert.equal(right.code, 0, `el escritor b falló: ${right.err}`);

  const projects = Object.keys(loadState(root).state.projects);
  assert.equal(projects.length, rounds * 2, 'cada apertura deja su proyecto: sin candado se perdían');
  assert.equal(existsSync(centerFile(root)), true);
  assert.equal(existsSync(`${centerFile(root)}.lock`), false, 'el candado no puede quedarse tomado');
});
