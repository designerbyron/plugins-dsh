/**
 * Enlaza el anexo de límites desde los documentos de evidencia y comprueba que no quedó mojibake.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const audit = process.cwd();
const line = '- Límites y categorías de evidencia: [ANEXO-LIMITES.md](ANEXO-LIMITES.md).';

const targets = [
  { file: 'ACEPTACION.md', anchor: '## Lo que queda reservado a una persona' },
  { file: 'INFORME-PRODUCTO.md', anchor: '## ' },
];

for (const { file, anchor } of targets) {
  const path = join(audit, file);
  if (!existsSync(path)) {
    console.log(`${file}: no existe`);
    continue;
  }
  let text = readFileSync(path, 'utf8');
  if (text.includes('ANEXO-LIMITES.md')) {
    console.log(`${file}: ya enlazaba el anexo`);
    continue;
  }
  const index = text.indexOf(anchor);
  if (index < 0) {
    console.log(`${file}: ancla no encontrada, se añade al final`);
    text += `\n${line}\n`;
  } else {
    text = `${text.slice(0, index)}${line}\n\n${text.slice(index)}`;
  }
  writeFileSync(path, text, 'utf8');
  console.log(`${file}: enlace añadido`);
  const check = readFileSync(path, 'utf8');
  console.log(`${file}: ${check.includes('\uFFFD') ? 'TIENE U+FFFD' : 'sin U+FFFD'}`);
}
