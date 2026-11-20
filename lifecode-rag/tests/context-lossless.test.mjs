/**
 * El resultado de `context` debe sobrevivir a una ida y vuelta por JSON.
 *
 * El host valida la salida de las herramientas y rechaza un valor que no sea «lossless JSON»: una
 * propiedad con valor `undefined` desaparece al serializar y la comprobación falla. Ocurrió en el
 * perfil real (M6.5) con una cita de una segunda fuente: `citations[1].sourceId` era `undefined`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { withAuthorizedContext } from '../lib/exec-context.mjs';
import { contextScopes } from '../lib/scope-ops.mjs';
import { fakeExec, makeEightWorld, servicesFor } from './pa4-helpers.mjs';

const REQUIRED_KEYS = ['n', 'chunkKey', 'sourceId', 'uri', 'title', 'heading', 'ordinal', 'charStart', 'charEnd', 'score'];

test('el contexto es JSON sin pérdida y toda cita declara sus claves', async (t) => {
  const world = await makeEightWorld({ libraryCount: 0 });
  t.after(() => world.cleanup());

  const output = await withAuthorizedContext(
    { services: servicesFor(world), exec: fakeExec('sesion-a') },
    (ctx) => contextScopes(ctx, {
      query: 'kappaproyecto',
      budgetTokens: 600,
      maxChunks: 4,
      config: world.config,
      now: () => 1_700_000_000_000,
    }),
  );

  assert.ok(output.citations.length > 0, 'la consulta debe devolver al menos una cita');
  for (const citation of output.citations) {
    for (const key of REQUIRED_KEYS) {
      assert.ok(Object.hasOwn(citation, key), `la cita debe declarar ${key}`);
      assert.notEqual(citation[key], undefined, `${key} no puede ser undefined`);
    }
  }
  assert.equal(typeof output.text, 'string');
  assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
});
