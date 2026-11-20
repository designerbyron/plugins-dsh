/**
 * Prueba hermética: mide el almacén vivo antes y después de la suite completa.
 *
 * La suite usa raíces temporales; esta puerta demuestra que **nada real cambió**. Si el almacén no existe,
 * no hay nada que proteger y la comprobación lo dice explícitamente.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ragRoot } from '../lib/paths.mjs';

function fingerprint(root) {
  if (!existsSync(root)) return { exists: false, files: 0, hash: null };
  const lines = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const stats = statSync(path);
        const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
        lines.push(`${relative(root, path)}|${stats.size}|${stats.mtimeMs}|${hash}`);
      }
    }
  };
  walk(root);
  lines.sort();
  return {
    exists: true,
    files: lines.length,
    hash: createHash('sha256').update(lines.join('\n')).digest('hex'),
  };
}

const root = ragRoot(process.env);
const before = fingerprint(root);
console.log(`almacén vivo: ${root}`);
console.log(before.exists ? `huella previa: ${before.files} fichero(s) ${before.hash.slice(0, 16)}…` : 'huella previa: no existe (nada que proteger)');

const run = spawnSync(process.execPath, ['--test'], { stdio: 'inherit', cwd: fileURLToPath(new URL('..', import.meta.url)) });
const after = fingerprint(root);

if (before.exists !== after.exists || before.hash !== after.hash || before.files !== after.files) {
  console.error('✗ la suite tocó el almacén real');
  console.error(`  antes: ${JSON.stringify(before)}`);
  console.error(`  después: ${JSON.stringify(after)}`);
  process.exit(1);
}
console.log(before.exists ? `✓ hermético: el almacén real no cambió (${after.files} fichero(s))` : '✓ hermético: el almacén real sigue sin existir');
process.exit(run.status ?? 1);
