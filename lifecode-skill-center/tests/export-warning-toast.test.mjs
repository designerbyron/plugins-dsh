/**
 * El aviso de portabilidad, ejecutado: se extraen los manejadores reales de `client.js` y se llaman con
 * dobles de `act`, `load`, `notify` y `t`.
 *
 * Por qué así y no con una captura: el panel lee siempre el almacén productivo, y producir el aviso en vivo
 * exigiría crear en él una skill con una ruta privada. Eso está prohibido por la directiva, así que la
 * evidencia es de comportamiento sobre el código que se envía, no una foto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function handler(name) {
  const start = client.indexOf(`const ${name} = useCallback(`);
  assert.notEqual(start, -1, `no se encontró ${name}`);
  const bodyStart = client.indexOf('{', start);
  let depth = 0;
  let end = bodyStart;
  for (let index = bodyStart; index < client.length; index += 1) {
    const char = client[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  const callback = client.slice(client.indexOf('async (', start), end);
  return new Function('act', 'load', 'notify', 't', `return ${callback};`);
}

function stubs(result) {
  const calls = { act: [], notify: [], load: 0 };
  const consts = {
    act: async (action, payload) => {
      calls.act.push({ action, payload });
      return result;
    },
    notify: (message) => calls.notify.push(message),
    load: async () => {
      calls.load += 1;
    },
    t: (key, params) => `${key}${params ? `|${JSON.stringify(params)}` : ''}`,
  };
  return { calls, consts };
}

test('exportar avisa cuando el paquete lleva referencias no portables', async () => {
  const build = handler('onExportBundle');
  const { calls, consts } = stubs({ ok: true, file: 'exports/x.json', bytes: 120, warnings: [{ path: 'references/a.md', reason: 'absolute-path' }] });
  const run = build(consts.act, consts.load, consts.notify, consts.t);
  await run('skill-1');
  assert.equal(calls.act[0].action, 'export-skill');
  assert.deepEqual(calls.act[0].payload, { skillId: 'skill-1' });
  assert.ok(calls.notify.some((message) => message.startsWith('drawer.export.done')), 'falta el aviso de escrito');
  assert.ok(
    calls.notify.includes('drawer.export.warn|{"n":"1"}'),
    `falta el aviso de portabilidad: ${JSON.stringify(calls.notify)}`,
  );
  assert.equal(calls.load, 1, 'no recargó la foto después de exportar');
});

test('exportar sin avisos no muestra el aviso de portabilidad', async () => {
  const build = handler('onExportBundle');
  const { calls, consts } = stubs({ ok: true, file: 'exports/y.json', bytes: 100, warnings: [] });
  const run = build(consts.act, consts.load, consts.notify, consts.t);
  await run('skill-2');
  assert.deepEqual(calls.notify, ['drawer.export.done|{"file":"exports/y.json","bytes":"100"}']);
});

test('importar avisa de las rutas no portables y del renombrado', async () => {
  const build = handler('onImportBundle');
  const { calls, consts } = stubs({ ok: true, id: 'copia', renamed: true, warnings: [{ path: 'references/b.md', reason: 'absolute-path' }] });
  const run = build(consts.act, consts.load, consts.notify, consts.t);
  const result = await run('{"schema":"x"}');
  assert.equal(result.ok, true);
  assert.ok(calls.notify.some((message) => message.startsWith('library.import.done')), 'falta el aviso de importada');
  assert.ok(calls.notify.includes('library.import.warn|{"n":"1"}'), `falta el aviso de portabilidad: ${JSON.stringify(calls.notify)}`);
  assert.equal(calls.load, 1, 'no recargó la foto después de importar');
});
