#!/usr/bin/env node
/**
 * La aprobacion como transaccion (ACTO E.7).
 *
 * Lo que estas pruebas vigilan, y por que:
 *
 *   · la version viva NUNCA queda inaccesible por un fallo intermedio: se revierte o se repara;
 *   · lo que se activa es exactamente lo que se valido;
 *   · sin asiento en el diario no hay aprobacion;
 *   · el paquete apartado lleva su manifiesto con hashes por fichero;
 *   · un cierre del proceso en cualquier punto tiene una recuperacion determinista.
 *
 *   node --test tests/approve-tx.test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { ejecutarAprobacion, recuperarTransacciones, transaccionesPendientes } from '../lib/approve-tx.mjs';
import { approveProposal } from '../lib/commands.mjs';
import { propose } from '../lib/compiler.mjs';
import { conCerrojo } from '../lib/lock.mjs';
import { leerDiario } from '../lib/promote.mjs';
import { cleanupSandboxes, goodInput, patchInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const KEY = 'proyecto-arena';
const ID = 'measured-decision-check';
const sha = (t) => createHash('sha256').update(t).digest('hex');

const V1 = ['## When to Use', '', 'Cuando hay que decidir con evidencia medida y no con impresiones.', '', '## Procedure', '', '1. Medir antes de tocar nada y anotar el numero.', '2. Declarar la diferencia con su cifra.', '3. Cerrar solo si las dos medidas coinciden.'].join('\n');
const REF1 = { path: 'references/uno.md', content: '## Uno\n\n`node --test` sobre la copia.\n' };
const REF2 = { path: 'references/dos.md', content: '## Dos\n\nLa cifra va al informe.\n' };
const CON_REFS = `${V1}\n\nEl detalle vive en \`references/uno.md\` y en \`references/dos.md\`.`;
const V2 = `${CON_REFS}\n4. Archivar la revision anterior con su manifiesto.`;

const rutas = (root) => ({
  proposed: join(root, 'projects', KEY, 'proposed', ID),
  approved: join(root, 'projects', KEY, 'approved', ID),
  superseded: join(root, 'projects', KEY, 'superseded'),
});
const contenido = (dir) => {
  if (!existsSync(dir)) return null;
  const salida = {};
  const recorrer = (base, rel = '') => {
    for (const e of readdirSync(base, { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) recorrer(join(base, e.name), r);
      else if (r !== 'meta.json') salida[r] = sha(readFileSync(join(base, e.name)));
    }
  };
  recorrer(dir);
  return Object.fromEntries(Object.entries(salida).sort());
};
const historicos = (root) => {
  const dir = rutas(root).superseded;
  return existsSync(dir) ? readdirSync(dir).filter((n) => !n.endsWith('.json')).sort() : [];
};

/** v1 aprobada (con dos referencias) y v2 propuesta encima. Devuelve el contenido de la v1 y de la v2. */
const preparar = (arena) => {
  propose(goodInput({ body: CON_REFS }), { root: arena.root, key: KEY, references: [REF1, REF2] });
  const alta = approveProposal({ root: arena.root, key: KEY, id: ID, force: true, scope: 'project' });
  assert.equal(alta.kind, 'success', alta.text);
  const v1 = contenido(rutas(arena.root).approved);
  const p = propose(patchInput({ body: V2 }), { root: arena.root, key: KEY, references: [REF1, REF2] });
  assert.equal(p.status, 'proposed', JSON.stringify(p.errors ?? p));
  const v2 = contenido(rutas(arena.root).proposed);
  return { v1, v2 };
};

