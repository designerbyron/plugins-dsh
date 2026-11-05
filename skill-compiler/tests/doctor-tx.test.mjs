/**
 * `doctor` · transacciones de aprobacion que quedaron a medias.
 *
 * El defecto que fija este fichero: la recuperacion solo ocurre cuando alguien vuelve a aprobar algo de
 * ese proyecto. Si nadie lo hace, la intencion se queda en `.tx/` sin que nada la mencione, y el almacen
 * puede estar con una skill a medias —o sin version servida— durante dias mientras `doctor` dice
 * «everything in place».
 *
 * Se mide con el BINARIO y sobre arenas, como las demas pruebas de `doctor`: lo que se corrige es lo que
 * lee una persona (sus lineas y su exit code). La clasificacion se mide ademas por funcion, porque el
 * estado tiene que salir del disco y no de una etiqueta de fase.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

import { diagnosticarTransacciones, ejecutarAprobacion, recuperarTransacciones } from '../lib/approve-tx.mjs';
import { approveProposal } from '../lib/commands.mjs';
import { propose } from '../lib/compiler.mjs';
import { cleanupSandboxes, goodInput, patchInput, sandbox } from './helpers.mjs';

process.env.DSH_LANG = 'es';

const CLI = join(process.cwd(), 'bin', 'skill-compiler.mjs');
const CWD = 'C:\\xampp\\htdocs\\doctor-con-transacciones';
const ID = 'measured-decision-check';
const OTRO = 'otra-propuesta-del-mismo-proyecto';

after(cleanupSandboxes);

const doctor = (arena, { lang = 'es' } = {}) => {
  mkdirSync(CWD, { recursive: true });
  const r = spawnSync(process.execPath, [CLI, 'doctor'], {
    cwd: CWD,
    env: { ...process.env, DSH_HOME: arena.base, DSH_LANG: lang },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const txDir = (arena, key) => join(arena.root, 'projects', key, '.tx');
const lineasTx = (salida) => salida.split(/\n/).filter((l) => /(transaccion (pendiente|inconsistente)|transaction (pending|inconsistent))/.test(l));

/** Hash de todo el arbol de la arena: sirve para demostrar que `doctor` no escribe. */
const huellaDeArena = (base) => {
  const partes = [];
  const recorrer = (dir, rel = '') => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) recorrer(join(dir, e.name), r);
      else partes.push(`${createHash('sha256').update(readFileSync(join(dir, e.name))).digest('hex')}  ${r}`);
    }
  };
  recorrer(base);
  return createHash('sha256').update(partes.join('\n')).digest('hex');
};

/** v1 aprobada y v2 propuesta encima; devuelve las rutas utiles. */
const conActualizacion = (arena) => {
  const primera = propose(goodInput(), { root: arena.root, curated: arena.curated, cwd: CWD });
  assert.equal(primera.status, 'proposed', JSON.stringify(primera.errors ?? primera));
  const key = primera.projectKey;
  assert.equal(approveProposal({ root: arena.root, key, id: ID, force: true, scope: 'project' }).kind, 'success');
  const segunda = propose(patchInput(), { root: arena.root, curated: arena.curated, cwd: CWD });
  assert.equal(segunda.status, 'proposed', JSON.stringify(segunda.errors ?? segunda));
  return key;
};

