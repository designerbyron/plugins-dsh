import { runAction } from '../../lib/api.mjs';

// Creador de pruebas: crea una skill como haría el agente (`actor: 'ai'`). Se usa en paralelo con el
// panel para medir que dos operaciones distintas a la vez no se pisan.
const root = process.argv[2];
const cwd = process.argv[3];
const id = process.argv[4];

const body = [
  '## Procedimiento',
  '',
  'Comprueba el estado, escribe la evidencia y deja el resultado en el informe antes de cerrar el trabajo.',
  '',
  '## Evidencia',
  '',
  'La salida de las pruebas y la ruta del almacén tocado. Si algo no se midió, se dice que no se midió.',
].join('\n');
const result = runAction({
  root,
  action: 'create',
  actor: 'ai',
  cwd,
  payload: {
    id,
    description: 'Crea una skill de prueba desde un proceso para medir concurrencia entre panel y agente',
    whenToUse: 'Cuando haga falta comprobar que dos escrituras simultáneas no pierden datos del centro',
    body,
    tags: ['pruebas', 'concurrencia'],
  },
});
process.stdout.write(JSON.stringify({ ok: result.ok === true, code: result.code ?? '' }));
if (result.ok !== true) process.exit(1);
