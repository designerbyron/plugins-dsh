/**
 * Puerta hermética: las pruebas no pueden tocar el almacén real.
 *
 * La regla de la casa no es «las pruebas usan una carpeta temporal» —eso se puede olvidar en un fichero
 * nuevo— sino que **se mide**. Esta puerta toma una huella del almacén real, corre la suite entera en un
 * proceso hijo y vuelve a tomar la huella: si algo cambió, falla y dice qué.
 *
 * La huella incluye nombre, tamaño y sha256 de cada fichero, así que un cambio de contenido con el mismo
 * tamaño también se ve.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultRoot } from '../lib/state.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');

/** Los almacenes que esta suite no puede tocar. */
const WATCHED = [
  { name: 'centro de skills', path: defaultRoot() },
  { name: 'biblioteca de usuario', path: join(dirname(defaultRoot()), 'skills') },
];

function digest(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch (error) {
    return `error:${error.code ?? 'desconocido'}`;
  }
}

function walk(dir, base = dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, base, out);
    else out.push({ path: relative(base, path), size: (() => { try { return statSync(path).size; } catch { return -1; } })(), sha256: digest(path) });
  }
  return out;
}

function fingerprint() {
  return WATCHED.map(({ name, path }) => ({
    name,
    path,
    exists: existsSync(path),
    files: existsSync(path) ? walk(path) : [],
  }));
}

function compare(before, after) {
  const problems = [];
  for (let index = 0; index < before.length; index += 1) {
    const left = before[index];
    const right = after[index];
    if (left.exists !== right.exists) {
      problems.push(`${left.name}: ${left.exists ? 'desapareció' : 'apareció'} (${left.path})`);
      continue;
    }
    const leftByPath = new Map(left.files.map((file) => [file.path, file]));
    const rightByPath = new Map(right.files.map((file) => [file.path, file]));
    for (const [path, file] of leftByPath) {
      const other = rightByPath.get(path);
      if (other === undefined) problems.push(`${left.name}: se borró ${path}`);
      else if (other.sha256 !== file.sha256) problems.push(`${left.name}: cambió ${path}`);
    }
    for (const path of rightByPath.keys()) if (!leftByPath.has(path)) problems.push(`${left.name}: apareció ${path}`);
  }
  return problems;
}

const before = fingerprint();

const runner = process.platform === 'win32' ? process.execPath : process.execPath;
const result = spawnSync(runner, ['--test', '--test-timeout=30000'], {
  cwd: packageRoot,
  encoding: 'utf8',
  env: { ...process.env, LIFECODE_SKILL_CENTER_ROOT: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const after = fingerprint();
const problems = compare(before, after);

if (result.stdout) process.stdout.write(result.stdout.split('\n').slice(-12).join('\n'));
if (result.status !== 0) {
  process.stderr.write(result.stderr ?? '');
  process.stderr.write('\n✖ la suite no está en verde: arregla eso antes de mirar la hermeticidad\n');
  process.exit(result.status ?? 1);
}

if (problems.length > 0) {
  process.stderr.write('\n✖ las pruebas tocaron el almacén real:\n');
  for (const problem of problems) process.stderr.write(`  · ${problem}\n`);
  process.exit(1);
}

for (const store of after) {
  process.stdout.write(`✓ ${store.name}: ${store.exists ? `${store.files.length} fichero(s) intactos` : 'no existe, y sigue sin existir'} (${store.path})\n`);
}
process.stdout.write('✓ hermético: la suite entera corrió sin tocar nada real\n');
