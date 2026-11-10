#!/usr/bin/env node
/**
 * Historial de propuestas sustituidas (`superseded/`).
 *
 * Lo que estas pruebas vigilan, y por que:
 *
 *   · reproponer el mismo id **no puede destruir** la revision anterior: se archiva el paquete entero;
 *   · el archivado es verificable: hash y bytes de cada fichero, y la carpeta queda igual que estaba;
 *   · un revision-id no se reutiliza;
 *   · si algo falla (instalacion o diario), la propuesta anterior sigue en su sitio;
 *   · lo archivado es historico: no aparece en pendientes ni se aprueba.
 *
 *   node --test tests/superseded.test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { pending, projectKey, propose } from '../lib/compiler.mjs';
import { pendingRowsFor } from '../lib/pending-rows.mjs';
import { leerDiario } from '../lib/promote.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const ID = 'measured-decision-check';
const sha = (texto) => createHash('sha256').update(texto).digest('hex');

const BASE = ['## When to Use', '', 'Cuando hay que decidir con evidencia medida y no con impresiones.', '', '## Procedure', '', '1. Medir antes de tocar nada y anotar el numero.', '2. Comparar contra el registro previo y declarar la diferencia.', '3. Cerrar solo si las dos medidas coinciden.'].join('\n');
const CUERPO_A = BASE;
const CUERPO_B = `${BASE}\n4. Anotar la cifra en el informe del acto.`;
const CUERPO_C = `${CUERPO_B}\n5. Revisar la nota anterior antes de cerrar.`;
const CUERPO_D = `${CUERPO_C}\n6. Archivar la revision que se sustituye.`;

/** La clave real del proyecto para `cwd`: es la misma que usan las filas de pendientes. */
const keyDe = (arena) => projectKey(arena.base);
const carpetaArchivo = (arena) => join(arena.root, 'projects', keyDe(arena), 'superseded', 'proposals', ID);
const revisiones = (arena) => (existsSync(carpetaArchivo(arena)) ? readdirSync(carpetaArchivo(arena)).filter((n) => !n.endsWith('.json')).sort() : []);
const rutaViva = (arena) => join(arena.root, 'projects', keyDe(arena), 'proposed', ID, 'SKILL.md');
const primera = (arena, { references, ...over } = {}) => propose(goodInput(over), {
  root: arena.root, key: keyDe(arena), cwd: arena.base, ...(references ? { references } : {}),
});

describe('superseded · archivado del paquete completo', () => {
  it('la primera propuesta no archiva nada y lo dice', () => {
    const arena = sandbox({ curated: false });
    const r = primera(arena, { body: CUERPO_A });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r));
    assert.equal(r.superseded, null);
    assert.deepEqual(revisiones(arena), []);
  });

  it('reproponer archiva la anterior entera, con su hash y sus bytes', () => {
    const arena = sandbox({ curated: false });
    const una = primera(arena, { body: CUERPO_A });
    assert.equal(una.status, 'proposed', JSON.stringify(una.errors ?? una));
    const segunda = primera(arena, { body: CUERPO_B });
    assert.equal(segunda.status, 'proposed', JSON.stringify(segunda.errors ?? segunda));
    assert.ok(segunda.superseded?.revision, 'la sustitucion tiene que declararse');

    const carpeta = join(carpetaArchivo(arena), segunda.superseded.revision);
    const skill = readFileSync(join(carpeta, 'SKILL.md'), 'utf8');
    assert.ok(skill.includes('3. Cerrar solo si las dos medidas coinciden.'), 'el cuerpo archivado es el anterior');
    assert.ok(!skill.includes('4. Anotar la cifra'), 'y no el nuevo');

    const manifiesto = JSON.parse(readFileSync(join(carpetaArchivo(arena), `${segunda.superseded.revision}.json`), 'utf8'));
    assert.equal(manifiesto.revision, segunda.superseded.revision);
    assert.equal(manifiesto.id, ID);
    assert.ok(manifiesto.reason.length > 0, 'el motivo del archivado queda escrito');
    assert.equal(manifiesto.replacedBy.sha256, segunda.sha256);
    for (const f of manifiesto.files) {
      const bytes = readFileSync(join(carpeta, f.path));
      assert.equal(f.sha256, sha(bytes), `hash de ${f.path}`);
      assert.equal(f.bytes, bytes.length, `bytes de ${f.path}`);
    }
    assert.deepEqual(manifiesto.files.map((f) => f.path).sort(), ['SKILL.md', 'meta.json']);
  });

  it('el paquete archivado conserva las referencias, no solo el documento', () => {
    const arena = sandbox({ curated: false });
    const conRef = `${CUERPO_A}\n\nEl detalle vive en \`references/detalle.md\`.`;
    const una = primera(arena, {
      body: conRef,
      references: [{ path: 'references/detalle.md', content: '## Detalle\n\n`node --test` sobre la copia.\n' }],
    });
    assert.equal(una.status, 'proposed', JSON.stringify(una.errors ?? una));
    const segunda = primera(arena, { body: CUERPO_B });
    assert.equal(segunda.status, 'proposed', JSON.stringify(segunda.errors ?? segunda));
    assert.ok(segunda.superseded?.revision);

    const carpeta = join(carpetaArchivo(arena), segunda.superseded.revision);
    assert.ok(existsSync(join(carpeta, 'references', 'detalle.md')), 'la referencia viaja con el paquete');
    const manifiesto = JSON.parse(readFileSync(join(carpetaArchivo(arena), `${segunda.superseded.revision}.json`), 'utf8'));
    assert.ok(manifiesto.files.some((f) => f.path === 'references/detalle.md'));
    assert.equal(segunda.superseded.files, 3);
  });
});