describe('A · sin transacciones pendientes', () => {
  it('un proyecto sin .tx/ no dice nada de transacciones y cierra en verde', () => {
    const arena = sandbox();
    propose(goodInput({ id: ID }), { root: arena.root, curated: arena.curated, cwd: CWD });
    const { salida } = doctor(arena);
    assert.equal(lineasTx(salida).length, 0, salida);
    assert.doesNotMatch(salida, /transaccion|transaction/i, salida);
  });

  it('un .tx/ vacio tampoco genera lineas', () => {
    const arena = sandbox();
    const r = propose(goodInput({ id: ID }), { root: arena.root, curated: arena.curated, cwd: CWD });
    mkdirSync(txDir(arena, r.projectKey), { recursive: true });
    const { salida } = doctor(arena);
    assert.equal(lineasTx(salida).length, 0, salida);
  });

  it('una aprobacion confirmada no aparece como pendiente', () => {
    const arena = sandbox();
    const r = propose(goodInput({ id: ID }), { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(approveProposal({ root: arena.root, key: r.projectKey, id: ID, force: true, scope: 'project' }).kind, 'success');
    assert.equal(readdirSync(txDir(arena, r.projectKey)).length, 0);
    const { salida } = doctor(arena);
    assert.equal(lineasTx(salida).length, 0, salida);
  });
});

describe('B · transaccion pendiente y recuperable', () => {
  it('paquete anterior ya apartado: se ve como `revert` y con la recuperacion por delante', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    const corte = ejecutarAprobacion({ root: arena.root, key, id: ID, hooks: { interrumpir: 'archived' } });
    assert.equal(corte.interrumpida, true);

    const { code, salida } = doctor(arena);
    const lineas = lineasTx(salida);
    assert.equal(lineas.length, 1, salida);
    assert.match(lineas[0], /transaccion pendiente: measured-decision-check/);
    assert.match(lineas[0], new RegExp(`en ${key}`));
    assert.match(lineas[0], /estado revert/);
    assert.match(lineas[0], new RegExp(`tx ${corte.tx}`));
    assert.match(lineas[0], /recuperacion: necesaria/);
    assert.notEqual(code, 0, 'una transaccion a medias no puede cerrar en verde');
  });

  it('candidata ya instalada: se ve como `complete` (falta el asiento)', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    ejecutarAprobacion({ root: arena.root, key, id: ID, hooks: { interrumpir: 'installed' } });
    const { salida } = doctor(arena);
    const lineas = lineasTx(salida);
    assert.equal(lineas.length, 1, salida);
    assert.match(lineas[0], /estado complete/);
  });

  it('instalada pero distinta de lo validado: se ve como `mismatch`', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    ejecutarAprobacion({ root: arena.root, key, id: ID, hooks: { interrumpir: 'installed' } });
    // Alguien toco lo instalado despues del rename: la huella ya no es la validada.
    writeFileSync(join(arena.root, 'projects', key, 'approved', ID, 'SKILL.md'), 'intruso');
    const lineas = lineasTx(doctor(arena).salida);
    assert.equal(lineas.length, 1, lineas.join('\n'));
    assert.match(lineas[0], /estado mismatch/);
  });

  it('varias intenciones: una linea por cada una', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    ejecutarAprobacion({ root: arena.root, key, id: ID, hooks: { interrumpir: 'archived' } });
    // Segunda skill del mismo proyecto, interrumpida tambien en su propia transaccion.
    const otra = propose(goodInput({ id: OTRO, description: 'Conciliar el inventario fisico con el registro contable al cierre.', whenToUse: 'Cuando el recuento del almacen no cuadra con el sistema y hay que decidir que ajustar.' }), { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(otra.status, 'proposed', JSON.stringify(otra.errors ?? otra));
    ejecutarAprobacion({ root: arena.root, key, id: OTRO, hooks: { interrumpir: 'intent' } });
    const lineas = lineasTx(doctor(arena).salida);
    assert.equal(lineas.length, 2, lineas.join('\n'));
    assert.ok(lineas.some((l) => l.includes(ID)));
    assert.ok(lineas.some((l) => l.includes(OTRO)));
  });

  it('el idioma del diagnostico sigue a DSH_LANG', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    ejecutarAprobacion({ root: arena.root, key, id: ID, hooks: { interrumpir: 'archived' } });
    const { salida } = doctor(arena, { lang: 'en' });
    assert.match(lineasTx(salida)[0], /transaction pending: measured-decision-check/);
    assert.match(lineasTx(salida)[0], /recovery: needed/);
  });
});

