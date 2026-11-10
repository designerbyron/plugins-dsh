#!/usr/bin/env node
/**
 * Test-of-tests: ejecuta `tests/adversarial.test.mjs` y traduce su resultado TAP a las doce
 * preguntas de la disciplina adversarial. Sale 0 sólo si las doce responden VERDE y la suite
 * termina en 0; cualquier otra cosa (rojo, falta, error de arranque) sale 1.
 *
 * Se puede ejecutar desde cualquier carpeta: resuelve la raíz del plugin a partir de este archivo.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TEST_FILE = join(ROOT, 'tests', 'adversarial.test.mjs');

const QUESTIONS = [
  ['P01', '¿La prueba puede fallar?'],
  ['P02', '¿Mide comportamiento o implementación?'],
  ['P03', '¿Tiene un caso negativo?'],
  ['P04', '¿Falla si el código desaparece?'],
  ['P05', '¿Está acoplada a nombres internos?'],
  ['P06', '¿Hay aserciones tautológicas?'],
  ['P07', '¿El catch oculta errores?'],
  ['P08', '¿Siembra datos irreales?'],
  ['P09', '¿Es determinista?'],
  ['P10', '¿Usa el almacén real?'],
  ['P11', '¿Prueba el borde y no sólo el camino feliz?'],
  ['P12', '¿Un cambio legítimo la rompe?'],
];

if (!existsSync(TEST_FILE)) {
  console.error(`No existe el test-of-tests: ${TEST_FILE}`);
  process.exit(1);
}

const env = { ...process.env };
// Si este script se ejecuta dentro de otro `node --test`, el hijo hereda la marca y Node se salta
// el archivo. Es el mismo falso verde que la meta-prueba P07 mide dentro del propio test.
delete env.NODE_TEST_CONTEXT;

const started = Date.now();
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', TEST_FILE], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 180_000,
  env,
});
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const elapsed = ((Date.now() - started) / 1000).toFixed(2);

const results = new Map();
for (const line of output.split(/\r?\n/)) {
  const match = line.match(/^(not ok|ok) \d+ - (P\d{2}|D3|D4|D5|PROP-\d)\b\s*(.*)$/);
  if (match !== null) {
    results.set(match[2], { ok: match[1] === 'ok', title: match[3].trim() });
  }
}

const numberFrom = (pattern) => {
  const found = output.match(pattern);
  return found === null ? null : Number(found[1]);
};
const passed = numberFrom(/^# pass (\d+)$/m) ?? 0;
const failed = numberFrom(/^# fail (\d+)$/m) ?? 0;

console.log('TEST-OF-TESTS — lifecode-skill-center');
console.log(`Archivo: ${TEST_FILE}`);
console.log(`Motor:   node --test (TAP), ${elapsed}s`);
console.log('');

let missingOrRed = false;
for (const [id, question] of QUESTIONS) {
  const result = results.get(id);
  const status = result === undefined ? 'FALTA' : result.ok ? 'VERDE' : 'ROJO';
  if (status !== 'VERDE') missingOrRed = true;
  console.log(`${id}  ${question.padEnd(52, ' ')} ${status}`);
  if (result !== undefined && result.title !== '') {
    console.log(`     medido: ${result.title}`);
  }
}

console.log('');
const extras = ['D3', 'D4', 'D5', 'PROP-1', 'PROP-2', 'PROP-3']
  .map((id) => {
    const result = results.get(id);
    return `${id}:${result === undefined ? 'FALTA' : result.ok ? 'VERDE' : 'ROJO'}`;
  })
  .join('  ');
console.log(`Arreglos y propiedades  ${extras}`);
console.log(`Resumen: ${passed} verdes, ${failed} rojas, ${results.size} casos reconocidos`);

if (run.error !== undefined) {
  console.error(`\nNo se pudo ejecutar el test-of-tests: ${run.error.message}`);
  process.exit(1);
}
if (output.trim() === '') {
  console.error('\nEl test-of-tests no produjo salida: se trata como fallo, no como verde.');
  process.exit(1);
}
if (failed > 0 || missingOrRed || run.status !== 0) {
  if (failed > 0) {
    console.error('\nFallos declarados por el runner:');
    for (const line of output.split(/\r?\n/)) {
      if (line.startsWith('not ok ')) console.error(`  ${line}`);
    }
  }
  process.exit(1);
}

console.log('\nVeredicto: las doce preguntas están medidas y verdes.');
process.exit(0);
