/**
 * Lee un fichero de app.asar usando el índice ya generado (sólo lectura).
 * Uso:
 *   node asar-get.mjs <rutaDentroDelAsar>            → imprime el contenido (recortado a 200 KB)
 *   node asar-get.mjs <rutaDentroDelAsar> --grep <re> [--ctx N]  → imprime líneas que casan
 */
import { readFileSync } from 'node:fs';

const ASAR = 'C:\\Users\\BYRON\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';
const IDX = 'C:\\xampp\\htdocs\\plugins-dhs\\_audit\\asar-index.json';

const [, , ruta, flag, patron, ctxFlag, ctxRaw] = process.argv;
if (!ruta) { console.error('uso: node asar-get.mjs <ruta> [--grep <regex> [--ctx N]]'); process.exit(2); }

const idx = JSON.parse(readFileSync(IDX, 'utf8'));
const entry = idx.find((e) => e.path === ruta);
if (!entry) {
  const parecidos = idx.filter((e) => e.path.includes(ruta.split('/').pop())).slice(0, 8).map((e) => e.path);
  console.error(`no encontrado: ${ruta}`);
  if (parecidos.length) console.error('parecidos:\n  ' + parecidos.join('\n  '));
  process.exit(1);
}

const buffer = readFileSync(ASAR);
const contenido = buffer.subarray(entry.start, entry.start + entry.size).toString('utf8');

if (flag === '--grep') {
  const re = new RegExp(patron, 'i');
  const ctx = ctxFlag === '--ctx' ? Number(ctxRaw) : 0;
  const lineas = contenido.split('\n');
  let salida = 0;
  for (let i = 0; i < lineas.length; i += 1) {
    if (!re.test(lineas[i])) continue;
    const desde = Math.max(0, i - ctx);
    const hasta = Math.min(lineas.length - 1, i + ctx);
    for (let j = desde; j <= hasta; j += 1) {
      console.log(`${String(j + 1).padStart(6)}| ${lineas[j].slice(0, 300)}`);
    }
    console.log('      | ---');
    salida += 1;
    if (salida >= 40) { console.log('(más resultados omitidos)'); break; }
  }
  if (salida === 0) console.log('(sin coincidencias)');
} else {
  process.stdout.write(contenido.slice(0, 200000));
}