describe('C · transaccion inconsistente o ilegible', () => {
  it('una intencion cuyo paquete no esta en ninguno de los dos sitios es inconsistente', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    const corte = ejecutarAprobacion({ root: arena.root, key, id: ID, hooks: { interrumpir: 'archived' } });
    // Se manipula el disco por fuera del motor: la version viva desaparece de `superseded/`.
    const ficha = JSON.parse(readFileSync(join(txDir(arena, key), `${corte.tx}.json`), 'utf8'));
    rmSync(ficha.apartados[0].hasta, { recursive: true, force: true });

    const { code, salida } = doctor(arena);
    const lineas = lineasTx(salida);
    assert.equal(lineas.length, 1, salida);
    assert.match(lineas[0], /transaccion inconsistente/);
    assert.notEqual(code, 0, salida);
    assert.doesNotMatch(salida, /everything in place/, salida);
  });

  it('una intencion ilegible se declara, no se ignora', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    mkdirSync(txDir(arena, key), { recursive: true });
    writeFileSync(join(txDir(arena, key), 'roto.json'), '{"tx": "roto", "id":');

    const { code, salida } = doctor(arena);
    const lineas = lineasTx(salida);
    assert.equal(lineas.length, 1, salida);
    assert.match(lineas[0], /transaccion inconsistente: roto/);
    assert.match(lineas[0], /estado unreadable/);
    assert.match(lineas[0], /no se puede leer como JSON/);
    assert.notEqual(code, 0, salida);
  });

  it('un manifiesto ausente se nombra en la linea', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    const corte = ejecutarAprobacion({ root: arena.root, key, id: ID, hooks: { interrumpir: 'archived' } });
    const ficha = JSON.parse(readFileSync(join(txDir(arena, key), `${corte.tx}.json`), 'utf8'));
    rmSync(ficha.apartados[0].manifiesto, { force: true });

    const lineas = lineasTx(doctor(arena).salida);
    assert.equal(lineas.length, 1, lineas.join('\n'));
    assert.match(lineas[0], /manifiesto ausente/);
  });
});

describe('D-E · recuperacion', () => {
  it('tras recuperar, la transaccion deja de aparecer y el doctor no la menciona', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    ejecutarAprobacion({ root: arena.root, key, id: ID, hooks: { interrumpir: 'archived' } });
    assert.equal(lineasTx(doctor(arena).salida).length, 1);

    const recuperacion = recuperarTransacciones({ root: arena.root, key });
    assert.equal(recuperacion.incompletas, 0);

    const { salida } = doctor(arena);
    assert.equal(lineasTx(salida).length, 0, salida);
    assert.doesNotMatch(salida, /transaccion (pendiente|inconsistente)/, salida);
  });

  it('si la recuperacion no puede con ella, la intencion sigue y el doctor la senala', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    const corte = ejecutarAprobacion({ root: arena.root, key, id: ID, hooks: { interrumpir: 'archived' } });
    const ficha = JSON.parse(readFileSync(join(txDir(arena, key), `${corte.tx}.json`), 'utf8'));
    rmSync(ficha.apartados[0].hasta, { recursive: true, force: true });

    const recuperacion = recuperarTransacciones({ root: arena.root, key });
    assert.equal(recuperacion.incompletas, 1, 'no se declara recuperada');
    assert.equal(existsSync(join(txDir(arena, key), `${corte.tx}.json`)), true, 'la intencion se queda');

    const lineas = lineasTx(doctor(arena).salida);
    assert.equal(lineas.length, 1, lineas.join('\n'));
    assert.match(lineas[0], /inconsistente/);
  });
});

describe('aislamiento y solo lectura', () => {
  it('las transacciones de un proyecto no se atribuyen a otro', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    ejecutarAprobacion({ root: arena.root, key, id: ID, hooks: { interrumpir: 'archived' } });

    const otro = propose(goodInput({ id: 'skill-de-otro-proyecto' }), { root: arena.root, curated: arena.curated, cwd: 'C:\\xampp\\htdocs\\otro-proyecto-cualquiera' });
    assert.equal(otro.status, 'proposed', JSON.stringify(otro.errors ?? otro));
    assert.notEqual(otro.projectKey, key);

    assert.equal(diagnosticarTransacciones({ root: arena.root, key }).pendientes.length, 1);
    assert.equal(diagnosticarTransacciones({ root: arena.root, key: otro.projectKey }).pendientes.length, 0);

    // El doctor las ve todas, pero cada linea lleva su proyecto.
    const lineas = lineasTx(doctor(arena).salida);
    assert.equal(lineas.length, 1, lineas.join('\n'));
    assert.match(lineas[0], new RegExp(`en ${key}`));
  });

  it('doctor no escribe ni una sola linea en el almacen', () => {
    const arena = sandbox({ curated: false });
    const key = conActualizacion(arena);
    ejecutarAprobacion({ root: arena.root, key, id: ID, hooks: { interrumpir: 'archived' } });
    const antes = huellaDeArena(arena.base);
    const { code } = doctor(arena);
    const despues = huellaDeArena(arena.base);
    assert.equal(despues, antes, 'consultar el estado no puede cambiarlo');
    assert.notEqual(code, 0);
  });
});