describe('camino exitoso', () => {
  it('actualizacion: v1 queda apartada entera, con manifiesto y hashes', () => {
    const arena = sandbox({ curated: false });
    const { v1, v2 } = preparar(arena);
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID });
    assert.equal(r.ok, true, r.error);

    assert.ok(existsSync(r.superseded), 'la v1 tiene que estar en superseded/');
    assert.deepEqual(contenido(r.superseded), v1, 'byte a byte igual a la v1');
    assert.deepEqual(Object.keys(contenido(r.superseded)).sort(), ['SKILL.md', 'references/dos.md', 'references/uno.md']);

    const manifiesto = JSON.parse(readFileSync(r.manifiesto, 'utf8'));
    assert.equal(manifiesto.id, ID);
    assert.equal(manifiesto.projectKey, KEY);
    assert.equal(manifiesto.scope, 'project');
    assert.equal(manifiesto.from, 'approved');
    assert.equal(manifiesto.replacedBy.hash, r.nuevo);
    assert.equal(manifiesto.packageHash.length, 64);
    for (const f of manifiesto.files) {
      assert.equal(f.sha256, sha(readFileSync(join(r.superseded, f.path))), `hash de ${f.path}`);
      assert.equal(f.bytes, readFileSync(join(r.superseded, f.path)).length);
    }

    assert.deepEqual(contenido(rutas(arena.root).approved), v2, 'lo activo es exactamente la v2 propuesta');
    assert.ok(!existsSync(rutas(arena.root).proposed), 'proposed/ se queda vacio');
    assert.equal(transaccionesPendientes({ root: arena.root, key: KEY }).length, 0, 'sin intenciones colgando');
  });

  it('el diario tiene un unico asiento por aprobacion, con la transaccion y sus dos huellas', () => {
    const arena = sandbox({ curated: false });
    preparar(arena);
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID });
    assert.equal(r.ok, true, r.error);
    const mias = leerDiario(KEY, { root: arena.root }).filter((e) => e.tx === r.tx);
    assert.equal(mias.length, 1, 'un asiento por aprobacion');
    assert.equal(mias[0].decision, 'aprobada');
    assert.equal(mias[0].hashResultante, r.nuevo);
    assert.ok(typeof mias[0].huella === 'string' && mias[0].huella.length === 64);
  });

  it('skill nueva sin version anterior: no aparta nada y no falla', () => {
    const arena = sandbox({ curated: false });
    propose(goodInput({ body: CON_REFS }), { root: arena.root, key: KEY, references: [REF1, REF2] });
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.superseded, null);
    assert.equal(r.manifiesto, null);
    assert.equal(leerDiario(KEY, { root: arena.root }).filter((e) => e.tx === r.tx).length, 1);
  });

  it('el paquete con upstream/ viaja entero', () => {
    const arena = sandbox({ curated: false });
    propose(goodInput({ body: CON_REFS }), {
      root: arena.root, key: KEY, references: [REF1, REF2],
      extraFiles: { 'upstream/original.md': '# Original\n\nTexto del proveedor.\n' },
    });
    approveProposal({ root: arena.root, key: KEY, id: ID, force: true, scope: 'project' });
    propose(patchInput({ body: V2 }), { root: arena.root, key: KEY, references: [REF1, REF2] });
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID });
    assert.equal(r.ok, true, r.error);
    const manifiesto = JSON.parse(readFileSync(r.manifiesto, 'utf8'));
    assert.ok(manifiesto.files.some((f) => f.path === 'upstream/original.md'), 'el upstream viaja con el paquete');
  });
});

