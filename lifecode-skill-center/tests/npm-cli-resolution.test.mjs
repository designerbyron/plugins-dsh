/**
 * K8-I-D · Resolución portátil del CLI de npm para la auditoría del tarball.
 *
 * Las pruebas inyectan `stat` y `spawn`: no instalan paquetes, no ejecutan npm real ni contenido
 * externo. Sólo verifican la prioridad, la validación de fichero regular y el diagnóstico.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveNpmCli } from '../tools/package-audit.mjs';

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'lsc-npm-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function cliFile(root, relative) {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '// CLI sintético para pruebas\n', 'utf8');
  return path;
}

test('npm_execpath válido se usa como primera opción y no sondea el global', (t) => {
  const root = sandbox(t);
  const cli = cliFile(root, 'execpath/npm-cli.js');
  let spawned = 0;
  const spawn = () => { spawned += 1; throw new Error('no debería invocarse'); };

  const result = resolveNpmCli({ env: { npm_execpath: cli }, stat: statSync, spawn });
  assert.equal(result.npmCli, cli);
  assert.equal(result.source, 'npm_execpath');
  assert.equal(result.error, null);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].valid, true);
  assert.equal(spawned, 0);
});

test('sin npm_execpath se resuelve el CLI global informado por npm root -g', (t) => {
  const root = sandbox(t);
  const globalRoot = join(root, 'global', 'node_modules');
  const cli = cliFile(globalRoot, 'npm/bin/npm-cli.js');
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: `aviso no relevante\n${globalRoot}\n`, stderr: '' };
  };

  const result = resolveNpmCli({
    env: {}, execPath: join(root, 'bin', 'node'), platform: 'linux', root, stat: statSync, spawn,
  });
  assert.equal(result.npmCli, cli);
  assert.match(result.source, /^npm root -g/);
  assert.equal(result.error, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'npm');
  assert.deepEqual(calls[0].args, ['root', '-g']);
  assert.equal(calls[0].options.shell, undefined, 'sin shell');
});

test('en Windows el sondeo usa npm.cmd y el CLI global con barras invertidas', (t) => {
  const root = sandbox(t);
  const globalRoot = join(root, 'AppData', 'npm', 'node_modules');
  const cli = cliFile(globalRoot, 'npm/bin/npm-cli.js');
  const calls = [];
  const spawn = (command, args) => {
    calls.push(command);
    return { status: 0, stdout: `${globalRoot}\r\n`, stderr: '' };
  };

  const result = resolveNpmCli({
    env: {}, execPath: join(root, 'nodejs', 'node.exe'), platform: 'win32', root, stat: statSync, spawn,
  });
  assert.equal(result.npmCli, cli);
  assert.deepEqual(calls, ['npm.cmd']);
});

test('sin ninguna opción válida falla con diagnóstico de todas las rutas comprobadas', (t) => {
  const root = sandbox(t);
  const spawn = () => ({ status: 1, stdout: '', stderr: 'npm no disponible' });

  const result = resolveNpmCli({
    env: {}, execPath: join(root, 'bin', 'node'), platform: 'linux', root, stat: statSync, spawn,
  });
  assert.equal(result.npmCli, null);
  assert.equal(result.source, null);
  assert.match(result.error, /No se pudo resolver npm-cli\.js/);
  for (const fragment of ['npm_execpath', 'npm root -g', 'process.execPath/lib/node_modules', 'process.execPath/node_modules', 'ninguna opción es un fichero regular']) {
    assert.ok(result.error.includes(fragment), `falta en el diagnóstico: ${fragment}`);
  }
  assert.ok(result.attempts.length >= 3);
  assert.ok(result.attempts.every((entry) => entry.valid === false));
});

test('no acepta rutas inexistentes ni directorios como CLI válido', (t) => {
  const root = sandbox(t);
  const directory = join(root, 'un-directorio');
  mkdirSync(directory, { recursive: true });
  const missing = join(root, 'no-existe', 'npm-cli.js');
  const globalRoot = join(root, 'global', 'node_modules');
  mkdirSync(join(globalRoot, 'npm', 'bin', 'npm-cli.js'), { recursive: true }); // el supuesto CLI es un directorio
  const spawn = () => ({ status: 0, stdout: `${globalRoot}\n`, stderr: '' });

  const result = resolveNpmCli({
    env: { npm_execpath: directory }, execPath: join(root, 'bin', 'node'), platform: 'linux', root, stat: statSync, spawn,
  });
  assert.equal(result.npmCli, null);
  assert.ok(result.attempts.some((entry) => entry.source === 'npm_execpath' && entry.reason === 'no es un fichero regular'));
  assert.ok(result.attempts.some((entry) => entry.source.startsWith('npm root -g') && entry.reason === 'no es un fichero regular'));

  const missingResult = resolveNpmCli({
    env: { npm_execpath: missing }, execPath: join(root, 'bin', 'node'), platform: 'linux', root, stat: statSync, spawn,
  });
  assert.equal(missingResult.npmCli, null);
  assert.ok(missingResult.attempts.some((entry) => entry.source === 'npm_execpath' && entry.reason.startsWith('no accesible:')));
});