describe('superseded · tres actualizaciones sucesivas', () => {
  it('conserva las tres revisiones anteriores, cada una con su contenido', () => {
    const arena = sandbox({ curated: false });
    const sello = (n) => `2026-11-05T05:00:0${n}.000Z`;
    primera(arena, { body: CUERPO_A, now: sello(1) });
    primera(arena, { body: CUERPO_B, now: sello(2) });
    primera(arena, { body: CUERPO_C, now: sello(3) });
    const cuarta = primera(arena, { body: CUERPO_D, now: sello(4) });
    assert.equal(cuarta.status, 'proposed', JSON.stringify(cuarta.errors ?? cuarta));

    const revs = revisiones(arena);
    assert.equal(revs.length, 3, 'tres actualizaciones dejan tres revisiones archivadas');

    const cuerpos = revs.map((rev) => readFileSync(join(carpetaArchivo(arena), rev, 'SKILL.md'), 'utf8'));
    assert.ok(cuerpos[0].includes('3. Cerrar solo si las dos medidas coinciden.') && !cuerpos[0].includes('4. Anotar'));
    assert.ok(cuerpos[1].includes('4. Anotar la cifra') && !cuerpos[1].includes('5. Revisar'));
    assert.ok(cuerpos[2].includes('5. Revisar la nota anterior'));
    assert.equal(new Set(cuerpos.map((c) => sha(c))).size, 3, 'ninguna revision se repite');

    const viva = readFileSync(rutaViva(arena), 'utf8');
    assert.ok(viva.includes('6. Archivar la revision que se sustituye.'));
  });

  it('dos archivados con el mismo sello y el mismo paquete no se pisan', () => {
    const arena = sandbox({ curated: false });
    const mismoInstante = '2026-11-05T05:00:00.000Z';
    primera(arena, { body: CUERPO_A });
    const segunda = primera(arena, { body: CUERPO_B, now: mismoInstante });
    const tercera = primera(arena, { body: CUERPO_A, now: mismoInstante });
    const cuarta = primera(arena, { body: CUERPO_B, now: mismoInstante });
    assert.ok(segunda.superseded?.revision && tercera.superseded?.revision && cuarta.superseded?.revision);
    const revs = revisiones(arena);
    assert.equal(revs.length, 3);
    assert.equal(new Set(revs).size, 3, 'el revision-id no se reutiliza');
  });
});