describe('fallas', () => {
  it('huella incorrecta: no se mueve nada', () => {
    const arena = sandbox({ curated: false });
    const { v1 } = preparar(arena);
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID, esperada: 'deadbeef'.repeat(8) });
    assert.equal(r.ok, false);
    assert.match(r.error, /no se movio nada|despues de validarse/);
    assert.deepEqual(contenido(rutas(arena.root).approved), v1);
    assert.ok(existsSync(rutas(arena.root).proposed));
  });

  it('superseded/ no creable: error controlado, sin excepcion y sin perder nada', () => {
    const arena = sandbox({ curated: false });
    const { v1, v2 } = preparar(arena);
    writeFileSync(rutas(arena.root).superseded, 'estorbo');
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID });
    assert.equal(r.ok, false);
    assert.match(r.error, /no se pudo archivar/);
    assert.deepEqual(contenido(rutas(arena.root).approved), v1, 'la v1 sigue activa');
    assert.deepEqual(contenido(rutas(arena.root).proposed), v2, 'la propuesta sigue en su sitio');
  });

  it('fallo al escribir el manifiesto: se revierte y la v1 vuelve', () => {
    const arena = sandbox({ curated: false });
    const { v1, v2 } = preparar(arena);
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID, hooks: { fallar: 'manifest' } });
    assert.equal(r.ok, false);
    assert.deepEqual(contenido(rutas(arena.root).approved), v1);
    assert.deepEqual(contenido(rutas(arena.root).proposed), v2);
    assert.deepEqual(historicos(arena.root), [], 'no queda historico suelto');
  });

  it('fallo al instalar: se revierte y la v1 vuelve', () => {
    const arena = sandbox({ curated: false });
    const { v1, v2 } = preparar(arena);
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID, hooks: { fallar: 'installed' } });
    assert.equal(r.ok, false);
    assert.deepEqual(contenido(rutas(arena.root).approved), v1);
    assert.deepEqual(contenido(rutas(arena.root).proposed), v2);
    assert.deepEqual(historicos(arena.root), []);
    assert.deepEqual(r.problemas, []);
  });

  it('lo instalado no coincide con lo validado: se revierte', () => {
    const arena = sandbox({ curated: false });
    const { v1 } = preparar(arena);
    const r = ejecutarAprobacion({
      root: arena.root, key: KEY, id: ID,
      hooks: { trasInstalar: ({ destino }) => writeFileSync(join(destino, 'SKILL.md'), 'intruso') },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /no coincide con lo validado/);
    assert.deepEqual(contenido(rutas(arena.root).approved), v1);
  });

  it('fallo al anotar el diario: la aprobacion se deshace y no queda asiento', () => {
    const arena = sandbox({ curated: false });
    const { v1 } = preparar(arena);
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID, hooks: { fallar: 'journal' } });
    assert.equal(r.ok, false);
    assert.match(r.error, /diario/);
    assert.deepEqual(contenido(rutas(arena.root).approved), v1);
    assert.equal(leerDiario(KEY, { root: arena.root }).filter((e) => e.tx === r.tx).length, 0, 'sin asiento a medias');
  });

  it('si el diario no se puede escribir de verdad, tambien se deshace', () => {
    const arena = sandbox({ curated: false });
    const { v1 } = preparar(arena);
    const estorbo = join(arena.base, 'estorbo');
    writeFileSync(estorbo, 'no soy carpeta');
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID, diario: join(estorbo, 'journal.jsonl') });
    assert.equal(r.ok, false);
    assert.deepEqual(contenido(rutas(arena.root).approved), v1);
  });

  it('si la version anterior no se puede devolver, el rollback lo declara', () => {
    const arena = sandbox({ curated: false });
    preparar(arena);
    const r = ejecutarAprobacion({
      root: arena.root, key: KEY, id: ID,
      hooks: {
        // Se altera lo instalado (para forzar la reversion) y se ocupa `proposed/<id>` con un fichero:
        // la reversion no puede devolver la candidata y el problema tiene que salir, no perderse.
        trasInstalar: ({ destino }) => {
          writeFileSync(join(destino, 'SKILL.md'), 'intruso');
          writeFileSync(rutas(arena.root).proposed, 'estorbo en proposed');
        },
      },
    });
    assert.equal(r.ok, false);
    assert.ok(Array.isArray(r.problemas) && r.problemas.length > 0, 'el fallo de rollback se declara');
    assert.match(r.problemas[0], /no se pudo devolver/);
  });
});

