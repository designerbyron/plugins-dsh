// Extrae de la captura saneada las entradas y colisiones del caso "misma skill propia en registro y materializado".
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[2];
const out = process.argv[3];
const data = JSON.parse(readFileSync(file, 'utf8'));
const inv = data.inventory || {};
const entries = Array.isArray(inv.entries) ? inv.entries : [];
const mined = entries.filter((e) => String(e.name || '').includes('revisar-un-plugin'));
const collisions = (inv.collisions || []).filter(
  (c) => c.code === 'assignment-shadowed' || String(c.key || '').includes('revisar-un-plugin'),
);
const text = JSON.stringify({ entries: mined, collisions }, null, 1);
writeFileSync(out, text, 'utf8');
console.log(`entries=${mined.length} collisions=${collisions.length} -> ${out}`);
