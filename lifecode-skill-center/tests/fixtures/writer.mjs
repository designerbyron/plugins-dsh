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

// Un cliente real reintenta cuando el centro está ocupado: el candado espera 4 s y, con la suite entera
// corriendo en paralelo, el proceso puede agotar esa espera sin que haya nada roto. Lo que se mide aquí es
// que no se pierden escrituras, no que la primera tentativa gane el candado.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const busy = new Set(['store-busy', 'locked', 'store-locked']);

for (let index = 0; index < rounds; index += 1) {
  const cwd = join(base, `${tag}-${index}`);
  mkdirSync(cwd, { recursive: true });
  let opened = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      opened = runAction({ root, action: 'open', cwd, now: new Date().toISOString() });
    } catch (failure) {
      // `withState` lanza cuando el candado no se consigue a tiempo: es contención, no corrupción.
      if (!/ocupado|candado/u.test(String(failure?.message ?? ''))) throw failure;
      opened = { ok: false, code: 'store-busy', message: String(failure?.message ?? '') };
    }
    if (opened.ok === true || !busy.has(String(opened.code ?? ''))) break;
    await sleep(120 + attempt * 40);
  }
  if (opened.ok !== true) {
    console.error(`${tag}: open ${index} falló: ${opened.code ?? ''} ${opened.message ?? ''}`);
    process.exit(1);
  }
}

const state = loadState(root).state;
const mine = Object.values(state.projects).filter((project) => String(project.cwd).includes(`/${tag}-`)).length;
process.stdout.write(JSON.stringify({ tag, rounds, mine }));