describe('superseded · lo archivado es historico', () => {
  it('no se cuenta como pendiente ni se anuncia en el menu', () => {
    const arena = sandbox({ curated: false });
    primera(arena, { body: CUERPO_A });
    primera(arena, { body: CUERPO_B });

    const pendientes = pending({ root: arena.root, key: keyDe(arena) });
    assert.equal(pendientes.length, 1, 'una sola propuesta viva');
    assert.equal(pendientes[0].id, ID);

    const filas = pendingRowsFor({ root: arena.root, cwd: arena.base });
    const delId = filas.filter((f) => f.id === ID);
    assert.ok(delId.length > 0, 'la propuesta viva si tiene filas');
    const verbos = new Set(delId.map((f) => f.verb));
    assert.equal(delId.length, verbos.size, 'una fila por verbo, sin sumar el historico');
    assert.ok(!JSON.stringify(filas).includes('superseded'), 'el historico no se anuncia como pendiente');
  });

  it('el historico vive fuera de proposed/ y se puede leer para comparar', () => {
    const arena = sandbox({ curated: false });
    primera(arena, { body: CUERPO_A });
    primera(arena, { body: CUERPO_B });
    const enPropuestas = readdirSync(join(arena.root, 'projects', keyDe(arena), 'proposed'));
    assert.deepEqual(enPropuestas, [ID], 'proposed/ solo tiene la propuesta viva');
    assert.ok(existsSync(join(arena.root, 'projects', keyDe(arena), 'superseded')), 'el historico tiene su propia carpeta');
  });
});

describe('superseded · fallos', () => {
  it('si la instalacion falla, la propuesta anterior vuelve a su sitio', () => {
    const arena = sandbox({ curated: false });
    const una = primera(arena, { body: CUERPO_A });
    assert.equal(una.status, 'proposed', JSON.stringify(una.errors ?? una));
    const antes = readFileSync(rutaViva(arena), 'utf8');
    // Dos claves que normalizan a la misma ruta: writeAtomic lo rechaza antes de publicar.
    const rota = propose(goodInput({ body: CUERPO_B }), {
      root: arena.root, key: keyDe(arena), cwd: arena.base,
      extraFiles: { 'references/x.md': 'a', 'references\\x.md': 'b' },
    });
    assert.equal(rota.status, 'invalid');
    assert.match(rota.errors[0], /misma ruta/);
    assert.ok(rota.errors.some((e) => /restaur/.test(e)), 'el informe dice que se restauro');
    assert.equal(readFileSync(rutaViva(arena), 'utf8'), antes);
    assert.deepEqual(revisiones(arena), [], 'no queda un archivado suelto');
  });

  it('si no se puede anotar el diario, no se archiva nada', () => {
    const arena = sandbox({ curated: false });
    primera(arena, { body: CUERPO_A });
    const antes = readFileSync(rutaViva(arena), 'utf8');
    // Un fichero donde deberia ir la carpeta: mkdirSync falla y el diario no se puede escribir.
    const estorbo = join(arena.base, 'estorbo');
    writeFileSync(estorbo, 'no soy una carpeta');
    const r = propose(goodInput({ body: CUERPO_B }), {
      root: arena.root, key: keyDe(arena), cwd: arena.base, diario: join(estorbo, 'journal.jsonl'),
    });
    assert.equal(r.status, 'invalid');
    assert.match(r.errors[0], /diario/);
    assert.equal(readFileSync(rutaViva(arena), 'utf8'), antes);
    assert.deepEqual(revisiones(arena), []);
  });

  it('una carpeta temporal huerfana no impide archivar ni instalar', () => {
    const arena = sandbox({ curated: false });
    primera(arena, { body: CUERPO_A });
    const dir = join(arena.root, 'projects', keyDe(arena), 'proposed', `${ID}.tmp-huerfana`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'basura.txt'), 'restos de una escritura interrumpida');
    const segunda = primera(arena, { body: CUERPO_B });
    assert.equal(segunda.status, 'proposed', JSON.stringify(segunda.errors ?? segunda));
    assert.equal(revisiones(arena).length, 1);
    assert.ok(!readFileSync(rutaViva(arena), 'utf8').includes('restos'));
  });
});

describe('superseded · rastro en el diario', () => {
  it('la sustitucion queda anotada con la revision anterior y la huella nueva', () => {
    const arena = sandbox({ curated: false });
    primera(arena, { body: CUERPO_A });
    const segunda = primera(arena, { body: CUERPO_B });
    const entradas = leerDiario(keyDe(arena), { root: arena.root });
    const asiento = entradas.find((e) => e.tipo === 'propuesta-sustituida');
    assert.ok(asiento, 'tiene que haber un asiento de sustitucion');
    assert.equal(asiento.revisionAnterior, segunda.superseded.revision);
    assert.equal(asiento.sha256Nueva, segunda.sha256);
    assert.ok(typeof asiento.huella === 'string' && asiento.huella.length === 64, 'el asiento entra en la cadena');
  });
});
