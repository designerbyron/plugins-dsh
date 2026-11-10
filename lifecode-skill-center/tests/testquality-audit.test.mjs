import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Esta prueba fija el resultado de la auditoría sobre la suite REAL del plugin.
// No es una prueba del producto: es un candado contra la regresión de la calidad
// de las pruebas. Si alguien arregla un hallazgo, esta lista debe bajar a mano;
// si aparece uno nuevo, el fallo dice qué regla y qué fichero.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TOOL = join(ROOT, 'tools', 'testquality.mjs');

function run() {
  const result = spawnSync(process.execPath, [TOOL, '--root', ROOT, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.stderr, '', 'el analizador no debe escribir en stderr');
  return { status: result.status, report: JSON.parse(result.stdout) };
}

// Cada hallazgo alto, con la prueba de que la línea reportada es la correcta:
// el patrón debe aparecer en esa misma línea del fichero auditado.
// Hallazgos altos que SIGUEN abiertos. Los cuatro que había aquí sobre salto simulado (paths),
// aguja numérica (render) y verde condicional (repair-api) se corrigieron en la ronda 13; el de
// ruta personal en backup.test.mjs se corrigió en la ronda 15 (la ruta se deriva de homedir()):
// si cualquiera reaparece, esta lista tiene que crecer otra vez.
const EXPECTED_HIGH = [
  { rule: 'nombre/promete-atomicidad', file: 'tests/state.test.mjs', count: 1, pattern: /la escritura es atómica/ },
];

test('el analizador sale con 1: hoy la suite tiene hallazgos de severidad alta', () => {
  const { status, report } = run();
  assert.equal(status, 1);
  const expected = EXPECTED_HIGH.reduce((total, item) => total + item.count, 0);
  assert.equal(report.summary.alta, expected);
  assert.ok(report.summary.files >= 60, `esperaba la suite completa, no ${report.summary.files} ficheros`);
  assert.ok(report.summary.tools >= 8, 'debe auditar tools/, incluido mutation.mjs');
});

test('no hay hallazgos altos nuevos ni hallazgos auditados que hayan desaparecido', () => {
  const { report } = run();
  const high = report.findings.filter((finding) => finding.severity === 'alta');
  const actual = high.map((finding) => `${finding.rule}|${finding.file}`).sort();
  const expected = EXPECTED_HIGH
    .flatMap((item) => Array.from({ length: item.count }, () => `${item.rule}|${item.file}`))
    .sort();
  assert.deepEqual(actual, expected);
});

test('cada hallazgo alto apunta a la línea que de verdad contiene el defecto', () => {
  const { report } = run();
  for (const finding of report.findings.filter((entry) => entry.severity === 'alta')) {
    const spec = EXPECTED_HIGH.find((item) => item.rule === finding.rule && item.file === finding.file);
    assert.ok(spec !== undefined, `hallazgo sin especificación: ${finding.rule} ${finding.file}`);
    const lines = readFileSync(join(ROOT, ...finding.file.split('/')), 'utf8').split('\n');
    assert.match(lines[finding.line - 1] ?? '', spec.pattern, `${finding.file}:${finding.line} no contiene el defecto esperado (${finding.rule})`);
  }
});

test('cada hallazgo trae archivo y línea utilizables, y una explicación accionable', () => {
  const { report } = run();
  for (const finding of report.findings) {
    assert.ok(['alta', 'media', 'baja'].includes(finding.severity), finding.severity);
    assert.match(finding.file, /^(tests|tools)\/[\w.\-/]+$/);
    assert.ok(Number.isInteger(finding.line) && finding.line >= 1, `${finding.file}:${finding.line}`);
    assert.ok(finding.message.length > 20, 'un hallazgo sin explicación no es accionable');
  }
});

test('el analizador no se señala a sí mismo ni a sus propias pruebas', () => {
  const { report } = run();
  const self = report.findings.filter(
    (finding) => finding.file === 'tools/testquality.mjs' || finding.file.startsWith('tests/testquality-'),
  );
  assert.deepEqual(self, []);
});

test('el análisis es determinista: dos ejecuciones producen lo mismo, en el mismo orden', () => {
  const first = run().report;
  const second = run().report;
  assert.deepEqual(second.findings, first.findings);
  assert.deepEqual(second.summary, first.summary);
});

test('el informe en texto es legible y nombra cada archivo:línea del JSON', () => {
  const text = spawnSync(process.execPath, [TOOL, '--root', ROOT], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(text.status, 1);
  const json = run().report;
  for (const finding of json.findings) {
    assert.ok(text.stdout.includes(`${finding.file}:${finding.line}`), `el informe no menciona ${finding.file}:${finding.line}`);
  }
  assert.match(text.stdout, /Resumen: \d+ alta\(s\), \d+ media\(s\), \d+ baja\(s\)/);
});
