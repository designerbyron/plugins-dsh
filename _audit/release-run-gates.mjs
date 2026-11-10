#!/usr/bin/env node
// Release 1.0.1 — batería final del Lead. Ejecuta cada gate con exit code real y escribe un log UTF-8.
// Sólo lectura sobre el producto; cada gate usa sus propias cajas temporales.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..', 'lifecode-skill-center');
const logPath = join(here, 'release-1.0.1-final-gates.log');

const steps = [
  ['node --test (suite completa)', 'node', ['--test']],
  ['tests/t42-ui.test.mjs', 'node', ['--test', 'tests/t42-ui.test.mjs']],
  ['tests/t42-tools-activity.test.mjs', 'node', ['--test', 'tests/t42-tools-activity.test.mjs']],
  ['tools/check.mjs', 'node', ['tools/check.mjs']],
  ['tools/e2e.mjs', 'node', ['tools/e2e.mjs']],
  ['tools/e2e-autonomous.mjs', 'node', ['tools/e2e-autonomous.mjs']],
  ['tools/mutation.mjs', 'node', ['tools/mutation.mjs']],
  ['tools/coverage.mjs', 'node', ['tools/coverage.mjs']],
  ['tests/check-hermetic.mjs', 'node', ['tests/check-hermetic.mjs']],
  ['tools/r16-collision-matrix.mjs', 'node', ['tools/r16-collision-matrix.mjs']],
  ['tools/r16-e2e.mjs', 'node', ['tools/r16-e2e.mjs']],
  ['tools/r16-routing.mjs', 'node', ['tools/r16-routing.mjs']],
  ['tools/r16-portability.mjs', 'node', ['tools/r16-portability.mjs']],
  ['tools/r17-perf.mjs', 'node', ['tools/r17-perf.mjs']],
  ['tools/testquality.mjs (preexistente rojo)', 'node', ['tools/testquality.mjs']],
];

const lines = [];
lines.push(`# Release 1.0.1 — batería final del Lead · ${new Date().toISOString()}`);
const results = [];
for (const [label, command, args] of steps) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: plugin,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  const tail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    .trim()
    .split(/\r?\n/)
    .slice(-8)
    .join('\n');
  results.push({ label, code: result.status, ms });
  lines.push(
    `\n## ${label}\n- exit: ${result.status}\n- duración: ${ms} ms\n- cola:\n\`\`\`\n${tail}\n\`\`\``,
  );
  console.log(`${result.status === 0 ? 'OK  ' : 'FAIL'} ${label} (exit ${result.status}, ${ms} ms)`);
}
lines.push('\n## Resumen');
for (const row of results) {
  lines.push(`- ${row.code === 0 ? 'PASS' : 'FAIL'} · ${row.label} · exit ${row.code} · ${row.ms} ms`);
}
writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`\nlog: ${logPath}`);

const failed = results.filter((row) => row.code !== 0);
console.log(
  failed.length === 0
    ? 'BATERÍA VERDE'
    : `BATERÍA CON ${failed.length} ROJO(S): ${failed.map((row) => row.label).join(' · ')}`,
);
process.exit(failed.length === 0 ? 0 : 1);
