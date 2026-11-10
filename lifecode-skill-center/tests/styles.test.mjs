/**
 * Directiva §10 · el panel tiene que caber en 390/768/1280/1440 px.
 *
 * Sin navegador se puede medir lo que de verdad se rompe: que existan los cortes y que **cada selector**
 * de esos cortes apunte a una clase que el panel realmente usa. La segunda mitad es la que evita el fallo
 * silencioso: una regla dentro de `@media` sobre una clase inexistente no hace nada y nadie la nota.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

/** Todos los bloques `@media (...) { ... }` con su contenido, contando llaves. */
function mediaBlocks(text) {
  const blocks = [];
  const needle = '@media';
  let index = text.indexOf(needle);
  while (index >= 0) {
    const open = text.indexOf('{', index);
    let depth = 0;
    let cursor = open;
    for (; cursor < text.length; cursor += 1) {
      if (text[cursor] === '{') depth += 1;
      else if (text[cursor] === '}') {
        depth -= 1;
        if (depth === 0) {
          cursor += 1;
          break;
        }
      }
    }
    blocks.push({ header: text.slice(index, open), body: text.slice(open, cursor) });
    index = text.indexOf(needle, cursor);
  }
  return blocks;
}

test('hay cortes para tableta y móvil, además del de escritorio estrecho', () => {
  const blocks = mediaBlocks(source);
  const headers = blocks.map((block) => block.header);
  assert.ok(headers.some((header) => /max-width:\s*1080px/.test(header)), 'corte de escritorio estrecho');
  assert.ok(headers.some((header) => /max-width:\s*760px/.test(header)), 'corte de tableta (768 px)');
  assert.ok(headers.some((header) => /max-width:\s*430px/.test(header)), 'corte de móvil (390 px)');
});

test('cada selector de los cortes apunta a una clase que el panel usa', () => {
  // Una clase aparece dos veces cuando de verdad se usa: la regla y el `className` del panel. Si sólo
  // aparece dentro de un `@media`, la regla no hace nada y el fallo es invisible en la ventana.
  const counts = new Map();
  for (const match of source.matchAll(/lsc-[a-z0-9-]+/g)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }

  const dead = [];
  for (const block of mediaBlocks(source)) {
    for (const match of block.body.matchAll(/\.(lsc-[a-z0-9-]+)/g)) {
      const name = match[1];
      if ((counts.get(name) ?? 0) < 2) dead.push(`${name} (${block.header.trim()})`);
    }
  }
  assert.deepEqual(dead, [], 'una regla sobre una clase que no existe no hace nada: ' + dead.join(', '));
});

test('el móvil no deja ninguna rejilla de seis columnas ni barras de ancho fijo', () => {
  const phone = mediaBlocks(source).find((block) => /max-width:\s*430px/.test(block.header));
  assert.ok(phone, 'hace falta el bloque de móvil');
  assert.match(phone.body, /\.lsc-kpis\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  const tablet = mediaBlocks(source).find((block) => /max-width:\s*760px/.test(block.header));
  assert.match(tablet.body, /\.lsc-rail\s*\{[^}]*flex-direction:\s*row/);
});

test('en tableta y en móvil el cuerpo se apila y el rail deja de ocupar 196 px', () => {
  // El riel fijo es lo que cortaba el contenido a 430 px en la ventana real: apilar `.lsc-wrap` no basta,
  // porque la fila rail+contenido es `.lsc-body`.
  for (const width of ['760px', '430px']) {
    const block = mediaBlocks(source).find((entry) => entry.header.includes(width));
    assert.ok(block, `falta el bloque de ${width}`);
    assert.match(block.body, /\.lsc-body\s*\{[^}]*flex-direction:\s*column/, `el cuerpo tiene que apilarse en ${width}`);
  }
  const tablet = mediaBlocks(source).find((block) => /max-width:\s*760px/.test(block.header));
  assert.match(tablet.body, /\.lsc-rail\s*\{[^}]*width:\s*auto/, 'el rail no puede conservar su ancho fijo');
});
