#!/usr/bin/env node
/**
 * Cobertura de líneas, ramas y funciones del código del producto, medida con la cobertura nativa de
 * Node (`--experimental-test-coverage`), sin agregar ninguna dependencia al plugin.
 *
 * Uso:
 *   node tools/coverage.mjs            # suite completa + informe legible en _audit/COBERTURA.md
 *   node tools/coverage.mjs --json     # sólo JSON por stdout
 *
 * Sólo se mide `lib/`, `index.js` y `client.js`: lo que corre en producción. Las pruebas y los
 * dobles no cuentan, porque inflarían la cifra sin decir nada del producto.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const repo = join(root, '..');
const wantJson = process.argv.includes('--json');

const include = [
  '--test-coverage-include=lib/**/*.mjs',
  '--test-coverage-include=index.js',
  '--test-coverage-include=client.js',
];

const run = spawnSync(
  process.execPath,
  ['--test', '--experimental-test-coverage', '--test-reporter=spec', ...include],
  { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
);

const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
const lines = output.split(/\r?\n/);

const CLEAN = /^[ℹ\s]+/;
const NUMBER = /^\d+(?:\.\d+)?$/;

const rows = [];
let totals = null;
let inTable = false;

for (const raw of lines) {
  const line = raw.replace(CLEAN, '').replace(/\s+$/, '');
  if (line.startsWith('file') && line.includes('line %')) {
    inTable = true;
    continue;
  }
  if (!inTable) continue;
  if (line.startsWith('end of coverage report')) break;
  if (/^-+$/.test(line) || line === '') continue;

  const cells = line.split('|').map((cell) => cell.trim());
  if (cells.length < 4) continue;
  const name = cells[0];
  if (!NUMBER.test(cells[1])) continue; // fila de directorio: sin cifras

  const row = {
    file: name,
    line: Number(cells[1]),
    branch: Number(cells[2]),
    funcs: Number(cells[3]),
    uncovered: cells[4] ?? '',
  };

  if (name === 'all files') totals = row;
  else rows.push(row);
}

const summary = {
  generatedAt: new Date().toISOString(),
  totals: totals ?? { line: 0, branch: 0, funcs: 0 },
  files: rows.length,
  rows: rows.slice().sort((a, b) => a.file.localeCompare(b.file)),
  exitCode: run.status,
};

if (wantJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const stale = summary.rows.filter((row) => row.line < 100);
  const report = [
    '# Cobertura de líneas, ramas y funciones',
    '',
    `Medida: ${summary.generatedAt}`,
    'Comando: `node tools/coverage.mjs` (cobertura nativa de Node, sin dependencias)',
    'Alcance: `lib/**/*.mjs`, `index.js`, `client.js` — el código que corre en producción.',
    '',
    `**Total: línea ${summary.totals.line} % · rama ${summary.totals.branch} % · funciones ${summary.totals.funcs} %** (${summary.files} ficheros con datos).`,
    '',
    '## Ficheros por debajo del 100 % de línea',
    '',
    stale.length === 0
      ? 'Ninguno: todos los ficheros medidos están al 100 % en línea.'
      : [
          '| Fichero | línea % | rama % | funciones % | líneas sin cubrir |',
          '|---|---|---|---|---|',
        ]
          .concat(
            stale.map(
              (row) => `| \`${row.file}\` | ${row.line} | ${row.branch} | ${row.funcs} | ${row.uncovered || '—'} |`,
            ),
          )
          .join('\n'),
    '',
    '## Nota de honestidad',
    '',
    'La cobertura la calcula Node sobre lo que ejecutan las pruebas. Un 100 % de línea **no** demuestra',
    'que las aserciones sean buenas: eso lo miden el auditor adversarial (`tools/adversarial.mjs`) y el',
    'mutation testing (`tools/mutation.mjs`). Aquí sólo se responde «¿qué código del producto no ejecuta',
    'ninguna prueba?».',
    '',
  ].join('\n');

  mkdirSync(join(repo, '_audit'), { recursive: true });
  const file = join(repo, '_audit', 'COBERTURA.md');
  writeFileSync(file, report, 'utf8');
  console.log(
    `Total: línea ${summary.totals.line} % · rama ${summary.totals.branch} % · funciones ${summary.totals.funcs} % (${summary.files} ficheros)`,
  );
  console.log(`Informe: ${relative(repo, file)}`);
  console.log(run.status === 0 ? 'Suite en verde' : `Suite con fallos (exit ${run.status})`);
}

process.exit(run.status === 0 ? 0 : 1);
