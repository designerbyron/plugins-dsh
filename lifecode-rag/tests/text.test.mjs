/**
 * Extracción, normalización y chunking: la puerta por la que entra todo el conocimiento.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkText } from '../lib/chunk.mjs';
import {
  extractDelimited,
  extractHtml,
  extractText,
  isProbablyBinary,
  normalizeText,
} from '../lib/extract.mjs';
import { RagError } from '../lib/errors.mjs';

const bytesOf = (text) => new TextEncoder().encode(text);

test('UTF-8 con BOM y CRLF se normaliza sin arrastrar el BOM', () => {
  const text = extractText(new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf('hola\r\nmundo\r\n')]), { path: 'C:/x/a.md' }).text;
  assert.equal(text, 'hola\nmundo');
});

test('un fichero binario se rechaza aunque la extensión sea textual', () => {
  const bytes = new Uint8Array([0x50, 0x4b, 0x00, 0x04, 0x00]);
  assert.equal(isProbablyBinary(bytes), true);
  assert.throws(() => extractText(bytes, { path: 'C:/x/a.txt' }), (error) => error.code === 'binary-file');
});

test('un formato no soportado se rechaza con motivo, no se indexa a ciegas', () => {
  assert.throws(() => extractText(bytesOf('x'), { path: 'C:/x/a.pdf' }), (error) => error.code === 'path-unsupported');
});

test('HTML: fuera script/style/comentarios, bloques a saltos, entidades decodificadas', () => {
  const html = '<html><head><title>Guía</title><style>p{color:red}</style></head><body>'
    + '<h1>Instalación</h1><script>alert(1)</script><p>Usa <b>npm</b> &amp; listo.</p>'
    + '<ul><li>uno</li><li>dos</li></ul><!-- secreto --></body></html>';
  const text = extractHtml(html);
  assert.doesNotMatch(text, /alert|color:red|secreto/);
  assert.match(text, /Instalación/);
  assert.match(text, /npm & listo/);
  assert.match(text, /uno\ndos/);
});

test('JSON inválido y JSONL inválido fallan; JSON válido se aplana con claves', () => {
  assert.throws(() => extractText(bytesOf('{ roto'), { path: 'a.json' }), (error) => error.code === 'source-unreadable');
  assert.throws(() => extractText(bytesOf('{"a":1}\n{roto}'), { path: 'a.jsonl' }), (error) => error.code === 'source-unreadable');
  const text = extractText(bytesOf('{"proyecto":"LifeCode","tags":["rag","local"]}'), { path: 'a.json' }).text;
  assert.match(text, /proyecto: LifeCode/);
  assert.match(text, /tags\[\]: rag/);
});

test('CSV con comillas, comas y comillas escapadas se convierte en filas legibles', () => {
  const text = extractDelimited('nombre,nota\n"Vanegas, Byron","dice ""hola"""\n', ',');
  assert.match(text, /nombre = Vanegas, Byron/);
  assert.match(text, /nota = dice "hola"/);
  assert.match(text, /^fila 1:/);
});

test('normalizeText es idempotente', () => {
  const once = normalizeText('  a\r\n\r\n\r\nb\t \n c  d  ');
  assert.equal(normalizeText(once), once);
});

test('chunkText: cobertura contigua, offsets exactos, límites y solape', () => {
  const paragraph = 'Frase de relleno con varias palabras para que el corte tenga dónde caer. ';
  const text = Array.from({ length: 90 }, (_, i) => `## Sección ${i % 5}\n\n${paragraph.repeat(3)}`).join('\n\n');
  const chunks = chunkText(text, { targetChars: 1_000, maxChars: 1_600, overlapChars: 100 });
  assert.ok(chunks.length > 3);
  chunks.forEach((chunk, index) => {
    assert.equal(chunk.ordinal, index);
    assert.ok(chunk.text.length <= 1_600, `chunk ${index} supera maxChars`);
    assert.equal(text.slice(chunk.charStart, chunk.charEnd), chunk.text);
    assert.ok(chunk.tokenEst > 0);
    if (index < chunks.length - 1) {
      assert.ok(chunks[index + 1].charStart < chunk.charEnd, 'sin solape entre chunks consecutivos');
    }
  });
});

test('chunkText asigna el encabezado vigente y no inventa chunks vacíos', () => {
  const text = `## Uno\n\n${'alfa '.repeat(30)}\n\n## Dos\n\n${'beta '.repeat(30)}`;
  const chunks = chunkText(text, { targetChars: 80, maxChars: 140, overlapChars: 0 });
  assert.ok(chunks.some((chunk) => chunk.heading === 'Uno'));
  assert.ok(chunks.some((chunk) => chunk.heading === 'Dos'));
  assert.equal(chunkText('   \n\n ', {}).length, 0);
});

test('chunkText rechaza límites incoherentes', () => {
  assert.throws(() => chunkText('hola', { targetChars: 0 }), (error) => error instanceof RagError && error.code === 'invalid-config');
  assert.throws(() => chunkText('hola', { targetChars: 100, maxChars: 50 }), (error) => error.code === 'invalid-config');
});