describe('interrupciones y recuperacion', () => {
  const casos = [
    ['intent', 'antes de tocar nada'],
    ['archived', 'despues de archivar'],
    ['installed', 'despues de instalar'],
    ['journal', 'antes de confirmar el diario'],
  ];
  for (const [punto, descripcion] of casos) {
    it(`cierre ${descripcion}: se recupera y la v1 nunca se pierde`, () => {
      const arena = sandbox({ curated: false });
      const { v1, v2 } = preparar(arena);
      const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID, hooks: { interrumpir: punto } });
      assert.equal(r.ok, false);
      assert.equal(r.interrumpida, true);
      assert.equal(transaccionesPendientes({ root: arena.root, key: KEY }).length, 1, 'la intencion queda en disco');

      const recuperacion = recuperarTransacciones({ root: arena.root, key: KEY });
      assert.equal(recuperacion.incompletas, 0, JSON.stringify(recuperacion.detalles));
      assert.equal(recuperacion.revisadas, 1);
      assert.equal(transaccionesPendientes({ root: arena.root, key: KEY }).length, 0, 'la intencion se cierra');

      // Tras recuperar: o v2 activa con su asiento, o v1 activa sin asiento. Nunca un estado a medias.
      const activa = contenido(rutas(arena.root).approved);
      const asientos = leerDiario(KEY, { root: arena.root }).filter((e) => e.tx === r.tx);
      if (JSON.stringify(activa) === JSON.stringify(v1)) {
        assert.equal(asientos.length, 0, 'si se revirtio, no hay asiento');
        assert.deepEqual(contenido(rutas(arena.root).proposed), v2, 'la candidata vuelve a proposed/');
      } else {
        assert.deepEqual(activa, v2, 'si se completo, lo activo es la candidata');
        assert.equal(asientos.length, 1, 'y hay exactamente un asiento');
      }
    });
  }

  it('la recuperacion no duplica asientos si se repite', () => {
    const arena = sandbox({ curated: false });
    preparar(arena);
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID, hooks: { interrumpir: 'journal' } });
    recuperarTransacciones({ root: arena.root, key: KEY });
    const primera = leerDiario(KEY, { root: arena.root }).filter((e) => e.tx === r.tx).length;
    const segunda = recuperarTransacciones({ root: arena.root, key: KEY });
    const despues = leerDiario(KEY, { root: arena.root }).filter((e) => e.tx === r.tx).length;
    assert.equal(primera, 1);
    assert.equal(despues, 1, 'no se duplica');
    assert.equal(segunda.revisadas, 0);
  });
});

describe('concurrencia', () => {
  it('el cerrojo impide dos sustituciones del mismo id', () => {
    const arena = sandbox({ curated: false });
    preparar(arena);
    const dentro = conCerrojo(arena.root, KEY, ID, () => conCerrojo(arena.root, KEY, ID, () => 'no deberia ejecutarse'));
    assert.equal(dentro.ok, false);
    assert.match(dentro.reason, /ya hay una operación en curso/);
  });

  it('sin que nadie lo rodee, la transaccion toma el cerrojo del id (panel y modo automatico)', () => {
    const arena = sandbox({ curated: false });
    const { v1 } = preparar(arena);
    const dentro = conCerrojo(arena.root, KEY, ID, () => ejecutarAprobacion({ root: arena.root, key: KEY, id: ID }));
    assert.equal(dentro.ok, false);
    assert.equal(dentro.lock, true, 'la segunda no pisa la primera');
    assert.deepEqual(contenido(rutas(arena.root).approved), v1, 'la viva no se movio');
  });

  it('aprobar dos veces seguidas no duplica nada', () => {
    const arena = sandbox({ curated: false });
    preparar(arena);
    const primera = approveProposal({ root: arena.root, key: KEY, id: ID, force: true, scope: 'project' });
    assert.equal(primera.kind, 'success', primera.text);
    const segunda = approveProposal({ root: arena.root, key: KEY, id: ID, force: true, scope: 'project' });
    assert.equal(segunda.kind, 'success', segunda.text);
    assert.match(segunda.text, /already|ya está|no-change/i);
    assert.equal(historicos(arena.root).length, 1, 'una sola version apartada');
  });

  it('si la propuesta cambia despues de validarse, no se aprueba', () => {
    const arena = sandbox({ curated: false });
    preparar(arena);
    const dirProp = rutas(arena.root).proposed;
    writeFileSync(join(dirProp, 'SKILL.md'), `${readFileSync(join(dirProp, 'SKILL.md'), 'utf8')}\nlinea intrusa`);
    const r = ejecutarAprobacion({ root: arena.root, key: KEY, id: ID, esperada: sha('lo que se valido') });
    assert.equal(r.ok, false);
    assert.match(r.error, /cambi/);
  });
});
