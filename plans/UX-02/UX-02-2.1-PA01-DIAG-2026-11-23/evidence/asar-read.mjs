/**
 * Lector de app.asar con índice construido desde la cabecera REAL del fichero (sólo lectura).
 *
 * Corrige el desplazamiento de 3 bytes del índice antiguo: el inicio de datos es `8 + u32@4`
 * (tamaño del pickle), no `16 + u32@12`.
 *
 * Uso:
 *   node asar-read.mjs <ruta>                      → contenido (recortado a 200 KB)
 *   node asar-read.mjs <ruta> --grep <re> [--ctx N]→ líneas que casan
 *   node asar-read.mjs --index <prefijo>           → lista rutas que empiezan por el prefijo
 */
import { readFileSync } from 'node:fs';

const ASAR = 'C:\\Users\\BYRON\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';

const buf = readFileSync(ASAR);
const jsonSize = buf.readUInt32LE(12);
const base = buf.readUInt32LE(4) + 8;
const header = JSON.parse(buf.subarray(16, 16 + jsonSize).toString('utf8'));

const entradas = [];
const walk = (node, path) => {
  if (!node.files) { entradas.push({ path, size: Number(node.size), offset: Number(node.offset), unpacked: Boolean(node.unpacked) }); return; }
  for (const [nombre, hijo] of Object.entries(node.files)) walk(hijo, `${path}/${nombre}`);
};
walk(header, '');

const [, , a, b, c, d] = process.argv;

if (a === '--index') {
  const prefijo = b || '/';
  for (const e of entradas.filter((x) => x.path.startsWith(prefijo))) console.log(String(e.size).padStart(9), e.path);
  process.exit(0);
}
if (!a) { console.error('uso: node asar-read.mjs <ruta> | --index <prefijo>'); process.exit(2); }

const entrada = entradas.find((e) => e.path === a);
if (!entrada) {
  const parecidos = entradas.filter((e) => e.path.includes(a.split('/').pop())).slice(0, 8).map((e) => e.path);
  console.error(`no encontrado: ${a}`);
  if (parecidos.length) console.error('parecidos:\n  ' + parecidos.join('\n  '));
  process.exit(1);
}
if (entrada.unpacked) { console.error(`desempaquetado: ${ASAR}.unpacked${a}`); process.exit(3); }

const contenido = buf.subarray(base + entrada.offset, base + entrada.offset + entrada.size).toString('utf8');

if (b === '--grep') {
  const re = new RegExp(c ?? '', 'i');
  const ctx = d === '--ctx' ? Number(process.argv[6]) : 0;
  const lineas = contenido.split('\n');
  let salida = 0;
  for (let i = 0; i < lineas.length; i += 1) {
    if (!re.test(lineas[i])) continue;
    for (let j = Math.max(0, i - ctx); j <= Math.min(lineas.length - 1, i + ctx); j += 1) {
      console.log(`${String(j + 1).padStart(6)}| ${lineas[j].slice(0, 300)}`);
    }
    console.log('      | ---');
    salida += 1;
    if (salida >= 40) { console.log('(más omitidos)'); break; }
  }
  if (salida === 0) console.log('(sin coincidencias)');
} else {
  process.stdout.write(contenido.slice(0, 200000));
}
