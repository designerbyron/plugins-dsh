import { skillProviderFor } from '../../lib/provider.mjs';
import { loadState } from '../../lib/state.mjs';

// Cargador de pruebas: pide el catálogo `rounds` veces contra un centro compartido. Se usa desde
// `tests/t13.test.mjs` con dos procesos a la vez para medir que la entrega del catálogo no duplica
// eventos ni pierde escrituras.
const root = process.argv[2];
const cwd = process.argv[3];
const rounds = Number(process.argv[4] ?? 1);

const provider = skillProviderFor({ root });
let delivered = 0;
for (let index = 0; index < rounds; index += 1) {
  delivered = (await provider.list({ cwd })).length;
}

const state = loadState(root).state;
const loads = state.events.filter((event) => event.type === 'skill.loaded').length;
process.stdout.write(JSON.stringify({ delivered, loads }));
