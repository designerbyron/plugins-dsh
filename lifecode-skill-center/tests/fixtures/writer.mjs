import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { runAction } from '../../lib/api.mjs';
import { loadState } from '../../lib/state.mjs';

// Escritor de pruebas: registra proyectos en un centro compartido, uno detrás de otro. Se usa desde
// `tests/concurrency.test.mjs` con dos procesos a la vez para medir que no se pierden escrituras.
const root = process.argv[2];
const base = process.argv[3];
const tag = process.argv[4];
const rounds = Number(process.argv[5] ?? 8);

for (let index = 0; index < rounds; index += 1) {
  const cwd = join(base, `${tag}-${index}`);
  mkdirSync(cwd, { recursive: true });
  const opened = runAction({ root, action: 'open', cwd, now: new Date().toISOString() });
  if (opened.ok !== true) {
    console.error(`${tag}: open ${index} falló: ${opened.code ?? ''} ${opened.message ?? ''}`);
    process.exit(1);
  }
}

const state = loadState(root).state;
const mine = Object.values(state.projects).filter((project) => String(project.cwd).includes(`/${tag}-`)).length;
process.stdout.write(JSON.stringify({ tag, rounds, mine }));
