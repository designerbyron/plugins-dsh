/** Escribe MANIFIESTO.sha256 (LF, `hash *ruta`) en el directorio de respaldo y lo verifica. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const BK = process.argv[2];
if (!BK) { console.error('uso: node make-backup-manifest.mjs <dir-respaldo>'); process.exit(2); }

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (statSync(path).isFile()) out.push(path);
  }
  return out;
};

const destino = join(BK, 'MANIFIESTO.sha256');
const lineas = walk(BK)
  .filter((path) => path !== destino)
  .map((path) => `${createHash('sha256').update(readFileSync(path)).digest('hex')} *${relative(BK, path).split(sep).join('/')}`)
  .sort();

writeFileSync(destino, Buffer.from(`${lineas.join('\n')}\n`, 'utf8'));
console.log(`MANIFIESTO.sha256: ${lineas.length} ficheros`);
